/*
 * Focused pairing-code codec and handle test.  This uses the provider-independent
 * relay kernel and an in-memory adapter; it never calls Supabase, storage, or a
 * remote service.
 *
 *   node scripts/test-blender-pairing-codec.mjs
 */
import assert from "node:assert/strict";
import {
  createBlenderRelay,
  locator,
  makeToken,
  parseLocator,
  parseToken,
} from "../supabase/functions/blender-bridge/relay-core.mjs";
import blenderContract from "../supabase/functions/blender-bridge/shared-contract.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const otherOwnerId = "44444444-4444-4444-8444-444444444444";
const browserToken = "pairing-codec-test-browser-token";
const serverSecret = "pairing-codec-test-server-secret";
const clock = Date.parse("2025-01-01T00:00:00.000Z");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function json(value) {
  return JSON.stringify(value);
}

function bytesToBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function legacyLocator(owner, project, actor) {
  return bytesToBase64Url(JSON.stringify({ o: owner, p: project, a: actor }));
}

function expectThrow(fn, message) {
  assert.throws(fn, undefined, message);
}

const ids = { ownerId, projectId, actorId };
const compactLocator = locator(ownerId, projectId, actorId);
const compactBody = compactLocator.slice("u1_".length);
const testSecret = new Uint8Array(32).fill(0x5a);

// The compact locator has a version prefix and exactly 48 encoded bytes: three
// independently ordered UUIDs, not a JSON object whose key order could change.
assert.match(compactLocator, /^u1_[A-Za-z0-9_-]{64}$/);
assert.equal(compactLocator.length, 67);
assert.deepEqual(parseLocator(compactLocator), ids);
assert.equal(makeToken("bbp1", ids, testSecret).length, 116);
assert.equal(parseToken(makeToken("bbp1", ids, testSecret), "bbp1").secret,
  bytesToBase64Url(testSecret));

// Distinct UUIDs make an accidental owner/project/actor permutation observable.
assert.deepEqual(parseLocator(locator(actorId, ownerId, projectId)), {
  ownerId: actorId,
  projectId: ownerId,
  actorId: projectId,
});

// Compact parsing is deliberately strict.  In particular, padding and trailing
// characters must not be accepted as alternate spellings of the 48-byte value.
expectThrow(() => parseLocator(`u1_${compactBody.slice(0, -1)}`),
  "short compact locator must be rejected");
expectThrow(() => parseLocator(`u1_${compactBody}!`),
  "invalid compact alphabet must be rejected");
expectThrow(() => parseLocator(`u1_${compactBody}=`),
  "noncanonical padded base64 must be rejected");
expectThrow(() => parseLocator(`u1_${compactBody}A`),
  "extra compact base64 character must be rejected");

// UUID case and non-UUID identifiers retain the old JSON locator format.
const uppercaseIds = {
  // The primary fixture is intentionally numeric-only; use hex letters here
  // so this actually exercises the uppercase fallback branch.
  ownerId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
  projectId,
  actorId,
};
const legacyIds = {
  ownerId: "owner_legacy",
  projectId: "project-legacy",
  actorId: "actor_legacy",
};
for (const fallbackIds of [uppercaseIds, legacyIds]) {
  const encoded = locator(fallbackIds.ownerId, fallbackIds.projectId, fallbackIds.actorId);
  assert.notEqual(encoded.slice(0, 3), "u1_");
  assert.deepEqual(parseLocator(encoded), fallbackIds);
  const token = makeToken("bbp1", fallbackIds, testSecret);
  assert.notEqual(token.length, 116);
  assert.deepEqual(parseToken(token, "bbp1"), {
    ...fallbackIds,
    secret: bytesToBase64Url(testSecret),
  });
}

// Decode a legacy JSON locator directly, without relying on makeToken's
// fallback selection.  This protects existing opaque codes already issued.
const legacyCode = `bbp1.${legacyLocator(ownerId, projectId, actorId)}.${bytesToBase64Url(testSecret)}`;
assert.deepEqual(parseToken(legacyCode, "bbp1"), {
  ...ids,
  secret: bytesToBase64Url(testSecret),
});

const states = new Map();
const files = new Map();
const calls = [];
let randomSeed = 7;

const actor = { id: actorId, email: "pairing-codec@example.test" };
const adapter = {
  async getUserByAccessToken(token) {
    return token === browserToken ? { ...actor } : null;
  },
  async getUserById(id) {
    return id === actorId ? { ...actor } : null;
  },
  async getProjectAccess(id, subject) {
    return id === projectId && subject?.id === actorId
      ? { exists: true, ownerId, actorId, canWrite: true }
      : { exists: false, ownerId: null, actorId: subject?.id || "", canWrite: false };
  },
  async getState(_project, entity) {
    return clone(states.get(entity) || null);
  },
  async insertState(row) {
    if (states.has(row.entity_id)) {
      const error = new Error("state already exists");
      error.conflict = true;
      throw error;
    }
    const saved = { id: `state-${states.size + 1}`, ...clone(row) };
    states.set(row.entity_id, saved);
    return clone(saved);
  },
  async casState(row, expected, next) {
    const current = states.get(row.entity_id);
    if (!current || json(current.meta) !== json(expected)) return { ok: false };
    current.meta = clone(next);
    return { ok: true, row: clone(current) };
  },
  async createMarker(bucket, path, bytes) {
    calls.push(["marker-create", bucket, path]);
    if (files.has(path)) return { created: false };
    files.set(path, new Uint8Array(bytes));
    return { created: true };
  },
  async readMarker(bucket, path) {
    calls.push(["marker-read", bucket, path]);
    return files.has(path) ? new Uint8Array(files.get(path)) : null;
  },
  async removePng(bucket, path) {
    calls.push(["remove", bucket, path]);
    files.delete(path);
  },
};

const relay = createBlenderRelay({
  adapter,
  contract: blenderContract,
  serverSecret,
  now: () => clock,
  random(length) {
    const bytes = new Uint8Array(length).fill(randomSeed);
    randomSeed += 1;
    return bytes;
  },
});

async function call(action, body = {}, authorization) {
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const request = new Request("https://relay.test", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  const response = await relay.handle(request);
  return { status: response.status, json: await response.json() };
}

const infoResponse = await relay.handle(new Request("https://relay.test", { method: "GET" }));
assert.equal(infoResponse.status, 200);
assert.equal((await infoResponse.json()).pairCodeFormat, "compact-uuid-v1");

function stateSnapshot() {
  return json([...states.entries()]);
}

function markerSnapshot() {
  return json([...files.entries()].map(([path, bytes]) => [path, [...bytes]]));
}

// A freshly issued UUID-scoped code is compact and is accepted by the real
// handle.  The stored 32-byte secret is not transformed by the locator codec.
let response = await call("pair.create", { projectId }, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
const pairCode = response.json.pairCode;
assert.equal(pairCode.length, 116);
assert.match(pairCode, /^bbp1\.u1_[A-Za-z0-9_-]{64}\.[A-Za-z0-9_-]{43}$/);
const freshPair = parseToken(pairCode, "bbp1");
assert.deepEqual(freshPair, {
  ...ids,
  secret: pairCode.split(".")[2],
});

// Blender's old password widget truncated the roughly-225-character legacy
// code at 127 characters, while the compact 116-character code survives intact.
// Use the freshly-issued secret in both values; only the locator spelling differs.
const oldPairCode = `bbp1.${legacyLocator(ownerId, projectId, actorId)}.${pairCode.split(".")[2]}`;
assert.ok(oldPairCode.length > 127);
const uiLimitStateBefore = stateSnapshot();
const uiLimitMarkersBefore = markerSnapshot();
response = await call("device.connect", {
  pairCode: oldPairCode.slice(0, 127),
  deviceName: "Truncated Legacy",
});
assert.equal(response.status, 401);
assert.equal(stateSnapshot(), uiLimitStateBefore);
assert.equal(markerSnapshot(), uiLimitMarkersBefore);

// An altered but syntactically valid compact locator must fail before state or
// marker mutation.  The alternate owner has no project access in this adapter.
const pairStateBeforeTamper = stateSnapshot();
const markerStateBeforeTamper = markerSnapshot();
const pairParts = pairCode.split(".");
const tamperedCode = `${pairParts[0]}.${locator(otherOwnerId, projectId, actorId)}.${pairParts[2]}`;
response = await call("device.connect", { pairCode: tamperedCode, deviceName: "Tampered" });
assert.equal(response.status, 401);
assert.equal(stateSnapshot(), pairStateBeforeTamper);
assert.equal(markerSnapshot(), markerStateBeforeTamper);

response = await call("device.connect", {
  pairCode: pairCode.slice(0, 127),
  deviceName: "Compact Password Limit",
});
assert.equal(response.status, 200);
let deviceToken = response.json.deviceToken;
assert.equal(deviceToken.length, 116);
assert.match(deviceToken, /^bbd1\.u1_[A-Za-z0-9_-]{64}\.[A-Za-z0-9_-]{43}$/);
assert.deepEqual(parseToken(deviceToken, "bbd1"), {
  ...ids,
  secret: deviceToken.split(".")[2],
});

// Pair codes are one-shot even when the same opaque value is replayed.
assert.equal((await call("device.connect", {
  pairCode, deviceName: "Replay",
})).status, 401);

// Exercise the compact device connection/get/disconnect flow.
response = await call("connection.get", { projectId }, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.connected, true);

const queuedSpec = {
  version: 1,
  projectId,
  shotId: "pairing-codec-shot",
  sceneId: "pairing-codec-scene",
  locationId: "pairing-codec-location",
  label: "Pairing codec test",
  room: { width: 12, depth: 12, height: 4 },
  landmarks: [],
  actors: [],
  props: [],
  camera: {
    position: [0, -6, 1.65],
    target: [0, 0, 1.4],
    focalLength: 50,
    sensorWidth: 36,
  },
  render: { width: 640, height: 360, samples: 16 },
};
response = await call("job.create", {
  projectId,
  spec: queuedSpec,
  requestId: "pairing-codec-device-get",
}, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
assert.ok(response.json && response.json.job && typeof response.json.job === "object");
const queuedJob = response.json.job;
assert.equal(queuedJob.status, "queued");
assert.equal(queuedJob.requestId, "pairing-codec-device-get");
assert.deepEqual(queuedJob.spec, queuedSpec);
assert.match(queuedJob.specHash, /^[a-f0-9]{64}$/);
response = await call("job.get", {
  projectId,
  jobId: queuedJob.id,
}, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.job.id, queuedJob.id);
assert.equal(response.json.job.status, "queued");

response = await call("connection.disconnect", { projectId }, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.deepEqual(response.json, { disconnected: true });
response = await call("connection.get", { projectId }, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.connected, false);
assert.equal((await call("connection.disconnect", { projectId },
  `Device ${deviceToken}`)).status, 401);

// The fresh code's actual secret is reused to construct an old JSON-locator
// request.  This tests legacy decode against the relay's stored pair hash,
// rather than testing a synthetic secret that was never issued by the relay.
response = await call("pair.create", { projectId }, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
const freshLegacySource = response.json.pairCode;
const freshLegacyParts = freshLegacySource.split(".");
const legacyBody = `bbp1.${legacyLocator(ownerId, projectId, actorId)}.${freshLegacyParts[2]}`;
assert.equal(parseToken(legacyBody, "bbp1").secret, freshLegacyParts[2]);
response = await call("device.connect", {
  pairCode: legacyBody,
  deviceName: "Legacy Locator Desktop",
});
assert.equal(response.status, 200);
deviceToken = response.json.deviceToken;
assert.match(deviceToken, /^bbd1\.u1_[A-Za-z0-9_-]{64}\.[A-Za-z0-9_-]{43}$/);
assert.equal((await call("connection.disconnect", { projectId },
  `Device ${deviceToken}`)).status, 200);

// Issuing a replacement revokes the old code.  The old code is rejected, while
// the replacement remains connectable, and a used replacement is also rejected.
response = await call("pair.create", { projectId }, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
const replacedCode = response.json.pairCode;
response = await call("pair.create", { projectId }, `Bearer ${browserToken}`);
assert.equal(response.status, 200);
const replacementCode = response.json.pairCode;
assert.notEqual(replacedCode, replacementCode);
assert.equal((await call("device.connect", {
  pairCode: replacedCode, deviceName: "Revoked Old Code",
})).status, 401);
response = await call("device.connect", {
  pairCode: replacementCode, deviceName: "Replacement Desktop",
});
assert.equal(response.status, 200);
deviceToken = response.json.deviceToken;
assert.equal((await call("device.connect", {
  pairCode: replacementCode, deviceName: "Used Replacement",
})).status, 401);
assert.equal((await call("connection.disconnect", { projectId },
  `Device ${deviceToken}`)).status, 200);

// Ensure this remains a self-contained test with no accidental opaque token
// fixtures or provider operations.
assert.ok(calls.some(([kind]) => kind === "marker-create"));
console.log("Blender pairing codec and handle tests passed.");
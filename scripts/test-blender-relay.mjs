/*
 * Protocol/state-machine test for the Blender relay.  It uses the real relay
 * kernel and a recording adapter, so there are no provider calls, network
 * requests, Supabase writes, or storage deletes.  Keep this executable with:
 *
 *   node scripts/test-blender-relay.mjs
 */
import assert from "node:assert/strict";
import { createBlenderRelay } from "../supabase/functions/blender-bridge/relay-core.mjs";
import { createSupabaseAdapter } from "../supabase/functions/blender-bridge/supabase-adapter.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const serviceKey = "test-only-service-role-key-which-is-long";
let clock = Date.parse("2025-01-01T00:00:00.000Z");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function digest(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((bytes) =>
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(12, 0x49484452);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

const spec = {
  version: 1, projectId, shotId: "shot-1", sceneId: "scene-1", locationId: "loc-1",
  label: "Relay test", room: { width: 12, depth: 12, height: 4 },
  landmarks: [], actors: [], props: [],
  camera: { position: [0, -6, 1.65], target: [0, 0, 1.4], focalLength: 50, sensorWidth: 36 },
  render: { width: 640, height: 360, samples: 16 },
};
const actualCamera = {
  position: [0, -6, 1.65], direction: [0, 0.999, -0.04],
  focalLength: 50, sensorWidth: 36, width: 640, height: 360,
};

const calls = [];
const states = new Map();
const files = new Map();
const stateEntity = `blender-bridge:${userId}:${projectId}`;
let writable = true;
let beforeUpload = null;
let beforeCas = null;
let revokeOnHash = false;
let markerReadError = null;
const actor = { id: userId, email: "owner@example.test" };
const adapter = {
  async getUserByAccessToken(token) {
    return token === "browser-secret" ? { id: userId, email: actor.email } : null;
  },
  async getUserById(id) {
    return id === userId ? { id, email: actor.email } : null;
  },
  async getProjectAccess(id, subject) {
    return id === projectId && subject.id === userId
      ? { exists: true, ownerId: userId, actorId: userId, canWrite: writable }
      : { exists: false, ownerId: null, actorId: subject.id, canWrite: false };
  },
  async getState(_project, entity) {
    return clone(states.get(entity) || null);
  },
  async insertState(row) {
    if (states.has(row.entity_id)) {
      const error = new Error("duplicate");
      error.conflict = true;
      throw error;
    }
    const saved = { id: `state-${states.size + 1}`, ...clone(row) };
    states.set(row.entity_id, saved);
    return clone(saved);
  },
  async casState(row, expected, next) {
    const current = states.get(row.entity_id);
    if (!current || JSON.stringify(current.meta) !== JSON.stringify(expected)) {
      return { ok: false };
    }
    if (beforeCas) {
      const hook = beforeCas;
      beforeCas = null;
      hook();
    }
    current.meta = clone(next);
    return { ok: true, row: clone(current) };
  },
  async uploadPng(bucket, path, bytes) {
    calls.push(["upload", bucket, path]);
    if (beforeUpload) beforeUpload();
    if (files.has(path)) return { created: false };
    files.set(path, new Uint8Array(bytes));
    return { created: true };
  },
  async createMarker(bucket, path, bytes) {
    calls.push(["marker-create", bucket, path]);
    if (files.has(path)) return { created: false };
    files.set(path, new Uint8Array(bytes));
    return { created: true };
  },
  async readMarker(bucket, path) {
    calls.push(["marker-read", bucket, path]);
    if (markerReadError) throw markerReadError;
    return files.has(path) ? new Uint8Array(files.get(path)) : null;
  },
  async downloadPng(bucket, path) {
    calls.push(["download", bucket, path]);
    if (!files.has(path)) throw new Error("missing fake file");
    return new Uint8Array(files.get(path));
  },
  async removePng(bucket, path) {
    calls.push(["remove", bucket, path]);
    files.delete(path);
  },
};

// Exercise the actual Supabase adapter as well, with a recording client.  This
// client has no network transport and deliberately has no write/delete methods
// in this smoke test.
const adapterClient = {
  storage: {
    from() {
      return {
        async upload(path, body) {
          if (adapterFiles.has(path)) {
            return { data: null, error: { statusCode: "409", message: "already exists" } };
          }
          adapterFiles.set(path, new Uint8Array(await body.arrayBuffer()));
          return { data: {}, error: null };
        },
        async download(path) {
          if (!adapterFiles.has(path)) {
            return { data: null, error: { statusCode: "404", message: "not found" } };
          }
          return { data: new Blob([adapterFiles.get(path)]), error: null };
        },
        async remove(paths) {
          for (const path of paths) adapterFiles.delete(path);
          return { data: paths.map((path) => ({ name: path })), error: null };
        },
      };
    },
  },
  auth: {
    async getUser(token) {
      return token === "browser-secret"
        ? { data: { user: { id: userId, email: actor.email } }, error: null }
        : { data: { user: null }, error: new Error("bad token") };
    },
    admin: {
      async getUserById(id) {
        return id === userId ? { data: { user: { id, email: actor.email } }, error: null }
          : { data: { user: null }, error: new Error("not found") };
      },
    },
  },
  from(table) {
    const query = {
      filters: {},
      select() { return this; },
      eq(key, value) { this.filters[key] = value; return this; },
      is() { return this; },
      async maybeSingle() {
        if (table !== "turn_projects" || this.filters.id !== projectId) {
          return { data: null, error: null };
        }
        return { data: { id: projectId, owner: userId }, error: null };
      },
    };
    return query;
  },
};
const adapterFiles = new Map();
const recordedAdapter = createSupabaseAdapter({
  createClient: () => adapterClient,
  url: "https://recording.supabase.test", anonKey: "anon", serviceKey: "service",
});
assert.equal((await recordedAdapter.getUserByAccessToken("browser-secret")).id, userId);
assert.equal((await recordedAdapter.getUserById(userId)).id, userId);
assert.equal((await recordedAdapter.getProjectAccess(projectId, actor)).canWrite, true);
assert.deepEqual(await recordedAdapter.createMarker("turn-assets", "_internal/test-marker",
  new TextEncoder().encode('{"v":1}')), { created: true });
assert.deepEqual(await recordedAdapter.createMarker("turn-assets", "_internal/test-marker",
  new TextEncoder().encode('{"v":1}')), { created: false });
assert.equal(new TextDecoder().decode(await recordedAdapter.readMarker(
  "turn-assets", "_internal/test-marker")), '{"v":1}');
assert.equal(await recordedAdapter.readMarker("turn-assets", "_internal/missing"), null);

const contract = {
  validateSpec: () => true,
  canonical: stable,
  hashSpec: (value) => {
    if (revokeOnHash) {
      revokeOnHash = false;
      writable = false;
    }
    return digest(stable(value));
  },
  validateCameraResult: () => true,
  validatePNG: (bytes, width, height) =>
    bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(16) === width &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(20) === height,
};
const relay = createBlenderRelay({
  adapter, contract, serverSecret: serviceKey, now: () => clock,
  random: (() => {
    let seed = 7;
    return (length) => new Uint8Array(length).fill(seed++);
  })(),
});

async function call(action, body = {}, authorization) {
  const headers = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const request = new Request("https://relay.test", {
    method: "POST", headers, body: JSON.stringify({ action, ...body }),
  });
  const response = await relay.handle(request);
  const json = await response.json();
  return { status: response.status, json };
}

let response = await call("pair.create", { projectId });
assert.equal(response.status, 401);
response = await call("pair.create", { projectId }, "Bearer browser-secret");
assert.equal(response.status, 200);
assert.ok(response.json.pairCode && response.json.expiresAt);
const pairCode = response.json.pairCode;
const pairStateBeforeConnect = clone(states.get(stateEntity).meta);

response = await call("device.connect", { pairCode, deviceName: "Test Blender" });
assert.equal(response.status, 200);
let deviceToken = response.json.deviceToken;
assert.ok(deviceToken);
const connectedStateForRollback = clone(states.get(stateEntity).meta);
states.get(stateEntity).meta = pairStateBeforeConnect;
assert.equal((await call("device.connect", { pairCode, deviceName: "Replay" })).status, 401);
states.get(stateEntity).meta = connectedStateForRollback;
response = await call("connection.get", { projectId }, "Bearer browser-secret");
assert.equal(response.json.connected, true);
assert.equal(response.json.job, null);

// A disconnected token remains unusable even if an old encrypted row is
// restored. Reconnect a fresh scoped token for the rest of the protocol test.
const stateBeforeDisconnect = clone(states.get(stateEntity).meta);
assert.equal((await call("connection.disconnect", { projectId },
  "Bearer browser-secret")).status, 200);
const stateAfterDisconnect = clone(states.get(stateEntity).meta);
states.get(stateEntity).meta = stateBeforeDisconnect;
assert.equal((await call("connection.disconnect", { projectId },
  `Device ${deviceToken}`)).status, 401);
states.get(stateEntity).meta = stateAfterDisconnect;
response = await call("pair.create", { projectId }, "Bearer browser-secret");
assert.equal(response.status, 200);
response = await call("device.connect", {
  pairCode: response.json.pairCode, deviceName: "Test Blender 2",
});
assert.equal(response.status, 200);
deviceToken = response.json.deviceToken;

const wrongProjectSpec = structuredClone(spec);
wrongProjectSpec.projectId = "33333333-3333-4333-8333-333333333333";
assert.equal((await call("job.create", {
  projectId, spec: wrongProjectSpec, requestId: "wrong-project",
}, "Bearer browser-secret")).status, 400);
revokeOnHash = true;
assert.equal((await call("job.create", {
  projectId, spec, requestId: "revoked-during-hash",
}, "Bearer browser-secret")).status, 403);
writable = true;

response = await call("job.create", { projectId, spec, requestId: "request-1" }, "Bearer browser-secret");
assert.equal(response.status, 200);
const job = response.json.job;
assert.equal(job.status, "queued");
assert.equal(job.requestId, "request-1");
assert.equal((await call("job.create", { projectId, spec, requestId: "request-1" },
  "Bearer browser-secret")).json.job.id, job.id);

response = await call("device.claim", {}, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.job.status, "running");
const leaseToken = response.json.job.leaseToken;

const resultBody = { jobId: job.id, leaseToken, pngBase64: png(640, 360), actualCamera };
response = await call("device.complete", resultBody, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.job.status, "completed");
assert.equal(response.json.job.pngBase64, resultBody.pngBase64);
response = await call("job.get", { jobId: job.id }, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.job.requestId, "request-1");
assert.equal((await call("job.get", { projectId, jobId: job.id },
  "Bearer browser-secret")).json.job.pngBase64, resultBody.pngBase64);
// A repeated device completion is safe and does not upload a second file.
assert.equal((await call("device.complete", resultBody, `Device ${deviceToken}`)).status, 200);
assert.equal(calls.filter((entry) => entry[0] === "upload").length, 1);

response = await call("job.create", { projectId, spec, requestId: "request-2" }, "Bearer browser-secret");
assert.equal(response.status, 200);
const second = response.json.job;
assert.equal((await call("job.get", { jobId: job.id }, `Device ${deviceToken}`)).status, 404);
assert.equal((await call("job.get", { jobId: second.id }, `Device ${deviceToken}`)).status, 200);
const secondQueuedState = clone(states.get(stateEntity).meta);
const claimed = await call("device.claim", {}, `Device ${deviceToken}`);
const secondLease = claimed.json.job.leaseToken;
const secondRunningState = clone(states.get(stateEntity).meta);
states.get(stateEntity).meta = secondQueuedState;
assert.equal((await call("device.claim", {}, `Device ${deviceToken}`)).json.job, null);
states.get(stateEntity).meta = secondRunningState;
assert.equal((await call("device.claim", {}, `Device ${deviceToken}`)).json.job, null);
assert.equal((await call("job.cancel", {
  projectId: "other-project", jobId: second.id,
}, `Device ${deviceToken}`)).status, 403);
beforeCas = () => { writable = false; };
assert.equal((await call("job.cancel", { projectId, jobId: second.id },
  "Bearer browser-secret")).status, 403);
writable = true;
const secondCancelledState = clone(states.get(stateEntity).meta);
states.get(stateEntity).meta = secondRunningState;
assert.equal((await call("device.complete", {
  jobId: second.id, leaseToken: secondLease, pngBase64: png(640, 360), actualCamera,
}, `Device ${deviceToken}`)).status, 409);
states.get(stateEntity).meta = secondCancelledState;
assert.equal((await call("job.cancel", { projectId, jobId: second.id },
  `Device ${deviceToken}`)).json.job.status, "cancelled");
response = await call("device.complete", {
  jobId: second.id, leaseToken: secondLease, pngBase64: png(640, 360), actualCamera,
}, `Device ${deviceToken}`);
assert.equal(response.status, 409);

response = await call("job.create", { projectId, spec, requestId: "request-3" }, "Bearer browser-secret");
const third = response.json.job;
const thirdClaim = await call("device.claim", {}, `Device ${deviceToken}`);
clock += 5 * 60 * 1000 + 1;
response = await call("device.complete", {
  jobId: third.id, leaseToken: thirdClaim.json.job.leaseToken,
  pngBase64: png(640, 360), actualCamera,
}, `Device ${deviceToken}`);
assert.equal(response.status, 409);
response = await call("device.claim", {}, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.equal(response.json.job, null);
assert.equal((await call("job.get", { jobId: third.id }, `Device ${deviceToken}`)).status, 200);
assert.equal((await call("job.get", { jobId: third.id }, `Device ${deviceToken}`)).json.job.status, "failed");
assert.equal((await call("job.get", { jobId: job.id }, `Device ${deviceToken}`)).status, 404);
const failedMarkerEntry = [...files.entries()].find(([, bytes]) =>
  new TextDecoder().decode(bytes).includes(`"kind":"job-terminal"`) &&
  new TextDecoder().decode(bytes).includes(`"jobId":"${third.id}"`));
assert.ok(failedMarkerEntry);
files.delete(failedMarkerEntry[0]);
assert.equal((await call("job.get", { projectId, jobId: third.id },
  "Bearer browser-secret")).status, 500);
files.set(failedMarkerEntry[0], failedMarkerEntry[1]);
markerReadError = new Error("storage timeout");
assert.equal((await call("job.get", { projectId, jobId: third.id },
  "Bearer browser-secret")).status, 500);
markerReadError = null;

// Revocation during a slow upload must prevent publication and clean only the
// just-created job path.
writable = true;
response = await call("job.create", { projectId, spec, requestId: "request-4" }, "Bearer browser-secret");
const fourth = response.json.job;
const fourthClaim = await call("device.claim", {}, `Device ${deviceToken}`);
const removeCount = calls.filter((entry) => entry[0] === "remove").length;
beforeUpload = () => { writable = false; };
response = await call("device.complete", {
  jobId: fourth.id, leaseToken: fourthClaim.json.job.leaseToken,
  pngBase64: png(640, 360), actualCamera,
}, `Device ${deviceToken}`);
beforeUpload = null;
assert.equal(response.status, 401);
assert.equal(calls.filter((entry) => entry[0] === "remove").length, removeCount + 1);
writable = true;

response = await call("connection.disconnect", { projectId: "other-project" }, `Device ${deviceToken}`);
assert.equal(response.status, 403);
response = await call("connection.disconnect", { projectId }, `Device ${deviceToken}`);
assert.equal(response.status, 200);
assert.equal((await call("job.get", { jobId: third.id }, `Device ${deviceToken}`)).status, 401);

writable = false;
const disconnect = await call("connection.disconnect", { projectId }, "Bearer browser-secret");
assert.equal(disconnect.status, 403);
assert.ok(calls.some((entry) => entry[0] === "remove"));
console.log("Blender relay kernel state-machine tests passed.");
/*
 * The provider-independent part of the Blender relay.
 *
 * This module deliberately has no Supabase or Deno imports.  The small adapter
 * interface at the bottom of this file is also useful for protocol tests: a
 * test can record every database/storage operation without talking to a
 * network.  The only durable authority is the encrypted state in one
 * turn_generations row.  Its one local import, ./storage-paths.mjs, is pure
 * (object-key helpers over the shared ./storage-keys.js parser).
 */
import {
  isRelayPngPath, legacyRelayPngPath, relayPngPathFor, relayPngTarget, resolveStorageFolders,
} from "./storage-paths.mjs";

const TEXT = new TextEncoder();
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_SPEC_BYTES = 96 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const JOB_LEASE_MS = 5 * 60 * 1000;
const PAIR_MS = 10 * 60 * 1000;
const DEVICE_MS = 60 * 60 * 1000;
const STATE_KIND = "image/meta.blenderBridge";
const ENTITY_PREFIX = "blender-bridge:";
const BUCKET = "turn-assets";
const DOMAIN = "cinema-machine/blender-bridge/state-key/v1";
const MARKER_PREFIX = "_internal/blender-bridge";
const MARKER_KINDS = new Set([
  "pair-used", "pair-revoked", "device-revoked", "job-claimed", "job-terminal",
]);
const MARKER_FIELDS = {
  "pair-used": ["actorId", "pairHash"],
  "pair-revoked": ["actorId", "pairHash"],
  "device-revoked": ["actorId", "tokenHash"],
  "job-claimed": ["jobId", "leaseHash"],
  "job-terminal": ["jobId", "decision", "leaseHash", "resultHash",
    "cameraHash", "reason"],
};

const ACTIONS = [
  "pair.create", "connection.get", "connection.disconnect",
  "device.connect", "job.create", "job.get", "job.cancel",
  "device.claim", "device.complete", "device.fail",
  "studio.capabilities", "studio.workspace.open", "studio.workspace.get",
  "studio.workspace.current", "studio.workspace.save", "studio.assistant.submit",
  "studio.assistant.get", "studio.assistant.cancel", "studio.mesh.submit",
  "studio.mesh.get", "studio.mesh.cancel", "studio.asset.get", "studio.reference.get",
  "studio.preview.publish", "studio.preview.get", "studio.board.publish",
];

export class RelayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message = "Malformed request.", code = "bad_request", status = 400) =>
  new RelayError(status, code, message);
const unauthorized = () => bad("Authentication required.", "unauthorized", 401);
const forbidden = () => bad("Blender preview permission required.", "forbidden", 403);
const notFound = () => bad("Blender job not found.", "not_found", 404);
const conflict = (message = "Blender relay state changed; retry.") =>
  bad(message, "conflict", 409);

function nowMs(now) {
  const value = typeof now === "function" ? now() : now;
  return Number.isFinite(value) ? value : Date.now();
}

function isBanned(user, time) {
  if (!user || !user.banned_until) return false;
  const until = Date.parse(user.banned_until);
  // An unparseable ban marker is safer treated as an active ban.
  return !Number.isFinite(until) || until > time;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeId(value, label = "identifier") {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(text)) {
    throw bad(`Invalid ${label}.`);
  }
  return text;
}

function safeString(value, label, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max ||
      /[\u0000-\u001f]/.test(value)) {
    throw bad(`Invalid ${label}.`);
  }
  return value;
}

function bytesToB64(bytes) {
  let binary = "";
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < input.length; i += 0x8000) {
    binary += String.fromCharCode(...input.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function b64ToBytes(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) ||
      text.length % 4 === 1) throw bad("Invalid encoded bytes.");
  let binary;
  try { binary = atob(text); } catch (_error) { throw bad("Invalid encoded bytes."); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64url(bytesOrText) {
  const value = typeof bytesOrText === "string" ? TEXT.encode(bytesOrText) : bytesOrText;
  return bytesToB64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) throw bad("Invalid token.");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - text.length % 4) % 4);
  return b64ToBytes(padded);
}

function randomBytes(random, length) {
  const bytes = new Uint8Array(length);
  if (typeof random === "function") {
    const value = random(length);
    if (value && typeof value.then === "function") {
      throw new Error("randomBytes must be synchronous");
    }
    bytes.set(value instanceof Uint8Array ? value : new Uint8Array(value));
  } else {
    crypto.getRandomValues(bytes);
  }
  return bytes;
}

function randomId(random) {
  return b64url(randomBytes(random, 18)).slice(0, 24);
}

function subtleCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto is unavailable.");
  return globalThis.crypto.subtle;
}

async function sha256(value) {
  return new Uint8Array(await subtleCrypto().digest("SHA-256",
    typeof value === "string" ? TEXT.encode(value) : value));
}

async function hmacSha256(key, value) {
  return new Uint8Array(await subtleCrypto().sign(
    "HMAC", key, typeof value === "string" ? TEXT.encode(value) : value,
  ));
}

function constantTimeEqual(a, b) {
  const left = typeof a === "string" ? TEXT.encode(a) : new Uint8Array(a || []);
  const right = typeof b === "string" ? TEXT.encode(b) : new Uint8Array(b || []);
  let result = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) result |= (left[i % (left.length || 1)] || 0) ^
    (right[i % (right.length || 1)] || 0);
  return result === 0;
}

async function digestHex(value) {
  return [...await sha256(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asResultValid(value) {
  if (value === false || value == null) return false;
  if (isObject(value) && (value.ok === false || value.valid === false)) return false;
  return true;
}

async function callValidator(fn, value, context) {
  if (typeof fn !== "function") return true;
  let result;
  try { result = await fn(value, context); } catch (_error) { return false; }
  return asResultValid(result);
}

function basicSpecCheck(spec) {
  if (!isObject(spec) || spec.version !== 1) return false;
  let encoded;
  try { encoded = JSON.stringify(spec); } catch (_error) { return false; }
  if (!encoded || TEXT.encode(encoded).length > MAX_SPEC_BYTES) return false;
  let valid = true;
  const walk = (value, key = "") => {
    if (!valid) return;
    if (typeof value === "number" && !Number.isFinite(value)) { valid = false; return; }
    if (typeof value === "string" && value.length > 512) { valid = false; return; }
    if (isObject(value)) {
      for (const [name, child] of Object.entries(value)) {
        if (/(url|uri|path|command|script|exec|shell|python|file)/i.test(name)) valid = false;
        walk(child, name);
      }
    } else if (Array.isArray(value)) {
      if (value.length > 64) valid = false;
      value.forEach((child) => walk(child, key));
    }
  };
  walk(spec);
  const room = spec.room;
  const render = spec.render;
  const camera = spec.camera;
  if (!isObject(room) || !isObject(render) || !isObject(camera) ||
      !Array.isArray(camera.position) || !Array.isArray(camera.target) ||
      camera.position.length !== 3 || camera.target.length !== 3) valid = false;
  if (Array.isArray(spec.landmarks) && spec.landmarks.length > 8) valid = false;
  if (Array.isArray(spec.actors) && spec.actors.length > 4) valid = false;
  if (Array.isArray(spec.props) && spec.props.length > 8) valid = false;
  return valid;
}

function fallbackPng(bytes, render) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 ||
      bytes.length > MAX_PNG_BYTES ||
      bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 ||
      bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return false;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width === render.width && height === render.height;
}

function fallbackCamera(actual, spec) {
  if (!isObject(actual) || !Array.isArray(actual.position) ||
      !Array.isArray(actual.direction) || actual.position.length !== 3 ||
      actual.direction.length !== 3 || actual.width !== spec.render.width ||
      actual.height !== spec.render.height) return false;
  const near = (a, b, tolerance = 0.02) => Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= tolerance;
  if (!near(actual.focalLength, spec.camera.focalLength, 0.05) ||
      !near(actual.sensorWidth, spec.camera.sensorWidth, 0.05)) return false;
  return actual.position.every((value, i) => near(value, spec.camera.position[i], 0.03)) &&
    actual.direction.every((value) => Number.isFinite(value));
}

function locator(ownerId, projectId, actorId) {
  // Blender's PASSWORD editor has a 128-byte buffer (127 characters + NUL),
  // even when its RNA StringProperty can store a longer string. Three UUIDs
  // as JSON made pairing codes 225 characters. Pack only the public routing
  // IDs; the separate random 32-byte secret and all authorization stay intact.
  const ids = [ownerId, projectId, actorId];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (ids.every(id => typeof id === "string" && uuid.test(id))) {
    const bytes = new Uint8Array(48);
    ids.forEach((id, index) => {
      const hex = id.replace(/-/g, "");
      for (let i = 0; i < 16; i++) bytes[index * 16 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    });
    return "u1_" + b64url(bytes);
  }
  // Preserve non-UUID/case-sensitive identifiers used by existing callers.
  return b64url(JSON.stringify({ o: ownerId, p: projectId, a: actorId }));
}

function parseLocator(encoded) {
  if (typeof encoded === "string" && encoded.startsWith("u1_")) {
    const payload = encoded.slice(3);
    if (!/^[A-Za-z0-9_-]{64}$/.test(payload)) throw bad("Invalid device token.");
    const bytes = fromB64url(payload);
    if (bytes.length !== 48 || b64url(bytes) !== payload) throw bad("Invalid device token.");
    const ids = [0, 16, 32].map(offset => {
      const hex = Array.from(bytes.subarray(offset, offset + 16),
        byte => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });
    return { ownerId: ids[0], projectId: ids[1], actorId: ids[2] };
  }
  // Already-issued JSON-locator pairing and device tokens remain valid.
  let value;
  try { value = JSON.parse(new TextDecoder().decode(fromB64url(encoded))); } catch (_error) {
    throw bad("Invalid device token.");
  }
  if (!isObject(value)) throw bad("Invalid device token.");
  return {
    ownerId: safeId(value.o, "token owner"),
    projectId: safeId(value.p, "token project"),
    actorId: safeId(value.a, "token actor"),
  };
}

function makeToken(prefix, loc, secret) {
  return `${prefix}.${locator(loc.ownerId, loc.projectId, loc.actorId)}.${b64url(secret)}`;
}

function parseToken(token, prefix) {
  if (typeof token !== "string") throw unauthorized();
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) throw unauthorized();
  const info = parseLocator(parts[1]);
  const secret = fromB64url(parts[2]);
  if (secret.length < 24) throw unauthorized();
  return { ...info, secret: parts[2] };
}

function stateEntity(ownerId, projectId) {
  return `${ENTITY_PREFIX}${ownerId}:${projectId}`;
}

function stateAad(ownerId, projectId, entityId) {
  return `${DOMAIN}:${ownerId}:${projectId}:${entityId}`;
}

export async function deriveStateKey(serverSecret) {
  if (typeof serverSecret !== "string" || serverSecret.length < 16) {
    throw new Error("Blender relay key is not configured.");
  }
  const digest = await sha256(`${DOMAIN}\0${serverSecret}`);
  return subtleCrypto().importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt", "decrypt",
  ]);
}

export async function deriveMarkerKey(serverSecret) {
  if (typeof serverSecret !== "string" || serverSecret.length < 16) {
    throw new Error("Blender relay key is not configured.");
  }
  const digest = await sha256(`${DOMAIN}\0marker\0${serverSecret}`);
  return subtleCrypto().importKey("raw", digest, {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
}

async function sealState(value, key, aad, random) {
  const iv = randomBytes(random, 12);
  const encrypted = await subtleCrypto().encrypt(
    { name: "AES-GCM", iv, additionalData: TEXT.encode(aad) },
    key, TEXT.encode(JSON.stringify(value)),
  );
  return { v: 1, iv: b64url(iv), ct: b64url(new Uint8Array(encrypted)) };
}

async function openState(sealed, key, aad) {
  if (!isObject(sealed) || sealed.v !== 1) throw new Error("bad sealed state");
  const iv = fromB64url(sealed.iv);
  const ct = fromB64url(sealed.ct);
  if (iv.length !== 12 || ct.length < 17) throw new Error("bad sealed state");
  const plain = await subtleCrypto().decrypt(
    { name: "AES-GCM", iv, additionalData: TEXT.encode(aad) }, key, ct,
  );
  const value = JSON.parse(new TextDecoder().decode(plain));
  if (!isObject(value)) throw new Error("bad sealed state");
  return value;
}

function publicJob(job, includeLease = false) {
  if (!job) return null;
  const result = {
    id: job.id, status: job.status, spec: job.spec, specHash: job.specHash,
    createdAt: job.createdAt, requestId: job.requestId, error: job.error || null,
  };
  if (job.status === "completed") {
    result.actualCamera = job.actualCamera;
    if (job._pngBase64) result.pngBase64 = job._pngBase64;
  }
  if (includeLease && job._leaseToken) result.leaseToken = job._leaseToken;
  return result;
}

// The relay PNG follows the turn-assets convention account/project/assetType/
// entity/role.  Every dynamic component is generated by this relay.  Legacy keys
// use the bare owner and project ids; since 2026-09-27 new keys use the readable
// folders when the adapter supplies valid ones (relayPngPath below, see
// storage-paths.mjs).  A stored job.pngPath is checked with isRelayPngPath.
// generatedPath is the pre-2026-09-27 name of the legacy key, kept for importers.
const generatedPath = legacyRelayPngPath;

function cleanError(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text.slice(0, 400) || "Blender render failed.");
}

async function parseRequest(request) {
  const declared = Number(request.headers?.get?.("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw bad("Request is too large.", "too_large", 413);
  let body;
  if (typeof request.arrayBuffer === "function") {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_BODY_BYTES) throw bad("Request is too large.", "too_large", 413);
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch (_error) {
      throw bad("Request must be JSON.");
    }
  } else {
    try { body = await request.json(); } catch (_error) { throw bad("Request must be JSON."); }
    try {
      if (TEXT.encode(JSON.stringify(body)).length > MAX_BODY_BYTES) {
        throw bad("Request is too large.", "too_large", 413);
      }
    } catch (error) {
      if (error instanceof RelayError) throw error;
      throw bad("Malformed request.");
    }
  }
  if (!isObject(body) || typeof body.action !== "string") throw bad("Action is required.");
  return body;
}

function authHeader(request) {
  return request.headers?.get?.("authorization") ||
    request.headers?.get?.("Authorization") || "";
}

export function createBlenderRelay({
  adapter, contract = {}, studio = null, serverSecret, now = () => Date.now(), random,
} = {}) {
  if (!adapter) throw new Error("A relay adapter is required.");
  // New relay PNG key: readable folders when the adapter has valid ones, else legacy.
  // Called ONCE per job, when the job is created; the answer is kept in the encrypted
  // job state as job.pngTarget (see relayPngTarget).
  async function relayPngPath(ownerId, projectId, jobId) {
    return relayPngPathFor(await resolveStorageFolders(adapter, ownerId, projectId), ownerId, projectId, jobId);
  }
  // A completion writes relayPngTarget(job, …) (storage-paths.mjs): never a lookup
  // made at completion time, so every attempt of one job writes the same key.
  const keyPromise = deriveStateKey(serverSecret);
  const markerKeyPromise = deriveMarkerKey(serverSecret);

  function markerFailure() {
    return new RelayError(500, "marker_unavailable", "Blender relay marker is unavailable.");
  }

  async function markerPath(kind, ownerId, projectId, value) {
    if (!MARKER_KINDS.has(kind)) throw new Error("unknown marker kind");
    const key = await markerKeyPromise;
    const signed = await hmacSha256(key,
      `${kind}\0${ownerId}\0${projectId}\0${value}`);
    return `${MARKER_PREFIX}/${kind}/${hex(signed)}.json`;
  }

  function markerBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof value === "string") return TEXT.encode(value);
    throw markerFailure();
  }

  function markerPayload(kind, ownerId, projectId, fields) {
    const payload = {
      v: 1, kind, ownerId, projectId, ...fields,
    };
    const encoded = JSON.stringify(payload);
    if (TEXT.encode(encoded).length > 4096) throw markerFailure();
    return payload;
  }

  function validateMarker(payload, expected) {
    if (!isObject(payload) || payload.v !== 1 || payload.kind !== expected.kind ||
        payload.ownerId !== expected.ownerId || payload.projectId !== expected.projectId) {
      throw markerFailure();
    }
    for (const key of MARKER_FIELDS[expected.kind]) {
      const nullable = expected.kind === "job-terminal" &&
        ["leaseHash", "resultHash", "cameraHash", "reason"].includes(key);
      if (!Object.prototype.hasOwnProperty.call(payload, key) ||
          (typeof payload[key] !== "string" && !(nullable && payload[key] === null))) {
        throw markerFailure();
      }
    }
    if (MARKER_FIELDS[expected.kind].includes("actorId") &&
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(payload.actorId)) {
      throw markerFailure();
    }
    if (expected.kind === "job-terminal" &&
        !["completed", "cancelled", "failed"].includes(payload.decision)) {
      throw markerFailure();
    }
    if (expected.kind === "job-terminal" && payload.decision !== "completed" &&
        (payload.resultHash !== null || payload.cameraHash !== null)) {
      throw markerFailure();
    }
    if (expected.kind === "job-terminal" && payload.decision === "completed" &&
        (payload.resultHash === null || payload.cameraHash === null)) {
      throw markerFailure();
    }
    if (["pair-used", "pair-revoked"].includes(expected.kind) &&
        !/^[a-f0-9]{64}$/i.test(payload.pairHash)) throw markerFailure();
    if (expected.kind === "device-revoked" &&
        !/^[a-f0-9]{64}$/i.test(payload.tokenHash)) throw markerFailure();
    if (expected.kind === "job-claimed" &&
        (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(payload.jobId) ||
          !/^[a-f0-9]{64}$/i.test(payload.leaseHash))) throw markerFailure();
    if (expected.kind === "job-terminal" &&
        (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(payload.jobId) ||
          (payload.leaseHash !== null && !/^[a-f0-9]{64}$/i.test(payload.leaseHash)) ||
          (payload.resultHash !== null && !/^[a-f0-9]{64}$/i.test(payload.resultHash)) ||
          (payload.cameraHash !== null && !/^[a-f0-9]{64}$/i.test(payload.cameraHash)))) {
      throw markerFailure();
    }
    for (const [key, value] of Object.entries(expected.fields || {})) {
      if (payload[key] !== value) throw markerFailure();
    }
    return payload;
  }

  async function readMarker(kind, ownerId, projectId, value, fields = {}) {
    const path = await markerPath(kind, ownerId, projectId, value);
    if (typeof adapter.readMarker !== "function") throw markerFailure();
    let raw;
    try {
      raw = await adapter.readMarker(BUCKET, path);
    } catch (_error) {
      throw markerFailure();
    }
    if (raw === null) return null;
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(markerBytes(raw))); } catch (_error) {
      throw markerFailure();
    }
    return { path, payload: validateMarker(payload, {
      kind, ownerId, projectId, fields,
    }) };
  }

  async function putMarker(kind, ownerId, projectId, value, fields) {
    const expected = markerPayload(kind, ownerId, projectId, fields);
    const existing = await readMarker(kind, ownerId, projectId, value, fields);
    if (existing) return existing;
    const path = await markerPath(kind, ownerId, projectId, value);
    if (typeof adapter.createMarker !== "function") throw markerFailure();
    let result;
    try {
      result = await adapter.createMarker(BUCKET, path,
        TEXT.encode(JSON.stringify(expected)));
    } catch (_error) {
      throw markerFailure();
    }
    if (result?.created) return { path, payload: expected };
    // A duplicate is safe only after reading and authenticating the immutable
    // existing object. Any missing/error result is fail-closed.
    const after = await readMarker(kind, ownerId, projectId, value, fields);
    if (!after) throw markerFailure();
    return after;
  }

  async function deviceRevoked(ownerId, projectId, tokenHash) {
    return readMarker("device-revoked", ownerId, projectId, tokenHash);
  }

  async function revokeDevice(ownerId, projectId, tokenHash, actorId) {
    return putMarker("device-revoked", ownerId, projectId, tokenHash, {
      actorId, tokenHash,
    });
  }

  async function terminalMarker(snapshot, job) {
    return readMarker("job-terminal", snapshot.state.ownerId, snapshot.state.projectId, job.id,
      { jobId: job.id });
  }

  function terminalDecision(marker, decision, leaseHash = null, resultHash = null,
    cameraHash = null) {
    if (!marker) throw markerFailure();
    if (marker.payload.decision !== decision ||
        !constantTimeEqual(marker.payload.leaseHash || "", leaseHash || "") ||
        (resultHash != null &&
          !constantTimeEqual(marker.payload.resultHash || "", resultHash)) ||
        (cameraHash != null &&
          !constantTimeEqual(marker.payload.cameraHash || "", cameraHash))) {
      throw conflict("Job has an immutable terminal decision.");
    }
    return marker;
  }

  function terminalLease(job) {
    return job.status === "completed"
      ? job.completedLeaseHash
      : job.terminalDecisionHash;
  }

  function terminalName(status) {
    return status === "cancelled" ? "cancelled" : status;
  }

  async function requireTerminalState(snapshot, job) {
    const marker = await terminalMarker(snapshot, job);
    const expected = terminalName(job.status);
    const cameraHash = expected === "completed" && job.actualCamera
      ? await digestHex(stable(job.actualCamera)) : null;
    terminalDecision(marker, expected, terminalLease(job),
      expected === "completed" ? marker?.payload.resultHash : null, cameraHash);
    return marker;
  }

  async function putTerminal(snapshot, job, decision, leaseHash, fields = {}) {
    const existing = await terminalMarker(snapshot, job);
    if (existing) {
      return terminalDecision(existing, decision, leaseHash,
        fields.resultHash ?? null, fields.cameraHash ?? null);
    }
    return putMarker("job-terminal", snapshot.state.ownerId, snapshot.state.projectId, job.id, {
      jobId: job.id, decision, leaseHash: leaseHash || null,
      resultHash: fields.resultHash ?? null, cameraHash: fields.cameraHash ?? null,
      reason: fields.reason || null,
    });
  }

  async function claimedMarker(snapshot, job) {
    return readMarker("job-claimed", snapshot.state.ownerId, snapshot.state.projectId, job.id,
      { jobId: job.id });
  }

  async function requireClaimed(snapshot, job, leaseHash) {
    const marker = await claimedMarker(snapshot, job);
    if (!marker) throw markerFailure();
    if (!constantTimeEqual(marker.payload.leaseHash || "", leaseHash || "")) {
      throw conflict("Job lease is no longer valid.");
    }
    return marker;
  }

  async function authBrowser(request) {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader(request).trim());
    if (!match) throw unauthorized();
    const user = await adapter.getUserByAccessToken(match[1]);
    if (!user || user.deleted_at || isBanned(user, nowMs(now))) throw unauthorized();
    const id = safeId(user.id, "user");
    return { id, email: typeof user.email === "string" ? user.email.toLowerCase() : "" };
  }

  async function currentAccess(projectId, actor) {
    const access = await adapter.getProjectAccess(projectId, actor);
    if (!access?.exists || !access.ownerId || access.actorId !== actor.id ||
        !access.canWrite) throw forbidden();
    return {
      ownerId: safeId(access.ownerId, "project owner"),
      actorId: actor.id,
      email: actor.email,
    };
  }

  async function currentReadAccess(projectId, actor) {
    const access = await adapter.getProjectAccess(projectId, actor);
    if (!access?.exists || !access.ownerId || access.actorId !== actor.id ||
        !(access.canRead || access.canWrite)) throw forbidden();
    return {
      ownerId: safeId(access.ownerId, "project owner"),
      actorId: actor.id,
      email: actor.email,
    };
  }

  async function browserCommitGuard(request, projectId, actor) {
    const fresh = await authBrowser(request);
    if (fresh.id !== actor.id) throw unauthorized();
    return currentAccess(projectId, fresh);
  }

  async function currentDevice(info) {
    const user = await adapter.getUserById(info.actorId);
    if (!user || user.deleted_at || isBanned(user, nowMs(now))) throw unauthorized();
    const access = await adapter.getProjectAccess(info.projectId, {
      id: info.actorId, email: typeof user.email === "string" ? user.email.toLowerCase() : "",
    });
    if (!access?.exists || access.ownerId !== info.ownerId ||
        access.actorId !== info.actorId || !access.canWrite) throw unauthorized();
    return { ownerId: info.ownerId, actorId: info.actorId, email: user.email || "" };
  }

  async function loadState(ownerId, projectId, commitGuard = null) {
    const entityId = stateEntity(ownerId, projectId);
    let row = await adapter.getState(projectId, entityId);
    if (!row) {
      const key = await keyPromise;
      const plain = {
        v: 1, ownerId, projectId, entityId, pair: null, connection: null, job: null,
      };
      const meta = {
        kind: STATE_KIND,
        sealed: await sealState(plain, key, stateAad(ownerId, projectId, entityId), random),
      };
      try {
        if (commitGuard) await commitGuard();
        row = await adapter.insertState({
          project_id: projectId, owner: ownerId, entity_id: entityId,
          storage_path: null, meta, refs: [], history: [],
        });
        if (commitGuard) await commitGuard();
      } catch (error) {
        if (!error?.conflict) throw error;
        row = await adapter.getState(projectId, entityId);
      }
    }
    if (!row || row.project_id !== projectId || row.owner !== ownerId ||
        row.entity_id !== entityId || row.storage_path !== null ||
        !isObject(row.meta) || row.meta.kind !== STATE_KIND) {
      throw new RelayError(500, "state_corrupt", "Blender relay state is unavailable.");
    }
    const key = await keyPromise;
    let plain;
    try {
      plain = await openState(row.meta.sealed, key, stateAad(ownerId, projectId, entityId));
    } catch (_error) {
      throw new RelayError(500, "state_corrupt", "Blender relay state is unavailable.");
    }
    if (plain.v !== 1 || plain.ownerId !== ownerId || plain.projectId !== projectId ||
        plain.entityId !== entityId) {
      throw new RelayError(500, "state_corrupt", "Blender relay state is unavailable.");
    }
    return { row, state: plain, entityId };
  }

  async function saveState(snapshot, nextState, commitGuard = null,
    { postGuard = true, postCommitGuard = commitGuard } = {}) {
    const key = await keyPromise;
    const nextMeta = {
      kind: STATE_KIND,
      sealed: await sealState(nextState, key,
        stateAad(nextState.ownerId, nextState.projectId, snapshot.entityId), random),
    };
    if (commitGuard) await commitGuard();
    const saved = await adapter.casState(snapshot.row, snapshot.row.meta, nextMeta);
    if (!saved?.ok) throw conflict();
    if (postCommitGuard && postGuard) {
      try {
        await postCommitGuard();
      } catch (error) {
        // The state CAS succeeded, so callers must not clean up a now-
        // published path. They still fail closed to the revoked caller.
        error.committed = true;
        throw error;
      }
    }
    return {
      row: saved.row || { ...snapshot.row, meta: nextMeta },
      state: nextState,
      entityId: snapshot.entityId,
    };
  }

  async function getJobOutput(snapshot, includeBytes = true) {
    const job = snapshot.state.job;
    if (!job) return null;
    const output = publicJob(job);
    if (job.status !== "queued" && job.status !== "running") {
      await requireTerminalState(snapshot, job);
    }
    if (includeBytes && job.status === "completed") {
      if (!job.completedLeaseHash) throw markerFailure();
      const cameraHash = job.actualCamera
        ? await digestHex(stable(job.actualCamera)) : null;
      const completion = terminalDecision(
        await terminalMarker(snapshot, job), "completed", job.completedLeaseHash,
        null, cameraHash,
      );
      if (!completion.payload.resultHash) throw markerFailure();
      if (!job.pngPath || !isRelayPngPath(job.pngPath, snapshot.state.ownerId,
          snapshot.state.projectId, job.id)) {
        throw new RelayError(500, "state_corrupt", "Blender result is unavailable.");
      }
      const bytes = await adapter.downloadPng(BUCKET, job.pngPath);
      if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PNG_BYTES) {
        throw new RelayError(500, "result_invalid", "Blender result is unavailable.");
      }
      if (await digestHex(bytes) !== completion.payload.resultHash) {
        throw markerFailure();
      }
      output.pngBase64 = bytesToB64(bytes);
      terminalDecision(
        await terminalMarker(snapshot, job), "completed", job.completedLeaseHash,
        completion.payload.resultHash, cameraHash,
      );
    }
    // Storage download is an await boundary. Do not return a result for a job
    // which was replaced/cancelled while the bytes were being read.
    const current = await loadState(snapshot.state.ownerId, snapshot.state.projectId);
    const currentJob = current.state.job;
    if ((job === null) !== (currentJob === null) ||
        (job && (!currentJob || currentJob.id !== job.id ||
        currentJob.status !== job.status ||
        currentJob.specHash !== job.specHash ||
        currentJob.pngPath !== job.pngPath))) {
      throw conflict("Blender job changed while reading its result.");
    }
    return output;
  }

  async function browserProject(request, body) {
    const actor = await authBrowser(request);
    const projectId = safeId(body.projectId, "project id");
    return { actor, ...(await currentAccess(projectId, actor)), projectId };
  }

  async function deviceAuth(request) {
    const match = /^Device\s+(\S+)$/i.exec(authHeader(request).trim());
    if (!match) throw unauthorized();
    const info = parseToken(match[1], "bbd1");
    const access = await currentDevice(info);
    const snapshot = await loadState(info.ownerId, info.projectId,
      () => currentDevice(info));
    const connection = snapshot.state.connection;
    if (!connection || connection.actorId !== info.actorId ||
        !constantTimeEqual(connection.tokenHash, await digestHex(info.secret)) ||
        connection.expiresAt <= nowMs(now)) {
      if (connection && connection.actorId === info.actorId &&
          constantTimeEqual(connection.tokenHash, await digestHex(info.secret))) {
        await revokeDevice(info.ownerId, info.projectId, connection.tokenHash, info.actorId);
      }
      throw unauthorized();
    }
    if (await deviceRevoked(info.ownerId, info.projectId, connection.tokenHash)) {
      throw unauthorized();
    }
    return { token: match[1], info, access, snapshot };
  }

  async function deviceCommitGuard(request, info) {
    const current = await deviceAuth(request);
    if (current.info.ownerId !== info.ownerId ||
        current.info.projectId !== info.projectId ||
        current.info.actorId !== info.actorId) throw unauthorized();
    return current;
  }

  // Studio is an additive extension, but it must use precisely the same
  // session/device and current-membership checks as the frozen v1 relay.
  async function studioContext(request, body) {
    const deviceHeader = /^Device\s+\S+$/i.test(authHeader(request).trim());
    if (deviceHeader) {
      const device = await deviceAuth(request);
      checkDeviceProject(body, device.info.projectId);
      const snapshot = device.snapshot;
      return {
        kind: "device", projectId: device.info.projectId, actor: { id: device.info.actorId },
        access: device.access, snapshot, browserToken: null,
        recheck: () => deviceCommitGuard(request, device.info),
        writeCheck: () => deviceCommitGuard(request, device.info),
        refresh: () => loadState(device.info.ownerId, device.info.projectId,
          () => deviceCommitGuard(request, device.info)),
        save: (next, source = snapshot) => saveState(source, next,
          () => deviceCommitGuard(request, device.info)),
      };
    }
    const readOnly = new Set([
      "studio.capabilities", "studio.workspace.get", "studio.workspace.current",
      "studio.reference.get", "studio.asset.get", "studio.preview.get",
    ]).has(body.action);
    const actor = await authBrowser(request);
    const projectId = safeId(body.projectId, "project id");
    const access = {
      actor,
      ...(await (readOnly ? currentReadAccess(projectId, actor) : currentAccess(projectId, actor))),
      projectId,
    };
    const guard = readOnly
      ? async () => {
        const fresh = await authBrowser(request);
        if (fresh.id !== actor.id) throw unauthorized();
        return currentReadAccess(projectId, fresh);
      }
      : () => browserCommitGuard(request, access.projectId, access.actor);
    const snapshot = await loadState(access.ownerId, access.projectId,
      guard);
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader(request).trim());
    return {
      kind: "browser", projectId: access.projectId, actor: access.actor, access, snapshot,
      browserToken: match ? match[1] : null,
      recheck: guard,
      writeCheck: () => browserCommitGuard(request, access.projectId, access.actor),
      refresh: () => loadState(access.ownerId, access.projectId,
        guard),
      save: (next, source = snapshot) => saveState(source, next,
        () => browserCommitGuard(request, access.projectId, access.actor)),
    };
  }

  async function createPair(request, body) {
    const access = await browserProject(request, body);
    const guard = () => browserCommitGuard(request, access.projectId, access.actor);
    const snapshot = await loadState(access.ownerId, access.projectId, guard);
    if (snapshot.state.pair) {
      await putMarker("pair-revoked", access.ownerId, access.projectId,
        snapshot.state.pair.hash, {
          actorId: snapshot.state.pair.actorId, pairHash: snapshot.state.pair.hash,
        });
    }
    const secret = randomBytes(random, 32);
    const pairCode = makeToken("bbp1", access, secret);
    const next = structuredClone(snapshot.state);
    next.pair = {
      hash: await digestHex(b64url(secret)), expiresAt: nowMs(now) + PAIR_MS,
      actorId: access.actorId,
    };
    await saveState(snapshot, next, guard);
    return { pairCode, expiresAt: new Date(next.pair.expiresAt).toISOString() };
  }

  async function connectionGet(request, body) {
    const access = await browserProject(request, body);
    const snapshot = await loadState(access.ownerId, access.projectId,
      () => browserCommitGuard(request, access.projectId, access.actor));
    const job = await getJobOutput(snapshot);
    const guard = () => browserCommitGuard(request, access.projectId, access.actor);
    await guard();
    let latest = await loadState(access.ownerId, access.projectId);
    const firstJob = snapshot.state.job;
    const latestJob = latest.state.job;
    if ((firstJob === null) !== (latestJob === null) ||
        (firstJob && (!latestJob || firstJob.id !== latestJob.id ||
          firstJob.status !== latestJob.status ||
          firstJob.specHash !== latestJob.specHash ||
          firstJob.pngPath !== latestJob.pngPath))) {
      throw conflict("Blender job changed while reading its result.");
    }
    let connection = latest.state.connection;
    if (connection && connection.expiresAt <= nowMs(now)) {
      const cleared = structuredClone(latest.state);
      cleared.connection = null;
      await revokeDevice(access.ownerId, access.projectId,
        connection.tokenHash, connection.actorId);
      latest = await saveState(latest, cleared, guard);
      connection = latest.state.connection;
    }
    const active = !!connection && connection.expiresAt > nowMs(now);
    return {
      connected: active,
      job,
      ...(active ? {
        deviceName: connection.deviceName,
        expiresAt: new Date(connection.expiresAt).toISOString(),
        lastSeen: new Date(connection.lastSeen).toISOString(),
      } : {}),
    };
  }

  async function connectionDisconnect(request, body) {
    const access = await browserProject(request, body);
    const guard = () => browserCommitGuard(request, access.projectId, access.actor);
    const snapshot = await loadState(access.ownerId, access.projectId, guard);
    if (snapshot.state.connection) {
      const next = structuredClone(snapshot.state);
      next.connection = null;
      await revokeDevice(access.ownerId, access.projectId,
        snapshot.state.connection.tokenHash, snapshot.state.connection.actorId);
      await saveState(snapshot, next, guard);
    }
    return { disconnected: true };
  }

  async function deviceConnectionDisconnect(request, body) {
    const device = await deviceAuth(request);
    checkDeviceProject(body, device.info.projectId);
    const next = structuredClone(device.snapshot.state);
    next.connection = null;
    await revokeDevice(device.info.ownerId, device.info.projectId,
      device.snapshot.state.connection.tokenHash, device.snapshot.state.connection.actorId);
    await saveState(device.snapshot, next,
      () => currentDevice(device.info),
      { postCommitGuard: () => currentDevice(device.info) });
    return { disconnected: true };
  }

  function checkDeviceProject(body, projectId) {
    if (Object.prototype.hasOwnProperty.call(body, "projectId") &&
        safeId(body.projectId, "project id") !== projectId) {
      throw forbidden();
    }
  }

  async function deviceConnect(body) {
    const code = safeString(body.pairCode, "pair code", 2048);
    const parsed = parseToken(code, "bbp1");
    const guard = () => currentDevice(parsed);
    const snapshot = await loadState(parsed.ownerId, parsed.projectId, guard);
    const pair = snapshot.state.pair;
    if (!pair || pair.actorId !== parsed.actorId || pair.expiresAt <= nowMs(now) ||
        !constantTimeEqual(pair.hash, await digestHex(parsed.secret))) throw unauthorized();
    if (await readMarker("pair-revoked", parsed.ownerId, parsed.projectId, pair.hash,
      { actorId: pair.actorId, pairHash: pair.hash }) ||
        await readMarker("pair-used", parsed.ownerId, parsed.projectId, pair.hash,
          { actorId: pair.actorId, pairHash: pair.hash })) throw unauthorized();
    await currentDevice(parsed);
    const existing = snapshot.state.connection;
    if (existing && existing.expiresAt > nowMs(now)) {
      throw conflict("A Blender device is already connected.");
    }
    if (existing) {
      await revokeDevice(parsed.ownerId, parsed.projectId, existing.tokenHash, existing.actorId);
    }
    await putMarker("pair-used", parsed.ownerId, parsed.projectId, pair.hash, {
      actorId: pair.actorId, pairHash: pair.hash,
    });
    const deviceSecret = randomBytes(random, 32);
    const token = makeToken("bbd1", parsed, deviceSecret);
    const deviceName = safeString(body.deviceName, "device name", 120).trim();
    if (!deviceName) throw bad("Invalid device name.");
    const next = structuredClone(snapshot.state);
    next.pair = null;
    next.connection = {
      actorId: parsed.actorId, tokenHash: await digestHex(b64url(deviceSecret)),
      deviceName,
      expiresAt: nowMs(now) + DEVICE_MS, lastSeen: nowMs(now),
    };
    await saveState(snapshot, next, guard);
    return {
      deviceToken: token, projectId: parsed.projectId,
      expiresAt: new Date(next.connection.expiresAt).toISOString(),
    };
  }

  async function createJob(request, body) {
    const access = await browserProject(request, body);
    if (!isObject(body.spec) || body.spec.projectId !== access.projectId) {
      throw bad("Scene spec belongs to another project.", "invalid_spec");
    }
    const requestId = safeString(body.requestId, "request id", 160);
    if (!Object.prototype.hasOwnProperty.call(body, "spec")) throw bad("Scene spec is required.");
    if (!basicSpecCheck(body.spec) ||
        !(await callValidator(contract.validateSpec, body.spec))) {
      throw bad("Invalid scene spec.", "invalid_spec");
    }
    const encoded = JSON.stringify(body.spec);
    if (TEXT.encode(encoded).length > MAX_SPEC_BYTES) throw bad("Scene spec is too large.", "too_large", 413);
    let canonical;
    let hashed;
    try {
      canonical = typeof contract.canonical === "function"
        ? contract.canonical(body.spec) : stable(body.spec);
      hashed = typeof contract.hashSpec === "function"
        ? await contract.hashSpec(body.spec) : await digestHex(canonical);
    } catch (_error) {
      throw bad("Invalid scene spec.", "invalid_spec");
    }
    const specHash = typeof hashed === "string" ? hashed :
      typeof hashed?.hash === "string" ? hashed.hash : bytesToB64(hashed);
    if (!/^[A-Fa-f0-9]{32,128}$/.test(specHash)) throw bad("Invalid scene spec hash.", "invalid_spec");
    const guard = () => browserCommitGuard(request, access.projectId, access.actor);
    const snapshot = await loadState(access.ownerId, access.projectId, guard);
    const oldJob = snapshot.state.job;
    if (oldJob?.requestId === requestId) {
      if (oldJob.specHash !== specHash) throw conflict("Request id was already used.");
      const current = await getJobOutput(snapshot);
      await guard();
      return { job: current };
    }
    const time = nowMs(now);
    if (oldJob?.status === "queued") {
      // A claim marker with a queued row means the claim CAS lost a race (or
      // the row was rolled back). The old request is permanently ineligible;
      // an explicit new request may replace it.
      if (!(await claimedMarker(snapshot, oldJob)) &&
          !(await terminalMarker(snapshot, oldJob))) {
        throw conflict("A Blender job is already active.");
      }
    }
    if (oldJob?.status === "running" && oldJob.leaseExpiresAt > time) {
      throw conflict("A Blender job is already active.");
    }
    if (oldJob?.status === "running" && oldJob.leaseExpiresAt <= time) {
      await requireClaimed(snapshot, oldJob, oldJob.leaseHash);
      const terminal = await terminalMarker(snapshot, oldJob);
      if (!terminal) {
        await putTerminal(snapshot, oldJob, "failed", oldJob.leaseHash, {
          reason: "lease_expired",
        });
      }
    }
    const job = {
      id: randomId(random), status: "queued", spec: structuredClone(body.spec),
      specHash, requestId, createdAt: new Date(time).toISOString(), error: null,
    };
    // Choose the result PNG's key now, once (readable folders when available).
    job.pngTarget = await relayPngPath(access.ownerId, access.projectId, job.id);
    const next = structuredClone(snapshot.state);
    next.job = job;
    const saved = await saveState(snapshot, next, guard);
    if (oldJob?.pngPath) {
      // Only a key this relay generated for this owner, project and job (either
      // folder form) is ever removed.
      if (isRelayPngPath(oldJob.pngPath, access.ownerId, access.projectId, oldJob.id)) {
        try { await adapter.removePng(BUCKET, oldJob.pngPath); } catch (_error) { /* private orphan */ }
      }
    }
    return { job: publicJob(saved.state.job) };
  }

  async function getJob(request, body) {
    const access = await browserProject(request, body);
    const jobId = safeId(body.jobId, "job id");
    const snapshot = await loadState(access.ownerId, access.projectId);
    if (!snapshot.state.job || snapshot.state.job.id !== jobId) throw notFound();
    const output = await getJobOutput(snapshot);
    await browserCommitGuard(request, access.projectId, access.actor);
    return { job: output };
  }

  async function cancelJob(request, body) {
    const access = await browserProject(request, body);
    const jobId = safeId(body.jobId, "job id");
    const guard = () => browserCommitGuard(request, access.projectId, access.actor);
    const snapshot = await loadState(access.ownerId, access.projectId, guard);
    if (!snapshot.state.job || snapshot.state.job.id !== jobId) throw notFound();
    if (snapshot.state.job.status === "queued" || snapshot.state.job.status === "running") {
      const currentJob = snapshot.state.job;
      if (currentJob.status === "running") {
        await requireClaimed(snapshot, currentJob, currentJob.leaseHash);
      }
      const terminal = await terminalMarker(snapshot, currentJob);
      if (terminal) {
        terminalDecision(terminal, "cancelled", currentJob.leaseHash || null);
      } else {
        await putTerminal(snapshot, currentJob, "cancelled", currentJob.leaseHash || null);
      }
      const next = structuredClone(snapshot.state);
      next.job.status = "cancelled";
      next.job.error = null;
      next.job.terminalDecisionHash = currentJob.leaseHash || null;
      delete next.job.leaseHash;
      delete next.job.leaseExpiresAt;
      await saveState(snapshot, next, guard);
      return { job: publicJob(next.job) };
    }
    const output = await getJobOutput(snapshot);
    await guard();
    return { job: output };
  }

  async function deviceCancelJob(request, body) {
    const device = await deviceAuth(request);
    checkDeviceProject(body, device.info.projectId);
    const jobId = safeId(body.jobId, "job id");
    const job = device.snapshot.state.job;
    if (!job || job.id !== jobId) throw notFound();
    if (job.status !== "queued" && job.status !== "running") {
      const output = await getJobOutput(device.snapshot);
      await deviceCommitGuard(request, device.info);
      return { job: output };
    }
    if (job.status === "running") await requireClaimed(device.snapshot, job, job.leaseHash);
    const terminal = await terminalMarker(device.snapshot, job);
    if (terminal) terminalDecision(terminal, "cancelled", job.leaseHash || null);
    else await putTerminal(device.snapshot, job, "cancelled", job.leaseHash || null);
    const next = structuredClone(device.snapshot.state);
    next.job.status = "cancelled";
    next.job.error = null;
    next.job.terminalDecisionHash = job.leaseHash || null;
    delete next.job.leaseHash;
    delete next.job.leaseExpiresAt;
    const saved = await saveState(device.snapshot, next,
      () => deviceCommitGuard(request, device.info));
    return { job: publicJob(saved.state.job) };
  }

  async function claimJob(request) {
    const device = await deviceAuth(request);
    const { snapshot } = device;
    const job = snapshot.state.job;
    if (!job) return { job: null };
    if (job.status !== "queued" && job.status !== "running") {
      await requireTerminalState(snapshot, job);
      return { job: null };
    }
    if (await terminalMarker(snapshot, job)) return { job: null };
    if (job.status === "running") {
      if (job.leaseExpiresAt > nowMs(now)) return { job: null };
      // An expired lease is an interrupted render, not a new opportunity to
      // render the same scene. Mark it failed; the browser must explicitly
      // create a fresh request to retry.
      const expired = structuredClone(snapshot.state);
      await requireClaimed(snapshot, job, job.leaseHash);
      await putTerminal(snapshot, job, "failed", job.leaseHash, {
        reason: "lease_expired",
      });
      expired.job.status = "failed";
      expired.job.error = "Render lease expired; retry explicitly.";
      expired.job.terminalDecisionHash = job.leaseHash;
      delete expired.job.leaseHash;
      delete expired.job.leaseExpiresAt;
      await saveState(snapshot, expired,
        () => deviceCommitGuard(request, device.info));
      return { job: null };
    }
    if (job.status !== "queued") return { job: null };
    if (await claimedMarker(snapshot, job)) return { job: null };
    const leaseSecret = randomBytes(random, 32);
    const leaseToken = b64url(leaseSecret);
    const next = structuredClone(snapshot.state);
    next.job.status = "running";
    next.job.leaseHash = await digestHex(leaseToken);
    next.job.leaseExpiresAt = nowMs(now) + JOB_LEASE_MS;
    await putMarker("job-claimed", snapshot.state.ownerId, snapshot.state.projectId, job.id, {
      jobId: job.id, leaseHash: next.job.leaseHash,
    });
    const saved = await saveState(snapshot, next,
      () => deviceCommitGuard(request, device.info));
    const output = publicJob(saved.state.job, true);
    output.leaseToken = leaseToken;
    // Installed desktop add-ons read the lease from the response envelope.
    // Keep the nested copy for existing relay clients, but expose neither copy
    // from job.get / connection.get; only this authenticated claim grants it.
    return { job: output, leaseToken };
  }

  async function completeJob(request, body) {
    const device = await deviceAuth(request);
    const jobId = safeId(body.jobId, "job id");
    const leaseToken = safeString(body.leaseToken, "lease token", 256);
    const bytes = b64ToBytes(body.pngBase64);
    if (bytes.length > MAX_PNG_BYTES) throw bad("PNG is too large.", "too_large", 413);
    const snapshot = device.snapshot;
    const job = snapshot.state.job;
    if (!job || job.id !== jobId) throw notFound();
    if (job.status === "completed" &&
        constantTimeEqual(job.completedLeaseHash, await digestHex(leaseToken))) {
      const output = await getJobOutput(snapshot);
      await deviceCommitGuard(request, device.info);
      return { job: output };
    }
    if (job.status !== "running" || job.leaseExpiresAt <= nowMs(now) ||
        !constantTimeEqual(job.leaseHash, await digestHex(leaseToken))) throw conflict("Job lease is no longer valid.");
    await requireClaimed(snapshot, job, job.leaseHash);
    if (!isObject(body.actualCamera) ||
        !fallbackCamera(body.actualCamera, job.spec) ||
        !(await callValidator(contract.validateCameraResult, body.actualCamera, job.spec))) {
      throw bad("Invalid camera result.", "invalid_camera");
    }
    const validPng = typeof contract.validatePNG === "function"
      ? await (async () => {
        try {
          const result = await contract.validatePNG(bytes, job.spec.render.width, job.spec.render.height);
          return asResultValid(result);
        } catch (_error) {
          return false;
        }
      })()
      : fallbackPng(bytes, job.spec.render);
    if (!validPng) throw bad("Invalid PNG result.", "invalid_png");
    const resultHash = await digestHex(bytes);
    const cameraHash = await digestHex(stable(body.actualCamera));
    await putTerminal(snapshot, job, "completed", job.leaseHash, {
      resultHash, cameraHash,
    });
    const path = relayPngTarget(job, snapshot.state.ownerId, snapshot.state.projectId);
    // Track only a positively-created object as cleanup-eligible. An ambiguous
    // storage response must never delete a preexisting job-owned object.
    let uploaded = false;
    try {
      let uploadResult;
      try {
        uploadResult = await adapter.uploadPng(BUCKET, path, bytes);
      } catch (uploadError) {
        // A storage client can lose the response after creating the object.
        // Preserve an already matching job-owned object; otherwise the
        // outcome is ambiguous and must not trigger deletion of a preexisting
        // object.
        try {
          const existing = await adapter.downloadPng(BUCKET, path);
          if (!(existing instanceof Uint8Array) ||
              !constantTimeEqual(await digestHex(existing), resultHash)) {
            throw uploadError;
          }
          uploadResult = { created: false };
        } catch (readError) {
          throw uploadError;
        }
      }
      uploaded = uploadResult?.created !== false;
      if (uploadResult?.created === false) {
        uploaded = false;
        const existing = await adapter.downloadPng(BUCKET, path);
        if (!(existing instanceof Uint8Array) ||
            !constantTimeEqual(await digestHex(existing), resultHash)) {
          throw markerFailure();
        }
      }
      // Upload is intentionally not publication. Re-authenticate and reload
      // after the await so cancel, disconnect, role changes, and lease expiry
      // win races with a slow storage operation.
      const current = await deviceAuth(request);
      const currentJob = current.snapshot.state.job;
      if (!currentJob || currentJob.id !== job.id || currentJob.status !== "running" ||
          !constantTimeEqual(currentJob.leaseHash, job.leaseHash) ||
          currentJob.leaseExpiresAt <= nowMs(now)) throw conflict("Job lease is no longer valid.");
      terminalDecision(
        await terminalMarker(current.snapshot, currentJob), "completed",
        job.leaseHash, resultHash, cameraHash,
      );
      const next = structuredClone(current.snapshot.state);
      next.job.status = "completed";
      next.job.actualCamera = structuredClone(body.actualCamera);
      next.job.pngPath = path;
      next.job.error = null;
      next.job.completedLeaseHash = job.leaseHash;
      delete next.job.leaseHash;
      delete next.job.leaseExpiresAt;
      const saved = await saveState(current.snapshot, next,
        () => deviceCommitGuard(request, device.info));
      const output = publicJob(saved.state.job);
      output.pngBase64 = bytesToB64(bytes);
      return { job: output };
    } catch (error) {
      if (uploaded && !error?.committed) {
        try { await adapter.removePng(BUCKET, path); } catch (_cleanupError) { /* own path only */ }
      }
      throw error;
    }
  }

  async function failJob(request, body) {
    const device = await deviceAuth(request);
    const jobId = safeId(body.jobId, "job id");
    const leaseToken = safeString(body.leaseToken, "lease token", 256);
    const job = device.snapshot.state.job;
    if (!job || job.id !== jobId) throw notFound();
    if (job.status !== "running" || job.leaseExpiresAt <= nowMs(now) ||
        !constantTimeEqual(job.leaseHash, await digestHex(leaseToken))) throw conflict("Job lease is no longer valid.");
    await requireClaimed(device.snapshot, job, job.leaseHash);
    const failure = cleanError(body.error);
    const terminal = await terminalMarker(device.snapshot, job);
    if (terminal) terminalDecision(terminal, "failed", job.leaseHash);
    else await putTerminal(device.snapshot, job, "failed", job.leaseHash, { reason: failure });
    const next = structuredClone(device.snapshot.state);
    next.job.status = "failed";
    next.job.error = failure;
    next.job.terminalDecisionHash = job.leaseHash;
    delete next.job.leaseHash;
    delete next.job.leaseExpiresAt;
    const saved = await saveState(device.snapshot, next,
      () => deviceCommitGuard(request, device.info));
    return { job: publicJob(saved.state.job) };
  }

  async function deviceGetJob(request, body) {
    const device = await deviceAuth(request);
    checkDeviceProject(body, device.info.projectId);
    const jobId = safeId(body.jobId, "job id");
    if (!device.snapshot.state.job || device.snapshot.state.job.id !== jobId) throw notFound();
    const output = await getJobOutput(device.snapshot);
    // Permission and connection may have changed while a completed PNG was
    // read. This second check also prevents a revoked device receiving bytes.
    const current = await deviceAuth(request);
    if (!current.snapshot.state.job || current.snapshot.state.job.id !== jobId) throw notFound();
    return { job: output };
  }

  async function dispatch(request, body) {
    const deviceHeader = /^Device\s+\S+$/i.test(authHeader(request).trim());
    switch (body.action) {
      case "pair.create": return createPair(request, body);
      case "connection.get": return connectionGet(request, body);
      case "connection.disconnect":
        return deviceHeader ? deviceConnectionDisconnect(request, body) :
          connectionDisconnect(request, body);
      case "device.connect": return deviceConnect(body);
      case "job.create": return createJob(request, body);
      case "job.get": return deviceHeader ? deviceGetJob(request, body) :
        getJob(request, body);
      case "job.cancel": return deviceHeader ? deviceCancelJob(request, body) :
        cancelJob(request, body);
      case "device.claim": return claimJob(request);
      case "device.complete": return completeJob(request, body);
      case "device.fail": return failJob(request, body);
      default:
        if (studio?.actions?.has?.(body.action)) {
          return studio.handle(request, body, { context: studioContext });
        }
        throw bad("Unknown action.");
    }
  }

  async function handle(request) {
    try {
      if (request.method === "OPTIONS") return new Response(null, {
        status: 204, headers: corsHeaders(),
      });
      if (request.method === "GET") return json({
        version: 1, actions: ACTIONS, leaseSeconds: JOB_LEASE_MS / 1000,
        pairSeconds: PAIR_MS / 1000, deviceSeconds: DEVICE_MS / 1000,
        pairCodeFormat: "compact-uuid-v1",
        claimLeasePlacement: "envelope-and-job",
        extensions: { sceneWorkspace: 1 },
      });
      if (request.method !== "POST") throw bad("POST required.", "method_not_allowed", 405);
      const body = await parseRequest(request);
      const result = await dispatch(request, body);
      return json(result);
    } catch (error) {
      const relayError = error instanceof RelayError ? error :
        (Number.isInteger(error?.status) && typeof error?.code === "string"
          ? new RelayError(error.status, error.code, error.message) : null) ||
        new RelayError(500, "relay_error", "Blender relay request failed.");
      return json({ error: relayError.message, code: relayError.code }, relayError.status);
    }
  }

  return { handle, dispatch };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

export {
  ACTIONS, BUCKET, DEVICE_MS, ENTITY_PREFIX, JOB_LEASE_MS, MAX_PNG_BYTES,
  PAIR_MS, STATE_KIND, generatedPath, stateEntity, b64url, digestHex,
  locator, parseLocator, makeToken, parseToken,
  isRelayPngPath, legacyRelayPngPath,
};
/* Real packaged Studio add-on/relay interoperability regression.
 *
 * This starts createBlenderRelay + createStudioService behind a loopback HTTP
 * server, then has a headless Blender process use the packaged Python client.
 * It intentionally builds its ZIP under /tmp so this test never changes the
 * downloadable artifact.  The Python runner patches only endpoint_url for its
 * own loopback transport; all request construction and response validation
 * remain those of the packaged add-on.
 *
 * Run: node scripts/test-blender-studio-interop.mjs
 * Optional: BLENDER_BIN=/path/to/blender
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createBlenderRelay } from "../supabase/functions/blender-bridge/relay-core.mjs";
import { createStudioService, validateGlb } from "../supabase/functions/blender-bridge/studio-service.mjs";
import "../app/blender-studio-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = path.join(root, "scripts", "test-blender-studio-interop.py");
const ownerId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const browserToken = "studio-interop-browser-token";
const location = { id: "location-reception", name: "Reception", rootLocationId: "location-reception",
  context: { description: "A reception desk.", architecture: "brick", materials: "wood", staging: "open" } };
const firstShot = {
  id: "shot-arrival", sceneId: "scene-arrival", name: "Arrival",
  camera: { position: [5, -7, 4], target: [0, 0, 1], focalLength: 50, sensorWidth: 36 },
  objects: [], tracks: [], frameStart: 1, frameEnd: 24, fps: 24,
};
const secondShot = {
  id: "shot-reverse", sceneId: "scene-reverse", name: "Reverse",
  camera: { position: [-5, -7, 3], target: [0, 0, 1], focalLength: 45, sensorWidth: 36 },
  objects: [], tracks: [], frameStart: 1, frameEnd: 24, fps: 24,
};

const clone = value => value == null ? value : structuredClone(value);
const check = (value, message) => { if (!value) throw new Error(message); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/* The smallest useful triangle GLB: all mesh bytes are in its BIN chunk, so
 * neither the service nor Blender can resolve a URI. */
function minimalGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0", generator: "Cinema Machine Studio interop" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "InteropTriangle" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: 44 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3",
      max: [1, 1, 0], min: [0, 0, 0] },
    { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }],
  }));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const bin = Buffer.alloc(44);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => bin.writeFloatLE(value, index * 4));
  bin.writeUInt16LE(0, 36); bin.writeUInt16LE(1, 38); bin.writeUInt16LE(2, 40);
  const total = 12 + 8 + json.length + jsonPadding.length + 8 + bin.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([header, jsonHeader, json, jsonPadding, binHeader, bin]));
}

function maliciousGlb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "https://attacker.test/a.bin", byteLength: 0 }] }));
  const padding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const total = 12 + 8 + json.length + padding.length;
  const header = Buffer.alloc(12); header.write("glTF"); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const chunk = Buffer.alloc(8); chunk.writeUInt32LE(json.length + padding.length, 0); chunk.writeUInt32LE(0x4e4f534a, 4);
  return new Uint8Array(Buffer.concat([header, chunk, json, padding]));
}

/* A small dependency-free ZIP writer, deliberately scoped to this test's
 * temporary archive.  Do not call the production bundle build from here. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value) { const result = Buffer.alloc(2); result.writeUInt16LE(value); return result; }
function u32(value) { const result = Buffer.alloc(4); result.writeUInt32LE(value >>> 0); return result; }
function zipHeader(signature, name, packed, original, offset = 0) {
  const n = Buffer.from(name);
  const common = signature === 0x02014b50
    ? [u32(signature), u16(20), u16(20), u16(0), u16(8), u16(0), u16(33)]
    : [u32(signature), u16(20), u16(0), u16(8), u16(0), u16(33)];
  common.push(u32(crc32(original)), u32(packed.length), u32(original.length), u16(n.length), u16(0));
  if (signature === 0x02014b50) common.push(u16(0), u16(0), u16(0), u32(0), u32(offset));
  common.push(n);
  return Buffer.concat(common);
}
function buildTemporaryAddon(directory) {
  const source = path.join(root, "blender", "cinema_machine_bridge");
  const names = fs.readdirSync(source).filter(name => name.endsWith(".py")).sort();
  check(names.includes("__init__.py") && names.includes("studio_runtime.py") && names.includes("studio_protocol.py"),
    "Studio package sources are incomplete; cannot build isolated interop ZIP");
  const chunks = [], central = []; let offset = 0;
  for (const name of names) {
    const original = fs.readFileSync(path.join(source, name)), packed = zlib.deflateRawSync(original, { level: 9 });
    const archiveName = `cinema_machine_bridge/${name}`, local = zipHeader(0x04034b50, archiveName, packed, original);
    chunks.push(local, packed); central.push(zipHeader(0x02014b50, archiveName, packed, original, offset)); offset += local.length + packed.length;
  }
  const records = Buffer.concat(central);
  chunks.push(records, Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(names.length), u16(names.length), u32(records.length), u32(offset), u16(0)]));
  const zipPath = path.join(directory, "cinema-machine-studio-interop.zip");
  fs.writeFileSync(zipPath, Buffer.concat(chunks));
  return zipPath;
}

const states = new Map(), files = new Map(), upstream = new Map(), meshSubmitCounts = new Map(), actions = [];
let writable = true, seed = 19, charges = 0, authorizations = 0, assistantSubmissions = 0;
const goodGlb = minimalGlb();
assert.throws(() => validateGlb(maliciousGlb()), /unsafe external content/i, "service GLB guard must reject external URI");
validateGlb(goodGlb);
const adapter = {
  async getUserByAccessToken(token) { return token === browserToken ? { id: ownerId, email: "owner@example.test" } : null; },
  async getUserById(id) { return id === ownerId ? { id, email: "owner@example.test" } : null; },
  async getProjectAccess(id, subject) {
    return id === projectId && subject.id === ownerId ? { exists: true, ownerId, actorId: ownerId, canWrite: writable } :
      { exists: false, ownerId: null, actorId: subject.id, canWrite: false };
  },
  async getState(_project, entity) { return clone(states.get(entity) || null); },
  async insertState(row) {
    if (states.has(row.entity_id)) { const error = new Error("state conflict"); error.conflict = true; throw error; }
    const saved = { id: `state-${states.size + 1}`, ...clone(row) }; states.set(row.entity_id, saved); return clone(saved);
  },
  async casState(row, expected, next) {
    const current = states.get(row.entity_id);
    if (!current || JSON.stringify(current.meta) !== JSON.stringify(expected)) return { ok: false };
    current.meta = clone(next); return { ok: true, row: clone(current) };
  },
  async uploadPng(_bucket, name, bytes) { if (files.has(name)) return { created: false }; files.set(name, new Uint8Array(bytes)); return { created: true }; },
  async downloadPng(_bucket, name) { if (!files.has(name)) throw new Error("missing test storage object"); return new Uint8Array(files.get(name)); },
  async removePng(_bucket, name) { files.delete(name); },
  async createMarker(_bucket, name, bytes) { if (files.has(name)) return { created: false }; files.set(name, new Uint8Array(bytes)); return { created: true }; },
  async readMarker(_bucket, name) { return files.has(name) ? new Uint8Array(files.get(name)) : null; },
  atomicStudioSettlement: true,
  async authorizeCredit({ token }) { if (token !== browserToken) return { ok: false, message: "test authorization rejected" }; authorizations += 1; return { ok: true }; },
  async spendCredit({ token }) { if (token !== browserToken) return { ok: false, message: "test authorization rejected" }; charges += 1; return { ok: true, remaining: 99 }; },
  async uploadStudioAsset(name, bytes) { files.set(name, new Uint8Array(bytes)); return { created: true }; },
  async downloadStudioAsset(name) { return new Uint8Array(files.get(name)); },
};
const provider = {
  available: true, models: { "claude-fable-5": true }, verifiedModels: { "claude-fable-5": true },
  meshConfigured: true, meshVerified: true,
  async submitAssistant() {
    assistantSubmissions += 1;
    return { summary: "Add reviewed reception blocking.", ops: [
      { op: "upsert_object", scope: "set", object: { id: "reception-box", name: "Reception box", kind: "box",
        position: [0, 0, .5], rotation: [0, 0, 0], scale: [1, 1, 1], color: [.4, .3, .2] } },
      { op: "upsert_object", scope: "shot", shotId: firstShot.id, object: { id: "arrival-marker", name: "Arrival marker", kind: "sphere",
        position: [0, 0, 1], rotation: [0, 0, 0], scale: [.25, .25, .25], color: [.8, .2, .2] } },
      { op: "set_tracks", shotId: firstShot.id, tracks: [{ objectId: "arrival-marker", property: "position",
        keyframes: [{ frame: 1, value: [0, 0, 1] }, { frame: 12, value: [1, 0, 1] }] }], frameStart: 1, frameEnd: 24, fps: 24 },
    ] };
  },
  async submitMesh(request) {
    meshSubmitCounts.set(request.prompt, (meshSubmitCounts.get(request.prompt) || 0) + 1);
    const id = `upstream-${upstream.size + 1}`; upstream.set(id, { ready: request.prompt !== "cancel mesh" }); return { requestId: id };
  },
  async getMesh(id) { return upstream.get(id)?.ready ? { status: "completed", model_glb: { url: "https://fal.run/interop-triangle.glb" } } : { status: "queued" }; },
  async fetchFile(url) { check(url === "https://fal.run/interop-triangle.glb", "provider URL allowlist drifted"); return { bytes: goodGlb }; },
  async cancelMesh() {},
};
const relay = createBlenderRelay({
  adapter, contract: globalThis.BlenderStudioContract, serverSecret: "studio-interop-server-secret-must-be-long",
  now: () => Date.now(), random: length => new Uint8Array(length).fill(seed++),
  studio: createStudioService({ contract: globalThis.BlenderStudioContract, adapter, provider }),
});

async function startServer() {
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks); let parsed;
    try { parsed = body.length ? JSON.parse(body) : null; } catch (_) { parsed = null; }
    if (parsed?.action) actions.push(parsed.action);
    try {
      const result = await relay.handle(new Request("http://127.0.0.1", { method: request.method, headers: request.headers, body: body.length ? body : undefined }));
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
    } catch (_) { response.writeHead(500, { "content-type": "application/json" }); response.end('{"error":"interop relay handler failed"}'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); check(address && typeof address === "object", "interop relay did not bind");
  return { server, endpoint: `http://127.0.0.1:${address.port}` };
}
async function post(endpoint, action, body = {}, token = `Bearer ${browserToken}`) {
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ action, projectId, ...body }) });
  return { status: response.status, json: await response.json() };
}
function runBlender(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.BLENDER_BIN || "blender", ["--background", "--factory-startup", "--python", runnerPath],
      { cwd: root, stdio: "ignore", env: { ...process.env, ...environment } });
    const timer = setTimeout(() => child.kill("SIGTERM"), 180000);
    child.once("error", error => { clearTimeout(timer); reject(new Error(error.code === "ENOENT" ? "Blender binary was not found" : "Blender could not start")); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}
async function waitForJson(file, predicate, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (fs.existsSync(file)) {
      try {
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        // A staged native failure is terminal; do not turn its useful wire
        // mismatch into a generic 90-second coordinator timeout.
        if (!predicate || predicate(value) || value?.ok === false) return value;
      } catch (_) {}
    }
    await sleep(50);
  }
  return null;
}

async function main() {
  check(fs.existsSync(runnerPath), "Studio Blender runner is missing");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cinema-machine-studio-interop-"));
  const marker = path.join(temporary, "marker.json"), command = path.join(temporary, "continue-second-shot.json");
  const zip = buildTemporaryAddon(temporary);
  const { server, endpoint } = await startServer();
  let blender;
  try {
    let result = await post(endpoint, "studio.workspace.open", { location, shot: firstShot });
    check(result.status === 200, "browser studio.workspace.open did not return a workspace envelope");
    let workspace = result.json.workspace;
    check(workspace?.shots?.some(shot => shot.id === firstShot.id),
      "studio.workspace.open did not append the supplied canonical first shot");
    writable = false;
    result = await post(endpoint, "studio.workspace.get", { locationId: location.id });
    check(result.status === 403, "role denial did not apply to Studio workspace read");
    writable = true;
    result = await post(endpoint, "pair.create", {}, `Bearer ${browserToken}`);
    check(result.status === 200 && typeof result.json.pairCode === "string", "v1 pair.create envelope changed");
    blender = runBlender({ CM_STUDIO_TEST_ENDPOINT: endpoint, CM_STUDIO_TEST_PAIR_CODE: result.json.pairCode,
      CM_STUDIO_TEST_ZIP: zip, CM_STUDIO_TEST_MARKER: marker, CM_STUDIO_TEST_COMMAND: command });
    const staged = await waitForJson(marker, value => value.stage === "saved-first-shot");
    check(staged?.ok, staged?.error || "native Studio runtime did not save its first-shot edit");
    workspace = (await post(endpoint, "studio.workspace.get", { locationId: location.id })).json.workspace;
    const savedFirstCamera = workspace?.shots?.find(shot => shot.id === firstShot.id)?.camera;
    check(savedFirstCamera, "native saved workspace omitted its canonical first shot camera");
    result = await post(endpoint, "studio.workspace.open", { location, shot: secondShot });
    check(result.status === 200, "browser could not select second canonical shot");
    workspace = result.json.workspace;
    check(workspace?.shots?.some(shot => shot.id === firstShot.id) &&
      workspace.shots.some(shot => shot.id === secondShot.id),
    "studio.workspace.open did not retain first shot and append supplied second shot");
    assert.deepEqual(workspace.shots.find(shot => shot.id === firstShot.id).camera, savedFirstCamera,
      "opening the second canonical shot replaced the manually saved first-shot camera");
    fs.writeFileSync(command, JSON.stringify({ continue: true }));
    const finished = await waitForJson(marker, value => value.stage === "finished", 90);
    check(finished?.ok, finished?.error || "native Studio interoperability proof failed");
    const child = await blender; blender = null;
    check(child.code === 0, `Blender exited before successful Studio proof (${child.code ?? child.signal})`);
    workspace = (await post(endpoint, "studio.workspace.get", { locationId: location.id })).json.workspace;
    check(workspace.previews?.length === 1, "native preview publish was not retained by the actual Studio service");
    result = await post(endpoint, "studio.preview.get", { locationId: location.id, previewId: workspace.previews[0].id });
    check(result.status === 200 && typeof result.json.pngBase64 === "string" &&
      Buffer.from(result.json.pngBase64, "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "browser preview retrieval did not return the native published PNG");
    check(actions.includes("studio.workspace.current") && actions.includes("studio.assistant.submit") &&
      actions.includes("studio.mesh.cancel") && actions.includes("studio.asset.get") && actions.includes("studio.preview.publish"),
    "packaged Studio runtime did not exercise the expected real relay actions");
    check(assistantSubmissions === 1 && meshSubmitCounts.get("make triangle") === 1,
      "same-task Meshy settlement retry submitted the provider generation more than once");
    check(authorizations >= 3 && charges === 2,
      "Studio task authorization/settlement did not reach the real fake atomic billing boundary exactly once");
    console.log("BLENDER_STUDIO_INTEROP_OK pair_v1 browser_open native_workspace proposal_apply manual_save second_shot mesh_glb preview_publish cancellation role_denial");
  } finally {
    if (blender) await blender.catch(() => {});
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
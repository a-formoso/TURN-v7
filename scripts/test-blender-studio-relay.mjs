/* Offline contract/relay checks: no provider requests, SQL, or storage writes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../app/blender-studio-contract.js";
import { createBlenderRelay } from "../supabase/functions/blender-bridge/relay-core.mjs";
import { createStudioService, validateGlb } from "../supabase/functions/blender-bridge/studio-service.mjs";
import { createSupabaseAdapter } from "../supabase/functions/blender-bridge/supabase-adapter.mjs";

const edgeSource = readFileSync("supabase/functions/blender-bridge/index.ts", "utf8");
assert.match(edgeSource, /type: "input_image", image_url: imageDataUrl/);
assert.match(edgeSource, /type: "image", source: \{ type: "base64"/);

// Production-shaped location rows use model/provenance/ISO fields, not the
// old synthetic `meta.kind: image/png` test marker.
const productionLocationId = "location-canonical";
const productionIso = "2026-01-01T00:00:00.000Z";
const productionClient = {
  from(table) {
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() {
        return table === "turn_projects"
          ? { data: { doc: { locations: [{ id: productionLocationId, name: "Reception" }],
            characters: [], props: [] } }, error: null }
          : { data: { project_id: "22222222-2222-4222-8222-222222222222", entity_id: productionLocationId,
            storage_path: "owner/studio-assets/project/location.png",
            meta: { modelId: "gpt-image-2", requestedModel: "gpt-image-2",
              prompt: "Reception", promptCompiler: "TURN prompt compiler", iso: productionIso } }, error: null };
      },
    };
    return query;
  },
  storage: { from() { return { async download() { return { data: new Blob([new Uint8Array([137,80,78,71,13,10,26,10])]), error: null }; } }; } },
};
const productionAdapter = createSupabaseAdapter({ createClient: () => productionClient, url: "https://test", anonKey: "anon", serviceKey: "service" });
assert.equal(await productionAdapter.validateStudioReference({ projectId: "22222222-2222-4222-8222-222222222222",
  entityId: productionLocationId, kind: "location", version: productionIso }), true,
"canonical location catalog + real generated provenance validates without a MIME meta.kind");

const uid = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const states = new Map(), files = new Map();
let writable = true, charges = 0, allowSpend = true, assistantImage = null,
  failNextCas = false, refuseAssistant = false, assistantCalls = 0, meshPolls = 0;
const clone = value => value == null ? value : structuredClone(value);
const adapter = {
  async getUserByAccessToken(token) { return token === "browser" ? { id: uid, email: "test@example.test" } : null; },
  async getUserById(id) { return id === uid ? { id, email: "test@example.test" } : null; },
  async getProjectAccess(pid, actor) { return pid === projectId && actor.id === uid ? { exists: true, ownerId: uid, actorId: uid, canWrite: writable } : { exists: false, canWrite: false }; },
  async getState(_p, entity) { return clone(states.get(entity)); },
  async insertState(row) { if (states.has(row.entity_id)) { const e = new Error("duplicate"); e.conflict = true; throw e; } const saved = { id: "state", ...clone(row) }; states.set(row.entity_id, saved); return clone(saved); },
  async casState(row, expected, next) { const saved = states.get(row.entity_id); if (failNextCas) { failNextCas = false; return { ok: false }; } if (!saved || JSON.stringify(saved.meta) !== JSON.stringify(expected)) return { ok: false }; saved.meta = clone(next); return { ok: true, row: clone(saved) }; },
  async authorizeCredit({ token }) { return token === "browser" && allowSpend ? { ok: true } : { ok: false, message: "insufficient" }; },
  async spendCredit({ token }) { if (token !== "browser" || !allowSpend) return { ok: false, message: "insufficient" }; charges++; return { ok: true, remaining: 50 }; },
  async uploadStudioAsset(path, bytes) { files.set(path, clone(bytes)); return { created: true }; },
  async downloadStudioAsset(path) { return clone(files.get(path)); },
  atomicStudioSettlement: true,
};
const provider = {
  available: true, models: { "claude-fable-5": true }, verifiedModels: {}, meshConfigured: true,
  async submitAssistant(input) { assistantCalls++; assistantImage = input.image || null; if (refuseAssistant) throw new Error("provider refusal"); return { summary: "Add nothing until Apply.", ops: [] }; },
  async submitMesh() { return { requestId: "fake-request" }; },
  async getMesh() { meshPolls++; return { status: "queued" }; },
};
const relay = createBlenderRelay({
  adapter, contract: {}, serverSecret: "long-test-only-server-secret-value",
  studio: createStudioService({ contract: globalThis.BlenderStudioContract, adapter, provider }),
});
async function call(action, body = {}, token = "Bearer browser") {
  const response = await relay.handle(new Request("https://relay.test", {
    method: "POST", headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify({ action, projectId, ...body }),
  }));
  return { status: response.status, json: await response.json() };
}

const openedShot = { id: "shot-1", sceneId: "scene-1", name: "Opening", camera: {
  position: [0, -5, 2], target: [0, 0, 1], focalLength: 50, sensorWidth: 36,
}, objects: [], tracks: [], frameStart: 1, frameEnd: 120, fps: 24 };
let response = await call("studio.workspace.open", { location: { id: "location-1", name: "Reception" }, shot: openedShot });
assert.equal(response.status, 200);
assert.equal(response.json.workspace.schema, "cm-studio-v1");
assert.equal(response.json.workspace.revision, 1);
assert.equal(response.json.workspace.shots.length, 1, "open appends a validated absent shot");
response = await call("studio.workspace.open", { location: { id: "location-1", name: "Reception" },
  shot: { ...openedShot, camera: { ...openedShot.camera, focalLength: 85 } } });
assert.equal(response.json.workspace.shots[0].camera.focalLength, 50, "open never overwrites an existing manual shot");
assert.equal((await call("studio.workspace.current")).json.workspace.locationId, "location-1");
assert.equal(typeof globalThis.BlenderStudioContract.applyProposal, "function");
assert.deepEqual(globalThis.BlenderStudioContract.applyProposal(response.json.workspace,
  { summary: "No-op stays explicit.", ops: [] }), response.json.workspace);

writable = false;
response = await call("studio.workspace.get", { locationId: "location-1" });
assert.equal(response.status, 403, "current project role is checked on every read");
writable = true;

const work = (await call("studio.workspace.get", { locationId: "location-1" })).json.workspace;
response = await call("studio.workspace.save", { locationId: "location-1", baseRevision: 9, mutationId: "save-1", workspace: work });
assert.equal(response.status, 409, "workspace save is CAS, not automatic merge");
work.assets.push({ id: "injected-asset", name: "Injected", kind: "glb",
  sha256: "0".repeat(64), bytes: 12, modelId: "meshy/v7/text-to-3d", rigged: false, animated: false });
response = await call("studio.workspace.save", { locationId: "location-1", baseRevision: 1, mutationId: "save-1", workspace: work });
assert.equal(response.status, 200);
assert.equal(response.json.workspace.assets.length, 0, "save cannot inject relay-owned asset metadata");

const request = { locationId: "location-1", baseRevision: 2, requestId: "assistant-1",
  modelId: "claude-fable-5", mode: "scene", prompt: "Add a safe box.", acknowledgeCost: true };
response = await call("studio.assistant.submit", request);
assert.equal(response.status, 200);
assert.equal(response.json.task.status, "completed");
response = await call("studio.assistant.submit", request);
assert.equal(response.status, 200);
assert.equal(charges, 1, "request-id duplicate does not charge/resubmit");
response = await call("studio.assistant.submit", { ...request, requestId: "assistant-image-1",
  imageDataUrl: "data:image/png;base64,AA==" });
assert.equal(response.status, 200);
assert.deepEqual([...assistantImage], [0], "validated assistant image bytes reach the provider adapter");
const beforeCasCharge = charges, beforeCasProvider = assistantCalls;
failNextCas = true;
response = await call("studio.assistant.submit", { ...request, requestId: "assistant-lost-cas" });
assert.equal(response.status, 409);
assert.equal(charges, beforeCasCharge, "initial task CAS failure cannot debit");
assert.equal(assistantCalls, beforeCasProvider, "initial task CAS failure cannot call a provider");
refuseAssistant = true;
response = await call("studio.assistant.submit", { ...request, requestId: "assistant-refused" });
assert.equal(response.status, 200);
assert.equal(response.json.task.status, "failed");
assert.equal(charges, beforeCasCharge, "provider refusal is terminal and uncharged");
refuseAssistant = false;

response = await call("studio.mesh.submit", { locationId: "location-1", requestId: "mesh-1",
  modelId: "meshy/v7/text-to-3d", prompt: "chair", name: "Chair", rigged: false,
  animated: false, acknowledgeCost: true });
assert.equal(response.status, 200);
const meshId = response.json.task.id;
response = await call("studio.mesh.get", { taskId: meshId });
assert.equal(response.status, 200);
response = await call("studio.mesh.get", { taskId: meshId });
assert.equal(response.status, 200);
assert.equal(meshPolls, 3, "poll reconciles existing upstream work without resubmitting");
response = await call("studio.mesh.cancel", { taskId: meshId });
assert.equal(response.status, 200);
assert.equal(response.json.task.status, "cancelled");

assert.throws(() => validateGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46])), /Invalid GLB/);
assert.equal((await call("studio.asset.get", { locationId: "location-1", assetId: "https-evil" })).status, 404);
allowSpend = false;
response = await call("studio.workspace.open", { location: { id: "location-2", name: "No credit" } });
assert.equal(response.status, 200);
response = await call("studio.assistant.submit", { locationId: "location-2", baseRevision: 0,
  requestId: "no-credit", modelId: "claude-fable-5", mode: "scene", prompt: "box", acknowledgeCost: true });
assert.equal(response.status, 402, "billing refusal prevents provider work");
console.log("Blender Studio relay contract tests passed.");
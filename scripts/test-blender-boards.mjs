#!/usr/bin/env node
/* BLENDER BOARDS (owner 2026-10-26: "go ahead with Blender board stills feeding the Stage"). Blender's
   Publish board renders 1-4 stills of a Studio shot through its camera and the relay stores them as
   previews named preview-board_<requestId>_<n>of<N>_f<frame> (studio.board.publish, one revision bump);
   the Stage lays the shot's newest complete board out as one page (app/blender-board.js), saves it as the
   film image blender-board-<shotId> and adds it to the clip's references with a staging-only role.
   Run: node scripts/test-blender-boards.mjs (no Blender, no network). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import "../app/blender-studio-contract.js";
import { createStudioService, boardPreviewId } from "../supabase/functions/blender-bridge/studio-service.mjs";
import { ACTIONS } from "../supabase/functions/blender-bridge/relay-core.mjs";

let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log("PASS", name); };
const U = "aaaa1111-1111-4111-8111-1111111111ff", P = "22222222-2222-4222-8222-222222222222";
const cam = { position: [0, -5, 1.6], target: [0, 0, 1.4], focalLength: 35, sensorWidth: 36 };
function png(n) {
  const bytes = new Uint8Array(24 + n); bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  return Buffer.from(bytes).toString("base64");
}
const studioState = () => ({ studio: { v: 1, current: {}, tasks: {}, workspaces: { "loc-1": {
  schema: "cm-studio-v1", projectId: P, locationId: "loc-1", name: "Harbor", parentLocationId: null, rootLocationId: "loc-1",
  revision: 3, context: { description: "", architecture: "", materials: "", staging: "", productionPlan: "" },
  objects: [], shots: [{ id: "shot-1", sceneId: "scene-1", name: "Shot 1", camera: cam, frameStart: 1, frameEnd: 48, fps: 24, objects: [], tracks: [] }],
  references: [{ entityId: "loc-1", kind: "location", label: "Harbor", version: "v1" }], assets: [], previews: [] } } } });
function harness() {
  const files = new Map();
  const adapter = {
    async validateStudioReference() { return true; },
    async uploadStudioAsset(path, bytes) { files.set(path, new Uint8Array(bytes)); return { created: true }; },
    async downloadStudioAsset(path) { return new Uint8Array(files.get(path)); },
  };
  const service = createStudioService({ contract: globalThis.BlenderStudioContract, adapter, provider: {} });
  let state = studioState(), saves = 0;
  const ctx = () => ({ kind: "device", snapshot: { state }, actor: { id: U }, access: { ownerId: U }, projectId: P,
    recheck: async () => {}, save: async (next) => { saves++; state = structuredClone(next); return { state }; } });
  const call = (body) => service.handle(new Request("https://relay.test"), body, { context: async () => ctx() });
  return { files, call, state: () => state, saves: () => saves };
}
const frames = (n, bytes = 40) => Array.from({ length: n }, (_, i) => ({ frame: 1 + i * 23, pngBase64: png(bytes), actualCamera: cam }));
const publish = (h, extra) => h.call({ action: "studio.board.publish", locationId: "loc-1", baseRevision: 3,
  requestId: "desktop_abc123", shotId: "shot-1", frames: frames(3), ...(extra || {}) });

/* ── the relay ───────────────────────────────────────────────────────────── */
await test("relay: a board of 3 frames is stored as 3 named previews in one revision, and a replay changes nothing", async () => {
  const h = harness();
  const out = await publish(h);
  assert.deepEqual(out.previews.map(p => p.id), ["preview-board_desktop_abc123_1of3_f1", "preview-board_desktop_abc123_2of3_f24",
    "preview-board_desktop_abc123_3of3_f47"]);
  assert.equal(out.revision, 4); assert.equal(h.state().studio.workspaces["loc-1"].revision, 4); assert.equal(h.saves(), 1);
  assert.ok(out.previews.every(p => p.shotId === "shot-1" && p.bytes === 64 && /^[a-f0-9]{64}$/.test(p.sha256)));
  assert.equal(h.files.size, 3);
  assert.ok([...h.files.keys()].every(k => /\/studio-previews\/.+\/loc-1\/preview-board_desktop_abc123_\dof3_f\d+\.png$/.test(k)));
  globalThis.BlenderStudioContract.validateWorkspace(h.state().studio.workspaces["loc-1"]);   // the schema didn't change
  const again = await h.call({ action: "studio.board.publish", locationId: "loc-1", baseRevision: 4, requestId: "desktop_abc123", shotId: "shot-1", frames: frames(3) });
  assert.deepEqual(again.previews.map(p => p.id), out.previews.map(p => p.id)); assert.equal(again.revision, 4); assert.equal(h.saves(), 1);
  assert.equal(boardPreviewId("r", 1, 4, 99), "preview-board_r_2of4_f99");
});
await test("relay: a stale revision, a shot from elsewhere, 0 or 5 frames, a non-PNG and an oversized board are refused", async () => {
  const refuse = async (extra, re) => { const h = harness(); await assert.rejects(() => publish(h, extra), re); assert.equal(h.files.size, 0); };
  await refuse({ baseRevision: 2 }, /changed/);
  await refuse({ shotId: "shot-9" }, /not in this workspace/);
  await refuse({ frames: [] }, /1 to 4 frames/);
  await refuse({ frames: frames(5) }, /1 to 4 frames/);
  await refuse({ frames: [{ frame: 1, pngBase64: Buffer.from("not a png at all").toString("base64"), actualCamera: cam }] }, /PNG/);
  await refuse({ frames: [{ frame: -1, pngBase64: png(4), actualCamera: cam }] }, /Invalid board frame/);
  await refuse({ requestId: "x".repeat(65) }, /request id/);
  await refuse({ frames: frames(2, 4.5 * 1024 * 1024) }, /too large/);
});
await test("relay: the action is advertised and capabilities say boards can be published", async () => {
  assert.ok(ACTIONS.includes("studio.board.publish"));
  const src = readFileSync("supabase/functions/blender-bridge/studio-service.mjs", "utf8");
  assert.ok(src.includes('boardPublish: { maxFrames: MAX_BOARD_FRAMES, maxBytes: MAX_BOARD_BYTES },'));
});

/* ── source images (2026-10-26): a 9.4 MB 2K location sheet opens Studio; models and Blender get the resized copy ── */
await test("relay: a 9.4 MB generated location opens its workspace; Blender's copy of it is the 1568 px resize", async () => {
  const big = new Uint8Array(Math.round(9.4 * 1024 * 1024)); big.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const small = new Uint8Array(2.5 * 1024 * 1024); small.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const asked = [];
  const adapter = {
    async validateStudioReference() { return true; },
    async getStudioReference(q) { asked.push(q.fitBytes || 0); return { bytes: q.fitBytes ? small : big, contentType: "image/png" }; },
    async uploadStudioAsset() { return { created: true }; },
  };
  const service = createStudioService({ contract: globalThis.BlenderStudioContract, adapter, provider: {} });
  let state = { studio: { v: 1, current: {}, tasks: {}, workspaces: {} } };
  const ctx = () => ({ kind: "browser", snapshot: { state }, actor: { id: U }, access: { ownerId: U }, projectId: P,
    recheck: async () => {}, save: async (next) => { state = structuredClone(next); return { state }; } });
  const call = (body) => service.handle(new Request("https://relay.test"), body, { context: async () => ctx() });
  const opened = await call({ action: "studio.workspace.open", location: { id: "loc-1", name: "Car deck" },
    references: [{ entityId: "loc-1", kind: "location", label: "Car deck", version: "2026-10-25T05:42:01.768Z" }] });
  assert.equal(opened.workspace.locationId, "loc-1");
  // an extra image the server can't confirm (a room-and-time plate id, an uploaded sheet) is left out, not fatal
  const strictAdapter = { ...adapter, async validateStudioReference(q) { return q.entityId !== "loc-1:night-plate"; } };
  const svc2 = createStudioService({ contract: globalThis.BlenderStudioContract, adapter: strictAdapter, provider: {} });
  let st2 = { studio: { v: 1, current: {}, tasks: {}, workspaces: {} } };
  const ctx2 = () => ({ ...ctx(), snapshot: { state: st2 }, save: async (next) => { st2 = structuredClone(next); return { state: st2 }; } });
  const opened2 = await svc2.handle(new Request("https://relay.test"), { action: "studio.workspace.open", location: { id: "loc-1", name: "Car deck" },
    references: [{ entityId: "loc-1", kind: "location", label: "Car deck", version: "v1" },
      { entityId: "loc-1:night-plate", kind: "location", label: "Night", version: "v1" }, { entityId: "c1", kind: "character", label: "Mara" }] },
    { context: async () => ctx2() });
  assert.deepEqual(opened2.workspace.references.map(r => r.entityId), ["loc-1", "c1"]);
  const badSource = createStudioService({ contract: globalThis.BlenderStudioContract, provider: {},
    adapter: { ...adapter, async validateStudioReference(q) { return q.entityId !== "loc-1"; } } });
  await assert.rejects(() => badSource.handle(new Request("https://relay.test"), { action: "studio.workspace.open", location: { id: "loc-1", name: "Car deck" },
    references: [{ entityId: "loc-1", kind: "location", label: "Car deck", version: "v1" }] }, { context: async () => ctx2() }), /authorized generated project asset/);
  const ref = await call({ action: "studio.reference.get", locationId: "loc-1", entityId: "loc-1" });
  assert.ok(ref.dataUrl.startsWith("data:image/png;base64,") && Buffer.from(ref.dataUrl.split(",")[1], "base64").length === small.length);
  assert.deepEqual(asked, [0, 0, Math.floor(4.5 * 1024 * 1024)]);   // two opens read the original, the desktop copy is the resize
  const src = readFileSync("supabase/functions/blender-bridge/supabase-adapter.mjs", "utf8");
  assert.ok(src.includes('{ transform: { width: 1568, height: 1568, resize: "contain", quality: 85 } }'));
  assert.ok(readFileSync("supabase/functions/blender-bridge/studio-service.mjs", "utf8").includes("const image=await readGeneratedImage(ctx,source,true);"));
});

/* ── the page (app/blender-board.js) ─────────────────────────────────────── */
const box = {}; box.window = box; vm.createContext(box);
vm.runInContext(readFileSync("app/blender-board.js", "utf8"), box);
const BB = box.BlenderBoards;
await test("board: ids parse; the newest COMPLETE board of the shot is used, in frame order", () => {
  assert.deepEqual({ ...BB.parsePreviewId("preview-board_desktop_ab_2of3_f24") }, { boardId: "desktop_ab", index: 2, count: 3, frame: 24 });
  assert.equal(BB.parsePreviewId("preview-desktop_ab"), null);
  assert.equal(BB.parsePreviewId("preview-board_x_4of3_f1"), null);
  const p = (id, shotId = "s1") => ({ id, shotId, actualCamera: cam });
  const previews = [p("preview-board_old_1of2_f1"), p("preview-board_old_2of2_f9"), p("preview-plain"),
    p("preview-board_new_2of3_f5"), p("preview-board_new_1of3_f1"), p("preview-board_new_3of3_f9"),
    p("preview-board_half_1of2_f1"), p("preview-board_other_1of1_f1", "s2")];
  const b = BB.latestBoard(previews, "s1");
  assert.equal(b.boardId, "new"); assert.deepEqual(Array.from(b.frames, f => f.frame), [1, 5, 9]);
  assert.equal(BB.latestBoard(previews, "s2").boardId, "other");
  assert.equal(BB.latestBoard(previews, "s3"), null);
  assert.equal(BB.slotId("s1"), "blender-board-s1"); assert.throws(() => BB.slotId("../x"));
});
await test("board: captions letter the frames start → end; the key names each coloured stand-in", () => {
  assert.deepEqual(Array.from(BB.captions([{ frame: 1 }, { frame: 24 }, { frame: 48 }])), ["A · start, frame 1", "B · frame 24", "C · end, frame 48"]);
  assert.deepEqual(Array.from(BB.captions([{ frame: 7 }])), ["A · frame 7"]);
  assert.equal(BB.colourName([0.8, 0.05, 0.03]), "red"); assert.equal(BB.colourName([0.02, 0.1, 0.7]), "blue");
  assert.equal(BB.colourName([0.05, 0.5, 0.05]), "green"); assert.equal(BB.colourName([0.5, 0.5, 0.5]), "grey");
  assert.equal(BB.colourName([0.9, 0.3, 0.0]), "orange"); assert.equal(BB.colourName([0.9, 0.75, 0.02]), "yellow");
  const shot = { objects: [{ kind: "actor", characterId: "c1", color: [0.02, 0.1, 0.7] }, { kind: "box", color: [1, 1, 1] },
    { kind: "actor", characterId: "c2", color: [0.8, 0.05, 0.03] }, { kind: "actor", characterId: "c1", color: [0, 1, 0] },
    { kind: "actor", characterId: "ghost", color: [0, 1, 0] }] };
  const key = BB.standInKey(shot, [{ id: "c1", name: "Mara" }, { id: "c2", name: "Ottavio" }]);
  assert.deepEqual(Array.from(key, k => k.name + ":" + k.colour), ["Mara:blue", "Ottavio:red"]);
  assert.equal(BB.keyText(key), "the blue stand-in is Mara; the red stand-in is Ottavio");
});

/* ── the Stage, the add-on, Frances ──────────────────────────────────────── */
const stage = readFileSync("app/stage.jsx", "utf8"), html = readFileSync("TURN.html", "utf8"), ai = readFileSync("app/ai.jsx", "utf8");
await test("stage: a saved board page rides as a reference with a staging-only role; the Stage composes newer boards", () => {
  assert.ok(stage.includes('out.push({ key:"blender-board:"+sh.id, kind:"image", group:"Blender boards",'));
  assert.ok(stage.includes('". Its grey shapes and coloured stand-ins are placeholders that only mark position.'));
  assert.ok(stage.includes("never show the stand-ins, grey shapes, letters, captions or the page itself."));
  assert.ok(stage.includes('if(had&&had.kind==="blender-board"&&had.boardId===board.boardId) return false;'));
  assert.ok(stage.includes('const r=await nbCommit(slot, dataUrl, meta, [], "shot", scope.epoch, ()=>!BP.isCurrent(scope));'));
  assert.ok(stage.includes("STAGE_STUDIO_SHOTS[id]={shots:(ws&&ws.shots)||[],previews:(ws&&ws.previews)||[],objects:(ws&&ws.objects)||[]}"));
  assert.ok(/if\(!cur\|\|readOnly\|\|!BB\|\|!BS\|\|!BP/.test(stage), "a read-only viewer never writes a board page");
  assert.ok(html.indexOf('src="app/blender-board.js?v=') > html.indexOf('src="app/blender-studio.js?v=')
    && html.indexOf('src="app/blender-board.js?v=') < html.indexOf('app/stage.jsx?v='));
  assert.ok(["20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k => html.includes('app/stage.jsx?v=' + k + '"')));
  assert.ok(ai.includes("BLENDER BOARDS (2026-10-26): in Blender, open a shot from Kinolot (Open this shot in Blender), set Board frames"));
});
await test("add-on: Publish board renders through the shot camera and publishes in one call; frames and sizes are pure maths", () => {
  const init = readFileSync("blender/kinolot_bridge/__init__.py", "utf8"), scene = readFileSync("blender/kinolot_bridge/studio_scene.py", "utf8");
  const runtime = readFileSync("blender/kinolot_bridge/studio_runtime.py", "utf8");
  assert.ok(init.includes('bl_idname = "kinolot.studio_publish_board"') && init.includes('board_row.operator(CM_OT_studio_publish_board.bl_idname, text="Publish board")'));
  assert.ok(init.includes("bpy.types.WindowManager.kinolot_studio_board_frames = IntProperty("));
  assert.ok(scene.includes('render.engine = "BLENDER_WORKBENCH"') && scene.includes("scene.frame_set(saved[\"frame\"])"));
  assert.ok(runtime.includes('self._request("board", "studio.board.publish", {') && runtime.includes('self.workspace["revision"] = revision'));
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("kinolot_studio_protocol", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cam = {"position": [0, -5, 1.6], "target": [0, 0, 1.4], "focalLength": 35, "sensorWidth": 36}
prev = lambda i: {"id": "preview-board_desktop_ab_%dof2_f%d" % (i, i), "shotId": "s1", "sha256": "a" * 64, "bytes": 10, "actualCamera": cam}
ok, rev = m.validate_board_response({"previews": [prev(1), prev(2)], "revision": 5}, "s1", 2)
bad = []
for args in [({"previews": [prev(1)], "revision": 5}, "s1", 2), ({"previews": [prev(1), prev(2)], "revision": 5}, "s2", 2), ({"previews": [prev(1), prev(2)], "revision": True}, "s1", 2)]:
    try:
        m.validate_board_response(*args); bad.append("accepted")
    except m.StudioProtocolError:
        bad.append("refused")
print(json.dumps({"frames": [m.board_frame_numbers(1, 48, 3), m.board_frame_numbers(1, 48, 4), m.board_frame_numbers(10, 10, 3), m.board_frame_numbers(1, 2, 4), m.board_frame_numbers(1, 48, 9), m.board_frame_numbers(1, 48, 1)],
  "sizes": [m.board_size(1920, 1080), m.board_size(1080, 1920), m.board_size(640, 360), m.board_size(2048, 858)], "rev": rev, "n": len(ok), "bad": bad}))
`;
  const run = spawnSync("python3", ["-c", py, "blender/kinolot_bridge/studio_protocol.py"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.deepEqual(out.frames, [[1, 24, 48], [1, 17, 32, 48], [10], [1, 2], [1, 17, 32, 48], [1]]);
  assert.deepEqual(out.sizes, [[1280, 720], [720, 1280], [640, 360], [1280, 536]]);
  assert.equal(out.rev, 5); assert.equal(out.n, 2); assert.deepEqual(out.bad, ["refused", "refused", "refused"]);
});
console.log(`${checks} passed, 0 failed`);

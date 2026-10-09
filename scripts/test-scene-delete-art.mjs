/* Art Room handoff fixes (2026-10-02):
   1. deleting a scene takes its Art Room links along — its shots, its Color preset and its
      place in props' / locations' scene lists — and Undo brings every one of them back;
      a Co-writer (Art Room read-only) keeps the old behaviour, because the server's role
      scopes refuse a writer's save of art sections.
   2. voicing a line speaks the words of the screenplay line its speaker was verified from
      (not the shot's old saved words), and the shot's saved line follows them.
   The real deleteScene / undoDeleteScene / resolveLineSpeaker / voiceOneLine source from
   app/app.jsx runs here against small stand-ins for App's state. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app = readFileSync("app/app.jsx", "utf8");
const slice = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  assert.ok(a > 0 && b > a, "missing " + from);
  return app.slice(a, b);
};
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};

/* ---- 1. scene delete ---- */
const deleteSrc = slice("  const deleteScene = async (id)=>{", "  const reorderScenes");
function sceneHarness({ artReadOnly = false } = {}) {
  const S = {
    scenes: [{ id: "s1", no: 1 }, { id: "s2", no: 2, title: "Vault" }, { id: "s3", no: 3 }],
    beatsMap: { s2: { rows: [{ n: 1 }] } }, drafts: { s2: { blocks: [] } }, history: {}, continuityMap: {},
    shots: [{ id: "a", sceneId: "s1" }, { id: "b", sceneId: "s2" }, { id: "c", sceneId: "s2" }, { id: "d", sceneId: "s3" }],
    project: { title: "Film", styleBible: { presets: [{ id: "p1" }], sceneStyles: { s1: "p1", s2: "p1" } } },
    props: [{ id: "key", scenes: ["s1", "s2", "s3"] }, { id: "gun", scenes: ["s3"] }, { id: "hat" }],
    locations: [{ id: "vault", scenes: ["s2"] }, { id: "street", scenes: ["s1", "s3"] }],
    deletedScene: null, selId: "s2", confirms: [],
    trash: { shots: [] },   // (2026-10-09) a deleted scene's shots also go to Recently deleted
  };
  const setter = (k) => (v) => { S[k] = typeof v === "function" ? v(S[k]) : v; };
  const env = {
    S, currentProjectId: "film-1", canMutateWritersRoom: () => true, _trashStamp: (x) => ({ ...x, _deletedAt: "t" }),
    artRoomReadOnlyRef: { current: artReadOnly },
    renum: (ss) => ss.map((s, i) => ({ ...s, no: i + 1 })),
    // (2026-10-09, Writers' Room third pass) the delete reads the film as it is after the question
    scenesRef: { get current() { return S.scenes; } }, draftsRef: { get current() { return S.drafts; } },
    shotsRef: { get current() { return S.shots; } },
    liveStoryRef: { get current() { return { beatsMap: S.beatsMap, history: S.history, continuityMap: S.continuityMap }; } },
    setDeletedScenes: (f) => { S.deletedScenes = f(S.deletedScenes || (S.deletedScene ? [S.deletedScene] : [])); S.deletedScene = S.deletedScenes[0] || null; },
    window: { appConfirm: async (o) => { S.confirms.push(o); return true; } },
  };
  ["scenes", "beatsMap", "drafts", "history", "continuityMap", "shots", "project", "props", "locations", "deletedScene", "selId", "trash"]
    .forEach((k) => { env["set" + k[0].toUpperCase() + k.slice(1)] = setter(k); });
  // every render reads the latest state, as App's closures do
  const run = (body) => new Function(...Object.keys(env),
    "const {scenes,beatsMap,drafts,history,continuityMap,shots,project,props,locations,deletedScene}=S;\n" + deleteSrc + "\n" + body
  )(...Object.values(env));
  return { S, del: (id) => run("return deleteScene(" + JSON.stringify(id) + ");"), undo: () => run("return undoDeleteScene();") };
}

await test("1a deleting a scene removes its shots, its Color preset and its place in props' and locations' scene lists", async () => {
  const h = sceneHarness();
  await h.del("s2");
  assert.deepEqual(h.S.scenes.map((s) => s.id), ["s1", "s3"]);
  assert.deepEqual(h.S.shots.map((s) => s.id), ["a", "d"]);
  assert.deepEqual(h.S.project.styleBible.sceneStyles, { s1: "p1" });
  assert.deepEqual(h.S.props.map((p) => p.scenes), [["s1", "s3"], ["s3"], undefined]);
  assert.deepEqual(h.S.locations.map((l) => l.scenes), [[], ["s1", "s3"]]);
  assert.match(h.S.confirms[0].body, /version history, and its 2 shots in the Art Room\. You can undo/);
});

await test("1b Undo brings the shots, the Color preset and the scene-list places back where they were", async () => {
  const h = sceneHarness();
  const before = JSON.parse(JSON.stringify({ shots: h.S.shots, project: h.S.project, props: h.S.props, locations: h.S.locations }));
  await h.del("s2");
  h.undo();
  assert.deepEqual(h.S.scenes.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(h.S.shots.map((s) => s.id).sort(), before.shots.map((s) => s.id).sort());
  assert.deepEqual(h.S.project, before.project);
  assert.deepEqual(h.S.props, before.props);
  assert.deepEqual(h.S.locations, before.locations);
});

await test("1c a Co-writer's delete leaves the Art Room as it is (the server refuses their art sections)", async () => {
  const h = sceneHarness({ artReadOnly: true });
  await h.del("s2");
  assert.deepEqual(h.S.shots.map((s) => s.id), ["a", "b", "c", "d"]);
  assert.deepEqual(h.S.props[0].scenes, ["s1", "s2", "s3"]);
  assert.deepEqual(h.S.locations[0].scenes, ["s2"]);
  assert.doesNotMatch(h.S.confirms[0].body, /shot/);
  // the Color preset lives in 'project', which both roles may write
  assert.deepEqual(h.S.project.styleBible.sceneStyles, { s1: "p1" });
  h.undo();
  assert.deepEqual(h.S.project.styleBible.sceneStyles, { s1: "p1", s2: "p1" });
});

await test("1d a scene with no shots says nothing about shots", async () => {
  const h = sceneHarness();
  h.S.shots = h.S.shots.filter((s) => s.sceneId !== "s2");
  await h.del("s2");
  assert.doesNotMatch(h.S.confirms[0].body, /shot/);
});

/* ---- 2. voicing ---- */
const voiceSrc = slice("  const resolveLineSpeaker = (shot)=>{", "  const voiceLine = async");
function voiceHarness(lines) {
  const calls = [], patches = [];
  const env = {
    scenes: [{ id: "s1" }],
    drafts: {},
    characters: [{ id: "neo", name: "Neo", voiceLock: { voiceId: "v-neo" } }, { id: "tri", name: "Trinity", voiceLock: { voiceId: "v-tri" } }],
    currentProjectId: "film-1",
    stageBeatDialogueLines: () => lines,
    characterMediaOptions: () => ({}),
    updateShot: (id, patch) => patches.push({ id, patch }),
    window: {
      elGenerate: async (id, text, opts) => { calls.push({ id, text, voiceId: opts.voiceId }); return { durationMs: 1500 }; },
      vgDeliveryModelOf: () => "m1",
    },
  };
  const voiceOneLine = new Function(...Object.keys(env), voiceSrc + "\nreturn voiceOneLine;")(...Object.values(env));
  return { calls, patches, voice: voiceOneLine };
}
const voiceShot = (h, shot) => h.voice(shot);

await test("2a a shot tied to a screenplay line by index voices that line's CURRENT words, in its speaker's voice", async () => {
  // the script changed line 0 from Neo's "I know kung fu." to Trinity's "Show me."
  const h = voiceHarness([{ text: "Show me.", speaker: "TRINITY", speakerId: "tri" }]);
  const r = await voiceShot(h, { id: "sh1", sceneId: "s1", beatN: 1, dialogue: "I know kung fu.", screenplayDialogueIndex: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(h.calls, [{ id: "sh1", text: "Show me.", voiceId: "v-tri" }]);
  assert.equal(h.patches[0].patch.dialogue, "Show me.", "the shot's saved line follows the screenplay");
  assert.equal(h.patches[0].patch.lineAudio.text, "Show me.");
});

await test("2b an unchanged line voices the screenplay's exact words and leaves the shot's line alone", async () => {
  const h = voiceHarness([{ text: "I know kung fu.", speaker: "NEO", speakerId: "neo" }]);
  await voiceShot(h, { id: "sh1", sceneId: "s1", beatN: 1, dialogue: "I know kung fu." });
  assert.deepEqual(h.calls, [{ id: "sh1", text: "I know kung fu.", voiceId: "v-neo" }]);
  assert.equal("dialogue" in h.patches[0].patch, false);
});

await test("2c a shot with its own saved line row voices that row's words", async () => {
  const h = voiceHarness([]);
  await voiceShot(h, { id: "sh1", sceneId: "s1", beatN: 1, dialogue: "old words",
    dialogueLines: [{ text: "Dodge this.", speaker: "TRINITY", speakerId: "tri" }] });
  assert.deepEqual(h.calls, [{ id: "sh1", text: "Dodge this.", voiceId: "v-tri" }]);
  assert.equal(h.patches[0].patch.dialogue, "Dodge this.");
});

await test("2d a line whose speaker can't be verified is still refused before anything is paid for", async () => {
  const h = voiceHarness([{ text: "Something else.", speaker: "NEO", speakerId: "neo" }]);
  await assert.rejects(voiceShot(h, { id: "sh1", sceneId: "s1", beatN: 1, dialogue: "I know kung fu." }), /can’t verify who speaks/);
  assert.equal(h.calls.length, 0);
});

await test("2e a shot with no line is skipped", async () => {
  const h = voiceHarness([]);
  assert.deepEqual(await voiceShot(h, { id: "sh1", sceneId: "s1", dialogue: "  " }), { skipped: true });
  assert.equal(h.calls.length, 0);
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

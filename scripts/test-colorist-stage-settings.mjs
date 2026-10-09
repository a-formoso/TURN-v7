/* Art Room fixes 7 and 8 (owner 2026-10-02):
   7. the Colorist's references follow ONE rule (colorRefsFor): the Lookbook's colorist brief
      until the user takes the Color tab's field over, then their text. The write-through fills
      the field with it and the Colorist reads it through the same helper, so a Colorist step
      right after a Lookbook change reads the new brief before the write-through's render lands.
   8. the Stage's visual source, video model and clip scope are saved with the film
      (project.stage); a film with no choice starts from the device's last one; a read-only
      viewer's pick and an automatic plan-gate switch are never saved. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = (f) => readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};

/* ---- 7 ---- */
const app = read("app/app.jsx");
const helperSrc = app.slice(app.indexOf("  const colorRefsFor = (sb, lb, note)=>{"), app.indexOf("  /* Write-through: the Presets (Colorist)"));
const colorRefsFor = new Function("lookbookBriefFor", "mergeLookbookIntoRefs", helperSrc + "\nreturn colorRefsFor;")(
  (dept, lb, note) => "Overall look: " + lb.map((c) => c.title).join(", ") + (note ? " | " + note : ""),
  (refs) => refs);

await test("7a the references are the Lookbook's brief until the user takes the field over", () => {
  const lb = [{ title: "sodium streetlight" }, { title: "wet tarmac" }];
  assert.deepEqual({ ...colorRefsFor({}, lb, "") }, { refs: "sodium streetlight, wet tarmac", brief: "sodium streetlight, wet tarmac", owned: false });
  // the field still holds the last auto-fill: a new Lookbook replaces it
  const sb = { refs: "sodium streetlight", lookbookSynced: "sodium streetlight" };
  assert.equal(colorRefsFor(sb, lb, "").refs, "sodium streetlight, wet tarmac");
  // the user edited the field: their text wins whatever the Lookbook says
  const mine = { refs: "Roger Deakins, Skyfall", lookbookSynced: "sodium streetlight" };
  assert.deepEqual({ ...colorRefsFor(mine, lb, "") }, { refs: "Roger Deakins, Skyfall", brief: "sodium streetlight, wet tarmac", owned: true });
});

await test("7b the write-through and the Colorist both use it; the contradicting comment is gone", () => {
  assert.ok(app.includes("const { refs:next, brief } = colorRefsFor(sb, lookbook, lookbookNote);"));
  assert.ok(app.includes("return { refs:String(colorRefsFor(sb, lookbook, lookbookNote).refs||\"\").trim(), refImages:sb.refImages||[] }; },"));
  assert.ok(app.includes("return window.aiAssignSceneStyles(scenes, seed, drafts, { ...project, styleBible:{ ...((project&&project.styleBible)||{}), refs } }); },"));
  assert.ok(!app.includes("No write-through: the Colorist reads the lookbook LIVE"));
});

/* ---- 8 ---- */
const stage = read("app/stage.jsx"), ast = parseSync(stage, { sourceType: "script", presets: ["@babel/preset-react"] });
const S = { console }; S.window = S; vm.createContext(S);
for (const n of ["_stageFilm", "_stageSavedSource"]) {
  const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === n);
  vm.runInContext(stage.slice(node.start, node.end), S);
}
await test("8a a film's saved visual source wins; a film without one starts from the device's", () => {
  let dev = "halves";
  S.localStorage = { getItem: () => dev };
  assert.equal(S._stageSavedSource({ stage: { visualSource: "shots" } }), "shots");
  assert.equal(S._stageSavedSource({}), "halves");
  dev = null;
  assert.equal(S._stageSavedSource({ stage: { visualSource: "bogus" } }), "shots");
});

await test("8b every pick is saved with the film (and as the device default); read-only never saves", () => {
  assert.ok(stage.includes('if(!readOnly && typeof onStageSettings==="function") onStageSettings(patch);'));
  // (2026-10-09, Stage third pass) nothing set the film's visual source any more — each clip picks its own;
  // the saved one is still read (8a) for thumbnails, posters and the next clip's end frame
  assert.ok(!stage.includes("saveFilmStage({ visualSource:next });") && stage.includes("const [visualSource, _setVisualSource] = React.useState(()=>_stageSavedSource(project));"));
  assert.ok(stage.includes("saveFilmStage({ modelId:id }); },[saveFilmStage]);"));
  assert.ok(stage.includes('saveFilmStage({ clipScope: next==="legacy"?"auto":next }); },[saveFilmStage]);'));
  // the film's model and scope are read first
  assert.ok(stage.includes('const f = _stageFilm(project, "modelId");'));
  assert.ok(stage.includes('const f = _stageFilm(project, "clipScope");'));
  // and followed when they change elsewhere
  assert.ok(stage.includes("React.useEffect(()=>{ if(_fModel && SEEDANCE_MODELS.some(m=>m.id===_fModel && m.status===\"active\")) _setModelId(_fModel); },[_fModel]);"));
});

await test("8c the plan gate's automatic model switch stays local", () => {
  assert.ok(stage.includes("if(ok){ setModelId(ok.id, { local:true });"));
  assert.match(stage, /const setModelId = React\.useCallback\(\(id, opts\)=>\{ _setModelId\(id\);\s*if\(opts && opts\.local\) return;/);
});

await test("8d the app saves the Stage's settings into the film, only for those who may change it", () => {
  assert.ok(app.includes("onStageSettings:(patch)=>{ if(!canMutateSharedFilm()) return;"));
  assert.ok(app.includes("setProject(p=>({ ...p, stage:{ ...((p&&p.stage)||{}), ...patch } })); },"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

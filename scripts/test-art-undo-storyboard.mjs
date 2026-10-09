/* Art Room fixes 5 and 6 (owner 2026-10-02):
   5. Art Room agent runs can be undone: one step per run, snapshotted just before the run's
      first write (a refreshed Coordinator context shares its run), only for runs started from
      an agent panel; Undo asks, then restores the Art Room's specs; a film switch drops other
      films' steps; every Art Room agent panel (not the Production check) offers it.
   6. storyboard page ids stay positional, but a composed sheet records the shots it drew and
      each saved half the shots in its row; a sheet or half whose page now holds other shots is
      out of date — the tab offers Recompose and the Stage leaves it out (frames instead). */
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
const load = (box, file, names) => {
  const src = read(file), ast = parseSync(src, { sourceType: "script", presets: ["@babel/preset-react"] });
  for (const n of names) {
    const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === n);
    assert.ok(node, "missing " + n + " in " + file); vm.runInContext(src.slice(node.start, node.end), box);
  }
};

/* ---- 6. storyboards ---- */
const B = { console }; B.window = B; vm.createContext(B);
load(B, "app/storyboard.jsx", ["sbPaginateBeats", "sbPageRanges", "sbIdsEqual", "sbHalfShotIds", "sbFramesChanged", "sbSheetVersionOf", "sbSheetStale", "sbHalfStale"]);
vm.runInContext("var SB_PAGE_SIZE = 4;", B);
B.sbSheetStale = B.sbSheetStale; B.sbHalfStale = B.sbHalfStale; B.sbPageRanges = B.sbPageRanges;

await test("6a a sheet is out of date when its page now holds other shots; older sheets by panel count", () => {
  assert.equal(B.sbSheetStale({ composed: true, shotIds: ["a", "b", "c", "d"] }, ["a", "b", "c", "d"]), false);
  assert.equal(B.sbSheetStale({ composed: true, shotIds: ["a", "b", "c", "d"] }, ["x", "a", "b", "c"]), true, "a shot added before the page");
  assert.equal(B.sbSheetStale({ composed: true, panels: 4 }, ["a", "b", "c"]), true, "an older sheet: a different panel count");
  assert.equal(B.sbSheetStale({ composed: true, panels: 4 }, ["a", "b", "c", "d"]), false, "an older sheet with the same count can't be told apart");
  assert.equal(B.sbSheetStale({ model: "upload" }, ["a"]), false, "an uploaded board isn't checked");
  assert.equal(B.sbSheetStale(null, ["a"]), false);
});
await test("6b a half covers its row; a half without ids follows its sheet", () => {
  assert.deepEqual([...B.sbHalfShotIds(["a", "b", "c", "d"], "top")], ["a", "b"]);
  assert.deepEqual([...B.sbHalfShotIds(["a", "b", "c", "d"], "bottom")], ["c", "d"]);
  assert.equal(B.sbHalfStale({ shotIds: ["a", "b"] }, ["a", "b", "x", "y"], "top"), false, "the top row didn't change");
  assert.equal(B.sbHalfStale({ shotIds: ["c", "d"] }, ["a", "b", "x", "y"], "bottom"), true);
  assert.equal(B.sbHalfStale({ kind: "sheet-half" }, ["a", "b", "c"], "top", { composed: true, panels: 4 }), true);
});
await test("6c composing and saving halves record the shots", () => {
  const sb = read("app/storyboard.jsx");
  assert.ok(sb.includes("panels:(page.shots||[]).length, shotIds:(page.shots||[]).map(x=>x.id),") && sb.includes("frameVersions:sbFrameVersions(page.shots), ...extra, missing:missingAtDraw, ts:Date.now(), iso:new Date().toISOString() };"));
  // (2026-10-09) halves record the SHEET's own shots; a sheet showing a deleted frame is out of date too
  assert.ok(sb.includes("shotIds: sbHalfShotIds(_ids, half),"));
  assert.ok(sb.includes("const sheetOutOfDate = !!(gen.genUrl && isComposed && (sbSheetStale(_smNow, shotIds) || frameGone));"));
  assert.ok(sb.includes("The shots on this page changed since this sheet was composed, so it shows the wrong panels."));
  assert.ok(sb.includes("const halvesCurrent = !halvesStale && "), "out-of-date halves can be re-saved");
});

const S = { console }; S.window = S; vm.createContext(S);
load(S, "app/stage.jsx", ["stagePageRanges", "storyboardClipIds", "storyboardClipAssets"]);
S.sbPageRanges = B.sbPageRanges; S.sbSheetStale = B.sbSheetStale; S.sbHalfStale = B.sbHalfStale;
const shot = (id, beatN, order) => ({ id, sceneId: "s1", beatN, order });
await test("6d the Stage leaves out a board drawn from other shots and says why; a current one is used", () => {
  const meta = {};
  S.nbGetMeta = (id) => meta[id] || null;
  const page0 = "sbsheet-sbpage-s1-2x2-0";
  // the sheet and its halves were made from a, b, c, d
  meta[page0] = { composed: true, shotIds: ["a", "b", "c", "d"] };
  meta[page0 + ":half-top"] = { kind: "sheet-half", shotIds: ["a", "b"] };
  meta[page0 + ":half-bottom"] = { kind: "sheet-half", shotIds: ["c", "d"] };
  const imgs = { [page0]: "sheet.png", [page0 + ":half-top"]: "top.png", [page0 + ":half-bottom"]: "bottom.png" };
  S.__sbShots = [shot("a", 1, 1), shot("b", 1, 2), shot("c", 2, 3), shot("d", 2, 4)];
  const clip = { scene: { id: "s1" }, g: { index: 0, start: 0, shots: S.__sbShots } };
  let a = S.storyboardClipAssets(clip, imgs);
  assert.equal(a.sheet, "sheet.png"); assert.equal(a.top, "top.png"); assert.deepEqual([...a.stale], []);
  // a shot is added at the front of the scene: page 0 now holds x, a, b, c
  S.__sbShots = [shot("x", 1, 0), ...S.__sbShots];
  a = S.storyboardClipAssets({ ...clip, g: { ...clip.g, shots: S.__sbShots.slice(0, 4) } }, imgs);
  assert.equal(a.sheet, ""); assert.equal(a.top, ""); assert.equal(a.halves.length, 0);
  assert.ok(a.stale.includes(page0) && a.stale.includes(page0 + ":half-top"));
});

/* ---- 5. Art undo ---- */
const app = read("app/app.jsx");
await test("5a one undo step per run, taken just before its first write, for panel runs only", () => {
  assert.ok(app.includes("const artAgentCtxFactory = ({ input, emit, propose, cancelled, agentName, force, owner, run:runIn })=>{"));
  assert.ok(app.includes("const run = runIn || { snap:null };"));
  assert.ok(app.includes('if(run.snap || typeof propose!=="function") return;'));
  assert.match(app, /takeArtSnap\(\);\s*return fn\(\.\.\.args\);/, "the snapshot comes before the write");
  assert.ok(app.includes("const ctxArgs = { input, emit, propose, cancelled, agentName, force, owner:ownerProjectId, run };"), "a refreshed Coordinator context shares its run");
  assert.ok(app.includes("setArtUndo(st=> [...st, snap].slice(-8));"));
});
await test("5b the snapshot holds the Art Room's specs, and Undo puts every one back", () => {
  for (const k of ["characters: items(L.characters)", "props: items(L.props)", "locations: items(L.locations)", "lookbook: items(L.lookbook)",
    "lookbookApplied: { ...(L.lookbookApplied||{}) }", "shots: items(L.shots)", "styleBible: sb ? JSON.parse(JSON.stringify(sb)) : undefined"]) assert.ok(app.includes(k), k);
  const undo = app.slice(app.indexOf("const undoLastArtAgent = async ()=>{"), app.indexOf("const artUndoProps = "));
  for (const k of ["setCharacters(", "setProps(", "setLocations(", "setLookbook(", "setLookbookNote(", "setLookbookApplied(", "setShots(", "setProject(", "setPropsSeeded(", "setLocsSeeded("]) assert.ok(undo.includes(k), k);
  assert.ok(undo.includes("if(artUndoAskingRef.current || artRoomReadOnlyRef.current) return;"));
  assert.ok(undo.includes("if(!ok || top()!==snap || agentFilmKey()!==k || artRoomReadOnlyRef.current) return;"));
  assert.ok(undo.includes("Sheets and frames it rendered stay \\u2014 each keeps its earlier versions in its history."));
});
await test("5c every Art Room agent panel offers Undo; the Production check (Writers' context) doesn't", () => {
  for (const id of ["colorist", "shotdesigner", "casting", "propsmaster", "locscout", "researcher", "coordinator"]) {
    const i = app.indexOf('initialAgentId:"' + id + '"');
    assert.ok(app.slice(i, i + 900).includes("issues:{}, ...artUndoProps,"), id);
  }
  const p = app.indexOf('initialAgentId:"production"');
  assert.ok(app.slice(p, p + 400).includes("issues:{}, undoCount:0,"));
});
await test("5d a film switch drops other films' steps; the Art Room shows its own Undo notice", () => {
  assert.match(app, /const k = agentFilmKey\(\);\s*setArtUndo\(st=> st\.some\(x=>!x \|\| x\.filmKey!==k\) \? st\.filter\(x=>x && x\.filmKey===k\) : st\);\s*\},\[currentProjectId\]\);/);
  assert.ok(app.includes('room==="art" && !artRoomReadOnly && artUndoHere.length>0 && React.createElement("div",{className:"agent-undo art-undo"'));
  assert.ok(app.includes('" changed the Art Room"'));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

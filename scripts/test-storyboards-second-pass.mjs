#!/usr/bin/env node
/* The Storyboards tab, second pass (owner 2026-10-05: "go ahead with all of it") — does the board
   reach the Stage correctly?
   A  re-rendered frames: sheets and halves record each panel's frame version; a changed frame dates
      them (a cold cache never does; an older sheet keeps the shot-id check); halves cut from an older
      sheet are out of date for the Stage too
   B  the Stage uses only the clip's own panels: a half / a sheet only when every panel on it is the
      clip's and together they cover it; one missing half = no halves; older per-clip boards only
      when they record exactly the clip's shots
   C  uploads are kept by Compose all / Compose Scene; Clear takes the halves with it; Restore keeps
      the pair together; Apply to panel needs ⌘/Ctrl+Enter; view-only never writes; the export says
      and marks out-of-date sheets and reads sheets as they are now; the dead layout branch is gone
   D  Frances knows
     node scripts/test-storyboards-second-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
const fn = (src, name)=>{ const i = src.indexOf("function "+name+"("); assert.ok(i>=0, name); return src.slice(i, src.indexOf("\n}\n", i)+3); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const sb = read("app/storyboard.jsx"), stage = read("app/stage.jsx"), ai = read("app/ai.jsx");

/* the real storyboard helpers */
const box = { console, setTimeout, clearTimeout, Promise, JSON, Object, Array, String, Number, Math, Date, Set,
  React:new Proxy({}, { get:(t,k)=> k==="createElement" ? ()=>null : noop }), CustomEvent:class {},
  localStorage:{ getItem:()=>null, setItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  document:{ addEventListener:noop, removeEventListener:noop }, dispatchEvent:()=>true };
box.window = box; vm.createContext(box);
vm.runInContext(transformSync(sb, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
let frameMeta = {};
box.nbGetMeta = (id)=> frameMeta[id] || null;

/* ═══ A ═══ */
await test("A1 a sheet records its panels' frame versions; a re-rendered frame dates it", ()=>{
  frameMeta = { a:{ iso:"1", version:1 }, b:{ iso:"2", version:3 } };
  const fv = box.sbFrameVersions([{ id:"a" }, { id:"b" }]);
  assert.deepEqual(J(fv), ["a@1#1", "b@2#3"]);
  const meta = { composed:true, shotIds:["a","b"], frameVersions:fv };
  assert.equal(box.sbSheetStale(meta, ["a","b"]), false);
  frameMeta.b = { iso:"9", version:4 };
  assert.equal(box.sbSheetStale(meta, ["a","b"]), true, "b was re-rendered");
  delete frameMeta.b;
  assert.equal(box.sbSheetStale(meta, ["a","b"]), false, "a cold cache is never a false alarm");
  assert.equal(box.sbSheetStale({ composed:true, shotIds:["a","b"] }, ["a","b"]), false, "an older sheet keeps the shot-id check alone");
  assert.equal(box.sbSheetStale({ model:"upload" }, ["a"]), false);
});
await test("A2 halves: their own frame versions, and cut from an older sheet = out of date", ()=>{
  frameMeta = { a:{ iso:"1", version:1 }, b:{ iso:"2", version:1 } };
  const sheet = { composed:true, shotIds:["a","b","c"], iso:"S2" };
  const half = { sourceVersion:"S2", shotIds:["a","b"], frameVersions:box.sbFrameVersions([{ id:"a" }, { id:"b" }]) };
  assert.equal(box.sbHalfStale(half, ["a","b","c"], "top", sheet), false);
  assert.equal(box.sbHalfStale({ ...half, sourceVersion:"S1" }, ["a","b","c"], "top", sheet), true, "cut from an older sheet");
  frameMeta.a = { iso:"7", version:2 };
  assert.equal(box.sbHalfStale(half, ["a","b","c"], "top", sheet), true, "its panel's frame changed");
  assert.equal(box.sbSheetVersionOf({ iso:"X", ts:5 }), "X");
});

/* ═══ B: the Stage's real mapping ═══ */
const st = { console, Object, Array, String, Number, Math, Set, JSON }; st.window = st; vm.createContext(st);
st.sbPageRanges = box.sbPageRanges; st.sbSheetStale = box.sbSheetStale; st.sbHalfStale = box.sbHalfStale;
vm.runInContext(fn(stage, "stagePageRanges")+fn(stage, "stageBoardPanelIndex")+fn(stage, "storyboardClipIds")+fn(stage, "storyboardClipAssets"), st);
const scene = { id:"sc" };
// one page: beats 1-4 — a, b, c, d (one keyframe per beat: since 2026-10-09 the board draws each beat's main keyframe only)
const shots = [{ id:"a", sceneId:"sc", beatN:1, order:1 }, { id:"b", sceneId:"sc", beatN:2, order:2 }, { id:"c", sceneId:"sc", beatN:3, order:3 }, { id:"d", sceneId:"sc", beatN:4, order:4 }];
st.__sbShots = shots;
const P = "sbsheet-sbpage-sc-2x2-0";
const all = { [P]:"sheet", [P+":half-top"]:"top", [P+":half-bottom"]:"bottom" };
const metas = { [P]:{ composed:true, shotIds:["a","b","c","d"], iso:"V" },
  [P+":half-top"]:{ sourceVersion:"V", shotIds:["a","b"] }, [P+":half-bottom"]:{ sourceVersion:"V", shotIds:["c","d"] } };
st.nbGetMeta = (id)=> metas[id] || null;
const clip = (start, ids)=>({ scene, g:{ start, index:0, shots:ids.map(id=>({ id })) } });
await test("B1 a 2-shot clip across the page's middle gets no halves and no sheet (it used to get 4 panels)", ()=>{
  const r = st.storyboardClipAssets(clip(1, ["b","c"]), all);
  assert.equal(r.halves.length, 0); assert.equal(r.top, ""); assert.equal(r.bottom, ""); assert.equal(r.sheet, "");
});
await test("B2 a clip that is exactly one half gets that half; the whole page gets the sheet and both halves", ()=>{
  const r = st.storyboardClipAssets(clip(0, ["a","b"]), all);
  assert.deepEqual(J(r.halves.map(h=>h.id)), [P+":half-top"]); assert.equal(r.sheet, "", "the page also holds c and d");
  const w = st.storyboardClipAssets(clip(0, ["a","b","c","d"]), all);
  assert.equal(w.sheet, "sheet"); assert.equal(w.halves.length, 2);
});
await test("B3 one half missing = no halves (the missing one used to be dropped silently)", ()=>{
  const r = st.storyboardClipAssets(clip(0, ["a","b","c","d"]), { [P]:"sheet", [P+":half-top"]:"top" });
  assert.equal(r.halves.length, 0); assert.equal(r.sheet, "sheet");
});
await test("B4 a clip across two pages uses no sheet", ()=>{
  const six = shots.concat([{ id:"e", sceneId:"sc", beatN:4, order:5 }, { id:"f", sceneId:"sc", beatN:5, order:6 }]);
  st.__sbShots = six;
  const P1 = "sbsheet-sbpage-sc-2x2-1";
  metas[P1] = { composed:true, shotIds:["e","f"], iso:"W" };
  const r = st.storyboardClipAssets(clip(2, ["c","d","e"]), { ...all, [P1]:"sheet2" });
  assert.equal(r.sheet, ""); assert.equal(r.pages.length, 0);
  st.__sbShots = shots;
});
await test("B5 an older per-clip board counts only when it records exactly the clip's shots", ()=>{
  const L = "sbsheet-sbclip-sc-0";
  metas[L] = { shotIds:["b","c"] };
  assert.equal(st.storyboardClipAssets(clip(1, ["b","c"]), { [L]:"legacy" }).sheet, "legacy");
  metas[L] = {};
  assert.equal(st.storyboardClipAssets(clip(1, ["b","c"]), { [L]:"legacy" }).sheet, "", "no record → not used");
});

/* ═══ C ═══ */
await test("C1 Compose all / Compose Scene keep uploaded boards, and say how many", ()=>{
  const jobs = between(sb, "const composeJobs = async (jobs, onProgress)=>{", "const reportComposeRun");
  assert.ok(jobs.includes('if(hasImg && had && (had.uploaded || had.mode==="upload" || !had.composed)){ out.kept++; continue; }'));
  assert.ok(sb.includes('" uploaded sheet"+(out.kept===1?"":"s")+" kept as "'));
});
await test("C2 Clear takes the halves; Restore keeps the pair; Apply to panel needs ⌘/Ctrl+Enter", ()=>{
  const clear = between(sb, "const clearSheet = async ()=>{", "await loadHalves(); };");
  assert.ok(clear.includes('for(const h of ["top","bottom"]){ try{ await nbClearAsset(sid+":half-"+h); }catch(e){ halvesFailed = true; } }'))   // both, always (2026-10-09);
  const restore = between(sb, "const restoreHalf = async (h)=>{", "const deleteHalf");
  assert.ok(restore.includes('const other = h==="top" ? "bottom" : "top";') && restore.includes('nbRevertAsset(sid+":half-"+other, 0)'));
  assert.ok(sb.includes('if(e.key==="Enter" && (e.metaKey||e.ctrlKey)){ e.preventDefault(); applyPanelEdit(); }'));
  assert.ok(!/if\(e\.key==="Enter"\) applyPanelEdit\(\)/.test(sb));
});
await test("C3 view-only never writes a board; an open out-of-date sheet redraws itself once", ()=>{
  const comp = between(sb, "function StoryboardComposite({", "\nfunction StoryboardPage(");
  assert.ok(comp.includes("onUpdateShot, readOnly=false, bulkBusy=false }){") && comp.includes("!panelBusyRef.current && !readOnlyRef.current"));
  assert.ok(comp.includes("if(readOnly) return;   // a view-only viewer never writes a board"));
  assert.ok(comp.includes("if(readOnly || staleTried.current || composing || !ready.n || !gen.genUrl || !isComposed) return;") && comp.includes("if(sbRestoreHeld(projectId, sid, page)) return;") && comp.includes("if(!(sbFramesChanged(_m) || (_m && Array.isArray(_m.shotIds) && !sbIdsEqual(_m.shotIds, shotIds)))) return;"));
  assert.ok(read("app/artroom.jsx").includes("setArtView,onUpdateShot,readOnly})") && sb.includes("onView:setView,jumpToShot,onUpdateShot,readOnly,bulkBusy:!!composingAll||!!sceneBusy})));"));
  assert.ok(sb.includes("disabled:readOnly||!!composingAll||!!composingScene||!totalSheets"));
});
await test("C4 the export: out-of-date sheets asked about and marked; sheets read as they are now", ()=>{
  const ex = between(sb, "async function exportStoryboard(", "\nwindow.exportStoryboard");
  assert.ok(ex.includes('outOfDateN ? outOfDateN+"/"+readiness.total+" out-of-date sheets (recompose them \\u2014 free)" : ""'));
  assert.ok(ex.includes("(readiness.partial || readiness.missing || outOfDateN || _totParts.length)"));
  assert.ok(ex.includes('const now = (typeof nbGetImage==="function") ? nbGetImage(k) : (frames[k]||"");'));
  assert.ok(ex.includes('"out of date \\u2014 recompose it in the Storyboards tab"'));
});
await test("C5 the compose stamps its own version (the halves record exactly it); the dead layout branch is gone", ()=>{
  assert.ok(sb.includes("frameVersions:sbFrameVersions(page.shots), ...extra, missing:missingDrawn, ts:Date.now(), iso:new Date().toISOString() };"));
  assert.ok(sb.includes("sbSaveHalves(dataUrl, sid, page, sbSheetVersionOf(meta), _ep, meta)"));
  assert.deepEqual(J(box.sbGridShape(3, "2x2")), { cols:2, rows:2 }); assert.ok(!/N<=4 \? 2 : 3/.test(sb));
});

/* ═══ D ═══ */
await test("D1 Frances knows", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Storyboards (Art Room)")||{}).what || "";
  for(const re of [/ONLY THE CLIP'S OWN PANELS/, /every panel on it belongs to that clip/, /records the version of every panel's frame/,
    /UPLOADED BOARDS are kept/, /'Clear' removes the sheet's saved halves/, /restores both halves together/, /⌘\/Ctrl\+Enter/, /view-only access never writes a board/]) assert.ok(re.test(w), String(re));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

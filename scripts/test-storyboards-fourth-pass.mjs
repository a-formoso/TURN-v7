#!/usr/bin/env node
/* The Storyboards tab, fourth pass (2026-10-09, owner — Storyboards review: "all of it") — the reviewer's
   findings B1–B10, the five "differently" items, the upload-halves decision, the small fixes, and the
   storyboard ↔ Stage bridge (geometry review G3–G8).
   B1  a frame that won't load is retried once, then counted missing; such a sheet saves no halves
   B2  a restored version stays (remounts, Delete current) until a frame changes after it
   B3  upload / Clear failures and the upload spinner show; Clear waits for the sheet's own clear
   B4  the panel edit's price is the edit's own (engine, quality, format, references)
   B5  a refused "Save halves" shows on the sheet's strip, halves or not
   B6  Clear / Replace with upload are off while the sheet is drawn; a Clear mid-run ends that run
   B7  every halves write belongs to the film it was pressed in
   B8  read-only roles page, view and export the board; changing controls stay off
   B9  the export prints each sheet at its own shape, light on paper
   B10 a deleted frame dates its sheet and is named
   D   up-to-date / restored sheets left alone; panel edit by shot id; explicit joins; out-of-date counted;
       export health on the full scene list
   U   uploads get halves only when shaped like a 2×2 sheet
   S   small fixes
   G   the Stage maps clips to the board by beat
     node scripts/test-storyboards-fourth-pass.mjs */
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
const tick = ()=> new Promise(r=>setTimeout(r, 0));
const sb = read("app/storyboard.jsx"), stage = read("app/stage.jsx"), art = read("app/artroom.jsx");
const comp = between(sb, "function StoryboardComposite({", "function StoryboardPage({");
const view = between(sb, "function StoryboardView({", "window.StoryboardView = StoryboardView;");
const exp = between(sb, "async function exportStoryboard(", "\nwindow.exportStoryboard");

/* the real storyboard module in a vm, with a store, a canvas and an event bus stubbed */
const listeners = {};
let store = {}, metas = {}, imgs = {}, ep = 1, commits = [];
const box = { console, setTimeout, clearTimeout, Promise, JSON, Object, Array, String, Number, Math, Date, Set, Map, RegExp, Error,
  React:new Proxy({}, { get:(t,k)=> k==="createElement" ? ()=>null : noop }),
  CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
  localStorage:{ getItem:()=>null, setItem:noop },
  sessionStorage:{ getItem:(k)=> (k in store ? store[k] : null), setItem:(k,v)=>{ store[k] = String(v); }, removeItem:(k)=>{ delete store[k]; } },
  addEventListener:(t,f)=>{ (listeners[t] = listeners[t] || []).push(f); }, removeEventListener:noop,
  dispatchEvent:(e)=>{ (listeners[e.type]||[]).forEach(f=>f(e)); return true; },
  URL:{ createObjectURL:()=>"blob:x", revokeObjectURL:noop },
  document:{ addEventListener:noop, removeEventListener:noop,
    createElement:()=>({ width:0, height:0, getContext:()=>new Proxy({ measureText:(t)=>({ width:String(t).length*7 }) },
      { get:(t,k)=> k in t ? t[k] : noop, set:()=>true }), toDataURL:()=>"data:image/jpeg;base64,SHEET" }) } };
box.window = box; vm.createContext(box);
// an image decodes unless its url says "bad"
box.Image = class { set src(u){ this._u = u; } get src(){ return this._u; } decode(){ return /bad/.test(this._u) ? Promise.reject(new Error("decode")) : Promise.resolve(); }
  get naturalWidth(){ return 1600; } get naturalHeight(){ return 900; } };
vm.runInContext(transformSync(sb, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
const reset = ()=>{ store = {}; metas = {}; imgs = {}; ep = 1; commits = [];
  box.nbGetMeta = (id)=> metas[id] || null; box.nbGetImage = (id)=> imgs[id] || ""; box.nbLoadImage = async (id)=> imgs[id] || "";
  box.nbEpoch = ()=> ep; delete box.nbRefreshImage;
  box.nbCommit = async (id, url, meta, refs, kind, e)=>{ if(e!=null && e!==ep) return { tier:"stale" }; commits.push({ id, url, meta }); metas[id] = meta; imgs[id] = url; return { tier:"cloud", url }; }; };
const page = { id:"sbpage-sc-2x2-0", shots:[{ id:"f0", beatN:1 }, { id:"f1", beatN:2 }] };
const SID = "sbsheet-sbpage-sc-2x2-0";

/* ═══ B1 ═══ */
await test("B1 a frame that won't load is retried once through nbRefreshImage; the draw reports what it really painted", async ()=>{
  reset();
  imgs = { f0:"data:good0", f1:"data:bad1" };
  let refreshed = [];
  box.nbRefreshImage = async (id, failed)=>{ refreshed.push([id, failed]); return "data:good-again"; };
  let out = await box.composeStoryboardSheet({ no:1 }, page, {}, {});
  assert.deepEqual(refreshed, [["f1","data:bad1"]]); assert.equal(out.missing, 0); assert.deepEqual(J(out.refreshed), ["f1"]);
  assert.match(out.dataUrl, /^data:image\/jpeg/);
  // still unreadable after the retry → drawn as "Frame not generated" AND counted
  box.nbRefreshImage = async ()=> "data:bad-again";
  out = await box.composeStoryboardSheet({ no:1 }, page, {}, {});
  assert.equal(out.missing, 1, "a frame that exists but can't be drawn counts as missing");
});
await test("B1 the coordinator records the real count and never saves halves for it; the fresh link isn't a frame change", async ()=>{
  reset();
  imgs = { f0:"data:good0", f1:"data:bad1" }; metas = { f0:{ iso:"1", version:1 }, f1:{ iso:"1", version:1 } };
  let n = 0;
  box.nbRefreshImage = async (id)=>{ n++; imgs[id] = "data:bad-fresh"+n; return imgs[id]; };   // a new link each time, still unreadable
  const res = await box.sbComposeSheet({ no:1 }, page, {}, {}, { explicit:true });
  await tick(); await tick();
  assert.equal(res.status, "composed"); assert.equal(n, 1, "one retry — the refreshed link doesn't loop the redraw");
  const sheet = commits.find(c=>c.id===SID); assert.equal(sheet.meta.missing, 1);
  assert.ok(!commits.some(c=>/:half-/.test(c.id)), "no halves from a sheet with a placeholder panel");
  const sh = between(comp, "  const saveHalves = async ()=>{", "  // THE TWO HALVES STAY A PAIR");
  assert.ok(sh.includes("if(_sm && _sm.composed && Number(_sm.missing)>0){"), "a manual Save halves refuses it too");
  assert.ok(stage.includes("return !!(sm && sm.composed && Number(sm.missing)>0);"), "the Stage's partial check reads it");
});

/* ═══ B2 ═══ */
await test("B2 a restored version is held across remounts until a frame changes after it; a compose ends the hold", async ()=>{
  reset();
  metas = { f0:{ iso:"1", version:1 }, f1:{ iso:"1", version:1 } };
  box.sbMarkRestored("p1", SID, page);
  assert.equal(box.sbRestoreHeld("p1", SID, page), true);
  assert.equal(box.sbRestoreHeld("p2", SID, page), false, "per film");
  metas.f1 = { iso:"2", version:2 };
  assert.equal(box.sbRestoreHeld("p1", SID, page), false, "a frame re-rendered after the restore");
  assert.ok(comp.includes("onReverted: ()=>{ sbMarkRestored(projectId, sid, pageRef.current); } });"));
  assert.ok(comp.includes("if(sbRestoreHeld(projectId, sid, page)) return;") && !comp.includes("restoredRef"));
  assert.ok(sb.includes("try{ sessionStorage.removeItem(sbRestoreKey(projectId, sid)); }catch(e){}   // a new sheet ends a restore's hold"));
  const del = between(art, "  const deleteCurrentAndPromote = async ()=>{", "  /* one-tap");
  assert.ok(del.includes('if(typeof opts.onReverted==="function"){ try{ opts.onReverted(r); }catch(e){} }'), "Delete current holds too");
});

/* ═══ B3 ═══ */
await test("B3 upload / Clear errors and the upload spinner show; Clear waits for the sheet's clear before the halves", ()=>{
  assert.ok(comp.includes('const stripErr = composeErr || halvesErr || actionErr || gen.genErr || "";'));
  assert.ok(comp.includes('gen.gening ? "Uploading sheet…" : "Composing sheet…"') && comp.includes("(composing||panelBusy||gen.gening) && gen.genUrl"));
  const cl = between(comp, "  const clearSheet = async ()=>{", "await loadHalves(); };");
  const a = cl.indexOf("const cleared = await gen.clearGen();"), b = cl.indexOf("if(!cleared){"), c = cl.indexOf("await nbClearAsset(sid+\":half-\"+h)"), d = cl.indexOf('"sb-sheet-cleared"');
  assert.ok(a>0 && b>a && c>b && d>c, "await clearGen → stop on failure → halves → event");
  assert.ok(cl.includes("halves couldn't be deleted"));
});

/* ═══ B4 ═══ */
await test("B4 the panel edit's price uses what the edit sends", ()=>{
  assert.ok(comp.includes("const { model:requestedModel, quality:requestedQuality } = panelEditEngine();"));
  assert.ok(comp.includes("window.nbCostChip(1, { model:engine.model, quality:engine.quality,\n            aspect:sheetAsp, refs:1+editRefSel.length })"));
  assert.ok(comp.includes("{ referenceImage:frame, aspectRatio:sheetAsp, model:requestedModel, quality:requestedQuality,"));
  const ig = read("app/imagegen.jsx");
  assert.ok(ig.includes("opts.aspect || opts.aspectRatio") && ig.includes("opts.quality == null ? nbGetOaiQuality(model) : opts.quality") && ig.includes("Number(opts.refs)>0"), "the option names nbCostChip reads");
});

/* ═══ B5 / B6 / B7 ═══ */
await test("B5 a refused Save halves shows on the strip even when halves exist; the old halves-only line is gone", ()=>{
  assert.ok(comp.includes("stripErr && !composing && !halvesBusy &&") && !comp.includes("(halvesErr && !(halves.top||halves.bottom))"));
  assert.ok(!comp.includes("halvesOpen && halvesErr &&"));
});
await test("B6 Clear / Replace are off while drawn; a Clear made while a run draws ends it without a commit", async ()=>{
  assert.ok(comp.includes("const sheetBusy = !!(composing || bulkBusy || panelBusy || gen.gening);"));
  assert.ok(comp.includes('className:"sheet-tools-item danger",disabled:sheetBusy,') && comp.includes('className:"sheet-tools-item",disabled:sheetBusy,'));
  assert.ok(comp.includes("if(busyNow()){ setActionErr(\"This sheet is being composed"));
  reset(); imgs = { f0:"data:a", f1:"data:b" };
  const res = await box.sbComposeSheet({}, page, {}, {}, { explicit:true }, async ()=>{ store["turn_sb_hold_"+SID] = "1"; return "data:x"; });
  assert.equal(res.status, "cleared"); assert.equal(commits.length, 0);
});
await test("B7 Save halves, restore, delete and Clear capture the film at the click", ()=>{
  const sh = between(comp, "  const saveHalves = async ()=>{", "  // THE TWO HALVES STAY A PAIR");
  assert.ok(sh.includes("const _ep = filmEpoch();") && sh.includes("await sbSaveHalves(gen.genUrl, sid, page, sheetVersion(), _ep, _sm, sheetAsp);"));
  const rh = between(comp, "  const restoreHalf = async (h)=>{", "  const deleteHalf");
  assert.ok(rh.includes("const _ep = filmEpoch();") && (rh.match(/if\(!sameFilm\(\)\) return;/g)||[]).length>=4);
  const dh = between(comp, "  const deleteHalf = async (h)=>{", "  // ---- self-derivation");
  assert.ok(dh.includes("const _ep = filmEpoch();") && dh.includes("if(_ep!=null && filmEpoch()!==_ep) return;"));
  const cl = between(comp, "  const clearSheet = async ()=>{", "await loadHalves(); };");
  assert.ok((cl.match(/if\(_ep!=null && filmEpoch\(\)!==_ep\) return;/g)||[]).length===2);
});

/* ═══ B8 ═══ */
await test("B8 the Storyboards tab is outside the inert boundary; its changing controls are off for read-only", ()=>{
  // (2026-10-09, owner — Breakdown review) the Breakdown is viewable by read-only roles too
  assert.ok(art.includes('const viewableTab = !lockedView && ((artView==="storyboard" && !!window.StoryboardView) || (artView==="breakdown" && !!window.BreakdownView));'));
  assert.ok(art.includes('inert:rootInert?"":undefined') && art.includes('inert:(readOnly && (lockedView || viewableTab))?"":undefined'));
  assert.ok(view.includes('_sbEl("div",{inert:readOnly?"":undefined,"aria-disabled":readOnly?"true":undefined}, _sbEl(NbKeyBar,null), _sbEl(NbControls,null)),'));
  for(const s of ['!readOnly && _sbEl("button",{className:"sheet-tools-item",onClick:()=>{ setDetailsOpen(true);',
    '!readOnly && _sbEl("button",{className:"sheet-tools-item danger",', '!readOnly && _sbEl("button",{className:"sb-half-btn",onClick:()=>restoreHalf(h),',
    '!readOnly && _sbEl("button",{className:"sb-half-btn danger",onClick:()=>deleteHalf(h),', '!readOnly && _sbEl("div",{className:"sb-sheet-err-acts"},',
    "panelEdit && gen.genUrl && !readOnly &&", "detailsOpen && !readOnly && ReactDOM.createPortal("])
    assert.ok(comp.includes(s), s);
  assert.ok(comp.includes(': readOnly\n          ? _sbEl("div",{className:"sb-comp-empty",style:{cursor:"default"}},'), "no Compose / Upload choices for read-only");
  assert.ok(view.includes('disabled:readOnly||!!composingAll||!!composingScene||!totalSheets,onClick:composeAll,') && view.includes("disabled:!!composingAll||!!composingScene||!!readOnly,"));
  // still usable: the pager, the jump menu, export, the lightbox, View full and the halves' view buttons
  assert.ok(view.includes('_sbEl("button",{className:"art-draftall ghost",disabled:!readySheets,') && comp.includes('className:"sb-half-view"'));
});

/* ═══ B9 / B10 ═══ */
await test("B9 the export sizes each image to its sheet and prints light", ()=>{
  assert.ok(exp.includes("'.sheet-img img{width:100%;height:auto;display:block;}'") && !exp.includes("object-fit:contain") && !exp.includes("aspect-ratio:"));
  assert.ok(exp.includes("'@media print{body{margin:10mm;background:#fff;color:#111;}'"));
});
await test("B10 a deleted frame dates its sheet (and halves) and the banner says it was deleted", ()=>{
  reset();
  metas = { f0:{ iso:"1", version:1 } };
  const meta = { composed:true, shotIds:["f0","f1"], frameVersions:["f0@1#1","f1@1#1"], missing:0 };
  assert.equal(box.sbSheetStale(meta, ["f0","f1"]), false, "a cold frame is never a false alarm");
  box.dispatchEvent(new box.CustomEvent("nb-gen-done", { detail:{ id:"f1", ids:["f1"], url:"" } }));   // the store cleared it
  assert.equal(box.sbSheetStale(meta, ["f0","f1"]), true);
  assert.equal(box.sbHalfStale({ shotIds:["f0","f1"], frameVersions:["f0@1#1","f1@1#1"] }, ["f0","f1"], "top", null), true);
  assert.equal(box.sbSheetStale({ ...meta, frameVersions:["f0@1#1","f1@#"] }, ["f0","f1"]), false, "a frame missing when drawn isn't a change");
  ep = 2; assert.equal(box.sbSheetStale(meta, ["f0","f1"]), false, "per film");
  ep = 1; box.dispatchEvent(new box.CustomEvent("nb-gen-done", { detail:{ id:"f1", url:"data:new" } }));
  assert.equal(box.sbFrameGone("f1"), false, "made again → forgotten");
  assert.ok(comp.includes("A panel\u2019s frame was deleted since this sheet was composed"));
});

/* ═══ D ═══ */
await test("Da automatic and bulk runs leave an up-to-date and a restored sheet alone; Recompose draws", async ()=>{
  reset();
  imgs = { f0:"data:a", f1:"data:b", [SID]:"data:sheet" }; metas = { f0:{ iso:"1", version:1 }, f1:{ iso:"1", version:1 },
    [SID]:{ composed:true, shotIds:["f0","f1"], frameVersions:["f0@1#1","f1@1#1"], missing:0 } };
  let draws = 0; const draw = async ()=>{ draws++; return "data:x"; };
  assert.equal((await box.sbComposeSheet({}, page, {}, {}, null, draw)).status, "current");
  metas[SID] = { ...metas[SID], frameVersions:["f0@0#0","f1@1#1"] };   // out of date — but restored by you
  box.sbMarkRestored("p1", SID, page);
  assert.equal((await box.sbComposeSheet({}, page, { project:{ id:"p1" } }, {}, null, draw)).status, "held");
  assert.equal(draws, 0);
  assert.equal((await box.sbComposeSheet({}, page, { project:{ id:"p1" } }, {}, { explicit:true }, draw)).status, "composed");
  assert.equal(store["turn_sb_restored_p1:"+SID], undefined, "Recompose ends the hold");
  assert.ok(view.includes('else if(res.status==="current") out.current++;') && view.includes('else if(res.status==="held") out.held++;'));
});
await test("Db the panel edit tracks its shot by id", ()=>{
  assert.ok(comp.includes("const sh = (page.shots||[]).find(x=>String(x.id)===String(panelEdit.shotId));"));
  assert.ok(comp.includes("onClick:()=>{ setPanelEdit(p=>({ ...p, shotId:sh.id })); setPanelErr(\"\"); }}") && !comp.includes("panelEdit.idx"));
  assert.ok(comp.includes("That panel isn't on this page any more"));
});
await test("Dc an explicit Recompose that meets a running automatic run is never dropped", async ()=>{
  reset();
  imgs = { f0:"data:a", f1:"data:b" }; metas = { [SID]:{ uploaded:true, mode:"upload" } };
  let release; box.nbLoadImage = async (id)=>{ if(id===SID){ await new Promise(r=>{ release = r; }); return "data:upload"; } return imgs[id]||""; };
  let draws = 0; const draw = async ()=>{ draws++; return "data:x"+draws; };
  const auto = box.sbComposeSheet({}, page, {}, {}, null, draw);
  await tick();
  const mine = box.sbComposeSheet({}, page, {}, {}, { explicit:true }, draw);
  release();
  const [a, b] = await Promise.all([auto, mine]);
  assert.equal(b.status, "composed", JSON.stringify({ a, b })); assert.ok(draws>=1);
});
await test("Dd out-of-date sheets are counted on their own, never as complete", ()=>{
  const pages = [{ pages:[{ id:"a", shots:[{ id:"1" }] }, { id:"b", shots:[{ id:"2" }] }, { id:"c", shots:[{ id:"3" }] }] }];
  const m = { "sbsheet-a":{ composed:true, shotIds:["1"], missing:0 }, "sbsheet-b":{ composed:true, shotIds:["9"], missing:0 } };
  assert.deepEqual(J(box.sbStoryboardReadiness(pages, { "sbsheet-a":"u", "sbsheet-b":"u" }, id=>m[id])), { complete:1, partial:0, missing:1, total:3, stale:1 });
  assert.ok(view.includes('(readiness.stale ? " \\u00b7 "+readiness.stale+" out of date" : "")'), "(2026-10-24) the status line, in words");
});
await test("De the export's health check runs on the scene's full shot list", async ()=>{
  reset();
  imgs = { f0:"data:a" }; metas = { f0:{ iso:"1" } };
  let chainLen = null; box.shotChainStatus = (sh, chain)=>{ chainLen = chain.length; return "ok"; };
  const health = vm.runInContext("sbBoardHealth", box);
  await health([{ scene:{ id:"sc" }, pages:[page] }], { sc:[...page.shots, { id:"alt" }, { id:"alt2" }] });
  assert.equal(chainLen, 4);
  assert.ok(view.includes("exportStoryboard(pagesByScene, frames, project, shotsByScene)"));
  delete box.shotChainStatus;
});

/* ═══ U ═══ */
await test("U an upload gets halves only when shaped like a composed 2×2 sheet (±10%)", ()=>{
  const L = box.sbSheetLayout("16:9");
  assert.equal(box.sbUploadShapeOk(L.W, L.H, "16:9"), true);
  assert.equal(box.sbUploadShapeOk(Math.round(L.W*1.08), L.H, "16:9"), true);
  assert.equal(box.sbUploadShapeOk(1920, 1080, "16:9"), false, "a single 16:9 frame isn't a sheet");
  assert.equal(box.sbUploadShapeOk(0, 0, "16:9"), null);
  const save = between(sb, "async function sbSaveHalves(url, sid, page, sourceVersion, _ep, sheetMeta, aspect){", "\n}\n");
  assert.ok(save.includes("if(sbUploadShapeOk(img.naturalWidth||img.width, img.naturalHeight||img.height, asp)===false){"));
  assert.ok(sb.includes('const SB_UPLOAD_SHAPE_MSG = "Halves aren\\u2019t made from this upload \\u2014 its shape isn\\u2019t a 2\\u00d72 sheet.";'));
  assert.ok(comp.includes("uploadShapeOff && _sbEl(\"div\",{className:\"sb-halves-err\"}, _sbEl(Icon.alert,{s:12}), SB_UPLOAD_SHAPE_MSG),"));
});

/* ═══ S ═══ */
await test("S small fixes: no empty bottom half, panels counted, missing sheets labelled, honest links, a11y, file name", ()=>{
  assert.deepEqual(J(box.sbHalvesFor(2)), ["top"]); assert.deepEqual(J(box.sbHalvesFor(3)), ["top","bottom"]);
  assert.ok(comp.includes("const shownHalves = halfNames.filter(h=>halves[h]);"));
  assert.ok(view.includes('boardN+" panel"+(boardN!==1?"s":"")'));
  assert.ok(exp.includes("'<div class=\"ph\">No sheet yet</div>'") && exp.includes("in about an hour. Export again later"));
  assert.ok(comp.includes('const sheetAlt = "Scene "+scene.no+" storyboard, page "+((page.index||0)+1);') && comp.includes("alt:sheetAlt,"));
  assert.ok(comp.includes('"aria-label":"Change to "+sbPanelLabel(panelShot)+"\'s frame",'));
  assert.ok(comp.includes("onBlur:(e)=>{ if(menuOpen && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false); }"));
  assert.ok(comp.includes('if(typeof window.appToast==="function") window.appToast("Scene "+scene.no+" storyboard \u2014 "+msg'));
  assert.ok(view.includes("if(readOnlyRef.current){ out.stopped = true; break; }"));
  assert.equal(box.sbExportFileName("東京物語"), "東京物語-storyboard.html");
  assert.equal(box.sbExportFileName("The Matrix: Reloaded"), "The-Matrix-Reloaded-storyboard.html");
  assert.equal(box.sbExportFileName(""), "film-storyboard.html");
});

/* ═══ G ═══ */
const st = { console, Object, Array, String, Number, Math, Set, JSON }; st.window = st; vm.createContext(st);
st.sbPageRanges = box.sbPageRanges; st.sbBoardShots = box.sbBoardShots; st.sbSheetStale = box.sbSheetStale; st.sbHalfStale = box.sbHalfStale;
vm.runInContext(fn(stage, "stagePageRanges")+fn(stage, "stageBoardPanelIndex")+fn(stage, "storyboardClipIds")+fn(stage, "storyboardClipAssets")+fn(stage, "stageSheetPanelMeta"), st);
// default grouping: a multi-shot clip is one beat; only the beat's first shot is on the board
const SH = [{ id:"k1", sceneId:"sc", beatN:1, order:1 }, { id:"k1b", sceneId:"sc", beatN:1, order:2 }, { id:"k2", sceneId:"sc", beatN:2, order:3 },
  { id:"k2b", sceneId:"sc", beatN:2, order:4 }, { id:"k3", sceneId:"sc", beatN:3, order:5 }];
st.__sbShots = SH;
await test("G3 a clip maps to the board by BEAT, so the Stage can use a one-beat clip's half", ()=>{
  const ids = st.storyboardClipIds({ scene:{ id:"sc" }, g:{ start:0, index:0, shots:[SH[0], SH[1]] } });
  assert.equal(ids.offBoard, false); assert.deepEqual(J(ids.clipPanelIds), ["k1"]);
  assert.deepEqual(J(ids.halves), ["sbsheet-sbpage-sc-2x2-0:half-top"]);
  const two = st.storyboardClipIds({ scene:{ id:"sc" }, g:{ start:1, index:1, shots:[SH[1], SH[2], SH[3]] } });
  assert.deepEqual(J(two.clipPanelIds), ["k1","k2"]); assert.deepEqual(J(two.halves), ["sbsheet-sbpage-sc-2x2-0:half-top"]);
  // the half holds exactly the clip's beat panels → the Stage uses it
  st.nbGetMeta = ()=> null;
  const assets = st.storyboardClipAssets({ scene:{ id:"sc" }, g:{ start:1, index:1, shots:[SH[1], SH[2], SH[3]] } }, { "sbsheet-sbpage-sc-2x2-0:half-top":"data:top" });
  assert.equal(assets.top, "data:top");
  // a half holding another beat's panel too is not used for a one-beat clip
  const one = st.storyboardClipAssets({ scene:{ id:"sc" }, g:{ start:0, index:0, shots:[SH[0], SH[1]] } }, { "sbsheet-sbpage-sc-2x2-0:half-top":"data:top" });
  assert.equal(one.top, "", "the top half also shows beat 2");
});
await test("G5–G8 the Stage: off-board wording, board pages loaded, beat panel positions, a reused take's source checked", ()=>{
  assert.ok(stage.includes("sourcePlan.offBoard?\" — this clip's beats aren't on the storyboard\":sourcePlan.halvesStale?"));
  assert.ok(stage.includes("const total = stagePageRanges(boardShots).length;"));
  const m = st.stageSheetPanelMeta({ start:1, shots:[SH[1]] }, 0, { id:"sc" });
  assert.deepEqual([m.page, m.panel, m.half], [1, 1, "top"], "an alternative's position is its beat's panel");
  const none = st.stageSheetPanelMeta({ start:0, shots:[{ id:"zz" }] }, 0, { id:"sc" });
  assert.equal(none.page, null);
  assert.ok(sb.includes("Promise.resolve(sbSaveHalves(dataUrl, sid, page, sbSheetVersionOf(meta), _ep, meta))"), "G8 the automatic halves crop the local canvas");
  assert.ok(stage.includes("if(srcAvailable(m.source)) setSourceOverride(m.source);") && stage.includes("isn\\u2019t available for this clip now, so it uses Auto."));
});

await test("F Frances knows the pass (the Stage finds panels by beat); keys", ()=>{
  const ai = read("app/ai.jsx"), html = read("TURN.html");
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  const w = fb.__F.find(f=>f.name==="Storyboards (Art Room)").what;
  assert.ok(!w.includes("The Stage finds a clip's panels by its shots, so a clip with an alternative uses its own frames."));
  for(const now of ["The Stage finds a clip's panels by its BEATS", "A FRAME THAT WON'T LOAD", "A RESTORED VERSION STAYS", "READ-ONLY ROLES AND STAGE EDITORS can page",
    "Halves aren't made from this upload", "THE EXPORT prints each sheet at its own shape"]) assert.ok(w.includes(now), now);
  for(const f of ["storyboard", "artroom", "stage", "ai", "script"]) assert.ok(["20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f);
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

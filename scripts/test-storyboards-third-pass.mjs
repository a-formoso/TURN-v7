#!/usr/bin/env node
/* The Storyboards tab, third pass (owner 2026-10-09: "go ahead with all of it") — does it tell the truth?
   A  one keyframe per beat: the board, the Stage (by shot id) and the Breakdown agree; panels say "Beat N"
   B  halves record what their sheet was drawn from; Save halves refuses a stale sheet; partial sheets never
      reach the Stage; a deleted frame dates a sheet; shot changes redraw once
   C  your work stays: uploads kept (and stamped), restores held, Clear honest, film-scoped composes
   D  the panel edit: asks for approved frames, no resend, rights, off while out of date; the jump to Shots
   E  copy, accessibility, Frances
     node scripts/test-storyboards-third-pass.mjs */
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
const sb = read("app/storyboard.jsx"), stage = read("app/stage.jsx"), bd = read("app/breakdown.jsx"), art = read("app/artroom.jsx"),
  app = read("app/app.jsx"), ai = read("app/ai.jsx"), shots = read("app/shots.jsx"), css = read("app/styles.css");

/* the real storyboard helpers */
const box = { console, setTimeout, clearTimeout, Promise, JSON, Object, Array, String, Number, Math, Date, Set,
  React:new Proxy({}, { get:(t,k)=> k==="createElement" ? ()=>null : noop }), CustomEvent:class {},
  localStorage:{ getItem:()=>null, setItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  document:{ addEventListener:noop, removeEventListener:noop }, dispatchEvent:()=>true };
box.window = box; vm.createContext(box);
vm.runInContext(fn(shots, "shotPrimaryOf")+"\n;window.shotPrimaryOf=shotPrimaryOf;", box);
vm.runInContext(transformSync(sb, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
let metas = {}, imgs = {};
box.nbGetMeta = (id)=> metas[id] || null; box.nbGetImage = (id)=> imgs[id] || "";

/* ═══ A ═══ */
const SH = [{ id:"a", sceneId:"sc", beatN:1, order:1, keyframeMode:"beat-opening" }, { id:"a2", sceneId:"sc", beatN:1, order:1.5 },
  { id:"b", sceneId:"sc", beatN:2, order:2 }, { id:"c", sceneId:"sc", beatN:3, order:3, keyframeMode:"beat-opening" }, { id:"c0", sceneId:"sc", beatN:3, order:2.9 },
  { id:"u", sceneId:"sc", order:9 }];
await test("A1 the board draws each beat's main keyframe (Shots' rule); unnumbered shots are kept; panels say 'Beat N'", ()=>{
  assert.deepEqual(J(box.sbBoardShots(SH)).map(s=>s.id), ["a","b","c","u"]);
  assert.equal(box.sbPanelLabel({ beatN:3 }), "Beat 3");
  assert.ok(sb.includes("pages: sbPaginateBeats(sbBoardShots(shotsByScene[scene.id]||[])).map("));
  assert.ok(!sb.includes('"Frame not generated — Shot "+scene.no') && sb.includes('g.fillText(sbPanelLabel(sh), x+CELL_W-12, sy+22);'));
  assert.ok(bd.includes("const board = (typeof window.sbBoardShots===\"function\") ? window.sbBoardShots(ordered2) : ordered2;"));
});
await test("A2 the Stage finds a clip's panels on the board BY BEAT (owner 2026-10-09); an alternative maps to its beat's panel", ()=>{
  const st = { console, Object, Array, String, Number, Math, Set, JSON }; st.window = st; vm.createContext(st);
  st.sbPageRanges = box.sbPageRanges; st.sbBoardShots = box.sbBoardShots; st.sbSheetStale = box.sbSheetStale; st.sbHalfStale = box.sbHalfStale;
  vm.runInContext(fn(stage, "stagePageRanges")+fn(stage, "stageBoardPanelIndex")+fn(stage, "storyboardClipIds"), st);
  st.__sbShots = SH;
  const scene = { id:"sc" };
  const ok = st.storyboardClipIds({ scene, g:{ start:0, index:0, shots:[{ id:"a" }, { id:"b" }] } });
  assert.deepEqual(J(ok.pages), ["sbsheet-sbpage-sc-2x2-0"]); assert.deepEqual(J(ok.halves), ["sbsheet-sbpage-sc-2x2-0:half-top"]);
  assert.equal(ok.offBoard, false);
  // (2026-10-09, owner decision — Storyboards geometry review) a2 is beat 1's alternative: it maps to beat 1's
  // panel (a), so the clip is ON the board — it used to be marked off the board and never got a half
  const alt = st.storyboardClipIds({ scene, g:{ start:1, index:0, shots:[{ id:"a2" }, { id:"b" }] } });
  assert.equal(alt.offBoard, false); assert.deepEqual(J(alt.clipPanelIds), ["a","b"]);
  assert.deepEqual(J(alt.halves), ["sbsheet-sbpage-sc-2x2-0:half-top"]);
  const later = st.storyboardClipIds({ scene, g:{ start:3, index:1, shots:[{ id:"c" }, { id:"u" }] } });
  assert.deepEqual(J(later.halves), ["sbsheet-sbpage-sc-2x2-0:half-bottom"], "c and u are the board's 3rd and 4th panels");
});

/* ═══ B ═══ */
await test("B1 halves record what the SHEET was drawn from; an upload's halves record no frame versions", ()=>{
  const save = between(sb, "async function sbSaveHalves(url, sid, page, sourceVersion, _ep, sheetMeta, aspect){", "\n}\n");
  assert.ok(save.includes("const _ids = Array.isArray(_sm.shotIds) ? _sm.shotIds : ((page&&page.shots)||[]).map(x=>x.id);"));
  assert.ok(save.includes("const _fv = Array.isArray(_sm.frameVersions) ? _sm.frameVersions : ((_sm.uploaded || _sm.mode===\"upload\") ? null :"));
  assert.ok(save.includes("shotIds: sbHalfShotIds(_ids, half),") && !save.includes("sbHalfShotIds(((page&&page.shots)||[]).map(x=>x.id), half)"));
  assert.ok(sb.includes("sbSaveHalves(dataUrl, sid, page, sbSheetVersionOf(meta), _ep, meta)"));
  const sh = between(sb, "  const saveHalves = async ()=>{", "  // THE TWO HALVES STAY A PAIR");
  assert.ok(sh.includes("if(_sm && sbSheetStale(_sm, (page.shots||[]).map(x=>x.id))){") && sh.includes("Recompose it first (free)"));
});
await test("B2 every compose records its missing panels; the Stage and Breakdown never treat a partial sheet as ready", ()=>{
  const cs = between(sb, "function sbComposeSheet(scene, page, ctx, beatsMap, extraMeta, _drawFn){", "window.sbComposeSheet = sbComposeSheet;");
  assert.ok(cs.includes("const missingAtDraw = (page.shots||[]).filter(") && cs.includes("...extra, missing:missingDrawn,") && cs.includes("typeof drawn.missing===\"number\") ? drawn.missing : missingAtDraw"));
  assert.ok(!sb.includes("{ missing: readyRef.current.total-readyRef.current.n"), "the card no longer passes a guess");
  assert.ok(stage.includes("const partial = !m && (()=>{ const sm = metaOf(id); return !!(sm && sm.composed && Number(sm.missing)>0); })();"));
  assert.ok(bd.includes("else if(m && m.composed && Number(m.missing)>0) boards.partial++;") && bd.includes('" with frames still missing"'));
});
await test("B3 a sheet showing a deleted frame is out of date; a page with other shots redraws once (composed only)", ()=>{
  assert.ok(sb.includes('const frameGone = !!(isComposed && ready.checked && ready.n < ready.total && _smNow && Array.isArray(_smNow.shotIds) && typeof _smNow.missing==="number" && _smNow.missing===0);'));
  assert.ok(sb.includes("if(!(sbFramesChanged(_m) || (_m && Array.isArray(_m.shotIds) && !sbIdsEqual(_m.shotIds, shotIds)))) return;"));
  assert.ok(sb.includes("},[gen.genUrl, ready.n, composing, isComposed, readOnly, shotIds.join(\",\")]);"));
});

/* ═══ C ═══ */
await test("C1 a compose belongs to its film and never draws over an upload unless you ask (run for real)", async ()=>{
  let ep = 1, commits = [];
  box.nbEpoch = ()=> ep;
  box.nbLoadImage = async (id)=> imgs[id] || "";
  // the real store discards a write made in another film's scope (tier "stale")
  box.nbCommit = async (id, url, meta, refs, kind, epoch)=>{ if(epoch!=null && epoch!==ep) return { tier:"stale" }; commits.push({ id, meta }); return { tier:"cloud", url:"u" }; };
  const page = { id:"p1", shots:[{ id:"f1" }] };
  imgs = { f1:"frame", "sbsheet-p1":"upload" }; metas = { "sbsheet-p1":{ uploaded:true, mode:"upload" }, f1:{ iso:"1", version:1 } };
  const draw = async ()=> "data:x";
  let r = await box.sbComposeSheet({ id:"sc" }, page, {}, {}, {}, draw);
  assert.equal(r.status, "kept"); assert.equal(commits.length, 0, "the upload is kept");
  r = await box.sbComposeSheet({ id:"sc" }, page, {}, {}, { explicit:true }, draw);
  assert.equal(r.status, "composed"); assert.equal(commits.length, 1, "Recompose replaces it");
  assert.equal(commits[0].meta.missing, 0); assert.ok(!("explicit" in commits[0].meta));
  // the film changes mid-draw: the run ends quietly, nothing written
  delete metas["sbsheet-p1"]; delete imgs["sbsheet-p1"]; commits = [];
  const slow = async ()=>{ ep = 2; return "data:y"; };
  r = await box.sbComposeSheet({ id:"sc" }, { id:"p2", shots:[{ id:"f1" }] }, {}, {}, {}, slow);
  assert.equal(r.status, "stale", JSON.stringify(r)); assert.equal(commits.length, 0, "nothing written into the other film");
  assert.ok(sb.includes('const key = String(ep0)+"|"+sid;') && sb.includes("if(typeof nbEpoch===\"function\" && nbEpoch()!==ep0) return { status:\"stale\" };"));
});
await test("C2 uploads record the page's shots; restores are held off the redraw; restoring halves asks", ()=>{
  assert.ok(art.includes('if(typeof opts.importMeta==="function"){ try{ Object.assign(meta, opts.importMeta()||{}); }catch(e){} }'));
  assert.ok(art.includes('if(typeof opts.onReverted==="function"){ try{ opts.onReverted(r); }catch(e){} }'));
  assert.ok(sb.includes("importMeta: ()=>({ shotIds: pageIdsRef.current.slice() }),") && sb.includes("onReverted: ()=>{ sbMarkRestored(projectId, sid, pageRef.current); } });"));
  assert.ok(between(sb, "  const restoreHalf = async (h)=>{", "  const deleteHalf").includes('title:"Restore the earlier halves?"'));
  assert.ok(sb.includes('else if(res.status==="kept") out.kept++;'));
});
await test("C3 Clear says it deletes the sheet, its versions and both halves; asks; clears both; the count follows", ()=>{
  const cl = between(sb, "  const clearSheet = async ()=>{", "await loadHalves(); };");
  assert.ok(cl.includes("Clearing permanently deletes the sheet and its earlier versions") && cl.includes("if((!isComposed || hasHalves) &&"));
  assert.ok(cl.includes('for(const h of ["top","bottom"]){ try{ await nbClearAsset(sid+":half-"+h); }catch(e){ halvesFailed = true; } }') && !cl.includes("its earlier versions stay in the sheet's version history"));
  assert.ok(sb.includes('window.addEventListener("sb-sheet-cleared", onCleared);'));
  assert.ok(sb.includes('title:"Replace this sheet with an upload?"') && art.includes('title:"Delete this earlier version?"'));
});

/* ═══ D ═══ */
await test("D1 the panel edit: asks for an approved frame, never re-sent, rights checked twice, off while out of date", ()=>{
  const pe = between(sb, "  const applyPanelEdit = async ()=>{", "  const [menuOpen,setMenuOpen]");
  assert.ok(pe.includes('title:"Edit an approved frame?"') && pe.includes("noRetry:true });"));
  assert.ok(pe.includes("if(!canEditFrames()){ setPanelErr(") && pe.includes("if(!canEditFrames()) throw new Error(\"Your role changed while the edit ran"));
  assert.ok(pe.includes("if(sheetOutOfDate){ setPanelErr("));
  assert.ok(sb.includes("disabled:!isComposed||sheetOutOfDate||!canEditFrames(),") && app.includes("window.turnCanMutateShots = ()=> !projectLoadingRef.current && !shotsReadOnlyRef.current && !shotsStageOnlyRef.current;"));
});
await test("D2 'Edit' on a panel and 'Edit shots' open that scene in Shots", ()=>{
  assert.ok(between(sb, "  const jumpToShot = (sh)=>{", "requestAnimationFrame(tick);\n  };").includes('window.turnFocusArtScene("shots", sh.sceneId);'));
  assert.ok(sb.includes('window.turnFocusArtScene("shots", scene.id); setArtView&&setArtView("shots");'));
});

/* ═══ E ═══ */
await test("E1 copy and accessibility", ()=>{
  assert.ok(!/Seedance/.test(sb) && !sb.includes('" stale source"') && !sb.includes("re-compose automatically whenever a frame re-renders"));
  assert.ok(sb.includes('w.oldLook ? (w.oldLook+" frame"+(w.oldLook!==1?"s":"")+" made with an earlier look") : "",'));
  assert.ok(sb.includes('_sbEl("button",{type:"button",className:"scene-pager-btn",title:"Jump to a scene"') && !sb.includes('className:"scene-pager-no ssg-jump",role:"button",tabIndex:0'));
  assert.ok(sb.includes('"aria-haspopup":"true","aria-expanded":menuOpen?"true":"false"') && sb.includes('className:"sb-half-view"'));
  assert.ok(sb.includes('"aria-pressed":panelShot===sh?"true":"false"') && sb.includes('"aria-pressed":editRefSel.indexOf(o.id)>=0?"true":"false"'));
  assert.ok(art.includes(".scene-pager-menu,.sheet-tools-dropdown')))) return;") && css.includes(".sb-half-view{"));
});
await test("E2 Frances: one keyframe per beat, honest halves, your work stays, the panel edit", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Storyboards (Art Room)")||{}).what || "";
  for(const re of [/STORYBOARDS REVIEW, THIRD PASS/, /draws each beat's main keyframe/, /labelled 'Beat N'/, /'Save halves' refuses an out-of-date sheet/,
    /never drawn over by an automatic or bulk compose/, /it permanently deletes the sheet, its earlier versions and both halves/, /open that scene in the Shots tab/]) assert.ok(re.test(w), String(re));
  assert.ok(!/shots-per-beat coverage/.test(w));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE|Nano Banana|Seedance/.test(between(ai, "[\"Storyboards (Art Room)\", \"STORYBOARDS REVIEW, THIRD PASS", "\"],\n")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

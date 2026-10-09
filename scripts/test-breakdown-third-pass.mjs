#!/usr/bin/env node
/* The Breakdown tab, third pass (owner 2026-10-09: "go ahead with all of it") — does it tell the truth?
   A  rows: approve vs refresh, the chain cascade, worn items on the owner's sheet for the scene, boards
      (missing / uploads), the summary counts each image once (worn once, a variant's master too)
   B  checking: every id looked up (boards, masters), never interrupted, cleared images forgotten, a failed
      cloud check said; the Stage saves its counts only after its takes load
   C  make & render: art rights, one run at a time, busy after yes, honest result, the real image count
   D  exports, copy, accessibility, Frances
     node scripts/test-breakdown-third-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const bd = read("app/breakdown.jsx"), app = read("app/app.jsx"), shots = read("app/shots.jsx"), ui = read("app/shots-ui.jsx"),
  stage = read("app/stage.jsx"), sb = read("app/storyboard.jsx"), ai = read("app/ai.jsx");

const box = { console, Object, Array, String, Number, Math, JSON, Set, Map, React:{ createElement:()=>null, useState:(v)=>[v, noop], useEffect:noop, useMemo:(f)=>f(), useRef:(v)=>({ current:v }) },
  localStorage:{ getItem:()=>null }, document:{}, addEventListener:noop, removeEventListener:noop };
box.window = box; vm.createContext(box);
vm.runInContext(transformSync(bd, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
vm.runInContext(between(shots, "function sceneNeedsImageCount(needs, has){", "window.sceneNeedsImageCount = sceneNeedsImageCount;")+";window.sceneNeedsImageCount=sceneNeedsImageCount;", box);
const base = ()=>{ box.sceneRoster = ()=>["ana"]; box.locationForScene = (l)=>l[0]; box.sceneReferenceNeeds = ()=>[]; box.sbPageRanges = (s)=>[{ start:0, count:s.length }];
  box.nbGetMeta = ()=>null; box.sbSheetStale = ()=>false; delete box.sceneShotsOrdered; delete box.seedShotOf; delete box.shotCharacterReferenceSpec; };
const film = (extra)=>({ scenes:[{ id:"s1", no:1, title:"Kitchen", loc:"INT. HOUSE - NIGHT" }], characters:[{ id:"ana", name:"Ana" }],
  props:[], locations:[{ id:"house", name:"House" }], drafts:{}, project:{}, tierOf:()=>"own", ...(extra||{}) });

/* ═══ A ═══ */
await test("A1 'to approve' (free) is apart from 'to refresh'; the chain cascade is counted and noted", ()=>{
  base();
  const shotsL = [{ id:"a", sceneId:"s1", beatN:1 }, { id:"b", sceneId:"s1", beatN:2, locked:true }, { id:"c", sceneId:"s1", beatN:3, locked:true }, { id:"d", sceneId:"s1", beatN:4 }];
  box.shotFrameState = (sh)=>({ a:{ rendered:true, current:false, approved:false, done:false }, b:{ rendered:true, current:true, approved:true, done:true },
    c:{ rendered:true, current:true, approved:true, done:true }, d:{ rendered:true, current:true, approved:false, done:false } })[sh.id];
  box.seedShotOf = (sh)=> ({ b:{ id:"a" }, c:{ id:"b" }, d:{ id:"c" } })[sh.id] || null;
  const made = new Set(["ana","house","a","b","c","d"]);
  const [r] = box.breakdownRows({ ...film({ shots:shotsL }), img:(id)=>made.has(id) });
  const texts = J(r.missing).map(m=>m.text);
  assert.ok(texts.includes("1 frame to approve") && texts.includes("1 frame to refresh"), JSON.stringify(texts));
  assert.equal(r.shots.toRender, 4, "a and d, plus b and c that follow a in the chain");
  assert.ok(J(r.notes).some(n=>/2 approved frames after them in the chain re-render with them/.test(n.text)), JSON.stringify(J(r.notes)));
});
await test("A2 a worn item is ready on its owner's sheet for THIS scene (the variant); it isn't counted again as a prop", ()=>{
  base();
  box.shotCharacterReferenceSpec = (c, scene)=> ({ id:"ana:wet" });
  const f = film({ shots:[], props:[{ id:"hat", name:"Hat", kind:"worn", ownerId:"ana", ownerName:"Ana", scenes:["s1"] }] });
  let made = new Set(["ana","house"]);
  let [r] = box.breakdownRows({ ...f, img:(id)=>made.has(id) });
  assert.equal(r.wardrobe[0].ready, false, "the master exists but this scene's frames use the variant");
  made = new Set(["ana","ana:wet","house"]);
  [r] = box.breakdownRows({ ...f, img:(id)=>made.has(id) });
  assert.equal(r.wardrobe[0].ready, true); assert.equal(r.wardrobe[0].onOwner, true);
  const sum = box.breakdownSummary(box.breakdownRows({ ...f, img:(id)=>id==="house" }));
  assert.equal(sum.propSheets, 0, "the worn item rides on the owner's sheet, counted on the cast line");
});
await test("A3 boards: missing sheets named; an upload isn't dated by its frames' look; ids handed to the lookup", ()=>{
  base();
  const shotsL = [1,2,3,4,5].map(n=>({ id:"f"+n, sceneId:"s1", beatN:n, locked:true }));
  box.shotFrameState = ()=>({ rendered:true, current:true, approved:true, done:true });
  box.sbPageRanges = ()=>[{ start:0, count:4 }, { start:4, count:1 }];
  box.shotLookIsEarlier = ()=>true;
  box.nbGetMeta = (id)=> id==="sbsheet-sbpage-s1-2x2-0" ? { uploaded:true } : null;
  const made = new Set(["ana","house","sbsheet-sbpage-s1-2x2-0","f1","f2","f3","f4","f5"]);
  const [r] = box.breakdownRows({ ...film({ shots:shotsL }), img:(id)=>made.has(id) });
  assert.deepEqual(J(r.boards), { total:2, current:1, stale:0, oldLook:0, partial:0, none:1 });
  assert.deepEqual(J(r.boardIds), ["sbsheet-sbpage-s1-2x2-0", "sbsheet-sbpage-s1-2x2-1"]);
  delete box.shotLookIsEarlier;
});
await test("A4 the summary and the Make chip count a variant's missing master too", ()=>{
  const needs = [{ id:"ana:wet", baseId:"ana", kind:"character", makeable:true, masterMissing:true }, { id:"house", kind:"location", makeable:true }];
  assert.equal(box.sceneNeedsImageCount(needs), 3);
  assert.equal(box.sceneNeedsImageCount([{ ...needs[0], masterMissing:false }, needs[1]]), 2);
  const sum = box.breakdownSummary([{ needs, cast:[], props:[], wardrobe:[], location:{ id:"house" }, shots:{ total:1, rendered:1, toRender:0 }, ready:false }]);
  assert.equal(sum.castSheets, 2, "the variant and its master");
  assert.ok(shots.includes("masterMissing:!exists(spec.baseId)"));
  assert.ok(bd.includes("window.nbCostChip(makeImages)"));
});

/* ═══ B ═══ */
await test("B1 checking: boards and masters looked up, never interrupted, cleared images forgotten, a failed check said", ()=>{
  const view = between(bd, "function BreakdownView({", "\nwindow.BreakdownView");
  assert.ok(view.includes("(r.boardIds||[]).forEach(id=>{ if(!img(id)) want.add(id); });") && view.includes("if(p.ownerId && !img(p.ownerId)) want.add(p.ownerId);"));
  assert.ok(view.includes("if(!mountedRef.current) return;") && !view.includes("if(!alive) return; }"));
  assert.ok(view.includes("if(d.id && !d.url){ checkedRef.current.delete(d.id);"));
  assert.ok(view.includes("Couldn't check which sheets and frames exist"));
  assert.ok(stage.includes("if(!vidsLoaded || !(allClips||[]).length) return;") && stage.includes("setVids(out); setStaleVids(stale); setVidsLoaded(true);"));
});

/* ═══ C ═══ */
await test("C1 Make what this scene needs: art rights from any room, one run at a time, busy after yes, honest result", ()=>{
  const mn = between(app, "  const makeSceneNeeds = async (scene, needs, onProgress)=>{", "  const wornBuildRef");
  assert.ok(mn.includes('if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return { status:"refused" }; }'));
  assert.ok(mn.includes("if(sceneNeedsBusyRef.current){") && mn.includes("sceneNeedsBusyRef.current = true;") && mn.includes("finally { sceneNeedsBusyRef.current = false; }"));
  assert.ok(mn.includes('if(onProgress) onProgress(0, steps.length, "");') && mn.indexOf("if(!ok) return { status:\"cancelled\" };") < mn.indexOf("onProgress(0, steps.length"));
  assert.ok(mn.includes(": stopped \\u2014 \"+made+\" of \"+steps.length+\" made\"") && mn.includes("Nothing here can be made from the Breakdown"));
  assert.ok(mn.includes("const stale = ()=> (typeof nbEpoch===\"function\" ? nbEpoch() : null)!==epoch0 || !!artRoomReadOnlyRef.current;"));
  assert.ok(mn.includes("Math.max(steps.length, window.sceneNeedsImageCount(needs))"));
  assert.ok(app.includes("onMakeSceneNeeds:artRoomReadOnly?null:makeSceneNeeds,"));
  assert.ok(!bd.includes("setNeedsBusy({ sceneId:scene.id, i:0, total:makeable.length });") && !ui.includes('setNeedsRun({ i:0, total:makeableNeeds.length, label:"" });'));
});
await test("C2 Render tells the truth; Boards open Storyboards on the scene; read-only says why", ()=>{
  assert.ok(bd.includes("a frame only waiting for approval is re-rendered too"));
  assert.ok(sb.includes('const f = window.turnPeekArtFocus && window.turnPeekArtFocus("storyboard");'));
  assert.ok(bd.includes("View only \\u2014 your role can't make images or render here."));
});

/* ═══ D ═══ */
await test("D1 exports: the tab's status, approved frames, notes, no price; the bible loads every sheet and states", ()=>{
  const ex = between(bd, "function exportStripboard(rows, project){", "\n}\n");
  assert.ok(ex.includes('const owed = (x)=> x.status ? x.status==="missing" : !x.ready;') && ex.includes("' approved · '") && ex.includes("const notes = (r.notes||[]).map(n=>n.text).join(\"; \");"));
  assert.ok(ex.includes("bdSummaryLine(sum, true)") && ex.includes('<span class="k-none">No time of day</span>'));
  assert.ok(!box.bdSummaryLine({ total:1, ready:0, castSheets:1, plates:0, propSheets:0, frames:0, noShots:0, noLoc:0, images:1 }, true).includes("credit"));
  const bib = between(bd, "async function exportArtBible({", "const castHtml");
  assert.ok(bib.includes("if(!u && typeof nbLoadImage===\"function\"){ try{ u = await nbLoadImage(id)") && bib.includes('_ids.push(c.id+":"+st.id)'));
  assert.ok(bd.includes('bibleBusy?"Preparing\\u2026":"Art department bible"'));
});
await test("D2 copy and accessibility", ()=>{
  assert.ok(!bd.includes("Design this scene's coverage") && bd.includes("Design this scene's shots (one keyframe per beat)"));
  assert.ok(bd.includes('"aria-label":String(t||label)+(ok===true?" (ready)":ok==="unused"?"":" (missing)")'));
  assert.ok(bd.includes('allMissing ? "Show fewer" : "+"+(missing.length-4)+" more"') && bd.includes('role:"group","aria-label":"Strip colours"'));
  assert.ok(bd.includes('_bdEl("span",{className:"sb-sr-only"},"Checking which sheets and frames exist\\u2026")'));
});
await test("D3 Frances: what's left, make & render, checking & exports", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Breakdown (Art Room)")||{}).what || "";
  for(const re of [/BREAKDOWN REVIEW, THIRD PASS/, /'N frames to approve' \(free, in Shots\)/, /'X plate \(needed first\)'/, /counts as two images/,
    /only offered to roles that can change the Art Room/, /The Boards chip opens Storyboards on that scene/, /a hollow amber ring/]) assert.ok(re.test(w), String(re));
  assert.ok(!/chip is red only when/.test(w));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE|Nano Banana|Seedance/.test(between(ai, "[\"Breakdown (Art Room)\", \"BREAKDOWN REVIEW, THIRD PASS", "\"],\n")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

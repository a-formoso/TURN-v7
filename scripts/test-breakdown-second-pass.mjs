#!/usr/bin/env node
/* The Breakdown tab, second pass (owner 2026-10-05: "go ahead with all of it") — does it tell the truth?
   A  rows: an earlier look is a note (the scene stays ready); chips follow the render plan (red only
      when a frame needs it, "unused" when no frame does); approved counts frames; boards by the
      Storyboards tab's rules; clips as the Stage last counted them
   B  the strip: Shots chip green only when every frame is done; Boards / Clips rows; notes; one
      "Make what this scene needs" at a time; Render from here always asks
   C  the view: batched recounts, a price line that follows the engine, the device lookup covers every
      id once, no export while checking, the info tip and header say what spends
   D  the Stage saves its per-scene clip counts (hooks before its early return)
   E  Frances knows
     node scripts/test-breakdown-second-pass.mjs */
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
const bd = read("app/breakdown.jsx"), stage = read("app/stage.jsx"), ai = read("app/ai.jsx");

const box = { console, Object, Array, String, Number, Math, JSON, Set, Map, React:{ createElement:()=>null, useState:(v)=>[v, noop], useEffect:noop, useMemo:(f)=>f(), useRef:(v)=>({ current:v }) },
  localStorage:{ getItem:()=>null }, document:{}, addEventListener:noop, removeEventListener:noop };
box.window = box; vm.createContext(box);
vm.runInContext(transformSync(bd, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
const made = new Set(["ana", "house", "a1", "a2", "sbsheet-sbpage-s1-2x2-0"]);
const film = ()=>({ scenes:[{ id:"s1", no:1, title:"Kitchen", loc:"INT. HOUSE - NIGHT" }],
  characters:[{ id:"ana", name:"Ana" }, { id:"ben", name:"Ben" }],
  props:[{ id:"cup", name:"Cup", kind:"carried", scenes:["s1"] }, { id:"hat", name:"Hat", kind:"worn", scenes:["s1"] }],
  locations:[{ id:"house", name:"House" }],
  shots:[{ id:"a1", sceneId:"s1", beatN:1, locked:true }, { id:"a2", sceneId:"s1", beatN:2, locked:true }], drafts:{}, project:{} });
const setup = ()=>{
  box.sceneRoster = ()=>["ana","ben"];
  box.locationForScene = (locs)=>locs[0];
  box.sceneReferenceNeeds = ()=>[{ id:"cup", kind:"prop", label:"Cup", makeable:true }];   // only the cup is missing for a frame
  box.shotFrameState = (sh)=>({ a1:{ done:true, oldLook:true }, a2:{ done:true } })[sh.id];
  box.sbPageRanges = (s)=>[{ start:0, count:s.length }];
  box.nbGetMeta = ()=>({ shotIds:["a1","a2"] });
  box.sbSheetStale = (m, ids)=> false;
};
const rowsOf = (extra)=> box.breakdownRows({ ...film(), img:(id)=>made.has(id), tierOf:()=>"own", ...(extra||{}) });

/* ═══ A ═══ */
await test("A1 an earlier look is a note — the scene can be ready", ()=>{
  setup(); box.sceneReferenceNeeds = ()=>[];
  const [r] = rowsOf();
  assert.equal(r.ready, true, JSON.stringify(J(r.missing)));
  assert.deepEqual(J(r.notes.map(n=>n.text)), ["1 frame with an earlier look — re-render to apply it"]);
  assert.equal(r.framesDone, 2);
});
await test("A2 chips follow the render plan: red only when a frame needs it; unused when no frame does", ()=>{
  setup();
  const [r] = rowsOf();
  const by = (list, id)=> list.find(x=>x.id===id).status;
  assert.equal(by(r.cast, "ana"), "ready");
  assert.equal(by(r.cast, "ben"), "unused", "Ben has no sheet, but no frame uses him");
  assert.equal(by(r.props, "cup"), "missing", "a frame needs the cup");
  assert.equal(by(r.wardrobe, "hat"), "unused", "the hat isn't in a frame");
  assert.equal(r.location.status, "ready");
  assert.deepEqual(J(r.missing.map(m=>m.text)), ["Cup sheet"]);
});
await test("A3 'approved' counts frames; boards follow the Storyboards rules; clips as the Stage counted them", ()=>{
  setup();
  const shots = film().shots.concat([{ id:"a3", sceneId:"s1", beatN:3, locked:true }]);   // approved but no frame
  box.shotFrameState = (sh)=>({ a1:{ done:true }, a2:{ done:true }, a3:{ done:false } })[sh.id];
  const [r] = rowsOf({ shots, stageStatus:{ s1:{ total:2, rendered:1, stale:1, oldLook:0 } } });
  assert.equal(r.shots.approved, 2, "the frameless locked shot isn't an approved frame");
  assert.deepEqual(J(r.boards), { total:1, current:1, stale:0, oldLook:0, partial:0, none:0 });
  box.sbSheetStale = ()=>true;
  assert.deepEqual(J(rowsOf({ shots })[0].boards), { total:1, current:0, stale:1, oldLook:0, partial:0, none:0 });
  assert.deepEqual(J(r.clips), { total:2, rendered:1, stale:1, oldLook:0 });
  box.localStorage = { getItem:(k)=> k==="turn_stage_scene_status:film-1" ? JSON.stringify({ s1:{ total:3 } }) : null };
  assert.deepEqual(J(box.bdStageStatus("film-1")), { s1:{ total:3 } });
  assert.equal(box.bdStageStatus("other"), null);
});
await test("A4 the cost line names what it covers", ()=>{
  box.nbImageCostText = (n)=>String(n*7);
  const line = box.bdSummaryLine({ total:2, ready:1, castSheets:1, plates:0, propSheets:0, frames:2, noShots:0, noLoc:0, images:3 });
  assert.match(line, /≈ 21 credits for the images still to make \(scenes without shots cost more to design; drafting adds a little writing; Shots gives each run's exact price; video is priced on the Stage\)/);
});

/* ═══ B ═══ */
const strip = between(bd, "function BreakdownStrip({", "\n}\n");
await test("B1 Shots chip green only when every frame is approved and current; Boards and Clips rows; notes", ()=>{
  assert.ok(strip.includes("const allDone = (shots.toRender||0)===0 && shots.rendered===shots.total;"));
  assert.ok(strip.includes('"Boards"') && strip.includes('" sheet"+(row.boards.total===1?"":"s")+" up to date"'));
  assert.ok(strip.includes('shots.total>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Clips"),'));
  assert.ok(strip.includes("as of your last visit to the Stage") && strip.includes("onClick:()=>onOpenStage&&onOpenStage()"));
  assert.ok(strip.includes('(row.notes||[]).length>0 && _bdEl("div",{className:"bd-notes"}'));
});
await test("B2 one 'Make what this scene needs' at a time across the board; Render from here always asks", ()=>{
  assert.ok(strip.includes("if(!onMakeSceneNeeds || needsBusy || !makeable.length) return;") && strip.includes("disabled:!!needsBusy"));
  assert.ok(strip.includes("const canRender = !readOnly && shots.total>0"));
  const ui = read("app/shots-ui.jsx");
  assert.ok(ui.includes("startSceneRef.current(scenesWithShots[i], { always:true })") && ui.includes('confirmRun(ids, "in Scene "+String(scene.no).padStart(2,"0"), true)'));
  assert.ok(strip.includes("Shots asks first, with the exact price"));
});

/* ═══ C ═══ */
await test("C1 the view: batched recounts, live price, every id looked up once, no export while checking", ()=>{
  const view = between(bd, "function BreakdownView({", "\nwindow.BreakdownView");
  assert.ok(view.includes("const bump = ()=>{ clearTimeout(t); t = setTimeout(()=>setTick(x=>x+1), 250); };"));
  assert.ok(view.includes('["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(ev=>window.addEventListener(ev, h));'));
  assert.ok(view.includes("r.props.concat(r.wardrobe||[])") && view.includes("(r.needs||[]).forEach(n=>{ if(n && n.id) want.add(n.id); });"));
  assert.ok(view.includes("!checkedRef.current.has(id)"));
  assert.ok(view.includes("window.turnExportBreakdown = checking") && view.includes("still checking which sheets and frames exist"));
  assert.ok(view.includes("Two buttons on a strip spend credits:") && !/Nothing here generates or spends/.test(bd));
  assert.ok(!/it never generates or spends/.test(bd));
  assert.ok(read("app/artroom.jsx").includes("onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds,onOpenStage,readOnly})"));
  assert.ok(read("app/app.jsx").includes('onOpenStage:()=>guardedSetRoom("stage"),'));
});

/* ═══ D ═══ */
await test("D1 the Stage saves each scene's clip counts per film — before its early return", ()=>{
  const view = between(stage, "function StageView({", "window.StageView = StageView;");
  const save = view.indexOf('localStorage.setItem("turn_stage_scene_status:"+stageFilmKey(project), JSON.stringify(out));');
  assert.ok(save > 0 && save < view.indexOf("if(!scenesWithShots.length){"));
  assert.ok(view.includes("o.total++; if(vids[c.id]) o.rendered++; if(staleVids[c.id]) o.stale++; if(oldLookVids[c.id]) o.oldLook++; if(noteVids[c.id]) o.notes++;"));
});

/* ═══ E ═══ */
await test("E1 Frances: what spends, boards and clips, the note, the chips", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Breakdown (Art Room)")||{}).what || "";
  assert.ok(!/The tab itself never generates or spends/.test(w));
  for(const re of [/Two strip buttons spend credits/, /always asks first, with the price/, /STORYBOARD sheets/, /STAGE CLIPS/, /as of your last visit to the Stage/,
    /a NOTE under the strip/, /'not in any of this scene's frames'/, /covers images only/]) assert.ok(re.test(w), String(re));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

#!/usr/bin/env node
/* The Shots review (owner 2026-10-03: "go ahead with all of it").
   A  no run starts unpriced: "Generate N shots" counts what isn't approved and current, always asks;
      "Render Scene NN in order" shows its price and asks when it would redo frames
   B  missing prop sheets are asked about (a single render on its card, a run once up front)
   C  "Check each frame" (on by default) pauses a run after each new frame: approve / regenerate / stop
   D  frames remember the colour look + film stock; a change is flagged, never re-rendered
   E  the scene's fold state is remembered per film
   F  "Make what this scene needs": what's missing, priced, made in dependency order
   G  Frances knows all of it
     node scripts/test-shots-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));

const ui = read("app/shots-ui.jsx"), shots = read("app/shots.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css");
const list = between(ui, "function ShotList({", "window.ShotList = ShotList;");
const group = between(ui, "function SceneShotGroup({", "function ShotList({");
const card = between(ui, "function ShotCard({", "function SceneCtxItem(");

/* ═══ A ═══ */
await test("A1 the run's reach is what isn't approved and current; re-renders are the ones with a frame", ()=>{
  assert.ok(list.includes("const toRender = (ids||[]).filter(id=>{ const s=shotById[id]; return s && !shotIsDone(s); });"));
  assert.ok(list.includes("const redo = toRender.filter(id=>shotHasFrame(id));") && list.includes("return { toRender, redo, approvedRedo:"));
});
await test("A2 'Generate N shots' shows the count and price and always asks; nothing left → 'Every shot approved'", ()=>{
  assert.ok(list.includes('("Generate "+filmPlan.toRender.length+" shot"+(filmPlan.toRender.length!==1?"s":""))'));
  assert.ok(list.includes("window.nbCostChip(filmPlan.toRender.length)"));
  assert.ok(list.includes('if(!(await confirmRun(ids, "across the film", true))) return;'));
  assert.ok(list.includes('"Every shot approved"') && !list.includes('"Generate all shots", typeof window.nbCostChip==="function" && window.nbCostChip(1)'));
});
await test("A3 a scene run shows its price, and asks only when it would redo frames", ()=>{
  assert.ok(list.includes('if(!(await confirmRun(ids, "in Scene "+String(scene.no).padStart(2,"0"), false))) return;'));
  assert.ok(list.includes("if((always || plan.redo.length) && typeof window.appConfirm===\"function\"){"));
  assert.ok(group.includes("window.nbCostChip(scenePlan.toRender.length)") && group.includes('"Scene approved"'));
  assert.ok(list.includes("scenePlan:scenePlanFor(scene)") && list.includes("scenePlan:scenePlanFor(runnerScene)"));
});

/* ═══ B ═══ */
const box = { console, Object, Array, String, JSON, Math, Set };
box.window = box; vm.createContext(box);
vm.runInContext(between(shots, "function carriedPropsNeedingSheets(", "window.carriedPropsNeedingSheets"), box);
vm.runInContext(between(shots, "function _lookHash(raw){", "window.shotLookSig"), box);
vm.runInContext(between(shots, "async function shotRunPropsNeeding(entries){", "window.shotRunPropsNeeding"), box);
await test("B1 a run's props-to-build list: in-frame and carried-over props with no sheet, once each, after a storage check", async ()=>{
  const stored = new Set(["pen-old"]);
  Object.assign(box, { nbGetImage:()=>"", nbLoadImage:async (id)=> stored.has(id) ? "blob:"+id : "",
    inFrameProps:(sh)=>sh.props||[], shotPropAttachable:()=>true, propTextOnly:(p)=>!!p.textOnly,
    shotRenderPlan:(sh)=>({ carried:sh.carry||[] }) });
  const propById = { pen:{ id:"pen", name:"Pen" }, cup:{ id:"cup", name:"Cup" }, note:{ id:"note", name:"Note", textOnly:true },
    ring:{ id:"ring", name:"Ring", kind:"worn" }, "pen-old":{ id:"pen-old", name:"Old pen" } };
  const ctx = { scene:{ id:"s1" }, charById:{}, propById };
  const need = await box.shotRunPropsNeeding([
    { sh:{ id:"a", props:["pen","note","ring","pen-old"] }, ctx }, { sh:{ id:"b", props:["pen"], carry:["cup"] }, ctx } ]);
  assert.deepEqual(J(need.map(p=>p.id)), ["pen", "cup"]);
});
await test("B2 the card asks on a single render; a run's one answer is used without asking", ()=>{
  assert.ok(card.includes("const runChoice = window.__turnShotRunPropChoice;"));
  assert.ok(card.includes('confirmLabel:"Make the sheet"+(need.length!==1?"s":"")+" first", altLabel:"Render without", cancelLabel:"Cancel"'));
  assert.ok(card.includes("if(make) await window.ensureCarriedPropSheets("), "nothing is built without a yes");
  assert.ok(list.includes("window.__turnShotRunPropChoice = propChoice;") && list.includes("window.__turnShotRunPropChoice = null;   // a single render asks on its card"));
  assert.ok(list.includes("React.useEffect(()=>{ if(!chain) window.__turnShotRunPropChoice = null; },[chain]);"));
});

/* ═══ C ═══ */
await test("C1 'Check each frame' is on by default, remembered, and pauses a multi-shot run before approving", ()=>{
  assert.ok(list.includes('localStorage.getItem("turn_shots_check_each")!=="0"'));
  const done = between(list, "const handleBatchDone = (id, opts)=>{", "  // Stop: abort the frame");
  const pause = done.indexOf("if(checkEachRef.current && c.ids.length>1 && (c.idx+1) < c.ids.length){");
  assert.ok(pause > 0 && pause < done.indexOf("onUpdateShot(id, { locked:true });"), "paused before it's approved");
  assert.ok(done.includes("setChain({ ...c, paused:true });"));
  assert.ok(list.includes("if(!chain || batchActiveId || chain.paused) return;"), "a paused run isn't 'stuck'");
});
await test("C2 the pause bar: Approve & continue / Regenerate this one / Stop", ()=>{
  assert.ok(list.includes("onUpdateShot(c.ids[c.idx], { locked:true }); stepChain(c.ids, c.idx+1, c.force); };"));
  assert.ok(list.includes("setChain({ ...c, paused:false, preFrame:"));
  assert.ok(list.includes('"Approve & continue"') && list.includes('"Regenerate this one"') && list.includes("stopPaused"));
  assert.ok(list.includes('"Check each frame"'));
});

/* ═══ D ═══ */
await test("D1 the look signature follows the scene's look and the film stock; frames store it; the strip flags a change", ()=>{
  box.scenePreset = (project, sid)=> (project.looks||{})[sid] || null;
  const P = { looks:{ s1:{ id:"ember", palette:["#111","#222","#333"], grade:"warm" } }, styleBible:{ filmStock:"portra" } };
  const a = box.shotLookSig(P, "s1");
  assert.equal(a, box.shotLookSig(JSON.parse(JSON.stringify(P)), "s1"));
  assert.notEqual(a, box.shotLookSig({ ...P, styleBible:{ filmStock:"none" } }, "s1"));
  assert.notEqual(a, box.shotLookSig({ ...P, looks:{ s1:{ ...P.looks.s1, grade:"cold" } } }, "s1"));
  assert.ok(ui.includes('lookSig:(typeof shotLookSig==="function" && ctx && ctx.scene) ? shotLookSig(ctx.project, ctx.scene.id) : "",'));
  // (2026-10-05, Color review) the check goes through shotLookIsEarlier: a missing look is never flagged
  assert.ok(group.includes('if(m && typeof shotLookIsEarlier==="function" && shotLookIsEarlier(m.lookSig, ctx.project, scene.id)) oldLook++;'));
  assert.equal(box.shotLookIsEarlier("", P, "s1"), false, "frames without a stored look are never flagged");
  assert.ok(group.includes('" made with an earlier look"'));
});

/* ═══ E ═══ */
await test("E1 the fold state is per film", ()=>{
  assert.ok(list.includes('const foldKey = "turn_shots_collapsed"+(project && project.id ? ":"+project.id : "");'));
  assert.ok(list.includes("localStorage.getItem(foldKey)") && list.includes("localStorage.setItem(foldKey,"));
});

/* ═══ F ═══ */
await test("F1 the scene lists what its frames need, from the render plan; only makeable items are priced", ()=>{
  // ONE definition, shared with the Breakdown (shots.jsx sceneReferenceNeeds)
  const needsFn = between(shots, "function sceneReferenceNeeds(sceneShots, ctx, has){", "window.sceneReferenceNeeds");
  assert.ok(needsFn.includes("(plan.activeLocSpec||[]).forEach(x=>add(x,\"location\"));") && needsFn.includes("(plan.castSpec||[]).forEach(x=>add(x,\"character\"));"));
  assert.ok(needsFn.includes("(plan.propSpec||[]).forEach(x=>add(x,\"prop\"));") && needsFn.includes("(plan.carrySpec||[]).forEach(x=>add(x,\"prop\"));"));
  assert.ok(group.includes('const sceneNeeds = (typeof sceneReferenceNeeds==="function") ? sceneReferenceNeeds(shots||[], ctx) : [];'));
  assert.ok(group.includes("window.nbCostChip(makeableNeeds.length)") && group.includes('"Make what this scene needs"'));
  assert.ok(group.includes('(make it in "+(n.kind==="location"?"Locations":n.kind==="prop"?"Props":"Characters")+")"'));
});
await test("F2 the app makes them in order: location plates (parent first), rooms & times, characters (master before variant), props", async ()=>{
  const fx = between(app, "  const makeSceneNeeds = async (scene, needs, onProgress)=>{", "  const wornBuildRef = React.useRef(null);");
  const order = [];
  const sb = { console, Object, Array, String, Promise, JSON };
  sb.window = sb; vm.createContext(sb);
  Object.assign(sb, {
    nbEpoch:()=>1, appToast:(m)=>{ sb.__toast = m; }, canMutateSharedFilm:()=>true, project:{},
    locations:[ { id:"house", key:"house", name:"House" }, { id:"kitchen", key:"kitchen", name:"Kitchen", parentKey:"house" } ],
    characters:[ { id:"ana", name:"Ana", coreBody:"x", wardrobeMask:"y", states:[{ id:"wet", label:"Wet" }] } ],
    props:[ { id:"pen", name:"Pen", form:"f", material:"m" } ],
    turnContinuity:{ sluglineUnits:[ { key:"kitchen-night", subspaceKey:"kitchen", name:"Kitchen", time:"NIGHT" } ] },
    sluglineUnitImageId:(k)=>"locunit-"+k, locationGenerationOrder:(ls)=>ls.slice().sort((a,b)=>(a.parentKey?1:0)-(b.parentKey?1:0)),
    generateLocationPlate:async (l)=>{ order.push("plate:"+l.id); return true; },
    generateSluglineUnitPlate:async (l,u)=>{ order.push("unit:"+u.key); return true; },
    generatePropSheet:async (p)=>{ order.push("prop:"+p.id); return true; },
    charVisualsDrafted:()=>true, _imgOf:async ()=>"", lbProject:()=>({}), keepPickedStyle:(a,b)=>b, setProps:()=>{},
    artAgentCtxFactoryRef:{ current:()=>({ art:{ locscout:{ list:null }, cast:{
      draftSpec:async ()=>null, generateMaster:async (c)=>{ order.push("master:"+c.id); return "blob:m"; },
      generateState:async (c, st)=>{ order.push("state:"+c.id+":"+st.id); } } } }) } });
  vm.runInContext(fx.replace("const makeSceneNeeds = async", "this.makeSceneNeeds = async"), sb);
  const progress = [];
  await sb.makeSceneNeeds({ no:3 }, [
    { id:"pen", baseId:"pen", kind:"prop" }, { id:"ana:wet", kind:"character", label:"Ana — Wet" }, { id:"locunit-kitchen-night", kind:"location" },
    { id:"kitchen", kind:"location" }, { id:"ana", kind:"character", label:"Ana" }, { id:"house", kind:"location" } ], (i,t,l)=>progress.push(i+"/"+t));
  assert.deepEqual(order, ["plate:house", "plate:kitchen", "unit:kitchen-night", "master:ana", "state:ana:wet", "prop:pen"], JSON.stringify(order)+" "+sb.__toast);
  assert.deepEqual(progress, ["1/6","2/6","3/6","4/6","5/6","6/6"]);
  assert.match(sb.__toast, /Scene 03 has what it needs — 6 reference images made/);
});
await test("F3 wired from the app through the Art Room to every scene (not for read-only roles)", ()=>{
  assert.ok(app.includes("onMakeSceneNeeds:makeSceneNeeds,"));
  assert.ok(read("app/artroom.jsx").includes("onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds,"));
  assert.ok(list.includes("onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds,"));
});

/* ═══ G ═══ */
await test("G1 Frances: priced runs, the frame check, prop questions, the earlier-look flag, scene needs", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const F = fb.__F, all = F.map(f=>f.what).join("\n");
  assert.ok(!/Generate all shots|no Review each shot toggle|now builds that prop sheet first|they auto-approve each frame before advancing/.test(all));
  const tab = (F.find(f=>f.name==="Shots (Art Room)")||{}).what || "";
  assert.ok(/NO RUN STARTS UNPRICED/.test(tab) && /CHECK EACH FRAME/.test(tab) && /MISSING PROP SHEETS/.test(tab) && /EARLIER LOOK/.test(tab) && /WHAT THIS SCENE NEEDS/.test(tab));
  assert.ok(/'Check each frame' (?:is )?on \(the default/.test(all), "the older Shots entries were rewritten too");
  assert.ok(!/TURN|McKee|Claude|Anthropic/.test(tab));
});
await test("G2 new styles use theme tokens only", ()=>{
  const rules = css.match(/\.shot-(?:check-each|all-done|check-bar|check-thumb|check-txt|check-acts|needs)[^{]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 8, rules.length);
  assert.ok(rules.every(r=>!/#[0-9a-f]{3,6}\b|rgb\(/i.test(r)));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

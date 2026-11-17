#!/usr/bin/env node
/* The Breakdown review (owner 2026-10-03: "go ahead with all of it").
   A  readiness follows the Shots rules: what a scene's frames attach and don't have (incl. its room
      & time plate), and frames done only when rendered + approved + current (earlier look listed)
   B  the summary counts each missing image once and gives the cost to finish
   C  a missing item / chip opens its tab ON THAT SCENE; Shots can start the scene's run
   D  each strip offers "Make what this scene needs" and, once nothing is missing, "Render Scene NN"
   E  both exports are in the header; the bible embeds its images and uses the plainer location names
   F  Frances knows all of it
     node scripts/test-breakdown-review.mjs */
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
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const buttons = (tree)=> findAll(tree, n=>n.type==="button");
const R = { Fragment:"fragment", state:null, calls:[],
  createElement:(type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) }),
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v); return [v, noop]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(st){ R.state = st || null; R.calls = []; } };

const bd = read("app/breakdown.jsx"), art = read("app/artroom.jsx"), ai = read("app/ai.jsx"), shotsUi = read("app/shots-ui.jsx"), props = read("app/props.jsx"), locUi = read("app/locations-ui.jsx");
const previews = [];
const box = { console, React:R, Icon:new Proxy({}, { get:()=>()=>null }), Object, Array, String, Number, Math, JSON, Set, Promise, Date,
  docPreview:(o)=>previews.push(o), nbCostChip:(n)=>({ type:"chip", props:{ count:n }, children:[] }), nbImageCostText:(n)=>String(12*n) };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/scene-order.js"), box);
vm.runInContext(transformSync(bd, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
box.sceneRoster = (scene)=> ["ana"];
box.locationForScene = (locs, sid)=> locs.find(l=>l.scenes.indexOf(sid)>=0)||null;
box.shotCharacterReferenceSpec = (c)=>({ id:c.id, state:null });
const film = ()=>({ project:{ id:"f1" },
  scenes:[{ id:"s1", no:1, title:"Dinner", loc:"INT. HOUSE - NIGHT" }, { id:"s2", no:2, title:"Dawn", loc:"EXT. YARD - DAWN" }],
  characters:[{ id:"ana", name:"Ana" }], props:[], locations:[{ id:"house", name:"House", scenes:["s1"] }, { id:"yard", name:"Yard", scenes:["s2"] }],
  shots:[{ id:"a1", sceneId:"s1", locked:true }, { id:"a2", sceneId:"s1" }, { id:"b1", sceneId:"s2", locked:true }], drafts:{} });
const made = new Set(["ana", "house", "yard", "a1", "a2", "b1"]);
const rowsOf = (f)=> box.breakdownRows({ ...f, img:(id)=>made.has(id), tierOf:()=>"own" });

/* ═══ A ═══ */
await test("A1 with shots, missing = the frames' needs (the room & time plate counts) + frames not done / earlier look", ()=>{
  box.sceneReferenceNeeds = (shots, ctx)=> ctx.scene.id==="s1" ? [{ id:"locunit-house-night", kind:"location", label:"House · Night", makeable:true }] : [];
  box.shotFrameState = (sh)=>({ a1:{ done:true, oldLook:true }, a2:{ done:false }, b1:{ done:true } })[sh.id];
  const [r1, r2] = rowsOf(film());
  assert.deepEqual(J(r1.missing.map(m=>m.text)), ["House · Night image", "1 frame to refresh"]);
  assert.deepEqual(J(r1.missing.map(m=>m.tab)), ["locations", "shots"]);
  // (2026-10-05, second pass) an earlier look is a NOTE, as in Shots and the Stage — never "to go"
  assert.deepEqual(J(r1.notes.map(m=>m.text)), ["1 frame with an earlier look \u2014 re-render to apply it"]);
  assert.equal(r1.ready, false, "the main plate exists, but not the room & time plate the shots attach");
  assert.equal(r1.shots.toRender, 1);
  assert.equal(r2.ready, true);
});
await test("A2 without the shared helpers the older checks stand (the existing Breakdown test covers them)", ()=>{
  delete box.sceneReferenceNeeds; delete box.shotFrameState;
  const [r1] = rowsOf(film());
  assert.ok(r1.ready, JSON.stringify(J(r1.missing)));
  assert.ok(bd.includes("if(sceneShots.length && typeof sceneReferenceNeeds===\"function\"){") && bd.includes("else if(typeof shotFrameState===\"function\"){"));
});

/* ═══ B ═══ */
await test("B1 each missing image counts once, frames count what's to render, and the cost to finish is shown", ()=>{
  box.sceneReferenceNeeds = (shots, ctx)=>[{ id:"ana", kind:"character", label:"Ana", makeable:true }, { id:"locunit-x", kind:"location", label:"X", makeable:true }];
  box.shotFrameState = (sh)=>({ done:sh.id==="b1" });
  const sum = box.breakdownSummary(rowsOf(film()));
  assert.equal(sum.castSheets, 1, "Ana once across both scenes"); assert.equal(sum.plates, 1); assert.equal(sum.frames, 2);
  assert.equal(sum.images, 4);
  assert.match(box.bdSummaryLine(sum), /≈ 48 credits for the images still to make \(scenes without shots cost more to design; drafting adds a little writing; Shots gives each run's exact price; video is priced on the Stage\)/);
});

/* ═══ C ═══ */
await test("C1 the hand-off: a tab opens on the scene (once, within 15 s)", ()=>{
  const fb = { Date }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(art.split("\n").filter(l=>/^window\.turn(Focus|Peek|Clear)Art/.test(l)).join("\n"), fb);
  fb.turnFocusArtScene("props", "s2");
  assert.equal(fb.turnPeekArtFocus("props").sceneId, "s2"); assert.equal(fb.turnPeekArtFocus("shots"), null);
  fb.turnClearArtFocus("props"); assert.equal(fb.turnPeekArtFocus("props"), null);
  fb.turnArtFocus = { tab:"props", sceneId:"s2", at:Date.now()-20000 }; assert.equal(fb.turnPeekArtFocus("props"), null, "stale hand-offs are ignored");
});
await test("C2 every tab reads it: Characters / Props / Locations focus the scene; Shots opens it (and can start its run)", ()=>{
  for(const [src, tab] of [[art, "characters"], [props, "props"], [locUi, "locations"]]){
    assert.ok(src.includes('window.turnPeekArtFocus && window.turnPeekArtFocus("'+tab+'"); return (f && f.sceneId) || ""; });'), tab);
    assert.ok(src.includes('window.turnClearArtFocus("'+tab+'"); },[]);'), tab);
  }
  assert.ok(shotsUi.includes('const f = window.turnPeekArtFocus && window.turnPeekArtFocus("shots");'));
  assert.ok(shotsUi.includes('if(f.action==="render") setTimeout(()=>{ startSceneRef.current && startSceneRef.current(scenesWithShots[i], { always:true }); }, 400);'));
});

/* ═══ D ═══ */
await test("D1 the strip: links open on its scene; 'Make what this scene needs' (priced) and, when nothing is missing, 'Render Scene NN'", async ()=>{
  const went = []; let made2 = null;
  const go = (tab, sceneId, action)=> went.push([tab, sceneId, action||""]);
  box.sceneReferenceNeeds = (shots, ctx)=> ctx.scene.id==="s1" ? [{ id:"locunit-house-night", kind:"location", label:"House · Night", makeable:true }] : [];
  box.shotFrameState = (sh)=>({ done:sh.id!=="b1" });
  const [r1, r2] = rowsOf(film());
  R.reset();
  let tree = box.BreakdownStrip({ row:r1, go, onMakeSceneNeeds:async (sc, needs)=>{ made2 = [sc.id, needs.map(n=>n.id)]; } });
  const mk = buttons(tree).find(b=>/Make what this scene needs/.test(textOf(b)));
  assert.ok(mk); assert.equal(findAll(mk, n=>n.type==="chip")[0].props.count, 1);
  assert.ok(!buttons(tree).some(b=>/Render Scene/.test(textOf(b))), "no render while something is missing");
  await mk.props.onClick(); assert.deepEqual(J(made2), ["s1", ["locunit-house-night"]]);
  buttons(tree).find(b=>/House · Night image/.test(textOf(b))).props.onClick();
  assert.deepEqual(went.pop(), ["locations", "s1", ""]);
  R.reset();
  tree = box.BreakdownStrip({ row:r2, go, onMakeSceneNeeds:noop });
  const rs = buttons(tree).find(b=>/Render Scene 02/.test(textOf(b)));
  assert.ok(rs); assert.equal(findAll(rs, n=>n.type==="chip")[0].props.count, 1);
  rs.props.onClick(); assert.deepEqual(went.pop(), ["shots", "s2", "render"]);
  assert.ok(art.includes("setArtView,onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds,onOpenStage,readOnly})"));
});

/* ═══ E ═══ */
await test("E1 both exports are in the header; the bible embeds its images and uses the plainer names", async ()=>{
  const view = between(bd, "function BreakdownView({", "window.BreakdownView = BreakdownView;");
  assert.ok(view.includes('"Export stripboard"') && view.includes('"Art department bible"'));
  box.nbGetImage = (id)=> id==="ana" ? "https://signed.example/ana.png" : (id==="house" ? "data:image/png;base64,AA" : "");
  box.sbToDataUrl = async (u)=> "data:image/png;base64,"+u.length;
  box.PropScreenplay = { sheetTier:()=>({ tier:"own" }) };
  const f = film(); f.locations[0].topology = "kitchen opens onto the hall"; f.locations[0].continuityAnchors = "the clock";
  await box.exportArtBible(f);
  const html = previews.pop().html;
  assert.ok(html.includes('<img src="data:image/png;base64,30" alt="Ana">'), "a signed link is embedded");
  assert.ok(html.includes('<img src="data:image/png;base64,AA" alt="House">'));
  assert.ok(!html.includes("signed.example"));
  assert.ok(html.includes('<span class="l">How the rooms connect</span>') && html.includes('<span class="l">Fixed landmarks</span>'));
  assert.ok(bd.includes("Sheet images are embedded, so the saved file keeps them."));
});

/* ═══ F ═══ */
await test("F1 Frances: the Shots rules, the cost to finish, scene links, the strip actions, embedded exports", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Breakdown (Art Room)")||{}).what || "";
  assert.ok(/READINESS USES THE SHOTS RULES/.test(w) && /credits to finish/.test(w) && /ON THAT SCENE/.test(w));
  assert.ok(/'Make what this scene needs'/.test(w) && /'Render Scene NN'/.test(w) && /EMBEDDED/.test(w) && /under the Breakdown header's 'Export' menu/.test(w));
  assert.ok(!/can expire; the PDF keeps them/.test(w));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

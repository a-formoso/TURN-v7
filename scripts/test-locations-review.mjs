#!/usr/bin/env node
/* The Locations review (owner 2026-10-03: "go ahead with all of it").
   A  Design N locations drafts only missing specs and layouts; "Redesign all…" asks; failures are said
   B  Generate N missing plates — priced for exactly those, never one waiting for its layout review;
      "Regenerate plates…" only once nothing is missing
   C  one scene: "Generate N missing in Scene NN" makes the location plates (parent first), then the
      scene's room & time plates, with one price; Stop between plates; failures listed
   D  the headless room & time plate generator: needs its location's plate, uses the card's references
   E  removing a room & time / an environment state asks first; no "World scale" box; the prompt is
      behind the ⋯ menu (next to Edit a panel); the layout-first writing charge is said on Generate
   F  plainer names on screen; model prompts keep their terms; Frances knows all of it
     node scripts/test-locations-review.mjs */
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
const noop = ()=>{};
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const buttons = (tree)=> findAll(tree, n=>n.type==="button");
const R = { Fragment:"fragment", state:null, calls:[], setters:{},
  createElement:(type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) }),
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v);
    return [v, (x)=>{ R.setters[i] = typeof x==="function" ? x(v) : x; }]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(st){ R.state = st || null; R.calls = []; R.setters = {}; } };
const icon = new Proxy({}, { get:()=>()=>null });

const ui = read("app/locations-ui.jsx"), loc = read("app/locations.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx"),
  art = read("app/artroom.jsx"), shotsUi = read("app/shots-ui.jsx");

let images = new Set(), generated = [], confirms = [], answer = true, toasts = [];
const box = { console, React:R, Icon:icon, localStorage:{ getItem:()=>null, setItem:noop },
  document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class { constructor(t, o){ this.type=t; this.detail=o&&o.detail; } },
  nbCostChip:(count)=>({ type:"chip", props:{ count }, children:[] }), nbGetImage:(id)=> images.has(id) ? "blob:"+id : "",
  nbLoadImage:async (id)=> images.has(id) ? "blob:"+id : "", nbEpoch:()=>1,
  appConfirm:async (o)=>{ confirms.push(o); return answer; }, appToast:(m)=>{ toasts.push(m); },
  useBatchGen:()=>({ activeId:null, begin:(ids, skipped)=>{ box.__begun = { ids, skipped }; }, setMsg:(m)=>{ box.__msg = m; }, advance:noop }),
  usePager:()=>({ slice:(a)=>a }), PagerBar:"PagerBar", NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar",
  ImageLightbox:"ImageLightbox", InfoTip:"InfoTip", RecentlyDeleted:"RecentlyDeleted", RenderStylePicker:"RenderStylePicker",
  EditText:"EditText", SheetField:"SheetField", SheetFrame:"SheetFrame", CardFold:"CardFold", CopyBox:"CopyBox",
  scenesInStoryOrder:(s)=>s||[], searchWordMatch:(t,q)=>!q||String(t).toLowerCase().includes(q), turnContinuity:{ scenes:[], drafts:{}, locations:[] },
};
box.window = box; vm.createContext(box);
vm.runInContext(loc, box, { filename:"app/locations.jsx" });
vm.runInContext(ui, box, { filename:"app/locations-ui.jsx" });
// a plate renders only once its shared layout is reviewed — here a flag on the card says so
box.requireLocationSpatialPlan = (l)=>{ const live = ((box.turnContinuity.locations)||[]).find(x=>x.id===(l&&l.id)) || l;
  if(live && live.layoutWaiting) throw new Error("Review the shared set layout before rendering."); return { ready:true }; };
box.generateLocationPlate = async (l)=>{ generated.push("plate:"+l.id); images.add(l.id); return true; };
box.generateSluglineUnitPlate = async (l, u)=>{ generated.push("unit:"+u.key); images.add(box.sluglineUnitImageId(u.key)); return true; };

const D = (id, name, extra)=>({ id, key:id, name, architecture:"stone", lighting:"window", scenes:[], ...(extra||{}) });
const unit = (key, owner, scenes, extra)=>({ key, name:key, locationKey:owner, subspaceKey:owner, intExt:"INT", time:"NIGHT", scenes, sceneNos:[1], ...(extra||{}) });
const sheets = (locations, extra, state)=>{ R.reset(state); box.turnContinuity = { scenes:[], drafts:{}, locations };
  return box.LocationSheets({ project:{}, locations, scenes:[{ id:"s1", no:1, title:"Dinner" }, { id:"s2", no:2, title:"Dawn" }], drafts:{},
    onUpdate:noop, onDraft:noop, onDraftAll:(m)=>{ box.__draftAll = m===undefined ? "missing" : m; }, onDelete:noop, scriptHasLocs:true,
    trashItems:[], onRestore:noop, onPurge:noop, sluglineUnits:[], ...(extra||{}) }); };

/* ═══ A ═══ */
await test("A1 the header: 'Design N locations' while any spec is missing; 'Redesign all…' once none are", ()=>{
  images = new Set();
  let tree = sheets([D("house","House"), { id:"yard", key:"yard", name:"Yard", scenes:[] }]);
  const d = buttons(tree).find(b=>/^Design 1 location$/.test(textOf(b)));
  assert.ok(d, buttons(tree).map(textOf).join(" | ")); d.props.onClick(); assert.equal(box.__draftAll, "missing");
  tree = sheets([D("house","House")]);
  const r = buttons(tree).find(b=>/Redesign all/.test(textOf(b))); assert.ok(r && hasClass("ghost")(r));
  r.props.onClick(); assert.equal(box.__draftAll, "redraft");
});
await test("A2 the app: only missing specs and layouts are drafted; Redesign asks first; a failure is said", ()=>{
  const fx = between(app, "  const draftAllLocations = async (mode)=>{", "  // draft a location's depth-grid staging");
  assert.ok(fx.includes("const specTargets = redraft ? working : working.filter(l=>!isDrafted(l));"));
  assert.ok(fx.includes("await aiDesignLocationBible(specTargets, scenes, lbProject(\"locations\"))"));
  assert.ok(fx.includes("(l.scenes||[]).length>=2 && (redraft || !staged(l))"), "an existing layout is kept");
  assert.ok(fx.indexOf("appConfirm") < fx.indexOf("setDraftingAllLocs(true)"));
  assert.ok(fx.includes("Couldn't design the locations") && !/catch\(e\)\{\}\n    setDraftingAllLocs/.test(fx));
});

/* ═══ B ═══ */
await test("B1 'Generate N missing plates' prices only drafted plates without an image, and never one waiting for its layout", ()=>{
  images = new Set(["house"]);
  const tree = sheets([D("house","House"), D("barn","Barn"), D("mill","Mill",{ layoutWaiting:true }), { id:"yard", key:"yard", name:"Yard" }]);
  const b = buttons(tree).find(x=>/Generate 1 missing plate$/.test(textOf(x)));
  assert.ok(b, buttons(tree).map(textOf).join(" | "));
  assert.equal(findAll(b, n=>n.type==="chip")[0].props.count, 1);
  assert.match(b.props.title, /1 more wait for their shared layout to be reviewed/);
  box.__begun = null; b.props.onClick(); assert.deepEqual(J(box.__begun), { ids:["barn"], skipped:0 });
});
await test("B2 nothing missing → only a quiet 'Regenerate plates…'; no read-only 'World scale' box", ()=>{
  images = new Set(["house"]);
  const tree = sheets([D("house","House")]);
  assert.ok(!buttons(tree).some(x=>/missing/.test(textOf(x))));
  const re = buttons(tree).find(x=>/Regenerate plates/.test(textOf(x))); assert.ok(re && hasClass("ghost")(re));
  assert.ok(!/World scale/.test(textOf(tree)));
});

/* ═══ C ═══ */
const family = ()=>[ D("house","House"), D("kitchen","Kitchen",{ parentKey:"house", scenes:["s1"] }), D("barn","Barn",{ scenes:["s2"] }) ];
const units = [ unit("kitchen-night","kitchen",["s1"]), unit("kitchen-dawn","kitchen",["s2"]), unit("gone","kitchen",["s1"],{ orphan:true }) ];
await test("C1 a focused scene: the parent plate, the room's plate, then the scene's room & time plate — one price", async ()=>{
  images = new Set(); generated = []; toasts = [];
  // useState order in LocationSheets: view, sceneFilter, …
  const tree = sheets(family(), { sluglineUnits:units }, { 1:"s1" });
  const b = buttons(tree).find(x=>/Generate 3 missing in Scene 01/.test(textOf(x)));
  assert.ok(b, buttons(tree).map(textOf).join(" | "));
  assert.equal(findAll(b, n=>n.type==="chip")[0].props.count, 3);
  assert.match(b.props.title, /2 location plates \(a room's parent first\), then 1 room & time plate/);
  await b.props.onClick();
  assert.deepEqual(generated, ["plate:house", "plate:kitchen", "unit:kitchen-night"], "parent first, then the room, then its night plate; never the orphan");
  assert.equal(toasts.length, 0);
});
await test("C2 a room & time plate waits when its location can't be made (layout under review) — said in the hover text", ()=>{
  images = new Set(["house"]);
  const tree = sheets([ D("house","House"), D("kitchen","Kitchen",{ parentKey:"house", scenes:["s1"], layoutWaiting:true }) ], { sluglineUnits:units }, { 1:"s1" });
  assert.ok(!buttons(tree).some(x=>/missing in Scene/.test(textOf(x))), "nothing this scene needs can be made yet");
  images = new Set(["house", "kitchen"]);
  const t2 = sheets([ D("house","House"), D("kitchen","Kitchen",{ parentKey:"house", scenes:["s1"] }) ], { sluglineUnits:units }, { 1:"s1" });
  const b = buttons(t2).find(x=>/Generate 1 missing in Scene 01/.test(textOf(x))); assert.ok(b);
});
await test("C3 failures are listed; the run can stop between plates", async ()=>{
  images = new Set(); generated = []; toasts = [];
  const real = box.generateSluglineUnitPlate;
  box.generateSluglineUnitPlate = async ()=>{ throw new Error("Generate Kitchen's plate first"); };
  const tree = sheets(family(), { sluglineUnits:units }, { 1:"s1" });
  await buttons(tree).find(x=>/missing in Scene 01/.test(textOf(x))).props.onClick();
  assert.match(toasts[0], /1 plate couldn't be made: kitchen-night · NIGHT — Generate Kitchen's plate first/);
  box.generateSluglineUnitPlate = real;
  assert.ok(ui.includes('"Stop after this one"') && ui.includes("if(sceneStop.current) break;"));
});

/* ═══ D ═══ */
await test("D1 the headless room & time plate: needs its location's plate; uses its references; reports done", async ()=>{
  const db = { console, Object, Array, String, Number, Math, JSON, Promise, Set, Map, Date,
    CustomEvent:class { constructor(t, o){ this.type=t; this.detail=o&&o.detail; } }, localStorage:{ getItem:()=>null } };
  db.window = db; vm.createContext(db);
  vm.runInContext(loc, db, { filename:"app/locations.jsx" });
  const imgs = new Set(), calls = [], events = [];
  Object.assign(db, { nbGetImage:(id)=>imgs.has(id)?"blob:"+id:"", nbLoadImage:async (id)=>imgs.has(id)?"blob:"+id:"", nbEpoch:()=>1,
    nbGenerate:async (prompt, o)=>{ calls.push({ prompt, o }); return "data:x"; }, nbCommit:async ()=>({ tier:"ok" }),
    dispatchEvent:(e)=>{ events.push(e.detail); return true; }, requireLocationSpatialPlan:()=>({ ready:true }),
    locationSpatialReferences:async ()=>[], locationScreenplayReferenceImages:()=>["blob:page1"],
    buildSluglineUnitPrompt:()=>"ROOM PROMPT", locationAssetDependencySnapshot:()=>({}),
    // the unit's scene (2026-10-14: its pages are drawn for every scene of the unit the film has)
    turnContinuity:{ scenes:[{ id:"s1", no:1 }], drafts:{} } });
  const l = { id:"kitchen", name:"Kitchen", key:"kitchen" }, u = unit("kitchen-night","kitchen",["s1"]);
  await assert.rejects(()=>db.generateSluglineUnitPlate(l, u, {}), /Generate Kitchen's plate first/);
  assert.equal(calls.length, 0, "nothing is spent without the location's plate");
  imgs.add("kitchen");
  assert.equal(await db.generateSluglineUnitPlate(l, u, {}), true);
  const id = db.sluglineUnitImageId(u.key);
  assert.equal(calls[0].o.assetId, id);
  assert.deepEqual(J(calls[0].o.extraImages), ["blob:page1", "blob:kitchen"]);
  assert.match(calls[0].prompt, /^ROOM PROMPT REFERENCE IMAGES \(binding\)/);
  assert.match(calls[0].prompt, /never copy their typography/);
  assert.equal(events[events.length-1].id, id);
  assert.equal(await db.generateSluglineUnitPlate(l, { ...u, orphan:true }, {}), false, "never for a room no longer in the script");
});

/* ═══ E ═══ */
await test("E1 removing a room & time that left the script asks first (a permanent delete)", ()=>{
  const card = between(ui, "function SluglineUnitCard(", "function SceneSetupCard(");
  const at = card.indexOf('title:"Remove "+(u.name||"this room")');
  assert.ok(at > 0 && card.indexOf("if(!ok) return;", at) < card.indexOf("nbClearAsset(imgId)", at));
  assert.ok(card.includes('confirmLabel:"Remove for good", cancelLabel:"Keep it", danger:true'));
});
await test("E2 removing an extra environment state asks first and deletes its plate with it", ()=>{
  const fx = between(ui, "  const removeVariant = async (vid)=>{", "  };");
  assert.ok(fx.includes("appConfirm") && fx.indexOf("if(!ok) return;") < fx.indexOf("nbClearAsset(assetId)"));
  assert.ok(fx.includes("locationAppearanceStateAssetId(l,v,sluglineUnits||[])"));
});
await test("E3 the prompt is behind the ⋯ menu, beside 'Edit a panel…'; Generate says when it writes the layout first", ()=>{
  const card = between(ui, "function LocationSheet({", "function CoverageViewsEditor(");
  assert.ok(card.includes('label: panelEdit?"Close panel edit":"Edit a panel\\u2026", placement:"beforeEdit",'));
  // (owner 2026-10-28) the prompt is a folded section of the card, no longer a ⋯ menu item
  assert.ok(!card.includes('"Show the generation prompt"'));
  assert.equal((card.match(/menuExtra:/g)||[]).length, 1, "one menu list (a second key would drop Edit a panel)");
  assert.ok(card.includes('React.createElement(CardFold,{label:"Generation Prompt",defaultOpen:false},'));
  assert.ok(card.includes("generateTitle:(!locStaged && !gen.slotHasRef"));
  assert.ok(art.includes("(generateTitle || (genUrl ? \"Generate a fresh sheet from the current spec\""));
});

/* ═══ F ═══ */
await test("F1 plainer names on screen; model-facing prompts keep their terms", ()=>{
  for(const t of ['CardFold,{label:"Variants",foldId:"loc-units-"+l.id,' /* Rooms & times until 2026-11-13 */, 'label:"How the rooms connect"', '"Fixed landmarks"', '"Extra spaces"', '"Add extra view notes"', 'label:"Visible fixed landmarks"'])
    assert.ok(ui.includes(t), t);
  for(const t of ['CardFold,{label:"Rooms & times"', 'CardFold,{label:"Slugline Units"', 'label:"Spatial topology"', 'React.createElement("span",null,"Continuity anchors")', '"Additional space plates"', '"Add coverage view"'])
    assert.ok(!ui.includes(t), t);
  assert.ok(shotsUi.includes('unit:"Rooms & times",coverage:"Extra spaces",'));
  // (2026-10-14) a room & time plate's page notes are written once, for its card and the headless runs alike
  assert.ok(loc.includes('const name = (u && u.name) || "this Slugline Unit";') && loc.includes('note:"screenplay page "+(k+1)+" for "+name+" (Scene "'),
    "image-model notes keep the craft term");
});
await test("F2 Frances: the new names, one-scene plates, missing-only, confirms, no World scale box", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const F = fb.__F, all = F.map(f=>f.what).join("\n");
  assert.ok(!/Generate all locations|Generate all in Scene X|World scale sits beside/.test(all));
  assert.ok(/'Design N locations'/.test(all) && /Redesign all/.test(all) && /'Generate N missing plates'/.test(all));
  const tab = (F.find(f=>f.name==="Locations (Art Room)")||{}).what || "";
  assert.ok(/'Slugline Units' are now shown as 'Rooms & times'/.test(tab) && /'Fixed landmarks'/.test(tab));
  assert.ok(/ONE SCENE/.test(tab) && /'Stop after this one'/.test(tab) && /REMOVING a room & time/.test(tab) && /folded 'Generation Prompt' section/.test(tab));
  assert.ok(!/TURN|McKee|Claude|Anthropic/.test(tab));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

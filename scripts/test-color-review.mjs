#!/usr/bin/env node
/* The Color review (owner 2026-10-03: "go ahead with all of it").
   A  the film stock is shown and can be changed (it's added to every shot prompt)
   B  hand-picked scenes keep their look when the film is lit again — unless "Also redo" is ticked;
      the proposal says how many it keeps
   C  the Colorist's per-scene "why" (and palette reasoning) is kept after approval and shown
   D  "Not lit yet": the starter looks are labelled examples
   E  each look previews on the film's own location plate (drawn stand-in before any exists); one
      preview per card (no repeated "Ungraded")
   F  looks can be edited (name, colours, notes) and deleted (asks first; scenes are unassigned)
   G  "Light the film" says it's writing credits only; Frances knows all of it
     node scripts/test-color-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]],
  plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename }).code;
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
// render function components (one level of state per call is enough for these views)
const R = { Fragment:"fragment", state:null, calls:[],
  createElement:(type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) }),
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v); return [v, noop]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f, useId:()=>":r1:",
  reset(st){ R.state = st || null; R.calls = []; } };
const expand = (n)=>{ if(!n || typeof n!=="object") return n; if(Array.isArray(n)) return n.map(expand);
  if(typeof n.type==="function"){ return expand(n.type({ ...n.props })); }
  return { ...n, children:(n.children||[]).map(expand) }; };
const icon = new Proxy({}, { get:()=>()=>null });

const ui = read("app/stylebible-ui.jsx"), sbData = read("app/stylebible.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx"),
  agents = read("app/agents.jsx"), agentsUi = read("app/agents-ui.jsx");
let images = new Set(), confirms = [], answer = true;
const box = { console, React:R, Icon:icon, Set, Map, Object, Array, String, Number, Math, JSON, setTimeout:()=>0, clearTimeout:noop,
  document:{ addEventListener:noop, removeEventListener:noop, createElement:()=>({}) },
  nbGetImage:(id)=> images.has(id) ? "blob:"+id : "", scenesInStoryOrder:(s)=>(s||[]).slice().sort((a,b)=>a.no-b.no),
  appConfirm:async (o)=>{ confirms.push(o); return answer; }, turnContinuity:{ locations:[] } };
box.window = box; vm.createContext(box);
vm.runInContext(sbData, box, { filename:"app/stylebible.jsx" });
vm.runInContext(transform(ui, "stylebible-ui.jsx"), box, { filename:"app/stylebible-ui.jsx" });

const scenes = [{ id:"s1", no:1, title:"Dinner" }, { id:"s2", no:2, title:"Fight" }, { id:"s3", no:3, title:"Dawn" }];
const looks = [ { id:"ember", name:"Ember", palette:["#331100","#aa5522","#ffdd99"], grade:"warm" },
  { id:"ash", name:"Ash", palette:["#222222","#777777","#dddddd"], grade:"cold" } ];
const view = (styleBible, extra)=>{ R.reset();
  return box.StyleBibleView({ project:{ styleBible }, scenes, onSetRefs:noop, onSetScenePreset:noop, onColorist:(r,o)=>{ box.__lit = o; },
    onSetFilmStock:(id)=>{ box.__stock = id; }, onUpdatePreset:(id,p)=>{ box.__upd = { id, p }; }, onDeletePreset:(id)=>{ box.__del = id; }, ...(extra||{}) }); };

/* ═══ A ═══ */
await test("A1 the film stock is shown, can be changed, and says what it adds to shots", ()=>{
  const tree = view({ presets:looks, filmStock:"cinestill800t" });
  const sel = findAll(tree, n=>n.type==="select" && n.props["aria-label"]==="Film stock")[0];
  assert.ok(sel); assert.equal(sel.props.value, "cinestill800t");
  assert.ok(findAll(sel, n=>n.type==="option").length >= 8);
  sel.props.onChange({ target:{ value:"none" } }); assert.equal(box.__stock, "none");
  assert.match(textOf(findAll(tree, hasClass("sb-stock-note"))[0]), /^Added to every shot prompt: Shot on CineStill 800T/);
  assert.match(textOf(findAll(view({ presets:looks }), hasClass("sb-stock-note"))[0]), /No film look is added to shots/);
});
await test("A2 the app saves it; read-only roles see it but can't change it", ()=>{
  // (2026-10-08) checks edit rights and marks the pick as yours
  assert.ok(app.includes('const setFilmStock = (id)=> canMutateSharedFilm() && setProject(p=>({ ...p, styleBible:{ ...((p.styleBible)||{}), filmStock:String(id||"none"), filmStockManual:true } }));'));
  assert.ok(read("app/artroom.jsx").includes("onSetFilmStock:readOnly?null:onSetFilmStock"));
  const tree = view({ presets:looks, filmStock:"portra" }, { onSetFilmStock:null });
  assert.ok(!findAll(tree, n=>n.type==="select" && n.props["aria-label"]==="Film stock").length);
  assert.match(textOf(findAll(tree, hasClass("sb-stock-name"))[0]), /Kodak Portra/);
});

/* ═══ B + C: the app's real setters ═══ */
const ab = { console, Object, Array, String, Set, JSON, Math }; ab.window = ab; vm.createContext(ab);
vm.runInContext(sbData, ab);
vm.runInContext(`let project = {}; const setProject = (f)=>{ project = f(project); return true; };
  const coloristRedoManualRef = { current:false };
  // (2026-10-08) the colour handlers check edit rights and the film; this role may change the Art Room
  const artRoomReadOnlyRef = { current:false }, canMutateSharedFilm = ()=>true, projIdRef = { current:"film" };
  const scenesRef = { current:[] }, scenes = [], lookbook = [], lookbookNote = "", markApplied = ()=>{};
  ${between(app, "  const applyStyleResult = (res, seed, opts)=>{", "  // ---- Art Room: SHOT LIST ----")}
  this.api = { get:()=>project, set:(p)=>{ project = p; }, redo:(v)=>{ coloristRedoManualRef.current = v; },
    applyStyleResult, setScenePreset, setFilmStock, updateStylePreset, deleteStylePreset };`, ab);
const api = ab.api;
const fresh = { presets:[ { id:"gold", name:"Gold", palette:["#a80","#640","#fe8"] }, { id:"slate", name:"Slate", palette:["#123","#456","#789"] } ],
  sceneStyles:{ s1:"gold", s2:"slate", s3:"gold" }, filmStock:"16mm",
  rationale:{ palette:"Heat against stone.", scenes:{ s1:"warm start", s2:"cold turn", s3:"warm again" } } };
await test("B1 a scene picked by hand keeps its look — and that look stays in the set — when the film is lit again", ()=>{
  api.set({ styleBible:{ presets:looks, sceneStyles:{} } });
  api.setScenePreset("s2", "ash");
  let sb = api.get().styleBible;
  assert.deepEqual(J(sb.sceneStylesManual), { s2:true });
  api.redo(false); api.applyStyleResult(J(fresh));
  sb = api.get().styleBible;
  assert.equal(sb.sceneStyles.s2, "ash", "kept"); assert.equal(sb.sceneStyles.s1, "gold");
  assert.deepEqual(J(sb.presets.map(p=>p.id)), ["gold", "slate", "ash"], "the hand-picked look survives the new set");
  assert.deepEqual(J(sb.sceneStylesManual), { s2:true });
  assert.equal(sb.filmStock, "16mm");
});
await test("B2 'Also redo' hands every scene back to the Colorist", ()=>{
  api.set({ styleBible:{ presets:looks, sceneStyles:{ s2:"ash" }, sceneStylesManual:{ s2:true } } });
  api.redo(true); api.applyStyleResult(J(fresh)); api.redo(false);
  const sb = api.get().styleBible;
  assert.equal(sb.sceneStyles.s2, "slate"); assert.deepEqual(J(sb.sceneStylesManual), {});
  assert.deepEqual(J(sb.presets.map(p=>p.id)), ["gold", "slate"]);
});
await test("C1 the Colorist's reasons are stored (never for a hand-picked scene); picking by hand drops the scene's reason", ()=>{
  api.set({ styleBible:{ presets:looks, sceneStyles:{ s2:"ash" }, sceneStylesManual:{ s2:true } } });
  api.applyStyleResult(J(fresh));
  let sb = api.get().styleBible;
  assert.deepEqual(J(sb.sceneWhy), { s1:"warm start", s3:"warm again" });
  assert.equal(sb.paletteWhy, "Heat against stone.");
  api.setScenePreset("s1", "slate");
  sb = api.get().styleBible;
  assert.deepEqual(J(sb.sceneWhy), { s3:"warm again" }); assert.equal(sb.sceneStylesManual.s1, true);
  api.setScenePreset("s1", null);
  assert.equal(api.get().styleBible.sceneStylesManual.s1, undefined, "unassigning clears the mark");
});
await test("C2 the film-strip marks hand-picked scenes and shows the reason; the redo choice reaches Light the film", ()=>{
  const sb = { presets:looks, sceneStyles:{ s1:"ember", s2:"ash" }, sceneStylesManual:{ s2:true }, sceneWhy:{ s1:"warm start" }, paletteWhy:"Heat." };
  R.reset();
  const strip = box.StyleFilmStrip({ scenes, project:{ styleBible:sb }, presets:looks, onSetScenePreset:noop });
  const cells = findAll(strip, hasClass("sb-strip-cell"));
  assert.match(cells[0].props.title, /\nwarm start/); assert.match(cells[1].props.title, /set by hand/);
  assert.equal(findAll(cells[1], hasClass("sb-strip-hand")).length, 1); assert.equal(findAll(cells[0], hasClass("sb-strip-hand")).length, 0);
  const tree = view(sb);
  assert.equal(textOf(findAll(tree, hasClass("sb-palette-why"))[0]), "Heat.");
  R.reset([ "", true ]);   // StyleRefsField state: v, redoManual, saved
  const field = box.StyleRefsField({ value:"", onCommit:noop, onLight:(r,o)=>{ box.__lit = o; }, manualCount:1, refImages:[] });
  assert.match(textOf(field), /Also redo the 1 scene I set by hand/);
  findAll(field, n=>n.type==="button" && /Light the film/.test(textOf(n)))[0].props.onClick();
  assert.deepEqual(J(box.__lit), { redoManual:true });
});
await test("C3 the proposal says how many hand-picked scenes it keeps, and shows them as kept", async ()=>{
  const ag = { console }; ag.window = ag; vm.createContext(ag);
  vm.runInContext(between(agents, "async function agentColorist(ctx){", "/* =========================================================\n   AGENT 7"), ag);
  let card = null, applied = null;
  await ag.agentColorist({ ai:{ available:true }, emit:noop, cancelled:()=>false, propose:async (c)=>{ card = c; return true; },
    art:{ scenesLite:scenes, designStyles:async ()=>J(fresh), applyStyles:(r)=>{ applied = r; }, manualScenes:()=>["s2"] } });
  assert.match(card.reason, /except the 1 scene you set by hand, which keep their look/);
  assert.deepEqual(J(card.colorProposal.keptManual), ["s2"]); assert.ok(applied);
  assert.ok(agentsUi.includes("const kept=(p.keptManual||[]).indexOf(s.id)>=0;") && agentsUi.includes('" — keeps the look you set by hand"'));
  assert.ok(app.includes("manualScenes: ()=>{ const sb=(project&&project.styleBible)||{}; if(_redoManual0) return [];"))   // the run's own choice (2026-10-08);
  assert.ok(app.includes("onClose:()=>{ coloristRedoManualRef.current = false; setColoristOpen(false); },"), "the redo choice lasts one run");
});

/* ═══ D + E ═══ */
await test("D1 not lit yet: a note, and the starter looks are labelled examples", ()=>{
  const tree = expand(view({}));
  assert.match(textOf(findAll(tree, hasClass("sb-unlit"))[0]), /Not lit yet\. The looks below are examples/);
  const cards = findAll(tree, hasClass("sb-card"));
  assert.equal(cards.length, 5); assert.ok(cards.every(hasClass("example")));
  assert.ok(cards.every(c=>/example/.test(textOf(findAll(c, hasClass("sb-card-count"))[0]))));
  assert.equal(findAll(expand(view({ presets:looks })), hasClass("sb-unlit")).length, 0);
});
await test("E1 each look previews on a plate from a scene that uses it (else any plate, else the drawn room); no 'Ungraded' twin", ()=>{
  box.turnContinuity = { locations:[ { id:"kitchen", scenes:["s1"] }, { id:"yard", scenes:["s2"] } ] };
  images = new Set(["kitchen", "yard"]);
  let tree = expand(view({ presets:looks, sceneStyles:{ s1:"ember", s2:"ash" } }));
  const imgs = findAll(tree, n=>n.type==="img" && hasClass("sb-still-img")(n)).map(n=>n.props.src);
  assert.deepEqual(imgs, ["blob:kitchen", "blob:yard"]);
  assert.ok(!/Ungraded/.test(textOf(tree)));
  assert.equal(findAll(tree, hasClass("sb-still")).length, 2, "one preview per look");
  images = new Set();
  tree = expand(view({ presets:looks }));
  assert.equal(findAll(tree, n=>n.type==="img").length, 0); assert.equal(findAll(tree, hasClass("sb-sky")).length, 2, "drawn stand-in");
  box.turnContinuity = { locations:[] };
});

/* ═══ F ═══ */
await test("F1 Edit: name, the three colours and their names, the four notes", ()=>{
  let upd = null;
  R.reset([ true ]);   // editing
  const card = box.PresetCard({ preset:looks[0], sceneList:[], count:0, onUpdate:(p)=>{ upd = p; }, onDelete:noop });
  const colors = findAll(card, n=>n.type==="input" && n.props.type==="color");
  assert.equal(colors.length, 3);
  colors[1].props.onChange({ target:{ value:"#00ff00" } }); assert.deepEqual(J(upd), { palette:["#331100","#00ff00","#ffdd99"] });
  const areas = findAll(card, n=>n.type==="textarea");
  assert.equal(areas.length, 4);
  areas[0].props.onBlur({ target:{ value:"hot, lifted blacks" } }); assert.deepEqual(J(upd), { grade:"hot, lifted blacks" });
  const name = findAll(card, n=>n.type==="input" && n.props.type==="text")[0];
  name.props.onBlur({ target:{ value:"Embers" } }); assert.deepEqual(J(upd), { name:"Embers" });
});
await test("F2 Delete asks first and says what happens to its scenes; the app unassigns them", async ()=>{
  let gone = false; confirms = []; answer = true;
  R.reset();
  const card = box.PresetCard({ preset:looks[1], sceneList:[scenes[1]], count:1, onUpdate:noop, onDelete:()=>{ gone = true; } });
  await findAll(card, n=>n.type==="button" && n.props.title==="Delete this look")[0].props.onClick();
  assert.equal(confirms.length, 1); assert.match(confirms[0].body, /1 scene using it will have no look/); assert.ok(gone);
  api.set({ styleBible:{ presets:looks, sceneStyles:{ s1:"ember", s2:"ash" }, sceneStylesManual:{ s2:true }, sceneWhy:{ s2:"x" } } });
  api.deleteStylePreset("ash");
  const sb = api.get().styleBible;
  assert.deepEqual(J(sb.presets.map(p=>p.id)), ["ember"]); assert.deepEqual(J(sb.sceneStyles), { s1:"ember" });
  assert.deepEqual(J(sb.sceneStylesManual), {}); assert.deepEqual(J(sb.sceneWhy), {});
  api.set({ styleBible:{} });
  api.updateStylePreset("noir", { name:"My Noir" });
  assert.equal(api.get().styleBible.presets.find(p=>p.id==="noir").name, "My Noir", "editing an example makes the set the film's own");
  assert.equal(api.get().styleBible.presets.length, 5);
});

/* ═══ G ═══ */
await test("G1 Light the film says it's writing credits only; Frances knows all of it", ()=>{
  assert.ok(ui.includes("proposed for your approval. Writing credits only, no images (a little more when it looks at your reference stills)."));
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const c = (fb.__F.find(f=>f.name==="Color / scene looks (Art Room)")||{}).what || "";
  assert.ok(!/does NOT pick it manually|before\\u2192after|before→after/.test(c));
  assert.ok(/'Film stock' picker/.test(c) && /EDITING LOOKS/.test(c) && /'Not lit yet'/.test(c));
  assert.ok(/EXCEPT the ones you set by hand/.test(c) && /'Also redo the scenes I set by hand'/.test(c) && /per-scene 'why' is kept/.test(c));
  assert.ok(/location plates/.test(c) && /writing credits only, no images/.test(c));
  assert.ok(!/TURN|McKee|Claude|Anthropic/.test(c));
});
await test("G2 new styles use theme tokens only", ()=>{
  const css = read("app/styles.css");
  const rules = css.match(/\.sb-(?:still-img|card-acts|card-btn|edit|strip-hand|pick-why|redo|unlit|palette-why|stock)[^{]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 12, rules.length);
  assert.ok(rules.every(r=>!/#[0-9a-f]{3,6}\b|rgb\(/i.test(r)));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

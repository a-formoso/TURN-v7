#!/usr/bin/env node
/* The Props review (owner 2026-10-03: "go ahead with all of it").
   A  nothing builds in the background: the worn-item build after a first character sheet is off
      unless window.TURN_WORN_PROP_AUTO; the character card's "Make N worn-item sheets" runs it on
      demand, priced, with no automatic master re-bake
   B  the owner's sheet is never made silently: a single generate asks (owner first / prop only /
      cancel); a batch asks once for every owner it would need, with the price
   C  Draft N specifications drafts only cards with no spec; "Redraft all…" asks; failures are said
   D  Generate N missing images (all + per scene) — priced for exactly those, never "Not in screenplay"
      objects; "Regenerate…" only once nothing is missing
   E  delete asks first; "No props in this story" only with the tab locks on; the tab never opens on
      an empty view
   F  the card: essentials open, the rest in "More detail"; story events pick beat / micro / shot;
      the generation prompt is behind the ⋯ menu
   G  Frances knows all of it
     node scripts/test-props-review.mjs */
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

const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const buttons = (tree)=> findAll(tree, n=>n.type==="button");
const R = { Fragment:"fragment", createElement:el, state:null, calls:[], setters:{},
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v);
    return [v, (x)=>{ R.setters[i] = typeof x==="function" ? x(v) : x; }]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(st){ R.state = st || null; R.calls = []; R.setters = {}; } };
const icon = new Proxy({}, { get:()=>()=>null });

const props = read("app/props.jsx"), art = read("app/artroom.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css");

let images = new Set(), confirms = [], answer = true;
const box = { console, React:R, Icon:icon, Set, Map, Object, Array, String, Number, Math, JSON, Date, Promise,
  document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {}, requestAnimationFrame:noop,
  nbCostChip:(count)=>({ type:"chip", props:{ count }, children:[] }), nbImageCostText:(n)=>String(12*n),
  nbGetImage:(id)=> images.has(id) ? "blob:"+id : "", nbLoadImage:async (id)=> images.has(id) ? "blob:"+id : "",
  appConfirm:async (o)=>{ confirms.push(o); return typeof answer==="function" ? answer(o) : answer; },
  useBatchGen:()=>({ activeId:null, begin:(ids, skipped)=>{ box.__begun = { ids, skipped }; }, setMsg:(m)=>{ box.__msg = m; }, advance:noop }),
  usePager:()=>({ slice:(a)=>a }), PagerBar:"PagerBar", NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar",
  ImageLightbox:"ImageLightbox", InfoTip:"InfoTip", RecentlyDeleted:"RecentlyDeleted", RenderStylePicker:"RenderStylePicker",
  SheetFrame:"SheetFrame", SheetField:"SheetField", CardFold:"CardFold", CopyBox:"CopyBox", EditText:"EditText", SceneChipPager:"SceneChipPager",
  scenesInStoryOrder:(s)=>s||[], roomCopy:()=>({}), scenesWhereCharacterAppears:()=>[], turnContinuity:{ scenes:[], locations:[] },
  useImageGen:()=>({ gening:false, genUrl:"", generate:async (o)=>{ box.__generated = (box.__generated||[]).concat([o||{}]); return true; } }),
};
box.window = box; vm.createContext(box);
vm.runInContext(read("app/prop-screenplay.js"), box, { filename:"app/prop-screenplay.js" });
vm.runInContext(transform(props, "props.jsx"), box, { filename:"app/props.jsx" });
const sheets = (list, extra, state)=>{ R.reset(state); return box.PropSheets({ project:{}, props:list, characters:[{ id:"ana", name:"Ana" }, { id:"ben", name:"Ben" }],
  scenes:[{ id:"s1", no:1, title:"Dock" }], drafts:{}, onUpdate:noop, onDraft:noop, onDraftAll:(m)=>{ box.__draftAll = m===undefined ? "missing" : m; }, onAdd:noop,
  onImportProps:noop, onDelete:noop, castHasProps:false, trashItems:[], onRestore:noop, onPurge:noop, ...(extra||{}) }); };
const src = (sceneId, n)=>({ screenplaySources:[{ sceneId, sceneNo:n||1, block:1, quote:"x", presence:"handled" }] });
const P = (id, extra)=>({ id, name:id+" object", kind:"carried", ownerId:"ana", ownerName:"Ana", form:"f", material:"m", scenes:["s1"], manual:true, ...(extra||{}) });

/* ═══ A ═══ */
await test("A1 the background worn-item build waits unless window.TURN_WORN_PROP_AUTO; manual runs skip the re-bake", ()=>{
  const fx = between(app, "const onCharacterSheetDone = async (e, manual)=>{", "const onPropDrafted");
  assert.ok(fx.includes("if(!manual && window.TURN_WORN_PROP_AUTO!==true) return;"));
  assert.ok(fx.includes("if(gate.ok && !manual){"), "an on-demand build never re-makes the character's sheet");
  assert.ok(app.includes("wornBuildRef.current = (charId)=> onCharacterSheetDone({ detail:{ id:charId } }, true);"));
  assert.ok(app.includes("onBuildWornProps:(c)=>{ if(c && wornBuildRef.current) wornBuildRef.current(c.id); },"));
  assert.ok(!/TURN_WORN_PROP_AUTO\s*=\s*true/.test(app + read("TURN.html")), "nothing turns it on");
});
await test("A2 the character card offers 'Make N worn-item sheets' with the price, only once it has a sheet", ()=>{
  const card = between(art, "function CharacterSheet({", "function CharacterSheets(");
  assert.ok(card.includes("const missingWorn = linkedRows.filter(r=> !r.orphan && r.src===\"worn\" && !(r.prop && ownedSheetMap[r.prop.id])).length;"));
  assert.ok(card.indexOf("const missingWorn") > card.indexOf("const [ownedSheetMap, setOwnedSheetMap]"), "declared after the sheet map (no TDZ)");
  assert.ok(card.includes('(onBuildWornProps && missingWorn>0 && gen.genUrl) && React.createElement("button",{className:"linked-props-make",'));
  assert.ok(card.includes('("Make "+missingWorn+" worn-item sheet"+(missingWorn!==1?"s":""))'));
  assert.ok(card.includes("window.nbCostChip(missingWorn)"));
  for(const f of ["function CharacterSheets(", "function ArtRoom("]) assert.ok(between(art, f, "){").includes("onBuildWornProps"), f);
});

/* ═══ B ═══ */
const gen = async (p, choice, ownerHas)=>{
  images = new Set(ownerHas ? ["ana"] : []); confirms = []; answer = choice; box.__generated = []; let ensured = 0;
  R.reset();
  const tree = box.PropSheet({ p, project:{}, characters:[], scenes:[], drafts:{}, onUpdate:noop, onDelete:noop, onDraft:noop,
    onEnsureOwner:async ()=>{ ensured++; }, batchOwnerChoice:(choice && choice.batch) || "skip" });
  const frame = findAll(tree, n=>n.type==="SheetFrame")[0];
  const res = await frame.props.gen.generate(choice && choice.batch ? { batch:true } : undefined);
  return { res, ensured, confirms, generated:box.__generated.length, frame };
};
await test("B1 one prop, owner without a sheet: asks; 'owner first' makes it, 'prop only' doesn't, Cancel makes nothing", async ()=>{
  let r = await gen(P("a"), true, false);
  assert.equal(r.confirms.length, 1); assert.equal(r.ensured, 1); assert.equal(r.generated, 1);
  assert.match(r.confirms[0].title, /Ana has no character sheet yet/);
  assert.match(r.confirms[0].body, /about 12 credits more/);
  assert.equal(r.confirms[0].altLabel, "Make the prop only");
  r = await gen(P("a"), "alt", false); assert.equal(r.ensured, 0); assert.equal(r.generated, 1);
  r = await gen(P("a"), false, false); assert.equal(r.ensured, 0); assert.equal(r.generated, 0);
  r = await gen(P("a"), true, true); assert.equal(r.confirms.length, 0, "owner already has a sheet → no question"); assert.equal(r.generated, 1);
});
await test("B2 inside a batch the card never asks: it follows the batch's one answer", async ()=>{
  let r = await gen(P("a"), { batch:"owner" }, false); assert.equal(r.confirms.length, 0); assert.equal(r.ensured, 1);
  r = await gen(P("a"), { batch:"skip" }, false); assert.equal(r.confirms.length, 0); assert.equal(r.ensured, 0); assert.equal(r.generated, 1);
});

/* ═══ C + D ═══ */
await test("C1 the header drafts only the missing specs; 'Redraft all…' once none are missing", ()=>{
  let tree = sheets([P("a"), P("b", { form:"", material:"" })]);
  const d = buttons(tree).find(b=>/Draft 1 specification$/.test(textOf(b)));
  assert.ok(d, buttons(tree).map(textOf).join(" | ")); d.props.onClick(); assert.equal(box.__draftAll, "missing");
  assert.ok(!buttons(tree).some(b=>/Redraft all/.test(textOf(b))));
  tree = sheets([P("a")]);
  const r = buttons(tree).find(b=>/Redraft all/.test(textOf(b)));
  assert.ok(r && hasClass("ghost")(r)); r.props.onClick(); assert.equal(box.__draftAll, "redraft");
});
await test("C2 the app: only cards with no spec are sent; Redraft asks first; a failure is said", ()=>{
  const fx = between(app, "  const draftAllProps = async (mode)=>{", "  // Pull standalone prop cards");
  assert.ok(fx.includes('const redraft = mode==="redraft";'));
  assert.ok(fx.includes("const toDraft = redraft ? working"));
  assert.ok(fx.includes("await aiDesignPropBible(toDraft, characters, lbProject(\"props\"));"));
  assert.ok(fx.indexOf("appConfirm") < fx.indexOf("setDraftingAllProps(true)"));
  assert.ok(fx.includes("Couldn't draft the prop specifications") && !/catch\(e\)\{\}/.test(fx));
});
await test("D1 'Generate N missing images' prices only drafted, anchored, screenplay-established props without an image", async ()=>{
  images = new Set(["a"]);
  const list = [P("a", src("s1")), P("b", src("s1")), P("c", { ...src("s1"), ownerId:"", ownerName:"" }),
    P("d", { manual:false }),                   // Not in screenplay → never batched
    P("e", { ...src("s1"), form:"" }),          // undrafted
    P("w", { ...src("s1"), kind:"worn" })];     // worn → on the character sheet
  const tree = sheets(list);
  const b = buttons(tree).find(x=>/Generate 1 missing image$/.test(textOf(x)));
  assert.ok(b, buttons(tree).map(textOf).join(" | "));
  assert.equal(findAll(b, n=>n.type==="chip")[0].props.count, 1);
  images = new Set(["a", "ana"]); confirms = []; box.__begun = null;
  await b.props.onClick();
  assert.deepEqual(J(box.__begun), { ids:["b"], skipped:0 }); assert.equal(confirms.length, 0, "Ana has a sheet → no question");
});
await test("D1b before any extraction, 'Not in screenplay' cards still batch (the flag says nothing yet)", ()=>{
  images = new Set(["ana"]);
  const tree = sheets([P("a", { manual:false }), P("b", { manual:false })]);
  const b = buttons(tree).find(x=>/Generate 2 missing images/.test(textOf(x)));
  assert.ok(b, buttons(tree).map(textOf).join(" | "));
});
await test("D2 a batch asks once about owners without a sheet, with their names and price; Cancel starts nothing", async ()=>{
  images = new Set();
  const list = [P("a", src("s1")), P("b", { ...src("s1"), ownerId:"ben", ownerName:"Ben" }), P("c", src("s1"))];
  const tree = sheets(list);
  const b = buttons(tree).find(x=>/Generate 3 missing images/.test(textOf(x)));
  confirms = []; answer = true; box.__begun = null;
  await b.props.onClick();
  assert.equal(confirms.length, 1); assert.deepEqual(J(confirms[0].items), ["Ana", "Ben"]);
  assert.match(confirms[0].title, /2 owners have no character sheet yet/); assert.match(confirms[0].body, /about 24 credits more/);
  assert.equal(R.setters[Object.keys(R.setters).find(k=>R.setters[k]==="owner")], "owner", "the batch follows 'owner first'");
  assert.deepEqual(J(box.__begun.ids), ["a","b","c"]);
  answer = false; box.__begun = null; confirms = [];
  await b.props.onClick(); assert.equal(box.__begun, null);
});
await test("D3 nothing missing → only a quiet 'Regenerate images…'; a focused scene gets its own priced button", async ()=>{
  images = new Set(["a", "ana"]);
  let tree = sheets([P("a", src("s1"))]);
  assert.ok(!buttons(tree).some(x=>/missing/.test(textOf(x))));
  const re = buttons(tree).find(x=>/Regenerate images/.test(textOf(x))); assert.ok(re && hasClass("ghost")(re));
  images = new Set(["ana"]);
  // useState order in PropSheets: view, sceneFilter, …
  tree = sheets([P("a", src("s1")), P("b", src("s1"))], {}, { 1:"s1" });
  const g = buttons(tree).find(x=>/Generate 2 missing in Scene 01/.test(textOf(x)));
  assert.ok(g, buttons(tree).map(textOf).join(" | ")); assert.equal(findAll(g, n=>n.type==="chip")[0].props.count, 2);
  box.__begun = null; await g.props.onClick(); assert.deepEqual(J(box.__begun), { ids:["a","b"], skipped:0 });
});

/* ═══ E ═══ */
await test("E1 deleting a prop asks first and says it goes to Recently Deleted", ()=>{
  const frame = between(art, "function SheetFrame({", "function activeStateForScene(");
  assert.ok(frame.includes('else if(/prop/i.test(deleteLabel||"")){') && frame.includes('confirmLabel:"Delete prop", cancelLabel:"Cancel", danger:true'));
});
await test("E2 'No props in this story' shows only with the tab locks on", ()=>{
  box.TURN_ART_TAB_LOCKS = undefined;
  let tree = sheets([], { onSetNoProps:noop });
  assert.ok(!buttons(tree).some(b=>/No props in this story/.test(textOf(b))));
  box.TURN_ART_TAB_LOCKS = true;
  tree = sheets([], { onSetNoProps:noop });
  assert.ok(buttons(tree).some(b=>/No props in this story/.test(textOf(b))));
  box.TURN_ART_TAB_LOCKS = undefined;
});
await test("E3 the tab opens on All objects when there are no story props", ()=>{
  assert.ok(props.includes('if(!groupPicked.current && inventoryGroup==="story" && list.length>0 && storyN===0) setInventoryGroupRaw("all");'));
  assert.ok(props.includes("const setInventoryGroup = (g)=>{ groupPicked.current = true; setInventoryGroupRaw(g); };"));
});

/* ═══ F ═══ */
const card = between(props, "function PropSheet({", "function PropExtractionReview(");
await test("F1 the Object section: essentials first, the rest folded into 'More detail'", ()=>{
  const obj = between(card, 'React.createElement(CardFold,{label:"Object"', 'React.createElement(CardFold,{label:"Narrative significance"');
  const more = obj.indexOf('className:"prop-more-fields"');
  assert.ok(more > 0);
  for(const f of ['"Owner"', '"Reference image"', 'label:"Form \\u2014 shape & silhouette"', 'label:"Material & finish"', 'label:"Physical dimensions"', '"Fixture of"'])
    assert.ok(obj.indexOf(f) > 0 && obj.indexOf(f) < more, f+" stays open");
  for(const f of ['"Inventory group"', 'label:"Other names for this same object"', '"Custodian"', '"Design association"', 'label:"Owner / origin — canonical provenance"', '"Dimension source"', 'className:"prop-content-fields"'])
    assert.ok(obj.indexOf(f) > more, f+" is under More detail");
});
await test("F2 story events: beat / micro-beat / shot are picked from the chosen scene", ()=>{
  R.reset();
  box.turnContinuity = { scenes:[], locations:[], beatsMap:{ s1:{ rows:[{ n:1, drive:{ d:"Ana pockets the key" } }, { n:2 }] } },
    shots:[{ id:"sh2", sceneId:"s1", order:2, size:"CU" }, { id:"sh1", sceneId:"s1", order:1, size:"WS" }, { id:"x", sceneId:"s9" }] };
  const tree = box.PropSheet({ p:P("a", { continuityEvents:[{ id:"e1", type:"placed", sceneId:"s1", beatId:"1", shotId:"" }] }),
    project:{}, characters:[], scenes:[{ id:"s1", no:1, title:"Dock" }], drafts:{}, onUpdate:noop, onDelete:noop, onDraft:noop });
  const sel = (label)=> findAll(tree, n=>n.type==="select" && n.props["aria-label"]===label)[0];
  const opts = (s)=> findAll(s, n=>n.type==="option").map(textOf);
  assert.deepEqual(opts(sel("Beat")), ["Whole scene", "Beat 1 — Ana pockets the key", "Beat 2"]);
  assert.ok(sel("Micro-beat"), "a micro-beat once a beat is chosen");
  assert.deepEqual(opts(sel("Shot")), ["Any shot", "Shot 1 · WS", "Shot 2 · CU"]);
  assert.ok(!card.includes('className:"prop-event-input"'), "no free-text id boxes");
  box.turnContinuity = { scenes:[], locations:[] };
});
await test("F3 the generation prompt is behind the card's ⋯ menu", ()=>{
  assert.ok(card.includes('menuExtra:[{ label:showPrompt ? "Hide the generation prompt" : "Show the generation prompt", icon:Icon.eye,'));
  assert.ok(card.includes('showPrompt && React.createElement(CardFold,{label:"Generation prompt",defaultOpen:true},'));
});

/* ═══ G ═══ */
await test("G1 Frances: no background builds, owners asked first, missing-only drafting and images, the card", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const F = fb.__F, all = F.map(f=>f.what).join("\n");
  assert.ok(!/Generate all images|still build in the background|This is now GUARANTEED: if you generate a prop/.test(all));
  assert.ok(/NOTHING BUILDS IN THE BACKGROUND/.test(all) && /'Make N worn-item sheets'/.test(all));
  assert.ok(/Kinolot ASKS FIRST/.test(all) && /A batch asks once for all the owners it would need/.test(all));
  assert.ok(/'Draft N specifications' \(only the cards with no spec yet/.test(all) && /'Redraft all\\u2026'|Redraft all…/.test(all));
  assert.ok(/'Generate N missing images'/.test(all) && /batches leave out objects marked Not in screenplay/.test(all));
  const tab = (F.find(f=>f.name==="Props (Art Room)")||{}).what || "";
  assert.ok(/ONE SCENE/.test(tab) && /DELETING A PROP asks first/.test(tab) && /'More detail'/.test(tab) && /STORY EVENTS/.test(tab) && /'Show the generation prompt'/.test(tab));
  assert.ok(!/TURN|McKee|Claude|Anthropic/.test(tab));
});
await test("G2 new styles use theme tokens only", ()=>{
  const rules = css.match(/\.linked-props-make[^{]*\{[^}]*\}|\.prop-more-fields[^{]*\{[^}]*\}|\.prop-event-pick\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 5);
  assert.ok(rules.every(r=>!/#[0-9a-f]{3,6}\b|rgb\(/i.test(r)));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

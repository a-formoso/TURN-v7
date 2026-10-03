#!/usr/bin/env node
/* The Lookbook review (owner 2026-10-03: "go ahead with all of it").
   A  cards: two hand-added cards both stay; one touchstone in two categories both stay; the same
      touchstone for the same category is one card; deleted cards are kept but never read
   B  mood frames are rendered in the film's medium (photoreal until one is picked); no "--ar"
   C  "Generate missing frames": only references with a note and no frame; the price is for all
      of them; nothing to render → "All frames rendered"
   D  deleting asks first and moves the card (with its frame) to Recently deleted; restore / delete
      forever; every write-back keeps the bin
   E  "Research again": fill the missing categories, or research from scratch (hand-added cards stay,
      researched ones go to Recently deleted, the statement is cleared, the agent opens next tick)
   F  "Suggest a note": one writing call; names a touchstone only on a hand-added card
   G  the frame prompt is behind the card's ⋯ menu; Frances knows all of it
     node scripts/test-lookbook-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]],
  plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename }).code;
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
const R = { Fragment:"fragment", createElement:el, state:null, calls:[],
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v); return [v, noop]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(st){ R.state = st || null; R.calls = []; } };
const icon = new Proxy({}, { get:()=>()=>null });
const box = { console, React:R, Icon:icon, document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {}, requestAnimationFrame:noop,
  useBatchGen:()=>({ activeId:null, begin:(ids, skipped)=>{ box.__begun = { ids, skipped }; }, setMsg:(m)=>{ box.__msg = m; }, advance:noop }),
  nbCostChip:(count)=>({ type:"chip", props:{ count }, children:[] }), nbGetImage:()=>"",
  SheetFrame:"SheetFrame", SheetField:"SheetField", CardFold:"CardFold", CopyBox:"CopyBox", EditText:"EditText",
  NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar", ImageLightbox:"ImageLightbox", InfoTip:"InfoTip",
  RecentlyDeleted:"RecentlyDeleted", useImageGen:()=>({ gening:false, genUrl:"", generate:noop }) };
box.window = box; vm.createContext(box);
const lookSrc = read("app/lookbook.jsx");
vm.runInContext(transform(lookSrc, "lookbook.jsx"), box, { filename:"app/lookbook.jsx" });

/* ═══ A ═══ */
await test("A1 two cards added by hand both stay (they used to share the name 'Palette study' and one vanished)", ()=>{
  const cards = [{ id:"a", source:"Palette study", category:"Palette", manual:true, autoNamed:true },
    { id:"b", source:"Palette study", category:"Palette", manual:true, autoNamed:true }];
  assert.deepEqual(J(box.dedupeLookbookCards(cards).map(c=>c.id)), ["a", "b"]);
});
await test("A2 one touchstone in two categories both stay; the same touchstone for the same category is one card", ()=>{
  const cards = [{ id:"1", source:"Roger Deakins", category:"Lighting", note:"soft top light" },
    { id:"2", source:"Roger Deakins (Skyfall)", category:"Lens & format", note:"wide anamorphic" },
    { id:"3", source:"roger deakins", category:"Lighting", note:"" }];
  assert.deepEqual(J(box.dedupeLookbookCards(cards).map(c=>c.id)), ["1", "2"]);
  assert.match(box.lookbookBriefFor("shots", cards, ""), /wide anamorphic/, "the second category's note reaches its department");
});
await test("A3 a deleted card is kept but never read: not on the grid, not in a brief, not 'a look'", ()=>{
  const cards = [{ id:"x", source:"Vermeer", category:"Lighting", note:"window light", deletedAt:"2026-10-03T10:00:00Z" }];
  assert.deepEqual(J(box.dedupeLookbookCards(cards)), []);
  assert.equal(box.lookbookBriefFor("colorist", cards, ""), "");
  assert.equal(box.lookbookHasLook(cards, ""), false);
  assert.deepEqual(J(box.lookbookDeleted(cards).map(c=>c.id)), ["x"]);
  assert.deepEqual(J(box.lookbookKeepDeleted([...cards, { id:"y" }], [{ id:"z" }]).map(c=>c.id)), ["z", "x"], "a write-back keeps the bin");
  assert.deepEqual(J(box.lookbookKeepDeleted(cards, [{ id:"x" }]).map(c=>c.id)), ["x"], "a card live again isn't also in the bin");
});

/* ═══ B ═══ */
await test("B1 mood frames: photoreal until the film has a medium; then rendered in it; no '--ar' token", ()=>{
  const c = { id:"c", category:"Lighting", note:"tungsten pools" };
  box.turnFilmRenderStyle = null;
  let p = box.buildLookbookPrompt(c, {});
  assert.match(p, /Photoreal, evocative, filmic, shallow depth of field\.$/); assert.doesNotMatch(p, /--ar/);
  box.turnFilmRenderStyle = { key:"pixar", label:"Animated 3D", medium:"stylized 3D animation, soft subsurface skin" };
  p = box.buildLookbookPrompt(c, {});
  assert.match(p, /RENDER IN THE FILM'S MEDIUM — Animated 3D: stylized 3D animation, soft subsurface skin\. Evocative, filmic\.$/);
  assert.doesNotMatch(p, /Photoreal/);
  assert.match(box.buildSimpleLookbookPrompt(c), /Animated 3D, atmospheric\.$/);
  box.turnFilmRenderStyle = null;
  const app = read("app/app.jsx");
  assert.ok(app.includes("window.turnFilmRenderStyle = filmRenderStyle;") && app.includes('if(!top || top==="photoreal" || top==="surprise") return null;'));
  assert.ok(app.indexOf("const filmRenderStyle = React.useMemo(") < app.indexOf("if(authGate && !authReady){"), "above every early return");
});

/* ═══ C ═══ */
const cards = [
  { id:"r1", source:"Vermeer", category:"Lighting", note:"window light" },
  { id:"r2", source:"Hopper", category:"Palette", note:"teal and amber" },
  { id:"r3", source:"Wong Kar-wai", category:"Texture & grain", note:"step-printed blur" },
  { id:"r4", source:"Lighting study", category:"Lighting", note:"", manual:true, autoNamed:true },
];
const viewWith = (framedMap, extra = {})=>{
  // hooks in order: view(0), researchMenu(1), framed(2)
  R.reset({ 2:framedMap });
  return box.LookbookView({ project:{}, lookbook:cards, note:"A cold film", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop,
    onResearch:noop, onResearchFresh:noop, onRestore:noop, onPurge:noop, onSuggestNote:noop, ...extra });
};
const genBtn = (tree)=> findAll(tree, n=>n.type==="button" && hasClass("art-draftall")(n) && !hasClass("ghost")(n))[0];
await test("C1 'Generate missing frames' renders only the noted cards without a frame, and is priced for all of them", ()=>{
  const tree = viewWith({ r1:true });
  const b = genBtn(tree);
  assert.match(textOf(b), /^Generate missing frames/);
  assert.equal(findAll(b, n=>n.type==="chip")[0].props.count, 2, "r2 and r3: two frames' price");
  box.__begun = null; b.props.onClick();
  assert.deepEqual(J(box.__begun), { ids:["r2", "r3"], skipped:2 }, "r1 has its frame, r4 has no note");
});
await test("C2 every noted card has its frame: 'All frames rendered', no price, nothing re-rendered", ()=>{
  const b = genBtn(viewWith({ r1:true, r2:true, r3:true }));
  assert.match(textOf(b), /^All frames rendered$/); assert.equal(b.props.disabled, true);
  assert.equal(findAll(b, n=>n.type==="chip").length, 0);
});

/* ═══ D ═══ */
await test("D1 deleting asks first; the card goes to Recently deleted with its frame; restore and delete forever", async ()=>{
  const app = read("app/app.jsx");
  const del = app.slice(app.indexOf("const deleteLookbookCard = (id)=>{"), app.indexOf("const restoreLookbookCard"));
  assert.ok(del.includes('{ ...c, deletedAt:new Date().toISOString() }') && !del.includes("nbClearAsset"), "a soft delete that keeps the frame");
  const purge = app.slice(app.indexOf("const purgeLookbookCard = async (id)=>{"), app.indexOf("/* SUGGEST A NOTE"));
  assert.ok(purge.includes("await nbClearAsset(id)") && purge.includes("ls.filter(c=>c.id!==id)"), "delete forever clears the frame");
  assert.ok(app.includes("const { deletedAt, ...live } = c; return live;"), "restore");
  // the card's delete asks
  let asked = null, deleted = null;
  box.appConfirm = async (o)=>{ asked = o; return true; };
  R.reset();
  const card = box.LookbookView({ project:{}, lookbook:[cards[0]], note:"", onUpdate:noop, onAdd:noop, onDelete:(id)=>{ deleted = id; }, onSetNote:noop });
  const lc = findAll(card, n=>typeof n.type==="function" && n.props && n.props.c)[0];
  R.reset();
  const frame = findAll(lc.type(lc.props), n=>n.type==="SheetFrame")[0];
  await frame.props.onDelete();
  assert.match(asked.title, /^Delete “Vermeer”\?$/); assert.match(asked.body, /moves to Recently deleted, with its mood frame/);
  assert.equal(deleted, "r1");
  // the bin renders when there is something in it
  R.reset();
  const withBin = box.LookbookView({ project:{}, lookbook:[...cards, { id:"gone", source:"Kubrick", category:"Composition", note:"one-point", deletedAt:"2026-10-03T09:00:00Z" }],
    note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop, onRestore:noop, onPurge:noop });
  const bin = findAll(withBin, n=>n.type==="RecentlyDeleted")[0];
  assert.ok(bin && bin.props.kind==="reference" && bin.props.items[0].name==="Kubrick" && bin.props.items[0]._deletedAt);
  assert.ok(read("app/artroom.jsx").includes('kind==="reference" ? "reference"'), "the bin says 'reference'");
});
await test("D2 every research write-back keeps the bin (a de-duplicated write used to drop it)", ()=>{
  const app = read("app/app.jsx");
  assert.ok(app.includes("_w.setLookbook(ls=> keepBin(ls, (typeof dedupeLookbookCards===\"function\") ? dedupeLookbookCards([...ls, ...cards]) : [...ls, ...cards]));"));
  assert.ok(app.includes("_w.setLookbook(ls=> keepBin(ls, _lbWork));"));
  assert.ok(app.includes("_w.setLookbook(ls=> ls.filter(c=>!dropIds.has(c.id) || c.deletedAt));"), "the trim keeps the bin");
});

/* ═══ E ═══ */
await test("E1 once researched, the button is 'Research again' with two choices", ()=>{
  R.reset({ 1:true, 2:{} });
  const tree = box.LookbookView({ project:{}, lookbook:cards, note:"A cold film", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop, onResearch:noop, onResearchFresh:noop });
  const menu = findAll(tree, hasClass("lb-research-menu"))[0];
  assert.deepEqual(findAll(menu, n=>n.type==="b").map(textOf), ["Fill the missing categories", "Research from scratch"]);
  R.reset();
  const fresh = box.LookbookView({ project:{}, lookbook:[], note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop, onResearch:noop, onResearchFresh:noop });
  assert.ok(findAll(fresh, n=>n.type==="button" && /Research the look/.test(textOf(n))).length >= 1, "an empty lookbook: 'Research the look'");
});
await test("E2 from scratch: asks, moves the researched cards (not the hand-added ones) to the bin, clears the statement, opens the agent next tick", ()=>{
  const app = read("app/app.jsx");
  const f = app.slice(app.indexOf("const researchLookbookFresh = async ()=>{"), app.indexOf("const purgeLookbookCard"));
  assert.ok(f.includes('title:"Research the look from scratch?"'));
  assert.ok(f.includes("(c && !c.deletedAt && !c.manual && !c.autoNamed) ? { ...c, deletedAt:at } : c"));
  assert.ok(f.includes('setLookbookNote("");') && f.includes("setTimeout(()=>setResearchOpen(true), 0);"));
  assert.ok(app.includes("onResearchFresh:roomReadOnly ? null : researchLookbookFresh,"));
});

/* ═══ F ═══ */
await test("F1 Suggest a note: one writing call; names a touchstone only on a hand-added card; plain refusal on failure", ()=>{
  const ai = read("app/ai.jsx");
  const fn = ai.slice(ai.indexOf("async function aiSuggestLookbookNote("), ai.indexOf("window.aiSuggestLookbookNote = aiSuggestLookbookNote;"));
  assert.equal((fn.match(/window\.claude\.complete\(/g) || []).length, 1, "one call");
  assert.ok(fn.includes("const named = !card.autoNamed && String(card.source||\"\").trim();"));
  assert.ok(fn.includes('const source = named ? "" : clipSpecText(scrubBrand('), "a named card keeps its touchstone");
  assert.ok(fn.includes("NOT the source's story, plot or characters"));
  const app = read("app/app.jsx");
  const hs = app.indexOf("const suggestLookbookNote = async (id)=>{"), h = app.slice(hs, app.indexOf("\n  };\n", hs));
  assert.ok(h.includes("if(!canMutateSharedFilm()) return;") && h.includes("if(card.autoNamed && r.source) Object.assign(patch, { source:r.source, autoNamed:false });"));
  assert.ok(h.includes("Couldn't suggest a note just now"));
  // the card's button
  R.reset();
  const lc = box.LookbookView({ project:{}, lookbook:[cards[3]], note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop, onSuggestNote:noop });
  const card = findAll(lc, n=>typeof n.type==="function" && n.props && n.props.c)[0];
  R.reset();
  const btn = findAll(card.type(card.props), hasClass("lb-suggest"))[0];
  assert.match(textOf(btn), /Suggest a note/); assert.match(btn.props.title, /and suggest a touchstone/);
});

/* ═══ G ═══ */
await test("G1 the frame prompt is behind the ⋯ menu (no 'Reference prompt' fold on the card)", ()=>{
  R.reset();
  const lc = box.LookbookView({ project:{}, lookbook:[cards[0]], note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop });
  const card = findAll(lc, n=>typeof n.type==="function" && n.props && n.props.c)[0];
  R.reset();
  const tree = card.type(card.props);
  assert.equal(findAll(tree, n=>n.type==="CardFold" && n.props.label==="Reference prompt").length, 0);
  assert.equal(findAll(tree, n=>n.type==="CopyBox").length, 0, "hidden until asked");
  assert.equal(findAll(tree, n=>n.type==="SheetFrame")[0].props.menuExtra[0].label, "Show the frame prompt");
  R.reset({ 0:true });
  assert.equal(findAll(card.type(card.props), n=>n.type==="CopyBox").length, 1, "shown from the menu");
});
await test("G2 Frances knows: missing frames and their price, Recently deleted, Suggest a note, Research again, the medium", ()=>{
  const ai = read("app/ai.jsx");
  for(const s of ["'Generate missing frames' batch-renders every reference that has a note and NO frame yet", "LOOKBOOK UPDATES (2026-10-03): DELETING a reference asks first",
    "'Suggest a note' (one writing call)", "'Research again' with two choices", "Mood frames are rendered in the FILM'S MEDIUM"])
    assert.ok(ai.includes(s), s);
  assert.ok(!/'Generate all frames' renders the mood frames/.test(ai));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

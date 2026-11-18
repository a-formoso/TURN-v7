#!/usr/bin/env node
/* The Props tab review, second pass (owner 2026-10-29, "go ahead with all of them"):
   - the Show list: All objects first, then the three groups (which never overlap); "Not in screenplay" went
   - "Read the screenplay again": no separate read button before the first read while Draft N specifications offers it
   - POSSIBLY THE SAME OBJECT under another owner (the sealed letter Nives carries to Aurelio): Merge / Keep separate
   - a SHORT NAME for a card named with a whole description; the full text stays under Other names
   - CROPS AS REFERENCES ("Attach item to prop…" on a character card, "Take a reference from a sheet…" on every prop
     card): the cut rides as itself (it was swapped for the whole sheet), cuts from one sheet sit side by side, a cut is
     enlarged to 1024–1536 px, its size is shown, and "Clean up the crop" (one image, priced) redraws just the item
     node scripts/test-props-filters-crops.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let checks = 0, failed = 0;
const test = (name, fn)=>{ try{ fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.message) || e)); } };

const props = read("app/props.jsx"), art = read("app/artroom.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx");
const sheets = props.slice(props.indexOf("function PropSheets({"));
const box = { window:{} }; vm.createContext(box);
vm.runInContext(props.slice(props.indexOf("const PROP_SAME_STOP"), props.indexOf("/* A character brief's items"))
  +"\nthis.same = findPossibleSameProps; this.short = propShortName; this.patch = propShortNamePatch;", box);

test("F1 Show (2026-10-29, What is a prop): All objects, Story props, Not story props — two groups that never overlap", ()=>{
  const at = (k)=>{ const i = sheets.indexOf(k); assert.ok(i>0, k); return i; };
  const order = ['{value:"all"},"All objects ("', '{value:"story"},"Story props ("', '{value:"other"},"Not story props ("'].map(at);
  assert.deepEqual(order, [...order].sort((a,b)=>a-b));
  assert.ok(!sheets.includes('{value:"accessories"}') && !sheets.includes('{value:"proposed"}') && !sheets.includes('{value:"unverified"}'));
  assert.ok(sheets.includes('const inView = (p)=> inventoryGroup==="all" || groupOf(p)===inventoryGroup;'));
});
test("F2 the read button: hidden before the first read while Draft N specifications is there; then 'Read the screenplay again'", ()=>{
  assert.ok(sheets.includes("const draftBtnShown = undraftedN>0;"));
  assert.ok(sheets.includes("const screenplayRead = extracted || extractedOnce.current;"));
  assert.ok(sheets.includes('(screenplayRead || !draftBtnShown) && (list.length>0 || !(scenes||[]).length) && React.createElement("button",{className:"art-draftall ghost secondary","data-testid":"prop-read-screenplay",'));
  assert.ok(sheets.includes('(screenplayRead?"Read the screenplay again":"Extract screenplay props")'));
  assert.ok(sheets.includes('draftBtnShown && React.createElement("button",{className:"art-draftall ghost secondary",disabled:draftingAll||!!extraction,onClick:()=>draftAllFlow(),'));
});
const P = (id, name, kind, ownerId, extra)=>({ id, name, kind, ownerId, ownerName:ownerId, ...(extra||{}) });
const film = [
  P("a1","Enamel Toremar company badge pinned on the left breast","worn","aurelio"),
  P("a2","Old steel-cased wristwatch on a cracked brown leather strap, left wrist","worn","aurelio"),
  P("a3","Sealed letter in wax paper addressed in Ornella's handwriting","carried","aurelio"),
  P("a4","Brass ticket punch","carried","aurelio"),
  P("n1","Sealed letter addressed to Aurelio in Ornella's handwriting","carried","nives"),
  P("o1","Enamel Toremar company badge on the left breast","worn","ottavio"),
  P("o2","Plain steel wristwatch with a black leather strap on the left wrist","worn","ottavio"),
  P("o3","Incident log","carried","ottavio"),
];
test("F3 possibly the same object: the letter under two owners is found; the worn badges and watches are not", ()=>{
  const m = box.same(film);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), { a3:["n1"], n1:["a3"] });
  const kept = box.same(film.map(p=>p.id==="a3" ? { ...p, distinctFrom:["n1"] } : p));
  assert.deepEqual(JSON.parse(JSON.stringify(kept)), {}, "Keep separate ends it");
  assert.deepEqual(JSON.parse(JSON.stringify(box.same([P("x","Brass key","carried","a"), P("y","Brass ticket punch","carried","b")]))), {}, "one shared word is not enough");
  assert.deepEqual(JSON.parse(JSON.stringify(box.same([P("x","Sealed letter","carried","a"), P("y","Sealed letter","carried","a")]))), {}, "same owner + name is the older duplicate check's");
});
test("F4 the card: 'Possibly the same object as …', Merge (asks first) and Keep separate (saved on both cards)", ()=>{
  assert.ok(sheets.includes("sameProps:(sameFor[p.id]||[]).map(id=>byId[id]).filter(Boolean)}))),"));
  assert.ok(props.includes('"data-testid":"prop-possibly-same"') && props.includes('"Possibly the same object as "'));
  assert.ok(props.includes("onClick:()=>onMerge&&onMerge([p.id, ...sameProps.map(d=>d.id)], p.id),"));
  assert.ok(props.includes("onUpdate(p.id,{distinctFrom:Array.from(new Set([...(p.distinctFrom||[]), ...ids]))});"));
  assert.ok(props.includes("sameProps.forEach(d=>onUpdate(d.id,{distinctFrom:Array.from(new Set([...(d.distinctFrom||[]), p.id]))}));"));
});
test("F5 a short name: the part before the first placement clause; short or plain names are left alone", ()=>{
  const want = {
    "Enamel Toremar company badge pinned on the left breast":"Enamel Toremar company badge",
    "Old steel-cased wristwatch on a cracked brown leather strap, left wrist":"Old steel-cased wristwatch",
    "Sealed letter in wax paper addressed in Ornella's handwriting":"Sealed letter",
    "Plain thin gold wedding band on the left ring finger":"Plain thin gold wedding band",
    "Plain steel wristwatch with a black leather strap on the left wrist":"Plain steel wristwatch",
    "Brass ticket punch":"", "Gold-braid purser's epaulettes":"",
  };
  for(const [n, s] of Object.entries(want)) assert.equal(box.short(n), s, n);
  const pt = box.patch({ name:"Sealed letter in wax paper addressed in Ornella's handwriting", aliases:["the letter"], form:"" });
  assert.deepEqual(JSON.parse(JSON.stringify(pt)), { name:"Sealed letter", aliases:["the letter","Sealed letter in wax paper addressed in Ornella's handwriting"],
    shortenedFrom:"Sealed letter in wax paper addressed in Ornella's handwriting", form:"Sealed letter in wax paper addressed in Ornella's handwriting" });
  assert.equal(box.patch({ name:"Old steel-cased wristwatch on a cracked brown leather strap", form:"Round case" }).form, undefined, "a drafted form stays");
  assert.ok(props.includes('"data-testid":"prop-short-name"') && props.includes("onClick:()=>onUpdate(p.id,{longNameOk:true})},\"Keep\")"));
});
test("F6 a short name is the item's name on the character's list too (owner 2026-11-18; it used to leave the list alone); the card is still found (seeding, removal, renames, the sheet text)", ()=>{
  assert.ok(!app.includes("!patch.shortenedFrom"), "a short name is no longer an exception");
  assert.ok(app.includes("if(prev && prev.ownerId && String(prev.name||\"\").trim() !== String(patch.name||\"\").trim()){\n        syncCharBulletRename(prev.ownerId, [prev.name, ...(prev.aliases||[])], patch.name);"));
  assert.ok(props.includes("const seen = new Set(have.flatMap(p=> [p.name, ...(p.aliases||[])].map(n=>sig(p.ownerId, n))));"));
  assert.ok(app.includes("[p.name, ...(p.aliases||[])].some(n=>norm(n)===target)"), "removal");
  assert.ok(app.includes("return al.some(a=>_normPropName(a)===from) ? {...p, aliases:al.map(a=>_normPropName(a)===from ? to : a)} : p;"), "a brief rename follows the other name");
  assert.ok(art.includes("const wornKeys = new Set(worn.flatMap(p=>[p.name, ...(p.aliases||[])].map(_norm)));"), "the item is not said twice on the character sheet");
});
test("F7 a cut rides as itself, and cuts from one sheet sit side by side", ()=>{
  assert.ok(props.includes('if(r.cropped && r.url){\n        out.push({ url:r.url, kind:"prop-reference-crop",'));
  assert.ok(app.includes("const sameSheet = (r)=> !ref.cropped && !r.cropped && ref.sourceEntityId && r.sourceEntityId===ref.sourceEntityId;"));
  assert.ok(app.includes("&& r.id!==refId && (r.cropped || r.sourceEntityId!==refId) && r.url!==refId) }"), "detaching a sheet leaves its cuts");
});
test("F8 a cut is enlarged to 1024–1536 px, its size is shown, a small cut is said to be soft", ()=>{
  assert.ok(art.includes("const PROP_CROP_MIN_DIM = 1024, PROP_CROP_MAX_DIM = 1536, PROP_CROP_SMALL = 256;"));
  assert.equal((art.match(/cropRegionAsDataUrl\((url|picked\.url), rect, PROP_CROP_MAX_DIM, PROP_CROP_MIN_DIM\)/g)||[]).length, 2, "both dialogs");
  const i = art.indexOf("function propCropSizeLine(px){"), j = art.indexOf("async function propCleanCrop(");
  const b = { window:{} }; vm.createContext(b);
  vm.runInContext("const PROP_CROP_MIN_DIM = 1024, PROP_CROP_MAX_DIM = 1536;\n"+art.slice(i, j)+"\nthis.f = propCropSizeLine;", b);
  assert.equal(b.f({ w:112, h:96 }), "The cut is 112 × 96 px of the sheet — sent enlarged to 1024 px on its long side.");
  assert.equal(b.f({ w:1800, h:900 }), "The cut is 1800 × 900 px of the sheet.");
  assert.ok(art.includes("const small = px && Math.max(px.w, px.h) < PROP_CROP_SMALL;"));
});
test("F9 Clean up the crop: optional, priced (one image), redraws just the item; nothing is charged when the cut fails", ()=>{
  assert.ok(art.includes('const out = await window.nbGenerate(prompt, { referenceImage:cropUrl, aspectRatio:"1:1", baseMaxDim:PROP_CROP_MAX_DIM,'));
  assert.ok(art.includes("window.nbCostChip(1, { refs:1 })"));
  assert.ok(art.includes("const [clean, setClean] = React.useState(false);"), "off unless ticked");
  assert.ok(art.includes('if(clean && !cropped){ setErr("Couldn\'t cut the item out of this image, so nothing was cleaned up or charged.'));
});
test("F10 'Take a reference from a sheet…' is on every prop card's menu, image or not, and opens on the owner's sheet", ()=>{
  assert.ok(art.includes('isPropCardMenu && React.createElement("button",{className:"sheet-tools-item","data-testid":"sheet-menu-take-ref",disabled:gening,'));
  assert.ok(art.includes("sheetRefOpen && entity && React.createElement(PropSheetReferenceModal,{prop:entity,"));
  assert.ok(!art.includes('"Attach reference to prop\\u2026")'));
  assert.ok(art.includes("candidates.sort((a,b)=> (b.id===ownerId?1:0) - (a.id===ownerId?1:0));"));
  assert.ok(art.includes('const [mode, setMode] = React.useState("item");'));
});
test("F11 Frances knows it", ()=>{
  assert.ok(ai.includes("The Show dropdown lists All objects, then the two groups, which never overlap: Story props and Not story props"));
  assert.ok(ai.includes("once the film has been read the button says 'Read the screenplay again'"));
  assert.ok(ai.includes("POSSIBLY THE SAME OBJECT (owner 2026-10-29)") && ai.includes("A SHORT NAME: a card whose name is a whole description"));
  assert.ok(ai.includes("CROPS AS REFERENCES (owner 2026-10-29)") && ai.includes("'Clean up the crop' (optional, a checkbox with its price: one image)"));
  assert.ok(!ai.includes("the Show dropdown has a 'Not in screenplay' view"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

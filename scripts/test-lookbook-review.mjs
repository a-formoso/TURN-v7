#!/usr/bin/env node
/* The Lookbook review (owner 2026-10-03: "go ahead with all of it").
   A  cards: two hand-added cards both stay; one touchstone in two categories both stay; the same
      touchstone for the same category is one card; deleted cards are kept but never read
   B  mood frames are rendered in the film's medium (photoreal until one is picked); no "--ar"
   C  "Preview the look" (optional previews, owner 2026-10-28): only references with a note and no
      preview; the price is for all of them; nothing to render → no button at all; "+ Add a reference"
      above the visual statement adds your own card (not for view-only, not on an empty Lookbook)
   D  deleting asks first and moves the card (with its frame) to Recently deleted; restore / delete
      forever; every write-back keeps the bin
   E  "Research again": fill the missing categories, or research from scratch (hand-added cards stay,
      researched ones go to Recently deleted, the statement is cleared, the agent opens next tick)
   F  "Suggest a note": one writing call; names a touchstone only on a hand-added card
   G  the frame prompt is behind the card's ⋯ menu; Frances knows all of it
   H  a note from an image (owner 2026-10-28): drop your own picture in the one slot (newest wins); on an
      upload, one vision call writes the note for the card's category; the note stays editable; an upload
      with no note walks you through it (1 pick the category, 2 write the note); the card's sections are indented
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
const genBtn = (tree)=> findAll(tree, n=>n.type==="button" && n.props && n.props["data-testid"]==="lb-previews")[0];
await test("C1 'Preview the look' renders only the noted cards without a preview, and is priced for all of them", ()=>{
  const tree = viewWith({ r1:true });
  const b = genBtn(tree);
  assert.match(textOf(b), /^Preview the look/);
  assert.ok(hasClass("ghost")(b), "a quiet optional button, not the tab's main one");
  assert.equal(findAll(b, n=>n.type==="chip")[0].props.count, 2, "r2 and r3: two frames' price");
  box.__begun = null; b.props.onClick();
  assert.deepEqual(J(box.__begun), { ids:["r2", "r3"], skipped:2 }, "r1 has its frame, r4 has no note");
});
await test("C4 '+ Add a reference' above the visual statement adds your own card; hidden for view-only and on an empty Lookbook", ()=>{
  const addBtn = (tree)=> findAll(tree, n=>n.type==="button" && n.props && n.props["data-testid"]==="lb-add");
  let added = 0;
  const tree = viewWith({ r1:true }, { onAdd:()=>{ added++; return "look-new"; } });
  const scroll = tree.children.filter(Boolean);
  const row = scroll.findIndex(n=>hasClass("lb-add-row")(n)), statement = scroll.findIndex(n=>hasClass("lb-statement")(n));
  assert.ok(row>=0 && row===statement-1, "just above the visual statement");
  const b = addBtn(tree)[0];
  assert.match(textOf(b), /^Add a reference$/);
  assert.ok(hasClass("ghost")(b));
  assert.equal(findAll(findAll(tree, hasClass("sheet-grid"))[0], hasClass("lb-add-tile")).length, 0, "no tile in the grid any more");
  b.props.onClick(); assert.equal(added, 1, "one click, one hand-added card");
  assert.equal(addBtn(viewWith({}, { readOnly:true })).length, 0, "a view-only collaborator can't add");
  R.reset({});
  const empty = box.LookbookView({ project:{}, lookbook:[], note:"", onAdd:noop, onUpdate:noop, onDelete:noop, onResearch:noop });
  assert.equal(addBtn(empty).length, 0, "the empty state keeps its own 'Add by hand'");
  assert.ok(textOf(empty).includes("Add by hand"));
  assert.ok(read("app/artroom.jsx").includes("React.createElement(LookbookView,{project,lookbook,note:lookbookNote,readOnly,"));
  const css = read("app/styles.css");
  assert.ok(css.includes(".lb-add-row{display:flex;justify-content:flex-end;") && !css.includes(".lb-add-tile{"));
  assert.ok(read("app/ai.jsx").includes("the '+ Add a reference' button just above the visual statement adds your own touchstone"), "Frances knows");
});
await test("C2 every noted card has its preview: no previews button at all (never a to-do)", ()=>{
  assert.equal(genBtn(viewWith({ r1:true, r2:true, r3:true })), undefined);
});

/* ═══ D ═══ */
await test("D1 deleting asks first; the card goes to Recently deleted with its frame; restore and delete forever", async ()=>{
  const app = read("app/app.jsx");
  const del = app.slice(app.indexOf("const deleteLookbookCard = (id)=>{"), app.indexOf("const restoreLookbookCard"));
  assert.ok(del.includes('{ ...c, deletedAt:new Date().toISOString() }') && !del.includes("nbClearAsset"), "a soft delete that keeps the frame");
  const purge = app.slice(app.indexOf("const purgeLookbookCard = async (id)=>{"), app.indexOf("/* SUGGEST A NOTE"));
  // (2026-10-09, Art Room third pass) it removes the binned card only, and never a live twin's frame
  assert.ok(purge.includes("await nbClearAsset(id)") && purge.includes("ls.filter(c=>!(c.id===id && c.deletedAt))"), "delete forever clears the frame");
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
await test("E2 from scratch: asks, then the researched cards (not the hand-added ones) move to the bin only when the new research lands", ()=>{
  const app = read("app/app.jsx");
  const f = app.slice(app.indexOf("const researchLookbookFresh = async ()=>{"), app.indexOf("const purgeLookbookCard"));
  assert.ok(f.includes('title:"Research the look from scratch?"'));
  // (2026-10-06, second pass) nothing is binned before the run — the swap happens in the research step
  assert.ok(f.includes("lookbookFreshRef.current = true;") && !f.includes('setLookbookNote("");'));
  const surf = app.slice(app.indexOf("const fresh = !!lookbookFreshRef.current;"), app.indexOf("// keep an existing statement"));
  assert.ok(surf.includes("_w.setLookbook(ls=>ls.map(c=> (c && !c.deletedAt && !mine(c)) ? { ...c, deletedAt:at } : c));"));
  assert.ok(surf.indexOf("if(!r || (!r.statement && !(r.refs||[]).length)) return") < surf.indexOf("_w.setLookbook("), "only after a result");
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
// (owner 2026-10-28) the frame prompt is a folded section of the card ("Preview prompt" since 2026-10-28), no longer a ⋯ menu item
await test("G1 the preview prompt is a folded 'Preview prompt' section (no 'Reference prompt' fold, no menu item)", ()=>{
  R.reset();
  const lc = box.LookbookView({ project:{}, lookbook:[cards[0]], note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop });
  const card = findAll(lc, n=>typeof n.type==="function" && n.props && n.props.c)[0];
  R.reset();
  const tree = card.type(card.props);
  assert.equal(findAll(tree, n=>n.type==="CardFold" && n.props.label==="Reference prompt").length, 0);
  const fold = findAll(tree, n=>n.type==="CardFold" && n.props.label==="Preview prompt");
  assert.equal(fold.length, 1, "its own section");
  assert.equal(fold[0].props.defaultOpen, false, "folded until opened");
  assert.equal(findAll(fold[0], n=>n.type==="CopyBox").length, 1, "the prompt inside it");
  assert.ok(!findAll(tree, n=>n.type==="SheetFrame")[0].props.menuExtra, "no 'Show the frame prompt' menu item");
});
await test("G2 Frances knows: missing frames and their price, Recently deleted, Suggest a note, Research again, the medium", ()=>{
  const ai = read("app/ai.jsx");
  for(const s of ["'Preview the look' (a quiet button shown only while some noted reference has no preview) batch-renders every reference that has a note and NO preview yet", "MOOD FRAMES ARE OPTIONAL PREVIEWS (owner 2026-10-28)", "LOOKBOOK UPDATES (2026-10-03): DELETING a reference asks first",
    "'Suggest a note' (one writing call)", "'Research again' with two choices", "Mood frames are rendered in the FILM'S MEDIUM"])
    assert.ok(ai.includes(s), s);
  assert.ok(!/'Generate all frames' renders the mood frames/.test(ai));
});

/* ═══ H ═══ NOTE FROM AN IMAGE (owner 2026-10-28): one slot, newest wins; the note stays editable */
const cardTree = (c, gen, extra = {})=>{
  box.useImageGen = ()=>({ gening:false, genUrl:"", generate:noop, ...gen });
  R.reset();
  const lc = box.LookbookView({ project:{}, lookbook:[c], note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop,
    onSuggestNote:noop, ...extra });
  const card = findAll(lc, n=>typeof n.type==="function" && n.props && n.props.c)[0];
  R.reset();
  const tree = card.type(card.props);
  box.useImageGen = ()=>({ gening:false, genUrl:"", generate:noop });
  return tree;
};
const fromImageBtn = (tree)=> findAll(tree, n=>n.type==="button" && n.props && n.props["data-testid"]==="lb-note-from-image")[0];
await test("H1 the slot takes your own image: drop or browse (one slot — an upload or a preview, newest wins)", ()=>{
  const frame = findAll(cardTree(cards[0], {}), n=>n.type==="SheetFrame")[0];
  assert.equal(frame.props.dropToImport, true, "the empty slot is a drop zone");
  assert.equal(frame.props.hideUploadButton, undefined);
  assert.equal(frame.props.slotPlaceholder, "Drop a reference image, or render a preview");
  assert.equal(frame.props.noun, "image");
});
await test("H2 'Write the note from the image' shows only on an UPLOADED image, and sends that image", ()=>{
  let got = null;
  const onNoteFromImage = (id, url)=>{ got = { id, url }; };
  const up = { genUrl:"data:image/png;base64,AAA", genMeta:{ uploaded:true } };
  assert.equal(fromImageBtn(cardTree(cards[0], {}, { onNoteFromImage })), undefined, "no image, no button");
  assert.equal(fromImageBtn(cardTree(cards[0], { genUrl:"data:x", genMeta:{ modelId:"nb" } }, { onNoteFromImage })), undefined,
    "a rendered preview was made from the note: reading it back would go in a circle");
  assert.equal(fromImageBtn(cardTree(cards[0], up, {})), undefined, "view-only: no handler, no button");
  const b = fromImageBtn(cardTree(cards[0], up, { onNoteFromImage }));
  assert.match(textOf(b), /Rewrite the note from the image/, "r1 has a note already");
  assert.match(b.props.title, /one vision call\. You can edit the note afterwards\./);
  b.props.onClick(); assert.deepEqual(got, { id:"r1", url:"data:image/png;base64,AAA" });
  assert.match(textOf(fromImageBtn(cardTree(cards[3], up, { onNoteFromImage }))), /^2Write the note from the image$/, "a card with no note: step 2's number, then the label");
  const busy = fromImageBtn(cardTree(cards[0], up, { onNoteFromImage, readingImageId:"r1" }));
  assert.equal(busy.props.disabled, true); assert.match(textOf(busy), /Reading the image…/);
  const tree = cardTree(cards[3], up, { onNoteFromImage });
  assert.match(textOf(findAll(tree, hasClass("sheet-undrafted"))[0]), /Your image is in\. Two steps .*The note is what the departments read\./,
    "an uploaded image with no note still says the note is what departments read");
  assert.ok(findAll(tree, n=>n.type==="SheetField" && /What to borrow/.test(n.props.label||""))[0].props.onCommit, "the note stays editable");
});
await test("H3 the vision read: the card's category, abstract qualities only, Palette hues sampled; names an unnamed card", async ()=>{
  const ai = read("app/ai.jsx");
  const start = ai.indexOf("function lookbookSampleHues("), end = ai.indexOf("window.aiLookbookNoteFromImage = aiLookbookNoteFromImage;");
  assert.ok(start>0 && end>start);
  const calls = [];
  const sb = { console, window:{}, document:{},
    aiAvailable:()=>true, writingProjectOf:p=>p||{}, genreTag:()=>"", writingLoglineOf:()=>"A courier crosses the city",
    normalizeLookCat:c=>c||"Palette", turnDownscaleDataUrl:async u=>u+"#small", extractJSON:t=>JSON.parse(t),
    clipSpecText:(t,n)=>String(t).slice(0,n), scrubBrand:t=>t, writingStamp:k=>({ kind:k }),
    aiVisionComplete:async (messages, images, opts)=>{ calls.push({ prompt:messages[0].content, images, opts }); return sb.__reply; } };
  vm.createContext(sb);
  vm.runInContext(transform(ai.slice(start, end), "ai-slice.jsx")+"\nthis.lookbookSampleHues = ()=>Promise.resolve(['#102030','#d08040']);", sb);
  sb.__reply = { vision:true, text:'{"note":"Teal shadows #102030 against amber skin #d08040.","source":"Sodium-lit night street"}' };
  const r = await sb.aiLookbookNoteFromImage({ id:"a", category:"Palette", source:"Palette study", autoNamed:true }, "data:image/png;base64,AAA", { title:"Night" }, "A cold film");
  assert.equal(r.note, "Teal shadows #102030 against amber skin #d08040."); assert.equal(r.source, "Sodium-lit night street");
  assert.equal(r.writingProvenance.kind, "Lookbook note from image");
  const c0 = calls[0];
  assert.deepEqual(J(c0.images), ["data:image/png;base64,AAA#small"], "the downscaled upload is the one image sent");
  assert.match(c0.prompt, /uploaded for the Palette category/);
  assert.match(c0.prompt, /main hues, sampled from its pixels \(most common first\): #102030, #d08040/);
  assert.match(c0.prompt, /never the picture's content: no people, faces, names, brands, logos, text or story/);
  assert.match(c0.prompt, /short NAME .* never a person's or a film's name/);
  // a named Lighting card: no hues, no new name
  sb.__reply = { vision:true, text:'{"note":"Hard low side light.","source":"ignored"}' };
  const r2 = await sb.aiLookbookNoteFromImage({ id:"b", category:"Lighting", source:"Caravaggio", autoNamed:false }, "data:x", {}, "");
  assert.equal(r2.source, undefined, "a named card keeps its name");
  assert.doesNotMatch(calls[1].prompt, /sampled from its pixels/); assert.doesNotMatch(calls[1].prompt, /short NAME/);
  assert.match(calls[1].prompt, /The director calls this reference: "Caravaggio"/);
  sb.__reply = { vision:false, text:"" };
  assert.deepEqual(J(await sb.aiLookbookNoteFromImage({ id:"c", category:"Texture & grain" }, "data:x", {}, "")), { unsupported:true });
});
await test("H4 the app writes the note (and a name only on an unnamed card), for editors only; Frances knows", ()=>{
  const app = read("app/app.jsx"), art = read("app/artroom.jsx"), ai = read("app/ai.jsx");
  assert.ok(app.includes("const r = await window.aiLookbookNoteFromImage(card, url, project, lookbookNote);"));
  assert.ok(app.includes("if(card.autoNamed && r.source) Object.assign(patch, { source:r.source, autoNamed:false });"));
  assert.ok(app.includes("onLookbookNoteFromImage:roomReadOnly ? null : noteFromLookbookImage,readingLookbookImageId,"));
  assert.ok(art.includes("onNoteFromImage:onLookbookNoteFromImage,readingImageId:readingLookbookImageId})"));
  for(const s of ["A NOTE FROM AN IMAGE (owner 2026-10-28)", "The slot holds ONE image, newest wins", "The note stays fully editable afterwards",
    "It isn't offered on a rendered preview"]) assert.ok(ai.includes(s), s);
});

await test("H5 an upload, step by step: 1 pick the category (empty box, highlighted, the button waits), then 2 write the note", ()=>{
  const up = { genUrl:"data:image/png;base64,AAA", genMeta:{ uploaded:true } };
  const on = { onNoteFromImage:noop };
  const fresh = { id:"n1", source:"Palette study", category:"Palette", note:"", manual:true, autoNamed:true };
  const catField = (tree)=> findAll(tree, n=>n.props && n.props["data-testid"]==="lb-category")[0];
  const stepNums = (tree)=> findAll(tree, hasClass("lb-step-n")).map(n=>textOf(n)+(hasClass("on")(n)?"*":""));
  // step 1
  let tree = cardTree(fresh, up, on);
  assert.match(textOf(findAll(tree, n=>n.props && n.props["data-testid"]==="lb-steps")[0]), /^Your image is in\. Two steps turn it into a reference: 1 · pick the category it's a reference for, then 2 · Write the note from the image\./);
  let f = catField(tree);
  assert.ok(hasClass("lb-step-on")(f), "the category is highlighted first");
  const sel = findAll(f, n=>n.type==="select")[0];
  assert.equal(sel.props.value, "", "no category shown yet, so picking Palette counts too");
  assert.equal(findAll(sel, n=>n.type==="option")[0].props.disabled, true);
  assert.match(textOf(findAll(f, hasClass("lb-routes"))[0]), /The category decides which departments read the note\./);
  let b = fromImageBtn(tree);
  assert.equal(b.props.disabled, true, "step 2 waits for step 1"); assert.match(b.props.title, /^Pick the category first/);
  assert.ok(!hasClass("lb-step-on")(b));
  assert.deepEqual(J(stepNums(tree)), ["1*", "2"]);
  let got = null;
  box.onUpdateCapture = null;
  R.reset();
  const lc = box.LookbookView({ project:{}, lookbook:[fresh], note:"", onUpdate:(id, patch)=>{ got = { id, patch }; }, onAdd:noop, onDelete:noop, onSetNote:noop, ...on });
  box.useImageGen = ()=>({ gening:false, generate:noop, ...up });
  const card = findAll(lc, n=>typeof n.type==="function" && n.props && n.props.c)[0]; R.reset();
  findAll(catField(card.type(card.props)), n=>n.type==="select")[0].props.onChange({ target:{ value:"Palette" } });
  box.useImageGen = ()=>({ gening:false, genUrl:"", generate:noop });
  assert.deepEqual(J(got), { id:"n1", patch:{ category:"Palette", categoryPicked:true } }, "your pick is remembered");
  // step 2
  tree = cardTree({ ...fresh, categoryPicked:true }, up, on);
  assert.ok(!hasClass("lb-step-on")(catField(tree)));
  assert.equal(findAll(catField(tree), n=>n.type==="select")[0].props.value, "Palette");
  b = fromImageBtn(tree);
  assert.ok(hasClass("lb-step-on")(b), "the button is highlighted next"); assert.equal(b.props.disabled, false);
  assert.deepEqual(J(stepNums(tree)), ["✓", "2*"]);
  // a researched card has its category already: straight to step 2
  assert.deepEqual(J(stepNums(cardTree({ ...cards[3], manual:false }, up, on))), ["✓", "2*"]);
  // a note written: no steps at all
  tree = cardTree(cards[0], up, on);
  assert.equal(stepNums(tree).length, 0); assert.ok(!hasClass("lb-step-on")(fromImageBtn(tree)));
  // no upload: no steps
  assert.equal(stepNums(cardTree(fresh, {}, on)).length, 0);
});
await test("H6 the card's sections sit inside them (indented), and the empty 'Leave out' field reads as a field", ()=>{
  const css = read("app/styles.css");
  assert.ok(css.includes(".lb-card .sheet-fold-body{padding:2px 12px 12px 26px}"));
  const tree = cardTree(cards[0], {});
  assert.ok(hasClass("lb-card")(tree));
  assert.equal(findAll(tree, n=>n.type==="SheetField" && n.props.label==="Leave out (negative prompt)")[0].props.placeholder, "e.g. text, logos, people");
  assert.ok(read("app/ai.jsx").includes("the card walks you through it STEP BY STEP"), "Frances knows");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* The character card's sections (owner 2026-10-29, "go ahead with all of them"):
   Identity splits into Identity (who they are) and Body & features (what they look like); the Scale sheet moves up after
   Body & features; Spoken language + Video element = Voice & video; Look dev → Look & exclusions; Master reference prompt →
   Generation prompt ("Prompt (text only)" / "Prompt with reference images"); "Leave out (negative prompt)"; plainer words
   (Public / Private outfit, "its own sheet"); the card's buttons one height (30px); a loading placeholder on its images.
     node scripts/test-character-card-sections.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let checks = 0, failed = 0;
const test = (name, fn)=>{ try{ fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.message) || e)); } };

const art = read("app/artroom.jsx"), ve = read("app/video-elements.jsx"), css = read("app/styles.css"), ai = read("app/ai.jsx");
const a = art.indexOf("function CharacterSheet({"), card = art.slice(a, art.indexOf("\nfunction ", a+10));

test("C1 the sections, in order", ()=>{
  const labels = [...card.matchAll(/React\.createElement\(CardFold,\{label:"([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(labels, ["Identity", "Body & features", "Scale sheet", "Wardrobe", "Props & accessories",
    "Continuity \\u00b7 appearance states", "Look & exclusions", "Voice & video", "Generation prompt"]);
  assert.ok(!/label:"(Look dev|Master reference prompt|Spoken language)"/.test(card), "no old names");
});
test("C2 Identity is who they are; Body & features is what they look like", ()=>{
  const id = card.slice(card.indexOf('label:"Identity"'), card.indexOf('label:"Body & features"'));
  for(const k of ['"Role"', '"Archetype"', '"Narrative identity"', '"Pronouns"', "CharacterIdentityNotice", "CharScriptFactsPanel"]) assert.ok(id.includes(k), "Identity: "+k);
  assert.ok(!id.includes('Row("Apparent age"'), "the body rows left Identity");
  const body = card.slice(card.indexOf('label:"Body & features"'), card.indexOf('label:"Scale sheet"'));
  for(const k of ['Row("Apparent age"', 'Row("Size"', 'Row("Build"', "featuresRow,", '"Scale"', "Why this look: ", '"Texture \\u2014 skin & material detail"']) assert.ok(body.includes(k), "Body: "+k);
});
test("C3 Voice & video holds the spoken language and the video element (bare, under its own heading)", ()=>{
  const vv = card.slice(card.indexOf('label:"Voice & video"'), card.indexOf('label:"Generation prompt"'));
  assert.ok(vv.includes('label:"Speaks \\u2014 the language of their lines') && vv.includes('"Lines for the video model"'));
  assert.ok(vv.includes("window.VideoElementFold && React.createElement(window.VideoElementFold,{ c, readOnly, scenes, drafts, onUpdate, bare:true })"));
  assert.ok(ve.includes("function VideoElementFold({ c, readOnly=false, scenes, drafts, onUpdate, bare=false }){"));
  assert.ok(ve.includes('return React.createElement(bare ? VideoElementBare : CardFold, bare ? {} : {label:"Video element",defaultOpen:!!s.url,foldId:"ve-"+c.id},'));
  assert.ok(ve.includes('React.createElement("div",{className:"ve-sub"},"Video element")'));
  assert.ok(css.includes(".ve-bare{display:flex;flex-direction:column;gap:11px;padding-top:11px;border-top:1px solid var(--line)}"));
});
test("C4 the labels: Leave out (negative prompt), the two prompts, the outfits, 'its own sheet'", ()=>{
  assert.ok(card.includes('React.createElement(SheetField,{label:"Leave out (negative prompt)",value:c.negativePrompt||v.negativePrompt,'));
  assert.ok(card.includes('React.createElement(CopyBox,{label:"Prompt (text only)",text:promptText}),') && card.includes('React.createElement(CopyBox,{label:"Prompt with reference images",'));
  assert.ok(card.includes('"Public outfit", o.kind') && card.includes('label:"Private outfit"'));
  assert.ok(card.includes("Each can get its own sheet.") && !card.includes("v2 sheet."));
});
test("C5 the card's buttons are one height: 30px", ()=>{
  for(const c of ["char-draft-btn", "char-cameo-btn", "char-voice-btn"])
    assert.ok(new RegExp("\\n\\."+c+"\\{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;").test(css), c);
});
test("C6 no 'Open all sections' on the card (owner 2026-10-29: removed)", ()=>{
  assert.ok(!card.includes("card-folds-all") && !art.includes("nb-card-folds") && !css.includes(".card-folds-all"));
  assert.ok(!ai.includes("'Open all sections'"));
});
test("C7 Frances knows the new layout", ()=>{
  assert.ok(ai.includes("THE CARD'S SECTIONS (owner 2026-10-29), in order under the render style and the scene chips:"));
  assert.ok(ai.includes("the card's folded 'Generation prompt' section), the live text-only specification is labelled 'Prompt (text only)'"));
  assert.ok(!ai.includes("labelled 'Reference-Guided Textual Character Sheet'"));
});
test("C8 a card's image frame shows a light 'Loading image…' until the image has loaded (every image change starts it again)", ()=>{
  assert.ok(art.includes("React.useEffect(()=>{ setImgLoaded(false); },[genUrl]);"));
  assert.ok(art.includes('React.createElement("div",{className:"sheet-genwrap"+(imgLoaded?"":" loading"),"data-testid":"sheet-genwrap"},'));
  assert.ok(art.includes("if(im && typeof im.decode===\"function\") im.decode().then(done, done); else done(); },"), "until it is decoded, not just loaded");
  assert.ok(art.includes("onError:()=>setImgLoaded(true),"), "a broken image doesn't spin forever");
  assert.ok(css.includes(".sheet-genwrap.loading{background:var(--bg-3)}") && css.includes('.sheet-genwrap.loading::after{content:"Loading image\\2026";'));
  assert.ok(css.includes("@media (prefers-reduced-motion:reduce){ .sheet-genwrap.loading::before{animation:none} }"));
  assert.ok(/\.sheet-genwrap\{[^}]*background:#000\}/.test(css), "the letterbox stays black once it has loaded");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

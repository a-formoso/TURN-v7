#!/usr/bin/env node
/* The Props card review (owner 2026-10-29, "go ahead with all of them"):
   - "(Proposal)" no longer leaks into a prop's text or prompt: the drafter isn't told to label, its answer is cleaned
     (propSpecClean), and the prompt and the fields shown are cleaned too (stored text is left as it is)
   - Screenplay evidence is a section like the others (its count = the summary); its badges sit under the name
   - Object + Narrative significance → Story & ownership and Physical design
   - labels: the render style text the picker fills, "Leave out (negative prompt)", the two prompts, the plain binding note
     node scripts/test-props-card-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let checks = 0, failed = 0;
const test = (name, fn)=>{ try{ fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.message) || e)); } };

const props = read("app/props.jsx"), ai = read("app/ai.jsx");
const a = props.indexOf("function PropSheet({"), card = props.slice(a, props.indexOf("\nfunction ", a+10));

test("P1 propSpecClean removes the (Proposal) / [Proposal] / Proposal: labels, nothing else", ()=>{
  const i = props.indexOf("function propSpecClean(t){"), j = props.indexOf("window.propSpecClean = propSpecClean;");
  const box = { window:{} }; vm.createContext(box); vm.runInContext(props.slice(i, j)+"\nthis.f = propSpecClean;", box);
  assert.equal(box.f("(Proposal) A single flat envelope"), "A single flat envelope");
  assert.equal(box.f("Sealed letter, [Proposal] A single flat"), "Sealed letter, A single flat");
  assert.equal(box.f("Proposal: brass key"), "brass key");
  assert.equal(box.f("A (proposed) brass key"), "A (proposed) brass key", "ordinary words stay");
  assert.equal(box.f(null), "");
});
test("P2 the drafter isn't told to label; its answer, the prompt and the fields shown are cleaned", ()=>{
  assert.ok(!ai.includes("Any unspecified design is a PROPOSAL, not a screenplay fact."));
  assert.ok(ai.includes("never write a label such as '(Proposal)' into any field."));
  assert.ok(ai.includes("const unmark = (t)=> (typeof window.propSpecClean===\"function\") ? window.propSpecClean(t) : t;"));
  assert.ok(props.includes("const clean = (x)=>propSpecClean(x).replace(/\\.$/,\"\").trim();"), "the prompt");
  for(const f of ["p.form", "p.material", "p.signatureFeature", "p.size", "p.detail"]) assert.ok(card.includes("value:propSpecClean("+f+"),"), f+" shown clean");
});
test("P3 the render style picker still decides the style (picking writes its recipe into the text, which fine-tunes it)", ()=>{
  assert.ok(props.includes("    : (clean(p.renderStyle)\n       || (typeof window.renderStyleText===\"function\" ? window.renderStyleText(\"prop\", _styleKey)"));
  assert.ok(props.includes('onUpdate(p.id, { renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function" ? window.renderStyleText("prop", key)'));
  assert.ok(card.includes('label:"Render style text \\u2014 the style picker above fills it; edit to fine-tune"'));
});
test("P4 Screenplay evidence is a section with its summary as the count; its badges are under the name", ()=>{
  assert.ok(card.includes('React.createElement(CardFold,{label:"Screenplay evidence",count:savedSources.length?(validSources.length+" reviewed"):'));
  assert.ok(!card.includes('React.createElement("details",{className:"prop-evidence"}'));
  const b = card.indexOf('"data-testid":"prop-screenplay-badges"');
  assert.ok(b > 0 && b < card.indexOf('label:"Screenplay evidence"'), "above the sections");
  assert.ok(card.slice(b, b+2400).includes('"Not in screenplay"') && card.slice(b, b+2400).includes('" changed"'));
});
test("P5 the sections, in order", ()=>{
  const labels = [...card.matchAll(/React\.createElement\(CardFold,\{label:"([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(labels, ["Screenplay evidence", "Story & ownership", "Physical design", "Continuity \\u00b7 story events", "Look & exclusions", "Generation prompt"]);
});
test("P6 the labels: Leave out, the prompts, the binding note", ()=>{
  assert.ok(card.includes('React.createElement(SheetField,{label:"Leave out (negative prompt)",value:p.negativePrompt||d.negativePrompt,'));
  assert.ok(card.includes('label:"Prompt (text only) \\u2014 the 4-panel object sheet: hero, front, side, detail"'));
  assert.ok(card.includes('"Final prompt \\u2014 the one behind the current sheet" : "Final prompt \\u2014 sent at generation (with the Leave out list)"'));
  assert.ok(card.includes("Type is where it usually is. Story events (under Continuity) can move it between a person, a hand and a place"));
});
test("P7 Frances knows the card", ()=>{
  assert.ok(ai.includes("Card sections (owner 2026-10-29) are Screenplay evidence (its count says how many passages were reviewed or matched), Story & ownership"));
  assert.ok(ai.includes("shows an amber 'Not in screenplay' badge under the prop's name"));
  assert.ok(ai.includes("fills each prop's Story & ownership, Physical design and Generation prompt fields,"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

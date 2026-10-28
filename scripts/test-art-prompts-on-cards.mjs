#!/usr/bin/env node
/* PROMPTS ON EVERY CARD (owner 2026-10-28: "remove this from the menu. add the prompt section to the cards"): the Film
   menu's "Always show prompts" is gone; every card has its prompt as a folded section of its own (closed until
   opened), and no card's ⋯ menu carries "Show the … prompt" any more.
     node scripts/test-art-prompts-on-cards.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let pass = 0;
const t = (name, fn)=>{ fn(); pass++; console.log("PASS "+name); };
const chrome = read("app/chrome.jsx"), art = read("app/artroom.jsx"), props = read("app/props.jsx"), locs = read("app/locations-ui.jsx"),
  look = read("app/lookbook.jsx"), crowds = read("app/crowds-ui.jsx"), shots = read("app/shots-ui.jsx"), ai = read("app/ai.jsx");
t("the Film menu no longer has 'Always show prompts'", ()=>{
  assert.ok(!chrome.includes("art-always-prompts") && !chrome.includes('"Always show prompts"') && !chrome.includes("turnSetArtAlwaysPrompts"));
});
t("the switch is gone from the code (nothing reads it)", ()=>{
  for(const src of [art, props, locs, look, crowds, shots]) assert.ok(!/useArtAlwaysPrompts|turnArtAlwaysPrompts|showPrompt/.test(src));
});
t("every card has its prompt as a folded section", ()=>{
  assert.ok(art.includes('React.createElement(CardFold,{label:"Master reference prompt",defaultOpen:false},'));
  assert.ok(props.includes('React.createElement(CardFold,{label:"Generation prompt",defaultOpen:false},'));
  assert.ok(locs.includes('React.createElement(CardFold,{label:"Generation Prompt",defaultOpen:false},'));
  assert.ok(look.includes('React.createElement(CardFold,{label:"Frame prompt",defaultOpen:false},'));
  assert.ok(crowds.includes('React.createElement(CardFold,{label:"Image prompt",defaultOpen:false},'));
  assert.ok(shots.includes('_el(CardFold,{label:"Shot prompt",defaultOpen:false},'));
});
t("no card's ⋯ menu offers 'Show the … prompt'", ()=>{
  for(const src of [art, props, locs, look, crowds]) assert.ok(!/"(Show|Hide) the (sheet|generation|frame|image) prompt"/.test(src));
});
t("Frances knows, and nothing still says the prompt is behind the menu", ()=>{
  assert.ok(ai.includes("PROMPTS ON EVERY CARD (owner 2026-10-28)"));
  assert.ok(!/Show the (sheet|generation|frame|image) prompt/.test(ai.replace("nor a 'Show the \\u2026 prompt' item","")));
  assert.ok(!/under View\)|'Always show prompts' \(under/.test(ai));
});
console.log(pass+" passed, 0 failed");

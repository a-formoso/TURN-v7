#!/usr/bin/env node
/* Button tiers (owner 2026-10-29, option A — "the grey buttons go almost unnoticed, specially in light mode").
   PRIMARY   .art-draftall                   amber fill
   SECONDARY .art-draftall.ghost.secondary   amber tint — the other real actions in a tab's top row
   TERTIARY  .art-draftall.ghost             white with a clearly darker edge (--btn-edge), as are the cards' small buttons
     node scripts/test-button-tiers.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let checks = 0, failed = 0;
const test = (name, fn)=>{ try{ fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.message) || e)); } };

const css = read("app/styles.css");
test("T1 the edge reads in both modes: the secondary text colour mixed into the hairline", ()=>{
  assert.ok(css.includes(":root{--btn-edge:color-mix(in srgb, var(--txt-2) 25%, var(--line-2))}"));
  assert.ok(css.includes(".lb-suggest,.state-add-btn,.rd-trigger{border-color:var(--btn-edge)}"));
  assert.ok(css.includes(".app.hs.room-art :is(.char-draft-btn,.sb-card-btn,.rs-trigger),"), "the cards' small buttons share the edge");
  assert.ok(css.indexOf(":root{--btn-edge:") > css.indexOf(".app.hs.room-art :is(.char-draft-btn,.sb-card-btn,.pager-btn,.sheet-gen-tool,.rs-trigger,.sheet-scenes-nav){background:var(--win-surface)"),
    "after the room's own button rule, so the darker edge wins");
});
test("T2 secondary is the amber tint; primary stays the amber fill", ()=>{
  assert.ok(css.includes(".art-draftall.ghost.secondary{background:var(--win-amber-soft,var(--accent-soft));border-color:var(--win-amber-line,var(--accent-line));color:var(--win-amber-ink,var(--accent))}"));
  assert.ok(/\.art-draftall\{[^}]*background:var\(--accent\);color:var\(--ink-on-accent\)/.test(css));
});
test("T3 the top rows' real actions are secondary; the quiet extras stay tertiary", ()=>{
  const look = read("app/lookbook.jsx"), art = read("app/artroom.jsx"), props = read("app/props.jsx"), shots = read("app/shots-ui.jsx");
  assert.ok(look.includes('{className:"art-draftall ghost secondary",onClick:()=>setResearchMenu(v=>!v),'), "Research again");
  assert.ok(art.includes('onCast && React.createElement("button",{className:"art-draftall ghost secondary",'), "Design the cast");
  assert.ok(art.includes('(onReadScript && scriptReady && list.length>0) && React.createElement("button",{className:"art-draftall ghost secondary",'), "Read the script");
  assert.ok(art.includes('{className:"art-draftall"+(castStage==="draft"?" ghost secondary":""),'), "Generate N missing beside Draft all");
  assert.equal((props.match(/className:"art-draftall ghost secondary"/g)||[]).length, 2, "Extract screenplay props, Draft N specifications");
  assert.ok(shots.includes('_el("button",{className:"art-draftall ghost secondary",disabled:draftingAllShots||!ordered.length,onClick:handleDesignAll,'), "Design all shots");
  assert.ok(look.includes('"data-testid":"lb-previews"') && look.includes('{className:"art-draftall ghost","data-testid":"lb-previews",'), "Preview the look stays tertiary");
  assert.ok(look.includes('className:"art-draftall ghost lb-add","data-testid":"lb-add"'), "the + stays tertiary");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

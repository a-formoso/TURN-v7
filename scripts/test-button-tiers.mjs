#!/usr/bin/env node
/* Button tiers (owner 2026-10-29, option A — "the grey buttons go almost unnoticed, specially in light mode").
   PRIMARY   .art-draftall                   amber fill
   SECONDARY .art-draftall.ghost.secondary   amber tint — the other real actions in a tab's top row
   TERTIARY  .art-draftall.ghost             white with a clearly darker edge (--btn-edge), as are the cards' small buttons
   and the light theme's near-black DESK (owner 2026-10-29) in every room and on Home, the cards on it staying light.
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

test("T4 the light theme's desk is near-black (#1C1B1A) in every room and on Home; the dark theme's is unchanged", ()=>{
  assert.ok(css.includes(".app.hs{--hs-desk:#1C1B1A}") && css.includes(".hd-root{--hd-desk:#1C1B1A}"));
  assert.ok(!/--h[sd]-desk:#(F3F1EC|ECE9E2)/.test(css));
  assert.ok(css.includes('html[data-theme="dark"] .app.hs{--hs-desk:color-mix(in oklab, var(--bg-1) 70%, #000)}'), "dark theme unchanged");
});
const DESK = 'html[data-theme="light"] :is(.app.hs.room-art .artroom,.app.hs.room-writers .canvas,.app.hs.room-writers .strip,.app.hs.room-stage .stage2-main)';
test("T5 the dark desk takes the dark theme's settings; the surfaces on it take the light ones back", ()=>{
  const at = css.indexOf(DESK+"{\n  color-scheme:dark; color:var(--hs-ink);");
  assert.ok(at > 0, "the desk: the Art Room's work area, the Writers' Room's canvas and strip, the Stage's middle column");
  const deskRule = css.slice(at, css.indexOf("}", at));
  for(const d of ["--bg-2:#15161a;", "--txt-0:#f3f1ec;", "--hs-ink:var(--txt-0);", "--win-amber-ink:#F29A43;", "--hs-desk:#1C1B1A;"]) assert.ok(deskRule.includes(d), d);
  const lit = css.indexOf(DESK+" :is(.scard,.sp-page,.stage2-console,.stage2-vers,.stage2-tl,.stage2-au,.sheet-card,.lb-statement,");
  assert.ok(lit > at, "cards, panels, menus and dialogs on the desk");
  const litRule = css.slice(lit, css.indexOf("}", lit));
  for(const d of ["color-scheme:light;", "--txt-0:#0F1012;", "--bg-2:#FFFFFF;", "--win-amber-ink:#9E5410;"]) assert.ok(litRule.includes(d), d);
  assert.ok(css.includes(DESK+" .lb-stale-notice:not("), "the desk-level notice keeps its dark look");
  assert.ok(css.includes(DESK+" :is(.spine-hs .stile.sel,.board-pan .scard.sel){background:linear-gradient(var(--hs-amber-soft),var(--hs-amber-soft)),#FFFFFF}"));
});
test("T6 Home: films, features band and footer on the dark desk; the New project tile and features panel stay light", ()=>{
  const HD = 'html[data-theme="light"] .hd-root :is(.hd-body,.hd-feature-band,.hd-foot)';
  assert.ok(css.includes(HD+"{\n  color-scheme:dark; color:var(--lpw-ink);"));
  assert.ok(css.includes(HD+" :is(.hd-card-new-art,.hd-features,[role=\"dialog\"],[role=\"menu\"]){\n  color-scheme:light;"));
  assert.ok(css.includes("--lpw-ink:#f3f1ec;") && css.includes("--lpw-amber-ink:#F29A43;"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

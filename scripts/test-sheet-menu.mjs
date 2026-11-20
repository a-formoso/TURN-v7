#!/usr/bin/env node
/* The image card's ⋯ menu (owner 2026-10-29 — "inspect this element … add or remove what you see fit"):
   - "View full size & download" opens the full-size viewer (earlier versions, Download at a chosen size) — before, only
     clicking the image did
   - Remaster sits with the edits it cleans up after; "Clear" says what it clears: "Clear image…"
   - Escape closes the menu, and the three image editors (Select area & edit, Attach item to prop, Attach reference to
     prop), which are dialogs now (role, aria-modal, a name)
     node scripts/test-sheet-menu.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f)=>readFileSync(new URL("../"+f, import.meta.url), "utf8");
let checks = 0, failed = 0;
const test = (name, fn)=>{ try{ fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.message) || e)); } };

const art = read("app/artroom.jsx"), ai = read("app/ai.jsx");
const a = art.indexOf('menuOpen && React.createElement("div",{className:"sheet-tools-dropdown"},');
const menu = art.slice(a, art.indexOf('onDelete && React.createElement("button",{className:"sheet-tools-item danger"', a));

test("M1 the order: Details, View full size & download, Edit, Select area & edit, Remaster, Attach…, Replace, Clear image…", ()=>{
  const at = (k)=>{ const i = menu.indexOf(k); assert.ok(i>=0, k); return i; };
  const order = ['"Details")', '"View full size & download")', '"Edit "+editNounLabel', '"Select area & edit")',
    '"Remaster \\u2014 bring the original back"', '"Attach item to prop\\u2026")', '"Replace with upload"', '"Clear image\\u2026")'].map(at);
  assert.deepEqual(order, [...order].sort((x,y)=>x-y));
  assert.ok(!menu.includes('React.createElement(Icon.x,{s:14}),"Clear")'), "Clear says what it clears");
});
test("M2 View full size & download opens the viewer the image opens", ()=>{
  assert.ok(menu.includes('genUrl && onView && React.createElement("button",{className:"sheet-tools-item","data-testid":"sheet-menu-view",'));
  assert.ok(menu.includes("onClick:()=>{ setMenuOpen(false); onView(genUrl, entity); }},"));
  assert.ok(art.includes("onClick:()=>onView&&onView(genUrl, entity)}))"), "the image's own click does the same");
});
test("M3 Escape closes the menu and the image editors, which are dialogs", ()=>{
  assert.ok(art.includes('const onKey = e=>{ if(e.key==="Escape") setMenuOpen(false); };'));
  assert.ok(art.includes('const h=(e)=>{ if(e.key==="Escape" && !document.querySelector(".appconfirm")){ e.stopPropagation(); onClose && onClose(); } };'));
  for(const fn of ["function RegionEditModal(", "function PropReferenceModal(", "function PropSheetReferenceModal("]){
    const i = art.indexOf(fn); assert.ok(i>0, fn);
    assert.ok(art.slice(i, i+400).includes("useEscapeClose(onClose);"), fn+" closes on Escape");
  }
  for(const lab of ['"aria-label":"Select area & edit"', '"aria-label":"Attach item to prop"', '"aria-label":"Take a reference from a sheet"'])
    assert.ok(art.includes('role:"dialog","aria-modal":"true",'+lab), lab);
});
test("M4 Frances knows the menu", ()=>{
  assert.ok(ai.includes("THE \\u22ef MENU ON AN IMAGE CARD (owner 2026-10-29), in order: Details"));
  assert.ok(ai.includes("Escape closes the menu, and the image editors too."));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

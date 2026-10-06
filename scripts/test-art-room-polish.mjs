/* Art Room clean-up (owner, 2026-09-26): part 1 — the Styles tab is "Color" (Colorist), the
   agent is the Colorist, and stale wording is gone (Shot List, table-read, "boards every
   scene", the removed Storyboard Director); one orange action per tab header; tab titles
   keep one line; props and locations show "Photoreal - Cinematic". */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const codeOnly=src=>src.split("\n").filter(l=>!/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
const art=read("app/artroom.jsx"), ag=read("app/agents.jsx"), ui=read("app/agents-ui.jsx"), sb=read("app/storyboard.jsx"),
  props=read("app/props.jsx"), locs=read("app/locations-ui.jsx"), css=read("app/styles.css"), ai=read("app/ai.jsx");
const manifest=ai.slice(ai.indexOf("const APP_FEATURES"),ai.indexOf("function appBrief"));

await test("the Styles tab is Color, headed by the Colorist; the agent is the Colorist",()=>{
  assert.ok(art.includes('{ id:"stylebible", label:"Color", icon:"layers" },'));
  assert.ok(ag.includes('{ id:"colorist", name:"Colorist", icon:"palette"'));
  for(const f of ["app/agents.jsx","app/storyboard.jsx","app/shots-ui.jsx","app/locations-ui.jsx","app/stylebible-ui.jsx"])
    assert.ok(!/Styles tab|Cinematographer \/ Colorist|About the Style Bible/.test(codeOnly(read(f))),f);
  assert.ok(read("app/app.jsx").includes('colorist:"Color" })[dept]'));
});
await test("stale wording is gone: Shot List, table-read, 'boards every scene'",()=>{
  assert.ok(!/Shot List/.test(codeOnly(sb)),"no user-visible Shot List in Storyboards");
  assert.ok(sb.includes('"Go to Shots"')&&sb.includes('title:"Edit in Shots"'));
  assert.ok(!/table-read|Table-Read/.test(codeOnly(ag).replace(/voice distinctiveness pass[^\n]*/,"")));
  assert.ok(ag.includes('t:"Final Read complete."'));
  assert.ok(!ui.includes("it boards every scene")&&ui.includes("you'll see each step as it works"));
  assert.ok(read("app/app.jsx").includes('viewLabel:"View Shots"'));
});
await test("one orange action in the Props header; tab titles keep one line",()=>{
  assert.ok(props.includes('React.createElement("button",{className:"art-draftall ghost",disabled:!!extraction||draftingAll||!scenes.length,onClick:extractProps,'));
  assert.ok(/\.art-intro-row\{[^}]*flex-wrap:wrap/.test(css)&&css.includes(".art-intro-row .art-intro-t{white-space:nowrap}"));
});
await test("props and locations show 'Photoreal - Cinematic' for the photoreal style",()=>{
  assert.ok(art.includes('prop:     { photoreal:"Photoreal - Cinematic" },')&&art.includes('location: { photoreal:"Photoreal - Cinematic" },'));
  assert.ok(art.includes("function RenderStylePicker({ value, onPick, disabled, placeholderLabel, context }){")&&art.includes("clean(labelOf(o))"));
  assert.equal((props.match(/RenderStylePicker,\{context:"prop"/g)||[]).length,2);
  assert.equal((locs.match(/RenderStylePicker,\{context:"location"/g)||[]).length,2);
});
await test("MUSE describes the Art Room as it is",()=>{
  assert.ok(!/Storyboard Director|Direct storyboard|Styles tab|dedups near-duplicates/.test(manifest));
  assert.ok(manifest.includes('{ name:"Color / scene looks (Art Room)"')&&manifest.includes("the Colorist ('Light the film' on the Color tab)"));
});
console.log(checks+" checks passed");

/* THE TOP BAR, ALWAYS (owner 2026-11-13):
   - "the project selector doesn't appear in all windows or screen sizes ... ensure this is always available ... as well
     as change the room": above a phone the bar's two zones were equal halves from 901px up, so from about 900 to 1250px
     the film and room switchers slid under the engines. The right side now takes what it needs at every width, the
     film chip yields (badges, then its title) but keeps its icon and arrow, and the room switcher never shrinks.
   - "the model selector only ever shows the model name": the engine buttons in the bar show the name only; the aspect,
     size, quality and AUTO / SET are in the dropdown and the tooltip.
   - the crowd card's image area fills the card (its slot id was missing from the image-area rules). */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const css=read("app/styles.css"), chrome=read("app/chrome.jsx"), writer=read("app/aiwriter.jsx"), art=read("app/artroom.jsx"),
  crowds=read("app/crowds-ui.jsx"), ai=read("app/ai.jsx"), html=read("TURN.html");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };
const media=head=>{ const out=[]; let i=0; const h="@media "+head+"{";
  while((i=css.indexOf(h,i))>=0){ let d=0,j=i+h.length-1; for(;j<css.length;j++){ if(css[j]==="{")d++; else if(css[j]==="}"){ d--; if(!d)break; } } out.push(css.slice(i+h.length,j)); i=j; }
  return out; };

test("1 the film and room switchers are in the bar in every room, at every width", ()=>{
  // one bar for every room: the film switcher (cloud films) and the room switcher sit together on its left
  assert.ok(/React\.createElement\("div",\{className:"context-group"\},\s*projectSlot \|\| null,\s*React\.createElement\(RoomSwitcher,/.test(chrome));
  // nothing hides either of them by screen size
  for(const sel of ["\\.proj-wrap","\\.proj-btn","\\.room-switch","\\.room-btn","\\.context-group"])
    assert.ok(!new RegExp("(^|[\\s,}])[^{}]*"+sel+"\\{[^}]*display:none").test(css),sel+" is never hidden");
  // above a phone the right side keeps its size, so the left can never be covered by it
  assert.ok(media("(min-width:701px) and (max-width:900px)").some(b=>/\.tb-right\{flex:0 0 auto\}/.test(b)));
  assert.ok(media("(min-width:901px)").some(b=>/\.tb-right\{flex:0 0 auto\}/.test(b)&&/\.tb-left \.proj-wrap\{display:flex;min-width:0\}/.test(b)),"no equal halves above 900px any more");
  const wide=media("(min-width:701px)").find(b=>b.includes(".topbar .context-group .room-switch{flex:0 0 auto}"));
  assert.ok(wide,"the room switcher never shrinks");
  assert.ok(wide.includes(".topbar .context-group .proj-wrap{flex:0 1 auto;min-width:58px}"),"the film chip yields, never below its icon and arrow");
  // what the film chip gives up first: its badges, by width
  assert.ok(media("(max-width:1220px)").some(b=>b.includes(".topbar .proj-btn .proj-format.fw{display:none}")));
  assert.ok(media("(max-width:1040px)").some(b=>b.includes(".topbar .proj-btn .proj-format:not(.shared){display:none}")));
  assert.ok(/\.proj-btn \.proj-name\{[^}]*min-width:0;[^}]*overflow:hidden;text-overflow:ellipsis\}/.test(css));
  // a phone keeps its merged film + room pill, both with their arrows
  assert.ok(media("(max-width:700px)").some(b=>b.includes(".context-group .room-switch{display:flex;border-left:1px solid var(--line-2)}")
    &&b.includes(".context-group .proj-btn>svg:last-child{display:block;opacity:.65}")));
});

test("2 the engine buttons in the bar show the engine's name only", ()=>{
  assert.ok(css.includes(".app.hs .nb-dock.in-topbar .nb-dock-chip{display:none;"),"no aspect, size, quality, AUTO or SET on the bar");
  assert.ok(css.includes(".app.hs .nb-dock.in-topbar .nb-dock-label,\n.app.hs .nb-dock.in-topbar .nb-dock-chip.model{display:none}"));
  assert.ok(!/\.in-topbar \.nb-dock-chip\{display:inline/.test(css));
  // the name each one shows: the resolved writing engine (automatic or picked), and the image engine
  assert.ok(writer.includes('slot && React.createElement("span",{className:"tb-engine-name"},labelOf(resolvedId)),'));
  assert.ok(art.includes('slot && React.createElement("span",{className:"tb-engine-name"},(typeof nbModelLabel==="function" && nbModelLabel(model))||short),'));
  // the details are still one hover or click away
  assert.ok(writer.includes('(pick?" (your pick this session)":" (AUTO — the per-task recommendation)")'));
  assert.ok(art.includes('title:"Image engine — model, aspect & resolution"'));
  assert.ok(ai.includes("each by its name only (e.g. 'Opus 5.5 | Nano Banana 2.1'")&&!ai.includes("'Opus 5.5 · AUTO"));
});

test("3 the crowd card's image area fills the card, like every other card's", ()=>{
  assert.ok(crowds.includes('slotId:"crowdref-"+c.id'));
  const rules=css.split("\n").filter(l=>l.startsWith('image-slot[id^="charref-"]')&&l.includes('image-slot[id^="lookref-"]'));
  assert.equal(rules.length,6);
  for(const l of rules) assert.ok(l.includes('image-slot[id^="crowdref-"]'),"crowd slots are in: "+l.slice(0,60));
  assert.ok(rules[0].includes('image-slot[id^="crowdref-"]{width:100%;aspect-ratio:16/9;height:auto;display:block;'));
});

test("4 cache keys", ()=>{
  for(const f of ["styles.css","ai.jsx","script.jsx"]) assert.ok(["20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f);
});

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

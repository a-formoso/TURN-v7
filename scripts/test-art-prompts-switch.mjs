#!/usr/bin/env node
/* "Always show prompts" + the cards' settings back on the cards (owner 2026-10-05: "go ahead with that,
   including the Always show prompts switch").
   A  the switch: a personal setting on this device (localStorage), announced to every card
   B  Lookbook, rendered: the 'Leave out' field is on the card (Reference); the frame prompt is behind ⋯,
      or open with the switch (and then the card's own menu item steps aside)
   C  Characters / Props / Locations: the editable settings are outside the read-only prompt fold —
      Look dev (Characters), 'Look & exclusions' (Props, Locations; collapsed); the prompt folds follow the switch
   D  Shots: the 'Shot prompt' fold opens with the switch
   E  the Art Room ⋮ menu carries the switch (Art Room only, a checkbox item)
   F  Frances knows, and no sentence still says the exclusions are behind the menu
     node scripts/test-art-prompts-switch.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
const transform = (src, filename)=>transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]],
  plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename }).code;
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const noop = ()=>{};
const art = read("app/artroom.jsx"), props = read("app/props.jsx"), locs = read("app/locations-ui.jsx"),
  look = read("app/lookbook.jsx"), shots = read("app/shots-ui.jsx"), chrome = read("app/chrome.jsx"), ai = read("app/ai.jsx");

/* ═══ A ═══ */
await test("A1 the switch is stored on this device and announced to every card", ()=>{
  const ls = new Map(), events = [];
  const b = { console, localStorage:{ getItem:(k)=>ls.has(k) ? ls.get(k) : null, setItem:(k, v)=>ls.set(k, String(v)) },
    CustomEvent:class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } }, dispatchEvent:(e)=>{ events.push(e.type+":"+e.detail.on); return true; },
    React:{ useState:(f)=>[typeof f==="function" ? f() : f, noop], useEffect:noop } };
  b.window = b; vm.createContext(b);
  vm.runInContext(between(art, 'const ART_ALWAYS_PROMPTS_KEY = ', "function CopyBox({ label, text }){"), b);
  assert.equal(b.turnArtAlwaysPrompts(), false, "off until chosen");
  b.turnSetArtAlwaysPrompts(true);
  assert.equal(ls.get("turn_art_always_prompts"), "1"); assert.equal(b.turnArtAlwaysPrompts(), true);
  assert.equal(b.useArtAlwaysPrompts(), true);
  b.turnSetArtAlwaysPrompts(false);
  assert.equal(b.turnArtAlwaysPrompts(), false); assert.deepEqual(events, ["turn-art-prompts:true", "turn-art-prompts:false"]);
  b.localStorage.getItem = ()=>{ throw new Error("blocked"); };
  assert.equal(b.turnArtAlwaysPrompts(), false, "blocked storage reads as off");
  assert.ok(!/project\.|onUpdateProject|setProject/.test(between(art, 'const ART_ALWAYS_PROMPTS_KEY = ', "function CopyBox(")), "never written to the film");
});

/* ═══ B: the Lookbook card, rendered ═══ */
const el = (type, p, ...children)=>({ type, props:p||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const R = { Fragment:"fragment", createElement:el, useState:(init)=>[typeof init==="function" ? init() : init, noop],
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f };
const box = { console, React:R, Icon:new Proxy({}, { get:()=>()=>null }), document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {}, requestAnimationFrame:noop,
  useBatchGen:()=>({ activeId:null, begin:noop, setMsg:noop, advance:noop }), nbCostChip:()=>null, nbGetImage:()=>"",
  SheetFrame:"SheetFrame", SheetField:"SheetField", CardFold:"CardFold", CopyBox:"CopyBox", EditText:"EditText",
  NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar", ImageLightbox:"ImageLightbox", InfoTip:"InfoTip",
  RecentlyDeleted:"RecentlyDeleted", useImageGen:()=>({ gening:false, genUrl:"", generate:noop }) };
box.window = box; vm.createContext(box);
vm.runInContext(transform(look, "lookbook.jsx"), box);
const lookCard = (always)=>{
  box.useArtAlwaysPrompts = ()=>always;
  const lc = box.LookbookView({ project:{}, lookbook:[{ id:"r1", source:"Roger Deakins", category:"Lighting", note:"soft top light", negativePrompt:"no lens flare" }],
    note:"", onUpdate:noop, onAdd:noop, onDelete:noop, onSetNote:noop });
  const card = findAll(lc, n=>typeof n.type==="function" && n.props && n.props.c)[0];
  return card.type(card.props);
};
await test("B1 the 'Leave out' field is on the card, inside Reference — not behind the prompt", ()=>{
  const tree = lookCard(false);
  const ref = findAll(tree, n=>n.type==="CardFold" && n.props.label==="Reference")[0];
  const leave = findAll(ref, n=>n.type==="SheetField" && /^Leave out/.test(n.props.label));
  assert.equal(leave.length, 1); assert.equal(leave[0].props.value, "no lens flare");
  assert.equal(findAll(tree, n=>n.type==="CopyBox").length, 0, "the prompt stays behind the menu");
  assert.equal(findAll(tree, n=>n.type==="SheetFrame")[0].props.menuExtra[0].label, "Show the frame prompt");
});
await test("B2 with the switch on, the frame prompt is open (read-only) and the card's menu item steps aside", ()=>{
  const tree = lookCard(true);
  const fold = findAll(tree, n=>n.type==="CardFold" && n.props.label==="Frame prompt")[0];
  assert.ok(fold && fold.props.defaultOpen);
  assert.equal(findAll(fold, n=>n.type==="CopyBox").length, 1);
  assert.equal(findAll(fold, n=>n.type==="SheetField").length, 0, "nothing editable inside the prompt");
  assert.equal(findAll(tree, n=>n.type==="SheetFrame")[0].props.menuExtra.length, 0);
});

/* ═══ C ═══ */
const charCard = between(art, "function CharacterSheet(", "\n}\n");
const propCard = between(props, "const [showPrompt, setShowPrompt] = React.useState(false);", "function PropExtractionReview(");
const locCard = between(locs, "function LocationSheet({", "function CoverageViewsEditor(");
const foldAt = (src, label)=>{ const i = src.indexOf('label:"'+label+'"'); assert.ok(i>0, label); return i; };
await test("C1 Characters: 'Leave out' under Look dev; the sheet prompt fold holds only the read-only prompts", ()=>{
  const lookDev = foldAt(charCard, "Look dev"), prompt = foldAt(charCard, "Master reference prompt");
  const leave = charCard.indexOf('label:"Leave out \\u2014 what the sheet must not show (negative prompt)"');
  assert.ok(lookDev < leave && leave < prompt);
  assert.ok(!/Negative prompt/.test(charCard.slice(prompt)), "no editable field after the prompt");
  assert.ok(charCard.includes("(showPrompt || alwaysPrompts) && React.createElement(CardFold,{label:\"Master reference prompt\""));
  assert.ok(charCard.includes("const alwaysPrompts = useArtAlwaysPrompts();"));
});
await test("C2 Props and Locations: render style + 'Leave out' in a collapsed 'Look & exclusions' fold before the prompt", ()=>{
  for(const [name, src, promptLabel, styleMark] of [["props", propCard, "Generation prompt", 'label:"Render style \\u2014 edit freely"'],
    ["locations", locCard, "Generation Prompt", 'label:"Render style instructions"']]){
    const look = foldAt(src, "Look & exclusions"), prompt = foldAt(src, promptLabel);
    assert.ok(src.includes('React.createElement(CardFold,{label:"Look & exclusions",defaultOpen:false},'), name);
    const style = src.indexOf(styleMark), leave = src.indexOf('label:"Leave out \\u2014 what the');
    assert.ok(look < style && style < prompt && look < leave && leave < prompt, name+": the settings sit in Look & exclusions");
    assert.ok(!/SheetField/.test(src.slice(prompt)), name+": nothing editable in the prompt fold");
    assert.ok(src.includes("(showPrompt || alwaysPrompts) && React.createElement(CardFold,{label:\""+promptLabel+"\""), name);
  }
  assert.ok(locCard.includes('"Prompt used for the current plate"') && locCard.indexOf('"Prompt used for the current plate"') > foldAt(locCard, "Generation Prompt"));
});

/* ═══ D ═══ */
await test("D1 Shots: the Shot prompt fold opens with the switch (keyed, so it takes effect at once)", ()=>{
  assert.ok(shots.includes('_el(CardFold,{key:"shot-prompt-"+(alwaysPrompts?"open":"fold"),label:"Shot prompt",defaultOpen:alwaysPrompts},'));
  const card = between(shots, "function ShotCard({", "\n  const loc = ctx.location;");
  assert.ok(card.includes('const alwaysPrompts = (typeof window.useArtAlwaysPrompts==="function") ? window.useArtAlwaysPrompts() : false;'), "first, before any early return");
});

/* ═══ E ═══ */
await test("E1 the Art Room ⋮ menu: 'Always show prompts' (View), a checkbox item that follows the setting", ()=>{
  const menu = between(chrome, "function OverflowMenu(", "window.OverflowMenu = OverflowMenu;");
  assert.ok(menu.includes('room==="art" && typeof window.turnSetArtAlwaysPrompts==="function"'));
  assert.ok(menu.includes('role:"menuitemcheckbox"') && menu.includes('"aria-checked":alwaysPrompts?"true":"false"'));
  assert.ok(menu.includes("onClick:()=>window.turnSetArtAlwaysPrompts(!alwaysPrompts)"));
  assert.ok(menu.includes('"Always show prompts"') && menu.includes('window.addEventListener("turn-art-prompts", h)'));
});

/* ═══ F ═══ */
await test("F1 Frances: the switch, a personal setting, the fields on the cards; nothing says exclusions are behind the menu", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Art Room")||{}).what || "";
  assert.ok(/'Always show prompts' \(under View\)/.test(w) && /your own setting on this device, not the film's/.test(w) && /'Look & exclusions'/.test(w));
  const all = fb.__F.map(f=>String(f.what||"")).join(" ");
  assert.ok(!/frame prompt and negative prompt are behind/.test(all) && !/the negative prompt and the prompt behind the current sheet/.test(all));
  assert.ok(/'Leave out' field \(the negative prompt\) is on the card, under Look dev/.test(all));
  assert.equal((all.match(/are on the card, under 'Look & exclusions'/g)||[]).length, 2, "Props and Locations");
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

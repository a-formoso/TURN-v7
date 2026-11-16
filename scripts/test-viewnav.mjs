#!/usr/bin/env node
/* Writers' Room / Art Room chrome (app/chrome.jsx): room-scoped ViewNav actions, the Art
   Room tab-lock wiring, the story-derived left rail (Premise · Setting · Cast), and the
   accidental-cast cleanup (app/cast-policy.js).
   Runs the CURRENT sources, transpiled here with Babel (like test-admin-storage-ui.mjs),
   so a stale dist/ can no longer make it pass or fail. The stub React records elements;
   render() then expands function components (WorldPane, CastPane, RailSection, EditText…)
   so their text is visible, the way the page renders them. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename,
}).code;

const noop = ()=>{};
const sessionValues = {};
let checks = 0;
const check = (fn)=>{ fn(); checks++; };
const sandbox = {
  console,
  React: {
    Fragment: "fragment",
    createElement: (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) }),
    useState: initial=>[typeof initial==="function"?initial():initial, noop],
    useEffect: noop,
    useRef: initial=>({current:initial===undefined?null:initial}),
  },
  Icon: new Proxy({}, { get:()=>()=>null }),
  // inspector.jsx's EditText is a page global chrome.jsx renders; here it shows its value
  EditText: ({ value, placeholder, className })=>({ type:"edit-text", props:{ className:"edit-text "+(className||""), placeholder },
    children:[String(value||"")] }),
  document: { addEventListener:noop, removeEventListener:noop },
  localStorage: { getItem:()=>null, setItem:noop },
  sessionStorage: {
    getItem:key=>sessionValues[key]||null,
    setItem:(key,value)=>{ sessionValues[key]=String(value); },
  },
  CustomEvent: class { constructor(type, init){ this.type=type; this.detail=init&&init.detail; } },
  dispatchEvent: noop,
  turnInfo: ()=>({flagged:false}),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(transform(read("app/chrome.jsx"), "chrome.jsx"), sandbox);
vm.runInContext(transform(read("app/cast-policy.js"), "cast-policy.js"), sandbox);

// expand function components into what they render (hooks come from the stub above)
const render = (node)=>{
  if(Array.isArray(node)) return node.map(render);
  if(!node || typeof node!=="object") return node;
  if(typeof node.type==="function") return render(node.type({ ...node.props, children:node.children }));
  return { ...node, children:(node.children||[]).map(render) };
};
const textOf = node=>{
  if(typeof node==="string" || typeof node==="number") return String(node);
  if(!node || typeof node!=="object") return "";
  return (node.children||[]).map(textOf).join("");
};
const byClass = (tree,className)=>{
  const out=[];
  const walk=node=>{
    if(!node || typeof node!=="object") return;
    if(String(node.props&&node.props.className||"").split(/\s+/).includes(className)) out.push(node);
    (node.children||[]).forEach(walk);
  };
  walk(tree);
  return out;
};

/* ── ViewNav: each room's primary action, and the Art Room tab locks ─────────── */
sandbox.ART_TABS = [
  {id:"lookbook",label:"Lookbook",icon:"image"},
  {id:"characters",label:"Characters",icon:"user"},
  {id:"shots",label:"Shots",icon:"film"},
];
const common = {view:"spine",setView:noop,artView:"shots",setArtView:noop,onAgents:noop,onCoordinate:noop};
const nav = (props)=>render(sandbox.ViewNav({...common,...props}));
check(()=>assert.deepEqual(byClass(nav({room:"art"}),"vn-cta").map(textOf), ["Run pre-production"]));
check(()=>assert.deepEqual(byClass(nav({room:"writers"}),"vn-cta").map(textOf), ["Story Editors"]));
check(()=>assert.equal(sandbox.ViewNav({...common,room:"stage"}), null, "the Stage has no view tabs"));
check(()=>assert.deepEqual(byClass(nav({room:"writers"}),"seg").map(textOf), ["Spine","Board","Script"]));

const locks = {
  characters:{locked:true, waitingFor:"Waiting for the Lookbook to have a look."},
  shots:{locked:true, waitingFor:"Waiting for Color."},
  lookbook:{locked:false},
};
const artSegs = byClass(nav({room:"art", tabLocks:locks}),"seg");
const seg = (lab)=>artSegs.find(n=>textOf(n)===lab);
check(()=>assert.deepEqual(artSegs.map(textOf), ["Lookbook","Characters","Shots"]));
check(()=>{
  const c = seg("Characters");
  assert.ok(String(c.props.className).split(/\s+/).includes("locked"), "a locked tab is marked locked");
  assert.equal(c.props["aria-label"], "Characters (locked)", "its accessible name says locked");
  assert.match(c.props.title, /locked\. Waiting for the Lookbook to have a look\./, "its tooltip names what it waits for");
  assert.equal(byClass(c,"seg-lock").length, 1, "it shows a padlock");
});
check(()=>{
  const l = seg("Lookbook");
  assert.ok(!String(l.props.className).includes("locked") && l.props["aria-label"]===undefined && byClass(l,"seg-lock").length===0,
    "an unlocked tab has no lock");
});
check(()=>{
  let opened = null;
  const s = byClass(nav({room:"art", tabLocks:locks, setArtView:(id)=>{ opened=id; }}),"seg").find(n=>textOf(n)==="Shots");
  s.props.onClick();
  assert.equal(opened, "shots", "a locked tab still opens (its lock card explains what unlocks it)");
});
check(()=>{
  // even a lock keyed by a Writers' Room tab id never applies outside the Art Room
  const w = byClass(nav({room:"writers", tabLocks:{...locks, spine:{locked:true, waitingFor:"x"}, script:{locked:true, waitingFor:"x"}}}),"seg");
  assert.ok(w.every(n=>!String(n.props.className).includes("locked") && byClass(n,"seg-lock").length===0),
    "locks only apply in the Art Room");
});
check(()=>{
  const art = nav({room:"art", onProductionCheck:noop});
  const studio = byClass(art,"vn-studio").map(n=>n.props["aria-label"]);
  // (the Blender Studio button left the Art Room's heading on 2026-11-16, owner: "Remove it now")
  assert.deepEqual(studio, ["Production check"], "the Art Room keeps Production check; Blender Studio is gone");
  assert.equal(byClass(nav({room:"art"}),"vn-studio").length, 0, "Production check appears only when wired");
});

/* ── Left rail: Premise · Setting · Cast (story-derived, no manual cast) ─────── */
const railProps = {
  project:{ premise:"A son inherits the last word.", controllingIdea:{value:"Love",cause:"survives proof",polarity:"ironic"},
    centerOfGood:"He still answers the phone.", setting:{period:"Present day",duration:"One night",location:"Brumfield",conflict:"Brother against brother"} },
  characters:[{id:"marcus",name:"MARCUS TILLMON",role:"Protagonist",color:"#955c2b"}],
  scenes:[{id:"s1",no:1,act:1,title:"Closing Argument",driver:"marcus",openCharge:-2,closeCharge:2,loc:"INT. COURTHOUSE - NIGHT"}],
  selId:"s1",selChar:"marcus",onSelect:noop,onSelectChar:noop,onProject:noop,onGenre:noop,
  onContract:noop,showFramework:false,onCollapse:noop,onAddScene:noop,onReorder:noop,compact:false,readOnly:false,
};
const rail = ()=>render(sandbox.LeftRail(railProps));

let leftRail = rail();
check(()=>assert.deepEqual(byClass(leftRail,"insp-tab").map(textOf),["Premise","Setting","Cast"]));
check(()=>assert.ok(byClass(leftRail,"rail-tabs").length===1,"left rail should reuse inspector tabs"));
check(()=>{
  const railTabsBar = byClass(leftRail,"rail-tabs")[0];
  const kids = railTabsBar.children.filter(n=>n&&typeof n==="object");
  assert.ok(String(kids[0].props.className).includes("rail-panel-collapse"),
    "left rail collapse control should be first, on the outer-left edge");
  assert.ok(kids.slice(1).every(n=>String(n.props&&n.props.className||"").includes("insp-tab")),
    "left rail tabs should follow the collapse control so they align right");
});
check(()=>assert.match(textOf(leftRail),/A son inherits the last word/));
check(()=>assert.match(textOf(leftRail),/He still answers the phone\./, "the Center of Good is on the Premise tab"));
check(()=>assert.equal(byClass(leftRail,"rail-spine").length,0));

byClass(leftRail,"insp-tab").find(n=>textOf(n)==="Setting").props.onClick();
leftRail = rail();
check(()=>assert.match(textOf(leftRail),/Present day/));
check(()=>assert.match(textOf(leftRail),/Brumfield/));
check(()=>assert.match(textOf(leftRail),/Courthouse/, "the Setting tab reads the places the script visits"));
check(()=>assert.doesNotMatch(textOf(leftRail),/A son inherits the last word/));
check(()=>assert.equal(byClass(leftRail,"rail-spine").length,0));

byClass(leftRail,"insp-tab").find(n=>textOf(n)==="Cast").props.onClick();
leftRail = rail();
check(()=>assert.match(textOf(leftRail),/Marcus Tillmon/, "a name in capitals reads in Title Case"));
check(()=>assert.doesNotMatch(textOf(leftRail),/Present day/));
check(()=>assert.equal(byClass(leftRail,"rail-spine").length,0));
check(()=>assert.equal(byClass(leftRail,"rail-tab-add").length,0,"Cast must not expose manual character creation"));
check(()=>assert.equal(byClass(leftRail,"rail-add").length,0,"no add button anywhere on the Cast tab"));

/* ── Accidental-cast cleanup (The Last Word only) ────────────────────────────── */
const accidentalCast = [
  {id:"marcus",name:"MARCUS TILLMON"},
  {id:"char-a1",name:"Alex",manual:true},
  {id:"char-b2",name:"New character",manual:true},
  {id:"char-c3",name:"New character",manual:true},
];
const cleanupDoc = {project:{title:"The Last Word"},scenes:[],shots:[],props:[],drafts:{}};
check(()=>assert.deepEqual(sandbox.turnPruneAccidentalManualCast(accidentalCast,cleanupDoc).map(c=>c.id),["marcus"]));
check(()=>assert.equal(sandbox.turnPruneAccidentalManualCast(accidentalCast,{...cleanupDoc,scenes:[{driver:"char-a1"}]}).length,4,
  "a referenced Alex must never be pruned"));
check(()=>assert.equal(sandbox.turnPruneAccidentalManualCast(accidentalCast,{...cleanupDoc,project:{title:"Another Film"}}).length,4,
  "the repair must stay scoped to The Last Word"));

console.log(`PASS room-scoped ViewNav actions + Art Room tab locks, story-derived Cast UI, and accidental-cast cleanup (${checks} checks)`);

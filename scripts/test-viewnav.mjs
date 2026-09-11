#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const noop = ()=>{};
const sessionValues = {};
const sandbox = {
  console,
  React: {
    Fragment: "fragment",
    createElement: (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) }),
    useState: initial=>[typeof initial==="function"?initial():initial, noop],
    useEffect: noop,
    useRef: ()=>({current:null}),
  },
  Icon: new Proxy({}, { get:()=>()=>null }),
  document: { addEventListener:noop, removeEventListener:noop },
  localStorage: { getItem:()=>null, setItem:noop },
  sessionStorage: {
    getItem:key=>sessionValues[key]||null,
    setItem:(key,value)=>{ sessionValues[key]=String(value); },
  },
  turnInfo: ()=>({flagged:false}),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync("dist/app/chrome.js", "utf8"), sandbox);
vm.runInContext(readFileSync("dist/app/cast-policy.js", "utf8"), sandbox);

sandbox.ART_TABS = [{id:"shots",label:"Shots",icon:"film"}];
const textOf = node=>{
  if(typeof node==="string") return node;
  if(!node || typeof node!=="object") return "";
  return (node.children||[]).map(textOf).join("");
};
const ctas = tree=>{
  const out=[];
  const walk=node=>{
    if(!node || typeof node!=="object") return;
    if(String(node.props&&node.props.className||"").split(/\s+/).includes("vn-cta")) out.push(textOf(node));
    (node.children||[]).forEach(walk);
  };
  walk(tree);
  return out;
};

const common = {view:"spine",setView:noop,artView:"shots",setArtView:noop,onAgents:noop,onCoordinate:noop};
assert.deepEqual(ctas(sandbox.ViewNav({...common,room:"art"})), ["Run pre-production"]);
assert.deepEqual(ctas(sandbox.ViewNav({...common,room:"writers"})), ["Story Editors"]);

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
const railProps = {
  project:{ premise:"A son inherits the last word.", controllingIdea:{value:"Love",cause:"survives proof",polarity:"ironic"},
    centerOfGood:"He still answers the phone.", setting:{period:"Present day",duration:"One night",location:"Brumfield",conflict:"Brother against brother"} },
  characters:[{id:"marcus",name:"MARCUS TILLMON",role:"Protagonist",color:"#955c2b"}],
  scenes:[{id:"s1",no:1,act:1,title:"Closing Argument",driver:"marcus",openCharge:-2,closeCharge:2}],
  selId:"s1",selChar:"marcus",onSelect:noop,onSelectChar:noop,
  onContract:noop,showFramework:false,onCollapse:noop,onAddScene:noop,onReorder:noop,compact:false,readOnly:false,
};

let leftRail = sandbox.LeftRail(railProps);
assert.deepEqual(byClass(leftRail,"insp-tab").map(textOf),["Premise","Setting","Cast"]);
assert.ok(byClass(leftRail,"rail-tabs").length===1,"left rail should reuse inspector tabs");
const railTabsBar = byClass(leftRail,"rail-tabs")[0];
assert.ok(String(railTabsBar.children[0].props.className).includes("rail-panel-collapse"),
  "left rail collapse control should be first, on the outer-left edge");
assert.ok(railTabsBar.children.filter(n=>n&&typeof n==="object").slice(1)
  .every(n=>String(n.props&&n.props.className||"").includes("insp-tab")),
  "left rail tabs should follow the collapse control so they align right");
assert.match(textOf(leftRail),/A son inherits the last word/);
assert.equal(byClass(leftRail,"rail-spine").length,0);

byClass(leftRail,"insp-tab").find(n=>textOf(n)==="Setting").props.onClick();
leftRail = sandbox.LeftRail(railProps);
assert.match(textOf(leftRail),/Present day/);
assert.doesNotMatch(textOf(leftRail),/A son inherits the last word/);
assert.equal(byClass(leftRail,"rail-spine").length,0);

byClass(leftRail,"insp-tab").find(n=>textOf(n)==="Cast").props.onClick();
leftRail = sandbox.LeftRail(railProps);
assert.match(textOf(leftRail),/MARCUS TILLMON/);
assert.equal(byClass(leftRail,"rail-spine").length,0);
assert.equal(byClass(leftRail,"rail-tab-add").length,0,"Cast must not expose manual character creation");

const accidentalCast = [
  {id:"marcus",name:"MARCUS TILLMON"},
  {id:"char-a1",name:"Alex",manual:true},
  {id:"char-b2",name:"New character",manual:true},
  {id:"char-c3",name:"New character",manual:true},
];
const cleanupDoc = {project:{title:"The Last Word"},scenes:[],shots:[],props:[],drafts:{}};
assert.deepEqual(sandbox.turnPruneAccidentalManualCast(accidentalCast,cleanupDoc).map(c=>c.id),["marcus"]);
assert.equal(sandbox.turnPruneAccidentalManualCast(accidentalCast,{...cleanupDoc,scenes:[{driver:"char-a1"}]}).length,4,
  "a referenced Alex must never be pruned");
assert.equal(sandbox.turnPruneAccidentalManualCast(accidentalCast,{...cleanupDoc,project:{title:"Another Film"}}).length,4,
  "the repair must stay scoped to The Last Word");

console.log("PASS room-scoped ViewNav actions, story-derived Cast UI, and accidental-cast cleanup (17 assertions)");

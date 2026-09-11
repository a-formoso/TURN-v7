#!/usr/bin/env node
/* Functional tests for continuity-bearing master locations and room slugline units. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop,
  CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""}
};
box.window=box;box.globalThis=box;
box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
vm.runInContext(readFileSync("dist/app/locations.js","utf8"),box,{filename:"dist/app/locations.js"});

let pass=0,fail=0;
const ok=(name,value,detail)=>{if(value)pass++;else{fail++;console.log("FAIL "+name+(detail?" — "+detail:""));}};
const keys=(xs)=>Array.from(xs||[]).sort().join(",");

const scenes=[
  {id:"s1",no:1,title:"Closing Argument",loc:"INT. FATHER'S HOUSE - NIGHT",
    summary:"At his father's house, Marcus rehearses before the funeral."},
  {id:"s3",no:3,title:"Dead Man's Wishes",loc:"INT. KITCHEN - NIGHT",
    summary:"Inside his father's house, Marcus searches the kitchen."},
  {id:"s6",no:6,title:"The Drawer Letter",loc:"INT. KITCHEN - DAWN",
    summary:"The house still smells like a sick man's house."}
];
const drafts={
  s1:{blocks:[
    {type:"scene",text:"INT. FATHER'S HOUSE - NIGHT"},
    {type:"action",text:"Marcus stands in his father's house."}
  ]},
  s3:{blocks:[
    {type:"scene",text:"INT. KITCHEN - NIGHT"},
    {type:"action",text:"The kitchen of his father's house is dark."}
  ]},
  s6:{blocks:[
    {type:"scene",text:"INT. KITCHEN - DAWN"},
    {type:"action",text:"The house still smells like a sick man's house."},
    {type:"scene",text:"INT. LIVING ROOM - DAWN"},
    {type:"action",text:"Daniel sprawls across the couch."},
    {type:"scene",text:"INT. KITCHEN - DAWN"},
    {type:"action",text:"Marcus finds an envelope stamped BRUMFIELD FUNERAL HOME, then returns to his father's kitchen table."}
  ]}
};

const fold=box.deriveSubspaceFold(scenes,drafts);
const parentKey=box.locSlug("Father's House").split("-").slice(0,4).join("-");
ok("kitchen folds under the house continuity master",fold.kitchen===parentKey,JSON.stringify(fold));
ok("living room folds under the house continuity master",fold["living-room"]===parentKey,JSON.stringify(fold));

const masters=box.deriveLocations(scenes,[],drafts);
ok("root plus two child workspaces are derived",masters.length===3,JSON.stringify(masters));
const root=masters.find(x=>x.key===parentKey);
const kitchen=masters.find(x=>x.key==="kitchen");
const living=masters.find(x=>x.key==="living-room");
ok("master is Father's House and explicitly compound",root?.scope==="compound",JSON.stringify(masters));
ok("master owns all three scenes",keys(root?.scenes)==="s1,s3,s6",JSON.stringify(root));
ok("master records both filmable subspaces",
  (root?.areas||[]).includes("Kitchen")&&(root?.areas||[]).includes("Living Room"),JSON.stringify(root));
ok("Kitchen is an atomic child workspace with inherited root identity",
  kitchen?.scope==="atomic"&&kitchen?.parentKey===parentKey&&kitchen?.continuityRootKey===parentKey,JSON.stringify(kitchen));
ok("Living Room is an atomic child workspace with inherited root identity",
  living?.scope==="atomic"&&living?.parentKey===parentKey&&living?.continuityRootKey===parentKey,JSON.stringify(living));

const units=box.deriveSluglineUnits(scenes,drafts);
const wanted=[["Kitchen","INT","Night"],["Kitchen","INT","Dawn"],["Living Room","INT","Dawn"]];
wanted.forEach(([name,side,time])=>ok(
  name+" "+side+" "+time+" remains a slugline unit",
  units.some(u=>u.name===name&&u.intExt===side&&u.time===time&&u.locationKey===parentKey&&u.subspaceKey===box.locSlug(name)),
  JSON.stringify(units.map(u=>({name:u.name,side:u.intExt,time:u.time,parent:u.locationKey,subspace:u.subspaceKey})))
));
ok("repeated Kitchen Dawn headings consolidate to one unit",
  units.filter(u=>u.name==="Kitchen"&&u.intExt==="INT"&&u.time==="Dawn").length===1);

const kitchenStates=box.locationAppearanceStates({...kitchen,variants:[
  {id:"legacy-dawn",time:"Dawn",state:"gray window light; practicals off"}
]},units);
ok("Appearance States projects both screenplay-addressed Kitchen states",
  kitchenStates.length===2&&kitchenStates.some(v=>v.time==="Night")&&kitchenStates.some(v=>v.time==="Dawn"),
  JSON.stringify(kitchenStates));
kitchenStates.forEach(v=>ok(
  "Appearance State shares the "+v.time+" slugline asset id",
  box.locationAppearanceStateAssetId(kitchen,v,units)===box.sluglineUnitImageId(v.linkedUnit.key),
  JSON.stringify(v)
));
ok("legacy Dawn notes are adopted without creating a duplicate state",
  kitchenStates.filter(v=>v.time==="Dawn").length===1&&kitchenStates.find(v=>v.time==="Dawn")?.state==="gray window light; practicals off",
  JSON.stringify(kitchenStates));
ok("child subspaces do not derive their own Coverage Views",
  box.deriveLocationCoverageSheets(kitchen,scenes,drafts,masters,units).length===0);

const competingFold=box.deriveSubspaceFold(scenes.concat([
  {id:"s2",no:2,loc:"INT. FUNERAL HOME OFFICE - NIGHT",summary:"Marcus waits at the funeral home."}
]),drafts);
ok("an unrelated Funeral Home does not make Father's House ambiguous",
  competingFold.kitchen===parentKey&&competingFold["living-room"]===parentKey,JSON.stringify(competingFold));

const ambiguousScenes=[
  {id:"a",no:1,loc:"INT. FATHER'S HOUSE - NIGHT",summary:"A house at night."},
  {id:"b",no:2,loc:"INT. MOTHER'S HOUSE - NIGHT",summary:"A house at night."},
  {id:"c",no:3,loc:"INT. KITCHEN - NIGHT",summary:"A kitchen in the house."}
];
const ambiguous=box.deriveSubspaceFold(ambiguousScenes,{});
ok("ambiguous room ownership remains separate",!ambiguous.kitchen,JSON.stringify(ambiguous));

const ui=readFileSync("app/locations-ui.jsx","utf8");
const ai=readFileSync("app/ai.jsx","utf8");
ok("child cards remain in the location grid",
  ui.includes("rawLocations.filter(Boolean).map")&&ui.includes("parentLocation")&&ui.includes("childLocations"));
ok("child relationship is explicit in the card header",
  ui.includes('"Child space"')&&ui.includes('" within "')&&ui.includes('" \\u00b7 inherits continuity"'));
ok("unit cards live on their matching subspace workspace",
  ui.includes("String(u.subspaceKey||u.locationKey||\"\")===String(l.key||\"\")"));
ok("place identity fields stay separate from continuity states",
  ui.includes('label:"Permanent lighting & daylight interfaces"')&&ui.includes('label:"Appearance states"')&&ui.includes('"Continuity anchors"'));
ok("location folds use the approved filmmaker-facing names",
  ["The space","Story significance","Screenplay sluglines","Appearance states","Coverage views","Staging & composition","Look dev","Compiled prompt"]
    .every(label=>ui.includes('label:"'+label+'"')));
ok("location folds follow identity to screenplay to view to generation order",
  ["label:\"The space\"","label:\"Story significance\"","label:\"Screenplay sluglines\"","label:\"Appearance states\"",
    "label:\"Coverage views\"","label:\"Staging & composition\"","label:\"Look dev\"","label:\"Compiled prompt\""]
    .map(token=>ui.indexOf(token)).every((at,i,all)=>at>=0&&(i===0||at>all[i-1])));
ok("topology and anchors stay nested inside The Space",
  ui.indexOf('field:"topology",label:"Spatial topology"')>ui.indexOf('label:"The space"')&&
  ui.indexOf('"Continuity anchors"')>ui.indexOf('field:"topology",label:"Spatial topology"')&&
  ui.indexOf('"Continuity anchors"')<ui.indexOf('label:"Story significance"'));
ok("location identity fields expose editable provenance",
  ui.includes("function LocationProvenanceSelect")&&ui.includes('field:"architecture"')&&
  ui.includes('field:"continuityAnchors"')&&ui.includes('className:"loc-prov-select"'));
ok("continuity-state descriptions reach the actual generator",
  readFileSync("app/locations.jsx","utf8").includes("{ time:v.time, state:v.state }")&&
  readFileSync("app/locations.jsx","utf8").includes('"continuity-state"'));
ok("slugline and appearance-state cards share one asset resolver",
  ui.includes("locationAppearanceStateAssetId(l,v,units||[])")&&
  ui.includes("Shared with Screenplay Sluglines")&&
  ui.includes("!l.parentLocation && React.createElement(CardFold,{label:\"Coverage views\""));
ok("Location Scout generates screenplay-derived shared states, not only legacy variants",
  readFileSync("app/app.jsx","utf8").includes("locationAppearanceStates(l,sluglineUnits||[])"));
ok("MUSE capability manifest names the approved location architecture",
  ai.includes('{ name:"Location compiled prompt"')&&
  ai.includes("The visible folds follow the dependency order The Space -> Story Significance -> Screenplay Sluglines -> Appearance States -> Coverage Views -> Staging & Composition -> Look Dev -> Compiled Prompt.")&&
  ai.includes("two views of the same place/side/time record")&&
  ai.includes("Child spaces such as Kitchen do not derive Coverage Views of their own"));

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

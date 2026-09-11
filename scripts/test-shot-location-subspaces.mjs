#!/usr/bin/env node
/* Focused functional tests for beat-scoped location-unit reference selection.
   These load the real Locations identity/unit helpers, typed screenplay source,
   and Shots resolver. No browser, workflow, image generation, or network. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const box={
  console, Date, Set, Map, Math, JSON, Number, String, Object, Array, RegExp,
  isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
  turnContinuity:{}, window:null, globalThis:null,
};
box.window=box;
box.globalThis=box;
vm.createContext(box);

/* The location data layer has no React dependency in this prefix. */
const locations=readFileSync("app/locations.jsx","utf8");
const locationEnd=locations.indexOf("function locationScreenplayReferenceImages");
assert.ok(locationEnd>0);
vm.runInContext(locations.slice(0,locationEnd),box,{filename:"app/locations.jsx#location-data"});
vm.runInContext(readFileSync("app/shot-screenplay.js","utf8"),box,{filename:"app/shot-screenplay.js"});
vm.runInContext(readFileSync("app/shots.jsx","utf8"),box,{filename:"app/shots.jsx"});

const parent={
  id:"loc-fathers-house",key:"fathers-house",name:"Father's House",scope:"compound",
  intExt:"INT",scenes:["scene-a","scene-b"],parentKey:"",continuityRootKey:"fathers-house",
};
const kitchen={
  id:"loc-kitchen",key:"kitchen",name:"Kitchen",scope:"atomic",parentKey:"fathers-house",
  continuityRootKey:"fathers-house",intExt:"INT",scenes:["scene-a"],
};
const living={
  id:"loc-living",key:"living-room",name:"Living Room",scope:"atomic",parentKey:"fathers-house",
  continuityRootKey:"fathers-house",intExt:"INT",scenes:["scene-a"],
};
const yard={
  id:"loc-yard",key:"yard",name:"Father's House",scope:"atomic",parentKey:"fathers-house",
  continuityRootKey:"fathers-house",intExt:"EXT",scenes:["scene-a"],
};
const units=[
  {key:"kitchen|INT|Night",name:"Kitchen",place:"Kitchen",intExt:"INT",time:"Night",
    subspaceKey:"kitchen",continuityRootKey:"fathers-house",locationKey:"fathers-house",scenes:["scene-a"]},
  {key:"living-room|INT|Night",name:"Living Room",place:"Living Room",intExt:"INT",time:"Night",
    subspaceKey:"living-room",continuityRootKey:"fathers-house",locationKey:"fathers-house",scenes:["scene-a"]},
  {key:"fathers-house|EXT|Night",name:"Father's House",place:"Father's House",intExt:"EXT",time:"Night",
    subspaceKey:"fathers-house",continuityRootKey:"fathers-house",locationKey:"fathers-house",scenes:["scene-a"]},
  {key:"kitchen|INT|Day",name:"Kitchen",place:"Kitchen",intExt:"INT",time:"Day",
    subspaceKey:"kitchen",continuityRootKey:"fathers-house",locationKey:"fathers-house",scenes:["scene-b"]},
];
const kitchenId=box.sluglineUnitImageId(units[0].key);
const livingId=box.sluglineUnitImageId(units[1].key);
const yardId=box.sluglineUnitImageId(units[2].key);
const dayKitchenId=box.sluglineUnitImageId(units[3].key);

const scene={id:"scene-a",no:2,title:"The House",loc:"INT. FATHER'S HOUSE - NIGHT"};
const draft={
  blocks:[
    {type:"scene",text:"INT. FATHER'S HOUSE - NIGHT"},
    {type:"action",text:"MARCUS enters the house.",beat:1},
    {type:"scene",text:"INT. KITCHEN - NIGHT"},
    {type:"action",text:"MARCUS searches the kitchen drawer.",beat:2},
    {type:"scene",text:"INT. LIVING ROOM - NIGHT"},
    {type:"action",text:"DANIEL sprawls across the couch.",beat:3},
    {type:"action",text:"DANIEL checks the lamp.",beat:2},
  ],
};
const sceneB={id:"scene-b",no:3,title:"Morning",loc:"INT. KITCHEN - DAY"};
const drafts={"scene-a":draft,"scene-b":{blocks:[
  {type:"scene",text:"INT. KITCHEN - DAY"},
  {type:"action",text:"MARCUS washes the cup.",beat:1},
]}};
box.turnContinuity={sluglineUnits:units,drafts,locations:[parent,kitchen,living]};

const specs=(loc,sh,sc=scene)=>box.shotLocationCoverageSpecs(loc,sh,sc,drafts);
const ids=xs=>Array.from(xs,x=>x.id);
const choices=(loc,sh,sc=scene)=>box.shotLocationReferenceChoices(loc,sh,sc,drafts);

assert.deepEqual(ids(specs(parent,{id:"beat-2",beatN:2,action:"MARCUS searches the drawer."})),[kitchenId],
  "beat 2 uses the Kitchen unit, never Living Room or parent master");
assert.deepEqual(choices(parent,{id:"beat-2",beatN:2,action:"MARCUS searches the drawer."})
  .map(x=>x.label),["Kitchen · INT · Night","Living Room · INT · Night"],
  "room choices enumerate compound units without needing warm image bytes");
assert.ok(choices(parent,{id:"beat-2",beatN:2,action:"MARCUS searches the drawer."})
  .every(x=>Object.keys(x).sort().join(",")==="id,label"&&x.id&&x.label),
  "room choices expose stable full-frame unit ids and labels");
assert.deepEqual(ids(specs(parent,{id:"beat-3",beatN:3,action:"DANIEL enters."})),[livingId],
  "a later room entry is scoped to its own beat");
assert.deepEqual(ids(specs(parent,{id:"other-scene",beatN:1,action:"MARCUS washes the cup."},sceneB)),[dayKitchenId],
  "the same room in another scene uses that scene's unit, not scene-a Night");
assert.equal(specs(parent,{id:"bad",beatN:4,action:"wrong room"}).length,0,
  "a typed beat with no matching room fails closed");
const fallbackSheet={id:"cov-kitchen-interior",name:"Kitchen Interior",role:"INT",sceneNos:[2]};
parent.coverageSheets=[fallbackSheet];
box.turnContinuity={sluglineUnits:units.filter(u=>u.key!==units[0].key),drafts,
  locations:[parent,kitchen,living]};
assert.deepEqual(ids(specs(parent,{id:"coverage-fallback",beatN:2,action:"drawer"})),
  [parent.id+"-"+fallbackSheet.id],
  "a matching screenplay coverage sheet is a legitimate fallback when a unit is absent");
parent.coverageSheets=[];
box.turnContinuity={sluglineUnits:units,drafts,locations:[parent,kitchen,living]};

assert.deepEqual(ids(specs(parent,{id:"manual",beatN:2,referenceLocationsSet:true,
  referenceLocationIds:[livingId]})),[livingId],
  "an explicit genuine unit selection is authoritative");
assert.deepEqual(ids(specs(parent,{id:"manual-empty",referenceLocationsSet:true,referenceLocationIds:[]})),[],
  "an explicit empty selection stays empty");
assert.equal(specs(parent,{id:"manual-master",beatN:2,referenceLocationsSet:true,
  referenceLocationIds:[parent.id]}).length,0,
  "the compound master is never a valid full-frame unit reference");

const ambiguousUnits=units.concat({
  key:"kitchen|INT|Night-alt",name:"Kitchen",place:"Kitchen",intExt:"INT",time:"Night",
  subspaceKey:"kitchen",continuityRootKey:"fathers-house",locationKey:"fathers-house",scenes:["scene-a"],
});
box.turnContinuity={sluglineUnits:ambiguousUnits,drafts,locations:[parent,kitchen,living]};
assert.equal(box.shotLocationCoverageSpecs(parent,{id:"ambiguous",beatN:2,action:"drawer"},scene,drafts).length,0,
  "duplicate same-room units are ambiguous rather than first-sorted");

box.turnContinuity={sluglineUnits:units,drafts,locations:[parent,kitchen,living]};
assert.deepEqual(ids(specs(parent,{id:"bare",beatN:2,action:"drawer"})),[kitchenId],
  "bare room names still resolve through the typed screenplay heading");
assert.deepEqual(ids(specs(parent,{id:"int",beatN:2,locationSide:"INT",action:"drawer"})),[kitchenId],
  "INT explicitly selects the interior unit");
assert.deepEqual(ids(specs(parent,{id:"ext",beatN:2,locationSide:"EXT",action:"drawer"})),[],
  "an EXT override cannot silently use the INT Kitchen plate");
assert.deepEqual(choices(parent,{id:"ext-choices",beatN:2,locationSide:"EXT",action:"drawer"})
  .map(x=>x.id),[yardId],
  "reference choices honor the requested context side");

/* Picker calls carry beat text but historically omitted beatN. The resolver
   recovers a unique typed beat and remains closed on an ambiguous phrase. */
assert.deepEqual(ids(specs(parent,{id:"picker",referencePickerAll:true,
  action:"MARCUS searches the kitchen drawer."})),[kitchenId],
  "manual picker remains scoped to the beat text");
assert.equal(specs(parent,{id:"picker-ambiguous",referencePickerAll:true,
  action:"MARCUS"}).length,0,
  "picker ambiguity does not default to the first unit");

/* Cold sync cache is irrelevant to identity selection: the real unit id remains
   selected and async resolution can decide whether its bytes are available. */
box.nbGetImage=()=> "";
assert.deepEqual(ids(specs(parent,{id:"cold",beatN:2,action:"drawer"})),[kitchenId],
  "cold image cache does not replace a unit with a master or crop");
assert.ok(specs(parent,{id:"cold",beatN:2,action:"drawer"})
  .every(x=>x.assetSourceQuality==="slugline_unit_full_frame"&&!/crop|master/i.test(x.id+" "+x.note)),
  "location refs are full-frame unit assets only");

console.log("PASS shot location subspace tests");
#!/usr/bin/env node
/* Shared location-reference catalog and exact selection tests.  These exercise
   the real Locations identity/state/image-id helpers and the Shots data layer
   only: no browser, provider, workflow or network. */
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
const locations=readFileSync("app/locations.jsx","utf8");
const locationEnd=locations.indexOf("function locationScreenplayReferenceImages");
assert.ok(locationEnd>0);
vm.runInContext(locations.slice(0,locationEnd),box,{filename:"app/locations.jsx#location-data"});
vm.runInContext(readFileSync("app/shot-screenplay.js","utf8"),box,{filename:"app/shot-screenplay.js"});
vm.runInContext(readFileSync("app/shots.jsx","utf8"),box,{filename:"app/shots.jsx"});

const rootA={id:"root-a",key:"estate-a",name:"Estate",scope:"compound",intExt:"INT",
  continuityRootKey:"estate-a",scenes:["scene-a"]};
const roomA={id:"room-a",key:"kitchen-a",name:"Kitchen",scope:"atomic",parentKey:"estate-a",
  continuityRootKey:"estate-a",intExt:"INT",scenes:["scene-a"]};
const rootB={id:"root-b",key:"estate-b",name:"Estate",scope:"compound",intExt:"INT",
  continuityRootKey:"estate-b",scenes:["scene-b"]};
const roomB={id:"room-b",key:"kitchen-b",name:"Kitchen",scope:"atomic",parentKey:"estate-b",
  continuityRootKey:"estate-b",intExt:"INT",scenes:["scene-b"]};
const unitA={key:"kitchen-a|INT|Night",name:"Kitchen",place:"Kitchen",intExt:"INT",time:"Night",
  subspaceKey:"kitchen-a",continuityRootKey:"estate-a",locationKey:"estate-a",scenes:["scene-a"],
  appearance:"rainy"};
const unitAExterior={key:"estate-a|EXT|Night",name:"Estate",place:"Estate",intExt:"EXT",time:"Night",
  subspaceKey:"estate-a",continuityRootKey:"estate-a",locationKey:"estate-a",scenes:["scene-a"]};
const unitB={key:"kitchen-b|INT|Night",name:"Kitchen",place:"Kitchen",intExt:"INT",time:"Night",
  subspaceKey:"kitchen-b",continuityRootKey:"estate-b",locationKey:"estate-b",scenes:["scene-b"]};
rootA.coverageSheets=[{id:"cov-kitchen",name:"Kitchen coverage",role:"INT",sceneNos:[1]}];
rootA.variants=[{id:"legacy-dawn",time:"Dawn",intExt:"INT",state:"blue-hour"}];
const units=[unitA,unitAExterior,unitB];
const idA=box.sluglineUnitImageId(unitA.key);
const idB=box.sluglineUnitImageId(unitB.key);
const idExterior=box.sluglineUnitImageId(unitAExterior.key);
const legacyId=rootA.id+"-legacy-dawn";
const sceneA={id:"scene-a",no:1,loc:"INT. KITCHEN - NIGHT",title:"Estate"};
const sceneB={id:"scene-b",no:2,loc:"INT. KITCHEN - NIGHT",title:"Other Estate"};
const drafts={"scene-a":{blocks:[
  {type:"scene",text:"INT. KITCHEN - NIGHT"},
  {type:"action",text:"MARA opens the drawer.",beat:1},
]},"scene-b":{blocks:[
  {type:"scene",text:"INT. KITCHEN - NIGHT"},
  {type:"action",text:"MARA enters.",beat:1},
]}};
box.turnContinuity={locations:[rootA,roomA,rootB,roomB],sluglineUnits:units,
  scenes:[sceneA,sceneB],drafts};

const sh={id:"shot-a",beatN:1,action:"MARA opens the drawer."};
const catalog=box.shotLocationReferenceCatalog(roomA,sh,sceneA,drafts);
assert.ok(catalog.length>=8,"catalog includes all current-film places and genuine references");
assert.ok(catalog.some(x=>x.category==="place"&&x.id===rootA.id));
assert.ok(catalog.some(x=>x.category==="place"&&x.id===roomA.id));
assert.ok(catalog.some(x=>x.category==="unit"&&x.id===idA));
assert.ok(catalog.some(x=>x.category==="unit"&&x.id===idB));
assert.ok(catalog.some(x=>x.category==="coverage"&&x.id===rootA.id+"-cov-kitchen"));
assert.ok(catalog.some(x=>x.category==="state"&&x.id===legacyId));
const same= catalog.find(x=>x.id===idA);
assert.ok(same.categories.includes("unit")&&same.categories.includes("state"),
  "a linked unit and Appearance State share one canonical attachment identity");
assert.match(same.label,/Kitchen-a|Kitchen.*INT.*Night/i);
assert.match(catalog.find(x=>x.id===idB).label,/Estate.*Kitchen|Kitchen.*Estate/i,
  "same-name units retain their continuity-root identity in labels");
assert.equal(catalog.findIndex(x=>x.id===idA)<catalog.findIndex(x=>x.id===rootA.id),
  true,"current beat unit precedes the current continuity root");

/* Choices are cold-cache inventory, not a byte-availability filter. */
box.nbGetImage=()=> "";
const choices=box.shotLocationReferenceChoices(roomA,sh,sceneA,drafts);
assert.ok(choices.some(x=>x.id===idA&&x.category==="unit"));
assert.ok(choices.some(x=>x.id===rootA.id&&x.category==="place"));
assert.ok(choices.every(x=>x.id&&x.label&&x.category&&x.categoryLabel&&x.description));
assert.ok(!choices.some(x=>[rootB.id,roomB.id,idB].includes(x.id)),
  "other-scene places and units are not offered, even with identical location names");
assert.ok(choices.some(x=>x.id===rootA.id+"-cov-kitchen")
  &&choices.some(x=>x.id===legacyId),
  "scene-linked coverage and the current place's reusable appearance states remain available");
const libraryChoices=box.shotLocationReferenceChoices(null,{id:"library"},sceneA,drafts);
assert.ok(libraryChoices.some(x=>x.id===rootA.id)&&libraryChoices.some(x=>x.id===idA)
  &&!libraryChoices.some(x=>x.id===rootB.id||x.id===idB),
  "a missing current location still offers only references linked to the scene");
assert.equal(box.shotLocationReferenceChoices(null,{},null,drafts).length,0,
  "a missing scene never opens the whole film library");
assert.ok(box.shotLocationReferenceChoices(null,{sceneId:sceneA.id},null,drafts).some(x=>x.id===idA),
  "the shot scene ID supplies scope when the scene object is missing");

/* Per-asset scene links take priority over a place reused across scenes.
   Units also associate their exact owner (and ancestors) with a scene. */
const anotherRoom={id:"other-room",key:"other-room",name:"Study",parentKey:"estate-a",scenes:["scene-b"]};
const annex={id:"annex",key:"annex",name:"Annex",scenes:[]};
const morningUnit={...unitA,key:"kitchen-a|INT|Day",time:"Day",scenes:["scene-b"]};
const annexUnit={key:"annex|EXT|Night",subspaceKey:"annex",locationKey:"annex",place:"Annex",
  time:"Night",intExt:"EXT",scenes:["scene-a"]};
rootA.coverageSheets.push({id:"other-scene-coverage",name:"Morning coverage",role:"INT",sceneNos:[2]});
rootA.variants.push({id:"other-scene-state",time:"Day",state:"sunlit",scenes:["scene-b"]});
box.turnContinuity={...box.turnContinuity,locations:[rootA,roomA,rootB,roomB,anotherRoom,annex],
  sluglineUnits:[...units,morningUnit,annexUnit]};
const sceneOptions=box.shotLocationReferenceChoices(roomA,sh,sceneA,drafts);
assert.ok(!sceneOptions.some(x=>[anotherRoom.id,box.sluglineUnitImageId(morningUnit.key),
  rootA.id+"-other-scene-coverage",rootA.id+"-other-scene-state"].includes(x.id)),
  "same-place other-scene subspaces, times, coverage and states stay out of the picker");
assert.ok(sceneOptions.some(x=>x.id===annex.id)&&sceneOptions.some(x=>x.id===box.sluglineUnitImageId(annexUnit.key)),
  "a second place used by this scene is offered through its unit's canonical scene link");
assert.ok(box.shotLocationReferenceChoices(roomA,sh,sceneB,drafts).some(x=>x.id===idB),
  "switching scenes changes the available references");
rootA.coverageSheets.pop();rootA.variants.pop();
box.turnContinuity={...box.turnContinuity,locations:[rootA,roomA,rootB,roomB],sluglineUnits:units};

/* Exact explicit selection supports a place, a different-root unit, coverage,
   linked state and a legacy state in persisted order. */
const explicitIds=[rootA.id,idB,rootA.id+"-cov-kitchen",idA,legacyId];
const explicit={id:"explicit",referenceLocationsSet:true,referenceLocationIds:explicitIds};
const savedChoices=box.shotLocationReferenceChoices(roomA,explicit,sceneA,drafts);
assert.equal(savedChoices.find(x=>x.id===idB)?.outOfScene,true,
  "an existing other-scene selection remains visible and distinctly labeled");
assert.equal(savedChoices.find(x=>x.id===idA)?.outOfScene,false);
assert.equal(savedChoices.filter(x=>x.id===idA).length,1,"scene filtering preserves unit/state deduplication");
assert.ok(!box.shotLocationReferenceChoices(roomA,{...explicit,
  referenceLocationIds:explicitIds.filter(id=>id!==idB)},sceneA,drafts).some(x=>x.id===idB),
  "a removed outside-scene selection is no longer offered");
const exact=box.shotLocationCoverageSpecs(roomA,explicit,sceneA,drafts);
assert.deepEqual(Array.from(exact,x=>x.id),explicitIds);
assert.ok(exact.every(x=>x.required===true&&!x.unavailable));
assert.equal(exact[0].category,"place");
assert.equal(exact[1].locationId,roomB.id);
assert.equal(exact[2].category,"coverage");
assert.ok(exact[3].categories.includes("unit")&&exact[3].categories.includes("state"));
assert.equal(exact[4].assetSourceQuality,"location_state_full_frame");
assert.match(exact[0].note,/design reference|multi-panel/i);
assert.deepEqual(Array.from(box.shotLocationCoverageSpecs(roomA,
  {...explicit,referenceLocationIds:[]},sceneA,drafts)),[],"manual empty stays empty");

const unknown={id:"deleted",referenceLocationsSet:true,
  referenceLocationIds:["deleted-place","deleted-unit"]};
const unknownSpecs=box.shotLocationCoverageSpecs(roomA,unknown,sceneA,drafts);
assert.deepEqual(Array.from(unknownSpecs,x=>x.id),unknown.referenceLocationIds);
assert.ok(unknownSpecs.every(x=>x.unavailable&&x.required));
assert.ok(unknownSpecs.every(x=>/deleted|unavailable|choose another/i.test(x.note)));
const retainedWithoutLocation=box.shotLocationCoverageSpecs(null,{
  id:"retained",referenceLocationsSet:true,referenceLocationIds:[idB,rootA.id]},sceneA,drafts);
assert.deepEqual(Array.from(retainedWithoutLocation,x=>x.id),[idB,rootA.id],
  "explicit current-film selections survive a missing scene location");
assert.equal(box.shotLocationCoverageSpecs(null,{id:"automatic",beatN:1},sceneA,drafts).length,0,
  "automatic inference remains closed without a current location");
const inventoryCalls=[];
assert.deepEqual(Array.from(await box.shotResolveLocationSpecImages(unknownSpecs,
  async id=>{inventoryCalls.push(id);return "";},{allowMissing:true})),[]);
assert.deepEqual(inventoryCalls,unknown.referenceLocationIds,
  "allowMissing inventory resolution still probes the actual ids without throwing");

/* Headless resolution is fail-closed after the async grab and exposes a stable
   typed error; it must never become a silent empty attachment list. */
let grabbed=[];
await assert.rejects(
  ()=>box.shotResolveLocationSpecImages(unknownSpecs,async id=>{grabbed.push(id);return "";}),
  e=>e && e.name==="ShotLocationReferenceError"
    && e.code==="SHOT_LOCATION_REFERENCE_UNAVAILABLE"
    && e.errorFlag==="fatal-reference"
    && e.fatalReference===true
    && e.requiredReference===true
    && e.referenceId==="deleted-place");
assert.deepEqual(grabbed,["deleted-place"]);
await assert.rejects(
  ()=>box.shotLoadLocationSpecImage({...unknownSpecs[0],unavailable:false},async()=> ""),
  e=>e && e.name==="ShotLocationReferenceError" && e.requiredReference===true);

/* Empty refOff removes only the explicitly excluded attachment.  A render plan
   and its actual resolver keep prompt/reference identity aligned. */
const renderShot={id:"render",beatN:1,action:"MARA opens the drawer.",
  size:"WS",referenceLocationsSet:true,referenceLocationIds:[idA,legacyId],
  refOff:[idA]};
const plan=box.shotRenderPlan(renderShot,[renderShot],{
  location:roomA,scene:sceneA,drafts,charById:{},propById:{},scenes:[sceneA],
});
assert.deepEqual(Array.from(plan.activeLocSpec,x=>x.id),[legacyId]);
const missingLocationPlan=box.shotRenderPlan({...renderShot,referenceLocationIds:[idB]},[renderShot],{
  location:null,scene:sceneA,drafts,charById:{},propById:{},scenes:[sceneA],
});
assert.deepEqual(Array.from(missingLocationPlan.activeLocSpec,x=>x.id),[idB]);
const refs=await box.shotResolveRenderRefs(plan,async id=>"url:"+id);
assert.deepEqual(Array.from(refs,x=>x.refId),[legacyId]);
const prompt=box.buildShotPrompt(renderShot,{
  location:roomA,scene:sceneA,drafts,charById:{},propById:{},scenes:[sceneA],
  resolvedRefs:refs,
});
assert.match(prompt,/MANUALLY SELECTED LOCATION REFERENCES.*authoritative/i);
assert.match(prompt,/blue-hour|Appearance State/i);
assert.match(prompt,/url|legacy-dawn|Appearance State/i);

/* Simple mode retains the written selected-reference contract when the actual
   required refs are supplied; automatic simple recovery still has no map. */
const simplePrompt=box.buildShotPrompt({...renderShot,refOff:[]},{
  location:roomA,scene:sceneA,drafts,charById:{},propById:{},scenes:[sceneA],
  simpleMode:true,resolvedRefs:await box.shotResolveLocationSpecImages(
    box.shotLocationCoverageSpecs(roomA,{...renderShot,refOff:[]},sceneA,drafts),
    async id=>"url:"+id),
});
assert.match(simplePrompt,/MANUALLY SELECTED LOCATION REFERENCES.*authoritative/i);
assert.match(simplePrompt,/Image 1 is|Appearance State/i);
const automaticSimple=box.buildShotPrompt({id:"auto-simple",beatN:1,action:"MARA opens the drawer."},{
  location:roomA,scene:sceneA,drafts,charById:{},propById:{},scenes:[sceneA],simpleMode:true,
});
assert.doesNotMatch(automaticSimple,/Image 1 is/);

console.log("PASS shot location reference catalog tests");
#!/usr/bin/env node
import {readFileSync} from "node:fs";
import vm from "node:vm";

const box={console};
box.window=box;box.globalThis=box;
vm.createContext(box);
vm.runInContext(readFileSync("app/stage-references.jsx","utf8"),box,{filename:"app/stage-references.jsx"});
let pass=0,fail=0;
const ok=(name,v)=>{if(v)pass++;else{fail++;console.log("FAIL "+name);}};

const scenes=[{id:"s1"},{id:"s2"}];
const characters=[
  {id:"c1",states:[{id:"rain",sceneId:"s2"}]},
  {id:"c2",states:[]}
];
const location={id:"l1",scenes:["s1","s2"]};
const metadata={
  c1:{iso:"c1-master-v1",version:1,approval:{iso:"c1-master-v1",approved:true}},
  "c1:rain":{iso:"c1-v2",version:2,approval:{iso:"c1-v2",approved:true}},
  c2:{iso:"c2-v1",version:1,approval:{iso:"c2-v1",approved:false}},
  "l1-int":{iso:"li-v1",version:1,approval:{iso:"li-v1",approved:true}},
  "l1-ext":{iso:"le-v1",version:1,approval:{iso:"le-v1",approved:true}},
  "p1:wet":{iso:"p-v2",version:2,approval:{iso:"p-v2",approved:true}}
};
box.inFrameCast=(sh)=>sh.referenceCharactersSet?sh.referenceCharacterIds:sh.subjects;
box.activeStateForScene=(c,scene,all)=>{
  const st=(c.states||[]).find(x=>all.findIndex(s=>s.id===x.sceneId)<=all.findIndex(s=>s.id===scene.id));
  return {version:st?2:1,state:st||null};
};
box.locationForScene=()=>location;
box.shotLocationCoverageSpecs=(loc,sh)=>{
  if(sh.referenceLocationsSet){
    const all=[{id:"l1-int",source:"screenplay-coverage"},{id:"l1-ext",source:"slugline-unit"}];
    return all.filter(x=>sh.referenceLocationIds.includes(x.id));
  }
  return sh.id==="a"?[{id:"l1-int",source:"screenplay-coverage"}]:[{id:"l1-ext",source:"slugline-unit"}];
};
box.inFrameProps=sh=>sh.props||[];
box.shotPropSheetId=()=>({id:"p1:wet",state:{id:"wet"}});

const shots=[
  {id:"a",sceneId:"s2",subjects:["c1","c2"],props:["p1"]},
  {id:"b",sceneId:"s2",referenceCharactersSet:true,referenceCharacterIds:["c1"],
    referenceLocationsSet:true,referenceLocationIds:["l1-ext"],props:["p1"]},
  {id:"c",sceneId:"s2",referenceCharactersSet:true,referenceCharacterIds:["c2"],
    referenceLocationsSet:true,referenceLocationIds:[],refOff:["c2"],props:[]}
];
const ctx={scenes,characters,props:[{id:"p1"}],locations:[location],metadata};
const pkg=box.stageShotReferencePackage(shots,ctx);
ok("builder exported",typeof box.stageShotReferencePackage==="function");
ok("active character variant id is canonical",pkg.characters.some(x=>x.assetId==="c1:rain"&&x.stateId==="rain"));
ok("manual character selection respected",pkg.byShot.find(x=>x.shotId==="b").characters.length===1);
ok("refOff respected",pkg.byShot.find(x=>x.shotId==="c").characters.length===0);
ok("location resolved independently per shot",pkg.byShot.find(x=>x.shotId==="a").locations[0]==="l1-int"
  &&pkg.byShot.find(x=>x.shotId==="b").locations[0]==="l1-ext");
ok("empty manual location selection stays empty",pkg.byShot.find(x=>x.shotId==="c").locations.length===0);
const prop=pkg.props.find(x=>x.assetId==="p1:wet");
ok("dedupe preserves per-shot uses",pkg.props.length===1&&prop.usages.length===2&&prop.shotIds.length===2);
ok("saved reference needs no separate approval warning",!pkg.warnings.some(x=>x.code==="unapproved-reference"));
ok("empty manual location selection is not a blocker",!pkg.warnings.some(x=>x.code==="missing-location-coverage"&&x.shotId==="c"));
const goneSelection=box.stageShotReferencePackage([
  {id:"gone-loc",sceneId:"s2",subjects:[],referenceLocationsSet:true,referenceLocationIds:["l1-gone"]}
],ctx);
ok("missing selected location never falls back to master",goneSelection.locations.some(x=>x.assetId==="l1-gone")
  &&goneSelection.warnings.some(x=>x.imageId==="l1-gone"&&x.code==="missing-reference"&&x.severity==="error"));

const stale=box.stageReferenceStatus({imageId:"c1:rain",iso:"old"},ctx);
ok("saved snapshot stale against current",stale.stale&&stale.reasons.includes("Reference version changed"));
const missing=box.stageReferenceStatus({imageId:"gone"},ctx);
ok("missing reported honestly",missing.missing&&missing.reasons.some(x=>x.includes("Reference image is missing")));
const privatePkg=box.stageShotReferencePackage([{id:"p",sceneId:"s2",subjects:["c1"],props:[]}],
  {...ctx,metadata:{...metadata,"c1:rain":{...metadata["c1:rain"],deviceOnly:true}}});
ok("device-only reference excluded",privatePkg.characters.length===0&&privatePkg.warnings.some(x=>x.code==="excluded-reference"));
ok("snapshot pins id/version/iso/approval/current",JSON.stringify(pkg.characters[0].snapshot)===
  JSON.stringify({imageId:"c1:rain",iso:"c1-v2",version:2,approved:true,approvalIso:"c1-v2",approvalReviewKey:"",current:true}));
ok("stable signature",pkg.signature===box.stageShotReferencePackage(shots,ctx).signature);

const missingChar=box.stageShotReferencePackage([
  {id:"gone-char",sceneId:"s2",referenceCharactersSet:true,referenceCharacterIds:["deleted-c"]}
],ctx);
ok("missing manually selected character is retained and errors",
  missingChar.characters.some(x=>x.assetId==="deleted-c"&&x.required)
  &&missingChar.warnings.some(x=>x.code==="missing-selected-character"&&x.severity==="error"));
const noLocCtx={...ctx,locations:[]};
box.locationForScene=()=>null;
const disappearedLoc=box.stageShotReferencePackage([
  {id:"gone-location",sceneId:"s2",locationId:"deleted-loc",
    referenceLocationsSet:true,referenceLocationIds:["deleted-coverage"]}
],noLocCtx);
ok("manual location survives missing location card without master fallback",
  disappearedLoc.locations.some(x=>x.assetId==="deleted-coverage"&&x.baseId==="deleted-loc"&&x.required)
  &&disappearedLoc.warnings.some(x=>x.imageId==="deleted-coverage"&&x.severity==="error"));
box.locationForScene=()=>location;

const implicitBase=box.stageShotReferencePackage([
  {id:"implicit",sceneId:"s1",subjects:["missing-base"],props:[]}
],{...ctx,characters:[{id:"missing-base",states:[]}]});
ok("implicit base absence warns but does not block",
  implicitBase.characters[0].required===false
  &&implicitBase.warnings.some(x=>x.imageId==="missing-base"&&x.code==="missing-reference"&&x.severity==="warning"));
const reviewedMeta={iso:"v1",version:1,approval:{iso:"v1",approved:true,reviewKey:"rk"} ,specPrompt:"old"};
const unchecked=box.stageReferenceStatus({imageId:"reviewed"},{metadata:{reviewed:reviewedMeta}});
ok("approval without current context is marked unchecked",
  unchecked.approved&&unchecked.approvalReviewKey==="rk"&&!unchecked.contextChecked&&!unchecked.currentApproval);
const staleSpec=box.stageReferenceStatus({imageId:"reviewed"},{metadata:{reviewed:reviewedMeta},currentSpecs:{reviewed:"new"}});
ok("stale current spec cannot be currently approved",
  staleSpec.contextChecked&&!staleSpec.currentApproval&&staleSpec.stale);
const fingerprint=box.stageReferenceStatus({imageId:"reviewed"},{
  metadata:{reviewed:reviewedMeta},currentReviewKeys:{reviewed:"new-rk"}
});
ok("approval review fingerprint is checked against current context",
  fingerprint.contextChecked&&!fingerprint.currentApproval
  &&fingerprint.reasons.includes("Approved review context changed"));

const metadataWithoutImage=box.stageReferenceStatus({imageId:"c1:rain"},{...ctx,images:{}});
ok("metadata alone cannot satisfy a supplied loaded-image inventory",
  metadataWithoutImage.availabilityKnown&&metadataWithoutImage.missing);
const coldPackage=box.stageShotReferencePackage([shots[1]],{...ctx,images:{}});
ok("missing active variant blocks even when approved metadata exists",
  coldPackage.warnings.some(x=>x.imageId==="c1:rain"&&x.code==="missing-reference"&&x.severity==="error"));
ok("missing reference is not duplicated as a review-required issue",
  !coldPackage.warnings.some(x=>x.imageId==="c1:rain"&&x.code==="review-required"
    &&/missing or has not finished loading/i.test(String(x.message||""))));
const warmPackage=box.stageShotReferencePackage([shots[1]],{...ctx,
  images:{"c1:rain":"data:image/png;base64,fixture","l1-ext":"data:image/png;base64,fixture","p1:wet":"data:image/png;base64,fixture"}});
ok("loaded references clear missing blockers without altering metadata",
  !warmPackage.warnings.some(x=>x.severity==="error"&&x.code==="missing-reference"));
ok("async image arrival changes the package signature",coldPackage.signature!==warmPackage.signature);
ok("metadata-only history review cannot claim checked file availability",
  !box.stageReferenceStatus({imageId:"c1:rain"},ctx).availabilityKnown);

const overrideShot={id:"override",sceneId:"s2",subjects:["c1"],props:[],
  stageCharacterReferenceOverrides:{c1:"master"}};
const masterOverride=box.stageShotReferencePackage([overrideShot],ctx);
const overriddenCharacter=masterOverride.characters.find(x=>x.assetId==="c1");
ok("explicit master override resolves the existing master",
  overriddenCharacter&&overriddenCharacter.baseId==="c1"&&overriddenCharacter.entityId==="c1"
  &&overriddenCharacter.stateId===""&&overriddenCharacter.required
  &&overriddenCharacter.usages.some(x=>x.shotId==="override"&&x.role==="master"
    &&x.source==="shot-master-override"));
ok("master override does not warn for the scene variant",
  !masterOverride.warnings.some(x=>x.imageId==="c1:rain"));

const missingMaster=box.stageShotReferencePackage([overrideShot],{
  ...ctx,metadata:{...metadata,c1:undefined}
});
ok("missing master override remains a blocker",
  missingMaster.warnings.some(x=>x.imageId==="c1"&&x.code==="missing-reference"&&x.severity==="error"));
const privateMaster=box.stageShotReferencePackage([overrideShot],{
  ...ctx,metadata:{...metadata,c1:{...metadata.c1,private:true}}
});
ok("private master override remains blocked",
  privateMaster.characters.length===0
  &&privateMaster.warnings.some(x=>x.imageId==="c1"&&x.code==="excluded-reference"&&x.severity==="error"));

const grouped=box.stageShotReferencePackage([
  overrideShot,
  {id:"variant-sibling",sceneId:"s2",subjects:["c1"],props:[]}
],ctx);
ok("grouped sibling retains its required scene variant",
  grouped.characters.some(x=>x.assetId==="c1"&&x.required)
  &&grouped.characters.some(x=>x.assetId==="c1:rain"&&x.stateId==="rain"&&x.required)
  &&grouped.byShot.find(x=>x.shotId==="variant-sibling").characters.includes("c1:rain"));

const revertedShot={...overrideShot,stageCharacterReferenceOverrides:{...overrideShot.stageCharacterReferenceOverrides}};
delete revertedShot.stageCharacterReferenceOverrides.c1;
const reverted=box.stageShotReferencePackage([revertedShot],ctx);
ok("deleting override restores scene appearance variant",
  reverted.byShot[0].characters.length===1&&reverted.byShot[0].characters[0]==="c1:rain");
ok("override changes signature usage even when master was already selected",
  box.stageShotReferencePackage([
    {id:"base-scene",sceneId:"s1",subjects:["c1"],props:[]}
  ],ctx).signature!==box.stageShotReferencePackage([
    {id:"base-scene",sceneId:"s1",subjects:["c1"],props:[],
      stageCharacterReferenceOverrides:{c1:"master"}}
  ],ctx).signature);

const invalidOverride=box.stageShotReferencePackage([{
  id:"invalid-override",sceneId:"s2",subjects:["c1"],props:[],
  stageCharacterReferenceOverrides:{c1:"c1:rain"}
}],ctx);
ok("invalid override value never silently falls back",
  invalidOverride.byShot[0].characters.length===0
  &&invalidOverride.warnings.some(x=>x.code==="invalid-character-reference-override"
    &&x.severity==="error"));

const mutationShot={id:"immutable",sceneId:"s2",subjects:["c1"],props:[],
  stageCharacterReferenceOverrides:{c1:"master"}};
const mutationCharacters=JSON.stringify(characters);
const mutationShotBefore=JSON.stringify(mutationShot);
box.stageShotReferencePackage([mutationShot],ctx);
ok("override resolution does not mutate shots or characters",
  JSON.stringify(mutationShot)===mutationShotBefore&&JSON.stringify(characters)===mutationCharacters);

box.shotLocationCoverageSpecs=()=>[
  {id:"second-house",category:"place",locationId:"second-house",source:"continuity-place"},
  {id:"kitchen-state",category:"state",locationId:"kitchen",stateId:"damaged",source:"appearance-state"},
  {id:"gone-room",unavailable:true,required:true,source:"unavailable-location-reference"},
];
const selectedLocations=box.stageShotReferencePackage([{
  id:"manual-location-kinds",sceneId:"s2",subjects:[],props:[],
  referenceLocationsSet:true,referenceLocationIds:["second-house","kitchen-state","gone-room"],
}],{...ctx,metadata:{...metadata,"second-house":{iso:"house-v1"},"kitchen-state":{iso:"state-v1"},
  "gone-room":{iso:"old-cached-copy"}}});
ok("explicit other-place reference preserves its real owner",
  selectedLocations.locations.find(x=>x.assetId==="second-house")?.entityId==="second-house");
ok("appearance state preserves exact owner and state identity",
  selectedLocations.locations.find(x=>x.assetId==="kitchen-state")?.entityId==="kitchen"
  &&selectedLocations.locations.find(x=>x.assetId==="kitchen-state")?.stateId==="damaged");
ok("deleted catalog selection blocks even when stale image metadata survives",
  selectedLocations.warnings.some(x=>x.imageId==="gone-room"&&x.code==="unavailable-location-selection"&&x.severity==="error")
  &&!selectedLocations.locations.some(x=>x.assetId==="gone-room"));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

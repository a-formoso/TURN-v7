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
ok("unapproved warning",pkg.warnings.some(x=>x.code==="unapproved-reference"&&x.imageId==="c2"));
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
const warmPackage=box.stageShotReferencePackage([shots[1]],{...ctx,
  images:{"c1:rain":"data:image/png;base64,fixture","l1-ext":"data:image/png;base64,fixture","p1:wet":"data:image/png;base64,fixture"}});
ok("loaded references clear missing blockers without altering metadata",
  !warmPackage.warnings.some(x=>x.severity==="error"&&x.code==="missing-reference"));
ok("async image arrival changes the package signature",coldPackage.signature!==warmPackage.signature);
ok("metadata-only history review cannot claim checked file availability",
  !box.stageReferenceStatus({imageId:"c1:rain"},ctx).availabilityKnown);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
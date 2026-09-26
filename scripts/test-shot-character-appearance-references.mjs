#!/usr/bin/env node
/* Regression for scene-aware character appearance references shared by Shots,
   Storyboards and Stage.  No browser, provider, persistence or paid generation. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const box={console,Set,Map,Date,Math,JSON,Number,String,Object,Array,RegExp};
box.window=box;
box.globalThis=box;
box.turnContinuity={};
vm.createContext(box);
vm.runInContext(readFileSync("app/shots.jsx","utf8"),box,{filename:"app/shots.jsx"});
vm.runInContext(readFileSync("app/stage-references.jsx","utf8"),box,{filename:"app/stage-references.jsx"});

const scenes=[
  {id:"scene-1",no:1},
  {id:"scene-2",no:2},
  {id:"scene-3",no:3},
];
const marcus={id:"marcus",name:"MARCUS TILLMON",states:[
  {id:"rehearsal",label:"Rehearsal night clothes",sceneId:"scene-1",
    change:"Out of the suit and into a white undershirt, gray cardigan, gray sweatpants, socks and drugstore reading glasses."},
  {id:"funeral",label:"Funeral suit",sceneId:"scene-3"},
]};
const belt={id:"belt",name:"Black dress belt",kind:"worn",ownerId:"marcus",ownerName:"MARCUS TILLMON"};
// Legacy owned wearables may have ownerName but no ownerId; they must still obey
// the owner's active appearance state.
const watch={id:"watch",name:"Father's scratched gold-tone Timex",kind:"worn",ownerName:"MARCUS TILLMON"};
const glasses={id:"glasses",name:"Drugstore reading glasses",kind:"worn",ownerId:"marcus",ownerName:"MARCUS TILLMON"};
const shot={id:"shot-1",sceneId:"scene-1",beatN:1,subjects:["marcus"],
  // These incidental words occur in the watch's long bible name, but do not name
  // the wearable itself and therefore must not revive it from v1.
  action:"Marcus stands left of his father's pill bottles.",
  // legacy derived cache: must not override the active appearance state
  props:["belt","watch","glasses"]};
const ctx={scene:scenes[0],scenes,charById:{marcus},propById:{belt,watch,glasses},project:{}};

const sceneOneSpec=box.shotCharacterReferenceSpec(marcus,scenes[0],scenes);
assert.equal(sceneOneSpec.id,"marcus:rehearsal");
assert.equal(sceneOneSpec.baseId,"marcus");
assert.equal(sceneOneSpec.stateId,"rehearsal");
assert.equal(sceneOneSpec.version,2);
assert.equal(sceneOneSpec.required,true);
assert.match(sceneOneSpec.label,/Rehearsal night clothes.*v2/);

assert.deepEqual(Array.from(box.inFrameProps(shot,scenes[0],ctx.charById,ctx.propById,ctx)),["glasses"],
  "the active wardrobe state suppresses stale v1 wearables but retains a wearable it explicitly names");
assert.deepEqual(Array.from(box.inFrameProps({...shot,referencePropIds:["belt"]},scenes[0],ctx.charById,ctx.propById,ctx)).sort(),["belt","glasses"],
  "an explicit director prop reference can deliberately restore a base wearable");
const shotPrompt=box.buildShotPrompt(shot,ctx);
assert.ok(!shotPrompt.includes("Black dress belt (on MARCUS TILLMON)"),
  "the frame prompt does not strap a v1 dress belt over the rehearsal-night appearance");
assert.ok(!shotPrompt.includes("Father's scratched gold-tone Timex (on MARCUS TILLMON)"),
  "other unmentioned v1 wearables rely on the active state sheet instead of overriding it in prose");
assert.ok(shotPrompt.includes("Drugstore reading glasses (on MARCUS TILLMON)"),
  "a wearable explicitly retained by the appearance state remains in the prompt");

assert.equal(box.shotCharacterReferenceSpec(marcus,scenes[1],scenes).id,"marcus:rehearsal",
  "a pinned state persists into later scenes");
assert.equal(box.shotCharacterReferenceSpec(marcus,scenes[2],scenes).id,"marcus:funeral",
  "the next pinned state supersedes the earlier appearance");

const plan=box.shotRenderPlan(shot,[shot],ctx);
assert.deepEqual(Array.from(plan.castSpec,s=>s.id),["marcus:rehearsal"],
  "the Shots render plan uses the active v2 sheet, not the v1 master");
assert.ok(!plan.orderedSpecs.some(s=>s.id==="marcus"));

const requested=[];
const refs=await box.shotResolveRenderRefs(plan,async id=>{
  requested.push(id);
  return id==="marcus:rehearsal"?"data:image/png;base64,state":"";
});
assert.deepEqual(requested,["marcus:rehearsal"]);
assert.equal(refs[0].refId,"marcus:rehearsal");
assert.equal(refs[0].baseId,"marcus");
assert.equal(refs[0].stateId,"rehearsal");
assert.equal(refs[0].assetRole,"appearance_state");

await assert.rejects(
  ()=>box.shotResolveRenderRefs(plan,async()=>""),
  e=>e&&e.name==="ShotCharacterReferenceError"
    &&e.code==="SHOT_CHARACTER_REFERENCE_UNAVAILABLE"
    &&e.requiredReference===true
    &&e.referenceId==="marcus:rehearsal",
  "a missing required state must block rather than fall back or disappear");

const excludedPlan=box.shotRenderPlan({...shot,refOff:["marcus"]},[shot],ctx);
assert.equal(excludedPlan.orderedSpecs.some(s=>s.referenceKind==="character"),false,
  "the durable base-id exclusion still applies when the active state changes");
assert.deepEqual(Array.from(await box.shotResolveRenderRefs(excludedPlan,async()=>"")),[]);

box.inFrameCast=sh=>sh.subjects||[];
const metadata={
  marcus:{iso:"master-v1",version:1},
  "marcus:rehearsal":{iso:"rehearsal-v2",version:2},
};
const stage=box.stageShotReferencePackage([shot],{
  scene:scenes[0],scenes,characters:[marcus],props:[],locations:[],metadata,
  images:{"marcus:rehearsal":"data:image/png;base64,state"},
});
assert.deepEqual(Array.from(stage.byShot[0].characters),["marcus:rehearsal"],
  "Stage consumes the same active appearance asset as Shots");
assert.equal(stage.characters[0].stateId,"rehearsal");
assert.ok(!stage.characters.some(x=>x.assetId==="marcus"));

const loadingStage=box.stageShotReferencePackage([shot],{
  scene:scenes[0],scenes,characters:[marcus],props:[],locations:[],metadata,
  images:{},loadingImageIds:new Set(["marcus:rehearsal"]),
});
assert.equal(loadingStage.characters[0].status.loading,true,
  "an in-flight saved state is reported as loading, not absent");
assert.equal(loadingStage.characters[0].status.missing,false);
assert.ok(loadingStage.warnings.some(w=>w.code==="loading-reference"));
assert.ok(!loadingStage.warnings.some(w=>w.code==="missing-reference"),
  "Stage does not call an actively loading generated sheet missing");

const before=JSON.stringify({scenes,marcus,shot});
box.shotCharacterReferenceSpec(marcus,scenes[0],scenes);
box.shotRenderPlan(shot,[shot],ctx);
box.stageShotReferencePackage([shot],{
  scene:scenes[0],scenes,characters:[marcus],props:[],locations:[],metadata,
});
assert.equal(JSON.stringify({scenes,marcus,shot}),before,"reference resolution is immutable");

console.log("PASS scene-aware character appearance references: Shots + Stage stay aligned");

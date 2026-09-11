#!/usr/bin/env node
/* Screenplay-grounded opening-keyframe tests.  These are headless and use a
   fake image provider; no workflow, browser or paid generation is involved. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const box = {
  console, Date, Set, Map, Math, JSON, Number, String, Object, Array, RegExp,
  isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
  document:{}, turnContinuity:{}, window:null, globalThis:null,
  CustomEvent:(type, init)=>({type, detail:init && init.detail}),
};
box.window = box;
box.globalThis = box;
box.dispatchEvent = ()=>{};
vm.createContext(box);
["app/scene-order.js","app/shot-screenplay.js","app/shots.jsx"].forEach(file=>{
  vm.runInContext(readFileSync(file,"utf8"),box,{filename:file});
});

const chars = [
  {id:"marcus",name:"MARCUS"},
  {id:"daniel",name:"DANIEL"},
  {id:"oliver",name:"OLIVER STONE"},
  {id:"reese",name:"REESE STONE"},
];
const scene = {id:"scene-1",no:1,loc:"INT. LIVING ROOM - DAY",driver:"daniel"};
const blocks = [
  {type:"scene",text:"INT. LIVING ROOM - DAY",beat:1},
  {type:"action",text:"MARCUS stands before father's empty recliner rehearsing his eulogy. Then the phone BUZZES. A banner reads 'DANIEL — Flight lands 10am. Somebody send me address.'",beat:1},
  {type:"char",text:"DANIEL (V.O.)",beat:2},
  {type:"dia",text:"I am still at the airport.",beat:2},
  {type:"action",text:"Marcus looks at the door.",beat:2},
  {type:"scene",text:"INT. LIVING ROOM - NIGHT",beat:3},
  {type:"action",text:"DANIEL enters.",beat:3},
  {type:"action",text:"OLIVER STONE and REESE STONE wait outside.",beat:4},
];
const drafts = {"scene-1":{version:"draft-v1",blocks}};
const beatsMap = {"scene-1":{rows:[1,2,3,4].map(n=>({n}))}};

const source1 = box.shotBeatScreenplay(scene,1,{drafts,characters:chars,beatsMap});
assert.equal(source1.hasSource,true);
assert.deepEqual(source1.openingCharacterIds,["marcus"]);
assert.deepEqual(source1.physicalCharacterIds,["marcus"]);
assert.deepEqual(source1.remoteCharacterIds,["daniel"]);
assert.equal(source1.openingAction,"MARCUS stands before father's empty recliner rehearsing his eulogy.");
assert.ok(source1.text.includes("DANIEL — Flight lands 10am"));
assert.ok(source1.blocks.some(b=>b.evidence && b.evidence.blockIndex===1));

const source2 = box.shotBeatScreenplay(scene,2,{drafts,characters:chars,beatsMap});
assert.deepEqual(source2.openingCharacterIds,["marcus"]);
assert.deepEqual(source2.physicalCharacterIds,["marcus"]);
assert.deepEqual(source2.remoteCharacterIds,["daniel"]);
assert.equal(source2.dialogue[0].delivery,"voice-over");

const source3 = box.shotBeatScreenplay(scene,3,{drafts,characters:chars,beatsMap});
assert.deepEqual(source3.openingCharacterIds,["daniel"]);
assert.deepEqual(source3.physicalCharacterIds,["daniel"]);
assert.equal(source3.remoteCharacterIds.length,0);

const shared = box.shotBeatScreenplay(scene,4,{drafts,characters:chars,beatsMap});
assert.deepEqual(shared.openingCharacterIds,["daniel","oliver","reese"]);

const noScript = box.shotBeatScreenplay(scene,1,{drafts:{},characters:chars,beatsMap});
assert.equal(noScript.hasSource,false);
assert.equal(box.deriveShotsHeuristic(scene,beatsMap,[],[],chars,{}).length,0);

const sourceFor=blocks=>box.shotBeatScreenplay(scene,1,{drafts:{[scene.id]:{blocks}},characters:chars});
const later=sourceFor([
  {type:"action",beat:1,text:"MARCUS rehearses alone."},
  {type:"action",beat:1,text:"Then DANIEL enters the house."},
  {type:"char",beat:1,text:"DANIEL"},
  {type:"dia",beat:1,text:"I'm here."}
]);
assert.deepEqual(later.openingCharacterIds,["marcus"],"later dialogue cue cannot add an opening body");
assert.ok(later.physicalCharacterIds.includes("daniel"),"later physical entry remains in motion context");
const phoneLocal=sourceFor([
  {type:"action",beat:1,text:"MARCUS sits with his phone."},
  {type:"char",beat:1,text:"MARCUS"},
  {type:"paren",beat:1,text:"into the phone"},
  {type:"dia",beat:1,text:"Can you hear me?"},
  {type:"char",beat:1,text:"DANIEL (V.O.)"},
  {type:"dia",beat:1,text:"Yes."}
]);
assert.deepEqual(phoneLocal.openingCharacterIds,["marcus"]);
assert.deepEqual(phoneLocal.remoteCharacterIds,["daniel"],"local phone speaker is not remote-only cast");
assert.equal(phoneLocal.dialogue[0].delivery,"in-room");
assert.equal(phoneLocal.dialogue[1].delivery,"voice-over");
const emptyOpening=sourceFor([
  {type:"action",beat:1,text:"An empty room. Then DANIEL enters."},
  {type:"char",beat:1,text:"DANIEL"},
  {type:"dia",beat:1,text:"Hello?"}
]);
assert.deepEqual(emptyOpening.openingCharacterIds,[],"empty-room opener stays empty despite later dialogue");
assert.deepEqual(box.shotScreenplayBeatRows(scene,{drafts,beatsMap:{}}).map(r=>r.n),[1,2,3,4],"imported page beat boundaries need no intent map");

/* Leading, untagged prologue is evidence for beat one only. */
const prologue = {id:"prologue",loc:"EXT. STREET - NIGHT"};
const prologueDraft = {prologue:{blocks:[
  {type:"scene",text:"EXT. STREET - NIGHT"},
  {type:"action",text:"MARCUS waits under a broken streetlamp."},
  {type:"action",text:"A title card fades in.",beat:1},
]}};
const prologueSource = box.shotBeatScreenplay(prologue,1,{drafts:prologueDraft,characters:chars});
assert.equal(prologueSource.hasSource,true);
assert.ok(prologueSource.text.includes("MARCUS waits under a broken streetlamp."));

box.turnContinuity = {drafts,characters:chars};
const normalized = box.normalizeShot({beat:1,action:"DANIEL enters",subjects:["daniel"]},
  scene,0,[],[],chars,beatsMap);
assert.equal(normalized.keyframeMode,"beat-opening");
assert.equal(normalized.action,source1.openingAction);
assert.equal(normalized.beatScript,source1.text);
assert.equal(normalized.sourceScreenplayRev,source1.sourceRev);
assert.deepEqual(normalized.remoteCharacterIds,["daniel"]);
assert.deepEqual(box.inFrameCast({...normalized,action:"DANIEL enters",subjects:["daniel"]},
  scene,chars,{drafts,characters:chars}),["marcus"]);
assert.deepEqual(box.inFrameCast({...normalized,referenceCharactersSet:true,referenceCharacterIds:[]},
  scene,chars,{drafts,characters:chars}),[]);
assert.ok(box.buildShotPrompt(normalized,{
  scene,charById:Object.fromEntries(chars.map(c=>[c.id,c])),propById:{},
  drafts,beatsMap,location:null,project:{}
}).includes("SCREENPLAY OPENING SOURCE"));

/* Exercise the actual render path with a fake provider and no external call. */
let providerCalls=0;
Object.assign(box,{
  nbEpoch:()=>1, nbAssertMediaIdentity:()=>{},
  shotGrabImage:async()=>"", nbLoadImage:async()=>null, nbGetImage:()=>"",
  nbGenerate:async()=>{ providerCalls++; return "fake://frame"; },
  nbGetMeta:()=>({}), nbPreferBestAssetRefs:refs=>refs,
  nbAssetRoleLabel:id=>id, nbAssetRolePriority:()=>0,
  nbCommit:async(id,url)=>({url}),
});
const frame=await box.generateShotFrame(normalized,[normalized],{
  scene,characters:chars,charById:Object.fromEntries(chars.map(c=>[c.id,c])),
  propById:{},drafts,beatsMap,location:null,project:{}
});
assert.equal(frame,"fake://frame");
assert.equal(providerCalls,1);

const changedDrafts={"scene-1":{version:"draft-v2",blocks:blocks.map((b,i)=>
  i===1 ? {...b,text:b.text.replace("stands","kneels")} : b)}};
const changed=box.shotBeatScreenplay(scene,1,{drafts:changedDrafts,characters:chars,beatsMap});
assert.notEqual(changed.sourceRev,source1.sourceRev);

console.log("shot screenplay tests passed");
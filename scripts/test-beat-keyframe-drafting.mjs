#!/usr/bin/env node
import vm from "node:vm";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";

const sandbox={
  console,
  localStorage:{removeItem(){}},
  setTimeout,clearTimeout,
  performance:{now:()=>0},
  CustomEvent:function(type,init){this.type=type;this.detail=init&&init.detail;},
};
sandbox.window=sandbox;
sandbox.dispatchEvent=()=>{};
vm.createContext(sandbox);

const modelCalls=[];
const sourceByBeat={
  1:{
    hasSource:true,sourceRev:"rev-1",
    text:"Marcus stands before the recliner, phone in hand, rehearsing the eulogy. Later Daniel texts that he is arriving. Marcus's voice-over remembers the room.",
    openingAction:"Marcus stands before the recliner, phone in hand, rehearsing the eulogy.",
    openingCharacterIds:["marcus"],physicalCharacterIds:["marcus"],remoteCharacterIds:["daniel"],mentionedCharacterIds:["marcus","daniel"],
    dialogue:[
      {speakerId:"marcus",speaker:"Marcus",text:"I can do this.",delivery:"spoken"},
      {speakerId:"daniel",speaker:"Daniel",text:"I'm five minutes away.",delivery:"SMS"},
    ],
  },
  2:{
    hasSource:true,sourceRev:"rev-2",
    text:"Marcus steadies himself at the doorway. Much later, the door opens and Daniel enters. The voice-over carries into the next scene.",
    openingAction:"Marcus steadies himself at the doorway.",
    openingCharacterIds:["marcus"],physicalCharacterIds:["marcus"],remoteCharacterIds:["daniel"],mentionedCharacterIds:["marcus","daniel"],
    dialogue:[{speakerId:"marcus",speaker:"Marcus",text:"Thank you for coming.",delivery:"spoken"}],
  },
  3:{
    hasSource:true,sourceRev:"rev-empty",
    text:"An empty room holds the unlit recliner. Later Marcus enters.",
    openingAction:"An empty room holds the unlit recliner.",
    openingCharacterIds:[],physicalCharacterIds:["marcus"],remoteCharacterIds:[],mentionedCharacterIds:["marcus"],
    dialogue:[],
  },
  4:{
    hasSource:true,sourceRev:"rev-mentions",
    text:"A framed photograph identifies Marcus. The room stays empty.",
    openingAction:"A framed photograph identifies Marcus.",
    openingCharacterIds:[],physicalCharacterIds:[],remoteCharacterIds:[],mentionedCharacterIds:["marcus"],
    dialogue:[],
  },
  5:{
    hasSource:true,sourceRev:"rev-later",
    text:"The empty doorway waits. Later Marcus enters and crosses to the window.",
    openingAction:"The empty doorway waits.",
    openingCharacterIds:[],physicalCharacterIds:["marcus"],remoteCharacterIds:[],mentionedCharacterIds:["marcus"],
    dialogue:[],
  },
};

sandbox.shotBeatScreenplay=(scene,n)=>sourceByBeat[n];
sandbox.writingLoglineOf=()=> "A man rehearses a eulogy.";
sandbox.window.claude={
  async complete(options){
    modelCalls.push(options);
    return sandbox.nextModelResponse || '{"shots":[]}';
  },
};

vm.runInContext(readFileSync("app/ai.jsx","utf8"),sandbox);
assert.equal(typeof sandbox.aiDraftShotsLegacy,"undefined");

const scene={id:"scene-1",no:1,title:"Living room",driver:"marcus",summary:"A rehearsal before a funeral."};
const beats={"scene-1":{
  driverLabel:"Marcus",reactorLabel:"Daniel",
  rows:[{n:2,drive:{d:"Steadies himself"},react:{d:"Waits"}},{n:1,drive:{d:"Rehearses"},react:{d:"Texts"} }],
}};
const drafts={"scene-1":{blocks:[]}};
const characters=[
  {id:"marcus",name:"Marcus",pronouns:"he/him",role:"son"},
  {id:"daniel",name:"Daniel",pronouns:"he/him",role:"remote friend"},
];

let checks=0;
async function check(name,fn){
  try{await fn();checks++;}
  catch(error){console.error("FAIL",name,error);process.exitCode=1;}
}

await check("overproduced model rows collapse to one opening row per beat",async()=>{
  modelCalls.length=0;
  sandbox.nextModelResponse=JSON.stringify({shots:[
    {beat:1,subjects:["Daniel"],action:"The late text arrives.",composition:"late insert",dialogue:"wrong",beatPlan:{micro:["bad"]}},
    {beat:1,subjects:["Daniel"],action:"The climax.",composition:"another setup"},
    {beat:1,subjects:["Marcus"],action:"duplicate"},
    {beat:2,subjects:["Daniel"],action:"The door opens"},
  ]});
  const out=await sandbox.aiDraftShots(scene,beats,drafts,[],[],characters,{title:"Eulogy"});
  assert.deepEqual(Array.from(out,x=>x.beat),[1,2]);
  assert.equal(out[0].keyframeMode,"beat-opening");
  assert.equal(out[0].sourceScreenplayRev,"rev-1");
  assert.equal(out[0].sourceRev,"rev-1");
  assert.equal(out[0].specRev,1);
  assert.deepEqual(Array.from(out[0].covers),[]);
  assert.equal("beatPlan" in out[0],false);
  assert.equal(out[0].beatScript,sourceByBeat[1].text);
  assert.equal(out[0].action,sourceByBeat[1].openingAction);
  assert.deepEqual(Array.from(out[0].subjects),["Marcus"]);
  assert.deepEqual(Array.from(out[0].referenceCharacterIds),["marcus"]);
  assert.deepEqual(Array.from(out[0].remoteCharacterIds),["daniel"]);
  assert.equal(out[0].referenceCharacterIds.includes("daniel"),false);
  assert.equal(out[0].subjects.includes("Daniel"),false);
  assert.equal(out[0].dialogue,"I can do this.");
  assert.equal(modelCalls.length,1);
  assert.match(modelCalls[0].messages[0].content, /Marcus's voice-over remembers the room/);
  assert.match(modelCalls[0].messages[0].content, /Marcus .*he\/him/);
});

await check("underproduced model response backfills each beat from opening source",async()=>{
  modelCalls.length=0;
  sandbox.nextModelResponse=JSON.stringify({shots:[
    {beat:1,size:"CU",subjects:["Marcus"],composition:"opening"}
  ]});
  const out=await sandbox.aiDraftShots(scene,beats,drafts,[],[],characters,{title:"Eulogy"});
  assert.deepEqual(Array.from(out,x=>x.beat),[1,2]);
  assert.equal(out[1].action,sourceByBeat[2].openingAction);
  assert.equal(out[1].beatScript,sourceByBeat[2].text);
  assert.deepEqual(Array.from(out[1].covers),[]);
  assert.equal("beatPlan" in out[1],false);
});

await check("empty, mentions-only, and later-entry openings keep an empty visual cast",async()=>{
  const bindingBeats={"scene-1":{rows:[{n:3},{n:4},{n:5}]}};
  modelCalls.length=0;
  sandbox.nextModelResponse=JSON.stringify({shots:[
    {beat:3,subjects:["Marcus"],composition:"invented actor"},
    {beat:4,subjects:["Marcus"],composition:"named character"},
    {beat:5,subjects:["Marcus"],composition:"later entrance"},
  ]});
  const out=await sandbox.aiDraftShots(scene,bindingBeats,drafts,[],[],characters,{title:"Eulogy"});
  assert.deepEqual(Array.from(out,x=>x.beat),[3,4,5]);
  for(const row of out){
    assert.deepEqual(Array.from(row.subjects),[]);
    assert.deepEqual(Array.from(row.referenceCharacterIds),[]);
    assert.equal(row.referenceCharactersSet,true);
  }
});

await check("missing screenplay fails explicitly before model call",async()=>{
  const old=sandbox.shotBeatScreenplay;
  sandbox.shotBeatScreenplay=()=>({hasSource:false,text:""});
  modelCalls.length=0;
  await assert.rejects(
    sandbox.aiDraftShots(scene,beats,drafts,[],[],characters,{title:"Eulogy"}),
    /no screenplay source/i
  );
  assert.equal(modelCalls.length,0);
  sandbox.shotBeatScreenplay=old;
});

await check("missing screenplay helper fails clearly",async()=>{
  const old=sandbox.shotBeatScreenplay;
  delete sandbox.shotBeatScreenplay;
  await assert.rejects(
    sandbox.aiDraftShots(scene,beats,drafts,[],[],characters,{title:"Eulogy"}),
    /screenplay source helper/i
  );
  sandbox.shotBeatScreenplay=old;
});

await check("per-beat refine returns exactly one row and one model request",async()=>{
  modelCalls.length=0;
  sandbox.nextModelResponse=JSON.stringify({shots:[
    {beat:2,subjects:["Daniel"],composition:"wrong"},
    {beat:2,subjects:["Daniel"],composition:"duplicate"},
    {beat:2,subjects:["Marcus"],composition:"extra"},
  ]});
  const out=await sandbox.aiDraftShots(scene,beats,drafts,[],[],characters,{title:"Eulogy"},{beatN:2,refine:true});
  assert.equal(out.length,1);
  assert.equal(out[0].beat,2);
  assert.equal(modelCalls.length,1);
  assert.match(modelCalls[0].messages[0].content,/exactly ONE OPENING KEYFRAME/);
});

await check("provider failures are not silently replaced",async()=>{
  const previous=sandbox.window.claude.complete;
  sandbox.window.claude.complete=async()=>{throw new Error("provider unavailable");};
  await assert.rejects(
    sandbox.aiDraftShots(scene,beats,drafts,[],[],characters,{title:"Eulogy"}),
    /provider unavailable/
  );
  sandbox.window.claude.complete=previous;
});

if(!process.exitCode) console.log(`PASS beat opening keyframe drafting: ${checks} checks`);
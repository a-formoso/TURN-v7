#!/usr/bin/env node
/* Pure Stage screenplay-reference tests.  These load the real shared
   shot-scene-context and shot-screenplay helpers; no browser, provider, page
   renderer, persistence, or workflow is involved. */
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const box = {
  console, Date, Set, Map, Math, JSON, Number, String, Object, Array, RegExp,
  isFinite, parseInt, parseFloat,
  turnContinuity:{},
  window:null, globalThis:null
};
box.window=box;
box.globalThis=box;
vm.createContext(box);
vm.runInContext(readFileSync("app/shot-screenplay.js","utf8"),box,{filename:"app/shot-screenplay.js"});
vm.runInContext(readFileSync("app/shot-scene-context.js","utf8"),box,{filename:"app/shot-scene-context.js"});
vm.runInContext(readFileSync("app/stage-screenplay.js","utf8"),box,{filename:"app/stage-screenplay.js"});

const sceneA={id:"scene-a",no:7,title:"The Handoff",loc:"INT. ARCHIVE - NIGHT"};
const sceneB={id:"scene-b",no:8,title:"The Exit",loc:"EXT. ARCHIVE - DAWN"};
const chars=[
  {id:"marcus",name:"MARCUS"},
  {id:"daniel",name:"DANIEL"},
  {id:"rhea",name:"RHEA"}
];
const aLeading="MARCUS waits beside the archive door.";
const aRemote="DANIEL (V.O.)";
const aRemoteLine="The east stairwell is clear.";
const aExactLine="I have the ledger.";
const aLast="LAST-AUTHORED-BLOCK-MUST-SURVIVE-WHOLE";
const bLast="SCENE-B-ONLY-LAST-BLOCK";
const aBlocks=[
  {type:"action",text:aLeading},
  {type:"scene",beat:1,text:"INT. ARCHIVE - NIGHT"},
  {type:"action",beat:1,text:"MARCUS checks the brass key."},
  {type:"char",beat:1,text:"MARCUS"},
  {type:"paren",beat:1,text:"into the phone"},
  {type:"dia",beat:1,text:aExactLine},
  {type:"char",beat:1,text:aRemote},
  {type:"dia",beat:1,text:aRemoteLine},
  {type:"action",beat:2,text:"MARCUS crosses to the east stairwell."},
  {type:"char",beat:2,text:"RHEA"},
  {type:"dia",beat:2,text:"The ledger is safe."},
  {type:"action",beat:3,text:"MARCUS closes the archive door."},
  {type:"action",beat:3,text:aLast}
];
const bBlocks=[
  {type:"scene",beat:1,text:"EXT. ARCHIVE - DAWN"},
  {type:"action",beat:1,text:"RHEA steps into the pale morning."},
  {type:"action",beat:9,text:bLast}
];
const drafts={
  [sceneA.id]:{version:"a-v1",blocks:aBlocks},
  [sceneB.id]:{version:"b-v1",blocks:bBlocks}
};
const ctx={
  filmId:"film-stage-test",
  scenes:[sceneA,sceneB],
  drafts,
  characters:chars
};
const shots=[
  {id:"a-1",sceneId:sceneA.id,beatN:1},
  {id:"b-9",sceneId:sceneB.id,beatN:9},
  {id:"a-2",sceneId:sceneA.id,beatN:2}
];

let checks=0;
function check(name,fn){
  try{ fn(); checks++; }
  catch(error){ console.error("FAIL",name); throw error; }
}

check("contract and scene isolation",()=>{
  const ref=box.stageScreenplayReference(sceneA,shots,ctx);
  assert.deepEqual(Object.keys(ref),[
    "schema","kind","delivery","sceneId","sceneNo","sceneTitle","sourceRev",
    "fullText","targetBeats","targetText","hasSource","errors","signature"
  ]);
  assert.equal(ref.schema,"cm-stage-screenplay-v1");
  assert.equal(ref.kind,"screenplay");
  assert.equal(ref.delivery,"prompt-text");
  assert.equal(ref.sceneId,sceneA.id);
  assert.equal(ref.sceneNo,sceneA.no);
  assert.equal(ref.sceneTitle,sceneA.title);
  assert.deepEqual(Array.from(ref.targetBeats),[1,2]);
  assert.equal(ref.hasSource,true);
  assert.equal(ref.errors.length,0);
  assert.ok(ref.fullText.includes(aLast));
  assert.ok(!ref.fullText.includes(bLast));
  assert.ok(!ref.targetText.includes(bLast));
});

check("leading untagged beat one and exact remote dialogue survive",()=>{
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  const canon=box.shotBeatScreenplay(sceneA,1,{drafts,characters:chars});
  assert.equal(ref.targetText,canon.text);
  assert.ok(ref.targetText.includes(aLeading),"leading untagged beat-one source was lost");
  assert.ok(ref.targetText.includes(aExactLine),"dialogue source was rewritten or lost");
  assert.ok(ref.targetText.includes(aRemote),"remote cue was rewritten or lost");
  assert.ok(ref.targetText.includes(aRemoteLine),"remote dialogue source was rewritten or lost");
  assert.ok(canon.dialogue.some(row=>row.delivery==="voice-over"
    && row.text===aRemoteLine),"real beat canon did not retain remote delivery");
});

check("every target beat shares full scene but gets a distinct target and signature",()=>{
  const one=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  const two=box.stageScreenplayReference(sceneA,[shots[2]],ctx);
  assert.equal(one.fullText,two.fullText);
  assert.equal(one.sourceRev,two.sourceRev);
  assert.notEqual(one.targetText,two.targetText);
  assert.notEqual(one.signature,two.signature);
  assert.ok(one.signature && two.signature);
});

check("long screenplay keeps its final authored blocks without a provider limit",()=>{
  const longScene={id:"long",no:12,title:"Long Scene",loc:"INT. VAULT - DAY"};
  const longBlocks=[{type:"scene",beat:1,text:"INT. VAULT - DAY"}];
  for(let i=0;i<700;i++)
    longBlocks.push({type:"action",beat:i<3?1:2,text:"LONG-"+i+" "+("word ".repeat(15))});
  longBlocks.push({type:"action",beat:2,text:"THE ABSOLUTE FINAL LONG SCREENPLAY BLOCK"});
  const longRef=box.stageScreenplayReference(longScene,
    [{id:"long-shot",sceneId:"long",beatN:2}],{drafts:{long:{blocks:longBlocks}}});
  assert.equal(longRef.hasSource,true);
  assert.ok(longRef.fullText.includes("THE ABSOLUTE FINAL LONG SCREENPLAY BLOCK"));
  assert.ok(longRef.targetText.includes("THE ABSOLUTE FINAL LONG SCREENPLAY BLOCK"));
});

check("legacy bare-array draft is accepted",()=>{
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],{
    drafts:aBlocks,characters:chars
  });
  assert.equal(ref.hasSource,true);
  assert.ok(ref.fullText.includes(aLast));
  assert.ok(ref.targetText.includes(aExactLine));
});

check("explicit empty drafts never fall back to another film",()=>{
  box.turnContinuity={drafts};
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],{
    filmId:"different-film",drafts:{},characters:chars
  });
  assert.equal(ref.hasSource,false);
  assert.ok(ref.errors.some(error=>/No screenplay draft\/source blocks|No screenplay source is mapped/i.test(error)));
  assert.equal(ref.fullText,"");
  assert.equal(ref.targetText,"");
});

check("missing target mapping does not pretend another block was selected",()=>{
  const ref=box.stageScreenplayReference(sceneA,
    [{id:"missing",sceneId:sceneA.id,beatN:88}],ctx);
  assert.equal(ref.hasSource,true,"the scene has a draft even though this beat is absent");
  assert.equal(ref.targetText,"");
  assert.ok(ref.errors.some(error=>error.includes("target beat 88")));
  assert.throws(()=>box.stageScreenplayPrompt(ref),/no authored screenplay text|target beat 88/i);
});

check("missing screenplay has actionable errors",()=>{
  const ref=box.stageScreenplayReference(sceneA,
    [{id:"missing-draft",sceneId:sceneA.id,beatN:1}],{drafts:{},characters:chars});
  assert.equal(ref.hasSource,false);
  assert.ok(ref.errors.length>0);
  assert.ok(ref.errors.some(error=>/Write or import|No screenplay/i.test(error)));
  assert.throws(()=>box.stageScreenplayPrompt(ref),/no source text|Write or import/i);
  assert.throws(()=>box.stageAppendScreenplayReference("edited",ref),/no source text|Write or import/i);
});

check("scene-wide revision drift changes all beat references",()=>{
  const beforeOne=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  const beforeTwo=box.stageScreenplayReference(sceneA,[shots[2]],ctx);
  const changedBlocks=aBlocks.map((block,index)=>index===8
    ? {...block,text:"MARCUS crosses to the WEST stairwell."} : {...block});
  const afterCtx={...ctx,drafts:{...drafts,[sceneA.id]:{version:"a-v2",blocks:changedBlocks}}};
  const afterOne=box.stageScreenplayReference(sceneA,[shots[0]],afterCtx);
  const afterTwo=box.stageScreenplayReference(sceneA,[shots[2]],afterCtx);
  assert.notEqual(beforeOne.sourceRev,afterOne.sourceRev);
  assert.notEqual(beforeTwo.sourceRev,afterTwo.sourceRev);
  assert.notEqual(beforeOne.signature,afterOne.signature);
  assert.notEqual(beforeTwo.signature,afterTwo.signature);
  assert.equal(afterOne.fullText,afterTwo.fullText);
});

check("reference building does not mutate scene shots or drafts",()=>{
  const inputScene=JSON.parse(JSON.stringify(sceneA));
  const inputShots=JSON.parse(JSON.stringify(shots));
  const inputCtx=JSON.parse(JSON.stringify(ctx));
  box.stageScreenplayReference(sceneA,shots,ctx);
  assert.deepEqual(sceneA,inputScene);
  assert.deepEqual(shots,inputShots);
  assert.deepEqual(ctx,inputCtx);
});

check("prompt contains full scene, full target boundary, and remote/page guards",()=>{
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  const prompt=box.stageScreenplayPrompt(ref);
  assert.ok(prompt.includes("FULL SCENE SCREENPLAY"));
  assert.ok(prompt.includes(ref.fullText));
  assert.ok(prompt.includes("perform the full authored target beat"));
  assert.ok(prompt.includes(ref.targetText));
  assert.ok(prompt.includes("Do not enact, add, or speak"));
  assert.ok(prompt.includes("does not become an onscreen body"));
  assert.ok(prompt.includes("not a photographed screenplay page"));
});

check("scoped prompt keeps full source while narrowing performed coverage",()=>{
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  const prompt=box.stageScreenplayPrompt({...ref,
    renderScope:{instruction:"SELECTED RENDER SCOPE: Single shot. Perform only Shot 1."}});
  assert.ok(prompt.includes(ref.fullText));
  assert.ok(prompt.includes(ref.targetText));
  assert.ok(prompt.includes("SELECTED RENDER SCOPE: Single shot"));
  assert.ok(prompt.includes("do not replay omitted"));
});

check("append preserves edited prompt and source bytes and de-duplicates exact block",()=>{
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  const edited="USER EDIT — retain this line exactly.\u0000  with  spacing";
  const once=box.stageAppendScreenplayReference(edited,ref);
  const twice=box.stageAppendScreenplayReference(once,ref);
  assert.ok(once.startsWith(edited));
  assert.ok(once.includes(ref.fullText));
  assert.ok(once.includes(aLeading));
  assert.equal(twice,once);
  assert.equal((twice.match(/STAGE SCREENPLAY REFERENCE — IMMUTABLE SOURCE/g)||[]).length,1);
});

check("malformed references fail loudly and actionably",()=>{
  assert.throws(()=>box.stageScreenplayPrompt(null),/Invalid Stage screenplay reference/i);
  assert.throws(()=>box.stageScreenplayPrompt({
    schema:"wrong",kind:"screenplay",delivery:"prompt-text"
  }),/schema/i);
  const ref=box.stageScreenplayReference(sceneA,[shots[0]],ctx);
  assert.throws(()=>box.stageScreenplayPrompt({...ref,targetBeats:["1"]}),/positive numbers/i);
  assert.throws(()=>box.stageAppendScreenplayReference(null,ref),/prompt must be a string/i);
});

console.log(`PASS Stage screenplay: ${checks} checks`);
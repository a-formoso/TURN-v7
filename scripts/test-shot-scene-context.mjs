#!/usr/bin/env node
/* Full-scene shot context tests.  They use a fake canvas and fake image
   provider; no browser, workflow, cloud storage, or paid generation. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const canvasEvents = [];
function canvas(){
  const ctx = {
    font:"", fillStyle:"",
    measureText: text => ({width:String(text||"").length*9}),
    fillRect: (...args)=>canvasEvents.push({kind:"rect",style:ctx.fillStyle,args}),
    fillText: (...args)=>canvasEvents.push({kind:"text",style:ctx.fillStyle,args}),
  };
  return {width:0,height:0,getContext:()=>ctx,
    toDataURL:()=>`data:image/png;base64,page-${canvasEvents.filter(e=>e.kind==="text"&&String(e.args[0]).startsWith("PAGE")).length+1}`};
}
const box = {
  console, Date, Set, Map, Math, JSON, Number, String, Object, Array, RegExp,
  isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
  document:{createElement:()=>canvas()}, turnContinuity:{}, window:null, globalThis:null,
  CustomEvent:(type,init)=>({type,detail:init&&init.detail}),
};
let doneEvents=0;
box.window=box; box.globalThis=box; box.dispatchEvent=e=>{ if(e&&e.type==="nb-gen-done") doneEvents++; };
vm.createContext(box);

/* Load the real Locations screenplay-page builder without evaluating its React
   surface.  The selected slice contains its pure helpers and renderer. */
const locSrc=readFileSync("app/locations.jsx","utf8");
const locStart=locSrc.indexOf("function locationSceneForCoverageSheet");
const locEnd=locSrc.indexOf("function locationMasterPanelPlan");
assert.ok(locStart>=0 && locEnd>locStart);
vm.runInContext(locSrc.slice(locStart,locEnd),box,{filename:"app/locations.jsx#screenplay-renderer"});
vm.runInContext(readFileSync("app/scene-order.js","utf8"),box,{filename:"app/scene-order.js"});
vm.runInContext(readFileSync("app/shot-screenplay.js","utf8"),box,{filename:"app/shot-screenplay.js"});
vm.runInContext(readFileSync("app/shot-scene-context.js","utf8"),box,{filename:"app/shot-scene-context.js"});
vm.runInContext(readFileSync("app/shots.jsx","utf8"),box,{filename:"app/shots.jsx"});
const uiSrc=readFileSync("app/shots-ui.jsx","utf8");
const uiStart=uiSrc.indexOf("function shotFrameGenOpts(");
const uiEnd=uiSrc.indexOf("\nwindow.shotFrameGenOpts",uiStart);
assert.ok(uiStart>=0 && uiEnd>uiStart);
vm.runInContext(uiSrc.slice(uiStart,uiEnd)+"\nwindow.shotFrameGenOpts=shotFrameGenOpts;",box,{filename:"app/shots-ui.jsx#shotFrameGenOpts"});

const scene={id:"scene-a",no:7,title:"House",loc:"INT. HOUSE - NIGHT"};
const blocks=[
  {type:"scene",text:"INT. HOUSE - NIGHT",beat:1},
  {type:"action",text:"MARCUS enters carrying the brass key.",beat:1},
  {type:"dia",text:"Where is everyone?",beat:1},
  {type:"action",text:"He crosses the room and opens the desk.",beat:2},
  {type:"dia",text:"The drawer is empty.",beat:2},
  {type:"action",text:"DANIEL's phone buzzes from the hallway.",beat:3},
  {type:"action",text:"Marcus turns toward the sound.",beat:3},
];
const drafts={"scene-a":{version:"v1",blocks}};
const chars=[{id:"marcus",name:"MARCUS"},{id:"daniel",name:"DANIEL"}];
const sh={id:"shot-a",sceneId:"scene-a",beatN:1,size:"MS",angle:"eye",move:"static",lens:"50",
  action:"MARCUS enters",subjects:["marcus"]};
const ctx={filmId:"film-a",scene,location:null,project:{id:"film-a"},
  charById:{marcus:chars[0],daniel:chars[1]},propById:{},drafts,
  scenes:[scene],referenceBudget:14};

const context=box.shotSceneContextPlan(sh,ctx);
assert.equal(context.fullText.includes("He crosses the room and opens the desk."),true);
assert.equal(context.fullText.includes("DANIEL's phone buzzes from the hallway."),true);
assert.equal(context.targetText.includes("MARCUS enters carrying the brass key."),true);
assert.equal(context.targetText.includes("He crosses the room"),false);

const pages=await box.shotSceneContextReferences(context,ctx,{maxPages:2});
assert.ok(pages.refs.length>0);
assert.equal(pages.refs.every(r=>r.persist===false && r.assetRole==="screenplay_context"),true);
assert.ok(canvasEvents.some(e=>e.kind==="rect"&&e.style==="#ead58b"),"target beat is highlighted");
assert.ok(pages.refs[0].note.includes("target beat 1"));

const off=box.shotSceneContextPlan({...sh,refOff:["screenplay-context"]},ctx);
assert.equal(off.imagesEnabled,false);
const noPages=await box.shotSceneContextReferences(off,ctx,{maxPages:2});
assert.equal(noPages.refs.length,0);
assert.ok(noPages.omissions.length);

const cappedPlan=box.shotRenderPlan(sh,[sh],{...ctx,referenceBudget:1});
assert.equal(cappedPlan.orderedSpecs.length,1,"canonical identity remains in plan");
assert.equal(cappedPlan.sceneContext.maxPages,0,"context cannot displace identity");
assert.equal(cappedPlan.sceneContext.omissions.some(x=>/capacity/i.test(x)),true);

const other=box.shotSceneContextPlan(sh,{...ctx,filmId:"film-b",scene:{...scene,id:"scene-b"}});
assert.notEqual(other.refId,context.refId,"scene/film context ids never share a cache key");
const changed=box.shotSceneContextPlan(sh,{...ctx,drafts:{"scene-a":{blocks:blocks.map((b,i)=>i===1?{...b,text:"MARCUS kneels."}:b)}}});
assert.notEqual(changed.sourceRev,context.sourceRev,"scene source revisions change with screenplay");
assert.equal(box.shotSceneContextStillCurrent(context,sh,{...ctx,drafts:{"scene-a":{blocks:blocks.map((b,i)=>i===1?{...b,text:"MARCUS kneels."}:b)}}}).ok,false);

let providerCalls=0, providerPrompt="", providerOpts=null, committedMeta=null, committedRefs=null, commitCalls=0, mutateAfterProvider=false, commitTier="", filmEpoch=1;
Object.assign(box,{
  nbEpoch:()=>filmEpoch,
  nbAssertMediaIdentity:()=>{},
  shotGrabImage:async id=>id==="marcus"?"data:image/png;base64:identity":"",
  nbGetImage:id=>id==="marcus"?"data:image/png;base64:identity":"",
  nbLoadImage:async()=>null,
  nbGenerate:async(prompt,opts)=>{ providerCalls++; providerPrompt=prompt; providerOpts=opts;
    if(mutateAfterProvider) ctx.drafts={"scene-a":{blocks:blocks.map((b,i)=>i===1?{...b,text:"MARCUS kneels."}:b)}};
    return "fake://frame"; },
  nbGetMeta:()=>({}),
  nbPreferBestAssetRefs:refs=>refs,
  nbAssetRoleLabel:id=>id,
  nbAssetRolePriority:role=>role==="screenplay_context"?1:(role==="master_reference"?70:0),
  nbCommit:async(id,url,meta,refs)=>{ commitCalls++; committedMeta=meta; committedRefs=refs;
    if(commitTier){ filmEpoch=2; return {tier:commitTier}; }
    return {url}; },
});
const manual=box.shotFrameGenOpts(sh,[sh],ctx);
const manualRefs=await manual.opts.attachments();
const manualPage=manualRefs.find(r=>r&&r.ephemeral);
assert.ok(manualPage && manualPage.url,"manual path receives screenplay page bytes for transport");
const actualManualPrompt=manual.opts.rebuildPromptAfterAttachments(manualRefs,"final",{});
assert.equal((actualManualPrompt.match(/ephemeral SCREENPLAY PAGE REFERENCE/g)||[]).length,
  manualRefs.filter(r=>r&&r.assetRole==="screenplay_context").length,
  "manual map labels the actual rendered page count");
assert.ok(!manual.opts.buildSimple().includes("Image 1 is"),"simple retry has no fictitious reference map");
assert.ok(manual.opts.buildEdit("tighten the crop").includes("EDIT READING CONTRACT"),
  "edit retains read-only full-scene context");
assert.ok(manual.finalPrompt.includes("FULL SCENE CONTEXT"));
const manualMeta=await manual.opts.metaExtra();
assert.equal(manualMeta.sceneContext.sourceRev,context.sourceRev);
// the full-scene context reaches the prompt the Shots card actually sends (the headless
// Scene Director path that used to be exercised here was removed 2026-09-26)
assert.ok(actualManualPrompt.includes("TARGET BEAT OPENING"));
assert.ok(actualManualPrompt.includes("He crosses the room and opens the desk."));
assert.ok(actualManualPrompt.includes("DANIEL's phone buzzes from the hallway."));
assert.equal(manualMeta.sceneContext.sceneId,"scene-a");
assert.equal(manualMeta.sceneContext.targetBeat,1);
// the live generator keeps screenplay pages readable and never persists their bytes
const artSrc=readFileSync("app/artroom.jsx","utf8");
assert.ok(/a && a\.assetRole==="screenplay_context" \? 1536/.test(artSrc),"screenplay pages keep their readable source dimensions per reference");
assert.ok(/if\(a && a\.ephemeral && a\.persist===false\)\{[\s\S]{0,120}?url:"", refId:a\.refId, ephemeral:true/.test(artSrc),
  "ephemeral screenplay page bytes stay out of persisted refs");
const originalDrafts=ctx.drafts;
let fallbackPaidCalls=0;
await assert.rejects(async()=>{
  try{ throw new Error("content policy"); }
  catch(e){
    ctx.drafts={"scene-a":{blocks:blocks.map((b,i)=>i===1?{...b,text:"MARCUS kneels."}:b)}};
    await manual.opts.assertFreshBeforeFallback();
    fallbackPaidCalls++;
  }
},/changed before render|screenplay changed/);
assert.equal(fallbackPaidCalls,0,"policy fallback makes no second paid call after source mutation");
ctx.drafts=originalDrafts;
ctx.drafts={"scene-a":{blocks:blocks.map((b,i)=>i===1?{...b,text:"MARCUS kneels."}:b)}};
await assert.rejects(()=>manual.opts.metaExtra(),/changed before render|screenplay changed/);
ctx.drafts=originalDrafts;
// a screenplay edit while the provider was rendering: the card's post-render check discards it
ctx.drafts={"scene-a":{blocks:blocks.map((b,i)=>i===1?{...b,text:"MARCUS kneels."}:b)}};
await assert.rejects(()=>manual.opts.assertPostGenerate(),/changed|screenplay changed/);
ctx.drafts=originalDrafts;

console.log("shot scene context tests passed");
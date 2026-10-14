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
// (2026-10-14) one screenplay image per scene when it fits (locations.jsx LOC_SCREENPLAY_LAYOUTS)
assert.equal(pages.pages,1,"a whole scene on one page image");assert.equal(pages.refs.length,1);

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
/* THE SCREENPLAY AS PAGES OR TEXT, NEVER BOTH (2026-10-14, owner — the prompt budget): the pages ride with this request,
   so the scene's text is a pointer to them; the target beat stays verbatim */
assert.match(actualManualPrompt,/the entire scene is attached as \d+ screenplay page images?, target beat highlighted — read it there; it is not repeated here/);
assert.ok(!actualManualPrompt.includes("He crosses the room and opens the desk."),"the scene's text is not sent twice");
assert.ok(actualManualPrompt.includes("MARCUS enters carrying the brass key."),"the target beat opening is never cut");
// …with no page attached (refs without pages, or a text-only render) the whole scene goes as text
const noPageRefs=manualRefs.filter(r=>r&&r.assetRole!=="screenplay_context");
const textPrompt=manual.opts.rebuildPromptAfterAttachments(noPageRefs,"final",{});
assert.ok(textPrompt.includes("He crosses the room and opens the desk.")&&textPrompt.includes("DANIEL's phone buzzes from the hallway."));
// …and longer than its engine takes: an excerpt around the target beat, then left out — never the target beat
const fullLen=box.buildShotPrompt(sh,{...ctx,sceneContext:context,resolvedRefs:noPageRefs}).length;
const tight=box.buildShotPrompt(sh,{...ctx,sceneContext:context,resolvedRefs:noPageRefs,promptMaxChars:3000+fullLen-10});
assert.match(tight,/an excerpt to fit this engine's prompt limit/);
assert.ok(!tight.includes("DANIEL's phone buzzes")&&tight.includes("MARCUS enters carrying the brass key."),"the far beat goes first");
assert.ok(tight.length<=fullLen-10,"it fits");
const tighter=box.buildShotPrompt(sh,{...ctx,sceneContext:context,resolvedRefs:noPageRefs,promptMaxChars:1});
assert.match(tighter,/the scene's own text is left out here/);assert.ok(tighter.includes("MARCUS enters carrying the brass key."));
assert.equal(box.shotPromptBudget({promptMaxChars:31500}),28500,"the identity block's room is kept");
const ex=box.shotSceneContextPrompt(context,{fit:"excerpt"});
assert.match(ex,/an excerpt to fit this engine's prompt limit/);assert.ok(ex.includes("He crosses the room")&&!ex.includes("DANIEL's phone"),"beat 1 and the line after it");
assert.match(box.shotSceneContextPrompt(context,{fit:"omit"}),/the scene's own text is left out here to fit this engine's prompt limit; the TARGET BEAT OPENING below is the authority/);
// pages that carry only part of the scene are not attached: the scene goes as text
const longBlocks=[{type:"scene",text:"INT. HOUSE - NIGHT",beat:1}].concat(Array.from({length:90},(_,i)=>({type:"action",text:"Line "+(i+1)+" of a long scene where Marcus searches every drawer of the desk, one by one, and finds nothing.",beat:1+Math.floor(i/30)})));
const longCtx={...ctx,drafts:{"scene-a":{blocks:longBlocks}}};
const longPlan={...box.shotSceneContextPlan(sh,longCtx),maxPages:null};
const whole=await box.shotSceneContextReferences(longPlan,longCtx,{maxPages:9});
assert.ok(whole.pages>1&&whole.refs.length===whole.pages,"a long scene: every page attached when they all fit");
assert.equal(whole.pages,3,"90 two-line blocks: three pages, the fewest any layout allows (four at 15 px)");
const partial=await box.shotSceneContextReferences(longPlan,longCtx,{maxPages:1});
assert.equal(partial.refs.length,0,"part of a scene is never attached beside its text");
assert.equal(partial.renderedPages,0);assert.equal(partial.omittedPages,whole.pages);
assert.ok(partial.omissions.some(x=>/so it goes as text/.test(x)),partial.omissions.join(" | "));
/* pages its ENGINE never receives don't count (2026-10-14 review): Seedream 5 Pro takes the first 10 references
   (proxyGenerate), the pages ride last — past its cap the scene goes as text, never "attached" while it isn't */
const pageRefs=manualRefs.filter(r=>r&&r.assetRole==="screenplay_context");
assert.ok(pageRefs.length>0,"the manual render attaches its pages");
const canon=Array.from({length:10},(_,i)=>({url:"sheet-"+i,assetRole:"master_reference",note:"Sheet "+i}));
box.nbModelMaxRefs=(m)=>m==="seedream-5-pro"?10:null;
assert.equal(box.shotScreenplayPagesSent([...canon.slice(0,2),...pageRefs],"seedream-5-pro",0),pageRefs.length,"under the cap: every page counts");
assert.equal(box.shotScreenplayPagesSent([...canon,...pageRefs],"seedream-5-pro",0),0,"past the cap: none count");
assert.equal(box.shotScreenplayPagesSent([...canon,...pageRefs],"gpt-image-2.5-flare",0),pageRefs.length,"an engine with no cap: every page");
assert.equal(box.shotScreenplayPagesSent([...canon.slice(0,10-pageRefs.length),...pageRefs],"seedream-5-pro",1),0,"a seed frame takes the first slot");
const capped=box.buildShotPrompt(sh,{...ctx,sceneContext:context,resolvedRefs:[...canon,...pageRefs],model:"seedream-5-pro"});
assert.ok(capped.includes("He crosses the room and opens the desk.")&&!/it is not repeated here/.test(capped),"Seedream past its cap: the scene goes as text");
const uncapped=box.buildShotPrompt(sh,{...ctx,sceneContext:context,resolvedRefs:[...canon,...pageRefs],model:"gpt-image-2.5-flare"});
assert.match(uncapped,/it is not repeated here/);
delete box.nbModelMaxRefs;
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
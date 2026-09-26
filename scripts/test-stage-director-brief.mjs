#!/usr/bin/env node
/*
 * Focused, source-level checks for the approved default Seedance director brief.
 *
 * This deliberately loads the real screenplay evidence resolver and the real
 * Stage clip compiler.  The brief is tested as a pure prompt boundary: there
 * is no browser, persistence, provider, paid media, or database involved.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const box={
  console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,
  isFinite,parseInt,parseFloat,
  setTimeout,clearTimeout,setInterval,clearInterval,
  React:new Proxy({createElement:()=>null},{get:(o,k)=>o[k]||noop}),
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  navigator:{userAgent:"stage-director-brief-test"},location:{},
  document:{
    createElement:()=>({getContext:()=>null,style:{},setAttribute:noop,appendChild:noop}),
    getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
    addEventListener:noop,removeEventListener:noop,body:{appendChild:noop,removeChild:noop}
  },
  addEventListener:noop,removeEventListener:noop,
  CustomEvent:class{},
  matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),
  turnContinuity:{},
};
box.window=box;
box.globalThis=box;
box.stageShotRuntime=sh=>Number(sh&&sh.dur)||2;
box.shotDur=box.stageShotRuntime;
box.shotGrammarLabel=sh=>sh&&sh.camera||"locked camera";
box.shotSizeOf=v=>({label:v||"Medium"});
box.shotAngleOf=v=>({label:v||"Eye level"});
box.shotMoveOf=v=>({label:v||"Static"});
box.shotLensOf=v=>({label:v||"50mm"});
box.inFrameCast=sh=>sh&&sh.subjects||[];
box.inFrameProps=sh=>sh&&sh.props||[];
box.locationForScene=(locations,id)=>(locations||[]).find(x=>(x.scenes||[]).includes(id))||null;
box.sceneContinuityLedger=()=>({});
box.scenePreset=()=>null;
box.shotLocationCoverageSpecs=()=>[];
box.propStateAt=(prop,sceneId,beatN,microBeatId,shotId)=>{
  if(prop&&prop.id==="prop-letter"&&shotId==="brief-later")
    return {active:true,referenceAssetId:"letter-open",condition:"open",holderName:"Daniel",
      bindingMode:"held",visibility:"visible",placement:"in Daniel's hand"};
  return {active:true,referenceAssetId:"letter-sealed",condition:"sealed",holderName:"Mara",
    bindingMode:"carried",visibility:"visible",placement:"on the brass desk"};
};
box.shotPropSheetId=p=>({id:p&&p.id,state:null});
box.custodyOwnerAt=p=>({name:p&&p.ownerName||"",handover:null});
box.sbPageRanges=shots=>[{start:0,count:(shots||[]).length}];
box.__sbShots=[];
box.CLIP_MAX_SECONDS=15;
box.CLIP_MAX_SHOTS=3;
box.CLIP_MAX_DIALOGUE=10;
vm.createContext(box);

function load(path,extra=""){
  vm.runInContext(readFileSync(path,"utf8")+extra,box,{filename:path});
}
load("app/shot-screenplay.js");
load("app/shot-scene-context.js");
load("app/stage-screenplay.js");
/* The production load order is intentional: this module resolves Stage helpers
   lazily, so it must be present before stage.jsx but need not duplicate them. */
load("app/stage-director-brief.js");
load("app/stage-plan.jsx");
/*
 * buildClipData is a Stage implementation detail.  Exporting the already
 * evaluated function only for this source test keeps the assertion on the
 * actual compiler rather than a permissive fixture clone.  A production
 * export, if added, wins without changing this test.
 */
load("app/stage.jsx","\nwindow.__testBuildClipData=buildClipData;");

const brief=box.seedanceDirectorBrief;
const recipe=box.seedanceRecipePrompt;
const buildClipData=box.stageBuildClipData||box.__testBuildClipData||box.buildClipData;
if(typeof brief!=="function"){
  console.error("FAIL window.seedanceDirectorBrief missing from app/stage-director-brief.js");
  process.exit(1);
}
if(typeof recipe!=="function"){
  console.error("FAIL window.seedanceRecipePrompt missing after Stage load");
  process.exit(1);
}
if(typeof buildClipData!=="function"){
  console.error("FAIL actual buildClipData is not reachable for the Stage director-brief test");
  process.exit(1);
}

const scene={
  id:"brief-scene",no:4,title:"The Archive Handoff",loc:"INT. ARCHIVE — NIGHT",order:1
};
const laterScene={id:"brief-next",no:5,title:"The Exit",loc:"EXT. ARCHIVE — DAWN",order:2};
const characters=[
  {id:"mara",name:"Mara",states:[]},
  {id:"daniel",name:"Daniel",states:[]},
  {id:"rhea",name:"Rhea",states:[]},
];
const props=[
  {id:"prop-letter",name:"Sealed Letter",ownerId:"mara",ownerName:"Mara",kind:"carried"}
];
const blocks=[
  {beat:1,type:"scene",text:"INT. ARCHIVE — NIGHT"},
  {beat:1,type:"action",text:"Mara waits beside the brass door."},
  {beat:1,type:"trans",text:"Mara crosses to the desk."},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Open the case."},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Open the case."},
  {beat:1,type:"char",text:"DANIEL (O.S.)"},
  {beat:1,type:"dia",text:"Use the window."},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"paren",text:"(SMS)"},
  {beat:1,type:"dia",text:"Meet me at dawn."},
  {beat:2,type:"action",text:"Mara enters the archive vault."},
  {beat:2,type:"char",text:"RHEA"},
  {beat:2,type:"dia",text:"The ledger is safe."},
];
const laterBlocks=[
  {beat:2,type:"scene",text:"EXT. ARCHIVE — DAWN"},
  {beat:2,type:"action",text:"Daniel enters the pale courtyard."},
  {beat:2,type:"char",text:"DANIEL"},
  {beat:2,type:"dia",text:"The night is over."},
];
const drafts={
  [scene.id]:{version:"brief-v1",blocks},
  [laterScene.id]:{version:"later-v1",blocks:laterBlocks},
};
const shotOpening={
  id:"brief-opening",sceneId:scene.id,order:1,beatN:1,dur:5,keyframeMode:"beat-opening",
  subjects:["mara"],props:["prop-letter"],covers:[1],screenplayDialogueIndex:0,
  size:"Wide",angle:"Eye level",move:"Slow push",lens:"35mm",
  beatPlan:{micro:["Mara waits beside the brass door.","Mara crosses to the desk."],protect:"The letter changes hands."}
};
const shotPart={
  id:"brief-part",sceneId:scene.id,order:2,beatN:1,dur:4,
  subjects:["mara"],props:["prop-letter"],covers:[2],
  size:"Close-up",angle:"High",move:"Static",lens:"85mm",
  dialogue:"Use the window.",screenplayDialogueIndex:2,
  lineAudio:{speaker:"Daniel",text:"Use the window.",durationMs:1200},
  beatPlan:{micro:["Mara waits beside the brass door.","Mara crosses to the desk."],protect:"The letter changes hands."}
};
const shotDuplicate={
  id:"brief-duplicate",sceneId:scene.id,order:4,beatN:1,dur:2,
  subjects:["mara"],props:["prop-letter"],covers:[1],screenplayDialogueIndex:1,
  beatPlan:{micro:["Mara waits beside the brass door.","Mara crosses to the desk."]}
};
const shotSms={
  id:"brief-sms",sceneId:scene.id,order:5,beatN:1,dur:2,
  subjects:["mara"],props:["prop-letter"],covers:[1],screenplayDialogueIndex:3,
  beatPlan:{micro:["Mara waits beside the brass door.","Mara crosses to the desk."]}
};
const shotLater={
  id:"brief-later",sceneId:scene.id,order:3,beatN:2,dur:5,
  subjects:["daniel"],props:["prop-letter"],covers:[1],
  size:"Medium",angle:"Eye level",move:"Static",lens:"50mm",
  dialogue:"The night is over.",screenplayDialogueIndex:0,
  beatPlan:{micro:["Mara enters the archive vault."],protect:"The ledger leaves the room."}
};
const allShots=[shotOpening,shotPart,shotDuplicate,shotSms,shotLater];
box.__sbShots=allShots;
const byId=Object.fromEntries(characters.map(x=>[x.id,x]));
const propById=Object.fromEntries(props.map(x=>[x.id,x]));
const ctx={
  project:{id:"brief-film"},
  scenes:[scene,laterScene],
  sceneShots:allShots,
  shotsByScene:{[scene.id]:allShots,[laterScene.id]:[]},
  drafts,characters,locations:[],props,beatsMap:{},
  charById:byId,propById,
};

const refs={
  assets:[
    {tag:"@Image7",kind:"image",role:"character",referenceKind:"character",entityId:"mara",label:"Mara · approved identity"},
    {tag:"@Image2",kind:"image",role:"prop state",referenceKind:"prop",assetId:"letter-sealed",label:"Sealed Letter · closed"},
    {tag:"@Audio4",kind:"audio",role:"dialogue",referenceKind:"audio",shotId:shotPart.id,label:"Daniel · exact line"},
    {tag:"@Image9",kind:"image",role:"location",referenceKind:"location",assetId:"archive",label:"Archive · approved location"},
  ],
  audioForShot:shotId=>shotId===shotOpening.id||shotId===shotPart.id?"@Audio4":""
};
const opts={
  durationSec:9,modelId:"seedance-2.5",maxSeconds:15,audioMode:"locked",modelQuality:"standard"
};

/*
 * Deliberately adversarial coverage: every utterance is the same literal
 * "Yes.", but its canonical occurrence, speaker and delivery differ.  The
 * selected shot order is the inverse of the source occurrence order so a
 * text-only merge cannot pass these assertions.
 */
const collisionScene={
  id:"same-text-scene",no:6,title:"The Switchboard",loc:"INT. SWITCHBOARD — NIGHT",order:2
};
const collisionBlocks=[
  {beat:1,type:"scene",text:"INT. SWITCHBOARD — NIGHT"},
  {beat:1,type:"action",text:"Mara checks the brass receiver."},
  {beat:1,type:"trans",text:"Mara lifts the receiver."},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"paren",text:"(quiet)"},
  {beat:1,type:"dia",text:"Yes."},
  {beat:1,type:"char",text:"DANIEL (O.S.)"},
  {beat:1,type:"paren",text:"(whisper)"},
  {beat:1,type:"dia",text:"Yes."},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"paren",text:"(SMS)"},
  {beat:1,type:"dia",text:"Yes."},
];
const collisionVisible={
  id:"collision-visible",sceneId:collisionScene.id,order:1,beatN:1,dur:3,
  subjects:["mara"],covers:[1],screenplayDialogueIndex:0,
  lineAudio:{speaker:"Mara",text:"Yes.",durationMs:1100},
  size:"Close-up",angle:"Eye level",move:"Static",lens:"50mm",
  beatPlan:{micro:["Mara checks the brass receiver.","Mara lifts the receiver."]}
};
const collisionRemote={
  id:"collision-remote",sceneId:collisionScene.id,order:2,beatN:1,dur:3,
  subjects:["mara"],covers:[2],screenplayDialogueIndex:1,
  lineAudio:{speaker:"Daniel",text:"Yes.",durationMs:900},
  size:"Medium",angle:"Eye level",move:"Slow push",lens:"50mm",
  beatPlan:{micro:["Mara checks the brass receiver.","Mara lifts the receiver."]}
};
const collisionSms={
  id:"collision-sms",sceneId:collisionScene.id,order:3,beatN:1,dur:2,
  subjects:["mara"],covers:[1],screenplayDialogueIndex:2,
  size:"Insert",angle:"Eye level",move:"Static",lens:"50mm",
  beatPlan:{micro:["Mara checks the brass receiver.","Mara lifts the receiver."]}
};
const collisionShots=[collisionVisible,collisionRemote,collisionSms];
const collisionDuplicate={...collisionRemote,id:"collision-duplicate",order:4};
const collisionDrafts={
  [collisionScene.id]:{version:"collision-v1",blocks:collisionBlocks}
};
const collisionChars=[
  {id:"mara",name:"Mara",states:[]},
  {id:"daniel",name:"Daniel",states:[]},
];
const collisionCtx={
  ...ctx,scenes:[scene,laterScene,collisionScene],drafts:{...drafts,...collisionDrafts},
  characters:collisionChars,charById:Object.fromEntries(collisionChars.map(x=>[x.id,x])),
  sceneShots:collisionShots,
  shotsByScene:{[collisionScene.id]:collisionShots},
  props:[],propById:{},locations:[],
};
const collisionRefs={
  assets:[
    {tag:"@Image11",kind:"image",role:"character",referenceKind:"character",entityId:"mara",label:"Mara · switchboard identity"},
    {tag:"@Audio3",kind:"audio",role:"dialogue",referenceKind:"audio",shotId:collisionVisible.id,label:"Mara quiet line"},
    {tag:"@Audio7",kind:"audio",role:"dialogue",referenceKind:"audio",shotId:collisionRemote.id,label:"Daniel whisper line"},
  ],
  audioForShot:shotId=>shotId===collisionVisible.id?"@Audio3"
    :shotId===collisionRemote.id?"@Audio7":""
};
const collisionDuplicateCtx={
  ...collisionCtx,
  sceneShots:[...collisionShots,collisionDuplicate],
  shotsByScene:{[collisionScene.id]:[...collisionShots,collisionDuplicate]},
};
const collisionWhole={
  ...collisionVisible,id:"collision-whole",order:1,
  screenplayDialogueIndex:undefined,dialogue:"Yes."
};
const collisionWholeCtx={
  ...collisionCtx,
  sceneShots:[collisionWhole],
  shotsByScene:{[collisionScene.id]:[collisionWhole]},
};

let pass=0,fail=0;
function ok(name,value,detail=""){
  if(value)pass++;
  else{fail++;console.error("FAIL "+name+(detail?" — "+detail:""));}
}
function makeData(groupShots){
  const g={shots:groupShots,start:0,dur:groupShots.reduce((n,x)=>n+Number(x.dur||0),0)};
  const singleOpening=groupShots.length===1&&groupShots[0]===shotOpening;
  const buildCtx=singleOpening
    ? {...ctx,sceneShots:[shotOpening],shotsByScene:{[scene.id]:[shotOpening]}}
    : ctx;
  return buildClipData(scene,g,buildCtx,15);
}
function makeClip(data,id="brief-clip",clipScene=scene){
  return {id,scene:clipScene,sceneId:clipScene.id,data};
}
function headingOrder(text){
  return [
    "BEAT CONTRACT",
    "ACTIVE REFERENCES",
    "SCENE AND OPENING STATE",
    "ACTION AND CAMERA PLAN",
    "PERFORMANCE",
    "LIGHTING AND PHYSICAL CONTINUITY",
    "DIALOGUE AND SOUND",
    "ENDING AND CONTINUITY LOCKS",
  ].map(h=>({h,i:text.indexOf(h)}));
}
function section(text,name,next){
  const start=text.indexOf(name);
  const end=next ? text.indexOf(next,start+name.length) : text.length;
  return start<0 ? "" : text.slice(start,end<0?text.length:end);
}

const before=JSON.stringify({shots:allShots,drafts});
const fullData=makeData([shotOpening]);
const fullClip=makeClip(fullData);
const fullBrief=brief(fullClip,[shotOpening],shotOpening,true,[shotOpening.id],refs,opts);
ok("default helper returns a director brief",typeof fullBrief==="string"&&fullBrief.length>0);
const headings=headingOrder(fullBrief);
ok("default brief has stable ordered section headings",
  headings.filter(x=>x.i>=0).length>=6
  &&headings.filter(x=>x.i>=0).every((x,i,a)=>i===0||x.i>a[i-1].i),
  headings.map(x=>x.h+":"+x.i).join(", "));
ok("single beat-opening brief has no invented cuts",!/CUT(?:\s+TO)?\s+\d+/i.test(fullBrief));
ok("default brief uses actual nonsequential image tag",fullBrief.includes("@Image7")&&!fullBrief.includes("@Image1"));
ok("default brief uses actual audio tag",fullBrief.includes("@Audio4")&&!fullBrief.includes("@Audio1"));
ok("brief carries requested duration and model contract",
  /\b9(?:\.0)?s\b/.test(fullBrief));
ok("single-shot brief carries its exact render window and explicit final hold",
  /SHOT 1 · 0–9s · Beat 1/.test(fullBrief)
  &&/FINAL HOLD · 5–9s/.test(fullBrief),fullBrief);
const pageBrief=brief(fullClip,[shotOpening],shotOpening,true,[shotOpening.id],{
  ...refs,assets:refs.assets.concat([
    {tag:"@Image11",kind:"image",referenceKind:"screenplay",page:1,totalPages:2,label:"Screenplay page 1"},
    {tag:"@Image12",kind:"image",referenceKind:"screenplay",page:2,totalPages:2,label:"Screenplay page 2"},
  ])
},opts);
ok("screenplay page references share one concise role declaration",
  pageBrief.includes("@Image11, @Image12 are screenplay page images 1, 2")
  &&(pageBrief.match(/Read them only as writing context/g)||[]).length===1,pageBrief);

const dataPart=makeData([shotPart]);
const partBrief=brief(makeClip(dataPart,"brief-part-clip"),[shotPart],shotPart,true,[shotPart.id],refs,opts);
const partLine=dataPart.panelLines.find(x=>x.shotId===shotPart.id);
ok("buildClipData exposes canonical beat blocks with evidence",
  Array.isArray(fullData.beatScripts?.[1]?.blocks)
  &&fullData.beatScripts[1].blocks.some(x=>x.text==="Mara crosses to the desk."
    &&x.evidence&&x.evidence.sourceType==="trans"));
ok("buildClipData exposes selected canonical action/trans blocks",
  Array.isArray(partLine?.actionBlocks)
  &&partLine.actionBlocks.length===1
  &&partLine.actionBlocks[0].text==="Mara crosses to the desk."
  &&partLine.actionBlocks[0].evidence&&partLine.actionBlocks[0].evidence.sourceType==="trans");
ok("selected part does not leak another action",partBrief.includes("Mara crosses to the desk.")&&!partBrief.includes("Mara waits beside the brass door."));
ok("selected part does not leak later-beat action",!partBrief.includes("Mara enters the archive vault."));
ok("selected part carries only its selected dialogue",partBrief.includes("Use the window.")&&!partBrief.includes("The ledger is safe."));

const collisionPartData=buildClipData(collisionScene,{shots:[collisionRemote],start:0,dur:3},collisionCtx,15);
const collisionPairData=buildClipData(collisionScene,
  {shots:[collisionRemote,collisionVisible],start:0,dur:6},collisionCtx,15);
const collisionDuplicateData=buildClipData(collisionScene,
  {shots:[collisionRemote],start:0,dur:3},collisionDuplicateCtx,15);
const collisionWholeData=buildClipData(collisionScene,
  {shots:[collisionWhole],start:0,dur:3},collisionWholeCtx,15);
const collisionPartClip={id:"collision-part",scene:collisionScene,sceneId:collisionScene.id,data:collisionPartData};
const collisionPairClip={id:"collision-pair",scene:collisionScene,sceneId:collisionScene.id,data:collisionPairData};
const collisionPartRows=collisionPartData.beatDialogues?.[1]||[];
const collisionPairRows=collisionPairData.beatDialogues?.[1]||[];
const collisionPartBrief=brief(collisionPartClip,[collisionRemote],collisionRemote,true,
  [collisionRemote.id],collisionRefs,{...opts,durationSec:3});
const collisionPairBrief=brief(collisionPairClip,[collisionRemote,collisionVisible],collisionRemote,true,
  [collisionRemote.id,collisionVisible.id],collisionRefs,{...opts,durationSec:6});
const collisionPartDialogue=section(collisionPartBrief,"DIALOGUE AND SOUND","ENDING AND CONTINUITY LOCKS");
const collisionPairDialogue=section(collisionPairBrief,"DIALOGUE AND SOUND","ENDING AND CONTINUITY LOCKS");
ok("same-text inverse assignment compiles without a screenplay coverage block",
  collisionPartData.screenplayDirectionIssues.length===0
  &&collisionPairData.screenplayDirectionIssues.length===0);
ok("duplicate screenplay occurrence assignment blocks compilation",
  collisionDuplicateData.screenplayDirectionIssues.some(x=>x&&x.blocking
    &&/assigned|occurrence|multiple|duplicate/i.test(String(x.message||""))));
ok("single whole-beat repeated-word dialogue retains the full canonical source",
  collisionWholeData.screenplayDirectionIssues.length===0
  &&(collisionWholeData.beatDialogues?.[1]||[]).length===3
  &&(collisionWholeData.beatDialogues[1]||[]).every(x=>x.text==="Yes."));
ok("partial same-text shot keeps only its indexed canonical occurrence",
  collisionPartRows.length===1
  &&collisionPartRows[0].evidence.blockIndex===8
  &&collisionPartRows[0].speaker==="Daniel"
  &&collisionPartRows[0].delivery==="off-screen");
ok("partial default brief binds remote line to its included audio asset",
  (collisionPartDialogue.match(/D\d+\s+·[^\n]*[“"]Yes\.[”"]/g)||[]).length===1
  &&/D1\s+·\s+Daniel\s+\[off-screen[^\]]*\][^\n]*[“"]Yes\.[”"]/i.test(collisionPartDialogue)
  &&collisionPartDialogue.includes("@Audio7")
  &&!collisionPartDialogue.includes("@Audio3")
  &&collisionPartBrief.includes("whisper"));
ok("inverse selected-shot order is restored to canonical dialogue order",
  collisionPairRows.length===2
  &&collisionPairRows.map(x=>x.evidence&&x.evidence.blockIndex).join(",")==="5,8"
  &&collisionPairRows.map(x=>x.speaker).join("|")==="Mara|Daniel"
  &&collisionPairRows.map(x=>x.delivery).join("|")==="in-room|off-screen");
ok("same-text default D markers bind each speaker's actual included audio",
  collisionPairDialogue.indexOf("Mara")<collisionPairDialogue.indexOf("Daniel")
  &&collisionPairDialogue.indexOf("@Audio3")<collisionPairDialogue.indexOf("@Audio7")
  &&/D1\s+·\s+Mara[^\n]*[“"]Yes\.[”"]/.test(collisionPairDialogue)
  &&/D2\s+·\s+Daniel[^\n]*[“"]Yes\.[”"]/.test(collisionPairDialogue));
ok("unselected SMS occurrence does not leak into a partial or inverse pair",
  !collisionPartDialogue.includes("SMS")
  &&!collisionPairDialogue.includes("SMS")
  &&collisionPairRows.every(x=>x.evidence.blockIndex!==11));
ok("beat script carries canonical scene heading and parenthetical evidence",
  collisionPairData.beatScripts[1].sceneHeading==="INT. SWITCHBOARD — NIGHT"
  &&collisionPairData.beatScripts[1].blocks.some(x=>x.text==="(whisper)"
    &&x.evidence&&x.evidence.sourceType==="paren"));

const sourceDialogues=fullData.beatScripts[1]?.dialogue||[];
const dlg=section(fullBrief,"DIALOGUE AND SOUND","ENDING AND CONTINUITY LOCKS");
const duplicateCount=(dlg.match(/Open the case\./g)||[]).length;
ok("canonical dialogue preserves exact order and duplicate occurrences",
  duplicateCount>=2
  &&dlg.indexOf("Open the case.")<dlg.indexOf("Use the window.")
  &&dlg.indexOf("Use the window.")<dlg.indexOf("Meet me at dawn."),
  JSON.stringify(sourceDialogues));
ok("dialogue evidence retains source occurrence indices",
  sourceDialogues.length===4
  &&sourceDialogues[0].evidence&&sourceDialogues[0].evidence.blockIndex<sourceDialogues[1].evidence.blockIndex
  &&sourceDialogues[0].text===sourceDialogues[1].text);
ok("offscreen dialogue stays audio-only",
  /off[- ]?screen|voice[- ]over|remote/i.test(dlg)
  &&!/lip[- ]?sync[^.]*Use the window\./i.test(dlg));
ok("SMS dialogue stays diegetic text without visible lip-sync",
  /SMS|text message|written\/message content|diegetic text/i.test(dlg)
  &&!/lip[- ]?sync[^.]*Meet me at dawn\./i.test(dlg));
ok("visible dialogue is eligible for matching audio lip-sync",
  /lip[- ]?sync/i.test(dlg)&&dlg.includes("@Audio4"));

const multiData=makeData([shotOpening,shotPart]);
const multiBrief=brief(makeClip(multiData,"brief-multi"),[shotOpening,shotPart],shotOpening,true,
  [shotOpening.id,shotPart.id],refs,{...opts,durationSec:9});
ok("multiple existing shots receive numbered cuts",
  /CUT\s+1/i.test(multiBrief)&&/CUT\s+2/i.test(multiBrief));
ok("multiple shots carry continuous non-overlapping time windows",
  /CUT 1 · 0–5s · Beat 1/.test(multiBrief)
  &&/CUT 2 · 5–9s · Beat 1/.test(multiBrief)
  &&/Carry-over: preserve prior positions/.test(multiBrief),multiBrief);
ok("single saved non-opening shot has no new cuts",
  !/CUT(?:\s+TO)?\s+\d+/i.test(partBrief));

const laterData=buildClipData(laterScene,{shots:[{
  ...shotLater,sceneId:laterScene.id
}],start:0,dur:5},{...ctx,sceneShots:[{...shotLater,sceneId:laterScene.id}],
  shotsByScene:{[laterScene.id]:[{...shotLater,sceneId:laterScene.id}]},drafts},15);
const laterBrief=brief(makeClip(laterData,"brief-later-clip",laterScene),
  [{...shotLater,sceneId:laterScene.id}],shotLater,true,[],{assets:[]},{...opts,durationSec:5});
ok("later scene entry uses later canonical source only",
  laterBrief.includes("Daniel enters the pale courtyard.")
  &&!laterBrief.includes("Mara waits beside the brass door.")
  &&!laterBrief.includes("Open the case."));

const changedDrafts={
  ...drafts,
  [scene.id]:{version:"brief-v2",blocks:blocks.map(x=>
    x.text==="Mara crosses to the desk."?{...x,text:"Mara crosses to the newly opened vault."}:{...x})}
};
const changedData=buildClipData(scene,{shots:[shotOpening],start:0,dur:5},{...ctx,drafts:changedDrafts},15);
const changedBrief=brief(makeClip(changedData,"brief-changed"),[shotOpening],shotOpening,true,
  [shotOpening.id],refs,opts);
ok("canonical source edits change compiled action and brief",
  changedData.beatScripts[1].text.includes("newly opened vault.")
  &&changedBrief.includes("newly opened vault.")
  &&changedBrief!==fullBrief);

const sealedProp=fullData.props.find(x=>x.id==="prop-letter");
const openProp=makeData([shotLater]).props.find(x=>x.id==="prop-letter");
ok("prop state changes resolve a different active continuity variant",
  sealedProp&&openProp&&sealedProp.sheetId==="letter-sealed"
  &&openProp.sheetId==="letter-open"
  &&sealedProp.stateLabel!==openProp.stateLabel);

const sparseData={...fullData,lighting:"",preset:null,props:[],cast:[],loc:null,
  panelLines:fullData.panelLines.map(x=>({...x,actionBlocks:x.actionBlocks||[]}))};
const sparseBrief=brief(makeClip(sparseData,"brief-sparse"),[shotOpening],shotOpening,false,[],{assets:[]},
  {...opts,modelQuality:""});
ok("unknown performance uses only the behavior-first rule",
  sparseBrief.includes("PERFORMANCE")
  &&sparseBrief.includes("objectives through observable behavior")
  &&!/fearful|angry|seductive|heroic|comedic/i.test(sparseBrief));
ok("default brief carries a physical weight lock without inventing measurements",
  sparseBrief.includes("gravity, contact, mass, inertia, weight transfer and follow-through"));
ok("unknown lighting and scene specifics are omitted rather than invented",
  !/cinematic|golden hour|shallow depth|f\/\d|Lighting:\s/i.test(sparseBrief));
ok("unknown references never invent image or audio tokens",
  !/@(?:Image|Audio|Video)\d+/i.test(sparseBrief));

const changedRefs={
  assets:[
    {tag:"@Image12",kind:"image",role:"character",referenceKind:"character",entityId:"mara",label:"Mara · reordered"},
    {tag:"@Audio8",kind:"audio",role:"dialogue",referenceKind:"audio",shotId:shotPart.id,label:"Daniel · reordered"},
  ]
};
const reorderedBrief=brief(fullClip,[shotOpening],shotOpening,true,[shotOpening.id],changedRefs,opts);
ok("changed reference ordering uses the actual new tags",
  reorderedBrief.includes("@Image12")&&reorderedBrief.includes("@Audio8")
  &&!reorderedBrief.includes("@Image7")&&!reorderedBrief.includes("@Audio4"));

const explicit=recipe("narrative",fullClip,[shotOpening],shotOpening,true,[shotOpening.id],refs,
  {explicitStyle:true});
ok("named explicit style bypasses the default director brief",
  !explicit.includes("BEAT CONTRACT")&&!explicit.includes("ENDING AND CONTINUITY LOCKS")
  &&explicit.includes("COVERAGE LOCK: one continuous shot"));
const auto=recipe("narrative",fullClip,[shotOpening],shotOpening,true,[shotOpening.id],refs,opts);
ok("recipe dispatch uses the default helper when explicit style is absent",
  auto.includes("BEAT CONTRACT")&&auto.includes("DIALOGUE AND SOUND"));

/*
 * Beat-level coverage: three legacy cuts drafted against a three-row paraphrased
 * plan while the screenplay beat carries six action blocks and two lines. The
 * clip covers the whole beat, so nothing blocks; the brief prints the authored
 * beat once, every cut keeps its Shots-tab design, and the timed plan's floor
 * comes from the coverage rows rather than the whole beat repeated per cut.
 */
const levelScene={id:"level-scene",no:7,title:"The Kitchen Count",loc:"INT. KITCHEN — NIGHT",order:3};
const levelBlocks=[
  {beat:1,type:"scene",text:"INT. KITCHEN — NIGHT"},
  {beat:1,type:"action",text:"Marcus counts the pills onto the table."},
  {beat:1,type:"action",text:"He lines them up in a row."},
  {beat:1,type:"char",text:"MARCUS"},
  {beat:1,type:"dia",text:"Twelve pills."},
  {beat:1,type:"action",text:"The phone buzzes once."},
  {beat:1,type:"action",text:"He does not look at it."},
  {beat:1,type:"action",text:"The kettle clicks off."},
  {beat:1,type:"action",text:"He sweeps the pills back into the bottle."},
  {beat:1,type:"char",text:"MARCUS"},
  {beat:1,type:"dia",text:"Somebody."},
];
const levelPlan=["Marcus counts pills at the table.","The phone buzzes; he ignores it.","He puts the pills away."];
const levelShots=[
  {id:"level-1",sceneId:levelScene.id,order:1,beatN:1,dur:5,covers:[1],subjects:["marcus"],
    size:"Wide",angle:"Eye level",move:"Static",lens:"35mm",
    action:"Marcus alone at the kitchen table, pills in a neat row.",composition:"Table fills the lower third.",
    purpose:"Establish the ritual.",directives:"Hold the wide; no push-in.",
    dialogue:"Twelve pills.",lineAudio:{speaker:"Marcus",text:"Twelve pills.",durationMs:4640},
    beatPlan:{micro:levelPlan}},
  {id:"level-2",sceneId:levelScene.id,order:2,beatN:1,covers:[2],subjects:["marcus"],
    size:"Medium",angle:"Eye level",move:"Static",lens:"50mm",
    action:"The phone face-up beside his hand.",composition:"Phone in the foreground, Marcus soft behind.",
    beatPlan:{micro:levelPlan}},
  {id:"level-3",sceneId:levelScene.id,order:3,beatN:1,covers:[3],subjects:["marcus"],
    size:"Insert",angle:"High",move:"Static",lens:"85mm",
    action:"Pills sliding back into the bottle.",composition:"Tight on the bottle mouth.",
    beatPlan:{micro:levelPlan}},
];
const levelChars=[{id:"marcus",name:"Marcus",states:[]}];
const levelCtx={...ctx,scenes:[scene,laterScene,levelScene],
  drafts:{...drafts,[levelScene.id]:{version:"level-v1",blocks:levelBlocks}},
  characters:levelChars,charById:Object.fromEntries(levelChars.map(x=>[x.id,x])),
  sceneShots:levelShots,shotsByScene:{[levelScene.id]:levelShots},props:[],propById:{},locations:[]};
const levelBefore=JSON.stringify({levelShots,levelBlocks});
const levelData=buildClipData(levelScene,{shots:levelShots,start:0,dur:9},levelCtx,15);
const levelIssues=levelData.screenplayDirectionIssues||[];
ok("beat-level coverage compiles with a review notice instead of a blocker",
  !levelIssues.some(x=>x.blocking)
  &&levelIssues.some(x=>x.code==="screenplay-coverage-beat-level"&&x.blocking===false
    &&/3 planned action moments/.test(x.message)&&/6 authored action blocks/.test(x.message)
    &&/3 designed shots/.test(x.message)),
  JSON.stringify(levelIssues));
const levelLines=levelData.panelLines||[];
ok("beat-level panel rows carry coverage, staging and Shots-tab design fields",
  levelLines.length===3&&levelLines.every(p=>p.beatLevel&&(p.beatActionBlocks||[]).length===6&&(p.actionBlocks||[]).length===0)
  &&levelLines.map(p=>p.coverage.join("|")).join("/")===levelPlan.join("/")
  &&levelLines[0].purpose==="Establish the ritual."&&levelLines[0].directives==="Hold the wide; no push-in."
  &&levelLines[1].staging==="The phone face-up beside his hand.",
  JSON.stringify(levelLines.map(p=>[p.beatLevel,p.coverage,p.staging,p.purpose])));
const levelRefs={assets:[
  {tag:"@Image3",kind:"image",role:"character",referenceKind:"character",entityId:"marcus",label:"Marcus · identity"},
  {tag:"@Audio2",kind:"audio",role:"dialogue",referenceKind:"audio",shotId:"level-1",label:"Marcus · exact line"},
],audioForShot:id=>id==="level-1"?"@Audio2":""};
const levelBrief=brief(makeClip(levelData,"level-clip",levelScene),levelShots,levelShots[0],true,["level-1"],levelRefs,{...opts,durationSec:10});
const levelPlanSection=section(levelBrief,"ACTION AND CAMERA PLAN","PERFORMANCE");
const countOf=(hay,needle)=>hay.split(needle).length-1;
ok("beat-level brief prints the authored beat once, in screenplay order, with dialogue markers",
  !/^BLOCKED/.test(levelBrief)&&/BEAT 1 · AUTHORED ACTION/.test(levelPlanSection)
  &&countOf(levelPlanSection,"Marcus counts the pills onto the table.")===1
  &&countOf(levelPlanSection,"He sweeps the pills back into the bottle.")===1
  &&levelPlanSection.indexOf("He lines them up in a row.")<levelPlanSection.indexOf("[D1 — Marcus]")
  &&levelPlanSection.indexOf("[D1 — Marcus]")<levelPlanSection.indexOf("The phone buzzes once.")
  &&levelPlanSection.indexOf("He sweeps the pills back")<levelPlanSection.indexOf("[D2 — Marcus]"),
  levelPlanSection);
ok("beat-level cuts carry coverage rows, staging, camera and Shots-tab notes",
  /CUT 1/.test(levelPlanSection)&&/CUT 2/.test(levelPlanSection)&&/CUT 3/.test(levelPlanSection)
  &&levelPlanSection.includes("Coverage: Marcus counts pills at the table.")
  &&levelPlanSection.includes("Staging: The phone face-up beside his hand.")
  &&levelPlanSection.includes("Camera: Wide · Eye level · Static · 35mm")
  &&levelPlanSection.includes("Composition: Tight on the bottle mouth.")
  &&levelPlanSection.includes("Intent: Establish the ritual.")
  &&levelPlanSection.includes("Director's notes (binding): Hold the wide; no push-in."),
  levelPlanSection);
ok("beat-level cut 1 owns its exact line and the second line stays clip-level",
  section(levelPlanSection,"CUT 1","CUT 2").includes("[D1 — Marcus]")
  &&!section(levelPlanSection,"CUT 2","CUT 3").includes("[D")
  &&/Unassigned clip-level dialogue/.test(levelPlanSection)
  &&/D2 · Marcus\b[^\n]*Somebody\./.test(levelBrief)
  &&/D1 · Marcus\b[^\n]*@Audio2/.test(levelBrief),
  levelBrief);
const levelTimed=box.stageBuildTimedPlan(levelData.promptShots,{maxSeconds:15,modelId:"seedance-2.5",audioMode:"locked",panelLines:levelLines});
ok("beat-level timed plan floors on coverage rows, not the whole beat per cut",
  levelTimed&&!levelTimed.issues.some(x=>x.blocking)&&levelTimed.minimumSec>=8&&levelTimed.minimumSec<=10,
  JSON.stringify(levelTimed&&{minimumSec:levelTimed.minimumSec,issues:levelTimed.issues}));
const levelTimedAtMin=box.stageBuildTimedPlan(levelData.promptShots,{maxSeconds:15,modelId:"seedance-2.5",audioMode:"locked",panelLines:levelLines,durationSec:levelTimed.minimumSec});
ok("the plan's own minimum satisfies the plan",!levelTimedAtMin.issues.some(x=>x.code==="duration-too-short"));
ok("repeated per-shot blockers read once in the prompt",
  brief(makeClip({...levelData,screenplayDirectionIssues:[
    {code:"x",blocking:true,shotId:"level-1",message:"Same fact."},
    {code:"x",blocking:true,shotId:"level-2",message:"Same fact."},
    {code:"x",blocking:true,shotId:"level-3",message:"Same fact."}]},"level-blocked",levelScene),
    levelShots,levelShots[0],true,[],levelRefs,opts)==="BLOCKED: Same fact.");
if(process.env.SHOW_BRIEF)console.log(levelBrief);
ok("beat-level compilation is immutable",JSON.stringify({levelShots,levelBlocks})===levelBefore);
/* Covers that point outside the stored plan leave a cut with no coverage rows: it
   times against its own staging line — never the whole authored beat once per cut,
   which would budget three beats and raise a false over-duration blocker. */
const strayShots=levelShots.map((sh,i)=>({...sh,covers:[i===1?9:sh.covers[0]]}));
const strayCtx={...levelCtx,sceneShots:strayShots,shotsByScene:{[levelScene.id]:strayShots}};
const strayData=buildClipData(levelScene,{shots:strayShots,start:0,dur:9},strayCtx,15);
const strayLines=strayData.panelLines||[];
ok("an out-of-range cut in a complete beat keeps every peer beat-level",
  strayLines.length===3&&strayLines.every(p=>p.beatLevel&&(p.actionBlocks||[]).length===0)
  &&strayLines[1].coverage.length===0&&strayLines[0].coverage.join("|")===levelPlan[0]
  &&(strayLines[1].micro||[]).join("|")==="The phone face-up beside his hand."
  &&!(strayData.screenplayDirectionIssues||[]).some(x=>x.blocking),
  JSON.stringify(strayLines.map(p=>[p.beatLevel,p.coverage,p.micro])));
const strayTimed=box.stageBuildTimedPlan(strayData.promptShots,{maxSeconds:15,modelId:"seedance-2.5",audioMode:"locked",panelLines:strayLines});
ok("a cut without coverage rows times against its staging line, not the whole beat",
  strayTimed&&!strayTimed.issues.some(x=>x.blocking)&&strayTimed.minimumSec>=8&&strayTimed.minimumSec<=10
  &&(strayTimed.units||[]).every(u=>!/Marcus counts the pills onto the table/.test(u.action||"")),
  JSON.stringify(strayTimed&&{minimumSec:strayTimed.minimumSec,units:(strayTimed.units||[]).map(u=>u.action),issues:strayTimed.issues}));
const strayBrief=brief(makeClip(strayData,"stray-clip",levelScene),strayShots,strayShots[0],true,["level-1"],levelRefs,{...opts,durationSec:10});
const strayPlanSection=section(strayBrief,"ACTION AND CAMERA PLAN","PERFORMANCE");
ok("the mixed beat performs each authored block exactly once",
  !/^BLOCKED/.test(strayBrief)&&countOf(strayPlanSection,"Marcus counts the pills onto the table.")===1
  &&countOf(strayPlanSection,"He sweeps the pills back into the bottle.")===1
  &&/Coverage: no Shots-tab plan note/.test(section(strayPlanSection,"CUT 2","CUT 3")),
  strayPlanSection);

const timed=box.stageBuildTimedPlan([shotPart],{durationSec:2,maxSeconds:15,modelId:"seedance-2.5"});
ok("timed plan still blocks an over-short requested duration",
  timed&&timed.issues&&timed.issues.some(x=>x.code==="duration-too-short"&&x.blocking));
const overlong=box.stageBuildTimedPlan([{...shotPart,dur:20}],
  {durationSec:20,maxSeconds:15,modelId:"seedance-2.5"});
ok("timed plan still reports overlong content instead of squeezing it",
  overlong&&(overlong.over===true||overlong.issues?.some(x=>x.blocking&&/over|maximum|cap/i.test(x.message||""))));
ok("brief and clip compilation are immutable",JSON.stringify({shots:allShots,drafts})===before);

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

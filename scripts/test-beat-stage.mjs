#!/usr/bin/env node
/* Regression checks for screenplay-beat Stage packaging. No build, network,
   database, workflow or paid provider calls. */
import {readFileSync} from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,requestAnimationFrame:noop,
  React:new Proxy({createElement:()=>null},{get:(o,k)=>o[k]||noop}),
  localStorage:{getItem:()=>null,setItem:noop},navigator:{},location:{},
  document:{createElement:()=>({}),addEventListener:noop,removeEventListener:noop,
    body:{appendChild:noop}},addEventListener:noop,removeEventListener:noop,
  CustomEvent:class{}
};
box.window=box;box.globalThis=box;
vm.createContext(box);
for(const file of ["app/shot-screenplay.js","app/shot-scene-context.js","app/stage-screenplay.js",
  "app/stage-plan.jsx","app/stage-references.jsx","app/stage-director-brief.js","app/stage.jsx"])
  vm.runInContext(readFileSync(file,"utf8"),box,{filename:file});

let pass=0,fail=0;
function ok(name,value,detail=""){
  if(value)pass++;
  else{fail++;console.error("FAIL "+name+(detail?" — "+detail:""));}
}
const scene={id:"marcus-house",loc:"INT. MARCUS HOUSE — NIGHT"};
const characters=[
  {id:"marcus",name:"Marcus Tillmon",states:[]},
  {id:"daniel",name:"Daniel Reed",states:[]},
  {id:"oliver",name:"Oliver Stone",states:[]},
  {id:"priya",name:"Priya Shah",states:[]},
  {id:"nora",name:"Nora Vale",states:[]}
];
const drafts={ [scene.id]:{version:4,blocks:[
  {beat:1,type:"scene",text:scene.loc},
  {beat:1,type:"action",text:"Marcus sits alone in the kitchen, turning a photograph over in his hands."},
  {beat:1,type:"action",text:"Daniel's voice comes through the phone; Marcus freezes but does not see Daniel."},
  {beat:1,type:"char",text:"DANIEL (V.O.)"},
  {beat:1,type:"dia",text:"You promised you would never open that door."},
  {beat:1,type:"char",text:"OLIVER (O.S.)"},
  {beat:1,type:"dia",text:"The hallway is clear."},
  {beat:1,type:"char",text:"PRIYA (ON PHONE)"},
  {beat:1,type:"dia",text:"Do not answer him."},
  {beat:1,type:"char",text:"DANIEL (TEXT)"},
  {beat:1,type:"dia",text:"I can see the house."},
  {beat:1,type:"scene",text:"INT. MARCUS HOUSE — HALLWAY"},
  {beat:1,type:"char",text:"NORA"},
  {beat:1,type:"dia",text:"I found the key."},
  {beat:1,type:"char",text:"MARCUS"},
  {beat:1,type:"paren",text:"(quietly)"},
  {beat:1,type:"dia",text:"I know."}
] } };
const source=box.shotBeatScreenplay(scene,1,{drafts,characters,beatsMap:{}});
ok("beat helper reports live source",source.hasSource);
ok("opening action is the first physical state",source.openingAction.includes("Marcus sits alone"));
ok("opening cast contains Marcus only",source.openingCharacterIds.length===1&&source.openingCharacterIds[0]==="marcus");
ok("Daniel is remote, not physical",source.remoteCharacterIds.includes("daniel")&&!source.physicalCharacterIds.includes("daniel"));
ok("mentioned cast keeps remote speaker in screenplay metadata",
  source.mentionedCharacterIds.includes("marcus")&&source.mentionedCharacterIds.includes("daniel"));
ok("helper retains every action and exact dialogue",
  source.text.includes("Marcus sits alone")&&source.text.includes("Daniel's voice comes through")
    &&source.text.includes("You promised you would never open that door.")&&source.text.includes("I know."));
ok("shared helper preserves VO, OS, phone, SMS and in-room enums",
  source.dialogue[0]&&source.dialogue[0].speakerId==="daniel"&&source.dialogue[0].delivery==="voice-over"
    &&source.dialogue[1]&&source.dialogue[1].speakerId==="oliver"&&source.dialogue[1].delivery==="off-screen"
    &&source.dialogue[2]&&source.dialogue[2].speakerId==="priya"&&source.dialogue[2].delivery==="phone"
    &&source.dialogue[3]&&source.dialogue[3].speakerId==="daniel"&&source.dialogue[3].delivery==="text"
    &&source.dialogue[4]&&source.dialogue[4].speakerId==="nora"&&source.dialogue[4].delivery==="in-room"
    &&source.dialogue[5]&&source.dialogue[5].speakerId==="marcus"&&source.dialogue[5].delivery==="in-room");

const staleShot={id:"legacy-daniel",sceneId:scene.id,beatN:1,keyframeMode:"beat-opening",
  subjects:["marcus","daniel"],action:"Marcus sits in the kitchen",dialogue:"",dur:18,
  covers:[1],beatPlan:{micro:["old later insert"]}};
const metadata={marcus:{iso:"m1",version:1},daniel:{iso:"d1",version:1}};
const pkg=box.stageShotReferencePackage([staleShot],{
  scene,scenes:[scene],characters,props:[],locations:[],metadata,drafts,beatsMap:{},
  images:{marcus:"data:image/png;base64,marcus"}
});
ok("exact opening cast excludes stale remote subject",
  pkg.characters.some(x=>x.entityId==="marcus")&&!pkg.characters.some(x=>x.entityId==="daniel"));
ok("package exposes remote metadata without attaching identity image",
  pkg.remoteCharacterIds.includes("daniel")&&!pkg.byShot[0].characters.includes("daniel"));
const later={...staleShot,id:"later-physical",keyframeMode:"legacy",
  referenceCharactersSet:true,referenceCharacterIds:["nora"]};
const laterPkg=box.stageShotReferencePackage([later],{
  scene,scenes:[scene],characters,props:[],locations:[],metadata,drafts,beatsMap:{},
  images:{marcus:"data:image/png;base64,marcus",nora:"data:image/png;base64,nora"}
});
ok("later non-opening shot can select authored physical cast",
  laterPkg.characters.some(x=>x.entityId==="nora")
    &&!laterPkg.warnings.some(x=>x.code==="offscreen-character-reference"));
const manual={...staleShot,stageCharacterReferenceOverrides:{daniel:"master"}};
const manualPkg=box.stageShotReferencePackage([manual],{
  scene,scenes:[scene],characters,props:[],locations:[],metadata,drafts,beatsMap:{},
  images:{marcus:"data:image/png;base64,marcus",daniel:"data:image/png;base64,daniel"}
});
ok("explicit offscreen override is filtered with actionable mismatch",
  !manualPkg.characters.some(x=>x.entityId==="daniel")
    &&manualPkg.warnings.some(x=>x.code==="offscreen-character-reference"&&x.severity==="error"));

const beatScript=source.text;
const beatShot={...staleShot,beatScript:{text:beatScript,openingAction:source.openingAction,
  dialogue:source.dialogue,sourceRev:source.sourceRev}};
const clip={id:"beat-clip",scene,data:{
  shots:[beatShot],cast:[{id:"marcus",name:"Marcus Tillmon"}],setting:scene.loc,
  beatScripts:{1:source},beatDialogues:{1:source.dialogue},panelLines:[]
}};
const refs={character:c=>c.name,speaker:s=>s,setting:s=>s};
const prompt=box.seedanceRecipePrompt("narrative",clip,[beatShot],beatShot,false,[],refs,
  {timedPlan:true,modelId:"seedance-2.0",maxSeconds:20,durationSec:18});
ok("video prompt uses the approved director brief",
  prompt.includes("BEAT CONTRACT")
  &&prompt.includes("ACTION AND CAMERA PLAN")
  &&prompt.includes("DIALOGUE AND SOUND"));
ok("video prompt carries canonical source action and dialogue",
  prompt.includes("Marcus sits alone in the kitchen")
  &&prompt.includes("You promised you would never open that door."));
ok("video prompt keeps remote speaker VO offscreen",
  prompt.includes("offscreen voice only")
  &&prompt.includes("never add a body, face or lip-sync"));
ok("video prompt does not request a micro-beat montage",
  !prompt.includes("Micro-beat action plan")
  &&/one continuous shot/i.test(prompt));

const plan=box.stageBuildTimedPlan([beatShot],{
  modelId:"seedance-2.0",maxSeconds:15,maxShots:3,maxDialogue:10,durationSec:15,
  scene,drafts,characters,beatsMap:{},panelLines:[]
});
ok("long beat remains an over-duration blocker",plan.over&&plan.issues.some(x=>x.code==="over-duration"));
ok("long beat dialogue is not silently truncated",
  plan.units[0].dialogue.includes("You promised you would never open that door.")
    &&plan.units[0].dialogue.includes("I know."));

const actionScene={id:"action-only",loc:"INT. WORKSHOP — NIGHT"};
const actionBlocks=[{beat:1,type:"scene",text:actionScene.loc}];
for(let i=1;i<=12;i++)actionBlocks.push({beat:1,type:"action",
  text:"Marcus crosses the workshop, checks the locked drawer, and records the evidence before the lights fail "+i+"."});
const actionDrafts={...drafts,[actionScene.id]:{version:1,blocks:actionBlocks}};
const actionShot={id:"action-only-shot",sceneId:actionScene.id,beatN:1,keyframeMode:"beat-opening",
  subjects:["marcus"],action:"old short action",dur:5};
const actionPlan=box.stageBuildTimedPlan([actionShot],{
  modelId:"seedance-2.0",maxSeconds:15,maxShots:3,maxDialogue:10,durationSec:15,
  scene:actionScene,drafts:actionDrafts,characters,beatsMap:{},panelLines:[]
});
ok("action-only full beat gets an honest duration estimate and blocker",
  actionPlan.units[0].estimated&&actionPlan.units[0].duration>15
    &&actionPlan.over&&actionPlan.issues.some(x=>x.code==="over-duration"));
ok("action-only source keeps every authored action",
  actionPlan.units[0].beatScript.includes("lights fail 1.")
    &&actionPlan.units[0].beatScript.includes("lights fail 12."));
const canonicalHelper=box.shotBeatScreenplay;
box.shotBeatScreenplay=undefined;
const missingHelperPlan=box.stageBuildTimedPlan([beatShot],{
  modelId:"seedance-2.0",maxSeconds:15,maxShots:3,maxDialogue:10,durationSec:15,
  scene,drafts,characters,beatsMap:{},panelLines:[]
});
box.shotBeatScreenplay=canonicalHelper;
ok("beat-opening fails explicitly when canonical helper is missing",
  missingHelperPlan.issues.some(x=>x.code==="missing-screenplay-helper"&&x.blocking));

const legacy={id:"old-shot",sceneId:scene.id,beatN:1,subjects:["daniel"],action:"Daniel on a phone",
  beatPlan:{micro:["Daniel answers"]}};
const before=JSON.stringify(legacy);
box.stageShotReferencePackage([legacy],{scene,scenes:[scene],characters,props:[],locations:[],metadata,drafts,beatsMap:{}});
ok("legacy shot is not rewritten",JSON.stringify(legacy)===before);

const packed=box.stagePlanClips([
  {...beatShot,id:"beat-a",dur:4},
  {...beatShot,id:"beat-b",beatN:2,dur:4}
],{modelId:"seedance-2.0",maxSeconds:15,maxShots:3,maxDialogue:10,scope:"beat"});
ok("one beat-opening shot stays one shot per beat",
  packed.length===2&&packed.every(x=>x.shots.length===1));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
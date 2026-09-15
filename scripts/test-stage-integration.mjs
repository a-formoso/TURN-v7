#!/usr/bin/env node
/* Source-level Stage integration checks. No build, network, database or render. */
import {readFileSync} from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,React:new Proxy({createElement:()=>null},{get:(o,k)=>o[k]||noop}),
  localStorage:{getItem:()=>null,setItem:noop},navigator:{},location:{},
  document:{createElement:()=>({}),addEventListener:noop,removeEventListener:noop,body:{appendChild:noop}},
  addEventListener:noop,removeEventListener:noop,CustomEvent:class{},
};
box.window=box;box.globalThis=box;
box.stageShotRuntime=sh=>Number(sh.dur)||2;
box.shotGrammarLabel=sh=>sh.camera||"locked camera";
vm.createContext(box);
for(const file of ["app/shot-screenplay.js","app/shot-scene-context.js","app/stage-screenplay.js",
  "app/stage-plan.jsx","app/stage-references.jsx","app/stage-director-brief.js","app/stage.jsx"])
  vm.runInContext(readFileSync(file,"utf8"),box,{filename:file});

let pass=0,fail=0;
function ok(name,value,detail=""){if(value)pass++;else{fail++;console.error("FAIL "+name+(detail?" — "+detail:""));}}

const shots=[
  {id:"a",sceneId:"s",beatN:1,dur:8,covers:[1],beatPlan:{micro:["Open the door","See the letter"]},action:"Door opens"},
  {id:"b",sceneId:"s",beatN:1,dur:8,covers:[2],beatPlan:{micro:["Open the door","See the letter"]},dialogue:"It is here"},
  {id:"c",sceneId:"s",beatN:2,dur:5,covers:[1],beatPlan:{micro:["Mara runs"]},action:"Mara runs"},
];
const liveScene={id:"s",loc:"INT. HALL — NIGHT"};
const liveCtx={drafts:{s:{version:"live",blocks:[
  {beat:1,type:"scene",text:"INT. HALL — NIGHT"},
  {beat:1,type:"action",text:"Mara crosses to the newly opened observatory window."},
  {beat:1,type:"action",text:"Mara waits for the signal."}
]}},characters:[{id:"mara",name:"Mara"}]};
const liveDirection=box.stageCurrentScreenplayDirection(liveScene,shots[0],liveCtx,shots);
ok("ordinary shot direction follows current screenplay source",
  liveDirection&&liveDirection.text==="Mara crosses to the newly opened observatory window."
  && !liveDirection.text.includes("Open the door"));

const sharedScene={id:"shared",loc:"INT. HALL — NIGHT"};
const sharedShots=[
  {id:"shared-a",sceneId:"shared",beatN:1,covers:[1],beatPlan:{micro:["Old A","Old B"]}},
  {id:"shared-b",sceneId:"shared",beatN:1,covers:[2],beatPlan:{micro:["Old A","Old B"]}}
];
const sharedCtx={drafts:{shared:{version:"shared",blocks:[
  {beat:1,type:"scene",text:"INT. HALL — NIGHT"},
  {beat:1,type:"action",text:"Current A"},
  {beat:1,type:"action",text:"Current B"}
]}},characters:[]};
const sharedBefore=JSON.stringify(sharedShots);
const sharedA=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[0],sharedCtx,sharedShots);
const sharedB=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[1],sharedCtx,sharedShots);
ok("shared beat micro coverage stays shot-local",
  sharedA&&sharedA.actions.join("|")==="Current A"&&sharedB&&sharedB.actions.join("|")==="Current B");
ok("single/part resolution uses complete scene peers",
  box.stageCurrentScreenplayDirection(sharedScene,sharedShots[0],sharedCtx,sharedShots).actions.length===1);
ok("screenplay direction derivation is immutable",
  JSON.stringify(sharedShots)===sharedBefore&&JSON.stringify(sharedCtx.drafts.shared.blocks).includes("Current A"));

const fullBeatScene={id:"full",loc:"INT. ROOM — NIGHT"};
const fullBeatShot={id:"full-a",sceneId:"full",beatN:1,beatPlan:{micro:["Old full"]},covers:[1]};
const fullBeatCtx={drafts:{full:{version:"full",blocks:[
  {beat:1,type:"scene",text:"INT. ROOM — NIGHT"},
  {beat:1,type:"action",text:"Current full action"},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"First exact line"},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Second exact line"}
]}},characters:[{id:"mara",name:"Mara"}]};
const fullBeat=box.stageCurrentScreenplayDirection(fullBeatScene,fullBeatShot,fullBeatCtx,[fullBeatShot],true);
ok("true whole-beat shot retains every authored dialogue line",
  fullBeat&&fullBeat.dialogues.length===2&&fullBeat.dialogue.includes("First exact line")
  &&fullBeat.dialogue.includes("Second exact line"));

const rewriteCtx={drafts:{shared:{version:"rewrite",blocks:[
  {beat:1,type:"scene",text:"INT. HALL — NIGHT"},
  {beat:1,type:"action",text:"One rewritten block replaces two covered actions"}
]}},characters:[]};
const rewrite=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[0],rewriteCtx,sharedShots);
ok("ambiguous multi-shot rewrite blocks paid PARTIAL coverage with the plan-count fact",
  rewrite&&rewrite.blocked&&/coverage plan has 2 moments/.test(rewrite.message)
  &&/1 authored action block\b/.test(rewrite.message)&&!/changed shape/i.test(rewrite.message));
// The same shots as a COMPLETE beat: a paraphrased plan whose row count differs
// from the authored blocks is not evidence that the screenplay changed — the
// clip covers the whole beat, so it renders at beat level instead of blocking.
const rewriteComplete=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[0],rewriteCtx,sharedShots,true);
ok("complete beat under a paraphrased coverage plan renders at beat level",
  rewriteComplete&&!rewriteComplete.blocked&&rewriteComplete.beatLevel===true
  &&rewriteComplete.actions.length===0&&rewriteComplete.actionBlocks.length===0
  &&rewriteComplete.beatActions.join("|")==="One rewritten block replaces two covered actions"
  &&rewriteComplete.coverage.join("|")==="Old A"
  &&rewriteComplete.text==="One rewritten block replaces two covered actions"
  &&rewriteComplete.beatCoverage&&rewriteComplete.beatCoverage.planRows===2&&rewriteComplete.beatCoverage.blocks===1);
const outOfRange=[{id:"oor-a",sceneId:"shared",beatN:1,covers:[5],beatPlan:{micro:["Old A","Old B"]}},sharedShots[1]];
const outOfRangePartial=box.stageCurrentScreenplayDirection(sharedScene,outOfRange[0],sharedCtx,outOfRange,false);
const outOfRangeComplete=box.stageCurrentScreenplayDirection(sharedScene,outOfRange[0],sharedCtx,outOfRange,true);
ok("out-of-range covers block a partial render and name the stored plan size",
  outOfRangePartial&&outOfRangePartial.blocked&&/outside the beat's stored coverage plan \(2 moments\)/.test(outOfRangePartial.message));
ok("out-of-range covers in a complete beat fall back to beat level with no coverage rows",
  outOfRangeComplete&&!outOfRangeComplete.blocked&&outOfRangeComplete.beatLevel===true
  &&outOfRangeComplete.coverage.length===0&&outOfRangeComplete.beatActions.join("|")==="Current A|Current B");
// beat-level is decided once for the whole beat: the mappable peer of an
// unmappable shot is beat-level too, or its cut would perform its authored blocks
// a second time beside the beat-level block
const mixedPeer=box.stageCurrentScreenplayDirection(sharedScene,outOfRange[1],sharedCtx,outOfRange,true);
ok("the mappable peer of an unmappable shot renders beat-level as well",
  mixedPeer&&!mixedPeer.blocked&&mixedPeer.beatLevel===true&&mixedPeer.actions.length===0
  &&mixedPeer.coverage.join("|")==="Old B"&&mixedPeer.beatActions.join("|")==="Current A|Current B");
ok("a fully mappable complete beat keeps per-shot authored blocks",
  (()=>{const a=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[0],sharedCtx,sharedShots,true);
    const b=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[1],sharedCtx,sharedShots,true);
    return a&&b&&!a.beatLevel&&!b.beatLevel&&a.actions.join("|")==="Current A"&&b.actions.join("|")==="Current B";})());
// A legacy three-cut beat drafted against a three-row plan while the screenplay
// beat carries six blocks and two lines: exact dialogue still binds per shot,
// the second line stays clip-level, and no shot pretends to own specific blocks.
const beatLevelPlan=["Row one","Row two","Row three"];
const beatLevelShots=[
  {id:"bl-1",sceneId:"bl",beatN:1,covers:[1],dur:5,dialogue:"Twelve pills.",beatPlan:{micro:beatLevelPlan}},
  {id:"bl-2",sceneId:"bl",beatN:1,covers:[2],beatPlan:{micro:beatLevelPlan}},
  {id:"bl-3",sceneId:"bl",beatN:1,covers:[3],beatPlan:{micro:beatLevelPlan}},
];
const beatLevelScene={id:"bl",loc:"INT. KITCHEN — NIGHT"};
const beatLevelCtx={drafts:{bl:{version:"bl",blocks:[
  {beat:1,type:"scene",text:"INT. KITCHEN — NIGHT"},
  {beat:1,type:"action",text:"Block one."},
  {beat:1,type:"action",text:"Block two."},
  {beat:1,type:"char",text:"MARCUS"},
  {beat:1,type:"dia",text:"Twelve pills."},
  {beat:1,type:"action",text:"Block three."},
  {beat:1,type:"action",text:"Block four."},
  {beat:1,type:"action",text:"Block five."},
  {beat:1,type:"action",text:"Block six."},
  {beat:1,type:"char",text:"MARCUS"},
  {beat:1,type:"dia",text:"Somebody."}
]}},characters:[{id:"marcus",name:"Marcus"}]};
const bl=beatLevelShots.map(sh=>box.stageCurrentScreenplayDirection(beatLevelScene,sh,beatLevelCtx,beatLevelShots,true));
ok("six-block beat over a three-row plan renders whole with per-shot coverage rows",
  bl.every(x=>x&&!x.blocked&&x.beatLevel&&x.beatActions.length===6)
  &&bl.map(x=>x.coverage.join("|")).join("/")==="Row one/Row two/Row three");
ok("beat-level shots keep exact dialogue binding and clip-level speech",
  bl[0].dialogue==="Twelve pills."&&bl[0].dialogues.length===1
  &&bl[1].dialogues.length===0&&bl[2].dialogues.length===0
  &&bl.every(x=>x.clipDialogues.map(d=>d.text).join("|")==="Somebody."));
const beatLevelPartial=box.stageCurrentScreenplayDirection(beatLevelScene,beatLevelShots[1],beatLevelCtx,beatLevelShots,false);
ok("a single cut of that beat still cannot render on its own",
  beatLevelPartial&&beatLevelPartial.blocked&&/3 moments/.test(beatLevelPartial.message)&&/6 authored action blocks/.test(beatLevelPartial.message));

const dialogueCtx={drafts:{shared:{version:"dialogue",blocks:[
  {beat:1,type:"scene",text:"INT. HALL — NIGHT"},
  {beat:1,type:"action",text:"Current A"},
  {beat:1,type:"action",text:"Current B"},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Line one"},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Line two"}
]}},characters:[{id:"mara",name:"Mara"}]};
const dialogueReview=box.stageCurrentScreenplayDirection(sharedScene,sharedShots[0],dialogueCtx,sharedShots);
ok("unassigned partial dialogue blocks rather than guessing coverage",
  dialogueReview&&dialogueReview.blocked&&dialogueReview.code==="screenplay-dialogue-review");

const completeSpeechShots=[
  {id:"speech-a",sceneId:"shared",beatN:1,covers:[1],beatPlan:{micro:["Current A","Current B"]}},
  {id:"speech-b",sceneId:"shared",beatN:1,covers:[2],beatPlan:{micro:["Current A","Current B"]}}
];
const completeSpeechCtx={drafts:{shared:{version:"speech",blocks:[
  {beat:1,type:"scene",text:"INT. HALL — NIGHT"},
  {beat:1,type:"action",text:"Current A"},
  {beat:1,type:"action",text:"Current B"},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Mara's exact line"},
  {beat:1,type:"char",text:"THEO"},
  {beat:1,type:"dia",text:"Theo's exact answer"}
]}},characters:[{id:"mara",name:"Mara"},{id:"theo",name:"Theo"}]};
const completeSpeech=box.stageCurrentScreenplayDirection(sharedScene,completeSpeechShots[0],completeSpeechCtx,completeSpeechShots,true);
const partialSpeech=box.stageCurrentScreenplayDirection(sharedScene,completeSpeechShots[0],completeSpeechCtx,[completeSpeechShots[0]],false);
ok("complete multi-shot beat keeps unassigned multi-speaker speech clip-level once",
  completeSpeech&&!completeSpeech.blocked&&completeSpeech.dialogues.length===0
  &&completeSpeech.clipDialogues.map(x=>x.text).join("|")==="Mara's exact line|Theo's exact answer");
ok("the same beat as a partial shot still blocks unassigned speech",
  partialSpeech&&partialSpeech.blocked&&partialSpeech.code==="screenplay-dialogue-review");

const assignedSpeechShots=[
  {id:"assigned-a",sceneId:"shared",beatN:1,covers:[1],dialogueLines:[{text:"Mara's exact line",speaker:"Mara"}],beatPlan:{micro:["Current A","Current B"]}},
  {id:"assigned-b",sceneId:"shared",beatN:1,covers:[2],beatPlan:{micro:["Current A","Current B"]}}
];
const assignedLineCtx={drafts:{shared:{version:"assigned-line",blocks:[
  {beat:1,type:"scene",text:"INT. HALL — NIGHT"},
  {beat:1,type:"action",text:"Current A"},
  {beat:1,type:"action",text:"Current B"},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"dia",text:"Mara's exact line"}
]}},characters:[{id:"mara",name:"Mara"}]};
const assignedA=box.stageCurrentScreenplayDirection(sharedScene,assignedSpeechShots[0],assignedLineCtx,assignedSpeechShots,true);
const assignedB=box.stageCurrentScreenplayDirection(sharedScene,assignedSpeechShots[1],assignedLineCtx,assignedSpeechShots,true);
const assignedPartialSilent=box.stageCurrentScreenplayDirection(sharedScene,assignedSpeechShots[1],assignedLineCtx,assignedSpeechShots,false);
ok("complete assigned dialogue remains per-shot and locked-voice eligible",
  assignedA&&!assignedA.blocked&&assignedA.dialogue==="Mara's exact line"
  &&assignedA.clipDialogues.length===0
  &&assignedB&&!assignedB.blocked&&assignedB.dialogues.length===0);
ok("partial silent shot is allowed when every line is assigned elsewhere",
  assignedPartialSilent&&!assignedPartialSilent.blocked&&assignedPartialSilent.dialogues.length===0
  &&assignedPartialSilent.clipDialogues.length===0);

const groups=box.stagePlanClips(shots,{modelId:"seedance-2.0",maxSeconds:15,maxShots:3,maxDialogue:10,scope:"beat"});
ok("planner splits overlong beat at shot boundaries",groups.length===3,JSON.stringify(groups.map(g=>g.shots.map(s=>s.id))));
ok("planner omits no shots",groups.flatMap(g=>g.shots).map(s=>s.id).join(",")==="a,b,c");
ok("planner numbers beat parts",groups[0].part===1&&groups[0].parts===2&&groups[1].part===2);

const panels=shots.map(sh=>({shotId:sh.id,beatN:sh.beatN,text:sh.action||"",dialogue:sh.dialogue||"",speaker:{name:"Mara"}}));
const clip={id:"clip",scene:{loc:"Hall"},data:{shots,panelLines:panels,lineShots:[shots[1]],cast:[],props:[],dur:21}};
const prompt=box.seedanceTimedPlanPrompt(clip,shots,true,["b"],null,{modelId:"seedance-2.5",maxSeconds:30});
ok("timed prompt includes every beat",/Beat 1/.test(prompt)&&/Beat 2/.test(prompt),prompt);
ok("timed prompt obeys explicit covers",prompt.includes("Open the door")&&prompt.includes("See the letter"));
ok("timed prompt keeps exact selected dialogue",prompt.includes('says "It is here"'),prompt);

const mismatch={...shots[1],dialogue:"Revised exact words"};
const exact=box.stageShotDialogueLine({id:"s"},{s:{blocks:[
  {beat:1,type:"char",text:"MARA"},{beat:1,type:"dia",text:"Entirely different canon line"},
]}},mismatch,{beatsMap:{},characters:[],charById:{}});
ok("dialogue mismatch never borrows whole-beat line",exact&&exact.text==="Revised exact words",JSON.stringify(exact));

const models=box.SEEDANCE_MODELS;
const m25=models.find(m=>m.id==="seedance-2.5");
ok("2.5 registry describes 1080p",m25&&m25.tiers[0].maxRes==="1080p");
ok("2.5 1080p waits for runtime handshake",box.stageServerResolutionAllowed("seedance-2.5","1080p",{known:false})===false);
ok("2.5 1080p unlocks only when advertised",box.stageServerResolutionAllowed("seedance-2.5","1080p",
  {known:true,capabilities:{resolutions:["480p","720p","1080p"]}})===true);

const source=readFileSync("app/stage.jsx","utf8");
const imageSource=readFileSync("app/imagegen.jsx","utf8");
const videoSource=readFileSync("app/videogen.jsx","utf8");
const proxySource=readFileSync("supabase/functions/image-proxy/index.ts","utf8");
ok("no mount-time canonical duration autofit",!source.includes("onUpdateShot(sh.id,{ dur:want })"));
ok("render metadata carries plan and reference provenance",source.includes("renderPlan:attemptRenderPlan")&&source.includes("referenceSourceVersions"));
ok("every Stage resolution surface uses the server guard",
  (source.match(/stageServerResolutionAllowed\(modelId,r,runtimeCaps,capabilityTarget\)/g)||[]).length>=4);
ok("Render settings exposes disabled semantics for pending resolutions",
  source.includes('disabled,\"aria-disabled\":disabled?\"true\":undefined'));
const files12=[{kind:"text"},...Array.from({length:12},(_,i)=>({kind:i%3?"image":"audio"}))];
ok("12 reference files plus script text fit a 12-file cap",box.stageReferenceFileCount(files12)===12);
ok("13 reference files exceed a 12-file cap",box.stageReferenceFileCount([...files12,{kind:"video"}])>12);
ok("Stage never launches an automatic character-reference fallback",
  !source.includes("vidLikenessError")&&!source.includes("safetyFallback")&&!source.includes("dropped character refs"));
ok("media-policy refusal exposes only the explicit Seedance 2.5 text-only recovery",
  box.stageCanOfferTextOnlyRecovery(
    "The provider rejected this render under its content, safety, or likeness policy. The images or videos provided may contain likenesses of real people or private information.",
    "seedance-2.5")===true
  &&box.stageCanOfferTextOnlyRecovery("The prompt was rejected by content policy.","seedance-2.5")===false
  &&box.stageCanOfferTextOnlyRecovery("policy refusal: character reference rejected","seedance-2.0")===false);
const textOnlyPrompt=box.stageTextOnlyPrompt(
  "VOICE CAST — assign these voices: @Audio1.\n\nTIMED RENDER PLAN\n@Image1 crosses @Image2 and speaks with @Audio1. Use the selected references to lock identity, appearance variants, wardrobe, props and location geography.",
  [
    {kind:"image",tag:"@image1",label:"MARCUS TILLMON · Appearance: Night (v2)",referenceKind:"character"},
    {kind:"image",tag:"@image2",label:"Funeral Home Office · Shot coverage",referenceKind:"location"},
    {kind:"audio",tag:"@audio1",label:"MARCUS TILLMON line"}
  ]);
ok("text-only recovery preserves written entities while removing media tokens and locked-voice directions",
  !/@(?:Image|Video|Audio)\d+/i.test(textOnlyPrompt)
    &&!textOnlyPrompt.includes("VOICE CAST")
    &&textOnlyPrompt.includes("MARCUS TILLMON")
    &&textOnlyPrompt.includes("Funeral Home Office")
    &&textOnlyPrompt.includes("no source media is attached"));
ok("text-only recovery is a user action and never an automatic provider retry",
  source.includes('"Retry from text only · "+totalCost+" credit"')
    &&source.includes("onGenerate({referenceFree:true})")
    &&source.includes("textOnly:referenceFree"));
ok("video transport routes an explicit media-free attempt to Seedance text-to-video",
  videoSource.includes('const VID25_MODEL_T2V      = "bytedance/seedance-2.5/text-to-video"')
    &&videoSource.includes("const textOnly = !!opts.textOnly")
    &&videoSource.includes("textOnly && (images.length || videos.length || audios.length)")
    &&proxySource.includes('"bytedance/seedance-2.5/text-to-video"'));
ok("required reference errors guard UI and final paid submission",
  source.includes("referenceWarningGroups.filter(w=>w&&w.blocking)")
    &&source.includes('key:\"required-reference\"')
    &&source.includes("if(referenceBlockingWarnings.length&&!referenceFree) throw new Error(referenceBlockMessage)"));
const compactReferenceIssues=box.stageGroupReferenceIssues([
  {groupKey:"missing|marcus:night",message:"Required appearance is unavailable",blocking:true,shotN:3},
  {groupKey:"missing|marcus:night",message:"Required appearance is unavailable",blocking:true,shotN:1},
  {groupKey:"missing|marcus:night",message:"Required appearance is unavailable",blocking:true,shotN:2},
]);
ok("required reference blocker identifies one asset across a compact shot range",
  compactReferenceIssues.length===1
    &&compactReferenceIssues[0].message==="Required appearance is unavailable. Affects Shots 1–3."
    &&source.includes("Continuity · appearance states"));
ok("legacy cast masters cannot auto-replace resolved appearance variants",
  !source.includes('d.cast.forEach(c=>{ const u=imgs[c.id]; out.push')
    &&source.includes("Active character/location/prop rows come exclusively from the authoritative"));
ok("matching scene-only masters are promoted only for authoritative descriptors",
  source.includes('a&&a.sceneOnly&&a.kind===\"image\"&&a.id===id')
    &&source.includes("out[sceneIdx]=resolved"));
ok("failed Stage image chips rehydrate the same stored asset instead of regenerating",
  source.includes("nbRefreshImage(a.id,a.url)")
    &&imageSource.includes("function nbRefreshImage(id, failedUrl)")
    &&imageSource.includes('detail:{ ids:[id], refreshed:true }'));
const mentionCtx=box.stagePromptMentionContext([
  {key:"frame",kind:"image",label:"Marcus — shot frame",tag:"@image1",id:"shot-1"},
  {key:"resolved:characters:marcus:state",kind:"image",label:"Marcus · Appearance: Rain coat (v2)",
    tag:"@image2",id:"marcus:state",entityId:"marcus",referenceKind:"character",stateId:"state",referenceResolved:true},
  {key:"c:marcus",kind:"image",label:"Marcus · Master reference",tag:"@image3",id:"marcus",
    entityId:"marcus",referenceKind:"character",sceneOnly:true},
],{cast:[{id:"marcus",name:"Marcus"}],props:[]});
ok("active identity variant wins over optional master and named frame",mentionCtx.character({id:"marcus",name:"Marcus"})==="@Image2");
const frameOnly=box.stagePromptMentionContext([
  {key:"frame",kind:"image",label:"Marcus — shot frame",tag:"@image1",id:"shot-1"},
],{cast:[{id:"marcus",name:"Marcus"}],props:[]});
ok("bare character name never binds to a shot frame",frameOnly.character({id:"marcus",name:"Marcus"})==="");
const ambiguous=box.stagePromptMentionContext([
  {key:"resolved:characters:m:s1",kind:"image",tag:"@image1",entityId:"m",referenceKind:"character",referenceResolved:true},
  {key:"resolved:characters:m:s2",kind:"image",tag:"@image2",entityId:"m",referenceKind:"character",referenceResolved:true},
  {key:"c:m",kind:"image",tag:"@image3",entityId:"m",referenceKind:"character",sceneOnly:true},
],{cast:[{id:"m",name:"M"}],props:[]});
ok("multiple active variants do not guess a bare identity token",ambiguous.character({id:"m",name:"M"})==="");
ok("needed image memo tracks character state contents and scene order",
  source.includes("const sceneOrderKey")&&source.includes("st.sceneId,st.change,st.version,st.updatedAt"));
const includedAssets=[
  {key:"frame",kind:"image"},
  {key:"master",kind:"image",sceneOnly:true},
  {key:"active-a",kind:"image"},
  {key:"active-b",kind:"image"},
  {key:"room",kind:"image"},
];
const isIncluded=a=>a.key!=="master";
ok("off scene master gets the actual appended tail token",
  box.stageProspectiveMentionToken(includedAssets[1],includedAssets,isIncluded)==="@Image5");
const includedChip={assetKey:"room",t:"@Image5",included:true,label:"Living room"};
const futureMaster={assetKey:"master",t:"@Image5",included:false,label:"Marcus · Master reference"};
ok("prospective options never overwrite an included chip lookup",
  box.stageIncludedMentionMap([includedChip,futureMaster])["@image5"]===includedChip);
ok("chip swaps include prospective assets before changing text",
  source.includes("if(includeMention && !includeMention(m))")&&source.includes("if(!changed&&m.included===false&&onChange)onChange(cur,null)"));

// Exercise the real application mutation boundary, not a fixture's permissive
// callback: view-only controls also have to resist stale/programmatic invocations.
const appSource=readFileSync("app/app.jsx","utf8");
const writerSource=appSource.slice(appSource.indexOf("  const updateShot = "),appSource.indexOf("  const deleteShot = "));
let guardAllowed=false,guardWrites=0,guardShots=[{id:"guard-shot",dur:4}];
const guardBox={
  canMutateSharedFilm:()=>guardAllowed,
  setShots:fn=>{guardWrites++;guardShots=fn(guardShots);},
};
vm.createContext(guardBox);
vm.runInContext(writerSource+"\nthis.writeShot=updateShot;",guardBox);
guardBox.writeShot("guard-shot",{stageCharacterReferenceOverrides:{char:"master"}});
ok("view-only application shot writer refuses mutation",guardWrites===0&&!guardShots[0].stageCharacterReferenceOverrides);
guardAllowed=true;
guardBox.writeShot("guard-shot",{stageCharacterReferenceOverrides:{char:"master"}});
ok("editor application shot writer persists the master choice",guardWrites===1&&guardShots[0].stageCharacterReferenceOverrides.char==="master"&&guardShots[0].dur===4);
guardAllowed=false;
guardBox.writeShot("guard-shot",{stageCharacterReferenceOverrides:{}});
ok("revoked editor cannot reset via a captured shot callback",guardWrites===1&&guardShots[0].stageCharacterReferenceOverrides.char==="master");
ok("Stage receives the current room-wide read-only state",appSource.includes("readOnly:roomReadOnly,")&&source.includes("creditBalance, readOnly, onVoiceLine, onUpdateShot"));

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

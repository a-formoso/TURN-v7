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
for(const file of ["app/stage-plan.jsx","app/stage-references.jsx","app/stage.jsx"])
  vm.runInContext(readFileSync(file,"utf8"),box,{filename:file});

let pass=0,fail=0;
function ok(name,value,detail=""){if(value)pass++;else{fail++;console.error("FAIL "+name+(detail?" — "+detail:""));}}

const shots=[
  {id:"a",sceneId:"s",beatN:1,dur:8,covers:[1],beatPlan:{micro:["Open the door","See the letter"]},action:"Door opens"},
  {id:"b",sceneId:"s",beatN:1,dur:8,covers:[2],beatPlan:{micro:["Open the door","See the letter"]},dialogue:"It is here"},
  {id:"c",sceneId:"s",beatN:2,dur:5,covers:[1],beatPlan:{micro:["Mara runs"]},action:"Mara runs"},
];
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
ok("render metadata carries plan and reference provenance",source.includes("renderPlan,")&&source.includes("referenceSourceVersions"));
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

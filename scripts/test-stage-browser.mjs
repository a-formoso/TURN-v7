#!/usr/bin/env node
/*
 * Focused browser regression for the real StageView/ClipConsole.
 *
 * This is deliberately not a saved-film walkthrough.  It builds an isolated page in
 * /tmp from the current Stage sources, mounts StageView with synthetic story data, and
 * replaces every persistence/provider boundary with deterministic in-memory fixtures.
 * No application server, login, project, cloud row, or paid media endpoint is used.
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {spawn, spawnSync} from "node:child_process";
import {transformSync} from "@babel/core";

/*
 * Node 20 keeps the native WebSocket client behind --experimental-websocket.
 * Re-enter this same script with that flag so `node scripts/test-stage-browser.mjs`
 * is independently runnable; the child inherits the caller's stdio and status.
 * Do this before opening any fixture/server resources so a retry cannot leave a
 * partially prepared browser run behind.
 */
if (typeof globalThis.WebSocket === "undefined") {
  const websocketFlag="--experimental-websocket";
  const retried=process.execArgv.includes(websocketFlag);
  if (retried) {
    console.error("Stage browser regression requires Node's native WebSocket, but --experimental-websocket did not expose global WebSocket.");
    process.exit(1);
  }
  const major=Number(String(process.versions.node||"0").split(".")[0]);
  if (!Number.isFinite(major) || major<20) {
    console.error(`Stage browser regression requires Node 20+ with native WebSocket support (found ${process.versions.node||"unknown"}).`);
    process.exit(1);
  }
  const child=spawnSync(process.execPath,[websocketFlag,...process.argv.slice(1)],{
    stdio:"inherit",
    env:process.env
  });
  if (child.error) {
    console.error(`Could not relaunch Stage browser regression with ${websocketFlag}: ${child.error.message}`);
    process.exit(1);
  }
  if (child.status===9) {
    console.error(`This Node binary does not support ${websocketFlag}; use Node 20+ with the native WebSocket runtime.`);
    process.exit(1);
  }
  process.exit(child.status==null ? 1 : child.status);
}

const ROOT = new URL("../", import.meta.url);
const FIXTURE = "/tmp/fixture/browserfiles";
const SHOTS = ["stage-plan", "stage-references", "stage", "stage-screenplay-ui"];
const SHARED_SCREENPLAY = ["shot-screenplay", "shot-scene-context", "stage-screenplay",
  "stage-screenplay-images"];
const STAGE_DIRECTOR_BRIEF = "stage-director-brief";
const CHROME = process.env.CHROMIUM || "/repl/tools/bin/chromium";
const OUT = process.env.STAGE_BROWSER_OUT || `${FIXTURE}/screenshots`;
const reactUrls = {
  "react.js": "https://unpkg.com/react@18.3.1/umd/react.development.js",
  "react-dom.js": "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js",
};

async function prepareFixture() {
  await mkdir(FIXTURE, {recursive:true});
  await mkdir(OUT, {recursive:true});
  let css;
  try { css=await readFile(new URL("app/styles.css", ROOT)); }
  catch { css=await readFile(new URL("dist/app/styles.css", ROOT)); }
  await writeFile(`${FIXTURE}/styles.css`, css);
  await writeFile(`${FIXTURE}/stage-screenplay.css`,
    await readFile(new URL("app/stage-screenplay.css", ROOT)));
  /*
   * Keep actual PNG resources in the isolated fixture for historical take
   * references.  The live Stage composer still exercises the synchronous
   * canvas helper below and launches its own source-signed PNG data URLs.
   */
  const screenplayPng=await readFile(new URL("attached_assets/targeted_element_1789430976412.png", ROOT));
  for (const name of ["screenplay-page-beat-1.png","screenplay-page-beat-2.png","screenplay-page-scene-2.png"])
    await writeFile(`${FIXTURE}/${name}`, screenplayPng);
  for (const name of SHOTS) {
    /*
     * Prefer a raw Babel transform over a stale checked-in bundle. This keeps
     * the browser fixture on the live Stage/UI source while the app build
     * cache is being refreshed; dist remains a fallback for a source-only
     * deployment artifact.
     */
    try {
      const source = await readFile(new URL(`app/${name}.jsx`, ROOT), "utf8");
      const out = transformSync(source, {
        presets:[["@babel/preset-react",{runtime:"classic"}]],
        plugins:["@babel/plugin-transform-block-scoping"],
        comments:false, compact:false, babelrc:false, configFile:false, filename:`${name}.jsx`,
      });
      await writeFile(`${FIXTURE}/${name}.js`, out.code);
      continue;
    } catch {}
    try {
      const built=await readFile(new URL(`dist/app/${name}.js`, ROOT));
      if(built.length){await writeFile(`${FIXTURE}/${name}.js`,built);continue;}
    } catch {}
  }
  /*
   * Stage screenplay is deliberately loaded from the current source rather than
   * replaced with a fixture shim.  The browser regression must exercise the same
   * shot-screenplay + full-scene-context contract used by the live composer.
   */
  for (const name of SHARED_SCREENPLAY) {
    const source = await readFile(new URL(`app/${name}.js`, ROOT));
    await writeFile(`${FIXTURE}/${name}.js`, source);
  }
  /* The default director brief is a lazy Stage helper and must precede stage.js. */
  await writeFile(`${FIXTURE}/${STAGE_DIRECTOR_BRIEF}.js`,
    await readFile(new URL(`app/${STAGE_DIRECTOR_BRIEF}.js`, ROOT)));
  for (const [name,url] of Object.entries(reactUrls)) {
    try {
      const existing = await readFile(`${FIXTURE}/${name}`);
      if (existing.length > 10_000) continue;
    } catch {}
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not cache ${url}: HTTP ${response.status}`);
    await writeFile(`${FIXTURE}/${name}`, Buffer.from(await response.arrayBuffer()));
  }
  await writeFile(`${FIXTURE}/index.html`, fixtureHtml());
}

function fixtureHtml() {
  return `<!doctype html>
<html data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/stage-screenplay.css">
<style>html,body,#root{height:100%;margin:0} body{background:#f4f1ea}</style>
</head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
/* Deterministic browser-only boundaries. Every call is recorded for assertions. */
window.__fixture={calls:[],loadCalls:[],imageOverrides:{},refreshResults:{},refreshCalls:[],delayedImages:{},updates:[],confirms:[],toasts:[],errors:[],consoleErrors:[],adoptTakes:[],proxyKnown:false,lastRuntimeCapabilities:null,
  variantLoaded:false,policyRefusal:false,hardRemounts:0,genEvents:0};
window.addEventListener("nb-gen-done",()=>__fixture.genEvents++);
const __fixtureConsoleError=console.error.bind(console);
console.error=(...args)=>{
  __fixture.consoleErrors.push(args.map(x=>{
    try{return typeof x==="string"?x:JSON.stringify(x);}
    catch(_e){return String(x);}
  }).join(" "));
  __fixtureConsoleError(...args);
};
window.addEventListener("error",e=>__fixture.errors.push(String(e.error&&e.error.stack||e.message||e)));
window.addEventListener("unhandledrejection",e=>__fixture.errors.push(String(e.reason&&e.reason.stack||e.reason||e)));
const px="data:image/svg+xml;charset=utf-8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="%232e4251"/><circle cx="92" cy="90" r="42" fill="%23d6aa76"/><path d="M150 65h125v50H150z" fill="%2388a6a1"/></svg>');
const fakeVideo="data:video/mp4;base64,AAAA";
window.Icon=new Proxy({}, {get:(_,name)=>({s=14})=>React.createElement("svg",{"data-icon":String(name),width:s,height:s,viewBox:"0 0 10 10"},React.createElement("circle",{cx:5,cy:5,r:3,fill:"currentColor"}))});
window.CLIP_MAX_SECONDS=15; window.CLIP_MAX_SHOTS=3; window.CLIP_MAX_DIALOGUE=10;
window.STAGE_MS_STEPS=[4,8,12,15];
window.SHOT_CAMERA_PROFILES=[{id:"auto",label:"Project default / None",desc:"fixture"}];
window.scenesInStoryOrder=a=>(a||[]).slice().sort((a,b)=>(a.no||0)-(b.no||0));
window.aspectFor=()=>"16:9"; window.clipMaxFor=()=>15;
window.stageShotRuntime=s=>Number(s&&s.dur)||2;
window.shotDur=window.stageShotRuntime;
window.shotGrammarLabel=s=>s.camera||"locked camera";
window.shotSizeOf=v=>({label:v||"Medium"});
window.shotAngleOf=v=>({label:v||"Eye level"});
window.shotMoveOf=v=>({label:v||"Static"});
window.shotLensOf=v=>({label:v||"50mm"});
window.inFrameCast=s=>s.referenceCharactersSet?(s.referenceCharacterIds||[]):(s.subjects||[]);
window.inFrameProps=s=>s.props||[];
window.scanTextForChars=(text,chars)=>(chars||[]).filter(c=>String(text).toLowerCase().includes(c.name.toLowerCase())).map(c=>c.id);
window.locationForScene=(locs,id)=>(locs||[]).find(l=>(l.scenes||[]).includes(id))||null;
window.sceneRoster=(scene,chars,drafts,shots)=>Array.from(new Set((shots||[]).flatMap(s=>s.subjects||[])));
/* Match the production pinned-story-order resolver. The initial character has no
   states so the earlier coverage remains a base/master-reference scenario. */
window.activeStateForScene=(character,scene,scenes)=>{
  const states=character.states||[];
  if(!states.length||!scene)return {version:1,state:null};
  const idxOf=id=>(scenes||[]).findIndex(s=>s.id===id);
  const sceneIdx=idxOf(scene.id);
  if(sceneIdx<0)return {version:1,state:null};
  let best=null,bestPos=-1,bestVersion=1;
  states.forEach((st,i)=>{
    if(!st.sceneId)return;
    const pos=idxOf(st.sceneId);
    if(pos>=0&&pos<=sceneIdx&&pos>=bestPos){best=st;bestPos=pos;bestVersion=i+2;}
  });
  return {version:bestVersion,state:best};
};
window.sceneContinuityLedger=()=>({});
window.scenePreset=()=>({name:"Natural cinema",grade:"Cool dusk",lighting:"Cool dusk with warm practicals"});
window.shotLocationCoverageSpecs=()=>[];
window.propStateAt=(p)=>({active:true,referenceAssetId:p.id,condition:"intact",holderName:"Mara",bindingMode:"carried"});
window.shotPropSheetId=p=>({id:p.id,state:null});
window.custodyOwnerAt=p=>({name:p.ownerName||"Mara",handover:null});
window.sbPageRanges=shots=>[{start:0,count:shots.length}];
window.clipStableId=(scene,shots)=>"clip-"+scene+"-"+shots.map(s=>s.id).join("-");
window.clipVidId=(scene,i)=>"legacy-"+scene+"-"+i;
window.sceneSequences=(shots,max,opts)=>shots.map((s,i)=>({index:i,start:i,shots:[s],dur:s.dur,beatN:s.beatN}));
window.screenplayBeatTitle=()=>"The handoff";
window.appToast=(...a)=>window.__fixture.toasts.push(a);
window.appConfirm=async o=>(window.__fixture.confirms.push(o),true);
window.confirm=()=>true;
window.turnVideoCreditRates=()=>({"480p":0.75,"720p":1.6,"1080p":2.4,"4K":5});
/* Motion Control price + device staging helpers (videogen.jsx is not loaded here). */
window.turnVideoCreditRate=(modelId,tier,res)=>modelId==="kling-3.0-motion-control"?(tier==="pro"?0.56:0.42):null;
window.vidStagingCapability=caps=>!!(caps&&caps.staging&&caps.staging.signedUpload&&caps.staging.scheme==="stage:");
window.vidMotionControlLimits=o=>({minSeconds:3,maxSeconds:o==="image"?10:30,maxBytes:200*1024*1024});
window.vidStageDeviceMedia=async()=>{ throw new Error("fixture: device staging is not exercised here"); };
/* Take picks are MEASURED before they can be priced: the probe stays pending until the
   test releases it, so the unpriced (blocked) state is observable. */
window.__fixture.measured=[]; window.__fixture.measurePending=[];
window.vidMediaFacts=(url,kind)=>new Promise(res=>{ window.__fixture.measured.push(String(url));
  window.__fixture.measurePending.push(()=>res({durationSeconds:10,sizeBytes:4,mime:"video/mp4"})); });
window.__fixture.releaseMeasure=()=>{ const q=window.__fixture.measurePending.splice(0); q.forEach(f=>f()); return q.length; };
window.turnTierGates=()=>null;
window.seedanceCapabilities=()=>({references:{audios:{maxFiles:10}}});
/* Starts unknown; the test later advertises the exact known-proxy transport shape. */
window.seedanceGetRuntimeCapabilities=async target=>{
  if(!__fixture.proxyKnown)return {known:false,capabilities:null,reason:"fixture proxy version unknown",target};
  const motion=String(target||"").indexOf("/motion-control")>0;
  const capabilities=motion
    ? { characterOrientations:["image","video"], motionVideo:{minSeconds:3,maxSecondsByOrientation:{image:10,video:30}}, staging:{signedUpload:true,scheme:"stage:"} }
    : {
    resolutions:["480p","720p","1080p"],
    directAudioFiles:10,
    references:{audios:{maxFiles:10}},
    tasks:["reference","editing","extension"],
    staging:{signedUpload:true,scheme:"stage:",maxBytes:{video:200*1024*1024,image:30*1024*1024,audio:15*1024*1024}}
  };
  if(!motion) __fixture.lastRuntimeCapabilities=capabilities;
  return {known:true,capabilities,target};
};
window.useSeedanceGen=id=>{
  const [err,setErr]=React.useState(null);
  return {
    videoUrl:"",gening:false,status:"",err:__fixture.policyRefusal?err:null,
    generate:async payload=>{
      window.__fixture.calls.push(["generate",id,payload]);setErr(null);
      if(__fixture.policyRefusal){
        const error=new Error("policy refusal: character reference rejected");
        setErr(error);throw error;
      }
      return {url:fakeVideo,seed:4242};
    },
    generateBatch:async(payload,n)=>(window.__fixture.calls.push(["batch",id,n,payload]),[]),
    cancel:()=>window.__fixture.calls.push(["cancel",id])
  };
};
window.nbGetImage=id=>Object.prototype.hasOwnProperty.call(__fixture.imageOverrides,id)
  ?__fixture.imageOverrides[id]:(
  (id==="char-mara:wardrobe"&&!__fixture.variantLoaded)||id==="char-mara:storm"
)?"":px;
window.nbLoadImage=async id=>{
  __fixture.loadCalls.push(id);
  if(__fixture.delayedImages[id]){
    await new Promise(resolve=>setTimeout(resolve,200));
    __fixture.imageOverrides[id]=__fixture.delayedImages[id];
    return __fixture.delayedImages[id];
  }
  if(id==="char-mara:storm"){
    await new Promise(resolve=>setTimeout(resolve,120));
    return px;
  }
  return window.nbGetImage(id);
};
window.nbRefreshImage=async(id,url)=>{
  __fixture.refreshCalls.push([id,url||""]);
  await new Promise(resolve=>setTimeout(resolve,100));
  if(Object.prototype.hasOwnProperty.call(__fixture.refreshResults,id)){
    const result=__fixture.refreshResults[id];
    if(result==="THROW")throw new Error("Fixture network unavailable");
    __fixture.imageOverrides[id]=result;
  }
  return window.nbGetImage(id);
};
window.nbRemoteImageUrl=async id=>window.nbGetImage(id);
window.nbGetMeta=id=>{
  const iso="iso-"+id;
  if(id==="prop-letter")return {iso,version:1,approval:{approved:false,iso}};
  return {iso,version:id==="char-mara:wardrobe"?2:1,approval:{approved:true,iso}};
};
window.nbAssetApproval=m=>!!(m&&m.iso&&m.approval&&m.approval.approved&&m.approval.iso===m.iso);
window.vidLikenessError=msg=>/policy refusal|character reference/i.test(String(msg||""));
window.vgGetAudio=()=>""; window.vgLoadAudio=async()=>"";
window.vidAdoptTakes=async(...args)=>(__fixture.adoptTakes.push(args),null);
window.shotSourcesStatus=(shots,drafts,meta)=>meta&&meta.fixtureStale?"stale":"current";
window.shotSourcesEditorialStatus=window.shotSourcesStatus;
window.shotSourcesSnapshot=()=>[{id:"fixture-source",revision:"current"}];
window.shotSourcesFromMeta=()=>[];
window.stageReferenceStatus=({imageId})=>imageId==="prop-letter"
  ? {stale:true,approved:false,missing:false,excluded:false}
  : {stale:false,approved:true,missing:false,excluded:false};
const takeMeta=(stale)=>({
  model:"bytedance/seedance-2.5/reference-to-video",source:"frames",durationSec:10,
  inputs:"5 images",audio:"native",tierLabel:"Standard",resolution:"720p",bitrate:"standard",
  recipe:"timeline",seed:4242,createdAt:stale?1700000002000:1700000001000,
  status:stale?"draft":"approved",fixtureStale:stale,
  prompt:"Fixture take prompt: Mara crosses the room and lifts the letter.",
  references:[{tag:"@Image1",label:"Mara reference",kind:"image",url:px,assetId:"char-mara",role:"identity",
      referenceKind:"character"},
    {tag:"@Image2",label:"Letter continuity",kind:"image",url:px,assetId:"prop-letter",role:"prop state",
      referenceKind:"prop"},
    {tag:"@Image3",label:"Scene 1 · Beat 1 screenplay page",kind:"image",
      url:"/screenplay-page-beat-1.png",role:"screenplay",referenceKind:"screenplay",locked:true,
      page:1,totalPages:1,sourceSignature:"fixture-screenplay-v1",targetBeats:[1]},
    {tag:"@Image4",label:"Scene 1 · Beat 2 screenplay page",kind:"image",
      url:"/screenplay-page-beat-2.png",role:"screenplay",referenceKind:"screenplay",locked:true,
      page:1,totalPages:1,sourceSignature:"fixture-screenplay-v1",targetBeats:[2]},
    {tag:"@Image5",label:"Scene 2 · Beat 1 screenplay page",kind:"image",
      url:"/screenplay-page-scene-2.png",role:"screenplay",referenceKind:"screenplay",locked:true,
      page:1,totalPages:1,sourceSignature:"fixture-screenplay-v1",targetBeats:[1]}],
  referenceSourceVersions:[{assetId:stale?"prop-letter":"char-mara",snapshot:{version:1}}]
});
window.__takes=[
  {id:"take-new",url:fakeVideo+"#new",current:true,meta:takeMeta(true)},
  {id:"take-approved",url:fakeVideo+"#approved",current:false,meta:takeMeta(false)}
];
window.vidGetTakes=()=>window.__takes.slice(); window.vidLoadTakes=async()=>window.__takes.slice();
window.vidGetVideo=()=>fakeVideo+"#new"; window.vidLoadVideo=async()=>fakeVideo+"#new";
window.vidGetMeta=()=>takeMeta(true);
for(const n of ["vidApproveTake","vidRestoreTake","vidDeleteTake","vidUpdateTake"])
  window[n]=async(...args)=>window.__fixture.calls.push([n,...args]);
</script>
<script src="/shot-screenplay.js"></script><script src="/shot-scene-context.js"></script><script src="/stage-screenplay.js"></script>
<script src="/stage-screenplay-images.js"></script>
<script src="/stage-screenplay-ui.js"></script>
<script src="/stage-plan.js"></script><script src="/stage-references.js"></script>
<script src="/stage-director-brief.js"></script><script src="/stage.js"></script>
<script>
window.turnContinuity={shots:[],drafts:{},props:[],scenes:[],characters:[],locations:[],beatsMap:{},project:null};
window.__story={
 project:{id:"fixture-film",title:"Synthetic Stage Browser Fixture",format:{aspect:"16:9"}},
 scenes:[
  {id:"scene-1",no:1,title:"The Letter",loc:"INT. OBSERVATORY · NIGHT",order:1},
  {id:"scene-2",no:2,title:"The Landing",loc:"EXT. OBSERVATORY · DAWN",order:2}
 ],
 shots:[
   {id:"shot-a",sceneId:"scene-1",order:1,beatN:1,dur:4,subjects:["char-mara"],props:["prop-letter"],
     speaker:"char-mara",dialogue:"The seal is unbroken.",
   size:"Wide",angle:"Eye level",move:"Slow push",lens:"35mm",action:"Mara crosses to the brass desk.",
   beatPlan:{micro:["Mara crosses to the brass desk.","She ignores the ringing telephone."],protect:"The letter changes hands."},covers:[1]},
   {id:"shot-b",sceneId:"scene-1",order:2,beatN:1,dur:6,subjects:["char-mara"],props:["prop-letter"],
   size:"Close-up",angle:"High",move:"Static",lens:"85mm",action:"Mara lifts the sealed letter into moonlight.",
    beatPlan:{micro:["Mara lifts the sealed letter into moonlight.","The window suddenly breaks."],protect:"The letter changes hands."},covers:[1]},
   {id:"shot-c",sceneId:"scene-1",order:3,beatN:2,dur:5,subjects:["char-mara"],props:["prop-letter"],
    size:"Medium",angle:"Eye level",move:"Static",lens:"50mm",action:"Mara carries the letter to the observatory window.",
    beatPlan:{micro:["Mara carries the letter to the observatory window."],protect:"The letter changes hands."},covers:[1]},
   {id:"shot-d",sceneId:"scene-2",order:1,beatN:1,dur:5,keyframeMode:"beat-opening",subjects:["char-mara"],props:[],
    size:"Wide",angle:"Eye level",move:"Slow push",lens:"35mm",action:"Mara steps onto the landing at dawn.",
    beatPlan:{micro:["Mara steps onto the landing at dawn."],protect:"Mara reaches the outside door."},covers:[1]}
 ],
  characters:[{id:"char-mara",name:"Mara",states:[]}],
  locations:[
   {id:"loc-observatory",name:"Old Observatory",scenes:["scene-1"]},
   {id:"loc-landing",name:"Observatory Landing",scenes:["scene-2"]}
  ],
 props:[{id:"prop-letter",name:"Sealed Letter",ownerId:"char-mara",ownerName:"Mara",kind:"carried"}],
  beatsMap:{
   "scene-1":{rows:[
    {n:1,drive:{d:"Mara reaches the desk"},react:{d:"She studies the seal"}},
    {n:2,drive:{d:"Mara takes the letter to the window"},react:{d:"The dawn reveals its mark"}}
   ]},
   "scene-2":{rows:[{n:1,drive:{d:"Mara reaches the landing"},react:{d:"The outside door opens"}}]}
  },
  drafts:{
   "scene-1":{version:"fixture-v1",blocks:[
    {beat:1,type:"scene",text:"INT. OBSERVATORY · NIGHT"},
    {beat:1,type:"action",text:"Mara crosses to the brass desk."},
    {beat:1,type:"action",text:"Mara lifts the sealed letter into moonlight."},
    {beat:1,type:"char",text:"MARA"},
    {beat:1,type:"dia",text:"The seal is unbroken."},

    {beat:2,type:"action",text:"Mara carries the letter to the observatory window."},
    {beat:2,type:"char",text:"MARA"},
    {beat:2,type:"dia",text:"Dawn will tell us who sent it."}
   ]},
   "scene-2":{version:"fixture-v1",blocks:[
    {beat:1,type:"scene",text:"EXT. OBSERVATORY · DAWN"},
    {beat:1,type:"action",text:"Mara steps onto the landing at dawn."},
    {beat:1,type:"char",text:"MARA"},
    {beat:1,type:"dia",text:"The night is finally over."},
    {beat:1,type:"char",text:"MARA"},
    {beat:1,type:"dia",text:"Yes."},
    {beat:1,type:"char",text:"MARA"},
    {beat:1,type:"dia",text:"Yes."}
   ]}
  }
};
window.__validScene1Draft=JSON.parse(JSON.stringify(__story.drafts["scene-1"]));
window.__validScene2Draft=JSON.parse(JSON.stringify(__story.drafts["scene-2"]));
turnContinuity.shots=__story.shots;turnContinuity.drafts=__story.drafts;turnContinuity.props=__story.props;
turnContinuity.scenes=__story.scenes;turnContinuity.characters=__story.characters;
turnContinuity.locations=__story.locations;turnContinuity.beatsMap=__story.beatsMap;
turnContinuity.project=__story.project;
let fixtureRoot=ReactDOM.createRoot(document.getElementById("root"));
function mount(){
 fixtureRoot.render(React.createElement(StageView,{
  ...__story,creditBalance:{remaining:99},
   onUpdateShot:(id,patch)=>{__fixture.updates.push([id,patch]);__story={...__story,shots:__story.shots.map(s=>s.id===id?{...s,...patch}:s)};turnContinuity.shots=__story.shots;mount();},
  onVoiceLine:async()=>{},onStageNav:x=>__fixture.calls.push(["nav",x])
 }));
}
window.__hardRemount=()=>{__fixture.hardRemounts++;fixtureRoot.unmount();document.getElementById("root").replaceChildren();fixtureRoot=ReactDOM.createRoot(document.getElementById("root"));mount();};
/* A normal React prop/story update, deliberately preserving character ids and the
   mounted StageView. Used to prove state assignment changes invalidate dependencies. */
window.__setCharacterStates=states=>{
  window.__story={...window.__story,characters:window.__story.characters.map(c=>
    c.id==="char-mara"?{...c,states:states.map(s=>({...s}))}:c)};
  mount();
};
window.__setDraft=(sceneId,draft)=>{
  const next={...(__story.drafts||{})};
  if(draft==null) delete next[sceneId]; else next[sceneId]=JSON.parse(JSON.stringify(draft));
  window.__story={...window.__story,drafts:next};
  turnContinuity.drafts=next;
  mount();
};
window.__setScene1Beat2Text=text=>{
  const draft=JSON.parse(JSON.stringify(window.__validScene1Draft));
  const block=draft.blocks.find(b=>Number(b.beat)===2&&b.type==="action");
  if(block) block.text=String(text||"");
  window.__setDraft("scene-1",draft);
};
window.__setReadOnly=readOnly=>{
  window.__story={...window.__story,readOnly:!!readOnly};
  mount();
};
mount();
</script></body></html>`;
}

function staticServer() {
  return createServer(async (req,res)=>{
    const path = new URL(req.url, "http://fixture").pathname;
    const name = path === "/" ? "index.html" : path.slice(1);
    if (!/^[a-z0-9._-]+$/i.test(name)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(`${FIXTURE}/${name}`);
       const type = name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css"
         :name.endsWith(".png")?"image/png":"text/javascript";
      res.writeHead(200,{"content-type":`${type}; charset=utf-8`,"cache-control":"no-store"}).end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
}

class CDP {
  constructor(ws) { this.ws=ws; this.seq=0; this.pending=new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
    const c=new CDP(ws);
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.pending.has(m.id)){const [ok,bad]=c.pending.get(m.id);c.pending.delete(m.id);m.error?bad(new Error(m.error.message)):ok(m.result);}};
    return c;
  }
  call(method,params={}) { const id=++this.seq; this.ws.send(JSON.stringify({id,method,params})); return new Promise((a,b)=>this.pending.set(id,[a,b])); }
  async eval(expression) {
    const r=await this.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  }
  close(){this.ws.close();}
}

async function waitFor(fn, label, ms=10_000) {
  const end=Date.now()+ms; let last;
  while(Date.now()<end){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,80));}
  throw new Error(`Timed out waiting for ${label}${last?`: ${last}`:""}`);
}

async function main() {
  await prepareFixture();
  const server=staticServer();
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const port=server.address().port, debugPort=9300+Math.floor(Math.random()*400);
  const profile=`${FIXTURE}/chromium-profile-${process.pid}`;
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox","--disable-gpu",`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
  let c;
  const regressions=[];
  try {
    const target=await waitFor(async()=>{
      const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if(!r.ok)return null;
      const list=await r.json();
      return list.find(x=>x.type==="page"&&x.webSocketDebuggerUrl);
    },"Chromium page target");
    c=await CDP.connect(target.webSocketDebuggerUrl);
    await c.call("Page.enable"); await c.call("Runtime.enable");
    await c.call("Page.navigate",{url:`http://127.0.0.1:${port}/`});
    try{
      await waitFor(()=>c.eval(`document.querySelector(".stage2-root")&&document.querySelector(".stage2-root").innerText.includes("Seedance 2.5")`),"StageView mount");
    }catch(e){
      const diag=await c.eval(`JSON.stringify({errors:(window.__fixture&&__fixture.errors)||[],consoleErrors:(window.__fixture&&__fixture.consoleErrors||[]).slice(0,5),root:!!document.querySelector(".stage2-root"),text:(document.querySelector(".stage2-root")||document.body).innerText.slice(0,1200)})`).catch(()=>"(no diag)");
      console.error("StageView mount diagnostics:",diag);
      throw e;
    }

    const text=()=>c.eval(`document.body.innerText`);
    const selectedModel=()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.trim()`);
    const settingsState=()=>c.eval(`(()=>({
      open:!!document.querySelector(".stage2-settings-drawer"),
      tab:[...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.classList.contains("on"))?.textContent.trim()||null
    }))()`);
    const restoreSettingsState=async(state)=>{
      if(state.open){
        if(state.tab && state.tab!=="Model")
          await c.eval(`([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.textContent.trim()===${JSON.stringify(state.tab)}))?.click()`);
        await waitFor(()=>c.eval(`document.querySelector(".stage2-settings-drawer")&&([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.classList.contains("on"))?.textContent.trim()||null)===${JSON.stringify(state.tab)}`),"restore Render settings tab");
      }else if(await c.eval(`!!document.querySelector(".stage2-settings-drawer")`)){
        await c.eval(`document.querySelector('button[title="Collapse render settings"]')?.click()`);
        await waitFor(()=>c.eval(`!document.querySelector(".stage2-settings-drawer")`),"restore collapsed Render settings");
      }
    };
    const openModelSettings=async(label)=>{
      const before=await settingsState();
      if(!before.open){
        await c.eval(`document.querySelector('button[title="Expand render settings"],.stage2-console .strip.right')?.click()`);
        await waitFor(()=>c.eval(`!!document.querySelector(".stage2-settings-drawer")`),`${label||"Stage"} Render settings`);
      }
      if((await c.eval(`([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.classList.contains("on"))?.textContent.trim()||"")`))!=="Model")
        await c.eval(`([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.textContent.trim()==="Model"))?.click()`);
      await waitFor(()=>c.eval(`!!document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]')`),`${label||"Stage"} Clip grouping control`);
      return before;
    };
    const readClipGrouping=async(label)=>{
      const before=await openModelSettings(label);
      const value=await c.eval(`document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]')?.value`);
      await restoreSettingsState(before);
      return value;
    };
    const chooseClipGrouping=async(value,label)=>{
      const before=await openModelSettings(label);
      const control=await c.eval(`(()=>{const s=document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]');return s&&{value:s.value,label:s.getAttribute("aria-label"),testid:s.dataset.testid,options:[...s.options].map(o=>({value:o.value,label:o.textContent.trim()}))};})()`);
      assert.ok(control,"Clip grouping control is mounted in Model > Advanced");
      assert.equal(control.label,"Clip grouping","Clip grouping select is accessible");
      assert.equal(control.testid,"stage-clip-grouping","Clip grouping select has the requested test id");
      assert.deepEqual(control.options.map(x=>x.value),["beat","shot","legacy"],"Clip grouping exposes only the supported scope values");
      assert.deepEqual(control.options.map(x=>x.label),["Fit beat","Single shot","Previous packing"],"Clip grouping labels describe the supported scope values");
      await c.eval(`(()=>{const s=document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()`);
      await waitFor(()=>c.eval(`document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]')?.value===${JSON.stringify(value)}`),`${label||"Stage"} Clip grouping selection`);
      const storageValue=value==="legacy"?"auto":value;
      await waitFor(()=>c.eval(`localStorage.getItem("turn_stage_clip_scope")===${JSON.stringify(storageValue)}`),`${label||"Stage"} Clip grouping persistence`);
      await restoreSettingsState(before);
      return value;
    };
    const chooseNativePerformance=async(label)=>{
      await c.eval(`([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.textContent.trim()==="Director"))?.click()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll("select")].some(s=>[...s.options].some(o=>o.value==="native"&&/Native performance/.test(o.textContent)))`),`${label||"Stage"} native-performance control`);
      await c.eval(`(()=>{const s=[...document.querySelectorAll("select")].find(x=>[...x.options].some(o=>o.value==="native"&&/Native performance/.test(o.textContent)));s.value="native";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll("select")].some(s=>s.value==="native"&&[...s.options].some(o=>o.value==="native"&&/Native performance/.test(o.textContent)))`),`${label||"Stage"} native-performance selection`);
    };
    assert.match(await selectedModel(),/Seedance 2\.5/,"new Stage defaults to Seedance 2.5");
    assert.equal(await c.eval(`!!document.querySelector('.stage2-console-composer button[title^="Clip scope"],.stage2-console-composer .sdbar-pill.scope')`),false,
      "composer no longer renders the redundant clip-scope pill");
    assert.equal(await readClipGrouping("initial"),"beat","new Stage defaults to beat grouping");
    await chooseNativePerformance("initial");

    const defaultPrompt=await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`);
    const defaultHeadings=[
      "BEAT CONTRACT","ACTIVE REFERENCES","SCENE AND OPENING STATE",
      "ACTION AND CAMERA PLAN","DIALOGUE AND SOUND","ENDING AND CONTINUITY LOCKS"
    ];
    assert.ok(defaultHeadings.every(h=>defaultPrompt.includes(h)),
      "default Stage prompt uses the approved director-brief headings");
    assert.ok(defaultHeadings.every((h,i)=>i===0||defaultPrompt.indexOf(h)>defaultPrompt.indexOf(defaultHeadings[i-1])),
      "default Stage director-brief headings remain in stable order");
    assert.equal(await c.eval(`typeof window.seedanceDirectorBrief`),"function",
      "browser fixture loads the lazy director-brief helper before Stage");

    const duration=await c.eval(`document.querySelector(".stage2-rendercard .stage2-control-row select")?.value || [...document.querySelectorAll(".stage2-rendercard select")].find(s=>[...s.options].some(o=>o.textContent.includes("10s")))?.value`);
    assert.equal(duration,"10","duration preview equals exact 4s + 6s coverage");
    const defaultDurationPrompt=defaultPrompt;
    await c.eval(`(()=>{
      const s=document.querySelector('.stage2-rendercard select[title="Clip duration"],.stage2-rendercard .stage2-control-row select');
      if(!s)return false;
      const option=[...s.options].find(o=>o.value==="12");
      if(!option)return false;
      s.value=option.value;s.dispatchEvent(new Event("change",{bubbles:true}));return true;
    })()`);
    await waitFor(()=>c.eval(`document.querySelector('.stage2-rendercard select[title="Clip duration"],.stage2-rendercard .stage2-control-row select')?.value==="12"`),
      "director-brief duration update");
    const durationPrompt=await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`);
    assert.match(durationPrompt,/\b12(?:\.0)?s\b/,"default director brief receives the actual selected duration");
    assert.notEqual(durationPrompt,defaultDurationPrompt,"an untouched default prompt recompiles for a duration change");
    /*
     * The old Render package / Exact queued render block was an implementation
     * preview, not an input the director could act on.  Stage now keeps the
     * authoritative screenplay through the shared source helper and sends the compiled
     * payload only at launch; neither stale preview may be presented as a
     * second source of truth.
     */
    assert.equal(await c.eval(`!!document.querySelector(".stage-render-plan")`),false,
      "Render package is not shown in the Stage composer");
    assert.equal(await c.eval(`!!document.querySelector(".stage-plan-queued")`),false,
      "Exact queued render Summary is not shown in the Stage composer");
    assert.doesNotMatch(await text(),/Render package|Exact queued render/i,
      "removed render previews do not leak into visible Stage text");
    const imageContract=await c.eval(`(()=>{
      const reference=window.stageScreenplayReference(__story.scenes[0],__story.shots.slice(0,2),{
        ...__story,drafts:__story.drafts,characters:__story.characters,beatsMap:__story.beatsMap
      });
      const result=window.stageScreenplayImages(reference);
      return {signature:result.signature,errors:result.errors,images:(result.images||[]).map(x=>({
        id:x.id,url:x.url,label:x.label,page:x.page,totalPages:x.totalPages,
        sourceSignature:x.sourceSignature,targetBeats:x.targetBeats
      }))};
    })()`);
    assert.ok(typeof imageContract.signature==="string"&&imageContract.signature,
      "screenplay image helper returns a source signature synchronously");
    assert.deepEqual(imageContract.errors,[],"screenplay image helper reports no fixture errors");
    assert.ok(imageContract.images.length>=1,"screenplay image helper returns at least one page");
    assert.ok(imageContract.images.every(x=>x.id&&/^data:image\/png;base64,/.test(x.url)
      &&x.label&&x.page>=1&&x.totalPages>=x.page&&x.sourceSignature&&Array.isArray(x.targetBeats)),
      "screenplay image helper returns complete real PNG page provenance");

    /*
     * Screenplay pages are ordinary locked reference cards in the main Stage
     * strip. The former expandable Scene screenplay disclosure is deliberately
     * absent; source text and target provenance are checked through the shared
     * helpers and the launch payload below.
     */
    const sceneOneScreenplay=await c.eval(`(()=>{
      const cards=[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')];
      return {
        disclosureCount:document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length,
        images:cards.map(x=>x.querySelector("img")?.src||""),
        cards:cards.map(x=>({
          src:x.querySelector("img")?.src||"",
          tag:x.querySelector(".stage2-gen-asset-tag")?.textContent||"",
          locked:x.classList.contains("locked")&&!x.classList.contains("off"),
          inStrip:x.parentElement?.classList.contains("stage2-gen-assets"),
          inDisclosure:!!x.closest("details")
        }))
      };
    })()`);
    assert.equal(sceneOneScreenplay.disclosureCount,0,
      "Stage no longer renders the expandable screenplay disclosure");
    assert.ok(sceneOneScreenplay.images.length>=1,"selected beat exposes required screenplay page cards");
    assert.ok(sceneOneScreenplay.images.every(x=>x.startsWith("data:image/png")),
      "screenplay page cards use real PNG references");
    const screenplayInput=await c.eval(`(()=>{
      const cards=[...document.querySelectorAll(".stage2-gen-assets .stage2-gen-asset")].filter(x=>
        x.getAttribute("data-reference-kind")==="screenplay");
      return {
        disclosureCount:document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length,
        cards:cards.map(x=>({
          src:x.querySelector("img")?.src||"",
          tag:x.querySelector(".stage2-gen-asset-tag")?.textContent||"",
          locked:x.classList.contains("locked")&&!x.classList.contains("off"),
          inStrip:x.parentElement?.classList.contains("stage2-gen-assets"),
          inDisclosure:!!x.closest("details")
        })),
        stripPngs:[...document.querySelectorAll(".stage2-gen-assets img")].map(x=>x.currentSrc||x.src)
      };
    })()`);
    assert.equal(screenplayInput.disclosureCount,0,
      "no screenplay disclosure is mounted beside the reference strip");
    assert.ok(screenplayInput.cards.length>0,"screenplay screenshots are ordinary reference-image cards");
    assert.equal(screenplayInput.cards.length,imageContract.images.length,
      "every generated screenplay page has one locked strip card");
    assert.deepEqual(screenplayInput.cards.map(x=>x.src),imageContract.images.map(x=>x.url),
      "strip cards retain the exact PNGs returned by the screenplay image helper");
    assert.ok(screenplayInput.cards.every(x=>x.src.startsWith("data:image/png")
      &&/^@Image\d+$/.test(x.tag)&&x.locked&&x.inStrip&&!x.inDisclosure),
      "actual page PNGs are locked, tagged image references directly in the main image strip");
    const screenplayCardSources=()=>c.eval(`([...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||""))`);
    const screenplayPlacement=await c.eval(`(()=>{
      const page=document.querySelector('.stage2-gen-assets [data-reference-kind="screenplay"]')?.getBoundingClientRect();
      const strip=document.querySelector(".stage2-gen-assets")?.getBoundingClientRect();
      return {pageTop:page?.top,pageBottom:page?.bottom,stripTop:strip?.top,stripBottom:strip?.bottom};
    })()`);
    assert.ok(screenplayPlacement.pageTop>=screenplayPlacement.stripTop
      &&screenplayPlacement.pageBottom<=screenplayPlacement.stripBottom,
      "screenplay image cards occupy the same row as the other inputs while the disclosure is closed");
    /* "Add references" card — the FIRST tile of the reference strip, the same
     * rectangle as the thumbnails; the toolbar no longer carries the "@" pill. */
    const addCard=await c.eval(`(()=>{
      const strip=document.querySelector(".stage2-gen-assets");
      const card=strip?.firstElementChild;
      const thumb=strip?.querySelector(".stage2-gen-asset");
      const r=card?.getBoundingClientRect(), t=thumb?.getBoundingClientRect();
      return {
        isAdd:!!card&&card.classList.contains("stage2-gen-add"),
        label:card?.querySelector(".stage2-gen-add-label")?.textContent||"",
        sub:card?.querySelector(".stage2-gen-add-sub")?.textContent||"",
        icons:card?card.querySelectorAll(".stage2-gen-add-ico svg").length:0,
        width:r?.width,height:r?.height,thumbWidth:t?.width,thumbHeight:t?.height,
        leftOfThumb:!!(r&&t)&&r.right<=t.left,
        toolbarAt:document.querySelectorAll(".sdbar .sdbar-pill.mention").length,
        popOpen:!!document.querySelector(".stage2-gen-add-pop")
      };
    })()`);
    assert.ok(addCard.isAdd,"the reference strip starts with the Add references card");
    assert.equal(addCard.label,"Add references");
    assert.equal(addCard.sub,"Image, Video or Audio");
    assert.equal(addCard.icons,3,"card shows image, video and audio icons");
    assert.equal(Math.round(addCard.width),Math.round(addCard.thumbWidth),"card matches the thumbnail width");
    assert.equal(Math.round(addCard.height),Math.round(addCard.thumbHeight),"card matches the thumbnail height");
    assert.ok(addCard.leftOfThumb,"card sits to the left of the first thumbnail");
    assert.equal(addCard.toolbarAt,0,"toolbar no longer renders the @ mention pill");
    assert.equal(addCard.popOpen,false,"picker is closed until the card is clicked");
    await c.eval(`(()=>{const s=document.querySelector(".stage2-gen-assets");s.scrollLeft=0;s.scrollIntoView({block:"center",inline:"nearest"});})()`);
    await new Promise(r=>setTimeout(r,80));
    await c.eval(`document.querySelector(".stage2-gen-assets .stage2-gen-add").click()`);
    await waitFor(()=>c.eval(`!!document.querySelector('.stage2-gen-add-pop[role="dialog"]')`),"Add references picker opens");
    const readAddPop=`(()=>{
      const pop=document.querySelector(".stage2-gen-add-pop");
      const card=document.querySelector(".stage2-gen-add").getBoundingClientRect();
      const p=pop.getBoundingClientRect();
      const list=pop.querySelector(".sdbar-mention-list");
      const lr=list?list.getBoundingClientRect():null;
      const vw=window.innerWidth, vh=window.innerHeight;
      return {
        rect:{top:p.top,bottom:p.bottom,left:p.left,right:p.right,vw,vh,cardTop:card.top,cardBottom:card.bottom,listTop:lr&&lr.top,listBottom:lr&&lr.bottom,styleTop:pop.style.top,styleBottom:pop.style.bottom,maxH:pop.style.maxHeight,pos:getComputedStyle(pop).position},
        inScroller:!!pop.closest(".stage2-gen-assets"),
        below:p.top>=card.bottom-1, above:p.bottom<=card.top+1,
        alignedLeft:Math.abs(p.left-card.left)<2||p.left<=8,
        insideViewport:p.top>=0&&p.left>=0&&p.bottom<=vh+0.5&&p.right<=vw+0.5,
        listInsideViewport:!lr||(lr.top>=0&&lr.bottom<=vh+0.5),
        options:pop.querySelectorAll(".sdbar-mention-list button").length,
        expanded:document.querySelector(".stage2-gen-add").getAttribute("aria-expanded"),
        controls:document.querySelector(".stage2-gen-add").getAttribute("aria-controls")===pop.id&&!!pop.id,
        focusInside:pop.contains(document.activeElement),
        visibleHeight:p.height
      };
    })()`;
    const addPop=await c.eval(readAddPop);
    assert.equal(addPop.inScroller,false,"picker is rendered outside the horizontal scroller");
    assert.ok(addPop.below||addPop.above,"picker opens directly below (or, when the viewport is short, above) the card");
    assert.ok(addPop.alignedLeft,"picker aligns with the card's left edge");
    assert.ok(addPop.insideViewport&&addPop.listInsideViewport,"picker and its list stay fully inside the viewport (no clipped bottom) "+JSON.stringify(addPop.rect));
    assert.ok(addPop.options>0,"picker lists the scene's ready references");
    assert.equal(addPop.expanded,"true");
    assert.ok(addPop.controls,"card is associated with the picker dialog through aria-controls");
    assert.ok(addPop.focusInside,"focus enters the picker when it opens");
    assert.ok(addPop.visibleHeight>40,"picker has visible height");
    const addReferencesShot=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-add-references-desktop.png`,Buffer.from(addReferencesShot.data,"base64"));
    await c.eval(`document.querySelector(".stage2-gen-add-pop .sdbar-mention-list button")?.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))`);
    await new Promise(r=>setTimeout(r,60));
    assert.ok(await c.eval(`!!document.querySelector(".stage2-gen-add-pop")`),"mousedown inside the picker keeps it open");
    // scrolling the page under an open picker re-anchors it to the card (it is position:fixed)
    await c.eval(`(()=>{const sc=document.querySelector(".stage2-gen-add").closest(".stage2-center")||document.scrollingElement;sc.scrollTop+=24;window.scrollBy(0,24);})()`);
    await new Promise(r=>setTimeout(r,120));
    const scrolledPop=await c.eval(`document.querySelector(".stage2-gen-add-pop")?${readAddPop}:null`);
    if(scrolledPop){
      assert.ok(scrolledPop.below||scrolledPop.above,"after a scroll the picker still hangs off the card "+JSON.stringify(scrolledPop.rect));
      assert.ok(scrolledPop.insideViewport&&scrolledPop.listInsideViewport,"after a scroll the picker still fits the viewport");
    }
    await c.eval(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))`);
    await waitFor(()=>c.eval(`!document.querySelector(".stage2-gen-add-pop")`),"Escape closes the picker");
    assert.ok(await c.eval(`document.activeElement&&document.activeElement.classList.contains("stage2-gen-add")`),
      "Escape returns focus to the Add references card");
    /* Short viewport: the picker flips above the card and still fits. */
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:480,deviceScaleFactor:1,mobile:false});
    await c.eval(`document.querySelector(".stage2-gen-assets").scrollIntoView({block:"end",inline:"nearest"})`);
    await new Promise(r=>setTimeout(r,80));
    await c.eval(`document.querySelector(".stage2-gen-add").click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".stage2-gen-add-pop")`),"picker opens in a short viewport");
    const shortPop=await c.eval(readAddPop);
    assert.ok(shortPop.insideViewport&&shortPop.listInsideViewport,"short viewport: picker stays fully visible "+JSON.stringify(shortPop.rect));
    assert.ok(shortPop.below||shortPop.above,"short viewport: picker still hangs off the card");
    await c.eval(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))`);
    await waitFor(()=>c.eval(`!document.querySelector(".stage2-gen-add-pop")`),"short viewport: Escape closes the picker");
    await c.call("Emulation.clearDeviceMetricsOverride");
    await new Promise(r=>setTimeout(r,80));
    /* Picking a reference inserts its @tag at the prompt caret (not appended) and
     * hands focus to the editor; "Reset to script" then restores the derivation so
     * the untouched-prompt expectations below are unaffected. */
    const readPromptValue=`(()=>{const el=document.querySelector(".stage2-gen-prompt[contenteditable]");let out="";
      const walk=n=>{for(const ch of n.childNodes){if(ch.nodeType===3)out+=ch.nodeValue;else if(ch.nodeType===1){
        if(ch.getAttribute("data-token"))out+=ch.getAttribute("data-token");else if(ch.tagName==="BR")out+="\\n";else walk(ch);}}};
      walk(el);return out;})()`;
    const caretSetup=await c.eval(`(()=>{
      const el=document.querySelector(".stage2-gen-prompt[contenteditable]");
      el.scrollIntoView({block:"center"});el.focus();
      let off=0,target=null;
      for(const ch of el.childNodes){
        if(ch.nodeType===3&&ch.nodeValue.length>12){target=ch;break;}
        if(ch.nodeType===3)off+=ch.nodeValue.length;else if(ch.getAttribute&&ch.getAttribute("data-token"))off+=ch.getAttribute("data-token").length;else off+=(ch.textContent||"").length;
      }
      if(!target) return null;
      const sel=window.getSelection();const r=document.createRange();r.setStart(target,6);r.collapse(true);sel.removeAllRanges();sel.addRange(r);
      return {offset:off+6};
    })()`);
    assert.ok(caretSetup,"prompt exposes a text run to place the caret in");
    const promptBeforePick=await c.eval(readPromptValue);
    await c.eval(`document.querySelector(".stage2-gen-add").click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".stage2-gen-add-pop .sdbar-mention-list button")`),"picker opens for a pick");
    const pickedTag=await c.eval(`(()=>{
      const all=[...document.querySelectorAll(".stage2-gen-add-pop .sdbar-mention-list button")];
      const b=all.find(x=>x.querySelector(".sdbar-mention-group")?.textContent==="Included")||all[0];
      const tag=b.querySelector("b").textContent;b.click();return tag;
    })()`);
    await waitFor(()=>c.eval(`!document.querySelector(".stage2-gen-add-pop")`),"picker closes after a pick");
    await waitFor(()=>c.eval(`${readPromptValue}.includes(${JSON.stringify(pickedTag)})`),"picked @tag lands in the prompt");
    const promptAfterPick=await c.eval(readPromptValue);
    const expectedHead=promptBeforePick.slice(0,caretSetup.offset);
    assert.ok(promptAfterPick.startsWith(expectedHead),"text before the caret is untouched");
    const insertedAt=promptAfterPick.indexOf(pickedTag,expectedHead.length-1);
    assert.ok(insertedAt>=expectedHead.length&&insertedAt<=expectedHead.length+1,"@tag is inserted at the caret, not appended");
    // (the prompt may already sit at the length cap, so only the run right after the
    // caret is compared — the insertion helper trims the far tail, never the middle)
    const tailRun=promptBeforePick.slice(caretSetup.offset).replace(/^\s+/,"").slice(0,40);
    assert.ok(promptAfterPick.slice(insertedAt+pickedTag.length).replace(/^\s+/,"").startsWith(tailRun),
      "text after the caret follows the inserted @tag");
    assert.ok(await c.eval(`document.activeElement===document.querySelector(".stage2-gen-prompt[contenteditable]")`),
      "focus moves on to the prompt editor after a pick");
    await c.eval(`document.querySelector(".stage2-prompt-reset")?.click()`);
    await waitFor(()=>c.eval(`${readPromptValue}===${JSON.stringify(promptBeforePick)}`),"Reset to script restores the derived prompt");
    await c.eval(`document.querySelector('.stage2-gen-assets [data-reference-kind="screenplay"]')?.scrollIntoView({block:"center",inline:"nearest"})`);
    await new Promise(r=>setTimeout(r,80));
    const screenplayReferenceRow=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-strip-desktop.png`,Buffer.from(screenplayReferenceRow.data,"base64"));
    await c.eval(`document.querySelector('.stage2-gen-assets [data-reference-kind="screenplay"]').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".lb-overlay .lb-img")`),"inline screenplay reference opens full page");
    assert.equal(await c.eval(`document.querySelector(".lb-overlay .lb-img").src`),screenplayInput.cards[0].src,
      "clicking the inline reference previews the exact attached PNG without opening a screenplay disclosure");
    assert.equal(await c.eval(`document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length`),0);
    await c.eval(`document.querySelector(".lb-overlay button[title='Close'],.lb-overlay .ag-x")?.click()`);
    await waitFor(()=>c.eval(`!document.querySelector(".lb-overlay .lb-img")`),"close inline page preview");
    assert.ok(await c.eval(`(()=>{
      const a=[...document.querySelectorAll(".stage2-assets-row .stage2-asset.image")].find(x=>
        !/screenplay|page/i.test(x.textContent||"")&&x.querySelector("img"));
      return !!a;
    })()`),"regular image input remains a separate visual frame/reference");
    /*
     * If a future picker entry is start-frame-only, its screenplayIssue must
     * block the launch rather than silently stripping the required pages.  The
     * current fixture may have no such active entry; keep this conditional so
     * adding one exercises the same guard without weakening the normal model.
     */
    const unsupportedSingleFrame=await c.eval(`(()=>{
      const m=(window.SEEDANCE_MODELS||[]).find(x=>x&&x.status==="active"&&x.refs===false);
      return m ? {id:m.id,label:m.label} : null;
    })()`);
    if(unsupportedSingleFrame){
      await c.eval(`([...document.querySelectorAll(".sd-gen-model")].find(x=>x.textContent.includes(${JSON.stringify(unsupportedSingleFrame.label)})))?.click()`);
      await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes(${JSON.stringify(unsupportedSingleFrame.label)})`),
        "unsupported single-frame model selection");
      assert.match(await c.eval(`document.querySelector(".stage2-blocker-text")?.textContent||""`),
        /screenplay screenshot|cannot include/i,
        "single-start-frame model blocks required screenplay screenshots");
      const beforeSingleFrameBlock=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`);
      await c.eval(`document.querySelector(".sd-gen-submit")?.click()`);
      await new Promise(r=>setTimeout(r,120));
      assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),
        beforeSingleFrameBlock,"unsupported single-frame model makes no provider call");
      assert.equal(await c.eval(`document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length`),0,
        "unsupported model does not reintroduce the removed screenplay disclosure");
      assert.ok(await c.eval(`document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"].locked').length>0`),
        "unsupported model keeps required screenplay page cards in the reference strip");
      await c.eval(`([...document.querySelectorAll(".sd-gen-model")].find(x=>/Seedance 2\\.5/.test(x.textContent)))?.click()`);
      await waitFor(()=>c.eval(`/Seedance 2\\.5/.test(document.querySelector(".sd-gen-model.on")?.textContent||"")`),
        "return to screenshot-capable model");
    }
    for(let i=0;i<screenplayInput.cards.length;i++){
      const expected=screenplayInput.cards[i].src;
      await c.eval(`document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')[${i}]?.click()`);
      await waitFor(()=>c.eval(`!!document.querySelector(".lb-overlay .lb-img")`),
        "screenplay strip page "+(i+1)+" preview");
      assert.equal(await c.eval(`document.querySelector(".lb-overlay .lb-img")?.src`),expected,
        "each screenplay strip card opens its exact attached PNG");
      await c.eval(`document.querySelector(".lb-overlay button[title='Close'],.lb-overlay .ag-x")?.click()`);
      await waitFor(()=>c.eval(`!document.querySelector(".lb-overlay .lb-img")`),
        "close screenplay strip page "+(i+1)+" preview");
    }

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-beat-row")].find(x=>/Beat 2/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(async()=>JSON.stringify(await screenplayCardSources())!==JSON.stringify(sceneOneScreenplay.images),
      "scene-one beat-two screenplay pages");
    const sceneOneBeatTwo=await c.eval(`({
      disclosureCount:document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length,
      prompt:document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||"",
      images:[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||"")
    })`);
    assert.equal(sceneOneBeatTwo.disclosureCount,0,"beat navigation does not reintroduce the removed screenplay disclosure");
    assert.match(sceneOneBeatTwo.prompt,/Mara carries the letter to the observatory window/,"beat-two prompt is specific to its selected target");
    assert.ok(sceneOneBeatTwo.images.some(x=>/\.png(?:\?|$)/i.test(x)||x.startsWith("data:image/png")),
      "beat-two target exposes a real PNG page");
    assert.notDeepEqual(sceneOneBeatTwo.images,sceneOneScreenplay.images,
      "beat navigation changes the target screenplay image");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-beat-row")].find(x=>/Beat 1/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(async()=>JSON.stringify(await screenplayCardSources())===JSON.stringify(sceneOneScreenplay.images),
      "scene-one beat-one return");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-scene-headrow")].find(x=>/The Landing/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(async()=>JSON.stringify(await screenplayCardSources())!==JSON.stringify(sceneOneBeatTwo.images),
      "other-scene screenplay pages");
    const sceneTwoScreenplay=await c.eval(`({
      disclosureCount:document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length,
      images:[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||"")
    })`);
    assert.equal(sceneTwoScreenplay.disclosureCount,0,"scene navigation does not reintroduce the removed screenplay disclosure");
    assert.ok(sceneTwoScreenplay.images.length>=1&&sceneTwoScreenplay.images.every(x=>x.startsWith("data:image/png")),
      "other scene has its own real screenplay page PNG");
    assert.notDeepEqual(sceneTwoScreenplay.images,sceneOneBeatTwo.images,
      "scene navigation changes the attached screenplay PNG");
    const sceneTwoOpeningPrompt=await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`);
    const duplicateYesMarkers=sceneTwoOpeningPrompt.match(/D\d+\s+·[^\n]*[“"]Yes\.[”"]/g)||[];
    assert.ok(duplicateYesMarkers.length>=2,
      "default opening brief keeps both distinct same-text dialogue occurrences");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-scene-headrow")].find(x=>/The Letter/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(async()=>JSON.stringify(await screenplayCardSources())===JSON.stringify(sceneOneScreenplay.images),
      "return to scene-one screenplay pages");

    /*
     * A non-selected beat is still part of the immutable full-scene reference,
     * but must not leak into the selected beat's editable direction. The required
     * page cards update immediately; changing the selected
     * beat separately proves that its ready prompt rebuilds for the new target.
     * Once the director edits it, the exact edit stays in the box but Stage marks
     * the prompt as drifted instead of silently replacing it.
     */
    const beatOneImageBeforeSourceEdit=await c.eval(`(()=>{
      const xs=[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||"");
      __fixture.beatOnePngBefore=xs;
      return xs;
    })()`);
    await c.eval(`window.__setScene1Beat2Text("Mara carries the letter to a newly opened observatory window.")`);
    const beatOneImageAfterSourceEdit=await waitFor(()=>c.eval(`(()=>{
       const xs=[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||"");
      return JSON.stringify(xs)!==JSON.stringify(__fixture.beatOnePngBefore) ? xs : null;
    })()`),"updated screenplay PNG after source edit");
    assert.notDeepEqual(beatOneImageAfterSourceEdit,beatOneImageBeforeSourceEdit,
      "editing screenplay source changes the required PNG reference");
    const beatOnePromptAfterNonselectedEdit=await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`);
    assert.match(beatOnePromptAfterNonselectedEdit,/Mara crosses to the brass desk/,"beat-one direction remains ready after a nonselected source edit");
    assert.doesNotMatch(beatOnePromptAfterNonselectedEdit,/newly opened observatory window/,"nonselected beat does not leak into beat-one direction");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-beat-row")].find(x=>/Beat 2/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(async()=>JSON.stringify(await screenplayCardSources())!==JSON.stringify(sceneOneScreenplay.images),
      "selected beat-two screenplay after nonselected edit");
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent.includes("newly opened observatory window")`),"selected beat prompt rebuild");
    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-beat-row")].find(x=>/Beat 1/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(async()=>JSON.stringify(await screenplayCardSources())===JSON.stringify(beatOneImageAfterSourceEdit),
      "return to beat-one after selected prompt rebuild");

    const editedDriftPrompt="EDITED STAGE PROMPT — preserve this exact direction";
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();e.textContent=${JSON.stringify(editedDriftPrompt)};e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"x"}));})()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent===${JSON.stringify(editedDriftPrompt)}`),"edited drift prompt");
    const driftImageBefore=await c.eval(`(()=>{
      const xs=[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||"");
      __fixture.driftImageBefore=xs;
      return xs;
    })()`);
    await c.eval(`window.__setScene1Beat2Text("Mara carries the letter beneath a red dawn window.")`);
    const driftImageAfter=await waitFor(()=>c.eval(`(()=>{
       const xs=[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')].map(x=>x.querySelector("img")?.src||"");
      return JSON.stringify(xs)!==JSON.stringify(__fixture.driftImageBefore) ? xs : null;
    })()`),"edited prompt source PNG refresh");
    assert.notDeepEqual(driftImageAfter,driftImageBefore,
      "source edit refreshes PNG even while a manual prompt is retained");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),editedDriftPrompt,"edited prompt is not silently overwritten by a nonselected source change");
    assert.match(await c.eval(`document.querySelector(".stage2-blocker")?.textContent||""`),/prompt|hand.edit|older|review|changed/i,"edited prompt drift is actionable");

    /*
     * Removing the selected scene's draft is a screenplay-source failure, not a
     * reason to hide unrelated loaded assets or spend a generation credit.
     */
    const callsBeforeMissingDraft=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`);
    await c.eval(`window.__setDraft("scene-1",null)`);
    await waitFor(()=>c.eval(`/screenplay|draft|write|import/i.test(document.querySelector(".stage2-blocker-text")?.textContent||"")`),"missing scene screenplay blocker");
    assert.match(await c.eval(`document.querySelector(".stage2-blocker")?.textContent||""`),/screenplay|draft|write|import/i,"missing screenplay blocks the selected Stage clip");
    assert.equal(await c.eval(`document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length`),0,
      "missing draft does not recreate the removed screenplay disclosure");
    assert.ok(await c.eval(`!!document.querySelector(".stage2-assets-row .stage2-asset.image")`),"missing screenplay does not remove unrelated visual assets");
    await c.eval(`document.querySelector(".sd-gen-submit")?.click()`);
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),callsBeforeMissingDraft,"missing screenplay invokes no provider");
    await c.eval(`window.__setScene1Beat2Text("Mara carries the letter beneath a red dawn window.")`);
    await waitFor(async()=>((await screenplayCardSources()).length>0),"restore drafted scene screenplay pages");

    /* Read-only shares retain the required page cards but cannot render or mutate them. */
    const readOnlyScreenplayCalls=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`);
    await c.eval(`window.__setReadOnly(true)`);
    await waitFor(async()=>((await screenplayCardSources()).length>0),"read-only screenplay page cards");
    assert.equal(await c.eval(`document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length`),0,
      "read-only Stage has no screenplay disclosure");
    assert.ok(await c.eval(`document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"].locked').length>0`),
      "read-only Stage retains locked screenplay page cards");
    await c.eval(`document.querySelector(".sd-gen-submit")?.click()`);
    await new Promise(r=>setTimeout(r,120));
    assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),readOnlyScreenplayCalls,"read-only view makes no paid calls");
    await c.eval(`window.__setReadOnly(false)`);
    await waitFor(async()=>((await screenplayCardSources()).length>0),"editing screenplay page cards restored");

    const manual="MANUAL FIXTURE PROMPT — preserve this verbatim";
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();e.textContent=${JSON.stringify(manual)};e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"x"}));return true})()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent===${JSON.stringify(manual)}`),"manual prompt edit");
    await c.eval(`(()=>{
      const s=document.querySelector('.stage2-rendercard select[title="Clip duration"],.stage2-rendercard .stage2-control-row select');
      if(!s)return false;
      const option=[...s.options].find(o=>o.value==="8");
      if(!option)return false;
      s.value=option.value;s.dispatchEvent(new Event("change",{bubbles:true}));return true;
    })()`);
    await waitFor(()=>c.eval(`document.querySelector('.stage2-rendercard select[title="Clip duration"],.stage2-rendercard .stage2-control-row select')?.value==="8"`),
      "manual prompt duration update");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,
      "actual duration update preserves a manual prompt");
    /* Model update. */
    await c.eval(`(()=>{const b=[...document.querySelectorAll(".sd-gen-model")].find(x=>x.textContent.includes("Seedance 2.0"));b.click();return true})()`);
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes("2.0")`),"2.0 selection");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,"model update preserves manual prompt");
    /* Clip grouping now lives in Render settings → Model → Advanced, not in the composer. */
    await chooseClipGrouping("shot","single-shot");
    assert.equal(await readClipGrouping("single-shot readback"),"shot","single-shot selection remains active");
    assert.equal(await c.eval(`!!document.querySelector('.stage2-console-composer button[title^="Clip scope"],.stage2-console-composer .sdbar-pill.scope')`),false,
      "single-shot selection does not recreate a composer scope pill");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,"scope update preserves manual prompt");
    /* Input/reference update. */
    await c.eval(`document.querySelector(".stage2-asset.image:not(.locked)")?.click()`);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,"input update preserves manual prompt");

    /*
     * The compatibility value is also a real persisted choice, not a transient
     * control state. Reload with Previous packing selected and verify the fixture's
     * existing adoption boundary is called again from the mounted Stage.
     */
    await chooseClipGrouping("legacy","previous-packing reload setup");
    assert.equal(await c.eval(`localStorage.getItem("turn_stage_clip_scope")`),"auto",
      "previous packing writes the historical auto storage value before reload");
    await c.call("Page.reload",{ignoreCache:true});
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes("2.0")`),"stored 2.0 reload");
    assert.match(await selectedModel(),/Seedance 2\.0/,"stored 2.0 persists");
    assert.equal(await readClipGrouping("previous-packing after reload"),"legacy",
      "previous packing selection persists across reload");
    assert.equal(await c.eval(`localStorage.getItem("turn_stage_clip_scope")`),"auto",
      "previous packing keeps old auto storage across reload");
    await waitFor(()=>c.eval(`window.__fixture.adoptTakes.length>0?window.__fixture.adoptTakes:null`),
      "legacy take adoption after reload");
    await chooseClipGrouping("shot","shot restoration after legacy reload");
    assert.equal(await readClipGrouping("shot restoration after legacy reload readback"),"shot",
      "single-shot grouping is restored before the remaining shot-scoped checks");
    await chooseNativePerformance("post-reload");

    /* Return to 2.5 and check an unknown proxy cannot offer 1080p. */
    await c.eval(`([...document.querySelectorAll(".sd-gen-model")].find(x=>x.textContent.includes("Seedance 2.5"))).click()`);
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes("2.5")`),"2.5 reselection");
    const card1080=()=>c.eval(`(()=>{const b=[...document.querySelectorAll(".stage2-rendercard .stage2-respill")].find(x=>x.textContent.trim()==="1080p");return {disabled:!!b?.disabled,aria:b?.getAttribute("aria-disabled"),title:b?.title||"",selected:b?.classList.contains("on")}})()`);
    const proxy1080=await card1080();
    if(!(proxy1080.disabled||proxy1080.aria==="true"))
      regressions.push(`unknown-proxy 1080p is enabled in Render settings: ${JSON.stringify(proxy1080)}`);
    assert.equal(proxy1080.selected,false,"unknown-proxy 1080p cannot be selected");
    /* The compact Format popover is a second control surface and must gate identically. */
    await c.eval(`document.querySelector('button[title="Resolution"]').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".sdbar-pop-format")`),"format menu");
    const unknownFormat1080=await c.eval(`(()=>{const b=[...document.querySelectorAll(".sdbar-pop-format button")].find(x=>x.textContent.trim().toLowerCase()==="1080p");return {found:!!b,disabled:!!b?.disabled,aria:b?.getAttribute("aria-disabled"),title:b?.title||""}})()`);
    assert.ok(unknownFormat1080.found,"Format menu's uppercase 1080P option must be located before checking its state");
    if(!(unknownFormat1080.disabled||unknownFormat1080.aria==="true"))
      regressions.push(`unknown-proxy 1080p is enabled in Format menu: ${JSON.stringify(unknownFormat1080)}`);
    await c.eval(`document.querySelector('button[title="Resolution"]').click()`);

    /* A positive handshake must unlock both controls. It advertises an exact ordered
       resolution list and ten direct-audio slots (covering 6+ line packages) without
       invoking generation or attaching any paid media. */
    await c.eval(`window.__fixture.proxyKnown=true;([...document.querySelectorAll(".sd-gen-model")].find(x=>x.textContent.includes("Seedance 2.0"))).click()`);
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes("2.0")`),"known-capability model cycle");
    await c.eval(`([...document.querySelectorAll(".sd-gen-model")].find(x=>x.textContent.includes("Seedance 2.5"))).click()`);
    await waitFor(async()=>{
      const state=await card1080();
      return !state.disabled&&state.aria!=="true";
    },"known-proxy 1080p unlock");
    const knownCaps=await c.eval(`window.__fixture.lastRuntimeCapabilities`);
    assert.deepEqual(knownCaps.resolutions,["480p","720p","1080p"],"known proxy uses exact advertised resolution array");
    assert.ok(knownCaps.directAudioFiles>=6&&knownCaps.references.audios.maxFiles>=6,"known proxy advertises 6+ direct audio inputs");
    await c.eval(`document.querySelector('button[title="Resolution"]').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".sdbar-pop-format")`),"known format menu");
    const knownFormat1080=await c.eval(`(()=>{const b=[...document.querySelectorAll(".sdbar-pop-format button")].find(x=>x.textContent.trim().toLowerCase()==="1080p");return {found:!!b,disabled:!!b?.disabled,aria:b?.getAttribute("aria-disabled")}})()`);
    assert.ok(knownFormat1080.found,"Known-proxy check must locate the actual Format menu option");
    assert.ok(!knownFormat1080.disabled&&knownFormat1080.aria!=="true","known-proxy 1080p is enabled in Format menu");
    await c.eval(`document.querySelector('button[title="Resolution"]').click()`);

    /* ---- Shoot composer modes: Create Video | Edit Video | Motion Control ----
       Three paid paths, each with its own Generate. Every request below lands in
       the fixture's generate stub — no provider is reached and no credit moves. */
    {
      /* desktop width: the composer bar's one-line layout is a desktop fact (on phones
         the chips wrap and Generate drops below them) */
      await c.call("Emulation.setDeviceMetricsOverride",{width:1760,height:1000,deviceScaleFactor:1,mobile:false});
      await new Promise(r=>setTimeout(r,80));
      const tabs=await c.eval(`[...document.querySelectorAll(".stage2-ctab-btn")].map(b=>b.textContent.trim())`);
      assert.deepEqual(tabs,["Create Video","Edit Video","Motion Control"],"composer tabs follow the Create / Edit / Motion layout");
      const toolbar=await c.eval(`(()=>{const bar=document.querySelector(".stage2-gen-composer .sdbar");return {
        elements:!!bar.querySelector(".sdbar-chip.elements"),sound:bar.querySelector(".sdbar-chip.sound")?.textContent.trim()||"",
        source:document.querySelectorAll(".sdbar button[title='Reference mode']").length,count:bar.querySelector(".sdbar-count")?.textContent.trim()||""};})()`);
      assert.equal(toolbar.elements,false,"the Create Video prompt box has no @ Elements chip (references come from the Add references card)");
      assert.match(toolbar.sound,/^Sound (On|Off)$/,"prompt box carries the Sound chip");
      assert.equal(toolbar.source,0,"the Omni reference source pill is gone from the toolbar");
      assert.match(toolbar.count,/\d+ \/ \d+/,"character counter sits on the right of the toolbar");
      /* the composer bar: every control on ONE line at the foot of the prompt card,
         Generate at the right end and taller than the chips (Higgsfield-style footer) */
      const readBar=()=>c.eval(`(()=>{const bar=document.querySelector(".stage2-gen-composer .stage2-gen-box .sdbar.inline");if(!bar) return null;
        const chips=[...bar.querySelectorAll(".sdbar-left > .sdbar-chip, .sdbar-left > .sdbar-anchor > .sdbar-pill")];
        const gen=bar.querySelector('.sdbar-right [data-testid="stage-generate"]');
        const rect=el=>{const r=el.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,h:r.height};};
        return {titles:chips.map(b=>String(b.title||"").split(" — ")[0].trim()),gen:!!gen,genRect:gen&&rect(gen),chips:chips.map(rect),
          first:rect(chips[0]),last:rect(chips[chips.length-1]),bar:rect(bar),opts:document.querySelectorAll(".stage2-gen-composer .stage2-opts").length,
          count:bar.querySelector(".sdbar-right .sdbar-count")?.textContent.trim()||""};})()`);
      const bar1=await readBar();
      assert.ok(bar1&&bar1.gen,"Generate sits inside the composer bar, on the right");
      assert.match(bar1.titles[0],/^(Sound|Silent)/,"the Sound chip opens the line");
      assert.deepEqual(bar1.titles.slice(1),["Prompt style","Duration","Aspect ratio","Resolution","Bitrate"],"Prompt style, Duration, Aspect, Resolution and Bitrate follow it on the same line");
      assert.ok(Math.abs(bar1.first.t-bar1.last.t)<1&&Math.abs(bar1.first.b-bar1.last.b)<1,"on a wide composer the chips share one line "+JSON.stringify({first:bar1.first,last:bar1.last,bar:bar1.bar}));
      assert.ok(bar1.genRect.l>=bar1.last.r,"Generate is to the right of the last chip");
      assert.ok(bar1.genRect.h>bar1.last.h&&Math.abs(bar1.genRect.b-bar1.last.b)<2,"Generate stands taller than the chips and shares their baseline");
      assert.match(bar1.count,/\d+ \/ \d+/,"the character count sits with Generate on the right");
      assert.equal(bar1.opts,0,"no stacked option rows remain under the Create Video prompt");
      await c.eval(`document.querySelector(".stage2-gen-composer .stage2-gen-box")?.scrollIntoView({block:"center"})`);
      await new Promise(r=>setTimeout(r,60));
      await writeFile(`${OUT}/stage-composer-bar-desktop.png`,Buffer.from((await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"));
      /* a narrower column (laptop with both rails open): the chips wrap like inline
         blocks, still packed to the foot of the bar, and Generate keeps the right end */
      await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
      await new Promise(r=>setTimeout(r,80));
      const bar2=await readBar();
      assert.ok(bar2.last.t>bar2.first.t,"in a narrower column the chips wrap onto a second line "+JSON.stringify(bar2.bar));
      assert.ok(bar2.chips.every(r=>r.r<=bar2.genRect.l+0.5),"every chip stays left of Generate when wrapped");
      assert.ok(Math.abs(bar2.genRect.b-bar2.last.b)<2&&bar2.genRect.h>=56,"Generate keeps its height and the shared foot line when the chips wrap");
      await c.eval(`document.querySelector(".stage2-gen-composer .stage2-gen-box")?.scrollIntoView({block:"center"})`);
      await new Promise(r=>setTimeout(r,60));
      await writeFile(`${OUT}/stage-composer-bar-laptop.png`,Buffer.from((await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"));
      /* phone: Generate spans the bar under the chips, and every chip menu stays on screen
         (menus anchor to the bar, not to the wrapped pill) */
      await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await new Promise(r=>setTimeout(r,120));
      const bar3=await readBar();
      assert.ok(bar3.genRect.l<=bar3.bar.l+1&&bar3.genRect.r>=bar3.bar.r-1,"on a phone Generate spans the full bar "+JSON.stringify({gen:bar3.genRect,bar:bar3.bar}));
      assert.ok(bar3.genRect.t>=Math.max(...bar3.chips.map(r=>r.b))-0.5,"on a phone Generate sits below the chips");
      await c.eval(`document.querySelector(".stage2-gen-composer .stage2-gen-box")?.scrollIntoView({block:"center"})`);
      await new Promise(r=>setTimeout(r,60));
      await writeFile(`${OUT}/stage-composer-bar-mobile-390.png`,Buffer.from((await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"));
      for(const title of ["Prompt style","Duration","Aspect ratio","Resolution","Bitrate"]){
        const pillJs=`[...document.querySelectorAll(".sdbar.inline .sdbar-pill")].find(b=>(b.title||"").startsWith(${JSON.stringify(title)}))`;
        await c.eval(`${pillJs}.click()`);
        await waitFor(()=>c.eval(`!!${pillJs}.parentElement.querySelector(".sdbar-pop")`),title+" menu opens on a phone");
        const pop=await c.eval(`(()=>{const pop=${pillJs}.parentElement.querySelector(".sdbar-pop");const r=pop.getBoundingClientRect();
          return {l:r.left,r:r.right,w:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth};})()`);
        assert.ok(pop.l>=0&&pop.r<=pop.w+0.5&&pop.sw<=pop.w,title+" menu stays inside the phone viewport "+JSON.stringify(pop));
        await c.eval(`${pillJs}.click()`);
        await waitFor(()=>c.eval(`!${pillJs}.parentElement.querySelector(".sdbar-pop")`),title+" menu closes again");
      }
      await c.call("Emulation.setDeviceMetricsOverride",{width:1760,height:1000,deviceScaleFactor:1,mobile:false});
      await new Promise(r=>setTimeout(r,80));
      assert.equal(await c.eval(`document.querySelectorAll(".stage2-hero .sdbar-pill.hero").length`),1,"the header card keeps its Change (model) control");
      const createCost=await c.eval(`document.querySelector('[data-testid="stage-generate"] .stage2-generate-cost')?.textContent.trim()`);
      assert.ok(Number(createCost)>=1,`Create Video's Generate carries the render price (${createCost})`);
      const callsBefore=await c.eval(`__fixture.calls.length`);

      /* Extend Video: a Seedance 2.5 extension task on one of this clip's takes. */
      await c.eval(`[...document.querySelectorAll(".stage2-seg-btn")].find(b=>b.textContent.trim()==="Extend Video").click()`);
      await waitFor(()=>c.eval(`!!document.querySelector('.stage2-dz[data-slot="extend"].filled')`),"Extend preselects the current take");
      assert.match(await c.eval(`document.querySelector('.stage2-dz[data-slot="extend"] .stage2-dz-meta b').textContent`),/Current take/);
      assert.equal(await c.eval(`document.querySelectorAll(".stage2-opts .stage2-seg, .stage2-gen-composer .stage2-ms").length`),0,"multi-shot editor stays a References-mode tool");
      /* the take's length is a billing fact — until it is measured the button is blocked and unpriced */
      await waitFor(()=>c.eval(`__fixture.measured.length>0`),"the preselected take is measured");
      assert.deepEqual(await c.eval(`__fixture.measured`),["data:video/mp4;base64,AAAA#new"],"measurement probes the chosen take itself");
      const extendWhileMeasuring=await c.eval(`(()=>{const b=document.querySelector('[data-testid="stage-generate-extend"]');return {aria:b.getAttribute("aria-disabled"),title:b.title,cost:b.querySelector(".stage2-generate-cost")?.textContent.trim()||null};})()`);
      assert.equal(extendWhileMeasuring.aria,"true","Extend stays blocked while the take is being measured");
      assert.match(extendWhileMeasuring.title,/Measuring the video/,"the blocker says the length is being measured");
      assert.equal(extendWhileMeasuring.cost,null,"no price is shown for an unmeasured input");
      assert.match(await c.eval(`document.querySelector('.stage2-dz[data-slot="extend"] .stage2-dz-meta small').textContent`),/measuring length/);
      assert.equal(await c.eval(`__fixture.releaseMeasure()`),1,"one pending probe released");
      await waitFor(()=>c.eval(`/0:10|10s/.test(document.querySelector('.stage2-dz[data-slot="extend"] .stage2-dz-meta small').textContent)`),"the measured length shows on the dropzone");
      await waitFor(()=>c.eval(`(()=>{const b=document.querySelector('[data-testid="stage-generate-extend"]');return b&&!b.disabled&&b.getAttribute("aria-disabled")!=="true";})()`),"Extend is enabled once the proxy advertises the extension task");
      await c.eval(`document.querySelector('[data-testid="stage-generate-extend"]').click()`);
      await waitFor(()=>c.eval(`__fixture.calls.length>${callsBefore}`),"extension request reaches the generate stub");
      const extendCall=await c.eval(`(()=>{const [,id,p]=__fixture.calls.at(-1);return {id,videoTask:p.videoTask,videoUrls:p.videoUrls,aspect:p.aspectRatio,prompt:p.prompt.slice(0,40),spend:p.spend,source:p.takeMeta.source,refs:p.takeMeta.references,inputSeconds:p.takeMeta.inputSeconds,priv:p.takeMeta.privateRefs,falModel:p.falModel,meta:JSON.stringify(p.takeMeta)};})()`);
      assert.equal(extendCall.videoTask,"extension","Extend Video submits Seedance 2.5's extension task");
      assert.deepEqual(extendCall.videoUrls,["data:video/mp4;base64,AAAA#new"],"the chosen take rides as @Video1");
      assert.equal(extendCall.aspect,"auto","extensions follow the source video's aspect");
      assert.match(extendCall.prompt,/^Extend @Video1 by ~\d+ seconds/,"extension grammar names the video and the added length");
      assert.equal(extendCall.spend.reason,"stage-video-extend");
      assert.ok(extendCall.spend.cost>=1,"extension carries a positive spend");
      assert.equal(extendCall.inputSeconds,10,"the take's MEASURED length is recorded (fal bills input seconds)");
      assert.equal(extendCall.source,"extend");
      assert.equal(extendCall.refs[0].role,"Video to extend");
      assert.equal(extendCall.priv,0,"a clip take is not a private device reference");
      assert.match(extendCall.falModel,/seedance-2\.5/,"extension runs on Seedance 2.5");
      await c.eval(`[...document.querySelectorAll(".stage2-seg-btn")].find(b=>b.textContent.trim()==="References").click()`);

      /* Edit Video: Seedance 2.5 editing task with its own prompt. Draw is not offered. */
      await c.eval(`document.querySelector(".stage2-ctab-btn[data-tab='edit']").click()`);
      await waitFor(()=>c.eval(`document.querySelector(".stage2-hero-title")?.textContent==="Seedance 2.5 Edit"`),"Edit Video header");
      const editBar=await c.eval(`(()=>{const bar=document.querySelector(".stage2-gen-composer .stage2-gen-box .sdbar.inline");if(!bar) return null;
        const chips=[...bar.querySelectorAll(".sdbar-left > .sdbar-chip, .sdbar-left > .sdbar-anchor > .sdbar-pill")];
        return {titles:chips.map(b=>String(b.title||"").split(" — ")[0].trim()),gen:!!bar.querySelector('.sdbar-right [data-testid="stage-generate-edit"]'),
          opts:document.querySelectorAll(".stage2-gen-composer .stage2-opts").length};})()`);
      assert.ok(editBar&&editBar.gen,"Edit Video's Generate sits in its composer bar");
      assert.deepEqual(editBar.titles.map(t=>t.replace(/^(Sound|Silent).*/,"Sound")),["Elements","Sound","Resolution","Edits keep the source video's length and aspect ratio","Bitrate"],"Edit Video's bar: Elements, Sound, Resolution, fixed length/aspect, Bitrate");
      assert.equal(editBar.opts,0,"Edit Video no longer stacks a Model row under the prompt");
      await c.eval(`document.querySelector(".stage2-gen-composer .stage2-gen-box")?.scrollIntoView({block:"center"})`);
      await new Promise(r=>setTimeout(r,60));
      await writeFile(`${OUT}/stage-composer-bar-edit.png`,Buffer.from((await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"));
      assert.equal(await c.eval(`[...document.querySelectorAll(".stage2-seg-btn")].find(b=>b.textContent.trim()==="Draw")?.disabled`),true,"Draw is disabled — fal's editing task has no draw input");
      const editGenBefore=await c.eval(`(()=>{const b=document.querySelector('[data-testid="stage-generate-edit"]');return {aria:b.getAttribute("aria-disabled"),title:b.title};})()`);
      assert.equal(editGenBefore.aria,"true","Edit Video cannot generate without a video");
      assert.match(editGenBefore.title,/Add the video to edit/);
      assert.equal(await c.eval(`document.querySelectorAll(".sd-gen-submit").length`),0,"the drawer's Generate steps aside on the Edit tab");
      await c.eval(`document.querySelector('.stage2-dz[data-slot="edit"] .sdbar-pill.dz').click()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent==="Take 1")`),"edit take picker lists the clip's takes");
      await c.eval(`[...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent==="Take 1").closest("button").click()`);
      await waitFor(()=>c.eval(`!!document.querySelector('.stage2-dz[data-slot="edit"].filled')`),"edit video chosen");
      await waitFor(()=>c.eval(`__fixture.measurePending.length>0`),"the edit take is measured before it can be priced");
      assert.equal(await c.eval(`__fixture.releaseMeasure()`),1);
      await c.eval(`(()=>{const el=document.querySelectorAll(".stage2-gen-prompt[contenteditable]")[0];el.scrollIntoView({block:"center"});el.focus();})()`);
      await c.call("Input.insertText",{text:"Replace the sky in @Video1 with a storm, keep the actors"});
      await waitFor(()=>c.eval(`(()=>{const b=document.querySelector('[data-testid="stage-generate-edit"]');return b&&!b.disabled&&b.getAttribute("aria-disabled")!=="true";})()`),"Edit is enabled with a video and a prompt");
      const editCalls=await c.eval(`__fixture.calls.length`);
      await c.eval(`document.querySelector('[data-testid="stage-generate-edit"]').click()`);
      await waitFor(()=>c.eval(`__fixture.calls.length>${editCalls}`),"editing request reaches the generate stub");
      const editCall=await c.eval(`(()=>{const [,,p]=__fixture.calls.at(-1);return {videoTask:p.videoTask,videoUrls:p.videoUrls,prompt:p.prompt,durationMs:p.durationMs,inputSeconds:p.takeMeta.inputSeconds,aspect:p.aspectRatio,spend:p.spend,source:p.takeMeta.source,screenplay:!!p.screenplayImages,meta:JSON.stringify(p.takeMeta)};})()`);
      assert.equal(editCall.videoTask,"editing","Edit Video submits Seedance 2.5's editing task");
      assert.deepEqual(editCall.videoUrls,["data:video/mp4;base64,AAAA#approved"],"Take 1 rides as @Video1");
      assert.match(editCall.prompt,/^Replace the sky in @Video1/,"the edit prompt is the user's, not the beat brief");
      assert.equal(editCall.durationMs,10000,"edits render at the source's MEASURED length (duration auto) and record it");
      assert.equal(editCall.inputSeconds,10,"the source length rides the take metadata");
      assert.equal(editCall.spend.cost,Math.max(1,Math.ceil(2*10*1.6*0.6)),"edit price = (output + input seconds) × 720p Seedance 2.5 rate × video-input multiplier");
      assert.equal(editCall.aspect,"auto");
      assert.equal(editCall.spend.reason,"stage-video-edit");
      assert.equal(editCall.source,"edit");
      assert.equal(editCall.screenplay,false,"edits carry no screenplay pages");
      assert.ok(!/stage:/.test(editCall.meta),"take metadata never stores staged references");

      /* Motion Control: Kling 3.0 — one motion video + one character image. */
      await c.eval(`document.querySelector(".stage2-ctab-btn[data-tab='motion']").click()`);
      await waitFor(()=>c.eval(`document.querySelector(".stage2-hero-title")?.textContent==="Control motion with video references"`),"Motion Control header");
      assert.equal(await c.eval(`document.querySelector(".stage2-switch[aria-checked]")?.getAttribute("aria-checked")`),"true","Scene control mode defaults ON");
      assert.equal(await c.eval(`document.querySelector(".stage2-seg-btn.on")?.textContent.trim()`),"Image","Scene source defaults to Image");
      assert.match(await c.eval(`document.querySelector(".stage2-switch-text small").textContent`),/character image or the motion video/,"scene-control helper explains the choice");
      assert.match(await c.eval(`document.querySelector('.stage2-dz[data-slot="motion-video"] .stage2-dz-empty b').textContent`),/3–10s/,"Image orientation caps the motion video at 10s");
      /* Pro ↔ Standard re-runs the capability handshake against the now-known proxy. */
      /* Model and Quality are chips on the card's foot line, Generate at its right */
      const motionBar=await c.eval(`(()=>{const bar=document.querySelector(".stage2-gen-box.motion .sdbar.inline");if(!bar) return null;
        const chips=[...bar.querySelectorAll(".sdbar-left .sdbar-pill")];const gen=bar.querySelector('.sdbar-right [data-testid="stage-generate-motion"]');
        return {titles:chips.map(b=>b.title.split(" — ")[0]),gen:!!gen,right:gen&&gen.getBoundingClientRect().left>=chips[chips.length-1].getBoundingClientRect().right};})()`);
      assert.deepEqual(motionBar&&motionBar.titles,["Motion Control model","Quality follows the model tier"],"Motion Control's bar carries Model and Quality chips");
      assert.ok(motionBar.gen&&motionBar.right,"Motion Control's Generate sits at the right end of the bar");
      await c.eval(`document.querySelector(".stage2-gen-box.motion")?.scrollIntoView({block:"center"})`);
      await new Promise(r=>setTimeout(r,60));
      await writeFile(`${OUT}/stage-composer-bar-motion.png`,Buffer.from((await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"));
      await c.eval(`document.querySelector('.sdbar.inline .sdbar-pill[title="Motion Control model"]').click()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent.includes("Pro"))`),"motion model menu");
      await c.eval(`[...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent.includes("Pro")).closest("button").click()`);
      await waitFor(()=>c.eval(`document.querySelector(".sdbar.inline .sdrow-badge")?.textContent.trim()==="1080p · Pro"`),"Pro quality badge");
      await c.eval(`document.querySelector('.sdbar.inline .sdbar-pill[title="Motion Control model"]').click()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent.includes("Standard"))`),"motion model menu again");
      await c.eval(`[...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent.includes("Standard")).closest("button").click()`);
      await waitFor(()=>c.eval(`document.querySelector(".sdbar.inline .sdrow-badge")?.textContent.trim()==="720p · Standard"`),"Standard quality badge");
      /* scene control OFF → the scene follows the motion video (30s ceiling) — said in the UI */
      await c.eval(`document.querySelector(".stage2-switch[aria-checked]").click()`);
      await waitFor(()=>c.eval(`document.querySelector(".stage2-switch[aria-checked]")?.getAttribute("aria-checked")==="false"`),"scene control off");
      assert.match(await c.eval(`document.querySelector(".stage2-switch-text small").textContent`),/follows the motion video/,"OFF state states the background source");
      assert.equal(await c.eval(`document.querySelectorAll(".stage2-seg-btn").length`),0,"Video | Image segmented hides when scene control is off");
      assert.match(await c.eval(`document.querySelector('.stage2-dz[data-slot="motion-video"] .stage2-dz-empty b').textContent`),/3–30s/,"video orientation allows 30s of motion");
      await c.eval(`document.querySelector('.stage2-dz[data-slot="motion-video"] .sdbar-pill.dz').click()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent==="Current take")`),"motion take picker");
      await c.eval(`[...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent==="Current take").closest("button").click()`);
      await waitFor(()=>c.eval(`__fixture.measurePending.length>0`),"the motion take is measured before it can be priced");
      assert.equal(await c.eval(`__fixture.releaseMeasure()`),1);
      await c.eval(`document.querySelector('.stage2-dz[data-slot="motion-image"] .sdbar-pill.dz').click()`);
      await waitFor(()=>c.eval(`document.querySelectorAll('.stage2-dz[data-slot="motion-image"] .sdbar-option').length>0`),"motion image picker lists clip images");
      await c.eval(`document.querySelector('.stage2-dz[data-slot="motion-image"] .sdbar-option').click()`);
      await waitFor(()=>c.eval(`!!document.querySelector('.stage2-dz[data-slot="motion-image"].filled')&&!!document.querySelector('.stage2-dz[data-slot="motion-video"].filled')`),"both motion inputs chosen");
      await c.eval(`document.querySelector(".stage2-adv-toggle").click()`);
      await waitFor(()=>c.eval(`!!document.querySelector(".stage2-motion-prompt")`),"advanced settings open");
      await c.eval(`(()=>{const s=document.querySelectorAll(".stage2-switch[aria-checked]")[1];s.click();})()`);
      await waitFor(()=>c.eval(`document.querySelectorAll(".stage2-switch[aria-checked]")[1]?.getAttribute("aria-checked")==="false"`),"keep original sound off");
      await waitFor(()=>c.eval(`(()=>{const b=document.querySelector('[data-testid="stage-generate-motion"]');return b&&!b.disabled&&b.getAttribute("aria-disabled")!=="true";})()`),"Motion Control is enabled with both inputs");
      const motionCost=await c.eval(`document.querySelector('[data-testid="stage-generate-motion"] .stage2-generate-cost')?.textContent.trim()`);
      assert.equal(Number(motionCost),Math.max(1,Math.ceil(10*0.42)),"Motion Control's price = measured motion seconds × Standard rate");
      const motionCalls=await c.eval(`__fixture.calls.length`);
      await c.eval(`document.querySelector('[data-testid="stage-generate-motion"]').click()`);
      await waitFor(()=>c.eval(`__fixture.calls.length>${motionCalls}`),"motion request reaches the generate stub");
      const motionCall=await c.eval(`(()=>{const [,,p]=__fixture.calls.at(-1);return {falModel:p.falModel,durationMs:p.durationMs,orientation:p.characterOrientation,keep:p.keepOriginalSound,videoUrls:p.videoUrls,frameUrl:p.frameUrl,videoTask:p.videoTask,spend:p.spend,source:p.takeMeta.source,refs:p.takeMeta.references.map(r=>r.role),tierLabel:p.takeMeta.tierLabel,screenplay:!!p.screenplayImages,meta:JSON.stringify(p.takeMeta)};})()`);
      assert.match(motionCall.falModel,/kling-video\/v3\/standard\/motion-control$/,"Standard tier maps to Kling's standard motion-control endpoint");
      assert.equal(motionCall.orientation,"video","scene control OFF submits character_orientation video");
      assert.equal(motionCall.keep,false,"Keep original sound follows the advanced switch");
      assert.deepEqual(motionCall.videoUrls,["data:video/mp4;base64,AAAA#new"]);
      assert.ok(motionCall.frameUrl,"the character image rides as image_url");
      assert.equal(motionCall.videoTask,undefined,"motion control is not a Seedance task");
      assert.equal(motionCall.durationMs,10000,"the output follows the motion video's measured length");
      assert.equal(motionCall.spend.reason,"stage-video-motion-control");
      assert.equal(motionCall.source,"motion-control");
      assert.deepEqual(motionCall.refs,["Character","Motion to copy"]);
      assert.match(motionCall.tierLabel,/Standard/);
      assert.equal(motionCall.screenplay,false,"motion control carries no screenplay pages");
      assert.ok(!/stage:/.test(motionCall.meta),"take metadata never stores staged references");
      /* back to Create for the remaining checks */
      await c.eval(`document.querySelector(".stage2-ctab-btn[data-tab='create']").click()`);
      await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="stage-generate"]')`),"Create Video restored");
      await c.call("Emulation.clearDeviceMetricsOverride");
      await new Promise(r=>setTimeout(r,80));
    }

    /*
     * Required-reference gate. A selected character appearance state has a canonical
     * variant id; while that variant is absent, Stage must not silently substitute
     * Mara's approved master or let a paid request leave the browser. The current
     * blocker intentionally offers an explicit per-shot “Use master for this shot”
     * override, which is exercised below.
     */
    await c.eval(`window.__fixture.variantLoaded=false;window.__fixture.policyRefusal=false;
      window.__setCharacterStates([{id:"wardrobe",label:"Rain wardrobe",sceneId:"scene-1"}]);
      window.__hardRemount()`);
    await waitFor(()=>c.eval(`(()=>{const t=document.querySelector(".stage2-blocker-text")?.textContent.toLowerCase()||"";return t.includes("required appearance")&&t.includes("rain wardrobe")&&t.includes("use master for this shot")&&t.includes("affects shot 1")})()`),"required character-state warning with explicit master override guidance");
    assert.match(await text(),/Rain wardrobe|appearance reference/i,"missing-state guidance identifies the appearance state rather than treating the master as sufficient");
    assert.equal(await c.eval(`window.nbAssetApproval(window.nbGetMeta("char-mara:wardrobe"))`),true,
      "approved metadata alone does not make an absent inventory image ready");
    const missingGate=await c.eval(`(()=>{const b=document.querySelector(".sd-gen-submit");return {aria:b?.getAttribute("aria-disabled"),disabled:!!b?.disabled,text:b?.textContent||""}})()`);
    assert.ok(missingGate.aria==="true"||missingGate.disabled,"missing required character variant blocks Generate");
    const beforeBlocked=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate").length`);
    await c.eval(`document.querySelector(".sd-gen-submit").click()`);
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate").length`),beforeBlocked,"blocked Generate invokes provider zero times");
    const masterFallback=await c.eval(`[...document.querySelectorAll(".stage2-asset")].filter(x=>/Mara(?:\\s*·\\s*Master)? reference/i.test(x.textContent)).map(x=>({text:x.textContent.trim(),included:x.classList.contains("on")||x.getAttribute("aria-pressed")==="true"}))`);
    assert.ok(!masterFallback.some(x=>x.included),`missing state must not silently fall back to master: ${JSON.stringify(masterFallback)}`);
    /* Neither a prompt token nor an explicit manual master attachment satisfies the
       canonical active-state requirement. */
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.textContent+=" @Image1";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:" @Image1"}));})()`);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await c.eval(`document.querySelector(".sd-gen-submit")?.getAttribute("aria-disabled")`),"true","typing an @ reference mention does not clear the missing-state gate");
    const manualMasterFound=await c.eval(`(()=>{const a=[...document.querySelectorAll(".stage2-asset")].find(x=>/Mara\\s*·\\s*Master reference/i.test(x.textContent));if(!a)return false;a.click();return true;})()`);
    assert.ok(manualMasterFound,"master reference remains available for an explicit manual attachment");
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await c.eval(`document.querySelector(".sd-gen-submit")?.getAttribute("aria-disabled")`),"true","manual master inclusion does not satisfy the missing active-state requirement");
    assert.ok(await c.eval(`(()=>{const t=document.querySelector(".stage2-blocker-text")?.textContent.toLowerCase()||"";return t.includes("required appearance")&&t.includes("rain wardrobe")&&t.includes("use master for this shot")})()`),"missing-state guidance remains visible after manual master inclusion");

    /*
     * Previous packing is the compatibility route for old positional take ids. It
     * persists as the historical "auto" storage value and asks the real adoption
     * boundary to inspect existing takes; this fixture deliberately does not invent
     * or migrate take data.
     */
    const adoptBaseline=await c.eval(`window.__fixture.adoptTakes.length`);
    await chooseClipGrouping("legacy","previous-packing");
    assert.equal(await readClipGrouping("previous-packing readback"),"legacy","previous packing remains selected");
    const adopted=await waitFor(()=>c.eval(`window.__fixture.adoptTakes.length>${adoptBaseline}?window.__fixture.adoptTakes.slice(${adoptBaseline}):null`),"legacy take adoption boundary");
    assert.ok(adopted.length>0&&adopted.every(x=>x.length===2&&x[0]&&x[1]&&x[0]!==x[1]),
      "legacy grouping invokes take adoption with stable and old positional ids");
    assert.equal(await c.eval(`localStorage.getItem("turn_stage_clip_scope")`),"auto",
      "legacy grouping preserves the historical auto storage value");
    assert.equal(await c.eval(`window.__takes.length`),2,
      "legacy grouping does not fabricate or rewrite fixture take data");
    await c.eval(`([...document.querySelectorAll(".viewnav button")].find(x=>x.textContent.trim()==="Takes"))?.click()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-vers")?.innerText.includes("2 takes")`),"legacy take review route");
    assert.match(await text(),/Restore as current|Reuse settings/,"legacy grouping retains the old take review actions");
    await c.eval(`([...document.querySelectorAll(".viewnav button")].find(x=>x.textContent.trim()==="Shoot"))?.click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".stage2-console-composer")`),"return to Stage after legacy take review");
    await chooseClipGrouping("beat","fit-beat restoration");
    assert.equal(await readClipGrouping("fit-beat restoration readback"),"beat","beat grouping is restored after legacy review");
    /*
     * A VIDEO-only master substitution is an explicit, persisted shot decision. Move
     * back to the grouped beat so both shots are visible, then prove selecting one row
     * neither leaks to its sibling nor mutates any story/reference source data.
     */
    await waitFor(()=>c.eval(`document.querySelectorAll(".stage2-character-choice").length===2`),"both grouped-beat character choices");
    // Use explicit text, not rendered mention-chip labels, to compare the editor
    // with the provider prompt. A chip's visible label is not its @ImageN value.
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();e.textContent="MANUAL SCREENPLAY TAKE — keep the camera steady.";e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"x"}));})()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent==="MANUAL SCREENPLAY TAKE — keep the camera steady."`),"explicit manual take direction");
    const overrideManual=await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`);
    const overrideBaseline=await c.eval(`({
      characters:JSON.stringify(__story.characters),
      first:JSON.stringify(Object.fromEntries(Object.entries(__story.shots[0]).filter(([k])=>k!=="stageCharacterReferenceOverrides"))),
      second:JSON.stringify(__story.shots[1]),
      timings:JSON.stringify(__story.shots.map(s=>({id:s.id,order:s.order,beatN:s.beatN,dur:s.dur}))),
      providerCalls:__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length
    })`);
    assert.equal(await c.eval(`__story.shots.every(s=>!Object.keys(s.stageCharacterReferenceOverrides||{}).length)`),true,"missing appearance state does not create an automatic master override");

    const firstMasterSelector='.stage2-character-choice[data-shot-id="shot-a"][data-character-id="char-mara"] button[data-choice="master"]';
    const secondMasterSelector='.stage2-character-choice[data-shot-id="shot-b"][data-character-id="char-mara"] button[data-choice="master"]';
    assert.ok(await c.eval(`!!document.querySelector(${JSON.stringify(firstMasterSelector)})`),"first shot offers the deliberate master choice");
    assert.ok(await c.eval(`!!document.querySelector(${JSON.stringify(secondMasterSelector)})`),"second shot independently offers the deliberate master choice");

    /* The Add references picker states which beat the automatic references belong to. */
    await c.eval(`document.querySelector('.stage2-gen-add').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector('.stage2-gen-add-pop .sdbar-mention-scope b')`),"reference picker shows a scope heading");
    assert.match(await c.eval(`document.querySelector('.stage2-gen-add-pop .sdbar-mention-scope b').textContent`),/^Scene \d\d · Beat \d+.*references$/,"scope heading names the scene and beat");
    assert.match(await c.eval(`document.querySelector('.stage2-gen-add-pop .sdbar-mention-scope span').textContent`),/^\d+ attached to this clip/,"scope heading counts attached references");
    await c.eval(`document.querySelector('.stage2-gen-add').click()`);
    await waitFor(()=>c.eval(`!document.querySelector('.stage2-gen-add-pop')`),"clicking the card again closes the picker");

    /* View-only shares expose the decision and its reason, but cannot create one. */
    const readOnlyCreateBaseline=await c.eval(`({story:JSON.stringify(__story.shots),updates:__fixture.updates.length,providers:__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length})`);
    await c.eval(`window.__setReadOnly(true)`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(firstMasterSelector)})?.disabled===true`),"view-only master choice disabled");
    assert.match(await c.eval(`document.querySelector(${JSON.stringify(firstMasterSelector)})?.title||""`),/view.only|read.only|cannot.*edit|editing.*disabled/i,"disabled master choice explains view-only access");
    await c.eval(`document.querySelector(${JSON.stringify(firstMasterSelector)}).click()`);
    await new Promise(r=>setTimeout(r,100));
    assert.deepEqual(await c.eval(`({story:JSON.stringify(__story.shots),updates:__fixture.updates.length,providers:__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length})`),readOnlyCreateBaseline,"view-only master choice cannot mutate story, persist, or call a provider");
    await c.eval(`window.__setReadOnly(false)`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(firstMasterSelector)})?.disabled===false`),"editing restores master choice");

    await c.eval(`document.querySelector(${JSON.stringify(firstMasterSelector)}).click()`);
    await waitFor(()=>c.eval(`__story.shots[0].stageCharacterReferenceOverrides?.["char-mara"]==="master"`),"first shot master override persistence");
    assert.deepEqual(await c.eval(`__story.shots.map(s=>s.stageCharacterReferenceOverrides||{})`),[{"char-mara":"master"},{},{},{}],"master override is scoped to the selected shot");
    assert.ok(await c.eval(`!!document.querySelector(${JSON.stringify(secondMasterSelector)})`),"second shot remains on its missing scene appearance");
    assert.ok(await c.eval(`(()=>{const t=document.querySelector(".stage2-blocker-text")?.textContent.toLowerCase()||"";return t.includes("required appearance")&&t.includes("rain wardrobe")})()`),"unselected sibling still requires its missing appearance");
    assert.deepEqual(await c.eval(`({
      characters:JSON.stringify(__story.characters),
      first:JSON.stringify(Object.fromEntries(Object.entries(__story.shots[0]).filter(([k])=>k!=="stageCharacterReferenceOverrides"))),
      second:JSON.stringify(__story.shots[1]),
      timings:JSON.stringify(__story.shots.map(s=>({id:s.id,order:s.order,beatN:s.beatN,dur:s.dur})))
    })`),{
      characters:overrideBaseline.characters,first:overrideBaseline.first,
      second:overrideBaseline.second,timings:overrideBaseline.timings
    },"shot override leaves characters, state data, the other shot, video text, and timings unchanged");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`),overrideManual,"first shot override preserves the manual prompt");

    await c.eval(`mount()`);
    await waitFor(()=>c.eval(`!!document.querySelector('.stage2-character-choice[data-shot-id="shot-a"][data-character-id="char-mara"] button[data-choice="scene"]')`),"first override survives normal remount");
    assert.equal(await c.eval(`__story.shots[0].stageCharacterReferenceOverrides?.["char-mara"]`),"master","normal remount reads the persisted shot override");

    const firstSceneSelector='.stage2-character-choice[data-shot-id="shot-a"][data-character-id="char-mara"] button[data-choice="scene"]';
    const readOnlyResetBaseline=await c.eval(`({story:JSON.stringify(__story.shots),updates:__fixture.updates.length,providers:__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length})`);
    await c.eval(`window.__setReadOnly(true)`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(firstSceneSelector)})?.disabled===true`),"view-only scene reset disabled");
    assert.match(await c.eval(`document.querySelector(${JSON.stringify(firstSceneSelector)})?.title||""`),/view.only|read.only|cannot.*edit|editing.*disabled/i,"disabled reset explains view-only access");
    await c.eval(`document.querySelector(${JSON.stringify(firstSceneSelector)}).click()`);
    await new Promise(r=>setTimeout(r,100));
    assert.deepEqual(await c.eval(`({story:JSON.stringify(__story.shots),updates:__fixture.updates.length,providers:__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length})`),readOnlyResetBaseline,"view-only reset cannot mutate story, persist, or call a provider");
    await c.eval(`window.__setReadOnly(false)`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(firstSceneSelector)})?.disabled===false`),"editing restores scene reset");

    await c.eval(`document.querySelector(${JSON.stringify(secondMasterSelector)}).click()`);
    await waitFor(()=>c.eval(`__story.shots[1].stageCharacterReferenceOverrides?.["char-mara"]==="master"`),"second shot master override persistence");
    await waitFor(()=>c.eval(`!((document.querySelector(".stage2-blocker-text")?.textContent||"").toLowerCase().includes("required appearance"))`),"both explicit masters clear missing appearance requirement");
    const overridePackage=await c.eval(`(()=>{const p=window.stageShotReferencePackage(window.__story.shots.filter(s=>s.sceneId==="scene-1"&&s.beatN===1),{...window.__story,scene:window.__story.scenes[0],images:{"char-mara":"loaded","prop-letter":"loaded"},availableImageIds:new Set(["char-mara","prop-letter"])});return p.characters.map(x=>({assetId:x.assetId,stateId:x.stateId,shotIds:x.shotIds,usages:x.usages}))})()`);
    assert.deepEqual(overridePackage,[{
      assetId:"char-mara",stateId:"",shotIds:["shot-a","shot-b"],
      usages:[
        {shotId:"shot-a",role:"master",source:"shot-master-override"},
        {shotId:"shot-b",role:"master",source:"shot-master-override"}
      ]
    }],"grouped override package attaches one master with shot-specific metadata usages");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`),overrideManual,"both shot overrides preserve the manual prompt");
    await chooseNativePerformance("override native performance");
    await waitFor(()=>c.eval(`document.querySelector(".stage2-blocker-act")?.textContent.trim()==="Confirm reviewed"`),"shot overrides keep source-drift review separate");
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await c.eval(`document.querySelector(".stage2-character-choices")?.scrollIntoView({block:"center"})`);
    const overrideDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-shot-master-overrides-desktop.png`,Buffer.from(overrideDesktop.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
    await new Promise(r=>setTimeout(r,150));
    const overrideMobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-shot-master-overrides-mobile-390.png`,Buffer.from(overrideMobile.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    assert.equal(await c.eval(`__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),overrideBaseline.providerCalls,"selecting shot overrides invokes no provider");

    /* Once the separate drift review is acknowledged, inspect the real stubbed launch
       payload. Its take metadata must retain one master descriptor with both shot uses. */
    await c.eval(`document.querySelector(".stage2-blocker-act").click()`);
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-submit")?.getAttribute("aria-disabled")!=="true"`),"override payload Generate unlock");
    await c.eval(`document.querySelector(".sd-gen-submit").click()`);
    await waitFor(()=>c.eval(`__fixture.calls.filter(x=>x[0]==="generate").length>${overrideBaseline.providerCalls}`),"stubbed override payload");
    const screenplayPayload=await c.eval(`(()=>{
      const row=__fixture.calls.filter(x=>x[0]==="generate").slice(${overrideBaseline.providerCalls})[0];
      const payload=row&&row[2]||{};
       const opts=payload.opts||payload.options||payload;
      return {
        prompt:payload.prompt||"",
         frameUrl:opts.frameUrl||payload.frameUrl||"",
         imageUrls:opts.imageUrls||payload.imageUrls||[],
         screenplayReference:opts.screenplayReference||payload.screenplayReference||payload.takeMeta?.screenplayReference||null,
         screenplayImages:opts.screenplayImages||payload.screenplayImages||payload.takeMeta?.screenplayImages||[],
         screenplayImagesRequired:opts.screenplayImagesRequired ?? payload.screenplayImagesRequired,
        screenplayBlock:payload.screenplayReferenceBlock||payload.takeMeta?.screenplayReferenceBlock||"",
        targetBeats:payload.screenplayReference?.targetBeats||payload.takeMeta?.screenplayReference?.targetBeats||[],
        providerPrompt:payload.screenplayReference&&window.stageScreenplayPrompt
          ? window.stageScreenplayPrompt(payload.screenplayReference) : ""
      };
    })()`);
    assert.ok(screenplayPayload.screenplayReference,"editing a prompt does not remove the screenplay reference from the paid payload");
    assert.equal(screenplayPayload.screenplayImagesRequired,true,
      "Stage launch marks screenplay screenshots as mandatory");
    assert.ok(screenplayPayload.screenplayImages.length>=1,
      "Stage launch carries screenplay image provenance");
    assert.ok(screenplayPayload.screenplayImages.every(x=>x.referenceKind==="screenplay"||x.sourceSignature||x.targetBeats),
      "screenplay image provenance retains screenplay identity/signature metadata");
    assert.ok(screenplayPayload.screenplayImages.every(x=>
      typeof x.url==="string"&&x.url.startsWith("data:image/png")),
      "screenplay image provenance contains actual PNG data URLs");
    assert.ok(screenplayPayload.imageUrls.length>=screenplayPayload.screenplayImages.length
      && screenplayPayload.screenplayImages.every(x=>screenplayPayload.imageUrls.includes(x.url)),
      "the same required screenplay PNGs are included in imageUrls");
    assert.ok(screenplayPayload.frameUrl&&!screenplayPayload.frameUrl.startsWith("data:image/png"),
      "regular image frame remains the separate start frame");
    assert.deepEqual(screenplayPayload.targetBeats,[1],"submitted screenplay reference remains scoped to the selected beat");
    assert.match(screenplayPayload.providerPrompt,/FULL SCENE SCREENPLAY/,"provider-bound Stage payload carries full scene context");
    assert.match(screenplayPayload.providerPrompt,/Dawn will tell us who sent it/,"provider-bound Stage payload carries the complete scene ending");
    const helperFullText=await c.eval(`(()=>{
      const scene=__story.scenes.find(s=>s.id==="scene-1");
      const shots=__story.shots.filter(s=>s.sceneId==="scene-1"&&Number(s.beatN)===1);
      return window.stageScreenplayReference(scene,shots,{
        ...__story,drafts:__story.drafts,characters:__story.characters,beatsMap:__story.beatsMap
      }).fullText;
    })()`);
    assert.equal(screenplayPayload.screenplayReference.fullText,helperFullText,"payload preserves the currently loaded complete scene revision from the source helper, including after reload");
    assert.match(screenplayPayload.screenplayReference.fullText,/Dawn will tell us who sent it/,"reference metadata retains lossless full-scene text");
    assert.ok(screenplayPayload.prompt.includes(overrideManual.trim()),"the submitted editable direction remains intact alongside the screenplay reference");
    const overridePayloadRefs=await c.eval(`__fixture.calls.filter(x=>x[0]==="generate").slice(${overrideBaseline.providerCalls})[0][2].takeMeta.referenceSourceVersions.filter(x=>x.kind==="character")`);
    assert.equal(overridePayloadRefs.length,1,"submitted grouped payload records the master character exactly once");
    assert.equal(overridePayloadRefs[0].assetId,"char-mara","submitted grouped payload is master-only for Mara");
    assert.equal(overridePayloadRefs[0].stateId,"","master take metadata has no appearance state id");
    assert.deepEqual(overridePayloadRefs[0].usages,[
      {shotId:"shot-a",role:"master",source:"shot-master-override"},
      {shotId:"shot-b",role:"master",source:"shot-master-override"}
    ],"take metadata preserves both shot-master-override usages");
    const beforeOverrideResetCalls=await c.eval(`__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`);

    const secondSceneSelector='.stage2-character-choice[data-shot-id="shot-b"][data-character-id="char-mara"] button[data-choice="scene"]';
    await c.eval(`document.querySelector(${JSON.stringify(firstSceneSelector)}).click()`);
    await waitFor(()=>c.eval(`!Object.prototype.hasOwnProperty.call(__story.shots[0].stageCharacterReferenceOverrides||{},"char-mara")`),"first master override reset");
    await c.eval(`document.querySelector(${JSON.stringify(secondSceneSelector)}).click()`);
    await waitFor(()=>c.eval(`!Object.prototype.hasOwnProperty.call(__story.shots[1].stageCharacterReferenceOverrides||{},"char-mara")`),"second master override reset");
    assert.equal(await c.eval(`__story.shots.every(s=>!Object.keys(s.stageCharacterReferenceOverrides||{}).length)`),true,"undo deletes both persisted override keys");
    await waitFor(()=>c.eval(`(()=>{const t=document.querySelector(".stage2-blocker-text")?.textContent.toLowerCase()||"";return t.includes("required appearance")&&t.includes("rain wardrobe")})()`),"undo restores missing appearance requirement");
    assert.equal(await c.eval(`__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),beforeOverrideResetCalls,"resetting shot overrides invokes no provider");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||""`),overrideManual,"resetting overrides preserves the manual prompt");

    /* Simulate the real cache completing later. The existing mounted Stage responds to
       nb-gen-done; no story mutation or remount is used for this clearance proof. */
    await c.eval(`window.__fixture.variantLoaded=true;window.dispatchEvent(new CustomEvent("nb-gen-done",{detail:{id:"char-mara:wardrobe"}}))`);
    await waitFor(()=>c.eval(`!((document.querySelector(".stage2-blocker-text")?.textContent||"").toLowerCase().includes("rain wardrobe"))`),"loaded character variant clears missing gate");
    /* The deliberately edited @ prompt now correctly has its separate source-drift
       review gate; acknowledge that only after proving the required-state gate cleared. */
    await chooseNativePerformance("loaded-state native performance");
    await waitFor(()=>c.eval(`document.querySelector(".stage2-blocker-act")?.textContent.trim()==="Confirm reviewed"`),"prompt drift review after state load");
    await c.eval(`document.querySelector(".stage2-blocker-act").click()`);
    try{
      await waitFor(()=>c.eval(`document.querySelector(".sd-gen-submit")?.getAttribute("aria-disabled")!=="true"`),"Generate unblocks after cache load");
    }catch(e){
      const blockerText=await c.eval(`document.querySelector(".stage2-blocker-text")?.textContent||""`);
      throw new Error(e.message+"; active blocker: "+blockerText);
    }
    const loadedBody=(await text()).toLowerCase();
    assert.doesNotMatch(loadedBody,/reference is not an approved current version/,"saved Art Room references need no manual approval warning");
    assert.doesNotMatch((await c.eval(`document.querySelector(".stage2-blocker")?.textContent||""`)).toLowerCase(),/implicit prop|unapproved/,"saved optional reference is not a hard blocker");
    const loadedRefs=await c.eval(`window.stageShotReferencePackage(window.__story.shots.slice(0,1),{...window.__story,scene:window.__story.scenes[0],images:{"char-mara:wardrobe":"loaded"},availableImageIds:new Set(["char-mara:wardrobe","prop-letter"])}).characters.map(x=>x.assetId)`);
    assert.deepEqual(loadedRefs,["char-mara:wardrobe"],"loaded package uses the selected state variant, not character master");

    /* Exercise the old likeness/policy retry trigger. The provider stub refuses once;
       Stage must surface it without a second paid call or a NO_CHAR_REFS package. */
    const beforePolicy=await c.eval(`window.__fixture.policyRefusal=true;window.__fixture.calls.filter(x=>x[0]==="generate").length`);
    await c.eval(`document.querySelector(".sd-gen-submit").click()`);
    await waitFor(()=>c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate").length>${beforePolicy}`),"single policy-refused provider call");
    await new Promise(r=>setTimeout(r,300));
    const policyCalls=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate").slice(${beforePolicy}).map(x=>x[2])`);
    assert.equal(policyCalls.length,1,"policy refusal causes exactly one generation/package submission");
    assert.ok((policyCalls[0].takeMeta.referenceSourceVersions||[]).some(x=>x.assetId==="char-mara:wardrobe"),"submitted package retains required character variant");
    assert.ok(!(policyCalls[0].takeMeta.referenceSourceVersions||[]).some(x=>x.assetId==="char-mara"),"resolved state variant supersedes the manually attached character master");
    assert.ok(!policyCalls[0].statusTag&&!policyCalls[0].takeMeta.safetyFallback,"policy refusal does not synthesize NO_CHAR_REFS/reference-drop fallback");
    const stageTextOnlyRecovery=await c.eval(`(()=>{
      const b=[...document.querySelectorAll("button")].find(x=>/text only/i.test(x.textContent||""));
      return b ? {disabled:!!b.disabled,aria:b.getAttribute("aria-disabled"),title:b.title||"",text:b.textContent||""} : null;
    })()`);
    assert.ok(stageTextOnlyRecovery,"policy errors expose the real recovery control");
    assert.ok(stageTextOnlyRecovery.disabled||stageTextOnlyRecovery.aria==="true",
      "Stage text-only recovery stays disabled when required screenshots cannot travel");
    assert.match(stageTextOnlyRecovery.title,/screenshot|screenplay|cannot.*text.only/i,
      "disabled Stage text-only recovery explains the mandatory screenshot");
    assert.match((await text()).toLowerCase(),/screenplay screenshot|text.only.*cannot|cannot.*text.only/,
      "Stage makes the screenshot requirement explicit after a media-policy refusal");
    const policyCallsBeforeDisabledRecovery=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`);
    await c.eval(`document.querySelectorAll("button").length&&[...document.querySelectorAll("button")].find(x=>/text only/i.test(x.textContent||""))?.click()`);
    await new Promise(r=>setTimeout(r,120));
    assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),
      policyCallsBeforeDisabledRecovery,"disabled Stage text-only recovery makes no provider call");
    await c.eval(`window.__fixture.policyRefusal=false`);

    /* Change only the live character state assignment (same character id, no remount
       and no cache event). The state image exists solely behind nbLoadImage, proving
       neededIds/state signatures request the newly resolved canonical asset. */
    const liveAssignmentBaseline=await c.eval(`({remounts:__fixture.hardRemounts,events:__fixture.genEvents,calls:__fixture.loadCalls.length})`);
    await c.eval(`window.__setCharacterStates([{id:"storm",label:"Storm coat",sceneId:"scene-1"}])`);
    await waitFor(()=>c.eval(`window.__fixture.loadCalls.includes("char-mara:storm")`),"live assignment requests exact new state image");
    await waitFor(()=>c.eval(`!((document.querySelector(".stage2-blocker-text")?.textContent||"").toLowerCase().includes("storm coat"))`),"live assignment load clears required-state gate");
    assert.equal(await c.eval(`window.__fixture.hardRemounts`),liveAssignmentBaseline.remounts,"live state assignment is handled without a hard remount");
    assert.equal(await c.eval(`window.__fixture.genEvents`),liveAssignmentBaseline.events,"live state assignment needs no synthetic generation/cache event");
    assert.deepEqual(await c.eval(`Array.from(new Set(window.__fixture.loadCalls.slice(${liveAssignmentBaseline.calls}).filter(x=>x.startsWith("char-mara:"))))`),["char-mara:storm"],"loader requests the exact newly pinned state, not the character master or stale state");

    /*
     * Real mention UI identity/attachment regression. Start with the scene-only Mara
     * master excluded while the required state and several normal references remain
     * included. Selecting the master from autocomplete must run includeMention, attach
     * that exact sheet, and insert the token it actually receives after inclusion.
     */
    const masterCardExpr=`[...document.querySelectorAll(".stage2-asset.image")].find(x=>/Mara\\s*·\\s*Master reference/i.test(x.textContent))`;
    assert.ok(await c.eval(`!!(${masterCardExpr})`),"mention test locates the real scene-only master card");
    if(await c.eval(`(${masterCardExpr})?.getAttribute("aria-pressed")==="true"`))
      await c.eval(`(${masterCardExpr}).click()`);
    await waitFor(()=>c.eval(`(${masterCardExpr})?.getAttribute("aria-pressed")==="false"`),"master excluded before mention selection");
    const mentionConsoleBaseline=await c.eval(`window.__fixture.consoleErrors.length`);
    const mentionToastBaseline=await c.eval(`window.__fixture.toasts.length`);
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await c.call("Input.insertText",{text:" @"});
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".stage2-mention-box:not(.stage2-swap-box) .stage2-mention-item")].some(x=>/Mara\\s*·\\s*Master reference/i.test(x.textContent))`),"master offered by @ autocomplete");
    const insertedMaster=await c.eval(`(()=>{const b=[...document.querySelectorAll(".stage2-mention-box:not(.stage2-swap-box) .stage2-mention-item")].find(x=>/Mara\\s*·\\s*Master reference/i.test(x.textContent));const token=b.querySelector("b").textContent.trim();b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));return {token,label:b.textContent.trim()};})()`);
    await waitFor(()=>c.eval(`(${masterCardExpr})?.getAttribute("aria-pressed")==="true"`),"@ autocomplete auto-attaches selected master");
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".stage2-chip")].some(x=>x.dataset.token===${JSON.stringify(insertedMaster.token)}&&/Mara\\s*·\\s*Master reference/i.test(x.title))`),"autocomplete creates master identity chip");
    assert.equal((await c.eval(`(${masterCardExpr}).querySelector("small")?.textContent.trim().split(/\\s+/)[0]`)).toLowerCase(),insertedMaster.token.toLowerCase(),"inserted token is the token actually assigned to the attached master sheet");

    /* Exclude it again through the real asset control, then choose that unattached
       master from a different included image chip's swap menu. doSwap must enforce the
       same attachment/budget path as autocomplete rather than inserting a hollow tag. */
    await c.eval(`(${masterCardExpr}).click()`);
    await waitFor(()=>c.eval(`(${masterCardExpr})?.getAttribute("aria-pressed")==="false"`),"master excluded before chip swap");
    // The explicit manual direction deliberately began without reference tokens.
    // Insert a real included asset's token before exercising chip replacement.
    const swapSourceToken=await c.eval(`(()=>{const a=[...document.querySelectorAll('.stage2-asset.image')].find(x=>x.getAttribute("aria-pressed")==="true"&&!/Mara\\s*·\\s*Master reference/i.test(x.textContent));return a?.querySelector("small")?.textContent.trim().split(/\\s+/)[0]||"";})()`);
    assert.match(swapSourceToken,/^@Image\d+$/i,"chip-swap source is an actually included image");
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await c.call("Input.insertText",{text:" "+swapSourceToken+" "});
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".stage2-chip.image")].some(x=>!/Mara\\s*·\\s*Master reference/i.test(x.title))`),"included image chip available for swap");
    await c.eval(`([...document.querySelectorAll(".stage2-chip.image")].find(x=>!/Mara\\s*·\\s*Master reference/i.test(x.title))).querySelector(".stage2-chip-caret").click()`);
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".stage2-swap-box .stage2-mention-item")].some(x=>/Mara\\s*·\\s*Master reference/i.test(x.textContent))`),"unattached master offered by chip swap");
    const swappedMaster=await c.eval(`(()=>{const b=[...document.querySelectorAll(".stage2-swap-box .stage2-mention-item")].find(x=>/Mara\\s*·\\s*Master reference/i.test(x.textContent));const token=b.querySelector("b").textContent.trim();b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));return {token,label:b.textContent.trim()};})()`);
    await waitFor(()=>c.eval(`(${masterCardExpr})?.getAttribute("aria-pressed")==="true"`),"chip swap auto-attaches selected master");
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".stage2-chip")].some(x=>x.dataset.token===${JSON.stringify(swappedMaster.token)}&&/Mara\\s*·\\s*Master reference/i.test(x.title))`),"swap creates attached master identity chip");
    assert.equal((await c.eval(`(${masterCardExpr}).querySelector("small")?.textContent.trim().split(/\\s+/)[0]`)).toLowerCase(),swappedMaster.token.toLowerCase(),"swap token resolves to the actual newly attached master sheet");
    assert.ok(!(await c.eval(`window.__fixture.toasts.slice(${mentionToastBaseline}).some(x=>/accepts up to|exclude an asset/i.test(String(x&&x[0]||"")))`)),"autocomplete and swap obey the available input budget without bypass warnings");
    const mentionConsoleErrors=await c.eval(`window.__fixture.consoleErrors.slice(${mentionConsoleBaseline})`);
    assert.ok(!mentionConsoleErrors.some(x=>/same key|unique ["']key["'] prop|encountered two children/i.test(x)),`mention option rendering has no duplicate React keys: ${JSON.stringify(mentionConsoleErrors)}`);

    /* Leave the saved-choice check behind and capture the approved beat-first workflow. */
    await chooseClipGrouping("beat","final fit-beat restoration");
    assert.equal(await readClipGrouping("final fit-beat readback"),"beat","final Stage workflow uses beat grouping");
    assert.match(await selectedModel(),/Seedance 2\.5/,"final Stage workflow restores the tested default model");
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const advancedSettingsBeforeShot=await openModelSettings("advanced-settings screenshot");
    const advancedSettingsState=await c.eval(`(()=>{const s=document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]');return {value:s?.value,visible:!!s&&s.getBoundingClientRect().width>0,labels:[...s?.options||[]].map(o=>o.textContent.trim())};})()`);
    assert.equal(advancedSettingsState.value,"beat","advanced settings screenshot shows the restored beat grouping");
    assert.equal(advancedSettingsState.visible,true,"advanced settings Clip grouping select is visible");
    const advancedDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-settings-advanced-desktop.png`,Buffer.from(advancedDesktop.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await c.eval(`document.querySelector('select[data-testid="stage-clip-grouping"][aria-label="Clip grouping"]')?.value`),"beat",
      "advanced settings Clip grouping persists at the mobile breakpoint");
    const advancedMobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-settings-advanced-mobile-390.png`,Buffer.from(advancedMobile.data,"base64"));
    await restoreSettingsState(advancedSettingsBeforeShot);
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const inspectScreenplayStrip=async(label)=>{
      const state=await c.eval(`(()=>{
        const cards=[...document.querySelectorAll('.stage2-gen-assets [data-reference-kind="screenplay"]')];
        const first=cards[0];
        first?.scrollIntoView({block:"center",inline:"nearest"});
        const r=first?.getBoundingClientRect();
        return {
          disclosureCount:document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length,
          count:cards.length,src:first?.querySelector("img")?.src||"",
          locked:cards.every(x=>x.classList.contains("locked")&&!x.classList.contains("off")),
          tagged:cards.every(x=>/^@Image\\d+$/.test(x.querySelector(".stage2-gen-asset-tag")?.textContent||"")),
          left:r?.left,top:r?.top,right:r?.right,bottom:r?.bottom,
          viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth
        };
      })()`);
      assert.equal(state.disclosureCount,0,`${label} has no screenplay disclosure`);
      assert.ok(state.count>0,`${label} screenplay strip retains page cards`);
      assert.ok(state.locked&&state.tagged,`${label} screenplay cards stay locked and tagged`);
      assert.ok(/^data:image\/png/.test(state.src),`${label} strip card is a real PNG`);
      assert.ok((state.left||-1)>=0&&(state.right||0)<=state.viewport+1
        &&(state.top||-1)<1000&&(state.bottom||0)>0,
        `${label} screenplay strip card is visible after scrolling`);
      return state;
    };
    const screenplayDesktopStrip=await inspectScreenplayStrip("desktop");
    const screenplayStripDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-strip-desktop.png`,Buffer.from(screenplayStripDesktop.data,"base64"));
    const desktopScreenplaySrc=screenplayDesktopStrip.src;
    await c.eval(`document.querySelector('.stage2-gen-assets [data-reference-kind="screenplay"]')?.click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".lb-overlay .lb-img")`),"desktop screenplay lightbox");
    assert.equal(await c.eval(`document.querySelector(".lb-overlay .lb-img")?.src`),desktopScreenplaySrc,
      "desktop screenplay strip opens its exact PNG in the lightbox");
    assert.equal(await c.eval(`document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length`),0,
      "desktop screenplay lightbox does not recreate the disclosure");
    const screenplayLightboxDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-lightbox-desktop.png`,Buffer.from(screenplayLightboxDesktop.data,"base64"));
    await c.eval(`document.querySelector(".lb-overlay button[title='Close'],.lb-overlay .ag-x")?.click()`);
    await waitFor(()=>c.eval(`!document.querySelector(".lb-overlay .lb-img")`),"close desktop screenplay lightbox");
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
    await new Promise(r=>setTimeout(r,150));
    const screenplayMobileStripState=await inspectScreenplayStrip("mobile");
    if(screenplayMobileStripState.scrollWidth>390)
      regressions.push(`screenplay strip overflows horizontally at 390px (${screenplayMobileStripState.scrollWidth}px document width)`);
    const screenplayStripMobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-strip-mobile-390.png`,Buffer.from(screenplayStripMobile.data,"base64"));
    const mobileScreenplaySrc=screenplayMobileStripState.src;
    await c.eval(`document.querySelector('.stage2-gen-assets [data-reference-kind="screenplay"]')?.click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".lb-overlay .lb-img")`),"mobile screenplay lightbox");
    assert.equal(await c.eval(`document.querySelector(".lb-overlay .lb-img")?.src`),mobileScreenplaySrc,
      "mobile screenplay strip opens its exact PNG in the lightbox");
    assert.equal(await c.eval(`document.querySelectorAll('[data-testid="stage-scene-screenplay"],.stage2-screenplay-reference').length`),0,
      "mobile screenplay lightbox does not recreate the disclosure");
    const screenplayLightboxMobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-lightbox-mobile-390.png`,Buffer.from(screenplayLightboxMobile.data,"base64"));
    await c.eval(`document.querySelector(".lb-overlay button[title='Close'],.lb-overlay .ag-x")?.click()`);
    await waitFor(()=>c.eval(`!document.querySelector(".lb-overlay .lb-img")`),"close mobile screenplay lightbox");
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const shootDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-shoot-desktop.png`,Buffer.from(shootDesktop.data,"base64"));

    /* Thumbnail states and exact-id recovery, without replacing references or
       generating new assets. Keep these mutations after source/prompt tests. */
    /* Source mode now lives only in Render settings > Inputs ("Visual source"); the
       toolbar no longer carries a source pill. */
    {
      const before=await settingsState();
      if(!before.open){
        await c.eval(`document.querySelector('button[title="Expand render settings"],.stage2-console .strip.right')?.click()`);
        await waitFor(()=>c.eval(`!!document.querySelector(".stage2-settings-drawer")`),"Render settings for Visual source");
      }
      await c.eval(`([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.textContent.trim()==="Inputs"))?.click()`);
      await waitFor(()=>c.eval(`!!document.querySelector('select[data-testid="stage-visual-source"]')`),"Visual source select in Inputs");
      assert.equal(await c.eval(`document.querySelectorAll(".sdbar button[title='Reference mode']").length`),0,"the toolbar no longer carries a source pill");
      await c.eval(`(()=>{const s=document.querySelector('select[data-testid="stage-visual-source"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;setter.call(s,"frames");s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
      await waitFor(()=>c.eval(`document.querySelector('select[data-testid="stage-visual-source"]')?.value==="frames"`),"reference-frame mode for thumbnail checks");
      await restoreSettingsState(before);
    }
    const frameThumb='.stage2-gen-assets [data-asset-id="shot-a"]';
    const thumbBaseline=await c.eval(`({calls:__fixture.calls.length,story:JSON.stringify(__story)})`);
    await c.eval(`__fixture.imageOverrides["shot-a"]="";window.dispatchEvent(new CustomEvent("nb-prefetched"));`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(frameThumb)})?.dataset.thumbnailState==="unavailable"`),"empty source becomes explicitly unavailable after loading");
    assert.match(await c.eval(`document.querySelector(${JSON.stringify(frameThumb)}).textContent`),/Unavailable/);
    assert.equal(await c.eval(`getComputedStyle(document.querySelector(${JSON.stringify(frameThumb)})).opacity`),"1","unavailable label is not faded into an unreadable broken-image placeholder");
    assert.match(await c.eval(`document.querySelector(${JSON.stringify(frameThumb)}).title`),/Click to reload.*no generation/);
    await c.eval(`__fixture.refreshResults["shot-a"]=px;document.querySelector(${JSON.stringify(frameThumb)}).click();`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(frameThumb)})?.dataset.thumbnailState==="loading"`),"manual reload is visibly loading");
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(frameThumb)})?.querySelector("img")?.naturalWidth>0`),"manual retry loads the existing exact shot image");
    assert.equal(await c.eval(`__fixture.refreshCalls.at(-1)[0]`),"shot-a");

    await c.eval(`__fixture.imageOverrides["shot-a"]="data:image/png;base64,broken";__fixture.refreshResults["shot-a"]=px;window.dispatchEvent(new CustomEvent("nb-prefetched"));`);
    await waitFor(()=>c.eval(`__fixture.refreshCalls.some(x=>x[0]==="shot-a"&&x[1]==="data:image/png;base64,broken")`),"failed URL automatically re-resolves the exact asset");
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(frameThumb)})?.querySelector("img")?.naturalWidth>0`),"replacement URL paints successfully");

    const beforePersistent=await c.eval(`__fixture.refreshCalls.length`);
    await c.eval(`__fixture.imageOverrides["shot-a"]="data:image/png;base64,still-broken";__fixture.refreshResults["shot-a"]="THROW";window.dispatchEvent(new CustomEvent("nb-prefetched"));`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(frameThumb)})?.dataset.thumbnailState==="error"`),"persistent preview error is explicitly labelled");
    await new Promise(r=>setTimeout(r,180));
    assert.equal(await c.eval(`__fixture.refreshCalls.length`),beforePersistent+1,"automatic refresh failure does not loop");
    assert.match(await c.eval(`document.querySelector(${JSON.stringify(frameThumb)}).textContent`),/Load failed/);
    await c.eval(`document.querySelector(${JSON.stringify(frameThumb)}).scrollIntoView({block:"center"});`);
    const thumbFailure=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-thumbnail-failure.png`,Buffer.from(thumbFailure.data,"base64"));
    await c.eval(`__fixture.refreshResults["shot-a"]=px;document.querySelector(${JSON.stringify(frameThumb)}).click();`);
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(frameThumb)})?.querySelector("img")?.naturalWidth>0`),"manual retry remains available after automatic failure");

    // Resolve a new location asset with unchanged scene/clip/entity ids. This
    // isolates the inventory memo contract from pre-existing derived-clip keys.
    const locationThumb='.stage2-gen-assets [data-asset-id="loc-fresh-coverage"]';
    await c.eval(`(()=>{
      window.__originalRefPackage=window.stageShotReferencePackage;
      window.stageShotReferencePackage=(shots,ctx)=>{
        const p=__originalRefPackage(shots,ctx);
        return ctx.scene?.id==="scene-1"?{...p,signature:p.signature+"-new-coverage",
          locations:[{assetId:"loc-fresh-coverage",entityId:"loc-observatory",
            roles:["master_reference"],shotIds:shots.map(s=>s.id)}]}:p;
      };
      __fixture.imageOverrides["loc-fresh-coverage"]="";
      __fixture.delayedImages["loc-fresh-coverage"]=px;
      window.mount();
    })()`);
    await waitFor(()=>c.eval(`__fixture.loadCalls.includes("loc-fresh-coverage")`),"changed reference-package asset id is loaded without a cache event");
    await waitFor(()=>c.eval(`document.querySelector(${JSON.stringify(locationThumb)})?.querySelector("img")?.naturalWidth>0`),"new coverage image replaces its loading placeholder");
    assert.equal(await c.eval(`__fixture.calls.length`),thumbBaseline.calls,"thumbnail recovery never calls a generation provider");
    assert.equal(await c.eval(`JSON.stringify(__story)`),thumbBaseline.story,"thumbnail recovery leaves story and saved reference choices untouched");
    await c.eval(`window.stageShotReferencePackage=window.__originalRefPackage;window.mount();`);

    /* Actual review UI, references, and take controls. */
    await c.eval(`([...document.querySelectorAll(".viewnav button")].find(x=>x.textContent.trim()==="Takes")).click()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-vers")?.innerText.includes("2 takes")`),"take review");
    const review=await text();
    assert.match(review,/References need review/i);
    assert.match(review,/References used/i);
    assert.match(review,/Letter continuity/);
    assert.match(review,/Restore as current/);
    assert.match(review,/Approve this take/);
    assert.match(review,/Reuse settings/);

    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const desktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-desktop.png`,Buffer.from(desktop.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
    await new Promise(r=>setTimeout(r,200));
    const mobileMetrics=await c.eval(`(()=>{const tools=document.querySelector(".stage2-versions-tools")?.getBoundingClientRect();const viewer=document.querySelector(".stage2-versions-viewer")?.getBoundingClientRect();return {innerWidth,scrollWidth:document.documentElement.scrollWidth,root:!!document.querySelector(".stage2-vers"),takes:document.querySelectorAll(".stage2-vcard").length,toolsLeft:tools?.left,toolsRight:tools?.right,viewerLeft:viewer?.left,viewerRight:viewer?.right}})()`);
    assert.equal(mobileMetrics.innerWidth,390);
    assert.ok(mobileMetrics.root&&mobileMetrics.takes===2,"take review remains mounted at 390px");
    if(mobileMetrics.scrollWidth>390)
      regressions.push(`390px Takes view overflows horizontally (${mobileMetrics.scrollWidth}px document width)`);
    if((mobileMetrics.toolsRight||0)>391||(mobileMetrics.viewerRight||0)>391)
      regressions.push(`390px Takes columns are clipped (viewer ${Math.round(mobileMetrics.viewerLeft)}–${Math.round(mobileMetrics.viewerRight)}px, tools ${Math.round(mobileMetrics.toolsLeft)}–${Math.round(mobileMetrics.toolsRight)}px)`);
    const mobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-mobile-390.png`,Buffer.from(mobile.data,"base64"));

    const frontendErrors=await c.eval(`window.__fixture.errors.slice()`);
    assert.deepEqual(frontendErrors,[],"fixture raised frontend errors");
    console.log(`fixture: ${FIXTURE}/index.html`);
     console.log(`screenshots: ${OUT}/stage-settings-advanced-desktop.png, ${OUT}/stage-settings-advanced-mobile-390.png, ${OUT}/stage-add-references-desktop.png, ${OUT}/stage-screenplay-strip-desktop.png, ${OUT}/stage-screenplay-lightbox-desktop.png, ${OUT}/stage-screenplay-strip-mobile-390.png, ${OUT}/stage-screenplay-lightbox-mobile-390.png, ${OUT}/stage-shot-master-overrides-desktop.png, ${OUT}/stage-shot-master-overrides-mobile-390.png, ${OUT}/stage-shoot-desktop.png, ${OUT}/stage-desktop.png, ${OUT}/stage-mobile-390.png`);
    if(regressions.length) throw new Error("Stage regressions:\\n- "+regressions.join("\\n- "));
    console.log("PASS Stage browser regression");
  } catch(error) {
    if(c) try{ console.error("Stage failure state:",await c.eval(`JSON.stringify({blockers:[...document.querySelectorAll(".stage2-blocker,.stage2-warn")].map(e=>e.textContent),scene:document.querySelector(".stage2-clip-head")?.textContent,source:document.querySelector(".stage2-blocker-text")?.textContent,thumbnails:[...document.querySelectorAll(".stage2-gen-assets button")].map(e=>({id:e.dataset.assetId,state:e.dataset.thumbnailState,label:e.textContent})),errors:window.__fixture.errors})`)); }catch{}
    throw error;
  } finally {
    try{c?.close();}catch{}
    chrome.kill("SIGTERM"); server.close();
  }
}

main().catch(e=>{console.error("FAIL Stage browser regression\\n"+(e.stack||e));process.exitCode=1;});

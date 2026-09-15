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
  try { css=await readFile(new URL("dist/app/styles.css", ROOT)); }
  catch { css=await readFile(new URL("app/styles.css", ROOT)); }
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
window.__fixture={calls:[],loadCalls:[],updates:[],confirms:[],toasts:[],errors:[],consoleErrors:[],proxyKnown:false,lastRuntimeCapabilities:null,
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
window.turnTierGates=()=>null;
window.seedanceCapabilities=()=>({references:{audios:{maxFiles:10}}});
/* Starts unknown; the test later advertises the exact known-proxy transport shape. */
window.seedanceGetRuntimeCapabilities=async target=>{
  if(!__fixture.proxyKnown)return {known:false,capabilities:null,reason:"fixture proxy version unknown",target};
  const capabilities={
    resolutions:["480p","720p","1080p"],
    directAudioFiles:10,
    references:{audios:{maxFiles:10}}
  };
  __fixture.lastRuntimeCapabilities=capabilities;
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
window.nbGetImage=id=>(
  (id==="char-mara:wardrobe"&&!__fixture.variantLoaded)||id==="char-mara:storm"
)?"":px;
window.nbLoadImage=async id=>{
  __fixture.loadCalls.push(id);
  if(id==="char-mara:storm"){
    await new Promise(resolve=>setTimeout(resolve,120));
    return px;
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
window.vgGetAudio=()=>""; window.vgLoadAudio=async()=>""; window.vidAdoptTakes=async()=>{};
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
<script src="/stage-plan.js"></script><script src="/stage-references.js"></script><script src="/stage.js"></script>
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
   {id:"shot-d",sceneId:"scene-2",order:1,beatN:1,dur:5,subjects:["char-mara"],props:[],
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
    {beat:1,type:"dia",text:"The night is finally over."}
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
    await waitFor(()=>c.eval(`document.querySelector(".stage2-root")&&document.querySelector(".stage2-root").innerText.includes("Seedance 2.5")`),"StageView mount");

    const text=()=>c.eval(`document.body.innerText`);
    const selectedModel=()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.trim()`);
    const selectedScope=()=>c.eval(`document.querySelector('button[title="Clip scope — how much one render covers"]')?.textContent.trim()`);
    const chooseNativePerformance=async(label)=>{
      await c.eval(`([...document.querySelectorAll(".stage2-settings-tabs .insp-tab")].find(x=>x.textContent.trim()==="Director"))?.click()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll("select")].some(s=>[...s.options].some(o=>o.value==="native"&&/Native performance/.test(o.textContent)))`),`${label||"Stage"} native-performance control`);
      await c.eval(`(()=>{const s=[...document.querySelectorAll("select")].find(x=>[...x.options].some(o=>o.value==="native"&&/Native performance/.test(o.textContent)));s.value="native";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()`);
      await waitFor(()=>c.eval(`[...document.querySelectorAll("select")].some(s=>s.value==="native"&&[...s.options].some(o=>o.value==="native"&&/Native performance/.test(o.textContent)))`),`${label||"Stage"} native-performance selection`);
    };
    assert.match(await selectedModel(),/Seedance 2\.5/,"new Stage defaults to Seedance 2.5");
    assert.match(await selectedScope(),/^Fit beat/,"new Stage defaults to beat-fit scope");
    await chooseNativePerformance("initial");

    const duration=await c.eval(`document.querySelector(".stage2-rendercard .stage2-control-row select")?.value || [...document.querySelectorAll(".stage2-rendercard select")].find(s=>[...s.options].some(o=>o.textContent.includes("10s")))?.value`);
    assert.equal(duration,"10","duration preview equals exact 4s + 6s coverage");
    /*
     * The old Render package / Exact queued render block was an implementation
     * preview, not an input the director could act on.  Stage now keeps the
     * authoritative screenplay in its source panel and sends the compiled
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
     * The screenplay panel is real Stage UI, backed by the shared source helpers.
     * Every beat in one scene gets the same lossless full-scene text, while its
     * target excerpt follows the selected beat. A second scene must never inherit
     * either the first scene's source or its target boundary.
     */
    const sceneOneScreenplay=await c.eval(`(()=>{
      const d=document.querySelector('[data-testid="stage-scene-screenplay"]');
      if(d)d.open=true;
      return {
        summary:d?.innerText||"",
        full:d?.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent||"",
         target:d?.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent||"",
         images:[...(d?.querySelectorAll("img")||[])].map(x=>({src:x.currentSrc||x.src,alt:x.alt||""}))
      };
    })()`);
    assert.match(sceneOneScreenplay.summary,/Scene screenplay/);
    assert.match(sceneOneScreenplay.summary,/Included as text|Included · \d+ required/i,
      "drafted scene is shown as an included screenplay reference");
    assert.match(sceneOneScreenplay.full,/Dawn will tell us who sent it/,"full screenplay panel exposes the final authored ending");
    assert.match(sceneOneScreenplay.target,/Mara crosses to the brass desk/,"selected beat target is ready");
    assert.doesNotMatch(sceneOneScreenplay.target,/Mara carries the letter to the observatory window/,"target panel stays beat-specific");
    assert.ok(sceneOneScreenplay.images.length>=1,"selected beat exposes a required screenplay page thumbnail");
    assert.ok(sceneOneScreenplay.images.some(x=>/\.png(?:\?|$)/i.test(x.src)||x.src.startsWith("data:image/png")),
      "screenplay thumbnail is a real PNG reference");
    const screenplayInput=await c.eval(`(()=>{
      const panel=document.querySelector('[data-testid="stage-scene-screenplay"]');
      const referenceRow=document.querySelector(".stage2-gen-reference-row");
      const cards=[...document.querySelectorAll(".stage2-gen-assets .stage2-gen-asset")].filter(x=>
        x.getAttribute("data-reference-kind")==="screenplay");
      return {
        panel:panel?.innerText||"",
        panelInsideReferenceRow:panel?.parentElement===referenceRow,
        cards:cards.map(x=>({text:x.innerText||"",kind:x.getAttribute("data-reference-kind")||""})),
        stripPngs:[...document.querySelectorAll(".stage2-gen-assets img")].map(x=>x.currentSrc||x.src),
        panelPngs:[...(panel?.querySelectorAll("img")||[])].map(x=>x.currentSrc||x.src)
      };
    })()`);
    assert.match(screenplayInput.panel,/\b\d+\s+screenplay\s+page/i,
      "screenplay panel reports the attached page count");
    assert.match(screenplayInput.panel,/Page \d+ of \d+/i,
      "screenplay thumbnails report required page order and total");
    assert.equal(screenplayInput.panelInsideReferenceRow,true,
      "screenplay disclosure is part of the render reference section");
    assert.equal(screenplayInput.cards.length,0,
      "screenplay pages are not duplicated as individual reference-strip cards");
    assert.ok(!screenplayInput.stripPngs.some(x=>x.startsWith("data:image/png")),
      "reference strip no longer shows duplicate screenplay page thumbnails");
    assert.ok(screenplayInput.panelPngs.some(x=>x.startsWith("data:image/png")),
      "screenplay disclosure retains the actual page images");
    const screenplayPlacement=await c.eval(`(()=>{
      const panel=document.querySelector('[data-testid="stage-scene-screenplay"]');
      if(panel)panel.open=false;
      const summary=panel?.querySelector(":scope > summary")?.getBoundingClientRect();
      const strip=document.querySelector(".stage2-gen-assets")?.getBoundingClientRect();
      return {summaryTop:summary?.top,summaryBottom:summary?.bottom,stripTop:strip?.top,stripBottom:strip?.bottom};
    })()`);
    assert.ok(screenplayPlacement.summaryTop<screenplayPlacement.stripBottom
      &&screenplayPlacement.summaryBottom>screenplayPlacement.stripTop,
      "collapsed screenplay control sits on the same reference row as the other inputs");
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
      assert.ok(await c.eval(`!!document.querySelector(".stage2-gen-reference-row > [data-testid='stage-scene-screenplay']")`),
        "unsupported model keeps the required screenplay disclosure in the reference section");
      await c.eval(`([...document.querySelectorAll(".sd-gen-model")].find(x=>/Seedance 2\\.5/.test(x.textContent)))?.click()`);
      await waitFor(()=>c.eval(`/Seedance 2\\.5/.test(document.querySelector(".sd-gen-model.on")?.textContent||"")`),
        "return to screenshot-capable model");
    }
    await c.eval(`(()=>{const d=document.querySelector('[data-testid="stage-scene-screenplay"]');if(d)d.open=true;document.querySelector(".stage2-screenplay-page-button")?.click();})()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".lb-overlay .lb-img")`),
      "screenplay page preview");
    assert.ok(await c.eval(`document.querySelector(".lb-overlay .lb-img")?.src?.startsWith("data:image/png")`),
      "opening a screenplay page shows the actual PNG in the preview");
    await c.eval(`document.querySelector(".lb-overlay button[title='Close'],.lb-overlay .ag-x")?.click()`);
    await waitFor(()=>c.eval(`!document.querySelector(".lb-overlay .lb-img")`),
      "close screenplay page preview");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-beat-row")].find(x=>/Beat 2/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent.includes("Mara carries the letter to the observatory window")`),"scene-one beat-two screenplay");
    const sceneOneBeatTwo=await c.eval(`({
      full:document.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent||"",
      target:document.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent||"",
       prompt:document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent||"",
       images:[...(document.querySelector('[data-testid="stage-scene-screenplay"]')?.querySelectorAll("img")||[])].map(x=>x.currentSrc||x.src)
    })`);
    assert.equal(sceneOneBeatTwo.full,sceneOneScreenplay.full,"every beat points at the same full scene source");
    assert.notEqual(sceneOneBeatTwo.target,sceneOneScreenplay.target,"target screenplay changes with the selected beat");
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
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent.includes("Mara crosses to the brass desk")`),"scene-one beat-one return");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-scene-headrow")].find(x=>/The Landing/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent.includes("Mara steps onto the landing at dawn")`),"other-scene screenplay");
    const sceneTwoScreenplay=await c.eval(`({
      full:document.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent||"",
      target:document.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent||""
    })`);
    assert.match(sceneTwoScreenplay.full,/The night is finally over/);
    assert.doesNotMatch(sceneTwoScreenplay.full,/Dawn will tell us who sent it|Mara carries the letter to the observatory window/,"navigating scenes does not leak screenplay text");
    assert.match(sceneTwoScreenplay.target,/Mara steps onto the landing at dawn/,"other scene has its own ready target");

    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-scene-headrow")].find(x=>/The Letter/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent.includes("Dawn will tell us who sent it")`),"return to scene-one screenplay");

    /*
     * A non-selected beat is still part of the immutable full-scene reference,
     * but must not leak into the selected beat's editable direction. The source
     * panel and required page thumbnails update immediately; changing the selected
     * beat separately proves that its ready prompt rebuilds for the new target.
     * Once the director edits it, the exact edit stays in the box but Stage marks
     * the prompt as drifted instead of silently replacing it.
     */
    const beatOneImageBeforeSourceEdit=await c.eval(`(()=>{
      const xs=[...(document.querySelector('[data-testid="stage-scene-screenplay"]')?.querySelectorAll("img")||[])].map(x=>x.currentSrc||x.src);
      __fixture.beatOnePngBefore=xs;
      return xs;
    })()`);
    await c.eval(`window.__setScene1Beat2Text("Mara carries the letter to a newly opened observatory window.")`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent.includes("newly opened observatory window")`),"nonselected screenplay update");
    const beatOneImageAfterSourceEdit=await waitFor(()=>c.eval(`(()=>{
      const xs=[...(document.querySelector('[data-testid="stage-scene-screenplay"]')?.querySelectorAll("img")||[])].map(x=>x.currentSrc||x.src);
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
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent.includes("newly opened observatory window")`),"selected beat-two screenplay after nonselected edit");
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent.includes("newly opened observatory window")`),"selected beat prompt rebuild");
    await c.eval(`(()=>{
      const row=[...document.querySelectorAll(".stage2-beat-row")].find(x=>/Beat 1/.test(x.textContent));
      row?.click();
      return !!row;
    })()`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-target-beat-screenplay"]')?.textContent.includes("Mara crosses to the brass desk")`),"return to beat-one after selected prompt rebuild");

    const editedDriftPrompt="EDITED STAGE PROMPT — preserve this exact direction";
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();e.textContent=${JSON.stringify(editedDriftPrompt)};e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"x"}));})()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent===${JSON.stringify(editedDriftPrompt)}`),"edited drift prompt");
    const driftImageBefore=await c.eval(`(()=>{
      const xs=[...(document.querySelector('[data-testid="stage-scene-screenplay"]')?.querySelectorAll("img")||[])].map(x=>x.currentSrc||x.src);
      __fixture.driftImageBefore=xs;
      return xs;
    })()`);
    await c.eval(`window.__setScene1Beat2Text("Mara carries the letter beneath a red dawn window.")`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-scene-screenplay-text"]')?.textContent.includes("red dawn window")`),"edited prompt source change");
    const driftImageAfter=await waitFor(()=>c.eval(`(()=>{
      const xs=[...(document.querySelector('[data-testid="stage-scene-screenplay"]')?.querySelectorAll("img")||[])].map(x=>x.currentSrc||x.src);
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
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-scene-screenplay"]')?.textContent.includes("Missing")`),"missing scene screenplay");
    assert.match(await c.eval(`document.querySelector('[data-testid="stage-scene-screenplay"]')?.textContent||""`),/screenplay|draft|write|import/i);
    assert.match(await c.eval(`document.querySelector(".stage2-blocker")?.textContent||""`),/screenplay|draft|write|import/i,"missing screenplay blocks the selected Stage clip");
    assert.ok(await c.eval(`!!document.querySelector(".stage2-assets-row .stage2-asset.image")`),"missing screenplay does not remove unrelated visual assets");
    await c.eval(`document.querySelector(".sd-gen-submit")?.click()`);
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),callsBeforeMissingDraft,"missing screenplay invokes no provider");
    await c.eval(`window.__setScene1Beat2Text("Mara carries the letter beneath a red dawn window.")`);
    await waitFor(()=>c.eval(`document.querySelector('[data-testid="stage-scene-screenplay"]')?.textContent.includes("Included as text")`),"restore drafted scene screenplay");

    /* Read-only shares retain the source panel but cannot render or mutate it. */
    const readOnlyScreenplayCalls=await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`);
    await c.eval(`window.__setReadOnly(true)`);
    await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="stage-scene-screenplay"]')`),"read-only screenplay panel");
    assert.match(await c.eval(`document.querySelector('[data-testid="stage-scene-screenplay"]')?.textContent||""`),/Scene screenplay|Included as text/);
    await c.eval(`document.querySelector(".sd-gen-submit")?.click()`);
    await new Promise(r=>setTimeout(r,120));
    assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x[0]==="generate"||x[0]==="batch").length`),readOnlyScreenplayCalls,"read-only view makes no paid calls");
    await c.eval(`window.__setReadOnly(false)`);
    await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="stage-scene-screenplay"]')`),"editing screenplay panel restored");

    const manual="MANUAL FIXTURE PROMPT — preserve this verbatim";
    await c.eval(`(()=>{const e=document.querySelector(".stage2-gen-prompt[contenteditable]");e.focus();e.textContent=${JSON.stringify(manual)};e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"x"}));return true})()`);
    await waitFor(()=>c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent===${JSON.stringify(manual)}`),"manual prompt edit");
    /* Model update. */
    await c.eval(`(()=>{const b=[...document.querySelectorAll(".sd-gen-model")].find(x=>x.textContent.includes("Seedance 2.0"));b.click();return true})()`);
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes("2.0")`),"2.0 selection");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,"model update preserves manual prompt");
    /* Scope update through the actual pill menu. */
    await c.eval(`document.querySelector('button[title="Clip scope — how much one render covers"]').click()`);
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent.trim()==="Single shot")`),"scope menu");
    await c.eval(`([...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent.trim()==="Single shot")).closest("button").click()`);
    await waitFor(()=>c.eval(`localStorage.getItem("turn_stage_clip_scope")==="shot"`),"single-shot persistence");
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,"scope update preserves manual prompt");
    /* Input/reference update. */
    await c.eval(`document.querySelector(".stage2-asset.image:not(.locked)")?.click()`);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await c.eval(`document.querySelector(".stage2-gen-prompt[contenteditable]")?.textContent`),manual,"input update preserves manual prompt");

    /* Stored historical choice survives a real reload. */
    await c.call("Page.reload",{ignoreCache:true});
    await waitFor(()=>c.eval(`document.querySelector(".sd-gen-model.on")?.textContent.includes("2.0")`),"stored 2.0 reload");
    assert.match(await selectedModel(),/Seedance 2\.0/,"stored 2.0 persists");
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
    await c.eval(`document.querySelector('button[title="Aspect ratio and resolution"]').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".sdbar-pop-format")`),"format menu");
    const unknownFormat1080=await c.eval(`(()=>{const b=[...document.querySelectorAll(".sdbar-pop-format button")].find(x=>x.textContent.trim().toLowerCase()==="1080p");return {found:!!b,disabled:!!b?.disabled,aria:b?.getAttribute("aria-disabled"),title:b?.title||""}})()`);
    assert.ok(unknownFormat1080.found,"Format menu's uppercase 1080P option must be located before checking its state");
    if(!(unknownFormat1080.disabled||unknownFormat1080.aria==="true"))
      regressions.push(`unknown-proxy 1080p is enabled in Format menu: ${JSON.stringify(unknownFormat1080)}`);
    await c.eval(`document.querySelector('button[title="Aspect ratio and resolution"]').click()`);

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
    await c.eval(`document.querySelector('button[title="Aspect ratio and resolution"]').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector(".sdbar-pop-format")`),"known format menu");
    const knownFormat1080=await c.eval(`(()=>{const b=[...document.querySelectorAll(".sdbar-pop-format button")].find(x=>x.textContent.trim().toLowerCase()==="1080p");return {found:!!b,disabled:!!b?.disabled,aria:b?.getAttribute("aria-disabled")}})()`);
    assert.ok(knownFormat1080.found,"Known-proxy check must locate the actual Format menu option");
    assert.ok(!knownFormat1080.disabled&&knownFormat1080.aria!=="true","known-proxy 1080p is enabled in Format menu");
    await c.eval(`document.querySelector('button[title="Aspect ratio and resolution"]').click()`);

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
     * A VIDEO-only master substitution is an explicit, persisted shot decision. Move
     * back to the grouped beat so both shots are visible, then prove selecting one row
     * neither leaks to its sibling nor mutates any story/reference source data.
     */
    await c.eval(`document.querySelector('button[title="Clip scope — how much one render covers"]').click()`);
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent.trim()==="Fit beat")`),"fit-beat menu for shot override");
    await c.eval(`([...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent.trim()==="Fit beat")).closest("button").click()`);
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

    /* The @ picker states which beat the automatic references belong to. */
    await c.eval(`document.querySelector('.sdbar-pill.mention').click()`);
    await waitFor(()=>c.eval(`!!document.querySelector('.sdbar-anchor.open .sdbar-mention-scope b')`),"mention picker shows a scope heading");
    assert.match(await c.eval(`document.querySelector('.sdbar-anchor.open .sdbar-mention-scope b').textContent`),/^Scene \d\d · Beat \d+.*references$/,"scope heading names the scene and beat");
    assert.match(await c.eval(`document.querySelector('.sdbar-anchor.open .sdbar-mention-scope span').textContent`),/^\d+ attached to this clip/,"scope heading counts attached references");
    await c.eval(`document.querySelector('.sdbar-pill.mention').click()`);

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
    assert.equal(screenplayPayload.screenplayReference.fullText,await c.eval(`document.querySelector('[data-testid="stage-scene-screenplay-text"]').textContent`),"payload preserves the currently loaded complete scene revision, including after reload");
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
    await c.eval(`document.querySelector('button[title="Clip scope — how much one render covers"]').click()`);
    await waitFor(()=>c.eval(`[...document.querySelectorAll(".sdbar-option b")].some(x=>x.textContent.trim()==="Fit beat")`),"fit-beat menu");
    await c.eval(`([...document.querySelectorAll(".sdbar-option b")].find(x=>x.textContent.trim()==="Fit beat")).closest("button").click()`);
    await waitFor(()=>c.eval(`localStorage.getItem("turn_stage_clip_scope")==="beat"`),"fit-beat restoration");
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const focusedScreenplay=async(label)=>{
      const state=await c.eval(`(()=>{
        const d=document.querySelector('[data-testid="stage-scene-screenplay"]');
        if(d)d.open=true;
        const img=d?.querySelector('[data-testid="stage-screenplay-page-image"]');
        let p=d?.parentElement,scroller=null;
        while(p&&p!==document.body){
          if(p.scrollHeight>p.clientHeight+2){scroller=p;break;}
          p=p.parentElement;
        }
        if(scroller) scroller.scrollTop=Math.max(0,(d.offsetTop||0)-Math.round(scroller.clientHeight*.2));
        (img||d)?.scrollIntoView({block:"center",inline:"nearest"});
        const r=img?.getBoundingClientRect();
        return {open:!!d?.open,src:img?.currentSrc||img?.src||"",left:r?.left,top:r?.top,right:r?.right,bottom:r?.bottom,
          viewport:innerWidth,scroller:scroller?.className||"document"};
      })()`);
      assert.equal(state.open,true,`${label} screenplay disclosure is open`);
      assert.ok(/^data:image\/png/.test(state.src),`${label} focused reference is a real PNG`);
      assert.ok((state.left||-1)>=0&&(state.right||0)<=state.viewport+1
        &&(state.top||-1)<1000&&(state.bottom||0)>0,
        `${label} focused reference is visible after scrolling ${state.scroller}`);
      return state;
    };
    await focusedScreenplay("desktop");
    const screenplayDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-expanded-desktop.png`,Buffer.from(screenplayDesktop.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
    await new Promise(r=>setTimeout(r,150));
    await focusedScreenplay("mobile");
    const screenplayMobileMetrics=await c.eval(`(()=>{
      const d=document.querySelector('[data-testid="stage-scene-screenplay"]');
      const body=d?.querySelector(".stage2-screenplay-body"),pre=d?.querySelector('[data-testid="stage-scene-screenplay-text"]');
      d&&(d.open=true);
      const image=d?.querySelector('[data-testid="stage-screenplay-page-image"]'),ir=image?.getBoundingClientRect();
      return {innerWidth,scrollWidth:document.documentElement.scrollWidth,open:!!d?.open,
        bodyLeft:body?.getBoundingClientRect().left,bodyRight:body?.getBoundingClientRect().right,
        preLeft:pre?.getBoundingClientRect().left,preRight:pre?.getBoundingClientRect().right,
        imageSrc:image?.currentSrc||image?.src||"",imageLeft:ir?.left,imageRight:ir?.right,
        fullLines:(pre?.textContent||"").split("\\n").length};
    })()`);
    assert.equal(screenplayMobileMetrics.innerWidth,390,"expanded screenplay mobile viewport is 390px");
    assert.ok(screenplayMobileMetrics.open&&screenplayMobileMetrics.fullLines>=3,"expanded screenplay remains readable on mobile");
    assert.ok(/^data:image\/png/.test(screenplayMobileMetrics.imageSrc)
      &&screenplayMobileMetrics.imageLeft>=0&&screenplayMobileMetrics.imageRight<=391,
      "focused screenplay PNG remains visible at 390px");
    if(screenplayMobileMetrics.scrollWidth>390)
      regressions.push(`expanded screenplay overflows horizontally at 390px (${screenplayMobileMetrics.scrollWidth}px document width)`);
    if((screenplayMobileMetrics.bodyRight||0)>391||(screenplayMobileMetrics.preRight||0)>391)
      regressions.push(`expanded screenplay is clipped at 390px (body ${Math.round(screenplayMobileMetrics.bodyLeft)}–${Math.round(screenplayMobileMetrics.bodyRight)}px, pre ${Math.round(screenplayMobileMetrics.preLeft)}–${Math.round(screenplayMobileMetrics.preRight)}px)`);
    const screenplayMobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-screenplay-expanded-mobile-390.png`,Buffer.from(screenplayMobile.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const shootDesktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`${OUT}/stage-shoot-desktop.png`,Buffer.from(shootDesktop.data,"base64"));

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
    console.log(`screenshots: ${OUT}/stage-screenplay-expanded-desktop.png, ${OUT}/stage-screenplay-expanded-mobile-390.png, ${OUT}/stage-shot-master-overrides-desktop.png, ${OUT}/stage-shot-master-overrides-mobile-390.png, ${OUT}/stage-shoot-desktop.png, ${OUT}/stage-desktop.png, ${OUT}/stage-mobile-390.png`);
    if(regressions.length) throw new Error("Stage regressions:\\n- "+regressions.join("\\n- "));
    console.log("PASS Stage browser regression");
  } catch(error) {
    if(c) try{ console.error("Stage failure state:",await c.eval(`JSON.stringify({blockers:[...document.querySelectorAll(".stage2-blocker,.stage2-warn")].map(e=>e.textContent),scene:document.querySelector(".stage2-clip-head")?.textContent,source:document.querySelector('[data-testid="stage-scene-screenplay"]')?.textContent.slice(0,200),errors:window.__fixture.errors})`)); }catch{}
    throw error;
  } finally {
    try{c?.close();}catch{}
    chrome.kill("SIGTERM"); server.close();
  }
}

main().catch(e=>{console.error("FAIL Stage browser regression\\n"+(e.stack||e));process.exitCode=1;});

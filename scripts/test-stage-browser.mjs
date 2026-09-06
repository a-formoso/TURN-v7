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
import {spawn} from "node:child_process";
import {transformSync} from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const FIXTURE = "/tmp/fixture/browserfiles";
const SHOTS = ["stage-plan", "stage-references", "stage"];
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
  for (const name of SHOTS) {
    try {
      const built=await readFile(new URL(`dist/app/${name}.js`, ROOT));
      if(built.length){await writeFile(`${FIXTURE}/${name}.js`,built);continue;}
    } catch {}
    const source = await readFile(new URL(`app/${name}.jsx`, ROOT), "utf8");
    const out = transformSync(source, {
      presets:[["@babel/preset-react",{runtime:"classic"}]],
      plugins:["@babel/plugin-transform-block-scoping"],
      comments:false, compact:false, babelrc:false, configFile:false, filename:`${name}.jsx`,
    });
    await writeFile(`${FIXTURE}/${name}.js`, out.code);
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
<link rel="stylesheet" href="/styles.css">
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
window.useSeedanceGen=id=>({
  videoUrl:"",gening:false,status:"",err:null,
  generate:async payload=>{window.__fixture.calls.push(["generate",id,payload]);if(__fixture.policyRefusal)throw new Error("policy refusal: character reference rejected");return {url:fakeVideo,seed:4242};},
  generateBatch:async(payload,n)=>(window.__fixture.calls.push(["batch",id,n,payload]),[]),
  cancel:()=>window.__fixture.calls.push(["cancel",id])
});
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
  inputs:"3 images",audio:"native",tierLabel:"Standard",resolution:"720p",bitrate:"standard",
  recipe:"timeline",seed:4242,createdAt:stale?1700000002000:1700000001000,
  status:stale?"draft":"approved",fixtureStale:stale,
  prompt:"Fixture take prompt: Mara crosses the room and lifts the letter.",
  references:[{tag:"@Image1",label:"Mara reference",kind:"image",url:px,assetId:"char-mara",role:"identity"},
    {tag:"@Image2",label:"Letter continuity",kind:"image",url:px,assetId:"prop-letter",role:"prop state"}],
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
<script src="/stage-plan.js"></script><script src="/stage-references.js"></script><script src="/stage.js"></script>
<script>
window.turnContinuity={shots:[],drafts:{},props:[]};
window.__story={
 project:{id:"fixture-film",title:"Synthetic Stage Browser Fixture",format:{aspect:"16:9"}},
 scenes:[{id:"scene-1",no:1,title:"The Letter",loc:"INT. OBSERVATORY · NIGHT",order:1}],
 shots:[
  {id:"shot-a",sceneId:"scene-1",order:1,beatN:1,dur:4,subjects:["char-mara"],props:["prop-letter"],
   size:"Wide",angle:"Eye level",move:"Slow push",lens:"35mm",action:"Mara crosses to the brass desk.",
   beatPlan:{micro:["Mara crosses to the brass desk.","She ignores the ringing telephone."],protect:"The letter changes hands."},covers:[1]},
  {id:"shot-b",sceneId:"scene-1",order:2,beatN:1,dur:6,subjects:["char-mara"],props:["prop-letter"],
   size:"Close-up",angle:"High",move:"Static",lens:"85mm",action:"Mara lifts the sealed letter into moonlight.",
   beatPlan:{micro:["Mara lifts the sealed letter into moonlight.","The window suddenly breaks."],protect:"The letter changes hands."},covers:[1]}
 ],
  characters:[{id:"char-mara",name:"Mara",states:[]}],
 locations:[{id:"loc-observatory",name:"Old Observatory",scenes:["scene-1"]}],
 props:[{id:"prop-letter",name:"Sealed Letter",ownerId:"char-mara",ownerName:"Mara",kind:"carried"}],
 beatsMap:{"scene-1":{rows:[{n:1,drive:{d:"Mara reaches the desk"},react:{d:"She studies the seal"}}]}},
 drafts:{"scene-1":{version:"fixture-v1",blocks:[
   {beat:1,type:"action",text:"Mara crosses to the desk and lifts the sealed letter."}
 ]}}
};
turnContinuity.shots=__story.shots;turnContinuity.drafts=__story.drafts;turnContinuity.props=__story.props;
let fixtureRoot=ReactDOM.createRoot(document.getElementById("root"));
function mount(){
 fixtureRoot.render(React.createElement(StageView,{
  ...__story,creditBalance:{remaining:99},
  onUpdateShot:(id,patch)=>{__fixture.updates.push([id,patch]);const s=__story.shots.find(x=>x.id===id);Object.assign(s,patch);mount();},
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
      const type = name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":"text/javascript";
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
    assert.match(await selectedModel(),/Seedance 2\.5/,"new Stage defaults to Seedance 2.5");
    assert.match(await selectedScope(),/^Fit beat/,"new Stage defaults to beat-fit scope");

    const duration=await c.eval(`document.querySelector(".stage2-rendercard .stage2-control-row select")?.value || [...document.querySelectorAll(".stage2-rendercard select")].find(s=>[...s.options].some(o=>o.textContent.includes("10s")))?.value`);
    assert.equal(duration,"10","duration preview equals exact 4s + 6s coverage");
    const queued=await c.eval(`document.querySelector(".stage-plan-queued pre")?.textContent||""`);
    assert.match(queued,/Mara crosses to the brass desk/);
    assert.match(queued,/Mara lifts the sealed letter into moonlight/);
    assert.doesNotMatch(queued,/ringing telephone|window suddenly breaks/,"uncovered micro-beats must not leak into preview");

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
     * variant id; while that variant is absent, Stage must neither substitute Mara's
     * approved master nor let a paid request leave the browser.
     */
    await c.eval(`window.__fixture.variantLoaded=false;window.__fixture.policyRefusal=false;
      window.__setCharacterStates([{id:"wardrobe",label:"Rain wardrobe",sceneId:"scene-1"}]);
      window.__hardRemount()`);
    await waitFor(()=>c.eval(`(()=>{const t=document.querySelector(".stage2-blocker-text")?.textContent.toLowerCase()||"";return t.includes("required character appearance")&&t.includes("rain wardrobe")&&t.includes("master reference")&&t.includes("cannot replace this state")})()`),"required character-state warning");
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
    assert.ok(await c.eval(`(()=>{const t=document.querySelector(".stage2-blocker-text")?.textContent.toLowerCase()||"";return t.includes("required character appearance")&&t.includes("rain wardrobe")&&t.includes("cannot replace this state")})()`),"missing-state guidance remains visible after manual master inclusion");

    /* Simulate the real cache completing later. The existing mounted Stage responds to
       nb-gen-done; no story mutation or remount is used for this clearance proof. */
    await c.eval(`window.__fixture.variantLoaded=true;window.dispatchEvent(new CustomEvent("nb-gen-done",{detail:{id:"char-mara:wardrobe"}}))`);
    await waitFor(()=>c.eval(`!((document.querySelector(".stage2-blocker-text")?.textContent||"").toLowerCase().includes("rain wardrobe"))`),"loaded character variant clears missing gate");
    /* The deliberately edited @ prompt now correctly has its separate source-drift
       review gate; acknowledge that only after proving the required-state gate cleared. */
    await waitFor(()=>c.eval(`document.querySelector(".stage2-blocker-act")?.textContent.trim()==="Confirm reviewed"`),"prompt drift review after state load");
    await c.eval(`document.querySelector(".stage2-blocker-act").click()`);
    try{
      await waitFor(()=>c.eval(`document.querySelector(".sd-gen-submit")?.getAttribute("aria-disabled")!=="true"`),"Generate unblocks after cache load");
    }catch(e){
      const blockerText=await c.eval(`document.querySelector(".stage2-blocker-text")?.textContent||""`);
      throw new Error(e.message+"; active blocker: "+blockerText);
    }
    const loadedBody=(await text()).toLowerCase();
    assert.match(loadedBody,/implicit prop reference is not an approved current version/,"optional unapproved reference remains a review warning");
    assert.doesNotMatch((await c.eval(`document.querySelector(".stage2-blocker")?.textContent||""`)).toLowerCase(),/implicit prop|unapproved/,"optional unapproved reference is not a hard blocker");
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
    console.log(`screenshots: ${OUT}/stage-shoot-desktop.png, ${OUT}/stage-desktop.png, ${OUT}/stage-mobile-390.png`);
    if(regressions.length) throw new Error("Stage regressions:\\n- "+regressions.join("\\n- "));
    console.log("PASS Stage browser regression");
  } finally {
    try{c?.close();}catch{}
    chrome.kill("SIGTERM"); server.close();
  }
}

main().catch(e=>{console.error("FAIL Stage browser regression\\n"+(e.stack||e));process.exitCode=1;});
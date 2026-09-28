#!/usr/bin/env node
/* Focused browser regression for the real screenplay-first OpeningBeatCard.
   It transpiles current app sources into an isolated React fixture: no login,
   persistence, cloud media, or paid generation boundary is present. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {transformSync} from "@babel/core";
import net from "node:net";
import crypto from "node:crypto";

const ROOT=new URL("../",import.meta.url), FIX="/tmp/fixture/browserfiles", OUT="/tmp/standalone-beat-card";
const CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium";
async function prep(){
  await mkdir(FIX,{recursive:true});await mkdir(OUT,{recursive:true});
  await writeFile(`${FIX}/styles.css`,await readFile(new URL("app/styles.css",ROOT)));
  const src=await readFile(new URL("app/shots-ui.jsx",ROOT),"utf8");
  const code=transformSync(src,{presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false}).code;
  await writeFile(`${FIX}/shots-ui.js`,code);
  // Keep the fixture honest about the card boundary: render the production
  // SheetFrame rather than a test-only Generate shell.  SheetFrame is a
  // self-contained function, so the browser fixture supplies only its small
  // modal/helper dependencies below.
  const artroom=await readFile(new URL("app/artroom.jsx",ROOT),"utf8");
  const sfStart=artroom.indexOf("function SheetFrame("),sfEnd=artroom.indexOf("\nwindow.SheetFrame",sfStart);
  if(sfStart<0||sfEnd<0) throw Error("could not extract SheetFrame from app/artroom.jsx");
  const sdStart=artroom.indexOf("function SheetDetails("),sdEnd=artroom.indexOf("\nfunction _qaWhereChips",sdStart);
  if(sdStart<0||sdEnd<0) throw Error("could not extract SheetDetails from app/artroom.jsx");
  const sheetDetails=transformSync(artroom.slice(sdStart,sdEnd),{presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false}).code;
  await writeFile(`${FIX}/sheet-details.js`,sheetDetails);
  const sheetFrame=transformSync(artroom.slice(sfStart,sfEnd),{presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false}).code;
  await writeFile(`${FIX}/sheet-frame.js`,sheetFrame);
  const app=await readFile(new URL("app/app.jsx",ROOT),"utf8");
  const progressStart=app.indexOf("function StudioProgressOverlay(");
  const progressEnd=app.indexOf("\n/* ---- alternate view:",progressStart);
  if(progressStart<0||progressEnd<0) throw Error("could not extract StudioProgressOverlay from app/app.jsx");
  const progress=transformSync(app.slice(progressStart,progressEnd)+"\nwindow.StudioProgressOverlay=StudioProgressOverlay;",{
    presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],
    babelrc:false,configFile:false
  }).code;
  await writeFile(`${FIX}/studio-progress.js`,progress);
  const styleUi=await readFile(new URL("app/stylebible-ui.jsx",ROOT),"utf8");
  const tipStart=styleUi.indexOf("function InfoTip("),tipAssign=styleUi.indexOf("window.InfoTip = InfoTip;",tipStart);
  if(tipStart<0||tipAssign<0) throw Error("could not extract InfoTip from app/stylebible-ui.jsx");
  const tipSource=styleUi.slice(tipStart,tipAssign+"window.InfoTip = InfoTip;".length);
  const infoTip=transformSync(tipSource,{presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false}).code;
  await writeFile(`${FIX}/infotip.js`,infoTip);
  await writeFile(`${FIX}/shot-screenplay.js`,await readFile(new URL("app/shot-screenplay.js",ROOT)));
  for(const [n,u] of Object.entries({"react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js","react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"})){
    try{if((await readFile(`${FIX}/${n}`)).length>10000)continue;}catch{}
    const r=await fetch(u);if(!r.ok)throw Error(`cache ${n}: ${r.status}`);await writeFile(`${FIX}/${n}`,Buffer.from(await r.arrayBuffer()));
  }
  await writeFile(`${FIX}/beat-keyframe.html`,html());
}
function html(){return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/styles.css><style>body{overflow:auto;background:#08090b;padding:24px}.beat-card-grid{max-width:980px;margin:auto}#seed-root{margin-top:1200px}</style></head><body><div id=root></div><div id=classic-root></div><div id=seed-root></div><div id=progress-root></div><script src=/react.js></script><script src=/react-dom.js></script><script>
 window.__fixture={calls:[],confirmations:[],errors:[],mounts:[]};window.addEventListener("error",e=>__fixture.errors.push(String(e.message)));window.addEventListener("unhandledrejection",e=>__fixture.errors.push(String(e.reason&&e.reason.message||e.reason)));
window.Icon=new Proxy({}, {get:(_,n)=>({s=12})=>React.createElement("svg",{"data-i":n,width:s,height:s})});
const px="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263d42"/></svg>');
 window.__fixture.frameState={"opening-1":"current","legacy-1":"current"};
 window.__fixture.chainStatus={};
 window.shotChainStatus=sh=>window.__fixture.chainStatus[sh&&sh.id]||"current";
  window.__pendingMode="";
  window.nbGetImage=id=>{if(window.__pendingMode&&id==="opening-1")return "";return ["opening-1","legacy-1","marcus","location-1","prop-1"].includes(id)?px:""};
 window.nbLoadImage=async id=>nbGetImage(id);window.nbGetMeta=id=>id==="opening-1"?{iso:"2026-09-11T00:00:00.000Z",version:4}:{};
  window.nbLoadPendingImageDeletion=async id=>window.__pendingMode&&id==="opening-1"?{
    pending:true,id:"opening-1",iso:"2026-09-11T00:00:00.000Z",version:4,url:"",
    ...(window.__pendingMode==="retained"?{retryable:false,status:"retained-unverified"}:{})
  }:null;
window.beatScriptText=()=>"";window.seedShotOf=(sh,list)=>sh&&!sh.anchor&&sh.id==="seed-target"?(list||[]).find(x=>x.id==="opening-1")||null:null;
window.shotAssetProvenanceStatus=(sh,draft,meta)=>__fixture.frameState[sh.id]||"unverified";
window.useImageGen=opts=>{const [mountedId]=React.useState(()=>{__fixture.mounts.push(opts.id);return opts.id});
  const forcedBusy=!!(__fixture.geningIds&&__fixture.geningIds[mountedId]);
   const historyMode=!!(__fixture.historyMode&&mountedId==="seed-target");
   const hasImage=!!__fixture.frameState[mountedId]&&!historyMode;
   const historyMeta={cleanupPurge:true,cleanupPurgeTarget:{id:"opening-1",iso:"2026-09-11T00:00:00.000Z",version:4},modelLabel:"Retained fixture",modelId:"fixture",aspect:"16:9",size:"Medium"};
   return {genUrl:hasImage?px:"",gening:forcedBusy,genMeta:historyMode?historyMeta:(hasImage?{modelLabel:"Fixture image",modelId:"fixture",aspect:"16:9",size:"Medium",...(__fixture.unapprovedSeed?{seedSource:{seedUnapproved:true}}:{})}:null),
    generate:()=>__fixture.calls.push(["gen",mountedId]),cancelGen:()=>{},clearGen:()=>{},importSheet:null,
     relatedClearCount:0,revertPrevious:()=>{},layers:historyMode?1:0,allModels:[],setEditMode:()=>{},editMode:false,editText:"",
     setEditText:()=>{},slotHasRef:false,retrying:false,pendingSave:null,genErr:"",saving:false,discardSave:()=>{},
     loadDetails:async()=>({id:mountedId,url:"",meta:historyMeta,refs:[],history:historyMode?[{url:px,meta:{version:3,modelLabel:"Earlier fixture"}}]:[]}),
     revertTo:async i=>{if(historyMode)__fixture.calls.push(["restore",mountedId,i])},
     deleteCurrentAndPromote:async()=>{__fixture.calls.push(["promote",mountedId])}}};
window.shotFrameGenOpts=sh=>({opts:{id:sh.id},finalPrompt:"",chainPrompt:"",renderPlan:null});
window.shotGrabImage=async id=>nbGetImage(id);
window.shotResolveLocationSpecImages=async(specs,grab)=>Promise.all((specs||[]).map(async s=>({...(s||{}),refId:s.refId||s.id,url:await grab(s.refId||s.id)})));
window.shotPropAttachable=()=>true;
window.inFrameCast=sh=>sh.subjects||[];window.inFrameProps=sh=>sh.props||[];
window.appConfirm=async opts=>{__fixture.confirmations.push(opts);return true};window.turnContinuity={drafts:{},props:[]};
window.sizeOf=v=>({label:v||"Medium"});window.angleOf=v=>({label:v||"Eye"});window.moveOf=v=>({label:v||"Static"});window.lensOf=v=>({label:v||"50"});
window.SHOT_SIZES=[{id:"Medium",label:"Medium"}];window.SHOT_ANGLES=[{id:"Eye",label:"Eye"}];window.SHOT_MOVES=[{id:"Static",label:"Static"}];window.SHOT_LENSES=[{id:"50",label:"50"}];
window.SHOT_CAMERA_BODIES=[{id:"auto",label:"Project default / None",family:"Camera"},{id:"arri_alexa35",label:"ARRI Alexa 35",family:"ARRI"}];window.SHOT_CAMERA_PROFILES=window.SHOT_CAMERA_BODIES;
window.SHOT_LENS_TYPES=[{id:"auto",label:"Auto"},{id:"spherical",label:"Spherical"}];
window.SHOT_FOCAL_LENGTHS=[{id:"auto",label:"Auto"},{id:"35",label:"35mm"},{id:"85",label:"85mm"}];
window.SHOT_APERTURES=[{id:"auto",label:"Auto"},{id:"f5_6",label:"f/5.6"}];
window.SHOT_SHUTTERS=[{id:"auto",label:"Auto"},{id:"natural",label:"Natural blur"}];
window.SHOT_ISO_GRAIN=[{id:"auto",label:"Auto"},{id:"clean",label:"Clean"}];
window.shotHasCameraSettings=sh=>Object.values((sh&&sh.cameraSettings)||{}).some(v=>v&&v!=="auto");
window.shotEffectiveCameraSettings=sh=>{const c=(sh&&sh.cameraSettings)||{},pick=(key,recommended,labels)=>{const selected=c[key]||"auto",auto=selected==="auto";return {auto,effectiveLabel:auto?recommended:(labels[selected]||selected)}};return {
  camera:pick("camera","ARRI Alexa 35",{arri_alexa35:"ARRI Alexa 35"}),lensType:pick("lensType","Spherical",{spherical:"Spherical"}),
  focalLength:pick("focalLength","35mm",{"35":"35mm","85":"85mm"}),aperture:pick("aperture","f/5.6",{f5_6:"f/5.6"}),
  shutter:pick("shutter","Natural blur",{natural:"Natural blur"}),iso:pick("iso","Clean",{clean:"Clean"})};};
window.shotCameraResolvedLine=()=>"Resolved camera settings fixture";
window.RefStripScroller=({className,children})=>React.createElement("div",{className},children);
window.nbResLabel=(w,h)=>w&&h?(Math.max(w,h)>=1536?"Large":"Medium")+" · "+w+"×"+h:"";window.nbAspectLabel=(w,h)=>w&&h?(w/h).toFixed(2):"";
window.nbImageDimensions=async()=>null;window.nbPrivateRefsNote=()=>"";
window.RegionEditModal=()=>null;window.PropReferenceModal=()=>null;window.PropSheetReferenceModal=()=>null;
window.nbResLabel=()=> "Medium";window.isGptImageModel=()=>false;window.remasterEligible=()=>false;window.remasterInstruction=()=> "Reproduce this image exactly.";
window.turnDownscaleDataUrl=async u=>u;window.nbCostChip=()=>null;window.NB_MODELS=[];
window.QaCheckButton=({name,className})=>React.createElement("button",{className:className||"qa-check-btn","data-qa":"check",title:"Run a realistic QA check on this frame (no generation)",onClick:()=>__fixture.calls.push(["qa",name])},"QA check");
window.CardFold=({label,children})=>React.createElement("details",{open:true},React.createElement("summary",null,label),children);window.SheetField=({label,value})=>React.createElement("label",null,label,React.createElement("textarea",{defaultValue:value||""}));window.CopyBox=({text})=>React.createElement("pre",null,text);window.shotNegativePrompt=()=>"";window.stagingHasContent=()=>false;
window.combinedShotPrompt=()=>"";window.buildShotPrompt=()=>"";window._circ=n=>String(n);window.deriveBeatMicroPlan=()=>null;window.resolveBeatMicroPlan=()=>null;
</script><script src=/infotip.js></script><script src=/sheet-details.js></script><script src=/sheet-frame.js></script><script src=/shot-screenplay.js></script><script src=/shots-ui.js></script><script>
const scene={id:"scene-1",no:1,title:"Control Room"};const chars=[{id:"marcus",name:"Marcus"},{id:"daniel",name:"Daniel"}];
const beatOneAction="MARCUS grips the transit map.",beatTwoAction="MARCUS checks the eastern console.";
const drafts={"scene-1":{blocks:[{type:"scene",text:"INT. CONTROL ROOM — NIGHT"},{beat:1,type:"action",text:beatOneAction},{beat:1,type:"char",text:"DANIEL (V.O.)"},{beat:1,type:"dia",text:"Take the east tunnel."},{beat:2,type:"action",text:beatTwoAction}]}};const ctx={charById:{marcus:chars[0],daniel:chars[1]},propById:{},drafts};window.turnContinuity={drafts,props:[]};const bm={rows:[{n:1},{n:2}],turnAt:1};
const sourceStamp=shotBeatScreenplay(scene,1,{drafts,characters:chars,beatsMap:bm}).sourceRev;
const shots=[{id:"opening-1",sceneId:"scene-1",beatN:1,order:1,keyframeMode:"beat-opening",sourceScreenplayRev:sourceStamp,subjects:["marcus"],covers:[1],purpose:"Caregiving presented as a timed case for recognition.",beatPlan:{micro:["MARCUS grips the transit map."]},size:"Medium",angle:"Eye",lens:"50",action:"Marcus grips the transit map."},{id:"legacy-1",sceneId:"scene-1",beatN:1,order:2,subjects:["marcus"],purpose:"The alternative's own purpose.",size:"Close",angle:"Low",lens:"85",action:"Legacy alternative."}];
 const props={lanesLen:2,bm,scene,ctx,characters:chars,propsAvail:[],ordered:shots,firstId:"opening-1",toggleHead:()=>{},onAddShot:(sid,n)=>__fixture.calls.push(["add",sid,n]),onUpdate:(id,patch)=>{const sh=shots.find(x=>x.id===id);if(sh&&patch)Object.assign(sh,patch);__fixture.calls.push(["update",id,patch||{}]);mount()},onDelete:()=>{},onView:(url,meta)=>__fixture.calls.push(["view",meta&&meta.name||"",url]),onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},onBatchDone:()=>{},batchActiveId:null,openShotId:null,setOpenShotId:()=>{},sceneStart:false,onRenderScene:()=>{},renderBusy:false,draftingBlocked:false,nextShotId:null,onRefineBeat:(s,n)=>__fixture.calls.push(["refine",s.id,n]),refiningBeat:false};
const root=ReactDOM.createRoot(document.getElementById("root")),classicRoot=ReactDOM.createRoot(document.getElementById("classic-root"));
function mount(batchActiveId=null){root.render(React.createElement("div",{className:"beat-card-grid"},React.createElement(OpeningBeatCard,{...props,batchActiveId,L:{n:1,shots}}),React.createElement(OpeningBeatCard,{...props,batchActiveId,L:{n:2,shots:[]}})))}
const classicShot={id:"classic-1",sceneId:"scene-1",beatN:1,order:1,size:"Medium",angle:"Eye",lens:"50",action:"Classic action.",purpose:"Classic purpose."};
window.__mountClassicFallback=()=>classicRoot.render(React.createElement("div",{className:"classic-fallback-fixture"},React.createElement(ShotCard,{sh:classicShot,scene,ctx,characters:chars,propsAvail:[],beatText:"Classic fallback copy",prevShot:null,laterShots:[],sceneShots:[classicShot],isHead:true,isFirst:true,onToggleHead:()=>{},onUpdate:()=>{},onDelete:()=>{},onView:()=>{},batchActiveId:null,onBatchDone:()=>{},onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},subLabel:null})));
window.__unmountClassicFallback=()=>classicRoot.render(null);
window.__changeSource=()=>{drafts["scene-1"].blocks[1].text="MARCUS tears the transit map in half.";mount()};
window.__restoreSource=()=>{drafts["scene-1"].blocks[1].text=beatOneAction;mount()};
window.__unsetPrimaryStamp=()=>{shots[0].sourceScreenplayRev=null;mount()};
window.__restorePrimaryStamp=()=>{shots[0].sourceScreenplayRev=sourceStamp;mount()};
window.__setFrameState=state=>{__fixture.frameState["opening-1"]=state;mount()};
window.__resetConfirmations=()=>{__fixture.confirmations=[]};
window.__resetCalls=()=>{__fixture.calls=[]};
window.__unlockPrimary=()=>{shots[0].locked=false;shots[0].sourceOverride=null;mount()};
window.__clearBeatTwoSource=()=>{drafts["scene-1"].blocks=drafts["scene-1"].blocks.filter(b=>Number(b.beat)!==2);mount()};
 window.__restoreBeatTwoSource=()=>{if(!drafts["scene-1"].blocks.some(b=>Number(b.beat)===2))drafts["scene-1"].blocks.push({beat:2,type:"action",text:beatTwoAction});mount()};
  window.__queueAlternative=()=>mount("legacy-1");mount();
 const seedRoot=ReactDOM.createRoot(document.getElementById("seed-root"));
 const seedScene={id:"scene-1",no:1,title:"Control Room"};
 const seedShots=[{id:"opening-1",sceneId:"scene-1",beatN:1,order:1,locked:true},{id:"seed-target",sceneId:"scene-1",beatN:1,order:2,anchor:false,size:"Medium",angle:"Eye",lens:"50",action:"Seed target."}];
 const seedProps={sh:seedShots[1],scene:seedScene,ctx,characters:chars,propsAvail:[],beatText:"Seed target.",prevShot:seedShots[0],laterShots:[],sceneShots:seedShots,isHead:false,isFirst:false,
   onToggleHead:()=>{},onUpdate:(id,patch)=>{Object.assign(seedShots.find(x=>x.id===id),patch||{});__fixture.calls.push(["update",id,patch||{}]);mountSeed()},
    onDelete:()=>{},onView:(url,meta)=>__fixture.calls.push(["view",meta&&meta.name||"",url]),onDeleteShotReference:()=>__fixture.calls.push(["deleteRef"]),
   batchActiveId:null,onBatchDone:()=>{},onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},subLabel:null};
   function mountSeed(key,batchActiveId){const fresh=!!seedShots[1].anchor;const live={...seedProps,isHead:fresh,prevShot:fresh?null:seedShots[0],onToggleHead:target=>seedProps.onUpdate(target.id,{anchor:!target.anchor}),batchActiveId};seedRoot.render(React.createElement(ShotCard,key?{...live,key}:live))}
  window.__mountSeed=()=>{__fixture.geningIds={};mountSeed()};
 window.__mountSeedBusy=()=>{__fixture.geningIds={"seed-target":true};mountSeed()};
   window.__mountSeedBatch=()=>{__fixture.geningIds={};mountSeed(null,"other-shot")};
  window.__mountSeedHistory=()=>{__fixture.geningIds={};__fixture.historyMode=true;window.__pendingMode="";mountSeed("history")};
  window.__mountSeedPending=()=>{__fixture.geningIds={};window.__pendingMode="pending";mountSeed("pending")};
  window.__mountSeedRetained=()=>{__fixture.geningIds={};window.__pendingMode="retained";mountSeed("retained")};
 </script><script src=/studio-progress.js></script><script>
 const progressRoot=ReactDOM.createRoot(document.getElementById("progress-root"));
 window.__mountProgress=(role,title,detail,progress)=>{
   progressRoot.render(React.createElement(StudioProgressOverlay,{role,title,detail,progress}));
 };
 window.__clearProgress=()=>progressRoot.render(null);
 window.__setDraftGate=(draftingBlocked,renderBusy)=>{
   props.draftingBlocked=!!draftingBlocked;props.renderBusy=!!renderBusy;mount();
 };
 </script></body></html>`}
function server(){return createServer(async(q,r)=>{const p=q.url==="/"?`${FIX}/beat-keyframe.html`:`${FIX}${q.url}`;try{r.end(await readFile(p));}catch{r.writeHead(404);r.end();}})}
class NativeWS{static async connect(url){const u=new URL(url),key=crypto.randomBytes(16).toString("base64"),s=net.connect(+u.port,u.hostname);let buf=Buffer.alloc(0);await new Promise((ok,bad)=>{s.once("error",bad);s.once("connect",()=>s.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));s.on("data",d=>{buf=Buffer.concat([buf,d]);if(buf.includes(Buffer.from("\r\n\r\n"))){if(!buf.toString().startsWith("HTTP/1.1 101"))bad(Error("CDP websocket handshake failed"));else ok()}})});const w=new NativeWS(s);s.on("data",d=>w.read(d));return w}constructor(s){this.s=s;this.buf=Buffer.alloc(0);this.onmessage=null}send(text){const p=Buffer.from(text),mask=crypto.randomBytes(4),h=p.length<126?Buffer.from([129,128|p.length]):Buffer.from([129,254,p.length>>8,p.length&255]);for(let i=0;i<p.length;i++)p[i]^=mask[i%4];this.s.write(Buffer.concat([h,mask,p]))}read(d){this.buf=Buffer.concat([this.buf,d]);while(this.buf.length>=2){let n=this.buf[1]&127,off=2;if(n===126){if(this.buf.length<4)return;n=this.buf.readUInt16BE(2);off=4}else if(n===127){if(this.buf.length<10)return;n=this.buf.readUInt32BE(6);off=10}if(this.buf.length<off+n)return;const x=this.buf.subarray(off,off+n).toString();this.buf=this.buf.subarray(off+n);this.onmessage&&this.onmessage({data:x})}}close(){this.s.destroy()}}
class CDP{constructor(ws){this.ws=ws;this.i=0;this.q=new Map;ws.onmessage=e=>{const x=JSON.parse(e.data),f=this.q.get(x.id);if(f){this.q.delete(x.id);f(x)}}}static async connect(u){return new CDP(await NativeWS.connect(u))}call(m,p={}){return new Promise((a,b)=>{const id=++this.i;this.q.set(id,x=>x.error?b(Error(x.error.message)):a(x.result));this.ws.send(JSON.stringify({id,method:m,params:p}))})}async eval(x){const r=await this.call("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.result.value}close(){this.ws.close()}}
async function wait(f,label){const end=Date.now()+10000;while(Date.now()<end){const value=await f();if(value)return value;await new Promise(r=>setTimeout(r,80))}throw Error("timeout "+label)}
async function main(){
  await prep();
  const s=server();await new Promise(a=>s.listen(0,"127.0.0.1",a));
  const port=s.address().port,dp=9500+Math.floor(Math.random()*300);
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox",`--remote-debugging-port=${dp}`,`--user-data-dir=${FIX}/beat-${process.pid}`,"about:blank"]);
  let c;
  try{
    const t=await wait(async()=>{try{return (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find(x=>x.type==="page")}catch{return null}},"chrome");
    c=await CDP.connect(t.webSocketDebuggerUrl);await c.call("Page.enable");
    await c.call("Page.navigate",{url:`http://127.0.0.1:${port}/`});
    await wait(()=>c.eval("document.querySelectorAll('.sheet-card.shot-card').length===2"),"cards");

    const fullSource=["INT. CONTROL ROOM — NIGHT","MARCUS grips the transit map.","DANIEL (V.O.)","Take the east tunnel."].join("\n");
    assert.equal(await c.eval("document.querySelectorAll('.sheet-card.shot-card').length"),2,
      "one standalone card is rendered for each beat including empty");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card,.beat-card-body,.bc-primary,.bc-preview,details.bc-screenplay').length"),0,
      "the simplified surface has no outer beat wrapper, preview duplicate, or old screenplay details");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card-grid .shot-beat-script:not(.bc-scripted)').length"),0,
      "OpeningBeatCard does not render a second source excerpt outside Scripted");
    assert.equal(await c.eval("!!document.querySelector('.shot-grammar-grid')"),true,
      "primary camera controls remain visible by default");
    assert.equal(await c.eval("document.querySelectorAll('.sheet-frame').length"),1,
      "the production SheetFrame source is rendered in the isolated fixture");
    assert.equal(await c.eval("document.querySelectorAll('.sheet-frame .sheet-gen-btn').length"),1,
      "the production SheetFrame keeps its single Generate control");

    const primary=".sheet-card.shot-card[data-shot-card=\"opening-1\"]";
    const choosePrimaryImageOption=async label=>{
      await c.eval(`document.querySelector('${primary} .sheet-gen-tool').click()`);
      await wait(()=>c.eval(`[...document.querySelectorAll('${primary} .sheet-tools-item')].some(x=>x.textContent.trim()===${JSON.stringify(label)})`),`${label} menu action`);
      await c.eval(`[...document.querySelectorAll('${primary} .sheet-tools-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`);
    };
    await wait(()=>c.eval("!!document.querySelector('.coverage-refs')"),"reference controls");
    const refPlacement=await c.eval(`(()=>{const card=document.querySelector('${primary}'),frame=card.querySelector('.sheet-frame'),refs=frame.querySelector('.shot-refs.coverage-refs'),row=frame.querySelector('.shot-refs-row.coverage-refs-row'),gen=frame.querySelector('.sheet-gen-row');return {
      inFrame:!!refs&&refs.parentElement===frame,header:refs&&refs.querySelector('.shot-refs-lab')?.textContent.trim(),
      row:!!row&&row.parentElement===refs,thumbs:refs?refs.querySelectorAll('.shot-ref-thumb').length:0,
      beforeGenerate:!!(refs&&gen&&(refs.compareDocumentPosition(gen)&Node.DOCUMENT_POSITION_FOLLOWING)),
      bodyRefs:card.querySelectorAll('.sheet-body .shot-refs').length
    }})()`);
    assert.deepEqual(refPlacement,{inFrame:true,header:"Reference images",row:true,thumbs:1,beforeGenerate:true,bodyRefs:0},
      "selectable reference images use the production SheetFrame slot above Generate, not the body");
    assert.equal(await c.eval("document.querySelector('.coverage-refs .shot-ref-tick').getAttribute('aria-pressed')"),"true",
      "included reference controls expose their current toggle state");
    assert.deepEqual(await c.eval(`(()=>{const thumb=document.querySelector('.coverage-refs .shot-ref-thumb'),preview=thumb.querySelector('.shot-ref-preview');return {wrapper:thumb.tagName,preview:preview.tagName,label:preview.getAttribute('aria-label')}})()`),
      {wrapper:"DIV",preview:"BUTTON",label:"Preview Marcus full size"},
      "reference thumbnails expose a dedicated, accessible preview button without nesting controls");
    await c.eval("window.__resetCalls();document.querySelector('.coverage-refs .shot-ref-preview').click()");
    const viewed=await c.eval("window.__fixture.calls[0]");
    assert.equal(viewed[0],"view","targeting a reference thumb enlarges it through the existing onView callback");
    assert.equal(viewed[1],"Marcus","reference enlargement preserves the source label");
    assert.match(viewed[2],/^data:image\/svg\+xml,/,"reference enlargement passes the real image URL");
    await c.eval("window.__resetCalls();document.querySelector('.coverage-refs .shot-ref-tick').click()");
    await wait(()=>c.eval("document.querySelector('.coverage-refs .shot-ref-tick')?.getAttribute('aria-pressed')==='false'"),"reference exclusion patch");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","opening-1",{refOff:["marcus"]}]],
      "excluding a reference sends the correct refOff inclusion patch");
    await c.eval("window.__resetCalls();document.querySelector('.coverage-refs .shot-ref-tick').click()");
    await wait(()=>c.eval("document.querySelector('.coverage-refs .shot-ref-tick')?.getAttribute('aria-pressed')==='true'"),"reference inclusion patch");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","opening-1",{refOff:[]}]],
      "re-including a reference clears only its exclusion");

    /* Reference inclusion is nondestructive. Attached seed/sheet thumbnails
       remain previewable; a Fresh shot hides its inactive seed and rejoins via
       the dedicated Fresh control. No destructive source-frame action exists. */
    const seedCard='[data-shot-card="seed-target"]';
    await c.eval("window.__mountSeed()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-tick')`),"seed reference controls");
    const seedGeometry=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),thumb=card.querySelector('.shot-ref-thumb.seed'),tick=thumb.querySelector('.shot-ref-tick'),preview=thumb.querySelector('.shot-ref-preview'),tr=thumb.getBoundingClientRect(),cr=tick.getBoundingClientRect();return {
      tick:tick.tagName,pressed:tick.getAttribute('aria-pressed'),disabled:tick.disabled,
      tickBottomRight:cr.right>tr.left+tr.width/2&&cr.bottom>tr.top+tr.height/2,
      delete:!!thumb.querySelector('.shot-ref-delete'),kind:thumb.querySelector('.shot-ref-kind')?.textContent,
      preview:preview?.tagName,previewLabel:preview?.getAttribute('aria-label')
    }})()`);
    assert.deepEqual(seedGeometry,{tick:"BUTTON",pressed:"true",disabled:false,tickBottomRight:true,delete:false,kind:"Seed",preview:"BUTTON",previewLabel:"Preview Previous shot · Beat 1 full size"},
      "seed is labelled, independently previewable, and has a nondestructive inclusion button with no delete action");
    await c.eval("window.__fixture.frameState['seed-target']='current';window.__fixture.chainStatus['seed-target']='stale';window.__mountSeed()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-seed-line.stale .shot-seed-refresh')`),"continuity refresh guidance");
    const staleSeedUi=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),line=card.querySelector('.shot-seed-line.stale');return {
      role:line?.getAttribute('role'),copy:line?.textContent.trim(),headerBadge:[...card.querySelectorAll('.shot-head-right .shot-source-badge')].some(x=>/Seed outdated/i.test(x.textContent))
    }})()`);
    assert.equal(staleSeedUi.role,"status","a proven chain mismatch remains an accessible status on its exact shot");
    assert.match(staleSeedUi.copy,/Continuity needs refresh — re-render this frame or render the scene in order\./,
      "the seed line explains the continuity repair in plain language");
    assert.equal(staleSeedUi.headerBadge,false,"the cryptic Seed outdated badge is absent from the compact header");
    await c.eval("window.__fixture.chainStatus['seed-target']='current';window.__mountSeed()");
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-seed-line')`),"clean compact continuity state");
    assert.equal(await c.eval(`document.querySelector('#seed-root ${seedCard}')?.textContent.includes('Seed: Beat')`),false,
      "a healthy continuity chain does not occupy the card with routine seed provenance");
    await c.eval("window.__fixture.unapprovedSeed=true;window.__mountSeed()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-seed-exception')`),"unapproved-seed exception");
    const seedException=await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-seed-line')?.textContent.trim()`);
    assert.equal(seedException,"Director override — rendered from an unapproved continuity frame.",
      "the exceptional seed choice remains visible without the routine version/count sentence");
    await c.eval("window.__fixture.unapprovedSeed=false;window.__mountSeed()");
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-seed-line')`),"exception cleared");

    const cameraAuto=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),panel=card.querySelector('.shot-camera-panel'),recommended=panel.querySelector('.shot-camera-reset'),help=panel.querySelector('.infotip');return {
      note:!!panel.querySelector('.shot-camera-note'),help:panel.querySelector('.infotip-btn')?.getAttribute('aria-label'),
      autoMarkers:panel.querySelectorAll('.shot-camera-auto').length,
      prefixed:[...panel.querySelectorAll('select option,.rs-trigger-lab')].some(x=>/Recommended:/i.test(x.textContent)),
      focal:[...panel.querySelectorAll('.shot-gsel')].find(x=>x.textContent.includes('Focal length'))?.querySelector('select')?.selectedOptions[0]?.textContent,
      focalLabel:[...panel.querySelectorAll('.shot-gsel')].find(x=>x.textContent.includes('Focal length'))?.querySelector('select')?.getAttribute('aria-label'),
      recommended:recommended?.textContent.trim(),recommendedOn:recommended?.classList.contains('on'),recommendedDisabled:recommended?.disabled,
      recommendedLeft:recommended?.getBoundingClientRect().left<help?.getBoundingClientRect().left
    }})()`);
    assert.deepEqual(cameraAuto,{note:false,help:"About automatic camera settings",autoMarkers:6,prefixed:false,focal:"35mm",focalLabel:"Focal length — automatic recommendation: 35mm",recommended:"Recommended",recommendedOn:true,recommendedDisabled:true,recommendedLeft:true},
      "Auto camera fields show clean resolved values, an always-visible selected Recommended mode, separate Auto markers and tooltip help");
    await c.eval(`window.__resetCalls();document.querySelector('#seed-root ${seedCard} .shot-camera-reset').click()`);
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],"the already-selected Recommended mode is disabled and cannot write a redundant patch");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-camera-head .infotip-btn').click()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-camera-head [role="tooltip"]')`),"camera guidance tooltip");
    const cameraTip=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),tip=card.querySelector('.shot-camera-head [role="tooltip"]'),cr=card.getBoundingClientRect(),tr=tip.getBoundingClientRect();return {copy:tip.textContent.trim(),rightInside:tr.right<=cr.right+1}})()`);
    assert.deepEqual(cameraTip,{copy:"Leave controls on Auto unless you want this shot to carry explicit camera language into the frame prompt.",rightInside:true},
      "camera guidance opens on demand and remains right-aligned inside its card");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-camera-head .infotip-btn').focus()`);
    await c.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"});
    await c.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-camera-head [role="tooltip"]')`),"camera guidance dismissed");
    await c.eval("seedShots[1].cameraSettings={focalLength:'85'};window.__mountSeed()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-camera-reset')?.disabled===false`),"custom camera reset");
    const cameraCustom=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),panel=card.querySelector('.shot-camera-panel'),reset=panel.querySelector('.shot-camera-reset'),help=panel.querySelector('.infotip'),focal=[...panel.querySelectorAll('.shot-gsel')].find(x=>x.textContent.includes('Focal length'));return {resetLeft:reset.getBoundingClientRect().left<help.getBoundingClientRect().left,resetEnabled:!reset.disabled,resetOn:reset.classList.contains('on'),markers:panel.querySelectorAll('.shot-camera-auto').length,focal:focal.querySelector('select').selectedOptions[0].textContent,customMarker:!!focal.querySelector('.shot-camera-auto')}})()`);
    assert.deepEqual(cameraCustom,{resetLeft:true,resetEnabled:true,resetOn:false,markers:5,focal:"85mm",customMarker:false},
      "Recommended reset is on the left and an explicit camera choice removes only its own Auto marker");
    await c.eval(`window.__resetCalls();document.querySelector('#seed-root ${seedCard} .shot-camera-reset').click()`);
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-camera-reset.on')?.disabled===true`),"camera controls reset to selected Recommended mode");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[0],["update","seed-target",{cameraSettings:{camera:"auto",lensType:"auto",focalLength:"auto",aperture:"auto",shutter:"auto",iso:"auto"}}],
      "the left reset preserves the all-Auto state transition while the Recommended mode remains visible");
    await c.eval("delete window.__fixture.frameState['seed-target'];window.__mountSeed()");
    await c.eval("window.__resetCalls();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-tick').click()");
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed')`),"seed exclusion anchor patch");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","seed-target",{anchor:true}]],
      "excluding the seed uses the durable fresh-start anchor instead of refOff");
    assert.equal(await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-anchor-btn').textContent.trim()`),"Fresh",
      "the dedicated Fresh control is the visible route back into the continuity chain");
    await c.eval("window.__resetCalls();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-anchor-btn').click()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed')`),"Fresh control rejoins seed chain");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","seed-target",{anchor:false}]],
      "clicking Fresh rejoins the chain and restores the active seed thumbnail");
    await c.eval("window.__resetCalls();window.__mountSeedBusy()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard}')?.classList.contains('gening')`),"seed generation active");
    assert.equal(await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick')?.disabled`),false,
      "reference checkbox remains enabled during active generation");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick').click()`);
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed')`),"active-generation exclusion");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-anchor-btn').click()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed')`),"active-generation Fresh rejoin");
    await c.eval("window.__mountSeedBatch()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard}')?.classList.contains('batch-on')===false`),"other-shot batch mount");
    assert.equal(await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick')?.disabled`),false,
      "reference checkbox remains enabled while another batch shot runs");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick').click()`);
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed')`),"batch exclusion");
    assert.equal(await c.eval("window.__fixture.calls.some(x=>x[0]==='gen'||x[0]==='deleteRef')"),false,
      "reference changes never call generation or delete callbacks");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-anchor-btn').click()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed')`),"restore chained seed for remaining fixtures");
    await c.eval("window.__mountSeed()");

    // Exact purge may leave current empty while retaining history. Details must
    // remain reachable and Restore must be an explicit action, never promotion
    // or generation on mount/menu open.
    await c.eval("window.__resetCalls();window.__mountSeedHistory()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .sheet-gen-tool')`),"retained history options entrypoint");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .sheet-gen-tool').click()`);
    await wait(()=>c.eval(`[...document.querySelectorAll('#seed-root ${seedCard} .sheet-tools-item')].some(x=>x.textContent.trim()==='Details')`),"retained history Details menu");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],"retained history inspection does not generate or promote");
    await c.eval(`[...document.querySelectorAll('#seed-root ${seedCard} .sheet-tools-item')].find(x=>x.textContent.trim()==='Details').click()`);
    await new Promise(r=>setTimeout(r,120));
    await wait(()=>c.eval("!!document.querySelector('.dt-overlay')&&document.querySelectorAll('.dt-hist-main').length===1"),"retained history Details modal");
    assert.equal(await c.eval("document.querySelector('.dt-current-actions')?.textContent.includes('Delete current image')"),true,
      "empty-current Details exposes retained history without silently restoring it");
    await c.eval("document.querySelector('.dt-hist-btn.restore').click()");
    await wait(()=>c.eval("window.__fixture.calls.some(x=>x[0]==='restore')"),"explicit retained history restore");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["restore","seed-target",0]],
      "restore is reachable only through the explicit earlier-version action");
    assert.equal(await c.eval("window.__fixture.calls.some(x=>x[0]==='gen'||x[0]==='promote')"),false,
      "history inspection/restore performs no automatic generation or promotion");
    await c.eval("document.querySelector('.dt-overlay .ag-x').click();__fixture.historyMode=false");

    // The compact chooser exposes all typed continuity sources, collapses an
    // aliased id, and never fires a generation while choosing references.
    await c.eval(`ctx.location={id:"loc-1",name:"Control Room"};seedShots[1].refOff=[];window.shotLocationReferenceChoices=()=>[
      {id:"place-house",label:"Father's House · INT · Night",category:"place"},
      {id:"unit-kitchen",label:"Kitchen · INT · Night",category:"unit"},
      {id:"unit-living",label:"Living Room · INT · Night",category:"unit"},
      {id:"coverage-wide",label:"Father's House coverage · wide",category:"coverage"},
      {id:"state-rain",label:"Father's House · rain-soaked",category:"state"},
      {id:"unit-living",label:"Living Room · night state",category:"state",categories:["unit","state"]}
    ];window.shotLocationCoverageSpecs=(loc,sh)=>sh.referenceLocationsSet
      ? (sh.referenceLocationIds||[]).map(id=>({id,source:"slugline-unit",note:id}))
      : [{id:"place-house",source:"slugline-unit",note:"Father's House"}];
    window.__mountSeed()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-location-picker')&&!!document.querySelector('#seed-root ${seedCard} .shot-ref-tick')`),"location reference picker");
    assert.deepEqual(await c.eval(`(()=>{const p=document.querySelector('#seed-root ${seedCard} .shot-location-picker');return {
      label:p.querySelector('.shot-location-picker-label').textContent.trim(),
       summary:p.querySelector('summary').textContent.trim(),
      seedTick:!!p.closest('.shot-card')?.querySelector('.shot-ref-tick'),
      seedDelete:!!p.closest('.shot-card')?.querySelector('.shot-ref-delete')
     }})()`),{label:"Location reference",summary:"Automatched reference(s)",seedTick:true,seedDelete:false},
       "location picker remains compact beside nondestructive seed controls");
    // Exercise the real native summaries with pointer/keyboard events. Closing
    // a menu is presentation-only: never mutate reference selection or images.
    await c.eval("mount();window.__resetCalls()");
    const seedPicker="#seed-root .shot-location-picker-menu";
    const peerPicker=primary+" .shot-location-picker-menu";
    await wait(()=>c.eval(`!!document.querySelector('${peerPicker}')`),"second card location picker");
    const pointerClick=async selector=>{
      let point=null;
      for(let attempt=0;attempt<4&&!point?.targetHit;attempt++){
       point=await c.eval(`(async()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center',inline:'nearest'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,width:r.width,height:r.height,targetHit:!!(r.width&&r.height&&hit&&(hit===el||el.contains(hit)))};})()`);
       if(!point?.targetHit) await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.ok(point?.targetHit,`pointer target is not hit-testable after scrolling: ${selector} (${JSON.stringify(point)})`);
      const {x,y}=point;
      await c.call("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
      await c.call("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
    };
    await pointerClick(seedPicker+" > summary");
    await wait(()=>c.eval(`document.querySelector('${seedPicker}').open`),"first picker opens");
    await pointerClick(peerPicker+" > summary");
    await wait(()=>c.eval(`document.querySelector('${peerPicker}').open&&!document.querySelector('${seedPicker}').open`),"other card replaces first picker");
    assert.equal(await c.eval("document.querySelectorAll('.shot-location-picker-menu[open]').length"),1,
      "only one reference dropdown can be open across separate card roots");
    await pointerClick(peerPicker+" > summary");
    await wait(()=>c.eval("document.querySelectorAll('.shot-location-picker-menu[open]').length===0"),"same summary toggles shut");
    await c.eval(`(()=>{const summary=document.querySelector('${seedPicker} > summary');summary.scrollIntoView({block:'center'});summary.focus()})()`);
    assert.equal(await c.eval(`document.activeElement===document.querySelector('${seedPicker} > summary')`),true,
      "the keyboard activation target is focused and on screen");
    await c.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r",unmodifiedText:"\r"});
    await c.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
    await wait(()=>c.eval(`document.querySelector('${seedPicker}').open`),"keyboard opens reference menu");
    await c.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await wait(()=>c.eval(`!document.querySelector('${seedPicker}').open`),"Escape dismisses reference menu");
    assert.equal(await c.eval(`document.activeElement===document.querySelector('${seedPicker} > summary')`),true,
      "Escape returns focus to the corresponding summary");
    await pointerClick(seedPicker+" > summary");
    await wait(()=>c.eval(`document.querySelector('${seedPicker}').open`),"reopen before outside click");
    await c.call("Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1});
    assert.equal(await c.eval(`document.querySelector('${seedPicker}').open`),true,
      "moving the pointer out alone does not interrupt reading a menu");
    await c.call("Input.dispatchMouseEvent",{type:"mousePressed",x:1,y:1,button:"left",clickCount:1});
    await c.call("Input.dispatchMouseEvent",{type:"mouseReleased",x:1,y:1,button:"left",clickCount:1});
    await wait(()=>c.eval("document.querySelectorAll('.shot-location-picker-menu[open]').length===0"),"blank-area pointer dismisses menu");
    await pointerClick(seedPicker+" > summary");
    await wait(()=>c.eval(`document.querySelector('${seedPicker}').open`),"reopen for outside control");
    await pointerClick(primary+' [data-qa="check"]');
    await wait(()=>c.eval("document.querySelectorAll('.shot-location-picker-menu[open]').length===0"),"outside control dismisses menu");
    assert.deepEqual(await c.eval("window.__fixture.calls.map(x=>x[0])"),["qa"],
      "outside dismissal does not swallow the clicked action or alter saved references");
    await pointerClick(seedPicker+" > summary");
    await wait(()=>c.eval(`document.querySelector('${seedPicker}').open`),"reopen for focus transfer");
    await c.eval(`document.querySelector('${primary} .shot-grammar-grid select').focus()`);
    await wait(()=>c.eval("document.querySelectorAll('.shot-location-picker-menu[open]').length===0"),"focus in another selector dismisses picker");
    await c.eval("window.__resetCalls();document.querySelector('#seed-root .shot-location-picker summary').click()");
    await wait(()=>c.eval("document.querySelectorAll('#seed-root .shot-location-picker-section').length===5"),"typed location sections");
    assert.equal(await c.eval("document.querySelectorAll('#seed-root .shot-location-check').length"),6,
      "shared unit/state asset is discoverable from both named taxonomy sections");
    assert.equal(await c.eval(`(()=>{const rows=[...document.querySelectorAll('#seed-root .shot-location-check')].filter(x=>x.textContent.includes('Living Room'));return rows.length===2&&rows.every(x=>x.querySelector('input').checked===false)})()`),true,
      "the two taxonomy aliases begin as one unselected attachment");
    await pointerClick("#seed-root .shot-location-check input");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-picker-summary span').textContent==='1 selected'`),"place selection");
    assert.equal(await c.eval(`document.querySelector('${seedPicker}').open`),true,
      "clicking a menu selection keeps the menu open across the shot update");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[0],["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["place-house"]}],
       "selecting a continuity place writes the exact explicit id");
    await c.eval("[...document.querySelectorAll('#seed-root .shot-location-check')].find(x=>x.textContent.includes('Living Room · INT')).querySelector('input').click()");
    await wait(()=>c.eval("window.__fixture.calls.length===2"),"shared alias selection");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[1],["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["place-house","unit-living"]}],
      "an alias attaches its shared exact ID only once");
    assert.equal(await c.eval(`(()=>{const rows=[...document.querySelectorAll('#seed-root .shot-location-check')].filter(x=>x.textContent.includes('Living Room'));return rows.length===2&&rows.every(x=>x.querySelector('input').checked)})()`),true,
      "unit and state aliases remain checked together");
    await wait(()=>c.eval(`document.querySelectorAll('#seed-root ${seedCard} .shot-ref-thumb.location').length===2`),"picker selections hydrate matching location thumbnails");
    await c.eval(`window.__resetCalls();[...document.querySelectorAll('#seed-root .shot-location-check')].find(x=>x.textContent.includes('Living Room · INT')).querySelector('input').click()`);
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-picker-summary span').textContent==='1 selected'`),"alias exclusion");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["place-house"]}]],
      "unchecking an alias removes its exact ID from this shot without touching the asset catalog");
    assert.equal(await c.eval(`(()=>{const rows=[...document.querySelectorAll('#seed-root .shot-location-check')].filter(x=>x.textContent.includes('Living Room'));return rows.length===2&&rows.every(x=>!x.querySelector('input').checked)&&document.querySelectorAll('#seed-root ${seedCard} .shot-ref-thumb.location').length===1})()`),true,
      "both aliases synchronize to unchecked and the removed location thumbnail disappears");
    await c.eval(`window.__resetCalls();[...document.querySelectorAll('#seed-root .shot-location-check')].find(x=>x.textContent.includes('Living Room')).querySelector('input').click()`);
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-picker-summary span').textContent==='2 selected'`),"alias reinclude");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["place-house","unit-living"]}]],
      "reticking either alias selects the catalog asset again");
    await c.eval("[...document.querySelectorAll('#seed-root .shot-location-check')].find(x=>x.textContent.includes('coverage')).querySelector('input').click()");
    await wait(()=>c.eval("window.__fixture.calls.length===2"),"cross category selection");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[1],["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["place-house","unit-living","coverage-wide"]}],
       "cross-category selections preserve earlier exact references");
    await c.eval("document.querySelector('#seed-root .shot-location-choice.auto').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-choice.auto')?.getAttribute('aria-pressed')==='true'`),"location auto selection");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[2],["update","seed-target",{referenceLocationsSet:false,referenceLocationIds:[]}],
       "Auto clears explicit ids without changing other references");
    // Scene-scoped discovery must not silently erase a previously saved choice.
    await c.eval(`window.shotLocationReferenceChoices=(loc,sh)=>[
      {id:"place-house",label:"Father's House · INT · Night",category:"place"},
      ...(sh.referenceLocationIds||[]).includes("other-scene-place")?
        [{id:"other-scene-place",label:"Funeral Home Office",category:"place",outOfScene:true}]:[]
    ];seedShots[1].referenceLocationsSet=true;seedShots[1].referenceLocationIds=["place-house","other-scene-place"];mountSeed()`);
    await wait(()=>c.eval(`!![...document.querySelectorAll('#seed-root ${seedCard} .shot-location-picker-section')].find(x=>x.querySelector('b')?.textContent==='Saved / outside this scene')`),"outside-scene saved selection");
    assert.equal(await c.eval(`(()=>{const section=[...document.querySelectorAll('#seed-root ${seedCard} .shot-location-picker-section')].find(x=>x.querySelector('b')?.textContent==='Saved / outside this scene');const input=section?.querySelector('input');return !!input&&input.checked&&!input.disabled&&section.textContent.includes('Funeral Home Office')})()`),true,
      "other-scene saved selection is separate and remains controllable");
    await c.eval(`window.__resetCalls();[...document.querySelectorAll('#seed-root ${seedCard} .shot-location-check')].find(x=>x.textContent.includes('Funeral Home Office')).querySelector('input').click()`);
    await wait(()=>c.eval("window.__fixture.calls.length===1"),"outside-scene selection removal");
    assert.deepEqual(await c.eval("window.__fixture.calls[0]"),["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["place-house"]}],
      "unchecking an outside-scene reference removes it from this shot");
    assert.equal(await c.eval(`!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.location.off')`),true,
      "an excluded outside-scene reference leaves no gray thumbnail");
    // A deleted scene location must not strand saved selections. The helper
    // returns its real unknown-shaped catalog record while another current-film
    // manual reference still hydrates into the thumbnail strip.
    await c.eval(`window.shotLocationReferenceChoices=(loc)=>loc?[]:[
      {id:"location-1",label:"Father's House · INT · Night",category:"place"},
      {id:"gone-plate",label:"Removed cellar plate",unavailable:true,category:"unknown",categories:["unknown"]}
     ];window.shotLocationCoverageSpecs=(loc,sh)=>sh.referenceLocationsSet?(sh.referenceLocationIds||[]).map(id=>({id,refId:id,note:id==="location-1"?"Father's House · INT · Night":"Removed cellar plate"})):[];ctx.location=null;seedShots[1].referenceLocationsSet=true;seedShots[1].referenceLocationIds=["location-1","gone-plate"];seedShots[1].refOff=[];mountSeed()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-location-picker')&&!!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.location img')`),"null-location picker and exact manual thumbnail");
    await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-picker summary').click();document.querySelector('#seed-root ${seedCard} .shot-location-picker').scrollIntoView({block:"center"})`);
    await wait(()=>c.eval(`!![...document.querySelectorAll('#seed-root ${seedCard} .shot-location-check')].find(x=>x.textContent.includes('Removed cellar plate'))`),"unknown saved row");
    assert.equal(await c.eval(`(()=>{const r=[...document.querySelectorAll('#seed-root ${seedCard} .shot-location-check')].find(x=>x.textContent.includes('Removed cellar plate'));const i=r&&r.querySelector('input');return !!i&&i.checked&&!i.disabled})()`),true,
      "unknown saved selections remain selected and removable when the scene location is absent");
    await c.eval("window.__resetCalls();[...document.querySelectorAll('#seed-root .shot-location-check')].find(x=>x.textContent.includes('Removed cellar plate')).querySelector('input').click()");
    await wait(()=>c.eval("window.__fixture.calls.length===1"),"unknown selection removal");
    assert.deepEqual(await c.eval("window.__fixture.calls[0]"),["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["location-1"]}],
      "unchecking an unavailable saved ID removes it from this shot");
    assert.equal(await c.eval(`(()=>{const r=[...document.querySelectorAll('#seed-root .shot-location-check')].find(x=>x.textContent.includes('Removed cellar plate'));return !!r&&!r.querySelector('input').checked&&r.querySelector('input').disabled&&!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.location.off')})()`),true,
      "removed unavailable location remains disclosed in the picker but leaves no gray thumbnail");
    // The update remount intentionally closes native <details>; open the same
    // surviving ShotCard only after that state settles, then prove its panel is
    // actually inside the captured viewport.
    await c.call("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await c.eval(`(()=>{const p=document.querySelector('#seed-root ${seedCard} .shot-location-picker');p.scrollIntoView({block:"center"});p.querySelector('summary').click()})()`);
    await wait(()=>c.eval(`(()=>{const d=document.querySelector('#seed-root ${seedCard} details.shot-location-picker-menu'),p=d&&d.querySelector('.shot-location-picker-panel'),r=p&&p.getBoundingClientRect();return !!d?.open&&!!r&&r.top>=0&&r.bottom<=innerHeight})()`),"desktop open chooser in viewport");
     const desktopPickerGeometry=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),menu=card.querySelector('.shot-location-picker-menu'),panel=menu.querySelector('.shot-location-picker-panel'),summary=menu.querySelector('summary'),cr=card.getBoundingClientRect(),pr=panel.getBoundingClientRect(),sr=summary.getBoundingClientRect();return {
       rightDelta:Math.abs(pr.right-sr.right),
       inset:pr.left>=cr.left+8&&pr.right<=cr.right-8,
       below:pr.top>=sr.bottom
     }})()`);
     assert.equal(desktopPickerGeometry.inset,true,"desktop chooser stays horizontally inside its owning shot card");
     assert.ok(desktopPickerGeometry.rightDelta<1,"desktop chooser is right-aligned with its summary field");
     assert.equal(desktopPickerGeometry.below,true,"desktop chooser opens below its picker row");
    const seedRoomShot=await c.call("Page.captureScreenshot",{format:"png"});
    await writeFile(`${OUT}/seed-reference-room-picker-open-desktop.png`,Buffer.from(seedRoomShot.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await c.eval(`(()=>{const p=document.querySelector('#seed-root ${seedCard} .shot-location-picker'),d=p.querySelector('details');p.scrollIntoView({block:"center"});d.open=true})()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} details.shot-location-picker-menu')?.open`),"mobile open chooser");
    await c.eval(`(()=>{const p=document.querySelector('#seed-root ${seedCard} .shot-location-picker-panel'),r=p.getBoundingClientRect();window.scrollTo(0,window.scrollY+Math.max(0,r.bottom-innerHeight+12))})()`);
    await wait(()=>c.eval(`(()=>{const p=document.querySelector('#seed-root ${seedCard} .shot-location-picker-panel'),r=p.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`),"mobile open chooser panel in viewport");
     const mobilePickerGeometry=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),menu=card.querySelector('.shot-location-picker-menu'),panel=menu.querySelector('.shot-location-picker-panel'),summary=menu.querySelector('summary'),cr=card.getBoundingClientRect(),pr=panel.getBoundingClientRect(),sr=summary.getBoundingClientRect();return {
       rightDelta:Math.abs(pr.right-sr.right),
       inset:pr.left>=cr.left+8&&pr.right<=cr.right-8,
       below:pr.top>=sr.bottom,
       fixed:getComputedStyle(panel).position==="fixed"
     }})()`);
     assert.equal(mobilePickerGeometry.inset,true,"mobile chooser stays horizontally inside its owning shot card");
     assert.ok(mobilePickerGeometry.rightDelta<1,"mobile chooser is right-aligned with its summary field");
     assert.equal(mobilePickerGeometry.below,true,"mobile chooser opens below its picker row");
     assert.equal(mobilePickerGeometry.fixed,false,"mobile chooser remains card-aligned instead of becoming a viewport sheet");
    const seedRoomMobileShot=await c.call("Page.captureScreenshot",{format:"png"});
    await writeFile(`${OUT}/seed-reference-room-picker-open-mobile.png`,Buffer.from(seedRoomMobileShot.data,"base64"));
    // Removed locations are no longer part of the live shot reference set, so
    // render/batch remounts cannot resurrect an excluded gray thumbnail.
    await c.eval("window.__mountSeedBusy()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard}')?.classList.contains('gening')`),"removed-reference generation mount");
    assert.equal(await c.eval(`!seedShots[1].referenceLocationIds.includes('gone-plate')&&!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.location.off')`),true,
      "a local render does not resurrect a removed location reference");
    await c.eval("window.__mountSeedBatch()");
    await wait(()=>c.eval(`!document.querySelector('#seed-root ${seedCard}').classList.contains('gening')`),"removed-reference batch mount");
    assert.equal(await c.eval(`!seedShots[1].referenceLocationIds.includes('gone-plate')&&!document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.location.off')`),true,
      "another shot's batch does not resurrect a removed location reference");

    // A source evicted after a partial purge remains disclosed, but this list
    // never offers retry/delete actions against the previous shot.
    await c.eval("seedShots[1].referenceLocationsSet=false;seedShots[1].referenceLocationIds=[];window.__resetCalls();window.__mountSeedPending()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-pending')`),"pending deletion tile");
    assert.deepEqual(await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}');return {
      pending:!!card.querySelector('.shot-ref-pending'),tick:!!card.querySelector('.shot-ref-tick'),
      delete:!!card.querySelector('.shot-ref-delete')
    }})()`),{pending:true,tick:false,delete:false},
      "pending source survives cache eviction as a status-only disclosure");
    assert.equal(await c.eval("window.__fixture.calls.some(x=>x[0]==='deleteRef')"),false,
      "pending disclosure has no delete/retry callback");
    await c.eval("window.__pendingMode=false");
    await c.eval("window.__mountSeedRetained()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-pending.retained-unverified')`),"retained unverified disclosure tile");
    assert.deepEqual(await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}');return {
      disclosure:card.querySelector('.shot-ref-pending.retained-unverified')?.textContent.trim(),
       delete:!!card.querySelector('.shot-ref-delete'),tick:!!card.querySelector('.shot-ref-tick')
    }})()`),{disclosure:"Deletion retained · review Details",delete:false,tick:false},
       "unidentifiable retained copy discloses status without any destructive action");
    await c.eval("window.__pendingMode='';window.__resetCalls()");
    const contextStats=await c.eval(`(()=>{const card=document.querySelector('${primary}'),ctx=card.querySelector('.shot-beat-context');return {
      stale:ctx.querySelectorAll('.bc-stale').length,buttons:ctx.querySelectorAll('button').length,
      laneButtons:ctx.querySelectorAll('.beat-lane-btn').length,selectors:ctx.querySelectorAll('.bc-alt-picker select').length,
      options:ctx.querySelectorAll('.bc-alt-picker option').length
    }})()`);
    assert.deepEqual(contextStats,{stale:0,buttons:0,laneButtons:0,selectors:0,options:0},
      "beat context is metadata only, with no permanent alternative selector or controls");
    assert.doesNotMatch(await c.eval("document.querySelector('.beat-card-grid').innerText"),
      /Add alternative/i,"the removed alternative dialog/control is absent");
    assert.equal(await c.eval("document.querySelectorAll('.bc-alt-picker').length"),0,
      "the removed alternative selector is absent from the DOM");
    assert.doesNotMatch(await c.eval("[...document.querySelectorAll('.shot-beat-context-head')].map(x=>x.textContent).join(' ')"),
      /Update from screenplay|Add alternative|Add shot|Opening keyframe|Shot Opening/i,
      "context headers have no legacy labels or controls");
    assert.equal(await c.eval("document.querySelectorAll('.shot-beat-tag.sub').length"),0,
      "the primary Opening card has no Shot Opening sublabel");
    assert.equal(await c.eval("document.querySelector('.shot-covers-chip').textContent.trim()"),"Covers",
      "coverage chips are descriptive and omit micro-beat numerals");
    assert.deepEqual(await c.eval(`(()=>{const card=document.querySelector('${primary}'),script=card.querySelector('.bc-scripted'),purpose=script.querySelector('.shot-purpose');return {
      last:script.lastElementChild===purpose,count:card.querySelectorAll('.shot-purpose').length,
      outside:!!card.querySelector('.sheet-body > .shot-purpose'),text:purpose?.querySelector('.shot-purpose-t')?.textContent,
      collapsed:!script.open
    }})()`),{last:true,count:1,outside:false,text:"Caregiving presented as a timed case for recognition.",collapsed:true},
      "Covers and purpose occur once as the final Scripted item while Scripted is collapsed");
    assert.equal(await c.eval("document.querySelectorAll('.bc-stale').length"),0,
      "matching sourceScreenplayRev starts current");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],
      "mounting and source inspection do not refine, update, or call the model");

    assert.equal(await c.eval(`document.querySelector('${primary} .bc-scripted').open`),false,
      "Scripted is collapsed by default");
    assert.deepEqual(await c.eval(`(()=>{const card=document.querySelector('${primary}'),script=card.querySelector('.bc-scripted');return {
      summary:script.querySelector('summary').textContent.trim(),
      copy:script.querySelector('.bc-screenplay-copy').textContent,
      onScreen:script.querySelector('.bc-cast-line:not(.remote)').textContent.trim(),
      remote:script.querySelector('.bc-cast-line.remote').textContent.trim(),
      details:card.querySelectorAll('.bc-scripted').length,
      copies:card.querySelectorAll('.bc-screenplay-copy').length,
      fallbackPreview:card.querySelectorAll('.shot-beat-script-body').length,
      sourceNote:script.querySelectorAll('.bc-source-note').length
    }})()`),{
      summary:"Scripted",copy:fullSource,onScreen:"On-screen: Marcus",remote:"Remote audio / text: Daniel",
      details:1,copies:1,fallbackPreview:0,sourceNote:0
    },"full screenplay and cast evidence live exactly once in collapsed Scripted");
    await c.eval(`document.querySelector('${primary} .bc-scripted').open=true`);
    assert.equal(await c.eval(`document.querySelector('${primary} .bc-scripted').open`),true,
      "Scripted expands to reveal the exact source");
    assert.equal(await c.eval(`document.querySelector('${primary} .bc-scripted .bc-screenplay-copy').textContent`),fullSource,
      "expanded Scripted preserves exact full screenplay text");
    assert.equal(await c.eval(`document.querySelectorAll('${primary} .bc-cast-line.remote').length`),1,
      "remote cast evidence is separate from on-screen cast");
    const review=await c.eval(`(()=>{const card=document.querySelector('${primary}'),row=card.querySelector('.shot-review-actions');return {
      present:!!row,labels:row?[...row.children].map(x=>x.textContent.trim()):[],
      redraft:!!row&&!!row.querySelector('.shot-redraft-btn'),qa:!!row&&!!row.querySelector('[data-qa="check"]'),
      outsideScripted:!!row&&!row.closest('.bc-scripted'),
      scriptedActions:card.querySelectorAll('.bc-scripted-actions,.bc-scripted .shot-redraft-btn').length,
      title:row&&row.querySelector('.shot-redraft-btn')?.title||""
    }})()`);
    assert.deepEqual(review.labels,["Draft specification","QA check"],"Draft specification sits immediately before the realistic QA check");
    assert.equal(review.present,true,"generated primary card exposes review actions");
    assert.equal(review.redraft,true,"the renamed writing-model action remains available");
    assert.equal(review.qa,true,"the card keeps an adjacent QA check");
    assert.equal(review.outsideScripted,true,"review actions live outside Scripted");
    assert.equal(review.scriptedActions,0,"Scripted contains no duplicate redraft button or cost action");
    assert.match(review.title,/writing-model credits/i,"Redraft keeps the writing-model cost disclosure in its tooltip");
    assert.doesNotMatch(await c.eval(`document.querySelector('${primary} .bc-scripted').textContent`),/writing-model credits/i,
      "Scripted does not repeat the Redraft cost explanation");
    assert.equal(await c.eval("document.querySelectorAll('.shot-source-badge.current').length"),0,
      "current source status has no redundant Source current badge");
    assert.equal(await c.eval(`(()=>[...document.querySelectorAll('${primary} .shot-head-right button')].some(x=>/^(Approve|Approved)$/.test(x.textContent.trim())))()`),false,
      "frame approval no longer occupies the compact shot header");

    await c.eval("window.__unsetPrimaryStamp()");
    await wait(()=>c.eval("document.querySelectorAll('.bc-source-note').length===1"),"quiet unstamped note");
    const quiet=await c.eval(`(()=>{const card=document.querySelector('${primary}'),note=card.querySelector('.bc-source-note');return {
      inScripted:!!note.closest('details.bc-scripted'),note:note.textContent,stale:card.querySelectorAll('.bc-stale').length,
      loud:card.querySelectorAll('.bc-unverified').length,oldBanner:card.querySelectorAll('.bc-screenplay').length
    }})()`);
    assert.equal(quiet.inScripted,true,"an unstamped frame note stays inside Scripted");
    assert.match(quiet.note,/no saved screenplay-version stamp/i,"unstamped status is a quiet source note");
    assert.equal(quiet.stale,0,"an unstamped frame is not falsely called stale");
    assert.equal(quiet.loud,0,"the removed loud unverified banner is absent");
    assert.equal(quiet.oldBanner,0,"the old screenplay banner is absent");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],
      "unset/restore provenance does not trigger hidden refine or model calls");
    await c.eval("window.__restorePrimaryStamp()");
    await wait(()=>c.eval("document.querySelectorAll('.bc-source-note').length===0"),"restored stamp");
    assert.equal(await c.eval("document.querySelectorAll('.bc-stale').length"),0,
      "restoring the current source stamp clears the quiet note without a stale warning");

    await c.eval("window.__setFrameState('stale');window.__resetConfirmations();");
    assert.equal(await c.eval(`(()=>[...document.querySelectorAll('.shot-head-right .shot-source-badge')].some(x=>/Stale source/i.test(x.textContent)))()`),false,
      "the redundant Stale source badge stays out of the compact header");
    await choosePrimaryImageOption("Approve frame as seed");
    await wait(()=>c.eval("window.__fixture.confirmations.length===1"),"stale approval guard");
    assert.match(await c.eval("window.__fixture.confirmations[0].title"),/stale historical frame/i,
      "stale approval still requires explicit confirmation");
    assert.equal(await c.eval("window.__fixture.confirmations[0].confirmLabel"),"Approve with override",
      "stale approval keeps its explicit override action");
    await c.eval("window.__unlockPrimary();window.__setFrameState('unverified');window.__resetConfirmations();");
    assert.equal(await c.eval("document.querySelectorAll('.shot-source-badge.unverified').length"),0,
      "legacy provenance stays out of the compact shot header");
    await choosePrimaryImageOption("Approve frame as seed");
    await wait(()=>c.eval("window.__fixture.confirmations.length===1"),"unverified approval guard");
    assert.match(await c.eval("window.__fixture.confirmations[0].title"),/unverified legacy frame/i,
      "unverified approval still requires explicit confirmation");
    await c.eval("window.__setFrameState('current');window.__resetCalls()");

    await c.eval("window.__changeSource()");
    await wait(()=>c.eval("document.querySelectorAll('.bc-stale').length===1"),"source revision staleness");
    assert.match(await c.eval("document.querySelector('.bc-stale').textContent"),/Screenplay changed since this opening keyframe/,
      "an actual screenplay change remains visibly stale");
    assert.doesNotMatch(await c.eval("document.body.innerText"),/Source changed — update from screenplay/,
      "the removed old stale banner is not reintroduced");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],
      "a real source change still does not auto-update, refine, or call the model");
    await c.eval("window.__restoreSource()");

     await c.eval("window.__resetCalls();window.__setDraftGate(true,false)");
     await wait(()=>c.eval(`document.querySelector('${primary} .shot-redraft-btn')?.disabled===true`),"drafting gate");
     assert.equal(await c.eval(`document.querySelector('${primary} .shot-redraft-btn').textContent.trim()`),
       "Draft specification","draftingBlocked keeps the real Draft specification button's wording");
     await c.eval(`document.querySelector('${primary} .shot-redraft-btn').click()`);
     assert.deepEqual(await c.eval("window.__fixture.calls"),[],
       "OpeningBeatCard does not enter the App draft handler while another specification draft is active");
     await c.eval("window.__setDraftGate(false,true)");
     await wait(()=>c.eval(`document.querySelector('${primary} .shot-redraft-btn')?.disabled===true`),"render gate");
     await c.eval(`document.querySelector('${primary} .shot-redraft-btn').click()`);
     assert.deepEqual(await c.eval("window.__fixture.calls"),[],
       "OpeningBeatCard does not enter the App draft handler while scene rendering is active");
     await c.eval("window.__setDraftGate(false,false)");
     await wait(()=>c.eval(`document.querySelector('${primary} .shot-redraft-btn')?.disabled===false`),"draft gates clear");
     assert.equal(await c.eval(`document.querySelector('${primary} [data-testid="shot-draft-spec"]')?.getAttribute("data-testid")`),
       "shot-draft-spec","the real OpeningBeatCard exposes the Draft specification control as the tested control");
     await c.eval(`document.querySelector('${primary} .shot-redraft-btn').click()`);
    await wait(()=>c.eval("window.__fixture.calls.filter(x=>x[0]==='refine'&&x[1]==='scene-1'&&x[2]===1).length===1"),"beat one refine callback");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["refine","scene-1",1]],
      "Redraft outside Scripted calls scene-1 beat 1 once");
    assert.match(await c.eval(`document.querySelector('${primary} .shot-redraft-btn').title`),/writing-model credits/,
      "Redraft keeps its writing credits boundary in the tooltip");
    assert.equal(await c.eval("document.querySelectorAll('.shot-beat-context .beat-lane-btn').length"),0,
      "Redraft is not duplicated in beat context");

    await c.eval("window.__clearBeatTwoSource()");
    await wait(()=>c.eval("document.querySelectorAll('.opening-beat-empty').length===1"),"empty beat two");
    const empty=await c.eval(`(()=>{const card=document.querySelectorAll('.sheet-card.shot-card')[1],button=card.querySelector('.beat-lane-btn');return {
      text:button&&button.textContent.trim(),disabled:!!(button&&button.disabled),
      insideScripted:!!(button&&button.closest('.bc-scripted')),empty:card.classList.contains('opening-beat-empty')
    }})()`);
    assert.deepEqual(empty,{text:"Draft opening keyframe",disabled:true,insideScripted:false,empty:true},
      "a source-free missing primary keeps Draft opening keyframe outside the fold and disabled");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["refine","scene-1",1]],
      "the empty source state makes no automatic callback");
    await c.eval("window.__restoreBeatTwoSource()");
    await wait(()=>c.eval("!document.querySelectorAll('.sheet-card.shot-card')[1].querySelector('.beat-lane-btn').disabled"),"fresh beat two source");
    assert.equal(await c.eval("document.querySelectorAll('.sheet-card.shot-card')[1].querySelector('.bc-screenplay-copy').textContent"),"MARCUS checks the eastern console.",
      "fresh beat-two screenplay is shown as its own source");
    await c.eval("document.querySelectorAll('.sheet-card.shot-card')[1].querySelector('.beat-lane-btn').click()");
    await wait(()=>c.eval("window.__fixture.calls.filter(x=>x[0]==='refine'&&x[1]==='scene-1'&&x[2]===2).length===1"),"beat two draft callback");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["refine","scene-1",1],["refine","scene-1",2]],
      "a source-backed missing primary enables Draft opening keyframe for beat 2");

    await c.eval("window.__mountClassicFallback()");
    await wait(()=>c.eval("!!document.querySelector('.classic-fallback-fixture .shot-beat-script-body')"),"classic fallback");
    assert.equal(await c.eval("document.querySelector('.classic-fallback-fixture .shot-beat-script-body').textContent"),"Classic fallback copy",
      "a classic ShotCard without scriptedContent keeps beatText fallback");
    assert.equal(await c.eval("document.querySelectorAll('.classic-fallback-fixture .bc-scripted').length"),0,
      "classic fallback remains a plain ShotCard excerpt");
    assert.equal(await c.eval("document.querySelector('.classic-fallback-fixture .shot-beat-script').lastElementChild?.textContent"),"Classic purpose.",
      "classic source excerpts keep their own purpose last inside Scripted too");
    await c.eval("window.__unmountClassicFallback()");
    await wait(()=>c.eval("document.querySelectorAll('.classic-fallback-fixture').length===0"),"remove classic fallback");

    await c.eval(`document.querySelector('${primary} .sheet-gen-tool').click()`);
    const menu=await c.eval(`(()=>[...document.querySelectorAll('${primary} .sheet-tools-item')].filter(x=>/View (primary|alternative)/.test(x.textContent)).map(x=>({text:x.textContent.trim(),disabled:x.disabled,title:x.title})))()`);
    assert.deepEqual(menu.map(x=>x.text),["View primary frame","View alternative 1 · Close"],
      "existing alternatives are named in the real SheetFrame menu");
    assert.equal(menu[0].disabled,true,"the currently displayed primary choice is disabled");
    assert.equal(menu[1].disabled,false,"an undisplayed alternative remains selectable");
    assert.match(menu[1].title,/view and edit this existing shot/i,"alternative menu entries explain that they only switch the displayed shot");
    await c.eval(`window.__resetCalls();[...document.querySelectorAll('${primary} .sheet-tools-item')].find(x=>x.textContent.includes('View alternative 1')).click()`);
    await wait(()=>c.eval("document.querySelector('.sheet-card.shot-card').dataset.shotCard==='legacy-1'"),"alternative menu selection");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card-grid .sheet-card.shot-card[data-shot-card=\"legacy-1\"]').length"),1,
      "the existing alternative remains selectable as one correctly keyed card");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card-grid .sheet-card.shot-card[data-shot-card=\"opening-1\"]').length"),0,
      "selecting an alternative remounts the displayed ShotCard instead of hiding a second one");
    assert.equal(await c.eval("window.__fixture.mounts.at(-1)"),"legacy-1",
      "alternative selection remounts the image generator with the alternative key");
    assert.equal(await c.eval("document.querySelector('[data-shot-card=\"legacy-1\"] .bc-scripted').lastElementChild?.textContent"),"The alternative's own purpose.",
      "the final Scripted purpose belongs to the displayed alternative, not the primary");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],
      "selecting an alternative does not call generation");
    assert.match(await c.eval("document.querySelector('.shot-beat-tag.sub')?.textContent.trim()"),/Alternative 1$/,
      "the displayed alternative retains the informative Alternative 1 sublabel");
    await c.eval(`document.querySelector('.sheet-card.shot-card .sheet-gen-tool').click()`);
    const altMenu=await c.eval(`(()=>[...document.querySelectorAll('.sheet-card.shot-card .sheet-tools-item')].filter(x=>/View (primary|alternative)/.test(x.textContent)).map(x=>({text:x.textContent.trim(),disabled:x.disabled})))()`);
    assert.deepEqual(altMenu,[{text:"View primary frame",disabled:false},{text:"View alternative 1 · Close",disabled:true}],
      "the current alternative choice is disabled while the primary remains accessible");
    await c.eval(`[...document.querySelectorAll('.sheet-card.shot-card .sheet-tools-item')].find(x=>x.textContent.includes('View primary frame')).click()`);
    await wait(()=>c.eval("document.querySelector('.sheet-card.shot-card').dataset.shotCard==='opening-1'"),"primary menu selection");
    assert.equal(await c.eval("document.querySelectorAll('.shot-beat-tag.sub').length"),0,
      "returning to primary removes the alternative sublabel");
    await c.eval(`document.querySelector('${primary} .bc-scripted').open=true`);
    for(const [w,name,columns] of [[1280,"desktop",3],[820,"tablet",2],[390,"mobile",1]]){
      await c.call("Emulation.setDeviceMetricsOverride",{width:w,height:900,deviceScaleFactor:1,mobile:w<500});
      assert.equal(await c.eval("getComputedStyle(document.querySelector('.beat-card-grid')).gridTemplateColumns.split(' ').length"),columns,`${name} uses ${columns} card columns`);
      assert.equal(await c.eval("document.documentElement.scrollWidth<=window.innerWidth"),true,`${name} card does not overflow`);
      const reviewRow=await c.eval(`(()=>{const card=document.querySelector('${primary}'),r=card.querySelector('.shot-review-actions'),kids=r?[...r.children]:[],bounds=card.getBoundingClientRect(),row=r.getBoundingClientRect();return {wrap:getComputedStyle(r).flexWrap,width:row.width,scroll:r.scrollWidth,contained:row.left>=bounds.left&&row.right<=bounds.right,sameLine:kids.length===2&&Math.abs(kids[0].getBoundingClientRect().top-kids[1].getBoundingClientRect().top)<1}})()`);
      assert.equal(reviewRow.wrap,"nowrap",`${name} Draft specification and QA review row does not wrap`);
      assert.equal(reviewRow.sameLine,true,`${name} Draft specification and QA remain on one row`);
      assert.equal(reviewRow.contained,true,`${name} neither review button is clipped by the card`);
      const headerButtons=await c.eval(`(()=>[...document.querySelectorAll('${primary} .shot-head-right .shot-anchor-btn, ${primary} .shot-head-right .shot-lock-btn')].map(b=>{const s=getComputedStyle(b);return {text:b.textContent.trim(),height:b.getBoundingClientRect().height,borderWidth:s.borderTopWidth,borderStyle:s.borderTopStyle,borderRadius:s.borderTopLeftRadius}}))()`);
      assert.equal(headerButtons.length,3,`${name} keeps Head, Draft specification and QA controls without an approval chip`);
      for(const button of headerButtons) assert.deepEqual({...button,text:undefined},{text:undefined,height:24,borderWidth:"1px",borderStyle:"solid",borderRadius:"7px"},
        `${name} ${button.text} matches the shared header button geometry`);
      for(const theme of ["dark","light"]){
        const compact=await c.eval(`(async()=>{document.documentElement.dataset.theme=${JSON.stringify(theme)};
          const script=document.querySelector('${primary} .bc-scripted');script.open=false;
          script.scrollIntoView({block:'center'});
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const style=getComputedStyle(script);return {
            height:script.getBoundingClientRect().height,
            summaryHeight:script.querySelector('summary').getBoundingClientRect().height,
            padding:style.padding,borderLeft:style.borderLeftWidth,
            neutralBorder:style.borderLeftColor===style.borderTopColor,
            fontStyle:style.fontStyle,last:script.lastElementChild.className
          };
        })()`);
        assert.deepEqual(compact,{height:32,summaryHeight:30,padding:"0px",borderLeft:"1px",
          neutralBorder:true,fontStyle:"normal",last:"shot-purpose"},
          `${name} ${theme} Scripted is compact with a neutral border; Covers remains last`);
        if(theme==="light"){
          const closed=await c.call("Page.captureScreenshot",{format:"png"});
          await writeFile(`${OUT}/scripted-compact-${name}.png`,Buffer.from(closed.data,"base64"));
        }
      }
      await c.eval(`document.documentElement.dataset.theme='dark';document.querySelector('${primary} .bc-scripted').open=true`);
      const x=await c.call("Page.captureScreenshot",{format:"png"});
      await writeFile(`${OUT}/${name}.png`,Buffer.from(x.data,"base64"));
    }

     /*
      * The actual shared StudioProgressOverlay is mounted from app.jsx, not a
      * look-alike fixture. Exercise its role/status contract at desktop,
      * tablet, and mobile widths, including the no-fake-percentage path.
      */
     for(const [w,name,role] of [[1280,"progress-desktop","Screenwriter"],[820,"progress-tablet","Casting Director"],[390,"progress-mobile","Shot Designer"]]){
       await c.call("Emulation.setDeviceMetricsOverride",{width:w,height:900,deviceScaleFactor:1,mobile:w<500});
       await c.eval(`window.__mountProgress(${JSON.stringify(role)},${JSON.stringify("Drafting specification")},${JSON.stringify("Writing the current screenplay into a reviewable shot specification.")},null)`);
       await wait(()=>c.eval(`!!document.querySelector(".studio-progress-overlay")`),`${name} progress overlay`);
       const noPct=await c.eval(`(()=>{const el=document.querySelector(".studio-progress-overlay");return {
         role:el.getAttribute("role"),live:el.getAttribute("aria-live"),atomic:el.getAttribute("aria-atomic"),
         label:el.getAttribute("aria-label"),text:el.innerText,progress:!!el.querySelector('[role="progressbar"]')
       }})()`);
       assert.deepEqual(noPct,{
         role:"status",live:"polite",atomic:"true",label:"Drafting specification",
         text:role.toUpperCase()+"\nDrafting specification\nWriting the current screenplay into a reviewable shot specification.",
         progress:false
       },`${name} uses the shared accessible progress status without inventing a percentage`);
       await c.eval(`window.__mountProgress(${JSON.stringify(role)},${JSON.stringify("Drafting specification")},${JSON.stringify("Writing the current screenplay into a reviewable shot specification.")},37)`);
       await wait(()=>c.eval(`document.querySelector('.studio-progress-overlay [role="progressbar"]')?.getAttribute("aria-valuenow")==="37"`),`${name} real progress`);
       assert.equal(await c.eval(`document.querySelector('.studio-progress-overlay [role="progressbar"]').getAttribute("aria-label")`),"Progress",
         `${name} labels the real progressbar`);
       const x=await c.call("Page.captureScreenshot",{format:"png"});
       await writeFile(`${OUT}/${name}.png`,Buffer.from(x.data,"base64"));
     }
     await c.eval("window.__clearProgress()");

    await c.eval("window.__queueAlternative()");
    await wait(()=>c.eval("window.__fixture.calls.filter(x=>x[0]==='gen').length===1"),"single queued alternative driver");
    assert.deepEqual(await c.eval("window.__fixture.calls.filter(x=>x[0]==='gen')"),[["gen","legacy-1"]],
      "the queued alternative has exactly one active generator owner");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card-grid .sheet-card.batch-on').length"),1,
      "only the queued alternative card is batch-active");
    assert.equal(await c.eval("document.querySelector('.beat-card-grid .sheet-card.batch-on').dataset.shotCard"),"legacy-1",
      "the sole batch owner is the selected alternative");
    assert.equal(await c.eval("window.__fixture.mounts.at(-1)"),"legacy-1",
      "the queued alternative retains its correctly keyed generator remount");
    await c.eval("document.querySelector('.sheet-card.shot-card .sheet-gen-tool').click()");
    const batchMenu=await c.eval(`(()=>[...document.querySelectorAll('.sheet-card.shot-card .sheet-tools-item')].filter(x=>/View (primary|alternative)/.test(x.textContent)).map(x=>({text:x.textContent.trim(),disabled:x.disabled})))()`);
    assert.deepEqual(batchMenu,[{text:"View primary frame",disabled:true},{text:"View alternative 1 · Close",disabled:true}],
      "all alternative choices stay disabled while a batch frame is active");

    assert.deepEqual(await c.eval("window.__fixture.errors"),[]);
     console.log(`standalone beat card browser regression passed\\nscreenshots: ${OUT}/desktop.png, ${OUT}/mobile.png, ${OUT}/seed-reference-room-picker-open-desktop.png, ${OUT}/seed-reference-room-picker-open-mobile.png, ${OUT}/progress-desktop.png, ${OUT}/progress-tablet.png, ${OUT}/progress-mobile.png`);
  }catch(error){
    if(c) console.error("Browser failure state:",await c.eval(`({
      errors:window.__fixture?.errors,focus:document.activeElement?.outerHTML,
      openMenus:[...document.querySelectorAll('.shot-location-picker-menu[open]')].map(x=>x.closest('.shot-card')?.dataset.shotCard)
    })`));
    throw error;
  }finally{c?.close();chrome.kill();s.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});

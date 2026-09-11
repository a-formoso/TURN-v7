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
  await writeFile(`${FIX}/shot-screenplay.js`,await readFile(new URL("app/shot-screenplay.js",ROOT)));
  for(const [n,u] of Object.entries({"react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js","react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"})){
    try{if((await readFile(`${FIX}/${n}`)).length>10000)continue;}catch{}
    const r=await fetch(u);if(!r.ok)throw Error(`cache ${n}: ${r.status}`);await writeFile(`${FIX}/${n}`,Buffer.from(await r.arrayBuffer()));
  }
  await writeFile(`${FIX}/beat-keyframe.html`,html());
}
function html(){return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/styles.css><style>body{overflow:auto;background:#08090b;padding:24px}.beat-card-grid{max-width:980px;margin:auto}</style></head><body><div id=root></div><div id=classic-root></div><div id=seed-root></div><div id=progress-root></div><script src=/react.js></script><script src=/react-dom.js></script><script>
 window.__fixture={calls:[],confirmations:[],errors:[],mounts:[]};window.addEventListener("error",e=>__fixture.errors.push(String(e.message)));window.addEventListener("unhandledrejection",e=>__fixture.errors.push(String(e.reason&&e.reason.message||e.reason)));
window.Icon=new Proxy({}, {get:(_,n)=>({s=12})=>React.createElement("svg",{"data-i":n,width:s,height:s})});
const px="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263d42"/></svg>');
 window.__fixture.frameState={"opening-1":"current","legacy-1":"current"};
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
   return {genUrl:hasImage?px:"",gening:forcedBusy,genMeta:historyMode?historyMeta:(hasImage?{modelLabel:"Fixture image",modelId:"fixture",aspect:"16:9",size:"Medium"}:null),
    generate:()=>__fixture.calls.push(["gen",mountedId]),cancelGen:()=>{},clearGen:()=>{},importSheet:null,
     relatedClearCount:0,revertPrevious:()=>{},layers:historyMode?1:0,allModels:[],setEditMode:()=>{},editMode:false,editText:"",
     setEditText:()=>{},slotHasRef:false,retrying:false,pendingSave:null,genErr:"",saving:false,discardSave:()=>{},
     loadDetails:async()=>({id:mountedId,url:"",meta:historyMeta,refs:[],history:historyMode?[{url:px,meta:{version:3,modelLabel:"Earlier fixture"}}]:[]}),
     revertTo:async i=>{if(historyMode)__fixture.calls.push(["restore",mountedId,i])},
     deleteCurrentAndPromote:async()=>{__fixture.calls.push(["promote",mountedId])}}};
window.shotFrameGenOpts=sh=>({opts:{id:sh.id},finalPrompt:"",chainPrompt:"",renderPlan:null});
window.shotGrabImage=async id=>nbGetImage(id);
window.shotResolveLocationSpecImages=async()=>[];
window.shotPropAttachable=()=>true;
window.inFrameCast=sh=>sh.subjects||[];window.inFrameProps=sh=>sh.props||[];
window.appConfirm=async opts=>{__fixture.confirmations.push(opts);return true};window.turnContinuity={drafts:{},props:[]};
window.sizeOf=v=>({label:v||"Medium"});window.angleOf=v=>({label:v||"Eye"});window.moveOf=v=>({label:v||"Static"});window.lensOf=v=>({label:v||"50"});
window.SHOT_SIZES=[{id:"Medium",label:"Medium"}];window.SHOT_ANGLES=[{id:"Eye",label:"Eye"}];window.SHOT_MOVES=[{id:"Static",label:"Static"}];window.SHOT_LENSES=[{id:"50",label:"50"}];
window.SHOT_CAMERA_BODIES=[];window.SHOT_LENS_TYPES=[];window.SHOT_FOCAL_LENGTHS=[];window.SHOT_APERTURES=[];window.SHOT_SHUTTERS=[];window.SHOT_ISO_GRAIN=[];
window.RefStripScroller=({className,children})=>React.createElement("div",{className},children);
window.nbResLabel=(w,h)=>w&&h?(Math.max(w,h)>=1536?"Large":"Medium")+" · "+w+"×"+h:"";window.nbAspectLabel=(w,h)=>w&&h?(w/h).toFixed(2):"";
window.nbImageDimensions=async()=>null;window.nbPrivateRefsNote=()=>"";
window.RegionEditModal=()=>null;window.PropReferenceModal=()=>null;window.PropSheetReferenceModal=()=>null;
window.nbResLabel=()=> "Medium";window.isGptImageModel=()=>false;window.remasterEligible=()=>false;window.remasterInstruction=()=> "Reproduce this image exactly.";
window.turnDownscaleDataUrl=async u=>u;window.nbCostChip=()=>null;window.NB_MODELS=[];
window.QaCheckButton=({name,className})=>React.createElement("button",{className:className||"qa-check-btn","data-qa":"check",title:"Run a realistic QA check on this frame (no generation)",onClick:()=>__fixture.calls.push(["qa",name])},"QA check");
window.CardFold=({label,children})=>React.createElement("details",{open:true},React.createElement("summary",null,label),children);window.SheetField=({label,value})=>React.createElement("label",null,label,React.createElement("textarea",{defaultValue:value||""}));window.CopyBox=({text})=>React.createElement("pre",null,text);window.shotNegativePrompt=()=>"";window.stagingHasContent=()=>false;
window.combinedShotPrompt=()=>"";window.buildShotPrompt=()=>"";window._circ=n=>String(n);window.deriveBeatMicroPlan=()=>null;window.resolveBeatMicroPlan=()=>null;
</script><script src=/sheet-details.js></script><script src=/sheet-frame.js></script><script src=/shot-screenplay.js></script><script src=/shots-ui.js></script><script>
const scene={id:"scene-1",no:1,title:"Control Room"};const chars=[{id:"marcus",name:"Marcus"},{id:"daniel",name:"Daniel"}];
const beatOneAction="MARCUS grips the transit map.",beatTwoAction="MARCUS checks the eastern console.";
const drafts={"scene-1":{blocks:[{type:"scene",text:"INT. CONTROL ROOM — NIGHT"},{beat:1,type:"action",text:beatOneAction},{beat:1,type:"char",text:"DANIEL (V.O.)"},{beat:1,type:"dia",text:"Take the east tunnel."},{beat:2,type:"action",text:beatTwoAction}]}};const ctx={charById:{marcus:chars[0],daniel:chars[1]},propById:{},drafts};window.turnContinuity={drafts,props:[]};const bm={rows:[{n:1},{n:2}],turnAt:1};
const sourceStamp=shotBeatScreenplay(scene,1,{drafts,characters:chars,beatsMap:bm}).sourceRev;
const shots=[{id:"opening-1",sceneId:"scene-1",beatN:1,order:1,keyframeMode:"beat-opening",sourceScreenplayRev:sourceStamp,subjects:["marcus"],covers:[1],beatPlan:{micro:["MARCUS grips the transit map."]},size:"Medium",angle:"Eye",lens:"50",action:"Marcus grips the transit map."},{id:"legacy-1",sceneId:"scene-1",beatN:1,order:2,subjects:["marcus"],size:"Close",angle:"Low",lens:"85",action:"Legacy alternative."}];
 const props={lanesLen:2,bm,scene,ctx,characters:chars,propsAvail:[],ordered:shots,firstId:"opening-1",toggleHead:()=>{},onAddShot:(sid,n)=>__fixture.calls.push(["add",sid,n]),onUpdate:(id,patch)=>{const sh=shots.find(x=>x.id===id);if(sh&&patch)Object.assign(sh,patch);__fixture.calls.push(["update",id,patch||{}]);mount()},onDelete:()=>{},onView:(url,meta)=>__fixture.calls.push(["view",meta&&meta.name||"",url]),onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},onBatchDone:()=>{},batchActiveId:null,openShotId:null,setOpenShotId:()=>{},sceneStart:false,onRenderScene:()=>{},renderBusy:false,draftingBlocked:false,nextShotId:null,onRefineBeat:(s,n)=>__fixture.calls.push(["refine",s.id,n]),refiningBeat:false};
const root=ReactDOM.createRoot(document.getElementById("root")),classicRoot=ReactDOM.createRoot(document.getElementById("classic-root"));
function mount(batchActiveId=null){root.render(React.createElement("div",{className:"beat-card-grid"},React.createElement(OpeningBeatCard,{...props,batchActiveId,L:{n:1,shots}}),React.createElement(OpeningBeatCard,{...props,batchActiveId,L:{n:2,shots:[]}})))}
const classicShot={id:"classic-1",sceneId:"scene-1",beatN:1,order:1,size:"Medium",angle:"Eye",lens:"50",action:"Classic action."};
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
 let deletePending=false,resolveDelete=null;
 const seedProps={sh:seedShots[1],scene:seedScene,ctx,characters:chars,propsAvail:[],beatText:"Seed target.",prevShot:seedShots[0],laterShots:[],sceneShots:seedShots,isHead:false,isFirst:false,
   onToggleHead:()=>{},onUpdate:(id,patch)=>{Object.assign(seedShots.find(x=>x.id===id),patch||{});__fixture.calls.push(["update",id,patch||{}]);mountSeed()},
   onDelete:()=>{},onView:()=>{},onDeleteShotReference:async(shotId,ref)=>{__fixture.calls.push(["deleteRef",shotId,ref]);if(deletePending)await new Promise(r=>{resolveDelete=r})},
   batchActiveId:null,onBatchDone:()=>{},onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},subLabel:null};
  function mountSeed(key){seedRoot.render(React.createElement(ShotCard,key?{...seedProps,key}:seedProps))}
  window.__mountSeed=()=>{__fixture.geningIds={};mountSeed()};
 window.__mountSeedBusy=()=>{__fixture.geningIds={"seed-target":true};mountSeed()};
  window.__mountSeedHistory=()=>{__fixture.geningIds={};__fixture.historyMode=true;window.__pendingMode="";mountSeed("history")};
  window.__mountSeedPending=()=>{__fixture.geningIds={};window.__pendingMode="pending";mountSeed("pending")};
  window.__mountSeedRetained=()=>{__fixture.geningIds={};window.__pendingMode="retained";mountSeed("retained")};
 window.__startDeletePending=()=>{deletePending=true};
 window.__resolveDelete=()=>{deletePending=false;if(resolveDelete){const r=resolveDelete;resolveDelete=null;r()}};
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
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox",`--remote-debugging-port=${dp}`,`--user-data-dir=${FIX}/beat-${process.pid}`]);
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
    await c.eval("window.__resetCalls();document.querySelector('.coverage-refs .shot-ref-thumb').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
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

    /*
     * Seed controls are real buttons too: the bottom-right inclusion tick uses
     * the existing anchor:true fresh-start state, while the separate bottom-left
     * control permanently deletes only the exact source version. Exercise the
     * actual positions, pointer click, disabled generation gate, keyboard
     * reattach, pending-delete latch and callback payload without any generation.
     */
    const seedCard='[data-shot-card="seed-target"]';
    await c.eval("window.__mountSeed()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-tick')`),"seed reference controls");
    const seedGeometry=await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}'),thumb=card.querySelector('.shot-ref-thumb.seed'),tick=thumb.querySelector('.shot-ref-tick'),del=thumb.querySelector('.shot-ref-delete'),tr=thumb.getBoundingClientRect(),cr=tick.getBoundingClientRect(),dr=del.getBoundingClientRect();return {
      tick:tick.tagName,pressed:tick.getAttribute('aria-pressed'),disabled:tick.disabled,
      tickBottomRight:cr.right>tr.left+tr.width/2&&cr.bottom>tr.top+tr.height/2,
      deleteBottomLeft:dr.left<tr.left+tr.width/2&&dr.bottom>tr.top+tr.height/2,
      deleteLabel:del.getAttribute('aria-label'),deleteTitle:del.title,approvalTag:!!thumb.querySelector('.shot-ref-seedtag')
    }})()`);
    assert.deepEqual(seedGeometry,{tick:"BUTTON",pressed:"true",disabled:false,tickBottomRight:true,deleteBottomLeft:true,
      deleteLabel:"Delete reference image permanently",
      deleteTitle:"Delete reference image permanently — permanently removes this source image version, not the shot or its takes.",
      approvalTag:false},"seed has a real bottom-right inclusion button and distinct permanent-delete button");
    await c.eval("window.__resetCalls();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-tick').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick')?.getAttribute('aria-pressed')==='false'`),"seed exclusion anchor patch");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","seed-target",{anchor:true}]],
      "excluding the seed uses the durable fresh-start anchor instead of refOff");
    assert.equal(await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-thumb.seed').classList.contains('off')`),true,
      "excluded seed remains visible as an unticked candidate");
    await c.eval("window.__resetCalls();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-tick').focus();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-tick').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick')?.getAttribute('aria-pressed')==='true'`),"seed keyboard reattach");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["update","seed-target",{anchor:false}]],
      "Enter on the real seed button re-attaches the candidate");
    await c.eval("window.__resetCalls();window.__mountSeedBusy()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-tick')?.disabled===true`),"seed generation disable");
    assert.equal(await c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-delete')?.disabled`),true,
      "permanent delete is disabled during active generation");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],
      "reference controls never call generation while their controls are disabled");
    await c.eval("window.__mountSeed()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard}')?.classList.contains('gening')===false`),"seed idle remount");
    await c.eval("window.__startDeletePending();window.__resetCalls();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-delete').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-delete')?.disabled===true`),"pending delete disable");
    await c.eval("document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-delete').click()");
    assert.equal(await c.eval("window.__fixture.calls.filter(x=>x[0]==='deleteRef').length"),1,
      "the local pending latch prevents duplicate permanent-delete callbacks");
    const deleteCall=await c.eval("window.__fixture.calls.find(x=>x[0]==='deleteRef')");
    assert.deepEqual(deleteCall.slice(0,2),["deleteRef","seed-target"],"delete callback receives the owning shot id");
    assert.deepEqual(deleteCall[2],{id:"opening-1",iso:"2026-09-11T00:00:00.000Z",version:4,url:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"#263d42\"/></svg>')},
      "delete callback receives exact seed id, ISO, version and URL identity");
    await c.eval("window.__resolveDelete()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-delete')?.disabled===false`),"delete latch release");
    assert.equal(await c.eval("window.__fixture.calls.filter(x=>x[0]==='gen').length"),0,
      "seed inclusion/exclusion/delete tests make no paid generation calls");

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

    // Location choices use the beat-scoped generated-unit contract, preserve
    // multi-selects, and leave the real seed controls visible beside the picker.
    await c.eval(`ctx.location={id:"loc-1",name:"Control Room"};window.shotLocationReferenceChoices=()=>[
      {id:"unit-kitchen",label:"Kitchen · INT · NIGHT"},
      {id:"unit-living",label:"Living Room · INT · NIGHT"}
    ];window.shotLocationCoverageSpecs=(loc,sh)=>sh.referenceLocationsSet
      ? (sh.referenceLocationIds||[]).map(id=>({id,source:"slugline-unit",note:id}))
      : [{id:"unit-kitchen",source:"slugline-unit",note:"Kitchen"}];
    window.__mountSeed()`);
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-location-picker')&&!!document.querySelector('#seed-root ${seedCard} .shot-ref-tick')`),"location reference picker");
    assert.deepEqual(await c.eval(`(()=>{const p=document.querySelector('#seed-root ${seedCard} .shot-location-picker');return {
      label:p.querySelector('.shot-location-picker-label').textContent.trim(),
      choices:[...p.querySelectorAll('.shot-location-choice')].map(x=>x.textContent.trim()),
      seedTick:!!p.closest('.shot-card')?.querySelector('.shot-ref-tick'),
      seedDelete:!!p.closest('.shot-card')?.querySelector('.shot-ref-delete')
    }})()`),{label:"Location reference",choices:["Auto","Kitchen · INT · NIGHT","Living Room · INT · NIGHT"],seedTick:true,seedDelete:true},
      "location picker exposes Auto plus exact generated room labels without replacing seed controls");
    await c.eval("window.__resetCalls();document.querySelector('#seed-root .shot-location-choice:not(.auto)').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-choice.on')?.textContent.trim()==='Kitchen · INT · NIGHT'`),"location kitchen selection");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[0],["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["unit-kitchen"]}],
      "selecting a generated room writes the explicit location id");
    await c.eval("document.querySelector('#seed-root .shot-location-choice:nth-of-type(3)').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-choice.on')?.textContent.includes('Kitchen')&&document.querySelectorAll('#seed-root ${seedCard} .shot-location-choice.on').length===2`),"location multi-selection");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[1],["update","seed-target",{referenceLocationsSet:true,referenceLocationIds:["unit-kitchen","unit-living"]}],
      "selecting a second room preserves the first explicit location id");
    await c.eval("document.querySelector('#seed-root .shot-location-choice.auto').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-location-choice.auto')?.getAttribute('aria-pressed')==='true'`),"location auto selection");
    assert.deepEqual((await c.eval("window.__fixture.calls"))[2],["update","seed-target",{referenceLocationsSet:false,referenceLocationIds:[]}],
      "Auto clears explicit room ids without changing other references");
    const seedRoomShot=await c.call("Page.captureScreenshot",{format:"png"});
    await writeFile(`${OUT}/seed-reference-room-picker.png`,Buffer.from(seedRoomShot.data,"base64"));

    // A source evicted after a partial purge remains a visible pending tile and
    // exposes Retry, but never gets an inclusion checkbox for its unusable image.
    await c.eval("window.__resetCalls();window.__mountSeedPending()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-pending')`),"pending deletion tile");
    assert.deepEqual(await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}');const b=card.querySelector('.shot-ref-delete');return {
      pending:!!card.querySelector('.shot-ref-pending'),tick:!!card.querySelector('.shot-ref-tick'),
      retry:b&&b.getAttribute('aria-label'),disabled:b&&b.disabled
    }})()`),{pending:true,tick:false,retry:"Retry image deletion",disabled:false},
      "pending source survives cache eviction as a retry-only tile");
    await c.eval("window.__startDeletePending();document.querySelector('#seed-root [data-shot-card=\"seed-target\"] .shot-ref-delete').click()");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-delete')?.disabled===true`),"pending retry disable");
    const pendingDeleteCall=await c.eval("window.__fixture.calls.find(x=>x[0]==='deleteRef')");
    assert.equal(pendingDeleteCall[2].pending,true,"retry callback preserves pending deletion identity");
    assert.deepEqual(pendingDeleteCall[2],{id:"opening-1",iso:"2026-09-11T00:00:00.000Z",version:4,url:"",pending:true},
      "retry sends the frozen pending target even without a source URL");
    await c.eval("window.__resolveDelete();window.__pendingMode=false");
    await wait(()=>c.eval(`document.querySelector('#seed-root ${seedCard} .shot-ref-delete')?.disabled===false`),"pending retry latch release");
    await c.eval("window.__mountSeedRetained()");
    await wait(()=>c.eval(`!!document.querySelector('#seed-root ${seedCard} .shot-ref-pending.retained-unverified')`),"retained unverified disclosure tile");
    assert.deepEqual(await c.eval(`(()=>{const card=document.querySelector('#seed-root ${seedCard}');return {
      disclosure:card.querySelector('.shot-ref-pending.retained-unverified')?.textContent.trim(),
      retry:!!card.querySelector('.shot-ref-delete'),tick:!!card.querySelector('.shot-ref-tick')
    }})()`),{disclosure:"Deletion retained · review Details",retry:false,tick:false},
      "unidentifiable retained copy discloses status without promising an impossible Retry");
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
    await wait(()=>c.eval("document.querySelector('.shot-source-badge.stale')?.textContent==='Stale source'"),"stale frame status");
    assert.equal(await c.eval("document.querySelectorAll('.shot-source-badge.current').length"),0,
      "stale frames retain a warning without restoring Source current");
    await c.eval("document.querySelector('button[title^=\"Approve this historical frame\"]').click()");
    await wait(()=>c.eval("window.__fixture.confirmations.length===1"),"stale approval guard");
    assert.match(await c.eval("window.__fixture.confirmations[0].title"),/stale historical frame/i,
      "stale approval still requires explicit confirmation");
    assert.equal(await c.eval("window.__fixture.confirmations[0].confirmLabel"),"Approve with override",
      "stale approval keeps its explicit override action");
    await c.eval("window.__unlockPrimary();window.__setFrameState('unverified');window.__resetConfirmations();");
    await wait(()=>c.eval("document.querySelector('.shot-source-badge.unverified')?.textContent==='Source unverified'"),"unverified frame status");
    await c.eval("document.querySelector('button[title^=\"Approve this historical frame\"]').click()");
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
      const headerButtons=await c.eval(`(()=>[...document.querySelectorAll('${primary} .shot-head-right .shot-anchor-btn, ${primary} .shot-head-right .shot-lock-btn')].map(b=>({text:b.textContent.trim(),height:b.getBoundingClientRect().height})))()`);
      assert.equal(headerButtons.length,4,`${name} includes Head, approval, Draft specification and QA controls`);
      for(const button of headerButtons) assert.equal(button.height,24,`${name} ${button.text} matches the shared header button height`);
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
         text:"MUSE · "+role.toUpperCase()+"\nDrafting specification\nWriting the current screenplay into a reviewable shot specification.",
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
     console.log(`standalone beat card browser regression passed\\nscreenshots: ${OUT}/desktop.png, ${OUT}/mobile.png, ${OUT}/seed-reference-room-picker.png, ${OUT}/progress-desktop.png, ${OUT}/progress-tablet.png, ${OUT}/progress-mobile.png`);
  }finally{c?.close();chrome.kill();s.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
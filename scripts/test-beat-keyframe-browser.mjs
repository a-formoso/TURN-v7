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
  await writeFile(`${FIX}/shot-screenplay.js`,await readFile(new URL("app/shot-screenplay.js",ROOT)));
  for(const [n,u] of Object.entries({"react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js","react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"})){
    try{if((await readFile(`${FIX}/${n}`)).length>10000)continue;}catch{}
    const r=await fetch(u);if(!r.ok)throw Error(`cache ${n}: ${r.status}`);await writeFile(`${FIX}/${n}`,Buffer.from(await r.arrayBuffer()));
  }
  await writeFile(`${FIX}/beat-keyframe.html`,html());
}
function html(){return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/styles.css><style>body{overflow:auto;background:#08090b;padding:24px}.beat-card-grid{max-width:980px;margin:auto}</style></head><body><div id=root></div><div id=classic-root></div><script src=/react.js></script><script src=/react-dom.js></script><script>
window.__fixture={calls:[],errors:[],mounts:[]};window.addEventListener("error",e=>__fixture.errors.push(String(e.message)));
window.Icon=new Proxy({}, {get:(_,n)=>({s=12})=>React.createElement("svg",{"data-i":n,width:s,height:s})});
const px="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263d42"/></svg>');
window.nbGetImage=id=>id==="opening-1"?px:"";window.nbLoadImage=async id=>nbGetImage(id);window.nbGetMeta=()=>({});
window.beatScriptText=()=>"";window.seedShotOf=()=>null;
window.useImageGen=opts=>{const [mountedId]=React.useState(()=>{__fixture.mounts.push(opts.id);return opts.id});return {genUrl:"",gening:false,genMeta:null,generate:()=>__fixture.calls.push(["gen",mountedId])}};window.shotFrameGenOpts=()=>({opts:{},finalPrompt:"",chainPrompt:"",renderPlan:null});
window.inFrameCast=sh=>sh.subjects||[];window.inFrameProps=()=>[];window.appConfirm=async()=>true;window.turnContinuity={drafts:{},props:[]};
window.sizeOf=v=>({label:v||"Medium"});window.angleOf=v=>({label:v||"Eye"});window.moveOf=v=>({label:v||"Static"});window.lensOf=v=>({label:v||"50"});
window.SHOT_SIZES=[{id:"Medium",label:"Medium"}];window.SHOT_ANGLES=[{id:"Eye",label:"Eye"}];window.SHOT_MOVES=[{id:"Static",label:"Static"}];window.SHOT_LENSES=[{id:"50",label:"50"}];
window.SHOT_CAMERA_BODIES=[];window.SHOT_LENS_TYPES=[];window.SHOT_FOCAL_LENGTHS=[];window.SHOT_APERTURES=[];window.SHOT_SHUTTERS=[];window.SHOT_ISO_GRAIN=[];
window.SheetFrame=({name,gen})=>React.createElement("div",{className:"sheet-frame"},React.createElement("div",{className:"sheet-frame-name"},name),React.createElement("button",{className:"gen-actions",onClick:()=>gen.generate()},"Generate"));
window.CardFold=({label,children})=>React.createElement("details",{open:true},React.createElement("summary",null,label),children);window.SheetField=({label,value})=>React.createElement("label",null,label,React.createElement("textarea",{defaultValue:value||""}));window.CopyBox=({text})=>React.createElement("pre",null,text);window.shotNegativePrompt=()=>"";window.stagingHasContent=()=>false;
window.combinedShotPrompt=()=>"";window.buildShotPrompt=()=>"";window._circ=n=>String(n);window.deriveBeatMicroPlan=()=>null;window.resolveBeatMicroPlan=()=>null;
</script><script src=/shot-screenplay.js></script><script src=/shots-ui.js></script><script>
const scene={id:"scene-1",no:1,title:"Control Room"};const chars=[{id:"marcus",name:"Marcus"},{id:"daniel",name:"Daniel"}];
const beatOneAction="MARCUS grips the transit map.",beatTwoAction="MARCUS checks the eastern console.";
const drafts={"scene-1":{blocks:[{type:"scene",text:"INT. CONTROL ROOM — NIGHT"},{beat:1,type:"action",text:beatOneAction},{beat:1,type:"char",text:"DANIEL (V.O.)"},{beat:1,type:"dia",text:"Take the east tunnel."},{beat:2,type:"action",text:beatTwoAction}]}};const ctx={charById:{marcus:chars[0],daniel:chars[1]},propById:{},drafts};window.turnContinuity={drafts,props:[]};const bm={rows:[{n:1},{n:2}],turnAt:1};
const sourceStamp=shotBeatScreenplay(scene,1,{drafts,characters:chars,beatsMap:bm}).sourceRev;
const shots=[{id:"opening-1",sceneId:"scene-1",beatN:1,order:1,keyframeMode:"beat-opening",sourceScreenplayRev:sourceStamp,subjects:["marcus"],size:"Medium",angle:"Eye",lens:"50",action:"Marcus grips the transit map."},{id:"legacy-1",sceneId:"scene-1",beatN:1,order:2,subjects:["marcus"],size:"Close",angle:"Low",lens:"85",action:"Legacy alternative."}];
const props={lanesLen:2,bm,scene,ctx,characters:chars,propsAvail:[],ordered:shots,firstId:"opening-1",toggleHead:()=>{},onAddShot:(sid,n)=>__fixture.calls.push(["add",sid,n]),onUpdate:()=>__fixture.calls.push(["update"]),onDelete:()=>{},onView:()=>{},onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},onBatchDone:()=>{},batchActiveId:null,openShotId:null,setOpenShotId:()=>{},sceneStart:false,onRenderScene:()=>{},renderBusy:false,nextShotId:null,onRefineBeat:(s,n)=>__fixture.calls.push(["refine",s.id,n]),refiningBeat:false};
const root=ReactDOM.createRoot(document.getElementById("root")),classicRoot=ReactDOM.createRoot(document.getElementById("classic-root"));
function mount(batchActiveId=null){root.render(React.createElement("div",{className:"beat-card-grid"},React.createElement(OpeningBeatCard,{...props,batchActiveId,L:{n:1,shots}}),React.createElement(OpeningBeatCard,{...props,batchActiveId,L:{n:2,shots:[]}})))}
const classicShot={id:"classic-1",sceneId:"scene-1",beatN:1,order:1,size:"Medium",angle:"Eye",lens:"50",action:"Classic action."};
window.__mountClassicFallback=()=>classicRoot.render(React.createElement("div",{className:"classic-fallback-fixture"},React.createElement(ShotCard,{sh:classicShot,scene,ctx,characters:chars,propsAvail:[],beatText:"Classic fallback copy",prevShot:null,laterShots:[],sceneShots:[classicShot],isHead:true,isFirst:true,onToggleHead:()=>{},onUpdate:()=>{},onDelete:()=>{},onView:()=>{},batchActiveId:null,onBatchDone:()=>{},onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},subLabel:null})));
window.__unmountClassicFallback=()=>classicRoot.render(null);
window.__changeSource=()=>{drafts["scene-1"].blocks[1].text="MARCUS tears the transit map in half.";mount()};
window.__restoreSource=()=>{drafts["scene-1"].blocks[1].text=beatOneAction;mount()};
window.__unsetPrimaryStamp=()=>{shots[0].sourceScreenplayRev=null;mount()};
window.__restorePrimaryStamp=()=>{shots[0].sourceScreenplayRev=sourceStamp;mount()};
window.__clearBeatTwoSource=()=>{drafts["scene-1"].blocks=drafts["scene-1"].blocks.filter(b=>Number(b.beat)!==2);mount()};
window.__restoreBeatTwoSource=()=>{if(!drafts["scene-1"].blocks.some(b=>Number(b.beat)===2))drafts["scene-1"].blocks.push({beat:2,type:"action",text:beatTwoAction});mount()};
window.__queueAlternative=()=>mount("legacy-1");mount();
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
      "the isolated existing SheetFrame fixture is used without recreating controls");
    assert.equal(await c.eval("document.querySelectorAll('.sheet-frame .gen-actions').length"),1,
      "the existing SheetFrame fixture keeps its single Generate control");

    const primary=".sheet-card.shot-card[data-shot-card=\"opening-1\"]";
    const contextStats=await c.eval(`(()=>{const card=document.querySelector('${primary}'),ctx=card.querySelector('.shot-beat-context');return {
      stale:ctx.querySelectorAll('.bc-stale').length,buttons:ctx.querySelectorAll('button').length,
      laneButtons:ctx.querySelectorAll('.beat-lane-btn').length,selectors:ctx.querySelectorAll('.bc-alt-picker select').length,
      options:ctx.querySelectorAll('.bc-alt-picker option').length
    }})()`);
    assert.deepEqual(contextStats,{stale:0,buttons:0,laneButtons:0,selectors:1,options:2},
      "beat context is metadata plus the legacy selector, with no controls");
    assert.doesNotMatch(await c.eval("document.querySelector('.beat-card-grid').innerText"),
      /Add alternative/i,"the removed alternative dialog/control is absent");
    assert.doesNotMatch(await c.eval("[...document.querySelectorAll('.shot-beat-context-head')].map(x=>x.textContent).join(' ')"),
      /Update from screenplay|Add alternative|Add shot/i,
      "context headers have no Update or Add buttons");
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

    await c.eval("window.__changeSource()");
    await wait(()=>c.eval("document.querySelectorAll('.bc-stale').length===1"),"source revision staleness");
    assert.match(await c.eval("document.querySelector('.bc-stale').textContent"),/Screenplay changed since this opening keyframe/,
      "an actual screenplay change remains visibly stale");
    assert.doesNotMatch(await c.eval("document.body.innerText"),/Source changed — update from screenplay/,
      "the removed old stale banner is not reintroduced");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[],
      "a real source change still does not auto-update, refine, or call the model");
    await c.eval("window.__restoreSource()");

    await c.eval(`document.querySelector('${primary} .bc-scripted').open=true;[...document.querySelectorAll('.bc-scripted-actions .beat-lane-btn')].find(b=>b.textContent.includes('Update from screenplay')).click()`);
    await wait(()=>c.eval("window.__fixture.calls.filter(x=>x[0]==='refine'&&x[1]==='scene-1'&&x[2]===1).length===1"),"beat one refine callback");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["refine","scene-1",1]],
      "Update from screenplay inside Scripted calls scene-1 beat 1 once");
    assert.match(await c.eval("document.querySelector('.bc-scripted-actions span').textContent"),/writing-model credits/,
      "Scripted actions explain the writing credits boundary");
    assert.equal(await c.eval("document.querySelectorAll('.shot-beat-context .beat-lane-btn').length"),0,
      "Update from screenplay exists only inside Scripted actions");

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

    await c.eval("document.querySelector('.bc-alt-picker select').value='legacy-1';document.querySelector('.bc-alt-picker select').dispatchEvent(new Event('change',{bubbles:true}))");
    await wait(()=>c.eval("document.querySelector('.sheet-card.shot-card').dataset.shotCard==='legacy-1'"),"alternative selection");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card-grid .sheet-card.shot-card[data-shot-card=\"legacy-1\"]').length"),1,
      "the existing alternative remains selectable as one correctly keyed card");
    assert.equal(await c.eval("document.querySelectorAll('.beat-card-grid .sheet-card.shot-card[data-shot-card=\"opening-1\"]').length"),0,
      "selecting an alternative remounts the displayed ShotCard instead of hiding a second one");
    assert.equal(await c.eval("window.__fixture.mounts.at(-1)"),"legacy-1",
      "alternative selection remounts the image generator with the alternative key");
    assert.deepEqual(await c.eval("window.__fixture.calls"),[["refine","scene-1",1],["refine","scene-1",2]],
      "selecting an alternative does not call generation");

    await c.eval("document.querySelector('.bc-alt-picker select').value='opening-1';document.querySelector('.bc-alt-picker select').dispatchEvent(new Event('change',{bubbles:true}))");
    await wait(()=>c.eval("document.querySelector('.sheet-card.shot-card').dataset.shotCard==='opening-1'"),"primary selection");
    await c.eval(`document.querySelector('${primary} .bc-scripted').open=true`);
    for(const [w,name] of [[1280,"desktop"],[390,"mobile"]]){
      await c.call("Emulation.setDeviceMetricsOverride",{width:w,height:900,deviceScaleFactor:1,mobile:w<500});
      assert.equal(await c.eval("document.documentElement.scrollWidth<=window.innerWidth"),true,`${name} card does not overflow`);
      const x=await c.call("Page.captureScreenshot",{format:"png"});
      await writeFile(`${OUT}/${name}.png`,Buffer.from(x.data,"base64"));
    }

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

    assert.deepEqual(await c.eval("window.__fixture.errors"),[]);
    console.log(`standalone beat card browser regression passed\\nscreenshots: ${OUT}/desktop.png, ${OUT}/mobile.png`);
  }finally{c?.close();chrome.kill();s.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
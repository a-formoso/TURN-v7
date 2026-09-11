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

const ROOT=new URL("../",import.meta.url), FIX="/tmp/fixture/browserfiles", OUT="/tmp/beat-keyframe-browser";
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
function html(){return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/styles.css><style>body{overflow:auto;background:#08090b;padding:24px}.beat-card-grid{max-width:980px;margin:auto}</style></head><body><div id=root></div><script src=/react.js></script><script src=/react-dom.js></script><script>
window.__fixture={calls:[],errors:[]};window.addEventListener("error",e=>__fixture.errors.push(String(e.message)));
window.Icon=new Proxy({}, {get:(_,n)=>({s=12})=>React.createElement("svg",{"data-i":n,width:s,height:s})});
const px="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263d42"/></svg>');
window.nbGetImage=id=>id==="opening-1"?px:"";window.nbLoadImage=async id=>nbGetImage(id);window.nbGetMeta=()=>({});
window.beatScriptText=(id,n)=>n===1?"MARCUS grips the transit map. DANIEL speaks through the radio.":"";window.seedShotOf=()=>null;
window.useImageGen=()=>({genUrl:"",gening:false,genMeta:null,generate:()=>{}});window.shotFrameGenOpts=()=>({opts:{},finalPrompt:"",chainPrompt:"",renderPlan:null});
window.inFrameCast=sh=>sh.subjects||[];window.inFrameProps=()=>[];window.appConfirm=async()=>true;window.turnContinuity={drafts:{},props:[]};
</script><script src=/shot-screenplay.js></script><script src=/shots-ui.js></script><script>
const scene={id:"scene-1",no:1,title:"Control Room"};const chars=[{id:"marcus",name:"Marcus"},{id:"daniel",name:"Daniel"}];
const drafts={"scene-1":{blocks:[{type:"scene",text:"INT. CONTROL ROOM — NIGHT"},{beat:1,type:"action",text:"MARCUS grips the transit map."},{beat:1,type:"char",text:"DANIEL (V.O.)"},{beat:1,type:"dia",text:"Take the east tunnel."}]}};const ctx={charById:{marcus:chars[0],daniel:chars[1]},propById:{},drafts};window.turnContinuity={drafts,props:[]};const bm={rows:[{n:1},{n:2}],turnAt:1};
const sourceStamp=shotBeatScreenplay(scene,1,{drafts,characters:chars,beatsMap:bm}).sourceRev;
const shots=[{id:"opening-1",sceneId:"scene-1",beatN:1,order:1,keyframeMode:"beat-opening",sourceScreenplayRev:sourceStamp,subjects:["marcus"],size:"Medium",angle:"Eye",lens:"50",action:"Marcus grips the transit map."},{id:"legacy-1",sceneId:"scene-1",beatN:1,order:2,subjects:["marcus"],size:"Close",angle:"Low",lens:"85",action:"Legacy alternative."}];
const props={lanesLen:2,bm,scene,ctx,characters:chars,propsAvail:[],ordered:shots,firstId:"opening-1",toggleHead:()=>{},onAddShot:(sid,n)=>__fixture.calls.push(["add",sid,n]),onUpdate:()=>{},onDelete:()=>{},onView:()=>{},onGenerateShot:()=>{},onRegenDownstream:()=>{},onStopChain:()=>{},onBatchDone:()=>{},batchActiveId:null,openShotId:null,setOpenShotId:()=>{},sceneStart:false,onRenderScene:()=>{},renderBusy:false,nextShotId:null,onRefineBeat:(s,n)=>__fixture.calls.push(["refine",s.id,n]),refiningBeat:false};
const root=ReactDOM.createRoot(document.getElementById("root"));function mount(){root.render(React.createElement("div",{className:"beat-card-grid"},React.createElement(OpeningBeatCard,{...props,L:{n:1,shots}}),React.createElement(OpeningBeatCard,{...props,L:{n:2,shots:[]}})))}window.__changeSource=()=>{drafts["scene-1"].blocks[1].text="MARCUS tears the transit map in half.";mount()};mount();
</script></body></html>`}
function server(){return createServer(async(q,r)=>{const p=q.url==="/"?`${FIX}/beat-keyframe.html`:`${FIX}${q.url}`;try{r.end(await readFile(p));}catch{r.writeHead(404);r.end();}})}
class NativeWS{static async connect(url){const u=new URL(url),key=crypto.randomBytes(16).toString("base64"),s=net.connect(+u.port,u.hostname);let buf=Buffer.alloc(0);await new Promise((ok,bad)=>{s.once("error",bad);s.once("connect",()=>s.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));s.on("data",d=>{buf=Buffer.concat([buf,d]);if(buf.includes(Buffer.from("\r\n\r\n"))){if(!buf.toString().startsWith("HTTP/1.1 101"))bad(Error("CDP websocket handshake failed"));else ok()}})});const w=new NativeWS(s);s.on("data",d=>w.read(d));return w}constructor(s){this.s=s;this.buf=Buffer.alloc(0);this.onmessage=null}send(text){const p=Buffer.from(text),mask=crypto.randomBytes(4),h=p.length<126?Buffer.from([129,128|p.length]):Buffer.from([129,254,p.length>>8,p.length&255]);for(let i=0;i<p.length;i++)p[i]^=mask[i%4];this.s.write(Buffer.concat([h,mask,p]))}read(d){this.buf=Buffer.concat([this.buf,d]);while(this.buf.length>=2){let n=this.buf[1]&127,off=2;if(n===126){if(this.buf.length<4)return;n=this.buf.readUInt16BE(2);off=4}else if(n===127){if(this.buf.length<10)return;n=this.buf.readUInt32BE(6);off=10}if(this.buf.length<off+n)return;const x=this.buf.subarray(off,off+n).toString();this.buf=this.buf.subarray(off+n);this.onmessage&&this.onmessage({data:x})}}close(){this.s.destroy()}}
class CDP{constructor(ws){this.ws=ws;this.i=0;this.q=new Map;ws.onmessage=e=>{const x=JSON.parse(e.data),f=this.q.get(x.id);if(f){this.q.delete(x.id);f(x)}}}static async connect(u){return new CDP(await NativeWS.connect(u))}call(m,p={}){return new Promise((a,b)=>{const id=++this.i;this.q.set(id,x=>x.error?b(Error(x.error.message)):a(x.result));this.ws.send(JSON.stringify({id,method:m,params:p}))})}async eval(x){const r=await this.call("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.result.value}close(){this.ws.close()}}
async function wait(f,label){const end=Date.now()+10000;while(Date.now()<end){const value=await f();if(value)return value;await new Promise(r=>setTimeout(r,80))}throw Error("timeout "+label)}
async function main(){await prep();const s=server();await new Promise(a=>s.listen(0,"127.0.0.1",a));const port=s.address().port,dp=9500+Math.floor(Math.random()*300),chrome=spawn(CHROME,["--headless=new","--no-sandbox",`--remote-debugging-port=${dp}`,`--user-data-dir=${FIX}/beat-${process.pid}`]);let c;try{const t=await wait(async()=>{try{return (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()).find(x=>x.type==="page")}catch{return null}},"chrome");c=await CDP.connect(t.webSocketDebuggerUrl);await c.call("Page.enable");await c.call("Page.navigate",{url:`http://127.0.0.1:${port}/`});await wait(()=>c.eval("document.querySelectorAll('.opening-beat-card').length===2"),"cards");
assert.equal(await c.eval("document.querySelectorAll('.opening-beat-card').length"),2,"one card is rendered for each beat including empty");
assert.equal(await c.eval("document.querySelector('.bc-stale')"),null,"matching sourceScreenplayRev starts current");await c.eval("window.__changeSource()");await wait(()=>c.eval("!!document.querySelector('.bc-stale')"),"source revision staleness");await c.eval("document.querySelector('.bc-screenplay').open=true");const text=await c.eval("document.body.innerText");assert.match(text,/OPENING KEYFRAME/);assert.match(text,/Source changed — update from screenplay/);assert.match(text,/ON-SCREEN: Marcus/);assert.ok(text.includes("REMOTE AUDIO / TEXT: Daniel"));assert.doesNotMatch(text,/ON-SCREEN: Marcus.*Daniel/);
assert.equal(await c.eval("document.querySelectorAll('.bc-alternatives .bc-shot-row').length"),1,"legacy shot is expandable, not a second primary");
await c.eval("document.querySelector('.bc-alternatives').open=true;document.querySelector('.bc-alternatives').dispatchEvent(new Event('toggle'))");assert.equal(await c.eval("document.querySelector('.bc-alternatives').open"),true);
await c.eval("[...document.querySelectorAll('.beat-lane-btn')].find(b=>b.textContent.includes('Update from screenplay')).click()");assert.deepEqual(await c.eval("window.__fixture.calls"),[["refine","scene-1",1]]);
assert.equal(await c.eval("[...document.querySelectorAll('.opening-beat-card')][1].querySelector('.beat-lane-btn').disabled"),true,"source-free beat cannot auto-draft");
for(const [w,name] of [[1280,"desktop"],[390,"mobile"]]){await c.call("Emulation.setDeviceMetricsOverride",{width:w,height:900,deviceScaleFactor:1,mobile:w<500});const x=await c.call("Page.captureScreenshot",{format:"png"});await writeFile(`${OUT}/${name}.png`,Buffer.from(x.data,"base64"))}
assert.deepEqual(await c.eval("window.__fixture.errors"),[]);console.log(`beat keyframe browser regression passed\\nscreenshots: ${OUT}/desktop.png, ${OUT}/mobile.png`);
}finally{c?.close();chrome.kill();s.close()}}
main().catch(e=>{console.error(e);process.exitCode=1});
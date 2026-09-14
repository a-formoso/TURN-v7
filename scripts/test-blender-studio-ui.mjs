#!/usr/bin/env node
/* Real Chromium fixture for BlenderStudioEntry; transport is entirely in memory. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {transformSync} from "@babel/core";
import net from "node:net";
import crypto from "node:crypto";

const ROOT=new URL("../",import.meta.url), FIXTURE=`/tmp/blender-studio-browser-${process.pid}`;
const CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium", OUT=process.env.BLENDER_STUDIO_UI_OUT||"/tmp/blender-studio-browser";
const transform=s=>transformSync(s,{presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false}).code;
async function prepare(){
  await mkdir(FIXTURE,{recursive:true});await mkdir(OUT,{recursive:true});
  await writeFile(`${FIXTURE}/styles.css`,(await readFile(new URL("../app/styles.css",import.meta.url)))+"\n"+(await readFile(new URL("../app/blender-studio.css",import.meta.url))));
  await writeFile(`${FIXTURE}/contract.js`,await readFile(new URL("../app/blender-studio-contract.js",import.meta.url)));
  await writeFile(`${FIXTURE}/client.js`,await readFile(new URL("../app/blender-studio.js",import.meta.url)));
  await writeFile(`${FIXTURE}/ui.js`,transform(await readFile(new URL("../app/blender-studio-ui.jsx",import.meta.url))));
  for(const [name,url] of Object.entries({"react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js","react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"})){
    try{if((await readFile(`${FIXTURE}/${name}`)).length>10000)continue;}catch{}
    const r=await fetch(url);if(!r.ok)throw new Error(`React cache failed: ${r.status}`);await writeFile(`${FIXTURE}/${name}`,Buffer.from(await r.arrayBuffer()));
  }
  await writeFile(`${FIXTURE}/index.html`,html());
}
function html(){return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>body{margin:20px;background:var(--bg-0);color:var(--txt-0)}#root{max-width:850px}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>
window.__fixture={calls:[],live:true,defer:false,resolve:null,revision:2,workspace:null,billingReady:true};
// Production loads this existing Preview UI helper before Studio UI. The
// fixture supplies its rendered interface so the Location-first layout is
// exercised without downloading an archive.
window.BlenderAddonDownload=()=>React.createElement("button",{type:"button"},"Download Blender add-on");
const camera={position:[0,-6,1.6],target:[0,0,1.4],focalLength:50,sensorWidth:36};
const object={id:"actor-a",name:"Existing actor",kind:"actor",position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],characterId:"char-a"};
const existing={id:"shot-a",sceneId:"scene-a",name:"Shot A",camera,objects:[object],tracks:[],frameStart:1,frameEnd:120,fps:24};
function fresh(){return {schema:"cm-studio-v1",projectId:"film-a",locationId:"loc-house",name:"House",parentLocationId:null,rootLocationId:"loc-house",revision:__fixture.revision,context:{description:"",architecture:"brick",materials:"wood",staging:""},objects:[],shots:[JSON.parse(JSON.stringify(existing))],references:[{entityId:"loc-house",label:"House",kind:"location"},{entityId:"char-a",label:"Ava",kind:"character"}],assets:[],previews:[]};}
__fixture.workspace=fresh();
window.BlenderPreview={scope:()=>({projectId:"film-a",uid:"user-a",epoch:1}),isCurrent:()=>__fixture.live,request:async(action,body,scope,guard)=>{
  __fixture.calls.push({action,body:JSON.parse(JSON.stringify(body||{}))});
  if(__fixture.defer&&action==="studio.capabilities")await new Promise(ok=>__fixture.resolve=ok);
  if(!guard||!guard())throw Object.assign(new Error("stale"),{code:"BLENDER_STALE"});
  if(action==="studio.capabilities")return {schema:"cm-studio-v1",billingReady:__fixture.billingReady,models:[{modelId:"scene-ok",configured:true,verified:true},{modelId:"unknown",configured:true,verified:false}],meshModels:[{modelId:"mesh-ok",configured:true,verified:true}]};
  if(action==="connection.get")return {connected:false};
  if(action==="pair.create")return {pairCode:"PAIR-1234",expiresAt:"2099-01-01T00:00:00Z"};
  if(action==="connection.disconnect")return {connected:false};
  if(action==="studio.workspace.open"){const shot=body.shot;if(shot&&!__fixture.workspace.shots.some(s=>s.id===shot.id))__fixture.workspace.shots.push({id:shot.id,sceneId:shot.sceneId||"scene-a",name:shot.name||"New shot",camera:JSON.parse(JSON.stringify(camera)),objects:[],tracks:[],frameStart:1,frameEnd:120,fps:24});return {workspace:JSON.parse(JSON.stringify(__fixture.workspace))};}
  if(action==="studio.workspace.get")return {workspace:JSON.parse(JSON.stringify(__fixture.workspace))};
  if(action==="studio.workspace.save"){__fixture.revision++;__fixture.workspace=JSON.parse(JSON.stringify(body.workspace));__fixture.workspace.revision=__fixture.revision;return {workspace:JSON.parse(JSON.stringify(__fixture.workspace))};}
  if(action==="studio.reference.get")return {entityId:body.entityId,dataUrl:"data:image/png;base64,AA=="};
  if(action==="studio.assistant.submit"){const running=/cancel/i.test(body.prompt),pending=/settle/i.test(body.prompt);return {task:{id:pending?"assistant-settlement":running?"assistant-cancel":"assistant-1",type:"assistant",status:pending?"settlement_pending":running?"running":"queued",message:pending?"Credit debit is awaiting atomic settlement.":"Queued",proposal:pending||running?null:{summary:"Add a practical",ops:[{op:"upsert_object",scope:"set",object:{id:"lamp-1",name:"Lamp",kind:"light",position:[1,1,2],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],lightEnergy:80}}]}}};}
  if(action==="studio.assistant.get")return {task:{id:body.taskId,type:"assistant",status:"completed",message:"Complete",proposal:{summary:"Add a practical",ops:[{op:"upsert_object",scope:"set",object:{id:"lamp-1",name:"Lamp",kind:"light",position:[1,1,2],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],lightEnergy:80}}]}}};
  if(action==="studio.assistant.cancel")return {task:{id:body.taskId,type:"assistant",status:"cancelled",message:"Cancelled"}};
  if(action==="studio.mesh.submit")return {task:{id:"mesh-1",type:"mesh",status:"queued",message:"Mesh queued"}};
  if(action==="studio.mesh.get")return {task:{id:body.taskId,type:"mesh",status:"completed",message:"Mesh complete",asset:{id:"asset-1",name:"Chair",kind:"glb",sha256:"${"a".repeat(64)}",bytes:128,modelId:"mesh-ok",rigged:false,animated:false}}};
  if(action==="studio.mesh.cancel")return {task:{id:body.taskId,type:"mesh",status:"cancelled"}};
  throw new Error("unexpected "+action);
}};
</script><script src="/contract.js"></script><script src="/client.js"></script><script src="/ui.js"></script><script>
window.__root=ReactDOM.createRoot(document.getElementById("root"));window.mount=(readOnly=false,key="normal")=>window.__root.render(React.createElement(BlenderStudioEntry,{key,location:{id:"loc-house",name:"House",rootLocationId:"loc-house",context:{description:"",architecture:"brick",materials:"wood",staging:""}},shot:{id:"shot-a",sceneId:"scene-a",name:"Shot A"},references:[{entityId:"loc-house",label:"House",kind:"location"},{entityId:"char-a",label:"Ava",kind:"character"}],readOnly}));
mount();
</script></body></html>`;}
function server(){return createServer(async(req,res)=>{try{const f=req.url==="/"?"index.html":req.url.slice(1),data=await readFile(`${FIXTURE}/${f}`);res.writeHead(200,{"content-type":f.endsWith(".html")?"text/html":f.endsWith(".css")?"text/css":"text/javascript","cache-control":"no-store"}).end(data);}catch{res.writeHead(404).end();}});}
class NativeWS{static async connect(url){const u=new URL(url),key=crypto.randomBytes(16).toString("base64"),socket=net.connect(+u.port,u.hostname);let header=Buffer.alloc(0);await new Promise((ok,bad)=>{socket.once("error",bad);socket.once("connect",()=>socket.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));socket.on("data",data=>{header=Buffer.concat([header,data]);if(header.includes(Buffer.from("\r\n\r\n")))header.toString().startsWith("HTTP/1.1 101")?ok():bad(Error("CDP websocket handshake failed"));});});const ws=new NativeWS(socket);socket.on("data",data=>ws.read(data));return ws;}constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.onmessage=null;}send(text){const payload=Buffer.from(text),mask=crypto.randomBytes(4),head=payload.length<126?Buffer.from([129,128|payload.length]):Buffer.from([129,254,payload.length>>8,payload.length&255]);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];this.socket.write(Buffer.concat([head,mask,payload]));}read(data){this.buffer=Buffer.concat([this.buffer,data]);while(this.buffer.length>=2){let n=this.buffer[1]&127,offset=2;if(n===126){if(this.buffer.length<4)return;n=this.buffer.readUInt16BE(2);offset=4;}else if(n===127){if(this.buffer.length<10)return;n=this.buffer.readUInt32BE(6);offset=10;}if(this.buffer.length<offset+n)return;const text=this.buffer.subarray(offset,offset+n).toString();this.buffer=this.buffer.subarray(offset+n);if(this.onmessage)this.onmessage({data:text});}}close(){this.socket.destroy();}}
class CDP{constructor(ws){this.ws=ws;this.n=0;this.p=new Map();}static async connect(url){const ws=await NativeWS.connect(url);const c=new CDP(ws);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const [a,b]=c.p.get(m.id);c.p.delete(m.id);m.error?b(new Error(m.error.message)):a(m.result);}};return c;}call(method,params={}){const id=++this.n;this.ws.send(JSON.stringify({id,method,params}));return new Promise((a,b)=>this.p.set(id,[a,b]));}async eval(expression){const r=await this.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}close(){this.ws.close();}}
async function wait(fn,label){const end=Date.now()+10000;let last="";while(Date.now()<end){last=await fn();if(last)return;await new Promise(r=>setTimeout(r,70));}throw new Error("Timed out: "+label+(last?": "+last:""));}
async function main(){await prepare();const s=server();await new Promise(ok=>s.listen(0,"127.0.0.1",ok));const debug=9700+Math.floor(Math.random()*200),chrome=spawn(CHROME,["--headless=new","--no-sandbox","--disable-gpu",`--remote-debugging-port=${debug}`,`--user-data-dir=${FIXTURE}/profile`,"about:blank"],{stdio:"ignore"});let c;try{
  let target;await wait(async()=>{try{const r=await fetch(`http://127.0.0.1:${debug}/json/list`);target=(await r.json()).find(x=>x.type==="page");return !!target;}catch{return false;}},"Chrome");
  c=await CDP.connect(target.webSocketDebuggerUrl);await c.call("Page.enable");await c.call("Page.navigate",{url:`http://127.0.0.1:${s.address().port}/`});
  await wait(()=>c.eval(`!!document.querySelector('[data-testid="blender-studio-entry"]')`),"Studio mount");
  await c.eval(`document.querySelector('.bs-head button').click()`);await wait(()=>c.eval(`document.body.innerText.includes("Set revision 2")`),"capabilities and workspace open");
  await wait(()=>c.eval(`!![...document.querySelectorAll("button")].find(b=>b.textContent.includes("Pair Blender desktop"))`),"Location onboarding");await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("Pair Blender desktop"))).click()`);await wait(()=>c.eval(`document.body.innerText.includes("PAIR-1234")`),"pair code");
  assert.equal(await c.eval(`window.__fixture.workspace.shots[0].objects[0].id`),"actor-a","open preserves existing shot actors");
  assert.equal(await c.eval(`window.__fixture.workspace.shots[0].camera.focalLength`),50,"open preserves existing shot camera");
  await c.eval(`(()=>{const put=(e,v)=>{Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(e,v);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));};put(document.querySelector("textarea"),"add a lamp");put(document.querySelector(".bs-send select"),"scene-ok");document.querySelector('.bs-send input[type="checkbox"]').click();})()`);await wait(()=>c.eval(`document.querySelector(".bs-send select").value==="scene-ok"&&document.querySelector('.bs-send input[type="checkbox"]').checked`),"scene composer state");await c.eval(`document.querySelector(".bs-send button").click()`);
  await wait(()=>c.eval(`document.body.innerText.includes("Proposal preview")`),"assistant submit/proposal");
  await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("Apply proposal"))).click()`);await wait(()=>c.eval(`window.__fixture.workspace.objects.some(x=>x.id==="lamp-1")`),"apply/save");
  await c.eval(`([...document.querySelectorAll(".bs-tabs button")].find(b=>b.textContent.includes("Prompt/image"))).click();document.querySelectorAll(".bs-source input[type=radio]")[1].click()`);await wait(()=>c.eval(`!!document.querySelector(".bs-source select")`),"reference source");
  await c.eval(`(()=>{const put=(e,v)=>{Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(e,v);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));};put(document.querySelector(".bs-source select"),"char-a");put(document.querySelector("textarea"),"chair");put(document.querySelector(".bs-send select"),"mesh-ok");})()`);await wait(()=>c.eval(`document.querySelector(".bs-source select").value==="char-a"&&document.querySelector(".bs-send select").value==="mesh-ok"`),"mesh composer state");await c.eval(`document.querySelector(".bs-send button").click()`);await wait(()=>c.eval(`document.body.innerText.includes("Save generated asset")`),"mesh submit");
  await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("Save generated asset"))).click()`);await wait(()=>c.eval(`window.__fixture.workspace.assets.length===1`),"asset save");
  await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("Import to set"))).click()`);await wait(()=>c.eval(`window.__fixture.workspace.objects.some(x=>x.assetId==="asset-1")`),"asset import");
  // Capture the meaningful, loaded Studio state before the final role/scope
  // fencing assertions intentionally remount an empty/stale panel.
  const shot=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});await writeFile(`${OUT}/blender-studio-fixture.png`,Buffer.from(shot.data,"base64"));
  await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});await c.eval(`new Promise(r=>setTimeout(r,50))`);
  assert.ok(await c.eval(`document.documentElement.scrollWidth<=390`),"Studio panel must not overflow a 390px viewport");
  await c.call("Emulation.clearDeviceMetricsOverride");
  await c.eval(`(()=>{([...document.querySelectorAll(".bs-tabs button")].find(b=>b.textContent.includes("AI Scene"))).click();})()`);await wait(()=>c.eval(`!![...document.querySelector(".bs-send select").options].find(o=>o.value==="scene-ok")`),"scene mode");await c.eval(`(()=>{const put=(e,v)=>{Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(e,v);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));};put(document.querySelector("textarea"),"cancel this");put(document.querySelector(".bs-send select"),"scene-ok");})()`);await wait(()=>c.eval(`document.querySelector(".bs-send select").value==="scene-ok"`),"cancel composer state");await c.eval(`document.querySelector(".bs-send button").click()`);await wait(()=>c.eval(`document.body.innerText.includes("Task: running")`),"cancel task");await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent==="Cancel")).click()`);await wait(()=>c.eval(`document.body.innerText.includes("Task: cancelled")`),"cancel response");
  const submitsBeforeSettlement=await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.assistant.submit").length`);
  await c.eval(`(()=>{const e=document.querySelector("textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"settle the held credit");e.dispatchEvent(new Event("input",{bubbles:true}));})()`);await c.eval(`document.querySelector(".bs-send button").click()`);
  await wait(()=>c.eval(`document.body.innerText.includes("Credit settlement pending")`),"settlement-pending task");
  assert.equal(await c.eval(`document.body.innerText.includes("Proposal preview")`),false,"settlement-pending task has no proposal to apply");
  assert.equal(await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent==="Apply proposal and save")).disabled`),true,"settlement-pending task disables apply");
  await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent==="Retry credit settlement")).click()`);
  await wait(()=>c.eval(`document.body.innerText.includes("Proposal preview")&&document.body.innerText.includes("Task: completed")`),"settlement retry completion");
  assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.assistant.submit").length`),submitsBeforeSettlement+1,"settlement recovery does not create another provider task");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.assistant.get"&&x.body.taskId==="assistant-settlement")`),true,"settlement recovery polls the original task ID");
  const submitsBeforeBilling=await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.assistant.submit"||x.action==="studio.mesh.submit").length`);
  await c.eval(`window.__fixture.billingReady=false;window.mount(false,"billing")`);await wait(()=>c.eval(`!!document.querySelector(".bs-head button")`),"billing-disabled mount");await c.eval(`document.querySelector(".bs-head button").click()`);await wait(()=>c.eval(`document.body.innerText.includes("Paid AI is disabled pending approval of the atomic credit update")`),"billing-disabled warning");
  assert.equal(await c.eval(`document.querySelector(".bs-send button").disabled`),true,"billingReady false disables paid generation");
  assert.equal(await c.eval(`document.querySelector(".bs-state button").disabled`),false,"billing gate leaves free workspace save available");
  await c.eval(`document.querySelector(".bs-send button").click()`);assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.assistant.submit"||x.action==="studio.mesh.submit").length`),submitsBeforeBilling,"billing-disabled control cannot submit a paid task");
  await c.eval(`window.mount(true,"readonly")`);await wait(()=>c.eval(`!!document.querySelector(".bs-head button")`),"read-only mount");await c.eval(`document.querySelector(".bs-head button").click()`);await wait(()=>c.eval(`document.body.innerText.includes("View-only access")`),"read-only rerender");await wait(()=>c.eval(`document.querySelector(".bs-send button").disabled`),"read-only action blocking");
  await c.eval(`window.__fixture.live=true;window.__fixture.defer=true;window.mount(false,"stale")`);await wait(()=>c.eval(`!!document.querySelector(".bs-head button")`),"stale mount");await c.eval(`document.querySelector(".bs-head button").click()`);await wait(()=>c.eval(`typeof window.__fixture.resolve==="function"`),"deferred capability");await c.eval(`window.__fixture.live=false;window.__fixture.resolve();new Promise(r=>setTimeout(r,80))`);assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.workspace.open").length`),2,"stale capability response does not open a workspace");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.reference.get")`),true,"assistant image source resolves authorized reference");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.mesh.submit"&&x.body.referenceId==="char-a")`),true,"mesh sends explicit reference ID");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.mesh.get")`),true,"queued mesh task is polled through its frozen get action");
  console.log(`PASS Blender Studio Chromium fixture; screenshot ${OUT}/blender-studio-fixture.png`);
}finally{try{c?.close();}catch{}chrome.kill("SIGTERM");s.close();}}
main().catch(e=>{console.error("FAIL Blender Studio Chromium fixture\\n"+(e.stack||e));process.exitCode=1;});
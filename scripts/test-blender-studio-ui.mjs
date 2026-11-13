#!/usr/bin/env node
/* Real Chromium fixture for BlenderStudioEntry; transport is entirely in memory. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {parseSync,transformSync} from "@babel/core";
import net from "node:net";
import crypto from "node:crypto";

const ROOT=new URL("../",import.meta.url), FIXTURE=`/tmp/blender-studio-browser-${process.pid}`;
const CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium", OUT=process.env.BLENDER_STUDIO_UI_OUT||"/tmp/blender-studio-browser";
const transform=s=>transformSync(s,{presets:[["@babel/preset-react",{runtime:"classic"}]],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false}).code;
function realFunction(source,name){
  const node=parseSync(source,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false}).program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name===name);
  assert.ok(node,`production ${name} is available`);return source.slice(node.start,node.end);
}
async function prepare(){
  await mkdir(FIXTURE,{recursive:true});await mkdir(OUT,{recursive:true});
  await writeFile(`${FIXTURE}/styles.css`,(await readFile(new URL("../app/styles.css",import.meta.url)))+"\n"+(await readFile(new URL("../app/blender-studio.css",import.meta.url))));
  await writeFile(`${FIXTURE}/contract.js`,await readFile(new URL("../app/blender-studio-contract.js",import.meta.url)));
  await writeFile(`${FIXTURE}/client.js`,await readFile(new URL("../app/blender-studio.js",import.meta.url)));
  await writeFile(`${FIXTURE}/setup.js`,transform(await readFile(new URL("../app/blender-studio-setup.jsx",import.meta.url))));
  await writeFile(`${FIXTURE}/ui.js`,transform(await readFile(new URL("../app/blender-studio-ui.jsx",import.meta.url))));
  const artroom=await readFile(new URL("../app/artroom.jsx",import.meta.url),"utf8");
  const locations=await readFile(new URL("../app/locations-ui.jsx",import.meta.url),"utf8");
  await writeFile(`${FIXTURE}/location-section.js`,transform(
    realFunction(artroom,"CardFold")+"\n"+
    realFunction(locations,"locSwatch")+"\n"+
    realFunction(locations,"LocationIdentityField")+"\n"+
    realFunction(locations,"LocationSectionHelp")+"\n"+
    realFunction(locations,"LocationBlenderStudioSection")+"\n"+
    realFunction(locations,"LocationSheet")));
  for(const [name,url] of Object.entries({"react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js","react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"})){
    try{if((await readFile(`${FIXTURE}/${name}`)).length>10000)continue;}catch{}
    const r=await fetch(url);if(!r.ok)throw new Error(`React cache failed: ${r.status}`);await writeFile(`${FIXTURE}/${name}`,Buffer.from(await r.arrayBuffer()));
  }
  await writeFile(`${FIXTURE}/index.html`,html());
}
function html(){return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><style>body{margin:20px;background:var(--bg-0);color:var(--txt-0)}#root{max-width:850px}</style></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>
window.__fixture={calls:[],live:true,defer:false,resolve:null,revision:2,workspace:null,billingReady:true,connected:false,pairCount:0,expiryMs:600000,currentCode:""};
// Production loads this existing Preview UI helper before Studio UI. The
// fixture supplies its rendered interface so the Location-first layout is
// exercised without downloading an archive.
window.BlenderAddonDownload=()=>React.createElement("button",{type:"button"},"Download Blender add-on");
const camera={position:[0,-6,1.6],target:[0,0,1.4],focalLength:50,sensorWidth:36};
const object={id:"actor-a",name:"Existing actor",kind:"actor",position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],characterId:"char-a"};
const existing={id:"shot-a",sceneId:"scene-a",name:"Shot A",camera,objects:[object],tracks:[],frameStart:1,frameEnd:120,fps:24};
function fresh(){return {schema:"cm-studio-v1",projectId:"film-a",locationId:"loc-house",name:"House",parentLocationId:null,rootLocationId:"loc-house",revision:__fixture.revision,context:{description:"",architecture:"brick",materials:"wood",staging:""},objects:[],shots:[JSON.parse(JSON.stringify(existing))],references:[{entityId:"loc-house",label:"House",kind:"location"},{entityId:"char-a",label:"Ava",kind:"character"}],assets:[],previews:[]};}
__fixture.workspace=fresh();
window.BlenderPreview={endpoint:()=>"https://relay.example.test/functions/v1/blender-bridge",scope:()=>({projectId:"film-a",uid:"user-a",epoch:1}),isCurrent:()=>__fixture.live,request:async(action,body,scope,guard)=>{
  __fixture.calls.push({action,body:JSON.parse(JSON.stringify(body||{}))});
  if(__fixture.defer&&action==="studio.capabilities")await new Promise(ok=>__fixture.resolve=ok);
  if(!guard||!guard())throw Object.assign(new Error("stale"),{code:"BLENDER_STALE"});
  if(action==="studio.capabilities")return {schema:"cm-studio-v1",sourcePolicy:"generated-project-image-v1",billingReady:__fixture.billingReady,models:[{modelId:"scene-ok",configured:true,verified:true},{modelId:"unknown",configured:true,verified:false}],meshModels:[{modelId:"meshy/v7/image-to-3d",configured:true,verified:true}]};
  if(action==="connection.get")return {connected:__fixture.connected,deviceName:"Test Blender desktop"};
  if(action==="pair.create"){__fixture.currentCode="bp1.u1_${"a".repeat(112)}-"+(++__fixture.pairCount);return {pairCode:__fixture.currentCode,expiresAt:new Date(Date.now()+__fixture.expiryMs).toISOString()};}
  if(action==="connection.disconnect"){__fixture.connected=false;return {connected:false};}
  if(action==="studio.workspace.open"){const shot=body.shot;if(shot&&!__fixture.workspace.shots.some(s=>s.id===shot.id))__fixture.workspace.shots.push({id:shot.id,sceneId:shot.sceneId||"scene-a",name:shot.name||"New shot",camera:JSON.parse(JSON.stringify(camera)),objects:[],tracks:[],frameStart:1,frameEnd:120,fps:24});return {workspace:JSON.parse(JSON.stringify(__fixture.workspace))};}
  if(action==="studio.workspace.get")return {workspace:JSON.parse(JSON.stringify(__fixture.workspace))};
  if(action==="studio.workspace.save"){__fixture.revision++;__fixture.workspace=JSON.parse(JSON.stringify(body.workspace));__fixture.workspace.revision=__fixture.revision;return {workspace:JSON.parse(JSON.stringify(__fixture.workspace))};}
  if(action==="studio.reference.get")return {entityId:body.entityId,dataUrl:"data:image/png;base64,AA=="};
  if(action==="studio.assistant.submit"){const running=/cancel/i.test(body.prompt),pending=/settle/i.test(body.prompt);return {task:{id:pending?"assistant-settlement":running?"assistant-cancel":"assistant-1",type:"assistant",status:pending?"settlement_pending":running?"running":"queued",message:pending?"Credit debit is awaiting atomic settlement.":"Queued",proposal:pending||running?null:{summary:"Add a practical",ops:[{op:"upsert_object",scope:"set",object:{id:"lamp-1",name:"Lamp",kind:"light",position:[1,1,2],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],lightEnergy:80}}]}}};}
  if(action==="studio.assistant.get")return {task:{id:body.taskId,type:"assistant",status:"completed",message:"Complete",proposal:{summary:"Add a practical",ops:[{op:"upsert_object",scope:"set",object:{id:"lamp-1",name:"Lamp",kind:"light",position:[1,1,2],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],lightEnergy:80}}]}}};
  if(action==="studio.assistant.cancel")return {task:{id:body.taskId,type:"assistant",status:"cancelled",message:"Cancelled"}};
  if(action==="studio.mesh.submit")return {task:{id:"mesh-1",type:"mesh",status:"queued",message:"Mesh queued"}};
  if(action==="studio.mesh.get")return {task:{id:body.taskId,type:"mesh",status:"completed",message:"Mesh complete",asset:{id:"asset-1",name:"Chair",kind:"glb",sha256:"${"a".repeat(64)}",bytes:128,modelId:"meshy/v7/image-to-3d",rigged:false,animated:false}}};
  if(action==="studio.mesh.cancel")return {task:{id:body.taskId,type:"mesh",status:"cancelled"}};
  throw new Error("unexpected "+action);
}};
</script><script src="/contract.js"></script><script src="/client.js"></script><script src="/setup.js"></script><script src="/ui.js"></script><script src="/location-section.js"></script><script>
const fixtureNoop=()=>{};
window.locVisualDefaults=()=>({renderStyle:"",negativePrompt:""});
window.locScenePresets=()=>[];
window.locationEffectiveSide=()=> "INT";
window.combinedLocationPrompt=()=> "";
window.locVisualsDrafted=()=>false;
window.deriveLocationTimes=()=>[];
window.deriveLocationCoverageSheets=()=>[];
window.scenesInStoryOrder=xs=>xs||[];
window.stagingHasContent=()=>true;
window.nbGetMeta=()=>({iso:"2026-09-24T10:00:00.000Z",modelId:"gpt-image-2"});window.nbLoadImage=async()=> "data:image/png;base64,AA==";
window.useImageGen=()=>({genUrl:"",genMeta:null,genTier:"",gening:false,genErr:"",retrying:false,
  slotHasRef:false,generate:fixtureNoop,cancelGen:fixtureNoop,clearGen:fixtureNoop,importSheet:fixtureNoop,
  relatedClearCount:0,revertPrevious:fixtureNoop,layers:0,allModels:[],loadDetails:async()=>null,
  pendingSave:null,saving:false});
window.SheetField=()=>null;window.CopyBox=()=>null;
window.EditText=({value,placeholder})=>React.createElement("span",{className:"fixture-edit-text"},value||placeholder||"");
window.SceneChipPager=({none,items})=>React.createElement("span",{className:"fixture-scene-pager"},
  (items||[]).length?items.map(item=>item.label).join(" · "):(none||""));
window.StagingGrid=()=>null;
window.CoverageReferenceStrip=()=>null;window.LocationCoverageSheet=()=>null;window.LocationVariant=()=>null;
window.SluglineUnitCard=()=>null;window.CoverageViewsEditor=()=>null;window.SceneSetupCard=()=>null;
window.RenderStylePicker=({value,onPick})=>React.createElement("select",{className:"fixture-render-style",
  value:value||"photoreal",onChange:e=>onPick&&onPick(e.target.value)},[
    React.createElement("option",{key:"photoreal",value:"photoreal"},"Photoreal"),
    React.createElement("option",{key:"stylized",value:"stylized"},"Stylized")
  ]);
window.Icon={chevD:()=>React.createElement("span",null,"⌄"),chevR:()=>React.createElement("span",null,"›"),
  sparkles:()=>React.createElement("span",null,"✦"),layers:()=>React.createElement("span",null,"≋"),
  eye:()=>React.createElement("span",null,"◉"),plus:()=>React.createElement("span",null,"+"),
  image:()=>React.createElement("span",null,"▧"),bolt:()=>React.createElement("span",null,"•"),
  moreV:()=>React.createElement("span",null,"⋮"),info:()=>React.createElement("span",null,"i"),
  wand:()=>React.createElement("span",null,"✧"),target:()=>React.createElement("span",null,"◎"),
  box:()=>React.createElement("span",null,"□"),x:()=>React.createElement("span",null,"×"),
  trash:()=>React.createElement("span",null,"⌫"),clock:()=>React.createElement("span",null,"◷"),
  warn:()=>React.createElement("span",null,"!"),globe:()=>React.createElement("span",null,"◎"),
  userScan:()=>React.createElement("span",null,"◌"),monitor:()=>React.createElement("span",null,"▣"),
  calendar:()=>React.createElement("span",null,"◫"),history:()=>React.createElement("span",null,"↶"),
  undo:()=>React.createElement("span",null,"↩")};
const fixtureLocation={id:"loc-house",key:"house",name:"House",parentLocation:null,rootLocationId:"loc-house",
  scope:"atomic",intExt:"INT",scenes:[],coverageSheets:[],variants:[],childLocations:[],manual:"",
  significance:"",architecture:"",materials:"",lighting:"",staging:"",renderStyleKey:"photoreal"};
window.SheetFrame=window.SheetFrame||(()=>null);
window.__fixture.renderErrors=[];window.addEventListener("error",e=>__fixture.renderErrors.push(String(e.error?.stack||e.message)));
window.addEventListener("unhandledrejection",e=>__fixture.renderErrors.push(String(e.reason?.stack||e.reason)));
window.mountLocation=()=>window.__root.render(React.createElement(LocationSheet,{key:"location-card",l:fixtureLocation,project:{},scenes:[],drafts:{},onUpdate:fixtureNoop,onDelete:fixtureNoop,onDraft:fixtureNoop,drafting:false,onView:fixtureNoop,batchActiveId:null,onBatchDone:fixtureNoop,onChipClick:fixtureNoop,onDraftStaging:fixtureNoop,draftingStage:false,sluglineUnits:[],onUpdateUnit:fixtureNoop,onRemoveUnit:fixtureNoop,readOnly:false}));
window.__root=ReactDOM.createRoot(document.getElementById("root"));window.mount=(readOnly=false,key="normal")=>window.__root.render(React.createElement(BlenderStudioEntry,{key,location:{id:"loc-house",name:"House",rootLocationId:"loc-house",context:{description:"",architecture:"brick",materials:"wood",staging:""}},shot:{id:"shot-a",sceneId:"scene-a",name:"Shot A"},references:[{entityId:"loc-house",label:"House",kind:"location"},{entityId:"char-a",label:"Ava",kind:"character"}],readOnly}));
mount();
</script></body></html>`;}
function server(){return createServer(async(req,res)=>{try{const f=req.url==="/"?"index.html":req.url.slice(1),data=await readFile(`${FIXTURE}/${f}`);res.writeHead(200,{"content-type":f.endsWith(".html")?"text/html":f.endsWith(".css")?"text/css":"text/javascript","cache-control":"no-store"}).end(data);}catch{res.writeHead(404).end();}});}
class NativeWS{static async connect(url){const u=new URL(url),key=crypto.randomBytes(16).toString("base64"),socket=net.connect(+u.port,u.hostname);let header=Buffer.alloc(0);await new Promise((ok,bad)=>{socket.once("error",bad);socket.once("connect",()=>socket.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));socket.on("data",data=>{header=Buffer.concat([header,data]);if(header.includes(Buffer.from("\r\n\r\n")))header.toString().startsWith("HTTP/1.1 101")?ok():bad(Error("CDP websocket handshake failed"));});});const ws=new NativeWS(socket);socket.on("data",data=>ws.read(data));return ws;}constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.onmessage=null;}send(text){const payload=Buffer.from(text),mask=crypto.randomBytes(4),head=payload.length<126?Buffer.from([129,128|payload.length]):Buffer.from([129,254,payload.length>>8,payload.length&255]);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];this.socket.write(Buffer.concat([head,mask,payload]));}read(data){this.buffer=Buffer.concat([this.buffer,data]);while(this.buffer.length>=2){let n=this.buffer[1]&127,offset=2;if(n===126){if(this.buffer.length<4)return;n=this.buffer.readUInt16BE(2);offset=4;}else if(n===127){if(this.buffer.length<10)return;n=this.buffer.readUInt32BE(6);offset=10;}if(this.buffer.length<offset+n)return;const text=this.buffer.subarray(offset,offset+n).toString();this.buffer=this.buffer.subarray(offset+n);if(this.onmessage)this.onmessage({data:text});}}close(){this.socket.destroy();}}
class CDP{constructor(ws){this.ws=ws;this.n=0;this.p=new Map();}static async connect(url){const ws=await NativeWS.connect(url);const c=new CDP(ws);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const [a,b]=c.p.get(m.id);c.p.delete(m.id);m.error?b(new Error(m.error.message)):a(m.result);}};return c;}call(method,params={}){const id=++this.n;this.ws.send(JSON.stringify({id,method,params}));return new Promise((a,b)=>this.p.set(id,[a,b]));}async eval(expression){const r=await this.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}close(){this.ws.close();}}
async function wait(fn,label){const end=Date.now()+10000;let last="";while(Date.now()<end){last=await fn();if(last)return;await new Promise(r=>setTimeout(r,70));}throw new Error("Timed out: "+label+(last?": "+last:""));}
async function setupChecks(c,origin){
  await c.call("Page.bringToFront");
  await c.call("Emulation.setFocusEmulationEnabled",{enabled:true});
  assert.equal(await c.eval(`document.hasFocus()`),true,"clipboard verification requires a focused document");
  const pairButton=`document.querySelector('[data-testid="blender-studio-pair"]')`;
  const codeButton=`document.querySelector('[data-testid="blender-studio-copy-code"]')`;
  const urlButton=`document.querySelector('[data-testid="blender-studio-copy-url"]')`;
  await wait(()=>c.eval(`${pairButton}&&!${pairButton}.disabled`),"ready pairing action");
  assert.deepEqual(await c.eval(`[...document.querySelectorAll(".bs-step-number")].map(x=>x.textContent)`),["1","2","3","4"],"workflow has four ordered steps");
  assert.equal(await c.eval(`!!document.querySelector(".bs-details")&&!document.querySelector(".bs-details").open`),true,"technical details start collapsed");
  await c.eval(`${pairButton}.click()`);
  await wait(()=>c.eval(`!!${codeButton}`),"separate Copy button");
  assert.equal(await c.eval(`${codeButton}.textContent`),"Copy","copy action uses the requested button label");
  assert.equal(await c.eval(`${urlButton}.textContent`),"Copy","Function URL has its own Copy button");
  assert.equal(await c.eval(`${codeButton}.previousElementSibling.tagName`),"CODE","code text is a sibling, not part of the button");
  assert.equal(await c.eval(`document.querySelector(".bs-pair-code").textContent.includes("Click to copy")`),false,"old clickable-field wording is removed");
  const initialPairs=await c.eval(`__fixture.pairCount`);
  await c.call("Browser.grantPermissions",{origin,permissions:["clipboardReadWrite","clipboardSanitizedWrite"]});
  await c.eval(`navigator.clipboard.writeText("fixture-clipboard-before-copy").then(()=>document.querySelector('[data-testid="blender-studio-code-value"]').click())`);
  assert.equal(await c.eval(`navigator.clipboard.readText()`),"fixture-clipboard-before-copy","clicking the plain code does not invoke copying");
  await c.eval(`${codeButton}.click()`);
  await wait(()=>c.eval(`document.body.innerText.includes("Pairing code copied.")`),"code copy confirmation");
  assert.equal(await c.eval(`navigator.clipboard.readText().then(text=>text===__fixture.currentCode)`),true,"click copies the entire code, not its label or expiry");
  await c.eval(`${urlButton}.click()`);
  await wait(()=>c.eval(`document.body.innerText.includes("Function URL copied.")`),"endpoint copy confirmation");
  assert.equal(await c.eval(`navigator.clipboard.readText().then(text=>text===BlenderPreview.endpoint())`),true,"endpoint copy uses configured public URL");
  await c.eval(`${codeButton}.focus()`);
  await c.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:"\r",unmodifiedText:"\r"});
  await c.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
  await wait(()=>c.eval(`document.body.innerText.includes("Pairing code copied.")`),"keyboard code copy");
  assert.equal(await c.eval(`navigator.clipboard.readText().then(text=>text===__fixture.currentCode)`),true,"keyboard activation copies code");
  assert.equal(await c.eval(`__fixture.pairCount`),initialPairs,"copy never creates another pairing code");
  await c.eval(`__fixture.originalClipboard=navigator.clipboard;__fixture.originalCommand=document.execCommand;
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>Promise.reject(new Error("blocked by iframe"))}});
    document.execCommand=function(command){if(command==="copy"){__fixture.fallbackText=document.activeElement.value;return true;}return false;};
    ${codeButton}.click();`);
  await wait(()=>c.eval(`__fixture.fallbackText===__fixture.currentCode`),"blocked API uses complete-code fallback");
  assert.equal(await c.eval(`document.body.innerText.includes("Pairing code copied.")`),true,"successful fallback is acknowledged");
  await c.eval(`document.execCommand=()=>false;${codeButton}.click()`);
  await wait(()=>c.eval(`!!document.querySelector(".bs-manual-copy")`),"blocked clipboard manual fallback");
  assert.equal(await c.eval(`document.querySelector(".bs-manual-copy").value===__fixture.currentCode`),true,"manual fallback includes the full code");
  assert.equal(await c.eval(`${codeButton}.textContent.includes("Copied")`),false,"blocked copy never reports success");
  await c.eval(`Object.defineProperty(navigator,"clipboard",{configurable:true,value:__fixture.originalClipboard});document.execCommand=__fixture.originalCommand;${pairButton}.click()`);
  await wait(()=>c.eval(`__fixture.pairCount===${initialPairs+1}&&!!${codeButton}`),"new code");
  assert.equal(await c.eval(`${codeButton}.textContent.includes("Copied")`),false,"new code resets previous copy state");
  assert.equal(await c.eval(`!!document.querySelector(".bs-manual-copy")`),false,"new code clears manual-copy state");
  await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await c.eval(`document.querySelector('[data-testid="blender-studio-step-connect"]').scrollIntoView();new Promise(r=>setTimeout(r,80))`);
  assert.equal(await c.eval(`window.innerWidth`),390,"mobile measurement uses the requested viewport");
  assert.equal(await c.eval(`document.documentElement.scrollWidth<=390`),true,"long pairing code never overflows mobile viewport");
  assert.equal(await c.eval(`(()=>{const code=document.querySelector('[data-testid="blender-studio-code-value"]');return code.scrollWidth<=code.clientWidth+1;})()`),true,"full code wraps beside its Copy button");
  assert.equal(await c.eval(`${codeButton}.scrollWidth<=${codeButton}.clientWidth+1`),true,"Copy button text remains visible");
  const mobile=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  await writeFile(`${OUT}/blender-studio-pairing-mobile.png`,Buffer.from(mobile.data,"base64"));
  await c.eval(`document.documentElement.dataset.theme="light";new Promise(r=>setTimeout(r,50))`);
  assert.equal(await c.eval(`document.documentElement.scrollWidth<=390`),true,"light-theme setup also fits the narrow viewport");
  assert.ok(await c.eval(`(()=>{
    const style=getComputedStyle(${pairButton}),canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    const luminance=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4);});return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
    const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5;
  })()`),"pairing action text meets normal-text contrast in light mode");
  const light=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  await writeFile(`${OUT}/blender-studio-pairing-light.png`,Buffer.from(light.data,"base64"));
  await c.eval(`delete document.documentElement.dataset.theme`);
  await c.call("Emulation.clearDeviceMetricsOverride");
  await c.eval(`__fixture.expiryMs=-1000;${pairButton}.click()`);
  await wait(()=>c.eval(`document.querySelector('[data-testid="blender-studio-code-expiry"]').textContent.includes("expired")`),"expired code guidance");
  assert.equal(await c.eval(`${codeButton}.disabled`),true,"expired code cannot be copied");
  await c.eval(`__fixture.expiryMs=600000;${pairButton}.click()`);
  await wait(()=>c.eval(`${codeButton}&&!${codeButton}.disabled`),"replacement code restores copy");
  await c.eval(`__fixture.connected=true`);
  await wait(()=>c.eval(`document.querySelector('[data-testid="blender-studio-step-connect"] summary').textContent.includes("Paired")`),"automatic pairing confirmation");
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-studio-connection-status"]').textContent`),"Paired with Test Blender desktop","server pairing does not claim desktop liveness");
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-studio-step-connect"]').textContent.includes("not Blender’s live status")`),true,"paired state explains desktop confirmation");
  assert.equal(await c.eval(`!!${codeButton}`),false,"used pairing code is removed after connection");
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-studio-step-connect"] details').open`),false,"completed connection folds away");
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-studio-step-install"] details').open`),false,"completed installation folds away");
  await c.eval(`window.scrollTo(0,0)`);
  const ready=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  await writeFile(`${OUT}/blender-studio-ready.png`,Buffer.from(ready.data,"base64"));
  await c.eval(`document.querySelector('[data-testid="blender-studio-step-connect"] summary').click();document.documentElement.dataset.theme="light";new Promise(r=>setTimeout(r,50))`);
  const paired=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  await writeFile(`${OUT}/blender-studio-paired.png`,Buffer.from(paired.data,"base64"));
  await c.eval(`delete document.documentElement.dataset.theme`);
  // Check role and stale-scope behavior later without calling a real service.
}
async function locationSectionChecks(){
  // Card placement is now covered independently; the full modal has a
  // non-spending fixture in test-blender-studio-derived.mjs --serve.
  await import('./test-locations-blender-studio.mjs');
}
async function main(){await prepare();const s=server();await new Promise(ok=>s.listen(0,"127.0.0.1",ok));const debug=9700+Math.floor(Math.random()*200),chrome=spawn(CHROME,["--headless=new","--no-sandbox","--disable-gpu",`--remote-debugging-port=${debug}`,`--user-data-dir=${FIXTURE}/profile`,"about:blank"],{stdio:"ignore"});let c;try{
  let target;await wait(async()=>{try{const r=await fetch(`http://127.0.0.1:${debug}/json/list`);target=(await r.json()).find(x=>x.type==="page");return !!target;}catch{return false;}},"Chrome");
  c=await CDP.connect(target.webSocketDebuggerUrl);await c.call("Page.enable");await c.call("Page.navigate",{url:`http://127.0.0.1:${s.address().port}/`});
  await wait(()=>c.eval(`!!document.querySelector('[data-testid="blender-studio-entry"]')`),"Studio mount");
   await c.eval(`document.querySelector('.bs-head button').click()`);await wait(()=>c.eval(`!!document.querySelector(".bs-send select")`),"capabilities and workspace open");
   await setupChecks(c,`http://127.0.0.1:${s.address().port}`);
  assert.equal(await c.eval(`window.__fixture.workspace.shots[0].objects[0].id`),"actor-a","open preserves existing shot actors");
  assert.equal(await c.eval(`window.__fixture.workspace.shots[0].camera.focalLength`),50,"open preserves existing shot camera");
  await c.eval(`(()=>{const put=(e,v)=>{Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(e,v);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));};put(document.querySelector("textarea"),"add a lamp");put(document.querySelector(".bs-send select"),"scene-ok");document.querySelector('.bs-send input[type="checkbox"]').click();})()`);await wait(()=>c.eval(`document.querySelector(".bs-send select").value==="scene-ok"&&document.querySelector('.bs-send input[type="checkbox"]').checked`),"scene composer state");await c.eval(`document.querySelector(".bs-send button").click()`);
  await wait(()=>c.eval(`document.body.innerText.includes("Proposal preview")`),"assistant submit/proposal");
  await c.eval(`([...document.querySelectorAll("button")].find(b=>b.textContent.includes("Apply proposal"))).click()`);await wait(()=>c.eval(`window.__fixture.workspace.objects.some(x=>x.id==="lamp-1")`),"apply/save");
  await c.eval(`([...document.querySelectorAll(".bs-tabs button")].find(b=>b.textContent.includes("Image to 3D"))).click()`);await wait(()=>c.eval(`!!document.querySelector(".bs-source select")`),"reference source");
  await c.eval(`(()=>{const put=(e,v)=>{Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,"value").set.call(e,v);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?"change":"input",{bubbles:true}));};put(document.querySelector(".bs-source select"),"char-a");put(document.querySelector("textarea"),"chair");put(document.querySelector(".bs-send select"),"meshy/v7/image-to-3d");})()`);await wait(()=>c.eval(`document.querySelector(".bs-source select").value==="char-a"&&document.querySelector(".bs-send select").value==="meshy/v7/image-to-3d"`),"mesh composer state");await c.eval(`document.querySelector(".bs-send button").click()`);await wait(()=>c.eval(`document.body.innerText.includes("Save generated asset")`),"mesh submit");
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
   assert.equal(await c.eval(`document.querySelector('[data-testid="blender-studio-pair"]').disabled`),true,"view-only users cannot create pairing codes");
   assert.equal(await c.eval(`!!document.querySelector('[data-testid="blender-studio-copy-code"]')`),false,"view-only remount retains no old pairing credential");
  await locationSectionChecks(c);
  const opensBeforeStale=await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.workspace.open").length`);
  await c.eval(`window.__fixture.live=true;window.__fixture.defer=true;window.mount(false,"stale")`);await wait(()=>c.eval(`!!document.querySelector(".bs-head button")`),"stale mount");await c.eval(`document.querySelector(".bs-head button").click()`);await wait(()=>c.eval(`typeof window.__fixture.resolve==="function"`),"deferred capability");await c.eval(`window.__fixture.live=false;window.__fixture.resolve();new Promise(r=>setTimeout(r,80))`);assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.action==="studio.workspace.open").length`),opensBeforeStale,"stale capability response does not open a workspace");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.assistant.submit"&&x.body.referenceId==="loc-house")`),true,"assistant supplies the mandatory generated location reference ID");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.mesh.submit"&&x.body.referenceId==="char-a")`),true,"mesh sends explicit reference ID");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.action==="studio.mesh.get")`),true,"queued mesh task is polled through its frozen get action");
  console.log(`PASS Blender Studio Chromium fixture; screenshot ${OUT}/blender-studio-fixture.png`);
}finally{try{c?.close();}catch{}chrome.kill("SIGTERM");s.close();}}
main().catch(e=>{console.error("FAIL Blender Studio Chromium fixture\\n"+(e.stack||e));process.exitCode=1;});

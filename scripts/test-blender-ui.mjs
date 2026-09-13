#!/usr/bin/env node
/*
 * Browser regression for the real per-shot BlenderPreviewPanel.  The page is
 * isolated in /tmp: React and the optional client/contract sources come from
 * this checkout, while transport, auth and auxiliary storage are deterministic
 * fakes. No Supabase project, Blender process, or paid media route is used.
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile,writeFile,access} from "node:fs/promises";
import {spawn} from "node:child_process";
import {transformSync} from "@babel/core";
import net from "node:net";
import crypto from "node:crypto";
import {deflateSync} from "node:zlib";

const ROOT=new URL("../",import.meta.url);
const FIXTURE=`/tmp/blender-ui-${process.pid}`;
const CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium";
const OUT=process.env.BLENDER_UI_OUT||`${FIXTURE}/screenshots`;
const reactUrls={
  "react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js",
  "react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js",
};
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
const transform=source=>transformSync(source,{
  presets:[["@babel/preset-react",{runtime:"classic"}]],
  plugins:["@babel/plugin-transform-block-scoping"],
  comments:false,compact:false,babelrc:false,configFile:false,
  filename:"blender-preview-ui.jsx",
}).code;
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
  return (crc^0xffffffff)>>>0;
}
function pngChunk(type,data){
  const name=Buffer.from(type),body=Buffer.concat([name,data]),out=Buffer.alloc(12+data.length);
  out.writeUInt32BE(data.length,0);body.copy(out,4);out.writeUInt32BE(crc32(body),8+data.length);return out;
}
function fixturePng(width=640,height=360){
  const raw=Buffer.alloc(height*(1+width*3)),compressed=deflateSync(raw),header=Buffer.alloc(13);
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),
    pngChunk("IDAT",compressed),pngChunk("IEND",Buffer.alloc(0))]).toString("base64");
}

async function prepare(){
  await mkdir(FIXTURE,{recursive:true}); await mkdir(OUT,{recursive:true}); await mkdir(`${FIXTURE}/downloads`,{recursive:true});
  const ui=await readFile(new URL("../app/blender-preview-ui.jsx",import.meta.url),"utf8");
  const appCss=await readFile(new URL("../app/styles.css",import.meta.url));
  const css=await readFile(new URL("../app/blender-preview.css",import.meta.url));
  await writeFile(`${FIXTURE}/ui.js`,transform(ui)); await writeFile(`${FIXTURE}/styles.css`,`${appCss}\n${css}`);
  const visualPath="/tmp/blender-preview-35.png";
  const visualPng=await exists(visualPath)?(await readFile(visualPath)).toString("base64"):"";
  const contractPath=(await exists(new URL("../app/blender-contract.js",import.meta.url)))
    ? new URL("../app/blender-contract.js",import.meta.url) : null;
  const runtimePath=(await exists(new URL("../app/blender-preview.js",import.meta.url)))
    ? new URL("../app/blender-preview.js",import.meta.url) : null;
  const runtimeParts=[];
  if(contractPath) runtimeParts.push(await readFile(contractPath,"utf8"));
  if(runtimePath) runtimeParts.push(await readFile(runtimePath,"utf8"));
  await writeFile(`${FIXTURE}/runtime.js`,runtimeParts.join("\n"));
  for(const [name,url] of Object.entries(reactUrls)){
    if(await exists(`${FIXTURE}/${name}`)) continue;
    const response=await fetch(url);
    if(!response.ok) throw new Error(`Could not cache ${url}: HTTP ${response.status}`);
    await writeFile(`${FIXTURE}/${name}`,Buffer.from(await response.arrayBuffer()));
  }
  await writeFile(`${FIXTURE}/index.html`,html(Boolean(runtimePath),visualPng));
  return {runtimePath};
}

function html(hasRuntime,visualPng=""){
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
 <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">
 <style>html,body,#root{height:auto;min-height:0;overflow:auto}#root{display:block}</style></head><body><main id="root"></main>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
  window.__fixture={calls:[],updates:[],saved:[],runtimeLoaded:${hasRuntime},job:null,connected:true,
  scopeProject:"film-fixture",failSave:true,deferHash:false,hashPending:null,deferConnection:false,
  connectionPending:null,forbiddenConnection:false,forbiddenJobGet:false,deferJob:false,jobGetPending:null,commitPending:null,saveAttempts:0,
  visualPng:"${visualPng}",addonMode:"ok",frameAnchorIntercepts:0,addonPending:false,addonAbort:false};
 window.__fixture.nativeFetch=window.fetch.bind(window);
window.__fixture.fetch=async (url,opts)=>{
  const pathname=new URL(typeof url==="string"?url:url.url,location.href).pathname;
  if(pathname==="/app/downloads/cinema-machine-blender.zip"){
    if(window.__fixture.addonMode==="404") return new Response("not found",{status:404});
    if(window.__fixture.addonMode==="html200") return new Response("<!doctype html><title>not a zip</title>",{
      status:200,headers:{"content-type":"text/html"}});
    if(window.__fixture.addonMode==="hang") return await new Promise((resolve,reject)=>{
      window.__fixture.addonPending=true;
      opts&&opts.signal&&opts.signal.addEventListener("abort",()=>{
        window.__fixture.addonPending=false;window.__fixture.addonAbort=true;
        reject(new DOMException("Aborted","AbortError"));
      },{once:true});
    });
    return window.__fixture.nativeFetch(url,opts);
  }
  const raw=opts&&opts.body;let body=null;
  try{body=raw?JSON.parse(raw):null;}catch(error){window.__fixture.calls.push({url,method:(opts&&opts.method)||"GET",raw});return {ok:false,status:404,json:async()=>({error:"fixture malformed request"})};}
  window.__fixture.calls.push({url,method:(opts&&opts.method)||"GET",body});
  if((opts&&opts.method)==="GET" || body&&body.action==="capabilities")
    return {ok:true,json:async()=>({version:1,actions:["pair.create","connection.get","connection.disconnect","job.create","job.get","job.cancel"]})};
  if(body&&body.action==="pair.create") return {ok:true,json:async()=>({pairCode:"PAIR-1234",expiresAt:new Date(Date.now()+600000).toISOString()})};
  if(body&&body.action==="connection.get"){
    if(window.__fixture.forbiddenConnection) return {ok:false,status:403,json:async()=>({code:"forbidden",error:"fixture forbidden"})};
    if(window.__fixture.deferConnection) return await new Promise(resolve=>{window.__fixture.connectionPending=resolve;});
    return {ok:true,json:async()=>({connected:window.__fixture.connected,deviceName:"Fixture Blender",job:window.__fixture.job})};
  }
  if(body&&body.action==="connection.disconnect"){window.__fixture.connected=false;return {ok:true,json:async()=>({connected:false,job:null})};}
  if(body&&body.action==="job.create"){
    const spec=body.spec,delta=spec.camera.target.map((x,i)=>x-spec.camera.position[i]);
    const length=Math.hypot(...delta),hash=await window.__fixture.realHash(spec);
    window.__fixture.job={id:"job-"+(++window.__fixture.saveAttempts),requestId:body.requestId,
      status:window.__fixture.deferJob?"running":"completed",
      spec,specHash:hash,pngBase64:window.__fixture.png,
      actualCamera:{position:spec.camera.position.slice(),direction:delta.map(x=>x/length),
        focalLength:spec.camera.focalLength,sensorWidth:spec.camera.sensorWidth,width:spec.render.width,height:spec.render.height}};
    return {ok:true,json:async()=>({job:window.__fixture.job})};
  }
  if(body&&body.action==="job.get"){
    if(window.__fixture.forbiddenJobGet) return {ok:false,status:403,json:async()=>({code:"forbidden",error:"fixture forbidden"})};
    if(window.__fixture.deferJob) return await new Promise(resolve=>{window.__fixture.jobGetPending=resolve;});
    return {ok:true,json:async()=>({job:window.__fixture.job})};
  }
  if(body&&body.action==="job.cancel"){
    if(window.__fixture.job) window.__fixture.job={...window.__fixture.job,status:"cancelled"};
    return {ok:true,json:async()=>({job:window.__fixture.job})};
  }
  return {ok:false,status:404,json:async()=>({error:"fixture action not found"})};
};
window.fetch=window.__fixture.fetch;
window.TURN_SUPABASE={url:"https://fixture.test",anonKey:"fixture-anon"};
window.nbCloudScope=()=>({projectId:window.__fixture.scopeProject,uid:"user-fixture",epoch:1});
window.cloudGetSession=async()=>({user:{id:"user-fixture"}});
window.sbClient=()=>({
  auth:{getSession:async()=>({
    data:{session:{access_token:"fixture-token",user:{id:"user-fixture"}}}
  })}
});
window.nbEpoch=()=>1; window.turnContinuity={};
window.nbLoadImage=async()=>null; window.nbGetMeta=()=>null;
window.nbCommit=async (...args)=>{window.__fixture.saveAttempts++;
  if(window.__fixture.failSave){window.__fixture.failSave=false;throw new Error("Fixture storage unavailable");}
  if(window.__fixture.deferCommit) return await new Promise((resolve,reject)=>{
    window.__fixture.commitPending={args,resolve,reject};
  });
  window.__fixture.saved.push(args);
  return {tier:"idb",url:args[1],meta:args[2]||{}}};
window.__fixture.releaseCommit=()=>{const pending=window.__fixture.commitPending;if(!pending)return;
  window.__fixture.commitPending=null;
  if(pending.args[6]&&pending.args[6]()) pending.reject(new Error("Fixture commit cancelled"));
  else {window.__fixture.saved.push(pending.args);pending.resolve({tier:"idb",url:pending.args[1],meta:pending.args[2]||{}});}
};
window.__fixture.releaseHash=()=>{const pending=window.__fixture.hashPending;if(!pending)return;
  window.__fixture.hashPending=null;window.__fixture.realHash(pending.spec).then(pending.resolve);};
window.__fixture.releaseConnection=()=>{const resolve=window.__fixture.connectionPending;if(!resolve)return;
  window.__fixture.connectionPending=null;resolve({ok:true,json:async()=>({connected:window.__fixture.connected,job:window.__fixture.job})});};
window.__fixture.releaseJobGet=()=>{const resolve=window.__fixture.jobGetPending;if(!resolve)return;
  window.__fixture.jobGetPending=null;resolve({ok:true,json:async()=>({job:window.__fixture.job})});};
window.Icon=new Proxy({}, {get:(_,name)=>({s=12})=>React.createElement("span",{"data-icon":String(name),style:{display:"inline-block",width:s,height:s}})});
window.addEventListener("error",e=>window.__fixture.error=String(e.error&&e.error.stack||e.message||e));
window.addEventListener("unhandledrejection",e=>window.__fixture.error=String(e.reason&&e.reason.stack||e.reason||e));
</script>
<script src="/runtime.js"></script>
<script>
(()=>{const real=window.BlenderPreview||{};window.__fixture.realHash=real.hashSpec;
  window.__fixture.png="${fixturePng()}";
  window.BlenderPreview={...real,isCurrent:s=>!!s&&s.projectId===window.__fixture.scopeProject&&s.uid==="user-fixture",
    hashSpec:spec=>window.__fixture.deferHash
      ? new Promise(resolve=>{window.__fixture.hashPending={spec,resolve};})
      : window.__fixture.realHash(spec)};
})();
window.__mount=(readOnly=false,lens="50")=>{const root=window.__fixture.root||ReactDOM.createRoot(document.querySelector("#root"));
 root.render(React.createElement(window.BlenderPreviewPanel,{shot:{id:"shot-1",label:"Shot 1",lens,cameraSettings:{}},
 scene:{id:"scene-1",title:"Kitchen"},location:{id:"loc-1",name:"Kitchen"},
 subjects:[{id:"char-1",name:"Mara"}],props:[{id:"prop-1",name:"Letter"}],
 readOnly,onUpdate:(id,patch)=>window.__fixture.updates.push({id,patch})}));window.__fixture.root=root;};
 window.__unmount=()=>{if(window.__fixture.root)window.__fixture.root.unmount();};
</script>
<script src="/ui.js"></script><script>window.__mount();</script></body></html>`;
}

function server(){
  return createServer(async(req,res)=>{
    const name=new URL(req.url,"http://fixture").pathname.slice(1)||"index.html";
    if(name==="app/downloads/cinema-machine-blender.zip"){
      try{
        const body=await readFile(new URL("../app/downloads/cinema-machine-blender.zip",import.meta.url));
        res.writeHead(200,{"content-type":"application/zip","content-disposition":"attachment; filename=\"cinema-machine-blender.zip\"",
          "content-length":body.length}).end(body);
      }catch{res.writeHead(404).end("missing");}
      return;
    }
    if(!/^[a-z0-9._-]+$/i.test(name)){res.writeHead(404).end();return;}
    try{const body=await readFile(`${FIXTURE}/${name}`);
      const type=name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":"text/javascript";
      res.writeHead(200,{"content-type":type}).end(body);
    }catch{res.writeHead(404).end("missing");}
  });
}
class NativeWS{
  static async connect(url){
    const u=new URL(url),key=crypto.randomBytes(16).toString("base64"),socket=net.connect(+u.port,u.hostname);
    let header=Buffer.alloc(0);
    await new Promise((ok,bad)=>{socket.once("error",bad);socket.once("connect",()=>socket.write(
      `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      socket.on("data",data=>{header=Buffer.concat([header,data]);if(header.includes(Buffer.from("\r\n\r\n"))){
        header.toString().startsWith("HTTP/1.1 101")?ok():bad(Error("CDP websocket handshake failed"));}});
    });
    const ws=new NativeWS(socket);socket.on("data",data=>ws.read(data));return ws;
  }
  constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.onmessage=null;}
  send(text){const payload=Buffer.from(text),mask=crypto.randomBytes(4);
    const head=payload.length<126?Buffer.from([129,128|payload.length]):Buffer.from([129,254,payload.length>>8,payload.length&255]);
    for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];this.socket.write(Buffer.concat([head,mask,payload]));}
  read(data){this.buffer=Buffer.concat([this.buffer,data]);while(this.buffer.length>=2){let n=this.buffer[1]&127,offset=2;
    if(n===126){if(this.buffer.length<4)return;n=this.buffer.readUInt16BE(2);offset=4;}
    else if(n===127){if(this.buffer.length<10)return;n=this.buffer.readUInt32BE(6);offset=10;}
    if(this.buffer.length<offset+n)return;const text=this.buffer.subarray(offset,offset+n).toString();
    this.buffer=this.buffer.subarray(offset+n);if(this.onmessage)this.onmessage({data:text});}}
  close(){this.socket.destroy();}
}
class CDP{
  constructor(ws){this.ws=ws;this.seq=0;this.pending=new Map();}
  static async connect(url){const ws=await NativeWS.connect(url);const c=new CDP(ws);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.pending.has(m.id)){
      const [ok,bad]=c.pending.get(m.id);c.pending.delete(m.id);m.error?bad(new Error(m.error.message)):ok(m.result);}};return c;}
  call(method,params={}){const id=++this.seq;this.ws.send(JSON.stringify({id,method,params}));
    return new Promise((ok,bad)=>this.pending.set(id,[ok,bad]));}
  eval(expression){return this.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true}).then(r=>{
    if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;});}
  close(){this.ws.close();}
}
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function waitFor(fn,label){for(let i=0;i<500;i++){if(await fn())return;await sleep(40);}throw new Error(`Timed out waiting for ${label}`);}

const {runtimePath}=await prepare(); const http=server();
await new Promise(ok=>http.listen(0,"127.0.0.1",ok));
const debugPort=9500+Math.floor(Math.random()*300);
const chrome=spawn(CHROME,["--headless=new","--no-sandbox","--disable-gpu",`--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${FIXTURE}/profile`,"about:blank"],{stdio:"ignore"});
let c;
try{
  const target=await (async()=>{for(let i=0;i<100;i++){try{const rows=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page=rows.find(x=>x.type==="page"&&x.webSocketDebuggerUrl);if(page)return page;}catch{}await sleep(40);}
    throw new Error("Chromium target did not start");})();
  c=await CDP.connect(target.webSocketDebuggerUrl);await c.call("Page.enable");await c.call("Runtime.enable");
  try{await c.call("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:`${FIXTURE}/downloads`});}
  catch{await c.call("Page.setDownloadBehavior",{behavior:"allow",downloadPath:`${FIXTURE}/downloads`});}
  await c.call("Page.navigate",{url:`http://127.0.0.1:${http.address().port}/`});
  await waitFor(()=>c.eval(`!!window.__fixture&&!!document.querySelector('[data-testid="blender-preview-panel"]')`),"Blender preview panel");
  const mounted=await c.eval(`!!window.__fixture&&!!document.querySelector('[data-testid="blender-preview-panel"]')`);
  if(!mounted) console.error("Panel diagnostics:",await c.eval(`location.href+" :: fixture="+typeof window.__fixture+" :: "+[...document.querySelectorAll("[data-testid]")].map(x=>x.getAttribute("data-testid")).join(",")+" :: "+document.body.textContent.slice(0,300)+" :: "+JSON.stringify(window.__fixture&&window.__fixture.calls||[])+" :: "+(window.__fixture&&window.__fixture.error||"")`));
  assert.equal(mounted,true,"Blender preview panel mounted");
  if(process.env.BLENDER_UI_VISUAL_ONLY==="1"){
    await sleep(600);
    const desktop=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
    const desktopPath=`${OUT}/blender-preview.png`;await writeFile(desktopPath,Buffer.from(desktop.data,"base64"));
    await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(100);
    const mobile=await c.eval(`({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth})`);
    assert.ok(mobile.scrollWidth<=391,`Blender panel overflows at 390px: ${JSON.stringify(mobile)}`);
    const mobileShot=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
    const mobilePath=`${OUT}/blender-preview-390.png`;await writeFile(mobilePath,Buffer.from(mobileShot.data,"base64"));
    console.log(`Visual desktop: ${desktopPath}`);console.log(`Visual mobile: ${mobilePath}`);
    c.close();chrome.kill();http.close();process.exit(0);
  }
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-frame-inputs"]').textContent.includes("Mara")`),true);
  assert.equal(await c.eval(`document.body.textContent.includes("no character likeness")`),true);
  await c.eval(`window.__mount(false,"58")`);
  await waitFor(()=>c.eval(`[...document.querySelectorAll("input")].some(x=>x.value==="58")`),"external lens refresh");
  await c.eval(`(()=>{const i=[...document.querySelectorAll("input")].find(x=>x.value==="58");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"72");i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  try{ await waitFor(()=>c.eval(`window.__fixture.updates.some(x=>x.id==="shot-1"&&x.patch.lens==="72"&&x.patch.cameraSettings.focalLength==="72")`),"lens update"); }
  catch(error){ console.error("Lens diagnostics:",await c.eval(`JSON.stringify(window.__fixture.updates)+" :: "+[...document.querySelectorAll("input")].map(x=>x.value).join(",")`)); throw error; }
  await c.eval(`(()=>{const i=document.querySelectorAll("input")[7];const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"-6");i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await c.eval(`(()=>{const i=document.querySelectorAll("input")[8];const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"1.65");i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await waitFor(()=>c.eval(`document.body.textContent.includes("different point")`),"invalid camera guard");
  await c.eval(`(()=>{const i=document.querySelectorAll("input")[7];const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"0");i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await c.eval(`(()=>{const i=document.querySelectorAll("input")[8];const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"1.4");i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await c.eval(`document.querySelector('[data-testid="blender-pair"]').click()`);
  await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="blender-pair-code"]')`),"pair code");
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-pair-code"]').textContent.includes("PAIR-1234")`),true);
  await c.eval(`window.__fixture.deferHash=true;document.querySelector('[data-testid="blender-render"]').click()`);
  await waitFor(()=>c.eval(`!!window.__fixture.hashPending`),"deferred hash");
  await c.eval(`document.querySelector('[data-testid="blender-disconnect"]').click()`);
  await waitFor(()=>c.eval(`window.__fixture.calls.some(x=>x.body&&x.body.action==="connection.disconnect")`),"disconnect request");
  await c.eval(`window.__fixture.releaseHash();window.__fixture.deferHash=false;window.__fixture.connected=true`);
  await sleep(150);
  assert.equal(await c.eval(`!window.__fixture.calls.some(x=>x.body&&x.body.action==="job.create")`),true,
    "disconnect during render hashing prevents job.create");
  assert.equal(await c.eval(`document.querySelector(".bp-status").textContent==="not paired"`),true,
    "explicit disconnect clears the paired connection state");
  await c.eval(`document.querySelector('[data-testid="blender-pair"]').click()`);
  await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="blender-pair-code"]')`),"re-pair code");
  await waitFor(()=>c.eval(`!document.querySelector('[data-testid="blender-render"]').disabled`),"reconnected render controls");
  await waitFor(()=>c.eval(`!document.querySelector('[data-testid="blender-render"]').disabled`),"render controls");
  await c.eval(`(()=>{const b=document.querySelector('[data-testid="blender-render"]');b.click();b.click();})()`);
  try{ await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="blender-preview-result"] img')`),"preview completion"); }
  catch(error){ console.error("Render diagnostics:",await c.eval(`JSON.stringify(window.__fixture.calls)+" :: "+JSON.stringify(window.__fixture.error||"")+" :: button="+document.querySelector('[data-testid="blender-render"]').disabled+" :: errors="+[...document.querySelectorAll(".bp-message,.bp-callout")].map(x=>x.textContent).join("|")`)); throw error; }
  assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="job.create").length===1`),true,
    "a double click cannot create duplicate preview jobs while hashing");
  assert.equal(await c.eval(`!!document.querySelector('[data-testid="blender-save-failure"]')`),true,
    "failed durable save retains the completed preview and recovery controls");
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-preview-result"]').textContent.includes("lens 72mm")`),true,
    "completed preview exposes the readback lens from the requested spec");
  await c.eval(`document.querySelector('[data-testid="blender-retry-save"]').click()`);
  try{ await waitFor(()=>c.eval(`window.__fixture.saved.length===1`),"retry save"); }
  catch(error){ console.error("Retry diagnostics:",await c.eval(`JSON.stringify(window.__fixture.saved.map(x=>x[0]))+" :: "+JSON.stringify(window.__fixture.error||"")+" :: "+[...document.querySelectorAll(".bp-message")].map(x=>x.textContent).join("|")`)); throw error; }
  assert.equal(await c.eval(`window.__fixture.saved.every(x=>String(x[0]).startsWith("blender-preview-shot-1"))`),true,
    "durable writes stay in the separate Blender preview slot");
  assert.equal(await c.eval(`window.__fixture.saved[0][2].sourceSpec.camera.focalLength===72`),true,
    "durable metadata retains the edited camera spec");
  await c.eval(`window.__fixture.deferConnection=true`);
  await waitFor(()=>c.eval(`!!window.__fixture.connectionPending`),"deferred connection poll");
  await c.eval(`document.querySelector('[data-testid="blender-disconnect"]').click()`);
  await waitFor(()=>c.eval(`window.__fixture.calls.some(x=>x.body&&x.body.action==="connection.disconnect")`),"poll disconnect");
  await c.eval(`window.__fixture.releaseConnection();window.__fixture.deferConnection=false;window.__fixture.connected=true`);
  await sleep(150);
  assert.equal(await c.eval(`document.querySelector(".bp-status").textContent==="not paired"`),true,
    "disconnect prevents an in-flight connection poll from restoring state");
  await c.eval(`document.querySelector('[data-testid="blender-pair"]').click()`);
  await waitFor(()=>c.eval(`!!document.querySelector('[data-testid="blender-pair-code"]')`),"second pair code");
  await waitFor(()=>c.eval(`!document.querySelector('[data-testid="blender-render"]').disabled`),"second render controls");
  await c.eval(`window.__fixture.deferJob=true;document.querySelector('[data-testid="blender-render"]').click()`);
  await waitFor(()=>c.eval(`!!window.__fixture.jobGetPending`),"deferred job poll");
  await c.eval(`document.querySelector('[data-testid="blender-stop"]').click()`);
  await c.eval(`window.__fixture.deferJob=false;window.__fixture.job={...window.__fixture.job,status:"completed"};window.__fixture.releaseJobGet()`);
  await sleep(150);
  assert.equal(await c.eval(`document.body.textContent.includes("cancelled")`),true,
    "stop prevents an in-flight job poll from restoring the old running job");
  await c.eval(`document.querySelector('[data-testid="blender-clear"]').click()`);
  await waitFor(()=>c.eval(`!document.querySelector('[data-testid="blender-clear"]')`),"clear cancelled job");
  await c.eval(`window.__fixture.deferCommit=true;`);
  await waitFor(()=>c.eval(`!document.querySelector('[data-testid="blender-render"]').disabled`),"second render controls");
  await c.eval(`document.querySelector('[data-testid="blender-render"]').click()`);
  await waitFor(()=>c.eval(`!!window.__fixture.commitPending`),"deferred save");
  await c.eval(`document.querySelector('[data-testid="blender-stop"]').click()`);
  await c.eval(`window.__fixture.job={...window.__fixture.job,id:"forbidden-job",status:"running"};
    window.__fixture.forbiddenJobGet=false;window.__fixture.forbiddenConnection=false`);
  const beforeForbiddenConnection=await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="connection.get").length`);
  await waitFor(()=>c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="connection.get").length>${beforeForbiddenConnection}`),"running recovery poll");
  const beforeForbiddenJob=await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="job.get").length`);
  await c.eval(`window.__fixture.forbiddenJobGet=true`);
  await waitFor(()=>c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="job.get").length>${beforeForbiddenJob}`),"403 job poll");
  const forbiddenJobCalls=await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="job.get").length`);
  await sleep(3200);
  assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="job.get").length===${forbiddenJobCalls}`),true,
    "403 job.get stops the job polling loop");
  const beforeForbiddenConnection2=await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="connection.get").length`);
  await c.eval(`window.__fixture.forbiddenConnection=true`);
  await waitFor(()=>c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="connection.get").length>${beforeForbiddenConnection2}`),"403 connection poll");
  const forbiddenConnectionCalls=await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="connection.get").length`);
  await sleep(3200);
  assert.equal(await c.eval(`window.__fixture.calls.filter(x=>x.body&&x.body.action==="connection.get").length===${forbiddenConnectionCalls}`),true,
    "403 connection.get stops the connection polling loop");
  await c.eval(`window.__fixture.forbiddenJobGet=false;window.__fixture.forbiddenConnection=false;document.querySelector('[data-testid="blender-stop"]').click()`);
  await sleep(100);
  const roomInput=`[...document.querySelectorAll("input")].find(x=>x.value==="12")`;
  await c.eval(`(()=>{const i=${roomInput};const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"20");i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await c.eval(`window.__fixture.scopeProject="film-B"`);
  await c.eval(`window.__fixture.releaseCommit()`);
  await sleep(200);
  assert.equal(await c.eval(`window.__fixture.saved.length===1`),true,
    "stopping and editing during a deferred save prevents the old run from committing");
  assert.equal(await c.eval(`!!document.querySelector('[data-testid="blender-preview-result"] img')`),true,
    "stopping during a deferred save leaves the completed preview renderable");
  assert.equal(await c.eval(`window.__fixture.calls.some(x=>x.body&&x.body.action==="job.create")`),true);
  const packagedZip=await readFile(new URL("../app/downloads/cinema-machine-blender.zip",import.meta.url));
  assert.equal(packagedZip.subarray(0,4).toString("hex"),"504b0304","packaged add-on is a ZIP");
  assert.ok(packagedZip.length>1000,"packaged add-on ZIP is non-empty");
  await c.eval(`(()=>{const frame=document.createElement("iframe");frame.id="blender-addon-download-frame";
    frame.setAttribute("sandbox","allow-downloads allow-scripts allow-same-origin");frame.src="/";
    frame.style.cssText="display:none";frame.onload=()=>{
      const doc=frame.contentDocument;doc.addEventListener("click",event=>{
        let node=event.target;while(node&&node!==doc){if(node.tagName==="A"&&node.hasAttribute("href")){
          frame.contentWindow.__fixture.frameAnchorIntercepts++;event.preventDefault();break;}node=node.parentNode;}
      },true);
    };document.body.appendChild(frame);})()`);
  const downloadFrame="document.querySelector('#blender-addon-download-frame').contentWindow";
  await waitFor(()=>c.eval(`!!${downloadFrame}&&!!${downloadFrame}.document.querySelector('[data-testid="blender-addon-download"]')`),
    "sandboxed add-on download button");
  const frameUrl=await c.eval(`${downloadFrame}.location.href`);
  const downloadPath=`${FIXTURE}/downloads/cinema-machine-blender.zip`;
  await c.eval(`${downloadFrame}.__fixture.addonMode="404";${downloadFrame}.document.querySelector('[data-testid="blender-addon-download"]').click()`);
  await waitFor(()=>c.eval(`(()=>{const status=${downloadFrame}.document.querySelector('[data-testid="blender-addon-download-status"]');return status&&status.getAttribute("role")==="alert"&&status.textContent.includes("HTTP 404");})()`),
    "404 add-on error");
  assert.equal(await exists(downloadPath),false,"404 add-on response does not create a file");
  assert.equal(await c.eval(`${downloadFrame}.location.href===${JSON.stringify(frameUrl)}`),true,
    "404 add-on response does not navigate the sandbox");
  await c.eval(`${downloadFrame}.__fixture.addonMode="html200";${downloadFrame}.document.querySelector('[data-testid="blender-addon-download"]').click()`);
  await waitFor(()=>c.eval(`(()=>{const status=${downloadFrame}.document.querySelector('[data-testid="blender-addon-download-status"]');return status&&status.getAttribute("role")==="alert"&&status.textContent.includes("did not contain the add-on ZIP");})()`),
    "HTML add-on error");
  assert.equal(await exists(downloadPath),false,"HTML add-on response does not create a file");
  assert.equal(await c.eval(`${downloadFrame}.location.href===${JSON.stringify(frameUrl)}`),true,
    "HTML add-on response does not navigate the sandbox");
  const downloadJob=await c.eval(`JSON.stringify(${downloadFrame}.__fixture.job)`);
  await c.eval(`${downloadFrame}.__fixture.calls=[];${downloadFrame}.__fixture.deferConnection=true;${downloadFrame}.__fixture.addonMode="ok";
    ${downloadFrame}.document.querySelector('[data-testid="blender-addon-download"]').click()`);
  await waitFor(()=>c.eval(`${downloadFrame}.document.querySelector('[data-testid="blender-addon-download-status"]').textContent.includes("Download requested")`),
    "successful add-on download status");
  await waitFor(()=>exists(downloadPath),"browser add-on ZIP download");
  const downloadedZip=await readFile(downloadPath);
  assert.deepEqual(downloadedZip,packagedZip,"browser saved bytes match the packaged add-on ZIP");
  assert.equal(await c.eval(`${downloadFrame}.location.href===${JSON.stringify(frameUrl)}`),true,
    "successful add-on download leaves the sandbox URL unchanged");
  assert.equal(await c.eval(`${downloadFrame}.__fixture.frameAnchorIntercepts===0`),true,
    "detached Blob download anchor does not bubble to the document anchor interceptor");
  assert.equal(await c.eval(`${downloadFrame}.__fixture.calls.every(x=>!x.body||! /pair|connection|job|generation/i.test(x.body.action||""))`),true,
    "add-on download performs no relay, pair, job, or generation operation");
  assert.equal(await c.eval(`JSON.stringify(${downloadFrame}.__fixture.job)===${JSON.stringify(downloadJob)}`),true,
    "add-on download leaves Blender job state unchanged");
  await c.eval(`${downloadFrame}.__fixture.addonMode="hang";${downloadFrame}.document.querySelector('[data-testid="blender-addon-download"]').click()`);
  await waitFor(()=>c.eval(`${downloadFrame}.__fixture.addonPending`),"pending add-on fetch");
  await c.eval(`${downloadFrame}.__unmount()`);
  await waitFor(()=>c.eval(`${downloadFrame}.__fixture.addonAbort`),"unmount add-on abort");
  await c.eval(`(()=>{const img=document.querySelector('[data-testid="blender-preview-result"] img');
    if(img&&window.__fixture.visualPng) img.src="data:image/png;base64,"+window.__fixture.visualPng;})()`);
  const screenshot=await c.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
  const screenshotPath=`${OUT}/blender-preview.png`;await writeFile(screenshotPath,Buffer.from(screenshot.data,"base64"));
  await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(100);
  const mobile=await c.eval(`({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth})`);
  assert.ok(mobile.scrollWidth<=391,`Blender panel overflows at 390px: ${JSON.stringify(mobile)}`);
  await c.eval(`window.__fixture.scopeProject="film-fixture";window.__fixture.connected=true;window.__fixture.calls=[];window.__mount(true)`);
  await sleep(3500);
  assert.equal(await c.eval(`document.querySelector('[data-testid="blender-render"]').disabled`),true,
    "view-only Blender preview cannot render");
  assert.equal(await c.eval(`window.__fixture.calls.every(x=>!x.body||x.body.action!=="connection.get")`),true,
    "view-only Blender preview does not poll protected connection state");
  console.log(`Blender UI fixture runtime: ${runtimePath?"production source loaded":"client source not present"}`);
  console.log(`Screenshot: ${screenshotPath}`);
  console.log("PASS Blender per-shot preview browser fixture");
}finally{c?.close();chrome.kill();http.close();}
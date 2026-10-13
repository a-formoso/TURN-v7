#!/usr/bin/env node
/* Focused browser regression for the explicit legacy micro-beat cleanup control.
   The fixture mounts the production ShotList and ArtRoom wiring only: it never
   mounts App, signs in, persists a film, calls a model, or mutates real data. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {transformSync} from "@babel/core";
import net from "node:net";
import crypto from "node:crypto";

const ROOT=new URL("../",import.meta.url);
const FIX="/tmp/fixture/browserfiles-microbeat-cleanup";
const OUT="/tmp/standalone-microbeat-cleanup";
const CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium";

async function transpile(source){
  return transformSync(source,{
    presets:[["@babel/preset-react",{runtime:"classic"}]],
    plugins:["@babel/plugin-transform-block-scoping"],
    babelrc:false,configFile:false
  }).code;
}

async function prep(){
  await mkdir(FIX,{recursive:true}); await mkdir(OUT,{recursive:true});
  await writeFile(`${FIX}/styles.css`,await readFile(new URL("app/styles.css",ROOT)));
  await writeFile(`${FIX}/beat-keyframe-merge.js`,await readFile(new URL("app/beat-keyframe-merge.js",ROOT)));
  await writeFile(`${FIX}/shots-ui.js`,await transpile(await readFile(new URL("app/shots-ui.jsx",ROOT),"utf8")));
  const artroom=await readFile(new URL("app/artroom.jsx",ROOT),"utf8");
  const artStart=artroom.indexOf("function ArtRoom(");
  const artEnd=artroom.indexOf("\nwindow.ArtRoom",artStart);
  if(artStart<0||artEnd<0) throw Error("could not extract ArtRoom from app/artroom.jsx");
  await writeFile(`${FIX}/artroom.js`,await transpile(artroom.slice(artStart,artEnd)));
  for(const [name,url] of Object.entries({
    "react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js",
    "react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"
  })){
    try{ if((await readFile(`${FIX}/${name}`)).length>10000) continue; }catch{}
    const response=await fetch(url);
    if(!response.ok) throw Error(`cache ${name}: ${response.status}`);
    await writeFile(`${FIX}/${name}`,Buffer.from(await response.arrayBuffer()));
  }
  await writeFile(`${FIX}/microbeat-cleanup.html`,html());
}

function html(){
  return `<!doctype html><html><head><meta charset=utf-8><link rel=stylesheet href=/styles.css>
  <style>body{background:#08090b;padding:24px;overflow:auto}.fixture{max-width:1100px;margin:auto}</style></head><body>
  <div id=root></div><div id=art-root></div>
  <script src=/react.js></script><script src=/react-dom.js></script>
  <script>
  window.__fixture={calls:[],errors:[],helperCalls:0,resolve:null,batchActiveId:null};
  window.addEventListener("error",e=>__fixture.errors.push(String(e.message)));
  window.addEventListener("unhandledrejection",e=>__fixture.errors.push(String(e.reason&&e.reason.message||e.reason)));
  const __consoleError=console.error.bind(console);
  console.error=(...args)=>{__fixture.errors.push(args.map(x=>String(x&&x.message||x)).join(" "));__consoleError(...args);};
  window.Icon=new Proxy({}, {get:(_,name)=>({s=12})=>React.createElement("svg",{"data-icon":name,width:s,height:s})});
  window.useBatchGen=()=>({activeId:__fixture.batchActiveId,run:()=>{},advance:()=>{},cancel:()=>{},setMsg:()=>{}});
  window.useScenePager=()=>[0,()=>{},()=>{},()=>{}];
  window.scenesInStoryOrder=scenes=>(scenes||[]).slice();
  window.locationForScene=()=>null; window.propsForScene=()=>[];
  window.scanTextForChars=()=>[]; window.sceneShotsOrdered=shots=>(shots||[]).slice();
  window.NbKeyBar=()=>null; window.NbControls=()=>null; window.BatchBar=()=>null;
  window.ImageLightbox=()=>null; window.NbDock=()=>null;
  window.InfoTip=({text})=>React.createElement("span",{"data-info":text});
  window.RecentlyDeleted=({items})=>items&&items.length
    ? React.createElement("button",{"data-testid":"recently-deleted",title:"Recently deleted shots"},"Trash (",items.length,")")
    : null;
  window.legacyMicroBeatShotCleanup=shots=>{
    __fixture.helperCalls++;
    const removable=(shots||[]).filter(x=>x&&x.id==="legacy-orphan");
    const uncertain=(shots||[]).filter(x=>x&&x.id==="uncertain-orphan");
    return {removable,uncertain};
  };
  </script>
  <script src=/beat-keyframe-merge.js></script>
  <script>
  const shippedLegacyCleanup=window.legacyMicroBeatShotCleanup;
  window.legacyMicroBeatShotCleanup=shots=>{
    __fixture.helperCalls++;
    return shippedLegacyCleanup(shots);
  };
  </script>
  <script src=/shots-ui.js></script>
  <script>
  window.__ProductionShotList=window.ShotList;
  const scene={id:"scene-1",no:1,title:"Empty Current Scene"};
  const legacy={id:"legacy-orphan",sceneId:"orphan-scene",beatN:2,order:1,
    beatPlan:{micro:["MARCUS crosses the room."]},covers:[1],action:"Legacy micro-beat shot."};
  const uncertain={id:"uncertain-orphan",sceneId:"orphan-scene",beatN:3,order:2,
    beatPlan:{micro:["Unclear legacy action."]},covers:[99],action:"Unclear legacy shot."};
  const baseProps={
    project:{id:"fixture-project"},scenes:[scene],characters:[],props:[],locations:[],
    beatsMap:{},onUpdateShot:()=>{},onAddShot:()=>{},onDeleteShot:()=>{},
    onSplitBeat:()=>{},onRefineBeat:()=>{},onDraftSceneShots:()=>{},onDraftAllShots:()=>{},
    onShoot:()=>{},trashItems:[],onRestore:()=>{},onPurge:()=>{},
    onRemoveMicroBeatShots:payload=>{
      __fixture.calls.push(payload);
      return new Promise(resolve=>{__fixture.resolve=resolve;});
    }
  };
  const root=ReactDOM.createRoot(document.getElementById("root"));
  const artRoot=ReactDOM.createRoot(document.getElementById("art-root"));
  function mount(over={}){
    root.render(React.createElement("div",{className:"fixture"},
      React.createElement(window.__ProductionShotList,{...baseProps,shots:[legacy,uncertain],...over})));
  }
  window.__mount=mount;
  window.__mountCurrent=(shots,trash,over={})=>{
    root.render(React.createElement("div",{className:"fixture"},
      React.createElement(window.__ProductionShotList,{...baseProps,shots,trashItems:trash,...over})));
  };
  window.__resolve=()=>{if(__fixture.resolve){const r=__fixture.resolve;__fixture.resolve=null;r();}};
  mount();
  </script>
  <script src=/artroom.js></script>
  <script>
  window.ArtReviewContext={Provider:({children})=>children};
  window.__captureArtProps=null;
  window.ShotList=props=>{__fixture.artProps=props;return React.createElement("div",{"data-testid":"art-shot-list"});};
  window.__mountArt=(readOnly=false)=>{
    artRoot.render(React.createElement(ArtRoom,{artView:"shots",setArtView:()=>{},
      project:{id:"fixture-project"},characters:[],scenes:[],props:[],drafts:{},trash:{shots:[]},
      shots:[],beatsMap:{},readOnly,onRemoveMicroBeatShots:()=>Promise.resolve()}));
  };
  </script>
  </body></html>`;
}

function server(){
  return createServer(async(req,res)=>{
    const path=req.url==="/" ? `${FIX}/microbeat-cleanup.html` : `${FIX}${req.url}`;
    try{res.end(await readFile(path));}catch{res.writeHead(404);res.end();}
  });
}

class NativeWS{
  static async connect(url){
    const u=new URL(url),key=crypto.randomBytes(16).toString("base64");
    const socket=net.connect(+u.port,u.hostname); let head=Buffer.alloc(0);
    await new Promise((resolve,reject)=>{
      socket.once("error",reject);
      socket.once("connect",()=>socket.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n`
        +`Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      socket.on("data",data=>{head=Buffer.concat([head,data]);
        if(head.includes(Buffer.from("\r\n\r\n"))){
          if(!head.toString().startsWith("HTTP/1.1 101")) reject(Error("CDP websocket handshake failed"));
          else resolve();
        }
      });
    });
    const ws=new NativeWS(socket); socket.on("data",data=>ws.read(data)); return ws;
  }
  constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.onmessage=null;}
  send(text){
    const payload=Buffer.from(text),mask=crypto.randomBytes(4);
    const header=payload.length<126
      ? Buffer.from([129,128|payload.length])
      : Buffer.from([129,254,payload.length>>8,payload.length&255]);
    for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4];
    this.socket.write(Buffer.concat([header,mask,payload]));
  }
  read(data){
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length>=2){
      let length=this.buffer[1]&127,offset=2;
      if(length===126){if(this.buffer.length<4)return;length=this.buffer.readUInt16BE(2);offset=4;}
      if(this.buffer.length<offset+length)return;
      const text=this.buffer.subarray(offset,offset+length).toString();
      this.buffer=this.buffer.subarray(offset+length);
      if(this.onmessage)this.onmessage({data:text});
    }
  }
  close(){this.socket.destroy();}
}

class CDP{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();
    ws.onmessage=event=>{const message=JSON.parse(event.data),resolve=this.pending.get(message.id);
      if(!resolve)return;this.pending.delete(message.id);
      if(message.error)resolve(Promise.reject(Error(message.error.message)));else resolve(message.result);};}
  static async connect(url){return new CDP(await NativeWS.connect(url));}
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;
    this.pending.set(id,result=>result instanceof Promise?result.then(resolve,reject):resolve(result));
    this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){
    const result=await this.call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    return result.result&&result.result.value;
  }
  close(){this.ws.close();}
}

async function wait(cdp,expression,label){
  const end=Date.now()+10000;
  while(Date.now()<end){
    if(await cdp.eval(expression))return;
    const errors=await cdp.eval(`window.__fixture&&window.__fixture.errors`);
    if(errors&&errors.length) throw Error(label+": "+errors.join(" | "));
    await new Promise(r=>setTimeout(r,50));
  }
  const diagnostic=await cdp.eval(`({body:document.body&&document.body.innerText,html:document.body&&document.body.innerHTML,
    ready:document.readyState,calls:window.__fixture&&window.__fixture.calls.length,errors:window.__fixture&&window.__fixture.errors})`);
  throw Error("timeout "+label+"; diagnostic="+JSON.stringify(diagnostic).slice(0,1000));
}

async function main(){
  await prep();
  const http=server(); await new Promise(resolve=>http.listen(0,"127.0.0.1",resolve));
  const port=http.address().port,debugPort=9500+Math.floor(Math.random()*300);
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox",`--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${FIX}/cleanup-${process.pid}`, "about:blank"]);   // (Chrome 154+ opens no page without one)
  let cdp;
  try{
    const target=await waitForTarget(debugPort);
    cdp=await CDP.connect(target.webSocketDebuggerUrl); await cdp.call("Page.enable");
    await cdp.call("Page.navigate",{url:`http://127.0.0.1:${port}/`});
    await wait(cdp,`!!document.querySelector('[data-testid="shot-micro-cleanup"]')`,"cleanup control");

    assert.equal(await cdp.eval(`document.querySelector('[data-testid="shot-micro-cleanup"]').textContent.trim()`),
      "Remove micro-beat shots (2)","cleanup control shows removable plus uncertain count");
    assert.equal(await cdp.eval(`document.querySelector('[data-testid="shot-micro-cleanup"]').disabled`),false,
      "cleanup control starts enabled");
    assert.equal(await cdp.eval(`window.__fixture.calls.length`),0,
      "mounting the real ShotList never invokes the App cleanup handler");
    assert.equal(await cdp.eval(`window.__fixture.helperCalls>0`),true,
      "the production ShotList asks the shipped helper for candidates");

    await cdp.eval(`document.querySelector('[data-testid="shot-micro-cleanup"]').click()`);
    await wait(cdp,`window.__fixture.calls.length===1`,"cleanup callback");
    assert.equal(await cdp.eval(`document.querySelector('[data-testid="shot-micro-cleanup"]').disabled`),true,
      "the cleanup control latches disabled while the async App callback is pending");
    await cdp.eval(`document.querySelector('[data-testid="shot-micro-cleanup"]').click()`);
    assert.equal(await cdp.eval(`window.__fixture.calls.length`),1,
      "a second click cannot enter the pending cleanup callback");
    assert.equal(await cdp.eval(`window.__fixture.calls[0].removable[0].id`),"legacy-orphan",
      "the callback receives click-time helper candidates without generating");
    await cdp.eval(`window.__resolve()`);
    await wait(cdp,`!document.querySelector('[data-testid="shot-micro-cleanup"]').disabled`,"cleanup completion");

    await cdp.eval(`window.__mount({readOnly:true})`);
    await wait(cdp,`document.querySelector('[data-testid="shot-micro-cleanup"]').disabled===true`,"read-only gate");
    assert.equal(await cdp.eval(`window.__fixture.calls.length`),1,
      "read-only cleanup click cannot call the handler");
    await cdp.eval(`window.__mount({draftingAllShots:true})`);
    await wait(cdp,`document.querySelector('[data-testid="shot-micro-cleanup"]').disabled===true`,"drafting gate");
    await cdp.eval(`window.__mount({});window.__fixture.batchActiveId="rendering";window.__mount({})`);
    await wait(cdp,`document.querySelector('[data-testid="shot-micro-cleanup"]').disabled===true`,"batch gate");

    await cdp.eval(`window.__fixture.batchActiveId=null;window.__mountCurrent([], [{id:"legacy-orphan",_deletedAt:"now"}])`);
    await wait(cdp,`!document.querySelector('[data-testid="shot-micro-cleanup"]')`,"empty current film");
    assert.equal(await cdp.eval(`!!document.querySelector('[data-testid="recently-deleted"]')`),true,
      "the empty current film keeps the existing Recently Deleted restore affordance");

    await cdp.eval(`window.__mountArt(false)`);
    await wait(cdp,`!!document.querySelector('[data-testid="art-shot-list"]')`,"ArtRoom writable mount");
    assert.equal(await cdp.eval(`typeof window.__fixture.artProps.onRemoveMicroBeatShots`),"function",
      "ArtRoom passes the cleanup handler through to ShotList");
    await cdp.eval(`window.__mountArt(true)`);
    await wait(cdp,`!!document.querySelector('[data-testid="art-shot-list"]')`,"ArtRoom read-only mount");
    assert.equal(await cdp.eval(`window.__fixture.artProps.onRemoveMicroBeatShots`),null,
      "ArtRoom nulls the cleanup handler for read-only access");

    const screenshot=await cdp.call("Page.captureScreenshot",{format:"png"});
    await writeFile(`${OUT}/micro-cleanup.png`,Buffer.from(screenshot.data,"base64"));
    assert.deepEqual(await cdp.eval(`window.__fixture.errors`),[]);
    console.log(`standalone legacy micro-beat cleanup browser regression passed\nscreenshot: ${OUT}/micro-cleanup.png`);
  }finally{cdp?.close();chrome.kill();http.close();}
}

async function waitForTarget(debugPort){
  const end=Date.now()+10000;
  while(Date.now()<end){
    try{
      const list=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page=list.find(x=>x.type==="page"); if(page)return page;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw Error("timeout chrome");
}

main().catch(error=>{console.error(error);process.exitCode=1;});
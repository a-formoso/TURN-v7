#!/usr/bin/env node
/*
 * Browser fixture for the real CharacterOrbitButton/CharacterOrbitModal.
 *
 * This is intentionally an isolated browser page.  CharacterOrbit is a
 * deterministic in-memory fake, and the exporter is a return-value fake; no
 * provider, account, project image, cloud request, or live application root is
 * reachable from this fixture.
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {transformSync} from "@babel/core";

const ROOT=new URL("../",import.meta.url);
const FIXTURE=`/tmp/character-orbit-ui-${process.pid}`;
const CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium";

function transform(source,filename){
  return transformSync(source,{
    presets:[["@babel/preset-react",{runtime:"classic"}]],
    plugins:["@babel/plugin-transform-block-scoping"],
    comments:false,compact:false,babelrc:false,configFile:false,filename
  }).code;
}

function fixtureHtml(){
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/character-orbit.css">
<style>
  :root{--bg-1:#17181b;--bg-2:#22252b;--bg-3:#2d3139;--line:#3a3f49;--line-2:#515967;--line-3:#747d8b;--txt-1:#f4f6f8;--txt-2:#d2d7df;--txt-3:#98a1ae;--accent:#a6bdf3}
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#0b0d10;color:#eee}
  body{overflow-x:hidden;font-family:Arial,sans-serif}.fixture-cards{padding:24px;display:flex;gap:12px;flex-wrap:wrap}
  .fixture-card{padding:12px;border:1px solid #343944;border-radius:10px;background:#15171b}
</style></head><body>
<main id="cards" class="fixture-cards"></main>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
(() => {
  "use strict";
  const clone=value=>{
    if(value===undefined)return value;
    return JSON.parse(JSON.stringify(value));
  };
  const F=window.__fixture={
    createCalls:[],resumeCalls:[],stopCalls:[],confirmCalls:[],paidCalls:0,
    frameCalls:[],exportCalls:[],runs:[],listeners:new Set(),nextTake:1,
    confirmMode:"accept",pendingConfirm:null,pendingResume:new Map(),
    pendingStop:new Map(),deferStop:false,exportSupport:{video:true,
      videoMime:"video/webm;codecs=vp8,opus"},
    dock:{model:"gpt-image-2.5-flare",quality:"medium",res:"2K"},
    character:{id:"character-ada",name:"Ada",role:"watchmaker",
      personality:"quietly observant",description:"A careful maker with a private spark."},
    project:{id:"orbit-fixture-project",name:"Orbit Fixture Film"}
  };
  window.__fixture=F;
  window.__fixtureErrors=[];
  window.addEventListener("error",event=>__fixtureErrors.push(String(event.message||event.error||"error")));
  window.addEventListener("unhandledrejection",event=>__fixtureErrors.push(String(event.reason&&event.reason.message||event.reason||"rejection")));

  /*
   * The page is allowed to fetch only the local fixture and the two explicitly
   * permitted React UMD origins.  The CDP Fetch interception below applies the
   * same policy to script/resource requests.
   */
  const nativeFetch=window.fetch.bind(window);
  window.__fixtureFetches=[];
  window.fetch=(resource,...args)=>{
    const url=String(typeof resource==="string"?resource:resource&&resource.url||resource);
    const allowed=url.startsWith(location.origin+"/")||
      /^https:\\/\\/unpkg\\.com\\/react(?:-dom)?@18\\.3\\.1\\/umd\\/(?:react|react-dom)\\.development\\.js$/.test(url);
    window.__fixtureFetches.push({url,allowed});
    if(!allowed)return Promise.reject(new Error("fixture fetch denied: "+url));
    return nativeFetch(resource,...args);
  };

  window.NB_MODELS=[
    {id:"gpt-image-2.5-flare",label:"GPT Image 2.5 Flare",family:"openai"},
    {id:"gpt-image-2",label:"GPT Image 2",family:"openai"}
  ];
  window.NB_RESOLUTIONS=["1K","2K","4K"];
  window.NB_ASPECTS=["9:16","3:4","1:1","16:9"];
  window.nbGetModel=()=>F.dock.model;
  window.nbGetOaiQuality=()=>F.dock.quality;
  window.nbGetRes=()=>F.dock.res;
  window.nbGetAspect=()=>F.dock.aspect||"9:16";
  window.nbRefreshImageQualityCapabilities=async()=>({});
  window.isGptImageModel=model=>/^gpt-image/.test(String(model||""));
  window.nbOaiQualityChoices=()=>["default","auto","low","medium","high","xhigh","max"];
  window.nbOaiQualityLabel=q=>({default:"Default (High)",auto:"Auto",low:"Low",medium:"Medium",
    high:"High",xhigh:"Extra high (xhigh)",max:"Max"})[q]||q;
  window.nbCanUseImageQuality=()=>true;
  window.nbImageQualitySupport=()=>({video:true,loading:false,expanded:true,qualities:window.nbOaiQualityChoices()});

  const listeners=F.listeners;
  const angle=index=>Number((Number(index)*1.25).toFixed(6));
  const frameFor=(run,index)=>({
    index:Number(index),id:"orbit-frame-"+run.id+"-"+Number(index),angle:angle(index)
  });
  const svgFor=(run,index)=>"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400">'+
    '<rect width="320" height="400" fill="#26333d"/><circle cx="160" cy="180" r="90" fill="#a6bdf3"/>'+
    '<text x="20" y="370" fill="white" font-size="18">'+String(run.id)+" · "+String(index)+"</text></svg>"
  );
  const emit=(run,type="status")=>{
    /*
     * This is the UI subscription shape: a status event carries the updated
     * public run under event.run.  The event also retains manifest for callers
     * that consume the durable core's event metadata.
     */
    const publicRun=clone(run);
    const event={type,run:publicRun,manifest:clone(run),runId:run.id,status:run.status,
      completed:run.completed,completedFrames:run.completed,total:288};
    listeners.forEach(listener=>{try{listener(event);}catch(error){window.__fixtureErrors.push(String(error));}});
  };
  const makeRun=(options)=>{
    const id="take-"+F.nextTake++;
    const run={
      id,characterId:options.character.id,characterName:options.character.name,
      createdAt:"2026-01-01T00:00:"+String(F.nextTake).padStart(2,"0")+".000Z",
      pose:String(options.pose),settings:clone(options.settings),completed:1,
      status:"awaiting-confirmation",frames:[],error:null
    };
    run.frames=[frameFor(run,0)];
    return run;
  };
  const findRun=id=>F.runs.find(item=>item.id===String(id));
  const addFrame=(run,index)=>{
    if(!run.frames.some(item=>Number(item.index)===Number(index)))run.frames.push(frameFor(run,index));
    run.frames.sort((a,b)=>a.index-b.index);run.completed=run.frames.length;
  };

  window.CharacterOrbit={
    angle,
    suggestPose:character=>({
      direction:"A repeatable three-quarter stance with one hand resting on the brass watch case.",
      canon:"A repeatable three-quarter stance for "+(character.name||"character"),
      gesture:"one hand resting on a meaningful brass watch case",
      text:"A repeatable three-quarter stance with one hand resting on the brass watch case.",
      editable:true,source:"fixture-canon"
    }),
    quote:(settings,count)=>({count:Number(count),frameCount:Number(count),
      model:settings.model,quality:settings.quality,res:settings.res,aspect:settings.aspect,
      perFrameCredits:3,credits:Number(count)*3,estimate:true}),
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    list:async characterId=>F.runs.filter(run=>!characterId||run.characterId===characterId)
      .slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(clone),
    frame:async(run,index)=>{
      F.frameCalls.push({id:run&&run.id,index:Number(index)});
      return svgFor(run||{id:"frame"},index);
    },
    create:async options=>{
      F.paidCalls+=1;
      const record={character:clone(options.character),project:clone(options.project),
        pose:String(options.pose),settings:clone(options.settings)};
      F.createCalls.push(record);
      const run=makeRun(options);F.runs.push(run);emit(run,"review");
      await new Promise(resolve=>setTimeout(resolve,35));
      return clone(run);
    },
    resume:async(id,options={})=>{
      const run=findRun(id);if(!run)throw new Error("fixture run not found");
      F.paidCalls+=287;
      F.resumeCalls.push({id:run.id,settings:clone(run.settings),
        acknowledgeUncertain:!!options.acknowledgeUncertain,canWriteType:typeof options.canWrite});
      run.status="running";
      /* One status event arrives while the remaining request is active. */
      addFrame(run,1);emit(run,"status");
      const result=new Promise(resolve=>F.pendingResume.set(run.id,{resolve}));
      return result;
    },
    stop:async id=>{
      const run=findRun(id);if(!run)return null;
      F.stopCalls.push(String(id));
      const active=F.pendingResume.get(run.id);
      if(!active){run.status="stopped";emit(run,"stopped");return clone(run);}
      run.status="stopping";emit(run,"status");
      const settle=()=>{
        if(!F.pendingResume.has(run.id))return;
        run.status="stopped";emit(run,"stopped");
        F.pendingResume.delete(run.id);active.resolve(clone(run));
        F.pendingStop.delete(run.id);
      };
      if(F.deferStop)F.pendingStop.set(run.id,settle);else setTimeout(settle,65);
      return new Promise(resolve=>{
        const check=()=>F.pendingResume.has(run.id)?setTimeout(check,10):resolve(clone(run));
        check();
      });
    }
  };
  window.__fixture.completeRun=id=>{
    const run=findRun(id);if(!run)return;
    for(let index=0;index<288;index++)addFrame(run,index);
    run.status="complete";run.error=null;emit(run,"complete");
  };
  window.__fixture.settleStop=id=>{const fn=F.pendingStop.get(String(id));if(fn)fn();};
  window.__fixture.resolveConfirm=answer=>{
    const resolve=F.pendingConfirm;F.pendingConfirm=null;if(resolve)resolve(answer);
  };

  window.appConfirm=options=>{
    F.confirmCalls.push({title:String(options&&options.title||""),body:String(options&&options.body||""),
      confirmLabel:String(options&&options.confirmLabel||""),cancelLabel:String(options&&options.cancelLabel||"")});
    if(F.confirmMode==="defer")return new Promise(resolve=>{F.pendingConfirm=resolve;});
    return Promise.resolve(F.confirmMode!=="reject");
  };

  window.CharacterOrbitExport={
    support:()=>({...F.exportSupport}),
    export:async(run,options)=>{
      F.exportCalls.push({kind:options.kind,runId:run&&run.id,
        hasLoadFrame:typeof options.loadFrame==="function",
        hasCancel:typeof options.shouldCancel==="function",
        hasProgress:typeof options.onProgress==="function"});
      if(typeof options.onProgress==="function")options.onProgress({phase:"fixture",done:0,total:1});
      if(typeof options.loadFrame==="function")await options.loadFrame(0);
      if(typeof options.onProgress==="function")options.onProgress({phase:"fixture",done:1,total:1});
      const video=options.kind==="video";
      return {
        blob:new Blob(["fixture "+options.kind],{type:video?"video/webm":"application/zip"}),
        filename:options.kind==="frames"?"ada-orbit-frames.zip":
          options.kind==="video"?"ada-orbit.webm":"ada-orbit-bundle.zip",
        mime:video?"video/webm":"application/zip"
      };
    },
    download:result=>{
      if(!result||!result.blob)throw new Error("fixture exporter download needs a blob");
      return URL.createObjectURL(result.blob);
    }
  };
  window.ReactDOM.createPortal=value=>value;
  window.Icon=new Proxy({}, {get:()=>()=>null});

  const cards=ReactDOM.createRoot(document.querySelector("#cards"));
  const character=F.character,project=F.project;
  window.__fixtureMount=()=>cards.render(React.createElement("div",null,
    React.createElement("div",{className:"fixture-card","data-card":"normal"},
      React.createElement(CharacterOrbitButton,{character,project,readOnly:false})),
    React.createElement("div",{className:"fixture-card","data-card":"readonly"},
      React.createElement(CharacterOrbitButton,{character:{...character,id:"character-beta",name:"Beta"},
        project,readOnly:true}))
  ));
})();
</script>
<script src="/character-orbit-ui.js"></script>
<script>window.__fixtureMount();window.__fixture.mounted=true;</script>
</body></html>`;
}

async function prepare(){
  await mkdir(FIXTURE,{recursive:true});
  const ui=await readFile(new URL("../app/character-orbit-ui.jsx",import.meta.url),"utf8");
  const css=await readFile(new URL("../app/character-orbit.css",import.meta.url),"utf8");
  const core=await readFile(new URL("../app/character-orbit.js",import.meta.url));
  const exporter=await readFile(new URL("../app/character-orbit-export.js",import.meta.url));
  await writeFile(`${FIXTURE}/character-orbit-ui.js`,transform(ui,"character-orbit-ui.jsx"));
  await writeFile(`${FIXTURE}/character-orbit.css`,css);
  await writeFile(`${FIXTURE}/character-orbit.js`,core);
  await writeFile(`${FIXTURE}/character-orbit-export.js`,exporter);
  for(const [name,url] of Object.entries({
    "react.js":"https://unpkg.com/react@18.3.1/umd/react.development.js",
    "react-dom.js":"https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"
  })){
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Could not fetch permitted React fixture runtime: ${response.status}`);
    await writeFile(`${FIXTURE}/${name}`,Buffer.from(await response.arrayBuffer()));
  }
  await writeFile(`${FIXTURE}/index.html`,fixtureHtml());
}

function server(){
  return createServer(async(request,response)=>{
    const pathname=new URL(request.url,"http://fixture").pathname;
    const name=pathname.replace(/^\/+/,"")||"index.html";
    if(!/^[a-z0-9._-]+$/i.test(name)){
      response.writeHead(404).end();return;
    }
    try{
      const body=await readFile(`${FIXTURE}/${name}`);
      const type=name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":"text/javascript";
      response.writeHead(200,{"content-type":`${type}; charset=utf-8`}).end(body);
    }catch{response.writeHead(404).end("missing fixture");}
  });
}

class CDP{
  constructor(ws){
    this.ws=ws;this.seq=0;this.pending=new Map;this.listeners=new Map;
    ws.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.id&&this.pending.has(message.id)){
        const [resolve,reject]=this.pending.get(message.id);this.pending.delete(message.id);
        message.error?reject(new Error(message.error.message)):resolve(message.result);
        return;
      }
      const callbacks=this.listeners.get(message.method)||[];
      callbacks.forEach(callback=>callback(message.params));
    };
  }
  static async connect(url){
    if(typeof WebSocket!=="function")throw new Error("Node WebSocket is unavailable.");
    const ws=new WebSocket(url);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    return new CDP(ws);
  }
  on(method,callback){
    const callbacks=this.listeners.get(method)||[];callbacks.push(callback);this.listeners.set(method,callbacks);
  }
  call(method,params={}){
    const id=++this.seq;this.ws.send(JSON.stringify({id,method,params}));
    return new Promise((resolve,reject)=>this.pending.set(id,[resolve,reject]));
  }
  async eval(expression){
    const result=await this.call("Runtime.evaluate",{
      expression,awaitPromise:true,returnByValue:true,userGesture:true
    });
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result?.value;
  }
  close(){try{this.ws.close();}catch{}}
}

const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function waitFor(fn,label,timeout=10000){
  const end=Date.now()+timeout;let lastError;
  while(Date.now()<end){
    try{const value=await fn();if(value)return value;}catch(error){lastError=error;}
    await sleep(40);
  }
  throw new Error(`Timed out waiting for ${label}${lastError?`: ${lastError.message}`:""}`);
}

async function main(){
  try{await readFile(CHROME);}catch{
    console.log("SKIP — Chromium is not available for CharacterOrbit UI browser tests.");
    return;
  }
  if(typeof WebSocket!=="function"){
    console.log("SKIP — this Node runtime has no WebSocket for the CharacterOrbit UI browser test.");
    return;
  }
  await prepare();
  const http=server();await new Promise(resolve=>http.listen(0,"127.0.0.1",resolve));
  const port=http.address().port;
  const debugPort=9500+Math.floor(Math.random()*300);
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox","--disable-gpu",
    `--remote-debugging-port=${debugPort}`,`--user-data-dir=${FIXTURE}/profile`,"about:blank"],{stdio:"ignore"});
  let cdp;
  try{
    const target=await waitFor(async()=>{
      try{
        const response=await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if(!response.ok)return null;
        return (await response.json()).find(item=>item.type==="page"&&item.webSocketDebuggerUrl);
      }catch{return null;}
    },"Chromium target",15000);
    cdp=await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.call("Page.enable");await cdp.call("Runtime.enable");
    const fixtureOrigin=`http://127.0.0.1:${port}/`;
    /*
     * Network interception is deliberate: a regression that accidentally
     * reaches an app API or image host fails closed rather than becoming a
     * paid/live-data test.  Only this fixture server and the permitted React
     * UMD origins may continue.
     */
    cdp.on("Fetch.requestPaused",event=>{
      const url=String(event.request?.url||"");
      const allowed=url.startsWith(fixtureOrigin)||
        /^https:\/\/unpkg\.com\/react(?:-dom)?@18\.3\.1\/umd\/(?:react|react-dom)\.development\.js$/.test(url);
      cdp.call(allowed?"Fetch.continueRequest":"Fetch.failRequest",allowed
        ?{requestId:event.requestId}:{requestId:event.requestId,errorReason:"BlockedByClient"}).catch(()=>{});
    });
    await cdp.call("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
    await cdp.call("Page.navigate",{url:`http://127.0.0.1:${port}/`});
    await waitFor(()=>cdp.eval("window.__fixture&&window.__fixture.mounted&&document.querySelectorAll('.char-orbit-btn').length===2"),"character card buttons");

    const evalClickText=async(text,selector=".orbit-modal button")=>cdp.eval(`(()=>{
      const buttons=[...document.querySelectorAll(${JSON.stringify(selector)})];
      const target=buttons.find(button=>button.textContent.trim()===${JSON.stringify(text)});
      if(!target)throw new Error("button not found: "+${JSON.stringify(text)}+
        " (available: "+buttons.map(button=>button.textContent.trim()).join(" | ")+")");
      target.click();return true;
    })()`);
    const modal=()=>cdp.eval("!!document.querySelector('.orbit-modal')");
    const fixture=()=>cdp.eval("window.__fixture");
    const clickNormal=()=>cdp.eval(`document.querySelector('[data-card="normal"] .char-orbit-btn').click()`);
    const closeModal=()=>cdp.eval("document.querySelector('.orbit-close')?.click()");

    /* Open is presentation-only: listing and painting a frame are not paid. */
    await clickNormal();
    await waitFor(()=>modal(),"orbit modal opens from the character card");
    await waitFor(()=>cdp.eval("(()=>{const status=document.querySelector('.orbit-modal [role=\"status\"]');return !status||!status.textContent.includes('Loading saved');})()"),"saved orbit list");
    assert.equal(await cdp.eval("document.querySelector('.orbit-modal textarea').disabled"),false,
      "pose direction is editable for a new orbit");
    assert.match(await cdp.eval("document.querySelector('.orbit-modal textarea').value"),/three-quarter stance/,
      "the suggested pose is visible");
    assert.deepEqual(await cdp.eval("({create:__fixture.createCalls.length,resume:__fixture.resumeCalls.length,paid:__fixture.paidCalls,confirm:__fixture.confirmCalls.length})"),{create:0,resume:0,paid:0,confirm:0},
      "opening the orbit does not generate or spend");

    /* Set a distinct pose and all four immutable render settings. */
    await cdp.eval(`(()=>{
      const set=(prefix,value)=>{
        const label=[...document.querySelectorAll(".orbit-settings label")]
          .find(item=>item.textContent.trim().startsWith(prefix));
        const select=label&&label.querySelector("select");if(!select)throw new Error("missing setting "+prefix);
        select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));
      };
      set("Image model","gpt-image-2.5-flare");set("Resolution","4K");
      set("Frame shape","3:4");set("Quality","high");
      const textarea=document.querySelector('.orbit-modal textarea');
      const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;
      setter.call(textarea,"Unique Ada orbit pose: fingertips rest on the brass watch case.");
      textarea.dispatchEvent(new Event("input",{bubbles:true}));
      textarea.dispatchEvent(new Event("change",{bubbles:true}));
    })()`);
    await waitFor(()=>cdp.eval(`document.querySelector('.orbit-modal textarea').value.includes("Unique Ada orbit pose")`),"unique editable pose");

    /* A rejected confirmation cannot cross the fake paid boundary. */
    await cdp.eval("__fixture.confirmMode='reject'");
    await evalClickText("Draw pose preview · 1 frame");
    await waitFor(()=>cdp.eval("__fixture.confirmCalls.length===1&&!document.querySelector('.orbit-modal .orbit-primary')?.disabled"),"rejected confirmation settles");
    assert.equal(await cdp.eval("__fixture.createCalls.length"),0,"rejecting preview does not create a run");
    assert.equal(await cdp.eval("__fixture.paidCalls"),0,"rejecting preview spends nothing");

    /*
     * Confirmation is deliberately asynchronous.  Mutating the external dock
     * and the source character while it is pending must not alter the frozen
     * create snapshot.
     */
    await cdp.eval("__fixture.confirmMode='defer'");
    await evalClickText("Draw pose preview · 1 frame");
    await waitFor(()=>cdp.eval("!!__fixture.pendingConfirm&&__fixture.confirmCalls.length===2"),"deferred preview confirmation");
    await cdp.eval(`(()=>{
      __fixture.dock.model="gpt-image-2";__fixture.dock.quality="low";__fixture.dock.res="1K";
      __fixture.character.role="mutated after confirmation opened";
      __fixture.resolveConfirm(true);
    })()`);
    await waitFor(()=>cdp.eval("__fixture.createCalls.length===1&&document.querySelector('.orbit-progress')?.textContent.includes('1 / 288')"),"one-frame pose preview");
    await waitFor(()=>cdp.eval("!![...document.querySelectorAll('.orbit-modal button')].find(button=>button.textContent.trim()==='Approve pose & draw 287 frames')"),"preview generation settles");
    const first=await cdp.eval("__fixture.createCalls[0]");
    assert.equal(first.pose,"Unique Ada orbit pose: fingertips rest on the brass watch case.");
    assert.deepEqual(first.settings,{model:"gpt-image-2.5-flare",quality:"high",res:"4K",aspect:"3:4"},
      "model, quality, resolution, and aspect are captured before confirmation");
    assert.equal(first.character.role,"watchmaker","character canon is captured before confirmation");
    assert.equal(await cdp.eval("__fixture.runs[0].frames.length"),1,"first preview creates only frame 0");
    assert.match((await cdp.eval("__fixture.confirmCalls[1].title")),/first pose frame/);

    /* The real UI receives an in-flight status event before resume settles. */
    await cdp.eval("__fixture.confirmMode='accept'");
    await evalClickText("Approve pose & draw 287 frames");
    await waitFor(()=>cdp.eval("__fixture.resumeCalls.length===1&&document.querySelector('.orbit-primary')?.textContent.includes('Stop after current frame')"),"remaining-frame confirmation");
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-progress')?.textContent.includes('2 / 288')"),"status event progress");
    assert.match(await cdp.eval("__fixture.confirmCalls[2].title"),/287/,"resume confirmation names 287 remaining frames");
    assert.deepEqual(await cdp.eval("__fixture.resumeCalls[0]"),{
      id:"take-1",settings:{model:"gpt-image-2.5-flare",quality:"high",res:"4K",aspect:"3:4"},
      acknowledgeUncertain:true,canWriteType:"function"
    },"resume uses the immutable first-frame settings");
    await evalClickText("Stop after current frame");
    await waitFor(()=>cdp.eval("!document.querySelector('.orbit-modal .orbit-primary')?.textContent.includes('Stop after current frame')"),"progress Stop settles");
    assert.equal(await cdp.eval("__fixture.stopCalls.length"),1,"Stop requests the active run");

    /*
     * Close is not an immediate unmount.  The fake keeps stop pending so the
     * fixture can prove that the modal remains until the resume promise settles.
     */
    await cdp.eval("__fixture.deferStop=true");
    await evalClickText("Resume · 286 frames");
    await waitFor(()=>cdp.eval("__fixture.resumeCalls.length===2&&document.querySelector('.orbit-primary')?.textContent.includes('Stop after current frame')"),"second active resume");
    const takeOne="take-1";
    await closeModal();
    await waitFor(()=>cdp.eval("!!document.querySelector('.orbit-modal')&&document.body.textContent.includes('Stopping safely before closing')"),"close waits for stop");
    assert.equal(await cdp.eval("__fixture.stopCalls.length"),2,"Close requests stop before unmounting");
    await cdp.eval("__fixture.settleStop('take-1')");
    await waitFor(()=>cdp.eval("!document.querySelector('.orbit-modal')"),"close after active run settles");

    /*
     * New take is nondestructive.  It leaves take 1 in the select while take 2
     * is created, and switching back does not rewrite either take.
     */
    await clickNormal();await waitFor(()=>modal(),"reopen after safe close");
    await waitFor(()=>cdp.eval("(()=>{const status=document.querySelector('.orbit-modal [role=\"status\"]');return !status||!status.textContent.includes('Loading saved');})()"),"saved takes reopen");
    await waitFor(()=>cdp.eval("!!document.querySelector('.orbit-takes select')"),"saved take selector");
    await evalClickText("New take");
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-primary')?.textContent.includes('Draw pose preview')"),"new orbit surface");
    await evalClickText("Draw pose preview · 1 frame");
    await waitFor(()=>cdp.eval("__fixture.runs.length===2&&document.querySelector('.orbit-progress')?.textContent.includes('1 / 288')"),"second saved take");
    assert.equal(await cdp.eval("document.querySelectorAll('.orbit-takes option').length"),3,
      "creating a new take keeps the previous take alongside the New orbit option");
    const takeTwo=await cdp.eval("__fixture.runs[1].id");
    await cdp.eval(`(()=>{
      const select=document.querySelector('.orbit-takes select');select.value=${JSON.stringify(takeOne)};
      select.dispatchEvent(new Event("change",{bubbles:true}));
    })()`);
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-settings-summary')?.textContent.includes('4K')"),"switch back to original take");
    assert.equal(await cdp.eval("document.querySelector('.orbit-modal textarea').disabled"),true,
      "a saved take's pose is immutable");
    assert.match(await cdp.eval("document.querySelector('.orbit-settings-summary').textContent"),/4K.*3:4.*high/,
      "switching takes preserves the original settings");
    assert.equal(await cdp.eval("__fixture.runs.length"),2,"switching takes does not delete another take");

    /* A read-only character may inspect its modal but can never start work. */
    await closeModal();await cdp.eval(`document.querySelector('[data-card="readonly"] .char-orbit-btn').click()`);
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-modal h2')?.textContent.includes('Beta')"),"read-only orbit modal");
    assert.equal(await cdp.eval("document.querySelector('.orbit-primary').disabled"),true,
      "read-only mode blocks generation");
    const beforeReadOnly=await cdp.eval("({create:__fixture.createCalls.length,resume:__fixture.resumeCalls.length,paid:__fixture.paidCalls})");
    await cdp.eval("document.querySelector('.orbit-primary').click()");
    await sleep(100);
    assert.deepEqual(await cdp.eval("({create:__fixture.createCalls.length,resume:__fixture.resumeCalls.length,paid:__fixture.paidCalls})"),beforeReadOnly,
      "read-only click makes no generation call");
    await closeModal();

    /*
     * Complete take 2 through a status event, then exercise every exporter
     * kind.  Results deliberately have real Blob values and are displayed as
     * ordinary object-URL download links by the production UI.
     */
    await clickNormal();await waitFor(()=>modal(),"open complete run");
    await waitFor(()=>cdp.eval("!!document.querySelector('.orbit-takes select')"),"take selector for export");
    await cdp.eval(`__fixture.completeRun(${JSON.stringify(takeTwo)})`);
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-progress')?.textContent.includes('288 / 288')"),"complete status event");
    await cdp.eval("__fixture.exportCalls=[]");
    for(const [label,filename] of [["Images ZIP","ada-orbit-frames.zip"],["Video","ada-orbit.webm"],["Images + video","ada-orbit-bundle.zip"]]){
      await evalClickText(label);
      await waitFor(()=>cdp.eval("!!document.querySelector('.orbit-download a')"),`${label} download link`);
      const link=await cdp.eval("(()=>{const a=document.querySelector('.orbit-download a');return {href:a.href,download:a.download,text:a.textContent}})()");
      assert.match(link.href,/^blob:/,`${label} uses an actual object URL`);
      assert.equal(link.download,filename,`${label} preserves exporter filename`);
    }
    assert.deepEqual(await cdp.eval("__fixture.exportCalls.map(item=>item.kind)"),["frames","video","bundle"],
      "ZIP, video, and bundle actions call the exporter with their exact kinds");
    assert.equal(await cdp.eval("__fixture.exportCalls.every(item=>item.hasLoadFrame&&item.hasCancel&&item.hasProgress)"),true,
      "export actions pass frame loading, cancellation, and progress callbacks");

    /* Unsupported video support disables only video-dependent actions. */
    await closeModal();
    await cdp.eval("__fixture.exportSupport={video:false,videoMime:'',error:'Video export is unavailable in this fixture browser.'}");
    await clickNormal();await waitFor(()=>modal(),"open unsupported-video export surface");
    await waitFor(()=>cdp.eval("!!document.querySelector('.orbit-takes select')"),"unsupported-video take selector");
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-progress')?.textContent.includes('288 / 288')"),"unsupported-video complete take");
    assert.equal(await cdp.eval(`[...document.querySelectorAll('.orbit-export button')].find(button=>button.textContent.trim()==='Video')?.disabled`),true,
      "video action is disabled when exporter support is false");
    assert.equal(await cdp.eval(`[...document.querySelectorAll('.orbit-export button')].find(button=>button.textContent.trim()==='Images + video')?.disabled`),true,
      "bundle action is disabled when exporter support is false");
    assert.equal(await cdp.eval(`[...document.querySelectorAll('.orbit-export button')].find(button=>button.textContent.trim()==='Images ZIP')?.disabled`),false,
      "image ZIP remains available when video is unsupported");
    assert.match(await cdp.eval("document.querySelector('.orbit-export').textContent"),/Video export is unavailable/,
      "unsupported-video fallback explains the available image export");

    /*
     * Real-runtime phase.  Replace only the fake CharacterOrbit and exporter
     * globals; the same production React tree stays mounted.  The adapters
     * below are deliberately the narrow paid/storage boundary: nbGenerate
     * invokes the core's beforeSubmit guard, nbCommit stores generated assets,
     * and localStorage remains the core's real manifest store.
     */
    await closeModal();
    await waitFor(()=>cdp.eval("!document.querySelector('.orbit-modal')"),"close fake runtime modal");
    await cdp.eval(`(()=>{
      localStorage.clear();
      __turnCurrentProjectId="fixturefilm";
      // Match App's actual story metadata; the saved film id is separate.
      delete __fixture.project.id;
      __fixture.character.role="watchmaker";
      __fixture.dock.model="gpt-image-2.5-flare";
      __fixture.dock.quality="high";
      __fixture.dock.res="2K";
      __fixture.confirmCalls=[];
      __fixture.confirmMode="reject";
      __fixture.real={
        originalId:"character-ada",
        originalMaster:"data:image/svg+xml;base64,"+btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="#18252d"/><circle cx="160" cy="170" r="86" fill="#d9b779"/></svg>'
        ),
        assets:new Map(),commits:[],generateCalls:[],beforeSubmitCalls:[],sourceSaveFailures:1
      };
      __fixture.real.assets.set(__fixture.real.originalId,__fixture.real.originalMaster);
      nbBackend=()=> "local";
      nbCloudScope=()=>null;
      nbEpoch=()=>0;
      nbImageCredits=()=>1;
      nbRequireImageQuality=async()=>{};
      nbReleaseImageCache=()=>{};
      nbLoadImage=async id=>__fixture.real.assets.get(String(id))||"";
      nbGetImage=id=>__fixture.real.assets.get(String(id))||"";
      nbCommit=async(id,value,meta,refs,kind,epoch,beforeCommit)=>{
        if(meta?.kind==="character-orbit-source-snapshot"&&__fixture.real.sourceSaveFailures>0){
          __fixture.real.sourceSaveFailures--;
          return {tier:"error",error:"Storage reservation denied in fixture"};
        }
        __fixture.real.commits.push({id:String(id),kind:String(kind||""),meta:meta||{},value});
        __fixture.real.assets.set(String(id),value);
        return {tier:"saved",id:String(id)};
      };
      nbGenerate=async(prompt,opts)=>{
        if(!opts||typeof opts.beforeSubmit!=="function")throw new Error("real fixture nbGenerate did not receive beforeSubmit");
        await opts.beforeSubmit();
        const index=Number(opts.orbitFrameIndex);
        __fixture.real.beforeSubmitCalls.push(index);
        __fixture.real.generateCalls.push({index,angle:Number(opts.orbitAngle),
          extraImages:Array.isArray(opts.extraImages)?opts.extraImages.length:0,
          runId:String(opts.orbitRunId||"")});
        return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="hsl('+
          ((index*19)%360)+',38%,28%)"/><circle cx="160" cy="170" r="86" fill="#d9b779"/><text x="16" y="370" fill="white">'+
          index+"</text></svg>"
        );
      };
    })()`);
    await cdp.eval(`(async()=>{
      for(const src of ["/character-orbit-export.js","/character-orbit.js"]){
        await new Promise((resolve,reject)=>{
          const script=document.createElement("script");script.src=src;
          script.onload=resolve;script.onerror=()=>reject(new Error("could not load "+src));
          document.head.appendChild(script);
        });
      }
      return typeof window.CharacterOrbit==="object";
    })()`);
    assert.equal(await cdp.eval("typeof window.CharacterOrbit.create"),"function",
      "real CharacterOrbit runtime replaces only the fake API");
    assert.equal(await cdp.eval("typeof window.nbGenerate"),"function",
      "real runtime fixture exposes only the paid adapter boundary");

    await clickNormal();
    await waitFor(()=>modal(),"real-runtime modal opens");
    await waitFor(()=>cdp.eval("(()=>{const status=document.querySelector('.orbit-modal [role=\"status\"]');return !status||!status.textContent.includes('Loading saved');})()"),"real-runtime empty list");
    await evalClickText("Draw pose preview · 1 frame");
    await waitFor(()=>cdp.eval("__fixture.confirmCalls.length===1&&!![...document.querySelectorAll('.orbit-modal button')].find(button=>button.textContent.trim()==='Draw pose preview · 1 frame')"),"real-runtime rejected preview");
    assert.equal(await cdp.eval("__fixture.real.generateCalls.length"),0,
      "a false real-runtime confirmation invokes zero nbGenerate calls");
    assert.equal(await cdp.eval("__fixture.real.commits.length"),0,
      "a false real-runtime confirmation writes no storage");

    await cdp.eval("__fixture.confirmMode='accept'");
    await evalClickText("Draw pose preview · 1 frame");
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-error')?.textContent.includes('Storage reservation denied')"),"source storage error is visible");
    assert.equal(await cdp.eval("__fixture.real.generateCalls.length"),0,"source-save failure makes no paid request");
    assert.equal(await cdp.eval("!![...document.querySelectorAll('.orbit-modal button')].find(button=>button.textContent.trim()==='Retry pose preview · 1 frame')"),true,
      "a failed source retries only the unseen first frame, not a 288-frame batch");
    assert.match(await cdp.eval("document.querySelector('.orbit-cost').textContent"),/Pose preview · 1 frame/);
    const failedRunId=await cdp.eval("CharacterOrbit.list('character-ada').then(rows=>rows[0].id)");
    await closeModal();
    await clickNormal();
    await waitFor(()=>cdp.eval("document.querySelector('.orbit-error')?.textContent.includes('Storage reservation denied')"),"source failure survives reopening");
    await evalClickText("Retry pose preview · 1 frame");
    await waitFor(()=>cdp.eval("__fixture.real.generateCalls.length===1&&document.querySelector('.orbit-progress')?.textContent.includes('1 / 288')"),"real-runtime frame-0 preview");
    await waitFor(()=>cdp.eval("!![...document.querySelectorAll('.orbit-modal button')].find(button=>button.textContent.trim()==='Approve pose & draw 287 frames')"),"real-runtime first approval settles");
    assert.equal(await cdp.eval("__fixture.real.generateCalls[0].index"),0,
      "real runtime's first paid call is frame 0 only");
    assert.equal(await cdp.eval("__fixture.real.commits.filter(item=>item.meta.kind==='character-orbit-source-snapshot').length"),1,
      "real runtime commits one immutable master snapshot");
    assert.equal(await cdp.eval("CharacterOrbit.list('character-ada').then(rows=>rows[0].id)"),failedRunId,
      "retry recovers the same take rather than making a replacement");
    assert.equal(await cdp.eval("__fixture.confirmCalls.at(-1).title"),"Draw the first pose frame?",
      "retry confirmation buys only the first preview");

    await evalClickText("Approve pose & draw 287 frames");
    try {
      await waitFor(()=>cdp.eval("__fixture.real.generateCalls.length===288&&document.querySelector('.orbit-progress')?.textContent.includes('288 / 288')"),"real-runtime remaining 287 frames");
    } catch (error) {
      console.error("REAL RUNTIME UI BUG",await cdp.eval(`(()=>({
        generates:__fixture.real.generateCalls.length,last:__fixture.real.generateCalls.at(-1),
        commits:__fixture.real.commits.length,errors:__fixtureErrors.slice(),
        modalErrors:[...document.querySelectorAll('.orbit-error')].map(item=>item.textContent),
        progress:document.querySelector('.orbit-progress')?.textContent||""
      }))()`));
      throw error;
    }
    const realSummary=await cdp.eval(`(async()=>{
      const rows=await window.CharacterOrbit.list("character-ada"),run=rows[0]||{};
      return {
        confirmations:__fixture.confirmCalls.map(item=>item.title),
        generateCount:__fixture.real.generateCalls.length,
        beforeSubmitCount:__fixture.real.beforeSubmitCalls.length,
        firstIndex:__fixture.real.generateCalls[0]?.index,
        lastIndex:__fixture.real.generateCalls.at(-1)?.index,
        lastAngle:run.frames?.at(-1)?.angle,
        savedFrames:run.frames?.length,
        completed:run.completed,
        projectId:run.projectId,
        frameCommits:__fixture.real.commits.filter(item=>item.meta.kind==="character-orbit-frame").length,
        masterUnchanged:__fixture.real.assets.get(__fixture.real.originalId)===__fixture.real.originalMaster,
        exportImagesDisabled:[...document.querySelectorAll(".orbit-export button")]
          .find(button=>button.textContent.trim()==="Images ZIP")?.disabled
      };
    })()`);
    assert.equal(realSummary.confirmations.length,4,"real runtime gets rejected preview, failed setup, preview retry, and batch approval");
    assert.match(realSummary.confirmations[3],/287/,"only approval after a saved preview names 287 remaining frames");
    assert.equal(realSummary.generateCount,288,"real runtime makes exactly 288 paid-generation adapter calls");
    assert.equal(realSummary.beforeSubmitCount,288,"every real paid call executes beforeSubmit");
    assert.equal(realSummary.firstIndex,0,"real runtime starts at frame 0");
    assert.equal(realSummary.lastIndex,287,"real runtime ends at frame 287");
    assert.equal(realSummary.savedFrames,288,"real runtime persists all 288 saved frames");
    assert.equal(realSummary.completed,288,"real runtime reports numeric completed count 288");
    assert.equal(realSummary.projectId,"fixturefilm","metadata-only project uses the active film for every frame");
    assert.equal(realSummary.lastAngle,358.75,"real runtime's final frame angle is 358.75 degrees");
    assert.equal(realSummary.frameCommits,288,"real runtime commits exactly one asset per frame");
    assert.equal(realSummary.masterUnchanged,true,"real runtime never overwrites the original master asset");
    assert.equal(realSummary.exportImagesDisabled,false,"completed real run enables image export selection");

    /* Capture the requested reference screenshots and prove narrow layout. */
    await cdp.call("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await sleep(150);
    const desktop=await cdp.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
    await writeFile("/tmp/orbit-ui-desktop.png",Buffer.from(desktop.data,"base64"));
    await cdp.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await sleep(150);
    const layout=await cdp.eval(`(()=>{const d=document.documentElement,b=document.body,m=document.querySelector('.orbit-modal'),o=document.querySelector('.orbit-overlay'),mr=m?.getBoundingClientRect(),or=o?.getBoundingClientRect();return {
      viewport:innerWidth,documentWidth:d.scrollWidth,bodyWidth:b.scrollWidth,
      modalRight:mr?.right,overlayRight:or?.right
    }})()`);
    assert.ok(layout.documentWidth<=390&&layout.bodyWidth<=390&&layout.modalRight<=390&&layout.overlayRight<=390,
      `character orbit overflows at 390px: ${JSON.stringify(layout)}`);
    const mobile=await cdp.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
    await writeFile("/tmp/orbit-ui-mobile.png",Buffer.from(mobile.data,"base64"));
    assert.equal(await cdp.eval("__fixtureFetches.every(item=>item.allowed)"),true,
      "browser fetch interception allowed only fixturelocalhost and unpkg React");
    assert.deepEqual(await cdp.eval("__fixtureErrors"),[],"fixture page has no browser errors");
    console.log("Screenshots: /tmp/orbit-ui-desktop.png, /tmp/orbit-ui-mobile.png");
    console.log("PASS CharacterOrbit UI browser fixture");
  }finally{
    cdp?.close();chrome.kill("SIGTERM");await new Promise(resolve=>http.close(resolve));
  }
}

main().catch(error=>{
  console.error("RESULT: FAIL — "+(error&&error.stack||error));
  process.exitCode=1;
});
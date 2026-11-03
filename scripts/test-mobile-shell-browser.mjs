#!/usr/bin/env node
/*
 * MOBILE STEP 1 — THE SHARED FRAME (owner 2026-11-03: "make the app mobile responsive / friendly, ensuring it works on
 * all screen sizes"). Loads the real app (TURN.html, every room) with the cloud switched off — the built-in sample film,
 * no sign-in, no paid call — and checks each room at five sizes: a small phone, a phone, a phone held sideways, a tablet
 * and a desktop.
 *   · nothing is wider than the screen;
 *   · the top bar's controls never overlap (the engine pickers sat on the room switcher);
 *   · on a phone or a short screen, scrolling a room's page folds its heading away, leaving at least 70% of the screen
 *     below the tabs; scrolling back to the top brings the heading back;
 *   · on a desktop nothing folds and the engine pickers stay in the bar.
 * Run: CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/test-mobile-shell-browser.mjs
 */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile, mkdir} from "node:fs/promises";
import {spawn, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import vm from "node:vm";
import {transformSync} from "@babel/core";

if (typeof globalThis.WebSocket === "undefined") {
  const flag="--experimental-websocket";
  if (process.execArgv.includes(flag)) { console.error("Needs Node's native WebSocket."); process.exit(1); }
  const child=spawnSync(process.execPath,[flag,...process.argv.slice(1)],{stdio:"inherit",env:process.env});
  process.exit(child.status==null ? 1 : child.status);
}

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const CHROME = process.env.CHROMIUM || "/repl/tools/bin/chromium";
const OUT = process.env.MOBILE_SHELL_OUT || "/tmp/mobile-shell";
const TYPES = {".html":"text/html",".css":"text/css",".js":"text/javascript",".jsx":"text/javascript",".mjs":"text/javascript",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".woff2":"font/woff2",".ico":"image/x-icon"};

function server(){
  return createServer(async (req,res)=>{
    const p = decodeURIComponent(new URL(req.url,"http://x").pathname);
    // the cloud is off: the app runs on its built-in sample film, signed out, with nothing saved anywhere
    if(p==="/app/supabase-config.js"){ res.writeHead(200,{"content-type":"text/javascript"}).end("window.TURN_SUPABASE=null;"); return; }
    const rel = p==="/" ? "TURN.html" : p.slice(1);
    const file = path.resolve(ROOT, rel);
    if(!file.startsWith(ROOT+path.sep)){ res.writeHead(403).end(); return; }
    try{
      const body = await readFile(file);
      res.writeHead(200,{"content-type":(TYPES[path.extname(file)]||"application/octet-stream")+"; charset=utf-8","cache-control":"no-store"}).end(body);
    }catch{ res.writeHead(404).end("not found"); }
  });
}

class CDP {
  constructor(ws){ this.ws=ws; this.seq=0; this.pending=new Map(); }
  static async connect(url){
    const ws=new WebSocket(url);
    await new Promise((ok,bad)=>{ ws.onopen=ok; ws.onerror=bad; });
    const c=new CDP(ws);
    ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&c.pending.has(m.id)){ const [ok,bad]=c.pending.get(m.id); c.pending.delete(m.id); m.error?bad(new Error(m.error.message)):ok(m.result); } };
    return c;
  }
  call(method,params={}){ const id=++this.seq; this.ws.send(JSON.stringify({id,method,params})); return new Promise((a,b)=>this.pending.set(id,[a,b])); }
  async eval(expression){
    const r=await this.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  }
  close(){ this.ws.close(); }
}
async function waitFor(fn,label,ms=15_000){
  const end=Date.now()+ms; let last;
  while(Date.now()<end){ try{ last=await fn(); if(last) return last; }catch(e){ last=e.message; } await new Promise(r=>setTimeout(r,150)); }
  throw new Error(`Timed out waiting for ${label}${last?`: ${last}`:""}`);
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// measured in the page: overflow, top-bar overlaps, the room's main scrolling area
const PROBE = `(()=>{
  const W=innerWidth, H=innerHeight;
  const inScroller=e=>{ for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){ const cs=getComputedStyle(p);
    if(/(auto|scroll)/.test(cs.overflowX)) return true; if(cs.overflowX==="hidden"&&p.getBoundingClientRect().right<=W+2) return true; } return false; };
  const wide=[];
  document.querySelectorAll(".app *").forEach(e=>{ const r=e.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(r.right>W+2 && !inScroller(e)){ const pe=e.parentElement; if(pe && pe.getBoundingClientRect().right>W+2 && !inScroller(pe)) return;
      wide.push((typeof e.className==="string"&&e.className.trim()?"."+e.className.trim().split(/\\s+/).slice(0,2).join("."):e.tagName)+" →"+Math.round(r.right)); } });
  const bar=[...document.querySelectorAll(".topbar button")].filter(b=>{ const r=b.getBoundingClientRect(); return b.offsetParent && r.width>0 && r.height>0 && r.top<60; });
  const overlaps=[];
  for(let i=0;i<bar.length;i++) for(let j=i+1;j<bar.length;j++){ if(bar[i].contains(bar[j])||bar[j].contains(bar[i])) continue;
    const a=bar[i].getBoundingClientRect(), b=bar[j].getBoundingClientRect();
    const x=Math.min(a.right,b.right)-Math.max(a.left,b.left), y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if(x>2&&y>2) overlaps.push((bar[i].getAttribute("aria-label")||bar[i].className)+" × "+(bar[j].getAttribute("aria-label")||bar[j].className)); }
  const scrollers=[...document.querySelectorAll(".app *")].filter(e=>{ const cs=getComputedStyle(e);
    return /(auto|scroll)/.test(cs.overflowY) && e.clientHeight>90 && e.scrollHeight-e.clientHeight>240 && !e.closest(".topbar,.viewnav,.wr-head,.stage-head,[role=dialog],.modal,.muse-dock-wrap"); })
    .sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
  const main=scrollers[0];
  // the room's heading (with its tabs): what the shared frame keeps above the page
  const head=document.querySelector(".app .art-head, .app .wr-head, .app .stage-head");
  const headBottom=head ? Math.round(head.getBoundingClientRect().bottom) : 0;
  return { W, H, docW:document.documentElement.scrollWidth, wide:wide.slice(0,8), overlaps, headBottom,
    app:(document.querySelector(".app")||{}).className||"", crashed:/render crash|Something went wrong/i.test(document.body.innerText),
    main: main ? {cls:String(main.className).split(" ")[0], h:main.clientHeight, top:Math.round(main.getBoundingClientRect().top)} : null,
    enginesInBar: !!document.querySelector(".topbar .tb-engines") && getComputedStyle(document.querySelector(".topbar .tb-engines")).display!=="none",
    enginesToggle: !!document.querySelector(".tb-engines-toggle") && getComputedStyle(document.querySelector(".tb-engines-toggle")).display!=="none" };
})()`;

const SIZES = [
  {name:"phone",       w:375,  h:812,  mobile:true,  fold:true},
  {name:"small phone", w:320,  h:640,  mobile:true,  fold:true},
  {name:"sideways",    w:812,  h:375,  mobile:true,  fold:true},
  {name:"tablet",      w:768,  h:1024, mobile:true,  fold:false},
  {name:"desktop",     w:1440, h:900,  mobile:false, fold:false},
];
const ROOMS = [["writers","Writers' Room"],["art","The Art Room"],["stage","The Stage"]];

/* the app's built-in sample film (app/story-data.jsx), saved as the local story before the page loads, so every room
   has something in it: 16 scenes with beats and screenplay, the cast and props */
async function sampleStory(){
  const code=transformSync(await readFile(path.join(ROOT,"app/story-data.jsx"),"utf8"),{presets:["@babel/preset-react"],filename:"story-data.jsx"}).code;
  const box={}; box.window=box; vm.createContext(box); vm.runInContext(code,box);
  const D=box.TURN_DATA;
  // one opening shot per beat of the first scenes, so the Stage has clips (no image: nothing is generated)
  const shots=[];
  D.SCENES.slice(0,4).forEach(sc=>{ const beats=(D.SCREENPLAY[sc.id]&&D.SCREENPLAY[sc.id].blocks||[]).map(b=>Number(b.beat)).filter(n=>n>0);
    Array.from(new Set(beats)).forEach((n,i)=>shots.push({id:`shot-${sc.id}-${n}`,sceneId:sc.id,beatN:n,order:i,keyframeMode:"beat-opening",
      size:"MS",angle:"eye",move:"static",lens:"35",action:"",composition:"",subjects:[],props:[],covers:[],specRev:1})); });
  return {scenes:D.SCENES,characters:D.CHARACTERS,props:D.PROPS,project:D.PROJECT,beatsMap:D.BEATS,drafts:D.SCREENPLAY,
    continuityMap:D.CONTINUITY,shots,room:"writers",view:"script",artView:"characters"};
}

async function main(){
  await mkdir(OUT,{recursive:true});
  const story=JSON.stringify(await sampleStory());
  const srv=server(); await new Promise(ok=>srv.listen(0,"127.0.0.1",ok));
  const port=srv.address().port, debugPort=9400+Math.floor(Math.random()*400);
  const profile=`${OUT}/chrome-profile-${process.pid}`;
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox","--disable-gpu",`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
  let c, failures=[], checks=0;
  const check=(ok,msg)=>{ checks++; if(!ok) failures.push(msg); };
  try{
    const target=await waitFor(async()=>{ const r=await fetch(`http://127.0.0.1:${debugPort}/json/list`); if(!r.ok) return null;
      return (await r.json()).find(x=>x.type==="page"&&x.webSocketDebuggerUrl); },"Chrome page");
    c=await CDP.connect(target.webSocketDebuggerUrl);
    await c.call("Page.enable"); await c.call("Runtime.enable");
    await c.call("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await c.call("Page.addScriptToEvaluateOnNewDocument",{source:`try{ if(!localStorage.getItem("turn-story-v1")) localStorage.setItem("turn-story-v1", ${JSON.stringify(story)}); }catch(e){}`});
    await c.call("Page.navigate",{url:`http://127.0.0.1:${port}/`});
    // the app compiles in the page (Babel): a minute or two
    await waitFor(()=>c.eval(`!!document.querySelector(".app .topbar")`),"the app to load",240_000);
    if(process.env.MOBILE_SHELL_DEBUG){ await sleep(3000); console.log(await c.eval(`document.querySelector(".app").className+" || "+document.body.innerText.slice(0,1500)`)); }
    const goRoom=async(id,label)=>{
      const cur=await c.eval(`(document.querySelector(".app")||{}).className||""`);
      if(cur.includes("room-"+id+" ")) return true;
      await c.eval(`(()=>{ const b=[...document.querySelectorAll(".topbar button")].find(x=>/room/i.test(x.getAttribute("aria-label")||"")); b&&b.click(); })()`);
      await sleep(400);
      await c.eval(`(()=>{ const it=[...document.querySelectorAll("button,[role=menuitem]")].find(x=>x.textContent.replace(/\\s+/g,"").includes(${JSON.stringify(label.replace(/\s+/g,""))})&&x.offsetParent&&!x.closest(".topbar .room-btn")); it&&it.click(); })()`);
      try{ await waitFor(()=>c.eval(`(document.querySelector(".app")||{}).className.includes("room-${id} ")`),"room "+id,20_000); return true; }
      catch(e){ return false; }
    };
    for(const size of SIZES){
      await c.call("Emulation.setDeviceMetricsOverride",{width:size.w,height:size.h,deviceScaleFactor:1,mobile:size.mobile});
      await sleep(600);
      for(const [id,label] of ROOMS){
        const tag=`${size.name} ${size.w}×${size.h} · ${label}`;
        if(!(await goRoom(id,label))){ check(false,`${tag}: could not open the room`); continue; }
        await sleep(1200);
        // start at the top, unfolded
        await c.eval(`(()=>{ document.querySelectorAll(".app *").forEach(e=>{ if(e.scrollTop>0) e.scrollTop=0; }); })()`);
        await sleep(700);
        const top=await c.eval(PROBE);
        check(!top.crashed && top.app.includes("app hs"), `${tag}: the app rendered`);
        check(top.docW<=top.W+1 && top.wide.length===0, `${tag}: nothing wider than the screen (${top.docW}px page; ${top.wide.join(", ")})`);
        check(top.overlaps.length===0, `${tag}: top bar controls overlap: ${top.overlaps.join("; ")}`);
        if(size.w<=700) check(!top.enginesInBar || top.enginesToggle, `${tag}: the engines fold into the Engines button on a phone`);
        if(size.w>=1100) check(!top.enginesToggle, `${tag}: no Engines button on a desktop`);
        check(!top.app.includes("head-hidden"), `${tag}: the heading starts unfolded`);
        if(!top.main){ check(false,`${tag}: found no scrolling page`); continue; }
        // scroll the room's page down, as a person would
        await c.eval(`(async()=>{ const m=[...document.querySelectorAll(".app *")].find(e=>String(e.className).split(" ")[0]===${JSON.stringify(top.main.cls)}&&e.clientHeight===${top.main.h}); if(!m) return;
          for(let i=1;i<=6;i++){ m.scrollTop=i*90; await new Promise(r=>setTimeout(r,60)); } })()`);
        await sleep(700);
        const down=await c.eval(PROBE);
        if(size.fold){
          check(down.app.includes("head-hidden"), `${tag}: scrolling the page down folds the heading`);
          // the space below the heading and its tabs (how the room splits that space is the room's own layout)
          // (a heading that scrolled off with its page ends above the screen: all of it is the page's)
          const share=(size.h-Math.max(0,down.headBottom))/size.h;
          check(share>=0.7, `${tag}: the page has most of the screen once the heading folds (${Math.round(share*100)}%: the heading ends at ${down.headBottom}px of ${size.h})`);
          await c.call("Page.captureScreenshot",{format:"png"}).then(async r=>{ const {writeFile}=await import("node:fs/promises");
            await writeFile(`${OUT}/${size.name.replace(/\s+/g,"-")}-${id}-folded.png`,Buffer.from(r.data,"base64")); });
          await c.eval(`(()=>{ const m=[...document.querySelectorAll(".app *")].find(e=>String(e.className).split(" ")[0]===${JSON.stringify(top.main.cls)}); if(m) m.scrollTop=0; })()`);
          await sleep(700);
          const back=await c.eval(PROBE);
          check(!back.app.includes("head-hidden"), `${tag}: back at the top, the heading returns`);
        }else{
          check(!down.app.includes("head-hidden"), `${tag}: the heading never folds at this size`);
        }
      }
    }
  }finally{
    try{ c&&c.close(); }catch{}
    chrome.kill("SIGKILL"); srv.close();
  }
  if(failures.length){ console.error(failures.map(f=>"FAIL: "+f).join("\n")); console.error(`${failures.length} of ${checks} checks failed`); process.exit(1); }
  console.log(`PASS mobile shell: ${checks} checks · screenshots in ${OUT}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Focused native-details layering regression; checks card-relative geometry and paint hit testing. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";
const ROOT=new URL("../",import.meta.url),CHROME=process.env.CHROMIUM||"/repl/tools/bin/chromium";
class WS{static async connect(url){const u=new URL(url),key=crypto.randomBytes(16).toString("base64"),s=net.connect(+u.port,u.hostname);let b=Buffer.alloc(0);await new Promise((ok,bad)=>{s.once("error",bad);s.once("connect",()=>s.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));s.on("data",d=>{b=Buffer.concat([b,d]);if(b.includes(Buffer.from("\r\n\r\n")))(b.toString().startsWith("HTTP/1.1 101")?ok:bad)(Error("CDP handshake failed"))})});const w=new WS(s);s.on("data",d=>w.read(d));return w}constructor(s){this.s=s;this.b=Buffer.alloc(0)}send(t){const p=Buffer.from(t),m=crypto.randomBytes(4),h=p.length<126?Buffer.from([129,128|p.length]):Buffer.from([129,254,p.length>>8,p.length&255]);for(let i=0;i<p.length;i++)p[i]^=m[i%4];this.s.write(Buffer.concat([h,m,p]))}read(d){this.b=Buffer.concat([this.b,d]);while(this.b.length>=2){let n=this.b[1]&127,o=2;if(n===126){if(this.b.length<4)return;n=this.b.readUInt16BE(2);o=4}if(this.b.length<o+n)return;const x=this.b.subarray(o,o+n).toString();this.b=this.b.subarray(o+n);this.onmessage?.({data:x})}}close(){this.s.destroy()}}
class CDP{constructor(w){this.w=w;this.n=0;this.q=new Map;w.onmessage=e=>{const x=JSON.parse(e.data),f=this.q.get(x.id);if(f){this.q.delete(x.id);f(x)}}}static async connect(u){return new CDP(await WS.connect(u))}call(method,params={}){return new Promise((ok,bad)=>{const id=++this.n;this.q.set(id,x=>x.error?bad(Error(x.error.message)):ok(x.result));this.w.send(JSON.stringify({id,method,params}))})}async eval(expression){return (await this.call("Runtime.evaluate",{expression,returnByValue:true})).result.value}close(){this.w.close()}}
const card=id=>`<div class="sheet-card shot-card" data-shot-card="${id}"><div class=sheet-frame><div class=sheet-media><div class=cover>${id} shot frame</div></div><div class="shot-refs coverage-refs"><div class=shot-refs-lab>Reference images</div><div class=shot-location-picker><span class=shot-location-picker-label>Location reference</span><details class=shot-location-picker-menu open><summary class=shot-location-picker-summary>Manual <small>choose references</small></summary><div class=shot-location-picker-panel><section class=shot-location-picker-section><b>Place</b><label class=shot-location-check><input type=checkbox><span class=shot-location-check-copy><strong data-target="${id}">Harbour platform</strong><small>INT · rain</small></span></label><label class=shot-location-check><input type=checkbox><span class=shot-location-check-copy><strong>East tunnel</strong></span></label></section></div></details></div></div></div><div class=sheet-body><p>${id} card content</p></div></div>`;
const markup=css=>`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${css}body{padding:24px;background:var(--bg-0)}.beat-card-grid{max-width:632px}.sheet-frame{min-height:280px}.cover{height:220px;background:var(--bg-3);border-radius:8px}.sheet-body{min-height:120px}</style><div class=beat-card-grid>${card("left")}${card("right")}</div>`;
async function wait(fn){const end=Date.now()+8000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50))}throw Error("timeout")}
async function inspectLayout(c,expected){
  const rows=await c.eval(`(()=>[...document.querySelectorAll('.shot-location-picker-menu[open] .shot-location-picker-panel')].map(panel=>{
    const menu=panel.closest('.shot-location-picker-menu');
    const card=panel.closest('.sheet-card');
    const summary=menu.querySelector('.shot-location-picker-summary');
    const input=panel.querySelector('input');
    const cr=card.getBoundingClientRect(),pr=panel.getBoundingClientRect(),sr=summary.getBoundingClientRect(),ir=input.getBoundingClientRect();
    const hit=document.elementFromPoint(ir.left+ir.width/2,ir.top+ir.height/2);
    return {
      id:card.dataset.shotCard,
      cardLeft:cr.left,cardRight:cr.right,panelLeft:pr.left,panelRight:pr.right,
      panelTop:pr.top,summaryBottom:sr.bottom,summaryRight:sr.right,
      panelHit:!!hit?.closest('.shot-location-picker-panel'),
      hitCard:hit?.closest('.sheet-card')?.dataset.shotCard||null,
    };
  }))()`);
  assert.equal(rows.length,expected,"every open picker should have one measurable panel");
  for(const row of rows){
    assert.ok(Math.abs(row.panelRight-row.summaryRight)<1,
      `${row.id} panel right ${row.panelRight} must align with summary right ${row.summaryRight}`);
    assert.ok(row.panelLeft>=row.cardLeft+8,
      `${row.id} panel must stay inset from the card's left edge`);
    assert.ok(row.panelRight<=row.cardRight-8,
      `${row.id} panel must stay inset from the card's right edge`);
    assert.ok(row.panelTop>=row.summaryBottom,
      `${row.id} panel must open below its picker row`);
    assert.equal(row.panelHit,true,`${row.id} checkbox must win elementFromPoint`);
    assert.equal(row.hitCard,row.id,`${row.id} checkbox hit must stay in its owning card`);
  }
  return rows;
}
async function screenshot(c,path){
  await writeFile(path,Buffer.from((await c.call("Page.captureScreenshot",{format:"png"})).data,"base64"));
}
async function main(){
  const css=await readFile(new URL("app/styles.css",ROOT),"utf8"),server=createServer((_,r)=>r.end(markup(css)));
  await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
  const debug=9800+Math.floor(Math.random()*100);
  const chrome=spawn(CHROME,["--headless=new","--no-sandbox",`--remote-debugging-port=${debug}`,`--user-data-dir=/tmp/shot-layer-${process.pid}`]);
  let c;
  try{
    const tab=await wait(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==="page")}catch{return null}});
    c=await CDP.connect(tab.webSocketDebuggerUrl);
    await c.call("Page.enable");
    await c.call("Page.navigate",{url:`http://127.0.0.1:${server.address().port}`});
    await wait(()=>c.eval("!!document.querySelector('[data-target]')"));
    for(const theme of ["dark","light"]){
      await c.call("Emulation.setDeviceMetricsOverride",{width:800,height:900,deviceScaleFactor:1,mobile:false});
      await c.eval(`(()=>{document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelectorAll('details').forEach(d=>d.open=true);return document.body.offsetHeight})()`);
      await inspectLayout(c,2);
      await screenshot(c,`/tmp/shot-location-layering-desktop-${theme}.png`);
      await c.call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await c.eval("(()=>{const ds=document.querySelectorAll('details');ds[0].open=true;ds[1].open=false;return document.body.offsetHeight})()");
      await inspectLayout(c,1);
      await screenshot(c,`/tmp/shot-location-layering-mobile-${theme}.png`);
    }
    console.log("PASS: /tmp/shot-location-layering-{desktop,mobile}-{dark,light}.png");
  }finally{
    c?.close();
    chrome.kill();
    await new Promise(ok=>server.close(ok));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});

#!/usr/bin/env node
/* test-screenplay-pages-browser.mjs — the 2026-10-14 screenplay pages and copy check on a REAL canvas (owner-approved,
   "go ahead with all of it"). The node tests measure Courier New with its published advance and read pixels without a
   canvas; this one runs the app's own code in headless Chrome:
   1. ONE SCREENPLAY IMAGE PER SCENE: every Glass Hours scene renders as ONE location page (1000×1294 PNG) and ONE Stage
      page with the browser's real fonts, the target beat highlighted on a shot's page;
   2. THE COPY CHECK: plates drawn on a canvas, saved as PNG data URLs and read back through locationCopyCheck (the
      Image → canvas → getImageData path the card uses): near-identical re-renders are caught and matched to their
      panel, other views are not, a 2x2 plate is read panel by panel — the same decisions as the pixel maths in node.
   No app server, no provider, no account. CHROMIUM=/path/to/chrome overrides the browser.
   node scripts/test-screenplay-pages-browser.mjs */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

if (typeof globalThis.WebSocket === "undefined") {
  const flag = "--experimental-websocket";
  if (process.execArgv.includes(flag)) { console.error("This browser test needs Node's native WebSocket."); process.exit(1); }
  const child = spawnSync(process.execPath, [flag, ...process.argv.slice(1)], { stdio: "inherit", env: process.env });
  process.exit(child.status == null ? 1 : child.status);
}

const FIXTURE = `/tmp/screenplay-pages-${process.pid}`;
const CHROME = process.env.CHROMIUM || "/repl/tools/bin/chromium";
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

async function prepare() {
  await mkdir(FIXTURE, { recursive: true });
  const loc = await read("app/locations.jsx");
  const slice = (from, to) => { const a = loc.indexOf(from), b = loc.indexOf(to, a); if (a < 0 || b <= a) throw new Error("slice " + from); return loc.slice(a, b); };
  // plain-JS parts of locations.jsx: the panel table, the copy check, the screenplay pages
  const code = [
    "window._locTurn = (s)=>s&&s.turn||\"\";",
    slice("const LOC_PANEL_INFO = {", "const LOC_NUMBER_BASES"),
    slice("/* ---- THE COPY CHECK", "/* ---- \"Make a … view from this room's position\""),
    slice("function locationSceneForCoverageSheet(", "function locationMasterPanelPlan("),
  ].join("\n");
  await writeFile(`${FIXTURE}/locations-part.js`, code);
  await writeFile(`${FIXTURE}/stage-screenplay-images.js`, await read("app/stage-screenplay-images.js"));
  await writeFile(`${FIXTURE}/copy-check-plates.js`, await read("scripts/fixtures/copy-check-plates.js"));
  await writeFile(`${FIXTURE}/glass-hours.json`, await read("scripts/fixtures/glass-hours-locations.json"));
  await writeFile(`${FIXTURE}/index.html`, `<!doctype html><meta charset="utf-8"><title>pages</title><body>
<script src="/locations-part.js"></script><script src="/stage-screenplay-images.js"></script><script src="/copy-check-plates.js"></script>
<script>window.__ready = true;</script></body>`);
}

function server() {
  return createServer(async (req, res) => {
    const name = new URL(req.url, "http://fixture").pathname.slice(1) || "index.html";
    if (!/^[a-z0-9._-]+$/i.test(name)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(`${FIXTURE}/${name}`);
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".json") ? "application/json" : "text/javascript";
      res.writeHead(200, { "content-type": type }).end(body);
    } catch { res.writeHead(404).end("missing"); }
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    const c = new CDP(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) { const [ok, bad] = c.pending.get(m.id); c.pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
    };
    return c;
  }
  call(method, params = {}) { const id = ++this.seq; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, bad) => this.pending.set(id, [ok, bad])); }
  async eval(expression) {
    const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() { this.ws.close(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label) { for (let i = 0; i < 150; i++) { if (await fn()) return; await sleep(40); } throw new Error("Timed out waiting for " + label); }

await prepare();
const http = server();
await new Promise((ok) => http.listen(0, "127.0.0.1", ok));
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${FIXTURE}/profile`, "about:blank"], { stdio: "ignore" });
let c;
try {
  const target = await (async () => {
    for (let i = 0; i < 375; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const page = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl); if (page) return page; } catch {}
      await sleep(40);
    }
    throw new Error("Chromium target did not start");
  })();
  c = await CDP.connect(target.webSocketDebuggerUrl);
  await c.call("Page.enable"); await c.call("Runtime.enable");
  await c.call("Page.navigate", { url: `http://127.0.0.1:${http.address().port}/` });
  await waitFor(() => c.eval("window.__ready===true && typeof window.locationScreenplayReferenceImages==='function' && !!window.copyCheckFixtures"), "the fixture page");

  /* ---- 1. one screenplay image per scene, real fonts ---- */
  const pages = await c.eval(`(async()=>{
    const film = await (await fetch("/glass-hours.json")).json();
    const scenes = film.scenes.slice().sort((a,b)=>a.no-b.no);
    const size = (url)=>new Promise(ok=>{ const im=new Image(); im.onload=()=>ok([im.naturalWidth,im.naturalHeight]); im.onerror=()=>ok(null); im.src=url; });
    const fmt = (blocks)=>blocks.filter(b=>String(b.text||"").trim()).map(b=>(b.beat!=null?"[BEAT "+b.beat+" · "+String(b.type||"action").toUpperCase()+"]":"["+String(b.type||"action").toUpperCase()+"]")+" "+b.text).join("\\n");
    const out = [];
    for(const sc of scenes){
      const m = window.locationScreenplayReferenceImages({name:"x"},{sceneNos:[sc.no]},film.scenes,film.drafts,{returnMeta:true,pageLimit:99});
      const st = window.stageScreenplayImages({signature:"sig-"+sc.id,hasSource:true,fullText:fmt(film.drafts[sc.id].blocks),targetBeats:[1],errors:[],sceneNo:sc.no,sceneTitle:sc.title});
      out.push({no:sc.no, pages:m.pageCount, layout:m.layout, png:await size(m.images[0]), stage:st.images.length, stageLayout:(st.images[0]||{}).layout, stagePng:st.images[0]?await size(st.images[0].url):null, errors:st.errors});
    }
    const shot = window.locationScreenplayReferenceImages(null,{sceneNos:[3]},film.scenes,film.drafts,{returnMeta:true,targetBeat:2,contextLabel:"SHOT SCENE CONTEXT"});
    return {out, shot:{pages:shot.pageCount, layout:shot.layout}, font:document.fonts?document.fonts.check("15px Courier New"):null};
  })()`);
  for (const p of pages.out) {
    assert.equal(p.pages, 1, "scene " + p.no + " is one location page (" + p.layout + ")");
    assert.deepEqual(p.png, p.layout === "15px-tight" ? [1000, 1294] : [1000, 1500], "scene " + p.no + ": a real PNG of its layout's size");
    assert.equal(p.stage, 1, "scene " + p.no + " is one Stage page"); assert.deepEqual(p.errors, []);
    assert.deepEqual(p.stagePng, p.stageLayout === "15px-tight" ? [1000, 1294] : [1000, 1500]);
  }
  assert.equal(pages.shot.pages, 1, "a shot's scene context is one page too");
  const layouts = [...new Set(pages.out.map((p) => p.layout))];

  /* ---- 2. the copy check through the real canvas path ---- */
  const check = await c.eval(`(async()=>{
    const F = window.copyCheckFixtures;
    const toUrl = (img)=>{ const cv=document.createElement("canvas"); cv.width=img.w; cv.height=img.h; const ctx=cv.getContext("2d");
      const d=ctx.createImageData(img.w,img.h); d.data.set(img.px); ctx.putImageData(d,0,0); return cv.toDataURL("image/png"); };
    const rows = [];
    for(const seed of [1,2,3]){
      const c = F.cases(seed), parent = toUrl(c.parent);
      const run = async (img, single)=> window.locationCopyCheck(toUrl(img), parent, {single});
      for(const x of c.copies){ const r = await run(x.img,true); rows.push({k:"copy",label:x.label,of:x.of,near:r&&r.panels[0].near,match:r&&r.panels[0].match,d:r&&r.panels[0].detail,l:r&&r.panels[0].layout}); }
      for(const x of [...c.different,...c.neighbours,c.other]){ const r = await run(x.img,true); rows.push({k:"other",label:x.label,near:r&&r.panels[0].near,d:r&&r.panels[0].detail,l:r&&r.panels[0].layout}); }
      const pick = (lab)=>c.copies.find(x=>x.label.endsWith(lab)).img;
      const two = await window.locationCopyCheck(toUrl(F.sheet(388,220,[pick("TR v0"),c.different[0].img,c.neighbours[0].img,pick("BL v1")])), parent, {});
      rows.push({k:"2x2",label:"2x2 s"+seed,panels:two&&two.panels.map(p=>[p.key,p.near,p.match])});
    }
    // a big plate (as a provider returns it) is read small: 1376×768 → 384 px wide
    const big = F.cases(4); const bigUrl = toUrl({px:F.render(1376,768,big.world,F.CAMS[1],{noise:6}),w:1376,h:768});
    const t0 = performance.now(); const bigR = await window.locationCopyCheck(bigUrl, toUrl(big.parent), {single:true}); const ms = performance.now()-t0;
    return {rows, big:{near:bigR&&bigR.panels[0].near, match:bigR&&bigR.panels[0].match}, ms};
  })()`);
  const copies = check.rows.filter((r) => r.k === "copy"), others = check.rows.filter((r) => r.k === "other");
  copies.forEach((r) => { assert.equal(r.near, true, r.label + " caught on a real canvas (" + r.d + "/" + r.l + ")"); assert.equal(r.match, r.of, r.label); });
  others.forEach((r) => assert.equal(r.near, false, r.label + " not a copy on a real canvas (" + r.d + "/" + r.l + ")"));
  check.rows.filter((r) => r.k === "2x2").forEach((r) => assert.deepEqual(r.panels, [["TL", true, "TR"], ["TR", false, r.panels[1][2]], ["BL", false, r.panels[2][2]], ["BR", true, "BL"]], r.label));
  assert.deepEqual(check.big, { near: true, match: "TR" }, "a full-size plate: read small, still caught");
  assert.ok(check.ms < 2000, "one check takes " + Math.round(check.ms) + " ms");
  console.log(`PASS screenplay pages and copy check in a real browser: ${pages.out.length} Glass Hours scenes one page each (layouts ${layouts.join(", ")}; Courier New ${pages.font ? "present" : "falls back"}), ${copies.length} copies caught and ${others.length} other views passed through the PNG → canvas path, a full plate checked in ${Math.round(check.ms)} ms`);
} finally {
  c?.close(); chrome.kill(); http.close();
}

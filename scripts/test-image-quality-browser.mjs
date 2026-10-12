#!/usr/bin/env node
/* Browser-only quality control fixture. It mounts the real Art Room dock with
   recording fakes; no image provider, auth, or app server is involved. (The
   Stage's separate image composer tab was retired with the Create / Edit /
   Motion Control composer — Stage image work lives in the Art Room.) */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { transformSync } from "@babel/core";

/*
 * Node 20 keeps the native WebSocket client behind --experimental-websocket.
 * Re-enter this same script with that flag so `node scripts/test-stage-browser.mjs`
 * is independently runnable; the child inherits the caller's stdio and status.
 * Do this before opening any fixture/server resources so a retry cannot leave a
 * partially prepared browser run behind.
 */
if (typeof globalThis.WebSocket === "undefined") {
  const websocketFlag="--experimental-websocket";
  const retried=process.execArgv.includes(websocketFlag);
  if (retried) {
    console.error("Image quality browser fixture requires Node's native WebSocket, but --experimental-websocket did not expose global WebSocket.");
    process.exit(1);
  }
  const major=Number(String(process.versions.node||"0").split(".")[0]);
  if (!Number.isFinite(major) || major<20) {
    console.error(`Image quality browser fixture requires Node 20+ with native WebSocket support (found ${process.versions.node||"unknown"}).`);
    process.exit(1);
  }
  const child=spawnSync(process.execPath,[websocketFlag,...process.argv.slice(1)],{
    stdio:"inherit",
    env:process.env
  });
  if (child.error) {
    console.error(`Could not relaunch Image quality browser fixture with ${websocketFlag}: ${child.error.message}`);
    process.exit(1);
  }
  if (child.status===9) {
    console.error(`This Node binary does not support ${websocketFlag}; use Node 20+ with the native WebSocket runtime.`);
    process.exit(1);
  }
  process.exit(child.status==null ? 1 : child.status);
}

const ROOT = new URL("../", import.meta.url);
const FIXTURE = `/tmp/quality-controls-${process.pid}`;
const CHROME = process.env.CHROMIUM || "/repl/tools/bin/chromium";

function transform(source, filename) {
  return transformSync(source, {
    presets: [["@babel/preset-react", { runtime: "classic" }]],
    plugins: ["@babel/plugin-transform-block-scoping"],
    comments: false, compact: false, babelrc: false, configFile: false, filename,
  }).code;
}

async function prepare() {
  await mkdir(FIXTURE, { recursive: true });
  const art = await readFile(new URL("../app/artroom.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/styles.css", import.meta.url));
  const artStart = art.indexOf("function NbControls()");
  const artEnd = art.indexOf("\n/* ENGINE DOCK", artStart);
  await writeFile(`${FIXTURE}/artroom.js`, transform(art.slice(artStart, artEnd), "NbControls.jsx"));
  await writeFile(`${FIXTURE}/styles.css`, styles);
  const react = await fetch("https://unpkg.com/react@18.3.1/umd/react.development.js");
  const dom = await fetch("https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js");
  if (!react.ok || !dom.ok) throw new Error("Could not fetch React fixture runtime");
  await writeFile(`${FIXTURE}/react.js`, Buffer.from(await react.arrayBuffer()));
  await writeFile(`${FIXTURE}/react-dom.js`, Buffer.from(await dom.arrayBuffer()));
  await writeFile(`${FIXTURE}/index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css">
<div id="dock"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
const quality25=["default","auto","low","medium","high","xhigh","max"];
const legacy=["low","medium","high"];
// the engines (2026-10-11): GPT Image 2 is gone; Seedream 5 Pro has no quality control and renders up to 2K
const models=[
  {id:"seedream-5-pro",label:"Seedream 5 Pro",family:"seedream",maxRes:"2K"},
  {id:"gpt-image-2.5-flare",label:"GPT Image 2.5 Flare",family:"openai"},
  {id:"gpt-image-2.5-sunburst",label:"GPT Image 2.5 Sunburst",family:"openai"},
];
window.NB_MODELS=models; window.NB_ASPECTS=["16:9"]; window.NB_RESOLUTIONS=["1K","2K","4K"];
window.nbModelMaxRes=m=>((models.find(x=>x.id===m)||{}).maxRes)||"4K";
window.nbModelRes=(m,r)=>(window.nbModelMaxRes(m)==="2K"&&r==="4K")?"2K":r;
window.__capsExpanded=false; window.__providerCalls=[];
const is25=m=>String(m||"").indexOf("gpt-image-2.5-")===0;
window.isGptImageModel=m=>/^gpt-image/.test(String(m||""));
window.nbOaiQualityChoices=m=>(is25(m)?quality25:legacy).slice();
window.nbOaiQualityLabel=q=>({default:"Default (High)",auto:"Auto",low:"Low",medium:"Medium",high:"High",xhigh:"Extra high (xhigh)",max:"Max"})[q]||q;
window.nbGetModel=()=>localStorage.getItem("quality-model")||models[0].id;
window.nbSetModel=m=>{localStorage.setItem("quality-model",m);window.dispatchEvent(new CustomEvent("nb-model-changed"));};
window.nbGetOaiQuality=m=>{
  m=m||window.nbGetModel(); const key=is25(m)?"turn-oai-quality:2.5":"turn-oai-quality";
  const q=localStorage.getItem(key)||"medium"; return window.nbOaiQualityChoices(m).includes(q)?q:"medium";
};
window.nbSetOaiQuality=(q,m)=>{m=m||window.nbGetModel();localStorage.setItem(is25(m)?"turn-oai-quality:2.5":"turn-oai-quality",q);window.dispatchEvent(new CustomEvent("nb-settings-changed"));};
window.nbImageQualitySupport=m=>({loading:false,expanded:!is25(m)||window.__capsExpanded,qualities:is25(m)?(window.__capsExpanded?quality25:legacy):legacy,message:!is25(m)||window.__capsExpanded?"":"Check image-server support"});
window.nbCanUseImageQuality=(m,q)=>window.nbOaiQualityChoices(m).includes(q)&&window.nbImageQualitySupport(m).qualities.includes(q);
window.nbRefreshImageQualityCapabilities=async()=>window.nbImageQualitySupport(window.nbGetModel());
window.nbRequireImageQuality=async()=>{};
window.nbGetAspect=()=>"16:9"; window.nbSetAspect=()=>{};
window.nbGetRes=()=>"4K"; window.nbSetRes=()=>{};
window.nbGetGroundSearch=()=>false; window.nbSetGroundSearch=()=>{};
window.nbCostChip=()=>null; window.nbGetImage=()=>""; window.shotFrameGenOpts=()=>({
  finalPrompt:"FRAME",chainPrompt:"FRAME",renderPlan:{orderedSpecs:[]},
  opts:{buildFinal:()=> "FRAME",buildFromBase:()=> "FRAME",buildSimple:()=> "FRAME"}
});
window.inFrameCast=()=>[]; window.useImageGen=opts=>{
  return {genUrl:"",genErr:"",gening:false,cancelGen:()=>{},generate:()=>window.__providerCalls.push(opts)};
};
window.Icon=new Proxy({}, {get:(_,name)=>()=>null});
window._stEl=(...args)=>React.createElement(...args);
window.ReactDOM.createPortal=(x)=>x;
function mount(){
  ReactDOM.createRoot(document.querySelector("#dock")).render(React.createElement(NbControls));
}
</script>
<script src="/artroom.js"></script>
<script>/* scripts are loaded after the fixture definitions; mount once ready. */ mount(); window.__mounted=true;</script>`);
}

function server() {
  return createServer(async (req, res) => {
    const name = new URL(req.url, "http://fixture").pathname.slice(1) || "index.html";
    if (!/^[a-z0-9._-]+$/i.test(name)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(`${FIXTURE}/${name}`);
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
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
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const [ok, bad] = c.pending.get(m.id); c.pending.delete(m.id);
        m.error ? bad(new Error(m.error.message)) : ok(m.result);
      }
    };
    return c;
  }
  call(method, params = {}) {
    const id = ++this.seq; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, bad) => this.pending.set(id, [ok, bad]));
  }
  async eval(expression) {
    const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() { this.ws.close(); }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await sleep(40); }
  throw new Error(`Timed out waiting for ${label}`);
}

await prepare();
const http = server();
await new Promise(ok => http.listen(0, "127.0.0.1", ok));
const debugPort = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${FIXTURE}/profile`, "about:blank"], { stdio: "ignore" });
let c;
try {
  const target = await (async () => {
    for (let i = 0; i < 375; i++) {   // up to 15 s: a busy machine can take 6 s or more to start Chrome
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        const page = list.find(x => x.type === "page" && x.webSocketDebuggerUrl);
        if (page) return page;
      } catch {}
      await sleep(40);
    }
    throw new Error("Chromium target did not start");
  })();
  c = await CDP.connect(target.webSocketDebuggerUrl);
  await c.call("Page.enable"); await c.call("Runtime.enable");
  await c.call("Page.navigate", { url: `http://127.0.0.1:${http.address().port}/` });
  await waitFor(() => c.eval(`window.__mounted && document.querySelectorAll("#dock .nb-ctl").length>=3`), "quality dock");
  const quality = () => c.eval(`(()=>{const x=[...document.querySelectorAll("#dock .nb-ctl")].find(x=>x.querySelector(".nb-ctl-lab")?.textContent==="Quality");const b=[...x.querySelectorAll(".nb-seg-btn")];return {labels:b.map(x=>x.textContent.trim()),disabled:b.map(x=>x.disabled)}})()`);
  const model = label => c.eval(`(()=>{const b=[...document.querySelectorAll("#dock .nb-ctl")][0]&&[...document.querySelectorAll("#dock .nb-ctl")][0].querySelectorAll("button");[...b].find(x=>x.textContent.includes(${JSON.stringify(label)})).click()})()`);
  await model("Seedream 5 Pro");
  const ctlLabels = () => c.eval(`[...document.querySelectorAll("#dock .nb-ctl .nb-ctl-lab")].map(x=>x.textContent)`);
  await waitFor(async () => !(await ctlLabels()).includes("Quality"), "no quality control for Seedream");
  const resolution = () => c.eval(`(()=>{const x=[...document.querySelectorAll("#dock .nb-ctl")].find(x=>x.querySelector(".nb-ctl-lab")?.textContent==="Resolution");return {labels:[...x.querySelectorAll(".nb-seg-btn")].map(b=>b.textContent.trim()),on:[...x.querySelectorAll(".nb-seg-btn.on")].map(b=>b.textContent.trim()),note:(x.querySelector(".nb-quality-message")||{}).textContent||""}})()`);
  assert.deepEqual(await resolution(), { labels: ["1K", "2K"], on: ["2K"], note: "Seedream 5 Pro renders up to 2K — your 4K setting renders at 2K here." });
  await model("GPT Image 2.5 Flare");
  await waitFor(async () => (await quality()).labels.length === 7, "2.5 quality choices");
  assert.deepEqual((await resolution()).labels, ["1K", "2K", "4K"], "GPT Image 2.5 offers 4K");
  let q = await quality();
  assert.equal(q.disabled[0], true, "Default is gated until the 2.5 route is verified");
  assert.deepEqual(q.disabled.slice(2, 5), [false, false, false], "legacy quality levels remain usable");
  await c.eval(`window.__capsExpanded=true;window.dispatchEvent(new CustomEvent("nb-quality-capabilities"))`);
  await waitFor(async () => !(await quality()).disabled[0], "capability event rerender");
  await c.eval(`([...document.querySelectorAll("#dock .nb-seg-btn")].find(b=>b.textContent.trim()==="Default (High)")).click()`);
  await waitFor(() => c.eval(`localStorage.getItem("turn-oai-quality:2.5")==="default"`), "2.5 quality persistence");
  await c.call("Page.reload", { ignoreCache: true });
  await waitFor(() => c.eval(`window.__mounted && document.querySelectorAll("#dock .nb-seg-btn").length>0`), "quality dock reload");
  assert.equal(await c.eval(`[...document.querySelectorAll("#dock .nb-seg-btn")].find(b=>b.textContent.trim()==="Default (High)")?.classList.contains("on")`), true, "selected 2.5 quality survives reload");
  assert.equal(await c.eval(`window.__providerCalls.length`), 0, "controls do not invoke generation");
  const screenshot = await c.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const screenshotPath = `${FIXTURE}/quality-controls.png`;
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await c.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  const mobileLayout = await c.eval(`(()=>{const d=document.documentElement;const b=document.body.getBoundingClientRect();const dock=document.querySelector("#dock").getBoundingClientRect();return {viewport:innerWidth,scrollWidth:d.scrollWidth,bodyRight:b.right,dockRight:dock.right}})()`);
  assert.ok(mobileLayout.scrollWidth <= 391 && mobileLayout.dockRight <= 391, `quality controls overflow at 390px: ${JSON.stringify(mobileLayout)}`);
  const mobileScreenshot = await c.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const mobileScreenshotPath = `${FIXTURE}/quality-controls-mobile-390.png`;
  await writeFile(mobileScreenshotPath, Buffer.from(mobileScreenshot.data, "base64"));
  console.log(`Screenshots: ${screenshotPath}, ${mobileScreenshotPath}`);
  console.log("PASS image quality dock browser fixture");
} finally {
  c?.close(); chrome.kill(); http.close();
}
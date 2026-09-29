#!/usr/bin/env node
/* render-identity.mjs — renders Kinolot's raster identity files from the ONE mark geometry
   (app/chrome.jsx KINOLOT_MARK; owner decision 2026-09-28, logo direction B "The Lot"):

     apple-touch-icon.png   180×180   the full mark on the app icon's dark ground (#0E0F12), full
                                      bleed — iOS / Android round the corners themselves
     og-image.png          1200×630   the share image: dark ground, the mark, "Kinolot" (Spectral 600),
                                      the tagline, "by Infinite Studio AI" (Space Mono)

   favicon.svg is hand-drawn (a thicker 16/32px cut of the same bays) and is not generated; pass
   --icons <dir> to render it at 16, 32 and 64px for a legibility check.

   Needs Chrome/Chromium (CHROMIUM=<path>, else the macOS Chrome or Replit's chromium) and network
   access to Google Fonts for the share image's type. Touches nothing else: no app state, no
   Supabase. scripts/test-identity.mjs checks the files it writes.

   node scripts/render-identity.mjs [--out <dir>] [--icons <dir>] */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name)=>{ const i = process.argv.indexOf(name); return i > 0 ? process.argv[i+1] : null; };
const OUT = resolve(arg("--out") || ROOT);
const ICONS = arg("--icons") ? resolve(arg("--icons")) : null;

/* the mark, read from the component every logo in the app draws */
export function readMark(src = readFileSync(join(ROOT, "app/chrome.jsx"), "utf8")){
  const m = /const KINOLOT_MARK = (Object\.freeze\(\{[\s\S]*?\n\}\));/.exec(src);
  if(!m) throw new Error("KINOLOT_MARK not found in app/chrome.jsx");
  return vm.runInNewContext("(" + m[1] + ")", { Object });
}
const INK = "#F3F1EC", GROUND = "#0E0F12";
/* the mark's paths in its 64-unit box: amber bay first, then the outer bays and baseline on top */
export function markPaths(M, ink = INK){
  return `<path d="${M.middle}" fill="${M.amber}" stroke="${M.amber}" stroke-width="${M.stroke}" stroke-linejoin="round"/>`
    + `<g fill="none" stroke="${ink}" stroke-width="${M.stroke}" stroke-linejoin="round" stroke-linecap="round">`
    + M.outer.map(d=>`<path d="${d}"/>`).join("") + `<path d="${M.base}"/></g>`;
}
/* the app icon: the mark at 78% about its own centre (bounds x 4.25–59.75, y 21.75–49.25), centred */
export function appIconSvg(M){
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${GROUND}"/>`
    + `<g transform="translate(32 32) scale(0.78) translate(-32 -35.5)">${markPaths(M)}</g></svg>`;
}
export function shareHtml(M){
  const mark = `<svg viewBox="${M.crop}" preserveAspectRatio="xMidYMax meet" width="182" height="95" aria-hidden="true">${markPaths(M)}</svg>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@500&family=Space+Mono&family=Spectral:wght@600&display=block" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden;background:${GROUND}}
  body{position:relative;color:${INK};-webkit-font-smoothing:antialiased;
    background:radial-gradient(ellipse 70% 55% at 50% 108%,rgba(242,154,67,.13),rgba(242,154,67,0) 70%),${GROUND}}
  .stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:34px}
  .lockup{display:flex;align-items:baseline;gap:30px}
  .lockup svg{display:block}
  .word{font-family:"Spectral",serif;font-weight:600;font-size:150px;line-height:1;letter-spacing:-.01em}
  .tag{margin-top:34px;font-family:"Hanken Grotesk",sans-serif;font-weight:500;font-size:40px;letter-spacing:-.005em;color:#C9C6BF}
  .by{position:absolute;left:0;right:0;bottom:50px;text-align:center;font-family:"Space Mono",monospace;font-size:22px;letter-spacing:.04em;color:#A29F98}
</style></head><body>
<div class="stage"><div class="lockup">${mark}<div class="word">Kinolot</div></div>
<div class="tag">From first idea to finished film.</div></div>
<div class="by">by Infinite Studio AI</div>
</body></html>`;
}

async function chrome(){
  const bin = [process.env.CHROMIUM, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/repl/tools/bin/chromium"].find(p=>p && existsSync(p));
  if(!bin) throw new Error("no Chrome/Chromium — set CHROMIUM=<path>");
  const dir = mkdtempSync(join(tmpdir(), "kinolot-identity-"));
  const port = 9500 + Math.floor(Math.random()*400);
  const proc = spawn(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--force-color-profile=srgb", "--remote-debugging-port="+port, "--user-data-dir="+join(dir, "profile"), "about:blank"], { stdio:"ignore" });
  const until = async (f, label, ms = 30000)=>{ const end = Date.now()+ms; while(Date.now() < end){ try{ const v = await f(); if(v) return v; }catch(e){} await new Promise(r=>setTimeout(r, 100)); } throw new Error("timeout: "+label); };
  const page = await until(async()=>(await (await fetch("http://127.0.0.1:"+port+"/json/list")).json()).find(t=>t.type==="page"), "chrome");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, bad)=>{ ws.onopen = ok; ws.onerror = bad; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (m)=>{ const x = JSON.parse(m.data); const f = waiting.get(x.id); if(f){ waiting.delete(x.id); f(x); } };
  const call = (method, params = {})=>new Promise((ok, bad)=>{ const i = ++id; waiting.set(i, x=>x.error ? bad(new Error(method+": "+x.error.message)) : ok(x.result)); ws.send(JSON.stringify({ id:i, method, params })); });
  const evaluate = async (expr)=>(await call("Runtime.evaluate", { expression:expr, returnByValue:true, awaitPromise:true })).result.value;
  await call("Page.enable");
  // transparent where a page paints nothing (the favicon's rounded corners); the icon and share image are opaque
  await call("Emulation.setDefaultBackgroundColorOverride", { color:{ r:0, g:0, b:0, a:0 } });
  return {
    async render(html, width, height, ready = "true"){
      const file = join(dir, "page-"+(++id)+".html"); writeFileSync(file, html);
      await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor:1, mobile:false });
      await call("Page.navigate", { url:"file://"+file });
      await until(()=>evaluate("document.readyState==='complete' && [...document.images].every(i=>i.complete) && ("+ready+")"), "page ready");
      const r = await call("Page.captureScreenshot", { format:"png", clip:{ x:0, y:0, width, height, scale:1 } });
      return Buffer.from(r.data, "base64");
    },
    async close(){ try{ ws.close(); }catch(e){} proc.kill("SIGKILL"); await new Promise(r=>setTimeout(r, 300)); try{ rmSync(dir, { recursive:true, force:true }); }catch(e){} },
  };
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const M = readMark();
  const b = await chrome();
  try{
    const img = (svg, s)=>`<!doctype html><html><body style="margin:0;background:transparent"><img width="${s}" height="${s}" style="display:block" src="data:image/svg+xml,${encodeURIComponent(svg)}"></body></html>`;
    mkdirSync(OUT, { recursive:true });
    writeFileSync(join(OUT, "apple-touch-icon.png"), await b.render(img(appIconSvg(M), 180), 180, 180));
    const fontsReady = `document.fonts.status==='loaded' && document.fonts.check('600 150px Spectral') && document.fonts.check('22px "Space Mono"') && document.fonts.check('500 40px "Hanken Grotesk"')`;
    writeFileSync(join(OUT, "og-image.png"), await b.render(shareHtml(M), 1200, 630, fontsReady));
    console.log("wrote", join(OUT, "apple-touch-icon.png"), "and", join(OUT, "og-image.png"));
    if(ICONS){
      mkdirSync(ICONS, { recursive:true });
      const fav = readFileSync(join(ROOT, "favicon.svg"), "utf8");
      for(const s of [16, 32, 64]) writeFileSync(join(ICONS, `favicon-${s}.png`), await b.render(img(fav, s), s, s));
      writeFileSync(join(ICONS, "app-icon-64.png"), await b.render(img(appIconSvg(M), 64), 64, 64));
      console.log("wrote favicon-16/32/64.png and app-icon-64.png to", ICONS);
    }
  } finally { await b.close(); }
}

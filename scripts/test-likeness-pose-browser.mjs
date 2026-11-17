#!/usr/bin/env node
/* test-likeness-pose-browser.mjs — the Likeness pose check on the REAL vendored face model, in headless
   Chrome (2026-10-10, owner — "it can't tell left from right").

   An isolated page on 127.0.0.1 (its own server: the repo's app/face-pose.js, app/vendor/face/v1.1.0/*,
   app/styles.css, a Babel transform of app/cameo.jsx, cached React UMD files) in a Chrome whose DNS
   resolves nothing but 127.0.0.1; every request the page makes is recorded over CDP.

     B1  turnFacePose.load() is ready in < 15 s; over load, 40 detects and close() every request stays on
         127.0.0.1 and none goes to the library's metrics host. Control: with the guard skipped
         (__turnFaceNetGuard pre-set) the metrics request IS attempted — the guard is what stops it.
         A blank frame is "no face".
     B2  the signs on the real model: Lincoln → front; Girl with a Pearl Earring (nose image-left) →
         her own right; mirrored → her own left; Mona Lisa → only a little turned
         (partial-right); Lincoln rotated 20° → a tilted head (roll)
     B3  after close(), detect() and audit() return null and don't throw
     B4  the owner's flow in the real capture window (the camera = a canvas stream of the stills):
         Lincoln → Front captured; Lincoln 12 s → the side slots stay empty; Pearl mirrored → "Your
         left" captured; held 8 s → "Your right" stays empty (and no flipped-camera offer); Pearl →
         "Your right" captured. (Her painted head is tilted ~9–11°, at the side roll limit, so the
         stills are turned a few degrees in the picture to be level — B2 measures both.)
         (2026-10-10, owner — Likeness voice guidance) a clean picture: no instruction text and no button over
         the camera; the one-line caption sits under it (shown here: no recorded clips and no device voice);
         Capture now hidden while the photo takes itself.
     B5  the recorded clips through the real audio element: a manifest + short WAV clips served as
         app/vendor/voice/frances-guide/v1/<id>.mp3 — "Hold still. Three. Two. One. Got it. Now turn …" play in
         order through one element, the caption stays hidden, closing the window stops it.

   CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/test-likeness-pose-browser.mjs */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { transformSync } from "@babel/core";

if (typeof globalThis.WebSocket === "undefined") {
  const flag = "--experimental-websocket";
  if (process.execArgv.includes(flag)) { console.error("This test needs Node's native WebSocket (Node 20+)."); process.exit(1); }
  const child = spawnSync(process.execPath, [flag, ...process.argv.slice(1)], { stdio: "inherit", env: process.env });
  process.exit(child.status == null ? 1 : child.status);
}

const ROOT = new URL("../", import.meta.url);
const CHROME = process.env.CHROMIUM || "/repl/tools/bin/chromium";
/* THE FACE MODEL'S SPEED (2026-10-13, stabilising B4/B5): the capture window treats a gap of more than 400 ms between
   camera frames as "not seen" (the hold starts again — the owner's strict hold). On the software graphics fallback
   (SwiftShader, the only one on Replit's Linux) headless Chrome runs the model at ~3 frames a second under load, with
   gaps of 400–800 ms, so the holds kept restarting and the test failed on timing, not on the app. On a Mac the real
   graphics chip (Metal through ANGLE) runs it at full speed; elsewhere SwiftShader stays. LIKENESS_POSE_GPU=swiftshader
   forces the fallback. */
const GPU_FLAGS = (process.platform === "darwin" && process.env.LIKENESS_POSE_GPU !== "swiftshader")
  ? ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]
  : ["--enable-unsafe-swiftshader"];
const CACHE = `${tmpdir()}/kinolot-likeness-pose`;
const REACT = {
  "react.js": ["https://unpkg.com/react@18.3.1/umd/react.development.js", "/tmp/fixture/browserfiles/react.js"],
  "react-dom.js": ["https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js", "/tmp/fixture/browserfiles/react-dom.js"],
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg", ".wasm": "application/wasm", ".task": "application/octet-stream" };
const METRICS = "odml.pa.googleapis.com";
const SHOTS = process.env.LIKENESS_POSE_SHOTS || "";   // a folder: screenshots of the capture window during B4
// (LIKENESS_POSE_VOICE_OFF=1: B4 with Voice off, so the screenshots show the caption under the picture)

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
}

async function prepare(){
  await mkdir(CACHE, { recursive: true });
  const files = {};
  for (const [name, [url, local]] of Object.entries(REACT)){
    let buf = null;
    for (const p of [`${CACHE}/${name}`, local]){ try { const b = await readFile(p); if (b.length > 10_000){ buf = b; break; } } catch {} }
    if (!buf){
      const r = await fetch(url);   // node fetches the UMD build once (the browser never leaves 127.0.0.1)
      if (!r.ok) throw new Error(`Could not cache ${url}: HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      await writeFile(`${CACHE}/${name}`, buf);
    }
    files["/" + name] = buf;
  }
  const cameo = transformSync(await readFile(new URL("app/cameo.jsx", ROOT), "utf8"), {
    presets: [["@babel/preset-react", { runtime: "classic" }]], plugins: ["@babel/plugin-transform-block-scoping"],
    babelrc: false, configFile: false, filename: "cameo.jsx" }).code;
  files["/app/cameo.js"] = Buffer.from(cameo);
  files["/"] = Buffer.from(PAGE);
  return files;
}

const PAGE = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pose</title>
<link rel="stylesheet" href="/app/styles.css"><style>body{background:#111;margin:0}</style></head>
<body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>
window.__fx = { errors: [], confirms: [] };
addEventListener("error", (e) => __fx.errors.push(String(e.message)));
addEventListener("unhandledrejection", (e) => __fx.errors.push(String(e.reason && (e.reason.stack || e.reason))));
if (location.search.indexOf("noguard") >= 0) window.__turnFaceNetGuard = true;   // the control: the guard is skipped
try { localStorage.setItem("turn_cameo_voice", location.search.indexOf("voiceoff") >= 0 ? "0" : "1"); } catch (e) {}   // LIKENESS_POSE_VOICE_OFF=1: the caption
window.Icon = new Proxy({}, { get: () => () => null });
window.appConfirm = async (o) => { __fx.confirms.push(o); return true; };
</script>
<script src="/app/face-pose.js"></script>
<script src="/app/cameo.js"></script>
<script>
__fx.img = {};
__fx.loadImages = async () => { for (const n of ["lincoln", "pearl", "mona"]) { const im = new Image(); im.src = "/fx/" + n + ".jpg"; await im.decode(); __fx.img[n] = im; } };
/* a still on a grey canvas: flipped (a mirror image) and/or rotated (degrees, clockwise on screen) */
__fx.still = (name, o = {}) => {
  const im = __fx.img[name], W = im.naturalWidth, H = im.naturalHeight, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d"); g.fillStyle = "#808080"; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); if (o.rotate) g.rotate(o.rotate * Math.PI / 180); if (o.flip) g.scale(-1, 1);
  g.drawImage(im, -W / 2, -H / 2);
  return c;
};
__fx.summary = (o) => {
  const p = o && o.primary, c = turnFacePose.classifyPose(p && p.pose, null);
  return { faces: o ? o.faces : null, yaw: p ? +p.pose.yaw.toFixed(1) : null, pitch: p ? +p.pose.pitch.toFixed(1) : null,
    roll: p ? +p.pose.roll.toFixed(1) : null, yawL: p && p.yawL != null ? +p.yawL.toFixed(1) : null, src: p ? p.pose.src : null, cls: c.cls, base: c.base, tilt: c.tilt };
};
/* B4: the camera is a canvas stream of the current still, the face placed in the ring */
__fx.camera = async () => {
  const eng = await turnFacePose.load(), place = {};
  for (const n of ["lincoln", "pearl"]) {
    const o = eng.audit(__fx.still(n)); const p = o.primary, im = __fx.img[n];
    const k = Math.min(1, 640 / Math.max(im.naturalWidth, im.naturalHeight));
    place[n] = { cx: (p.bboxPx.x + p.bboxPx.w / 2) / k, cy: (p.bboxPx.y + p.bboxPx.h / 2) / k, h: p.faceH * Math.min(im.naturalWidth, im.naturalHeight) };
  }
  eng.close();
  const sc = document.createElement("canvas"); sc.width = 1280; sc.height = 720;
  const g = sc.getContext("2d");
  __fx.scene = { name: "lincoln", flip: false, rotate: 0 };
  const draw = () => {
    const s = __fx.scene, im = __fx.img[s.name], p = place[s.name], k = 0.5 * 720 / p.h;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#808080"; g.fillRect(0, 0, 1280, 720);
    g.translate(640, 331); if (s.rotate) g.rotate(s.rotate * Math.PI / 180); if (s.flip) g.scale(-1, 1);
    g.drawImage(im, -p.cx * k, -p.cy * k, im.naturalWidth * k, im.naturalHeight * k);
  };
  draw(); setInterval(draw, 33);
  const stream = sc.captureStream(30);
  const gum = async () => stream;
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = gum;
  else Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum } });
  return place;
};
/* (2026-11-17) the window opens on "Whose likeness is this?": answered the way a person does — Me, the box, Start the
   camera — before anything else; __fx.who records what was on screen before the answer */
__fx.osc = 0;
if (window.AudioContext) { const co = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function(){ __fx.osc++; return co.call(this); }; }
__fx.mount = async () => {
  __fx.root = ReactDOM.createRoot(document.getElementById("root"));
  __fx.root.render(React.createElement(CameoModal, { character: { id: "neo", name: "Neo" }, onClose: () => {}, onSaved: () => {} }));
  const until = async (f) => { for (let i = 0; i < 200; i++){ const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } throw new Error("the first step did not appear"); };
  const q = (s) => document.querySelector(s);
  const start = await until(() => q('[data-role="start"]'));
  __fx.who = { step: (q("[data-step]") || { dataset: {} }).dataset.step, question: (q(".cameo-whose-q") || {}).textContent || "", startDisabled: start.disabled, video: !!q("video") };
  q('[data-subject="self"]').click();
  (await until(() => q('[data-role="consent-box"]'))).click();
  (await until(() => { const b = q('[data-role="start"]'); return b && !b.disabled ? b : null; })).click();
  await until(() => q(".cameo-stage"));
};
__fx.plays = []; __fx.blobIds = new Map(); __fx.urlIds = {}; __fx.utter = [];
if (window.speechSynthesis) { const s0 = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { __fx.utter.push(u.text); return s0(u); }; }
{ const f0 = window.fetch.bind(window);
  window.fetch = async (u, o) => { const r = await f0(u, o); const s = String(u && u.url || u);
    if (/\.mp3$/.test(s)) { const ob = r.blob.bind(r); r.blob = async () => { const b = await ob(); __fx.blobIds.set(b, s.split("/").pop().replace(".mp3", "")); return b; }; }
    return r; };
  const c0 = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = c0(b); if (__fx.blobIds.has(b)) __fx.urlIds[u] = __fx.blobIds.get(b); return u; };
  const p0 = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = function(){ __fx.plays.push({ id: __fx.urlIds[this.src] || this.src, muted: this.muted, t: Math.round(performance.now()) });
    __fx.audioEls = __fx.audioEls || new Set();
    if (!__fx.audioEls.has(this)) { __fx.audioEls.add(this); for (const ev of ["ended", "error", "pause", "playing", "abort"]) this.addEventListener(ev, () => (__fx.ev = __fx.ev || []).push(ev + ":" + (__fx.urlIds[this.src] || this.src) + "@" + Math.round(performance.now()))); }
    const pr = p0.call(this); pr.catch((e) => (__fx.ev = __fx.ev || []).push("reject:" + e.name)); return pr; };
}
__fx.state = () => {
  const q = (s) => document.querySelector(s);
  const cue = q(".cameo-caption"), stage = q(".cameo-stage"), r = (el) => el ? el.getBoundingClientRect() : null;
  const t = cue ? cue.querySelector(".cameo-caption-t") : null;
  return { engine: stage ? stage.dataset.engine : null,
    cue: cue ? cue.dataset.cue : null, cueText: t ? t.textContent : "", captionShown: !!cue && !cue.hidden && cue.offsetParent !== null,
    captionBelow: !!cue && !stage.contains(cue) && (cue.hidden || r(cue).top >= r(stage).bottom - 0.5),
    stageText: stage ? stage.innerText.replace(/[ \\n\\t]+/g, " ").trim() : "", stageButtons: stage ? stage.querySelectorAll("button").length : 0,
    capNow: !!q('[data-role="capture-now"]'),
    front: !!q('[data-angle="front"] img'), left: !!q('[data-angle="left"] img'), right: !!q('[data-angle="right"] img'),
    ring: (q(".cameo-ring") || { dataset: {} }).dataset.progress || null, flipFix: !!q('[data-role="flip-fix"]') };
};
</script></body></html>`;

function server(files, served){
  return createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    served.push(path);
    try {
      let body = files[path], type = TYPES[path.slice(path.lastIndexOf("."))] || "text/html; charset=utf-8";
      if (!body && served.clips && /^\/app\/vendor\/voice\/frances-guide\/v2\//.test(path)){
        const name = path.split("/").pop();
        if (name === "manifest.json"){ body = Buffer.from(JSON.stringify(served.clips.manifest)); type = "application/json"; }
        else if (/^[a-z0-9-]+\.mp3$/.test(name) && served.clips.manifest.clips[name.slice(0, -4)]){ body = served.clips.wav; type = "audio/wav"; }
      }
      if (!body){
        if (/^\/app\/(face-pose\.js|styles\.css|vendor\/face\/v1\.1\.0\/[a-z_.]+)$/.test(path)) body = await readFile(new URL("." + path, ROOT));
        else if (/^\/fx\/[a-z]+\.jpg$/.test(path)) body = await readFile(new URL("scripts/fixtures/likeness-pose/" + path.slice(4), ROOT));
      }
      if (!body){ res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
}

class CDP {
  constructor(ws){ this.ws = ws; this.seq = 0; this.pending = new Map(); this.events = []; }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    const c = new CDP(ws);
    ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)){ const [ok, bad] = c.pending.get(m.id); c.pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
      else if (m.method) c.events.push(m); };
    return c;
  }
  call(method, params = {}){ const id = ++this.seq; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((a, b) => this.pending.set(id, [a, b])); }
  async eval(expression){
    const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  requests(){ return this.events.filter((m) => m.method === "Network.requestWillBeSent").map((m) => m.params.request.url); }
  close(){ this.ws.close(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* a short silent WAV (8 kHz mono, 16-bit) — stands in for a recorded clip */
function silentWav(ms){
  const n = Math.round(8000 * ms / 1000), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
async function waitFor(fn, label, ms = 10_000){
  const end = Date.now() + ms; let last;
  while (Date.now() < end){ try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${JSON.stringify(last)}` : ""}`);
}
const hostOf = (u) => { try { const x = new URL(u); return (x.protocol === "data:" || x.protocol === "blob:") ? "local" : x.hostname; } catch { return u; } };

async function main(){
  const files = await prepare();
  const served = [];
  const srv = server(files, served);
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port, debugPort = 9300 + Math.floor(Math.random() * 400);
  const profile = `${CACHE}/chrome-profile-${process.pid}`;
  // no --disable-gpu: the face model needs WebGL even on its CPU path
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", ...GPU_FLAGS, "--autoplay-policy=no-user-gesture-required",
    `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let c;
  try {
    const target = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`); if (!r.ok) return null;
      return (await r.json()).find((x) => x.type === "page" && x.webSocketDebuggerUrl);
    }, "Chrome page target");
    c = await CDP.connect(target.webSocketDebuggerUrl);
    await c.call("Page.enable"); await c.call("Runtime.enable"); await c.call("Network.enable");
    const open = async (q = "") => {
      c.events.length = 0;
      await c.call("Page.navigate", { url: `http://127.0.0.1:${port}/${q}` });
      await waitFor(() => c.eval(`!!(window.turnFacePose && window.CameoModal && window.__fx)`), "the page");
      await c.eval(`__fx.loadImages()`);
    };

    await test("B1 the vendored model loads from this site only (< 15 s); load + 40 detects + close send nothing anywhere else — the guard stops the metrics request", async () => {
      await open();
      const r = await c.eval(`(async () => {
        const t0 = performance.now(); const eng = await turnFacePose.load(); const ms = performance.now() - t0;
        const faces = []; for (let i = 0; i < 20; i++) faces.push(eng.audit(__fx.still("lincoln")).faces);
        const blank = document.createElement("canvas"); blank.width = 640; blank.height = 480; blank.getContext("2d").fillStyle = "#777"; blank.getContext("2d").fillRect(0, 0, 640, 480);
        const none = eng.audit(blank);
        eng.close();
        return { ms, faces, none: { faces: none.faces, primary: none.primary }, guard: window.__turnFaceNetGuard === true };
      })()`);
      console.log("     load", Math.round(r.ms), "ms");
      assert.ok(r.ms < 15000, "ready in " + r.ms + " ms");
      assert.ok(r.faces.every((n) => n === 1), JSON.stringify(r.faces));
      assert.deepEqual(r.none, { faces: 0, primary: null }, "a blank frame: no face");
      assert.equal(r.guard, true);
      await sleep(2500);
      const reqs = c.requests();
      const off = reqs.filter((u) => !["127.0.0.1", "local"].includes(hostOf(u)));
      assert.deepEqual(off, [], "every request on 127.0.0.1");
      assert.ok(reqs.some((u) => u.endsWith("/app/vendor/face/v1.1.0/vision_wasm_internal.wasm")) && reqs.some((u) => u.endsWith("/face_landmarker.task")));
      // the control: the same page with the guard skipped tries to reach the metrics host
      await open("?noguard");
      await c.eval(`(async () => { const eng = await turnFacePose.load(); eng.audit(__fx.still("lincoln")); eng.close(); })()`);
      await waitFor(() => c.requests().some((u) => hostOf(u) === METRICS), "the metrics attempt without the guard", 8000);
    });

    await test("B2 left and right on the real model: Lincoln front; Pearl her own right, mirrored her own left; Mona a little turned; Lincoln rotated 20° tilted", async () => {
      await open();
      const r = await c.eval(`(async () => {
        const eng = await turnFacePose.load(), S = (n, o) => __fx.summary(eng.audit(__fx.still(n, o)));
        // (the painting as it is: turning it in the image plane to cancel its −8.8° roll ALSO moves the
        // measured pitch to ~16° on a three-quarter face — logged, not asserted)
        const out = { lincoln: S("lincoln"), pearl: S("pearl"), pearlMirror: S("pearl", { flip: true }),
          pearlTurned: S("pearl", { rotate: -8.8 }), mona: S("mona"), lincolnTilt: S("lincoln", { rotate: 20 }),
          // her painted head is tilted ~9–11°: turned a few degrees in the picture it is level enough for the side limits
          pearlLevel: S("pearl", { rotate: -2 }), pearlMirrorLevel: S("pearl", { flip: true, rotate: 4 }) };
        eng.close(); return out;
      })()`);
      for (const [k, v] of Object.entries(r)) console.log("     " + k.padEnd(12), JSON.stringify(v));
      assert.equal(r.lincoln.cls, "front"); assert.equal(r.lincoln.src, "matrix");
      // her head is also tilted ~9–11° in the painting (on the side roll limit), so the yaw class is what's pinned
      assert.equal(r.pearl.base, "right", "her nose points image-left: turned to her OWN right");
      assert.ok(r.pearl.yaw < -25 && r.pearl.yawL < 0 && Math.abs(r.pearl.yaw - r.pearl.yawL) < 8);
      assert.equal(r.pearlMirror.base, "left", "the mirror image: her own left");
      assert.ok(r.pearlMirror.yaw > 25 && r.pearlMirror.yawL > 0 && Math.abs(r.pearlMirror.yaw - r.pearlMirror.yawL) < 8);
      assert.ok(["right", "tilted"].includes(r.pearl.cls) && ["left", "tilted"].includes(r.pearlMirror.cls));
      assert.equal(r.pearlTurned.base, "right", "still her own right when the picture is turned");
      assert.equal(r.mona.base, "partial-right");
      assert.equal(r.pearlLevel.cls, "right", "level: her own right, within every side limit");
      assert.equal(r.pearlMirrorLevel.cls, "left", "level, mirrored: her own left");
      assert.equal(r.lincolnTilt.cls, "tilted"); assert.equal(r.lincolnTilt.tilt, "roll"); assert.ok(r.lincolnTilt.roll < -12, "clockwise on screen = negative roll");
    });

    await test("B3 after close(), detect() and audit() return null and never throw", async () => {
      const r = await c.eval(`(async () => {
        const eng = await turnFacePose.load(); eng.audit(__fx.still("lincoln")); eng.close();
        const v = document.createElement("video");
        let threw = null, d, a;
        try { d = eng.detect(v, performance.now()); a = eng.audit(__fx.still("lincoln")); } catch (e) { threw = String(e); }
        return { threw, d, a, closed: eng.closed };
      })()`);
      assert.deepEqual(r, { threw: null, d: null, a: null, closed: true });
    });

    await test("B4 the owner's flow in the real capture window: Front; a still front face fills no side slot; mirrored Pearl → 'Your left'; held → 'Your right' stays empty; Pearl → 'Your right'", async () => {
      await c.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
      await open(process.env.LIKENESS_POSE_VOICE_OFF ? "?voiceoff" : "");
      const place = await c.eval(`__fx.camera()`);
      assert.ok(place.lincoln.h > 50 && place.pearl.h > 50, JSON.stringify(place));
      c.events.length = 0;
      await c.eval(`__fx.mount()`);
      // whose face comes first: the question, before any camera picture
      assert.deepEqual(await c.eval(`__fx.who`), { step: "who", question: "Whose likeness is this?", startDisabled: true, video: false });
      await waitFor(async () => (await c.eval(`__fx.state()`)).engine === "ready", "the pose check ready", 20000);
      const st = () => c.eval(`__fx.state()`);
      // a clean picture: no instruction and no button over the camera; the line under it; no Capture now while it takes itself
      const s0 = await st();
      assert.equal(s0.stageButtons, 0, "no button on the picture");
      assert.match(s0.stageText, /^Next: look straight ahead\b/i, "the badge: " + s0.stageText);
      // the badge names the next photo in plain words; no correction or instruction is written over the picture
      assert.ok(!/hold|turn your|center|closer|light|chin|further/i.test(s0.stageText.replace(/^Next: look straight ahead/i, "")), "no instruction over the picture: " + s0.stageText);
      assert.equal(s0.captionBelow, true, "the caption sits under the picture"); assert.equal(s0.capNow, false, "the photo takes itself: no Capture now");
      const shot = async (name) => {
        if (!SHOTS) return;
        await mkdir(SHOTS, { recursive: true });
        const r = await c.call("Page.captureScreenshot", { format: "png" });
        await writeFile(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64"));
      };
      const t0 = Date.now();
      await sleep(1500); await shot("1-front-holding");
      await waitFor(async () => (await st()).front, "Front captured", 9000);
      console.log("     Front after", Date.now() - t0, "ms");
      await sleep(12000);
      await shot("2-left-not-turned");
      let s = await st();
      assert.equal(s.left, false, "left stays empty: " + JSON.stringify(s)); assert.equal(s.right, false);
      assert.equal(s.cue, "not-turned", JSON.stringify(s));
      await c.eval(`__fx.scene = { name: "pearl", flip: true, rotate: 4 }`);
      const t1 = Date.now();
      await sleep(2500); await shot("3-left-holding");
      await c.eval(`(() => { __fx.gaps = []; let last = performance.now(); const f = (t) => { __fx.gaps.push(Math.round(t - last)); last = t; if (__fx.gaps.length < 2000) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
      await waitFor(async () => (await st()).left, "'Your left' captured", 9000).catch(async (e) => { console.log("     state", JSON.stringify(await st()), "\n     rAF gaps > 300 ms:", JSON.stringify(await c.eval(`__fx.gaps.filter((g) => g > 300)`)), "frames", await c.eval(`__fx.gaps.length`)); throw e; });
      const dl = Date.now() - t1;
      { const g = await c.eval(`__fx.gaps`); console.log("     frames during the left hold:", g.length, "· gaps over 400 ms:", g.filter((x) => x > 400).length); }
      console.log("     left after", dl, "ms");
      assert.ok(dl >= 2000, "held for a moment (2 s) first: " + dl);
      await sleep(8000);
      await shot("4-right-wrong-way");
      s = await st();
      assert.equal(s.right, false, "held at her left, the right slot stays empty");
      assert.equal(s.cue, "wrong-way", JSON.stringify(s));
      assert.match(s.cueText, /That's your left — turn the other way, to your right/i);
      assert.equal(s.stageButtons, 0); assert.ok(!/That's your/.test(s.stageText), "the warning isn't over the picture");
      assert.equal(s.flipFix, false, "holding the pose just photographed is no flipped camera: nothing offered");
      await c.eval(`__fx.scene = { name: "pearl", flip: false, rotate: -2 }`);
      const t2 = Date.now();
      await waitFor(async () => (await st()).right, "'Your right' captured", 9000);
      console.log("     right after", Date.now() - t2, "ms");
      await waitFor(async () => (await st()).cue === "complete", "all three done", 3000);
      await shot("5-complete");
      if (SHOTS){   // the same window on a phone-sized screen
        await c.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await c.eval(`(() => { const b = document.querySelector('[data-angle="right"] .cameo-slot-x'); if (b) b.click(); })()`);
        await sleep(1500); await shot("6-phone-right");
        await c.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
        await waitFor(async () => (await st()).right, "'Your right' again", 9000);
        await waitFor(async () => (await st()).cue === "complete", "all three done again", 3000);
      }
      s = await st();
      assert.equal(s.cue, "complete", JSON.stringify(s));
      const errs = await c.eval(`__fx.errors`);
      assert.deepEqual(errs, [], "no page errors");
      const off = c.requests().filter((u) => !["127.0.0.1", "local"].includes(hostOf(u)));
      assert.deepEqual(off, [], "nothing left this machine during the capture");
    });

    await test("B5 the recorded clips through the real audio element: one element plays 'Hold still', then — after the tone of the photo, with nothing counted — 'Got it. Now turn …'; the device voice isn't used; the caption stays hidden; closing the window stops it", async () => {
      const lines = await c.eval(`turnFacePose.VOICE_LINES`);
      served.clips = { manifest: { voice: "test", clips: Object.fromEntries(lines.map((l) => [l.id, { text: l.text }])) }, wav: silentWav(250) };
      await open();
      await c.eval(`__fx.camera()`);
      // WAKE THE AUDIO OUTPUT FIRST (2026-10-13, stabilising B5): headless Chrome can take 3 s or more to start its
      // audio output the first time anything plays, so the window's first clip ("Hold still") sometimes hadn't begun
      // when the 3 s Front hold ended — the numbers queued behind it were then (rightly) dropped. A short tone through
      // Web Audio (not an <audio> element, so the window's one-element check still sees only its own) starts the
      // output before the window opens; a real browser's output is already running.
      await c.eval(`(async () => { const ac = new AudioContext(); await ac.resume(); const o = ac.createOscillator(), g = ac.createGain();
        g.gain.value = 0.0001; o.connect(g); g.connect(ac.destination); o.start(); await new Promise((r) => setTimeout(r, 600)); o.stop(); await ac.close(); })()`);
      await c.eval(`__fx.mount()`);
      const osc0 = await c.eval(`__fx.osc`);
      await waitFor(async () => (await c.eval(`__fx.state()`)).engine === "ready", "the pose check ready", 20000);
      await waitFor(async () => (await c.eval(`__fx.state()`)).front, "Front captured", 9000);
      await sleep(2500);
      const r = await c.eval(`({ plays: __fx.plays.filter((p) => !p.muted).map((p) => p.id), els: (__fx.audioEls || new Set()).size, utter: __fx.utter.slice(), st: __fx.state(), osc: __fx.osc })`);
      console.log("     clips", r.plays.join(" "));
      const ev = JSON.stringify(await c.eval(`__fx.ev || []`));
      // in order, one at a time: the hold line, then (the tone,) "Got it. Now turn …" — and no number anywhere
      const i = r.plays.indexOf("hold-still"), g = r.plays.indexOf("got-it");
      assert.ok(i >= 0 && g > i, r.plays.join(" ") + " " + ev);
      assert.ok(!r.plays.some((id) => /^(one|two|three|four|five)$/.test(id)), "nothing is counted: " + r.plays.join(" "));
      assert.ok(r.osc - osc0 >= 2, "the two notes of the photo's tone were made (" + (r.osc - osc0) + ")");
      assert.deepEqual(r.plays.slice(g, g + 2), ["got-it", "turn-left"], ev);
      assert.equal(r.els, 1, "one audio element"); assert.deepEqual(r.utter, [], "the device voice isn't needed");
      assert.equal(r.st.captionShown, false, "spoken: no caption");
      await c.eval(`__fx.root.unmount()`);
      const n = r.plays.length;
      await sleep(1500);
      const after = await c.eval(`({ n: __fx.plays.filter((p) => !p.muted).length, paused: [...(__fx.audioEls || [])].every((a) => a.paused) })`);
      assert.equal(after.paused, true, "closed: stopped"); assert.ok(after.n <= n + 1, "nothing more after close");
      const errs = await c.eval(`__fx.errors`);
      assert.deepEqual(errs, [], "no page errors");
      served.clips = null;
    });
  } finally {
    try { c && c.close(); } catch {}
    try { chrome.kill("SIGKILL"); } catch {}
    srv.close();
  }
  console.log(`${checks} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

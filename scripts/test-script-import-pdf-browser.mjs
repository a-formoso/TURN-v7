#!/usr/bin/env node
/* test-script-import-pdf-browser.mjs — IMPORT A SCREENPLAY, phase 5 (owner 2026-10-18): a REAL PDF through the app's
   own reader in headless Chrome. No app server, no provider, no account.
   1. A screenplay laid out the standard way (Courier 12, the usual indents, a title page, scene numbers in both
      margins, page numbers in the header, a revision asterisk, a speech carried over a page break with (MORE) and
      (CONT'D), a transition, dual dialogue) is printed to PDF by Chrome itself; ScriptImport.parseFile reads it back
      through the self-hosted pdf.js (app/vendor/pdfjs/, a module worker): every block's kind and words come out as
      written, the furniture comes off, the title page gives the title, author and draft date.
   2. A PDF of page IMAGES (no text layer) is a scan: parseFile says so; readScan renders each page to a JPEG and asks
      the vision call (stubbed here) page by page, and fromScan joins the pages (a speech over the page break goes on).
   CHROMIUM=/path/to/chrome overrides the browser.
   node scripts/test-script-import-pdf-browser.mjs */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";

if (typeof globalThis.WebSocket === "undefined") {
  const flag = "--experimental-websocket";
  if (process.execArgv.includes(flag)) { console.error("This browser test needs Node's native WebSocket."); process.exit(1); }
  const child = spawnSync(process.execPath, [flag, ...process.argv.slice(1)], { stdio: "inherit", env: process.env });
  process.exit(child.status == null ? 1 : child.status);
}

const FIXTURE = `/tmp/script-import-pdf-${process.pid}`;
const CHROME = process.env.CHROMIUM || "/repl/tools/bin/chromium";
const src = (p) => new URL("../" + p, import.meta.url);
const PDFJS = "app/vendor/pdfjs/v4.10.38/";

/* the screenplay, as blocks — what the PDF must read back as */
const SCRIPT = [
  { n: "1", h: "INT. KITCHEN - NIGHT" },
  { t: "action", x: "Maya pours coffee into two mugs. One stays full. She waits by the window while the rain runs down the glass in long grey threads." },
  { t: "char", x: "MAYA" }, { t: "paren", x: "(quietly)" },
  { t: "dia", x: "He isn't coming. He never was the kind to come back, not once in eleven years." },
  { t: "action", x: "The kettle clicks off.", rev: true },
  { t: "char", x: "MAYA" },
  { t: "dia", x: "I'll go myself.", more: "Tonight, before the last bus." },
  { t: "trans", x: "CUT TO:" },
  { n: "2", h: "EXT. STREET - DAY" },
  { t: "action", x: "Rain on the windscreen. Maya waits at the lights." },
  { dual: [["MAYA", "Wait!"], ["NURSE", "Go home."]] },
  { n: "3", h: "INT. BUS - DAY" },
  { t: "action", x: "Maya sits at the back with her bag on her knees." },
];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function screenplayHtml() {
  const body = SCRIPT.map((b) => {
    if (b.h) return `<p class="h"><span class="n">${b.n}</span>${esc(b.h)}<span class="m">${b.n}</span></p>`;
    if (b.dual) return `<div class="dual">${b.dual.map(([c, d]) => `<div><p class="dc">${c}</p><p class="dd">${esc(d)}</p></div>`).join("")}</div>`;
    if (b.t === "action") return `<p class="a">${esc(b.x)}${b.rev ? '<span class="rev">*</span>' : ""}</p>`;
    if (b.t === "char") return `<p class="c">${esc(b.x)}</p>`;
    if (b.t === "paren") return `<p class="p">${esc(b.x)}</p>`;
    if (b.t === "trans") return `<p class="t">${esc(b.x)}</p>`;
    if (b.t === "dia" && b.more) return `<p class="d">${esc(b.x)}</p><p class="c">(MORE)</p><div class="brk"></div><p class="c">MAYA (CONT'D)</p><p class="d">${esc(b.more)}</p><div class="gap"></div>`;
    if (b.t === "dia") return `<p class="d">${esc(b.x)}</p><div class="gap"></div>`;
    return "";
  }).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>script</title><style>
  html,body{margin:0;padding:0} body{padding:0 .5in 0 .75in;font:12pt/12pt "Courier New",Courier,monospace;color:#000}
  p{margin:0;white-space:pre-wrap} .a,.h,.t{margin-bottom:12pt} .h{position:relative}
  .h .n{position:absolute;left:-0.75in} .h .m{position:absolute;right:-0.45in} .a{position:relative} .rev{position:absolute;right:-0.35in}
  .c{margin-left:2.2in} .p{margin-left:1.6in;width:2in} .d{margin-left:1in;width:3.5in} .gap{height:12pt} .t{text-align:right}
  .title{height:9in;text-align:center;padding-top:3in;box-sizing:border-box;break-after:page} .title p{margin-bottom:12pt}
  .brk{break-before:page} .dual{display:flex;margin-bottom:12pt} .dual>div{width:3in} .dc{margin-left:1in} .dd{margin-left:.2in;width:2.4in}
  </style><body><div class="title"><p>THE LAST BUS</p><p>Written by</p><p>Ada Lovelace</p><p style="margin-top:3in;text-align:left">Draft 2 - 10 October 2026</p></div>
  ${body}<script>window.__ready=true</script></body>`;
}
// a "scanned" script: two pages that are only pictures of text
const scanHtml = `<!doctype html><meta charset="utf-8"><title>scan</title><style>html,body{margin:0} img{display:block;width:6in;height:9in;break-after:page}</style><body><script>
  const draw = (lines)=>{ const c=document.createElement("canvas"); c.width=900; c.height=1350; const x=c.getContext("2d"); x.fillStyle="#fff"; x.fillRect(0,0,900,1350);
    x.fillStyle="#000"; x.font="22px Courier New"; lines.forEach((l,i)=>x.fillText(l,60,80+i*28)); return c.toDataURL("image/png"); };
  const pages=[["INT. KITCHEN - NIGHT","","Maya waits.","","          MAYA","     He isn't coming."],["          MAYA (CONT'D)","     He never was.","","EXT. STREET - DAY"]];
  let left=pages.length; pages.forEach(p=>{ const im=new Image(); im.onload=()=>{ if(--left===0) window.__ready=true; }; im.src=draw(p); document.body.appendChild(im); });
</script></body>`;

async function prepare() {
  await mkdir(`${FIXTURE}/${PDFJS}`, { recursive: true });
  for (const f of ["pdf.min.js", "pdf.worker.min.js"]) await copyFile(src(PDFJS + f), `${FIXTURE}/${PDFJS}${f}`);
  for (const f of ["app/script-import.js", "app/script-import-pages.js", "app/script-read.js"]) await copyFile(src(f), `${FIXTURE}/${f}`);
  await writeFile(`${FIXTURE}/screenplay.html`, screenplayHtml());
  await writeFile(`${FIXTURE}/scan.html`, scanHtml);
  await writeFile(`${FIXTURE}/index.html`, `<!doctype html><meta charset="utf-8"><title>import</title><body>
<script src="/app/script-import.js"></script><script src="/app/script-import-pages.js"></script><script src="/app/script-read.js"></script>
<script>window.__ready = true;</script></body>`);
}
function server() {
  return createServer(async (req, res) => {
    const name = new URL(req.url, "http://fixture").pathname.slice(1) || "index.html";
    if (!/^[a-z0-9._/-]+$/i.test(name) || name.includes("..")) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(`${FIXTURE}/${name}`);
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".pdf") ? "application/pdf" : "text/javascript";
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
async function waitFor(fn, label) { for (let i = 0; i < 250; i++) { if (await fn()) return; await sleep(40); } throw new Error("Timed out waiting for " + label); }

let checks = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

await prepare();
const http = server();
await new Promise((ok) => http.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${http.address().port}`;
const port = 9800 + Math.floor(Math.random() * 300);
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
  const open = async (path) => { await c.call("Page.navigate", { url: base + path }); await waitFor(() => c.eval("window.__ready===true").catch(() => false), path); };

  // Chrome prints the two PDFs
  await open("/screenplay.html");
  const pdf = await c.call("Page.printToPDF", { paperWidth: 8.5, paperHeight: 11, marginTop: 1, marginBottom: 1, marginLeft: 0.75, marginRight: 0.5,
    displayHeaderFooter: true, footerTemplate: "<div></div>",
    headerTemplate: `<div style="font:12pt 'Courier New',monospace;width:100%;text-align:right;padding-right:1in;margin-top:.45in"><span class="pageNumber"></span>.</div>` });
  await writeFile(`${FIXTURE}/script.pdf`, Buffer.from(pdf.data, "base64"));
  await open("/scan.html");
  const scan = await c.call("Page.printToPDF", { paperWidth: 8.5, paperHeight: 11, marginTop: 1, marginBottom: 1, marginLeft: 1.25, marginRight: 1.25 });
  await writeFile(`${FIXTURE}/scan.pdf`, Buffer.from(scan.data, "base64"));

  await open("/index.html");
  if (process.env.DUMP) console.log(JSON.stringify(await c.eval(`(async()=>{ const { pages } = await ScriptPages.pdfText(await (await fetch("/script.pdf")).arrayBuffer());
    return pages.slice(1,3).map((p,i)=>ScriptPages.pageLines(p,i+1).map(l=>[Math.round(l.y), l.segs.map(s=>Math.round(s.x)+":"+s.text)])); })()`), null, 0));
  const r = await c.eval(`(async()=>{
    const file = new File([await (await fetch("/script.pdf")).arrayBuffer()], "The Last Bus.pdf", { type:"application/pdf" });
    const p = await ScriptImport.parseFile(file);
    return { source:p.source, title:p.title, author:p.author, draftDate:p.draftDate, warnings:p.warnings, pageCount:p.pageCount, notes:p.notes,
      scenes:p.scenes.map(s=>({ heading:s.heading, number:s.number, opening:!!s.opening, blocks:s.blocks.map(b=>[b.type, b.text, !!b.dual, !!b.unsure]) })),
      characters:p.characters.map(x=>x.cue) };
  })()`);

  await test("1 a printed PDF: the title page gives the title, the author and the draft date", () => {
    assert.equal(r.source, "pdf");
    assert.ok(r.pageCount >= 3, "title page + 2 pages (" + r.pageCount + ")");
    assert.equal(r.title, "THE LAST BUS");
    assert.equal(r.author, "Ada Lovelace");
    assert.match(r.draftDate, /Draft 2/);
  });
  await test("1 every block's kind and words come back as written; the scene numbers from the margin", () => {
    const want = []; let sc = null;
    SCRIPT.forEach((b) => {
      if (b.h) { sc = { heading: b.h, number: b.n, blocks: [["scene", b.h, false, false]] }; want.push(sc); return; }
      if (b.dual) { sc.blocks.push(["char", b.dual[0][0], false, false], ["dia", b.dual[0][1], false, false], ["char", b.dual[1][0], true, false], ["dia", b.dual[1][1], false, false]); return; }
      sc.blocks.push([b.t, b.more ? b.x + " " + b.more : b.x, false, false]);
    });
    assert.ok(!r.scenes.some((s) => s.opening), "nothing before the first heading: " + JSON.stringify(r.scenes[0]));
    assert.deepEqual(r.scenes.map((s) => s.heading), want.map((s) => s.heading));
    assert.deepEqual(r.scenes.map((s) => s.number), ["1", "2", "3"]);
    r.scenes.forEach((s, i) => assert.deepEqual(s.blocks, want[i].blocks, "scene " + (i + 1)));
  });
  await test("1 the furniture comes off: page numbers, (MORE), the repeated (CONT'D) cue, the revision mark", () => {
    const all = r.scenes.flatMap((s) => s.blocks.map((b) => b[1])).join(" | ");
    assert.doesNotMatch(all, /\(MORE\)|CONT'D|\*|(^|\| )\d+\.( \||$)/);
    assert.ok(r.warnings.some((w) => /revision marks/.test(w)), JSON.stringify(r.warnings));
    assert.deepEqual(r.characters.sort(), ["MAYA", "NURSE"]);
  });

  const s = await c.eval(`(async()=>{
    const buf = await (await fetch("/scan.pdf")).arrayBuffer();
    const p = await ScriptImport.parseFile(new File([buf], "scan.pdf", { type:"application/pdf" }));
    const seen = [];
    window.sbClient = ()=>({ functions:{} });   // signed in (the vision call itself is stubbed)
    window.aiVisionComplete = async (messages, images, opts)=>{
      const im = new Image(); im.src = images[0]; await im.decode();
      seen.push({ prompt:messages[0].content, kind:images[0].slice(0, 22), w:im.naturalWidth, h:im.naturalHeight, modelId:opts && opts.modelId });
      return { vision:true, text: seen.length===1 ? "INT. KITCHEN - NIGHT\\n\\nMaya waits.\\n\\nMAYA\\nHe isn't coming." : "MAYA (CONT'D)\\nHe never was.\\n\\nEXT. STREET - DAY" };
    };
    let stopAt = 1, pages = [];
    const first = await ScriptPages.readScan(buf, { modelId:"gemini-4-argon", onPage:(n)=>pages.push(n), shouldStop:()=>pages.length>=stopAt });
    const rest = await ScriptPages.readScan(buf, { modelId:"gemini-4-argon", prior:first.texts, onPage:(n)=>pages.push(n) });
    const f = ScriptPages.fromScan(rest.texts, "scan.pdf");
    const est = ScriptPages.scanEstimate(p.pageCount, "gemini-4-argon");
    return { scanned:!!p.scanned, pageCount:p.pageCount, firstDone:first.done, restDone:rest.done, pages, seen, est,
      blocks:f.scenes.map(sc=>sc.blocks.map(b=>[b.type,b.text])), warnings:f.warnings, source:f.source };
  })()`);
  await test("2 a PDF of page images is a scan, read page by page with the vision call (stoppable, resumable)", () => {
    assert.equal(s.scanned, true);
    assert.equal(s.pageCount, 2);
    assert.equal(s.firstDone, false, "stopped after page 1");
    assert.equal(s.restDone, true);
    assert.deepEqual(s.pages, [1, 2], "each page read once");
    assert.equal(s.seen.length, 2);
    s.seen.forEach((x) => { assert.equal(x.kind, "data:image/jpeg;base64"); assert.ok(x.w >= 1400 && x.w <= 1600, "page width " + x.w); assert.ok(x.h > x.w); assert.equal(x.modelId, "gemini-4-argon"); });
    assert.match(s.seen[0].prompt, /word for word/i);
    assert.match(s.seen[1].prompt, /page 2 of 2/);
  });
  await test("2 the pages join: a speech over the page break goes on, the transcription is labelled", () => {
    assert.equal(s.source, "pdf-scan");
    assert.deepEqual(s.blocks, [
      [["scene", "INT. KITCHEN - NIGHT"], ["action", "Maya waits."], ["char", "MAYA"], ["dia", "He isn't coming. He never was."]],
      [["scene", "EXT. STREET - DAY"]],
    ]);
    assert.match(s.warnings[0], /transcription/);
    assert.ok(s.est.lo >= 2 && s.est.hi >= s.est.lo && s.est.pages === 2, JSON.stringify(s.est));
  });
} finally {
  try { c && c.close(); } catch {}
  chrome.kill("SIGKILL");
  http.close();
}
console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

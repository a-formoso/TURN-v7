#!/usr/bin/env node
/* The Storyboards review (owner 2026-10-03: "go ahead with all of it").
   A  a jump from a panel opens its scene in the Shots tab (the fold map is per film now)
   B  "Apply to panel" — the tab's one paid action — shows its price
   C  "Clear" asks first for an uploaded sheet (a composed one just recomposes)
   D  a COMPLETE sheet saves the Stage's halves automatically (free, in the background); a partial one doesn't
   E  the sheet health strip flags frames made with an earlier look
   F  Frances knows all of it
     node scripts/test-storyboards-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const sb = read("app/storyboard.jsx"), ai = read("app/ai.jsx"), shotsUi = read("app/shots-ui.jsx");
const comp = between(sb, "function StoryboardComposite({", "function StoryboardPage({");

/* ═══ A ═══ */
await test("A1 the jump writes the same per-film fold key the Shots tab reads", ()=>{
  const key = 'const foldKey = "turn_shots_collapsed"+(project && project.id ? ":"+project.id : "");';
  assert.ok(sb.includes(key) && shotsUi.includes(key));
  const jump = between(sb, "const jumpToShot = (sh)=>{", "const tick=");
  assert.ok(jump.includes("localStorage.getItem(foldKey)") && jump.includes("localStorage.setItem(foldKey,"));
  assert.ok(!/localStorage\.(get|set)Item\("turn_shots_collapsed"/.test(sb));
});

/* ═══ B + C ═══ */
await test("B1 'Apply to panel' carries a one-image price chip", ()=>{
  assert.ok(comp.includes('panelBusy?"Editing panel…":"Apply to panel",') && comp.includes("!panelBusy && typeof window.nbCostChip===\"function\" && window.nbCostChip(1)"));
});
await test("C1 Clear asks first only for an uploaded sheet, and holds the auto-compose off after", ()=>{
  const fx = between(comp, "const clearSheet = async ()=>{", "gen.clearGen(); };");
  assert.ok(fx.includes("if(!isComposed && typeof window.appConfirm===\"function\"){"));
  assert.ok(fx.indexOf("if(!ok) return;") < fx.indexOf('sessionStorage.setItem("turn_sb_hold_"+sid,"1")'));
});

/* ═══ D: the real coordinator ═══ */
const box = { console, setTimeout, clearTimeout, Promise, JSON, Object, Array, String, Number, Math, Date,
  React:new Proxy({}, { get:(t,k)=> k==="createElement" ? ()=>null : noop }),
  CustomEvent:class { constructor(t, o){ this.type=t; this.detail=o&&o.detail; } },
  localStorage:{ getItem:()=>null, setItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  document:{ addEventListener:noop, removeEventListener:noop } };
box.window = box; vm.createContext(box);
vm.runInContext(transformSync(sb, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
let have, halves, events;
const reset = (missing)=>{ have = new Set(["s0","s1","s2"].filter(x=>x!==missing)); halves = []; events = [];
  box.nbGetImage = (id)=> have.has(id) ? "img:"+id : ""; box.nbLoadImage = async (id)=> box.nbGetImage(id);
  box.nbGetMeta = (id)=> id.startsWith("sbsheet-") ? { iso:"2026-10-03T10:00:00Z" } : { iso:"t" }; box.nbEpoch = ()=>7;
  box.nbCommit = async (id, url)=>({ tier:"cloud", url });
  box.dispatchEvent = (e)=>{ events.push(e.type+":"+((e.detail&&e.detail.id)||"")); return true; };
  box.sbSaveHalves = async (url, sid, page, version, ep)=>{ halves.push({ url, sid, ids:page.shots.map(x=>x.id), version, ep }); }; };
const page = { id:"sbpage-s-2x2-0", shots:[{ id:"s0" }, { id:"s1" }, { id:"s2" }] };
await test("D1 a complete sheet saves its halves right after composing (with the film scope), and says so", async ()=>{
  reset(null);
  const res = await box.sbComposeSheet({}, page, {}, null, null, async ()=>"data:sheet");
  assert.equal(res.status, "composed");
  await new Promise(r=>setTimeout(r, 0));
  assert.deepEqual(J(halves), [{ url:"data:sheet", sid:"sbsheet-sbpage-s-2x2-0", ids:["s0","s1","s2"], version:"2026-10-03T10:00:00Z", ep:7 }]);
  assert.ok(events.includes("sb-halves-saved:sbsheet-sbpage-s-2x2-0"));
});
await test("D2 a partial sheet (a panel without a frame) never saves halves", async ()=>{
  reset("s1");
  await box.sbComposeSheet({}, page, {}, null, null, async ()=>"data:sheet");
  await new Promise(r=>setTimeout(r, 0));
  assert.equal(halves.length, 0);
});
await test("D3 a failed halves save never fails the compose; the card reloads its halves on the event", async ()=>{
  reset(null); box.sbSaveHalves = async ()=>{ throw new Error("offline"); };
  const res = await box.sbComposeSheet({}, page, {}, null, null, async ()=>"data:sheet");
  assert.equal(res.status, "composed");
  assert.ok(comp.includes('window.addEventListener("sb-halves-saved", h);') && comp.includes("if(e && e.detail && e.detail.id===sid) loadHalves();"));
  assert.ok(sb.includes("const r = await nbCommit(sid+\":half-\"+half, c.toDataURL(\"image/png\"), meta, [], undefined, _ep);"), "a film switch mid-save is discarded");
});

/* ═══ E ═══ */
await test("E1 the health strip counts frames made with an earlier look (never ones without a recorded look)", ()=>{
  assert.ok(comp.includes("if(m && m.lookSig && lookNow && m.lookSig!==lookNow) h.oldLook++;"));
  assert.ok(comp.includes('" made with an earlier look"') && comp.includes("!health.oldLook && health.approved===health.total"));
});

/* ═══ F ═══ */
await test("F1 Frances: automatic halves, the panel price, Clear's question, the earlier-look flag", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Storyboards (Art Room)")||{}).what || "";
  assert.ok(/halves are now SAVED AUTOMATICALLY/.test(w) && /'Apply to panel'.*shows its price/.test(w));
  assert.ok(/'Clear' asks first when the sheet was UPLOADED/.test(w) && /made with an earlier look/.test(w));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

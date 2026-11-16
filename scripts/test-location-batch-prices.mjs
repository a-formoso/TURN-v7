#!/usr/bin/env node
/* test-location-batch-prices.mjs — LOCATIONS' GENERATE PRICES COUNT EACH PLATE'S REFERENCE IMAGES (2026-10-14, closing
   the location fixes A-G). GPT Image 2.5 charges about 1 credit for each reference image a render attaches and Seedream
   5 Pro a little for each after the first, but the Locations buttons priced every plate as an image with none:
   "Generate N missing", "Generate N missing in Scene NN" and its confirm, the batch choice bar, and the Generate button
   on the location, extra-space, environment-state and room & time cards. Pinned here:
   1. imagegen.jsx nbBatchCostText: a batch is the sum of each image's own rounded price, with its own reference count —
      more than count x the bare price on GPT Image and Seedream, the same on Nano Banana 2.1; "" when one can't be priced;
   2. the batches (locations-ui.jsx): the chips and the scene confirm sum per plate (locationPlateRefCount for a location
      plate, sluglineUnitPlateRefCount for a room & time plate, its root's panels only when the root has or gets a plate),
      and the choice bar gets refsOf / refsWhat (artroom.jsx useBatchGen → LikenessBatchCost with its own wording);
   3. the cards: each SheetFrame gets generateRefs counted from the references it shows, as its attachments send them
      (_locUnitAttachments for room & time and state cards: unticked and not-ready ones left out, whole scenes' pages);
   4. the page counts behind the prices are laid out once per scene text (locationScreenplayReferenceImages countOnly
      cache) — the same count from the cache, a changed scene counted again.
   node scripts/test-location-batch-prices.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename) => transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename, compact: true,
}).code;
let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); }
}
const noop = () => {};
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

/* ---- imagegen alone (no plan gate: the engine picked is the engine priced) ---- */
function imageBox(extra){
  const b = { console: { ...console, warn: noop, info: noop }, Date, Promise, Math, JSON, Number, String, Object, Array, RegExp, Map, Set, Uint8Array, URL, AbortController,
    isFinite, parseInt, parseFloat, queueMicrotask, setTimeout, clearTimeout,
    React: { createElement: () => null, useState: (i) => [i, noop], useEffect: noop },
    Image: class {}, FileReader: class {}, Blob: class {}, atob: (s) => s, fetch: async () => { throw new Error("no fetch"); },
    TURN_SUPABASE: { url: "https://supabase.test/", imageProxy: true, imageProxyFn: "fake-image-proxy" },
    turnSafeError: (v) => v, turnAttrError: (_k, _m, msg) => msg, turnIsContentBlock: () => false, turnApiKeysForProxy: () => ({}),
    document: { addEventListener: noop, removeEventListener: noop, createElement: () => ({ style: {} }), body: { appendChild: noop, removeChild: noop }, getElementById: () => null },
    localStorage: mkStore(), sessionStorage: mkStore(),
    CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, setInterval: () => 0, clearInterval: noop,
    location: { hostname: "localhost", href: "", search: "", hash: "", origin: "" }, navigator: { userAgent: "node-test", onLine: true },
    CREDIT_SCALE: 10, ...(extra || {}) };
  b.window = b; b.globalThis = b; vm.createContext(b);
  vm.runInContext(transform(read("app/imagegen.jsx"), "app/imagegen.jsx"), b, { filename: "app/imagegen.jsx" });
  return b;
}
const G = imageBox();
const SUN = "gpt-image-2.5-sunburst", SEED = "seedream-5-pro", NB21 = "gemini-nano-banana-2.1";
const sumEach = (refs) => String(refs.reduce((n, r) => n + Number(G.nbImageCostText(1, { refs: r })), 0));

await test("1 nbBatchCostText: the sum of each image's own price with its own references (GPT Image, Seedream), the same as count x price on Nano Banana 2.1", () => {
  assert.equal(typeof G.window.nbBatchCostText, "function", "exported on window");
  G.localStorage.setItem("turn-nb-model", SUN);
  const refs = [0, 2, 5, 6];
  assert.equal(G.nbBatchCostText(refs), sumEach(refs));
  assert.ok(Number(G.nbBatchCostText(refs)) > Number(G.nbImageCostText(refs.length)),
    "GPT Image: 13 reference images cost more than four bare images (" + G.nbBatchCostText(refs) + " vs " + G.nbImageCostText(refs.length) + ")");
  assert.ok(Number(G.nbImageCostText(1, { refs: 6 })) > Number(G.nbImageCostText(1)), "a reference adds to one GPT Image render");
  G.localStorage.setItem("turn-nb-model", SEED);
  G.localStorage.setItem("turn-nb-res", "2K");
  assert.equal(G.nbBatchCostText([1, 6, 6]), sumEach([1, 6, 6]));
  assert.ok(Number(G.nbBatchCostText([6, 6, 6])) >= Number(G.nbImageCostText(3)), "Seedream: never below the bare price");
  G.localStorage.setItem("turn-nb-model", NB21);
  assert.equal(G.nbBatchCostText([0, 6, 3]), G.nbImageCostText(3), "Nano Banana 2.1 doesn't charge per reference");
  assert.equal(G.nbBatchCostText([]), "", "nothing to price");
  const U = imageBox({ turnImageProviderUsdTable: () => ({}) });   // a price table without the engine
  assert.equal(U.nbImageCostText(1, { refs: 1 }), "", "an engine with no price");
  assert.equal(U.nbBatchCostText([1, 2]), "", "a batch with an image that can't be priced shows no price");
});

const ui = read("app/locations-ui.jsx"), art = read("app/artroom.jsx"), img = read("app/imagegen.jsx");
await test("2 the batches price per plate: Generate N missing, the scene's button and confirm, the choice bar", () => {
  assert.ok(!/nbCostChip\(missingAll\.length\)/.test(ui), "'Generate N missing' no longer prices bare images");
  assert.ok(!/nbCostChip\(sceneMissingN\)/.test(ui), "the scene's button no longer prices bare images");
  assert.ok(!/nbImageCostText\(n\) : ""/.test(ui.replace(/\(typeof window\.nbBatchCostText[^\n]*\n[^\n]*/, "")), "the scene confirm sums per plate");
  assert.match(ui, /batchChip\(missingAll\.map\(id=>plateRefsOf\(byLocId\[id\], missingAll\)\)\)/);
  assert.match(ui, /batchChip\(sceneRefsList\(plan\)\)/);
  assert.match(ui, /window\.nbBatchCostText\(sceneRefsList\(p\)\)/);
  assert.match(ui, /const n = _locMemoRefCount\(l, null, "", \(\)=>\{ const r = locationPlateRefCount\(l\); return r && r\.n!=null \? r\.n : 6; \}\);\n\s+return parentUnknown\(l, run\) \? Math\.min\(6, n\+3\) : n;\n\s+\}catch\(e\)\{ return 6; \} \};/,
    "a location plate: locationPlateRefCount (kept); a room whose parent the run makes: up to 4 panels, not 1; uncountable: the most it could send");
  assert.match(ui, /const n = _locMemoRefCount\(x\.owner, x\.u, rootPlate, \(\)=>\{ const r = sluglineUnitPlateRefCount\(x\.owner, x\.u, \{ rootPlate \}\); return r && r\.n!=null \? r\.n : 6; \}\);\n\s+return rootPlate && parentUnknown\(x\.owner, run\) \? Math\.min\(6, n\+1\) : n;/,
    "a room & time plate: up to 2 root panels, not 1, when the run makes the root");
  assert.match(ui, /if\(!p \|\| !inRun\(run, p\.id\)\) return false;\n\s+const m = hasImg\(p\.id\) && typeof nbGetMeta==="function" \? nbGetMeta\(p\.id\) : null;\n\s+return !\(m && m\.platePanels\);/,
    "unknown = the run makes the parent's plate, or remakes one whose cameras were never recorded");
  assert.match(ui, /return unitRefsOf\(x, !root \|\| hasImg\(root\.id\) \|\| run\.indexOf\(root\.id\)>=0, run\);/,
    "a room & time plate gets its root's panels only when the root has a plate or this run makes it");
  assert.match(ui, /" first\." : ""; \},\n\s+refsOf:\(id, i, run\)=>plateRefsOf\(byLocId\[id\], run\), refsWhat \}\);/, "Generate all's choice bar (its button's own list is the run)");
  assert.match(ui, /batch\.begin\(eligible, shown\.length - eligible\.length, \{ refsOf:\(id, i, run\)=>plateRefsOf\(byLocId\[id\], run\), refsWhat \}\);/, "a scene's Regenerate");
  assert.ok(art.includes("refs:prompt.missing.map(prompt.refsOf)") && art.includes("refs:[...prompt.missing, ...prompt.existing].map(prompt.refsOf)"),
    "the choice bar maps each button's own list, so refsOf's third argument is that run");
  assert.match(art, /const refsWhat = \(opts && opts\.refsWhat\) \|\| "";/);
  assert.equal((art.match(/what:prompt\.refsWhat\|\|undefined/g) || []).length, 2, "both choice-bar buttons name the references");
  assert.match(art, /function LikenessBatchCost\(\{ refs, what \}\)\{/);
  assert.match(art, /\+" \\u2014 counting "\+\(what \|\| "each one's likeness photos and worn-item sheets"\)/, "the likeness batches keep their wording");
  assert.match(art, /total = Number\(window\.nbBatchCostText\(list\)\)\|\|0;/, "one sum for every batch price");
  assert.match(img, /window\.nbBatchCostText = nbBatchCostText;/);
});

/* ---- locations.jsx + locations-ui.jsx (raw, as the other location tests run them) ---- */
const box = { console, React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: "Fragment",
    useState: (i) => [typeof i === "function" ? i() : i, noop], useRef: (i) => ({ current: i }), useEffect: noop, useReducer: (f, i) => [i, noop] },
  setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
  CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  document: { createElement: () => ({}) },   // a canvas with no metrics: Courier's 0.6 em
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal", nbEpoch: () => 1 };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
vm.runInContext(read("app/locations-ui.jsx"), box, { filename: "app/locations-ui.jsx" });

await test("3 the cards: each Generate is priced with the references it sends", () => {
  assert.match(ui, /generateRefs: masterGenerateRefs,/, "the location card");
  assert.match(ui, /generateRefs: refPreview\.length \? refPreview\.filter\(r=>r\.ready && r\.url && \(r\.required \|\| coverageRefOff\.indexOf\(r\.refId\)<0\)\)\.length : undefined,/, "the extra-space card");
  // (2026-11-16, owner: "Remove the older Generate image on variants") the environment-state and room & time cards have
  // no Generate of their own any more, so nothing is priced there; a variant's image is made from the location image
  assert.equal((ui.match(/generateRefs: refPreview\.length \? _locUnitAttachments\(refPreview, refOff\)\.length : undefined,/g) || []).length, 0);
  assert.equal((ui.match(/noGenerate:true \}\),/g) || []).length, 2, "the environment-state and room & time cards");
  assert.match(ui, /const parentN = l\.parentLocation\n\s+\? \(parentRefUrl \? rootRefs\.filter\(r=>r\.required!==false \|\| masterRefOff\.indexOf\(r\.refId\)<0\)\.length : 0\)\n\s+: \(\(typeof locationPlateFixedRefCount==="function" \? locationPlateFixedRefCount\(l\)\.n : 0\) \|\| 0\);/,
    "a room: its root panels as the strip keeps them; a main location: its layout's plate");
  assert.match(ui, /return Math\.min\(6, parentN \+ \(typeof locationWholeScenePages==="function" \? locationWholeScenePages\(pages, 6-parentN\) : pages\)\.length\);/,
    "then whole scenes' pages in the slots left, 6 at most — as attachments() sends them");
  assert.match(art, /window\.nbCostChip\(1, generateRefs!=null \? \{ refs:Number\(generateRefs\)\|\|0 \} : undefined\)/, "SheetFrame prices its Generate with them");
  // what a room & time / state card sends, counted
  const att = vm.runInContext("_locUnitAttachments", box);
  const page = (id, scene) => ({ url: "data:p" + id, kind: "script", refId: "p" + id, required: false, ready: true, sceneId: scene });
  const refs = [page(1, "s1"), page(2, "s2"), page(3, "s2"), page(4, "s3"),
    { url: "data:plate", kind: "location", refId: "loc", required: true, ready: true },
    { url: "data:panel", kind: "location", refId: "root-mat", required: false, ready: true },
    { url: "", kind: "location", refId: "missing", required: false, ready: false }];
  assert.equal(att(refs, []).length, 6, "4 pages + the plate + the material panel; the not-ready one isn't sent");
  assert.equal(att(refs, ["root-mat"]).length, 5, "an unticked panel isn't counted");
  assert.equal(att(refs, ["p1"]).length, 5, "an unticked page isn't counted");
  const many = [...refs, { url: "data:x", kind: "location", refId: "x", required: true, ready: true },
    { url: "data:y", kind: "location", refId: "y", required: true, ready: true }];
  assert.equal(att(many, []).length, 6, "4 plates leave 2 slots: scene 1's page fits, scene 2's two pages don't fit whole, scene 3's page does");
  assert.equal(att(many, ["p1"]).length, 6, "scene 1 unticked: scene 2's two pages fill the 2 slots, scene 3's doesn't fit");
  assert.deepEqual(JSON.parse(JSON.stringify(att(many, ["p1"]).filter((r) => r.kind === "script").map((r) => r.refId))), ["p2", "p3"]);
});

await test("3b the batch counts are kept: the same card, parent, plates and screenplay are counted once", () => {
  const memo = vm.runInContext("_locMemoRefCount", box);
  const metas = {};
  box.nbGetMeta = (id) => metas[id] || null;
  const parent = { id: "root", key: "root" }, room = { id: "room", parentKey: "root" };
  box.turnContinuity = { scenes: [], drafts: {}, locations: [parent, room] };
  let calls = 0; const count = () => { calls++; return 3; };
  assert.equal(memo(room, null, "", count), 3);
  assert.equal(memo(room, null, "", count), 3);
  assert.equal(calls, 1, "a second render reads the kept count");
  box.turnContinuity = { ...box.turnContinuity, drafts: { s1: { blocks: [] } } };
  memo(room, null, "", count); assert.equal(calls, 2, "a screenplay edit counts again");
  metas.root = { iso: "2026-10-14T10:00:00Z" };
  memo(room, null, "", count); assert.equal(calls, 3, "the parent's new plate counts again");
  metas.root = { iso: "2026-10-14T10:00:00Z", platePanels: { panels: [] } };
  memo(room, null, "", count); assert.equal(calls, 4, "the parent's cameras recorded: counted again");
  const u = { key: "u1" };
  memo(room, u, true, count); memo(room, u, false, count); assert.equal(calls, 6, "each room & time and root-plate case has its own count");
  memo(room, u, true, count); assert.equal(calls, 6);
  delete box.nbGetMeta; delete box.turnContinuity;
});

await test("4 a page count is laid out once per scene text, and counted again when the scene changes", () => {
  const imgs = vm.runInContext("locationScreenplayReferenceImages", box);
  const cache = vm.runInContext("_locPageCountLayouts", box);
  const scene = { id: "s1", no: 3, loc: "INT. FURNACE - NIGHT" };
  const lines = (n) => Array.from({ length: n }, (_, i) => ({ type: "action", text: "Line " + i + " — the glass glows and the furnace hums under the long night of work." }));
  const drafts = { s1: { blocks: [{ type: "scene", text: "INT. FURNACE - NIGHT" }, ...lines(160)] } };
  const before = cache.size;
  const a = imgs({ name: "Furnace" }, {}, [scene], drafts, { countOnly: true, scene });
  assert.ok(a.pageCount > 1, "a long scene takes several pages (" + a.pageCount + ")");
  assert.equal(cache.size, before + 1, "laid out once");
  const b = imgs({ name: "Furnace" }, {}, [scene], drafts, { countOnly: true, scene });
  assert.equal(b.pageCount, a.pageCount);
  assert.equal(cache.size, before + 1, "the second count comes from the cache");
  const shorter = { s1: { blocks: [{ type: "scene", text: "INT. FURNACE - NIGHT" }, ...lines(8)] } };
  const c = imgs({ name: "Furnace" }, {}, [scene], shorter, { countOnly: true, scene });
  assert.equal(c.pageCount, 1, "the edited scene is counted again, not read from the old layout");
  assert.equal(cache.size, before + 2);
  assert.equal(imgs({ name: "Furnace" }, {}, [{ ...scene, no: 4 }], drafts, { countOnly: true, scene: { ...scene, no: 4 } }).pageCount, a.pageCount,
    "a renumbered scene (its heading's number) is laid out again too");
  assert.equal(cache.size, before + 3);
});

console.log(failed ? "\n" + failed + " FAILED, " + checks + " passed" : "\nPASS all " + checks + " location batch price checks");
process.exit(failed ? 1 : 0);

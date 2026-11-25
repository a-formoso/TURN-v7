#!/usr/bin/env node
/* test-nano-banana-2-1.mjs — Nano Banana 2.1 replaces Nano Banana 2 Lite (owner, 2026-10-10).
   Offline: the real sources run in node:vm sandboxes (the app) or are imported (the server's pure
   modules); index.ts and pricing-watch are checked at source level.

     A  the engine list: Nano Banana 2.1 in (where Lite was), Lite out — never offered
     B  prices: app (pricing.jsx + imagegen's fallback) and server (billing-pricing.mjs) agree —
        fal $0.05 / $0.07 / $0.15, Google direct $0.0336 / $0.0504 / $0.113; credits at the live
        unit; web search treated as Nano Banana 2's; no extra per reference image
     C  the fal routes: google/nano-banana-2.1 and, with references, google/nano-banana-2.1/edit
     D  drafts (trial / no plan) = Nano Banana 2.1 at 1K on both sides; 2K / 4K capped (app) /
        refused (server) the same way as before
     E  Lite's old id: mapped where the app reads settings and options, and on the server before
        the plan gate, the price and the route (logged once)
     F  an old asset's meta still DISPLAYS "Nano Banana 2 Lite" (its historical label)
     G  Frances: the engine list and drafts = Nano Banana 2.1 at 1K; no prices; no "Nano Banana 2 Lite"
     H  no user-facing literal names "Nano Banana 2 Lite" (except the historical label) or says
        drafts are "up to 2K"; the price-drift watcher follows 2.1, not Lite

   (2026-10-11, owner — image engines: Nano Banana 2, Nano Banana Pro and GPT Image 2 were removed too — their
   ids map to a successor; scripts/test-image-engines-oct11.mjs covers that change. The checks below keep only
   what this change itself still promises. 2026-11-12, owner: GPT Image 2.6 Flare / Sunburst replaced 2.5 and
   Seedream 5.5 joined Seedream 5 Pro — the "other engines" named below are today's.)

   node scripts/test-nano-banana-2-1.mjs */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
const plain = (x) => JSON.parse(JSON.stringify(x));
const NEW = "gemini-nano-banana-2.1", OLD = "gemini-3.1-flash-lite-image";

const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
function box(extra){
  const b = { console: { ...console, warn: noop, info: noop }, Date, Promise, Math, JSON, Number, String, Object, Array, RegExp, Map, Set, Uint8Array, URL, AbortController,
    isFinite, parseInt, parseFloat, queueMicrotask, setTimeout, clearTimeout,
    React: { createElement: () => null, useState: (i) => [i, noop], useEffect: noop },
    Image: class {}, FileReader: class {}, Blob: class {}, atob: (s) => s, fetch: async () => { throw new Error("no fetch"); },
    TURN_SUPABASE: { url: "https://supabase.test/", imageProxy: true, imageProxyFn: "fake-image-proxy" },
    turnSafeError: (v) => v, turnAttrError: (_k, _m, msg) => msg, turnIsContentBlock: () => false, turnApiKeysForProxy: () => ({}),
    document: { addEventListener: noop, removeEventListener: noop, createElement: () => ({ style: {} }), body: { appendChild: noop, removeChild: noop }, getElementById: () => null },
    localStorage: mkStore(), sessionStorage: mkStore(), toasts: [], events: [],
    CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } },
    addEventListener: noop, removeEventListener: noop, setInterval: () => 0, clearInterval: noop,
    location: { hostname: "localhost", href: "", search: "", hash: "", origin: "" }, navigator: { userAgent: "node-test", onLine: true },
    CREDIT_SCALE: 10, ...(extra || {}) };
  b.dispatchEvent = (ev) => { b.events.push(ev); return true; };
  b.appToast = (m, k) => b.toasts.push({ m, k });
  b.window = b; b.globalThis = b; vm.createContext(b); return b;
}
const run = (b, f) => vm.runInContext(transform(read(f), f), b, { filename: f });
const paidFn = (plan) => { const p = String(plan || "").toLowerCase().trim(); return !!p && p !== "none" && p !== "free" && p !== "trial"; };

const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
const pol = await import(new URL("supabase/functions/image-proxy/billing-policy.mjs", ROOT));
const proxySrc = read("supabase/functions/image-proxy/index.ts");

/* the app as shipped: pricing → plans → imagegen */
const A = box();
run(A, "app/pricing.jsx");
run(A, "app/plans.jsx");
run(A, "app/imagegen.jsx");
/* imagegen alone: its fallback price table */
const G = box();
run(G, "app/imagegen.jsx");

/* ═══ A ═══ */
await test("A the engine list: Nano Banana 2.1 where Lite was, Lite never offered", () => {
  const ids = plain(A.NB_MODELS.map((m) => m.id));
  assert.equal(ids[0], NEW, "2.1 is the first (default) engine since 2026-10-11");
  assert.ok(!ids.includes(OLD), "Lite is not selectable");
  const m = A.NB_MODELS.find((x) => x.id === NEW);
  assert.deepEqual(plain(m), { id: NEW, label: "Nano Banana 2.1", provider: "fal", family: "nano", falModel: "google/nano-banana-2.1",
    falEditModel: "google/nano-banana-2.1/edit", note: "fast · lowest cost" });
  assert.equal(A.providerOfModel(NEW), "fal"); assert.equal(A.isGptImageModel(NEW), false);
  assert.deepEqual(plain(A.NB_RESOLUTIONS), ["1K", "2K", "4K"], "2.1 renders at 1K, 2K and 4K");
  assert.equal(A.nbModelGrounds(NEW), true, "2.1 grounds with web search");
  assert.equal(A.nbModelGrounds("gpt-image-2.6-sunburst"), false);
  assert.ok(!/flash-lite-image/.test(read("app/artroom.jsx")) && !/nano-banana-2-lite/.test(read("app/imagegen.jsx")), "no Lite route or id is offered");
});

/* ═══ B ═══ */
await test("B the app's and the server's price tables agree: fal $0.05 / $0.07 / $0.15, Google direct $0.0336 / $0.0504 / $0.113", () => {
  const fal = { "1K": 0.05, "2K": 0.07, "4K": 0.15 };
  assert.deepEqual(plain(A.TURN_PRICING.image.providerUsd[NEW]), fal);
  assert.deepEqual(plain(srv.IMAGE_PROVIDER_USD[NEW]), fal);
  assert.deepEqual(plain(A.TURN_PRICING.image.providerUsd), plain(srv.IMAGE_PROVIDER_USD), "the whole table, as the server holds");
  assert.deepEqual(plain(srv.GOOGLE_IMAGE_USD[NEW]), { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 });
  for (const t of [A.TURN_PRICING.image.providerUsd, srv.IMAGE_PROVIDER_USD, srv.GOOGLE_IMAGE_USD]) assert.ok(!(OLD in t), "no Lite row");
  // imagegen's fallback copy (no pricing.jsx) is the same table
  assert.deepEqual(["1K", "2K", "4K"].map((r) => G.nbImageCostText(1, { model: NEW, res: r })), ["5", "7", "15"]);
});
await test("B credits at the live unit: 5 / 7 / 15 ($0.01), 2 / 3 / 5 before the switch; web search +$0.015; no charge per reference", () => {
  const c = (o) => srv.imageCost({ route: "fal", model: NEW, aspect: "16:9", ...o });
  assert.deepEqual(["1K", "2K", "4K"].map((s) => c({ imageSize: s }).credits), [5, 7, 15]);
  assert.deepEqual(["1K", "2K", "4K"].map((s) => c({ imageSize: s, unit: 0.03 }).credits), [2, 3, 5]);
  assert.equal(c({ imageSize: "1K", webSearch: true }).credits, 7, "$0.065");
  assert.equal(c({ imageSize: "2K", referenceImages: 6 }).credits, 7, "no extra per reference image");
  assert.deepEqual(["1K", "2K", "4K"].map((s) => srv.imageCost({ route: "google", model: NEW, imageSize: s }).credits), [4, 6, 12]);
  assert.equal(srv.imageCost({ route: "google", model: NEW, imageSize: "1K", webSearch: true }).credits, srv.creditsFromUsd(0.0336 + srv.GOOGLE_GROUNDING_USD));
  // the app's chips quote the same
  A.localStorage.setItem("turn-nb-res", "2K");
  assert.deepEqual(["1K", "2K", "4K"].map((r) => A.nbImageCostText(1, { model: NEW, res: r, ground: false })), ["5", "7", "15"]);
  assert.equal(A.nbImageCostText(1, { model: NEW, res: "1K", ground: true }), "7", "+ web grounding");
  assert.equal(A.nbImageCostText(3, { model: NEW, res: "2K", ground: false, refs: 4 }), "21", "count × the whole per-image price, no reference charge");
  for (const usd of [0.05, 0.065, 0.07, 0.085, 0.15, 0.165]) assert.equal(A.turnCreditCost(usd), srv.creditsFromUsd(usd), String(usd));
});

/* ═══ C ═══ */
await test("C the fal routes: google/nano-banana-2.1, and its /edit route when references are attached", () => {
  assert.ok(proxySrc.includes('"gemini-nano-banana-2.1":      { base: "google/nano-banana-2.1", edit: "google/nano-banana-2.1/edit", family: "nano" },'));
  assert.ok(proxySrc.includes("const endpoint = imageUrls.length && cfg.edit ? cfg.edit : cfg.base;"));
  assert.ok(!/flash-lite-image"\s*:/.test(proxySrc) && !proxySrc.includes('"google/nano-banana-2-lite"'), "Lite has no route");
  // the nano input: the real resolution, web search when asked
  assert.ok(proxySrc.includes('input.resolution = imageSize || "2K";') && proxySrc.includes("if (groundSearch) input.enable_web_search = true;"));
});

/* ═══ D ═══ */
await test("D drafts = Nano Banana 2.1 at 1K on both sides; a no-plan 2K / 4K is capped by the app and refused by the server", () => {
  assert.deepEqual(plain(pol.DRAFT_IMAGE), { model: NEW, maxRes: "1K" });
  assert.deepEqual(plain(A.TURN_DRAFT_IMAGE), { model: NEW, label: "Nano Banana 2.1", maxRes: "1K" });
  const none = { plan: "none", trial: true, remaining: 50, isAdmin: false, frozen: false };
  const code = (r) => r && r.body && r.body.code;
  assert.equal(pol.checkImage(none, { model: NEW, imageSize: "1K" }), null);
  for (const s of ["2K", "4K"]) assert.equal(code(pol.checkImage(none, { model: NEW, imageSize: s })), "plan_required", s);
  for (const m of ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst", "seedream-5-pro", "seedream-5.5"]) assert.equal(code(pol.checkImage(none, { model: m, imageSize: "1K" })), "plan_required", m);
  assert.equal(pol.checkImage({ plan: "writer", remaining: 600 }, { model: NEW, imageSize: "2K" }), null, "Writer: 2.1 up to 2K");
  assert.equal(code(pol.checkImage({ plan: "writer", remaining: 600 }, { model: NEW, imageSize: "4K" })), "tier_required");
  assert.equal(pol.checkImage({ plan: "director", remaining: 600 }, { model: NEW, imageSize: "4K" }), null);
  A.turnIsPaidPlan = paidFn; A.turnIsAdmin = false;
  A.turnCreditBalance = { remaining: 50, plan: "none", trial: true };
  for (const [m, r] of [["gpt-image-2.6-sunburst", "4K"], ["gpt-image-2.5-sunburst", "4K"], [NEW, "2K"], [NEW, "4K"], ["seedream-5-pro", "1K"], ["seedream-5.5", "1K"]])
    assert.deepEqual(plain(A.turnPlanImageChoice(m, r)), { model: NEW, res: "1K", limited: true }, m + " " + r);
  assert.deepEqual(plain(A.turnPlanImageChoice(NEW, "1K")), { model: NEW, res: "1K", limited: false });
  assert.equal(A.nbImageCostText(1, { model: "gpt-image-2.6-sunburst", res: "4K" }), "5", "the trial's chip quotes the draft: 2.1 at 1K");
  A.turnCreditBalance = null;
});
await test("D the trial copy stays honest: a draft image is 5 credits (as Lite's was) and no copy promises a count", () => {
  assert.equal(srv.imageCost({ route: "fal", model: pol.DRAFT_IMAGE.model, imageSize: pol.DRAFT_IMAGE.maxRes }).credits, 5);
  assert.ok(A.TURN_TRIAL_COPY.endsWith("plus draft images."));
  assert.ok(!/\b\d+\s+draft images?\b/i.test(read("app/plans.jsx").replace(/\/\*[\s\S]*?\*\//g, "")));
});

/* ═══ E ═══ */
await test("E the app maps Lite's id: a saved pick, nbSetModel, an option and a cost chip all become Nano Banana 2.1", async () => {
  const B = box();
  run(B, "app/pricing.jsx"); run(B, "app/plans.jsx"); run(B, "app/imagegen.jsx");
  assert.equal(B.nbCanonicalModelId(OLD), NEW);
  for (const x of [NEW, "gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "seedream-5-pro", "seedream-5.5", "", null, undefined, ["x"]]) assert.equal(B.nbCanonicalModelId(x), x);
  B.localStorage.setItem("turn-nb-model", OLD);
  assert.equal(B.nbGetModel(), NEW); assert.equal(B.localStorage.getItem("turn-nb-model"), NEW, "persisted once");
  B.nbSetModel(OLD); assert.equal(B.localStorage.getItem("turn-nb-model"), NEW);
  B.localStorage.setItem("turn-nb-model", "no-such-engine"); assert.equal(B.nbGetModel(), NEW, "an unknown id still falls back to the first engine");
  assert.equal(B.nbImageCostText(1, { model: OLD, res: "4K", ground: false }), "15");
  // an option naming Lite (an agent / batch run, a saved surface default) renders on 2.1
  B.turnIsPaidPlan = paidFn; B.turnIsAdmin = false; B.turnCreditBalance = { remaining: 900, plan: "director" };
  const calls = [];
  B.proxyGenerate = async (prompt, opts, provider) => { calls.push({ opts: { ...opts }, provider }); return "data:image/png;base64,X"; };
  B.nbAssertMediaIdentity = noop;
  await B.nbGenerate("a lighthouse", { model: OLD, imageSize: "2K" });
  assert.deepEqual([calls[0].opts.model, calls[0].opts.imageSize, calls[0].provider], [NEW, "2K", "fal"]);
  assert.equal(B.toasts.length, 0, "a paid account isn't told about drafts");
  // a trial's old Lite pick is the draft engine itself, not a 'limited' swap
  B.turnCreditBalance = { remaining: 50, plan: "none", trial: true };
  assert.deepEqual(plain(B.turnPlanImageChoice(OLD, "1K")), { model: NEW, res: "1K", limited: false });
  // the sheet runner records the model it really ran
  const art = read("app/artroom.jsx");
  assert.ok(art.includes('const _requestedModel = (typeof nbCanonicalModelId==="function" ? nbCanonicalModelId : (x=>x))(gopts.model'));
  assert.ok(art.includes('const overrideModel = (gopts.model && typeof nbCanonicalModelId==="function") ? nbCanonicalModelId(gopts.model) : (gopts.model || null);'));
  const img = read("app/imagegen.jsx");
  assert.ok(img.includes("const model = nbCanonicalModelId(opts.model || nbGetModel());"), "proxyGenerate, the last boundary, maps too");
});
await test("E the server maps Lite's id before the plan gate, the price and the route — and logs it once", () => {
  assert.equal(srv.canonicalImageModel(OLD), NEW);
  for (const x of [NEW, "gpt-image-2.6-sunburst", "gpt-image-2.6-flare", "seedream-5-pro", "seedream-5.5", "claude-opus-5-5", "", undefined, ["gemini-3.1-flash-image"]]) assert.equal(srv.canonicalImageModel(x), x);
  assert.equal(plain(srv.LEGACY_IMAGE_MODEL_IDS)[OLD], NEW);
  // (a request naming no model is GPT Image 2.6 Sunburst since 2026-11-12 — it was 2.5 Sunburst)
  const i = proxySrc.indexOf('const model = textLegacy ? textLegacy.model : canonicalImageModel(body.model || "gpt-image-2.6-sunburst");');
  assert.ok(i > 0, "the request's model is mapped where it is read");
  assert.ok(i < proxySrc.indexOf("const imageGate = checkImage(account, { model, imageSize });") && i < proxySrc.indexOf("const imageRouteOk ="));
  assert.ok(proxySrc.includes("if (!textLegacy && model !== (body.model || \"gpt-image-2.6-sunburst\") && !legacyImageModelLogged) {") && proxySrc.includes("legacyImageModelLogged = true;"));
  assert.ok(/import \{[^}]*canonicalImageModel,[^}]*\} from "\.\/billing-pricing\.mjs";/.test(proxySrc));
  // what the mapped request is charged and allowed
  const none = { plan: "none", trial: true, remaining: 50 };
  assert.equal(pol.checkImage(none, { model: srv.canonicalImageModel(OLD), imageSize: "1K" }), null);
  assert.equal(srv.imageCost({ route: "fal", model: srv.canonicalImageModel(OLD), imageSize: "1K" }).credits, 5);
});

/* ═══ F ═══ */
await test("F an old asset made with Lite still shows 'Nano Banana 2 Lite' where its engine is displayed", () => {
  assert.equal(A.nbModelLabel(OLD), "Nano Banana 2 Lite");
  assert.equal(A.nbModelLabel(NEW), "Nano Banana 2.1");
  assert.equal(A.nbModelLabel("gpt-image-2"), "GPT Image 2", "the removed engines keep their historical labels too");
  assert.equal(A.nbModelLabel("mystery"), "mystery");
  const art = read("app/artroom.jsx");
  // (2026-11-20) Details read it through nbShownModel: an ordinary image's engine as before, a change made in code its planner
  assert.ok(art.includes("const modelDetail = nbShownModel(meta).label;") && art.includes("return { label:nbEngineShown(m), id:m.modelId||\"\", code:false };"), "Details");
  // (2026-11-17) the chip's words come from sheetCapValue (the details under an image are the person's choice now)
  assert.ok(art.includes('if(field==="model") return nbEngineShown(m);'), "the sheet's engine chip");   // (2026-11-25) by its name in the engine list, never the saved id
  assert.ok(read("app/imagegen.jsx").includes("const _mLbl = nbModelLabel(model);"));
});

/* ═══ G ═══ */
await test("G Frances: the engine list and drafts name Nano Banana 2.1 at 1K; she never sees 'Nano Banana 2 Lite' or a price", () => {
  const files = ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/artroom.jsx","app/ai.jsx"];
  const ReactStub = new Proxy({ createElement: () => null, Fragment: "f", useState: (x) => [x, noop], useRef: (x) => ({ current: x }), useEffect: noop, useMemo: (f) => f(), useCallback: (f) => f, memo: (f) => f, forwardRef: (f) => f,
    createContext: () => ({}), useContext: () => null, useLayoutEffect: noop }, { get: (t, k) => (k in t ? t[k] : noop) });
  const F = box({ React: ReactStub, ReactDOM: new Proxy({}, { get: () => noop }), Icon: new Proxy({}, { get: () => () => null }),
    requestAnimationFrame: noop, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    claude: { complete: async () => "" }, appConfirm: async () => true });
  F.document.querySelector = () => null; F.document.querySelectorAll = () => []; F.document.head = { appendChild: noop };
  for (const f of files) {
    const src = read(f);
    vm.runInContext(f === "app/script.jsx" || f === "app/artroom.jsx"
      ? transformSync(src, { plugins: ["@babel/plugin-transform-block-scoping"], babelrc: false, configFile: false, filename: f }).code : src, F, { filename: f });
  }
  const all = F.APP_FEATURES.map((f) => String(f.what || "") + " " + String(f.muse || "")).join("\n");
  assert.ok(!/Nano Banana 2 Lite|2 Lite\b/.test(all), "no Lite name in the manifest");
  assert.ok(!/drafts?[^.]{0,60}up to 2K/i.test(all), "drafts are never 'up to 2K'");
  const img = F.APP_FEATURES.find((f) => f.name === "Generating images (Art Room)").what;
  assert.ok(img.includes("'Nano Banana 2.1' (the default: fast and the lowest cost"));
  assert.ok(img.includes("images are drafts — Nano Banana 2.1 at 1K"));
  assert.ok(img.includes("replaced the earlier Lite engine"));
  const trial = F.APP_FEATURES.find((f) => /^A plan is required/.test(f.name)).what;
  assert.ok(trial.includes("draft images (Nano Banana 2.1 at 1K) only"));
  // what Frances is actually given
  const facts = F.museFacts();
  const pub = facts.map((f) => f.what).join("\n");
  assert.ok(pub.includes("Nano Banana 2.1"), "the on-screen engine label reaches her (MUSE Protocol §3)");
  assert.ok(!/Nano Banana 2 Lite/.test(pub));
  assert.ok(!/\$0\.0[57]|\$0\.15\b|credits? (?:a|per) image/i.test(facts.filter((f) => /image/i.test(f.name)).map((f) => f.what).join("\n")), "no image prices reach her");
});

/* ═══ H ═══ */
await test("H no user-facing literal names 'Nano Banana 2 Lite' (but the historical label) or calls drafts 'up to 2K'", () => {
  const files = [
    ...readdirSync(new URL("app/", ROOT)).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => "app/" + f),
    ...readdirSync(ROOT).filter((f) => /\.html$/.test(f)),
    "supabase/functions/image-proxy/index.ts", "supabase/functions/image-proxy/billing-policy.mjs", "supabase/functions/image-proxy/billing-pricing.mjs",
    "supabase/functions/image-proxy/public-errors.mjs", "supabase/functions/pricing-watch/index.ts",
  ];
  const lit = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
  const hits = [], drafts = [];
  for (const f of files) {
    let src; try { src = read(f); } catch (_e) { continue; }
    for (const m of src.matchAll(lit)) {
      if (/Nano Banana 2 Lite/.test(m[2])) hits.push(f + ": " + m[2].slice(0, 80));
      if (/draft[^.]{0,60}up to 2K|up to 2K[^.]{0,20}draft/i.test(m[2])) drafts.push(f + ": " + m[2].slice(0, 120));
    }
  }
  assert.deepEqual(hits, ["app/imagegen.jsx: Nano Banana 2 Lite"], "only NB_HISTORICAL_MODEL_LABELS");
  assert.ok(read("app/imagegen.jsx").includes('  "gemini-3.1-flash-lite-image":"Nano Banana 2 Lite",'));
  assert.deepEqual(drafts, []);
  assert.ok(read("app/imagegen.jsx").includes('"Without a plan, images are drafts (Nano Banana 2.1 at 1K). Choose a plan for every image engine."'));
  assert.ok(!/NB2 Lite/.test(read("app/artroom.jsx")) && read("app/artroom.jsx").includes('model==="gemini-nano-banana-2.1" ? "NB2.1"'), "the dock chip");
});
await test("H the price-drift watcher follows Nano Banana 2.1's fal page (its image output token rate scales the column), not Lite's", () => {
  const w = read("supabase/functions/pricing-watch/index.ts");
  assert.ok(w.includes('slug: "google/nano-banana-2.1",') && !w.includes("nano-banana-2-lite") && !w.includes("flash-lite-image"));
  for (const r of ["1K", "2K", "4K"]) assert.ok(w.includes(`"image.providerUsd.gemini-nano-banana-2.1.${r}",`), r);
  assert.ok(w.includes('"nb21-image-output-tokens",') && w.includes("35.294, // fal's rate when the 2026-10-10 table was written"));
  // the parse: fal states only token rates for 2.1 (its catalog text, 2026-10-10) — the image OUTPUT token rate
  const re = /Image tokens \(per 1M\):[^\n]*?\$\s*([\d.,]+)\s*output/i;
  assert.ok(w.includes("const rate = firstMatch(t, /Image tokens \\(per 1M\\):[^\\n]*?\\$\\s*([\\d.,]+)\\s*output/i);"), "the test's parse is the watcher's");
  const live = "Text/thinking tokens (per 1M): $1.764 input,  $8.823 output.\nImage tokens (per 1M): $1.764 input, $35.294 output. Changing the resolution parameter significantly affects cost.";
  assert.equal(Number(re.exec(live)[1]), 35.294);
  const pw = read("app/pricing-watch.jsx");
  assert.ok(pw.includes('"gemini-nano-banana-2.1": "Nano Banana 2.1",') && !pw.includes("Lite"));
});

await test("keys: the changed app files are re-keyed", () => {
  const html = read("TURN.html");
  for (const f of ["imagegen", "artroom", "plans", "pricing", "pricing-watch", "ai", "script"])
    assert.ok(["20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/' + f + '.jsx?v=' + k + '"')), f);
});

console.log(`\n${checks} passed, ${failed} failed`);
if (failed) process.exit(1);

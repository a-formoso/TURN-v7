#!/usr/bin/env node
/* test-image-engines-oct11.mjs — the image engines (2026-10-11, owner — image engines; 2026-11-12, owner).
   2026-10-11: the engines became exactly Nano Banana 2.1, GPT Image 2.5 Flare, GPT Image 2.5 Sunburst and the new
   Seedream 5 Pro; Nano Banana 2, Nano Banana Pro and GPT Image 2 were removed (a locked likeness rendered the
   wrong face on them). 2026-11-12: GPT Image 2.6 Flare / Sunburst (added 2026-11-05 — test-gpt-image-2-6.mjs)
   REPLACED 2.5, and Seedream 5.5 was added beside Seedream 5 Pro. Today's five, in order: Nano Banana 2.1,
   GPT Image 2.6 Flare, GPT Image 2.6 Sunburst, Seedream 5.5, Seedream 5 Pro.
   Offline: the real app sources run in node:vm sandboxes, the server's pure modules are imported, and
   index.ts / pricing-watch are checked at source level.

     A  the picker: exactly five engines, in order; both Seedream entries (1K / 2K, no quality, no grounding)
     B  prices: the app's and the server's tables agree — Seedream (each engine its own row) by pixel area plus its
        fee per reference after the first, GPT Image 2.6 at OpenAI's 1024x1024 rows — and the chips quote what the
        server holds
     C  Seedream's fal routes and input: text-to-image without references, edit with references (at most 10),
        image_size {width, height} inside fal's limits, no seed / web search / quality, 4K rendered at 2K
     D  old ids (GPT Image 2.5's included): mapped where the app reads them and on the server before the gate, the
        price and the route; the direct OpenAI image route is retired; GPT Image 2's quality carries over
     E  old assets keep their historical labels
     F  plan gates: Seedream has GPT Image 2.6 Sunburst's access (Writer 2K, Director / Producer 2K — its ceiling)
     G  Home posters paint on GPT Image 2.6 Sunburst, and their price chip is the server's price
     H  grounding is Nano Banana 2.1's only; image-search grounding and GPT Image 2's moderation field are gone
     I  the GPT refusal fallback names Nano Banana 2.1
     J  the price-drift watcher: removed engines gone, Seedream 5 Pro watched, Seedream 5.5 flagged once fal
        prices it, GPT 2.6 baseline, dotted ids read
     K  no removed engine id is left anywhere except the mapping / historical tables

   node scripts/test-image-engines-oct11.mjs */
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
const NB21 = "gemini-nano-banana-2.1", FLARE = "gpt-image-2.6-flare", SUN = "gpt-image-2.6-sunburst", SEED = "seedream-5-pro", SEED55 = "seedream-5.5";
/* both Seedream engines share their sizes, reference limit, request shape and (until fal prices 5.5) their numbers */
const SEEDS = [SEED, SEED55], SEED_LABEL = { [SEED]: "Seedream 5 Pro", [SEED55]: "Seedream 5.5" };
/* retired ids → what serves them (2026-11-12: GPT Image 2.5 Flare / Sunburst → 2.6; GPT Image 2 → 2.6 Sunburst) */
const REMOVED = { "gemini-3.1-flash-image": NB21, "gemini-3-pro-image": NB21, "gpt-image-2": SUN,
  "gpt-image-2.5-flare": FLARE, "gpt-image-2.5-sunburst": SUN };
const ASPECTS = ["16:9", "9:16", "21:9", "1:1", "3:4", "4:3"];

const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
/* an Image that never loads: downscaleRef keeps the data URL as it is */
class FakeImage { set src(_v){ setTimeout(() => this.onerror && this.onerror(), 0); } }
function box(extra){
  const b = { console: { ...console, warn: noop, info: noop }, Date, Promise, Math, JSON, Number, String, Object, Array, RegExp, Map, Set, Uint8Array, URL, AbortController,
    isFinite, parseInt, parseFloat, queueMicrotask, setTimeout, clearTimeout,
    React: { createElement: () => null, useState: (i) => [i, noop], useEffect: noop },
    Image: FakeImage, FileReader: class {}, Blob: class {}, atob: (s) => s, fetch: async () => { throw new Error("no fetch"); },
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
const app = () => { const b = box(); run(b, "app/pricing.jsx"); run(b, "app/plans.jsx"); run(b, "app/imagegen.jsx"); return b; };

const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
const pol = await import(new URL("supabase/functions/image-proxy/billing-policy.mjs", ROOT));
const iq = await import(new URL("supabase/functions/image-proxy/image-quality.mjs", ROOT));
const proxySrc = read("supabase/functions/image-proxy/index.ts");
const watchSrc = read("supabase/functions/pricing-watch/index.ts");
const artSrc = read("app/artroom.jsx");
const imgSrc = read("app/imagegen.jsx");

const A = app();
/* imagegen alone: its fallback price table and Seedream formula */
const G = box(); run(G, "app/imagegen.jsx");

/* ═══ A ═══ */
await test("A the picker: exactly Nano Banana 2.1, GPT Image 2.6 Flare, GPT Image 2.6 Sunburst, Seedream 5.5, Seedream 5 Pro — in that order", () => {
  // (2026-11-12, owner) GPT Image 2.6 replaced 2.5 (test-gpt-image-2-6.mjs); Seedream 5.5 added above Seedream 5 Pro
  assert.deepEqual(plain(A.NB_MODELS.map((m) => [m.id, m.label])), [
    [NB21, "Nano Banana 2.1"], [FLARE, "GPT Image 2.6 Flare"], [SUN, "GPT Image 2.6 Sunburst"],
    [SEED55, "Seedream 5.5"], [SEED, "Seedream 5 Pro"]]);
  assert.deepEqual(plain(A.NB_MODELS.find((m) => m.id === SEED)), { id: SEED, label: "Seedream 5 Pro", provider: "fal", family: "seedream",
    falModel: "bytedance/seedream/v5/pro/text-to-image", falEditModel: "bytedance/seedream/v5/pro/edit", maxRes: "2K", maxRefs: 10,
    note: "rich detail · strong likeness" });
  assert.deepEqual(plain(A.NB_MODELS.find((m) => m.id === SEED55)), { id: SEED55, label: "Seedream 5.5", provider: "fal", family: "seedream",
    falModel: "bytedance/seedream/v5.5/text-to-image", falEditModel: "bytedance/seedream/v5.5/edit", maxRes: "2K", maxRefs: 10,
    note: "newest Seedream · rich detail" });
  for (const id of Object.keys(REMOVED)) assert.ok(!A.NB_MODELS.some((m) => m.id === id), id + " is not offered");
  for (const m of SEEDS) {
    assert.equal(A.providerOfModel(m), "fal", m);
    assert.equal(A.isSeedreamModel(m), true, m); assert.equal(srv.isSeedreamModel(m), true, m);
    assert.equal(A.isGptImageModel(m), false, "no GPT quality control for Seedream");
    assert.equal(A.nbModelGrounds(m), false, "no grounding toggle for Seedream");
    assert.equal(A.nbModelMaxRes(m), "2K");
    assert.deepEqual(["1K", "2K", "4K"].map((r) => A.nbModelRes(m, r)), ["1K", "2K", "2K"], m);
    assert.equal(A.nbModelMaxRefs(m), 10, m);
    assert.equal(A.nbCanonicalModelId(m), m, "not a retired id"); assert.equal(A.nbModelLabel(m), SEED_LABEL[m]);
    assert.equal(iq.validateImageQuality(m, undefined).pricingQuality, undefined, "no quality on the server either");
    assert.ok(!(m in iq.IMAGE_QUALITY_CAPABILITIES));
  }
  for (const m of [NB21, FLARE, SUN, "seedream-5", "seedream-5.5-pro", "", undefined]) { assert.equal(A.isSeedreamModel(m), false, String(m)); assert.equal(srv.isSeedreamModel(m), false, String(m)); }
  assert.deepEqual([...srv.SEEDREAM_MODELS], SEEDS); assert.equal(srv.SEEDREAM_MODEL, SEED, "the constant still names Seedream 5 Pro");
  assert.equal(A.nbModelMaxRes(NB21), "4K"); assert.equal(A.nbModelMaxRes(SUN), "4K"); assert.equal(A.nbModelMaxRefs(NB21), null);
  // the dock: Seedream offers 1K and 2K, a 4K setting says it renders at 2K; quality only for GPT
  assert.ok(artSrc.includes("const resChoices = allRes.slice(0, Math.max(1, allRes.indexOf(maxRes)+1));"));
  assert.ok(artSrc.includes('modelLabel+" renders up to "+maxRes+" \\u2014 your "+resv+" setting renders at "+shownRes+" here."'));
  assert.ok(artSrc.includes('isGpt && React.createElement("div",{className:"nb-ctl"},'), "the quality control is GPT-only");
  assert.ok(artSrc.includes(': model==="seedream-5.5" ? "SD5.5"\n    : model==="seedream-5-pro" ? "SD5"'), "their dock chips");
  // the default (first) engine and the draft engine stay Nano Banana 2.1
  A.localStorage.removeItem("turn-nb-model");
  assert.equal(A.nbGetModel(), NB21);
  assert.deepEqual(plain(A.TURN_DRAFT_IMAGE), { model: NB21, label: "Nano Banana 2.1", maxRes: "1K" });
  assert.deepEqual(plain(pol.DRAFT_IMAGE), { model: NB21, maxRes: "1K" });
});

/* ═══ B ═══ */
await test("B the app's and the server's image tables agree, GPT Image 2.6 at OpenAI's 1024x1024 rows, each Seedream engine its own row", () => {
  assert.deepEqual(plain(A.TURN_PRICING.image.providerUsd), plain(srv.IMAGE_PROVIDER_USD), "the whole table");
  assert.deepEqual(Object.keys(srv.IMAGE_PROVIDER_USD), [NB21, FLARE, SUN, SEED, SEED55]);
  assert.deepEqual(Object.keys(plain(A.TURN_PRICING.image.providerUsd)), [NB21, FLARE, SUN, SEED, SEED55], "the app's keys, in the server's order");
  const gpt = { default: 0.05268, auto: 0.21072, low: 0.02469, medium: 0.04347, high: 0.05268, xhigh: 0.09366, max: 0.21072 };
  for (const m of [FLARE, SUN]) assert.deepEqual(plain(srv.IMAGE_PROVIDER_USD[m]), gpt, m);
  // Seedream 5.5 has its OWN row (fal has published no price for it: held at Seedream 5 Pro's numbers)
  for (const m of SEEDS) assert.deepEqual(plain(srv.IMAGE_PROVIDER_USD[m]), { standard: 0.0675, large: 0.135, extraRef: 0.0045 }, m);
  assert.notEqual(srv.IMAGE_PROVIDER_USD[SEED55], srv.IMAGE_PROVIDER_USD[SEED], "two rows, not one shared object");
  assert.deepEqual(plain(srv.GOOGLE_IMAGE_USD), { [NB21]: { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 } });
  // imagegen's fallback copy is the same table
  const fallback = vm.runInContext("NB_IMG_USD", G);
  assert.deepEqual(plain(fallback), plain(srv.IMAGE_PROVIDER_USD));
  assert.deepEqual(Object.keys(plain(fallback)).sort(), Object.keys(srv.IMAGE_PROVIDER_USD).sort());
});
await test("B Seedream: the size sent picks the tier — 1K ≈ 1.05 MP = $0.0675 (7 credits), 2K ≈ 4.1-4.19 MP = $0.135 (14); app = server", () => {
  for (const a of ASPECTS) for (const r of ["1K", "2K", "4K"]) {
    const s = srv.seedreamImageDimensions(a, r), c = plain(A.turnSeedreamImageDimensions(a, r));
    assert.deepEqual(c, s, a + " " + r);
    const px = s.width * s.height;
    assert.equal(px <= 1536 * 1536, r === "1K", a + " " + r + " tier");
    for (const m of SEEDS) {
      assert.equal(srv.imageCost({ route: "fal", model: m, aspect: a, imageSize: r }).credits, r === "1K" ? 7 : 14, m + " " + a + " " + r);
      assert.equal(srv.imageCost({ route: "fal", model: m, aspect: a, imageSize: r }).providerCostUsd, r === "1K" ? 0.0675 : 0.135, m + " " + a + " " + r);
      assert.equal(srv.imageCost({ route: "fal", model: m, aspect: a, imageSize: r, unit: 0.03 }).credits, r === "1K" ? 3 : 5, "before the switch");
      assert.equal(A.nbImageCostText(1, { model: m, aspect: a, res: r }), r === "1K" ? "7" : "14", m + " chip " + a + " " + r);
      assert.equal(G.nbImageCostText(1, { model: m, aspect: a, res: r }), r === "1K" ? "7" : "14", m + " fallback chip " + a + " " + r);
      assert.equal(A.turnSeedreamProviderUsd(a, r, 0, m), srv.seedreamCostUsd({ aspect: a, imageSize: r, referenceImages: 0, model: m }), "the app's formula is the server's");
    }
  }
});
await test("B Seedream 5.5 is priced from ITS row, Seedream 5 Pro from its own — on the server, in the app and in imagegen's fallback", () => {
  // the two rows hold the same numbers today, so only a changed row shows which one an engine reads
  const table = { ...plain(srv.IMAGE_PROVIDER_USD), [SEED55]: { standard: 0.09, large: 0.18, extraRef: 0.01 } };
  const usd = (m, size, refs) => srv.imageCost({ route: "fal", model: m, aspect: "16:9", imageSize: size, referenceImages: refs, table }).providerCostUsd;
  assert.equal(usd(SEED55, "1K", 0), 0.09); assert.equal(usd(SEED55, "2K", 0), 0.18); assert.ok(Math.abs(usd(SEED55, "2K", 4) - 0.21) < 1e-12);
  assert.equal(usd(SEED, "1K", 0), 0.0675); assert.equal(usd(SEED, "2K", 0), 0.135); assert.ok(Math.abs(usd(SEED, "2K", 4) - 0.1485) < 1e-12);
  assert.equal(srv.seedreamCostUsd({ aspect: "16:9", imageSize: "1K", table, model: SEED55 }), 0.09);
  assert.equal(srv.seedreamCostUsd({ aspect: "16:9", imageSize: "1K", table }), 0.0675, "no model named = Seedream 5 Pro, as before");
  assert.equal(srv.seedreamCostUsd({ aspect: "16:9", imageSize: "1K", table, model: "gpt-image-2.6-flare" }), 0.0675, "never another engine's row");
  // an admin's reviewed override of Seedream 5.5 reaches its chips and the server's hold — and leaves 5 Pro alone
  const W = app();
  assert.equal(W.turnApplyPricingOverrides({ image: { [SEED55]: { standard: 0.09, large: 0.18, extraRef: 0.01, bogus: 1 } } }), true);
  assert.ok(!("bogus" in W.TURN_PRICING.image.providerUsd[SEED55]));
  const merged = iq.mergeImagePricingOverrides(srv.IMAGE_PROVIDER_USD, { image: { [SEED55]: { standard: 0.09, large: 0.18, extraRef: 0.01 } } });
  for (const m of SEEDS) for (const size of ["1K", "2K", "4K"]) for (const refs of [0, 1, 4, 10, 12]) {
    const server = srv.imageCost({ route: "fal", model: m, aspect: "16:9", imageSize: size, referenceImages: refs, table: merged }).credits;
    assert.equal(W.nbImageCostText(1, { model: m, aspect: "16:9", res: size, refs }), String(server), [m, size, refs].join(" "));
  }
  assert.deepEqual(["1K", "2K"].map((r) => W.nbImageCostText(1, { model: SEED55, aspect: "16:9", res: r })), ["9", "18"]);
  assert.deepEqual(["1K", "2K"].map((r) => W.nbImageCostText(1, { model: SEED, aspect: "16:9", res: r })), ["7", "14"]);
  assert.ok(imgSrc.includes("usd = _nbSeedreamUsd(t, opts.aspect || opts.aspectRatio || nbGetAspect(), choice.res || nbGetRes(), opts.refs, model);"), "the chip names its engine");
});
await test("B Seedream's fee per reference after the first ($0.0045), capped at 10 references — chips and server agree", () => {
  for (const m of SEEDS) {
    const usd = (refs, size) => srv.imageCost({ route: "fal", model: m, aspect: "16:9", imageSize: size, referenceImages: refs }).providerCostUsd;
    assert.equal(usd(0, "1K"), 0.0675); assert.equal(usd(1, "1K"), 0.0675, "the first reference is free");
    assert.ok(Math.abs(usd(2, "1K") - 0.072) < 1e-12); assert.ok(Math.abs(usd(10, "1K") - 0.108) < 1e-12);
    assert.equal(usd(14, "1K"), usd(10, "1K"), "at most 10 are sent, so at most 10 are priced");
    assert.ok(Math.abs(usd(10, "2K") - 0.1755) < 1e-12);
    assert.equal(usd(3, "4K"), usd(3, "2K"), "a 4K request is priced as the 2K it renders at");
    for (const size of ["1K", "2K", "4K"]) for (const refs of [0, 1, 2, 3, 6, 10, 12]) {
      const server = srv.imageCost({ route: "fal", model: m, aspect: "16:9", imageSize: size, referenceImages: refs }).credits;
      assert.equal(A.nbImageCostText(1, { model: m, aspect: "16:9", res: size, refs }), String(server), m + " " + size + " refs " + refs);
      assert.equal(G.nbImageCostText(1, { model: m, aspect: "16:9", res: size, refs }), String(server), m + " fallback " + size + " refs " + refs);
      assert.equal(A.nbImageCostText(3, { model: m, aspect: "16:9", res: size, refs }), String(server * 3), "a batch is count x the per-image price");
    }
    assert.equal(srv.imageCost({ route: "fal", model: m, imageSize: "2K", webSearch: true }).credits, 14, "never a web-search charge");
    assert.equal(srv.imageCost({ route: "fal", model: m, imageSize: "2K", pricingKey: "max" }).credits, 14, "no quality setting to price");
  }
});
await test("B GPT Image 2.6 Flare / Sunburst: every quality x aspect x resolution x reference count — chips = server", () => {
  for (const m of [FLARE, SUN]) for (const q of ["default", "auto", "low", "medium", "high", "xhigh", "max"]) for (const a of ASPECTS) for (const r of ["1K", "2K", "4K"]) for (const refs of [0, 2]) {
    const server = srv.imageCost({ route: "fal", model: m, aspect: a, imageSize: r, pricingKey: iq.imagePricingQuality(m, q), referenceImages: refs }).credits;
    assert.equal(A.nbImageCostText(1, { model: m, quality: q, aspect: a, res: r, refs }), String(server), [m, q, a, r, refs].join(" "));
  }
  // the 1024x1024 row, at today's unit (GPT Image 2.5's was 1 / 2 / 6 / 10 / 22: low and medium cost more on 2.6)
  const sq = (q) => srv.imageCost({ route: "fal", model: SUN, aspect: "1:1", imageSize: "1K", pricingKey: q }).credits;
  assert.deepEqual(["low", "medium", "high", "xhigh", "max"].map(sq), [3, 5, 6, 10, 22]);
});
await test("B Nano Banana 2.1 is unchanged: 5 / 7 / 15, web grounding +$0.015", () => {
  assert.deepEqual(["1K", "2K", "4K"].map((s) => srv.imageCost({ route: "fal", model: NB21, imageSize: s }).credits), [5, 7, 15]);
  assert.deepEqual(["1K", "2K", "4K"].map((r) => A.nbImageCostText(1, { model: NB21, res: r, ground: false })), ["5", "7", "15"]);
  assert.equal(srv.imageCost({ route: "fal", model: NB21, imageSize: "1K", webSearch: true }).credits, 7);
  assert.equal(A.nbImageCostText(1, { model: NB21, res: "1K", ground: true }), "7");
});

/* ═══ C ═══ */
await test("C Seedream's fal routes: text-to-image without references, the edit route (image_urls) with them", () => {
  assert.ok(proxySrc.includes('"seedream-5-pro":              { base: "bytedance/seedream/v5/pro/text-to-image", edit: "bytedance/seedream/v5/pro/edit", family: "seedream" },'));
  assert.ok(proxySrc.includes('"seedream-5.5":                { base: "bytedance/seedream/v5.5/text-to-image", edit: "bytedance/seedream/v5.5/edit", family: "seedream" },'), "Seedream 5.5's routes (2026-11-12)");
  // the app's picker names the same fal routes the proxy serves
  for (const m of SEEDS) { const e = plain(A.NB_MODELS.find((x) => x.id === m));
    assert.ok(proxySrc.includes('{ base: "' + e.falModel + '", edit: "' + e.falEditModel + '", family: "seedream" }'), m); }
  assert.ok(proxySrc.includes("const endpoint = imageUrls.length && cfg.edit ? cfg.edit : cfg.base;"));
  const i = proxySrc.indexOf('} else if (cfg.family === "seedream") {'), j = proxySrc.indexOf("} else {", i);
  assert.ok(i > 0 && j > i, "a Seedream branch builds its input");
  const branch = proxySrc.slice(i, j);
  assert.ok(branch.includes("input.image_size = seedreamImageDimensions(aspect, imageSize);"));
  assert.ok(branch.includes("input.num_images = 1;") && branch.includes("input.enable_safety_checker = true;"));
  assert.ok(branch.includes("if (imageUrls.length) input.image_urls = imageUrls.slice(0, SEEDREAM_MAX_REFERENCES);"));
  const code = branch.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/\bseed\b|web_search|enable_web_search|quality|max_images|moderation/.test(code), "no seed, no web search, no quality, no max_images");
  // the references the server keeps (and prices) are the first 10, read where the request is read
  assert.ok(proxySrc.includes("const images: string[] = isSeedreamModel(model) ? allImages.slice(0, SEEDREAM_MAX_REFERENCES) : allImages;"), "for both Seedream engines");
  assert.ok(!/model === SEEDREAM_MODEL/.test(proxySrc), "nothing in index.ts is Seedream 5 Pro's alone");
  assert.equal(srv.SEEDREAM_MAX_REFERENCES, 10);
  // a 4K request is 2K before the plan gate and the price
  const k = proxySrc.indexOf('const imageSize = isSeedreamModel(model) && body.imageSize === "4K" ? seedreamImageSize("4K") : (body.imageSize || "2K");');
  assert.ok(k > 0 && k < proxySrc.indexOf("const imageGate = checkImage(account, { model, imageSize });"));
  assert.equal(srv.seedreamImageSize("4K"), "2K"); assert.equal(srv.seedreamImageSize("1K"), "1K");
});
await test("C Seedream's image_size is {width, height} inside fal's limits (1024²-2048², aspect 1/16-16, multiples of 16)", () => {
  for (const a of ASPECTS) for (const r of ["1K", "2K", "4K"]) {
    const { width, height } = srv.seedreamImageDimensions(a, r);
    assert.ok(Number.isInteger(width) && Number.isInteger(height) && width % 16 === 0 && height % 16 === 0, a + r);
    assert.ok(width * height >= 1024 * 1024 && width * height <= 2048 * 2048, a + " " + r + " " + width + "x" + height);
    assert.ok(width / height >= 1 / 16 && width / height <= 16);
    const [aw, ah] = a.split(":").map(Number);
    assert.ok(Math.abs(width / height - aw / ah) / (aw / ah) < 0.03, "keeps the aspect " + a);
  }
  assert.deepEqual(srv.seedreamImageDimensions("16:9", "1K"), { width: 1376, height: 768 });
  assert.deepEqual(srv.seedreamImageDimensions("16:9", "2K"), { width: 2720, height: 1536 });
  assert.deepEqual(srv.seedreamImageDimensions("1:1", "2K"), { width: 2048, height: 2048 });
});
await test("C the app sends Seedream the first 10 references (and says so), a 4K pick as 2K (and says so), no moderation", async () => {
 for (const SEED of SEEDS) {   // both engines, each named by its own label
  const B = app();
  B.turnIsPaidPlan = paidFn; B.turnIsAdmin = false; B.turnCreditBalance = { remaining: 900, plan: "director" };
  const bodies = [];
  B.sbClient = () => ({ functions: { invoke: async (_fn, { body }) => { bodies.push(body); return { data: { error: "stop here" } }; } } });
  const refs = Array.from({ length: 13 }, (_, i) => "data:image/png;base64,R" + i);
  const metaOut = {};
  await assert.rejects(B.nbGenerate("a lighthouse", { model: SEED, imageSize: "4K", referenceImage: refs[0], extraImages: refs.slice(1), metaOut, noRetry: true }), /stop here/);
  const b = bodies[0];
  assert.equal(b.model, SEED); assert.equal(b.provider, "fal"); assert.equal(b.imageSize, "2K", "4K is sent as 2K");
  assert.deepEqual(plain(b.images), refs.slice(0, 10), "the FIRST 10, in order");
  assert.ok(!("moderation" in b) && !("groundImageSearch" in b) && b.groundSearch === false);
  assert.deepEqual(plain(metaOut), { imageSize: "2K", referencesCapped: { sent: 10, dropped: 3 } });
  const t = B.toasts.map((x) => x.m);
  assert.ok(t.includes(SEED_LABEL[SEED] + " renders up to 2K, so this image is 2K."), t.join(" | "));
  assert.ok(t.includes(SEED_LABEL[SEED] + " uses at most 10 reference images, so the first 10 were sent (3 left out)."));
  // the chip names the engine's ceiling, and the dock / meta record the size really rendered
  B.localStorage.setItem("turn-nb-res", "4K");
  assert.deepEqual(plain(B.nbPlanImageChoice(SEED, "4K")), { model: SEED, res: "2K", limited: false, modelLimited: true });
  assert.ok(imgSrc.includes('choice.modelLimited ? " ("+(((m&&m.label)||model))+" renders up to "+nbModelMaxRes(model)+")"'));
  assert.ok(artSrc.includes("size: (genOpts.metaOut && genOpts.metaOut.imageSize) || genOpts.imageSize ||"));
  // GPT Image still gets its references unchanged, and no moderation field either
  bodies.length = 0;
  await assert.rejects(B.nbGenerate("x", { model: SUN, quality: "high", imageSize: "2K", referenceImage: refs[0], extraImages: refs.slice(1), noRetry: true }));
  assert.equal(bodies[0].images.length, 13); assert.ok(!("moderation" in bodies[0]));
 }
});
await test("C a refused Seedream image (no image) releases the hold: the server's no-image path, in the finally", () => {
  assert.ok(proxySrc.includes('if (!url) return json({ error: "The image service returned no image." }, 200);'));
  assert.ok(proxySrc.includes("finally { if (imageHold) await imageHold.releaseUnlessDone(); }"));
  assert.ok(proxySrc.includes('if (st === "FAILED" || st === "ERROR") return json({ error: say(sd?.error || sd?.detail, "The image couldn\'t be generated.") }, 200);'));
});

/* ═══ D ═══ */
await test("D the app maps the removed ids: a saved pick (and the dated GPT id), nbSetModel, an option, a chip", async () => {
  for (const [old, now] of Object.entries(REMOVED)) {
    const B = app();
    assert.equal(B.nbCanonicalModelId(old), now);
    B.localStorage.setItem("turn-nb-model", old);
    assert.equal(B.nbGetModel(), now, old); assert.equal(B.localStorage.getItem("turn-nb-model"), now, "persisted once");
    B.nbSetModel(old); assert.equal(B.localStorage.getItem("turn-nb-model"), now);
    B.turnIsPaidPlan = paidFn; B.turnIsAdmin = false; B.turnCreditBalance = { remaining: 900, plan: "director" };
    const calls = [];
    B.proxyGenerate = async (_p, opts, provider) => { calls.push({ model: opts.model, provider }); return "data:image/png;base64,X"; };
    B.nbAssertMediaIdentity = noop;
    await B.nbGenerate("a lighthouse", { model: old, imageSize: "2K", quality: "high" });
    assert.deepEqual(calls[0], { model: now, provider: "fal" }, old);
    assert.equal(B.nbImageCostText(1, { model: old, res: "2K", quality: "high", ground: false, aspect: "16:9" }),
      B.nbImageCostText(1, { model: now, res: "2K", quality: "high", ground: false, aspect: "16:9" }), "priced as its successor");
  }
  const C = app();
  C.localStorage.setItem("turn-nb-model", "gpt-image-2-2026-04-01");
  assert.equal(C.nbGetModel(), SUN, "the dated GPT Image 2 id follows GPT Image 2 (to 2.6 Sunburst)");
  assert.deepEqual(plain(vm.runInContext("NB_LEGACY_MODEL_IDS", C)), { "gemini-3.1-flash-lite-image": NB21, ...REMOVED }, "the app's map is the server's");
  // GPT Image 2's saved quality (the shared key) carries over to its successor when it is one of its values
  const Q = app();
  Q.localStorage.setItem("turn-oai-quality", "high");
  assert.equal(Q.nbGetOaiQuality(SUN), "high");
  assert.ok(artSrc.includes('const _requestedModel = (typeof nbCanonicalModelId==="function" ? nbCanonicalModelId : (x=>x))(gopts.model'));
  assert.ok(imgSrc.includes("const model = nbCanonicalModelId(opts.model || nbGetModel());"), "proxyGenerate maps too");
});
await test("D the server maps them before the gate, the price and the route; the quality carries; the direct OpenAI route is retired", () => {
  assert.deepEqual(plain(srv.LEGACY_IMAGE_MODEL_IDS), { "gemini-3.1-flash-lite-image": NB21, ...REMOVED });
  for (const [old, now] of Object.entries(REMOVED)) {
    assert.equal(srv.canonicalImageModel(old), now);
    assert.ok(srv.imageCost({ route: "fal", model: srv.canonicalImageModel(old), imageSize: "2K", pricingKey: /gpt/.test(now) ? "high" : undefined }));
    assert.equal(srv.imageCost({ route: "fal", model: old, imageSize: "2K" }), null, old + " itself has no price");
  }
  for (const x of [NB21, FLARE, SUN, SEED, SEED55, "claude-opus-5-5", "", undefined]) assert.equal(srv.canonicalImageModel(x), x);
  // a request naming no model is GPT Image 2.6 Sunburst (it was 2.5 Sunburst, and GPT Image 2 before that)
  const i = proxySrc.indexOf('const model = textLegacy ? textLegacy.model : canonicalImageModel(body.model || "gpt-image-2.6-sunburst");');
  assert.ok(proxySrc.includes('if (!textLegacy && model !== (body.model || "gpt-image-2.6-sunburst") && !legacyImageModelLogged) {'), "…and is not logged as a retired id");
  assert.ok(i > 0 && i < proxySrc.indexOf("const imageGate = checkImage(account, { model, imageSize });") && i < proxySrc.indexOf("const imageRouteOk ="));
  assert.ok(i < proxySrc.indexOf("validateImageQuality(model, rawQuality)"), "the quality is validated on the successor");
  for (const q of ["low", "medium", "high"]) {
    const v = iq.validateImageQuality(srv.canonicalImageModel("gpt-image-2"), q);
    assert.equal(v.ok, true); assert.equal(v.pricingQuality, q, "GPT Image 2's " + q + " stays " + q);
  }
  for (const old of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) assert.ok(!(old in iq.IMAGE_QUALITY_CAPABILITIES), old);
  // the direct OpenAI image route: nothing priced, an older app's provider "openai" is served on fal
  assert.deepEqual(plain(srv.OPENAI_DIRECT_IMAGE_MODELS), []);
  assert.equal(srv.imageCost({ route: "openai", model: SUN, imageSize: "2K", pricingKey: "high" }), null);
  assert.ok(proxySrc.includes('const imageProvider = provider === "openai" ? "fal" : provider;'));
  assert.ok(!proxySrc.includes("api.openai.com/v1/images"), "no direct OpenAI image call is left");
  assert.ok(!proxySrc.includes("OPENAI_DIRECT_IMAGE_MODELS"));
});

/* ═══ E ═══ */
await test("E old assets keep their historical labels", () => {
  assert.equal(A.nbModelLabel("gemini-3.1-flash-image"), "Nano Banana 2");
  assert.equal(A.nbModelLabel("gemini-3-pro-image"), "Nano Banana Pro");
  assert.equal(A.nbModelLabel("gpt-image-2"), "GPT Image 2");
  assert.equal(A.nbModelLabel("gemini-3.1-flash-lite-image"), "Nano Banana 2 Lite");
  assert.equal(A.nbModelLabel("gpt-image-2.5-flare"), "GPT Image 2.5 Flare", "an image made on 2.5 keeps naming it (2026-11-12)");
  assert.equal(A.nbModelLabel("gpt-image-2.5-sunburst"), "GPT Image 2.5 Sunburst");
  assert.equal(A.nbModelLabel(SEED), "Seedream 5 Pro"); assert.equal(A.nbModelLabel(SEED55), "Seedream 5.5");
  assert.deepEqual(plain(vm.runInContext("NB_HISTORICAL_MODEL_LABELS", A)), { "gemini-3.1-flash-lite-image": "Nano Banana 2 Lite", "gemini-3.1-flash-image": "Nano Banana 2",
    "gemini-3-pro-image": "Nano Banana Pro", "gpt-image-2": "GPT Image 2", "gpt-image-2.5-flare": "GPT Image 2.5 Flare", "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst" });
  assert.ok(artSrc.includes('genMeta.modelLabel || (typeof nbModelLabel==="function" ? nbModelLabel(genMeta.modelId) :'));
});

/* ═══ F ═══ */
await test("F plan gates: Seedream 5 Pro and 5.5 have GPT Image 2.6 Sunburst's access; drafts stay Nano Banana 2.1 at 1K", () => {
  const code = (r) => r && r.body && r.body.code;
  const none = { plan: "none", trial: true, remaining: 50 }, writer = { plan: "writer", remaining: 600 }, director = { plan: "director", remaining: 1600 }, studio = { plan: "studio", remaining: 5000 };
  for (const m of [SUN, FLARE, SEED, SEED55]) {
    assert.equal(code(pol.checkImage(none, { model: m, imageSize: "1K" })), "plan_required", m);
    assert.equal(pol.checkImage(writer, { model: m, imageSize: "2K" }), null, m);
    assert.equal(code(pol.checkImage(writer, { model: m, imageSize: "4K" })), "tier_required", m);
    for (const acc of [director, studio]) assert.equal(pol.checkImage(acc, { model: m, imageSize: "2K" }), null);
  }
  assert.equal(pol.checkImage(director, { model: SUN, imageSize: "4K" }), null);
  // Seedream's 4K is 2K before the gate (index.ts), so a Writer's saved 4K renders at 2K, not refused
  for (const m of SEEDS) assert.equal(pol.checkImage(writer, { model: m, imageSize: srv.seedreamImageSize("4K") }), null, m);
  // the app mirrors it
  A.turnIsPaidPlan = paidFn; A.turnIsAdmin = false;
  for (const m of SEEDS) {
    A.turnCreditBalance = { remaining: 600, plan: "writer" };
    assert.deepEqual(plain(A.nbPlanImageChoice(m, "4K")), { model: m, res: "2K", limited: true });
    assert.deepEqual(plain(A.nbPlanImageChoice(m, "2K")), { model: m, res: "2K", limited: false });
    A.turnCreditBalance = { remaining: 1600, plan: "director" };
    assert.deepEqual(plain(A.nbPlanImageChoice(m, "4K")), { model: m, res: "2K", limited: false, modelLimited: true });
  }
  assert.deepEqual(plain(A.nbPlanImageChoice(SUN, "4K")), { model: SUN, res: "4K", limited: false });
  A.turnCreditBalance = { remaining: 50, plan: "none", trial: true };
  for (const m of [SEED, SEED55, SUN, FLARE, ...Object.keys(REMOVED)]) assert.deepEqual(plain(A.turnPlanImageChoice(m, "2K")), { model: NB21, res: "1K", limited: true }, m);
  for (const m of SEEDS) assert.equal(A.nbImageCostText(1, { model: m, res: "2K" }), "5", "a trial's chip quotes the draft");
  A.turnCreditBalance = null;
});

/* ═══ G ═══ */
await test("G Home posters paint on GPT Image 2.6 Sunburst at high / 2K / 9:16, and the chip quotes that", () => {
  const appSrc = read("app/app.jsx"), home = read("app/home-dashboard.jsx");
  assert.ok(appSrc.includes('if((window.NB_MODELS||[]).some(m=>m.id==="gpt-image-2.6-sunburst")) genOpts.model = "gpt-image-2.6-sunburst";'));
  assert.ok(A.NB_MODELS.some((m) => m.id === "gpt-image-2.6-sunburst"), "the engine the poster asks for is offered (else it would paint on the dock's pick)");
  assert.ok(appSrc.includes('const genOpts = { aspectRatio:"9:16", quality:"high", imageSize:"2K" };'));
  assert.ok(home.includes('window.nbImageCostText(Math.max(1, n||1), { model:"gpt-image-2.6-sunburst", quality:"high", res:"2K", aspect:"9:16" })'));
  A.turnCreditBalance = { remaining: 1600, plan: "director" };
  const server = srv.imageCost({ route: "fal", model: SUN, aspect: "9:16", imageSize: "2K", pricingKey: "high" }).credits;
  assert.equal(server, 10, "what it cost on 2.5 Sunburst: 2.6 and 2.5 share the high row");
  assert.equal(A.nbImageCostText(1, { model: SUN, quality: "high", res: "2K", aspect: "9:16" }), String(server));
  A.turnCreditBalance = null;
});

/* ═══ H ═══ */
await test("H grounding is Nano Banana 2.1's only; image-search grounding and the moderation field are gone", () => {
  assert.deepEqual(plain(vm.runInContext("NB_GROUND_MODELS", A)), [NB21]);
  for (const m of [FLARE, SUN, SEED, SEED55]) assert.equal(A.nbModelGrounds(m), false, m);
  assert.equal(A.nbModelGrounds("gemini-3.1-flash-image"), true, "an old Nano Banana 2 id grounds as 2.1, which it runs on");
  assert.ok(proxySrc.includes('const groundSearch = !!body.groundSearch && model === "gemini-nano-banana-2.1";'));
  assert.ok(proxySrc.includes("reqBody.tools = [{ googleSearch: {} }];"));
  for (const [f, src] of [["index.ts", proxySrc], ["imagegen", imgSrc], ["artroom", artSrc]]) {
    assert.ok(!/groundImageSearch|imageSearch:/.test(src), f + ": no image-search grounding");
  }
  assert.ok(!/input\.moderation|form\.append\("moderation"|moderation: opts\.moderation/.test(proxySrc + imgSrc), "no moderation field is sent");
  assert.ok(artSrc.includes('"Web"))), document.body)))),') && !artSrc.includes('"Web + images"'));
  assert.ok(artSrc.includes("if(groundEnabled && groundsWeb){ genOpts.groundSearch = true; }"));
});

/* ═══ I ═══ */
await test("I a GPT Image content-policy refusal falls back to Nano Banana 2.1 (not merely the first non-GPT engine)", () => {
  assert.ok(artSrc.includes('const gModel = allModels.find(m=>m.id==="gemini-nano-banana-2.1")'));
  const models = plain(A.NB_MODELS);
  const g = models.find((m) => m.id === NB21) || models.find((m) => !/^gpt-image/.test(m.id));
  assert.equal(g.label, "Nano Banana 2.1");
});

/* ═══ J ═══ */
await test("J the price-drift watcher: the removed engines' pages are gone (GPT Image 2.5's too); Seedream 5 Pro is watched; GPT 2.6's baseline", () => {
  for (const slug of ['"fal-ai/nano-banana-2"', '"fal-ai/nano-banana-pro"', '"openai/gpt-image-2"', '"openai/gpt-image-2.5/flare/text-to-image"', '"openai/gpt-image-2.5/sunburst/text-to-image"'])
    assert.ok(!watchSrc.includes("slug: " + slug), slug);
  assert.ok(!/gemini-3\.1-flash-image|gemini-3-pro-image|gpt-image-2\.(low|medium|high)|gpt-image-2\.5-(flare|sunburst)/.test(watchSrc));
  assert.ok(watchSrc.includes('slug: "bytedance/seedream/v5/pro/text-to-image",') && watchSrc.includes('slug: "bytedance/seedream/v5/pro/edit",'));
  for (const k of ["standard", "large", "extraRef"]) assert.ok(watchSrc.includes(`"image.providerUsd.seedream-5-pro.${k}",`), k);
  // the parse, on fal's catalogue text (2026-10-11; the watcher strips the markdown bold first)
  const t2i = "Tentative pricing is $0.0675 per image for images of total area less than or equal to 1536x1536 pixels. For images with area in between 1536x1536 and 2048x2048 pixels, the price is $0.135 per image.";
  const edit = "You will be charged for both input and output images. The first input image is not charged, and every additional input image will cost $0.0045.   Tentative pricing is $0.0675+ $(0.0045 x number of additional input images) per output image";
  const std = /\$\s*([\d.,]+)\s*per image for images of total area less than or equal to/i, big = /between\s*1536x1536\s*and\s*2048x2048\s*pixels,\s*the price is\s*\$\s*([\d.,]+)/i, ref = /every additional input image will cost\s*\$\s*(\d[\d,]*(?:\.\d+)?)/i;
  for (const re of [std, big, ref]) assert.ok(watchSrc.includes(re.source.replace(/\\/g, "\\")) || watchSrc.includes(String(re).slice(0, -1)), "the test's parse is the watcher's: " + re);
  assert.equal(Number(std.exec(t2i)[1]), 0.0675); assert.equal(Number(big.exec(t2i)[1]), 0.135); assert.equal(Number(ref.exec(edit)[1]), 0.0045);
  // GPT Image 2.6's baseline: both endpoints at $30 / 1M image output tokens, every committed quality row proposed
  assert.ok(watchSrc.includes("low $0.02469,") && watchSrc.includes("medium $0.04347 \u2014 more tokens than 2.5 \u2014 high $0.05268, xhigh $0.09366, max $0.21072"));
  for (const v of ["flare", "sunburst"]) {
    assert.ok(watchSrc.includes('slug: "openai/gpt-image-2.6/' + v + '/text-to-image",') && watchSrc.includes('"gpt-image-2.6-' + v + '-image-output-tokens",'), v);
    for (const q of Object.keys(srv.IMAGE_PROVIDER_USD["gpt-image-2.6-" + v])) assert.ok(watchSrc.includes('"image.providerUsd.gpt-image-2.6-' + v + '.' + q + '",'), v + " " + q);
  }
  assert.equal((watchSrc.match(/"\$\/1M image output tokens",\n\s*30,/g) || []).length, 2, "the two GPT Image watchers, at $30 / 1M");
});
await test("J Seedream 5.5 (no price on fal yet): its page is watched, and the watcher flags it only once fal states a per-image price", () => {
  const i = watchSrc.indexOf('slug: "bytedance/seedream/v5.5/text-to-image",');
  assert.ok(i > 0, "the page is watched");
  const block = watchSrc.slice(i, watchSrc.indexOf("\n  },\n", i));
  assert.ok(!/c\.(abs|rate)\(/.test(block), "no price is read from it (there is none): the seedream-5.5 rows are a holding price");
  assert.ok(!/image\.providerUsd\.seedream-5\.5\./.test(watchSrc), "…so the watcher proposes no seedream-5.5 row by itself");
  const reSrc = /firstMatch\(t, (\/.+\/i)\);/.exec(block);
  assert.ok(reSrc, "one parse");
  const re = vm.runInNewContext(reSrc[1]);
  assert.ok(block.includes('if (listed != null) c.fail("fal now lists a Seedream 5.5 price ($" + listed + " per image) \u2014 set the seedream-5.5 rows from it");'));
  // the watcher's own helper and collector, so the regex is run the way the function runs it
  const fm = /function money\(s: string\): number \{[\s\S]*?\n\}\nfunction firstMatch\(text: string, re: RegExp\): number \| null \{[\s\S]*?\n\}/.exec(watchSrc);
  assert.ok(fm, "money + firstMatch");
  const firstMatch = vm.runInNewContext(fm[0].replace("(s: string): number", "(s)").replace("(text: string, re: RegExp): number | null", "(text, re)") + "\nfirstMatch;");
  const listed = (t) => firstMatch(t, re);
  // fal's page today (2026-11-11): no price — nothing is flagged
  for (const t of ["Seedream 5.5 Text to Image. Your request will cost $0 per compute seconds.", "", "Billed at $0 per image while in preview.", "Commercial use. Up to 10 input images."])
    assert.equal(listed(t), null, "not a price: " + t);
  // the day fal states one, in either of the wordings Seedream 5 Pro's pages use — flagged, with the number
  assert.equal(listed("Tentative pricing is $0.0675 per image for images of total area less than or equal to 1536x1536 pixels."), 0.0675);
  assert.equal(listed("Your request will cost $0.04 per image."), 0.04);
  assert.equal(listed("Tentative pricing is $0.05+ $(0.0045 x number of additional input images) per output image"), null, "(the edit page's formula line alone is not read)");
  assert.equal(listed("Pricing: $ .08 per output image"), 0.08);
  assert.equal(listed("$1 per image"), 1);
});
await test("J the drift card reads dotted model ids (GPT Image 2.6, Seedream 5.5, Nano Banana 2.1, Seedance 2.0) and Seedream's rows", () => {
  const W = app();
  run(W, "app/pricing-watch.jsx");
  const rows = W.turnPricingWatchRows([
    { kind: "abs", path: "image.providerUsd.seedream-5-pro.standard", usd: 0.08 },
    { kind: "abs", path: "image.providerUsd.seedream-5-pro.extraRef", usd: 0.0045 },
    { kind: "abs", path: "image.providerUsd.seedream-5.5.large", usd: 0.15 },
    { kind: "rate", id: "gpt-image-2.6-flare-image-output-tokens", rate: 60, defaultRef: 30, paths: ["image.providerUsd.gpt-image-2.6-flare.low"] },
    { kind: "rate", id: "nb21-image-output-tokens", rate: 70.588, defaultRef: 35.294, paths: ["image.providerUsd.gemini-nano-banana-2.1.1K"] },
    { kind: "abs", path: "video.providerUsdPerSecond.seedance-2.0.standard.720p", usd: 0.4 },
  ]);
  assert.deepEqual(plain(rows.map((r) => [r.path, r.cur, r.next, r.label])), [
    ["image.providerUsd.seedream-5-pro.standard", 0.0675, 0.08, "Seedream 5 Pro · standard"],
    ["image.providerUsd.seedream-5.5.large", 0.135, 0.15, "Seedream 5.5 · large"],
    ["image.providerUsd.gpt-image-2.6-flare.low", 0.02469, 0.0494, "GPT Image 2.6 Flare · low"],
    ["image.providerUsd.gemini-nano-banana-2.1.1K", 0.05, 0.1, "Nano Banana 2.1 · 1K"],
    ["video.providerUsdPerSecond.seedance-2.0.standard.720p", 0.3034, 0.4, "Seedance 2.0 standard · 720p/s"],
  ]);
  // an applied Seedream override reaches the chips (only keys that exist are writable)
  assert.equal(W.turnApplyPricingOverrides({ image: { [SEED]: { standard: 0.08, bogus: 1 } } }), true);
  assert.equal(W.TURN_PRICING.image.providerUsd[SEED].standard, 0.08);
  assert.ok(!("bogus" in W.TURN_PRICING.image.providerUsd[SEED]));
  assert.equal(W.nbImageCostText(1, { model: SEED, aspect: "16:9", res: "1K" }), "8");
  // … and the server merges the same override
  const merged = iq.mergeImagePricingOverrides(srv.IMAGE_PROVIDER_USD, { image: { [SEED]: { standard: 0.08 } } });
  assert.equal(srv.imageCost({ route: "fal", model: SEED, aspect: "16:9", imageSize: "1K", table: merged }).credits, 8);
  const pw = read("app/pricing-watch.jsx");
  assert.ok(pw.includes('"seedream-5-pro": "Seedream 5 Pro",') && pw.includes('"seedream-5.5": "Seedream 5.5",') && !/gemini-3\.1-flash-image|gemini-3-pro-image|"gpt-image-2"|"gpt-image-2\.5-(flare|sunburst)":/.test(pw));
  // a stored check from before 2026-11-12 that still names a GPT Image 2.5 row proposes nothing (the row is gone)
  assert.deepEqual(plain(W.turnPricingWatchRows([{ kind: "rate", id: "gpt-image-2.5-flare-image-output-tokens", rate: 60, defaultRef: 30, paths: ["image.providerUsd.gpt-image-2.5-flare.low"] }])), []);
});

/* ═══ K ═══ */
await test("K no removed engine id is left anywhere — but the mapping and historical tables", () => {
  const files = [
    ...readdirSync(new URL("app/", ROOT)).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => "app/" + f),
    ...readdirSync(ROOT).filter((f) => /\.html$/.test(f)),
    ...readdirSync(new URL("supabase/functions/", ROOT)).flatMap((d) => {
      try { return readdirSync(new URL("supabase/functions/" + d + "/", ROOT)).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => "supabase/functions/" + d + "/" + f); }
      catch (_e) { return []; }
    }),
  ];
  // an id, not GPT Image 2.6's / Nano Banana 2.1's (a regex in the source writes "gpt-image-2\.[56]"); GPT Image 2.5's
  // ids and fal routes joined the removed ones on 2026-11-12
  const ID = /gemini-3\.1-flash-image|gemini-3-pro-image|gpt-image-2(?![.\-\d\\])|nano-banana-2(?![.\-\d\\])|nano-banana-pro|openai\/gpt-image-2(?![.\d\\])|gpt-image-2\.5-(flare|sunburst)|openai\/gpt-image-2\.5\//;
  const allowed = [
    // app/imagegen.jsx NB_LEGACY_MODEL_IDS / NB_HISTORICAL_MODEL_LABELS and the dated-id line
    /^\s*"gemini-3\.1-flash-image":"(gemini-nano-banana-2\.1|Nano Banana 2)",$/,
    /^\s*"gemini-3-pro-image":"(gemini-nano-banana-2\.1|Nano Banana Pro)",$/,
    /^\s*"gpt-image-2":"(gpt-image-2\.6-sunburst|GPT Image 2)",$/,
    /^\s*"gpt-image-2\.5-flare":"(gpt-image-2\.6-flare|GPT Image 2\.5 Flare)",$/,
    /^\s*"gpt-image-2\.5-sunburst":"(gpt-image-2\.6-sunburst|GPT Image 2\.5 Sunburst)",$/,
    /^\s*if\(\/\^gpt-image-2-\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(s\|\|""\)\) s="gpt-image-2";$/,
    // supabase/functions/image-proxy/billing-pricing.mjs LEGACY_IMAGE_MODEL_IDS
    /^\s*"gemini-3\.1-flash-image": "gemini-nano-banana-2\.1",$/,
    /^\s*"gemini-3-pro-image": "gemini-nano-banana-2\.1",$/,
    /^\s*"gpt-image-2": "gpt-image-2\.6-sunburst",$/,
    /^\s*"gpt-image-2\.5-flare": "gpt-image-2\.6-flare",$/,
    /^\s*"gpt-image-2\.5-sunburst": "gpt-image-2\.6-sunburst",$/,
    // app/blender-style.js: a Style preview draft made on 2.5 Sunburst stays open for review (never offered, never run)
    /^\s*const SAVED_ENGINES=\[\.\.\.ENGINES,"gpt-image-2\.5-sunburst"\];$/,
    // two comments: the drift card's note on dotted ids, and where the 2026-10-11 prices were checked
    /^\s*a model id may itself hold dots \("gpt-image-2\.5-flare", "gemini-nano-banana-2\.1", "seedance-2\.0"\), so the$/,
    /^\s*pricing\) checked 2026-10-10; GPT Image 2\.5 and Seedream 5 Pro \(fal\.ai\/models\/openai\/gpt-image-2\.5\/\*,$/,
  ];
  const hits = [];
  for (const f of files) {
    let src; try { src = read(f); } catch (_e) { continue; }
    src.split("\n").forEach((line, n) => {
      if (!ID.test(line)) return;
      if (allowed.some((re) => re.test(line))) return;
      hits.push(f + ":" + (n + 1) + ": " + line.trim().slice(0, 120));
    });
  }
  assert.deepEqual(hits, []);
});

console.log(`\n${checks} passed, ${failed} failed`);
// proxyGenerate's 6½-minute client cap is a live timer: exit instead of waiting it out
process.exit(failed ? 1 : 0);

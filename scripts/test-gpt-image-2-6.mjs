/* GPT Image 2.6 Flare / Sunburst (2026-11-05, owner: "check if GPT Image 2.6 is available and add it if it is").
   fal published them on 2026-11-04 (openai/gpt-image-2.6/{flare,sunburst}/{text-to-image,edit}) with 2.5's inputs —
   the same image_size, quality values and 32,000-character prompt — plus reasoning_effort (OpenAI `complexity`, no
   separate fee: left at its default), GIF / SVG output and markup edits (not used). They sat BESIDE 2.5 for a week;
   on 2026-11-12 (owner) 2.6 REPLACED 2.5: GPT Image 2.5 Flare / Sunburst are gone everywhere (picker, price rows,
   prompt limits, quality capabilities, fal routes, price watchers) and their ids are served on the 2.6 versions.
     A  the picker: Nano Banana 2.1 first (the default), then 2.6 Flare, 2.6 Sunburst, Seedream 5.5, Seedream 5 Pro —
        no 2.5 entry; a 2.5 id (a saved pick, an option) is its 2.6 version, and old assets keep the 2.5 label
     B  the server serves both on fal's 2.6 routes with the quality values 2.5 had (validation + the OPTIONS
        handshake); 2.5 has no route and no capability row, and its id is mapped to 2.6 before anything reads it
     C  prices: OpenAI's token calculator at 1024x1024 — low $0.02469, medium $0.04347, high $0.05268, xhigh
        $0.09366, max $0.21072 — app = server = imagegen's fallback, scaled with size; chips = server; no 2.5 row,
        and a 2.5 pick is priced as 2.6 (low / medium cost more than they did on 2.5)
     D  prompt limit 31,500; the quality preference a device saved for 2.5 is the one 2.6 reads; storyboard edits
     E  the dock chips, the price-drift watcher (both 2.6 endpoints; 2.5's watchers gone) and its labels
     F  Frances: plain "Flare" / "Sunburst" (one generation is offered at a time); no vendor name reaches her
     G  an engine the server doesn't serve yet (2.6 picked before image-proxy was deployed) is said plainly — nothing
        sent, nothing charged — and the card never offers the engine that just failed
   (Seedream 5.5, added the same day, is covered in test-image-engines-oct11.mjs.)

   node scripts/test-gpt-image-2-6.mjs */
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
const plain = (x) => JSON.parse(JSON.stringify(x));
const NB21 = "gemini-nano-banana-2.1", F26 = "gpt-image-2.6-flare", S26 = "gpt-image-2.6-sunburst",
  F25 = "gpt-image-2.5-flare", S25 = "gpt-image-2.5-sunburst", SEED = "seedream-5-pro", SEED55 = "seedream-5.5";   // F25 / S25: removed 2026-11-12
const ASPECTS = ["16:9", "9:16", "21:9", "1:1", "3:4", "4:3"];
const QUALITIES = ["default", "auto", "low", "medium", "high", "xhigh", "max"];

const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
function box(){
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
    CREDIT_SCALE: 10, appToast: noop };
  b.window = b; b.globalThis = b; vm.createContext(b); return b;
}
const run = (b, f) => vm.runInContext(transform(read(f), f), b, { filename: f });
const A = box(); run(A, "app/pricing.jsx"); run(A, "app/plans.jsx"); run(A, "app/imagegen.jsx");
const G = box(); run(G, "app/imagegen.jsx");    // imagegen alone: its fallback price table

const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
const iq = await import(new URL("supabase/functions/image-proxy/image-quality.mjs", ROOT));
const proxySrc = read("supabase/functions/image-proxy/index.ts");
const watchSrc = read("supabase/functions/pricing-watch/index.ts");
const artSrc = read("app/artroom.jsx");
const sbSrc = read("app/storyboard.jsx");
const watchUi = read("app/pricing-watch.jsx");
const html = read("TURN.html");

await test("A the picker: Nano Banana 2.1 (the default), GPT Image 2.6 Flare / Sunburst, Seedream 5.5, Seedream 5 Pro — 2.5 is not offered", () => {
  assert.deepEqual(plain(A.NB_MODELS.map((m) => [m.id, m.label])), [
    [NB21, "Nano Banana 2.1"], [F26, "GPT Image 2.6 Flare"], [S26, "GPT Image 2.6 Sunburst"],
    [SEED55, "Seedream 5.5"], [SEED, "Seedream 5 Pro"]]);
  assert.ok(!A.NB_MODELS.some((m) => /2\.5/.test(m.id + m.label + m.falModel + m.falEditModel)), "no GPT Image 2.5 entry or route");
  for (const [id, v] of [[F26, "flare"], [S26, "sunburst"]]) {
    const m = plain(A.NB_MODELS.find((x) => x.id === id));
    assert.equal(m.provider, "fal"); assert.equal(m.family, "openai");
    assert.equal(m.falModel, "openai/gpt-image-2.6/" + v + "/text-to-image");
    assert.equal(m.falEditModel, "openai/gpt-image-2.6/" + v + "/edit");
    assert.equal(m.maxRes, undefined, "up to 4K, as 2.5 was"); assert.equal(m.maxRefs, undefined);
    assert.equal(A.isGptImageModel(id), true); assert.equal(A.providerOfModel(id), "fal");
    assert.equal(A.nbModelGrounds(id), false, "no grounding"); assert.equal(A.nbModelMaxRes(id), "4K");
    assert.equal(A.nbCanonicalModelId(id), id, "not a retired id"); assert.equal(A.nbModelLabel(id), m.label);
  }
  A.localStorage.removeItem("turn-nb-model");
  assert.equal(A.nbGetModel(), NB21, "Nano Banana 2.1 stays the default");
  A.nbSetModel(S26); assert.equal(A.nbGetModel(), S26, "a 2.6 pick is kept");
  assert.equal(plain(A.TURN_DRAFT_IMAGE).model, NB21, "drafts stay Nano Banana 2.1");
});

await test("A a GPT Image 2.5 id is its 2.6 version: a saved pick, nbSetModel, an option, a chip; old assets keep the 2.5 label", async () => {
  assert.deepEqual(plain(vm.runInContext("NB_LEGACY_MODEL_IDS", A)), { "gemini-3.1-flash-lite-image": NB21, "gemini-3.1-flash-image": NB21, "gemini-3-pro-image": NB21,
    "gpt-image-2": S26, [F25]: F26, [S25]: S26 });
  const paid = (plan) => { const p = String(plan || "").toLowerCase().trim(); return !!p && p !== "none" && p !== "free" && p !== "trial"; };
  for (const [old, now] of [[F25, F26], [S25, S26]]) {
    const B = box(); run(B, "app/pricing.jsx"); run(B, "app/plans.jsx"); run(B, "app/imagegen.jsx");
    assert.equal(B.nbCanonicalModelId(old), now);
    B.localStorage.setItem("turn-nb-model", old);
    assert.equal(B.nbGetModel(), now, "a device that had " + old + " picked"); assert.equal(B.localStorage.getItem("turn-nb-model"), now, "moved once");
    B.localStorage.removeItem("turn-nb-model"); B.nbSetModel(old); assert.equal(B.localStorage.getItem("turn-nb-model"), now);
    assert.equal(B.isGptImageModel(old), true); assert.deepEqual(plain(B.nbOaiQualityChoices(old)), QUALITIES, "the same quality choices");
    for (const q of QUALITIES) for (const r of ["1K", "2K", "4K"])
      assert.equal(B.nbImageCostText(1, { model: old, quality: q, res: r, aspect: "16:9" }), B.nbImageCostText(1, { model: now, quality: q, res: r, aspect: "16:9" }), old + " is priced as " + now + " " + q + " " + r);
    B.turnIsPaidPlan = paid; B.turnIsAdmin = false; B.turnCreditBalance = { remaining: 900, plan: "director" };
    const calls = [];
    B.proxyGenerate = async (_p, opts, provider) => { calls.push({ model: opts.model, quality: opts.quality, provider }); return "data:image/png;base64,X"; };
    B.nbAssertMediaIdentity = noop;
    await B.nbGenerate("a lighthouse", { model: old, imageSize: "2K", quality: "xhigh" });
    assert.deepEqual(calls[0], { model: now, quality: "xhigh", provider: "fal" }, "an option naming " + old + " renders on " + now + ", same quality");
  }
  // display only: an image made on 2.5 (or GPT Image 2) still names the engine it was made with
  assert.equal(A.nbModelLabel(F25), "GPT Image 2.5 Flare"); assert.equal(A.nbModelLabel(S25), "GPT Image 2.5 Sunburst");
  assert.equal(A.nbModelLabel("gpt-image-2"), "GPT Image 2"); assert.equal(A.nbCanonicalModelId("gpt-image-2"), S26);
});

await test("B the proxy serves both on fal's 2.6 routes, with the quality values 2.5 had; the OPTIONS handshake lists them; 2.5 has no route", () => {
  assert.ok(proxySrc.includes('"gpt-image-2.6-flare":         { base: "openai/gpt-image-2.6/flare/text-to-image", edit: "openai/gpt-image-2.6/flare/edit", family: "openai" },'));
  assert.ok(proxySrc.includes('"gpt-image-2.6-sunburst":      { base: "openai/gpt-image-2.6/sunburst/text-to-image", edit: "openai/gpt-image-2.6/sunburst/edit", family: "openai" },'));
  assert.ok(!/reasoning_effort\s*=|input\.reasoning_effort|complexity\s*:/.test(proxySrc), "no reasoning effort is sent (its default, high, has no fee)");
  for (const m of [F26, S26]) {
    assert.deepEqual([...iq.IMAGE_QUALITY_CAPABILITIES[m]], QUALITIES, m);
    for (const q of QUALITIES) assert.equal(iq.validateImageQuality(m, q).ok, true, m + " " + q);
    assert.equal(iq.validateImageQuality(m, undefined).pricingQuality, "high", "omitted = the provider default, high");
    assert.equal(iq.validateImageQuality(m, "default").providerQuality, undefined, "default is never sent as a literal");
    assert.equal(iq.validateImageQuality(m, "ultra").ok, false);
    assert.deepEqual(iq.imageQualityOptions().imageQualities[m], QUALITIES);
  }
  // the browser reads the handshake for the 2.6 engines (the only ones it lists now)
  assert.ok(read("app/imagegen.jsx").includes('for(const model of ["gpt-image-2.6-flare","gpt-image-2.6-sunburst"]){'));
  assert.deepEqual(plain(A.nbOaiQualityChoices(F26)), QUALITIES);
  // GPT Image 2.5 (removed 2026-11-12): no fal route, no capability row, nothing in the handshake …
  assert.ok(!/openai\/gpt-image-2\.5\//.test(proxySrc) && !/"gpt-image-2\.5-(flare|sunburst)":/.test(proxySrc), "no 2.5 route in index.ts");
  assert.deepEqual(Object.keys(iq.IMAGE_QUALITY_CAPABILITIES), [F26, S26]);
  assert.deepEqual(Object.keys(iq.imageQualityOptions().imageQualities), [F26, S26]);
  for (const m of [F25, S25]) assert.equal(iq.validateImageQuality(m, "high").ok, false, m + " itself is not served");
  // … because an older app's 2.5 id is mapped to 2.6 where the request is read — before the quality check, the plan
  // gate, the price and the route — and every 2.5 quality value is a 2.6 one
  assert.deepEqual(plain(srv.LEGACY_IMAGE_MODEL_IDS), { "gemini-3.1-flash-lite-image": NB21, "gemini-3.1-flash-image": NB21, "gemini-3-pro-image": NB21,
    "gpt-image-2": S26, [F25]: F26, [S25]: S26 });
  const mapAt = proxySrc.indexOf('const model = textLegacy ? textLegacy.model : canonicalImageModel(body.model || "gpt-image-2.6-sunburst");');
  assert.ok(mapAt > 0, "a request naming no model is GPT Image 2.6 Sunburst");
  for (const later of ["validateImageQuality(model, rawQuality)", "const imageGate = checkImage(account, { model, imageSize });", "const imageRouteOk ="])
    assert.ok(mapAt < proxySrc.indexOf(later), "mapped before: " + later);
  for (const [old, now] of [[F25, F26], [S25, S26]]) {
    assert.equal(srv.canonicalImageModel(old), now);
    for (const q of [undefined, ...QUALITIES]) {
      const v = iq.validateImageQuality(srv.canonicalImageModel(old), q);
      assert.equal(v.ok, true, old + " " + q); if (q && q !== "default" && q !== "auto") assert.equal(v.pricingQuality, q, "the same quality setting");
    }
  }
  // an admin's reviewed override keeps default = high and auto = max on 2.6 as it did on 2.5
  const merged = iq.mergeImagePricingOverrides(srv.IMAGE_PROVIDER_USD, { image: { [S26]: { high: 0.06, max: 0.25, default: 9, auto: 9 } } });
  assert.equal(merged[S26].default, 0.06); assert.equal(merged[S26].auto, 0.25);
  assert.equal(merged[F26].default, 0.05268, "the other engine is untouched");
});

await test("C prices: OpenAI's 1024x1024 rows (low $0.02469, medium $0.04347, high / xhigh / max as 2.5 had); no 2.5 row; app = server = fallback", () => {
  const row26 = { default: 0.05268, auto: 0.21072, low: 0.02469, medium: 0.04347, high: 0.05268, xhigh: 0.09366, max: 0.21072 };
  for (const m of [F26, S26]) {
    assert.deepEqual(plain(srv.IMAGE_PROVIDER_USD[m]), row26, m);
    assert.equal(srv.GPT_IMAGE_BASELINE_MP[m], 1024 * 1024 / 1e6);
  }
  // OpenAI's calculator: 2.6 = 2.5's tokens x 4.2 (low) / x 3.3 (medium), the same at high and above, at $30 / 1M
  const usd = (tokens) => Math.round(tokens * 30 / 1e6 * 1e5) / 1e5;
  assert.equal(usd(Math.round(196 * 4.2)), 0.02469); assert.equal(usd(Math.round(439 * 3.3)), 0.04347);
  // high and above are what 2.5 cost (2.5's row, as it was until 2026-11-12: low $0.00588, medium $0.01317)
  const row25 = { low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 };
  for (const q of ["high", "xhigh", "max"]) assert.equal(srv.IMAGE_PROVIDER_USD[F26][q], row25[q], q);
  for (const q of ["low", "medium"]) assert.ok(srv.IMAGE_PROVIDER_USD[F26][q] > row25[q], q + " costs more than it did on 2.5");
  // GPT Image 2.5 has no price row, no baseline and no price of its own anywhere
  assert.deepEqual(Object.keys(srv.IMAGE_PROVIDER_USD), [NB21, F26, S26, SEED, SEED55]);
  assert.deepEqual(Object.keys(srv.GPT_IMAGE_BASELINE_MP), [F26, S26]);
  for (const m of [F25, S25]) {
    assert.equal(srv.imageCost({ route: "fal", model: m, imageSize: "2K", pricingKey: "high" }), null, m + " itself has no price");
    assert.ok(!(m in plain(A.TURN_PRICING.image.providerUsd)) && !(m in plain(vm.runInContext("NB_IMG_USD", G))), m + ": no app row");
  }
  assert.deepEqual(plain(A.TURN_PRICING.image.providerUsd), plain(srv.IMAGE_PROVIDER_USD), "the app's table is the server's");
  assert.deepEqual(Object.keys(plain(A.TURN_PRICING.image.providerUsd)), Object.keys(srv.IMAGE_PROVIDER_USD), "in the same order");
  assert.deepEqual(plain(vm.runInContext("NB_IMG_USD", G)), plain(srv.IMAGE_PROVIDER_USD), "imagegen's fallback copy too");
});

await test("C every quality x aspect x resolution x reference count — the chip quotes what the server holds", () => {
  for (const m of [F26, S26]) for (const q of QUALITIES) for (const a of ASPECTS) for (const r of ["1K", "2K", "4K"]) for (const refs of [0, 3]) {
    const server = srv.imageCost({ route: "fal", model: m, aspect: a, imageSize: r, pricingKey: iq.imagePricingQuality(m, q), referenceImages: refs }).credits;
    assert.equal(A.nbImageCostText(1, { model: m, quality: q, aspect: a, res: r, refs }), String(server), [m, q, a, r, refs].join(" "));
  }
  // imagegen alone (no app/pricing.jsx, so no size factor): its fallback rows give the 1024x1024 credits, and a
  // 2.5 pick the 2.6 chip (2.5's own were 1 / 2 / 6 / 10 / 22 — low and medium cost more now)
  const fb = (m, q) => Number(G.nbImageCostText(1, { model: m, quality: q, aspect: "1:1", res: "1K" }));
  const sq = (m, q) => srv.imageCost({ route: "fal", model: m, aspect: "1:1", imageSize: "1K", pricingKey: q }).credits;
  for (const m of [F26, S26]) assert.deepEqual(["low", "medium", "high", "xhigh", "max"].map((q) => sq(m, q)), [3, 5, 6, 10, 22], m + " at 1024x1024, today's unit");
  for (const [old, now] of [[F25, F26], [S25, S26]]) for (const q of ["low", "medium", "high", "xhigh", "max"]) {
    assert.equal(fb(old, q), sq(now, q), "fallback: " + old + " " + q + " is 2.6's");
    assert.equal(fb(now, q), sq(now, q), "fallback " + now + " " + q);
    // the chip of a 2.5 pick = what the server holds for the 2.6 engine it maps the request to
    for (const a of ASPECTS) for (const r of ["1K", "2K", "4K"])
      assert.equal(A.nbImageCostText(1, { model: old, quality: q, aspect: a, res: r, refs: 2 }),
        String(srv.imageCost({ route: "fal", model: srv.canonicalImageModel(old), aspect: a, imageSize: r, pricingKey: q, referenceImages: 2 }).credits), [old, q, a, r].join(" "));
  }
  // size scales as it did on 2.5: $0.05268 x (3840x2160 / 1024x1024)^0.672 = $0.2115 at 4K 16:9, high
  const big = (m) => srv.imageCost({ route: "fal", model: m, aspect: "16:9", imageSize: "4K", pricingKey: "high" }).credits;
  assert.equal(big(F26), 22); assert.equal(big(S26), 22);
});

await test("D prompt limit 31,500 (fal 32,000), no 2.5 row; a device's saved 2.5 quality is the one 2.6 reads; storyboard edits read it", () => {
  for (const m of [F26, S26]) {
    assert.equal(srv.IMAGE_PROMPT_LIMITS[m], 31500); assert.equal(srv.imagePromptMaxChars(m), 31500);
    assert.equal(A.turnImagePromptMaxChars(m), 31500, "the app fits its prompts to the same limit");
  }
  for (const [old, now] of [[F25, F26], [S25, S26]]) {
    assert.ok(!(old in srv.IMAGE_PROMPT_LIMITS) && !(old in plain(A.TURN_IMAGE_PROMPT_LIMITS)), old + " has no limit row");
    assert.equal(srv.imagePromptMaxChars(old), 31500, "the server reads a 2.5 id's limit as its 2.6 version's");
    assert.equal(A.turnImagePromptMaxChars(A.nbCanonicalModelId(old)), srv.imagePromptMaxChars(now));
  }
  assert.deepEqual(plain(A.TURN_IMAGE_PROMPT_LIMITS), plain(srv.IMAGE_PROMPT_LIMITS), "app = server");
  A.localStorage.removeItem("turn-oai-quality:2.5"); A.localStorage.removeItem("turn-oai-quality");
  assert.equal(A.nbGetOaiQuality(F26), "medium", "the app's Medium default");
  // the choice a device saved while it was on 2.5 (the key keeps its name) carries over to 2.6
  A.localStorage.setItem("turn-oai-quality:2.5", "xhigh");
  assert.equal(A.nbGetOaiQuality(F26), "xhigh"); assert.equal(A.nbGetOaiQuality(S26), "xhigh", "one choice for Flare and Sunburst");
  A.nbSetOaiQuality("max", S25);
  assert.equal(A.nbGetOaiQuality(F26), "max", "a setter still handed a 2.5 id writes the same choice");
  A.nbSetOaiQuality("low", S26);
  assert.equal(A.localStorage.getItem("turn-oai-quality:2.5"), "low");
  assert.ok(sbSrc.includes('/^gpt-image-2\\.[56]-/.test(model||"") && typeof nbGetOaiQuality==="function" ? nbGetOaiQuality(model) : "medium"'));
});

await test("E the dock chips, the price-drift watcher (both 2.6 endpoints, $30/1M; 2.5's gone) and its labels; new cache keys", () => {
  assert.ok(artSrc.includes('const short  = model==="gpt-image-2.6-flare" ? "GPT F2.6"\n    : model==="gpt-image-2.6-sunburst" ? "GPT S2.6"\n    : model==="seedream-5.5" ? "SD5.5"\n    : model==="seedream-5-pro" ? "SD5"\n    : model==="gemini-nano-banana-2.1" ? "NB2.1"'));
  assert.ok(!/model==="gpt-image-2\.5-(flare|sunburst)"/.test(artSrc) && !artSrc.includes('? "GPT F"') && !artSrc.includes('? "GPT S"'), "no 2.5 chip");
  for (const v of ["flare", "sunburst"]) {
    assert.ok(watchSrc.includes('slug: "openai/gpt-image-2.6/' + v + '/text-to-image",'), v);
    assert.ok(watchSrc.includes('"gpt-image-2.6-' + v + '-image-output-tokens",'));
    for (const q of QUALITIES) assert.ok(watchSrc.includes('"image.providerUsd.gpt-image-2.6-' + v + '.' + q + '",'), v + " " + q);
  }
  assert.ok(watchUi.includes('"gpt-image-2.6-flare": "GPT Image 2.6 Flare",') && watchUi.includes('"gpt-image-2.6-sunburst": "GPT Image 2.6 Sunburst",'));
  // GPT Image 2.5's two watchers and its drift-card labels went with it
  assert.ok(!/openai\/gpt-image-2\.5\/|gpt-image-2\.5-(flare|sunburst)/.test(watchSrc), "no 2.5 page is fetched and no 2.5 row is proposed");
  assert.ok(!/"gpt-image-2\.5-(flare|sunburst)":/.test(watchUi), "no 2.5 label on the drift card");
  for (const f of ["pricing", "imagegen", "artroom", "storyboard", "ai", "script", "pricing-watch"])
    assert.ok(["20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3"].some((k) => html.includes('src="app/' + f + '.jsx?v=' + k + '"')), f + ".jsx has a new key");
});

await test("F Frances: plain 'Flare' / 'Sunburst' for the one generation offered; the facts reach her without a vendor name", () => {
  const b = box();
  for (const f of ["app/ai.jsx"]) vm.runInContext(transform(read(f), f), b, { filename: f });
  const w = b.museFacts().find((f) => f.name === "Generating images (Art Room)").what;
  assert.ok(w.includes("Kinolot generates images with five engines you can switch between per generation (2026-11-12): 'Nano Banana 2.1' (the default: fast and the lowest cost; 1K, 2K or 4K, and the only engine with Grounding), 'Flare' (fastest), 'Sunburst' (maximum precision and fidelity), 'Seedream 5.5' (the newest Seedream) and 'Seedream 5 Pro' (rich detail)."), "the engine list");
  assert.ok(w.includes("the dock offers exactly Nano Banana 2.1, Flare, Sunburst, Seedream 5.5 and Seedream 5 Pro (2026-11-12)."), "the dock's five");
  assert.ok(!/(Flare|Sunburst) 2\.[56]\b/.test(w), "no 'Flare 2.6' / 'Sunburst 2.6' any more: one generation is offered at a time");
  assert.ok(!/GPT|OpenAI/i.test(w), "no vendor name");
  // her vendor-free rewrite: both generations' names become the plain engine name
  const neutral = read("app/ai.jsx");
  assert.ok(neutral.includes('[/\\bGPT Image 2\\.[56] (Flare|Sunburst)\\b/g, "$1"],'), "one rule for 2.5 and 2.6");
  assert.ok(!neutral.includes('"$1 2.6"'), "the 'Flare 2.6' rule is gone");
  // the manifest itself (vendor names and prices included) records the change
  const full = b.APP_FEATURES.find((f) => f.name === "Generating images (Art Room)").what;
  assert.ok(full.includes(" ENGINE CHANGES (2026-11-12): the earlier 2.5 versions of the two precision engines were removed, leaving their 2.6 versions (GPT Image 2.6 Flare and GPT Image 2.6 Sunburst, still offered); a device or option that had a 2.5 engine picked now renders on its 2.6 version with the same quality setting, and images already made on 2.5 keep their details, which still name the engine they were made with."), "the removal");
  assert.ok(full.includes("At High, Extra high and Max a 2.6 image costs what it did on 2.5; at Low and Medium it costs more (about 4 and 3 times), and its price chip shows it."), "the manifest records the price difference");
  assert.ok(full.includes("SEEDREAM 5.5 was added beside Seedream 5 Pro: the same sizes (1K and 2K), at most 10 reference images, no quality setting and no Grounding, and the same price as Seedream 5 Pro for now. Nano Banana 2.1 stays the default engine."), "Seedream 5.5");
  assert.ok(full.includes("'GPT Image 2.6 Flare' (fastest), 'GPT Image 2.6 Sunburst' (maximum precision and fidelity), 'Seedream 5.5' (the newest Seedream) and 'Seedream 5 Pro' (rich detail)."));
  assert.ok(full.includes("Home posters are painted with GPT Image 2.6 Sunburst.") && !full.includes("Home posters are still painted with GPT Image 2.5 Sunburst"));
  assert.ok(!/GPT Image 2\.5 (Flare|Sunburst) \((fastest|maximum)/.test(full) && !full.includes("six engines"), "2.5 is no longer listed as an engine");
});

await test("F Frances is never told that Flare and Sunburst themselves were removed", () => {
  const b = box();
  vm.runInContext(transform(read("app/ai.jsx"), "app/ai.jsx"), b, { filename: "app/ai.jsx" });
  const w = b.museFacts().find((f) => f.name === "Generating images (Art Room)").what;
  // The manifest's "GPT Image 2.5 Flare and GPT Image 2.5 Sunburst were removed, leaving their 2.6 versions" goes
  // through the rewrite above, which now drops the version from BOTH generations' names — so what she reads must
  // not come out as "Flare and Sunburst were removed" (the dock offers Flare and Sunburst).
  assert.ok(!/\bFlare and Sunburst were removed\b/.test(w), "the 2026-11-12 note reads, after the vendor-free rewrite: \u2026" + (/.{0,30}Flare and Sunburst were removed.{0,60}/.exec(w) || [""])[0] + "\u2026");
});

await test("G an engine the server doesn't serve yet is said plainly; the card's 'Try …' never names the engine that failed", async () => {
  const b = box();
  b.fetch = async () => ({ ok: false, status: 400, headers: { get: () => "application/json" },
    json: async () => ({ error: 'Image model "gpt-image-2.6-flare" is not supported by the image-quality schema.', code: "UNSUPPORTED_IMAGE_QUALITY" }),
    text: async () => JSON.stringify({ error: 'Image model "gpt-image-2.6-flare" is not supported by the image-quality schema.', code: "UNSUPPORTED_IMAGE_QUALITY" }) });
  b.turnCloudSession = () => ({ access_token: "t" }); b.cloudAccessToken = async () => "t";
  run(b, "app/pricing.jsx"); run(b, "app/plans.jsx"); run(b, "app/imagegen.jsx");
  const src = read("app/imagegen.jsx");
  assert.ok(src.includes('if(status===400 && /is not supported by the image-quality schema|is not allowed on the fal proxy/i.test(String(relayed||""))){'));
  assert.ok(src.includes(`const e = new Error(nbModelLabel(model)+" isn't on the image server yet \\u2014 nothing was sent and nothing was charged. Pick another engine for now.");`));
  assert.ok(artSrc.includes(`const other = allModels.find(m=>m.id!==cur && !String(genErr).includes(m.label) && !String(genErr).includes('"'+m.id+'"'));`));
  // the rule itself: with Nano Banana picked and 2.6 Flare's refusal on the card, the offer is 2.6 Sunburst, not Flare
  const models = plain(A.NB_MODELS), cur = NB21;
  const pick = (genErr) => models.find((m) => m.id !== cur && !String(genErr).includes(m.label) && !String(genErr).includes('"' + m.id + '"'));
  assert.equal(pick("GPT Image 2.6 Flare isn't on the image server yet \u2014 nothing was sent and nothing was charged.").id, S26);
  assert.equal(pick('The image server rejected this request (400): Image model "gpt-image-2.6-flare" is not supported').id, S26);
  assert.equal(pick("The image took longer than the server allows.").id, F26, "an unrelated error offers the first other engine, as before");
});

console.log(`\n${checks} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);

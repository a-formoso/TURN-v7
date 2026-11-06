/* GPT Image 2.6 Flare / Sunburst (2026-11-05, owner: "check if GPT Image 2.6 is available and add it if it is").
   fal published them on 2026-11-04 (openai/gpt-image-2.6/{flare,sunburst}/{text-to-image,edit}) with 2.5's inputs —
   the same image_size, quality values and 32,000-character prompt — plus reasoning_effort (OpenAI `complexity`, no
   separate fee: left at its default), GIF / SVG output and markup edits (not used). They are added BESIDE 2.5:
     A  the picker: Nano Banana 2.1 first (the default), then 2.6 Flare, 2.6 Sunburst, 2.5 Flare, 2.5 Sunburst, Seedream
     B  the server serves both on fal's 2.6 routes, with 2.5's quality values (validation + the OPTIONS handshake)
     C  prices: OpenAI's token calculator at 1024x1024 — low $0.02469, medium $0.04347 (more tokens than 2.5),
        high / xhigh / max as 2.5 — app = server = imagegen's fallback, scaled with size like 2.5; chips = server
     D  prompt limit 31,500 like 2.5; the quality preference is the one 2.5 uses; storyboard edits read it
     E  the dock chip, the price-drift watcher (both endpoints) and its labels
     F  Frances: "Flare 2.6" / "Sunburst 2.6" beside 2.5's "Flare" / "Sunburst"; no vendor name reaches her
     G  an engine the server doesn't serve yet (2.6 picked before image-proxy was deployed) is said plainly — nothing
        sent, nothing charged — and the card never offers the engine that just failed

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
  F25 = "gpt-image-2.5-flare", S25 = "gpt-image-2.5-sunburst", SEED = "seedream-5-pro";
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

await test("A the picker: Nano Banana 2.1 (the default), GPT Image 2.6 Flare / Sunburst, GPT Image 2.5 Flare / Sunburst, Seedream 5 Pro", () => {
  assert.deepEqual(plain(A.NB_MODELS.map((m) => [m.id, m.label])), [
    [NB21, "Nano Banana 2.1"], [F26, "GPT Image 2.6 Flare"], [S26, "GPT Image 2.6 Sunburst"],
    [F25, "GPT Image 2.5 Flare"], [S25, "GPT Image 2.5 Sunburst"], [SEED, "Seedream 5 Pro"]]);
  for (const [id, v] of [[F26, "flare"], [S26, "sunburst"]]) {
    const m = plain(A.NB_MODELS.find((x) => x.id === id));
    assert.equal(m.provider, "fal"); assert.equal(m.family, "openai");
    assert.equal(m.falModel, "openai/gpt-image-2.6/" + v + "/text-to-image");
    assert.equal(m.falEditModel, "openai/gpt-image-2.6/" + v + "/edit");
    assert.equal(m.maxRes, undefined, "up to 4K, like 2.5"); assert.equal(m.maxRefs, undefined);
    assert.equal(A.isGptImageModel(id), true); assert.equal(A.providerOfModel(id), "fal");
    assert.equal(A.nbModelGrounds(id), false, "no grounding"); assert.equal(A.nbModelMaxRes(id), "4K");
    assert.equal(A.nbCanonicalModelId(id), id, "not a retired id"); assert.equal(A.nbModelLabel(id), m.label);
  }
  A.localStorage.removeItem("turn-nb-model");
  assert.equal(A.nbGetModel(), NB21, "Nano Banana 2.1 stays the default");
  A.nbSetModel(S26); assert.equal(A.nbGetModel(), S26, "a 2.6 pick is kept");
  assert.equal(plain(A.TURN_DRAFT_IMAGE).model, NB21, "drafts stay Nano Banana 2.1");
});

await test("B the proxy serves both on fal's 2.6 routes, with 2.5's quality values; the OPTIONS handshake lists them", () => {
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
  // the browser reads the handshake for the 2.6 engines too
  assert.ok(read("app/imagegen.jsx").includes('for(const model of ["gpt-image-2.6-flare","gpt-image-2.6-sunburst","gpt-image-2.5-flare","gpt-image-2.5-sunburst"]){'));
  assert.deepEqual(plain(A.nbOaiQualityChoices(F26)), QUALITIES);
  // an admin's reviewed override keeps default = high and auto = max on 2.6 as on 2.5
  const merged = iq.mergeImagePricingOverrides(srv.IMAGE_PROVIDER_USD, { image: { [S26]: { high: 0.06, max: 0.25, default: 9, auto: 9 } } });
  assert.equal(merged[S26].default, 0.06); assert.equal(merged[S26].auto, 0.25);
  assert.equal(merged[F26].default, 0.05268, "the other engine is untouched");
});

await test("C prices: OpenAI's 1024x1024 rows (low $0.02469, medium $0.04347, high / xhigh / max as 2.5); app = server = fallback", () => {
  const row26 = { default: 0.05268, auto: 0.21072, low: 0.02469, medium: 0.04347, high: 0.05268, xhigh: 0.09366, max: 0.21072 };
  for (const m of [F26, S26]) {
    assert.deepEqual(plain(srv.IMAGE_PROVIDER_USD[m]), row26, m);
    assert.equal(srv.GPT_IMAGE_BASELINE_MP[m], 1024 * 1024 / 1e6);
  }
  // OpenAI's calculator: 2.6 = 2.5's tokens x 4.2 (low) / x 3.3 (medium), the same at high and above, at $30 / 1M
  const usd = (tokens) => Math.round(tokens * 30 / 1e6 * 1e5) / 1e5;
  assert.equal(usd(Math.round(196 * 4.2)), 0.02469); assert.equal(usd(Math.round(439 * 3.3)), 0.04347);
  for (const q of ["high", "xhigh", "max"]) assert.equal(srv.IMAGE_PROVIDER_USD[F26][q], srv.IMAGE_PROVIDER_USD[F25][q], q);
  assert.deepEqual(plain(A.TURN_PRICING.image.providerUsd), plain(srv.IMAGE_PROVIDER_USD), "the app's table is the server's");
  assert.deepEqual(plain(vm.runInContext("NB_IMG_USD", G)), plain(srv.IMAGE_PROVIDER_USD), "imagegen's fallback copy too");
});

await test("C every quality x aspect x resolution x reference count — the chip quotes what the server holds", () => {
  for (const m of [F26, S26]) for (const q of QUALITIES) for (const a of ASPECTS) for (const r of ["1K", "2K", "4K"]) for (const refs of [0, 3]) {
    const server = srv.imageCost({ route: "fal", model: m, aspect: a, imageSize: r, pricingKey: iq.imagePricingQuality(m, q), referenceImages: refs }).credits;
    assert.equal(A.nbImageCostText(1, { model: m, quality: q, aspect: a, res: r, refs }), String(server), [m, q, a, r, refs].join(" "));
  }
  // imagegen alone (no app/pricing.jsx, so no size factor): its fallback rows give 2.6 the same chip as 2.5 at high
  // and above, and a dearer one at low / medium
  const fb = (m, q) => Number(G.nbImageCostText(1, { model: m, quality: q, aspect: "1:1", res: "1K" }));
  for (const q of ["high", "xhigh", "max"]) assert.equal(fb(F26, q), fb(F25, q), "fallback " + q);
  for (const q of ["low", "medium"]) assert.ok(fb(F26, q) > fb(F25, q), "fallback " + q);
  const sq = (m, q) => srv.imageCost({ route: "fal", model: m, aspect: "1:1", imageSize: "1K", pricingKey: q }).credits;
  assert.deepEqual(["low", "medium", "high", "xhigh", "max"].map((q) => sq(S26, q)), [3, 5, 6, 10, 22], "2.6 at 1024x1024, today's unit");
  assert.deepEqual(["low", "medium", "high", "xhigh", "max"].map((q) => sq(S25, q)), [1, 2, 6, 10, 22], "2.5 unchanged");
  const big = (m) => srv.imageCost({ route: "fal", model: m, aspect: "16:9", imageSize: "4K", pricingKey: "high" }).credits;
  assert.equal(big(F26), big(F25), "size scales the same way as 2.5");
});

await test("D prompt limit 31,500 (fal 32,000) like 2.5; the 2.5 quality preference is shared; storyboard edits read it", () => {
  for (const m of [F26, S26]) {
    assert.equal(srv.IMAGE_PROMPT_LIMITS[m], 31500); assert.equal(srv.imagePromptMaxChars(m), 31500);
    assert.equal(A.turnImagePromptMaxChars(m), 31500, "the app fits its prompts to the same limit");
  }
  A.localStorage.removeItem("turn-oai-quality:2.5"); A.localStorage.removeItem("turn-oai-quality");
  assert.equal(A.nbGetOaiQuality(F26), "medium", "the app's Medium default");
  A.nbSetOaiQuality("xhigh", S25);
  assert.equal(A.nbGetOaiQuality(F26), "xhigh", "one choice for 2.5 and 2.6");
  A.nbSetOaiQuality("low", S26);
  assert.equal(A.localStorage.getItem("turn-oai-quality:2.5"), "low");
  assert.ok(sbSrc.includes('/^gpt-image-2\\.[56]-/.test(model||"") && typeof nbGetOaiQuality==="function" ? nbGetOaiQuality(model) : "medium"'));
});

await test("E the dock chip, the price-drift watcher (both 2.6 endpoints, $30/1M) and its labels; new cache keys", () => {
  assert.ok(artSrc.includes('const short  = model==="gpt-image-2.6-flare" ? "GPT F2.6"\n    : model==="gpt-image-2.6-sunburst" ? "GPT S2.6"'));
  for (const v of ["flare", "sunburst"]) {
    assert.ok(watchSrc.includes('slug: "openai/gpt-image-2.6/' + v + '/text-to-image",'), v);
    assert.ok(watchSrc.includes('"gpt-image-2.6-' + v + '-image-output-tokens",'));
    for (const q of QUALITIES) assert.ok(watchSrc.includes('"image.providerUsd.gpt-image-2.6-' + v + '.' + q + '",'), v + " " + q);
  }
  assert.ok(watchUi.includes('"gpt-image-2.6-flare": "GPT Image 2.6 Flare",') && watchUi.includes('"gpt-image-2.6-sunburst": "GPT Image 2.6 Sunburst",'));
  for (const f of ["pricing", "imagegen", "artroom", "storyboard", "ai", "script", "pricing-watch"])
    assert.ok(["20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11"].some((k) => html.includes('src="app/' + f + '.jsx?v=' + k + '"')), f + ".jsx has a new key");
});

await test("F Frances: 'Flare 2.6' / 'Sunburst 2.6' beside 2.5's 'Flare' / 'Sunburst'; the facts reach her without a vendor name", () => {
  const b = box();
  for (const f of ["app/ai.jsx"]) vm.runInContext(transform(read(f), f), b, { filename: f });
  const w = b.museFacts().find((f) => f.name === "Generating images (Art Room)").what;
  assert.ok(w.includes("'Flare 2.6' and 'Sunburst 2.6' (the newest versions of Flare and Sunburst)"), "the engine list");
  assert.ok(w.includes("the dock also offers Flare 2.6 (fast) and Sunburst 2.6 (maximum precision)"), "the 2.6 note");
  assert.ok(w.includes("'Flare' (fastest), 'Sunburst' (maximum precision and fidelity)"), "2.5 is named as before");
  assert.ok(!/GPT|OpenAI/i.test(w), "no vendor name");
  const full = b.APP_FEATURES.find((f) => f.name === "Generating images (Art Room)").what;
  assert.ok(full.includes("At High, Extra high and Max a 2.6 image costs the same credits as on 2.5; at Low and Medium it costs more"), "the manifest records the price difference");
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
  // the rule itself: with Nano Banana picked and Flare 2.6's refusal on the card, the offer is 2.6 Sunburst, not Flare
  const models = plain(A.NB_MODELS), cur = NB21;
  const pick = (genErr) => models.find((m) => m.id !== cur && !String(genErr).includes(m.label) && !String(genErr).includes('"' + m.id + '"'));
  assert.equal(pick("GPT Image 2.6 Flare isn't on the image server yet \u2014 nothing was sent and nothing was charged.").id, S26);
  assert.equal(pick('The image server rejected this request (400): Image model "gpt-image-2.6-flare" is not supported').id, S26);
  assert.equal(pick("The image took longer than the server allows.").id, F26, "an unrelated error offers the first other engine, as before");
});

console.log(`\n${checks} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);

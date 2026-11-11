#!/usr/bin/env node
/* test-writing-engines-oct11.mjs — the writing engines (2026-10-11, owner — "keep the three main ones").
   Only Claude, Gemini and GPT remain: Kimi K3 / K2.7 (the Moonshot route), Fable 5.1, Gemini 3.5 Flash and GPT-5.5
   are removed and GPT-6.1 Sol is added. OpenAI's automatic prompt-cache writes (1.25x input on the GPT-6 family) are
   held and settled. 2026-11-12 (owner): Claude offers exactly two engines — Opus 5.5 (the default) and Fable 5.2
   ($8 / $40, cache reads $0.20), which REPLACED Fable 5; an older app's Fable 5 or 5.1 is served as Fable 5.2.
   Offline: the server's pure pricing module is imported; the app and index.ts are checked at source level.

     A  the picker: exactly Opus 5.5, Fable 5.2, Gemini 4 Argon (2026-10-18), Gemini 3.8 Flash, GPT-6 Astra, GPT-6.1 Sol
     B  removed ids (Fable 5 included): no price, no route, no trial default; an older app's id is served on its
        successor; Fable 5.2's price and plan gate
     C  GPT-6.1 Sol's price, long-context tier and reasoning effort
     D  OpenAI cache writes: the hold prices all input as a write; the settle bills reads, writes and the rest,
        never above the hold
     E  the app's tables agree (fallback credit rates, dock short labels, trial engines)
     F  Frances knows the engines and says nothing about the removed ones being available

   node scripts/test-writing-engines-oct11.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";
import { DEFAULT_TEXT_MODELS, checkText } from "../supabase/functions/image-proxy/billing-policy.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ai = read("app/ai.jsx"), dock = read("app/aiwriter.jsx"), pricing = read("app/pricing.jsx"), plans = read("app/plans.jsx"), scriptRead = read("app/script-read.js");
const proxy = read("supabase/functions/image-proxy/index.ts");
const REMOVED = ["kimi-k3", "kimi-k2.7-code", "claude-fable-5-1", "claude-fable-5", "gemini-3.5-flash", "gpt-5.5", "gpt-5.5-2026-04-23"];   // Fable 5: 2026-11-12

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

const modelsBlock = ai.slice(ai.indexOf("const WRITING_MODELS = ["), ai.indexOf("];", ai.indexOf("const WRITING_MODELS = [")));
const ids = [...modelsBlock.matchAll(/\{\s*id:"([^"]+)"/g)].map((m) => m[1]);

test("A the picker offers exactly the six engines, Opus 5.5 first (Gemini 4 Argon added 2026-10-18; Fable 5.2 replaced Fable 5 on 2026-11-12)", () => {
  assert.deepEqual(ids, ["claude-opus-5-5", "claude-fable-5-2", "gemini-4-argon", "gemini-3.8-flash", "gpt-6-astra", "gpt-6.1-sol"]);
  const entries = [...modelsBlock.matchAll(/\{\s*id:"([^"]+)",\s*label:"([^"]+)",\s*provider:"([^"]+)"/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(entries, [["claude-opus-5-5", "Opus 5.5", "anthropic"], ["claude-fable-5-2", "Fable 5.2", "anthropic"], ["gemini-4-argon", "Gemini 4 Argon", "google"],
    ["gemini-3.8-flash", "Gemini 3.8 Flash", "google"], ["gpt-6-astra", "GPT-6 Astra", "openai"], ["gpt-6.1-sol", "GPT-6.1 Sol", "openai"]], "ids, labels and providers, in the picker's order");
  assert.deepEqual(entries.filter((e) => e[2] === "anthropic").map((e) => e[1]), ["Opus 5.5", "Fable 5.2"], "Claude offers exactly two");
  const providers = [...modelsBlock.matchAll(/provider:"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(providers)].sort(), ["anthropic", "google", "openai"]);
  for (const id of ids) assert.ok(P.textPriceKey(id), id + " has a price");
});

test("B removed engines have no price and no route; old ids are served on a successor", () => {
  for (const id of REMOVED) {
    assert.equal(P.TEXT_PROVIDER_USD_PER_1M[id], undefined, id + " still priced");
    assert.equal(P.textPriceKey(id), "", id + " still resolves to a price");
    assert.ok(!modelsBlock.includes('"' + id + '"'), id + " still in the picker");
  }
  // (2026-11-12) Fable 5 and Fable 5.1 → Fable 5.2: an older app's pick is served, gated and priced as 5.2
  assert.deepEqual({ ...P.legacyWritingModel("claude-fable-5-1") }, { provider: "anthropic", model: "claude-fable-5-2" });
  assert.deepEqual({ ...P.legacyWritingModel("claude-fable-5") }, { provider: "anthropic", model: "claude-fable-5-2" });
  assert.deepEqual(Object.keys(P.LEGACY_WRITING_MODELS).sort(), [...REMOVED].sort(), "every removed id has a successor, and nothing else is remapped");
  assert.deepEqual({ ...P.legacyWritingModel("gemini-3.5-flash") }, { provider: "google", model: "gemini-3.8-flash" });
  assert.deepEqual({ ...P.legacyWritingModel("gpt-5.5-2026-04-23") }, { provider: "openai", model: "gpt-6.1-sol" });
  assert.deepEqual({ ...P.legacyWritingModel("gpt-5.5") }, { provider: "openai", model: "gpt-6.1-sol" });
  assert.deepEqual({ ...P.legacyWritingModel("kimi-k3") }, { provider: "anthropic", model: "claude-opus-5-5" });
  assert.deepEqual({ ...P.legacyWritingModel("kimi-k2.7-code") }, { provider: "google", model: "gemini-3.8-flash" });
  for (const id of ids) assert.equal(P.legacyWritingModel(id), null, id + " must not be remapped");
  for (const { model } of Object.values(P.LEGACY_WRITING_MODELS)) assert.ok(ids.includes(model), model + " is offered");
  // the proxy maps BEFORE the gate, the price and the route, and only on the text task
  assert.match(proxy, /const textLegacy = \(body\.task === "text"\) \? legacyWritingModel\(body\.model\) : null;/);
  assert.match(proxy, /const provider = textLegacy \? textLegacy\.provider : \(body\.provider \|\| "openai"\);/);
  assert.match(proxy, /const model = textLegacy \? textLegacy\.model : canonicalImageModel\(/);
  assert.ok(proxy.indexOf("const textLegacy") < proxy.indexOf("checkText(account, priceKey)"));
  assert.doesNotMatch(proxy, /moonshot|MOONSHOT_API_KEY|api\.moonshot\.ai/i);
  assert.deepEqual([...DEFAULT_TEXT_MODELS], ["claude-opus-5-5", "gemini-3.8-flash"]);
});

test("B Fable 5.2: $8 / $40, cache reads $0.20; a paid plan's engine; no web search", () => {
  assert.deepEqual({ ...P.TEXT_PROVIDER_USD_PER_1M["claude-fable-5-2"] }, { input: 8, output: 40 });
  assert.equal(P.TEXT_CACHE_READ_USD_PER_1M["claude-fable-5-2"], 0.2);
  const r = P.textRates("claude-fable-5-2", { inputTokens: 1000 });
  assert.deepEqual([r.key, r.input, r.output, r.cacheRead, r.cacheWrite], ["claude-fable-5-2", 8, 40, 0.2, 10]);
  assert.equal(P.textPriceKey("claude-fable-5-2"), "claude-fable-5-2");
  assert.ok(!P.textCachesByDefault("claude-fable-5-2"), "Claude caches only when asked to");
  // 10k in / 4k out = $0.24 → 24 credits: twice Opus 5.5's 12 (what its picker note says)
  assert.equal(P.textActualCost("claude-fable-5-2", { inputTokens: 10000, outputTokens: 4000 }).credits, 24);
  assert.equal(P.textActualCost("claude-opus-5-5", { inputTokens: 10000, outputTokens: 4000 }).credits, 12);
  assert.match(modelsBlock, /id:"claude-fable-5-2",\s*label:"Fable 5\.2",\s*provider:"anthropic", note:"[^"]*costs about twice Opus 5\.5"/);
  // the plan gate: not a default engine, so a trial / no-plan account is refused; every paid plan may pick it
  const acct = (plan, extra = {}) => ({ plan, remaining: 500, isAdmin: false, frozen: false, ...extra });
  assert.equal(checkText(acct("none", { trial: true }), P.textPriceKey("claude-fable-5-2")).body.code, "plan_required");
  for (const plan of ["writer", "director", "studio"]) assert.equal(checkText(acct(plan), P.textPriceKey("claude-fable-5-2")), null, plan);
  // the removed Fable 5 has no price key of its own: unmapped it would be refused, never billed at a guess
  assert.equal(checkText(acct("studio"), P.textPriceKey("claude-fable-5")).body.code, "model_not_allowed");
  assert.equal(P.textWebSearchTool("claude-fable-5-2"), "", "web search stays on Opus / Sonnet");
  // Anthropic's effort setting reaches it (the proxy's gate is by family name)
  assert.ok(/^claude-(fable|mythos|opus-5|sonnet-5)/.test("claude-fable-5-2"));
  assert.ok(proxy.includes('/^claude-(fable|mythos|opus-5|sonnet-5)/.test(runModel) ? { output_config: { effort: claudeEffort } } : {}'));
});

test("C GPT-6.1 Sol: $2 / $10, $4 / $15 above 272K input, cached $0.10 / $0.20, effort sent", () => {
  const r = P.textRates("gpt-6.1-sol", { inputTokens: 1000 });
  assert.equal(r.input, 2); assert.equal(r.output, 10); assert.equal(r.cacheRead, 0.1); assert.equal(r.cacheWrite, 2.5);
  const long = P.textRates("gpt-6.1-sol", { inputTokens: 300000 });
  assert.equal(long.input, 4); assert.equal(long.output, 15); assert.equal(long.cacheRead, 0.2); assert.equal(long.cacheWrite, 5);
  const astraLong = P.textRates("gpt-6-astra", { inputTokens: 300000 });
  assert.equal(astraLong.cacheRead, 2);
  assert.equal(P.textRates("gpt-6-astra", { inputTokens: 10 }).cacheRead, 1);
  assert.match(proxy, /\/\^gpt-6\(\?:-astra\|\\\.1-sol\)\(\?:\$\|-\)\/\.test\(model\) && reasoningEffort \? \{ reasoning_effort: reasoningEffort \}/);
  assert.equal(P.textWebSearchTool("gpt-6.1-sol"), "", "web search stays Claude-only");
});

test("D OpenAI cache writes are held and settled, never above the hold", () => {
  assert.ok(P.textCachesByDefault("gpt-6.1-sol") && P.textCachesByDefault("gpt-6-astra"));
  assert.ok(!P.textCachesByDefault("claude-opus-5-5") && !P.textCachesByDefault("gemini-3.8-flash"));
  const messages = [{ role: "user", content: "word ".repeat(6000) }];
  const hold = P.textHoldEstimate({ model: "gpt-6.1-sol", messages, outputCap: 4000 });
  const inT = hold.inputTokens;
  assert.ok(Math.abs(hold.providerCostUsd - (inT * 2.5 + 4000 * 10) / 1e6) < 1e-12, "input held at the write price");
  // a fresh prompt with no write count reported: every uncached token is a write
  const fresh = P.normaliseTextUsage("openai", { usage: { prompt_tokens: 5000, completion_tokens: 900, prompt_tokens_details: { cached_tokens: 0 } } }, "gpt-6.1-sol");
  assert.deepEqual(fresh, { inputTokens: 0, outputTokens: 900, cacheWriteTokens: 5000, cacheReadTokens: 0 });
  // a reused prefix: cached tokens are reads, the rest writes
  const reused = P.normaliseTextUsage("openai", { usage: { prompt_tokens: 5000, completion_tokens: 900, prompt_tokens_details: { cached_tokens: 4096 } } }, "gpt-6.1-sol");
  assert.deepEqual(reused, { inputTokens: 0, outputTokens: 900, cacheWriteTokens: 904, cacheReadTokens: 4096 });
  // a reported write count is used as reported
  const reported = P.normaliseTextUsage("openai", { usage: { prompt_tokens: 5000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 2000 } } }, "gpt-6-astra");
  assert.deepEqual(reported, { inputTokens: 2000, outputTokens: 10, cacheWriteTokens: 2000, cacheReadTokens: 1000 });
  // below 1,024 prompt tokens nothing is cached
  const small = P.normaliseTextUsage("openai", { usage: { prompt_tokens: 800, completion_tokens: 10 } }, "gpt-6.1-sol");
  assert.deepEqual(small, { inputTokens: 800, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 });
  // the worst settle stays at or under the hold
  const worst = P.textActualCost("gpt-6.1-sol", { inputTokens: 0, outputTokens: 4000, cacheWriteTokens: inT, cacheReadTokens: 0 });
  assert.ok(worst.credits <= hold.credits, `settle ${worst.credits} > hold ${hold.credits}`);
  // the affordable cap fits the write-priced hold
  const cap = P.affordableOutputCap({ model: "gpt-6.1-sol", messages, wantedCap: 16000, availableCredits: 10 });
  assert.ok(cap > 0 && P.textHoldEstimate({ model: "gpt-6.1-sol", messages, outputCap: cap }).credits <= 10);
  // the proxy hands the model to the normaliser
  assert.match(proxy, /normaliseTextUsage\(providerName, providerData, priceKey\)/);
});

test("E the app's tables agree", () => {
  for (const src of [ai, pricing]) {
    assert.match(src, /"gpt-6\.1-sol":\s*0\.12/);
    for (const id of ["kimi-k3", "kimi-k2.7-code", "claude-fable-5-1"]) assert.ok(!src.includes('"' + id + '":'), id + " rate left");
  }
  // Fable 5.2's fallback credit rate (0.27 — Fable 5's was 0.33), the same in both tables; no rate left for Fable 5
  for (const src of [ai, pricing]) {
    assert.match(src, /"claude-fable-5-2":\s*0\.27,/);
    assert.ok(!src.includes('"claude-fable-5":'), "a Fable 5 rate is left");
  }
  assert.match(dock, /"gpt-6\.1-sol":"SOL"/);
  assert.ok(dock.includes('const SHORT = { "claude-opus-5-5":"OPUS5.5", "claude-fable-5-2":"FABLE5.2", "gemini-3.8-flash":"GEM3.8", "gemini-4-argon":"ARGON",\n    "gpt-6-astra":"ASTRA", "gpt-6.1-sol":"SOL" };'), "the dock's short labels, one per offered engine");
  assert.doesNotMatch(dock, /kimi|moonshot|fable-5-1|"claude-fable-5"|gemini-3\.5|gpt-5\.5/i);
  // Import a screenplay's read estimate prices Fable 5.2 as the server does
  assert.ok(scriptRead.includes('"claude-fable-5-2":{ input:8, output:40 },'));
  assert.ok(!/"claude-fable-5"\s*:/.test(scriptRead), "no Fable 5 row in READ_ENGINE_USD");
  for (const id of ids) assert.ok(new RegExp('"' + id.replace(/\./g, "\\.") + '"\\s*:\\s*\\{ input:').test(scriptRead), id + " has a read price");
  assert.match(plans, /const TRIAL_TEXT_MODELS = \["claude-opus-5-5", "gemini-3\.8-flash"\];/);
});

test("F Frances's notes name Fable 5.2 (it replaced Fable 5 on 2026-11-12) and the removals", () => {
  assert.ok(ai.includes("the panel offers exactly Opus 5.5, Fable 5.2 (which replaced Fable 5 on 2026-11-12; a pick is per session, so nothing saved changes), Gemini 4 Argon, Gemini 3.8 Flash, GPT-6 Astra and GPT-6.1 Sol. Kimi K3, Kimi K2.7, Fable 5.1, Gemini 3.5 Flash and GPT-5.5 were removed"));
  assert.ok(ai.includes("(Opus 5.5 is the default; Fable 5.2 is a manual pick;"));
  assert.ok(ai.includes("Claude Fable 5.2 \\u2014 the deepest story reasoning, slower and about twice the credits \\u2014,"));
  // no note still offers Fable 5: outside comments, "Fable 5" is only ever "Fable 5.2", the removed "Fable 5.1", or the one "replaced Fable 5" mention
  const code = ai.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n").replace(/\/\/[^\n"]*$/gm, "");
  assert.deepEqual([...code.matchAll(/.{0,26}Fable 5(?!\.[12])/g)].map((m) => m[0]), ["Fable 5.2 (which replaced Fable 5"]);
  assert.ok(!/claude-fable-5(?!-2)/.test(code), "no claude-fable-5 id is left in the app's writing code");
  assert.match(ai, /GPT-6\.1 Sol \(2026-10-11\) is the second OpenAI manual pick/);
  assert.doesNotMatch(ai, /MOONSHOT_API_KEY|Kimi K2\.7 can still be chosen|Fable 5 and Fable 5\.1 are manual picks/);
  assert.match(ai, /grouped by what the engines are good at \(Story \/ Fast \/ Alternative\)"/);
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS writing engines (${checks} checks)`);
process.exit(failed ? 1 : 0);

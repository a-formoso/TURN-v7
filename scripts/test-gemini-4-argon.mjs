#!/usr/bin/env node
/* test-gemini-4-argon.mjs — Gemini 4 Argon as a writing engine (owner 2026-10-18: "yes, add Gemini 4 Argon").
   Offline: the server's pure pricing and policy modules are imported; the app and index.ts are checked at source level.

     A  the app offers it (label, Google route, low thinking) with its fallback rate and dock label
     B  its price: $2 / $10 per 1M tokens through 30 November 2026, $4 / $20 from 1 December (midnight UTC, never
        after Google's own switch); a cached input token $0.10, then $0.20
     C  Gemini's own prompt cache: the cached part of promptTokenCount is billed as a read, the rest as input, the
        thinking tokens as output; with no cache count the bill is unchanged
     D  the server sends it the thinking level and keeps every request inside its 32,768-token non-streaming cap
     E  plans: a paid plan can pick it, a trial / no-plan account can't (it isn't a default engine)
     F  Frances knows it, without naming the company behind it

   node scripts/test-gemini-4-argon.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";
import * as POL from "../supabase/functions/image-proxy/billing-policy.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ai = read("app/ai.jsx"), dock = read("app/aiwriter.jsx"), pricing = read("app/pricing.jsx");
const proxy = read("supabase/functions/image-proxy/index.ts");
const ID = "gemini-4-argon";

let checks = 0, failed = 0;
function test(name, fn){
  try { fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); }
}

test("A the app offers Gemini 4 Argon on the Google route with low thinking, and its tables agree", () => {
  assert.ok(ai.includes('{ id:"gemini-4-argon", label:"Gemini 4 Argon", provider:"google", thinkingLevel:"low",'));
  assert.ok(/"gemini-4-argon": 0\.12,/.test(ai) && /"gemini-4-argon": 0\.12,/.test(pricing), "fallback rate in both tables");
  assert.ok(dock.includes('"gemini-4-argon":"ARGON"'), "the dock's short label");
});

test("B its price through 30 November 2026 and from 1 December", () => {
  assert.equal(P.textPriceKey(ID), ID);
  const before = P.textRates(ID, { nowMs: Date.parse("2026-11-30T23:59:59Z") });
  assert.deepEqual([before.input, before.output, before.cacheRead], [2, 10, 0.1]);
  const after = P.textRates(ID, { nowMs: Date.parse("2026-12-01T00:00:00Z") });
  assert.deepEqual([after.input, after.output, after.cacheRead], [4, 20, 0.2]);
  // the other engines' dated change is untouched (3.8 Flash has no cache price: reads fall back to input)
  const flash = P.textRates("gemini-3.8-flash", { nowMs: Date.parse("2027-01-02T00:00:00Z") });
  assert.deepEqual([flash.input, flash.output, flash.cacheRead], [1.5, 7.5, 1.5]);
});

test("C Gemini's own prompt cache is billed as a read; thinking is output; no cache count changes nothing", () => {
  const u = P.normaliseTextUsage("google", { usageMetadata: { promptTokenCount: 10000, cachedContentTokenCount: 8000,
    candidatesTokenCount: 1500, thoughtsTokenCount: 500 } }, ID);
  assert.deepEqual(u, { inputTokens: 2000, outputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 8000 });
  const rates = P.textRates(ID, { nowMs: Date.parse("2026-10-20T00:00:00Z") });
  const usd = P.textCostUsd(rates, u);
  assert.equal(Math.round(usd * 1e6), Math.round((2000 * 2 + 8000 * 0.1 + 2000 * 10)), "USD from the three parts");
  const plain = P.normaliseTextUsage("google", { usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100 } }, "gemini-3.8-flash");
  assert.deepEqual(plain, { inputTokens: 900, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 });
  // a nonsense cache count never makes input negative
  const odd = P.normaliseTextUsage("google", { usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 500 } }, ID);
  assert.equal(odd.inputTokens, 0); assert.equal(odd.cacheReadTokens, 100);
});

test("C2 the hold covers the most the call can cost (all input at the full price + the whole output cap)", () => {
  const messages = [{ role: "user", content: "x".repeat(40000) }];
  const est = P.textHoldEstimate({ model: ID, messages, outputCap: 16000, nowMs: Date.parse("2026-10-20T00:00:00Z") });
  assert.ok(est && est.credits > 0, "a hold");
  const settle = P.textCostUsd(P.textRates(ID, { nowMs: Date.parse("2026-10-20T00:00:00Z") }),
    { inputTokens: 1000, cacheReadTokens: 15000, outputTokens: 16000 });
  assert.ok(P.creditsFromUsd(settle) <= est.credits, "a cached call settles at or below its hold");
});

test("D the server sends the thinking level, and requests stay inside 32,768 tokens", () => {
  assert.ok(proxy.includes("/^gemini-(?:3\\.8-flash|4-argon)(?:$|-)/.test(model) && thinkingLevel"));
  assert.ok(proxy.includes("Math.max(1024, Math.min(32768, _reqMax))"), "the requested cap is clamped to 32,768");
  assert.ok(/const DEFAULT_TEXT_OUTPUT_CAP = (\d+);/.exec(proxy)[1] <= 32768, "the default cap fits");
});

test("E a paid plan can pick it; a trial / no-plan account can't", () => {
  assert.ok(!POL.DEFAULT_TEXT_MODELS.includes(ID), "not a default engine");
  const none = { plan: "none", remaining: 50, frozen: false, isAdmin: false };
  const r = POL.checkText(none, ID);
  assert.equal(r && r.status, 402);
  for (const plan of ["writer", "director", "studio"])
    assert.equal(POL.checkText({ plan, remaining: 500, frozen: false, isAdmin: false }, ID), null, plan);
});

test("F Frances knows Gemini 4 Argon, without the company's name", () => {
  const i = ai.indexOf("GEMINI 4 ARGON (2026-10-18)");
  assert.ok(i > 0);
  const sentence = ai.slice(i, ai.indexOf('";', i));
  assert.ok(/Writer, Director and Producer/.test(sentence) && /not on a trial/.test(sentence));
  assert.ok(!/Google|Anthropic|OpenAI/.test(sentence), "no vendor named");
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS all ${checks}`);
process.exit(failed ? 1 : 0);

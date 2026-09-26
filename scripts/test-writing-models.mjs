#!/usr/bin/env node
/* Source-level contract for models that cross the browser → Edge Function boundary. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ai = readFileSync("app/ai.jsx","utf8");
const dock = readFileSync("app/aiwriter.jsx","utf8");
const proxy = readFileSync("supabase/functions/image-proxy/index.ts","utf8");
const html = readFileSync("TURN.html","utf8");

assert.match(ai, /\{\s*id:"gpt-6-astra",\s*label:"GPT-6 Astra",\s*provider:"openai",\s*reasoningEffort:"low"/);
assert.match(ai, /reasoningEffort:\s*m\.reasoningEffort\s*\|\|\s*undefined/);
assert.match(ai, /m\.provider==="openai"[\s\S]{0,140}?maxCompletionTokens:\s*opts\.maxTokens\s*\|\|\s*undefined/);
assert.match(ai, /:\s*\{\s*maxTokens:\s*opts\.maxTokens\s*\|\|\s*undefined\s*\}/);
assert.match(ai, /\{\s*id:"gemini-3\.8-flash",\s*label:"Gemini 3\.8 Flash",\s*provider:"google",\s*thinkingLevel:"low"/);
assert.match(ai, /thinkingLevel:\s*m\.thinkingLevel\s*\|\|\s*undefined/);
assert.match(ai, /records GPT-6 Astra in generation provenance/);
assert.match(ai, /records Gemini 3\.8 Flash in generation provenance/);
assert.match(dock, /"gpt-6-astra":"ASTRA"/);
assert.match(ai, /\{\s*id:"claude-opus-5-5",\s*label:"Opus 5\.5",\s*provider:"anthropic"/);
assert.match(dock, /"claude-opus-5-5":"OPUS5\.5"/);
assert.match(proxy, /"claude-opus-5-5":\s*\{\s*input:\s*4,\s*output:\s*20\s*\}/);   // Anthropic list price
assert.match(dock, /"gemini-3\.8-flash":"GEM3\.8"/);
assert.match(proxy, /"gpt-6-astra":\s*\{\s*input:\s*10,\s*output:\s*50\s*\}/);
assert.match(proxy, /"gemini-3\.8-flash":\s*\{\s*input:\s*0\.75,\s*output:\s*3\.75\s*\}/);
assert.match(proxy, /provider\s*===\s*"openai"[\s\S]*?reqMaxTokens\s*\?\s*\{\s*max_completion_tokens:\s*reqMaxTokens\s*\}/);
assert.doesNotMatch(proxy, /provider\s*===\s*"openai"[\s\S]{0,1400}?\{\s*max_tokens:\s*reqMaxTokens\s*\}/);
assert.match(proxy, /body\.maxCompletionTokens\s*\|\|\s*body\.maxTokens/);
assert.match(proxy, /\{\s*reasoning_effort:\s*reasoningEffort\s*\}/);
assert.match(proxy, /thinkingConfig:\s*\{\s*thinkingLevel\s*\}/);
// Cache keys are re-bumped on every edit; require one at or after the 2026-09-11 series release.
const cacheDate=f=>Number((html.match(new RegExp("app/"+f.replace(/\./g,"\\.")+"\\?v=(\\d{8})"))||[])[1]||0);
assert.ok(cacheDate("ai.jsx")>=20260911, "ai.jsx cache key predates the series release");
assert.ok(cacheDate("aiwriter.jsx")>=20260909, "aiwriter.jsx cache key predates the Gemini 3.8 dock labels");

console.log("PASS current writing-model registry, proxy routing, reasoning, pricing and cache keys");

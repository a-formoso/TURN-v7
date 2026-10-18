#!/usr/bin/env node
/* test-eleven-v4.mjs — Eleven v4 for character voices (2026-10-11, owner — "bring in V4, remove V2 if we don't need it").
     A the server prices and routes it: $0.08 direct (held at the $0.10 rate), fal's elevenlabs/tts/eleven-v4 as the
       backup; stability + similarity only; a request naming no model is v4
     B the app offers Lifelike (v4) first and as the default for new voices, then Expressive (v3); Classic (v2) is no
       longer offered — but a voice locked on it keeps it (shown as its current model), and a lock that names no model
       stays on v3 (a lock's model never follows a new default)
     C the Voices window shows the server's own date for a voice
     D Frances
   node scripts/test-eleven-v4.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
let checks = 0, failed = 0;
const test = (name, fn) => { try { fn(); checks++; console.log("PASS", name); } catch (e) { failed++; console.error("FAIL", name, "\n ", e && e.message || e); } };
const proxy = read("supabase/functions/image-proxy/index.ts"), vg = read("app/voicegen.jsx"), ui = read("app/voices-ui.jsx"), ai = read("app/ai.jsx");

test("A the server: price, backup route, settings, default", () => {
  const t = "x".repeat(1000);
  assert.deepEqual(["direct", "fal", "hold"].map((route) => P.ttsCost(t, "eleven_v4", 0.01, { route }).providerCostUsd), [0.10, 0.08, 0.10]);
  assert.equal(P.ttsCost(t, "eleven_v4").falEndpoint, "elevenlabs/tts/eleven-v4");
  assert.ok(P.ttsCost(t, "eleven_multilingual_v2"), "a voice still on v2 keeps rendering");
  assert.match(proxy, /const ttsModelId = String\(body\.modelId \|\| "eleven_v4"\);/);
  assert.match(proxy, /const modelId = \(body\.modelId \|\| "eleven_v4"\)\.toString\(\);/);
  assert.match(proxy, /isV4\s*\? \{ stability: Math\.min\(1, Math\.max\(0, Number\.isFinite\(rawStab\) \? rawStab : 0\.5\)\), similarity_boost: s\.similarity \?\? 0\.75 \}/);
  assert.match(proxy, /\.\.\.\(isV4 && voiceSettings\.similarity_boost != null \? \{ similarity_boost: voiceSettings\.similarity_boost \} : \{\}\)/);
});

test("B the app: v4 first and the default; v2 retired but kept by a voice on it; unpinned locks stay on v3", () => {
  const box = { console }; box.window = box; vm.createContext(box);
  const a = vg.indexOf("const VG_TTS_MODEL"), b = vg.indexOf("window.VG_RETIRED_TTS_MODELS");
  vm.runInContext(vg.slice(a, vg.indexOf("\n", b)) + ";", box);
  assert.equal(box.VG_TTS_MODEL, "eleven_v4");
  assert.deepEqual(JSON.parse(JSON.stringify(box.VG_TTS_MODELS.map((m) => [m.id, m.label]))), [["eleven_v4", "Lifelike (v4)"], ["eleven_v3", "Expressive (v3)"]]);
  assert.deepEqual([...box.VG_RETIRED_TTS_MODELS.map((m) => m.id)], ["eleven_multilingual_v2"]);
  assert.equal(box.vgDeliveryModelOf(null), "eleven_v4", "a new voice");
  assert.equal(box.vgDeliveryModelOf({ voiceId: "v" }), "eleven_v3", "a lock from before locks named their model");
  assert.equal(box.vgDeliveryModelOf({ voiceId: "v", modelId: "eleven_multilingual_v2" }), "eleven_multilingual_v2", "never migrated");
  assert.ok(ui.includes("const retired = (window.VG_RETIRED_TTS_MODELS||[]).find(m=>m.id===effModel);"), "the picker shows a retired current model");
  assert.ok(read("app/stage.jsx").includes('if(c && c.voiceLock) return (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(c.voiceLock)'));
});

test("C the server's date wins in the Voices window", () => {
  assert.ok(ui.includes("const at = v.createdAt || vcRvAddedAt(v.voiceId) ||"));
  assert.match(proxy, /select\("voice_id, kind, person_kind, person_name, label, created_at, deleted_at"\)/);
});

test("D Frances", () => {
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb); vm.runInContext(ai.slice(a, b) + ";this.__F=APP_FEATURES;", fb);
  const all = fb.__F.map((f) => String(f.what || "")).join("\n");
  assert.ok(all.includes("Lifelike (v4) — THE DEFAULT for new voices"));
  assert.ok(all.includes("Classic (v2) is no longer offered for new voices; a voice already set to it keeps it until you choose another model"));
  assert.ok(!all.includes("Expressive (v3) — THE DEFAULT"));
  assert.ok(all.includes("the picker's Lifelike (v4) and Expressive (v3)"));
  const html = read("TURN.html");
  for (const f of ["voicegen", "voices-ui", "stage", "ai", "script"]) assert.ok(["20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27"].some((k) => html.includes('src="app/' + f + '.jsx?v=' + k + '"')), f);   // (later passes re-key some)
});

console.log(failed ? `FAIL ${failed} of ${checks + failed}` : `PASS Eleven v4 (${checks} checks)`);
process.exit(failed ? 1 : 0);

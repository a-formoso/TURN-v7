#!/usr/bin/env node
/* An admin account's run note (owner 2026-11-27: "yes, fix the credits note next").

   The pipeline test film's build ended with "This run used 25 writing-model calls · ≈0 credits". Nothing was wrong
   with billing: the account is an admin account, and the server never holds or charges an admin's calls
   (image-proxy: `textKind !== "muse" && !isAdmin`). The note was true and read like a fault.

   The writing tally now also keeps what an admin's calls cost on a paying account, from the provider cost the server
   reports for each call and the server's own rounding, and the run notes say both. A paying account's note is
   unchanged. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";
import * as P from "../supabase/functions/image-proxy/billing-pricing.mjs";

const read = (f) => readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};

const ai = read("app/ai.jsx"), agUi = read("app/agents-ui.jsx"), proxy = read("supabase/functions/image-proxy/index.ts");
const ast = parseSync(ai, { sourceType: "script" });
const pick = (n) => { const node = ast.program.body.find((x) => (x.type === "FunctionDeclaration" && x.id.name === n)
  || (x.type === "VariableDeclaration" && x.declarations.some((d) => d.id.name === n))); assert.ok(node, "missing " + n); return ai.slice(node.start, node.end); };

/* a page with a tally: the app's own three functions, run as they are */
function page({ admin }) {
  const store = new Map();
  const box = { console, Math, Number, JSON, Date,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    CustomEvent: function (n, o) { this.type = n; Object.assign(this, o); } };
  box.window = box; box.dispatchEvent = () => true;
  box.turnIsAdmin = admin; box.turnUserEmail = "writer@example.com"; box.CREDIT_SCALE = 10;
  // the app's rounding of a provider cost (pricing.jsx turnCreditCost) is the server's (creditsFromUsd, $0.01 a credit)
  box.turnCreditCost = (usd) => P.creditsFromUsd(usd, 0.01);
  vm.createContext(box);
  for (const n of ["TEXT_CREDIT_RATES", "_textSpendKey", "textSpendAdd", "turnTextSpend", "textSpendUsed"]) vm.runInContext(pick(n), box);
  return { box, add: (...a) => vm.runInContext("textSpendAdd", box)(...a), tally: () => JSON.parse(JSON.stringify(vm.runInContext("turnTextSpend", box)())),
    used: (a, b) => vm.runInContext("textSpendUsed", box)(a, b) };
}

await test("1 the server never charges an admin's writing call, and still reports what it cost", () => {
  assert.match(proxy, /if \(textKind !== "muse" && !isAdmin\) \{/);
  assert.match(proxy, /if \(isAdmin\) return \{ credits: 0, remaining: accountRemaining, plan: accountPlan \};/);
  assert.match(proxy, /usage: \{ \.\.\.usage, providerCostUsd: estimate\.providerCostUsd, credits: charged, /);
});

await test("2 an admin's tally: nothing charged, and what a paying account would have used", () => {
  const p = page({ admin: true });
  const s0 = p.tally();
  // 25 calls as the server answers an admin: credits 0, with each call's provider cost
  for (let i = 0; i < 25; i++) p.add("claude-opus-5-5", "writing", 0, 0.0571);
  const s1 = p.tally();
  assert.equal(s1.calls - s0.calls, 25);
  assert.equal(s1.credits, 0, "nothing charged, so nothing added to the charged tally");
  assert.equal(s1.unbilled, 25 * P.creditsFromUsd(0.0571, 0.01), "each call rounded up as the server would charge it (6 credits)");
  assert.equal(s1.unbilled, 150);
  assert.equal(p.used(s0, s1), "not charged on an admin account (about 150 credits on a paying account)");
  // one call
  const one = page({ admin: true }); const a = one.tally(); one.add("claude-opus-5-5", "writing", 0, 0.004);
  assert.equal(one.used(a, one.tally()), "not charged on an admin account (about 1 credit on a paying account)");
  // a reply with no cost on it (an older server): the note stays what it was
  const old = page({ admin: true }); const b = old.tally(); old.add("claude-opus-5-5", "writing", 0);
  assert.equal(old.used(b, old.tally()), "≈0 credits");
  assert.equal(old.tally().unbilled, undefined);
});

await test("3 a paying account's tally and note are what they were", () => {
  const p = page({ admin: false });
  const s0 = p.tally();
  p.add("claude-opus-5-5", "writing", 6, 0.0571); p.add("claude-opus-5-5", "writing", 7, 0.0612);
  const s1 = p.tally();
  assert.equal(s1.credits, 13); assert.equal(s1.unbilled, undefined, "a charged call is never counted as unbilled");
  assert.equal(p.used(s0, s1), "≈13 credits");
  const q = page({ admin: false }); const a = q.tally(); q.add("claude-opus-5-5", "writing", 1, 0.004);
  assert.equal(q.used(a, q.tally()), "≈1 credit");
  // a non-admin the server answered with 0 (it should not happen) is not given the admin wording
  const z = page({ admin: false }); const c = z.tally(); z.add("claude-opus-5-5", "writing", 0, 0.05);
  assert.equal(z.used(c, z.tally()), "≈0 credits");
  // an admin call that WAS charged (a film someone else pays is refused for admins; a charge still counts as one)
  const m = page({ admin: true }); const d = m.tally(); m.add("claude-opus-5-5", "writing", 4, 0.04);
  assert.equal(m.used(d, m.tally()), "≈4 credits");
  // Frances's free calls add no "paying account" figure
  const f = page({ admin: true }); f.add("claude-opus-5-5", "muse", 0);
  assert.equal(f.tally().unbilled, undefined);
});

await test("4 the calls pass the server's cost on, and the two run notes use the shared wording", () => {
  assert.ok(ai.includes('textSpendAdd(m.id, "writing", data && data.usage && data.usage.credits, data && data.usage && data.usage.providerCostUsd);'));
  assert.ok(ai.includes('textSpendAdd(m.id, "vision", data && data.usage && data.usage.credits, data && data.usage && data.usage.providerCostUsd);'));
  assert.ok(ai.includes('textSpendAdd(MUSE_MODEL.id, "muse", data && data.usage && data.usage.credits);'), "Frances's call is free: no cost passed");
  assert.ok(ai.includes("window.textSpendUsed = textSpendUsed;"));
  // the closing note of a run, and the note on Stop
  assert.ok(agUi.includes('const used = (typeof window.textSpendUsed==="function") ? window.textSpendUsed(spend0, s1) : '));
  assert.ok(agUi.includes('(free ? "." : " (estimate — see your account menu for the running total).")'));
  assert.ok(agUi.includes('" \\u00b7 "+((typeof window.textSpendUsed==="function") ? window.textSpendUsed(s0, s1) : '));
  // the wording matches the Stage's own for an admin ("not charged on an admin account")
  assert.ok(read("app/stage.jsx").includes("not charged on an admin account"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

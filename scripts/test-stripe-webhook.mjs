#!/usr/bin/env node
/* test-stripe-webhook.mjs — the Stripe webhook's billing fixes (owner decisions 2026-09-30).
   Runs the REAL supabase/functions/stripe-webhook/index.ts (TypeScript stripped by Node) with a
   fake Stripe SDK and a fake Supabase client that implements the shared database CONTRACT
   (turn_set_plan_once, turn_adjust_plan_once, turn_add_pack_once, turn_revoke_charge_once,
   turn_set_payment_status, turn_set_frozen, turn_end_plan_for_sub) with its "once" semantics.
   Every event type is sent in the OLD payload shape (API 2024-06-20, what stripe@16 fetches)
   and the DAHLIA shape (2026-03-25.dahlia, the live endpoint's version: no invoice.subscription,
   no charge.invoice, subscription periods on the items). Offline: no Stripe, no Supabase.

     A  signature, key/endpoint mode guard, unknown events, database errors -> 500 (retry)
     B  plan purchase: paid-only, keyed by the first invoice (checkout + invoice.paid = ONE
        grant, in either order), missing / invalid uid, other brands, unknown tier, pro alias
     C  renewals: once per invoice, packs untouched, pending downgrade applied and cleared,
        unknown customer, no subscription anywhere, non-plan invoices ignored
     D  plan changes: upgrade = allowance difference now (shared key with the proration
        invoice), downgrade = pending until renewal, downgrade-then-upgrade adds nothing
     E  failed payments -> past_due; paid -> active; other brands untouched
     F  packs: any signed-in account, charge id attached, once per checkout, delayed payments
     G  refunds (full -> revoke, partial -> owner review), disputes (freeze / unfreeze / lost)
     H  cancellation: only the stored subscription, other brands skipped
     I  source rules: only contract functions are called, the header lists every event
     J  round 2: an OLD-unit pack granted after the switch counts x3 (by its metadata); a grant
        the database refused leaves the payment status alone; header / comment wording
        round 3 (S6): the old pack's x3 is decided BY THE DATABASE (turn_add_pack_once's
        legacy_unit argument, under its locks); the webhook multiplies itself only against a
        database without that argument (PGRST202 / 42883) or for a mixed cart
     K  owner decisions 2026-10-01: the SALES LEDGER (D1) — every successful payment on the account,
        every app, once (turn_record_sale_once), with country / US state / where it came from, refunds
        negative, a missing function never failing the event; PROPORTIONAL partial refunds (D3,
        refund_fraction, once per refund, the old database's fallback = owner review); disputes (D4)
        lift the hold they placed, won or lost, never another open dispute's
        review fixes (2026-10-01): the dispute hold is ONE locked database call (turn_dispute_hold; two
        disputes delivered at the same moment both stay listed; the old two-step update only on a
        database without it); only SUCCEEDED refunds remove credits or write ledger rows (a pending one
        waits for charge.refund.updated, a failed one is recorded for the owner); a plan invoice paid
        partly from the customer's balance measures a refund's share against the invoice total; an
        unknown account whose ledger write also failed answers 500

   node scripts/test-stripe-webhook.mjs          (VERBOSE=1 prints the webhook's log lines;
                                                  STRIPE_WEBHOOK_INDEX=<file> tests a modified copy) */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
const FN_DIR = new URL("supabase/functions/stripe-webhook/", ROOT);
// STRIPE_WEBHOOK_INDEX=<file> runs the same checks against a modified copy of index.ts (used to
// prove the checks fail when a protection is removed, without touching the real file)
const SRC = readFileSync(process.env.STRIPE_WEBHOOK_INDEX || new URL("index.ts", FN_DIR), "utf8");
const VERBOSE = !!process.env.VERBOSE;

let checks = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
}

/* ── the contract (argument names exactly as the builders share them) ─────────────────── */
const CONTRACT = {
  turn_set_plan_once: ["event_id", "uid", "new_tier", "monthly_credits", "sub_id", "customer_id", "renews"],
  turn_adjust_plan_once: ["event_id", "uid", "new_tier", "add_credits", "sub_id"],
  turn_add_pack_once: ["event_id", "uid", "amount", "charge_id"],
  turn_revoke_charge_once: ["event_id", "charge_id"],
  turn_set_payment_status: ["uid", "status"],
  turn_set_frozen: ["uid", "frozen", "reason"],
  turn_end_plan_for_sub: ["uid", "sub_id"],
  // round 2: read only when a pack sold in the old unit is granted (x3 after the switch); round 3:
  // only against a database without turn_add_pack_once's legacy_unit argument, or a mixed cart
  turn_credit_regime: [],
  // 2026-10-01 (D1): the sales ledger the tax monitor reads (supabase/tax-compliance.sql)
  turn_record_sale_once: ["source_key", "app", "owner", "kind", "amount_cents", "currency", "country", "region", "country_source", "occurred_at", "stripe_ids"],
  // 2026-10-01 (D4, review fix): one dispute's part of the account hold, read and written under the account lock
  turn_dispute_hold: ["uid", "dispute_id", "open", "part"],
};
/* round 3 (S6): OPTIONAL trailing arguments a function may be called with; 2026-10-01 (D3): refund_fraction */
const CONTRACT_OPTIONAL = { turn_add_pack_once: ["legacy_unit"], turn_revoke_charge_once: ["refund_fraction"] };

/* ── fake database (contract semantics, simplified) ──────────────────────────────────── */
let DB;
function resetDb(opts = {}) {
  DB = { accounts: new Map(), keys: new Set(), rpcs: [], failures: [], updates: [], failRpc: opts.failRpc || null, hasPendingTier: opts.hasPendingTier !== false,
    switched: false, results: new Map(), conflictUids: new Set(), mismatchUids: new Set(), failResultRead: false,
    // round 3: a database whose turn_add_pack_once has no legacy_unit argument answers a call with it with
    // this error (true = PostgREST's PGRST202); legacyArgError = any other error for that call
    packFnNoLegacyArg: false, legacyArgError: null,
    // 2026-10-01: the sales ledger (source_key -> row); salesMissing = a database without turn_record_sale_once
    // (true = PGRST202, or an error object); salesError = any other error; revokeNoFraction = turn_revoke_charge_once
    // without the refund_fraction argument (true = PGRST202, or an error object); planGrants = turn_set_plan_once's grants by key
    sales: new Map(), salesMissing: false, salesError: null, revokeNoFraction: false, revokeError: null, planGrants: new Map(),
    // disputeFnMissing = a database without turn_dispute_hold (the webhook falls back to the two-step update)
    disputeFnMissing: false };
}
function acctRow(uid) {
  if (!DB.accounts.has(uid)) DB.accounts.set(uid, { owner: uid, plan: "none", plan_remaining: 0, packs: [], stripe_customer_id: null, stripe_sub_id: null, renews_at: null, payment_status: "active", frozen: false, pending_tier: null });
  return DB.accounts.get(uid);
}
function seedAccount(uid, fields) { Object.assign(acctRow(uid), fields); return DB.accounts.get(uid); }
const total = (a) => a.plan_remaining + a.packs.reduce((n, p) => n + p.left, 0);
function once(key) { if (DB.keys.has(key)) return false; DB.keys.add(key); return true; }
const RPC = {
  turn_set_plan_once(a) {
    const r = acctRow(a.uid);
    // turn__plan_conflict (billing-v2.sql): refused, recorded as the event's result {"skipped": …}
    if (DB.conflictUids.has(a.uid)) { if (once(a.event_id)) DB.results.set(a.event_id, { skipped: "subscription_conflict" }); return total(r); }
    if (once(a.event_id)) {
      DB.planGrants.set(a.event_id, { uid: a.uid, amount: a.monthly_credits });
      Object.assign(r, { plan: a.new_tier, plan_remaining: a.monthly_credits, renews_at: a.renews });
      r.stripe_sub_id = a.sub_id ?? r.stripe_sub_id; r.stripe_customer_id = a.customer_id ?? r.stripe_customer_id;
      r.grants = (r.grants || 0) + 1;
    }
    return total(r);
  },
  turn_adjust_plan_once(a) {
    const r = acctRow(a.uid);
    if (DB.mismatchUids.has(a.uid)) { if (once(a.event_id)) DB.results.set(a.event_id, { skipped: "subscription_mismatch" }); return total(r); }
    if (once(a.event_id)) { r.plan = a.new_tier; r.plan_remaining += a.add_credits; r.adjusts = (r.adjusts || 0) + 1; }
    return total(r);
  },
  turn_add_pack_once(a) {
    const r = acctRow(a.uid);
    // round 3: legacy_unit => true triples the lot when the switch has run — decided at the insert
    // (billing-v2.sql: after the function holds its locks), not from anything the webhook read earlier
    const amount = a.legacy_unit === true && DB.switched ? a.amount * 3 : a.amount;
    if (once(a.event_id)) {
      r.packs.push({ amount, left: amount, charge: a.charge_id, legacyUnit: a.legacy_unit === true });
      // billing-v2.sql: the event's result records the lot granted (and, for an old pack, whether it was tripled)
      DB.results.set(a.event_id, { lot_credits: amount, ...(a.legacy_unit === true ? { legacy_unit: true, x3: amount !== a.amount } : {}) });
    }
    return total(r);
  },
  turn_revoke_charge_once(a) {
    // D3 (2026-10-01): refund_fraction f (0 < f <= 1, default 1) removes min(unused, ceil(f x granted)) of each lot / plan
    // grant tied to the charge (or the grant's key); a lot stays revocable after a partial revoke
    const f = a.refund_fraction === undefined ? 1 : a.refund_fraction;
    assert.ok(typeof f === "number" && f > 0 && f <= 1, `refund_fraction in (0, 1]: ${f}`);
    if (!once("revoke:" + a.event_id)) return 0;
    let removed = 0;
    for (const r of DB.accounts.values()) for (const p of r.packs) if (p.charge && p.charge === a.charge_id) {
      const take = Math.min(p.left, f === 1 ? p.left : Math.ceil(f * p.amount)); removed += take; p.left -= take;
    }
    const g = DB.planGrants.get(a.charge_id);
    if (g) { const r = acctRow(g.uid); const take = Math.min(r.plan_remaining, Math.ceil(f * g.amount)); r.plan_remaining -= take; removed += take; }
    return removed;
  },
  turn_set_payment_status(a) { acctRow(a.uid).payment_status = a.status; return null; },
  turn_set_frozen(a) { Object.assign(acctRow(a.uid), { frozen: a.frozen, frozen_reason: a.reason }); return null; },
  turn_dispute_hold(a) {
    // tax-compliance.sql: ONE synchronous step (the account lock) — read the reason, add / remove this dispute's part
    assert.ok(/^[A-Za-z0-9_]{1,100}$/.test(a.dispute_id), `dispute_id ${a.dispute_id}`); assert.equal(typeof a.open, "boolean");
    const r = acctRow(a.uid);
    const names = (t) => new RegExp(`(^|[^A-Za-z0-9_])dispute ${a.dispute_id}([^A-Za-z0-9_]|$)`).test(t);
    const old = r.frozen && typeof r.frozen_reason === "string" && r.frozen_reason.trim() ? r.frozen_reason.trim() : null;
    if (a.open) {
      const next = !r.frozen ? a.part : old && names(old) ? old : (old || "earlier hold (no reason given)") + " | " + a.part;
      Object.assign(r, { frozen: true, frozen_reason: next });
      return { action: "frozen", frozen: true, frozen_reason: next };
    }
    if (!r.frozen) { Object.assign(r, { frozen: false, frozen_reason: a.part }); return { action: "lifted", frozen: false, frozen_reason: a.part }; }
    const parts = (old || "").split(" | ").map((x) => x.trim()).filter(Boolean);
    const rest = parts.filter((x) => !names(x));
    if (parts.length && !rest.length) { Object.assign(r, { frozen: false, frozen_reason: a.part }); return { action: "lifted", frozen: false, frozen_reason: a.part }; }
    if (rest.length === parts.length) return { action: "review", frozen: true, frozen_reason: old };
    r.frozen_reason = rest.join(" | ");
    return { action: "kept", frozen: true, frozen_reason: r.frozen_reason };
  },
  turn_end_plan_for_sub(a) {
    const r = DB.accounts.get(a.uid);
    if (r && r.stripe_sub_id === a.sub_id) Object.assign(r, { plan: "none", plan_remaining: 0, stripe_sub_id: null, renews_at: null, pending_tier: null });
    return null;
  },
  turn_record_sale_once(a) {
    // the shared contract's shapes (tax-compliance.sql): the webhook must send rows the table accepts
    assert.ok(typeof a.source_key === "string" && /^(invoice|checkout|refund):\S+$/.test(a.source_key), `source_key ${a.source_key}`);
    assert.ok(["kinolot", "other"].includes(a.app), `app ${a.app}`);
    assert.ok(["plan", "pack", "other", "refund"].includes(a.kind), `kind ${a.kind}`);
    assert.ok(Number.isInteger(a.amount_cents) && (a.kind === "refund" ? a.amount_cents < 0 : a.amount_cents > 0), `amount_cents ${a.amount_cents} (${a.kind})`);
    assert.ok(/^[a-z]{3}$/.test(a.currency), `currency ${a.currency}`);
    assert.ok(a.country === null || /^[A-Z]{2}$/.test(a.country), `country ${a.country}`);
    assert.ok(a.region === null || (a.country === "US" && /^[A-Z]{2}$/.test(a.region)), `region ${a.region}`);
    assert.ok(a.country_source === null || ["invoice_address", "checkout_address", "customer_address", "billing_address", "card_country"].includes(a.country_source), `country_source ${a.country_source}`);
    assert.ok((a.country === null) === (a.country_source === null), "a country comes with its source");
    assert.ok(typeof a.occurred_at === "string" && !Number.isNaN(Date.parse(a.occurred_at)), `occurred_at ${a.occurred_at}`);
    assert.ok(a.stripe_ids && typeof a.stripe_ids === "object" && !Array.isArray(a.stripe_ids), "stripe_ids object");
    assert.ok(a.owner === null || a.app === "kinolot", "only Kinolot rows carry an owner");
    if (DB.sales.has(a.source_key)) return false;
    DB.sales.set(a.source_key, { ...a });
    return true;
  },
  turn_credit_regime() {
    if (DB.regimeBroken) return [];
    return [{ switched: DB.switched, switched_at: DB.switched ? "2026-10-30T00:00:00Z" : null, usd_per_credit: DB.switched ? "0.01" : "0.03", trial_credits: DB.switched ? 50 : 0, legacy_until: null }];
  },
};
function publicRow(r) {
  const { packs, grants, adjusts, ...rest } = r;   // frozen_reason is a turn_credits column (D4 reads it)
  const row = { ...rest, remaining: total(r) };
  if (!DB.hasPendingTier) delete row.pending_tier;
  return row;
}
function fakeSupabase() {
  return {
    async rpc(name, args) {
      DB.rpcs.push([name, args]);
      if (!CONTRACT[name]) throw new Error(`webhook called a function outside the contract: ${name}`);
      const optional = CONTRACT_OPTIONAL[name] || [];
      assert.deepEqual(Object.keys(args).filter((k) => !optional.includes(k)).sort(), [...CONTRACT[name]].sort(), `${name} arguments`);
      if (name === "turn_add_pack_once" && "legacy_unit" in args) {
        assert.equal(args.legacy_unit, true, "legacy_unit is only ever sent as true");
        if (DB.packFnNoLegacyArg) return { data: null, error: DB.packFnNoLegacyArg === true
          ? { code: "PGRST202", message: "Could not find the function public.turn_add_pack_once(amount, charge_id, event_id, legacy_unit, uid) in the schema cache",
              details: "Searched for the function public.turn_add_pack_once with parameters amount, charge_id, event_id, legacy_unit, uid or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
              hint: "Perhaps you meant to call the function public.turn_add_pack_once(amount, charge_id, event_id, uid)" }
          : DB.packFnNoLegacyArg };
        if (DB.legacyArgError) return { data: null, error: DB.legacyArgError };
      }
      const pgrst202 = (fn, argNames) => ({ code: "PGRST202", message: `Could not find the function public.${fn}(${argNames}) in the schema cache` });
      if (name === "turn_record_sale_once") {
        if (DB.salesMissing) return { data: null, error: DB.salesMissing === true ? pgrst202(name, Object.keys(args).sort().join(", ")) : DB.salesMissing };
        if (DB.salesError) return { data: null, error: DB.salesError };
        if (DB.noUser && args.owner === DB.noUser) return { data: null, error: { code: "23503", message: 'insert or update on table "turn_sales_ledger" violates foreign key constraint' } };
      }
      if (name === "turn_dispute_hold" && DB.disputeFnMissing) {
        return { data: null, error: DB.disputeFnMissing === true ? pgrst202(name, "dispute_id, open, part, uid") : DB.disputeFnMissing };
      }
      if (name === "turn_revoke_charge_once" && "refund_fraction" in args) {
        if (DB.revokeNoFraction) return { data: null, error: DB.revokeNoFraction === true ? pgrst202(name, "charge_id, event_id, refund_fraction") : DB.revokeNoFraction };
        if (DB.revokeError) return { data: null, error: DB.revokeError };
      }
      if (DB.failRpc === name) return { data: null, error: { message: "boom (injected)" } };
      if (DB.noUser && args.uid === DB.noUser) return { data: null, error: { code: "23503", message: 'insert or update on table "turn_credits" violates foreign key constraint', details: "Key (owner) is not present in table \"users\"." } };
      return { data: RPC[name](args), error: null };
    },
    from(table) {
      return {
        async insert(row) { if (table === "turn_grant_failures") DB.failures.push(row); return { error: null }; },
        select(_cols) {
          const rows = (col, val) => (table === "turn_credits" ? [...DB.accounts.values()].filter((x) => x[col] === val).map(publicRow)
            : table === "turn_stripe_events" && col === "id" && DB.keys.has(val) ? [{ id: val, result: DB.results.get(val) ?? null }] : []);
          if (table === "turn_stripe_events" && DB.failResultRead) return { eq() { return { async maybeSingle() { return { data: null, error: { message: "permission denied (injected)" } }; } }; } };
          return { eq(col, val) { return {
            async maybeSingle() { const r = rows(col, val); return r.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: r[0] ?? null, error: null }; },
            async limit(n) { return { data: rows(col, val).slice(0, n), error: null }; },
          }; } };
        },
        update(obj) {
          return { async eq(col, val) {
            DB.updates.push([table, obj, col, val]);
            if ("pending_tier" in obj && !DB.hasPendingTier) return { error: { message: "Could not find the 'pending_tier' column of 'turn_credits' in the schema cache" } };
            const r = DB.accounts.get(val); if (r) Object.assign(r, obj);
            return { error: null };
          } };
        },
      };
    },
  };
}

/* ── fake Stripe (objects come back in the stripe@16 / 2024-06-20 shape) ──────────────── */
let W;
function resetStripe() { W = { products: {}, subs: {}, invoices: {}, sessions: [], lineItems: {}, pis: {}, charges: {}, customers: {}, refunds: {}, calls: [] }; }
class FakeStripe {
  constructor(key) { this.key = key; this.webhooks = { constructEventAsync: async (body, sig) => { if (sig !== "good") throw new Error("No signatures found matching the expected signature"); return JSON.parse(body); } };
    const miss = (what, id) => Object.assign(new Error(`No such ${what}: '${id}'`), { type: "StripeInvalidRequestError" });
    this.subscriptions = { retrieve: async (id, opts) => { W.calls.push(["subscriptions.retrieve", id]); const s = W.subs[id]; if (!s) throw miss("subscription", id);
      const c = structuredClone(s); if (opts?.expand?.includes("items.data.price.product")) for (const it of c.items.data) it.price.product = structuredClone(W.products[it.price.product]); return c; } };
    this.invoices = { retrieve: async (id) => { W.calls.push(["invoices.retrieve", id]); if (!W.invoices[id]) throw miss("invoice", id); return structuredClone(W.invoices[id]); } };
    this.charges = { retrieve: async (id) => { W.calls.push(["charges.retrieve", id]); if (!W.charges[id]) throw miss("charge", id); return structuredClone(W.charges[id]); } };
    this.paymentIntents = { retrieve: async (id) => { W.calls.push(["paymentIntents.retrieve", id]); if (W.onPaymentIntent) W.onPaymentIntent(); if (!W.pis[id]) throw miss("payment_intent", id); return structuredClone(W.pis[id]); } };
    this.customers = { retrieve: async (id) => { W.calls.push(["customers.retrieve", id]); if (!W.customers[id]) throw miss("customer", id); return structuredClone(W.customers[id]); } };
    this.refunds = { list: async (p) => { W.calls.push(["refunds.list", p]); return { object: "list", has_more: false, data: (W.refunds[p.charge] || []).map((r) => structuredClone(r)) }; } };
    this.products = { retrieve: async (id) => { W.calls.push(["products.retrieve", id]); if (!W.products[id]) throw miss("product", id); return structuredClone(W.products[id]); } };
    this.checkout = { sessions: {
      listLineItems: async (id) => { W.calls.push(["sessions.listLineItems", id]); return { data: (W.lineItems[id] || []).map((it) => ({ quantity: it.quantity, price: { product: structuredClone(W.products[it.product]) } })) }; },
      list: async (p) => { W.calls.push(["sessions.list", p]); return { data: W.sessions.filter((s) => (p.subscription ? s.subscription === p.subscription : true) && (p.payment_intent ? s.payment_intent === p.payment_intent : true)).slice(0, p.limit || 10).map((s) => structuredClone(s)) }; },
    } };
  }
}

/* ── load the real handler ───────────────────────────────────────────────────────────── */
const ENV = { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_fake", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" };
const TMP = mkdtempSync(join(tmpdir(), "stripe-webhook-test-"));
let handler = null;
{
  const src = SRC
    .replace('import Stripe from "npm:stripe@16";', "const Stripe = globalThis.__FakeStripe;")
    .replace('import { createClient } from "npm:@supabase/supabase-js@2";', "const createClient = globalThis.__fakeCreateClient;")
    .replace('from "./plan-metadata.mjs"', `from ${JSON.stringify(new URL("plan-metadata.mjs", FN_DIR).href)}`)
    .replace('from "./sales-ledger.mjs"', `from ${JSON.stringify(new URL("sales-ledger.mjs", FN_DIR).href)}`);
  assert.ok(src.includes("globalThis.__FakeStripe") && src.includes("globalThis.__fakeCreateClient"), "imports replaced");
  const emitWarning = process.emitWarning;   // Node flags stripTypeScriptTypes as experimental
  process.emitWarning = (w, ...rest) => (/stripTypeScriptTypes/.test(String(w)) ? undefined : emitWarning.call(process, w, ...rest));
  const js = stripTypeScriptTypes(src, { mode: "strip" });
  process.emitWarning = emitWarning;
  const file = join(TMP, "handler.mjs");
  writeFileSync(file, js);
  globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
  globalThis.__FakeStripe = FakeStripe;
  globalThis.__fakeCreateClient = () => fakeSupabase();
  await import(pathToFileURL(file).href);
  rmSync(TMP, { recursive: true, force: true });
}

let LOG = [];
// re-entrant: deliveries sent in parallel (K9c) share one capture, and the real console comes back
// only when the last one finishes
let SENDING = 0, REAL_CONSOLE = null;
async function send(event, sig = "good") {   // log lines accumulate until the next world()
  if (SENDING++ === 0) {
    const orig = REAL_CONSOLE = { log: console.log, warn: console.warn, error: console.error };
    const cap = (lvl) => (...a) => { const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); LOG.push(line); if (VERBOSE) orig.log(`   [${lvl}] ${line}`); };
    console.log = cap("log"); console.warn = cap("warn"); console.error = cap("error");
  }
  try {
    const res = await handler(new Request("http://localhost/stripe-webhook", { method: "POST", body: JSON.stringify(event), headers: { "stripe-signature": sig } }));
    return { status: res.status, text: await res.text() };
  } finally { if (--SENDING === 0) Object.assign(console, REAL_CONSOLE); }
}
const logHas = (re) => LOG.some((l) => re.test(l));
const rpcs = (name) => DB.rpcs.filter(([n]) => n === name).map(([, a]) => a);
/** every database call except the sales ledger's (which records EVERY payment, any app) */
const creditRpcs = () => DB.rpcs.filter(([n]) => n !== "turn_record_sale_once");
const failures = (reason) => DB.failures.filter((f) => f.reason === reason);

/* ── fixtures ─────────────────────────────────────────────────────────────────────────── */
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const T0 = 1790000000, T1 = T0 + 30 * 86400, T2 = T1 + 31 * 86400;
const iso = (t) => new Date(t * 1000).toISOString();
function world() {
  resetStripe(); resetDb(); LOG = [];
  Object.assign(W.products, {
    prod_writer: { id: "prod_writer", object: "product", metadata: { app: "kinolot", tier: "writer", plan_credits: "600" } },
    prod_director: { id: "prod_director", object: "product", metadata: { app: "kinolot", tier: "director", plan_credits: "1600" } },
    prod_producer: { id: "prod_producer", object: "product", metadata: { app: "kinolot", tier: "producer", plan_credits: "5000" } },
    prod_writer_pre: { id: "prod_writer_pre", object: "product", metadata: { app: "cinema-machine", tier: "writer", plan_credits: "800" } },
    prod_director_pre: { id: "prod_director_pre", object: "product", metadata: { app: "cinema-machine", tier: "director", plan_credits: "2400" } },
    prod_pro: { id: "prod_pro", object: "product", metadata: { app: "kinolot", tier: "pro", plan_credits: "1600" } },
    prod_typo: { id: "prod_typo", object: "product", metadata: { app: "kinolot", tier: "prodcer", plan_credits: "5000" } },
    prod_academy: { id: "prod_academy", object: "product", metadata: { app: "academy" } },
    prod_pack250: { id: "prod_pack250", object: "product", metadata: { app: "kinolot", kind: "credit_pack", pack_credits: "250" } },
    prod_pack1000: { id: "prod_pack1000", object: "product", metadata: { app: "kinolot", kind: "credit_pack", pack_credits: "1000" } },
    prod_pack_nokind: { id: "prod_pack_nokind", object: "product", metadata: { app: "kinolot", pack_credits: "250" } },
    // the three packs on sale before the switch day, in the old unit (app/plans.jsx LEGACY_CREDIT_PACKS)
    prod_old300: { id: "prod_old300", object: "product", metadata: { app: "kinolot", kind: "credit_pack", pack_credits: "300" } },
    prod_old1200: { id: "prod_old1200", object: "product", metadata: { app: "cinema-machine", kind: "credit_pack", pack_credits: "1200" } },
    prod_old4000: { id: "prod_old4000", object: "product", metadata: { app: "kinolot", kind: "credit_pack", pack_credits: "4000", unit: "legacy" } },
    prod_new300: { id: "prod_new300", object: "product", metadata: { app: "kinolot", kind: "credit_pack", pack_credits: "300", unit: "option-a" } },
    prod_labelled: { id: "prod_labelled", object: "product", metadata: { app: "kinolot", kind: "credit_pack", pack_credits: "500", unit: "pre-switch" } },
    prod_course: { id: "prod_course", object: "product", metadata: { app: "academy", kind: "course" } },
  });
}
/** a subscription as stripe@16 returns it (period at the top level) */
function stripeSub(id, product, o = {}) {
  W.subs[id] = { id, object: "subscription", customer: o.customer ?? "cus_1", status: o.status ?? "active", pending_update: o.pending_update ?? null,
    current_period_start: o.start ?? T0, current_period_end: o.end ?? T1, latest_invoice: o.latest_invoice ?? null,
    items: { data: [{ id: "si_" + id, price: { id: "price_" + product, product } }] } };
  return W.subs[id];
}
/** event payload shapes */
const API = { old: "2024-06-20", dahlia: "2026-03-25.dahlia" };
const TEV = T0 + 7200;   // every test event's `created` (the sales ledger's time for a checkout)
function evt(id, type, object, shape = "old", extra = {}) {
  return { id, object: "event", type, created: TEV, livemode: false, api_version: API[shape], data: { object, ...extra } };
}
function sessionObj(o) {
  const s = { id: o.id ?? "cs_1", object: "checkout.session", mode: o.mode ?? "subscription", payment_status: o.payment_status ?? "paid", status: "complete",
    client_reference_id: o.uid === undefined ? U1 : o.uid, customer: o.customer === undefined ? "cus_1" : o.customer,
    subscription: o.subscription ?? null, invoice: o.invoice ?? null, payment_intent: o.payment_intent ?? null };
  // 2026-10-01 (sales ledger): the amount paid and the address Checkout collected
  if (o.amount !== undefined) Object.assign(s, { amount_total: o.amount, currency: o.currency ?? "usd", customer_details: { email: "x@example.com", address: o.address ?? null } });
  return s;
}
function invoiceObj(shape, o) {
  const base = { id: o.id, object: "invoice", billing_reason: o.reason, customer: o.customer ?? "cus_1", status: "paid", attempt_count: o.attempt ?? 1, next_payment_attempt: o.next ?? null };
  // 2026-10-01 (sales ledger): what was paid, in which currency, the customer's address, when, and the line products
  if (o.amount !== undefined) Object.assign(base, { amount_paid: o.amount, currency: o.currency ?? "usd", customer_address: o.address ?? null, status_transitions: { paid_at: o.paidAt ?? null } });
  if (o.lines) base.lines = { object: "list", data: o.lines.map((p) => (shape === "old" ? { price: { product: p } } : { pricing: { price_details: { product: p } } })) };
  if (shape === "old") return { ...base, subscription: o.sub ?? null, charge: o.charge ?? null };
  return { ...base, parent: o.sub ? { type: "subscription_details", subscription_details: { subscription: o.sub, metadata: {} } } : null };
}
function subObj(shape, id, product, o = {}) {
  const item = { id: "si_" + id, price: { id: "price_" + product, product } };   // events don't expand the product
  const s = { id, object: "subscription", customer: o.customer ?? "cus_1", status: o.status ?? "active", cancel_at_period_end: !!o.cancel, items: { object: "list", data: [item] } };
  if (shape === "old") Object.assign(s, { current_period_start: o.start ?? T0, current_period_end: o.end ?? T1 });
  else Object.assign(item, { current_period_start: o.start ?? T0, current_period_end: o.end ?? T1 });
  return s;
}
function chargeObj(shape, o) {
  const c = { id: o.id, object: "charge", amount: o.amount ?? 1000, amount_refunded: o.refunded ?? 0, refunded: (o.refunded ?? 0) >= (o.amount ?? 1000),
    customer: o.customer ?? null, payment_intent: o.pi ?? null, currency: "usd",
    billing_details: { address: o.billing ?? null }, payment_method_details: { type: "card", card: { country: o.card ?? null } } };
  if (shape === "old") c.invoice = o.invoice ?? null;
  return c;
}
/** a completed subscription purchase already processed (for renewal / change / cancel tests) */
function subscribed(uid, product, o = {}) {
  const sub = stripeSub(o.sub ?? "sub_1", product, o);
  const tier = { prod_writer: "writer", prod_director: "director", prod_producer: "studio", prod_writer_pre: "writer", prod_director_pre: "director" }[product];
  const credits = Number(W.products[product].metadata.plan_credits);
  seedAccount(uid, { plan: tier, plan_remaining: o.remaining ?? credits, stripe_customer_id: o.customer ?? "cus_1", stripe_sub_id: sub.id, renews_at: iso(T1), pending_tier: o.pending ?? null });
  return sub;
}

/* ════ A. entry ═══════════════════════════════════════════════════════════════════════ */
await test("A1 a bad signature is refused with 400 and nothing runs", async () => {
  world();
  const r = await send(evt("evt_bad", "invoice.paid", invoiceObj("old", { id: "in_1", reason: "subscription_cycle", sub: "sub_1" })), "forged");
  assert.equal(r.status, 400); assert.equal(DB.rpcs.length, 0); assert.equal(W.calls.length, 0);
});
await test("A2 every event logs a STRIPE_EVENT line with its API version; unknown types answer 200 and touch nothing", async () => {
  world();
  const r = await send(evt("evt_x", "customer.created", { id: "cus_9" }, "dahlia"));
  assert.equal(r.status, 200); assert.equal(DB.rpcs.length, 0);
  assert.ok(logHas(/STRIPE_EVENT id=evt_x type=customer\.created livemode=false api=2026-03-25\.dahlia/));
  assert.ok(logHas(/IGNORED type=customer\.created/));
});
await test("A3 a live event reaching a test key is refused with 500 (Stripe retries) and recorded as mode_mismatch", async () => {
  world(); subscribed(U1, "prod_director");
  const e = evt("evt_live", "invoice.paid", invoiceObj("old", { id: "in_2", reason: "subscription_cycle", sub: "sub_1" })); e.livemode = true;
  const r = await send(e);
  assert.equal(r.status, 500); assert.equal(DB.rpcs.length, 0); assert.equal(W.calls.length, 0);
  assert.equal(failures("mode_mismatch").length, 1); assert.deepEqual(failures("mode_mismatch")[0].details, { event_livemode: true, key_mode: "test" });
});
await test("A4 a database error answers 500 so Stripe retries; the retry then grants exactly once", async () => {
  world(); subscribed(U1, "prod_director", { remaining: 10 }); DB.failRpc = "turn_set_plan_once";
  const e = evt("evt_retry", "invoice.paid", invoiceObj("old", { id: "in_3", reason: "subscription_cycle", sub: "sub_1" }));
  assert.equal((await send(e)).status, 500);
  assert.ok(logHas(/RPC_ERROR fn=turn_set_plan_once/) && logHas(/handler error event=evt_retry/));
  assert.equal(DB.accounts.get(U1).plan_remaining, 10, "nothing applied");
  DB.failRpc = null;
  assert.equal((await send(e)).status, 200); assert.equal((await send(e)).status, 200);
  assert.equal(DB.accounts.get(U1).plan_remaining, 1600); assert.equal(DB.accounts.get(U1).grants, 1);
});

await test("A5 a well-formed uid of NO account (foreign-key violation) is recorded as unknown_user and answered 200 (a retry can't help)", async () => {
  world(); DB.noUser = U2; W.pis.pi = { id: "pi", latest_charge: "ch" }; W.lineItems.cs = [{ product: "prod_pack250", quantity: 1 }];
  const r = await send(evt("evt_nu", "checkout.session.completed", sessionObj({ id: "cs", mode: "payment", uid: U2, payment_intent: "pi" })));
  assert.equal(r.status, 200); assert.equal(failures("unknown_user").length, 1); assert.equal(DB.accounts.has(U2), false);
});

/* ════ B. plan purchase ═══════════════════════════════════════════════════════════════ */
for (const shape of ["old", "dahlia"]) {
  await test(`B1 [${shape}] a paid plan checkout grants once, keyed by its first invoice, with the renewal date and customer`, async () => {
    world(); stripeSub("sub_new", "prod_director", { customer: "cus_new", start: T0, end: T1 });
    const r = await send(evt("evt_co", "checkout.session.completed", sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new" }), shape));
    assert.equal(r.status, 200);
    assert.deepEqual(rpcs("turn_set_plan_once"), [{ event_id: "invoice:in_first", uid: U1, new_tier: "director", monthly_credits: 1600, sub_id: "sub_new", customer_id: "cus_new", renews: iso(T1) }]);
    assert.deepEqual(rpcs("turn_set_payment_status"), [{ uid: U1, status: "active" }]);
    assert.ok(logHas(/PLAN_GRANT event=evt_co key=invoice:in_first source=checkout/));
  });
  await test(`B2 [${shape}] checkout then invoice.paid (subscription_create) for the same invoice = ONE grant`, async () => {
    world(); stripeSub("sub_new", "prod_writer", { customer: "cus_new" });
    W.sessions.push(sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new" }));
    await send(evt("evt_co", "checkout.session.completed", sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new" }), shape));
    DB.accounts.get(U1).plan_remaining -= 25;   // spent in the seconds between the two events
    const r = await send(evt("evt_inv", "invoice.paid", invoiceObj(shape, { id: "in_first", reason: "subscription_create", sub: "sub_new", customer: "cus_new" }), shape));
    assert.equal(r.status, 200);
    const calls = rpcs("turn_set_plan_once");
    assert.equal(calls.length, 2); assert.ok(calls.every((c) => c.event_id === "invoice:in_first"), "the same key both times");
    assert.equal(DB.accounts.get(U1).grants, 1); assert.equal(DB.accounts.get(U1).plan_remaining, 575, "no refill of what was spent");
  });
  await test(`B3 [${shape}] invoice.paid arriving BEFORE the checkout finds the uid on the Checkout Session; the checkout is then a no-op`, async () => {
    world(); stripeSub("sub_new", "prod_producer", { customer: "cus_new" });
    W.sessions.push(sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new" }));
    const r = await send(evt("evt_inv", "invoice.paid", invoiceObj(shape, { id: "in_first", reason: "subscription_create", sub: "sub_new", customer: "cus_new" }), shape));
    assert.equal(r.status, 200); assert.equal(DB.failures.length, 0, "no unknown_customer row");
    assert.deepEqual(rpcs("turn_set_plan_once")[0], { event_id: "invoice:in_first", uid: U1, new_tier: "studio", monthly_credits: 5000, sub_id: "sub_new", customer_id: "cus_new", renews: iso(T1) });
    await send(evt("evt_co", "checkout.session.completed", sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new" }), shape));
    assert.equal(DB.accounts.get(U1).grants, 1);
  });
}
await test("B4 an UNPAID checkout (delayed payment method) grants nothing; the later invoice.paid grants it", async () => {
  world(); stripeSub("sub_new", "prod_writer", { customer: "cus_new" });
  W.sessions.push(sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new", payment_status: "unpaid" }));
  await send(evt("evt_co", "checkout.session.completed", sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new", payment_status: "unpaid" })));
  assert.equal(rpcs("turn_set_plan_once").length, 0); assert.ok(logHas(/CHECKOUT_UNPAID event=evt_co .*status=unpaid/));
  await send(evt("evt_inv", "invoice.paid", invoiceObj("dahlia", { id: "in_first", reason: "subscription_create", sub: "sub_new", customer: "cus_new" }), "dahlia"));
  assert.equal(DB.accounts.get(U1).plan, "writer"); assert.equal(DB.accounts.get(U1).plan_remaining, 600);
  assert.equal(DB.accounts.get(U1).stripe_customer_id, "cus_new");
});
await test("B5 no_payment_required (a 100% coupon) counts as paid; async_payment_succeeded grants with the same invoice key", async () => {
  world(); stripeSub("sub_new", "prod_writer");
  await send(evt("evt_a", "checkout.session.completed", sessionObj({ subscription: "sub_new", invoice: "in_f", payment_status: "no_payment_required" })));
  await send(evt("evt_b", "checkout.session.async_payment_succeeded", sessionObj({ subscription: "sub_new", invoice: "in_f" })));
  assert.deepEqual(rpcs("turn_set_plan_once").map((c) => c.event_id), ["invoice:in_f", "invoice:in_f"]); assert.equal(DB.accounts.get(U1).grants, 1);
});
await test("B6 no invoice id on the session: the subscription's latest invoice keys it; neither -> the event id", async () => {
  world(); stripeSub("sub_a", "prod_writer", { latest_invoice: "in_latest" }); stripeSub("sub_b", "prod_writer");
  await send(evt("evt_a", "checkout.session.completed", sessionObj({ subscription: "sub_a" })));
  await send(evt("evt_b", "checkout.session.completed", sessionObj({ id: "cs_2", uid: U2, subscription: "sub_b" })));
  assert.deepEqual(rpcs("turn_set_plan_once").map((c) => c.event_id), ["invoice:in_latest", "evt_b"]);
});
await test("B7 a Kinolot checkout without a uid is recorded (missing_client_reference_id); a malformed uid too; another brand's is skipped", async () => {
  world(); stripeSub("sub_k", "prod_director"); stripeSub("sub_x", "prod_academy");
  await send(evt("evt_1", "checkout.session.completed", sessionObj({ uid: null, subscription: "sub_k" })));
  await send(evt("evt_2", "checkout.session.completed", sessionObj({ uid: "not-a-uuid", subscription: "sub_k" })));
  await send(evt("evt_3", "checkout.session.completed", sessionObj({ uid: null, subscription: "sub_x" })));
  await send(evt("evt_4", "checkout.session.completed", sessionObj({ subscription: "sub_x" })));
  assert.equal(rpcs("turn_set_plan_once").length, 0);
  assert.equal(failures("missing_client_reference_id").length, 1);
  const bad = failures("invalid_client_reference_id"); assert.equal(bad.length, 1); assert.equal(bad[0].uid, null, "never writes a non-uuid into the uuid column"); assert.equal(bad[0].details.raw_uid, "not-a-uuid");
  assert.equal(DB.failures.length, 2); assert.ok(logHas(/SKIP other_app event=evt_4 product=prod_academy/));
});
await test("B8 tier=producer is stored as studio, legacy tier=pro as director; a typo still grants but is recorded (unknown_tier)", async () => {
  world(); stripeSub("sub_p", "prod_pro"); stripeSub("sub_t", "prod_typo", { customer: "cus_2" });
  await send(evt("evt_p", "checkout.session.completed", sessionObj({ subscription: "sub_p", invoice: "in_p" })));
  await send(evt("evt_t", "checkout.session.completed", sessionObj({ id: "cs_t", uid: U2, subscription: "sub_t", invoice: "in_t", customer: "cus_2" })));
  assert.equal(DB.accounts.get(U1).plan, "director");
  assert.equal(DB.accounts.get(U2).plan, "prodcer"); assert.equal(failures("unknown_tier").length, 1);
});
await test("B9 a subscriber buying a SECOND plan through a payment link is honoured but recorded (duplicate_subscription)", async () => {
  world(); subscribed(U1, "prod_writer", { sub: "sub_old", customer: "cus_old" }); stripeSub("sub_second", "prod_director", { customer: "cus_second" });
  W.sessions.push(sessionObj({ subscription: "sub_second", invoice: "in_2nd", customer: "cus_second" }));
  await send(evt("evt_co", "checkout.session.completed", sessionObj({ subscription: "sub_second", invoice: "in_2nd", customer: "cus_second" })));
  await send(evt("evt_inv", "invoice.paid", invoiceObj("dahlia", { id: "in_2nd", reason: "subscription_create", sub: "sub_second", customer: "cus_second" }), "dahlia"));
  const d = failures("duplicate_subscription"); assert.equal(d.length, 1, "recorded once, not per event"); assert.equal(d[0].details.stored_sub, "sub_old");
  assert.equal(DB.accounts.get(U1).plan, "director");
});

/* ════ C. renewals ═════════════════════════════════════════════════════════════════════ */
for (const shape of ["old", "dahlia"]) {
  await test(`C1 [${shape}] a renewal refills PLAN credits once per invoice; pack credits are untouched`, async () => {
    world(); subscribed(U1, "prod_director", { remaining: 40, end: T2, start: T1 }); DB.accounts.get(U1).packs.push({ amount: 1000, left: 700, charge: "ch_p" });
    const e = evt("evt_r", "invoice.paid", invoiceObj(shape, { id: "in_r", reason: "subscription_cycle", sub: "sub_1" }), shape);
    assert.equal((await send(e)).status, 200);
    await send({ ...e, id: "evt_r_dup" });   // Stripe re-sending the same invoice under a new event
    assert.deepEqual(rpcs("turn_set_plan_once")[0], { event_id: "invoice:in_r", uid: U1, new_tier: "director", monthly_credits: 1600, sub_id: "sub_1", customer_id: "cus_1", renews: iso(T2) });
    const a = DB.accounts.get(U1); assert.equal(a.grants, 1); assert.equal(a.plan_remaining, 1600); assert.equal(a.packs[0].left, 700);
    assert.equal(a.payment_status, "active");
  });
}
await test("C2 [dahlia] the subscription id only in the API copy of the invoice is found; none anywhere -> renewal_without_subscription", async () => {
  world(); subscribed(U1, "prod_writer");
  W.invoices.in_api = { id: "in_api", subscription: "sub_1", customer: "cus_1" };
  await send(evt("evt_1", "invoice.paid", invoiceObj("dahlia", { id: "in_api", reason: "subscription_cycle" }), "dahlia"));
  assert.equal(rpcs("turn_set_plan_once").length, 1);
  W.invoices.in_none = { id: "in_none", subscription: null, customer: "cus_1" };
  await send(evt("evt_2", "invoice.paid", invoiceObj("dahlia", { id: "in_none", reason: "subscription_cycle" }), "dahlia"));
  assert.equal(failures("renewal_without_subscription").length, 1); assert.equal(rpcs("turn_set_plan_once").length, 1);
});
await test("C3 a renewal from an unknown customer is recorded for Kinolot plans only; non-plan invoices are ignored", async () => {
  world(); stripeSub("sub_k", "prod_writer", { customer: "cus_9" }); stripeSub("sub_x", "prod_academy", { customer: "cus_9" });
  await send(evt("evt_1", "invoice.paid", invoiceObj("dahlia", { id: "in_1", reason: "subscription_cycle", sub: "sub_k", customer: "cus_9" }), "dahlia"));
  await send(evt("evt_2", "invoice.paid", invoiceObj("dahlia", { id: "in_2", reason: "subscription_cycle", sub: "sub_x", customer: "cus_9" }), "dahlia"));
  await send(evt("evt_3", "invoice.paid", invoiceObj("old", { id: "in_3", reason: "manual", customer: "cus_9" })));
  await send(evt("evt_4", "invoice.paid", invoiceObj("old", { id: "in_4", reason: "subscription_threshold", sub: "sub_k", customer: "cus_9" })));
  assert.equal(failures("unknown_customer").length, 1); assert.equal(DB.failures.length, 1); assert.equal(DB.rpcs.length, 0);
  assert.ok(logHas(/IGNORED invoice\.paid event=evt_3 .*billing_reason=manual/) && logHas(/SKIP other_app event=evt_2/));
});
await test("C4 a first invoice whose checkout had no uid is not recorded twice (the checkout event records it)", async () => {
  world(); stripeSub("sub_k", "prod_writer", { customer: "cus_9" }); W.sessions.push(sessionObj({ uid: null, subscription: "sub_k", customer: "cus_9" }));
  await send(evt("evt_1", "invoice.paid", invoiceObj("dahlia", { id: "in_1", reason: "subscription_create", sub: "sub_k", customer: "cus_9" }), "dahlia"));
  assert.equal(DB.failures.length, 0); assert.ok(logHas(/SKIP first_invoice_without_uid/));
});
await test("C5 bad product metadata on a renewal is recorded (invalid_plan_credits), never a zero grant", async () => {
  world(); subscribed(U1, "prod_writer"); W.products.prod_writer.metadata.plan_credits = "0";
  await send(evt("evt_1", "invoice.paid", invoiceObj("old", { id: "in_1", reason: "subscription_cycle", sub: "sub_1" })));
  assert.equal(failures("invalid_plan_credits").length, 1); assert.equal(rpcs("turn_set_plan_once").length, 0);
});
await test("C6 renews is null (never 1970) when the fetched subscription has no period; the dahlia item period is read", async () => {
  world(); subscribed(U1, "prod_writer"); delete W.subs.sub_1.current_period_end; delete W.subs.sub_1.current_period_start;
  await send(evt("evt_1", "invoice.paid", invoiceObj("old", { id: "in_1", reason: "subscription_cycle", sub: "sub_1" })));
  assert.equal(rpcs("turn_set_plan_once")[0].renews, null);
  W.subs.sub_1.items.data[0].current_period_end = T2;
  await send(evt("evt_2", "invoice.paid", invoiceObj("old", { id: "in_2", reason: "subscription_cycle", sub: "sub_1" })));
  assert.equal(rpcs("turn_set_plan_once")[1].renews, iso(T2));
});

/* ════ D. plan changes ═════════════════════════════════════════════════════════════════ */
for (const shape of ["old", "dahlia"]) {
  await test(`D1 [${shape}] upgrade Writer -> Director adds the allowance difference now (1,000), once, sharing its key with the proration invoice`, async () => {
    world(); subscribed(U1, "prod_writer", { remaining: 100 });
    W.subs.sub_1.items.data[0].price = { id: "price_prod_director", product: "prod_director" };
    const upd = evt("evt_u", "customer.subscription.updated", subObj(shape, "sub_1", "prod_director"), shape, { previous_attributes: { items: { data: [{ price: { id: "price_prod_writer", product: "prod_writer" } }] } } });
    assert.equal((await send(upd)).status, 200);
    assert.deepEqual(rpcs("turn_adjust_plan_once"), [{ event_id: `upgrade:sub_1:writer>director:${T0}`, uid: U1, new_tier: "director", add_credits: 1000, sub_id: "sub_1" }]);
    assert.equal(rpcs("turn_set_plan_once").length, 0, "never a reset to the full allowance");
    await send(evt("evt_pr", "invoice.paid", invoiceObj(shape, { id: "in_pr", reason: "subscription_update", sub: "sub_1" }), shape));
    await send(upd);
    const a = DB.accounts.get(U1); assert.equal(a.plan, "director"); assert.equal(a.plan_remaining, 1100); assert.equal(a.adjusts, 1);
    assert.equal(rpcs("turn_set_plan_once").length, 0);
  });
}
await test("D2 the proration invoice arriving FIRST applies the upgrade; the subscription.updated after it is a no-op (same key / same plan)", async () => {
  world(); subscribed(U1, "prod_writer", { remaining: 0 });
  W.subs.sub_1.items.data[0].price = { id: "price_prod_producer", product: "prod_producer" };
  await send(evt("evt_pr", "invoice.paid", invoiceObj("dahlia", { id: "in_pr", reason: "subscription_update", sub: "sub_1" }), "dahlia"));
  await send(evt("evt_u", "customer.subscription.updated", subObj("dahlia", "sub_1", "prod_producer"), "dahlia", { previous_attributes: { items: { data: [{ price: { product: "prod_writer" } }] } } }));
  const a = DB.accounts.get(U1); assert.equal(a.plan, "studio"); assert.equal(a.plan_remaining, 4400); assert.equal(a.adjusts, 1);
});
await test("D3 before the switch (products still in the old units) the difference is in old units: Writer 800 -> Director 2,400 = +1,600", async () => {
  world(); subscribed(U1, "prod_writer_pre", { remaining: 50 });
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_director_pre" };
  await send(evt("evt_u", "customer.subscription.updated", subObj("old", "sub_1", "prod_director_pre"), "old", { previous_attributes: { items: { data: [{ price: { product: "prod_writer_pre" } }] } } }));
  assert.equal(rpcs("turn_adjust_plan_once")[0].add_credits, 1600);
});
await test("D4 downgrade Director -> Writer: nothing now, pending recorded; the renewal applies Writer and clears it", async () => {
  world(); subscribed(U1, "prod_director", { remaining: 900 });
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_writer" };
  await send(evt("evt_d", "customer.subscription.updated", subObj("dahlia", "sub_1", "prod_writer"), "dahlia", { previous_attributes: { items: { data: [{ price: { product: "prod_director" } }] } } }));
  let a = DB.accounts.get(U1);
  assert.equal(rpcs("turn_adjust_plan_once").length, 0); assert.equal(a.plan, "director"); assert.equal(a.plan_remaining, 900); assert.equal(a.pending_tier, "writer");
  assert.ok(logHas(/PLAN_DOWNGRADE_PENDING event=evt_d uid=\S+ from=director to=writer at=/));
  // a proration credit invoice for the downgrade changes nothing either
  await send(evt("evt_pr", "invoice.paid", invoiceObj("dahlia", { id: "in_pr", reason: "subscription_update", sub: "sub_1" }), "dahlia"));
  assert.equal(DB.accounts.get(U1).plan, "director"); assert.equal(rpcs("turn_set_plan_once").length, 0);
  W.subs.sub_1.current_period_start = T1; W.subs.sub_1.current_period_end = T2;
  await send(evt("evt_r", "invoice.paid", invoiceObj("dahlia", { id: "in_r", reason: "subscription_cycle", sub: "sub_1" }), "dahlia"));
  a = DB.accounts.get(U1); assert.equal(a.plan, "writer"); assert.equal(a.plan_remaining, 600); assert.equal(a.pending_tier, null);
});
await test("D5 downgrade then upgrade back inside one period adds NOTHING (no credit farming) and cancels the pending downgrade", async () => {
  world(); subscribed(U1, "prod_director", { remaining: 200 });
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_writer" };
  await send(evt("evt_d", "customer.subscription.updated", subObj("old", "sub_1", "prod_writer"), "old", { previous_attributes: { items: { data: [{ price: { product: "prod_director" } }] } } }));
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_director" };
  await send(evt("evt_u", "customer.subscription.updated", subObj("old", "sub_1", "prod_director"), "old", { previous_attributes: { items: { data: [{ price: { product: "prod_writer" } }] } } }));
  await send(evt("evt_pr", "invoice.paid", invoiceObj("old", { id: "in_pr", reason: "subscription_update", sub: "sub_1" })));
  const a = DB.accounts.get(U1); assert.equal(rpcs("turn_adjust_plan_once").length, 0); assert.equal(a.plan_remaining, 200); assert.equal(a.pending_tier, null);
});
await test("D6 with a downgrade pending, an upgrade to Producer counts from the plan the app HAS (Director 1,600 -> 5,000 = +3,400)", async () => {
  world(); subscribed(U1, "prod_director", { remaining: 0, pending: "writer" });
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_producer" };
  await send(evt("evt_u", "customer.subscription.updated", subObj("old", "sub_1", "prod_producer"), "old", { previous_attributes: { items: { data: [{ price: { product: "prod_writer" } }] } } }));
  assert.equal(rpcs("turn_adjust_plan_once")[0].add_credits, 3400); assert.equal(DB.accounts.get(U1).pending_tier, null);
});
await test("D7 an upgrade whose difference can't be worked out still upgrades the plan, adds 0 and is recorded (upgrade_credits_review)", async () => {
  world(); subscribed(U1, "prod_writer"); W.products.prod_producer.metadata.plan_credits = "7777";
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_producer" };
  await send(evt("evt_u", "customer.subscription.updated", subObj("old", "sub_1", "prod_producer"), "old", { previous_attributes: { items: { data: [{ price: { product: "prod_academy" } }] } } }));
  assert.equal(rpcs("turn_adjust_plan_once")[0].add_credits, 0); assert.equal(DB.accounts.get(U1).plan, "studio"); assert.equal(failures("upgrade_credits_review").length, 1);
});
await test("D8 updates without a price change, unpaid changes, other subscriptions and other brands change nothing", async () => {
  world(); subscribed(U1, "prod_writer"); stripeSub("sub_other", "prod_director"); stripeSub("sub_ac", "prod_academy");
  await send(evt("e1", "customer.subscription.updated", subObj("dahlia", "sub_1", "prod_writer", { cancel: true }), "dahlia", { previous_attributes: { cancel_at_period_end: false } }));
  assert.ok(logHas(/IGNORED customer\.subscription\.updated event=e1 .*changed: cancel_at_period_end/));
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_director" }; W.subs.sub_1.status = "past_due";
  await send(evt("e2", "customer.subscription.updated", subObj("dahlia", "sub_1", "prod_director"), "dahlia", { previous_attributes: { items: {} } }));
  assert.ok(logHas(/PLAN_CHANGE_WAITING event=e2 .*status=past_due/));
  W.subs.sub_1.status = "active"; W.subs.sub_1.pending_update = { expires_at: T1 };
  await send(evt("e3", "customer.subscription.updated", subObj("dahlia", "sub_1", "prod_director"), "dahlia", { previous_attributes: { items: {} } }));
  await send(evt("e4", "customer.subscription.updated", subObj("dahlia", "sub_other", "prod_director"), "dahlia", { previous_attributes: { items: {} } }));
  await send(evt("e5", "customer.subscription.updated", subObj("dahlia", "sub_ac", "prod_academy"), "dahlia", { previous_attributes: { items: {} } }));
  assert.equal(rpcs("turn_adjust_plan_once").length, 0); assert.equal(DB.accounts.get(U1).plan, "writer");
  assert.equal(failures("duplicate_subscription").length, 1); assert.ok(logHas(/SKIP plan_change_other_subscription event=e4/) && logHas(/SKIP other_app event=e5/));
});
await test("D9a an upgrade whose proration invoice is still unpaid waits; that invoice's invoice.paid then applies it", async () => {
  world(); subscribed(U1, "prod_writer", { remaining: 10 });
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_director" }; W.subs.sub_1.latest_invoice = "in_pr";
  W.invoices.in_pr = { id: "in_pr", billing_reason: "subscription_update", status: "open", subscription: "sub_1", customer: "cus_1" };
  await send(evt("evt_u", "customer.subscription.updated", subObj("dahlia", "sub_1", "prod_director"), "dahlia", { previous_attributes: { items: { data: [{ price: { product: "prod_writer" } }] } } }));
  assert.equal(rpcs("turn_adjust_plan_once").length, 0); assert.ok(logHas(/PLAN_CHANGE_WAITING event=evt_u .*proration=in_pr status=open/));
  W.invoices.in_pr.status = "paid";
  await send(evt("evt_pr", "invoice.paid", invoiceObj("dahlia", { id: "in_pr", reason: "subscription_update", sub: "sub_1" }), "dahlia"));
  assert.equal(DB.accounts.get(U1).plan, "director"); assert.equal(DB.accounts.get(U1).plan_remaining, 1010);
  // a paid cycle invoice as the latest one doesn't hold a change back
  world(); subscribed(U1, "prod_writer", { remaining: 10 });
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_director" }; W.subs.sub_1.latest_invoice = "in_c";
  W.invoices.in_c = { id: "in_c", billing_reason: "subscription_cycle", status: "paid", subscription: "sub_1" };
  await send(evt("evt_u", "customer.subscription.updated", subObj("old", "sub_1", "prod_director"), "old", { previous_attributes: { items: {} } }));
  assert.equal(rpcs("turn_adjust_plan_once").length, 1);
});
await test("D9b a Stripe customer stored on TWO accounts changes neither and is recorded (customer_on_several_accounts), with 200", async () => {
  world(); subscribed(U1, "prod_writer", { remaining: 5 }); seedAccount(U2, { plan: "writer", plan_remaining: 7, stripe_customer_id: "cus_1", stripe_sub_id: "sub_1" });
  const r = await send(evt("evt_r", "invoice.paid", invoiceObj("old", { id: "in_r", reason: "subscription_cycle", sub: "sub_1" })));
  assert.equal(r.status, 200); assert.equal(rpcs("turn_set_plan_once").length, 0);
  assert.equal(failures("customer_on_several_accounts").length, 1); assert.deepEqual(failures("customer_on_several_accounts")[0].details.owners.sort(), [U1, U2]);
});
await test("D9 without a pending_tier column the downgrade is still applied at renewal (a warning, never a 500)", async () => {
  world(); DB.hasPendingTier = false; subscribed(U1, "prod_director");
  W.subs.sub_1.items.data[0].price = { id: "p", product: "prod_writer" };
  const r = await send(evt("evt_d", "customer.subscription.updated", subObj("old", "sub_1", "prod_writer"), "old", { previous_attributes: { items: {} } }));
  assert.equal(r.status, 200); assert.ok(logHas(/PENDING_TIER_NOT_STORED/));
  await send(evt("evt_r", "invoice.paid", invoiceObj("old", { id: "in_r", reason: "subscription_cycle", sub: "sub_1" })));
  assert.equal(DB.accounts.get(U1).plan, "writer");
});

/* ════ E. payment status ═══════════════════════════════════════════════════════════════ */
for (const shape of ["old", "dahlia"]) {
  await test(`E1 [${shape}] a failed renewal marks the account past_due (no refill); the paid retry grants and sets active`, async () => {
    world(); subscribed(U1, "prod_director", { remaining: 30 });
    await send(evt("evt_f", "invoice.payment_failed", invoiceObj(shape, { id: "in_r", reason: "subscription_cycle", sub: "sub_1", attempt: 1, next: T1 + 86400 }), shape));
    let a = DB.accounts.get(U1); assert.equal(a.payment_status, "past_due"); assert.equal(a.plan_remaining, 30); assert.equal(rpcs("turn_set_plan_once").length, 0);
    assert.ok(logHas(/PAYMENT_FAILED event=evt_f .*attempt=1/));
    await send(evt("evt_p", "invoice.paid", invoiceObj(shape, { id: "in_r", reason: "subscription_cycle", sub: "sub_1" }), shape));
    a = DB.accounts.get(U1); assert.equal(a.payment_status, "active"); assert.equal(a.plan_remaining, 1600);
  });
}
await test("E2 failed invoices of other brands, unknown customers, other subscriptions and one-off invoices change nothing", async () => {
  world(); subscribed(U1, "prod_writer"); stripeSub("sub_ac", "prod_academy"); stripeSub("sub_2", "prod_writer"); stripeSub("sub_9", "prod_writer", { customer: "cus_9" });
  W.invoices.in_oneoff = { id: "in_oneoff", subscription: null };
  await send(evt("e1", "invoice.payment_failed", invoiceObj("dahlia", { id: "in_a", reason: "subscription_cycle", sub: "sub_ac" }), "dahlia"));
  await send(evt("e2", "invoice.payment_failed", invoiceObj("dahlia", { id: "in_b", reason: "subscription_cycle", sub: "sub_2" }), "dahlia"));
  await send(evt("e3", "invoice.payment_failed", invoiceObj("dahlia", { id: "in_c", reason: "subscription_cycle", sub: "sub_9", customer: "cus_9" }), "dahlia"));
  await send(evt("e4", "invoice.payment_failed", invoiceObj("dahlia", { id: "in_oneoff", reason: "manual" }), "dahlia"));
  assert.equal(DB.rpcs.length, 0); assert.equal(DB.accounts.get(U1).payment_status, "active"); assert.equal(DB.failures.length, 0);
});

/* ════ F. packs ════════════════════════════════════════════════════════════════════════ */
for (const shape of ["old", "dahlia"]) {
  await test(`F1 [${shape}] a pack goes to ANY signed-in account (no plan needed), with its charge id, once per checkout`, async () => {
    world(); W.pis.pi_1 = { id: "pi_1", latest_charge: "ch_pack" }; W.lineItems.cs_p = [{ product: "prod_pack1000", quantity: 2 }];
    const e = evt("evt_p", "checkout.session.completed", sessionObj({ id: "cs_p", mode: "payment", uid: U2, customer: null, payment_intent: "pi_1" }), shape);
    assert.equal((await send(e)).status, 200); await send(e);
    assert.deepEqual(rpcs("turn_add_pack_once")[0], { event_id: "checkout:cs_p", uid: U2, amount: 2000, charge_id: "ch_pack" });
    const a = DB.accounts.get(U2); assert.equal(a.plan, "none"); assert.equal(a.packs.length, 1); assert.equal(a.packs[0].left, 2000);
    assert.equal(rpcs("turn_set_plan_once").length, 0);
  });
}
await test("F2 a delayed-payment pack waits for async_payment_succeeded; a 100% discount (no payment intent) grants with no charge id", async () => {
  world(); W.pis.pi_2 = { id: "pi_2", latest_charge: "ch_2" }; W.lineItems.cs_a = [{ product: "prod_pack250", quantity: 1 }]; W.lineItems.cs_f = [{ product: "prod_pack250", quantity: 1 }];
  await send(evt("e1", "checkout.session.completed", sessionObj({ id: "cs_a", mode: "payment", payment_intent: "pi_2", payment_status: "unpaid" })));
  assert.equal(rpcs("turn_add_pack_once").length, 0); assert.ok(logHas(/CHECKOUT_UNPAID event=e1/));
  await send(evt("e2", "checkout.session.async_payment_succeeded", sessionObj({ id: "cs_a", mode: "payment", payment_intent: "pi_2" })));
  await send(evt("e3", "checkout.session.completed", sessionObj({ id: "cs_f", mode: "payment", payment_status: "no_payment_required" })));
  assert.deepEqual(rpcs("turn_add_pack_once"), [{ event_id: "checkout:cs_a", uid: U1, amount: 250, charge_id: "ch_2" }, { event_id: "checkout:cs_f", uid: U1, amount: 250, charge_id: null }]);
});
await test("F3 packs: no uid / bad uid recorded for Kinolot only, zero credits recorded, other brands skipped, mixed carts grant only ours", async () => {
  world(); W.pis.pi = { id: "pi", latest_charge: "ch" };
  W.lineItems = { cs1: [{ product: "prod_pack250", quantity: 1 }], cs2: [{ product: "prod_course", quantity: 1 }], cs3: [{ product: "prod_pack_nokind", quantity: 1 }],
    cs4: [{ product: "prod_course", quantity: 1 }], cs5: [{ product: "prod_course", quantity: 1 }, { product: "prod_pack250", quantity: 3 }], cs6: [{ product: "prod_pack250", quantity: 1 }] };
  await send(evt("e1", "checkout.session.completed", sessionObj({ id: "cs1", mode: "payment", uid: null, payment_intent: "pi" })));
  await send(evt("e2", "checkout.session.completed", sessionObj({ id: "cs2", mode: "payment", uid: null, payment_intent: "pi" })));
  await send(evt("e3", "checkout.session.completed", sessionObj({ id: "cs3", mode: "payment", payment_intent: "pi" })));
  await send(evt("e4", "checkout.session.completed", sessionObj({ id: "cs4", mode: "payment", payment_intent: "pi" })));
  await send(evt("e5", "checkout.session.completed", sessionObj({ id: "cs5", mode: "payment", payment_intent: "pi" })));
  await send(evt("e6", "checkout.session.completed", sessionObj({ id: "cs6", mode: "payment", uid: "u1", payment_intent: "pi" })));
  assert.equal(failures("missing_client_reference_id").length, 1); assert.equal(failures("pack_zero_credits").length, 1); assert.equal(failures("invalid_client_reference_id").length, 1);
  assert.deepEqual(rpcs("turn_add_pack_once"), [{ event_id: "checkout:cs5", uid: U1, amount: 750, charge_id: "ch" }]);
  assert.ok(logHas(/SKIP other_app event=e4 product=prod_course/));
});

/* ════ G. refunds and disputes ═════════════════════════════════════════════════════════ */
function packBought(uid = U1) {
  W.pis.pi_p = { id: "pi_p", latest_charge: "ch_pack" }; W.lineItems.cs_p = [{ product: "prod_pack1000", quantity: 1 }];
  W.sessions.push(sessionObj({ id: "cs_p", mode: "payment", uid, payment_intent: "pi_p", customer: null }));
  W.charges.ch_pack = { id: "ch_pack", invoice: null, payment_intent: "pi_p", customer: null, amount: 3500, amount_refunded: 0, refunded: false };
  seedAccount(uid, {}).packs.push({ amount: 1000, left: 640, charge: "ch_pack" });
}
function planCharge() {
  subscribed(U1, "prod_director", { remaining: 1200 });
  W.invoices.in_1 = { id: "in_1", subscription: "sub_1", customer: "cus_1" };
  W.charges.ch_plan = { id: "ch_plan", invoice: "in_1", payment_intent: "pi_plan", customer: "cus_1", amount: 4900, amount_refunded: 0, refunded: false };
}
for (const shape of ["old", "dahlia"]) {
  await test(`G1 [${shape}] a FULL pack refund takes back that pack's unspent credits (turn_revoke_charge_once)`, async () => {
    world(); packBought();
    const r = await send(evt("evt_rf", "charge.refunded", chargeObj(shape, { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 3500, invoice: null }), shape));
    assert.equal(r.status, 200);
    assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "evt_rf", charge_id: "ch_pack" }]);
    assert.equal(DB.accounts.get(U1).packs[0].left, 0); assert.ok(logHas(/REFUND_REVOKE event=evt_rf charge=ch_pack kind=pack .*removed=640/));
    assert.equal(W.calls.some(([n]) => n === "charges.retrieve"), shape === "dahlia", "the charge is fetched only when the payload lacks charge.invoice");
  });
}
await test("G2 (D3, 2026-10-01) a PARTIAL refund removes the same share of the pack's credits (rounded up), keyed by the refund; nothing for the owner to do", async () => {
  world(); packBought();
  W.refunds.ch_pack = [{ id: "re_1", object: "refund", amount: 1000, currency: "usd", status: "succeeded", created: T0 + 60, charge: "ch_pack" }];
  assert.equal((await send(evt("evt_rf", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000 }), "dahlia"))).status, 200);
  // $10 of $35 = 0.285714285714 (cut down to 12 decimals) of 1,000 credits = 285.7 -> 286
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "refund:re_1", charge_id: "ch_pack", refund_fraction: 0.285714285714 }]);
  assert.equal(DB.accounts.get(U1).packs[0].left, 640 - 286);
  assert.equal(failures("partial_refund_review").length, 0);
  assert.ok(logHas(/REFUND_REVOKE_PARTIAL event=evt_rf charge=ch_pack refund=re_1 refunded=1000\/3500 fraction=0\.285714285714 kind=pack .*removed=286/));
  // a partial refund whose refunds Stripe can't list (none found): nothing removed, recorded for the owner
  world(); packBought();
  await send(evt("evt_rf2", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000 }), "dahlia"));
  assert.equal(rpcs("turn_revoke_charge_once").length, 0); assert.equal(DB.accounts.get(U1).packs[0].left, 640);
  const f = failures("partial_refund_review"); assert.equal(f.length, 1); assert.equal(f[0].details.amount_refunded, 1000); assert.equal(f[0].uid, U1); assert.equal(f[0].details.why, "no_refund_found");
});
await test("G3 a full refund of a PLAN payment calls revoke; when nothing was linked it is recorded (refund_plan_review)", async () => {
  world(); planCharge();
  await send(evt("evt_rf", "charge.refunded", chargeObj("dahlia", { id: "ch_plan", pi: "pi_plan", customer: "cus_1", amount: 4900, refunded: 4900 }), "dahlia"));
  // a plan grant is found by its idempotency key (turn_set_plan_once was given "invoice:<id>"),
  // not by the charge id (integration, 2026-09-30: billing-v2.sql turn_revoke_charge_once)
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "evt_rf", charge_id: "invoice:in_1" }]);
  const f = failures("refund_plan_review"); assert.equal(f.length, 1); assert.equal(f[0].uid, U1); assert.equal(f[0].details.invoice_id, "in_1");
});
await test("G4 refunds and disputes of another brand's charge (Academy) change nothing", async () => {
  world(); stripeSub("sub_ac", "prod_academy", { customer: "cus_1" }); seedAccount(U1, { stripe_customer_id: "cus_1" });
  W.invoices.in_ac = { id: "in_ac", subscription: "sub_ac", customer: "cus_1" };
  W.charges.ch_ac = { id: "ch_ac", invoice: "in_ac", customer: "cus_1", amount: 9900, amount_refunded: 0, refunded: false };
  W.charges.ch_one = { id: "ch_one", invoice: null, payment_intent: "pi_one", customer: "cus_1", amount: 500 };
  W.sessions.push(sessionObj({ id: "cs_one", mode: "payment", payment_intent: "pi_one" })); W.lineItems.cs_one = [{ product: "prod_course", quantity: 1 }];
  await send(evt("e1", "charge.refunded", chargeObj("dahlia", { id: "ch_ac", customer: "cus_1", amount: 9900, refunded: 9900 }), "dahlia"));
  await send(evt("e2", "charge.refunded", chargeObj("old", { id: "ch_one", pi: "pi_one", amount: 500, refunded: 500 })));
  await send(evt("e3", "charge.dispute.created", { id: "dp_1", object: "dispute", charge: "ch_ac", status: "needs_response", reason: "fraudulent" }, "dahlia"));
  assert.equal(DB.rpcs.length, 0); assert.equal(DB.failures.length, 0); assert.equal(DB.accounts.get(U1).frozen, false);
});
for (const shape of ["old", "dahlia"]) {
  await test(`G5 [${shape}] a dispute on a pack freezes the buyer; won -> unfrozen`, async () => {
    world(); packBought(U2);
    await send(evt("evt_dc", "charge.dispute.created", { id: "dp_1", object: "dispute", charge: "ch_pack", status: "needs_response", reason: "fraudulent" }, shape));
    assert.deepEqual(rpcs("turn_dispute_hold"), [{ uid: U2, dispute_id: "dp_1", open: true, part: "dispute dp_1 (fraudulent) on charge ch_pack" }]);
    assert.equal(rpcs("turn_set_frozen").length, 0, "one locked call, not a read then turn_set_frozen");
    assert.equal(DB.accounts.get(U2).frozen, true);
    await send(evt("evt_dw", "charge.dispute.closed", { id: "dp_1", object: "dispute", charge: "ch_pack", status: "won" }, shape));
    assert.equal(DB.accounts.get(U2).frozen, false);
  });
}
await test("G6 a dispute on a plan payment freezes the subscriber (found by customer); an inquiry closed without escalation unfreezes", async () => {
  world(); planCharge();
  await send(evt("e1", "charge.dispute.created", { id: "dp_2", object: "dispute", charge: "ch_plan", status: "warning_needs_response", reason: "general" }, "dahlia"));
  assert.equal(DB.accounts.get(U1).frozen, true);
  await send(evt("e2", "charge.dispute.closed", { id: "dp_2", object: "dispute", charge: "ch_plan", status: "warning_closed" }, "dahlia"));
  assert.equal(DB.accounts.get(U1).frozen, false);
});
await test("G7 (D4, 2026-10-01) a LOST dispute takes back the purchase's unspent credits, THEN lifts the hold, and is recorded (dispute_lost)", async () => {
  world(); packBought();
  await send(evt("e1", "charge.dispute.created", { id: "dp_3", object: "dispute", charge: "ch_pack", status: "needs_response", reason: "fraudulent" }));
  await send(evt("e2", "charge.dispute.closed", { id: "dp_3", object: "dispute", charge: "ch_pack", status: "lost" }));
  const a = DB.accounts.get(U1); assert.equal(a.frozen, false, "the hold is lifted when the dispute closes, won or lost"); assert.equal(a.packs[0].left, 0);
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "e2", charge_id: "ch_pack" }], "the full revoke, as before (no fraction)");
  const order = DB.rpcs.map(([n, x]) => (n === "turn_dispute_hold" ? `frozen=${x.open}` : n)).filter((n) => n !== "turn_record_sale_once");
  assert.deepEqual(order, ["frozen=true", "turn_revoke_charge_once", "frozen=false"], "credits removed before the hold is lifted");
  const f = failures("dispute_lost"); assert.equal(f.length, 1); assert.equal(f[0].details.hold, "lifted"); assert.match(f[0].details.note, /hold is lifted/);
  assert.equal(a.frozen_reason, "dispute dp_3 lost");
});
await test("G8 a Kinolot dispute whose account can't be found is recorded (dispute_unknown_account)", async () => {
  world(); W.pis.pi_x = { id: "pi_x", latest_charge: "ch_x" }; W.lineItems.cs_x = [{ product: "prod_pack250", quantity: 1 }];
  W.sessions.push(sessionObj({ id: "cs_x", mode: "payment", uid: null, payment_intent: "pi_x" }));
  W.charges.ch_x = { id: "ch_x", invoice: null, payment_intent: "pi_x", customer: null, amount: 1000 };
  await send(evt("e1", "charge.dispute.created", { id: "dp_4", object: "dispute", charge: "ch_x", status: "needs_response", reason: "fraudulent" }));
  assert.equal(failures("dispute_unknown_account").length, 1); assert.equal(rpcs("turn_set_frozen").length + rpcs("turn_dispute_hold").length, 0);
});

/* ════ H. cancellation ═════════════════════════════════════════════════════════════════ */
for (const shape of ["old", "dahlia"]) {
  await test(`H1 [${shape}] deleting the STORED subscription ends the plan (turn_end_plan_for_sub with that sub id)`, async () => {
    world(); subscribed(U1, "prod_director");
    await send(evt("evt_del", "customer.subscription.deleted", subObj(shape, "sub_1", "prod_director", { status: "canceled" }), shape));
    assert.deepEqual(rpcs("turn_end_plan_for_sub"), [{ uid: U1, sub_id: "sub_1" }]); assert.equal(DB.accounts.get(U1).plan, "none");
    assert.ok(logHas(/PLAN_END event=evt_del .*matched/));
  });
}
await test("H2 an Academy subscription on the same customer is skipped; another Kinolot sub leaves the stored plan alone", async () => {
  world(); subscribed(U1, "prod_director"); stripeSub("sub_ac", "prod_academy"); stripeSub("sub_old", "prod_writer");
  await send(evt("e1", "customer.subscription.deleted", subObj("dahlia", "sub_ac", "prod_academy"), "dahlia"));
  assert.equal(rpcs("turn_end_plan_for_sub").length, 0); assert.ok(logHas(/SKIP other_app event=e1/));
  await send(evt("e2", "customer.subscription.deleted", subObj("dahlia", "sub_old", "prod_writer"), "dahlia"));
  assert.deepEqual(rpcs("turn_end_plan_for_sub"), [{ uid: U1, sub_id: "sub_old" }]); assert.equal(DB.accounts.get(U1).plan, "director");
  assert.ok(logHas(/NOT the stored subscription/));
});
await test("H3 a deleted subscription Stripe can no longer return falls back to the payload (the database still matches the sub id)", async () => {
  world(); subscribed(U1, "prod_writer"); delete W.subs.sub_1;
  const r = await send(evt("e1", "customer.subscription.deleted", subObj("dahlia", "sub_1", "prod_writer"), "dahlia"));
  assert.equal(r.status, 200); assert.ok(logHas(/SUB_RETRIEVE_FAILED/)); assert.equal(DB.accounts.get(U1).plan, "none");
});
await test("H4 an unknown customer's cancellation changes nothing", async () => {
  world(); stripeSub("sub_9", "prod_writer", { customer: "cus_9" });
  await send(evt("e1", "customer.subscription.deleted", subObj("old", "sub_9", "prod_writer", { customer: "cus_9" })));
  assert.equal(DB.rpcs.length, 0); assert.ok(logHas(/SKIP subscription_deleted_unknown_customer/));
});

/* ════ I. source rules ═════════════════════════════════════════════════════════════════ */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
await test("I1 only the contract's functions are called — none of the old non-idempotent ones", async () => {
  const called = [...CODE.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 8);
  for (const n of called) assert.ok(CONTRACT[n], `${n} is in the contract`);
  for (const n of Object.keys(CONTRACT)) assert.ok(called.includes(n), `${n} is used`);
  assert.ok(!/turn_set_plan"|turn_apply_pack_once|turn_end_plan"|turn_add_pack"|turn_grant_credits/.test(CODE));
});
await test("I2 the header lists every event the owner must add to the Stripe endpoint, and each one is handled", async () => {
  const events = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "invoice.paid", "invoice.payment_failed",
    "customer.subscription.updated", "customer.subscription.deleted", "charge.refunded", "charge.refund.updated", "charge.dispute.created", "charge.dispute.closed"];
  const header = SRC.slice(0, SRC.indexOf("import Stripe"));
  const list = header.slice(header.indexOf('"Select events"'));
  for (const e of events) {
    assert.ok(new RegExp(`^//\\s+${e.replace(/\./g, "\\.")}\\s*$`, "m").test(list), `header lists ${e}`);
    assert.ok(CODE.includes(`case "${e}":`), `handler has a case for ${e}`);
  }
  assert.ok(/--no-verify-jwt/.test(header) && /stripe@16/.test(SRC));
});
await test("I3 grants are gated on a paid session and keyed by invoice / checkout / upgrade; the dahlia helpers are used", async () => {
  assert.ok(/s\.payment_status === "paid" \|\| s\.payment_status === "no_payment_required"/.test(CODE));
  assert.ok(/planGrantKey\(invoiceId, event\.id\)/.test(CODE) && /planGrantKey\(inv\.id, event\.id\)/.test(CODE) && /packGrantKey\(session\.id, event\.id\)/.test(CODE) && /upgradeKey\(/.test(CODE));
  assert.ok(/subscriptionPeriod\(sub\)/.test(CODE) && !/current_period_end \?\? 0/.test(CODE), "no 1970 renewal date");
  assert.ok(!/inv\.subscription/.test(CODE) && !/ch\.invoice\b(?! === undefined)(?!\))/.test(CODE.replace(/idOf\(ch\.invoice\)/g, "")));
});

/* ════ J. round 2 ════════════════════════════════════════════════════════════════════════ */
const packCheckout = (id, lines, o = {}) => {
  W.pis["pi_" + id] = { id: "pi_" + id, latest_charge: "ch_" + id };
  W.lineItems[id] = lines;
  return evt("evt_" + id, o.type ?? "checkout.session.completed", sessionObj({ id, mode: "payment", uid: o.uid ?? U2, payment_intent: "pi_" + id, customer: null }), o.shape ?? "old");
};
const packsOf = (uid) => DB.accounts.get(uid)?.packs.map((p) => p.amount) ?? [];
await test("J1 an OLD-unit pack (300 / 1,200 / 4,000) granted after the switch counts x3; before the switch as sold; new packs never", async () => {
  // before the switch: as sold (billing-switch.sql triples the lot with every other balance) — the database decides
  world(); DB.switched = false;
  assert.equal((await send(packCheckout("cs_a", [{ product: "prod_old300", quantity: 1 }]))).status, 200);
  assert.deepEqual(packsOf(U2), [300]); assert.ok(logHas(/legacy_pack=300 legacy_unit=true/));
  // round 4 (S6): the log names the amount AS SOLD and the lot the database really granted
  assert.ok(logHas(/PACK_GRANT .*credits_as_sold=300 legacy_pack=300 legacy_unit=true lot_credits=300 x3=false charge=/), LOG.filter((l) => /PACK_GRANT/.test(l)).join("\n"));
  assert.ok(!logHas(/PACK_GRANT .* credits=300/), "no bare credits= for a pack the database decides");
  assert.deepEqual(rpcs("turn_add_pack_once"), [{ event_id: "checkout:cs_a", uid: U2, amount: 300, charge_id: "ch_cs_a", legacy_unit: true }], "the old pack's credits as sold, flagged");
  assert.equal(rpcs("turn_credit_regime").length, 0, "round 3: the webhook no longer reads the regime itself");
  // after the switch: x3 — identified by pack_credits, by app=cinema-machine and by an explicit unit=legacy label
  for (const [prod, sold, want] of [["prod_old300", 300, 900], ["prod_old1200", 1200, 3600], ["prod_old4000", 4000, 12000], ["prod_labelled", 500, 1500]]) {
    world(); DB.switched = true;
    assert.equal((await send(packCheckout("cs_" + prod, [{ product: prod, quantity: 1 }]))).status, 200, prod);
    assert.deepEqual(packsOf(U2), [want], prod);
    assert.deepEqual(rpcs("turn_add_pack_once").map((a) => [a.amount, a.legacy_unit]), [[sold, true]], prod + ": the database triples it, not the webhook");
    assert.ok(logHas(new RegExp(`PACK_GRANT .*credits_as_sold=${sold} legacy_pack=${sold} legacy_unit=true lot_credits=${want} x3=true `)), prod + ": the log says what was granted");
    assert.equal(rpcs("turn_credit_regime").length, 0, prod);
  }
  // the new packs, and a product explicitly labelled with the new unit, are never multiplied (and never flagged)
  world(); DB.switched = true;
  await send(packCheckout("cs_new", [{ product: "prod_pack250", quantity: 2 }, { product: "prod_new300", quantity: 1 }]));
  assert.deepEqual(packsOf(U2), [800]); assert.equal(rpcs("turn_credit_regime").length, 0);
  assert.ok(logHas(/PACK_GRANT .* credits=800 charge=/), "a new pack's log keeps credits= (the amount granted)");
  assert.deepEqual(Object.keys(rpcs("turn_add_pack_once")[0]).sort(), ["amount", "charge_id", "event_id", "uid"], "the four-argument call works on every database");
  // a mixed cart after the switch: only the old pack's part is tripled — the webhook's own x3 (one amount can't carry both); dahlia payload + delayed payment too
  world(); DB.switched = true;
  await send(packCheckout("cs_mix", [{ product: "prod_old300", quantity: 2 }, { product: "prod_pack1000", quantity: 1 }], { type: "checkout.session.async_payment_succeeded", shape: "dahlia" }));
  assert.deepEqual(packsOf(U2), [600 * 3 + 1000]); assert.deepEqual(rpcs("turn_credit_regime"), [{}]); assert.ok(logHas(/legacy_pack=600 x3 \(after the switch\)/));
  assert.equal(rpcs("turn_add_pack_once")[0].legacy_unit, undefined);
  // a replay grants once (same checkout key)
  await send(packCheckout("cs_mix", [{ product: "prod_old300", quantity: 2 }, { product: "prod_pack1000", quantity: 1 }]));
  assert.deepEqual(packsOf(U2), [2800]);
  // a replay of an old pack on the new path grants once too
  world(); DB.switched = true;
  const e = packCheckout("cs_rep", [{ product: "prod_old300", quantity: 1 }]);
  await send(e); await send(e);
  assert.deepEqual(packsOf(U2), [900]);
});
await test("J2 an OLDER database (no legacy_unit argument): the webhook's own x3 from the regime; an unreadable regime is a 500, and the retry grants x3 once", async () => {
  world(); DB.switched = true; DB.packFnNoLegacyArg = true; DB.regimeBroken = true;
  const e = packCheckout("cs_r", [{ product: "prod_old1200", quantity: 1 }]);
  assert.equal((await send(e)).status, 500); assert.deepEqual(packsOf(U2), []);
  DB.regimeBroken = false;
  assert.equal((await send(e)).status, 200); assert.deepEqual(packsOf(U2), [3600]);
  const calls = rpcs("turn_add_pack_once");
  assert.deepEqual(calls.map((a) => [a.amount, a.legacy_unit]), [[1200, true], [1200, true], [3600, undefined]], "tried with the argument, then the four-argument call with its own x3");
  assert.ok(logHas(/PACK_GRANT_LEGACY_FALLBACK/) && logHas(/legacy_pack=1200 x3 \(after the switch\)/));
  // before the switch on the older database: as sold
  world(); DB.switched = false; DB.packFnNoLegacyArg = true;
  await send(packCheckout("cs_r2", [{ product: "prod_old300", quantity: 1 }]));
  assert.deepEqual(packsOf(U2), [300]); assert.ok(logHas(/legacy_pack=300 \(before the switch/));
  // Postgres's own "function does not exist" (42883) falls back too
  world(); DB.switched = true; DB.packFnNoLegacyArg = { code: "42883", message: "function public.turn_add_pack_once(event_id => text, uid => uuid, amount => integer, charge_id => text, legacy_unit => boolean) does not exist" };
  assert.equal((await send(packCheckout("cs_r3", [{ product: "prod_old300", quantity: 1 }]))).status, 200); assert.deepEqual(packsOf(U2), [900]);
});
await test("J6 (round 3, S6) the switch committing WHILE an old pack is granted: the database's own check triples it — never 300 new-unit credits for a 300 pack", async () => {
  // the switch lands between the webhook starting and the lot insert (here: while it looks up the charge)
  world(); DB.switched = false; W.onPaymentIntent = () => { DB.switched = true; };
  assert.equal((await send(packCheckout("cs_race", [{ product: "prod_old300", quantity: 1 }]))).status, 200);
  assert.deepEqual(packsOf(U2), [900], "decided at the insert, after the switch committed");
  // any OTHER error on the call with the argument is a 500 (Stripe retries) — no fallback, nothing granted twice
  world(); DB.switched = true; DB.legacyArgError = { code: "57014", message: "canceling statement due to statement timeout" };
  const e = packCheckout("cs_err", [{ product: "prod_old300", quantity: 1 }]);
  assert.equal((await send(e)).status, 500); assert.deepEqual(packsOf(U2), []);
  assert.deepEqual(rpcs("turn_add_pack_once").map((a) => a.legacy_unit), [true], "no four-argument retry"); assert.equal(rpcs("turn_credit_regime").length, 0);
  DB.legacyArgError = null;
  assert.equal((await send(e)).status, 200); assert.deepEqual(packsOf(U2), [900]);
  // a code-less error only falls back when its words say the function doesn't exist
  world(); DB.switched = true; DB.legacyArgError = { message: "connection reset by peer" };
  assert.equal((await send(packCheckout("cs_err2", [{ product: "prod_old300", quantity: 1 }]))).status, 500);
  // round 4 (S6): an event result the webhook can't read back leaves the grant alone and says so in the log
  world(); DB.switched = true; DB.failResultRead = true;
  assert.equal((await send(packCheckout("cs_nores", [{ product: "prod_old300", quantity: 1 }]))).status, 200);
  assert.deepEqual(packsOf(U2), [900]);
  assert.ok(logHas(/PACK_RESULT_UNREADABLE event=\S+ key=checkout:cs_nores/) && logHas(/credits_as_sold=300 legacy_pack=300 legacy_unit=true lot_credits=unknown \(the database triples it after the switch\)/));
});
await test("J3 a plan grant the database REFUSED (another customer's subscription) leaves the payment status alone; an applied one sets active", async () => {
  // the victim is past due on their own subscription; someone pays a Writer plan with their uid from another customer
  world(); subscribed(U1, "prod_producer", { customer: "cus_V" }); DB.accounts.get(U1).payment_status = "past_due"; DB.conflictUids.add(U1);
  stripeSub("sub_X", "prod_writer", { customer: "cus_X" });
  const r = await send(evt("e_x", "checkout.session.completed", sessionObj({ id: "cs_x", subscription: "sub_X", customer: "cus_X", invoice: "in_x" })));
  assert.equal(r.status, 200);
  assert.equal(rpcs("turn_set_payment_status").length, 0, "no 'active' after a refused grant");
  assert.equal(DB.accounts.get(U1).payment_status, "past_due"); assert.ok(logHas(/PLAN_GRANT_REFUSED .*skipped=subscription_conflict/));
  // the same key again (invoice.paid for that invoice): still refused, still no status change
  await send(evt("e_x2", "invoice.paid", invoiceObj("dahlia", { id: "in_x", reason: "subscription_create", sub: "sub_X", customer: "cus_X" }), "dahlia"));
  assert.equal(rpcs("turn_set_payment_status").length, 0);
  // an applied grant sets active as before
  world(); subscribed(U1, "prod_writer", { remaining: 5 }); DB.accounts.get(U1).payment_status = "past_due";
  await send(evt("e_ok", "invoice.paid", invoiceObj("old", { id: "in_ok", reason: "subscription_cycle", sub: "sub_1" })));
  assert.deepEqual(rpcs("turn_set_payment_status"), [{ uid: U1, status: "active" }]);
  // a result the webhook can't read: logged, and the status update stands (the previous behaviour)
  world(); subscribed(U1, "prod_writer", { remaining: 5 }); DB.failResultRead = true;
  await send(evt("e_ur", "invoice.paid", invoiceObj("old", { id: "in_ur", reason: "subscription_cycle", sub: "sub_1" })));
  assert.equal(rpcs("turn_set_payment_status").length, 1); assert.ok(logHas(/GRANT_RESULT_UNREADABLE/));
});
await test("J4 a proration invoice whose plan change the database refused (subscription_mismatch) leaves the payment status alone", async () => {
  world(); subscribed(U1, "prod_writer"); DB.mismatchUids.add(U1);
  W.subs.sub_1.items.data[0].price = { id: "price_prod_director", product: "prod_director" };
  await send(evt("e_up", "invoice.paid", invoiceObj("old", { id: "in_up", reason: "subscription_update", sub: "sub_1" })));
  assert.equal(rpcs("turn_adjust_plan_once").length, 1); assert.equal(rpcs("turn_set_payment_status").length, 0);
  assert.ok(logHas(/PLAN_UPGRADE_REFUSED .*skipped=subscription_mismatch/) && logHas(/PAYMENT_STATUS_UNCHANGED/));
  DB.mismatchUids.clear();
  world(); subscribed(U1, "prod_writer");
  W.subs.sub_1.items.data[0].price = { id: "price_prod_director", product: "prod_director" };
  await send(evt("e_up2", "invoice.paid", invoiceObj("old", { id: "in_up2", reason: "subscription_update", sub: "sub_1" })));
  assert.deepEqual(rpcs("turn_set_payment_status"), [{ uid: U1, status: "active" }]);
});
await test("J5 wording: upgrades are PRORATED; a different customer's duplicate subscription is refused by the database (not 'honoured')", async () => {
  const header = SRC.slice(0, SRC.indexOf("import Stripe"));
  assert.match(header, /upgrade -> turn_adjust_plan_once[\s\S]{0,200}PRORATED/);
  assert.doesNotMatch(header, /allowance difference, now;/);
  const dup = SRC.slice(SRC.indexOf("/** A second Kinolot subscription"), SRC.indexOf("async function reportIfDuplicate"));
  assert.doesNotMatch(dup, /The paid plan is still\s+\*?\s*honoured/);
  assert.match(dup, /DIFFERENT\s+\*?\s*customer[\s\S]*REFUSES it/);
  assert.match(SRC, /upgrade\s+-> turn_adjust_plan_once\(new plan, new allowance − old allowance\) now, which the\s+\*\s+database PRORATES/);
});

/* ════ K. owner decisions 2026-10-01: sales ledger (D1), partial refunds (D3), disputes (D4) ═════ */
const sale = (key) => DB.sales.get(key);
const paidInvoice = (shape, o) => evt(o.evt ?? "evt_" + o.id, "invoice.paid", invoiceObj(shape, o), shape);
for (const shape of ["old", "dahlia"]) {
  await test(`K1 [${shape}] a paid renewal is recorded ONCE in the sales ledger (invoice:<id>, kinolot, plan, the owner, amount paid, country + where it came from, the paid time); credits as before`, async () => {
    world(); subscribed(U1, "prod_director", { remaining: 40 });
    const e = paidInvoice(shape, { evt: "evt_r", id: "in_r", reason: "subscription_cycle", sub: "sub_1", amount: 4900, address: { country: "gb", postal_code: "N1 1AA" }, paidAt: T1 });
    assert.equal((await send(e)).status, 200);
    await send(e); await send({ ...e, id: "evt_r2" });
    assert.equal(rpcs("turn_record_sale_once").length, 3, "asked every time…");
    assert.equal(DB.sales.size, 1, "…recorded once");
    assert.deepEqual(sale("invoice:in_r"), { source_key: "invoice:in_r", app: "kinolot", owner: U1, kind: "plan", amount_cents: 4900, currency: "usd", country: "GB", region: null,
      country_source: "invoice_address", occurred_at: iso(T1), stripe_ids: { event: "evt_r", invoice: "in_r", subscription: "sub_1", customer: "cus_1" } });
    assert.equal(DB.accounts.get(U1).plan_remaining, 1600); assert.equal(DB.accounts.get(U1).grants, 1);
    assert.ok(logHas(/SALE_RECORDED event=evt_r key=invoice:in_r app=kinolot kind=plan amount=4900 usd country=GB source=invoice_address/));
    assert.ok(logHas(/SALE_ALREADY_RECORDED event=evt_r2 key=invoice:in_r/));
    assert.ok(!W.calls.some(([n]) => n === "customers.retrieve" || n === "charges.retrieve"), "no lookup once the invoice gave the country");
    assert.equal(W.calls.filter(([n]) => n === "subscriptions.retrieve").length, 3, "the subscription is fetched once per event (credit work and ledger share it)");
  });
}
await test("K2 other apps' payments are recorded too (app=other, no owner) and never touch credits; a one-off invoice is Kinolot's only when its product says so; $0 is not a sale", async () => {
  // the Academy subscriber is also a Kinolot account (same Stripe customer): the other app's row still has no owner
  world(); stripeSub("sub_ac", "prod_academy", { customer: "cus_1" }); seedAccount(U1, { stripe_customer_id: "cus_1" });
  assert.equal((await send(paidInvoice("dahlia", { id: "in_ac", reason: "subscription_cycle", sub: "sub_ac", customer: "cus_1", amount: 9900, address: { country: "FR" } }))).status, 200);
  await send(paidInvoice("old", { id: "in_man", reason: "manual", customer: "cus_9", amount: 15000, currency: "GBP", address: { country: "GB" }, lines: ["prod_course"] }));
  await send(paidInvoice("dahlia", { id: "in_pk", reason: "manual", customer: "cus_9", amount: 1000, address: { country: "DE" }, lines: ["prod_pack250"] }));
  await send(paidInvoice("old", { id: "in_zero", reason: "subscription_cycle", sub: "sub_ac", customer: "cus_9", amount: 0, address: { country: "FR" } }));
  assert.equal(creditRpcs().length, 0, "no credit call for any of them"); assert.equal(DB.failures.length, 0);
  assert.deepEqual([sale("invoice:in_ac").app, sale("invoice:in_ac").kind, sale("invoice:in_ac").owner, sale("invoice:in_ac").country], ["other", "other", null, "FR"]);
  assert.deepEqual([sale("invoice:in_man").app, sale("invoice:in_man").kind, sale("invoice:in_man").currency, sale("invoice:in_man").amount_cents], ["other", "other", "gbp", 15000]);
  assert.deepEqual([sale("invoice:in_pk").app, sale("invoice:in_pk").kind, sale("invoice:in_pk").owner], ["kinolot", "pack", null], "a Kinolot product on a one-off invoice (read in the basil line shape)");
  assert.equal(DB.sales.has("invoice:in_zero"), false); assert.ok(logHas(/SALE_SKIPPED event=evt_in_zero invoice=in_zero amount_paid=0 \(nothing paid\)/));
  assert.ok(logHas(/SKIP other_app event=evt_in_ac/), "the credit work still skips the other app");
});
await test("K3 the customer's country falls back in order: the Stripe customer's address (a US state by name) -> the charge's billing address -> the card's country; none -> unknown", async () => {
  world(); subscribed(U1, "prod_writer");
  W.customers.cus_1 = { id: "cus_1", object: "customer", address: { country: "US", state: "California" } };
  await send(paidInvoice("old", { id: "in_1", reason: "subscription_cycle", sub: "sub_1", amount: 1900 }));
  assert.deepEqual([sale("invoice:in_1").country, sale("invoice:in_1").region, sale("invoice:in_1").country_source], ["US", "CA", "customer_address"]);
  // the billing address when the customer has none (an old payload names the charge)
  W.customers.cus_1 = { id: "cus_1", object: "customer", address: null };
  W.charges.ch_2 = { id: "ch_2", billing_details: { address: { country: "DE" } }, payment_method_details: { card: { country: "FR" } } };
  await send(paidInvoice("old", { id: "in_2", reason: "subscription_cycle", sub: "sub_1", amount: 1900, charge: "ch_2" }));
  assert.deepEqual([sale("invoice:in_2").country, sale("invoice:in_2").country_source], ["DE", "billing_address"]);
  assert.deepEqual(sale("invoice:in_2").stripe_ids.charge, "ch_2");
  // dahlia: no charge field -> the API copy of the invoice names it; the card's country when there is no billing address
  W.invoices.in_3 = { id: "in_3", subscription: "sub_1", customer: "cus_1", charge: "ch_3" };
  W.charges.ch_3 = { id: "ch_3", billing_details: { address: null }, payment_method_details: { card: { country: "ie" } } };
  await send(paidInvoice("dahlia", { id: "in_3", reason: "subscription_cycle", sub: "sub_1", amount: 1900 }));
  assert.deepEqual([sale("invoice:in_3").country, sale("invoice:in_3").region, sale("invoice:in_3").country_source], ["IE", null, "card_country"]);
  // nothing anywhere (and a customer Stripe can't return): unknown country, logged — still recorded, still 200
  delete W.customers.cus_1;
  assert.equal((await send(paidInvoice("old", { id: "in_4", reason: "subscription_cycle", sub: "sub_1", amount: 1900 }))).status, 200);
  assert.deepEqual([sale("invoice:in_4").country, sale("invoice:in_4").country_source], [null, null]);
  assert.ok(logHas(/SALE_COUNTRY_LOOKUP_FAILED event=evt_in_4: No such customer/));
  // a US invoice address without a state takes the state from the next US address; a deleted customer has none
  W.customers.cus_1 = { id: "cus_1", object: "customer", address: { country: "US", state: "ny" } };
  await send(paidInvoice("dahlia", { id: "in_5", reason: "subscription_cycle", sub: "sub_1", amount: 1900, address: { country: "US", postal_code: "10001" } }));
  assert.deepEqual([sale("invoice:in_5").country, sale("invoice:in_5").region, sale("invoice:in_5").country_source], ["US", "NY", "invoice_address"]);
  W.customers.cus_1 = { id: "cus_1", object: "customer", deleted: true };
  await send(paidInvoice("old", { id: "in_6", reason: "subscription_cycle", sub: "sub_1", amount: 1900 }));
  assert.equal(sale("invoice:in_6").country, null);
});
for (const shape of ["old", "dahlia"]) {
  await test(`K4 [${shape}] a paid pack checkout is recorded once (checkout:<id>, kinolot, pack, the buyer, amount_total, Checkout's address); a delayed payment only once paid`, async () => {
    world(); W.pis.pi_1 = { id: "pi_1", latest_charge: "ch_1" }; W.lineItems.cs_p = [{ product: "prod_pack1000", quantity: 1 }];
    const base = { id: "cs_p", mode: "payment", uid: U2, customer: null, payment_intent: "pi_1", amount: 3500, address: { country: "ES" } };
    await send(evt("e0", "checkout.session.completed", sessionObj({ ...base, payment_status: "unpaid" }), shape));
    assert.equal(DB.sales.size, 0); assert.ok(logHas(/SALE_SKIPPED event=e0 session=cs_p payment_status=unpaid/));
    const paid = evt("e1", "checkout.session.async_payment_succeeded", sessionObj(base), shape);
    await send(paid); await send(paid);
    assert.equal(DB.sales.size, 1);
    assert.deepEqual(sale("checkout:cs_p"), { source_key: "checkout:cs_p", app: "kinolot", owner: U2, kind: "pack", amount_cents: 3500, currency: "usd", country: "ES", region: null,
      country_source: "checkout_address", occurred_at: iso(TEV), stripe_ids: { event: "e1", session: "cs_p", payment_intent: "pi_1" } });
    assert.deepEqual(packsOf(U2), [1000], "the pack itself is granted once, as before");
    assert.equal(W.calls.filter(([n]) => n === "sessions.listLineItems").length, 2, "line items fetched once per event (shared with the grant)");
  });
}
await test("K4b subscription checkouts are left to their invoice; a checkout that made an invoice shares its key (no double count); other apps' checkouts are app=other with no owner; $0 skipped", async () => {
  world(); stripeSub("sub_new", "prod_writer", { customer: "cus_new" });
  await send(evt("e1", "checkout.session.completed", { ...sessionObj({ subscription: "sub_new", invoice: "in_first", customer: "cus_new", amount: 1900 }), mode: "subscription" }));
  assert.equal(rpcs("turn_record_sale_once").length, 0, "the subscription's first invoice.paid records it");
  await send(paidInvoice("dahlia", { id: "in_first", reason: "subscription_create", sub: "sub_new", customer: "cus_new", amount: 1900, address: { country: "CA" } }));
  assert.equal(DB.sales.size, 1); assert.equal(sale("invoice:in_first").owner, U1); assert.equal(sale("invoice:in_first").kind, "plan");
  // a one-off checkout with invoice creation: key invoice:<id>, so its invoice.paid finds it recorded
  world(); W.pis.pi_i = { id: "pi_i", latest_charge: "ch_i" }; W.lineItems.cs_i = [{ product: "prod_pack250", quantity: 1 }];
  await send(evt("e2", "checkout.session.completed", sessionObj({ id: "cs_i", mode: "payment", invoice: "in_cs", payment_intent: "pi_i", amount: 1000, address: { country: "AU" } })));
  await send(paidInvoice("old", { id: "in_cs", reason: "manual", amount: 1000, address: { country: "AU" }, lines: ["prod_pack250"] }));
  assert.equal(DB.sales.size, 1); assert.equal(sale("invoice:in_cs").kind, "pack"); assert.ok(logHas(/SALE_ALREADY_RECORDED event=evt_in_cs key=invoice:in_cs/));
  // another app's one-off checkout, even with a uuid as its reference: other, no owner, no credits
  world(); W.pis.pi_c = { id: "pi_c", latest_charge: "ch_c" }; W.lineItems.cs_c = [{ product: "prod_course", quantity: 1 }];
  await send(evt("e3", "checkout.session.completed", sessionObj({ id: "cs_c", mode: "payment", uid: U2, payment_intent: "pi_c", amount: 29900, currency: "eur", address: { country: "IT" } })));
  assert.deepEqual([sale("checkout:cs_c").app, sale("checkout:cs_c").kind, sale("checkout:cs_c").owner, sale("checkout:cs_c").currency], ["other", "other", null, "eur"]);
  assert.equal(creditRpcs().length, 0);
  // a 100% coupon: no money, no sale
  world(); W.lineItems.cs_f = [{ product: "prod_pack250", quantity: 1 }];
  await send(evt("e4", "checkout.session.completed", sessionObj({ id: "cs_f", mode: "payment", payment_status: "no_payment_required", amount: 0 })));
  assert.equal(DB.sales.size, 0); assert.deepEqual(packsOf(U1), [250], "the pack is still granted");
});
await test("K5 refunds are NEGATIVE ledger rows, one per SUCCEEDED refund (refund:<id>), in the same country as the payment; failed and pending refunds aren't (a pending one once it succeeds); other apps' are recorded too", async () => {
  world(); packBought(); W.sessions[0].customer_details = { address: { country: "NL" } };
  W.refunds.ch_pack = [
    { id: "re_a", object: "refund", amount: 1000, currency: "usd", status: "succeeded", created: T0 + 100 },
    { id: "re_b", object: "refund", amount: 500, currency: "usd", status: "failed", created: T0 + 200 },
  ];
  const e = evt("evt_rf", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000, billing: { country: "BE" } }), "dahlia");
  await send(e); await send(e);
  assert.equal(DB.sales.size, 1);
  assert.deepEqual(sale("refund:re_a"), { source_key: "refund:re_a", app: "kinolot", owner: U1, kind: "refund", amount_cents: -1000, currency: "usd", country: "NL", region: null,
    country_source: "checkout_address", occurred_at: iso(T0 + 100), stripe_ids: { event: "evt_rf", refund: "re_a", charge: "ch_pack", session: "cs_p" } });
  W.refunds.ch_pack.push({ id: "re_c", object: "refund", amount: 500, currency: "usd", status: "pending", created: T0 + 300, charge: "ch_pack" });
  await send(evt("evt_rf2", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1500 }), "dahlia"));
  assert.deepEqual([...DB.sales.keys()].sort(), ["refund:re_a"], "a pending refund may still fail: not recorded yet");
  W.refunds.ch_pack[2].status = "succeeded"; Object.assign(W.charges.ch_pack, { amount_refunded: 1500 });
  assert.equal((await send(evt("evt_ru", "charge.refund.updated", { ...W.refunds.ch_pack[2] }, "dahlia"))).status, 200);
  assert.deepEqual([...DB.sales.keys()].sort(), ["refund:re_a", "refund:re_c"]); assert.equal(sale("refund:re_c").amount_cents, -500);
  assert.equal(sale("refund:re_c").country, "NL", "…in the payment's country");
  // a plan payment's refund: the country from the invoice, as its sale had it
  world(); planCharge(); W.invoices.in_1.customer_address = { country: "US", state: "TX" };
  W.refunds.ch_plan = [{ id: "re_p", object: "refund", amount: 4900, currency: "usd", status: "succeeded", created: T0 + 50 }];
  await send(evt("evt_pf", "charge.refunded", chargeObj("dahlia", { id: "ch_plan", pi: "pi_plan", customer: "cus_1", amount: 4900, refunded: 4900 }), "dahlia"));
  assert.deepEqual([sale("refund:re_p").country, sale("refund:re_p").region, sale("refund:re_p").country_source, sale("refund:re_p").owner, sale("refund:re_p").stripe_ids.invoice], ["US", "TX", "invoice_address", U1, "in_1"]);
  assert.equal(W.calls.filter(([n]) => n === "invoices.retrieve").length, 1, "the charge is described once per event (credit work and ledger share it)");
  // another app's refund: recorded (app=other), credits untouched
  world(); stripeSub("sub_ac", "prod_academy", { customer: "cus_1" }); seedAccount(U1, { stripe_customer_id: "cus_1" });
  W.invoices.in_ac = { id: "in_ac", subscription: "sub_ac", customer: "cus_1", customer_address: { country: "GB" } };
  W.charges.ch_ac = { id: "ch_ac", invoice: "in_ac", customer: "cus_1", amount: 9900, amount_refunded: 9900, refunded: true };
  W.refunds.ch_ac = [{ id: "re_ac", object: "refund", amount: 9900, currency: "usd", status: "succeeded", created: T0 }];
  await send(evt("e1", "charge.refunded", chargeObj("dahlia", { id: "ch_ac", customer: "cus_1", amount: 9900, refunded: 9900 }), "dahlia"));
  assert.deepEqual([sale("refund:re_ac").app, sale("refund:re_ac").owner, sale("refund:re_ac").country, sale("refund:re_ac").amount_cents], ["other", null, "GB", -9900]);
  assert.equal(creditRpcs().length, 0); assert.ok(logHas(/SKIP refund_not_kinolot event=e1/));
});
for (const shape of ["old", "dahlia"]) {
  await test(`K6 [${shape}] D3: each partial refund removes its own share ONCE (keyed by the refund); the refund that makes it whole takes the rest (the full revoke, as before)`, async () => {
    world(); packBought();   // 1,000 credits, 640 unused, $35
    W.refunds.ch_pack = [{ id: "re_1", object: "refund", amount: 1000, currency: "usd", status: "succeeded", created: T0 + 1 }];
    const e1 = evt("e1", "charge.refunded", chargeObj(shape, { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000 }), shape);
    await send(e1); await send(e1);
    assert.equal(DB.accounts.get(U1).packs[0].left, 354, "640 - ceil(1000 x 10/35) = 640 - 286, once");
    W.refunds.ch_pack.push({ id: "re_2", object: "refund", amount: 500, currency: "usd", status: "pending", created: T0 + 2, charge: "ch_pack" });
    await send(evt("e2", "charge.refunded", chargeObj(shape, { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1500 }), shape));
    assert.equal(DB.accounts.get(U1).packs[0].left, 354, "re_2 is still PENDING (it may fail): nothing removed for it yet");
    W.refunds.ch_pack[1].status = "succeeded"; Object.assign(W.charges.ch_pack, { amount_refunded: 1500 });
    await send(evt("e2u", "charge.refund.updated", { ...W.refunds.ch_pack[1] }, shape));
    assert.equal(DB.accounts.get(U1).packs[0].left, 211, "re_1 already applied; re_2, now succeeded, removes ceil(1000 x 5/35) = 143");
    assert.deepEqual(rpcs("turn_revoke_charge_once"), [
      { event_id: "refund:re_1", charge_id: "ch_pack", refund_fraction: 0.285714285714 },
      { event_id: "refund:re_1", charge_id: "ch_pack", refund_fraction: 0.285714285714 },
      { event_id: "refund:re_1", charge_id: "ch_pack", refund_fraction: 0.285714285714 },
      { event_id: "refund:re_1", charge_id: "ch_pack", refund_fraction: 0.285714285714 },
      { event_id: "refund:re_2", charge_id: "ch_pack", refund_fraction: 0.142857142857 },
    ]);
    W.refunds.ch_pack.push({ id: "re_3", object: "refund", amount: 2000, currency: "usd", status: "succeeded", created: T0 + 3 });
    await send(evt("e3", "charge.refunded", chargeObj(shape, { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 3500 }), shape));
    assert.deepEqual(rpcs("turn_revoke_charge_once").at(-1), { event_id: "e3", charge_id: "ch_pack" }, "a full refund is unchanged: event id, no fraction");
    assert.equal(DB.accounts.get(U1).packs[0].left, 0);
    assert.equal(failures("partial_refund_review").length, 0);
  });
}
await test("K6b D3: a share bigger than what's unused removes only what's unused; a plan payment's partial refund removes that share of its PLAN grant; nothing back from a plan -> refund_plan_review", async () => {
  world(); packBought(); DB.accounts.get(U1).packs[0].left = 100;
  W.refunds.ch_pack = [{ id: "re_h", object: "refund", amount: 1750, currency: "usd", status: "succeeded", created: T0 }];
  await send(evt("e1", "charge.refunded", chargeObj("old", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1750 })));
  assert.equal(DB.accounts.get(U1).packs[0].left, 0); assert.ok(logHas(/REFUND_REVOKE_PARTIAL event=e1 .*fraction=0\.5 kind=pack .*removed=100 /));
  // a plan granted by turn_set_plan_once (key invoice:in_1, 1,600): refunding half the $49 removes 800 of the plan credits
  world(); planCharge();
  await send(paidInvoice("old", { id: "in_1", reason: "subscription_create", sub: "sub_1" }));
  DB.accounts.get(U1).plan_remaining = 1000;
  W.refunds.ch_plan = [{ id: "re_pl", object: "refund", amount: 2450, currency: "usd", status: "succeeded", created: T0 }];
  await send(evt("e2", "charge.refunded", chargeObj("dahlia", { id: "ch_plan", pi: "pi_plan", customer: "cus_1", amount: 4900, refunded: 2450 }), "dahlia"));
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "refund:re_pl", charge_id: "invoice:in_1", refund_fraction: 0.5 }]);
  assert.equal(DB.accounts.get(U1).plan_remaining, 200); assert.equal(failures("refund_plan_review").length, 0);
  // a plan payment nothing is linked to: recorded for the owner, as a full refund would be
  world(); planCharge();
  W.refunds.ch_plan = [{ id: "re_x", object: "refund", amount: 1000, currency: "usd", status: "succeeded", created: T0 }];
  await send(evt("e3", "charge.refunded", chargeObj("dahlia", { id: "ch_plan", pi: "pi_plan", customer: "cus_1", amount: 4900, refunded: 1000 }), "dahlia"));
  const f = failures("refund_plan_review"); assert.equal(f.length, 1); assert.equal(f[0].details.partial, true); assert.equal(f[0].details.refunds[0].refund_id, "re_x");
});
await test("K7 D3 on a database WITHOUT refund_fraction (PGRST202 / 42883): nothing removed, recorded for the owner — never the two-argument call; any other error is a 500 and the retry applies once", async () => {
  for (const missing of [true, { code: "42883", message: "function public.turn_revoke_charge_once(event_id => text, charge_id => text, refund_fraction => numeric) does not exist" }]) {
    world(); packBought(); DB.revokeNoFraction = missing;
    W.refunds.ch_pack = [{ id: "re_1", object: "refund", amount: 1000, currency: "usd", status: "succeeded", created: T0 }];
    assert.equal((await send(evt("e1", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000 }), "dahlia"))).status, 200);
    assert.equal(DB.accounts.get(U1).packs[0].left, 640, "nothing removed");
    assert.deepEqual(rpcs("turn_revoke_charge_once").map((a) => Object.keys(a).sort().join()), ["charge_id,event_id,refund_fraction"], "no two-argument call (it would take ALL the unused credits)");
    const f = failures("partial_refund_review"); assert.equal(f.length, 1); assert.equal(f[0].details.why, "database_without_refund_fraction"); assert.equal(f[0].details.refund_fraction, 0.285714285714);
    assert.ok(logHas(/REFUND_PARTIAL_FALLBACK event=e1 charge=ch_pack/));
  }
  world(); packBought(); DB.revokeError = { code: "57014", message: "canceling statement due to statement timeout" };
  W.refunds.ch_pack = [{ id: "re_1", object: "refund", amount: 1000, currency: "usd", status: "succeeded", created: T0 }];
  const e = evt("e2", "charge.refunded", chargeObj("old", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000 }));
  assert.equal((await send(e)).status, 500); assert.equal(DB.accounts.get(U1).packs[0].left, 640); assert.equal(failures("partial_refund_review").length, 0);
  DB.revokeError = null;
  assert.equal((await send(e)).status, 200); assert.equal((await send(e)).status, 200);
  assert.equal(DB.accounts.get(U1).packs[0].left, 354);
});
await test("K8 a database WITHOUT the sales ledger (PGRST202 / 42883) logs SALES_LEDGER_MISSING and the event still succeeds — credits as before; a refund asks once, not per refund", async () => {
  world(); subscribed(U1, "prod_writer", { remaining: 5 }); DB.salesMissing = true;
  assert.equal((await send(paidInvoice("old", { id: "in_1", reason: "subscription_cycle", sub: "sub_1", amount: 1900, address: { country: "GB" } }))).status, 200);
  assert.equal(DB.accounts.get(U1).plan_remaining, 600); assert.equal(DB.sales.size, 0);
  assert.ok(logHas(/SALES_LEDGER_MISSING event=evt_in_1 key=invoice:in_1 .*run supabase\/tax-compliance\.sql/));
  world(); packBought(); DB.salesMissing = { code: "42883", message: "function public.turn_record_sale_once(text, text) does not exist" };
  W.refunds.ch_pack = [{ id: "re_1", amount: 2000, status: "succeeded", created: T0 }, { id: "re_2", amount: 1500, status: "succeeded", created: T0 + 1 }];
  assert.equal((await send(evt("e1", "charge.refunded", chargeObj("old", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 3500 })))).status, 200);
  assert.equal(rpcs("turn_record_sale_once").length, 1); assert.equal(DB.accounts.get(U1).packs[0].left, 0, "the refund's credit work still ran");
});
await test("K8b any OTHER ledger error answers 500 AFTER the credit work (Stripe retries); the retry grants once and records once", async () => {
  world(); subscribed(U1, "prod_writer", { remaining: 5 }); DB.salesError = { code: "57014", message: "canceling statement due to statement timeout" };
  const e = paidInvoice("dahlia", { id: "in_1", reason: "subscription_cycle", sub: "sub_1", amount: 1900, address: { country: "GB" } });
  assert.equal((await send(e)).status, 500);
  assert.equal(DB.accounts.get(U1).plan_remaining, 600, "the grant ran before the ledger");
  assert.ok(logHas(/SALES_LEDGER_ERROR event=evt_in_1 key=invoice:in_1/) && logHas(/SALES_LEDGER_FAILED event=evt_in_1/) && logHas(/handler error event=evt_in_1/));
  assert.equal(failures("unknown_user").length, 0, "a ledger error is never mistaken for an unknown user");
  DB.salesError = null; DB.accounts.get(U1).plan_remaining = 550;
  assert.equal((await send(e)).status, 200);
  assert.equal(DB.accounts.get(U1).plan_remaining, 550, "no second grant"); assert.equal(DB.accounts.get(U1).grants, 1); assert.equal(DB.sales.size, 1);
});
await test("K8c the money is recorded whatever the credit work did: a failed grant (500), an unknown customer, a deleted user's pack (recorded without an owner, 200)", async () => {
  world(); subscribed(U1, "prod_writer"); DB.failRpc = "turn_set_plan_once";
  assert.equal((await send(paidInvoice("old", { id: "in_f", reason: "subscription_cycle", sub: "sub_1", amount: 1900 }))).status, 500);
  assert.equal(DB.sales.has("invoice:in_f"), true, "recorded although the grant failed (the retry finds it recorded)");
  world(); stripeSub("sub_k", "prod_writer", { customer: "cus_9" });
  await send(paidInvoice("dahlia", { id: "in_u", reason: "subscription_cycle", sub: "sub_k", customer: "cus_9", amount: 1900, address: { country: "GB" } }));
  assert.equal(failures("unknown_customer").length, 1); assert.deepEqual([sale("invoice:in_u").app, sale("invoice:in_u").owner], ["kinolot", null]);
  world(); DB.noUser = U2; W.pis.pi = { id: "pi", latest_charge: "ch" }; W.lineItems.cs = [{ product: "prod_pack250", quantity: 1 }];
  const r = await send(evt("evt_nu", "checkout.session.completed", sessionObj({ id: "cs", mode: "payment", uid: U2, payment_intent: "pi", amount: 1000, address: { country: "GB" } })));
  assert.equal(r.status, 200); assert.equal(failures("unknown_user").length, 1);
  assert.equal(sale("checkout:cs").owner, null); assert.ok(logHas(/SALE_OWNER_UNKNOWN event=evt_nu key=checkout:cs/));
});
await test("K9 D4: two open disputes — the first to close (won) keeps the account held for the other; the second (lost) takes its payment's credits back and lifts the hold", async () => {
  world(); packBought(); planCharge();
  const created = (id, ch) => evt("c_" + id, "charge.dispute.created", { id, object: "dispute", charge: ch, status: "needs_response", reason: "fraudulent" }, "dahlia");
  await send(created("dp_a", "ch_pack")); await send(created("dp_b", "ch_plan"));
  const both = "dispute dp_a (fraudulent) on charge ch_pack | dispute dp_b (fraudulent) on charge ch_plan";
  assert.equal(DB.accounts.get(U1).frozen, true); assert.equal(DB.accounts.get(U1).frozen_reason, both);
  await send(created("dp_b", "ch_plan"));
  assert.equal(DB.accounts.get(U1).frozen_reason, both, "a resent dispute isn't listed twice");
  await send(evt("w_a", "charge.dispute.closed", { id: "dp_a", object: "dispute", charge: "ch_pack", status: "won" }, "dahlia"));
  assert.equal(DB.accounts.get(U1).frozen, true, "dp_b is still open"); assert.equal(DB.accounts.get(U1).frozen_reason, "dispute dp_b (fraudulent) on charge ch_plan");
  assert.ok(logHas(/ACCOUNT_STILL_HELD event=w_a .*dispute=dp_a/));
  await send(evt("l_b", "charge.dispute.closed", { id: "dp_b", object: "dispute", charge: "ch_plan", status: "lost" }, "old"));
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "l_b", charge_id: "invoice:in_1" }]);
  assert.equal(DB.accounts.get(U1).frozen, false); assert.equal(failures("dispute_lost")[0].details.hold, "lifted");
});
await test("K9b D4: a hold from before the dispute survives it closing; a held account whose reason doesn't name the dispute is left alone and recorded", async () => {
  world(); packBought(); Object.assign(DB.accounts.get(U1), { frozen: true, frozen_reason: "owner hold: chargeback abuse" });
  await send(evt("c1", "charge.dispute.created", { id: "dp_x", object: "dispute", charge: "ch_pack", status: "needs_response", reason: "fraudulent" }));
  assert.equal(DB.accounts.get(U1).frozen_reason, "owner hold: chargeback abuse | dispute dp_x (fraudulent) on charge ch_pack");
  await send(evt("w1", "charge.dispute.closed", { id: "dp_x", object: "dispute", charge: "ch_pack", status: "won" }));
  assert.equal(DB.accounts.get(U1).frozen, true); assert.equal(DB.accounts.get(U1).frozen_reason, "owner hold: chargeback abuse");
  // held with no reason at all, then a dispute opens and is lost: the credits go, the earlier hold stays
  world(); packBought(); Object.assign(DB.accounts.get(U1), { frozen: true, frozen_reason: null });
  await send(evt("c2", "charge.dispute.created", { id: "dp_y", object: "dispute", charge: "ch_pack", status: "needs_response", reason: "general" }));
  await send(evt("l2", "charge.dispute.closed", { id: "dp_y", object: "dispute", charge: "ch_pack", status: "lost" }));
  const a = DB.accounts.get(U1); assert.equal(a.packs[0].left, 0); assert.equal(a.frozen, true); assert.equal(a.frozen_reason, "earlier hold (no reason given)");
  assert.equal(failures("dispute_lost")[0].details.hold, "kept");
  // held by something else entirely when a dispute closes: nothing changed, recorded for the owner
  world(); packBought(); Object.assign(DB.accounts.get(U1), { frozen: true, frozen_reason: "owner hold" });
  await send(evt("w3", "charge.dispute.closed", { id: "dp_z", object: "dispute", charge: "ch_pack", status: "won" }));
  assert.equal(rpcs("turn_set_frozen").length, 0); assert.equal(DB.accounts.get(U1).frozen, true); assert.equal(DB.accounts.get(U1).frozen_reason, "owner hold");
  assert.equal(failures("dispute_closed_review").length, 1); assert.equal(failures("dispute_closed_review")[0].details.frozen_reason, "owner hold");
});
await test("K9c review fix: two disputes opened AT THE SAME MOMENT (parallel deliveries) are both kept — the add is one locked database call; the first to close leaves the account held", async () => {
  // two packs bought by the same account (a stolen card used twice): both deliveries take the same steps, so
  // a read-then-write would interleave and lose one part
  world(); packBought();
  W.pis.pi_p2 = { id: "pi_p2", latest_charge: "ch_pack2" }; W.lineItems.cs_p2 = [{ product: "prod_pack1000", quantity: 1 }];
  W.sessions.push(sessionObj({ id: "cs_p2", mode: "payment", uid: U1, payment_intent: "pi_p2", customer: null }));
  W.charges.ch_pack2 = { id: "ch_pack2", invoice: null, payment_intent: "pi_p2", customer: null, amount: 3500, amount_refunded: 0, refunded: false };
  const created = (id, ch) => evt("c_" + id, "charge.dispute.created", { id, object: "dispute", charge: ch, status: "needs_response", reason: "fraudulent" }, "dahlia");
  const [r1, r2] = await Promise.all([send(created("dp_a", "ch_pack")), send(created("dp_b", "ch_pack2"))]);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  const reason = DB.accounts.get(U1).frozen_reason;
  assert.ok(/dispute dp_a /.test(reason) && /dispute dp_b /.test(reason), `both listed: ${reason}`);
  await send(evt("w_a", "charge.dispute.closed", { id: "dp_a", object: "dispute", charge: "ch_pack", status: "won" }, "dahlia"));
  assert.equal(DB.accounts.get(U1).frozen, true, "dp_b is still open");
  assert.equal(rpcs("turn_set_frozen").length, 0, "never the read-then-write path when the database has turn_dispute_hold");
});
await test("K9d a database WITHOUT turn_dispute_hold (PGRST202 / 42883): the two-step update, same outcomes, DISPUTE_HOLD_FALLBACK logged; any other error is a 500", async () => {
  for (const missing of [true, { code: "42883", message: "function public.turn_dispute_hold(uuid, text, boolean, text) does not exist" }]) {
    world(); packBought(); planCharge(); DB.disputeFnMissing = missing;
    const created = (id, ch) => evt("c_" + id, "charge.dispute.created", { id, object: "dispute", charge: ch, status: "needs_response", reason: "fraudulent" }, "dahlia");
    await send(created("dp_a", "ch_pack")); await send(created("dp_b", "ch_plan"));
    assert.equal(DB.accounts.get(U1).frozen_reason, "dispute dp_a (fraudulent) on charge ch_pack | dispute dp_b (fraudulent) on charge ch_plan");
    assert.ok(logHas(/DISPUTE_HOLD_FALLBACK event=c_dp_a dispute=dp_a .*run supabase\/tax-compliance\.sql/));
    await send(evt("w_a", "charge.dispute.closed", { id: "dp_a", object: "dispute", charge: "ch_pack", status: "won" }, "dahlia"));
    assert.equal(DB.accounts.get(U1).frozen, true); assert.equal(DB.accounts.get(U1).frozen_reason, "dispute dp_b (fraudulent) on charge ch_plan");
    await send(evt("l_b", "charge.dispute.closed", { id: "dp_b", object: "dispute", charge: "ch_plan", status: "lost" }, "dahlia"));
    assert.equal(DB.accounts.get(U1).frozen, false); assert.equal(DB.accounts.get(U1).frozen_reason, "dispute dp_b lost");
    assert.deepEqual(rpcs("turn_set_frozen").map((x) => x.frozen), [true, true, true, false]);
  }
  world(); packBought(); DB.disputeFnMissing = { code: "57014", message: "canceling statement due to statement timeout" };
  const r = await send(evt("c1", "charge.dispute.created", { id: "dp_x", object: "dispute", charge: "ch_pack", status: "needs_response", reason: "fraudulent" }));
  assert.equal(r.status, 500); assert.equal(rpcs("turn_set_frozen").length, 0); assert.equal(DB.accounts.get(U1).frozen, false);
});
await test("K11 review fix: a PENDING partial refund removes nothing and writes no ledger row (no owner review either) until charge.refund.updated says it succeeded; a failed one is recorded for the owner", async () => {
  world(); packBought();
  W.refunds.ch_pack = [{ id: "re_p", object: "refund", amount: 1750, currency: "usd", status: "pending", created: T0, charge: "ch_pack" }];
  assert.equal((await send(evt("e1", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1750 }), "dahlia"))).status, 200);
  assert.equal(DB.accounts.get(U1).packs[0].left, 640); assert.equal(rpcs("turn_revoke_charge_once").length, 0); assert.equal(DB.sales.size, 0);
  assert.equal(failures("partial_refund_review").length, 0); assert.ok(logHas(/REFUND_PENDING event=e1 charge=ch_pack refunds=re_p/));
  // still pending: an update changes nothing
  await send(evt("u0", "charge.refund.updated", { ...W.refunds.ch_pack[0] }, "dahlia"));
  assert.equal(DB.accounts.get(U1).packs[0].left, 640); assert.ok(logHas(/IGNORED charge\.refund\.updated event=u0 refund=re_p status=pending/));
  // it succeeds: applied once (a resent update changes nothing more)
  W.refunds.ch_pack[0].status = "succeeded"; Object.assign(W.charges.ch_pack, { amount_refunded: 1750 });
  const u1 = evt("u1", "charge.refund.updated", { ...W.refunds.ch_pack[0] }, "dahlia");
  assert.equal((await send(u1)).status, 200); await send(u1);
  assert.equal(DB.accounts.get(U1).packs[0].left, 140, "640 - ceil(1000 x 0.5)"); assert.equal(sale("refund:re_p").amount_cents, -1750);
  assert.equal(DB.sales.size, 1);
  // a FULL refund that is still pending waits too
  world(); packBought();
  W.refunds.ch_pack = [{ id: "re_f", object: "refund", amount: 3500, currency: "usd", status: "pending", created: T0, charge: "ch_pack" }];
  await send(evt("e2", "charge.refunded", chargeObj("old", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 3500 })));
  assert.equal(DB.accounts.get(U1).packs[0].left, 640); assert.equal(rpcs("turn_revoke_charge_once").length, 0);
  W.refunds.ch_pack[0].status = "succeeded"; Object.assign(W.charges.ch_pack, { amount_refunded: 3500, refunded: true });
  await send(evt("u2", "charge.refund.updated", { ...W.refunds.ch_pack[0] }, "dahlia"));
  assert.equal(DB.accounts.get(U1).packs[0].left, 0); assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "u2", charge_id: "ch_pack" }]);
  // a refund that FAILED: nothing applied for it; recorded for the owner (it may have succeeded before)
  world(); packBought();
  W.refunds.ch_pack = [{ id: "re_x", object: "refund", amount: 1000, currency: "usd", status: "failed", failure_reason: "expired_or_canceled_card", created: T0, charge: "ch_pack" }];
  assert.equal((await send(evt("u3", "charge.refund.updated", { ...W.refunds.ch_pack[0] }, "dahlia"))).status, 200);
  assert.equal(DB.accounts.get(U1).packs[0].left, 640); assert.equal(DB.sales.size, 0);
  const f = failures("refund_failed_review"); assert.equal(f.length, 1); assert.equal(f[0].uid, U1); assert.equal(f[0].details.refund_id, "re_x");
  assert.equal(f[0].details.failure_reason, "expired_or_canceled_card");
  // another app's refund update changes nothing and records nothing for the owner
  world(); stripeSub("sub_ac", "prod_academy", { customer: "cus_1" }); seedAccount(U1, { stripe_customer_id: "cus_1" });
  W.invoices.in_ac = { id: "in_ac", subscription: "sub_ac", customer: "cus_1" };
  W.charges.ch_ac = { id: "ch_ac", invoice: "in_ac", customer: "cus_1", amount: 9900, amount_refunded: 0, refunded: false };
  await send(evt("u4", "charge.refund.updated", { id: "re_ac", object: "refund", amount: 9900, status: "failed", charge: "ch_ac" }, "dahlia"));
  assert.equal(DB.failures.length, 0); assert.ok(logHas(/SKIP refund_not_kinolot event=u4/));
});
await test("K12 review fix: a plan invoice paid partly from the customer's Stripe balance — a partial refund's share is of the INVOICE total, and even a full refund of the charge removes only its share", async () => {
  world(); planCharge();
  await send(paidInvoice("old", { id: "in_1", reason: "subscription_create", sub: "sub_1" }));     // grant invoice:in_1 = 1,600
  // a $49 Director renewal with $30 from the customer's balance: a $19 charge
  Object.assign(W.invoices.in_1, { total: 4900, amount_paid: 1900, starting_balance: -3000 });
  Object.assign(W.charges.ch_plan, { amount: 1900 });
  W.refunds.ch_plan = [{ id: "re_g", object: "refund", amount: 950, currency: "usd", status: "succeeded", created: T0 }];
  await send(evt("e1", "charge.refunded", chargeObj("dahlia", { id: "ch_plan", pi: "pi_plan", customer: "cus_1", amount: 1900, refunded: 950 }), "dahlia"));
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "refund:re_g", charge_id: "invoice:in_1", refund_fraction: 0.193877551020 }],
    "$9.50 of the $49 invoice (not of the $19 charge)");
  assert.equal(DB.accounts.get(U1).plan_remaining, 1600 - 311, "ceil(0.19387755102 x 1,600) = 311, not 800");
  assert.ok(logHas(/REFUND_REVOKE_PARTIAL event=e1 charge=ch_plan refund=re_g refunded=950\/4900 /));
  // the rest of the $19 charge refunded: the charge is fully refunded, the payment only 19/49
  W.refunds.ch_plan.push({ id: "re_h", object: "refund", amount: 950, currency: "usd", status: "succeeded", created: T0 + 1 });
  Object.assign(W.charges.ch_plan, { amount_refunded: 1900, refunded: true });
  await send(evt("e2", "charge.refunded", chargeObj("dahlia", { id: "ch_plan", pi: "pi_plan", customer: "cus_1", amount: 1900, refunded: 1900 }), "dahlia"));
  assert.deepEqual(rpcs("turn_revoke_charge_once").at(-1), { event_id: "refund:re_h", charge_id: "invoice:in_1", refund_fraction: 0.193877551020 });
  assert.equal(DB.accounts.get(U1).plan_remaining, 1600 - 622, "a second share — never the full revoke");
  // a pack is still measured against its charge (G2 / K6), and a plan invoice without a balance against the charge (K6b)
});
await test("K13 review fix: a payment for an account that no longer exists (23503) whose LEDGER write also fails answers 500, so the payment still reaches the tax ledger on the retry", async () => {
  world(); DB.noUser = U2; W.pis.pi = { id: "pi", latest_charge: "ch" }; W.lineItems.cs = [{ product: "prod_pack250", quantity: 1 }];
  DB.salesError = { code: "57014", message: "canceling statement due to statement timeout" };
  const e = evt("evt_nu", "checkout.session.completed", sessionObj({ id: "cs", mode: "payment", uid: U2, payment_intent: "pi", amount: 1000, address: { country: "GB" } }));
  assert.equal((await send(e)).status, 500, "the ledger failed: retry");
  assert.equal(failures("unknown_user").length, 1);
  DB.salesError = null;
  assert.equal((await send(e)).status, 200);
  assert.equal(sale("checkout:cs").owner, null); assert.equal(DB.sales.size, 1);
  // a ledger error alone (the credit work fine) is a 500 too (K8b), and a missing ledger never is (K8)
});
await test("K10 source: the ledger runs after the credit work; the partial path sends refund_fraction keyed by the refund and never falls back to the two-argument call; full refunds and lost disputes keep it", async () => {
  assert.match(SRC, /import \{[^}]*refundFraction[^}]*\} from "\.\/sales-ledger\.mjs";/);
  const entry = CODE.slice(CODE.indexOf("Deno.serve("));
  assert.ok(entry.indexOf("await recordSales(event)") > entry.indexOf("await onChargeRefunded(event)"), "the ledger after the credit work");
  assert.ok(entry.indexOf("await recordSales(event)") < entry.indexOf('e?.code === "23503"'), "…and before the failure is answered");
  assert.match(CODE, /const args = \{ event_id: refundSaleKey\(r\.id\), charge_id: key, refund_fraction: fraction \};/);
  assert.doesNotMatch(CODE, /turn_revoke_charge_once", \{ event_id: refundSaleKey/);
  assert.match(CODE, /rpc\("turn_revoke_charge_once", \{ event_id: event\.id, charge_id: revokeKey\(info, ch\.id\) \}\)/);
  assert.match(CODE, /rpc\("turn_revoke_charge_once", \{ event_id: event\.id, charge_id: revokeKey\(info, chargeId!\) \}\)/);
  const header = SRC.slice(0, SRC.indexOf("import Stripe"));
  assert.match(header, /SALES LEDGER/); assert.match(header, /refund_fraction/); assert.match(header, /never the two-argument call/);
  assert.doesNotMatch(header, /the account stays frozen/); assert.doesNotMatch(header, /partial refund -> recorded for the owner, nothing removed/);
});

console.log(failed ? `\n${checks} passed, ${failed} failed` : `\n${checks} checks passed`);
if (failed) process.exit(1);

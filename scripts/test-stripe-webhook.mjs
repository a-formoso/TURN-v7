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
};
/* round 3 (S6): OPTIONAL trailing arguments a function may be called with */
const CONTRACT_OPTIONAL = { turn_add_pack_once: ["legacy_unit"] };

/* ── fake database (contract semantics, simplified) ──────────────────────────────────── */
let DB;
function resetDb(opts = {}) {
  DB = { accounts: new Map(), keys: new Set(), rpcs: [], failures: [], updates: [], failRpc: opts.failRpc || null, hasPendingTier: opts.hasPendingTier !== false,
    switched: false, results: new Map(), conflictUids: new Set(), mismatchUids: new Set(), failResultRead: false,
    // round 3: a database whose turn_add_pack_once has no legacy_unit argument answers a call with it with
    // this error (true = PostgREST's PGRST202); legacyArgError = any other error for that call
    packFnNoLegacyArg: false, legacyArgError: null };
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
    if (!once("revoke:" + a.event_id)) return 0;
    let removed = 0;
    for (const r of DB.accounts.values()) for (const p of r.packs) if (p.charge && p.charge === a.charge_id) { removed += p.left; p.left = 0; }
    return removed;
  },
  turn_set_payment_status(a) { acctRow(a.uid).payment_status = a.status; return null; },
  turn_set_frozen(a) { Object.assign(acctRow(a.uid), { frozen: a.frozen, frozen_reason: a.reason }); return null; },
  turn_end_plan_for_sub(a) {
    const r = DB.accounts.get(a.uid);
    if (r && r.stripe_sub_id === a.sub_id) Object.assign(r, { plan: "none", plan_remaining: 0, stripe_sub_id: null, renews_at: null, pending_tier: null });
    return null;
  },
  turn_credit_regime() {
    if (DB.regimeBroken) return [];
    return [{ switched: DB.switched, switched_at: DB.switched ? "2026-10-30T00:00:00Z" : null, usd_per_credit: DB.switched ? "0.01" : "0.03", trial_credits: DB.switched ? 50 : 0, legacy_until: null }];
  },
};
function publicRow(r) {
  const { packs, grants, adjusts, frozen_reason, ...rest } = r;
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
function resetStripe() { W = { products: {}, subs: {}, invoices: {}, sessions: [], lineItems: {}, pis: {}, charges: {}, calls: [] }; }
class FakeStripe {
  constructor(key) { this.key = key; this.webhooks = { constructEventAsync: async (body, sig) => { if (sig !== "good") throw new Error("No signatures found matching the expected signature"); return JSON.parse(body); } };
    const miss = (what, id) => Object.assign(new Error(`No such ${what}: '${id}'`), { type: "StripeInvalidRequestError" });
    this.subscriptions = { retrieve: async (id, opts) => { W.calls.push(["subscriptions.retrieve", id]); const s = W.subs[id]; if (!s) throw miss("subscription", id);
      const c = structuredClone(s); if (opts?.expand?.includes("items.data.price.product")) for (const it of c.items.data) it.price.product = structuredClone(W.products[it.price.product]); return c; } };
    this.invoices = { retrieve: async (id) => { W.calls.push(["invoices.retrieve", id]); if (!W.invoices[id]) throw miss("invoice", id); return structuredClone(W.invoices[id]); } };
    this.charges = { retrieve: async (id) => { W.calls.push(["charges.retrieve", id]); if (!W.charges[id]) throw miss("charge", id); return structuredClone(W.charges[id]); } };
    this.paymentIntents = { retrieve: async (id) => { W.calls.push(["paymentIntents.retrieve", id]); if (W.onPaymentIntent) W.onPaymentIntent(); if (!W.pis[id]) throw miss("payment_intent", id); return structuredClone(W.pis[id]); } };
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
    .replace('from "./plan-metadata.mjs"', `from ${JSON.stringify(new URL("plan-metadata.mjs", FN_DIR).href)}`);
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
async function send(event, sig = "good") {   // log lines accumulate until the next world()
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const cap = (lvl) => (...a) => { const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); LOG.push(line); if (VERBOSE) orig.log(`   [${lvl}] ${line}`); };
  console.log = cap("log"); console.warn = cap("warn"); console.error = cap("error");
  try {
    const res = await handler(new Request("http://localhost/stripe-webhook", { method: "POST", body: JSON.stringify(event), headers: { "stripe-signature": sig } }));
    return { status: res.status, text: await res.text() };
  } finally { Object.assign(console, orig); }
}
const logHas = (re) => LOG.some((l) => re.test(l));
const rpcs = (name) => DB.rpcs.filter(([n]) => n === name).map(([, a]) => a);
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
function evt(id, type, object, shape = "old", extra = {}) {
  return { id, object: "event", type, livemode: false, api_version: API[shape], data: { object, ...extra } };
}
function sessionObj(o) {
  return { id: o.id ?? "cs_1", object: "checkout.session", mode: o.mode ?? "subscription", payment_status: o.payment_status ?? "paid", status: "complete",
    client_reference_id: o.uid === undefined ? U1 : o.uid, customer: o.customer === undefined ? "cus_1" : o.customer,
    subscription: o.subscription ?? null, invoice: o.invoice ?? null, payment_intent: o.payment_intent ?? null };
}
function invoiceObj(shape, o) {
  const base = { id: o.id, object: "invoice", billing_reason: o.reason, customer: o.customer ?? "cus_1", status: "paid", attempt_count: o.attempt ?? 1, next_payment_attempt: o.next ?? null };
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
    customer: o.customer ?? null, payment_intent: o.pi ?? null, currency: "usd" };
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
await test("G2 a PARTIAL refund removes nothing and is recorded for the owner (partial_refund_review)", async () => {
  world(); packBought();
  await send(evt("evt_rf", "charge.refunded", chargeObj("dahlia", { id: "ch_pack", pi: "pi_p", amount: 3500, refunded: 1000 }), "dahlia"));
  assert.equal(rpcs("turn_revoke_charge_once").length, 0); assert.equal(DB.accounts.get(U1).packs[0].left, 640);
  const f = failures("partial_refund_review"); assert.equal(f.length, 1); assert.equal(f[0].details.amount_refunded, 1000); assert.equal(f[0].uid, U1);
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
    assert.deepEqual(rpcs("turn_set_frozen"), [{ uid: U2, frozen: true, reason: "dispute dp_1 (fraudulent) on charge ch_pack" }]);
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
await test("G7 a LOST dispute takes back the purchase's unspent credits, keeps the account frozen and is recorded (dispute_lost)", async () => {
  world(); packBought();
  await send(evt("e1", "charge.dispute.created", { id: "dp_3", object: "dispute", charge: "ch_pack", status: "needs_response", reason: "fraudulent" }));
  await send(evt("e2", "charge.dispute.closed", { id: "dp_3", object: "dispute", charge: "ch_pack", status: "lost" }));
  const a = DB.accounts.get(U1); assert.equal(a.frozen, true); assert.equal(a.packs[0].left, 0);
  assert.deepEqual(rpcs("turn_revoke_charge_once"), [{ event_id: "e2", charge_id: "ch_pack" }]); assert.equal(failures("dispute_lost").length, 1);
});
await test("G8 a Kinolot dispute whose account can't be found is recorded (dispute_unknown_account)", async () => {
  world(); W.pis.pi_x = { id: "pi_x", latest_charge: "ch_x" }; W.lineItems.cs_x = [{ product: "prod_pack250", quantity: 1 }];
  W.sessions.push(sessionObj({ id: "cs_x", mode: "payment", uid: null, payment_intent: "pi_x" }));
  W.charges.ch_x = { id: "ch_x", invoice: null, payment_intent: "pi_x", customer: null, amount: 1000 };
  await send(evt("e1", "charge.dispute.created", { id: "dp_4", object: "dispute", charge: "ch_x", status: "needs_response", reason: "fraudulent" }));
  assert.equal(failures("dispute_unknown_account").length, 1); assert.equal(rpcs("turn_set_frozen").length, 0);
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
    "customer.subscription.updated", "customer.subscription.deleted", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"];
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

console.log(failed ? `\n${checks} passed, ${failed} failed` : `\n${checks} checks passed`);
if (failed) process.exit(1);

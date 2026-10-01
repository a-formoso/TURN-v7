// ============================================================================
// Kinolot — Stripe webhook  (Supabase Edge Function)
//
// Turns Stripe payments into generation credits. Metadata-driven: it reads `app`, `tier`
// and `plan_credits` off plan PRODUCTS, and `app`, `kind=credit_pack`, `pack_credits` off
// pack PRODUCTS, so changing grants is a Stripe dashboard edit. It ignores any product
// whose `app` metadata isn't Kinolot's ("kinolot", or the pre-rebrand label — both
// accepted, owner 2026-09-29; see plan-metadata.mjs), so Academy / mentorship products on
// the same Stripe account never grant app credits. A `tier=producer` product is stored as
// plan "studio" (the Producer plan's id everywhere else); legacy `tier=pro` as "director".
//
// BILLING FIXES (owner decisions 2026-09-30) — what each event does:
//   checkout.session.completed / checkout.session.async_payment_succeeded
//       Only when the session is PAID (payment_status "paid" or "no_payment_required").
//       subscription mode -> turn_set_plan_once, keyed by the first INVOICE (so the
//         invoice.paid for that same invoice can't grant it twice, in either order);
//       payment mode (credit pack) -> turn_add_pack_once with the pack's charge id (the
//         pack lot lasts 12 months and survives renewals; any signed-in account may buy).
//         An OLD pack (300 / 1,200 / 4,000, sold in the old unit; recognised by its metadata,
//         plan-metadata.mjs isLegacyPack) granted after the switch day counts x3, so a late
//         delivery keeps the value paid for: the webhook passes legacy_unit => true and the
//         database triples the lot itself once turn__switched() is true, under its own locks
//         (a database without that argument: the webhook's own x3 from turn_credit_regime()).
//         Its log line says credits_as_sold=<n> and the lot the database granted, read back from
//         the event's result: lot_credits=<n> x3=<true|false> (round 4, S6).
//   invoice.paid
//       subscription_create / subscription_cycle -> turn_set_plan_once, once per invoice
//         (renewal resets PLAN credits only; packs untouched; the database honours the
//         grandfathered allowance), then turn_set_payment_status 'active' — unless the database
//         refused the grant (a different customer's subscription for an account whose own is still
//         active: its turn_stripe_events row says {"skipped": …}), which leaves the status alone.
//       subscription_update (proration of a plan change) -> the upgrade path below.
//   invoice.payment_failed          -> turn_set_payment_status 'past_due' (refills pause).
//   customer.subscription.updated   (price change) upgrade -> turn_adjust_plan_once with the
//       allowance difference, applied now and PRORATED by the database to the part of the period
//       still to run (nothing now when there is no renewal date — the next renewal gives the new
//       allowance); downgrade -> recorded as pending, applied by the next renewal's grant (the
//       subscription's price is the new plan by then).
//   customer.subscription.deleted   -> turn_end_plan_for_sub (only the stored subscription;
//       other brands' subscriptions on the same customer are skipped).
//   charge.refunded                 full refund -> turn_revoke_charge_once (unspent credits of
//       that purchase); partial refund -> recorded for the owner, nothing removed.
//   charge.dispute.created          -> turn_set_frozen true.
//   charge.dispute.closed           won / inquiry closed -> turn_set_frozen false;
//       lost -> turn_revoke_charge_once, the account stays frozen, recorded for the owner.
// Nothing is ever dropped silently: every skip logs a line, every grant it could not make
// is logged with the marker GRANT_FAILURE and stored in public.turn_grant_failures, and a
// database error returns 500 so Stripe retries (every write is idempotent).
//
// SETUP — in this order (the new database functions must exist before this deploys, or
// every grant fails with 500 until they do; Stripe keeps retrying for 3 days):
//   1. Run the billing SQL in the Supabase SQL Editor (it creates the *_once functions).
//   2. supabase functions deploy stripe-webhook --no-verify-jwt
//        (Stripe calls this unauthenticated — JWT verification MUST be off.)
//   3. Stripe → Developers → Webhooks → the endpoint
//        https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//      → "Select events" and make sure ALL of these are ticked:
//        checkout.session.completed
//        checkout.session.async_payment_succeeded
//        invoice.paid
//        invoice.payment_failed
//        customer.subscription.updated
//        customer.subscription.deleted
//        charge.refunded
//        charge.dispute.created
//        charge.dispute.closed
//      Copy the endpoint's "Signing secret" (whsec_…) if it is a new endpoint.
//   4. Secrets (only when they change):
//        supabase secrets set STRIPE_SECRET_KEY=sk_live_…      (same mode as the endpoint)
//        supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
//      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//      A live event arriving with a test key (or the reverse) is refused with 500 and a
//      "mode_mismatch" row, instead of failing obscurely on the first Stripe lookup.
//
// API VERSIONS: event payloads follow the ENDPOINT's version (live: 2026-03-25.dahlia);
// objects this code fetches follow the SDK's pinned version (stripe@16 → 2024-06-20). So it
// reads ids from both shapes (plan-metadata.mjs) and fetches the subscription, invoice or
// charge from the API when a payload lacks a field (invoice.subscription, charge.invoice).
// Upgrading the SDK past v17 changes the fetched shapes — rerun scripts/test-stripe-webhook.mjs.
//
// The customer's Supabase user id rides in as the Checkout `client_reference_id` (the app
// appends ?client_reference_id=<uid> to the payment link). Later events carry the Stripe
// customer, which the first plan grant stores (turn_credits.stripe_customer_id).
// ============================================================================
import Stripe from "npm:stripe@16";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  disputeOutcome, idOf, invoiceSubscriptionId, isKnownTier, isLegacyPack, isMissingFunctionError, isOurApp, isUuid, looksLikeOurs,
  legacyPackLotNote, packGrantCredits, packGrantKey, planChange, planGrantKey, planTier, refundState, regimeSwitched, stripeKeyMode,
  subscriptionPeriod, upgradeCredits, upgradeKey, PLAN_BILLING_REASONS,
} from "./plan-metadata.mjs";

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const KEY_MODE = stripeKeyMode(STRIPE_KEY);
const stripe = new Stripe(STRIPE_KEY);
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,   // service role — bypasses RLS
);

/** A grant the webhook could not perform (or a payment the owner must look at). Logged loudly
 *  AND persisted to public.turn_grant_failures so it is findable without Stripe access. */
async function reportGrantFailure(args: {
  event: Stripe.Event;
  reason: string;
  customerId?: string | null;
  sessionId?: string | null;
  subId?: string | null;
  productId?: string | null;
  uid?: string | null;
  details?: Record<string, unknown>;
}) {
  const row = {
    event_id: args.event.id,
    event_type: args.event.type,
    reason: args.reason,
    stripe_customer_id: args.customerId ?? null,
    stripe_session_id: args.sessionId ?? null,
    stripe_sub_id: args.subId ?? null,
    stripe_product_id: args.productId ?? null,
    uid: args.uid && isUuid(args.uid) ? args.uid : null,   // the column is a uuid
    details: args.uid && !isUuid(args.uid) ? { ...(args.details ?? {}), raw_uid: args.uid } : (args.details ?? {}),
  };
  // Greppable marker — `GRANT_FAILURE` — with every id needed to trace it in Stripe.
  console.error(`GRANT_FAILURE reason=${args.reason}`, JSON.stringify(row));
  const { error } = await admin.from("turn_grant_failures").insert(row);
  if (error) console.error("GRANT_FAILURE_PERSIST_ERROR:", error.message, JSON.stringify(row));
}

/** Call a database function; a database error throws, so the handler answers 500 and Stripe
 *  retries (every function it calls is idempotent). */
async function rpc(name: string, args: Obj): Promise<unknown> {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    console.error(`RPC_ERROR fn=${name}`, error.message, JSON.stringify(args));
    throw error;
  }
  return data;
}

type PlanRead =
  | { ok: true; ours: true; tier: string; credits: number; productId: string | null }
  | { ok: false; ours: boolean; reason: string; productId: string | null; details: Record<string, unknown> };

/** Read tier + credits off a subscription's product metadata. Returns the plan, or a failure
 *  reason when the product isn't a valid Kinolot plan. A product that isn't Kinolot's
 *  (isOurApp) is NOT a failure — other brand products on the same Stripe account are
 *  deliberately ignored (reason "other_app" lets callers skip, with a log line). */
function readPlan(sub: Obj): PlanRead {
  const price = sub?.items?.data?.[0]?.price as Obj | undefined;
  const product = price?.product;                       // expanded to the full object
  const productId = idOf(product);
  const md: Obj = (product && typeof product === "object" ? product.metadata : null) || {};
  if (!isOurApp(md.app)) {
    // a product carrying our credit fields under another `app` is a mistyped Kinolot product,
    // not another brand's — report it (2026-09-29: an unrecognised app once skipped payments silently)
    if (md.app && looksLikeOurs(md)) {
      return { ok: false, ours: false, reason: "other_app_suspect", productId, details: { app: md.app, tier: md.tier ?? null, plan_credits: md.plan_credits ?? null } };
    }
    return md.app
      ? { ok: false, ours: false, reason: "other_app", productId, details: { app: md.app } }
      : { ok: false, ours: false, reason: "missing_app_metadata", productId, details: { metadata: md } };
  }
  const credits = parseInt(md.plan_credits ?? "0", 10);
  if (!Number.isFinite(credits) || credits <= 0) {
    return { ok: false, ours: true, reason: "invalid_plan_credits", productId, details: { plan_credits: md.plan_credits ?? null, tier: md.tier ?? null } };
  }
  return { ok: true, ours: true, tier: planTier(md.tier), credits, productId };
}

/** A plan read that failed: other brands are skipped with a log line, anything else recorded. */
async function skipOrReport(plan: PlanRead, event: Stripe.Event, ctx: { uid?: string | null; customerId?: string | null; sessionId?: string | null; subId?: string | null }) {
  if (plan.ok) return;
  if (plan.reason === "other_app") {
    console.warn(`SKIP other_app event=${event.id} product=${plan.productId} app=${JSON.stringify(plan.details?.app ?? null)}`);
    return;
  }
  await reportGrantFailure({
    event, reason: plan.reason, customerId: ctx.customerId ?? null, sessionId: ctx.sessionId ?? null,
    subId: ctx.subId ?? null, productId: plan.productId, uid: ctx.uid ?? null, details: plan.details,
  });
}

/** Read a one-off credit-pack grant from a Checkout line item's product metadata. */
function readCreditPack(product: Obj | string | undefined | null): number {
  const md: Obj = (product && typeof product === "object" && !("deleted" in product) ? product.metadata : null) || {};
  if (!isOurApp(md.app) || md.kind !== "credit_pack") return 0;
  const credits = parseInt(md.pack_credits ?? "0", 10);
  return Number.isFinite(credits) && credits > 0 ? credits : 0;
}

/** The subscription with its price's product expanded (stripe@16 shape). */
async function retrieveSub(subId: string): Promise<Obj> {
  return await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price.product"] }) as unknown as Obj;
}

async function lineItems(sessionId: string): Promise<Obj[]> {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ["data.price.product"] });
  return (items?.data ?? []) as unknown as Obj[];
}

function sessionHasOurProduct(items: Obj[]): boolean {
  return items.some((it) => {
    const p = it.price?.product;
    return !!(p && typeof p === "object" && !("deleted" in p) && isOurApp(p.metadata?.app));
  });
}

/** The app account behind a Stripe customer (renewals, cancellations, failures and disputes
 *  carry the customer, not the client_reference_id — the first plan grant stored the mapping).
 *  select("*") so optional columns (pending_tier) come back when the database has them. */
async function accountByCustomer(customerId: string | null, event: Stripe.Event): Promise<Obj | null> {
  if (!customerId) return null;
  const { data, error } = await admin.from("turn_credits").select("*").eq("stripe_customer_id", customerId).limit(2);
  if (error) throw error;
  const rows = (data ?? []) as Obj[];
  if (rows.length > 1) {
    // never guess whose balance to change — the owner untangles it (retrying would not help)
    await reportGrantFailure({ event, reason: "customer_on_several_accounts", customerId, details: { owners: rows.map((r) => r.owner) } });
    return null;
  }
  return rows[0] ?? null;
}

async function accountByUid(uid: string): Promise<Obj | null> {
  const { data, error } = await admin.from("turn_credits").select("*").eq("owner", uid).maybeSingle();
  if (error) throw error;
  return (data as Obj | null) ?? null;
}

/** The uid on the Checkout Session that created a subscription — for a first invoice that is
 *  paid before (or without) its checkout.session.completed being processed. */
async function checkoutForSubscription(subId: string): Promise<{ found: boolean; uid: string | null; sessionId: string | null }> {
  const list = await stripe.checkout.sessions.list({ subscription: subId, limit: 1 });
  const s = (list?.data?.[0] ?? null) as Obj | null;
  return { found: !!s, uid: s && isUuid(s.client_reference_id) ? s.client_reference_id : null, sessionId: s?.id ?? null };
}

/** Pending downgrade (applied by the next renewal). Stored in turn_credits.pending_tier when the
 *  database has that column; without it the renewal still applies the new plan — only the
 *  "changes at renewal" display is missing — so a failure here is logged, never fatal. */
async function setPendingTier(uid: string, tier: string | null, event: Stripe.Event) {
  const { error } = await admin.from("turn_credits").update({ pending_tier: tier }).eq("owner", uid);
  if (error) console.warn(`PENDING_TIER_NOT_STORED event=${event.id} uid=${uid} tier=${tier}: ${error.message}`);
}
async function clearPendingTier(acct: Obj | null, event: Stripe.Event) {
  if (acct?.owner && acct.pending_tier) await setPendingTier(acct.owner, null, event);
}

async function setPaymentStatus(uid: string, status: "active" | "past_due", event: Stripe.Event) {
  await rpc("turn_set_payment_status", { uid, status });
  console.log(`PAYMENT_STATUS event=${event.id} uid=${uid} status=${status}`);
}

/** Why the database refused a keyed grant, or null when it applied it: the *_once functions
 *  record a refusal in turn_stripe_events.result as {"skipped": "subscription_conflict" |
 *  "subscription_mismatch"} under the same key. A read error is logged and treated as applied
 *  (the status update that follows is what the webhook did before). */
async function grantSkipped(key: string, event: Stripe.Event): Promise<string | null> {
  const { data, error } = await admin.from("turn_stripe_events").select("result").eq("id", key).maybeSingle();
  if (error) { console.warn(`GRANT_RESULT_UNREADABLE event=${event.id} key=${key}: ${error.message}`); return null; }
  const result = (data as Obj | null)?.result;
  const skipped = result && typeof result === "object" ? (result as Obj).skipped : null;
  return typeof skipped === "string" && skipped ? skipped : null;
}

/** A second Kinolot subscription for an account that already has an active one (a payment link
 *  opened by a subscriber makes a new Stripe customer and subscription). The owner must look:
 *  the customer is now billed twice. What the database does with its grant: from the SAME
 *  Stripe customer it applies (the account moves to the new subscription); from a DIFFERENT
 *  customer, while the stored subscription is still active, it REFUSES it (turn__plan_conflict:
 *  nothing granted, recorded as subscription_conflict) — anyone who knows an account's id could
 *  otherwise replace its plan. This report is written either way. */
async function reportIfDuplicate(o: { event: Stripe.Event; acct: Obj | null; subId: string; uid: string; customerId: string | null; productId: string | null; details?: Obj }) {
  const a = o.acct;
  if (!a?.stripe_sub_id || a.stripe_sub_id === o.subId || !a.plan || a.plan === "none") return;
  await reportGrantFailure({
    event: o.event, reason: "duplicate_subscription", uid: o.uid, customerId: o.customerId, subId: o.subId, productId: o.productId,
    details: { stored_sub: a.stripe_sub_id, stored_plan: a.plan, ...(o.details ?? {}) },
  });
}

/** Grant (or refill) a plan: once per key (the invoice). Renewal resets plan credits only. */
async function grantPlan(o: {
  event: Stripe.Event; uid: string; sub: Obj; customerId: string | null; key: string;
  source: "checkout" | "first_invoice" | "renewal"; sessionId?: string | null; acct?: Obj | null;
}): Promise<boolean> {
  const { event, uid, sub, customerId, key, source } = o;
  const plan = readPlan(sub);
  if (!plan.ok) {
    await skipOrReport(plan, event, { uid, customerId, sessionId: o.sessionId, subId: sub.id });
    return false;
  }
  if (!isKnownTier(plan.tier)) {
    // still credited below, but every gate would treat this payer as unpaid — surface it
    await reportGrantFailure({
      event, reason: "unknown_tier", customerId, sessionId: o.sessionId ?? null,
      subId: sub.id, productId: plan.productId, uid, details: { tier: plan.tier, credits: plan.credits },
    });
  }
  const period = subscriptionPeriod(sub);
  const result = await rpc("turn_set_plan_once", {
    event_id: key, uid, new_tier: plan.tier, monthly_credits: plan.credits,
    sub_id: sub.id, customer_id: customerId, renews: period.endIso,
  });
  console.log(`PLAN_GRANT event=${event.id} key=${key} source=${source} uid=${uid} tier=${plan.tier} credits=${plan.credits} sub=${sub.id} renews=${period.endIso} result=${JSON.stringify(result)}`);
  const skipped = await grantSkipped(key, event);
  if (skipped) {
    // refused by the database (recorded there for the owner): this payment isn't the account's
    // plan, so it doesn't change the account's payment status either
    console.warn(`PLAN_GRANT_REFUSED event=${event.id} key=${key} uid=${uid} sub=${sub.id} skipped=${skipped} — payment status unchanged`);
    return false;
  }
  await setPaymentStatus(uid, "active", event);
  if (source === "renewal") await clearPendingTier(o.acct ?? null, event);
  return true;
}

/** Plan change, decided from STATE (the plan the app has vs the plan Stripe now bills), so a
 *  replayed or out-of-order event can't grant twice and a downgrade-then-upgrade inside one
 *  period adds nothing:
 *    upgrade   -> turn_adjust_plan_once(new plan, new allowance − old allowance) now, which the
 *                 database PRORATES to the part of the period still to run;
 *    downgrade -> pending until the next renewal (whose grant applies the new plan);
 *    same      -> a pending downgrade is cancelled. */
async function reconcilePlanChange(o: { event: Stripe.Event; acct: Obj; sub: Obj; plan: PlanRead & { ok: true }; prevPrice?: Obj | null; source: string }): Promise<{ skipped: string | null }> {
  const { event, acct, sub, plan, source } = o;
  const uid = acct.owner as string;
  const current = planTier(acct.plan);
  const change = planChange(current, plan.tier);
  if (change === "unknown") {
    await reportGrantFailure({
      event, reason: "plan_change_review", uid, customerId: idOf(sub.customer), subId: sub.id, productId: plan.productId,
      details: { app_plan: acct.plan ?? null, stripe_tier: plan.tier, credits: plan.credits, source },
    });
    return { skipped: null };
  }
  if (change === "same") {
    console.log(`PLAN_CHANGE_NONE event=${event.id} uid=${uid} plan=${current} source=${source}${acct.pending_tier ? ` (pending ${acct.pending_tier} cancelled)` : ""}`);
    await clearPendingTier(acct, event);
    return { skipped: null };
  }
  if (change === "downgrade") {
    console.log(`PLAN_DOWNGRADE_PENDING event=${event.id} uid=${uid} from=${current} to=${plan.tier} at=${subscriptionPeriod(sub).endIso} source=${source}`);
    if (acct.pending_tier !== plan.tier) await setPendingTier(uid, plan.tier, event);
    return { skipped: null };
  }
  // upgrade: the old allowance comes from the previous price's product when it is the plan the
  // app has; otherwise from the allowance table the new plan's credits belong to
  let fromCredits: number | null = null;
  const prevProductId = idOf(o.prevPrice?.product);
  if (prevProductId) {
    try {
      const prev = (typeof o.prevPrice?.product === "object" ? o.prevPrice.product : await stripe.products.retrieve(prevProductId)) as Obj;
      const md: Obj = prev?.metadata || {};
      const n = parseInt(md.plan_credits ?? "", 10);
      if (isOurApp(md.app) && planTier(md.tier) === current && Number.isFinite(n) && n > 0) fromCredits = n;
    } catch (err) {
      console.warn(`PREV_PRODUCT_UNREADABLE event=${event.id} product=${prevProductId}: ${(err as Error).message}`);
    }
  }
  const add = upgradeCredits({ fromPlan: current, toPlan: plan.tier, fromCredits, toCredits: plan.credits });
  if (!isKnownTier(plan.tier)) {
    await reportGrantFailure({ event, reason: "unknown_tier", uid, subId: sub.id, productId: plan.productId, details: { tier: plan.tier, credits: plan.credits } });
  }
  const key = upgradeKey(sub.id, current, plan.tier, subscriptionPeriod(sub).start, event.id);
  const result = await rpc("turn_adjust_plan_once", {
    event_id: key, uid, new_tier: plan.tier, add_credits: add ?? 0, sub_id: sub.id,
  });
  console.log(`PLAN_UPGRADE event=${event.id} key=${key} uid=${uid} from=${current} to=${plan.tier} add=${add} source=${source} result=${JSON.stringify(result)}`);
  const skipped = await grantSkipped(key, event);
  if (skipped) {
    console.warn(`PLAN_UPGRADE_REFUSED event=${event.id} key=${key} uid=${uid} sub=${sub.id} skipped=${skipped}`);
    return { skipped };
  }
  if (add == null) {
    // the plan is upgraded (the customer paid for it) but the credit difference couldn't be
    // worked out — the owner adds it by hand
    await reportGrantFailure({
      event, reason: "upgrade_credits_review", uid, subId: sub.id, productId: plan.productId,
      details: { from: current, to: plan.tier, to_credits: plan.credits, from_credits: fromCredits },
    });
  }
  await clearPendingTier(acct, event);
  return { skipped: null };
}

// ── checkout ────────────────────────────────────────────────────────────────────────────
async function onCheckout(event: Stripe.Event) {
  const s = event.data.object as unknown as Obj;
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  const uidRaw: string | null = s.client_reference_id ?? null;
  const customerId = idOf(s.customer);

  if (s.mode === "subscription") {
    const subId = idOf(s.subscription);
    if (!subId) { console.warn(`SKIP checkout_without_subscription event=${event.id} session=${s.id}`); return; }
    const sub = await retrieveSub(subId);
    if (!uidRaw || !isUuid(uidRaw)) {
      // Paid subscription with no usable app uid — we cannot credit anyone. Only flag it when
      // it's actually a Kinolot plan (other brands check out without a uid legitimately).
      const plan = readPlan(sub);
      if (plan.ok || plan.reason !== "other_app") {
        await reportGrantFailure({
          event, reason: uidRaw ? "invalid_client_reference_id" : "missing_client_reference_id",
          customerId, sessionId: s.id, subId: sub.id, productId: plan.productId, uid: uidRaw,
          details: plan.ok ? { tier: plan.tier, credits: plan.credits, payment_status: s.payment_status } : plan.details,
        });
      } else {
        console.warn(`SKIP other_app event=${event.id} product=${plan.productId} app=${JSON.stringify(plan.details?.app ?? null)}`);
      }
      return;
    }
    if (!paid) {
      console.log(`CHECKOUT_UNPAID event=${event.id} session=${s.id} status=${s.payment_status} — the plan is granted by invoice.paid once the payment clears`);
      return;
    }
    const plan = readPlan(sub);
    if (plan.ok) {
      await reportIfDuplicate({ event, acct: await accountByUid(uidRaw), subId: sub.id, uid: uidRaw, customerId, productId: plan.productId, details: { session: s.id } });
    }
    const invoiceId = idOf(s.invoice) || idOf(sub.latest_invoice);
    await grantPlan({
      event, uid: uidRaw, sub, customerId, key: planGrantKey(invoiceId, event.id),
      source: "checkout", sessionId: s.id,
    });
    return;
  }

  if (s.mode === "payment") {
    if (!uidRaw || !isUuid(uidRaw)) {
      // Only flag it when the payment actually contains a Kinolot pack.
      const items = await lineItems(s.id);
      if (sessionHasOurProduct(items)) {
        await reportGrantFailure({
          event, reason: uidRaw ? "invalid_client_reference_id" : "missing_client_reference_id",
          customerId, sessionId: s.id, uid: uidRaw, details: { payment_status: s.payment_status },
        });
      }
      return;
    }
    if (!paid) {
      console.log(`CHECKOUT_UNPAID event=${event.id} session=${s.id} status=${s.payment_status} — the pack is added on checkout.session.async_payment_succeeded`);
      return;
    }
    await grantPack(uidRaw, s, event);
  }
}

/** The charge behind a paid one-off Checkout Session (tied to the pack lot for refunds). */
async function chargeForSession(s: Obj): Promise<string | null> {
  const piId = idOf(s.payment_intent);
  if (!piId) return null;                                  // e.g. a 100% discount — nothing charged
  if (typeof s.payment_intent === "object" && s.payment_intent?.latest_charge) return idOf(s.payment_intent.latest_charge);
  const pi = await stripe.paymentIntents.retrieve(piId) as unknown as Obj;
  return idOf(pi?.latest_charge);
}

async function grantPack(uid: string, session: Obj, event: Stripe.Event) {
  const items = await lineItems(session.id);
  let credits = 0;
  let legacyCredits = 0;                 // of which: packs sold in the old unit
  let sawKinolotProduct = false;
  const badProducts: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const product = item.price?.product;
    const md: Obj = (product && typeof product === "object" && !("deleted" in product) ? product.metadata : null) || {};
    const pid = idOf(product);
    if (!isOurApp(md.app) && md.app) {
      console.warn(`SKIP other_app event=${event.id} product=${pid} app=${JSON.stringify(md.app)}`);
      if (looksLikeOurs(md)) {
        badProducts.push({ product_id: pid, app: md.app, kind: md.kind ?? null, pack_credits: md.pack_credits ?? null, suspect: true });
      }
    }
    if (isOurApp(md.app)) {
      sawKinolotProduct = true;
      const grant = readCreditPack(product);
      if (grant) {
        const n = grant * Math.max(1, item.quantity ?? 1);
        credits += n;
        if (isLegacyPack(md)) legacyCredits += n;
      }
      else badProducts.push({ product_id: pid, kind: md.kind ?? null, pack_credits: md.pack_credits ?? null });
    }
  }
  const customerId = idOf(session.customer);
  if (!credits) {
    const suspect = badProducts.some((b) => b.suspect);
    if (suspect && !sawKinolotProduct) {
      await reportGrantFailure({
        event, reason: "other_app_suspect", customerId, sessionId: session.id, uid,
        productId: (badProducts[0]?.product_id as string) ?? null,
        details: { bad_products: badProducts, line_items: items.length },
      });
      return;
    }
    if (sawKinolotProduct || items.length === 0) {
      // A Kinolot payment produced ZERO credits — never swallow this.
      await reportGrantFailure({
        event, reason: sawKinolotProduct ? "pack_zero_credits" : "no_line_items",
        customerId, sessionId: session.id, uid,
        productId: (badProducts[0]?.product_id as string) ?? null,
        details: { bad_products: badProducts, line_items: items.length },
      });
    }
    return;
  }
  const chargeId = await chargeForSession(session);
  const key = packGrantKey(session.id, event.id);
  // an OLD-unit pack granted after the switch day counts x3 (plan-metadata.mjs isLegacyPack): the
  // switch tripled every lot that existed when it ran, and a late grant must keep the same value.
  // ROUND 3 (S6): the DATABASE decides — legacy_unit => true makes turn_add_pack_once triple the
  // lot when turn__switched() is true, checked after it holds its locks, so a grant processed while
  // billing-switch.sql commits can't land untripled (the webhook used to read the regime first).
  let result: unknown;
  let note = "";
  let amountLabel = "credits";   // round 4 (S6): "credits_as_sold" when the database decides the lot
  if (legacyCredits > 0 && legacyCredits === credits) {
    const { data, error } = await admin.rpc("turn_add_pack_once", { event_id: key, uid, amount: credits, charge_id: chargeId, legacy_unit: true });
    if (!error) {
      result = data;
      // ROUND 4 (S6): `credits` is the amount AS SOLD here — the lot the database granted (x3 after
      // the switch) is read back from the event's result, so the log says what was really granted
      amountLabel = "credits_as_sold";
      note = ` legacy_pack=${legacyCredits} legacy_unit=true` + legacyPackLotNote(await packEventResult(key, event));
    } else if (isMissingFunctionError(error)) {
      // a database without the argument yet (billing SQL older than round 3): the webhook's own x3
      console.warn(`PACK_GRANT_LEGACY_FALLBACK event=${event.id} — turn_add_pack_once has no legacy_unit argument (${String(error.code || error.message || "").slice(0, 60)}); multiplying here`);
      ({ credits, result, note } = await grantPackOwnX3({ key, uid, credits, legacyCredits, chargeId }));
    } else {
      console.error("RPC_ERROR fn=turn_add_pack_once", error.message, JSON.stringify({ event_id: key, uid, amount: credits, charge_id: chargeId, legacy_unit: true }));
      throw error;
    }
  } else if (legacyCredits > 0) {
    // a cart that MIXES old and new packs (the app's single-pack links can't build one): only the
    // old part is tripled, which the one-amount database call can't express — the webhook's own x3
    ({ credits, result, note } = await grantPackOwnX3({ key, uid, credits, legacyCredits, chargeId }));
  } else {
    result = await rpc("turn_add_pack_once", { event_id: key, uid, amount: credits, charge_id: chargeId });
  }
  console.log(`PACK_GRANT event=${event.id} key=${key} uid=${uid} ${amountLabel}=${credits}${note} charge=${chargeId} result=${JSON.stringify(result)}`);
}

/** The pack event's turn_stripe_events.result (round 4, S6): {lot_credits, legacy_unit, x3}, or null
 *  when it can't be read (logged; the grant itself already happened). */
async function packEventResult(key: string, event: Stripe.Event): Promise<unknown> {
  try {
    const { data, error } = await admin.from("turn_stripe_events").select("result").eq("id", key).maybeSingle();
    if (error) { console.warn(`PACK_RESULT_UNREADABLE event=${event.id} key=${key}: ${error.message}`); return null; }
    return (data as Obj | null)?.result ?? null;
  } catch (e) {
    console.warn(`PACK_RESULT_UNREADABLE event=${event.id} key=${key}: ${String((e as Error)?.message || e).slice(0, 160)}`);
    return null;
  }
}

/** The webhook's OWN x3 for old-unit packs (a database without turn_add_pack_once's legacy_unit
 *  argument, or a mixed cart): reads turn_credit_regime() right before the grant. A regime the
 *  database can't answer is a 500 (Stripe retries), never a guess. */
async function grantPackOwnX3(a: { key: string; uid: string; credits: number; legacyCredits: number; chargeId: string | null }) {
  const switched = regimeSwitched(await rpc("turn_credit_regime", {}));
  if (switched === null) throw new Error("KINOLOT_BILLING: turn_credit_regime() gave no answer");
  const credits = switched ? (a.credits - a.legacyCredits) + packGrantCredits(a.legacyCredits, { legacy: true, switched: true }) : a.credits;
  const result = await rpc("turn_add_pack_once", { event_id: a.key, uid: a.uid, amount: credits, charge_id: a.chargeId });
  const note = ` legacy_pack=${a.legacyCredits}${switched ? " x3 (after the switch)" : " (before the switch: tripled with every lot on the switch day)"}`;
  return { credits, result, note };
}

// ── invoices ────────────────────────────────────────────────────────────────────────────
/** Where the subscription id sits depends on the endpoint's API version (see
 *  invoiceSubscriptionId); as a last resort ask the API, whose pinned SDK version (stripe@16)
 *  still returns invoice.subscription. */
async function subscriptionOfInvoice(inv: Obj): Promise<string | null> {
  let subId = invoiceSubscriptionId(inv);
  if (!subId && inv.id) subId = invoiceSubscriptionId(await stripe.invoices.retrieve(inv.id));
  return subId;
}

async function onInvoicePaid(event: Stripe.Event) {
  const inv = event.data.object as unknown as Obj;
  const reason = inv.billing_reason as string;
  if (!PLAN_BILLING_REASONS.includes(reason)) {
    console.log(`IGNORED invoice.paid event=${event.id} invoice=${inv.id} billing_reason=${reason}`);
    return;
  }
  const subId = await subscriptionOfInvoice(inv);
  const customerId = idOf(inv.customer);
  if (!subId) {
    await reportGrantFailure({
      event, reason: "renewal_without_subscription", customerId,
      details: { invoice_id: inv.id ?? null, billing_reason: reason },
    });
    return;
  }
  const sub = await retrieveSub(subId);
  const plan = readPlan(sub);
  if (!plan.ok && plan.reason === "other_app") {
    console.warn(`SKIP other_app event=${event.id} product=${plan.productId} app=${JSON.stringify(plan.details?.app ?? null)}`);
    return;
  }
  let acct = await accountByCustomer(customerId, event);
  let uid: string | null = acct?.owner ?? null;
  let checkoutFound = false;
  if (!uid && reason === "subscription_create") {
    // the first invoice can be processed before its checkout.session.completed
    const co = await checkoutForSubscription(subId);
    checkoutFound = co.found;
    uid = co.uid;
    if (uid) acct = await accountByUid(uid);
  }
  if (!uid) {
    if (checkoutFound) {
      // the checkout event records the missing/invalid client_reference_id — don't double it
      console.warn(`SKIP first_invoice_without_uid event=${event.id} invoice=${inv.id} sub=${subId}`);
    } else {
      await reportGrantFailure({
        event, reason: "unknown_customer", customerId, subId, productId: plan.productId,
        details: plan.ok ? { tier: plan.tier, credits: plan.credits, invoice_id: inv.id ?? null, billing_reason: reason } : plan.details,
      });
    }
    return;
  }
  if (!plan.ok) {
    await skipOrReport(plan, event, { uid, customerId, subId });
    return;
  }
  await reportIfDuplicate({ event, acct, subId, uid, customerId, productId: plan.productId, details: { invoice_id: inv.id ?? null, billing_reason: reason } });

  if (reason === "subscription_update") {
    // the proration invoice of a plan change: the upgrade path (never a reset to the full
    // allowance, which would refund the credits already used this period)
    if (!acct) {
      await reportGrantFailure({ event, reason: "plan_change_review", uid, customerId, subId, productId: plan.productId, details: { invoice_id: inv.id ?? null } });
      return;
    }
    const change = await reconcilePlanChange({ event, acct, sub, plan, source: "invoice.paid" });
    if (change.skipped) {
      console.warn(`PAYMENT_STATUS_UNCHANGED event=${event.id} uid=${uid} (the plan change was refused: ${change.skipped})`);
      return;
    }
    await setPaymentStatus(uid, "active", event);
    return;
  }
  await grantPlan({
    event, uid, sub, customerId, key: planGrantKey(inv.id, event.id), acct,
    source: reason === "subscription_cycle" ? "renewal" : "first_invoice",
  });
}

async function onInvoicePaymentFailed(event: Stripe.Event) {
  const inv = event.data.object as unknown as Obj;
  const subId = await subscriptionOfInvoice(inv);
  if (!subId) { console.log(`IGNORED invoice.payment_failed event=${event.id} invoice=${inv.id} (not a subscription invoice)`); return; }
  const sub = await retrieveSub(subId);
  const plan = readPlan(sub);
  if (!plan.ours) {
    console.warn(`SKIP payment_failed_not_kinolot event=${event.id} invoice=${inv.id} sub=${subId} (${plan.ok ? "" : plan.reason})`);
    return;
  }
  const acct = await accountByCustomer(idOf(inv.customer), event);
  if (!acct) { console.warn(`SKIP payment_failed_unknown_customer event=${event.id} customer=${idOf(inv.customer)} sub=${subId}`); return; }
  if (acct.stripe_sub_id && acct.stripe_sub_id !== subId) {
    console.warn(`SKIP payment_failed_other_subscription event=${event.id} uid=${acct.owner} sub=${subId} stored=${acct.stripe_sub_id}`);
    return;
  }
  console.warn(`PAYMENT_FAILED event=${event.id} uid=${acct.owner} invoice=${inv.id} attempt=${inv.attempt_count ?? "?"} next_attempt=${inv.next_payment_attempt ?? "none"}`);
  await setPaymentStatus(acct.owner, "past_due", event);
}

// ── subscriptions ───────────────────────────────────────────────────────────────────────
async function onSubscriptionUpdated(event: Stripe.Event) {
  const payload = event.data.object as unknown as Obj;
  const prev: Obj = ((event.data as unknown as Obj).previous_attributes) || {};
  if (!prev.items && !prev.plan) {
    console.log(`IGNORED customer.subscription.updated event=${event.id} sub=${payload.id} (no price change; changed: ${Object.keys(prev).join(",") || "-"})`);
    return;
  }
  const sub = await retrieveSub(payload.id);
  const plan = readPlan(sub);
  const customerId = idOf(sub.customer) ?? idOf(payload.customer);
  if (!plan.ok) { await skipOrReport(plan, event, { customerId, subId: sub.id }); return; }
  const acct = await accountByCustomer(customerId, event);
  if (!acct) {
    await reportGrantFailure({ event, reason: "unknown_customer", customerId, subId: sub.id, productId: plan.productId, details: { tier: plan.tier, credits: plan.credits } });
    return;
  }
  if (acct.stripe_sub_id && acct.stripe_sub_id !== sub.id) {
    // not the subscription the app's plan comes from — its price change isn't this plan's
    await reportIfDuplicate({ event, acct, subId: sub.id, uid: acct.owner, customerId, productId: plan.productId, details: { tier: plan.tier } });
    console.warn(`SKIP plan_change_other_subscription event=${event.id} uid=${acct.owner} sub=${sub.id} stored=${acct.stripe_sub_id}`);
    return;
  }
  if (!["active", "trialing"].includes(sub.status) || sub.pending_update) {
    // an unpaid change: the proration invoice's invoice.paid applies it once paid
    console.log(`PLAN_CHANGE_WAITING event=${event.id} uid=${acct.owner} sub=${sub.id} status=${sub.status}${sub.pending_update ? " pending_update" : ""}`);
    return;
  }
  // a proration invoice that isn't paid yet (card declined, 3-D Secure pending): its
  // invoice.paid applies the change once the money is in — never an unpaid upgrade
  const latestId = idOf(sub.latest_invoice);
  if (latestId) {
    const latest = (typeof sub.latest_invoice === "object" ? sub.latest_invoice : await stripe.invoices.retrieve(latestId)) as Obj;
    if (latest?.billing_reason === "subscription_update" && latest.status !== "paid") {
      console.log(`PLAN_CHANGE_WAITING event=${event.id} uid=${acct.owner} sub=${sub.id} proration=${latestId} status=${latest.status}`);
      return;
    }
  }
  const prevPrice = (prev.items?.data?.[0]?.price ?? null) as Obj | null;
  await reconcilePlanChange({ event, acct, sub, plan, prevPrice, source: "subscription.updated" });
}

async function onSubscriptionDeleted(event: Stripe.Event) {
  const payload = event.data.object as unknown as Obj;
  let sub: Obj = payload;
  try { sub = await retrieveSub(payload.id); }
  catch (err) { console.warn(`SUB_RETRIEVE_FAILED event=${event.id} sub=${payload.id}: ${(err as Error).message} — using the event payload`); }
  const plan = readPlan(sub);
  if (!plan.ok && plan.reason === "other_app") {
    console.warn(`SKIP other_app event=${event.id} product=${plan.productId} app=${JSON.stringify(plan.details?.app ?? null)}`);
    return;
  }
  const customerId = idOf(sub.customer) ?? idOf(payload.customer);
  const acct = await accountByCustomer(customerId, event);
  if (!acct) { console.warn(`SKIP subscription_deleted_unknown_customer event=${event.id} customer=${customerId} sub=${payload.id}`); return; }
  // the database ends the plan only when this is the stored subscription
  const result = await rpc("turn_end_plan_for_sub", { uid: acct.owner, sub_id: payload.id });
  console.log(`PLAN_END event=${event.id} uid=${acct.owner} sub=${payload.id} stored=${acct.stripe_sub_id ?? "-"} ${acct.stripe_sub_id === payload.id ? "matched" : "NOT the stored subscription (no change expected)"} result=${JSON.stringify(result)}`);
}

// ── refunds and disputes ────────────────────────────────────────────────────────────────
type ChargeInfo = { kind: "plan" | "pack" | "other"; uid: string | null; subId?: string | null; invoiceId?: string | null; sessionId?: string | null; customerId?: string | null };

/** Whose purchase a charge was, and of what: a Kinolot plan invoice, a Kinolot pack checkout,
 *  or something else on the account (Academy, mentorships) that the app must not touch. */
async function describeCharge(chargeIn: Obj, event: Stripe.Event): Promise<ChargeInfo> {
  let ch = chargeIn;
  // from basil on a Charge no longer names its invoice; the SDK's pinned version still does
  if (ch.invoice === undefined && ch.id) ch = await stripe.charges.retrieve(ch.id) as unknown as Obj;
  const customerId = idOf(ch.customer);
  const invoiceId = idOf(ch.invoice);
  if (invoiceId) {
    const inv = await stripe.invoices.retrieve(invoiceId) as unknown as Obj;
    const subId = invoiceSubscriptionId(inv);
    if (!subId) return { kind: "other", uid: null, invoiceId, customerId };
    const sub = await retrieveSub(subId);
    if (!readPlan(sub).ours) return { kind: "other", uid: null, invoiceId, subId, customerId };
    const acct = await accountByCustomer(idOf(inv.customer) ?? customerId, event);
    return { kind: "plan", uid: acct?.owner ?? null, invoiceId, subId, customerId };
  }
  const piId = idOf(ch.payment_intent);
  if (piId) {
    const list = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
    const s = (list?.data?.[0] ?? null) as Obj | null;
    if (s && sessionHasOurProduct(await lineItems(s.id))) {
      return { kind: "pack", uid: isUuid(s.client_reference_id) ? s.client_reference_id : null, sessionId: s.id, customerId };
    }
  }
  return { kind: "other", uid: null, customerId };
}

/** What turn_revoke_charge_once matches for a charge. A pack lot carries its charge id
 *  (turn_add_pack_once), but a plan grant carries only its idempotency key — "invoice:<id>",
 *  the key turn_set_plan_once was given — so a plan payment is revoked by that key. */
function revokeKey(info: ChargeInfo, chargeId: string): string {
  return info.kind === "plan" && info.invoiceId ? `invoice:${info.invoiceId}` : chargeId;
}

async function onChargeRefunded(event: Stripe.Event) {
  const ch = event.data.object as unknown as Obj;
  const state = refundState(ch);
  if (state === "none") { console.log(`IGNORED charge.refunded event=${event.id} charge=${ch.id} (nothing refunded)`); return; }
  const info = await describeCharge(ch, event);
  if (info.kind === "other") { console.warn(`SKIP refund_not_kinolot event=${event.id} charge=${ch.id}`); return; }
  if (state === "partial") {
    // a goodwill partial refund must not wipe the whole purchase — the owner decides
    await reportGrantFailure({
      event, reason: "partial_refund_review", uid: info.uid, customerId: info.customerId ?? null,
      subId: info.subId ?? null, sessionId: info.sessionId ?? null,
      details: { charge_id: ch.id, kind: info.kind, amount: ch.amount ?? null, amount_refunded: ch.amount_refunded ?? null, currency: ch.currency ?? null },
    });
    return;
  }
  const removed = await rpc("turn_revoke_charge_once", { event_id: event.id, charge_id: revokeKey(info, ch.id) });
  console.warn(`REFUND_REVOKE event=${event.id} charge=${ch.id} kind=${info.kind} uid=${info.uid} removed=${JSON.stringify(removed)} key=${revokeKey(info, ch.id)}`);
  if (info.kind === "plan" && !(Number(removed) > 0)) {
    // nothing was linked to this plan payment in the database — check the plan credits by hand
    await reportGrantFailure({
      event, reason: "refund_plan_review", uid: info.uid, customerId: info.customerId ?? null, subId: info.subId ?? null,
      details: { charge_id: ch.id, invoice_id: info.invoiceId ?? null, removed },
    });
  }
}

async function disputeContext(event: Stripe.Event): Promise<{ d: Obj; chargeId: string | null; info: ChargeInfo | null }> {
  const d = event.data.object as unknown as Obj;
  const chargeId = idOf(d.charge);
  if (!chargeId) return { d, chargeId: null, info: null };
  const ch = (typeof d.charge === "object" ? d.charge : await stripe.charges.retrieve(chargeId)) as Obj;
  return { d, chargeId, info: await describeCharge(ch, event) };
}

async function onDisputeCreated(event: Stripe.Event) {
  const { d, chargeId, info } = await disputeContext(event);
  if (!info || info.kind === "other") { console.warn(`SKIP dispute_not_kinolot event=${event.id} dispute=${d.id} charge=${chargeId}`); return; }
  if (!info.uid) {
    await reportGrantFailure({ event, reason: "dispute_unknown_account", customerId: info.customerId ?? null, subId: info.subId ?? null, sessionId: info.sessionId ?? null, details: { dispute_id: d.id, charge_id: chargeId, kind: info.kind } });
    return;
  }
  await rpc("turn_set_frozen", { uid: info.uid, frozen: true, reason: `dispute ${d.id} (${d.reason ?? "unknown"}) on charge ${chargeId}` });
  console.warn(`ACCOUNT_FROZEN event=${event.id} uid=${info.uid} dispute=${d.id} charge=${chargeId} kind=${info.kind}`);
}

async function onDisputeClosed(event: Stripe.Event) {
  const { d, chargeId, info } = await disputeContext(event);
  if (!info || info.kind === "other") { console.warn(`SKIP dispute_not_kinolot event=${event.id} dispute=${d.id} charge=${chargeId}`); return; }
  const outcome = disputeOutcome(d.status);
  if (!info.uid) {
    await reportGrantFailure({ event, reason: "dispute_unknown_account", customerId: info.customerId ?? null, details: { dispute_id: d.id, charge_id: chargeId, status: d.status ?? null } });
    return;
  }
  if (outcome === "unfreeze") {
    await rpc("turn_set_frozen", { uid: info.uid, frozen: false, reason: `dispute ${d.id} ${d.status}` });
    console.log(`ACCOUNT_UNFROZEN event=${event.id} uid=${info.uid} dispute=${d.id} status=${d.status}`);
    return;
  }
  if (outcome === "lost") {
    const removed = await rpc("turn_revoke_charge_once", { event_id: event.id, charge_id: revokeKey(info, chargeId!) });
    await reportGrantFailure({
      event, reason: "dispute_lost", uid: info.uid, customerId: info.customerId ?? null, subId: info.subId ?? null, sessionId: info.sessionId ?? null,
      details: { dispute_id: d.id, charge_id: chargeId, kind: info.kind, removed, note: "account stays frozen until the owner unfreezes it" },
    });
    return;
  }
  console.log(`IGNORED charge.dispute.closed event=${event.id} dispute=${d.id} status=${d.status}`);
}

// ── entry ───────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Bad signature: ${(err as Error).message}`, { status: 400 });
  }
  console.log(`STRIPE_EVENT id=${event.id} type=${event.type} livemode=${event.livemode} api=${event.api_version ?? "?"}`);

  // a live endpoint with a test key (or the reverse) can't look anything up — say so loudly
  if (KEY_MODE && typeof event.livemode === "boolean" && (event.livemode ? "live" : "test") !== KEY_MODE) {
    await reportGrantFailure({ event, reason: "mode_mismatch", details: { event_livemode: event.livemode, key_mode: KEY_MODE } });
    return new Response("mode mismatch", { status: 500 });   // retried once the secret is fixed
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await onCheckout(event); break;
      case "invoice.paid":
        await onInvoicePaid(event); break;
      case "invoice.payment_failed":
        await onInvoicePaymentFailed(event); break;
      case "customer.subscription.updated":
        await onSubscriptionUpdated(event); break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(event); break;
      case "charge.refunded":
        await onChargeRefunded(event); break;
      case "charge.dispute.created":
        await onDisputeCreated(event); break;
      case "charge.dispute.closed":
        await onDisputeClosed(event); break;
      default:
        console.log(`IGNORED type=${event.type} event=${event.id}`);
    }
  } catch (err) {
    const e = err as Obj;
    if (e?.code === "23503" || /KINOLOT_BILLING: no account/.test(String(e?.message ?? ""))) {
      // a foreign-key violation: the client_reference_id is a well-formed uuid of no account (a
      // deleted user, a hand-edited link). A retry can never succeed — record it and answer 200.
      await reportGrantFailure({ event, reason: "unknown_user", details: { message: e.message ?? null, details: e.details ?? null } });
      return new Response("ok (recorded)", { status: 200 });
    }
    console.error(`handler error event=${event.id} type=${event.type}:`, e?.message);
    return new Response("handler error", { status: 500 });   // Stripe will retry
  }

  return new Response("ok", { status: 200 });
});

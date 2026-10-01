/* plan-metadata.mjs — which Stripe products are Kinolot's, and what plan id a product's
   `tier` stands for. Pure (no Deno or Stripe imports): index.ts uses it, and
   scripts/test-stripe-metadata.mjs tests it in Node.

   Owner decision 2026-09-29: Kinolot's products carry `app=kinolot`. Products made before
   the rebrand carry the old codename `app=cinema-machine`; both are ours. Anything else
   (Academy courses, mentorships, other brands on the same Stripe account) is ignored.

   The Producer plan is labelled `tier=producer` in Stripe, but its plan id stays "studio"
   everywhere else (turn_credits.plan, image-proxy, blender-bridge and the app all check
   "studio"; "Producer" is a display name since 2026-09-28). So `producer` is stored as
   "studio". The legacy Director id `pro` is stored as "director" (the server gates only
   accept writer / director / studio). Any other tier passes through unchanged.

   Billing fixes 2026-09-30 add the pure rules the webhook's new events need: plan ranks and
   allowances (upgrade = allowance difference now, downgrade = at the next renewal), the
   idempotency keys, refund / dispute outcomes, the Stripe key's mode, and period dates that
   read both the old and the basil/dahlia subscription shape. 2026-10-01 (D4): a closed dispute
   lifts only the hold it placed (disputeHoldReason / disputeHoldAfterClose). The sales ledger's
   and the partial refunds' pure rules are in sales-ledger.mjs. */
export const OUR_APPS = Object.freeze(["kinolot", "cinema-machine"]);
const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** true when a product's `app` metadata names Kinolot (new or old label). */
export function isOurApp(app) {
  return OUR_APPS.includes(norm(app));
}

const TIER_ALIASES = Object.freeze({ producer: "studio", pro: "director" });

/** Stripe `tier` metadata -> the plan id the database and servers use. */
export function planTier(tier) {
  const k = norm(tier);
  return TIER_ALIASES[k] || k || "member";
}

/* The plan ids the gates know (app/plans.jsx TIER_GATES, image-proxy and blender-bridge paid
   checks); "pro" is the legacy Director id. A plan outside this list still gets its credits,
   but the webhook records it (reason unknown_tier) — every gate would treat that payer as
   unpaid, so a mistyped tier must never pass silently. */
export const KNOWN_TIERS = Object.freeze(["writer", "director", "studio", "pro"]);
export function isKnownTier(planId) {
  return KNOWN_TIERS.includes(norm(planId));
}

/** metadata that looks like one of OUR products even though `app` isn't ours (a typo such as
    app=kino-lot, or a product copied without `app`): plan or pack credit fields. */
export function looksLikeOurs(md) {
  return !!md && (md.plan_credits != null || md.pack_credits != null || norm(md.kind) === "credit_pack");
}

/** The subscription an invoice belongs to, across Stripe API versions. Before 2025-03-31.basil
    it is invoice.subscription; from basil on it moved to invoice.parent.subscription_details
    .subscription — and the live endpoint is on 2026-03-25.dahlia (owner's dashboard,
    2026-09-30), so reading only the old field skipped every renewal silently. Accepts an id
    string or an expanded object; null when neither is present. */
export function invoiceSubscriptionId(inv) {
  if (!inv || typeof inv !== "object") return null;
  const pick = (v) => (typeof v === "string" && v) ? v
    : (v && typeof v === "object" && typeof v.id === "string" && v.id) ? v.id : null;
  const details = inv.parent && typeof inv.parent === "object" ? inv.parent.subscription_details : null;
  return pick(inv.subscription) || pick(details && details.subscription) || null;
}

/* ── billing fixes 2026-09-30 ──────────────────────────────────────────────────────────── */

/** An object's Stripe id, whether the field holds the id or the expanded object; null when absent. */
export function idOf(v) {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object" && typeof v.id === "string" && v.id) return v.id;
  return null;
}

/** The app's user ids are Supabase uuids. A checkout whose client_reference_id is anything
    else can't be credited (it would fail in the database on every Stripe retry). */
export function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** "live" / "test" from the Stripe secret (or restricted) key; null when it can't be told. */
export function stripeKeyMode(key) {
  const k = typeof key === "string" ? key.trim() : "";
  if (/^(sk|rk)_live_/.test(k)) return "live";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  return null;
}

/** Plan order for upgrade / downgrade. 0 = no paid plan (none, member, unknown). */
const TIER_RANK = Object.freeze({ writer: 1, director: 2, studio: 3 });
export function tierRank(planId) {
  return TIER_RANK[planTier(planId)] || 0;
}

/** "upgrade" | "downgrade" | "same" | "unknown" (either side isn't a paid plan). */
export function planChange(fromPlan, toPlan) {
  const a = tierRank(fromPlan), b = tierRank(toPlan);
  if (!a || !b) return "unknown";
  return b > a ? "upgrade" : b < a ? "downgrade" : "same";
}

/* Monthly allowances by plan, in the two credit units the Stripe `plan_credits` metadata can be
   in. Option A (owner decision 2026-09-30): 1 credit = $0.01 of provider cost, Writer 600 /
   Director 1,600 / Producer 5,000 for new subscribers. Before the switch the products carry the
   old units (1 credit = $0.03): 800 / 2,400 / 9,000. Used only when an upgrade's previous plan
   can't be read from Stripe: the table the NEW plan's metadata belongs to gives the old plan's
   allowance in the same units. Grandfathered renewals (old allowance x3 until 30 days after the
   switch) are applied by the database (turn_set_plan_once), not here. */
export const ALLOWANCE_TABLES = Object.freeze([
  Object.freeze({ units: "option-a", writer: 600, director: 1600, studio: 5000 }),
  Object.freeze({ units: "pre-switch", writer: 800, director: 2400, studio: 9000 }),
]);

/** Credits to add now for an upgrade: new allowance minus the old one, never below 0 and never
    more than the new allowance. fromCredits (the previous product's plan_credits) wins when it
    is known; otherwise the allowance table the new plan's credits match. null = can't be worked
    out (the webhook records it for the owner and adds nothing). */
export function upgradeCredits({ fromPlan, toPlan, fromCredits, toCredits }) {
  const to = Number(toCredits);
  if (!Number.isFinite(to) || to <= 0) return null;
  let from = Number.isFinite(fromCredits) && fromCredits >= 0 ? Number(fromCredits) : null;
  if (from == null) {
    const f = planTier(fromPlan), t = planTier(toPlan);
    const table = ALLOWANCE_TABLES.find((tb) => tb[t] === to);
    if (!table || !Number.isFinite(table[f])) return null;
    from = table[f];
  }
  return Math.max(0, Math.min(to, Math.round(to - from)));
}

/** A subscription's current period (unix seconds + ISO end). Reads the old top-level fields
    (what stripe@16 returns) and, from basil on, the first item's fields (what dahlia event
    payloads carry). Nulls when neither is there - never 1970. */
export function subscriptionPeriod(sub) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const item = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const start = num(sub && sub.current_period_start) ?? num(item && item.current_period_start);
  const end = num(sub && sub.current_period_end) ?? num(item && item.current_period_end);
  return { start, end, endIso: end ? new Date(end * 1000).toISOString() : null };
}

/* Idempotency keys (the *_once functions apply a key once):
   - a plan grant is keyed by its INVOICE, so the first purchase is granted once although both
     checkout.session.completed and invoice.paid (subscription_create) report it, in any order;
   - a pack by its Checkout Session (completed, or async_payment_succeeded for delayed methods);
   - an upgrade by subscription + from/to plan + period, shared by customer.subscription.updated
     and the proration invoice's invoice.paid (subscription_update).
   The Stripe event id is the fallback when the object id is missing. */
export function planGrantKey(invoiceId, eventId) {
  return invoiceId ? `invoice:${invoiceId}` : eventId;
}
export function packGrantKey(sessionId, eventId) {
  return sessionId ? `checkout:${sessionId}` : eventId;
}
export function upgradeKey(subId, fromPlan, toPlan, periodStart, eventId) {
  return `upgrade:${subId}:${planTier(fromPlan)}>${planTier(toPlan)}:${periodStart || eventId}`;
}

/** Invoice billing reasons that grant or change a plan. */
export const PLAN_BILLING_REASONS = Object.freeze(["subscription_create", "subscription_cycle", "subscription_update"]);

/** "full" | "partial" | "none" for a charge.refunded payload (old and new shapes alike). */
export function refundState(charge) {
  if (!charge || typeof charge !== "object") return "none";
  const amount = Number(charge.amount) || 0, refunded = Number(charge.amount_refunded) || 0;
  if (charge.refunded === true || (amount > 0 && refunded >= amount)) return "full";
  return refunded > 0 ? "partial" : "none";
}

/** What a closed dispute means for the account: won / inquiry closed -> unfreeze; lost -> the
    purchase's unspent credits are taken back, then the hold is lifted too (owner decision
    2026-10-01, D4: a closed dispute, won or lost, lifts the hold it placed). */
export function disputeOutcome(status) {
  const s = norm(status);
  if (s === "won" || s === "warning_closed") return "unfreeze";
  if (s === "lost") return "lost";
  return "none";
}

/* ── D4 (2026-10-01): one hold per open dispute ─────────────────────────────────────────────
   turn_set_frozen keeps ONE reason per account. A customer often disputes several payments at
   once (a stolen card used for a plan and packs), and the first dispute to close must not lift
   the hold while another is still open — nor a hold that was there before any dispute. So the
   reason lists every hold, " | " between them ("dispute dp_1 (fraudulent) on charge ch_1 |
   dispute dp_2 (general) on charge ch_2"); a closing dispute removes its own part and the hold
   is lifted only when nothing is left. */
export const HOLD_SEPARATOR = " | ";
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function namesDispute(text, disputeId) {
  return !!disputeId && new RegExp(`\\bdispute ${escapeRe(disputeId)}(?![A-Za-z0-9_])`).test(String(text || ""));
}

/** The reason to freeze with when dispute `disputeId` opens: its own part alone on an account that
    isn't held; added to the reasons already there on a held one (once — a resend changes nothing);
    a held account with no reason keeps a marker for that earlier hold. */
export function disputeHoldReason(acct, part, disputeId) {
  const held = !!(acct && acct.frozen);
  const existing = held && typeof acct.frozen_reason === "string" ? acct.frozen_reason.trim() : "";
  if (!held) return part;
  if (namesDispute(existing, disputeId)) return existing;
  return (existing || "earlier hold (no reason given)") + HOLD_SEPARATOR + part;
}

/** What closing dispute `disputeId` does to the hold:
      { action: "lift" }                       nothing else holds the account (or it isn't held)
      { action: "keep", remaining: "<rest>" }  other holds remain: freeze with just those
      { action: "review", remaining: "<all>" } the account is held but not by this dispute — left
                                               alone and recorded for the owner */
export function disputeHoldAfterClose(acct, disputeId) {
  if (!acct || !acct.frozen) return { action: "lift" };
  const reason = typeof acct.frozen_reason === "string" ? acct.frozen_reason.trim() : "";
  const parts = reason ? reason.split(HOLD_SEPARATOR).map((p) => p.trim()).filter(Boolean) : [];
  const rest = parts.filter((p) => !namesDispute(p, disputeId));
  if (!rest.length && parts.length) return { action: "lift" };
  if (rest.length === parts.length) return { action: "review", remaining: reason || null };
  return { action: "keep", remaining: rest.join(HOLD_SEPARATOR) };
}

/* ── round 2 (2026-09-30): packs sold in the OLD unit ────────────────────────────────────────
   The three packs on sale before the switch day (300 / 1,200 / 4,000 credits — $9 / $29 / $79)
   are counted in the old unit (1 credit = $0.03). billing-switch.sql triples every lot that
   exists when it runs, but an old pack whose grant is processed AFTER the switch (a checkout
   finished in the minutes before the owner deactivated the links, a session opened earlier, or a
   delivery Stripe retries for up to 3 days) would otherwise land as 300 new-unit credits — a third
   of what was paid for. Such a grant counts LEGACY_PACK_FACTOR times once the switch has run.
   ROUND 3 (S6): the DATABASE decides that — turn_add_pack_once(…, legacy_unit => true) triples
   the lot when turn__switched() is true, checked after it holds its locks, atomically with the
   insert (a grant landing while billing-switch.sql commits can't slip through untripled). The
   webhook multiplies by itself only against a database that lacks the argument
   (isMissingFunctionError) and for a cart that mixes old and new packs. An old pack is
   recognised by its METADATA:
     unit=legacy (or pre-switch)        an explicit label wins; any other unit label means a new pack
     app=cinema-machine                 every pre-rebrand product predates the new unit
     pack_credits = 300 / 1200 / 4000   the old packs' credit numbers (the new ones are 250 / 1000 / 3000)
   — never by the amount charged. */
export const LEGACY_PACK_CREDITS = Object.freeze([300, 1200, 4000]);
export const LEGACY_PACK_FACTOR = 3;

/** true when a credit-pack product's metadata marks it as a pre-switch (old-unit) pack. */
export function isLegacyPack(md) {
  if (!md || typeof md !== "object") return false;
  const unit = norm(md.unit);
  if (unit === "legacy" || unit === "pre-switch") return true;
  if (unit) return false;
  if (norm(md.app) === "cinema-machine") return true;
  return LEGACY_PACK_CREDITS.includes(parseInt(md.pack_credits ?? "", 10));
}

/** The credits a pack grants now: an old-unit pack granted after the switch counts x3. */
export function packGrantCredits(credits, { legacy = false, switched = false } = {}) {
  const n = Math.max(0, Math.floor(Number(credits) || 0));
  return legacy && switched ? n * LEGACY_PACK_FACTOR : n;
}

/** turn_credit_regime()'s answer → true once the switch has run, false before, null unreadable. */
export function regimeSwitched(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof row.switched !== "boolean") {
    if (row && typeof row === "object" && (row.switched === "true" || row.switched === "t")) return true;
    if (row && typeof row === "object" && (row.switched === "false" || row.switched === "f")) return false;
    return null;
  }
  return row.switched;
}

/**
 * true when a database call failed because the function — with the arguments it was called with —
 * doesn't exist: PostgREST's PGRST202 ("Could not find the function … in the schema cache", what
 * supabase-js returns for a call with an argument the function lacks) or Postgres's 42883
 * ("function … does not exist"). Round 3 (S6): only this falls back to the four-argument
 * turn_add_pack_once; any other error is a 500 (Stripe retries).
 */
export function isMissingFunctionError(err) {
  if (!err || typeof err !== "object") return false;
  const code = String(err.code ?? "").trim().toUpperCase();
  if (code === "PGRST202" || code === "42883") return true;
  if (code) return false;
  return /could not find the function|function [^\s]+(\(.*\))? does not exist/i.test(String(err.message ?? ""));
}

/**
 * What the database granted for an old-unit pack (round 4, S6), from the pack event's
 * turn_stripe_events.result — {"lot_credits": n, "legacy_unit": true, "x3": bool}, written by
 * turn_add_pack_once under its locks — as the PACK_GRANT log's words:
 *   " lot_credits=900 x3=true"                                  the database's own answer
 *   " lot_credits=unknown (the database triples it after the switch)"   no readable result
 * so the owner reads from the log whether a late old pack was tripled, without a query.
 */
export function legacyPackLotNote(result) {
  const r = result && typeof result === "object" && !Array.isArray(result) ? result : null;
  const lot = r ? Number(r.lot_credits) : NaN;
  if (!r || !Number.isFinite(lot) || lot < 1) return " lot_credits=unknown (the database triples it after the switch)";
  const x3 = r.x3 === true || r.x3 === "true" ? "true" : r.x3 === false || r.x3 === "false" ? "false" : "unknown";
  return ` lot_credits=${Math.floor(lot)} x3=${x3}`;
}

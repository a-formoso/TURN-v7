/* plan-metadata.mjs — which Stripe products are Kinolot's, and what plan id a product's
   `tier` stands for. Pure (no Deno or Stripe imports): index.ts uses it, and
   scripts/test-stripe-metadata.mjs tests it in Node.

   Owner decision 2026-09-29: Kinolot's products carry `app=kinolot`. Products made before
   the rebrand carry the old codename `app=cinema-machine`; both are ours. Anything else
   (Academy courses, mentorships, other brands on the same Stripe account) is ignored.

   The Producer plan is labelled `tier=producer` in Stripe, but its plan id stays "studio"
   everywhere else (turn_credits.plan, image-proxy, blender-bridge and the app all check
   "studio"; "Producer" is a display name since 2026-09-28). So `producer` is stored as
   "studio". Any other tier passes through unchanged. */
export const OUR_APPS = Object.freeze(["kinolot", "cinema-machine"]);
const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** true when a product's `app` metadata names Kinolot (new or old label). */
export function isOurApp(app) {
  return OUR_APPS.includes(norm(app));
}

const TIER_ALIASES = Object.freeze({ producer: "studio" });

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

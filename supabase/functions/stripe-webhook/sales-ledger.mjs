/* sales-ledger.mjs — the pure rules behind the sales ledger the tax monitor reads (owner decisions
   2026-10-01, D1) and the proportional partial refunds (D3). No Deno or Stripe imports: index.ts
   uses it, and scripts/test-stripe-metadata.mjs tests it in Node.

   THE LEDGER (public.turn_sales_ledger, supabase/tax-compliance.sql): one row per successful payment
   on the Stripe account — every product, Kinolot's and the other apps' (they share the account and
   the same legal person, so they all count toward UK VAT turnover) — and one NEGATIVE row per refund.
   Keys (turn_record_sale_once inserts a key once):
     invoice:<invoice id>    invoice.paid (plans, and any other app's invoices)
     checkout:<session id>   a paid one-off Checkout Session (packs, other apps' one-off sales);
                             a session that also made an invoice uses invoice:<that id>, so the
                             invoice.paid for it can't count the same money twice
     refund:<refund id>      charge.refunded, one row per refund (amount negative)
   The amount is what Stripe says was PAID (gross, in the smallest currency unit, tax included once
   tax is charged): counting gross never under-states turnover, which is the safe side for a
   registration-threshold warning. A $0 payment (100% coupon, a trial invoice) is not a sale.

   WHERE THE CUSTOMER IS: the first ISO-3166 country found, in this order, is recorded with its
   source (country_source):
     invoice_address    invoice.customer_address               (invoices)
     checkout_address   checkout session customer_details.address (one-off checkouts)
     customer_address   the Stripe customer's address
     billing_address    the charge's billing_details.address
     card_country       the card's issuing country (payment_method_details.card.country)
   For a US customer the state (region) comes from the first US address that has one. No country
   at all -> country null (the panel counts those and tells the owner to turn on billing-address
   collection). A refund looks its customer up the same way as the payment it refunds; only a
   SUCCEEDED refund is recorded (a pending one when it succeeds: countableRefund). */

export const SALE_KINDS = Object.freeze(["plan", "pack", "other", "refund"]);
export const SALE_APPS = Object.freeze(["kinolot", "other"]);
/** The ledger's app tag: "kinolot" for Kinolot's products (plan-metadata.mjs isOurApp), "other" for
 *  everything else on the account. */
export function saleApp(ours) { return ours ? SALE_APPS[0] : SALE_APPS[1]; }
export const COUNTRY_SOURCES = Object.freeze(["invoice_address", "checkout_address", "customer_address", "billing_address", "card_country"]);

/** "GB" from " gb "; null for anything that isn't two letters. */
export function normCountry(v) {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/* US states + DC + the territories with their own postal code (the economic-nexus monitor is per
   state). A full name is accepted too (addresses typed by hand through the API). */
const US_STATE_NAMES = Object.freeze({
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  PR: "puerto rico", GU: "guam", VI: "virgin islands", AS: "american samoa", MP: "northern mariana islands",
});
export const US_STATE_CODES = Object.freeze(Object.keys(US_STATE_NAMES));
const US_BY_NAME = Object.freeze(Object.fromEntries(Object.entries(US_STATE_NAMES).map(([c, n]) => [n, c])));

/** "CA" from "ca" / "California" / "US-CA"; null when it isn't a US state or territory. */
export function normUsState(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^US-/i, "");
  const up = s.toUpperCase();
  if (US_STATE_NAMES[up]) return up;
  return US_BY_NAME[s.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "")] || null;
}

/**
 * Where a sale happened, from candidates in order of preference — each { source, address } (an
 * address with country / state) or { source, country } (a bare country, e.g. the card's).
 * country / country_source: the first candidate with a valid country. region: for a US sale, the
 * state of the first US address that has one. complete: nothing later in the list can change the
 * answer (a country, and for the US a state) — the caller stops looking things up.
 */
export function saleLocation(cands) {
  let country = null, source = null, region = null;
  for (const c of Array.isArray(cands) ? cands : []) {
    if (!c || typeof c !== "object") continue;
    const addr = c.address && typeof c.address === "object" ? c.address : null;
    const cc = normCountry(addr ? addr.country : c.country);
    if (!cc) continue;
    if (!country) { country = cc; source = typeof c.source === "string" ? c.source : null; }
    if (country === "US" && cc === "US" && !region && addr) region = normUsState(addr.state);
  }
  return { country, region: country === "US" ? region : null, country_source: source, complete: !!country && (country !== "US" || !!region) };
}

/** A whole number of the smallest currency unit, or null. */
export function saleAmountCents(v) {
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/** Unix seconds -> ISO time; null when absent. */
export function unixToIso(t) {
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** The ledger keys (see the header). */
export function invoiceSaleKey(invoiceId) { return invoiceId ? `invoice:${invoiceId}` : null; }
export function checkoutSaleKey(session) {
  if (!session || typeof session !== "object") return null;
  const inv = typeof session.invoice === "string" ? session.invoice : session.invoice && session.invoice.id;
  if (inv) return `invoice:${inv}`;
  return session.id ? `checkout:${session.id}` : null;
}
export function refundSaleKey(refundId) { return refundId ? `refund:${refundId}` : null; }

/** A refund that gave money back: SUCCEEDED (an old payload without a status counts). Only these
 *  remove credits and write a negative ledger row. A PENDING refund (bank transfers, some wallets)
 *  may still fail or be canceled, so it waits: charge.refund.updated applies it once
 *  it succeeds. Failed, canceled and requires_action refunds returned nothing. */
export function countableRefund(r) {
  if (!r || typeof r !== "object" || !r.id) return false;
  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return r.status == null || r.status === "succeeded";
}

/** A refund still on its way (status pending or requires_action): applied when it succeeds. */
export function pendingRefund(r) {
  if (!r || typeof r !== "object" || !r.id || !(Number(r.amount) > 0)) return false;
  return r.status === "pending" || r.status === "requires_action";
}

/**
 * What a partial refund's share is measured against (D3). A pack: the charge. A plan payment: the
 * INVOICE total when it is larger than the charge — part of the invoice was paid from the customer's
 * Stripe balance (an "always invoice" downgrade leaves a credit the next renewal uses), and the month's
 * credits came from the whole invoice, so a refund of part of the charge is that part of the invoice.
 */
export function refundBaseCents(kind, chargeCents, invoiceTotalCents) {
  const c = Number(chargeCents), t = Number(invoiceTotalCents);
  const charge = Number.isInteger(c) && c > 0 ? c : null;
  if (kind === "plan" && Number.isInteger(t) && t > 0 && (charge == null || t > charge)) return t;
  return charge;
}

/**
 * The share of a payment a refund gives back, for turn_revoke_charge_once's refund_fraction (D3):
 * refund / charge, cut DOWN to 12 decimals with exact integer arithmetic, so the number sent is never
 * above the true share and the database's ceil(fraction x granted) is exact for any real payment
 * (a 1,000-credit pack refunded $10 of $35 -> 0.285714285714 -> 286 credits). 1 when the refund is the
 * whole charge or more; null when it can't be worked out (no amount, no charge amount).
 */
export function refundFraction(refundCents, chargeCents) {
  const a = Number(refundCents), b = Number(chargeCents);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0) return null;
  if (a >= b) return 1;
  const k = (BigInt(a) * 1000000000000n) / BigInt(b);
  return k > 0n ? Number(k) / 1e12 : null;
}

/** The product ids on an invoice's lines, in both API shapes (line.price.product before basil;
 *  line.pricing.price_details.product from basil on; line.plan.product on very old invoices). */
export function invoiceLineProductIds(inv) {
  const lines = inv && inv.lines && Array.isArray(inv.lines.data) ? inv.lines.data : [];
  const id = (v) => (typeof v === "string" && v) ? v : (v && typeof v === "object" && typeof v.id === "string" && v.id) ? v.id : null;
  const out = [];
  for (const l of lines) {
    if (!l || typeof l !== "object") continue;
    const p = id(l.price && l.price.product) || id(l.pricing && l.pricing.price_details && l.pricing.price_details.product) || id(l.plan && l.plan.product);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** "SALE_RECORDED …" log words for one ledger row (the owner greps the function logs for these). */
export function saleLogFields(row) {
  const r = row || {};
  return `key=${r.source_key} app=${r.app} kind=${r.kind} amount=${r.amount_cents} ${r.currency || "?"} country=${r.country || "unknown"}`
    + `${r.region ? ` region=${r.region}` : ""} source=${r.country_source || "none"}`;
}

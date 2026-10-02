/* customer-email.mjs — the Stripe customer's email follows the account's (owner decision
   2026-10-02, E2). Pure (no Deno or Stripe imports): index.ts uses it, and
   scripts/test-stripe-metadata.mjs tests it in Node (the handler itself in
   scripts/test-stripe-webhook.mjs, section L).

   Why: a customer who signed up with one email paid with Apple Pay, and Stripe stored the
   WALLET's email on the customer it created — so renewal receipts and invoices would go to an
   address the user never gave the app. The credits were right (the webhook maps a checkout to
   the account by client_reference_id, never by email); only the customer's email was wrong.
   The app now prefills Checkout's email with the account's (prefilled_email), and the webhook,
   after a paid Kinolot checkout was credited to that account, puts the account's CONFIRMED email
   on the Stripe customer when the two differ (case-insensitive).

   Logs never carry a whole address: maskEmail() for the two emails, scrubEmails() for any error
   text (Stripe's own messages can quote the address, e.g. "Invalid email address: …"). */

/** Stripe's limit for a customer's email. */
export const STRIPE_EMAIL_MAX = 512;

/** For comparing: trimmed and lower-cased ("" for anything that isn't a string). */
export function normEmail(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** An address Stripe can take: one "@" with text on both sides, a dot in the domain, no spaces
 *  or control characters, at most 512 characters. */
export function isUsableEmail(v) {
  const e = typeof v === "string" ? v.trim() : "";
  if (!e || e.length > STRIPE_EMAIL_MAX) return false;
  if (/[\u0000- \u007f]/.test(e)) return false;
  return /^[^@]+@[^@]+\.[^@.]+$/.test(e);
}

/** For logs: "ana.writer@example.com" -> "a***@e***.com" (first letter of each side and the last
 *  domain label). "-" when there is none, "***" when it isn't an address at all. */
export function maskEmail(v) {
  const e = typeof v === "string" ? v.trim() : "";
  if (!e) return "-";
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return "***";
  const local = e.slice(0, at), domain = e.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 && dot < domain.length - 1 ? domain.slice(dot) : "";
  return `${local[0]}***@${domain[0]}***${tld}`;
}

/** Any text with every email-like token masked (error messages, before they are logged). */
const EMAIL_IN_TEXT = /[^\s@"'`<>()[\]{},;:]+@[^\s@"'`<>()[\]{},;:]+/g;
export function scrubEmails(text) {
  return String(text ?? "").replace(EMAIL_IN_TEXT, (m) => maskEmail(m));
}

/** The account email to put on the customer, from a Supabase auth user (auth.admin.getUserById):
 *    { ok: true, email }  — a confirmed, usable email (as the account has it, trimmed)
 *    { ok: false, reason } — no_account | anonymous | no_account_email | unconfirmed | bad_account_email
 *  Only email_confirmed_at counts (confirmed_at is also set by a confirmed PHONE). */
export function accountSyncEmail(user) {
  if (!user || typeof user !== "object") return { ok: false, reason: "no_account" };
  if (user.is_anonymous === true) return { ok: false, reason: "anonymous" };
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!email) return { ok: false, reason: "no_account_email" };
  if (!user.email_confirmed_at) return { ok: false, reason: "unconfirmed" };
  if (!isUsableEmail(email)) return { ok: false, reason: "bad_account_email" };
  return { ok: true, email };
}

/** What to do with the Stripe customer (stripe.customers.retrieve) given the account's email:
 *    { action: "update" }            — its email differs (case-insensitive), or it has none
 *    { action: "skip", reason }      — no_customer | customer_deleted | same_email
 *  A resend finds the emails equal, so the update happens once. */
export function customerEmailAction(customer, accountEmail) {
  if (!customer || typeof customer !== "object") return { action: "skip", reason: "no_customer" };
  if (customer.deleted) return { action: "skip", reason: "customer_deleted" };
  if (normEmail(customer.email) === normEmail(accountEmail)) return { action: "skip", reason: "same_email" };
  return { action: "update" };
}

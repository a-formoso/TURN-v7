/* ── Manage plan: server core (billing-portal Edge Function) ───────────────
   Owner request 2026-09-30: the Stripe dashboard's Customer Portal activation
   page would not save, so subscribers get self-serve plan management through
   the API instead. This module makes sure Kinolot's own portal CONFIGURATION
   exists (created by the API, never by the dashboard) and opens a portal
   session on it for the signed-in caller.

   Pure logic, no imports: index.ts injects the adapters, and
   scripts/test-billing-portal.mjs runs this exact file in Node.
     getUser(token)            live auth record (anon client auth.getUser);
                               null when the token is not a signed-in user
     customerIdFor(userId)     service-role read of
                               public.turn_credits.stripe_customer_id
     stripe.listConfigurations(params)  billingPortal.configurations.list
     stripe.createConfiguration(body)   billingPortal.configurations.create
     stripe.createSession(params)       billingPortal.sessions.create
     log(message, detail)      optional; never receives a secret

   Guarantees, all enforced here:
   - POST only (405). The caller is read from the Authorization header alone
     (401 without a signed-in, non-anonymous user). The request body is never
     read, so a user id sent in it is ignored.
   - The Stripe customer is the one the webhook stored for that user
     (turn_credits.stripe_customer_id). None -> 409 no_subscription.
   - The portal uses Kinolot's configuration: an ACTIVE one whose
     metadata.app is "kinolot" and whose subscription_update is not enabled;
     otherwise one is created with portalConfigBody() (which leaves
     subscription_update out, so it stays off). Plan switching stays
     OFF: stripe-webhook does not handle customer.subscription.updated yet, so
     a switch in the portal would change what Stripe charges without changing
     the plan or credits in the app.
   - return_url is the caller's Origin only when it is one of the app's hosts
     (returnUrlFor), else https://kinolot.infinitestudioai.com/.
   - Errors are plain words with a code; Stripe and database internals only go
     to the log (error type / code / status / request id, never a message that
     could echo a key).

   Frances's facts: the account-menu how-to lives in the "Plans & subscription"
   entry of APP_FEATURES (app/ai.jsx). Billing sentences never reach Frances
   (MUSE Protocol §3), so she does not repeat it. */

export const VERSION = "billing-portal@2026-09-30.2";

export const APP_TAG = "kinolot";
export const SITE = "https://kinolot.infinitestudioai.com";
export const DEFAULT_RETURN_URL = SITE + "/";

// Stripe's standard cancellation reasons (all of them, in the API's order).
export const CANCELLATION_REASONS = Object.freeze([
  "too_expensive", "missing_features", "switched_service", "unused",
  "customer_service", "too_complex", "low_quality", "other",
]);

/* The portal configuration Kinolot creates. A fresh object on every call.
   - customer_update OFF: the customer can't change the email (or name,
     address…) Stripe bills, so receipts keep going where the account is.
   - subscription_update is NOT SENT, which leaves plan switching OFF (see the
     header): a new configuration has it disabled unless it is turned on.
     Sending `{ enabled: false }` would break the create call: stripe@16 pins
     API version 2024-06-20, where Stripe still requires
     default_allowed_updates and products with it ("Missing required param"
     until 2024-09-30.acacia made them optional; stripe-node 17.0.0's
     changelog), and stripe-node drops empty arrays from the form body, so
     `[]` would not satisfy it either. isKinolotConfig refuses any
     configuration with switching on, and ensureConfiguration refuses a
     created one that reports it on.
   - subscription_pause is not sent: pausing is off unless it is turned on,
     and the parameter is gone from current API versions.
   - cancel at the END of the period, with the standard reasons: the plan and
     its credits stay until the period ends, then Stripe sends
     customer.subscription.deleted and the webhook ends the plan. */
export function portalConfigBody(){
  return {
    business_profile: {
      headline: "Kinolot by Infinite Studio AI",
      privacy_policy_url: SITE + "/privacy.html",
      terms_of_service_url: SITE + "/terms.html",
    },
    default_return_url: DEFAULT_RETURN_URL,
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: { enabled: true, options: [...CANCELLATION_REASONS] },
      },
    },
    metadata: { app: APP_TAG },
  };
}

/* ── return_url allow-list ──────────────────────────────────────────────── */
// Production hosts: https only, default port. Dev hosts: http or https, any port.
export const APP_HOSTS = Object.freeze([
  "kinolot.infinitestudioai.com",
  "cinema.infinitestudioai.com",
  "kinolot.replit.app",
]);
export const DEV_HOSTS = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

/** The caller's Origin as the portal's way back, when it is one of the app's
    hosts; otherwise the default. Never echoes a path, query or credentials. */
export function returnUrlFor(origin){
  if (typeof origin !== "string" || origin.length === 0 || origin.length > 200) return DEFAULT_RETURN_URL;
  let u;
  try { u = new URL(origin); } catch { return DEFAULT_RETURN_URL; }
  // an Origin header is exactly scheme://host[:port]; anything more is not one
  if (u.username || u.password || (u.pathname && u.pathname !== "/") || u.search || u.hash) return DEFAULT_RETURN_URL;
  if (origin.replace(/\/$/, "") !== u.origin) return DEFAULT_RETURN_URL;
  const host = u.hostname.toLowerCase();
  if (APP_HOSTS.includes(host)) {
    return u.protocol === "https:" && !u.port ? "https://" + host + "/" : DEFAULT_RETURN_URL;
  }
  if (DEV_HOSTS.includes(host)) {
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin + "/" : DEFAULT_RETURN_URL;
  }
  return DEFAULT_RETURN_URL;
}

/* ── small helpers ──────────────────────────────────────────────────────── */
/** "Bearer <jwt>" -> "<jwt>", else "". */
export function bearerToken(authorization){
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(String(authorization || ""));
  return m ? m[1] : "";
}

const CUSTOMER_ID = /^cus_[A-Za-z0-9]{6,64}$/;

/** A configuration this function may use: active, tagged app=kinolot, plan
    switching not enabled. */
export function isKinolotConfig(c){
  if (!c || typeof c !== "object" || typeof c.id !== "string" || c.active !== true) return false;
  const md = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
  if (md.app !== APP_TAG) return false;
  const upd = c.features && c.features.subscription_update;
  return !(upd && upd.enabled === true);
}

const MAX_CONFIG_PAGES = 5;

/** Find Kinolot's portal configuration (the oldest usable one), else create it.
    -> { id, created: boolean } */
export async function ensureConfiguration(stripe){
  const found = [];
  let startingAfter;
  for (let page = 0; page < MAX_CONFIG_PAGES; page++) {
    const params = { active: true, limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const res = await stripe.listConfigurations(params);
    const data = res && Array.isArray(res.data) ? res.data : [];
    for (const c of data) if (isKinolotConfig(c)) found.push(c);
    if (!res || res.has_more !== true || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  if (found.length) {
    found.sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
    return { id: found[0].id, created: false };
  }
  const made = await stripe.createConfiguration(portalConfigBody());
  if (!made || typeof made.id !== "string") throw Object.assign(new Error("configuration create returned no id"), { code: "bad_config" });
  // fail closed: never open a portal that lets a customer switch plans
  const upd = made.features && made.features.subscription_update;
  if (upd && upd.enabled === true) throw Object.assign(new Error("created configuration allows plan switching"), { code: "bad_config" });
  return { id: made.id, created: true };
}

/* ── the user-facing answers (plain words; the app shows its own copy) ─── */
export const MESSAGES = Object.freeze({
  method: "Use POST.",
  signIn: "Sign in to manage your plan.",
  noSubscription: "There's no subscription to manage yet — choose a plan first.",
  notConfigured: "Plan management isn't available right now.",
  unavailable: "Couldn't open plan management right now. Please try again in a moment.",
});
const answer = (status, json) => ({ status, json });
const fail = (status, code, message) => answer(status, { code, message });

// what may be logged about a thrown error: its kind, never its text
function errInfo(e){
  const o = {};
  if (e && typeof e === "object") {
    for (const k of ["type", "code", "statusCode", "requestId", "param"]) {
      if (typeof e[k] === "string" || typeof e[k] === "number") o[k] = e[k];
    }
  }
  return o;
}
// Stripe no longer knows this customer (deleted in the dashboard): nothing to manage
const customerMissing = (e) => !!e && typeof e === "object" && e.code === "resource_missing" && e.param === "customer";

/**
 * createBillingPortal(deps) -> { handle(req) }
 *   deps: { configured, getUser, customerIdFor, stripe, log? }
 *   req:  { method, authorization, origin }   (the body is never read)
 *   -> { status, json }   json is { url } or { code, message }
 */
export function createBillingPortal(deps){
  const log = typeof deps.log === "function" ? deps.log : () => {};
  async function handle(req){
    const r = req || {};
    if (String(r.method || "").toUpperCase() !== "POST") return fail(405, "method_not_allowed", MESSAGES.method);
    if (!deps.configured) return fail(500, "not_configured", MESSAGES.notConfigured);

    // 1. who is calling: the JWT in the Authorization header, nothing else
    const token = bearerToken(r.authorization);
    if (!token) return fail(401, "not_signed_in", MESSAGES.signIn);
    let user = null;
    try { user = await deps.getUser(token); } catch (e) { log("getUser failed", errInfo(e)); user = null; }
    if (!user || typeof user.id !== "string" || !user.id || user.is_anonymous === true) {
      return fail(401, "not_signed_in", MESSAGES.signIn);
    }

    // 2. the Stripe customer the webhook stored for this user
    let customerId = null;
    try { customerId = await deps.customerIdFor(user.id); }
    catch (e) { log("customer lookup failed", errInfo(e)); return fail(500, "portal_unavailable", MESSAGES.unavailable); }
    if (customerId == null || customerId === "") return fail(409, "no_subscription", MESSAGES.noSubscription);
    if (typeof customerId !== "string" || !CUSTOMER_ID.test(customerId)) {
      log("stored customer id is malformed", { user: user.id });
      return fail(500, "portal_unavailable", MESSAGES.unavailable);
    }

    // 3. Kinolot's portal configuration, then a session on it
    const returnUrl = returnUrlFor(r.origin);
    try {
      const config = await ensureConfiguration(deps.stripe);
      if (config.created) log("created the Kinolot portal configuration", { configuration: config.id });
      const session = await deps.stripe.createSession({ customer: customerId, configuration: config.id, return_url: returnUrl });
      const url = session && typeof session.url === "string" ? session.url : "";
      if (!/^https:\/\//.test(url)) {
        log("portal session had no https url", {});
        return fail(502, "portal_unavailable", MESSAGES.unavailable);
      }
      return answer(200, { url });
    } catch (e) {
      if (customerMissing(e)) return fail(409, "no_subscription", MESSAGES.noSubscription);
      log("stripe call failed", errInfo(e));
      return fail(502, "portal_unavailable", MESSAGES.unavailable);
    }
  }
  return { handle };
}

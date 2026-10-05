#!/usr/bin/env node
/* test-billing-portal.mjs — Manage plan (owner request 2026-09-30).
   The Stripe dashboard's Customer Portal activation page would not save, so subscribers
   manage their plan through a portal the API configures: supabase/functions/billing-portal.
   Offline: no network, no Stripe, no Supabase, no browser.

     A  the pure core (supabase/functions/billing-portal/core.mjs), run for real against fake
        adapters: the configuration body exactly (plan switching OFF), reuse of an existing
        Kinolot configuration, the return_url allow-list, the no_subscription path, and the
        user taken from the JWT only (never from a body)
     B  index.ts wiring: a thin wrapper that reads only method / Authorization / Origin,
        the service-role lookup of turn_credits.stripe_customer_id, stripe@16, CORS, and the
        deploy command with JWT verification left ON
     C  the account menu (app/auth-ui.jsx, transpiled like scripts/test-viewnav.mjs and run
        under a small hooks runtime): who sees "Manage plan", busy state, navigation, and the
        calm inline notes; "Change plan" is kept
     D  the cache keys, the CSS, APP_FEATURES (Frances's facts source) and the brand rules

   node scripts/test-billing-portal.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import {
  VERSION, APP_TAG, SITE, DEFAULT_RETURN_URL, CANCELLATION_REASONS, APP_HOSTS, DEV_HOSTS, MESSAGES,
  portalConfigBody, returnUrlFor, bearerToken, isKinolotConfig, ensureConfiguration, createBillingPortal,
} from "../supabase/functions/billing-portal/core.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename) => transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename,
}).code;

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); }
}
const plain = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

/* ── fakes ─────────────────────────────────────────────────────────────── */
const USER = { id: "11111111-2222-4333-8444-555555555555", aud: "authenticated", email: "writer@example.test" };
const CUSTOMER = "cus_TestCustomer123";
const GOOD_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMTExIn0.sig-part_1";
const cfg = (id, extra = {}) => Object.assign({
  id, object: "billing_portal.configuration", active: true, created: 1000,
  metadata: { app: "kinolot" }, features: { subscription_update: { enabled: false } },
}, extra);

function fakeStripe(pages = [{ data: [], has_more: false }], opts = {}){
  const calls = { list: [], create: [], session: [] };
  return {
    calls,
    async listConfigurations(params){ calls.list.push(plain(params)); if (opts.listError) throw opts.listError; return pages[calls.list.length - 1] || { data: [], has_more: false }; },
    async createConfiguration(body){ calls.create.push(plain(body)); if (opts.createError) throw opts.createError; return { id: "bpc_created_1", active: true, metadata: body.metadata }; },
    async createSession(params){ calls.session.push(plain(params)); if (opts.sessionError) throw opts.sessionError; return { url: opts.url === undefined ? "https://billing.stripe.com/p/session/test_abc" : opts.url }; },
  };
}
function makeApp(over = {}){
  const seen = { tokens: [], lookups: [], logs: [] };
  const stripe = over.stripe || fakeStripe(over.pages);
  const app = createBillingPortal({
    configured: over.configured !== false,
    async getUser(token){ seen.tokens.push(token); if (over.getUserError) throw over.getUserError; return over.user === undefined ? (token === GOOD_TOKEN ? USER : null) : over.user; },
    async customerIdFor(uid){ seen.lookups.push(uid); if (over.lookupError) throw over.lookupError; return over.customer === undefined ? CUSTOMER : over.customer; },
    stripe,
    log(message, detail){ seen.logs.push([message, plain(detail)]); },
  });
  return { app, stripe, seen };
}
const post = (extra = {}) => Object.assign({ method: "POST", authorization: "Bearer " + GOOD_TOKEN, origin: "https://kinolot.infinitestudioai.com" }, extra);

/* ── A. the core ───────────────────────────────────────────────────────── */
const EXPECTED_CONFIG = {
  business_profile: {
    headline: "Kinolot by Infinite Studio AI",
    privacy_policy_url: "https://kinolot.infinitestudioai.com/privacy.html",
    terms_of_service_url: "https://kinolot.infinitestudioai.com/terms.html",
  },
  default_return_url: "https://kinolot.infinitestudioai.com/",
  features: {
    customer_update: { enabled: false },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      cancellation_reason: {
        enabled: true,
        options: ["too_expensive", "missing_features", "switched_service", "unused", "customer_service", "too_complex", "low_quality", "other"],
      },
    },
    // subscription_update is left OUT on purpose: that keeps plan switching off (see A1b)
  },
  metadata: { app: "kinolot" },
};

/* stripe@16 form-encodes a request body with qs.stringify (indices, [] and {} dropped,
   undefined skipped, null -> "", booleans as text) and puts the brackets back as literals
   (stripe-node lib/utils.js stringifyRequestData). A copy of that, so the test sees the
   exact keys Stripe receives. */
function stripeFormKeys(data){
  const out = [];
  (function walk(v, key){
    if (v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, key + "[" + i + "]")); return; }
    if (v && typeof v === "object") { for (const k of Object.keys(v)) walk(v[k], key ? key + "[" + k + "]" : k); return; }
    out.push([key, v === null ? "" : String(v)]);
  })(data, "");
  return out;
}
/* what API version 2024-06-20 (pinned by stripe@16) requires on billing_portal/configurations
   create, per enabled feature (stripe@16 types/BillingPortal/ConfigurationsResource.d.ts,
   ConfigurationCreateParams; 2024-09-30.acacia later made the subscription_update pair optional) */
const REQUIRED_2024_06_20 = {
  "": ["business_profile", "features"],
  "features[customer_update]": ["enabled"],
  "features[invoice_history]": ["enabled"],
  "features[payment_method_update]": ["enabled"],
  "features[subscription_cancel]": ["enabled"],
  "features[subscription_cancel][cancellation_reason]": ["enabled", "options"],
  "features[subscription_update]": ["enabled", "default_allowed_updates", "products"],
};

await test("A1 the portal configuration body is exactly the owner's spec (plan switching OFF, cancel at period end, no email change, no pause)", () => {
  assert.deepEqual(plain(portalConfigBody()), EXPECTED_CONFIG);
  const b = portalConfigBody();
  assert.ok(!("subscription_update" in b.features), "subscription_update is not sent: a new configuration has plan switching off (the webhook doesn't handle plan switches yet)");
  assert.equal(b.features.customer_update.enabled, false, "customers can't change the billing email");
  assert.ok(!("allowed_updates" in b.features.customer_update), "no allowed update at all");
  assert.ok(!("subscription_pause" in b.features), "pause is never offered (off by default; not a current API parameter)");
  assert.ok(!("proration_behavior" in b.features.subscription_cancel), "no proration: nothing ends before the period does");
  assert.equal(APP_TAG, "kinolot"); assert.equal(SITE, "https://kinolot.infinitestudioai.com"); assert.equal(DEFAULT_RETURN_URL, SITE + "/");
  assert.ok(Object.isFrozen(CANCELLATION_REASONS) && CANCELLATION_REASONS.length === 8);
  assert.match(VERSION, /^billing-portal@2026-09-30\.\d+$/);
});
await test("A1b the body survives stripe@16's form encoding: every param API 2024-06-20 requires is sent, and no half subscription_update", () => {
  const keys = stripeFormKeys(portalConfigBody());
  const names = keys.map(([k]) => k);
  const sent = (prefix) => names.some((k) => k === prefix || k.startsWith(prefix + "["));
  assert.ok(!sent("features[subscription_update]"), "no features[subscription_update] key at all: " + names.filter((k) => /subscription_update/.test(k)).join(", "));
  for (const [group, fields] of Object.entries(REQUIRED_2024_06_20)) {
    if (group && !sent(group)) continue;                       // a feature that isn't sent needs nothing
    for (const f of fields) assert.ok(sent(group ? group + "[" + f + "]" : f), "missing required param " + (group ? group + "[" + f + "]" : f));
  }
  const get = (k) => (keys.find(([n]) => n === k) || [])[1];
  assert.equal(get("features[customer_update][enabled]"), "false");
  assert.equal(get("features[subscription_cancel][mode]"), "at_period_end");
  assert.equal(names.filter((k) => /^features\[subscription_cancel\]\[cancellation_reason\]\[options\]\[\d\]$/.test(k)).length, 8);
  assert.equal(get("metadata[app]"), "kinolot");
  // the check itself catches the broken body the first build sent (enabled:false alone),
  // and empty arrays don't help because the encoding drops them
  const broken = (sub) => { const x = portalConfigBody(); x.features.subscription_update = sub; return stripeFormKeys(x).map(([k]) => k); };
  for (const sub of [{ enabled: false }, { enabled: false, default_allowed_updates: [], products: [] }]) {
    const n = broken(sub);
    assert.ok(n.includes("features[subscription_update][enabled]") && !n.some((k) => k.startsWith("features[subscription_update][default_allowed_updates]")),
      "the pre-acacia 'Missing required param' body is detectable: " + JSON.stringify(sub));
  }
});
await test("A2 the body is a fresh object every time (a caller can't mutate the next one)", () => {
  const a = portalConfigBody();
  a.features.invoice_history.enabled = false; a.features.subscription_update = { enabled: true }; a.features.subscription_cancel.cancellation_reason.options.push("x"); a.metadata.app = "other";
  assert.deepEqual(plain(portalConfigBody()), EXPECTED_CONFIG);
});
await test("A3 an existing active Kinolot configuration is reused: no create, the oldest usable one wins", async () => {
  const stripe = fakeStripe([{ data: [
    cfg("bpc_other_app", { metadata: { app: "academy" }, created: 1 }),
    cfg("bpc_no_md", { metadata: {}, created: 2 }),
    cfg("bpc_switching_on", { created: 3, features: { subscription_update: { enabled: true } } }),
    cfg("bpc_newer", { created: 900 }),
    cfg("bpc_inactive", { active: false, created: 4 }),
    cfg("bpc_kinolot", { created: 500 }),
  ], has_more: false }]);
  const r = await ensureConfiguration(stripe);
  assert.deepEqual(r, { id: "bpc_kinolot", created: false });
  assert.equal(stripe.calls.create.length, 0, "nothing created");
  assert.deepEqual(stripe.calls.list, [{ active: true, limit: 100 }], "one page of ACTIVE configurations");
});
await test("A4 the lookup pages through (starting_after) and stops at a bounded number of pages", async () => {
  const stripe = fakeStripe([
    { data: [cfg("bpc_a", { metadata: { app: "academy" } }), cfg("bpc_b", { metadata: { app: "academy" } })], has_more: true },
    { data: [cfg("bpc_found", { created: 7 })], has_more: false },
  ]);
  assert.deepEqual(await ensureConfiguration(stripe), { id: "bpc_found", created: false });
  assert.deepEqual(stripe.calls.list, [{ active: true, limit: 100 }, { active: true, limit: 100, starting_after: "bpc_b" }]);
  const endless = { calls: 0, async listConfigurations(){ this.calls++; return { data: [cfg("bpc_x" + this.calls, { metadata: { app: "academy" } })], has_more: true }; },
    async createConfiguration(){ return { id: "bpc_new" }; } };
  assert.deepEqual(await ensureConfiguration(endless), { id: "bpc_new", created: true });
  assert.equal(endless.calls, 5, "at most 5 pages");
});
await test("A5 no usable configuration: one is created with exactly the spec body", async () => {
  const stripe = fakeStripe([{ data: [cfg("bpc_switching_on", { features: { subscription_update: { enabled: true } } }), cfg("bpc_academy", { metadata: { app: "academy" } })], has_more: false }]);
  assert.deepEqual(await ensureConfiguration(stripe), { id: "bpc_created_1", created: true });
  assert.deepEqual(stripe.calls.create, [EXPECTED_CONFIG]);
  assert.ok(isKinolotConfig(cfg("x")) && !isKinolotConfig(cfg("x", { active: false })) && !isKinolotConfig(cfg("x", { metadata: { app: "Kinolot " } }))
    && !isKinolotConfig(null) && !isKinolotConfig({ active: true, metadata: { app: "kinolot" } }), "the reuse rule");
  // Stripe's own answer for a configuration created without subscription_update (switching off) is used
  const real = { async listConfigurations(){ return { data: [], has_more: false }; },
    async createConfiguration(body){ return { id: "bpc_real", active: true, metadata: body.metadata, features: { subscription_update: { enabled: false, default_allowed_updates: [], products: [] } } }; } };
  assert.deepEqual(await ensureConfiguration(real), { id: "bpc_real", created: true });
  // fail closed: a created configuration that reports switching ON is never used
  const on = { async listConfigurations(){ return { data: [], has_more: false }; },
    async createConfiguration(body){ return { id: "bpc_on", active: true, metadata: body.metadata, features: { subscription_update: { enabled: true } } }; } };
  await assert.rejects(ensureConfiguration(on), (e) => e.code === "bad_config");
  const { app } = makeApp({ stripe: Object.assign(fakeStripe(), { createConfiguration: on.createConfiguration }) });
  const out = await app.handle(post());
  assert.equal(out.status, 502); assert.equal(out.json.code, "portal_unavailable");
});
await test("A6 return_url: the caller's Origin only when it is one of the app's hosts", () => {
  assert.deepEqual([...APP_HOSTS], ["kinolot.infinitestudioai.com", "cinema.infinitestudioai.com", "kinolot.replit.app"]);
  assert.deepEqual([...DEV_HOSTS], ["localhost", "127.0.0.1", "[::1]"]);
  const cases = [
    ["https://kinolot.infinitestudioai.com", "https://kinolot.infinitestudioai.com/"],
    ["https://cinema.infinitestudioai.com", "https://cinema.infinitestudioai.com/"],
    ["https://kinolot.replit.app", "https://kinolot.replit.app/"],
    ["http://localhost:5173", "http://localhost:5173/"],
    ["http://localhost", "http://localhost/"],
    ["http://127.0.0.1:8000", "http://127.0.0.1:8000/"],
    ["http://[::1]:3000", "http://[::1]:3000/"],
    ["https://localhost:8443", "https://localhost:8443/"],
    // everything else falls back to the default
    ["http://kinolot.infinitestudioai.com", DEFAULT_RETURN_URL],
    ["https://kinolot.infinitestudioai.com:8443", DEFAULT_RETURN_URL],
    ["https://kinolot.infinitestudioai.com.evil.example", DEFAULT_RETURN_URL],
    ["https://evil-kinolot.replit.app", DEFAULT_RETURN_URL],
    ["https://x.kinolot.replit.app", DEFAULT_RETURN_URL],
    ["https://evil.example", DEFAULT_RETURN_URL],
    ["https://kinolot.infinitestudioai.com/steal?x=1", DEFAULT_RETURN_URL],
    ["https://user:pw@kinolot.infinitestudioai.com", DEFAULT_RETURN_URL],
    ["https://infinitestudioai.com", DEFAULT_RETURN_URL],
    ["ftp://localhost", DEFAULT_RETURN_URL],
    ["javascript:alert(1)", DEFAULT_RETURN_URL],
    ["null", DEFAULT_RETURN_URL], ["", DEFAULT_RETURN_URL], [undefined, DEFAULT_RETURN_URL], [42, DEFAULT_RETURN_URL],
    ["https://" + "a".repeat(300) + ".example", DEFAULT_RETURN_URL],
  ];
  for (const [origin, want] of cases) assert.equal(returnUrlFor(origin), want, String(origin));
});
await test("A7 the happy path: user from the JWT, customer from the database, session on the Kinolot configuration -> { url }", async () => {
  const { app, stripe, seen } = makeApp({ pages: [{ data: [cfg("bpc_kinolot")], has_more: false }] });
  const out = await app.handle(post({ origin: "http://localhost:5173" }));
  assert.deepEqual(plain(out), { status: 200, json: { url: "https://billing.stripe.com/p/session/test_abc" } });
  assert.deepEqual(seen.tokens, [GOOD_TOKEN], "getUser gets the bearer token, verbatim");
  assert.deepEqual(seen.lookups, [USER.id], "the lookup uses the JWT's user id");
  assert.deepEqual(stripe.calls.session, [{ customer: CUSTOMER, configuration: "bpc_kinolot", return_url: "http://localhost:5173/" }]);
  assert.equal(stripe.calls.create.length, 0);
  const other = makeApp({ pages: [{ data: [cfg("bpc_kinolot")], has_more: false }] });
  await other.app.handle(post({ origin: "https://evil.example" }));
  assert.equal(other.stripe.calls.session[0].return_url, "https://kinolot.infinitestudioai.com/", "an unknown Origin gets the default");
  const first = makeApp();
  assert.equal((await first.app.handle(post())).status, 200);
  assert.deepEqual(first.stripe.calls.create, [EXPECTED_CONFIG], "the very first call creates the configuration");
  assert.equal(first.stripe.calls.session[0].configuration, "bpc_created_1");
  assert.ok(first.seen.logs.some(([m, d]) => /created the Kinolot portal configuration/.test(m) && d.configuration === "bpc_created_1"));
});
await test("A8 the user id comes from the JWT only: a body (or any extra field) naming another user changes nothing", async () => {
  const { app, seen, stripe } = makeApp();
  const out = await app.handle(Object.assign(post(), { body: JSON.stringify({ userId: "99999999-0000-4000-8000-000000000000", owner: "x", customer: "cus_Someone" }),
    userId: "99999999-0000-4000-8000-000000000000", customer: "cus_Someone" }));
  assert.equal(out.status, 200);
  assert.deepEqual(seen.lookups, [USER.id]);
  assert.equal(stripe.calls.session[0].customer, CUSTOMER);
  const src = read("supabase/functions/billing-portal/core.mjs").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\.body\b|JSON\.parse/.test(src), "the core never reads a body");
});
await test("A9 no stored customer -> 409 no_subscription with the plain message, and Stripe is never called", async () => {
  for (const customer of [null, ""]) {
    const { app, stripe } = makeApp({ customer });
    const out = await app.handle(post());
    assert.deepEqual(plain(out), { status: 409, json: { code: "no_subscription", message: "There's no subscription to manage yet — choose a plan first." } });
    assert.equal(stripe.calls.list.length + stripe.calls.create.length + stripe.calls.session.length, 0);
  }
  assert.equal(MESSAGES.noSubscription, "There's no subscription to manage yet — choose a plan first.");
  // Stripe no longer knows the customer (deleted there): nothing to manage either
  const gone = Object.assign(new Error("No such customer: 'cus_TestCustomer123'"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "customer", statusCode: 400 });
  const { app } = makeApp({ stripe: fakeStripe(undefined, { sessionError: gone }) });
  assert.equal((await app.handle(post())).json.code, "no_subscription");
});
await test("A10 who may call: POST only; a signed-in, non-anonymous user from a Bearer token", async () => {
  const { app, seen } = makeApp();
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "", undefined]) {
    const out = await app.handle(post({ method }));
    assert.deepEqual(plain(out), { status: 405, json: { code: "method_not_allowed", message: "Use POST." } }, String(method));
  }
  assert.equal(seen.tokens.length, 0, "no auth call before the method check");
  const signIn = { status: 401, json: { code: "not_signed_in", message: "Sign in to manage your plan." } };
  for (const authorization of ["", "Bearer", "Bearer ", "Basic abc", "Token " + GOOD_TOKEN, "Bearer a b"])
    assert.deepEqual(plain(await makeApp().app.handle(post({ authorization }))), signIn, JSON.stringify(authorization));
  assert.deepEqual(plain(await makeApp().app.handle(post({ authorization: "Bearer not.a.user" }))), signIn, "getUser said no (e.g. the anon key)");
  assert.deepEqual(plain(await makeApp({ user: Object.assign({}, USER, { is_anonymous: true }) }).app.handle(post())), signIn, "anonymous sign-ins are not subscribers");
  assert.deepEqual(plain(await makeApp({ user: { email: "x" } }).app.handle(post())), signIn, "a user without an id");
  const thrown = makeApp({ getUserError: new Error("auth down") });
  assert.deepEqual(plain(await thrown.app.handle(post())), signIn);
  assert.equal(thrown.seen.lookups.length, 0, "no lookup without a user");
  assert.equal(bearerToken("bearer " + GOOD_TOKEN), GOOD_TOKEN);
  assert.equal(bearerToken(null), "");
});
await test("A11 failures are plain words: no Stripe or database text, no secret, in the answer or the log", async () => {
  const leaky = Object.assign(new Error("Invalid API Key provided: sk_live_SECRET123456"), { type: "StripeAuthenticationError", statusCode: 401, requestId: "req_1", raw: { message: "sk_live_SECRET123456" } });
  const unavailable = { code: "portal_unavailable", message: "Couldn't open plan management right now. Please try again in a moment." };
  for (const opts of [{ listError: leaky }, { createError: leaky }, { sessionError: leaky }]) {
    const { app, seen } = makeApp({ stripe: fakeStripe(undefined, opts) });
    const out = await app.handle(post());
    assert.deepEqual(plain(out), { status: 502, json: unavailable });
    const all = JSON.stringify(out) + JSON.stringify(seen.logs);
    assert.ok(!/sk_live|SECRET|Invalid API Key/.test(all), "nothing secret anywhere: " + all);
    assert.ok(seen.logs.some(([m, d]) => m === "stripe call failed" && d.type === "StripeAuthenticationError" && d.requestId === "req_1"), "the log keeps the kind, not the text");
  }
  const db = makeApp({ lookupError: Object.assign(new Error("permission denied for table turn_credits"), { code: "42501" }) });
  const dbOut = await db.app.handle(post());
  assert.deepEqual(plain(dbOut), { status: 500, json: unavailable });
  assert.ok(!/permission denied|turn_credits/.test(JSON.stringify(dbOut)));
  const bad = makeApp({ customer: "not-a-customer" });
  assert.deepEqual(plain(await bad.app.handle(post())), { status: 500, json: unavailable }, "a malformed stored id is never sent to Stripe");
  assert.equal(bad.stripe.calls.session.length, 0);
  for (const url of ["", "http://billing.stripe.com/p/x", "javascript:alert(1)", null]) {
    const { app } = makeApp({ stripe: fakeStripe(undefined, { url }) });
    assert.deepEqual(plain(await app.handle(post())), { status: 502, json: unavailable }, "session url " + url);
  }
  assert.deepEqual(plain(await makeApp({ configured: false }).app.handle(post())),
    { status: 500, json: { code: "not_configured", message: "Plan management isn't available right now." } });
});

/* ── B. index.ts wiring ────────────────────────────────────────────────── */
const INDEX = read("supabase/functions/billing-portal/index.ts");
const INDEX_CODE = INDEX.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
await test("B1 index.ts is a thin wrapper: CORS, then method + Authorization + Origin into core.handle(); the body is never read", () => {
  assert.ok(INDEX.includes('import { createBillingPortal } from "./core.mjs";'));
  assert.ok(INDEX.includes('import Stripe from "npm:stripe@16";'), "the same SDK major as stripe-webhook");
  assert.ok(/method: req\.method,/.test(INDEX_CODE) && /authorization: req\.headers\.get\("Authorization"\) \|\| "",/.test(INDEX_CODE)
    && /origin: req\.headers\.get\("Origin"\) \|\| "",/.test(INDEX_CODE));
  assert.ok(!/req\.(json|text|body|formData|arrayBuffer)\b/.test(INDEX_CODE), "never reads the request body");
  assert.ok(/if \(req\.method === "OPTIONS"\) return new Response\("ok", \{ headers: CORS \}\);/.test(INDEX_CODE));
  const cors = (src) => (src.match(/const CORS = \{[\s\S]*?\};/) || [""])[0];
  assert.equal(cors(INDEX), cors(read("supabase/functions/admin-storage/index.ts")), "CORS exactly like admin-storage");
});
await test("B2 the adapters: anon client for the user, service role for turn_credits.stripe_customer_id, billingPortal calls", () => {
  assert.ok(/createClient\(SUPABASE_URL, ANON_KEY,[\s\S]*?sb\.auth\.getUser\(token\)/.test(INDEX_CODE), "the user comes from the token");
  assert.ok(/createClient\(SUPABASE_URL, SERVICE_KEY,/.test(INDEX_CODE));
  assert.ok(/\.from\("turn_credits"\)\s*\.select\("stripe_customer_id"\)\s*\.eq\("owner", userId\)\s*\.maybeSingle\(\)/.test(INDEX_CODE));
  assert.ok(/billingPortal\.configurations\.list\(params\)/.test(INDEX_CODE) && /billingPortal\.configurations\.create\(body\)/.test(INDEX_CODE)
    && /billingPortal\.sessions\.create\(params\)/.test(INDEX_CODE));
  assert.ok(/const CONFIGURED = !!\(SUPABASE_URL && ANON_KEY && SERVICE_KEY && STRIPE_KEY\);/.test(INDEX_CODE));
  assert.ok(!/console\.(log|error)\([^)]*(STRIPE_KEY|SERVICE_KEY|ANON_KEY)/.test(INDEX_CODE), "no key is ever logged");
});
await test("B3 the deploy note: Mac, owner approval, JWT verification stays ON", () => {
  assert.ok(INDEX.includes("//   npx -y supabase@latest functions deploy billing-portal --project-ref vubenblfdzginlqiglzw --use-api"));
  assert.ok(/Deploy \(Mac, owner approval required\)\. JWT verification stays ON: do NOT\n\/\/ pass --no-verify-jwt/.test(INDEX));
  const deployLines = INDEX.split("\n").filter((l) => /functions deploy billing-portal/.test(l));
  assert.ok(deployLines.length === 1 && !/--no-verify-jwt/.test(deployLines[0]));
});

/* ── C. the account menu ───────────────────────────────────────────────── */
function createRuntime(){
  const FRAGMENT = "fragment";
  const stores = new Map(), roots = new Set();
  let current = null, visited = new Set(), pending = [], scheduled = false, renders = 0;
  function createElement(type, props, ...children){
    const p = Object.assign({}, props || {});
    const key = p.key; delete p.key;
    const kids = children.flat(Infinity);
    if (kids.length) p.children = kids;
    return { $$el: true, type, props: p, key: key == null ? null : String(key) };
  }
  function renderNode(el, path, out){
    if (el === null || el === undefined || el === false || el === true || el === "") return;
    if (Array.isArray(el)) { el.forEach((c, i) => renderNode(c, path + "." + i, out)); return; }
    if (typeof el === "string" || typeof el === "number") { out.push(String(el)); return; }
    const { type, props } = el;
    if (typeof type === "function") {
      const id = path + ":" + (type.name || "anon");
      visited.add(id);
      let store = stores.get(id);
      if (!store) { store = { hooks: [] }; stores.set(id, store); }
      const prev = current; current = { store, i: 0 };
      let res;
      try { res = type(props); } finally { current = prev; }
      renderNode(res, id, out);
      return;
    }
    if (type === FRAGMENT) { renderNode(props.children || [], path + "/f", out); return; }
    const node = { type, props: Object.assign({}, props), children: [] };
    delete node.props.children;
    if (props.ref && typeof props.ref === "object") props.ref.current = node;
    (props.children || []).forEach((c, i) => renderNode(c, path + "/" + type + "." + i, node.children));
    out.push(node);
  }
  function flush(){
    if (++renders > 2000) throw new Error("render loop");
    visited = new Set();
    let i = 0;
    for (const r of roots) { const out = []; renderNode(r.element, "root" + (i++), out); r.tree = { type: "root", props: {}, children: out }; }
    for (const [id] of stores) if (!visited.has(id)) stores.delete(id);
    const effects = pending; pending = [];
    for (const { cell, fn } of effects) { if (typeof cell.cleanup === "function") cell.cleanup(); const c = fn(); cell.cleanup = typeof c === "function" ? c : null; }
  }
  function schedule(){ if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; flush(); }); }
  function hook(){ if (!current) throw new Error("hook outside a component"); return [current.store.hooks, current.i++]; }
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, j) => !Object.is(x, b[j]));
  const React = {
    createElement, Fragment: FRAGMENT,
    useState(init){
      const [hooks, i] = hook();
      if (!hooks[i]) {
        const cell = { v: typeof init === "function" ? init() : init };
        cell.set = (nv) => { const next = typeof nv === "function" ? nv(cell.v) : nv; if (Object.is(next, cell.v)) return; cell.v = next; schedule(); };
        hooks[i] = cell;
      }
      return [hooks[i].v, hooks[i].set];
    },
    useEffect(fn, deps){
      const [hooks, i] = hook();
      if (!hooks[i]) { hooks[i] = { deps, cleanup: null }; pending.push({ cell: hooks[i], fn }); return; }
      if (changed(hooks[i].deps, deps)) { hooks[i].deps = deps; pending.push({ cell: hooks[i], fn }); }
    },
    useRef(init){ const [hooks, i] = hook(); if (!hooks[i]) hooks[i] = { current: init === undefined ? null : init }; return hooks[i]; },
    useMemo(fn, deps){ const [hooks, i] = hook(); if (!hooks[i] || changed(hooks[i].deps, deps)) hooks[i] = { v: fn(), deps }; return hooks[i].v; },
    useCallback(fn, deps){ return React.useMemo(() => fn, deps); },
  };
  return {
    React,
    mount(element){ const r = { element, tree: null }; roots.add(r); flush(); },
    tree(){ const r = [...roots][0]; return r ? r.tree : null; },
  };
}
const text = (n) => n == null ? "" : typeof n === "string" ? n : (n.children || []).map(text).join("");
function findAll(n, pred, acc = []){
  if (n && typeof n === "object") { if (n.type && n.type !== "root" && pred(n)) acc.push(n); (n.children || []).forEach((c) => findAll(c, pred, acc)); }
  return acc;
}
const find = (n, pred) => findAll(n, pred)[0] || null;
const hasClass = (n, c) => String(n.props.className || "").split(/\s+/).includes(c);
const button = (n, re) => find(n, (x) => x.type === "button" && re.test(text(x)));
async function click(node){ assert.ok(node, "clickable node exists"); assert.ok(!node.props.disabled, "enabled: " + text(node)); node.props.onClick({ stopPropagation(){}, preventDefault(){}, target: node }); await settle(); }

const AUTH_JS = transform(read("app/auth-ui.jsx"), "auth-ui.jsx");
/* a signed-in account menu; plan: the ledger's plan (null = no balance loaded);
   invoke: the fake sb.functions.invoke (null = no Supabase client at all) */
function menu({ plan = "writer", invoke } = {}){
  const rt = createRuntime();
  const nav = [], plansOpened = [], calls = [], timers = [], listeners = [];
  const box = {
    console, React: rt.React, queueMicrotask,
    Icon: new Proxy({}, { get: () => function IconStub(){ return null; } }),
    document: { addEventListener(){}, removeEventListener(){} },
    // timers only run when a test fires them (fire(ms)); cleared ones never do
    setTimeout: (fn, ms) => { timers.push({ fn, ms, done: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].done = true; },
    addEventListener: (type, fn) => listeners.push([type, fn]),
    removeEventListener: (type, fn) => { const i = listeners.findIndex(([t, f]) => t === type && f === fn); if (i >= 0) listeners.splice(i, 1); },
    cloudConfigured: () => true, cloudUserEmail: () => "writer@example.test",
    turnIsPaidPlan: (p) => { const s = String(p || "").toLowerCase().trim(); return !!s && s !== "none" && s !== "free"; },
    turnCreditBalance: plan === null ? null : { remaining: 800, plan },
    turnOpenPlans: () => plansOpened.push(1),
    turnPlanDisplayName: (p) => p === "studio" ? "Producer" : p[0].toUpperCase() + p.slice(1),
    location: { assign: (u) => nav.push(u) },
  };
  box.window = box;
  if (invoke !== null) box.sbClient = () => ({ functions: { invoke: (name, opts) => { calls.push([name, plain(opts)]); return (invoke || (async () => ({ data: { url: "https://billing.stripe.com/p/session/test_abc" }, error: null })))(name, opts); } } });
  vm.createContext(box);
  vm.runInContext(AUTH_JS, box, { filename: "auth-ui.jsx" });
  rt.mount(rt.React.createElement(box.AccountChip, { session: { user: { id: USER.id } }, cloudActive: true, saveState: "saved" }));
  const chip = () => find(rt.tree(), (n) => hasClass(n, "acct-chip"));
  const manage = () => find(rt.tree(), (n) => n.type === "button" && hasClass(n, "acct-manage"));
  const note = () => find(rt.tree(), (n) => hasClass(n, "acct-note"));
  const fire = async (ms) => { for (const t of timers) if (!t.done && t.ms === ms) { t.done = true; t.fn(); } await settle(); };
  const dispatch = async (type, ev) => { for (const [t, fn] of [...listeners]) if (t === type) fn(ev); await settle(); };
  const pending = (ms) => timers.filter((t) => !t.done && t.ms === ms).length;
  return { rt, box, nav, plansOpened, calls, chip, manage, note, fire, dispatch, pending, open: () => click(chip()) };
}
const httpError = (status, body) => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => { if (body === undefined) throw new Error("no json"); return body; } } } });
const COPY = {
  noSub: "There's no subscription on this account to manage here. For billing questions, write to kinolot-billing@infinitestudioai.com.",
  signIn: "Sign in again to manage your plan.",
  unavailable: "Plan management isn't available right now. Try again in a moment.",
  failed: "Couldn't open plan management. Try again in a moment, or write to kinolot-billing@infinitestudioai.com.",
};

await test("C1 who sees 'Manage plan': a signed-in user on a paid plan with the cloud client; 'Change plan' stays", async () => {
  for (const plan of ["writer", "director", "studio", "pro"]) {
    const m = menu({ plan }); await m.open();
    const change = button(m.rt.tree(), /^Change plan$/), mg = m.manage();
    assert.ok(change && hasClass(change, "acct-upgrade") && !hasClass(change, "acct-manage"), plan + ": Change plan kept as the green upgrade button");
    assert.ok(mg && hasClass(mg, "acct-upgrade") && text(mg) === "Manage plan", plan + ": Manage plan shown");
    assert.equal(mg.props.title, "Update your card, see invoices, or cancel at the end of the billing period");
    assert.equal(mg.props.disabled, false); assert.equal(mg.props["aria-busy"], "false");
    const kids = find(m.rt.tree(), (n) => hasClass(n, "acct-menu")).children;
    assert.equal(kids.indexOf(mg), kids.indexOf(change) + 1, "right under Change plan");
    assert.ok(kids.indexOf(mg) < kids.findIndex((n) => hasClass(n, "acct-signout")), "above Sign out");
    assert.equal(m.note(), null, "no note before anything happened");
  }
  for (const plan of ["none", "free", "", null]) {
    const m = menu({ plan }); await m.open();
    assert.equal(m.manage(), null, "no Manage plan for plan " + JSON.stringify(plan));
    assert.ok(button(m.rt.tree(), /Get credits · Choose a plan/), "the plan chooser is still offered");
  }
  const noCloud = menu({ invoke: null }); await noCloud.open();
  assert.equal(noCloud.manage(), null, "no Supabase client: no button");
  const m = menu(); await m.open();
  await click(button(m.rt.tree(), /^Change plan$/));
  assert.equal(m.plansOpened.length, 1, "Change plan still opens the plans window");
  assert.equal(m.calls.length, 0, "…without calling the portal");
});
await test("C2 click: one call to billing-portal with an empty body, a busy button, then the page goes to the portal url", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const m = menu({ invoke: async () => { await gate; return { data: { url: "https://billing.stripe.com/p/session/test_abc" }, error: null }; } });
  await m.open();
  await click(m.manage());
  assert.deepEqual(m.calls, [["billing-portal", { body: {} }]], "the function name; no user id or customer in the body");
  const busy = m.manage();
  assert.equal(busy.props.disabled, true); assert.equal(busy.props["aria-busy"], "true");
  assert.equal(text(busy), "Opening…");
  assert.ok(find(busy, (n) => hasClass(n, "ns-spin")), "a spinner while it opens");
  busy.props.onClick({}); await settle();
  assert.equal(m.calls.length, 1, "a second click while busy does nothing");
  release(); await settle();
  assert.deepEqual(m.nav, ["https://billing.stripe.com/p/session/test_abc"], "navigates to the returned url");
  assert.equal(m.manage().props.disabled, true, "stays busy while the page leaves");
  assert.equal(m.note(), null);
  assert.equal(m.pending(20000), 0, "the request timeout was cleared");
  assert.equal(m.pending(4000), 1, "one reset timer armed");
});
await test("C2b the page didn't leave ('Leave site?' -> Stay, or Back from the portal): the button comes back by itself", async () => {
  // Stay on the unload prompt: the page is still here when the reset timer fires
  const m = menu(); await m.open();
  await click(m.manage());
  assert.deepEqual(m.nav, ["https://billing.stripe.com/p/session/test_abc"]);
  assert.equal(m.manage().props.disabled, true);
  await m.fire(4000);
  const back = m.manage();
  assert.equal(back.props.disabled, false); assert.equal(back.props["aria-busy"], "false"); assert.equal(text(back), "Manage plan");
  assert.equal(m.note(), null, "no error note: nothing failed");
  await click(back);
  assert.equal(m.calls.length, 2, "and it works again");
  assert.deepEqual(m.nav, ["https://billing.stripe.com/p/session/test_abc", "https://billing.stripe.com/p/session/test_abc"]);
  assert.equal(m.pending(4000), 1, "a second click re-arms a single timer, not two");
  // Back button: the page comes out of the back/forward cache (pageshow, persisted)
  const b = menu(); await b.open();
  await click(b.manage());
  await b.dispatch("pageshow", { persisted: false });
  assert.equal(b.manage().props.disabled, true, "an ordinary pageshow changes nothing");
  await b.dispatch("pageshow", { persisted: true });
  assert.equal(b.manage().props.disabled, false, "restored from the back/forward cache: usable at once");
  assert.equal(text(b.manage()), "Manage plan");
  await b.fire(4000);
  assert.equal(b.manage().props.disabled, false, "the late timer is harmless");
});
await test("C3 errors are calm inline notes and the button comes back", async () => {
  const cases = [
    [async () => httpError(409, { code: "no_subscription", message: "There's no subscription to manage yet — choose a plan first." }), COPY.noSub],
    [async () => httpError(401, { code: "not_signed_in", message: "Sign in to manage your plan." }), COPY.signIn],
    [async () => httpError(401, undefined), COPY.signIn],
    [async () => httpError(404, undefined), COPY.unavailable],
    [async () => httpError(500, { code: "not_configured", message: "x" }), COPY.unavailable],
    [async () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } }), COPY.unavailable],
    [async () => ({ data: null, error: { name: "FunctionsRelayError", message: "relay" } }), COPY.unavailable],
    [async () => httpError(502, { code: "portal_unavailable", message: "Couldn't open plan management right now. Please try again in a moment." }), COPY.failed],
    [async () => httpError(500, { code: "portal_unavailable", message: "sk_live_SECRET raw text" }), COPY.failed],
    [async () => ({ data: { url: "http://billing.stripe.com/p/x" }, error: null }), COPY.failed],
    [async () => ({ data: { url: "javascript:alert(1)" }, error: null }), COPY.failed],
    [async () => ({ data: {}, error: null }), COPY.failed],
    [async () => { throw new Error("boom"); }, COPY.failed],
  ];
  for (const [invoke, want] of cases) {
    const m = menu({ invoke }); await m.open();
    await click(m.manage());
    const note = m.note();
    assert.ok(note && hasClass(note, "acct-status"), "a note in the menu's own status style");
    assert.equal(text(note), want);
    assert.equal(note.props.role, "status");
    assert.deepEqual(m.nav, [], "no navigation on an error");
    const mg = m.manage();
    assert.equal(mg.props.disabled, false); assert.equal(text(mg), "Manage plan");
    assert.ok(!/sk_live|SECRET/.test(JSON.stringify(m.rt.tree(), (k, v) => (k === "ref" ? undefined : v))), "server text is never shown raw");
  }
  // the button only shows on a paid plan, so the note can't tell that user to "choose a plan"
  const m = menu({ plan: "studio", invoke: async () => httpError(409, { code: "no_subscription" }) }); await m.open();
  await click(m.manage());
  assert.ok(button(m.rt.tree(), /^Change plan$/), "the menu treats the account as on a paid plan");
  assert.ok(!/choose a plan/i.test(text(m.note())), "no 'choose a plan first' next to 'Change plan'");
  assert.ok(text(m.note()).includes("kinolot-billing@infinitestudioai.com"), "somewhere to ask instead");
});
await test("C4 the note clears when the menu is reopened, and Retry works", async () => {
  let n = 0;
  const m = menu({ invoke: async () => (++n === 1 ? httpError(409, { code: "no_subscription" }) : { data: { url: "https://billing.stripe.com/p/session/second" }, error: null }) });
  await m.open();
  await click(m.manage());
  assert.equal(text(m.note()), COPY.noSub);
  await click(m.chip()); await click(m.chip());          // close, reopen
  assert.equal(m.note(), null, "a fresh menu has no stale note");
  await click(m.manage());
  assert.deepEqual(m.nav, ["https://billing.stripe.com/p/session/second"]);
});

/* ── D. keys, CSS, APP_FEATURES, brand ─────────────────────────────────── */
await test("D1 TURN.html: the changed files load under 20260930-portal1 (script.jsx shares ai.jsx's key)", () => {
  const html = read("TURN.html");
  const key = (f) => (html.match(new RegExp(f.replace(/\./g, "\\.") + "\\?v=([^\"']+)")) || [])[1] || "";
  // the billing fixes (2026-09-30) re-keyed all four files again: 20260930-billing1
  for (const f of ["app/auth-ui.jsx", "app/ai.jsx", "app/script.jsx", "app/styles.css"]) assert.ok(["20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-consent1", "20261002-tip1", "20261002-btn1", "20261002-team1", "20261002-scene1", "20261002-research1", "20261002-research2", "20261002-artlive1", "20261002-artundo1", "20261002-stagefilm1", "20261002-attrib1", "20261002-planpick2", "20261002-planpick3", "20261002-trialwelcome1", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team5", "20261003-team6", "20261003-team7", "20261003-team8", "20261003-lookbook1", "20261003-cast1", "20261004-props1", "20261004-locs1", "20261004-color1", "20261004-shots1", "20261005-sb1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2"].includes(key(f)), f);   // consumer rights + tax (2026-10-01): 20261001-tax1; the 14-day note (2026-10-02): 20261002-consent1; the note behind an ⓘ (2026-10-02): 20261002-tip1; Team "Coming soon" (2026-10-02): 20261002-team1
  assert.equal(key("app/ai.jsx"), key("app/script.jsx"), "script.jsx shares ai.jsx's key");
});
await test("D2 CSS: Manage plan is the quieter account action, its spinner and note are styled", () => {
  const css = read("app/styles.css");
  for (const rule of [
    ".acct-upgrade.acct-manage{background:var(--bg-2);border-color:var(--line-2);color:var(--txt-1);margin-top:4px}",
    ".acct-upgrade.acct-manage:hover{background:var(--bg-3);color:var(--txt-0)}",
    ".acct-upgrade.acct-manage:disabled{background:var(--bg-2);color:var(--txt-1);cursor:progress;opacity:.75}",
    ".acct-manage .ns-spin{width:11px;height:11px;border-color:var(--line-3);border-top-color:var(--txt-0)}",
    ".acct-status.acct-note{color:var(--txt-2);margin-top:6px;margin-bottom:8px;line-height:1.4}",
  ]) assert.ok(css.includes(rule), rule);
  assert.ok(css.indexOf(".acct-upgrade.acct-manage:hover") < css.indexOf(".acct-upgrade.acct-manage:disabled"), "disabled wins over hover");
});
await test("D3 APP_FEATURES: the account-menu how-to names Manage plan (card, invoices, cancel at period end; no plan switching there yet)", () => {
  const noop = () => {};
  const box = {
    console: { ...console, warn: noop, info: noop, log: noop }, setTimeout: (f) => setTimeout(f, 0), clearTimeout, setInterval, clearInterval,
    React: new Proxy({ createElement: (t, p, ...c) => ({ t, p, c }), useState: (x) => [x, noop], useRef: (x) => ({ current: x }), useEffect: noop, useMemo: (f) => f() }, { get: (t, k) => (k in t) ? t[k] : noop }),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { userAgent: "node-test" }, location: { href: "", search: "", hash: "", origin: "" },
    CustomEvent: class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document: { createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }), getElementById: () => null, addEventListener: noop, removeEventListener: noop,
      querySelector: () => null, querySelectorAll: () => [], body: { appendChild: noop, removeChild: noop }, head: { appendChild: noop } },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    fetch: () => { throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  vm.createContext(box);
  for (const f of ["app/formats.jsx", "app/frameworks.jsx", "app/contract.jsx", "app/scene-order.js", "app/story-data.jsx", "app/spine.jsx", "app/ai.jsx"])
    vm.runInContext(read(f), box, { filename: f });
  const plans = box.APP_FEATURES.find((f) => f.name === "Plans & subscription (Writer / Director / Producer)");
  assert.ok(plans, "the plans entry");
  for (const s of [
    "MANAGE PLAN: a subscriber on a paid plan also has a 'Manage plan' button in the account menu (avatar, top right), under 'Change plan'.",
    "update the card they pay with, see and download past invoices, and cancel",
    "a cancellation takes effect at the END of the current billing period, so the plan and its credits stay until then.",
    "Switching between plans isn't available on that page yet (and the billing email can't be changed there); 'Change plan' still opens the plans window.",
    "If the plan isn't billed through a subscription (for example a plan the team granted), a short note under the button says 'There's no subscription on this account to manage here.' and gives the billing address",
  ]) assert.ok(plans.what.includes(s), s);
  // (billing fixes, 2026-09-30: the pack facts after it now open with "CREDIT PACKS:")
  const added = plans.what.slice(plans.what.indexOf("MANAGE PLAN:"), plans.what.indexOf("CREDIT PACKS:"));
  assert.ok(added.length > 200 && !/stripe|portal/i.test(added), "the new how-to names no vendor: " + added);
  // billing how-to never reaches Frances (MUSE Protocol §3): the plans entry is dropped from her facts
  const facts = box.museFacts().map((f) => f.name + ": " + f.what).join("\n");
  assert.ok(!/Manage plan|billing period/.test(facts), "Frances doesn't repeat billing detail");
});
await test("D4 brand: user copy says Kinolot / Infinite Studio AI and never a retired name; the UI names no vendor", () => {
  const auth = read("app/auth-ui.jsx");
  const block = auth.slice(auth.indexOf("MANAGE PLAN (owner request 2026-09-30)"), auth.indexOf("function AccountChip("));
  const literals = (src) => [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]);
  const copy = literals(block).join("\n") + "\n" + literals(auth.slice(auth.indexOf("// Manage plan (2026-09-30)"), auth.indexOf("ts && React.createElement"))).join("\n");
  assert.ok(copy.includes("kinolot-billing@infinitestudioai.com"), "the billing address the policies list");
  assert.ok(!/stripe/i.test(copy), "no vendor in the new UI copy");
  for (const re of [/\bTURN\b/, /cinema[\s_-]?machine/i, /\bMUSE\b/, /Infinite Studio(?! AI)/]) {
    assert.ok(!re.test(copy), String(re));
    const coreLits = literals(read("supabase/functions/billing-portal/core.mjs").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n");
    assert.ok(!re.test(coreLits), "core.mjs " + String(re));
  }
  assert.equal(portalConfigBody().business_profile.headline, "Kinolot by Infinite Studio AI");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

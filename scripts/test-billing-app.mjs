#!/usr/bin/env node
/* test-billing-app.mjs — the APP side of the billing fixes (owner decisions 2026-09-30).
   Offline: no network, no Stripe, no Supabase, no browser. The real sources are transpiled
   (like the production build) and run in node:vm sandboxes with small fakes.

     A  Option A plans (600 / 1,600 / 5,000 at unchanged prices), a saved plan-copy override
        can't advertise an old grant, the grandfathered allowances, the free-trial copy
     B  packs 250/$10, 1,000/$35, 3,000/$99: empty link slots say "Coming soon" and never open
        a checkout; a pasted link opens one for ANY signed-in account; "for any account" copy
     C  paying subscribers never start a second subscription from the Plans window
     D  the balance readout: plan + pack credits with the next pack expiry, and the graceful
        fallback when turn_credit_balance still returns only remaining + plan (app/cloud.jsx)
     E  low-balance notices at 20% / 5% of the allowance — dismissible, once per level per
        cycle, grandfathered allowances, packs count, trial, admin exempt
     F  "Payment failed — update your card" (past_due) and "Account on hold" (frozen) banners,
        their Manage-plan action (billing portal if present, else the Plans window)
     G  server billing refusals → one calm sentence (+ the Plans window for credit/plan codes)
     H  the plan picked before sign-up rides the ACCOUNT (user metadata) and opens checkout once,
        never for an account already on a plan
     I  the credit anchor is $0.01 (app/pricing.jsx + app/imagegen.jsx): image, video and pack
        numbers match the server's formula; per-image rounding; draft images for trial accounts
     J  video is charged on the SERVER: the browser spends nothing, the quote rides the submit,
        the balance refreshes at hold / settle / release, 402s read calmly (app/videogen.jsx)
     K  the Stage: quotes (not spend records), frozen accounts can't render, the tooltip splits
        plan vs pack credits; Motion Control / edit holds = the server's (round 4: the video's
        length x 1.1 + 1 s when the server sizes the hold by it — round 5: every video it copies at
        submit, the film's storage included); the composer's credit outline, warning, right-panel
        error and footer follow the open tab and task (Extend: the extension's price), and no
        shortfall shows before a measured video sizes a hold (app/stage.jsx)
     L  voice refusals read calmly and a paid voice call refreshes the balance (app/voicegen.jsx)
     M  the welcome cards' copy, the landing's trial line, app.jsx wiring, Home's auto-posters,
        the CSS
     Q  the New Story interview's voice: free-tier accounts use the browser's speech; refusals are
        quiet (round 5: a transcription refused with 400 switches to the browser's speech
        recognition; a spoken answer records 5 minutes at most) (app/newstory.jsx, app/voicegen.jsx)
     W  APP_FEATURES states the billing facts accurately; Frances receives none of them ("charged"
        included, round 5) but keeps the how-to (app/ai.jsx)
     X  a visual check re-encodes pictures the server doesn't take to JPEG; its bad_image sentence
        shows as is (app/ai.jsx aiVisionComplete, round 5)

   node scripts/test-billing-app.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execSync } from "node:child_process";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename) => transformSync(src, {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  plugins: ["@babel/plugin-transform-block-scoping"],
  babelrc: false, configFile: false, filename, compact: true,
}).code;

let checks = 0, failed = 0;
async function test(name, fn){
  try { await fn(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); }
}
const noop = () => {};
const plain = (x) => JSON.parse(JSON.stringify(x));   // vm-realm arrays/objects → this realm (deepEqual)
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
/* wait on a REAL signal (round 3, A8): turn the event loop until pred() holds, up to a bound (then the
   test's own asserts report what's missing) — never a fixed number of turns racing a timer */
const settleUntil = async (pred, maxMs = 2000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 1)); await settle(); };

/* ── a tiny element tree + hook stub (renders function components for text checks) ── */
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
const walk = (n, f) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach((x) => walk(x, f)); return; } f(n); (n.children || []).forEach((x) => walk(x, f)); };
const findAll = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const hasClass = (c) => (n) => String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (!n || typeof n !== "object") ? ""
  : Array.isArray(n) ? n.map(textOf).join("") : (n.children || []).map(textOf).join("");
function makeReact(){
  const R = { Fragment: "fragment", createElement: el, state: null, calls: 0, sets: [],
    useState(init){ const i = R.calls++; const v = (R.state && i in R.state) ? R.state[i] : (typeof init === "function" ? init() : init);
      return [v, (nv) => { R.sets.push([i, nv]); R.state = { ...(R.state || {}), [i]: typeof nv === "function" ? nv(v) : nv }; }]; },
    useEffect(f){ R.effects.push(f); }, effects: [], useRef: (v) => ({ current: v === undefined ? null : v }), useMemo: (f) => f(), useCallback: (f) => f, useLayoutEffect(){},
    reset(state){ R.state = state || null; R.calls = 0; R.effects = []; R.sets = []; } };
  return R;
}
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
function box(extra){
  const React = makeReact();
  const b = { console, React, Icon: new Proxy({}, { get: () => () => null }), ReactDOM: { createRoot: () => ({ render: (x) => { b.rendered.push(x); }, unmount: noop }) }, rendered: [],
    document: { addEventListener: noop, removeEventListener: noop, createElement: () => ({ style: {} }), body: { appendChild: noop, removeChild: noop }, getElementById: () => null },
    localStorage: mkStore(), sessionStorage: mkStore(), events: [], toasts: [], opened: [], assigned: [],
    CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } },
    addEventListener: noop, removeEventListener: noop,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    location: { hostname: "localhost", href: "", search: "", hash: "", origin: "", assign(u){ b.assigned.push(u); } },
    open(u){ b.opened.push(u); }, navigator: { userAgent: "node-test", onLine: true }, ...(extra || {}) };
  b.dispatchEvent = (ev) => { b.events.push(ev); return true; };
  b.appToast = (m, k) => b.toasts.push({ m, k });
  b.window = b; b.globalThis = b; vm.createContext(b); return b;
}
const run = (b, f) => vm.runInContext(transform(read(f), f), b, { filename: f });
/* no confirm step before a checkout (owner decision 2026-10-02, E1 — the "Before you pay" dialog of
   2026-10-01 is gone): a purchase click opens the payment page itself; nothing is mounted first */
async function noStepMounted(B){
  assert.equal(B.rendered.length, 0, "a purchase click mounts no confirm step");
  assert.equal(B.CheckoutConsentDialog, undefined, "the dialog is gone");
  await settle();
}

/* ════════ A–H: app/plans.jsx ════════ */
const P = box({ CREDIT_SCALE: 10 });
run(P, "app/plans.jsx");
const paidFn = (plan) => { const p = String(plan || "").toLowerCase().trim(); return !!p && p !== "none" && p !== "free" && p !== "trial"; };

await test("A Option A allowances for new subscribers at unchanged prices: Writer $19/600, Director $49/1,600, Producer $149/5,000", () => {
  assert.deepEqual(plain(P.CINEMA_PLANS.map((p) => [p.tier, p.name, p.price, p.credits])),
    [["writer", "Writer", "$19", 600], ["director", "Director", "$49", 1600], ["studio", "Producer", "$149", 5000]]);
  assert.deepEqual(plain(P.CINEMA_PLANS.map((p) => p.features[0])), ["600 credits / month", "1,600 credits / month", "5,000 credits / month"]);
  assert.equal(P.CINEMA_PLANS[1].popular, true);
  assert.deepEqual({ ...P.TURN_LEGACY_ALLOWANCES }, { writer: 2400, director: 7200, studio: 27000, pro: 7200 }, "grandfathered = old allowance x3");
});
await test("A a saved plan-copy override that still says '800 credits / month' shows the current grant; other lines stay the admin's", () => {
  P.turnApplyPlanCopy({ writer: { features: ["800 credits / month", "Writers' Room", "Priority email"] }, studio: { features: ["9,000 credits per month", "Everything"] } });
  assert.deepEqual(Array.from(P.CINEMA_PLANS[0].features), ["600 credits / month", "Writers' Room", "Priority email"]);
  assert.deepEqual(Array.from(P.CINEMA_PLANS[2].features), ["5,000 credits / month", "Everything"]);
  P.turnApplyPlanCopy({ writer: { features: ["600 credits / month", "Writers' Room", "Story spine, beats and screenplay"] },
    studio: { features: ["5,000 credits / month", "Writers' Room + Art Room + Stage", "Video, voice, timeline and production assets"] } });
});
await test("A the free-trial copy says only what 50 credits buy (F20) and names what each plan adds (F27)", () => {
  assert.equal(P.TURN_TRIAL_CREDITS, 50);
  assert.equal(P.TURN_TRIAL_COPY, "New accounts get 50 free credits after confirming their email — enough to try the Writers' Room on the lighter writing engine (a logline, a synopsis, the spine and its first scenes), plus draft images.");
  assert.equal(P.TURN_TIER_ADDS, "Writer adds every writing engine and every image engine up to 2K; Director adds the Art Room and 4K images; Producer adds the Stage and video.");
  assert.equal(P.TURN_DRAFT_IMAGE.model, "gemini-nano-banana-2.1");
  assert.equal(P.TURN_DRAFT_IMAGE.maxRes, "1K");
});

const renderPlans = (opts = {}) => {
  P.turnUserId = opts.uid === undefined ? "u-1" : opts.uid;
  P.turnCreditBalance = opts.balance || null;
  P.turnIsPaidPlan = paidFn;
  P.turnIsAdmin = !!opts.admin;
  P.turnOpenBillingPortal = opts.portal;
  P.React.reset(opts.state);
  P.usePlansVersion = () => 0;
  return P.PlansModal({ onClose: opts.onClose || noop, currentPlan: opts.balance ? opts.balance.plan : null });
};

await test("B packs: 250 for $10, 1,000 for $35, 3,000 for $99 (3,000 flagged best value); the owner's links (2026-10-01): live on the live hosts, test-mode elsewhere, none of the old packs' live links", () => {
  assert.deepEqual(plain(P.CINEMA_CREDIT_PACKS.map((p) => [p.sku, p.credits, p.price, !!p.popular])),
    [["pack-250", 250, "$10", false], ["pack-1000", 1000, "$35", false], ["pack-3000", 3000, "$99", true]]);
  const LIVE = ["https://buy.stripe.com/fZu6oJ8bib6r0uU9Dlc7u06", "https://buy.stripe.com/dRm00l2QY2zV4La5n5c7u07", "https://buy.stripe.com/5kQ6oJ63a0rN5PeeXFc7u08"];
  const TEST = ["https://buy.stripe.com/test_8x200l77e1vR4La7vdc7u05", "https://buy.stripe.com/test_9B6cN73V28YjfpO02Lc7u04", "https://buy.stripe.com/test_8x200l63a2zVfpO9Dlc7u03"];
  assert.deepEqual(plain(P.CINEMA_CREDIT_PACKS.map((p) => p.live)), LIVE);
  assert.deepEqual(plain(P.CINEMA_CREDIT_PACKS.map((p) => p.test)), TEST);
  const oldLive = plain(P.TURN_LEGACY_CREDIT_PACKS.map((p) => p.live));
  assert.ok(P.CINEMA_CREDIT_PACKS.every((p) => !oldLive.includes(p.live)), "no old 300/1,200/4,000 link is reused for a new pack");
  P.location.hostname = "kinolot.infinitestudioai.com";
  assert.deepEqual(plain(P.CINEMA_CREDIT_PACKS.map((p) => P.turnCreditPackLink(p))), LIVE, "live host: the live links");
  P.location.hostname = "localhost";
  assert.deepEqual(plain(P.CINEMA_CREDIT_PACKS.map((p) => P.turnCreditPackLink(p))), TEST, "test host: the test-mode links");
});
await test("B empty slots render a disabled 'Coming soon' and clicking never opens a checkout; the section says 'for any account' and 12 months", () => {
  const savedLinks = P.CINEMA_CREDIT_PACKS.map((p) => [p.test, p.live]);
  P.CINEMA_CREDIT_PACKS.forEach((p) => { p.test = ""; p.live = ""; });
  try {
  const m = renderPlans({ balance: { remaining: 40, plan: "none", trial: true } });
  const packs = findAll(m, hasClass("credit-pack"));
  assert.equal(packs.length, 3);
  const btns = packs.map((p) => findAll(p, hasClass("plan-cta"))[0]);
  assert.deepEqual(plain(btns.map(textOf)), ["Coming soon", "Coming soon", "Coming soon"]);
  assert.ok(btns.every((b) => b.props.disabled === true));
  btns.forEach((b) => b.props.onClick());
  assert.equal(P.opened.length + P.assigned.length, 0, "no checkout opened");
  const sub = textOf(findAll(m, hasClass("credit-packs-sub"))[0]);
  assert.equal(sub, "One-off packs for any account. Pack credits last 12 months and are never reset when your plan renews — your plan’s monthly credits are used first. Without a plan, credits cover writing on the default engines and draft images.");
  assert.ok(!/active subscription/i.test(JSON.stringify(m)), "the old 'active subscriptions only' rule is gone");
  } finally { P.CINEMA_CREDIT_PACKS.forEach((p, i) => { p.test = savedLinks[i][0]; p.live = savedLinks[i][1]; }); }
});
await test("B once a link is pasted, ANY signed-in account (no plan) can buy: the checkout carries the user id", async () => {
  const pack = P.CINEMA_CREDIT_PACKS[0];
  const savedTest = pack.test;
  pack.test = "https://buy.stripe.com/test_pack250";
  try {
    P.opened.length = 0;
    const m = renderPlans({ balance: { remaining: 0, plan: "none" } });
    const btn = findAll(findAll(m, hasClass("credit-pack"))[0], hasClass("plan-cta"))[0];
    assert.equal(textOf(btn), "Buy 250");
    assert.equal(btn.props.disabled, false);
    P.rendered.length = 0;
    btn.props.onClick();
    assert.equal(P.opened.length, 1, "E1 (2026-10-02): the click opens the payment page, no step first");
    await noStepMounted(P);
    assert.match(P.opened[0], /^https:\/\/buy\.stripe\.com\/test_pack250\?client_reference_id=u-1/);
    assert.equal(P.toasts.filter((t) => /Choose a monthly plan first/.test(t.m)).length, 0);
  } finally { pack.test = savedTest; }
});
await test("B signed out: the Plans window shows the trial line", () => {
  const m = renderPlans({ uid: null });
  assert.equal(textOf(findAll(m, hasClass("plans-trial"))[0]), P.TURN_TRIAL_COPY);
  assert.deepEqual(findAll(m, hasClass("plan-cta")).slice(0, 3).map(textOf), ["Choose Writer", "Choose Director", "Choose Producer"]);
});
await test("B a trial account sees its remaining trial credits and what a plan adds", () => {
  const m = renderPlans({ balance: { remaining: 32, plan: "none", trial: true } });
  assert.equal(textOf(findAll(m, hasClass("plans-trial"))[0]),
    "Free trial: 32 of 50 credits left — for writing on the default engines and draft images. Writer adds every writing engine and every image engine up to 2K; Director adds the Art Room and 4K images; Producer adds the Stage and video.");
});

await test("C a paying subscriber's other plans read 'Switch to …' and never open a payment link; the note explains the switch", () => {
  P.opened.length = 0; P.assigned.length = 0;
  const m = renderPlans({ balance: { remaining: 900, plan: "writer" } });
  const ctas = findAll(m, hasClass("plan-cta")).slice(0, 3);
  assert.deepEqual(ctas.map(textOf), ["Current plan", "Switch to Director", "Switch to Producer"]);
  assert.equal(ctas[0].props.disabled, true);
  ctas[1].props.onClick();
  assert.equal(P.opened.length + P.assigned.length, 0, "no second subscription");
  const again = renderPlans({ balance: { remaining: 900, plan: "writer" }, state: P.React.state });
  const note = findAll(again, hasClass("plans-switch-note"))[0];
  assert.ok(note, "switch note shown");
  assert.equal(textOf(note), "To switch plans, write to kinolot-billing@infinitestudioai.com from your account email and we’ll move you over — you won’t be charged twice.");
  assert.match(findAll(note, (n) => n.type === "a")[0].props.href, /^mailto:kinolot-billing@infinitestudioai\.com\?subject=/);
  assert.equal(textOf(findAll(again, hasClass("plans-title"))[0]), "Your plan");
});
await test("C the Plans window's Manage plan button appears for subscribers only when the billing portal is available", () => {
  let portal = 0;
  const withPortal = renderPlans({ balance: { remaining: 900, plan: "director" }, portal: () => { portal++; } });
  const btn = findAll(withPortal, hasClass("plans-manage"))[0];
  assert.ok(btn); btn.props.onClick(); assert.equal(portal, 1);
  assert.equal(findAll(renderPlans({ balance: { remaining: 900, plan: "director" } }), hasClass("plans-manage")).length, 0);
  assert.equal(findAll(renderPlans({ balance: { remaining: 20, plan: "none" }, portal: noop }), hasClass("plans-manage")).length, 0);
});
await test("C the Plans window subtitle and footer", () => {
  const m = renderPlans({ balance: { remaining: 900, plan: "director" } });
  assert.equal(textOf(findAll(m, hasClass("plans-sub"))[0]), "Credits power every generation — writing, images, voice and video. Cancel anytime from Manage plan.");
  assert.equal(textOf(findAll(m, hasClass("plans-foot"))[0]), "Secure checkout by Stripe · Kinolot by Infinite Studio AI · Billing questions: kinolot-billing@infinitestudioai.com");
});

await test("D balance parts + readout: plan credits + pack credits with the next pack expiry", () => {
  const b = { remaining: 1234, plan: "director", planRemaining: 1000, packRemaining: 234, nextPackExpiry: "2027-09-12T10:00:00Z", paymentStatus: "active", frozen: false, trial: false };
  const parts = P.turnBalanceParts(b);
  assert.equal(parts.total, 1234); assert.equal(parts.plan, 1000); assert.equal(parts.pack, 234); assert.equal(parts.hasSplit, true);
  assert.equal(parts.paid, true); assert.equal(parts.pastDue, false); assert.equal(parts.frozen, false);
  assert.equal(P.turnCreditBreakdownText(b), "1,234 credits · 1,000 plan + 234 pack (pack credits expire from 12 Sept 2027)".replace("Sept", new Date("2027-09-12").toLocaleDateString("en-GB", { month: "short" })));
  const m = renderPlans({ balance: b });
  assert.match(textOf(findAll(m, hasClass("plans-balance"))[0]), /^Your balance: 1,234 credits · 1,000 plan \+ 234 pack \(pack credits expire from 12 /);
});
await test("D graceful fallback: a database without the pack columns still reads as one total", () => {
  const b = { remaining: 480, plan: "writer", planRemaining: null, packRemaining: null, nextPackExpiry: null, paymentStatus: null, frozen: false, trial: false };
  const parts = P.turnBalanceParts(b);
  assert.equal(parts.total, 480); assert.equal(parts.hasSplit, false); assert.equal(parts.paymentStatus, "active");
  assert.equal(P.turnCreditBreakdownText(b), "480 credits");
  assert.equal(P.turnCreditBreakdownText({ remaining: 1, plan: "none" }), "1 credit");
  assert.equal(P.turnCreditBreakdownText({ remaining: 700, plan: "writer", planRemaining: 700, packRemaining: 0 }), "700 credits", "no '+ 0 pack'");
  assert.equal(P.turnBalanceParts(null), null);
});

/* E — low-balance step. Each reading here is the first of its own page session (as on a reload), so
   the hold-settle rule (F29, tested on its own below) never delays them. */
const bal = (plan, planRemaining, packRemaining = 0, extra = {}) => ({ remaining: planRemaining + packRemaining, plan, planRemaining, packRemaining, ...extra });
let _sid = 0;
const origLowStep = P.turnLowBalanceStep;
const lowStepFresh = (prev, b, o = {}) => origLowStep(prev, b, { session: "load-" + (++_sid), ...o });
await test("E Director (1,600): nothing at 25%, the 20% notice at 320, the 5% notice at 80; dismissals hold for the cycle", () => {
  P.turnIsAdmin = false;
  let r = lowStepFresh(null, bal("director", 1600)); assert.equal(r.level, 0); assert.equal(r.allowance, 1600);
  r = lowStepFresh(r.state, bal("director", 400)); assert.equal(r.level, 0);
  r = lowStepFresh(r.state, bal("director", 320)); assert.equal(r.level, 20);
  let s = P.turnLowBalanceDismiss(r.state, 20);
  r = lowStepFresh(s, bal("director", 300)); assert.equal(r.level, 0, "20% dismissed: silent");
  r = lowStepFresh(r.state, bal("director", 80)); assert.equal(r.level, 5);
  s = P.turnLowBalanceDismiss(r.state, 5);
  r = lowStepFresh(s, bal("director", 40)); assert.equal(r.level, 0, "5% dismissed: silent");
  r = lowStepFresh(r.state, bal("director", 1600)); assert.equal(r.level, 0, "renewal");
  r = lowStepFresh(r.state, bal("director", 300)); assert.equal(r.level, 20, "a new cycle shows it again");
});
await test("E a hold refund inside the cycle does not reset a dismissed notice unless it is a real refill; dismissing 5% also silences 20%", () => {
  let r = lowStepFresh(null, bal("director", 1600));
  r = lowStepFresh(r.state, bal("director", 60)); assert.equal(r.level, 5);
  const s = P.turnLowBalanceDismiss(r.state, 5);
  r = lowStepFresh(s, bal("director", 200)); assert.equal(r.level, 0, "a small refund: 20% is silenced by the 5% dismissal");
});
await test("E a grandfathered Director (7,200 in new units) is judged against 7,200, not 1,600", () => {
  let r = lowStepFresh(null, bal("director", 7200)); assert.equal(r.allowance, 7200);
  r = lowStepFresh(r.state, bal("director", 1500)); assert.equal(r.level, 0);
  r = lowStepFresh(r.state, bal("director", 1400)); assert.equal(r.level, 20);
  r = lowStepFresh(r.state, bal("director", 350)); assert.equal(r.level, 5);
});
await test("E pack credits count toward what's left; a server allowance wins when present; admin and cancelled accounts get none", () => {
  let r = lowStepFresh(null, bal("director", 100, 500)); assert.equal(r.level, 0, "100 plan + 500 pack = 37%");
  r = lowStepFresh(null, bal("writer", 200, 0, { allowance: 2400 })); assert.equal(r.allowance, 2400); assert.equal(r.level, 20);
  P.turnIsAdmin = true; r = lowStepFresh(null, bal("studio", 1)); assert.equal(r.level, 0); P.turnIsAdmin = false;
  r = lowStepFresh(null, bal("none", 5)); assert.equal(r.level, 0);
});
await test("E the trial is judged against its 50 credits", () => {
  let r = lowStepFresh(null, bal("none", 50, 0, { trial: true })); assert.equal(r.level, 0); assert.equal(r.allowance, 50);
  r = lowStepFresh(r.state, bal("none", 10, 0, { trial: true })); assert.equal(r.level, 20);
  r = lowStepFresh(r.state, bal("none", 2, 0, { trial: true })); assert.equal(r.level, 5);
});
await test("E the notice copy: paid 20% / 5%, trial 20% / 5%", () => {
  const n20 = P.turnBillingNoticeList(bal("director", 300), 20, 1600)[0];
  assert.equal(n20.title, "Running low on credits.");
  assert.equal(n20.body, "300 of your 1,600 monthly credits left. Top up with a credit pack (they last 12 months) or upgrade your plan.");
  assert.equal(n20.action, "Get credits"); assert.equal(n20.dismissible, true);
  const n5 = P.turnBillingNoticeList(bal("director", 70), 5, 1600)[0];
  assert.equal(n5.title, "Almost out of credits.");
  assert.equal(n5.body, "Only 70 credits left. Generations stop when your balance can’t cover them.");
  const t20 = P.turnBillingNoticeList(bal("none", 9, 0, { trial: true }), 20, 50)[0];
  assert.equal(t20.title, "Your free trial is running low.");
  assert.equal(t20.body, "9 of your 50 free credits left. Choose a plan to keep writing. Writer adds every writing engine and every image engine up to 2K; Director adds the Art Room and 4K images; Producer adds the Stage and video.");
  const t5 = P.turnBillingNoticeList(bal("none", 2, 0, { trial: true }), 5, 50)[0];
  assert.equal(t5.title, "Your free trial is almost used up.");
  assert.equal(t5.body, "2 free credits left. Choose a plan to keep creating.");
});
await test("E BillingNotices renders the notice, and Dismiss persists it per account (it stays gone on the next render)", () => {
  P.localStorage = mkStore(); P.turnUserId = "u-lb"; P.turnIsAdmin = false;
  // the Terms banner (live since the switch day, TERMS_UPDATED_AT) has its own tests; this account has read it
  P.localStorage.setItem("turn-terms-notice:u-lb", P.TURN_TERMS_UPDATED_AT);
  P.React.reset();
  P.BillingNotices({ balance: bal("director", 1600), session: "r1" });
  P.React.effects.forEach((f) => f());
  P.React.reset();
  let tree = P.BillingNotices({ balance: bal("director", 300), session: "r2" });
  P.React.effects.forEach((f) => f());
  assert.ok(tree, "a banner renders");
  const banner = findAll(tree, hasClass("billing-banner"))[0];
  assert.equal(textOf(findAll(banner, hasClass("billing-banner-act"))[0]), "Get credits");
  findAll(banner, hasClass("billing-banner-x"))[0].props.onClick();
  assert.ok(P.localStorage.getItem("turn-billing-notices:u-lb").includes('"20":true'));
  P.React.reset();
  tree = P.BillingNotices({ balance: bal("director", 290), session: "r3" });
  assert.equal(tree, null, "dismissed for this cycle");
});

await test("F past_due → 'Payment failed — update your card.'; frozen → 'Account on hold.'; both open Manage plan (portal, else Plans)", () => {
  P.turnIsAdmin = false;
  const pd = P.turnBillingNoticeList(bal("writer", 500, 0, { paymentStatus: "past_due" }), 0, 600);
  assert.equal(pd.length, 1);
  assert.equal(pd[0].title, "Payment failed — update your card.");
  assert.equal(pd[0].body, "We couldn’t take your last payment. Your credits still work while we retry, but your monthly refill is paused until the card is updated.");
  assert.equal(pd[0].action, "Update card");
  const fr = P.turnBillingNoticeList(bal("writer", 40, 0, { frozen: true }), 20, 600);
  assert.equal(fr.length, 1, "on hold hides the low-balance notice");
  assert.equal(fr[0].title, "Account on hold.");
  assert.equal(fr[0].body, "A payment on this account is being disputed, so spending credits is paused until it’s resolved. Write to kinolot-billing@infinitestudioai.com if this is a mistake.");
  let portal = 0, plans = 0;
  P.turnOpenPlans = () => { plans++; };
  P.turnOpenBillingPortal = () => { portal++; };
  P.React.reset();
  const tree = P.BillingNotices({ balance: bal("writer", 500, 0, { paymentStatus: "past_due" }) });
  findAll(tree, hasClass("billing-banner-act"))[0].props.onClick();
  assert.equal(portal, 1); assert.equal(plans, 0);
  P.turnOpenBillingPortal = undefined;
  findAll(tree, hasClass("billing-banner-act"))[0].props.onClick();
  assert.equal(plans, 1, "no portal → the Plans window");
  assert.equal(findAll(tree, hasClass("billing-banner"))[0].props.role, "alert");
  P.turnIsAdmin = true;
  assert.equal(P.turnBillingNoticeList(bal("writer", 500, 0, { paymentStatus: "past_due", frozen: true }), 0, 600).length, 0, "admin: none");
  P.turnIsAdmin = false;
});

await test("F (A3) closing 'Payment failed' or 'Account on hold' closes it in BOTH mounts (studio and Home) for the page session; the other mount re-renders; another account still sees its own; a reload shows it again", () => {
  P.turnIsAdmin = false; P.localStorage = mkStore(); P.turnUserId = "u-a3";
  // the Terms banner (live since the switch day) has its own tests; these accounts have read it
  for (const u of ["u-a3", "u-a3b", "u-other"]) P.localStorage.setItem("turn-terms-notice:" + u, P.TURN_TERMS_UPDATED_AT);
  for (const [extra, title] of [[{ paymentStatus: "past_due" }, "Payment failed — update your card."], [{ frozen: true }, "Account on hold."]]) {
    const b = bal("writer", 500, 0, extra);
    const titles = (tree) => findAll(tree, hasClass("billing-banner")).map((n) => textOf(findAll(n, (x) => x.type === "b")[0]).trim());
    // the studio's copy is mounted (and listening) under Home
    P.React.reset();
    const studio = P.BillingNotices({ balance: b, session: "a3" });
    assert.deepEqual(titles(studio), [title]);
    P.React.effects.forEach((f) => f());
    // Home's copy: the user closes the banner there
    P.React.reset();
    const home = P.BillingNotices({ balance: b, session: "a3" });
    const x = findAll(findAll(home, hasClass("billing-banner"))[0], hasClass("billing-banner-x"))[0];
    x.props.onClick();
    assert.ok(P.React.sets.length >= 1, "the studio's copy was told to re-render");
    P.React.reset();
    assert.equal(P.BillingNotices({ balance: b, session: "a3" }), null, "closed in the studio too");
    P.React.reset();
    assert.equal(P.BillingNotices({ balance: b, session: "a3" }), null, "and on Home's next render");
    P.turnUserId = "u-a3-other"; P.React.reset();
    assert.deepEqual(titles(P.BillingNotices({ balance: b, session: "a3" })), [title], "another account's banner is its own");
    P.turnUserId = "u-a3";
    // a reload (a fresh copy of the module) shows it again while it is still true
    const P2 = box({ CREDIT_SCALE: 10 }); run(P2, "app/plans.jsx");
    P2.turnUserId = "u-a3"; P2.turnIsAdmin = false; P2.turnIsPaidPlan = paidFn; P2.React.reset();
    assert.deepEqual(titles(P2.BillingNotices({ balance: b, session: "a3r" })), [title], "a reload shows it again");
  }
  assert.ok(!/const \[closed, setClosed\] = React\.useState/.test(read("app/plans.jsx")), "no per-mount closed state");
});

await test("G billing refusals: no plan / not enough credits open the Plans window; frozen does not; any other 402 is a payment refusal; everything else is not billing", () => {
  const np = P.turnBillingError({ error: "no_plan" }, 402);
  assert.equal(np.code, "no_plan"); assert.equal(np.openPlans, true);
  assert.equal(np.message, "Choose a plan to start creating — every generation runs on your plan's credits.", "fallback copy for an older deploy");
  assert.equal(P.turnBillingError({ error: "plan_required", code: "plan_required", message: "Video needs a paid plan." }, 402).message, "Video needs a paid plan.", "the server's own sentence wins");
  assert.equal(P.turnBillingError({ error: "tier_required", code: "tier_required", message: "4K images needs the Director plan." }, 403).openPlans, true);
  assert.equal(P.turnBillingError({ error: "account_frozen", code: "account_frozen", message: "On hold." }, 403).openPlans, false);
  assert.equal(P.turnBillingError({ error: "billing_unavailable", code: "billing_unavailable", message: "Try later." }, 503).openPlans, false);
  assert.equal(P.turnBillingError({ error: "model_not_allowed", code: "model_not_allowed", message: "That video engine isn't available." }, 400).message, "That video engine isn't available.");
  const ins = P.turnBillingError({ error: "insufficient_credits", message: "This generation needs 304 credits, but this account has 40." }, 402);
  assert.equal(ins.message, "This generation needs 304 credits, but this account has 40."); assert.equal(ins.openPlans, true);
  const hold = P.turnBillingError({ ok: false, code: "insufficient" }, 402);
  assert.equal(hold.message, "Not enough credits for this. Top up with a credit pack or upgrade your plan.");
  const fz = P.turnBillingError({ code: "frozen" }, 402);
  assert.equal(fz.openPlans, false); assert.match(fz.message, /^Your account is on hold while a payment is disputed/);
  assert.equal(P.turnBillingError({ code: "trial_not_allowed" }, 403).message, "This needs a paid plan. Without a plan, credits cover writing and draft images.");
  assert.equal(P.turnBillingError(null, 402).code, "payment_required");
  assert.equal(P.turnBillingError({ error: "fal said no" }, 500), null);
  assert.equal(P.turnBillingError({ error: "Video model x isn't allowed" }, 400), null);
  let plans = 0; P.turnOpenPlans = () => { plans++; };
  P.events.length = 0;
  assert.equal(P.turnHandleBillingError(ins), ins.message); assert.equal(plans, 1);
  assert.equal(P.turnHandleBillingError(fz), fz.message); assert.equal(plans, 1, "frozen: no Plans window");
  assert.ok(P.events.some((e) => e.type === "turn-credits-changed"), "balance refresh asked");
});

await test("H the plan chosen before sign-up: this browser (20 min) or the ACCOUNT (48 h, another browser) → checkout once", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const pick = P.turnPickIntendedPlan;
  const ready = { balance: { remaining: 0, plan: "none" }, balanceReady: true, now };
  assert.deepEqual({ ...pick({ ...ready, local: "director", localAt: now - 60e3 }) }, { action: "checkout", plan: "director" });
  assert.deepEqual({ ...pick({ ...ready, local: null, account: { plan: "studio", at: now - 5 * 3600e3 } }) }, { action: "checkout", plan: "studio" }, "confirmed in another browser hours later");
  assert.deepEqual({ ...pick({ ...ready, local: "writer", localAt: now - 30 * 60e3, account: { plan: "writer", at: now - 30 * 60e3 } }) }, { action: "checkout", plan: "writer" }, "stale in the browser, fresh on the account");
  assert.equal(pick({ ...ready, account: { plan: "director", at: now - 49 * 3600e3 } }).action, "clear", "older than 48 h");
  assert.equal(pick({ local: "director", localAt: now - 1e3, now, balanceReady: false }).action, "wait", "ledger first");
  assert.equal(pick({ ...ready, balance: { remaining: 1600, plan: "director" }, account: { plan: "director", at: now - 1e3 } }).action, "clear", "already paid (in the other browser): never a second checkout");
  assert.equal(pick({ ...ready, isAdmin: true, local: "writer", localAt: now - 1e3 }).action, "clear");
  assert.equal(pick({ ...ready, local: "free", localAt: now - 1e3 }).action, "none", "'free' is the other effect's job");
  assert.equal(pick({ ...ready }).action, "none");
  assert.equal(pick({ ...ready, account: { plan: "enterprise", at: now } }).action, "clear", "unknown tier");
});

/* ════════ I: the $0.01 anchor ════════ */
const R = box();
run(R, "app/pricing.jsx");
await test("I pricing.jsx: 1 visible credit = $0.01 of provider cost (base anchor $0.10 × scale 10)", () => {
  assert.equal(R.TURN_PRICING.credit.baseProviderUsd, 0.10);
  assert.equal(R.TURN_PRICING.credit.visibleProviderUsd, 0.01);
  assert.equal(R.CREDIT_SCALE, 10);
  assert.equal(Math.ceil(R.turnCreditsFromProviderUsd(0.12)), 12, "a $0.12 image");
  assert.equal(Math.ceil(R.turnCreditsFromProviderUsd(0.101)), 11, "today's table value → 11 (the review's number)");
  assert.equal(Math.ceil(R.turnCreditsFromProviderUsd(0.30)), 30);
});
await test("I video: 10 s of Seedance 2.0 720p = 304 credits (the review's number); the fallback rates in stage.jsx use the same anchor", () => {
  const rate = R.turnVideoCreditRate("seedance-2.0", "standard", "720p");
  assert.ok(Math.abs(rate - 3.034) < 1e-9, String(rate));
  assert.equal(Math.max(1, Math.ceil(10 * rate * R.CREDIT_SCALE)), 304);
  const stage = read("app/stage.jsx");
  assert.ok(stage.includes('{ "480p":1.52, "720p":3.04, "1080p":6.82, "4K":15.5 }'));
  assert.ok(stage.includes('{ "480p":1.21, "720p":2.42 }'));
  assert.ok(stage.includes('{ "480p":2.21, "720p":4.73, "1080p":11.64 }'));
  assert.ok(!/\{ "480p":0\.5, "720p":1, "1080p":2, "4K":5 \}/.test(stage), "old $0.03 fallback gone");
});
await test("I packs and plans in the pricing table; pack margins at full use ~65% (UK account, US cards)", () => {
  assert.deepEqual(plain(R.TURN_PRICING.packs.current.map((p) => [p.credits, p.priceUsd])), [[250, 10], [1000, 35], [3000, 99]]);
  assert.equal(R.TURN_PRICING.packs.validMonths, 12);
  assert.deepEqual(plain(R.TURN_PRICING.plans.map((p) => [p.tier, p.priceUsd, p.credits, p.legacyCredits])),
    [["writer", 19, 600, 2400], ["director", 49, 1600, 7200], ["studio", 149, 5000, 27000]]);
  assert.equal(R.TURN_PRICING.trialCredits, 50);
  assert.deepEqual(plain(R.TURN_PRICING.packs.current.map((p) => R.turnCreditPackEconomics(p).marginPercent)), [66.9, 65.4, 64.2]);
  assert.equal(R.TURN_PRICING.packs.saferSuggested, undefined);
  assert.equal(R.TURN_PRICING.text.creditRates["claude-opus-5-5"], 0.12, "text display fallback x3");
});
await test("I plans.jsx and pricing.jsx agree on the allowances; the webhook's metadata must match (Stripe plan_credits)", () => {
  assert.deepEqual(plain(P.CINEMA_PLANS.map((p) => p.credits)), plain(R.TURN_PRICING.plans.map((p) => p.credits)));
  assert.deepEqual(plain(P.CINEMA_CREDIT_PACKS.map((p) => p.credits)), plain(R.TURN_PRICING.packs.current.map((p) => p.credits)));
});

await test("I the client's tables ARE the server's (image-proxy billing-pricing.mjs / billing-policy.mjs): images, video, rounding, GPT size factor, draft images", async () => {
  const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  const pol = await import(new URL("supabase/functions/image-proxy/billing-policy.mjs", ROOT));
  assert.equal(srv.PROVIDER_USD_PER_CREDIT, R.TURN_PRICING.credit.visibleProviderUsd);
  assert.deepEqual(plain(R.TURN_PRICING.image.providerUsd), plain(srv.IMAGE_PROVIDER_USD));
  assert.deepEqual(plain(R.TURN_PRICING.video.providerUsdPerSecond), plain(srv.VIDEO_PROVIDER_USD_PER_SECOND));
  for (const usd of [0.005, 0.012, 0.034, 0.05, 0.08, 0.101, 0.12, 0.15, 0.158, 0.3, 1.517, 3.034, 23.25]) assert.equal(R.turnCreditCost(usd), srv.creditsFromUsd(usd), String(usd));
  for (const m of ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"]) for (const a of ["16:9", "9:16", "21:9", "1:1", "3:4", "4:3"]) for (const z of ["1K", "2K", "4K"])
    assert.ok(Math.abs(R.turnGptImageSizeFactor(m, a, z) - srv.gptImageSizeFactor(m, a, z)) < 1e-12, m + " " + a + " " + z);
  assert.deepEqual(plain(P.TURN_DRAFT_IMAGE), { ...plain(pol.DRAFT_IMAGE), label: "Nano Banana 2.1" });
  assert.deepEqual(plain(P.TURN_TRIAL_TEXT_MODELS), plain(pol.DEFAULT_TEXT_MODELS), "the default writing engines");
  P.turnIsAdmin = false; P.turnIsPaidPlan = paidFn;
  assert.equal(P.turnTextModelAllowed("claude-fable-5-2", { remaining: 50, plan: "none", trial: true }), false);
  assert.equal(P.turnTextModelAllowed("claude-opus-5-5", { remaining: 50, plan: "none", trial: true }), true);
  assert.equal(P.turnTextModelAllowed("claude-fable-5-2", { remaining: 500, plan: "writer" }), true);
  assert.equal(P.turnOnFreeTier({ remaining: 5, plan: "none" }), true);
  assert.equal(P.turnOnFreeTier({ remaining: 5, plan: "director" }), false);
  // video: the Stage's quote for 10 s of Seedance 2.0 720p equals the server's charge
  const rate = R.turnVideoCreditRate("seedance-2.0", "standard", "720p");
  assert.equal(Math.max(1, Math.ceil(10 * rate * R.CREDIT_SCALE - 1e-9)), srv.videoCost({ endpoint: "bytedance/seedance-2.0/reference-to-video", resolution: "720p", outputSeconds: 10 }).credits);
  const r25 = R.turnVideoCreditRate("seedance-2.5", "standard", "720p");
  assert.equal(Math.max(1, Math.ceil((5 + 8) * r25 * 0.6 * R.CREDIT_SCALE - 1e-9)),
    srv.videoCost({ endpoint: "bytedance/seedance-2.5/reference-to-video", resolution: "720p", outputSeconds: 5, inputVideoSeconds: 8 }).credits, "extension: (output + input) × 0.6");
  // every refusal code the server sends is one the client understands
  for (const r of [pol.planRequired("Video"), pol.tierRequired("The Stage", "studio"), pol.frozenRefusal(), pol.insufficientRefusal(30, 4), pol.billingUnavailable(), pol.modelNotAllowed("video")]) {
    const info = P.turnBillingError(r.body, r.status);
    assert.ok(info && info.message === r.body.message, JSON.stringify(r));
  }
});

/* imagegen: costs + draft images */
function imageBox(extra){
  const listeners = new Map();
  const b = box({
    Date, Promise, Math, JSON, Number, String, Object, Array, RegExp, Map, Set, Uint8Array, URL, AbortController, isFinite, parseInt, parseFloat, queueMicrotask,
    TURN_SUPABASE: { url: "https://supabase.test/", imageProxy: true, imageProxyFn: "fake-image-proxy" },
    turnSafeError: (v) => v, turnAttrError: (_k, _m, msg) => msg, turnIsContentBlock: () => false, turnApiKeysForProxy: () => ({}),
    React: { createElement: () => null, useState: (i) => [i, noop], useEffect: noop },
    Image: class {}, FileReader: class {}, Blob: class {}, atob: (s) => s, fetch: async () => { throw new Error("no fetch"); },
    ...(extra || {}),
  });
  b.addEventListener = (t, h) => { const l = listeners.get(t) || []; l.push(h); listeners.set(t, l); };
  return b;
}
const I = imageBox({ CREDIT_SCALE: 10 });
vm.runInContext(read("app/imagegen.jsx"), I, { filename: "app/imagegen.jsx" });
await test("I imagegen: without pricing.jsx the fallback anchor is also $0.01 and the fallback table is fal's; a batch costs count × the whole per-image price", () => {
  // the engines (2026-11-12, owner): Nano Banana 2.1, GPT Image 2.6 Flare / Sunburst, Seedream 5.5, Seedream 5 Pro
  I.localStorage.setItem("turn-nb-model", "gemini-nano-banana-2.1");
  I.localStorage.setItem("turn-nb-res", "2K");
  assert.ok(Math.abs(I.nbImageCredits({ model: "gemini-nano-banana-2.1", res: "2K" }) - 7) < 1e-9);
  assert.equal(I.nbImageCostText(1, { model: "gemini-nano-banana-2.1", res: "2K" }), "7");
  assert.equal(I.nbImageCostText(1, { model: "gemini-nano-banana-2.1", res: "1K" }), "5");
  assert.equal(I.nbImageCostText(3, { model: "seedream-5-pro", res: "2K", aspect: "16:9" }), "42", "Seedream 5 Pro 2K = $0.135");
  assert.equal(I.nbImageCostText(1, { model: "seedream-5-pro", res: "1K", aspect: "16:9" }), "7", "Seedream 5 Pro 1K = $0.0675");
  assert.equal(I.nbImageCostText(1, { model: "gemini-3-pro-image", res: "4K" }), "15", "Nano Banana Pro's old id is priced as Nano Banana 2.1");
  assert.ok(!/\/ 0\.30\)/.test(read("app/imagegen.jsx")), "old $0.30 base anchor gone");
});
await test("I with pricing.jsx loaded, GPT Image cost follows the output size (as the server prices it); fractions round per image", () => {
  const J = imageBox({ CREDIT_SCALE: 10 });
  run(J, "app/pricing.jsx");
  vm.runInContext(read("app/imagegen.jsx"), J, { filename: "app/imagegen.jsx" });
  assert.equal(J.nbImageCostText(1, { model: "gpt-image-2.6-sunburst", quality: "high", res: "2K", aspect: "16:9" }), "10", "$0.05268 × (2048×1152 / 1024×1024)^0.672 = $0.0908");
  assert.equal(J.nbImageCostText(1, { model: "gpt-image-2.6-sunburst", quality: "high", res: "4K", aspect: "16:9" }), "22", "$0.05268 × (3840×2160 / 1024×1024)^0.672 = $0.2115");
  assert.equal(J.nbImageCostText(1, { model: "gpt-image-2", quality: "high", res: "2K", aspect: "16:9" }), "10", "GPT Image 2's old id is priced as GPT Image 2.6 Sunburst");
  assert.equal(J.nbImageCostText(1, { model: "gpt-image-2.5-sunburst", quality: "high", res: "2K", aspect: "16:9" }), "10", "GPT Image 2.5 Sunburst's removed id (2026-11-12) is priced as 2.6 Sunburst");
  assert.equal(J.nbImageCostText(1, { model: "gpt-image-2.5-flare", quality: "low", res: "1K", aspect: "1:1" }), J.nbImageCostText(1, { model: "gpt-image-2.6-flare", quality: "low", res: "1K", aspect: "1:1" }), "…and 2.5 Flare as 2.6 Flare, at 2.6's low price");
  assert.equal(J.nbImageCostText(1, { model: "gpt-image-2.6-flare", quality: "low", res: "1K", aspect: "1:1" }), "3", "2.6 low at 1024x1024 = $0.02469 (2.5's was 1 credit)");
  assert.equal(J.nbImageCostText(2, { model: "gemini-nano-banana-2.1", res: "1K" }), "10");
  assert.equal(J.nbImageCostText(1, { model: "gemini-nano-banana-2.1", res: "2K" }), "7");
  assert.equal(J.nbImageCostText(1, { model: "gemini-nano-banana-2.1", res: "4K" }), "15");
  assert.equal(J.nbImageCostText(2, { model: "gemini-3.1-flash-lite-image", res: "1K" }), "10", "Lite's old id is priced as Nano Banana 2.1");
  assert.equal(J.turnCreditCost(0.3), 30); assert.equal(J.turnCreditCost(0.034), 4); assert.equal(J.turnCreditCost(0), 1);
});
await test("I trial / no-plan accounts: the cost chip and the request use the draft engine (Nano Banana 2.1, 1K, no GPT quality)", async () => {
  run(I, "app/plans.jsx");
  I.turnIsPaidPlan = paidFn; I.turnIsAdmin = false;
  I.turnCreditBalance = { remaining: 50, plan: "none", trial: true };
  assert.deepEqual({ ...I.turnPlanImageChoice("gpt-image-2.6-sunburst", "4K") }, { model: "gemini-nano-banana-2.1", res: "1K", limited: true });
  assert.deepEqual({ ...I.turnPlanImageChoice("seedream-5-pro", "2K") }, { model: "gemini-nano-banana-2.1", res: "1K", limited: true });
  assert.deepEqual({ ...I.turnPlanImageChoice("gemini-nano-banana-2.1", "2K") }, { model: "gemini-nano-banana-2.1", res: "1K", limited: true });
  assert.deepEqual({ ...I.turnPlanImageChoice("gemini-3.1-flash-lite-image", "1K") }, { model: "gemini-nano-banana-2.1", res: "1K", limited: false }, "Lite's old id is the draft engine");
  assert.equal(I.nbImageCostText(1, { model: "gpt-image-2.6-sunburst", quality: "high" }), "5", "Nano Banana 2.1 at 1K = $0.05");
  const calls = [];
  I.proxyGenerate = async (prompt, opts, provider) => { calls.push({ prompt, opts: { ...opts }, provider }); return "data:image/png;base64,X"; };
  I.nbAssertMediaIdentity = noop;
  await I.nbGenerate("poster", { model: "gpt-image-2.6-sunburst", quality: "high", imageSize: "4K", aspectRatio: "9:16" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.model, "gemini-nano-banana-2.1");
  assert.equal(calls[0].opts.imageSize, "1K");
  assert.equal("quality" in calls[0].opts, false);
  assert.equal(calls[0].opts.aspectRatio, "9:16");
  assert.equal(I.toasts.filter((t) => /^Without a plan, images are drafts \(Nano Banana 2\.1 at 1K\)\. Choose a plan for every image engine\.$/.test(t.m)).length, 1);
  await I.nbGenerate("again", { model: "gpt-image-2.6-sunburst", imageSize: "1K" });
  assert.equal(calls[1].opts.imageSize, "1K");
  assert.equal(I.toasts.filter((t) => /^Without a plan, images are drafts \(Nano Banana 2\.1 at 1K\)\. Choose a plan for every image engine\.$/.test(t.m)).length, 1, "told once");
  I.turnCreditBalance = { remaining: 900, plan: "director" };
  await I.nbGenerate("paid", { model: "gpt-image-2.6-sunburst", quality: "high", imageSize: "4K" });
  assert.equal(calls[2].opts.model, "gpt-image-2.6-sunburst"); assert.equal(calls[2].opts.quality, "high");
  I.turnCreditBalance = { remaining: 50, plan: "none", trial: true }; I.turnIsAdmin = true;
  await I.nbGenerate("admin", { model: "gpt-image-2.6-sunburst", quality: "high" });
  assert.equal(calls[3].opts.model, "gpt-image-2.6-sunburst", "admin is never limited");
  I.turnIsAdmin = false; I.turnCreditBalance = null;
  await I.nbGenerate("dev", { model: "gpt-image-2.6-sunburst", quality: "high" });
  assert.equal(calls[4].opts.model, "gpt-image-2.6-sunburst", "no ledger (local/dev): unchanged — the server stays the gate");
  await I.nbGenerate("old", { model: "gpt-image-2", quality: "high" });
  assert.equal(calls[5].opts.model, "gpt-image-2.6-sunburst", "an old option naming GPT Image 2 renders on 2.6 Sunburst");
  await I.nbGenerate("old25", { model: "gpt-image-2.5-flare", quality: "medium" });
  assert.equal(calls[6].opts.model, "gpt-image-2.6-flare", "an option naming the removed GPT Image 2.5 Flare (2026-11-12) renders on 2.6 Flare");
  assert.equal(calls[6].opts.quality, "medium", "…with the same quality setting");
});

/* ════════ J: videogen — the server charges ════════ */
function videoBox(){
  const V = box({ Date, Math, JSON, Promise, Image: class {}, requestAnimationFrame: noop, cancelAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }) });
  V.setTimeout = (fn, ms) => { const t = setTimeout(fn, ms); if (ms >= 1000 && t && t.unref) t.unref(); return t; };
  V.nbCloudScope = () => ({ projectId: "p1", uid: "u1", epoch: 1 });
  V.nbEpoch = () => 1;
  V.cloudCommitVideo = async () => ({ ok: true });
  V.cloudVideoDelete = async () => ({ ok: true });
  V.cloudVideoLoadAll = async () => null;
  V.TURN_SUPABASE = { url: "u", anonKey: "k", imageProxy: true, imageProxyFn: "image-proxy" };
  V.submits = []; V.mode = "ok";
  V.sbClient = () => ({ functions: { invoke: async (fn, { body }) => {
    if (body.op === "submit") {
      V.submits.push(body);
      if (V.mode === "insufficient") {
        const ctx = { status: 402, json: async () => ({ error: "insufficient_credits", message: "This generation needs 304 credits, but this account has 12.", creditsRequired: 304 }) };
        ctx.clone = () => ctx;
        return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } };
      }
      return { data: { requestId: "rq-" + V.submits.length, statusUrl: "s-live", responseUrl: "r", status: "IN_QUEUE" } };
    }
    if (body.op === "poll") {
      if (V.mode === "fail") return { data: { status: "FAILED", error: "provider failed" } };
      if (body.statusUrl === "s-rec") return { data: { status: "COMPLETED", videoUrl: "http://cdn/rec.mp4", seed: 3 } };
      return { data: { status: "COMPLETED", videoUrl: "http://cdn/x.mp4", seed: 7 } };
    }
    return { data: {} };
  } } });
  vm.runInContext(transform(read("app/videogen.jsx"), "app/videogen.jsx"), V, { filename: "app/videogen.jsx" });
  return V;
}
const V = videoBox();
await test("J a completed render spends NOTHING in the browser; the quote rides the submit as quotedCredits", async () => {
  const spends = [];
  V.cloudSpendCreditReliable = async (...a) => { spends.push(a); return true; };
  V.cloudSpendCredit = async (...a) => { spends.push(a); return null; };
  V.events.length = 0;
  const r = await V.seedanceGenerate("clip-1", { frameUrl: "http://img/1.png", prompt: "go", pollMs: 5, maxPolls: 50, quote: { cost: 304, reason: "stage-video-render" } });
  assert.equal(r.videoUrl, "http://cdn/x.mp4");
  assert.equal(spends.length, 0, JSON.stringify(spends));
  assert.equal(V.submits.at(-1).quotedCredits, 304);
  const reasons = V.events.filter((e) => e.type === "turn-credits-changed").map((e) => e.detail.reason);
  assert.ok(reasons.includes("stage-video-hold") && reasons.includes("stage-video-render"), JSON.stringify(reasons));
});
await test("J an old caller's `spend` record is read as a quote only (never charged)", async () => {
  const spends = [];
  V.cloudSpendCreditReliable = async (...a) => { spends.push(a); return true; };
  await V.seedanceGenerate("clip-2", { frameUrl: "http://img/2.png", prompt: "go", pollMs: 5, maxPolls: 50, spend: { cost: 40, reason: "stage-video-extend", uid: "u9" } });
  assert.equal(spends.length, 0);
  assert.equal(V.submits.at(-1).quotedCredits, 40);
});
await test("J crash-recovery of a completed job (even one saved with an old spend record) charges nothing and refreshes the balance", async () => {
  const spends = [];
  V.cloudSpendCreditReliable = async (...a) => { spends.push(a); return true; };
  V.events.length = 0;
  V.localStorage.setItem("turn_vid_pending", JSON.stringify([
    { requestId: "rs", id: "clip-rec", model: "m", statusUrl: "s-rec", responseUrl: "r", at: Date.now(), projectId: "p1", uid: "u1", meta: {}, spend: { cost: 2, reason: "stage-video-render", uid: "uA", id: "evt-rec-1" } },
  ]));
  await V.vidRecoverPending({ quiet: true });
  assert.equal(spends.length, 0);
  assert.ok(V.events.some((e) => e.type === "turn-credits-changed" && e.detail.reason === "stage-video-recovered"));
});
await test("J a failed render asks the balance to refresh (the server released the hold)", async () => {
  V.mode = "fail"; V.events.length = 0;
  await assert.rejects(V.seedanceGenerate("clip-3", { frameUrl: "http://img/3.png", prompt: "go", pollMs: 5, maxPolls: 50, quote: { cost: 10 } }));
  assert.ok(V.events.some((e) => e.type === "turn-credits-changed" && e.detail.reason === "stage-video-released"));
  V.mode = "ok";
});
await test("J a 402 at submit reads calmly and opens the Plans window (when plans.jsx is loaded)", async () => {
  run(V, "app/plans.jsx");
  let plans = 0; V.turnOpenPlans = () => { plans++; };
  V.mode = "insufficient";
  await assert.rejects(V.seedanceGenerate("clip-4", { frameUrl: "http://img/4.png", prompt: "go", pollMs: 5, maxPolls: 50, quote: { cost: 304 } }),
    (e) => e.message === "This generation needs 304 credits, but this account has 12." && e.billing === "insufficient_credits");
  assert.equal(plans, 1);
  V.mode = "ok";
});
await test("J a 409 price_changed (the render costs more than the quote) reads calmly and does not open the Plans window", async () => {
  let plans = 0; V.turnOpenPlans = () => { plans++; };
  const orig = V.sbClient;
  V.sbClient = () => ({ functions: { invoke: async () => {
    const ctx = { status: 409, json: async () => ({ error: "price_changed", code: "price_changed", message: "This render costs 330 credits, more than the 304 shown. Check the settings and try again." }) };
    ctx.clone = () => ctx;
    return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } };
  } } });
  await assert.rejects(V.seedanceGenerate("clip-5", { frameUrl: "http://img/5.png", prompt: "go", pollMs: 5, maxPolls: 50, quote: { cost: 304 } }),
    (e) => e.message === "This render costs 330 credits, more than the 304 shown. Check the settings and try again." && e.billing === "price_changed");
  assert.equal(plans, 0);
  V.sbClient = orig;
});
/* round 2 (A1): the server's "poll again" answer — { error, code:"result_pending", retry:true,
   status:"IN_PROGRESS" } — keeps the job's credits held; the app must keep collecting it */
const pendingAnswer = (msg, withCode = true) => ({ data: { error: msg, ...(withCode ? { code: "result_pending" } : {}), retry: true, status: "IN_PROGRESS" } });
function scriptedVideoBox(pollScript, submitAnswer){
  const X = videoBox();
  X.polls = 0; X.submits = [];
  X.sbClient = () => ({ functions: { invoke: async (fn, { body }) => {
    if (body.op === "submit") { X.submits.push(body); return submitAnswer ? submitAnswer(body) : { data: { requestId: "rq-" + X.submits.length, statusUrl: "s-live", responseUrl: "r", status: "IN_QUEUE" } }; }
    if (body.op === "poll") { const a = pollScript(body, X.polls++); return typeof a === "function" ? a() : a; }
    return { data: {} };
  } } });
  return X;
}
await test("J (A1) a live render keeps polling through result_pending / retry:true answers and collects the video — no error, no second render", async () => {
  const seq = [pendingAnswer("Couldn't check this render's credits right now. Please try again in a moment."),
    pendingAnswer("The render finished, but its video couldn't be collected yet. Please try again in a moment."),
    pendingAnswer("Try again in a moment.", false),
    { data: { status: "COMPLETED", videoUrl: "http://cdn/late.mp4", seed: 5 } }];
  const X = scriptedVideoBox((b, i) => seq[Math.min(i, seq.length - 1)]);
  const statuses = [];
  const r = await X.seedanceGenerate("clip-rp", { frameUrl: "http://img/rp.png", prompt: "go", pollMs: 2, maxPolls: 20, quote: { cost: 304 }, onStatus: (s) => statuses.push(s) });
  assert.equal(r.videoUrl, "http://cdn/late.mp4");
  assert.equal(X.polls, 4, "kept polling after each retry answer");
  assert.equal(X.submits.length, 1, "never a second paid submit");
  assert.equal(statuses.filter((s) => s === "RECONNECTING").length, 3, JSON.stringify(statuses));
  assert.deepEqual(plain(X.vidPendingList()), [], "delivered: nothing left to recover");
  assert.equal(X.vidPollRetryable({ code: "result_pending" }), true);
  assert.equal(X.vidPollRetryable({ retry: true }), true);
  assert.equal(X.vidPollRetryable(new Error("provider failed")), false);
});
await test("J (A1) a live render that only ever hears result_pending ends honestly (no 'try again'); its pending record is KEPT for the patrol", async () => {
  const X = scriptedVideoBox(() => pendingAnswer("The render finished, but its video couldn't be collected yet. Please try again in a moment."));
  let err = null;
  try { await X.seedanceGenerate("clip-rp2", { frameUrl: "http://img/rp2.png", prompt: "go", pollMs: 2, maxPolls: 6, quote: { cost: 304 } }); } catch (e) { err = e; }
  assert.ok(err, "the wait ends");
  assert.equal(X.polls, 6, "polled up to maxPolls");
  assert.equal(err.stillPending, true);
  assert.ok(!/try again/i.test(err.message) && /no need to render it again/.test(err.message) && /charged only if it finishes/.test(err.message), err.message);
  assert.deepEqual(plain(X.vidPendingList().map((j) => j.id)), ["clip-rp2"], "the job stays on the recovery list");
});
await test("J (A1) the crash-recovery patrol KEEPS a record that hears result_pending / retry:true, a lapsed sign-in or a 5xx status hiccup; a provider failure is still dropped", async () => {
  const answers = {
    "s-pend": pendingAnswer("Couldn't check this render's credits right now. Please try again in a moment."),
    "s-retry": pendingAnswer("Please try again in a moment.", false),
    "s-5xx": { data: { error: "The video service couldn't report the job's status (502).", status: 502 } },
    "s-401": () => { const ctx = { status: 401, json: async () => ({ error: "Sign in again." }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; },
    "s-fail": { data: { status: "FAILED", error: "The video service reported the render as failed." } },
  };
  const X = scriptedVideoBox((b) => answers[b.statusUrl]);
  const rec = (rid, s) => ({ requestId: rid, id: "clip-" + rid, model: "m", statusUrl: s, responseUrl: "r", at: Date.now() - 2 * 3600 * 1000, projectId: "p1", uid: "u1", meta: {} });
  X.localStorage.setItem("turn_vid_pending", JSON.stringify([rec("a", "s-pend"), rec("b", "s-retry"), rec("c", "s-5xx"), rec("d", "s-401"), rec("e", "s-fail")]));
  X.toasts.length = 0; X.events.length = 0;
  await X.vidRecoverPending({ quiet: true });
  assert.deepEqual(plain(X.vidPendingList().map((j) => j.requestId)), ["a", "b", "c", "d"], "every transient answer keeps its record");
  assert.ok(X.toasts.some((t) => /failed at the provider/.test(t.m)), JSON.stringify(X.toasts));
  assert.ok(X.events.some((e) => e.type === "turn-credits-changed" && e.detail.reason === "stage-video-released"));
  // the next pass, once the server can hand the video over, saves it as a take
  answers["s-pend"] = { data: { status: "COMPLETED", videoUrl: "http://cdn/pend.mp4", seed: 1 } };
  assert.equal(await X.vidRecoverPending({ quiet: true }), 1);
  assert.deepEqual(plain(X.vidPendingList().map((j) => j.requestId)), ["b", "c", "d"]);
});
await test("J (A1) pending records are kept at least 7 days, and an older one is polled ONCE before it is dropped (finished → saved, failed → refunded, unfinished → dropped with a notice)", async () => {
  const day = 24 * 3600 * 1000;
  const answers = {
    "s-3d": { data: { status: "IN_PROGRESS" } },
    "s-old-done": { data: { status: "COMPLETED", videoUrl: "http://cdn/old.mp4", seed: 2 } },
    "s-old-fail": { data: { status: "FAILED", error: "The video service reported the render as failed." } },
    "s-old-run": { data: { status: "IN_PROGRESS" } },
    "s-old-pend": pendingAnswer("The render finished, but its video couldn't be collected yet. Please try again in a moment."),
  };
  const X = scriptedVideoBox((b) => answers[b.statusUrl]);
  assert.ok(X.VID_PENDING_KEEP_MS >= 7 * day, "at least 7 days");
  const rec = (rid, s, age) => ({ requestId: rid, id: "clip-" + rid, model: "m", statusUrl: s, responseUrl: "r", at: Date.now() - age, projectId: "p1", uid: "u1", meta: {} });
  X.localStorage.setItem("turn_vid_pending", JSON.stringify([rec("r3", "s-3d", 3 * day), rec("rdone", "s-old-done", 8 * day),
    rec("rfail", "s-old-fail", 8 * day), rec("rrun", "s-old-run", 8 * day), rec("rpend", "s-old-pend", 8 * day)]));
  X.toasts.length = 0;
  const saved = await X.vidRecoverPending({ quiet: true });
  assert.equal(X.polls, 5, "every record, old ones included, was polled");
  assert.equal(saved, 1, "the old finished render is saved, not dropped unseen");
  assert.equal(X.vidGetVideo("clip-rdone"), "http://cdn/old.mp4");
  assert.deepEqual(plain(X.vidPendingList().map((j) => j.requestId)), ["r3"], "a 3-day-old job is still collected; the old unfinished ones leave");
  const msg = X.toasts.map((t) => t.m).join(" | ");
  assert.ok(msg.includes("2 renders from over a week ago still couldn’t be collected, so they were taken off the pending list. Each is charged only if it finished."), msg);
  assert.ok(/failed at the provider/.test(msg), msg);
  assert.ok(!/over a day old/.test(read("app/videogen.jsx")), "the 24-hour drop is gone");
});
await test("J (A1) a submit refused with hold_attach_failed says the credits were returned, keeps nothing pending and refreshes the balance", async () => {
  const X = scriptedVideoBox(() => ({ data: {} }), () => ({ data: { error: "The render couldn't be started right now. Its credits were returned — please try again.", code: "hold_attach_failed" } }));
  X.events.length = 0;
  let err = null;
  try { await X.seedanceGenerate("clip-ha", { frameUrl: "http://img/ha.png", prompt: "go", pollMs: 2, maxPolls: 5, quote: { cost: 304 } }); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.message, "The render couldn’t be started right now. Its credits were returned — please try again.");
  assert.equal(err.code, "hold_attach_failed"); assert.equal(err.creditsReturned, true);
  assert.equal(X.polls, 0, "nothing to poll");
  assert.deepEqual(plain(X.vidPendingList()), []);
  const reasons = X.events.filter((e) => e.type === "turn-credits-changed").map((e) => e.detail.reason);
  assert.ok(reasons.includes("stage-video-released") && !reasons.includes("stage-video-hold"), JSON.stringify(reasons));
});
/* round 3 (A3): the video service briefly failing to report a job's status — an older proxy relays
   fal's 429 / 5xx as { error, status:<number> } — is a network miss for the live loop too */
const statusHiccup = (st) => ({ data: { error: "The video service couldn't report the job's status (" + st + ").", status: st } });
const httpHiccup = (st) => () => { const ctx = { status: st, json: async () => ({ error: "Service Unavailable" }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
await test("J (A3) a 429 / 5xx status answer in the live poll loop is a network miss (reconnecting, bounded), never a final failure; after the misses it says the render keeps going", async () => {
  const seq = [statusHiccup(502), statusHiccup(429), httpHiccup(503), statusHiccup(408), { data: { status: "COMPLETED", videoUrl: "http://cdn/after-hiccup.mp4", seed: 8 } }];
  const X = scriptedVideoBox((b, i) => seq[Math.min(i, seq.length - 1)]);
  const statuses = [];
  const r = await X.seedanceGenerate("clip-5xx", { frameUrl: "http://img/5xx.png", prompt: "go", pollMs: 2, maxPolls: 20, quote: { cost: 304 }, onStatus: (s) => statuses.push(s) });
  assert.equal(r.videoUrl, "http://cdn/after-hiccup.mp4", "delivered after the hiccups");
  assert.equal(X.polls, 5);
  assert.equal(X.submits.length, 1, "never a second paid submit");
  assert.equal(statuses.filter((s) => s === "RECONNECTING").length, 4, JSON.stringify(statuses));
  assert.deepEqual(plain(X.vidPendingList()), []);
  // bounded: still no status after 4 misses in a row → the wait ends, the job is still running and its record stays
  const Y = scriptedVideoBox(() => statusHiccup(502));
  let err = null;
  try { await Y.seedanceGenerate("clip-5xx2", { frameUrl: "http://img/5xx2.png", prompt: "go", pollMs: 2, maxPolls: 20, quote: { cost: 304 } }); } catch (e) { err = e; }
  assert.ok(err, "the wait ends");
  assert.equal(Y.polls, 5, "four misses tolerated, like a network blip");
  assert.equal(err.stillPending, true);
  assert.ok(err.message.startsWith("The video service couldn’t report this render’s status just now. It keeps going on the server and is saved to this clip’s takes automatically when it finishes"), err.message);
  assert.ok(/no need to render it again/.test(err.message) && !/\(502\)/.test(err.message), err.message);
  assert.deepEqual(plain(Y.vidPendingList().map((j) => j.id)), ["clip-5xx2"], "the patrol still collects it");
  // a real provider failure still ends at once
  const Z = scriptedVideoBox(() => ({ data: { error: "The video service reported the render as failed.", status: "FAILED" } }));
  await assert.rejects(Z.seedanceGenerate("clip-5xx3", { frameUrl: "http://img/5xx3.png", prompt: "go", pollMs: 2, maxPolls: 20 }), /reported the render as failed/);
  assert.equal(Z.polls, 1);
  assert.deepEqual(plain(Z.vidPendingList()), []);
});
const notFoundAnswer = () => { const ctx = { status: 404, json: async () => ({ error: "This render wasn't found for this account. Render it again to make a new one.", code: "render_not_found", status: "NOT_FOUND" }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
await test("J (A4) crash recovery is scoped to the account: another account's record is skipped and KEPT; render_not_found reads 'not available to this account' (never 'failed at the provider') and asks for no balance refresh", async () => {
  const polled = [];
  const answers = { "s-theirs": notFoundAnswer, "s-mine": notFoundAnswer, "s-legacy": notFoundAnswer };
  const X = scriptedVideoBox((b) => { polled.push(b.statusUrl); return answers[b.statusUrl]; });
  const rec = (rid, st, uid) => ({ requestId: rid, id: "clip-" + rid, model: "m", statusUrl: st, responseUrl: "r", at: Date.now() - 3600e3, projectId: "p1", uid, meta: {} });
  X.localStorage.setItem("turn_vid_pending", JSON.stringify([rec("theirs", "s-theirs", "someone-else"), rec("mine", "s-mine", "u1"), rec("legacy", "s-legacy", null)]));
  X.toasts.length = 0; X.events.length = 0;
  await X.vidRecoverPending({ quiet: true });
  assert.deepEqual(polled.slice().sort(), ["s-legacy", "s-mine"], "another account's record isn't polled from this one");
  assert.deepEqual(plain(X.vidPendingList().map((j) => j.requestId)), ["theirs"], "kept for the account that started it");
  const msgs = X.toasts.map((t) => t.m);
  assert.ok(!msgs.some((m) => /failed at the provider/.test(m)), JSON.stringify(msgs));
  assert.ok(msgs.includes("2 renders from an earlier session aren’t available to this account any more (they may belong to another account), so they were taken off the pending list."), JSON.stringify(msgs));
  assert.ok(!X.events.some((e) => e.type === "turn-credits-changed"), "no balance refresh: no hold of this account's changed");
  // that account signs in on this browser: its render is collected for it
  answers["s-theirs"] = { data: { status: "COMPLETED", videoUrl: "http://cdn/theirs.mp4", seed: 2 } };
  X.nbCloudScope = () => ({ projectId: "p1", uid: "someone-else", epoch: 1 });
  assert.equal(await X.vidRecoverPending({ quiet: true }), 1);
  assert.equal(X.vidGetVideo("clip-theirs"), "http://cdn/theirs.mp4");
  assert.deepEqual(plain(X.vidPendingList()), []);
  // a single not-found record: the singular notice
  const Y = scriptedVideoBox(() => notFoundAnswer());
  Y.localStorage.setItem("turn_vid_pending", JSON.stringify([rec("one", "s-one", "u1")]));
  Y.toasts.length = 0;
  await Y.vidRecoverPending({ quiet: true });
  assert.deepEqual(plain(Y.toasts.map((t) => [t.m, t.k])), [["A render from an earlier session isn’t available to this account any more (it may belong to another account), so it was taken off the pending list.", "info"]]);
});
await test("J (A5) when the render's recovery record couldn't be saved, the timeout says it can't be recovered automatically and to keep the film open — and the page's patrol still collects it", async () => {
  let done = false;
  const X = scriptedVideoBox(() => (done ? { data: { status: "COMPLETED", videoUrl: "http://cdn/unsaved.mp4", seed: 9 } } : { data: { status: "IN_PROGRESS" } }));
  const realSet = X.localStorage.setItem;
  X.localStorage.setItem = (k, v) => { if (k === "turn_vid_pending" && v !== "[]") throw new Error("QuotaExceededError"); return realSet(k, v); };
  X.toasts.length = 0;
  let err = null;
  try { await X.seedanceGenerate("clip-unsaved", { frameUrl: "http://img/u.png", prompt: "go", pollMs: 2, maxPolls: 3, quote: { cost: 304 } }); } catch (e) { err = e; }
  assert.ok(err && err.stillPending === true && err.notRecoverable === true, String(err && err.message));
  assert.equal(err.message, "This render is taking longer than expected. This browser couldn’t save the record that recovers it later, so it can’t be recovered automatically: keep this film open until it lands. It’s checked every few minutes and saved to this clip’s takes when it finishes, so there’s no need to render it again. It’s charged only if it finishes.");
  assert.ok(!/next time you open it|saved to this clip’s takes automatically/.test(err.message), "no promise of a recovery that can't happen");
  assert.ok(X.toasts.some((t) => /could not retain crash-recovery metadata/.test(t.m)), "the storage warning showed at submit (any render, not only screenplay pages)");
  assert.deepEqual(plain(X.vidPendingList()), [], "nothing reached storage");
  // while the page stays open, the patrol still collects it
  X.toasts.length = 0; done = true;
  assert.equal(await X.vidRecoverPending({ quiet: true }), 1);
  assert.equal(X.vidGetVideo("clip-unsaved"), "http://cdn/unsaved.mp4");
  assert.ok(X.toasts.some((t) => t.m === "A render that took longer than expected has finished — it's saved in its clip's takes."), JSON.stringify(X.toasts));
  assert.equal(await X.vidRecoverPending({ quiet: true }), 0, "collected once");
  // a status hiccup that outlasts the misses says the same
  const H = scriptedVideoBox(() => statusHiccup(503));
  H.localStorage.setItem = (k, v) => { if (k === "turn_vid_pending" && v !== "[]") throw new Error("QuotaExceededError"); };
  let herr = null;
  try { await H.seedanceGenerate("clip-unsaved2", { frameUrl: "http://img/u2.png", prompt: "go", pollMs: 2, maxPolls: 20 }); } catch (e) { herr = e; }
  assert.ok(herr && herr.notRecoverable && herr.message.startsWith("The video service couldn’t report this render’s status just now. This browser couldn’t save the record"), String(herr && herr.message));
  // a saved record keeps the automatic-recovery wording
  const Y = scriptedVideoBox(() => ({ data: { status: "IN_PROGRESS" } }));
  let yerr = null;
  try { await Y.seedanceGenerate("clip-saved", { frameUrl: "http://img/s.png", prompt: "go", pollMs: 2, maxPolls: 2 }); } catch (e) { yerr = e; }
  assert.ok(yerr && yerr.stillPending && !yerr.notRecoverable);
  assert.ok(yerr.message.startsWith("This render is taking longer than expected. It keeps going on the server and is saved to this clip’s takes automatically when it finishes"), yerr.message);
});
await test("J the source: no browser video charge remains (no _vidSettleSpend, no cloudSpendCreditReliable call)", () => {
  const src = read("app/videogen.jsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/_vidSettleSpend|cloudSpendCreditReliable|cloudSpendCredit\(/.test(src));
  assert.ok(/quotedCredits:quoteRec\.cost/.test(src));
});

/* ════════ K: stage ════════ */
await test("I imagegen's server-refusal branch uses the shared billing mapping", () => {
  const src = read("app/imagegen.jsx");
  assert.ok(src.includes('window.turnBillingError(body, status)') && src.includes('window.turnHandleBillingError(billing)'));
  assert.ok(!/const \{[^}]*\.\.\.\w+\s*\}\s*=/.test(src), "no object-rest destructuring (test-episode-build-psych rule)");
});
await test("K stage.jsx sends quotes, never spend records; the launcher-uid pins are gone", () => {
  const src = read("app/stage.jsx");
  assert.equal((src.match(/\bspend:\{/g) || []).length, 0);
  assert.deepEqual((src.match(/quote:\{ cost:(\w+), reason:"([\w-]+)" \}/g) || []).length, 4);
  for (const r of ["stage-video-render", "stage-video-extend", "stage-video-edit", "stage-video-motion-control"]) assert.ok(src.includes('reason:"' + r + '" }'), r);
  assert.ok(!/\buid0\b|\buidNow\b/.test(src));
});
await test("K stageCreditInfo: a frozen account can't render; the tooltip splits plan vs pack credits and says holds are refunded", () => {
  const src = read("app/stage.jsx");
  const start = src.indexOf("function stageCreditInfo(");
  const end = src.indexOf("\n}\n", start) + 3;
  // (2026-10-25) an admin's render is described by stageAdminInfo, just above it
  const adminAt = src.indexOf("function stageAdminInfo(");
  const S = box();
  run(S, "app/plans.jsx");
  vm.runInContext(transform(src.slice(adminAt, end), "stageCreditInfo.jsx"), S);
  S.turnIsAdmin = false;
  const ok = S.stageCreditInfo({ remaining: 1234, plan: "director", planRemaining: 1000, packRemaining: 234, nextPackExpiry: null }, 304);
  assert.equal(ok.empty, false); assert.equal(ok.frozen, false);
  assert.equal(ok.label, "Uses about 304 generation credits · 1,234 remaining → 930 after render", "F28: one number format");
  assert.equal(ok.title, "Current balance: 1,234 credits · 1,000 plan + 234 pack. This render costs about 304 \u2014 the charge follows the provider's actual cost, so it can come out a little higher, never above what is held. Credits are held when the render starts and refunded if it fails.");
  const fz = S.stageCreditInfo({ remaining: 5000, plan: "studio", frozen: true }, 30);
  assert.equal(fz.empty, true); assert.equal(fz.frozen, true);
  assert.equal(fz.label, "Account on hold — spending credits is paused");
  S.turnIsAdmin = true;
  assert.equal(S.stageCreditInfo({ remaining: 5000, plan: "studio", frozen: true }, 30).empty, false, "admin exempt");
  S.turnIsAdmin = false;
  const low = S.stageCreditInfo({ remaining: 10, plan: "studio" }, 30);
  assert.equal(low.empty, true); assert.equal(low.frozen, false);
});
await test("K (A6) a reference the server can't measure (409 price_changed, reason length_unreadable): the Stage asks with the server's reason and price, then resends quoting that price — or starts nothing", async () => {
  const src = read("app/stage.jsx");
  const a = src.indexOf("function stageLengthReprice(");
  const z = src.indexOf("window.stageWithLengthReprice = stageWithLengthReprice;");
  assert.ok(a > 0 && z > a);
  /* round 3: the SERVER'S REAL 409 — `detail` is a code word (host / format / timeout / unreadable)
     and `message` is the server's own sentence. Both are read from image-proxy index.ts itself, so a
     new code (or a renamed one) there fails this test until the app maps it. */
  const idx = read("supabase/functions/image-proxy/index.ts");
  const mapOf = (name) => { const m = new RegExp("const " + name + ": Record<string, string> = (\\{[\\s\\S]*?\\});").exec(idx); assert.ok(m, "index.ts still builds the 409's `" + name + "` map"); return vm.runInNewContext("(" + m[1] + ")"); };
  const why = mapOf("why"), fix = mapOf("fix");
  assert.ok(/reason: "length_unreadable", detail, lengthUnverified: true/.test(idx), "the server sends detail (the code) with reason length_unreadable");
  const serverMessage = (d) => `A reference video's length couldn't be checked (${why[d]}), so this render is priced at the longest length allowed: 381 credits, more than the 237 shown. Render it at 381 credits, or ${fix[d]}.`;
  const serverBody = (d) => ({ error: "price_changed", code: "price_changed", message: serverMessage(d), creditsRequired: 381, quotedCredits: 237, reason: "length_unreadable", detail: d, lengthUnverified: true });
  const refusal409 = (body) => { const ctx = { status: 409, json: async () => body }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
  const mk = (body) => {
    const X = scriptedVideoBox(() => ({ data: { status: "COMPLETED", videoUrl: "http://cdn/ref.mp4", seed: 4 } }),
      (b) => (Number(b.quotedCredits) >= 381 ? { data: { requestId: "rq-ok", statusUrl: "s-live", responseUrl: "r", status: "IN_QUEUE" } } : refusal409(body)));
    run(X, "app/plans.jsx");
    vm.runInContext(transform(src.slice(a, z + "window.stageWithLengthReprice = stageWithLengthReprice;".length), "stage-reprice.jsx"), X);
    X.confirms = []; X.answer = true;
    X.appConfirm = async (o) => { X.confirms.push(o); return X.answer; };
    return X;
  };
  const req = () => ({ frameUrl: "http://img/ref.png", prompt: "go", pollMs: 2, maxPolls: 5, quote: { cost: 237, reason: "stage-video-render" } });
  const tail = " So this render is priced at the longest length allowed: 381 credits. You’re never charged more than that, and a render that fails is refunded.";
  const plainWhy = {
    host: "The video is stored somewhere the server doesn’t read from; uploading it from your device or library avoids this.",
    format: "The video’s length couldn’t be checked because it isn’t an MP4 or MOV file.",
    timeout: "Reading the video’s length timed out.",
    unreadable: "The video’s length couldn’t be read.",
  };
  assert.deepEqual(Object.keys(why).sort(), Object.keys(plainWhy).sort(), "every server code has a plain sentence");
  for (const d of Object.keys(why)) {
    const X = mk(serverBody(d));
    const r = await X.stageWithLengthReprice((p) => X.seedanceGenerate("clip-ref-" + d, p), req(), 1);
    assert.equal(r.videoUrl, "http://cdn/ref.mp4");
    assert.equal(X.confirms.length, 1);
    assert.equal(X.confirms[0].title, "Render at 381 credits?");
    assert.equal(X.confirms[0].body, plainWhy[d] + tail, d);
    assert.ok(!new RegExp("^" + d + "\\b", "i").test(X.confirms[0].body), "never the bare code word: " + X.confirms[0].body);
    assert.ok(!/\bfal\b|Seedance|Kling|image-proxy/i.test(X.confirms[0].body), "no vendor or plumbing names");
    assert.equal(X.confirms[0].confirmLabel, "Render at 381 credits");
    assert.deepEqual(plain(X.submits.map((b) => b.quotedCredits)), [237, 381], "resent once, quoting the server's price");
  }
  // an unknown code shows the refusal's own message
  const U2 = mk({ ...serverBody("host"), detail: "cosmic-rays", message: "A reference video's length couldn't be checked, so this render is priced at the longest length allowed: 381 credits, more than the 237 shown." });
  await U2.stageWithLengthReprice((p) => U2.seedanceGenerate("clip-ref-u", p), req(), 1);
  assert.equal(U2.confirms[0].body, "A reference video's length couldn't be checked, so this render is priced at the longest length allowed: 381 credits, more than the 237 shown. You’re never charged more than that, and a render that fails is refunded.");
  // declined: nothing starts, and it's reported as a choice (no code at all: the generic sentence)
  const D = mk({ ...serverBody("host"), detail: undefined }); D.answer = false;
  await assert.rejects(D.stageWithLengthReprice((p) => D.seedanceGenerate("clip-ref2", p), req(), 1),
    (e) => e.repriceDeclined === true && e.message === "Render not started — no credits were used.");
  assert.equal(D.submits.length, 1);
  assert.ok(D.confirms[0].body.startsWith("A reference video’s length couldn’t be read. So this render is priced at the longest length allowed: 381 credits."), D.confirms[0].body);
  // the first server repair's flag reads the same; a plain price drift is NOT offered a re-quote
  const O = mk({ error: "price_changed", code: "price_changed", message: "x", creditsRequired: 381, lengthUnverified: true });
  await O.stageWithLengthReprice((p) => O.seedanceGenerate("clip-ref3", p), req(), 1);
  assert.equal(O.confirms.length, 1);
  const P9 = mk({ error: "price_changed", code: "price_changed", message: "This render costs 381 credits, more than the 237 shown. Check the settings and try again.", creditsRequired: 381, quotedCredits: 237 });
  await assert.rejects(P9.stageWithLengthReprice((p) => P9.seedanceGenerate("clip-ref4", p), req(), 1), (e) => e.code === "price_changed" && !e.repriceDeclined);
  assert.equal(P9.confirms.length, 0);
  // a batch: priced per take, total spelled out
  const X = mk(serverBody("timeout"));
  assert.equal(X.stageRepriceText({ credits: 381, detail: "" }, 3).body, "A reference video’s length couldn’t be read. So this render is priced at the longest length allowed: 381 credits a take (1,143 for 3 takes). You’re never charged more than that, and a render that fails is refunded.");
  assert.equal(X.stageRepriceText({ credits: 381, detail: "host" }, 3).body, plainWhy.host + " So this render is priced at the longest length allowed: 381 credits a take (1,143 for 3 takes). You’re never charged more than that, and a render that fails is refunded.");
  // every Stage render path goes through it, and a decline is a notice, not an error
  assert.equal((src.match(/await stageWithLengthReprice\(/g) || []).length, 4);
  assert.ok(src.includes("const results = await stageWithLengthReprice(runPayload, payload, batchN);"));
  assert.ok(src.includes('if(e && e.repriceDeclined){ setModeErr(""); if(typeof window.appToast==="function") window.appToast(e.message,"info"); return; }'));
  assert.ok(read("app/videogen.jsx").includes('ex.reason="length_unreadable";'), "vidProxy carries the refusal's price and reason");
});
/* the index of the ")" that closes the "(" at `open` in JS source — string literals, template
   literals and comments skipped (for evaluating one expression of a component from its source) */
function matchParen(s, open){
  assert.equal(s[open], "(", "matchParen starts on a '('");
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") { for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++; continue; }
    if (c === "/" && s[i + 1] === "/") { i = s.indexOf("\n", i); continue; }
    if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i) + 1; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  throw new Error("unbalanced source from " + open);
}
await test("K (A1, A4 round 4) Motion Control and editing: the Stage computes the server's HOLD — the chosen video's length x 1.1 + 1 s when the server reads it, else the longest length allowed (the same numbers as lengthBilledVideoHold for every tier, resolution, orientation and credit unit) — feeds THAT into the credit info, blocks Generate below it and words the cost as a hold", async () => {
  const src = read("app/stage.jsx");
  const a = src.indexOf("const STAGE_LENGTH_HOLD");
  const b = src.indexOf("\n}\n", src.indexOf("function stageCreditInfo(")) + 3;
  assert.ok(a > 0 && b > a, "the hold helpers sit before stageCreditInfo");
  const S = box(); run(S, "app/pricing.jsx"); run(S, "app/plans.jsx");
  S.TURN_SUPABASE = { url: "https://proj-x.supabase.co" }; S.URL = URL;   // the browser's URL parser
  vm.runInContext(transform(src.slice(a, b), "stage-hold.jsx"), S); S.turnIsAdmin = false;
  const L = plain(vm.runInContext("STAGE_LENGTH_HOLD", S));
  const caps = await import(new URL("supabase/functions/image-proxy/seedance-capabilities.mjs", ROOT));
  const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  const pol = await import(new URL("supabase/functions/image-proxy/billing-policy.mjs", ROOT));
  const SD25 = "bytedance/seedance-2.5/reference-to-video";
  const KL = { standard: "fal-ai/kling-video/v3/standard/motion-control", pro: "fal-ai/kling-video/v3/pro/motion-control" };
  // the mirrored numbers ARE the server's (index.ts feeds lengthBilledVideoHold with these limits)
  for (const ep of Object.values(KL)) { const mv = caps.motionControlCapabilities(ep).motionVideo; assert.equal(L.motionSeconds.video, mv.maxSeconds); assert.equal(L.motionSeconds.image, mv.maxSecondsImageOrientation); }
  const sc = caps.seedanceCapabilities(SD25);
  assert.equal(L.editOutputSeconds, sc.duration.max); assert.equal(L.editInputSeconds, sc.references.videos.maxSecondsCombined);
  assert.equal(L.videoInputMul, srv.SEEDANCE_VIDEO_INPUT_MULTIPLIER);
  assert.deepEqual([L.lengthFactor, L.lengthPadSeconds], [1.1, 1], "the owner's margin (round 4): read length x 1.1 + 1 s");
  const idx = read("supabase/functions/image-proxy/index.ts");
  assert.ok(idx.includes('const maxOut = motionOrientation === "image" ? mcap.maxSecondsImageOrientation : mcap.maxSeconds;'), "the server's motion hold follows the orientation");
  assert.ok(/maxOutputSeconds: cap\.duration\.max,\s*maxInputSeconds: maxIn/.test(idx), "the server's edit hold is capped at the validators' maximum");
  // WHICH videos size the hold by their length (index.ts lengthSizesHold, round 5: a file the server works
  // from its own copy of — a data URL, a stage: upload or a signed file in the project's storage, copied at
  // submit (video-snapshots.mjs) — or a take on fal's immutable CDN) — the Stage mirrors it
  assert.ok(idx.includes("return isFalMediaUrl(s) || (!!snapshot && (/^data:/i.test(s) || !!stagedRefPath(s) || !!projectStorageObject(s, { projectHost, bucket: videoBucket })));"), "the server's length-sized sources");
  assert.ok(idx.includes("const sizable = sources.map((src, i) => lengthSizesHold(src, videoSnaps[i]));"), "sized only when the server holds its copy");
  assert.ok(/lengthBilledVideoHold\(\{[^}]*kind: "motion"[^}]*inputs: lengths, sizable,/.test(idx) && /maxInputSeconds: maxIn, inputs: lengths, sizable,/.test(idx), "both holds pass which lengths may size them");
  assert.ok(read("app/videogen.jsx").includes("if(/^blob:/i.test(url)){") , "a blob: pick is sent as a data URL (vidProxyReadyUrl)");
  const rd = (m) => S.stageLengthSizesHold(m);
  assert.equal(rd({ kind: "device", url: "blob:https://app/x", ref: "stage:u1/stage/abc.mp4" }), true, "a device upload (stage:, copied at submit)");
  assert.equal(rd({ kind: "take", url: "https://v3.fal.media/files/x/out.mp4", ref: "https://v3.fal.media/files/x/out.mp4" }), true, "a take on fal's media CDN (immutable)");
  assert.equal(rd({ kind: "take", ref: "https://fal.media/files/x.mp4" }), true);
  assert.equal(rd({ kind: "take", ref: "data:video/mp4;base64,AAAA" }), true, "a data URL (copied at submit)");
  assert.equal(rd({ kind: "take", ref: "blob:https://app/x" }), true, "a browser-only take: sent as a data URL");
  assert.equal(rd({ kind: "take", ref: "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/p1/videos/take.mp4?token=t" }), true, "a signed file in the film's storage (copied at submit)");
  for (const u of ["https://proj-x.supabase.co/storage/v1/object/public/turn-assets/u1/p1/take.mp4", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/take.mp4",
    "https://proj-x.supabase.co/storage/v1/object/sign/other-bucket/u1/take.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/_internal/video-snapshots/x.mp4?token=t",
    "https://other.supabase.co/storage/v1/object/sign/turn-assets/u1/a.mp4?token=t",
    "http://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/a.mp4?token=t",
    "http://v3.fal.media/files/x.mp4", "https://evilfal.media/x.mp4", "https://fal.media.example.com/x.mp4", "https://cdn.example.com/x.mp4", ""])
    assert.equal(rd({ kind: "take", ref: u }), false, "held at the maximum: " + u);
  assert.equal(rd(null), false);
  // the app's storage test IS the server's (video-snapshots.mjs projectStorageObject), URL by URL
  const snaps = await import(new URL("supabase/functions/image-proxy/video-snapshots.mjs", ROOT));
  for (const u of ["https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/p1/videos/take.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u%201/a%2Fb.mp4?token=t",
    "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1//a.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/./a.mp4?token=t",
    "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/a%5Cb.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/a%00.mp4?token=t",
    "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/%E0%A4%A.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/" + "a/".repeat(520) + "x.mp4?token=t",
    "https://proj-x.supabase.co/storage/v1/object/sign/turn%2Dassets/u1/a.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/public/turn-assets/u1/a.mp4?token=t",
    "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/_internal/a.mp4?token=t", "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/a.mp4?token="]) {
    const u0 = new URL(u);
    assert.equal(S.stageProjectStorageObject(u0), !!snaps.projectStorageObject(u, { projectHost: "proj-x.supabase.co", bucket: "turn-assets" }), "app = server: " + u.slice(0, 120));
  }
  // the margin: the read length x 1.1 + 1 s, in tenths rounded up (float-safe: 5 x 1.1 + 1 is 6.5, not 6.6)
  assert.deepEqual([5, 12, 3, 9.96, 29.3, 5.02, 25].map((x) => S.stageLengthHoldSeconds(x)), [6.5, 14.2, 4.3, 12, 33.3, 6.6, 28.5]);
  // the same credits as the server — the hold (read / not read / no video) AND the expected charge the quote is checked against
  const regimes = [[0.01, { switched: true, usd_per_credit: 0.01, trial_credits: 50, legacy_until: null }], [0.03, { switched: false, usd_per_credit: 0.03, trial_credits: 0, legacy_until: null }]];
  let compared = 0;
  for (const [unit, regime] of regimes) {
    S.turnApplyCreditRegime(regime, "server");
    const usd = (fam, tier, res) => S.TURN_PRICING.video.providerUsdPerSecond[fam][tier][res];
    const cps = (fam, tier, res) => S.turnVideoCreditRate(fam, tier, res) * S.CREDIT_SCALE;
    for (const via of ["usd", "credits-per-second fallback"]) {
      for (const tier of ["standard", "pro"]) {
        const res = tier === "pro" ? "1080p" : "720p";
        for (const orientation of ["video", "image"]) {
          const maxOut = orientation === "image" ? 10 : 30;
          const o = via === "usd" ? { usdPerSecond: usd("kling-3.0-motion-control", tier, res), orientation } : { creditsPerSecond: cps("kling-3.0-motion-control", tier, res), orientation };
          const lbMax = srv.lengthBilledVideoHold({ endpoint: KL[tier], resolution: res, kind: "motion", maxOutputSeconds: maxOut, inputs: [null], unit });
          assert.equal(S.stageLengthBilledHold("motion", o), lbMax.cost.credits, "motion hold, no video " + [unit, via, tier, orientation].join(" "));
          compared++;
          for (const secs of [3, 5, 5.02, 9.96, 10.04, 12, 29.3]) {
            if (secs > maxOut + 0.05) continue;
            const lb = srv.lengthBilledVideoHold({ endpoint: KL[tier], resolution: res, kind: "motion", maxOutputSeconds: maxOut, inputs: [secs], unit });
            const tag = [unit, via, tier, orientation, secs].join(" ");
            const lbStored = srv.lengthBilledVideoHold({ endpoint: KL[tier], resolution: res, kind: "motion", maxOutputSeconds: maxOut, inputs: [secs], sizable: [false], unit });
            assert.equal(S.stageLengthBilledHold("motion", { ...o, inputSeconds: secs, sizable: true }), lb.cost.credits, "motion hold, sized by the length " + tag);
            assert.equal(S.stageLengthBilledHold("motion", { ...o, inputSeconds: secs, sizable: false }), lbStored.cost.credits, "motion hold, read but not sized by it " + tag);
            assert.equal(lbStored.cost.credits, lbMax.cost.credits, "not sized by the length: the maximum " + tag);
            assert.equal(S.stageLengthBilledEstimate("motion", { ...o, inputSeconds: secs }), lb.expected.credits, "motion expected " + tag);
            assert.equal(lbStored.expected.credits, lb.expected.credits, "the quote check still uses the read length " + tag);
            compared += 5;
          }
        }
      }
      for (const res of ["480p", "720p", "1080p"]) {
        const o = via === "usd" ? { usdPerSecond: usd("seedance-2.5", "standard", res) } : { creditsPerSecond: cps("seedance-2.5", "standard", res) };
        const edit = (inputs, sizable = null) => srv.lengthBilledVideoHold({ endpoint: SD25, resolution: res, kind: "editing", maxOutputSeconds: sc.duration.max, maxInputSeconds: sc.references.videos.maxSecondsCombined, inputs, sizable, unit });
        const lbMax = edit([null]);
        assert.equal(S.stageLengthBilledHold("editing", o), lbMax.cost.credits, "edit hold, no video " + [unit, via, res].join(" "));
        compared++;
        for (const secs of [1.8, 2.1, 5, 5.02, 9.96, 12, 25, 27.5, 29.3, 30.2]) {
          const lb = edit([secs]);
          const tag = [unit, via, res, secs].join(" ");
          const lbStored = edit([secs], [false]);
          assert.equal(S.stageLengthBilledHold("editing", { ...o, inputSeconds: secs, sizable: true }), lb.cost.credits, "edit hold, sized by the length " + tag);
          assert.equal(S.stageLengthBilledHold("editing", { ...o, inputSeconds: secs, sizable: false }), lbStored.cost.credits, "edit hold, read but not sized by it " + tag);
          assert.equal(lbStored.cost.credits, lbMax.cost.credits, "not sized by the length: the maximum " + tag);
          assert.equal(S.stageLengthBilledEstimate("editing", { ...o, inputSeconds: secs }), lb.expected.credits, "edit expected " + tag);
          compared += 4;
        }
      }
    }
  }
  assert.ok(compared > 800, String(compared));
  // the owner's cases at the new unit: 5 s / 12 s / unknown at 720p and 1080p — the Stage = the server = these numbers
  S.turnApplyCreditRegime(regimes[0][1], "server");
  const mo = (tier, orientation, extra) => ({ usdPerSecond: S.TURN_PRICING.video.providerUsdPerSecond["kling-3.0-motion-control"][tier][tier === "pro" ? "1080p" : "720p"], orientation, ...(extra || {}) });
  const ed = (res, extra) => ({ usdPerSecond: S.TURN_PRICING.video.providerUsdPerSecond["seedance-2.5"].standard[res], ...(extra || {}) });
  const srvMotion = (tier, secs, maxOut = 30) => srv.lengthBilledVideoHold({ endpoint: KL[tier], resolution: tier === "pro" ? "1080p" : "720p", kind: "motion", maxOutputSeconds: maxOut, inputs: [secs], unit: 0.01 }).cost.credits;
  const srvEdit = (res, secs) => srv.lengthBilledVideoHold({ endpoint: SD25, resolution: res, kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [secs], unit: 0.01 }).cost.credits;
  const read5 = { inputSeconds: 5, sizable: true }, read12 = { inputSeconds: 12, sizable: true };
  const cases = [
    ["Motion Control 720p, 5 s", S.stageLengthBilledHold("motion", mo("standard", "video", read5)), srvMotion("standard", 5), 82],
    ["Motion Control 720p, 12 s", S.stageLengthBilledHold("motion", mo("standard", "video", read12)), srvMotion("standard", 12), 179],
    ["Motion Control 720p, unknown", S.stageLengthBilledHold("motion", mo("standard", "video")), srvMotion("standard", null), 378],
    ["Motion Control 1080p, 5 s", S.stageLengthBilledHold("motion", mo("pro", "video", read5)), srvMotion("pro", 5), 110],
    ["Motion Control 1080p, 12 s", S.stageLengthBilledHold("motion", mo("pro", "video", read12)), srvMotion("pro", 12), 239],
    ["Motion Control 1080p, unknown", S.stageLengthBilledHold("motion", mo("pro", "video")), srvMotion("pro", null), 504],
    ["edit 720p, 5 s", S.stageLengthBilledHold("editing", ed("720p", read5)), srvEdit("720p", 5), 369],
    ["edit 720p, 12 s", S.stageLengthBilledHold("editing", ed("720p", read12)), srvEdit("720p", 12), 806],
    ["edit 720p, unknown", S.stageLengthBilledHold("editing", ed("720p")), srvEdit("720p", null), 1709],
    ["edit 1080p, 5 s", S.stageLengthBilledHold("editing", ed("1080p", read5)), srvEdit("1080p", 5), 908],
    ["edit 1080p, 12 s", S.stageLengthBilledHold("editing", ed("1080p", read12)), srvEdit("1080p", 12), 1984],
    ["edit 1080p, unknown", S.stageLengthBilledHold("editing", ed("1080p")), srvEdit("1080p", null), 4205],
  ];
  for (const [what, app, server, n] of cases) { assert.equal(app, server, what + ": the Stage's hold = the server's"); assert.equal(app, n, what); }
  // the reviewer's examples: 5 s Motion Control (Standard, 720p) with 300 credits
  const bal300 = { remaining: 300, plan: "studio", planRemaining: 300, packRemaining: 0 };
  const mRead = S.stageLengthBilledHold("motion", mo("standard", "video", read5));
  const mHold = S.stageLengthBilledHold("motion", mo("standard", "video", { inputSeconds: 5, sizable: false }));
  const mEst = S.stageLengthBilledEstimate("motion", { ...mo("standard", "video"), inputSeconds: 5 });
  assert.deepEqual([mRead, mHold, mEst], [82, 378, 63]);
  const mi = S.stageCreditInfo(bal300, mHold, { hold: true, estimate: mEst, basis: "stored" });
  assert.equal(mi.empty, true, "Generate is blocked: 300 can't cover the 378 the server holds for a video it doesn't size by length (it would refuse: " + pol.insufficientRefusal(378, 300).body.message + ")");
  assert.equal(mi.label, "Holds up to 378 credits; charged for the finished video’s length (about 63 for this video) · 300 remaining");
  assert.ok(mi.title.endsWith("This render holds up to 378 credits; charged for the finished video’s length (about 63 for this video): the credits are held when it starts (the longest length allowed: only a video the server can copy — one kept in the film’s storage, uploaded from your device, or rendered here — is held by its length), the rest is returned when it finishes, and a render that fails is refunded."), mi.title);
  assert.ok(!/after render/.test(mi.label), "never '→ N after render' for a hold");
  const mr = S.stageCreditInfo(bal300, mRead, { hold: true, estimate: mEst, basis: "length" });
  assert.equal(mr.empty, false, "300 covers the 82 held for a 5 s video the server reads");
  assert.equal(mr.label, "Holds up to 82 credits; charged for the finished video’s length (about 63 for this video) · 300 remaining");
  assert.ok(mr.title.includes("the credits are held when it starts (this video’s length plus a margin), the rest is returned"), mr.title);
  assert.ok(S.stageCreditInfo(bal300, 378, { hold: true }).title.includes("(the longest length allowed until the video’s length is known)"));
  assert.equal(S.stageLengthHoldBasis({ kind: "device", ref: "stage:u/x.mp4" }, 5), "length");
  assert.equal(S.stageLengthHoldBasis({ kind: "take", ref: "https://proj-x.supabase.co/storage/v1/object/public/turn-assets/x.mp4" }, 5), "stored");
  assert.equal(S.stageLengthHoldBasis({ kind: "take", ref: "https://v3.fal.media/files/x.mp4" }, 5), "length");
  assert.equal(S.stageLengthHoldBasis({ kind: "device", ref: "stage:u/x.mp4" }, null), "");
  assert.equal(S.stageLengthHoldBasis(null, 5), "");
  const mImg = S.stageLengthBilledHold("motion", mo("standard", "image"));
  assert.equal(mImg, 126, "the scene follows the character image: 10 s at most");
  assert.equal(S.stageLengthBilledHold("motion", mo("standard", "image", { inputSeconds: 9.96, sizable: true })), 126, "12 s of margin is capped at the 10 s maximum");
  assert.equal(S.stageCreditInfo(bal300, mImg, { hold: true, estimate: mEst }).empty, false, "300 covers a 126 hold");
  // 5 s Seedance 2.5 edit at 720p and 1080p
  const e720 = S.stageLengthBilledHold("editing", ed("720p")), e720read = S.stageLengthBilledHold("editing", ed("720p", read5)), e720est = S.stageLengthBilledEstimate("editing", { ...ed("720p"), inputSeconds: 5 });
  const e1080 = S.stageLengthBilledHold("editing", ed("1080p")), e1080read = S.stageLengthBilledHold("editing", ed("1080p", read5)), e1080est = S.stageLengthBilledEstimate("editing", { ...ed("1080p"), inputSeconds: 5 });
  assert.deepEqual([e720, e720read, e720est], [1709, 369, 284]);
  assert.deepEqual([e1080, e1080read, e1080est], [4205, 908, 699]);
  const dir1600 = { remaining: 1600, plan: "studio", planRemaining: 1600, packRemaining: 0 };
  assert.equal(S.stageCreditInfo(dir1600, e720, { hold: true, estimate: e720est }).empty, true, "1,600 can't cover a 1,709 hold (a video the server doesn't size by length)");
  assert.equal(S.stageCreditInfo(dir1600, e720read, { hold: true, estimate: e720est }).empty, false, "1,600 covers the 369 held for a 5 s video it reads");
  // the round-3 owner question: a Producer's third 5 s 1080p edit is no longer blocked (3,602 left covers a 908 hold)
  assert.equal(S.stageCreditInfo({ remaining: 3602, plan: "studio" }, e1080read, { hold: true, estimate: e1080est }).empty, false);
  assert.equal(S.stageCreditInfo({ remaining: 5000, plan: "studio" }, e1080, { hold: true, estimate: e1080est }).empty, false);
  assert.equal(S.stageCreditInfo({ remaining: 4000, plan: "studio" }, e1080, { hold: true, estimate: e1080est }).label,
    "Holds up to 4,205 credits; charged for the finished video’s length (about 699 for this video) · 4,000 remaining");
  assert.equal(S.stageCreditInfo(null, e720, { hold: true }).label, "Holds up to 1,709 credits; charged for the finished video’s length · remaining credits unavailable");
  assert.equal(S.stageCreditInfo({ remaining: 9000, plan: "studio", frozen: true }, e720, { hold: true }).label, "Account on hold — spending credits is paused");
  // the component's block message for a hold (the Generate button's tooltip and the click refusal)
  const fmtLine = src.slice(src.indexOf("  const _fmtN = "), src.indexOf("\n", src.indexOf("  const _fmtN = ")));
  const hb = src.indexOf("  const modeHoldBlock = "), he = src.indexOf("\n  };\n", hb) + 5;
  const modeHoldBlock = vm.runInContext("(function(){" + transform(fmtLine + "\n" + src.slice(hb, he), "hold-block.jsx") + " return modeHoldBlock; })()", S);
  assert.equal(modeHoldBlock(mi, "motion render"), "Not enough generation credits for this motion render: it holds up to 378 credits while it runs (charged for the finished video’s length), and 300 remain.");
  assert.equal(modeHoldBlock(S.stageCreditInfo({ remaining: 400, plan: "studio" }, mHold, { hold: true }), "motion render"), "");
  assert.equal(modeHoldBlock(S.stageCreditInfo({ remaining: 400, plan: "studio", frozen: true }, mHold, { hold: true }), "edit"), "Your account is on hold while a payment is disputed, so spending credits is paused.");
  // A1 (round 4): the COMPONENT's own lines, evaluated with a stub balance — the credit info that
  // blocks Generate carries the HOLD, never the estimate (round-3 mutations MA / MB survived a text pin)
  const line = (start) => { const i = src.indexOf(start); assert.ok(i > 0, start); return src.slice(i, src.indexOf("\n", i) + 1); };
  const ca = src.indexOf("  const sd25Usd = stageUsdPerSecond(");
  const cb = src.indexOf("\n", src.indexOf("  const motionHoldInfo = ")) + 1;
  assert.ok(ca > 0 && cb > ca, "the composer's credit lines");
  vm.runInContext(src.slice(src.indexOf("function _fmtSecs("), src.indexOf("\n", src.indexOf("function _fmtSecs(")) + 1), S);
  const composerCredits = vm.runInContext("(function(p){ var resolution=p.resolution, editVideo=p.editVideo, motionVideo=p.motionVideo, motionTier=p.motionTier,"
    + " effMotionOrientation=p.effMotionOrientation, creditBalance=p.creditBalance, creditScale=Number(window.CREDIT_SCALE)||1, extendCost=null, duration=5, extendVideo=null;"
    + " var sd25Rate=function(r){ return window.turnVideoCreditRate('seedance-2.5','standard',r); };\n"
    + transform(line("  const mediaSeconds = ") + src.slice(ca, cb), "stage-composer-credits.jsx")
    + "\n return { editCost:editCost, editHold:editHold, motionCost:motionCost, motionHold:motionHold, editHoldInfo:editHoldInfo, motionHoldInfo:motionHoldInfo }; })", S);
  const stored5 = { kind: "take", id: "t1", url: "https://proj-x.supabase.co/storage/v1/object/public/turn-assets/take.mp4", ref: "https://proj-x.supabase.co/storage/v1/object/public/turn-assets/take.mp4", seconds: 5 };   // a public link the server doesn't copy
  const signed5 = { kind: "take", id: "t3", url: "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/p1/videos/take.mp4?token=t", ref: "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/p1/videos/take.mp4?token=t", seconds: 5 };   // the film's storage: copied at submit (round 5)
  const device5 = { kind: "device", url: "blob:https://app/m", ref: "stage:u1/stage/m.mp4", seconds: 5 };
  const falTake5 = { kind: "take", id: "t2", url: "https://v3.fal.media/files/a/take.mp4", ref: "https://v3.fal.media/files/a/take.mp4", seconds: 5 };
  const base = { resolution: "720p", motionTier: "standard", effMotionOrientation: "video", creditBalance: bal300 };
  let cc = composerCredits({ ...base, motionVideo: stored5, editVideo: stored5 });
  assert.deepEqual([cc.motionHold, cc.motionCost, cc.editHold, cc.editCost], [378, 63, 1709, 284]);
  assert.equal(cc.motionHoldInfo.cost, 378, "the motion credit info carries the HOLD (MA)");
  assert.equal(cc.motionHoldInfo.empty, true, "300 can't cover 378: Motion Control's Generate is blocked (MA)");
  assert.equal(cc.editHoldInfo.cost, 1709, "the edit credit info carries the HOLD (MB)");
  assert.equal(cc.editHoldInfo.empty, true, "300 can't cover 1,709: Edit's Generate is blocked (MB)");
  assert.ok(cc.motionHoldInfo.title.includes("(the longest length allowed: only a video the server can copy — one kept in the film’s storage, uploaded from your device, or rendered here — is held by its length)"), cc.motionHoldInfo.title);
  for (const v of [device5, falTake5, signed5]) {
    cc = composerCredits({ ...base, motionVideo: v, editVideo: v });
    assert.deepEqual([cc.motionHold, cc.editHold], [82, 369], v.kind + " " + v.ref);
    assert.ok(cc.editHoldInfo.title.includes("(this video’s length plus a margin)"), cc.editHoldInfo.title);
  }
  cc = composerCredits({ ...base, motionVideo: device5, editVideo: device5 });
  assert.deepEqual([cc.motionHold, cc.motionCost, cc.editHold, cc.editCost], [82, 63, 369, 284]);
  assert.equal(cc.motionHoldInfo.empty, false, "300 covers the 82 held");
  assert.equal(cc.editHoldInfo.empty, true, "300 can't cover the 369 held — the estimate (284) alone would wrongly let it through");
  assert.ok(cc.editHoldInfo.title.includes("(this video’s length plus a margin)"), cc.editHoldInfo.title);
  cc = composerCredits({ ...base, resolution: "1080p", motionTier: "pro", creditBalance: { remaining: 1000, plan: "studio" }, motionVideo: device5, editVideo: device5 });
  assert.deepEqual([cc.motionHold, cc.editHold, cc.editHoldInfo.empty], [110, 908, false]);
  cc = composerCredits({ ...base, motionVideo: null, editVideo: null });
  assert.deepEqual([cc.motionHold, cc.editHold, cc.motionCost, cc.editCost], [378, 1709, null, null], "no video yet: the longest length");
  assert.ok(cc.motionHoldInfo.title.includes("(the longest length allowed until the video’s length is known)"));
  // wiring: both composers price, block and word the render by its hold; the footer follows the tab
  const one = (s0) => assert.equal(src.split(s0).length - 1, 1, s0);
  one('const editHold = (sd25Usd||sd25Cps) ? stageLengthBilledHold("editing", { usdPerSecond:sd25Usd, creditsPerSecond:sd25Cps, inputSeconds:mediaSeconds(editVideo), sizable:stageLengthSizesHold(editVideo) }) : null;');
  one('const motionHold = (motionUsd||motionCps) ? stageLengthBilledHold("motion", { usdPerSecond:motionUsd, creditsPerSecond:motionCps, orientation:effMotionOrientation, inputSeconds:mediaSeconds(motionVideo), sizable:stageLengthSizesHold(motionVideo) }) : null;');
  one('stageLengthBilledEstimate("editing", { usdPerSecond:sd25Usd, creditsPerSecond:sd25Cps, inputSeconds:mediaSeconds(editVideo) })');
  one('stageLengthBilledEstimate("motion", { usdPerSecond:motionUsd, creditsPerSecond:motionCps, inputSeconds:mediaSeconds(motionVideo), orientation:effMotionOrientation })');
  one('const editHoldInfo = editHold!=null ? stageCreditInfo(creditBalance, editHold, { hold:true, estimate:editCost, basis:stageLengthHoldBasis(editVideo, mediaSeconds(editVideo)) }) : null;');
  one('const motionHoldInfo = motionHold!=null ? stageCreditInfo(creditBalance, motionHold, { hold:true, estimate:motionCost, basis:stageLengthHoldBasis(motionVideo, mediaSeconds(motionVideo)) }) : null;');
  one(': modeHoldBlock(editHoldInfo,"edit");');
  one(': modeHoldBlock(motionHoldInfo,"motion render");');
  one(': modeCreditBlock(extendCost,"extension");');   // Extend's button is blocked below its cost too: every mode
  one('if(modeHoldBlock(editHoldInfo,"edit")){ modeFail(new Error(modeHoldBlock(editHoldInfo,"edit"))); return; }');
  one('if(modeHoldBlock(motionHoldInfo,"motion render")){ modeFail(new Error(modeHoldBlock(motionHoldInfo,"motion render"))); return; }');
  assert.ok(!/modeCreditBlock\((editCost|motionCost)/.test(src), "the quoted price no longer gates Motion Control or editing");
  one('const editCostTitle = editHold!=null ? (holdLead(editHold)');
  one('const motionCostTitle = motionHold!=null ? (holdLead(motionHold)');
  one('const holdLead = (hold)=> "Holds up to "+_fmtN(hold)+" credit"+(hold!==1?"s":"")+"; charged for the finished video’s length";');
  one('const footerCredit = (composerTab==="edit" && editHoldInfo) ? editHoldInfo');
  one('Icon.sparkles&&_stEl(Icon.sparkles,{s:12}),footerCredit.label),');
  one('{ blocked:!!editBlocker, title:editBlocker||editCostTitle, costTitle:editCostTitle, testId:"stage-generate-edit",');
  one('{ blocked:!!motionBlocker, title:motionBlocker||motionCostTitle, costTitle:motionCostTitle, testId:"stage-generate-motion",');
});
await test("K (A2, round 4) the composer's red no-credits outline and the credit warning under it follow the OPEN tab (its hold on Motion Control and Edit Video), not the References render", async () => {
  const src = read("app/stage.jsx");
  const pick = (name) => { const i = src.indexOf("function " + name + "("); assert.ok(i > 0, name); return src.slice(i, src.indexOf("\n}\n", i) + 3); };
  const S = box(); run(S, "app/pricing.jsx"); run(S, "app/plans.jsx"); S.turnIsAdmin = false;
  vm.runInContext(transform(pick("stageCreditInfo") + pick("stageCreditShortText"), "stage-credit-short.jsx"), S);
  const bal300 = { remaining: 300, plan: "studio" };
  const creditInfo = S.stageCreditInfo(bal300, 304);                                        // the References render: 10 s at 720p
  const motionHoldInfo = S.stageCreditInfo(bal300, 126, { hold: true, estimate: 63, basis: "length" });      // the scene follows the character image
  const editHoldInfo = S.stageCreditInfo(bal300, 1709, { hold: true, estimate: 284, basis: "stored" });     // a measured video held at the longest length
  // the component's own footer choice, class and warnings block — evaluated from the source
  const fa = src.indexOf("  const footerCredit = "), fb = src.indexOf(";\n", fa) + 2;
  const footerFor = vm.runInContext("(function(composerTab, editHoldInfo, motionHoldInfo, creditInfo, createTask, extendCreditInfo){ createTask = createTask || 'reference'; extendCreditInfo = extendCreditInfo || null; " + src.slice(fa, fb) + " return footerCredit; })", S);
  const cls = /const composer = _stEl\("div",\{className:("stage2-gen-composer"[^,]*),"data-composer-tab"/.exec(src);
  assert.ok(cls, "the composer's className");
  const composerClass = vm.runInContext("(function(gening, footerCredit, creditInfo){ return " + cls[1] + "; })", S);
  const wa = src.indexOf("    (assetOver || genErr || footerCredit.short) && ");
  assert.ok(wa > 0, "the warnings under the composer");
  const wOpen = src.indexOf("_stEl(", wa) + 5;
  const warnExpr = src.slice(wa, matchParen(src, wOpen) + 1);
  assert.ok(warnExpr.includes('className:"stage2-assets-warnings"'), warnExpr.slice(0, 200));
  const warnings = vm.runInContext("(function(p){ var _stEl=p.el, Icon=p.Icon, sourceBlocking=false, assetOver=false, genErr='', needsVoice=false, budgetOverBy=0,"
    + " footerCredit=p.footerCredit, creditInfo=p.creditInfo, totalCost=p.totalCost; return (\n" + warnExpr + "\n); })", S);
  const scene = (tab, ci = creditInfo, mi = motionHoldInfo, ei = editHoldInfo) => {
    const fc = footerFor(tab, ei, mi, ci);
    return { fc, cls: composerClass(false, fc, ci), text: textOf(warnings({ el, Icon: S.Icon, footerCredit: fc, creditInfo: ci, totalCost: ci.cost })) };
  };
  // Create: the References render (304 > 300) → the red outline + "needs 304"
  let r = scene("create");
  assert.ok(r.cls.split(/\s+/).includes("no-credits"), r.cls);
  assert.ok(r.text.includes("Not enough generation credits — this render needs 304, 300 remaining."), r.text);
  // Motion Control (the verifier's case): its 126 hold is covered → no outline, no credit warning, like the footer and the working Generate
  r = scene("motion");
  assert.equal(r.fc, motionHoldInfo);
  assert.ok(!r.cls.includes("no-credits"), r.cls);
  assert.ok(!/Not enough generation credits/.test(r.text), r.text);
  // Edit Video: its 1,709 hold isn't covered → the outline, and the warning names the hold
  r = scene("edit");
  assert.ok(r.cls.split(/\s+/).includes("no-credits"), r.cls);
  assert.ok(r.text.includes("Not enough generation credits — this render holds up to 1,709 while it runs, 300 remaining."), r.text);
  assert.ok(!r.text.includes("needs 304"), r.text);
  // the other way round: the References render covered (1,000 left), a Motion Control hold of 1,512 (a stub) → warned on Motion only
  const rich = { remaining: 1000, plan: "studio" };
  const ci2 = S.stageCreditInfo(rich, 304), mi2 = S.stageCreditInfo(rich, 1512, { hold: true, basis: "length" }), ei2 = S.stageCreditInfo(rich, 369, { hold: true, basis: "length" });
  assert.ok(!scene("create", ci2, mi2, ei2).cls.includes("no-credits"));
  r = scene("motion", ci2, mi2, ei2);
  assert.ok(r.cls.includes("no-credits") && r.text.includes("this render holds up to 1,512 while it runs, 1,000 remaining."), r.text);
  assert.equal(scene("edit", ci2, mi2, ei2).text, "", "the edit's 369 hold is covered: no warning");
  // an account on hold: the on-hold warning (with Manage plan) on every tab, never a shortfall line
  const fz = { remaining: 5000, plan: "studio", frozen: true };
  for (const tab of ["create", "motion", "edit"]) {
    r = scene(tab, S.stageCreditInfo(fz, 304), S.stageCreditInfo(fz, 126, { hold: true }), S.stageCreditInfo(fz, 369, { hold: true }));
    assert.ok(r.text.includes("Account on hold — spending credits is paused while a payment is disputed.") && r.text.includes("Manage plan") && !/Not enough/.test(r.text), tab + ": " + r.text);
  }
  // no pricing for the tab (no hold info): the References render, as before
  assert.equal(footerFor("motion", null, null, creditInfo), creditInfo);
  // the sentence itself
  assert.equal(S.stageCreditShortText(S.stageCreditInfo({ remaining: 1200 }, 1234)), "Not enough generation credits — this render needs 1,234, 1,200 remaining.");
  assert.equal(S.stageCreditShortText(S.stageCreditInfo({ remaining: 1200 }, 1000)), "");
  assert.equal(S.stageCreditShortText(S.stageCreditInfo(null, 1234)), "", "an unknown balance never warns");
  assert.equal(S.stageCreditShortText(S.stageCreditInfo({ remaining: 5, frozen: true }, 1234)), "", "on hold has its own warning");
  // nothing in the composer or its warnings reads the References render's info any more
  const region = src.slice(src.indexOf("  const composer = _stEl("), wa + warnExpr.length);
  assert.ok(!/creditInfo\.(empty|frozen|known|remaining)/.test(region.replace(/footerCredit/g, "")), "the outline and the warnings use footerCredit");
});
await test("K (A1–A3, round 5) the Stage's credit surfaces, from the component's own lines: no shortfall before a measured video sizes a hold; the right panel's error and the footer follow the open tab (on hold / a hold / a cost); Extend shows the extension's price", async () => {
  const src = read("app/stage.jsx");
  const pick = (name) => { const i = src.indexOf("function " + name + "("); assert.ok(i > 0, name); return src.slice(i, src.indexOf("\n}\n", i) + 3); };
  const a = src.indexOf("const STAGE_LENGTH_HOLD");
  const b = src.indexOf("\n}\n", src.indexOf("function stageCreditInfo(")) + 3;
  const S = box(); run(S, "app/pricing.jsx"); run(S, "app/plans.jsx"); S.turnIsAdmin = false;
  S.TURN_SUPABASE = { url: "https://proj-x.supabase.co" }; S.URL = URL;
  S.turnApplyCreditRegime({ switched: true, usd_per_credit: 0.01, trial_credits: 50, legacy_until: null }, "server");
  vm.runInContext(transform(src.slice(a, b) + pick("stageCreditShortText") + pick("stageCreditPanelText"), "stage-credit-r5.jsx"), S);
  vm.runInContext(src.slice(src.indexOf("function _fmtSecs("), src.indexOf("\n", src.indexOf("function _fmtSecs(")) + 1), S);
  // the component's credit lines: Extend's cost, the Motion Control / edit holds, and Extend's own credit info
  const line = (start) => { const i = src.indexOf(start); assert.ok(i > 0, start); return src.slice(i, src.indexOf("\n", i) + 1); };
  const ca = src.indexOf("  const extendCost = (()=>{");
  const cb = src.indexOf("  const modeCreditBlock = ");
  assert.ok(ca > 0 && cb > ca && src.slice(ca, cb).includes("const extendCreditInfo = "), "the composer's credit lines, through Extend's credit info");
  const credits = vm.runInContext("(function(p){ var resolution=p.resolution, editVideo=p.editVideo||null, motionVideo=p.motionVideo||null, extendVideo=p.extendVideo||null, motionTier='standard',"
    + " effMotionOrientation=p.orientation||'video', creditBalance=p.creditBalance, creditScale=Number(window.CREDIT_SCALE)||1, duration=p.duration||10, VIDEO_INPUT_MUL=0.6;"
    + " var sd25Rate=function(r){ return window.turnVideoCreditRate('seedance-2.5','standard',r); };\n"
    + transform(line("  const mediaSeconds = ") + src.slice(ca, cb), "stage-composer-credits-r5.jsx")
    + "\n return { extendCost:extendCost, extendFloorCost:extendFloorCost, extendCreditInfo:extendCreditInfo, editHoldInfo:editHoldInfo, motionHoldInfo:motionHoldInfo }; })", S);
  // the component's footer choice, outline class, warnings block, right-panel error and footer element
  const fa = src.indexOf("  const footerCredit = "), fb = src.indexOf(";\n", fa) + 2;
  const footerFor = vm.runInContext("(function(composerTab, createTask, editHoldInfo, motionHoldInfo, extendCreditInfo, creditInfo){ " + src.slice(fa, fb) + " return footerCredit; })", S);
  const cls = /const composer = _stEl\("div",\{className:("stage2-gen-composer"[^,]*),"data-composer-tab"/.exec(src);
  const composerClass = vm.runInContext("(function(gening, footerCredit, creditInfo){ return " + cls[1] + "; })", S);
  const wa = src.indexOf("    (assetOver || genErr || footerCredit.short) && ");
  const warnExpr = src.slice(wa, matchParen(src, src.indexOf("_stEl(", wa) + 5) + 1);
  const warnings = vm.runInContext("(function(p){ var _stEl=p.el, Icon=p.Icon, sourceBlocking=false, assetOver=false, genErr='', needsVoice=!!p.needsVoice, budgetOverBy=0,"
    + " footerCredit=p.footerCredit, creditInfo=p.creditInfo, totalCost=p.totalCost; return (\n" + warnExpr + "\n); })", S);
  // the right panel: the line after the asset-budget error that carries the credit error
  // (2026-10-25) a provider refusal has its own line just above; this is the other errors' line
  const pa = src.indexOf('genErr && !providerPolicyFailure && _stEl("div",{className:"stage2-err sd-gen-err"}');
  assert.ok(pa > 0, "the right panel's errors");
  const panelLines = src.slice(src.indexOf("\n", pa) + 1, src.indexOf("      gening\n", pa)).split("\n").filter((l) => l.trim() && !l.trim().startsWith("//"));
  assert.equal(panelLines.length, 1, "one credit error line in the right panel: " + panelLines.join(" | "));
  const panelExpr = panelLines[0].trim().replace(/,$/, "");
  const panel = vm.runInContext("(function(p){ var _stEl=p.el, Icon=p.Icon, footerCredit=p.footerCredit, creditInfo=p.creditInfo; return (" + transform("(" + panelExpr + ")", "panel.jsx").replace(/;\s*$/, "") + "); })", S);
  const ft = src.indexOf('_stEl("div",{className:"stage2-credit sd-gen-credit"');
  assert.ok(ft > 0, "the credit footer");
  const footerEl = vm.runInContext("(function(p){ var _stEl=p.el, Icon=p.Icon, footerCredit=p.footerCredit, creditInfo=p.creditInfo; return (" + src.slice(ft, matchParen(src, ft + 5) + 1) + "); })", S);
  const view = (tab, task, c, creditInfo) => {
    const fc = footerFor(tab, task, c.editHoldInfo, c.motionHoldInfo, c.extendCreditInfo, creditInfo);
    const p = { el, Icon: S.Icon, footerCredit: fc, creditInfo, totalCost: creditInfo.cost };
    const f = footerEl(p), pe = panel(p), we = warnings(p);
    return { fc, outline: composerClass(false, fc, creditInfo).split(/\s+/).includes("no-credits"), warn: we ? (textOf(we) || "<an empty warnings box>") : "", panel: pe ? (textOf(pe) || "<an empty error box>") : "",
      footerCls: String(f.props.className), footerTitle: String(f.props.title), footerLabel: textOf(f) };
  };
  const refs = (bal) => S.stageCreditInfo(bal, 473);   // the References render (the verifier's 473)
  // A1: NO VIDEO YET, 1,000 credits, Edit tab → no outline, no warning, no right-panel error; the footer says what is held and why
  const rich = { remaining: 1000, plan: "studio" };
  let c = credits({ resolution: "720p", creditBalance: rich });
  assert.equal(c.editHoldInfo.cost, 1709); assert.equal(c.editHoldInfo.empty, true, "the server would still refuse 1,709 (Generate's own block)");
  let v = view("edit", "reference", c, refs(rich));
  assert.equal(v.fc, c.editHoldInfo);
  assert.equal(v.outline, false, "no red outline before a video is chosen");
  assert.equal(v.warn, "", "no warning before a video is chosen");
  assert.equal(v.panel, "", "no right-panel error before a video is chosen");
  assert.ok(!v.footerCls.split(/\s+/).includes("empty"), v.footerCls);
  assert.equal(v.footerLabel, "Holds up to 1,709 credits; charged for the finished video’s length · 1,000 remaining");
  assert.ok(v.footerTitle.includes("(the longest length allowed until the video’s length is known)"), v.footerTitle);
  // … the voice notice lives in the composer's notices now (Stage review 2026-10-05), never in this row
  const withVoice = textOf(warnings({ el, Icon: S.Icon, footerCredit: v.fc, creditInfo: refs(rich), totalCost: 473, needsVoice: true }));
  assert.equal(withVoice, "", withVoice);
  // … Motion Control too (378 > 300), and while a chosen video is still being measured
  const bal300 = { remaining: 300, plan: "studio" };
  c = credits({ resolution: "720p", creditBalance: bal300 });
  v = view("motion", "reference", c, refs(bal300));
  assert.deepEqual([v.fc.cost, v.outline, v.warn, v.panel], [378, false, "", ""], "Motion Control, no video");
  const measuring = { kind: "device", url: "blob:https://app/m", ref: "stage:u1/stage/m.mp4", measuring: true };
  c = credits({ resolution: "720p", creditBalance: bal300, motionVideo: measuring, editVideo: measuring });
  for (const tab of ["motion", "edit"]) { v = view(tab, "reference", c, refs(bal300)); assert.deepEqual([v.outline, v.warn, v.panel], [false, "", ""], tab + " while measuring"); }
  // once a measured video is chosen, a shortfall is flagged: a stored 5 s video (the longest length) and a device clip (369 > 300)
  const stored5 = { kind: "take", url: "https://cdn.example.com/take.mp4", ref: "https://cdn.example.com/take.mp4", seconds: 5 };   // a host the server never sizes by length
  const device5 = { kind: "device", url: "blob:https://app/m", ref: "stage:u1/stage/m.mp4", seconds: 5 };
  c = credits({ resolution: "720p", creditBalance: bal300, editVideo: device5, motionVideo: stored5 });
  v = view("edit", "reference", c, refs(bal300));
  assert.equal(v.fc.cost, 369);
  assert.equal(v.outline, true); assert.equal(v.warn.includes("Not enough generation credits — this render holds up to 369 while it runs, 300 remaining."), true, v.warn);
  assert.equal(v.panel, "Not enough generation credits to cover what this render holds.");
  assert.ok(v.footerCls.split(/\s+/).includes("empty"));
  v = view("motion", "reference", c, refs(bal300));
  assert.deepEqual([v.fc.cost, v.outline, v.panel], [378, true, "Not enough generation credits to cover what this render holds."], "a measured video held at the longest length");
  // A2: the right panel on the Create tab with SOME credits left — never "No generation credits remaining"
  v = view("create", "reference", c, refs(bal300));
  assert.equal(v.panel, "Not enough generation credits for this render.");
  assert.equal(v.footerLabel, "Uses about 473 generation credits · 300 remaining");
  assert.ok(v.footerTitle.includes("This render costs about 473 "), v.footerTitle);
  // A2: the footer's title per tab is the open tab's own (Y5), and the right panel follows it (Y4)
  const richC = credits({ resolution: "720p", creditBalance: rich, editVideo: device5, motionVideo: device5 });
  const poor = { remaining: 50, plan: "studio" };   // below the 82 and 369 holds
  const poorC = credits({ resolution: "720p", creditBalance: poor, editVideo: device5, motionVideo: device5 });
  for (const tab of ["motion", "edit"]) {
    v = view(tab, "reference", richC, refs(poor));           // the tab's hold covered, the References render not (a stub mix)
    assert.equal(v.footerTitle, (tab === "edit" ? richC.editHoldInfo : richC.motionHoldInfo).title, tab + ": the footer's title is the tab's hold");
    assert.ok(v.footerTitle.includes("(this video’s length plus a margin)"), v.footerTitle);
    assert.deepEqual([v.panel, v.outline, v.warn], ["", false, ""], tab + ": covered, although the References render isn't");
    v = view(tab, "reference", poorC, refs(rich));           // the other way round
    assert.equal(v.panel, "Not enough generation credits to cover what this render holds.", tab);
    assert.equal(v.footerTitle, (tab === "edit" ? poorC.editHoldInfo : poorC.motionHoldInfo).title);
  }
  // A2: an account on hold with 9,000 credits: the on-hold sentence on every tab and task, never a shortfall
  const fz = { remaining: 9000, plan: "studio", frozen: true };
  const fzC = credits({ resolution: "720p", creditBalance: fz, editVideo: device5, motionVideo: device5, extendVideo: device5 });
  for (const [tab, task] of [["create", "reference"], ["create", "extension"], ["motion", "reference"], ["edit", "reference"]]) {
    v = view(tab, task, fzC, refs(fz));
    assert.equal(v.panel, "Account on hold — spending credits is paused.", tab + "/" + task);
    assert.equal(v.footerLabel, "Account on hold — spending credits is paused");
    assert.equal(v.footerTitle, "A payment on this account is being disputed, so spending credits is paused until it’s resolved.");
    assert.ok(v.outline && v.warn.includes("Account on hold") && !/Not enough/.test(v.warn), tab + "/" + task + ": " + v.warn);
  }
  // A3: Extend — the footer, the outline and the warning use the EXTENSION's price (what its button shows)
  c = credits({ resolution: "720p", creditBalance: bal300, extendVideo: { kind: "device", url: "blob:https://app/x", ref: "stage:u1/stage/x.mp4", seconds: 4 } });
  assert.ok(c.extendCost > 0 && c.extendCost !== 473);
  v = view("create", "extension", c, refs(bal300));
  assert.equal(v.fc.cost, c.extendCost, "the extension's cost, not the References render's");
  assert.equal(v.footerLabel, "Uses about " + c.extendCost + " generation credits · 300 remaining" + (300 >= c.extendCost ? " → " + (300 - c.extendCost) + " after render" : ""));
  assert.ok(!v.warn.includes("473") && !v.footerLabel.includes("473"), v.warn + " | " + v.footerLabel);
  assert.equal(v.outline, c.extendCost > 300);
  const low = { remaining: 50, plan: "studio" };
  const lowC = credits({ resolution: "720p", creditBalance: low, extendVideo: { kind: "device", url: "blob:x", ref: "stage:u1/stage/x.mp4", seconds: 4 } });
  v = view("create", "extension", lowC, refs(rich));
  assert.equal(v.outline, true, "the extension isn't covered (50), although the References render is");
  assert.ok(v.warn.includes("Not enough generation credits — this render needs " + lowC.extendCost + ", 50 remaining."), v.warn);
  assert.equal(v.panel, "Not enough generation credits for this render.");
  v = view("create", "extension", credits({ resolution: "720p", creditBalance: rich, extendVideo: { kind: "device", ref: "stage:u1/stage/x.mp4", seconds: 4 } }), refs(low));
  assert.deepEqual([v.outline, v.warn, v.panel], [false, "", ""], "the extension is covered although the References render isn't");
  // before the video to extend is measured: the added seconds alone — the least it can cost
  const noVid = credits({ resolution: "720p", creditBalance: low, duration: 10 });
  assert.equal(noVid.extendFloorCost, noVid.extendCost, "no video: the output-only price");
  v = view("create", "extension", noVid, refs(rich));
  assert.equal(v.fc.floor, true);
  assert.equal(v.footerLabel, "Uses at least " + noVid.extendFloorCost.toLocaleString("en-US") + " generation credits · 50 remaining");
  assert.ok(v.footerTitle.includes("This render costs at least " + noVid.extendFloorCost.toLocaleString("en-US") + "; the video’s own length is added once it’s chosen and measured."), v.footerTitle);
  assert.equal(v.outline, noVid.extendFloorCost > 50);
  if (noVid.extendFloorCost > 50) assert.ok(v.warn.includes("this render needs at least " + noVid.extendFloorCost.toLocaleString("en-US") + ", 50 remaining."), v.warn);
  const meas = credits({ resolution: "720p", creditBalance: rich, extendVideo: { kind: "device", ref: "stage:u1/stage/x.mp4", measuring: true } });
  assert.equal(meas.extendCost, null);
  v = view("create", "extension", meas, refs(low));
  assert.equal(v.fc.floor, true, "while measuring: the floor, never the References render");
  assert.deepEqual([v.outline, v.warn], [false, ""]);
  // the References task keeps the References render
  assert.equal(view("create", "reference", c, refs(bal300)).fc.cost, 473);
  // the References render's own refusal toast never says "No generation credits remaining"
  assert.ok(!src.includes("No generation credits remaining"), "no 'No generation credits remaining' anywhere in the Stage");
  assert.equal(S.stageCreditPanelText(S.stageCreditInfo(bal300, 473)), "Not enough generation credits for this render.");
  assert.equal(S.stageCreditPanelText(S.stageCreditInfo(bal300, 100)), "");
  // the two sentences on their own: nothing for a hold that no measured video sizes yet (it would still block Generate)
  const pendingHold = S.stageCreditInfo(rich, 1709, { hold: true });
  assert.deepEqual([pendingHold.empty, pendingHold.short, S.stageCreditShortText(pendingHold), S.stageCreditPanelText(pendingHold)], [true, false, "", ""]);
  const sizedHold = S.stageCreditInfo(rich, 1709, { hold: true, basis: "stored" });
  assert.deepEqual([sizedHold.short, S.stageCreditShortText(sizedHold), S.stageCreditPanelText(sizedHold)],
    [true, "Not enough generation credits — this render holds up to 1,709 while it runs, 1,000 remaining.", "Not enough generation credits to cover what this render holds."]);
});
await test("K the Stage's blocked-render banner says 'Account on hold' with Manage plan for a frozen account", () => {
  const src = read("app/stage.jsx");
  assert.ok(src.includes('"Account on hold — spending credits is paused while a payment is disputed."'));
  assert.ok(src.includes("window.turnOpenManagePlan()"));
  assert.ok(src.includes('"Your account is on hold while a payment is disputed, so spending credits is paused."'));
});

/* ════════ L: voicegen ════════ */
await test("L a voice 402 reads calmly and opens the Plans window; a paid voice call refreshes the balance", async () => {
  const G = box({ Date, Math, JSON, Promise });
  G.TURN_SUPABASE = { url: "u", anonKey: "k", imageProxy: true, imageProxyFn: "image-proxy" };
  G.voiceMode = "refuse";
  G.sbClient = () => ({ functions: { invoke: async () => {
    if (G.voiceMode === "refuse") {
      const ctx = { status: 402, json: async () => ({ error: "no_plan", message: "Choose a plan to start creating — every generation runs on your plan's credits." }) };
      ctx.clone = () => ctx;
      return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } };
    }
    return { data: { audio: "b64", mime: "audio/mpeg" } };
  } } });
  run(G, "app/plans.jsx");
  vm.runInContext(transform(read("app/voicegen.jsx"), "app/voicegen.jsx"), G, { filename: "app/voicegen.jsx" });
  G.vgAssertIdentity = noop;
  let plans = 0; G.turnOpenPlans = () => { plans++; };
  await assert.rejects(G.vgProxy("tts", { text: "Hello" }), (e) => e.message === "Choose a plan to start creating — every generation runs on your plan's credits." && e.code === "no_plan");
  assert.equal(plans, 1);
  G.voiceMode = "ok"; G.events.length = 0;
  await G.vgProxy("tts", { text: "Hello" });
  assert.ok(G.events.some((e) => e.type === "turn-credits-changed" && e.detail.reason === "voice-tts"));
  G.events.length = 0;
  await G.vgProxy("listVoices", {});
  assert.equal(G.events.filter((e) => e.type === "turn-credits-changed").length, 0, "free ops don't");
});

/* ════════ D (cloud.jsx) + H (sign-up metadata) ════════ */
const C = box({ Date, Math, JSON, Promise });
C.setTimeout = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; };
run(C, "app/cloud.jsx");
await test("D cloud.jsx shapes the new turn_credit_balance columns; an old two-column row still works", () => {
  const s = C._turnCreditShape({ remaining: 1234, plan: "director", plan_remaining: 1000, pack_remaining: 234, next_pack_expiry: "2027-09-12T00:00:00Z", payment_status: "past_due", frozen: false, trial: false }, "turn_credit_balance");
  assert.equal(s.remaining, 1234); assert.equal(s.planRemaining, 1000); assert.equal(s.packRemaining, 234);
  assert.equal(s.nextPackExpiry, "2027-09-12T00:00:00Z"); assert.equal(s.paymentStatus, "past_due"); assert.equal(s.frozen, false); assert.equal(s.trial, false);
  const old = C._turnCreditShape({ remaining: 480, plan: "writer" }, "turn_credit_balance");
  assert.equal(old.remaining, 480); assert.equal(old.planRemaining, null); assert.equal(old.packRemaining, null); assert.equal(old.paymentStatus, null); assert.equal(old.frozen, false);
  const f = C._turnCreditShape({ remaining: 0, plan: "none", frozen: true, trial: true }, "turn_credit_balance");
  assert.equal(f.frozen, true); assert.equal(f.trial, true);
});
await test("D user-editable auth metadata can never mark an account frozen-free, paid-up or on a trial", () => {
  const m = C._turnCreditShape({ remaining: 99999, plan: "studio", plan_remaining: 99999, payment_status: "active", frozen: false, trial: true }, "auth metadata");
  assert.equal(m.planRemaining, null); assert.equal(m.paymentStatus, null); assert.equal(m.trial, false); assert.equal(m.frozen, false);
});
await test("H sign-up saves the chosen plan on the ACCOUNT (user metadata); 'free' saves nothing; the saved choice can be read and cleared", async () => {
  const calls = [];
  C._sbClient = { auth: {
    signUp: async (arg) => { calls.push(["signUp", arg]); return { data: {}, error: null }; },
    updateUser: async (arg) => { calls.push(["updateUser", arg]); return { data: {}, error: null }; },
  } };
  C.localStorage.setItem("turn-intended-plan", "director");
  await C.cloudSignUp("a@b.test", "pw");
  const a = calls[0][1];
  assert.equal(a.email, "a@b.test"); assert.equal(a.options.data.intended_plan, "director");
  assert.ok(Date.parse(a.options.data.intended_plan_at) > 0);
  C.localStorage.setItem("turn-intended-plan", "free");
  await C.cloudSignUp("c@d.test", "pw");
  assert.equal(calls[1][1].options, undefined, "no metadata for a plan-less sign-up");
  await C.cloudSignUp("e@f.test", "pw", { plan: "studio" });
  assert.equal(calls[2][1].options.data.intended_plan, "studio");
  const at = "2026-10-01T10:00:00.000Z";
  assert.deepEqual({ ...C.cloudAccountIntendedPlan({ user: { user_metadata: { intended_plan: "writer", intended_plan_at: at } } }) }, { plan: "writer", at: Date.parse(at) });
  assert.equal(C.cloudAccountIntendedPlan({ user: { user_metadata: { intended_plan: "gold" } } }), null);
  assert.equal(C.cloudAccountIntendedPlan(null), null);
  assert.equal(await C.cloudClearAccountIntendedPlan(), true);
  assert.deepEqual(plain(calls[3]), ["updateUser", { data: { intended_plan: null, intended_plan_at: null } }]);
  delete C._sbClient;
});

/* ════════ M: welcome, landing, app.jsx wiring, Home, CSS ════════ */
await test("M the welcome card copy (plan live / activating) and the pack card copy", () => {
  const live = P.turnWelcomePlanCopy("director", 1600, false);
  assert.equal(live.title, "Your Director plan is live");
  assert.equal(live.sub, "1,600 credits are ready — every generation runs on them. They refresh on your renewal date, and unused monthly credits don’t roll over.");
  assert.equal(live.note, "Card, invoices and cancelling are under Manage plan in the account menu.");
  const act = P.turnWelcomePlanCopy("director", 0, true);
  assert.equal(act.title, "Setting up your plan…");
  assert.equal(act.sub, "Payment received — your credits are being added. This only takes a few seconds.");
  P.React.reset();
  const card = P.WelcomePlanCard({ plan: "studio", credits: 5000, activating: false, onNewStory: noop, onClose: noop });
  assert.equal(textOf(findAll(card, hasClass("welcome-title"))[0]), "Your Producer plan is live");
  assert.equal(textOf(findAll(card, hasClass("welcome-note"))[0]), live.note);
  const pack = P.turnWelcomePackCopy(250, false, { remaining: 1250, plan: "writer", planRemaining: 1000, packRemaining: 250, nextPackExpiry: null });
  assert.equal(pack.title, "Extra credits added");
  assert.equal(pack.sub, "Pack credits last 12 months and are never reset when a plan renews. Your balance is now 1,250 credits · 1,000 plan + 250 pack.");
  assert.equal(P.turnWelcomePackCopy(300, false, null).sub, "Pack credits last 12 months and are never reset when a plan renews. Your balance is now 300 credits.");
  assert.equal(P.turnWelcomePackCopy(0, true).title, "Adding your extra credits…");
});
const LP_TRIAL = "New accounts get 50 free credits after confirming their email.";   // owner request 2026-10-02 (R1)
await test("M the landing: the free-trial + packs line under the plan cards (R1: the short trial sentence; the Plans window keeps TRIAL_COPY)", () => {
  const L = box({ usePlansVersion: () => 0 });
  run(L, "app/plans.jsx"); run(L, "app/landing.jsx");
  assert.equal(L.lpTrialLine(), LP_TRIAL);
  assert.equal(L.lpPricingNote(), LP_TRIAL+" Need more? Credit packs from $10 for any account — pack credits last 12 months.");
  assert.ok(!L.lpPricingNote().includes(L.TURN_TRIAL_COPY), "the landing no longer shows the long trial copy");
  assert.equal(L.turnTrialCopy(), L.TURN_TRIAL_COPY, "TRIAL_COPY stays for the Plans window (and the Terms)");
  L.React.reset();
  const page = L.Landing({ onStart: noop, onSignIn: noop });
  assert.equal(findAll(page, hasClass("lp-tier-note")).length, 1);
  // owner 2026-10-02: the packs sentence on its own line; no price-terms line on the landing
  const note = findAll(page, hasClass("lp-tier-note"))[0];
  assert.equal(textOf(note), LP_TRIAL+"Need more? Credit packs from $10 for any account — pack credits last 12 months.");
  assert.equal(findAll(note, (n) => n && n.type === "br").length, 1, "the packs sentence starts a new line");
  assert.ok(!JSON.stringify(page).includes("Prices in US dollars"), "the price-terms line is gone from the landing");
  assert.deepEqual(plain(L.lpPricingLines()), [LP_TRIAL, "Need more? Credit packs from $10 for any account — pack credits last 12 months."]);
  assert.equal(findAll(page, hasClass("lp-room-status")).length, 0, "no plan chips on the room cards (owner 2026-10-03)");
});
await test("M app.jsx: trial isn't a paid plan; notices mounted; welcome waits for the bought plan; the intent effect reads the account and runs after the ledger exists", () => {
  const src = read("app/app.jsx");
  const fn = src.slice(src.indexOf("window.turnIsPaidPlan = function"), src.indexOf("};", src.indexOf("window.turnIsPaidPlan = function")) + 2);
  const A = { window: {} }; A.window = A; vm.createContext(A); vm.runInContext(fn, A);
  assert.equal(A.turnIsPaidPlan("trial"), false); assert.equal(A.turnIsPaidPlan("none"), false); assert.equal(A.turnIsPaidPlan("studio"), true);
  assert.ok(src.includes("window.BillingNotices && React.createElement(window.BillingNotices,{ balance:creditBalance })"));
  assert.ok(src.includes('u.searchParams.delete("plan")'));
  assert.ok(/String\(creditBalance\.plan\)\.toLowerCase\(\)===welcomePlan/.test(src));
  const decl = src.indexOf("const [creditBalance, setCreditBalance] = React.useState(null);");
  const eff = src.indexOf("window.turnPickIntendedPlan");
  assert.ok(decl > 0 && eff > decl, "the intent effect must follow the creditBalance declaration (var hoisting would freeze its deps)");
  assert.ok(src.includes("window.cloudClearAccountIntendedPlan()") && src.includes("window.cloudAccountIntendedPlan(session)"));
  assert.ok(!src.includes("fresh = !!at && (Date.now() - at) < 20*60*1000"), "the old browser-only 20-minute path is gone");
});
await test("M Home: no automatic posters for a trial / no-plan account, and none before the ledger loads", () => {
  const src = read("app/home-dashboard.jsx");
  // (Home review 2026-10-09) Home paints nothing on its own any more: it OFFERS, and no offer is made to a
  // trial / no-plan account or before the ledger loads
  assert.ok(src.includes('const draftOnly = (typeof window.turnDraftImagesOnly==="function" && window.turnDraftImagesOnly())'));
  assert.ok(src.includes("|| !!(window.turnUserId && !window.turnCreditBalance && !window.turnIsAdmin);"));
  assert.ok(src.includes('(typeof onGeneratePoster==="function" && !draftOnly) ? noPoster.filter('));
});
await test("M CSS: banners, Plans window lines, welcome note and the landing line are styled (theme tokens only)", () => {
  const css = read("app/styles.css");
  const start = css.indexOf("/* ===================== Billing fixes (2026-09-30)");
  const block = css.slice(start, css.indexOf("/* ============================================================\n   ADMIN STORAGE PAGE"));
  assert.ok(start > 0 && block.length > 500, "the block sits before the admin block (whose test reads to the end of the file)");
  for (const sel of [".billing-notices{", ".billing-banner{", ".billing-banner.bad{", ".billing-banner-act{", ".billing-banner-x{", ".plans-balance{", ".plans-trial{", ".plans-manage{", ".plans-switch-note{", ".welcome-note{"])
    assert.ok(block.includes(sel), sel);
  assert.ok(!/#[0-9a-f]{3,6}\b|rgba?\(/i.test(block), "no raw colours");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("color-scheme:dark;"));
  const defined = new Set([...root.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  for (const v of new Set([...block.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))) assert.ok(defined.has(v), "token " + v + " exists in :root");
  const landing = css.slice(css.indexOf("/* ===================== Commercial landing page"), css.indexOf("/* Screenplay preview modal"));
  assert.ok(landing.includes(".lp-tier-note{max-width:720px;margin:22px auto 0;text-align:center;font-size:14px;line-height:1.55;color:var(--lpw-sub)}"), "the landing line uses the website palette");
  assert.ok(css.includes(".acct-upgrade.acct-manage{background:var(--bg-2)"), "the Manage plan workflow's CSS is intact");
});
await test("M brand: the new copy names no retired name (TURN, MUSE, Cinema Machine, 'Studio plan')", () => {
  const all = [P.TURN_TRIAL_COPY, ...Object.values(P.TURN_PLANS_COPY).filter((x) => typeof x === "string"), P.TURN_PLANS_COPY.trial(5),
    ...P.turnBillingNoticeList(bal("writer", 5, 0, { paymentStatus: "past_due" }), 5, 600).flatMap((n) => [n.title, n.body, n.action])].join(" | ");
  assert.ok(!/\bTURN\b|\bMUSE\b|cinema[\s_-]?machine|\bStudio plan\b|Claude|Anthropic/i.test(all), all);
});

/* ════════ N: the LIVE credit unit (integration, 2026-09-30) ════════
   Until billing-switch.sql runs, turn_credit_regime() says 1 credit = $0.03 and the server charges in
   that unit; the app follows it (app/pricing.jsx turnApplyCreditRegime, fed by app/cloud.jsx
   cloudLoadCreditRegime): cost chips, plan cards (800 / 2,400 / 9,000), no trial copy, packs not on
   sale; after the switch everything reads Option A again. */
{
  const N = box({});
  run(N, "app/pricing.jsx"); run(N, "app/plans.jsx"); run(N, "app/landing.jsx");
  N.addEventListener = (t, f) => { (N.__ls = N.__ls || {})[t] = (N.__ls[t] || []).concat(f); };
  N.dispatchEvent = (ev) => { N.events.push(ev); ((N.__ls || {})[ev.type] || []).forEach((f) => f(ev)); return true; };
  // plans.jsx subscribed through the sandbox's addEventListener before we replaced it: re-run it on the live bus
  run(N, "app/plans.jsx");
  const cards = () => plain(N.CINEMA_PLANS.map((p) => [p.tier, p.credits, p.features[0]]));
  await test("N (F16/F24) nothing read yet: cost quotes keep the safe switched unit, but no trial line, no allowance number and no pack on sale", () => {
    assert.equal(N.turnCreditRegime().switched, true);
    assert.equal(N.turnCreditRegime().source, "default");
    assert.equal(N.turnCreditRegimeKnown(), false);
    assert.equal(N.TURN_PRICING.credit.visibleProviderUsd, 0.01);
    assert.equal(N.turnCreditCost(3.034), 304, "10 s of 720p — a quote may be high, never low");
    assert.deepEqual(cards(), [["writer", 600, "Monthly credits included"], ["director", 1600, "Monthly credits included"], ["studio", 5000, "Monthly credits included"]]);
    assert.equal(N.turnTrialOffered(), false);
    assert.equal(N.turnTrialCopy(), "", "no '50 free credits' before the server says the trial exists");
    assert.equal(N.lpPricingNote(), "", "the landing line hides");
    // even with every link pasted in, nothing opens a checkout
    const saved = N.CINEMA_CREDIT_PACKS.map((p) => p.test);
    N.CINEMA_CREDIT_PACKS.forEach((p, i) => { p.test = "https://buy.stripe.com/test_new" + i; });
    try {
      N.turnUserId = "u-1"; N.turnIsPaidPlan = paidFn; N.turnIsAdmin = false; N.usePlansVersion = () => 0;
      N.turnCreditBalance = { remaining: 10, plan: "writer" }; N.React.reset(); N.opened.length = 0;
      const tree = N.PlansModal({ onClose: noop, currentPlan: "writer" });
      const btns = findAll(tree, hasClass("credit-pack")).map((c) => findAll(c, (n) => n.type === "button")[0]);
      assert.deepEqual(btns.map(textOf), ["Coming soon", "Coming soon", "Coming soon"]);
      assert.ok(btns.every((b) => b.props.disabled === true));
      btns.forEach((b) => b.props.onClick()); assert.equal(N.opened.length, 0);
      N.turnUserId = null; N.React.reset();
      const out = N.PlansModal({ onClose: noop, currentPlan: null });
      assert.equal(findAll(out, hasClass("plans-trial")).length, 0, "a signed-out visitor sees no trial line yet");
    } finally { N.CINEMA_CREDIT_PACKS.forEach((p, i) => { p.test = saved[i]; }); }
  });
  let savedPack0Test = "";   // pack 0's real test link, borrowed by the two tests below and put back
  await test("N before the switch (usd_per_credit 0.03): costs, text fallbacks, cards, trial and packs follow — and the choice is remembered", () => {
    const changed = N.turnApplyCreditRegime([{ switched: false, switched_at: null, usd_per_credit: "0.03", trial_credits: 0, legacy_until: null }], "server");
    assert.equal(changed, true);
    assert.equal(N.TURN_PRICING.credit.baseProviderUsd, 0.30);
    assert.equal(N.turnCreditCost(3.034), 102, "10 s of 720p = 102, as the server charges before the switch");
    assert.equal(N.turnCreditCost(0.12), 4, "a $0.12 image");
    assert.equal(N.TURN_PRICING.text.creditRates["claude-fable-5-2"], 0.09, "the text fallbacks scale too");
    assert.ok(N.events.some((e) => e.type === "turn-pricing-changed") && N.events.some((e) => e.type === "turn-credit-regime-changed"), "derived copies refresh");
    assert.deepEqual(cards(), [["writer", 800, "800 credits / month"], ["director", 2400, "2,400 credits / month"], ["studio", 9000, "9,000 credits / month"]]);
    assert.equal(N.turnTrialCopy(), "", "no trial before the switch (the database grants none)");
    assert.equal(N.lpPricingNote(), "", "the landing line hides (a preview host has no old-pack checkout links)");
    // on the live host the old packs ARE on sale before the switch, so the landing says so (landing copy 2026-10-01)
    N.location.hostname = "kinolot.infinitestudioai.com";
    try {
      assert.equal(N.lpPricingNote(), "Credit packs from $9 for any account — pack credits last 12 months.");
      N.usePlansVersion = () => 0; N.React.reset();
      const note = findAll(N.Landing({ onStart: noop, onSignIn: noop }), hasClass("lp-tier-note"));
      assert.equal(note.length, 1);
      assert.equal(textOf(note[0]), "Credit packs from $9 for any account — pack credits last 12 months.");
    } finally { N.location.hostname = "localhost"; }
    N.usePlansVersion = () => 0; N.React.reset();
    assert.equal(findAll(N.Landing({ onStart: noop, onSignIn: noop }), hasClass("lp-tier-note")).length, 0, "with no offer to name, no note shows (owner 2026-10-02: no price-terms line)");
    assert.equal(JSON.parse(N.localStorage.getItem("turn-credit-regime-v1")).switched, false, "remembered for the next first paint");
    // a pack link pasted in early still can't open a checkout before the switch
    savedPack0Test = N.CINEMA_CREDIT_PACKS[0].test;
    N.CINEMA_CREDIT_PACKS[0].test = "https://buy.stripe.com/test_pack250";
    N.turnUserId = "u-1"; N.turnIsPaidPlan = paidFn; N.turnIsAdmin = false; N.usePlansVersion = () => 0;
    N.turnCreditBalance = { remaining: 10, plan: "writer" }; N.React.reset();
    const tree = N.PlansModal({ onClose: noop, currentPlan: "writer" });
    const packBtns = findAll(tree, hasClass("credit-pack")).map((c) => findAll(c, (n) => n.type === "button")[0]);
    assert.equal(packBtns[0].props.disabled, true); assert.equal(textOf(packBtns[0]), "Coming soon");
    packBtns[0].props.onClick(); assert.equal(N.opened.length, 0, "no checkout");
  });
  await test("N a second copy of the app reads the remembered unit at load (no flash of the wrong prices)", () => {
    const M = box({}); M.localStorage.setItem("turn-credit-regime-v1", N.localStorage.getItem("turn-credit-regime-v1"));
    run(M, "app/pricing.jsx"); run(M, "app/plans.jsx");
    assert.equal(M.turnCreditRegime().source, "saved"); assert.equal(M.turnCreditCost(3.034), 102);
    assert.deepEqual(plain(M.CINEMA_PLANS.map((p) => p.credits)), [800, 2400, 9000]);
  });
  await test("N (F21) before the switch the Plans window sells the three OLD packs (their links and amounts as at HEAD); the new ones are not shown", async () => {
    const old = plain(N.TURN_LEGACY_CREDIT_PACKS.map((p) => [p.sku, p.credits, p.price, p.live]));
    assert.deepEqual(old, [
      ["credits-300", 300, "$9", "https://buy.stripe.com/8x200l63a2zVfpO9Dlc7u03"],
      ["credits-1200", 1200, "$29", "https://buy.stripe.com/9B6cN73V28YjfpO02Lc7u04"],
      ["credits-4000", 4000, "$79", "https://buy.stripe.com/8x200l77e1vR4La7vdc7u05"]]);
    // the same links and amounts the app sold before the billing fixes
    let head = "";
    try { head = execSync("git show HEAD:app/plans.jsx", { cwd: new URL("../", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) {}
    if (head) for (const p of N.TURN_LEGACY_CREDIT_PACKS) assert.ok(head.includes(p.live) && head.includes("credits:" + p.credits), p.sku + " matches HEAD");
    assert.equal(N.turnCreditRegime().switched, false);
    N.location.hostname = "kinolot.infinitestudioai.com";
    try {
      N.turnUserId = "u-1"; N.turnUserEmail = "a@b.test"; N.turnIsPaidPlan = paidFn; N.turnIsAdmin = false; N.usePlansVersion = () => 0;
      N.turnCreditBalance = { remaining: 300, plan: "director" }; N.React.reset(); N.opened.length = 0;
      const tree = N.PlansModal({ onClose: noop, currentPlan: "director" });
      const packs = findAll(tree, hasClass("credit-pack"));
      assert.deepEqual(packs.map((c) => textOf(findAll(c, hasClass("credit-pack-name"))[0])), ["300 credits", "1,200 credits", "4,000 credits"]);
      assert.deepEqual(packs.map((c) => textOf(findAll(c, hasClass("credit-pack-price"))[0])), ["$9", "$29", "$79"]);
      const btns = packs.map((c) => findAll(c, (n) => n.type === "button")[0]);
      assert.deepEqual(btns.map(textOf), ["Buy 300", "Buy 1,200", "Buy 4,000"]);
      N.rendered.length = 0;
      btns[1].props.onClick();
      await noStepMounted(N);
      assert.equal(N.opened.length, 1);
      assert.equal(N.opened[0], "https://buy.stripe.com/9B6cN73V28YjfpO02Lc7u04?client_reference_id=u-1&prefilled_email=a%40b.test", "the user id and the account email (E2a)");
      assert.equal(N.turnPackOnSale(N.CINEMA_CREDIT_PACKS[0]), false, "a new pack is never on sale before the switch");
      // a test host never opens the old live links (their test slots are empty)
      N.location.hostname = "localhost"; N.React.reset();
      const local = N.PlansModal({ onClose: noop, currentPlan: "director" });
      assert.deepEqual(findAll(local, hasClass("credit-pack")).map((c) => textOf(findAll(c, (n) => n.type === "button")[0])), ["Coming soon", "Coming soon", "Coming soon"]);
    } finally { N.location.hostname = "localhost"; N.opened.length = 0; }
  });
  await test("N (F21) the low-balance banner's 'Top up with a credit pack' is true during the notice: a pack is on sale", () => {
    const n20 = N.turnBillingNoticeList(bal("director", 300), 20, 2400)[0];
    assert.match(n20.body, /Top up with a credit pack/);
    N.location.hostname = "kinolot.infinitestudioai.com";
    try { assert.ok(N.turnActiveCreditPacks().some((p) => N.turnPackOnSale(p)), "an old pack can be bought"); }
    finally { N.location.hostname = "localhost"; }
  });
  await test("N the switch day (usd_per_credit 0.01, trial 50): back to Option A everywhere; the pasted pack link opens checkout", async () => {
    N.turnApplyCreditRegime({ switched: true, switched_at: "2026-10-30T09:00:00Z", usd_per_credit: 0.01, trial_credits: 50, legacy_until: "2026-11-29T09:00:00Z" }, "server");
    assert.equal(N.turnCreditCost(3.034), 304);
    assert.equal(N.turnActiveCreditPacks(), N.CINEMA_CREDIT_PACKS, "F21: the new packs from the switch day");
    N.location.hostname = "kinolot.infinitestudioai.com";
    assert.ok(N.TURN_LEGACY_CREDIT_PACKS.every((p) => !N.turnPackOnSale(p)), "F21: an old pack is never on sale after the switch (it would grant a third of its price)");
    N.location.hostname = "localhost";
    assert.equal(N.TURN_PRICING.text.creditRates["claude-fable-5-2"], 0.27);
    assert.deepEqual(cards(), [["writer", 600, "600 credits / month"], ["director", 1600, "1,600 credits / month"], ["studio", 5000, "5,000 credits / month"]]);
    assert.equal(N.turnTrialCopy(), N.TURN_TRIAL_COPY);
    assert.equal(N.lpPricingNote(), LP_TRIAL+" Need more? Credit packs from $10 for any account — pack credits last 12 months.");
    N.React.reset();
    const tree = N.PlansModal({ onClose: noop, currentPlan: "writer" });
    const btn = findAll(findAll(tree, hasClass("credit-pack"))[0], (n) => n.type === "button")[0];
    assert.equal(btn.props.disabled, false); N.rendered.length = 0; btn.props.onClick();
    await noStepMounted(N);
    assert.equal(N.opened.length, 1); assert.ok(N.opened[0].startsWith("https://buy.stripe.com/test_pack250?client_reference_id=u-1"));
    N.CINEMA_CREDIT_PACKS[0].test = savedPack0Test;
    // grandfathering is told in the Plans window while legacy_until is ahead
    const now = Date.parse("2026-11-01T00:00:00Z");
    assert.equal(N.turnLegacyAllowanceNote({ remaining: 7000, plan: "director", plan_remaining: 7000, pack_remaining: 0, plan_allowance: 7200 }, now),
      "Your monthly allowance stays 7,200 credits until 29 Nov 2026; renewals after that give 1,600.");
    assert.equal(N.turnLegacyAllowanceNote({ remaining: 1000, plan: "director", plan_remaining: 1000, pack_remaining: 0, plan_allowance: 1600 }, now), "", "a new subscriber: no note");
    assert.equal(N.turnLegacyAllowanceNote({ remaining: 7000, plan: "director", plan_remaining: 7000, pack_remaining: 0, plan_allowance: 7200 }, Date.parse("2026-12-01T00:00:00Z")), "", "after the window");
    assert.equal(N.turnLegacyAllowanceNote({ remaining: 50, plan: "none", trial: true, plan_remaining: 50, pack_remaining: 0, plan_allowance: 50 }, now), "", "not a subscriber");
    // …and the subscriber's own card says the same, so it never reads 1,600 next to a 7,200 note
    const gf = { remaining: 7000, plan: "director", plan_remaining: 7000, pack_remaining: 0, plan_allowance: 7200 };
    assert.equal(N.turnLegacyCardCreditLine(gf, "director", now), "7,200 credits / month until 29 Nov 2026, then 1,600");
    assert.equal(N.turnLegacyCardCreditLine(gf, "writer", now), "", "another plan's card keeps its own line");
    assert.equal(N.turnLegacyCardCreditLine({ ...gf, plan_allowance: 1600 }, "director", now), "", "a new subscriber: the plain line");
    assert.equal(N.turnLegacyCardCreditLine(gf, "director", Date.parse("2026-12-01T00:00:00Z")), "", "after the window");
    assert.equal(N.turnApplyCreditRegime({ switched: true, usd_per_credit: 0.01, trial_credits: 50, legacy_until: "2026-11-29T09:00:00Z" }, "server"), false, "no change, no event storm");
    assert.equal(N.turnApplyCreditRegime({ nonsense: 1 }), false, "a bad read changes nothing");
  });
  await test("N app/cloud.jsx reads turn_credit_regime(); a database without it (billing-v2.sql not run) is the old unit", async () => {
    const K = box({}); run(K, "app/pricing.jsx");
    let answer = { data: [{ switched: true, usd_per_credit: 0.01, trial_credits: 50, legacy_until: null }], error: null };
    K.sbClient = () => ({ rpc: async (name) => { K.called = name; return answer; } });
    run(K, "app/cloud.jsx");
    K.sbClient = () => ({ rpc: async (name) => { K.called = name; return answer; } });
    await K.cloudLoadCreditRegime();
    assert.equal(K.called, "turn_credit_regime"); assert.equal(K.turnCreditRegime().switched, true);
    answer = { data: null, error: { code: "PGRST202", message: "Could not find the function public.turn_credit_regime" } };
    await K.cloudLoadCreditRegime();
    assert.equal(K.turnCreditRegime().switched, false); assert.equal(K.turnCreditCost(3.034), 102);
    answer = { data: null, error: { code: "500", message: "network down" } };
    assert.equal(await K.cloudLoadCreditRegime(), null, "an outage changes nothing");
    assert.equal(K.turnCreditRegime().switched, false);
  });
}

/* ════════ O: the unit becomes KNOWN (F16/F24, A12) ════════ */
{
  const mk = () => { const X = box({}); run(X, "app/pricing.jsx");
    X.addEventListener = (t, f) => { (X.__ls = X.__ls || {})[t] = (X.__ls[t] || []).concat(f); };
    X.dispatchEvent = (ev) => { X.events.push(ev); ((X.__ls || {})[ev.type] || []).forEach((f) => f(ev)); return true; };
    run(X, "app/plans.jsx"); run(X, "app/landing.jsx"); return X; };
  await test("O a first server read that EQUALS the default still makes the unit known: numbers, trial line and landing line appear (event fired)", () => {
    const X = mk();
    assert.equal(X.CINEMA_PLANS[0].features[0], "Monthly credits included");
    const changed = X.turnApplyCreditRegime({ switched: true, usd_per_credit: 0.01, trial_credits: 50, legacy_until: null }, "server");
    assert.equal(changed, true, "became known");
    assert.ok(X.events.some((e) => e.type === "turn-credit-regime-changed"));
    assert.ok(!X.events.some((e) => e.type === "turn-pricing-changed"), "costs didn't move");
    assert.deepEqual(plain(X.CINEMA_PLANS.map((p) => p.features[0])), ["600 credits / month", "1,600 credits / month", "5,000 credits / month"]);
    assert.equal(X.turnTrialCopy(), X.TURN_TRIAL_COPY);
    assert.ok(X.lpPricingNote().startsWith(LP_TRIAL+" Need more? "));
  });
  await test("O (R1) the landing's trial sentence takes its number from the live regime's trial credits", () => {
    const X = mk();
    X.turnApplyCreditRegime({ switched: true, usd_per_credit: 0.01, trial_credits: 1200, legacy_until: null }, "server");
    assert.equal(X.lpTrialLine(), "New accounts get 1,200 free credits after confirming their email.");
    assert.ok(X.lpPricingNote().startsWith("New accounts get 1,200 free credits after confirming their email. Need more? Credit packs from $10"));
  });
  await test("O (A12) a switched regime that reports trial_credits 0 offers no trial anywhere", () => {
    const X = mk();
    X.turnApplyCreditRegime({ switched: true, usd_per_credit: 0.01, trial_credits: 0, legacy_until: null }, "server");
    assert.equal(X.turnTrialOffered(), false);
    assert.equal(X.turnTrialCopy(), "");
    assert.equal(X.lpPricingNote(), "Credit packs from $10 for any account — pack credits last 12 months.", "no trial sentence; the packs on sale are still named (landing copy 2026-10-01)");
    assert.equal(X.lpTrialLine(), "");
    X.turnUserId = null; X.turnIsPaidPlan = paidFn; X.usePlansVersion = () => 0; X.React.reset();
    assert.equal(findAll(X.PlansModal({ onClose: noop, currentPlan: null }), hasClass("plans-trial")).length, 0);
  });
  await test("O this browser's saved copy of a read counts as known at load (no placeholder flash on a return visit)", () => {
    const X = box({}); X.localStorage.setItem("turn-credit-regime-v1", JSON.stringify({ switched: true, usd_per_credit: 0.01, trial_credits: 50, legacy_until: null }));
    run(X, "app/pricing.jsx"); run(X, "app/plans.jsx");
    assert.equal(X.turnCreditRegime().source, "saved"); assert.equal(X.turnCreditRegimeKnown(), true);
    assert.equal(X.CINEMA_PLANS[1].features[0], "1,600 credits / month");
    assert.equal(X.turnTrialCopy(), X.TURN_TRIAL_COPY);
  });
  await test("O app.jsx retries a failed regime read (30 s, 3 times) and re-reads every 5 minutes while visible", () => {
    const src = read("app/app.jsx");
    const a = src.indexOf("let regimeAt = 0, regimeRetries = 0"), b = src.indexOf("// a server \"price changed\" refusal can mean the unit just switched", a);
    assert.ok(a > 0 && b > a);
    const block = src.slice(a, b);
    // run the effect body with fake timers and a regime read that fails twice, then lands
    const timers = []; const intervals = []; let reads = 0; const answers = [null, null, { switched: true }];
    const W = { cloudLoadCreditRegime: async () => { reads++; return answers.length ? answers.shift() : { switched: true }; }, addEventListener: noop, removeEventListener: noop };
    const doc = { visibilityState: "visible", addEventListener: noop, removeEventListener: noop };
    const fn = new Function("window", "document", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date",
      block + "\nreturn { loadRegime, stop:()=>{ regimeGone = true; } };");
    let now = 1e12; const FakeDate = { now: () => now };
    const api = fn(W, doc, (f, ms) => { timers.push({ f, ms }); return timers.length; }, noop, (f, ms) => { intervals.push({ f, ms }); return 1; }, noop, FakeDate);
    return (async () => {
      await settle(); assert.equal(reads, 1, "read at boot");
      assert.equal(timers.at(-1).ms, 30000, "a failed read retries in 30 s");
      now += 30000; timers.at(-1).f(); await settle(); assert.equal(reads, 2);
      now += 30000; timers.at(-1).f(); await settle(); assert.equal(reads, 3, "third read lands");
      const pending = timers.length; now += 10; api.loadRegime(); await settle(); assert.equal(reads, 3, "focus within a minute: no read");
      now += 60000; api.loadRegime(); await settle(); assert.equal(reads, 4, "focus after a minute: read");
      assert.equal(intervals[0].ms, 5 * 60 * 1000, "a visible tab looks again every 5 minutes");
      now += 5 * 60 * 1000; intervals[0].f(); await settle(); assert.equal(reads, 5);
      assert.equal(timers.length, pending, "no retry after a good read");
    })();
  });
}

/* ════════ P: low-balance notices don't flicker during a hold; they show on Home (F29, A4) ════════ */
{
  const T0 = 1e12, S = "page-1";
  const step = (prev, b, t) => P.turnLowBalanceStep(prev, b, { now: t, session: S });
  await test("P a writing call's hold at 150 / 600 (→ 117) doesn't flash the 20% banner; the settle (→ 142) leaves none", () => {
    P.turnIsAdmin = false;
    let r = step(null, bal("writer", 150), T0); assert.equal(r.level, 0);
    r = step(r.state, bal("writer", 117), T0 + 1000); assert.equal(r.level, 0, "held back during the hold"); assert.ok(r.recheckInMs > 0 && r.recheckInMs <= 150000);
    r = step(r.state, bal("writer", 117), T0 + 5000); assert.equal(r.level, 0, "the same reading re-rendered: still waiting");
    r = step(r.state, bal("writer", 142), T0 + 20000); assert.equal(r.level, 0, "settled above the line: nothing"); assert.equal(r.recheckInMs, 0);
  });
  await test("P a real drop shows once the balance has sat still (no held column); a long hold shows after the wait", () => {
    // round 3 (A7): without the held column a level reached live is confirmed only once the balance
    // has sat still for the settle window — a settle that comes back (a rise) is not proof on its own
    let r = step(null, bal("writer", 150), T0);
    r = step(r.state, bal("writer", 105), T0 + 1000); assert.equal(r.level, 0);
    r = step(r.state, bal("writer", 110), T0 + 9000); assert.equal(r.level, 0, "the settle moved the balance: the wait restarts");
    assert.ok(r.recheckInMs > 149000 && r.recheckInMs <= 150000, String(r.recheckInMs));
    r = step(r.state, bal("writer", 110), T0 + 9000 + 150001); assert.equal(r.level, 20, "still at 110 of 600 after the wait: shown");
    let q = step(null, bal("writer", 150), T0);
    q = step(q.state, bal("writer", 100), T0 + 1000); assert.equal(q.level, 0);
    q = step(q.state, bal("writer", 100), T0 + 1000 + 150001); assert.equal(q.level, 20, "a render that holds for minutes: shown after the wait");
    // 20% already showing, then a hold dips to 5%: the 20% notice stays, the 5% one waits for the balance to sit still
    let w = step(null, bal("writer", 100), T0); assert.equal(w.level, 20, "first reading of a page session: at once");
    w = step(w.state, bal("writer", 25), T0 + 1000); assert.equal(w.level, 20);
    w = step(w.state, bal("writer", 27), T0 + 8000); assert.equal(w.level, 20, "still moving");
    w = step(w.state, bal("writer", 27), T0 + 8000 + 150001); assert.equal(w.level, 5);
    // a rise back to where the balance was before the holds ends the wait at once (every hold came back)
    let v = step(null, bal("writer", 100), T0);
    v = step(v.state, bal("writer", 25), T0 + 1000); assert.equal(v.level, 20);
    v = step(v.state, bal("writer", 100), T0 + 3000); assert.equal(v.level, 20); assert.equal(v.recheckInMs, 0, "nothing left to wait for");
  });
  await test("P (A7) three calls at once on 1,600 (380 → 347 → 314 → 281 → 304 → 327 → 350, no held column) never show the banner — bunched readings (380 → 281 → 281 → 281 → 304 → 327 → 350) neither", () => {
    const runSeq = (seq, gap) => seq.reduce((acc, v, i) => { const r = step(acc.state, bal("director", v), T0 + i * (gap || 2000)); acc.levels.push(r.level); acc.state = r.state; return acc; }, { state: null, levels: [] });
    const run = (seq, gap) => runSeq(seq, gap).levels;
    assert.deepEqual(run([380, 347, 314, 281, 304, 327, 350]), [0, 0, 0, 0, 0, 0, 0]);
    // round 3: overlapping fetches bunch the readings — one fall stands for three holds
    assert.deepEqual(run([380, 281, 281, 281, 304, 327, 350]), [0, 0, 0, 0, 0, 0, 0], "the bunched sequence never flashes");
    assert.deepEqual(run([380, 281, 281, 281, 304, 327, 350], 20000), [0, 0, 0, 0, 0, 0, 0], "nor with slower readings");
    assert.deepEqual(run([380, 347, 314, 281, 304, 304, 327, 350]), [0, 0, 0, 0, 0, 0, 0, 0], "a repeated reading while holds are out doesn't confirm either");
    assert.deepEqual(run([400, 367, 334, 301, 268, 291, 314, 337, 360]), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(run([400, 301, 268, 268, 291, 360]), [0, 0, 0, 0, 0, 0]);
    // three calls that really end at the 20% level: shown once the balance sits still there
    const real = runSeq([360, 327, 294, 261, 280, 299, 318]);
    assert.deepEqual(real.levels, [0, 0, 0, 0, 0, 0, 0], "not while the settles are still coming back");
    assert.equal(step(real.state, bal("director", 318), T0 + 6 * 2000 + 150001).level, 20, "still at 318 after the wait: shown");
    // a single call that ends below the line: shown after the wait, not at the settle
    const one = runSeq([330, 294, 310]);
    assert.deepEqual(one.levels, [0, 0, 0]);
    assert.equal(step(one.state, bal("director", 310), T0 + 2 * 2000 + 150001).level, 20);
    // every reading that moves restarts the wait; it still ends two and a half minutes after the last move
    let r = step(null, bal("director", 330), T0);
    r = step(r.state, bal("director", 300), T0 + 1000); r = step(r.state, bal("director", 290), T0 + 2000);
    assert.equal(r.level, 0);
    r = step(r.state, bal("director", 290), T0 + 1000 + 150001); assert.equal(r.level, 0, "the last move was at +2 s");
    r = step(r.state, bal("director", 290), T0 + 2000 + 150001); assert.equal(r.level, 20);
  });
  await test("P (A7) with turn_credit_balance's held column the level is exact: the same three calls never flash, and a real drop shows at once", () => {
    const seq = [[380, 0], [347, 33], [314, 66], [281, 99], [304, 66], [327, 33], [350, 0]];
    let st = null; const levels = [];
    seq.forEach(([rem, held], i) => { const r = step(st, bal("director", rem, 0, { held }), T0 + i * 2000); st = r.state; levels.push(r.level); });
    assert.deepEqual(levels, [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(P.turnBalanceParts(bal("director", 300, 0, { held: 0 })).heldKnown, true, "0 held is still a report");
    assert.equal(P.turnBalanceParts(bal("director", 300)).heldKnown, false);
    let r = step(null, bal("director", 330, 0, { held: 0 }), T0);
    r = step(r.state, bal("director", 294, 0, { held: 36 }), T0 + 1000); assert.equal(r.level, 0, "330 spendable");
    r = step(r.state, bal("director", 310, 0, { held: 0 }), T0 + 2000); assert.equal(r.level, 20, "settled at 310: shown at once");
    assert.equal(r.recheckInMs, 0, "nothing to wait for");
    const C2 = box({ Date, Math, JSON, Promise }); run(C2, "app/cloud.jsx");
    assert.equal(C2._turnCreditShape({ remaining: 310, plan: "director", plan_remaining: 310, pack_remaining: 0, held: 0 }, "turn_credit_balance").held, 0, "the new last column is read");
    assert.equal(C2._turnCreditShape({ remaining: 310, plan: "director" }, "turn_credit_balance").held, null, "an older database: unknown, not 0");
  });
  await test("P credits the server reports as held count as still spendable", () => {
    assert.equal(P.turnBalanceParts({ remaining: 117, plan: "writer", held: 33 }).held, 33);
    const r = P.turnLowBalanceStep(null, { remaining: 117, plan: "writer", planRemaining: 117, packRemaining: 0, held: 33 }, { now: T0, session: "other" });
    assert.equal(r.level, 0, "117 + 33 held = 25% of 600");
    const C2 = box({ Date, Math, JSON, Promise }); run(C2, "app/cloud.jsx");
    assert.equal(C2._turnCreditShape({ remaining: 117, plan: "writer", held: 33 }, "turn_credit_balance").held, 33);
    assert.equal(C2._turnCreditShape({ remaining: 117, plan: "writer", held: 33 }, "auth metadata").held, null);
  });
  await test("P (A4) a grandfathered Director (7,200): a ~500 refund inside the cycle keeps a dismissed notice dismissed", () => {
    let r = lowStepFresh(null, bal("director", 7200));
    r = lowStepFresh(r.state, bal("director", 1300)); assert.equal(r.level, 20);
    const st = P.turnLowBalanceDismiss(r.state, 20);
    r = lowStepFresh(st, bal("director", 1800)); assert.equal(r.level, 0, "+500 is a refund, not a renewal (30% of 7,200 = 2,160)");
    assert.equal(r.allowance, 7200, "the cycle (and its 7,200 peak) survives the refund");
    assert.equal(r.state.dismissed[20], true, "the dismissal survives the refund");
    r = lowStepFresh(r.state, bal("director", 1400)); assert.equal(r.level, 0, "still dismissed");
    r = lowStepFresh(r.state, bal("director", 350)); assert.equal(r.level, 5, "the 5% notice is judged against 7,200 (350 = 4.9%)");
  });
  await test("P BillingNotices waits for the settle, then re-renders on its own (recheck timer); the notices sit on Home too", () => {
    P.localStorage = mkStore(); P.turnUserId = "u-p"; P.React.reset();
    P.BillingNotices({ balance: bal("writer", 150), now: T0, session: "tab" }); P.React.effects.forEach((f) => f());
    P.React.reset();
    const t1 = P.BillingNotices({ balance: bal("writer", 117), now: T0 + 1000, session: "tab" });
    assert.equal(t1, null, "no banner during the hold");
    const timers = [];
    const realST = P.setTimeout; P.setTimeout = (f, ms) => { timers.push(ms); return 0; };
    try { P.React.effects.forEach((f) => f()); } finally { P.setTimeout = realST; }
    assert.ok(timers.some((ms) => ms > 0 && ms <= 150250), "a re-render is scheduled for the end of the wait: " + timers);
    P.React.reset();
    const t2 = P.BillingNotices({ balance: bal("writer", 117), now: T0 + 1000 + 150001, session: "tab" });
    assert.ok(t2 && findAll(t2, hasClass("billing-banner")).length === 1, "shown after the wait");
    const app = read("app/app.jsx");
    assert.ok(app.includes("noticesSlot: (session && !isAdmin && creditBalance && window.BillingNotices) ? React.createElement(window.BillingNotices,{ balance:creditBalance }) : null"));
    // the Home dashboard renders the slot at the very top of its main column, before its top bar
    const H = box({ usePlansVersion: () => 0, turnHomeWallEligible: () => true });
    H.React.useState = (i) => [typeof i === "function" ? i() : i, noop];
    run(H, "app/home-dashboard.jsx");
    const tree = H.HomeDashboard({ projects: [], currentId: null, room: "writers", onOpen: noop, onCreate: noop, onClose: noop,
      accountSlot: null, noticesSlot: { type: "div", props: { className: "billing-notices-marker" }, children: ["NOTICE"] } });
    const main = findAll(tree, hasClass("hd-main"))[0];
    const kids = main.children.filter((k) => k && typeof k === "object");
    const at = kids.findIndex((k) => hasClass("hd-notices")(k)), bar = kids.findIndex((k) => findAll(k, hasClass("hd-topbar")).length > 0 || hasClass("hd-topbar")(k));
    assert.ok(at >= 0 && textOf(kids[at]) === "NOTICE", "the notices render inside Home");
    assert.ok(bar < 0 || at < bar, "above Home's top bar");
    const css = read("app/styles.css");
    assert.ok(css.includes(".hd-notices{position:relative;z-index:3;flex:none}") && css.includes(".hd-notices .billing-notices{position:static}"));
  });
}

/* ════════ Q: New Story interview voice for free-tier accounts (F19) ════════ */
function voiceBox(balance, proxyAnswer, opts){
  const Q = box({ Date, Math, JSON, Promise });
  Q.TURN_SUPABASE = { url: "u", anonKey: "k", imageProxy: true, imageProxyFn: "image-proxy" };
  Q.calls = []; Q.spoken = []; Q.srStarted = 0;
  Q.sbClient = () => ({ functions: { invoke: async (fn, { body }) => { Q.calls.push(body.op || body.task); return proxyAnswer(body); } } });
  Q.speechSynthesis = { cancel: noop, speak: (u) => { Q.spoken.push(u.text); if (u.onend) u.onend(); } };
  Q.SpeechSynthesisUtterance = class { constructor(t){ this.text = t; } };
  Q.SpeechRecognition = (opts && opts.noSpeechRecognition) ? undefined : class { start(){ Q.srStarted++; } stop(){} };
  Q.MediaRecorder = class {}; Q.navigator = { userAgent: "node", mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } };
  Q.Audio = class { play(){ return Promise.resolve(); } pause(){} };
  run(Q, "app/plans.jsx");
  vm.runInContext(transform(read("app/voicegen.jsx"), "app/voicegen.jsx"), Q, { filename: "app/voicegen.jsx" });
  Q.vgAssertIdentity = noop;
  run(Q, "app/newstory.jsx");
  Q.turnIsPaidPlan = paidFn; Q.turnIsAdmin = false; Q.turnCreditBalance = balance;
  Q.plansOpened = 0; Q.turnOpenPlans = () => { Q.plansOpened++; };
  Q.Voice = vm.runInContext("Voice", Q);
  return Q;
}
const planRequired = () => { const ctx = { status: 402, json: async () => ({ error: "plan_required", code: "plan_required", message: "Voice needs a paid plan. Without a plan, credits cover writing on the default engines and draft images." }) };
  ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
await test("Q a trial account's interview uses the browser's speech: the paid voice is never called and the Plans window never opens", async () => {
  const Q = voiceBox({ remaining: 50, plan: "none", trial: true }, planRequired);
  assert.equal(Q.Voice.paidVoice, false);
  assert.equal(Q.Voice.ttsSupported, true); assert.equal(Q.Voice.sttSupported, true);
  let ended = 0; await Q.Voice.speak("Hi! What's your story about?", () => { ended++; });
  Q.Voice.listen({ onInterim: noop, onFinal: noop, onError: noop });
  await settle();
  assert.deepEqual(Q.calls, [], "no voice call at all");
  assert.equal(Q.plansOpened, 0);
  assert.deepEqual(plain(Q.spoken), ["Hi! What's your story about?"]); assert.equal(ended, 1);
  assert.equal(Q.srStarted, 1, "the browser's speech recognition listens");
});
await test("Q a Writer account keeps the paid voice; a plan_required refusal from an interview call is quiet (no Plans window) and switches to the browser's speech", async () => {
  const Q = voiceBox({ remaining: 500, plan: "writer" }, planRequired);
  assert.equal(Q.Voice.paidVoice, true);
  await Q.Voice.speak("Hello again.");
  await settle();
  assert.ok(Q.calls.length >= 1 && Q.calls.every((c) => c === "listVoices" || c === "tts"), JSON.stringify(Q.calls));
  assert.equal(Q.plansOpened, 0, "quiet: no Plans window");
  assert.deepEqual(plain(Q.spoken), ["Hello again."], "fell back to the browser's voice");
  const n = Q.calls.length;
  await Q.Voice.speak("And again.");
  assert.equal(Q.calls.length, n, "no more paid calls this page session");
  assert.equal(Q.Voice.paidVoice, false);
  // the quiet option only applies to the interview: the character voice tools still open the Plans window
  await assert.rejects(Q.vgProxy("tts", { text: "x" }));
  assert.equal(Q.plansOpened, 1);
});
const insufficientAnswer = () => { const ctx = { status: 402, json: async () => ({ error: "insufficient_credits", code: "insufficient_credits", message: "This generation needs 3 credits, but this account has 1.", creditsRequired: 3 }) };
  ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
await test("Q (A4) a Writer whose voice list loads but whose speech is refused (402 insufficient_credits): no Plans window, the browser's voice speaks, no more paid calls", async () => {
  const Q = voiceBox({ remaining: 1, plan: "writer" }, (body) => body.op === "listVoices" ? { data: { voices: [{ voiceId: "v-1", name: "Narrator" }] } } : insufficientAnswer());
  assert.equal(Q.Voice.paidVoice, true);
  let ended = 0;
  await Q.Voice.speak("Tell me about your hero.", () => { ended++; });
  await settle();
  assert.deepEqual(plain(Q.calls), ["listVoices", "tts"], "the refusal came from the speech call itself");
  assert.equal(Q.plansOpened, 0, "quiet: no Plans window");
  assert.deepEqual(plain(Q.spoken), ["Tell me about your hero."], "the browser's voice read the line");
  assert.equal(ended, 1);
  assert.equal(Q.Voice.paidVoice, false, "browser speech for the rest of the visit");
  await Q.Voice.speak("And the villain?");
  assert.deepEqual(plain(Q.calls), ["listVoices", "tts"], "no more paid calls");
});
await test("Q (A4) a spoken answer whose transcription is refused: onError('switched-to-browser'), no Plans window, and the next listen() uses the browser's speech recognition", async () => {
  const Q = voiceBox({ remaining: 1, plan: "writer" }, (body) => body.op === "listVoices" ? { data: { voices: [] } } : insufficientAnswer());
  const recs = [];
  Q.MediaRecorder = class { constructor(stream, opts){ this.stream = stream; this.mimeType = (opts && opts.mimeType) || "audio/webm"; this.state = "inactive"; recs.push(this); }
    static isTypeSupported(m){ return m === "audio/webm"; }
    start(){ this.state = "recording"; }
    stop(){ this.state = "inactive"; if (this.ondataavailable) this.ondataavailable({ data: new Blob(["voice"], { type: "audio/webm" }) }); if (this.onstop) this.onstop(); } };
  Q.Blob = Blob;
  // the reader answers on a microtask (no timer to race), and the test waits for the refusal itself
  Q.FileReader = class { readAsDataURL(){ this.result = "data:audio/webm;base64,dm9pY2U="; queueMicrotask(() => this.onload && this.onload()); } };
  assert.equal(Q.Voice.paidVoice, true);
  const errs = [], finals = [];
  Q.Voice.listen({ onInterim: noop, onFinal: (t) => finals.push(t), onError: (e) => errs.push(e) });
  await settle();
  assert.equal(recs.length, 1, "recording with the paid transcription");
  assert.equal(Q.srStarted, 0);
  Q.Voice.stopListening();
  await settleUntil(() => errs.length > 0);
  assert.deepEqual(plain(Q.calls), ["stt"], "the recording went to transcription");
  assert.deepEqual(plain(errs), ["switched-to-browser"]);
  assert.deepEqual(plain(finals), []);
  assert.equal(Q.plansOpened, 0, "quiet: no Plans window");
  Q.Voice.listen({ onInterim: noop, onFinal: noop, onError: noop });
  await settle();
  assert.equal(Q.srStarted, 1, "the next answer uses the browser's speech recognition");
  assert.equal(recs.length, 1, "no second paid recording");
  assert.deepEqual(plain(Q.calls), ["stt"]);
});
await test("Q the once-per-account note next to the Voice toggle (Writer and up only), and the brand rules", () => {
  const Q = voiceBox({ remaining: 500, plan: "writer" }, () => ({ data: { audioB64: "AA", mime: "audio/mpeg" } }));
  Q.turnUserId = "u-w"; Q.aiSeedInterview = async () => null;
  Q.React.reset();
  const tree = Q.NSLegacyInterview({ formatLabel: "film", onComplete: noop, onBack: noop });
  const note = findAll(tree, hasClass("ns-voice-cost"))[0];
  assert.ok(note, "shown");
  assert.equal(textOf(note), "Frances’s voice uses a few credits a line here, and so do spoken answers. Turn Voice off, or type, to save them.");
  Q.React.effects.forEach((f) => f());
  assert.equal(Q.localStorage.getItem("turn-interview-voice-note:u-w"), "1");
  Q.React.reset();
  assert.equal(findAll(Q.NSLegacyInterview({ formatLabel: "film", onComplete: noop, onBack: noop }), hasClass("ns-voice-cost")).length, 0, "told once");
  const T = voiceBox({ remaining: 50, plan: "none", trial: true }, planRequired);
  T.turnUserId = "u-t"; T.aiSeedInterview = async () => null; T.React.reset();
  assert.equal(findAll(T.NSLegacyInterview({ formatLabel: "film", onComplete: noop, onBack: noop }), hasClass("ns-voice-cost")).length, 0, "free-tier: browser voice, nothing to say");
  assert.ok(!/\bTURN\b|\bMUSE\b|ElevenLabs|Claude|Anthropic|OpenAI/.test(Q.NS_PAID_VOICE_NOTE));
  assert.ok(["20260930-billing1", "20261002-research1", "20261002-research2", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>read("TURN.html").includes('src="app/newstory.jsx?v='+k+'"')));
});

/* ════════ R: the live voice conversation ends itself after 15 minutes (F7) ════════ */
await test("R a live session closes itself at its time limit with Frances's line; the default is 15 minutes; New Story offers 'Start another conversation'", async () => {
  const seen = { sent: [], statuses: [], limits: [] };
  const track = { enabled: true, stop(){} };
  class Channel { constructor(){ this.readyState = "open"; this.l = {}; } addEventListener(t, f){ (this.l[t] ||= []).push(f); }
    send(x){ seen.sent.push(JSON.parse(x)); } close(){ this.readyState = "closed"; } emit(t, ev){ (this.l[t] || []).forEach((f) => f(ev)); } }
  class Peer { constructor(){ this.iceGatheringState = "complete"; this.l = {}; } addEventListener(t, f){ (this.l[t] ||= []).push(f); } removeEventListener(){}
    addTrack(){} createDataChannel(){ this.channel = new Channel(); seen.ch = this.channel; return this.channel; }
    async createOffer(){ return { type: "offer", sdp: "v=0\r\n" }; } async setLocalDescription(d){ this.localDescription = d; }
    async setRemoteDescription(){ setTimeout(() => this.channel.emit("message", { data: JSON.stringify({ type: "session.started", session: { id: "s1" } }) }), 0); }
    close(){} }
  const L = { console, setTimeout, clearTimeout, location: { protocol: "https:", hostname: "kinolot.example" },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    RTCPeerConnection: Peer, MediaStream: class {}, Audio: class { play(){ return Promise.resolve(); } pause(){} }, TURN_SUPABASE: { imageProxy: true },
    sbClient: () => ({ functions: { invoke: async () => ({ data: { transport: { sdp: "answer" }, session: { id: "s1" } } }) } }) };
  L.window = L; L.globalThis = L; vm.createContext(L);
  vm.runInContext(read("app/livevoice.js"), L, { filename: "app/livevoice.js" });
  assert.equal(L.TURN_LIVE_SESSION_MAX_MS, 15 * 60 * 1000);
  const session = await L.turnStartLiveVoice({ mode: "new-story", maxSessionMs: 40,
    onStatus: (x) => seen.statuses.push(x), onTimeLimit: (m) => seen.limits.push(m) });
  assert.ok(session && typeof session.close === "function");
  await new Promise((r) => setTimeout(r, 90));
  assert.deepEqual(seen.limits, ["That’s 15 minutes — this conversation with Frances has ended. Your transcript is still here: finish to shape it into loglines, or start another conversation (it counts as another question). A new conversation starts fresh — Frances won’t hear what was said here — but your loglines use both."]);
  assert.ok(seen.sent.some((m) => m.type === "session.close"), "the session is closed");
  assert.ok(seen.statuses.includes("closing"));
  const story = read("app/newstory.jsx");
  assert.ok(story.includes('onTimeLimit:message=>{ if(alive){ sessionRef.current=null; setTimeUp(String(message||"This conversation with Frances has ended.")); } },'));
  assert.ok(story.includes('timeUp && React.createElement("button",{className:"ns-btn ghost",disabled:finalizing,onClick:another},"Start another conversation")'));
  assert.ok(["20260930-billing1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>read("TURN.html").includes('src="app/livevoice.js?v='+k+'"')));
});

await test("R (A5) 'Start another conversation': each fragment carries its conversation; the new session's first line starts a new row (never glued into the last bubble) under a 'New conversation' divider", () => {
  const Q = voiceBox({ remaining: 500, plan: "writer" }, () => ({ data: {} }));
  const frags = [
    { role: "assistant", delta: "What's it about?", startMs: 100, endMs: 900, attempt: 0 },
    { role: "user", delta: "A lighthouse keeper.", startMs: 1200, endMs: 2000, attempt: 0 },
    { role: "assistant", delta: "Tell me more.", startMs: 899000, endMs: 899900, attempt: 0 },
    // the new session's clock restarts at 0 (a negative gap used to read as "close enough")
    { role: "assistant", delta: " Hi again! What's your story about?", startMs: 200, endMs: 1500, attempt: 1 },
    { role: "assistant", delta: " Take your time.", startMs: 1600, endMs: 2000, attempt: 1 },
  ];
  assert.deepEqual(plain(Q.nsLiveRows(frags).map((r) => [r.role, r.content.trim(), r.attempt])),
    [["assistant", "What's it about?", 0], ["user", "A lighthouse keeper.", 0], ["assistant", "Tell me more.", 0], ["assistant", "Hi again! What's your story about? Take your time.", 1]]);
  // untagged fragments (one conversation) still merge exactly as before
  assert.equal(Q.nsLiveRows([{ role: "user", delta: "A ", startMs: 10, endMs: 20 }, { role: "user", delta: "keeper.", startMs: 30, endMs: 40 }]).length, 1);
  assert.ok(read("app/newstory.jsx").includes("onTranscript:fragment=>{ if(alive) setFragments(prev=>[...prev,{ ...fragment, attempt }]); },"), "the live session tags what it hears with its conversation");
  // the thread shows where the new conversation begins
  Q.React.reset({ 0: frags, 1: "listening", 6: 1 });
  const tree = Q.NSLiveInterview({ formatLabel: "film", onComplete: noop, onBack: noop, onUseFallback: noop });
  const thread = findAll(tree, hasClass("ns-talk-thread"))[0];
  const flat = []; walk(thread, (n) => { if (hasClass("ns-live-newconv")(n) || hasClass("ns-talk-bubble")(n)) flat.push(hasClass("ns-live-newconv")(n) ? "|divider|" : textOf(n)); });
  assert.deepEqual(flat, ["What's it about?", "A lighthouse keeper.", "Tell me more.", "|divider|", "Hi again! What's your story about? Take your time."]);
  assert.ok(read("app/styles.css").includes(".ns-live-newconv{"));
  const feat = read("app/ai.jsx");
  assert.ok(feat.includes("The new conversation starts fresh: Frances greets the writer again and doesn't know what was said in the earlier one"), "Frances can explain it");
});

/* ════════ S: a free-tier account writes on the lightest default engine (F20) ════════ */
await test("S 'Auto' is Gemini 3.8 Flash for a trial / no-plan account, Opus 5.5 for a plan; a manual pick still wins; pickers hear about the change", () => {
  const A = box({ Date, Math, JSON, Promise });
  vm.runInContext(read("app/ai.jsx"), A, { filename: "app/ai.jsx" });
  run(A, "app/plans.jsx");
  A.turnIsPaidPlan = paidFn; A.turnIsAdmin = false;
  A.turnCreditBalance = null;
  assert.equal(A.recommendedWritingModelId("story"), "claude-opus-5-5", "no ledger yet: the owner's default");
  A.turnNoteWritingDefault();
  A.turnCreditBalance = { remaining: 50, plan: "none", trial: true };
  A.events.length = 0; A.turnNoteWritingDefault();
  assert.ok(A.events.some((e) => e.type === "turn-writing-model-changed"), "pickers on Auto follow");
  for (const task of ["story", "specs"]) assert.equal(A.recommendedWritingModelId(task), "gemini-3.8-flash");
  assert.equal(A.getWritingModelId("story"), "gemini-3.8-flash");
  assert.deepEqual({ ...A.writingModelInfo("story") }, { label: "Gemini 3.8 Flash", id: "gemini-3.8-flash", auto: true });
  assert.ok(A.TURN_TRIAL_TEXT_MODELS.includes("gemini-3.8-flash") && A.turnTextModelAllowed("claude-opus-5-5"), "Opus 5.5 stays selectable");
  A.setWritingModelId("claude-opus-5-5");
  assert.equal(A.getWritingModelId("story"), "claude-opus-5-5", "a manual pick wins");
  A.setWritingModelId(null);
  A.turnCreditBalance = { remaining: 600, plan: "writer" };
  assert.equal(A.recommendedWritingModelId("story"), "claude-opus-5-5");
  A.turnIsAdmin = true; A.turnCreditBalance = { remaining: 0, plan: "none" };
  assert.equal(A.recommendedWritingModelId("story"), "claude-opus-5-5", "admin: never free tier");
  assert.ok(read("app/app.jsx").includes('if(typeof window.turnNoteWritingDefault==="function"){ try{ window.turnNoteWritingDefault(); }catch(e){} }'));
});
await test("S the trial copy promises only what 50 credits buy (server prices): about a logline, synopsis, spine and first scenes on the lighter engine", async () => {
  const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  const at = Date.parse("2026-11-01T12:00:00Z");
  // the build's calls (docs/Story Pipeline.md steps 0-3), real first-prompt sizes measured 2026-09-30 from
  // app/ai.jsx (characters), assumed visible output tokens; Opus thinks (+60%), Gemini at "low" (+15%)
  const plan = [["loglines", 1, 1516, 1200], ["synopsis", 1, 1810, 3500], ["spine half", 2, 5258, 5000], ["story world", 1, 8158, 3500],
    ["cast psychology", 1, 7429, 6000], ["beats", 16, 5611, 1800], ["screenplay", 16, 15741, 2400], ["psychology check", 1, 57200, 2500], ["continuity ledger", 1, 55200, 2500]];
  const run = (model, think) => { const steps = []; for (const [label, n, chars, out] of plan) {
    const c = srv.textActualCost(model, { inputTokens: Math.ceil(chars / 4), outputTokens: Math.ceil(out * think) }, { nowMs: at, unit: 0.01 }).credits;
    for (let i = 0; i < n; i++) steps.push([label, c]); } return steps; };
  const total = (st) => st.reduce((t, [, c]) => t + c, 0);
  const g = run("gemini-3.8-flash", 1.15), o = run("claude-opus-5-5", 1.6);
  assert.ok(total(g) >= 55 && total(g) <= 90, "Short Film on Gemini 3.8 Flash ≈ 70: " + total(g));
  assert.ok(total(o) >= 330 && total(o) <= 430, "Short Film on Opus 5.5 ≈ 380: " + total(o));
  // interleave beats + screenplay per scene, as the build does; what do 50 credits reach?
  const order = (st) => { const head = st.filter(([l]) => !["beats", "screenplay", "psychology check", "continuity ledger"].includes(l));
    const b = st.filter(([l]) => l === "beats"), sp = st.filter(([l]) => l === "screenplay"); const out = head.slice();
    for (let i = 0; i < b.length; i++) out.push(b[i], sp[i]); return out; };
  let left = 50, scenes = 0, spine = false;
  for (const [l, c] of order(g)) { if (c > left) break; left -= c; if (l === "spine half") spine = true; if (l === "screenplay") scenes++; }
  assert.ok(spine && scenes >= 5 && scenes < 16, "50 credits on the lighter engine: the spine and its first scenes, not the whole film (" + scenes + " scenes)");
  // Opus 5.5: each call HOLDS its 16k-token output room first
  const hold = (chars) => srv.textHoldEstimate({ model: "claude-opus-5-5", messages: [{ role: "user", content: "x".repeat(chars) }], outputCap: 16000, unit: 0.01, nowMs: at }).credits;
  let bal50 = 50; const got = [];
  for (const [l, c, chars] of [["loglines", o[0][1], 1516], ["synopsis", o[1][1], 1810], ["spine half", o[2][1], 5258], ["spine half", o[3][1], 5258 + 12000]]) { if (hold(chars) > bal50) break; bal50 -= c; got.push(l); }
  assert.ok(got.includes("synopsis") && got.filter((l) => l === "spine half").length < 2, "on Opus 5.5 the trial runs out before the spine is finished: " + got);
  assert.ok(srv.textHoldEstimate({ model: "gemini-3.8-flash", messages: [{ role: "user", content: "x".repeat(15741) }], outputCap: 16000, unit: 0.01, nowMs: at }).credits <= 8, "a lighter-engine call holds ≤ 8");
  // the copy and the manifest say exactly that — and no longer promise a whole story
  assert.match(P.TURN_TRIAL_COPY, /a logline, a synopsis, the spine and its first scenes/);
  const ai = read("app/ai.jsx");
  assert.ok(!ai.includes("With trial or pack credits you can create and write a story in the Writers' Room; the Art Room"), "the old promise is gone");
  assert.ok(ai.includes("There, 50 credits cover about a logline, a synopsis, the spine and its first scenes — a whole Short Film build (16 scenes) costs about 70 credits on it. On Opus 5.5 the same build costs about 380 credits and every call first reserves about 35, so 50 credits run out before the spine is finished."));
});

/* ════════ T: the Stage quote includes reference-video seconds (F22, A14) ════════ */
await test("T stageRenderCost adds the reference-video seconds at the video-input rate — equal to the server's charge for Seedance 2.5 and 2.0; Kling ignores them", async () => {
  const srv = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  const src = read("app/stage.jsx");
  const pick = (name) => { const a = src.indexOf("function " + name + "("); return src.slice(a, src.indexOf("\n}\n", a) + 3); };
  const Z = box({ CREDIT_SCALE: 10 }); run(Z, "app/pricing.jsx");
  vm.runInContext(pick("stageRenderCost") + pick("stageVideoInputMul"), Z);
  const tier = (model, t) => ({ creditRate: Z.turnVideoCreditRates(model, t) });
  for (const [model, ep] of [["seedance-2.5", "bytedance/seedance-2.5/reference-to-video"], ["seedance-2.0", "bytedance/seedance-2.0/reference-to-video"]])
    for (const res of ["480p", "720p"]) for (const out of [5, 10, 15]) for (const inSec of [0, 4.2, 10, 15]) {
      const mine = Z.stageRenderCost(tier(model, "standard"), res, out, { videoSec: inSec, inputMul: Z.stageVideoInputMul(model) });
      const theirs = srv.videoCost({ endpoint: ep, resolution: res, outputSeconds: out, inputVideoSeconds: inSec }).credits;
      assert.equal(mine, theirs, [model, res, out, inSec].join(" "));
    }
  assert.equal(Z.stageRenderCost(tier("seedance-2.5", "standard"), "720p", 10, { videoSec: 15, inputMul: 0.6 }), 710, "the review's case: 710, not 473");
  // a measured length (10.04 s) is read in tenths, rounded up, exactly as the server's length-billed hold reads the file
  for (const secs of [10.04, 7.51, 4.96])
    assert.equal(Z.stageRenderCost(tier("seedance-2.5", "standard"), "720p", 10, { videoSec: secs, inputMul: 0.6 }),
      srv.lengthBilledVideoHold({ endpoint: "bytedance/seedance-2.5/reference-to-video", resolution: "720p", kind: "refs", outputSeconds: 10, fixedOutput: true, maxOutputSeconds: 15, maxInputSeconds: 30.2, inputs: [secs] }).cost.credits, String(secs));
  assert.equal(Z.stageVideoInputMul("kling-3.0"), 0);
  assert.equal(Z.stageRenderCost(tier("kling-3.0", "standard"), "720p", 10, { videoSec: 15, inputMul: Z.stageVideoInputMul("kling-3.0") }),
    srv.videoCost({ endpoint: "fal-ai/kling-video/v3/standard/image-to-video", resolution: "720p", outputSeconds: 10, inputVideoSeconds: 15 }).credits);
  // A14: a product a float-hair above a whole number (15 s × 6.82 × 10 = 1023.0000000000001) quotes what the server charges
  assert.ok(15 * 6.82 * 10 > 1023, "the edge case exists");
  assert.equal(Z.stageRenderCost({ creditRate: { "1080p": 6.82 } }, "1080p", 15), 1023);
  assert.equal(Z.stageRenderCost({ creditRate: { "1080p": 6.82 } }, "1080p", 15), srv.videoCost({ endpoint: "bytedance/seedance-2.0/reference-to-video", resolution: "1080p", outputSeconds: 15 }).credits);
  // wiring: the main render's quote, label and tooltip carry the reference seconds; text-only sends none
  assert.ok(src.includes("const renderCost = stageRenderCost(tierObj, resolution, duration, { videoSec:refVideoSec, inputMul:refVideoMul });"));
  assert.ok(src.includes("const quoteCost = referenceFree ? textOnlyCost : renderCost;") && src.includes('quote:{ cost:quoteCost, reason:"stage-video-render" },'));
  assert.ok(src.includes('const secs = a && a.key==="prev" ? (prevVideoSecs || prevVideoMetaSecs) : (Number(a && a.seconds)>0 ? Number(a.seconds) : 0);'));
  assert.ok(src.includes('+(refVideoSec>0 ? " × "+refVideoMul+" (video-input rate)" : "")'));
  assert.ok(src.includes('"Retry from text only · "+textOnlyTotal.toLocaleString("en-US")'));
});

/* ════════ U: writing-path refusals and the build stop (F23) ════════ */
{
  function writingBox(status, body){
    const W = box({ Date, Math, JSON, Promise });
    W.TURN_SUPABASE = { url: "u", anonKey: "k", imageProxy: true, imageProxyFn: "image-proxy" };
    W.sbClient = () => ({ functions: { invoke: async () => { const ctx = { status, json: async () => body }; ctx.clone = () => ctx;
      return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; } } });
    vm.runInContext(read("app/ai.jsx"), W, { filename: "app/ai.jsx" });   // installs the proxy-backed window.claude.complete
    run(W, "app/plans.jsx");
    W.turnIsPaidPlan = paidFn; W.turnIsAdmin = false;
    W.plansOpened = 0; W.turnOpenPlans = () => { W.plansOpened++; };
    W.appToast = (m, k) => W.toasts.push({ m, k });
    return W;
  }
  const ag = read("app/agents.jsx");
  const agBody = (name) => { const a = ag.indexOf("function " + name + "("); return ag.slice(a, ag.indexOf("\n}\n", a) + 3); };
  const cases = [
    [402, { error: "insufficient_credits", code: "insufficient_credits", message: "This generation needs 36 credits, but this account has 34.", creditsRequired: 36 },
      "This generation needs 36 credits, but this account has 34.", true, "credits", "your account has no plan credits left for writing"],
    [403, { error: "account_frozen", code: "account_frozen", message: "Your account is on hold while a payment is disputed, so spending credits is paused." },
      "Your account is on hold while a payment is disputed, so spending credits is paused.", false, "frozen", "your account is on hold while a payment is disputed"],
    [503, { error: "billing_unavailable", code: "billing_unavailable", message: "Credits can't be checked right now. Please try again in a minute." },
      "Credits can't be checked right now. Please try again in a minute.", false, "unavailable", "your credits couldn’t be checked just then"],
    [402, { error: "no_plan", code: "no_plan", message: "Choose a plan to start creating — every generation runs on your plan's credits." },
      "Choose a plan to start creating — every generation runs on your plan's credits.", true, "credits", "your account has no plan credits left for writing"],
    // round 2 (A2): the server's writing SHORTFALL (billing-policy.mjs writingShortfall) stops a build too
    [402, { error: "insufficient_credits", code: "insufficient_credits", message: "This writing engine needs at least 36 credits for one answer, but this account has 34 (2 short). Choose a lighter writing engine, or add credits.", creditsRequired: 36, creditsRemaining: 34, creditsShort: 2, suggest: "lighter_writing_engine" },
      "This writing engine needs at least 36 credits for one answer, but this account has 34 (2 short). Choose a lighter writing engine, or add credits.", true, "engine", "this writing engine needs more credits for one answer than your account has"],
    // round 3 (A6): a paid account with NOTHING left can't run any engine — the add-credits advice, never "a lighter engine"
    // (an older server still words it as a shortfall; the new one sends its plain insufficient-credits refusal)
    [402, { error: "insufficient_credits", code: "insufficient_credits", message: "This writing engine needs at least 36 credits for one answer, but this account has 0 (36 short). Choose a lighter writing engine, or add credits.", creditsRequired: 36, creditsRemaining: 0, creditsShort: 36, suggest: "lighter_writing_engine" },
      "This writing engine needs at least 36 credits for one answer, but this account has 0 (36 short). Choose a lighter writing engine, or add credits.", true, "credits", "your account has no plan credits left for writing"],
    [402, { error: "insufficient_credits", code: "insufficient_credits", message: "This generation needs 7 credits, but this account has 3.", creditsRequired: 7, creditsRemaining: 3 },
      "This generation needs 7 credits, but this account has 3.", true, "credits", "your account has no plan credits left for writing"],
  ];
  for (const [status, body, msg, opens, billing, reason] of cases) {
    await test("U writing refusal " + status + " " + body.error + ": the server's sentence, " + (opens ? "the Plans window" : "no Plans window") + ", and a story build stops at it", async () => {
      const W = writingBox(status, body);
      let err = null;
      try { await W.claude.complete({ messages: [{ role: "user", content: "Write the scene." }] }); } catch (e) { err = e; }
      assert.ok(err, "refused");
      assert.equal(err.message, msg, "exact sentence (never the 'Couldn't reach the writing model' transport text)");
      assert.equal(W.plansOpened, opens ? 1 : 0);
      assert.ok(W.toasts.some((t) => t.m === msg && t.k === "error"));
      assert.ok(W.events.some((e) => e.type === "turn-credits-changed"), "balance refresh asked");
      const f = W.screenplayFailureFromError(err, "draft");
      assert.equal(f.kind, "plan", "a failure retrying can't fix");
      assert.equal(f.billing, billing);
      assert.equal(W.screenplayFailureReason(f), reason);
      const G = { window: {} }; G.window = G; vm.createContext(G);
      vm.runInContext(agBody("failureNeedsAction"), G);
      assert.equal(vm.runInContext("failureNeedsAction", G)(f), true, "the build / Auto-draft all stops at the first one");
    });
  }
  await test("U the build-stop pattern covers every server refusal sentence and every app fallback, and nothing else", async () => {
    const pol = await import(new URL("supabase/functions/image-proxy/billing-policy.mjs", ROOT));
    const W = writingBox(402, {});
    for (const r of [pol.planRequired("Writing"), pol.tierRequired("This engine", "writer"), pol.frozenRefusal(), pol.insufficientRefusal(30, 4), pol.noPlanRefusal(), pol.billingUnavailable(),
      pol.writingShortfall({ plan: "none" }, 36, 34), pol.writingShortfall({ plan: "writer" }, 36, 34), pol.writingShortfall({ plan: "none" }, 36, 0), pol.writingShortfall({ plan: "director" }, 1, 0),
      // round 3: the server writes thousands with commas ("needs 1,709 credits")
      pol.insufficientRefusal(1709, 300), pol.writingShortfall({ plan: "studio" }, 2400, 1234)])
      assert.equal(W.screenplayFailureFromError(new Error(r.body.message)).kind, "plan", r.body.message);
    assert.equal(W.screenplayFailureFromError(new Error("This generation needs 1,709 credits, but this account has 300.")).kind, "plan", "commas in the plain refusal");
    assert.equal(W.screenplayFailureFromError(new Error("This generation needs 1,709 credits, but this account has 300.")).billing, "credits");
    // the shortfall's advice points at a lighter engine — in the scene-level advice, the batch reasons and the build stop
    for (const acct of [{ plan: "none" }, { plan: "writer" }]) {
      const f = W.screenplayFailureFromError(new Error(pol.writingShortfall(acct, 36, 34).body.message), "draft");
      assert.equal(f.billing, "engine", JSON.stringify(acct));
      assert.equal(W.screenplayFailureAdvice(f, "draft again"), "Choose a lighter writing engine (or add credits), then draft again.");
    }
    assert.equal(W.screenplayFailureFromError(new Error(pol.writingShortfall({ plan: "none" }, 36, 0).body.message)).billing, "credits", "an empty no-plan account still reads 'choose a plan'");
    // round 3 (A6): 'engine' only when the sentence reports a POSITIVE balance a lighter engine could use
    for (const acct of [{ plan: "director" }, { plan: "writer" }, { plan: "studio" }]) {
      const f0 = W.screenplayFailureFromError(new Error(pol.writingShortfall(acct, 36, 0).body.message), "draft");
      assert.equal(f0.kind, "plan"); assert.equal(f0.billing, "credits", "a paid account with 0: " + JSON.stringify(acct));
      assert.equal(W.screenplayFailureAdvice(f0, "draft again"), "Choose a plan or add credits, then draft again.");
    }
    // whatever the server sends, the class follows the sentence: a lighter engine only with a positive balance
    for (const [acct, need, have] of [[{ plan: "writer" }, 36, 34], [{ plan: "director" }, 36, 3], [{ plan: "director" }, 36, 0], [{ plan: "none" }, 36, 20], [{ plan: "studio" }, 1, 0]]) {
      const m = pol.writingShortfall(acct, need, have).body.message;
      const has = /this account has (\d[\d,]*)/i.exec(m);
      const want = /lighter writing engine/i.test(m) && has && Number(has[1].replace(/,/g, "")) > 0 ? "engine" : "credits";
      assert.equal(W.screenplayFailureFromError(new Error(m)).billing, want, m);
    }
    assert.equal(W.screenplayFailureFromError(new Error("This writing engine needs at least 2,400 credits for one answer, but this account has 1,234 (1,166 short). Choose a lighter writing engine, or add credits.")).billing, "engine", "thousands commas");
    assert.equal(W.screenplayFailureFromError(new Error("This writing engine needs at least 36 credits for one answer, but this account has 3 (33 short). Add credits or upgrade your plan.")).billing, "credits", "no lighter-engine advice: add credits");
    assert.ok(agBody("failureNeedsAction").length > 0 && ag.includes('fl.billing==="engine" ? "Choose a lighter writing engine (or add credits)"'), "the story build's stop line says so");
    assert.ok(ag.includes('f.kind==="plan" && f.billing==="engine"'), "the redraft stand-in line says so");
    for (const m of Object.values(plain(Object.fromEntries(["no_plan", "insufficient_credits", "account_frozen", "plan_required", "tier_required", "billing_unavailable"].map((c) => [c, W.turnBillingError({ code: c }, 402).message])))))
      assert.equal(W.screenplayFailureFromError(new Error(m)).kind, "plan", m);
    assert.notEqual(W.screenplayFailureFromError(new Error("The studio's engine is briefly unavailable — please try again in a moment. (ref CM-14)")).kind, "plan");
    assert.equal(W.screenplayFailureFromError(new Error("Your account is on hold while a payment is disputed.")).billing, "frozen");
    const adv = W.screenplayFailureAdvice({ kind: "plan", billing: "unavailable" }, "draft again");
    assert.equal(adv, "Draft again in a minute.");
  });
}

/* ════════ V: the Plans window per account kind; the sign-up intent runs once (F25: A2, A3, A8) ════════ */
await test("V (A2) a paying subscriber's Plans window has no 'Without a plan…' pack line and no trial line", () => {
  for (const plan of ["writer", "director", "studio"]) {
    const m = renderPlans({ balance: { remaining: 900, plan } });
    assert.equal(textOf(findAll(m, hasClass("credit-packs-sub"))[0]), P.TURN_PLANS_COPY.packsSub, plan);
    assert.equal(findAll(m, hasClass("plans-trial")).length, 0, plan);
  }
});
await test("V (A3) the signed-out trial marketing line never shows to a signed-in account (no plan, trial or paying)", () => {
  for (const balance of [{ remaining: 0, plan: "none" }, { remaining: 30, plan: "none", trial: true }, { remaining: 900, plan: "writer" }]) {
    const m = renderPlans({ balance });
    const lines = findAll(m, hasClass("plans-trial")).map(textOf);
    assert.ok(!lines.includes(P.TURN_TRIAL_COPY), JSON.stringify(balance));
  }
  assert.ok(findAll(renderPlans({ uid: null }), hasClass("plans-trial")).map(textOf).includes(P.TURN_TRIAL_COPY), "signed out: shown");
});
await test("V (A8) app.jsx's sign-up intent effect opens checkout ONCE per sign-in, even while the account's saved choice is still on the session", () => {
  const src = read("app/app.jsx");
  const a = src.indexOf("const [intentWaitOver, setIntentWaitOver] = React.useState(false);");
  const b = src.indexOf("},[session, intendedPlan, creditBalance, intentWaitOver]);", a) + "},[session, intendedPlan, creditBalance, intentWaitOver]);".length;
  assert.ok(a > 0 && b > a);
  const body = src.slice(a, b);
  const refs = {}; let refN = 0;
  const R = { useState: (v) => [v, noop], useRef: (v) => { const k = refN++; return refs[k] || (refs[k] = { current: v }); }, useEffect: (f) => { f(); } };
  const checkouts = []; const store = mkStore();
  store.setItem("turn-intended-plan", "director"); store.setItem("turn-intended-plan-at", String(Date.now()));
  const W = { turnPickIntendedPlan: P.turnPickIntendedPlan, CINEMA_PLANS: P.CINEMA_PLANS, turnIsAdmin: false,
    cloudAccountIntendedPlan: () => ({ plan: "director", at: Date.now() - 1000 }), cloudClearAccountIntendedPlan: () => true,
    turnStartCheckout: (p, o) => checkouts.push([p.tier, o && o.sameTab]) };
  const render = new Function("React", "window", "localStorage", "setTimeout", "clearTimeout", "session", "intendedPlan", "setIntendedPlan", "creditBalance",
    body + "\nreturn intentDoneRef;");
  const session = { user: { id: "u-a8", user_metadata: { intended_plan: "director" } } };
  const tick = (bal) => { refN = 0; return render(R, W, store, (f) => f(), noop, session, null, noop, bal); };
  tick({ remaining: 0, plan: "none" });
  assert.deepEqual(checkouts, [["director", true]], "checkout opened once, in this tab");
  assert.equal(store.getItem("turn-intended-plan"), null, "the browser copy is consumed");
  tick({ remaining: 0, plan: "none" }); tick({ remaining: 50, plan: "none", trial: true });
  assert.equal(checkouts.length, 1, "later renders (the account's copy still on the session) never open a second checkout");
});

/* ════════ W: one number format (F28); the manifest's stale billing sentences (F26) ════════ */
await test("W (F28) the account menu writes the total and its split: '1,234 left' over '1,000 plan + 234 pack' (quiet list, 2026-10-22)", () => {
  const ab = box({ cloudConfigured: () => true, cloudUserEmail: () => "ana@example.com", turnIsPaidPlan: paidFn, turnOpenPlans: noop, CREDIT_SCALE: 10,
    turnCreditBalance: { remaining: 1234, plan: "director", planRemaining: 1000, packRemaining: 234, nextPackExpiry: null },
    turnTextSpend: () => ({ calls: 0, credits: 0, since: null }) });
  run(ab, "app/plans.jsx"); run(ab, "app/team.jsx"); run(ab, "app/auth-ui.jsx");
  ab.React.reset({ 0: true });
  const chip = ab.AccountChip({ session: {}, cloudActive: true, saveState: "saved", onSignIn: noop, onSignOut: noop });
  const credits = findAll(chip, hasClass("acct-credits"))[0];
  assert.equal(textOf(findAll(credits, hasClass("acct-credits-row"))[0]), "Credits1,234 left", "above the plan's allowance: the total, no bar");
  assert.equal(textOf(findAll(credits, hasClass("acct-credits-split"))[0]), "1,000 plan + 234 pack");
  assert.equal(textOf(findAll(chip, hasClass("acct-sub"))[0]), "Director · Synced");
});
await test("W (F26) APP_FEATURES no longer describes the retired browser spend queue, a 1-credit prop image or a 13-credit render", () => {
  const ai = read("app/ai.jsx");
  assert.ok(!ai.includes("CREDIT SPENDS CAN'T BE LOST") && !ai.includes("the amount queues on-device and retries"));
  assert.ok(!ai.includes("Generate/Regenerate (1 image credit"));
  assert.ok(!ai.includes('13 credits — 13s × 720p × Standard'));
  assert.ok(ai.includes("RENDER CREDITS ARE HANDLED ON THE SERVER: the browser records no spend — the server holds a render's credits when it is submitted"));
  assert.ok(ai.includes("its cost is on the button's chip — about 7 credits for a 2K image on Nano Banana 2.1, the default engine"));
  assert.ok(ai.includes('e.g. \\"304 credits — 10s × 720p × Standard\\"'));
  // the numbers in them are the app's own
  assert.equal(R.turnCreditCost(0.12), 12, "Nano Banana 2 at 2K");
  assert.equal(Math.max(1, Math.ceil(10 * R.turnVideoCreditRate("seedance-2.0", "standard", "720p") * R.CREDIT_SCALE - 1e-9)), 304);
});

await test("W (A8) APP_FEATURES states the round-2 and round-3 billing facts accurately and names no vendor in them", async () => {
  const A = box({ Date, Math, JSON, Promise });
  vm.runInContext(read("app/ai.jsx"), A, { filename: "app/ai.jsx" });
  const feats = vm.runInContext("APP_FEATURES", A);
  const whole = feats.map((f) => String(f.what || "")).join("\n");
  const facts = [
    // database round 1: prorated upgrades, plan credits after a plan ends, refunds and running jobs
    "adds the difference between the two monthly allowances for the part of the billing period still to run",
    "Until the credit switch day, a plan's remaining credits stay usable after the plan ends; from the switch day, a plan's unused monthly credits end with it. Pack credits always keep their 12-month expiry",
    "a full refund removes the unspent credits of that purchase, including credits held by a job still running",
    // server rounds 1-2: length pricing, the Stage's question, collection, refunds, 3D cancel, voice models, the writing shortfall
    "renders with reference videos, Motion Control and video editing are priced from the length of the video itself, which the server reads",
    "the price check includes the reference seconds",
    "the render is priced at the longest length allowed and the Stage asks first — 'Render at N credits?', with the reason",
    "a finished render whose video can't be collected yet keeps its credits held and is checked again",
    "a render is charged only if it finishes: a failed or cancelled one (or one still waiting in the queue after 6 hours, which is cancelled) gives the credits back, even if the tab was closed",
    "A 3D model (image-to-3D asset) can be cancelled only while it is still waiting in line",
    "Only the server's listed voice delivery models are accepted",
    "A writing request that can't afford a heavy writing engine says how many credits it's short and suggests a lighter engine when what's left can still pay for one; with nothing left (or too little for any engine) it asks to add credits instead.",
    // this round's app changes
    "every submitted render is tracked per film for 7 days",
    "If the server can't start a submitted render, it says the credits were returned.",
    "credits held by running jobs still count toward what's left, so a level shows only once the balance really sits there",
    "closing a payment-failed or on-hold banner hides it on Home and in the studio alike until the page is reloaded",
    // round 3 (A1-A7)
    "Generate is disabled when the known balance is below what the render needs — its cost, or for Motion Control and Edit Video the credits it holds — and the button says why.",
    // round 4 (A4): the hold is the chosen video's length plus the owner's margin, the maximum only when the server can't read it
    "the server holds these renders at the length it reads from the chosen video (the motion video, or the video to edit) times 1.1 plus 1 second, rounded up to a tenth of a second and never more than the longest length allowed (Motion Control 30 seconds, or 10 when the scene follows the character image; an edit 30 seconds of output plus 30.2 of input).",
    // round 5 (shared decision 1): the server works from its own copy, so the film's storage is held by length too
    "It holds by length a video kept in the film's storage, a video uploaded from your device, a take on the video service's own media storage or a video sent inline, because the server works from a file that can't change before the render uses it: its own copy of a stored, uploaded or inline video (made when the render starts; the copy is what it reads, sends and bills), or the video service's own file, which it reads in place; a video kept anywhere else, or one whose length it can't read (a file it can't parse, one split into fragments or compressed, or a slow read), is held at the longest length allowed.",
    "It charges only the finished video's length, never more than it held, and gives the rest back.",
    // round 4 (A3): the button's number is the expected charge; only its tooltip (and the footer) name the hold
    "Their Generate button shows the expected charge for the chosen video (M); its tooltip and the credit footer name the hold, 'Holds up to N credits; charged for the finished video's length', followed by the expected charge (about M for this video).",
    "Its reason is one plain sentence: the video is stored somewhere the server doesn't read from (uploading it from your device or library avoids this), it isn't an MP4 or MOV file, reading its length timed out, or its length couldn't be read.",
    "The Stage footer shows the remaining balance and what it will be after the render, or, on the Motion Control and Edit Video tabs, what the render holds while it runs.",
    "a brief hiccup while the video service reports a render's status shows 'reconnecting' instead of ending the render",
    "that message says instead that the render can't be recovered automatically: keep the film open until it lands",
    "leaves a render another account started in this browser for that account (a render the server no longer has for this account is taken off the list with a notice — it isn't reported as a failure)",
    "with an older server that doesn't report held credits, once the balance has sat still there for about two and a half minutes — a long render too — or at once when every held credit has come back",
  ];
  const added = [];
  for (const f of facts) { assert.ok(whole.includes(f), f); const i = whole.indexOf(f); added.push(whole.slice(i, i + f.length)); }
  assert.ok(!whole.includes("one still running after 6 hours, which is stopped"), "the 6-hour rule is about jobs still in the queue");
  assert.ok(!whole.includes("Generate is disabled when the known balance is below the cost."), "round 3: untrue for Motion Control and editing");
  assert.ok(!whole.includes("once a settle comes back and leaves it there"), "round 3: the fallback waits for the balance to sit still");
  assert.ok(!whole.includes("HOLD THE LONGEST LENGTH") && !whole.includes("so their button, tooltip and the credit footer say"), "round 4: the hold follows the video's length; the button shows the expected charge");
  // the hold example's numbers are the server's (billing-pricing.mjs lengthBilledVideoHold at $0.01 a credit):
  // a 5 s video the server reads, and one it can't ([null])
  const srvp = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  const km = (maxOut, secs) => srvp.lengthBilledVideoHold({ endpoint: "fal-ai/kling-video/v3/standard/motion-control", resolution: "720p", kind: "motion", maxOutputSeconds: maxOut, inputs: [secs], sizable: [secs != null], unit: 0.01 });
  const ke = (secs) => srvp.lengthBilledVideoHold({ endpoint: "bytedance/seedance-2.5/reference-to-video", resolution: "720p", kind: "editing", maxOutputSeconds: 30, maxInputSeconds: 30.2, inputs: [secs], sizable: [secs != null], unit: 0.01 });
  const f = (n) => n.toLocaleString("en-US");
  const ex = "For example, from the credit switch day, a 5-second Motion Control clip on Standard holds " + f(km(30, 5).cost.credits) + " credits and is charged about " + f(km(30, 5).expected.credits)
    + " (" + f(km(30, null).cost.credits) + " when it isn't held by length, or " + f(km(10, null).cost.credits) + " when the scene follows the character image), and a 5-second 720p edit holds "
    + f(ke(5).cost.credits) + " and is charged about " + f(ke(5).expected.credits) + " (" + f(ke(null).cost.credits) + " when it isn't held by length).";
  assert.ok(whole.includes(ex), ex);
  assert.ok(ex.includes("holds 82 credits and is charged about 63 (378 when") && ex.includes("edit holds 369 and is charged about 284 (1,709 when"), ex);
  assert.ok(!whole.includes("tracked per film for 24 hours"));
  for (const t of added) assert.ok(!/\b(fal|ElevenLabs|Anthropic|Claude|OpenAI|Google|Moonshot|Gemini|Opus|TURN|MUSE)\b/.test(t), t);
  // the new-conversation fact reaches Frances (it isn't a billing sentence)
  const pub = feats.map((f) => vm.runInContext("musePublicFeature", A)(f)).filter(Boolean).map((f) => f.what).join("\n");
  assert.ok(pub.includes("The new conversation starts fresh: Frances greets the writer again"), "Frances can explain it");
  // round 4 (A3): what Frances RECEIVES about the Stage's footer and holds — the footer sentence (true on every
  // tab), and none of the billing detail: the reason list leaves with the refusal sentence it belongs to
  assert.ok(pub.includes("The Stage footer shows the remaining balance and what it will be after the render, or, on the Motion Control and Edit Video tabs, what the render holds while it runs."), "Frances's footer fact");
  for (const t of ["one plain sentence: the video is stored", "Its reason", "the server doesn't read from", "HOLD THE VIDEO'S LENGTH", "It holds by length", "It charges only the finished video's length", "Holds up to N credits", "times 1.1 plus 1 second"])
    assert.ok(!pub.includes(t), "Frances doesn't receive: " + t);
});

await test("W (A4, A7 round 5) APP_FEATURES: attachments, speech-to-text and length holds are stated accurately; Frances receives the how-to and none of what is charged", async () => {
  const A = box({ Date, Math, JSON, Promise });
  vm.runInContext(read("app/ai.jsx"), A, { filename: "app/ai.jsx" });
  const feats = vm.runInContext("APP_FEATURES", A);
  const whole = feats.map((f) => String(f.what || "")).join("\n");
  const pubOf = vm.runInContext("musePublicFeature", A);
  const pub = feats.map((f) => pubOf(f)).filter(Boolean).map((f) => f.what).join("\n");
  // A4: "charged" is a billing word — the two sentences that said it no longer reach Frances …
  const bill = vm.runInContext("MUSE_BILLING", A);
  assert.ok(bill.test("its proposal is kept and charged.") && !bill.test("each scene charges its value") && !bill.test("an emotionally discharged beat"), "\\bcharged\\b only");
  for (const t of ["kept and charged", "actually rendered are charged", "is charged like any other", "finishes and is charged", "a model that finishes is charged"])
    assert.ok(!pub.includes(t), "Frances doesn't receive: " + t);
  assert.ok(!/\bcharged\b/i.test(pub), "no sentence Frances receives says 'charged'");
  // … while their how-to still does (the billing half was split off)
  for (const t of ["When a cancel arrives after the scene assistant has already answered, its proposal is kept.",
    "A 3D model (image-to-3D asset) can be cancelled only while it is still waiting in line; once it's being built, it finishes.",
    "When some takes of a batch fail, the successful ones are kept and the Stage reports how many failed."])
    assert.ok(pub.includes(t), "Frances still receives: " + t);
  // the MUSE Protocol names the rule
  assert.ok(read("docs/MUSE Protocol.md").replace(/\s+/g, " ").includes("talks billing, pricing, checkout, credits or what is charged (`MUSE_BILLING`; \"charged\" since 2026-09-30"));
  // A7: the facts, in the manifest
  const facts = [
    "PICTURES SENT FOR A VISUAL CHECK (2026-09-30): a QA check, a prop fitting critique or a location plan sends each picture as a PNG, JPEG, WebP, GIF or HEIC image; the app converts any other picture (an AVIF or BMP, say) to JPEG first. If a picture still can't be used, the message says which one and why.",
    "transcription by the recording's real length — read from the audio file itself before anything is held, never from the words found in it, so a recording with no words in it is charged too —",
    "SPOKEN ANSWERS IN THE TYPED INTERVIEW (2026-09-30): a spoken answer records for up to 5 minutes, then stops by itself and is transcribed as if you had tapped the mic.",
    "If a recording can't be read, or runs longer than the server takes, the interview quietly switches to the browser's own speech recognition (where the browser has one) for the rest of the visit and says 'Your browser will listen from now on — tap the mic and answer again, or type it.' In a browser without speech recognition, spoken answers turn off for the rest of the visit and it says 'Spoken answers aren’t available here any more — type your answer.' Frances's voice keeps speaking as before.",
    "It holds by length a video kept in the film's storage, a video uploaded from your device, a take on the video service's own media storage or a video sent inline, because the server works from a file that can't change before the render uses it: its own copy of a stored, uploaded or inline video",
    "a video kept anywhere else, or one whose length it can't read (a file it can't parse, one split into fragments or compressed, or a slow read), is held at the longest length allowed. Reference videos are priced from the same copy.",
    "times 1.1 plus 1 second",
    "THE CREDIT LINES FOLLOW THE OPEN TASK (billing round 5): on the Create tab's Extend Video task, the credit footer, the composer's red outline and its warning use the extension's own price, as its Extend button does — 'Uses at least N generation credits' until the video to extend is measured.",
    "On Motion Control and Edit Video, no credit shortfall is flagged before a measured video is chosen (a short clip may well fit); the footer still says what the render holds until then.",
    "The right panel's credit error says 'Account on hold — spending credits is paused.' for an account on hold, 'Not enough generation credits to cover what this render holds.' on Motion Control and Edit Video, and 'Not enough generation credits for this render.' otherwise.",
  ];
  for (const f of facts) {
    assert.ok(whole.includes(f), f);
    assert.ok(!/\b(fal|ElevenLabs|Scribe|Anthropic|Claude|OpenAI|Google|Moonshot|Gemini|Opus|Supabase|TURN|MUSE)\b/.test(f), "no vendor or internal name: " + f);
  }
  assert.ok(!whole.includes("transcription by the recording's length,"), "the old wording is gone");
  assert.ok(!whole.includes("It holds by length only a take the Stage rendered"), "round 4's rule is gone");
  // the 5 minutes are the interview's own limit (newstory.jsx), and the image formats the server's allow-list
  const ns = read("app/newstory.jsx");
  assert.ok(ns.includes("const NS_MAX_ANSWER_SECONDS = 300;"), "5 minutes in newstory.jsx");
  const bp = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  assert.deepEqual([...bp.VISION_IMAGE_MIME].sort(), ["image/gif", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp"]);
  // what Frances receives: the interview's and the visual check's how-to, none of the charging
  for (const t of ["a spoken answer records for up to 5 minutes, then stops by itself",
    "the interview quietly switches to the browser's own speech recognition (where the browser has one) for the rest of the visit",
    "sends each picture as a PNG, JPEG, WebP, GIF or HEIC image; the app converts any other picture (an AVIF or BMP, say) to JPEG first",
    "If a picture still can't be used, the message says which one and why."])
    assert.ok(pub.includes(t), "Frances receives: " + t);
  for (const t of ["recording's real length", "a recording with no words in it is charged", "It holds by length", "Reference videos are priced from the same copy", "THE CREDIT LINES FOLLOW", "Uses at least N", "shortfall is flagged", "right panel's credit error"])
    assert.ok(!pub.includes(t), "Frances doesn't receive: " + t);
});

/* ════════ X: pictures a visual check sends (aiVisionComplete, round 5 A5) ════════ */
function visionBox(answer){
  const drawn = [];
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (img) => drawn.push(img.src) }), toDataURL: (type) => "data:" + type + ";base64,/9j/4AAQSkZJRgAB" });
  const X = box({ Date, Math, JSON, Promise, document: { addEventListener: noop, removeEventListener: noop, createElement: (tag) => tag === "canvas" ? canvas() : { style: {} }, body: { appendChild: noop, removeChild: noop }, getElementById: () => null } });
  // the browser draws what it can decode: HEIC here only when the test says so
  X.canDrawHeic = false;
  X.Image = class { constructor(){ this.naturalWidth = 1200; this.naturalHeight = 800; }
    decode(){ return (/^data:image\/hei[cf]/i.test(this.src) && !X.canDrawHeic) ? Promise.reject(new Error("can't decode")) : Promise.resolve(); } };
  X.sent = [];
  X.sbClient = () => ({ functions: { invoke: async (fn, { body }) => { X.sent.push(body); return answer(body); } } });
  X.turnApiKeysForProxy = () => undefined;
  vm.runInContext(read("app/ai.jsx"), X, { filename: "app/ai.jsx" });
  X.drawn = drawn;
  return X;
}
await test("X (A5 round 5) a visual check re-encodes any picture that isn't PNG / JPEG / WebP / GIF to JPEG before it leaves (AVIF, BMP, SVG, a non-base64 label); those four go untouched; the server's bad_image sentence shows as is", async () => {
  const X = visionBox(() => ({ data: { text: "ok", vision: true } }));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", jpg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==", webp = "data:image/webp;base64,UklGRiQAAABXRUJQ", gif = "data:image/gif;base64,R0lGODlhAQABAA==";
  const avif = "data:image/avif;base64,AAAAHGZ0eXBhdmlm", bmp = "data:image/bmp;base64,Qk2GAAAAAAAAAIoAAAB8", svg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
    jpgLabel = "data:image/jpg;base64,/9j/4AAQSkZJRg==", tiff = "data:image/tiff;base64,SUkqAAgAAAA=";
  const r = await X.aiVisionComplete([{ role: "user", content: "critique" }], [png, avif, jpg, bmp, webp, gif, svg, jpgLabel, tiff]);
  assert.equal(r.text, "ok");
  const imgs = plain(X.sent[0].images);
  assert.equal(imgs.length, 9);
  assert.deepEqual([imgs[0], imgs[2], imgs[4], imgs[5]], [png, jpg, webp, gif], "PNG, JPEG, WebP and GIF go as they are");
  for (const i of [1, 3, 6, 7, 8]) assert.ok(/^data:image\/jpeg;base64,/.test(imgs[i]), "re-encoded to JPEG: " + imgs[i].slice(0, 30));
  assert.deepEqual(plain(X.drawn), [avif, bmp, svg, jpgLabel, tiff], "only the other kinds were drawn and re-encoded");
  // every picture that leaves passes the server's own check (billing-pricing.mjs visionImagesProblem)
  const bp = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  assert.equal(bp.visionImagesProblem(imgs), null, "the server accepts every picture that leaves");
  assert.ok(bp.visionImagesProblem([avif]) && bp.visionImagesProblem([bmp]), "… and would have refused the AVIF and BMP as they were");
  // a HEIC: drawn to JPEG when the browser can, else sent as is (the server accepts HEIC)
  const heic = "data:image/heic;base64,AAAAGGZ0eXBoZWlj";
  const H = visionBox(() => ({ data: { text: "ok", vision: true } }));
  await H.aiVisionComplete([{ role: "user", content: "x" }], [heic]);
  assert.equal(H.sent[0].images[0], heic, "a browser that can't draw HEIC sends it as is");
  H.canDrawHeic = true;
  await H.aiVisionComplete([{ role: "user", content: "x" }], [heic]);
  assert.ok(/^data:image\/jpeg;base64,/.test(H.sent[1].images[0]), "one that can re-encodes it");
  // a picture that still can't be prepared: the existing plain message
  const B = visionBox(() => ({ data: { text: "ok" } }));
  B.Image = class { decode(){ return Promise.reject(new Error("no")); } };
  await assert.rejects(B.aiVisionComplete([{ role: "user", content: "x" }], [bmp]), /A reference image couldn't be prepared for the vision model/);
  assert.equal(B.sent.length, 0, "nothing sent");
  // the server still refuses one (400 bad_image): its own sentence, as is — never "Couldn't reach the vision model"
  const sentence = "Only PNG, JPEG, WebP, GIF or HEIC images can be attached (image 2). Documents, audio, video and links can't.";
  const R = visionBox(() => { const ctx = { status: 400, json: async () => ({ error: sentence, code: "bad_image" }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; });
  await assert.rejects(R.aiVisionComplete([{ role: "user", content: "x" }], [png, png]), (e) => { assert.equal(e.message, sentence); return true; });
  // any other failure keeps the old wording
  const O = visionBox(() => { const ctx = { status: 500, json: async () => ({ error: "boom" }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; });
  await assert.rejects(O.aiVisionComplete([{ role: "user", content: "x" }], [png]), /Couldn't reach the vision model|briefly unavailable/);   // (safeError masks the transport text)
});

await test("X (A5 round 5) the size cap and the base64 rule: an oversize PNG data URL and a non-base64 PNG label are re-encoded (the server would refuse both as they are)", async () => {
  const X = visionBox(() => ({ data: { text: "ok", vision: true } }));
  const needs = vm.runInContext("visionImageNeedsReencode", X), max = vm.runInContext("VISION_MAX_DATA_URL_CHARS", X);
  const head = "data:image/png;base64,";
  assert.equal(needs(head + "A".repeat(max - head.length)), false, "a PNG at the cap goes as it is");
  assert.equal(needs(head + "A".repeat(max - head.length + 1)), true, "one character over the cap is re-encoded");
  const plainPng = "data:image/png,iVBORw0KGgo";
  assert.equal(needs(plainPng), true, "a PNG that isn't base64 is re-encoded");
  await X.aiVisionComplete([{ role: "user", content: "x" }], [plainPng]);
  assert.ok(/^data:image\/jpeg;base64,/.test(X.sent[0].images[0]), "it leaves as a JPEG");
  assert.deepEqual(plain(X.drawn), [plainPng]);
});

/* ════════ Q (A6 round 5): a recording the server can't take ════════ */
const badRecording = (sentence) => () => { const ctx = { status: 400, json: async () => ({ error: sentence, code: "audio_unreadable" }) };
  ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
function recordingBox(sttAnswer, opts){
  const Q = voiceBox({ remaining: 500, plan: "writer" }, (body) => body.op === "listVoices" ? { data: { voices: [{ voiceId: "v-1", name: "Narrator" }] } }
    : body.op === "stt" ? sttAnswer(body) : { data: { audioB64: "AA", mime: "audio/mpeg" } }, opts);
  Q.recs = [];
  Q.MediaRecorder = class { constructor(stream, o){ this.mimeType = (o && o.mimeType) || "audio/webm"; this.state = "inactive"; Q.recs.push(this); }
    static isTypeSupported(m){ return m === "audio/webm"; }
    start(){ this.state = "recording"; }
    stop(){ this.state = "inactive"; if (this.ondataavailable) this.ondataavailable({ data: new Blob(["voice"], { type: "audio/webm" }) }); if (this.onstop) this.onstop(); } };
  Q.Blob = Blob;
  Q.FileReader = class { readAsDataURL(){ this.result = "data:audio/webm;base64,dm9pY2U="; queueMicrotask(() => this.onload && this.onload()); } };
  if (opts && opts.timers) { Q.timers = []; Q.setTimeout = (f, ms) => { Q.timers.push({ f, ms, live: true }); return Q.timers.length; }; Q.clearTimeout = (id) => { if (Q.timers[id - 1]) Q.timers[id - 1].live = false; }; }
  return Q;
}
// the server's own refusals (image-proxy index.ts, the stt op: before any hold)
{
  const idx = read("supabase/functions/image-proxy/index.ts");
  for (const s0 of ['return json({ error: "That recording couldn\'t be read. Record the answer again.", code: "audio_unreadable" }, 400);',
    'return json({ error: `That recording is longer than ${STT_MAX_SECONDS / 60} minutes. Record a shorter answer.`, code: "audio_too_long" }, 400);',
    'return json({ error: "That transcription model isn\'t available.", code: "model_not_allowed" }, 400);'])
    await test("Q (A6 round 5) the server still refuses a recording this way: " + s0.slice(0, 90), () => assert.ok(idx.includes(s0), s0));
  const bp = await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT));
  await test("Q (A6 round 5) the interview's longest answer (5 minutes) stays below the server's limit, and the app sends no transcription model (the server's default)", () => {
    assert.ok(bp.STT_MAX_SECONDS >= 300 + 60, "server " + bp.STT_MAX_SECONDS + " s vs the app's 300 s");
    assert.equal(bp.sttModel(undefined) != null, true, "no modelId → the server's default model");
    assert.ok(/vgProxy\("stt", \{ audioB64, mime: mime\|\|"audio\/webm" \}, \{ quiet:true \}\)/.test(read("app/voicegen.jsx")), "elTranscribe sends no modelId");
  });
}
const _sttMaxMinutes = (await import(new URL("supabase/functions/image-proxy/billing-pricing.mjs", ROOT))).STT_MAX_SECONDS / 60;
for (const [what, sentence, code] of [["unreadable", "That recording couldn't be read. Record the answer again.", "audio_unreadable"], ["too long", `That recording is longer than ${_sttMaxMinutes} minutes. Record a shorter answer.`, "audio_too_long"],
  ["a model the server doesn't take", "That transcription model isn't available.", "model_not_allowed"], ["bad_request shape", "Speech-to-text needs audio.", "bad_request"]]) {
  await test("Q (A6 round 5) a transcription refused with 400 (" + what + "): onError('switched-to-browser'), no Plans window, no billing refusal; the next answer uses the browser's speech recognition while Frances's voice keeps speaking", async () => {
    const answer = code === "bad_request"
      ? () => { const ctx = { status: 400, json: async () => ({ error: "bad_request", code: "bad_request", message: sentence }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; }
      : () => { const ctx = { status: 400, json: async () => ({ error: sentence, code }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; };
    const Q = recordingBox(answer);
    assert.equal(Q.Voice.paidVoice, true);
    const errs = [], finals = [];
    Q.Voice.listen({ onInterim: noop, onFinal: (t) => finals.push(t), onError: (e) => errs.push(e) });
    await settle();
    assert.equal(Q.recs.length, 1, "recorded for the paid transcription");
    Q.Voice.stopListening();
    await settleUntil(() => errs.length > 0);
    assert.deepEqual(plain(errs), ["switched-to-browser"]);
    assert.deepEqual(plain(finals), []);
    assert.equal(Q.plansOpened, 0, "quiet: no Plans window");
    assert.equal(Q.Voice.sttSupported, true);
    Q.Voice.listen({ onInterim: noop, onFinal: noop, onError: noop });
    await settle();
    assert.equal(Q.srStarted, 1, "the next answer: the browser's speech recognition");
    assert.equal(Q.recs.length, 1, "no second paid recording");
    assert.equal(Q.Voice.paidVoice, true, "Frances's paid voice keeps speaking (only listening switched)");
    const before = Q.calls.length;
    await Q.Voice.speak("Tell me more.");
    assert.ok(Q.calls.slice(before).includes("tts"), "the next line is still spoken by the paid voice");
  });
}
await test("Q (A6 round 5) the error carries the server's sentence and status (vgProxy); a 5xx still reads as stt-failed and keeps the paid transcription", async () => {
  const Q = recordingBox(badRecording("That recording couldn't be read. Record the answer again."));
  const e = await Q.vgProxy("stt", { audioB64: "AA", mime: "audio/webm" }, { quiet: true }).then(() => null, (x) => x);
  assert.ok(e && e.status === 400 && !e.billing, "a plain refusal, not a billing one");
  assert.equal(e.message, "That recording couldn't be read. Record the answer again.");
  const F = recordingBox(() => { const ctx = { status: 502, json: async () => ({ error: "Couldn't reach the voice service. Please try again." }) }; ctx.clone = () => ctx; return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: ctx } }; });
  const errs = [];
  F.Voice.listen({ onInterim: noop, onFinal: noop, onError: (x) => errs.push(x) });
  await settle(); F.Voice.stopListening();
  await settleUntil(() => errs.length > 0);
  assert.deepEqual(plain(errs), ["stt-failed"], "a service failure isn't a switch");
  F.Voice.listen({ onInterim: noop, onFinal: noop, onError: noop });
  await settle();
  assert.equal(F.recs.length, 2, "still the paid transcription");
  assert.equal(F.srStarted, 0);
  F.Voice.stopListening();   // (clears its 5-minute timer)
  await settle();
});
await test("Q (A6 round 5) a spoken answer records for 5 minutes at most: it stops by itself and is transcribed; tapping the mic first cancels the timer", async () => {
  const Q = recordingBox(() => ({ data: { text: "a hero who can't sleep" } }), { timers: true });
  const finals = [];
  Q.Voice.listen({ onInterim: noop, onFinal: (t) => finals.push(t), onError: noop });
  await settle();
  const cap = Q.timers.filter((t) => t.live && t.ms === 300000);
  assert.equal(cap.length, 1, "one 5-minute timer: " + JSON.stringify(Q.timers.map((t) => t.ms)));
  assert.equal(Q.recs[0].state, "recording");
  cap[0].f();                                   // five minutes pass
  await settleUntil(() => finals.length > 0);
  assert.equal(Q.recs[0].state, "inactive", "stopped by itself");
  assert.deepEqual(plain(finals), ["a hero who can't sleep"], "and transcribed as if the mic had been tapped");
  assert.deepEqual(plain(Q.calls).filter((c) => c === "stt"), ["stt"]);
  // tapping the mic before the limit clears the timer
  Q.Voice.listen({ onInterim: noop, onFinal: (t) => finals.push(t), onError: noop });
  await settle();
  const t2 = Q.timers[Q.timers.length - 1];
  assert.equal(t2.ms, 300000); assert.equal(t2.live, true);
  Q.Voice.stopListening();
  assert.equal(t2.live, false, "the timer is cleared by the tap");
  await settleUntil(() => finals.length > 1);
  assert.equal(vm.runInContext("NS_MAX_ANSWER_SECONDS", Q), 300);
});

await test("K (round 5 cleanup) a take's link is re-signed right before Extend, Edit Video and Motion Control submit (an expired 1-hour link would count as unread and hold the longest length); other picks go as they are", async () => {
  const src = read("app/stage.jsx");
  const a = src.indexOf("const STAGE_LENGTH_HOLD");
  const b = src.indexOf("\n}\n", src.indexOf("function stageCreditInfo(")) + 3;
  assert.ok(a > 0 && b > a && src.indexOf("async function stageFreshVideoRef(") > a && src.indexOf("async function stageFreshVideoRef(") < b, "the helper sits with the hold helpers");
  const S = box(); run(S, "app/pricing.jsx"); run(S, "app/plans.jsx");
  S.TURN_SUPABASE = { url: "https://proj-x.supabase.co" }; S.URL = URL;
  vm.runInContext(transform(src.slice(a, b), "stage-hold.jsx"), S);
  const signed = [];
  S.cloudSignedUrl = async (path) => { signed.push(path); return "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/" + path + "?token=fresh"; };
  const old = "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/p1/videos/take%201.mp4?token=expired";
  assert.equal(await S.stageFreshVideoRef({ kind: "take", url: old, ref: old }), "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/u1/p1/videos/take 1.mp4?token=fresh");
  assert.deepEqual(plain(signed), ["u1/p1/videos/take 1.mp4"], "re-signed by its storage path");
  for (const m of [{ kind: "device", ref: "stage:u1/stage/a.mp4", url: "blob:https://app/x" }, { kind: "take", ref: "https://v3.fal.media/files/x.mp4" },
    { kind: "take", ref: "https://cdn.example.com/x.mp4" }, { kind: "take", ref: "https://proj-x.supabase.co/storage/v1/object/sign/turn-assets/_internal/video-snapshots/x.mp4?token=t" }])
    assert.equal(await S.stageFreshVideoRef(m), m.ref, "left as it is: " + m.ref);
  assert.equal(signed.length, 1, "only the project-storage take was re-signed");
  S.cloudSignedUrl = async () => ""; assert.equal(await S.stageFreshVideoRef({ kind: "take", ref: old }), old, "a failed re-sign keeps the old link (the server then holds the maximum)");
  S.cloudSignedUrl = async () => { throw new Error("offline"); }; assert.equal(await S.stageFreshVideoRef({ kind: "take", ref: old }), old);
  for (const [v, name] of [["extendVideo", "extendRef"], ["editVideo", "editRef"], ["motionVideo", "motionRef"]]) {
    assert.ok(src.includes("const " + name + " = await stageFreshVideoRef(" + v + ");") && src.includes("videoUrls:[" + name + "]"), v + " submits the re-signed link");
    assert.ok(!src.includes("videoUrls:[" + v + ".ref]"), v + " never submits the stale link");
  }
});

/* ════════ Q (round 5 cleanup): no speech recognition to fall back on; the component's sentences match Frances's facts ════════ */
await test("Q (round 5) a browser without speech recognition: a refused recording reports 'stt-refused' (not 'try again'), spoken answers turn off for the visit, no Plans window", async () => {
  const Q = recordingBox(badRecording("That recording couldn't be read. Record the answer again."), { noSpeechRecognition: true });
  assert.equal(Q.Voice.paidVoice, true);
  assert.equal(Q.Voice.sttSupported, true, "the paid transcription listens at first");
  const errs = [];
  Q.Voice.listen({ onInterim: noop, onFinal: noop, onError: (e) => errs.push(e) });
  await settle(); Q.Voice.stopListening();
  await settleUntil(() => errs.length > 0);
  assert.deepEqual(plain(errs), ["stt-refused"]);
  assert.equal(Q.plansOpened, 0);
  assert.equal(Q.Voice.sttSupported, false, "no mic left: nothing can listen");
  assert.equal(Q.Voice.spokenRefused, true, "the note says spoken answers are off for this visit, not 'need Chrome or Edge'");
  const B = recordingBox(() => planRequired(), { noSpeechRecognition: true });
  const berrs = [];
  B.Voice.listen({ onInterim: noop, onFinal: noop, onError: (e) => berrs.push(e) });
  await settle(); B.Voice.stopListening();
  await settleUntil(() => berrs.length > 0);
  assert.deepEqual(plain(berrs), ["stt-refused"], "a billing refusal there reads the same");
  assert.equal(B.plansOpened, 0);
});
await test("Q (round 5) the interview's own sentences are the ones Frances quotes (newstory.jsx ↔ APP_FEATURES), and the no-recognition sentences are wired", () => {
  const ns = read("app/newstory.jsx"), ai = read("app/ai.jsx");
  const switched = "Your browser will listen from now on — tap the mic and answer again, or type it.";
  const refused = "Spoken answers aren’t available here any more — type your answer.";
  assert.ok(ns.includes(`er==="switched-to-browser" ? "${switched}"`), "the component shows the switched sentence");
  assert.ok(ns.includes(`er==="stt-refused" ? "${refused}"`), "the component shows the refused sentence");
  assert.ok(ai.includes(`says '${switched}'`) && ai.includes(`says '${refused}'`), "APP_FEATURES quotes both verbatim");
  assert.ok(ns.includes("!Voice.sttSupported && Voice.spokenRefused &&") && ns.includes("!Voice.sttSupported && !Voice.spokenRefused &&"), "the browser note follows the refusal");
});

console.log(failed ? `${checks} passed, ${failed} failed` : `${checks} checks passed`);
if (failed) process.exit(1);

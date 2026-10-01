#!/usr/bin/env node
/* test-tax-compliance-app.mjs — the APP side of the consumer-rights and tax decisions (owner,
   2026-10-01). Offline: no network, no Stripe, no Supabase, no browser. The real sources are
   transpiled (like the production build) and run in node:vm sandboxes with small fakes.

     C  D2 the confirm step before EVERY checkout (plans, packs, the sign-up auto-checkout): the
        exact "Start now…" checkbox text, Continue disabled until it's ticked, Cancel opens nothing,
        the consent is recorded (turn_record_checkout_consent(sku, 'v2-2026-10-01')) and a missing
        function, an error or a slow answer never blocks the payment page (app/plans.jsx)
     T  D5 the "We've updated our Terms and Privacy Policy" banner: hidden while TERMS_UPDATED_AT is
        "", 30 days from the date, per-user dismissal, links to both pages (app/plans.jsx)
     A  D1 the admin's Tax & compliance page: the menu item next to Storage (admin only), the rate
        (default 0.80, remembered), UK / EU / US / unknown / by-product guidance with the hedges, the
        checklist, the friendly message when the SQL hasn't been run (app/admin-tax.jsx, app/auth-ui.jsx)
     F  APP_FEATURES: the consent step, the 14-day right and the banner; nothing about the admin page
     H  TURN.html cache keys, the CSS, brand

   node scripts/test-tax-compliance-app.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
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
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

/* ── a tiny element tree + hook stub ── */
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
const walk = (n, f) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach((x) => walk(x, f)); return; } f(n); (n.children || []).forEach((x) => walk(x, f)); };
const findAll = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const hasClass = (c) => (n) => String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (!n || typeof n !== "object") ? ""
  : Array.isArray(n) ? n.map(textOf).join("") : (n.children || []).map(textOf).join("");
function makeReact(){
  const R = { Fragment: "fragment", createElement: el, state: null, calls: 0,
    useState(init){ const i = R.calls++; const v = (R.state && i in R.state) ? R.state[i] : (typeof init === "function" ? init() : init);
      return [v, (nv) => { const cur = (R.state && i in R.state) ? R.state[i] : v; R.state = { ...(R.state || {}), [i]: typeof nv === "function" ? nv(cur) : nv }; }]; },
    useEffect(f){ R.effects.push(f); }, effects: [], useRef: (v) => ({ current: v === undefined ? null : v }), useMemo: (f) => f(), useCallback: (f) => f, useLayoutEffect(){},
    reset(state){ R.state = state || null; R.calls = 0; R.effects = []; } };
  return R;
}
/* render function components inside a tree (stateless ones: Section, Table) so their text shows */
const deep = (n) => {
  if (Array.isArray(n)) return n.map(deep);
  if (!n || typeof n !== "object") return n;
  if (typeof n.type === "function") return deep(n.type({ ...n.props, children: n.children.length > 1 ? n.children : n.children[0] }));
  return { ...n, children: (n.children || []).map(deep) };
};
const mkStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
function box(extra){
  const React = makeReact();
  const b = { console, React, Icon: new Proxy({}, { get: () => () => null }), rendered: [], unmounted: 0, keyListeners: [],
    ReactDOM: { createRoot: () => ({ render: (x) => { b.rendered.push(x); }, unmount: () => { b.unmounted++; } }) },
    document: { addEventListener: (t, f) => { if (t === "keydown") b.keyListeners.push(f); }, removeEventListener: (t, f) => { b.keyListeners = b.keyListeners.filter((x) => x !== f); },
      createElement: () => ({ style: {}, parentNode: null }), body: { appendChild: noop, removeChild: noop, classList: { add: noop, remove: noop, toggle: noop } }, getElementById: () => null },
    localStorage: mkStore(), sessionStorage: mkStore(), events: [], toasts: [], opened: [], assigned: [],
    CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o && o.detail; } },
    addEventListener: noop, removeEventListener: noop,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    location: { hostname: "localhost", href: "", search: "", hash: "", origin: "", assign(u){ b.assigned.push(u); } },
    open(u, t, f){ b.opened.push(u); b.openArgs = [t, f]; }, navigator: { userAgent: "node-test", onLine: true }, ...(extra || {}) };
  b.dispatchEvent = (ev) => { b.events.push(ev); return true; };
  b.appToast = (m, k) => b.toasts.push({ m, k });
  b.window = b; b.globalThis = b; vm.createContext(b); return b;
}
const run = (b, f, src) => vm.runInContext(transform(src || read(f), f), b, { filename: f });

const CONSENT = "Start now: I want to use my credits straight away. I understand I lose my right to cancel for credits I use, and if I cancel within 14 days I only get back the part I haven't used.";
const paidFn = (plan) => { const p = String(plan || "").toLowerCase().trim(); return !!p && p !== "none" && p !== "free" && p !== "trial"; };

/* ════════ C: the confirm step before every checkout (app/plans.jsx) ════════ */
const P = box({ CREDIT_SCALE: 10 });
run(P, "app/plans.jsx");
let rpcCalls = [];
let rpcAnswer = async () => ({ data: null, error: null });
P.sbClient = () => ({ rpc: (name, args) => { rpcCalls.push([name, JSON.parse(JSON.stringify(args))]); return rpcAnswer(name, args); } });
const renderPlans = (balance) => {
  P.turnUserId = "u-1"; P.turnUserEmail = "ana@example.com";
  P.turnCreditBalance = balance || null; P.turnIsPaidPlan = paidFn; P.turnIsAdmin = false; P.usePlansVersion = () => 0;
  P.React.reset();
  return P.PlansModal({ onClose: noop, currentPlan: balance ? balance.plan : null });
};
const lastDialog = (B) => B.rendered.filter((x) => x && x.type === B.CheckoutConsentDialog).pop();
/* render the open dialog with its own hook state (index 0 = ticked, 1 = busy) */
const dialogTree = (B, state) => { const d = lastDialog(B); B.React.reset(state); return d.type(d.props); };
const reset = (B) => { B.opened.length = 0; B.assigned.length = 0; B.rendered.length = 0; B.toasts.length = 0; rpcCalls = []; rpcAnswer = async () => ({ data: null, error: null }); if (B.turnCloseCheckoutConsent) B.turnCloseCheckoutConsent(); };

await test("C1 the exact consent wording and its version", () => {
  assert.equal(P.TURN_CHECKOUT_CONSENT_TEXT, CONSENT);
  assert.equal(P.TURN_CHECKOUT_CONSENT_VERSION, "v2-2026-10-01", "v2: the acknowledgement that the right is lost for credits used (CCR reg 37)");
  assert.equal(P.turnCheckoutSku(P.CINEMA_PLANS[2]), "plan-studio", "plan ids are never renamed");
  assert.equal(P.turnCheckoutSku(P.CINEMA_CREDIT_PACKS[0]), "pack-250");
  assert.equal(P.turnCheckoutSku(P.TURN_LEGACY_CREDIT_PACKS[0]), "credits-300");
});
await test("C2 'Choose Writer' opens the confirm step, NOT the payment page: required checkbox (unticked), Continue disabled, renewal named", () => {
  reset(P);
  const tree = renderPlans({ remaining: 0, plan: "none" });
  const writer = findAll(tree, hasClass("plan-cta"))[0];
  assert.equal(textOf(writer), "Choose Writer");
  writer.props.onClick();
  assert.equal(P.opened.length + P.assigned.length, 0, "nothing opens before the box is ticked");
  assert.ok(lastDialog(P), "the confirm step is mounted");
  const t = dialogTree(P);
  assert.equal(textOf(findAll(t, hasClass("checkout-consent-title"))[0]), "Before you pay");
  assert.equal(textOf(findAll(t, hasClass("checkout-consent-item"))[0]), "Writer plan · $19 a month");
  assert.match(textOf(findAll(t, hasClass("checkout-consent-renew"))[0]), /^Renews every month at \$19 until you cancel\. Cancel anytime from Manage plan/);
  const cb = findAll(t, (n) => n.type === "input")[0];
  assert.equal(cb.props.type, "checkbox"); assert.equal(cb.props.checked, false); assert.equal(cb.props.required, true);
  assert.equal(textOf(findAll(t, hasClass("checkout-consent-check"))[0]), CONSENT);
  const go = findAll(t, (n) => n.type === "button").find((n) => textOf(n) === "Continue to payment");
  assert.equal(go.props.disabled, true, "Continue is disabled until the box is ticked");
  go.props.onClick();
  assert.equal(P.opened.length + P.assigned.length, 0, "an unticked Continue does nothing");
  assert.equal(rpcCalls.length, 0);
  assert.equal(findAll(t, (n) => n.type === "a")[0].props.href, "/terms.html#cancel");
  assert.equal(textOf(findAll(t, hasClass("checkout-consent-note"))[0]),
    "You’ll pay on a secure checkout page next. To cancel within 14 days, email kinolot-billing@infinitestudioai.com. More in our Terms.",
    "how to cancel is said in the step itself (the live Terms describe it only from the switch day)");
});
await test("C3 Cancel (and the backdrop, and Escape) close the step and open nothing; the next click can open it again", () => {
  reset(P);
  P.turnStartCheckout(P.CINEMA_PLANS[1]);
  const before = P.unmounted;
  let t = dialogTree(P);
  findAll(t, (n) => n.type === "button").find((n) => textOf(n) === "Cancel").props.onClick();
  assert.equal(P.unmounted, before + 1, "Cancel unmounts the step");
  assert.equal(P.opened.length + P.assigned.length + rpcCalls.length, 0);
  P.rendered.length = 0;
  P.turnStartCheckout(P.CINEMA_PLANS[1]);
  assert.ok(lastDialog(P), "it can open again after Cancel");
  t = dialogTree(P);
  t.props.onMouseDown({ target: t, currentTarget: t });
  assert.equal(P.unmounted, before + 2, "the backdrop closes it");
  P.rendered.length = 0;
  P.turnStartCheckout(P.CINEMA_PLANS[1]);
  dialogTree(P); P.React.effects.forEach((f) => f());
  P.keyListeners.slice().forEach((f) => f({ key: "Escape" }));
  assert.equal(P.unmounted, before + 3, "Escape closes it");
  assert.equal(P.opened.length + P.assigned.length + rpcCalls.length, 0);
});
await test("C4 ticking the box enables Continue, which opens the payment page (user id + email) in a new tab and records the consent", async () => {
  reset(P);
  P.turnUserId = "u-1"; P.turnUserEmail = "ana@example.com";
  P.turnStartCheckout(P.CINEMA_PLANS[1]);
  let t = dialogTree(P);
  findAll(t, (n) => n.type === "input")[0].props.onChange({ target: { checked: true } });
  const ticked = P.React.state;
  t = dialogTree(P, ticked);
  const go = findAll(t, (n) => n.type === "button").find((n) => textOf(n) === "Continue to payment");
  assert.equal(go.props.disabled, false);
  const before = P.unmounted;
  go.props.onClick();
  assert.equal(P.opened.length, 1, "opened inside the click (no popup block)");
  assert.equal(P.opened[0], "https://buy.stripe.com/test_00waEZ77eeiD6Ti4j1c7u01?client_reference_id=u-1&prefilled_email=ana%40example.com");
  assert.deepEqual(P.openArgs, ["_blank", "noopener"]);
  assert.deepEqual(rpcCalls, [["turn_record_checkout_consent", { sku: "plan-director", consent_version: "v2-2026-10-01" }]]);
  await settle();
  assert.equal(P.unmounted, before + 1, "the step closes");
});
await test("C5 a pack goes through the same step and records its own sku", async () => {
  reset(P);
  const pack = P.CINEMA_CREDIT_PACKS[0];
  P.turnStartCheckout(pack);
  assert.equal(P.opened.length, 0);
  let t = dialogTree(P);
  assert.equal(textOf(findAll(t, hasClass("checkout-consent-item"))[0]), "250 credits · $10, one-off");
  assert.equal(findAll(t, hasClass("checkout-consent-renew")).length, 0, "a pack doesn't renew");
  findAll(t, (n) => n.type === "input")[0].props.onChange({ target: { checked: true } });
  t = dialogTree(P, P.React.state);
  findAll(t, (n) => n.type === "button").find((n) => textOf(n) === "Continue to payment").props.onClick();
  assert.equal(P.opened.length, 1); assert.ok(P.opened[0].startsWith(pack.test + "?client_reference_id=u-1"));
  assert.deepEqual(rpcCalls, [["turn_record_checkout_consent", { sku: "pack-250", consent_version: "v2-2026-10-01" }]]);
  await settle();
});
const tickAndGo = async (B) => {
  let t = dialogTree(B);
  findAll(t, (n) => n.type === "input")[0].props.onChange({ target: { checked: true } });
  t = dialogTree(B, B.React.state);
  findAll(t, (n) => n.type === "button").find((n) => textOf(n) === "Continue to payment").props.onClick();
};
await test("C6 the SQL not run yet (PGRST202), a database error, a thrown call or no cloud at all never block the payment page", async () => {
  for (const answer of [async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.turn_record_checkout_consent" } }),
    async () => ({ data: null, error: { code: "42883", message: "function turn_record_checkout_consent(text, text) does not exist" } }),
    async () => ({ data: null, error: { code: "XX000", message: "boom" } }),
    async () => { throw new Error("network down"); }]) {
    reset(P); rpcAnswer = answer;
    P.turnStartCheckout(P.CINEMA_PLANS[0]);
    await tickAndGo(P);
    assert.equal(P.opened.length, 1);
    await settle();
  }
  const r = await P.turnRecordCheckoutConsent("pack-250", "v1-2026-10-01");
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: false, reason: "error" });
  rpcAnswer = async () => ({ data: null, error: { code: "PGRST202", message: "x" } });
  assert.equal((await P.turnRecordCheckoutConsent("pack-250", "v1")).reason, "missing");
  const saved = P.sbClient; P.sbClient = undefined;
  try {
    reset(P); P.turnStartCheckout(P.CINEMA_PLANS[0]); await tickAndGo(P);
    assert.equal(P.opened.length, 1, "no cloud: still opens");
  } finally { P.sbClient = saved; }
});
await test("C7 the sign-up auto-checkout (sameTab) shows the step too, waits for the record, then moves THIS tab — even when the record never answers", async () => {
  reset(P);
  let resolveRpc; rpcAnswer = () => new Promise((r) => { resolveRpc = r; });
  P.turnStartCheckout(P.CINEMA_PLANS[1], { sameTab: true });
  assert.equal(P.assigned.length + P.opened.length, 0, "the step first");
  await tickAndGo(P);
  await settle();
  assert.equal(P.assigned.length, 0, "waits for the record (leaving the page would cancel it)");
  resolveRpc({ data: null, error: null });
  await settle();
  assert.equal(P.assigned.length, 1); assert.equal(P.opened.length, 0);
  assert.ok(P.assigned[0].startsWith("https://buy.stripe.com/test_00waEZ77eeiD6Ti4j1c7u01?client_reference_id=u-1"));
  // a record that hangs: the page still opens after the short wait
  reset(P); rpcAnswer = () => new Promise(() => {});
  P.turnStartCheckout(P.CINEMA_PLANS[1], { sameTab: true });
  await tickAndGo(P);
  const t0 = Date.now();
  while (!P.assigned.length && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20));
  assert.equal(P.assigned.length, 1, "opened after the wait");
  assert.ok(Date.now() - t0 >= 2000, "it waited for the record first");
});
await test("C8 signed out, or no payment link here: no step, the old sentences", () => {
  reset(P);
  P.turnUserId = null;
  P.turnStartCheckout(P.CINEMA_PLANS[0]);
  assert.ok(!lastDialog(P)); assert.equal(P.toasts[0].m, "Sign in first — purchases are tied to your account.");
  assert.equal(P.events.filter((e) => e.type === "turn-need-signin").length >= 1, true);
  reset(P); P.turnUserId = "u-1";
  const pack = P.CINEMA_CREDIT_PACKS[1], saved = pack.test; pack.test = "";
  try { P.turnStartCheckout(pack); } finally { pack.test = saved; }
  assert.ok(!lastDialog(P)); assert.equal(P.toasts[0].m, "Checkout isn't available yet — please try again shortly.");
});
await test("C9 one step at a time: a second checkout click while it's open doesn't stack another", () => {
  reset(P);
  P.turnStartCheckout(P.CINEMA_PLANS[0]);
  P.turnStartCheckout(P.CINEMA_PLANS[1]);
  assert.equal(P.rendered.filter((x) => x && x.type === P.CheckoutConsentDialog).length, 1);
  reset(P);
});
await test("C10 every path to a payment page goes through the step: startCheckout only mounts it; window.open / location.assign live in proceedToCheckout alone; app.jsx's sign-up path calls turnStartCheckout", () => {
  const src = read("app/plans.jsx");
  const body = (name) => { const a = src.indexOf("function " + name + "("); const b = src.indexOf("\nwindow.", a); return src.slice(a, b); };
  const sc = body("startCheckout");
  assert.ok(sc.includes("openCheckoutConsent(plan, opts)"));
  assert.ok(!/window\.open|location\.assign|checkoutUrl\(/.test(sc), "startCheckout never opens a payment page itself");
  const opens = [...src.matchAll(/window\.open\(url|location\.assign\(url/g)].length;
  const inProceed = [...body("proceedToCheckout").matchAll(/window\.open\(url|location\.assign\(url/g)].length;
  assert.equal(opens, inProceed, "no other opener in plans.jsx");
  const app = read("app/app.jsx");
  assert.ok(app.includes("window.turnStartCheckout(planObj, { sameTab:true })"), "the welcome/intent auto-checkout goes through startCheckout → the step");
  assert.ok(!/buy\.stripe\.com/.test(app));
});
await test("C11 the step's copy names no vendor and no retired name", () => {
  const src = read("app/plans.jsx");
  const a = src.indexOf("function checkoutConsentCopy("), b = src.indexOf("window.turnOpenCheckoutConsent");
  const lits = [...src.slice(a, b).matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).join("\n");
  assert.ok(!/stripe|claude|anthropic|mckee|cinema machine/i.test(lits) && !/\bTURN\b/.test(lits), lits);
});

await test("C12 keyboard: the step takes the focus (its checkbox) when it opens, Tab / Shift+Tab stay inside it, and the focus goes back to the button that opened it", () => {
  reset(P);
  let openerFocused = 0;
  P.document.activeElement = { focus(){ openerFocused++; } };
  P.turnStartCheckout(P.CINEMA_PLANS[0]);
  const t = dialogTree(P);
  const cb = findAll(t, (n) => n.type === "input")[0];
  const dlg = findAll(t, (n) => n.props && n.props.role === "dialog")[0];
  assert.ok(cb.props.ref && "current" in cb.props.ref, "the checkbox has a ref");
  assert.ok(dlg.props.ref && "current" in dlg.props.ref, "the dialog has a ref");
  let boxFocused = 0;
  cb.props.ref.current = { focus(){ boxFocused++; } };
  // three focusable controls: the checkbox, the Terms link, Cancel (Continue is disabled until ticked)
  const mk = (name) => ({ name, focused: 0, focus(){ this.focused++; P.document.activeElement = this; } });
  const ctrls = [mk("box"), mk("link"), mk("cancel")];
  dlg.props.ref.current = { querySelectorAll: () => ctrls, contains: (x) => ctrls.includes(x) };
  P.React.effects.forEach((f) => f());
  assert.equal(boxFocused, 1, "the checkbox is focused when the step opens");
  const key = (shiftKey) => { let prevented = 0; P.keyListeners.slice().forEach((f) => f({ key: "Tab", shiftKey, preventDefault(){ prevented++; } })); return prevented; };
  P.document.activeElement = ctrls[2];
  assert.equal(key(false), 1); assert.equal(ctrls[0].focused, 1, "Tab on the last control wraps to the first");
  P.document.activeElement = ctrls[0];
  assert.equal(key(true), 1); assert.equal(ctrls[2].focused, 1, "Shift+Tab on the first wraps to the last");
  P.document.activeElement = ctrls[1];
  assert.equal(key(false), 0, "in between, Tab moves normally");
  P.document.activeElement = { outside: true };
  assert.equal(key(false), 1); assert.equal(ctrls[0].focused, 2, "focus outside the step is pulled back in");
  P.turnCloseCheckoutConsent();
  assert.equal(openerFocused, 1, "closing gives the focus back to the opener");
  P.document.activeElement = null;
});

/* ════════ T: the Terms-updated banner (app/plans.jsx) ════════ */
await test("T1 TERMS_UPDATED_AT is the ONE constant and ships empty (hidden)", () => {
  const src = read("app/plans.jsx");
  assert.equal((src.match(/const TERMS_UPDATED_AT = /g) || []).length, 1);
  assert.ok(src.includes('const TERMS_UPDATED_AT = "";'));
  assert.equal(P.TURN_TERMS_UPDATED_AT, "");
  for (const f of ["app/app.jsx", "app/home-dashboard.jsx", "app/auth-ui.jsx", "app/ai.jsx"]) assert.ok(!read(f).includes("TERMS_UPDATED_AT ="), f + " doesn't define its own");
  P.turnUserId = "u-1"; P.turnIsAdmin = false; P.React.reset();
  assert.equal(P.BillingNotices({ balance: { remaining: 1500, plan: "director", planRemaining: 1500, packRemaining: 0 } }), null, "nothing shows while it's empty");
});
await test("T2 shown for 30 days from the date, not before, not after; a dismissal holds for that date only; a bad date hides it", () => {
  const d = "2026-10-31", t = Date.parse(d), day = 86400000;
  assert.equal(P.turnTermsNoticeDue(d, t - 1, ""), false);
  assert.equal(P.turnTermsNoticeDue(d, t, ""), true);
  assert.equal(P.turnTermsNoticeDue(d, t + 29 * day, ""), true);
  assert.equal(P.turnTermsNoticeDue(d, t + 30 * day, ""), false);
  assert.equal(P.turnTermsNoticeDue(d, t + day, d), false, "dismissed");
  assert.equal(P.turnTermsNoticeDue(d, t + day, "2026-05-01"), true, "an older dismissal doesn't hide a newer update");
  assert.equal(P.turnTermsNoticeDue("", t, ""), false);
  assert.equal(P.turnTermsNoticeDue("soon", t, ""), false);
});
await test("T3 the banner: exact title, links to /terms.html and /privacy.html in a new tab, × dismisses per user (both mounts), signed out never", () => {
  const B = box({ CREDIT_SCALE: 10 });
  // the real file with the owner's switch-day edit applied
  run(B, "app/plans.jsx", read("app/plans.jsx").replace('const TERMS_UPDATED_AT = "";', 'const TERMS_UPDATED_AT = "2026-10-31";'));
  B.turnUserId = "u-1"; B.turnIsAdmin = false;
  const now = Date.parse("2026-11-05T12:00:00Z");
  const bal = { remaining: 1500, plan: "director", planRemaining: 1500, packRemaining: 0 };
  B.React.reset();
  let out = B.BillingNotices({ balance: bal, now });
  assert.ok(out, "shown");
  const tn = findAll(out, (n) => n.props && n.props.at === "2026-10-31")[0];
  assert.ok(tn, "the terms notice is in the banners");
  const banner = tn.type(tn.props);
  assert.ok(hasClass("billing-banner")(banner) && hasClass("info")(banner));
  assert.equal(textOf(findAll(banner, (n) => n.type === "b")[0]), "We've updated our Terms and Privacy Policy. ");
  assert.equal(textOf(findAll(banner, hasClass("billing-banner-text"))[0]), "We've updated our Terms and Privacy Policy. Read the Terms and the Privacy Policy.");
  const links = findAll(banner, (n) => n.type === "a").map((a) => [a.props.href, a.props.target, a.props.rel]);
  assert.deepEqual(links, [["/terms.html", "_blank", "noopener"], ["/privacy.html", "_blank", "noopener"]]);
  // dismiss
  findAll(banner, hasClass("billing-banner-x"))[0].props.onClick();
  assert.equal(B.localStorage.getItem("turn-terms-notice:u-1"), "2026-10-31");
  B.React.reset();
  assert.equal(B.BillingNotices({ balance: bal, now }), null, "gone for this account (the other mount reads the same key)");
  B.turnUserId = "u-2"; B.React.reset();
  assert.ok(B.BillingNotices({ balance: bal, now }), "another account still sees it");
  B.turnUserId = null; B.React.reset();
  assert.equal(B.BillingNotices({ balance: bal, now }), null, "signed out: never");
  B.turnUserId = "u-2"; B.React.reset();
  assert.equal(B.BillingNotices({ balance: bal, now: Date.parse("2026-12-01T00:00:00Z") }), null, "30 days later: gone");
  // it rides with the billing banners
  B.React.reset();
  const both = B.BillingNotices({ balance: { ...bal, paymentStatus: "past_due" }, now });
  assert.equal(findAll(both, (n) => n.props && n.props.at === "2026-10-31").length, 1);
  assert.ok(textOf(both).includes("Payment failed"));
});

/* ════════ A: the admin's Tax & compliance page ════════ */
const A = box({});
run(A, "app/admin-tax.jsx");
const L = A.AdminTaxLib;
const summary = (o = {}) => ({
  as_of: "2026-10-01T10:00:00Z",
  thresholds: { uk_gbp: 90000, us_usd: 100000, us_tx: 200, checked: "2026-10-01" },
  uk: { usd_12m: 10000, gbp_12m_est: 8000, pct: 8.9, status: "ok" },
  eu: { sales_12m: 0, usd_12m: 0, first_sale_at: null, by_country: [] },
  us: { by_state: [] },
  unknown: { sales: 0, usd: 0 },
  by_app: [{ app: "kinolot", usd_12m: 9000 }, { app: "other", usd_12m: 6000 }],
  ...o,
});
await test("A1 the account menu: 'Tax & compliance · admin' right after 'Storage · admin', admin only; it opens the page", () => {
  const mk = (admin) => {
    const ab = box({ cloudConfigured: () => true, cloudUserEmail: () => "admin@infinitestudioai.com", turnIsPaidPlan: paidFn, turnOpenPlans: noop, CREDIT_SCALE: 10,
      turnCreditBalance: { remaining: 10, plan: "none" }, turnTextSpend: () => ({ calls: 0, credits: 0, since: null }) });
    run(ab, "app/plans.jsx"); run(ab, "app/team.jsx"); run(ab, "app/auth-ui.jsx");
    ab.turnIsAdmin = admin; ab.turnOpenAdminStorage = noop; ab.taxOpened = 0; ab.turnOpenAdminTax = () => { ab.taxOpened++; };
    ab.React.reset({ 0: true });
    return [ab, ab.AccountChip({ session: {}, cloudActive: true, saveState: "saved", onSignIn: noop, onSignOut: noop })];
  };
  const [ab, chip] = mk(true);
  const admin = findAll(chip, hasClass("acct-admin")).map(textOf);
  assert.deepEqual(admin, ["Storage · admin", "Tax & compliance · admin"]);
  findAll(chip, hasClass("acct-admin"))[1].props.onClick();
  assert.equal(ab.taxOpened, 1);
  const [, chip2] = mk(false);
  assert.equal(findAll(chip2, hasClass("acct-admin")).length, 0, "nobody else sees it");
});
await test("A2 the page mounts for the admin only, one at a time", () => {
  A.turnIsAdmin = false;
  assert.equal(A.turnOpenAdminTax(), false);
  A.turnIsAdmin = true;
  assert.equal(A.turnOpenAdminTax(), true);
  assert.equal(A.turnOpenAdminTax(), false, "already open");
  assert.equal(A.rendered.filter((x) => x && x.type === A.AdminTaxModal).length, 1);
  A.rendered[A.rendered.length - 1].props.onClose();
  assert.equal(A.turnOpenAdminTax(), true, "reopens after close");
  A.rendered[A.rendered.length - 1].props.onClose();
});
await test("A3 the rate: default 0.80 GBP per USD, cleaned, remembered in this browser", () => {
  assert.equal(L.DEFAULT_RATE, 0.8);
  assert.equal(L.loadRate(), 0.8);
  assert.equal(L.cleanRate("abc"), 0.8); assert.equal(L.cleanRate(-1), 0.8); assert.equal(L.cleanRate(0), 0.8); assert.equal(L.cleanRate(9), 0.8);
  assert.equal(L.cleanRate("0,79"), 0.79);
  assert.equal(L.saveRate("0.85"), 0.85);
  assert.equal(A.localStorage.getItem("turn-admin-tax-rate"), "0.85");
  assert.equal(L.loadRate(), 0.85);
  A.localStorage.removeItem("turn-admin-tax-rate");
});
await test("A4 UK: £ of £90,000 with the warn levels (75% watch, 90% near, 100% over) and the rules in plain English, hedged", () => {
  const at = (gbp) => L.ukView(summary({ uk: { usd_12m: gbp / 0.8, gbp_12m_est: gbp } }), 0.8);
  assert.deepEqual([at(67000), at(67500), at(81000), at(90000)].map((v) => v.status), ["ok", "watch", "near", "over"]);
  const v = at(67500);
  assert.equal(v.value, "£67,500 of £90,000");
  assert.equal(v.sub, "$84,375 at 0.8 GBP per USD · 75%");
  assert.equal(v.tone, "amber");
  assert.match(at(90000).head, /You must register for VAT: tell HMRC within 30 days of the end of the month you went over/);
  assert.equal(at(90000).tone, "alert");
  const all = v.lines.join("\n");
  assert.ok(all.includes("in any rolling 12 months goes over £90,000"));
  assert.ok(all.includes("in the next 30 days alone (the 30-day forward look)"));
  assert.ok(all.includes("Income outside this Stripe account counts too"));
  assert.ok(all.includes("outside the scope of UK VAT"));
  assert.ok(all.includes("Stripe Tax with tax-inclusive prices. The dollar price customers see stays the same and the VAT is carved out of it."));
  // the summary's own status wins (the warning levels live with the thresholds)
  assert.equal(L.ukView(summary({ uk: { usd_12m: 10, gbp_12m_est: 8, status: "near" } }), 0.8).status, "near");
  // no estimate from the server: the page converts at its rate
  assert.equal(L.ukView(summary({ uk: { usd_12m: 1000 } }), 0.5).gbp, 500);
  // payments with no country: the worst case if they were all UK
  const w = L.ukView(summary({ unknown: { sales: 3, usd: 1000 } }), 0.8);
  assert.ok(w.lines.some((l) => l === "If the 3 payments with no country were all UK sales, you'd be at £8,800 (9.8%)."), w.lines.join("|"));
});
await test("A5 EU: an action item before the first sale (non-Union OSS, no threshold); red with the count and amount once there's an EU sale", () => {
  const none = L.euView(summary());
  assert.equal(none.status, "watch"); assert.equal(none.tone, "amber");
  assert.equal(none.head, "You advertise to the EU: register for the non-Union OSS scheme in one EU country before your first EU sale.");
  assert.ok(none.lines.join(" ").includes("there is no threshold for a business outside the EU"));
  assert.ok(none.lines.join(" ").includes("10th day of the following month"));
  const some = L.euView(summary({ eu: { sales_12m: 3, usd_12m: 147, first_sale_at: "2026-11-02T09:00:00Z",
    by_country: [{ country: "fr", sales: 1, usd: 49 }, { country: "DE", sales: 2, usd: 98 }] } }));
  assert.equal(some.status, "over"); assert.equal(some.tone, "alert");
  assert.equal(some.head, "3 EU sales ($147) since 2 Nov 2026: EU VAT is due on them. Register for non-Union OSS now and ask an accountant about the sales already made.");
  assert.deepEqual(JSON.parse(JSON.stringify(some.rows.map((r) => r.country))), ["DE", "FR"]);
});
await test("A6 US: per state against $100,000 or 200 sales, warn at 80%; the hedges (higher states, no tax on digital services)", () => {
  const v = L.usView(summary({ us: { by_state: [{ state: "ca", sales: 10, usd: 1000 }, { state: "TX", sales: 160, usd: 5000 }, { state: "NY", sales: 5, usd: 100000 }] } }));
  assert.deepEqual(JSON.parse(JSON.stringify(v.rows.map((r) => [r.state, r.status]))), [["NY", "over"], ["TX", "near"], ["CA", "ok"]]);
  assert.equal(v.status, "over"); assert.equal(v.tone, "alert");
  assert.equal(v.rows[1].pctTx, 80);
  const lines = v.lines.join(" ");
  assert.ok(lines.includes("$100,000 or 200 sales a year in one state"));
  assert.ok(lines.includes("some are higher (California and Texas: $500,000)"));
  assert.ok(lines.includes("many don't tax digital services or software subscriptions at all"));
  assert.ok(lines.includes("ask an accountant"));
  assert.equal(L.usView(summary()).head, "No US sales yet.");
  assert.equal(L.usView(summary({ us: { by_state: [{ state: "OH", sales: 2, usd: 50 }] } })).head, "No state is near the conservative default.");
});
await test("A7 payments with no country tell the owner to collect billing addresses; by product labels every app on the account", () => {
  const u = L.unknownView(summary({ unknown: { sales: 2, usd: 68 } }));
  assert.equal(u.tone, "amber");
  assert.ok(u.head.startsWith("2 payments ($68) have no country") && u.head.includes("billing-address collection"));
  assert.equal(L.unknownView(summary()).head, "Every payment has a country.");
  assert.deepEqual(JSON.parse(JSON.stringify(L.appRows(summary()).map((r) => [r.label, r.usd]))), [["Kinolot", 9000], ["Other products on this Stripe account", 6000]]);
});
await test("A8 the read: turn_admin_tax_summary(usd_to_gbp); the SQL not run yet → a friendly 'run supabase/tax-compliance.sql' message; not the admin → refused", async () => {
  const calls = [];
  let answer = { data: summary(), error: null };
  A.sbClient = () => ({ rpc: async (n, a) => { calls.push([n, JSON.parse(JSON.stringify(a))]); return answer; } });
  let r = await L.callTaxSummary(0.79);
  assert.equal(r.ok, true); assert.deepEqual(calls[0], ["turn_admin_tax_summary", { usd_to_gbp: 0.79 }]);
  answer = { data: [{ turn_admin_tax_summary: summary() }], error: null };
  r = await L.callTaxSummary(0.8); assert.equal(r.ok, true); assert.equal(r.data.thresholds.uk_gbp, 90000, "a wrapped row reads too");
  answer = { data: null, error: { code: "PGRST202", message: "Could not find the function public.turn_admin_tax_summary(usd_to_gbp)" } };
  r = await L.callTaxSummary(0.8);
  assert.equal(r.error.kind, "missing");
  assert.ok(r.error.message.startsWith("The tax summary isn't set up yet. Run supabase/tax-compliance.sql in the SQL Editor"));
  answer = { data: null, error: { code: "42501", message: "admin only" } };
  r = await L.callTaxSummary(0.8);
  assert.equal(r.error.message, "This page is only for the platform admin account.");
  A.sbClient = undefined;
  assert.equal((await L.callTaxSummary(0.8)).error.kind, "nocloud");
});
const renderModal = async (B, answer) => {
  B.turnIsAdmin = true;
  B.sbClient = () => ({ rpc: async () => answer });
  B.React.reset();
  B.AdminTaxModal({ onClose: noop });
  B.React.effects.forEach((f) => f());
  await settle();
  B.React.calls = 0; B.React.effects = [];
  return deep(B.AdminTaxModal({ onClose: noop }));
};
await test("A9 the page renders the four areas, the hedges, the thresholds' date, the rate field and the checklist", async () => {
  const tree = await renderModal(A, { data: summary({ unknown: { sales: 1, usd: 34 }, rest: { sales_12m: 1, usd_12m: 19, by_country: [{ country: "CA", sales: 1, usd: 19 }] },
    ledger: { rows: 9, recording_since: "2026-10-02T08:00:00Z" } }), error: null });
  const all = textOf(tree);
  for (const s of ["Tax & compliance", "United Kingdom: VAT registration", "European Union: VAT (non-Union OSS)", "United States: sales tax by state",
    "Payments with no country", "By product", "Kinolot", "£8,000 of £90,000", "A guide, not tax advice. Check with an accountant before you act on it.",
    "Prices stay in US dollars.", "Thresholds last checked 1 Oct 2026", "GBP per USD", "Before the first real sale",
    "Your legal name and business address on the Terms and Privacy pages", "Pay the ICO data protection fee",
    "Every payment link collects the billing address and requires accepting the Terms", "Register for the EU non-Union OSS scheme before the first EU sale",
    "When you register for VAT: Stripe Tax with tax-inclusive prices", "Rest of the world", "Recording since 2 Oct 2026"]) assert.ok(all.includes(s), s);
  const rate = findAll(tree, (n) => n.type === "input" && n.props.id === "adm-tax-rate-in")[0];
  assert.equal(rate.props.value, "0.8");
  const checks = findAll(tree, (n) => n.type === "input" && n.props.type === "checkbox");
  assert.equal(checks.length, L.CHECKLIST.length);
  checks[1].props.onChange();
  assert.equal(JSON.parse(A.localStorage.getItem("turn-admin-tax-checklist"))["ico-fee"], true, "ticks are remembered");
});
await test("A10 the SQL not run yet: the page shows the friendly message instead of numbers", async () => {
  const tree = await renderModal(A, { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  const alert = findAll(tree, hasClass("adm-banner"))[0];
  assert.ok(alert && textOf(alert).startsWith("The tax summary isn't set up yet."));
  assert.ok(!textOf(tree).includes("United Kingdom: VAT registration"));
  assert.ok(textOf(tree).includes("Before the first real sale"), "the checklist still shows");
});
await test("A12 the summary's extras: the last 30 days, its own worst case, the first EU sale ever, the rest of the world, other currencies, since when it records", () => {
  const uk = L.ukView(summary({ uk: { usd_12m: 10000, gbp_12m_est: 8000, pct: 8.9, status: "ok", gbp_30d_est: 1200, unknown_gbp_est: 400, pct_with_unknown: 9.3 },
    unknown: { sales: 2, usd: 999 } }), 0.8);
  assert.ok(uk.lines.includes("UK sales in the last 30 days: £1,200. The forward look asks about the NEXT 30 days alone: if you expect more than £90,000 in them, register at once."));
  assert.ok(uk.lines.includes("If the 2 payments with no country were all UK sales, you'd be at £8,400 (9.3%)."), "the summary's own worst case");
  // an EU sale more than 12 months ago: the summary still says "over" (OSS is owed from the first sale)
  const old = L.euView(summary({ eu: { sales_12m: 0, usd_12m: 0, first_sale_at: "2025-03-01T00:00:00Z", status: "over", by_country: [] } }));
  assert.equal(old.tone, "alert");
  assert.equal(old.head, "Your first EU sale was on 1 Mar 2025: EU VAT is due on EU sales. Register for non-Union OSS now and ask an accountant about the sales already made.");
  assert.equal(L.euView(summary({ eu: { sales_12m: 0, usd_12m: 0, first_sale_at: null, status: "watch", by_country: [] } })).tone, "amber");
  assert.equal(L.restView(summary()), null, "no section without sales elsewhere");
  const rest = L.restView(summary({ rest: { sales_12m: 2, usd_12m: 68, by_country: [{ country: "ca", sales: 1, usd: 19 }, { country: "AU", sales: 1, usd: 49 }] } }));
  assert.equal(rest.head, "2 sales ($68) to customers in other countries.");
  assert.deepEqual(JSON.parse(JSON.stringify(rest.rows.map((r) => r.country))), ["AU", "CA"]);
  assert.equal(L.otherCurrencyLine(summary({ other_currencies: [{ currency: "eur", sales: 2, amount_minor: 9800 }] })),
    "2 payments in other currencies (EUR) aren't in the totals above. Prices are in US dollars, so check those in Stripe.");
  assert.equal(L.otherCurrencyLine(summary({ other_currencies: [] })), "");
  assert.equal(L.ledgerLine(summary({ ledger: { rows: 4, first_sale_at: "2026-10-02T00:00:00Z", recording_since: "2026-10-02T08:00:00Z" } })),
    "Recording since 2 Oct 2026; payments before that aren't in the ledger (Stripe's own reports have them).");
  assert.equal(L.ledgerEmpty(summary({ ledger: { rows: 0 } })), true);
  assert.equal(L.ledgerEmpty(summary({ ledger: { rows: 3 } })), false);
  assert.equal(L.classifyError({ code: "22023", message: "KINOLOT_TAX: usd_to_gbp must be above 0 and at most 10 (GBP per USD)" }).message,
    "Couldn't read the tax summary: usd_to_gbp must be above 0 and at most 10 (GBP per USD). Try Refresh.");
});
await test("A13 the warning levels come from the summary too: headlines, meter marks and fallback statuses follow uk_watch_pct / uk_near_pct / us_near_pct", async () => {
  const th = { uk_gbp: 90000, us_usd: 100000, us_tx: 200, checked: "2026-10-01", uk_watch_pct: 70, uk_near_pct: 85, us_near_pct: 60 };
  const at = (gbp) => L.ukView(summary({ thresholds: th, uk: { usd_12m: gbp / 0.8, gbp_12m_est: gbp } }), 0.8);
  assert.deepEqual([at(62000), at(63000), at(76500), at(90000)].map((v) => v.status), ["ok", "watch", "near", "over"]);
  assert.equal(at(63000).head, "Past 70% of the UK VAT threshold. Talk to an accountant about registering now.");
  assert.equal(at(76500).head, "Past 85% of the UK VAT threshold. Get ready to register: an accountant can tell you exactly when.");
  const us = L.usView(summary({ thresholds: th, us: { by_state: [{ state: "TX", sales: 130, usd: 1000 }] } }));
  assert.equal(us.rows[0].status, "near"); assert.equal(us.head, "1 state past 60% of the conservative default. Check those states' rules now.");
  // defaults when the summary has none (or nonsense)
  assert.deepEqual(JSON.parse(JSON.stringify(L.thresholdsOf(summary({ thresholds: { uk_gbp: 90000, uk_watch_pct: "x", uk_near_pct: 120 } })))),
    { ukGbp: 90000, usUsd: 0, usTx: 0, checked: "", ukWatch: 75, ukNear: 90, usNear: 80 });
  const tree = await renderModal(A, { data: summary({ thresholds: th }), error: null });
  const marks = findAll(tree, hasClass("adm-tax-meter-mark")).map((n) => n.props.style.left);
  assert.deepEqual(marks, ["70%", "85%"], "the meter's marks sit at the summary's levels");
});
await test("A14 an empty ledger shows the 'No sales recorded yet' message; a ledger with rows doesn't", async () => {
  let tree = await renderModal(A, { data: summary({ ledger: { rows: 0, recording_since: null } }), error: null });
  let empty = findAll(tree, hasClass("adm-empty"));
  assert.equal(empty.length, 1); assert.equal(textOf(empty[0]), L.MSG.empty);
  tree = await renderModal(A, { data: summary({ ledger: { rows: 4, recording_since: "2026-10-02T08:00:00Z" } }), error: null });
  assert.equal(findAll(tree, hasClass("adm-empty")).length, 0);
});
await test("A15 the rate's Apply saves the rate and reads the summary again with it (the GBP figure follows)", async () => {
  const calls = [];
  A.turnIsAdmin = true;
  A.sbClient = () => ({ rpc: async (n, a) => { calls.push(a.usd_to_gbp); return { data: summary({ uk: { usd_12m: 10000 } }), error: null }; } });
  A.React.reset();
  A.AdminTaxModal({ onClose: noop });
  A.React.effects.forEach((f) => f());
  await settle();
  assert.deepEqual(calls, [0.8], "read once on open");
  A.React.calls = 0; A.React.effects = [];
  let tree = deep(A.AdminTaxModal({ onClose: noop }));
  findAll(tree, (n) => n.type === "input" && n.props.id === "adm-tax-rate-in")[0].props.onChange({ target: { value: "0.9" } });
  A.React.calls = 0; A.React.effects = [];
  tree = deep(A.AdminTaxModal({ onClose: noop }));
  findAll(tree, (n) => n.type === "button" && textOf(n) === "Apply")[0].props.onClick();
  await settle();
  assert.deepEqual(calls, [0.8, 0.9], "Apply calls the summary again with the new rate");
  assert.equal(A.localStorage.getItem("turn-admin-tax-rate"), "0.9");
  A.React.calls = 0; A.React.effects = [];
  tree = deep(A.AdminTaxModal({ onClose: noop }));
  assert.ok(textOf(tree).includes("£9,000 of £90,000"), "the page converts at the new rate");
  A.localStorage.removeItem("turn-admin-tax-rate");
});
await test("A16 review hedges: the UK figure assumes digital services (live services or goods abroad can count); by product says only UK sales count; rest of the world: some countries tax from the first sale; EU records 10 years; the EU withdrawal function and GDPR representative on the checklist", async () => {
  const v = L.ukView(summary(), 0.8);
  assert.ok(v.lines.includes("This assumes every product on the account is a digital service delivered automatically. Sales abroad of live or human-delivered services (calls, coaching, events) or of goods can still count toward the UK threshold: check with an accountant."));
  assert.ok(v.lines.includes("Your other products sold $6,000 in the last 12 months in every country (see By product): if any of that is live services or goods sold abroad, part of it may count too."));
  assert.ok(!L.ukView(summary({ by_app: [{ app: "kinolot", usd_12m: 9000 }] }), 0.8).lines.some((l) => l.startsWith("Your other products sold")));
  const rest = L.restView(summary({ rest: { sales_12m: 1, usd_12m: 19, by_country: [{ country: "IN", sales: 1, usd: 19 }] } }));
  assert.ok(rest.lines[0].includes("some from the first sale (for example India, Saudi Arabia and Türkiye)"));
  assert.ok(L.euView(summary()).lines.some((l) => l.includes("10 years from the end of the year of each sale") && l.includes("two pieces of evidence")));
  const ids = L.CHECKLIST.map((c) => c.id);
  for (const id of ["eu-withdrawal", "eu-gdpr-rep", "records"]) assert.ok(ids.includes(id), id);
  assert.ok(L.CHECKLIST.find((c) => c.id === "records").detail.includes("EU sales under OSS: ten years"));
  const tree = await renderModal(A, { data: summary(), error: null });
  const all = textOf(tree);
  assert.ok(all.includes("Each product's UK sales count toward the UK threshold (the same legal person sells them all). The totals here include every country."));
  assert.ok(!all.includes("Every product on the Stripe account counts toward the UK threshold"));
  assert.ok(all.includes("EU: an online way to cancel a purchase before the first EU sale") && all.includes("EU: appoint a GDPR representative before advertising in the EU"));
});
await test("A11 not listed for users: APP_FEATURES and Frances never mention the admin page", () => {
  const ai = read("app/ai.jsx");
  assert.ok(!/Tax & compliance|turn_admin_tax_summary|admin-tax/.test(ai));
});

/* ════════ F: APP_FEATURES ════════ */
await test("F1 APP_FEATURES states the confirm step, the 14-day right, partial refunds and the dispute hold lifting, and the Terms banner", () => {
  const B = box({ Date, Math, JSON, Promise });
  vm.runInContext(read("app/ai.jsx"), B, { filename: "app/ai.jsx" });
  const feats = vm.runInContext("APP_FEATURES", B);
  const plans = feats.find((f) => f.name === "Plans & subscription (Writer / Director / Producer)");
  for (const s of ["every checkout — a plan or a credit pack, and the plan picked before signing up that opens by itself afterwards — first shows a short 'Before you pay' step",
    "'" + CONSENT + "'", "Cancel closes the step without opening a checkout.",
    "within 14 days of buying a plan or a pack, a customer can cancel by telling Kinolot — for example by writing to kinolot-billing@infinitestudioai.com (writing from the account email helps find the purchase) or with the cancellation form in the Terms — and gets back the unused part",
    "Under the box the step says how to cancel within 14 days (email kinolot-billing@infinitestudioai.com)",
    "a renewal isn't a new purchase", "Prices are in US dollars and include any VAT or sales tax",
    "a partial refund removes the same share of that purchase's credits (rounded up), never more than its unspent credits",
    "when the dispute closes, won or lost, its hold lifts by itself (if another payment is still disputed, the account stays on hold until that one closes too)"]) assert.ok(plans.what.includes(s), s);
  assert.ok(!plans.what.includes("I understand that if I cancel within 14 days"), "the old (v1) wording is gone");
  const terms = feats.find((f) => f.name === "Terms updates (in-app notice)");
  assert.ok(terms && terms.what.includes("'We've updated our Terms and Privacy Policy. Read the Terms and the Privacy Policy.'") && terms.what.includes("30 days"));
  // Frances learns the banner (not billing) but none of the billing detail
  const facts = vm.runInContext("museFacts()", B).map((f) => f.name + ": " + f.what).join("\n");
  assert.ok(facts.includes("We've updated our Terms and Privacy Policy"));
  assert.ok(!facts.includes("Start now: I want to use my credits"), "billing how-to stays out of Frances's facts");
  assert.ok(!/stripe/i.test(terms.what));
});

/* ════════ H: wiring ════════ */
await test("H1 TURN.html: admin-tax.jsx loads after admin-storage.jsx; every changed file is re-keyed 20261001-tax1", () => {
  const html = read("TURN.html");
  const adm = html.indexOf('src="app/admin-storage.jsx?v='), tax = html.indexOf('<script type="text/babel" src="app/admin-tax.jsx?v=20261001-tax1"></script>');
  assert.ok(adm > 0 && tax > adm);
  assert.ok(tax < html.indexOf('src="app/app.jsx?v='));
  for (const f of ["app/plans.jsx", "app/auth-ui.jsx", "app/ai.jsx"]) assert.ok(html.includes('src="' + f + '?v=20261001-tax1"'), f);
  assert.ok(html.includes('href="app/styles.css?v=20261001-tax1"'));
});
await test("H2 CSS: the step sits above the Plans window; the info banner and the tax page have their rules", () => {
  const css = read("app/styles.css");
  const z = (sel) => Number((css.match(new RegExp(sel.replace(/\./g, "\\.") + "\\{[^}]*z-index:(\\d+)")) || [])[1]);
  assert.ok(z(".ns-overlay.checkout-consent-overlay") > z(".ns-overlay"));
  for (const c of [".checkout-consent{", ".checkout-consent-check{", ".checkout-consent-acts{", ".billing-banner.info{", ".adm-tax-sec{", ".adm-tax-table{", ".adm-tax-meter{", ".adm-tax-checks{"])
    assert.ok(css.includes(c), c);
});
await test("H3 brand: the new page's copy says no retired name and names no AI vendor", () => {
  const src = read("app/admin-tax.jsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const lits = [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).join("\n");
  for (const re of [/\bTURN\b/, /cinema[\s_-]?machine/i, /\bMUSE\b/, /Infinite Studio(?! AI)/, /claude|anthropic|mckee|openai|gemini/i]) assert.ok(!re.test(lits), String(re));
});

console.log(failed ? `${checks} passed, ${failed} failed` : `${checks} checks passed`);
process.exit(failed ? 1 : 0);

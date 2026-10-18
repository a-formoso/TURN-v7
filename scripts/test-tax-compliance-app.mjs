#!/usr/bin/env node
/* test-tax-compliance-app.mjs — the APP side of the consumer-rights and tax decisions (owner,
   2026-10-01). Offline: no network, no Stripe, no Supabase, no browser. The real sources are
   transpiled (like the production build) and run in node:vm sandboxes with small fakes.

     C  E1 (owner, 2026-10-02) NO confirm step: the "Before you pay" dialog and its checkbox are
        gone; the 14-day note ("Starts straight away. Cancel within 14 days…" + Terms) goes with
        every plan and pack purchase — since R2 (owner, 2026-10-02) behind an ⓘ button right after
        each plan's and pack's name (the Plans window's plan and pack cards, the homepage's plan
        cards; the purchase button's aria-describedby names the popup; hover / keyboard focus /
        click-tap toggle / Escape / blur / outside click; placed inside the window and its cards) and
        as a line under the chosen plan in the sign-up window; the click records turn_record_checkout_consent(sku,
        'v3-2026-10-02-click') right before the payment page opens with client_reference_id and the
        encoded prefilled_email (E2a); a missing function, an error or a slow answer never blocks it;
        the sign-up auto-checkout shows the note in a notice first (>= 4 s) and records
        'v3-2026-10-02-auto'; the sign-in window keeps the chip and note in "Sign in" while the plan
        waits; until the Terms' cancel section is live the note gives the billing address; signed-out flows are unchanged
        (app/plans.jsx, app/landing.jsx, app/auth-ui.jsx)
     T  D5 the "We've updated our Terms and Privacy Policy" banner: hidden while TERMS_UPDATED_AT is
        "", 30 days from the date, per-user dismissal, links to both pages (app/plans.jsx)
     A  D1 the admin's Tax & compliance page: the menu item next to Storage (admin only), the rate
        (default 0.80, remembered), UK / EU / US / unknown / by-product guidance with the hedges, the
        checklist, the friendly message when the SQL hasn't been run (app/admin-tax.jsx, app/auth-ui.jsx)
     F  APP_FEATURES: the note behind the ⓘ by the plan and pack names (no step), the pre-filled
        account email, the 14-day right and the banner; nothing about the admin page
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

const NOTE = "Starts straight away. Cancel within 14 days and you get back the part you haven't used.";
const OLD_CONSENT = "Start now: I want to use my credits straight away. I understand I lose my right to cancel for credits I use, and if I cancel within 14 days I only get back the part I haven't used.";
const paidFn = (plan) => { const p = String(plan || "").toLowerCase().trim(); return !!p && p !== "none" && p !== "free" && p !== "trial"; };

/* ════════ C: the 14-day note next to every purchase button; the click is the consent (app/plans.jsx) ════════ */
const P = box({ CREDIT_SCALE: 10 });
run(P, "app/plans.jsx");
let rpcCalls = [];
let seq = [];   // the order of the consent record and the page opening
let rpcAnswer = async () => ({ data: null, error: null });
P.sbClient = () => ({ rpc: (name, args) => { seq.push("rpc"); rpcCalls.push([name, JSON.parse(JSON.stringify(args))]); return rpcAnswer(name, args); } });
{ const open = P.open; P.open = (u, t, f) => { seq.push("open"); open(u, t, f); }; }
const renderPlans = (balance, who) => {
  P.turnUserId = who === undefined ? "u-1" : who; P.turnUserEmail = "ana@example.com";
  P.turnCreditBalance = balance || null; P.turnIsPaidPlan = paidFn; P.turnIsAdmin = false; P.usePlansVersion = () => 0;
  P.React.reset();
  return P.PlansModal({ onClose: noop, currentPlan: balance ? balance.plan : null });
};
const reset = (B) => { B.opened.length = 0; B.assigned.length = 0; B.rendered.length = 0; B.toasts.length = 0; rpcCalls = []; seq = []; rpcAnswer = async () => ({ data: null, error: null }); };
/* a card's button and whatever comes right after it (nothing since R2: the note moved behind the ⓘ) */
const btnAndNote = (card) => {
  const kids = card.children.filter((k) => k && typeof k === "object");
  const i = kids.findIndex((k) => k.type === "button");
  return [kids[i], kids[i + 1] || null];
};
const isNote = (n) => !!n && n.type === "p" && hasClass("checkout-note")(n);
/* R2 (owner, 2026-10-02): the note behind an ⓘ right after the plan's or pack's name. A card's name row:
   [the row, the name, the element right after the name] */
const TIP_LABEL = "About starting straight away and cancelling";
const isTip = (n) => !!n && typeof n.type === "function" && n.type.name === "CheckoutTip";
const nameRow = (card, nameClass) => {
  const row = card.children.filter((k) => k && typeof k === "object")
    .find((k) => hasClass("checkout-tip-row")(k));
  assert.ok(row, "the card has a name row");
  const kids = row.children.filter((k) => k && typeof k === "object");
  assert.ok(hasClass(nameClass)(kids[0]), "the name comes first in its row");
  return [row, kids[0], kids[1] || null];
};
/* the rendered ⓘ (one render of the component in its own box, fresh hooks) */
const renderTip = (B, el) => { B.React.reset(); return B.CheckoutTip({ ...el.props }); };
const tipParts = (t) => ({ wrap: t, btn: t.children.find((k) => k && k.type === "button"),
  pop: t.children.find((k) => k && typeof k === "object" && hasClass("checkout-tip-pop")(k)) });
/* the ⓘ right after the name: the popup carries `id`, shows exactly the note (+ Terms, + the address until the
   cancel section is live), stays in the page while closed (hidden) — and the ⓘ is named and controls it */
const assertTip = (B, el, id, cancelLive, extra) => {
  assert.ok(isTip(el), "the ⓘ sits right after the name");
  assert.equal(el.props.id, id);
  if (extra !== undefined) assert.equal(el.props.extra, extra);
  const { wrap, btn, pop } = tipParts(renderTip(B, el));
  assert.ok(hasClass("checkout-tip")(wrap) && (extra ? hasClass(extra)(wrap) : true));
  assert.equal(btn.props.type, "button"); assert.ok(hasClass("checkout-tip-btn")(btn));
  assert.equal(btn.props["aria-label"], TIP_LABEL);
  assert.equal(btn.props["aria-expanded"], "false"); assert.equal(btn.props["aria-controls"], id);
  assert.equal(pop.type, "span"); assert.equal(pop.props.id, id);
  assert.equal(pop.props.hidden, true, "closed, but still in the page for aria-describedby");
  assert.equal(textOf(pop), NOTE + " Terms" + (cancelLive ? "" : HOW_TO_CANCEL));
  const links = findAll(pop, (x) => x.type === "a");
  assert.equal(links[0].props.href, "/terms.html#cancel"); assert.equal(links[0].props.target, "_blank"); assert.equal(links[0].props.rel, "noopener");
  assert.equal(textOf(links[0]), "Terms");
  assert.equal(links.length, cancelLive ? 1 : 2);
  if (!cancelLive) { assert.equal(links[1].props.href, "mailto:kinolot-billing@infinitestudioai.com"); assert.ok(hasClass("checkout-note-mail")(links[1])); }
};
/* until the Terms' cancel section is live (TERMS_UPDATED_AT is "", today) the note also gives the way to cancel */
const HOW_TO_CANCEL = " · To cancel, email kinolot-billing@infinitestudioai.com";
const assertNote = (n, id, cancelLive) => {
  assert.ok(isNote(n), "the note sits right under the button");
  assert.equal(textOf(n), NOTE + " Terms" + (cancelLive ? "" : HOW_TO_CANCEL));
  const links = findAll(n, (x) => x.type === "a"), a = links[0];
  assert.equal(a.props.href, "/terms.html#cancel"); assert.equal(a.props.target, "_blank"); assert.equal(a.props.rel, "noopener");
  assert.equal(textOf(a), "Terms");
  if (cancelLive) assert.equal(links.length, 1, "the Terms' cancel section says how: no address in the note");
  else {
    assert.equal(links.length, 2);
    assert.equal(links[1].props.href, "mailto:kinolot-billing@infinitestudioai.com"); assert.equal(textOf(links[1]), "kinolot-billing@infinitestudioai.com");
    assert.ok(hasClass("checkout-note-mail")(links[1]));
  }
  if (id) assert.equal(n.props.id, id);
};
/* the switch-day packs are what the Plans window sells in a bare harness (no pricing.jsx); give them links */
const withPackLinks = (fn) => {
  const saved = P.CINEMA_CREDIT_PACKS.map((p) => p.test);
  P.CINEMA_CREDIT_PACKS.forEach((p, i) => { p.test = "https://buy.stripe.com/test_pack" + i; });
  try { return fn(); } finally { P.CINEMA_CREDIT_PACKS.forEach((p, i) => { p.test = saved[i]; }); }
};

await test("C1 the exact note, its click-consent version and the skus", () => {
  assert.equal(P.TURN_CHECKOUT_NOTE_TEXT, NOTE);
  assert.equal(P.TURN_CHECKOUT_CONSENT_VERSION, "v3-2026-10-02-click");
  assert.equal(P.TURN_CHECKOUT_CONSENT_VERSION_AUTO, "v3-2026-10-02-auto", "the post-sign-up auto-checkout is recorded as what it is: no click");
  assert.ok(P.TURN_CHECKOUT_CONSENT_VERSION_AUTO.length <= 80, "the SQL takes 1 to 80 characters");
  assert.equal(P.turnCheckoutSku(P.CINEMA_PLANS[2]), "plan-studio", "plan ids are never renamed");
  assert.equal(P.turnCheckoutSku(P.CINEMA_CREDIT_PACKS[0]), "pack-250");
  assert.equal(P.turnCheckoutSku(P.TURN_LEGACY_CREDIT_PACKS[0]), "credits-300");
});
await test("C2 the 'Before you pay' dialog and its checkbox are gone: nothing mounts, no checkbox, no leftover code or CSS", () => {
  reset(P);
  for (const g of ["CheckoutConsentDialog", "turnOpenCheckoutConsent", "turnCloseCheckoutConsent", "turnCheckoutConsentCopy", "turnTrapConsentTab", "turnProceedToCheckout", "TURN_CHECKOUT_CONSENT_TEXT"])
    assert.equal(P[g], undefined, g + " is gone");
  const src = read("app/plans.jsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");   // code, not the history in comments
  for (const s of ["Before you pay", "Continue to payment", "Start now: I want", "type:\"checkbox\"", "checkout-consent"]) assert.ok(!src.includes(s), s);
  assert.ok(!read("app/styles.css").includes(".checkout-consent"), "the dialog's CSS is gone");
  const tree = renderPlans({ remaining: 0, plan: "none" });
  assert.equal(findAll(tree, (n) => n.type === "input").length, 0, "no checkbox in the Plans window");
  findAll(tree, hasClass("plan-cta"))[0].props.onClick();
  assert.equal(P.rendered.length, 0, "a purchase click mounts no step");
  assert.equal(P.opened.length, 1, "it opens the payment page itself");
});
await test("C3 R2: the note sits behind an ⓘ right after every plan's and pack's name (the purchase button's aria-describedby names its popup) and no longer under the button; none for 'Coming soon', 'Current plan' or a subscriber's 'Switch to'", () => {
  reset(P);
  withPackLinks(() => {
    // no plan: three plan buttons and three packs, each with its ⓘ
    let tree = renderPlans({ remaining: 0, plan: "none" });
    const plans = findAll(tree, hasClass("plan-card"));
    assert.equal(plans.length, 3);
    plans.forEach((card, i) => {
      const [btn, after] = btnAndNote(card);
      assert.equal(textOf(btn), "Choose " + P.CINEMA_PLANS[i].name);
      assert.equal(after, null, "nothing under the purchase button any more");
      const [row, name, tip] = nameRow(card, "plan-name");
      assert.ok(hasClass("plan-name-row")(row)); assert.equal(textOf(name), P.CINEMA_PLANS[i].name);
      assertTip(P, tip, "checkout-note-plan-" + P.CINEMA_PLANS[i].tier, P.turnCancelSectionLive());
      assert.equal(btn.props["aria-describedby"], tip.props.id);
    });
    const packs = findAll(tree, hasClass("credit-pack"));
    assert.equal(packs.length, 3);
    packs.forEach((card, i) => {
      const [btn, after] = btnAndNote(card);
      assert.match(textOf(btn), /^Buy /);
      assert.equal(after, null, "nothing under the pack button any more");
      const [row, name, tip] = nameRow(card, "credit-pack-name");
      assert.ok(hasClass("credit-pack-name-row")(row)); assert.equal(textOf(name), P.CINEMA_CREDIT_PACKS[i].name);
      assertTip(P, tip, "checkout-note-" + P.CINEMA_CREDIT_PACKS[i].sku, P.turnCancelSectionLive());
      assert.equal(btn.props["aria-describedby"], tip.props.id);
    });
    assert.equal(findAll(tree, isTip).length, 6, "one ⓘ per purchase button");
    assert.equal(findAll(tree, isNote).length, 0, "no visible note left in the Plans window");
    const ids = findAll(tree, isTip).map((t) => t.props.id);
    assert.equal(new Set(ids).size, 6, "every popup id is unique");
    // a subscriber: 'Current plan' and 'Switch to …' buy nothing here, the packs still do
    tree = renderPlans({ remaining: 300, plan: "director" });
    findAll(tree, hasClass("plan-card")).forEach((card) => {
      const [btn] = btnAndNote(card);
      assert.ok(/^(Current plan|Switch to )/.test(textOf(btn)), textOf(btn));
      const [, , tip] = nameRow(card, "plan-name");
      assert.equal(tip, null, "no ⓘ"); assert.equal(btn.props["aria-describedby"], undefined);
    });
    assert.equal(findAll(tree, isTip).length, 3, "the three packs keep theirs");
    // signed out: the same buttons and ⓘs (the click asks to sign in)
    tree = renderPlans({ remaining: 0, plan: "none" }, null);
    assert.equal(findAll(tree, isTip).length, 6);
  });
  // a pack without a link here reads 'Coming soon' and carries no ⓘ
  const pack = P.CINEMA_CREDIT_PACKS[1], saved = pack.test; pack.test = "";
  try {
    const tree = renderPlans({ remaining: 0, plan: "none" });
    const cards = findAll(tree, hasClass("credit-pack"));
    const [btn1] = btnAndNote(cards[1]);
    assert.equal(textOf(btn1), "Coming soon");
    assert.equal(nameRow(cards[1], "credit-pack-name")[2], null); assert.equal(btn1.props["aria-describedby"], undefined);
    assert.ok(isTip(nameRow(cards[0], "credit-pack-name")[2]) && isTip(nameRow(cards[2], "credit-pack-name")[2]), "the packs on sale keep theirs");
  } finally { pack.test = saved; }
});
await test("C4 a click on 'Choose Director' records consent v3 just before the payment page opens in a new tab (inside the click), with the user id and the encoded account email", async () => {
  reset(P);
  const tree = renderPlans({ remaining: 0, plan: "none" });
  P.turnUserEmail = "ana+kino@example.com";
  findAll(tree, hasClass("plan-cta"))[1].props.onClick();
  assert.equal(P.opened.length, 1, "opened synchronously inside the click (no popup block)");
  assert.equal(P.opened[0], "https://buy.stripe.com/test_00waEZ77eeiD6Ti4j1c7u01?client_reference_id=u-1&prefilled_email=ana%2Bkino%40example.com",
    "the email is URL-encoded: a '+' stays a plus, '@' is %40");
  assert.deepEqual(P.openArgs, ["_blank", "noopener"]);
  assert.deepEqual(rpcCalls, [["turn_record_checkout_consent", { sku: "plan-director", consent_version: "v3-2026-10-02-click" }]]);
  assert.deepEqual(seq, ["rpc", "open"], "the consent is recorded right before the checkout opens");
  assert.equal(P.assigned.length, 0, "this page stays where it is");
  await settle();
});
await test("C5 a pack click records its own sku and opens its link with the user id and email", async () => {
  reset(P);
  await withPackLinks(async () => {
    const tree = renderPlans({ remaining: 0, plan: "none" });
    const [btn] = btnAndNote(findAll(tree, hasClass("credit-pack"))[0]);
    btn.props.onClick();
    assert.equal(P.opened.length, 1);
    assert.equal(P.opened[0], "https://buy.stripe.com/test_pack0?client_reference_id=u-1&prefilled_email=ana%40example.com");
    assert.deepEqual(rpcCalls, [["turn_record_checkout_consent", { sku: "pack-250", consent_version: "v3-2026-10-02-click" }]]);
    await settle();
  });
});
await test("C6 the SQL not run yet (PGRST202 / 42883), a database error, a thrown call or no cloud at all never block the payment page", async () => {
  for (const answer of [async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.turn_record_checkout_consent" } }),
    async () => ({ data: null, error: { code: "42883", message: "function turn_record_checkout_consent(text, text) does not exist" } }),
    async () => ({ data: null, error: { code: "XX000", message: "boom" } }),
    async () => { throw new Error("network down"); },
    () => { throw new Error("sync throw"); }]) {
    reset(P); rpcAnswer = answer;
    P.turnUserId = "u-1"; P.turnUserEmail = "ana@example.com";
    const r = P.turnStartCheckout(P.CINEMA_PLANS[0]);
    assert.equal(P.opened.length, 1, "opened despite a failing record");
    assert.equal(await r, true);
    await settle();
  }
  rpcAnswer = async () => { throw new Error("x"); };
  assert.deepEqual(JSON.parse(JSON.stringify(await P.turnRecordCheckoutConsent("pack-250", "v3-2026-10-02-click"))), { ok: false, reason: "error" });
  rpcAnswer = async () => ({ data: null, error: { code: "PGRST202", message: "x" } });
  assert.equal((await P.turnRecordCheckoutConsent("pack-250", "v3")).reason, "missing");
  const saved = P.sbClient; P.sbClient = undefined;
  try { reset(P); P.turnStartCheckout(P.CINEMA_PLANS[0]); assert.equal(P.opened.length, 1, "no cloud: still opens"); }
  finally { P.sbClient = saved; }
});
await test("C7 the sign-up auto-checkout (sameTab) shows the note in a notice first, records the AUTO version, keeps the notice up long enough to read (>= 4 s, within the notice's 5 s life), then moves THIS tab — even when the record never answers", async () => {
  assert.ok(P.TURN_CHECKOUT_NOTICE_MIN_MS >= 4000, "about 20 words need 4-5 s, not 1.5 s");
  const toastLife = /setTimeout\(close, type==="error" \? 9000 : (\d+)\)/.exec(read("app/ai.jsx"));
  assert.ok(toastLife && P.TURN_CHECKOUT_NOTICE_MIN_MS <= Number(toastLife[1]), "the info notice is still on screen when the tab moves");
  reset(P);
  P.turnUserId = "u-1"; P.turnUserEmail = "ana@example.com";
  let resolveRpc; rpcAnswer = () => new Promise((r) => { resolveRpc = r; });
  const t0 = Date.now();
  const done = P.turnStartCheckout(P.CINEMA_PLANS[1], { sameTab: true });
  assert.equal(P.toasts.length, 1, "the notice shows before the page moves");
  assert.equal(P.toasts[0].m, "Opening the checkout for your Director plan. " + NOTE);
  assert.equal(P.turnAutoCheckoutNotice(P.CINEMA_PLANS[2]), "Opening the checkout for your Producer plan. " + NOTE, "Producer by name (id 'studio')");
  assert.deepEqual(rpcCalls, [["turn_record_checkout_consent", { sku: "plan-director", consent_version: "v3-2026-10-02-auto" }]]);
  resolveRpc({ data: null, error: null });
  await settle();
  assert.equal(P.assigned.length + P.opened.length, 0, "a quick record still leaves the notice on screen for a moment");
  assert.equal(await done, true);
  assert.ok(Date.now() - t0 >= P.TURN_CHECKOUT_NOTICE_MIN_MS - 100, "the notice had its time on screen");
  assert.equal(P.assigned.length, 1); assert.equal(P.opened.length, 0);
  assert.equal(P.assigned[0], "https://buy.stripe.com/test_00waEZ77eeiD6Ti4j1c7u01?client_reference_id=u-1&prefilled_email=ana%40example.com");
  // a record that hangs: the page still opens after the short wait
  reset(P); rpcAnswer = () => new Promise(() => {});
  const t1 = Date.now();
  await P.turnStartCheckout(P.CINEMA_PLANS[1], { sameTab: true });
  assert.equal(P.assigned.length, 1, "opened after the wait");
  assert.ok(Date.now() - t1 >= 2000, "it waited for the record first");
  // a failing record: opens too
  reset(P); rpcAnswer = async () => ({ data: null, error: { code: "PGRST202", message: "missing" } });
  await P.turnStartCheckout(P.CINEMA_PLANS[0], { sameTab: true });
  assert.equal(P.assigned.length, 1);
});
await test("C8 signed out: no record, nothing opens, the old sentence and the sign-in event; no payment link here: the old sentence", () => {
  reset(P);
  const tree = renderPlans({ remaining: 0, plan: "none" }, null);
  findAll(tree, hasClass("plan-cta"))[0].props.onClick();
  P.turnStartCheckout(P.CINEMA_PLANS[1], { sameTab: true });
  assert.equal(P.opened.length + P.assigned.length + rpcCalls.length, 0);
  assert.equal(P.toasts.length, 2);
  assert.ok(P.toasts.every((t) => t.m === "Sign in first — purchases are tied to your account."));
  assert.ok(P.events.filter((e) => e.type === "turn-need-signin").length >= 2);
  reset(P); P.turnUserId = "u-1";
  const pack = P.CINEMA_CREDIT_PACKS[1], saved = pack.test; pack.test = "";
  try { P.turnStartCheckout(pack); } finally { pack.test = saved; }
  assert.equal(P.opened.length + rpcCalls.length, 0); assert.equal(P.toasts[0].m, "Checkout isn't available yet — please try again shortly.");
});
await test("C9 no account email (an old session): the link carries the user id alone", () => {
  reset(P);
  P.turnUserId = "u-1"; P.turnUserEmail = "";
  P.turnStartCheckout(P.CINEMA_PLANS[0]);
  assert.equal(P.opened[0], "https://buy.stripe.com/test_8x24gB63afmHgtS3eXc7u00?client_reference_id=u-1");
  assert.equal(P.turnCheckoutUrl({ test: "https://buy.stripe.com/test_x?locale=en" }, "u 1", "A@B.com"),
    "https://buy.stripe.com/test_x?locale=en&client_reference_id=u%201&prefilled_email=A%40B.com", "an existing query string gets '&'");
  P.turnUserEmail = "ana@example.com";
});
await test("C10 every path to a payment page goes through startCheckout (window.open / location.assign live there alone); app.jsx's sign-up path calls it with sameTab", () => {
  const src = read("app/plans.jsx");
  const body = (name) => { const a = src.indexOf("function " + name + "("); const b = src.indexOf("\nwindow.", a); return src.slice(a, b); };
  const opens = [...src.matchAll(/window\.open\(url|location\.assign\(url/g)].length;
  const inStart = [...body("startCheckout").matchAll(/window\.open\(url|location\.assign\(url/g)].length;
  assert.ok(opens >= 2); assert.equal(opens, inStart, "no other opener in plans.jsx");
  assert.ok(body("startCheckout").includes("recordCheckoutConsent(checkoutSku(plan), auto ? CHECKOUT_CONSENT_VERSION_AUTO : CHECKOUT_CONSENT_VERSION)"));
  assert.ok(body("startCheckout").includes("const auto = !!(opts && opts.sameTab);"));
  const app = read("app/app.jsx");
  assert.ok(app.includes("window.turnStartCheckout(planObj, { sameTab:true })"));
  assert.ok(!/buy\.stripe\.com/.test(app));
});
await test("C11 the note's and the notice's copy name no vendor and no retired name", () => {
  const src = read("app/plans.jsx");
  const a = src.indexOf("const CHECKOUT_NOTE_TEXT"), b = src.indexOf("window.turnStartCheckout");
  const lits = [...src.slice(a, b).matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).join("\n");
  assert.ok(lits.includes(NOTE));
  assert.ok(!/claude|anthropic|mckee|cinema machine/i.test(lits) && !/\bTURN\b/.test(lits) && !/stripe/i.test(lits.replace(/turn_record_checkout_consent/g, "")), lits);
});
await test("C12 the homepage's plan cards carry the ⓘ right after the plan's name (R2; they lead to checkout after sign-up), nothing under the button; the sign-in window shows the line under the chosen plan — creating the account, and in 'Sign in' while that plan is still waiting", () => {
  const L = box({ CREDIT_SCALE: 10, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), requestAnimationFrame: () => 0, cancelAnimationFrame: noop });
  run(L, "app/plans.jsx"); run(L, "app/landing.jsx");
  L.usePlansVersion = () => 0; L.React.reset();
  const page = L.Landing({ onStart: noop, onSignIn: noop });
  const tiers = findAll(page, hasClass("lp-tier"));
  assert.equal(tiers.length, 3);
  tiers.forEach((card, i) => {
    const [btn, after] = btnAndNote(card);
    assert.equal(textOf(btn), "Choose " + L.CINEMA_PLANS[i].name);
    assert.equal(after, null, "nothing under the button any more");
    const [row, name, tip] = nameRow(card, "lp-tier-name");
    assert.ok(hasClass("lp-tier-name-row")(row)); assert.equal(textOf(name), L.CINEMA_PLANS[i].name);
    assertTip(L, tip, "lp-checkout-note-" + L.CINEMA_PLANS[i].tier, L.turnCancelSectionLive(), "lp-checkout-tip");
    assert.equal(btn.props["aria-describedby"], tip.props.id);
  });
  // the closing "Create a free account" buys nothing: no ⓘ there; no visible note left on the page
  L.React.reset();
  const rendered = deep(L.Landing({ onStart: noop, onSignIn: noop }));
  assert.equal(findAll(rendered, hasClass("checkout-tip")).length, 3);
  assert.equal(findAll(rendered, isNote).length, 0);
  assert.equal(findAll(rendered, hasClass("lp-checkout-note")).length, 0);
  const A = box({ CREDIT_SCALE: 10, cloudConfigured: () => true });
  run(A, "app/plans.jsx"); run(A, "app/auth-ui.jsx");
  // the sign-up window (owner requests 2026-10-02): the 14-day note is the ⓘ at the START of the plan
  // chip (where the sparkle was), not a visible line; the plan name is a dropdown of the three plans
  const authTip = (m) => { const chip = findAll(m, hasClass("auth-plan"))[0];
    const kids = chip ? chip.children.filter((k) => k && typeof k === "object") : [];
    return { chip: chip ? 0 : -1, tip: kids.find(isTip), kids }; };
  for (const light of [true, false]) {
    A.React.reset();
    const picked = [];
    let m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signup", plan: "director", light, onPlanChange: (t) => picked.push(t) });
    let t = authTip(m);
    assert.ok(t.chip === 0 && t.kids[0] === t.tip, "the ⓘ is the chip's first item");
    assert.equal(findAll(m, (n) => n && typeof n.type === "function" && n.type.name === "sparkles").length, 0, "no sparkle");
    assertTip(A, t.tip, "auth-checkout-note", A.turnCancelSectionLive(), "auth-checkout-tip");
    assert.equal(findAll(m, isNote).length, 0, "no visible note line");
    assert.equal(findAll(m, hasClass("auth-submit"))[0].props["aria-describedby"], "auth-checkout-note");
    assert.equal(textOf(findAll(m, hasClass("auth-plan-note"))[0]), "checkout opens after signup");
    // the dropdown: the three plans, the current one selected, a pick goes to onPlanChange
    const sel = findAll(m, hasClass("auth-plan-sel"))[0];
    assert.equal(sel.props.value, "director");
    assert.deepEqual(sel.children.flat().filter((o) => o && o.type === "option").map((o) => o.props.value), ["free", "writer", "director", "studio"], "No plan yet, then the three plans");
    sel.props.onChange({ target: { value: "studio" } });
    assert.deepEqual(picked, ["studio"]);
    assert.equal(textOf(findAll(m, hasClass("auth-plan-cur"))[0]), "Director plan · $49/mo");
    // without onPlanChange the plan stays plain text
    A.React.reset();
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signup", plan: "director", light });
    assert.equal(findAll(m, hasClass("auth-plan-sel")).length, 0);
    // "Sign in" (after "Check your email to confirm, then sign in", or a switch): while the plan picked
    // before sign-up still waits in this browser, its checkout opens by itself after signing in — so the
    // chip and its ⓘ stay (review 2026-10-02)
    A.localStorage.setItem("turn-intended-plan", "director"); A.localStorage.setItem("turn-intended-plan-at", String(Date.now() - 5 * 60000));
    A.React.reset();
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signin", plan: "director", light });
    t = authTip(m);
    assert.ok(t.chip >= 0, "sign-in with a waiting plan: the chip shows");
    assertTip(A, t.tip, "auth-checkout-note", A.turnCancelSectionLive(), "auth-checkout-tip");
    assert.equal(textOf(findAll(m, hasClass("auth-plan-note"))[0]), "checkout opens after sign-in");
    // the mode switched inside the window (signup -> signin) keeps them too
    A.React.reset({ 0: "signin" });
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signup", plan: "director", light });
    assert.equal(findAll(m, hasClass("auth-title"))[0].children[0], "Sign in");
    assert.equal(findAll(m, isTip).length, 1, "switched to Sign in: the ⓘ stays");
    // a stale copy from an earlier visit (over 20 minutes) promises nothing in "Sign in"
    A.localStorage.setItem("turn-intended-plan-at", String(Date.now() - 21 * 60000));
    A.React.reset();
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signin", plan: "director", light });
    assert.equal(findAll(m, isTip).length + findAll(m, hasClass("auth-plan")).length, 0, "sign-in, stale plan: no chip, no note");
    A.localStorage.removeItem("turn-intended-plan"); A.localStorage.removeItem("turn-intended-plan-at");
    A.React.reset();
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signin", plan: "director", light });
    assert.equal(findAll(m, isTip).length, 0, "sign-in, nothing waiting: no chip, no note");
    A.React.reset();
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signup", plan: null, light });
    assert.equal(findAll(m, isTip).length + findAll(m, isNote).length, 0, "no plan picked: no note");
    // "Sign in → Create one" (owner 2026-10-03): Create account always offers the choice — No plan yet
    // (no checkout, so no ⓘ) or a plan
    A.React.reset();
    const picks = [];
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signup", plan: null, light, onPlanChange: (x) => picks.push(x) });
    const free = findAll(m, hasClass("auth-plan-sel"))[0];
    assert.equal(free.props.value, "free");
    assert.match(textOf(findAll(m, hasClass("auth-plan-cur"))[0]), /^No plan yet/);
    assert.equal(textOf(findAll(m, hasClass("auth-plan-note"))[0]), "choose a plan any time");
    assert.equal(findAll(m, isTip).length, 0, "no plan, no purchase: no ⓘ");
    assert.equal(findAll(m, hasClass("auth-submit"))[0].props["aria-describedby"], undefined);
    free.props.onChange({ target: { value: "director" } });
    assert.deepEqual(picks, ["director"]);
    // Sign in with nothing waiting still shows no picker
    A.React.reset();
    m = A.AuthModal({ onClose: noop, onAuthed: noop, initialMode: "signin", plan: null, light, onPlanChange: noop });
    assert.equal(findAll(m, hasClass("auth-plan")).length, 0);
  }
});

await test("C13 the note gives the billing address until the Terms' cancel section is live (TERMS_UPDATED_AT set on the switch day); a bad date keeps it", () => {
  assert.equal(P.turnCancelSectionLive(), true, "since the switch (2026-10-02) the Terms' cancel section is live");
  for (const [at, live] of [["2026-11-14", true], ["", false], ["not a date", false], ["  ", false]]) {
    const B = box({ CREDIT_SCALE: 10 });
    run(B, "app/plans.jsx", read("app/plans.jsx").replace(/const TERMS_UPDATED_AT = "[^"]*";/, "const TERMS_UPDATED_AT = " + JSON.stringify(at) + ";"));
    assert.equal(B.turnCancelSectionLive(), live, JSON.stringify(at));
    assertNote(B.turnCheckoutNote("x"), "x", live);
  }
});

await test("C14 the ⓘ opens on hover (a mouse, not a touch) and on keyboard focus (not a click's focus), toggles on click / tap, closes on Escape (the key stops there; focus goes back to the ⓘ from the link), on blur out of it and on an outside click; focus inside keeps it open", () => {
  const B = box({ CREDIT_SCALE: 10 });
  run(B, "app/plans.jsx");
  // persistent refs (the stub's are fresh per render) and the document listeners the open popup adds
  let refs = [], ri = 0;
  B.React.useRef = (v) => { const i = ri++; if (!refs[i]) refs[i] = { current: v === undefined ? null : v }; return refs[i]; };
  const docL = {};
  B.document.addEventListener = (t, f) => { (docL[t] = docL[t] || []).push(f); };
  B.document.removeEventListener = (t, f) => { docL[t] = (docL[t] || []).filter((x) => x !== f); };
  const link = { id: "terms-link" }, outside = { id: "elsewhere" };
  let focusedBtn = 0, t;
  const mount = () => {
    refs = []; ri = 0; B.React.reset(); Object.keys(docL).forEach((k) => delete docL[k]);
    t = render();
    refs[0].current = { contains: (n) => n === link || n === refs[1].current || n === refs[2].current };   // the wrapper
    refs[1].current = { focus(){ focusedBtn++; t.props.onFocus({ target: { matches: () => true } }); } };    // the ⓘ
    refs[2].current = { contains: (n) => n === link };                                                       // the popup
  };
  const render = () => {
    ri = 0; B.React.calls = 0; B.React.effects.length = 0;
    t = B.CheckoutTip({ id: "checkout-note-plan-writer" });
    // run the effects like a commit: drop the previous listeners first
    Object.keys(docL).forEach((k) => delete docL[k]);
    B.React.effects.forEach((f) => f());
    return t;
  };
  const isOpen = () => { const { wrap, btn, pop } = tipParts(t); const o = pop.props.hidden === false;
    assert.equal(btn.props["aria-expanded"], o ? "true" : "false"); assert.equal(hasClass("open")(wrap), o); return o; };
  const kb = { target: { matches: (q) => q === ":focus-visible" } }, pointerFocus = { target: { matches: () => false } };
  const act = (f) => { f(t); render(); };

  mount();
  assert.equal(isOpen(), false, "closed at first");
  assert.equal((docL.pointerdown || []).length + (docL.keydown || []).length, 0, "no document listeners while closed");
  // hover: a mouse opens it, a touch's pointerenter doesn't
  act((x) => x.props.onPointerEnter({ pointerType: "touch" })); assert.equal(isOpen(), false, "a touch is not a hover");
  act((x) => x.props.onPointerEnter({ pointerType: "mouse" })); assert.equal(isOpen(), true, "hover opens");
  assert.equal(docL.pointerdown.length, 1); assert.equal(docL.keydown.length, 1);
  act((x) => x.props.onPointerLeave({ pointerType: "mouse" })); assert.equal(isOpen(), false, "leaving closes");
  // Escape on the page closes a hover-opened popup without moving the pointer
  act((x) => x.props.onPointerEnter({ pointerType: "mouse" }));
  docL.keydown[0]({ key: "Escape" }); render(); assert.equal(isOpen(), false, "Escape anywhere closes it");
  // keyboard focus opens; the focus a click or a tap gives doesn't
  mount();
  act((x) => x.props.onFocus(pointerFocus)); assert.equal(isOpen(), false, "a click's focus is not a keyboard focus");
  act((x) => x.props.onFocus(kb)); assert.equal(isOpen(), true, "keyboard focus opens");
  act((x) => x.props.onBlur({ relatedTarget: link })); assert.equal(isOpen(), true, "Tab to the Terms link keeps it open (focus-within)");
  act((x) => x.props.onFocus(kb)); assert.equal(isOpen(), true);
  act((x) => x.props.onBlur({ relatedTarget: outside })); assert.equal(isOpen(), false, "focus leaving closes it");
  act((x) => x.props.onFocus(kb));
  act((x) => x.props.onBlur({ relatedTarget: null })); assert.equal(isOpen(), false, "focus leaving the page closes it");
  // Escape with focus on the link: closed, the key stops there, focus back on the ⓘ without reopening
  act((x) => x.props.onFocus(kb));
  B.document.activeElement = link;
  let stopped = 0;
  act((x) => x.props.onKeyDown({ key: "Escape", stopPropagation(){ stopped++; } }));
  assert.equal(isOpen(), false, "Escape closes"); assert.equal(stopped, 1, "only the popup closes, not a window around it");
  assert.equal(focusedBtn, 1, "focus goes back to the ⓘ"); 
  act((x) => x.props.onKeyDown({ key: "Escape", stopPropagation(){ stopped++; } }));
  assert.equal(stopped, 1, "a closed popup lets Escape through");
  B.document.activeElement = null;
  // keyboard: focus opened it, Enter (a click) closes it, Enter again opens it
  mount();
  act((x) => x.props.onFocus(kb));
  act((x) => tipParts(x).btn.props.onClick()); assert.equal(isOpen(), false, "Enter on the focused ⓘ closes it");
  act((x) => tipParts(x).btn.props.onClick()); assert.equal(isOpen(), true, "…and opens it again");
  // a tap toggles it; a tap outside closes it
  mount();
  act((x) => x.props.onPointerEnter({ pointerType: "touch" })); act((x) => x.props.onFocus(pointerFocus));
  act((x) => tipParts(x).btn.props.onClick()); assert.equal(isOpen(), true, "a tap opens it");
  act((x) => tipParts(x).btn.props.onClick()); assert.equal(isOpen(), false, "a second tap closes it");
  act((x) => tipParts(x).btn.props.onClick()); assert.equal(isOpen(), true);
  docL.pointerdown[0]({ target: link }); render(); assert.equal(isOpen(), true, "a tap inside (the link) keeps it");
  docL.pointerdown[0]({ target: outside }); render(); assert.equal(isOpen(), false, "a tap outside closes it");
  // a mouse: hover shows it, a click keeps it open after the pointer leaves, a second click closes it
  mount();
  act((x) => x.props.onPointerEnter({ pointerType: "mouse" }));
  act((x) => tipParts(x).btn.props.onClick()); act((x) => x.props.onPointerLeave({ pointerType: "mouse" }));
  assert.equal(isOpen(), true, "clicked open: stays after the pointer leaves");
  act((x) => tipParts(x).btn.props.onClick()); assert.equal(isOpen(), false, "a second click closes it");
  act((x) => tipParts(x).btn.props.onClick());
  act((x) => x.props.onBlur({ relatedTarget: outside })); assert.equal(isOpen(), false, "a clicked-open popup closes when focus leaves");
  // the id is the purchase button's aria-describedby target; without one the popup still gets its own
  refs = []; ri = 0; B.React.reset();
  const a = tipParts(B.CheckoutTip({})).pop.props.id;
  refs = []; ri = 0; B.React.reset();
  const b2 = tipParts(B.CheckoutTip({})).pop.props.id;
  assert.ok(/^checkout-tip-\d+$/.test(a) && a !== b2, "auto ids are unique");
});
await test("C15 the popup stays inside the window and whatever clips it (centred under the ⓘ, nudged sideways, flipped up when there is no room below), placed again as the page scrolls or the window resizes", () => {
  const B = box({ CREDIT_SCALE: 10, innerWidth: 375, innerHeight: 812 });
  run(B, "app/plans.jsx");
  B.getComputedStyle = (n) => n.cs || { overflowX: "visible", overflowY: "visible" };
  const mkPop = (rect) => { const st = new Map(), at = new Map();
    return { rect, getBoundingClientRect(){ return this.rect; }, style: { setProperty: (k, v) => st.set(k, v) }, st,
      setAttribute: (k, v) => at.set(k, v), removeAttribute: (k) => at.delete(k), at }; };
  const box2 = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });
  // the landing on a 375px phone: .landing scrolls (clips) at the viewport; the ⓘ near the left edge of a card
  const landing = { cs: { overflowX: "hidden", overflowY: "auto" }, getBoundingClientRect: () => box2(0, 0, 375, 812), parentElement: B.document.body };
  const card = { parentElement: landing };
  const wrap = { parentElement: card, getBoundingClientRect: () => box2(90, 300, 24, 24) };
  let pop = mkPop(box2(90 + 12 - 136, 333, 272, 110));   // centred under the ⓘ: starts at -34
  B.turnPlaceCheckoutTip(wrap, pop);
  assert.equal(pop.st.get("--tip-dx"), "42px", "nudged right to 8px from the edge");
  assert.equal(pop.at.has("data-place"), false, "room below: stays under the ⓘ");
  // near the right edge
  pop = mkPop(box2(340 + 12 - 136, 333, 272, 110));
  B.turnPlaceCheckoutTip({ parentElement: card, getBoundingClientRect: () => box2(340, 300, 24, 24) }, pop);
  assert.equal(pop.st.get("--tip-dx"), "-121px", "nudged left to 8px from the edge");
  // a centred ⓘ needs nothing
  pop = mkPop(box2(175 + 12 - 136, 333, 272, 110));
  B.turnPlaceCheckoutTip({ parentElement: card, getBoundingClientRect: () => box2(175, 300, 24, 24) }, pop);
  assert.equal(pop.st.get("--tip-dx"), "0px");
  // the Plans window (a scroll box) cut short: no room under the ⓘ, room above -> flips up
  const modal = { cs: { overflowX: "auto", overflowY: "auto" }, getBoundingClientRect: () => box2(20, 40, 335, 600), parentElement: B.document.body };
  pop = mkPop(box2(175 + 12 - 136, 600, 272, 110));
  B.turnPlaceCheckoutTip({ parentElement: { parentElement: modal }, getBoundingClientRect: () => box2(175, 567, 24, 24) }, pop);
  assert.equal(pop.at.get("data-place"), "up", "flipped above the ⓘ");
  // …but not when there is no room above either
  pop = mkPop(box2(175 + 12 - 136, 120, 272, 600));
  B.turnPlaceCheckoutTip({ parentElement: { parentElement: modal }, getBoundingClientRect: () => box2(175, 90, 24, 24) }, pop);
  assert.equal(pop.at.has("data-place"), false);
  // review 2026-10-02: placed again on every scroll (capture: any scroll box; once a frame) and resize while open — keyboard
  // focus opens it while the homepage is still smooth-scrolling the ⓘ into view, so the first choice is made off-screen
  const wl = [], frames = [];
  B.addEventListener = (t, f, o) => wl.push([t, f, o]);
  B.removeEventListener = (t, f, o) => { const i = wl.findIndex((x) => x[0] === t && x[1] === f && !!x[2] === !!o); if (i >= 0) wl.splice(i, 1); };
  B.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  let cancelled = 0; B.cancelAnimationFrame = () => { cancelled++; };
  let placed = 0;
  const stop = B.turnWatchCheckoutTip(() => { placed++; });
  const scroll = wl.find((x) => x[0] === "scroll"), resize = wl.find((x) => x[0] === "resize");
  assert.ok(scroll && scroll[2] === true, "a capture scroll listener (sees the .landing scroller and the Plans window)");
  assert.ok(resize, "and a resize listener");
  scroll[1](); scroll[1](); scroll[1]();
  assert.equal(placed, 0); assert.equal(frames.length, 1, "three scroll events in one frame: one placement queued");
  frames.shift()(); assert.equal(placed, 1, "placed on the next frame");
  scroll[1](); frames.shift()(); assert.equal(placed, 2, "and again on the next scroll");
  resize[1](); assert.equal(placed, 3);
  scroll[1](); stop();
  assert.equal(wl.length, 0, "closing removes both listeners"); assert.equal(cancelled, 1, "and the queued frame");
  delete B.requestAnimationFrame; delete B.cancelAnimationFrame;
  const stop2 = B.turnWatchCheckoutTip(() => { placed++; });
  wl.find((x) => x[0] === "scroll")[1](); assert.equal(placed, 4, "no requestAnimationFrame: placed at once"); stop2();
  // …and the open popup uses it (the layout effect)
  const layout = []; B.React.useLayoutEffect = (f) => layout.push(f);
  B.React.reset({ 0: true });   // hovered: open
  B.CheckoutTip({ id: "x" });
  assert.equal(layout.length, 1);
  const undo = layout[0]();
  assert.ok(wl.some((x) => x[0] === "scroll" && x[2] === true), "the open popup follows scrolling");
  undo(); assert.equal(wl.length, 0);
  layout.length = 0; B.React.reset();   // closed: no listeners
  B.CheckoutTip({ id: "x" }); assert.equal(layout[0](), undefined); assert.equal(wl.length, 0);
  B.React.useLayoutEffect = () => {};
  const src = read("app/plans.jsx");
  assert.ok(/place\(\);\s*return watchCheckoutTip\(place\);\s*\},\[show\]\);/.test(src), "CheckoutTip's layout effect: place, then follow");
  // the popup's CSS: a fixed width that never passes the screen, centred with the nudge, hidden while closed, reduced motion
  const css = read("app/styles.css");
  assert.ok(css.includes(".checkout-tip-pop{position:absolute;top:calc(100% + 9px);left:50%;z-index:30;display:block;box-sizing:border-box;\n  width:272px;max-width:calc(100vw - 32px);transform:translateX(calc(-50% + var(--tip-dx, 0px)));"));
  assert.ok(css.includes(".checkout-tip-pop[hidden]{display:none}"));
  assert.ok(css.includes('.checkout-tip-pop[data-place="up"]{top:auto;bottom:calc(100% + 9px)}'));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\{\s*\.checkout-tip-pop\{animation:none\}/.test(css), "reduced motion: no fade");
});

/* ════════ T: the Terms-updated banner (app/plans.jsx) ════════ */
await test("T1 TERMS_UPDATED_AT is the ONE constant; set to the Terms' date (the switch day 2026-10-02, then the Shared films update 2026-10-03); empty would hide the banner", () => {
  const src = read("app/plans.jsx");
  assert.equal((src.match(/const TERMS_UPDATED_AT = /g) || []).length, 1);
  assert.ok(src.includes('const TERMS_UPDATED_AT = "2026-10-03";'), "the latest update's date (Shared films)");
  assert.equal(P.TURN_TERMS_UPDATED_AT, "2026-10-03");
  // (2026-10-18) both pages moved to 18 October 2026 with the Import a screenplay lines (test-rebrand-shell)
  assert.ok(read("terms.html").includes("Last updated: 18 October 2026") && read("privacy.html").includes("Last updated: 18 October 2026"), "the same date as the pages");
  const E = box({ CREDIT_SCALE: 10 });
  run(E, "app/plans.jsx", src.replace(/const TERMS_UPDATED_AT = "[^"]*";/, 'const TERMS_UPDATED_AT = "";'));
  E.turnUserId = "u-1"; E.turnIsAdmin = false; E.React.reset();
  assert.equal(E.BillingNotices({ balance: { remaining: 1500, plan: "director", planRemaining: 1500, packRemaining: 0 } }), null, "nothing shows while it's empty");
  for (const f of ["app/app.jsx", "app/home-dashboard.jsx", "app/auth-ui.jsx", "app/ai.jsx"]) assert.ok(!read(f).includes("TERMS_UPDATED_AT ="), f + " doesn't define its own");
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
  run(B, "app/plans.jsx", read("app/plans.jsx").replace(/const TERMS_UPDATED_AT = "[^"]*";/, 'const TERMS_UPDATED_AT = "2026-10-31";'));
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
await test("F1 APP_FEATURES states the note behind the ⓘ by every plan's and pack's name (no step; R2), the pre-filled account email, the 14-day right, partial refunds, the dispute hold lifting and the Terms banner", () => {
  const B = box({ Date, Math, JSON, Promise });
  vm.runInContext(read("app/ai.jsx"), B, { filename: "app/ai.jsx" });
  const feats = vm.runInContext("APP_FEATURES", B);
  const plans = feats.find((f) => f.name === "Plans & subscription (Writer / Director / Producer)");
  for (const s of ["BEFORE PAYING (owner decision 2026-10-02): there is no extra step and nothing to tick before paying.",
    "A short line goes with every plan and pack button: '" + NOTE + "', followed by a 'Terms' link to the Terms' section on cancelling",
    "until the updated Terms are published, the line also says 'To cancel, email kinolot-billing@infinitestudioai.com'.",
    "In the plans window (every plan and pack that can be bought) and on the homepage's plan cards it sits behind a small info button (ⓘ) right after the plan's or pack's name:",
    "it opens when the pointer rests on the ⓘ or the ⓘ is reached with the keyboard (Tab then reaches the 'Terms' link), a click or tap opens or closes it, and Escape, a click or tap elsewhere or moving on with the keyboard closes it",
    "screen readers also read the line with the plan's or pack's button. In the sign-up window it is behind the ⓘ just to the right of the chosen plan.",
    "don't open a payment page, so they carry no such line (and no ⓘ).",
    "The sign-in window keeps showing the chosen plan and its ⓘ when it is switched to 'Sign in' (for example after 'Check your email to confirm, then sign in') while the plan is still waiting; the chip then reads 'checkout opens after sign-in'.",
    "Choosing a plan or a pack is the request to start straight away, and the secure payment page opens at once.",
    "The plan picked before signing up opens its payment page by itself once the account is ready, after a notice of about four and a half seconds that says the same: 'Opening the checkout for your <plan> plan. " + NOTE + "'",
    "the payment page opens with the account's email already filled in.",
    "the billing email on file is changed to the account's email once the payment goes through, as long as the account's email is confirmed",
    "credits always go to the account the checkout was opened from, whatever email the payment page shows.",
    "within 14 days of buying a plan or a pack, a customer can cancel by telling Kinolot — for example by writing to kinolot-billing@infinitestudioai.com (writing from the account email helps find the purchase) or with the cancellation form in the Terms — and gets back the unused part",
    "a renewal isn't a new purchase", "Prices are in US dollars and include any VAT or sales tax",
    "a partial refund removes the same share of that purchase's credits (rounded up), never more than its unspent credits",
    "when the dispute closes, won or lost, its hold lifts by itself (if another payment is still disputed, the account stays on hold until that one closes too)"]) assert.ok(plans.what.includes(s), s);
  for (const gone of ["Before you pay", "Continue to payment", OLD_CONSENT, "checkbox", "Cancel closes the step", "I understand that if I cancel within 14 days", "sits right under every plan and pack button"])
    assert.ok(!plans.what.includes(gone), "the old step is gone from the facts: " + gone);
  const terms = feats.find((f) => f.name === "Terms updates (in-app notice)");
  assert.ok(terms && terms.what.includes("'We've updated our Terms and Privacy Policy. Read the Terms and the Privacy Policy.'") && terms.what.includes("30 days"));
  // Frances learns the banner (not billing) but none of the billing detail
  const facts = vm.runInContext("museFacts()", B).map((f) => f.name + ": " + f.what).join("\n");
  assert.ok(facts.includes("We've updated our Terms and Privacy Policy"));
  assert.ok(!facts.includes("Starts straight away") && !facts.includes("prefilled") && !facts.includes("billing email on file"), "billing how-to stays out of Frances's facts");
  assert.ok(!/stripe/i.test(terms.what));
});

/* ════════ H: wiring ════════ */
await test("H1 TURN.html: admin-tax.jsx loads after admin-storage.jsx; the files the R2 tooltip / R1 landing line touched are re-keyed 20261002-tip1 (script.jsx shares ai.jsx's key), auth-ui.jsx keeps 20261002-consent1", () => {
  const html = read("TURN.html");
  const adm = html.indexOf('src="app/admin-storage.jsx?v='), tax = html.indexOf('<script type="text/babel" src="app/admin-tax.jsx?v=20261001-tax1"></script>');
  assert.ok(adm > 0 && tax > adm);
  assert.ok(tax < html.indexOf('src="app/app.jsx?v='));
  // Team "Coming soon" (2026-10-02) re-keyed ai.jsx, script.jsx, landing.jsx and styles.css again: 20261002-team1 counts too
  for (const f of ["app/ai.jsx", "app/script.jsx", "app/landing.jsx"]) assert.ok(["20261002-trialwelcome1", "20261002-tip1", "20261002-team1", "20261002-scene1", "20261002-research1", "20261002-research2", "20261002-artlive1", "20261002-artundo1", "20261002-stagefilm1", "20261002-planpick2", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team6", "20261003-team8", "20261003-lookbook1", "20261003-cast1", "20261003-team7", "20261003-team5", "20261004-props1", "20261004-color1", "20261004-shots1", "20261004-locs1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261005-sb1", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261009-stage3", "20261009-tl3", "20261009-mix3", "20261009-home3", "20261009-wr3", "20261009-art3", "20261010-like1", "20261010-pron1", "20261010-pose2", "20261010-voice1", "20261010-nb21", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24"].some(k=>html.includes('src="' + f + '?v='+k+'"')), f);
  assert.ok(["20261002-terms1", "20261002-plans1", "20261002-trialwelcome1", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team6", "20261003-lookbook1", "20261003-cast1", "20261003-team5", "20261004-props1", "20261004-color1", "20261004-shots1", "20261004-locs1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261005-sb1", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-art3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261010-like1", "20261010-voice1", "20261010-pose2", "20261010-del1", "20261010-pron1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24"].some(k=>html.includes('src="app/plans.jsx?v='+k+'"')), "plans.jsx re-keyed again when the switch day set TERMS_UPDATED_AT (or later for the grandfathered card line: 20261002-plans1)");
  assert.ok(["20261002-consent1", "20261002-team1", "20261002-planpick2", "20261002-planpick3", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team6", "20261003-lookbook1", "20261003-cast1", "20261003-team5", "20261004-props1", "20261004-color1", "20261004-shots1", "20261004-locs1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261005-sb1", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24"].some(k=>html.includes('src="app/auth-ui.jsx?v='+k+'"')), "auth-ui.jsx is unchanged here (or re-keyed later for the sign-up plan dropdown: 20261002-planpick2/3) (Team \"Coming soon\" 2026-10-02 re-keyed it later: 20261002-team1)");
  assert.ok(["20261002-btn1", "20261002-team1", "20261002-research1", "20261002-research2", "20261002-planpick2", "20261002-planpick3", "20261003-room1", "20261003-login1", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team6", "20261003-lookbook1", "20261003-cast1", "20261004-props1", "20261004-color1", "20261004-shots1", "20261004-locs1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261005-sb1", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-shots3", "20261009-sb3", "20261009-tl3", "20261009-mix3", "20261009-home3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261009-bd3", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24"].some(k=>html.includes('href="app/styles.css?v='+k+'"')), "styles.css re-keyed again for the plan-copy editor's buttons (2026-10-02), or later for Team \"Coming soon\"");
});
await test("H2 CSS: the ⓘ's rules (the Plans window on the app tokens; the homepage's paper and dark featured card in the landing block), the sign-up window's line; the under-button rules and the dialog's are gone; the info banner and the tax page keep theirs", () => {
  const css = read("app/styles.css");
  for (const c of [".checkout-note{", ".checkout-note a{", ".auth-head .auth-checkout-note{", ".auth-panel.light .auth-checkout-note{", ".checkout-note .checkout-note-mail{overflow-wrap:anywhere}",
    ".checkout-tip-row{display:flex;align-items:center;gap:4px;min-width:0}", ".checkout-tip{position:relative;", ".checkout-tip-btn{display:grid;place-items:center;width:24px;height:24px;margin:-4px 0;",
    ".checkout-tip-btn:focus-visible{outline:2px solid var(--accent)", ".checkout-tip-pop a{color:var(--accent-ink)", ".checkout-tip-pop::before{", ".checkout-tip-pop::after{",
    ".billing-banner.info{", ".adm-tax-sec{", ".adm-tax-table{", ".adm-tax-meter{", ".adm-tax-checks{"])
    assert.ok(css.includes(c), c);
  for (const gone of [".lp-checkout-note", ".credit-pack .checkout-note"]) assert.ok(!css.includes(gone), gone + " is gone (nothing sits under a purchase button)");
  assert.ok(!/checkout-consent/.test(css), "no dialog CSS left");
  // the homepage's colours live in the landing block (website palette), not in the app-token block at the end
  const landing = css.slice(css.indexOf("/* ===================== Commercial landing page"), css.indexOf("/* Screenplay preview modal"));
  for (const c of [".lp-checkout-tip .checkout-tip-btn{color:var(--lpw-sub)}", ".lp-tier.featured .lp-checkout-tip .checkout-tip-btn{color:rgba(255,255,255,.62)}",
    ".lp-checkout-tip .checkout-tip-pop{background:var(--lpw-surface);", ".lp-checkout-tip .checkout-tip-pop a{color:var(--lpw-ink)}",
    ".lp-tier .lp-checkout-tip .checkout-tip-btn:hover,.lp-tier .lp-checkout-tip.open .checkout-tip-btn{color:var(--lpw-ink);background:var(--lpw-card-2)}"]) assert.ok(landing.includes(c), c);
  // review 2026-10-02: the landing's hover / open disc must outrank the app's open rule, which comes LATER in the
  // file (a tie goes to it: the app theme's white or dark disc on the paper card); the featured card's still outranks the landing's
  const spec = (sel) => { const t = sel.replace(/::[\w-]+/g, ""); return [(t.match(/#[\w-]+/g) || []).length,
    (t.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length, (t.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectorsOf = (body) => { const out = []; for (const chunk of bare.split("}")) { const i = chunk.lastIndexOf("{"); if (i < 0) continue;
    const sel = chunk.slice(chunk.lastIndexOf("{", i - 1) + 1, i);
    if (chunk.slice(i + 1).includes(body) && sel.includes("checkout-tip-btn")) out.push(...sel.split(",").map((x) => x.trim())); } return out; };
  const appOpen = ".checkout-tip.open .checkout-tip-btn", appHover = ".checkout-tip-btn:hover";
  assert.ok(css.includes(appHover + "," + appOpen + "{color:var(--txt-0);background:var(--bg-4)}"), "the app's own hover / open disc");
  const lpRule = selectorsOf("background:var(--lpw-card-2)");
  assert.deepEqual(lpRule, [".lp-tier .lp-checkout-tip .checkout-tip-btn:hover", ".lp-tier .lp-checkout-tip.open .checkout-tip-btn"]);
  for (const s of lpRule) for (const app of [appOpen, appHover]) assert.ok(cmp(spec(s), spec(app)) > 0, s + " outranks " + app);
  const featured = selectorsOf("color:#fff;background:rgba(255,255,255,.12)");
  assert.equal(featured.length, 2);
  for (const f of featured) for (const s of lpRule) assert.ok(cmp(spec(f), spec(s)) > 0, f + " outranks " + s);
  // the block runs to the next section appended after it (the homepage-style rooms and Home, 2026-10-16)
  const tailAt = css.indexOf("/* ===================== Consumer rights + tax (2026-10-01)"), tailEnd = css.indexOf("HOMEPAGE STYLE \u2014 the rooms", tailAt);
  const tail = css.slice(tailAt, tailEnd > tailAt ? css.lastIndexOf("/*", tailEnd) : undefined);
  assert.ok(tail.includes(".checkout-tip-pop{") && !/--lpw-/.test(tail), "the app block uses the app's tokens only");
});
await test("H3 brand: the new page's copy says no retired name and names no AI vendor", () => {
  const src = read("app/admin-tax.jsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const lits = [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).join("\n");
  for (const re of [/\bTURN\b/, /cinema[\s_-]?machine/i, /\bMUSE\b/, /Infinite Studio(?! AI)/, /claude|anthropic|mckee|openai|gemini/i]) assert.ok(!re.test(lits), String(re));
});

console.log(failed ? `${checks} passed, ${failed} failed` : `${checks} checks passed`);
process.exit(failed ? 1 : 0);

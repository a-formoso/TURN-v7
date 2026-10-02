#!/usr/bin/env node
/* Stripe product metadata (supabase/functions/stripe-webhook/plan-metadata.mjs + index.ts).
   Owner decision 2026-09-29: Kinolot's products carry app=kinolot; pre-rebrand ones carry
   app=cinema-machine — both grant; anything else (Academy, mentorships) never does. The
   Producer plan's tier=producer is stored as plan "studio", the id the database,
   image-proxy, blender-bridge and the app check. Offline, no Stripe or Supabase.
   G-L (billing fixes, owner decisions 2026-09-30): the pure rules behind the webhook's new
   events — plan ranks and the Option A allowances, upgrade credit differences, idempotency
   keys, refund / dispute outcomes, the key's mode, and period dates in both API shapes. The
   handler itself is exercised event by event in scripts/test-stripe-webhook.mjs.
   P-Q (owner decisions 2026-10-01): sales-ledger.mjs — the sales ledger's keys, countries / US states and
   where they came from, refunds that count, the partial-refund share (D3) — and the dispute holds (D4).
   R (owner decision 2026-10-02, E2): customer-email.mjs — which account email may go on the Stripe customer
   (confirmed only), when the customer needs it (differs, case ignored), and the masking that keeps whole
   addresses out of the logs. */
import { readFileSync } from "node:fs";
import {
  isOurApp, planTier, OUR_APPS, isKnownTier, looksLikeOurs, invoiceSubscriptionId,
  idOf, isUuid, stripeKeyMode, tierRank, planChange, ALLOWANCE_TABLES, upgradeCredits, subscriptionPeriod,
  planGrantKey, packGrantKey, upgradeKey, PLAN_BILLING_REASONS, refundState, disputeOutcome,
  LEGACY_PACK_CREDITS, isLegacyPack, packGrantCredits, regimeSwitched, isMissingFunctionError, legacyPackLotNote,
  disputeHoldReason, disputeHoldAfterClose, HOLD_SEPARATOR,
} from "../supabase/functions/stripe-webhook/plan-metadata.mjs";
import {
  SALE_KINDS, SALE_APPS, saleApp, COUNTRY_SOURCES, normCountry, normUsState, US_STATE_CODES, saleLocation, saleAmountCents, unixToIso,
  invoiceSaleKey, checkoutSaleKey, refundSaleKey, countableRefund, pendingRefund, refundBaseCents, refundFraction, invoiceLineProductIds, saleLogFields,
} from "../supabase/functions/stripe-webhook/sales-ledger.mjs";
import {
  STRIPE_EMAIL_MAX, normEmail, isUsableEmail, maskEmail, scrubEmails, accountSyncEmail, customerEmailAction,
} from "../supabase/functions/stripe-webhook/customer-email.mjs";

let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) passed++; else { failed++; console.error("FAIL " + name); } };

check("A both labels are ours", isOurApp("kinolot") && isOurApp("cinema-machine"));
check("A case and stray spaces don't matter", isOurApp(" Kinolot ") && isOurApp("CINEMA-MACHINE"));
check("A other apps and missing metadata are not ours",
  !isOurApp("academy") && !isOurApp("mentorship") && !isOurApp("") && !isOurApp(undefined) && !isOurApp(null) && !isOurApp(42));
check("A the list is frozen and exactly the two labels", Object.isFrozen(OUR_APPS) && OUR_APPS.join() === "kinolot,cinema-machine");
check("B producer is stored as studio", planTier("producer") === "studio" && planTier(" Producer ") === "studio");
check("B the existing tiers pass through", planTier("writer") === "writer" && planTier("director") === "director" && planTier("studio") === "studio");
check("B a missing tier stays 'member' (as before)", planTier(undefined) === "member" && planTier("") === "member");

check("D the gates' tiers are known; a typo is not", isKnownTier("writer") && isKnownTier("director") && isKnownTier(planTier("producer")) && isKnownTier("pro") && !isKnownTier(planTier("prodcer")) && !isKnownTier("member"));
check("D a product with our credit fields looks like ours whatever its app", looksLikeOurs({ app:"kino-lot", plan_credits:"800" }) && looksLikeOurs({ kind:"credit_pack" }) && looksLikeOurs({ pack_credits:"300" }) && !looksLikeOurs({ app:"academy" }) && !looksLikeOurs(null));

check("F renewal invoices: the subscription id is found in the old AND the basil/dahlia field",
  invoiceSubscriptionId({ subscription: "sub_old" }) === "sub_old"
  && invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } }) === "sub_new"
  && invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_obj" } } } }) === "sub_obj"
  && invoiceSubscriptionId({ subscription: { id: "sub_x" } }) === "sub_x");
check("F …and null when an invoice has neither (never a guess)",
  invoiceSubscriptionId({}) === null && invoiceSubscriptionId({ parent: {} }) === null && invoiceSubscriptionId(null) === null
  && invoiceSubscriptionId({ subscription: "" }) === null);

// index.ts uses the helper at every place that used to compare app === "cinema-machine"
const src = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const importList = (src.match(/import \{([^}]*)\} from "\.\/plan-metadata\.mjs";/) || [, ""])[1].split(",").map((x) => x.trim()).filter(Boolean);
check("C index.ts imports the helpers", ["invoiceSubscriptionId", "isKnownTier", "isOurApp", "looksLikeOurs", "planTier",
  "idOf", "isUuid", "stripeKeyMode", "planChange", "upgradeCredits", "subscriptionPeriod", "planGrantKey", "packGrantKey", "upgradeKey",
  "PLAN_BILLING_REASONS", "refundState", "disputeOutcome"].every((n) => importList.includes(n)));
check("C no hard-coded app comparison is left", !/["']cinema-machine["']/.test(code) && !/["']kinolot["']/.test(code));
check("C every product check goes through isOurApp (plan, pack, pack scan, no-uid scan)", (code.match(/isOurApp\(/g) || []).length >= 4);
check("C the plan tier goes through planTier", /tier: planTier\(md\.tier\)/.test(code));

check("E every other-brand skip leaves a log line; suspects and unknown tiers are recorded", (code.match(/console\.warn\(`SKIP other_app/g) || []).length >= 2
  && (code.match(/"other_app_suspect"/g) || []).length >= 2 && /reason: "unknown_tier"/.test(code) && /isKnownTier\(plan\.tier\)/.test(code));

check("F the renewal path reads the id through the helper (with an API fallback) and never inv.subscription directly",
  /invoiceSubscriptionId\(inv\)/.test(code) && /stripe\.invoices\.retrieve\(inv\.id\)/.test(code) && !/inv\.subscription/.test(code)
  && /reason: "renewal_without_subscription"/.test(code));

/* ── G-L billing fixes 2026-09-30 ─────────────────────────────────────────────────────── */
check("G legacy tier=pro is stored as director (the only Director id the server gates accept); producer stays studio",
  planTier("pro") === "director" && planTier(" PRO ") === "director" && planTier("producer") === "studio" && isKnownTier(planTier("pro")));
check("G plan ranks: writer < director (= legacy pro) < studio; none / member / unknown are 0",
  tierRank("writer") === 1 && tierRank("director") === 2 && tierRank("pro") === 2 && tierRank("studio") === 3 && tierRank("producer") === 3
  && tierRank("none") === 0 && tierRank(undefined) === 0 && tierRank("prodcer") === 0);
check("G plan changes are classified from the two plans alone",
  planChange("writer", "director") === "upgrade" && planChange("studio", "writer") === "downgrade" && planChange("pro", "director") === "same"
  && planChange("none", "writer") === "unknown" && planChange("writer", "prodcer") === "unknown");
const [A, PRE] = ALLOWANCE_TABLES;
check("H the allowance tables are Option A (600 / 1,600 / 5,000) and the pre-switch units (800 / 2,400 / 9,000), frozen",
  Object.isFrozen(ALLOWANCE_TABLES) && Object.isFrozen(A) && A.writer === 600 && A.director === 1600 && A.studio === 5000
  && PRE.writer === 800 && PRE.director === 2400 && PRE.studio === 9000 && PRE.writer * 3 === 2400 && PRE.director * 3 === 7200 && PRE.studio * 3 === 27000);
check("H upgrade credits: the previous product's allowance wins; else the table the new plan's credits belong to",
  upgradeCredits({ fromPlan: "writer", toPlan: "director", fromCredits: 600, toCredits: 1600 }) === 1000
  && upgradeCredits({ fromPlan: "writer", toPlan: "studio", toCredits: 5000 }) === 4400
  && upgradeCredits({ fromPlan: "director", toPlan: "studio", toCredits: 9000 }) === 6600
  && upgradeCredits({ fromPlan: "pro", toPlan: "producer", toCredits: 5000 }) === 3400);
check("H upgrade credits: never negative, never above the new allowance, null when it can't be worked out",
  upgradeCredits({ fromPlan: "writer", toPlan: "director", fromCredits: 2400, toCredits: 1600 }) === 0
  && upgradeCredits({ fromPlan: "writer", toPlan: "director", fromCredits: -5, toCredits: 1600 }) === 1000
  && upgradeCredits({ fromPlan: "writer", toPlan: "studio", toCredits: 7777 }) === null
  && upgradeCredits({ fromPlan: "writer", toPlan: "director", toCredits: 0 }) === null
  && upgradeCredits({ fromPlan: "none", toPlan: "director", toCredits: 1600 }) === null);
check("I subscription period: stripe@16's top-level fields, else the dahlia item fields; null (never 1970) when absent",
  subscriptionPeriod({ current_period_start: 100, current_period_end: 200 }).end === 200
  && subscriptionPeriod({ items: { data: [{ current_period_start: 300, current_period_end: 400 }] } }).start === 300
  && subscriptionPeriod({ items: { data: [{ current_period_end: 1790000000 }] } }).endIso === "2026-09-21T14:13:20.000Z"
  && subscriptionPeriod({}).endIso === null && subscriptionPeriod(null).end === null && subscriptionPeriod({ current_period_end: 0 }).endIso === null);
check("J keys: a plan grant by invoice, a pack by checkout, an upgrade by sub + plans + period; event id as the fallback",
  planGrantKey("in_1", "evt_1") === "invoice:in_1" && planGrantKey(null, "evt_1") === "evt_1"
  && packGrantKey("cs_1", "evt_1") === "checkout:cs_1" && packGrantKey("", "evt_1") === "evt_1"
  && upgradeKey("sub_1", "writer", "producer", 123, "evt_1") === "upgrade:sub_1:writer>studio:123"
  && upgradeKey("sub_1", "pro", "studio", null, "evt_9") === "upgrade:sub_1:director>studio:evt_9");
check("J plan billing reasons: first invoice, renewal, plan change only", Object.isFrozen(PLAN_BILLING_REASONS)
  && PLAN_BILLING_REASONS.join() === "subscription_create,subscription_cycle,subscription_update");
check("K refunds: full / partial / none in both payload shapes",
  refundState({ amount: 1000, amount_refunded: 1000, refunded: true }) === "full" && refundState({ amount: 1000, amount_refunded: 1000 }) === "full"
  && refundState({ amount: 1000, amount_refunded: 300, refunded: false }) === "partial" && refundState({ amount: 1000, amount_refunded: 0 }) === "none"
  && refundState(null) === "none");
check("K disputes: won and inquiry-closed unfreeze, lost is lost, anything else waits",
  disputeOutcome("won") === "unfreeze" && disputeOutcome("warning_closed") === "unfreeze" && disputeOutcome("lost") === "lost"
  && disputeOutcome("under_review") === "none" && disputeOutcome(undefined) === "none");
check("L ids, uuids and the key's mode",
  idOf("ch_1") === "ch_1" && idOf({ id: "ch_2" }) === "ch_2" && idOf("") === null && idOf(null) === null && idOf({}) === null
  && isUuid("11111111-1111-4111-8111-111111111111") && !isUuid("u1") && !isUuid(" 11111111-1111-4111-8111-111111111111") && !isUuid(null)
  && stripeKeyMode("sk_live_x") === "live" && stripeKeyMode("rk_live_x") === "live" && stripeKeyMode("sk_test_x") === "test"
  && stripeKeyMode("x") === null && stripeKeyMode(undefined) === null);
check("L the webhook calls only the new idempotent functions (never turn_set_plan / turn_apply_pack_once / turn_end_plan)",
  /rpc\("turn_set_plan_once"/.test(code) && /rpc\("turn_add_pack_once"/.test(code) && /rpc\("turn_end_plan_for_sub"/.test(code)
  && !/"turn_set_plan"|"turn_apply_pack_once"|"turn_end_plan"/.test(code));

// M (round 2, 2026-09-30): packs sold in the OLD unit count x3 when granted after the switch
check("M the old packs are recognised by metadata: pack_credits 300 / 1,200 / 4,000, app=cinema-machine, or unit=legacy",
  LEGACY_PACK_CREDITS.join() === "300,1200,4000" && Object.isFrozen(LEGACY_PACK_CREDITS)
  && isLegacyPack({ app: "kinolot", kind: "credit_pack", pack_credits: "300" }) && isLegacyPack({ app: "kinolot", pack_credits: "4000" })
  && isLegacyPack({ app: "cinema-machine", kind: "credit_pack", pack_credits: "1000" }) && isLegacyPack({ app: "kinolot", pack_credits: "777", unit: "Legacy" })
  && isLegacyPack({ pack_credits: "500", unit: "pre-switch" }));
check("M the new packs (250 / 1,000 / 3,000) and anything labelled with another unit are not",
  !isLegacyPack({ app: "kinolot", pack_credits: "250" }) && !isLegacyPack({ app: "kinolot", pack_credits: "1000" }) && !isLegacyPack({ app: "kinolot", pack_credits: "3000" })
  && !isLegacyPack({ app: "kinolot", pack_credits: "300", unit: "option-a" }) && !isLegacyPack({ app: "cinema-machine", pack_credits: "300", unit: "switched" })
  && !isLegacyPack(null) && !isLegacyPack({}));
check("M x3 only for an old pack after the switch",
  packGrantCredits(300, { legacy: true, switched: true }) === 900 && packGrantCredits(300, { legacy: true, switched: false }) === 300
  && packGrantCredits(250, { legacy: false, switched: true }) === 250 && packGrantCredits(-5, { legacy: true, switched: true }) === 0);
check("M turn_credit_regime()'s answer: switched / not / unreadable",
  regimeSwitched([{ switched: true }]) === true && regimeSwitched({ switched: false }) === false && regimeSwitched([{ switched: "t" }]) === true
  && regimeSwitched([]) === null && regimeSwitched(null) === null && regimeSwitched([{ usd_per_credit: "0.01" }]) === null);
check("M the webhook applies the x3 from the regime, and fails (retry) rather than guess",
  /isLegacyPack\(md\)/.test(code) && /rpc\("turn_credit_regime", \{\}\)/.test(code) && /switched === null\) throw/.test(code));

// N (round 3, 2026-09-30, S6): the DATABASE triples an old pack under its locks (legacy_unit => true);
// the webhook's own x3 is only the fallback for a database without that argument
check("N a missing function / argument is recognised only by PostgREST's PGRST202 or Postgres's 42883 (or those words without a code)",
  isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.turn_add_pack_once(amount, charge_id, event_id, legacy_unit, uid) in the schema cache" })
  && isMissingFunctionError({ code: "42883", message: "function public.turn_add_pack_once(text, uuid, integer, text, boolean) does not exist" })
  && isMissingFunctionError({ code: "pgrst202" }) && isMissingFunctionError({ message: "Could not find the function public.turn_add_pack_once in the schema cache" })
  && isMissingFunctionError({ message: "function public.turn_add_pack_once(text) does not exist" }));
check("N …and nothing else falls back (a timeout, a constraint, a network error, another code with those words)",
  !isMissingFunctionError({ code: "57014", message: "canceling statement due to statement timeout" }) && !isMissingFunctionError({ code: "23503", message: "violates foreign key constraint" })
  && !isMissingFunctionError({ message: "connection reset by peer" }) && !isMissingFunctionError({ code: "PGRST116", message: "Could not find the function" })
  && !isMissingFunctionError(null) && !isMissingFunctionError("PGRST202"));
check("N the webhook sends legacy_unit => true for an all-old-pack cart and falls back only on a missing argument",
  /admin\.rpc\("turn_add_pack_once", \{ event_id: key, uid, amount: credits, charge_id: chargeId, legacy_unit: true \}\)/.test(code)
  && /else if \(isMissingFunctionError\(error\)\)/.test(code) && /legacyCredits > 0 && legacyCredits === credits/.test(code));

// O (round 4, S6): the PACK_GRANT log of an old pack names the amount AS SOLD and the lot the DATABASE granted
// (read back from turn_stripe_events.result), so the owner can tell 300 from 900 without a query
check("O legacyPackLotNote reads the event result: the lot and whether it was tripled",
  legacyPackLotNote({ lot_credits: 900, legacy_unit: true, x3: true }) === " lot_credits=900 x3=true"
  && legacyPackLotNote({ lot_credits: 300, legacy_unit: true, x3: false }) === " lot_credits=300 x3=false"
  && legacyPackLotNote({ lot_credits: "3600", x3: "true" }) === " lot_credits=3600 x3=true"
  && legacyPackLotNote({ lot_credits: 250 }) === " lot_credits=250 x3=unknown");
check("O …and says 'unknown' when the result can't be read (never a guess)",
  [null, undefined, {}, { lot_credits: 0 }, { lot_credits: "x" }, [], "900", { skipped: "subscription_conflict" }]
    .every((r) => legacyPackLotNote(r) === " lot_credits=unknown (the database triples it after the switch)"));
check("O the webhook logs credits_as_sold= and the lot for the database-decided path (and reads the event result back)",
  /amountLabel = "credits_as_sold";/.test(code) && /legacyPackLotNote\(await packEventResult\(key, event\)\)/.test(code)
  && /\$\{amountLabel\}=\$\{credits\}/.test(code) && /from\("turn_stripe_events"\)\.select\("result"\)\.eq\("id", key\)\.maybeSingle\(\)/.test(code));

// P (2026-10-01, D1 / D3): the sales ledger's pure rules (sales-ledger.mjs)
check("P the ledger's kinds, apps and country sources are the shared contract's (tax-compliance.sql)",
  SALE_KINDS.join() === "plan,pack,other,refund" && SALE_APPS.join() === "kinolot,other" && saleApp(true) === "kinolot" && saleApp(false) === "other" && saleApp(undefined) === "other"
  && Object.isFrozen(SALE_KINDS) && Object.isFrozen(COUNTRY_SOURCES)
  && COUNTRY_SOURCES.join() === "invoice_address,checkout_address,customer_address,billing_address,card_country");
check("P countries are ISO-3166 alpha-2, upper case; anything else is unknown",
  normCountry(" gb ") === "GB" && normCountry("US") === "US" && normCountry("GBR") === null && normCountry("") === null && normCountry(null) === null && normCountry("G1") === null);
check("P US states: codes, full names (any case) and US-XX; DC and the territories; nothing else",
  normUsState("ca") === "CA" && normUsState("California") === "CA" && normUsState(" new  york ") === "NY" && normUsState("US-TX") === "TX"
  && normUsState("District of Columbia") === "DC" && normUsState("PR") === "PR" && normUsState("Ontario") === null && normUsState("ZZ") === null
  && normUsState(undefined) === null && US_STATE_CODES.length === 56 && US_STATE_CODES.includes("WY"));
const L = saleLocation;
check("P location: the first valid country wins, with its source; a bad country is skipped",
  JSON.stringify(L([{ source: "invoice_address", address: { country: "xx1" } }, { source: "customer_address", address: { country: "fr" } }, { source: "card_country", country: "DE" }]))
    === JSON.stringify({ country: "FR", region: null, country_source: "customer_address", complete: true })
  && L([{ source: "card_country", country: "ie" }]).country === "IE" && L([{ source: "card_country", country: "ie" }]).region === null);
check("P location: a US sale takes the state of the first US address that has one — never a state from another country's address or a bare card country",
  JSON.stringify(L([{ source: "invoice_address", address: { country: "US" } }, { source: "customer_address", address: { country: "US", state: "Texas" } }]))
    === JSON.stringify({ country: "US", region: "TX", country_source: "invoice_address", complete: true })
  && L([{ source: "invoice_address", address: { country: "US" } }]).complete === false && L([{ source: "invoice_address", address: { country: "US" } }]).region === null
  && L([{ source: "invoice_address", address: { country: "US" } }, { source: "customer_address", address: { country: "CA", state: "ON" } }]).region === null
  && L([{ source: "invoice_address", address: { country: "GB", state: "CA" } }]).region === null);
check("P location: nothing usable -> unknown (null country, null source, not complete)",
  JSON.stringify(L([])) === JSON.stringify({ country: null, region: null, country_source: null, complete: false }) && L(null).country === null && L([null, {}, { source: "x" }]).country === null);
check("P amounts, times and keys",
  saleAmountCents(4900) === 4900 && saleAmountCents("1000") === 1000 && saleAmountCents(1.5) === null && saleAmountCents(undefined) === null
  && unixToIso(1790000000) === "2026-09-21T14:13:20.000Z" && unixToIso(0) === null && unixToIso(null) === null
  && invoiceSaleKey("in_1") === "invoice:in_1" && invoiceSaleKey(null) === null && refundSaleKey("re_1") === "refund:re_1" && refundSaleKey("") === null
  && checkoutSaleKey({ id: "cs_1" }) === "checkout:cs_1" && checkoutSaleKey({ id: "cs_1", invoice: "in_9" }) === "invoice:in_9"
  && checkoutSaleKey({ id: "cs_1", invoice: { id: "in_8" } }) === "invoice:in_8" && checkoutSaleKey(null) === null);
check("P refunds that count: SUCCEEDED (or an old payload without a status) only — a pending one may still fail; never failed, canceled, requires_action or $0",
  countableRefund({ id: "re", amount: 100, status: "succeeded" }) && !countableRefund({ id: "re", amount: 100, status: "pending" }) && countableRefund({ id: "re", amount: 100 })
  && !countableRefund({ id: "re", amount: 100, status: "failed" }) && !countableRefund({ id: "re", amount: 100, status: "canceled" })
  && !countableRefund({ id: "re", amount: 100, status: "requires_action" }) && !countableRefund({ id: "re", amount: 0 }) && !countableRefund({ amount: 100 }) && !countableRefund(null));
check("P pending refunds wait (pending / requires_action), applied when charge.refund.updated says they succeeded",
  pendingRefund({ id: "re", amount: 100, status: "pending" }) && pendingRefund({ id: "re", amount: 100, status: "requires_action" })
  && !pendingRefund({ id: "re", amount: 100, status: "succeeded" }) && !pendingRefund({ id: "re", amount: 100, status: "failed" })
  && !pendingRefund({ id: "re", amount: 100 }) && !pendingRefund({ id: "re", amount: 0, status: "pending" }) && !pendingRefund(null));
check("P D3 what a share is measured against: a pack's charge; a plan invoice paid partly from the customer's balance -> the invoice total",
  refundBaseCents("pack", 3500, 9999) === 3500 && refundBaseCents("plan", 1900, 4900) === 4900 && refundBaseCents("plan", 4900, 4900) === 4900
  && refundBaseCents("plan", 4900, undefined) === 4900 && refundBaseCents("plan", 4900, 1900) === 4900 && refundBaseCents("plan", null, 4900) === 4900
  && refundBaseCents("pack", 0, 4900) === null && refundBaseCents("plan", 1900, 19.5) === 1900);
check("P D3 refund share: refund / charge cut DOWN to 12 decimals (never above the true share), 1 for the whole charge, null when unknowable",
  refundFraction(1000, 3500) === 0.285714285714 && refundFraction(500, 3500) === 0.142857142857 && refundFraction(2450, 4900) === 0.5
  && refundFraction(3500, 3500) === 1 && refundFraction(4000, 3500) === 1 && refundFraction(1, 99900) === 0.00001001001
  && refundFraction(0, 3500) === null && refundFraction(100, 0) === null && refundFraction(1.5, 3500) === null && refundFraction(null, 3500) === null);
// exhaustive: for every refund of a $35 / $49 / $149 charge and every allowance, ceil(fraction x granted) equals the exact ceil(refund x granted / charge)
{
  let bad = null;
  for (const charge of [3500, 4900, 14900]) for (const granted of [250, 600, 1000, 1600, 3000, 5000, 27000]) {
    for (let refund = 1; refund < charge && !bad; refund += 7) {
      const exact = Math.floor((refund * granted + charge - 1) / charge);                  // ceil(refund x granted / charge), integers
      const k = BigInt(Math.round(refundFraction(refund, charge) * 1e12));                // the decimal the database receives, x 1e12
      const viaDb = Number((k * BigInt(granted) + 999999999999n) / 1000000000000n);      // numeric's exact ceil(fraction x granted)
      if (viaDb !== exact) bad = { charge, granted, refund, exact, viaDb };
    }
  }
  check("P D3 share x granted, rounded up, is exact for every refund of the plans' and packs' prices (no float drift either way)", !bad);
  if (bad) console.error(bad);
}
check("P one-off invoice line products in both API shapes (price.product before basil, pricing.price_details.product after), de-duplicated",
  invoiceLineProductIds({ lines: { data: [{ price: { product: "prod_a" } }, { pricing: { price_details: { product: "prod_b" } } }, { price: { product: { id: "prod_a" } } }, { plan: { product: "prod_c" } }, {}] } }).join() === "prod_a,prod_b,prod_c"
  && invoiceLineProductIds({}).length === 0 && invoiceLineProductIds(null).length === 0);
check("P the ledger's log words",
  saleLogFields({ source_key: "invoice:in_1", app: "kinolot", kind: "plan", amount_cents: 4900, currency: "usd", country: "US", region: "CA", country_source: "customer_address" })
    === "key=invoice:in_1 app=kinolot kind=plan amount=4900 usd country=US region=CA source=customer_address"
  && saleLogFields({ source_key: "refund:re_1", app: "other", kind: "refund", amount_cents: -100, currency: "gbp", country: null, region: null, country_source: null })
    === "key=refund:re_1 app=other kind=refund amount=-100 gbp country=unknown source=none");

// Q (2026-10-01, D4): a closing dispute lifts only the hold it placed
const D1 = "dispute dp_1 (fraudulent) on charge ch_1", D2 = "dispute dp_2 (general) on charge ch_2", D12 = "dispute dp_12 (general) on charge ch_9";
check("Q opening: alone on a free account; added once to the holds already there; a reasonless hold keeps a marker",
  disputeHoldReason({ frozen: false, frozen_reason: "dispute dp_0 won" }, D1, "dp_1") === D1 && disputeHoldReason(null, D1, "dp_1") === D1
  && disputeHoldReason({ frozen: true, frozen_reason: D1 }, D2, "dp_2") === D1 + HOLD_SEPARATOR + D2
  && disputeHoldReason({ frozen: true, frozen_reason: D1 + HOLD_SEPARATOR + D2 }, D2, "dp_2") === D1 + HOLD_SEPARATOR + D2
  && disputeHoldReason({ frozen: true, frozen_reason: null }, D1, "dp_1") === "earlier hold (no reason given)" + HOLD_SEPARATOR + D1
  && disputeHoldReason({ frozen: true, frozen_reason: D12 }, D1, "dp_1") === D12 + HOLD_SEPARATOR + D1, "dp_1 is not dp_12");
const after = (acct, id) => JSON.stringify(disputeHoldAfterClose(acct, id));
check("Q closing: lift when nothing else is listed (or nothing is held); keep the rest; review a hold that isn't this dispute's",
  after({ frozen: true, frozen_reason: D1 }, "dp_1") === JSON.stringify({ action: "lift" }) && after({ frozen: false, frozen_reason: D1 }, "dp_1") === JSON.stringify({ action: "lift" })
  && after(null, "dp_1") === JSON.stringify({ action: "lift" })
  && after({ frozen: true, frozen_reason: D1 + HOLD_SEPARATOR + D2 }, "dp_1") === JSON.stringify({ action: "keep", remaining: D2 })
  && after({ frozen: true, frozen_reason: D12 + HOLD_SEPARATOR + D1 }, "dp_1") === JSON.stringify({ action: "keep", remaining: D12 })
  && after({ frozen: true, frozen_reason: "owner hold" }, "dp_1") === JSON.stringify({ action: "review", remaining: "owner hold" })
  && after({ frozen: true, frozen_reason: null }, "dp_1") === JSON.stringify({ action: "review", remaining: null })
  && after({ frozen: true, frozen_reason: D12 }, "dp_1") === JSON.stringify({ action: "review", remaining: D12 }));
check("Q the webhook freezes with disputeHoldReason and closes with disputeHoldAfterClose, for won AND lost",
  /disputeHoldReason\(await accountByUid\(info\.uid\), part, d\.id\)/.test(code) && /disputeHoldAfterClose\(await accountByUid\(uid\), d\.id\)/.test(code)
  && (code.match(/await releaseDisputeHold\(event, d, info\.uid\)/g) || []).length === 2);

// R (2026-10-02, E2): the Stripe customer's email follows the account's confirmed email
const AE = "ana.writer@example.com";
check("R masking: the first letter of each side and the last domain label, never the whole address",
  maskEmail(AE) === "a***@e***.com" && maskEmail("wallet.owner@relay.example.net") === "w***@r***.net"
  && maskEmail(" Ana.Writer@Example.COM ") === "A***@E***.COM" && maskEmail("x@localhost") === "x***@l***"
  && maskEmail("") === "-" && maskEmail(null) === "-" && maskEmail(42) === "-" && maskEmail("no-at-sign") === "***" && maskEmail("@example.com") === "***" && maskEmail("ana@") === "***");
check("R error text: every address in it is masked, the rest kept",
  scrubEmails(`Invalid email address: ${AE}`) === "Invalid email address: a***@e***.com"
  && scrubEmails(`"${AE}" and <b.c@d.org>, then (e@f.io)`) === '"a***@e***.com" and <b***@d***.org>, then (e***@f***.io)'
  && scrubEmails("Request rate limit exceeded") === "Request rate limit exceeded" && scrubEmails(undefined) === "" && !scrubEmails(`x ${AE} y ${AE}`).includes(AE));
check("R usable addresses (what Stripe takes): one @, a dotted domain, no spaces, at most 512 characters",
  isUsableEmail(AE) && isUsableEmail(" " + AE + " ") && !isUsableEmail("ana writer@example.com") && !isUsableEmail("ana@example")
  && !isUsableEmail("ana@@example.com") && !isUsableEmail("ana@example.") && !isUsableEmail("") && !isUsableEmail(null) && !isUsableEmail("a\n@example.com")
  && STRIPE_EMAIL_MAX === 512 && isUsableEmail("a".repeat(500) + "@example.com") && !isUsableEmail("a".repeat(501) + "@example.com"));
check("R compare ignoring case and spaces", normEmail(" Ana.Writer@Example.COM ") === AE && normEmail(undefined) === "");
const acc = (u) => JSON.stringify(accountSyncEmail(u));
const CONF = "2026-10-01T10:00:00Z";
check("R the account's email goes on the customer only when it is CONFIRMED (email_confirmed_at — a confirmed phone is not enough)",
  acc({ email: AE, email_confirmed_at: CONF }) === JSON.stringify({ ok: true, email: AE })
  && acc({ email: " " + AE + " ", email_confirmed_at: CONF }) === JSON.stringify({ ok: true, email: AE })
  && acc({ email: AE, email_confirmed_at: null, confirmed_at: CONF, phone_confirmed_at: CONF }) === JSON.stringify({ ok: false, reason: "unconfirmed" })
  && acc({ email: AE }) === JSON.stringify({ ok: false, reason: "unconfirmed" })
  && acc({ email: "", email_confirmed_at: CONF }) === JSON.stringify({ ok: false, reason: "no_account_email" })
  && acc({ phone: "+447700900000", email_confirmed_at: CONF }) === JSON.stringify({ ok: false, reason: "no_account_email" })
  && acc({ email: "not an email", email_confirmed_at: CONF }) === JSON.stringify({ ok: false, reason: "bad_account_email" })
  && acc({ email: AE, email_confirmed_at: CONF, is_anonymous: true }) === JSON.stringify({ ok: false, reason: "anonymous" })
  && acc(null) === JSON.stringify({ ok: false, reason: "no_account" }) && acc("u") === JSON.stringify({ ok: false, reason: "no_account" }));
const act = (c, e = AE) => JSON.stringify(customerEmailAction(c, e));
check("R the customer is updated only when its email differs (case and spaces ignored) or it has none; a deleted or missing customer never",
  act({ id: "cus_1", email: "wallet.owner@relay.example.net" }) === JSON.stringify({ action: "update" })
  && act({ id: "cus_1", email: null }) === JSON.stringify({ action: "update" }) && act({ id: "cus_1" }) === JSON.stringify({ action: "update" })
  && act({ id: "cus_1", email: "ANA.writer@EXAMPLE.com " }) === JSON.stringify({ action: "skip", reason: "same_email" })
  && act({ id: "cus_1", email: AE }) === JSON.stringify({ action: "skip", reason: "same_email" })
  && act({ id: "cus_1", deleted: true }) === JSON.stringify({ action: "skip", reason: "customer_deleted" })
  && act(null) === JSON.stringify({ action: "skip", reason: "no_customer" }));
const emailImports = (src.match(/import \{([^}]*)\} from "\.\/customer-email\.mjs";/) || [, ""])[1].split(",").map((x) => x.trim()).filter(Boolean);
check("R index.ts uses these rules (no email logic of its own)", ["accountSyncEmail", "customerEmailAction", "maskEmail", "scrubEmails"].every((n) => emailImports.includes(n))
  && /accountSyncEmail\(data\.user\)/.test(code) && /customerEmailAction\(customer, account\.email\)/.test(code) && !/toLowerCase\(\)/.test(code.slice(code.indexOf("async function syncCustomerEmail("), code.indexOf("async function chargeForSession("))));

console.log(failed ? `${passed} passed, ${failed} failed` : `${passed} checks passed`);
if (failed) process.exit(1);

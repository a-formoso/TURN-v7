#!/usr/bin/env node
/* Stripe product metadata (supabase/functions/stripe-webhook/plan-metadata.mjs + index.ts).
   Owner decision 2026-09-29: Kinolot's products carry app=kinolot; pre-rebrand ones carry
   app=cinema-machine — both grant; anything else (Academy, mentorships) never does. The
   Producer plan's tier=producer is stored as plan "studio", the id the database,
   image-proxy, blender-bridge and the app check. Offline, no Stripe or Supabase.
   G-L (billing fixes, owner decisions 2026-09-30): the pure rules behind the webhook's new
   events — plan ranks and the Option A allowances, upgrade credit differences, idempotency
   keys, refund / dispute outcomes, the key's mode, and period dates in both API shapes. The
   handler itself is exercised event by event in scripts/test-stripe-webhook.mjs. */
import { readFileSync } from "node:fs";
import {
  isOurApp, planTier, OUR_APPS, isKnownTier, looksLikeOurs, invoiceSubscriptionId,
  idOf, isUuid, stripeKeyMode, tierRank, planChange, ALLOWANCE_TABLES, upgradeCredits, subscriptionPeriod,
  planGrantKey, packGrantKey, upgradeKey, PLAN_BILLING_REASONS, refundState, disputeOutcome,
  LEGACY_PACK_CREDITS, isLegacyPack, packGrantCredits, regimeSwitched, isMissingFunctionError, legacyPackLotNote,
} from "../supabase/functions/stripe-webhook/plan-metadata.mjs";

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

console.log(failed ? `${passed} passed, ${failed} failed` : `${passed} checks passed`);
if (failed) process.exit(1);

#!/usr/bin/env node
/* Stripe product metadata (supabase/functions/stripe-webhook/plan-metadata.mjs + index.ts).
   Owner decision 2026-09-29: Kinolot's products carry app=kinolot; pre-rebrand ones carry
   app=cinema-machine — both grant; anything else (Academy, mentorships) never does. The
   Producer plan's tier=producer is stored as plan "studio", the id the database,
   image-proxy, blender-bridge and the app check. Offline, no Stripe or Supabase. */
import { readFileSync } from "node:fs";
import { isOurApp, planTier, OUR_APPS, isKnownTier, looksLikeOurs, invoiceSubscriptionId } from "../supabase/functions/stripe-webhook/plan-metadata.mjs";

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
check("C index.ts imports the helper", /import \{ invoiceSubscriptionId, isKnownTier, isOurApp, looksLikeOurs, planTier \} from "\.\/plan-metadata\.mjs";/.test(src));
check("C no hard-coded app comparison is left", !/["']cinema-machine["']/.test(code) && !/["']kinolot["']/.test(code));
check("C every product check goes through isOurApp (plan, pack, pack scan, no-uid scan)", (code.match(/isOurApp\(/g) || []).length >= 4);
check("C the plan tier goes through planTier", /tier: planTier\(md\.tier\)/.test(code));

check("E every other-brand skip leaves a log line; suspects and unknown tiers are recorded", (code.match(/console\.warn\(`SKIP other_app/g) || []).length >= 2
  && (code.match(/"other_app_suspect"/g) || []).length >= 2 && /reason: "unknown_tier"/.test(code) && /isKnownTier\(plan\.tier\)/.test(code));

check("F the renewal path reads the id through the helper (with an API fallback) and never inv.subscription directly",
  /invoiceSubscriptionId\(inv\)/.test(code) && /stripe\.invoices\.retrieve\(inv\.id\)/.test(code) && !/inv\.subscription/.test(code)
  && /reason: "renewal_without_subscription"/.test(code));

console.log(failed ? `${passed} passed, ${failed} failed` : `${passed} checks passed`);
if (failed) process.exit(1);

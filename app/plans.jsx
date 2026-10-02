/* plans.jsx — Kinolot subscription plans + paywall modal.
   The three tiers and one-off credit packs open their Stripe Payment Link, tagged
   with the user's Supabase id (client_reference_id) so the webhook credits the
   right account, and the account's email (prefilled_email) so the payment page starts
   with it. Credits are granted server-side by supabase/functions/stripe-webhook.

   TEST vs LIVE links auto-switch by hostname (see LIVE_HOSTS / planLink below):
   production domains use `live`, everything else (localhost, *.replit.dev preview)
   uses `test` — so local/preview testing can never hit a real card. At launch you
   fill in the plan and pack `live:` URLs; no code path changes. Until a `live`
   URL is set it safely falls back to `test`. */

/* Production hostnames that should use the LIVE payment links. The app's home is
   kinolot.infinitestudioai.com (owner decision 2026-09-28); the older hosts stay listed
   as legacy hosts so checkout keeps using live links there while they still serve the app.
   A host missing from this list silently gets TEST links, so add any new domain here. */
const LIVE_HOSTS = ["kinolot.infinitestudioai.com", "cinema.infinitestudioai.com", "cinema-machine.replit.app", "cinemamachine.ai"];

/* Credit DENOMINATION. Credits are counted in a fine unit so plan allowances read
   generously (600, not 60) — this is cosmetic scale, NOT extra value: render/text/
   image COSTS scale by the same factor (stageRenderCost, nbImageCredits, textSpend).
   The `credits` shown on each plan below is already in this denomination; the Stripe
   product's `plan_credits` metadata MUST match these numbers (that's what the webhook
   actually grants).

   OPTION A (owner decision 2026-09-30): 1 credit = $0.01 of provider cost (app/pricing.jsx
   BASE_PROVIDER_USD_PER_CREDIT, image-proxy's anchor), so every action costs about 3x the
   credits it used to. Plan PRICES are unchanged; NEW subscribers get 600 / 1,600 / 5,000.
   Existing subscribers keep their old allowance in the new units (2,400 / 7,200 / 27,000 —
   LEGACY_ALLOWANCES below) for renewals until 30 days after the switch; the database applies
   that (turn_set_plan_once honours legacy_allowance), the cards here show the new numbers.
   UNTIL THE SWITCH DAY (supabase/billing-switch.sql, 30 days after the notice) the database still
   counts 1 credit = $0.03 and Stripe's plan_credits still say 800 / 2,400 / 9,000, so the cards
   follow the live unit (PLAN_ALLOWANCES + applyCreditRegimeToPlans below, fed by
   app/pricing.jsx turnCreditRegime) and show what a subscription grants TODAY. */
window.CREDIT_SCALE = Number(window.CREDIT_SCALE) || 10;

const PLANS = [
  { tier:"writer",   name:"Writer",   price:"$19", credits:600,
    blurb:"Start with the story engine.",
    entitlements:{ writers_room:true, art_room:false, stage:false },
    features:["600 credits / month","Writers' Room","Story spine, beats and screenplay, with the Story Editors","Every writing engine and every image engine up to 2K"],
    test:"https://buy.stripe.com/test_8x24gB63afmHgtS3eXc7u00",
    live:"https://buy.stripe.com/8x24gB63afmHgtS3eXc7u00" },
  { tier:"director", name:"Director", price:"$49", credits:1600, popular:true,
    blurb:"Write the film, then design it.",
    entitlements:{ writers_room:true, art_room:true, stage:false },
    features:["1,600 credits / month","Writers' Room + Art Room","Lookbook, characters, props, locations, color, shots and storyboards","4K images, character voices and Blender Studio (3D)"],
    test:"https://buy.stripe.com/test_00waEZ77eeiD6Ti4j1c7u01",
    live:"https://buy.stripe.com/00waEZ77eeiD6Ti4j1c7u01" },
  // the "studio" tier is SHOWN as "Producer" (owner decision 2026-09-28) — display only: the tier
  // id and stored balances keep "studio"; the Stripe product says tier=producer, which the webhook
  // maps to "studio" (supabase/functions/stripe-webhook/plan-metadata.mjs, 2026-09-29)
  { tier:"studio",   name:"Producer", price:"$149", credits:5000,
    blurb:"Move from script to production.",
    entitlements:{ writers_room:true, art_room:true, stage:true },
    features:["5,000 credits / month","Writers' Room + Art Room + Stage","Video up to 4K, up to 4 takes at once","Voiced lines, timeline and film export"],
    test:"https://buy.stripe.com/test_bJe9AVbnu6QbdhG2aTc7u02",
    live:"https://buy.stripe.com/bJe9AVbnu6QbdhG2aTc7u02" },
];
window.CINEMA_PLANS = PLANS;
/* The monthly allowance each plan grants, by credit unit (app/pricing.jsx turnCreditRegime):
   `switched` = Option A, from the switch day (1 credit = $0.01); `legacy` = before it ($0.03).
   Must match Stripe's plan_credits metadata in each period (the owner changes it on the switch
   day: owner runbook). */
const PLAN_ALLOWANCES = {
  switched: { writer:600, director:1600, studio:5000 },
  legacy:   { writer:800, director:2400, studio:9000 },
};
window.TURN_PLAN_ALLOWANCES = PLAN_ALLOWANCES;
/* true once supabase/billing-switch.sql has run (or nothing says otherwise yet) */
function creditUnitSwitched(){
  const r = (typeof window.turnCreditRegime==="function") ? window.turnCreditRegime() : null;
  return !r || r.switched!==false;
}
window.turnCreditUnitSwitched = creditUnitSwitched;
/* true once the live unit is KNOWN — read from the server, or this browser's saved copy of that
   read (app/pricing.jsx turnCreditRegimeKnown). Cost quotes may use the safe switched default, but
   the trial line, the pack buttons and the plan cards' allowance numbers wait for this (repair
   2026-09-30: a first paint or a failed read before the switch showed the post-switch offer — a
   50-credit trial that didn't exist yet, 600 / 1,600 / 5,000 cards and clickable packs). Without
   pricing.jsx (a bare test harness) there is no regime to wait for. */
function creditRegimeKnown(){
  if(typeof window.turnCreditRegime!=="function") return true;
  if(typeof window.turnCreditRegimeKnown==="function") return !!window.turnCreditRegimeKnown();
  const r = window.turnCreditRegime();
  return !!r && r.source!=="default";
}
window.turnCreditRegimeKnownForPlans = creditRegimeKnown;

/* The grandfathered allowances (old allowance x3, in the new units) that existing
   subscribers keep for renewals until 30 days after the switch. Reference only — the
   database decides which allowance a renewal grants; the client uses these to read a
   grandfathered balance correctly (low-balance notices). */
const LEGACY_ALLOWANCES = { writer:2400, director:7200, studio:27000, pro:7200 };
window.TURN_LEGACY_ALLOWANCES = LEGACY_ALLOWANCES;

/* FREE TRIAL (owner decision 2026-09-30): 50 credits, granted ONCE per account after the
   email address is confirmed (server-side). A trial or no-plan account may use writing on the
   default engines and DRAFT images only — no video, voice, 3D or premium engines. The server
   enforces it; the client mirrors it so nobody is offered what the server will refuse. */
const TRIAL_CREDITS = 50;
const DRAFT_IMAGE = { model:"gemini-3.1-flash-lite-image", label:"Nano Banana 2 Lite", maxRes:"2K" };
window.TURN_TRIAL_CREDITS = TRIAL_CREDITS;
window.TURN_DRAFT_IMAGE = DRAFT_IMAGE;
/* WHAT 50 CREDITS REALLY BUY (repair 2026-09-30, measured with the server's own pricing module,
   supabase/functions/image-proxy/billing-pricing.mjs, on the real build prompts): a Short Film
   build (16 scenes) costs about 70 credits on the lighter default engine a trial account starts on
   (Gemini 3.8 Flash — "Auto" picks it for free-tier accounts, see app/ai.jsx
   recommendedWritingModelId) and about 380 on Opus 5.5, whose every call also HOLDS about 35
   credits up front. So 50 credits cover a logline, a synopsis, the spine and roughly its first ten
   scenes on the lighter engine — on Opus 5.5 they run out before the spine is finished. The copy
   promises no more than that. */
const TRIAL_COPY = "New accounts get 50 free credits after confirming their email — enough to try the Writers' Room on the lighter writing engine (a logline, a synopsis, the spine and its first scenes), plus draft images.";
window.TURN_TRIAL_COPY = TRIAL_COPY;
/* what each plan adds over the trial — checked against TIER_GATES / ROOM_ENTITLEMENTS below and the
   server's billing-policy.mjs: Writer = every writing engine (and every image engine up to 2K);
   Director = the Art Room and 4K images (every image engine, character voices, 3D); Producer = the
   Stage and video. Director does NOT add image engines Writer lacks — only 4K. */
const TIER_ADDS = "Writer adds every writing engine and every image engine up to 2K; Director adds the Art Room and 4K images; Producer adds the Stage and video.";
window.TURN_TIER_ADDS = TIER_ADDS;
/* the trial starts on the switch day (the database grants nothing before it: turn__trial_amount),
   so its copy shows only from then on — "" before, and "" while the unit isn't known yet */
function trialOffered(){
  if(!creditRegimeKnown()) return false;
  const r = (typeof window.turnCreditRegime==="function") ? window.turnCreditRegime() : null;
  return creditUnitSwitched() && !(r && Number(r.trialCredits)===0);
}
function trialCopy(){ return trialOffered() ? TRIAL_COPY : ""; }
window.turnTrialOffered = trialOffered;
window.turnTrialCopy = trialCopy;
/* the DEFAULT writing engines a trial / no-plan account may use (mirrors image-proxy
   billing-policy.mjs DEFAULT_TEXT_MODELS; premium and formerly mispriced engines need a plan) */
const TRIAL_TEXT_MODELS = ["claude-opus-5-5", "gemini-3.8-flash", "kimi-k2.7-code"];
window.TURN_TRIAL_TEXT_MODELS = TRIAL_TEXT_MODELS;

/* Plan switching for PAYING subscribers never opens a new payment link (that started a
   second subscription while the first kept billing). It belongs in Manage plan (the
   billing portal). Flip this to true once the portal offers plan switching AND the webhook
   handles customer.subscription.updated; until then "Switch to X" explains how to switch
   by email instead. */
const PORTAL_PLAN_SWITCHING = false;
const BILLING_EMAIL = "kinolot-billing@infinitestudioai.com";

/* PLAN NAMES AS USERS SEE THEM. "Studio" read like the company (Infinite Studio AI) and
   Blender Studio, so the top plan is shown as "Producer". DISPLAY ONLY: plan ids
   (writer / director / studio / legacy pro), stored balances and saved plan-copy overrides
   keep their values (Stripe's tier=producer is mapped to "studio" by the webhook); a saved
   "Studio" name is shown as "Producer". */
const PLAN_DISPLAY = { writer:"Writer", director:"Director", pro:"Director", studio:"Producer" };
function legacyPlanName(tier, name){
  return (String(tier||"").toLowerCase()==="studio" && /^studio$/i.test(String(name||"").trim())) ? "Producer" : name;
}
function planDisplayName(tierOrName){
  const s = String(tierOrName==null ? "" : tierOrName).trim();
  if(!s) return "";
  const k = s.toLowerCase();
  if(PLAN_DISPLAY[k]){
    const p = PLANS.find(x=>x.tier===k);
    return p ? legacyPlanName(p.tier, p.name) : PLAN_DISPLAY[k];
  }
  return s.replace(/^./, c=>c.toUpperCase());
}
window.turnPlanDisplayName = planDisplayName;

/* One-off top-ups (owner decision 2026-09-30, at the $0.01 rate): 250 for $10, 1,000 for
   $35, 3,000 for $99 — each dearer per credit than any plan, so upgrading beats topping up.
   PACK CREDITS live in their OWN balance, last 12 months and are never wiped at renewal;
   plan credits are spent first, then packs (earliest expiry first). ANY signed-in account
   may buy one (the database gives it a 12-month lot: turn_add_pack_once).
   Create these in Stripe as NEW one-off products (the old 300 / 1,200 / 4,000 packs below stay on
   sale only until the switch — their products say the old credit numbers) with metadata:
     app=kinolot
     kind=credit_pack
     pack_credits=250 | 1000 | 3000
   and set each link's after-payment URL to https://kinolot.infinitestudioai.com/?credits=<n>.
   Then paste each Payment Link into `live` (and a test-mode link into `test`). An empty slot
   shows "Coming soon" and can never open a checkout. Links pasted 2026-10-01 (the live ones stay
   deactivated in Stripe until the switch day; packOnSale also keeps them shut before it). Stripe
   numbers links per mode, so the sandbox's test_…c7u03-05 (these packs) share their codes with
   the live OLD packs below (…c7u03-05) — different links, different modes. */
const CREDIT_PACKS = [
  { sku:"pack-250", name:"250 credits", price:"$10", credits:250, unit:"switched",
    blurb:"A quick top-up for a few more drafts or images.",
    test:"https://buy.stripe.com/test_8x200l77e1vR4La7vdc7u05",
    live:"https://buy.stripe.com/fZu6oJ8bib6r0uU9Dlc7u06" },
  { sku:"pack-1000", name:"1,000 credits", price:"$35", credits:1000, unit:"switched",
    blurb:"Room for a heavier design or production pass.",
    test:"https://buy.stripe.com/test_9B6cN73V28YjfpO02Lc7u04",
    live:"https://buy.stripe.com/dRm00l2QY2zV4La5n5c7u07" },
  { sku:"pack-3000", name:"3,000 credits", price:"$99", credits:3000, popular:true, unit:"switched",
    blurb:"A production reserve for image, voice and video work.",
    test:"https://buy.stripe.com/test_8x200l63a2zVfpO9Dlc7u03",
    live:"https://buy.stripe.com/5kQ6oJ63a0rN5PeeXFc7u08" },
];
window.CINEMA_CREDIT_PACKS = CREDIT_PACKS;
/* THE CURRENT PACKS, until the switch (repair 2026-09-30): during the 30-day notice nobody could buy
   credits — the new packs wait for the switch day and the old links had been dropped — while the
   low-balance banner and the Stage said "top up with a credit pack". So the three packs on sale
   today (their links and amounts exactly as they were, git HEAD app/plans.jsx) show while the
   server says the switch has NOT happened. They are counted in the old unit: a pack bought during
   the notice is a 12-month lot of 300 / 1,200 / 4,000 old credits, and billing-switch.sql
   multiplies every lot by 3 like every balance (900 / 3,600 / 12,000), so its value is kept. The
   owner deactivates these three links right after running billing-switch.sql (owner runbook). */
const LEGACY_CREDIT_PACKS = [
  { sku:"credits-300", name:"300 credits", price:"$9", credits:300, unit:"legacy",
    blurb:"A quick top-up for extra drafts or a few more renders.",
    test:"", live:"https://buy.stripe.com/8x200l63a2zVfpO9Dlc7u03" },
  { sku:"credits-1200", name:"1,200 credits", price:"$29", credits:1200, popular:true, unit:"legacy",
    blurb:"Enough room for a heavier design or production pass.",
    test:"", live:"https://buy.stripe.com/9B6cN73V28YjfpO02Lc7u04" },
  { sku:"credits-4000", name:"4,000 credits", price:"$79", credits:4000, unit:"legacy",
    blurb:"A production reserve for image, voice and video work.",
    test:"", live:"https://buy.stripe.com/8x200l77e1vR4La7vdc7u05" },
];
window.TURN_LEGACY_CREDIT_PACKS = LEGACY_CREDIT_PACKS;
/* the packs the Plans window offers right now: the old ones while the server says the switch
   hasn't happened, the new ones from the switch day — and, while the unit isn't known yet, the new
   ones with every button disabled (packOnSale) */
function activeCreditPacks(){
  return (creditRegimeKnown() && !creditUnitSwitched()) ? LEGACY_CREDIT_PACKS : CREDIT_PACKS;
}
window.turnActiveCreditPacks = activeCreditPacks;
/* a pack can open a checkout only when its link exists, the live unit is known, and the pack is
   counted in THAT unit (a new pack before the switch would be tripled by billing-switch.sql; an old
   one after it would grant a third of its price) */
function packOnSale(pack){
  if(!pack || !checkoutLink(pack) || !creditRegimeKnown()) return false;
  return (pack.unit==="legacy") ? !creditUnitSwitched() : creditUnitSwitched();
}
window.turnPackOnSale = packOnSale;

/* ---- admin-editable plan-card COPY (name / blurb / features / most-popular) -------
   Price & credits are NOT editable here — Stripe owns them (product price +
   plan_credits metadata), so the card can never misrepresent the real charge/grant.
   Copy overrides persist globally via cloudSaveAppConfig("plans-copy", …) and every
   visitor reads them; a version bump re-renders any mounted plan surface + landing. */
let _plansVersion = 0;
const _plansListeners = new Set();
function _bumpPlans(){ _plansVersion++; _plansListeners.forEach(fn=>{ try{ fn(); }catch(e){} }); }
window.usePlansVersion = function(){
  const [, force] = React.useState(0);
  React.useEffect(()=>{ const fn=()=>force(v=>v+1); _plansListeners.add(fn); return ()=>_plansListeners.delete(fn); },[]);
  return _plansVersion;
};
/* A saved feature line that states a monthly credit number ("800 credits / month") is
   rewritten to the plan's CURRENT allowance: credits are Stripe-owned, never admin copy, so
   an override saved before Option A can't advertise the old grant. */
const CREDIT_LINE_RE = /^\s*[\d][\d,.\s]*\s*credits?\s*(\/|per|a)\s*month\b/i;
/* while the live unit isn't known yet (no server read, no saved copy) the cards name no number —
   800 or 600 would be a guess — and read this neutral line until the read lands */
const PLAN_CREDIT_PLACEHOLDER = "Monthly credits included";
window.TURN_PLAN_CREDIT_PLACEHOLDER = PLAN_CREDIT_PLACEHOLDER;
function isPlanCreditLine(x){ return CREDIT_LINE_RE.test(x) || String(x).trim()===PLAN_CREDIT_PLACEHOLDER; }
function planCreditLine(plan){
  return creditRegimeKnown() ? Number(plan.credits).toLocaleString("en-US")+" credits / month" : PLAN_CREDIT_PLACEHOLDER;
}
/* the cards follow the live credit unit: the allowance and its "N credits / month" line */
function applyCreditRegimeToPlans(){
  const set = creditUnitSwitched() ? PLAN_ALLOWANCES.switched : PLAN_ALLOWANCES.legacy;
  PLANS.forEach(p=>{
    if(set[p.tier]) p.credits = set[p.tier];
    p.features = (p.features||[]).map(x=> isPlanCreditLine(x) ? planCreditLine(p) : x);
  });
}
applyCreditRegimeToPlans();
try{ window.addEventListener("turn-credit-regime-changed", ()=>{ applyCreditRegimeToPlans(); _bumpPlans(); }); }catch(e){}
/* apply { writer:{name,blurb,features[],popular}, … } onto the live PLANS copy */
window.turnApplyPlanCopy = function(ov){
  if(!ov || typeof ov!=="object") return;
  let popularTier = null;
  PLANS.forEach(p=>{
    const o = ov[p.tier]; if(!o) return;
    if(typeof o.name==="string" && o.name.trim()) p.name = legacyPlanName(p.tier, o.name.trim());
    if(typeof o.blurb==="string") p.blurb = o.blurb;
    if(Array.isArray(o.features)) p.features = o.features.map(x=>String(x)).filter(x=>x.trim())
      .map(x=> isPlanCreditLine(x) ? planCreditLine(p) : x);
    if(o.popular) popularTier = p.tier;
  });
  if(popularTier!=null) PLANS.forEach(p=>{ p.popular = (p.tier===popularTier); });  // exactly one "most popular"
  _bumpPlans();
};
/* snapshot the current editable copy (for the editor's working state) */
window.turnPlanCopy = function(){ const o={}; PLANS.forEach(p=>{ o[p.tier]={ name:p.name, blurb:p.blurb, features:(p.features||[]).slice(), popular:!!p.popular }; }); return o; };

/* Pick the right Payment Link for the current origin.
   - Production host: the LIVE link, or "" if not set yet (NEVER fall back to a
     test checkout on a real domain — a "" makes startCheckout show a soft notice).
   - Anywhere else (localhost, *.replit.dev preview): the TEST link, so dev/preview
     testing can never touch a real card. */
function checkoutLink(item){
  let host = "";
  try{ host = (window.location && window.location.hostname || "").toLowerCase(); }catch(e){}
  const isLiveHost = LIVE_HOSTS.indexOf(host) >= 0;
  return isLiveHost ? (item.live || "") : item.test;
}
function planLink(plan){
  return checkoutLink(plan);
}
window.turnPlanLink = planLink;
window.turnCreditPackLink = checkoutLink;

/* ---- PER-TIER ENTITLEMENTS — the checkout copy, made true in the app. ----------
   Enforced in room navigation:
     Writer   → Writers' Room
     Director → Writers' Room + Art Room
     Studio   → Writers' Room + Art Room + Stage   (tier id "studio", shown as "Producer")
   Enforced inside the Stage too (model picker, resolution ladder, takes-per-Generate):
     Writer   → Kling only, up to 720p, single take
     Director → every model, up to 1080p, single take
     Studio   → every model, 4K, batch takes (up to 4)
   Admin bypasses all gates. No ledger info (local/dev — balance not loaded) also
   bypasses: server-side credit spend still protects money there. A cancelled
   plan ("none") keeps its remaining credits at Writer-level access. */
const RES_RANK = { "480p":0, "720p":1, "1080p":2, "4K":3 };
const TIER_GATES = {
  writer:   { models:["kling-3.0"], maxRes:"720p",  maxBatch:1 },
  none:     { models:["kling-3.0"], maxRes:"720p",  maxBatch:1 },
  pro:      { models:"all",         maxRes:"1080p", maxBatch:1 }, // legacy tier name; treated as Director
  director: { models:"all",         maxRes:"1080p", maxBatch:1 },
  studio:   { models:"all",         maxRes:"4K",    maxBatch:4 },
};
const OPEN_GATE = { tier:"open", models:"all", maxRes:"4K", maxBatch:4 };
const ROOM_ENTITLEMENTS = {
  writer:   { writers_room:true, art_room:false, stage:false },
  none:     { writers_room:true, art_room:false, stage:false },
  free:     { writers_room:false, art_room:false, stage:false },
  pro:      { writers_room:true, art_room:true,  stage:false },
  director: { writers_room:true, art_room:true,  stage:false },
  studio:   { writers_room:true, art_room:true,  stage:true },
};
const OPEN_ROOM_ENTITLEMENTS = { writers_room:true, art_room:true, stage:true };
function _roomTier(balanceOrTier){
  if(typeof balanceOrTier==="string") return balanceOrTier.toLowerCase().trim();
  const b = balanceOrTier || window.turnCreditBalance || null;
  if(!b) return "open";
  return String(b.plan || b.tier || "none").toLowerCase().trim();
}
window.turnRoomEntitlements = function(balanceOrTier){
  if(window.turnIsAdmin) return { ...OPEN_ROOM_ENTITLEMENTS };
  const tier = _roomTier(balanceOrTier);
  if(tier==="open") return { ...OPEN_ROOM_ENTITLEMENTS };
  const e = ROOM_ENTITLEMENTS[tier] || ROOM_ENTITLEMENTS.none;
  return { ...e };
};
window.turnRoomRequiredPlan = function(room){
  const r = String(room||"").toLowerCase();
  if(r==="art" || r==="art_room") return planDisplayName("director");
  if(r==="stage") return planDisplayName("studio");
  return "Writer";
};
window.turnTierGates = function(balance){
  if(window.turnIsAdmin) return OPEN_GATE;
  const bal = (balance!==undefined) ? balance : window.turnCreditBalance;
  if(!bal) return OPEN_GATE;
  const plan = String(bal.plan||"none").toLowerCase();
  const g = TIER_GATES[plan] || TIER_GATES.none;
  return { tier:plan, models:g.models, maxRes:g.maxRes, maxBatch:g.maxBatch };
};
window.turnGateAllowsModel = function(g, modelId){
  return !g || g.models==="all" || g.models.indexOf(modelId)>=0;
};
window.turnGateAllowsRes = function(g, r){
  const rank = RES_RANK[r]; if(rank==null) return true;
  return !g || rank <= (RES_RANK[g.maxRes]!=null ? RES_RANK[g.maxRes] : 3);
};
/* which plan unlocks a locked thing — for "needs the X plan" copy */
window.turnPlanForRes = function(r){ return (RES_RANK[r]>=3) ? planDisplayName("studio") : (RES_RANK[r]>=2) ? planDisplayName("director") : null; };

/* ---- BALANCE PARTS — plan credits, pack credits and the account's billing state. -----
   turn_credit_balance() returns remaining, plan, plan_remaining, pack_remaining,
   next_pack_expiry, payment_status, frozen, trial (app/cloud.jsx shapes them). Against a
   database that hasn't run the pack migration only remaining + plan exist: every extra
   field is then null/false and the readouts fall back to the single total. */
function _isPaidTier(plan){
  const p = String(plan||"").toLowerCase().trim();
  if(typeof window.turnIsPaidPlan==="function") return !!window.turnIsPaidPlan(p) && p!=="trial";
  return !!p && p!=="none" && p!=="free" && p!=="trial";
}
function _num(v){ const n = Number(v); return (v===null || v===undefined || v==="" || !Number.isFinite(n)) ? null : n; }
function balanceParts(balance){
  const b = balance || null;
  if(!b) return null;
  const total = _num(b.remaining);
  const plan = _num(b.planRemaining!=null ? b.planRemaining : b.plan_remaining);
  const pack = _num(b.packRemaining!=null ? b.packRemaining : b.pack_remaining);
  const expiryRaw = b.nextPackExpiry!=null ? b.nextPackExpiry : b.next_pack_expiry;
  const expiry = expiryRaw ? new Date(expiryRaw) : null;
  const status = String((b.paymentStatus!=null ? b.paymentStatus : b.payment_status) || "").toLowerCase();
  return {
    total: total==null ? ((plan||0)+(pack||0)) : total,
    plan, pack,
    hasSplit: plan!=null && pack!=null,
    nextPackExpiry: (expiry && !isNaN(expiry.getTime())) ? expiry : null,
    paymentStatus: status || "active",
    pastDue: status==="past_due",
    frozen: b.frozen===true,
    trial: b.trial===true && !_isPaidTier(b.plan),
    paid: _isPaidTier(b.plan),
    tier: String(b.plan||"none").toLowerCase().trim(),
    allowance: _num(b.allowance!=null ? b.allowance : b.plan_allowance),
    // credits held by jobs still running (turn_credit_balance's last column, billing round 2): they
    // are part of the balance until the job settles and gives the unused part back. heldKnown: the
    // ledger REPORTS holds (0 included), so remaining + held is exact even while calls run.
    held: Math.max(0, _num(b.held!=null ? b.held : b.open_holds) || 0),
    heldKnown: _num(b.held!=null ? b.held : b.open_holds)!=null,
  };
}
window.turnBalanceParts = balanceParts;
function fmtCredits(n){ return (Number(n)||0).toLocaleString("en-US"); }
function fmtDate(d){
  try{ return d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" }); }
  catch(e){ return d.toISOString().slice(0,10); }
}
/* "1,234 credits · 1,000 plan + 234 pack (pack credits expire from 12 Sep 2027)" — the one
   readout every surface uses (Plans window, Stage footer tooltip, account menu). */
function creditBreakdownText(balance){
  const p = balanceParts(balance);
  if(!p) return "";
  let s = fmtCredits(p.total)+" credit"+(p.total===1?"":"s");
  if(p.hasSplit && p.pack>0){
    s += " · "+fmtCredits(p.plan)+" plan + "+fmtCredits(p.pack)+" pack";
    if(p.nextPackExpiry) s += " (pack credits expire from "+fmtDate(p.nextPackExpiry)+")";
  }
  return s;
}
window.turnCreditBreakdownText = creditBreakdownText;
/* just the split — "1,000 plan + 234 pack (pack credits expire from 12 Sep 2027)" — or "" when
   there are no pack credits (the account menu adds it after its own total) */
function creditSplitText(balance){
  const p = balanceParts(balance);
  if(!p || !p.hasSplit || !(p.pack>0)) return "";
  return fmtCredits(p.plan)+" plan + "+fmtCredits(p.pack)+" pack"
    + (p.nextPackExpiry ? " (pack credits expire from "+fmtDate(p.nextPackExpiry)+")" : "");
}
window.turnCreditSplitText = creditSplitText;
/* GRANDFATHERING, told (integration 2026-09-30): for 30 days after the switch a subscriber who was
   already paying keeps the old allowance in the new units (LEGACY_ALLOWANCES) — the Plans window
   says until when. Shown only while turn_credit_regime().legacy_until is ahead and this period's
   allowance (turn_credit_balance plan_allowance) is the old one; "" otherwise. */
function legacyAllowanceNote(balance, nowMs){
  const p = balanceParts(balance);
  if(!p || !p.paid) return "";
  const r = (typeof window.turnCreditRegime==="function") ? window.turnCreditRegime() : null;
  if(!r || !r.switched || !r.legacyUntil) return "";
  const until = new Date(r.legacyUntil);
  if(isNaN(until.getTime()) || until.getTime() <= (Number(nowMs) || Date.now())) return "";
  const tier = p.tier==="pro" ? "director" : p.tier;
  const legacy = LEGACY_ALLOWANCES[tier], next = PLAN_ALLOWANCES.switched[tier];
  if(!legacy || !next || !(p.allowance >= legacy)) return "";
  return "Your monthly allowance stays "+fmtCredits(legacy)+" credits until "+fmtDate(until)+"; renewals after that give "+fmtCredits(next)+".";
}
window.turnLegacyAllowanceNote = legacyAllowanceNote;

/* ---- DRAFT IMAGES for trial / no-plan accounts. Admin and an unloaded ledger (local/dev)
   are never limited — the server stays the real gate. */
const IMG_RES_RANK = { "1K":0, "2K":1, "4K":2 };
function draftImagesOnly(balance){
  if(window.turnIsAdmin) return false;
  const b = balance!==undefined ? balance : window.turnCreditBalance;
  if(!b) return false;
  return !_isPaidTier(b.plan);
}
window.turnDraftImagesOnly = draftImagesOnly;
/* the same test under a general name, for any surface that offers something a free-tier
   account can't use (voice, video, 3D, premium writing engines): true = hide or lock it */
window.turnOnFreeTier = draftImagesOnly;
window.turnTextModelAllowed = function(modelId, balance){
  return !draftImagesOnly(balance) || TRIAL_TEXT_MODELS.indexOf(String(modelId||""))>=0;
};
/* the image engine + resolution this account may actually use for a request */
function planImageChoice(model, res, balance){
  if(!draftImagesOnly(balance)) return { model, res, limited:false };
  const r = String(res||"2K");
  const capped = (IMG_RES_RANK[r]!=null && IMG_RES_RANK[r] > IMG_RES_RANK[DRAFT_IMAGE.maxRes]) ? DRAFT_IMAGE.maxRes : (IMG_RES_RANK[r]!=null ? r : "1K");
  return { model:DRAFT_IMAGE.model, res:capped, limited: model!==DRAFT_IMAGE.model || capped!==r };
}
window.turnPlanImageChoice = planImageChoice;

/* ---- THE PLAN A VISITOR PICKED BEFORE SIGNING UP → checkout (pure decision; app.jsx acts).
   Two copies of the choice: this browser's localStorage (valid 20 minutes, as before) and
   the account's user metadata saved at sign-up (valid 48 hours — it survives an email
   confirmed later or in another browser). Returns { action:"checkout", plan } | "wait"
   (ledger not loaded yet) | "clear" (stale, or the account is already on a paid plan: never
   a second checkout) | "none" (nothing to do). */
const INTENT_LOCAL_MS = 20*60*1000;
const INTENT_ACCOUNT_MS = 48*3600*1000;
function pickIntendedPlan(o){
  o = o || {};
  const tiers = PLANS.map(p=>p.tier);
  const now = Number(o.now) || Date.now();
  const local = String(o.local||"").toLowerCase().trim();
  const acct = o.account && typeof o.account==="object" ? o.account : null;
  const localOk = tiers.indexOf(local)>=0 && Number(o.localAt)>0 && (now-Number(o.localAt)) < INTENT_LOCAL_MS;
  const acctOk = !!acct && tiers.indexOf(String(acct.plan||""))>=0 && Number(acct.at)>0 && (now-Number(acct.at)) < INTENT_ACCOUNT_MS;
  const anything = (local && local!=="free") || !!acct;
  if(!localOk && !acctOk) return { action: anything ? "clear" : "none" };
  if(!o.balanceReady) return { action:"wait" };
  if(o.isAdmin || (o.balance && _isPaidTier(o.balance.plan))) return { action:"clear", reason:"already-on-a-plan" };
  return { action:"checkout", plan: localOk ? local : String(acct.plan) };
}
window.turnPickIntendedPlan = pickIntendedPlan;
/* is a plan picked before sign-up still waiting in THIS browser (app.jsx's local copy, valid
   INTENT_LOCAL_MS)? The sign-in window then shows the chosen plan and the 14-day note in BOTH of its
   modes (auth-ui.jsx): after "Check your email to confirm, then sign in", or a switch to "Sign in",
   the checkout still opens by itself — while a stale copy left from an earlier visit doesn't promise one
   (review 2026-10-02). */
function intendedPlanWaiting(now){
  try{
    const p = String(localStorage.getItem("turn-intended-plan")||"").toLowerCase().trim();
    const at = Number(localStorage.getItem("turn-intended-plan-at")||0);
    const n = Number(now) || Date.now();
    return PLANS.some(x=>x.tier===p) && at>0 && (n-at) < INTENT_LOCAL_MS;
  }catch(e){ return false; }
}
window.turnIntendedPlanWaiting = intendedPlanWaiting;

/* ---- MANAGE PLAN — the billing portal when the account menu's workflow provides it
   (window.turnOpenBillingPortal), else the Plans window. */
function openManagePlan(){
  if(typeof window.turnOpenBillingPortal==="function"){ try{ window.turnOpenBillingPortal(); return; }catch(e){} }
  if(typeof window.turnOpenPlans==="function") window.turnOpenPlans();
}
window.turnOpenManagePlan = openManagePlan;

/* ---- SERVER BILLING REFUSALS → one calm sentence. The server gates every paid call and
   answers { error:<code>, code:<code>, message } (image-proxy billing-policy.mjs refusal()):
   402 no_plan / plan_required / insufficient_credits, 403 account_frozen / tier_required,
   409 price_changed (the render costs more than the quote), 503 billing_unavailable. The
   server's own sentence is used when it sends one (it is written for users); the fallbacks
   below cover an older deploy. Returns { code, message, openPlans } or null when the reply
   isn't a refusal. */
const BILLING_CODES = {
  no_plan:              { message:"Choose a plan to start creating — every generation runs on your plan's credits.", openPlans:true },
  insufficient_credits: { message:"Not enough credits for this. Top up with a credit pack or upgrade your plan.", openPlans:true },
  insufficient:         { message:"Not enough credits for this. Top up with a credit pack or upgrade your plan.", openPlans:true },
  frozen:               { message:"Your account is on hold while a payment is disputed, so spending credits is paused. Write to "+BILLING_EMAIL+" if this is a mistake.", openPlans:false },
  account_frozen:       { message:"Your account is on hold while a payment is disputed, so spending credits is paused. Write to "+BILLING_EMAIL+" if this is a mistake.", openPlans:false },
  plan_required:        { message:"This needs a paid plan. Without a plan, credits cover writing and draft images.", openPlans:true },
  tier_required:        { message:"Your plan doesn't include this. Upgrade to use it.", openPlans:true },
  trial_not_allowed:    { message:"This needs a paid plan. Without a plan, credits cover writing and draft images.", openPlans:true },
  price_changed:        { message:"This costs more than the price shown. Check the settings and try again.", openPlans:false },
  billing_unavailable:  { message:"Credits can't be checked right now. Please try again in a minute.", openPlans:false },
};
function billingError(body, status){
  const b = (body && typeof body==="object") ? body : {};
  let code = String(b.code || b.errorCode || b.error || "").toLowerCase().trim();
  // the database's own refusal text (turn_spend_credit / turn_record_usage_event on a frozen
  // account: "CREDITS_FROZEN: …") reads as the on-hold sentence, never as raw text
  if(/CREDITS_FROZEN/.test(String(b.message||"")+" "+String(b.error||""))) code = "account_frozen";
  const known = BILLING_CODES[code];
  const serverMsg = typeof b.message==="string" && b.message.trim() ? b.message.trim() : "";
  if(known) return { code, message: (serverMsg && !/CREDITS_FROZEN/.test(serverMsg)) ? serverMsg : known.message, openPlans:known.openPlans };
  if(Number(status)===402) return { code:"payment_required", message: serverMsg || BILLING_CODES.insufficient.message, openPlans:true };
  // the gate's other two refusals ({ error:code, code, message }) — not billing, but their
  // sentence beats showing the bare code. Provider errors are never matched here (the Stage
  // classifies those itself).
  if((code==="model_not_allowed" || code==="bad_request") && serverMsg && String(b.error||"").toLowerCase()===code)
    return { code, message: serverMsg, openPlans:false };
  return null;
}
window.turnBillingError = billingError;
/* show the refusal once: routes credit/plan refusals to the Plans window (a frozen account
   gets the banner instead). Returns the message for the caller's own error surface. */
function handleBillingError(info){
  if(!info) return "";
  if(info.openPlans && typeof window.turnOpenPlans==="function"){ try{ window.turnOpenPlans(); }catch(e){} }
  try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason:"billing-refusal", code:info.code } })); }catch(e){}
  return info.message;
}
window.turnHandleBillingError = handleBillingError;

/* ---- LOW-BALANCE NOTICES — in-app at 20% and 5% of the monthly allowance, dismissible,
   once per level per cycle. Pure step function (state in → state out) so it is testable;
   BillingNotices persists the state per account.
   - allowance: the server's (if turn_credit_balance ever returns one), else the larger of
     the plan's allowance and the highest plan balance seen this cycle — which reads a
     grandfathered balance (7,200 on Director) correctly; a trial's allowance is 50.
   - a new CYCLE starts when the plan changes or the plan balance jumps up by 30% of the
     allowance or more (a renewal, an upgrade, the switch-day x3); dismissals reset then.
   - the level is judged on everything spendable (plan + pack credits) plus any credits the
     server reports as held by running jobs.
   - NO FLICKER DURING A HOLD (repair 2026-09-30): every paid call HOLDS its most-possible cost
     first (a writing call 33+ credits) and gives the unused part back when it settles, and the
     balance readout follows both live. An account near a line used to get the banner on during
     each call and off after it.
     · When the ledger reports the held credits (turn_credit_balance's `held` column, billing
       round 2), remaining + held doesn't move while a call runs, so the level is exact and shows
       at once.
     · Without it (an older database), a level REACHED LIVE in this page session (a drop from a
       better level moments ago) waits, and is confirmed only once the balance has SAT STILL for
       LOW_SETTLE_MS (billing round 3): every reading that moves it — another hold going out, a
       settle coming back — restarts the wait, because readings bunch together (overlapping
       fetches) and one fall can stand for several holds, so counting falls and rises can't tell
       when every hold is back. A rise that returns the balance to where it was before the first
       fall (every hold came back) ends the wait at once; so does the level lifting. Three calls at
       once on 1,600 — 380 → 347 → 314 → 281 → 304 → 327 → 350, or bunched as 380 → 281 → 281 →
       281 → 304 → 327 → 350 — never show the banner; a real drop shows after the wait (a long
       render that holds for minutes too) — the component re-renders then (recheckInMs). A reading
       that finds the account already low (the first one in a page session) shows at once.
   opts: { now, session } — the clock and this page session's id (both injectable for tests). */
const LOW_SETTLE_MS = 150*1000;
const LOW_SESSION = "s"+Math.random().toString(36).slice(2,10);
const _lowSev = (lv)=> lv===5 ? 2 : lv===20 ? 1 : 0;
function lowBalanceStep(prev, balance, opts){
  const o = (opts && typeof opts==="object") ? opts : {};
  const now = Number(o.now) || Date.now();
  const session = String(o.session || LOW_SESSION);
  const p = balanceParts(balance);
  const empty = { key:"", peak:0, lastPlan:0, dismissed:{} };
  if(!p || window.turnIsAdmin) return { state: prev || empty, level:0, allowance:0, recheckInMs:0 };
  const key = p.paid ? p.tier : (p.trial ? "trial" : "none");
  const planBal = p.plan!=null ? p.plan : p.total;
  const s = (prev && prev.key===key) ? { ...prev, dismissed:{ ...(prev.dismissed||{}) } } : { key, peak:0, lastPlan:planBal, dismissed:{} };
  const base = p.paid ? ((PLANS.find(x=>x.tier===key)||{}).credits || LEGACY_ALLOWANCES[key] || 0) : (p.trial ? TRIAL_CREDITS : 0);
  if(!base) return { state:{ ...s, lastPlan:planBal, raw:0, settleUntil:0 }, level:0, allowance:0, recheckInMs:0 };
  if(planBal - (Number(s.lastPlan)||0) >= 0.3*Math.max(base, Number(s.peak)||0)){
    s.peak = planBal; s.dismissed = {};
  }
  s.peak = Math.max(Number(s.peak)||0, planBal);
  s.lastPlan = planBal;
  const allowance = p.allowance>0 ? p.allowance : (p.paid ? Math.max(base, s.peak) : base);
  const spendable = p.total + p.held;
  const pct = allowance>0 ? spendable/allowance : 1;
  const raw = pct<=0.05 ? 5 : pct<=0.20 ? 20 : 0;
  // settle rule (see above): only a WORSENING seen live in this page session waits
  const live = !!prev && prev.key===key && prev.session===session;
  const prevRaw = live ? (Number(prev.raw)||0) : raw;
  const prevTotal = live ? Number(prev.lastTotal) : spendable;
  const dir = !Number.isFinite(prevTotal) || spendable===prevTotal ? 0 : (spendable < prevTotal ? -1 : 1);
  // the balance AT REST before the current burst of holds (the "pre-fall" level): the reading it
  // last sat still at for LOW_SETTLE_MS, raised by any rise above it (a top-up)
  let lastAt = live ? (Number(prev.lastAt)||now) : now;
  let rest = live && Number.isFinite(Number(prev.rest)) ? Number(prev.rest) : (Number.isFinite(prevTotal) ? prevTotal : spendable);
  if(live && now - lastAt > LOW_SETTLE_MS && Number.isFinite(prevTotal)) rest = prevTotal;
  if(spendable > rest) rest = spendable;
  if(dir!==0 || !live) lastAt = now;
  let settleUntil = live ? (Number(prev.settleUntil)||0) : 0;
  let before = live ? (Number(prev.before)||0) : 0;
  if(p.heldKnown) settleUntil = 0;   // the ledger reports holds: the level is exact, nothing to wait for
  else if(_lowSev(raw) > _lowSev(prevRaw)){ settleUntil = now + LOW_SETTLE_MS; before = live ? (Number(prev.shown)||0) : 0; }
  else if(_lowSev(raw) < _lowSev(prevRaw)) settleUntil = 0;
  // while waiting, a reading that moves restarts the wait (the balance must sit still), unless a
  // rise brought it back to where it was before the holds (every hold came back): then it is real
  else if(settleUntil > now && dir!==0) settleUntil = (dir>0 && spendable>=rest) ? 0 : now + LOW_SETTLE_MS;
  const waiting = settleUntil > now;
  if(!waiting) settleUntil = 0;
  let level = waiting ? (_lowSev(before) < _lowSev(raw) ? before : raw) : raw;
  s.session = session; s.raw = raw; s.settleUntil = settleUntil; s.before = waiting ? before : 0;
  s.lastTotal = spendable; s.shown = level; s.rest = rest; s.lastAt = lastAt;
  delete s.pend;   // the round-2 hold counter (a saved state may still carry it)
  if(level===5 && s.dismissed[5]) level = 0;
  if(level===20 && s.dismissed[20]) level = 0;
  return { state:s, level, allowance, recheckInMs: waiting ? (settleUntil - now) : 0 };
}
window.turnLowBalanceStep = lowBalanceStep;
function lowBalanceDismiss(state, level){
  const s = { ...(state||{}), dismissed:{ ...((state&&state.dismissed)||{}) } };
  s.dismissed[level] = true;
  if(level===5) s.dismissed[20] = true;   // the 5% notice supersedes the 20% one
  return s;
}
window.turnLowBalanceDismiss = lowBalanceDismiss;

/* ---- THE 14-DAY RIGHT TO CANCEL, NEXT TO EVERY PURCHASE BUTTON (owner decision 2026-10-02, E1) ----
   Every buyer gets it (the Terms, "Your right to cancel": within 14 days of buying a plan or a pack
   the customer can cancel and gets back the UNUSED part — the credits from that purchase not yet
   used, in proportion; the webhook removes that share when the owner refunds it).
   NO EXTRA STEP (owner, 2026-10-02: "we don't need to create friction with potential customers"):
   the "Before you pay" dialog and its checkbox (v2-2026-10-01) are gone. Instead one short line
   with a link to the Terms' cancel section goes with every plan and pack purchase: behind a small
   info (ⓘ) button right after each plan's and pack's NAME (owner request 2026-10-02, R2: CheckoutTip
   below) on the Plans window's plan cards and pack cards and the homepage's plan cards (they lead to
   checkout after sign-up: landing.jsx) — each purchase button's aria-describedby points at it — and
   right under the chosen plan in the sign-up window (auth-ui.jsx, checkoutNote). Clicking the
   button IS the request to start straight away: startCheckout records it on the server
   (turn_record_checkout_consent(sku, CHECKOUT_CONSENT_VERSION), supabase/tax-compliance.sql: who,
   which sku, which wording, when) right before the payment page opens. A database without that
   function (the SQL not run yet), an error, no cloud or a slow answer never blocks the purchase.
   The plan picked before sign-up opens by itself (app.jsx, no click in this page): it shows the
   same line in a notice first and keeps it on screen long enough to read (CHECKOUT_NOTICE_MIN_MS,
   inside the info notice's 5 s life in app/ai.jsx) before this tab moves, and records it as
   CHECKOUT_CONSENT_VERSION_AUTO — no button was clicked at that moment; the buyer saw the line
   under the chosen plan in the sign-in window (auth-ui.jsx) and in the notice (review 2026-10-02).
   Change the wording → change the versions, and the Terms page with them. */
const CHECKOUT_NOTE_TEXT = "Starts straight away. Cancel within 14 days and you get back the part you haven't used.";
const CHECKOUT_TERMS_HREF = "/terms.html#cancel";
const CHECKOUT_CONSENT_VERSION = "v3-2026-10-02-click";
const CHECKOUT_CONSENT_VERSION_AUTO = "v3-2026-10-02-auto";   // the post-sign-up auto-checkout (no click)
const CONSENT_RECORD_WAIT_MS = 2500;   // the same-tab path waits this long for the record, then goes anyway
const CHECKOUT_NOTICE_MIN_MS = 4500;   // …and keeps its notice (about 20 words) on screen at least this long first
window.TURN_CHECKOUT_NOTE_TEXT = CHECKOUT_NOTE_TEXT;
window.TURN_CHECKOUT_CONSENT_VERSION = CHECKOUT_CONSENT_VERSION;
window.TURN_CHECKOUT_CONSENT_VERSION_AUTO = CHECKOUT_CONSENT_VERSION_AUTO;
window.TURN_CHECKOUT_NOTICE_MIN_MS = CHECKOUT_NOTICE_MIN_MS;
/* Are the Terms with the "Your right to cancel" section (id "cancel") live? They go live on the switch
   day, the same day TERMS_UPDATED_AT (below) is set. Until then the note's Terms link lands on the
   current Terms, which say nothing about cancelling — so the note also gives the way to cancel, the
   billing address (review 2026-10-02; the removed dialog was the only place that said it). */
function cancelSectionLive(){
  const s = String(TERMS_UPDATED_AT==null ? "" : TERMS_UPDATED_AT).trim();
  return !!s && Number.isFinite(Date.parse(s));
}
window.turnCancelSectionLive = cancelSectionLive;
/* the note's content: the line, the Terms link and — until the cancel section is live — the way to cancel */
function checkoutNoteParts(){
  const howToCancel = cancelSectionLive() ? [] : [" · To cancel, email ",
    React.createElement("a",{key:"mail",className:"checkout-note-mail",href:"mailto:"+BILLING_EMAIL},BILLING_EMAIL)];
  return [CHECKOUT_NOTE_TEXT+" ",
    React.createElement("a",{key:"terms",href:CHECKOUT_TERMS_HREF,target:"_blank",rel:"noopener"},"Terms"),
    ...howToCancel];
}
/* the line itself, as a visible line: under the chosen plan in the sign-up window (auth-ui.jsx). `id`
   lets a button point at it (aria-describedby); `extra` adds a surface's own class. */
function checkoutNote(id, extra){
  return React.createElement("p",{className:"checkout-note"+(extra ? " "+extra : ""), id: id || undefined},
    ...checkoutNoteParts());
}
window.turnCheckoutNote = checkoutNote;
/* THE NOTE BEHIND AN INFO (ⓘ) BUTTON, right after a plan's or pack's name (owner request 2026-10-02,
   R2: "Turn this text … into a tooltip, and place it to the right of every plan's name"): the Plans
   window's plan cards and pack cards and the homepage's plan cards. The popup shows exactly the note
   (checkoutNoteParts). It stays in the page while closed (hidden), carrying `id`, so a purchase button's
   aria-describedby can point at it: directly referenced hidden content is still read with the button.
   Opens on hover (a mouse) and on keyboard focus (:focus-visible — not the focus a click or a tap
   gives); a click or tap toggles it (it stays open until the next one); closes on Escape (focus goes
   back to the ⓘ when it was on the link), when focus leaves it and on a click or tap outside; focus
   inside (the Terms link) keeps it open. It opens under the ⓘ, shifted sideways to stay inside the
   window and every card or scroll box around it, and above the ⓘ when there is no room below — checked
   again as the page scrolls or the window resizes (watchCheckoutTip). */
const CHECKOUT_TIP_LABEL = "About starting straight away and cancelling";
window.TURN_CHECKOUT_TIP_LABEL = CHECKOUT_TIP_LABEL;
const CHECKOUT_TIP_MARGIN = 8;   // px kept free between the popup and the edge of what would clip it
let _checkoutTipSeq = 0;
/* the visible box the popup must stay inside: the window, cut down by every ancestor that clips or scrolls */
function checkoutTipBounds(node){
  const M = CHECKOUT_TIP_MARGIN;
  const b = { left:M, top:M, right:(window.innerWidth||0)-M, bottom:(window.innerHeight||0)-M };
  for(let p = node && node.parentElement; p && p!==document.body && p!==document.documentElement; p = p.parentElement){
    const cs = window.getComputedStyle(p);
    if(!/(auto|scroll|hidden|clip)/.test(cs.overflowX+" "+cs.overflowY)) continue;
    const r = p.getBoundingClientRect();
    b.left = Math.max(b.left, r.left+M); b.top = Math.max(b.top, r.top+M);
    b.right = Math.min(b.right, r.right-M); b.bottom = Math.min(b.bottom, r.bottom-M);
  }
  return b;
}
/* centred under the ⓘ, then nudged sideways (--tip-dx; the caret stays on the ⓘ) and flipped up if needed */
function placeCheckoutTip(wrap, pop){
  if(!wrap || !pop || typeof pop.getBoundingClientRect!=="function") return;
  pop.style.setProperty("--tip-dx","0px"); pop.removeAttribute("data-place");
  const b = checkoutTipBounds(wrap), r = pop.getBoundingClientRect();
  let dx = 0;
  if(r.left < b.left || r.width > b.right-b.left) dx = b.left - r.left;
  else if(r.right > b.right) dx = b.right - r.right;
  if(dx) pop.style.setProperty("--tip-dx", Math.round(dx)+"px");
  const w = wrap.getBoundingClientRect();
  if(r.bottom > b.bottom && w.top - CHECKOUT_TIP_MARGIN - r.height >= b.top) pop.setAttribute("data-place","up");
}
window.turnPlaceCheckoutTip = placeCheckoutTip;
/* while the popup is open: place it again when the window resizes and whenever anything scrolls (once a
   frame; a capture listener sees every scroll box). Keyboard focus opens it while the homepage is still
   smooth-scrolling the ⓘ into view, so the first up/down choice is made with the ⓘ off-screen (review
   2026-10-02): it must follow the ⓘ to where the scroll ends. Returns the clean-up. */
function watchCheckoutTip(place){
  let frame = 0;
  const onScroll = ()=>{
    if(frame) return;
    if(typeof window.requestAnimationFrame!=="function"){ place(); return; }
    frame = window.requestAnimationFrame(()=>{ frame = 0; place(); });
  };
  window.addEventListener("resize", place);
  window.addEventListener("scroll", onScroll, true);
  return ()=>{
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", onScroll, true);
    if(frame && typeof window.cancelAnimationFrame==="function") window.cancelAnimationFrame(frame);
    frame = 0;
  };
}
window.turnWatchCheckoutTip = watchCheckoutTip;
function CheckoutTip({ id, extra }){
  const [hover, setHover] = React.useState(false);     // a mouse over the ⓘ or the popup
  const [focusIn, setFocusIn] = React.useState(false); // keyboard focus on the ⓘ or the link
  const [pinned, setPinned] = React.useState(false);   // opened by a click or a tap
  const wrapRef = React.useRef(null), btnRef = React.useRef(null), popRef = React.useRef(null);
  const quietFocus = React.useRef(false);   // focus handed back to the ⓘ by Escape doesn't reopen it
  const autoId = React.useRef(null);
  if(!autoId.current) autoId.current = "checkout-tip-"+(++_checkoutTipSeq);
  const popId = id || autoId.current;
  const show = pinned || hover || focusIn;
  const close = ()=>{ setPinned(false); setHover(false); setFocusIn(false); };
  React.useLayoutEffect(()=>{
    if(!show) return;
    const place = ()=> placeCheckoutTip(wrapRef.current, popRef.current);
    place();
    return watchCheckoutTip(place);
  },[show]);
  React.useEffect(()=>{
    if(!show) return;
    const down = (e)=>{ const w = wrapRef.current; if(w && !w.contains(e.target)) close(); };
    const key = (e)=>{ if(e.key==="Escape") close(); };   // hover-opened: Escape closes it without moving the pointer
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return ()=>{ document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  },[show]);
  const onFocus = (e)=>{
    if(quietFocus.current){ quietFocus.current = false; return; }
    let keyboard = true;
    try{ keyboard = !!(e.target && e.target.matches && e.target.matches(":focus-visible")); }catch(_){ keyboard = true; }
    if(keyboard) setFocusIn(true);
  };
  const onBlur = (e)=>{
    const w = wrapRef.current, to = e.relatedTarget;
    if(w && to && w.contains(to)) return;   // still inside (the ⓘ ↔ the Terms link)
    setFocusIn(false); setPinned(false);
  };
  const onKeyDown = (e)=>{
    if(e.key!=="Escape" || !show) return;
    e.stopPropagation();   // only the popup closes, not a window around it
    const pop = popRef.current, btn = btnRef.current;
    if(pop && btn && pop.contains(document.activeElement)){ quietFocus.current = true; btn.focus(); }
    close();
  };
  const onClick = ()=>{ if(pinned || (focusIn && !hover)) close(); else setPinned(true); };
  return React.createElement("span",{className:"checkout-tip"+(extra ? " "+extra : "")+(show ? " open" : ""), ref:wrapRef,
    onPointerEnter:(e)=>{ if(e.pointerType==="mouse") setHover(true); },
    onPointerLeave:(e)=>{ if(e.pointerType==="mouse") setHover(false); },
    onFocus, onBlur, onKeyDown},
    React.createElement("button",{type:"button", className:"checkout-tip-btn", ref:btnRef,
      "aria-label":CHECKOUT_TIP_LABEL, "aria-expanded":show ? "true" : "false", "aria-controls":popId, onClick},
      (typeof Icon!=="undefined" && Icon && Icon.info) ? React.createElement(Icon.info,{s:15}) : "i"),
    React.createElement("span",{className:"checkout-tip-pop", id:popId, ref:popRef, hidden:!show},
      ...checkoutNoteParts()));
}
window.CheckoutTip = CheckoutTip;
/* the ⓘ for one purchase: `id` is what the purchase button's aria-describedby names; `extra` a surface's class */
function checkoutTip(id, extra){
  return React.createElement(CheckoutTip,{ id, extra });
}
window.turnCheckoutTip = checkoutTip;
/* the sku a consent is recorded under: a pack's own sku ("pack-250", "credits-300"), a plan's
   "plan-<tier id>" ("plan-studio" for Producer: ids are never renamed) */
function checkoutSku(item){
  if(item && item.sku) return String(item.sku);
  if(item && item.tier) return "plan-"+String(item.tier).toLowerCase();
  return "unknown";
}
window.turnCheckoutSku = checkoutSku;
/* the notice the plan picked before sign-up shows before its payment page opens by itself */
function autoCheckoutNotice(item){
  const isPlan = !!(item && item.tier && !item.sku);
  const what = isPlan ? ("your "+planDisplayName(item.tier)+" plan") : String((item && item.name) || "your credits");
  return "Opening the checkout for "+what+". "+CHECKOUT_NOTE_TEXT;
}
window.turnAutoCheckoutNotice = autoCheckoutNotice;
/* record the consent; resolves { ok } | { ok:false, reason:"missing"|"no-cloud"|"error" } and never rejects */
async function recordCheckoutConsent(sku, version){
  const sb = (typeof window.sbClient==="function") ? window.sbClient() : null;
  if(!sb || typeof sb.rpc!=="function") return { ok:false, reason:"no-cloud" };
  try{
    const { error } = await sb.rpc("turn_record_checkout_consent", { sku:String(sku), consent_version:String(version) });
    if(!error) return { ok:true };
    const code = String(error.code||""), msg = String(error.message||"");
    const missing = code==="PGRST202" || code==="42883" || /could not find the function|does not exist/i.test(msg);
    return { ok:false, reason: missing ? "missing" : "error", code };
  }catch(e){ return { ok:false, reason:"error" }; }
}
window.turnRecordCheckoutConsent = recordCheckoutConsent;
function _withTimeout(p, ms){
  return new Promise((resolve)=>{
    let done = false;
    const t = setTimeout(()=>{ if(!done){ done = true; resolve({ ok:false, reason:"timeout" }); } }, ms);
    Promise.resolve(p).then((v)=>{ if(!done){ done = true; clearTimeout(t); resolve(v); } },
      ()=>{ if(!done){ done = true; clearTimeout(t); resolve({ ok:false, reason:"error" }); } });
  });
}
const _wait = (ms)=> new Promise((resolve)=>setTimeout(resolve, ms));
/* the payment link for this account, or "" (no link here yet). It carries the account's id
   (client_reference_id: the webhook credits that account) and the account's email
   (prefilled_email: the payment page starts with it filled in; owner decision 2026-10-02, E2 —
   a wallet such as Apple Pay can still hand Stripe another email, which the webhook then sets
   back to the account's). Both are URL-encoded ("a+b@x.com" stays a plus, not a space). */
function checkoutUrl(item, uid, email){
  const base = checkoutLink(item);
  if(!base) return "";
  return base
    + (base.indexOf("?")>=0 ? "&" : "?")
    + "client_reference_id=" + encodeURIComponent(uid)
    + (email ? ("&prefilled_email=" + encodeURIComponent(email)) : "");
}
window.turnCheckoutUrl = checkoutUrl;
function _needSignIn(){
  if(window.appToast) window.appToast("Sign in first — purchases are tied to your account.","info");
  try{ window.dispatchEvent(new CustomEvent("turn-need-signin")); }catch(e){}
}
function _noCheckoutYet(){
  if(window.appToast) window.appToast("Checkout isn't available yet — please try again shortly.","info");
}

/* open a plan's or pack's checkout tagged with the user's id + email. Needs a signed-in user —
   without a uid the webhook can't know whose balance to credit. Called straight from the purchase
   button's click, so the new tab opens inside the user's gesture (a popup blocker lets it
   through); the consent record goes out just before it and finishes in the background.
   opts.sameTab: navigate THIS tab to Stripe instead of window.open — used by the post-signup
   auto-open (app.jsx), so the buyer stays in one tab; Stripe's after-payment redirect brings
   them back to the app. That path has no click here, so it shows the note in a notice first and
   waits for the record (leaving the page would cancel it) and for the notice's time on screen,
   and records CHECKOUT_CONSENT_VERSION_AUTO instead of the click's version.
   Resolves true when a payment page opened. */
function startCheckout(plan, opts){
  const uid = window.turnUserId || null;
  if(!uid){ _needSignIn(); return Promise.resolve(false); }
  const url = checkoutUrl(plan, uid, window.turnUserEmail || "");
  if(!url){ _noCheckoutYet(); return Promise.resolve(false); }
  const auto = !!(opts && opts.sameTab);   // sameTab is the post-sign-up auto-checkout alone (app.jsx)
  const rec = recordCheckoutConsent(checkoutSku(plan), auto ? CHECKOUT_CONSENT_VERSION_AUTO : CHECKOUT_CONSENT_VERSION);
  if(auto){
    if(window.appToast) window.appToast(autoCheckoutNotice(plan), "info", { force:true });
    return Promise.all([_withTimeout(rec, CONSENT_RECORD_WAIT_MS), _wait(CHECKOUT_NOTICE_MIN_MS)]).then(()=>{
      try{ window.location.assign(url); return true; }catch(e){}
      window.open(url, "_blank", "noopener");
      return true;
    });
  }
  window.open(url, "_blank", "noopener");
  return Promise.resolve(true);   // the record finishes in the background (this page stays open)
}
window.turnStartCheckout = startCheckout;

/* WELCOME MOMENT — shown once when Stripe's after-payment redirect returns the buyer
   to the app (/?welcome=1). Celebrates the plan going live and hands them straight to
   New Story. `activating` covers the few seconds before the webhook's grant streams
   into the balance — the card updates live and unlocks its CTA when credits land. */
/* the welcome card's copy — pure, so the exact sentences are testable */
function welcomePlanCopy(plan, credits, activating){
  const p = PLANS.find(x=>x.tier===String(plan||"").toLowerCase()) || null;
  const planLabel = planDisplayName(p ? p.tier : plan);
  if(activating) return {
    title:"Setting up your plan…",
    sub:"Payment received — your credits are being added. This only takes a few seconds.",
  };
  return {
    title:"Your "+planLabel+" plan is live",
    sub:fmtCredits(credits)+" credits are ready — every generation runs on them. They refresh on your renewal date, and unused monthly credits don’t roll over.",
    note:"Card, invoices and cancelling are under Manage plan in the account menu.",
  };
}
window.turnWelcomePlanCopy = welcomePlanCopy;
function WelcomePlanCard({ plan, credits, activating, onNewStory, onClose }){
  const copy = welcomePlanCopy(plan, credits, activating);
  return React.createElement("div",{className:"ns-overlay"},
    React.createElement("div",{className:"welcome-card"},
      React.createElement("div",{className:"welcome-eyebrow welcome-brand"},
        typeof BrandMark==="function" && React.createElement(BrandMark),
        React.createElement("span",{className:"brand-name"},"Kinolot")),
      React.createElement("div",{className:"welcome-title"}, copy.title),
      React.createElement("div",{className:"welcome-sub"}, copy.sub),
      copy.note && React.createElement("div",{className:"welcome-note"}, copy.note),
      React.createElement("button",{className:"welcome-cta",disabled:!!activating,onClick:onNewStory},
        activating ? "Activating…" : React.createElement(React.Fragment,null,
          typeof Icon!=="undefined" && Icon.plus && React.createElement(Icon.plus,{s:14}),"New Story")),
      React.createElement("button",{className:"welcome-later",onClick:onClose},"I’ll look around first")));
}
window.WelcomePlanCard = WelcomePlanCard;

function welcomePackCopy(credits, activating, balance){
  if(activating) return {
    title:"Adding your extra credits…",
    sub:"Payment received — your pack is being added to your balance. This only takes a few seconds.",
  };
  const parts = balanceParts(balance);
  const total = parts ? parts.total : (Number(credits)||0);
  return {
    title:"Extra credits added",
    sub:"Pack credits last 12 months and are never reset when a plan renews. Your balance is now "
      +(parts ? creditBreakdownText(balance) : (fmtCredits(total)+" credits"))+".",
  };
}
window.turnWelcomePackCopy = welcomePackCopy;
function WelcomeCreditPackCard({ credits, activating, balance, onClose }){
  const copy = welcomePackCopy(credits, activating, balance);
  return React.createElement("div",{className:"ns-overlay"},
    React.createElement("div",{className:"welcome-card"},
      React.createElement("div",{className:"welcome-eyebrow welcome-brand"},
        typeof BrandMark==="function" && React.createElement(BrandMark),
        React.createElement("span",{className:"brand-name"},"Kinolot")),
      React.createElement("div",{className:"welcome-title"}, copy.title),
      React.createElement("div",{className:"welcome-sub"}, copy.sub),
      React.createElement("button",{className:"welcome-cta",onClick:onClose},"Back to studio")));
}
window.WelcomeCreditPackCard = WelcomeCreditPackCard;

/* ADMIN copy editor — edits only the marketing text (name/blurb/features/popular),
   persisted globally via cloudSaveAppConfig. Price & credits stay Stripe-owned. */
function PlanCopyEditor({ onDone }){
  const [draft, setDraft] = React.useState(()=> window.turnPlanCopy());
  const [busy, setBusy] = React.useState(false);
  const set = (tier, patch)=> setDraft(d=> ({ ...d, [tier]:{ ...d[tier], ...patch } }));
  const setFeat = (tier, i, val)=> setDraft(d=>{ const f=d[tier].features.slice(); f[i]=val; return { ...d, [tier]:{ ...d[tier], features:f } }; });
  const addFeat = (tier)=> setDraft(d=> ({ ...d, [tier]:{ ...d[tier], features:[...d[tier].features, ""] } }));
  const delFeat = (tier, i)=> setDraft(d=>{ const f=d[tier].features.slice(); f.splice(i,1); return { ...d, [tier]:{ ...d[tier], features:f } }; });
  const save = async ()=>{
    setBusy(true);
    // clean empty feature rows, enforce single "most popular"
    const clean = {};
    Object.keys(draft).forEach(t=>{ clean[t] = { name:draft[t].name, blurb:draft[t].blurb,
      features:draft[t].features.map(x=>String(x)).filter(x=>x.trim()), popular:!!draft[t].popular }; });
    window.turnApplyPlanCopy(clean);
    let ok = false;
    if(typeof window.cloudSaveAppConfig==="function"){ try{ ok = await window.cloudSaveAppConfig("plans-copy", clean); }catch(e){} }
    setBusy(false);
    if(window.appToast) window.appToast(ok ? "Plan copy saved for everyone." : "Applied locally, but couldn't save globally — run supabase/app-config.sql and check you're the admin.", ok?"success":"error");
    onDone();
  };
  return React.createElement("div",{className:"plans-grid"},
    PLANS.map(p=>{
      const d = draft[p.tier] || { name:p.name, blurb:p.blurb, features:[], popular:false };
      return React.createElement("div",{key:p.tier,className:"plan-card editing"+(d.popular?" popular":"")},
        React.createElement("label",{className:"plan-edit-pop"},
          React.createElement("input",{type:"radio",name:"plan-popular",checked:!!d.popular,
            onChange:()=> setDraft(dr=>{ const n={...dr}; Object.keys(n).forEach(t=>n[t]={...n[t],popular:t===p.tier}); return n; })}),
          " Most popular"),
        React.createElement("input",{className:"plan-edit-name",value:d.name,onChange:e=>set(p.tier,{name:e.target.value}),placeholder:"Plan name"}),
        React.createElement("div",{className:"plan-price plan-edit-locked"},p.price,React.createElement("span",{className:"plan-per"},"/mo · Stripe")),
        React.createElement("div",{className:"plan-edit-locked-note"},p.credits.toLocaleString()+" credits · set in Stripe"),
        React.createElement("textarea",{className:"plan-edit-blurb",rows:2,value:d.blurb,onChange:e=>set(p.tier,{blurb:e.target.value}),placeholder:"One-line blurb"}),
        React.createElement("div",{className:"plan-edit-feats"},
          d.features.map((f,i)=>React.createElement("div",{key:i,className:"plan-edit-feat"},
            React.createElement("input",{value:f,onChange:e=>setFeat(p.tier,i,e.target.value),placeholder:"Feature line"}),
            React.createElement("button",{type:"button",className:"plan-edit-featx",title:"Remove",onClick:()=>delFeat(p.tier,i)},"×"))),
          React.createElement("button",{type:"button",className:"plan-edit-featadd",onClick:()=>addFeat(p.tier)},"+ Add feature")));
    }),
    React.createElement("div",{className:"plan-edit-bar"},
      React.createElement("button",{className:"plan-cta",disabled:busy,onClick:onDone},"Cancel"),
      React.createElement("button",{className:"plan-cta primary",disabled:busy,onClick:save}, busy?"Saving…":"Save for everyone")));
}

/* the Plans window's copy — pure, so each sentence is testable */
const PLANS_COPY = {
  sub:"Credits power every generation — writing, images, voice and video. Cancel anytime from Manage plan.",
  packsSub:"One-off packs for any account. Pack credits last 12 months and are never reset when your plan renews — your plan’s monthly credits are used first.",
  packsNoPlan:"Without a plan, credits cover writing on the default engines and draft images.",
  switchNote:"To switch plans, write to "+BILLING_EMAIL+" from your account email and we’ll move you over — you won’t be charged twice.",
  trial:(left)=>"Free trial: "+fmtCredits(left)+" of "+TRIAL_CREDITS+" credits left — for writing on the default engines and draft images. "+TIER_ADDS,
  soon:"Coming soon",
};
window.TURN_PLANS_COPY = PLANS_COPY;

function PlansModal({ onClose, currentPlan }){
  if(typeof window.usePlansVersion==="function") window.usePlansVersion();   // re-render on copy edits
  const [editing, setEditing] = React.useState(false);
  const [switchNote, setSwitchNote] = React.useState(false);
  const isAdmin = !!window.turnIsAdmin;
  const bal = window.turnCreditBalance || null;
  const parts = balanceParts(bal);
  const signedIn = !!window.turnUserId;
  const hasPlan = _isPaidTier(currentPlan || (bal||{}).plan);
  // Paying subscribers never start a SECOND subscription from here: a different plan is a
  // switch, made in Manage plan (or by email until the portal offers switching).
  const switchPlan = ()=>{
    if(PORTAL_PLAN_SWITCHING && typeof window.turnOpenBillingPortal==="function"){ openManagePlan(); return; }
    setSwitchNote(true);
  };
  // the old packs until the switch, the new ones from the switch day; nothing is on sale while the
  // live unit isn't known yet (packOnSale / activeCreditPacks above)
  const packs = activeCreditPacks();
  const buyPack = (pack)=>{ if(packOnSale(pack)) startCheckout(pack); };
  return React.createElement("div",{className:"ns-overlay",onMouseDown:e=>{ if(e.target===e.currentTarget && !editing) onClose(); }},
    React.createElement("div",{className:"plans-modal"},
      React.createElement("button",{className:"ag-x plans-x",onClick:onClose,title:"Close","aria-label":"Close"},React.createElement(Icon.x,{s:16})),
      React.createElement("div",{className:"plans-head"},
        React.createElement("div",{className:"plans-title"}, editing ? "Edit plan copy" : (hasPlan ? "Your plan" : "Choose your plan")),
        React.createElement("div",{className:"plans-sub"}, editing
          ? "Marketing copy only — price and credits are set in Stripe. Saved changes show for everyone."
          : PLANS_COPY.sub),
        !editing && signedIn && parts && React.createElement("div",{className:"plans-balance"},
          "Your balance: "+creditBreakdownText(bal)),
        !editing && parts && parts.trial && React.createElement("div",{className:"plans-trial"}, PLANS_COPY.trial(parts.total)),
        !editing && signedIn && legacyAllowanceNote(bal) && React.createElement("div",{className:"plans-trial"}, legacyAllowanceNote(bal)),
        !editing && !signedIn && trialCopy() && React.createElement("div",{className:"plans-trial"}, trialCopy()),
        !editing && hasPlan && typeof window.turnOpenBillingPortal==="function" && React.createElement("button",{className:"plans-manage",
          onClick:()=>{ onClose(); openManagePlan(); }, title:"Update your card, see invoices, or cancel at the end of the billing period"},
          "Manage plan"),
        isAdmin && !editing && React.createElement("button",{className:"plans-edit-btn",onClick:()=>setEditing(true),
          title:"Admin — edit the plan cards' copy (name, blurb, features, most-popular)"},
          React.createElement((Icon.wand||Icon.sparkles),{s:14})," Edit copy")),
      editing
        ? React.createElement(PlanCopyEditor,{ onDone:()=>setEditing(false) })
        : React.createElement(React.Fragment,null,
          React.createElement("div",{className:"plans-grid"},
            PLANS.map(p=>{
              const active = currentPlan && String(currentPlan).toLowerCase()===p.tier;
              // a purchase button (not "Current plan", not a subscriber's "Switch to …") goes with the
              // 14-day note (E1, 2026-10-02) — behind the ⓘ right after the plan's name (R2, 2026-10-02):
              // clicking the button is the request to start now
              const buys = !active && !hasPlan;
              const noteId = "checkout-note-plan-"+p.tier;
              return React.createElement("div",{key:p.tier,className:"plan-card"+(p.popular?" popular":"")+(active?" active":"")},
                p.popular && React.createElement("div",{className:"plan-flag"},"Most popular"),
                React.createElement("div",{className:"plan-name-row checkout-tip-row"},
                  React.createElement("div",{className:"plan-name"},p.name),
                  buys && checkoutTip(noteId)),
                React.createElement("div",{className:"plan-price"},p.price,React.createElement("span",{className:"plan-per"},"/mo")),
                React.createElement("div",{className:"plan-blurb"},p.blurb),
                React.createElement("ul",{className:"plan-feats"},
                  p.features.map((f,i)=>React.createElement("li",{key:i},
                    React.createElement(Icon.check,{s:12}),f))),
                React.createElement("button",{className:"plan-cta"+(p.popular?" primary":"")+(active?" is-active":""),
                  disabled:active, "aria-describedby": buys ? noteId : undefined,
                  onClick:()=>{ if(active) return; if(hasPlan) switchPlan(); else startCheckout(p); }},
                  active ? "Current plan" : ((hasPlan ? "Switch to " : "Choose ")+p.name)));
            })),
          hasPlan && switchNote && React.createElement("div",{className:"plans-switch-note",role:"status"},
            "To switch plans, write to ",
            React.createElement("a",{href:"mailto:"+BILLING_EMAIL+"?subject="+encodeURIComponent("Switch my Kinolot plan")},BILLING_EMAIL),
            " from your account email and we’ll move you over — you won’t be charged twice."),
          React.createElement("div",{className:"credit-packs"},
            React.createElement("div",{className:"credit-packs-head"},
              React.createElement("div",null,
                React.createElement("div",{className:"credit-packs-title"},"Extra credits"),
                React.createElement("div",{className:"credit-packs-sub"},
                  PLANS_COPY.packsSub + (hasPlan || isAdmin ? "" : " "+PLANS_COPY.packsNoPlan)))),
            React.createElement("div",{className:"credit-packs-grid"},
              packs.map(p=>{
                const unavailable = !packOnSale(p);
                const noteId = "checkout-note-"+p.sku;
                return React.createElement("div",{key:p.sku,className:"credit-pack"+(p.popular?" popular":"")},
                  p.popular && React.createElement("div",{className:"credit-pack-flag"},"Best value"),
                  // the 14-day note behind the ⓘ after the name of every pack that can be bought (E1, R2);
                  // "Coming soon" sells nothing
                  React.createElement("div",{className:"credit-pack-name-row checkout-tip-row"},
                    React.createElement("div",{className:"credit-pack-name"},p.name),
                    !unavailable && checkoutTip(noteId)),
                  React.createElement("div",{className:"credit-pack-price"},p.price),
                  React.createElement("div",{className:"credit-pack-blurb"},p.blurb),
                  React.createElement("button",{className:"plan-cta"+(p.popular?" primary":""),disabled:unavailable,
                    title:unavailable ? "This pack goes on sale soon" : "Buy extra credits — they last 12 months",
                    "aria-describedby": unavailable ? undefined : noteId,
                    onClick:()=>buyPack(p)},
                    unavailable ? PLANS_COPY.soon : ("Buy "+p.credits.toLocaleString("en-US"))));
              })))),
      React.createElement("div",{className:"plans-foot"},
        "Secure checkout by Stripe · Kinolot by Infinite Studio AI · Billing questions: kinolot-billing@infinitestudioai.com")));
}
window.PlansModal = PlansModal;

/* ---- BILLING NOTICES — the in-app banners at the top of the studio:
   · "Payment failed — update your card" while payment_status is past_due
   · "Account on hold" while the account is frozen (an open dispute)
   · low balance at 20% / 5% of the allowance (dismissible, once per level per cycle)
   Each button opens Manage plan (the billing portal) when the account menu provides it,
   else the Plans window. Admin never sees them. The copy is pure (billingNoticeList). */
function billingNoticeList(balance, level, allowance){
  const p = balanceParts(balance);
  if(!p || window.turnIsAdmin) return [];
  const out = [];
  if(p.frozen) out.push({ id:"frozen", tone:"bad", title:"Account on hold.",
    body:"A payment on this account is being disputed, so spending credits is paused until it’s resolved. Write to "+BILLING_EMAIL+" if this is a mistake.",
    action:"Manage plan", act:"manage" });
  if(p.pastDue) out.push({ id:"past_due", tone:"bad", title:"Payment failed — update your card.",
    body:"We couldn’t take your last payment. Your credits still work while we retry, but your monthly refill is paused until the card is updated.",
    action:"Update card", act:"manage" });
  if(level && !p.frozen){
    if(p.trial) out.push({ id:"low-"+level, level, tone:"warn",
      title: level===5 ? "Your free trial is almost used up." : "Your free trial is running low.",
      body: level===5 ? (fmtCredits(p.total)+" free credits left. Choose a plan to keep creating.")
        : (fmtCredits(p.total)+" of your "+TRIAL_CREDITS+" free credits left. Choose a plan to keep writing. "+TIER_ADDS),
      action:"Choose a plan", act:"plans", dismissible:true });
    else out.push({ id:"low-"+level, level, tone:"warn",
      title: level===5 ? "Almost out of credits." : "Running low on credits.",
      body: level===5 ? ("Only "+fmtCredits(p.total)+" credits left. Generations stop when your balance can’t cover them.")
        : (fmtCredits(p.total)+" of your "+fmtCredits(allowance)+" monthly credits left. Top up with a credit pack (they last 12 months) or upgrade your plan."),
      action:"Get credits", act:"plans", dismissible:true });
  }
  return out;
}
window.turnBillingNoticeList = billingNoticeList;
function _noticeKey(){ return "turn-billing-notices:"+String(window.turnUserId||window.turnUserEmail||"local"); }
function _noticeLoad(){ try{ return JSON.parse(localStorage.getItem(_noticeKey())||"null"); }catch(e){ return null; } }
function _noticeSave(s){ try{ localStorage.setItem(_noticeKey(), JSON.stringify(s)); }catch(e){} }
/* The bad-news banners (payment failed, account on hold) can't be dismissed for good while they're
   true; closing one hides it for the rest of this PAGE session — in BOTH mounts (studio and Home,
   repair round 2: each used to keep its own closed state, so a banner closed on Home was still open
   in the studio). Module-level, per account; a reload shows them again. Every mount listens, so the
   other copy re-renders at once. */
const _closedNotices = new Set();
const _closedListeners = new Set();
function _closedNoticeKey(id){ return String(window.turnUserId||window.turnUserEmail||"local")+"|"+String(id); }
function noticeClosed(id){ return _closedNotices.has(_closedNoticeKey(id)); }
function closeNotice(id){
  _closedNotices.add(_closedNoticeKey(id));
  Array.from(_closedListeners).forEach(f=>{ try{ f(); }catch(e){} });
}
window.turnBillingNoticeClosed = noticeClosed;
/* ---- "WE'VE UPDATED OUR TERMS" (owner decision 2026-10-01, D5) ----
   A dismissible banner for signed-in users, shown for 30 days from TERMS_UPDATED_AT — the ONE
   place that says when the Terms / Privacy Policy last changed. "" hides it (today); the owner
   sets it to the day the new pages go live (the credit switch day, owner runbook), e.g.
   "2026-10-31". Closing it hides it for that account in this browser until the next update (the
   dismissal is stored against the date, so a later update shows again). It rides the billing
   banners' two mounts (studio and Home), so a close in one closes the other. */
const TERMS_UPDATED_AT = "2026-10-02";
const TERMS_NOTICE_DAYS = 30;
window.TURN_TERMS_UPDATED_AT = TERMS_UPDATED_AT;
window.TURN_TERMS_NOTICE_TEXT = "We've updated our Terms and Privacy Policy";
function termsNoticeDue(updatedAt, now, dismissed){
  const s = String(updatedAt==null ? "" : updatedAt).trim();
  if(!s) return false;
  const t = Date.parse(s);
  if(!Number.isFinite(t)) return false;
  const n = Number(now) || Date.now();
  if(n < t || n >= t + TERMS_NOTICE_DAYS*86400000) return false;
  return String(dismissed||"") !== s;
}
window.turnTermsNoticeDue = termsNoticeDue;
function _termsKey(){ return "turn-terms-notice:"+String(window.turnUserId||window.turnUserEmail||"local"); }
function _termsDismissed(){ try{ return localStorage.getItem(_termsKey()) || ""; }catch(e){ return ""; } }
function _termsDismiss(at){
  try{ localStorage.setItem(_termsKey(), String(at)); }catch(e){}
  Array.from(_closedListeners).forEach(f=>{ try{ f(); }catch(e){} });
}
function TermsNotice({ at, onDismiss }){
  return React.createElement("div",{className:"billing-banner info terms-banner",role:"status"},
    React.createElement("span",{className:"billing-banner-text"},
      React.createElement("b",null, window.TURN_TERMS_NOTICE_TEXT+". "),
      "Read the ",
      React.createElement("a",{href:"/terms.html",target:"_blank",rel:"noopener"},"Terms"),
      " and the ",
      React.createElement("a",{href:"/privacy.html",target:"_blank",rel:"noopener"},"Privacy Policy"),
      "."),
    React.createElement("button",{type:"button",className:"billing-banner-x","aria-label":"Dismiss",title:"Dismiss",onClick:()=>onDismiss(at)},"×"));
}

/* Mounted twice (repair 2026-09-30): at the top of the studio (app.jsx, inside .app) and at the top of
   the Home dashboard (home-dashboard.jsx noticesSlot), which covers the studio as a fixed overlay —
   a past-due, frozen or low account saw no banner while on Home. Both copies read and write the
   same per-account state, so a dismissal holds in both. `now` / `session` / `termsAt` exist for
   tests only. */
function BillingNotices({ balance, now, session, termsAt }){
  const [, force] = React.useState(0);
  const tAt = termsAt!==undefined ? termsAt : TERMS_UPDATED_AT;
  const showTerms = !!window.turnUserId && termsNoticeDue(tAt, now, _termsDismissed());
  const step = lowBalanceStep(_noticeLoad(), balance, { now, session });
  React.useEffect(()=>{ _noticeSave(step.state); });
  // a bad-news banner closed in the other mount (Home ↔ studio) closes here too (see closeNotice)
  React.useEffect(()=>{
    const f = ()=>force(v=>v+1);
    _closedListeners.add(f);
    return ()=>{ _closedListeners.delete(f); };
  }, []);
  // a level reached during a hold waits to be confirmed: look again when the wait is over
  React.useEffect(()=>{
    if(!(step.recheckInMs>0)) return undefined;
    const t = setTimeout(()=>force(v=>v+1), step.recheckInMs + 250);
    return ()=>clearTimeout(t);
  }, [step.recheckInMs>0 ? Math.round(step.state.settleUntil||0) : 0]);
  const notices = billingNoticeList(balance, step.level, step.allowance).filter(n=>n.dismissible || !noticeClosed(n.id));
  if(!notices.length && !showTerms) return null;
  const act = (n)=>{ if(n.act==="manage") openManagePlan(); else if(typeof window.turnOpenPlans==="function") window.turnOpenPlans(); };
  const dismiss = (n)=>{
    if(n.dismissible){ _noticeSave(lowBalanceDismiss(step.state, n.level)); force(v=>v+1); }
    else closeNotice(n.id);
  };
  return React.createElement("div",{className:"billing-notices"},
    showTerms && React.createElement(TermsNotice,{ key:"terms", at:String(tAt).trim(), onDismiss:(at)=>{ _termsDismiss(at); force(v=>v+1); } }),
    notices.map(n=>React.createElement("div",{key:n.id,className:"billing-banner "+n.tone,role:n.tone==="bad"?"alert":"status"},
      React.createElement("span",{className:"billing-banner-text"},
        React.createElement("b",null,n.title+" "), n.body),
      React.createElement("button",{type:"button",className:"billing-banner-act",onClick:()=>act(n)}, n.action),
      React.createElement("button",{type:"button",className:"billing-banner-x","aria-label":"Dismiss",title:"Dismiss",onClick:()=>dismiss(n)},"×"))));
}
window.BillingNotices = BillingNotices;

/* SELF-MOUNTING opener — any surface (account chip, out-of-credits render gate)
   calls window.turnOpenPlans(). It mounts the modal into its own React root on
   demand and tears it down on close, so it never depends on a host component being
   mounted in the app tree (robust even mid-auth-refresh). */
let _plansRoot = null, _plansEl = null;
function openPlans(){
  if(_plansEl) return;                                   // already open
  _plansEl = document.createElement("div");
  _plansEl.className = "plans-root";
  document.body.appendChild(_plansEl);
  _plansRoot = ReactDOM.createRoot(_plansEl);
  const close = ()=>{
    try{ _plansRoot && _plansRoot.unmount(); }catch(e){}
    if(_plansEl && _plansEl.parentNode) _plansEl.parentNode.removeChild(_plansEl);
    _plansRoot = null; _plansEl = null;
  };
  const plan = (window.turnCreditBalance && window.turnCreditBalance.plan) || null;
  _plansRoot.render(React.createElement(PlansModal,{ currentPlan:plan, onClose:close }));
}
window.turnOpenPlans = openPlans;

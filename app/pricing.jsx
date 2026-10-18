/* pricing.jsx — internal credit economics.
   This is the small auditable table behind user-facing credit estimates. Keep it
   boring: provider list-price assumptions in USD, then helpers that convert raw
   provider cost into Kinolot credits.

   Pricing policy (OPTION A, owner decision 2026-09-30):
   - CREDIT_SCALE only changes the visible denomination (600 instead of 60).
   - BASE_PROVIDER_USD_PER_CREDIT is the unscaled anchor: 1 base credit = $0.10.
   - Therefore 1 visible credit = $0.01 of raw provider spend (it was $0.03 before the
     switch, so every action now costs about 3x the credits). Credits always round UP,
     so no action costs more than $0.01 per credit while the price tables are current.
   - The SAME anchor lives in supabase/functions/image-proxy/billing-pricing.mjs
     (PROVIDER_USD_PER_CREDIT) and supabase/functions/blender-bridge/studio-service.mjs — change
     them together, or the cost a button shows stops matching what the server charges.
   - THE LIVE UNIT FOLLOWS THE DATABASE (turnApplyCreditRegime, below). Until the owner runs
     supabase/billing-switch.sql (30 days after the notice), the database's turn_credit_regime()
     still says 1 credit = $0.03 and the server charges in that unit; app/cloud.jsx reads it at
     boot (cloudLoadCreditRegime) and this file moves the anchor to match ($0.30 per base credit
     before the switch, $0.10 after), so a cost chip always quotes what the server will charge.
     Plan cards and the free-trial copy follow the same switch (app/plans.jsx). With nothing read
     yet the app assumes the switched unit FOR COST QUOTES (the last value read is remembered in
     this browser): quoting too high is safe (the server settles the real, lower cost), quoting too
     low is not (a video render would be refused as costing more than the quote). Until a read (or
     the saved copy) says which unit is live, the trial line is hidden, packs stay disabled and the
     plan cards show no allowance number (turnCreditRegimeKnown, repair 2026-09-30).
   - Text rates are provider-token based when the proxy returns usage, with the
     flat table below kept only as an older-deploy display fallback.
   - Image/video rates are provider-cost based. */

(function(){
  const CREDIT_SCALE = 10;
  const BASE_PROVIDER_USD_PER_CREDIT = 0.10;

  const TURN_PRICING = {
    version: "2026-09-30",
    currency: "USD",
    credit: {
      scale: CREDIT_SCALE,
      baseProviderUsd: BASE_PROVIDER_USD_PER_CREDIT,
      visibleProviderUsd: BASE_PROVIDER_USD_PER_CREDIT / CREDIT_SCALE,
    },
    // Stripe UK account charging US cards in USD (review of 2026-09-29): one-off packs
    // 3.15% + 2% currency conversion; subscriptions add 0.7% Billing. Fixed fee ~ $0.30.
    buffers: {
      stripePercent: 0.0515,
      stripeSubscriptionPercent: 0.0585,
      stripeFixedUsd: 0.30,
      opsBufferPercent: 0.15,
      targetGrossMarginPercent: 0.60,
    },
    // Option A allowances for NEW subscribers (app/plans.jsx is the display source; Stripe's
    // plan_credits metadata is what the webhook grants). Existing subscribers keep the
    // legacy allowance (old x3) for renewals until 30 days after the switch.
    plans: [
      { tier:"writer",   priceUsd:19,  credits:600,  legacyCredits:2400 },
      { tier:"director", priceUsd:49,  credits:1600, legacyCredits:7200 },
      { tier:"studio",   priceUsd:149, credits:5000, legacyCredits:27000 },
    ],
    trialCredits: 50,
    text: {
      note: "Token-based proxy accounting for successful text calls; creditRates are a display fallback for older proxy deploys.",
      creditRates: {
        // display fallbacks scaled to Anthropic list prices (checked 2026-09-26)
        // (base credits per call at the $0.10 base anchor — 3x the pre-2026-09-30 values)
        "claude-fable-5": 0.33,
        "claude-opus-5": 0.18,
        "claude-opus-5-5": 0.12,
        "claude-sonnet-5": 0.24,
        "gpt-6-astra": 0.60,
        "gpt-6.1-sol": 0.12,
        "gemini-3.8-flash": 0.24,
        "gemini-4-argon": 0.12,
        muse: 0.09,
        vision: 0.60,
        default: 0.30,
      },
    },
    image: {
      note: "Provider cost per generated image on fal (the route the app uses) — the SAME table as supabase/functions/image-proxy/billing-pricing.mjs IMAGE_PROVIDER_USD, so a cost chip quotes what the server holds and settles.",
      // THE ENGINES (2026-10-11, owner — image engines): exactly Nano Banana 2.1, GPT Image 2.5 Flare,
      // GPT Image 2.5 Sunburst and Seedream 5 Pro (Nano Banana 2, Nano Banana Pro and GPT Image 2 were removed).
      // Nano Banana 2.1 (2026-10-10, owner) $0.05 / $0.07 / $0.15 at 1K / 2K / 4K — fal bills it per token
      // (representative $0.040 / $0.059 / $0.134 for a short prompt at medium thinking), so the table adds an
      // allowance for long prompts and references and charges no extra per reference image.
      // GPT Image 2.5 rows are fal's canonical 1024x1024 prices (2026-10-11: low $0.00588, medium $0.01317,
      // high $0.05268, xhigh $0.09366, max $0.21072 — low / medium / high used to sit below fal's) and scale
      // with output size (turnGptImageSizeFactor); default is high, auto is estimated at max.
      // Seedream 5 Pro (2026-10-11): fal's tentative price by OUTPUT AREA — $0.0675 up to 1536x1536 ("standard"),
      // $0.135 above it up to 2048x2048 ("large") — plus $0.0045 for each reference image after the first
      // ("extraRef"); the tier follows the exact size sent (turnSeedreamImageDimensions; no 4K — a 4K pick
      // renders at 2K).
      providerUsd: {
        "gemini-nano-banana-2.1":      { "1K":0.05, "2K":0.07, "4K":0.15 },
        "gpt-image-2.5-flare":         { default:0.05268, auto:0.21072, low:0.00588, medium:0.01317, high:0.05268, xhigh:0.09366, max:0.21072 },
        "gpt-image-2.5-sunburst":      { default:0.05268, auto:0.21072, low:0.00588, medium:0.01317, high:0.05268, xhigh:0.09366, max:0.21072 },
        "seedream-5-pro":              { standard:0.0675, large:0.135, extraRef:0.0045 },
      },
    },
    video: {
      note: "Provider USD per output second. Stage converts this into the credit cost it shows; the server holds that cost before the job and settles it when the render finishes (refunded if it fails).",
      // with video references fal multiplies the price by 0.6 and bills the input seconds too —
      // for every Seedance family, as the server prices it (billing-pricing.mjs videoCost:
      // SEEDANCE_VIDEO_INPUT_MULTIPLIER on /^seedance/); the Stage quotes (output + input) × rate × 0.6
      videoInputPriceMultiplier: { "seedance-2.0":0.6, "seedance-2.5":0.6 },
      providerUsdPerSecond: {
        "seedance-2.0": {
          standard: { "480p":0.1512, "720p":0.3034, "1080p":0.6820, "4K":1.5500 },
          fast:     { "480p":0.1210, "720p":0.2419 },
        },
        // fal reference-to-video baseline rates, verified from fal's official model
        // page for standard 16:9 output WITHOUT video-reference input. Video inputs
        // use a 0.6 token-price multiplier, but their input duration is also billable;
        // callers must not present these baseline output-only rates as an exact quote
        // when video references are attached. Seedance 2.5 has no fast tier.
        "seedance-2.5": {
          standard: { "480p":0.2205, "720p":0.4730, "1080p":1.1640 },
        },
        "kling-3.0": {
          standard: { "480p":0.1260, "720p":0.1260, "1080p":0.1260 },
          pro:      { "480p":0.1680, "720p":0.1680, "1080p":0.1680 },
        },
        // Kling 3.0 Motion Control (fal-ai/kling-video/v3/{standard,pro}/motion-control),
        // verified 2026-09-15: $0.126/s standard, $0.168/s pro. fal documents NO
        // resolution parameter for these endpoints — the 720p/1080p keys are the
        // inferred tier output used as the Stage "Quality" label, not a request knob.
        // Output length follows the motion video, so Stage bills ceil(motion seconds).
        "kling-3.0-motion-control": {
          standard: { "720p":0.1260 },
          pro:      { "1080p":0.1680 },
        },
      },
    },
    packs: {
      // owner decision 2026-09-30 (at the $0.01 rate): 12-month pack lots, never wiped at renewal
      current: [
        { sku:"pack-250",  credits:250,  priceUsd:10 },
        { sku:"pack-1000", credits:1000, priceUsd:35 },
        { sku:"pack-3000", credits:3000, priceUsd:99 },
      ],
      validMonths: 12,
    },
  };

  /* ── THE LIVE CREDIT UNIT (billing fixes, owner decisions 2026-09-30) ──────
     turn_credit_regime() (supabase/billing-v2.sql, readable without signing in) says whether
     supabase/billing-switch.sql has run: before it 1 credit = $0.03 of provider cost and there is
     no free trial; after it $0.01 and a 50-credit trial. The server prices every call in the
     live unit (image-proxy creditUnitNow, blender-bridge), so the app moves its anchor to match.
     The anchor objects are mutated IN PLACE (TURN_PRICING.credit and the text creditRates, which
     app/ai.jsx TEXT_CREDIT_RATES holds by reference) and "turn-pricing-changed" refreshes every
     derived copy (the Stage's tier rates); "turn-credit-regime-changed" re-reads plan cards and
     the trial copy (app/plans.jsx, app/landing.jsx). */
  const REGIME_KEY = "turn-credit-regime-v1";
  const SWITCHED_USD_PER_CREDIT = 0.01;
  const TEXT_RATES_AT_SWITCHED = Object.assign({}, TURN_PRICING.text.creditRates);
  let _regime = { switched:true, usdPerCredit:SWITCHED_USD_PER_CREDIT, trialCredits:TURN_PRICING.trialCredits, legacyUntil:null, source:"default" };
  function _normRegime(r){
    if(!r || typeof r!=="object") return null;
    const row = Array.isArray(r) ? r[0] : r;
    if(!row || typeof row!=="object" || typeof row.switched!=="boolean") return null;
    const usd = Number(row.usdPerCredit!=null ? row.usdPerCredit : row.usd_per_credit);
    // only the two units the database knows; anything else is a bad read
    const unit = (Math.abs(usd-0.01) < 1e-9 || Math.abs(usd-0.03) < 1e-9) ? usd : (row.switched ? 0.01 : 0.03);
    const trial = Number(row.trialCredits!=null ? row.trialCredits : row.trial_credits);
    const until = row.legacyUntil!=null ? row.legacyUntil : row.legacy_until;
    return { switched:row.switched, usdPerCredit:unit,
      trialCredits: Number.isFinite(trial) && trial>=0 ? trial : (row.switched ? TURN_PRICING.trialCredits : 0),
      legacyUntil: until ? String(until) : null };
  }
  function _applyAnchor(){
    const base = _regime.usdPerCredit * CREDIT_SCALE;          // 0.10 after the switch, 0.30 before
    TURN_PRICING.credit.baseProviderUsd = base;
    TURN_PRICING.credit.visibleProviderUsd = _regime.usdPerCredit;
    const k = BASE_PROVIDER_USD_PER_CREDIT / base;             // 1 after the switch, 1/3 before
    const rates = TURN_PRICING.text.creditRates;
    Object.keys(TEXT_RATES_AT_SWITCHED).forEach(m=>{ rates[m] = Math.round(TEXT_RATES_AT_SWITCHED[m]*k*10000)/10000; });
  }
  /* apply a regime read from turn_credit_regime() (source "server") or the browser's memory.
     Returns true when the unit, the trial or the grandfathering date changed, or when this is the
     first read that makes the unit known. */
  function turnApplyCreditRegime(r, source){
    const n = _normRegime(r);
    if(!n) return false;
    const changed = n.switched!==_regime.switched || n.usdPerCredit!==_regime.usdPerCredit
      || n.trialCredits!==_regime.trialCredits || n.legacyUntil!==_regime.legacyUntil;
    // the first real read also counts as a change for the plan cards, the trial line and the packs,
    // which wait for a KNOWN unit even when it equals the default (turnCreditRegimeKnown)
    const becameKnown = _regime.source==="default" && (source || "server")!=="default";
    _regime = { ...n, source: source || "server" };
    if(_regime.source==="server"){ try{ localStorage.setItem(REGIME_KEY, JSON.stringify(n)); }catch(e){} }
    if(changed){
      _applyAnchor();
      try{ window.dispatchEvent(new CustomEvent("turn-pricing-changed")); }catch(e){}
    }
    if(changed || becameKnown){
      try{ window.dispatchEvent(new CustomEvent("turn-credit-regime-changed", { detail:{ ..._regime } })); }catch(e){}
    }
    return changed || becameKnown;
  }
  function turnCreditRegime(){ return { ..._regime }; }
  /* true once the unit came from the server or this browser's saved copy of it. Cost quotes may
     keep the safe switched default, but the trial line, the pack buttons and the plan-card
     allowance numbers show only when this is true (app/plans.jsx) — a first paint before the
     read, or a failed read, never advertises a trial or a price that may not be live yet. */
  function turnCreditRegimeKnown(){ return _regime.source!=="default"; }
  // the last regime this browser read, so the first paint already quotes in it
  try{ const saved = JSON.parse(localStorage.getItem(REGIME_KEY)||"null"); const n = _normRegime(saved); if(n){ _regime = { ...n, source:"saved" }; } }catch(e){}
  _applyAnchor();

  function turnProviderUsdPerBaseCredit(){
    return TURN_PRICING.credit.baseProviderUsd;
  }
  function turnCreditsFromProviderUsd(usd){
    return (Number(usd)||0) / TURN_PRICING.credit.baseProviderUsd * TURN_PRICING.credit.scale;
  }
  function turnImageProviderUsdTable(){
    return TURN_PRICING.image.providerUsd;
  }
  /* GPT Image cost scales with output size: fal's two GPT Image 2 points ($0.158 at 2.07 MP,
     $0.401 at 8.29 MP) fit cost ∝ MP^0.672 — kept for 2.5. Mirrors billing-pricing.mjs gptImageSizeFactor. */
  const GPT_IMAGE_BASELINE_MP = { "gpt-image-2.5-flare":1024*1024/1e6, "gpt-image-2.5-sunburst":1024*1024/1e6 };
  const GPT_IMAGE_SIZES = {
    "16:9": { "1K":"1280x720", "2K":"2048x1152", "4K":"3840x2160" },
    "9:16": { "1K":"720x1280", "2K":"1152x2048", "4K":"2160x3840" },
    "21:9": { "1K":"1344x576", "2K":"2688x1152", "4K":"3808x1632" },
    "1:1":  { "1K":"1024x1024", "2K":"2048x2048", "4K":"3840x3840" },
    "3:4":  { "1K":"768x1024", "2K":"1536x2048", "4K":"2880x3840" },
    "4:3":  { "1K":"1024x768", "2K":"2048x1536", "4K":"3840x2880" },
  };
  function turnGptImageSizeFactor(model, aspect, imageSize){
    const base = GPT_IMAGE_BASELINE_MP[model] || GPT_IMAGE_BASELINE_MP["gpt-image-2.5-sunburst"];
    const tier = ["1K","2K","4K"].indexOf(imageSize)>=0 ? imageSize : "2K";
    const dims = (GPT_IMAGE_SIZES[aspect] || GPT_IMAGE_SIZES["16:9"])[tier].split("x").map(Number);
    return Math.pow((dims[0]*dims[1]/1e6)/base, 0.672);
  }
  /* SEEDREAM 5 PRO (2026-10-11, owner — image engines): the exact {width, height} the server sends fal and prices
     (billing-pricing.mjs seedreamImageDimensions): 1K = the smallest area at or above 1024x1024 for the aspect, 2K
     (and a 4K pick) the largest at or below 2048x2048, both sides multiples of 16. Its price tier follows that
     area — $0.0675 up to 1536x1536, $0.135 above — plus $0.0045 for each reference after the first (at most 10
     references are sent: fal's edit route uses no more). */
  const SEEDREAM_ASPECTS = { "16:9":16/9, "9:16":9/16, "21:9":21/9, "1:1":1, "3:4":3/4, "4:3":4/3 };
  const SEEDREAM_MAX_REFERENCES = 10;
  function turnSeedreamImageSize(imageSize){ return imageSize==="1K" ? "1K" : "2K"; }
  function turnSeedreamImageDimensions(aspect, imageSize){
    const r = SEEDREAM_ASPECTS[aspect] || SEEDREAM_ASPECTS["16:9"];
    const big = turnSeedreamImageSize(imageSize)==="2K";
    const area = big ? 2048*2048 : 1024*1024;
    const snap = (v)=> (big ? Math.floor(v/16) : Math.ceil(v/16)) * 16;
    return { width:snap(Math.sqrt(area*r)), height:snap(Math.sqrt(area/r)) };
  }
  function turnSeedreamProviderUsd(aspect, imageSize, refs){
    const row = TURN_PRICING.image.providerUsd["seedream-5-pro"];
    if(!row) return null;
    const d = turnSeedreamImageDimensions(aspect, imageSize);
    const tier = Number(d.width*d.height <= 1536*1536 ? row.standard : row.large);
    if(!(tier>0)) return null;
    const n = Math.min(SEEDREAM_MAX_REFERENCES, Math.max(0, Math.floor(Number(refs)||0)));
    return tier + Math.max(0, n-1) * Math.max(0, Number(row.extraRef)||0);
  }
  /* PROMPT LIMITS PER IMAGE ENGINE (2026-10-14, owner — "go ahead with all of it"): the longest prompt each engine is
     sent — the SAME table as supabase/functions/image-proxy/billing-pricing.mjs IMAGE_PROMPT_LIMITS (the server
     refuses a longer prompt with prompt_too_long before any hold). GPT Image 2.5: fal stops at 32,000 → 31,500;
     Nano Banana 2.1: fal's 50,000, held at the 40,000 every image route allows; Seedream 5 Pro: no published limit,
     short prompts advised → 30,000. The prompt builders fit themselves under it and proxyGenerate trims what is
     left (imagegen.jsx nbFitImagePrompt) — nobody is ever asked to shorten a prompt. */
  const IMAGE_PROMPT_MAX_CHARS = 40000;
  const IMAGE_PROMPT_LIMITS = Object.freeze({
    "gpt-image-2.5-flare": 31500,
    "gpt-image-2.5-sunburst": 31500,
    "gemini-nano-banana-2.1": IMAGE_PROMPT_MAX_CHARS,
    "seedream-5-pro": 30000,
  });
  /* the longest prompt an engine (an id the caller has already mapped from a retired one) is sent */
  function turnImagePromptMaxChars(model){
    const id = String(model||"");
    const n = Object.prototype.hasOwnProperty.call(IMAGE_PROMPT_LIMITS, id) ? Number(IMAGE_PROMPT_LIMITS[id]) : IMAGE_PROMPT_MAX_CHARS;
    return Math.min(IMAGE_PROMPT_MAX_CHARS, n>0 ? n : IMAGE_PROMPT_MAX_CHARS);
  }
  /* whole credits for a provider cost, exactly as the server rounds (billing-pricing.mjs
     creditsFromUsd): up, at least 1, with a hair of float tolerance */
  function turnCreditCost(usd){
    const n = Number(usd);
    if(!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.ceil(n / TURN_PRICING.credit.visibleProviderUsd - 1e-9));
  }
  function turnVideoCreditRate(modelId, tierId, resolution){
    const usd = (((TURN_PRICING.video.providerUsdPerSecond[modelId]||{})[tierId]||{})[resolution]);
    return Number(usd)>0 ? Number(usd) / TURN_PRICING.credit.baseProviderUsd : null;
  }
  function turnVideoCreditRates(modelId, tierId){
    const src = ((TURN_PRICING.video.providerUsdPerSecond[modelId]||{})[tierId]) || null;
    if(!src) return null;
    const out = {};
    Object.keys(src).forEach(k=>{ out[k] = src[k] / TURN_PRICING.credit.baseProviderUsd; });
    return out;
  }
  function turnCreditPackEconomics(pack){
    const price = Number(pack && pack.priceUsd) || 0;
    const credits = Number(pack && pack.credits) || 0;
    const stripe = price ? (price * TURN_PRICING.buffers.stripePercent + TURN_PRICING.buffers.stripeFixedUsd) : 0;
    const providerExposure = credits * TURN_PRICING.credit.visibleProviderUsd;
    const net = price - stripe;
    return {
      sku: pack && pack.sku,
      priceUsd: price,
      credits,
      stripeFeeUsd: Math.round(stripe*100)/100,
      netAfterStripeUsd: Math.round(net*100)/100,
      providerExposureUsd: Math.round(providerExposure*100)/100,
      marginUsd: Math.round((net-providerExposure)*100)/100,
      marginPercent: price ? Math.round(((net-providerExposure)/price)*1000)/10 : null,
    };
  }

  /* ── admin pricing overrides (fal price drift) ─────────────────────────────
     Applied at runtime from turn_app_config "pricing-overrides" (written only
     by the admin's reviewed one-click apply in the price-drift card — see
     app/pricing-watch.jsx). Mutates the LIVE table objects IN PLACE so every
     consumer that holds a reference (imagegen's NB_IMG_USD is the same object)
     sees the new numbers; listeners on "turn-pricing-changed" (stage.jsx tier
     rates, cost chips) refresh their derived copies.
     FAIL-SAFE: only keys that already exist in the table are writable, and a
     value outside sane provider-USD bounds is rejected — a garbage or zero
     price can never land here. */
  function _ovNumOk(v){ v = Number(v); return Number.isFinite(v) && v > 0.0002 && v < 100; }
  function turnApplyPricingOverrides(ov){
    if(!ov || typeof ov !== "object") return false;
    let applied = 0;
    const img = ov.image || {};
    Object.keys(img).forEach(m=>{
      const t = TURN_PRICING.image.providerUsd[m]; if(!t || typeof img[m]!=="object") return;
      Object.keys(img[m]||{}).forEach(k=>{
        if(Object.prototype.hasOwnProperty.call(t,k) && _ovNumOk(img[m][k])){ t[k] = Number(img[m][k]); applied++; }
      });
    });
    const vid = ov.video || {};
    Object.keys(vid).forEach(m=>{
      const mt = TURN_PRICING.video.providerUsdPerSecond[m]; if(!mt || typeof vid[m]!=="object") return;
      Object.keys(vid[m]||{}).forEach(tier=>{
        const tt = mt[tier]; if(!tt || typeof vid[m][tier]!=="object") return;
        Object.keys(vid[m][tier]||{}).forEach(r=>{
          if(Object.prototype.hasOwnProperty.call(tt,r) && _ovNumOk(vid[m][tier][r])){ tt[r] = Number(vid[m][tier][r]); applied++; }
        });
      });
    });
    if(applied){
      if(ov.version) TURN_PRICING.version = String(ov.version);
      try{ window.dispatchEvent(new CustomEvent("turn-pricing-changed")); }catch(e){}
    }
    return applied > 0;
  }
  window.turnApplyPricingOverrides = turnApplyPricingOverrides;

  window.CREDIT_SCALE = CREDIT_SCALE;
  window.TURN_PRICING = TURN_PRICING;
  window.turnApplyCreditRegime = turnApplyCreditRegime;
  window.turnCreditRegime = turnCreditRegime;
  window.turnCreditRegimeKnown = turnCreditRegimeKnown;
  window.turnProviderUsdPerBaseCredit = turnProviderUsdPerBaseCredit;
  window.turnCreditsFromProviderUsd = turnCreditsFromProviderUsd;
  window.turnImageProviderUsdTable = turnImageProviderUsdTable;
  window.turnGptImageSizeFactor = turnGptImageSizeFactor;
  window.turnSeedreamImageSize = turnSeedreamImageSize;
  window.turnSeedreamImageDimensions = turnSeedreamImageDimensions;
  window.turnSeedreamProviderUsd = turnSeedreamProviderUsd;
  window.TURN_SEEDREAM_MAX_REFERENCES = SEEDREAM_MAX_REFERENCES;
  window.TURN_IMAGE_PROMPT_LIMITS = IMAGE_PROMPT_LIMITS;
  window.TURN_IMAGE_PROMPT_MAX_CHARS = IMAGE_PROMPT_MAX_CHARS;
  window.turnImagePromptMaxChars = turnImagePromptMaxChars;
  window.turnCreditCost = turnCreditCost;
  window.turnVideoCreditRate = turnVideoCreditRate;
  window.turnVideoCreditRates = turnVideoCreditRates;
  window.turnCreditPackEconomics = turnCreditPackEconomics;
})();

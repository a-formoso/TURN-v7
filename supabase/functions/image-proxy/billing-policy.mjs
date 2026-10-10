/* billing-policy.mjs — WHO may run WHAT on the server (billing fixes, owner decisions
   2026-09-30). Pure and testable in Node (scripts/test-server-charging.mjs): no Deno or Supabase
   imports. Every paid route in image-proxy asks this module before it holds credits or calls a
   provider; the browser's own gates (app/plans.jsx TIER_GATES / ROOM_ENTITLEMENTS) are only UX.

   PLANS (tier ids as stored; "studio" is shown as Producer; legacy "pro" reads as Director):
     no plan  (none / free / cancelled / a trial account) — writing on the DEFAULT engines and
              DRAFT images only (Nano Banana 2.1 at 1K, app/plans.jsx DRAFT_IMAGE). No video,
              no voice, no 3D, no premium or formerly mispriced engines. Credits (a trial's 50, or
              pack credits) are spent on those.
     writer   Writers' Room: every writing engine; voice for the New Story interview (speech and
              transcription, the voice list); images up to 2K on any engine (dashboard key art —
              the Art Room itself is Director's).
     director Writers' Room + Art Room: every image engine up to 4K, the character voice tools
              (design, save, clone), Blender Studio (3D meshes and the scene assistant).
     studio   + the Stage: video (Stage model / resolution / batch gates as TIER_GATES) and voice.
   A FROZEN account (a disputed payment) may spend nothing; Frances stays available at the
   no-plan cap. A past-due account keeps its plan and credits during Stripe's retries.

   FRANCES (the free help chat and New Story voice) — daily questions by plan: 5 for no plan /
   trial / cancelled, 15 Writer, 30 Director, 50 Producer; admins are exempt (the limiter). */

/* The draft engine (owner 2026-10-10): Nano Banana 2.1 at 1K — it replaced Nano Banana 2 Lite, which
   always rendered at 1K, so a draft's real output is unchanged. A no-plan 2K or 4K request is refused
   (the app caps it to 1K first: app/plans.jsx turnPlanImageChoice). index.ts maps Lite's old id to this
   one before asking (billing-pricing.mjs canonicalImageModel). */
export const DRAFT_IMAGE = Object.freeze({ model: "gemini-nano-banana-2.1", maxRes: "1K" });

/* The DEFAULT writing engines — what a trial or no-plan account may write with. Premium engines
   (Fable 5 / 5.1, GPT-6 Astra, Kimi K3) and the formerly mispriced ones (GPT-5.5, Gemini 3.5
   Flash) need a plan. */
export const DEFAULT_TEXT_MODELS = Object.freeze(["claude-opus-5-5", "gemini-3.8-flash", "kimi-k2.7-code"]);

/* Mirrors app/plans.jsx TIER_GATES (the Stage's model picker, resolution ladder, takes per Generate). */
export const TIER_GATES = Object.freeze({
  writer: Object.freeze({ models: Object.freeze(["kling-3.0"]), maxRes: "720p", maxBatch: 1 }),
  none: Object.freeze({ models: Object.freeze(["kling-3.0"]), maxRes: "720p", maxBatch: 1 }),
  pro: Object.freeze({ models: "all", maxRes: "1080p", maxBatch: 1 }),
  director: Object.freeze({ models: "all", maxRes: "1080p", maxBatch: 1 }),
  studio: Object.freeze({ models: "all", maxRes: "4K", maxBatch: 4 }),
});
/* Mirrors app/plans.jsx ROOM_ENTITLEMENTS. */
export const ROOM_ENTITLEMENTS = Object.freeze({
  writer: Object.freeze({ writers_room: true, art_room: false, stage: false }),
  none: Object.freeze({ writers_room: true, art_room: false, stage: false }),
  pro: Object.freeze({ writers_room: true, art_room: true, stage: false }),
  director: Object.freeze({ writers_room: true, art_room: true, stage: false }),
  studio: Object.freeze({ writers_room: true, art_room: true, stage: true }),
});

export const FRANCES_PLAN_LIMITS = Object.freeze({ none: 5, writer: 15, director: 30, studio: 50 });

const VIDEO_RES_RANK = { "480p": 0, "720p": 1, "1080p": 2, "4k": 3, "4K": 3 };
const IMAGE_RES_RANK = { "1K": 0, "2K": 1, "4K": 2 };
const PLAN_NAMES = { writer: "Writer", director: "Director", studio: "Producer" };

/** The stored plan as a tier: "none" | "writer" | "director" | "studio" (legacy "pro" → director). */
export function normalizePlan(plan) {
  const p = String(plan ?? "").toLowerCase().trim();
  if (p === "writer" || p === "director" || p === "studio") return p;
  if (p === "pro") return "director";
  if (p === "producer") return "studio";
  return "none";
}

/**
 * The caller's account as the proxy sees it, from turn_credit_balance() (or the older
 * turn_credits row). Always a complete object; unknown fields read as the safe default.
 */
export function accountFrom(row, { isAdmin = false } = {}) {
  const r = row && typeof row === "object" ? row : {};
  const num = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.floor(Number(x))) : null);
  const remaining = num(r.remaining) ?? 0;
  const status = String(r.payment_status ?? r.paymentStatus ?? "active").toLowerCase().trim() || "active";
  return {
    isAdmin: !!isAdmin,
    plan: normalizePlan(r.plan),
    rawPlan: String(r.plan ?? "none"),
    remaining,
    planRemaining: num(r.plan_remaining ?? r.planRemaining),
    packRemaining: num(r.pack_remaining ?? r.packRemaining),
    paymentStatus: status,
    frozen: r.frozen === true,
    trial: r.trial === true,
  };
}

export function isPaid(account) {
  return !!account && account.plan !== "none";
}

/** Frances's daily question cap for this account (admins are exempt before this is asked). */
export function francesPlanLimit(account) {
  if (!account || account.frozen || !isPaid(account)) return FRANCES_PLAN_LIMITS.none;
  return FRANCES_PLAN_LIMITS[account.plan] || FRANCES_PLAN_LIMITS.none;
}

/* ─── refusals: the bodies app/plans.jsx turnBillingError() understands ─── */

export function refusal(status, code, message, extra = {}) {
  return { status, body: { error: code, code, message, ...extra } };
}
export function planRequired(what) {
  return refusal(402, "plan_required", `${what} needs a paid plan. Without a plan, credits cover writing on the default engines and draft images.`);
}
export function tierRequired(what, needPlan, { plural = false } = {}) {
  const name = PLAN_NAMES[needPlan] || "a higher";
  return refusal(403, "tier_required", `${what} ${plural ? "need" : "needs"} the ${name} plan.`, { requiredPlan: needPlan });
}
export function frozenRefusal() {
  return refusal(403, "account_frozen", "Your account is on hold while a payment is disputed, so spending credits is paused.");
}
/** A credit count as users read it: whole, with thousands separators ("1,709"; round 3, S7). */
export function formatCredits(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function insufficientRefusal(need, have) {
  const n = Math.max(0, Math.ceil(Number(need) || 0));
  const h = Math.max(0, Math.floor(Number(have) || 0));
  return refusal(402, "insufficient_credits", `This generation needs ${formatCredits(n)} ${n === 1 ? "credit" : "credits"}, but this account has ${formatCredits(h)}.`, { creditsRequired: n, creditsRemaining: h });
}
/* No plan and nothing left (a new account before its trial, a used-up trial, a cancelled account
   with an empty balance): the older "choose a plan" refusal, which opens the Plans window. */
export function noPlanRefusal() {
  return refusal(402, "no_plan", "Choose a plan to start creating — every generation runs on your plan's credits.");
}
/** The refusal for a balance that can't cover `need`. */
export function shortOfCredits(account, need, have) {
  return !isPaid(account) && Math.floor(Number(have) || 0) <= 0 ? noPlanRefusal() : insufficientRefusal(need, have);
}
/**
 * A writing call whose engine needs more for ONE answer than the balance holds (the hold covers
 * the whole thinking room, so a small balance can fall short of a heavy engine even though a
 * lighter one would run). Names the shortfall and points at a lighter writing engine (repair
 * F20); an empty no-plan balance keeps the "choose a plan" refusal.
 * ROUND 3 (S5): a lighter engine is suggested only when one could run. A balance of 0, or below
 * `cheapest` (the smallest hold one answer to this request needs on the cheapest default engine —
 * billing-pricing.mjs cheapestTextHold), gets the plain insufficient-credits refusal (add credits
 * or upgrade), never "choose a lighter writing engine".
 */
export function writingShortfall(account, need, have, { cheapest = null } = {}) {
  const n = Math.max(0, Math.ceil(Number(need) || 0));
  const h = Math.max(0, Math.floor(Number(have) || 0));
  const floor = Number(cheapest);
  if (h <= 0 || (cheapest != null && Number.isFinite(floor) && h < floor)) return shortOfCredits(account, n, h);
  const short = Math.max(1, n - h);
  return refusal(402, "insufficient_credits",
    `This writing engine needs at least ${formatCredits(n)} ${n === 1 ? "credit" : "credits"} for one answer, but this account has ${formatCredits(h)} (${formatCredits(short)} short). Choose a lighter writing engine, or add credits.`,
    { creditsRequired: n, creditsRemaining: h, creditsShort: short, suggest: "lighter_writing_engine" });
}
export function billingUnavailable() {
  return refusal(503, "billing_unavailable", "Credits can't be checked right now. Please try again in a minute.");
}
export function modelNotAllowed(kind) {
  return refusal(400, "model_not_allowed", `That ${kind} engine isn't available.`);
}

/* ─── the gates: each returns null (allowed) or a refusal ─── */

function spendable(account) {
  if (account.frozen) return frozenRefusal();
  return null;
}

/** A metered writing / vision call on `priceKey` (billing-pricing textPriceKey). */
export function checkText(account, priceKey) {
  if (!account || account.isAdmin) return null;
  const f = spendable(account); if (f) return f;
  if (!priceKey) return modelNotAllowed("writing");
  if (!isPaid(account) && !DEFAULT_TEXT_MODELS.includes(priceKey)) return planRequired("This writing engine");
  return null;
}

/** An image render. */
export function checkImage(account, { model, imageSize }) {
  if (!account || account.isAdmin) return null;
  const f = spendable(account); if (f) return f;
  const rank = IMAGE_RES_RANK[imageSize];
  if (rank == null) return refusal(400, "bad_request", "Choose a 1K, 2K or 4K image.");
  if (!isPaid(account)) {
    if (model !== DRAFT_IMAGE.model || rank > IMAGE_RES_RANK[DRAFT_IMAGE.maxRes]) return planRequired("This image engine or resolution");
    return null;
  }
  if (account.plan === "writer" && rank > IMAGE_RES_RANK["2K"]) return tierRequired("4K images", "director", { plural: true });
  return null;
}

/* Voice ops: "tts" / "stt" / "listVoices" power the New Story interview (Writer and up);
   "design" / "saveVoice" / "clone" are the Art Room's character voice tools (Director and up). */
const VOICE_LIBRARY_OPS = new Set(["design", "saveVoice", "clone"]);
export function checkVoice(account, op) {
  if (!account || account.isAdmin) return null;
  const f = spendable(account); if (f) return f;
  if (!isPaid(account)) return planRequired("Voice");
  if (VOICE_LIBRARY_OPS.has(op) && !ROOM_ENTITLEMENTS[account.plan].art_room) return tierRequired("Character voices", "director", { plural: true });
  return null;
}

/**
 * A Stage video job (submit, or opening an upload slot for one). `appModel` is the Stage model id
 * (billing-pricing videoAppModel), `resolution` the proxy's resolved one, `batch` the takes per
 * Generate the request declares (the Stage sends one request per take; each is held separately).
 */
export function checkVideo(account, { appModel, resolution, batch } = {}) {
  if (!account || account.isAdmin) return null;
  const f = spendable(account); if (f) return f;
  if (!isPaid(account)) return planRequired("Video");
  if (!ROOM_ENTITLEMENTS[account.plan].stage) return tierRequired("The Stage", "studio");
  const gate = TIER_GATES[account.plan] || TIER_GATES.none;
  if (appModel && gate.models !== "all" && !gate.models.includes(appModel)) return tierRequired("This video model", "director");
  const rank = VIDEO_RES_RANK[String(resolution || "")];
  if (rank != null && rank > VIDEO_RES_RANK[gate.maxRes]) return tierRequired(`${resolution} video`, "studio");
  const b = Number(batch);
  if (Number.isFinite(b) && b > gate.maxBatch) return tierRequired(`${b} takes at once`, "studio", { plural: true });
  return null;
}

/** Blender Studio (3D meshes and the scene assistant) — the Art Room's Locations tab. */
export function checkStudio3d(account) {
  if (!account || account.isAdmin) return null;
  const f = spendable(account); if (f) return f;
  if (!isPaid(account)) return planRequired("3D");
  if (!ROOM_ENTITLEMENTS[account.plan].art_room) return tierRequired("Blender Studio", "director");
  return null;
}

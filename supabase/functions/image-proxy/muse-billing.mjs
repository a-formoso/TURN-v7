/* muse-billing.mjs — which text calls ride MUSE's free path (2026-09-28, Round 1), pure and
   testable in Node (scripts/test-round1-ai.mjs). No Deno or Supabase imports.

   MUSE, the in-app help chat, is free to users: its calls record 0 credits and skip the spend
   check. The label that asks for that, usageKind "muse", comes from the browser, so on its own it
   let ANY text call (any model, any size) skip metering. A call now gets the free path only when
   it really is MUSE's:
     - usageKind is "muse";
     - it runs on MUSE's own model, pinned HERE (the request's provider and model must equal it;
       the app's MUSE_MODEL in app/ai.jsx sends exactly these);
     - it is text only (no images) and asks for no extra output budget or reasoning effort;
     - it stays MUSE-sized: at most MUSE_LIMITS.maxMessages messages and
       MUSE_LIMITS.maxInputChars characters of message text in all (the app trims MUSE's chat to
       80,000 characters, app/ai.jsx MUSE_INPUT_BUDGET, so a real MUSE call always fits).
   Anything else labelled "muse" is metered like any other text call: it needs a credit to start
   and is charged by its real token use ("vision" rate when it carries images). Calls with any
   other usageKind are untouched.

   TIGHTER FIT (2026-09-28, Round 1 review): the free path still let a hand-edited request run the
   app's own drafting prompts on MUSE's model for free, as often as it liked. Now it also has to
   look like MUSE's chat, and it is bounded:
     - only user and assistant turns (since 2026-09-30 after at most ONE leading system message —
       the cached prefix — and only on a request that sets promptCache: app/ai.jsx aiMuseChat;
       aiMuseFollowups sends a single user turn);
     - the proxy caps a free call's reply at MUSE_LIMITS.maxOutputTokens (4,096: the cap every
       Claude call — MUSE included — ran under until 2026-09-26; a MUSE reply is a few sentences)
       and never passes a reasoning-effort setting on it;
     - a DAILY ALLOWANCE: MUSE_LIMITS.dailyFreeCalls free calls per account in any 24 hours
       (each chat turn is up to two calls: the reply and its follow-up suggestions). Past it, MUSE
       calls are metered like any other writing call until the window rolls on.

   OPUS 5.5 + PROMPT CACHING (billing fixes, owner decisions 2026-09-30): Frances moves to the
   cheaper Opus 5.5 ($4 / $20 per 1M tokens, cached input $0.20). The free path accepts BOTH
   model names PERMANENTLY (MUSE_MODELS: Opus 5.5 and Opus 5, which an app still running an older
   build sends — repair F18) and ALWAYS RUNS Opus 5.5 (MUSE_MODEL): index.ts sends MUSE_MODEL.model
   to the provider for every free Frances call, whatever the request named, so an old tab never
   costs Opus 5's price and nothing has to be removed or redeployed later.
   To be cached, the long, stable product guide must be a PREFIX that is identical on every
   question. A request that sets `promptCache: true` may therefore carry it as ONE leading system
   message; the proxy sends that as Anthropic's `system` block with cache_control, so repeat
   questions within 5 minutes read it at a tenth (Opus 5.5: a twentieth) of the input price.
   Without `promptCache` a system message still means "not a chat turn" (metered). The size
   limits count the system message too. */

export const MUSE_MODEL = Object.freeze({ provider: "anthropic", model: "claude-opus-5-5" });
/* Every model name the free path accepts (the one it runs first). Both stay: a free call always
   RUNS MUSE_MODEL.model (museRunModel). */
export const MUSE_MODELS = Object.freeze(["claude-opus-5-5", "claude-opus-5"]);
export const MUSE_LIMITS = Object.freeze({
  maxInputChars: 90000, maxMessages: 12, maxOutputTokens: 4096,
  dailyFreeCalls: 200, allowanceWindowMs: 24 * 60 * 60 * 1000,
});

/** The model a text call runs on: MUSE_MODEL for a free Frances call, else what it asked for. */
export function museRunModel(kind, requestedModel) {
  return kind === "muse" ? MUSE_MODEL.model : String(requestedModel || "");
}

/** The start of the free-MUSE allowance window (ISO), `nowMs` being the current time. */
export function museAllowanceSince(nowMs) {
  const now = Number(nowMs);
  return new Date((Number.isFinite(now) ? now : Date.now()) - MUSE_LIMITS.allowanceWindowMs).toISOString();
}

/** Total characters of message text (string contents, or the text parts of a parts array). */
export function museMessagesSize(messages) {
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    const c = m && m.content;
    if (typeof c === "string") n += c.length;
    else if (Array.isArray(c)) for (const p of c) n += String((p && (p.text ?? p.content)) || "").length;
    else if (c != null) n += String(c).length;
  }
  return n;
}

/** Why a "muse"-labelled request is NOT MUSE's (a short reason), or "" when it is. */
export function museRefusal(req) {
  const r = req || {};
  if (String(r.provider || "") !== MUSE_MODEL.provider || !MUSE_MODELS.includes(String(r.model || ""))) return "not MUSE's model";
  if (Array.isArray(r.images) && r.images.length) return "carries images";
  if (Number(r.maxTokens) > 0) return "asks for an output budget";
  if (r.effort || r.reasoningEffort || r.thinkingLevel) return "asks for reasoning effort";
  const msgs = r.messages;
  if (!Array.isArray(msgs) || !msgs.length) return "no messages";
  if (msgs.length > MUSE_LIMITS.maxMessages) return "too many messages";
  if (msgs.some((m) => !m || typeof m.content !== "string")) return "non-text message";
  // one leading system message (the cached product guide) only when the request asks for caching
  const cachedPrefix = r.promptCache === true && msgs[0] && msgs[0].role === "system" ? 1 : 0;
  if (msgs.some((m, i) => m.role !== "user" && m.role !== "assistant" && !(i < cachedPrefix))) return "not a chat turn";
  if (cachedPrefix && msgs.length < 2) return "no question";
  if (museMessagesSize(msgs) > MUSE_LIMITS.maxInputChars) return "over MUSE's input size";
  return "";
}

/**
 * The kind a text call is metered as.
 *   { kind, free, reason }
 *   kind   "muse" (free: 0 credits, no spend check) only for a real MUSE call within today's
 *          allowance; a refused "muse" label becomes "vision" (with images) or "text"; any other
 *          usageKind is returned as is
 *   free   kind === "muse"
 *   reason why a "muse" label was refused ("" otherwise)
 * `usage.freeCallsToday` (optional): the account's free MUSE calls in the allowance window — the
 * proxy counts them only for a call that is otherwise free, and leaves it out when it can't.
 */
export function textBillingKind(req, usage) {
  const usageKind = String((req && req.usageKind) || "").toLowerCase();
  if (usageKind !== "muse") return { kind: usageKind, free: false, reason: "" };
  const reason = museRefusal(req);
  const used = Number(usage && usage.freeCallsToday);
  if (!reason && !(Number.isFinite(used) && used >= MUSE_LIMITS.dailyFreeCalls)) return { kind: "muse", free: true, reason: "" };
  const withImages = Array.isArray(req.images) && req.images.length > 0;
  return { kind: withImages ? "vision" : "text", free: false, reason: reason || "over today's free MUSE allowance" };
}

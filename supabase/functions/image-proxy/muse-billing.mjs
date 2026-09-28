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
     - only user and assistant turns — MUSE folds its rules into the first user turn and never
       sends a system message (app/ai.jsx aiMuseChat / aiMuseFollowups);
     - the proxy caps a free call's reply at MUSE_LIMITS.maxOutputTokens (4,096: the cap every
       Claude call — MUSE included — ran under until 2026-09-26; a MUSE reply is a few sentences)
       and never passes a reasoning-effort setting on it;
     - a DAILY ALLOWANCE: MUSE_LIMITS.dailyFreeCalls free calls per account in any 24 hours
       (each chat turn is up to two calls: the reply and its follow-up suggestions). Past it, MUSE
       calls are metered like any other writing call until the window rolls on. */

export const MUSE_MODEL = Object.freeze({ provider: "anthropic", model: "claude-opus-5" });
export const MUSE_LIMITS = Object.freeze({
  maxInputChars: 90000, maxMessages: 12, maxOutputTokens: 4096,
  dailyFreeCalls: 200, allowanceWindowMs: 24 * 60 * 60 * 1000,
});

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
  if (String(r.provider || "") !== MUSE_MODEL.provider || String(r.model || "") !== MUSE_MODEL.model) return "not MUSE's model";
  if (Array.isArray(r.images) && r.images.length) return "carries images";
  if (Number(r.maxTokens) > 0) return "asks for an output budget";
  if (r.effort || r.reasoningEffort || r.thinkingLevel) return "asks for reasoning effort";
  const msgs = r.messages;
  if (!Array.isArray(msgs) || !msgs.length) return "no messages";
  if (msgs.length > MUSE_LIMITS.maxMessages) return "too many messages";
  if (msgs.some((m) => !m || typeof m.content !== "string")) return "non-text message";
  if (msgs.some((m) => m.role !== "user" && m.role !== "assistant")) return "not a chat turn";
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

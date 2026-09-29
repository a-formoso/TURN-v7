/* frances-limit.mjs — Frances's DAILY QUESTION LIMIT (owner decision 2026-09-28), pure and
   testable in Node (scripts/test-frances-limit.mjs). No Deno or Supabase imports: index.ts hands
   in the database call.

   Frances (codename MUSE), the in-app help chat, is free to users. So that nobody can use her as
   a free general AI, each person gets FRANCES_DAILY_LIMIT_DEFAULT (50) free questions per UTC day
   (the image-proxy secret FRANCES_DAILY_LIMIT overrides it; Frances's own facts in app/ai.jsx name
   the number too, so change them together: supabase/README.md). Past that, the proxy answers
   HTTP 429 { error: "frances_daily_limit", limit, used, resets_at, message } and makes NO model
   call; the app shows it as a calm reply from Frances, not an error.

   WHERE IT RUNS (index.ts, text task): only for a call on the free path, i.e. after
   museRefusal() (muse-billing.mjs) has accepted it as Frances's own and the older 24-hour
   allowance still leaves it free (textKind "muse"). Metered calls, other usage kinds and admins
   (the proxy's admin check) never reach it.
   ALSO (index.ts, live task; owner decision 2026-09-29): each New Story voice session takes one
   slot through this same limiter, after the request is validated and before the session call
   (admins exempt; scripts/test-frances-voice-limit.mjs). So the 429 bodies and messages here
   reach app/livevoice.js as well as the chat: change them with both clients in mind.

   HOW IT COUNTS: supabase/frances-daily-limit.sql, public.turn_frances_consume(p_user, p_limit),
   called with the service-role client. One atomic upsert takes a slot only while the day's count
   is under the limit, so two questions sent together can't both take the last one. Every free
   call counts as one question: the chat sends one call per question (aiMuseChat); the follow-up
   suggestions helper (aiMuseFollowups) is not wired into the chat. A voice session counts as one
   question, however long it lasts. A slot is never given back, even when the model call or the
   voice session then fails.

   BUSY: the function waits at most 1 s (lock_timeout) for the person's day row. Only their own
   calls hold it and the app sends one question at a time, so a call still waiting then is one of
   a burst of parallel calls: the function answers { allowed: false, busy: true } (an escaping
   SQLSTATE 55P03 reads the same), nothing is counted, and the proxy answers
   HTTP 429 { error: "frances_busy", message } with NO model call. Without it, a big enough burst
   could queue past the timeout below, which fails open, and be served.

   FAIL OPEN: the limit must never break Frances. When the function is missing (the SQL has not
   been run yet), errors, answers something unexpected or takes longer than
   FRANCES_LIMIT_TIMEOUT_MS (8 s: far above a normal answer and the 1 s busy wait, so only an
   outage gets there), the question is served and the proxy logs the problem once per instance
   and kind. While the limit fails open, the older allowance in muse-billing.mjs
   (MUSE_LIMITS.dailyFreeCalls in any 24 hours, then metered) still bounds free use. */

export const FRANCES_DAILY_LIMIT_DEFAULT = 50;
export const FRANCES_LIMIT_MAX = 100000;          // the SQL function refuses anything larger
export const FRANCES_LIMIT_TIMEOUT_MS = 8000;       // only an outage waits this long (the SQL's own lock wait stops at 1 s)
export const FRANCES_LIMIT_ERROR = "frances_daily_limit";
export const FRANCES_BUSY_ERROR = "frances_busy";
export const FRANCES_LIMIT_RPC = "turn_frances_consume";

/** The day's limit from the FRANCES_DAILY_LIMIT secret: a whole number 1..FRANCES_LIMIT_MAX, else the default. */
export function francesDailyLimit(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,9}$/.test(s)) return FRANCES_DAILY_LIMIT_DEFAULT;
  const n = Number(s);
  return n >= 1 && n <= FRANCES_LIMIT_MAX ? n : FRANCES_DAILY_LIMIT_DEFAULT;
}

/** The next UTC midnight after `nowMs`, as "YYYY-MM-DDT00:00:00Z" (the SQL function's format). */
export function nextUtcMidnight(nowMs) {
  const n = Number(nowMs);
  const d = new Date(Number.isFinite(n) ? n : Date.now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().replace(".000Z", "Z");
}

/** What went wrong with the database call, as a short kind for the log: "missing", "timeout" or "error". */
export function francesLimitProblem(error) {
  const e = error || {};
  if (e.francesTimeout) return "timeout";
  const code = String(e.code || "");
  const msg = String(e.message || e);
  if (code === "PGRST202" || code === "42883" || code === "42P01"
    || /could not find the function|function .*turn_frances_consume.* does not exist|relation .*turn_frances_usage.* does not exist/i.test(msg)) return "missing";
  return "error";
}

/** A lock wait past the function's lock_timeout (SQLSTATE 55P03): this person's own calls are piling up. */
export function francesLimitBusy(error) {
  const e = error || {};
  return String(e.code || "") === "55P03" || /canceling statement due to lock timeout/i.test(String(e.message || ""));
}

/** The user-safe line the proxy sends with a busy 429 (the app shows its own copy of it). */
export const FRANCES_BUSY_MESSAGE = "One question at a time, please — ask me again in a moment.";

/** The user-safe line the proxy sends with a 429 (the app writes its own reply from limit and resets_at). */
export function francesLimitMessage(limit) {
  const n = Number(limit) > 0 ? Math.floor(Number(limit)) : FRANCES_DAILY_LIMIT_DEFAULT;
  return `That’s today’s ${n} free ${n === 1 ? "question" : "questions"} with Frances. She’ll be back after midnight UTC.`;
}

function asResult(data) {
  let r = data;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (_e) { return null; } }
  if (Array.isArray(r)) r = r.length === 1 ? r[0] : null;
  if (r && typeof r === "object" && r.turn_frances_consume && typeof r.turn_frances_consume === "object") r = r.turn_frances_consume;
  return r && typeof r === "object" && typeof r.allowed === "boolean" ? r : null;
}

function busyDecision(limit, used) {
  const body = { error: FRANCES_BUSY_ERROR, message: FRANCES_BUSY_MESSAGE, limit };
  if (used != null) body.used = used;
  return { serve: false, outcome: "busy", status: 429, body };
}

/**
 * Serve or refuse one free Frances question, from the database call's outcome.
 *   { serve: true,  outcome: "admin" }                         admins are never counted
 *   { serve: true,  outcome: "allowed", used, limit }          a slot was taken
 *   { serve: false, outcome: "limited", status: 429, body }    no slot left today: answer with body, call no model
 *   { serve: false, outcome: "busy",    status: 429, body }    one of a burst of parallel calls (busy / 55P03): no model call
 *   { serve: true,  outcome: "fail-open", problem, detail }    the count could not be kept: serve it anyway
 * `result` is the function's jsonb {allowed, used, limit, resets_at}; `error` a thrown error or the
 * client's { message, code }.
 */
export function francesLimitDecision({ isAdmin = false, result = null, error = null, limit = FRANCES_DAILY_LIMIT_DEFAULT, nowMs = Date.now() } = {}) {
  if (isAdmin) return { serve: true, outcome: "admin" };
  if (error && francesLimitBusy(error)) return busyDecision(francesDailyLimit(limit), null);
  if (error) return { serve: true, outcome: "fail-open", problem: francesLimitProblem(error), detail: String((error && error.message) || error).slice(0, 300) };
  const r = asResult(result);
  if (!r) return { serve: true, outcome: "fail-open", problem: "malformed", detail: String(JSON.stringify(result) ?? "").slice(0, 300) };
  const lim = Number.isInteger(r.limit) && r.limit > 0 ? r.limit : francesDailyLimit(limit);
  const used = Number.isFinite(Number(r.used)) ? Math.max(0, Math.floor(Number(r.used))) : lim;
  if (r.allowed) return { serve: true, outcome: "allowed", used, limit: lim };
  if (r.busy === true) return busyDecision(lim, used);
  const resetsAt = typeof r.resets_at === "string" && Number.isFinite(Date.parse(r.resets_at)) ? r.resets_at : nextUtcMidnight(nowMs);
  return {
    serve: false, outcome: "limited", status: 429,
    body: { error: FRANCES_LIMIT_ERROR, message: francesLimitMessage(lim), limit: lim, used, resets_at: resetsAt },
  };
}

/**
 * The proxy's limiter: one per instance (module scope in index.ts), so each kind of failure is
 * logged once per instance, not once per question.
 *   const check = createFrancesLimiter({ log });
 *   const d = await check({ isAdmin, userId, limit, consume: (args) => serviceClient.rpc(FRANCES_LIMIT_RPC, args) });
 *   if (!d.serve) return json(d.body, d.status);
 * `consume` receives { p_user, p_limit } and resolves supabase-js's { data, error }; it may throw.
 */
export function createFrancesLimiter({ log = (m) => console.warn(m), timeoutMs = FRANCES_LIMIT_TIMEOUT_MS, now = () => Date.now() } = {}) {
  const logged = new Set();
  return async function checkFrancesLimit({ isAdmin = false, userId, limit, consume } = {}) {
    if (isAdmin) return francesLimitDecision({ isAdmin: true });
    const lim = francesDailyLimit(limit);
    let result = null, error = null, timer = null;
    try {
      const call = Promise.resolve().then(() => consume({ p_user: userId, p_limit: lim }));
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${timeoutMs} ms`), { francesTimeout: true })), timeoutMs);
      });
      const res = await Promise.race([call, late]);
      if (res && res.error) error = res.error;
      else result = res ? res.data : null;
    } catch (e) {
      error = e || new Error("unknown failure");
    } finally {
      if (timer) clearTimeout(timer);
    }
    const d = francesLimitDecision({ result, error, limit: lim, nowMs: now() });
    if (d.outcome === "fail-open" && !logged.has(d.problem)) {
      logged.add(d.problem);
      try {
        log(`[image-proxy] Frances daily limit not enforced (${d.problem}: ${d.detail}); serving the question.`
          + (d.problem === "missing" ? " Run supabase/frances-daily-limit.sql to turn the limit on." : "")
          + " Logged once per instance.");
      } catch (_e) { /* logging never breaks Frances */ }
    }
    return d;
  };
}

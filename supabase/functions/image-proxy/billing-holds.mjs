/* billing-holds.mjs — HOLD credits before a paid provider call, SETTLE or RELEASE after
   (billing fixes, owner decisions 2026-09-30). Pure and testable in Node
   (scripts/test-server-charging.mjs): index.ts hands in the service-role RPC.

   THE DATABASE CONTRACT (supabase billing-v2.sql, service role only):
     turn_hold_credits(uid uuid, amount int, ref text, reason text) -> jsonb {ok, held, remaining, code?}
         atomic; idempotent per ref; refuses with code 'insufficient' or 'frozen'
     turn_settle_hold(ref text, actual int) -> jsonb      keeps min(actual, held), releases the rest
     turn_release_hold(ref text) -> jsonb                 full refund; a no-op once settled/released
   A hold that is never settled or released stays SPENT: nothing here relies on a hold expiring
   in the user's favour (a client that drops a video job's token only loses its refund).

   USE (one hold per paid request):
     const h = await holds.take({ amount, kind: "image", reason });
     if (!h.ok) return refusal(h);            // h.code: insufficient | frozen | unavailable
     try { …provider… ; await h.settle(actual); return ok; }
     finally { await h.releaseUnlessDone(); } // any path that did not settle refunds in full
   A settle that errors is NOT followed by a release: the result was delivered, so the hold
   (already deducted) stands as the charge.

   VIDEO is asynchronous (submit, then polls). The hold is taken at submit and must be settled on
   the poll that sees the render complete — possibly in a later session, after a reload.
   REPAIR F1 (2026-09-30): the hold is found ON THE SERVER by the provider's job id, never by
   anything the client carries. Right after fal accepts a job, the proxy ATTACHES fal's request
   id to the hold (turn_hold_attach → turn_credit_holds.provider_ref, unique); every poll LOOKS
   the hold up by the request id in its status URL (turn_hold_lookup) and checks it belongs to
   the caller. It settles before a video is returned, and releases only when fal's own status
   says the job failed or was cancelled (a result that can't be fetched keeps the hold). A
   request id with no hold row is a job submitted before this deploy or by an admin (no hold) —
   every later submit has one, so that path can't be used for free renders.
   The signed token (HMAC with a server secret, binding the hold ref, the account, the fal
   request id and an expiry) still rides the job's status / response URLs and `holdToken`; it no
   longer finds or releases anything — it only carries the SETTLE FACTS of a render billed by
   video length (repair F2: rate, held seconds, the input lengths read at submit), which can only
   LOWER the charge from the whole hold; without a valid token the hold is the charge.
   ROUND 2 (2026-09-30):
     * REQUEST IDS ARE CANONICAL (canonicalRequestId: lowercase; 32 hex digits get the
       8-4-4-4-12 dashes) at attach, at every lookup and in every URL the proxy fetches — an
       upper-case or dash-less spelling of a job's id finds the same hold, never "no hold".
     * THE HOLD'S REASON CARRIES WHAT A SERVER-SIDE CHECK NEEDS (videoHoldReason): the fal
       endpoint (its queue app path is recovered from it: falQueueBase) and the settle facts of a
       render billed by video length — so the housekeeping reconciliation (video-reconcile.mjs)
       can settle or release a job nobody polled, exactly as the poll would. The poll prefers
       these server-written facts to the token's.
     * A poll whose request id has NO hold row is served read-only to a non-admin only during
       the drain window (legacyPollAllowed: 48 hours after the server_video_billing marker —
       jobs submitted before the deploy); after it, and for another account's hold, the answer
       is "not found". Admins (who take no holds) keep the read-only path. */

export const HOLD_RPC = "turn_hold_credits";
export const SETTLE_RPC = "turn_settle_hold";
export const RELEASE_RPC = "turn_release_hold";
export const ATTACH_RPC = "turn_hold_attach";
export const LOOKUP_RPC = "turn_hold_lookup";
export const VIDEO_HOLD_PARAM = "kinolot_hold";
/* How long a video job may wait in fal's queue before the next poll asks fal to cancel it (its
   hold is released only when fal confirms the job never started). */
export const VIDEO_HOLD_TTL_MS = 6 * 60 * 60 * 1000;

function asObject(data, name) {
  let r = data;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (_e) { return null; } }
  if (Array.isArray(r)) r = r.length === 1 ? r[0] : null;
  if (r && typeof r === "object" && r[name] && typeof r[name] === "object") r = r[name];
  return r && typeof r === "object" ? r : null;
}
const int = (x) => (Number.isFinite(Number(x)) ? Math.floor(Number(x)) : null);

/**
 * Build the hold client for one request.
 *   rpc(name, args) -> Promise<{ data, error }>   (the service-role supabase-js client's .rpc)
 *   uid                                           the signed-in user
 *   log(message)                                  server-side log (never shown to users)
 *   newId()                                       unique id source (crypto.randomUUID)
 */
/*   film   (Team, 2026-10-03) a call on someone else's film that its OWNER pays (film-payer.mjs):
            { actor, memberId, projectId, kind? } — `uid` is then the owner, and the hold goes through
            turn_hold_credits_for_film (the collaborator's monthly budget, checked under the
            owner's account lock). A refusal for the budget reads code "budget_reached".
            (Team review, 2026-10-09) `kind` rides as p_kind (named), so the database re-checks the
            switch, the role and the owner's plan under the lock; a database whose function has no
            p_kind yet (PGRST202) is asked once more without it. A film hold's refusal keeps the
            database's own code (paused, role, owner_plan, not_member, budget_reached, frozen,
            insufficient — film-payer.mjs filmHoldRefusal words them), and a taken hold carries the
            budget and the month's spend (this hold included) when the database sends them. */
export const FILM_HOLD_RPC = "turn_hold_credits_for_film";
export function createHoldClient({ rpc, uid, film = null, log = () => {}, newId = () => crypto.randomUUID() } = {}) {
  const call = async (name, args) => {
    try {
      const res = await rpc(name, args);
      if (res && res.error) return { error: res.error };
      return { data: asObject(res ? res.data : null, name) };
    } catch (e) {
      return { error: e || new Error("rpc failed") };
    }
  };
  const safeLog = (m) => { try { log(m); } catch (_e) { /* logging never breaks billing */ } };

  function handle(ref, amount, held, remaining) {
    const h = {
      ok: true, ref, amount, held, remaining, done: false, charged: null,
      /** Keep min(actual, held); marks the hold done whatever the database answers. */
      async settle(actual) {
        if (h.done) return { ok: true, charged: h.charged, remaining: h.remaining };
        h.done = true;
        const want = Math.max(0, Math.ceil(Number(actual) || 0));
        if (want > h.held) safeLog(`[billing] settle ${ref}: actual ${want} credits exceeded the hold of ${h.held}; charging the hold.`);
        const r = await call(SETTLE_RPC, { ref, actual: want });
        if (r.error || !r.data) {
          safeLog(`[billing] settle ${ref} failed (${String((r.error && (r.error.message || r.error)) || "no answer").slice(0, 200)}); the hold stands as the charge.`);
          h.charged = h.held;
          return { ok: false, charged: h.held, remaining: h.remaining };
        }
        const d = r.data;
        h.charged = int(d.charged ?? d.kept ?? d.settled ?? d.amount) ?? Math.min(want, h.held);
        const rem = int(d.remaining);
        if (rem != null) h.remaining = rem;
        return { ok: d.ok !== false, charged: h.charged, remaining: h.remaining, code: d.code || "" };
      },
      /** Full refund (idempotent). */
      async release() {
        if (h.done) return { ok: true };
        h.done = true;
        const r = await call(RELEASE_RPC, { ref });
        if (r.error) safeLog(`[billing] release ${ref} failed (${String(r.error.message || r.error).slice(0, 200)}).`);
        const rem = int(r.data && r.data.remaining);
        if (rem != null) h.remaining = rem;
        return { ok: !r.error };
      },
      /** For finally blocks: refund unless the request settled (or handed the hold to a job). */
      async releaseUnlessDone() { if (!h.done && !h.kept) await h.release(); },
      /** Hand the hold to an asynchronous job (video): no release on the way out. */
      keep() { h.kept = true; },
    };
    return h;
  }

  return {
    /**
     * Take a hold of `amount` credits. { ok:true, ref, held, remaining, settle, release, … } or
     * { ok:false, code: "insufficient" | "frozen" | "unavailable", remaining? }.
     */
    async take({ amount, kind = "gen", reason = "", ref: givenRef } = {}) {
      const want = Math.max(1, Math.ceil(Number(amount) || 0));
      const ref = givenRef || `${kind}:${newId()}`;
      const why = String(reason || kind).slice(0, 200);
      let r;
      if (film) {
        const args = { p_owner: uid, p_actor: film.actor, p_member: film.memberId, p_project: film.projectId, amount: want, ref, reason: why };
        r = film.kind ? await call(FILM_HOLD_RPC, { ...args, p_kind: film.kind }) : await call(FILM_HOLD_RPC, args);
        if (film.kind && r.error && /PGRST202/i.test(String((r.error.code || "") + " " + (r.error.message || "")))) r = await call(FILM_HOLD_RPC, args);
      } else {
        r = await call(HOLD_RPC, { uid, amount: want, ref, reason: why });
      }
      if (r.error || !r.data) {
        safeLog(`[billing] hold failed (${String((r.error && (r.error.message || r.error)) || "no answer").slice(0, 200)}).`
          + (/does not exist|could not find the function|PGRST202|42883/i.test(String((r.error && (r.error.message || r.error.code)) || "")) ? " Run supabase billing-v2.sql before deploying this proxy." : ""));
        return { ok: false, code: "unavailable" };
      }
      const d = r.data;
      if (d.ok === false || d.ok === "false") {
        const code = String(d.code || "insufficient").toLowerCase();
        if (code === "budget_reached") return { ok: false, code, budget: int(d.budget), spent: int(d.spent), remaining: int(d.remaining) };
        if (film && /^(paused|off|role|owner_plan|not_member|no_film)$/.test(code)) return { ok: false, code, remaining: null };
        return { ok: false, code: code === "frozen" ? "frozen" : code === "insufficient" ? "insufficient" : "unavailable", remaining: int(d.remaining) };
      }
      const held = int(d.held) ?? want;
      const h = handle(ref, want, held, int(d.remaining));
      if (film && "budget" in d) { h.budget = d.budget == null ? null : int(d.budget); h.spent = int(d.spent); }
      return h;
    },
    /** Settle / release a hold known only by its ref (found by turn_hold_lookup). */
    byRef(ref, held = 0) { return handle(ref, held, held, null); },
    /**
     * Attach the provider's job id to a hold, right after the provider accepted the job.
     * { ok: true } (also for the same id again) or { ok: false, code: "mismatch" | "unknown" | "unavailable" }.
     */
    async attach(ref, providerRef) {
      const r = await call(ATTACH_RPC, { ref, provider_ref: String(providerRef || "") });
      if (r.error || !r.data) {
        safeLog(`[billing] attach ${ref} failed (${String((r.error && (r.error.message || r.error)) || "no answer").slice(0, 200)}).`);
        return { ok: false, code: "unavailable" };
      }
      if (r.data.ok === false || r.data.ok === "false") return { ok: false, code: String(r.data.code || "mismatch") };
      return { ok: true };
    },
    /**
     * The hold a provider job id belongs to: { ok: true, found: false } | { ok: true, found: true,
     * ref, owner, held, status, kept, createdAtMs, reason } | { ok: false } (the lookup failed).
     */
    async lookup(providerRef) {
      const r = await call(LOOKUP_RPC, { provider_ref: String(providerRef || "") });
      if (r.error || !r.data) {
        safeLog(`[billing] lookup failed (${String((r.error && (r.error.message || r.error)) || "no answer").slice(0, 200)}).`);
        return { ok: false };
      }
      const d = r.data;
      if (!(d.found === true || d.found === "true")) return { ok: true, found: false };
      const t = Date.parse(String(d.created_at || ""));
      return { ok: true, found: true, ref: String(d.ref || ""), owner: String(d.owner || ""), held: int(d.held) ?? 0,
        status: String(d.status || ""), kept: int(d.kept), createdAtMs: Number.isFinite(t) ? t : null, reason: String(d.reason || "") };
    },
  };
}

/* ─────────────── the signed video-hold token ─────────────── */

const enc = new TextEncoder();
function b64url(bytes) {
  let s = "";
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode("kinolot-video-hold-v1|" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** Sign { ref, uid, rid (fal request id), held, exp, u (USD per credit when held), s? (settle
    facts of a length-billed render) } into a URL-safe token. */
export async function signVideoHold(secret, claims) {
  if (!secret) throw new Error("no signing secret");
  const body = b64url(enc.encode(JSON.stringify({ v: 1, ref: claims.ref, uid: claims.uid, rid: claims.rid, held: claims.held, exp: claims.exp,
    ...(Number(claims.u) > 0 ? { u: Number(claims.u) } : {}),
    ...(claims.s && typeof claims.s === "object" ? { s: claims.s } : {}) })));
  return body + "." + b64url(await hmac(secret, body));
}

/**
 * What to settle a video job's hold at when it completes: the whole hold, in TODAY's unit. A job
 * held before the switch day and finished after it had its open hold multiplied by 3 by
 * billing-switch.sql, so the credits it keeps scale by the change of unit (heldUnit / nowUnit);
 * with either unit unknown, the hold as taken.
 */
export function videoSettleAmount(held, heldUnit, nowUnit) {
  const h = Math.max(0, Math.floor(Number(held) || 0));
  const a = Number(heldUnit), b = Number(nowUnit);
  if (!(a > 0) || !(b > 0) || Math.abs(a - b) < 1e-12) return h;
  return Math.max(0, Math.round(h * (a / b)));
}

/** The token's claims when its signature is good, else null (expiry is the caller's decision). */
export async function verifyVideoHold(secret, token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!secret || !body || !sig || body.length > 2048) return null;
    if (!sameBytes(unb64url(sig), await hmac(secret, body))) return null;
    const c = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!c || c.v !== 1 || typeof c.ref !== "string" || typeof c.uid !== "string" || typeof c.rid !== "string") return null;
    return { ref: c.ref, uid: c.uid, rid: c.rid, held: Math.max(0, Number(c.held) || 0), exp: Number(c.exp) || 0, u: Number(c.u) > 0 ? Number(c.u) : null,
      ...(c.s && typeof c.s === "object" ? { s: c.s } : {}) };
  } catch (_e) {
    return null;
  }
}

/** A fal queue URL with the token appended (unchanged when there is no token). */
export function withHoldParam(url, token) {
  if (!token) return url;
  try { const u = new URL(url); u.searchParams.set(VIDEO_HOLD_PARAM, token); return u.toString(); } catch (_e) { return url; }
}
/** { url (the token removed), token } */
export function takeHoldParam(url) {
  try {
    const u = new URL(url);
    const token = u.searchParams.get(VIDEO_HOLD_PARAM) || "";
    u.searchParams.delete(VIDEO_HOLD_PARAM);
    return { url: u.toString(), token };
  } catch (_e) {
    return { url, token: "" };
  }
}
/**
 * A fal QUEUE status URL taken apart: { base, rid } for exactly
 * https://queue.fal.run/<base>/requests/<rid>/status (query ignored), else null. `base` is the
 * app path fal puts in its queue URLs (it can be shorter than the model endpoint:
 * fal-ai/kling-video for fal-ai/kling-video/v3/standard/image-to-video).
 */
export function falStatusParts(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:" || u.hostname !== "queue.fal.run" || u.username || u.password || u.port) return null;
    const m = /^\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)\/requests\/([A-Za-z0-9_-]{1,128})\/status\/?$/.exec(u.pathname);
    return m ? { base: m[1], rid: m[2] } : null;
  } catch (_e) {
    return null;
  }
}
/** The response URL the SERVER builds for a job (never the client's): …/requests/<rid>. */
export function falResponseUrl(parts) {
  return `https://queue.fal.run/${parts.base}/requests/${parts.rid}`;
}
/** True when fal's queue base path belongs to `endpoint` (equal to it, or a leading part of it). */
export function falBaseMatches(base, endpoint) {
  const b = String(base || ""), e = String(endpoint || "");
  return !!b && (e === b || e.startsWith(b + "/"));
}

/** The fal request id in a queue status / response URL (…/requests/<id>[/status]). */
export function falRequestId(url) {
  try {
    const m = /\/requests\/([A-Za-z0-9_-]{1,128})(?:\/status|\/cancel)?\/?$/.exec(new URL(url).pathname);
    return m ? m[1] : "";
  } catch (_e) {
    return "";
  }
}

/* ─────────────── round 2: canonical ids, the hold's reason, the drain window ─────────────── */

/**
 * A fal request id in its ONE canonical spelling: trimmed, lowercase, and a dash-less UUID
 * (32 hex digits) given its 8-4-4-4-12 dashes. "" for anything that isn't a plausible id.
 */
export function canonicalRequestId(id) {
  const s = String(id ?? "").trim().toLowerCase();
  const t = /^[0-9a-f]{32}$/.test(s) ? `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` : s;
  return /^[a-z0-9_-]{1,128}$/.test(t) ? t : "";
}

/**
 * Is this request id spelled as fal spells its ids — a UUID, 8-4-4-4-12 or 32 hex digits (any
 * case)? ROUND 3 (S8): a poll whose id has NO hold row is served (read-only, in the drain window)
 * only when it is; any other spelling is refused (400), so a variant spelling of a held job's id
 * (dashes moved, say, which a lenient UUID parser upstream might still accept) can never miss the
 * hold lookup and be served before it is settled. An id that HAS a hold row is exactly the id fal
 * gave at submit, whatever its form.
 */
export function isUuidRequestId(id) {
  const s = String(id ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^[0-9a-f]{32}$/i.test(s);
}

/* How long after the server_video_billing marker a poll with NO hold row is still served to a
   non-admin: jobs submitted to the previous proxy (which took no holds) finish and are collected
   in this window. */
export const VIDEO_DRAIN_WINDOW_MS = 48 * 60 * 60 * 1000;
/**
 * May a non-admin's poll with NO hold row be served (read-only)? `markerAt` is the
 * server_video_billing marker's time (turn_billing_state.at): undefined/null = no marker yet (the
 * drain window hasn't started: allowed), a readable time = allowed only within the window,
 * anything unreadable = null (the caller answers "try again").
 */
export function legacyPollAllowed(markerAt, nowMs = Date.now()) {
  if (markerAt === undefined || markerAt === null) return true;
  const at = markerAt instanceof Date ? markerAt.getTime() : Date.parse(String(markerAt));
  if (!Number.isFinite(at)) return null;
  return nowMs - at <= VIDEO_DRAIN_WINDOW_MS;
}

/* The fal queue app path ("owner/app") of an endpoint: fal's status / result / cancel URLs use it
   (…/fal-ai/kling-video/requests/<id> for fal-ai/kling-video/v3/standard/image-to-video). */
export function falQueueBase(endpoint) {
  const parts = String(endpoint || "").split("/").filter(Boolean);
  if (parts.length < 2 || !parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p))) return "";
  return parts[0] + "/" + parts[1];
}
/* Holds taken before the reason carried the endpoint name only the Stage's model id. */
const APP_MODEL_QUEUE_BASE = Object.freeze({
  "seedance-2.0": "bytedance/seedance-2.0", "seedance-2.5": "bytedance/seedance-2.5",
  "kling-3.0": "fal-ai/kling-video", "kling-3.0-motion-control": "fal-ai/kling-video",
});

const REASON_MAX = 200;
/**
 * The reason a video hold is taken with:
 *   video:<appModel>:<resolution> m=<fal endpoint>[ k=u] s=<settle facts JSON>
 * `k=u` marks a job run on a caller-supplied provider key (the server can't ask about it);
 * `s=` rides only on a render billed by video length. Kept under the 200-character limit.
 */
export function videoHoldReason({ appModel, resolution, endpoint, userKey = false, facts = null }) {
  let r = `video:${appModel}:${resolution}`;
  if (endpoint) r += ` m=${endpoint}`;
  if (userKey) r += " k=u";
  if (facts && typeof facts === "object") {
    const f = {};
    for (const [k, v] of Object.entries(facts)) {
      if (v == null) continue;
      f[k] = k === "rate" ? Math.ceil(Number(v) * 1e6 - 1e-3) / 1e6 : v;   // 6 decimals, rounded UP (float noise ignored)
    }
    r += ` s=${JSON.stringify(f)}`;
  }
  return r.length <= REASON_MAX ? r : r.slice(0, REASON_MAX);
}
/**
 * A video hold's reason taken apart: { appModel, resolution, endpoint, base, userKey, facts }.
 * A reason from before round 2 ("video:kling-3.0:720p") still gives the queue base (from the
 * model id) and no facts (the hold is the charge).
 */
export function parseVideoHoldReason(reason) {
  const text = String(reason || "");
  const m = /^video:([a-z0-9.-]+):([a-z0-9]+)(?: m=([A-Za-z0-9._/-]+))?( k=u)?(?: s=(\{.*\}))?$/.exec(text);
  if (!m) return null;
  let facts = null;
  if (m[5]) { try { const f = JSON.parse(m[5]); facts = f && typeof f === "object" ? f : null; } catch (_e) { facts = null; } }
  const endpoint = m[3] || "";
  return { appModel: m[1], resolution: m[2], endpoint, base: endpoint ? falQueueBase(endpoint) : (APP_MODEL_QUEUE_BASE[m[1]] || ""),
    userKey: !!m[4], facts };
}

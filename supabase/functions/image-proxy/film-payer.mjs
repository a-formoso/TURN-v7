/* film-payer.mjs — WHO PAYS for a call made on someone else's film (Team relaunch, owner
   2026-10-03; docs/Dashboard Plan.md §6). Pure and testable in Node (scripts/test-film-payer.mjs):
   index.ts and blender-bridge hand in the service-role RPC.

   THE RULE: work on a film is paid by the film's OWNER, within each collaborator's monthly budget,
   and the OWNER's plan decides what can run (engines, resolution, video, takes). A collaborator's
   own credits are never touched on someone else's film.
   THE SERVER DECIDES: the browser only names the film (`context.projectId`, request-context.mjs).
   supabase/team-relaunch.sql turn_film_payer() checks — as the database, with the service role —
   that the caller is an active, linked member of that film whose role fits this kind of call, that
   the owner's plan carries that role, and that the budget isn't used up.
   (Team review, 2026-10-09; owner decisions B and C) What it can't confirm is REFUSED in plain words,
   never quietly billed to the collaborator:
     a role that doesn't cover the call      → film_role (403)
     sharing switched off (a linked member)  → team_paused (403): collaborators are read-only
     the check failing or answering nonsense → film_unverified (503)
   (Stage editor review, 2026-10-09; owner decision E) a caller who names a real film they aren't on
   (neither its owner nor an active, linked member: 'not_member') is REFUSED too — film_access (403) —
   never billed to themselves. Only a film id that names no film ('no_film', or no film id at all) is
   billed to the caller as before, and so is everyone while turn_film_payer isn't installed (a
   function-not-found error: PostgREST PGRST202 / Postgres 42883).
   KINDS (what each role may charge to the owner; Stage editor review, 2026-10-09): text — every
   writing role (every room drafts); image — Art director; voice (text-to-speech, listing voices) —
   Art director, Stage editor; voice_design (designing, saving or cloning a character voice) — Art
   director; video — Stage editor; 3d — Art director (Blender Studio only: image-proxy has no 3D
   route). A database from before voice_design (it refuses an unknown kind as 'role') is asked once
   more with 'voice' — only when it refused an Art director, so a Stage editor never gets voice
   design through the older kind (resolveFilmPayer).
   THE TAKE (Stage editor review, 2026-10-09; owner decision D): a render the owner pays is paid
   even if the person is removed, sharing pauses or the owner downgrades while it runs, and the
   take must land in the film. At submit the proxy writes the app's take on the hold row
   (turn_credit_holds.take = {clipId, meta}: writeHoldTake); when the hold settles (the poll, or
   the housekeeping reconciliation) it adds {url, settledAt} (recordTakeUrl), so the owner can
   collect it whoever polls.
   The hold is then taken from the owner's balance by turn_hold_credits_for_film(), which re-checks
   the member, the switch, the role, the plan and the budget under the owner's account lock
   (billing-holds.mjs `film`; its refusals map through filmHoldRefusal below).
   Every refusal here names no address and no balance of the owner's. */

import { FILM_HOLD_RPC } from "./billing-holds.mjs";
export { FILM_HOLD_RPC };
export const FILM_PAYER_RPC = "turn_film_payer";
export const HOLD_ACTOR_RPC = "turn_hold_actor";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString("en-US");

/** The kind of call for the payer check, or "" when it is never film work (Frances, handshakes).
    Routing fields that aren't strings are never film work (Team review, 2026-10-09: index.ts refuses
    them with a 400 first — an array `task` used to be checked as writing here and then fall through
    every route test to the image route). "3d" only for Blender Studio (`{ allow3d: true }`). */
const VOICE_DESIGN_OPS = new Set(["design", "saveVoice", "clone"]);
export function filmCallKind(task, body = {}, { allow3d = false } = {}) {
  if (task != null && typeof task !== "string") return "";
  const b = body && typeof body === "object" ? body : {};
  const str = (v, dflt) => (v == null ? dflt : typeof v === "string" ? v : null);
  const t = task || "image";
  if (t === "text") {
    const kind = str(b.usageKind, "");
    return kind === null ? "" : kind.toLowerCase() === "muse" ? "" : "text";
  }
  if (t === "image") return "image";
  if (t === "voice") {   // the New Story interview (speech-to-text) is the caller's own
    const op = str(b.op, "tts");
    if (op === null || op === "stt") return "";
    // (Stage editor review, 2026-10-09) the character voice tools are the Art director's
    return VOICE_DESIGN_OPS.has(op) ? "voice_design" : "voice";
  }
  if (t === "video") {   // submit holds; stage-upload checks the Stage plan; polls bill nothing new
    const op = str(b.op, "submit");
    return op === "submit" || op === "stage-upload" ? "video" : "";
  }
  if (t === "3d") return allow3d ? "3d" : "";
  return "";
}

/* the refusals a collaborator may hear (the shapes app/plans.jsx turnBillingError() reads) */
export function ownerPlanPaused() {
  return { status: 402, body: { error: "owner_plan", code: "owner_plan",
    message: "The film's owner's plan doesn't include shared work right now, so generating on this film is paused." } };
}
/* (Stage editor review, 2026-10-09) one call bigger than what's left of the budget is told so —
   "You've used…" only when the budget really is used up. `needed`: the credits this call needs
   (null when unknown). Figures are the collaborator's budget only, never the owner's. */
export function budgetReached(budget, spent, needed = null) {
  const b = int(budget) ?? 0, s = int(spent) ?? 0, n = int(needed);
  if (n != null && n > 0 && s < b) {
    return { status: 402, body: { error: "budget_reached", code: "budget_reached", budget: b, spent: s, needed: n,
      message: `This needs about ${fmt(n)} credits, and your budget on this film has ${fmt(b - s)} left this month. The film's owner can raise it.` } };
  }
  return { status: 402, body: { error: "budget_reached", code: "budget_reached", budget: b, spent: s, ...(n != null && n > 0 ? { needed: n } : {}),
    message: `You've used this month's credit budget on this film (${fmt(s)} of ${fmt(b)}). The film's owner can raise it.` } };
}
export function ownerShortOfCredits() {
  return { status: 402, body: { error: "owner_insufficient", code: "owner_insufficient",
    message: "The film's owner doesn't have enough credits for this right now." } };
}
/* (Team review, 2026-10-09) */
export function filmRole() {
  return { status: 403, body: { error: "film_role", code: "film_role", message: "Your role on this film doesn't include this." } };
}
export function filmUnverified() {
  return { status: 503, body: { error: "film_unverified", code: "film_unverified",
    message: "Couldn't confirm who pays for work on this film. Try again in a moment." } };
}
/* (Stage editor review, 2026-10-09; owner decision E) a real film the caller isn't on */
export function filmAccess() {
  return { status: 403, body: { error: "film_access", code: "film_access",
    message: "You're not on this film's team right now, so work on it can't be charged to it." } };
}
export function teamPaused() {
  return { status: 403, body: { error: "team_paused", code: "team_paused",
    message: "Sharing is paused on this film right now, so it's read-only for collaborators." } };
}

/** A database error that means the function isn't there (before its SQL is installed). */
export function missingFunction(e) {
  if (!e) return false;
  const code = String((typeof e === "object" && e.code) || "");
  if (code === "PGRST202" || code === "42883") return true;
  return /PGRST202|42883|could not find the function|function .* does not exist/i.test(String((typeof e === "object" ? e.message : e) || ""));
}

/** The refusal for a turn_film_payer / turn_hold_credits_for_film code that stops the call, or null. */
export function filmCodeRefusal(code, d = {}) {
  switch (String(code || "").toLowerCase()) {
    case "owner_plan": return ownerPlanPaused();
    case "budget_reached": return budgetReached(int(d.budget) ?? 0, int(d.spent) ?? 0, int(d.needed));
    case "paused": case "off": return teamPaused();   // 'off': the pre-review SQL's word for the same switch
    case "role": return filmRole();
    case "not_member": return filmAccess();            // (Stage editor review, 2026-10-09) never billed to the caller
    default: return null;
  }
}
/** What a refused OWNER-PAID hold tells the collaborator (billing-holds.mjs `film` take() codes):
    the owner's frozen account reads as the owner's plan (never "your account is on hold"); a
    membership gone between the check and the hold ('not_member') as film_access (Stage editor
    review, 2026-10-09); anything else unexpected ('mismatch', 'no_film') as "couldn't confirm". */
export function filmHoldRefusal(h = {}) {
  const code = String((h && h.code) || "").toLowerCase();
  const r = filmCodeRefusal(code, h);
  if (r) return r;
  if (code === "frozen") return ownerPlanPaused();
  if (code === "insufficient") return ownerShortOfCredits();
  return filmUnverified();
}

function asObject(data) {
  let r = data;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (_e) { return null; } }
  if (Array.isArray(r)) r = r.length === 1 ? r[0] : null;
  if (r && typeof r === "object" && r[FILM_PAYER_RPC] && typeof r[FILM_PAYER_RPC] === "object") r = r[FILM_PAYER_RPC];
  return r && typeof r === "object" ? r : null;
}
const int = (x) => (x == null || x === "" ? null : (Number.isFinite(Number(x)) ? Math.floor(Number(x)) : null));

/**
 * { mode: "caller", reason }                         bill the caller: no such film, no film named,
 *                                                     or turn_film_payer not installed
 * { mode: "own" }                                     the caller owns the film
 * { mode: "owner", payer, actor, memberId, projectId, role, budget, spent, tier, kind }
 *                                                     `kind`: the kind the database confirmed — the
 *                                                     hold names the same one (p_kind)
 * { mode: "refuse", refusal }                         owner_plan, budget_reached, team_paused,
 *                                                     film_role, film_access or film_unverified
 */
export async function resolveFilmPayer({ rpc, actor, context, kind, log = () => {} } = {}) {
  const projectId = String((context && context.projectId) || "");
  if (!kind || !actor || !UUID_RE.test(projectId)) return { mode: "caller", reason: "no_film" };
  const first = await askFilmPayer({ rpc, actor, projectId, kind, log });
  // (Stage editor review, 2026-10-09) a database from before 'voice_design' knows no such kind and
  // refuses it as 'role' — even for an Art director, whose role always covers it. Only then is it
  // asked again with 'voice' (what that database used for every voice call). A Stage editor refused
  // voice design is never retried, so the older kind can't let them through on the newer database.
  if (kind === "voice_design" && first.mode === "refuse" && first.code === "role" && first.role === "art_director") {
    safeLogOf(log)("[billing] turn_film_payer doesn't know 'voice_design' yet; asked with 'voice'. Run supabase/team-relaunch.sql.");
    return strip(await askFilmPayer({ rpc, actor, projectId, kind: "voice", log }));
  }
  return strip(first);
}
const safeLogOf = (log) => (m) => { try { log(m); } catch (_e) { /* never breaks */ } };
const strip = (r) => { if (r && r.mode === "refuse") { delete r.code; delete r.role; } return r; };
async function askFilmPayer({ rpc, actor, projectId, kind, log }) {
  const safeLog = safeLogOf(log);
  let res;
  try { res = await rpc(FILM_PAYER_RPC, { p_actor: actor, p_project: projectId, p_kind: kind }); }
  catch (e) { res = { error: e }; }
  if (!res || res.error) {
    const err = res && res.error;
    if (missingFunction(err)) {   // before team-relaunch.sql: there is no shared billing to confirm
      safeLog("[billing] turn_film_payer isn't installed; billing the caller. Run supabase/team-relaunch.sql.");
      return { mode: "caller", reason: "not_installed" };
    }
    safeLog(`[billing] film payer check failed (${String((err && (err.message || err)) || "no answer").slice(0, 200)}); refused (film_unverified).`);
    return { mode: "refuse", refusal: filmUnverified() };
  }
  const d = asObject(res.data);
  if (!d) return { mode: "refuse", refusal: filmUnverified() };
  if (d.ok === true || d.ok === "true") {
    if (d.own === true || d.own === "true") return { mode: "own" };
    if (!UUID_RE.test(String(d.payer || "")) || !UUID_RE.test(String(d.member_id || ""))) return { mode: "refuse", refusal: filmUnverified() };
    return { mode: "owner", payer: String(d.payer), actor, memberId: String(d.member_id), projectId,
      role: String(d.role || ""), budget: int(d.budget), spent: int(d.spent) ?? 0, tier: String(d.tier || ""), kind };
  }
  const code = String(d.code || "");
  const refusal = filmCodeRefusal(code, d);
  if (refusal) return { mode: "refuse", refusal, code, role: String(d.role || "") };
  if (code === "no_film") return { mode: "caller", reason: code };
  return { mode: "refuse", refusal: filmUnverified() };
}

/** The owner's account row for billing-policy accountFrom(), read with the service role.
    { row, ok, isAdmin }: (Team review, 2026-10-09) a film owned by the admin account (which
    turn_team_owner_tier counts as Producer) is gated as the admin's — every room, no plan needed —
    and may have no credits row (ok, row null); its collaborators' holds still come from that
    account's balance. `getUser(id)` → the auth user (supabase auth.admin.getUserById). */
export async function loadOwnerAccountRow(from, owner, { getUser = null, adminEmails = [] } = {}) {
  let isAdmin = false;
  if (getUser && adminEmails.length) {
    try {
      const u = await getUser(owner);
      const user = u && u.data ? u.data.user : u;
      isAdmin = !!user && adminEmails.includes(String(user.email || "").toLowerCase());
    } catch (_e) { isAdmin = false; }
  }
  try {
    const { data, error } = await from("turn_credits")
      .select("plan, remaining, plan_remaining, payment_status, frozen")
      .eq("owner", owner).limit(1);
    if (error) return { row: null, ok: isAdmin, isAdmin };
    const row = Array.isArray(data) ? data[0] : data;
    return { row: row || null, ok: !!row || isAdmin, isAdmin };
  } catch (_e) {
    return { row: null, ok: isAdmin, isAdmin };
  }
}

/** Usage-row metadata for a call the owner paid (who paid; the row's own owner is who clicked). */
export function filmPaidMetadata(film) {
  return film && film.mode === "owner" ? { paidBy: film.payer, memberId: film.memberId, filmRole: film.role } : {};
}

/**
 * Who paid for a hold, from its row (service role; team-relaunch.sql's actor / member_id /
 * project_id columns) and the member's role: { ok: true, found, owner, actor, memberId, projectId,
 * role, memberProjectId } | { ok: false } (a read failed). A video poll by the collaborator who
 * started an owner-paid render records it with these (filmPaidMetadataFromHold). The member row
 * is read whatever its status: a person removed while the render ran still collects it (owner
 * decision D). memberProjectId (Stage editor review, 2026-10-09): the film the member row is on —
 * the Show, for a Show-wide member working on an Episode — so the poll can read their budget there.
 */
export async function loadHoldPayer(from, ref) {
  try {
    const { data, error } = await from("turn_credit_holds").select("owner, actor, member_id, project_id").eq("ref", String(ref || "")).limit(1);
    if (error) return { ok: false };
    const h = Array.isArray(data) ? data[0] : data;
    if (!h) return { ok: true, found: false };
    let role = "", memberProjectId = "";
    if (h.member_id) {
      const m = await from("turn_project_members").select("role, project_id").eq("id", h.member_id).limit(1);
      const mr = !m.error ? (Array.isArray(m.data) ? m.data[0] : m.data) : null;
      role = mr && mr.role ? String(mr.role) : "";
      memberProjectId = mr && mr.project_id ? String(mr.project_id) : "";
    }
    return { ok: true, found: true, owner: String(h.owner || ""), actor: String(h.actor || ""), memberId: h.member_id ? String(h.member_id) : "",
      projectId: h.project_id ? String(h.project_id) : "", role, memberProjectId };
  } catch (_e) {
    return { ok: false };
  }
}
export function filmPaidMetadataFromHold(h) {
  return h && h.found && h.memberId ? { paidBy: h.owner, memberId: h.memberId, filmRole: h.role } : {};
}

/**
 * The `usage` a collaborator is sent on a call the OWNER paid (Team review, 2026-10-09): never the
 * owner's balance or plan — `remaining`, `plan` and the balance parts are dropped — and, when known,
 * `budget: { limit, spent }` (limit null = no limit; spent includes this call), from which the app
 * shows its 80% notice.
 */
export function collaboratorUsage(usage, budget) {
  const u = { ...(usage && typeof usage === "object" ? usage : {}) };
  for (const k of ["remaining", "plan", "planRemaining", "packRemaining", "plan_remaining", "pack_remaining"]) delete u[k];
  if (budget && typeof budget === "object") {
    const limit = int(budget.limit), spent = int(budget.spent);
    u.budget = { limit: limit == null ? null : Math.max(0, limit), spent: Math.max(0, spent ?? 0) };
  }
  return u;
}

/**
 * The collaborator's budget on the film after a video poll (Stage editor review, 2026-10-09):
 * { limit, spent } from turn_team_spend (the caller's own client: their own row only), or null when
 * it can't be read (a person removed meanwhile has no active row: nothing is sent, and never the
 * owner's balance). Asked for the hold's film first and then for the film the member row is on (a
 * Show-wide member's row lives on the Show while the hold names the Episode) — so it works whether
 * or not the database's turn_team_spend already looks across a Show's family.
 */
export async function pollBudget(rpc, paidHold) {
  if (!paidHold || !paidHold.memberId) return null;
  const films = [...new Set([paidHold.projectId, paidHold.memberProjectId].filter((x) => UUID_RE.test(String(x || ""))))];
  for (const pid of films) {
    try {
      const r = await rpc("turn_team_spend", { pid });
      const row = r && !r.error && Array.isArray(r.data) ? r.data.find((x) => x && String(x.member_id) === paidHold.memberId) : null;
      if (row) return { limit: row.budget ?? null, spent: Number(row.spent) || 0 };
    } catch (_e) { /* the next film, or nothing */ }
  }
  return null;
}

/* ─────────────── the take an owner-paid render lands in (owner decision D) ─────────────── */

/* Postgres: undefined column — the database before team-relaunch.sql added turn_credit_holds.take */
const missingColumn = (e) => !!e && (String(e.code || "") === "42703" || /column .*take.* does not exist|could not find the 'take' column/i.test(String(e.message || e)));

/**
 * At a video SUBMIT the owner pays: write the app's take on the hold row (service role), so the
 * render lands in the film even if the person who started it is removed, sharing pauses or the
 * owner's plan changes before it finishes. `take` = requestTake(body.context) (request-context.mjs):
 * { clipId, meta? }. Never throws; a failure is logged and the submit goes on. → true when written.
 */
export async function writeHoldTake(from, ref, take, { log = () => {} } = {}) {
  if (!ref || !take || typeof take.clipId !== "string") return false;
  const safeLog = safeLogOf(log);
  try {
    const { error } = await from("turn_credit_holds").update({ take }).eq("ref", String(ref));
    if (error) {
      if (!missingColumn(error)) safeLog(`[billing] take ${ref}: couldn't be written (${String(error.message || error).slice(0, 160)}).`);
      return false;
    }
    return true;
  } catch (e) {
    safeLog(`[billing] take ${ref}: couldn't be written (${String((e && e.message) || e).slice(0, 160)}).`);
    return false;
  }
}

/**
 * When a video hold SETTLES (the poll or the housekeeping reconciliation): add the render's output
 * to the hold's take — { ...take, url, settledAt } — when the hold carries one with a clipId (only
 * owner-paid renders do). A take that already has this url is left as it is (a later poll of a
 * settled render only fills a url an earlier write missed). Service role; never throws; a failure
 * is logged and never breaks the settle. → true when the take holds the url afterwards.
 */
export async function recordTakeUrl(from, ref, url, { now = () => new Date(), log = () => {} } = {}) {
  const u = String(url || "");
  if (!ref || !/^https:\/\//i.test(u)) return false;
  const safeLog = safeLogOf(log);
  try {
    const got = await from("turn_credit_holds").select("take").eq("ref", String(ref)).limit(1);
    if (got.error) {
      if (!missingColumn(got.error)) safeLog(`[billing] take ${ref}: couldn't be read (${String(got.error.message || got.error).slice(0, 160)}).`);
      return false;
    }
    const row = Array.isArray(got.data) ? got.data[0] : got.data;
    let take = row ? row.take : null;
    if (typeof take === "string") { try { take = JSON.parse(take); } catch (_e) { take = null; } }
    if (!take || typeof take !== "object" || Array.isArray(take) || typeof take.clipId !== "string" || !take.clipId) return false;
    if (take.url === u) return true;
    const merged = { ...take, url: u, settledAt: new Date(now()).toISOString() };
    const { error } = await from("turn_credit_holds").update({ take: merged }).eq("ref", String(ref));
    if (error) { safeLog(`[billing] take ${ref}: the render's url couldn't be recorded (${String(error.message || error).slice(0, 160)}).`); return false; }
    return true;
  } catch (e) {
    safeLog(`[billing] take ${ref}: the render's url couldn't be recorded (${String((e && e.message) || e).slice(0, 160)}).`);
    return false;
  }
}

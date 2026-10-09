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
   Only a caller who isn't a member at all (or names no real film) is billed as before — their own
   spend; the film id was only attribution — and so is everyone while turn_film_payer isn't installed
   (a function-not-found error: PostgREST PGRST202 / Postgres 42883).
   KINDS (what each role may charge to the owner): text — every writing role (every room drafts);
   image and voice — Art director, Stage editor; video — Stage editor; 3d — Art director (Blender
   Studio only: image-proxy has no 3D route).
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
  if (t === "voice") {   // the New Story interview is the caller's own
    const op = str(b.op, "tts");
    return op === null || op === "stt" ? "" : "voice";
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
export function budgetReached(budget, spent) {
  return { status: 402, body: { error: "budget_reached", code: "budget_reached", budget, spent,
    message: `You've used this month's credit budget on this film (${fmt(spent)} of ${fmt(budget)}). The film's owner can raise it.` } };
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
    case "budget_reached": return budgetReached(int(d.budget) ?? 0, int(d.spent) ?? 0);
    case "paused": case "off": return teamPaused();   // 'off': the pre-review SQL's word for the same switch
    case "role": return filmRole();
    default: return null;
  }
}
/** What a refused OWNER-PAID hold tells the collaborator (billing-holds.mjs `film` take() codes):
    the owner's frozen account reads as the owner's plan (never "your account is on hold"), a
    membership gone between the check and the hold as "couldn't confirm" (a retry is then billed by
    the fresh check). */
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
 * { mode: "caller", reason }                         bill the caller: not a member, no such film, no
 *                                                     film named, or turn_film_payer not installed
 * { mode: "own" }                                     the caller owns the film
 * { mode: "owner", payer, actor, memberId, projectId, role, budget, spent, tier }
 * { mode: "refuse", refusal }                         owner_plan, budget_reached, team_paused,
 *                                                     film_role or film_unverified
 */
export async function resolveFilmPayer({ rpc, actor, context, kind, log = () => {} } = {}) {
  const projectId = String((context && context.projectId) || "");
  if (!kind || !actor || !UUID_RE.test(projectId)) return { mode: "caller", reason: "no_film" };
  const safeLog = (m) => { try { log(m); } catch (_e) { /* never breaks */ } };
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
      role: String(d.role || ""), budget: int(d.budget), spent: int(d.spent) ?? 0, tier: String(d.tier || "") };
  }
  const code = String(d.code || "");
  const refusal = filmCodeRefusal(code, d);
  if (refusal) return { mode: "refuse", refusal };
  if (code === "not_member" || code === "no_film") return { mode: "caller", reason: code };
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
 * role } | { ok: false } (a read failed). A video poll by the collaborator who started an
 * owner-paid render records it with these (filmPaidMetadataFromHold).
 */
export async function loadHoldPayer(from, ref) {
  try {
    const { data, error } = await from("turn_credit_holds").select("owner, actor, member_id, project_id").eq("ref", String(ref || "")).limit(1);
    if (error) return { ok: false };
    const h = Array.isArray(data) ? data[0] : data;
    if (!h) return { ok: true, found: false };
    let role = "";
    if (h.member_id) {
      const m = await from("turn_project_members").select("role").eq("id", h.member_id).limit(1);
      const mr = !m.error ? (Array.isArray(m.data) ? m.data[0] : m.data) : null;
      role = mr && mr.role ? String(mr.role) : "";
    }
    return { ok: true, found: true, owner: String(h.owner || ""), actor: String(h.actor || ""), memberId: h.member_id ? String(h.member_id) : "",
      projectId: h.project_id ? String(h.project_id) : "", role };
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

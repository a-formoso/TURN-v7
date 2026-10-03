/* film-payer.mjs — WHO PAYS for a call made on someone else's film (Team relaunch, owner
   2026-10-03; docs/Dashboard Plan.md §6). Pure and testable in Node (scripts/test-film-payer.mjs):
   index.ts and blender-bridge hand in the service-role RPC.

   THE RULE: work on a film is paid by the film's OWNER, within each collaborator's monthly budget,
   and the OWNER's plan decides what can run (engines, resolution, video, takes). A collaborator's
   own credits are never touched on someone else's film.
   THE SERVER DECIDES: the browser only names the film (`context.projectId`, request-context.mjs).
   supabase/team-relaunch.sql turn_film_payer() checks — as the database, with the service role —
   that the caller is an active, linked member of that film whose role fits this kind of call, that
   the owner's plan carries that role, and that the budget isn't used up. Anything it can't confirm
   (no film named, not a member, a role that doesn't fit, sharing switched off, the check failing)
   is billed to the CALLER, exactly as before — never to the owner.
   KINDS (what each role may charge to the owner): text — every writing role (every room drafts);
   image and voice — Art director, Stage editor; video — Stage editor; 3d — Art director.
   The hold is then taken from the owner's balance by turn_hold_credits_for_film(), which re-checks
   the budget under the owner's account lock (billing-holds.mjs `film`). */

export const FILM_PAYER_RPC = "turn_film_payer";
export const FILM_HOLD_RPC = "turn_hold_credits_for_film";
export const HOLD_ACTOR_RPC = "turn_hold_actor";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString("en-US");

/** The kind of call for the payer check, or "" when it is never film work (Frances, handshakes). */
export function filmCallKind(task, body = {}) {
  const t = String(task || "image");
  if (t === "text") return String(body.usageKind || "").toLowerCase() === "muse" ? "" : "text";
  if (t === "image") return "image";
  if (t === "voice") return String(body.op || "tts") === "stt" ? "" : "voice";   // the New Story interview is the caller's own
  if (t === "video") {   // submit holds; stage-upload checks the Stage plan; polls bill nothing new
    const op = String(body.op || "submit");
    return op === "submit" || op === "stage-upload" ? "video" : "";
  }
  if (t === "3d") return "3d";
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

function asObject(data) {
  let r = data;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (_e) { return null; } }
  if (Array.isArray(r)) r = r.length === 1 ? r[0] : null;
  if (r && typeof r === "object" && r[FILM_PAYER_RPC] && typeof r[FILM_PAYER_RPC] === "object") r = r[FILM_PAYER_RPC];
  return r && typeof r === "object" ? r : null;
}
const int = (x) => (x == null || x === "" ? null : (Number.isFinite(Number(x)) ? Math.floor(Number(x)) : null));

/**
 * { mode: "caller", reason }                         bill the caller (today's behaviour)
 * { mode: "own" }                                     the caller owns the film
 * { mode: "owner", payer, actor, memberId, projectId, role, budget, spent, tier }
 * { mode: "refuse", refusal }                         the owner's plan lapsed, or the budget is used up
 */
export async function resolveFilmPayer({ rpc, actor, context, kind, log = () => {} } = {}) {
  const projectId = String((context && context.projectId) || "");
  if (!kind || !actor || !UUID_RE.test(projectId)) return { mode: "caller", reason: "no_film" };
  let res;
  try { res = await rpc(FILM_PAYER_RPC, { p_actor: actor, p_project: projectId, p_kind: kind }); }
  catch (e) { res = { error: e }; }
  if (!res || res.error) {
    try { log(`[billing] film payer check failed (${String((res && res.error && (res.error.message || res.error)) || "no answer").slice(0, 200)}); billing the caller.`); } catch (_e) { /* never breaks */ }
    return { mode: "caller", reason: "unavailable" };
  }
  const d = asObject(res.data);
  if (!d) return { mode: "caller", reason: "unavailable" };
  if (d.ok === true || d.ok === "true") {
    if (d.own === true || d.own === "true") return { mode: "own" };
    if (!UUID_RE.test(String(d.payer || "")) || !UUID_RE.test(String(d.member_id || ""))) return { mode: "caller", reason: "unavailable" };
    return { mode: "owner", payer: String(d.payer), actor, memberId: String(d.member_id), projectId,
      role: String(d.role || ""), budget: int(d.budget), spent: int(d.spent) ?? 0, tier: String(d.tier || "") };
  }
  const code = String(d.code || "");
  if (code === "owner_plan") return { mode: "refuse", refusal: ownerPlanPaused() };
  if (code === "budget_reached") return { mode: "refuse", refusal: budgetReached(int(d.budget) ?? 0, int(d.spent) ?? 0) };
  return { mode: "caller", reason: code || "unknown" };
}

/** The owner's account row for billing-policy accountFrom(), read with the service role. */
export async function loadOwnerAccountRow(from, owner) {
  try {
    const { data, error } = await from("turn_credits")
      .select("plan, remaining, plan_remaining, payment_status, frozen")
      .eq("owner", owner).limit(1);
    if (error) return { row: null, ok: false };
    const row = Array.isArray(data) ? data[0] : data;
    return { row: row || null, ok: true };
  } catch (_e) {
    return { row: null, ok: false };
  }
}

/** Usage-row metadata for a call the owner paid (who paid; the row's own owner is who clicked). */
export function filmPaidMetadata(film) {
  return film && film.mode === "owner" ? { paidBy: film.payer, memberId: film.memberId, filmRole: film.role } : {};
}

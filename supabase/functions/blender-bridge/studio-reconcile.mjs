/* studio-reconcile.mjs — settle or release Blender Studio holds ON THE SERVER, for jobs nobody
   came back to (billing fixes, round 2, 2026-09-30). Pure and testable in Node
   (scripts/test-server-charging.mjs): the database RPC and the provider status call are handed in.

   A Studio job's hold is `studio:<event id>` (supabase-adapter.mjs authorizeCredit). Its
   provider_ref (turn_hold_attach) says what the server can check without the job's sealed relay
   state:
     a mesh job      fal's request id (attached right after the submit): fal's queue answers
                     COMPLETED and its RESULT holds a GLB on a trusted fal host → settle at the
                     held price (the mesh's price is the hold); COMPLETED without one (round 3,
                     S3: the launcher's own flow refunds that case — studio-service.mjs
                     resolveMesh, which picks its file with the same meshOutputFile below),
                     FAILED / ERROR / CANCELLED, a completed job with an error, or "request not
                     found" → release; queued / running / a transient error → leave;
     an assistant    `studio-answer:<event id>:<credits>` (attached once the provider has
       answer        ANSWERED and the proposal is saved as settlement_pending — studio-service.mjs):
                     the provider was paid, so it is settled at the reported cost (never above the
                     hold). The user's own later settle finds it settled and completes the task.
   Everything else is left (the database's last-resort rule settles a hold still open after 30
   days at the held amount).

   THE CONTRACT (supabase billing-v2.sql, service role only): turn_claim_housekeeping(job,
   every_seconds) → boolean; turn_open_provider_holds(older_than_minutes, max_rows[, ref_prefix]) →
   table(ref, owner, provider_ref, held, reason, created_at). POST {"op":"reconcile_holds"} to
   blender-bridge (no auth: pg_cron + pg_net, supabase/billing-housekeeping-cron.sql). Throttled
   (one run per RECONCILE_EVERY_SECONDS), at most RECONCILE_MAX_HOLDS holds and about a minute per
   run, idempotent, and it answers counts only: {ok:true, checked, settled, released, left}. */

export const RECONCILE_OP = "reconcile_holds";
export const RECONCILE_JOB = "blender-bridge_reconcile";
export const RECONCILE_EVERY_SECONDS = 240;
export const RECONCILE_MAX_HOLDS = 50;
export const RECONCILE_OLDER_THAN_MINUTES = 60;
export const RECONCILE_FETCH_ROWS = 200;
export const RECONCILE_BUDGET_MS = 55000;
const CONCURRENCY = 4;

/* A provider asset URL the Studio may download: https on fal's own hosts, no credentials
   (studio-service.mjs uses this same check before it fetches a mesh). */
export function isTrustedFalUrl(value) {
  let u; try { u = new URL(value); } catch (_) { return false; }
  const host = u.hostname.toLowerCase();
  return u.protocol === "https:" && !u.username && !u.password &&
    (host === "fal.run" || host.endsWith(".fal.run") || host === "fal.media" || host.endsWith(".fal.media"));
}
/* The GLB a finished mesh job delivers: the animated file, else (for a rigged job) the rigged
   character, else the plain model — studio-service.mjs resolveMesh picks exactly this. */
export function meshOutputFile(result, rigged = false) {
  const r = result && typeof result === "object" ? result : {};
  return r.animation_glb || (rigged ? r.rigged_character_glb : null) || r.model_glb || null;
}
/**
 * What a COMPLETED mesh job's result means for its hold (round 3, S3): "completed" only when the
 * file the launcher would deliver is on a trusted fal host — whether or not the job was rigged
 * (the reconciliation can't see that, so both readings must deliver) — else "failed", the
 * launcher's own "Provider returned no trusted GLB" refund. A release is never a loss for the
 * user: a launcher that later delivers the mesh re-holds and settles its price (supabase-adapter
 * spendCredit).
 */
export function meshResultState(result) {
  if (!result || typeof result !== "object") return "failed";
  const ok = (f) => !!f && typeof f === "object" && isTrustedFalUrl(f.url);
  return ok(meshOutputFile(result, false)) && ok(meshOutputFile(result, true)) ? "completed" : "failed";
}

/* The provider_ref of an assistant answer the provider has already given (and billed). */
export const ANSWER_REF_PREFIX = "studio-answer:";
export function answerProviderRef(eventId, credits) {
  const e = String(eventId || ""), c = Math.max(0, Math.ceil(Number(credits) || 0));
  return /^[A-Za-z0-9_-]{1,120}$/.test(e) && c > 0 ? `${ANSWER_REF_PREFIX}${e}:${c}` : "";
}
/** { eventId, credits } from an answer's provider_ref, or null. */
export function parseAnswerProviderRef(ref) {
  const m = /^studio-answer:([A-Za-z0-9_-]{1,120}):(\d{1,9})$/.exec(String(ref || ""));
  return m ? { eventId: m[1], credits: Number(m[2]) } : null;
}

function rpcObject(data, name) {
  let r = data;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch (_) { return null; } }
  if (Array.isArray(r)) r = r.length === 1 ? r[0] : null;
  if (r && typeof r === "object" && r[name] && typeof r[name] === "object") r = r[name];
  return r && typeof r === "object" ? r : null;
}
function rpcBoolean(data, name) {
  let d = data;
  if (Array.isArray(d)) d = d.length ? d[0] : null;
  if (d && typeof d === "object" && name in d) d = d[name];
  return d === true || d === "true" || d === "t";
}

/**
 * One pass. → { status, body }.
 *   rpc(name, args) -> Promise<{ data, error }>   the service-role client's .rpc
 *   meshStatus(requestId) -> Promise<{ state }>   "queued" | "running" | "completed" | "failed" |
 *                                                  "not_found" | "unknown" (a transient failure);
 *                                                  "completed" only for a result with a trusted
 *                                                  GLB (meshResultState — blender-bridge index.ts)
 */
export async function reconcileStudioHolds({ rpc, meshStatus = null, now = () => Date.now(), budgetMs = RECONCILE_BUDGET_MS, log = () => {} } = {}) {
  const say = (m) => { try { log(m); } catch (_) { /* logging never breaks billing */ } };
  let claim;
  try { claim = await rpc("turn_claim_housekeeping", { job: RECONCILE_JOB, every_seconds: RECONCILE_EVERY_SECONDS }); }
  catch (e) { claim = { error: e }; }
  if (!claim || claim.error) return { status: 503, body: { ok: false, error: "Billing is unavailable right now." } };
  if (!rpcBoolean(claim.data, "turn_claim_housekeeping")) return { status: 200, body: { ok: true, checked: 0, settled: 0, released: 0, left: 0, throttled: true } };
  let listed;
  // ref_prefix keeps the other function's holds out of this list (billing-v2.sql); a database
  // without that argument yet is asked without it (the rows are filtered here either way)
  const list = (args) => Promise.resolve().then(() => rpc("turn_open_provider_holds", args)).catch((e) => ({ error: e }));
  listed = await list({ older_than_minutes: RECONCILE_OLDER_THAN_MINUTES, max_rows: RECONCILE_FETCH_ROWS, ref_prefix: "studio:" });
  if (listed && listed.error && /PGRST202|42883|could not find the function|does not exist|ref_prefix/i.test(String((listed.error.code || "") + " " + (listed.error.message || listed.error)))) {
    listed = await list({ older_than_minutes: RECONCILE_OLDER_THAN_MINUTES, max_rows: RECONCILE_FETCH_ROWS });
  }
  if (!listed || listed.error) return { status: 503, body: { ok: false, error: "Billing is unavailable right now." } };
  const rows = (Array.isArray(listed.data) ? listed.data : [])
    .filter((r) => r && typeof r.ref === "string" && r.ref.startsWith("studio:") && r.provider_ref)
    .slice(0, RECONCILE_MAX_HOLDS);
  const counts = { checked: 0, settled: 0, released: 0 };
  const started = now();
  const settle = async (row, amount, why) => {
    const res = await rpc("turn_settle_hold", { ref: row.ref, actual: Math.max(0, Math.ceil(Number(amount) || 0)) });
    const d = res && !res.error ? rpcObject(res.data, "turn_settle_hold") : null;
    if (d && d.ok !== false) { counts.settled++; say(`[billing] reconcile ${row.ref}: settled (${why}).`); }
  };
  const release = async (row, why) => {
    const res = await rpc("turn_release_hold", { ref: row.ref });
    if (res && !res.error) { counts.released++; say(`[billing] reconcile ${row.ref}: released (${why}).`); }
  };
  const one = async (row) => {
    const held = Math.max(0, Number(row.held) || 0);
    const answer = parseAnswerProviderRef(row.provider_ref);
    if (answer) {
      counts.checked++;
      return await settle(row, Math.min(held, answer.credits), "the assistant answered; its reported cost");
    }
    if (String(row.provider_ref).startsWith(ANSWER_REF_PREFIX) || typeof meshStatus !== "function") return;
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(String(row.provider_ref))) return;
    counts.checked++;
    let st;
    try { st = await meshStatus(String(row.provider_ref)); } catch (_) { return; }
    const state = String((st && st.state) || "unknown");
    if (state === "completed") return await settle(row, held, "the mesh finished with a trusted GLB");
    if (state === "failed") return await release(row, "the mesh job failed");
    if (state === "not_found") return await release(row, "the provider has no such job");
    // queued / running / unknown: the next run, or the launcher's own poll, decides
  };
  let next = 0;
  const worker = async () => {
    while (next < rows.length && now() - started < budgetMs) {
      const row = rows[next++];
      try { await one(row); } catch (e) { say(`[billing] reconcile ${row.ref}: ${String((e && e.message) || e).slice(0, 160)}; left.`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { status: 200, body: { ok: true, checked: counts.checked, settled: counts.settled, released: counts.released,
    left: rows.length - counts.settled - counts.released } };
}

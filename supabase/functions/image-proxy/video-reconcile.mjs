/* video-reconcile.mjs — settle or release a Stage render's hold ON THE SERVER, for jobs nobody
   polled (billing fixes, round 2, 2026-09-30). Pure and testable in Node
   (scripts/test-server-charging.mjs): the database RPC, fal's key and fetch are handed in.

   WHY: a submitted render's hold carries fal's request id (provider_ref), so the 30-minute
   housekeeping release leaves it alone — the poll settles it when fal says done and releases it
   when fal says failed. A render whose tab was closed, which failed while nobody watched, or
   whose pending record a browser dropped, would otherwise wait for the database's last-resort
   rule (settled at the held amount after 30 days) — the user paying for a video they never got,
   or for the maximum of a render billed by its real length.

   THE CONTRACT (supabase billing-v2.sql, service role only):
     turn_claim_housekeeping(job, every_seconds) -> boolean      atomic throttle (one row per job)
     turn_open_provider_holds(older_than_minutes, max_rows[, ref_prefix])
       -> table(ref, owner, provider_ref, held, reason, created_at)   open holds with a provider
                                                                      job, oldest first ('video:'
                                                                      ones only, with ref_prefix)
   POST {"op":"reconcile_holds"} to image-proxy (no auth: pg_cron + pg_net call it every 10
   minutes, supabase/billing-housekeeping-cron.sql). Idempotent and harmless whoever calls it:
   at most one run per RECONCILE_EVERY_SECONDS, at most RECONCILE_MAX_HOLDS holds and about a
   minute per run, and it answers counts only: {ok:true, checked, settled, released, left}.

   Per open 'video:' hold older than an hour, it asks fal about the job (the queue app path comes
   from the hold's reason: billing-holds.mjs parseVideoHoldReason) and does EXACTLY what a poll
   would:
     COMPLETED (with a video)          settle — the whole hold, or for a render billed by video
                                       length its real cost from fal's own output (finishedVideoCharge,
                                       the poll's own rule; never above the hold)
     FAILED / ERROR / CANCELLED, a     release (full refund)
       completed job with an error,
       or "request not found" (404)
     IN_QUEUE past VIDEO_HOLD_TTL_MS   ask fal to cancel; released only when fal accepts
     still running, a transient error,  leave it (the next run, or the user's poll, decides)
       a completed job whose result
       can't be fetched yet
   A job run on a caller-supplied provider key (reason k=u) can't be asked about with the
   platform's key: it is left to the poll (and the database's last-resort rule).
   ROUND 5 (S3): a render billed by video length may have server-only COPIES of its videos
   (video-snapshots.mjs): they are deleted when its hold settles or is released here, and each run
   that isn't throttled also removes copies older than two days (bounded, best effort). */
import { VIDEO_HOLD_TTL_MS, canonicalRequestId, createHoldClient, parseVideoHoldReason } from "./billing-holds.mjs";
import { lengthBilledFacts, lengthBilledVideoSettle } from "./billing-pricing.mjs";
import { isFalMediaUrl, probeMp4Duration } from "./media-length.mjs";

export const RECONCILE_OP = "reconcile_holds";
export const RECONCILE_JOB = "image-proxy_reconcile";
export const RECONCILE_EVERY_SECONDS = 240;
export const RECONCILE_MAX_HOLDS = 50;
export const RECONCILE_OLDER_THAN_MINUTES = 60;
/* Rows asked for: more than the holds processed, because blender-bridge's 'studio:' holds share
   the list (oldest first) and must not crowd out the video holds. */
export const RECONCILE_FETCH_ROWS = 200;
export const RECONCILE_BUDGET_MS = 55000;
const CONCURRENCY = 4;

/**
 * THE CHARGE OF A FINISHED RENDER — the one rule the poll and the reconciliation share.
 *   held      the hold (today's unit)
 *   facts     the settle facts of a render billed by video length (the hold's reason, or a
 *             signed token's), or null — then the whole hold is the charge
 *   videoUrl  fal's output (its length is read only on the fal.media host)
 *   unit      the live credit unit (null = unknown: the hold stands)
 *   record    (round 4) called — best effort, awaited, never throwing into the settle — when the
 *             output was LONGER than its hold covered: { ref, held, outputSeconds, credits } (credits
 *             = what the output really cost; the charge stays the hold). index.ts stores it for the
 *             owner (turn_grant_failures, reason "length_mismatch").
 * → { amount (≤ held), note (for the usage row) }
 * ROUND 4 (owner decision): Motion Control and editing are now HELD for the source's read length
 * x 1.1 + 1 s (billing-pricing.mjs lengthBilledVideoHold), so an output can outrun its hold — a
 * source the reader misjudged, or a provider that renders longer than its input. The charge is
 * still capped at the hold (it can never be more); the case is logged
 * "[billing] length_mismatch <ref> held=<n> output_s=<s>" and recorded for the owner.
 */
export async function finishedVideoCharge({ held, facts, videoUrl, unit, ref = "", probe = probeMp4Duration, log = () => {}, record = null }) {
  const hold = Math.max(0, Math.floor(Number(held) || 0));
  const f = lengthBilledFacts(facts);
  if (!f) return { amount: hold, note: {} };
  const realSeconds = isFalMediaUrl(videoUrl) ? await probe(videoUrl, { timeoutMs: 8000 }) : null;
  const real = realSeconds != null && unit != null ? lengthBilledVideoSettle(f, realSeconds, unit) : null;
  if (!real) {
    try { log(`[billing] video ${ref}: the render's length couldn't be read; the hold of ${hold} stands as the charge.`); } catch (_e) { /* noop */ }
    return { amount: hold, note: { lengthUnread: true } };
  }
  const outputSeconds = Math.round(realSeconds * 100) / 100;
  const note = { realSeconds: outputSeconds, billedOutputSeconds: real.outputSeconds, billedInputSeconds: real.inputSeconds, providerCostUsd: real.providerCostUsd };
  if (real.credits > hold) {
    // the output ran longer than the hold covered: charged the hold (never more), reported
    note.lengthMismatch = true; note.outputCredits = real.credits;
    try { log(`[billing] length_mismatch ${ref} held=${hold} output_s=${outputSeconds}`); } catch (_e) { /* noop */ }
    if (typeof record === "function") {
      try { await record({ ref, held: hold, outputSeconds, credits: real.credits, kind: f.k }); } catch (_e) { /* recording never breaks a settle */ }
    }
  }
  return { amount: Math.min(hold, real.credits), note };
}

/* an RPC's boolean answer, in any of the shapes PostgREST / supabase-js can give it */
function rpcBoolean(data, name) {
  let d = data;
  if (Array.isArray(d)) d = d.length ? d[0] : null;
  if (d && typeof d === "object" && name in d) d = d[name];
  return d === true || d === "true" || d === "t";
}

/**
 * Run one reconciliation pass. → { status, body } where body is
 * { ok:true, checked, settled, released, left[, throttled] } or { ok:false, error }.
 *   rpc(name, args) -> Promise<{ data, error }>   the service-role client's .rpc
 *   falKey                                        the platform's fal key
 *   unitNow()                                     the live credit unit (length-billed settles)
 *   record(row)                                   (round 4) an output longer than its hold covered,
 *                                                 for the owner: { ref, owner, held, outputSeconds,
 *                                                 credits, requestId, kind }
 *   snapshots                                     (round 5, S3) the video-snapshot store
 *                                                 (video-snapshots.mjs createVideoSnapshots): drop(ref)
 *                                                 after a length-billed hold settles or is released,
 *                                                 sweep() once per run
 */
export async function reconcileVideoHolds({ rpc, falKey, fetchImpl = fetch, unitNow = async () => null, probe = probeMp4Duration,
  now = () => Date.now(), budgetMs = RECONCILE_BUDGET_MS, log = () => {}, record = null, snapshots = null } = {}) {
  const say = (m) => { try { log(m); } catch (_e) { /* logging never breaks billing */ } };
  if (!falKey) return { status: 503, body: { ok: false, error: "The video service isn't configured." } };
  let claim;
  try { claim = await rpc("turn_claim_housekeeping", { job: RECONCILE_JOB, every_seconds: RECONCILE_EVERY_SECONDS }); }
  catch (e) { claim = { error: e }; }
  if (!claim || claim.error) {
    say(`[billing] reconcile: the housekeeping claim failed (${String((claim && claim.error && (claim.error.message || claim.error)) || "no answer").slice(0, 160)}).`);
    return { status: 503, body: { ok: false, error: "Billing is unavailable right now." } };
  }
  if (!rpcBoolean(claim.data, "turn_claim_housekeeping")) return { status: 200, body: { ok: true, checked: 0, settled: 0, released: 0, left: 0, throttled: true } };
  let listed;
  // ref_prefix keeps the other function's holds out of this list (billing-v2.sql); a database
  // without that argument yet is asked without it (the rows are filtered here either way)
  const list = (args) => Promise.resolve().then(() => rpc("turn_open_provider_holds", args)).catch((e) => ({ error: e }));
  listed = await list({ older_than_minutes: RECONCILE_OLDER_THAN_MINUTES, max_rows: RECONCILE_FETCH_ROWS, ref_prefix: "video:" });
  if (listed && listed.error && /PGRST202|42883|could not find the function|does not exist|ref_prefix/i.test(String((listed.error.code || "") + " " + (listed.error.message || listed.error)))) {
    listed = await list({ older_than_minutes: RECONCILE_OLDER_THAN_MINUTES, max_rows: RECONCILE_FETCH_ROWS });
  }
  if (!listed || listed.error) {
    say(`[billing] reconcile: the open-holds list failed (${String((listed && listed.error && (listed.error.message || listed.error)) || "no answer").slice(0, 160)}).`);
    return { status: 503, body: { ok: false, error: "Billing is unavailable right now." } };
  }
  const rows = (Array.isArray(listed.data) ? listed.data : [])
    .filter((r) => r && typeof r.ref === "string" && r.ref.startsWith("video:") && r.provider_ref)
    .slice(0, RECONCILE_MAX_HOLDS);
  const started = now();
  const counts = { checked: 0, settled: 0, released: 0 };
  let unit; let unitRead = false;
  const liveUnit = async () => { if (!unitRead) { unitRead = true; try { unit = await unitNow(); } catch (_e) { unit = null; } } return unit ?? null; };
  const head = { Authorization: "Key " + falKey };
  const timed = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});

  const one = async (row) => {
    const reason = parseVideoHoldReason(row.reason);
    const rid = canonicalRequestId(row.provider_ref);
    if (!reason || !reason.base || !rid) { say(`[billing] reconcile ${row.ref}: its reason names no video job it can check; left.`); return; }
    if (reason.userKey) return;   // run on a caller-supplied key: only the poll can ask about it
    const hold = createHoldClient({ rpc, uid: String(row.owner || ""), log: say }).byRef(row.ref, Math.max(0, Number(row.held) || 0));
    // round 5 (S3): a length-billed render's server-only video copies go with its hold
    const dropCopies = async () => {
      if (!reason.facts || !snapshots || typeof snapshots.drop !== "function") return;
      try { await snapshots.drop(row.ref); } catch (_e) { /* the sweep removes them after two days */ }
    };
    const release = async (why) => {
      const r = await hold.release();
      if (r && r.ok) { counts.released++; say(`[billing] reconcile ${row.ref}: released (${why}).`); await dropCopies(); }
    };
    counts.checked++;
    const jobUrl = `https://queue.fal.run/${reason.base}/requests/${rid}`;
    let sr;
    try { sr = await fetchImpl(jobUrl + "/status", { headers: head, ...timed(10000) }); }
    catch (_e) { return; }   // unreachable / timed out: next run
    if (sr.status === 404) { try { await sr.body?.cancel(); } catch (_e) { /* noop */ } return await release("the video service has no such job"); }
    if (!sr.ok) { try { await sr.body?.cancel(); } catch (_e) { /* noop */ } return; }
    const sd = await sr.json().catch(() => null);
    if (!sd || typeof sd !== "object") return;
    const st = String(sd.status || "");
    const completedWithError = st === "COMPLETED" && typeof sd.error === "string" && !!sd.error;
    if (/^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(st) || completedWithError) return await release(`the job ended ${completedWithError ? "with an error" : st}`);
    if (st !== "COMPLETED") {
      const created = Date.parse(String(row.created_at || ""));
      if (st === "IN_QUEUE" && Number.isFinite(created) && now() - created > VIDEO_HOLD_TTL_MS) {
        try {
          const cr = await fetchImpl(jobUrl + "/cancel", { method: "PUT", headers: head, ...timed(10000) });
          try { await cr.body?.cancel(); } catch (_e) { /* noop */ }
          if (cr.status >= 200 && cr.status < 300) return await release("it waited too long to start and was stopped");
        } catch (_e) { /* left */ }
      }
      return;   // still running
    }
    let rr;
    try { rr = await fetchImpl(jobUrl, { headers: head, ...timed(15000) }); }
    catch (_e) { return; }
    if (!rr.ok) { try { await rr.body?.cancel(); } catch (_e) { /* noop */ } return; }   // finished, result not collectable yet
    const rd = await rr.json().catch(() => null);
    const videoUrl = String((rd && rd.video && rd.video.url) || "");
    if (!videoUrl) return;
    const facts = reason.facts ? lengthBilledFacts(reason.facts) : null;
    const { amount } = await finishedVideoCharge({ held: row.held, facts, videoUrl, unit: facts ? await liveUnit() : null, ref: row.ref, probe, log: say,
      record: typeof record === "function" ? (m) => record({ ...m, owner: String(row.owner || ""), requestId: rid }) : null });
    const s = await hold.settle(amount);
    if (s && s.ok) { counts.settled++; say(`[billing] reconcile ${row.ref}: settled at ${s.charged} of ${row.held} (the render finished; nobody collected it).`); await dropCopies(); }
  };

  let next = 0;
  const worker = async () => {
    while (next < rows.length && now() - started < budgetMs) {
      const row = rows[next++];
      try { await one(row); } catch (e) { say(`[billing] reconcile ${row.ref}: ${String((e && e.message) || e).slice(0, 160)}; left.`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  // round 5 (S3): copies older than two days (bounded, best effort; never fails the run)
  if (snapshots && typeof snapshots.sweep === "function") {
    try { const n = await snapshots.sweep(); if (n) say(`[billing] reconcile: removed ${n} video snapshot${n === 1 ? "" : "s"} older than two days.`); } catch (_e) { /* next run */ }
  }
  return { status: 200, body: { ok: true, checked: counts.checked, settled: counts.settled, released: counts.released,
    left: rows.length - counts.settled - counts.released } };
}

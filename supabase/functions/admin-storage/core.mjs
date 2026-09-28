/* ── Admin Storage page: server core (admin-storage Edge Function) ──────────
   Owner: platform admin (admin@infinitestudioai.com) · built 2026-09-27 from
   the Admin Storage spec (Angle A: an Edge Function over the tested
   turn_admin views from supabase/admin-inventory.sql).

   Pure logic: index.ts injects the adapters, and scripts/test-admin-storage.mjs
   runs this exact file on PGlite. Its only import is ./storage-keys.js, the
   dependency-free storage-key parser (a byte-for-byte copy of
   app/storage-keys.js, made by scripts/build-dist.mjs).
     getUser(token)        live GoTrue record (anon client auth.getUser)
     tx(mode, fn)          one Postgres transaction as `postgres` over
                           SUPABASE_DB_URL; fn gets q(text, params) -> rows
     storageRemove(names)  service-role Storage API remove(), exact names only
     rpc(name, args)       service-role PostgREST call (queue functions only)

   Guarantees (spec §6.1), all enforced here, never by the browser:
   - The browser never names a file: it sends project ids (preview), nothing
     (temp-file review) or a run id (delete / clear-temp). Every path comes
     from the server's own queries.
   - Only DELETED projects, only what turn_admin.files calls safe, narrowed by
     area, status and pathGuard(); rechecked per call and per 200-file batch.
   - Write-ahead audit in turn_admin_ops (supabase/admin-storage.sql): plan,
     then planned -> sending -> removed | failed | already-gone | skipped,
     written before and after every Storage call. One lease per run; counters
     are recomputed from the items, never incremented.
   - Removal is confirmed by absence of the storage.objects row.
   - No transaction is ever held open across a Storage or RPC call.
   - Every statement is a constant in S below; inputs only arrive as $n.

   Clear old temp files (owner request 2026-09-28; manual, from the page, no
   schedule). image-proxy stages media under {account}/stage-tmp/ and never
   reads a staged file again after ~3 hours (2 h accept + 1 h signed URL), but
   its own sweep only runs on device uploads, so data-URL stagings pile up.
   - preview-clear-temp plans a 'clear-old-temp-files' run from the server's
     own query: turn_admin.files area 'stage-temp', status 'service', safe,
     no referencing project, created more than 24 HOURS ago on the DATABASE
     clock, and tempPathGuard() (exactly {account}/stage-tmp/{plain name}).
     The review also applies the per-batch holds below (reservation, queue,
     written in the last 24 h) and records those files 'kept', never planned.
     At most TEMP_MAX_PLAN files per review, oldest first (moreRemain says how
     many more wait for the next review). Same audit tables, same item states.
   - One temp clear at a time, strictly (2026-09-28 review): while another temp
     run is 'running' a review and every other temp run's lease are refused:
     409 run_busy while its lease is live, 409 temp_interrupted once the lease
     has expired (it must be resumed first, so the files it left 'sending' are
     settled by exactly one run). Two leases in the same instant: the unique
     index storage_runs_one_running_temp (23505 -> 409 run_busy). A file that
     is 'sending' in another temp run (a partial run stopped by an error before
     its confirm) is kept by the review and skipped by the batch recheck as
     "held: in an interrupted clear" until that run's resume settles it.
   - clear-temp {runId} runs it through the SAME executor as delete (lease,
     reconcile, write-ahead 'sending', 200-name batches, confirm by absence,
     45 s budget, counters from the items). Its per-batch recheck replaces the
     project checks: tempPathGuard again; still in storage.objects; created_at
     AND updated_at both older than 24 h (an overwritten object is kept); not
     referenced; no upload reservation; not in the cleanup queue; not 'sending'
     in another temp run.
   - Each lease takes only runs of its own action: delete never runs a temp
     run, clear-temp never runs a project delete or a queue drain.
   - Needs the audit check that allows the action and the one-at-a-time index
     (admin-storage.sql re-run, 2026-09-28); until then both actions are 412
     temp_action_missing.
   - overview.temp: files / bytes count every stage-temp file; oldFiles,
     oldBytes, accounts (by account id) and oldest describe only the old files
     in the layout a clear accepts.

   Operator tool: deliberately NOT listed in APP_FEATURES (app/ai.jsx). MUSE
   answers every user, and MUSE Protocol §3 forbids describing how TURN is
   built. (Owner decision, 2026-09-27.)
   Cleanup-queue drain: MANUAL, from the page's "Run cleanup now" button. No
   pg_cron schedule is installed (owner decision, 2026-09-27); the cron-secret
   path below stays inert unless ADMIN_STORAGE_CRON_SECRET is ever set.
   Deleted projects have no tombstone (owner decision, 2026-09-27): the page
   shows them as "Deleted project · <short id>" with their uploaders' emails. */

import "./storage-keys.js";

export const VERSION = "admin-storage@2026-09-28.2";

export const ACTIONS = Object.freeze([
  "status", "overview", "project-files", "preview-delete", "delete", "runs", "drain-queue",
  "preview-clear-temp", "clear-temp",
]);

// The only turn_admin columns this function reads (412 views_drift if one is gone).
export const REQUIRED_COLUMNS = Object.freeze({
  files: ["path", "bytes", "mime", "created_at", "area", "status", "safe_to_delete", "orphan_reason",
    "project_id", "uploader_id", "uploader_email", "asset_folder", "entity_id", "entity_name",
    "referenced_by_project_ids"],
  projects: ["project_id", "owner_email", "title", "kind", "show_title", "episode", "files",
    "total_bytes", "orphan_files", "uploader_emails", "last_upload"],
  users: ["user_id", "email", "plan", "created_at", "last_sign_in_at", "film_count", "file_count",
    "total_bytes"],
  referenced_paths: ["path", "project_id"],
});

const MAX_BODY_BYTES = 16 * 1024;
const BATCH = 200;                 // exact names per Storage request (API cap 1,000)
const BUDGET_MS = 45_000;          // stop STARTING batches after this; client calls again
const ZERO_PROGRESS_STOP = 3;      // consecutive sent-but-nothing-removed batches
const ITEM_CHUNK = 2000;
const MAX_PROJECT_IDS = 50;
const PAGE_FILES = 1000;
const PAGE_ITEMS = 500;
const DRAIN_CLAIM = 100;
const DRAIN_MAX = 500;
const READ_TIMEOUT = "25s";
const WRITE_TIMEOUT = "10s";
const PREVIEW_TIMEOUT = "30s";
const IDLE_TIMEOUT = "30s";
const DELETE_ACTION = "delete-deleted-project-files";
const TEMP_ACTION = "clear-old-temp-files";
export const TEMP_MAX_PLAN = 5000;      // files per temp-file review, oldest first
export const TEMP_CUTOFF_HOURS = 24;    // display only: the SQL says interval '24 hours' (database clock)
const TEMP_OUTSIDE = "outside the temp-file layout";
const TEMP_HELD_OTHER = "held: in an interrupted clear";   // 'sending' in another temp run
const PLAN_AREAS = new Set(["asset", "show-import-copy", "studio-preview"]);
const PLAN_STATUSES = new Set(["orphan: project deleted", "service"]);
const OUTCOMES = ["planned", "kept", "sending", "removed", "already-gone", "skipped", "failed"];
const OUTSIDE = "outside the TURN asset layout";
const LIVE_MSG = "a project in this run exists again; nothing was deleted";
// 2026-09-27 review: a run that already removed files must never read "nothing was deleted"
const liveMsg = (removed) => (removed > 0
  ? `stopped: a project in this run exists again; ${removed} ${removed === 1 ? "file" : "files"} had already been deleted`
  : LIVE_MSG);
const liveText = (removed, further) => (removed > 0
  ? `One of these projects exists again, so deleting stopped. ${removed} ${removed === 1 ? "file" : "files"} had already been deleted. Refresh.`
  : `One of these projects exists again, so nothing ${further ? "further " : ""}was deleted. Refresh.`);
// Storage must answer well inside the 90 s run lease that MARK_SENDING renews
// (index.ts aborts the request at 30 s; this is the adapter-independent guard).
const STORAGE_TIMEOUT_MS = 35_000;

// ── path guard (defense in depth: runs at preview and again per batch) ──────
// Folders are legacy "{uuid}" or readable "{name}--{uuid}" (2026-09-27); only the
// uuid is compared, never the name, so a deleted project needs no stored name.
// segmentIdLoose keeps this guard's case-insensitive legacy match.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = globalThis.TurnStorageKeys;
const folderId = (seg) => (KEYS ? KEYS.segmentIdLoose(seg) : null);
const FOLDERS = new Set(["character", "prop", "location", "shot", "asset", "locunit", "cameo",
  "storyboard", "lookbook", "other", "series-migration"]);
export function pathGuard(path, projectIds /* Set of lowercase uuids */) {
  if (typeof path !== "string" || path.length < 3 || path.length > 1024) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith("/")) return false;
  const seg = path.split("/");
  if (seg.some((s) => s === "" || s === "." || s === "..")) return false;
  if (seg[0] === "_internal" || seg[0] === "blender-studio-internal") return false;
  if (!folderId(seg[0])) return false;
  if (seg[1] === "studio-previews") {
    const pid = seg.length >= 4 ? folderId(seg[2]) : null;
    return !!pid && projectIds.has(pid);
  }
  const pid = folderId(seg[1]);
  if (!pid || !projectIds.has(pid)) return false;
  if (!FOLDERS.has(seg[2])) return false;
  if (seg[2] === "shot" && seg.length === 5 && seg[4] === `blender-preview-${seg[3]}.png`) return false; // relay PNG
  return seg.length >= 5;
}

// §5.4 planned rule: safe per the view AND a deletable area AND status AND the guard.
export function plannedRule(row, idSet) {
  return !!row && row.safe_to_delete === true && PLAN_AREAS.has(row.area)
    && PLAN_STATUSES.has(row.status) && pathGuard(row.path, idSet);
}
function keepDetail(row, idSet) {
  if (row.safe_to_delete === true && PLAN_AREAS.has(row.area) && PLAN_STATUSES.has(row.status)
      && !pathGuard(row.path, idSet)) return OUTSIDE;
  return row.status || "kept";
}

// ── temp-file guard (2026-09-28): image-proxy's staging layout, nothing else ─
// Exactly {account}/stage-tmp/{file}: the account folder parses to an id the
// same way pathGuard reads it (legacy uuid in any case, or readable
// "{label}--{uuid}"), and the file is one plain name (image-proxy's own
// FILE_RE in stage-paths.mjs), never hidden. Runs at review and per batch.
const TEMP_FILE = /^[A-Za-z0-9_.-]+$/;
export function tempPathGuard(path) {
  if (typeof path !== "string" || path.length < 3 || path.length > 1024) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith("/")) return false;
  const seg = path.split("/");
  if (seg.length !== 3) return false;
  if (seg.some((s) => s === "" || s === "." || s === "..")) return false;
  if (seg[0] === "_internal" || seg[0] === "blender-studio-internal") return false;
  if (!folderId(seg[0])) return false;
  if (seg[1] !== "stage-tmp") return false;
  return TEMP_FILE.test(seg[2]) && !seg[2].startsWith(".");
}

// int8 -> Number, timestamptz -> ISO string (postgres.js and PGlite alike).
export function normalize(v) {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = normalize(v[k]);
    return o;
  }
  return v;
}

// ── SQL: every statement the function runs. Constants only; inputs are $n. ──
// Arrays travel as one JSON text parameter, cast $n::text::jsonb, so the same
// text runs on postgres.js and PGlite. Never $n::jsonb or $n::timestamptz: postgres.js
// serialises a parameter by the type the server describes, so a jsonb slot gets
// JSON.stringify() of our JSON string (a jsonb scalar: "cannot extract elements from
// a scalar", production 2026-09-28) and a timestamptz slot gets new Date(x), which
// drops the cursor's microseconds. Through ::text both arrive exactly as sent.
export const S = Object.freeze({
  SET_TIMEOUTS: `select set_config('statement_timeout', $1::text, true) as statement_timeout,
       set_config('idle_in_transaction_session_timeout', $2::text, true) as idle_timeout`,

  // ── status (cheap, no view scans)
  S_ROLE: `select current_user as db_user, r.rolsuper, r.rolbypassrls, current_setting('server_version') as server_version
  from pg_catalog.pg_roles r where r.rolname = current_user`,
  // admin-inventory.sql RESULT row 40's predicate, copied verbatim
  S_SEES_ALL: `select not exists (
  select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace s on s.oid = c.relnamespace
    join pg_catalog.pg_roles me on me.rolname = current_user
   where (s.nspname, c.relname) in (('auth','users'), ('storage','objects'), ('public','turn_projects'),
           ('public','turn_generations'), ('public','turn_cameos'),
           ('public','turn_asset_upload_intents'), ('public','turn_asset_cleanup_queue'),
           ('public','turn_credits'))
     and c.relrowsecurity
     and not (me.rolsuper or me.rolbypassrls
              or (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE') and not c.relforcerowsecurity))
) as sees_all`,
  // Presence is read from pg_catalog, not to_regclass(): to_regclass raises
  // "permission denied for schema" for a role without USAGE, and this check
  // must diagnose such a role instead of failing. The queue / reservations
  // count as installed only with every column this function reads (a
  // half-applied migration turns the drain off instead of failing mid-run);
  // the per-batch delete recheck still reads either table whenever it exists.
  S_SETUP: `with cols as (
  select n.nspname as s, c.relname as t, a.attname::text as col
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where a.attnum > 0 and not a.attisdropped and c.relkind = 'r'
     and ((n.nspname = 'turn_admin_ops' and c.relname in ('storage_runs', 'storage_run_items'))
          or (n.nspname = 'public' and c.relname in ('turn_asset_cleanup_queue', 'turn_asset_upload_intents')))
)
select (select count(*)::int from pg_catalog.pg_views where schemaname = 'turn_admin') as views,
       (select coalesce(json_object_agg(t, cols), '{}'::json) from (
           select table_name::text as t, array_agg(column_name::text order by ordinal_position) as cols
             from information_schema.columns where table_schema = 'turn_admin' group by table_name) x) as columns,
       (exists (select 1 from cols where s = 'turn_admin_ops' and t = 'storage_runs')
        and exists (select 1 from cols where s = 'turn_admin_ops' and t = 'storage_run_items')) as audit,
       exists (select 1 from cols where t = 'turn_asset_cleanup_queue' and col = 'path') as queue_table,
       (select count(*) from cols where t = 'turn_asset_cleanup_queue'
          and col in ('path', 'project_id', 'uploader', 'reason', 'queued_at', 'available_at',
                      'lease_token', 'lease_expires_at', 'attempts', 'last_error')) = 10 as queue,
       exists (select 1 from cols where t = 'turn_asset_upload_intents' and col = 'path') as intents_table,
       (select count(*) from cols where t = 'turn_asset_upload_intents' and col in ('path', 'expires_at')) = 2 as intents,
       (select count(distinct p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('turn_claim_asset_cleanup_batch', 'turn_complete_asset_cleanup')) = 2 as queue_worker,
       -- 2026-09-28: the audit log accepts 'clear-old-temp-files' runs: a CHECK on
       -- storage_runs names it, and no CHECK on its action column leaves it out
       -- (admin-storage.sql's re-run replaces the first version's inline check),
       -- and the unique index that allows one running temp clear at a time exists
       (exists (select 1 from pg_catalog.pg_constraint k
                  join pg_catalog.pg_class c on c.oid = k.conrelid
                  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'turn_admin_ops' and c.relname = 'storage_runs' and k.contype = 'c'
                   and strpos(pg_catalog.pg_get_constraintdef(k.oid), 'clear-old-temp-files') > 0)
        and not exists (select 1 from pg_catalog.pg_constraint k
                  join pg_catalog.pg_class c on c.oid = k.conrelid
                  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'action'
                 where n.nspname = 'turn_admin_ops' and c.relname = 'storage_runs' and k.contype = 'c'
                   and a.attnum = any(k.conkey)
                   and strpos(pg_catalog.pg_get_constraintdef(k.oid), 'clear-old-temp-files') = 0)
        and exists (select 1 from pg_catalog.pg_class i
                  join pg_catalog.pg_namespace n on n.oid = i.relnamespace
                  join pg_catalog.pg_index x on x.indexrelid = i.oid
                 where n.nspname = 'turn_admin_ops' and i.relname = 'storage_runs_one_running_temp'
                   and i.relkind = 'i' and x.indisunique)) as temp_action`,

  // ── overview
  Q1_ACCOUNTS: `select u.user_id, u.email, u.plan, u.created_at, u.last_sign_in_at, u.film_count, u.file_count, u.total_bytes,
       not exists (select 1 from auth.users a where a.id = u.user_id) as deleted_account
  from turn_admin.users u`,
  Q2_PROJECTS: `select p.project_id, tp.owner as owner_id, p.owner_email, p.title, p.kind, p.show_title, p.episode,
       (tp.id is not null) as live, p.files, p.total_bytes, p.orphan_files, p.uploader_emails, p.last_upload
  from turn_admin.projects p
  left join public.turn_projects tp on tp.id = p.project_id`,
  // the saved "Storage map" query (admin-inventory.sql) + project_id as a third key,
  // + the temp-file tallies for overview.temp (2026-09-28: folded into this one
  // scan of turn_admin.files; overview() strips the temp_* columns off each row).
  // "old" is the SQL half of the temp plan rule, word for word as in TEMP_CANDIDATES,
  // narrowed to the layout tempPathGuard() accepts (exactly {account}/stage-tmp/
  // {plain name}; the view already checked the account folder), so a file a clear
  // would always keep is never counted as one to clear (2026-09-28 review).
  Q3_FOLDERS: `select split_part(f.path, '/', 1) as user_folder,
       split_part(f.path, '/', 2) as project_folder,
       f.project_id,
       min(f.uploader_id::text) as uploader_id,
       max(f.uploader_email) as uploader_email,
       count(*)::int as files,
       coalesce(sum(f.bytes), 0)::bigint as bytes,
       count(*) filter (where f.safe_to_delete)::int as safe_files,
       coalesce(sum(f.bytes) filter (where f.safe_to_delete), 0)::bigint as safe_bytes,
       count(*) filter (where f.status = 'orphan: project deleted')::int as orphan_deleted,
       count(*) filter (where f.status = 'queued-for-cleanup')::int as queued,
       count(*) filter (where f.status = 'uploading')::int as uploading,
       count(*) filter (where f.status = 'kept-for-promotion-retry')::int as kept_retry,
       count(*) filter (where f.status = 'service')::int as service,
       count(*) filter (where f.status = 'unreferenced')::int as unreferenced,
       count(*) filter (where f.status not in ('orphan: project deleted','queued-for-cleanup','uploading',
                                               'kept-for-promotion-retry','service','unreferenced'))::int as referenced,
       max(f.created_at) as last_upload,
       case when bool_and(f.safe_to_delete) and bool_and(f.status = 'orphan: project deleted') then 'delete-folder'
            when bool_or(f.safe_to_delete) then 'some' else 'in-use' end as verdict,
       count(*) filter (where f.area = 'stage-temp')::int as temp_files,
       coalesce(sum(f.bytes) filter (where f.area = 'stage-temp'), 0)::bigint as temp_bytes,
       count(*) filter (where f.area = 'stage-temp' and f.status = 'service' and f.safe_to_delete
   and f.created_at < now() - interval '24 hours'
   and f.project_id is null and f.referenced_by_project_ids is null
   and char_length(f.path) <= 1024 and f.path ~ '^[^/]+/stage-tmp/[A-Za-z0-9_-][A-Za-z0-9_.-]*$')::int as temp_old_files,
       coalesce(sum(f.bytes) filter (where f.area = 'stage-temp' and f.status = 'service' and f.safe_to_delete
   and f.created_at < now() - interval '24 hours'
   and f.project_id is null and f.referenced_by_project_ids is null
   and char_length(f.path) <= 1024 and f.path ~ '^[^/]+/stage-tmp/[A-Za-z0-9_-][A-Za-z0-9_.-]*$'), 0)::bigint as temp_old_bytes,
       min(f.created_at) filter (where f.area = 'stage-temp' and f.status = 'service' and f.safe_to_delete
   and f.created_at < now() - interval '24 hours'
   and f.project_id is null and f.referenced_by_project_ids is null
   and char_length(f.path) <= 1024 and f.path ~ '^[^/]+/stage-tmp/[A-Za-z0-9_-][A-Za-z0-9_.-]*$') as temp_old_oldest
  from turn_admin.files f
 group by 1, 2, 3`,
  Q4_QUEUE: `select q.reason, count(*)::int as total,
       count(*) filter (where q.available_at <= now()
                          and (q.lease_expires_at is null or q.lease_expires_at <= now()))::int as ready,
       min(q.available_at) filter (where q.available_at > now()) as next_at,
       min(q.queued_at) as oldest,
       count(*) filter (where coalesce(q.last_error, '') not like 'held:%'
                          and (q.attempts >= 3 or q.last_error is not null))::int as stuck
  from public.turn_asset_cleanup_queue q
 group by q.reason`,
  Q5_STUCK: `select q.path, q.reason, q.project_id, q.attempts, q.last_error, q.queued_at,
       exists (select 1 from public.turn_projects p where p.id = q.project_id) as project_live
  from public.turn_asset_cleanup_queue q
 where coalesce(q.last_error, '') not like 'held:%' and (q.attempts >= 3 or q.last_error is not null)
 order by q.queued_at
 limit 50`,

  // ── project-files: the saved "Film detail" query with a keyset
  PROJECT_FILES: `select f.path, f.bytes, f.mime, f.created_at, f.uploader_email, f.asset_folder, f.entity_id, f.entity_name,
       f.status, f.safe_to_delete, f.orphan_reason, f.referenced_by_project_ids,
       (f.project_id is distinct from $1::uuid) as stored_elsewhere,
       count(*) over () as total_after_cursor
  from turn_admin.files f
 where (f.project_id = $1::uuid
        or f.path in (select r.path from turn_admin.referenced_paths r where r.project_id = $1::uuid))
   and ($2::text is null or f.path > $2::text)
 order by f.path
 limit $3::int`,

  // ── preview-delete
  LIVE_CHECK: `select id from public.turn_projects where id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))`,
  CANDIDATES: `select f.path, f.project_id, f.bytes, f.status, f.area, f.safe_to_delete, f.referenced_by_project_ids
  from turn_admin.files f
 where f.project_id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))`,
  RUN_INSERT: `insert into turn_admin_ops.storage_runs
  (id, action, admin_id, admin_email, project_ids, status, planned_files, planned_bytes, kept_files,
   preview_expires_at, function_version)
values ($1::uuid, 'delete-deleted-project-files', $2::uuid, $3::text,
        array(select value::uuid from jsonb_array_elements_text($4::text::jsonb)),
        'previewed', $5::int, $6::bigint, $7::int, now() + interval '15 minutes', $8::text)
returning preview_expires_at`,
  ITEMS_INSERT: `insert into turn_admin_ops.storage_run_items (run_id, path, project_id, bytes, outcome, detail)
select $1::uuid, x->>'path', (x->>'project_id')::uuid, (x->>'bytes')::bigint, x->>'outcome', x->>'detail'
  from jsonb_array_elements($2::text::jsonb) x`,

  // ── delete
  LEASE: `update turn_admin_ops.storage_runs
   set status = 'running', lease_token = $2::uuid, lease_expires_at = now() + interval '90 seconds',
       started_at = coalesce(started_at, now()), last_error = null
 where id = $1::uuid and action = 'delete-deleted-project-files'
   and status in ('previewed', 'partial', 'running')
   and (lease_expires_at is null or lease_expires_at <= now())
   and (status <> 'previewed' or preview_expires_at > now())
returning *`,
  RUN_GET: `select id, action, status, project_ids, planned_files, planned_bytes, started_at, lease_expires_at,
       (lease_expires_at is not null and lease_expires_at > now()) as lease_live,
       (preview_expires_at <= now()) as preview_expired
  from turn_admin_ops.storage_runs where id = $1::uuid`,
  RUN_EXPIRE: `update turn_admin_ops.storage_runs set status = 'expired'
 where id = $1::uuid and status = 'previewed' and preview_expires_at <= now()`,
  RECONCILE: `update turn_admin_ops.storage_run_items i
   set outcome = case when exists (select 1 from storage.objects o
                                    where o.bucket_id = 'turn-assets' and o.name = i.path)
                      then 'planned' else 'removed' end,
       detail  = 'reconciled after an interrupted step', updated_at = now()
 where i.run_id = $1::uuid and i.outcome = 'sending'`,
  ITEMS_OPEN: `select path, project_id, bytes, outcome
  from turn_admin_ops.storage_run_items
 where run_id = $1::uuid and outcome in ('planned', 'failed')
 order by path`,
  // lease-guarded: a caller that lost the lease writes nothing
  ITEMS_SETTLE: `with ok as (select id from turn_admin_ops.storage_runs where id = $1::uuid and lease_token = $2::uuid)
update turn_admin_ops.storage_run_items i
   set outcome = x.outcome, detail = x.detail, updated_at = now()
  from ok, (select value->>'path' as path, value->>'outcome' as outcome, value->>'detail' as detail
              from jsonb_array_elements($3::text::jsonb)) x
 where i.run_id = ok.id and i.path = x.path and i.outcome in ('planned', 'failed')
returning i.path`,
  RECHECK_REFS: `select distinct path from turn_admin.referenced_paths where path in (select value from jsonb_array_elements_text($1::text::jsonb))`,
  RECHECK_INTENTS: `select path from public.turn_asset_upload_intents where path in (select value from jsonb_array_elements_text($1::text::jsonb))`,
  RECHECK_QUEUE: `select path from public.turn_asset_cleanup_queue where path in (select value from jsonb_array_elements_text($1::text::jsonb))`,
  PRESENT: `select name from storage.objects where bucket_id = 'turn-assets' and name in (select value from jsonb_array_elements_text($1::text::jsonb))`,
  MARK_SENDING: `with ok as (update turn_admin_ops.storage_runs set lease_expires_at = now() + interval '90 seconds'
             where id = $1::uuid and lease_token = $2::uuid returning id)
update turn_admin_ops.storage_run_items i
   set outcome = 'sending', attempts = i.attempts + 1, updated_at = now()
  from ok
 where i.run_id = ok.id and i.path in (select value from jsonb_array_elements_text($3::text::jsonb))
   and i.outcome in ('planned', 'failed')
returning i.path`,
  // lease-guarded too (2026-09-27 review): a call whose lease expired during a
  // slow Storage request must not overwrite the new holder's 'sending' items
  ITEMS_CONFIRM: `with ok as (select id from turn_admin_ops.storage_runs where id = $1::uuid and lease_token = $4::uuid)
update turn_admin_ops.storage_run_items i
   set outcome = case when x.gone then 'removed' else 'failed' end,
       detail  = case when x.gone then null else $3::text end, updated_at = now()
  from ok, (select value->>'path' as path, (value->>'gone')::boolean as gone
              from jsonb_array_elements($2::text::jsonb)) x
 where i.run_id = ok.id and i.path = x.path and i.outcome = 'sending'
returning i.path`,
  ITEM_COUNTS: `select count(*) filter (where outcome = 'removed')::int as removed,
       coalesce(sum(bytes) filter (where outcome = 'removed'), 0)::bigint as removed_bytes,
       count(*) filter (where outcome = 'already-gone')::int as already_gone,
       count(*) filter (where outcome = 'skipped')::int as skipped,
       count(*) filter (where outcome = 'skipped' and detail like 'held:%')::int as held,
       count(*) filter (where outcome = 'skipped' and detail = 'held: upload in progress')::int as held_upload,
       count(*) filter (where outcome = 'failed')::int as failed,
       count(*) filter (where outcome = 'kept')::int as kept,
       count(*) filter (where outcome in ('planned', 'failed', 'sending'))::int as remaining,
       count(*)::int as total,
       coalesce(sum(bytes), 0)::bigint as total_bytes
  from turn_admin_ops.storage_run_items where run_id = $1::uuid`,
  RUN_FINISH: `update turn_admin_ops.storage_runs
   set status = $3::text, lease_token = null, lease_expires_at = null,
       finished_at = case when $3::text = 'done' then now() else null end,
       removed_files = $4::int, removed_bytes = $5::bigint, already_gone = $6::int,
       skipped_files = $7::int, failed_files = $8::int, last_error = $9::text
 where id = $1::uuid and lease_token = $2::uuid
returning id`,
  SKIPPED_BY_DETAIL: `select coalesce(detail, 'skipped') as detail, count(*)::int as n
  from turn_admin_ops.storage_run_items where run_id = $1::uuid and outcome = 'skipped'
 group by 1 order by 1`,
  FAILED_SAMPLE: `select path, detail from turn_admin_ops.storage_run_items
 where run_id = $1::uuid and outcome = 'failed' order by path limit 20`,
  LEFT_IN_PROJECTS: `select f.status, count(*)::int as n from turn_admin.files f
 where f.project_id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))
 group by f.status order by f.status`,

  // ── clear old temp files (2026-09-28)
  // the plan: the SQL half of the rule (tempPathGuard() is the other half),
  // oldest first, capped; total = every old temp file, so moreRemain is exact
  TEMP_CANDIDATES: `select f.path, f.bytes, f.created_at, count(*) over () as total
  from turn_admin.files f
 where f.area = 'stage-temp' and f.status = 'service' and f.safe_to_delete
   and f.created_at < now() - interval '24 hours'
   and f.project_id is null and f.referenced_by_project_ids is null
 order by f.created_at, f.path
 limit $1::int`,
  // another temp clear still 'running' (2026-09-28 review): with a live lease it
  // is working now; with an expired one it was interrupted and holds 'sending'
  // items, so nothing new may start until it is resumed. $1 = the caller's run
  // (the review's new id, or the run a clear-temp call asked for).
  TEMP_BUSY: `select id, started_at, planned_files,
       (lease_expires_at is not null and lease_expires_at > now()) as lease_live
  from turn_admin_ops.storage_runs
 where action = 'clear-old-temp-files' and status = 'running' and id <> $1::uuid
 order by started_at
 limit 1`,
  TEMP_RUN_INSERT: `insert into turn_admin_ops.storage_runs
  (id, action, admin_id, admin_email, project_ids, status, planned_files, planned_bytes, kept_files,
   preview_expires_at, function_version)
values ($1::uuid, 'clear-old-temp-files', $2::uuid, $3::text, '{}',
        'previewed', $4::int, $5::bigint, $6::int, now() + interval '15 minutes', $7::text)
returning preview_expires_at`,
  // LEASE for temp runs only, and only while no OTHER temp run is 'running', live
  // or interrupted (2026-09-28 review: an interrupted run must be resumed first).
  // Two leases racing on different rows are settled by the unique index
  // storage_runs_one_running_temp (admin-storage.sql): the loser gets 23505.
  TEMP_LEASE: `update turn_admin_ops.storage_runs
   set status = 'running', lease_token = $2::uuid, lease_expires_at = now() + interval '90 seconds',
       started_at = coalesce(started_at, now()), last_error = null
 where id = $1::uuid and action = 'clear-old-temp-files'
   and status in ('previewed', 'partial', 'running')
   and (lease_expires_at is null or lease_expires_at <= now())
   and (status <> 'previewed' or preview_expires_at > now())
   and not exists (select 1 from turn_admin_ops.storage_runs o
                    where o.action = 'clear-old-temp-files' and o.id <> $1::uuid
                      and o.status = 'running')
returning *`,
  // per file (review and every batch): still stored; neither created nor
  // overwritten in the last 24 h (database clock; a missing timestamp counts as
  // recent); and not 'sending' in another temp run ($2 = this run), whose resume
  // settles it (2026-09-28 review: never two runs recording one removal)
  TEMP_RECHECK: `with b as (select value as path from jsonb_array_elements_text($1::text::jsonb))
select b.path, (o.name is not null) as present,
       coalesce(o.created_at < now() - interval '24 hours'
                and o.updated_at < now() - interval '24 hours', false) as old,
       exists (select 1 from turn_admin_ops.storage_run_items i
                 join turn_admin_ops.storage_runs r on r.id = i.run_id
                where i.path = b.path and i.outcome = 'sending' and i.run_id <> $2::uuid
                  and r.action = 'clear-old-temp-files') as in_other_run
  from b left join storage.objects o on o.bucket_id = 'turn-assets' and o.name = b.path`,

  // ── runs (History). Keyset pages (created_at, id) so no run falls off the
  // list; $2 false hides reviews that were never run (previewed / expired).
  // created_at::text round-trips the full microseconds for the cursor.
  RUNS_LIST: `select id, action, admin_email, project_ids, status, planned_files, planned_bytes, kept_files,
       removed_files, removed_bytes, already_gone, skipped_files, failed_files, created_at, started_at,
       finished_at, preview_expires_at, lease_expires_at, last_error,
       (status = 'running' and lease_expires_at < now()) as interrupted,
       (status = 'previewed' and preview_expires_at <= now()) as preview_expired,
       created_at::text as cursor_at
  from turn_admin_ops.storage_runs
 where ($2::boolean or status not in ('previewed', 'expired'))
   and ($3::text::timestamptz is null or (created_at, id) < ($3::text::timestamptz, $4::uuid))
 order by created_at desc, id desc
 limit $1::int`,
  RUN_DETAIL: `select id, action, admin_email, project_ids, status, planned_files, planned_bytes, kept_files,
       removed_files, removed_bytes, already_gone, skipped_files, failed_files, created_at, started_at,
       finished_at, preview_expires_at, lease_expires_at, last_error,
       (status = 'running' and lease_expires_at < now()) as interrupted,
       (status = 'previewed' and preview_expires_at <= now()) as preview_expired
  from turn_admin_ops.storage_runs where id = $1::uuid`,
  RUN_OUTCOMES: `select outcome, count(*)::int as n from turn_admin_ops.storage_run_items
 where run_id = $1::uuid group by outcome order by outcome`,
  RUN_ITEMS: `select path, project_id, bytes, outcome, detail, attempts, updated_at
  from turn_admin_ops.storage_run_items
 where run_id = $1::uuid and outcome = $2::text and ($3::text is null or path > $3::text)
 order by path
 limit $4::int`,

  // ── drain-queue (P3)
  // settle what a crashed drain left mid-flight, before taking it over
  DRAIN_RECONCILE_STALE: `update turn_admin_ops.storage_run_items i
   set outcome = case when exists (select 1 from storage.objects o
                                    where o.bucket_id = 'turn-assets' and o.name = i.path)
                      then 'failed' else 'removed' end,
       detail  = case when exists (select 1 from storage.objects o
                                    where o.bucket_id = 'turn-assets' and o.name = i.path)
                      then 'interrupted before confirmation; still in the cleanup queue'
                      else 'reconciled after an interrupted step' end,
       updated_at = now()
 where i.outcome = 'sending'
   and i.run_id in (select r.id from turn_admin_ops.storage_runs r
                     where r.action = 'drain-cleanup-queue' and r.status = 'running' and r.lease_expires_at <= now())`,
  DRAIN_TAKEOVER: `update turn_admin_ops.storage_runs r
   set status = 'partial', lease_token = null, lease_expires_at = null, finished_at = now(),
       last_error = 'interrupted (lease expired)',
       removed_files = (select count(*) from turn_admin_ops.storage_run_items i where i.run_id = r.id and i.outcome = 'removed'),
       removed_bytes = (select coalesce(sum(i.bytes), 0) from turn_admin_ops.storage_run_items i where i.run_id = r.id and i.outcome = 'removed'),
       already_gone  = (select count(*) from turn_admin_ops.storage_run_items i where i.run_id = r.id and i.outcome = 'already-gone'),
       skipped_files = (select count(*) from turn_admin_ops.storage_run_items i where i.run_id = r.id and i.outcome = 'skipped'),
       failed_files  = (select count(*) from turn_admin_ops.storage_run_items i where i.run_id = r.id and i.outcome = 'failed')
 where r.action = 'drain-cleanup-queue' and r.status = 'running' and r.lease_expires_at <= now()`,
  DRAIN_INSERT: `insert into turn_admin_ops.storage_runs
  (id, action, admin_id, admin_email, project_ids, status, preview_expires_at, started_at,
   lease_token, lease_expires_at, function_version)
values ($1::uuid, 'drain-cleanup-queue', $2::uuid, $3::text, '{}', 'running', now(), now(),
        $4::uuid, now() + interval '10 minutes', $5::text)`,
  // the spec's recheck, plus: still queued under OUR lease, a live upload
  // reservation, the 24 h grace test on the database clock, and the size
  DRAIN_RECHECK: `with b as (select value as path from jsonb_array_elements_text($1::text::jsonb))
select b.path, q.reason, q.queued_at, q.project_id, q.lease_token,
       (q.path is not null) as queued,
       coalesce(q.queued_at > now() - interval '24 hours', false) as within_grace,
       exists (select 1 from public.turn_projects p where p.id = q.project_id) as project_live,
       exists (select 1 from public.turn_asset_upload_intents i where i.path = b.path and i.expires_at > now()) as reserved,
       exists (select 1 from storage.objects o where o.bucket_id = 'turn-assets' and o.name = b.path) as present,
       (select case when o.metadata ->> 'size' ~ '^[0-9]{1,18}$' then (o.metadata ->> 'size')::bigint end
          from storage.objects o where o.bucket_id = 'turn-assets' and o.name = b.path) as bytes
  from b left join public.turn_asset_cleanup_queue q on q.path = b.path`,
  DRAIN_ITEMS_WRITE: `with ok as (update turn_admin_ops.storage_runs set lease_expires_at = now() + interval '10 minutes'
             where id = $1::uuid and lease_token = $2::uuid returning id)
insert into turn_admin_ops.storage_run_items (run_id, path, project_id, bytes, outcome, detail, attempts)
select ok.id, x->>'path', (x->>'project_id')::uuid, (x->>'bytes')::bigint, x->>'outcome', x->>'detail',
       case when x->>'outcome' = 'sending' then 1 else 0 end
  from ok cross join jsonb_array_elements($3::text::jsonb) x
on conflict (run_id, path) do update
   set outcome = excluded.outcome, detail = excluded.detail, bytes = excluded.bytes,
       attempts = turn_admin_ops.storage_run_items.attempts + excluded.attempts, updated_at = now()
returning path`,
  // a drain that stops early settles its own unconfirmed items (by absence)
  DRAIN_SETTLE_SENDING: `update turn_admin_ops.storage_run_items i
   set outcome = case when exists (select 1 from storage.objects o
                                    where o.bucket_id = 'turn-assets' and o.name = i.path)
                      then 'failed' else 'removed' end,
       detail  = case when exists (select 1 from storage.objects o
                                    where o.bucket_id = 'turn-assets' and o.name = i.path)
                      then 'drain stopped before confirming; still in the cleanup queue'
                      else 'reconciled after an interrupted step' end,
       updated_at = now()
 where i.run_id = $1::uuid and i.outcome = 'sending'`,
  DRAIN_FINISH: `update turn_admin_ops.storage_runs
   set status = $3::text, lease_token = null, lease_expires_at = null, finished_at = now(),
       planned_files = $4::int, planned_bytes = $5::bigint, kept_files = $6::int,
       removed_files = $7::int, removed_bytes = $8::bigint, already_gone = $9::int,
       skipped_files = $10::int, failed_files = $11::int, last_error = $12::text
 where id = $1::uuid and lease_token = $2::uuid
returning id`,
  QUEUE_COUNT: `select count(*)::int as n from public.turn_asset_cleanup_queue`,
});

// ── errors ───────────────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}
const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };
const MESSAGES = {
  sign_in: "Sign in again to use this page.",
  admin_only: "This page is only for the platform admin account.",
  views_missing: "Run supabase/admin-inventory.sql in the SQL Editor, then Refresh.",
  views_drift: "The turn_admin views changed. Re-run supabase/admin-inventory.sql in the SQL Editor, then Refresh.",
  audit_missing: "Deleting is off until supabase/admin-storage.sql is run in the SQL Editor.",
  not_full_reader: "The function's database role can't see every row, so deleting is off (check SUPABASE_DB_URL / ADMIN_STORAGE_DB_URL).",
  queue_missing: "The cleanup queue is not fully installed (series-production.sql), so it cannot be drained.",
  temp_action_missing: "Clearing temp files is off until supabase/admin-storage.sql is run again in the SQL Editor.",
  temp_interrupted: "An earlier clear of old temp files was interrupted. Resume it in History first.",
  db_unreachable: "The database couldn't be reached from the function.",
  internal: "Something went wrong on the server. Nothing further was deleted; History shows what happened.",
};
// Another temp clear is 'running' (TEMP_BUSY row): working now -> run_busy;
// interrupted (lease expired) -> temp_interrupted, resume it first. Both 409.
function tempBusyFail(busy, liveMessage) {
  const extra = { startedAt: busy.started_at || null, runId: busy.id || null, plannedFiles: Number(busy.planned_files) || 0 };
  if (busy.lease_live === true) fail(409, "run_busy", liveMessage, extra);
  fail(409, "temp_interrupted", MESSAGES.temp_interrupted, extra);
}
const UNREACHABLE = new Set(["db_unreachable", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT",
  "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "CONNECT_TIMEOUT", "CONNECTION_CLOSED",
  "CONNECTION_ENDED", "CONNECTION_DESTROYED", "57P01", "57P03", "53300"]);
export function isUnreachable(e) {
  const c = String((e && e.code) || "");
  return UNREACHABLE.has(c) || /^08/.test(c);
}
const errText = (e) => String((e && e.message) || e || "error").slice(0, 500);

// ── small validators ────────────────────────────────────────────────────────
function reqUuid(v, name) {
  if (typeof v !== "string" || !UUID.test(v)) fail(400, "bad_request", `${name} must be a uuid.`);
  return v.toLowerCase();
}
function reqProjectIds(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PROJECT_IDS) {
    fail(400, "bad_request", `projectIds must list 1 to ${MAX_PROJECT_IDS} project ids.`);
  }
  const ids = [...new Set(v.map((x) => reqUuid(x, "projectIds[]")))];
  return ids;
}
function optCursor(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 1024) fail(400, "bad_request", "cursor must be a string of at most 1024 characters.");
  return v;
}
// History keyset: "<created_at as Postgres text>|<run id>" (from a previous page)
const TS_TEXT = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d{1,6})?([+-]\d\d(:?\d\d)?|Z)?$/;
function runsCursor(v) {
  const s = optCursor(v);
  if (s === null) return null;
  const at = s.lastIndexOf("|");
  const ts = s.slice(0, at), id = s.slice(at + 1);
  if (at < 1 || !TS_TEXT.test(ts) || !UUID.test(id)) fail(400, "bad_request", "cursor is not a History cursor.");
  return { ts, id: id.toLowerCase() };
}
function clampInt(v, lo, hi, dflt) {
  const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
// Every Storage call gets a fresh array of exact object names, never a prefix.
function exactNames(list) {
  const names = [];
  for (const p of list) {
    if (typeof p !== "string" || p.length < 3 || p.length > 1024 || p.endsWith("/") || p.startsWith("/")) {
      throw new Error("refusing a non-exact storage name");
    }
    names.push(p);
  }
  return names;
}
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const normEmail = (e) => String(e || "").trim().toLowerCase();

// Constant-time string compare (no crypto import).
function safeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x.charCodeAt(i) || 0) ^ y.charCodeAt(i);
  return diff === 0;
}

// ── the service ─────────────────────────────────────────────────────────────
export function createAdminStorage({
  getUser, tx, storageRemove, rpc, env = {},
  now = () => Date.now(),
  log = console.error,
  uuid = () => globalThis.crypto.randomUUID(),
}) {
  const io = { storageRemove, rpc };
  const adminEmails = (env.adminEmails || []).map(normEmail).filter(Boolean);
  const adminUserIds = (env.adminUserIds || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const cronSecret = typeof env.cronSecret === "string" && env.cronSecret.length >= 32 ? env.cronSecret : "";
  const storageTimeoutMs = clampInt(env.storageTimeoutMs, 1, 60_000, STORAGE_TIMEOUT_MS);

  // A Storage request that hangs is reported as a failure well inside the
  // lease; its items are re-verified by absence on the next call.
  function bounded(promise) {
    let timer = null;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ error: { message: `Storage did not answer within ${Math.max(1, Math.round(storageTimeoutMs / 1000))} s` } }), storageTimeoutMs);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // One unit of work = one transaction; SET LOCAL timeouts first.
  function runTx(mode, timeout, fn) {
    return tx(mode, async (raw) => {
      const q = async (text, params) => normalize(await raw(text, params || []));
      await q(S.SET_TIMEOUTS, [timeout, IDLE_TIMEOUT]);
      return fn(q);
    });
  }

  // ── auth ──────────────────────────────────────────────────────────────────
  function isAdmin(u) {
    if (!u || typeof u !== "object") return false;
    const email = normEmail(u.email);
    if (!email || !adminEmails.includes(email)) return false;
    if (!u.email_confirmed_at) return false;
    if (u.is_anonymous === true) return false;
    if (u.aud !== "authenticated") return false;
    if (adminUserIds.length && !adminUserIds.includes(String(u.id || "").toLowerCase())) return false;
    return true;
  }
  async function authorize(authorization, cronHeader, action) {
    if (cronSecret && typeof cronHeader === "string" && cronHeader && safeEqual(cronHeader, cronSecret)) {
      if (action !== "drain-queue") fail(403, "admin_only", MESSAGES.admin_only);
      return { id: null, email: "cron", cron: true };
    }
    const m = /^Bearer\s+(\S+)\s*$/i.exec(String(authorization || ""));
    if (!m) fail(401, "sign_in", MESSAGES.sign_in);
    let user = null;
    try { user = await getUser(m[1]); } catch (e) { log("admin-storage: getUser failed", errText(e)); user = null; }
    if (!user) fail(401, "sign_in", MESSAGES.sign_in);
    if (!isAdmin(user)) fail(403, "admin_only", MESSAGES.admin_only);
    return { id: String(user.id).toLowerCase(), email: normEmail(user.email), cron: false };
  }
  function parseBody(body) {
    let obj = body;
    if (typeof body === "string") {
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) fail(413, "bad_request", "The request body is too large.");
      try { obj = JSON.parse(body); } catch { fail(400, "bad_request", "The request body is not valid JSON."); }
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) fail(400, "bad_request", "The request body must be a JSON object.");
    if (typeof obj.action !== "string" || !obj.action) fail(400, "bad_request", "Missing action.");
    return obj;
  }

  // ── setup diagnosis ───────────────────────────────────────────────────────
  async function readSetup() {
    const row = await runTx("read", READ_TIMEOUT, async (q) => {
      const [role] = await q(S.S_ROLE, []);
      const [sees] = await q(S.S_SEES_ALL, []);
      const [st] = await q(S.S_SETUP, []);
      return { role: role || {}, sees: sees || {}, st: st || {} };
    });
    const columns = row.st.columns && typeof row.st.columns === "object" ? row.st.columns : {};
    const missingColumns = [];
    const missingViews = [];
    for (const [view, cols] of Object.entries(REQUIRED_COLUMNS)) {
      const have = Array.isArray(columns[view]) ? columns[view] : null;
      if (!have) missingViews.push(view);
      for (const c of cols) if (!have || !have.includes(c)) missingColumns.push(`${view}.${c}`);
    }
    const views = Number(row.st.views) || 0;
    const seesAll = row.sees.sees_all === true;
    const audit = row.st.audit === true, queue = row.st.queue === true, intents = row.st.intents === true;
    const queueWorker = row.st.queue_worker === true;
    const browseEnabled = views === 6 && missingColumns.length === 0;
    const deleteEnabled = browseEnabled && seesAll && audit;
    // the queue, the reservations and the two queue RPCs come from one migration
    // (series-production.sql); the drain reads all of them
    const drainEnabled = deleteEnabled && queue && intents && queueWorker;
    // 2026-09-28: clearing temp files also needs the audit check that allows
    // its action (admin-storage.sql re-run)
    const tempAction = row.st.temp_action === true;
    const tempEnabled = deleteEnabled && tempAction;
    return {
      db: {
        user: row.role.db_user ?? null, superuser: row.role.rolsuper === true,
        bypassRls: row.role.rolbypassrls === true, serverVersion: row.role.server_version ?? null,
      },
      seesAll,
      setup: { views, missingColumns, audit, queue, intents, queueWorker, temp_action: tempAction },
      browseEnabled, deleteEnabled, drainEnabled, tempEnabled,
      missingViews,
      queueTable: row.st.queue_table === true,
      intentsTable: row.st.intents_table === true,
    };
  }
  const publicSetup = (actor, s) => ({
    admin: { id: actor.id, email: actor.email },
    db: s.db, seesAll: s.seesAll, setup: s.setup,
    browseEnabled: s.browseEnabled, deleteEnabled: s.deleteEnabled, drainEnabled: s.drainEnabled,
    tempEnabled: s.tempEnabled,
  });
  function requireBrowse(s) {
    if (s.browseEnabled) return;
    if (s.missingViews.length) fail(412, "views_missing", MESSAGES.views_missing, { missingViews: s.missingViews });
    fail(412, "views_drift", MESSAGES.views_drift, { missingColumns: s.setup.missingColumns, views: s.setup.views });
  }
  function requireDelete(s) {
    requireBrowse(s);
    if (!s.seesAll) fail(412, "not_full_reader", MESSAGES.not_full_reader);
    if (!s.setup.audit) fail(412, "audit_missing", MESSAGES.audit_missing);
  }
  function requireDrain(s) {
    requireDelete(s);
    if (!s.drainEnabled) fail(412, "queue_missing", MESSAGES.queue_missing);
  }
  function requireTemp(s) {
    requireDelete(s);
    if (!s.tempEnabled) fail(412, "temp_action_missing", MESSAGES.temp_action_missing);
  }

  // ── status / overview / project-files (P1) ───────────────────────────────
  async function status(req, actor) {
    return publicSetup(actor, await readSetup());
  }

  async function overview(req, actor) {
    const s = await readSetup();
    requireBrowse(s);
    const asOf = new Date(now()).toISOString();
    // three read-only transactions at once (separate snapshots: display only;
    // every delete re-verifies)
    const [accounts, projects, folders] = await Promise.all([
      runTx("read", READ_TIMEOUT, (q) => q(S.Q1_ACCOUNTS, [])),
      runTx("read", READ_TIMEOUT, (q) => q(S.Q2_PROJECTS, [])),
      runTx("read", READ_TIMEOUT, (q) => q(S.Q3_FOLDERS, [])),
    ]);
    let queue = null;
    if (s.setup.queue) {
      queue = await runTx("read", READ_TIMEOUT, async (q) => ({
        byReason: await q(S.Q4_QUEUE, []),
        stuck: await q(S.Q5_STUCK, []),
      }));
    }
    return { asOf, setup: publicSetup(actor, s), accounts, projects, folders, queue, temp: tempSummary(folders) };
  }

  // overview.temp (2026-09-28), from Q3's temp_* tallies; the folder rows go
  // out exactly as before. files / bytes: every stage-temp file. oldFiles /
  // oldBytes / accounts / oldest describe only the old files a clear would
  // consider (2026-09-28 review): accounts are counted by account id, so one
  // account's legacy "{uid}" and readable "{name}--{uid}" folders are one.
  function tempSummary(folders) {
    const temp = { files: 0, bytes: 0, oldFiles: 0, oldBytes: 0, accounts: 0, oldest: null, cutoffHours: TEMP_CUTOFF_HOURS };
    const accounts = new Set();
    for (const f of folders) {
      temp.files += Number(f.temp_files) || 0;
      temp.bytes += Number(f.temp_bytes) || 0;
      const old = Number(f.temp_old_files) || 0;
      if (old > 0) {
        temp.oldFiles += old;
        temp.oldBytes += Number(f.temp_old_bytes) || 0;
        accounts.add(folderId(f.user_folder) || f.user_folder);
        if (f.temp_old_oldest && (!temp.oldest || f.temp_old_oldest < temp.oldest)) temp.oldest = f.temp_old_oldest;
      }
      delete f.temp_files; delete f.temp_bytes; delete f.temp_old_files; delete f.temp_old_bytes; delete f.temp_old_oldest;
    }
    temp.accounts = accounts.size;
    return temp;
  }

  async function projectFiles(req) {
    const projectId = reqUuid(req.projectId, "projectId");
    const cursor = optCursor(req.cursor);
    const limit = clampInt(req.limit, 1, PAGE_FILES, PAGE_FILES);
    requireBrowse(await readSetup());
    const rows = await runTx("read", READ_TIMEOUT, (q) => q(S.PROJECT_FILES, [projectId, cursor, limit]));
    const totalAfterCursor = rows.length ? Number(rows[0].total_after_cursor) : 0;
    for (const r of rows) delete r.total_after_cursor;
    return {
      projectId, rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1].path : null,
      total: cursor ? null : totalAfterCursor,
      totalAfterCursor,
    };
  }

  // ── preview-delete (P2) ───────────────────────────────────────────────────
  async function previewDelete(req, actor) {
    const ids = reqProjectIds(req.projectIds);
    requireDelete(await readSetup());
    const idSet = new Set(ids);
    const idsJson = JSON.stringify(ids);
    const runId = uuid();
    return runTx("write", PREVIEW_TIMEOUT, async (q) => {
      const live = await q(S.LIVE_CHECK, [idsJson]);
      if (live.length) fail(409, "project_live", "One of these projects exists, so nothing can be deleted from it.", { ids: live.map((r) => r.id) });
      const rows = (await q(S.CANDIDATES, [idsJson])).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const items = [];
      const perProject = new Map(ids.map((id) => [id, { projectId: id, files: 0, bytes: 0, kept: 0, keptByStatus: {} }]));
      const keptByStatus = {};
      const usedBy = new Map();
      const sample = [];
      let plannedFiles = 0, plannedBytes = 0, keptFiles = 0;
      for (const r of rows) {
        const pid = String(r.project_id).toLowerCase();
        const pp = perProject.get(pid);
        const bytes = r.bytes == null ? null : Number(r.bytes);
        if (plannedRule(r, idSet)) {
          items.push({ path: r.path, project_id: pid, bytes, outcome: "planned", detail: null });
          plannedFiles++; plannedBytes += bytes || 0;
          if (pp) { pp.files++; pp.bytes += bytes || 0; }
          if (sample.length < 20) sample.push(r.path);
        } else {
          const detail = keepDetail(r, idSet);
          items.push({ path: r.path, project_id: pid, bytes, outcome: "kept", detail });
          keptFiles++;
          keptByStatus[detail] = (keptByStatus[detail] || 0) + 1;
          if (pp) { pp.kept++; pp.keptByStatus[detail] = (pp.keptByStatus[detail] || 0) + 1; }
          for (const ref of Array.isArray(r.referenced_by_project_ids) ? r.referenced_by_project_ids : []) {
            const k = String(ref).toLowerCase();
            usedBy.set(k, (usedBy.get(k) || 0) + 1);
          }
        }
      }
      const [run] = await q(S.RUN_INSERT, [runId, actor.id, actor.email, idsJson, plannedFiles, plannedBytes, keptFiles, VERSION]);
      for (const part of chunks(items, ITEM_CHUNK)) await q(S.ITEMS_INSERT, [runId, JSON.stringify(part)]);
      return {
        runId,
        previewExpiresAt: run.preview_expires_at,
        total: { files: plannedFiles, bytes: plannedBytes },
        kept: {
          files: keptFiles, byStatus: keptByStatus,
          usedBy: [...usedBy].map(([projectId, files]) => ({ projectId, files })).sort((a, b) => b.files - a.files),
        },
        projects: [...perProject.values()],
        sample,
      };
    });
  }

  // ── preview-clear-temp (2026-09-28) ───────────────────────────────────────
  // Plans from the server's own query; the browser sends nothing but the action.
  async function previewClearTemp(req, actor) {
    const setup = await readSetup();
    requireTemp(setup);
    const runId = uuid();
    try {
      return await runTx("write", PREVIEW_TIMEOUT, async (q) => {
        const [busy] = await q(S.TEMP_BUSY, [runId]);
        if (busy) tempBusyFail(busy, "Temp files are already being cleared. Wait for that to finish, then review again.");
        const rows = await q(S.TEMP_CANDIDATES, [TEMP_MAX_PLAN]);
        const total = rows.length ? Number(rows[0].total) || 0 : 0;
        const j = JSON.stringify(rows.map((r) => r.path));
        // The review applies the per-batch recheck too, so it counts what a clear
        // would really remove: the view calls a stage file 'service' even with a
        // reservation or a queue row (neither is expected under stage-tmp), and
        // it knows only when a file was created, not when it was last written.
        const intents = setup.intentsTable && rows.length ? new Set((await q(S.RECHECK_INTENTS, [j])).map((r) => r.path)) : new Set();
        const queued = setup.queueTable && rows.length ? new Set((await q(S.RECHECK_QUEUE, [j])).map((r) => r.path)) : new Set();
        const age = rows.length ? new Map((await q(S.TEMP_RECHECK, [j, runId])).map((r) => [r.path, r])) : new Map();
        const items = [];
        const keptByDetail = {};
        const accounts = new Set();
        let plannedFiles = 0, plannedBytes = 0, keptFiles = 0, oldest = null, newest = null;
        for (const r of rows) {
          const bytes = r.bytes == null ? null : Number(r.bytes);
          const a = age.get(r.path);
          const detail = !tempPathGuard(r.path) ? TEMP_OUTSIDE
            : intents.has(r.path) ? "held: upload in progress"
            : queued.has(r.path) ? "held: in the cleanup queue"
            : a && a.in_other_run === true ? TEMP_HELD_OTHER
            : !a || a.present !== true ? "no longer in storage"
            : a.old !== true ? "held: changed in the last 24 hours"
            : null;
          if (detail) {
            items.push({ path: r.path, project_id: null, bytes, outcome: "kept", detail });
            keptFiles++;
            keptByDetail[detail] = (keptByDetail[detail] || 0) + 1;
            continue;
          }
          items.push({ path: r.path, project_id: null, bytes, outcome: "planned", detail: null });
          plannedFiles++; plannedBytes += bytes || 0;
          accounts.add(folderId(r.path.split("/")[0]));        // by account id (the guard parsed it)
          if (!oldest || r.created_at < oldest) oldest = r.created_at;
          if (!newest || r.created_at > newest) newest = r.created_at;
        }
        const [run] = await q(S.TEMP_RUN_INSERT, [runId, actor.id, actor.email, plannedFiles, plannedBytes, keptFiles, VERSION]);
        for (const part of chunks(items, ITEM_CHUNK)) await q(S.ITEMS_INSERT, [runId, JSON.stringify(part)]);
        return {
          runId,
          plannedFiles, plannedBytes, keptFiles, keptByDetail,
          accounts: accounts.size,
          oldest, newest,
          moreRemain: Math.max(0, total - rows.length),
          previewExpiresAt: run.preview_expires_at,
          cutoffHours: TEMP_CUTOFF_HOURS,
        };
      });
    } catch (e) {
      // The setup check read the catalog; a check on storage_runs that still
      // refuses the run (its status is a constant 'previewed', so it is the
      // action) is the same state, and says so instead of a 500.
      const table = String((e && (e.table_name || e.table)) || "");
      if (!(e instanceof ApiError) && String(e && e.code) === "23514"
          && (table === "storage_runs" || /relation "storage_runs"/.test(errText(e)))) {
        fail(412, "temp_action_missing", MESSAGES.temp_action_missing);
      }
      throw e;
    }
  }

  // ── delete (P2) and clear-temp: one run executor ─────────────────────────
  async function summarize(runId, run, status, withLeft) {
    const ids = (run.project_ids || []).map((x) => String(x).toLowerCase());
    const s = await runTx("read", READ_TIMEOUT, async (q) => {
      const [c] = await q(S.ITEM_COUNTS, [runId]);
      const skipped = await q(S.SKIPPED_BY_DETAIL, [runId]);
      const failed = await q(S.FAILED_SAMPLE, [runId]);
      const left = withLeft ? await q(S.LEFT_IN_PROJECTS, [JSON.stringify(ids)]) : null;
      return { c, skipped, failed, left };
    });
    const out = {
      runId, status,
      planned: Number(run.planned_files) || 0,
      removed: s.c.removed, removedBytes: s.c.removed_bytes, alreadyGone: s.c.already_gone,
      skipped: { count: s.c.skipped, byStatus: Object.fromEntries(s.skipped.map((r) => [r.detail, r.n])) },
      failed: { count: s.c.failed, sample: s.failed.map((r) => ({ path: r.path, detail: r.detail })) },
      remaining: s.c.remaining,
    };
    if (s.left) out.leftInProjects = Object.fromEntries(s.left.map((r) => [r.status, r.n]));
    return out;
  }

  async function leaseRefused(runId, kind) {
    const [run] = await runTx("read", READ_TIMEOUT, (q) => q(S.RUN_GET, [runId]));
    if (!run || run.action !== kind.action) fail(409, "run_not_found", kind.notFound);
    if (run.status === "done") return { ...(await summarize(runId, run, "done", kind.withLeft)), replayed: true };
    if (run.status === "expired" || (run.status === "previewed" && run.preview_expired)) {
      if (run.status === "previewed") await runTx("write", WRITE_TIMEOUT, (q) => q(S.RUN_EXPIRE, [runId]));
      fail(409, "preview_expired", "This review expired. Review again.");
    }
    // temp runs: refused because ANOTHER temp clear is running or interrupted
    if (kind.refusedBy && !run.lease_live) await kind.refusedBy(runId);
    fail(409, "run_busy", kind.busy, { startedAt: run.started_at || null });
  }

  // A plan kind supplies what differs between run actions: the setup it
  // needs, the lease (which runs it may take), the full re-verify at the start
  // of a call and the per-batch recheck. Everything else (reconcile,
  // write-ahead 'sending', Storage, confirm by absence, the batch loop, the
  // finish and the summary) is the one code path below.
  const DELETE_KIND = {
    action: DELETE_ACTION,
    stoppedLog: "admin-storage: delete stopped",
    gate: requireDelete,
    lease: (q, runId, token) => q(S.LEASE, [runId, token]),
    withLeft: true,
    notFound: "No such delete run.",
    busy: "This delete is already running. It will show in History.",
    open(run, setup, runId) {
      const ids = (run.project_ids || []).map((x) => String(x).toLowerCase());
      const idSet = new Set(ids);
      const idsJson = JSON.stringify(ids);
      return {
        // full re-verify: one view scan
        async verify() {
          const v = await runTx("read", READ_TIMEOUT, async (q) => {
            const stillLive = await q(S.LIVE_CHECK, [idsJson]);
            if (stillLive.length) return { live: stillLive, cands: [], open: [] };
            return { live: [], cands: await q(S.CANDIDATES, [idsJson]), open: await q(S.ITEMS_OPEN, [runId]) };
          });
          if (v.live.length) return { live: v.live };
          const byPath = new Map(v.cands.map((r) => [r.path, r]));
          const settled = [], targets = [];
          for (const it of v.open) {
            const row = byPath.get(it.path);
            if (!pathGuard(it.path, idSet)) settled.push({ path: it.path, outcome: "skipped", detail: OUTSIDE });
            else if (!row) settled.push({ path: it.path, outcome: "already-gone", detail: "no longer in storage" });
            else if (!plannedRule(row, idSet)) settled.push({ path: it.path, outcome: "skipped", detail: row.status || "no longer safe" });
            else targets.push(it.path);
          }
          return { settled, targets };
        },
        // recheck, read-only: project still absent, not referenced / reserved /
        // queued, still present, and the guard again
        async recheck(batch) {
          const rc = await runTx("read", READ_TIMEOUT, async (q) => {
            const stillLive = await q(S.LIVE_CHECK, [idsJson]);
            if (stillLive.length) return { live: stillLive };
            const j = JSON.stringify(batch);
            const refs = new Set((await q(S.RECHECK_REFS, [j])).map((r) => r.path));
            const intents = setup.intentsTable ? new Set((await q(S.RECHECK_INTENTS, [j])).map((r) => r.path)) : new Set();
            const queued = setup.queueTable ? new Set((await q(S.RECHECK_QUEUE, [j])).map((r) => r.path)) : new Set();
            const present = new Set((await q(S.PRESENT, [j])).map((r) => r.name));
            return { refs, intents, queued, present };
          });
          if (rc.live) return { live: rc.live };
          const settled = [], send = [];
          for (const p of batch) {
            if (!pathGuard(p, idSet)) settled.push({ path: p, outcome: "skipped", detail: OUTSIDE });
            else if (rc.refs.has(p)) settled.push({ path: p, outcome: "skipped", detail: "referenced" });
            else if (rc.intents.has(p)) settled.push({ path: p, outcome: "skipped", detail: "upload in progress" });
            else if (rc.queued.has(p)) settled.push({ path: p, outcome: "skipped", detail: "queued-for-cleanup" });
            else if (!rc.present.has(p)) settled.push({ path: p, outcome: "already-gone", detail: "no longer in storage" });
            else send.push(p);
          }
          return { settled, send };
        },
      };
    },
  };

  const TEMP_KIND = {
    action: TEMP_ACTION,
    stoppedLog: "admin-storage: clear-temp stopped",
    gate: requireTemp,
    // one running temp clear at a time: the NOT EXISTS in TEMP_LEASE, and the
    // unique index for two leases in the same instant (23505 -> 409)
    async lease(q, runId, token) {
      try {
        return await q(S.TEMP_LEASE, [runId, token]);
      } catch (e) {
        if (String(e && e.code) === "23505") fail(409, "run_busy", TEMP_KIND.busy, { startedAt: null });
        throw e;
      }
    },
    async refusedBy(runId) {
      const [busy] = await runTx("read", READ_TIMEOUT, (q) => q(S.TEMP_BUSY, [runId]));
      if (busy) tempBusyFail(busy, TEMP_KIND.busy);
    },
    withLeft: false,
    notFound: "No such temp-file clearing run.",
    busy: "Temp files are already being cleared. It will show in History.",
    open(run, setup, runId) {
      return {
        // no project to re-check and no heavy view scan: every file is
        // re-verified in full just before its batch
        async verify() {
          const open = await runTx("read", READ_TIMEOUT, (q) => q(S.ITEMS_OPEN, [runId]));
          const settled = [], targets = [];
          for (const it of open) {
            if (!tempPathGuard(it.path)) settled.push({ path: it.path, outcome: "skipped", detail: TEMP_OUTSIDE });
            else targets.push(it.path);
          }
          return { settled, targets };
        },
        // recheck, read-only: the guard, not referenced / reserved / queued,
        // not 'sending' in another temp run, still present, created AND last
        // written more than 24 h ago
        async recheck(batch) {
          const rc = await runTx("read", READ_TIMEOUT, async (q) => {
            const j = JSON.stringify(batch);
            const refs = new Set((await q(S.RECHECK_REFS, [j])).map((r) => r.path));
            const intents = setup.intentsTable ? new Set((await q(S.RECHECK_INTENTS, [j])).map((r) => r.path)) : new Set();
            const queued = setup.queueTable ? new Set((await q(S.RECHECK_QUEUE, [j])).map((r) => r.path)) : new Set();
            const age = new Map((await q(S.TEMP_RECHECK, [j, runId])).map((r) => [r.path, r]));
            return { refs, intents, queued, age };
          });
          const settled = [], send = [];
          for (const p of batch) {
            const a = rc.age.get(p);
            if (!tempPathGuard(p)) settled.push({ path: p, outcome: "skipped", detail: TEMP_OUTSIDE });
            else if (rc.refs.has(p)) settled.push({ path: p, outcome: "skipped", detail: "held: in use" });
            else if (rc.intents.has(p)) settled.push({ path: p, outcome: "skipped", detail: "held: upload in progress" });
            else if (rc.queued.has(p)) settled.push({ path: p, outcome: "skipped", detail: "held: in the cleanup queue" });
            else if (a && a.in_other_run === true) settled.push({ path: p, outcome: "skipped", detail: TEMP_HELD_OTHER });
            else if (!a || a.present !== true) settled.push({ path: p, outcome: "already-gone", detail: "no longer in storage" });
            else if (a.old !== true) settled.push({ path: p, outcome: "skipped", detail: "held: changed in the last 24 hours" });
            else send.push(p);
          }
          return { settled, send };
        },
      };
    },
  };

  async function executeRun(req, t0, kind) {
    const runId = reqUuid(req.runId, "runId");
    const setup = await readSetup();
    kind.gate(setup);
    const token = uuid();
    const [run] = await runTx("write", WRITE_TIMEOUT, (q) => kind.lease(q, runId, token));
    if (!run) return leaseRefused(runId, kind);

    const plan = kind.open(run, setup, runId);
    let lastError = null, live = null, unexpected = null;

    const settle = async (list) => {
      for (const part of chunks(list, ITEM_CHUNK)) {
        await runTx("write", WRITE_TIMEOUT, (q) => q(S.ITEMS_SETTLE, [runId, token, JSON.stringify(part)]));
      }
    };

    async function runBatch(batch) {
      const rc = await plan.recheck(batch);
      if (rc.live) return { live: rc.live };
      const { settled, send } = rc;
      // settle + mark sending + renew the lease, one write transaction
      const marked = await runTx("write", WRITE_TIMEOUT, async (q) => {
        if (settled.length) await q(S.ITEMS_SETTLE, [runId, token, JSON.stringify(settled)]);
        if (!send.length) return [];
        return q(S.MARK_SENDING, [runId, token, JSON.stringify(send)]);
      });
      if (!send.length) return { sent: 0, removed: 0 };
      if (marked.length < send.length) return { leaseLost: "before" };
      // Storage, with no transaction open, bounded well inside the lease
      const names = exactNames(send);
      let storageError = null;
      try {
        const res = await bounded(io.storageRemove(names));
        if (res && res.error) storageError = errText(res.error);
      } catch (e) {
        storageError = errText(e);
      }
      // confirmed by absence; written only while this call still holds the lease
      const still = new Set((await runTx("read", READ_TIMEOUT, (q) => q(S.PRESENT, [JSON.stringify(send)]))).map((r) => r.name));
      const outcomes = send.map((p) => ({ path: p, gone: !still.has(p) }));
      const detail = storageError || "still present after remove";
      const confirmed = await runTx("write", WRITE_TIMEOUT, (q) => q(S.ITEMS_CONFIRM, [runId, JSON.stringify(outcomes), detail, token]));
      if (confirmed.length < send.length) return { leaseLost: "during" };   // the new holder settles them by absence
      const removed = outcomes.filter((o) => o.gone).length;
      return { sent: send.length, removed, error: removed < send.length ? detail : null };
    }

    // A project exists again (delete runs only): stop, and say how much this
    // run had already removed.
    async function stopLive(liveRows, further) {
      const ids409 = liveRows.map((r) => r.id);
      const [c] = await runTx("write", WRITE_TIMEOUT, async (q) => {
        const counts = await q(S.ITEM_COUNTS, [runId]);
        const k = counts[0];
        await q(S.RUN_FINISH, [runId, token, "partial", k.removed, k.removed_bytes, k.already_gone, k.skipped, k.failed, liveMsg(k.removed)]);
        return counts;
      });
      const result = await summarize(runId, run, "partial", false);
      fail(409, "project_live", liveText(c.removed, further), { ids: ids409, result });
    }

    try {
      await runTx("write", WRITE_TIMEOUT, (q) => q(S.RECONCILE, [runId]));
      const v = await plan.verify();
      if (v.live) await stopLive(v.live, false);
      if (v.settled.length) await settle(v.settled);

      let zero = 0;
      for (const batch of chunks(v.targets, BATCH)) {
        if (now() - t0 >= BUDGET_MS) break;
        if (zero >= ZERO_PROGRESS_STOP) break;
        const r = await runBatch(batch);
        if (r.live) { live = r.live; break; }
        if (r.leaseLost === "before") { lastError = "lease lost to another call; stopped before calling Storage"; break; }
        if (r.leaseLost) { lastError = "lease lost to another call during a Storage request; that call records these files"; break; }
        if (r.error) lastError = r.error;
        if (r.sent > 0) zero = r.removed === 0 ? zero + 1 : 0;
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      unexpected = e;
      lastError = errText(e);
      log(kind.stoppedLog, runId, lastError);
    }
    if (live && !unexpected) await stopLive(live, true);

    // finish: counters recomputed from the items
    let status;
    try {
      status = await runTx("write", WRITE_TIMEOUT, async (q) => {
        const [c] = await q(S.ITEM_COUNTS, [runId]);
        const st = c.remaining === 0 ? "done" : "partial";
        const err = st === "done" ? null : lastError;
        await q(S.RUN_FINISH, [runId, token, st, c.removed, c.removed_bytes, c.already_gone, c.skipped, c.failed, err]);
        return st;
      });
    } catch (e) {
      log("admin-storage: could not finish run", runId, errText(e));
      throw unexpected || e;   // the run stays 'running'; its lease expires -> Interrupted
    }
    if (unexpected) throw unexpected;
    return summarize(runId, run, status, kind.withLeft && status === "done");
  }

  const deleteRun = (req, actor, t0) => executeRun(req, t0, DELETE_KIND);
  const clearTemp = (req, actor, t0) => executeRun(req, t0, TEMP_KIND);

  // ── runs (History) ───────────────────────────────────────────────────────
  async function runs(req) {
    const s = await readSetup();
    if (!s.setup.audit) fail(412, "audit_missing", MESSAGES.audit_missing);
    if (req.runId === undefined || req.runId === null) {
      const limit = clampInt(req.limit, 1, 50, 20);
      const reviews = req.reviews !== false;
      const at = runsCursor(req.cursor);
      const rows = await runTx("read", READ_TIMEOUT, (q) => q(S.RUNS_LIST, [limit, reviews, at ? at.ts : null, at ? at.id : null]));
      const last = rows.length === limit ? rows[rows.length - 1] : null;
      const nextCursor = last ? last.cursor_at + "|" + last.id : null;
      for (const r of rows) delete r.cursor_at;
      return { runs: rows, nextCursor };
    }
    const runId = reqUuid(req.runId, "runId");
    const outcome = req.outcome === undefined || req.outcome === null ? "failed" : req.outcome;
    if (!OUTCOMES.includes(outcome)) fail(400, "bad_request", "Unknown outcome.");
    const cursor = optCursor(req.cursor);
    return runTx("read", READ_TIMEOUT, async (q) => {
      const [run] = await q(S.RUN_DETAIL, [runId]);
      if (!run) fail(409, "run_not_found", "No such run.");
      const outcomes = Object.fromEntries((await q(S.RUN_OUTCOMES, [runId])).map((r) => [r.outcome, r.n]));
      const items = await q(S.RUN_ITEMS, [runId, outcome, cursor, PAGE_ITEMS]);
      return { run, outcomes, outcome, items, nextCursor: items.length === PAGE_ITEMS ? items[items.length - 1].path : null };
    });
  }

  // ── drain-queue (P3): the queue contract + a reference check + 24 h grace ─
  async function complete(c, removed, error) {
    const res = removed
      ? await io.rpc("turn_complete_asset_cleanup", { p_path: c.path, p_lease_token: c.lease_token, p_confirmed_removed: true })
      : await io.rpc("turn_complete_asset_cleanup", { p_path: c.path, p_lease_token: c.lease_token, p_confirmed_removed: false, p_error: error });
    if (!res || res.error) throw new Error("turn_complete_asset_cleanup failed: " + errText(res && res.error));
  }

  async function drainQueue(req, actor, t0) {
    const max = clampInt(req.max, 1, DRAIN_MAX, DRAIN_MAX);
    requireDrain(await readSetup());
    const runId = uuid(), token = uuid();
    try {
      await runTx("write", WRITE_TIMEOUT, async (q) => {
        await q(S.DRAIN_RECONCILE_STALE, []);
        await q(S.DRAIN_TAKEOVER, []);
        await q(S.DRAIN_INSERT, [runId, actor.id, actor.email, token, VERSION]);
      });
    } catch (e) {
      if (String(e && e.code) === "23505") fail(409, "run_busy", "A cleanup run is already in progress. It will show in History.");
      throw e;
    }

    let claimed = 0, cutShort = false, lastError = null, unexpected = null;

    async function drainBatch(rows) {
      const paths = rows.map((r) => r.path);
      const j = JSON.stringify(paths);
      const rc = await runTx("read", READ_TIMEOUT, async (q) => ({
        info: await q(S.DRAIN_RECHECK, [j]),
        refs: new Set((await q(S.RECHECK_REFS, [j])).map((r) => r.path)),
      }));
      const info = new Map(rc.info.map((r) => [r.path, r]));
      const items = [], completes = [], toRemove = [];
      for (const c of rows) {
        const x = info.get(c.path) || {};
        const pid = String(c.project_id || "").toLowerCase();
        const base = { path: c.path, project_id: pid || null, bytes: x.bytes == null ? null : Number(x.bytes) };
        if (rc.refs.has(c.path)) {
          items.push({ ...base, outcome: "kept", detail: "referenced" });
          completes.push([c, false, "still referenced; kept by admin-storage"]);
        } else if (!x.queued || String(x.lease_token) !== String(c.lease_token)) {
          // gone from the queue (e.g. re-reserved by its uploader) or leased elsewhere: not ours to touch
          items.push({ ...base, outcome: "skipped", detail: "no longer queued under this lease" });
        } else if (x.reserved) {
          items.push({ ...base, outcome: "skipped", detail: "held: upload in progress" });
          completes.push([c, false, "held: upload in progress (admin-storage)"]);
        } else if (x.project_live && x.reason === "abandoned_upload" && x.within_grace) {
          items.push({ ...base, outcome: "skipped", detail: "held: abandoned less than 24 h ago" });
          completes.push([c, false, "held: abandoned less than 24 h ago (admin-storage grace)"]);
        } else if (!pathGuard(c.path, new Set([pid]))) {
          items.push({ ...base, outcome: "failed", detail: "path outside the TURN asset layout; review by hand" });
          completes.push([c, false, "path outside the TURN asset layout; review by hand"]);
        } else if (!x.present) {
          items.push({ ...base, outcome: "already-gone", detail: null });
          completes.push([c, true, null]);
        } else {
          items.push({ ...base, outcome: "sending", detail: null });
          toRemove.push(c);
        }
      }
      const written = await runTx("write", WRITE_TIMEOUT, (q) => q(S.DRAIN_ITEMS_WRITE, [runId, token, JSON.stringify(items)]));
      if (written.length < items.length) return { leaseLost: "before" };
      // Storage comes RIGHT after the recheck (2026-09-27 review): completing the
      // kept / held / already-gone rows is one RPC per row, and doing it first
      // left seconds in which a file could become referenced and still be sent.
      let error = null, leaseLost = null;
      if (toRemove.length) {
        const names = exactNames(toRemove.map((c) => c.path));
        let storageError = null;
        try {
          const res = await bounded(io.storageRemove(names));
          if (res && res.error) storageError = errText(res.error);
        } catch (e) {
          storageError = errText(e);
        }
        const still = new Set((await runTx("read", READ_TIMEOUT, (q) => q(S.PRESENT, [JSON.stringify(names)]))).map((r) => r.name));
        const detail = storageError || "still present after remove";
        const outcomes = toRemove.map((c) => ({ path: c.path, gone: !still.has(c.path) }));
        const confirmed = await runTx("write", WRITE_TIMEOUT, (q) => q(S.ITEMS_CONFIRM, [runId, JSON.stringify(outcomes), detail, token]));
        if (confirmed.length < toRemove.length) leaseLost = "during";   // a takeover settles our items by absence
        for (const c of toRemove) {
          const gone = !still.has(c.path);
          await complete(c, gone, gone ? null : detail);   // queue-lease guarded, confirmed by absence
        }
        if (outcomes.some((o) => !o.gone)) error = detail;
      }
      for (const [c, removed, err] of completes) await complete(c, removed, err);
      return { error, leaseLost };
    }

    try {
      while (claimed < max) {
        if (now() - t0 >= BUDGET_MS) { cutShort = true; break; }
        const take = Math.min(DRAIN_CLAIM, max - claimed);
        const res = await io.rpc("turn_claim_asset_cleanup_batch", { p_limit: take });
        if (!res || res.error) throw new Error("turn_claim_asset_cleanup_batch failed: " + errText(res && res.error));
        const rows = normalize(Array.isArray(res.data) ? res.data : []);
        if (!rows.length) break;
        claimed += rows.length;
        const r = await drainBatch(rows);
        if (r.leaseLost) {
          cutShort = true;
          lastError = r.leaseLost === "before" ? "lease lost; stopped before calling Storage" : "lease lost during a Storage request; stopped";
          break;
        }
        if (r.error) lastError = r.error;
        if (rows.length < take) break;
      }
    } catch (e) {
      unexpected = e;
      cutShort = true;
      lastError = errText(e);
      log("admin-storage: drain stopped", runId, lastError);
    }

    let fin;
    try {
      fin = await runTx("write", WRITE_TIMEOUT, async (q) => {
        await q(S.DRAIN_SETTLE_SENDING, [runId]);
        const [c] = await q(S.ITEM_COUNTS, [runId]);
        const st = cutShort ? "partial" : "done";
        await q(S.DRAIN_FINISH, [runId, token, st, c.total, c.total_bytes, c.kept, c.removed, c.removed_bytes,
          c.already_gone, c.skipped, c.failed, lastError]);
        const [qc] = await q(S.QUEUE_COUNT, []);
        return { c, st, stillQueued: qc.n };
      });
    } catch (e) {
      log("admin-storage: could not finish drain", runId, errText(e));
      throw unexpected || e;   // stays 'running'; the next drain takes it over after its lease
    }
    if (unexpected) throw unexpected;
    return {
      runId, status: fin.st, claimed,
      removed: fin.c.removed, removedBytes: fin.c.removed_bytes, alreadyGone: fin.c.already_gone,
      keptReferenced: fin.c.kept, held: fin.c.held, failed: fin.c.failed,
      heldUpload: fin.c.held_upload, heldGrace: fin.c.held - fin.c.held_upload,
      notQueued: fin.c.skipped - fin.c.held, stillQueued: fin.stillQueued,
    };
  }

  const ROUTES = {
    "status": status,
    "overview": overview,
    "project-files": projectFiles,
    "preview-delete": previewDelete,
    "delete": deleteRun,
    "runs": runs,
    "drain-queue": drainQueue,
    "preview-clear-temp": previewClearTemp,
    "clear-temp": clearTemp,
  };

  function errorResponse(e) {
    if (e instanceof ApiError) {
      return { status: e.status, json: { ok: false, version: VERSION, error: { code: e.code, message: e.message, ...(e.extra || {}) } } };
    }
    if (isUnreachable(e)) {
      log("admin-storage: database unreachable", errText(e));
      return { status: 503, json: { ok: false, version: VERSION, error: { code: "db_unreachable", message: MESSAGES.db_unreachable } } };
    }
    log("admin-storage: internal error", errText(e), e && e.stack ? String(e.stack) : "");
    return { status: 500, json: { ok: false, version: VERSION, error: { code: "internal", message: MESSAGES.internal } } };
  }

  return {
    async handle({ authorization, cronSecret: cronHeader, body } = {}) {
      const t0 = now();
      try {
        const req = parseBody(body);
        const actor = await authorize(authorization, cronHeader, req.action);   // before ANY database work
        if (!Object.prototype.hasOwnProperty.call(ROUTES, req.action)) fail(400, "bad_request", "Unknown action.");
        const out = await ROUTES[req.action](req, actor, t0);
        return { status: 200, json: { ok: true, version: VERSION, elapsedMs: Math.max(0, now() - t0), ...out } };
      } catch (e) {
        return errorResponse(e);
      }
    },
  };
}

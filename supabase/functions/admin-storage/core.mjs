/* ── Admin Storage page: server core (admin-storage Edge Function) ──────────
   Owner: platform admin (admin@infinitestudioai.com) · built 2026-09-27 from
   the Admin Storage spec (Angle A: an Edge Function over the tested
   turn_admin views from supabase/admin-inventory.sql).

   Pure logic, NO imports: index.ts injects the adapters, and
   scripts/test-admin-storage.mjs runs this exact file on PGlite.
     getUser(token)        live GoTrue record (anon client auth.getUser)
     tx(mode, fn)          one Postgres transaction as `postgres` over
                           SUPABASE_DB_URL; fn gets q(text, params) -> rows
     storageRemove(names)  service-role Storage API remove(), exact names only
     rpc(name, args)       service-role PostgREST call (queue functions only)

   Guarantees (spec §6.1), all enforced here, never by the browser:
   - The browser never names a file: it sends project ids (preview) or a run
     id (delete). Every path comes from the server's own queries.
   - Only DELETED projects, only what turn_admin.files calls safe, narrowed by
     area, status and pathGuard(); rechecked per call and per 200-file batch.
   - Write-ahead audit in turn_admin_ops (supabase/admin-storage.sql): plan,
     then planned -> sending -> removed | failed | already-gone | skipped,
     written before and after every Storage call. One lease per run; counters
     are recomputed from the items, never incremented.
   - Removal is confirmed by absence of the storage.objects row.
   - No transaction is ever held open across a Storage or RPC call.
   - Every statement is a constant in S below; inputs only arrive as $n.

   Operator tool: deliberately NOT listed in APP_FEATURES (app/ai.jsx). MUSE
   answers every user, and MUSE Protocol §3 forbids describing how TURN is
   built. (Owner decision, 2026-09-27.)
   Cleanup-queue drain: MANUAL, from the page's "Run cleanup now" button. No
   pg_cron schedule is installed (owner decision, 2026-09-27); the cron-secret
   path below stays inert unless ADMIN_STORAGE_CRON_SECRET is ever set.
   Deleted projects have no tombstone (owner decision, 2026-09-27): the page
   shows them as "Deleted project · <short id>" with their uploaders' emails. */

export const VERSION = "admin-storage@2026-09-27.1";

export const ACTIONS = Object.freeze([
  "status", "overview", "project-files", "preview-delete", "delete", "runs", "drain-queue",
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLDERS = new Set(["character", "prop", "location", "shot", "asset", "locunit", "cameo",
  "storyboard", "lookbook", "other", "series-migration"]);
export function pathGuard(path, projectIds /* Set of lowercase uuids */) {
  if (typeof path !== "string" || path.length < 3 || path.length > 1024) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith("/")) return false;
  const seg = path.split("/");
  if (seg.some((s) => s === "" || s === "." || s === "..")) return false;
  if (seg[0] === "_internal" || seg[0] === "blender-studio-internal") return false;
  if (!UUID.test(seg[0])) return false;
  if (seg[1] === "studio-previews") return seg.length >= 4 && UUID.test(seg[2]) && projectIds.has(seg[2].toLowerCase());
  if (!UUID.test(seg[1]) || !projectIds.has(seg[1].toLowerCase())) return false;
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
// Arrays travel as one JSON text parameter ($n::jsonb), so the same text runs
// on postgres.js and PGlite.
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
           and p.proname in ('turn_claim_asset_cleanup_batch', 'turn_complete_asset_cleanup')) = 2 as queue_worker`,

  // ── overview
  Q1_ACCOUNTS: `select u.user_id, u.email, u.plan, u.created_at, u.last_sign_in_at, u.film_count, u.file_count, u.total_bytes,
       not exists (select 1 from auth.users a where a.id = u.user_id) as deleted_account
  from turn_admin.users u`,
  Q2_PROJECTS: `select p.project_id, tp.owner as owner_id, p.owner_email, p.title, p.kind, p.show_title, p.episode,
       (tp.id is not null) as live, p.files, p.total_bytes, p.orphan_files, p.uploader_emails, p.last_upload
  from turn_admin.projects p
  left join public.turn_projects tp on tp.id = p.project_id`,
  // the saved "Storage map" query (admin-inventory.sql) + project_id as a third key
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
            when bool_or(f.safe_to_delete) then 'some' else 'in-use' end as verdict
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
  LIVE_CHECK: `select id from public.turn_projects where id in (select value::uuid from jsonb_array_elements_text($1::jsonb))`,
  CANDIDATES: `select f.path, f.project_id, f.bytes, f.status, f.area, f.safe_to_delete, f.referenced_by_project_ids
  from turn_admin.files f
 where f.project_id in (select value::uuid from jsonb_array_elements_text($1::jsonb))`,
  RUN_INSERT: `insert into turn_admin_ops.storage_runs
  (id, action, admin_id, admin_email, project_ids, status, planned_files, planned_bytes, kept_files,
   preview_expires_at, function_version)
values ($1::uuid, 'delete-deleted-project-files', $2::uuid, $3::text,
        array(select value::uuid from jsonb_array_elements_text($4::jsonb)),
        'previewed', $5::int, $6::bigint, $7::int, now() + interval '15 minutes', $8::text)
returning preview_expires_at`,
  ITEMS_INSERT: `insert into turn_admin_ops.storage_run_items (run_id, path, project_id, bytes, outcome, detail)
select $1::uuid, x->>'path', (x->>'project_id')::uuid, (x->>'bytes')::bigint, x->>'outcome', x->>'detail'
  from jsonb_array_elements($2::jsonb) x`,

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
              from jsonb_array_elements($3::jsonb)) x
 where i.run_id = ok.id and i.path = x.path and i.outcome in ('planned', 'failed')
returning i.path`,
  RECHECK_REFS: `select distinct path from turn_admin.referenced_paths where path in (select value from jsonb_array_elements_text($1::jsonb))`,
  RECHECK_INTENTS: `select path from public.turn_asset_upload_intents where path in (select value from jsonb_array_elements_text($1::jsonb))`,
  RECHECK_QUEUE: `select path from public.turn_asset_cleanup_queue where path in (select value from jsonb_array_elements_text($1::jsonb))`,
  PRESENT: `select name from storage.objects where bucket_id = 'turn-assets' and name in (select value from jsonb_array_elements_text($1::jsonb))`,
  MARK_SENDING: `with ok as (update turn_admin_ops.storage_runs set lease_expires_at = now() + interval '90 seconds'
             where id = $1::uuid and lease_token = $2::uuid returning id)
update turn_admin_ops.storage_run_items i
   set outcome = 'sending', attempts = i.attempts + 1, updated_at = now()
  from ok
 where i.run_id = ok.id and i.path in (select value from jsonb_array_elements_text($3::jsonb))
   and i.outcome in ('planned', 'failed')
returning i.path`,
  // lease-guarded too (2026-09-27 review): a call whose lease expired during a
  // slow Storage request must not overwrite the new holder's 'sending' items
  ITEMS_CONFIRM: `with ok as (select id from turn_admin_ops.storage_runs where id = $1::uuid and lease_token = $4::uuid)
update turn_admin_ops.storage_run_items i
   set outcome = case when x.gone then 'removed' else 'failed' end,
       detail  = case when x.gone then null else $3::text end, updated_at = now()
  from ok, (select value->>'path' as path, (value->>'gone')::boolean as gone
              from jsonb_array_elements($2::jsonb)) x
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
 where f.project_id in (select value::uuid from jsonb_array_elements_text($1::jsonb))
 group by f.status order by f.status`,

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
   and ($3::timestamptz is null or (created_at, id) < ($3::timestamptz, $4::uuid))
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
  DRAIN_RECHECK: `with b as (select value as path from jsonb_array_elements_text($1::jsonb))
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
  from ok cross join jsonb_array_elements($3::jsonb) x
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
  db_unreachable: "The database couldn't be reached from the function.",
  internal: "Something went wrong on the server. Nothing further was deleted; History shows what happened.",
};
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
    return {
      db: {
        user: row.role.db_user ?? null, superuser: row.role.rolsuper === true,
        bypassRls: row.role.rolbypassrls === true, serverVersion: row.role.server_version ?? null,
      },
      seesAll,
      setup: { views, missingColumns, audit, queue, intents, queueWorker },
      browseEnabled, deleteEnabled, drainEnabled,
      missingViews,
      queueTable: row.st.queue_table === true,
      intentsTable: row.st.intents_table === true,
    };
  }
  const publicSetup = (actor, s) => ({
    admin: { id: actor.id, email: actor.email },
    db: s.db, seesAll: s.seesAll, setup: s.setup,
    browseEnabled: s.browseEnabled, deleteEnabled: s.deleteEnabled, drainEnabled: s.drainEnabled,
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
    return { asOf, setup: publicSetup(actor, s), accounts, projects, folders, queue };
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

  // ── delete (P2) ───────────────────────────────────────────────────────────
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

  async function leaseRefused(runId) {
    const [run] = await runTx("read", READ_TIMEOUT, (q) => q(S.RUN_GET, [runId]));
    if (!run || run.action !== DELETE_ACTION) fail(409, "run_not_found", "No such delete run.");
    if (run.status === "done") return { ...(await summarize(runId, run, "done", true)), replayed: true };
    if (run.status === "expired" || (run.status === "previewed" && run.preview_expired)) {
      if (run.status === "previewed") await runTx("write", WRITE_TIMEOUT, (q) => q(S.RUN_EXPIRE, [runId]));
      fail(409, "preview_expired", "This review expired. Review again.");
    }
    fail(409, "run_busy", "This delete is already running. It will show in History.", { startedAt: run.started_at || null });
  }

  async function deleteRun(req, actor, t0) {
    const runId = reqUuid(req.runId, "runId");
    const setup = await readSetup();
    requireDelete(setup);
    const token = uuid();
    const [run] = await runTx("write", WRITE_TIMEOUT, (q) => q(S.LEASE, [runId, token]));
    if (!run) return leaseRefused(runId);

    const ids = (run.project_ids || []).map((x) => String(x).toLowerCase());
    const idSet = new Set(ids);
    const idsJson = JSON.stringify(ids);
    let lastError = null, live = null, unexpected = null;

    const settle = async (list) => {
      for (const part of chunks(list, ITEM_CHUNK)) {
        await runTx("write", WRITE_TIMEOUT, (q) => q(S.ITEMS_SETTLE, [runId, token, JSON.stringify(part)]));
      }
    };

    async function runBatch(batch) {
      // recheck, read-only: project still absent, not referenced / reserved /
      // queued, still present, and the guard again
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

    // A project exists again: stop, and say how much this run had already removed.
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
      // full re-verify: one view scan
      const v = await runTx("read", READ_TIMEOUT, async (q) => {
        const stillLive = await q(S.LIVE_CHECK, [idsJson]);
        if (stillLive.length) return { live: stillLive, cands: [], open: [] };
        return { live: [], cands: await q(S.CANDIDATES, [idsJson]), open: await q(S.ITEMS_OPEN, [runId]) };
      });
      if (v.live.length) await stopLive(v.live, false);
      const byPath = new Map(v.cands.map((r) => [r.path, r]));
      const settled = [], targets = [];
      for (const it of v.open) {
        const row = byPath.get(it.path);
        if (!pathGuard(it.path, idSet)) settled.push({ path: it.path, outcome: "skipped", detail: OUTSIDE });
        else if (!row) settled.push({ path: it.path, outcome: "already-gone", detail: "no longer in storage" });
        else if (!plannedRule(row, idSet)) settled.push({ path: it.path, outcome: "skipped", detail: row.status || "no longer safe" });
        else targets.push(it.path);
      }
      if (settled.length) await settle(settled);

      let zero = 0;
      for (const batch of chunks(targets, BATCH)) {
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
      log("admin-storage: delete stopped", runId, lastError);
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
    return summarize(runId, run, status, status === "done");
  }

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

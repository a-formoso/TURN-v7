-- ============================================================================
-- TURN — Admin storage inventory  (READ-ONLY views for the platform owner)
--
-- PURPOSE
--   Storage keys start with two folders, the uploader's account and the project:
--     legacy    {uploader_id}/{project_id}/{folder}/{entity}/...
--     readable  {handle}--{uploader_id}/{slug}--{project_id}/{folder}/{entity}/...
--   (readable since 2026-09-27, storage-readable-folders.sql; name first, the full
--   id last). Only the id in each folder counts: a name is display text chosen by
--   the server, never trusted here. These views parse both forms.
--   These views translate every file in the private 'turn-assets' bucket into
--   something a human can read — who uploaded it, which film / Show / Episode it
--   belongs to, which character / prop / location it shows, how big it is — and
--   say whether anything still points at it. Orphans that are SAFE to delete are
--   listed separately, with a reason.
--
--     turn_admin.referenced_paths  every storage path the database records
--     turn_admin.files             one row per file in 'turn-assets'
--     turn_admin.projects          per film / Show / Episode (also ones with no files)
--     turn_admin.users             per account: plan, films, files, storage used
--     turn_admin.orphans           ONLY files that are safe to delete, with a reason
--     turn_admin.external_media    video takes stored on the provider's CDN (not here)
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this WHOLE file → Run.
--   The editor then shows a small table (item / status / detail) — that is the
--   report. Every row should read 'ok' or 'installed', or 'not installed — …' for
--   an optional TURN feature this database does not have yet (nothing to do for
--   those: the views adapt, see WORKS ON EVERY TURN DATABASE below). The last rows
--   count files, projects, users and orphans. Those counts read every file, so on
--   a very large bucket they take a moment; the views are committed before they
--   run, so even a slow or cancelled count leaves the install in place.
--   Safe to re-run at any time: `create schema if not exists` + `create or replace
--   view`. Re-run it after running a later TURN migration (e.g. series-production.sql)
--   so the views start using what that migration added.
--   If a required check fails (a required table or column, the bucket 'turn-assets',
--   Postgres 15, the Data API exposure or the row-level-security check), the
--   PREFLIGHT GUARD stops the run with an error that names what is missing, before
--   anything is created.
--   (Optional first: select just the PREFLIGHT REPORT query below and Run it alone;
--   the editor runs only the selection and shows one row per check.)
--
-- WORKS ON EVERY TURN DATABASE (schema-adaptive)
--   Required: schema.sql (turn_projects, turn_generations), cameos.sql (turn_cameos),
--   Supabase Auth + Storage with the bucket 'turn-assets', Postgres 15 or newer.
--   Optional — used when present, and reported as installed / not installed:
--     series-production.sql
--       Shows & episodes  Show / Episode come from turn_projects.project_kind,
--                         show_id and episode_no. Without them they are read from
--                         the document markers the app writes on such a database:
--                         a Show has doc.isShow = true (its cast lives in
--                         doc.bible); an Episode has a doc.showId that names a Show
--                         row, and its number in doc.episodeNo. A doc.showId that
--                         names no Show (a film, a deleted project, a malformed id)
--                         leaves a plain film, as series-production.sql's backfill
--                         does (the app lists such a row as 'unavailable', never as
--                         an Episode of that project).
--       Upload reservations (turn_asset_upload_intents): a live one marks a file
--                         'uploading', an expired one 'queued-for-cleanup'. Without
--                         the table only the < 1 hour rule marks uploads in progress.
--       Cleanup queue     (turn_asset_cleanup_queue): a queued file is
--                         'queued-for-cleanup'. Without it no file has that status.
--     credits.sql         turn_credits: the plan column of turn_admin.users.
--                         Without it the plan is left empty.
--     storage-readable-folders.sql
--       Readable folders  turn_storage_accounts.handle and turn_projects.storage_slug:
--                         turn_admin.users.storage_handle, turn_admin.projects
--                         .storage_slug, and turn_admin.files.label_note, which
--                         flags a folder label that differs from the stored handle
--                         or project name. Without them those columns are empty.
--                         Readable KEYS are parsed either way (their ids decide).
--   A feature is either absent or complete. A half-applied one (say the table is
--   there but a column is not) stops the run: reading it half-way could hide an
--   upload in progress or show the wrong Show.
--   The three views that depend on optional features (files, projects, users) are
--   built by one DO block that reads the catalog and writes the matching view text;
--   their column lists are identical either way, so a re-run after a migration
--   simply replaces them.
--
-- WHAT IT DOES NOT DO
--   No triggers, no policies, no grants, no functions, nothing that writes. It only
--   creates the schema turn_admin and six views in it, then REVOKES access so that
--   only postgres (the SQL Editor) can read them. The two DO blocks are anonymous
--   code that runs once and leaves nothing behind. The views run with the caller's
--   own privileges (security_invoker), so even a role that somehow got USAGE on the
--   schema would see nothing it could not already read.
--   Prompts are never shown, nor is turn_cameos.prov (consent/subject details): the
--   views read only paths, sizes, ids, titles, emails and entity names.
--
-- HOW TO REMOVE IT (complete and reversible — nothing else depends on it)
--   drop schema turn_admin cascade;
--   (If a re-run after editing this file fails with "cannot change name of view
--   column" / "cannot drop columns from view", run that drop first, then re-run.)
--
-- READING THE STATUS COLUMN (turn_admin.files.status), first match wins:
--   'current, history, …'     referenced: a comma list of where the path is recorded
--                             (current = turn_generations.storage_path, ref, history,
--                             history-ref, cleanup-pending, history-cleanup-pending,
--                             cameo-angle). Files are matched on PATH ONLY — a Show row
--                             that points at a file under Episode 1's folder counts.
--   'service'                 server-owned: relay security markers, studio meshes,
--                             image-proxy temp files, Blender Studio previews, and the
--                             Blender relay's shot PNG (referenced only inside the
--                             encrypted relay state).
--   'uploading'               a live upload reservation exists (when that table is
--                             installed), or the file is < 1 h old (uploads land in
--                             Storage before their database row).
--   'queued-for-cleanup'      already in turn_asset_cleanup_queue, or its upload
--                             reservation expired (the app promotes those to the queue).
--                             Only when those tables are installed.
--   'orphan: project deleted' its project row is gone and nothing references it.
--   'kept-for-promotion-retry' a Show-promotion copy (series-migration/…) that nothing
--                             references yet, and the Show has no row for its entity
--                             that records a file: the promotion was interrupted, and
--                             the next retry reuses this exact copy by name. NOT safe
--                             to delete; review by hand (it is freed once the retry
--                             lands or the Show is deleted).
--   'unreferenced'            its project exists but nothing references it (for a
--                             Show-promotion copy: the Show already has a row for
--                             that entity recording other files — superseded).
--
-- SECURITY FACTS THE VIEWS RESPECT
--   * folder 1 is the UPLOADER, not the owner: one film can span several user folders
--     (collaborators). project_owner_email comes from turn_projects.owner.
--   * folder 2 is the project (studio previews: folder 3).
--   * A folder is a bare uuid (legacy) or '{label}--{uuid}' (readable: lowercase
--     [a-z0-9] runs joined by single hyphens, 1-64 characters, no 8 hex digits in a
--     row anywhere; at most 102 characters in all). Only the uuid is read.
--     The label is shown (account_label / project_label) and compared with the
--     stored names only to fill label_note; the owner and project of a file always
--     come from the uuid, and whether a file is safe to delete never depends on a
--     label. One account can therefore show two folders in the Dashboard (legacy
--     and readable); the views group by id.
--   * '_internal/…' (relay security markers) and 'blender-studio-internal/…' (studio
--     meshes) are never orphans; neither is anything 'uploading' or referenced.
--   * Show-promotion copies ('series-migration/…') have fixed names that a retry
--     reuses; a copy the next retry could still adopt is never listed as safe.
--   * The views run with the reader's rights (security_invoker). If the reader
--     cannot see every row (row-level security), nothing is marked safe to delete;
--     the preflight refuses to install for such a role.
--   * Folders are parsed with a regex check before ::uuid, so they never raise;
--     files whose layout is not recognised get area 'unknown' and are never listed
--     as safe to delete — review those by hand.
--   * Show / Episode fields only label rows and pick entity names. Whether a file is
--     safe to delete never depends on them: files are matched on path only.
-- ============================================================================


-- ── PREFLIGHT REPORT (read-only) ────────────────────────────────────────────
-- Select from "with need" down to the first ";" and Run to see every check.
-- Every row should say ok = true; status says 'ok', or 'not installed — …' for an
-- optional feature this database does not have (fine), or 'FAIL — …'. Running the
-- whole file is also fine: the PREFLIGHT GUARD below repeats the same checks and
-- aborts on the first problem.
with need(schema_name, table_name, column_name, feature, source) as (values
  ('auth', 'users', 'id', 'core', 'Supabase Auth'),
  ('auth', 'users', 'email', 'core', 'Supabase Auth'),
  ('auth', 'users', 'created_at', 'core', 'Supabase Auth'),
  ('auth', 'users', 'last_sign_in_at', 'core', 'Supabase Auth'),
  ('storage', 'objects', 'bucket_id', 'core', 'Supabase Storage'),
  ('storage', 'objects', 'name', 'core', 'Supabase Storage'),
  ('storage', 'objects', 'metadata', 'core', 'Supabase Storage'),
  ('storage', 'objects', 'created_at', 'core', 'Supabase Storage'),
  ('public', 'turn_projects', 'id', 'core', 'schema.sql'),
  ('public', 'turn_projects', 'owner', 'core', 'schema.sql'),
  ('public', 'turn_projects', 'title', 'core', 'schema.sql'),
  ('public', 'turn_projects', 'doc', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'project_id', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'owner', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'entity_id', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'storage_path', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'meta', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'refs', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'history', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'updated_at', 'core', 'schema.sql'),
  ('public', 'turn_cameos', 'project_id', 'cameos', 'cameos.sql'),
  ('public', 'turn_cameos', 'char_id', 'cameos', 'cameos.sql'),
  ('public', 'turn_cameos', 'angles', 'cameos', 'cameos.sql'),
  ('public', 'turn_projects', 'project_kind', 'series', 'series-production.sql'),
  ('public', 'turn_projects', 'show_id', 'series', 'series-production.sql'),
  ('public', 'turn_projects', 'episode_no', 'series', 'series-production.sql'),
  ('public', 'turn_asset_upload_intents', 'path', 'intents', 'series-production.sql'),
  ('public', 'turn_asset_upload_intents', 'expires_at', 'intents', 'series-production.sql'),
  ('public', 'turn_asset_cleanup_queue', 'path', 'queue', 'series-production.sql'),
  ('public', 'turn_credits', 'owner', 'credits', 'credits.sql'),
  ('public', 'turn_credits', 'plan', 'credits', 'credits.sql'),
  ('public', 'turn_storage_accounts', 'user_id', 'readable', 'storage-readable-folders.sql'),
  ('public', 'turn_storage_accounts', 'handle', 'readable', 'storage-readable-folders.sql'),
  ('public', 'turn_projects', 'storage_slug', 'readable', 'storage-readable-folders.sql')
),
have as (
  select n.*,
         exists (
           select 1
             from pg_catalog.pg_attribute a
             join pg_catalog.pg_class c on c.oid = a.attrelid
             join pg_catalog.pg_namespace s on s.oid = c.relnamespace
            where s.nspname = n.schema_name and c.relname = n.table_name
              and a.attname = n.column_name and a.attnum > 0 and not a.attisdropped
         ) as present,
         exists (
           select 1
             from pg_catalog.pg_class c
             join pg_catalog.pg_namespace s on s.oid = c.relnamespace
            where s.nspname = n.schema_name and c.relname = n.table_name
         ) as table_present
    from need n
),
-- installed = every column there. absent = an optional feature that is simply not
-- there (for Shows & episodes and readable folders: none of their columns,
-- otherwise: no table).
-- missing = a required column is gone. partial = an optional feature half there.
-- (Keep this query free of semicolons until its end: see the note above it.)
feat as (
  select h.feature,
         case
           when bool_and(h.present) then 'installed'
           when h.feature in ('core', 'cameos') then 'missing'
           when h.feature in ('series', 'readable') then case when bool_or(h.present) then 'partial' else 'absent' end
           when bool_or(h.table_present) then 'partial'
           else 'absent'
         end as state
    from have h
   group by h.feature
)
select 'column ' || h.schema_name || '.' || h.table_name || '.' || h.column_name as check_name,
       (h.present or f.state = 'absent') as ok,
       case
         when h.present then 'ok'
         when f.state = 'absent' then 'not installed — ' || case h.feature
              when 'series' then 'Shows/episodes read from the document markers'
              when 'intents' then 'only files under 1 hour old count as uploading'
              when 'queue' then 'no file is marked queued-for-cleanup'
              when 'credits' then 'plan is left empty in turn_admin.users'
              when 'readable' then 'folder labels are shown but not compared (label_note stays empty)' end
         when f.state = 'partial' then 'FAIL — half-installed: the rest of ' || h.source || ' is here, this column is not'
         else 'FAIL — required: run ' || h.source || ' first'
       end as status
  from have h
  join feat f on f.feature = h.feature
union all
select 'turn_admin is NOT in the in-database PostgREST schemas (authenticator pgrst.db_schemas) — also check Dashboard → Data API by eye',
       x.ok, case when x.ok then 'ok' else 'FAIL — remove turn_admin from Data API → Exposed schemas' end
  from (select not exists (
          select 1 from pg_catalog.pg_roles r
           cross join lateral unnest(coalesce(r.rolconfig, array[]::text[])) cfg
           where r.rolname = 'authenticator'
             and cfg ilike 'pgrst.db_schemas=%'
             and cfg ~* '(^|[=,[:space:]"])turn_admin($|[,[:space:]"])'
        ) as ok) x
union all
select 'bucket turn-assets exists',
       x.ok, case when x.ok then 'ok' else 'FAIL — the private bucket turn-assets does not exist (run storage.sql)' end
  from (select exists (select 1 from storage.buckets b where b.id = 'turn-assets') as ok) x
union all
select 'Postgres 15 or newer (security_invoker views)',
       x.ok, case when x.ok then 'ok' else 'FAIL — this database runs Postgres ' || current_setting('server_version') end
  from (select current_setting('server_version_num')::int >= 150000 as ok) x
union all
select 'current role sees every row of the tables read (superuser, BYPASSRLS, or owner without FORCE RLS)',
       x.ok, case when x.ok then 'ok' else 'FAIL — run this in the SQL Editor as postgres' end
  from (select not exists (
          select 1
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace s on s.oid = c.relnamespace
            join pg_catalog.pg_roles me on me.rolname = current_user
           where (s.nspname, c.relname) in (('auth','users'), ('storage','objects'), ('public','turn_projects'),
                   ('public','turn_generations'), ('public','turn_cameos'),
                   ('public','turn_asset_upload_intents'), ('public','turn_asset_cleanup_queue'),
                   ('public','turn_credits'))
             and c.relrowsecurity
             and not (me.rolsuper or me.rolbypassrls
                      or (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
                          and not c.relforcerowsecurity))
        ) as ok) x
order by 2, 1;
-- Also confirm by eye: Dashboard → Project Settings → Data API → Exposed schemas
-- must NOT contain turn_admin. (Even if it did, the revokes below keep anon and
-- authenticated out — but never expose it.)


begin;

-- ── PREFLIGHT GUARD (read-only; aborts the run before anything is created) ──
-- Required columns must exist; an optional feature must be absent or complete.
do $preflight$
declare
  problem text;
  core_missing boolean;
  sources text;
begin
  with need(schema_name, table_name, column_name, feature, source) as (values
    ('auth', 'users', 'id', 'core', 'Supabase Auth'),
    ('auth', 'users', 'email', 'core', 'Supabase Auth'),
    ('auth', 'users', 'created_at', 'core', 'Supabase Auth'),
    ('auth', 'users', 'last_sign_in_at', 'core', 'Supabase Auth'),
    ('storage', 'objects', 'bucket_id', 'core', 'Supabase Storage'),
    ('storage', 'objects', 'name', 'core', 'Supabase Storage'),
    ('storage', 'objects', 'metadata', 'core', 'Supabase Storage'),
    ('storage', 'objects', 'created_at', 'core', 'Supabase Storage'),
    ('public', 'turn_projects', 'id', 'core', 'schema.sql'),
    ('public', 'turn_projects', 'owner', 'core', 'schema.sql'),
    ('public', 'turn_projects', 'title', 'core', 'schema.sql'),
    ('public', 'turn_projects', 'doc', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'project_id', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'owner', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'entity_id', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'storage_path', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'meta', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'refs', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'history', 'core', 'schema.sql'),
    ('public', 'turn_generations', 'updated_at', 'core', 'schema.sql'),
    ('public', 'turn_cameos', 'project_id', 'cameos', 'cameos.sql'),
    ('public', 'turn_cameos', 'char_id', 'cameos', 'cameos.sql'),
    ('public', 'turn_cameos', 'angles', 'cameos', 'cameos.sql'),
    ('public', 'turn_projects', 'project_kind', 'series', 'series-production.sql'),
    ('public', 'turn_projects', 'show_id', 'series', 'series-production.sql'),
    ('public', 'turn_projects', 'episode_no', 'series', 'series-production.sql'),
    ('public', 'turn_asset_upload_intents', 'path', 'intents', 'series-production.sql'),
    ('public', 'turn_asset_upload_intents', 'expires_at', 'intents', 'series-production.sql'),
    ('public', 'turn_asset_cleanup_queue', 'path', 'queue', 'series-production.sql'),
    ('public', 'turn_credits', 'owner', 'credits', 'credits.sql'),
    ('public', 'turn_credits', 'plan', 'credits', 'credits.sql'),
    ('public', 'turn_storage_accounts', 'user_id', 'readable', 'storage-readable-folders.sql'),
    ('public', 'turn_storage_accounts', 'handle', 'readable', 'storage-readable-folders.sql'),
    ('public', 'turn_projects', 'storage_slug', 'readable', 'storage-readable-folders.sql')
  ),
  have as (
    select n.*,
           exists (
             select 1
               from pg_catalog.pg_attribute a
               join pg_catalog.pg_class c on c.oid = a.attrelid
               join pg_catalog.pg_namespace s on s.oid = c.relnamespace
              where s.nspname = n.schema_name and c.relname = n.table_name
                and a.attname = n.column_name and a.attnum > 0 and not a.attisdropped
           ) as present,
           exists (
             select 1
               from pg_catalog.pg_class c
               join pg_catalog.pg_namespace s on s.oid = c.relnamespace
              where s.nspname = n.schema_name and c.relname = n.table_name
           ) as table_present
      from need n
  ),
  feat as (
    select h.feature,
           case
             when bool_and(h.present) then 'installed'
             when h.feature in ('core', 'cameos') then 'missing'
             when h.feature in ('series', 'readable') then case when bool_or(h.present) then 'partial' else 'absent' end
             when bool_or(h.table_present) then 'partial'
             else 'absent'
           end as state
      from have h
     group by h.feature
  )
  select string_agg(h.schema_name || '.' || h.table_name || '.' || h.column_name, ', '
                    order by h.schema_name, h.table_name, h.column_name),
         bool_or(f.state = 'missing'),
         string_agg(distinct h.source, ', ' order by h.source)
    into problem, core_missing, sources
    from have h
    join feat f on f.feature = h.feature
   where not h.present
     and f.state in ('missing', 'partial');

  if problem is not null then
    raise exception 'TURN admin inventory preflight: missing % — %. Nothing was created.', problem,
      case when core_missing
           then 'run these TURN migrations first: ' || sources
           else 'a TURN migration is only partly applied here (' || sources
                || '): an optional feature must be absent or complete, so finish that migration, then re-run this file'
      end;
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles r
     cross join lateral unnest(coalesce(r.rolconfig, array[]::text[])) cfg
     where r.rolname = 'authenticator'
       and cfg ilike 'pgrst.db_schemas=%'
       and cfg ~* '(^|[=,[:space:]"])turn_admin($|[,[:space:]"])'
  ) then
    raise exception 'TURN admin inventory preflight: turn_admin is listed in the Data API exposed schemas. Remove it there first. Nothing was created.';
  end if;

  if current_setting('server_version_num')::int < 150000 then
    raise exception 'TURN admin inventory preflight: needs Postgres 15 or newer (security_invoker views). Nothing was created.';
  end if;

  -- The views run with the reader's own rights. A role that row-level security
  -- limits would see fewer references and could mistake live files for orphans.
  if exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace s on s.oid = c.relnamespace
      join pg_catalog.pg_roles me on me.rolname = current_user
     where (s.nspname, c.relname) in (('auth','users'), ('storage','objects'), ('public','turn_projects'),
                                      ('public','turn_generations'), ('public','turn_cameos'),
                                      ('public','turn_asset_upload_intents'), ('public','turn_asset_cleanup_queue'),
                                      ('public','turn_credits'))
       and c.relrowsecurity
       and not (me.rolsuper or me.rolbypassrls
                or (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
                    and not c.relforcerowsecurity))
  ) then
    raise exception 'TURN admin inventory preflight: role % cannot see every row (row-level security) of the tables these views read. Run this in the SQL Editor as postgres. Nothing was created.', current_user;
  end if;

  -- Every TURN file lives in this bucket. Without it the views would install but
  -- list nothing, which reads like a clean bucket rather than a broken database.
  if not exists (select 1 from storage.buckets b where b.id = 'turn-assets') then
    raise exception 'TURN admin inventory preflight: the private bucket turn-assets does not exist (run storage.sql). Nothing was created.';
  end if;
end;
$preflight$;


-- ── SCHEMA (private) ────────────────────────────────────────────────────────
create schema if not exists turn_admin;
comment on schema turn_admin is
  'TURN admin storage inventory: read-only views, readable only by postgres (SQL Editor). Remove with: drop schema turn_admin cascade;';
revoke all on schema turn_admin from public;
revoke all on schema turn_admin from anon, authenticated, service_role;


-- ── 1. referenced_paths — every storage path the database records ───────────
-- One row per (path, project, entity, kind). Kinds:
--   current                 turn_generations.storage_path
--   ref                     turn_generations.refs[].storage_path
--   history                 turn_generations.history[].storage_path
--   history-ref             turn_generations.history[].refs[].storage_path
--   cleanup-pending         turn_generations.meta.cleanupPending[]
--   history-cleanup-pending turn_generations.history[].meta.cleanupPending[]
--   cameo-angle             turn_cameos.angles[].storage_path   (entity_id = char_id)
create or replace view turn_admin.referenced_paths with (security_invoker = true) as
with gens as (
  select g.project_id,
         g.entity_id,
         g.storage_path,
         g.meta,
         case when jsonb_typeof(g.refs) = 'array' then g.refs else '[]'::jsonb end as refs,
         case when jsonb_typeof(g.history) = 'array' then g.history else '[]'::jsonb end as history
    from public.turn_generations g
),
raw as (
  select g.storage_path as path, g.project_id, g.entity_id, 'current'::text as ref_kind
    from gens g
  union all
  select r.value ->> 'storage_path', g.project_id, g.entity_id, 'ref'
    from gens g
    cross join lateral jsonb_array_elements(g.refs) r
  union all
  select h.value ->> 'storage_path', g.project_id, g.entity_id, 'history'
    from gens g
    cross join lateral jsonb_array_elements(g.history) h
  union all
  select hr.value ->> 'storage_path', g.project_id, g.entity_id, 'history-ref'
    from gens g
    cross join lateral jsonb_array_elements(g.history) h
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(h.value -> 'refs') = 'array' then h.value -> 'refs' else '[]'::jsonb end
    ) hr
  union all
  select p.value, g.project_id, g.entity_id, 'cleanup-pending'
    from gens g
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(g.meta -> 'cleanupPending') = 'array'
           then g.meta -> 'cleanupPending' else '[]'::jsonb end
    ) p
  union all
  select p.value, g.project_id, g.entity_id, 'history-cleanup-pending'
    from gens g
    cross join lateral jsonb_array_elements(g.history) h
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(h.value -> 'meta' -> 'cleanupPending') = 'array'
           then h.value -> 'meta' -> 'cleanupPending' else '[]'::jsonb end
    ) p
  union all
  select a.value ->> 'storage_path', c.project_id, c.char_id, 'cameo-angle'
    from public.turn_cameos c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.angles) = 'array' then c.angles else '[]'::jsonb end
    ) a
)
select distinct raw.path, raw.project_id, raw.entity_id, raw.ref_kind
  from raw
 where nullif(btrim(raw.path), '') is not null;

comment on view turn_admin.referenced_paths is
  'Every storage path recorded in turn_generations (current, refs, history, history refs, cleanup ledgers) and turn_cameos.angles. Match files on path only.';


-- ── 2–4. files, projects, users — built to fit this database ────────────────
-- These three views read optional TURN features, and a view binds its columns
-- when it is created, so this block looks in the catalog and writes the view text
-- that matches what exists. Tokens in the text below:
--   {{proj}}            turn_projects with project_kind, show_id, episode_no:
--                         * series-production.sql installed → from the columns (the
--                           app treats them as the authority; it falls back to the
--                           document markers only for a row whose kind is not
--                           film / show / episode, and so does this);
--                         * not installed → from the document markers alone:
--                           Show = doc.isShow is true ('true' in any case, as the
--                           app and series-production.sql read it); Episode = a
--                           non-Show doc whose doc.showId is the id of a Show row
--                           (series-production.sql's trigger and backfill likewise
--                           refuse a parent that is not a Show, and the app lists
--                           such a row as 'unavailable'); episode number = a
--                           positive integer in doc.episodeNo. Anything else,
--                           e.g. a doc.showId naming a film, a deleted project or
--                           no valid id, is a film. The parent is found by a join
--                           on the project id, one row at most per project.
--                           The same rule applies to the fallback above.
--   {{upload_intents}}  public.turn_asset_upload_intents, or an empty relation
--   {{cleanup_queue}}   public.turn_asset_cleanup_queue, or an empty relation
--   {{credits}}         public.turn_credits, or an empty relation
--   {{accounts}}        public.turn_storage_accounts (user_id, handle), or an empty
--                       relation; turn_projects.storage_slug rides in {{proj}} (or
--                       null). Used only for storage_handle, storage_slug and
--                       label_note — never for ownership or safe_to_delete.
-- An empty relation (… where false) keeps every rule and every column identical:
-- no reservation row can match, so a file is 'uploading' only by the < 1 hour rule
-- and nothing is 'queued-for-cleanup'; plan is null. Column names and types are the
-- same in every combination, so a re-run after a migration replaces the views.
do $build$
declare
  has_series boolean;
  has_intents boolean;
  has_queue boolean;
  has_credits boolean;
  has_readable boolean;
  slug_expr text;
  -- document markers (per project row, not per file). p = the project, ps = the
  -- Show its doc.showId names, joined only when that row really is a Show (so
  -- ps.id is null for a film, a deleted project or a malformed id). The uuid
  -- pattern is written {8}(-…){3} on purpose: the test's query-plan check counts
  -- the per-FILE storage-key pattern ({8}-{4}-…) and must not count this one.
  doc_show_ref constant text := $e$(case when lower(coalesce(p.doc ->> 'isShow', 'false')) <> 'true'
                    and btrim(p.doc ->> 'showId') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                   then btrim(p.doc ->> 'showId')::uuid end)$e$;
  doc_kind constant text := $e$(case when lower(coalesce(p.doc ->> 'isShow', 'false')) = 'true' then 'show'
               when ps.id is not null then 'episode'
               else 'film' end)$e$;
  doc_episode constant text := $e$(case when ps.id is not null
                    and btrim(p.doc ->> 'episodeNo') ~ '^[1-9][0-9]{0,8}$'
                   then btrim(p.doc ->> 'episodeNo')::integer end)$e$;
  -- a kind the app trusts (false, never null, so a join condition can negate it)
  valid_kind constant text := $e$coalesce(lower(btrim(p.project_kind)) in ('film', 'show', 'episode'), false)$e$;
  proj text;
  v text;
begin
  select count(*) = 3 into has_series
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'turn_projects'
     and a.attname in ('project_kind', 'show_id', 'episode_no')
     and a.attnum > 0 and not a.attisdropped;
  -- the guard has already refused a table that is present but incomplete
  has_intents := to_regclass('public.turn_asset_upload_intents') is not null;
  has_queue := to_regclass('public.turn_asset_cleanup_queue') is not null;
  has_credits := to_regclass('public.turn_credits') is not null;
  -- readable folders: the guard has already refused a half-installed feature
  select count(*) = 3 into has_readable
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public'
     and ((c.relname = 'turn_storage_accounts' and a.attname in ('user_id', 'handle'))
          or (c.relname = 'turn_projects' and a.attname = 'storage_slug'))
     and a.attnum > 0 and not a.attisdropped;
  slug_expr := case when has_readable then 'p.storage_slug' else 'null' end;

  if has_series then
    -- the columns decide; the markers (and the parent join) only for a row whose
    -- kind is not film / show / episode. The parent counts as a Show the same way:
    -- by its kind when that is valid, else by its doc.isShow.
    proj := 'select p.id, p.owner, p.title, p.doc,'
      || E'\n         (case when ' || valid_kind || ' then lower(btrim(p.project_kind)) else ' || doc_kind || ' end)::text as project_kind,'
      || E'\n         (case when ' || valid_kind || ' then p.show_id else ps.id end)::uuid as show_id,'
      || E'\n         (case when ' || valid_kind || ' then p.episode_no else ' || doc_episode || ' end)::integer as episode_no,'
      || E'\n         (' || slug_expr || ')::text as storage_slug'
      || E'\n    from public.turn_projects p'
      || E'\n    left join public.turn_projects ps'
      || E'\n           on not ' || valid_kind
      || E'\n          and ps.id = ' || doc_show_ref
      || E'\n          and (case when ' || replace(valid_kind, 'p.project_kind', 'ps.project_kind')
      || E'\n                    then lower(btrim(ps.project_kind)) = ''show'''
      || E'\n                    else lower(coalesce(ps.doc ->> ''isShow'', ''false'')) = ''true'' end)';
  else
    proj := 'select p.id, p.owner, p.title, p.doc,'
      || E'\n         ' || doc_kind || '::text as project_kind,'
      || E'\n         ps.id::uuid as show_id,'
      || E'\n         ' || doc_episode || '::integer as episode_no,'
      || E'\n         (' || slug_expr || ')::text as storage_slug'
      || E'\n    from public.turn_projects p'
      || E'\n    left join public.turn_projects ps'
      || E'\n           on ps.id = ' || doc_show_ref
      || E'\n          and lower(coalesce(ps.doc ->> ''isShow'', ''false'')) = ''true''';
  end if;

  -- ── 2. files — one row per file in the turn-assets bucket ─────────────────
  v := $view$
create or replace view turn_admin.files with (security_invoker = true) as
-- Speed. Postgres inlines a CTE that is used once and copies its expressions into
-- every place the next step uses them; unfenced, the uuid regexes and
-- string_to_array ran dozens of times per file. Each parsing step below ends in
-- OFFSET 0, which keeps it a separate step that computes each column once per
-- file without writing it to a temp file, and `cls2` (used several times) is
-- MATERIALIZED with scalars only: the metadata jsonb and the segment array are
-- not carried past `parsed`.
with proj as not materialized (
  -- turn_projects with the Show / Episode fields (see the DO block's notes)
  {{proj}}
),
split as (
  select o.name as path,
         o.created_at,
         o.metadata ->> 'size' as size_txt,
         o.metadata ->> 'mimetype' as mime,
         string_to_array(o.name, '/') as seg
    from storage.objects o
   where o.bucket_id = 'turn-assets'
  offset 0
),
parsed as (
  select s.path,
         s.created_at,
         case when s.size_txt ~ '^[0-9]{1,18}$' then s.size_txt::bigint end as bytes,
         s.mime,
         coalesce(array_length(s.seg, 1), 0) as nseg,
         s.seg[1] as seg1, s.seg[2] as seg2, s.seg[3] as seg3,
         s.seg[4] as seg4, s.seg[5] as seg5, s.seg[6] as seg6,
         s.seg[coalesce(array_length(s.seg, 1), 0)] as file_name,
         -- a folder's id: a bare uuid (legacy; any case, as before) or the last 36
         -- characters of '{label}--{uuid}' (readable; strict lowercase grammar, the
         -- same as public.turn_storage_segment_id and app/storage-keys.js)
         case when s.seg[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s.seg[1]::uuid
              when char_length(s.seg[1]) <= 102
               and s.seg[1] ~ '^[a-z0-9]+(?:-[a-z0-9]+)*--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and left(s.seg[1], -38) !~ '[0-9a-f]{8}'
              then right(s.seg[1], 36)::uuid end as seg1_uuid,
         case when s.seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s.seg[2]::uuid
              when char_length(s.seg[2]) <= 102
               and s.seg[2] ~ '^[a-z0-9]+(?:-[a-z0-9]+)*--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and left(s.seg[2], -38) !~ '[0-9a-f]{8}'
              then right(s.seg[2], 36)::uuid end as seg2_uuid,
         case when s.seg[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s.seg[3]::uuid
              when char_length(s.seg[3]) <= 102
               and s.seg[3] ~ '^[a-z0-9]+(?:-[a-z0-9]+)*--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and left(s.seg[3], -38) !~ '[0-9a-f]{8}'
              then right(s.seg[3], 36)::uuid end as seg3_uuid
    from split s
  offset 0
),
cls as (
  select p.*,
         -- readable folder labels: a parsed folder longer than a bare uuid is
         -- '{label}--{uuid}' (no second regex pass)
         case when p.seg1_uuid is not null and char_length(p.seg1) > 36 then left(p.seg1, -38) end as seg1_label,
         case when p.seg2_uuid is not null and char_length(p.seg2) > 36 then left(p.seg2, -38) end as seg2_label,
         case when p.seg3_uuid is not null and char_length(p.seg3) > 36 then left(p.seg3, -38) end as seg3_label,
         case
           when p.seg1 = '_internal' then 'relay-security-marker'
           when p.seg1 = 'blender-studio-internal' then 'studio-mesh'
           when p.seg1_uuid is not null and p.seg2 = 'stage-tmp' and p.nseg >= 3 then 'stage-temp'
           when p.seg1_uuid is not null and p.seg2 = 'studio-previews' and p.nseg >= 4 then 'studio-preview'
           when p.seg1_uuid is not null and p.seg2_uuid is not null and p.nseg >= 5
                and p.seg3 = 'series-migration' then 'show-import-copy'
           when p.seg1_uuid is not null and p.seg2_uuid is not null and p.nseg >= 5
                and p.seg3 in ('character','prop','location','shot','asset','locunit','cameo',
                               'storyboard','lookbook','other') then 'asset'
           else 'unknown'
         end as area
    from parsed p
  offset 0
),
cls2 as materialized (
  select c.path,
         c.created_at,
         c.bytes,
         c.mime,
         c.area,
         case
           when c.area in ('relay-security-marker','studio-mesh') then null
           else c.seg1_uuid
         end as uploader_id,
         case
           when c.area = 'studio-preview' then c.seg3_uuid
           when c.area in ('relay-security-marker','studio-mesh','stage-temp') then null
           else c.seg2_uuid
         end as project_id,
         case when c.area in ('asset','show-import-copy','unknown') then c.seg3 end as asset_folder,
         case
           when c.area in ('relay-security-marker','studio-mesh') then null
           else c.seg1_label
         end as account_label,
         case
           when c.area = 'studio-preview' then c.seg3_label
           when c.area in ('relay-security-marker','studio-mesh','stage-temp') then null
           else c.seg2_label
         end as project_label,
         case
           -- new layout: character/{charId}/states/{stateId}/{file} → "charId:stateId"
           when c.area = 'asset' and c.nseg >= 7 and c.seg5 = 'states'
                and nullif(c.seg4, '') is not null and nullif(c.seg6, '') is not null
             then c.seg4 || ':' || c.seg6
           when c.area in ('asset','show-import-copy','studio-preview') and c.nseg >= 5
             then nullif(c.seg4, '')
         end as path_entity,
         -- Blender relay PNG: {owner}/{pid}/shot/{job}/blender-preview-{job}.png
         (c.area = 'asset' and c.nseg = 5 and c.seg3 = 'shot'
          and c.file_name = 'blender-preview-' || c.seg4 || '.png') as is_relay_png
    from cls c
),
-- Safety net: nothing is ever marked safe to delete unless the reader sees every
-- row of every table consulted (row-level security would hide references).
viewer as (
  select not exists (
           select 1
             from pg_catalog.pg_class c
             join pg_catalog.pg_namespace s on s.oid = c.relnamespace
             join pg_catalog.pg_roles me on me.rolname = current_user
            where (s.nspname, c.relname) in (('auth','users'), ('storage','objects'), ('public','turn_projects'),
                                             ('public','turn_generations'), ('public','turn_cameos'),
                                             ('public','turn_asset_upload_intents'), ('public','turn_asset_cleanup_queue'),
                                             ('public','turn_credits'))
              and c.relrowsecurity
              and not (me.rolsuper or me.rolbypassrls
                       or (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
                           and not c.relforcerowsecurity))
         ) as sees_all
),
refs as materialized (
  select r.path, r.project_id, r.entity_id, r.ref_kind
    from turn_admin.referenced_paths r
),
ref_summary as (
  select r.path,
         string_agg(distinct r.ref_kind, ', ' order by r.ref_kind) as kinds,
         array_agg(distinct r.project_id order by r.project_id) as project_ids
    from refs r
   group by r.path
),
ref_best as (
  -- the one referencing row that names the file best: same project as its folder
  -- first, then the file as a current sheet, then history, cameo, ledgers, refs
  select distinct on (r.path) r.path, r.project_id, r.entity_id
    from refs r
    join cls2 c on c.path = r.path
   order by r.path,
            (r.project_id is not distinct from c.project_id) desc,
            case r.ref_kind
              when 'current' then 0 when 'history' then 1 when 'cameo-angle' then 2
              when 'cleanup-pending' then 3 when 'history-cleanup-pending' then 4
              when 'ref' then 5 else 6 end,
            r.entity_id
),
pre as (
  select c.*,
         rs.kinds as ref_kinds,
         rs.project_ids as referenced_by_project_ids,
         rb.project_id as ref_project_id,
         coalesce(rb.entity_id, c.path_entity) as entity_id,
         case
           when split_part(coalesce(rb.entity_id, c.path_entity), ':', 1) like 'charscale-%'
             then substr(split_part(coalesce(rb.entity_id, c.path_entity), ':', 1), 11)
           else split_part(coalesce(rb.entity_id, c.path_entity), ':', 1)
         end as base_entity
    from cls2 c
    left join ref_summary rs on rs.path = c.path
    left join ref_best rb on rb.path = c.path
),
-- Show-promotion copies get the same name on every try
-- ({uid}/{showId}/series-migration/{entity id}/{hash of the source path}.ext), and
-- a retry REUSES the copy already stored under that name whenever the Show has no
-- complete row for that entity yet (no row, or a row that records no file). Such a
-- copy is only superseded, and never reused, once the Show has a row for that exact
-- entity id that records a file in storage_path, refs, history or history refs
-- (the paths the app checks; cleanup ledgers do not count). Entity ids are compared
-- the way the app builds the folder name: characters outside [A-Za-z0-9_:-] become '_'.
promoted as (
  select distinct r.project_id,
         regexp_replace(r.entity_id, '[^A-Za-z0-9_:-]', '_', 'g') as entity_seg
    from refs r
   where r.ref_kind in ('current', 'ref', 'history', 'history-ref')
     and r.project_id in (select c.project_id from cls2 c where c.area = 'show-import-copy')
),
-- ── entity names: the project doc, its Show Bible, and (for an Episode) the
--    parent Show's Bible, because Episode docs drop characters/locations/props.
catalog_src as (
  select p.id as project_id, p.doc as d, 1 as prio
    from proj p
   where jsonb_typeof(p.doc) = 'object'
  union all
  select p.id, p.doc -> 'bible', 2
    from proj p
   where jsonb_typeof(p.doc -> 'bible') = 'object'
  union all
  select e.id, s.doc -> 'bible', 3
    from proj e
    join proj s on s.id = e.show_id
   where jsonb_typeof(s.doc -> 'bible') = 'object'
  union all
  select e.id, s.doc, 4
    from proj e
    join proj s on s.id = e.show_id
   where jsonb_typeof(s.doc) = 'object'
),
catalog_items as (
  select cs.project_id, cs.prio, k.ord,
         btrim(it.value ->> 'id') as entity_key,
         left(coalesce(
           nullif(btrim(it.value ->> 'name'), ''),
           nullif(btrim(it.value ->> 'title'), ''),
           nullif(btrim(it.value ->> 'label'), ''),
           case k.dept
             when 'lookbook' then coalesce(nullif(btrim(it.value ->> 'source'), ''),
                                           nullif(btrim(it.value ->> 'category'), ''))
             when 'shots' then 'Shot ' || coalesce(it.value ->> 'beatN', '?')
                               || ' of scene ' || coalesce(it.value ->> 'sceneId', '?')
           end,
           btrim(it.value ->> 'id')), 120) as entity_name
    from catalog_src cs
    cross join lateral (values ('characters',1), ('props',2), ('locations',3),
                               ('lookbook',4), ('shots',5)) as k(dept, ord)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cs.d -> k.dept) = 'array' then cs.d -> k.dept else '[]'::jsonb end
    ) it
   where jsonb_typeof(it.value) = 'object'
     and nullif(btrim(it.value ->> 'id'), '') is not null
  union all
  -- Recently deleted (restore bin): sheets of a deleted entity survive until purge
  select cs.project_id, cs.prio + 10, k.ord,
         btrim(it.value ->> 'id'),
         left(coalesce(nullif(btrim(it.value ->> 'name'), ''),
                       nullif(btrim(it.value ->> 'title'), ''),
                       btrim(it.value ->> 'id')), 100) || ' (in restore bin)'
    from catalog_src cs
    cross join lateral (values ('characters',1), ('props',2), ('locations',3),
                               ('shots',5)) as k(dept, ord)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cs.d -> 'trash' -> k.dept) = 'array'
           then cs.d -> 'trash' -> k.dept else '[]'::jsonb end
    ) it
   where jsonb_typeof(it.value) = 'object'
     and nullif(btrim(it.value ->> 'id'), '') is not null
  union all
  -- slugline units: entity id is 'locunit-' + slug(key, 48) + '-' + hash(key);
  -- the trailing '-' marks a prefix key
  select cs.project_id, cs.prio, 6,
         'locunit-' || left(regexp_replace(it.value ->> 'key', '[^a-z0-9-]+', '-', 'gi'), 48) || '-',
         left('Slugline unit ' || replace(it.value ->> 'key', '|', ' / '), 120)
    from catalog_src cs
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cs.d -> 'sluglineUnits') = 'array'
           then cs.d -> 'sluglineUnits' else '[]'::jsonb end
    ) it
   where jsonb_typeof(it.value) = 'object'
     and nullif(btrim(it.value ->> 'key'), '') is not null
),
catalog as (
  select distinct on (ci.project_id, ci.entity_key)
         ci.project_id, ci.entity_key, ci.entity_name
    from catalog_items ci
   order by ci.project_id, ci.entity_key, ci.prio, ci.ord
),
-- candidate catalog keys for each file, so the name lookup is an EQUALITY join (hashable)
-- instead of a per-project prefix scan: the exact id, plus for every '-' in it the prefix
-- before the dash (a location variant 'loc-x-0-cov1' → 'loc-x-0') and the prefix with the
-- dash (slugline-unit keys end in '-'). Same matches, same ranking as a prefix scan.
name_cands as (
  select f.path, f.ref_project_id, f.project_id, f.base_entity as cand, true as exact
    from pre f
   where f.base_entity is not null
  union all
  select f.path, f.ref_project_id, f.project_id, x.cand, false
    from pre f
    cross join lateral (
      select left(f.base_entity, g.i - 1) as cand
        from generate_series(2, length(f.base_entity)) g(i)
       where substr(f.base_entity, g.i, 1) = '-'
      union all
      select left(f.base_entity, g.i)
        from generate_series(2, length(f.base_entity) - 1) g(i)
       where substr(f.base_entity, g.i, 1) = '-'
    ) x
   where f.base_entity is not null
),
name_hits as (
  -- 0 = the referencing row's project, 1 = the file's folder project
  select nc.path, cat.entity_name, nc.exact, 0 as proj_rank, length(cat.entity_key) as klen
    from name_cands nc
    join catalog cat on cat.project_id = nc.ref_project_id and cat.entity_key = nc.cand
  union all
  select nc.path, cat.entity_name, nc.exact, 1, length(cat.entity_key)
    from name_cands nc
    join catalog cat on cat.project_id = nc.project_id and cat.entity_key = nc.cand
),
names as (
  select distinct on (h.path) h.path, h.entity_name
    from name_hits h
   order by h.path, h.exact desc, h.proj_rank, h.klen desc
),
classified as (
  select f.area,
         f.path,
         f.bytes,
         f.mime,
         f.created_at,
         uu.email as uploader_email,
         f.project_id,
         po.email as project_owner_email,
         case when f.project_id is null then null
              when p.id is null then '(deleted project)'
              else p.title end as project_title,
         p.project_kind,
         case when p.project_kind = 'show' then p.title
              when p.project_kind = 'episode' then s.title end as show_title,
         p.episode_no as episode,
         f.asset_folder,
         f.entity_id,
         n.entity_name,
         case
           when f.ref_kinds is not null then f.ref_kinds
           when f.area in ('relay-security-marker','studio-mesh','stage-temp','studio-preview')
                or f.is_relay_png then 'service'
           when (ui.path is not null and ui.expires_at > now())
                or f.created_at > now() - interval '1 hour' then 'uploading'
           when q.path is not null or ui.path is not null then 'queued-for-cleanup'
           when f.project_id is not null and p.id is null then 'orphan: project deleted'
           when f.area = 'show-import-copy' and pr.project_id is null then 'kept-for-promotion-retry'
           else 'unreferenced'
         end as status,
         f.referenced_by_project_ids,
         f.uploader_id,
         (f.project_id is not null and p.id is null) as project_gone,
         f.is_relay_png,
         f.account_label,
         f.project_label,
         -- display only: a readable label that differs from the stored name (an
         -- untitled project's 'untitled' folder is expected, not flagged)
         case
           when f.account_label is not null and sa.handle is not null and f.account_label <> sa.handle
             then 'account folder label differs from the account handle'
           when f.project_label is not null and f.project_label <> 'untitled'
                and p.storage_slug is not null and f.project_label <> p.storage_slug
             then 'project folder label differs from the project name'
         end as label_note
    from pre f
    left join names n on n.path = f.path
    left join auth.users uu on uu.id = f.uploader_id
    left join {{accounts}} sa on sa.user_id = f.uploader_id
    left join proj p on p.id = f.project_id
    left join auth.users po on po.id = p.owner
    left join proj s on s.id = p.show_id
    left join {{upload_intents}} ui on ui.path = f.path
    left join {{cleanup_queue}} q on q.path = f.path
    left join promoted pr on f.area = 'show-import-copy'
                         and pr.project_id = f.project_id and pr.entity_seg = f.path_entity
),
judged as (
  select c.*,
         case
           when not v.sees_all then null
           when c.area in ('asset','show-import-copy') and not c.is_relay_png
                and c.status = 'orphan: project deleted'
             then 'Its project was deleted and no generation, reference, history, cleanup ledger or cameo points at this file.'
           when c.area = 'show-import-copy' and c.status = 'unreferenced'
             then 'Superseded Show-promotion copy: no row points at it, and the Show already has a row for this entity that records other files, so a promotion retry will not reuse it.'
           when c.area = 'asset' and not c.is_relay_png and c.status = 'unreferenced'
             then 'Its project exists but no generation, reference, history, cleanup ledger or cameo points at this file; older than 1 hour; no upload in progress.'
           when c.area = 'stage-temp' and c.status = 'service'
                and c.created_at < now() - interval '2 hours'
             then 'Image-proxy temporary upload older than 2 hours (expired).'
           when c.area = 'studio-preview' and c.status = 'service' and c.project_gone
             then 'Blender Studio preview of a deleted project.'
         end as orphan_reason
    from classified c
   cross join viewer v
)
select j.area,
       j.path,
       j.bytes,
       j.mime,
       j.created_at,
       j.uploader_email,
       j.project_id,
       j.project_owner_email,
       j.project_title,
       j.project_kind,
       j.show_title,
       j.episode,
       j.asset_folder,
       j.entity_id,
       j.entity_name,
       j.status,
       (j.orphan_reason is not null) as safe_to_delete,
       j.orphan_reason,
       j.referenced_by_project_ids,
       j.uploader_id,
       j.account_label,
       j.project_label,
       j.label_note
  from judged j
$view$;
  v := replace(v, '{{proj}}', proj);
  v := replace(v, '{{upload_intents}}', case when has_intents then 'public.turn_asset_upload_intents'
         else '(select null::text as path, null::timestamptz as expires_at where false)' end);
  v := replace(v, '{{cleanup_queue}}', case when has_queue then 'public.turn_asset_cleanup_queue'
         else '(select null::text as path where false)' end);
  v := replace(v, '{{accounts}}', case when has_readable then 'public.turn_storage_accounts'
         else '(select null::uuid as user_id, null::text as handle where false)' end);
  if strpos(v, '{{') > 0 then
    raise exception 'TURN admin inventory: internal error, unfilled token in turn_admin.files. Nothing was created.';
  end if;
  execute v;

  -- ── 3. projects — one row per film / Show / Episode (also deleted ones that
  --       still have files, and live ones with no files) ────────────────────
  v := $view$
create or replace view turn_admin.projects with (security_invoker = true) as
with proj as not materialized (
  {{proj}}
),
fstats as (
  select f.project_id,
         count(*) as files,
         coalesce(sum(f.bytes), 0)::bigint as total_bytes,
         count(*) filter (where f.safe_to_delete) as orphan_files,
         string_agg(distinct f.uploader_email, ', ' order by f.uploader_email) as uploader_emails,
         max(f.created_at) as last_upload
    from turn_admin.files f
   where f.project_id is not null
   group by f.project_id
),
all_projects as (
  select p.id as project_id,
         ou.email as owner_email,
         p.title,
         p.project_kind as kind,
         case when p.project_kind = 'show' then p.title
              when p.project_kind = 'episode' then s.title end as show_title,
         p.episode_no as episode,
         p.storage_slug
    from proj p
    left join auth.users ou on ou.id = p.owner
    left join proj s on s.id = p.show_id
  union all
  select fs.project_id, null, '(deleted project)', null, null, null, null::text
    from fstats fs
   where not exists (select 1 from public.turn_projects p where p.id = fs.project_id)
)
select a.owner_email,
       a.title,
       a.kind,
       a.show_title,
       a.episode,
       a.project_id,
       coalesce(fs.files, 0) as files,
       pg_size_pretty(coalesce(fs.total_bytes, 0)) as total_size,
       coalesce(fs.total_bytes, 0) as total_bytes,
       coalesce(fs.orphan_files, 0) as orphan_files,
       fs.uploader_emails,
       fs.last_upload,
       a.storage_slug
  from all_projects a
  left join fstats fs on fs.project_id = a.project_id
 order by a.owner_email, a.title
$view$;
  v := replace(v, '{{proj}}', proj);
  if strpos(v, '{{') > 0 then
    raise exception 'TURN admin inventory: internal error, unfilled token in turn_admin.projects. Nothing was created.';
  end if;
  execute v;

  -- ── 4. users — one row per account (plus upload folders of deleted accounts)
  -- film_count counts every project row the account owns (film, Show or Episode).
  -- file_count / total_size count files in the account's own upload folder
  -- (folder 1), which can include files for films owned by someone else.
  v := $view$
create or replace view turn_admin.users with (security_invoker = true) as
with fstats as (
  select f.uploader_id,
         count(*) as files,
         coalesce(sum(f.bytes), 0)::bigint as total_bytes
    from turn_admin.files f
   where f.uploader_id is not null
   group by f.uploader_id
),
pstats as (
  select p.owner, count(*) as films
    from public.turn_projects p
   group by p.owner
)
select u.email,
       u.created_at,
       u.last_sign_in_at,
       c.plan,
       coalesce(ps.films, 0) as film_count,
       coalesce(fs.files, 0) as file_count,
       pg_size_pretty(coalesce(fs.total_bytes, 0)) as total_size,
       coalesce(fs.total_bytes, 0) as total_bytes,
       u.id as user_id,
       sa.handle as storage_handle
  from auth.users u
  left join {{credits}} c on c.owner = u.id
  left join {{accounts}} sa on sa.user_id = u.id
  left join pstats ps on ps.owner = u.id
  left join fstats fs on fs.uploader_id = u.id
union all
select '(deleted account)', null, null, null, 0,
       fs.files, pg_size_pretty(fs.total_bytes), fs.total_bytes, fs.uploader_id, null::text
  from fstats fs
 where not exists (select 1 from auth.users u where u.id = fs.uploader_id)
 order by 1, 9
$view$;
  v := replace(v, '{{credits}}', case when has_credits then 'public.turn_credits'
         else '(select null::uuid as owner, null::text as plan where false)' end);
  v := replace(v, '{{accounts}}', case when has_readable then 'public.turn_storage_accounts'
         else '(select null::uuid as user_id, null::text as handle where false)' end);
  if strpos(v, '{{') > 0 then
    raise exception 'TURN admin inventory: internal error, unfilled token in turn_admin.users. Nothing was created.';
  end if;
  execute v;
end;
$build$;

comment on view turn_admin.files is
  'One row per file in the turn-assets bucket with readable owner / project / entity names and a status. safe_to_delete mirrors turn_admin.orphans. Folders may be legacy ids or readable {label}--{id}; only the id decides, label_note flags a label that differs from the stored name.';
comment on view turn_admin.projects is
  'Per project: owner, kind, Show / Episode, file count and size (by the project id in the file path), safe-to-delete count, uploaders, last upload.';
comment on view turn_admin.users is
  'Per account: email, sign-up and last sign-in, plan, projects owned, files in their upload folder and total size.';


-- ── 5. orphans — ONLY files that are safe to delete ─────────────────────────
-- Included: 'orphan: project deleted' and 'unreferenced' film assets, Show-promotion
-- copies whose Show is gone or that a newer Show row superseded, image-proxy temp
-- files older than 2 h, and Blender Studio previews whose project is gone. Never:
-- relay security markers, studio meshes, the Blender relay shot PNG, anything
-- 'uploading', 'queued-for-cleanup' or 'kept-for-promotion-retry', anything
-- referenced, or anything whose layout is unknown.
create or replace view turn_admin.orphans with (security_invoker = true) as
select f.orphan_reason as reason,
       f.path,
       f.bytes,
       pg_size_pretty(coalesce(f.bytes, 0)) as size,
       f.area,
       f.status,
       f.created_at,
       f.uploader_email,
       f.project_id,
       f.project_title,
       f.project_owner_email,
       f.asset_folder,
       f.entity_id,
       f.entity_name
  from turn_admin.files f
 where f.safe_to_delete
 order by f.uploader_email, f.project_id, f.path;

comment on view turn_admin.orphans is
  'Files that are safe to delete, each with a reason. Delete exact paths only (Storage API / Dashboard), never whole user folders.';


-- ── 6. external_media — video takes that live on the provider CDN ───────────
-- Stage clip rows (turn_generations, entity_id 'clip-…', meta.kind = 'video')
-- store provider URLs (fal CDN), not files in this bucket. Deleting a film
-- removes the rows but does NOT free that media; it sits with the provider.
-- Only the URL host is shown — never the prompt or other take metadata.
create or replace view turn_admin.external_media with (security_invoker = true) as
with vids as (
  select g.project_id, g.owner, g.entity_id, g.updated_at, g.meta
    from public.turn_generations g
   where g.meta ->> 'kind' = 'video' or g.entity_id like 'clip-%'
),
urls as (
  select v.project_id, v.owner, v.entity_id, v.updated_at,
         'current take'::text as take,
         v.meta -> 'video' ->> 'url' as url,
         v.meta -> 'video' -> 'meta' ->> 'createdAt' as created_raw
    from vids v
  union all
  select v.project_id, v.owner, v.entity_id, v.updated_at,
         'older take',
         t.value ->> 'url',
         coalesce(t.value ->> 'savedAt', t.value -> 'meta' ->> 'createdAt')
    from vids v
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v.meta -> 'video' -> 'meta' -> 'takes') = 'array'
           then v.meta -> 'video' -> 'meta' -> 'takes' else '[]'::jsonb end
    ) t
),
hosts as (
  select u.*,
         lower(substring(u.url from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)')) as url_host
    from urls u
   where u.url ~* '^https?://'
)
select coalesce(p.title, '(deleted project)') as project_title,
       ou.email as owner_email,
       h.entity_id,
       h.take,
       h.url_host,
       case when h.created_raw ~ '^[0-9]{12,13}$'
            then to_timestamp(h.created_raw::bigint / 1000.0)
            else h.updated_at end as created_at,
       su.email as saved_by_email,
       h.project_id
  from hosts h
  left join public.turn_projects p on p.id = h.project_id
  left join auth.users ou on ou.id = p.owner
  left join auth.users su on su.id = h.owner
 where h.url_host is not null
   and h.url_host !~ '(^|\.)supabase\.(co|in)$'
 order by owner_email, project_title, h.entity_id, created_at;

comment on view turn_admin.external_media is
  'Stage video takes stored as external provider URLs (fal CDN). Deleting a film does not free them.';


-- ── Lock it down: only postgres (SQL Editor) can read ───────────────────────
revoke all on all tables in schema turn_admin from public;
revoke all on all tables in schema turn_admin from anon, authenticated, service_role;

commit;


-- ── RESULT — the table the SQL Editor shows after Run ───────────────────────
-- The editor displays the result of the LAST statement, so this comes last: one
-- row per check and per TURN feature, then the counts. Rows should read 'ok' or
-- 'installed', or 'not installed — …' for an optional feature (the views adapt).
-- It can also be run on its own later, to see the counts again.
with need(schema_name, table_name, column_name, feature, source) as (values
  ('auth', 'users', 'id', 'core', 'Supabase Auth'),
  ('auth', 'users', 'email', 'core', 'Supabase Auth'),
  ('auth', 'users', 'created_at', 'core', 'Supabase Auth'),
  ('auth', 'users', 'last_sign_in_at', 'core', 'Supabase Auth'),
  ('storage', 'objects', 'bucket_id', 'core', 'Supabase Storage'),
  ('storage', 'objects', 'name', 'core', 'Supabase Storage'),
  ('storage', 'objects', 'metadata', 'core', 'Supabase Storage'),
  ('storage', 'objects', 'created_at', 'core', 'Supabase Storage'),
  ('public', 'turn_projects', 'id', 'core', 'schema.sql'),
  ('public', 'turn_projects', 'owner', 'core', 'schema.sql'),
  ('public', 'turn_projects', 'title', 'core', 'schema.sql'),
  ('public', 'turn_projects', 'doc', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'project_id', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'owner', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'entity_id', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'storage_path', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'meta', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'refs', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'history', 'core', 'schema.sql'),
  ('public', 'turn_generations', 'updated_at', 'core', 'schema.sql'),
  ('public', 'turn_cameos', 'project_id', 'cameos', 'cameos.sql'),
  ('public', 'turn_cameos', 'char_id', 'cameos', 'cameos.sql'),
  ('public', 'turn_cameos', 'angles', 'cameos', 'cameos.sql'),
  ('public', 'turn_projects', 'project_kind', 'series', 'series-production.sql'),
  ('public', 'turn_projects', 'show_id', 'series', 'series-production.sql'),
  ('public', 'turn_projects', 'episode_no', 'series', 'series-production.sql'),
  ('public', 'turn_asset_upload_intents', 'path', 'intents', 'series-production.sql'),
  ('public', 'turn_asset_upload_intents', 'expires_at', 'intents', 'series-production.sql'),
  ('public', 'turn_asset_cleanup_queue', 'path', 'queue', 'series-production.sql'),
  ('public', 'turn_credits', 'owner', 'credits', 'credits.sql'),
  ('public', 'turn_credits', 'plan', 'credits', 'credits.sql'),
  ('public', 'turn_storage_accounts', 'user_id', 'readable', 'storage-readable-folders.sql'),
  ('public', 'turn_storage_accounts', 'handle', 'readable', 'storage-readable-folders.sql'),
  ('public', 'turn_projects', 'storage_slug', 'readable', 'storage-readable-folders.sql')
),
have as (
  select n.*,
         exists (
           select 1
             from pg_catalog.pg_attribute a
             join pg_catalog.pg_class c on c.oid = a.attrelid
             join pg_catalog.pg_namespace s on s.oid = c.relnamespace
            where s.nspname = n.schema_name and c.relname = n.table_name
              and a.attname = n.column_name and a.attnum > 0 and not a.attisdropped
         ) as present,
         exists (
           select 1
             from pg_catalog.pg_class c
             join pg_catalog.pg_namespace s on s.oid = c.relnamespace
            where s.nspname = n.schema_name and c.relname = n.table_name
         ) as table_present
    from need n
),
feat as (
  select h.feature,
         case
           when bool_and(h.present) then 'installed'
           when h.feature in ('core', 'cameos') then 'FAIL — missing '
                || string_agg(h.table_name || '.' || h.column_name, ', ' order by h.column_name) filter (where not h.present)
                || ' (run ' || min(h.source) || ')'
           when h.feature in ('series', 'readable') and not bool_or(h.present) then 'absent'
           when h.feature not in ('series', 'readable') and not bool_or(h.table_present) then 'absent'
           else 'FAIL — half-installed, missing '
                || string_agg(h.table_name || '.' || h.column_name, ', ' order by h.column_name) filter (where not h.present)
         end as state
    from have h
   group by h.feature
),
roles_locked_out as (
  -- PUBLIC (grantee 0) and the three API roles the file revokes
  select 0::oid as grantee
  union all
  select r.oid from pg_catalog.pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
),
-- Readable storage folders need the CURRENT storage key helpers, upload rules and
-- series-production functions. A copy of team-collaboration / enforce-role-scopes /
-- series-production.sql from before 2026-09-27 (or a storage.sql re-run) puts back
-- the id-only versions, and every file under a readable folder disappears from the
-- app. Checked from the catalog only (nothing is called), so this runs anywhere.
readable_health as (
  select nullif(concat_ws('; ',
           case when to_regprocedure('public.turn_storage_segment_id(text)') is null
                  or to_regprocedure('public.turn_storage_uid(text)') is null
                then 'turn_storage_segment_id / turn_storage_uid missing' end,
           case when coalesce((select p.prosrc from pg_catalog.pg_proc p
                                where p.oid = to_regprocedure('public.turn_storage_project_id(text)')), '')
                     not like '%turn_storage_segment_id(%'
                then 'turn_storage_project_id reads bare ids only' end,
           case when not exists (select 1 from pg_catalog.pg_policies pl
                                  where pl.schemaname = 'storage' and pl.tablename = 'objects'
                                    and pl.policyname = 'turn assets write collab' and pl.cmd = 'INSERT'
                                    and coalesce(pl.with_check, '') like '%turn_storage_uid(name)%')
                  or not exists (select 1 from pg_catalog.pg_policies pl
                                  where pl.schemaname = 'storage' and pl.tablename = 'objects'
                                    and pl.policyname = 'turn assets update collab' and pl.cmd = 'UPDATE'
                                    and coalesce(pl.qual, '') like '%turn_storage_uid(name)%')
                then 'the upload rules do not read folder 1 through turn_storage_uid' end,
           case when exists (select 1 from pg_catalog.pg_policies pl
                              where pl.schemaname = 'storage' and pl.tablename = 'objects'
                                and coalesce(pl.qual, '') || coalesce(pl.with_check, '') like '%turn-assets%'
                                and coalesce(pl.qual, '') || coalesce(pl.with_check, '') like '%foldername(name))[1]%')
                then 'a turn-assets rule still compares folder 1 as text' end,
           case when coalesce((select p.prosrc from pg_catalog.pg_proc p
                                where p.oid = to_regprocedure('public.turn_begin_asset_upload(uuid,text)')), '')
                     not like '%turn_storage_uid(%'
                  or coalesce((select p.prosrc from pg_catalog.pg_proc p
                                where p.oid = to_regprocedure('public.turn_can_delete_asset_path(text)')), '')
                     not like '%turn_storage_uid(%'
                then 'turn_begin_asset_upload / turn_can_delete_asset_path compare folder 1 as text' end
         ), '') as problems
),
fl as materialized (
  select f.bytes, f.safe_to_delete, f.uploader_id from turn_admin.files f
),
pk as materialized (
  select p.kind from turn_admin.projects p
)
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'turn_admin views (read-only)' as item,
           case when count(*) = 6 then 'installed'
                else 'FAIL — ' || count(*) || ' of 6 views; run the whole file' end as status,
           string_agg(v.viewname, ', ' order by v.viewname) as detail
      from pg_catalog.pg_views v
     where v.schemaname = 'turn_admin'
    union all
    select 20, 'Only postgres (the SQL Editor) can read turn_admin',
           case when exists (
                  select 1 from pg_catalog.pg_namespace n
                   cross join lateral aclexplode(n.nspacl) a
                   where n.nspname = 'turn_admin'
                     and a.grantee in (select g.grantee from roles_locked_out g)
                  union all
                  select 1 from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   cross join lateral aclexplode(c.relacl) a
                   where n.nspname = 'turn_admin'
                     and a.grantee in (select g.grantee from roles_locked_out g))
                then 'FAIL — anon / authenticated / service_role / public still have access; re-run the whole file'
                else 'ok' end,
           'no access for anon, authenticated, service_role or public'
    union all
    select 30, 'turn_admin kept out of the Data API',
           case when exists (
                  select 1 from pg_catalog.pg_roles r
                   cross join lateral unnest(coalesce(r.rolconfig, array[]::text[])) cfg
                   where r.rolname = 'authenticator'
                     and cfg ilike 'pgrst.db_schemas=%'
                     and cfg ~* '(^|[=,[:space:]"])turn_admin($|[,[:space:]"])')
                then 'FAIL — remove turn_admin from Data API → Exposed schemas'
                else 'ok' end,
           'also confirm by eye: Project Settings → Data API → Exposed schemas must not list turn_admin'
    union all
    select 40, 'Reader sees every row (row-level security safety net)',
           case when exists (
                  select 1
                    from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace s on s.oid = c.relnamespace
                    join pg_catalog.pg_roles me on me.rolname = current_user
                   where (s.nspname, c.relname) in (('auth','users'), ('storage','objects'), ('public','turn_projects'),
                           ('public','turn_generations'), ('public','turn_cameos'),
                           ('public','turn_asset_upload_intents'), ('public','turn_asset_cleanup_queue'),
                           ('public','turn_credits'))
                     and c.relrowsecurity
                     and not (me.rolsuper or me.rolbypassrls
                              or (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
                                  and not c.relforcerowsecurity)))
                then 'FAIL — nothing is marked safe to delete for this role; run as postgres'
                else 'ok' end,
           'role ' || current_user
    union all
    select 50, 'Postgres 15 or newer',
           case when current_setting('server_version_num')::int >= 150000 then 'ok'
                else 'FAIL — needs Postgres 15 (security_invoker views)' end,
           'Postgres ' || current_setting('server_version')
    union all
    select 60, 'Core tables (schema.sql, Supabase Auth and Storage)',
           case when f.state = 'installed' then 'ok' else f.state end,
           'turn_projects, turn_generations, auth.users, storage.objects'
      from feat f where f.feature = 'core'
    union all
    select 70, 'Bucket turn-assets',
           case when exists (select 1 from storage.buckets b where b.id = 'turn-assets') then 'ok'
                else 'FAIL — the private bucket turn-assets does not exist' end,
           'private bucket that holds every TURN file'
    union all
    select 80, 'Shows & episodes migration (series-production.sql)',
           case f.state when 'absent' then 'not installed — Shows/episodes read from the document markers' else f.state end,
           case f.state when 'installed' then 'Show / Episode from turn_projects.project_kind, show_id, episode_no'
                        when 'absent' then 'a Show has doc.isShow; an Episode has a doc.showId naming a Show (number: doc.episodeNo); any other doc.showId leaves a film'
                        else 'finish series-production.sql, then re-run this file' end
      from feat f where f.feature = 'series'
    union all
    select 90, 'Upload reservations (turn_asset_upload_intents)',
           case f.state when 'absent' then 'not installed — only files under 1 hour old count as uploading' else f.state end,
           case f.state when 'installed' then 'a live reservation marks a file uploading, an expired one queued-for-cleanup'
                        when 'absent' then 'part of series-production.sql'
                        else 'finish series-production.sql, then re-run this file' end
      from feat f where f.feature = 'intents'
    union all
    select 100, 'Cleanup queue (turn_asset_cleanup_queue)',
           case f.state when 'absent' then 'not installed — no file is marked queued-for-cleanup' else f.state end,
           case f.state when 'installed' then 'queued files are never listed as orphans'
                        when 'absent' then 'part of series-production.sql'
                        else 'finish series-production.sql, then re-run this file' end
      from feat f where f.feature = 'queue'
    union all
    select 110, 'Cameos (cameos.sql)',
           f.state,
           'cameo angle files count as referenced'
      from feat f where f.feature = 'cameos'
    union all
    select 120, 'Credits (credits.sql)',
           case f.state when 'absent' then 'not installed — plan is left empty in turn_admin.users' else f.state end,
           case f.state when 'installed' then 'plan shown in turn_admin.users'
                        when 'absent' then 'turn_credits is not in this database'
                        else 'finish credits.sql, then re-run this file' end
      from feat f where f.feature = 'credits'
    union all
    select 125, 'Readable storage folders (storage-readable-folders.sql)',
           case f.state when 'absent' then 'not installed — folder labels are shown but not compared' else f.state end,
           case f.state when 'installed' then 'storage_handle, storage_slug and label_note filled from the stored names'
                        when 'absent' then 'readable keys are parsed either way; label_note stays empty'
                        else 'finish storage-readable-folders.sql, then re-run this file' end
      from feat f where f.feature = 'readable'
    union all
    select 126, 'Readable storage folders: access helpers and rules are current',
           case when f.state <> 'installed' then 'not installed — nothing to check'
                when h.problems is null then 'ok'
                else 'FAIL — ' || h.problems end,
           case when f.state <> 'installed' then 'storage-readable-folders.sql has not run here'
                when h.problems is null then 'files under readable name--id folders are readable, writable and deletable'
                else 'an out-of-date team-collaboration / enforce-role-scopes / series-production.sql (or storage.sql) '
                     || 'was re-run after storage-readable-folders.sql, so files under readable folders are hidden '
                     || 'from everyone and new uploads fall back to bare-id folders. Re-run the current '
                     || 'storage-readable-folders.sql (safe to re-run; it restores all of it), then run this again' end
      from feat f cross join readable_health h where f.feature = 'readable'
    union all
    select 130, 'Files in turn-assets',
           count(*)::text,
           pg_size_pretty(coalesce(sum(fl.bytes), 0)::bigint) || ' in total'
      from fl
    union all
    select 140, 'Projects',
           count(*) filter (where pk.kind is not null)::text,
           'films ' || count(*) filter (where pk.kind = 'film')
           || ' · Shows ' || count(*) filter (where pk.kind = 'show')
           || ' · Episodes ' || count(*) filter (where pk.kind = 'episode')
           || case when count(*) filter (where pk.kind is null) > 0
                   then ' · deleted projects that still have files ' || count(*) filter (where pk.kind is null)
                   else '' end
      from pk
    union all
    select 150, 'User accounts',
           (select count(*) from auth.users)::text,
           'upload folders of deleted accounts '
           || (select count(distinct fl.uploader_id) from fl
                where fl.uploader_id is not null
                  and not exists (select 1 from auth.users u where u.id = fl.uploader_id))
    union all
    select 160, 'Orphans (safe to delete)',
           count(*) filter (where fl.safe_to_delete)::text,
           pg_size_pretty(coalesce(sum(fl.bytes) filter (where fl.safe_to_delete), 0)::bigint)
           || ' — list them with: select * from turn_admin.orphans'
      from fl
  ) r
 order by r.ord;


-- ============================================================================
-- SAVED QUERIES — copy one into a new SQL Editor tab (or save it as a snippet)
-- They read only the turn_admin views, so they work on every TURN database.
-- ============================================================================

-- ── Storage map: who owns each folder you see in the Dashboard ─────────────
-- One row per <user_folder>/<project_folder> as Storage → turn-assets shows
-- them (legacy '{id}' and readable '{name}--{id}' folders of one account are two
-- rows), with the account's email (or '(deleted account)') and the project's
-- title. delete_folder says 'YES' only for a deleted project's folder whose
-- every file is safe; a deleted account's user folder can go whole once each
-- of its rows says YES. Keep _internal and anything that says 'no'.
-- select split_part(f.path, '/', 1) as user_folder,
--        case split_part(f.path, '/', 1)
--          when '_internal' then '(service files: keep)'
--          when 'blender-studio-internal' then '(service files: keep)'
--          else coalesce(max(f.uploader_email), '(deleted account)') end as whose,
--        split_part(f.path, '/', 2) as project_folder,
--        case split_part(f.path, '/', 2)
--          when 'stage-tmp' then '(temporary image files)'
--          when 'studio-previews' then '(Blender previews)'
--          else coalesce(max(f.project_title), '(not a project)') end as project,
--        max(f.project_owner_email) as project_owner,
--        count(*) as files,
--        pg_size_pretty(sum(coalesce(f.bytes, 0))) as size,
--        case when bool_and(f.safe_to_delete) and bool_and(f.status = 'orphan: project deleted')
--               then 'YES: delete this project folder'
--             when bool_or(f.safe_to_delete) then 'some files: see turn_admin.orphans'
--             else 'no: in use' end as delete_folder
--   from turn_admin.files f
--  group by 1, 3
--  order by 2, 4;

-- ── Storage by project ──────────────────────────────────────────────────────
-- select owner_email, title, kind, show_title, episode, files, total_size,
--        orphan_files, uploader_emails, last_upload, project_id
--   from turn_admin.projects
--  order by total_bytes desc;

-- ── Storage by user ─────────────────────────────────────────────────────────
-- select email, plan, film_count, file_count, total_size, created_at, last_sign_in_at
--   from turn_admin.users
--  order by total_bytes desc;

-- ── Film detail (paste one project id) ──────────────────────────────────────
-- Files stored under the film's folder PLUS files it references elsewhere (a
-- Show's shared sheets can live under Episode 1's folder).
-- with target as (select '00000000-0000-0000-0000-000000000000'::uuid as id)
-- select f.asset_folder, f.entity_name, f.entity_id, f.status, f.safe_to_delete,
--        pg_size_pretty(coalesce(f.bytes, 0)) as size, f.mime, f.uploader_email,
--        f.created_at, f.path
--   from turn_admin.files f, target t
--  where f.project_id = t.id
--     or f.path in (select r.path from turn_admin.referenced_paths r where r.project_id = t.id)
--  order by f.asset_folder, f.entity_name, f.created_at;

-- ── Orphans (safe to delete) ────────────────────────────────────────────────
-- !! DO NOT DELETE WHOLE USER FOLDERS. One user folder holds files for many films,
-- !! including films owned by other people, relay/service files and uploads in
-- !! progress. Delete ONLY the exact paths listed here, and re-run this query right
-- !! before deleting: the list is a snapshot. Show-promotion copies are the one kind
-- !! of file the app points at again by name (a promotion retry reuses the copy), so
-- !! copies are listed only once the Show has a newer row for that entity; a copy of
-- !! an interrupted promotion shows as 'kept-for-promotion-retry' in files instead.
-- !! Delete through the Storage API or Dashboard (Storage → turn-assets), never with
-- !! `delete from storage.objects` — that removes the row but not the stored bytes.
-- select reason, size, path, uploader_email, project_title, entity_name, created_at
--   from turn_admin.orphans
--  order by bytes desc nulls last;

-- ── Whole folders of DELETED projects that are safe to delete ───────────────
-- Lists a <user_folder>/<project_folder> only when that project was DELETED and
-- EVERY file inside is safe, so the folder can go in one step in the Dashboard:
-- Storage → turn-assets → <user_folder> → select <project_folder> → Delete.
-- A folder delete removes whatever is in the folder at that moment, not the rows
-- this query listed. That is why a LIVE project's folder is never listed, even
-- when every file in it is unreferenced right now: a collaborator could upload and
-- record a new sheet there between this query and the delete. A deleted project
-- cannot get new rows (foreign key), and the app records each file in a row of the
-- project whose folder holds it, so nothing can start pointing into its folder.
-- For a live project, delete the exact paths from turn_admin.orphans instead.
-- A folder with even one referenced, service or in-progress file is not listed.
-- Run it in a new SQL Editor tab once this file has installed.
-- select split_part(f.path, '/', 1) as user_folder, max(f.uploader_email) as uploader_email,
--        split_part(f.path, '/', 2) as project_folder, max(f.project_title) as project,
--        count(*) as files, pg_size_pretty(sum(coalesce(f.bytes, 0))) as size
--   from turn_admin.files f
--  where f.project_id is not null and split_part(f.path, '/', 2) <> 'studio-previews'
--  group by 1, 3
-- having bool_and(f.safe_to_delete)
--    and bool_and(f.status = 'orphan: project deleted')
--  order by 1, 3;

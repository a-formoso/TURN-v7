-- ============================================================================
-- TURN — Admin storage inventory  (READ-ONLY views for the platform owner)
--
-- PURPOSE
--   Storage keys are ids, not names: {uploader_id}/{project_id}/{folder}/{entity}/...
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
--   (Optional first: select just the PREFLIGHT REPORT query below and Run it alone;
--   the editor runs only the selection and shows a table of checks.)
--   Safe to re-run: `create schema if not exists` + `create or replace view`.
--   If a check fails, the PREFLIGHT GUARD stops the run before anything is created.
--
-- WHAT IT DOES NOT DO
--   No triggers, no policies, no grants, no functions, nothing that writes. It only
--   creates the schema turn_admin and six views in it, then REVOKES access so that
--   only postgres (the SQL Editor) can read them. The views run with the caller's
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
--   'uploading'               a live upload reservation exists, or the file is < 1 h old
--                             (uploads land in Storage before their database row).
--   'queued-for-cleanup'      already in turn_asset_cleanup_queue, or its upload
--                             reservation expired (the app promotes those to the queue).
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
--   * folder 2 is the project id (studio previews: folder 3).
--   * '_internal/…' (relay security markers) and 'blender-studio-internal/…' (studio
--     meshes) are never orphans; neither is anything 'uploading' or referenced.
--   * Show-promotion copies ('series-migration/…') have fixed names that a retry
--     reuses; a copy the next retry could still adopt is never listed as safe.
--   * The views run with the reader's rights (security_invoker). If the reader
--     cannot see every row (row-level security), nothing is marked safe to delete;
--     the preflight refuses to install for such a role.
--   * Non-uuid folders are parsed with a regex check before ::uuid, so they never
--     raise; files whose layout is not recognised get area 'unknown' and are never
--     listed as safe to delete — review those by hand.
-- ============================================================================


-- ── PREFLIGHT REPORT (read-only) ────────────────────────────────────────────
-- Select from "with need" down to the first ";" and Run to see every check.
-- Every row should say ok = true. Running the whole file is also fine: the
-- PREFLIGHT GUARD below repeats the same checks and aborts on the first problem.
with need(schema_name, table_name, column_name) as (values
  ('auth','users','id'), ('auth','users','email'),
  ('auth','users','created_at'), ('auth','users','last_sign_in_at'),
  ('storage','objects','bucket_id'), ('storage','objects','name'),
  ('storage','objects','metadata'), ('storage','objects','created_at'),
  ('public','turn_projects','id'), ('public','turn_projects','owner'),
  ('public','turn_projects','title'), ('public','turn_projects','doc'),
  ('public','turn_projects','project_kind'), ('public','turn_projects','show_id'),
  ('public','turn_projects','episode_no'),
  ('public','turn_generations','project_id'), ('public','turn_generations','owner'),
  ('public','turn_generations','entity_id'), ('public','turn_generations','storage_path'),
  ('public','turn_generations','meta'), ('public','turn_generations','refs'),
  ('public','turn_generations','history'), ('public','turn_generations','updated_at'),
  ('public','turn_cameos','project_id'), ('public','turn_cameos','char_id'),
  ('public','turn_cameos','angles'),
  ('public','turn_asset_upload_intents','path'), ('public','turn_asset_upload_intents','expires_at'),
  ('public','turn_asset_cleanup_queue','path'),
  ('public','turn_credits','owner'), ('public','turn_credits','plan')
)
select 'column ' || n.schema_name || '.' || n.table_name || '.' || n.column_name as check_name,
       exists (
         select 1
           from pg_catalog.pg_attribute a
           join pg_catalog.pg_class c on c.oid = a.attrelid
           join pg_catalog.pg_namespace s on s.oid = c.relnamespace
          where s.nspname = n.schema_name and c.relname = n.table_name
            and a.attname = n.column_name and a.attnum > 0 and not a.attisdropped
       ) as ok
  from need n
union all
select 'turn_admin is NOT in the in-database PostgREST schemas (authenticator pgrst.db_schemas) — also check Dashboard → Data API by eye',
       not exists (
         select 1 from pg_catalog.pg_roles r
          cross join lateral unnest(coalesce(r.rolconfig, array[]::text[])) cfg
          where r.rolname = 'authenticator'
            and cfg ilike 'pgrst.db_schemas=%'
            and cfg ~* '(^|[=,[:space:]"])turn_admin($|[,[:space:]"])'
       )
union all
select 'bucket turn-assets exists',
       exists (select 1 from storage.buckets b where b.id = 'turn-assets')
union all
select 'Postgres 15 or newer (security_invoker views)',
       current_setting('server_version_num')::int >= 150000
union all
select 'current role sees every row of the tables read (superuser, BYPASSRLS, or owner without FORCE RLS)',
       not exists (
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
       )
order by 2, 1;
-- Also confirm by eye: Dashboard → Project Settings → Data API → Exposed schemas
-- must NOT contain turn_admin. (Even if it did, the revokes below keep anon and
-- authenticated out — but never expose it.)


begin;

-- ── PREFLIGHT GUARD (read-only; aborts the run before anything is created) ──
do $preflight$
declare
  missing text[] := array[]::text[];
  need record;
begin
  for need in
    select * from (values
      ('auth','users','id'), ('auth','users','email'),
      ('auth','users','created_at'), ('auth','users','last_sign_in_at'),
      ('storage','objects','bucket_id'), ('storage','objects','name'),
      ('storage','objects','metadata'), ('storage','objects','created_at'),
      ('public','turn_projects','id'), ('public','turn_projects','owner'),
      ('public','turn_projects','title'), ('public','turn_projects','doc'),
      ('public','turn_projects','project_kind'), ('public','turn_projects','show_id'),
      ('public','turn_projects','episode_no'),
      ('public','turn_generations','project_id'), ('public','turn_generations','owner'),
      ('public','turn_generations','entity_id'), ('public','turn_generations','storage_path'),
      ('public','turn_generations','meta'), ('public','turn_generations','refs'),
      ('public','turn_generations','history'), ('public','turn_generations','updated_at'),
      ('public','turn_cameos','project_id'), ('public','turn_cameos','char_id'),
      ('public','turn_cameos','angles'),
      ('public','turn_asset_upload_intents','path'), ('public','turn_asset_upload_intents','expires_at'),
      ('public','turn_asset_cleanup_queue','path'),
      ('public','turn_credits','owner'), ('public','turn_credits','plan')
    ) v(schema_name, table_name, column_name)
  loop
    if not exists (
      select 1
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace s on s.oid = c.relnamespace
       where s.nspname = need.schema_name and c.relname = need.table_name
         and a.attname = need.column_name and a.attnum > 0 and not a.attisdropped
    ) then
      missing := missing || (need.schema_name || '.' || need.table_name || '.' || need.column_name);
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception 'TURN admin inventory preflight: missing % — run the TURN migrations first (schema.sql, series-production.sql, cameos.sql, credits.sql). Nothing was created.',
      array_to_string(missing, ', ');
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


-- ── 2. files — one row per file in the turn-assets bucket ───────────────────
create or replace view turn_admin.files with (security_invoker = true) as
-- Speed. Postgres inlines a CTE that is used once and copies its expressions into
-- every place the next step uses them; unfenced, the uuid regexes and
-- string_to_array ran dozens of times per file. Each parsing step below ends in
-- OFFSET 0, which keeps it a separate step that computes each column once per
-- file without writing it to a temp file, and `cls2` (used several times) is
-- MATERIALIZED with scalars only: the metadata jsonb and the segment array are
-- not carried past `parsed`.
with split as (
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
         case when s.seg[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s.seg[1]::uuid end as seg1_uuid,
         case when s.seg[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s.seg[2]::uuid end as seg2_uuid,
         case when s.seg[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s.seg[3]::uuid end as seg3_uuid
    from split s
  offset 0
),
cls as (
  select p.*,
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
    from public.turn_projects p
   where jsonb_typeof(p.doc) = 'object'
  union all
  select p.id, p.doc -> 'bible', 2
    from public.turn_projects p
   where jsonb_typeof(p.doc -> 'bible') = 'object'
  union all
  select e.id, s.doc -> 'bible', 3
    from public.turn_projects e
    join public.turn_projects s on s.id = e.show_id
   where jsonb_typeof(s.doc -> 'bible') = 'object'
  union all
  select e.id, s.doc, 4
    from public.turn_projects e
    join public.turn_projects s on s.id = e.show_id
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
         f.is_relay_png
    from pre f
    left join names n on n.path = f.path
    left join auth.users uu on uu.id = f.uploader_id
    left join public.turn_projects p on p.id = f.project_id
    left join auth.users po on po.id = p.owner
    left join public.turn_projects s on s.id = p.show_id
    left join public.turn_asset_upload_intents ui on ui.path = f.path
    left join public.turn_asset_cleanup_queue q on q.path = f.path
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
       j.uploader_id
  from judged j;

comment on view turn_admin.files is
  'One row per file in the turn-assets bucket with readable owner / project / entity names and a status. safe_to_delete mirrors turn_admin.orphans.';


-- ── 3. orphans — ONLY files that are safe to delete ─────────────────────────
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


-- ── 4. projects — one row per film / Show / Episode (also deleted ones that
--       still have files, and live ones with no files) ──────────────────────
create or replace view turn_admin.projects with (security_invoker = true) as
with fstats as (
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
         p.episode_no as episode
    from public.turn_projects p
    left join auth.users ou on ou.id = p.owner
    left join public.turn_projects s on s.id = p.show_id
  union all
  select fs.project_id, null, '(deleted project)', null, null, null
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
       fs.last_upload
  from all_projects a
  left join fstats fs on fs.project_id = a.project_id
 order by a.owner_email, a.title;

comment on view turn_admin.projects is
  'Per project: owner, kind, Show / Episode, file count and size (by the project id in the file path), safe-to-delete count, uploaders, last upload.';


-- ── 5. users — one row per account (plus upload folders of deleted accounts) ─
-- film_count counts every project row the account owns (film, Show or Episode).
-- file_count / total_size count files in the account's own upload folder
-- (folder 1), which can include files for films owned by someone else.
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
       u.id as user_id
  from auth.users u
  left join public.turn_credits c on c.owner = u.id
  left join pstats ps on ps.owner = u.id
  left join fstats fs on fs.uploader_id = u.id
union all
select '(deleted account)', null, null, null, 0,
       fs.files, pg_size_pretty(fs.total_bytes), fs.total_bytes, fs.uploader_id
  from fstats fs
 where not exists (select 1 from auth.users u where u.id = fs.uploader_id)
 order by 1, 9;

comment on view turn_admin.users is
  'Per account: email, sign-up and last sign-in, plan, projects owned, files in their upload folder and total size.';


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

-- Result shown by the SQL Editor after a full run:
select 'turn_admin installed' as result,
       count(*) as views,
       string_agg(viewname, ', ' order by viewname) as view_names
  from pg_catalog.pg_views
 where schemaname = 'turn_admin';


-- ============================================================================
-- SAVED QUERIES — copy one into a new SQL Editor tab (or save it as a snippet)
-- ============================================================================

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

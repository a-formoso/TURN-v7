-- ============================================================================
-- TURN — Readable Storage folders (supabase/storage-readable-folders.sql)
-- Owner decision 2026-09-27. Changes production: run only with the owner's go-ahead.
--
-- PURPOSE
--   New object keys in the private bucket turn-assets start with READABLE top
--   folders, name first (the Supabase dashboard cuts off the end of long names)
--   and the full id last:
--     admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--d4432e3f-3682-40e6-bff4-0c218dae6d1e/character/wai-suk-ying/20260927-101500-sheet-v1-ab12cd34.png
--   {account handle}--{user id} / {project name}--{project id} / …the rest as before.
--   The full UUID in each folder is the ONLY thing any access check reads; the
--   name is display text and is never compared with anything. Old keys
--   ({user id}/{project id}/…) keep working forever: read, delete, reference.
--   The service areas use the same account folder: image-proxy's
--   {account}/stage-tmp/…, blender-bridge's {account}/studio-previews/{project}/…
--   and the Blender relay's {account}/{project}/shot/{job}/blender-preview-{job}.png.
--
-- KEY GRAMMAR (one parser: turn_storage_segment_id here, and the same regex in the app)
--   UUID    = [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}   (lowercase)
--   LABEL   = [a-z0-9]+(-[a-z0-9]+)*, 1-64 characters, with no 8 hex digits in
--             a row anywhere
--   SEGMENT = UUID (legacy) | LABEL "--" UUID (readable, at most 102 characters)
--   A label has no '--' and a UUID only single hyphens, so the one '--' is the
--   separator. 'stage-tmp', 'studio-previews', '_internal' and
--   'blender-studio-internal' can never parse as an id. A legacy folder's first
--   8 characters are always hex digits and a readable folder's never are; no
--   label can hold a UUID, a UUID without hyphens or an 8-digit group of one.
--   Still, a label is chosen by whoever uploads (any valid label on their OWN
--   id is accepted), so it never proves who owns a file: the Storage dashboard
--   is not an identity source; the turn_admin views read owners from the ids.
--   Handles come from the email local part (domain and +tag dropped), are
--   derived HERE ONLY, stored once in turn_storage_accounts, and never change
--   (an email change does not rename the folder). Project names come from the
--   first real title (never "Untitled film"), are stored once in
--   turn_projects.storage_slug by a trigger, and never change (a rename never
--   moves files); until then the folder is untitled--{project id}.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this WHOLE file → Run,
--   as postgres (the SQL Editor's role). Run it AFTER series-production.sql
--   (fresh install order: schema, storage, team-collaboration, invitations,
--   shared-owners, enforce-role-scopes, cameos, series-production, THIS FILE,
--   then credits / app-config / styles, admin-inventory, admin-storage).
--   It is one transaction: a stopped or failed run changes nothing. A
--   preflight stops it with TURN_STORAGE_READABLE_PREREQUISITE, naming what is
--   missing, before anything is created. Safe to re-run at any time.
--   The editor then shows item / status / detail. Rows 10-90 must read 'ok'.
--   They confirm THIS run; they cannot catch a stale copy of an access file
--   re-run later, because running this file re-installs everything first. For
--   that, read-only and at any time: admin-inventory.sql RESULT row 126.
--   Next: re-run admin-inventory.sql, then deploy the functions, then publish
--   the app (supabase/README.md, "Readable storage folders: rollout, rollback
--   and checks": privacy.html needs the owner's sentence first, decision O1).
--   Every step is backward compatible alone.
--
-- WHAT IT CREATES OR REPLACES
--   * storage key helpers turn_storage_segment_id / turn_storage_uid /
--     turn_storage_project_id (the last one widened; identical copies live in
--     team-collaboration.sql, enforce-role-scopes.sql and series-production.sql,
--     so re-running any of those keeps readable keys working);
--   * Storage rules "turn assets write collab" / "turn assets update collab"
--     (folder 1 checked through turn_storage_uid; read and delete rules are
--     unchanged) and removes the owner-only "turn assets … own" rules;
--   * turn_can_delete_asset_path (cameo-capturer branch) and
--     turn_begin_asset_upload (uploader check), same bodies as series-production.sql;
--   * only here: name derivation (turn_storage_slugify, turn_storage_account_handle,
--     turn_storage_project_slug; not callable through the API), the table
--     turn_storage_accounts (no API access), turn_projects.storage_slug with its
--     trigger, and the RPCs turn_storage_folders (signed-in app) and
--     turn_storage_folders_for (service role: image-proxy, blender-bridge).
--
-- ROLLBACK POLICY
--   NEVER roll this file back, or drop its helpers, once a readable key exists
--   (RESULT row 100 counts them): the old helpers and rules cannot resolve
--   readable folders, so every readable image would disappear for everyone and
--   only the service role could delete those files. To stop NEW readable keys,
--   use a kill switch instead:
--     revoke execute on function public.turn_storage_folders(uuid) from authenticated;
--     revoke execute on function public.turn_storage_folders_for(uuid, uuid) from service_role;
--   (clients and functions fall back to legacy keys within about 5 minutes; grant
--   again to turn it back on, and note that re-running this file grants them
--   again), or set readableStorageKeys: false in app/supabase-config.js.
--   The same goes for the code: once readable keys exist, do not redeploy
--   blender-bridge / image-proxy from a checkout without this change (old
--   blender-bridge fails every shot stored under a readable key and leaks
--   replaced ones; old image-proxy refuses in-flight readable stage refs and
--   never sweeps {account}/stage-tmp), and prefer the kill switch to a Replit
--   app rollback (an old app build skips readable keys when it deletes a Show
--   or an Episode, leaving those files for an admin to remove).
-- ============================================================================
begin;
set local lock_timeout = '5s';        -- ADD COLUMN / CREATE POLICY take ACCESS EXCLUSIVE
set local statement_timeout = '120s'; -- locks: fail fast instead of queueing everyone

-- ── 1. Preflight: nothing is created above or inside this block ─────────────
do $preflight$
declare
  problems text[] := array[]::text[];
  missing text;
  req record;
  fn record;
  bad bigint;
begin
  -- Supabase platform objects.
  select string_agg(r, ', ' order by r) into missing
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where not exists (select 1 from pg_catalog.pg_roles x where x.rolname = r);
  if missing is not null then
    problems := array_append(problems, 'missing roles ' || missing || ' (this file must run on a Supabase database)');
  end if;
  select string_agg(f, ', ' order by f) into missing
    from unnest(array['auth.uid()', 'auth.role()', 'storage.foldername(text)']) f
   where to_regprocedure(f) is null;
  if missing is not null then
    problems := array_append(problems, 'missing functions ' || missing || ' (Supabase Auth / Storage)');
  end if;
  if current_setting('server_encoding') <> 'UTF8' then
    problems := array_append(problems, 'the database encoding is ' || current_setting('server_encoding')
                                         || ', not UTF8 (normalize() needs UTF8)');
  end if;

  -- Tables and the columns this file reads or writes.
  for req in
    select v.tbl, v.src,
           to_regclass(v.tbl) is not null as present,
           string_agg(v.col, ', ' order by v.ord) filter (
             where not exists (
               select 1 from pg_catalog.pg_attribute a
                where a.attrelid = to_regclass(v.tbl)
                  and a.attname = v.col and a.attnum > 0 and not a.attisdropped)
           ) as missing_cols
      from (values
        (1,  'auth.users', 'id', 'Supabase Auth'),
        (2,  'auth.users', 'email', 'Supabase Auth'),
        (3,  'storage.objects', 'bucket_id', 'Supabase Storage'),
        (4,  'storage.objects', 'name', 'Supabase Storage'),
        (5,  'storage.buckets', 'id', 'Supabase Storage'),
        (10, 'public.turn_projects', 'id', 'schema.sql'),
        (11, 'public.turn_projects', 'owner', 'schema.sql'),
        (12, 'public.turn_projects', 'title', 'schema.sql'),
        (13, 'public.turn_projects', 'updated_at', 'schema.sql'),
        (20, 'public.turn_asset_upload_intents', 'path', 'series-production.sql'),
        (21, 'public.turn_asset_upload_intents', 'project_id', 'series-production.sql'),
        (22, 'public.turn_asset_upload_intents', 'uploader', 'series-production.sql'),
        (30, 'public.turn_asset_cleanup_queue', 'path', 'series-production.sql'),
        (31, 'public.turn_asset_cleanup_queue', 'project_id', 'series-production.sql'),
        (32, 'public.turn_asset_cleanup_queue', 'uploader', 'series-production.sql'),
        (40, 'public.turn_asset_cleanup_grants', 'path', 'series-production.sql'),
        (41, 'public.turn_asset_cleanup_grants', 'project_id', 'series-production.sql'),
        (42, 'public.turn_asset_cleanup_grants', 'owner', 'series-production.sql'),
        (43, 'public.turn_asset_cleanup_grants', 'expires_at', 'series-production.sql')
      ) v(ord, tbl, col, src)
     group by v.tbl, v.src
     order by min(v.ord)
  loop
    if not req.present then
      problems := array_append(problems, 'missing table ' || req.tbl
        || case when req.src like 'Supabase%' then ' (part of ' || req.src || ')' else ' (run ' || req.src || ' first)' end);
    elsif req.missing_cols is not null then
      problems := array_append(problems, 'missing columns ' || req.missing_cols || ' on ' || req.tbl
        || case when req.src like 'Supabase%' then ' (part of ' || req.src || ')' else ' (run ' || req.src || ' first)' end);
    end if;
  end loop;

  -- The bucket row (plain SQL only once its table is proven present).
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets b where b.id = 'turn-assets') then
      problems := array_append(problems, 'missing the private bucket turn-assets (run storage.sql first)');
    end if;
  end if;

  if to_regclass('public.turn_projects') is not null then
    -- The backfill below switches the touch trigger off for its own UPDATE only.
    if not exists (select 1 from pg_catalog.pg_trigger t
                    where t.tgrelid = to_regclass('public.turn_projects')
                      and t.tgname = 'turn_projects_touch' and not t.tgisinternal) then
      problems := array_append(problems, 'missing trigger turn_projects_touch on public.turn_projects (run schema.sql first)');
    end if;
    -- ADD COLUMN and DISABLE TRIGGER need the table owner's rights.
    if not pg_catalog.pg_has_role(current_user,
             (select c.relowner from pg_catalog.pg_class c where c.oid = to_regclass('public.turn_projects')),
             'USAGE') then
      problems := array_append(problems, 'role ' || current_user || ' does not own public.turn_projects'
                                           || ' (run this file in the SQL Editor as postgres)');
    end if;
    -- A storage_slug column left by an earlier run must be text and grammar-valid.
    if exists (select 1 from pg_catalog.pg_attribute a
                where a.attrelid = to_regclass('public.turn_projects')
                  and a.attname = 'storage_slug' and a.attnum > 0 and not a.attisdropped) then
      if (select pg_catalog.format_type(a.atttypid, a.atttypmod) from pg_catalog.pg_attribute a
           where a.attrelid = to_regclass('public.turn_projects')
             and a.attname = 'storage_slug' and a.attnum > 0 and not a.attisdropped) <> 'text' then
        problems := array_append(problems, 'public.turn_projects.storage_slug exists but is not text');
      else
        execute $q$select count(*) from public.turn_projects p
                    where p.storage_slug is not null
                      and not (char_length(p.storage_slug) between 1 and 40
                               and p.storage_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                               and p.storage_slug !~ '[0-9a-f]{8}')$q$ into bad;
        if bad > 0 then
          problems := array_append(problems, bad::text || ' row(s) of public.turn_projects hold a storage_slug that is not a valid folder name');
        end if;
      end if;
    end if;
  end if;

  -- A turn_storage_accounts table left by an earlier run must have this shape.
  if to_regclass('public.turn_storage_accounts') is not null then
    select string_agg(v.col || ' ' || v.typ, ', ' order by v.col) into missing
      from (values ('user_id', 'uuid'), ('handle', 'text')) v(col, typ)
     where not exists (
       select 1 from pg_catalog.pg_attribute a
        where a.attrelid = to_regclass('public.turn_storage_accounts')
          and a.attname = v.col and a.attnum > 0 and not a.attisdropped
          and pg_catalog.format_type(a.atttypid, a.atttypmod) = v.typ);
    if missing is not null then
      problems := array_append(problems, 'public.turn_storage_accounts exists without the columns ' || missing);
    end if;
  end if;

  -- Functions this file builds on ("create or replace" cannot rename an
  -- argument or change a result type), and the shape of its own ones when an
  -- earlier run (or a current team-collaboration.sql) already made them.
  for fn in
    select * from (values
      (true,  'public.turn_can_access_project(uuid,boolean)', '{pid,write_access}', 'boolean', 'team-collaboration.sql'),
      (true,  'public.turn_can_write_assets(uuid)', '{pid}', 'boolean', 'enforce-role-scopes.sql'),
      (true,  'public.turn_storage_project_id(text)', '{path}', 'uuid', 'team-collaboration.sql'),
      (true,  'public.turn_can_delete_asset_path(text)', '{path}', 'boolean', 'series-production.sql'),
      (true,  'public.turn_begin_asset_upload(uuid,text)', '{p_project_id,p_path}', 'timestamp with time zone', 'series-production.sql'),
      (false, 'public.turn_storage_segment_id(text)', '{seg}', 'uuid', 'this file'),
      (false, 'public.turn_storage_uid(text)', '{path}', 'uuid', 'this file'),
      (false, 'public.turn_storage_slugify(text,integer)', '{p_text,p_max}', 'text', 'this file'),
      (false, 'public.turn_storage_account_handle(text)', '{p_email}', 'text', 'this file'),
      (false, 'public.turn_storage_project_slug(text)', '{p_title}', 'text', 'this file'),
      (false, 'public.turn_storage_account_folder(uuid)', '{p_user}', 'text', 'this file'),
      (false, 'public.turn_storage_folders(uuid)', '{p_project_id}', 'jsonb', 'this file'),
      (false, 'public.turn_storage_folders_for(uuid,uuid)', '{p_user,p_project_id}', 'jsonb', 'this file')
    ) v(required, sig, args, result, src)
  loop
    if to_regprocedure(fn.sig) is null then
      if fn.required then
        problems := array_append(problems, 'missing function ' || fn.sig || ' (run ' || fn.src || ' first)');
      end if;
    elsif (select p.proargnames::text from pg_catalog.pg_proc p where p.oid = to_regprocedure(fn.sig)) is distinct from fn.args
       or (select pg_catalog.pg_get_function_result(p.oid) from pg_catalog.pg_proc p where p.oid = to_regprocedure(fn.sig)) is distinct from fn.result then
      problems := array_append(problems, fn.sig || ' must have the arguments ' || fn.args || ' and return ' || fn.result
                                           || case when fn.src = 'this file' then '' else ' as ' || fn.src || ' defines it' end);
    end if;
  end loop;

  -- The read and delete rules this file keeps (it drops the owner-only ones).
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from pg_catalog.pg_policies p
                    where p.schemaname = 'storage' and p.tablename = 'objects'
                      and p.policyname = 'turn assets read collab'
                      and p.qual like '%turn_storage_project_id(name)%') then
      problems := array_append(problems, 'missing Storage rule "turn assets read collab" (run team-collaboration.sql first)');
    end if;
    if not exists (select 1 from pg_catalog.pg_policies p
                    where p.schemaname = 'storage' and p.tablename = 'objects'
                      and p.policyname = 'turn assets delete collab'
                      and p.qual like '%turn_can_delete_asset_path(name)%') then
      problems := array_append(problems, 'the Storage rule "turn assets delete collab" is missing or not the exact-path one (run series-production.sql first)');
    end if;
  end if;

  if cardinality(problems) > 0 then
    raise exception using
      errcode = '55000',
      message = 'TURN_STORAGE_READABLE_PREREQUISITE: storage-readable-folders.sql stopped before changing anything: '
                || array_to_string(problems, '; '),
      hint = 'Run the named file(s) in the Supabase SQL Editor, then run storage-readable-folders.sql again. '
             || 'Order: schema.sql, storage.sql, team-collaboration.sql, invitations.sql, shared-owners.sql, '
             || 'enforce-role-scopes.sql, cameos.sql (optional), series-production.sql, then storage-readable-folders.sql.';
  end if;
end;
$preflight$;

-- ── 2. Storage key helpers (the canonical block) ────────────────────────────
-- >>> TURN storage key helpers — canonical copy. Keep this block byte-identical in
--     team-collaboration.sql, enforce-role-scopes.sql, series-production.sql and
--     storage-readable-folders.sql (scripts/test-storage-readable-folders.mjs checks it).
-- A turn-assets key starts with the uploader's folder and the project's folder.
-- Each of those folders is either a bare lowercase UUID (every key written before
-- 2026-09-27; valid forever) or a readable 'label--uuid', name first because the
-- Storage dashboard cuts off the end of long names:
--   admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--d4432e3f-3682-40e6-bff4-0c218dae6d1e/character/…
-- A label is lowercase [a-z0-9] runs joined by single hyphens, 1-64 characters,
-- with no 8 hex digits in a row anywhere: a legacy folder's first 8 characters
-- are always hex digits and a readable folder's never are, and no label can hold
-- a UUID, a UUID without hyphens or any 8-digit group of one. Access rules read
-- ONLY the UUID; a label is display text, is never compared with anything, and
-- proves nothing about who owns a file (anyone may label their OWN id).
create or replace function public.turn_storage_segment_id(seg text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when seg ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then seg::uuid
    when char_length(seg) <= 102
     and seg ~ '^[a-z0-9]+(?:-[a-z0-9]+)*--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and left(seg, -38) !~ '[0-9a-f]{8}'
      then right(seg, 36)::uuid
  end;
$$;

-- The uploader id of a key (folder 1). For a legacy key this is exactly the old
-- rule (storage.foldername(name))[1] = auth.uid()::text: at least two segments
-- and a canonical lowercase UUID in folder 1.
create or replace function public.turn_storage_uid(path text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when coalesce(array_length(string_to_array(path, '/'), 1), 0) >= 2
              then public.turn_storage_segment_id(split_part(path, '/', 1)) end;
$$;

-- The project id of a key (folder 2; the argument keeps the name `path`, which
-- "create or replace" cannot change). Wherever the pre-2026-09-27 version
-- returned a value it still returns exactly that value: its folders[2]::uuid
-- cast (which also accepts uppercase, braces and UUIDs without hyphens) is the
-- fallback branch. Readable folders never overlap it (a uuid cast rejects '--').
-- 'stage-tmp' and 'studio-previews' never resolve to a project.
create or replace function public.turn_storage_project_id(path text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when coalesce(array_length(string_to_array(path, '/'), 1), 0) >= 3 then
    coalesce(public.turn_storage_segment_id(split_part(path, '/', 2)),
             case when split_part(path, '/', 2)
                       ~* '^(\{[0-9a-f]{4}(-?[0-9a-f]{4}){7}\}|[0-9a-f]{4}(-?[0-9a-f]{4}){7})$'
                  then split_part(path, '/', 2)::uuid end)
  end;
$$;

-- Storage rules evaluate these as the calling role, so every API role keeps EXECUTE.
grant execute on function public.turn_storage_segment_id(text) to anon, authenticated, service_role;
grant execute on function public.turn_storage_uid(text)        to anon, authenticated, service_role;
grant execute on function public.turn_storage_project_id(text) to anon, authenticated, service_role;
-- <<< end of the TURN storage key helpers
-- ── 3. Name derivation (only in this file; not callable through the API) ────
-- slugify: NFKD, lowercase, a few letters that have no decomposition spelled
-- out, combining marks (U+0300-U+036F) removed, every other run of characters
-- outside [a-z0-9] turned into one '-', every run of 8 or more hex digits
-- dropped (a folder name never holds an id-like run: 'Take 20260927' → 'take'),
-- trimmed, cut to p_max. Empty → null.
create or replace function public.turn_storage_slugify(p_text text, p_max integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(rtrim(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           translate(replace(replace(replace(replace(
             lower(normalize(coalesce(p_text, ''), NFKD)),
             'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'þ', 'th'), 'øłđð', 'oldd'),
           '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
         '[^a-z0-9]+', '-', 'g'),
         '[0-9a-f]{8,}', '', 'g'),
         '-{2,}', '-', 'g'), '-'), greatest(p_max, 1)), '-'), '');
$$;

-- The account handle: the email's local part (the domain is never used, a
-- +tag is dropped), at most 32 characters; 'account' when nothing Latin is
-- left (phone-only or non-Latin addresses, or only a long number). Reserved
-- words get 'user-' unless the address is at infinitestudioai.com (owner
-- decision O3). Runs of 8+ hex digits are dropped by slugify (the grammar).
--   Alex.Smith+turn@x.com → alex-smith     Wái.Súk-Yíng@x.hk → wai-suk-ying
--   admin@gmail.com → user-admin           admin@infinitestudioai.com → admin
--   日本@x.jp → account                     12345678@qq.com → account
--   john.20260101@x.com → john              deadbeef-01@x.com → 01
create or replace function public.turn_storage_account_handle(p_email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with parts as (
    select lower(btrim(coalesce(p_email, ''))) as e
  ), local as (
    select split_part(split_part(e, '@', 1), '+', 1) as l,
           case when position('@' in e) > 0 then split_part(e, '@', 2) else '' end as domain
      from parts
  ), base as (
    select coalesce(public.turn_storage_slugify(l, 32), 'account') as h, domain from local
  ), reserved as (
    select case when h = any (array['admin','administrator','root','support','help','security','billing',
                                    'staff','team','official','system','service','moderator','noreply',
                                    'no-reply','turn','turn-admin','infinite-studio','infinitestudio',
                                    'infinitestudioai','infinite-studio-ai'])
                     and domain <> 'infinitestudioai.com'
                then 'user-' || h else h end as h
      from base
  )
  select h from reserved;
$$;

-- The project folder name: null for a blank or placeholder title ("Untitled
-- film", "Untitled film — Show", "Untitled film — E02"), 'project' when a real
-- title has nothing Latin in it (or only a long number), otherwise the slug of
-- the title (at most 40 characters; runs of 8+ hex digits dropped).
--   Pine Soot — E02 → pine-soot-e02     Crème Brûlée → creme-brulee     日本語の映画 → project
--   Take 20260927 → take                12345678-go → go
create or replace function public.turn_storage_project_slug(p_title text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with s as (select public.turn_storage_slugify(p_title, 40) as s)
  select case
    when nullif(btrim(coalesce(p_title, '')), '') is null then null
    when s.s is null then 'project'
    when s.s ~ '^untitled(-(film|show|project|story))*(-e[0-9]{1,4})?$' then null
    else s.s end
  from s;
$$;

revoke all on function public.turn_storage_slugify(text, integer) from public, anon, authenticated;
revoke all on function public.turn_storage_account_handle(text) from public, anon, authenticated;
revoke all on function public.turn_storage_project_slug(text) from public, anon, authenticated;

-- ── 4. Account folders and the folder RPCs (only in this file) ──────────────
-- One handle per account, derived once and never changed (an admin may edit a
-- row by hand: old files stay where they are, new uploads follow within one
-- client cache lifetime of 5 minutes).
create table if not exists public.turn_storage_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  handle     text not null,
  created_at timestamptz not null default now(),
  constraint turn_storage_accounts_handle_check check (
    char_length(handle) between 1 and 32
    and handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and handle !~ '[0-9a-f]{8}')
);
alter table public.turn_storage_accounts enable row level security;
revoke all on table public.turn_storage_accounts from anon, authenticated;
comment on table public.turn_storage_accounts is
  'TURN readable Storage folders: the account handle used in {handle}--{user id}/… keys. Set once (storage-readable-folders.sql); never follows an email change. No API access.';

insert into public.turn_storage_accounts(user_id, handle)
select u.id, public.turn_storage_account_handle(u.email)
  from auth.users u
on conflict (user_id) do nothing;

-- Internal: the account folder '{handle}--{user id}', creating the row on
-- first use; null for an unknown user.
create or replace function public.turn_storage_account_folder(p_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored text;
begin
  if p_user is null then return null; end if;
  select a.handle into stored from public.turn_storage_accounts a where a.user_id = p_user;
  if stored is null then
    insert into public.turn_storage_accounts(user_id, handle)
    select u.id, public.turn_storage_account_handle(u.email)
      from auth.users u
     where u.id = p_user
    on conflict (user_id) do nothing;
    select a.handle into stored from public.turn_storage_accounts a where a.user_id = p_user;
  end if;
  if stored is null then return null; end if;
  return stored || '--' || p_user::text;
end;
$$;
revoke all on function public.turn_storage_account_folder(uuid) from public, anon, authenticated;

-- The app asks for its folders before writing a readable key; any error (this
-- function missing, execute revoked) makes it write a legacy key instead.
-- A project the caller cannot open is refused, so no other project's name leaks.
create or replace function public.turn_storage_folders(p_project_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  account_folder text;
  project_folder text;
  row_id uuid;
  row_slug text;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_STORAGE: sign in first';
  end if;
  account_folder := public.turn_storage_account_folder(caller);
  if public.turn_storage_segment_id(account_folder) is distinct from caller then
    account_folder := null;
  end if;
  if p_project_id is not null then
    if not coalesce(public.turn_can_access_project(p_project_id, false), false) then
      raise exception using errcode = '42501', message = 'TURN_STORAGE: project not accessible';
    end if;
    select p.id, p.storage_slug into row_id, row_slug
      from public.turn_projects p where p.id = p_project_id;
    if row_id is null then
      raise exception using errcode = 'P0002', message = 'TURN_STORAGE: project not found';
    end if;
    project_folder := coalesce(row_slug, 'untitled') || '--' || row_id::text;
    if public.turn_storage_segment_id(project_folder) is distinct from row_id then
      project_folder := null;
    end if;
  end if;
  return jsonb_build_object('v', 1, 'account', account_folder, 'project', project_folder);
end;
$$;
revoke all on function public.turn_storage_folders(uuid) from public, anon;
grant execute on function public.turn_storage_folders(uuid) to authenticated;

-- The same answer for the Edge Functions (service role), with no membership
-- check: image-proxy asks for the caller's account folder (p_project_id null),
-- blender-bridge for the project owner's account and the project.
create or replace function public.turn_storage_folders_for(p_user uuid, p_project_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  account_folder text;
  project_folder text;
  row_id uuid;
  row_slug text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'TURN_STORAGE: service role required';
  end if;
  if p_user is null then
    raise exception using errcode = '22023', message = 'TURN_STORAGE: a user id is required';
  end if;
  account_folder := public.turn_storage_account_folder(p_user);
  if public.turn_storage_segment_id(account_folder) is distinct from p_user then
    account_folder := null;
  end if;
  if p_project_id is not null then
    select p.id, p.storage_slug into row_id, row_slug
      from public.turn_projects p where p.id = p_project_id;
    if row_id is null then
      raise exception using errcode = 'P0002', message = 'TURN_STORAGE: project not found';
    end if;
    project_folder := coalesce(row_slug, 'untitled') || '--' || row_id::text;
    if public.turn_storage_segment_id(project_folder) is distinct from row_id then
      project_folder := null;
    end if;
  end if;
  return jsonb_build_object('v', 1, 'account', account_folder, 'project', project_folder);
end;
$$;
revoke all on function public.turn_storage_folders_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.turn_storage_folders_for(uuid, uuid) to service_role;

-- ── 5. Storage rules ────────────────────────────────────────────────────────
-- Read ("turn assets read collab") and delete ("turn assets delete collab")
-- keep their text; they read turn_storage_project_id / turn_can_delete_asset_path,
-- which now understand readable folders. Uploads check folder 1 through
-- turn_storage_uid (same text as team-collaboration.sql, enforce-role-scopes.sql
-- and series-production.sql). The owner-only rules from storage.sql are
-- dropped again in case a storage.sql re-run brought them back.
drop policy if exists "turn assets read own"   on storage.objects;
drop policy if exists "turn assets write own"  on storage.objects;
drop policy if exists "turn assets update own" on storage.objects;
drop policy if exists "turn assets delete own" on storage.objects;
drop policy if exists "turn assets write collab"  on storage.objects;
drop policy if exists "turn assets update collab" on storage.objects;
create policy "turn assets write collab" on storage.objects for insert
  with check (
    bucket_id = 'turn-assets'
    and public.turn_storage_uid(name) = auth.uid()
    and public.turn_can_write_assets(public.turn_storage_project_id(name))
  );

create policy "turn assets update collab" on storage.objects for update
  using (
    bucket_id = 'turn-assets'
    and public.turn_storage_uid(name) = auth.uid()
    and public.turn_can_write_assets(public.turn_storage_project_id(name))
  );

-- ── 6. series-production.sql functions that read folder 1 ───────────────────
-- Same bodies as series-production.sql (only the uploader checks changed:
-- turn_storage_uid instead of comparing folder 1's text). "create or replace"
-- keeps their grants; they are restated anyway.
create or replace function public.turn_can_delete_asset_path(path text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with target as (
    select public.turn_storage_project_id($1) as project_id
  )
  select coalesce((
    select t.project_id is not null and (
      public.turn_can_write_assets(t.project_id)
      or exists (
        select 1
          from public.turn_asset_cleanup_grants g
         where g.path = $1
           and g.project_id = t.project_id
           and g.owner = auth.uid()
           and g.expires_at > statement_timestamp()
      )
      or exists (
        select 1
          from public.turn_asset_upload_intents i
         where i.path = $1
           and i.project_id = t.project_id
           and i.uploader = auth.uid()
      )
      or exists (
        select 1
          from public.turn_asset_cleanup_queue q
         where q.path = $1
           and q.project_id = t.project_id
           and q.uploader = auth.uid()
      )
      -- A cameo is the capturer's own likeness, and deleting it stays their
      -- right after they lose the art-director role (see the cameo rules
      -- below). The app removes the photos before the cameo row, so the
      -- capturer may also delete the photos in their OWN folder:
      -- {their user id}/{project}/cameo/... (the user id bare or as
      -- 'name--id'). Nobody else's files qualify,
      -- and other kinds of asset still need Art Room write access.
      or (
        auth.uid() is not null
        and public.turn_storage_uid($1) = auth.uid()
        and split_part($1, '/', 3) = 'cameo'
        and split_part($1, '/', 4) <> ''
      )
    )
      from target t
  ), false);
$$;

revoke all on function public.turn_can_delete_asset_path(text) from public;
-- Evaluated by the Storage DELETE policy as the calling role (see the note on
-- turn_can_access_project): both API roles keep EXECUTE; it is false for anon.
grant execute on function public.turn_can_delete_asset_path(text) to anon, authenticated;

create or replace function public.turn_begin_asset_upload(p_project_id uuid, p_path text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  folders text[];
  deadline timestamptz := statement_timestamp() + interval '30 minutes';
  active_count integer;
  stored_deadline timestamptz;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'TURN_ASSET_UPLOAD: sign in before uploading';
  end if;
  if p_project_id is null or nullif(btrim(p_path), '') is null
     or char_length(p_path) > 1024 then
    raise exception using errcode = '22023', message = 'TURN_ASSET_UPLOAD: project and exact path are required';
  end if;

  folders := storage.foldername(p_path);
  if array_length(folders, 1) < 4
     or public.turn_storage_uid(p_path) is distinct from caller
     or public.turn_storage_project_id(p_path) is distinct from p_project_id
     or position(chr(92) in p_path) > 0
     or exists (select 1 from unnest(folders) part where part in ('', '.', '..')) then
    raise exception using errcode = '22023', message = 'TURN_ASSET_UPLOAD: path is outside the caller project scope';
  end if;
  if not public.turn_can_write_assets(p_project_id) then
    raise exception using errcode = '42501', message = 'TURN_ASSET_UPLOAD: Art Room write access is required';
  end if;
  -- Serialize this uploader's reservations so concurrent tabs cannot race past
  -- the outstanding-intent cap. The lock is transaction-scoped and namespaced
  -- to this capability; it is released before any Storage upload begins.
  perform pg_advisory_xact_lock(
    hashtextextended('turn_asset_upload:' || caller::text, 0)
  );
  -- Expiry ends the upload reservation, never its cleanup obligation. Promotion
  -- to the durable queue and intent removal happen in one transaction.
  perform public.turn_queue_expired_asset_uploads();

  -- An intent describes bytes that do not exist yet. Without this check, a
  -- malicious collaborator could reserve the name of an already-committed file
  -- immediately before their role is removed and retain a one-path delete token.
  if exists (
    select 1 from storage.objects o
     where o.bucket_id = 'turn-assets'
       and o.name = p_path
  ) or exists (
    select 1 from public.turn_asset_cleanup_queue q
     where q.path = p_path
  ) then
    raise exception using errcode = '23505', message = 'TURN_ASSET_UPLOAD: exact path already exists';
  end if;

  select count(*) into active_count
    from public.turn_asset_upload_intents i
   where i.uploader = caller
     and i.expires_at > statement_timestamp()
     and i.path <> p_path;
  if active_count >= 256 then
    raise exception using errcode = '54000', message = 'TURN_ASSET_UPLOAD: too many unfinished uploads';
  end if;

  -- A reservation is exclusive even to another tab owned by the same caller.
  -- Letting two uploads share one exact-path capability would allow the losing
  -- upload's compensation to delete bytes accepted for the winning upload.
  -- A response lost after this insert is therefore safely non-retriable at the
  -- same path; the client generates a fresh random path for its next attempt.
  insert into public.turn_asset_upload_intents(path, project_id, uploader, created_at, expires_at)
  values (p_path, p_project_id, caller, statement_timestamp(), deadline)
  on conflict (path) do nothing
  returning expires_at into stored_deadline;

  if stored_deadline is null then
    raise exception using errcode = '23505', message = 'TURN_ASSET_UPLOAD: exact path is already reserved';
  end if;
  return stored_deadline;
end;
$$;
revoke all on function public.turn_begin_asset_upload(uuid, text) from public, anon;
grant execute on function public.turn_begin_asset_upload(uuid, text) to authenticated;

-- ── 7. Project folder name (turn_projects.storage_slug; last, so the table
--       lock is held as briefly as possible) ────────────────────────────────
alter table public.turn_projects add column if not exists storage_slug text;

-- Owned by this trigger: set from the first real title, then frozen. Client
-- input is ignored on insert and update, so nobody can choose a folder name;
-- a rename never moves files.
create or replace function public.turn_projects_storage_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.storage_slug is not null then
    new.storage_slug := old.storage_slug;
  else
    new.storage_slug := public.turn_storage_project_slug(new.title);
  end if;
  return new;
end;
$$;
revoke all on function public.turn_projects_storage_slug() from public, anon, authenticated;

drop trigger if exists turn_projects_storage_slug on public.turn_projects;
create trigger turn_projects_storage_slug
  before insert or update of title, storage_slug on public.turn_projects
  for each row execute function public.turn_projects_storage_slug();

-- Backfill with the touch trigger off for this UPDATE only: the Home wall is
-- ordered by updated_at, so bumping it would reshuffle every user's projects.
-- (No other trigger fires on an UPDATE of storage_slug alone.)
do $backfill$
declare
  touch_state "char";
begin
  select t.tgenabled into touch_state
    from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.turn_projects'::regclass
     and t.tgname = 'turn_projects_touch' and not t.tgisinternal;
  if touch_state is not null and touch_state <> 'D' then
    alter table public.turn_projects disable trigger turn_projects_touch;
  end if;
  update public.turn_projects p
     set storage_slug = public.turn_storage_project_slug(p.title)
   where p.storage_slug is null
     and public.turn_storage_project_slug(p.title) is not null;
  if touch_state = 'O' then
    alter table public.turn_projects enable trigger turn_projects_touch;
  elsif touch_state = 'A' then
    alter table public.turn_projects enable always trigger turn_projects_touch;
  elsif touch_state = 'R' then
    alter table public.turn_projects enable replica trigger turn_projects_touch;
  end if;
end;
$backfill$;

do $slug_check$
begin
  if not exists (select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.turn_projects'::regclass
                    and c.conname = 'turn_projects_storage_slug_check') then
    alter table public.turn_projects add constraint turn_projects_storage_slug_check check (
      storage_slug is null
      or (char_length(storage_slug) between 1 and 40
          and storage_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          and storage_slug !~ '[0-9a-f]{8}')) not valid;
  end if;
end;
$slug_check$;
alter table public.turn_projects validate constraint turn_projects_storage_slug_check;

comment on column public.turn_projects.storage_slug is
  'TURN readable Storage folders: the project folder name in {name}--{project id}/… keys. Set by a trigger from the first real title, then never changed; null while the title is a placeholder (folder untitled--{project id}).';

commit;

-- ── RESULT — the table the SQL Editor shows after Run ───────────────────────
with vectors(fn, input, expected) as (
  values
    ('segment', 'b2444e18-5133-4155-bb2f-d2719dcdb442', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('segment', 'admin--b2444e18-5133-4155-bb2f-d2719dcdb442', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('segment', 'pine-soot--b2444e18-5133-4155-bb2f-d2719dcdb442', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('segment', 'deadbee-1--b2444e18-5133-4155-bb2f-d2719dcdb442', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('segment', repeat('x', 64) || '--b2444e18-5133-4155-bb2f-d2719dcdb442', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('segment', 'Admin--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'admin--B2444E18-5133-4155-BB2F-D2719DCDB442', null),
    ('segment', 'a--b--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', '--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'admin---b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', '-admin--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'deadbeef--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'deadbeef-x--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'b2444e18-5133--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'deadbeef1--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'b2444e18a-5133-4155-bb2f-d2719dcdb442--a11ce000-0000-4000-8000-000000000001', null),
    ('segment', '0b2444e18-5133-4155-bb2f-d2719dcdb442--a11ce000-0000-4000-8000-000000000001', null),
    ('segment', 'b2444e1851334155bb2fd2719dcdb442--a11ce000-0000-4000-8000-000000000001', null),
    ('segment', 'x-b2444e18-5133-4155-bb2f-d2719dcdb442--d4432e3f-3682-40e6-bff4-0c218dae6d1e', null),
    ('segment', repeat('x', 65) || '--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'a_b--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'a.b--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'é--b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('segment', 'stage-tmp', null),
    ('segment', 'studio-previews', null),
    ('segment', '_internal', null),
    ('segment', 'B2444E18-5133-4155-BB2F-D2719DCDB442', null),
    ('segment', '{b2444e18-5133-4155-bb2f-d2719dcdb442}', null),
    ('segment', 'b2444e1851334155bb2fd2719dcdb442', null),
    ('uid', 'admin--b2444e18-5133-4155-bb2f-d2719dcdb442/stage-tmp/1759000000000-video-a.mp4', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('uid', 'b2444e18-5133-4155-bb2f-d2719dcdb442/x', 'b2444e18-5133-4155-bb2f-d2719dcdb442'),
    ('uid', 'b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('uid', '_internal/blender-bridge/b2444e18-5133-4155-bb2f-d2719dcdb442', null),
    ('uid', 'blender-studio-internal/b2444e18-5133-4155-bb2f-d2719dcdb442/mesh.glb', null),
    ('project', 'admin--b2444e18-5133-4155-bb2f-d2719dcdb442/stage-tmp/1759000000000-video-a.mp4', null),
    ('project', 'admin--b2444e18-5133-4155-bb2f-d2719dcdb442/studio-previews/pine-soot--d4432e3f-3682-40e6-bff4-0c218dae6d1e/loc/p.png', null),
    ('project', 'admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--d4432e3f-3682-40e6-bff4-0c218dae6d1e/character/x.png', 'd4432e3f-3682-40e6-bff4-0c218dae6d1e'),
    ('project', 'b2444e18-5133-4155-bb2f-d2719dcdb442/d4432e3f-3682-40e6-bff4-0c218dae6d1e/character/x.png', 'd4432e3f-3682-40e6-bff4-0c218dae6d1e'),
    ('project', 'b2444e18-5133-4155-bb2f-d2719dcdb442/D4432E3F-3682-40E6-BFF4-0C218DAE6D1E/character/x.png', 'd4432e3f-3682-40e6-bff4-0c218dae6d1e'),
    ('project', 'b2444e18-5133-4155-bb2f-d2719dcdb442/d4432e3f-3682-40e6-bff4-0c218dae6d1e', null)
), grammar as (
  select count(*) filter (where (case v.fn
             when 'segment' then public.turn_storage_segment_id(v.input)
             when 'uid' then public.turn_storage_uid(v.input)
             else public.turn_storage_project_id(v.input) end) is distinct from v.expected::uuid) as wrong,
         count(*) as total
    from vectors v
), legacy as (
  select count(*) filter (
           where split_part(o.name, '/', 2) not like '%--%'
             and (case when coalesce(array_length(string_to_array(o.name, '/'), 1), 0) >= 3
                        and split_part(o.name, '/', 2)
                            ~* '^(\{[0-9a-f]{4}(-?[0-9a-f]{4}){7}\}|[0-9a-f]{4}(-?[0-9a-f]{4}){7})$'
                       then split_part(o.name, '/', 2)::uuid end)
                 is distinct from public.turn_storage_project_id(o.name)) as project_changed,
         count(*) filter (
           where split_part(o.name, '/', 1) not like '%--%'
             and (case when coalesce(array_length(string_to_array(o.name, '/'), 1), 0) >= 2
                        and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then split_part(o.name, '/', 1)::uuid end)
                 is distinct from public.turn_storage_uid(o.name)) as uploader_changed,
         count(*) filter (where split_part(o.name, '/', 1) like '%--%'
                             or split_part(o.name, '/', 2) like '%--%'
                             or split_part(o.name, '/', 3) like '%--%') as readable,
         count(*) as total
    from storage.objects o
   where o.bucket_id = 'turn-assets'
), rules as (
  select p.policyname, p.cmd, coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as body
    from pg_catalog.pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects'
)
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'Storage key helpers' as item,
           case when (select count(*) from pg_catalog.pg_proc p
                       where p.oid in (to_regprocedure('public.turn_storage_segment_id(text)'),
                                       to_regprocedure('public.turn_storage_uid(text)'),
                                       to_regprocedure('public.turn_storage_project_id(text)'))
                         and p.provolatile = 'i') = 3
                then 'ok' else 'FAIL — re-run the whole file' end as status,
           'turn_storage_segment_id, turn_storage_uid, turn_storage_project_id (IMMUTABLE)' as detail
    union all
    select 20, 'Key grammar self-test',
           case when g.wrong = 0 then 'ok' else 'FAIL — ' || g.wrong || ' vector(s) parsed wrongly; re-run the whole file' end,
           g.total || ' vectors: legacy ids, readable folders, rejects, service folders'
      from grammar g
    union all
    select 30, 'Legacy keys resolve exactly as before',
           case when l.project_changed = 0 and l.uploader_changed = 0 then 'ok'
                else 'FAIL — ' || l.project_changed || ' project / ' || l.uploader_changed || ' uploader id(s) changed' end,
           l.total || ' objects in turn-assets checked against the old folder rules'
      from legacy l
    union all
    select 40, 'Upload rules read folder 1 through turn_storage_uid',
           case when exists (select 1 from rules where policyname = 'turn assets write collab' and cmd = 'INSERT'
                                                   and body like '%turn_storage_uid(name) = auth.uid()%')
                 and exists (select 1 from rules where policyname = 'turn assets update collab' and cmd = 'UPDATE'
                                                   and body like '%turn_storage_uid(name) = auth.uid()%')
                 and not exists (select 1 from rules where body like '%turn-assets%'
                                                       and body like '%foldername(name))[1]%')
                then 'ok' else 'FAIL — a stale SQL file was re-run after this one; re-run this file' end,
           'no turn-assets rule compares (storage.foldername(name))[1] as text any more'
    union all
    select 50, 'Upload reservation and delete right read folder 1 through turn_storage_uid',
           case when pg_catalog.pg_get_functiondef(to_regprocedure('public.turn_begin_asset_upload(uuid,text)')) like '%turn_storage_uid(%'
                 and pg_catalog.pg_get_functiondef(to_regprocedure('public.turn_can_delete_asset_path(text)')) like '%turn_storage_uid(%'
                then 'ok' else 'FAIL — a stale series-production.sql was re-run after this one; re-run this file' end,
           'turn_begin_asset_upload, turn_can_delete_asset_path'
    union all
    select 60, 'Project folder names (turn_projects.storage_slug)',
           case when not exists (select 1 from pg_catalog.pg_trigger t
                                  where t.tgrelid = 'public.turn_projects'::regclass
                                    and t.tgname = 'turn_projects_touch' and t.tgenabled <> 'D')
                then 'FAIL — turn_projects_touch is switched off, so saves no longer move a project up the Home wall; '
                     || 'run: alter table public.turn_projects enable trigger turn_projects_touch;'
                when exists (select 1 from pg_catalog.pg_attribute a
                              where a.attrelid = 'public.turn_projects'::regclass and a.attname = 'storage_slug'
                                and a.attnum > 0 and not a.attisdropped)
                 and exists (select 1 from pg_catalog.pg_trigger t
                              where t.tgrelid = 'public.turn_projects'::regclass
                                and t.tgname = 'turn_projects_storage_slug' and t.tgenabled <> 'D')
                 and exists (select 1 from pg_catalog.pg_constraint c
                              where c.conrelid = 'public.turn_projects'::regclass
                                and c.conname = 'turn_projects_storage_slug_check' and c.convalidated)
                then 'ok' else 'FAIL — re-run the whole file' end,
           (select count(*) filter (where p.storage_slug is not null) || ' named, '
                   || count(*) filter (where p.storage_slug is null) || ' still untitled (folder untitled--{id}); '
                   || 'the backfill left updated_at alone and switched turn_projects_touch back on'
              from public.turn_projects p)
    union all
    select 70, 'Account handles (turn_storage_accounts)',
           case when not exists (select 1 from auth.users u
                                  where not exists (select 1 from public.turn_storage_accounts a where a.user_id = u.id))
                then 'ok' else 'FAIL — re-run the whole file' end,
           (select count(*) from public.turn_storage_accounts) || ' handles for '
             || (select count(*) from auth.users) || ' accounts (later accounts get theirs on first upload)'
    union all
    select 80, 'Rights',
           case when has_function_privilege('authenticated', 'public.turn_storage_folders(uuid)', 'EXECUTE')
                 and not has_function_privilege('anon', 'public.turn_storage_folders(uuid)', 'EXECUTE')
                 and has_function_privilege('service_role', 'public.turn_storage_folders_for(uuid,uuid)', 'EXECUTE')
                 and not has_function_privilege('authenticated', 'public.turn_storage_folders_for(uuid,uuid)', 'EXECUTE')
                 and not has_function_privilege('anon', 'public.turn_storage_folders_for(uuid,uuid)', 'EXECUTE')
                 and not has_table_privilege('anon', 'public.turn_storage_accounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 and not has_table_privilege('authenticated', 'public.turn_storage_accounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 and not exists (
                   select 1
                     from unnest(array['public.turn_storage_slugify(text,integer)', 'public.turn_storage_account_handle(text)',
                                       'public.turn_storage_project_slug(text)', 'public.turn_storage_account_folder(uuid)',
                                       'public.turn_projects_storage_slug()']) f
                    cross join unnest(array['anon', 'authenticated']) r
                    where has_function_privilege(r, f, 'EXECUTE'))
                 and (select bool_and(has_function_privilege(r, f, 'EXECUTE'))
                        from unnest(array['public.turn_storage_segment_id(text)', 'public.turn_storage_uid(text)',
                                          'public.turn_storage_project_id(text)']) f
                       cross join unnest(array['anon', 'authenticated', 'service_role']) r)
                then 'ok' else 'FAIL — re-run the whole file' end,
           'folders RPC: signed-in users only; folders_for: service role only; handles table and name derivation: no API access'
    union all
    select 90, 'Owner-only Storage rules removed',
           case when not exists (select 1 from rules
                                  where policyname in ('turn assets read own', 'turn assets write own',
                                                       'turn assets update own', 'turn assets delete own'))
                then 'ok' else 'FAIL — storage.sql was re-run; re-run this file' end,
           'storage.sql is a one-time bootstrap; its "… own" rules are superseded'
    union all
    select 100, 'Readable keys stored so far',
           (select l.readable::text from legacy l),
           'informational. Once this is above 0, never roll this file back (see ROLLBACK POLICY at the top)'
    union all
    select 110, 'Next steps', 'info',
           're-run admin-inventory.sql; deploy admin-storage (when used), blender-bridge, image-proxy (Mac, after git pull); then publish the app'
  ) r
 order by r.ord;

-- ============================================================================
-- TURN — Team collaboration
-- Safe to re-run. Run after schema.sql and storage.sql.
--
-- Adds project memberships by email and changes RLS from owner-only access to
-- owner-or-project-member access. Roles (exactly three — the old producer_admin
-- role was retired; see migrate-remove-producer-admin.sql):
--   view_only      can open/read shared projects
--   writer         can edit project data and generated assets
--   art_director   can edit project data and generated assets
--
-- Storage keys (2026-09-27): the uploader and project folders may be bare ids
-- (older keys) or readable 'name--id' folders; the storage key helpers below
-- read only the id. storage-readable-folders.sql installs the same helpers and
-- rules, so re-running this file keeps readable keys working. A copy of this
-- file from before 2026-09-27 does NOT: it puts back an id-only
-- turn_storage_project_id and write rule (see supabase/README.md).
-- ============================================================================

-- (Team review, 2026-10-09) SUPERSEDED once team-relaunch.sql is installed: run
-- after it, this file brings back the member-wide read policy (every member would
-- see every other member's address) and email-only access by unconfirmed addresses —
-- silently undoing Team sharing's rules. So it refuses to run there and changes
-- nothing; team-relaunch.sql (re-runnable) is the file to run instead. A fresh
-- install runs this file BEFORE team-relaunch.sql, as always.
do $$
begin
  if to_regprocedure('public.turn_renew_invite(uuid)') is not null then
    raise exception using errcode = 'P0001',
      message = 'TURN_TEAM_SUPERSEDED: team-collaboration.sql would undo team-relaunch.sql, which is installed here. Nothing was changed. Run team-relaunch.sql instead (it is safe to re-run).';
  end if;
end;
$$;

create table if not exists public.turn_project_members (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.turn_projects(id) on delete cascade,
  owner        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  member_email text not null,
  member_user  uuid references auth.users(id) on delete cascade,
  role         text not null default 'writer'
    check (role in ('view_only','writer','art_director')),
  status       text not null default 'active'
    check (status in ('active','removed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, member_email)
);

create index if not exists turn_project_members_project_idx on public.turn_project_members(project_id);
create index if not exists turn_project_members_email_idx on public.turn_project_members(lower(member_email));
create index if not exists turn_project_members_user_idx on public.turn_project_members(member_user);

drop trigger if exists turn_project_members_touch on public.turn_project_members;
create trigger turn_project_members_touch before update on public.turn_project_members
  for each row execute function public.turn_touch_updated_at();

alter table public.turn_project_members enable row level security;

create or replace function public.turn_current_email() returns text
language sql stable
as $$
  select lower(coalesce(auth.jwt()->>'email', ''));
$$;

create or replace function public.turn_can_access_project(pid uuid, write_access boolean default false)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.turn_projects p
    where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1
    from public.turn_project_members m
    where m.project_id = pid
      and m.status = 'active'
      and (
        m.member_user = auth.uid()
        or lower(m.member_email) = public.turn_current_email()
      )
      and (
        not write_access
        or m.role in ('writer','art_director')
      )
  );
$$;

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

grant execute on function public.turn_current_email() to authenticated;
grant execute on function public.turn_can_access_project(uuid, boolean) to authenticated;

drop policy if exists "turn_project_members_select" on public.turn_project_members;
create policy "turn_project_members_select" on public.turn_project_members
  for select using (public.turn_can_access_project(project_id, false));

drop policy if exists "turn_project_members_insert_owner" on public.turn_project_members;
create policy "turn_project_members_insert_owner" on public.turn_project_members
  for insert with check (
    owner = auth.uid()
    and exists (
      select 1 from public.turn_projects p
      where p.id = project_id and p.owner = auth.uid()
    )
  );

drop policy if exists "turn_project_members_update_owner" on public.turn_project_members;
create policy "turn_project_members_update_owner" on public.turn_project_members
  for update using (
    exists (
      select 1 from public.turn_projects p
      where p.id = project_id and p.owner = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.turn_projects p
      where p.id = project_id and p.owner = auth.uid()
    )
  );

drop policy if exists "turn_project_members_delete_owner" on public.turn_project_members;
create policy "turn_project_members_delete_owner" on public.turn_project_members
  for delete using (
    exists (
      select 1 from public.turn_projects p
      where p.id = project_id and p.owner = auth.uid()
    )
  );

-- Replace owner-only project RLS with owner/member project RLS.
drop policy if exists "own turn projects" on public.turn_projects;
drop policy if exists "turn_projects_select_collab" on public.turn_projects;
drop policy if exists "turn_projects_insert_owner" on public.turn_projects;
drop policy if exists "turn_projects_update_collab" on public.turn_projects;
drop policy if exists "turn_projects_delete_owner" on public.turn_projects;

-- NOTE: the owner check must be DIRECT on the row (not via the helper).
-- INSERT ... RETURNING requires the new row to pass this select policy, and
-- turn_can_access_project(id) re-queries turn_projects — a row being inserted
-- by the current statement isn't visible to that query yet, so a helper-only
-- policy rejects every new film creation. (See fix-new-film-rls.sql.)
create policy "turn_projects_select_collab" on public.turn_projects
  for select using (
    owner = auth.uid()
    or public.turn_can_access_project(id, false)
  );

create policy "turn_projects_insert_owner" on public.turn_projects
  for insert with check (owner = auth.uid());

create policy "turn_projects_update_collab" on public.turn_projects
  for update using (public.turn_can_access_project(id, true))
  with check (public.turn_can_access_project(id, true));

create policy "turn_projects_delete_owner" on public.turn_projects
  for delete using (owner = auth.uid());

-- Generated image rows and their files are ART-DEPARTMENT work: only the film's
-- owner or an active art_director may create/replace/clear them. Writers keep
-- READ access (sheets stay visible) but cannot touch assets directly — the same
-- boundary the doc trigger enforces for doc sections, applied to assets.
create or replace function public.turn_can_write_assets(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.turn_projects p
    where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1 from public.turn_project_members m
    where m.project_id = pid
      and m.status = 'active'
      and m.role = 'art_director'
      and (m.member_user = auth.uid() or lower(m.member_email) = public.turn_current_email())
  );
$$;
grant execute on function public.turn_can_write_assets(uuid) to authenticated;

drop policy if exists "own turn generations" on public.turn_generations;
drop policy if exists "turn_generations_select_collab" on public.turn_generations;
drop policy if exists "turn_generations_insert_collab" on public.turn_generations;
drop policy if exists "turn_generations_update_collab" on public.turn_generations;
drop policy if exists "turn_generations_delete_collab" on public.turn_generations;

create policy "turn_generations_select_collab" on public.turn_generations
  for select using (public.turn_can_access_project(project_id, false));

create policy "turn_generations_insert_collab" on public.turn_generations
  for insert with check (
    owner = auth.uid()
    and public.turn_can_write_assets(project_id)
  );

create policy "turn_generations_update_collab" on public.turn_generations
  for update using (public.turn_can_write_assets(project_id))
  with check (public.turn_can_write_assets(project_id));

create policy "turn_generations_delete_collab" on public.turn_generations
  for delete using (public.turn_can_write_assets(project_id));

-- Attribution is immutable: the client's upsert always sends owner = itself, and
-- on conflict that would silently reassign an existing row to whoever regenerated
-- last (changing who the row-owner delete path answers to). Keep the creator.
create or replace function public.turn_generations_keep_owner()
returns trigger
language plpgsql
as $$
begin
  new.owner := old.owner;
  return new;
end;
$$;

drop trigger if exists turn_generations_keep_owner on public.turn_generations;
create trigger turn_generations_keep_owner
  before update on public.turn_generations
  for each row
  when (old.owner is distinct from new.owner)
  execute function public.turn_generations_keep_owner();

-- Storage access is authorized by the CURRENT membership on the project id
-- embedded in the path — never by folder ownership alone, so revoking or
-- demoting a collaborator cuts off their old uploads immediately. Reads need
-- read access to the film; writes stay pinned to the signed-in user's own
-- folder (the user id in folder 1, bare or as 'name--id') AND need asset-write
-- capability (owner / art_director); deletes are
-- asset-capable only — that already covers regeneration cleaning up rolled-off
-- history under ANY member's folder, so no own-folder exception is needed.
drop policy if exists "turn assets read own"   on storage.objects;
drop policy if exists "turn assets write own"  on storage.objects;
drop policy if exists "turn assets update own" on storage.objects;
drop policy if exists "turn assets delete own" on storage.objects;
drop policy if exists "turn assets read collab"   on storage.objects;
drop policy if exists "turn assets write collab"  on storage.objects;
drop policy if exists "turn assets update collab" on storage.objects;
drop policy if exists "turn assets delete collab" on storage.objects;

create policy "turn assets read collab" on storage.objects for select
  using (
    bucket_id = 'turn-assets'
    and public.turn_can_access_project(public.turn_storage_project_id(name), false)
  );

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

create policy "turn assets delete collab" on storage.objects for delete
  using (
    bucket_id = 'turn-assets'
    and public.turn_can_write_assets(public.turn_storage_project_id(name))
  );

-- ── Server-side role scoping (canonical copy — see enforce-role-scopes.sql) ──
-- The Writer / Art-director section limits are enforced IN THE DATABASE, not
-- just in the app: a trigger compares old vs new doc section by section against
-- the caller's role allowlist (server copy of TEAM_ROLE_SECTIONS in
-- app/team.jsx — keep the two in sync), and rejects out-of-scope changes even
-- from a hostile client. It also blocks ownership transfer by collaborators.
-- The _rev save fence is exempt; owners and solo films are unaffected.
create or replace function public.turn_role_allowed_sections(r text)
returns text[]
language sql
immutable
as $$
  select case r
    when 'writer' then
      array['scenes','beatsMap','drafts','history','continuityMap','project']
    when 'art_director' then
      array['characters','props','locations','lookbook','lookbookNote','lookbookApplied',
            'shots','trash','project','propsSeeded','locsSeeded','visualsSeeded','bible']
    else array[]::text[]   -- view_only, unknown and legacy roles: nothing
  end;
$$;

create or replace function public.turn_enforce_role_sections()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  allowed text[];
  k       text;
begin
  if caller is null then return new; end if;   -- service-role maintenance paths
  if old.owner = caller then return new; end if;

  if new.owner is distinct from old.owner then
    raise exception 'TURN_ROLE_SCOPE: only the owner can transfer a film''s ownership';
  end if;

  select coalesce(array_agg(distinct s), array[]::text[]) into allowed
  from public.turn_project_members m,
       unnest(public.turn_role_allowed_sections(m.role)) s
  where m.project_id = old.id
    and m.status = 'active'
    and (m.member_user = caller or lower(m.member_email) = public.turn_current_email());

  for k in
    select key from (
      select jsonb_object_keys(coalesce(old.doc, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(new.doc, '{}'::jsonb))
    ) keys
  loop
    if k = '_rev' then continue; end if;
    if (old.doc -> k) is distinct from (new.doc -> k) and not (k = any(allowed)) then
      raise exception 'TURN_ROLE_SCOPE: your role does not cover the "%" section of this film', k;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists turn_enforce_role_sections on public.turn_projects;
create trigger turn_enforce_role_sections
  before update on public.turn_projects
  for each row
  when (old.doc is distinct from new.doc or old.owner is distinct from new.owner)
  execute function public.turn_enforce_role_sections();

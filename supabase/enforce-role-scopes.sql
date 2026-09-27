-- ============================================================================
-- TURN — Server-side role scoping (run AFTER team-collaboration.sql).
-- Idempotent — safe to re-run.
--
-- Until now the Writer / Art-director section limits lived only in the app's
-- JavaScript: the database let ANY write-capable collaborator overwrite ANY
-- part of a film's document — and any of its generated assets — so a modified
-- client could bypass the UI checks. This migration makes the database enforce
-- what the UI promises:
--
--   1. A trigger on turn_projects compares the OLD and NEW doc section by
--      section and rejects any change outside the caller's role allowlist
--      (mirrors TEAM_ROLE_SECTIONS in app/team.jsx — keep the two in sync).
--      The atomic _rev save fence is untouched (_rev is always allowed).
--      It also stops a collaborator from transferring the film's ownership.
--   2. Generated assets (turn_generations rows + their storage files) become
--      ART-DEPARTMENT-only writes: the film's owner or an active art_director
--      may create/replace/clear them; writers and view-only members keep READ
--      access but cannot touch assets directly. New rows are attributed to
--      whoever generated them; a trigger keeps that attribution immutable on
--      later regenerations (an upsert can no longer reassign the row).
--   3. Storage access is authorized by CURRENT membership on the film in the
--      path — never by folder ownership alone, so revoking or demoting a
--      collaborator cuts off their old uploads immediately. Writes stay pinned
--      to the signed-in user's own top-level folder AND require asset-write
--      capability; reads need read access; deletes are asset-capable only
--      (which already covers history cleanup under any member's folder).
--      Folders may be bare ids or readable 'name--id' folders (2026-09-27);
--      the storage key helpers in section 3 read only the id.
--
-- View-only (and any unknown role) stays fully read-only: the update RLS
-- policy only admits 'writer'/'art_director', so such rows never reach the
-- trigger at all. Owners and solo films are completely unaffected.
--
-- The canonical copies of everything here live in team-collaboration.sql —
-- keep the two files identical.
-- ============================================================================

-- ── 1a. The per-role section allowlists (server copy of TEAM_ROLE_SECTIONS) ──
-- 'project' is writable by BOTH roles on purpose: it holds the story identity
-- (logline, premise) AND the style bible — locking either side out would block
-- ordinary work. 'bible' (a SHOW row's shared art bible) is art-department
-- content, so it belongs to art_director.
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

-- ── 1b. The enforcement trigger ──────────────────────────────────────────────
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
  -- No JWT context = service-role / owner maintenance paths (they bypass RLS
  -- anyway); the OWNER of the film is unrestricted. Everyone else is scoped.
  if caller is null then return new; end if;
  if old.owner = caller then return new; end if;

  -- a collaborator must never be able to reassign the film to themselves
  if new.owner is distinct from old.owner then
    raise exception 'TURN_ROLE_SCOPE: only the owner can transfer a film''s ownership';
  end if;

  -- Union of every active grant's allowlist (one user can match both a linked
  -- member_user row and an email row; RLS already guaranteed write capability).
  select coalesce(array_agg(distinct s), array[]::text[]) into allowed
  from public.turn_project_members m,
       unnest(public.turn_role_allowed_sections(m.role)) s
  where m.project_id = old.id
    and m.status = 'active'
    and (m.member_user = caller or lower(m.member_email) = public.turn_current_email());

  -- Compare the doc SECTION BY SECTION: any key added, removed or altered must
  -- be in the allowlist. _rev is the save fence every write advances — exempt.
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

-- ── 2. Asset-write capability: owner or active art_director only ─────────────
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

-- ── 3. Storage: own folder + asset-write capability on the film's paths ──────
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

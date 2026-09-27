-- ============================================================================
-- TURN — Supabase Storage  (paste the WHOLE contents into the SQL Editor → Run)
-- ⚠ ONE-TIME BOOTSTRAP. Do NOT re-run on a live project: the owner-only policies
--   below were superseded by team-collaboration.sql / enforce-role-scopes.sql /
--   series-production.sql / storage-readable-folders.sql, and re-running this
--   file brings the old ones back (they only understand bare-id folders).
-- Private bucket for generated images. Path convention (app/cloud.jsx -> turnStoragePath):
--   turn-assets/{uploader}/{project}/{folder}/{entity}[/states/{stateId}|/{sub}]/{timestamp}-{role}[-v{N}]-{shortId}.{ext}
-- {uploader} and {project} are each either a bare lowercase id (every key
-- written before 2026-09-27; valid forever) or, from storage-readable-folders.sql
-- on, a readable '{name}--{id}' folder, name first and the full id last:
--   admin--b2444e18-5133-4155-bb2f-d2719dcdb442/pine-soot--d4432e3f-3682-40e6-bff4-0c218dae6d1e/character/…
-- The name is lowercase [a-z0-9] runs joined by single hyphens, 1-64 characters,
-- with no 8 hex digits in a row anywhere; the access rules read ONLY the
-- id (turn_storage_uid / turn_storage_project_id in team-collaboration.sql).
-- folder: character|prop|location|shot|storyboard|lookbook|cameo|other (files made
-- before 2026-09-26 also use asset/ and locunit/, and keep their old names);
-- role: sheet|ref-<kind>|<cameo-angle>. v{N} is a non-authoritative version hint;
-- {timestamp}-{shortId} is the real uniqueness key; {ext} is the file's real type.
-- IMPORTANT: storage policies check folder[1] (the uploader) and folder[2] (the
-- project) — they MUST stay first and MUST always end in the full id. A folder's
-- name is display text that anyone can choose for their own folder: to see who
-- owns what (emails, titles), use the admin views in admin-inventory.sql, never
-- folder names.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('turn-assets', 'turn-assets', false)
on conflict (id) do nothing;

drop policy if exists "turn assets read own"   on storage.objects;
drop policy if exists "turn assets write own"  on storage.objects;
drop policy if exists "turn assets update own" on storage.objects;
drop policy if exists "turn assets delete own" on storage.objects;

create policy "turn assets read own" on storage.objects for select
  using (bucket_id = 'turn-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "turn assets write own" on storage.objects for insert
  with check (bucket_id = 'turn-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "turn assets update own" on storage.objects for update
  using (bucket_id = 'turn-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "turn assets delete own" on storage.objects for delete
  using (bucket_id = 'turn-assets' and (storage.foldername(name))[1] = auth.uid()::text);

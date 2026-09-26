-- ============================================================================
-- TURN — Supabase Storage  (paste the WHOLE contents into the SQL Editor → Run)
-- ⚠ ONE-TIME BOOTSTRAP. Do NOT re-run on a live project: the owner-only policies
--   below were superseded by team-collaboration.sql / enforce-role-scopes.sql /
--   series-production.sql, and re-running this file brings the old ones back.
-- Private bucket for generated images. Path convention (app/cloud.jsx -> turnStoragePath):
--   turn-assets/{uploader_id}/{project_id}/{folder}/{entity}[/states/{stateId}|/{sub}]/{timestamp}-{role}[-v{N}]-{shortId}.{ext}
-- folder: character|prop|location|shot|storyboard|lookbook|cameo|other (files made
-- before 2026-09-26 also use asset/ and locunit/, and keep their old names);
-- role: sheet|ref-<kind>|<cameo-angle>. v{N} is a non-authoritative version hint;
-- {timestamp}-{shortId} is the real uniqueness key; {ext} is the file's real type.
-- IMPORTANT: storage policies check folder[1] (the uploader) and folder[2] (the
-- project) — they MUST stay first and stay ids. To see names (emails, titles) for
-- those ids, use the admin views in admin-inventory.sql, never folder names.
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

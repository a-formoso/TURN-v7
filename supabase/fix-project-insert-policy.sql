-- REPAIR — "new row violates row-level security policy for table turn_projects"
-- Symptom: existing films load and save fine, but creating a NEW film always
-- fails with the RLS message above. That means the SELECT/UPDATE policies are
-- healthy but the INSERT policy is missing (usually a migration that dropped
-- the old policies and failed before recreating them all).
--
-- STEP 1 — confirm (run in the Supabase SQL editor):
--   select policyname, cmd from pg_policies where tablename = 'turn_projects';
-- Expected rows include one with cmd = 'INSERT'. If it's absent, run STEP 2.
--
-- STEP 2 — repair (idempotent, safe to run more than once):
drop policy if exists "turn_projects_insert_owner" on public.turn_projects;
create policy "turn_projects_insert_owner" on public.turn_projects
  for insert with check (owner = auth.uid());

-- fix-new-film-rls.sql — repairs "new row violates row-level security policy
-- for table turn_projects" when creating a NEW film.
--
-- ROOT CAUSE
--   The app creates a film with INSERT ... RETURNING (insert + read back in one
--   request). Postgres requires the returned row to ALSO pass the SELECT policy.
--   The select policy calls turn_can_access_project(id), which re-queries
--   turn_projects for that id — but inside the same INSERT statement the
--   brand-new row is not yet visible to that query, so the check fails and the
--   whole insert is rejected. The INSERT policy itself was always healthy.
--
-- FIX
--   Check ownership directly on the row first (no re-query — works for a row
--   being born this instant), and keep the membership helper only for the
--   collaborator path.

drop policy if exists "turn_projects_select_collab" on public.turn_projects;
create policy "turn_projects_select_collab" on public.turn_projects
  for select using (
    owner = auth.uid()
    or public.turn_can_access_project(id, false)
  );

-- ── verify ──────────────────────────────────────────────────────────────────
-- Should show the select policy with:  (owner = auth.uid()) OR turn_can_access_project(id, false)
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'turn_projects' and cmd = 'SELECT';

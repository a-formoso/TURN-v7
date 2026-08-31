-- ============================================================================
-- TURN — Retire the producer_admin role
-- Safe to re-run. Run once in the Supabase SQL editor on a project that was set
-- up with an earlier team-collaboration.sql (fresh setups already exclude the
-- role and don't need this file).
--
-- Why: "Producer/admin" promised team management it never had (only the film's
-- owner can invite/remove), while being unrestricted where the other roles are
-- scoped. The app now offers exactly three roles: view_only, writer,
-- art_director.
--
-- What this does, in order:
--   1. moves every existing producer_admin member to writer
--   2. tightens the role CHECK so the retired role can't be stored again
--   3. tightens the access helper so only writer/art_director count as
--      write-capable (view_only stays read-only)
-- ============================================================================

-- 1) migrate existing rows (no-op when none exist)
update public.turn_project_members
   set role = 'writer'
 where role = 'producer_admin';

-- 2) tighten the CHECK constraint (drop-then-add keeps this re-runnable)
alter table public.turn_project_members
  drop constraint if exists turn_project_members_role_check;
alter table public.turn_project_members
  add constraint turn_project_members_role_check
  check (role in ('view_only','writer','art_director'));

-- 3) write-capable roles are now exactly writer + art_director
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

grant execute on function public.turn_can_access_project(uuid, boolean) to authenticated;

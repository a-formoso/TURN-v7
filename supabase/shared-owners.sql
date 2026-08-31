-- ============================================================================
-- "Shared with me" — owner attribution for the home wall.
-- Run AFTER team-collaboration.sql. Idempotent — safe to run again.
--
-- The client can see WHICH projects are shared with it (membership rows), but
-- owner emails live in auth.users, which the client can never read. This tiny
-- definer function returns exactly one thing: the owner's email for each film
-- the CALLER is an active collaborator on — nothing about anyone else's films,
-- and nothing about other collaborators.
-- ============================================================================

create or replace function public.turn_shared_film_owners()
returns table (project_id uuid, owner_email text)
language sql
security definer
set search_path = public
stable
as $$
  select m.project_id, lower(u.email)::text as owner_email
  from public.turn_project_members m
  join public.turn_projects p on p.id = m.project_id
  join auth.users u on u.id = p.owner
  where coalesce(m.status,'active') = 'active'
    and (
      m.member_user = auth.uid()
      or lower(m.member_email) = public.turn_current_email()
    );
$$;

grant execute on function public.turn_shared_film_owners() to authenticated;
revoke execute on function public.turn_shared_film_owners() from anon;

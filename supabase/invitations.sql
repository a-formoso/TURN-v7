-- ============================================================================
-- TURN — Real invitations: account linking
-- Safe to re-run. Run after team-collaboration.sql.
--
-- Membership rows are created with only an email address. Until the invitee's
-- account id is linked, their access depends forever on an exact email match —
-- change the account email later and every shared film silently disappears.
--
-- turn_claim_memberships() runs as the SIGNED-IN INVITEE (the app calls it on
-- every authenticated boot): it links any active membership rows whose email
-- matches the caller's VERIFIED address (case-insensitive) to auth.uid(), and
-- returns what it linked so the app can announce "X shared 'Film' with you".
--
-- Safety:
--   • only rows with member_user IS NULL are claimable — a row already linked
--     to someone can never be stolen by a same-email account.
--   • the caller's email must be CONFIRMED (email_confirmed_at) — an
--     unconfirmed password signup typed with someone else's address must not
--     claim that person's invitations.
-- ============================================================================

-- (Team review, 2026-10-09) SUPERSEDED once team-relaunch.sql is installed: run
-- after it, this file brings back the claim without the 14-day expiry — silently
-- undoing Team sharing's rules. So it refuses to run there and changes nothing;
-- team-relaunch.sql (re-runnable) is the file to run instead. A fresh install runs
-- this file BEFORE team-relaunch.sql, as always.
do $$
begin
  if to_regprocedure('public.turn_renew_invite(uuid)') is not null then
    raise exception using errcode = 'P0001',
      message = 'TURN_TEAM_SUPERSEDED: invitations.sql would undo team-relaunch.sql, which is installed here. Nothing was changed. Run team-relaunch.sql instead (it is safe to re-run).';
  end if;
end;
$$;

create or replace function public.turn_claim_memberships()
returns table(project_id uuid, title text, invited_by text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    return;
  end if;
  return query
  with claimed as (
    update public.turn_project_members m
       set member_user = auth.uid()
     where m.member_user is null
       and m.status = 'active'
       and lower(m.member_email) = public.turn_current_email()
    returning m.project_id, m.role
  )
  select c.project_id, p.title, o.email::text, c.role
    from claimed c
    join public.turn_projects p on p.id = c.project_id
    left join auth.users o on o.id = p.owner;
end;
$$;

grant execute on function public.turn_claim_memberships() to authenticated;
revoke execute on function public.turn_claim_memberships() from anon;

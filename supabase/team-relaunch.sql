-- ============================================================================
-- Kinolot — Team relaunch (owner 2026-10-03: "Let's ship Collaboration (Teams)").
--
-- The rules are the owner's decisions in docs/Dashboard Plan.md §5-§7 and §9:
--   * Sharing is for an owner on Director or Producer in good standing (not
--     frozen, not past due). Trial, Writer and no-plan accounts can't invite.
--   * Collaborators per film: 5 on Director, 10 on Producer (pending invites
--     count); at most 3 Co-writers a film; 20 new invites per owner per day.
--   * Invites expire after 14 days; accepting needs a confirmed email.
--   * Roles: view_only, writer (shown "Co-writer"), art_director and the new
--     stage_editor (Producer films only). Every role reads the other rooms.
--   * Rooms follow the OWNER's plan. If the owner drops below Director (or a
--     payment fails), collaborators become read-only; nothing is deleted.
--   * The owner pays for work on the film, within a monthly budget per
--     collaborator (200 credits on Director, 500 on Producer by default; the
--     owner may change it per person, null = no limit).
--
-- What this file does:
--   1. Access by ACCOUNT. A linked membership (member_user set) matches that
--      account only; an unlinked invite matches the invited address only while
--      it hasn't expired AND that account's email is confirmed.
--   2. turn_claim_memberships() (supersedes invitations.sql) links invites on
--      sign-in: confirmed email, not expired.
--   3. The stage_editor role (role CHECK, its sections, write access).
--   4. A guard trigger on turn_project_members: the switch, the owner's plan,
--      the caps, the daily invite limit, no self-invite, no forged link. Each
--      refusal is 'TURN_TEAM:<code>' — app/cloud.jsx turns it into words.
--   5. Owner downgrade → collaborators read-only (access, assets, sections).
--   6. A private member list: the owner sees all rows; a collaborator sees only
--      their own. turn_leave_film() lets a collaborator leave.
--   7. Budgets: holds carry actor / project / member; turn_film_payer() and
--      turn_hold_credits_for_film() (service role: image-proxy, blender-bridge)
--      bill the owner within the collaborator's budget; spend readers.
--   8. The emergency switch: turn_app_config key 'team_sharing' ({"on": true}).
--      Off = no new invites or role changes (existing shares keep opening).
--
-- RUN ORDER: after series-production.sql (and storage-readable-folders.sql),
-- and AGAIN after any re-run of series-production.sql, enforce-role-scopes.sql,
-- team-collaboration.sql, shared-owners.sql, invitations.sql or
-- migrate-remove-producer-admin.sql — each of those puts back an older access
-- helper. Needs credits.sql (billing v2) and app-config.sql. One transaction;
-- safe to re-run. Tests: scripts/test-team-relaunch-db.mjs.
-- ============================================================================

begin;

-- ── 0. prerequisites ────────────────────────────────────────────────────────
do $$
declare
  problems text[] := array[]::text[];
begin
  if to_regprocedure('public.turn_series_membership_scope(uuid)') is null then
    problems := array_append(problems, 'missing public.turn_series_membership_scope(uuid) (run series-production.sql first)');
  end if;
  if to_regprocedure('public.turn_hold_credits(uuid,integer,text,text)') is null then
    problems := array_append(problems, 'missing public.turn_hold_credits (run credits.sql / billing-v2.sql first)');
  end if;
  if to_regclass('public.turn_app_config') is null then
    problems := array_append(problems, 'missing public.turn_app_config (run app-config.sql first)');
  end if;
  if exists (select 1 from public.turn_project_members where role = 'producer_admin') then
    problems := array_append(problems, 'members still hold producer_admin (run migrate-remove-producer-admin.sql first)');
  end if;
  if array_length(problems, 1) > 0 then
    raise exception using errcode = 'P0001',
      message = 'TURN_TEAM_PREREQUISITE: ' || array_to_string(problems, '; ');
  end if;
end;
$$;

-- ── 1. membership columns + the four roles ──────────────────────────────────
alter table public.turn_project_members add column if not exists invited_at     timestamptz;
alter table public.turn_project_members add column if not exists expires_at     timestamptz;
alter table public.turn_project_members add column if not exists budget_credits integer;
update public.turn_project_members set invited_at = created_at where invited_at is null;
alter table public.turn_project_members alter column invited_at set default now();

do $$
declare c record;
begin
  -- the role CHECK (named turn_project_members_role_check by every earlier file)
  for c in select conname from pg_constraint
            where conrelid = 'public.turn_project_members'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%role%view_only%' loop
    execute format('alter table public.turn_project_members drop constraint %I', c.conname);
  end loop;
  alter table public.turn_project_members add constraint turn_project_members_role_check
    check (role in ('view_only', 'writer', 'art_director', 'stage_editor'));
  if not exists (select 1 from pg_constraint where conrelid = 'public.turn_project_members'::regclass
                   and conname = 'turn_project_members_budget_check') then
    alter table public.turn_project_members add constraint turn_project_members_budget_check
      check (budget_credits is null or budget_credits >= 0);
  end if;
end;
$$;

-- what each role may write, by doc section (app/team.jsx TEAM_ROLE_SECTIONS mirrors it)
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
    when 'stage_editor' then
      array['shots','project']
    else array[]::text[]   -- view_only, unknown and legacy roles: nothing
  end;
$$;

-- ── 2. the switch, the owner's sharing tier ─────────────────────────────────
insert into public.turn_app_config(key, value) values ('team_sharing', '{"on": false}'::jsonb)
  on conflict (key) do nothing;

create or replace function public.turn_team_sharing_on()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce((select (c.value ->> 'on')::boolean from public.turn_app_config c
                    where c.key = 'team_sharing'), false);
$$;

-- 'studio' (Producer) | 'director' | 'none'. What the OWNER's account allows a
-- shared film: a frozen or past-due account, a trial, Writer or no plan → 'none'.
-- The admin account counts as Producer (it tests every room).
create or replace function public.turn_team_owner_tier(p_owner uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when exists (select 1 from auth.users u where u.id = p_owner
                  and lower(u.email) = 'admin@infinitestudioai.com') then 'studio'
    else coalesce((
      select case
        when c.frozen or c.payment_status <> 'active' then 'none'
        when lower(c.plan) in ('studio', 'producer') then 'studio'
        when lower(c.plan) in ('director', 'pro') then 'director'
        else 'none' end
        from public.turn_credits c where c.owner = p_owner), 'none')
  end;
$$;

create or replace function public.turn_team_cap(p_tier text)
returns integer language sql immutable as $$
  select case p_tier when 'studio' then 10 when 'director' then 5 else 0 end;
$$;
create or replace function public.turn_team_default_budget(p_tier text)
returns integer language sql immutable as $$
  select case p_tier when 'studio' then 500 when 'director' then 200 else 0 end;
$$;

-- The signed-in account's address once it is confirmed, else ''. Policies run as the
-- caller, who can't read auth.users, so they ask this definer helper.
create or replace function public.turn_confirmed_email()
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce((select lower(btrim(u.email)) from auth.users u
                    where u.id = auth.uid() and u.email_confirmed_at is not null), '');
$$;

-- Server-owned membership changes (an invitee claiming, a collaborator leaving, the
-- owner renewing an invite) run inside these definer functions with this flag set
-- for their own transaction only; the browser can't set a turn.* setting.
create or replace function public.turn__team_trusted()
returns boolean language sql stable as $$
  select coalesce(current_setting('turn.team_trusted', true), '') = 'on';
$$;

-- ── 3. effective roles — by account ─────────────────────────────────────────
-- The core: every role that applies to account p_uid at this target (series
-- scope as series-production.sql defines it), with the membership row it comes
-- from. A linked row matches its account only. An unlinked invite matches the
-- invited address only while it hasn't expired and the account confirmed it.
create or replace function public.turn_effective_project_roles_for(p_uid uuid, p_project_id uuid)
returns table(role text, member_id uuid)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select m.role, m.id
    from public.turn_project_members m
    join public.turn_series_membership_scope(p_project_id) scope
      on scope.project_id = m.project_id
   where m.status = 'active'
     and p_uid is not null
     and (
       m.member_user = p_uid
       or (
         m.member_user is null
         and (m.expires_at is null or m.expires_at > now())
         and exists (select 1 from auth.users u
                      where u.id = p_uid and u.email_confirmed_at is not null
                        and lower(btrim(u.email)) = m.member_email)
       )
     );
$$;

-- Same shape as series-production.sql's (every policy and trigger reads it).
create or replace function public.turn_effective_project_roles(p_project_id uuid)
returns table(role text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select distinct r.role from public.turn_effective_project_roles_for(auth.uid(), p_project_id) r;
$$;

-- A role writes only while the owner's plan carries it: the three writing roles
-- need Director or Producer; the Stage editor needs Producer.
create or replace function public.turn_team_role_writes(p_role text, p_tier text)
returns boolean language sql immutable as $$
  select case
    when p_role in ('writer', 'art_director') then p_tier in ('director', 'studio')
    when p_role = 'stage_editor' then p_tier = 'studio'
    else false end;
$$;

create or replace function public.turn_can_access_project(pid uuid, write_access boolean default false)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.turn_projects p
     where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1
      from public.turn_effective_project_roles(pid) r
     where not write_access
        or public.turn_team_role_writes(r.role, public.turn_team_owner_tier(
             (select p.owner from public.turn_projects p where p.id = pid)))
  );
$$;

-- Images and files: the Art director, and the Stage editor on a Producer film.
create or replace function public.turn_can_write_assets(pid uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.turn_projects p
     where p.id = pid and p.owner = auth.uid()
  ) or exists (
    select 1
      from public.turn_effective_project_roles(pid) r
     where r.role in ('art_director', 'stage_editor')
       and public.turn_team_role_writes(r.role, public.turn_team_owner_tier(
             (select p.owner from public.turn_projects p where p.id = pid)))
  );
$$;

grant execute on function public.turn_can_access_project(uuid, boolean) to anon, authenticated;
grant execute on function public.turn_can_write_assets(uuid) to anon, authenticated;

-- The section trigger (series-production.sql's, plus the owner's plan).
create or replace function public.turn_enforce_role_sections()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  allowed text[];
  tier text;
  k text;
begin
  if caller is null then return new; end if;
  if old.owner = caller then return new; end if;

  if new.owner is distinct from old.owner then
    raise exception 'TURN_ROLE_SCOPE: only the owner can transfer a film''s ownership';
  end if;

  tier := public.turn_team_owner_tier(old.owner);
  select coalesce(array_agg(distinct section_name), array[]::text[])
    into allowed
    from public.turn_effective_project_roles(old.id) r
    cross join lateral unnest(public.turn_role_allowed_sections(r.role))
      as permitted(section_name)
   where public.turn_team_role_writes(r.role, tier);

  for k in
    select key from (
      select jsonb_object_keys(coalesce(old.doc, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(new.doc, '{}'::jsonb))
    ) keys
  loop
    if k = '_rev' then continue; end if;
    if (old.doc -> k) is distinct from (new.doc -> k)
       and not (k = any(allowed)) then
      if tier = 'none' then
        raise exception 'TURN_ROLE_SCOPE: the film''s owner plan doesn''t include shared editing right now, so this film is read-only';
      end if;
      raise exception 'TURN_ROLE_SCOPE: your role does not cover the "%" section of this film', k;
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.turn_shared_film_owners()
returns table(project_id uuid, owner_email text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.id, lower(u.email)::text
    from public.turn_projects p
    join auth.users u on u.id = p.owner
   where p.owner <> auth.uid()
     and public.turn_can_access_project(p.id, false);
$$;

revoke all on function public.turn_shared_film_owners() from public, anon;
grant execute on function public.turn_shared_film_owners() to authenticated;

-- What a shared film's rooms follow: the owner's tier, for anyone who can open it.
create or replace function public.turn_film_owner_tier(pid uuid)
returns text
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case when public.turn_can_access_project(pid, false)
    then public.turn_team_owner_tier((select p.owner from public.turn_projects p where p.id = pid))
    else null end;
$$;

-- ── 4. claiming an invite (supersedes invitations.sql) ──────────────────────
create or replace function public.turn_claim_memberships()
returns table(project_id uuid, title text, invited_by text, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  select lower(btrim(u.email)) into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' then
    return;
  end if;
  perform set_config('turn.team_trusted', 'on', true);
  return query
  with claimed as (
    update public.turn_project_members m
       set member_user = auth.uid(), expires_at = null
     where m.member_user is null
       and m.status = 'active'
       and (m.expires_at is null or m.expires_at > now())
       and m.member_email = v_email
    returning m.project_id, m.role
  )
  select c.project_id, p.title, o.email::text, c.role
    from claimed c
    join public.turn_projects p on p.id = c.project_id
    left join auth.users o on o.id = p.owner;
  perform set_config('turn.team_trusted', 'off', true);
end;
$$;

revoke all on function public.turn_claim_memberships() from public, anon;
grant execute on function public.turn_claim_memberships() to authenticated;

-- ── 5. the member guard: switch, plan, caps, daily limit ───────────────────
create table if not exists public.turn_team_invite_log (
  id         bigint generated always as identity primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  at         timestamptz not null default now()
);
create index if not exists turn_team_invite_log_owner_idx on public.turn_team_invite_log(owner, at desc);
alter table public.turn_team_invite_log enable row level security;
revoke all on public.turn_team_invite_log from anon, authenticated;

create or replace function public.turn_guard_team_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller   uuid := auth.uid();
  v_owner  uuid;
  v_email  text;
  tier     text;
  is_admin boolean;
  opening  boolean;   -- a new invite: an insert, or a removed row made active again
  n        integer;
begin
  -- Service-role paths (the invite function linking an account, migrations) and the
  -- server-owned changes above keep their authority.
  if caller is null or public.turn__team_trusted() then return new; end if;

  select p.owner into v_owner from public.turn_projects p where p.id = new.project_id;
  if v_owner is null or v_owner <> caller then
    raise exception 'TURN_TEAM:owner_only: only the film''s owner manages its team';
  end if;
  new.owner := v_owner;

  if tg_op = 'UPDATE' then
    -- the address and the linked account are never rewritten by the browser
    new.member_email := old.member_email;
    new.member_user  := old.member_user;
    new.invited_at   := old.invited_at;
    new.expires_at   := old.expires_at;
    -- a removal, or a budget change, needs no plan: the owner can always tidy up
    if new.status = 'removed'
       or (new.role = old.role and new.status = old.status) then
      return new;
    end if;
  else
    new.member_user := null;   -- linking happens only by the invitee's own claim
    new.status := 'active';
    new.member_email := lower(btrim(coalesce(new.member_email, '')));
  end if;

  opening := tg_op = 'INSERT' or (old.status = 'removed' and new.status = 'active');
  select lower(u.email) = 'admin@infinitestudioai.com', lower(btrim(u.email))
    into is_admin, v_email from auth.users u where u.id = caller;

  if not public.turn_team_sharing_on() and not coalesce(is_admin, false) then
    raise exception 'TURN_TEAM:paused: team sharing is switched off right now';
  end if;
  tier := public.turn_team_owner_tier(v_owner);
  if tier = 'none' then
    raise exception 'TURN_TEAM:plan_required: sharing a film needs the Director or Producer plan';
  end if;
  if new.role = 'stage_editor' and tier <> 'studio' then
    raise exception 'TURN_TEAM:stage_editor_producer: the Stage editor role needs the Producer plan';
  end if;
  if new.member_email = v_email then
    raise exception 'TURN_TEAM:self: you can''t invite yourself';
  end if;

  -- people on the film: joined, plus invites that haven't expired (this row excluded)
  select count(*) into n from public.turn_project_members m
   where m.project_id = new.project_id and m.status = 'active' and m.id <> new.id
     and (m.member_user is not null or m.expires_at is null or m.expires_at > now());
  if n + 1 > public.turn_team_cap(tier) then
    raise exception 'TURN_TEAM:cap:%: this film already has its % collaborators', public.turn_team_cap(tier), public.turn_team_cap(tier);
  end if;
  if new.role = 'writer' then
    select count(*) into n from public.turn_project_members m
     where m.project_id = new.project_id and m.status = 'active' and m.id <> new.id and m.role = 'writer'
       and (m.member_user is not null or m.expires_at is null or m.expires_at > now());
    if n + 1 > 3 then
      raise exception 'TURN_TEAM:cowriter_cap: a film can have up to 3 Co-writers';
    end if;
  end if;

  if opening then
    select count(*) into n from public.turn_team_invite_log l
     where l.owner = v_owner and l.at > now() - interval '1 day';
    if n >= 20 then
      raise exception 'TURN_TEAM:daily_cap: you can send up to 20 new invites a day';
    end if;
    insert into public.turn_team_invite_log(owner, project_id) values (v_owner, new.project_id);
    new.invited_at := now();
    if new.member_user is null then
      new.expires_at := now() + interval '14 days';
    end if;
    if tg_op = 'INSERT' then
      new.budget_credits := public.turn_team_default_budget(tier);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists turn_guard_team_member on public.turn_project_members;
create trigger turn_guard_team_member
  before insert or update on public.turn_project_members
  for each row execute function public.turn_guard_team_member();

-- the owner re-sends an expired or unanswered invite: a fresh 14 days (counts as a new invite)
create or replace function public.turn_renew_invite(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.turn_project_members;
  n integer;
begin
  select * into m from public.turn_project_members x where x.id = p_member;
  if not found or m.owner <> auth.uid()
     or not exists (select 1 from public.turn_projects p where p.id = m.project_id and p.owner = auth.uid()) then
    raise exception 'TURN_TEAM:owner_only: only the film''s owner manages its team';
  end if;
  if m.status <> 'active' or m.member_user is not null then
    return jsonb_build_object('ok', true, 'joined', m.member_user is not null);
  end if;
  if not public.turn_team_sharing_on()
     and not exists (select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = 'admin@infinitestudioai.com') then
    raise exception 'TURN_TEAM:paused: team sharing is switched off right now';
  end if;
  if public.turn_team_owner_tier(m.owner) = 'none' then
    raise exception 'TURN_TEAM:plan_required: sharing a film needs the Director or Producer plan';
  end if;
  select count(*) into n from public.turn_team_invite_log l
   where l.owner = m.owner and l.at > now() - interval '1 day';
  if n >= 20 then
    raise exception 'TURN_TEAM:daily_cap: you can send up to 20 new invites a day';
  end if;
  insert into public.turn_team_invite_log(owner, project_id) values (m.owner, m.project_id);
  -- the guard keeps expiry server-owned on browser updates; this definer path sets it
  perform set_config('turn.team_trusted', 'on', true);
  update public.turn_project_members set invited_at = now(), expires_at = now() + interval '14 days'
   where id = p_member;
  perform set_config('turn.team_trusted', 'off', true);
  return jsonb_build_object('ok', true, 'expires_at', now() + interval '14 days');
end;
$$;

-- ── 6. a private member list; leaving a film ────────────────────────────────
drop policy if exists "turn_project_members_select" on public.turn_project_members;
create policy "turn_project_members_select" on public.turn_project_members
  for select using (
    exists (select 1 from public.turn_projects p where p.id = project_id and p.owner = auth.uid())
    or member_user = auth.uid()
    or (member_user is null and status = 'active'
        and (expires_at is null or expires_at > now())
        and public.turn_confirmed_email() <> '' and member_email = public.turn_confirmed_email())
  );

create or replace function public.turn_leave_film(pid uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  perform set_config('turn.team_trusted', 'on', true);
  update public.turn_project_members m
     set status = 'removed'
   where m.status = 'active'
     and m.id in (select r.member_id from public.turn_effective_project_roles_for(auth.uid(), pid) r);
  get diagnostics n = row_count;
  perform set_config('turn.team_trusted', 'off', true);
  return n;
end;
$$;

-- ── 7. budgets: the owner pays, within each collaborator's monthly budget ───
alter table public.turn_credit_holds add column if not exists actor      uuid;
alter table public.turn_credit_holds add column if not exists project_id uuid;
alter table public.turn_credit_holds add column if not exists member_id  uuid;
create index if not exists turn_credit_holds_member_idx on public.turn_credit_holds(member_id, created_at)
  where member_id is not null;

-- credits a membership used this calendar month (UTC): open holds + what settled holds kept
create or replace function public.turn__member_spent(p_member uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(sum(case h.status when 'held' then h.held when 'settled' then coalesce(h.kept, 0) else 0 end), 0)::integer
    from public.turn_credit_holds h
   where h.member_id = p_member
     and h.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

-- Who pays for a call on a film (service role). p_room: 'writers' | 'art' | 'stage'.
--   {ok:true, payer, own:true}                      the caller owns the film
--   {ok:true, payer:owner, actor, member_id, budget, spent, tier}   a collaborator
--   {ok:false, code:'owner_plan' | 'budget_reached'}  refuse the call
--   {ok:false, code:'not_member' | 'role' | 'no_film' | 'off'}   bill the caller, as before
create or replace function public.turn_film_payer(p_actor uuid, p_project uuid, p_room text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_owner uuid;
  tier    text;
  need    text;
  pick    record;
  spent   integer;
begin
  perform public.turn__service_only('turn_film_payer');
  if p_actor is null or p_project is null then
    return jsonb_build_object('ok', false, 'code', 'no_film');
  end if;
  select p.owner into v_owner from public.turn_projects p where p.id = p_project;
  if v_owner is null then return jsonb_build_object('ok', false, 'code', 'no_film'); end if;
  if v_owner = p_actor then return jsonb_build_object('ok', true, 'payer', p_actor, 'own', true); end if;
  if not public.turn_team_sharing_on() then return jsonb_build_object('ok', false, 'code', 'off'); end if;
  need := case p_room when 'art' then 'art_director' when 'stage' then 'stage_editor' else 'writer' end;
  select r.role, r.member_id, m.budget_credits into pick
    from public.turn_effective_project_roles_for(p_actor, p_project) r
    join public.turn_project_members m on m.id = r.member_id
   where m.member_user = p_actor
   order by (r.role = need) desc, (m.project_id = p_project) desc
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_member'); end if;
  if pick.role <> need then return jsonb_build_object('ok', false, 'code', 'role', 'role', pick.role); end if;
  tier := public.turn_team_owner_tier(v_owner);
  if not public.turn_team_role_writes(pick.role, tier) then
    return jsonb_build_object('ok', false, 'code', 'owner_plan', 'tier', tier);
  end if;
  spent := public.turn__member_spent(pick.member_id);
  if pick.budget_credits is not null and spent >= pick.budget_credits then
    return jsonb_build_object('ok', false, 'code', 'budget_reached', 'budget', pick.budget_credits, 'spent', spent);
  end if;
  return jsonb_build_object('ok', true, 'payer', v_owner, 'actor', p_actor, 'member_id', pick.member_id,
    'role', pick.role, 'budget', pick.budget_credits, 'spent', spent, 'tier', tier);
end $$;

-- Hold on the OWNER's balance for a collaborator's call (service role). The owner's
-- account row is locked first, so two calls can't both pass the budget check.
create or replace function public.turn_hold_credits_for_film(p_owner uuid, p_actor uuid, p_member uuid,
  p_project uuid, amount integer, ref text, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget integer;
  v_spent  integer;
  v_res    jsonb;
begin
  perform public.turn__service_only('turn_hold_credits_for_film');
  perform 1 from public.turn_credits c where c.owner = p_owner for update;
  if exists (select 1 from public.turn_credit_holds h where h.ref = turn_hold_credits_for_film.ref) then
    return public.turn_hold_credits(p_owner, amount, ref, reason);   -- a repeat: the first answer
  end if;
  select m.budget_credits into v_budget from public.turn_project_members m
   where m.id = p_member and m.member_user = p_actor and m.status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_member', 'held', 0);
  end if;
  v_spent := public.turn__member_spent(p_member);
  if v_budget is not null and v_spent + coalesce(amount, 0) > v_budget then
    return jsonb_build_object('ok', false, 'code', 'budget_reached', 'held', 0,
      'budget', v_budget, 'spent', v_spent, 'needed', amount);
  end if;
  v_res := public.turn_hold_credits(p_owner, amount, ref, reason);
  if coalesce((v_res ->> 'ok')::boolean, false) and not coalesce((v_res ->> 'duplicate')::boolean, false) then
    update public.turn_credit_holds h set actor = p_actor, project_id = p_project, member_id = p_member
     where h.ref = turn_hold_credits_for_film.ref;
  end if;
  return v_res || jsonb_build_object('budget', v_budget, 'spent',
    v_spent + case when coalesce((v_res ->> 'ok')::boolean, false) then coalesce(amount, 0) else 0 end);
end $$;

-- This month's use per collaborator, for the film's owner (the Team window) or,
-- for their own row, the collaborator.
create or replace function public.turn_team_spend(pid uuid)
returns table(member_id uuid, spent integer, budget integer)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select m.id, public.turn__member_spent(m.id), m.budget_credits
    from public.turn_project_members m
   where m.project_id = pid and m.status = 'active'
     and (exists (select 1 from public.turn_projects p where p.id = pid and p.owner = auth.uid())
          or m.member_user = auth.uid());
$$;

-- ── 8. privileges ───────────────────────────────────────────────────────────
revoke all on function public.turn_effective_project_roles_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.turn_effective_project_roles(uuid) from public, anon, authenticated;
revoke all on function public.turn_team_owner_tier(uuid) from public, anon, authenticated;
revoke all on function public.turn_guard_team_member() from public, anon, authenticated;
revoke all on function public.turn_enforce_role_sections() from public, anon, authenticated;
revoke all on function public.turn__member_spent(uuid) from public, anon, authenticated;
revoke all on function public.turn_film_payer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.turn_hold_credits_for_film(uuid, uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.turn_film_payer(uuid, uuid, text) to service_role;
grant execute on function public.turn_hold_credits_for_film(uuid, uuid, uuid, uuid, integer, text, text) to service_role;
revoke all on function public.turn__team_trusted() from public, anon, authenticated;
revoke all on function public.turn_confirmed_email() from public, anon;
grant execute on function public.turn_confirmed_email() to authenticated;
revoke all on function public.turn_team_sharing_on() from public, anon;
grant execute on function public.turn_team_sharing_on() to authenticated, service_role;
revoke all on function public.turn_film_owner_tier(uuid) from public, anon;
grant execute on function public.turn_film_owner_tier(uuid) to authenticated;
revoke all on function public.turn_renew_invite(uuid) from public, anon;
grant execute on function public.turn_renew_invite(uuid) to authenticated;
revoke all on function public.turn_leave_film(uuid) from public, anon;
grant execute on function public.turn_leave_film(uuid) to authenticated;
revoke all on function public.turn_team_spend(uuid) from public, anon;
grant execute on function public.turn_team_spend(uuid) to authenticated;

commit;

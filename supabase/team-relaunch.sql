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
--      Off = no new invites or role changes, and (owner decision B, 2026-10-09)
--      collaborators are READ-ONLY on shared films and nobody is charged for
--      them; owners can still remove people and change budgets, collaborators
--      can still leave, pending invites can still be claimed (read-only).
--   9. (Team review, 2026-10-09) Private presence: Realtime Authorization
--      policies on realtime.messages for the 'film:<id>' and 'doc:<id>'
--      channels (skipped where the realtime schema doesn't exist).
--
-- (Team review, 2026-10-09) What changed in this pass, by the owner's decisions:
--   * One shared check (turn__team_check) for the guard AND turn_renew_invite:
--     the switch, the plan, the Stage editor, the people cap, the Co-writer cap
--     and the daily limit, each under an advisory lock (no two invites race).
--   * The people cap runs only when a NEW place opens (an invite, a re-invite of
--     someone removed, a renewal) — after a drop from Producer to Director the
--     people already there keep their roles (decision F).
--   * People invited to a whole Show count in EACH Episode's caps (decision E).
--   * Adding back someone who was removed or who left is a fresh invite: the row
--     is unlinked again and needs their claim, within 14 days (decision D). (The
--     removed row keeps its link until then, so series-production.sql's retiring
--     of a Show member's old Episode rows still matches them by account.)
--   * Turning a shared film into a Show copies the team faithfully (accounts,
--     roles, budgets, join times, spend) — no checks, no notices, no daily count.
--   * A Stage editor writes only the Stage's take records ('clip-…' rows), not
--     the Art Room's images or files; the Art director doesn't write the Stage's.
--   * The trusted flag is a row only this file's definer functions can write
--     (a turn.* setting could be set by anyone with a SQL session).
--   * turn_hold_credits_for_film re-derives the owner and the film from the
--     membership and re-checks everything under the owner's lock.
--   * Superseded files (team-collaboration.sql, invitations.sql,
--     shared-owners.sql, enforce-role-scopes.sql) refuse to run once this file
--     is installed; migrate-remove-producer-admin.sql becomes a no-op.
--
-- RUN ORDER: after series-production.sql (and storage-readable-folders.sql),
-- and AGAIN after any re-run of series-production.sql (it puts back older
-- access helpers). Once this file is installed, enforce-role-scopes.sql,
-- team-collaboration.sql, shared-owners.sql and invitations.sql refuse to run
-- (they would undo it) and migrate-remove-producer-admin.sql changes nothing.
-- Needs credits.sql (billing v2) and app-config.sql. One transaction; safe to
-- re-run, also over a database where an earlier copy of it ran.
-- Tests: scripts/test-team-relaunch-db.mjs.
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
alter table public.turn_project_members add column if not exists email_sent_at  timestamptz;   -- invite-collaborator
-- the owner's notifications (2026-10-03): when the invitee joined, and when the owner saw it
alter table public.turn_project_members add column if not exists joined_at      timestamptz;
alter table public.turn_project_members add column if not exists owner_seen_at  timestamptz;
-- rows linked before joined_at existed: their link time is their last change
update public.turn_project_members set joined_at = updated_at where member_user is not null and joined_at is null;
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

-- SEVERAL ROLES PER PERSON (owner 2026-10-03: "allow more than one role per person"): `roles` is
-- the set a membership holds — any of writer / art_director / stage_editor together, or
-- view_only alone. `role` stays, kept equal to the set's first role (the order below), for
-- everything that reads one role (older app builds, the probe, the invite email).
alter table public.turn_project_members add column if not exists roles text[];
update public.turn_project_members set roles = array[role] where roles is null;
create or replace function public.turn_team_canonical_roles(p_roles text[])
returns text[]
language sql
immutable
as $$
  with given as (select distinct x from unnest(coalesce(p_roles, array[]::text[])) x where x is not null),
  editing as (select x from given where x <> 'view_only')
  select case
    when exists (select 1 from editing) then
      (select array_agg(x order by case x when 'writer' then 1 when 'art_director' then 2 when 'stage_editor' then 3 else 4 end) from editing)
    when exists (select 1 from given) then array['view_only']
    else null end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.turn_project_members'::regclass
                   and conname = 'turn_project_members_roles_check') then
    alter table public.turn_project_members add constraint turn_project_members_roles_check
      check (roles is not null and cardinality(roles) between 1 and 3
             and roles <@ array['view_only', 'writer', 'art_director', 'stage_editor']
             and (cardinality(roles) = 1 or not ('view_only' = any(roles)))
             and role = roles[1]) not valid;
  end if;
end;
$$;
alter table public.turn_project_members validate constraint turn_project_members_roles_check;
-- a role string as the app shows it: 'writer+art_director'
create or replace function public.turn_team_roles_text(p_roles text[], p_role text)
returns text language sql immutable as $$
  select array_to_string(coalesce(p_roles, array[p_role]), '+');
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
      array['characters','props','locations','sluglineUnits','lookbook','lookbookNote','lookbookApplied',
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

-- The studio's admin account (it tests every room, and may invite while the switch
-- is off). (Team review, 2026-10-09) Only once its address is CONFIRMED: an
-- unconfirmed sign-up typed with the admin's address is nobody.
create or replace function public.turn__is_team_admin(p_uid uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p_uid is not null and exists (
    select 1 from auth.users u
     where u.id = p_uid and u.email_confirmed_at is not null
       and lower(btrim(u.email)) = 'admin@infinitestudioai.com');
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
    when public.turn__is_team_admin(p_owner) then 'studio'
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
-- owner renewing an invite, the bell's "seen") run inside these definer functions
-- with this flag set for their own transaction only.
-- (Team review, 2026-10-09) The flag used to be a turn.* setting, which anyone with
-- a SQL session can set (PostgREST can't, but nothing else stopped it). It is now a
-- row keyed by the transaction id in a table nobody but the definer functions can
-- write: set_config can't forge it, and the row is gone before the call returns.
create table if not exists public.turn__team_trust (
  tx bigint primary key
);
alter table public.turn__team_trust enable row level security;
revoke all on public.turn__team_trust from public, anon, authenticated;

create or replace function public.turn__team_trust(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_on then
    insert into public.turn__team_trust(tx) values (txid_current()) on conflict (tx) do nothing;
  else
    delete from public.turn__team_trust where tx = txid_current();
  end if;
end;
$$;

create or replace function public.turn__team_trusted()
returns boolean
language sql
security definer
set search_path = public, pg_temp
volatile
as $$
  select exists (select 1 from public.turn__team_trust t where t.tx = txid_current());
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
  select r.role, m.id
    from public.turn_project_members m
    join public.turn_series_membership_scope(p_project_id) scope
      on scope.project_id = m.project_id
    cross join lateral unnest(coalesce(m.roles, array[m.role])) as r(role)
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

-- A collaborator's role writes on a film owned by p_owner: the switch is on (owner
-- decision B, 2026-10-09: off = every collaborator read-only) and the owner's plan
-- carries the role (decision A: a lapsed plan = read-only). Reads never ask this.
create or replace function public.turn__collab_writes(p_role text, p_owner uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.turn_team_sharing_on()
     and public.turn_team_role_writes(p_role, public.turn_team_owner_tier(p_owner));
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
        or public.turn__collab_writes(r.role,
             (select p.owner from public.turn_projects p where p.id = pid))
  );
$$;

-- The Art Room's images and files (every turn-assets key under a project folder,
-- upload reservations, cameos): the owner and the Art director.
-- (Team review, 2026-10-09) The Stage editor no longer passes here: the Stage keeps
-- no files in the film's folders (a take is a 'clip-…' row holding the provider's
-- URL; device uploads go to the uploader's own stage-tmp/ folder), and letting it
-- through meant a Stage editor could replace or delete the Art Room's sheets.
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
     where r.role = 'art_director'
       and public.turn__collab_writes(r.role,
             (select p.owner from public.turn_projects p where p.id = pid))
  );
$$;

-- A Stage slot in turn_generations: a clip's take record (app/cloud.jsx
-- cloudCommitVideo: entity_id 'clip-…', meta.kind 'video', no storage path).
-- Everything else in the table is the Art Room's.
create or replace function public.turn_is_stage_slot(p_entity_id text, p_meta jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_entity_id, '') like 'clip-%' and coalesce(p_meta ->> 'kind', '') = 'video';
$$;

-- (Team review, 2026-10-09) Who may create, change or clear one turn_generations
-- row: the owner; the Art director for the Art Room's rows; the Stage editor for
-- the Stage's rows (on a Producer film). The policies check the OLD row (update,
-- delete) and the NEW row (insert, update), so a row can't change room either.
create or replace function public.turn_can_write_generation(pid uuid, p_entity_id text, p_meta jsonb)
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
     where r.role = case when public.turn_is_stage_slot(p_entity_id, p_meta)
                         then 'stage_editor' else 'art_director' end
       and public.turn__collab_writes(r.role,
             (select p.owner from public.turn_projects p where p.id = pid))
  );
$$;

-- These run inside RLS policies, evaluated as the calling role: both API roles keep EXECUTE.
grant execute on function public.turn_can_access_project(uuid, boolean) to anon, authenticated;
grant execute on function public.turn_can_write_assets(uuid) to anon, authenticated;
grant execute on function public.turn_can_write_generation(uuid, text, jsonb) to anon, authenticated;

drop policy if exists "turn_generations_insert_collab" on public.turn_generations;
drop policy if exists "turn_generations_update_collab" on public.turn_generations;
drop policy if exists "turn_generations_delete_collab" on public.turn_generations;
create policy "turn_generations_insert_collab" on public.turn_generations
  for insert with check (
    owner = auth.uid()
    and public.turn_can_write_generation(project_id, entity_id, meta)
  );
create policy "turn_generations_update_collab" on public.turn_generations
  for update using (public.turn_can_write_generation(project_id, entity_id, meta))
  with check (public.turn_can_write_generation(project_id, entity_id, meta));
create policy "turn_generations_delete_collab" on public.turn_generations
  for delete using (public.turn_can_write_generation(project_id, entity_id, meta));

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
   where public.turn__collab_writes(r.role, old.owner);

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
      if not public.turn_team_sharing_on() then
        raise exception 'TURN_ROLE_SCOPE: team sharing is paused right now, so this film is read-only';
      end if;
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
  perform public.turn__team_trust(true);
  return query
  with claimed as (
    update public.turn_project_members m
       set member_user = auth.uid(), expires_at = null, joined_at = now(), owner_seen_at = null
     where m.member_user is null
       and m.status = 'active'
       and (m.expires_at is null or m.expires_at > now())
       and m.member_email = v_email
    returning m.project_id, public.turn_team_roles_text(m.roles, m.role) as role
  )
  select c.project_id, p.title, o.email::text, c.role
    from claimed c
    join public.turn_projects p on p.id = c.project_id
    left join auth.users o on o.id = p.owner;
  perform public.turn__team_trust(false);
end;
$$;

revoke all on function public.turn_claim_memberships() from public, anon;
grant execute on function public.turn_claim_memberships() to authenticated;

-- ── 5. the member guard: switch, plan, caps, daily limit ───────────────────
-- every new invite (kind 'invite': the 20-a-day rule) and every invitation email the
-- invite-collaborator function sent (kind 'email': its own daily cap)
create table if not exists public.turn_team_invite_log (
  id         bigint generated always as identity primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  at         timestamptz not null default now()
);
alter table public.turn_team_invite_log add column if not exists kind text not null default 'invite';
create index if not exists turn_team_invite_log_owner_idx on public.turn_team_invite_log(owner, at desc);
alter table public.turn_team_invite_log enable row level security;
revoke all on public.turn_team_invite_log from anon, authenticated;

-- The Show a film's team is counted in, which is also the key of its advisory lock:
-- an Episode's Show, a Show itself, or (a film outside any Show) the film itself.
create or replace function public.turn__team_family(p_project uuid)
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when p.project_kind = 'show' or public.turn_series_doc_is_show(p.doc) then p.id
    else coalesce((select s.id from public.turn_projects s
                    where s.id = coalesce(p.show_id, public.turn_series_doc_show_id(p.doc))
                      and s.owner = p.owner
                      and (s.project_kind = 'show' or public.turn_series_doc_is_show(s.doc))), p.id)
  end
    from public.turn_projects p
   where p.id = p_project;
$$;

-- (Team review, 2026-10-09; owner decision E) The number of people a film's caps see.
-- THE RULE: someone invited to a whole Show is on every one of its Episodes, so an
-- Episode counts its own invites PLUS its Show's, one place per invited address
-- (the same address on the Show and on the Episode is one person). A film outside
-- any Show counts its own. An invite to the Show itself must fit EVERY Episode, so
-- a Show's answer is its fullest Episode (or the Show on its own while it has
-- none). Counted: active rows that joined or whose invite hasn't expired, minus
-- p_exclude (the row being changed), plus p_email (the person being added).
-- p_writers: count Co-writers only (the 3-Co-writer cap).
create or replace function public.turn__team_places(p_project uuid, p_exclude uuid, p_email text, p_writers boolean)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with target as (
    select p.id, p.owner,
           (p.project_kind = 'show' or public.turn_series_doc_is_show(p.doc)) as is_show,
           public.turn__team_family(p.id) as family
      from public.turn_projects p
     where p.id = p_project
  ),
  units as (
    -- the film (or the Episode) with its Show; `family` is the film itself outside a Show
    select array[t.id, t.family] as scope from target t where not t.is_show
    union all
    -- a Show: each of its Episodes with the Show...
    select array[e.id, t.id]
      from target t
      join public.turn_projects e
        on coalesce(e.show_id, public.turn_series_doc_show_id(e.doc)) = t.id
     where t.is_show and e.id <> t.id and e.owner = t.owner
       and not public.turn_series_doc_is_show(e.doc)
    union all
    -- ...and the Show on its own (no Episodes yet)
    select array[t.id] from target t where t.is_show
  )
  select coalesce(max(c.n), 0)::integer
    from units u
    cross join lateral (
      select count(*) as n from (
        select m.member_email
          from public.turn_project_members m
         where m.project_id = any(u.scope)
           and m.status = 'active'
           and m.id is distinct from p_exclude
           and (m.member_user is not null or m.expires_at is null or m.expires_at > now())
           and (not p_writers or 'writer' = any(coalesce(m.roles, array[m.role])))
        union
        select lower(btrim(p_email)) where p_email is not null
      ) people
    ) c;
$$;

-- (Team review, 2026-10-09) The checks an invite or a role change must pass, shared by
-- the member guard and turn_renew_invite (a renewal used to skip the caps). Raises
-- 'TURN_TEAM:<code>'; returns the owner's tier.
--   p_old_roles  the roles before a role change; null for a new place
--   p_opening    a NEW place: an invite, re-inviting someone removed, a renewal. Only
--                then do the people cap and the daily limit apply (owner decision F:
--                after a drop from Producer to Director the people already on the
--                film keep their places and roles; no new invites until under the cap).
-- Locks: the Show family's before counting people and Co-writers, the owner's before
-- counting today's invites, so two invites at once can't both take the last place.
create or replace function public.turn__team_check(p_project uuid, p_owner uuid, p_member uuid,
  p_email text, p_roles text[], p_old_roles text[], p_opening boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tier text;
  cap  integer;
  n    integer;
begin
  if not public.turn_team_sharing_on() and not public.turn__is_team_admin(p_owner) then
    raise exception 'TURN_TEAM:paused: team sharing is switched off right now';
  end if;
  tier := public.turn_team_owner_tier(p_owner);
  if tier = 'none' then
    raise exception 'TURN_TEAM:plan_required: sharing a film needs the Director or Producer plan';
  end if;
  -- a Stage editor already on a film that dropped to Director keeps the role; giving it anew needs Producer
  if 'stage_editor' = any(p_roles) and tier <> 'studio'
     and (p_opening or not ('stage_editor' = any(coalesce(p_old_roles, array[]::text[])))) then
    raise exception 'TURN_TEAM:stage_editor_producer: the Stage editor role needs the Producer plan';
  end if;
  if exists (select 1 from auth.users u
              where u.id = p_owner and lower(btrim(u.email)) = lower(btrim(coalesce(p_email, '')))) then
    raise exception 'TURN_TEAM:self: you can''t invite yourself';
  end if;

  perform pg_advisory_xact_lock(hashtext('turn-team:' || coalesce(public.turn__team_family(p_project), p_project)::text));
  if p_opening then
    cap := public.turn_team_cap(tier);
    if public.turn__team_places(p_project, p_member, p_email, false) > cap then
      raise exception 'TURN_TEAM:cap:%: this film already has its % collaborators', cap, cap;
    end if;
  end if;
  if 'writer' = any(p_roles)
     and (p_opening or not ('writer' = any(coalesce(p_old_roles, array[]::text[])))) then
    if public.turn__team_places(p_project, p_member, p_email, true) > 3 then
      raise exception 'TURN_TEAM:cowriter_cap: a film can have up to 3 Co-writers';
    end if;
  end if;

  if p_opening then
    perform pg_advisory_xact_lock(hashtext('turn-team-owner:' || p_owner::text));
    select count(*) into n from public.turn_team_invite_log l
     where l.owner = p_owner and l.kind = 'invite' and l.at > now() - interval '1 day';
    if n >= 20 then
      raise exception 'TURN_TEAM:daily_cap: you can send up to 20 new invites a day';
    end if;
    insert into public.turn_team_invite_log(owner, project_id) values (p_owner, p_project);
  end if;
  return tier;
end;
$$;

create or replace function public.turn_guard_team_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller  uuid := auth.uid();
  v_owner uuid;
  v_src   public.turn_project_members;
  tier    text;
  opening boolean := false;   -- a new place: an insert, or a removed row made active again
begin
  -- (Team review, 2026-10-09) Turning a shared film into a Show
  -- (series-production.sql turn_convert_project_to_show) copies each active member of
  -- the film onto the new Show. That is the SAME team moving up, not new invites: the
  -- copy keeps the account link, every role, the owner's budget, the invite and join
  -- times and the bell's "seen" mark, its spend so far moves with it (the film's
  -- holds now name the Show's row), and nothing is checked or counted — it works with
  -- the switch off or the owner's plan lapsed. Recognised only inside that function's
  -- transaction (its lifecycle setting), for a Show created in this same transaction
  -- whose recorded source film has an active row for this address.
  if tg_op = 'INSERT' and coalesce(current_setting('turn.series_lifecycle', true), '') = 'true' then
    select src.* into v_src
      from public.turn_projects s
      join public.turn_projects e
        on e.id = public.turn_series_try_uuid(s.doc ->> 'sourceEpisodeId')
       and e.owner = s.owner
      join public.turn_project_members src
        on src.project_id = e.id
       and src.status = 'active'
       and src.member_email = lower(btrim(new.member_email))
     where s.id = new.project_id
       and (s.project_kind = 'show' or public.turn_series_doc_is_show(s.doc))
       and s.created_at = now()
     limit 1;
    if found then
      new.owner         := v_src.owner;
      new.member_email  := v_src.member_email;
      new.member_user   := v_src.member_user;
      new.roles         := public.turn_team_canonical_roles(coalesce(v_src.roles, array[v_src.role]));
      new.role          := new.roles[1];
      new.status        := 'active';
      new.budget_credits := v_src.budget_credits;
      new.invited_at    := v_src.invited_at;
      new.expires_at    := v_src.expires_at;
      new.email_sent_at := v_src.email_sent_at;
      new.joined_at     := v_src.joined_at;
      new.owner_seen_at := v_src.owner_seen_at;
      update public.turn_credit_holds h set member_id = new.id where h.member_id = v_src.id;
      return new;
    end if;
  end if;

  -- roles ⇄ role, on every path: the set is canonical, `role` is its first entry; an older
  -- client that changed only `role` gets that one role
  if tg_op = 'INSERT' then
    new.roles := public.turn_team_canonical_roles(coalesce(new.roles, array[new.role]));
  elsif new.roles is distinct from old.roles then
    new.roles := public.turn_team_canonical_roles(new.roles);
  elsif new.role is distinct from old.role then
    new.roles := array[new.role];
  end if;
  if new.roles is null then
    raise exception 'TURN_TEAM:no_role: choose at least one role';
  end if;
  new.role := new.roles[1];

  -- (Team review, 2026-10-09) a membership never moves to another row id or film, on any path
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
  end if;

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
    new.email_sent_at := old.email_sent_at;
    new.joined_at     := old.joined_at;
    new.owner_seen_at := old.owner_seen_at;
    -- a removal, or a budget change, needs no plan and no switch: the owner can always tidy up
    if new.status = 'removed'
       or (new.roles = old.roles and new.status = old.status) then
      return new;
    end if;
    -- (owner decision D, 2026-10-09) adding back someone who was removed or who left is a
    -- FRESH invite: unlinked again, so they must accept it (a confirmed address, within
    -- 14 days) before it opens anything; the owner's budget for them stays
    opening := old.status = 'removed' and new.status = 'active';
    if opening then
      new.member_user   := null;
      new.joined_at     := null;
      new.owner_seen_at := null;
      new.email_sent_at := null;
    end if;
  else
    new.member_user := null;   -- linking happens only by the invitee's own claim
    new.status := 'active';
    new.member_email := lower(btrim(coalesce(new.member_email, '')));
    -- (Team review, 2026-10-09) server-owned on a new invite too
    new.email_sent_at := null;
    new.joined_at     := null;
    new.owner_seen_at := null;
    new.expires_at    := null;
    -- (series-production.sql decides which old Episode invites became Show-wide by created_at)
    new.created_at    := now();
    opening := true;
  end if;

  tier := public.turn__team_check(new.project_id, v_owner, new.id, new.member_email, new.roles,
    case when tg_op = 'UPDATE' and not opening then coalesce(old.roles, array[old.role]) end, opening);

  if opening then
    new.invited_at := now();
    new.expires_at := now() + interval '14 days';
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

-- The owner re-sends an expired or unanswered invite: a fresh 14 days. It is a new
-- place, so (Team review, 2026-10-09) it runs the guard's own checks — the switch,
-- the plan, the Stage editor, the people and Co-writer caps (an expired invite gave
-- its place up) and the daily limit — under the same locks.
create or replace function public.turn_renew_invite(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.turn_project_members;
begin
  select * into m from public.turn_project_members x where x.id = p_member for update;
  if not found or m.owner <> auth.uid()
     or not exists (select 1 from public.turn_projects p where p.id = m.project_id and p.owner = auth.uid()) then
    raise exception 'TURN_TEAM:owner_only: only the film''s owner manages its team';
  end if;
  if m.status <> 'active' or m.member_user is not null then
    return jsonb_build_object('ok', true, 'joined', m.member_user is not null);
  end if;
  perform public.turn__team_check(m.project_id, m.owner, m.id, m.member_email,
    public.turn_team_canonical_roles(coalesce(m.roles, array[m.role])), null, true);
  -- the guard keeps expiry server-owned on browser updates; this definer path sets it
  perform public.turn__team_trust(true);
  update public.turn_project_members set invited_at = now(), expires_at = now() + interval '14 days', email_sent_at = null
   where id = p_member;
  perform public.turn__team_trust(false);
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
  perform public.turn__team_trust(true);
  update public.turn_project_members m
     set status = 'removed'
   where m.status = 'active'
     and m.id in (select r.member_id from public.turn_effective_project_roles_for(auth.uid(), pid) r);
  get diagnostics n = row_count;
  perform public.turn__team_trust(false);
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

-- The roles that may charge a kind of call to the film's owner: 'text' (any writing
-- role: every room drafts), 'image' and 'voice' (Art director, Stage editor), 'video'
-- (Stage editor), '3d' (Art director). No kind = any writing role.
create or replace function public.turn_team_kind_roles(p_kind text)
returns text[]
language sql
immutable
as $$
  select case p_kind
    when 'text'  then array['writer', 'art_director', 'stage_editor']
    when 'image' then array['art_director', 'stage_editor']
    when 'voice' then array['art_director', 'stage_editor']
    when 'video' then array['stage_editor']
    when '3d'    then array['art_director']
    else case when p_kind is null then array['writer', 'art_director', 'stage_editor']
              else array[]::text[] end
  end;
$$;

-- Who pays for a call on a film (service role). p_kind is the call (above).
--   {ok:true, payer, own:true}                      the caller owns the film
--   {ok:true, payer:owner, actor, member_id, budget, spent, tier}   a collaborator
--   {ok:false, code:'owner_plan' | 'budget_reached' | 'paused' | 'role'}   REFUSE the call
--   {ok:false, code:'not_member' | 'no_film'}   not film work: bill the caller, as before
-- (Team review, 2026-10-09) 'paused' replaces 'off' (owner decision B): with the switch
-- off a linked, active collaborator is read-only and nobody is charged, so the server
-- refuses the call (it is not billed to the collaborator either); someone who isn't a
-- member still gets 'not_member'. 'role' (owner decision C): a member whose role doesn't
-- cover this kind of call is refused, never charged — neither the owner nor themselves.
-- When a person holds the film's own row and a Show row, the grant that fits the call
-- and still has budget left is preferred.
drop function if exists public.turn_film_payer(uuid, uuid, text);
create or replace function public.turn_film_payer(p_actor uuid, p_project uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_owner uuid;
  tier    text;
  need    text[];
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
  need := public.turn_team_kind_roles(coalesce(p_kind, ''));
  tier := public.turn_team_owner_tier(v_owner);
  -- the best grant: one that fits this call and the owner's plan, then one with budget
  -- left, the film's own row before its Show's
  select r.role, r.member_id, m.budget_credits into pick
    from public.turn_effective_project_roles_for(p_actor, p_project) r
    join public.turn_project_members m on m.id = r.member_id
   where m.member_user = p_actor
   order by (r.role = any(need) and public.turn_team_role_writes(r.role, tier)) desc,
            (r.role = any(need)) desc,
            (m.budget_credits is null or public.turn__member_spent(m.id) < m.budget_credits) desc,
            (m.project_id = p_project) desc
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_member'); end if;
  if not public.turn_team_sharing_on() then return jsonb_build_object('ok', false, 'code', 'paused'); end if;
  if not (pick.role = any(need)) then return jsonb_build_object('ok', false, 'code', 'role', 'role', pick.role); end if;
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

-- Hold on the OWNER's balance for a collaborator's call (service role).
-- (Team review, 2026-10-09) Nothing the caller passes is taken on trust: the owner
-- and the film come from the membership row (p_owner must be the owner of that
-- row's film, and p_project that film or one of its Show's Episodes — else
-- 'mismatch'), and under the owner's account lock (two calls can't both pass the
-- budget) it checks again: the switch is on ('paused'), the row is active and
-- linked to p_actor ('not_member'), one of its roles fits the call ('role';
-- p_kind as turn_film_payer's, none = any writing role), the owner's plan carries
-- that role ('owner_plan'), and the budget ('budget_reached'). `ref` is trimmed
-- once, as turn_hold_credits trims it, and that one value is used throughout.
drop function if exists public.turn_hold_credits_for_film(uuid, uuid, uuid, uuid, integer, text, text);
create or replace function public.turn_hold_credits_for_film(p_owner uuid, p_actor uuid, p_member uuid,
  p_project uuid, amount integer, ref text, reason text default null, p_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref    text := nullif(trim(coalesce(turn_hold_credits_for_film.ref, '')), '');
  v_amount integer := turn_hold_credits_for_film.amount;
  m        public.turn_project_members;
  v_owner  uuid;
  v_need   text[];
  tier     text;
  v_spent  integer;
  v_res    jsonb;
begin
  perform public.turn__service_only('turn_hold_credits_for_film');
  select * into m from public.turn_project_members x where x.id = p_member;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_member', 'held', 0);
  end if;
  select p.owner into v_owner from public.turn_projects p where p.id = m.project_id;
  if v_owner is null or p_owner is distinct from v_owner
     or not exists (select 1 from public.turn_projects p where p.id = p_project and p.owner = v_owner)
     or not exists (select 1 from public.turn_series_membership_scope(p_project) s where s.project_id = m.project_id) then
    return jsonb_build_object('ok', false, 'code', 'mismatch', 'held', 0);
  end if;

  perform 1 from public.turn_credits c where c.owner = v_owner for update;
  if v_ref is not null and exists (select 1 from public.turn_credit_holds h where h.ref = v_ref) then
    return public.turn_hold_credits(v_owner, v_amount, v_ref, reason);   -- a repeat: the first answer
  end if;
  select * into m from public.turn_project_members x where x.id = p_member;   -- as it is now, under the lock
  if not public.turn_team_sharing_on() then
    return jsonb_build_object('ok', false, 'code', 'paused', 'held', 0);
  end if;
  if m.status <> 'active' or m.member_user is distinct from p_actor or p_actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_member', 'held', 0);
  end if;
  v_need := public.turn_team_kind_roles(p_kind);
  if not (coalesce(m.roles, array[m.role]) && v_need) then
    return jsonb_build_object('ok', false, 'code', 'role', 'held', 0, 'role', m.role);
  end if;
  tier := public.turn_team_owner_tier(v_owner);
  if not exists (select 1 from unnest(coalesce(m.roles, array[m.role])) r(role)
                  where r.role = any(v_need) and public.turn_team_role_writes(r.role, tier)) then
    return jsonb_build_object('ok', false, 'code', 'owner_plan', 'held', 0, 'tier', tier);
  end if;
  v_spent := public.turn__member_spent(m.id);
  if m.budget_credits is not null and v_spent + coalesce(v_amount, 0) > m.budget_credits then
    return jsonb_build_object('ok', false, 'code', 'budget_reached', 'held', 0,
      'budget', m.budget_credits, 'spent', v_spent, 'needed', v_amount);
  end if;
  v_res := public.turn_hold_credits(v_owner, v_amount, v_ref, reason);
  if coalesce((v_res ->> 'ok')::boolean, false) and not coalesce((v_res ->> 'duplicate')::boolean, false) then
    update public.turn_credit_holds h set actor = p_actor, project_id = p_project, member_id = m.id
     where h.ref = v_ref;
  end if;
  return v_res || jsonb_build_object('budget', m.budget_credits, 'spent',
    v_spent + case when coalesce((v_res ->> 'ok')::boolean, false) then coalesce(v_amount, 0) else 0 end);
end $$;

-- Who started the job a hold pays for (a video poll by the collaborator who submitted it,
-- on a hold the film's owner pays). Service role.
create or replace function public.turn_hold_actor(ref text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  perform public.turn__service_only('turn_hold_actor');
  return (select h.actor from public.turn_credit_holds h where h.ref = turn_hold_actor.ref);
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

-- ── 7b. the owner's notifications: who joined which of your films ──────────
-- The last 30 days of joins on films you own, newest first (the bell in the top bar).
create or replace function public.turn_team_notifications()
returns table(member_id uuid, project_id uuid, title text, member_email text, role text, joined_at timestamptz, seen boolean)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select m.id, m.project_id, p.title, m.member_email, public.turn_team_roles_text(m.roles, m.role), m.joined_at, m.owner_seen_at is not null
    from public.turn_project_members m
    join public.turn_projects p on p.id = m.project_id
   where p.owner = auth.uid()
     and m.status = 'active'   -- (Team review, 2026-10-09) not someone removed or who left
     and m.member_user is not null
     and m.joined_at is not null
     and m.joined_at > now() - interval '30 days'
   order by m.joined_at desc
   limit 30;
$$;
-- The owner opened the bell: everything listed is seen.
create or replace function public.turn_team_notifications_seen()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  perform public.turn__team_trust(true);
  update public.turn_project_members m set owner_seen_at = now()
    from public.turn_projects p
   where p.id = m.project_id and p.owner = auth.uid()
     and m.joined_at is not null and m.owner_seen_at is null;
  get diagnostics n = row_count;
  perform public.turn__team_trust(false);
  return n;
end;
$$;

-- ── 7c. private presence and live changes (Team review, 2026-10-09) ─────────
-- The app joins two channels per film, both with { config: { private: true } }:
-- 'film:<film id>' (presence, and the doc-rev / member-removed broadcasts) and
-- 'doc:<film id>' (the doc-rev / member-removed broadcasts). Supabase's Realtime
-- Authorization reads RLS on realtime.messages: receiving (presence included) is a
-- SELECT, sending a broadcast or tracking presence an INSERT. Both are allowed to
-- anyone who can OPEN the film — read access is enough, a View-only collaborator
-- shows up in presence too — and to nobody else (knowing a film's id no longer
-- shows who is in it). A topic that isn't exactly 'film:' or 'doc:' + a UUID is
-- refused, never an error.
create or replace function public.turn_film_channel_allowed(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if p_topic is null
     or p_topic !~* '^(film|doc):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.turn_can_access_project(split_part(p_topic, ':', 2)::uuid, false);
end;
$$;
revoke all on function public.turn_film_channel_allowed(text) from public, anon, authenticated;
grant execute on function public.turn_film_channel_allowed(text) to authenticated;

-- Only where Supabase Realtime is installed (the offline test database has no
-- realtime schema; there this block does nothing).
do $$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages / realtime.topic() not found: private film channels not configured here';
    return;
  end if;
  execute 'drop policy if exists "turn film channels receive" on realtime.messages';
  execute 'drop policy if exists "turn film channels send" on realtime.messages';
  execute 'create policy "turn film channels receive" on realtime.messages
             for select to authenticated
             using (public.turn_film_channel_allowed(realtime.topic()))';
  execute 'create policy "turn film channels send" on realtime.messages
             for insert to authenticated
             with check (public.turn_film_channel_allowed(realtime.topic()))';
end;
$$;

-- ── 8. privileges ───────────────────────────────────────────────────────────
revoke all on function public.turn_effective_project_roles_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.turn_effective_project_roles(uuid) from public, anon, authenticated;
revoke all on function public.turn_team_owner_tier(uuid) from public, anon, authenticated;
grant execute on function public.turn_team_owner_tier(uuid) to service_role;
revoke all on function public.turn_guard_team_member() from public, anon, authenticated;
revoke all on function public.turn_enforce_role_sections() from public, anon, authenticated;
revoke all on function public.turn__member_spent(uuid) from public, anon, authenticated;
revoke all on function public.turn_film_payer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.turn_hold_credits_for_film(uuid, uuid, uuid, uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.turn_film_payer(uuid, uuid, text) to service_role;
revoke all on function public.turn_hold_actor(text) from public, anon, authenticated;
grant execute on function public.turn_hold_actor(text) to service_role;
grant execute on function public.turn_hold_credits_for_film(uuid, uuid, uuid, uuid, integer, text, text, text) to service_role;
revoke all on function public.turn__team_trusted() from public, anon, authenticated;
revoke all on function public.turn__team_trust(boolean) from public, anon, authenticated;
-- (Team review, 2026-10-09) the internal checks, and the pure helpers nothing outside the
-- database calls (app/ and supabase/functions/ call none of them): not reachable at
-- /rest/v1/rpc. Supabase's default privileges grant a new function to anon and
-- authenticated DIRECTLY, so each is revoked from both by name.
revoke all on function public.turn__is_team_admin(uuid) from public, anon, authenticated;
revoke all on function public.turn__collab_writes(text, uuid) from public, anon, authenticated;
revoke all on function public.turn__team_family(uuid) from public, anon, authenticated;
revoke all on function public.turn__team_places(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.turn__team_check(uuid, uuid, uuid, text, text[], text[], boolean) from public, anon, authenticated;
revoke all on function public.turn_team_cap(text) from public, anon, authenticated;
revoke all on function public.turn_team_default_budget(text) from public, anon, authenticated;
revoke all on function public.turn_team_canonical_roles(text[]) from public, anon, authenticated;
revoke all on function public.turn_team_roles_text(text[], text) from public, anon, authenticated;
revoke all on function public.turn_team_role_writes(text, text) from public, anon, authenticated;
revoke all on function public.turn_team_kind_roles(text) from public, anon, authenticated;
revoke all on function public.turn_is_stage_slot(text, jsonb) from public, anon, authenticated;
revoke all on function public.turn_role_allowed_sections(text) from public, anon, authenticated;
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
revoke all on function public.turn_team_notifications() from public, anon;
grant execute on function public.turn_team_notifications() to authenticated;
revoke all on function public.turn_team_notifications_seen() from public, anon;
grant execute on function public.turn_team_notifications_seen() to authenticated;
revoke all on function public.turn_team_spend(uuid) from public, anon;
grant execute on function public.turn_team_spend(uuid) to authenticated;

commit;

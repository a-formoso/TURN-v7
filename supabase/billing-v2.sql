-- ============================================================================
-- Kinolot — billing v2 (supabase/billing-v2.sql)
-- Owner decisions 2026-09-30 ("build the billing fixes"). Written 2026-09-30.
-- NOT run on production yet.
--
-- WHAT CHANGES FOR PEOPLE
--   * Credit packs get their OWN balance. Each pack is a "lot" that lasts 12
--     months and is never wiped by a monthly renewal. Plan credits are spent
--     first, then packs (the one that expires soonest first).
--   * A renewal refills PLAN credits only, once per Stripe event: a re-sent
--     event no longer refills twice, and packs are left alone.
--   * Upgrades add the allowance difference for the part of the paid period still
--     to run (Stripe charges them pro rata too); with no period known, the next
--     renewal gives the new allowance (turn_adjust_plan_once).
--   * A refund takes back the unspent credits of that purchase (plan credits held
--     by a running job included); an open dispute freezes spending; a failed
--     payment marks the account past_due.
--   * A paid checkout never takes over an account that already has a DIFFERENT,
--     still-active subscription on another Stripe customer: nothing is granted and
--     it is recorded for the owner (turn_grant_failures 'subscription_conflict').
--   * Cancelling (turn_end_plan_for_sub, only for the stored subscription) ends
--     the plan. Until the credit switch day its plan credits stay usable (as the
--     published Terms say today); from the switch day on they end with the paid
--     period. Pack credits always keep their expiry.
--   * Free trial: 50 credits, once per account (one per mailbox), granted on the
--     first balance read after the email is confirmed. It starts on the credit
--     switch day (supabase/billing-switch.sql): 50 is counted in the new units
--     ($0.01 a credit) and the trial needs the new image-proxy limits.
--   * The server can HOLD credits before a job and settle or release them after
--     (video, voice, long writing), so parallel jobs can never overspend. A hold
--     for a provider job (video, 3D) carries the provider's job id (provider_ref),
--     so its poll finds it; the REQUIRED housekeeping schedule
--     (supabase/billing-housekeeping-cron.sql, day 0) releases holds a crashed
--     worker left open, and asks image-proxy and blender-bridge to RECONCILE
--     provider jobs nobody polled (a closed tab): a job that finished is charged
--     as its poll would have charged it, a job that failed is refunded.
--
-- STILL WORKS UNCHANGED (backward compatible; nothing else has to deploy first)
--   * today's app: turn_credit_balance() keeps remaining and plan as its first two
--     columns (new columns follow); turn_spend_credit(cost, event_id) is the same.
--   * today's image-proxy: turn_record_usage_event is the same call, and the
--     direct read of turn_credits.remaining still gives the TOTAL balance
--     (plan credits + unexpired packs).
--   * today's stripe-webhook: turn_set_plan, turn_apply_pack_once, turn_end_plan
--     keep their signatures (a renewal now leaves packs alone; packs become lots).
--   * Blender Studio: turn_studio_settle_credit still lowers turn_credits.remaining
--     directly; a trigger spreads any such direct change (plan credits first,
--     then packs) so the two balances always add up to remaining.
--
-- WHAT IT CREATES OR CHANGES
--   turn_credits          new columns: plan_remaining, plan_allowance,
--                         plan_period_start, payment_status, frozen(+reason,
--                         +at), paid_since, trial_granted_at, trial_email_key,
--                         legacy_tier/_allowance/_until (grandfathering, set by
--                         billing-switch.sql), pending_tier (stripe-webhook's
--                         scheduled downgrade), ledger_sync (internal).
--                         remaining = plan_remaining + unexpired pack lots, kept
--                         by the trigger turn_credits_ledger_sync.
--   turn_credit_lots      pack / admin-grant / carried credits with an expiry.
--                         Users can read their own lots; nobody else writes.
--   turn_credit_holds     the hold ledger (service role only); provider_ref ties a
--                         hold to the provider's job (turn_hold_attach / _lookup,
--                         turn_open_provider_holds for the server's reconciliation).
--   turn_plan_grants      every plan, upgrade and trial grant (for refunds).
--   turn_billing_state    one-time markers: 'v2_installed', 'credit_unit_switch';
--                         'housekeeping:<job>' rows are the reconciliation's
--                         throttle (turn_claim_housekeeping).
--   turn_stripe_events    gains uid / action / result: every *_once function
--                         claims its event id here first (shared with today's
--                         turn_apply_pack_once, so no event is applied twice
--                         across old and new webhook code).
--   Functions: see the CONTRACT list in supabase/README.md ("Billing v2").
--
-- FIRST RUN ONLY: a CARRY-OVER. Today one balance mixes plan and pack credits.
--   For each subscriber, anything above the plan's monthly allowance (800 /
--   2,400 / 9,000 today) can only be pack or granted credits, so it moves to a
--   12-month lot; an account without a plan keeps its whole balance as a
--   12-month lot. Nobody's total changes. Marker: turn_billing_state
--   'v2_installed' (a re-run never carries again).
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this WHOLE file -> Run,
--   as postgres. credits.sql must have run before (it has, on production). The
--   whole file is one transaction: a failed run changes nothing. Safe to re-run:
--   tables and columns are created only when missing, functions and grants are
--   put back exactly as below, and the carry-over happens once.
--   The editor then shows the RESULT table: every row must read 'ok'.
--   Right after it, run supabase/billing-housekeeping-cron.sql (REQUIRED: it gives
--   back holds a killed worker left open and schedules the reconciliation of
--   provider jobs nobody polled). Then, and only on the switch day, run
--   supabase/billing-switch.sql.
--
-- NEVER re-run a copy of credits.sql from before 2026-09-30 afterwards: it puts
--   back the old functions (renewal would wipe packs again). Today's credits.sql
--   carries the same definitions as this file (scripts/test-billing-db.mjs checks).
-- ============================================================================
begin;

do $preflight$
declare
  missing text;
begin
  select string_agg(r, ', ' order by r) into missing
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where not exists (select 1 from pg_catalog.pg_roles x where x.rolname = r);
  if missing is not null then
    raise exception 'Kinolot billing v2: missing roles % (run this on the Supabase database). Nothing was changed.', missing;
  end if;
  if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.role()') is null then
    raise exception 'Kinolot billing v2: Supabase Auth (auth.users, auth.uid(), auth.role()) is missing. Nothing was changed.';
  end if;
  if to_regclass('public.turn_credits') is null or to_regclass('public.turn_usage_events') is null
     or to_regclass('public.turn_grant_failures') is null then
    raise exception 'Kinolot billing v2: run supabase/credits.sql first (turn_credits, turn_usage_events or turn_grant_failures is missing). Nothing was changed.';
  end if;
end;
$preflight$;

-- >>> KINOLOT BILLING V2 DEFINITIONS >>>
-- This block is byte-identical in supabase/credits.sql and supabase/billing-v2.sql
-- (scripts/test-billing-db.mjs fails if they drift). Every statement is safe to re-run.

-- ── 1. tables and columns ───────────────────────────────────────────────────
create table if not exists public.turn_stripe_events (
  id           text primary key,
  type         text not null,
  processed_at timestamptz not null default now()
);
alter table public.turn_stripe_events add column if not exists uid    uuid;
alter table public.turn_stripe_events add column if not exists action text;
alter table public.turn_stripe_events add column if not exists result jsonb;
alter table public.turn_stripe_events enable row level security;

create table if not exists public.turn_spend_events (
  event_id   text primary key,
  owner      uuid not null,
  cost       integer not null,
  created_at timestamptz not null default now()
);
alter table public.turn_spend_events enable row level security;

-- plan credits: the whole old balance becomes plan credits first (the carry-over
-- below then moves pack-like credits into lots, once)
alter table public.turn_credits add column if not exists plan_remaining integer;
update public.turn_credits set plan_remaining = greatest(0, coalesce(remaining, 0)) where plan_remaining is null;
alter table public.turn_credits alter column plan_remaining set default 0;
alter table public.turn_credits alter column plan_remaining set not null;
alter table public.turn_credits add column if not exists plan_allowance    integer;
alter table public.turn_credits add column if not exists plan_period_start timestamptz;
alter table public.turn_credits add column if not exists payment_status    text not null default 'active';
alter table public.turn_credits add column if not exists frozen            boolean not null default false;
alter table public.turn_credits add column if not exists frozen_reason     text;
alter table public.turn_credits add column if not exists frozen_at         timestamptz;
alter table public.turn_credits add column if not exists paid_since        timestamptz;
alter table public.turn_credits add column if not exists trial_granted_at  timestamptz;
alter table public.turn_credits add column if not exists trial_email_key   text;
alter table public.turn_credits add column if not exists legacy_tier       text;
alter table public.turn_credits add column if not exists legacy_allowance  integer;
alter table public.turn_credits add column if not exists legacy_until      timestamptz;
alter table public.turn_credits add column if not exists pending_tier      text;
alter table public.turn_credits add column if not exists ledger_sync       boolean not null default false;
comment on column public.turn_credits.remaining is
  'Kinolot: TOTAL spendable credits = plan_remaining + unexpired turn_credit_lots. Kept by the turn_credits_ledger_sync trigger; a direct change is spread plan credits first, then lots.';
comment on column public.turn_credits.ledger_sync is
  'Kinolot internal: the billing functions set it true to mark a consistent write; the trigger always stores false.';

do $constraints$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.turn_credits'::regclass and conname = 'turn_credits_payment_status_check') then
    alter table public.turn_credits add constraint turn_credits_payment_status_check
      check (payment_status in ('active', 'past_due'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.turn_credits'::regclass and conname = 'turn_credits_plan_remaining_check') then
    alter table public.turn_credits add constraint turn_credits_plan_remaining_check check (plan_remaining >= 0);
  end if;
end;
$constraints$;
create unique index if not exists turn_credits_trial_email_key_uidx
  on public.turn_credits(trial_email_key) where trial_email_key is not null;
create index if not exists turn_credits_customer_idx
  on public.turn_credits(stripe_customer_id) where stripe_customer_id is not null;
create index if not exists turn_credits_sub_idx
  on public.turn_credits(stripe_sub_id) where stripe_sub_id is not null;

create table if not exists public.turn_billing_state (
  key   text primary key,
  value jsonb not null default '{}'::jsonb,
  at    timestamptz not null default now()
);
alter table public.turn_billing_state enable row level security;

create table if not exists public.turn_credit_lots (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users(id) on delete cascade,
  source         text not null check (source in ('pack', 'grant', 'carry')),
  amount         integer not null check (amount >= 0),
  remaining      integer not null check (remaining >= 0),
  expires_at     timestamptz not null,
  event_id       text,
  charge_ref     text,
  expired_amount integer not null default 0,
  revoked_at     timestamptz,
  revoked_amount integer not null default 0,
  created_at     timestamptz not null default now()
);
alter table public.turn_credit_lots enable row level security;
create unique index if not exists turn_credit_lots_event_uidx
  on public.turn_credit_lots(event_id) where event_id is not null;
create index if not exists turn_credit_lots_owner_idx on public.turn_credit_lots(owner, expires_at);
create index if not exists turn_credit_lots_charge_idx
  on public.turn_credit_lots(charge_ref) where charge_ref is not null;

create table if not exists public.turn_plan_grants (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users(id) on delete cascade,
  kind           text not null,          -- 'plan' | 'upgrade' | 'trial'
  tier           text,
  amount         integer not null default 0,
  event_id       text,
  charge_ref     text,
  period_start   timestamptz,
  revoked_at     timestamptz,
  revoked_amount integer not null default 0,
  created_at     timestamptz not null default now()
);
alter table public.turn_plan_grants enable row level security;
create index if not exists turn_plan_grants_owner_idx on public.turn_plan_grants(owner, created_at desc);
create index if not exists turn_plan_grants_event_idx on public.turn_plan_grants(event_id) where event_id is not null;
create index if not exists turn_plan_grants_charge_idx on public.turn_plan_grants(charge_ref) where charge_ref is not null;

create table if not exists public.turn_credit_holds (
  ref               text primary key check (length(ref) between 1 and 200),
  owner             uuid not null references auth.users(id) on delete cascade,
  held              integer not null check (held >= 0),
  from_plan         integer not null default 0,
  from_lots         jsonb not null default '[]'::jsonb,
  plan_period_start timestamptz,
  reason            text,
  status            text not null default 'held' check (status in ('held', 'settled', 'released')),
  kept              integer,
  released          integer,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
alter table public.turn_credit_holds enable row level security;
create index if not exists turn_credit_holds_open_idx on public.turn_credit_holds(created_at) where status = 'held';
create index if not exists turn_credit_holds_owner_idx on public.turn_credit_holds(owner, created_at desc);
-- the provider's job id (fal request id for a video, the mesh job id for Blender),
-- attached right after the submit (turn_hold_attach). A hold that has one is not
-- released by the time rule of the housekeeping job: the poll, or the server's
-- reconciliation (turn_open_provider_holds), settles or releases it by what the
-- provider says.
alter table public.turn_credit_holds add column if not exists provider_ref text;
create unique index if not exists turn_credit_holds_provider_ref_uidx
  on public.turn_credit_holds(provider_ref) where provider_ref is not null;

-- ── 2. the trigger that keeps remaining = plan_remaining + unexpired lots ──
-- The billing functions below write plan_remaining / lots and set ledger_sync; any
-- OTHER write that changes remaining (Blender Studio's settle function, a hand edit
-- in the SQL editor) is spread here: a rise becomes plan credits, a drop is taken
-- from plan credits first, then from lots (soonest expiry first), never below 0.
-- A hand edit of plan_remaining itself wins over remaining.
create or replace function public.turn__credits_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer;
  v_take  integer;
  v_part  integer;
  v_lot   record;
  v_lots  integer;
begin
  if tg_op = 'INSERT' then
    if not coalesce(new.ledger_sync, false) then
      new.plan_remaining := greatest(0, coalesce(new.remaining, 0));
    end if;
  elsif not coalesce(new.ledger_sync, false)
        and new.plan_remaining is not distinct from old.plan_remaining
        and new.remaining is distinct from old.remaining then
    v_delta := coalesce(new.remaining, 0) - coalesce(old.remaining, 0);
    if v_delta > 0 then
      new.plan_remaining := coalesce(new.plan_remaining, 0) + v_delta;
    elsif v_delta < 0 then
      v_take := -v_delta;
      v_part := least(v_take, greatest(coalesce(new.plan_remaining, 0), 0));
      new.plan_remaining := coalesce(new.plan_remaining, 0) - v_part;
      v_take := v_take - v_part;
      if v_take > 0 then
        for v_lot in
          select l.id, l.remaining from public.turn_credit_lots l
           where l.owner = new.owner and l.remaining > 0 and l.expires_at > pg_catalog.now()
           order by l.expires_at, l.created_at, l.id
           for update
        loop
          v_part := least(v_take, v_lot.remaining);
          update public.turn_credit_lots l set remaining = l.remaining - v_part where l.id = v_lot.id;
          v_take := v_take - v_part;
          exit when v_take = 0;
        end loop;
      end if;
    end if;
  end if;
  new.ledger_sync := false;
  new.plan_remaining := greatest(0, coalesce(new.plan_remaining, 0));
  select coalesce(sum(l.remaining), 0)::integer into v_lots
    from public.turn_credit_lots l
   where l.owner = new.owner and l.remaining > 0 and l.expires_at > pg_catalog.now();
  new.remaining := new.plan_remaining + v_lots;
  if tg_op = 'UPDATE' then
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end $$;

drop trigger if exists turn_credits_ledger_sync on public.turn_credits;
create trigger turn_credits_ledger_sync
  before insert or update on public.turn_credits
  for each row execute function public.turn__credits_sync_trg();

-- ── 3. internal helpers (no API role may call these) ────────────────────────
create or replace function public.turn__service_only(p_fn text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- EXECUTE grants already limit these functions to the service role; this is the
  -- second lock. No JWT at all = the SQL editor (postgres), which is allowed.
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'KINOLOT_BILLING: ' || p_fn || ' is for the service role only';
  end if;
end $$;

create or replace function public.turn__paid_tier(p_tier text)
returns boolean
language sql immutable
set search_path = ''
as $$ select lower(trim(coalesce(p_tier, ''))) in ('writer', 'director', 'studio', 'pro') $$;
-- ('pro' is the legacy name of Director: the webhook, the server policy and the app
-- all treat it as Director, and so does every tier check here)

-- the grandfathered allowance: the OLD monthly allowance (800 / 2,400 / 9,000) in the
-- NEW units (x3). Only used while turn_credits.legacy_until is in the future.
create or replace function public.turn__legacy_allowance(p_tier text)
returns integer
language sql immutable
set search_path = ''
as $$
  select case lower(trim(coalesce(p_tier, '')))
           when 'writer' then 2400 when 'director' then 7200 when 'pro' then 7200 when 'studio' then 27000 else 0 end
$$;

create or replace function public.turn__switched()
returns boolean
language sql stable
set search_path = ''
as $$ select exists (select 1 from public.turn_billing_state s where s.key = 'credit_unit_switch') $$;

-- 50 trial credits, from the credit switch on (0 before it: no trial yet)
create or replace function public.turn__trial_amount()
returns integer
language sql stable
set search_path = ''
as $$ select case when public.turn__switched() then 50 else 0 end $$;

-- one trial per mailbox: lower-case, "+tag" dropped, Gmail dots ignored; stored hashed
create or replace function public.turn__email_key(p_email text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_e     text := lower(trim(coalesce(p_email, '')));
  v_at    integer;
  v_local text;
  v_dom   text;
begin
  v_at := length(v_e) - position('@' in reverse(v_e)) + 1;
  if position('@' in v_e) = 0 then return null; end if;
  v_local := split_part(substr(v_e, 1, v_at - 1), '+', 1);
  v_dom := substr(v_e, v_at + 1);
  if v_dom in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_dom := 'gmail.com';
  end if;
  if v_local = '' or v_dom = '' then return null; end if;
  return encode(sha256(convert_to(v_local || '@' || v_dom, 'UTF8')), 'hex');
end $$;

create or replace function public.turn__active_lots(p_uid uuid)
returns integer
language sql stable
set search_path = ''
as $$
  select coalesce(sum(l.remaining), 0)::integer
    from public.turn_credit_lots l
   where l.owner = p_uid and l.remaining > 0 and l.expires_at > pg_catalog.now()
$$;

create or replace function public.turn__total(p_uid uuid)
returns integer
language sql stable
set search_path = ''
as $$
  select coalesce((select c.plan_remaining from public.turn_credits c where c.owner = p_uid), 0)
         + public.turn__active_lots(p_uid)
$$;

-- recompute turn_credits.remaining through the trigger
create or replace function public.turn__sync(p_uid uuid)
returns void
language sql
set search_path = ''
as $$ update public.turn_credits set ledger_sync = true where owner = p_uid $$;

-- the account's row, created when missing, LOCKED for the rest of the transaction.
-- Every function that reads a balance to change it calls this first, so two calls
-- for the same account queue here and the second sees the first one's result.
create or replace function public.turn__lock(p_uid uuid)
returns public.turn_credits
language plpgsql
set search_path = ''
as $$
declare
  v_row public.turn_credits;
begin
  if p_uid is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: an account id is required';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_uid) then
    -- 23503 (foreign-key violation): stripe-webhook records an unknown account once and answers 200
    raise exception using errcode = '23503', message = 'KINOLOT_BILLING: no account ' || p_uid::text;
  end if;
  insert into public.turn_credits(owner, remaining, plan_remaining, ledger_sync)
    values (p_uid, 0, 0, true)
    on conflict (owner) do nothing;
  select * into v_row from public.turn_credits c where c.owner = p_uid for update;
  return v_row;
end $$;

-- expired lots are zeroed (their credits move to expired_amount). Caller holds the lock.
create or replace function public.turn__sweep(p_uid uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.turn_credit_lots l
     set expired_amount = l.expired_amount + l.remaining, remaining = 0
   where l.owner = p_uid and l.remaining > 0 and l.expires_at <= pg_catalog.now();
  if found then
    perform public.turn__sync(p_uid);
  end if;
end $$;

-- the free trial, once per account and mailbox, after email confirmation, from the
-- switch day on, never for an account that has paid. Caller holds the lock.
create or replace function public.turn__maybe_trial(p_uid uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_amount    integer := public.turn__trial_amount();
  v_row       public.turn_credits;
  v_email     text;
  v_confirmed timestamptz;
  v_key       text;
begin
  if v_amount <= 0 then return false; end if;
  select * into v_row from public.turn_credits c where c.owner = p_uid;
  if not found or v_row.trial_granted_at is not null or v_row.paid_since is not null
     or v_row.stripe_customer_id is not null or public.turn__paid_tier(v_row.plan) then
    return false;
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = p_uid;
  if v_confirmed is null then return false; end if;
  v_key := public.turn__email_key(v_email);
  if v_key is not null and exists (select 1 from public.turn_credits c
                                    where c.trial_email_key = v_key and c.owner <> p_uid) then
    return false;
  end if;
  begin
    update public.turn_credits c
       set plan_remaining = c.plan_remaining + v_amount,
           plan_allowance = v_amount,
           trial_granted_at = pg_catalog.now(),
           trial_email_key = v_key,
           ledger_sync = true
     where c.owner = p_uid;
  exception when unique_violation then
    return false;   -- another account on the same mailbox got it at this very moment
  end;
  insert into public.turn_plan_grants(owner, kind, tier, amount, period_start)
    values (p_uid, 'trial', 'none', v_amount, v_row.plan_period_start);
  return true;
end $$;

-- lock + sweep + trial: what every user-facing read or spend does first
create or replace function public.turn__prepare(p_uid uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.turn__lock(p_uid);
  perform public.turn__sweep(p_uid);
  perform public.turn__maybe_trial(p_uid);
end $$;

-- take up to p_amount credits: plan credits first, then lots (soonest expiry first).
-- p_partial = false and not enough credits -> nothing taken (o_taken = 0).
-- Returns what came from where, so a hold can give it back. Caller holds the lock.
create or replace function public.turn__take(p_uid uuid, p_amount integer, p_partial boolean,
                                             out o_plan integer, out o_lots jsonb, out o_taken integer)
language plpgsql
set search_path = ''
as $$
declare
  v_plan integer;
  v_need integer := greatest(0, coalesce(p_amount, 0));
  v_rest integer;
  v_part integer;
  v_lot  record;
begin
  o_plan := 0; o_lots := '[]'::jsonb; o_taken := 0;
  select c.plan_remaining into v_plan from public.turn_credits c where c.owner = p_uid;
  v_plan := coalesce(v_plan, 0);
  if v_need > v_plan + public.turn__active_lots(p_uid) then
    if not coalesce(p_partial, false) then return; end if;
    v_need := v_plan + public.turn__active_lots(p_uid);
  end if;
  if v_need = 0 then return; end if;
  o_plan := least(v_need, v_plan);
  v_rest := v_need - o_plan;
  if v_rest > 0 then
    for v_lot in
      select l.id, l.remaining from public.turn_credit_lots l
       where l.owner = p_uid and l.remaining > 0 and l.expires_at > pg_catalog.now()
       order by l.expires_at, l.created_at, l.id
       for update
    loop
      v_part := least(v_rest, v_lot.remaining);
      update public.turn_credit_lots l set remaining = l.remaining - v_part where l.id = v_lot.id;
      o_lots := o_lots || jsonb_build_array(jsonb_build_object('lot', v_lot.id, 'n', v_part));
      v_rest := v_rest - v_part;
      exit when v_rest = 0;
    end loop;
  end if;
  update public.turn_credits c
     set plan_remaining = c.plan_remaining - o_plan, ledger_sync = true
   where c.owner = p_uid;
  o_taken := v_need;
end $$;

-- give back p_amount of a hold, last-taken first (lots in reverse, then plan). A
-- revoked (refunded) lot takes nothing back; plan credits come back only within
-- the same plan period. Returns the credits actually given back. Caller holds the lock.
create or replace function public.turn__give_back(p_uid uuid, p_from_plan integer, p_from_lots jsonb,
                                                  p_period timestamptz, p_amount integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_left integer := greatest(0, coalesce(p_amount, 0));
  v_back integer := 0;
  v_i    integer;
  v_e    jsonb;
  v_n    integer;
  v_last integer := coalesce(jsonb_array_length(p_from_lots), 0) - 1;
begin
  if v_last >= 0 then
    for v_i in reverse v_last .. 0 loop
      exit when v_left = 0;
      v_e := p_from_lots -> v_i;
      v_n := least(v_left, greatest(0, coalesce((v_e ->> 'n')::integer, 0)));
      update public.turn_credit_lots l set remaining = l.remaining + v_n
       where l.id = (v_e ->> 'lot')::uuid and l.owner = p_uid and l.revoked_at is null;
      if found then v_back := v_back + v_n; end if;
      v_left := v_left - v_n;
    end loop;
  end if;
  if v_left > 0 then
    v_n := least(v_left, greatest(0, coalesce(p_from_plan, 0)));
    if v_n > 0 then
      update public.turn_credits c set plan_remaining = c.plan_remaining + v_n, ledger_sync = true
       where c.owner = p_uid and c.plan_period_start is not distinct from p_period;
      if found then v_back := v_back + v_n; end if;
    end if;
  end if;
  perform public.turn__sync(p_uid);
  return v_back;
end $$;

-- claim a Stripe event (or idempotency key) once; false = already applied
create or replace function public.turn__claim_event(p_event text, p_action text, p_uid uuid, p_type text default null)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.turn_stripe_events(id, type, uid, action)
    values (p_event, coalesce(p_type, p_action), p_uid, p_action)
    on conflict (id) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- A paid subscription for an account that already has a DIFFERENT subscription that
-- is still active (stored, on a paid plan) and a DIFFERENT Stripe customer: anyone who
-- knows an account's id could otherwise pay for a small plan with it as the checkout's
-- client_reference_id and replace the account's plan, credits and stored subscription
-- (its own renewals would then match no account). Nothing is granted; the conflict is
-- recorded in turn_grant_failures (reason 'subscription_conflict') for the owner.
-- The same customer, or a stored subscription that has ended (turn_end_plan_for_sub /
-- turn_end_plan clear it), applies as usual. A call WITHOUT a subscription id that would
-- move an account on a paid plan to ANOTHER Stripe customer is refused the same way
-- (nothing else could tell it apart from a takeover). Takes the account lock.
-- true = refused.
create or replace function public.turn__plan_conflict(p_uid uuid, p_tier text, p_monthly integer, p_sub text,
                                                      p_customer text, p_event text, p_source text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_row  public.turn_credits;
  v_sub  text := nullif(trim(coalesce(p_sub, '')), '');
  v_cust text := nullif(trim(coalesce(p_customer, '')), '');
begin
  v_row := public.turn__lock(p_uid);
  if not public.turn__paid_tier(v_row.plan) or v_cust is not distinct from v_row.stripe_customer_id then
    return false;
  end if;
  if v_sub is null then
    -- no subscription id: only a change of the stored customer is a conflict
    if v_cust is null or v_row.stripe_customer_id is null then
      return false;
    end if;
  elsif v_row.stripe_sub_id is null or v_sub = v_row.stripe_sub_id then
    return false;
  end if;
  insert into public.turn_grant_failures(event_id, event_type, reason, stripe_customer_id, stripe_sub_id, uid, details)
    values (p_event, p_source, 'subscription_conflict', v_cust, v_sub, p_uid,
            jsonb_build_object('stored_sub_id', v_row.stripe_sub_id, 'stored_customer_id', v_row.stripe_customer_id,
                               'stored_plan', v_row.plan, 'new_tier', p_tier, 'monthly_credits', p_monthly,
                               'incoming_sub_id', v_sub,
                               'action', 'nothing granted; the account kept its plan, credits and subscription'));
  return true;
end $$;

-- start or renew a plan: PLAN credits are reset to the allowance (packs untouched);
-- a grandfathered account gets its old allowance in the new units while
-- legacy_until is in the future. Returns the total balance.
create or replace function public.turn__apply_plan(p_uid uuid, p_tier text, p_monthly integer, p_sub text,
                                                   p_customer text, p_renews timestamptz, p_event text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_row   public.turn_credits;
  v_tier  text := nullif(trim(coalesce(p_tier, '')), '');
  v_alloc integer := greatest(0, coalesce(p_monthly, 0));
  v_now   timestamptz := pg_catalog.now();
begin
  if v_tier is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: a plan tier is required';
  end if;
  v_row := public.turn__lock(p_uid);
  if v_row.legacy_until is not null and v_row.legacy_until > v_now and public.turn__paid_tier(v_tier) then
    v_alloc := greatest(v_alloc,
      case when lower(v_tier) = lower(coalesce(v_row.legacy_tier, '')) then coalesce(v_row.legacy_allowance, 0)
           else public.turn__legacy_allowance(v_tier) end);
  end if;
  update public.turn_credits c
     set plan_remaining = v_alloc,
         plan_allowance = v_alloc,
         plan = v_tier,
         tier = v_tier,
         stripe_sub_id = coalesce(nullif(trim(coalesce(p_sub, '')), ''), c.stripe_sub_id),
         stripe_customer_id = coalesce(nullif(trim(coalesce(p_customer, '')), ''), c.stripe_customer_id),
         renews_at = coalesce(p_renews, c.renews_at),
         plan_period_start = v_now,
         paid_since = coalesce(c.paid_since, v_now),
         payment_status = 'active',
         ledger_sync = true
   where c.owner = p_uid;
  insert into public.turn_plan_grants(owner, kind, tier, amount, event_id, period_start)
    values (p_uid, 'plan', v_tier, v_alloc, p_event, v_now);
  return public.turn__total(p_uid);
end $$;

-- settle (p_keep = credits to keep) or release (p_keep null) one hold
create or replace function public.turn__finish_hold(p_ref text, p_keep integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
  v_hold  public.turn_credit_holds;
  v_keep  integer;
  v_give  integer;
  v_back  integer;
  v_state text := case when p_keep is null then 'released' else 'settled' end;
begin
  select h.owner into v_owner from public.turn_credit_holds h where h.ref = p_ref;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'ref', p_ref);
  end if;
  perform public.turn__lock(v_owner);
  select * into v_hold from public.turn_credit_holds h where h.ref = p_ref for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'ref', p_ref);
  end if;
  if v_hold.status <> 'held' then
    -- already finished: a repeat is a no-op that reports the first outcome.
    -- A settle after a release keeps nothing (code 'released').
    return jsonb_build_object('ok', not (p_keep is not null and v_hold.status = 'released'),
                              'duplicate', true, 'status', v_hold.status, 'held', v_hold.held,
                              'kept', coalesce(v_hold.kept, 0), 'released', coalesce(v_hold.released, 0),
                              'remaining', public.turn__total(v_owner))
           || case when p_keep is not null and v_hold.status = 'released'
                   then jsonb_build_object('code', 'released') else '{}'::jsonb end;
  end if;
  v_keep := case when p_keep is null then 0 else least(greatest(p_keep, 0), v_hold.held) end;
  v_give := v_hold.held - v_keep;
  v_back := public.turn__give_back(v_owner, v_hold.from_plan, v_hold.from_lots, v_hold.plan_period_start, v_give);
  update public.turn_credit_holds h
     set status = v_state, kept = v_keep, released = v_give, finished_at = pg_catalog.now()
   where h.ref = p_ref;
  insert into public.turn_usage_events(owner, kind, task, credits, status, request_id, metadata)
    values (v_owner, 'hold', v_hold.reason, v_keep, case when p_keep is null then 'released' else 'succeeded' end, p_ref,
            jsonb_build_object('held', v_hold.held, 'kept', v_keep, 'released', v_give, 'given_back', v_back));
  return jsonb_build_object('ok', true, 'status', v_state, 'held', v_hold.held, 'kept', v_keep,
                            'released', v_give, 'given_back', v_back, 'remaining', public.turn__total(v_owner));
end $$;

-- ── 4. browser functions (signed-in users; each acts on the caller only) ────
-- turn_credit_balance: remaining and plan stay the first two columns (today's app
-- reads only those). Creates the row, zeroes expired lots and grants the trial when
-- due. plan_allowance (the current period's allowance, for low-balance notices)
-- follows the contract's eight columns; held (the credits the account's open holds
-- have set aside: remaining + held is the balance before the jobs now running) is
-- always the LAST column.
do $reshape$
begin
  if to_regprocedure('public.turn_credit_balance()') is not null
     and pg_catalog.pg_get_function_result(to_regprocedure('public.turn_credit_balance()'))
         <> 'TABLE(remaining integer, plan text, plan_remaining integer, pack_remaining integer, next_pack_expiry timestamp with time zone, payment_status text, frozen boolean, trial boolean, plan_allowance integer, held integer)' then
    drop function public.turn_credit_balance();
  end if;
end;
$reshape$;
create or replace function public.turn_credit_balance()
returns table (remaining integer, plan text, plan_remaining integer, pack_remaining integer,
               next_pack_expiry timestamptz, payment_status text, frozen boolean, trial boolean,
               plan_allowance integer, held integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  perform public.turn__prepare(v_uid);
  return query
    select c.plan_remaining + public.turn__active_lots(v_uid),
           c.plan,
           c.plan_remaining,
           public.turn__active_lots(v_uid),
           (select min(l.expires_at) from public.turn_credit_lots l
             where l.owner = v_uid and l.remaining > 0 and l.expires_at > pg_catalog.now()),
           c.payment_status,
           c.frozen,
           (c.trial_granted_at is not null and c.paid_since is null),
           c.plan_allowance,
           (select coalesce(sum(h.held), 0)::integer from public.turn_credit_holds h
             where h.owner = v_uid and h.status = 'held')
      from public.turn_credits c
     where c.owner = v_uid;
end $$;

-- turn_spend_credit: the browser's post-render spend (today's video path). Plan
-- credits first, then packs; clamps at 0; event_id makes a replay a no-op; refused
-- while the account is frozen (the browser keeps it queued and retries later).
drop function if exists public.turn_spend_credit(integer);   -- no ambiguous overload
create or replace function public.turn_spend_credit(cost integer default 1, event_id text default null)
returns table (remaining integer, plan text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_cost   integer := greatest(1, coalesce(turn_spend_credit.cost, 1));
  v_event  text := nullif(trim(coalesce(turn_spend_credit.event_id, '')), '');
  v_frozen boolean;
begin
  if v_uid is null then return; end if;
  perform public.turn__prepare(v_uid);
  -- Once image-proxy charges video itself, the owner sets the marker 'server_video_billing'
  -- (supabase/README.md "Billing v2", immediately BEFORE deploying image-proxy).
  -- From then on a browser spend changes nothing: a tab still running the old app would
  -- otherwise charge a render twice (the server's hold, then this call).
  if exists (select 1 from public.turn_billing_state b where b.key = 'server_video_billing') then
    return query select c.remaining, c.plan from public.turn_credits c where c.owner = v_uid;
    return;
  end if;
  if v_event is not null then
    begin
      insert into public.turn_spend_events(event_id, owner, cost) values (v_event, v_uid, v_cost);
    exception when unique_violation then
      return query select c.remaining, c.plan from public.turn_credits c where c.owner = v_uid;
      return;
    end;
  end if;
  select c.frozen into v_frozen from public.turn_credits c where c.owner = v_uid;
  if v_frozen then
    raise exception using errcode = 'P0001',
      message = 'CREDITS_FROZEN: credits are on hold while a payment dispute is reviewed.';
  end if;
  perform public.turn__take(v_uid, v_cost, true);
  return query select c.remaining, c.plan from public.turn_credits c where c.owner = v_uid;
end $$;

-- turn_record_usage_event: today's image-proxy spend + ledger (text and images,
-- after the provider answered). Not enough credits -> INSUFFICIENT_CREDITS as
-- before; frozen -> CREDITS_FROZEN. Plan credits first, then packs.
create or replace function public.turn_record_usage_event(
    event_kind text default 'generation',
    provider_name text default null,
    model_name text default null,
    task_name text default null,
    credit_cost integer default 0,
    usage_status text default 'succeeded',
    request_key text default null,
    input_token_count integer default null,
    output_token_count integer default null,
    provider_cost numeric default null,
    usage_metadata jsonb default '{}'::jsonb)
returns table (remaining integer, plan text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_spend  integer := greatest(0, coalesce(turn_record_usage_event.credit_cost, 0));
  v_status text := lower(coalesce(nullif(trim(turn_record_usage_event.usage_status), ''), 'succeeded'));
  v_row    public.turn_credits;
begin
  if v_uid is null then return; end if;
  perform public.turn__prepare(v_uid);
  if v_status = 'succeeded' and v_spend > 0 then
    select * into v_row from public.turn_credits c where c.owner = v_uid;
    if v_row.frozen then
      raise exception using errcode = 'P0001',
        message = 'CREDITS_FROZEN: credits are on hold while a payment dispute is reviewed.';
    end if;
    if v_row.plan_remaining + public.turn__active_lots(v_uid) < v_spend then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_CREDITS';
    end if;
    perform public.turn__take(v_uid, v_spend, false);
  end if;
  insert into public.turn_usage_events(
    owner, kind, provider, model, task, credits, status, request_id,
    input_tokens, output_tokens, total_tokens, provider_cost_usd, metadata)
  values (
    v_uid, coalesce(turn_record_usage_event.event_kind, 'generation'),
    turn_record_usage_event.provider_name, turn_record_usage_event.model_name, turn_record_usage_event.task_name,
    case when v_status = 'succeeded' then v_spend else 0 end,
    v_status, turn_record_usage_event.request_key,
    turn_record_usage_event.input_token_count, turn_record_usage_event.output_token_count,
    coalesce(turn_record_usage_event.input_token_count, 0) + coalesce(turn_record_usage_event.output_token_count, 0),
    turn_record_usage_event.provider_cost, coalesce(turn_record_usage_event.usage_metadata, '{}'::jsonb));
  return query select c.remaining, c.plan from public.turn_credits c where c.owner = v_uid;
end $$;

-- turn_credit_regime: which credit unit is live (public facts, any role).
-- Before billing-switch.sql: 1 credit = $0.03, no trial. After: $0.01, trial 50.
create or replace function public.turn_credit_regime()
returns table (switched boolean, switched_at timestamptz, usd_per_credit numeric,
               trial_credits integer, legacy_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.at is not null,
         s.at,
         case when s.at is not null then 0.01 else 0.03 end::numeric,
         public.turn__trial_amount(),
         (s.value ->> 'legacy_until')::timestamptz
    from (select (select b.at from public.turn_billing_state b where b.key = 'credit_unit_switch') as at,
                 (select b.value from public.turn_billing_state b where b.key = 'credit_unit_switch') as value) s
$$;

-- ── 5. server functions (service role only) ─────────────────────────────────
-- turn_hold_credits: take `amount` credits NOW (plan first, then packs), before the
-- job runs. Atomic per account (row lock), idempotent per ref (a repeat returns the
-- first hold). Refuses with code 'insufficient' or 'frozen'; other codes:
-- 'ref_conflict' (the ref belongs to another account), 'released'.
create or replace function public.turn_hold_credits(uid uuid, amount integer, ref text, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid    uuid := turn_hold_credits.uid;
  v_amount integer := turn_hold_credits.amount;
  v_ref    text := nullif(trim(coalesce(turn_hold_credits.ref, '')), '');
  v_reason text := nullif(trim(coalesce(turn_hold_credits.reason, '')), '');
  v_row    public.turn_credits;
  v_hold   public.turn_credit_holds;
  v_avail  integer;
  v_take   record;
begin
  perform public.turn__service_only('turn_hold_credits');
  if v_uid is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_hold_credits needs uid';
  end if;
  if v_ref is null or length(v_ref) > 200 then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_hold_credits needs a ref of 1-200 characters';
  end if;
  if v_amount is null or v_amount < 0 then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_hold_credits needs an amount of 0 or more';
  end if;
  perform public.turn__prepare(v_uid);
  select * into v_hold from public.turn_credit_holds h where h.ref = v_ref for update;
  if found then
    if v_hold.owner <> v_uid then
      return jsonb_build_object('ok', false, 'code', 'ref_conflict', 'held', 0, 'remaining', public.turn__total(v_uid));
    end if;
    return jsonb_build_object('ok', v_hold.status <> 'released', 'duplicate', true, 'status', v_hold.status,
                              'held', v_hold.held, 'remaining', public.turn__total(v_uid))
           || case when v_hold.status = 'released' then jsonb_build_object('code', 'released') else '{}'::jsonb end;
  end if;
  select * into v_row from public.turn_credits c where c.owner = v_uid;
  v_avail := v_row.plan_remaining + public.turn__active_lots(v_uid);
  if v_row.frozen then
    return jsonb_build_object('ok', false, 'code', 'frozen', 'held', 0, 'remaining', v_avail);
  end if;
  if v_avail < v_amount then
    return jsonb_build_object('ok', false, 'code', 'insufficient', 'held', 0, 'remaining', v_avail, 'needed', v_amount);
  end if;
  begin
    select * into v_take from public.turn__take(v_uid, v_amount, false);
    insert into public.turn_credit_holds(ref, owner, held, from_plan, from_lots, plan_period_start, reason)
      values (v_ref, v_uid, v_amount, v_take.o_plan, v_take.o_lots, v_row.plan_period_start, v_reason);
  exception when unique_violation then
    -- the same ref was just taken for ANOTHER account: this block (and its take) is undone
    return jsonb_build_object('ok', false, 'code', 'ref_conflict', 'held', 0, 'remaining', public.turn__total(v_uid));
  end;
  return jsonb_build_object('ok', true, 'held', v_amount, 'remaining', public.turn__total(v_uid));
end $$;

-- turn_settle_hold: keep min(actual, held), give the rest back; a repeat returns the
-- first outcome. Writes one turn_usage_events row (kind 'hold', task = the reason).
create or replace function public.turn_settle_hold(ref text, actual integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ref text := nullif(trim(coalesce(turn_settle_hold.ref, '')), '');
begin
  perform public.turn__service_only('turn_settle_hold');
  if v_ref is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_settle_hold needs a ref';
  end if;
  if turn_settle_hold.actual is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_settle_hold needs the actual cost';
  end if;
  return public.turn__finish_hold(v_ref, greatest(0, turn_settle_hold.actual));
end $$;

-- turn_release_hold: give everything back (the job failed); no-op when already
-- settled or released.
create or replace function public.turn_release_hold(ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ref text := nullif(trim(coalesce(turn_release_hold.ref, '')), '');
begin
  perform public.turn__service_only('turn_release_hold');
  if v_ref is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_release_hold needs a ref';
  end if;
  return public.turn__finish_hold(v_ref, null);
end $$;

-- turn_hold_attach: attach the provider's job id to a hold, once, right after the
-- submit (fal request id for a video, the mesh job id for Blender). The same value
-- again is ok (idempotent); a different value, or a job id already on another hold,
-- is {ok:false, code:'mismatch'}; an unknown ref is {ok:false, code:'unknown'}.
-- Works on a finished hold too (the answer carries its status).
create or replace function public.turn_hold_attach(ref text, provider_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ref  text := nullif(trim(coalesce(turn_hold_attach.ref, '')), '');
  v_pref text := nullif(trim(coalesce(turn_hold_attach.provider_ref, '')), '');
  v_hold public.turn_credit_holds;
begin
  perform public.turn__service_only('turn_hold_attach');
  if v_ref is null or v_pref is null or length(v_pref) > 500 then
    raise exception using errcode = '22023',
      message = 'KINOLOT_BILLING: turn_hold_attach needs a ref and a provider_ref of 1-500 characters';
  end if;
  select * into v_hold from public.turn_credit_holds h where h.ref = v_ref for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown', 'ref', v_ref);
  end if;
  if v_hold.provider_ref is not null then
    if v_hold.provider_ref = v_pref then
      return jsonb_build_object('ok', true, 'duplicate', true, 'ref', v_ref, 'status', v_hold.status);
    end if;
    return jsonb_build_object('ok', false, 'code', 'mismatch', 'ref', v_ref, 'status', v_hold.status);
  end if;
  begin
    update public.turn_credit_holds h set provider_ref = v_pref where h.ref = v_ref;
  exception when unique_violation then
    -- that job id is already attached to ANOTHER hold
    return jsonb_build_object('ok', false, 'code', 'mismatch', 'ref', v_ref, 'status', v_hold.status);
  end;
  return jsonb_build_object('ok', true, 'ref', v_ref, 'status', v_hold.status);
end $$;

-- turn_hold_lookup: the hold a provider job id belongs to. {found:false} when none.
create or replace function public.turn_hold_lookup(provider_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pref text := nullif(trim(coalesce(turn_hold_lookup.provider_ref, '')), '');
  v_hold public.turn_credit_holds;
begin
  perform public.turn__service_only('turn_hold_lookup');
  if v_pref is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_hold from public.turn_credit_holds h where h.provider_ref = v_pref;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'ref', v_hold.ref, 'owner', v_hold.owner, 'held', v_hold.held,
                            'status', v_hold.status, 'kept', v_hold.kept, 'created_at', v_hold.created_at,
                            'reason', v_hold.reason);
end $$;

-- turn_open_provider_holds: the open holds tied to a provider job (provider_ref set)
-- that are older than N minutes, oldest first, at most max_rows (1-500). The server's
-- reconciliation (POST {"op":"reconcile_holds"} to image-proxy / blender-bridge, every
-- 10 minutes from billing-housekeeping-cron.sql) asks the provider about each one and
-- settles it (the job finished) or releases it (the job failed or is unknown), so a
-- render whose tab was closed is charged only if it really finished. ref_prefix
-- (optional, e.g. 'video:' or 'studio:') keeps one function's holds from crowding out
-- the other's.
create or replace function public.turn_open_provider_holds(older_than_minutes integer default 60,
                                                           max_rows integer default 50,
                                                           ref_prefix text default null)
returns table (ref text, owner uuid, provider_ref text, held integer, reason text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_mins   integer := greatest(0, coalesce(turn_open_provider_holds.older_than_minutes, 60));
  v_rows   integer := least(500, greatest(1, coalesce(turn_open_provider_holds.max_rows, 50)));
  v_prefix text := nullif(turn_open_provider_holds.ref_prefix, '');
begin
  perform public.turn__service_only('turn_open_provider_holds');
  return query
    select h.ref, h.owner, h.provider_ref, h.held, h.reason, h.created_at
      from public.turn_credit_holds h
     where h.status = 'held' and h.provider_ref is not null
       and h.created_at < pg_catalog.now() - make_interval(mins => v_mins)
       and (v_prefix is null or left(h.ref, length(v_prefix)) = v_prefix)
     order by h.created_at, h.ref
     limit v_rows;
end $$;

-- turn_claim_housekeeping: an atomic throttle for a server housekeeping job (one
-- turn_billing_state row per job, key 'housekeeping:<job>'). true = this caller may run
-- now (the job's last run is older than every_seconds, or it never ran), and the run
-- is recorded; false = another caller ran it within the window. Two callers at the
-- same moment: exactly one gets true (the row lock of INSERT ... ON CONFLICT).
create or replace function public.turn_claim_housekeeping(job text, every_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job  text := nullif(trim(coalesce(turn_claim_housekeeping.job, '')), '');
  v_secs integer := greatest(0, coalesce(turn_claim_housekeeping.every_seconds, 0));
  v_n    integer;
begin
  perform public.turn__service_only('turn_claim_housekeeping');
  if v_job is null or length(v_job) > 100 then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_claim_housekeeping needs a job name of 1-100 characters';
  end if;
  insert into public.turn_billing_state as s (key, value, at)
    values ('housekeeping:' || v_job, jsonb_build_object('every_seconds', v_secs, 'runs', 1), pg_catalog.clock_timestamp())
    on conflict (key) do update
      set value = jsonb_build_object('every_seconds', v_secs, 'runs', coalesce((s.value ->> 'runs')::bigint, 0) + 1),
          at = pg_catalog.clock_timestamp()
      where s.at <= pg_catalog.clock_timestamp() - make_interval(secs => v_secs);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- housekeeping (REQUIRED from day 0: supabase/billing-housekeeping-cron.sql schedules
-- it every 10 minutes). A hold with NO provider job (text, image, voice, or a submit
-- that never started) left open longer than N minutes is released: its worker
-- crashed or was killed before its own settle / release ran. A hold WITH a provider
-- job (provider_ref: a submitted video or 3D job) is left alone here: its poll, or the
-- server's reconciliation (turn_open_provider_holds, every 10 minutes), settles it when
-- the provider says it finished and releases it when the provider says it failed. Only
-- as a last resort, one still open after 30 days (the provider never answered) is
-- SETTLED at the held amount. Returns the number of holds finished.
create or replace function public.turn_release_stale_holds(older_than_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold record;
  v_n    integer := 0;
begin
  perform public.turn__service_only('turn_release_stale_holds');
  for v_hold in
    select h.ref from public.turn_credit_holds h
     where h.status = 'held' and h.provider_ref is null
       and h.created_at < pg_catalog.now() - make_interval(mins => greatest(1, coalesce(older_than_minutes, 30)))
     order by h.created_at
  loop
    perform public.turn__finish_hold(v_hold.ref, null);
    v_n := v_n + 1;
  end loop;
  for v_hold in
    select h.ref, h.held from public.turn_credit_holds h
     where h.status = 'held' and h.provider_ref is not null
       and h.created_at < pg_catalog.now() - interval '30 days'
     order by h.created_at
  loop
    perform public.turn__finish_hold(v_hold.ref, v_hold.held);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- housekeeping: zero every expired lot and resync its account (reads do this per
-- account anyway). Returns the number of accounts touched.
create or replace function public.turn_expire_lots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_n     integer := 0;
begin
  perform public.turn__service_only('turn_expire_lots');
  for v_owner in
    select distinct l.owner from public.turn_credit_lots l
     where l.remaining > 0 and l.expires_at <= pg_catalog.now()
  loop
    perform public.turn__lock(v_owner);
    perform public.turn__sweep(v_owner);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- turn_set_plan_once: start or renew a plan, once per event id (the webhook passes
-- its idempotency key, e.g. 'invoice:in_...'). Renewal resets PLAN credits only;
-- grandfathered allowance while legacy_until > now(). Returns the total balance
-- (a repeat returns the current balance and changes nothing). A subscription that
-- conflicts with the account's stored one (turn__plan_conflict) grants nothing: the
-- event's result says {"skipped": "subscription_conflict"} and turn_grant_failures
-- has the row the owner resolves.
create or replace function public.turn_set_plan_once(event_id text, uid uuid, new_tier text, monthly_credits integer,
                                                     sub_id text default null, customer_id text default null,
                                                     renews timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event text := nullif(trim(coalesce(turn_set_plan_once.event_id, '')), '');
  v_uid   uuid := turn_set_plan_once.uid;
  v_bal   integer;
begin
  perform public.turn__service_only('turn_set_plan_once');
  if v_event is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: missing Stripe event id';
  end if;
  if v_uid is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_set_plan_once needs uid';
  end if;
  if not public.turn__claim_event(v_event, 'turn_set_plan_once', v_uid) then
    return public.turn__total(v_uid);
  end if;
  if public.turn__plan_conflict(v_uid, turn_set_plan_once.new_tier, turn_set_plan_once.monthly_credits,
                                turn_set_plan_once.sub_id, turn_set_plan_once.customer_id, v_event, 'turn_set_plan_once') then
    update public.turn_stripe_events e set result = jsonb_build_object('skipped', 'subscription_conflict') where e.id = v_event;
    return public.turn__total(v_uid);
  end if;
  v_bal := public.turn__apply_plan(v_uid, turn_set_plan_once.new_tier, turn_set_plan_once.monthly_credits,
                                   turn_set_plan_once.sub_id, turn_set_plan_once.customer_id,
                                   turn_set_plan_once.renews, v_event);
  update public.turn_stripe_events e set result = jsonb_build_object('balance', v_bal) where e.id = v_event;
  return v_bal;
end $$;

-- turn_adjust_plan_once: immediate upgrade — set the tier and add the allowance
-- difference, once per event id. Refused (recorded in turn_grant_failures, reason
-- subscription_mismatch) when sub_id is not the stored subscription. A negative
-- difference adds nothing (downgrades apply at the renewal). Grandfathered accounts
-- get at least the difference between the two old allowances in the new units.
-- Stripe charges an upgrade pro rata, so the difference is scaled by the part of the
-- paid period still to run (renews_at; the period starts at plan_period_start, or a
-- month before renews_at), rounded up. No period known (no renewal date, or it has
-- passed) -> nothing is added now: the next renewal grants the new plan's allowance.
create or replace function public.turn_adjust_plan_once(event_id text, uid uuid, new_tier text, add_credits integer,
                                                        sub_id text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event text := nullif(trim(coalesce(turn_adjust_plan_once.event_id, '')), '');
  v_uid   uuid := turn_adjust_plan_once.uid;
  v_tier  text := nullif(trim(coalesce(turn_adjust_plan_once.new_tier, '')), '');
  v_add   integer := greatest(0, coalesce(turn_adjust_plan_once.add_credits, 0));
  v_sub   text := nullif(trim(coalesce(turn_adjust_plan_once.sub_id, '')), '');
  v_row   public.turn_credits;
  v_old   integer;
  v_new   integer;
  v_diff  integer;
  v_now   timestamptz := pg_catalog.now();
  v_start timestamptz;
  v_frac  numeric;
begin
  perform public.turn__service_only('turn_adjust_plan_once');
  if v_event is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: missing Stripe event id';
  end if;
  if v_uid is null or v_tier is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_adjust_plan_once needs uid and new_tier';
  end if;
  if not public.turn__claim_event(v_event, 'turn_adjust_plan_once', v_uid) then
    return public.turn__total(v_uid);
  end if;
  v_row := public.turn__lock(v_uid);
  if v_sub is not null and v_row.stripe_sub_id is not null and v_row.stripe_sub_id <> v_sub then
    insert into public.turn_grant_failures(event_id, event_type, reason, stripe_sub_id, uid, details)
      values (v_event, 'turn_adjust_plan_once', 'subscription_mismatch', v_sub, v_uid,
              jsonb_build_object('stored_sub_id', v_row.stripe_sub_id, 'new_tier', v_tier, 'add_credits', v_add));
    update public.turn_stripe_events e set result = jsonb_build_object('skipped', 'subscription_mismatch') where e.id = v_event;
    return public.turn__total(v_uid);
  end if;
  if v_row.legacy_until is not null and v_row.legacy_until > pg_catalog.now()
     and public.turn__paid_tier(v_tier) and public.turn__paid_tier(v_row.plan) then
    v_old := case when lower(v_row.plan) = lower(coalesce(v_row.legacy_tier, '')) then coalesce(v_row.legacy_allowance, 0)
                  else public.turn__legacy_allowance(v_row.plan) end;
    v_new := case when lower(v_tier) = lower(coalesce(v_row.legacy_tier, '')) then coalesce(v_row.legacy_allowance, 0)
                  else public.turn__legacy_allowance(v_tier) end;
    v_add := greatest(v_add, v_new - v_old);
  end if;
  -- pro rata: the part of the paid period still to run
  v_diff := v_add;
  if v_row.renews_at is null or v_row.renews_at <= v_now then
    v_frac := null;
    v_add := 0;
  else
    v_start := v_row.plan_period_start;
    if v_start is null or v_start >= v_row.renews_at then
      v_start := v_row.renews_at - interval '1 month';
    end if;
    v_frac := least(1, greatest(0, extract(epoch from (v_row.renews_at - v_now))
                                   / greatest(1, extract(epoch from (v_row.renews_at - v_start)))));
    v_add := ceil(v_diff * v_frac)::integer;
  end if;
  update public.turn_credits c
     set plan = v_tier,
         tier = v_tier,
         plan_remaining = c.plan_remaining + v_add,
         plan_allowance = coalesce(c.plan_allowance, 0) + v_add,
         stripe_sub_id = coalesce(c.stripe_sub_id, v_sub),
         paid_since = coalesce(c.paid_since, v_now),
         ledger_sync = true
   where c.owner = v_uid;
  insert into public.turn_plan_grants(owner, kind, tier, amount, event_id, period_start)
    values (v_uid, 'upgrade', v_tier, v_add, v_event, v_row.plan_period_start);
  update public.turn_stripe_events e
     set result = jsonb_build_object('added', v_add, 'difference', v_diff,
                                     'period_fraction', case when v_frac is null then null else round(v_frac, 4) end)
                  || case when v_frac is null and v_diff > 0 then jsonb_build_object('deferred', 'next_renewal') else '{}'::jsonb end
   where e.id = v_event;
  return public.turn__total(v_uid);
end $$;

-- turn_add_pack_once: a pack lot (12 months), once per event id. charge_id links it
-- to its Stripe charge for refunds. Returns the total balance.
-- legacy_unit (default false): the amount is in the OLD unit ($0.03 a credit: the
-- 300 / 1,200 / 4,000 packs sold before the switch day). From the switch on such a
-- grant is x3, like every lot the switch tripled. It is decided HERE, after the
-- account lock is held and right before the lot is written: a grant that arrives
-- while billing-switch.sql runs waits on the switch's table locks and then sees the
-- committed switch (READ COMMITTED: each statement reads what is committed when it
-- starts), and one whose lock came first is written before the switch and tripled
-- by it. Never x3 twice, never missed. false never multiplies.
drop function if exists public.turn_add_pack_once(text, uuid, integer, text);   -- no ambiguous overload
create or replace function public.turn_add_pack_once(event_id text, uid uuid, amount integer, charge_id text default null,
                                                     legacy_unit boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event  text := nullif(trim(coalesce(turn_add_pack_once.event_id, '')), '');
  v_uid    uuid := turn_add_pack_once.uid;
  v_amount integer := turn_add_pack_once.amount;
  v_charge text := nullif(trim(coalesce(turn_add_pack_once.charge_id, '')), '');
  v_legacy boolean := coalesce(turn_add_pack_once.legacy_unit, false);
  v_x3     boolean := false;
begin
  perform public.turn__service_only('turn_add_pack_once');
  if v_event is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: missing Stripe event id';
  end if;
  if v_uid is null or v_amount is null or v_amount < 1 then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_add_pack_once needs uid and an amount of 1 or more';
  end if;
  if not public.turn__claim_event(v_event, 'turn_add_pack_once', v_uid) then
    return public.turn__total(v_uid);
  end if;
  perform public.turn__lock(v_uid);
  -- the old unit's x3: only now, with the lock held (see above)
  if v_legacy and public.turn__switched() then
    v_amount := v_amount * 3;
    v_x3 := true;
  end if;
  insert into public.turn_credit_lots(owner, source, amount, remaining, expires_at, event_id, charge_ref)
    values (v_uid, 'pack', v_amount, v_amount, pg_catalog.now() + interval '12 months', v_event, v_charge);
  -- a pack buyer has paid: never a trial account from now on
  update public.turn_credits c set paid_since = coalesce(c.paid_since, pg_catalog.now()), ledger_sync = true
   where c.owner = v_uid;
  update public.turn_stripe_events e
     set result = jsonb_build_object('lot_credits', v_amount)
                  || case when v_legacy then jsonb_build_object('legacy_unit', true, 'x3', v_x3) else '{}'::jsonb end
   where e.id = v_event;
  return public.turn__total(v_uid);
end $$;

-- turn_revoke_charge_once: a refund (or a lost dispute) — once per event id, remove
-- the UNSPENT credits of every pack lot and plan grant tied to charge_id. "Tied"
-- means the lot's / grant's charge_ref OR its idempotency key equals charge_id, so
-- the webhook may pass the charge id (packs) or the grant's key ('invoice:in_...'
-- for a plan payment). A plan grant gives back at most its amount, and only while its
-- period is the current one: first from the plan credits left, then from the plan
-- part of holds still open in that period (a running job's plan credits no longer
-- come back when it is released: their from_plan is lowered). Returns the credits
-- removed.
create or replace function public.turn_revoke_charge_once(event_id text, charge_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event  text := nullif(trim(coalesce(turn_revoke_charge_once.event_id, '')), '');
  v_charge text := nullif(trim(coalesce(turn_revoke_charge_once.charge_id, '')), '');
  v_total  integer := 0;
  v_lots   integer := 0;
  v_grants integer := 0;
  v_owner  uuid;
  v_lot    record;
  v_grant  record;
  v_hold   record;
  v_row    public.turn_credits;
  v_n      integer;
  v_left   integer;
  v_part   integer;
  v_held   integer;
  v_from_holds integer := 0;
begin
  perform public.turn__service_only('turn_revoke_charge_once');
  if v_event is null or v_charge is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_revoke_charge_once needs event_id and charge_id';
  end if;
  if not public.turn__claim_event(v_event, 'turn_revoke_charge_once', null) then
    return 0;
  end if;
  for v_lot in
    select l.id, l.owner from public.turn_credit_lots l
     where (l.charge_ref = v_charge or l.event_id = v_charge) and l.revoked_at is null
     order by l.owner, l.created_at
  loop
    perform public.turn__lock(v_lot.owner);
    update public.turn_credit_lots l
       set revoked_amount = l.remaining, remaining = 0, revoked_at = pg_catalog.now()
     where l.id = v_lot.id and l.revoked_at is null
    returning l.revoked_amount into v_n;
    v_total := v_total + coalesce(v_n, 0);
    v_lots := v_lots + 1;
    v_owner := v_lot.owner;
    perform public.turn__sync(v_lot.owner);
  end loop;
  for v_grant in
    select g.id, g.owner, g.amount, g.period_start, g.kind from public.turn_plan_grants g
     where (g.charge_ref = v_charge or g.event_id = v_charge) and g.revoked_at is null and g.kind <> 'trial'
     order by g.owner, g.created_at
  loop
    v_row := public.turn__lock(v_grant.owner);
    v_n := 0;
    v_held := 0;
    if v_row.plan_period_start is not distinct from v_grant.period_start then
      v_n := least(v_row.plan_remaining, greatest(0, v_grant.amount));
      -- the rest of the grant may sit in holds of running jobs: those plan credits
      -- must not come back when the job is released (turn__give_back returns plan
      -- credits of the same period up to the hold's from_plan)
      v_left := greatest(0, v_grant.amount) - v_n;
      for v_hold in
        select h.ref, h.from_plan from public.turn_credit_holds h
         where h.owner = v_grant.owner and h.status = 'held' and h.from_plan > 0
           and h.plan_period_start is not distinct from v_grant.period_start
         order by h.created_at desc, h.ref
         for update
      loop
        exit when v_left <= 0;
        v_part := least(v_left, v_hold.from_plan);
        update public.turn_credit_holds h set from_plan = h.from_plan - v_part where h.ref = v_hold.ref;
        v_held := v_held + v_part;
        v_left := v_left - v_part;
      end loop;
    end if;
    update public.turn_credits c set plan_remaining = c.plan_remaining - v_n, ledger_sync = true
     where c.owner = v_grant.owner;
    update public.turn_plan_grants g set revoked_at = pg_catalog.now(), revoked_amount = v_n + v_held where g.id = v_grant.id;
    v_total := v_total + v_n + v_held;
    v_from_holds := v_from_holds + v_held;
    v_grants := v_grants + 1;
    v_owner := v_grant.owner;
  end loop;
  update public.turn_stripe_events e
     set uid = v_owner, result = jsonb_build_object('removed', v_total, 'lots', v_lots, 'plan_grants', v_grants,
                                                    'from_open_holds', v_from_holds)
   where e.id = v_event;
  return v_total;
end $$;

-- turn_set_payment_status: 'active' | 'past_due' (a failed renewal). Credits stay
-- usable; refills simply don't happen until an invoice is paid (which sets 'active').
create or replace function public.turn_set_payment_status(uid uuid, status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text := lower(trim(coalesce(turn_set_payment_status.status, '')));
begin
  perform public.turn__service_only('turn_set_payment_status');
  if v_status not in ('active', 'past_due') then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: payment status must be active or past_due';
  end if;
  perform public.turn__lock(turn_set_payment_status.uid);
  update public.turn_credits c set payment_status = v_status where c.owner = turn_set_payment_status.uid;
end $$;

-- turn_set_frozen: an open dispute freezes spending (spend, usage, holds refuse);
-- false lifts it. The reason is kept for support.
create or replace function public.turn_set_frozen(uid uuid, frozen boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.turn__service_only('turn_set_frozen');
  if turn_set_frozen.frozen is null then
    raise exception using errcode = '22023', message = 'KINOLOT_BILLING: turn_set_frozen needs true or false';
  end if;
  perform public.turn__lock(turn_set_frozen.uid);
  update public.turn_credits c
     set frozen = turn_set_frozen.frozen,
         frozen_reason = coalesce(nullif(trim(coalesce(turn_set_frozen.reason, '')), ''), c.frozen_reason),
         frozen_at = case when turn_set_frozen.frozen then pg_catalog.now() else null end
   where c.owner = turn_set_frozen.uid;
end $$;

-- turn_end_plan_for_sub: the subscription ended. Only when sub_id is the stored
-- subscription (another subscription on the same Stripe customer changes nothing).
-- BEFORE the credit switch day (turn__switched() false) the plan ends and its plan
-- credits stay usable, as today's turn_end_plan does and the published Terms say
-- (the 30 days' notice announces the change). FROM the switch day on, plan credits
-- end with the paid period. Pack lots always keep their expiry.
-- Returns true when the plan was ended.
create or replace function public.turn_end_plan_for_sub(uid uuid, sub_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := turn_end_plan_for_sub.uid;
  v_sub text := nullif(trim(coalesce(turn_end_plan_for_sub.sub_id, '')), '');
  v_row public.turn_credits;
  v_end boolean;
begin
  perform public.turn__service_only('turn_end_plan_for_sub');
  v_row := public.turn__lock(v_uid);
  if v_sub is null or v_row.stripe_sub_id is null or v_row.stripe_sub_id <> v_sub then
    return false;
  end if;
  v_end := public.turn__switched();
  -- before the switch the kept plan credits keep their period too, so a refund of the
  -- last payment can still take back what is unspent and a running job's release
  -- still returns its plan part
  update public.turn_credits c
     set plan = 'none', tier = null, stripe_sub_id = null, renews_at = null,
         plan_remaining = case when v_end then 0 else c.plan_remaining end,
         plan_allowance = null,
         plan_period_start = case when v_end then null else c.plan_period_start end,
         pending_tier = null, payment_status = 'active', ledger_sync = true
   where c.owner = v_uid;
  insert into public.turn_usage_events(owner, kind, task, credits, status, metadata)
    values (v_uid, 'plan_end', 'subscription_ended', 0, 'expired',
            jsonb_build_object('sub_id', v_sub, 'plan', v_row.plan,
                               'plan_credits_ended', case when v_end then v_row.plan_remaining else 0 end,
                               'plan_credits_kept', case when v_end then 0 else v_row.plan_remaining end));
  return true;
end $$;

-- ── 6. today's functions, same signatures, new balances ─────────────────────
-- turn_set_plan (today's webhook): as turn_set_plan_once without the once-guard
-- (a subscription conflict is refused and recorded the same way).
create or replace function public.turn_set_plan(
    uid uuid, new_tier text, monthly_credits integer,
    sub_id text default null, customer_id text default null, renews timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.turn__service_only('turn_set_plan');
  if turn_set_plan.uid is not null
     and public.turn__plan_conflict(turn_set_plan.uid, turn_set_plan.new_tier, turn_set_plan.monthly_credits,
                                    turn_set_plan.sub_id, turn_set_plan.customer_id, null, 'turn_set_plan') then
    return public.turn__total(turn_set_plan.uid);
  end if;
  return public.turn__apply_plan(turn_set_plan.uid, turn_set_plan.new_tier, turn_set_plan.monthly_credits,
                                 turn_set_plan.sub_id, turn_set_plan.customer_id, turn_set_plan.renews, null);
end $$;

-- turn_add_pack: a pack lot (12 months), no event id
create or replace function public.turn_add_pack(uid uuid, amount integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.turn__service_only('turn_add_pack');
  perform public.turn__lock(turn_add_pack.uid);
  if coalesce(turn_add_pack.amount, 0) > 0 then
    insert into public.turn_credit_lots(owner, source, amount, remaining, expires_at)
      values (turn_add_pack.uid, 'pack', turn_add_pack.amount, turn_add_pack.amount, pg_catalog.now() + interval '12 months');
    update public.turn_credits c set paid_since = coalesce(c.paid_since, pg_catalog.now()), ledger_sync = true
     where c.owner = turn_add_pack.uid;
  end if;
  return public.turn__total(turn_add_pack.uid);
end $$;

-- turn_apply_pack_once (today's webhook): a pack lot, once per Stripe event id
create or replace function public.turn_apply_pack_once(
    event_id text, uid uuid, amount integer, event_type text default 'checkout.session.completed')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_event text := nullif(trim(coalesce(turn_apply_pack_once.event_id, '')), '');
  v_uid   uuid := turn_apply_pack_once.uid;
begin
  perform public.turn__service_only('turn_apply_pack_once');
  if v_event is null then raise exception 'Missing Stripe event id'; end if;
  if public.turn__claim_event(v_event, 'turn_apply_pack_once', v_uid,
                              coalesce(turn_apply_pack_once.event_type, 'checkout.session.completed'))
     and coalesce(turn_apply_pack_once.amount, 0) > 0 then
    perform public.turn__lock(v_uid);
    insert into public.turn_credit_lots(owner, source, amount, remaining, expires_at, event_id)
      values (v_uid, 'pack', turn_apply_pack_once.amount, turn_apply_pack_once.amount,
              pg_catalog.now() + interval '12 months', v_event);
    update public.turn_credits c set paid_since = coalesce(c.paid_since, pg_catalog.now()), ledger_sync = true
     where c.owner = v_uid;
  end if;
  return public.turn__total(v_uid);
end $$;

-- turn_end_plan (today's webhook): drop the plan and keep every credit, as before.
-- The new webhook uses turn_end_plan_for_sub instead.
create or replace function public.turn_end_plan(uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.turn__service_only('turn_end_plan');
  update public.turn_credits c
     set plan = 'none', tier = null, stripe_sub_id = null, renews_at = null
   where c.owner = turn_end_plan.uid;
end $$;

-- turn_grant_credits (SQL editor): a positive amount is a 12-month 'grant' lot
-- (never wiped by a renewal); a negative amount takes credits away (plan credits
-- first, then lots, never below 0). Returns the new total.
--   select public.turn_grant_credits('someone@example.com', 100);
create or replace function public.turn_grant_credits(user_email text, amount integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid;
begin
  perform public.turn__service_only('turn_grant_credits');
  select u.id into v_uid from auth.users u where lower(u.email) = lower(turn_grant_credits.user_email) limit 1;
  if v_uid is null then
    raise exception 'No user with email %', turn_grant_credits.user_email;
  end if;
  perform public.turn__lock(v_uid);
  perform public.turn__sweep(v_uid);
  if coalesce(turn_grant_credits.amount, 0) > 0 then
    insert into public.turn_credit_lots(owner, source, amount, remaining, expires_at)
      values (v_uid, 'grant', turn_grant_credits.amount, turn_grant_credits.amount, pg_catalog.now() + interval '12 months');
    perform public.turn__sync(v_uid);
  elsif coalesce(turn_grant_credits.amount, 0) < 0 then
    perform public.turn__take(v_uid, -turn_grant_credits.amount, true);
  end if;
  return public.turn__total(v_uid);
end $$;

-- ── 7. one-time carry-over (first run only; marker 'v2_installed') ──────────
do $carry$
declare
  v_row      record;
  v_excess   integer;
  v_accounts integer := 0;
  v_credits  bigint := 0;
begin
  if exists (select 1 from public.turn_billing_state s where s.key = 'v2_installed') then
    return;
  end if;
  -- whoever has paid (a plan, a Stripe customer) or holds credits is not a trial account
  update public.turn_credits c
     set paid_since = coalesce(c.updated_at, pg_catalog.now())
   where c.paid_since is null
     and (public.turn__paid_tier(c.plan) or c.stripe_customer_id is not null
          or c.stripe_sub_id is not null or c.plan_remaining > 0);
  -- today's allowances (1 credit = $0.03): Writer 800, Director 2,400 (legacy 'pro' is
  -- Director), Producer 9,000
  update public.turn_credits c
     set plan_allowance = case lower(c.plan) when 'writer' then 800 when 'director' then 2400 when 'pro' then 2400
                                             when 'studio' then 9000 end
   where c.plan_allowance is null and public.turn__paid_tier(c.plan);
  for v_row in
    select c.owner, c.plan, c.plan_remaining from public.turn_credits c where c.plan_remaining > 0 for update
  loop
    v_excess := case lower(coalesce(v_row.plan, ''))
                  when 'writer'   then greatest(0, v_row.plan_remaining - 800)
                  when 'director' then greatest(0, v_row.plan_remaining - 2400)
                  when 'pro'      then greatest(0, v_row.plan_remaining - 2400)
                  when 'studio'   then greatest(0, v_row.plan_remaining - 9000)
                  else v_row.plan_remaining end;
    if v_excess > 0 then
      insert into public.turn_credit_lots(owner, source, amount, remaining, expires_at)
        values (v_row.owner, 'carry', v_excess, v_excess, pg_catalog.now() + interval '12 months');
      update public.turn_credits c
         set plan_remaining = c.plan_remaining - v_excess, ledger_sync = true
       where c.owner = v_row.owner;
      v_accounts := v_accounts + 1;
      v_credits := v_credits + v_excess;
    end if;
  end loop;
  insert into public.turn_billing_state(key, value)
    values ('v2_installed', jsonb_build_object('carried_accounts', v_accounts, 'carried_credits', v_credits));
end;
$carry$;

-- ── 8. privileges ───────────────────────────────────────────────────────────
-- Supabase grants every new table and function to anon and authenticated DIRECTLY,
-- so "from public" alone is not enough: each API role is named.
drop policy if exists "turn_credit_lots_select_own" on public.turn_credit_lots;
create policy "turn_credit_lots_select_own" on public.turn_credit_lots
  for select using (auth.uid() = owner);
revoke all on table public.turn_credit_lots, public.turn_credit_holds, public.turn_plan_grants,
                    public.turn_billing_state, public.turn_stripe_events, public.turn_spend_events,
                    public.turn_grant_failures
  from public, anon, authenticated;
grant select on table public.turn_credit_lots to authenticated;
-- users read their own balance and usage rows (RLS); nobody writes them through the API
revoke insert, update, delete, truncate, references, trigger on table public.turn_credits, public.turn_usage_events
  from public, anon, authenticated;

-- browser functions: signed-in users only
revoke all on function public.turn_credit_balance() from public, anon;
revoke all on function public.turn_spend_credit(integer, text) from public, anon;
revoke all on function public.turn_record_usage_event(text, text, text, text, integer, text, text, integer, integer, numeric, jsonb) from public, anon;
grant execute on function public.turn_credit_balance() to authenticated;
grant execute on function public.turn_spend_credit(integer, text) to authenticated;
grant execute on function public.turn_record_usage_event(text, text, text, text, integer, text, text, integer, integer, numeric, jsonb) to authenticated;

-- public facts
revoke all on function public.turn_credit_regime() from public;
grant execute on function public.turn_credit_regime() to anon, authenticated, service_role;

-- server functions: the service role (and the SQL editor) only
do $service$
declare
  f text;
begin
  foreach f in array array[
    'public.turn_hold_credits(uuid, integer, text, text)',
    'public.turn_settle_hold(text, integer)',
    'public.turn_release_hold(text)',
    'public.turn_hold_attach(text, text)',
    'public.turn_hold_lookup(text)',
    'public.turn_open_provider_holds(integer, integer, text)',
    'public.turn_claim_housekeeping(text, integer)',
    'public.turn_release_stale_holds(integer)',
    'public.turn_expire_lots()',
    'public.turn_set_plan_once(text, uuid, text, integer, text, text, timestamptz)',
    'public.turn_adjust_plan_once(text, uuid, text, integer, text)',
    'public.turn_add_pack_once(text, uuid, integer, text, boolean)',
    'public.turn_revoke_charge_once(text, text)',
    'public.turn_set_payment_status(uuid, text)',
    'public.turn_set_frozen(uuid, boolean, text)',
    'public.turn_end_plan_for_sub(uuid, text)',
    'public.turn_set_plan(uuid, text, integer, text, text, timestamptz)',
    'public.turn_add_pack(uuid, integer)',
    'public.turn_apply_pack_once(text, uuid, integer, text)',
    'public.turn_end_plan(uuid)',
    'public.turn_grant_credits(text, integer)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- internal helpers and the trigger function: no API role at all
  foreach f in array array[
    'public.turn__credits_sync_trg()',
    'public.turn__service_only(text)',
    'public.turn__paid_tier(text)',
    'public.turn__legacy_allowance(text)',
    'public.turn__switched()',
    'public.turn__trial_amount()',
    'public.turn__email_key(text)',
    'public.turn__active_lots(uuid)',
    'public.turn__total(uuid)',
    'public.turn__sync(uuid)',
    'public.turn__lock(uuid)',
    'public.turn__sweep(uuid)',
    'public.turn__maybe_trial(uuid)',
    'public.turn__prepare(uuid)',
    'public.turn__take(uuid, integer, boolean)',
    'public.turn__give_back(uuid, integer, jsonb, timestamptz, integer)',
    'public.turn__claim_event(text, text, uuid, text)',
    'public.turn__plan_conflict(uuid, text, integer, text, text, text, text)',
    'public.turn__apply_plan(uuid, text, integer, text, text, timestamptz, text)',
    'public.turn__finish_hold(text, integer)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end;
$service$;

-- expired lots out of every stored total, so the checks below see settled balances
do $sweep$ begin perform public.turn_expire_lots(); end; $sweep$;

-- let the Data API see the new functions now
notify pgrst, 'reload schema';
-- <<< KINOLOT BILLING V2 DEFINITIONS <<<

commit;

-- ── RESULT — the table the SQL Editor shows after Run ───────────────────────
with fns(sig, kind) as (values
    ('public.turn_credit_balance()', 'browser'),
    ('public.turn_spend_credit(integer, text)', 'browser'),
    ('public.turn_record_usage_event(text, text, text, text, integer, text, text, integer, integer, numeric, jsonb)', 'browser'),
    ('public.turn_credit_regime()', 'public'),
    ('public.turn_hold_credits(uuid, integer, text, text)', 'service'),
    ('public.turn_settle_hold(text, integer)', 'service'),
    ('public.turn_release_hold(text)', 'service'),
    ('public.turn_hold_attach(text, text)', 'service'),
    ('public.turn_hold_lookup(text)', 'service'),
    ('public.turn_open_provider_holds(integer, integer, text)', 'service'),
    ('public.turn_claim_housekeeping(text, integer)', 'service'),
    ('public.turn_release_stale_holds(integer)', 'service'),
    ('public.turn_expire_lots()', 'service'),
    ('public.turn_set_plan_once(text, uuid, text, integer, text, text, timestamptz)', 'service'),
    ('public.turn_adjust_plan_once(text, uuid, text, integer, text)', 'service'),
    ('public.turn_add_pack_once(text, uuid, integer, text, boolean)', 'service'),
    ('public.turn_revoke_charge_once(text, text)', 'service'),
    ('public.turn_set_payment_status(uuid, text)', 'service'),
    ('public.turn_set_frozen(uuid, boolean, text)', 'service'),
    ('public.turn_end_plan_for_sub(uuid, text)', 'service'),
    ('public.turn_set_plan(uuid, text, integer, text, text, timestamptz)', 'service'),
    ('public.turn_add_pack(uuid, integer)', 'service'),
    ('public.turn_apply_pack_once(text, uuid, integer, text)', 'service'),
    ('public.turn_end_plan(uuid)', 'service'),
    ('public.turn_grant_credits(text, integer)', 'service'),
    ('public.turn__credits_sync_trg()', 'trigger'),
    ('public.turn__service_only(text)', 'internal'),
    ('public.turn__paid_tier(text)', 'internal'),
    ('public.turn__legacy_allowance(text)', 'internal'),
    ('public.turn__switched()', 'internal'),
    ('public.turn__trial_amount()', 'internal'),
    ('public.turn__email_key(text)', 'internal'),
    ('public.turn__active_lots(uuid)', 'internal'),
    ('public.turn__total(uuid)', 'internal'),
    ('public.turn__sync(uuid)', 'internal'),
    ('public.turn__lock(uuid)', 'internal'),
    ('public.turn__sweep(uuid)', 'internal'),
    ('public.turn__maybe_trial(uuid)', 'internal'),
    ('public.turn__prepare(uuid)', 'internal'),
    ('public.turn__take(uuid, integer, boolean)', 'internal'),
    ('public.turn__give_back(uuid, integer, jsonb, timestamptz, integer)', 'internal'),
    ('public.turn__claim_event(text, text, uuid, text)', 'internal'),
    ('public.turn__plan_conflict(uuid, text, integer, text, text, text, text)', 'internal'),
    ('public.turn__apply_plan(uuid, text, integer, text, text, timestamptz, text)', 'internal'),
    ('public.turn__finish_hold(text, integer)', 'internal')),
  f as (
    select x.sig, x.kind, to_regprocedure(x.sig) as oid from fns x),
  priv as (
    select f.sig, f.kind, f.oid,
           f.oid is not null as present,
           coalesce((select p.prosecdef from pg_catalog.pg_proc p where p.oid = f.oid), false) as definer,
           coalesce((select exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                                     where cfg like 'search_path=%')
                       from pg_catalog.pg_proc p where p.oid = f.oid), false) as pinned,
           f.oid is not null and has_function_privilege('public', f.oid, 'EXECUTE') as pub,
           f.oid is not null and has_function_privilege('anon', f.oid, 'EXECUTE') as anon,
           f.oid is not null and has_function_privilege('authenticated', f.oid, 'EXECUTE') as authed,
           f.oid is not null and has_function_privilege('service_role', f.oid, 'EXECUTE') as svc
      from f),
  tabs(t) as (values ('public.turn_credit_lots'), ('public.turn_credit_holds'), ('public.turn_plan_grants'),
                     ('public.turn_billing_state'), ('public.turn_stripe_events'), ('public.turn_spend_events')),
  cols(c) as (values ('plan_remaining'), ('plan_allowance'), ('plan_period_start'), ('payment_status'), ('frozen'),
                     ('frozen_reason'), ('frozen_at'), ('paid_since'), ('trial_granted_at'), ('trial_email_key'),
                     ('legacy_tier'), ('legacy_allowance'), ('legacy_until'), ('pending_tier'), ('ledger_sync')),
  drift as (
    select count(*) as n
      from public.turn_credits c
     where c.remaining is distinct from c.plan_remaining + public.turn__active_lots(c.owner)),
  carry as (select s.value, s.at from public.turn_billing_state s where s.key = 'v2_installed'),
  sw as (select s.value, s.at from public.turn_billing_state s where s.key = 'credit_unit_switch')
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'New tables, row-level security on' as item,
           case when (select count(*) from tabs t join pg_catalog.pg_class k on k.oid = to_regclass(t.t)
                       where k.relrowsecurity) = 6
                then 'ok' else 'FAIL — re-run the whole file' end as status,
           'turn_credit_lots, turn_credit_holds, turn_plan_grants, turn_billing_state (+ turn_stripe_events, turn_spend_events)' as detail
    union all
    select 20, 'New balance columns on turn_credits',
           case when (select count(*) from cols x join pg_catalog.pg_attribute a
                        on a.attrelid = 'public.turn_credits'::regclass and a.attname = x.c
                       and a.attnum > 0 and not a.attisdropped) = 15
                then 'ok' else 'FAIL — re-run the whole file' end,
           'plan_remaining, plan_allowance, payment_status, frozen, trial and grandfathering columns'
    union all
    select 30, 'Balance trigger',
           case when exists (select 1 from pg_catalog.pg_trigger tg
                              where tg.tgrelid = 'public.turn_credits'::regclass
                                and tg.tgname = 'turn_credits_ledger_sync' and tg.tgenabled <> 'D')
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn_credits_ledger_sync keeps remaining = plan_remaining + unexpired lots'
    union all
    select 40, 'Every function present',
           case when (select count(*) from priv where not present) = 0
                then 'ok' else 'FAIL — missing: ' || (select string_agg(sig, ', ') from priv where not present) end,
           (select count(*) from priv)::text || ' functions (contract, today''s callers, helpers)'
    union all
    select 50, 'Owner-rights functions pin search_path',
           case when (select count(*) from priv where kind in ('browser', 'public', 'service', 'trigger')
                                                   and (not definer or not pinned)) = 0
                 and (select count(*) from priv where kind = 'internal' and (definer or not pinned)) = 0
                then 'ok' else 'FAIL — ' || coalesce((select string_agg(sig, ', ') from priv
                   where (kind <> 'internal' and (not definer or not pinned)) or (kind = 'internal' and (definer or not pinned))), '') end,
           'security definer with a pinned search_path; helpers run with the caller''s rights'
    union all
    select 60, 'Browser functions: signed-in users only',
           case when (select count(*) from priv where kind = 'browser' and (pub or anon or not authed)) = 0
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn_credit_balance, turn_spend_credit, turn_record_usage_event'
    union all
    select 70, 'Server functions: service role only',
           case when (select count(*) from priv where kind = 'service' and (pub or anon or authed or not svc)) = 0
                then 'ok' else 'FAIL — open to: ' || (select string_agg(sig, ', ') from priv
                   where kind = 'service' and (pub or anon or authed or not svc)) end,
           'holds, once-only Stripe grants, refunds, freeze, payment status, today''s webhook functions, admin grant'
    union all
    select 80, 'Helpers: no API role',
           case when (select count(*) from priv where kind in ('internal', 'trigger') and (pub or anon or authed or svc)) = 0
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn__* functions are reachable only from inside the billing functions'
    union all
    select 90, 'Billing tables: no writes through the API',
           case when not exists (
                  select 1 from tabs t, unnest(array['anon', 'authenticated']) rl
                   where has_table_privilege(rl, to_regclass(t.t), 'INSERT, UPDATE, DELETE, TRUNCATE'))
                 and not has_table_privilege('anon', 'public.turn_credits', 'INSERT, UPDATE, DELETE, TRUNCATE')
                 and not has_table_privilege('authenticated', 'public.turn_credits', 'INSERT, UPDATE, DELETE, TRUNCATE')
                 and not has_table_privilege('authenticated', 'public.turn_credit_holds', 'SELECT')
                then 'ok' else 'FAIL — re-run the whole file' end,
           'users may only read their own balance, usage and pack lots'
    union all
    select 100, 'Today''s app still reads the balance',
           case when pg_catalog.pg_get_function_result('public.turn_credit_balance()'::regprocedure)
                     like 'TABLE(remaining integer, plan text, %'
                then 'ok' else 'FAIL — re-run the whole file' end,
           'turn_credit_balance(): remaining and plan stay the first two columns'
    union all
    select 110, 'Every balance adds up',
           case when (select n from drift) = 0 then 'ok'
                else 'FAIL — ' || (select n from drift)::text || ' accounts: remaining <> plan credits + packs' end,
           (select count(*)::text from public.turn_credits) || ' accounts; ' ||
           (select coalesce(sum(c.remaining), 0)::text from public.turn_credits c) || ' credits in total'
    union all
    select 120, 'Carry-over of today''s balances',
           case when exists (select 1 from carry) then 'ok' else 'FAIL — re-run the whole file' end,
           coalesce((select 'done ' || to_char(at, 'YYYY-MM-DD HH24:MI') || ' UTC: ' || (value ->> 'carried_credits')
                            || ' credits of ' || (value ->> 'carried_accounts') || ' accounts moved to 12-month lots'
                       from carry), 'not done')
    union all
    select 130, 'Credit switch and free trial',
           'ok',
           coalesce((select 'switched ' || to_char(at, 'YYYY-MM-DD') || ' (1 credit = $0.01); trial 50 credits; old allowances until '
                            || to_char((value ->> 'legacy_until')::timestamptz, 'YYYY-MM-DD') from sw),
                    'not yet: 1 credit = $0.03 and no trial until supabase/billing-switch.sql runs on the switch day')
  ) r
 order by r.ord;

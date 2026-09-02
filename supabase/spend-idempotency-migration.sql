-- ── SPEND IDEMPOTENCY MIGRATION ──────────────────────────────────────────────
-- Run once in the Supabase SQL editor on existing deployments (new deployments
-- get the same definitions from credits.sql).
--
-- Why: the app queues failed credit-spend records in the browser and replays
-- them on reconnect. A replay can race itself (two tabs, an online event plus
-- a timed flush), and without server-side dedupe the same render could debit
-- twice. Each spend now carries a client-generated event id; the FIRST insert
-- of an id wins and every repeat is a no-op that just returns the balance.
--
-- The client degrades gracefully against a database that has not run this yet
-- (it retries the RPC without event_id when the two-arg signature is missing),
-- so deploying the app first is safe — but double-debit protection only exists
-- once this has run.

-- one row per recorded spend event; touched only by the security-definer RPC
create table if not exists public.turn_spend_events (
  event_id   text primary key,
  owner      uuid not null,
  cost       integer not null,
  created_at timestamptz not null default now()
);
alter table public.turn_spend_events enable row level security;
-- no policies on purpose: clients never read or write it directly

-- replace the single-arg function (an overload would make PostgREST calls
-- with {cost} ambiguous between the two signatures)
drop function if exists public.turn_spend_credit(integer);

create or replace function public.turn_spend_credit(cost integer default 1, event_id text default null)
returns table (remaining integer, plan text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.turn_credits(owner, remaining)
    values (auth.uid(), public.turn_credit_starter())
    on conflict (owner) do nothing;
  -- idempotency: a replayed flush must not double-debit — first insert of an
  -- event id wins; a repeat returns the current balance untouched
  if event_id is not null and length(trim(event_id)) > 0 then
    begin
      insert into public.turn_spend_events(event_id, owner, cost)
        values (trim(event_id), auth.uid(), greatest(1, coalesce(cost, 1)));
    exception when unique_violation then
      return query
        select c.remaining, c.plan from public.turn_credits c where c.owner = auth.uid();
      return;
    end;
  end if;
  update public.turn_credits c
    set remaining = greatest(0, c.remaining - greatest(1, coalesce(cost, 1))),
        updated_at = now()
    where c.owner = auth.uid();
  return query
    select c.remaining, c.plan from public.turn_credits c where c.owner = auth.uid();
end $$;

grant execute on function public.turn_spend_credit(integer, text) to authenticated;

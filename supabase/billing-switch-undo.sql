-- ============================================================================
-- Kinolot — UNDO the credit switch (supabase/billing-switch-undo.sql)
-- Written 2026-09-30. NOT run on production. Run it ONLY to take back a
-- billing-switch.sql that ran by mistake (for example before the 30 days'
-- notice) — as soon as possible after it, and only with the owner's decision.
--
-- WHAT IT DOES (the exact inverse of billing-switch.sql when run soon after)
--   * the free trials granted since the switch are taken back (what is left of
--     their 50 credits) and those accounts can get the trial again on the real
--     switch day;
--   * every balance is divided by 3 again: plan credits and allowances, pack /
--     grant / carried lots (and their history columns), open holds, plan grants.
--     A number that is not a multiple of 3 (something was spent or granted in
--     the new units since the switch) is rounded UP, so nobody loses value;
--   * the grandfathering (legacy_tier / legacy_allowance / legacy_until) is
--     cleared, and the switch marker 'credit_unit_switch' is deleted, so
--     turn_credit_regime() answers $0.03 and no trial again. The marker's values
--     and this run's totals are kept as 'credit_unit_switch_undone'.
--   It refuses, changing nothing, when the switch has not run (no marker).
--   One transaction: any error changes nothing.
--
-- RIGHT AFTER IT (see supabase/README.md "Billing v2" -> "Rollback")
--   * Mac: redeploy image-proxy and blender-bridge (git pull first). A warm
--     instance keeps the unit it read for its whole life, so it would go on
--     pricing at $0.01 against balances that are no longer tripled.
--   * Stripe: plan products' plan_credits back to 800 / 2,400 / 9,000, and the
--     new pack links deactivated (the old ones back on, if they were turned off).
--   * Open tabs of the app read turn_credit_regime() again within about 5 minutes
--     (sooner when someone returns to a tab after a minute away, at once on a
--     reload).
-- ============================================================================
begin;

do $preflight$
begin
  if to_regclass('public.turn_billing_state') is null or to_regclass('public.turn_credit_lots') is null
     or to_regclass('public.turn_credit_holds') is null or to_regclass('public.turn_plan_grants') is null then
    raise exception 'Kinolot credit switch undo: billing-v2.sql has not run, so there is no switch to undo. Nothing was changed.';
  end if;
end;
$preflight$;

-- one switch / undo at a time
lock table public.turn_billing_state in exclusive mode;

do $undo$
declare
  v_at           timestamptz;
  v_value        jsonb;
  v_trials       integer := 0;
  v_trial_taken  bigint := 0;
  v_rounded      integer;
  v_accounts     integer;
  v_drift        integer;
  v_before_plan  bigint; v_before_lots bigint; v_before_total bigint; v_before_held bigint; v_before_grants bigint;
  v_after_plan   bigint; v_after_lots  bigint; v_after_total  bigint; v_after_held  bigint; v_after_grants  bigint;
  v_trial        record;
  v_n            integer;
begin
  select s.at, s.value into v_at, v_value from public.turn_billing_state s where s.key = 'credit_unit_switch';
  if not found then
    raise exception 'Kinolot credit switch undo: the switch has not run (no credit_unit_switch marker), so there is nothing to undo. Nothing was changed.';
  end if;

  lock table public.turn_credits, public.turn_credit_lots, public.turn_credit_holds, public.turn_plan_grants
    in share row exclusive mode;
  perform public.turn_expire_lots();

  -- 1. trials granted since the switch (never-paid accounts): take back what is left
  for v_trial in
    select g.id, g.owner, g.amount from public.turn_plan_grants g
      join public.turn_credits c on c.owner = g.owner
     where g.kind = 'trial' and g.created_at >= v_at
       and c.paid_since is null and not public.turn__paid_tier(c.plan)
     order by g.owner, g.created_at
  loop
    select least(c.plan_remaining, greatest(0, v_trial.amount)) into v_n
      from public.turn_credits c where c.owner = v_trial.owner;
    update public.turn_credits c
       set plan_remaining = c.plan_remaining - v_n, plan_allowance = null,
           trial_granted_at = null, trial_email_key = null, ledger_sync = true
     where c.owner = v_trial.owner;
    delete from public.turn_plan_grants g where g.id = v_trial.id;
    v_trials := v_trials + 1;
    v_trial_taken := v_trial_taken + v_n;
  end loop;

  select count(*), coalesce(sum(c.plan_remaining), 0), coalesce(sum(c.remaining), 0)
    into v_accounts, v_before_plan, v_before_total
    from public.turn_credits c;
  select coalesce(sum(l.remaining), 0) into v_before_lots
    from public.turn_credit_lots l where l.remaining > 0 and l.expires_at > pg_catalog.now();
  select coalesce(sum(h.held), 0) into v_before_held
    from public.turn_credit_holds h where h.status = 'held';
  select coalesce(sum(g.amount), 0) into v_before_grants from public.turn_plan_grants g;
  -- how many stored numbers are not a multiple of 3 (rounded up below)
  select (select count(*) from public.turn_credits c
           where c.plan_remaining % 3 <> 0 or coalesce(c.plan_allowance, 0) % 3 <> 0)
       + (select count(*) from public.turn_credit_lots l
           where l.amount % 3 <> 0 or l.remaining % 3 <> 0 or l.expired_amount % 3 <> 0 or l.revoked_amount % 3 <> 0)
       + (select count(*) from public.turn_credit_holds h where h.status = 'held' and (h.held % 3 <> 0 or h.from_plan % 3 <> 0))
       + (select count(*) from public.turn_plan_grants g where g.amount % 3 <> 0 or g.revoked_amount % 3 <> 0)
    into v_rounded;

  -- 2. divide by 3, rounding up; lots first (the balance trigger sums them)
  update public.turn_credit_lots l
     set amount = (l.amount + 2) / 3, remaining = (l.remaining + 2) / 3,
         expired_amount = (l.expired_amount + 2) / 3, revoked_amount = (l.revoked_amount + 2) / 3;

  update public.turn_credit_holds h
     set held = (h.held + 2) / 3,
         from_plan = (h.from_plan + 2) / 3,
         from_lots = coalesce((select jsonb_agg(jsonb_build_object('lot', e -> 'lot', 'n', ((e ->> 'n')::integer + 2) / 3) order by t.ord)
                                 from jsonb_array_elements(h.from_lots) with ordinality as t(e, ord)), '[]'::jsonb)
   where h.status = 'held';

  update public.turn_plan_grants g
     set amount = (g.amount + 2) / 3, revoked_amount = (g.revoked_amount + 2) / 3;

  update public.turn_credits c
     set plan_remaining = (c.plan_remaining + 2) / 3,
         plan_allowance = (c.plan_allowance + 2) / 3,
         legacy_tier = null, legacy_allowance = null, legacy_until = null,
         ledger_sync = true;

  select coalesce(sum(c.plan_remaining), 0), coalesce(sum(c.remaining), 0)
    into v_after_plan, v_after_total
    from public.turn_credits c;
  select coalesce(sum(l.remaining), 0) into v_after_lots
    from public.turn_credit_lots l where l.remaining > 0 and l.expires_at > pg_catalog.now();
  select coalesce(sum(h.held), 0) into v_after_held
    from public.turn_credit_holds h where h.status = 'held';
  select coalesce(sum(g.amount), 0) into v_after_grants from public.turn_plan_grants g;
  select count(*) into v_drift
    from public.turn_credits c
   where c.remaining is distinct from c.plan_remaining + public.turn__active_lots(c.owner);
  if v_drift <> 0 or v_after_total * 3 < v_before_total or v_after_plan * 3 < v_before_plan
     or v_after_lots * 3 < v_before_lots then
    raise exception 'Kinolot credit switch undo: the balances do not add up after dividing by 3 (% accounts off). Nothing was changed; contact support.', v_drift;
  end if;

  delete from public.turn_billing_state s where s.key = 'credit_unit_switch';
  insert into public.turn_billing_state(key, value, at) values ('credit_unit_switch_undone', jsonb_build_object(
      'switched_at', v_at, 'switch', v_value, 'accounts', v_accounts,
      'trials_taken_back', v_trials, 'trial_credits_taken_back', v_trial_taken,
      'rounded_up', v_rounded, 'exact', v_rounded = 0,
      'before', jsonb_build_object('plan', v_before_plan, 'lots', v_before_lots, 'total', v_before_total,
                                   'held', v_before_held, 'grants', v_before_grants),
      'after', jsonb_build_object('plan', v_after_plan, 'lots', v_after_lots, 'total', v_after_total,
                                  'held', v_after_held, 'grants', v_after_grants)), pg_catalog.now())
    on conflict (key) do update set value = excluded.value, at = excluded.at;
end;
$undo$;

commit;

-- ── RESULT — the table the SQL Editor shows after Run (after the commit) ───────
with u as (select s.at, s.value from public.turn_billing_state s where s.key = 'credit_unit_switch_undone')
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'Credit switch undone' as item,
           case when not exists (select 1 from public.turn_billing_state s where s.key = 'credit_unit_switch')
                 and exists (select 1 from u) then 'ok' else 'FAIL — contact support' end as status,
           coalesce((select 'undone ' || to_char(at, 'YYYY-MM-DD HH24:MI') || ' UTC (the switch ran '
                            || to_char((value ->> 'switched_at')::timestamptz, 'YYYY-MM-DD HH24:MI') || ' UTC)' from u), 'not undone') as detail
    union all
    select 20, 'Every balance / 3',
           case when exists (select 1 from u) then 'ok' else 'FAIL' end,
           coalesce((select (value ->> 'accounts') || ' accounts: ' || (value #>> '{before,total}') || ' -> '
                            || (value #>> '{after,total}') || ' credits; '
                            || case when (value ->> 'exact')::boolean then 'exact'
                                    else (value ->> 'rounded_up') || ' numbers rounded up (spent or granted since the switch)' end
                       from u), '')
    union all
    select 30, 'Trials granted since the switch taken back',
           case when exists (select 1 from u) then 'ok' else 'FAIL' end,
           coalesce((select (value ->> 'trials_taken_back') || ' accounts, ' || (value ->> 'trial_credits_taken_back')
                            || ' credits; they get the trial again on the real switch day' from u), '')
    union all
    select 40, 'Credit unit back to $0.03, no trial',
           case when (select not switched and usd_per_credit = 0.03 and trial_credits = 0 from public.turn_credit_regime())
                then 'ok' else 'FAIL — contact support' end,
           'turn_credit_regime(); grandfathering cleared'
    union all
    select 50, 'Every balance adds up',
           case when (select count(*) from public.turn_credits c
                       where c.remaining is distinct from c.plan_remaining
                             + coalesce((select sum(l.remaining) from public.turn_credit_lots l
                                          where l.owner = c.owner and l.remaining > 0 and l.expires_at > now()), 0)) = 0
                then 'ok' else 'FAIL — contact support' end,
           'remaining = plan credits + unexpired packs for every account'
    union all
    select 60, 'Next',
           'ok',
           'Mac: redeploy image-proxy and blender-bridge (they cache the unit). Stripe: plan_credits back to 800 / 2,400 / 9,000; new pack links off'
  ) r
 order by r.ord;

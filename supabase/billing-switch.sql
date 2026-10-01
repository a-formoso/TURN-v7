-- ============================================================================
-- Kinolot — the credit switch day (supabase/billing-switch.sql)
-- Owner decision 2026-09-30 (Option A, 30 days' notice). Written 2026-09-30.
-- NOT run on production yet. Run it ONCE, on the switch day, after the 30 days'
-- notice — and before the new Stripe metadata and the pack links go live.
--
-- WHAT IT DOES (exactly once; a marker row makes every later run a no-op)
--   1 credit becomes $0.01 of provider cost instead of $0.03, so every action
--   costs about 3x the credits. So that nobody loses value:
--   * every balance is multiplied by 3: plan credits, pack / grant / carried
--     lots (and their history columns), open holds, and the plan grants a refund
--     is matched against (turn_plan_grants.amount / revoked_amount), so a refund
--     after the switch of a payment made before it removes the tripled credits;
--   * every active subscriber (plan writer / director / studio; the legacy 'pro'
--     counts as Director) keeps the OLD monthly allowance in the new units for
--     renewals until 30 days after the switch: Writer 2,400, Director 7,200,
--     Producer 27,000 (turn_credits.legacy_tier / legacy_allowance /
--     legacy_until). After that date renewals give the Option A allowance:
--     600 / 1,600 / 5,000;
--   * the free trial (50 credits, once per confirmed account) starts now;
--   * turn_credit_regime() now answers usd_per_credit = 0.01;
--   * from now on a cancelled plan's unused plan credits end with it
--     (turn_end_plan_for_sub; before the switch they stay usable).
--   The marker is turn_billing_state 'credit_unit_switch' (with the before /
--   after totals). History (turn_usage_events, turn_spend_events) keeps the old
--   units: split any report at the marker's date.
--
-- SAFETY
--   * It refuses (a FAIL row, nothing changed) until the day-0 deploys are proven:
--     the owner sets the 'server_video_billing' marker immediately before
--     deploying the new image-proxy (supabase/README.md "Billing v2", step 4), and
--     at least one credit hold must have been taken by image-proxy AFTER that
--     marker (only the new image-proxy takes holds, so this proves it is live, not
--     just that the marker line was run). The old image-proxy prices at a fixed
--     $0.03 and lets every trial account use video and the premium engines, so the
--     switch must never run under it.
--   * Inside the transaction it checks that every total is exactly 3x the one
--     before (plan credits, packs, open holds, plan grants, the whole balance);
--     on any mismatch it raises an error and NOTHING is committed.
--   * The whole file is one transaction; while it runs, spends wait for it
--     (table locks), so it finishes in seconds and nothing is lost.
--
-- ORDER ON THE DAY (see supabase/README.md "Billing v2", step 6)
--   1. Stripe, a few minutes BEFORE this file: deactivate the three OLD pack links
--      (300 / 1,200 / 4,000 — on sale until now). Then Developers -> Webhooks -> the
--      Kinolot endpoint: the event deliveries must show nothing pending or failed,
--      so every old pack paid for is already credited (in the old units, tripled
--      below with every other lot). A late old-pack grant after the switch is
--      still tripled, as a safety net: stripe-webhook passes it with legacy_unit
--      and turn_add_pack_once decides the x3 under the account lock, together with
--      the lot, so one granted while this file runs is never missed;
--   2. this file (SQL Editor, as postgres) — every RESULT row must read ok;
--   3. Stripe, right after: set the plan products' plan_credits -> 600 / 1,600 /
--      5,000, and activate the new pack links (pack_credits 250 / 1,000 / 3,000);
--   4. if the new pack links were not pasted into app/plans.jsx CREDIT_PACKS on
--      day 0, paste them now and publish the app.
--   The new image-proxy, blender-bridge and app (deployed on day 0) follow
--   turn_credit_regime() by themselves — no redeploy is needed for the unit: the
--   functions within about 30 seconds; open tabs within about 5 minutes (sooner
--   when someone returns to a tab after a minute away, at once on a reload).
--   Running this file AFTER step 3 would let a renewal in between grant 600 old
--   credits to a subscriber; run it first. New pack links must not go live before
--   this file: a pack bought earlier is multiplied by 3 here.
--
-- PREREQUISITE: supabase/billing-v2.sql has run (it stops otherwise, changing
--   nothing).
--
-- UNDOING IT: supabase/billing-switch-undo.sql is the exact inverse when run soon
--   after (it divides by 3 again, rounding up, and removes the marker). Then
--   redeploy image-proxy and blender-bridge (they cache the unit) and put Stripe's
--   plan_credits back. See the README's "Rollback" section.
-- ============================================================================
begin;

do $preflight$
begin
  if to_regclass('public.turn_billing_state') is null or to_regclass('public.turn_credit_lots') is null
     or to_regclass('public.turn_credit_holds') is null or to_regclass('public.turn_plan_grants') is null
     or to_regprocedure('public.turn__legacy_allowance(text)') is null then
    raise exception 'Kinolot credit switch: run supabase/billing-v2.sql first. Nothing was changed.';
  end if;
end;
$preflight$;

do $preflight2$
begin
  if not exists (select 1 from public.turn_billing_state s where s.key = 'v2_installed') then
    raise exception 'Kinolot credit switch: supabase/billing-v2.sql has not finished (no v2_installed marker). Nothing was changed.';
  end if;
end;
$preflight2$;

-- one switch at a time (a second run waits here, then finds the marker)
lock table public.turn_billing_state in exclusive mode;

do $switch$
declare
  v_until        timestamptz := pg_catalog.now() + interval '30 days';
  v_accounts     integer;
  v_before_plan  bigint; v_before_lots bigint; v_before_total bigint; v_before_held bigint; v_before_grants bigint;
  v_after_plan   bigint; v_after_lots  bigint; v_after_total  bigint; v_after_held  bigint; v_after_grants  bigint;
  v_writer       integer; v_director integer; v_studio integer;
begin
  -- what this run did, for the RESULT table after commit (a session setting: kept
  -- by a commit, undone by a rollback)
  perform pg_catalog.set_config('kinolot.switch_run', 'already', false);
  if exists (select 1 from public.turn_billing_state s where s.key = 'credit_unit_switch') then
    return;
  end if;
  if not exists (select 1 from public.turn_billing_state s where s.key = 'server_video_billing') then
    perform pg_catalog.set_config('kinolot.switch_run', 'blocked', false);
    return;
  end if;
  -- proof the new image-proxy is live: it has taken at least one hold since the marker
  -- (its refs are 'text:' / 'image:' / 'voice:' / 'video:'; blender-bridge's are 'studio:')
  if not exists (select 1 from public.turn_credit_holds h
                  where h.ref not like 'studio:%'
                    and h.created_at > (select s.at from public.turn_billing_state s where s.key = 'server_video_billing')) then
    perform pg_catalog.set_config('kinolot.switch_run', 'no_holds', false);
    return;
  end if;

  -- nobody spends or tops up while balances are rewritten (reads still work)
  lock table public.turn_credits, public.turn_credit_lots, public.turn_credit_holds, public.turn_plan_grants
    in share row exclusive mode;

  -- settle expired lots first, so the totals below are exact
  perform public.turn_expire_lots();

  select count(*), coalesce(sum(c.plan_remaining), 0), coalesce(sum(c.remaining), 0)
    into v_accounts, v_before_plan, v_before_total
    from public.turn_credits c;
  select coalesce(sum(l.remaining), 0) into v_before_lots
    from public.turn_credit_lots l where l.remaining > 0 and l.expires_at > pg_catalog.now();
  select coalesce(sum(h.held), 0) into v_before_held
    from public.turn_credit_holds h where h.status = 'held';
  select coalesce(sum(g.amount), 0) into v_before_grants from public.turn_plan_grants g;

  -- lots first (the balance trigger sums them when the accounts are rewritten)
  update public.turn_credit_lots l
     set amount = l.amount * 3, remaining = l.remaining * 3,
         expired_amount = l.expired_amount * 3, revoked_amount = l.revoked_amount * 3;

  -- open holds: a release after the switch gives back new-unit credits
  update public.turn_credit_holds h
     set held = h.held * 3,
         from_plan = h.from_plan * 3,
         from_lots = coalesce((select jsonb_agg(jsonb_build_object('lot', e -> 'lot', 'n', (e ->> 'n')::integer * 3) order by t.ord)
                                 from jsonb_array_elements(h.from_lots) with ordinality as t(e, ord)), '[]'::jsonb)
   where h.status = 'held';

  -- plan grants: a refund matches them (turn_revoke_charge_once removes up to amount)
  update public.turn_plan_grants g
     set amount = g.amount * 3, revoked_amount = g.revoked_amount * 3;

  -- plan credits and allowances; remaining is recomputed by the trigger
  update public.turn_credits c
     set plan_remaining = c.plan_remaining * 3,
         plan_allowance = c.plan_allowance * 3,
         ledger_sync = true;

  -- grandfathering: the old allowance in the new units, for 30 days ('pro' = Director)
  update public.turn_credits c
     set legacy_tier = case lower(trim(c.plan)) when 'pro' then 'director' else lower(trim(c.plan)) end,
         legacy_allowance = public.turn__legacy_allowance(c.plan),
         legacy_until = v_until
   where public.turn__paid_tier(c.plan);

  select coalesce(sum(c.plan_remaining), 0), coalesce(sum(c.remaining), 0)
    into v_after_plan, v_after_total
    from public.turn_credits c;
  select coalesce(sum(l.remaining), 0) into v_after_lots
    from public.turn_credit_lots l where l.remaining > 0 and l.expires_at > pg_catalog.now();
  select coalesce(sum(h.held), 0) into v_after_held
    from public.turn_credit_holds h where h.status = 'held';
  select coalesce(sum(g.amount), 0) into v_after_grants from public.turn_plan_grants g;
  select count(*) filter (where c.legacy_tier = 'writer'),
         count(*) filter (where c.legacy_tier = 'director'),
         count(*) filter (where c.legacy_tier = 'studio')
    into v_writer, v_director, v_studio
    from public.turn_credits c where c.legacy_until = v_until;

  -- every total exactly x3, or nothing is committed
  if v_after_total <> 3 * v_before_total or v_after_plan <> 3 * v_before_plan
     or v_after_lots <> 3 * v_before_lots or v_after_held <> 3 * v_before_held
     or v_after_grants <> 3 * v_before_grants then
    raise exception 'Kinolot credit switch: the totals are not exactly x3 (balance % -> %, plan % -> %, packs % -> %, holds % -> %, grants % -> %). Nothing was changed; contact support before trying again.',
      v_before_total, v_after_total, v_before_plan, v_after_plan, v_before_lots, v_after_lots,
      v_before_held, v_after_held, v_before_grants, v_after_grants;
  end if;

  insert into public.turn_billing_state(key, value) values ('credit_unit_switch', jsonb_build_object(
    'multiplier', 3, 'usd_per_credit_before', 0.03, 'usd_per_credit_after', 0.01,
    'legacy_until', v_until,
    'accounts', v_accounts,
    'before', jsonb_build_object('plan', v_before_plan, 'lots', v_before_lots, 'total', v_before_total,
                                 'held', v_before_held, 'grants', v_before_grants),
    'after', jsonb_build_object('plan', v_after_plan, 'lots', v_after_lots, 'total', v_after_total,
                                'held', v_after_held, 'grants', v_after_grants),
    'grandfathered', jsonb_build_object('writer', v_writer, 'director', v_director, 'studio', v_studio)));
  perform pg_catalog.set_config('kinolot.switch_run', 'switched', false);
end;
$switch$;

commit;

-- ── RESULT — the table the SQL Editor shows after Run (after the commit: it reads
-- the committed marker 'credit_unit_switch', which keeps the before / after totals)
with sw as (select s.at, s.value from public.turn_billing_state s where s.key = 'credit_unit_switch'),
     run as (select coalesce(nullif(current_setting('kinolot.switch_run', true), ''), 'unknown') as r),
     tot as (select (sw.value -> 'before') as b, (sw.value -> 'after') as a from sw),
     x3 as (select k, (select (tot.b ->> k)::bigint from tot) as b, (select (tot.a ->> k)::bigint from tot) as a
              from unnest(array['total', 'plan', 'lots', 'held', 'grants']) k),
     chk as (select k, b, a, (b is not null and a = 3 * b) as good,
                    case when b is null then 'not switched'
                         when (select r from run) = 'switched' then b::text || ' -> ' || a::text
                         when (select r from run) = 'already'
                           then 'unchanged by this run (switch: ' || b::text || ' -> ' || a::text || ')'
                         else 'switch: ' || b::text || ' -> ' || a::text end as detail
               from x3)
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'Credit switch' as item,
           case when exists (select 1 from sw) then 'ok'
                when (select r from run) = 'blocked'
                  then 'FAIL — nothing changed: the server_video_billing marker is missing, so the day-0 deploys (new image-proxy and blender-bridge) are not confirmed'
                when (select r from run) = 'no_holds'
                  then 'FAIL — nothing changed: image-proxy has taken no credit hold since the server_video_billing marker, so the new image-proxy is not confirmed live'
                else 'FAIL — not switched: re-run the whole file' end as status,
           case when (select r from run) = 'switched' then 'switched NOW: 1 credit = $0.01 of provider cost'
                when exists (select 1 from sw)
                  then case when (select r from run) = 'already' then 'already switched on ' else 'switched on ' end
                       || (select to_char(sw.at, 'YYYY-MM-DD HH24:MI') from sw) || ' UTC'
                       || case when (select r from run) = 'already' then ' — this run changed nothing' else '' end
                when (select r from run) = 'blocked'
                  then 'Do the day-0 deploys first (README "Billing v2" step 4: the marker is inserted immediately before deploying image-proxy), then run this file again'
                when (select r from run) = 'no_holds'
                  then 'Deploy image-proxy (README "Billing v2" step 4d) and check it is live: any paid generation takes a hold (select count(*) from public.turn_credit_holds;). Then run this file again'
                else '1 credit = $0.03 still' end as detail
    union all
    select 20, 'Every balance x3',
           case when (select good from chk where k = 'total') then 'ok' else 'FAIL — not switched' end,
           (select case when detail = 'not switched' then detail
                        else coalesce((select (value ->> 'accounts') from sw), '0') || ' accounts: ' || detail || ' credits' end
              from chk where k = 'total')
    union all
    select 30, 'Plan credits x3',
           case when (select good from chk where k = 'plan') then 'ok' else 'FAIL — not switched' end,
           (select detail from chk where k = 'plan')
    union all
    select 40, 'Pack credits x3 (expiry unchanged)',
           case when (select good from chk where k = 'lots') then 'ok' else 'FAIL — not switched' end,
           (select detail from chk where k = 'lots')
    union all
    select 50, 'Open holds and plan grants x3',
           case when (select good from chk where k = 'held') and (select good from chk where k = 'grants') then 'ok'
                else 'FAIL — not switched' end,
           'holds ' || (select detail from chk where k = 'held') || '; grants ' || (select detail from chk where k = 'grants')
    union all
    select 60, 'Subscribers keep their old allowance for 30 days',
           case when exists (select 1 from sw) then 'ok' else 'FAIL — not switched' end,
           coalesce((select 'Writer ' || (value #>> '{grandfathered,writer}') || ' (2,400), Director '
                            || (value #>> '{grandfathered,director}') || ' (7,200), Producer '
                            || (value #>> '{grandfathered,studio}') || ' (27,000) until '
                            || to_char((value ->> 'legacy_until')::timestamptz, 'YYYY-MM-DD') || '; then 600 / 1,600 / 5,000'
                       from sw), 'not switched')
    union all
    select 70, 'Every balance adds up',
           case when (select count(*) from public.turn_credits c
                       where c.remaining is distinct from c.plan_remaining
                             + coalesce((select sum(l.remaining) from public.turn_credit_lots l
                                          where l.owner = c.owner and l.remaining > 0 and l.expires_at > now()), 0)) = 0
                then 'ok' else 'FAIL — contact support before going on' end,
           'remaining = plan credits + unexpired packs for every account'
    union all
    select 80, 'Free trial',
           case when (select trial_credits from public.turn_credit_regime()) = 50 then 'ok' else 'FAIL — not switched' end,
           '50 credits once per confirmed account, on its next balance read'
    union all
    select 90, 'Next',
           case when exists (select 1 from sw) then 'ok' else 'FAIL — fix the first row' end,
           case when exists (select 1 from sw)
                then 'Stripe: plan_credits 600 / 1,600 / 5,000, activate the new packs (250 / 1,000 / 3,000); the old packs (300 / 1,200 / 4,000) must already be off'
                else 'nothing was changed; fix the first row, then run this file again' end
  ) r
 order by r.ord;

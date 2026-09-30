-- ============================================================================
-- Kinolot — lock the credit and plan functions (supabase/lock-credit-functions.sql)
-- Owner: platform admin · 2026-09-29. Safe to run any number of times.
--
-- WHY
--   turn_grant_credits, turn_set_plan, turn_add_pack, turn_apply_pack_once and
--   turn_end_plan run with owner rights (SECURITY DEFINER), so whoever can call
--   them can set any account's plan and credits. credits.sql never revoked them,
--   and Postgres lets every role execute a new function by default — so a
--   signed-in user (or the public anon key) could call them through the API.
--   Only the Stripe webhook (service role) and the SQL Editor (postgres) need
--   them. This file removes access for everyone else and keeps both of those.
--   Nothing in the app calls these functions: the browser uses turn_spend_credit,
--   turn_credit_balance and turn_record_usage_event, which are untouched.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this WHOLE file → Run.
--   The table at the end has one row per function: "was open" says whether the
--   API roles could call it BEFORE this run; "locked now" must read ok.
-- ============================================================================
begin;

create temporary table _kinolot_lock_before on commit drop as
select p.oid, p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon_before,
       has_function_privilege('authenticated', p.oid, 'execute') as authed_before
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('turn_grant_credits','turn_set_plan','turn_add_pack','turn_apply_pack_once','turn_end_plan');

do $lock$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('turn_grant_credits','turn_set_plan','turn_add_pack','turn_apply_pack_once','turn_end_plan')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$lock$;

select b.proname as function,
       case when b.anon_before or b.authed_before
            then 'YES — was callable by ' || concat_ws(' and ',
                   case when b.anon_before then 'anyone (anon key)' end,
                   case when b.authed_before then 'signed-in users' end)
            else 'no' end as was_open,
       case when not has_function_privilege('anon', b.oid, 'execute')
             and not has_function_privilege('authenticated', b.oid, 'execute')
             and has_function_privilege('service_role', b.oid, 'execute')
            then 'ok' else 'FAIL — re-run the whole file' end as locked_now
  from _kinolot_lock_before b
 order by b.proname;

commit;

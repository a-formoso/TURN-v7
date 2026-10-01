-- ============================================================================
-- Kinolot — billing housekeeping schedule (supabase/billing-housekeeping-cron.sql)
-- Written 2026-09-30. NOT run on production yet. REQUIRED on day 0: run it right
-- after supabase/billing-v2.sql, before the new image-proxy / blender-bridge are
-- deployed (supabase/README.md "Billing v2", step 2).
--
-- WHY IT IS REQUIRED
--   The new image-proxy and blender-bridge HOLD a job's credits before the provider
--   runs and settle or release them when it ends. If the worker is killed first (the
--   platform's time or memory limit, a redeploy), its own release never runs; and a
--   video or 3D job whose tab was closed is never polled again. This schedule makes
--   sure both end fairly:
--   * every 10 minutes: turn_release_stale_holds(30) — a hold with no provider job
--     (writing, images, voice, or a video / 3D submit that never started) still open
--     after 30 minutes is released. A hold for a SUBMITTED provider job (it carries
--     the provider's job id) is left to the reconciliation below; only if it is still
--     open after 30 days (the provider never answered) is it settled at the held
--     amount, as a last resort.
--   * every 10 minutes: RECONCILIATION — pg_net posts {"op":"reconcile_holds"} to
--     image-proxy (video renders) and to blender-bridge (3D jobs). Each asks the
--     provider about the open jobs nobody polled for an hour: a job that FINISHED is
--     charged exactly as the app's poll would have charged it (a render billed by its
--     length, at the output's real length); a job that FAILED, was cancelled or is
--     unknown to the provider is REFUNDED in full; a job still running is left for the
--     next round. So a render whose tab was closed is charged only if it really
--     finished. The calls need no key (both functions are deployed --no-verify-jwt;
--     the op is idempotent, harmless if anyone calls it, and throttled to one run
--     every 4 minutes per function by turn_claim_housekeeping).
--   * daily: turn_expire_lots() — zeroes expired pack lots, so idle accounts' stored
--     totals stay exact (every balance read does this per account anyway).
--   Before the new functions are deployed, the two reconcile calls just get a
--   refusal from the old code (it asks for a signed-in user): harmless.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste this whole file
--   -> Run, as postgres. Safe to re-run: each job is unscheduled by name and
--   scheduled again. The RESULT lists pg_net and the four jobs; every row must read ok.
--   pg_cron runs the jobs as postgres (no API role), which the billing functions allow.
-- TO STOP: select cron.unschedule(jobid) from cron.job
--           where jobname in ('kinolot-release-stale-holds', 'kinolot-expire-lots',
--                             'kinolot-reconcile-video-holds', 'kinolot-reconcile-studio-holds');
-- HISTORY: select j.jobname, d.status, d.return_message, d.start_time
--            from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--           where j.jobname like 'kinolot-%' order by d.start_time desc limit 20;
--   What the reconcile calls answered ({ok, checked, settled, released, left}):
--          select id, status_code, content, created from net._http_response
--           order by created desc limit 20;
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- re-run safe: drop the jobs by name first (no error when they don't exist yet)
select cron.unschedule(j.jobid)
  from cron.job j
 where j.jobname in ('kinolot-release-stale-holds', 'kinolot-expire-lots',
                     'kinolot-reconcile-video-holds', 'kinolot-reconcile-studio-holds');

select cron.schedule('kinolot-release-stale-holds', '*/10 * * * *',
                     $job$select public.turn_release_stale_holds(30)$job$);
select cron.schedule('kinolot-expire-lots', '23 3 * * *',
                     $job$select public.turn_expire_lots()$job$);
-- reconciliation every 10 minutes, at :02 / :07 past each ten so the two calls and the
-- release above don't start together
select cron.schedule('kinolot-reconcile-video-holds', '2,12,22,32,42,52 * * * *',
                     $job$select net.http_post(
                        url := 'https://vubenblfdzginlqiglzw.supabase.co/functions/v1/image-proxy',
                        body := '{"op":"reconcile_holds"}'::jsonb,
                        headers := '{"Content-Type":"application/json"}'::jsonb,
                        timeout_milliseconds := 120000)$job$);
select cron.schedule('kinolot-reconcile-studio-holds', '7,17,27,37,47,57 * * * *',
                     $job$select net.http_post(
                        url := 'https://vubenblfdzginlqiglzw.supabase.co/functions/v1/blender-bridge',
                        body := '{"op":"reconcile_holds"}'::jsonb,
                        headers := '{"Content-Type":"application/json"}'::jsonb,
                        timeout_milliseconds := 120000)$job$);

-- ── RESULT ──────────────────────────────────────────────────────────────────
with want(ord, jobname, what) as (values
    (20, 'kinolot-release-stale-holds',    'every 10 minutes: holds with no provider job, open 30+ minutes, are given back'),
    (30, 'kinolot-reconcile-video-holds',  'every 10 minutes: image-proxy settles finished renders nobody collected, refunds failed ones'),
    (40, 'kinolot-reconcile-studio-holds', 'every 10 minutes: blender-bridge does the same for 3D jobs'),
    (50, 'kinolot-expire-lots',            'daily: expired pack credits are cleared'))
select r.item, r.status, r.detail
  from (
    select 10 as ord, 'pg_net (sends the reconcile calls)' as item,
           case when to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is not null then 'ok'
                else 'FAIL — pg_net is missing: Database -> Extensions -> enable pg_net, then run this file again' end as status,
           'net.http_post' as detail
    union all
    select w.ord, w.jobname,
           case when j.jobid is null then 'FAIL — the job is missing: run this file again'
                when not j.active then 'FAIL — the job is not active'
                else 'ok' end,
           w.what || coalesce(' (' || j.schedule || ')', '')
      from want w left join cron.job j on j.jobname = w.jobname
  ) r
 order by r.ord;

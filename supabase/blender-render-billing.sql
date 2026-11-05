-- BUILD THE SET FOR PAYING PLANS (owner 2026-11-05): the Locations cloud set build ("4 · Build the set") opens to
-- Director and Producer. Run AFTER blender-render-jobs.sql, billing-v2.sql and team-relaunch.sql. Additive: the
-- pilot's table gains two columns; its functions keep working (the old 7-argument submit stays for an older
-- blender-render); no billing function is changed.
--
-- One build = 15 credits (blender-render/core.mjs SET_BUILD_USD = $0.15 at the live unit; app/pricing.jsx
-- turnSetBuildCredits). The function HOLDS them before queueing (ref 'setbuild:<request id>', on the owner's balance
-- within an Art director's budget on a shared film — blender-bridge supabase-adapter authorizeCredit), and this
-- file ties the hold to the job:
--   * the submit records the hold on the job and attaches 'setbuild-job:<job id>' as its provider_ref, so the
--     30-minute stale-hold release never gives back a build that is still waiting its turn;
--   * a trigger SETTLES the hold when the job completes (the four views were saved) and RELEASES it when the job
--     fails or is cancelled — whichever path changed the status (the worker, a cancel, a lease that ran out twice);
--   * turn_expire_blender_render_jobs() fails a build the renderer never reached (queued 2 hours) or that stopped
--     with nobody to pick it up (lease gone 30 minutes) — its credits come back — every 10 minutes (pg_cron below)
--     and on every submit;
--   * one renderer builds one set at a time, so the whole queue is capped at 12 (about 45 minutes); a 13th
--     request is refused ('queue_busy') and the function gives its hold back. Per account: 3 waiting, 30 a day.
-- The image-proxy and blender-bridge reconcilers list only 'video:' / 'studio:' holds, so they never touch these.

alter table public.turn_blender_render_jobs add column if not exists hold_ref text;
alter table public.turn_blender_render_jobs add column if not exists credits integer;
create unique index if not exists turn_blender_render_hold on public.turn_blender_render_jobs(hold_ref) where hold_ref is not null;

create or replace function public.turn_expire_blender_render_jobs()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  update public.turn_blender_render_jobs
     set status='failed',progress='failed',
         error='The renderer didn''t get to this build in time, so nothing was charged. Build the set again.',
         lease_hash=null,lease_expires_at=null,updated_at=now()
   where (status='queued' and created_at<now()-interval '2 hours')
      or (status='running' and lease_expires_at<now()-interval '30 minutes');
  get diagnostics n=row_count;
  return n;
end $$;

create or replace function public.turn_submit_blender_render_job(
  p_project uuid,p_owner uuid,p_actor uuid,p_location text,p_request uuid,p_scene jsonb,p_hash text,p_hold text
) returns public.turn_blender_render_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.turn_blender_render_jobs; v_held integer;
begin
  perform pg_advisory_xact_lock(711031);
  perform public.turn_expire_blender_render_jobs();
  select * into j from public.turn_blender_render_jobs where actor_id=p_actor and request_id=p_request;
  if found then
    if j.project_id<>p_project or j.location_id<>p_location or j.scene_hash<>p_hash then raise exception 'request_conflict';end if;
    return j;
  end if;
  if (select count(*) from public.turn_blender_render_jobs where status in ('queued','running'))>=12 then raise exception 'queue_busy';end if;
  if (select count(*) from public.turn_blender_render_jobs where actor_id=p_actor and status in ('queued','running'))>=3 then raise exception 'queue_full';end if;
  if (select count(*) from public.turn_blender_render_jobs where actor_id=p_actor and created_at>now()-interval '1 day')>=30 then raise exception 'daily_limit';end if;
  if p_hold is not null then
    select h.held into v_held from public.turn_credit_holds h where h.ref=p_hold and h.status='held';
    if not found then raise exception 'hold_missing';end if;
  end if;
  insert into public.turn_blender_render_jobs(project_id,owner_id,actor_id,location_id,request_id,scene,scene_hash,hold_ref,credits)
    values(p_project,p_owner,p_actor,p_location,p_request,p_scene,p_hash,p_hold,v_held) returning * into j;
  if p_hold is not null then
    update public.turn_credit_holds set provider_ref='setbuild-job:'||j.id where ref=p_hold and provider_ref is null;
  end if;
  return j;
end $$;

-- the hold follows the job: completed → charged (the held amount, never more); failed / cancelled → given back
create or replace function public.turn__blender_render_job_billing()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.hold_ref is null or new.status is not distinct from old.status then return new;end if;
  if new.status='completed' then
    perform public.turn__finish_hold(new.hold_ref,(select h.held from public.turn_credit_holds h where h.ref=new.hold_ref));
  elsif new.status in ('failed','cancelled') then
    perform public.turn__finish_hold(new.hold_ref,null);
  end if;
  return new;
end $$;
drop trigger if exists turn_blender_render_job_billing on public.turn_blender_render_jobs;
create trigger turn_blender_render_job_billing after update of status on public.turn_blender_render_jobs
  for each row execute function public.turn__blender_render_job_billing();

revoke all on function public.turn_expire_blender_render_jobs() from public,anon,authenticated;
revoke all on function public.turn_submit_blender_render_job(uuid,uuid,uuid,text,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.turn__blender_render_job_billing() from public,anon,authenticated;
grant execute on function public.turn_expire_blender_render_jobs() to service_role;
grant execute on function public.turn_submit_blender_render_job(uuid,uuid,uuid,text,uuid,jsonb,text,text) to service_role;

create extension if not exists pg_cron;
select cron.unschedule(j.jobid) from cron.job j where j.jobname='kinolot-expire-set-builds';
select cron.schedule('kinolot-expire-set-builds','4,14,24,34,44,54 * * * *',$job$select public.turn_expire_blender_render_jobs()$job$);

-- check: what this file installed
select 'hold_ref / credits columns' as item,
       case when (select count(*) from information_schema.columns where table_schema='public'
                    and table_name='turn_blender_render_jobs' and column_name in ('hold_ref','credits'))=2 then 'ok' else 'FAIL' end as status
union all
select 'billing trigger', case when exists(select 1 from pg_trigger where tgname='turn_blender_render_job_billing') then 'ok' else 'FAIL' end
union all
select 'submit with a hold', case when to_regprocedure('public.turn_submit_blender_render_job(uuid,uuid,uuid,text,uuid,jsonb,text,text)') is not null then 'ok' else 'FAIL' end
union all
select 'expiry every 10 minutes', case when exists(select 1 from cron.job where jobname='kinolot-expire-set-builds' and active) then 'ok' else 'FAIL' end;

-- Cloud set preview pilot. Apply to a staging project first. No existing table is changed.
-- All access goes through the authenticated service; browser roles cannot call worker RPCs.
create table if not exists public.turn_blender_render_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null,
  actor_id uuid not null,
  location_id text not null check(length(location_id) between 1 and 160),
  request_id uuid not null,
  scene jsonb not null check(pg_column_size(scene) <= 262144),
  scene_hash text not null check(scene_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  progress text not null default 'queued',
  attempts integer not null default 0,
  lease_hash text,
  lease_expires_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
alter table public.turn_blender_render_jobs enable row level security;
revoke all on public.turn_blender_render_jobs from public, anon, authenticated;
grant select,insert,update,delete on public.turn_blender_render_jobs to service_role;
create index if not exists turn_blender_render_queue on public.turn_blender_render_jobs(status,created_at);
create index if not exists turn_blender_render_location on public.turn_blender_render_jobs(project_id,location_id,created_at desc);

create or replace function public.turn_submit_blender_render_job(
  p_project uuid,p_owner uuid,p_actor uuid,p_location text,p_request uuid,p_scene jsonb,p_hash text
) returns public.turn_blender_render_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.turn_blender_render_jobs;
begin
  perform pg_advisory_xact_lock(711031);
  select * into j from public.turn_blender_render_jobs where actor_id=p_actor and request_id=p_request;
  if found then
    if j.project_id<>p_project or j.location_id<>p_location or j.scene_hash<>p_hash then raise exception 'request_conflict';end if;
    return j;
  end if;
  if (select count(*) from public.turn_blender_render_jobs where actor_id=p_actor and status in ('queued','running'))>=3 then raise exception 'queue_full';end if;
  if (select count(*) from public.turn_blender_render_jobs where actor_id=p_actor and created_at>now()-interval '1 day')>=30 then raise exception 'daily_limit';end if;
  insert into public.turn_blender_render_jobs(project_id,owner_id,actor_id,location_id,request_id,scene,scene_hash)
    values(p_project,p_owner,p_actor,p_location,p_request,p_scene,p_hash) returning * into j;
  return j;
end $$;

create or replace function public.turn_claim_blender_render_job(p_hash text)
returns public.turn_blender_render_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.turn_blender_render_jobs;
begin
  if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_lease';end if;
  perform pg_advisory_xact_lock(711031);
  update public.turn_blender_render_jobs set status=case when attempts<2 then 'queued' else 'failed' end,
    progress=case when attempts<2 then 'queued' else 'failed' end,
    error=case when attempts<2 then null else 'The render stopped twice. Submit a new request to try again.' end,
    lease_hash=null,lease_expires_at=null,updated_at=now()
    where status='running' and lease_expires_at<now();
  select * into j from public.turn_blender_render_jobs where status='running' limit 1;
  if found then
    if j.lease_hash=p_hash then return j;end if;
    return null;
  end if;
  select * into j from public.turn_blender_render_jobs where status='queued' order by created_at,id limit 1 for update skip locked;
  if not found then return null;end if;
  update public.turn_blender_render_jobs set status='running',progress='rendering',attempts=attempts+1,
    lease_hash=p_hash,lease_expires_at=now()+interval '2 minutes',updated_at=now() where id=j.id returning * into j;
  return j;
end $$;

create or replace function public.turn_touch_blender_render_job(p_job uuid,p_hash text,p_progress text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_progress not in ('rendering','uploading') then return false;end if;
  update public.turn_blender_render_jobs set progress=p_progress,lease_expires_at=now()+interval '2 minutes',updated_at=now()
    where id=p_job and status='running' and lease_hash=p_hash and lease_expires_at>now();
  return found;
end $$;

create or replace function public.turn_finish_blender_render_job(p_job uuid,p_hash text,p_status text,p_result jsonb,p_error text)
returns public.turn_blender_render_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.turn_blender_render_jobs;
begin
  if p_status not in ('completed','failed') then raise exception 'invalid_status';end if;
  select * into j from public.turn_blender_render_jobs where id=p_job for update;
  if not found or j.lease_hash is distinct from p_hash then raise exception 'lease_expired';end if;
  if j.status=p_status and j.result is not distinct from p_result then return j;end if;
  if j.status<>'running' or j.lease_expires_at<=now() then raise exception 'lease_expired';end if;
  update public.turn_blender_render_jobs set status=p_status,progress=p_status,result=p_result,error=left(p_error,300),
    lease_expires_at=null,updated_at=now() where id=p_job returning * into j;
  return j;
end $$;

revoke all on function public.turn_submit_blender_render_job(uuid,uuid,uuid,text,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.turn_claim_blender_render_job(text) from public,anon,authenticated;
revoke all on function public.turn_touch_blender_render_job(uuid,text,text) from public,anon,authenticated;
revoke all on function public.turn_finish_blender_render_job(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.turn_submit_blender_render_job(uuid,uuid,uuid,text,uuid,jsonb,text) to service_role;
grant execute on function public.turn_claim_blender_render_job(text) to service_role;
grant execute on function public.turn_touch_blender_render_job(uuid,text,text) to service_role;
grant execute on function public.turn_finish_blender_render_job(uuid,text,text,jsonb,text) to service_role;

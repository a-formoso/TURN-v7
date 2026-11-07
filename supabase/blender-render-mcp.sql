-- Compatible queue claims for the versioned detailed renderer. Apply after jobs and scene storage.
-- Keep one active build globally, including while basic and detailed workers coexist during rollout.
begin;
create or replace function public.turn_claim_blender_render_job_v2(p_hash text,p_schemas text[],p_store_scene boolean)
returns public.turn_blender_render_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.turn_blender_render_jobs;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_lease';end if;
  if p_schemas is null or cardinality(p_schemas) not between 1 and 2 or array_position(p_schemas,null) is not null
    or not p_schemas <@ array['kinolot-blockout-test-v1','kinolot-cloud-set-v2']::text[] then raise exception 'invalid_scene_schemas';end if;
  perform pg_advisory_xact_lock(711031);
  update public.turn_blender_render_jobs set status=case when attempts<2 then 'queued' else 'failed' end,
    progress=case when attempts<2 then 'queued' else 'failed' end,
    error=case when attempts<2 then null else 'The render stopped twice. Submit a new request to try again.' end,
    lease_hash=null,lease_expires_at=null,updated_at=now()
    where status='running' and lease_expires_at<now();
  select * into j from public.turn_blender_render_jobs where status='running' limit 1;
  if found then
    if j.lease_hash=p_hash and j.scene->>'schema'=any(p_schemas) then return j;end if;
    return null;
  end if;
  select * into j from public.turn_blender_render_jobs
    where status='queued' and scene->>'schema'=any(p_schemas)
    order by created_at,id limit 1 for update skip locked;
  if not found then return null;end if;
  update public.turn_blender_render_jobs set status='running',progress='rendering',attempts=attempts+1,
    lease_hash=p_hash,lease_expires_at=now()+interval '2 minutes',updated_at=now(),
    result=case when coalesce(p_store_scene,false) or scene->>'schema'='kinolot-cloud-set-v2'
      then coalesce(result,'{}'::jsonb)||jsonb_build_object('sceneRequired',true)
      else nullif(coalesce(result,'{}'::jsonb)-'sceneRequired','{}'::jsonb) end
    where id=j.id returning * into j;
  return j;
end $$;

-- Even an older deployed edge function can never hand a version-2 job to the basic worker.
create or replace function public.turn_claim_blender_render_job(p_hash text)
returns public.turn_blender_render_jobs language sql security definer set search_path=public,pg_temp as $$
  select public.turn_claim_blender_render_job_v2(p_hash,array['kinolot-blockout-test-v1']::text[],false);
$$;
revoke all on function public.turn_claim_blender_render_job_v2(text,text[],boolean) from public,anon,authenticated;
revoke all on function public.turn_claim_blender_render_job(text) from public,anon,authenticated;
grant execute on function public.turn_claim_blender_render_job_v2(text,text[],boolean) to service_role;
grant execute on function public.turn_claim_blender_render_job(text) to service_role;
commit;

-- Retain editable scenes in the same private bucket as camera outputs.
-- Run after blender-render-jobs.sql. No customer grants or billing changes.
create or replace function public.turn_stage_blender_render_scene(p_job uuid,p_hash text,p_scene jsonb)
returns public.turn_blender_render_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.turn_blender_render_jobs;
begin
  if jsonb_typeof(p_scene) is distinct from 'object'
     or p_scene->>'leaseHash' is distinct from p_hash
     or coalesce(p_scene->>'sha256','') !~ '^[a-f0-9]{64}$'
     or not coalesce((p_scene->>'bytes')::bigint between 64 and 33554432,false)
     or (p_scene-array['path','sha256','bytes','sourceSceneHash','leaseHash'])<>'{}'::jsonb then
    raise exception 'invalid_scene_artifact';
  end if;
  select * into j from public.turn_blender_render_jobs where id=p_job for update;
  if not found or j.lease_hash is distinct from p_hash then raise exception 'lease_expired';end if;
  if p_scene->>'sourceSceneHash' is distinct from j.scene_hash then raise exception 'invalid_scene_artifact';end if;
  if p_scene->>'path' is distinct from ('_internal/blender-renders/'||j.owner_id::text||'/'||j.project_id::text||'/'||j.id::text||'/'||p_hash||'/'||(p_scene->>'sha256')||'-set.blend') then raise exception 'invalid_scene_artifact';end if;
  if j.status='completed' and j.result->'scene'=p_scene then return j;end if;
  if j.status<>'running' or j.lease_expires_at<=now() then raise exception 'lease_expired';end if;
  if j.result->'scene'->>'leaseHash'=p_hash and j.result->'scene' is distinct from p_scene then
    raise exception 'scene_conflict';
  end if;
  update public.turn_blender_render_jobs
    set result=coalesce(result,'{}'::jsonb)||jsonb_build_object('scene',p_scene),updated_at=now()
    where id=p_job returning * into j;
  return j;
end $$;
revoke all on function public.turn_stage_blender_render_scene(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.turn_stage_blender_render_scene(uuid,text,jsonb) to service_role;

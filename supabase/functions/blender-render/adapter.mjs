import {RenderError} from "./core.mjs";
function row(value){const out=Array.isArray(value)?value[0]||null:value||null;return out&&typeof out==="object"&&"id" in out&&!out.id?null:out;}
export function createRenderDatabase(admin){
  async function rpc(name,args){
    const r=await admin.rpc(name,args);
    if(r.error){
      const message=String(r.error.message||"");
      if(/request_conflict/.test(message))throw new RenderError(409,"request_conflict","This request identity already belongs to another set revision.");
      if(/queue_busy/.test(message))throw new RenderError(429,"queue_busy","Many sets are being built right now. Try again in a few minutes — nothing was charged.");
      if(/queue_full/.test(message))throw new RenderError(429,"render_limit","You have three builds waiting already. Wait for one to finish — nothing was charged.");
      if(/daily_limit/.test(message))throw new RenderError(429,"render_limit","That's 30 builds today, the daily limit. Try again tomorrow — nothing was charged.");
      if(/hold_missing/.test(message))throw new RenderError(503,"billing_unavailable","Credits can't be checked right now. Please try again in a minute.");
      if(/lease_expired/.test(message))throw new RenderError(409,"lease_expired","This render lease expired.");
      if(/scene_conflict/.test(message))throw new RenderError(409,"scene_conflict","A different scene file was already saved for this build.");
      throw new Error("Render database unavailable");
    }
    return row(r.data);
  }
  async function one(query){const r=await query.maybeSingle();if(r.error)throw new Error("Render database unavailable");return r.data||null;}
  return {
    // with a hold (Build the set for paying plans, blender-render-billing.sql) the 8-argument submit; the pilot's own
    // 7-argument one otherwise, so the pilot keeps working on a database without that file
    submit:a=>rpc("turn_submit_blender_render_job",{p_project:a.project,p_owner:a.owner,p_actor:a.actor,p_location:a.location,p_request:a.request,p_scene:a.scene,p_hash:a.hash,
      ...(a.hold?{p_hold:a.hold}:{})}),
    byRequest:(actor,request)=>one(admin.from("turn_blender_render_jobs").select("*").eq("actor_id",actor).eq("request_id",request)),
    async activeCount(){
      const r=await admin.from("turn_blender_render_jobs").select("id",{count:"exact",head:true}).in("status",["queued","running"]);
      if(r.error)throw new Error("Render database unavailable");return r.count||0;
    },
    // builds ahead of a waiting one: the one rendering, and those queued before it
    async ahead(row){
      const r=await admin.from("turn_blender_render_jobs").select("id",{count:"exact",head:true})
        .or(`status.eq.running,and(status.eq.queued,created_at.lt."${row.created_at}")`);
      if(r.error)throw new Error("Render database unavailable");return r.count||0;
    },
    claim:hash=>rpc("turn_claim_blender_render_job",{p_hash:hash}),
    touch:async(id,hash,progress)=>!!await rpc("turn_touch_blender_render_job",{p_job:id,p_hash:hash,p_progress:progress}),
    finish:(id,hash,status,result,error)=>rpc("turn_finish_blender_render_job",{p_job:id,p_hash:hash,p_status:status,p_result:result,p_error:error}),
    stageScene:(id,hash,scene)=>rpc("turn_stage_blender_render_scene",{p_job:id,p_hash:hash,p_scene:scene}),
    get:id=>one(admin.from("turn_blender_render_jobs").select("*").eq("id",id)),
    latest:(project,location)=>one(admin.from("turn_blender_render_jobs").select("*").eq("project_id",project).eq("location_id",location).order("created_at",{ascending:false}).limit(1)),
    cancel:async id=>{
      const r=await admin.from("turn_blender_render_jobs").update({status:"cancelled",progress:"cancelled",updated_at:new Date().toISOString()}).eq("id",id).in("status",["queued","running"]).select("*").maybeSingle();
      if(r.error)throw new Error("Render database unavailable");return r.data||one(admin.from("turn_blender_render_jobs").select("*").eq("id",id));
    },
  };
}
export function createRenderStorage(admin,bucket="turn-assets"){
  const store=admin.storage.from(bucket);
  return {
    async hashBytes(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");},
    async put(path,bytes,contentType="image/png"){
      const r=await store.upload(path,new Blob([bytes],{type:contentType}),{contentType,upsert:false});
      if(r.error&&!["409","400"].includes(String(r.error.statusCode||r.error.status)))throw new Error("Result upload failed");
      if(r.error&&!/duplicate|already exists/i.test(String(r.error.message||"")))throw new Error("Result upload failed");
      return {created:!r.error};
    },
    async sign(path,seconds){const r=await store.createSignedUrl(path,seconds);if(r.error||!r.data?.signedUrl)throw new Error("Result unavailable");return r.data.signedUrl;},
    async remove(paths){if(paths.length){const r=await store.remove(paths);if(r.error)throw new Error("Result cleanup failed");}},
  };
}

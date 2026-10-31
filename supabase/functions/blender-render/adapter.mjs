import {RenderError} from "./core.mjs";
function row(value){const out=Array.isArray(value)?value[0]||null:value||null;return out&&typeof out==="object"&&"id" in out&&!out.id?null:out;}
export function createRenderDatabase(admin){
  async function rpc(name,args){
    const r=await admin.rpc(name,args);
    if(r.error){
      const message=String(r.error.message||"");
      if(/request_conflict/.test(message))throw new RenderError(409,"request_conflict","This request identity already belongs to another set revision.");
      if(/queue_full|daily_limit/.test(message))throw new RenderError(429,"render_limit","The preview queue limit was reached. Wait for an existing request to finish.");
      if(/lease_expired/.test(message))throw new RenderError(409,"lease_expired","This render lease expired.");
      throw new Error("Render database unavailable");
    }
    return row(r.data);
  }
  async function one(query){const r=await query.maybeSingle();if(r.error)throw new Error("Render database unavailable");return r.data||null;}
  return {
    submit:a=>rpc("turn_submit_blender_render_job",{p_project:a.project,p_owner:a.owner,p_actor:a.actor,p_location:a.location,p_request:a.request,p_scene:a.scene,p_hash:a.hash}),
    claim:hash=>rpc("turn_claim_blender_render_job",{p_hash:hash}),
    touch:async(id,hash,progress)=>!!await rpc("turn_touch_blender_render_job",{p_job:id,p_hash:hash,p_progress:progress}),
    finish:(id,hash,status,result,error)=>rpc("turn_finish_blender_render_job",{p_job:id,p_hash:hash,p_status:status,p_result:result,p_error:error}),
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
    async put(path,bytes){
      const r=await store.upload(path,new Blob([bytes],{type:"image/png"}),{contentType:"image/png",upsert:false});
      if(r.error&&!["409","400"].includes(String(r.error.statusCode||r.error.status)))throw new Error("Result upload failed");
      if(r.error&&!/duplicate|already exists/i.test(String(r.error.message||"")))throw new Error("Result upload failed");
      return {created:!r.error};
    },
    async sign(path,seconds){const r=await store.createSignedUrl(path,seconds);if(r.error||!r.data?.signedUrl)throw new Error("Result unavailable");return r.data.signedUrl;},
    async remove(paths){if(paths.length){const r=await store.remove(paths);if(r.error)throw new Error("Result cleanup failed");}},
  };
}

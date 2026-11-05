import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {createSupabaseAdapter} from "../blender-bridge/supabase-adapter.mjs";
import {createRenderService} from "./core.mjs";
import {createRenderDatabase,createRenderStorage} from "./adapter.mjs";
import "./scene-contract.js";
import "../blender-bridge/shared-contract.js";

const env=(name:string)=>Deno.env.get(name)||"";
const url=env("SUPABASE_URL"),anonKey=env("SUPABASE_ANON_KEY"),serviceKey=env("SUPABASE_SERVICE_ROLE_KEY");
const admin=url&&serviceKey?createClient(url,serviceKey):null;
// blender-bridge's adapter: the film access rules, and — with BLENDER_RENDER_OPEN=true (Build the set for paying
// plans, owner 2026-11-05) — the plan gate, the film payer and the credit hold of each build (core.mjs)
const bridge=admin?createSupabaseAdapter({createClient,url,anonKey,serviceKey}):null;
const auth=admin?{
  ...bridge,
  async hasLocation(projectId:string,locationId:string){
    const result=await admin.from("turn_projects").select("doc").eq("id",projectId).maybeSingle();
    if(result.error)throw new Error("Location catalog unavailable");
    return Array.isArray(result.data?.doc?.locations)&&result.data.doc.locations.some((l:{id:string})=>l.id===locationId);
  },
}:null;
const globals=globalThis as typeof globalThis & {KinolotRenderContract:unknown,BlenderContract:unknown};
const service=admin?createRenderService({
  auth,
  db:createRenderDatabase(admin),storage:createRenderStorage(admin),
  contract:globals.KinolotRenderContract,png:globals.BlenderContract,
  enabled:env("BLENDER_RENDER_ENABLED")==="true",
  allowedUsers:env("BLENDER_RENDER_ALLOWED_USERS").split(",").map(v=>v.trim()).filter(Boolean),
  workerSecret:env("BLENDER_RENDER_WORKER_SECRET"),
  open:env("BLENDER_RENDER_OPEN")==="true",
  billing:bridge,
}):null;
Deno.serve((request:Request)=>service?service.handle(request):new Response(JSON.stringify({error:"Cloud rendering is not configured."}),{status:503,headers:{"Content-Type":"application/json"}}));

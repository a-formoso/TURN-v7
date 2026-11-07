/* Offline PostgreSQL + storage harness. Never connects to a real account or provider. */
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {createRenderService} from "../supabase/functions/blender-render/core.mjs";
import {createRenderDatabase} from "../supabase/functions/blender-render/adapter.mjs";
import "../app/blender-render-contract.js";
import "../app/blender-contract.js";
export const owner="11111111-1111-4111-8111-111111111111",project="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333";
export const secret="offline-only-worker-secret-with-at-least-thirty-two-characters";
export const contract=globalThis.KinolotRenderContract;
const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
export function scene(){
  return {schema:contract.SCHEMA,name:"Offline room",units:"metres",notes:[],materials:{grey:{baseColor:[.45,.48,.5]}},previewLights:[],
    objects:[{id:"box",name:"Box",kind:"box",material:"grey",position:[0,0,.5],size:[1,1,1],rotation:[0,0,0]}],
    cameras:Object.fromEntries(contract.PANELS.map((p,i)=>[p,{position:[0,-4,1.6],yaw:i*90,pitch:-5,lensMm:24}]))};
}
export function png(){
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
  const chunk=(kind,data)=>{const k=Buffer.from(kind),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);k.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([k,data])),data.length+8);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(640);header.writeUInt32BE(360,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(360*(1+640*3),80);for(let y=0;y<360;y++)pixels[y*(1+640*3)]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
export async function harness(options={}){
  const pg=new PGlite();
  await pg.exec("create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;");
  const sql=readFileSync(new URL("../supabase/blender-render-jobs.sql",import.meta.url),"utf8");
  await pg.exec(sql);
  await pg.exec(readFileSync(new URL("../supabase/blender-render-scenes.sql",import.meta.url),"utf8"));
  await pg.exec(readFileSync(new URL("../supabase/blender-render-mcp.sql",import.meta.url),"utf8"));
  // Emulate the Supabase JS calls used by the real production database adapter.
  const admin={
    async rpc(name,args){
      try{
        if(!/^turn_(submit|claim|touch|finish)_blender_render_job$/.test(name)&&!["turn_stage_blender_render_scene","turn_claim_blender_render_job_v2"].includes(name))throw Error("Unexpected RPC");
        const params=Object.entries(args).map(([k,v])=>k==="p_schemas"?v:v&&typeof v==="object"?JSON.stringify(v):v);
        const call=name+"("+Object.keys(args).map((k,i)=>k+" => $"+(i+1)).join(",")+")";
        const rows=(await pg.query(name.includes("touch_")?"select "+call+" as value":"select ("+call+").*",params)).rows;
        return {data:copy(name.includes("touch_")?rows[0].value:rows[0])};
      }catch(error){return {error};}
    },
    from(table){
      if(table!=="turn_blender_render_jobs")throw Error("Unexpected table");
      const filters=[],params=[];let patch=null,sort="",limit="";
      const q={
        select(){return q;},
        eq(k,v){if(!["id","project_id","location_id"].includes(k))throw Error("Unexpected filter");params.push(v);filters.push(k+"=$"+params.length);return q;},
        in(k,values){if(k!=="status")throw Error("Unexpected filter");params.push(values);filters.push("status=any($"+params.length+"::text[])");return q;},
        update(value){patch=value;return q;},order(k,{ascending}){if(k!=="created_at")throw Error("Unexpected order");sort=" order by created_at "+(ascending?"asc":"desc");return q;},
        limit(n){limit=" limit "+Number(n);return q;},
        async maybeSingle(){
          try{
            let query="select * from "+table;
            if(patch){const sets=Object.entries(patch).map(([k,v])=>{if(!["status","progress","updated_at"].includes(k))throw Error("Unexpected update");params.push(v);return k+"=$"+params.length;});query="update "+table+" set "+sets.join(",");}
            query+=(filters.length?" where "+filters.join(" and "):"")+sort+limit+(patch?" returning *":"");
            return {data:copy((await pg.query(query,params)).rows[0])};
          }catch(error){return {error};}
        }
      };return q;
    }
  };
  const db=createRenderDatabase(admin),files=new Map(),contentTypes=new Map(),controls={writable:true,uploads:0,failUploadAt:0,afterPut:null};
  const auth={
    async hasLocation(id,location){return id===project&&["room","roundtrip-room"].includes(location);},
    async getUserByAccessToken(token){return token==="owner-session"?{id:owner}:token==="other-session"?{id:other}:null;},
    async getUserById(id){return {id};},
    async getProjectAccess(id,user){return {exists:id===project,ownerId:owner,canWrite:controls.writable&&user.id===owner};}
  };
  const storage={
    async hashBytes(bytes){return createHash("sha256").update(bytes).digest("hex");},
    async put(path,bytes,type="image/png"){controls.uploads++;if(controls.failUploadAt===controls.uploads)throw Error("Injected storage failure");const created=!files.has(path);files.set(path,new Uint8Array(bytes));contentTypes.set(path,type);if(controls.afterPut)await controls.afterPut();return {created};},
    async sign(path){if(!files.has(path))throw Error("Missing file");return "https://storage.example.test/"+encodeURIComponent(path);},
    async remove(paths){paths.forEach(p=>{files.delete(p);contentTypes.delete(p);});}
  };
  const service=createRenderService({auth,db,storage,contract,png:globalThis.BlenderContract,enabled:true,allowedUsers:[owner],workerSecret:secret,...options});
  const request=async(action,body={},token="owner-session")=>{
    const r=await service.handle(new Request("https://offline.example.test/render",{method:"POST",headers:{Authorization:token===secret?"Worker "+secret:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({...(action==="job.get"||action==="job.cancel"?{projectId:project}:{}),...body,action})}));
    return {status:r.status,body:await r.json()};
  };
  const uploadScene=async(job,bytes,headers={})=>{
    const r=await service.handle(new Request("https://offline.example.test/render",{method:"POST",headers:{Authorization:"Worker "+secret,"Content-Type":"application/x-blender",
      "x-kinolot-job":job.id,"x-kinolot-lease":job.leaseToken,"x-kinolot-scene-hash":createHash("sha256").update(bytes).digest("hex"),...headers},body:bytes}));
    return {status:r.status,body:await r.json()};
  };
  return {pg,db,auth,storage,service,request,uploadScene,files,contentTypes,controls,sql};
}
export function completion(job,s){
  const cameras=Object.fromEntries(contract.PANELS.map(p=>{
    const c=s.cameras[p],yaw=c.yaw*Math.PI/180,pitch=c.pitch*Math.PI/180;
    return [p,{position:c.position,direction:[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)],lensMm:c.lensMm,sensorWidthMm:36,width:640,height:360}];
  }));
  const image=png();
  return {jobId:job.id,leaseToken:job.leaseToken,images:Object.fromEntries(["colour","depth","id"].flatMap(k=>contract.PANELS.map(p=>[k+"_"+p,image]))),
    report:{inputSha256:job.sceneHash,objects:s.objects.length,width:640,height:360,blenderVersion:"offline-test",wallSeconds:1,peakChildRssMiB:1,cameras}};
}

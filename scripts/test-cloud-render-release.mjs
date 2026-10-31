/* Release-boundary checks. Offline identities, PostgreSQL and storage only. */
import assert from "node:assert/strict";
import {createRenderService} from "../supabase/functions/blender-render/core.mjs";
import {harness,owner,other,project,secret,scene,completion,contract} from "./cloud-render-test-harness.mjs";

const h=await harness();
let checks=0;
const check=(actual,expected,label)=>{assert.equal(actual,expected,label);checks++;};
const service=overrides=>createRenderService({auth:h.auth,db:h.db,storage:h.storage,contract,
  png:globalThis.BlenderContract,enabled:true,allowedUsers:[owner],workerSecret:secret,...overrides});
async function call(target,body,authorization="Bearer owner-session"){
  const response=await target.handle(new Request("https://offline.example.test/render",{method:"POST",
    headers:{Authorization:authorization,"Content-Type":"application/json"},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json()};
}
const create=()=>h.request("job.create",{projectId:project,locationId:"room",requestId:crypto.randomUUID(),scene:scene()});
const claim=()=>h.request("worker.claim",{claimToken:crypto.randomUUID()},secret);
try{
  for(const config of [{enabled:false},{allowedUsers:[]},{workerSecret:""},{workerSecret:"too-short"}]){
    for(const authorization of ["Bearer owner-session","Worker "+secret]){
      check((await call(service(config),{action:"capabilities",projectId:project},authorization)).status,503,
        "Incomplete pilot configuration fails closed for browser and worker access");
    }
  }
  const bothAllowed=service({allowedUsers:[owner,other]});
  check((await call(bothAllowed,{action:"job.latest",projectId:project,locationId:"room"},"Bearer other-session")).status,403,
    "Being allowlisted does not grant another owner's film");
  check((await h.request("job.create",{projectId:project,locationId:"missing",requestId:crypto.randomUUID(),scene:scene()})).status,409,
    "A location missing from the saved film cannot queue a render");
  check((await h.pg.query("select count(*)::int as n from turn_blender_render_jobs")).rows[0].n,0,
    "Rejected access and missing locations leave the queue unchanged");

  const deniedJob=(await create()).body.job;
  h.controls.writable=false;
  check((await claim()).status,403,"Ownership access is checked again before handing a job to Blender");
  check((await h.db.get(deniedJob.id)).status,"failed","An inaccessible queued job becomes terminal");
  check(h.files.size,0,"A denied claim produces no stored results");
  h.controls.writable=true;
  const successful=(await create()).body.job,lease=(await claim()).body.job;
  check(lease.id,successful.id,"A denied job does not block the next authorised request");
  check((await h.request("worker.complete",completion(lease,scene()),secret)).status,200,
    "The next job completes after the denied claim");
  h.controls.writable=false;
  const deniedRead=await h.request("job.get",{jobId:successful.id});
  check(deniedRead.status,403,"Losing film access blocks a fresh completed-result read");
  check(JSON.stringify(deniedRead.body).includes("storage.example.test"),false,
    "An unauthorised read returns no signed image URLs");
  h.controls.writable=true;
  check((await h.request("job.get",{jobId:successful.id})).body.job.status,"completed",
    "Restored authorised access recovers the durable result");

  const raceJob=(await create()).body.job,raceLease=(await claim()).body.job,priorFiles=h.files.size;
  h.controls.afterPut=async()=>{h.controls.writable=false;};
  check((await h.request("worker.complete",completion(raceLease,scene()),secret)).status,403,
    "Access lost during upload prevents publishing the result");
  check(h.files.size,priorFiles,"Denied completion cleans only its newly uploaded images");
  check((await h.db.get(raceJob.id)).result,null,"Denied completion cannot attach a result");
  h.controls.afterPut=null;h.controls.writable=true;
  await h.request("worker.fail",{jobId:raceLease.id,leaseToken:raceLease.leaseToken},secret);

  // Test every grant boundary with real PostgreSQL roles and valid SQL signatures.
  const queries=[
    "select * from turn_blender_render_jobs",
    "insert into turn_blender_render_jobs default values",
    "update turn_blender_render_jobs set progress='rendering' where false",
    "delete from turn_blender_render_jobs where false",
    "select turn_submit_blender_render_job('"+project+"','"+owner+"','"+owner+"','room','"+crypto.randomUUID()+"','{}'::jsonb,'"+"a".repeat(64)+"')",
    "select turn_claim_blender_render_job('"+"a".repeat(64)+"')",
    "select turn_touch_blender_render_job('"+successful.id+"','"+"a".repeat(64)+"','rendering')",
    "select turn_finish_blender_render_job('"+successful.id+"','"+"a".repeat(64)+"','failed',null,null)",
  ];
  for(const role of ["anon","authenticated"]){
    for(const sql of queries){
      let denied=false;
      try{await h.pg.transaction(async tx=>{await tx.exec("set local role "+role);await tx.query(sql);});}
      catch(error){assert.match(error.message,/permission denied/);denied=true;}
      check(denied,true,"Browser role cannot mutate jobs or call any worker RPC");
    }
  }

  // Terminal jobs still count toward the rolling daily budget; no render is started.
  while((await h.pg.query("select count(*)::int as n from turn_blender_render_jobs")).rows[0].n<30){
    const job=(await create()).body.job;
    assert.ok(job);await h.db.cancel(job.id);
  }
  check((await create()).status,429,"Thirty terminal requests still exhaust the daily account limit");
  await h.pg.exec("update turn_blender_render_jobs set created_at=now()-interval '25 hours'");
  check((await create()).status,200,"Expired daily requests release the account's submission budget");
  console.log("PASS cloud render release: "+checks+" fail-closed, ownership, revocation, SQL-grant and daily-limit checks");
}finally{await h.pg.close();}

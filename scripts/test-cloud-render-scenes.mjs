/* Offline DB/storage lifecycle checks. No account, provider, or network calls. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {harness,project,secret,scene,completion} from "./cloud-render-test-harness.mjs";
import {readSceneFile,SCENE_FILE_MAX_BYTES} from "../supabase/functions/blender-render/scene-file.mjs";
import {createRenderStorage} from "../supabase/functions/blender-render/adapter.mjs";

const h=await harness({sceneStorage:true});let checks=0;
const check=(actual,expected,label)=>{assert.equal(actual,expected,label);checks++;};
const bytes=Buffer.concat([Buffer.from("BLENDER17-01v0502"),Buffer.alloc(128,31)]);
const changed=Buffer.from(bytes);changed[100]=33;
const claim=async()=>{
  const value=scene();
  const made=await h.request("job.create",{projectId:project,locationId:"room",requestId:crypto.randomUUID(),scene:value});
  check(made.status,200,"Create scoped build");
  return {value,job:(await h.request("worker.claim",{claimToken:crypto.randomUUID()+crypto.randomUUID(),sceneStorage:true},secret)).body.job};
};
try{
  for(const header of ["BLENDER-v405","BLENDER_V405","BLENDER17-01v0502"]){
    const input=Buffer.concat([Buffer.from(header),Buffer.alloc(128)]);
    const parsed=await readSceneFile(new Request("https://offline.test",{method:"POST",body:input}));
    check(Buffer.from(parsed).equals(input),true,"Legacy and current Blender headers preserve the original bytes");
  }
  for(const header of ["BLENDER18-01v0502","BLENDER17-02v0502","BLENDER17_01v0502","BLENDER17-01V0502","BLENDER17-01v05xx","BLENDER17-01"]){
    const input=Buffer.concat([Buffer.from(header),Buffer.alloc(128)]);
    await assert.rejects(readSceneFile(new Request("https://offline.test",{method:"POST",body:input})),/invalid_scene_file/);checks++;
  }
  const calls=[];
  const adapter=createRenderStorage({storage:{from:bucket=>({upload:async(path,blob,options)=>{calls.push({bucket,path,blob,options});return {data:{}};}})}});
  await adapter.put('scene.blend',bytes,'application/x-blender');
  await adapter.put('camera.png',bytes);
  check(calls[0].bucket,'turn-assets','Scenes use the existing project asset bucket');
  check(calls[0].blob.type,'application/x-blender','Scene Blob has correct MIME type');
  check(calls[0].options.contentType,'application/x-blender','Storage receives scene MIME type');
  check(calls[0].options.upsert,false,'Scene upload cannot overwrite an existing file');
  check(calls[1].options.contentType,'image/png','Existing image uploads retain PNG MIME type');
  const {value,job}=await claim();
  check(job.storeScene,true,"Worker is told scene retention is required");
  const done=completion(job,value);
  check((await h.request("worker.complete",done,secret)).status,400,"No paid completion before required scene storage");
  check((await h.uploadScene(job,bytes,{Authorization:"Bearer owner-session"})).status,401,"Browser cannot upload worker scenes");
  check((await h.uploadScene(job,bytes,{"x-kinolot-lease":"forged"})).status,409,"Forged leases cannot write storage");
  check((await h.uploadScene(job,bytes,{"x-kinolot-scene-hash":"0".repeat(64)})).status,400,"Byte signature mismatch rejected");
  check((await h.uploadScene(job,Buffer.alloc(128))).status,400,"Non-Blender bytes rejected");
  check((await h.uploadScene(job,bytes,{"content-length":String(SCENE_FILE_MAX_BYTES+1)})).status,413,"Declared oversize rejected");
  const chunk=new Uint8Array(1048576);let sent=0;
  const stream=new ReadableStream({pull(controller){sent++;controller.enqueue(chunk);if(sent===33)controller.close();}});
  await assert.rejects(readSceneFile(new Request("https://offline.test",{method:"POST",body:stream,duplex:"half"})),/scene_too_large/);checks++;
  check(h.files.size,0,"Rejected inputs stored nothing");

  h.controls.failUploadAt=h.controls.uploads+1;
  check((await h.uploadScene(job,bytes)).status,503,"Storage failure is not reported as success");
  check(h.files.size,0,"Failed upload leaves no file");h.controls.failUploadAt=0;
  h.controls.afterPut=()=>{h.controls.writable=false;};
  check((await h.uploadScene(job,bytes)).status,403,"Revoked access during upload blocks staging");
  check(h.files.size,0,"Uncommitted file removed after access revocation");
  h.controls.afterPut=null;h.controls.writable=true;

  const stage=h.db.stageScene;
  h.db.stageScene=async(...args)=>{await stage(...args);throw Error("Lost staging response");};
  check((await h.uploadScene(job,bytes)).status,200,"A lost DB response recovers a committed scene");h.db.stageScene=stage;
  check(h.files.size,1,"Scene stored once");
  check([...h.contentTypes.values()][0],"application/x-blender","Correct scene content type");
  const stored=(await h.db.get(job.id)).result.scene;
  check(stored.sourceSceneHash,job.sceneHash,"Artifact tied to source revision");
  check(stored.sha256,createHash("sha256").update(bytes).digest("hex"),"Stored bytes hash recorded");
  check(stored.path.startsWith("_internal/blender-renders/"),true,"Scene stays in private service namespace");
  check((await h.request("job.get",{jobId:job.id})).body.job.result,undefined,"Pending scene is not exposed");
  const uploads=h.controls.uploads;
  check((await h.uploadScene(job,bytes)).status,200,"Identical scene retry succeeds");
  check(h.controls.uploads,uploads,"Retry does not rewrite the scene");
  check((await h.uploadScene(job,changed)).status,409,"Different scene cannot replace an immutable staged scene");
  await assert.rejects(h.db.stageScene(job.id,stored.leaseHash,{...stored,sha256:"f".repeat(64),path:stored.path}),/unavailable/);checks++;

  h.controls.failUploadAt=h.controls.uploads+4;
  check((await h.request("worker.complete",done,secret)).status,503,"Partial image upload does not complete build");
  check(h.files.size,1,"Image cleanup preserves the committed editable scene");h.controls.failUploadAt=0;
  check((await h.request("worker.complete",done,secret)).status,200,"Scene and images complete together");
  check(h.files.size,13,"Twelve image files and one scene retained");
  const saved=(await h.request("job.get",{jobId:job.id})).body.job;
  check(saved.result.scene.bytes,bytes.length,"Authenticated read includes scene metadata");
  check(saved.result.scene.filename,"set.blend","Readable scene filename");
  check(saved.result.scene.url.startsWith("https://storage.example.test/"),true,"Scene URL signed only on authorized reads");
  check(JSON.stringify(saved).includes("leaseHash"),false,"Scene response does not reveal internal lease hash");
  check((await h.request("job.get",{jobId:job.id},"other-session")).status,403,"Other account cannot obtain scene URL");
  check((await h.request("worker.complete",done,secret)).status,200,"Completion with scene remains idempotent");
  check((await h.uploadScene(job,bytes)).status,200,"Lost final scene-upload response can be retried after completion");
  check((await h.uploadScene(job,changed)).status,409,"Completed scene is immutable");

  const cancelled=await claim();await h.uploadScene(cancelled.job,bytes);
  check(h.files.size,14,"New running job has one staged scene");
  check((await h.request("job.cancel",{jobId:cancelled.job.id})).body.job.status,"cancelled","Job cancels normally");
  check(h.files.size,13,"Cancellation removes uncompleted scene");
  const failed=await claim();await h.uploadScene(failed.job,bytes);
  check((await h.request("worker.fail",{jobId:failed.job.id,leaseToken:failed.job.leaseToken},secret)).status,200,"Worker can fail an incomplete build");
  check(h.files.size,13,"Failure removes uncompleted scene");

  const retry=await claim();await h.uploadScene(retry.job,bytes);
  const old=(await h.db.get(retry.job.id)).result.scene.path;
  await h.pg.query("update turn_blender_render_jobs set lease_expires_at=now()-interval '1 minute' where id=$1",[retry.job.id]);
  const recovered=(await h.request("worker.claim",{claimToken:crypto.randomUUID()+crypto.randomUUID(),sceneStorage:true},secret)).body.job;
  check(recovered.id,retry.job.id,"Expired lease is reclaimed");
  check((await h.request("worker.complete",completion(recovered,retry.value),secret)).status,400,"Prior lease's scene cannot satisfy a new build attempt");
  check((await h.uploadScene(recovered,bytes)).status,200,"New lease stages its own artifact");
  check(h.files.has(old),false,"Old attempt's scene cleaned after replacement");
  await h.request("worker.fail",{jobId:recovered.id,leaseToken:recovered.leaseToken},secret);

  await h.pg.exec("set role authenticated");
  await assert.rejects(h.pg.query("select turn_stage_blender_render_scene($1,$2,$3::jsonb)",[job.id,stored.leaseHash,JSON.stringify(stored)]),/permission denied/);checks++;
  await h.pg.exec("reset role");
  console.log("Cloud scene storage: "+checks+" checks passed.");
}finally{await h.pg.close();}

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";
import {harness,owner,project,other,secret,scene,completion,contract} from "./cloud-render-test-harness.mjs";
const h=await harness(),s=scene(),claimToken="offline-claim-token-with-thirty-two-characters";
const create=(requestId=crypto.randomUUID(),value=s)=>h.request("job.create",{projectId:project,locationId:"room",requestId,scene:value});
const claim=token=>h.request("worker.claim",{claimToken:token||claimToken},secret);
let checks=0;
function check(value,expected,message){assert.equal(value,expected,message);checks++;}
try{
  check((await h.request("capabilities",{projectId:project},"bad-session")).status,401,"Anonymous requests denied");
  check((await h.request("capabilities",{projectId:project},"other-session")).status,403,"Non-pilot users denied");
  check((await h.request("capabilities",{projectId:other})).status,403,"Other films denied");
  check((await h.request("worker.claim",{claimToken})).status,401,"Browser cannot claim worker jobs");
  check((await create(crypto.randomUUID(),{...s,script:"forbidden"})).status,400,"Executable/unknown fields denied");
  const requestId=crypto.randomUUID(),first=await create(requestId);
  check(first.status,200,"Job submitted");
  check((await create(requestId)).body.job.id,first.body.job.id,"Duplicate submit returns same job");
  check((await create(requestId,{...s,name:"Changed"})).status,409,"An identity cannot be reused for another revision");
  const job=(await claim()).body.job;
  check(job.id,first.body.job.id,"Claim returns queued job");
  check((await claim()).body.job.id,job.id,"Lost claim response can be retried safely");
  check((await claim("different-offline-claim-token-123456789")).body.job,null,"One active worker job");
  check((await h.request("worker.heartbeat",{jobId:job.id,leaseToken:"wrong"},secret)).status,409,"Forged lease refused");
  const done=completion(job,s),wrong=structuredClone(done);wrong.report.cameras.TL.position[0]+=1;
  check((await h.request("worker.complete",wrong,secret)).status,400,"Camera drift rejected");
  const corrupt=structuredClone(done);corrupt.images.colour_TL="invalid";
  check((await h.request("worker.complete",corrupt,secret)).status,400,"Malformed PNG rejected without persisting results");
  check(h.files.size,0,"No invalid images stored");
  h.controls.failUploadAt=4;
  check((await h.request("worker.complete",done,secret)).status,503,"Storage failure prevents completion");
  check(h.files.size,0,"Partial upload cleaned up");h.controls.failUploadAt=0;
  h.controls.writable=false;
  check((await h.request("worker.complete",done,secret)).status,403,"Revoked access rejected");h.controls.writable=true;
  check((await h.request("worker.complete",done,secret)).status,200,"Verified images persisted");
  check(h.files.size,12,"Twelve separate colour/depth/ID images saved");
  check((await h.request("worker.complete",done,secret)).status,200,"Completion retry is idempotent");
  const mismatch=structuredClone(done);mismatch.report.wallSeconds=2;
  check((await h.request("worker.complete",mismatch,secret)).status,409,"Conflicting completion rejected");
  const saved=await h.request("job.get",{jobId:job.id});
  check(saved.body.job.status,"completed","Completed job survives a new read");
  check(Object.keys(saved.body.job.result.images).length,12,"Only authenticated read signs images");
  check(JSON.stringify(saved.body).includes("lease"),false,"User responses contain no worker lease");
  check((await h.request("job.get",{jobId:job.id},"other-session")).status,403,"Cross-user result denied");
  check((await h.request("job.cancel",{jobId:job.id,projectId:other})).status,404,"A different open film cannot cancel this job");
  const second=(await create()).body.job,job2=(await claim("second-offline-claim-token-123456789")).body.job;
  let cancelled=false;
  h.controls.afterPut=async()=>{if(!cancelled){cancelled=true;await h.db.cancel(second.id);}};
  check((await h.request("worker.complete",completion(job2,s),secret)).status,409,"Cancellation wins an upload race");
  check(h.files.size,12,"Cancelled upload cannot alter the earlier completed images");h.controls.afterPut=null;
  const third=(await create()).body.job,oldLease=(await claim("third-offline-claim-token-123456789")).body.job;
  await h.pg.query("update turn_blender_render_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[third.id]);
  const newLease=(await claim("retry-offline-claim-token-123456789")).body.job;
  check(newLease.id,third.id,"Expired lease recovers the same job");
  check((await h.db.get(third.id)).attempts,2,"Recovery is bounded to a second attempt");
  check((await h.request("worker.complete",completion(oldLease,s),secret)).status,409,"Old attempt cannot complete after recovery");
  await h.pg.query("update turn_blender_render_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[third.id]);
  await claim("final-offline-claim-token-123456789");
  check((await h.db.get(third.id)).status,"failed","Repeated interruption becomes a terminal failure");
  const fourth=(await create()).body.job,replayed=(await claim("lost-response-claim-token-123456789")).body.job;
  const finish=h.db.finish;let lost=false;
  h.db.finish=async(...args)=>{const result=await finish(...args);if(!lost&&args[2]==="completed"){lost=true;throw Error("Injected lost commit acknowledgement");}return result;};
  check((await h.request("worker.complete",completion(replayed,s),secret)).status,200,"Lost commit acknowledgement recovers the committed result");
  check((await h.db.get(fourth.id)).status,"completed","A response loss does not delete durable images");h.db.finish=finish;
  for(let i=0;i<3;i++)check((await create()).status,200,"Bounded queue accepts a slot");
  check((await create()).status,429,"Queue does not accept unlimited jobs");
  // Direct PostgREST roles cannot inspect jobs or invoke privileged worker RPCs.
  for(const role of ["anon","authenticated"]){
    for(const query of ["select * from turn_blender_render_jobs","select turn_claim_blender_render_job('"+"a".repeat(64)+"')"]){
      let denied=false;
      try{await h.pg.transaction(async tx=>{await tx.exec("set local role "+role);await tx.query(query);});}catch(_){denied=true;}
      check(denied,true,role+" denied direct queue access");
    }
  }
  await h.pg.exec(h.sql);check((await h.db.get(job.id)).status,"completed","Migration re-run preserves jobs");

  // Use the real location normaliser and exporter, including raised-floor openings.
  const box={console,crypto,TextEncoder,URL,location:{hostname:"localhost"},turnIsAdmin:true,localStorage:{getItem:()=>null,setItem:()=>{}},
    scenesInStoryOrder:x=>x||[],nbGetMeta:()=>null,nbGetImage:()=>""};box.window=box;
  vm.createContext(box);
  for(const file of ["locations.jsx","blender-render-contract.js","blender-render.js"])vm.runInContext(readFileSync(new URL("../app/"+file,import.meta.url),"utf8"),box);
  const room={id:"room",key:"room",name:"Raised room",spatialPlan:{status:"reviewed",source:{assetId:"room",iso:""},frame:"North",
    anchors:[{id:"cabinet",name:"Cabinet",space:"Raised room",placement:"Centre",xy:[0,0],z:3.5,size:[2,1,1],sizeBasis:"user"}],
    coordinates:{spaces:[{id:"room",name:"Raised room",footprint:[[-5,-5],[5,-5],[5,5],[-5,5]],floorZ:3,ceilingH:3,
      openings:[{id:"door",kind:"door",name:"Door",centre:[0,-5],width:2,sillZ:3,headZ:5.2}]}],
      cameras:contract.PANELS.map((panel,i)=>({spaceId:"room",panel,position:[0,-4,4.6],yaw:i*90,pitch:-5,lensMm:24}))}}};
  box.turnContinuity={locations:[room]};
  const built=box.KinolotCloudRender.buildScene(room);
  check(built.cameras.TR.yaw,90,"Saved camera directions preserved");
  const object=built.objects.find(o=>o.anchorId==="cabinet");
  check(object.position[2],3.5,"Saved object centre height preserved");
  const header=built.objects.find(o=>o.id.startsWith("wall-0-0")&&Math.abs(o.size[0]-2)<.001);
  check(Math.round(header.size[2]*10),8,"Raised-floor door opening cut at absolute sill/head heights");
  delete room.spatialPlan.anchors[0].size;
  assert.throws(()=>box.KinolotCloudRender.buildScene(room),/width, depth and height/);checks++;
  assert.throws(()=>contract.polygon([[0,0],[3,3],[0,3],[3,0]]),/crosses itself/);checks++;
  const memory=new Map();box.localStorage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const scope={uid:owner,projectId:project,epoch:1},identity=box.KinolotCloudRender.requestIdentity(scope,"room","revision","previous-job");
  check(box.KinolotCloudRender.requestIdentity(scope,"room","revision","previous-job"),identity,"Ambiguous submit retries preserve its identity");
  check(box.KinolotCloudRender.requestIdentity(scope,"room","revision","new-completed-job")===identity,false,"An explicit later rebuild gets a new identity");
  box.localStorage={getItem:()=>{throw Error("Storage unavailable");},setItem:()=>{throw Error("Storage unavailable");}};
  const memoryIdentity=box.KinolotCloudRender.requestIdentity(scope,"private-window","revision");
  check(box.KinolotCloudRender.requestIdentity(scope,"private-window","revision"),memoryIdentity,"In-memory request identity survives unavailable browser storage");
  box.location.hostname="kinolot.infinitestudioai.com";check(box.KinolotCloudRender.enabled(),false,"Development panel disabled on the live host");
  room.spatialPlan.anchors[0].size=[2,1,1];room.spatialPlan.anchors[0].sizeBasis="user";
  box.location.hostname="localhost";box.nbEpoch=()=>1;box.aiAvailable=()=>true;box.extractJSON=JSON.parse;box.locationScreenplayContext=()=>"";
  let prompt="";box.claude={complete:async input=>{prompt=input.messages[0].content;return JSON.stringify({...room.spatialPlan,anchors:[{...room.spatialPlan.anchors[0],size:[9,9,9],sizeBasis:"design"}]});}};
  const ai=readFileSync(new URL("../app/ai.jsx",import.meta.url),"utf8"),ast=parseSync(ai,{sourceType:"script",parserOpts:{plugins:["jsx"]}});
  const fn=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="aiDraftLocationSpatialPlan");
  vm.runInContext(ai.slice(fn.start,fn.end),box);
  const proposed=await box.aiDraftLocationSpatialPlan(room,[],{});
  check(proposed.anchors[0].size[0],2,"Layout drafting cannot overwrite dimensions entered by hand");
  check(proposed.status,"draft","Proposed dimensions still require human layout review");
  check(prompt.includes("sizeBasis")&&prompt.includes("CENTRE height"),true,"Drafting describes dimension provenance and centre-height convention");
  box.BlenderPreview={scope:()=>scope,isCurrent:()=>true};box.setTimeout=setTimeout;box.clearTimeout=clearTimeout;
  let fetches=0;box.fetch=async()=>{fetches++;throw Error("Should not fetch");};
  await assert.rejects(box.KinolotCloudRender.request("job.create",{projectId:other},scope),/another film/);checks++;
  box.sbClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:"test",user:{id:other}}}})}});
  await assert.rejects(box.KinolotCloudRender.request("job.create",{projectId:project},scope),/Sign in again/);checks++;
  check(fetches,0,"Wrong-film and changed-session requests have no network side effects");
  console.log("PASS cloud render: "+checks+" protocol, SQL permission, persistence and geometry checks");
}finally{await h.pg.close();}

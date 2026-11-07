/* Versioned detailed scenes, actual app assembly and service gates. No provider calls. */
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync,writeFileSync} from "node:fs";
import {harness,project,owner,secret,contract,completion} from "./cloud-render-test-harness.mjs";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const root={console,crypto,TextEncoder,location:{hostname:"localhost"},turnIsAdmin:true,TURN_SUPABASE:{setBuildMcp:true},scenesInStoryOrder:x=>x||[],nbGetMeta:()=>null,nbGetImage:()=>""};root.window=root;vm.createContext(root);
for(const file of ["locations.jsx","blender-render-contract.js","blender-set-kitchen.js","blender-set-detail.js","blender-render.js"])vm.runInContext(read("app/"+file),root);
const pose=(panel,position,yaw,pitch,lensMm)=>({panel,spaceId:"room",position,yaw,pitch,lensMm});
const anchor=(id,name,xy,size,facing=0)=>({id,name,space:"Test room",xy,size,z:size[2]/2,facing,sizeBasis:"user",placement:"Saved test position"});
const room={id:"room",name:"Test room",spatialPlan:{frame:"Facing north",status:"reviewed",heights:"centre",source:{assetId:"room",iso:""},anchors:[
  anchor("bed","Single bed",[1.1,3],[1.05,2,1]),anchor("desk","Desk",[3.2,3.2],[1.1,.6,.74]),
  anchor("chair","Chair",[3.2,2.35],[.43,.43,.9]),anchor("wardrobe","Wardrobe",[3.45,.55],[.9,.6,2])
],coordinates:{spaces:[{id:"room",name:"Test room",floorZ:0,ceilingH:2.6,footprint:[[0,0],[4,0],[4,4],[0,4]],openings:[{id:"window",name:"Window",kind:"window",edge:3,centre:[0,3],width:1.2,sillZ:1,headZ:2.1}]}],cameras:[
  pose("TL",[.5,.5,1.6],30,-10,22),pose("TR",[3.4,3.7,1.8],220,-15,22),
  pose("BL",[2.4,1.8,1.5],320,-10,35),pose("BR",[1.1,1.3,1.5],55,-10,28)
]}}};
root.turnContinuity={locations:[room]};
const original=JSON.stringify(room),scene=root.KinolotCloudRender.buildScene(room);
ok(scene.schema===contract.MCP_SCHEMA&&scene.authoring==="mcp-procedural-v1","Detailed app builds identify the MCP authoring version");
ok(JSON.stringify(room)===original,"Assembly leaves the saved floor plan and cameras untouched");
ok(scene.objects.some(o=>o.kind==="cloth")&&scene.objects.some(o=>o.kind==="cushion"),"Soft furniture uses actual shaped-mesh recipes");
ok(scene.objects.some(o=>o.name.includes("frame jamb")),"Frames derive from a saved aperture");
ok(scene.objects.some(o=>o.bevelMetres>0)&&scene.materials.furnitureWood.texture==="wood","Manufactured edges and textures are explicit scene data");
for(const p of ["TL","TR","BL","BR"]){
 const saved=room.spatialPlan.coordinates.cameras.find(c=>c.panel===p);
 ok(JSON.stringify(scene.cameras[p])===JSON.stringify({position:saved.position,yaw:saved.yaw,pitch:saved.pitch,lensMm:saved.lensMm}),"Saved camera remains exact: "+p);
}
root.TURN_SUPABASE.setBuildMcp=false;
const basic=root.KinolotCloudRender.buildScene(room);
ok(basic.schema===contract.SCHEMA&&!basic.authoring,"The existing format remains available");
ok(!basic.objects.some(o=>["cloth","cushion"].includes(o.kind)),"Detailed shapes never leak into legacy jobs");
for(const mutate of [s=>s.authoring="other",s=>s.script="bad",s=>s.objects[0].bevelMetres=100,s=>s.materials.wall.texture="url:https://example.test/image"]){
 const bad=structuredClone(scene);mutate(bad);assert.throws(()=>contract.validateScene(bad));checks++;
}
const h=await harness();
const response=await h.request("job.create",{projectId:project,locationId:"room",requestId:crypto.randomUUID(),scene});
ok(response.status===503,"An unavailable detailed renderer refuses the job before queueing or billing");
ok((await h.db.activeCount())===0,"The refused detailed job did not enter the queue");
const live=await harness({mcpScenes:true,sceneStorage:true});
const capabilities=await live.request("capabilities",{projectId:project});
ok(capabilities.body.detailedSets===true,"The service advertises detailed sets only with private scene retention");
const submitted=await live.request("job.create",{projectId:project,locationId:"room",requestId:crypto.randomUUID(),scene});
ok(submitted.status===200,"An enabled detailed build enters the real PostgreSQL queue");
ok((await live.request("worker.claim",{claimToken:"legacy-worker-claim-with-thirty-two-characters"},secret)).body.job===null,"A basic worker cannot claim a detailed job");
const claimed=(await live.request("worker.claim",{claimToken:"detailed-offline-lease-token-with-thirty-two-chars",sceneSchemas:[contract.SCHEMA,contract.MCP_SCHEMA],sceneStorage:true},secret)).body.job;
ok(claimed.storeScene&&claimed.sceneHash===await contract.hash(scene),"The worker receives the exact detailed revision and mandatory scene retention");
const result=completion(claimed,scene);
ok((await live.request("worker.complete",result,secret)).status===400,"A basic renderer cannot complete the detailed job");
result.report.renderer="cloud-mcp-v1";
result.report.visibleObjects=Object.fromEntries(contract.PANELS.map(p=>[p,[scene.objects[0].id]]));
ok((await live.request("worker.complete",result,secret)).status===400,"Detailed completion waits for the editable scene upload");
ok((await live.uploadScene(claimed,Buffer.concat([Buffer.from("BLENDER-v520"),Buffer.alloc(128)]))).status===200,"The detailed scene is privately staged under its lease");
ok((await live.request("worker.complete",result,secret)).status===200,"The twelve images and editable set complete together");
const saved=(await live.request("job.get",{jobId:claimed.id})).body.job;
ok(saved.result.scene.sourceSceneHash===claimed.sceneHash&&saved.result.report.renderer==="cloud-mcp-v1","Public results retain the verified detailed source revision");
ok(live.files.size===13,"The completed detailed build retains twelve camera passes and one private editable scene");
const basicSubmit=await live.request("job.create",{projectId:project,locationId:"room",requestId:crypto.randomUUID(),scene:basic});
ok(basicSubmit.status===200,"Existing basic builds can still queue during rollout");
const legacy=(await live.request("worker.claim",{claimToken:"legacy-capability-claim-thirty-two-characters"},secret)).body.job;
ok(legacy.storeScene===false,"An older worker is not given a new mandatory upload it cannot perform");
ok((await live.request("worker.complete",completion(legacy,basic),secret)).status===200,"Older basic builds can complete while detailed storage is enabled");
for(const role of ["anon","authenticated"]){
 await live.pg.exec("set role "+role);
 try{await assert.rejects(()=>live.pg.query("select turn_claim_blender_render_job_v2($1,$2,$3)",["a".repeat(64),[contract.MCP_SCHEMA],true]),/permission denied/i);checks++;}
 finally{await live.pg.exec("reset role");}
}
vm.runInContext(read("app/blender-style.js"),root);
const lightScene={materials:{lit:{emissionStrength:4},housing:{}},objects:[
 {id:"lamp-glow",anchorId:"lamp",name:"Sink light · diffuser",material:"lit"},
 {id:"lamp-body",anchorId:"lamp",name:"Sink light · body",material:"housing"},
 {id:"wall",name:"Wall",material:"housing"}
]};
const lightJob={result:{report:{visibleObjects:{TL:["lamp-body","wall"],TR:["wall"],BL:["wall"],BR:["wall"]}}}};
const visibility=root.KinolotSetStyle.visibilityNotes(lightJob,lightScene);
ok(visibility.includes("TL: Sink light")&&visibility.includes("TR: no modeled emissive fitting is visible"),"Styling knows which fitting is visible, including its non-emissive housing");
ok(root.KinolotSetStyle.visibilityNotes({},lightScene)==="","Older jobs without visibility reports remain supported");
lightJob.result.report.visibleObjects.TL=["unknown"];
ok(root.KinolotSetStyle.visibilityNotes(lightJob,lightScene)==="","An invalid visibility reference cannot become style guidance");
const kitchen=structuredClone(room);kitchen.spatialPlan.anchors=[
  anchor("north","Sink run counter",[2,3.7],[4,.6,.9],180),anchor("east","Fridge run counter",[3.7,2.1],[2.6,.6,.9],270),
  {...anchor("sink","Single basin sink",[1.7,3.7],[.6,.5,.2],180),z:.8},
  anchor("fold","Folding station",[.45,3.7],[.9,.6,.9],180),anchor("fridge","Fridge",[3.65,.5],[.7,.7,1.8],270),
  {...anchor("light","Fluorescent tube light",[1.7,3.6],[1.2,.10,.08]),z:2.5},
  {...anchor("rack","Dish rack",[2.5,3.7],[.45,.35,.2],180),z:1},
  anchor("table","Square table",[2,1.5],[.9,.9,.74]),anchor("seat","Chair",[2,.85],[.43,.43,.9])
];
// Isolated assembly check: camera inputs above are tested separately with the full saved-plan exporter.
root.TURN_SUPABASE.setBuildMcp=true;
const shell={...structuredClone(scene),objects:kitchen.spatialPlan.anchors.map((a,i)=>({id:"anchor-"+i,anchorId:a.id,name:a.name,position:[...a.xy,a.z],rotation:[0,0,-a.facing*Math.PI/180],size:a.size,kind:"box",material:"dressing"}))};
shell.materials.dressing={baseColor:[.46,.34,.2]};
const kitchenOriginal=JSON.stringify(kitchen),assembled=root.KinolotSetKitchen.build(shell,{anchors:kitchen.spatialPlan.anchors,space:kitchen.spatialPlan.coordinates.spaces[0]});
ok(JSON.stringify(kitchen)===kitchenOriginal,"Kitchen construction does not rewrite saved measurements");
ok(assembled.objects.some(o=>o.name.includes("basin bottom"))&&assembled.objects.some(o=>o.name.includes("backed front reveal")),"Sink depth and backed cabinet fronts are real geometry");
ok(!assembled.objects.some(o=>o.name==="Sink run counter"),"The original solid counter proxy is replaced");
ok(assembled.previewLights.length===1,"Only the saved fluorescent fitting supplies this room's light");
root.turnContinuity={locations:[kitchen]};
const kitchenScene=root.KinolotCloudRender.buildScene(kitchen);
ok(kitchenScene.schema===contract.MCP_SCHEMA&&kitchenScene.objects.some(o=>o.name.includes("basin bottom")),"The full kitchen exporter uses the detailed construction");
const fixtureArg=process.argv.indexOf("--write-fixture");
if(fixtureArg>=0)writeFileSync(process.argv[fixtureArg+1],contract.canonical(scene));
const kitchenArg=process.argv.indexOf("--write-kitchen-fixture");
if(kitchenArg>=0)writeFileSync(process.argv[kitchenArg+1],contract.canonical(kitchenScene));
console.log("PASS detailed cloud sets:",checks,"format, geometry, camera, immutability and rollout checks");

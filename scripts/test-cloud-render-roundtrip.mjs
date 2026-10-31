/* Real local Blender, real HTTP transport and real PostgreSQL queue; test-only identity/storage.
   node scripts/test-cloud-render-roundtrip.mjs --worker-dir /path/to/worker [--preview]
   No cloud service, live project, credentials or generation provider is used. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawn} from "node:child_process";
import vm from "node:vm";
import {harness,owner,project,secret,contract} from "./cloud-render-test-harness.mjs";
const flag=process.argv.indexOf("--worker-dir");
if(flag<0)throw Error("Provide --worker-dir for the isolated worker source checkout");
const workerDir=resolve(process.argv[flag+1]),preview=process.argv.includes("--preview");
const waitForUI=process.argv.includes("--wait-for-ui");
const root=new URL("../",import.meta.url),read=p=>readFileSync(new URL(p,root),"utf8");
const h=await harness();let base="";
const sandbox={console,crypto,TextEncoder,URL,location:{hostname:"localhost"},turnIsAdmin:true,scenesInStoryOrder:x=>x||[],nbGetMeta:()=>null,nbGetImage:()=>""};sandbox.window=sandbox;
vm.createContext(sandbox);
for(const f of ["locations.jsx","blender-render-contract.js","blender-set-detail.js","blender-render.js"])vm.runInContext(read("app/"+f),sandbox);
const room={id:"roundtrip-room",key:"roundtrip-room",name:"Integration test room",spatialPlan:{frame:"Facing north",status:"reviewed",source:{assetId:"roundtrip-room",iso:""},
  anchors:[{id:"cabinet",name:"Cabinet",space:"Integration test room",placement:"Centre",xy:[0,0],z:3.5,size:[2,1,1],sizeBasis:"user"}],
  coordinates:{spaces:[{id:"roundtrip-room",name:"Integration test room",floorZ:3,ceilingH:3,footprint:[[-5,-5],[5,-5],[5,5],[2,5],[2,4],[-5,4]],
    openings:[{id:"door",name:"Door",kind:"door",centre:[0,-5],width:2,sillZ:3,headZ:5.2}]}],
    cameras:[{panel:"TL",position:[0,-4,4.6],yaw:0,pitch:-5,lensMm:24},{panel:"TR",position:[4,3.5,5.6],yaw:225,pitch:-12,lensMm:20},
      {panel:"BL",position:[-4,3,4.6],yaw:135,pitch:-8,lensMm:24},{panel:"BR",position:[0,3.5,4.6],yaw:180,pitch:-8,lensMm:24}].map(c=>({...c,spaceId:"roundtrip-room"}))}}};
sandbox.turnContinuity={locations:[room]};
const scene=sandbox.KinolotCloudRender.buildScene(room);
let submitted=waitForUI?null:await h.request("job.create",{projectId:project,locationId:room.id,requestId:crypto.randomUUID(),scene});
if(submitted)assert.equal(submitted.status,200);
h.storage.sign=async path=>base+"/artifact/"+encodeURIComponent(path);
const publicFiles=new Set(["app/locations.jsx","app/blender-render-contract.js","app/blender-set-detail.js","app/blender-render.js","app/blender-render-ui.jsx","app/blender-preview.css"]);
const html=()=>`<!doctype html><html><head><meta charset="utf-8"><title>Kinolot cloud preview — offline integration test</title>
<link rel="stylesheet" href="/app/blender-preview.css"><style>body{background:#18191d;color:#eee;font:15px system-ui;margin:36px auto;max-width:1050px;padding:0 18px}button{padding:9px 14px;background:#c4a66e;color:#151515;border:0;border-radius:5px;cursor:pointer}button:disabled{opacity:.4;cursor:default}.loc-layer-note{color:#aaa}.loc-spatial-error{color:#edb07c}small{display:block}.test-note{background:#30323a;padding:15px;border-radius:8px}</style>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script></head><body><h1>Cloud set preview</h1><p class="test-note">Offline integration proof: real local Blender and PostgreSQL, with test identity and test storage. This is not a live film or a cloud deployment.</p><div id="preview"></div>
<script>window.turnIsAdmin=true;window.nbGetMeta=()=>null;window.nbGetImage=()=>"";window.scenesInStoryOrder=x=>x||[];window.fixture=${JSON.stringify(room).replace(/</g,"\\u003c")};window.turnContinuity={locations:[window.fixture]};const scope={uid:${JSON.stringify(owner)},projectId:${JSON.stringify(project)},epoch:1};window.BlenderPreview={scope:()=>scope,isCurrent:s=>s.projectId===scope.projectId&&s.uid===scope.uid};window.sbClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:"owner-session",user:{id:scope.uid}}}})}});window.KINOLOT_RENDER_DEV_ENDPOINT=location.origin+"/render";</script>
<script src="/app/locations.jsx"></script><script src="/app/blender-render-contract.js"></script><script src="/app/blender-set-detail.js"></script><script src="/app/blender-render.js"></script><script type="text/babel" src="/app/blender-render-ui.jsx"></script>
<script type="text/babel">ReactDOM.createRoot(document.getElementById("preview")).render(React.createElement(LocationCloudRender,{location:window.fixture}));</script></body></html>`;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,base||"http://127.0.0.1");
    if(req.method==="POST"&&url.pathname==="/render"){
      const chunks=[];for await(const part of req)chunks.push(part);
      const reply=await h.service.handle(new Request(base+"/render",{method:"POST",headers:req.headers,body:Buffer.concat(chunks)}));
      res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));return;
    }
    if(url.pathname.startsWith("/artifact/")){
      const bytes=h.files.get(decodeURIComponent(url.pathname.slice(10)));res.writeHead(bytes?200:404,{"Content-Type":"image/png"});res.end(bytes?Buffer.from(bytes):"Missing test image");return;
    }
    const file=url.pathname.slice(1);
    if(publicFiles.has(file)){res.writeHead(200,{"Content-Type":file.endsWith("css")?"text/css":"text/javascript"});res.end(read(file));return;}
    if(url.pathname==="/"){res.writeHead(200,{"Content-Type":"text/html"});res.end(html());return;}
    res.writeHead(404);res.end();
  }catch(_){res.writeHead(500);res.end("Offline test server error");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));base="http://127.0.0.1:"+server.address().port;
const out="/private/tmp/kinolot-cloud-render-proof";mkdirSync(out,{recursive:true});
try{
  if(waitForUI){
    console.log("PREVIEW_READY "+base);
    for(let n=0;n<1200;n++){
      const job=await h.db.latest(project,room.id);
      if(job?.status==="queued"){submitted={body:{job:{id:job.id}}};break;}
      await new Promise(r=>setTimeout(r,250));
    }
    if(!submitted)throw Error("No preview request was submitted through the test UI");
  }
  const child=spawn("python3",["-B",resolve(workerDir,"cloud_worker.py"),"--once"],{cwd:workerDir,env:{...process.env,
    BLENDER_BIN:process.env.BLENDER_BIN||"/Applications/Blender.app/Contents/MacOS/Blender",BLENDER_RENDER_ENDPOINT:base+"/render",
    BLENDER_RENDER_WORKER_SECRET:secret,RENDER_OUTPUT_ROOT:out+"/worker-runs"},stdio:["ignore","pipe","pipe"]});
  let log="";child.stdout.on("data",x=>{log+=x;process.stdout.write(x);});child.stderr.on("data",x=>{log+=x;process.stderr.write(x);});
  const timer=setTimeout(()=>child.kill("SIGTERM"),1050000);
  const code=await new Promise((done,reject)=>{child.on("error",reject);child.on("exit",done);});clearTimeout(timer);
  writeFileSync(out+"/worker.log",log);assert.equal(code,0,"Real worker exits successfully");
  const result=(await h.request("job.get",{jobId:submitted.body.job.id})).body.job;
  assert.equal(result.status,"completed");assert.equal(Object.keys(result.result.images).length,12);
  for(const [name,url] of Object.entries(result.result.images)){
    const bytes=await (await fetch(url)).arrayBuffer();writeFileSync(out+"/"+name+".png",new Uint8Array(bytes));
  }
  writeFileSync(out+"/result.json",JSON.stringify({scope:"Offline HTTP/SQL integration with real local Blender; test identity/storage",scene,report:result.result.report,verifiedStoredImages:12},null,2));
  console.log("PASS real Blender → HTTP completion → PostgreSQL job → authenticated image read");
  if(preview){console.log("PREVIEW "+base);await new Promise(resolve=>process.once("SIGINT",resolve));}
}finally{server.close();await h.pg.close();}

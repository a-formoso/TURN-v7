/* Real rendered files -> Python worker client -> HTTP -> real PostgreSQL -> private test storage.
   This does not test the MCP transport or live Supabase. No real account or provider calls.
   node scripts/test-cloud-mcp-roundtrip.mjs --worker-dir /path/to/worker --render-dir /path/to/verified/render */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {harness,owner,project,secret,contract} from "./cloud-render-test-harness.mjs";
const arg=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error("Missing "+name);return resolve(process.argv[i+1]);};
const workerDir=arg("--worker-dir"),renderDir=arg("--render-dir");
const sourceText=readFileSync(resolve(renderDir,"input-scene.json"),"utf8"),scene=JSON.parse(sourceText);
contract.validateScene(scene);assert.equal(scene.schema,contract.MCP_SCHEMA);assert.equal(contract.canonical(scene),sourceText);
const h=await harness({mcpScenes:true,sceneStorage:true});
const made=await h.request("job.create",{projectId:project,locationId:"room",requestId:crypto.randomUUID(),scene});assert.equal(made.status,200);
const server=createServer(async(req,res)=>{
  try{
    if(req.method!=="POST"||req.url!=="/render"){res.writeHead(404);res.end();return;}
    const chunks=[];for await(const c of req)chunks.push(c);
    const response=await h.service.handle(new Request("http://127.0.0.1/render",{method:"POST",headers:req.headers,body:Buffer.concat(chunks)}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(_){res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
try{
  const endpoint="http://127.0.0.1:"+server.address().port+"/render";
  const code=String.raw`import base64,hashlib,json,sys
from pathlib import Path
cfg=json.load(sys.stdin);root=Path(cfg['worker']);out=Path(cfg['render'])
sys.path.insert(0,str(root));sys.path.insert(0,str(root/'benchmark'))
from verify_outputs import verify
from cloud_worker import Client,ServiceError
checked=verify(out);assert checked['status']=='passed'
client=Client(cfg['endpoint'],cfg['secret'])
job=client.request('worker.claim',claimToken='offline-real-file-mcp-claim-token-with-thirty-two-characters',sceneSchemas=['kinolot-blockout-test-v1','kinolot-cloud-set-v2'],sceneStorage=True)['job']
assert job['storeScene'] and job['sceneHash']==hashlib.sha256((out/'input-scene.json').read_bytes()).hexdigest()
client.upload_scene(job,out/'blockout.blend')
render=json.loads((out/'render-report.json').read_text());cameras=json.loads((out/'cameras.json').read_text())
visible=json.loads((out/'visible-objects.json').read_text())['panels']
report={'renderer':'cloud-mcp-v1','inputSha256':job['sceneHash'],'objects':checked['objects'],'width':640,'height':360,
        'blenderVersion':render['blenderVersion'],'wallSeconds':render['totalInBlenderSeconds'],'peakChildRssMiB':0,'cameras':cameras,
        'visibleObjects':{p:[item['objectId'] for item in visible[p]] for p in cameras}}
images={kind+'_'+p:base64.b64encode((out/(('material' if kind=='colour' else kind)+'_'+p+'.png')).read_bytes()).decode() for kind in ('colour','depth','id') for p in cameras}
body={'jobId':job['id'],'leaseToken':job['leaseToken'],'images':images,'report':report}
bad=dict(body,report=dict(report,visibleObjects=dict(report['visibleObjects'],TL=['not-in-source'])))
try:client.request('worker.complete',**bad)
except ServiceError as error:assert error.status==400
else:raise AssertionError('Unknown visible ID was accepted')
client.request('worker.heartbeat',jobId=job['id'],leaseToken=job['leaseToken'],progress='uploading')
assert client.request('worker.complete',**body)['ok']
assert client.request('worker.complete',**body)['ok']
print('Python worker upload and idempotent completion passed.')
`;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn("python3",["-B","-c",code],{stdio:["pipe","pipe","pipe"]});let output="";
    child.stdout.on("data",b=>output+=b);child.stderr.on("data",b=>output+=b);child.on("error",reject);
    child.on("exit",code=>code===0?resolve(output):reject(Error(output.slice(-4000))));
    child.stdin.end(JSON.stringify({worker:workerDir,render:renderDir,endpoint,secret}));
  });
  const found=await h.request("job.get",{jobId:made.body.job.id});assert.equal(found.status,200);
  const job=found.body.job;assert.equal(job.status,"completed");assert.equal(job.result.report.renderer,"cloud-mcp-v1");
  assert.equal(Object.keys(job.result.images).length,12);assert.equal(job.result.scene.sourceSceneHash,made.body.job.sceneHash);
  assert.equal(h.files.size,13);assert.ok([...h.files.keys()].every(p=>p.startsWith("_internal/blender-renders/"+owner+"/"+project+"/")));
  assert.equal((await h.request("job.get",{jobId:job.id},"other-session")).status,403);
  console.log(result.trim());console.log("PASS detailed HTTP roundtrip: actual scene and twelve rendered PNGs, private paths, visibility validation, source hash, access and safe completion retry.");
}finally{await new Promise(resolve=>server.close(resolve));await h.pg.close();}

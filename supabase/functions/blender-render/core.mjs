/* Cloud renderer transport: authenticated jobs, a single leased worker, and private results.
   Deliberately separate from the desktop pairing/Studio protocol. No model/provider calls. */
export class RenderError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const bad=(message,code="bad_request",status=400)=>new RenderError(status,code,message);
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const panels=["TL","TR","BL","BR"];
const imageNames=["colour","depth","id"].flatMap(kind=>panels.map(p=>kind+"_"+p));
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...CORS,"Content-Type":"application/json"}});
async function bodyJSON(request,max){
  const reader=request.body?.getReader();if(!reader)throw bad("A request is required.");
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw bad("The request is too large.","too_large",413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch(_){throw bad("Invalid request data.");}
  if(!body||typeof body!=="object"||Array.isArray(body))throw bad("Invalid request data.");return body;
}

export function createRenderService({auth,db,storage,contract,png,enabled=false,allowedUsers=[],workerSecret="",now=()=>Date.now()}={}){
  const allowed=new Set(allowedUsers);
  async function access(projectId,user,write=true){
    if(!uuid(projectId))throw bad("Invalid film identity.");
    const a=await auth.getProjectAccess(projectId,user);
    // Owner-only development pilot. Team rollout and a user render tariff are separate decisions.
    if(!a?.exists||a.ownerId!==user.id||!a.canWrite||(write&&a.canWrite!==true))throw bad("This preview requires the film owner's access.","forbidden",403);
    return a;
  }
  async function workerAccess(){
    if(!enabled||!workerSecret||!allowed.size)throw bad("Cloud rendering is not configured.","unavailable",503);
  }
  async function validActor(row){
    const actor=await auth.getUserById(row.actor_id);
    if(!actor||!allowed.has(actor.id))throw bad("The render owner no longer has access.","forbidden",403);
    const a=await access(row.project_id,actor);
    if(a.ownerId!==row.owner_id)throw bad("The film owner changed.","forbidden",403);
  }
  async function publicJob(row){
    if(!row)return null;
    const job={id:row.id,projectId:row.project_id,locationId:row.location_id,sceneHash:row.scene_hash,
      status:row.status,progress:row.progress,attempts:row.attempts,createdAt:row.created_at,
      updatedAt:row.updated_at,error:row.error||null,notes:row.scene.notes};
    if(row.status==="completed"){
      const images={};
      await Promise.all(Object.entries(row.result.images).map(async([name,path])=>{images[name]=await storage.sign(path,900);}));
      job.result={images,report:row.result.report,urlExpiresAt:new Date(now()+900000).toISOString()};
    }
    return job;
  }
  async function leased(body,{terminal=false}={}){
    if(!uuid(body.jobId)||typeof body.leaseToken!=="string"||body.leaseToken.length>160)throw bad("Invalid job lease.");
    const row=await db.get(body.jobId),leaseHash=await contract.hash(body.leaseToken);
    if(!row||row.lease_hash!==leaseHash||(!terminal&&row.status!=="running")||
      (row.status==="running"&&Date.parse(row.lease_expires_at)<=now()))throw bad("This job lease expired.","lease_expired",409);
    await validActor(row);return {row,leaseHash};
  }
  function reportFor(body,row){
    const r=body.report;
    if(!r||r.inputSha256!==row.scene_hash||r.objects!==row.scene.objects.length||r.width!==640||r.height!==360||
      typeof r.blenderVersion!=="string"||r.blenderVersion.length>40||
      !Number.isFinite(r.wallSeconds)||r.wallSeconds<0||r.wallSeconds>1000||
      !Number.isFinite(r.peakChildRssMiB)||r.peakChildRssMiB<0)throw bad("The render report does not match the requested set.");
    const cameras={};
    for(const p of panels){
      const a=r.cameras?.[p],c=row.scene.cameras[p],yaw=c.yaw*Math.PI/180,pitch=c.pitch*Math.PI/180;
      const direction=[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)];
      if(!a||a.width!==640||a.height!==360||a.sensorWidthMm!==36||!Number.isFinite(a.lensMm)||Math.abs(a.lensMm-c.lensMm)>0.001||
        !Array.isArray(a.position)||a.position.length!==3||!Array.isArray(a.direction)||a.direction.length!==3||
        a.position.some((v,i)=>!Number.isFinite(v)||Math.abs(v-c.position[i])>0.001)||
        a.direction.some((v,i)=>!Number.isFinite(v)||Math.abs(v-direction[i])>0.001))throw bad("A rendered camera does not match the requested view.");
      cameras[p]={position:a.position,direction:a.direction,lensMm:a.lensMm,sensorWidthMm:36,width:640,height:360};
    }
    return {inputSha256:r.inputSha256,objects:r.objects,width:640,height:360,blenderVersion:r.blenderVersion,
      wallSeconds:r.wallSeconds,peakChildRssMiB:r.peakChildRssMiB,cameras};
  }
  async function dispatch(body,user,isWorker){
    const action=body.action;
    if(action==="capabilities"&&!isWorker){
      await access(body.projectId,user);
      await db.latest(body.projectId,"__readiness_probe__");
      return {enabled:true,ownerPilot:true,width:640,height:360};
    }
    if(typeof action!=="string")throw bad("An action is required.");
    if(isWorker){
      if(action==="worker.claim"){
        if(typeof body.claimToken!=="string"||!/^[-_A-Za-z0-9]{32,128}$/.test(body.claimToken))throw bad("Invalid claim identity.");
        const leaseToken=body.claimToken,leaseHash=await contract.hash(leaseToken),row=await db.claim(leaseHash);
        if(!row)return {job:null};
        try{await validActor(row);}catch(e){await db.finish(row.id,leaseHash,"failed",null,"The film owner's access changed.");throw e;}
        return {job:{id:row.id,projectId:row.project_id,locationId:row.location_id,sceneJSON:contract.canonical(row.scene),sceneHash:row.scene_hash,leaseToken}};
      }
      if(action==="worker.heartbeat"){
        const {row,leaseHash}=await leased(body);
        if(!await db.touch(row.id,leaseHash,body.progress||"rendering"))throw bad("This job lease expired.","lease_expired",409);
        return {ok:true};
      }
      if(action==="worker.fail"){
        const {row,leaseHash}=await leased(body);
        await db.finish(row.id,leaseHash,"failed",null,"The set could not be rendered. Review the layout and submit a new request.");return {ok:true};
      }
      if(action==="worker.complete"){
        const {row,leaseHash}=await leased(body,{terminal:true});
        const report=reportFor(body,row),images=body.images;
        if(!images||Object.keys(images).length!==imageNames.length||Object.keys(images).some(k=>!imageNames.includes(k)))throw bad("Twelve matching camera images are required.");
        const decoded={},hashes={};
        for(const name of imageNames){
          if(typeof images[name]!=="string"||images[name].length>2800000)throw bad("Invalid camera image.");
          try{decoded[name]=png.decodePNG(images[name],640,360);}catch(_){throw bad("A camera image is not a valid matching PNG.");}
          hashes[name]=await storage.hashBytes(decoded[name]);
        }
        const completionHash=await contract.hash({hashes,report});
        if(row.status==="completed"){
          if(row.result.completionHash!==completionHash)throw bad("A different result was already saved.","result_conflict",409);
          return {ok:true};
        }
        if(row.status!=="running")throw bad("This render is no longer active.","lease_expired",409);
        const paths={},created=[];
        try{
          for(const name of imageNames){
            const path=`_internal/blender-renders/${row.owner_id}/${row.project_id}/${row.id}/${leaseHash}/${hashes[name]}-${name}.png`;
            const uploaded=await storage.put(path,decoded[name]);paths[name]=path;if(uploaded.created)created.push(path);
          }
          await validActor(row);
          await db.finish(row.id,leaseHash,"completed",{images:paths,report,completionHash},null);
        }catch(e){
          // A lost DB response can follow a successful commit. Never remove committed results.
          const current=await db.get(row.id).catch(()=>null);
          if(current?.status==="completed"&&current.result?.completionHash===completionHash)return {ok:true};
          if(current)await storage.remove(created).catch(()=>{});
          throw e;
        }
        return {ok:true};
      }
      throw bad("Unknown worker action.");
    }
    if(action.startsWith("worker."))throw bad("Worker authentication required.","unauthorized",401);
    if(action==="job.create"){
      const a=await access(body.projectId,user);
      if(!uuid(body.requestId)||typeof body.locationId!=="string"||!body.locationId||body.locationId.length>160)throw bad("Invalid render request.");
      if(!await auth.hasLocation(body.projectId,body.locationId))throw bad("Save this location in the cloud film before rendering it.","location_missing",409);
      try{contract.validateScene(body.scene);}catch(e){throw bad(e.message);}
      const hash=await contract.hash(body.scene);
      const row=await db.submit({project:body.projectId,owner:a.ownerId,actor:user.id,location:body.locationId,request:body.requestId,scene:body.scene,hash});
      return {job:await publicJob(row)};
    }
    if(action==="job.latest"){
      await access(body.projectId,user);
      if(typeof body.locationId!=="string"||body.locationId.length>160)throw bad("Invalid location.");
      return {job:await publicJob(await db.latest(body.projectId,body.locationId))};
    }
    if(!uuid(body.jobId))throw bad("Invalid job identity.");
    const row=await db.get(body.jobId);
    if(!row)throw bad("Render request not found.","not_found",404);
    if(body.projectId!==row.project_id)throw bad("Render request not found in this film.","not_found",404);
    await access(row.project_id,user);
    if(action==="job.get")return {job:await publicJob(row)};
    if(action==="job.cancel")return {job:await publicJob(await db.cancel(row.id))};
    throw bad("Unknown action.");
  }
  async function handle(request){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
    try{
      if(request.method!=="POST")throw bad("POST required.","method_not_allowed",405);
      if(!enabled||!allowed.size||workerSecret.length<32)throw bad("Cloud rendering is not enabled for this environment.","unavailable",503);
      const header=request.headers.get("authorization")||"",worker=/^Worker (.+)$/.exec(header);
      let user=null;
      if(worker){
        await workerAccess();
        if(await contract.hash(worker[1])!==await contract.hash(workerSecret))throw bad("Worker authentication required.","unauthorized",401);
      }else{
        const bearer=/^Bearer (\S+)$/.exec(header);
        user=bearer?await auth.getUserByAccessToken(bearer[1]):null;
        if(!user)throw bad("Sign in to render a set.","unauthorized",401);
        if(!allowed.has(user.id))throw bad("Cloud set previews are limited to the development pilot.","forbidden",403);
      }
      const body=await bodyJSON(request,worker?12582912:262144);
      return reply(await dispatch(body,user,!!worker));
    }catch(e){
      const safe=e instanceof RenderError?e:bad("The render service could not finish this request.","service_error",503);
      return reply({error:safe.message,code:safe.code},safe.status);
    }
  }
  return {handle};
}

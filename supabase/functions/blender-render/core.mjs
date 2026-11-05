/* Cloud renderer transport: authenticated jobs, a single leased worker, and private results.
   Deliberately separate from the desktop pairing/Studio protocol. No model/provider calls. */
export class RenderError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const bad=(message,code="bad_request",status=400)=>new RenderError(status,code,message);
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const panels=["TL","TR","BL","BR"];
const imageNames=["colour","depth","id"].flatMap(kind=>panels.map(p=>kind+"_"+p));
// CORS answers only the app's own hosts (https) and local development, as invite-collaborator does. The worker
// calls from a server, where CORS does not apply.
const APP_HOSTS=["kinolot.infinitestudioai.com","cinema.infinitestudioai.com","kinolot.replit.app"],DEV_HOSTS=["localhost","127.0.0.1","[::1]"];
export function corsFor(origin){
  const base={"Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store",Vary:"Origin"};
  let u;try{u=new URL(String(origin||""));}catch(_){u=null;}
  if(!u||u.origin!==String(origin))return base;
  const ok=APP_HOSTS.includes(u.hostname)&&u.protocol==="https:"&&!u.port||DEV_HOSTS.includes(u.hostname)&&/^https?:$/.test(u.protocol);
  return ok?{...base,"Access-Control-Allow-Origin":u.origin}:base;
}
const reply=(value,status=200,cors=corsFor(""))=>new Response(JSON.stringify(value),{status,headers:{...cors,"Content-Type":"application/json"}});
async function bodyJSON(request,max){
  const reader=request.body?.getReader();if(!reader)throw bad("A request is required.");
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw bad("The request is too large.","too_large",413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch(_){throw bad("Invalid request data.");}
  if(!body||typeof body!=="object"||Array.isArray(body))throw bad("Invalid request data.");return body;
}

/* BUILD THE SET FOR PAYING PLANS (owner 2026-11-05). With `open` (BLENDER_RENDER_OPEN=true) any Director or Producer
   account builds its own films' sets, and an Art director builds on a shared film with the owner paying within their
   budget — `billing` is blender-bridge's supabase-adapter (authorizeCredit: the plan gate, the film payer and the HOLD;
   releaseCredit; creditUnit). One build costs SET_BUILD_USD at the live credit unit (15 credits; app/pricing.jsx
   turnSetBuildCredits), held before queueing (ref "setbuild:<request id>:<scene>") and settled or given back by the
   job's own status (supabase/blender-render-billing.sql). One renderer builds one set at a time: the whole queue is
   capped at SET_BUILD_QUEUE_CAP. Without `open` this is the owner-only pilot: allowlisted accounts, their own films,
   no charge. */
export const SET_BUILD_USD=0.15;
export const SET_BUILD_QUEUE_CAP=12;
const BILLING_STATUS={insufficient_credits:402,owner_insufficient:402,budget_reached:402,account_frozen:402,
  tier_required:403,plan_required:403,owner_plan:403,film_role:403,team_paused:403,film_access:403};
export function createRenderService({auth,db,storage,contract,png,enabled=false,allowedUsers=[],workerSecret="",open=false,billing=null,now=()=>Date.now()}={}){
  const allowed=new Set(allowedUsers);
  const configured=()=>enabled&&workerSecret.length>=32&&(open?!!billing:allowed.size>0);
  async function access(projectId,user,write=true){
    if(!uuid(projectId))throw bad("Invalid film identity.");
    const a=await auth.getProjectAccess(projectId,user);
    if(!a?.exists)throw bad("This film wasn't found.","forbidden",403);
    if(a.ownerId===user.id&&a.canWrite===true)return a;
    // open: a collaborator whose role builds sets (Art director — turn_film_payer '3d'), or reads them (any member)
    if(open&&(write?a.canWrite===true:(a.canRead===true||a.canWrite===true)))return a;
    throw bad(open?"Your role on this film doesn't include building the set.":"This preview requires the film owner's access.","forbidden",403);
  }
  async function workerAccess(){
    if(!configured())throw bad("Cloud rendering is not configured.","unavailable",503);
  }
  async function validActor(row){
    const actor=await auth.getUserById(row.actor_id);
    if(!actor||(!open&&!allowed.has(actor.id)))throw bad("The render owner no longer has access.","forbidden",403);
    const a=await access(row.project_id,actor);
    if(a.ownerId!==row.owner_id)throw bad("The film owner changed.","forbidden",403);
  }
  async function price(){
    const unit=await billing.creditUnit();
    if(!(Number(unit)>0))throw bad("Credits can't be checked right now. Please try again in a minute.","billing_unavailable",503);
    return Math.max(1,Math.ceil(SET_BUILD_USD/unit-1e-9));
  }
  async function publicJob(row){
    if(!row)return null;
    const job={id:row.id,projectId:row.project_id,locationId:row.location_id,sceneHash:row.scene_hash,
      status:row.status,progress:row.progress,attempts:row.attempts,createdAt:row.created_at,
      updatedAt:row.updated_at,error:row.error||null,notes:row.scene.notes,
      credits:Number.isFinite(row.credits)?row.credits:null};
    if(row.status==="queued"&&db.ahead)job.queueAhead=await db.ahead(row).catch(()=>null);
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
  async function dispatch(body,user,isWorker,token=""){
    const action=body.action;
    if(action==="capabilities"&&!isWorker){
      const a=await access(body.projectId,user,false);
      await db.latest(body.projectId,"__readiness_probe__");
      return {enabled:true,ownerPilot:!open,open:!!open,width:640,height:360,queueCap:SET_BUILD_QUEUE_CAP,
        canBuild:a.ownerId===user.id||a.canWrite===true,credits:open?await price():0};
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
      const submit=hold=>db.submit({project:body.projectId,owner:a.ownerId,actor:user.id,location:body.locationId,request:body.requestId,scene:body.scene,hash,hold});
      if(!open)return {job:await publicJob(await submit(null))};
      // a request already queued answers as itself (a retried click), before any new hold
      const known=db.byRequest?await db.byRequest(user.id,body.requestId):null;
      if(known){
        if(known.project_id!==body.projectId||known.location_id!==body.locationId||known.scene_hash!==hash)
          throw bad("This request identity already belongs to another set revision.","request_conflict",409);
        return {job:await publicJob(known)};
      }
      if(db.activeCount&&await db.activeCount()>=SET_BUILD_QUEUE_CAP)
        throw bad("Many sets are being built right now. Try again in a few minutes — nothing was charged.","queue_busy",429);
      const credits=await price();
      const held=await billing.authorizeCredit({token,cost:credits,eventId:body.requestId+":"+hash.slice(0,16),
        projectId:body.projectId,ownerId:a.ownerId,refPrefix:"setbuild:",reason:"set-build"});
      if(!held||held.ok!==true){
        const code=String(held&&held.code||"billing_unavailable");
        const message=code==="tier_required"||code==="plan_required"?"Building the set needs the Director or Producer plan."
          :code==="insufficient_credits"?"Building the set needs "+credits+" credits, and this account doesn't have enough. Top up or change plan to build it."
          :String(held&&held.message||"Credits can't be checked right now. Please try again in a minute.");
        throw bad(message,code,BILLING_STATUS[code]||503);
      }
      if(!held.holdRef)throw bad("Credits can't be checked right now. Please try again in a minute.","billing_unavailable",503);
      try{return {job:await publicJob(await submit(held.holdRef))};}
      catch(e){
        // give the hold back unless the job exists after all (a lost answer after the insert)
        const made=db.byRequest?await db.byRequest(user.id,body.requestId).catch(()=>null):null;
        if(!made||made.hold_ref!==held.holdRef)await billing.releaseCredit({holdRef:held.holdRef}).catch(()=>{});
        throw e;
      }
    }
    if(action==="job.latest"){
      await access(body.projectId,user,false);
      if(typeof body.locationId!=="string"||body.locationId.length>160)throw bad("Invalid location.");
      return {job:await publicJob(await db.latest(body.projectId,body.locationId))};
    }
    if(!uuid(body.jobId))throw bad("Invalid job identity.");
    const row=await db.get(body.jobId);
    if(!row)throw bad("Render request not found.","not_found",404);
    if(body.projectId!==row.project_id)throw bad("Render request not found in this film.","not_found",404);
    await access(row.project_id,user,action!=="job.get");
    if(action==="job.get")return {job:await publicJob(row)};
    if(action==="job.cancel")return {job:await publicJob(await db.cancel(row.id))};
    throw bad("Unknown action.");
  }
  async function handle(request){
    const cors=corsFor(request.headers.get("origin"));
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
    try{
      if(request.method!=="POST")throw bad("POST required.","method_not_allowed",405);
      if(!configured())throw bad("Cloud rendering is not enabled for this environment.","unavailable",503);
      const header=request.headers.get("authorization")||"",worker=/^Worker (.+)$/.exec(header);
      let user=null;
      if(worker){
        await workerAccess();
        if(await contract.hash(worker[1])!==await contract.hash(workerSecret))throw bad("Worker authentication required.","unauthorized",401);
      }else{
        const bearer=/^Bearer (\S+)$/.exec(header);
        user=bearer?await auth.getUserByAccessToken(bearer[1]):null;
        if(!user)throw bad("Sign in to render a set.","unauthorized",401);
        if(!open&&!allowed.has(user.id))throw bad("Cloud set previews are limited to the development pilot.","forbidden",403);
      }
      const body=await bodyJSON(request,worker?12582912:262144);
      const token=worker?"":(/^Bearer (\S+)$/.exec(header)||[])[1]||"";
      return reply(await dispatch(body,user,!!worker,token),200,cors);
    }catch(e){
      const safe=e instanceof RenderError?e:bad("The render service could not finish this request.","service_error",503);
      return reply({error:safe.message,code:safe.code},safe.status,cors);
    }
  }
  return {handle};
}

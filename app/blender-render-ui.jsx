/* Step 4 · Build the set and step 5 · Style it of the location card (owner 2026-11-01: one numbered path per card),
   each reading the location's latest render. Open to paying plans since 2026-11-05 (supabase-config.js setBuild; the
   server holds 15 credits a build — Director and Producer, the owner or an Art director on a shared film); without
   that switch, the owner-only local pilot. */
function useCloudSetJob(location){
  const api=window.KinolotCloudRender,show=!!api&&api.enabled();
  const [job,setJob]=React.useState(null),[capable,setCapable]=React.useState(false),[busy,setBusy]=React.useState(false);
  const [message,setMessage]=React.useState(""),[sceneHash,setSceneHash]=React.useState(""),[refresh,setRefresh]=React.useState(0);
  // what the server says about this film: whether this account may build here, and a build's price (credits)
  const [caps,setCaps]=React.useState(null);
  // the story moment the set is built at (a moving part's state); step 4 and step 5 read the same choice
  const [,setMomentTick]=React.useState(0);
  React.useEffect(()=>{
    const h=e=>{if(e&&e.detail&&e.detail.locationId===location.id)setMomentTick(n=>n+1);};
    window.addEventListener("kinolot-set-moment",h);return ()=>window.removeEventListener("kinolot-set-moment",h);
  },[location.id]);
  const at=show&&api.buildMoment?api.buildMoment(location):null;
  let scope=null,scene=null,issues=[];
  try{if(show){scope=window.BlenderPreview.scope();issues=api.inputIssueList?api.inputIssueList(location):[];scene=api.buildScene(location,undefined,at);}}
  catch(e){if(!issues.length)issues=[{step:2,text:e.message}];}
  const scopeKey=scope?[scope.uid,scope.projectId,scope.epoch,location.id].join(":"):"";
  const sceneKey=scene?window.KinolotRenderContract.canonical(scene):"";
  const current=React.useRef({scopeKey,sceneKey});current.current={scopeKey,sceneKey};
  React.useEffect(()=>{
    let alive=true;setSceneHash("");
    if(sceneKey)window.KinolotRenderContract.hash(sceneKey).then(h=>{if(alive)setSceneHash(h);});
    return ()=>{alive=false;};
  },[sceneKey]);
  React.useEffect(()=>{
    if(!show||!scopeKey)return;
    let alive=true,timer=null,misses=0;
    const s=scope,key=scopeKey;
    const valid=()=>alive&&current.current.scopeKey===key&&window.BlenderPreview.isCurrent(s);
    setJob(null);setCapable(false);setMessage("");setBusy(false);setCaps(null);
    async function load(first){
      try{
        if(first){const cap=await api.request("capabilities",{projectId:s.projectId},s);if(!valid())return;setCaps(cap||null);}
        const result=await api.request("job.latest",{projectId:s.projectId,locationId:location.id},s);
        if(!valid())return;setJob(result.job);setMessage("");setCapable(true);misses=0;
        // Poll read-only status while work runs. Refresh completed signed URLs before expiry too.
        timer=setTimeout(()=>load(false),result.job&&["queued","running"].includes(result.job.status)?5000:600000);
      }catch(e){if(valid()){
        setMessage(e.message);
        if(!first)timer=setTimeout(()=>load(false),Math.min(60000,5000*2**Math.min(misses++,4)));
      }}
    }
    load(true);
    return ()=>{alive=false;clearTimeout(timer);};
  },[show,scopeKey,refresh]);
  const stale=!!job&&!!sceneHash&&job.sceneHash!==sceneHash;
  // the card's step guide shows whether the set is built and current
  React.useEffect(()=>{
    if(!show||!api.noteJob)return;
    api.noteJob(location.id,job?{status:job.status,current:job.status==="completed"&&!!sceneHash&&!stale&&!issues.length}:null);
  },[show,location.id,job&&job.id,job&&job.status,sceneHash,stale,issues.length]);
  return {api,show,scope,scene,issues,scopeKey,sceneKey,current,job,setJob,capable,busy,setBusy,message,setMessage,sceneHash,stale,at,caps,
    refresh:()=>setRefresh(n=>n+1)};
}
// "Go to step N" — the card's numbered folds open and scroll on nb-open-fold (CardFold)
function goToLocationStep(location,step){
  const id=typeof locationStepFoldId==="function"?locationStepFoldId(location,step):"";
  if(id)window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:id}));
}
const LOCATION_STEP_NAMES={1:"Describe",2:"Floor plan",3:"Cameras",4:"Build the set",5:"Style it"};
// What stops the build, each with the step that fixes it.
function cloudFixList(location,issues){
  const E=React.createElement;
  return E("div",{className:"loc-step-fixes",role:"alert"},
    E("p",{className:"loc-step-fixes-head"},"Before you can build, fix "+(issues.length===1?"this":"these")+":"),
    E("ul",null,issues.slice(0,6).map((issue,i)=>E("li",{key:i},
      E("span",null,issue.text),
      E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>goToLocationStep(location,issue.step)},
        "Go to "+issue.step+" · "+LOCATION_STEP_NAMES[issue.step])))),
    issues.length>6&&E("p",{className:"loc-layer-note"},"…and "+(issues.length-6)+" more."));
}
function LocationCloudRender({location,readOnly=false}){
  const c=useCloudSetJob(location),{api,show,scope,scene,issues,scopeKey,sceneKey,current,job,busy,sceneHash,stale,caps}=c;
  const [now,setNow]=React.useState(0),[lastSeconds,setLastSeconds]=React.useState(0);
  const runningSince=React.useRef({});
  async function submit(){
    if(busy||!scope||!scene||!sceneHash)return;
    const key=scopeKey,revision=sceneKey,s=scope;
    c.setBusy(true);c.setMessage("");
    try{
      const requestId=api.requestIdentity(s,location.id,sceneHash,job&&["completed","failed","cancelled"].includes(job.status)?job.id:"");
      const result=await api.request("job.create",{projectId:s.projectId,locationId:location.id,requestId,scene},s);
      if(current.current.scopeKey!==key||current.current.sceneKey!==revision)return;
      c.setJob(result.job);c.refresh();
    }catch(e){if(current.current.scopeKey===key)c.setMessage(e.message);}
    finally{if(current.current.scopeKey===key)c.setBusy(false);}
  }
  async function cancel(){
    if(!job||busy)return;const key=scopeKey,s=scope;
    c.setBusy(true);
    try{const result=await api.request("job.cancel",{jobId:job.id,projectId:s.projectId},s);if(current.current.scopeKey===key)c.setJob(result.job);}
    catch(e){if(current.current.scopeKey===key)c.setMessage(e.message);}
    finally{if(current.current.scopeKey===key)c.setBusy(false);}
  }
  const running=job&&["queued","running"].includes(job.status);
  // A ticking clock while a render runs, and this location's last render time for the next estimate.
  React.useEffect(()=>{
    if(!running)return;setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);
  },[running,job&&job.id]);
  React.useEffect(()=>{if(job&&job.status==="completed"&&job.result)setLastSeconds(job.result.report.wallSeconds);},[job&&job.id,job&&job.status]);
  if(!show)return null;
  const E=React.createElement,labels={TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  // the price: the server's own answer for this film once read, else the app's table (app/pricing.jsx)
  const paid=!!(caps&&caps.open),credits=paid?(Number(caps.credits)>0?Number(caps.credits)
    :(typeof window.turnSetBuildCredits==="function"?window.turnSetBuildCredits():0)):0;
  const canBuild=!caps||caps.canBuild!==false;
  const chip=paid&&credits>0&&E("span",{className:"nb-cost","data-testid":"set-build-cost",
    title:"≈ "+credits+" generation credits a build — held when it's queued, charged when the four views arrive, given back if it fails or you cancel"},String(credits));
  return E("section",{className:"loc-cloud-render","data-testid":"location-cloud-render"},
    E("p",{className:"loc-layer-note"},paid
      ?"Builds the room in 3D from the floor plan and cameras, and renders the four views — a plain blockout that keeps every shot's layout consistent; step 5 styles it. Separate from the location image."
      :"Builds the room in 3D from the floor plan and cameras, and renders the four views. Free during the pilot; separate from the location image."),
    !canBuild&&E("p",{className:"loc-layer-note","data-testid":"set-build-role"},"The film's owner or its Art director builds the set; you can see what they built."),
    issues.length>0&&cloudFixList(location,issues),
    momentPicker(location,api,readOnly||busy||!!running),
    E("div",{className:"loc-cloud-render-actions"},
      E("button",{type:"button",className:"art-draftall",disabled:readOnly||!canBuild||busy||!c.capable||!sceneHash||!!running||issues.length>0,onClick:submit},
        busy?"Sending…":job&&job.status==="completed"?"Rebuild set":"Build set",!busy&&chip),
      running&&E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||!canBuild||busy,onClick:cancel,
        title:paid?"Stop this build \u2014 its credits are given back":undefined},"Cancel")),
    running&&renderProgress(job,{now,started:runningSince.current,objects:scene?scene.objects.length:0,lastSeconds,api}),
    job&&!running&&job.status!=="completed"&&E("p",{role:"status",className:"loc-layer-note"},({failed:(job.error||"The render did not finish.")+(paid&&job.credits?" Its credits were given back.":""),
      cancelled:"Request cancelled."+(paid&&job.credits?" Its credits were given back.":"")})[job.status]),
    job&&job.status==="completed"&&(stale||issues.length>0)&&E("p",{className:"loc-spatial-error"},"These views are from another version of the set: an earlier floor plan or cameras, or another moment's moving parts. Rebuild to see the current ones."),
    c.message&&E("p",{role:"alert",className:"loc-spatial-error"},c.message),
    job?.result&&E("div",{className:"loc-cloud-render-grid"},["TL","TR","BL","BR"].map(p=>E("figure",{key:p},
      E("img",{src:job.result.images["colour_"+p],alt:labels[p]+" camera view of "+(location.name||"this location")}),
      E("figcaption",null,labels[p]+" · facing "+Math.round((Math.atan2(job.result.report.cameras[p].direction[0],job.result.report.cameras[p].direction[1])*180/Math.PI+360)%360)+"°")))),
    job?.result&&E("small",{className:"loc-layer-note"},"Rendered in "+Math.round(job.result.report.wallSeconds)+" seconds."),
    job?.notes?.length>0&&E("details",null,E("summary",null,"Render notes"),E("ul",{tabIndex:0,"aria-label":"Saved render notes"},job.notes.map((note,i)=>E("li",{key:i},note)))));
}
/* Moving parts (2026-11-01): which story moment the set is built at. Only shown when a part of this set moves. */
function momentPicker(location,api,disabled){
  const list=api.buildMoments?api.buildMoments(location):[];
  if(list.length<2)return null;
  const E=React.createElement,at=api.buildMoment(location);
  const key=at?[at.sceneId,at.beatN,at.moment].join(":"):"";
  return E("label",{className:"loc-cam-field loc-cloud-moment"},E("span",null,"Build at"),
    E("select",{className:"prop-select",value:key,disabled,onChange:e=>api.setBuildMoment(location.id,e.target.value)},
      list.map(m=>E("option",{key:m.key,value:m.key},m.label))),
    E("small",null,"The moving parts are built as they are at that moment. Styled in step 5, it becomes that state's own image, which shots at those moments use; the usual state makes the location image."));
}
/* Step 5 · Style it: the image-model look over the built set; it needs a current build from step 4. */
function LocationStyleStep({location,readOnly=false}){
  const c=useCloudSetJob(location);
  if(!c.show)return null;
  const E=React.createElement,ready=c.job&&c.job.status==="completed"&&c.job.result&&!c.stale&&!c.issues.length;
  // built at a story moment: the styled draft becomes that moving-part state's own image, never the location image
  let target=location.id;
  if(c.at&&typeof window.locationMovingPartsAt==="function"){
    const states=window.locationMovingPartsAt(location,c.at);
    const key=window.locationPartStateKey(states);
    if(key)target={loc:location.id,at:c.at,key,label:window.locationPartStateLabel(states)};
  }
  if(!c.capable)return E("p",{className:"loc-layer-note"},c.message||"Checking the built set…");
  if(!ready)return E("div",{className:"loc-step-fixes"},
    E("p",{className:"loc-step-fixes-head"},c.job&&c.job.status==="completed"?"Rebuild the set first: its views are from an earlier floor plan or cameras.":"Build the set first."),
    E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>goToLocationStep(location,4)},"Go to 4 · Build the set"));
  return window.LocationSetStyle?E(window.LocationSetStyle,{key:c.scopeKey+":"+(target.key||""),location,target,job:c.job,sceneHash:c.sceneHash,readOnly}):null;
}
/* How long is left: queued (one worker renders one set at a time), then rendering against an estimate from the set's
   size or this location's last render, then saving. The bar never claims 100% before the views are saved. */
function renderProgress(job,{now,started,objects,lastSeconds,api}){
  const E=React.createElement,clock=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
  const created=Date.parse(job.createdAt)||now||0,t=now||created;
  // Render time counts from when this page saw the job leave the queue; a job found already running (a reload, another
  // device) counts from its request, which is close while the queue is short.
  if(job.status==="queued")started[job.id]="queued";
  else if(started[job.id]==="queued")started[job.id]=now?Math.max(created,now):0;
  if(job.status==="running"&&!started[job.id])started[job.id]=created;
  const estimate=api.estimateSeconds(objects,lastSeconds);
  let pct=0,text;
  if(job.status==="queued"){
    // its place in the line (the server counts the build rendering now and those queued before it)
    const ahead=Number.isFinite(job.queueAhead)?job.queueAhead:null;
    const wait=ahead!=null&&ahead>0?" "+ahead+" set"+(ahead===1?" is":"s are")+" ahead of yours, about "+Math.max(1,Math.round(ahead*estimate/60))+" min.":"";
    text="Waiting for the renderer — it builds one set at a time."+wait+" "+clock(Math.max(0,(t-created)/1000))+" so far; rendering then takes about "+Math.max(1,Math.round(estimate/60))+" min.";
  }else if(job.progress==="uploading"){
    pct=96;text="Saving the four camera views — almost done.";
  }else{
    const elapsed=Math.max(0,(t-started[job.id])/1000);
    pct=Math.min(95,Math.round(elapsed/estimate*100));
    text=elapsed<=estimate?"Rendering · "+clock(elapsed)+" of about "+clock(estimate)+". You can leave and come back."
      :"Taking longer than usual · "+clock(elapsed)+" so far. It is still rendering.";
  }
  return E("div",{className:"loc-cloud-progress",role:"status"},
    E("div",{className:"loc-cloud-progress-bar",role:"progressbar","aria-label":"Set render progress","aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":pct},
      E("span",{style:{width:pct+"%"}})),
    E("p",{className:"loc-layer-note"},text));
}
window.LocationCloudRender=LocationCloudRender;window.LocationStyleStep=LocationStyleStep;window.goToLocationStep=goToLocationStep;

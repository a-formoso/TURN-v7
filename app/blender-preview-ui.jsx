const _bpEl = React.createElement;
function bpNumber(value, fallback){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function bpClamp(value, min, max){
  return Math.min(max, Math.max(min, bpNumber(value, min)));
}
function bpArray(value, fallback){
  return Array.isArray(value) && value.length===3
    ? value.map((x,i)=>bpNumber(x,fallback[i])) : fallback.slice();
}
function bpError(error, fallback){
  return String((error&&error.message)||error||fallback||"Blender bridge request failed.");
}
function bpProtectedError(error){
  const code=String(error&&error.code||"");
  return Number(error&&error.status)===401||Number(error&&error.status)===403||/BLENDER_HTTP_(401|403)/.test(code);
}
function bpJob(value){
  return value && value.job ? value.job : value;
}
function bpDataUrl(job){
  if(!job) return "";
  if(typeof job.previewDataUrl==="string" && job.previewDataUrl) return job.previewDataUrl;
  if(typeof job.pngBase64==="string" && job.pngBase64)
    return job.pngBase64.indexOf("data:")===0 ? job.pngBase64 : "data:image/png;base64,"+job.pngBase64;
  return "";
}
function bpCanonical(value,BP){
  try{
    if(BP && typeof BP.canonical==="function") return BP.canonical(value);
  }catch(_e){}
  try{ return JSON.stringify(value); }catch(_e){ return ""; }
}
function bpFallbackSpec(){
  return {
    room:{width:12,depth:12,height:4},
    camera:{position:[0,-6,1.65],target:[0,0,1.4],focalLength:50,sensorWidth:36},
    render:{width:640,height:360,samples:16}
  };
}
function bpScopeNow(BP){
  if(!BP || typeof BP.scope!=="function") return null;
  try{
    const value=BP.scope();
    return value && value.projectId && value.uid ? value : null;
  }catch(_e){ return null; }
}
function bpSameScope(BP,scope){
  if(!scope || !BP) return false;
  try{ return typeof BP.isCurrent!=="function" || BP.isCurrent(scope)!==false; }
  catch(_e){ return false; }
}
function bpCopy(text){
  if(!text) return Promise.resolve(false);
  if(navigator.clipboard && navigator.clipboard.writeText)
    return navigator.clipboard.writeText(text).then(()=>true).catch(()=>false);
  try{
    const input=document.createElement("textarea");
    input.value=text; input.setAttribute("readonly",""); input.style.position="fixed";
    input.style.opacity="0"; document.body.appendChild(input); input.select();
    const ok=document.execCommand("copy"); document.body.removeChild(input);
    return Promise.resolve(ok);
  }catch(_e){ return Promise.resolve(false); }
}
function BlenderAddonDownload(){
  const [state,setState]=React.useState({error:false,message:""});
  const download=event=>{
    event.preventDefault(); event.stopPropagation();
    let bytes;
    try{
      const data=window.CinemaMachineBlenderAddon;
      if(!data || data.filename!=="cinema-machine-blender.zip" ||
          !Number.isInteger(data.byteLength) || data.byteLength<22 || data.byteLength>8*1024*1024 ||
          typeof data.base64!=="string" || data.base64.length>12*1024*1024)
        throw new Error("Missing or invalid installer data");
      bytes=Uint8Array.from(atob(data.base64),char=>char.charCodeAt(0));
      if(bytes.length!==data.byteLength || bytes[0]!==0x50 || bytes[1]!==0x4b || bytes[2]!==3 || bytes[3]!==4)
        throw new Error("Invalid installer ZIP");
    }catch(_error){
      setState({error:true,message:"The add-on file is unavailable or incomplete. Save your work, then reopen Cinema Machine in its own browser tab and try again."});
      return;
    }
    let blobUrl="";
    try{
      blobUrl=URL.createObjectURL(new Blob([bytes],{type:"application/zip"}));
      // A normal document link can be intercepted as preview navigation.
      // Keep the detached Blob click inside the user's original gesture: no
      // fetch or await, which can also lose download permission in Safari.
      const link=document.createElement("a");
      link.href=blobUrl; link.download="cinema-machine-blender.zip";
      link.click();
      const releaseUrl=blobUrl; blobUrl="";
      setTimeout(()=>URL.revokeObjectURL(releaseUrl),60000);
      setState({error:false,message:"Download requested. Look for cinema-machine-blender.zip in your Downloads folder. If no file appears, open Cinema Machine in its own browser tab on your computer and try again."});
    }catch(_error){
      setState({error:true,message:"Your browser could not save the add-on. Open Cinema Machine in its own browser tab on your computer, then try again."});
    }finally{
      if(blobUrl) URL.revokeObjectURL(blobUrl);
    }
  };
  return _bpEl(React.Fragment,null,
    _bpEl("button",{type:"button",className:"char-draft-btn ghost bp-download","data-testid":"blender-addon-download",
      onClick:download},"Download add-on ZIP"),
    state.message && _bpEl("p",{className:"bp-help"+(state.error?" bp-download-error":""),
      role:state.error?"alert":"status","data-testid":"blender-addon-download-status"},state.message));
}
function BlenderPreviewPanel({ shot, scene, location, subjects, props, readOnly, onUpdate }){
  const BP=typeof window!=="undefined" ? window.BlenderPreview : null;
  const alive=React.useRef(true);
  const scopeRef=React.useRef(null);
  const activeRun=React.useRef(null);
  const runJobRef=React.useRef(null);
  const handledJobs=React.useRef({});
  const cancelledJobs=React.useRef({});
  const operationRef=React.useRef(0);
  const liveRef=React.useRef({});
  const requestPendingRef=React.useRef(false);
  const specErrorRef=React.useRef("");
  const propLensRef=React.useRef(null);
  const renderedSnapshotRef=React.useRef(null);
  const renderedShotRef=React.useRef(shot&&shot.id);
  const renderedReadOnlyRef=React.useRef(!!readOnly);
  const lastShotId=React.useRef(shot&&shot.id);
  const [scope,setScope]=React.useState(()=>bpScopeNow(BP));
  const [scopeError,setScopeError]=React.useState("");
  const [configError,setConfigError]=React.useState("");
  const [capabilities,setCapabilities]=React.useState(null);
  const [capError,setCapError]=React.useState("");
  const [connection,setConnection]=React.useState(null);
  const [job,setJob]=React.useState(null);
  const [jobError,setJobError]=React.useState("");
  const [pair,setPair]=React.useState(null);
  const [pairError,setPairError]=React.useState("");
  const [pairCopied,setPairCopied]=React.useState(false);
  const [endpointCopied,setEndpointCopied]=React.useState(false);
  const [setupOpen,setSetupOpen]=React.useState(true);
  const [preview,setPreview]=React.useState(null);
  const [previewError,setPreviewError]=React.useState("");
  const [saveFailure,setSaveFailure]=React.useState(null);
  const [saving,setSaving]=React.useState(false);
  const [requestPending,setRequestPending]=React.useState(false);
  const [loaded,setLoaded]=React.useState(false);
  const [notice,setNotice]=React.useState("");
  const [config,setConfig]=React.useState(null);
  const configRef=React.useRef(null);
  const invalidate=()=>{
    operationRef.current+=1;
    activeRun.current=null; requestPendingRef.current=false;
    setRequestPending(false); setSaving(false);
    return operationRef.current;
  };
  const source=React.useMemo(()=>({shot,scene,location,subjects:subjects||[],props:props||[]}),
    [shot,scene,location,subjects,props]);
  const baseSpec=React.useMemo(()=>{
    if(!BP || typeof BP.buildSpec!=="function"){
      specErrorRef.current="The Blender scene client is unavailable."; return null;
    }
    try{
      const value=BP.buildSpec(source);
      specErrorRef.current=value ? "" : "The Blender scene client returned no preview specification.";
      return value||null;
    }catch(error){ specErrorRef.current=bpError(error,"This shot cannot be prepared for Blender preview."); return null; }
  },[BP,source]);
  const initialConfig=React.useMemo(()=>{
    const fallback=bpFallbackSpec(), room=(baseSpec&&baseSpec.room)||fallback.room;
    const camera=(baseSpec&&baseSpec.camera)||fallback.camera;
    return {
      room:{
        width:bpNumber(room.width,fallback.room.width),
        depth:bpNumber(room.depth,fallback.room.depth),
        height:bpNumber(room.height,fallback.room.height)
      },
      position:bpArray(camera.position,fallback.camera.position),
      target:bpArray(camera.target,fallback.camera.target),
      lens:bpClamp(camera.focalLength,8,200)
    };
  },[baseSpec]);
  React.useEffect(()=>{
    if(lastShotId.current!==shot.id || !configRef.current){
      lastShotId.current=shot.id;
      configRef.current=initialConfig;
      setConfig(initialConfig);
    }
    const nextLens=baseSpec&&baseSpec.camera&&Number(baseSpec.camera.focalLength);
    const previousLens=propLensRef.current;
    if(Number.isFinite(nextLens) && previousLens!==null && previousLens!==nextLens &&
      configRef.current && Number(configRef.current.lens)===Number(previousLens)){
      const next={...configRef.current,lens:nextLens};
      configRef.current=next; setConfig(next);
    }
    if(Number.isFinite(nextLens)) propLensRef.current=nextLens;
  },[shot.id,initialConfig,baseSpec]);
  if(!config) configRef.current=initialConfig;
  const liveConfig=config||initialConfig;
  const buildSpec=React.useCallback((cfg)=>{
    if(!BP || typeof BP.buildSpec!=="function"){
      specErrorRef.current="The Blender scene client is unavailable."; return null;
    }
    try{
      const value=BP.buildSpec(source,{
        room:{...cfg.room},
        camera:{position:cfg.position.slice(),target:cfg.target.slice(),focalLength:cfg.lens}
      });
      specErrorRef.current=value ? "" : "The Blender scene client returned no preview specification.";
      return value||null;
    }catch(error){ specErrorRef.current=bpError(error,"This shot layout is invalid for Blender preview."); return null; }
  },[BP,source,baseSpec]);
  const spec=React.useMemo(()=>buildSpec(liveConfig),[buildSpec,liveConfig]);
  const specSnapshot=React.useMemo(()=>bpCanonical(spec,BP),[BP,spec]);
  liveRef.current={shotId:shot&&shot.id,readOnly:!!readOnly,buildSpec,configSnapshot:specSnapshot};
  React.useEffect(()=>{ setConfigError(specErrorRef.current||""); },[spec,specSnapshot]);
  React.useEffect(()=>{
    const changed=renderedSnapshotRef.current!==null && renderedSnapshotRef.current!==specSnapshot;
    const shotChanged=renderedShotRef.current!==shot.id;
    const modeChanged=renderedReadOnlyRef.current!==!!readOnly;
    if(changed||shotChanged||modeChanged) invalidate();
    renderedSnapshotRef.current=specSnapshot;
    renderedShotRef.current=shot.id; renderedReadOnlyRef.current=!!readOnly;
  },[specSnapshot,shot.id,readOnly]);
  const [specHash,setSpecHash]=React.useState("");
  React.useEffect(()=>{
    let active=true;
    if(!spec || !BP || typeof BP.hashSpec!=="function"){
      setSpecHash(""); return()=>{active=false;};
    }
    try{
      const value=BP.hashSpec(spec);
      Promise.resolve(value).then(hash=>{ if(active) setSpecHash(String(hash||specSnapshot)); })
        .catch(()=>{ if(active) setSpecHash(""); });
    }catch(_e){ setSpecHash(""); }
    return()=>{active=false;};
  },[BP,spec,specSnapshot]);
  const updateConfig=React.useCallback((kind,index,value)=>{
    setConfig(previous=>{
      const next={...(previous||initialConfig)};
      if(kind==="room") next.room={...next.room,[index]:bpClamp(value,index==="height"?2:2,index==="height"?12:50)};
      else if(kind==="lens") next.lens=bpClamp(value,8,200);
      else{
        const values=(next[kind]||[]).slice(); values[index]=bpClamp(value,-100,100); next[kind]=values;
      }
      configRef.current=next; return next;
    });
  },[initialConfig]);
  const editLens=React.useCallback((value)=>{
    const mm=Math.round(bpClamp(value,8,200));
    updateConfig("lens",null,mm);
    if(!readOnly && typeof onUpdate==="function" && shot && shot.id){
      onUpdate(shot.id,{lens:String(mm),cameraSettings:{
        ...(shot.cameraSettings||{}),focalLength:String(mm)
      }});
    }
  },[onUpdate,readOnly,shot,updateConfig]);
  const freshScope=React.useCallback(()=>{
    const next=bpScopeNow(BP);
    if(scopeRef.current && (!next || scopeRef.current.projectId!==next.projectId || scopeRef.current.uid!==next.uid || scopeRef.current.epoch!==next.epoch)){
      invalidate();
      setJob(null); setConnection(null); setPreviewError("The film changed; this preview was not applied.");
    }
    if(!next){ setScopeError("Blender preview requires a saved cloud film."); return null; }
    scopeRef.current=next; setScope(next); setScopeError(""); return next;
  },[BP]);
  const guardFor=React.useCallback((run)=>{
    const live=liveRef.current;
    if(!alive.current || !run || operationRef.current!==run.generation || activeRun.current!==run ||
      live.readOnly || !BP ||
      live.shotId!==run.shotId || !bpSameScope(BP,run.scope)) return false;
    const current=bpScopeNow(BP);
    if(!current || current.projectId!==run.scope.projectId || current.uid!==run.scope.uid || (run.scope.epoch!=null && current.epoch!==run.scope.epoch)) return false;
    let currentSnapshot="";
    try{
      const currentSpec=live.buildSpec(configRef.current||liveConfig);
      if(!currentSpec) return false;
      currentSnapshot=bpCanonical(currentSpec,BP);
    }catch(_e){ return false; }
    return !!run.specHash && currentSnapshot===run.specSnapshot;
  },[BP,liveConfig]);
  const acceptJob=React.useCallback((candidate,run,recovery=false)=>{
    const next=bpJob(candidate);
    if(!next || !next.id) return null;
    if(cancelledJobs.current[next.id]) return null;
    if(recovery && run&&run.specSnapshot&&liveRef.current.configSnapshot!==run.specSnapshot) return null;
    const requested=next.spec||{};
    const projectId=requested.projectId || (run&&run.scope&&run.scope.projectId);
    const shotId=requested.shotId;
    const currentScope=(run&&run.scope)||scopeRef.current;
    if(!currentScope || projectId!==currentScope.projectId || (shotId && shotId!==shot.id)){
      if(alive.current) setJobError("Ignored a Blender job scoped to another film or shot.");
      return null;
    }
    if(alive.current) setJob(next);
    return next;
  },[shot.id]);
  React.useEffect(()=>{
    alive.current=true;
    const next=bpScopeNow(BP); scopeRef.current=next; setScope(next);
    return()=>{ alive.current=false; };
  },[BP,shot.id]);
  React.useEffect(()=>{
    if(!BP || typeof BP.request!=="function") return;
    let active=true;
    const check=async()=>{
      const s=bpScopeNow(BP);
      if(!s){ if(active) setCapError("Save the film to check Blender bridge capabilities."); return; }
      const generation=operationRef.current;
      try{
        const result=await BP.request("capabilities",{},s,()=>active&&operationRef.current===generation&&bpSameScope(BP,s));
        if(active&&operationRef.current===generation){ setCapabilities(result&&result.capabilities||result||{}); setCapError(""); }
      }catch(error){ if(active&&operationRef.current===generation) setCapError(bpError(error,"Could not read Blender bridge capabilities.")); }
    };
    check();
    return()=>{active=false;};
  },[BP,shot.id]);
  React.useEffect(()=>{
    if(!BP || typeof BP.loadPreview!=="function") return;
    let active=true;
    const load=async()=>{
      const s=bpScopeNow(BP);
      if(!s){ if(active) setLoaded(true); return; }
      const generation=operationRef.current;
      try{
        const result=await BP.loadPreview(shot.id,s);
        if(active && operationRef.current===generation && result && result.url){
          setPreview({url:result.url,meta:result.meta||{},source:"saved"});
        }
      }catch(error){ if(active&&operationRef.current===generation) setPreviewError(bpError(error,"Saved Blender preview could not be loaded.")); }
      finally{ if(active&&operationRef.current===generation) setLoaded(true); }
    };
    load();
    return()=>{active=false;};
  },[BP,shot.id]);
  React.useEffect(()=>{
    if(readOnly || !BP || typeof BP.request!=="function") return;
    let active=true, timer=null;
    const tick=async()=>{
      const s=bpScopeNow(BP);
      if(!s){ if(active) setConnection(null); return; }
      const generation=operationRef.current;
      try{
        const result=await BP.request("connection.get",{projectId:s.projectId},s,
          ()=>active&&operationRef.current===generation&&bpSameScope(BP,s));
        if(!active) return;
        if(operationRef.current!==generation){ timer=setTimeout(tick,3000); return; }
        const value=result&&result.connection ? result.connection : result;
        setConnection(value||null);
        if(value && value.job){
          const recoveredRun={scope:s,shotId:shot.id,generation,specHash:value.job.specHash||"",
            specSnapshot:value.job.spec ? bpCanonical(value.job.spec,BP) : ""};
          const recovered=acceptJob(value.job,recoveredRun,true);
          if(recovered && !activeRun.current){ activeRun.current=recoveredRun; }
          if(recovered && recovered.status==="completed" && !handledJobs.current[recovered.id]){
            handledJobs.current[recovered.id]=true;
            if(runJobRef.current) await runJobRef.current(recovered,recoveredRun);
          }
        }
      }catch(error){
        if(!active) return;
        if(operationRef.current!==generation){ timer=setTimeout(tick,3000); return; }
        if(active) setNotice(bpError(error,"Blender connection status unavailable."));
        if(bpProtectedError(error)) return;
      }
      if(active) timer=setTimeout(tick,3000);
    };
    tick();
    return()=>{ active=false; if(timer) clearTimeout(timer); };
  },[BP,shot.id,acceptJob,readOnly]);
  const runJob=React.useCallback(async(nextJob,run)=>{
    if(!nextJob || nextJob.status!=="completed" || !run || !guardFor(run)) return;
    const data=bpDataUrl(nextJob);
    if(data && guardFor(run)) setPreview({url:data,meta:{...(nextJob.actualCamera?{actualCamera:nextJob.actualCamera}:{}),
      hash:run&&run.specHash||nextJob.specHash||"",specHash:run&&run.specHash||nextJob.specHash||"",source:"blender-preview"},source:"completed"});
    if(typeof BP.savePreview!=="function"){ if(guardFor(run)) setPreviewError("Preview finished but durable preview storage is unavailable."); return; }
    if(!guardFor(run)) return;
    setSaving(true);
    try{
      const saved=await BP.savePreview(nextJob,run.scope,()=>guardFor(run));
      if(!guardFor(run)) return;
      if(guardFor(run)){
        setPreview(saved&&saved.url ? {url:saved.url,meta:saved.meta||{},source:"saved"} : preview);
        setSaveFailure(null); setPreviewError(""); setNotice("Blender preview saved separately from the shot artwork.");
      }
    }catch(error){ if(!guardFor(run)) return;
      setSaveFailure({job:nextJob,previewDataUrl:bpDataUrl(nextJob)||error.previewDataUrl||""});
      setPreviewError(bpError(error,"Preview finished but could not be saved."));
    }
    finally{ if(guardFor(run)) setSaving(false); }
  },[BP,guardFor,preview]);
  runJobRef.current=runJob;
  React.useEffect(()=>{
    if(!job || !["queued","running"].includes(job.status) || !BP ||
      typeof BP.request!=="function") return;
    let active=true, timer=null;
    const poll=async()=>{
      const pollingRun=activeRun.current;
      if(!pollingRun) return;
      const generation=operationRef.current;
      const s=bpScopeNow(BP);
      if(!s || s.projectId!==(job.spec&&job.spec.projectId||s.projectId)){ return; }
      try{
        const result=await BP.request("job.get",{projectId:s.projectId,jobId:job.id},s,
          ()=>active&&operationRef.current===generation&&guardFor(pollingRun));
        if(!active||operationRef.current!==generation||cancelledJobs.current[job.id]) return;
        const next=acceptJob(result,pollingRun);
        if(active && next && next.status==="completed" && !handledJobs.current[next.id]){
          handledJobs.current[next.id]=true; await runJob(next,pollingRun);
        }
      }catch(error){
        if(!active||operationRef.current!==generation) return;
        if(active) setJobError(bpError(error,"Could not read Blender job status."));
        if(bpProtectedError(error)) return;
      }
      if(active) timer=setTimeout(poll,3000);
    };
    poll();
    return()=>{active=false;if(timer) clearTimeout(timer);};
  },[BP,job&&job.id,job&&job.status,shot.id,acceptJob,runJob,guardFor]);
  const render=async()=>{
    if(requestPendingRef.current) return;
    requestPendingRef.current=true; setRequestPending(true);
    const startGeneration=operationRef.current;
    let operationGeneration=startGeneration;
    setJobError(""); setPreviewError(""); setSaveFailure(null);
    try{
      if(readOnly){ setJobError("View-only access cannot launch Blender previews."); return; }
      if(configError || !spec){ setJobError(configError||"This shot layout is invalid for Blender preview."); return; }
      const s=freshScope();
      if(!s){ setJobError("Save the film in the cloud before launching a Blender preview."); return; }
      operationGeneration=operationRef.current;
      const activeConnectionJob=connection && connection.job && ["queued","running"].includes(connection.job.status) &&
        connection.job.id && connection.job.spec;
      if(activeConnectionJob && connection.job.spec.projectId!==s.projectId){
        setJobError("A Blender job from another film is active; this shot cannot use it."); return;
      }
      const runningOther=activeConnectionJob && connection.job.spec.projectId===s.projectId &&
        connection.job.spec.shotId!==shot.id;
      if(runningOther){ setJobError("Another shot is using the connected Blender desktop. Wait for it to finish."); return; }
      const frozenSpec=buildSpec(configRef.current||liveConfig);
      if(!frozenSpec){ setJobError(specErrorRef.current||"This shot layout is invalid for Blender preview."); return; }
      const hashed=await BP.hashSpec(frozenSpec), frozenHash=String(hashed||"");
      if(operationRef.current!==operationGeneration) return;
      if(!frozenHash) throw new Error("The Blender scene signature is unavailable.");
      const run={token:Date.now()+"-"+Math.random().toString(36).slice(2),scope:s,shotId:shot.id,
        generation:operationGeneration,specHash:frozenHash,specSnapshot:bpCanonical(frozenSpec,BP)};
      activeRun.current=run;
      const result=await BP.request("job.create",{projectId:s.projectId,spec:frozenSpec,
        requestId:"browser-"+run.token},s,()=>guardFor(run));
      if(operationRef.current!==operationGeneration) return;
      if(!guardFor(run)){ setJobError("The shot or layout changed before the preview job was accepted."); return; }
      const next=acceptJob(result,run);
      if(next && next.status==="completed"){ handledJobs.current[next.id]=true; await runJob(next,run); }
    }catch(error){ if(alive.current && operationRef.current===operationGeneration && !bpProtectedError(error))
      setJobError(bpError(error,"Could not queue Blender preview.")); }
    finally{
      if(operationRef.current===operationGeneration) requestPendingRef.current=false;
      if(alive.current&&operationRef.current===operationGeneration) setRequestPending(false);
    }
  };
  const stop=async()=>{
    const capturedScope=scopeRef.current,capturedJob=job;
    const generation=invalidate();
    if(capturedJob&&capturedJob.id) cancelledJobs.current[capturedJob.id]=true;
    if(capturedJob) setJob({...capturedJob,status:"cancelled"}); setConnection(null);
    if(!capturedJob || !capturedScope || typeof BP.request!=="function") return;
    try{
      const result=await BP.request("job.cancel",{projectId:capturedScope.projectId,jobId:capturedJob.id},
        capturedScope,()=>alive.current&&operationRef.current===generation&&bpSameScope(BP,capturedScope));
      if(operationRef.current!==generation) return;
      const next=bpJob(result);
      if(alive.current && next) setJob(next);
      if(alive.current&&operationRef.current===generation) setNotice("Blender preview stopped.");
    }catch(error){ if(alive.current&&operationRef.current===generation&&bpSameScope(BP,capturedScope))
      setJobError(bpError(error,"Could not stop Blender preview.")); }
  };
  const clearJob=()=>{
    if(job && ["queued","running"].includes(job.status)) return;
    setJob(null); setJobError(""); setNotice("");
  };
  const disconnect=async()=>{
    const capturedScope=scopeRef.current;
    const generation=invalidate();
    if(job&&job.id) cancelledJobs.current[job.id]=true;
    setConnection(null); setPair(null); setJob(null);
    if(!capturedScope || typeof BP.request!=="function") return;
    try{
      await BP.request("connection.disconnect",{projectId:capturedScope.projectId},capturedScope,
        ()=>alive.current&&operationRef.current===generation&&bpSameScope(BP,capturedScope));
      if(alive.current&&operationRef.current===generation) setNotice("Blender desktop disconnected.");
    }catch(error){ if(alive.current&&operationRef.current===generation&&bpSameScope(BP,capturedScope))
      setNotice(bpError(error,"Blender desktop could not be disconnected.")); }
  };
  const pairDesktop=async()=>{
    setPairError(""); setPairCopied(false); setEndpointCopied(false);
    if(readOnly){ setPairError("View-only access cannot pair a Blender desktop."); return; }
    const s=freshScope();
    if(!s){ setPairError("Save the film in the cloud before pairing Blender."); return; }
    const generation=operationRef.current;
    try{
      const result=await BP.request("pair.create",{projectId:s.projectId},s,
        ()=>alive.current&&operationRef.current===generation&&bpSameScope(BP,s));
      if(alive.current&&operationRef.current===generation) setPair(result||null);
    }catch(error){ if(alive.current&&operationRef.current===generation)
      setPairError(bpError(error,"Could not create a pairing code.")); }
  };
  const download=()=>{
    const url=(saveFailure&&saveFailure.previewDataUrl)|| (preview&&preview.url);
    if(!url) return;
    const a=document.createElement("a"); a.href=url; a.download="blender-preview-"+shot.id+".png";
    a.rel="noopener"; document.body.appendChild(a); a.click(); a.remove();
  };
  const retrySave=async()=>{
    if(!saveFailure || !activeRun.current || !guardFor(activeRun.current)) {
      setPreviewError("The shot or layout changed; this preview cannot be saved under the old specification."); return;
    }
    await runJob(saveFailure.job,activeRun.current);
  };
  const actions=capabilities && (capabilities.actions||capabilities.capabilities||[]);
  const capabilityReady=Array.isArray(actions) ? actions.includes("job.create") : !!capabilities;
  const connected=!!(connection&&connection.connected);
  const otherJob=!!(connection&&connection.job&&["queued","running"].includes(connection.job.status)&&connection.job.spec&&scopeRef.current&&
    connection.job.spec.projectId===scopeRef.current.projectId&&connection.job.spec.shotId!==shot.id);
  const busy=!!(job&&["queued","running"].includes(job.status));
  const currentMeta=preview&&preview.meta||{};
  const currentHash=currentMeta.hash||currentMeta.specHash||"";
  const stale=!!preview && (!currentHash || !specHash || currentHash!==specHash);
  const actual=currentMeta.actualCamera || (job&&job.actualCamera) || null;
  const input=(label,value,onChange,opts)=>_bpEl("label",{key:label,className:"bp-field"},_bpEl("span",null,label),
    _bpEl("input",{type:"number",value:value,step:opts&&opts.step||"0.01",min:opts&&opts.min,max:opts&&opts.max,
      disabled:!!readOnly,onChange:e=>onChange(e.target.value)}));
  const vector=(label,key,values,min,max)=>_bpEl("fieldset",{className:"bp-vector"},
    _bpEl("legend",null,label),
    _bpEl("div",{className:"bp-vector-grid"},
      ["X","Y","Z"].map((axis,index)=>input(axis,values[index],v=>updateConfig(key,index,v),{min,max}))));
  const status=job ? job.status : connected ? "paired" : "not connected";
  const capabilityLine=capabilities ? _bpEl("span",null," · bridge v"+(capabilities.version||"1")) : null;
  return _bpEl("section",{className:"bp-panel","data-testid":"blender-preview-panel"},
    _bpEl("div",{className:"bp-intro"},
      _bpEl("div",{className:"bp-title-row"},
        _bpEl("strong",null,"Blender preview"),
        _bpEl("span",{className:"bp-status bp-status-"+String(status).replace(/[^a-z]/g,"-")},status)),
      _bpEl("p",null,"Make a simple test picture in Blender on your computer. Your finished shot image stays unchanged.")),
    (readOnly||!scope) && _bpEl("div",{className:"bp-callout warn","data-testid":"blender-preview-blocked"},
      readOnly ? "View-only access cannot pair, render, or save Blender previews."
        : "Save this film to the cloud before using Blender preview."),
    _bpEl("div",{className:"bp-disclosure"},
      _bpEl("b",null,"A rough layout, not a finished image"),
      _bpEl("span",null,"The room is an editable approximation, not a reconstruction of your photos. Simple figures mark positions; they do not recreate your characters. No animation or paid generation.")),
    _bpEl("ol",{className:"bp-steps","aria-label":"Blender setup and preview steps"},
      _bpEl("li",{className:"bp-step","data-testid":"blender-step-install"},
        _bpEl("details",{className:"bp-setup","data-testid":"blender-addon-setup",open:setupOpen,
          onToggle:event=>setSetupOpen(event.currentTarget.open)},
          _bpEl("summary",{className:"bp-step-heading"},
            _bpEl("span",{className:"bp-step-number"},"1"),
            _bpEl("span",{className:"bp-step-label"},
              _bpEl("strong",null,"Download Blender desktop add-on"),
              _bpEl("small",null,"Install once on your computer")),
            _bpEl("span",{className:"bp-step-chevron","aria-hidden":"true"},"⌄")),
          _bpEl("div",{className:"bp-step-body"},
            _bpEl("p",{className:"bp-help"},"Already installed? Fold this step and continue to step 2. You do not need to download it before every picture."),
            _bpEl(BlenderAddonDownload),
            _bpEl("ul",{className:"bp-instructions"},
              _bpEl("li",null,"In Blender, open Preferences → Add-ons. Open the small menu at the top right and choose Install from Disk."),
              _bpEl("li",null,"Select cinema-machine-blender.zip without unzipping it, then enable Cinema Machine Bridge."))))),
      _bpEl("li",{className:"bp-step","data-testid":"blender-step-connect"},
        _bpEl("div",{className:"bp-step-heading"},
          _bpEl("span",{className:"bp-step-number"},"2"),
          _bpEl("span",{className:"bp-step-label"},
            _bpEl("strong",null,"Connect Blender to Cinema Machine"),
            _bpEl("small",null,connected?"Paired · confirm status in Blender":"After installation · keep Blender open"))),
        _bpEl("div",{className:"bp-step-body"},
          _bpEl("p",{className:"bp-help"},"Pair means connect: create a temporary code here, then enter it in the Blender add-on. This does not make a picture."),
          _bpEl("div",{className:"bp-actions"},
            _bpEl("button",{type:"button",className:"char-draft-btn ghost","data-testid":"blender-pair",
              disabled:!!readOnly||!scope,onClick:pairDesktop},"Pair Blender desktop"),
            connected && _bpEl("button",{type:"button",className:"char-draft-btn ghost","data-testid":"blender-disconnect",
              disabled:!!readOnly,onClick:disconnect},"Disconnect")),
          pair && _bpEl("div",{className:"bp-pair"},
            _bpEl("p",{className:"bp-help"},"In Blender, place your pointer over the 3D view and press N to open its side panel. Choose the CinemaMachine tab."),
            _bpEl("div",{className:"bp-pair-code","data-testid":"blender-pair-code"},
              _bpEl("div",null,_bpEl("span",null,"Function URL"),_bpEl("code",null,typeof BP.endpoint==="function"?BP.endpoint():""),
                _bpEl("button",{type:"button",className:"bp-copy","aria-label":"Copy Function URL",onClick:async()=>{
                  const ok=await bpCopy(typeof BP.endpoint==="function"?BP.endpoint():"");
                  if(alive.current) setEndpointCopied(ok);
                }},endpointCopied?"Copied":"Copy")),
              _bpEl("div",null,_bpEl("span",null,"Pair code"),_bpEl("code",null,pair.pairCode||"—"),
                _bpEl("button",{type:"button",className:"bp-copy","aria-label":"Copy pair code",onClick:async()=>{
                  const ok=await bpCopy(pair.pairCode||""); if(alive.current) setPairCopied(ok);
                }},pairCopied?"Copied":"Copy")),
              pair.expiresAt && _bpEl("small",null,"Code expires "+new Date(pair.expiresAt).toLocaleString())),
            _bpEl("p",{className:"bp-help"},"Paste these into the matching Function URL and Pair code boxes in Blender. Tick “I approve this project”, then click Connect in Blender.")),
          _bpEl("p",{className:"bp-help","data-testid":"blender-connection-help"},
            connected ? "Paired. Check for Status: Connected in Blender. The website confirms pairing, not a live connection. Keep Blender open and your computer awake while you make previews."
              : "Once Blender connects, step 3 becomes available. You only need a new code when reconnecting."))),
      _bpEl("li",{className:"bp-step","data-testid":"blender-step-render"},
        _bpEl("div",{className:"bp-step-heading"},
          _bpEl("span",{className:"bp-step-number"},"3"),
          _bpEl("span",{className:"bp-step-label"},
            _bpEl("strong",null,"Render Blender preview"),
            _bpEl("small",null,"Make a picture · repeat with a different lens"))),
        _bpEl("div",{className:"bp-step-body"},
          _bpEl("p",{className:"bp-help"},"Start with these settings, then click Render below. Afterwards, change the lens and render again to compare views."),
    _bpEl("div",{className:"bp-inputs","data-testid":"blender-frame-inputs"},
      _bpEl("span",null,"In frame"),
      _bpEl("b",null,(subjects||[]).map(x=>x&&x.name||x&&x.id).filter(Boolean).join(" · ")||"No subjects",
        (props||[]).length ? " · "+props.map(x=>x&&x.name||x&&x.id).filter(Boolean).join(" · ") : ""),
      _bpEl("small",null,location ? "Location · "+(location.name||location.id||"resolved") : "No location resolved")),
    _bpEl("div",{className:"bp-config"},
      _bpEl("div",{className:"bp-config-head"},_bpEl("b",null,"Preview layout"),_bpEl("small",null,"metres · still camera")),
      _bpEl("p",{className:"bp-help"},"Camera position is where it sits; camera target is where it looks. X and Y place things across the room; Z is height. A lower lens number gives a wider view."),
      _bpEl("div",{className:"bp-room-grid"},
        input("Room width",liveConfig.room.width,v=>updateConfig("room","width",v),{min:2,max:50}),
        input("Room depth",liveConfig.room.depth,v=>updateConfig("room","depth",v),{min:2,max:50}),
        input("Room height",liveConfig.room.height,v=>updateConfig("room","height",v),{min:2,max:12})),
      vector("Camera position","position",liveConfig.position,-100,100),
      vector("Camera target","target",liveConfig.target,-100,100),
      input("Lens (mm)",liveConfig.lens,v=>editLens(v),{min:8,max:200,step:1})),
    _bpEl("div",{className:"bp-actions"},
      _bpEl("button",{type:"button",className:"char-draft-btn primary","data-testid":"blender-render",
        disabled:!!readOnly||!!configError||!spec||!scope||!capabilityReady||!connected||otherJob||busy||saving||requestPending,onClick:render},
        busy?"Blender "+status+"…":"Render Blender preview"),
      (busy||saving) && _bpEl("button",{type:"button",className:"char-draft-btn ghost","data-testid":"blender-stop",onClick:stop},"Stop"),
      job && !busy && _bpEl("button",{type:"button",className:"char-draft-btn ghost","data-testid":"blender-clear",
        onClick:clearJob},"Clear")),
    !connected && scope && _bpEl("p",{className:"bp-help"},"Render is unavailable until Blender is connected in step 2."),
    otherJob && _bpEl("p",{className:"bp-callout warn"},"Another shot is currently using this Blender connection. Rendering is disabled until its job is finished."),
    preview && _bpEl("div",{className:"bp-result","data-testid":"blender-preview-result"},
      _bpEl("div",{className:"bp-result-head"},
        _bpEl("b",null,"Preview render"),
        stale && _bpEl("span",{className:"bp-stale"},"Stale layout / legacy hash")),
      _bpEl("img",{src:preview.url,alt:"Separate Blender blockout preview for this shot"}),
      actual && _bpEl("div",{className:"bp-readback"},
        "Blender readback · lens "+bpNumber(actual.focalLength,liveConfig.lens)+"mm",
        actual.width&&actual.height ? " · "+actual.width+"×"+actual.height : ""),
      preview.source==="saved" && !currentHash && _bpEl("small",{className:"bp-stale"},"Saved preview has no source hash; alignment is unknown.")),
    saveFailure && _bpEl("div",{className:"bp-callout error","data-testid":"blender-save-failure"},
      "Preview pixels were retained, but durable saving failed.",
      _bpEl("div",{className:"bp-failure-actions"},
        _bpEl("button",{type:"button",className:"char-draft-btn ghost","data-testid":"blender-download",onClick:download},"Download PNG"),
        _bpEl("button",{type:"button",className:"char-draft-btn ghost","data-testid":"blender-retry-save",disabled:saving,onClick:retrySave},"Retry save")))))),
    _bpEl("div",{className:"bp-messages","aria-live":"polite"},
      configError&&_bpEl("span",{className:"bp-message error"},configError),
      notice&&_bpEl("span",{className:"bp-message"},notice),
      jobError&&_bpEl("span",{className:"bp-message error"},jobError),
      pairError&&_bpEl("span",{className:"bp-message error"},pairError),
      capError&&_bpEl("span",{className:"bp-message error"},capError),
      previewError&&_bpEl("span",{className:"bp-message error"},previewError)),
    _bpEl("div",{className:"bp-capability"},loaded?"Saved preview checked":"Checking saved preview…",capabilityLine));
}

window.BlenderPreviewPanel=BlenderPreviewPanel;
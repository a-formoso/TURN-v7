/* Review a camera angle against the current four panels before explicitly saving or assigning it. */
function LocationCameraAngleWorkbench({l,onUpdate,readOnly=false}){
  const E=React.createElement,api=window.KinolotCloudRender,preview=window.KinolotAnglePreview;
  const [open,setOpen]=React.useState(false),[spec,setSpec]=React.useState(null),[pose,setPose]=React.useState(null);
  const [destination,setDestination]=React.useState("TR"),[start,setStart]=React.useState("TL"),[name,setName]=React.useState("Extra angle");
  const [extraId,setExtraId]=React.useState(""),[error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[ready,setReady]=React.useState(false),[attempt,setAttempt]=React.useState(0),[displayMode,setDisplayMode]=React.useState(""),[softwareOnly,setSoftwareOnly]=React.useState(false);
  const base=React.useRef(null),dialog=React.useRef(null),candidate=React.useRef(null),thumbs=React.useRef({}),viewer=React.useRef(null),lastRendered=React.useRef("");
  const labels={TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const epoch=typeof window.nbEpoch==="function"?window.nbEpoch():0;
  React.useEffect(()=>{setOpen(false);setSpec(null);setError("");setNotice("");},[l.id,epoch]);
  const list=()=>((window.turnContinuity||{}).locations)||[];
  const current=()=>list().find(x=>x.id===l.id);
  function begin(){
    setError("");setNotice("");setReady(false);lastRendered.current="";
    try{const location=current();if(!location)throw Error("This location is no longer open.");
      const scene=api.buildScene(location),key=window.KinolotRenderContract.canonical(scene);
      base.current={key,epoch,locationId:l.id,planSig:locationStagingLayoutSig(location)};setSpec(scene);setPose({...scene.cameras.TL,position:[...scene.cameras.TL.position]});
      setStart("TL");setExtraId("");setName("Extra angle");setOpen(true);
    }catch(e){setError(e.message);}
  }
  React.useEffect(()=>{if(open&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[open]);
  React.useEffect(()=>{
    if(!open||!spec)return;let live=true,instance=null,stage="Loading preview files";setReady(false);lastRendered.current="";setError("");setDisplayMode("");
    preview.load().then(T=>{
      if(!live)return;stage="Starting the graphics preview";instance=preview.create(T,spec,{softwareOnly});viewer.current=instance;stage="Drawing the camera views";
      for(const panel of Object.keys(labels))if(thumbs.current[panel])instance.render(thumbs.current[panel],spec.cameras[panel],320,180);
      if(candidate.current){instance.render(candidate.current,pose);lastRendered.current=window.KinolotRenderContract.canonical(pose);}setDisplayMode(instance.mode||"gpu");setReady(true);
    }).catch(e=>{if(live){setError(stage+": "+String(e?.message||"Display unavailable").slice(0,240)+". Your cameras are unchanged. Retry below, or use the saved cameras and cloud Build set.");setReady(false);}});
    return ()=>{live=false;if(viewer.current===instance)viewer.current=null;instance?.dispose();};
  },[open,spec,attempt,softwareOnly]);
  React.useEffect(()=>{
    if(!open||!ready||!pose||!candidate.current||!viewer.current)return;
    try{viewer.current.render(candidate.current,pose);setDisplayMode(viewer.current.mode||"gpu");lastRendered.current=window.KinolotRenderContract.canonical(pose);}catch(e){setError(e.message);setReady(false);}
  },[open,ready,pose]);
  function guard(){
    if(readOnly||typeof window.turnArtRoomWritable==="function"&&!window.turnArtRoomWritable())throw Error("This film is read-only.");
    const location=current();
    if(!base.current||!location||base.current.locationId!==location.id||base.current.epoch!==(window.nbEpoch?.()||0)
      ||locationStagingLayoutSig(location)!==base.current.planSig
      ||window.KinolotRenderContract.canonical(api.buildScene(location))!==base.current.key)
      throw Error("The film, floor plan or saved cameras changed. Close and reopen the angle preview before applying it.");
    const test={...location,coverageViews:locationCoverageViewsWithPose(location,"TL",{...pose,basis:"user"})};
    const problem=api.cameraProblems(test,list().map(x=>x.id===test.id?test:x)).TL;
    if(problem)throw Error(problem);
    window.KinolotRenderContract.validateScene({...spec,cameras:{...spec.cameras,TL:pose}});
    if(!ready||lastRendered.current!==window.KinolotRenderContract.canonical(pose))throw Error("Wait for the current angle preview before using it.");return location;
  }
  function saveExtra(){
    setError("");try{const location=guard(),views=locationCoverageViews(location),id=extraId||"angle-"+window.crypto.randomUUID();
      const existing=extraId&&views.find(v=>v.id===extraId&&!v.panel);
      if(extraId&&!existing)throw Error("That extra camera was removed. Close and reopen the preview.");
      const title=name.trim().slice(0,100);if(!title)throw Error("Name this camera angle before saving it.");
      const text=locationPoseFreeText(pose,locationSpaceAnchors(location));
      const view={...(existing||{id,purpose:"",visibleAnchors:"",staging:emptyStaging()}),name:title,pose:{...pose,position:[...pose.position],basis:"user"},
        cameraPosition:existing?.cameraPosition||text.cameraPosition,target:existing?.target||text.target,lens:pose.lensMm+" mm"};
      onUpdate(location.id,{coverageViews:existing?views.map(v=>v.id===id?view:v):views.concat(view)});
      setExtraId(id);setNotice("Saved “"+title+"” as an extra camera. The four panel cameras are unchanged.");
    }catch(e){setError(e.message);}
  }
  function assign(){
    setError("");try{const location=guard();
      const views=locationCoverageViews(location),old=views.find(v=>v.panel===destination)||(destination==="TL"?views[0]:null);
      let coverageViews=locationCoverageViewsWithPose(location,destination,{...pose,position:[...pose.position],basis:"user"});
      if(old?.staging&&!old.staging.cameraSig){
        const sig=locationCompositionCameraSig(location,old.id);
        coverageViews=coverageViews.map(v=>v.panel===destination?{...v,staging:{...v.staging,cameraSig:sig}}:v);
      }
      onUpdate(location.id,{coverageViews});setOpen(false);
      setNotice(labels[destination]+" now uses this camera angle. Rebuild in step 4, then style the updated grid in step 5.");
    }catch(e){setError(e.message);}
  }
  function chooseStart(value){
    setStart(value);setError("");
    if(value.startsWith("extra:")){
      const view=locationCoverageViews(current()||l).find(v=>v.id===value.slice(6));
      setPose(view?.pose?.position?{position:[...view.pose.position],yaw:view.pose.yaw,pitch:view.pose.pitch,lensMm:view.pose.lensMm}:structuredClone(spec.cameras.TL));
      setExtraId(view?.id||"");setName(view?.name||"Extra angle");
    }else{setPose(structuredClone(spec.cameras[value]));setExtraId("");setName("Extra angle");}
  }
  let space=null,map=null,problem="";
  if(open&&pose&&spec)try{
    const location=current()||l,state=locationSpatialPlanState(location,list());space=state.plan.coordinates.spaces.find(s=>s.id===l.id);
    const temporary={...location,coverageViews:locationCoverageViewsWithPose(location,"TL",{...pose,basis:"design"})};
    const locations=list().map(x=>x.id===l.id?temporary:x);map=locationFloorPlanScene(state.owner,state.plan,locations);
    map.cameras=map.cameras.filter(c=>c.spaceId===l.id&&c.panel==="TL").map(c=>({...c,panel:"candidate",label:"Candidate angle",source:"suggested"}));
    problem=api.cameraProblems(temporary,locations).TL||"";
  }catch(e){problem=e.message;}
  const field=(label,value,min,max,step,set,suffix="")=>E("label",{className:"loc-angle-field"},
    E("span",null,label+": "+(Math.round(value*100)/100)+suffix),E("input",{type:"range",min,max,step,value,onChange:e=>set(Number(e.target.value))}));
  const xs=space?.footprint?.map(p=>p[0])||[0,1],ys=space?.footprint?.map(p=>p[1])||[0,1];
  const extras=locationCoverageViews(current()||l).filter((v,i)=>i>0&&!v.panel);
  const same=(a,b)=>a&&b&&["yaw","pitch","lensMm"].every(k=>Math.abs(a[k]-b[k])<.0001)&&a.position.every((n,i)=>Math.abs(n-b.position[i])<.0001);
  const unchanged=spec&&same(pose,spec.cameras[destination]);
  const duplicate=spec&&Object.keys(labels).find(k=>k!==destination&&same(pose,spec.cameras[k]));
  return <div className="loc-angle-entry">
    <button type="button" className="art-draftall ghost" onClick={begin}>Preview &amp; choose camera angles</button>
    <p className="loc-layer-note">Free interactive layout previews use the saved set geometry. Final materials and lighting are rendered by Blender in step 4.</p>
    {!open&&error&&<p role="alert" className="loc-spatial-error">{error}</p>}
    {!open&&notice&&<p role="status" className="loc-layer-note">{notice}</p>}
    {open&&spec&&pose&&<dialog ref={dialog} className="loc-angle-dialog" onCancel={()=>setOpen(false)} aria-label="Preview and choose a camera angle">
      <div className="loc-cloud-render-head"><h3>Preview a camera angle</h3><button type="button" className="art-draftall ghost" onClick={()=>setOpen(false)}>Close preview</button></div>
      <p className="loc-layer-note">Layout preview — exact set geometry and camera framing, neutral inspection lighting. This is not a Blender render or finished artwork.</p>
      <div className="loc-angle-compare">
        <figure><figcaption>Candidate angle · {name} · facing {locCompass(pose.yaw)} · {pose.lensMm} mm</figcaption><canvas ref={candidate} width={640} height={360} aria-label="Candidate camera layout preview"/></figure>
        <div><p>Choose the panel to replace. Its border highlights the destination.</p><div className="loc-angle-panels" role="group" aria-label="Destination panel">
          {Object.keys(labels).map(panel=><button key={panel} type="button" className={"loc-angle-panel"+(destination===panel?" selected":"")} aria-pressed={destination===panel} onClick={()=>setDestination(panel)}>
            <span>{labels[panel]}{destination===panel?" · replace this":""}</span><canvas width={320} height={180} ref={el=>thumbs.current[panel]=el} aria-label={labels[panel]+" saved camera layout preview"}/>
          </button>)}
        </div></div>
      </div>
      <label className="loc-cam-field"><span>Start from a saved camera</span><select className="prop-select" value={start} onChange={e=>chooseStart(e.target.value)}>
        {Object.keys(labels).map(panel=><option key={panel} value={panel}>{labels[panel]}</option>)}
        {extras.map(v=><option key={v.id} value={"extra:"+v.id}>{v.name}{v.pose?.position?"":" · camera not set yet"}</option>)}
      </select></label>
      <details className="loc-nested-section"><summary>Adjust camera position and framing</summary><div className="loc-angle-controls">
        {field("Across the room",pose.position[0],Math.min(...xs),Math.max(...xs),.05,v=>setPose(p=>({...p,position:[v,p.position[1],p.position[2]]}))," m")}
        {field("Along the room",pose.position[1],Math.min(...ys),Math.max(...ys),.05,v=>setPose(p=>({...p,position:[p.position[0],v,p.position[2]]}))," m")}
        {field("Height",pose.position[2],(space?.floorZ||0)+.25,(space?.floorZ||0)+(space?.openSky?6:space?.ceilingH||3)-.15,.05,v=>setPose(p=>({...p,position:[p.position[0],p.position[1],v]}))," m")}
        {field("Turn",pose.yaw,0,359,1,v=>setPose(p=>({...p,yaw:v})),"°")}
        {field("Look up or down",pose.pitch,-80,80,1,v=>setPose(p=>({...p,pitch:v})),"°")}
        {field("Lens",pose.lensMm,8,200,1,v=>setPose(p=>({...p,lensMm:v}))," mm")}
      </div></details>
      {map&&<details className="loc-nested-section"><summary>Where this camera stands</summary><LocationFloorPlanMap scene={map} spaceId={l.id} selected={l.id+":candidate"}/></details>}
      {problem&&<p role="alert" className="loc-spatial-error">{problem}</p>}
      {unchanged&&<p className="loc-layer-note">This already matches the {labels[destination].toLowerCase()} camera.</p>}
      {!unchanged&&duplicate&&<p className="loc-layer-note">This matches the {labels[duplicate].toLowerCase()} camera. Adjust it for a different angle, or reuse it intentionally.</p>}
      {ready&&displayMode==="gpu"&&<button type="button" className="art-draftall ghost" onClick={()=>setSoftwareOnly(true)}>Views blank? Use compatibility preview</button>}
      {displayMode==="software"&&<p role="status" className="loc-layer-note">Using a compatibility preview because graphics acceleration is unavailable. Camera framing and set geometry are preserved; inspection shading is simplified.</p>}
      {error&&<div role="alert" className="loc-spatial-error"><p>{error}</p><button type="button" className="art-draftall ghost" onClick={()=>setAttempt(n=>n+1)}>Retry preview</button></div>}
      {!ready&&!error&&<p role="status">Preparing the layout preview…</p>}
      <div className="loc-cloud-render-actions"><button type="button" className="art-draftall" disabled={readOnly||!ready||!!problem||unchanged} onClick={assign}>Use this angle in {labels[destination]}</button><button type="button" className="art-draftall ghost" onClick={()=>setOpen(false)}>Discard changes</button></div>
      <details className="loc-nested-section"><summary>Save as an extra camera instead</summary>
        <p className="loc-layer-note">Keep this measured camera for later without replacing a panel. It can have its own composition notes; assign it to a panel before the four-view cloud build can render or style it.</p>
        <label className="loc-cam-field"><span>Angle name</span><input className="prop-select" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label>
        <button type="button" className="art-draftall ghost" disabled={readOnly||!ready||!!problem} onClick={saveExtra}>{extraId?"Save extra camera changes":"Save extra camera"}</button>
      </details>
      {notice&&<p role="status" className="loc-layer-note">{notice}</p>}
    </dialog>}
  </div>;
}
window.LocationCameraAngleWorkbench=LocationCameraAngleWorkbench;

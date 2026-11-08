/* Review a camera angle against the current four panels before explicitly saving or assigning it. */
function LocationCameraAngleWorkbench({l,onUpdate,readOnly=false,previewRequest=null}){
  const E=React.createElement,api=window.KinolotCloudRender,preview=window.KinolotAnglePreview;
  const [open,setOpen]=React.useState(false),[spec,setSpec]=React.useState(null),[pose,setPose]=React.useState(null);
  const [destination,setDestination]=React.useState("TL"),[start,setStart]=React.useState("TL"),[name,setName]=React.useState("Extra angle");
  const [extraId,setExtraId]=React.useState(""),[error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[ready,setReady]=React.useState(false),[attempt,setAttempt]=React.useState(0),[displayMode,setDisplayMode]=React.useState(""),[softwareOnly,setSoftwareOnly]=React.useState(false);
  const [inspection,setInspection]=React.useState(null);
  const [viewLabel,setViewLabel]=React.useState(null);
  const base=React.useRef(null),dialog=React.useRef(null),candidate=React.useRef(null),thumbs=React.useRef({}),viewer=React.useRef(null),lastRendered=React.useRef("");
  const labels={TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const epoch=typeof window.nbEpoch==="function"?window.nbEpoch():0;
  React.useEffect(()=>{setOpen(false);setSpec(null);setError("");setNotice("");},[l.id,epoch]);
  const list=()=>((window.turnContinuity||{}).locations)||[];
  const current=()=>list().find(x=>x.id===l.id);
  function begin(panel="TL"){
    if(!["TL","TR","BL","BR"].includes(panel))panel="TL";
    setError("");setNotice("");setReady(false);setInspection(null);lastRendered.current="";
    try{const location=current();if(!location)throw Error("This location is no longer open.");
      const scene=api.buildScene(location),key=window.KinolotRenderContract.canonical(scene);
      const inspectedPlan=locationSpatialPlanState(location,list()).plan;
      base.current={key,epoch,locationId:l.id,planSig:locationStagingLayoutSig(location),openings:preview.openingGuides?.(inspectedPlan)||[],anchors:inspectedPlan.anchors};setSpec(scene);setPose({...scene.cameras[panel],position:[...scene.cameras[panel].position]});
      setStart(panel);setDestination(panel);setExtraId("");setName("Extra angle");setOpen(true);
    }catch(e){setError(e.message);}
  }
  React.useEffect(()=>{if(previewRequest?.locationId===l.id)begin(previewRequest.panel);},[previewRequest]);
  React.useEffect(()=>{if(open&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[open]);
  React.useEffect(()=>{
    if(!open||!spec)return;let live=true,instance=null,stage="Loading preview files";setReady(false);lastRendered.current="";setError("");setDisplayMode("");
    preview.load().then(T=>{
      if(!live)return;stage="Starting the graphics preview";instance=preview.create(T,spec,{softwareOnly,openings:base.current.openings,anchors:base.current.anchors});viewer.current=instance;stage="Drawing the camera views";
      for(const panel of Object.keys(labels))if(thumbs.current[panel])instance.render(thumbs.current[panel],spec.cameras[panel],320,180);
      if(candidate.current){instance.render(candidate.current,pose);lastRendered.current=window.KinolotRenderContract.canonical(pose);describeView(instance,pose);}setDisplayMode(instance.mode||"gpu");setReady(true);
    }).catch(e=>{if(live){setError(stage+": "+String(e?.message||"Display unavailable").slice(0,240)+". Your cameras are unchanged. Retry below, or use the saved cameras and cloud Build set.");setReady(false);}});
    return ()=>{live=false;if(viewer.current===instance)viewer.current=null;instance?.dispose();};
  },[open,spec,attempt,softwareOnly]);
  React.useEffect(()=>{
    if(!open||!ready||!pose||!candidate.current||!viewer.current)return;
    try{viewer.current.render(candidate.current,pose);setDisplayMode(viewer.current.mode||"gpu");lastRendered.current=window.KinolotRenderContract.canonical(pose);describeView(viewer.current,pose);}catch(e){setError(e.message);setReady(false);}
  },[open,ready,pose]);
  React.useEffect(()=>setInspection(null),[pose]);
  function describeView(instance,camera){
    let text="View direction";
    try{
      const hit=instance.inspect(camera,.5,.5);
      const name=String(hit.name||"").split(/[,;]| — /)[0].replace(/\s+/g," ").trim();
      text=hit.kind==="background"?"Looking into unmodelled space":name?"Looking toward "+(name.length>72?name.slice(0,69)+"…":name):"Looking into the set";
    }catch(_){text="View direction unavailable";}
    setViewLabel({key:window.KinolotRenderContract.canonical(camera),text});
  }
  function identify(event,panel){
    if(!ready||!viewer.current?.inspect)return;
    if(!panel&&lastRendered.current!==window.KinolotRenderContract.canonical(pose))return;
    const point=event?preview.imagePoint(event.currentTarget,event.clientX,event.clientY):{x:.5,y:.5};if(!point)return;
    try{setInspection({...viewer.current.inspect(panel?spec.cameras[panel]:pose,point.x,point.y),view:panel?labels[panel]:"Candidate angle"});}
    catch(e){setError("Could not identify this view. "+e.message);}
  }
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
      onUpdate(location.id,{coverageViews},{kind:"angle-assigned"});setOpen(false);
      setNotice(labels[destination]+" now uses this camera angle. Rebuild in step 4, then style the updated grid in step 5.");
    }catch(e){setError(e.message);}
  }
  function chooseStart(value){
    setStart(value);setError("");
    if(value.startsWith("extra:")){
      const view=locationCoverageViews(current()||l).find(v=>v.id===value.slice(6));
      setPose(view?.pose?.position?{position:[...view.pose.position],yaw:view.pose.yaw,pitch:view.pose.pitch,lensMm:view.pose.lensMm}:structuredClone(spec.cameras.TL));
      setExtraId(view?.id||"");setName(view?.name||"Extra angle");
    }else{setDestination(value);setPose(structuredClone(spec.cameras[value]));setExtraId("");setName("Extra angle");}
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
  const editing=start.startsWith("extra:")?destination:start;
  const copying=destination!==editing;
  return <div className="loc-angle-entry">
    <button type="button" className="art-draftall ghost" onClick={begin}>Preview &amp; choose camera angles</button>
    <p className="loc-layer-note">Free interactive layout previews use the saved set geometry. Final materials and lighting are rendered by Blender in step 4.</p>
    {!open&&error&&<p role="alert" className="loc-spatial-error">{error}</p>}
    {!open&&notice&&<p role="status" className="loc-layer-note">{notice}</p>}
    {open&&spec&&pose&&<dialog ref={dialog} className="loc-angle-dialog" onCancel={()=>setOpen(false)} aria-label="Preview and choose a camera angle">
      <div className="loc-cloud-render-head"><h3>Edit {labels[editing].toLowerCase()} camera</h3><button type="button" className="art-draftall ghost" onClick={()=>setOpen(false)}>Close preview</button></div>
      <p className="loc-layer-note">{l.name||"This location"} · choose a camera, adjust its view, then save. These previews are free; changes stay unsaved until you save the camera.</p>
      <div className="loc-angle-compare">
        <figure><figcaption><strong>{labels[editing]} · {unchanged?"saved view":"unsaved preview"}</strong><span>{viewLabel?.key===window.KinolotRenderContract.canonical(pose)?viewLabel.text:"Updating view…"} · {pose.lensMm} mm lens{start.startsWith("extra:")?" · using "+name:""}</span></figcaption><canvas ref={candidate} width={640} height={360} tabIndex={0} role="button" aria-label="Identify an object in the candidate preview; press Enter to inspect the centre" onClick={e=>identify(e)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();identify(null);}}}/></figure>
        <div className="loc-angle-destinations"><p><strong>Choose a camera to edit</strong><span>The highlighted camera matches the large preview.</span></p><div className="loc-angle-panels" role="group" aria-label="Camera to edit">
          {Object.keys(labels).map(panel=><button key={panel} type="button" className={"loc-angle-panel"+(editing===panel?" selected":"")} aria-pressed={editing===panel} onClick={()=>{if(panel!==editing)chooseStart(panel);}}>
            <span>{labels[panel]}{editing===panel?" · editing":""}</span><canvas width={320} height={180} ref={el=>thumbs.current[panel]=el} aria-label={labels[panel]+" saved camera layout preview"}/>
          </button>)}
        </div></div>
      </div>
      <div className="loc-angle-inspection" role="status" aria-live="polite">
        <p className="loc-layer-note">Click or tap the large preview to identify a surface or opening. Blue background means unmodelled space.</p>
        {inspection&&<><strong>{inspection.view} · {inspection.name}</strong>
          <p>{inspection.kind==="opening"?"Saved "+inspection.type+" in "+inspection.room+". "+inspection.beyond:inspection.description}</p>
          {inspection.part&&<p>Visible part: {inspection.part}.</p>}
          {inspection.dimensions&&<p>{inspection.kind==="opening"?"Width × height: ":inspection.dimensionsSource==="saved"?"Saved object dimensions: ":"Preview dimensions: "}{inspection.dimensions.map(n=>Number(n.toFixed(2))).join(" × ")} m</p>}
          {inspection.through&&<p>Seen through {inspection.through.name} in {inspection.through.room}.</p>}
        </>}
      </div>
      <section className="loc-angle-group" aria-label="Adjust the selected camera">
      <h4 className="loc-angle-group-title">Adjust {labels[editing].toLowerCase()}</h4>
      <div className="loc-angle-controls">
        {field("Across the room",pose.position[0],Math.min(...xs),Math.max(...xs),.05,v=>setPose(p=>({...p,position:[v,p.position[1],p.position[2]]}))," m")}
        {field("Along the room",pose.position[1],Math.min(...ys),Math.max(...ys),.05,v=>setPose(p=>({...p,position:[p.position[0],v,p.position[2]]}))," m")}
        {field("Height",pose.position[2],(space?.floorZ||0)+.25,(space?.floorZ||0)+(space?.openSky?6:space?.ceilingH||3)-.15,.05,v=>setPose(p=>({...p,position:[p.position[0],p.position[1],v]}))," m")}
        {field("Turn",pose.yaw,0,359,1,v=>setPose(p=>({...p,yaw:v})),"°")}
        {field("Look up or down",pose.pitch,-80,80,1,v=>setPose(p=>({...p,pitch:v})),"°")}
        {field("Lens",pose.lensMm,8,200,1,v=>setPose(p=>({...p,lensMm:v}))," mm")}
      </div>
      <button type="button" className="art-draftall ghost" onClick={()=>chooseStart(editing)}>Reset to saved view</button>
      {map&&<details className="loc-nested-section"><summary>Where this camera stands</summary><LocationFloorPlanMap scene={map} spaceId={l.id} selected={l.id+":candidate"}/></details>}
      {ready&&displayMode==="gpu"&&<button type="button" className="art-draftall ghost" onClick={()=>setSoftwareOnly(true)}>Views blank? Use compatibility preview</button>}
      {displayMode==="software"&&<p role="status" className="loc-layer-note">Using a compatibility preview because graphics acceleration is unavailable. Camera framing and set geometry are preserved; inspection shading is simplified.</p>}
      {error&&<div role="alert" className="loc-spatial-error"><p>{error}</p><button type="button" className="art-draftall ghost" onClick={()=>setAttempt(n=>n+1)}>Retry preview</button></div>}
      {!ready&&!error&&<p role="status">Preparing the layout preview…</p>}
      </section>
      <section className="loc-angle-group loc-angle-save-group" aria-label="Save the selected camera">
      <p className="loc-layer-note">{copying?"This will replace the "+labels[destination].toLowerCase()+" camera with this angle.":"Save updates only the "+labels[destination].toLowerCase()+" camera. The other three stay as saved."}</p>
      {problem&&<p role="alert" className="loc-spatial-error">{problem}</p>}
      {unchanged&&<p className="loc-layer-note">This already matches the {labels[destination].toLowerCase()} camera.</p>}
      {!unchanged&&duplicate&&<p className="loc-layer-note">This matches the {labels[duplicate].toLowerCase()} camera. Adjust it for a different angle, or reuse it intentionally.</p>}
      <div className="loc-cloud-render-actions"><button type="button" className="art-draftall" disabled={readOnly||!ready||!!problem||unchanged} onClick={assign}>{copying?"Save angle to ":"Save "}{labels[destination]} camera</button><button type="button" className="art-draftall ghost" onClick={()=>setOpen(false)}>Discard changes</button></div>
      <details className="loc-nested-section"><summary>Use this angle in another panel</summary>
        <p className="loc-layer-note">Choose a different panel only if you want to replace that camera instead. The large preview keeps the angle you are adjusting.</p>
        <label className="loc-cam-field"><span>Save to panel</span><select className="prop-select" aria-label="Save to panel" value={destination} onChange={e=>setDestination(e.target.value)}>
          {Object.keys(labels).map(panel=><option key={panel} value={panel}>{labels[panel]}</option>)}
        </select></label>
      </details>
      {extras.length>0&&<details className="loc-nested-section"><summary>Use a saved extra angle</summary>
        <label className="loc-cam-field"><span>Saved angle</span><select className="prop-select" aria-label="Saved extra angle" value={start.startsWith("extra:")?start:""} onChange={e=>{if(e.target.value)chooseStart(e.target.value);}}>
          <option value="">Choose an extra angle</option>
          {extras.map(v=><option key={v.id} value={"extra:"+v.id}>{v.name}{v.pose?.position?"":" · camera not set yet"}</option>)}
        </select></label>
      </details>}
      <details className="loc-nested-section"><summary>Save as an extra camera instead</summary>
        <p className="loc-layer-note">Keep this measured camera for later without replacing a panel. It can have its own composition notes; assign it to a panel before the four-view cloud build can render or style it.</p>
        <label className="loc-cam-field"><span>Angle name</span><input className="prop-select" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label>
        <button type="button" className="art-draftall ghost" disabled={readOnly||!ready||!!problem} onClick={saveExtra}>{extraId?"Save extra camera changes":"Save extra camera"}</button>
      </details>
      {notice&&<p role="status" className="loc-layer-note">{notice}</p>}
      </section>
    </dialog>}
  </div>;
}
window.LocationCameraAngleWorkbench=LocationCameraAngleWorkbench;

/* Draw proposed poses before any saved-camera write or paid cloud build. */
function LocationSuggestedCameraPreviews({l,proposal,locations,previewRequest=null}){
  const preview=window.KinolotAnglePreview,api=window.KinolotCloudRender;
  const labels={TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const canvases=React.useRef({}),[error,setError]=React.useState(""),[ready,setReady]=React.useState(false),[attempt,setAttempt]=React.useState(0);
  const [expanded,setExpanded]=React.useState(""),dialog=React.useRef(null),large=React.useRef(null),rendered=React.useRef(null);
  React.useEffect(()=>{if(previewRequest?.locationId===l.id&&proposal.panels.some(p=>p.key===previewRequest.panel))setExpanded(previewRequest.panel);},[previewRequest]);
  React.useEffect(()=>{if(expanded&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[expanded]);
  React.useEffect(()=>{
    if(!expanded||!ready||!large.current||!rendered.current)return;
    try{rendered.current.instance.render(large.current,rendered.current.scene.cameras[expanded],640,360);}
    catch(e){setError("This camera view could not be displayed. "+String(e?.message||"Display unavailable").slice(0,180));}
  },[expanded,ready]);
  React.useEffect(()=>{
    let live=true,instance=null;setError("");setReady(false);
    Promise.resolve().then(()=>{
      if(!live)return;
      const views=api.cameraProposalViews(l,proposal,locations),proposed={...l,coverageViews:views};
      const list=locations.map(x=>x.id===l.id?proposed:x),scene=api.buildScene(proposed,list);
      const plan=locationSpatialPlanState(proposed,list).plan;
      return preview.load().then(T=>{
        if(!live)return;
        const options={openings:preview.openingGuides?.(plan)||[],anchors:plan.anchors};
        const draw=softwareOnly=>{
          instance=preview.create(T,scene,{...options,softwareOnly});
          for(const panel of proposal.panels)if(canvases.current[panel.key])
            instance.render(canvases.current[panel.key],scene.cameras[panel.key],320,180);
        };
        try{draw(false);}catch(e){instance?.dispose();instance=null;draw(true);}
        rendered.current={instance,scene};
        if(live)setReady(true);
      });
    }).catch(e=>{if(live)setError("The 3D previews could not be displayed. "+String(e?.message||"Display unavailable").slice(0,180));});
    return ()=>{live=false;rendered.current=null;instance?.dispose();};
  },[l,proposal,locations,attempt]);
  return <section className="loc-suggested-camera-previews" aria-label="Suggested camera views">
    <p className="loc-layer-note">Proposed 3D views · saved set geometry with simplified materials and lighting. Review the framing before choosing Use these cameras. Blender renders the finish in step 4.</p>
    <div className="loc-angle-panels">
      {proposal.panels.map(panel=><figure key={panel.key} className="loc-angle-panel" style={{margin:0}}>
        <figcaption>{labels[panel.key]} · {panel.label}</figcaption>
        <button type="button" className="loc-camera-open-view" onClick={()=>setExpanded(panel.key)} aria-label={"Open "+panel.label+" 3D preview"}>
          <canvas width={320} height={180} ref={node=>canvases.current[panel.key]=node} aria-label={panel.label+" proposed 3D layout preview"}/>
        </button>
      </figure>)}
    </div>
    {expanded&&<dialog ref={dialog} className="loc-angle-dialog loc-proposed-angle-dialog" onCancel={()=>setExpanded("")} aria-label="Proposed camera view">
      <div className="loc-cloud-render-head"><h3>{labels[expanded]} · {proposal.panels.find(p=>p.key===expanded)?.label}</h3>
        <button type="button" className="art-draftall ghost" onClick={()=>setExpanded("")}>Close preview</button></div>
      <p className="loc-layer-note">{l.name} · proposed camera, before saving. Close this preview and choose Use these cameras to accept the four views; then Preview &amp; choose camera angles lets you adjust them.</p>
      <canvas width={640} height={360} ref={large} aria-label={labels[expanded]+" proposed camera view"}/>
    </dialog>}
    {!ready&&!error&&<p role="status" className="loc-layer-note">Preparing the proposed camera views…</p>}
    {error&&<div role="alert" className="loc-spatial-error"><p>{error} Your saved cameras are unchanged.</p>
      <button type="button" className="art-draftall ghost" onClick={()=>setAttempt(n=>n+1)}>Retry 3D previews</button></div>}
  </section>;
}
window.LocationSuggestedCameraPreviews=LocationSuggestedCameraPreviews;

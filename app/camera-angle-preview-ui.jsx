/* Review a camera angle against the current four panels before explicitly saving or assigning it. */
function LocationCameraAngleWorkbench({l,onUpdate,readOnly=false,previewRequest=null,inline=false,label=""}){
  const E=React.createElement,api=window.KinolotCloudRender,preview=window.KinolotAnglePreview;
  const [open,setOpen]=React.useState(false),[spec,setSpec]=React.useState(null),[pose,setPose]=React.useState(null);
  const [destination,setDestination]=React.useState("TL"),[start,setStart]=React.useState("TL"),[name,setName]=React.useState("Extra angle");
  const [extraId,setExtraId]=React.useState(""),[error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[ready,setReady]=React.useState(false),[attempt,setAttempt]=React.useState(0),[displayMode,setDisplayMode]=React.useState(""),[softwareOnly,setSoftwareOnly]=React.useState(false);
  const [inspection,setInspection]=React.useState(null);
  const [viewLabel,setViewLabel]=React.useState(null);
  /* USE THIS ANGLE IN A SHOT (owner 2026-11-24, the Previs look brief, step 5: "I move the camera until I like the
     view. I press Use this angle in a shot. I pick where it goes: the scene, then the beat, then the shot inside
     that beat"). use = the picker's choice so far ({sceneId, beatN, shotId, name}); null = the picker is shut. */
  const [use,setUse]=React.useState(null);
  const base=React.useRef(null),dialog=React.useRef(null),candidate=React.useRef(null),thumbs=React.useRef({}),viewer=React.useRef(null),lastRendered=React.useRef("");
  /* THE SET AS IT IS DRESSED (owner 2026-11-16: "the camera tool shows the set as dressed"): the views are drawn as
     Previs draws them (lit, with the dressing of every card of the place), so a camera is aimed at the real thing.
     The plain preview stays underneath: it names what is clicked, and it is what is shown if the lit view cannot
     start (or in the compatibility preview). */
  const lit=React.useRef(null),[dressedView,setDressedView]=React.useState(null);
  const paint=(instance,canvas,camera,width,height)=>{
    if(lit.current)try{lit.current.render(canvas,camera,width,height);return;}catch(_){try{lit.current.dispose();}catch(e){}lit.current=null;setDressedView(null);}
    instance.render(canvas,camera,width,height);
  };
  const labels={TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const epoch=typeof window.nbEpoch==="function"?window.nbEpoch():0;
  React.useEffect(()=>{setOpen(false);setSpec(null);setError("");setNotice("");setUse(null);},[l.id,epoch]);
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
    let lighted=null;
    preview.load().then(async T=>{
      if(!live)return;stage="Starting the graphics preview";instance=preview.create(T,spec,{softwareOnly,openings:base.current.openings,anchors:base.current.anchors});viewer.current=instance;
      // the same set as Previs draws it; any failure here leaves the plain preview
      const P=window.KinolotPrevis;
      if(!softwareOnly&&P&&typeof P.viewer==="function"&&typeof P.scene==="function")try{
        const location=current();
        if(location){const drawn=P.scene(location,list());lighted=await P.viewer(drawn.scene,drawn.light);
          if(!live){lighted.dispose();lighted=null;return;}
          lit.current=lighted;setDressedView({dressed:!!drawn.dressed,parts:drawn.parts||0});}
      }catch(_){lighted=null;lit.current=null;setDressedView(null);}
      if(!live)return;
      stage="Drawing the camera views";
      for(const panel of Object.keys(labels))if(thumbs.current[panel])paint(instance,thumbs.current[panel],spec.cameras[panel],320,180);
      if(candidate.current){paint(instance,candidate.current,pose);lastRendered.current=window.KinolotRenderContract.canonical(pose);describeView(instance,pose);}setDisplayMode(instance.mode||"gpu");setReady(true);
    }).catch(e=>{if(live){setError(stage+": "+String(e?.message||"Display unavailable").slice(0,240)+". Your cameras are unchanged. Retry below.");setReady(false);}});
    return ()=>{live=false;if(viewer.current===instance)viewer.current=null;instance?.dispose();if(lighted){if(lit.current===lighted)lit.current=null;lighted.dispose();}setDressedView(null);};
  },[open,spec,attempt,softwareOnly]);
  React.useEffect(()=>{
    if(!open||!ready||!pose||!candidate.current||!viewer.current)return;
    try{paint(viewer.current,candidate.current,pose);setDisplayMode(viewer.current.mode||"gpu");lastRendered.current=window.KinolotRenderContract.canonical(pose);describeView(viewer.current,pose);}catch(e){setError(e.message);setReady(false);}
  },[open,ready,pose]);
  React.useEffect(()=>setInspection(null),[pose]);
  function describeView(instance,camera){
    let text="View direction";
    try{
      const hit=instance.inspect(camera,.5,.5);
      const name=String(hit.name||"").split(/[,;]| — /)[0].replace(/\s+/g," ").trim();
      text=hit.kind==="background"?(lit.current?"Looking across the set":"Looking into unmodelled space"):name?"Looking toward "+(name.length>72?name.slice(0,69)+"…":name):"Looking into the set";
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
    setError("");try{const location=guard();
      const title=name.trim().slice(0,100);if(!title)throw Error("Name this camera angle before saving it.");
      const id=keepAngle(location,title);
      setExtraId(id);setNotice("Saved “"+title+"” as an extra camera. The four panel cameras are unchanged.");
    }catch(e){setError(e.message);}
  }
  // the extra camera this angle is kept as (a new one, or the one being edited): saved on the location under a name
  function keepAngle(location,title){
    const views=locationCoverageViews(location),id=extraId||"angle-"+window.crypto.randomUUID();
    const existing=extraId&&views.find(v=>v.id===extraId&&!v.panel);
    if(extraId&&!existing)throw Error("That extra camera was removed. Close and reopen the preview.");
    const text=locationPoseFreeText(pose,locationSpaceAnchors(location));
    const view={...(existing||{id,purpose:"",visibleAnchors:"",staging:emptyStaging()}),name:title,pose:{...pose,position:[...pose.position],basis:"user"},
      cameraPosition:existing?.cameraPosition||text.cameraPosition,target:existing?.target||text.target,lens:pose.lensMm+" mm"};
    onUpdate(location.id,{coverageViews:existing?views.map(v=>v.id===id?view:v):views.concat(view)});
    return id;
  }
  // the scenes that play in this place, with their beats and planned shots (shot-angle.js)
  function shotTargets(){
    const A=window.KinolotShotAngle,C=window.turnContinuity||{};
    if(!A)return [];
    try{return A.targets(current()||l,{locations:list(),scenes:C.scenes||[],shots:C.shots||[],plans:(window.turnProject||{}).scenePlans||{}});}catch(_){return [];}
  }
  function openUse(){
    setError("");setNotice("");
    const scenes=shotTargets(),first=scenes.find(s=>s.planned&&s.beats.length);
    setUse({sceneId:first?first.id:"",beatN:first?first.beats[0].n:0,shotId:first?first.beats[0].shots[0].id:"",name:extraId?name:""});
  }
  function useInShot(){
    setError("");try{
      const location=guard(),A=window.KinolotShotAngle,scenes=shotTargets();
      const scene=scenes.find(s=>s.id===use?.sceneId),beat=scene?.beats.find(b=>b.n===use.beatN),shot=beat?.shots.find(x=>x.id===use.shotId);
      if(!scene||!beat||!shot)throw Error("Choose the scene, the beat and the shot this angle goes to.");
      if(typeof window.turnUseAngleInShot!=="function")throw Error("The Shots tab did not load. Refresh this page.");
      const title=(use.name||"").trim().slice(0,100)||A.angleName(scene,beat.n);
      // kept on the location under its name, so it can go to other shots too
      const angleId=keepAngle(location,title);
      const done=window.turnUseAngleInShot({sceneId:scene.id,shotId:shot.id,pose:{position:[...pose.position],yaw:pose.yaw,pitch:pose.pitch,lensMm:pose.lensMm},
        floorZ:A.floorAt(location,list(),pose.position[0],pose.position[1]),from:{locationId:location.id,locationName:location.name||"",angleId,angleName:title}});
      if(!done||!done.ok)throw Error((done&&done.error)||"The angle could not be put into that shot.");
      setExtraId(angleId);setName(title);setUse(null);setOpen(false);
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
      setNotice(labels[destination]+" now uses this camera angle. Previs redraws the set from it.");
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
  return <div className={"loc-angle-entry"+(inline?" loc-angle-entry-inline":"")}>
    <span className="loc-camera-control"><button type="button" className="art-draftall ghost" data-testid="camera-workbench-open" onClick={()=>begin()}>{label||"Preview & choose camera angles"}</button>
      {window.InfoTip&&<window.InfoTip label="About camera previews" text="Free and live: move a camera and see the set as Previs draws it, lit and with its dressing on. The set itself is never changed. A camera changes only when you save it; Previs then redraws from it."/>}</span>
    {!open&&error&&<p role="alert" className="loc-spatial-error">{error}</p>}
    {!open&&notice&&<p role="status" className="loc-layer-note">{notice}</p>}
    {open&&spec&&pose&&<dialog ref={dialog} className="loc-angle-dialog" onCancel={()=>setOpen(false)} aria-label="Preview and choose a camera angle">
      <div className="loc-cloud-render-head"><h3>Edit {labels[editing].toLowerCase()} camera</h3><button type="button" className="art-draftall ghost" onClick={()=>setOpen(false)}>Close preview</button></div>
      <p className="loc-layer-note">{l.name||"This location"} · choose a camera, adjust its view, then save. These previews are free; changes stay unsaved until you save the camera.{dressedView&&<span data-testid="camera-workbench-dressed">{dressedView.dressed?" Shown as Previs draws it: lit and dressed ("+dressedView.parts+" shapes).":" Shown as Previs draws it: lit, in plain blocks until the set is dressed."}</span>}</p>
      <div className="loc-angle-compare">
        <figure><figcaption><strong>{labels[editing]} · {unchanged?"saved view":"unsaved preview"}</strong><span>{viewLabel?.key===window.KinolotRenderContract.canonical(pose)?viewLabel.text:"Updating view…"} · {pose.lensMm} mm lens{start.startsWith("extra:")?" · using "+name:""}</span></figcaption><canvas ref={candidate} width={640} height={360} tabIndex={0} role="button" aria-label="Identify an object in the candidate preview; press Enter to inspect the centre" onClick={e=>identify(e)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();identify(null);}}}/></figure>
        <div className="loc-angle-destinations"><p><strong>Choose a camera to edit</strong><span>The highlighted camera matches the large preview.</span></p><div className="loc-angle-panels" role="group" aria-label="Camera to edit">
          {Object.keys(labels).map(panel=><button key={panel} type="button" className={"loc-angle-panel"+(editing===panel?" selected":"")} aria-pressed={editing===panel} onClick={()=>{if(panel!==editing)chooseStart(panel);}}>
            <span>{labels[panel]}{editing===panel?" · editing":""}</span><canvas width={320} height={180} ref={el=>thumbs.current[panel]=el} aria-label={labels[panel]+" saved camera layout preview"}/>
          </button>)}
        </div></div>
      </div>
      <div className="loc-angle-inspection" role="status" aria-live="polite">
        <p className="loc-layer-note">{dressedView?"Click or tap the large preview to name a wall, a floor, an opening or an object of the floor plan. The dressing is drawn but not named.":"Click or tap the large preview to identify a surface or opening. Blue background means unmodelled space."}</p>
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
      {(()=>{
        // USE THIS ANGLE IN A SHOT: the scene, then the beat, then the shot. The last choice is always a shot.
        const scenes=use?shotTargets():[],scene=scenes.find(s=>s.id===use?.sceneId)||null,beat=scene?.beats.find(b=>b.n===use.beatN)||null;
        const sceneLabel=s=>"Scene "+String(s.no==null?"":s.no).padStart(2,"0")+(s.title?" \u00b7 "+s.title:"")+(s.planned?"":" \u00b7 not planned yet");
        const pickScene=id=>{const s=scenes.find(x=>x.id===id),b=s&&s.planned?s.beats[0]:null;setUse(u=>({...u,sceneId:id,beatN:b?b.n:0,shotId:b?b.shots[0].id:""}));};
        const pickBeat=n=>{const b=scene?.beats.find(x=>x.n===n);setUse(u=>({...u,beatN:n,shotId:b?b.shots[0].id:""}));};
        return <div className="loc-angle-use" data-testid="angle-use">
          {!use&&<button type="button" className="art-draftall ghost" data-testid="angle-use-open" disabled={readOnly||!ready||!!problem} onClick={openUse}>Use this angle in a shot</button>}
          {!use&&window.InfoTip&&<window.InfoTip label="About using an angle in a shot" text="Gives one planned shot this camera: where it stands, how high, the way it looks and its lens. The shot’s Previs is then drawn from it, with each person on the mark the scene plan gave them. The angle is also saved on this location under a name, so it can go to other shots. It is free, changes no frame and no approval, and a shot can return to its planned camera."/>}
          {use&&<section className="loc-angle-use-pick" aria-label="Use this angle in a shot" data-testid="angle-use-pick">
            <h4 className="loc-angle-group-title">Use this angle in a shot</h4>
            {!scenes.length&&<p className="loc-layer-note" data-testid="angle-use-none">No scene with shots plays in this place yet. Draft the shots of a scene set here, then plan that scene in the Shots tab.</p>}
            {scenes.length>0&&<>
              <label className="loc-cam-field"><span>1 · Scene</span><select className="prop-select" aria-label="Scene" data-testid="angle-use-scene" value={use.sceneId} onChange={e=>pickScene(e.target.value)}>
                {!use.sceneId&&<option value="">Choose a scene</option>}
                {scenes.map(s=><option key={s.id} value={s.id} disabled={!s.planned||!s.beats.length}>{sceneLabel(s)}</option>)}
              </select></label>
              <label className="loc-cam-field"><span>2 · Beat</span><select className="prop-select" aria-label="Beat" data-testid="angle-use-beat" value={use.beatN||""} disabled={!scene} onChange={e=>pickBeat(Number(e.target.value))}>
                {(scene?.beats||[]).map(b=><option key={b.n} value={b.n}>Beat {b.n} · {b.shots.length} shot{b.shots.length!==1?"s":""}</option>)}
              </select></label>
              <label className="loc-cam-field"><span>3 · Shot</span><select className="prop-select" aria-label="Shot" data-testid="angle-use-shot" value={use.shotId} disabled={!beat} onChange={e=>setUse(u=>({...u,shotId:e.target.value}))}>
                {(beat?.shots||[]).map(x=><option key={x.id} value={x.id}>{x.label}{x.hand?" \u00b7 has an angle of yours":""}</option>)}
              </select></label>
              <label className="loc-cam-field"><span>Name of this angle</span><input className="prop-select" data-testid="angle-use-name" value={use.name} maxLength={100} placeholder={scene&&beat?window.KinolotShotAngle.angleName(scene,beat.n):"Angle"} onChange={e=>setUse(u=>({...u,name:e.target.value}))}/></label>
              {scenes.some(s=>!s.planned)&&<p className="loc-layer-note">A scene that is not planned yet cannot take an angle: plan it in the Shots tab first.</p>}
              {scene&&scene.waiting>0&&<p className="loc-layer-note">{scene.waiting} shot{scene.waiting!==1?"s":""} of this scene {scene.waiting!==1?"are":"is"} not in its plan and cannot take an angle yet.</p>}
            </>}
            <div className="loc-cloud-render-actions">
              <button type="button" className="art-draftall" data-testid="angle-use-confirm" disabled={readOnly||!ready||!!problem||!use.shotId} onClick={useInShot}>Use in this shot</button>
              <button type="button" className="art-draftall ghost" onClick={()=>setUse(null)}>Cancel</button>
            </div>
          </section>}
        </div>;
      })()}
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
    <p className="loc-layer-note">Proposed 3D views · review before saving {window.InfoTip&&<window.InfoTip label="About proposed views" text="These free views use saved set geometry with simplified materials and lighting. Check framing and obstructions before choosing Use these cameras. Previs shows the set lit and dressed from them."/>}</p>
    <div className="loc-angle-panels">
      {proposal.panels.map(panel=><figure key={panel.key} className="loc-angle-panel" style={{margin:0}}>
        <figcaption>{labels[panel.key]} · {panel.label}</figcaption>
        {proposal.imageMatch&&<><div className="loc-match-reference"><img src={proposal.referenceUrl} alt={labels[panel.key]+" ideas reference"} style={{left:panel.key.endsWith("R")?"-100%":0,top:panel.key.startsWith("B")?"-100%":0}}/></div><p className="loc-layer-note">Ideas reference above · achievable 3D view below</p></>}
        <button type="button" className="loc-camera-open-view" onClick={()=>setExpanded(panel.key)} aria-label={"Open "+panel.label+" 3D preview"}>
          <canvas width={320} height={180} ref={node=>canvases.current[panel.key]=node} aria-label={panel.label+" proposed 3D layout preview"}/>
        </button>
      </figure>)}
    </div>
    {expanded&&<dialog ref={dialog} className="loc-angle-dialog loc-proposed-angle-dialog" onCancel={()=>setExpanded("")} aria-label="Proposed camera view">
      <div className="loc-cloud-render-head"><h3>{labels[expanded]} · {proposal.panels.find(p=>p.key===expanded)?.label}</h3>
        <button type="button" className="art-draftall ghost" onClick={()=>setExpanded("")}>Close preview</button></div>
      <p className="loc-layer-note">{l.name} · proposed camera, before saving. Close this preview and choose Use these cameras to accept the four views; then Preview &amp; choose camera angles lets you adjust them.</p>
      {proposal.imageMatch&&<><p className="loc-layer-note">Approximate image match · compare composition, visible features and obstructions. The set stays fixed.</p><div className="loc-match-reference"><img src={proposal.referenceUrl} alt={labels[expanded]+" ideas reference"} style={{left:expanded.endsWith("R")?"-100%":0,top:expanded.startsWith("B")?"-100%":0}}/></div></>}
      <canvas width={640} height={360} ref={large} aria-label={labels[expanded]+" proposed camera view"}/>
    </dialog>}
    {!ready&&!error&&<p role="status" className="loc-layer-note">Preparing the proposed camera views…</p>}
    {error&&<div role="alert" className="loc-spatial-error"><p>{error} Your saved cameras are unchanged.</p>
      <button type="button" className="art-draftall ghost" onClick={()=>setAttempt(n=>n+1)}>Retry 3D previews</button></div>}
  </section>;
}
window.LocationSuggestedCameraPreviews=LocationSuggestedCameraPreviews;

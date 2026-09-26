/* Blender Studio is deliberately a set/shot workspace, not another image tab. */
const _bsEl=React.createElement;
function bsText(error,fallback){return String((error&&error.message)||error||fallback||"Blender Studio request failed.");}
function bsClone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function bsProductionPlan(workspace){
  const raw=workspace&&workspace.context&&workspace.context.productionPlan;
  if(!raw)return null;
  try{return typeof raw==="string"?JSON.parse(raw):raw;}catch(_){return null;}
}
function bsRefs(items){
  return (items||[]).filter(x=>x&&x.entityId&&["location","character","prop"].includes(x.kind))
    .map(x=>({entityId:String(x.entityId),label:String(x.label||x.entityId),kind:x.kind,version:x.version}));
}
function BlenderStudioEntry({location,shot,references,readOnly=false,compact=false,autoOpen=false}){
  const client=typeof window!=="undefined"?window.BlenderStudio:null;
  const [open,setOpen]=React.useState(autoOpen),[workspace,setWorkspace]=React.useState(null),[base,setBase]=React.useState(null);
  const [caps,setCaps]=React.useState(null),[error,setError]=React.useState(""),[loading,setLoading]=React.useState(false);
  const [saving,setSaving]=React.useState(false),[prompt,setPrompt]=React.useState(""),[mode,setMode]=React.useState("scene");
  const [modelId,setModelId]=React.useState(""),[ack,setAck]=React.useState(false),[task,setTask]=React.useState(null);
  const [proposal,setProposal]=React.useState(null),[settlementPolls,setSettlementPolls]=React.useState(0);
  const [selectedRef,setSelectedRef]=React.useState(location&&location.id||"");
  const [sourceImage,setSourceImage]=React.useState(null);
  const [history,setHistory]=React.useState([]),[previewUrls,setPreviewUrls]=React.useState({});
  const [connection,setConnection]=React.useState(null);
  const alive=React.useRef(true), generation=React.useRef(0), scopeRef=React.useRef(null);
  const readOnlyLive=React.useRef(readOnly);readOnlyLive.current=readOnly;
  React.useEffect(()=>()=>{alive.current=false;generation.current++;},[]);
  const guard=React.useCallback((token,scope)=>()=>alive.current&&generation.current===token&&!readOnlyLive.current&&
    !!(client&&client.isCurrent&&client.isCurrent(scope)),[client,readOnly]);
  const referenceList=React.useMemo(()=>bsRefs(references),[references]);
  const load=React.useCallback(async()=>{
    if(!client){setError("Blender Studio is unavailable in this build.");return;}
    if(!location||!location.id){setError("This entry has no canonical location reference.");return;}
    const token=++generation.current, startingReadOnly=readOnlyLive.current;let requestScope=null;setLoading(true);setError("");
    try{
      const scope=client.scope();requestScope=scope;scopeRef.current=scope;
      const ok=()=>alive.current&&generation.current===token&&readOnlyLive.current===startingReadOnly&&client.isCurrent(scope);
      const source=await client.requireImage(location.id,scope,ok);if(!ok())return;setSourceImage(source);
      const out=await client.capabilities(scope,ok);if(!ok())return;
      const capability=out.capabilities||out;setCaps(capability);
      if(capability.sourcePolicy!=="generated-project-image-v1")
        throw new Error("Blender Studio needs the updated image-derived relay before it can open. No generation has been started.");
      // View-only users may inspect an already saved workspace, but do not run
      // the selecting/creating open action against the paired desktop.
      const ws=startingReadOnly ? await client.get(location.id,scope,ok)
        : await client.open({location,shot:shot||undefined,references:referenceList},scope,ok);if(!ok())return;
      setWorkspace(ws);setBase(ws.revision);setTask(null);setProposal(null);setPreviewUrls({});
      setSelectedRef(location.id);
    }catch(e){
      // A switched film/identity must not paint even an error over the newly
      // mounted workspace. BlenderPreview/client already aborted the response.
      if(alive.current&&generation.current===token&&(!requestScope||client.isCurrent(requestScope)))
        setError(bsText(e,"Could not open Blender Studio."));
    }finally{if(alive.current&&generation.current===token&&(!requestScope||client.isCurrent(requestScope)))setLoading(false);}
  },[client,location&&location.id,shot&&shot.id,referenceList.map(x=>x.entityId+":"+x.kind).join("|")]);
  React.useEffect(()=>{if(autoOpen)load();},[autoOpen,load]);
  const save=async(next)=>{
    if(readOnly){setError("View-only access cannot save Blender Studio.");return null;}
    if(!client||!scopeRef.current||!next)return null;
    const token=generation.current, scope=scopeRef.current;setSaving(true);setError("");
    try{const saved=await client.save(next,base,scope,guard(token,scope));if(!guard(token,scope)())return null;
      setWorkspace(saved);setBase(saved.revision);return saved;
    }catch(e){if(guard(token,scope)())setError(bsText(e,"Save conflict: reload the workspace; unsaved changes remain in this panel."));return null;}
    finally{if(guard(token,scope)())setSaving(false);}
  };
  const submit=async(kind)=>{
    if(readOnly){setError("View-only access cannot submit paid Blender Studio work.");return;}
    if(caps&&caps.billingReady===false){
      setError(caps.billingMessage||caps.billingError||"Paid AI is disabled pending approval of the atomic credit update.");
      return;
    }
    if(!workspace||!prompt.trim()||!ack){setError(!ack?"Confirm paid processing before sending.":"Write a prompt before sending.");return;}
    if(!selectedRef){setError("Select a generated project image to derive this work from.");return;}
    if(!modelId){setError("Select a model advertised by the Blender Studio service.");return;}
    const token=generation.current,scope=scopeRef.current; if(!scope)return; setError("");setProposal(null);setSettlementPolls(0);
    try{
      const source=await client.requireImage(workspace.locationId,scope,guard(token,scope));
      if(!guard(token,scope)())return;
      if(source.reference.version!==sourceImage.reference.version)throw new Error("The location image changed. Reload Studio to use its current version.");
    }catch(e){if(guard(token,scope)())setError(bsText(e,"The selected reference could not be loaded."));return;}
    const payload={locationId:workspace.locationId,baseRevision:base,requestId:client.mutationId(),modelId,prompt:prompt.trim(),
      acknowledgeCost:true,referenceId:kind==="assistant"&&mode==="scene"?workspace.locationId:selectedRef,
      ...(kind==="assistant"?{mode,shotId:shot&&shot.id,snapshot:bsClone(workspace)}:
        {name:(shot&&shot.name)||(location&&location.name)||"Studio asset",rigged:false,animated:false})};
    try{const result=await (kind==="assistant"?client.assistantSubmit(payload,scope,guard(token,scope)):client.meshSubmit(payload,scope,guard(token,scope)));
      if(!guard(token,scope)())return;const next=result.task||result;setTask(next);
       setHistory(h=>[...h,{id:next.id+"-ask",role:"Director",text:prompt.trim()},{id:next.id,role:"Studio",text:next.message||("Task "+next.status)}]);
       setSettlementPolls(0);if(next.status==="completed"&&next.proposal)setProposal(next.proposal);
    }catch(e){if(guard(token,scope)())setError(bsText(e));}
  };
  const cancel=async()=>{
    if(!task||!task.id||!client||!scopeRef.current)return;const token=generation.current,scope=scopeRef.current;
    try{const r=await (task.type==="mesh"?client.meshCancel(task.id,scope,guard(token,scope)):client.assistantCancel(task.id,scope,guard(token,scope)));
      if(guard(token,scope)())setTask(r.task||r);}catch(e){if(guard(token,scope)())setError(bsText(e,"Could not cancel the task."));}
  };
  const retrySettlement=async()=>{
    if(readOnly||!task||task.status!=="settlement_pending"||!client||!scopeRef.current)return;
    const token=generation.current,scope=scopeRef.current;
    try{
      const result=await (task.type==="mesh"?client.meshGet(task.id,scope,guard(token,scope)):client.assistantGet(task.id,scope,guard(token,scope)));
      if(!guard(token,scope)())return;const next=result.task||result;setTask(next);setSettlementPolls(n=>n+1);
      if(next.status==="completed"&&next.proposal)setProposal(next.proposal);
    }catch(e){if(guard(token,scope)())setError(bsText(e,"Credit settlement retry could not be read."));}
  };
  React.useEffect(()=>{
    const settlementPending=task&&task.status==="settlement_pending";
    if(!task||!task.id||(!["queued","running"].includes(task.status)&&(!settlementPending||settlementPolls>=3))||!client||!scopeRef.current||readOnly) return;
    let active=true;const token=generation.current,scope=scopeRef.current;
    const timer=setTimeout(async()=>{
      try{
        const result=await (task.type==="mesh"?client.meshGet(task.id,scope,guard(token,scope)):client.assistantGet(task.id,scope,guard(token,scope)));
        if(!active||!guard(token,scope)())return;const next=result.task||result;setTask(next);
        if(settlementPending)setSettlementPolls(n=>n+1);
        if(next.status==="completed"&&next.proposal)setProposal(next.proposal);
        if(next.status!==task.status||next.message!==task.message)setHistory(h=>[...h,{id:next.id+"-"+next.status,role:"Studio",text:next.message||("Task "+next.status)}]);
      }catch(e){if(active&&guard(token,scope)())setError(bsText(e,"Could not read task progress."));}
    },settlementPending?5000:1800);
    return()=>{active=false;clearTimeout(timer);};
  },[task&&task.id,task&&task.status,task&&task.message,settlementPolls,client,readOnly]);
  React.useEffect(()=>{
    if(!workspace||!client||!scopeRef.current||!(workspace.previews||[]).length)return;
    let active=true;const token=generation.current,scope=scopeRef.current;
    (async()=>{
      const next={};
      for(const preview of workspace.previews){
        if(!preview||!preview.id)continue;
        try{const result=await client.previewGet(workspace.locationId,preview.id,scope,guard(token,scope));
          if(!active||!guard(token,scope)())return;
          const data=result&&result.pngBase64;
          if(data)next[preview.id]=data.indexOf("data:")===0?data:"data:image/png;base64,"+data;
        }catch(e){if(active&&guard(token,scope)())setError(bsText(e,"A Studio preview could not be loaded."));return;}
      }
      if(active&&guard(token,scope)())setPreviewUrls(next);
    })();return()=>{active=false;};
  },[workspace&&workspace.locationId,workspace&&workspace.revision,client]);
  const apply=async()=>{if(!workspace||!proposal||!task||task.status!=="completed"){setError("A paid task must complete before its proposal can be applied.");return;}try{const next=client.applyProposal(workspace,proposal);const saved=await save(next);if(saved)setProposal(null);}
    catch(e){setError(bsText(e,"The proposal could not be applied."));}};
  const addAsset=async(asset)=>{
    if(!asset||!asset.id||!workspace)return;
    if((workspace.assets||[]).some(a=>a.id===asset.id)){setError("This generated asset is already in the set library.");return;}
    await save({...workspace,assets:[...(workspace.assets||[]),bsClone(asset)]});
  };
  const importAsset=async(asset)=>{
    if(!asset||!asset.id||!workspace)return;
    const object={id:"asset-"+asset.id+"-"+Date.now().toString(36),name:asset.name||"Imported asset",kind:"mesh",
      position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],color:[1,1,1],assetId:asset.id,...(asset.characterId?{characterId:asset.characterId}:{})};
    await save({...workspace,objects:[...(workspace.objects||[]),object]});
  };
  const advertised=(caps&&((mode==="mesh"?caps.meshModels:caps.models)||[]))||[];
  const billingDisabled=!!caps&&caps.billingReady===false;
  const billingMessage=caps&&(caps.billingMessage||caps.billingError)||
    "Paid AI is disabled pending approval of the atomic credit update.";
  // The relay is authoritative. Configured access may be pending independent
  // verification; it stays selectable with an honest label and the relay may
  // reject it explicitly. We never substitute another model on that rejection.
  const models=advertised.filter(m=>m&&m.configured&&m.selectable!==false&&(mode!=="mesh"||(m.modelId||m.id)==="meshy/v7/image-to-3d"));
  React.useEffect(()=>{
    if(modelId&&!models.some(m=>(m.modelId||m.id||m)===modelId))setModelId("");
  },[mode,models.map(m=>m.modelId||m.id||m).join("|")]);
  const productionPlan=bsProductionPlan(workspace);
  return _bsEl("section",{className:"bs-entry"+(compact?" bs-compact":""),"data-testid":"blender-studio-entry"},
    !autoOpen&&_bsEl("div",{className:"bs-head"},_bsEl("div",null,_bsEl("strong",null,"Blender Studio"),_bsEl("small",null,"Derive a reusable set from your generated location image.")),
      _bsEl("button",{type:"button",className:"char-draft-btn ghost",onClick:()=>{setOpen(v=>!v);if(!open)load();}},open?"Close studio":"Open Studio")),
    open&&_bsEl("div",{className:"bs-body"},
      readOnly&&_bsEl("p",{className:"bs-warning"},"View-only access: you can review this set, but sending, applying and saving are disabled."),
      sourceImage&&_bsEl("div",{className:"bs-derived-source"},_bsEl("img",{src:sourceImage.url,alt:"Generated source for "+location.name}),
        _bsEl("div",null,_bsEl("strong",null,"Derived from "+location.name),_bsEl("p",null,"This generated image and the shared layout guide the set. Unseen geometry still needs review; this is not an exact reconstruction."))),
      shot&&_bsEl("p",{className:"bs-help"},"New shot cameras start as approximate blockouts from the shot settings. Existing saved cameras are kept; review placement in Blender."),
      productionPlan&&_bsEl("p",{className:"bs-disclosure bs-plan-summary"},
        "Production package: "+(productionPlan.screenplaySpaces||[]).length+" slugline unit"+((productionPlan.screenplaySpaces||[]).length===1?"":"s")+
        " · "+(productionPlan.appearanceStates||[]).length+" time-of-day variant"+((productionPlan.appearanceStates||[]).length===1?"":"s")+
        " · "+(productionPlan.coverageViews||[]).length+" coverage view"+((productionPlan.coverageViews||[]).length===1?"":"s")+
        " · "+(productionPlan.sceneSetups||[]).length+" scene setup"+((productionPlan.sceneSetups||[]).length===1?"":"s")),
      loading&&_bsEl("p",{className:"bs-loading",role:"status"},"Opening the set workspace…"),
      error&&!workspace&&_bsEl("div",{className:"bs-error bs-central-error",role:"alert"},error,_bsEl("button",{type:"button",className:"bs-button",onClick:load},"Retry opening Studio")),
      _bsEl("ol",{className:"bs-steps","aria-label":"Blender Studio workflow"},
        workspace&&window.BlenderStudioSetup?_bsEl(window.BlenderStudioSetup,{client,readOnly,locationId:location.id,onConnectionChange:setConnection}):null,
        workspace&&_bsEl("li",{className:"bs-step"},_bsEl("div",{className:"bs-step-heading"},_bsEl("span",{className:"bs-step-number"},"3"),_bsEl("span",{className:"bs-step-label"},_bsEl("strong",null,"Choose what to make"),_bsEl("small",null,"Review a proposal before it changes the saved set."))),
          _bsEl("div",{className:"bs-step-body"},_bsEl("div",{className:"bs-composer"},_bsEl("div",{className:"bs-tabs"},
          _bsEl("button",{type:"button",className:mode==="scene"?"on":"",onClick:()=>setMode("scene")},"AI Scene Builder"),
          _bsEl("button",{type:"button",className:mode==="animation"?"on":"",onClick:()=>setMode("animation")},"Character animation"),
          _bsEl("button",{type:"button",className:mode==="mesh"?"on":"",onClick:()=>setMode("mesh")},"Image to 3D")),
          _bsEl("p",{className:"bs-help"},mode==="scene"?"Derive the set from the location image and shared layout. Describe refinements without redesigning its geometry. Nothing changes until you Apply.":mode==="mesh"?"Choose a generated location, character or prop image, then describe how to translate it into a 3D asset.":"Describe movement for an image-backed character or camera in this shot. This edits blocking; it does not create a complete character performance."),
          billingDisabled&&_bsEl("p",{className:"bs-warning",role:"alert"},billingMessage),
          _bsEl("textarea",{value:prompt,onChange:e=>setPrompt(e.target.value),disabled:readOnly,"aria-label":"Describe what to create",placeholder:mode==="animation"?"Describe how the character or camera should move…":mode==="mesh"?"Describe the 3D model you want to create…":"Describe your set or the change you want to make…"}),
          _bsEl("label",{className:"bs-source"},"Source image",
            _bsEl("select",{"aria-label":"Generated source image",value:mode==="scene"?location.id:selectedRef,
              onChange:e=>setSelectedRef(e.target.value),disabled:readOnly||mode==="scene"},
              (workspace.references||[]).map(r=>_bsEl("option",{key:r.entityId,value:r.entityId},r.kind+" · "+r.label)))),
          _bsEl("p",{className:"bs-help"},"Only saved generated project images are available. Text refines the source; it cannot replace it."),
          _bsEl("div",{className:"bs-send"},_bsEl("select",{value:modelId,onChange:e=>setModelId(e.target.value),disabled:readOnly},_bsEl("option",{value:""},"Select available model…"),
            models.map(m=>_bsEl("option",{key:m.modelId||m.id||m,value:m.modelId||m.id||m},(m.label||m.modelId||m.id||m)+(m.verified?" · verified":" · configured; verification not live")))),
            _bsEl("label",null,_bsEl("input",{type:"checkbox",checked:ack,onChange:e=>setAck(e.target.checked),disabled:readOnly})," I acknowledge paid processing"),
            _bsEl("button",{type:"button",disabled:readOnly||billingDisabled||!caps||!models.length,onClick:()=>submit(mode==="mesh"?"mesh":"assistant")},mode==="mesh"?"Generate 3D asset":"Send to scene builder"),
            _bsEl("small",null,modelId&&models.some(m=>(m.modelId||m.id||m)===modelId&&!m.verified)?"This model is not verified yet. If unavailable, the request will stop; no other model will be used.":!models.length?"No configured models are available for this mode.":!modelId?"Choose a model to continue.":"The selected model is verified."))))),
        workspace&&_bsEl("li",{className:"bs-step"},_bsEl("div",{className:"bs-step-heading"},_bsEl("span",{className:"bs-step-number"},"4"),_bsEl("span",{className:"bs-step-label"},_bsEl("strong",null,"Review, apply, and use the set"),_bsEl("small",null,"Apply saves your changes. In Blender, use Open current workspace the first time, then Refresh after changes."))),
          _bsEl("div",{className:"bs-step-body"},
        !task&&_bsEl("p",{className:"bs-help"},"Your results will appear here. Review proposed changes before applying them."),
        task&&_bsEl("div",{className:"bs-task"},_bsEl("b",null,"Task: "+task.status),task.message&&_bsEl("span",null,task.message),
          ["queued","running"].includes(task.status)&&_bsEl("button",{type:"button",onClick:cancel,disabled:readOnly},"Cancel"),
          task.status==="settlement_pending"&&_bsEl(React.Fragment,null,
            _bsEl("p",{className:"bs-warning"},"Credit settlement pending. "+(task.billingMessage||task.settlementMessage||task.message||"The provider result is held until payment settlement succeeds.")),
            _bsEl("button",{type:"button",onClick:retrySettlement,disabled:readOnly},"Retry credit settlement"),
            _bsEl("button",{type:"button",disabled:true},"Apply proposal and save"))),
        proposal&&task&&task.status==="completed"&&_bsEl("div",{className:"bs-proposal"},_bsEl("b",null,"Proposal preview"),_bsEl("p",null,proposal.summary||"Managed scene edits"),
          _bsEl("p",null,(proposal.ops||[]).length+" bounded edit"+((proposal.ops||[]).length===1?"":"s")+"; nothing changes until Apply."),
          _bsEl("button",{type:"button",onClick:apply,disabled:readOnly||saving},"Apply proposal and save")),
        ((workspace.assets||[]).length>0||mode==="mesh")&&_bsEl("div",{className:"bs-library"},_bsEl("b",null,"Generated asset library"),(workspace.assets||[]).length
          ? _bsEl("ul",null,(workspace.assets||[]).map(a=>_bsEl("li",{key:a.id},a.name+" · "+(a.rigged?"rigged ":"")+(a.animated?"animated":"GLB"),
            _bsEl("button",{type:"button",disabled:readOnly||saving,onClick:()=>importAsset(a)},"Import to set"))))
          : _bsEl("p",null,"No generated GLB assets in this set yet.")),
        task&&task.asset&&_bsEl("button",{type:"button",disabled:readOnly||saving,onClick:()=>addAsset(task.asset)},"Save generated asset to library"),
        Object.keys(previewUrls).length>0&&_bsEl("div",{className:"bs-previews"},_bsEl("b",null,"Studio previews"),Object.keys(previewUrls).map(id=>_bsEl("img",{key:id,src:previewUrls[id],alt:"Studio preview "+id}))),
        _bsEl("details",{className:"bs-details"},_bsEl("summary",null,"Workspace details"),_bsEl("div",{className:"bs-state"},_bsEl("span",null,"Revision "+workspace.revision),_bsEl("span",null,"Objects: "+(workspace.objects||[]).length),_bsEl("span",null,"Shots: "+(workspace.shots||[]).length),_bsEl("span",null,"Assets: "+(workspace.assets||[]).length),_bsEl("span",null,"Previews: "+(workspace.previews||[]).length),
          _bsEl("button",{type:"button",disabled:saving||readOnly,onClick:()=>save(workspace)},saving?"Saving…":"Save workspace"),
          _bsEl("button",{type:"button",onClick:load},"Reload (discard panel changes)")),
          _bsEl("p",{className:"bs-model-diagnostics"},advertised.length?advertised.map(m=>(m.modelId||m.id)+" · "+(m.configured?"configured":"unavailable")+" · "+(m.verified?"verified":"verification not live")+(m.selectable===false?" · not selectable":"")).join("  |  "):"No server-advertised models available."),
          _bsEl("div",{className:"bs-history"},_bsEl("b",null,"Scene-builder chat history"),history.length?_bsEl("ul",null,history.map(h=>_bsEl("li",{key:h.id},_bsEl("b",null,h.role+": "),h.text))):_bsEl("p",null,"No requests in this panel yet."))))),
        ),
      error&&workspace&&_bsEl("p",{role:"alert",className:"bs-error"},error),
      connection&&connection.connected&&_bsEl("p",{className:"bs-connection-note"},"Paired with "+(connection.deviceName||"your computer")+". Once Blender shows Connected, use Open current workspace there, then Refresh after saving or applying this set.")));
}
window.BlenderStudioEntry=BlenderStudioEntry;

function useBlenderGeneratedImages(){
  const [version,bump]=React.useState(0);
  React.useEffect(()=>{
    let live=true;const update=()=>{if(live)bump(v=>v+1);};
    window.addEventListener("nb-gen-done",update);
    window.addEventListener("studio-workspace-opened",update);
    if(window.nbPrefetchAll)Promise.resolve(window.nbPrefetchAll()).then(update,()=>{});
    return()=>{live=false;window.removeEventListener("nb-gen-done",update);window.removeEventListener("studio-workspace-opened",update);};
  },[]);
  return version;
}
function BlenderStudioLaunch({location,shot,references=[],readOnly=false}){
  useBlenderGeneratedImages();
  const ready=location&&window.BlenderStudio&&window.BlenderStudio.generatedReference(location.id);
  return _bsEl("div",{className:"bs-launch"},
    _bsEl("button",{type:"button",className:"char-draft-btn primary bs-launch-button",disabled:!ready||readOnly,
      onClick:()=>window.dispatchEvent(new CustomEvent("turn-open-blender-studio",{detail:{location,shot,references}}))},
      _bsEl(Icon.box,{s:16}),shot?"Open this shot in Blender":window.BlenderStudio&&window.BlenderStudio.wasOpened(location&&location.id)?"Continue in Blender":"Build in Blender"),
    _bsEl("small",null,ready?"Derived from the generated location image.":"Generate this location’s image to unlock Blender."));
}

// The toolbar and contextual buttons use the same canonical location package.
function bsLocationPackage(raw,locations,scenes,drafts,units){
  const keyOf=l=>typeof locationKeyOf==="function"?locationKeyOf(l):l.key||l.id;
  const fold=typeof deriveSubspaceFold==="function"?deriveSubspaceFold(scenes||[],drafts||{}):{};
  const parentOf=l=>locations.find(p=>keyOf(p)===(l.parentKey||fold[keyOf(l)]));
  const parent=parentOf(raw);let root=raw;const seen=new Set([raw.id]);
  for(let p=parent;p&&!seen.has(p.id);p=parentOf(p)){seen.add(p.id);root=p;}
  const l={...raw,key:keyOf(raw),parentLocation:parent||null,rootLocationId:root.id};
  const plan=typeof locationProductionPlan==="function"?locationProductionPlan(l,units||[]):null;
  return {location:{...l,parentLocationId:parent&&parent.id||null,
    context:{description:l.significance||"",architecture:l.architecture||"",materials:l.materials||"",
      staging:l.staging||"",productionPlan:plan}},references:[
    {entityId:l.id,label:l.name,kind:"location"},
    ...(root.id!==l.id?[{entityId:root.id,label:"Parent set · "+root.name,kind:"location"}]:[]),
    ...[...(plan&&plan.screenplaySpaces||[]),...(plan&&plan.appearanceStates||[]),...(plan&&plan.requiredSpacePlates||[])]
      .filter(x=>x.assetId).map(x=>({entityId:x.assetId,label:x.name||x.time||x.id,kind:"location"}))]};
}
function bsStudioShot(shot){
  if(!shot)return undefined;
  // A shot card is not a cm-studio shot. Carry only its supported settings;
  // the starter camera is an approximate blockout, not reconstructed geometry.
  const distance=({EWS:14,WS:8,MWS:6,MS:4,MCU:2.8,CU:1.8,ECU:1.1})[shot.size]||6;
  const angle=String(shot.angle||"").toLowerCase();
  const height=angle.includes("high")?4:angle.includes("low")?.6:1.65;
  const focal=parseFloat(shot.cameraSettings&&shot.cameraSettings.focalLength||shot.lens)||35;
  return {id:shot.id,sceneId:shot.sceneId,name:String(shot.name||shot.title||"Shot "+shot.id).slice(0,120),
    camera:shot.camera&&Array.isArray(shot.camera.position)?bsClone(shot.camera):
      {position:[0,-distance,height],target:[0,0,1.4],focalLength:Math.max(8,Math.min(200,focal)),sensorWidth:36},
    objects:[],tracks:[],frameStart:1,frameEnd:120,fps:24};
}
const BS_EMPTY_ITEMS=[],BS_EMPTY_RECORD={};
function BlenderStudioHost({locations=BS_EMPTY_ITEMS,characters=BS_EMPTY_ITEMS,props:propItems=BS_EMPTY_ITEMS,
  scenes=BS_EMPTY_ITEMS,drafts=BS_EMPTY_RECORD,sluglineUnits=BS_EMPTY_ITEMS,readOnly=false}){
  const [panel,setPanel]=React.useState(null),[selection,setSelection]=React.useState(null);
  const [error,setError]=React.useState(""),[busy,setBusy]=React.useState(false);
  const dialog=React.useRef(null),opener=React.useRef(null),request=React.useRef(0);
  const imageVersion=useBlenderGeneratedImages();
  const client=window.BlenderStudio;
  const close=React.useCallback(()=>{request.current++;setPanel(null);setSelection(null);setBusy(false);setError("");},[]);
  const launch=React.useCallback(async(detail)=>{
    const token=++request.current;setSelection(null);setError("");setBusy(true);
    try{
      const raw=locations.find(l=>String(l.id)===String(detail.location&&detail.location.id));
      if(!raw)throw new Error("Choose a location in this film.");
      const scope=client.scope();
      const source=await client.requireImage(raw.id,scope,()=>request.current===token);
      if(request.current!==token)return;
      const pkg=bsLocationPackage(raw,locations,scenes,drafts,sluglineUnits);
      const refs=[...pkg.references,...(detail.references||[]),
        ...characters.map(c=>({entityId:c.id,label:c.name,kind:"character"})),
        ...propItems.map(p=>({entityId:p.id,label:p.name,kind:"prop"}))];
      setSelection({...pkg,shot:bsStudioShot(detail.shot),references:refs,sourceVersion:source.reference.version,scope});
    }catch(e){if(request.current===token)setError(bsText(e));}
    finally{if(request.current===token)setBusy(false);}
  },[client,locations,scenes,drafts,sluglineUnits,characters,propItems]);
  React.useEffect(()=>{
    const open=e=>{opener.current=document.activeElement;setPanel({});if(e.detail&&e.detail.location)launch(e.detail);};
    window.addEventListener("turn-open-blender-studio",open);
    return()=>{request.current++;window.removeEventListener("turn-open-blender-studio",open);};
  },[launch]);
  React.useEffect(()=>{
    if(!panel||!dialog.current)return;
    const el=dialog.current;el.showModal();
    return()=>{el.close();if(opener.current&&opener.current.isConnected)opener.current.focus({preventScroll:true});};
  },[!!panel]);
  React.useEffect(()=>{
    if(!selection)return;
    const ref=client.generatedReference(selection.location.id);
    if(!client.isCurrent(selection.scope)||!ref||ref.version!==selection.sourceVersion){
      request.current++;setSelection(null);setError("The project or source image changed. Choose a generated location image again.");
    }
  },[imageVersion,selection,client]);
  if(!panel)return null;
  return ReactDOM.createPortal(_bsEl("dialog",{ref:dialog,className:"bs-workspace","aria-labelledby":"bs-workspace-title",
    onCancel:e=>{e.preventDefault();close();}},
    _bsEl("header",{className:"bs-workspace-head"},_bsEl("div",null,
      _bsEl("h2",{id:"bs-workspace-title"},"Blender Studio"),
      _bsEl("p",null,selection?selection.location.name+(selection.shot?" · "+(selection.shot.name||selection.shot.title||"Shot"):""):"Start with an image. Build a reusable set.")),
      _bsEl("button",{type:"button",className:"bs-button",onClick:close,"aria-label":"Close Blender Studio",autoFocus:true},"Close")),
    _bsEl("div",{className:"bs-workspace-content"},
      busy&&_bsEl("p",{role:"status"},"Checking generated source image…"),
      error&&_bsEl("p",{className:"bs-error",role:"alert"},error),
      selection?_bsEl(BlenderStudioEntry,{...selection,readOnly,autoOpen:true,key:selection.location.id+":"+(selection.shot&&selection.shot.id||"")}):
        !busy&&_bsEl(React.Fragment,null,
          _bsEl("p",{className:"bs-help"},"Choose a location with a generated image. Character and prop images become sources inside its workspace; uploads and text alone do not unlock Studio."),
          _bsEl("div",{className:"bs-location-picker"},locations.map(l=>{
            const ready=client&&client.generatedReference(l.id);
            return _bsEl("button",{key:l.id,type:"button",className:"bs-location-choice",disabled:!ready,onClick:()=>launch({location:l})},
              _bsEl(Icon.box,{s:20}),_bsEl("span",null,_bsEl("strong",null,l.name),_bsEl("small",null,ready?"Open image-derived workspace":"Generate a location image first")),_bsEl("span",{"aria-hidden":true},ready?"→":"—"));
          })),!locations.length&&_bsEl("p",null,"Add and generate a location in the Locations tab first.")))),document.body);
}
window.BlenderStudioLaunch=BlenderStudioLaunch;
window.BlenderStudioHost=BlenderStudioHost;

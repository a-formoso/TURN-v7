/* Blender Studio is deliberately a set/shot workspace, not another image tab. */
const _bsEl=React.createElement;
function bsText(error,fallback){return String((error&&error.message)||error||fallback||"Blender Studio request failed.");}
function bsClone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function bsRefs(items){
  return (items||[]).filter(x=>x&&x.entityId&&["location","character","prop"].includes(x.kind))
    .map(x=>({entityId:String(x.entityId),label:String(x.label||x.entityId),kind:x.kind,version:x.version}));
}
function BlenderStudioEntry({location,shot,references,readOnly=false,compact=false}){
  const client=typeof window!=="undefined"?window.BlenderStudio:null;
  const [open,setOpen]=React.useState(false),[workspace,setWorkspace]=React.useState(null),[base,setBase]=React.useState(null);
  const [caps,setCaps]=React.useState(null),[error,setError]=React.useState(""),[loading,setLoading]=React.useState(false);
  const [saving,setSaving]=React.useState(false),[prompt,setPrompt]=React.useState(""),[mode,setMode]=React.useState("scene");
  const [modelId,setModelId]=React.useState(""),[ack,setAck]=React.useState(false),[task,setTask]=React.useState(null);
  const [proposal,setProposal]=React.useState(null),[settlementPolls,setSettlementPolls]=React.useState(0),[imageSource,setImageSource]=React.useState("prompt");
  const [selectedRef,setSelectedRef]=React.useState(""),[privateImage,setPrivateImage]=React.useState("");
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
      const out=await client.capabilities(scope,ok);if(!ok())return;
      const capability=out.capabilities||out;setCaps(capability);
      // View-only users may inspect an already saved workspace, but do not run
      // the selecting/creating open action against the paired desktop.
      const ws=startingReadOnly ? await client.get(location.id,scope,ok)
        : await client.open({location,shot:shot||undefined,references:referenceList},scope,ok);if(!ok())return;
      setWorkspace(ws);setBase(ws.revision);setTask(null);setProposal(null);setPreviewUrls({});
    }catch(e){
      // A switched film/identity must not paint even an error over the newly
      // mounted workspace. BlenderPreview/client already aborted the response.
      if(alive.current&&generation.current===token&&(!requestScope||client.isCurrent(requestScope)))
        setError(bsText(e,"Could not open Blender Studio."));
    }finally{if(alive.current&&generation.current===token&&(!requestScope||client.isCurrent(requestScope)))setLoading(false);}
  },[client,location&&location.id,shot&&shot.id,referenceList.map(x=>x.entityId+":"+x.kind).join("|")]);
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
    if(imageSource==="reference"&&!selectedRef){setError("Select an approved project reference or switch to prompt only.");return;}
    if(imageSource==="private"&&!privateImage){setError("Choose a local temporary image or switch to prompt only.");return;}
    if(!modelId){setError("Select a model advertised by the Blender Studio service.");return;}
    const token=generation.current,scope=scopeRef.current; if(!scope)return; setError("");setProposal(null);setSettlementPolls(0);
    let selectedImage="";
    try{
      // assistant.submit accepts image bytes, not an arbitrary reference ID.
      // Resolve only through the authorized workspace endpoint; local pixels
      // are never copied into workspace.references or a save payload.
      if(kind==="assistant"&&imageSource==="reference"){
        const resolved=await client.referenceGet(workspace.locationId,selectedRef,scope,guard(token,scope));
        if(!guard(token,scope)())return;
        selectedImage=resolved&&resolved.dataUrl||"";
        if(!selectedImage)throw new Error("The selected approved reference is unavailable.");
      }
    }catch(e){if(guard(token,scope)())setError(bsText(e,"The selected reference could not be loaded."));return;}
    const payload={locationId:workspace.locationId,baseRevision:base,requestId:client.mutationId(),modelId,prompt:prompt.trim(),
      acknowledgeCost:true,...(kind==="assistant"?{mode,shotId:shot&&shot.id,snapshot:bsClone(workspace),
        ...(imageSource==="private"&&privateImage?{imageDataUrl:privateImage}:selectedImage?{imageDataUrl:selectedImage}:{})}:
        {name:(shot&&shot.name)||(location&&location.name)||"Studio asset",rigged:mode==="animation",animated:mode==="animation",
          ...(imageSource==="reference"&&selectedRef?{referenceId:selectedRef}:{}),...(imageSource==="private"&&privateImage?{imageDataUrl:privateImage}:{})})};
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
  const onPrivate=e=>{const file=e.target.files&&e.target.files[0];if(!file)return;if(!/^image\//.test(file.type)){setError("Choose an image file.");return;}
    const reader=new FileReader();reader.onload=()=>setPrivateImage(String(reader.result||""));reader.onerror=()=>setError("The local reference image could not be read.");reader.readAsDataURL(file);};
  const advertised=(caps&&((mode==="mesh"?caps.meshModels:caps.models)||[]))||[];
  const billingDisabled=!!caps&&caps.billingReady===false;
  const billingMessage=caps&&(caps.billingMessage||caps.billingError)||
    "Paid AI is disabled pending approval of the atomic credit update.";
  // The relay is authoritative. Configured access may be pending independent
  // verification; it stays selectable with an honest label and the relay may
  // reject it explicitly. We never substitute another model on that rejection.
  const models=advertised.filter(m=>m&&m.configured&&m.selectable!==false);
  React.useEffect(()=>{
    if(modelId&&!models.some(m=>(m.modelId||m.id||m)===modelId))setModelId("");
  },[mode,models.map(m=>m.modelId||m.id||m).join("|")]);
  return _bsEl("section",{className:"bs-entry"+(compact?" bs-compact":""),"data-testid":"blender-studio-entry"},
    _bsEl("div",{className:"bs-head"},_bsEl("div",null,_bsEl("strong",null,"Blender Studio"),_bsEl("small",null,"Build one reusable location set, then use it across shots.")),
      _bsEl("button",{type:"button",className:"char-draft-btn ghost",onClick:()=>{setOpen(v=>!v);if(!open)load();}},open?"Close studio":"Open Studio")),
    open&&_bsEl("div",{className:"bs-body"},
      readOnly&&_bsEl("p",{className:"bs-warning"},"View-only access: you can review this set, but sending, applying and saving are disabled."),
      _bsEl("p",{className:"bs-disclosure"},"One location is one reusable set for every shot that happens there."),
      loading&&_bsEl("p",{className:"bs-loading",role:"status"},"Opening the set workspace…"),
      error&&!workspace&&_bsEl("div",{className:"bs-error bs-central-error",role:"alert"},error,_bsEl("button",{type:"button",className:"bs-button",onClick:load},"Retry opening Studio")),
      _bsEl("ol",{className:"bs-steps","aria-label":"Blender Studio workflow"},
        window.BlenderStudioSetup?_bsEl(window.BlenderStudioSetup,{client,readOnly,locationId:location.id,onConnectionChange:setConnection}):null,
        workspace&&_bsEl("li",{className:"bs-step"},_bsEl("div",{className:"bs-step-heading"},_bsEl("span",{className:"bs-step-number"},"3"),_bsEl("span",{className:"bs-step-label"},_bsEl("strong",null,"Choose what to make"),_bsEl("small",null,"Review a proposal before it changes the saved set."))),
          _bsEl("div",{className:"bs-step-body"},_bsEl("div",{className:"bs-composer"},_bsEl("div",{className:"bs-tabs"},
          _bsEl("button",{type:"button",className:mode==="scene"?"on":"",onClick:()=>setMode("scene")},"AI Scene Builder"),
          _bsEl("button",{type:"button",className:mode==="animation"?"on":"",onClick:()=>setMode("animation")},"Character animation"),
          _bsEl("button",{type:"button",className:mode==="mesh"?"on":"",onClick:()=>setMode("mesh")},"Prompt/image to 3D")),
          _bsEl("p",{className:"bs-help"},mode==="scene"?"Describe the set or a change you want, such as moving furniture or changing lighting. Nothing changes until you Apply.":mode==="mesh"?"Create a 3D model from a prompt or image, then save it to the library and import it into this set.":"Describe movement for a character or camera in this shot. This edits blocking; it does not create a complete character performance."),
          billingDisabled&&_bsEl("p",{className:"bs-warning",role:"alert"},billingMessage),
          _bsEl("textarea",{value:prompt,onChange:e=>setPrompt(e.target.value),disabled:readOnly,"aria-label":"Describe what to create",placeholder:mode==="animation"?"Describe how the character or camera should move…":mode==="mesh"?"Describe the 3D model you want to create…":"Describe your set or the change you want to make…"}),
          _bsEl("div",{className:"bs-source"},_bsEl("label",null,_bsEl("input",{type:"radio",checked:imageSource==="prompt",onChange:()=>setImageSource("prompt"),disabled:readOnly})," Prompt only"),
            _bsEl("label",null,_bsEl("input",{type:"radio",checked:imageSource==="reference",onChange:()=>setImageSource("reference"),disabled:readOnly})," Approved project reference"),
            _bsEl("label",null,_bsEl("input",{type:"radio",checked:imageSource==="private",onChange:()=>setImageSource("private"),disabled:readOnly})," Local temporary image"),
            imageSource==="reference"&&_bsEl("select",{value:selectedRef,onChange:e=>setSelectedRef(e.target.value),disabled:readOnly},_bsEl("option",{value:""},"Select an approved reference…"),referenceList.map(r=>_bsEl("option",{key:r.entityId,value:r.entityId},r.kind+" · "+r.label))),
             imageSource==="private"&&_bsEl("input",{type:"file",accept:"image/*",onChange:onPrivate,disabled:readOnly})),
           imageSource!=="prompt"&&_bsEl("p",{className:"bs-help"},"Project references are resolved through this workspace. Local images are temporary provider inputs and are not saved to the set."),
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
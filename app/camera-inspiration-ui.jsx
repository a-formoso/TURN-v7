/* Optional paid view ideas, isolated from location artwork and measured set data. */
function LocationCameraInspiration({l,readOnly=false,onPropose,onMatched}){
  const api=window.KinolotCameraInspiration,E=React.createElement;
  const [open,setOpen]=React.useState(false),[draft,setDraft]=React.useState(null),[busy,setBusy]=React.useState(false),[loading,setLoading]=React.useState(false);
  const [engine,setEngine]=React.useState(api?.ENGINES[0]||""),[error,setError]=React.useState(""),[phase,setPhase]=React.useState(""),[retry,setRetry]=React.useState(false),[tick,setTick]=React.useState(0),[enlarged,setEnlarged]=React.useState(false);
  const [notice,setNotice]=React.useState("");
  const dialog=React.useRef(null),alive=React.useRef(true),operating=React.useRef(false);
  let scope=null,choice=null,reason="";
  try{scope=window.BlenderPreview.scope();choice=api.settings(engine);}catch(e){reason=e.message;}
  const scopeKey=scope?[scope.uid,scope.projectId,scope.epoch,l.id].join(":"):"";
  const current=React.useRef(scopeKey);current.current=scopeKey;
  const valid=()=>alive.current&&current.current===scopeKey;
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{setOpen(false);setDraft(null);setError("");setNotice("");setRetry(false);setBusy(false);setEnlarged(false);},[scopeKey]);
  React.useEffect(()=>{
    if(!open||!scope||!api)return;let live=true;setLoading(true);
    api.load(l.id,scope).then(d=>{if(live)setDraft(d);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[open,scopeKey,tick]);
  React.useEffect(()=>{
    const settings=()=>setTick(n=>n+1),changed=e=>{if(e.detail?.id===l.id)setTick(n=>n+1);};
    window.addEventListener("nb-settings-changed",settings);window.addEventListener("turn-pricing-changed",settings);window.addEventListener("kinolot-camera-ideas-changed",changed);
    return ()=>{window.removeEventListener("nb-settings-changed",settings);window.removeEventListener("turn-pricing-changed",settings);window.removeEventListener("kinolot-camera-ideas-changed",changed);};
  },[l.id]);
  React.useEffect(()=>{const el=dialog.current;if(enlarged&&el&&!el.open)el.showModal();},[enlarged]);
  if(!api)return null;
  const pending=scope?api.pending(scope,l.id):null;
  async function generate(){
    if(readOnly||busy||operating.current||!scope||!choice)return;operating.current=true;setBusy(true);setError("");setNotice("");setPhase("generating");onPropose?.(null);
    try{const result=await api.generate(l.id,scope,{engine,retryConfirmed:retry,onPhase:p=>{if(valid())setPhase(p);}});if(valid()){setDraft(result);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}finally{operating.current=false;if(valid()){setBusy(false);setPhase("");setTick(n=>n+1);}}
  }
  async function save(){
    if(readOnly||busy||operating.current||!scope)return;operating.current=true;setBusy(true);setError("");setPhase("saving");
    try{const result=await api.retrySave(l.id,scope);if(valid()){setDraft(result);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}finally{operating.current=false;if(valid()){setBusy(false);setPhase("");setTick(n=>n+1);}}
  }
  async function match(){
    if(readOnly||busy||operating.current||!scope||!draft||stale||!onPropose||!onMatched)return;
    operating.current=true;setBusy(true);setError("");setNotice("");setPhase("Preparing camera match…");const ticket=onPropose(null);
    try{
      const proposal=await window.KinolotCameraMatch.match(l.id,scope,{onPhase:p=>{if(valid())setPhase(p);}});
      if(!valid())return;setPhase("Saving matched cameras…");
      if(await onMatched(proposal,ticket)!==true)throw Error("The camera update was not confirmed. Your saved cameras were not replaced by this match.");
      if(valid())setNotice("All 4 cameras are set. Continue in Build the set.");
    }
    catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid()){setBusy(false);setPhase("");}}
  }
  let stale=!!draft;
  try{if(draft)stale=draft.meta.inputKey!==api.inputKey(l.id);}catch(_){}
  const canMatch=!!(onPropose&&onMatched&&window.KinolotCameraMatch);
  const matchHelp="Experimental camera match: matches recognizable subjects and framing to achievable views inside your saved set. Uses a closer corner fit when possible, otherwise approximate composition. When all 4 views pass the fit checks, their cameras are set automatically and Build the set opens. Changed proportions or hidden features may prevent a match; failed fits leave your cameras unchanged. You can adjust the saved cameras later. Your set stays fixed and matching starts no Blender build.";
  return E("details",{className:"loc-nested-section loc-camera-ideas",open,onToggle:e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}},
    E("summary",null,"Need ideas for camera views?"),
    open&&E("div",{className:"loc-camera-ideas-body"},
      E("p",{className:"loc-layer-note"},"Generate a separate four-view image to explore camera compositions from your description and floor plan. Image-generation credits apply."),
      E("p",{className:"loc-layer-note"},"The image may invent details. Generating it does not change your set or cameras. Like these views? Match them to your fixed set: successful matches set all 4 cameras automatically and open Build the set. The image never changes Blender geometry or location artwork."),
      E("label",{className:"loc-style-notes"},"Image engine",E("select",{value:engine,disabled:readOnly||busy,onChange:e=>{setEngine(e.target.value);setError("");}},
        api.ENGINES.map(id=>E("option",{key:id,value:id},window.nbModelLabel(id))))),
      choice&&choice.model!==engine&&E("p",{className:"loc-layer-note"},"Your plan uses "+window.nbModelLabel(choice.model)+" for this request."),
      pending&&!pending.active&&!pending.hasUnsaved&&E("label",{className:"loc-style-check"},E("input",{type:"checkbox",checked:retry,disabled:readOnly||busy,onChange:e=>setRetry(e.target.checked)}),"I checked usage for the earlier request and want to start a new paid request."),
      pending?.hasUnsaved&&!busy&&E("p",{className:"loc-layer-note"},"The image finished, but its save was not confirmed. Retry saving without generating another image."),
      E("div",{className:"loc-step-actions"},
        E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy||loading||!scope||!(Number(choice?.credits)>0)||!!pending?.active||!!pending?.hasUnsaved||!!pending&&!retry,onClick:generate},
          busy?(phase==="saving"?"Saving ideas…":phase==="generating"?"Generating ideas…":"Matching views…"):draft?"Generate more view ideas":"Generate view ideas",
          !busy&&Number(choice?.credits)>0&&window.nbCostChip&&window.nbCostChip(1,{model:choice.model,res:choice.imageSize,quality:choice.quality,aspect:"16:9",refs:0,ground:false})),
        pending?.hasUnsaved&&E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy,onClick:save},"Retry saving ideas")),
      (reason||error)&&E("p",{className:"loc-spatial-error",role:"alert"},error||reason),
      notice&&E("p",{className:"loc-layer-note",role:"status"},notice),
      loading&&!busy&&E("p",{className:"loc-layer-note",role:"status"},"Loading saved ideas…"),
      busy&&phase!=="generating"&&phase!=="saving"&&E("p",{className:"loc-layer-note",role:"status"},phase),
      draft&&E("figure",{className:"loc-camera-ideas-image"},
        E("img",{src:draft.url,alt:"Camera-composition ideas for "+(l.name||"this location")}),
        E("figcaption",null,(stale?"Earlier ideas — the description or floor plan has changed. ":"")+"Inspiration only · "+window.nbModelLabel(draft.meta.modelId)),
        E("div",{className:"loc-camera-ideas-review-actions"},
          E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setEnlarged(true)},"Enlarge ideas"),
          canMatch&&E("span",{className:"loc-camera-control"},
            E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy||loading||stale||!scope,onClick:match,title:window.InfoTip?undefined:matchHelp},"Match these views to set"),
            window.InfoTip&&E(window.InfoTip,{label:"About matching views to the set",text:matchHelp}))),
        canMatch&&stale&&E("p",{className:"loc-layer-note"},"Generate fresh ideas for the current floor plan before matching.")),
      enlarged&&draft&&E("dialog",{ref:dialog,className:"loc-angle-dialog",onCancel:()=>setEnlarged(false),"aria-label":"Camera-composition ideas"},
        E("div",{className:"loc-cloud-render-head"},E("h3",null,(l.name||"Location")+" · view ideas"),E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setEnlarged(false)},"Close ideas")),
        E("p",{className:"loc-layer-note"},"Inspiration only. Your saved layout and cameras stay unchanged."),
        E("img",{className:"loc-camera-ideas-large",src:draft.url,alt:"Four suggested compositions for "+(l.name||"this location")}))));
}
window.LocationCameraInspiration=LocationCameraInspiration;

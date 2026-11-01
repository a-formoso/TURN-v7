/* Optional, reviewed styling of a completed cloud set; never auto-adopts artwork. */
function LocationSetStyle({location,job,sceneHash,readOnly=false}){
  const api=window.KinolotSetStyle;
  const [draft,setDraft]=React.useState(null),[busy,setBusy]=React.useState(false),[loading,setLoading]=React.useState(true);
  const [error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[notes,setNotes]=React.useState("");
  const [review,setReview]=React.useState(false),[checked,setChecked]=React.useState(false),[retry,setRetry]=React.useState(false);
  const [camera,setCamera]=React.useState("all"),[wipe,setWipe]=React.useState(50),[tick,setTick]=React.useState(0);
  const dialog=React.useRef(null),alive=React.useRef(true);
  const operating=React.useRef(false);
  let scope=null,choice=null,brief="",reason="";
  try{scope=window.BlenderPreview.scope();brief=api.briefKey(location);}catch(e){reason=e.message;}
  const scopeKey=scope?[scope.uid,scope.projectId,scope.epoch,location.id].join(":"):"";
  const current=React.useRef(scopeKey);current.current=scopeKey;
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{
    let live=true;setDraft(null);setLoading(true);setError("");setNotice("");setChecked(false);setReview(false);setRetry(false);
    if(scope)api.load(location.id,scope).then(d=>{if(live)setDraft(d);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    else setLoading(false);
    return ()=>{live=false;};
  },[scopeKey,tick]);
  React.useEffect(()=>{
    const changed=e=>{if(!e.detail?.id||e.detail.id===location.id){
      if(e.detail?.saved&&!operating.current)setTick(n=>n+1);else setSettingsTick(n=>n+1);
    }};
    const settings=()=>setSettingsTick(n=>n+1);
    window.addEventListener("kinolot-style-changed",changed);
    window.addEventListener("nb-settings-changed",settings);window.addEventListener("nb-model-changed",settings);window.addEventListener("turn-pricing-changed",settings);
    return ()=>{window.removeEventListener("kinolot-style-changed",changed);window.removeEventListener("nb-settings-changed",settings);window.removeEventListener("nb-model-changed",settings);window.removeEventListener("turn-pricing-changed",settings);};
  },[location.id]);
  const [,setSettingsTick]=React.useState(0);
  const [imagesReady,setImagesReady]=React.useState({source:false,draft:false});
  const [engine,setEngine]=React.useState(api.ENGINES[0]);
  const [phase,setPhase]=React.useState(""),[phaseAt,setPhaseAt]=React.useState(0),[now,setNow]=React.useState(0);
  const step=p=>{if(valid()){setPhase(p);setPhaseAt(Date.now());setNow(Date.now());}};
  React.useEffect(()=>{
    if(!phase)return;const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);
  },[phase]);
  try{choice=api.settings(engine);}catch(e){reason=reason||e.message;}
  React.useEffect(()=>{
    const el=dialog.current;if(!el||!review)return;
    if(!el.open)el.showModal();return ()=>{if(el.open)el.close();};
  },[review]);
  const pending=scope?api.pending(scope,location.id):null;
  const stale=!!draft&&(!sceneHash||draft.meta.sceneHash!==sceneHash||draft.meta.briefKey!==brief);
  // No draft yet means no decision: two missing values must not count as a match.
  const approval=draft?.meta?.approval,decided=!!approval&&!!draft.meta.iso&&approval.iso===draft.meta.iso;
  const accepted=decided&&approval.approved,rejected=decided&&!approval.approved;
  const valid=()=>alive.current&&current.current===scopeKey;
  async function generate(){
    if(busy||readOnly||!scope||!choice)return;operating.current=true;setBusy(true);setError("");setNotice("");step("preparing");
    try{const d=await api.generate(location.id,job,scope,{settings:choice,notes,retryConfirmed:retry,onPhase:step});if(valid()){setDraft(d);setChecked(false);setImagesReady({source:false,draft:false});setReview(true);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid()){setBusy(false);setPhase("");}}
  }
  async function decide(use){
    if(busy||readOnly||!scope||!draft)return;operating.current=true;setBusy(true);setError("");
    try{
      const result=use?await api.accept(location.id,draft,scope,checked):await api.reject(location.id,draft,scope);
      if(valid()){
        setNotice(use?"Location artwork updated. Its previous image remains in version history.":"Draft rejected. Location artwork was not changed.");
        setDraft(await api.load(location.id,scope));setReview(false);setChecked(false);
        if(use&&result.reviewRecorded===false)setNotice("Artwork saved. Refresh to verify the draft's review marker before any further action.");
      }
    }catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid())setBusy(false);}
  }
  async function retrySave(){
    if(busy||readOnly||!scope)return;operating.current=true;setBusy(true);setError("");step("saving");
    try{const d=await api.retrySave(location.id,scope);if(valid()){setDraft(d);setChecked(false);setImagesReady({source:false,draft:false});setReview(true);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid()){setBusy(false);setPhase("");}}
  }
  const E=React.createElement;
  const controls=()=>E("div",{className:"loc-cloud-render-actions"},
    E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy||stale||decided||!checked||!draft?.source||!imagesReady.source||!imagesReady.draft,onClick:()=>decide(true)},"Use as location artwork"),
    E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy||decided,onClick:()=>decide(false)},"Reject draft"));
  const label={all:"All four views",TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const position={all:[0,0],TL:[0,0],TR:[-100,0],BL:[0,-100],BR:[-100,-100]}[camera];
  const imageStyle={width:camera==="all"?"100%":"200%",height:camera==="all"?"100%":"200%",left:position[0]+"%",top:position[1]+"%"};
  const problem=reason||error;
  return E("section",{className:"loc-style-preview","data-testid":"location-style-preview"},
    E("h4",null,"Style preview"),
    E("p",{className:"loc-layer-note"},"Try the location's materials and look over the four Blender views. Review every view before replacing artwork; image styling can move or invent details."),
    E("label",{className:"loc-style-notes"},"Surface notes (optional)",E("textarea",{value:notes,maxLength:1000,disabled:readOnly||busy,onChange:e=>setNotes(e.target.value),placeholder:"For example, subtle salt streaks and less floor glare."})),
    E("label",{className:"loc-style-notes"},"Engine",
      E("select",{value:engine,disabled:readOnly||busy,onChange:e=>setEngine(e.target.value)},
        api.ENGINES.map(id=>E("option",{key:id,value:id},window.nbModelLabel(id))))),
    pending&&!pending.active&&!pending.hasUnsaved&&E("label",{className:"loc-style-check"},E("input",{type:"checkbox",checked:retry,disabled:readOnly||busy,onChange:e=>setRetry(e.target.checked)}),"An earlier request may still finish. I checked usage and want to start a new paid request."),
    !busy&&pending?.hasUnsaved&&E("p",{className:"loc-layer-note"},"The image finished, but its save was not confirmed. Keep this page open and retry saving without generating or charging for another image."),
    E("div",{className:"loc-cloud-render-actions"},
      E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy||loading||!(Number(choice?.credits)>0)||!sceneHash||job?.status!=="completed"||job.sceneHash!==sceneHash||!!pending?.active||!!pending?.hasUnsaved||!!pending&&!retry,onClick:generate},busy?"Working…":draft?"Generate another style draft":"Generate style draft",
        // the same credit chip as Generate new image, priced for the chosen engine
        !busy&&Number(choice?.credits)>0&&window.nbCostChip&&window.nbCostChip(1,{model:choice.model,res:choice.imageSize,quality:choice.quality,aspect:"16:9",refs:1,ground:false})),
      pending?.hasUnsaved&&E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy,onClick:retrySave},"Retry saving draft"),
      draft&&!decided&&!stale&&E("button",{type:"button",className:"art-draftall ghost",disabled:busy,onClick:()=>{setChecked(false);setImagesReady({source:false,draft:false});setReview(true);}},"Review draft")),
    phase&&styleProgress({phase,since:phaseAt,now,model:choice?.model,api}),
    !phase&&pending?.active&&E("p",{role:"status",className:"loc-layer-note"},"A style draft for this location is being generated or saved."),
    loading&&E("p",{role:"status",className:"loc-layer-note"},"Loading saved style draft…"),
    // one plain sentence: where the draft stands and what to click (owner 2026-11-01)
    draft&&(decided||!stale)&&E("p",{role:"status",className:"loc-layer-note"},accepted?"This draft became the location image.":rejected?"You rejected this draft.":
      "Your draft is ready. Click Review draft to compare it with the Blender views. The location image only changes if you choose Use as location artwork."),
    draft&&!decided&&stale&&E("p",{className:"loc-spatial-error"},
      "This draft is out of date: the set or its look changed after it was made, so it can't become the location image. Click Generate another style draft to make a new one."),
    notice&&E("p",{role:"status",className:"loc-layer-note"},notice),
    problem&&E("p",{role:"alert",className:"loc-spatial-error"},problem),
    review&&draft&&E("dialog",{ref:dialog,className:"loc-style-dialog","aria-label":"Review style draft against Blender",onCancel:()=>setReview(false)},
      E("div",{className:"loc-cloud-render-head"},E("h3",null,"Review style draft"),E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setReview(false)},"Close review")),
      E("p",null,"Check openings, fixture positions, ramp state, beams and markings in all four views. The source is authoritative."),
      E("div",{className:"loc-style-toolbar"},
        E("label",null,"Camera",E("select",{value:camera,onChange:e=>setCamera(e.target.value)},Object.entries(label).map(([value,text])=>E("option",{key:value,value},text)))),
        E("label",null,"Blender source revealed: "+wipe+"%",E("input",{type:"range",min:0,max:100,value:wipe,onChange:e=>setWipe(Number(e.target.value)),"aria-label":"Blender source revealed"}))),
      E("div",{className:"loc-style-legend"},E("span",null,"Blender source"),E("span",null,"Styled draft")),
      E("div",{className:"loc-style-compare","aria-label":label[camera]+" comparison"},
        E("div",{className:"loc-style-layer"},E("img",{src:draft.url,alt:label[camera]+" styled draft",style:imageStyle,onLoad:()=>setImagesReady(p=>({...p,draft:true})),onError:()=>{setImagesReady(p=>({...p,draft:false}));setError("The draft image could not be loaded. Close the review and refresh the saved draft.");}})),
        E("div",{className:"loc-style-layer",style:{clipPath:"inset(0 "+(100-wipe)+"% 0 0)"}},E("img",{src:draft.source,alt:label[camera]+" original Blender views",style:imageStyle,onLoad:()=>setImagesReady(p=>({...p,source:true})),onError:()=>{setImagesReady(p=>({...p,source:false}));setError("The Blender comparison could not be loaded. Close the review and refresh the saved draft.");}})),
        E("div",{className:"loc-style-divider",style:{left:wipe+"%"}})),
      stale&&E("p",{className:"loc-spatial-error"},"This draft is outdated and cannot replace artwork."),
      problem&&E("p",{role:"alert",className:"loc-spatial-error"},problem),
      !decided&&E("label",{className:"loc-style-check"},E("input",{type:"checkbox",checked,disabled:readOnly||busy||stale||!imagesReady.source||!imagesReady.draft,onChange:e=>setChecked(e.target.checked)}),"I checked all four views against Blender and accept any visual differences."),
      !decided&&controls(),
      decided&&E("p",null,accepted?"Already used as location artwork.":"Rejected. Generate a new draft to try again."),
      E("p",{className:"loc-layer-note"},"Using this draft replaces the location image and keeps the previous image in version history. Rejecting it does not refund image generation credits.")));
}
/* Time-based, like the set render: the image engine reports no progress, so the bar runs against its measured time
   and stops short of full until the draft is saved. */
function styleProgress({phase,since,now,model,api}){
  const E=React.createElement,clock=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
  const elapsed=Math.max(0,((now||since)-since)/1000),estimate=api.estimateSeconds(model);
  let pct,text;
  if(phase==="saving"){pct=96;text="Saving the draft — almost done.";}
  else if(phase==="preparing"){pct=2;text="Preparing the four Blender views…";}
  else{
    pct=Math.min(95,Math.max(3,Math.round(elapsed/estimate*100)));
    text=elapsed<=estimate?"Generating with "+window.nbModelLabel(model)+" · "+clock(elapsed)+" of about "+clock(estimate)+". Keep this film open."
      :"Taking longer than usual · "+clock(elapsed)+" so far. Keep this film open.";
  }
  return E("div",{className:"loc-cloud-progress",role:"status"},
    E("div",{className:"loc-cloud-progress-bar",role:"progressbar","aria-label":"Style draft progress","aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":pct},
      E("span",{style:{width:pct+"%"}})),
    E("p",{className:"loc-layer-note"},text));
}
window.LocationSetStyle=LocationSetStyle;

/* Optional, reviewed styling of a completed cloud set; never auto-adopts artwork.
   Drafts stay on the card (owner 2026-11-15): the current draft and the earlier ones are shown in the section, each
   kept until it is discarded; closing the review loses nothing. */
function LocationSetStyle({location,target,job,sceneHash,readOnly=false}){
  const api=window.KinolotSetStyle;
  // what this draft becomes: the location image, or a moving-part state's own image ("Stern ramp lowered")
  const goal=target||location.id,partState=goal&&typeof goal==="object"?goal:null;
  const [draft,setDraft]=React.useState(null),[busy,setBusy]=React.useState(false),[loading,setLoading]=React.useState(true);
  const [error,setError]=React.useState(""),[notice,setNotice]=React.useState(""),[notes,setNotes]=React.useState("");
  const [review,setReview]=React.useState(false),[checked,setChecked]=React.useState(false),[retry,setRetry]=React.useState(false);
  const [camera,setCamera]=React.useState("all"),[wipe,setWipe]=React.useState(50),[tick,setTick]=React.useState(0);
  const dialog=React.useRef(null),alive=React.useRef(true);
  const operating=React.useRef(false);
  const generation=React.useRef(0);
  let scope=null,choice=null,brief="",reason="";
  try{scope=window.BlenderPreview.scope();brief=api.briefKey(location);}catch(e){reason=e.message;}
  const scopeKey=scope?[scope.uid,scope.projectId,scope.epoch,location.id,partState?partState.key:""].join(":"):"";
  const current=React.useRef(scopeKey);current.current=scopeKey;
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{
    let live=true;setDraft(null);setLoading(true);setError("");setNotice("");setChecked(false);setReview(false);setRetry(false);
    if(scope)api.load(goal,scope).then(d=>{if(live)setDraft(d);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
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
  const [pair,setPair]=React.useState(null),[compareMode,setCompareMode]=React.useState("source");
  // the earlier drafts kept with the current one, and the earlier draft open in the review (null = the current draft)
  const [earlier,setEarlier]=React.useState([]),[viewing,setViewing]=React.useState(null);
  React.useEffect(()=>{
    let live=true;setPair(null);
    if(scope)api.comparisonPair(goal,scope).then(p=>{if(live)setPair(p);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[scopeKey,tick,draft?.meta?.iso,draft?.meta?.approval?.approved]);
  React.useEffect(()=>{
    let live=true;
    if(scope&&api.earlier)api.earlier(goal,scope).then(list=>{if(live)setEarlier(list||[]);}).catch(()=>{if(live)setEarlier([]);});
    else setEarlier([]);
    return ()=>{live=false;};
  },[scopeKey,tick,draft?.meta?.iso,draft?.meta?.approval?.approved]);
  const step=p=>{if(valid()){setPhase(p);setPhaseAt(Date.now());setNow(Date.now());}};
  // open the review on the current draft, or on an earlier one (to look at, or to make current again)
  const openReview=which=>{setViewing(which||null);setCompareMode("source");setChecked(false);setImagesReady({source:false,draft:false});setReview(true);};
  React.useEffect(()=>{
    if(!phase)return;const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);
  },[phase]);
  try{choice=api.settings(engine);}catch(e){reason=reason||e.message;}
  React.useEffect(()=>{
    const el=dialog.current;if(!el||!review)return;
    if(!el.open)el.showModal();return ()=>{if(el.open)el.close();};
  },[review,!!pair,compareMode]);
  const pending=scope?api.pending(scope,goal):null;
  const stale=!!draft&&(!sceneHash||draft.meta.sceneHash!==sceneHash||draft.meta.briefKey!==brief);
  // No draft yet means no decision: two missing values must not count as a match.
  const approval=draft?.meta?.approval,decided=!!approval&&!!draft.meta.iso&&approval.iso===draft.meta.iso;
  const accepted=decided&&approval.approved,rejected=decided&&!approval.approved;
  const valid=()=>alive.current&&current.current===scopeKey;
  async function generate(){
    if(operating.current||busy||readOnly||!scope||!choice)return;operating.current=true;setBusy(true);setError("");setNotice("");step("preparing");
    const token=++generation.current,isCurrent=()=>valid()&&generation.current===token;
    try{const d=await api.generate(goal,job,scope,{settings:choice,notes,retryConfirmed:retry,onPhase:p=>{if(isCurrent())step(p);}});if(isCurrent()){setDraft(d);openReview(null);setRetry(false);}}
    catch(e){if(isCurrent())setError(e.message);}
    finally{if(generation.current===token)operating.current=false;if(isCurrent()){setBusy(false);setPhase("");}}
  }
  function cancelGeneration(){
    if(!scope||!busy)return;
    try{
      const stopped=api.cancel(goal,scope);
      if(!stopped.ok){setNotice(stopped.reason==="saving"?"The draft is already saving. Please wait for it to finish.":"The request has already finished.");return;}
      generation.current++;operating.current=false;setBusy(false);setPhase("");setRetry(false);
      setNotice(stopped.submitted?"Cancelled. Any late image result will be discarded. Processing already started may still be charged.":"Cancelled before image submission. No new image request was sent.");
    }catch(e){if(valid())setError(e.message);}
  }
  async function decide(use){
    if(busy||readOnly||!scope||!draft)return;operating.current=true;setBusy(true);setError("");
    try{
      const result=use?await api.accept(goal,draft,scope,checked):await api.reject(goal,draft,scope);
      if(valid()){
        setNotice(use?(partState?"Saved as the \u201c"+partState.label+"\u201d image. Shots at those moments use it in place of the location image.":"The location image was updated. The image before it stays in the card's versions."):"Draft discarded. The location image was not changed.");
        setDraft(await api.load(goal,scope));setReview(false);setChecked(false);
        if(use&&result.reviewRecorded===false)setNotice("Artwork saved. Refresh to verify the draft's review marker before any further action.");
      }
    }catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid())setBusy(false);}
  }
  async function retrySave(){
    if(busy||readOnly||!scope)return;operating.current=true;setBusy(true);setError("");step("saving");
    try{const d=await api.retrySave(goal,scope);if(valid()){setDraft(d);openReview(null);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid()){setBusy(false);setPhase("");}}
  }
  // an earlier draft becomes the current one again (no image call); the one it replaces joins the earlier drafts
  async function bringBack(d){
    if(busy||readOnly||!scope||!d)return;operating.current=true;setBusy(true);setError("");
    try{
      const now=await api.restore(goal,d.meta.iso,scope);
      if(valid()){setDraft(now);setViewing(null);setReview(false);setChecked(false);
        setNotice("That draft is the current one again. The draft it replaced is kept with the earlier drafts.");}
    }catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid())setBusy(false);}
  }
  const E=React.createElement;
  const controls=()=>E("div",{className:"loc-cloud-render-actions"},
    E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy||stale||decided||!checked||!draft?.source||!imagesReady.source||!imagesReady.draft,onClick:()=>decide(true)},partState?"Use as the \u201c"+partState.label+"\u201d image":"Use as location image"),
    E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy||decided,onClick:()=>decide(false)},"Discard draft"));
  const label={all:"All four views",TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const position={all:[0,0],TL:[0,0],TR:[-100,0],BL:[0,-100],BR:[-100,-100]}[camera];
  const imageStyle={width:camera==="all"?"100%":"200%",height:camera==="all"?"100%":"200%",left:position[0]+"%",top:position[1]+"%"};
  const engineView=compareMode==="engines";
  const engineLabel=d=>window.nbModelLabel(d.meta.modelId)+(d.meta.quality?" · "+d.meta.quality:"")+(d.meta.size?" · "+d.meta.size:"");
  // what the review shows: the current draft, or an earlier one opened from the card
  const shown=viewing||draft;
  const leftImage=engineView?pair?.left.url:(shown?.source||shown?.url),rightImage=engineView?pair?.right.url:shown?.url;
  const leftLabel=engineView?(pair?engineLabel(pair.left):"First engine"):"Built set (step 5)",rightLabel=engineView?(pair?engineLabel(pair.right):"Second engine"):"Styled draft";
  const when=iso=>{try{return new Date(iso).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch(_){return "";}};
  const draftLine=d=>engineLabel(d)+(when(d.meta.iso)?" \u00b7 "+when(d.meta.iso):"");
  const kept=!!draft&&!rejected;
  const becomes=partState?"the \u201c"+partState.label+"\u201d image":"the location image";
  const problem=reason||error;
  return E("section",{className:"loc-style-preview","data-testid":"location-style-preview"},
    // what this step does, in one plain paragraph (owner 2026-11-15)
    E("p",{className:"loc-layer-note","data-testid":"style-intro"},partState
      ?"This set is built at a story moment: "+partState.label+". The image engine repaints its four views from step 5 in this card's render style; the result becomes that state's own image, and the location image stays as it is."
      :"The image engine repaints the four views built in step 5 in this card's render style. The shapes and the cameras stay as built; surfaces, materials and light change. Each result is a draft, kept below until you discard it. The location image changes only when you choose to use one."),
    E("label",{className:"loc-style-notes"},"Surface notes (optional)",E("textarea",{value:notes,maxLength:1000,disabled:readOnly||busy,onChange:e=>setNotes(e.target.value),placeholder:"For example, subtle salt streaks and less floor glare."})),
    E("label",{className:"loc-style-notes"},E("span",{className:"loc-control-heading"},"Engine",window.InfoTip&&E(window.InfoTip,{label:"About comparing style engines",text:pair
      ?"Compare engines shows two saved drafts made from the same built set and prompt, side by side. Opening it uses no generation credits."
      :"To compare engines, make a draft with each engine from the same built set and surface notes. Each draft has its own displayed price; looking at them uses no generation credits."})),
      E("select",{value:engine,disabled:readOnly||busy,onChange:e=>setEngine(e.target.value)},
        api.ENGINES.map(id=>E("option",{key:id,value:id},window.nbModelLabel(id))))),
    pending&&!pending.active&&!pending.hasUnsaved&&E("label",{className:"loc-style-check"},E("input",{type:"checkbox",checked:retry,disabled:readOnly||busy,onChange:e=>setRetry(e.target.checked)}),pending.cancelled?"The cancelled request may still be charged. I checked usage and want to start a new paid request.":"An earlier request may still finish. I checked usage and want to start a new paid request."),
    pending?.cancelled&&pending.active&&E("p",{className:"loc-layer-note",role:"status"},"The cancelled image request is still finishing. Its result will be discarded; another request can start after it settles."),
    !busy&&pending?.hasUnsaved&&E("p",{className:"loc-layer-note"},"The image finished, but its save was not confirmed. Keep this page open and retry saving without generating or charging for another image."),
    E("div",{className:"loc-cloud-render-actions loc-style-actions"},
      E("div",{className:"loc-style-generate-row"},
      E("button",{type:"button",className:"art-draftall loc-style-generate",disabled:readOnly||busy||loading||!(Number(choice?.credits)>0)||!sceneHash||job?.status!=="completed"||job.sceneHash!==sceneHash||!!pending?.active||!!pending?.hasUnsaved||!!pending&&!retry,onClick:generate},busy?"Working…":draft?"Generate another style draft":"Generate style draft",
        // the same credit chip as Generate new image, priced for the chosen engine
        !busy&&Number(choice?.credits)>0&&window.nbCostChip&&window.nbCostChip(1,{model:choice.model,res:choice.imageSize,quality:choice.quality,aspect:"16:9",refs:1,ground:false})),
      busy&&["preparing","generating"].includes(phase)&&E("button",{type:"button",className:"art-draftall ghost loc-style-cancel",onClick:cancelGeneration,title:"Discard this generation. Image processing already started may still be charged."},"Cancel")),
      pending?.hasUnsaved&&E("button",{type:"button",className:"art-draftall ghost loc-style-save-retry",disabled:readOnly||busy,onClick:retrySave},"Retry saving draft")),
    phase&&styleProgress({phase,since:phaseAt,now,model:choice?.model,api}),
    !phase&&pending?.active&&E("p",{role:"status",className:"loc-layer-note"},"A style draft for this location is being generated or saved."),
    loading&&E("p",{role:"status",className:"loc-layer-note"},"Loading saved style draft…"),
    // THE DRAFTS, ON THE CARD: the current one with what you can do with it, then the earlier ones
    (kept||earlier.length>0||!!pair)&&E("div",{className:"loc-sub style-drafts","data-testid":"style-drafts"},
      E("h4",{className:"loc-step-sub"},"Style drafts"),
      E("p",{className:"loc-layer-note"},"Kept here until you discard them. Closing the review does not lose a draft."),
      kept&&E("div",{className:"style-draft","data-testid":"style-draft-current"},
        E("button",{type:"button",className:"style-draft-thumb",disabled:busy||!draft.source,onClick:()=>openReview(null),
          title:"Open this draft beside the set it was made from","aria-label":"Open the current style draft"},
          E("img",{src:draft.url,alt:"Style draft of "+(location.name||"this location")+": four styled camera views",draggable:false})),
        E("p",{role:"status",className:"loc-layer-note"},draftLine(draft)+" \u00b7 "+(accepted?"Used as "+becomes+".":stale?"Out of date.":"Not used yet.")),
        !decided&&stale&&E("p",{className:"loc-spatial-error"},
          "This draft is out of date: the set or its look changed after it was made, so it can't become the location image. Click Generate another style draft to make a new one."),
        E("div",{className:"loc-step-actions"},
          E("button",{type:"button",className:"art-draftall"+(decided||stale?" ghost":""),disabled:busy||!draft.source,onClick:()=>openReview(null),
            title:"Compare the draft with the built set, view by view"+(decided||stale?"":"; from there it can become "+becomes)},
            decided||stale?"Open draft":"Review draft"),
          !decided&&E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy,onClick:()=>decide(false),
            title:"Takes this draft off the card. "+(partState?"That state's image":"The location image")+" is not changed; image credits are not given back."},"Discard draft"))),
      earlier.length>0&&E("div",{className:"style-draft-earlier","data-testid":"style-drafts-earlier"},
        E("p",{className:"loc-layer-note"},"Earlier drafts ("+earlier.length+"). Open one to look at it or to make it the current draft again."),
        E("div",{className:"style-draft-strip"},earlier.map(d=>E("button",{key:d.meta.iso,type:"button",className:"style-draft-thumb small",disabled:busy,
            onClick:()=>openReview(d),title:"Open this earlier draft"},
          E("img",{src:d.url,alt:"Earlier style draft: "+draftLine(d),draggable:false,loading:"lazy"}),
          E("span",null,draftLine(d)))))),
      // two saved drafts from different engines, made from the same built set and prompt: offered only when there are two
      pair&&E("div",{className:"loc-step-actions"},
        E("button",{type:"button",className:"art-draftall ghost",disabled:busy,title:"Two saved drafts from different engines, side by side. No credits.",
          onClick:()=>{setViewing(null);setCompareMode("engines");setReview(true);}},"Compare engines"))),
    rejected&&E("p",{role:"status",className:"loc-layer-note"},"You discarded the last draft."+(earlier.length?"":" Generate a style draft to try again.")),
    notice&&E("p",{role:"status",className:"loc-layer-note"},notice),
    problem&&E("p",{role:"alert",className:"loc-spatial-error"},problem),
    review&&(engineView?pair:shown)&&E("dialog",{ref:dialog,className:"loc-style-dialog","aria-label":engineView?"Compare saved image engines":"Review style draft against the built set",onCancel:()=>setReview(false)},
      E("div",{className:"loc-cloud-render-head"},E("h3",null,engineView?"Compare saved engines":viewing?"Earlier style draft":"Review style draft"),E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setReview(false)},"Close review")),
      E("p",null,engineView?"These saved drafts use the same built set and prompt. Compare every camera; engine quality and size are shown in the labels. This comparison does not change any image."
        :"Left: the set as built in step 5. Right: the styled draft. Move the slider to compare them, camera by camera: doors and windows, where objects stand, light fittings, markings. An image engine can change details, and it keeps any mistake already in the built set."
          +(viewing?"":" Closing this keeps the draft on the card.")),
      E(StyleGenerationDetails,{meta:engineView?pair?.left.meta:shown?.meta,shared:engineView}),
      E("div",{className:"loc-style-toolbar"},
        E("label",null,"Camera",E("select",{value:camera,onChange:e=>setCamera(e.target.value)},Object.entries(label).map(([value,text])=>E("option",{key:value,value},text)))),
        E("label",null,leftLabel+" revealed: "+wipe+"%",E("input",{type:"range",min:0,max:100,value:wipe,onChange:e=>setWipe(Number(e.target.value)),"aria-label":engineView?"Left engine revealed":"Built set revealed"}))),
      E("div",{className:"loc-style-legend"},E("span",null,leftLabel),E("span",null,rightLabel)),
      E("div",{className:"loc-style-compare","aria-label":label[camera]+" comparison"},
        E("div",{className:"loc-style-layer"},E("img",{src:rightImage,alt:label[camera]+" · "+rightLabel,style:imageStyle,onLoad:()=>{if(!engineView)setImagesReady(p=>({...p,draft:true}));},onError:()=>{setImagesReady(p=>({...p,draft:false}));setError("The draft image could not be loaded. Close the review and open the draft again.");}})),
        E("div",{className:"loc-style-layer",style:{clipPath:"inset(0 "+(100-wipe)+"% 0 0)"}},E("img",{src:leftImage,alt:label[camera]+" · "+leftLabel,style:imageStyle,onLoad:()=>{if(!engineView)setImagesReady(p=>({...p,source:true}));},onError:()=>{setImagesReady(p=>({...p,source:false}));setError("The built set's views could not be loaded. Close the review and open the draft again.");}})),
        E("div",{className:"loc-style-divider",style:{left:wipe+"%"}})),
      !engineView&&!viewing&&stale&&E("p",{className:"loc-spatial-error"},"This draft is out of date and cannot become "+becomes+"."),
      engineView&&(pair.left.meta.sceneHash!==sceneHash||pair.left.meta.briefKey!==brief)&&E("p",{className:"loc-layer-note"},"This is a saved comparison from an earlier build or look. It remains available for inspection."),
      problem&&E("p",{role:"alert",className:"loc-spatial-error"},problem),
      // an earlier draft: look at it, or make it the current draft again (only the current draft can be used)
      !engineView&&viewing&&E("div",{className:"loc-cloud-render-actions"},
        E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy,onClick:()=>bringBack(viewing)},"Make this the current draft")),
      !engineView&&viewing&&E("p",{className:"loc-layer-note"},"Only the current draft can become "+becomes+". Making this one current keeps the draft it replaces with the earlier drafts; no image is generated."),
      !engineView&&!viewing&&!decided&&E("label",{className:"loc-style-check"},E("input",{type:"checkbox",checked,disabled:readOnly||busy||stale||!imagesReady.source||!imagesReady.draft,onChange:e=>setChecked(e.target.checked)}),"I checked all four views against the built set and accept the differences."),
      !engineView&&!viewing&&!decided&&controls(),
      !engineView&&!viewing&&decided&&E("p",null,accepted?"Already used as "+becomes+".":"Discarded. Generate a new draft to try again."),
      !engineView&&!viewing&&E("p",{className:"loc-layer-note"},(partState?"Using this draft saves it as the \u201c"+partState.label+"\u201d image; the location image is not changed.":"Using this draft replaces the location image and keeps the image before it in the card's versions.")+" Discarding a draft does not give back its image credits.")));
}
function StyleGenerationDetails({meta,shared=false}){
  const E=React.createElement,scene=meta?.sourceScene;
  const vec=v=>Array.isArray(v)?v.map(n=>typeof n==="number"?Math.round(n*1000)/1000:n).join(", "):"Not recorded";
  return E("details",{className:"loc-nested-section loc-style-requirements"},
    E("summary",null,"Generation requirements"),
    E("p",{className:"loc-layer-note"},shared?"The two saved results used this same prompt and Blender build.":"These are the saved inputs for this draft, including any surface notes used at generation time."),
    E("h4",null,shared?"Shared styling prompt":"Saved styling prompt"),
    meta?.prompt?E("pre",{style:{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:"22rem",overflow:"auto"}},meta.prompt)
      :E("p",null,"The original prompt was not saved with this older draft."),
    E("details",null,E("summary",null,"Blender build inputs"),
      E("p",{className:"loc-layer-note"},"Blender builds from numbers rather than a text prompt. Positions and sizes below are in metres; camera facing and tilt are in degrees. Inspect the source render against the intended room before styling."),
      scene&&Array.isArray(scene.objects)?E(React.Fragment,null,
        E("p",null,scene.name),
        E("div",{style:{maxHeight:"22rem",overflow:"auto"}},E("table",null,
          E("thead",null,E("tr",null,["Built shape","Position (x, y, height)","Size (width, depth, height)","Rotation (degrees)"].map(t=>E("th",{key:t},t)))),
          E("tbody",null,scene.objects.map(o=>E("tr",{key:o.id},E("td",null,o.name),E("td",null,vec(o.position)),E("td",null,vec(o.size)),E("td",null,vec(o.rotation?.map(r=>r*180/Math.PI)))))))),
        E("h4",null,"Camera settings"),
        E("ul",null,Object.entries(scene.cameras||{}).map(([panel,c])=>E("li",{key:panel},panel+": position "+vec(c.position)+"; facing "+c.yaw+"°; tilt "+c.pitch+"°; lens "+c.lensMm+" mm"))),
        E("h4",null,"Lights"),
        E("ul",null,(scene.previewLights||[]).map((l,i)=>E("li",{key:i},"Position "+vec(l.position)+"; power "+l.powerWatts+" W; size "+l.sizeMetres+" m"))),
        E("h4",null,"Build notes and assumptions"),
        E("ul",null,(scene.notes||[]).map((n,i)=>E("li",{key:i},n))))
        :E("p",null,"This older draft has no saved numeric build snapshot. Its saved reference can still be inspected, but today's floor plan may differ from the original build.")));
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

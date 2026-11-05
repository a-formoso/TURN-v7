/* Optional, reviewed styling of a completed cloud set; never auto-adopts artwork. */
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
  React.useEffect(()=>{
    let live=true;setPair(null);
    if(scope)api.comparisonPair(goal,scope).then(p=>{if(live)setPair(p);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[scopeKey,tick,draft?.meta?.iso,draft?.meta?.approval?.approved]);
  const step=p=>{if(valid()){setPhase(p);setPhaseAt(Date.now());setNow(Date.now());}};
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
    if(busy||readOnly||!scope||!choice)return;operating.current=true;setBusy(true);setError("");setNotice("");step("preparing");
    try{const d=await api.generate(goal,job,scope,{settings:choice,notes,retryConfirmed:retry,onPhase:step});if(valid()){setDraft(d);setCompareMode("source");setChecked(false);setImagesReady({source:false,draft:false});setReview(true);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid()){setBusy(false);setPhase("");}}
  }
  async function decide(use){
    if(busy||readOnly||!scope||!draft)return;operating.current=true;setBusy(true);setError("");
    try{
      const result=use?await api.accept(goal,draft,scope,checked):await api.reject(goal,draft,scope);
      if(valid()){
        setNotice(use?(partState?"Saved as the \u201c"+partState.label+"\u201d image. Shots at those moments use it in place of the location image.":"Location artwork updated. Its previous image remains in version history."):"Draft rejected. Location artwork was not changed.");
        setDraft(await api.load(goal,scope));setReview(false);setChecked(false);
        if(use&&result.reviewRecorded===false)setNotice("Artwork saved. Refresh to verify the draft's review marker before any further action.");
      }
    }catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid())setBusy(false);}
  }
  async function retrySave(){
    if(busy||readOnly||!scope)return;operating.current=true;setBusy(true);setError("");step("saving");
    try{const d=await api.retrySave(goal,scope);if(valid()){setDraft(d);setCompareMode("source");setChecked(false);setImagesReady({source:false,draft:false});setReview(true);setRetry(false);}}
    catch(e){if(valid())setError(e.message);}
    finally{operating.current=false;if(valid()){setBusy(false);setPhase("");}}
  }
  const E=React.createElement;
  const controls=()=>E("div",{className:"loc-cloud-render-actions"},
    E("button",{type:"button",className:"art-draftall",disabled:readOnly||busy||stale||decided||!checked||!draft?.source||!imagesReady.source||!imagesReady.draft,onClick:()=>decide(true)},partState?"Use as the \u201c"+partState.label+"\u201d image":"Use as location artwork"),
    E("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy||decided,onClick:()=>decide(false)},"Reject draft"));
  const label={all:"All four views",TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const position={all:[0,0],TL:[0,0],TR:[-100,0],BL:[0,-100],BR:[-100,-100]}[camera];
  const imageStyle={width:camera==="all"?"100%":"200%",height:camera==="all"?"100%":"200%",left:position[0]+"%",top:position[1]+"%"};
  const engineView=compareMode==="engines";
  const engineLabel=d=>window.nbModelLabel(d.meta.modelId)+(d.meta.quality?" · "+d.meta.quality:"")+(d.meta.size?" · "+d.meta.size:"");
  const leftImage=engineView?pair?.left.url:draft?.source,rightImage=engineView?pair?.right.url:draft?.url;
  const leftLabel=engineView?(pair?engineLabel(pair.left):"First engine"):"Blender source",rightLabel=engineView?(pair?engineLabel(pair.right):"Second engine"):"Styled draft";
  const problem=reason||error;
  return E("section",{className:"loc-style-preview","data-testid":"location-style-preview"},
    E("h4",null,"Style preview"),
    E("p",{className:"loc-layer-note"},partState
      ?"This set is built at a story moment: "+partState.label+". The styled draft becomes that state's own image; shots at those moments use it in place of the location image, which stays as it is."
      :"Try the location's materials and look over the four Blender views. Review every view before replacing artwork; image styling can move or invent details."),
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
      E("button",{type:"button",className:"art-draftall ghost",disabled:busy||!draft?.source,
        title:draft?"Inspect the saved draft against its Blender reference":"Save a style draft to compare it with its Blender reference",
        onClick:()=>{setCompareMode("source");setChecked(false);setImagesReady({source:false,draft:false});setReview(true);}},"Compare with Blender"),
      E("button",{type:"button",className:"art-draftall ghost",disabled:busy||!pair,onClick:()=>{setCompareMode("engines");setReview(true);}},"Compare engines")),
    E("p",{className:"loc-layer-note"},pair
      ?"Compare engines shows saved results made from the same Blender build and prompt. Opening either comparison uses no generation credits."
      :"To compare engines, save drafts with two different engines using the same Blender build and surface notes. Each generation has its own displayed price; comparisons use no generation credits."),
    phase&&styleProgress({phase,since:phaseAt,now,model:choice?.model,api}),
    !phase&&pending?.active&&E("p",{role:"status",className:"loc-layer-note"},"A style draft for this location is being generated or saved."),
    loading&&E("p",{role:"status",className:"loc-layer-note"},"Loading saved style draft…"),
    // one plain sentence: where the draft stands and what to click (owner 2026-11-01)
    draft&&(decided||!stale)&&E("p",{role:"status",className:"loc-layer-note"},accepted?(partState?"This draft became the \u201c"+partState.label+"\u201d image.":"This draft became the location image."):rejected?"You rejected this draft.":
      partState?"Your draft is ready. Click Compare with Blender to review it. It becomes the \u201c"+partState.label+"\u201d image only if you choose to use it."
      :"Your draft is ready. Click Compare with Blender to review it. The location image only changes if you choose Use as location artwork."),
    draft&&!decided&&stale&&E("p",{className:"loc-spatial-error"},
      "This draft is out of date: the set or its look changed after it was made, so it can't become the location image. Click Generate another style draft to make a new one."),
    notice&&E("p",{role:"status",className:"loc-layer-note"},notice),
    problem&&E("p",{role:"alert",className:"loc-spatial-error"},problem),
    review&&(engineView?pair:draft)&&E("dialog",{ref:dialog,className:"loc-style-dialog","aria-label":engineView?"Compare saved image engines":"Review style draft against Blender",onCancel:()=>setReview(false)},
      E("div",{className:"loc-cloud-render-head"},E("h3",null,engineView?"Compare saved engines":"Review style draft"),E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setReview(false)},"Close review")),
      E("p",null,engineView?"These saved results use the same source build and prompt. Compare every camera; engine quality and size are shown in the labels. This comparison does not replace artwork."
        :"Check the Blender set against the intended floor plan first, then check openings, object positions, lighting and markings in the styled image. A styling model can preserve a mistake in the Blender set."),
      E(StyleGenerationDetails,{meta:engineView?pair?.left.meta:draft?.meta,shared:engineView}),
      E("div",{className:"loc-style-toolbar"},
        E("label",null,"Camera",E("select",{value:camera,onChange:e=>setCamera(e.target.value)},Object.entries(label).map(([value,text])=>E("option",{key:value,value},text)))),
        E("label",null,leftLabel+" revealed: "+wipe+"%",E("input",{type:"range",min:0,max:100,value:wipe,onChange:e=>setWipe(Number(e.target.value)),"aria-label":engineView?"Left engine revealed":"Blender source revealed"}))),
      E("div",{className:"loc-style-legend"},E("span",null,leftLabel),E("span",null,rightLabel)),
      E("div",{className:"loc-style-compare","aria-label":label[camera]+" comparison"},
        E("div",{className:"loc-style-layer"},E("img",{src:rightImage,alt:label[camera]+" · "+rightLabel,style:imageStyle,onLoad:()=>{if(!engineView)setImagesReady(p=>({...p,draft:true}));},onError:()=>{setImagesReady(p=>({...p,draft:false}));setError("The draft image could not be loaded. Close the review and refresh the saved draft.");}})),
        E("div",{className:"loc-style-layer",style:{clipPath:"inset(0 "+(100-wipe)+"% 0 0)"}},E("img",{src:leftImage,alt:label[camera]+" · "+leftLabel,style:imageStyle,onLoad:()=>{if(!engineView)setImagesReady(p=>({...p,source:true}));},onError:()=>{setImagesReady(p=>({...p,source:false}));setError("The Blender comparison could not be loaded. Close the review and refresh the saved draft.");}})),
        E("div",{className:"loc-style-divider",style:{left:wipe+"%"}})),
      !engineView&&stale&&E("p",{className:"loc-spatial-error"},"This draft is outdated and cannot replace artwork."),
      engineView&&(pair.left.meta.sceneHash!==sceneHash||pair.left.meta.briefKey!==brief)&&E("p",{className:"loc-layer-note"},"This is a saved comparison from an earlier build or look. It remains available for inspection."),
      problem&&E("p",{role:"alert",className:"loc-spatial-error"},problem),
      !engineView&&!decided&&E("label",{className:"loc-style-check"},E("input",{type:"checkbox",checked,disabled:readOnly||busy||stale||!imagesReady.source||!imagesReady.draft,onChange:e=>setChecked(e.target.checked)}),"I checked all four views against Blender and accept any visual differences."),
      !engineView&&!decided&&controls(),
      !engineView&&decided&&E("p",null,accepted?"Already used as location artwork.":"Rejected. Generate a new draft to try again."),
      !engineView&&E("p",{className:"loc-layer-note"},(partState?"Using this draft saves it as the \u201c"+partState.label+"\u201d image; the location image is not changed.":"Using this draft replaces the location image and keeps the previous image in version history.")+" Rejecting it does not refund image generation credits.")));
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

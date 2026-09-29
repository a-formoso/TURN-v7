/* locations-ui.jsx — The Art Room ▸ Locations tab (React).
   A location is presented as separate production layers: canonical set identity,
   slugline units, time-of-day variants, required spatial plates, reusable camera
   views, and occurrence-scoped scene setups. */

function locSwatch(intExt){
  return /EXT/.test(intExt||"")
    ? "linear-gradient(135deg,#3f7a52,#1d3326)"      // exterior — green
    : "linear-gradient(135deg,#4a5a78,#222c3e)";     // interior — slate
}

const LOC_PROVENANCE = [
  ["script","SCRIPT"],["inferred","INFERRED"],["design","DESIGN"],["locked","LOCKED"]
];
function LocationProvenanceSelect({l,field,label,onUpdate}){
  const provenance={...((l&&l.provenance)||{})};
  const source=provenance[field]||(l&&l.fromScript?"inferred":"design");
  return React.createElement("select",{className:"loc-prov-select",value:source,title:"Where this fact came from",
    "aria-label":label+" provenance",onChange:e=>{ provenance[field]=e.target.value; onUpdate(l.id,{provenance}); }},
    LOC_PROVENANCE.map(p=>React.createElement("option",{key:p[0],value:p[0]},p[1])));
}
function LocationIdentityField({l,field,label,value,placeholder,onUpdate}){
  const provenance={...((l&&l.provenance)||{})};
  const source=provenance[field]||(l&&l.fromScript?"inferred":"design");
  const commit=(next)=>{
    if(source!=="locked") provenance[field]="design";
    onUpdate(l.id,{[field]:next,provenance});
  };
  const labelNode=React.createElement("span",{className:"loc-field-label"},
    React.createElement("span",null,label),
    React.createElement(LocationProvenanceSelect,{l,field,label,onUpdate}));
  return React.createElement(SheetField,{label:labelNode,value:value||"",multiline:true,placeholder,onCommit:commit});
}

/* Quiet, in-context definitions for the location layers. The details stay out of
   the fold headings, but remain one tap / hover away whenever a section is open. */
function LocationSectionHelp({label,text,summary}){
  return React.createElement("div",{className:"loc-section-help"+(summary?" has-summary":""),title:text},
    summary&&React.createElement("span",{className:"loc-section-help-summary"},summary),
    window.InfoTip&&React.createElement(window.InfoTip,{label:label||"About this section",text}));
}

/* Group the presentation by an established root, while retaining every room's
   original record, image IDs and generation queue target. */
function locationWorkspaceGroups(locations){
  const list=(locations||[]).filter(Boolean), byId=new Map(list.map(l=>[l.id,l])), groups=new Map();
  list.forEach(l=>{
    const root=byId.get(l.rootLocationId)||l;
    if(!groups.has(root.id)) groups.set(root.id,{root,members:[]});
    groups.get(root.id).members.push(l);
  });
  return Array.from(groups.values()).map(g=>{
    const root={...g.root,scenes:Array.from(new Set(g.members.flatMap(l=>l.scenes||[])))};
    return {root,members:[root,...g.members.filter(l=>l.id!==root.id)]};
  });
}
function LocationWorkspace({group,matchingIds,filterKey,batchActiveId,renderLocation}){
  const [selection,setSelection]=React.useState({id:group.root.id,section:""});
  const fallback=matchingIds.includes(group.root.id)?group.root.id:matchingIds[0]||group.root.id;
  React.useEffect(()=>{setSelection({id:fallback,section:""});},[filterKey,fallback]);
  const queued=group.members.find(l=>l.id===batchActiveId);
  const selected=group.members.find(l=>l.id===selection.id);
  const active=queued||selected||group.root;
  const select=(id,section="")=>setSelection({id,section});
  return React.createElement("div",{className:"sheet-card loc-workspace","data-location-workspace":group.root.id},
    group.members.length>1&&React.createElement("div",{className:"loc-workspace-nav"},
      React.createElement("button",{className:"loc-workspace-root",disabled:!!batchActiveId,
        title:"Open the whole location",onClick:()=>select(group.root.id)},group.root.name),
      React.createElement("select",{className:"prop-select",value:active.id,disabled:!!batchActiveId,
        "aria-label":"Space within "+group.root.name,onChange:e=>select(e.target.value)},
        group.members.map(l=>React.createElement("option",{key:l.id,value:l.id},
          l.id===group.root.id?"Whole location":l.name)))),
    renderLocation(active,{workspaceMembers:group.members,onSelectLocation:select,
      initialSection:selection.section,embedded:true}));
}

function LocationScreenplayEvidence({units,onScene}){
  const rows=(units||[]).filter(u=>!u.orphan).flatMap(u=>(u.occurrences||[]).map((o,i)=>{
    const sameScene=(u.occurrences||[]).filter(p=>(p.sceneId||p.sceneNo)===(o.sceneId||o.sceneNo));
    return {u,o,i,visit:sameScene.length>1?" · visit "+(sameScene.indexOf(o)+1)+" of "+sameScene.length:""};
  }));
  return React.createElement("div",{className:"loc-evidence"},
    React.createElement("p",{className:"loc-layer-note"},
      "Screenplay passages establish the space and its uses. Slugline Units identify where and when each passage occurs."),
    rows.length?rows.map(({u,o,i,visit})=>React.createElement("details",{className:"loc-evidence-source",key:u.key+"-"+i},
      React.createElement("summary",null,
        React.createElement("span",null,(u.intExt||"INT")+". "+(u.name||"Location")+(u.time?" — "+u.time:"")),
        React.createElement("small",null," · Scene "+String(o.sceneNo||"?").padStart(2,"0")+visit)),
      React.createElement("div",{className:"loc-space-provenance"},
        typeof screenplaySpaceSourceMeta==="function"?screenplaySpaceSourceMeta({sourceKinds:[o.sourceKind||"slugline"]}).label:"Screenplay"),
      React.createElement("pre",null,o.scriptText||o.slug||"No excerpt available."),
      onScene&&o.sceneId&&React.createElement("button",{className:"art-draftall ghost",onClick:()=>onScene(o.sceneId)},"Focus scene")))
      :React.createElement("div",{className:"loc-variants-empty"},"No current screenplay evidence for this place."));
}

function LocationRoomLinks({entries,onSelectLocation,section}){
  return entries.length>0&&React.createElement("div",{className:"loc-room-links"},
    entries.map(({owner,key,label,detail})=>React.createElement("button",{key,className:"loc-room-link",
      onClick:()=>onSelectLocation(owner.id,section)},
      React.createElement("span",null,React.createElement("b",null,label),React.createElement("small",null,detail)),
      React.createElement(Icon.chevR,{s:14}))));
}

/* One visible plate per screenplay unit. Environmental notes share that unit's
   editor and generator; only independent authored states get another card. */
function locationEnvironmentPresentation(l,units){
  const states=typeof locationAppearanceStates==="function"?locationAppearanceStates(l,units):(l.variants||[]);
  return {
    states,
    units:(units||[]).map(u=>{
      const state=states.find(v=>v.linkedUnit&&v.linkedUnit.key===u.key);
      return state?{...u,appearance:state.state||u.appearance||""}:u;
    }),
    additional:states.filter(v=>!v.linkedUnit),
  };
}
function saveLocationUnitEnvironment(l,u,states,value,onUpdateUnit,onUpdate){
  if(!onUpdateUnit)return;
  onUpdateUnit(u.key,{appearance:value});
  // Keep an existing legacy alias in sync too, including an intentional clear.
  // Otherwise its old state would reappear through the compatibility fallback.
  const linkedIds=new Set((states||[]).filter(v=>v.linkedUnit&&v.linkedUnit.key===u.key).map(v=>v.id));
  const variants=l.variants||[];
  if(onUpdate&&variants.some(v=>linkedIds.has(v.id)&&v.state!==value))
    onUpdate(l.id,{variants:variants.map(v=>linkedIds.has(v.id)?{...v,state:value}:v)});
}

/* A contextual handoff; the full Studio lives outside the location card. */
function LocationBlenderStudioSection({location,references=[],readOnly=false}){
  const studioLocation=location||{};
  const readyRefs=[{entityId:studioLocation.id,label:studioLocation.name||"Location",kind:"location"},...(references||[])]
    .filter((r,i,list)=>r&&r.entityId&&list.findIndex(x=>x&&x.entityId===r.entityId)===i)
    .filter(r=>typeof nbGetMeta==="function"&&nbGetMeta(r.entityId));
  return window.BlenderStudioLaunch && React.createElement(window.BlenderStudioLaunch,{
      location:studioLocation,
      references:readyRefs,
      readOnly});
}
window.LocationBlenderStudioSection=LocationBlenderStudioSection;

function LocationSpatialAnchorEditor({anchor,onRemove,children}){
  const [open,setOpen]=React.useState(!anchor.name);
  return React.createElement("details",{className:"loc-spatial-anchor",open,onToggle:e=>setOpen(e.currentTarget.open)},
    React.createElement("summary",null,React.createElement("span",{className:"loc-spatial-anchor-summary"},
      React.createElement("span",null,anchor.name||"New fixed anchor",
        anchor.space&&React.createElement("small",null," · "+anchor.space)),
      anchor.placement&&React.createElement("span",{className:"loc-spatial-placement"},anchor.placement))),
    React.createElement("div",{className:"loc-spatial-anchor-head"},React.createElement("code",null,anchor.id),
      React.createElement("button",{className:"loc-variant-x","aria-label":"Remove "+(anchor.name||anchor.id),onClick:onRemove},React.createElement(Icon.x,{s:12}))),
    children);
}

function LocationSpatialPlanEditor({l,scenes,project,onUpdate,readOnly=false,reviewRequest=0,onReturnToImage}){
  const [candidate,setCandidate]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
  const [,refresh]=React.useReducer(n=>n+1,0);
  const state=locationSpatialPlanState(l),owner=state.owner,plan=candidate||state.plan;
  const [open,setOpen]=React.useState(!state.ready);
  const summaryRef=React.useRef(null);
  const confirmed=!candidate&&state.ready;
  const empty=!plan.frame.trim()&&!plan.anchors.length&&!plan.sightlines.trim()&&!plan.unresolved.trim();
  const check=locationSpatialPlanState({...owner,spatialPlan:normalizeLocationSpatialPlan({...plan,status:"reviewed",source:state.source})});
  const reviewHint=empty
    ? "No fixed placements have been saved. Draft specification writes the location description; use Draft shared layout to fill the fields below, or enter them manually."
    : !check.complete
    ? (JSON.stringify(plan).length>12000?check.reason:"Add a viewing direction and at least one object below. Each object needs a room, name and fixed placement. You can also draft with AI.")
    : candidate?"Check this proposed layout against your reference panels, then confirm it. Your saved layout is unchanged until you confirm."
    : state.stale&&state.plan.status==="reviewed"?"The parent image changed. Check the placements below against the new image, then confirm again."
    : "Check the placements below against your reference panels, then confirm to enable image generation.";
  const alive=React.useRef(true);
  const draftBasis=React.useRef(null);
  const currentState=()=>locationSpatialPlanState((((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner);
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{setCandidate(null);setError("");},[owner.id]);
  React.useEffect(()=>{if(reviewRequest){setOpen(true);summaryRef.current?.focus({preventScroll:true});}},[reviewRequest]);
  React.useEffect(()=>{const changed=()=>refresh();window.addEventListener("nb-gen-done",changed);
    return ()=>window.removeEventListener("nb-gen-done",changed);},[]);
  const change=patch=>{
    if(readOnly)return;
    const next=normalizeLocationSpatialPlan({...plan,...patch,status:"draft"});
    if(candidate)setCandidate(next);else onUpdate(owner.id,{spatialPlan:next});
  };
  const anchorChange=(id,patch)=>change({anchors:plan.anchors.map(a=>a.id===id?{...a,...patch}:a)});
  const draft=async()=>{
    if(readOnly||busy)return;
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    const original=JSON.stringify(owner.spatialPlan||null),notes=owner.spatialNotes||"";
    setBusy(true);setError("");
    try{
      const result=await aiDraftLocationSpatialPlan(owner,scenes,project);
      if(!alive.current||(typeof nbEpoch==="function"&&nbEpoch()!==epoch))return;
      const current=currentState();
      if(JSON.stringify(current.owner.spatialPlan||null)!==original||(current.owner.spatialNotes||"")!==notes
        ||JSON.stringify(current.source)!==JSON.stringify(result.source))
        throw new Error("The layout or source plate changed during drafting. Please draft again; nothing was overwritten.");
      draftBasis.current={original,notes};setCandidate(result);
    }catch(e){if(alive.current&&(typeof nbEpoch!=="function"||nbEpoch()===epoch))setError(e.message||"Could not draft the layout.");}
    finally{if(alive.current)setBusy(false);}
  };
  const confirm=()=>{
    if(readOnly||busy)return;
    const current=currentState();
    if(candidate&&draftBasis.current&&(JSON.stringify(current.owner.spatialPlan||null)!==draftBasis.current.original
      ||(current.owner.spatialNotes||"")!==draftBasis.current.notes)){
      setError("The saved layout changed. Discard this draft before continuing; the newer layout has been preserved.");return;
    }
    if(candidate&&JSON.stringify(current.source)!==JSON.stringify(candidate.source)){
      setError("The source plate changed. Discard this draft and read the new plate first.");return;
    }
    const reviewed=normalizeLocationSpatialPlan({...plan,status:"reviewed",source:current.source});
    const check=locationSpatialPlanState({...owner,spatialPlan:reviewed});
    if(!check.ready){setError(check.reason);return;}
    onUpdate(owner.id,{spatialPlan:reviewed});setCandidate(null);setError("");
  };
  const field=(label,value,onChange,placeholder)=>React.createElement("label",{className:"loc-spatial-field"},
    React.createElement("span",null,label),React.createElement("textarea",{className:"prop-select",value,
      rows:Math.min(8,Math.max(2,Math.ceil((value||placeholder||"").length/42))),placeholder,onChange:e=>onChange(e.target.value)}));
  const confirmButton=()=>React.createElement("button",{type:"button",className:"art-draftall loc-spatial-confirm",
    disabled:readOnly||busy||!check.complete,onClick:confirm},React.createElement(Icon.check,{s:14}),"Confirm shared layout");
  const draftButton=(primary=false)=>React.createElement("button",{type:"button",
    className:"art-draftall"+(primary?" loc-spatial-confirm":" ghost"),disabled:readOnly||busy,onClick:draft},
    React.createElement(Icon.sparkles,{s:14}),busy?"Reading layout…":"Draft shared layout");
  return React.createElement("details",{className:"loc-nested-section loc-spatial-plan",open,onToggle:e=>{
    if(e.target===e.currentTarget)setOpen(e.currentTarget.open);
  }},
    React.createElement("summary",{ref:summaryRef},"Shared set layout",React.createElement("span",{className:"loc-spatial-status"+(confirmed?" ready":"")},
      candidate?"Draft to review":confirmed?"Confirmed":check.complete?"Needs review":empty?"No layout yet":"Placements incomplete")),
    React.createElement("div",{className:"loc-spatial-review"},
      React.createElement("ol",{className:"loc-spatial-steps","aria-label":"Shared layout workflow"},
        [empty?"Prepare":"Review","Confirm","Generate"].map((step,i)=>React.createElement("li",{key:step,
          "aria-current":i===(confirmed?2:0)?"step":undefined},React.createElement("span",null,i+1),step))),
      React.createElement("strong",null,confirmed?"Shared layout confirmed":empty?"Create the shared layout":"Review the shared layout"),
      React.createElement("p",null,confirmed?"The shared layout is ready. Return to the image to generate when you are ready.":reviewHint),
      confirmed
        ? onReturnToImage&&React.createElement("button",{type:"button",className:"art-draftall ghost loc-spatial-confirm",onClick:onReturnToImage},"Back to image",React.createElement(Icon.chevR,{s:14}))
        : empty?draftButton(true):confirmButton(),
      React.createElement("small",null,readOnly?"View only — ask an editor to prepare or confirm this layout.":empty
        ? "Reads the parent image when available; otherwise uses the written specification. Uses writing-model credits, not image credits. Review and confirm the result before generating."
        : "Confirmation uses no credits and does not generate an image."),
      candidate&&React.createElement("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy,onClick:()=>{setCandidate(null);setError("");}},"Discard draft"),
      error&&React.createElement("p",{role:"alert",className:"loc-spatial-error"},error)),
    React.createElement("p",{className:"loc-layer-note loc-spatial-owner"},"One physical layout for "+(owner.name||"this location")+" and every room. Camera views below change the framing, not the furniture."),
    React.createElement("fieldset",{disabled:readOnly||busy},
      !empty&&React.createElement("details",{className:"loc-spatial-assist"},
        React.createElement("summary",null,"Need help? Draft with AI",React.createElement("small",null,"Optional")),
        React.createElement("p",{className:"loc-layer-note"},"Use only if the layout is missing or needs a new proposal. Reads all parent panels and your corrections below. Uses writing-model credits; no images are generated."),
        draftButton()),
      busy&&React.createElement("p",{role:"status",className:"loc-layer-note"},"Reading the reference panels. Your draft will appear here for review…"),
      React.createElement("h4",{className:"loc-spatial-heading"},empty?"Or enter placements manually":"Review & edit placements"),
      React.createElement("p",{className:"loc-layer-note"},empty
        ? "Set a viewing direction and add at least one fixed object with its room, name and placement. Confirm shared layout becomes available once these are filled."
        : "Check where each object stays. Open an object to edit its placement or supporting evidence."),
      field("Layout corrections / instructions",owner.spatialNotes||"",value=>{
        setCandidate(null);onUpdate(owner.id,{spatialNotes:value.slice(0,2000),spatialPlan:{...state.plan,status:"draft"}});
      },"Describe corrections the reference must respect. Name the room, object and physical relationship, not just screen-left/right."),
      field("Orientation frame",plan.frame,value=>change({frame:value}),"For example: standing at the living-room archway, facing into the kitchen. This direction stays fixed when cameras move."),
      plan.anchors.map(a=>React.createElement(LocationSpatialAnchorEditor,{key:a.id,anchor:a,
        onRemove:()=>change({anchors:plan.anchors.filter(x=>x.id!==a.id)})},
        field("Space",a.space,value=>anchorChange(a.id,{space:value}),"Kitchen"),
        field("Object / opening",a.name,value=>anchorChange(a.id,{name:value}),"Dining table"),
        field("Fixed placement",a.placement,value=>anchorChange(a.id,{placement:value}),"In front of fridge, on the archway-to-fridge sightline; do not move to the opposite wall."),
        React.createElement("label",{className:"loc-spatial-field"},React.createElement("span",null,"Evidence basis"),
          React.createElement("select",{className:"prop-select",value:a.basis,onChange:e=>anchorChange(a.id,{basis:e.target.value})},
            [["observed","Visible in reference"],["script","Screenplay fact"],["design","Proposed design"]].map(o=>React.createElement("option",{key:o[0],value:o[0]},o[1])))),
        field("Supporting panels / evidence",a.evidence,value=>anchorChange(a.id,{evidence:value}),"Top-left: through archway. Top-right: direct kitchen view."))),
      React.createElement("button",{className:"art-draftall ghost",disabled:plan.anchors.length>=24,
        onClick:()=>change({anchors:[...plan.anchors,{id:"anchor-"+Date.now().toString(36),space:l.name||"",name:"",placement:"",basis:"design",evidence:""}]})},"Add fixed anchor"),
      field("Connections & doorway sightlines",plan.sightlines,value=>change({sightlines:value}),"Which rooms connect? What objects are visible through each opening?"),
      field("Unknowns / conflicts to resolve in 3D",plan.unresolved,value=>change({unresolved:value}),"Unseen walls, conflicting panels, dimensions that still need measurement…"),
      React.createElement("p",{className:"loc-layer-note"},"Check placements across all source panels and explicitly resolve any disagreement in Layout corrections. Unknown dimensions remain unmeasured—not exact Blender coordinates. A new parent plate requires another review."),
      !confirmed&&!empty&&React.createElement("div",{className:"loc-spatial-footer"},
        React.createElement("p",{className:"loc-layer-note"},check.complete?"Finished checking? Confirm this layout to enable image generation.":reviewHint),
        confirmButton(),
        error&&React.createElement("p",{className:"loc-spatial-error"},error))));
}

function LocationSheet({ l, project, scenes, drafts, onUpdate, onDelete, onDraft, drafting, onView, batchActiveId, onBatchDone, onChipClick, onDraftStaging, draftingStage, sluglineUnits, onUpdateUnit, onRemoveUnit, readOnly=false, workspaceMembers=[],onSelectLocation,initialSection="",embedded=false }){
  const d = locVisualDefaults(l);
  const styleSource=locationRenderStyleSource(l);
  const inheritsStyle=styleSource.id!==l.id;
  const styleKey=styleSource.renderStyleKey||(window.turnDefaultRenderStyleKey?window.turnDefaultRenderStyleKey():"photoreal");
  const scenePresets = (typeof locScenePresets==="function") ? locScenePresets(l, project) : [];
  const locationUnits=(sluglineUnits||[]).filter(u=>u&&!u.orphan&&
    (String(u.subspaceKey||u.locationKey||"")===String(l.key||"") || (l.scope==="compound"&&String(u.locationKey||"")===String(l.key||""))));
  const displaySide=(typeof locationEffectiveSide==="function")
    ? locationEffectiveSide(l,locationUnits,l.parentLocation?[]:(l.coverageSheets||[]),l.parentLocation?[]:(l.childLocations||[]))
    : (l.intExt||"INT");
  const displaySideLabel=displaySide==="INT/EXT"?"INT+EXT":displaySide;
  const finalPrompt = combinedLocationPrompt(l, project, {});
  const spatialState=locationSpatialPlanState(l);
  const [layoutReviewRequest,setLayoutReviewRequest]=React.useState(0);
  const sheetRef=React.useRef(null);
  const layoutFoldId="loc-layout-"+l.id;
  const reviewLayout=()=>{
    setLayoutReviewRequest(n=>n+1);
    window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:layoutFoldId}));
  };
  const returnToImage=()=>{
    const button=sheetRef.current?.querySelector(".sheet-gen-btn");
    if(button){button.scrollIntoView({behavior:"smooth",block:"center"});button.focus({preventScroll:true});}
  };
  const drafted = locVisualsDrafted(l);
  const initials = (l.name||"?").replace(/^the\s+/i,"").split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();

  // render style — same dropdown + "Surprise me" behaviour as the character cards
  const [styling, setStyling] = React.useState(false);
  // transient "saved · unlock" chip — visible ~4s after landing on the user's own locked style
  const [unlockVisible, setUnlockVisible] = React.useState(false);
  React.useEffect(()=>{
    if(window.turnIsUserStyle && window.turnIsUserStyle(l.renderStyleKey)){
      setUnlockVisible(true); const t=setTimeout(()=>setUnlockVisible(false),4000); return ()=>clearTimeout(t);
    }
    setUnlockVisible(false);
  },[l.renderStyleKey]);
  const locBible = ()=> [l.name&&("Name: "+l.name), l.parentLocation&&("Within: "+l.parentLocation.name), l.architecture&&("Architecture: "+l.architecture),
    l.materials&&("Materials: "+l.materials), l.lighting&&("Permanent lighting interfaces: "+l.lighting),
    l.permanentDressing&&("Permanent dressing: "+l.permanentDressing), l.topology&&("Topology: "+l.topology),
    l.continuityAnchors&&("Continuity anchors: "+l.continuityAnchors), l.significance&&("Narrative significance: "+l.significance),
    (project&&project.genre)&&("Genre: "+project.genre)].filter(Boolean).join("\n");
  const LOC_TEXT = window.LOC_RENDER_TEXT || {};
  const rollSurprise = async ()=>{
    if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())) return;
    setStyling(true);
    try{ const r = await aiSurpriseStyleText({ name:l.name, kind:"location", bible:locBible() }, project);
      if(r) onUpdate(l.id, { surpriseRender:r, renderStyle:r.style }); }catch(e){}
    setStyling(false);
  };
  const pickLocStyle = async (key)=>{
    if(key!=="surprise"){ onUpdate(l.id, { renderStyleIndependent:true,renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function" ? window.renderStyleText("loc", key) : (LOC_TEXT[key]||LOC_TEXT.photoreal)) }); return; }
    onUpdate(l.id, { renderStyleIndependent:true,renderStyleKey:"surprise" });
    if(l.surpriseRender && l.surpriseRender.style){ onUpdate(l.id, { renderStyle:l.surpriseRender.style }); return; }
    await rollSurprise();
  };
  // LOCK a surprise style → a reusable named style. Location surprise is a STRING, wrapped into
  // a minimal render block the shared registry resolves on every tab.
  const lockSurprise = async ()=>{
    if(!(l.surpriseRender && l.surpriseRender.style) || typeof window.turnLockRenderStyle!=="function") return;
    const block = { rendering:String(l.surpriseRender.style), rules:["no text, labels, watermarks, annotations, typography or captions"] };
    const key = await window.turnLockRenderStyle(l.surpriseRender.label, block);
    if(key){ onUpdate(l.id, { renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function"?window.renderStyleText("loc",key):l.surpriseRender.style) });
      if(typeof window.appToast==="function") window.appToast("Style locked — now reusable across Characters, Props & Locations"); }
  };
  const unlockCurrent = async ()=>{
    if(!(window.turnIsUserStyle && window.turnIsUserStyle(l.renderStyleKey))) return;
    const ok = window.appConfirm ? await window.appConfirm({ title:"Unlock this saved style?",
      body:"It's removed from your saved styles. Cards still using it fall back to Photoreal." }) : true;
    if(!ok) return; const k=l.renderStyleKey; window.turnUnlockRenderStyle(k);
    onUpdate(l.id,{ renderStyleKey:"photoreal", renderStyle:(typeof window.renderStyleText==="function"?window.renderStyleText("loc","photoreal"):"") });
  };

  // time-of-day is script-derived (no manual control): keep it in sync with the
  // current derivation. Reads ONLY the scenes' slugline time tags (not prose
  // summaries), keeps every distinct real time, and CLEARS values when the script
  // states no real time (Continuous / Loading Program → "time unset").
  React.useEffect(()=>{
    if(typeof deriveLocationTimes!=="function") return;
    const next = deriveLocationTimes(l, scenes);
    const cur = l.times || [];
    const same = next.length===cur.length && next.every((t,i)=>t===cur[i]);
    if(!same) onUpdate(l.id, { times: next });
  },[l.id, scenes]);

  React.useEffect(()=>{
    if(typeof deriveLocationCoverageSheets!=="function") return;
    const C = window.turnContinuity || {};
    // units passed EXPLICITLY (not read off window.turnContinuity) and in the deps,
    // so the unit-precedence skip rule always recalculates when units change —
    // a side sheet must never slip in before the latest units are visible.
    const derived = deriveLocationCoverageSheets(l, scenes, drafts||C.drafts||{}, undefined, sluglineUnits);
    const cur = l.coverageSheets || [];
    const curById = {}; cur.forEach(v=>{ if(v&&v.id) curById[v.id]=v; });
    const merged = derived.map(v=>({ ...(curById[v.id]||{}), ...v }));
    const same = JSON.stringify(cur)===JSON.stringify(merged);
    if(!same) onUpdate(l.id, { coverageSheets: merged });
  },[l.id, l.intExt, (l.scenes||[]).join(","), scenes, drafts, sluglineUnits]);

  const [masterRefs, setMasterRefs] = React.useState([]);
  const [masterRefOff, setMasterRefOff] = React.useState([]);
  const [parentRefUrl,setParentRefUrl]=React.useState("");
  const masterParentSnapshot=React.useRef({});
  React.useEffect(()=>{
    let alive=true;
    const id=l.parentLocation&&l.parentLocation.id;
    if(!id){ setParentRefUrl(""); return ()=>{alive=false;}; }
    const refresh=async ()=>{ let url=(typeof nbGetImage==="function")?nbGetImage(id):"";
      if(!url&&typeof nbLoadImage==="function"){ try{url=await nbLoadImage(id);}catch(e){} }
      if(alive) setParentRefUrl(url||""); };
    refresh();
    const onDone=(e)=>{ if(e&&e.detail&&e.detail.id===id) refresh(); };
    window.addEventListener("nb-gen-done",onDone);
    return ()=>{alive=false;window.removeEventListener("nb-gen-done",onDone);};
  },[l.parentLocation&&l.parentLocation.id]);
  const buildMasterRefs = ()=>{
    const out = [];
    const C = window.turnContinuity || {};
    if(l.parentLocation){
      const rootUrl=((typeof nbGetImage==="function")?nbGetImage(l.parentLocation.id):"")||parentRefUrl;
      out.push(locationParentReference(l,rootUrl));
    }
    const list = (Array.isArray(l.scenes) && l.scenes.length)
      ? scenesInStoryOrder((scenes||C.scenes||[]).filter(s=>l.scenes.indexOf(s.id)>=0))
      : scenesInStoryOrder(scenes||C.scenes);
    for(const sc of list){
      const imgs = (typeof locationScreenplayReferenceImages==="function")
        ? locationScreenplayReferenceImages(l, { name:l.name, sceneNos:[sc.no] }, scenes||C.scenes||[], drafts||C.drafts||{})
        : [];
      imgs.forEach((url,i)=>{ if(out.length<6) out.push({ url, kind:"script", ready:true, required:false,
        refId:"script-main-"+l.id+"-"+(sc.no||sc.id)+"-"+i,
        label:"Scene "+String(sc.no||"?").padStart(2,"0")+" p"+(i+1),
        note:"full-scene screenplay page "+(i+1)+" for Scene "+(sc.no||"?")+" — use this to design the location's 2x2 geography from what is actually filmed; do not render page text or borders" }); });
      if(out.length>=6) break;
    }
    return out;
  };
  const masterScriptSig = JSON.stringify((l.scenes||[]).map(sid=>(((drafts||{})[sid]||{}).blocks||[])));
  const masterRefsKey = [l.id, l.parentLocation&&l.parentLocation.id, parentRefUrl, (l.scenes||[]).join(","), scenes&&scenes.length, masterScriptSig].join("|");
  React.useEffect(()=>{ setMasterRefs(buildMasterRefs()); },[masterRefsKey]);
  const toggleMasterRef = (rid)=> setMasterRefOff(off=>{
    if(masterRefs.some(r=>r.refId===rid&&r.required))return off;
    return off.indexOf(rid)>=0 ? off.filter(x=>x!==rid) : [...off, rid];
  });

  /* ---- staging auto-draft ------------------------------------------------
     The depth grid feeds the plate prompt (landmarks / floor / scale) and every
     shot's depth layering, but the AI design pass only drafts it for revisited
     (2+ scene) locations. So: any FULL plate render on an unstaged location now
     drafts the grid first, then renders from it. Edits, simple renders and
     photo-anchored plates skip it. Fail-open: if the draft fails, the plate
     renders from prose exactly as before.
     stagingDraftRef carries the fresh draft into buildFinal because the parent
     state update (onUpdate) may not have re-rendered by the time the prompt is
     assembled. Cleared once l.staging catches up. */
  const stagingDraftRef = React.useRef(null);
  const [stagingPrep, setStagingPrep] = React.useState(false);
  React.useEffect(()=>{ if(stagingDraftRef.current && typeof stagingHasContent==="function" && stagingHasContent(l)) stagingDraftRef.current=null; },[l.staging]);
  const locStaged = (typeof stagingHasContent==="function") ? stagingHasContent(l) : true;

  const gen = useImageGen({
    id: l.id, slotId: "locref-"+l.id,
    entity: locationRenderEntity(l),
    /* Clear cascades to this location's time-of-day variant plates so they aren't
       orphaned in storage. */
    relatedClearIds: ()=> Array.from(new Set([
      ...(l.variants||[]).map(v=> (typeof locationAppearanceStateAssetId==="function")
        ? locationAppearanceStateAssetId(l,v,sluglineUnits||[]) : l.id+"-"+v.id),
      ...(l.coverageSheets||[]).map(v=>l.id+"-"+v.id),
      ...((typeof sluglineUnitImageId==="function") ? units.map(u=>sluglineUnitImageId(u.key)) : [])
    ])),
    buildFinal: ()=> combinedLocationPrompt(stagingDraftRef.current
      ? { ...l, staging: stagingDraftRef.current } : l, project, {}),
    buildFromPhoto: ()=> buildLocationFromPhotoPrompt(l, project),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    attachmentsRequired:!!l.parentLocation,
    attachmentsInSimple:true,
    referenceMaxDim:1536,
    attachments: async ()=>{
      requireLocationSpatialPlan(l);
      const parentRefs=mergeLocationReferences(await locationParentReferences(l),await locationSpatialReferences(l));
      masterParentSnapshot.current=l.parentLocation
        ? locationAssetDependencySnapshot(locationParentOf(l).id,[],"subspace") : {};
      return [...parentRefs,...buildMasterRefs().filter(r=>!r.required&&r.url&&masterRefOff.indexOf(r.refId)<0)].slice(0,6)
        .map(r=>({url:r.url,kind:r.kind==="script"?"script":"location",refId:r.refId,note:r.note}));
    },
    attachmentsText: (refs)=> refs && refs.length
      ? "REFERENCE IMAGES are attached: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")
        +". Read screenplay pages together as evidence for permanent geography. A continuity-root plate is binding inherited identity, not a panel map. "
        +"They are NOT a quadrant map: do not make one panel per page or per scene. The 2x2 is four different camera views of the same coherent space, following the prompt's panel plan. "
        +"Aggregate architecture, fixtures, sightlines and action affordances only. Do NOT bake in scene-specific time of day, weather or progression (for example NIGHT/rain versus DAWN); those belong to each Slugline Unit or Time-of-Day Variant plate. "
        +"Never copy screenplay typography, page borders, text, captions or layout."
      : "",
    metaExtra:({mode,prompt})=>({
      specPrompt:locationCanonicalSpecPrompt(mode,prompt,finalPrompt,gen.genMeta),
      ...masterParentSnapshot.current
    }),
    /* NO set-dressing refs at generation — the clean plate anchors the look;
       fixtures are painted in afterwards via the Edit panel's Set-dressing buttons */
    buildEdit: (instr)=>
      "Edit this location reference plate for "+(l.name||"the place")+". "
      +"Apply ONLY this change: "+instr+". "
      +"Preserve everything else \u2014 the SAME architecture, proportions, materials and light "
      +"across all panels. Keep the same multi-angle grid of the same empty space. "
      +"Do not redesign or re-imagine the location."+locationSpatialPrompt(l),
  });
  // this location's set-dressing props — offered as one-click edit instructions in
  // the plate's Edit panel.
  const dressProps = (typeof locDressingProps==="function") ? locDressingProps(l) : [];
  const sheetRefOf = (p)=> async ()=>{ let u = (typeof nbGetImage==="function") ? nbGetImage(p.id) : "";
    if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(p.id); }catch(e){} }
    return u||""; };

  /* the auto-draft wrapper around gen.generate(). Cross-instance __nbStagePhase lock:
     during the draft nothing is registered in __nbGenInflight yet, so a remount
     (opening the viewer) could re-enter and draft + render twice — same shape as the
     props owner-phase lock. */
  const _stagePhase = ()=> !!(window.__nbStagePhase && window.__nbStagePhase[l.id]);
  const generatePlate = async (gopts)=>{
    const g = gopts||{};
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    try{ await locationParentReferences(l); requireLocationSpatialPlan(l); }
    catch(e){
      if(typeof window.appToast==="function")window.appToast(e.message);
      if(batchActiveId===l.id&&onBatchDone)onBatchDone(l.id);
      return false;
    }
    if(typeof nbEpoch==="function"&&nbEpoch()!==epoch)return false;
    const needs = !(g.editInstruction || g.simple) && !gen.slotHasRef
      && !locStaged && !stagingDraftRef.current
      && typeof aiDraftStaging==="function"
      && typeof aiAvailable==="function" && aiAvailable();
    if(needs){
      window.__nbStagePhase = window.__nbStagePhase || {};
      if(window.__nbStagePhase[l.id]) return;   // another instance of this card is mid-draft and will render
      window.__nbStagePhase[l.id] = true;
      setStagingPrep(true);
      if(batchActiveId!==l.id && typeof window.appToast==="function")
        window.appToast("Drafting the depth grid first \u2014 the plate follows");
      try{
        const st = await aiDraftStaging(l, scenes, project);
        if(st){ stagingDraftRef.current = st; onUpdate(l.id, { staging: st }); }
      }catch(e){}
      finally{ delete window.__nbStagePhase[l.id]; setStagingPrep(false); }
    }
    return gen.generate(gopts);
  };
  const genPlate = { ...gen, generate: generatePlate };

  // batch generation: parent activates this card by id; generate then report done.
  // REMOUNT-SAFE (see CharacterSheet): seed batchStarted from the in-flight registry so
  // a card remounting mid-generation doesn't fire a second generate on completion.
  // The registry is keyed by the GEN id (l.id — what useImageGen registers), NOT the
  // "locref-" reference-slot key: checking the slot key made this guard dead code, and
  // a mid-batch remount (e.g. opening the viewer) generated every plate TWICE.
  // The staging-draft phase counts as in-flight (nothing is registered yet while the
  // grid is being written — without this a remount re-fires the whole sequence).
  const _lgen = l.id;
  const batchStarted = React.useRef(!!((window.__nbGenInflight && window.__nbGenInflight[_lgen]) || (window.__nbStagePhase && window.__nbStagePhase[l.id])));
  const wasGening = React.useRef(false);
  React.useEffect(()=>{
    const mine = batchActiveId===l.id;
    const inflight = !!(window.__nbGenInflight && window.__nbGenInflight[_lgen]) || _stagePhase();
    if(!mine){ batchStarted.current=inflight; wasGening.current=gen.gening; return; }
    if(!batchStarted.current && !gen.gening && !inflight){ batchStarted.current=true; wasGening.current=false; generatePlate(); return; }
    if(batchStarted.current && wasGening.current && !gen.gening){ batchStarted.current=false; onBatchDone && onBatchDone(l.id); }
    wasGening.current = gen.gening;
  },[batchActiveId, gen.gening, l.id]);

  // ---- per-PANEL edit (like the Storyboard's "Edit a panel") -----------------
  // A plate is a 2×2 grid of views of ONE space. Edit ONE quadrant via a position-
  // scoped instruction on the whole image (image-edit off the current plate, so it
  // works for generated AND uploaded plates alike). Position-scoped, so it's robust
  // even for legacy 6-panel plates.
  const LOC_PANELS = [
    { grid:"TOP-LEFT",     label:"Top-left",     hint:"wide establishing" },
    { grid:"TOP-RIGHT",    label:"Top-right",    hint:"high overview" },
    { grid:"BOTTOM-LEFT",  label:"Bottom-left",  hint:"close-up" },
    { grid:"BOTTOM-RIGHT", label:"Bottom-right", hint:"close-up" },
  ];
  const [panelEdit, setPanelEdit] = React.useState(null);   // { idx:int|null, text:string } | null
  const applyPanelEdit = ()=>{
    if(!panelEdit || panelEdit.idx==null || !panelEdit.text.trim() || gen.gening) return;
    const p = LOC_PANELS[panelEdit.idx];
    const instr = "In the "+p.grid+" panel of the multi-view grid ONLY (the "+p.hint+" view), "
      + panelEdit.text.trim() + ". Leave the OTHER panels of the grid EXACTLY as they are — same framing and content.";
    gen.generate({ editInstruction: instr });
    setPanelEdit(null);
  };

  const sceneById = React.useMemo(()=>{ const m={}; (scenes||[]).forEach(s=>{ m[s.id]=s; }); return m; },[scenes]);
  const locScenes = scenesInStoryOrder((l.scenes||[]).map(id=>sceneById[id]).filter(Boolean));
  const coverageSheets = (l.coverageSheets || []).slice().sort((a,b)=>(Number(a.order||0)-Number(b.order||0)) || String(a.name||"").localeCompare(String(b.name||"")));
  // Units arrive in first screenplay-appearance order from deriveSluglineUnits.
  // Preserve that order here; only move preserved, no-longer-scripted orphans last.
  const units = (sluglineUnits||[]).filter(u=>u && String(u.subspaceKey||u.locationKey||"")===String(l.key||""))
    .sort((a,b)=> (a.orphan?1:0)-(b.orphan?1:0));
  const roomLocations=l.parentLocation?[]:workspaceMembers.filter(m=>m.id!==l.id);
  const roomUnits=roomLocations.flatMap(owner=>(sluglineUnits||[])
    .filter(u=>u&&!u.orphan&&String(u.subspaceKey||u.locationKey||"")===String(owner.key||""))
    .map(u=>({owner,u,key:u.key,label:(u.intExt||"INT")+". "+u.name+(u.time?" — "+u.time:""),
      detail:"Scenes "+(u.sceneNos||[]).map(n=>String(n).padStart(2,"0")).join(", ")})));
  const evidenceUnits=[...units,...roomUnits.map(row=>row.u)];
  const roomStates=roomLocations.flatMap(owner=>locationEnvironmentPresentation(owner,sluglineUnits||[]).additional
    .map(v=>({owner,key:owner.id+"-"+v.id,label:owner.name+" / "+(v.time||"Variant"),
      detail:v.state||"Open this room's additional environment state"})));
  const environment=locationEnvironmentPresentation(l,units);
  const appearanceStates=environment.states;
  const coverageViews = (typeof locationCoverageViews==="function")
    ? locationCoverageViews(l)
    : [{id:"principal",name:(l.name||"Location")+" principal view",staging:(typeof stagingOf==="function"?stagingOf(l):(l.staging||{}))}];
  const sceneSetups = (typeof locationSceneSetups==="function")
    ? locationSceneSetups(l,units)
    : [];

  // Add only a deliberately authored alternate environment. Scripted Night/Dawn
  // states already have one home in their addressed Slugline Units.
  const addVariant = ()=>{
    const used = [...units,...appearanceStates].map(v=>String(v.time||"").toLowerCase());
    const suggest = (l.times||[]).find(t=>!used.includes(String(t).toLowerCase())) || "New environment state";
    onUpdate(l.id,{ variants:[...(l.variants||[]), { id:"v"+Date.now().toString(36), time:suggest, state:"", manualState:true }] });
  };
  const updateVariant = (vid,patch)=> onUpdate(l.id,{ variants:(l.variants||[]).map(v=>v.id===vid?{...v,...patch}:v) });
  const removeVariant = (vid)=> onUpdate(l.id,{ variants:(l.variants||[]).filter(v=>v.id!==vid) });
  const saveCoverageViews = (next)=>{
    const list=(next||[]).map(v=>({...v,legacy:undefined}));
    onUpdate(l.id,{coverageViews:list,staging:list[0]&&list[0].staging||l.staging||{}});
  };
  const updateCoverageView = (vid,patch)=> saveCoverageViews(coverageViews.map(v=>v.id===vid?{...v,...patch}:v));
  const addCoverageView = ()=>{
    const id="view-"+Date.now().toString(36), base=(typeof emptyStaging==="function"?emptyStaging():{});
    const name="Coverage view "+(coverageViews.length+1);
    saveCoverageViews(coverageViews.concat([{id,name,purpose:"",cameraPosition:"",target:"",visibleAnchors:"",
      lens:"",staging:{...base,viewLabel:name}}]));
  };
  const removeCoverageView = (vid)=>{
    if(coverageViews.length<=1) return;
    saveCoverageViews(coverageViews.filter(v=>v.id!==vid));
  };
  const updateSceneSetup = (setup,patch)=>{
    const unit=units.find(u=>u&&u.key===setup.unitKey); if(!unit||!onUpdateUnit)return;
    const list=Array.isArray(unit.setups)?unit.setups.slice():[];
    const storedId=setup.storageId||setup.id;
    const at=list.findIndex(x=>x&&(x.id===storedId||x.id===setup.id));
    const next={id:setup.id,sceneId:setup.sceneId,sceneNo:setup.sceneNo,
      temporaryDressing:setup.temporaryDressing||[],blocking:setup.blocking||"",
      handledProps:setup.handledProps||"",objectStates:setup.objectStates||"",notes:setup.notes||"",...(patch||{})};
    if(at>=0)list[at]=next;else list.push(next);
    // First edit upgrades old unit-level setup notes without discarding them.
    onUpdateUnit(unit.key,{setups:list,dressing:[],notes:""});
  };
  React.useEffect(()=>{
    if(!Array.isArray(l.coverageViews)||!l.coverageViews.length||!l.staging)return;
    const first=l.coverageViews[0]||{};
    if(JSON.stringify(first.staging||{})===JSON.stringify(l.staging||{}))return;
    onUpdate(l.id,{coverageViews:l.coverageViews.map((v,i)=>i? v:{...v,staging:l.staging,
      lens:(l.staging&&l.staging.lens)||v.lens||""})});
  },[l.staging]);

  return React.createElement("div",{ref:sheetRef,className:(embedded?"loc-workspace-sheet":"sheet-card")+(batchActiveId===l.id?" batch-on":""),"data-location-card":l.id},
    React.createElement(SheetFrame,{ gen:genPlate, slotId:"locref-"+l.id, name:l.name, avatarColor:locSwatch(displaySide),
      initials, drafted, drafting, onDraft:()=>onDraft(l), entity:l, onView,
      slotPlaceholder:"Drop a photo of the place", noun:"location plate",
      // The empty plate is also the finished-image importer, so the separate
      // "Upload a finished location plate" button is intentionally omitted.
      dropToImport:true,
      // one-click edit instructions: place each set-dressing fixture INTO the plate.
      // Chip label = prompt-only (built from the prop's spec); the clip button ALSO
      // attaches the fixture's generated sheet (if any) as an edit reference image.
      editSuggestions: [
        ...dressProps.map(p=>({ label:p.name||"fixture", refId:p.id,
          text:(typeof locDressingEditText==="function") ? locDressingEditText(p) : ("Add "+(p.name||"the fixture")+" into the space."),
          title:"Insert the ready edit instruction for this fixture — built from its prop card's spec (form, material, size). Apply edit paints it into the plate, matching the plate's look. Use the clip button beside it to also attach the fixture's sheet as a reference.",
          getRef: sheetRefOf(p) })),
      ],
      specGate:{ ready:(drafted || !l.manual), hint:"Draft the specification first \u2014 architecture, materials & light are what the plate is built from." },
      // edit ONE view of the plate (works on generated or uploaded plates)
      menuExtra: gen.genUrl ? [{ label: panelEdit?"Close panel edit":"Edit a panel\u2026", placement:"beforeEdit",
        title:"Change just ONE view of the multi-angle plate, leaving the others untouched",
        onClick:()=> setPanelEdit(pe=> pe ? null : { idx:null, text:"" }) }] : null,
      referenceControls: masterRefs.length>0 && React.createElement(CoverageReferenceStrip,{ refs:masterRefs, excludedIds:masterRefOff, onToggle:toggleMasterRef, onView }),
      generateDisabled:!spatialState.ready||!!l.parentLocation&&(!parentRefUrl||masterRefs.some(r=>r.required&&!r.ready)),
      generateDisabledLabel:!spatialState.ready?"Review shared layout":"Generate parent plate first",
      onResolveGenerationBlock:!spatialState.ready?reviewLayout:undefined,
      generateDisabledTitle:!spatialState.ready?"Open the shared layout to review and confirm it. No image will be generated.":"Generate or restore the whole location's plate first so this room can match its visual design.",
      onDelete:()=>onDelete(l.id), deleteLabel:"Delete location" }),
    panelEdit && gen.genUrl && React.createElement("div",{className:"sheet-edit-panel loc-panel-edit"},
      React.createElement("div",{className:"loc-panel-pick"},
        LOC_PANELS.map((p,i)=>React.createElement("button",{key:i,
          className:"loc-panel-btn"+(panelEdit.idx===i?" on":""),title:p.label+" \u2014 "+p.hint,
          onClick:()=>setPanelEdit(pe=>({ ...pe, idx:i }))},
          React.createElement("span",{className:"loc-panel-btn-pos"},p.label),
          React.createElement("span",{className:"loc-panel-btn-hint"},p.hint)))),
      React.createElement("input",{className:"sheet-edit-input",type:"text",autoFocus:true,
        placeholder: panelEdit.idx==null ? "Pick a panel above, then describe the change\u2026"
          : ("Change the "+LOC_PANELS[panelEdit.idx].label.toLowerCase()+" view only\u2026"),
        value:panelEdit.text, onChange:e=>setPanelEdit(pe=>({ ...pe, text:e.target.value })),
        onKeyDown:e=>{ if(e.key==="Enter") applyPanelEdit(); if(e.key==="Escape") setPanelEdit(null); }}),
      React.createElement("div",{className:"sheet-edit-acts"},
        React.createElement("button",{className:"sheet-edit-apply",
          disabled:panelEdit.idx==null||!panelEdit.text.trim()||gen.gening,onClick:applyPanelEdit},
          gen.gening?"Editing\u2026":"Apply panel edit"),
        React.createElement("button",{className:"sheet-edit-cancel",onClick:()=>setPanelEdit(null)},"Cancel"))),
    React.createElement("div",{className:"sheet-body"},
      React.createElement("div",{className:"sheet-head"},
        React.createElement("div",{style:{flex:1,minWidth:0}},
          React.createElement("div",{className:"sheet-name loc-name-row",title:l.name||""},
            React.createElement("span",{className:"loc-intext-badge "+(/EXT/.test(displaySide)?"ext":"int"),
              title:displaySideLabel+" screenplay geography"},
              displaySideLabel),
            // resolved WORLD SCALE badge — makes the Auto derivation legible per card
            // (hidden at plain human scale; tooltip says what set it)
            (typeof locationScaleClass==="function") && (()=>{
              const cls = locationScaleClass(l, project||{});
              if(cls==="A") return null;
              const M = ({B:["\ud83d\udc01","Critter world"],C:["\ud83d\uddff","Giant world"],D:["\ud83d\udd2c","Microscopic world"]})[cls]||["",("Class "+cls)];
              return React.createElement("span",{className:"loc-scale-badge",
                title:M[1]+" (Class "+cls+") \u2014 derived automatically from the characters who drive this place's scenes. Plates here render at this scale."},
                M[0]+" "+cls); })(),
            React.createElement(EditText,{value:l.name,placeholder:"Location name\u2026",onCommit:val=>onUpdate(l.id,{name:val})})),
          l.parentLocation&&React.createElement("div",{className:"loc-parent-breadcrumb"},
            "within ",React.createElement("b",null,l.parentLocation.name)," \u00b7 inherits continuity"),
          null),
        // one flex row (like Props' head actions) \u2014 otherwise .sheet-head's column
        // layout stacks each button on its own full-width line
        React.createElement("div",{className:"sheet-head-actions"},
          React.createElement("button",{className:"char-draft-btn"+(drafting?" busy":""),disabled:drafting,onClick:()=>onDraft(l),
            title:"Draft the written location specification. Fixed object placements are drafted separately in Spatial Layout & Staging."},
            React.createElement(Icon.sparkles,{s:12}), drafting?"Drafting\u2026":"Draft specification"),
          window.QaCheckButton && React.createElement(window.QaCheckButton,{ gen, name:l.name, noun:"location plate",
            specFields:()=>({ architecture:(l.architecture||""), materials:(l.materials||""), lighting:(l.lighting||"") }),
            onApplySpec:(patch)=>onUpdate(l.id, patch) }))),

      React.createElement("div",{className:"char-style-row"},
        React.createElement("span",{className:"char-style-lab"},"Render style"),
        React.createElement("div",{className:"char-style-pick"},
          React.createElement(window.RenderStylePicker,{context:"location",value:styleKey,disabled:styling,onPick:pickLocStyle}),
          (window.turnCanLockStyles && window.turnCanLockStyles()) && React.createElement("span",{className:"char-style-count"+(((window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)>=(window.turnGlobalStyleCap||40))?" full":""),title:"Global render styles ("+(window.turnGlobalStyleCap||40)+" max, admin-managed). You can save up to "+(window.turnPersonalStyleCap||10)+" personal render styles. Manage via Styles in the top bar."}, (window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)+"/"+(window.turnGlobalStyleCap||40))),
        styling && React.createElement("span",{className:"char-style-busy"},React.createElement("span",{className:"ns-spin"}),"Inventing\u2026"),
        (!inheritsStyle && !styling && l.renderStyleKey==="surprise" && l.surpriseRender && l.surpriseRender.label) &&
          React.createElement("span",{className:"char-style-name",title:"Re-roll a new surprise style",onClick:rollSurprise},
            l.surpriseRender.label," \u21bb"),
        (!inheritsStyle && !styling && l.renderStyleKey==="surprise" && l.surpriseRender && l.surpriseRender.style && window.turnCanLockStyles && window.turnCanLockStyles()) &&
          React.createElement("button",{className:"char-style-lock",title:"Lock this style \u2014 keep it and reuse it across Characters, Props & Locations",onClick:lockSurprise},"\ud83d\udd12 Lock this style"),
        (!inheritsStyle && !styling && unlockVisible && window.turnIsUserStyle && window.turnIsUserStyle(l.renderStyleKey)) &&
          React.createElement("span",{className:"char-style-name char-style-locked",title:"Your saved style \u2014 reusable everywhere. Click to unlock.",onClick:unlockCurrent},"\ud83d\udd12 saved \u00b7 unlock")),

      React.createElement("div",{className:"prop-scenes location-scenes"},
        React.createElement("span",{className:"prop-scenes-lab"},"SCENES"),
        React.createElement(SceneChipPager,{ none:"No scenes reference this place",
          items: locScenes.map(s=>({ key:s.id, label:String(s.no).padStart(2,"0"), className:"prop-scene-chip",
            title:s.title||("Scene "+s.no), onClick:()=>onChipClick&&onChipClick(s.id) })) })),

      React.createElement(CardFold,{label:"The Space",defaultOpen:(!drafted && !!l.manual)},
        React.createElement(LocationSectionHelp,{
          label:"About The Space",
          text:"Defines the persistent physical location: architecture, layout, materials, fixed features, geography, entrances and exits. This is the location's identity."}),
        l.parentLocation && React.createElement("div",{className:"loc-inheritance-note"},
          React.createElement(Icon.layers,{s:12}),
          React.createElement("span",null,"Inherited from ",React.createElement("b",null,l.parentLocation.name),": shared architecture, material language, scale, topology and locked anchors. Store only what is specific to ",l.name||"this child"," below.")),
        React.createElement("div",{className:"sheet-field"},
          React.createElement("div",{className:"obj-lab"},"Screenplay sides"),
          React.createElement("select",{className:"prop-select",value:l.intExt||"INT",
            onChange:e=>onUpdate(l.id,{intExt:e.target.value})},
            [["INT","INT"],["EXT","EXT"],["INT/EXT","INT+EXT"]].map(o=>React.createElement("option",{key:o[0],value:o[0]},o[1])))),
        React.createElement(LocationIdentityField,{l,field:"architecture",label:"Architecture & layout",value:l.architecture,
          placeholder:"The space's layout, scale, structure and defining built features\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"materials",label:"Materials & palette",value:l.materials,
          placeholder:"Permanent surfaces, colours, textures and wear\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"lighting",label:"Permanent lighting & daylight interfaces",value:l.lighting,
          placeholder:"Fixtures, windows and orientation only \u2014 changing conditions belong to the Slugline Unit's Lighting & environment\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"permanentDressing",label:"Permanent / baseline dressing",value:l.permanentDressing||"",
          placeholder:"Furniture and fixtures that remain part of the place\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"topology",label:"Spatial topology",value:l.topology||"",
          placeholder:"Living Room \u2194 Kitchen: cased archway; Kitchen \u2192 Rear Yard: window over sink\u2026",onUpdate}),
        React.createElement("div",{className:"loc-anchor-field"},
          React.createElement("div",{className:"loc-anchor-head"},
            React.createElement("span",{className:"loc-field-label"},
              React.createElement("span",null,"Continuity anchors"),
              React.createElement(LocationProvenanceSelect,{l,field:"continuityAnchors",label:"Continuity anchors",onUpdate})),
            React.createElement("button",{className:"loc-anchor-lock"+(l.anchorsLocked===false?"":" locked"),
              title:l.anchorsLocked===false?"Make these anchors binding for generation":"Binding: these facts cannot drift across representations",
              onClick:()=>onUpdate(l.id,{anchorsLocked:l.anchorsLocked===false})},l.anchorsLocked===false?"\ud83d\udd13 Editable":"\ud83d\udd12 Binding")),
          React.createElement(EditText,{value:l.continuityAnchors||"",multiline:true,
            placeholder:"Low ceiling; cased kitchen archway; three-pane front door; sink-window geometry\u2026",
            onCommit:val=>onUpdate(l.id,{continuityAnchors:val})}))),

      React.createElement(CardFold,{label:"Narrative Significance",defaultOpen:false},
        React.createElement(LocationSectionHelp,{
          label:"About Narrative Significance",
          text:"Explains what the location means dramatically: how it functions in the story, its mood and thematic role, and each character's relationship to the space."}),
        React.createElement(SheetField,{label:"Narrative function \u2014 interpretive guidance",value:l.significance,multiline:true,
          placeholder:"Its dramatic role \u2014 what happens here, what it represents\u2026",onCommit:val=>onUpdate(l.id,{significance:val})})),

      React.createElement(CardFold,{label:"Screenplay Evidence",defaultOpen:false},
        React.createElement(LocationScreenplayEvidence,{units:evidenceUnits,onScene:onChipClick})),

      React.createElement(CardFold,{label:"Slugline Units",defaultOpen:initialSection==="units"||initialSection==="environments"},
        React.createElement("div",{className:"loc-variants"},
          units.length
            ? environment.units.map(u=>React.createElement(SluglineUnitCard,{key:u.key, l, u, project, scenes, drafts,
                parentGenUrl:gen.genUrl, onRemoveUnit, onView,
                onEnvironmentChange:state=>saveLocationUnitEnvironment(l,u,appearanceStates,state,onUpdateUnit,onUpdate)}))
            : !roomUnits.length&&React.createElement("div",{className:"loc-variants-empty"},"No authored or screenplay-derived slugline unit currently addresses this location."),
          React.createElement(LocationRoomLinks,{entries:roomUnits,onSelectLocation,section:"units"}),
          React.createElement("details",{className:"loc-nested-section",open:initialSection==="environments"?true:undefined},
            React.createElement("summary",null,"Additional environment states"),
            React.createElement("p",{className:"loc-layer-note"},"Only for another look not already represented by a Slugline Unit, such as a storm or power outage. Scripted Night / Dawn changes are edited in each unit's Lighting & environment."),
            environment.additional.map(v=>React.createElement(LocationVariant,{key:v.id,l,v,project,scenes,drafts,units,
              parentGenUrl:gen.genUrl,onTime:time=>updateVariant(v.id,{time}),
              onState:state=>updateVariant(v.id,{state}),onRemove:()=>removeVariant(v.id),onView})),
            React.createElement(LocationRoomLinks,{entries:roomStates,onSelectLocation,section:"environments"}),
            React.createElement("button",{className:"art-draftall ghost loc-variant-add",onClick:addVariant},
              React.createElement(Icon.plus,{s:14}),"Add environment state")),
          !l.parentLocation&&coverageSheets.length>0&&React.createElement("details",{className:"loc-nested-section"},
            React.createElement("summary",null,"Additional space plates"),
            React.createElement("p",{className:"loc-layer-note"},"Extra empty-set references required by the screenplay, such as an exterior, threshold or connecting space."),
            coverageSheets.map((v,i)=>React.createElement(LocationCoverageSheet,{key:v.id,l,v,project,scenes,drafts,
              previousSheets:coverageSheets.slice(0,i),parentGenUrl:gen.genUrl,onView}))))),

      React.createElement(CardFold,{label:"Spatial Layout & Staging",foldId:layoutFoldId,defaultOpen:initialSection==="layout",
        count:!spatialState.ready?"layout needs review":locStaged?null:(stagingPrep?"staging\u2026":"drafts on first render")},
        React.createElement(LocationSpatialPlanEditor,{l,scenes,project,onUpdate,readOnly,reviewRequest:layoutReviewRequest,onReturnToImage:returnToImage}),
        React.createElement(LocationRoomLinks,{entries:roomLocations.map(owner=>({owner,key:owner.id,
          label:owner.name,detail:"Open room layout and staging"})),onSelectLocation,section:"layout"}),
        React.createElement(CoverageViewsEditor,{l,views:coverageViews,onUpdateView:updateCoverageView,
          onAdd:addCoverageView,onRemove:removeCoverageView,onDraftStaging,draftingStage}),
        sceneSetups.length>0&&React.createElement("details",{className:"loc-nested-section"},
          React.createElement("summary",null,"Scene dressing & blocking"),
          React.createElement("p",{className:"loc-layer-note"},"Preparation notes for each screenplay occurrence. Shot timing, cuts and performance are directed in Shots / Blender previz."),
          React.createElement("div",{className:"loc-variants"},sceneSetups.map(s=>React.createElement(SceneSetupCard,{key:s.id,setup:s,
            unit:units.find(u=>u&&u.key===s.unitKey),onUpdate:patch=>updateSceneSetup(s,patch)})))),

      React.createElement(LocationBlenderStudioSection,{
        location:{id:l.id,name:l.name,parentLocationId:l.parentLocation&&l.parentLocation.id||null,
          rootLocationId:l.rootLocationId||l.id,
          context:{description:l.significance||"",architecture:l.architecture||"",materials:l.materials||"",
            staging:l.staging||"",productionPlan:(typeof locationProductionPlan==="function")
              ? locationProductionPlan(l,units) : null}},
        references:[
          ...(spatialState.owner.id!==l.id?[{entityId:spatialState.owner.id,label:"Parent set · "+spatialState.owner.name,kind:"location"}]:[]),
          ...units.map(u=>({entityId:(typeof sluglineUnitImageId==="function"?sluglineUnitImageId(u.key):u.key),
            label:"Slugline Unit · "+(u.name||l.name||"Location")+(u.time?(" · "+u.time):""),kind:"location"})),
          ...coverageSheets.map(v=>({entityId:l.id+"-"+v.id,label:"Required Space Plate · "+(v.name||l.name||"Location"),kind:"location"})),
          ...appearanceStates.map(v=>({entityId:(typeof locationAppearanceStateAssetId==="function"
              ? locationAppearanceStateAssetId(l,v,units):l.id+"-"+v.id),
            label:"Time-of-Day Variant · "+(v.time||v.id||"Variant"),kind:"location"}))],
        readOnly})),

      React.createElement(CardFold,{label:"Generation Prompt",defaultOpen:false},
        React.createElement(CopyBox,{label:"Current specification \u2014 next generation",text:finalPrompt}),
        React.createElement("p",{className:"loc-layer-note"},"Built from this space's current specification. Selected reference instructions are added when you generate."),
        React.createElement("details",{className:"loc-nested-section loc-render-style-details"},
          React.createElement("summary",null,"Render style details"),
          l.parentLocation&&React.createElement("label",{className:"loc-style-inherit",title:"Link to the parent, or turn this off to use this room's saved style settings."},
            React.createElement("input",{type:"checkbox",checked:inheritsStyle,
              onChange:e=>onUpdate(l.id,{renderStyleIndependent:!e.target.checked})}),
            "Use "+l.parentLocation.name+"'s render style"),
          React.createElement("p",{className:"loc-layer-note"},inheritsStyle
            ? "Follows the parent automatically. Choosing a style or editing these instructions creates a room-only override; scene grading stays in Styles."
            : "Fine-tune this location's render style. Choosing a new Render style preset replaces these instructions; scene grading stays in Styles."),
          scenePresets.length ? React.createElement("div",{className:"loc-style-note"},
            React.createElement(Icon.layers,{s:12}),
            React.createElement("span",null,"Scenes here use ",
              React.createElement("b",null,scenePresets.map(p=>p.name).join(", ")),
              " in the Color tab. Scene grading is applied per shot.")) : null,
          React.createElement(SheetField,{label:"Render style instructions",value:d.renderStyle,multiline:true,
            placeholder:"photoreal architectural cinematography, wide lens, natural light\u2026",
            onCommit:val=>onUpdate(l.id,{renderStyle:val,renderStyleKey:styleKey,renderStyleIndependent:true})})),
        gen.genUrl&&gen.genMeta&&gen.genMeta.prompt&&React.createElement("details",{className:"loc-nested-section"},
          React.createElement("summary",null,"Prompt used for the current plate"),
          React.createElement(CopyBox,{label:"Saved generation prompt",text:gen.genMeta.prompt})),
        React.createElement(SheetField,{label:"Negative prompt \u2014 exclude",value:l.negativePrompt||d.negativePrompt,multiline:true,
          onCommit:val=>onUpdate(l.id,{negativePrompt:val})}))));
}

/* Camera-relative composition, not a measured room plan. The visual editor
   keeps the existing depth-grid fields used by generation and Blender. */
function CoverageViewsEditor({l,views,onUpdateView,onAdd,onRemove,onDraftStaging,draftingStage}){
  const list=Array.isArray(views)?views:[];
  return React.createElement("div",{className:"loc-coverage-views"},
    React.createElement("div",{className:"loc-layer-note"},
      "Plan what the camera sees: what sits far away, in the middle, and close to the lens. Select a zone to edit its landmarks."),
    list.map((v,index)=>React.createElement("div",{className:"loc-variant loc-camera-view",key:v.id},
      React.createElement("div",{className:"loc-variant-head"},
        React.createElement("div",{className:"loc-camera-view-title"},
          index===0&&React.createElement("span",{className:"loc-primary-badge"},"Primary"),
          React.createElement(EditText,{value:v.name||"",placeholder:"Named coverage view",
            onCommit:name=>onUpdateView(v.id,{name,staging:{...(v.staging||{}),viewLabel:name}})})),
        list.length>1&&React.createElement("button",{className:"loc-variant-x",title:"Remove coverage view",
          onClick:()=>onRemove(v.id)},React.createElement(Icon.x,{s:12}))),
      React.createElement(StagingGrid,{l,value:v.staging,cameraPosition:v.cameraPosition,target:v.target,
        onChange:staging=>onUpdateView(v.id,{staging,lens:staging.lens||""}),
        lockViewLabel:true,onDraftStaging:index===0?onDraftStaging:null,draftingStage:index===0&&draftingStage,
        viewDetails:React.createElement("div",{className:"loc-camera-view-fields"},
        React.createElement(SheetField,{label:"Purpose / framing",value:v.purpose||"",multiline:true,
          placeholder:"Reusable master, doorway two-shot, kitchen counter profile\u2026",
          onCommit:purpose=>onUpdateView(v.id,{purpose})}),
        React.createElement(SheetField,{label:"Camera position",value:v.cameraPosition||"",multiline:false,
          placeholder:"Hallway threshold, eye height\u2026",onCommit:cameraPosition=>onUpdateView(v.id,{cameraPosition})}),
        React.createElement(SheetField,{label:"Target",value:v.target||"",multiline:false,
          placeholder:"Kitchen table / north wall\u2026",onCommit:target=>onUpdateView(v.id,{target})}),
        React.createElement(SheetField,{label:"Visible continuity anchors",value:v.visibleAnchors||"",multiline:true,
          placeholder:"Cased archway, sink window, three-pane front door\u2026",
          onCommit:visibleAnchors=>onUpdateView(v.id,{visibleAnchors})}))}))),
    React.createElement("button",{className:"art-draftall ghost loc-variant-add",onClick:onAdd},
      React.createElement(Icon.plus,{s:14}),"Add coverage view"));
}
function StagingGrid({ l, onUpdate, onDraftStaging, draftingStage, value, onChange, lockViewLabel=false, cameraPosition="",target="",viewDetails }){
  const source=value?{...l,staging:value}:l;
  const s = (typeof stagingOf==="function") ? stagingOf(source) : (source.staging||{bg:{},mid:{},fg:{}});
  const [selected,setSelected]=React.useState({plane:"bg",col:"center"});
  const planes=[{key:"bg",label:"Far",term:"Background"},{key:"mid",label:"Middle",term:"Midground"},{key:"fg",label:"Near",term:"Foreground"}];
  const columns=[{key:"left",label:"Left"},{key:"center",label:"Centre"},{key:"right",label:"Right"}];
  const isFloor=selected.key==="floor";
  const plane=planes.find(p=>p.key===selected.plane), col=columns.find(c=>c.key===selected.col);
  const selectedLabel=isFloor?"Floor / ground":plane.label+" · "+col.label;
  const selectedValue=isFloor?s.floor:(s[selected.plane]||{})[selected.col];
  const set = (patch)=>{
    const next = { ...(source.staging||{}),...s,
      bg:{...s.bg}, mid:{...s.mid}, fg:{...s.fg} };
    // patch is a path like {plane:'bg',col:'left',val:'...'} or {key:'scaleClass',val}
    if(patch.key){ next[patch.key] = patch.val; }
    else { next[patch.plane][patch.col] = patch.val; }
    if(onChange) onChange(next);
    else if(onUpdate) onUpdate(l.id,{ staging: next });
  };
  return React.createElement("div",{className:"stage-wrap"},
    React.createElement("div",{className:"stage-toolbar"},
      React.createElement("span",{className:"stage-map-title"},"View composition"),
      onDraftStaging && React.createElement("button",{className:"art-draftall",disabled:draftingStage,onClick:()=>onDraftStaging(l),
        title:"Let AI draft this view's staging and composition from the script"},
        React.createElement(Icon.sparkles,{s:14}), draftingStage?"Drafting\u2026":"Draft layout")),
    React.createElement("div",{className:"stage-composition",role:"group","aria-label":"Camera-relative composition for "+(s.viewLabel||l.name||"this view")},
      React.createElement("div",{className:"stage-map-direction"},target?"Looking toward: "+target:"Farther from the camera"),
      React.createElement("div",{className:"stage-map-columns","aria-hidden":true},
        React.createElement("span",null),columns.map(c=>React.createElement("span",{key:c.key},c.label))),
      React.createElement("div",{className:"stage-map-zones"},
        React.createElement("svg",{className:"stage-map-cone",viewBox:"0 0 300 250",preserveAspectRatio:"none","aria-hidden":true,focusable:false},
          React.createElement("path",{d:"M150 240 L14 10 L286 10 Z",className:"stage-map-cone-fill"}),
          React.createElement("path",{d:"M150 230 L150 20 M144 28 L150 20 L156 28",className:"stage-map-axis"})),
        planes.map(p=>React.createElement("div",{className:"stage-map-row "+p.key,key:p.key},
          React.createElement("span",{className:"stage-map-depth",title:p.term},p.label),
          columns.map(c=>{
            if(p.key==="fg"&&c.key==="center")return React.createElement("div",{className:"stage-map-camera",key:c.key},
              React.createElement("span",{"aria-hidden":true},"↑"),
              React.createElement(Icon.camera?Icon.camera:Icon.eye,{s:23}),React.createElement("b",null,"Camera"));
            const text=String((s[p.key]||{})[c.key]||"").trim(), active=!isFloor&&selected.plane===p.key&&selected.col===c.key;
            return React.createElement("button",{key:c.key,type:"button",className:"stage-zone"+(text?" filled":"")+(active?" selected":""),
              "aria-label":p.label+" "+c.label.toLowerCase()+": "+(text||"Open space"),"aria-pressed":active,
              title:p.term+" · "+c.label+"\n"+(text||"Open space — select to add a landmark"),
              onClick:()=>setSelected({plane:p.key,col:c.key})},
              React.createElement("span",{className:"stage-zone-mark","aria-hidden":true},text?"▰":"+"),
              React.createElement("span",{className:"stage-zone-text"},text||"Open space"));
          })))),
      React.createElement("div",{className:"stage-map-camera-caption"},
        React.createElement("span",null,s.lens||"Lens not set"),
        cameraPosition&&React.createElement("small",null,cameraPosition)),
      React.createElement("button",{className:"stage-map-floor"+(isFloor?" selected":""),type:"button","aria-pressed":isFloor,
        title:s.floor||"Describe the surface underfoot",onClick:()=>setSelected({key:"floor"})},
        React.createElement(Icon.layers?Icon.layers:Icon.eye,{s:14}),React.createElement("b",null,"Floor"),
        React.createElement("span",null,s.floor||"Add ground surface"))),
    React.createElement("p",{className:"stage-map-disclaimer"},"Camera-relative guide · not a measured floor plan."),
    React.createElement("div",{className:"stage-zone-editor",key:isFloor?"floor":selected.plane+"-"+selected.col},
      React.createElement("div",{className:"stage-zone-editor-head"},React.createElement("b",null,selectedLabel),
        React.createElement("span",null,isFloor?"Surface underfoot":plane.term)),
      React.createElement("label",null,React.createElement("span",{className:"stage-editor-label"},"What belongs here?"),
        React.createElement(EditText,{value:selectedValue||"",multiline:true,
          placeholder:isFloor?"Ground material and texture\u2026":"Describe a fixed landmark or framing element. Leave empty for open space.",
          onCommit:val=>set(isFloor?{key:"floor",val}:{plane:selected.plane,col:selected.col,val})}))),
    React.createElement("details",{className:"loc-nested-section stage-view-details"},
      React.createElement("summary",null,"Camera & framing details"),
      viewDetails,
      React.createElement("div",{className:"stage-meta-fields"},
        !lockViewLabel&&React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Coverage view / representation"),
          React.createElement(EditText,{value:s.viewLabel||"",placeholder:(l.name||"Location")+" principal view\u2026",onCommit:val=>set({key:"viewLabel",val})})),
        React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Scale class"),
          React.createElement(EditText,{value:s.scaleClass||"",placeholder:"Human scale / Gigantism\u2026",onCommit:val=>set({key:"scaleClass",val})})),
        React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Camera / lens"),
          React.createElement(EditText,{value:s.lens||"",placeholder:"35mm wide / 100mm macro\u2026",onCommit:val=>set({key:"lens",val})})))));
}

/* screenplay-derived INT/EXT side plates. These are not time/weather variants:
   they are extra empty-set anchors for subspaces the screenplay actually films
   inside a broader scene location (e.g. EXT yard + INT booth). */
function LocationCoverageSheet({ l, v, project, scenes, drafts, previousSheets, parentGenUrl, onView }){
  const id = l.id+"-"+v.id;
  const previousIds=(previousSheets||[]).filter(Boolean).map(p=>l.id+"-"+p.id);
  const sceneNos = Array.isArray(v.sceneNos) ? v.sceneNos.filter(n=>n!=null) : [];
  const sourceLabel = sceneNos.length
    ? ((sceneNos.length>1 ? "Scenes " : "Scene ")+sceneNos.map(n=>String(n)).join(", "))
    : "Scene";
  const [refPreview, setRefPreview] = React.useState([]);
  const [coverageRefOff, setCoverageRefOff] = React.useState([]);
  const _C0 = window.turnContinuity || {};
  const _sheetScene = (typeof locationSceneForCoverageSheet==="function") ? locationSceneForCoverageSheet(l, v, scenes||_C0.scenes||[]) : null;
  const _sheetDraft = _sheetScene && (drafts||_C0.drafts||{})[_sheetScene.id];
  const _scriptSig = JSON.stringify((_sheetDraft&&_sheetDraft.blocks)||[]);
  const refsKey = [l.id, id, v.id, v.order, v.scriptExcerpt, parentGenUrl, _scriptSig, (previousSheets||[]).map(p=>p&&p.id).join(","), scenes&&scenes.length].join("|");
  const buildCoverageRefs = async ()=>{
    const out = [];
    const C = window.turnContinuity || {};
    const scriptImgs = (typeof locationScreenplayReferenceImages==="function")
      ? locationScreenplayReferenceImages(l, v, scenes||C.scenes||[], drafts||C.drafts||{})
      : ((typeof locationScreenplayReferenceImage==="function") ? [locationScreenplayReferenceImage(l, v, scenes||C.scenes||[], drafts||C.drafts||{})].filter(Boolean) : []);
    scriptImgs.forEach((scriptImg, i)=> out.push({ url:scriptImg, kind:"script", refId:"script-"+id+"-"+i, required:false, ready:true,
      label:"Screenplay p"+(i+1), note:"full-scene screenplay page "+(i+1)+" for "+(v.name||l.name||"this Required Space Plate")+" — use it to infer what the script implies, but do not render any text from it" }));
    const grab = async (rid)=>{ let u=(typeof nbGetImage==="function")?nbGetImage(rid):"";
      if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(rid); }catch(e){} } return u||""; };
    const parent = parentGenUrl || await grab(l.id);
    out.push({ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
      label:(l.name||"Parent location"), note:(l.name||"parent location")+" master plate — preserve the same exterior/interior world, materials, scale and light" });
    for(const p of (previousSheets||[])){
      if(!p || !p.id) continue;
      const rid = l.id+"-"+p.id;
      const u = await grab(rid);
      out.push({ url:u, kind:"location previous", refId:rid, required:true, ready:!!u,
        label:p.name||"Previous plate", note:(p.name||"previous Required Space Plate")+" — earlier screenplay geography; keep geometry and thresholds consistent" });
    }
    return out;
  };
  React.useEffect(()=>{
    // seq guards against out-of-order resolution: a slow refresh started for an
    // earlier "done" event must not overwrite the result of a later one
    let alive = true, seq = 0;
    const refresh = ()=>{ const my = ++seq;
      buildCoverageRefs().then(refs=>{ if(alive && my===seq) setRefPreview(refs); }); };
    refresh();
    const onDone = (e)=>{
      const rid = e && e.detail && e.detail.id;
      if(rid===l.id || rid===id || (previousSheets||[]).some(p=>rid===l.id+"-"+p.id)) refresh();
    };
    window.addEventListener("nb-gen-done", onDone);
    return ()=>{ alive=false; window.removeEventListener("nb-gen-done", onDone); };
  },[refsKey]);
  const missingRequiredRefs = refPreview.filter(r=>r.required && !r.ready);
  const canGenerateCoverage = refPreview.length>0 && missingRequiredRefs.length===0;
  const missingPrev = missingRequiredRefs.some(r=>String(r.refId||"").indexOf(l.id+"-")===0);
  // required refs (parent plate, earlier coverage) are the whole point of the gating —
  // they can't be opted out, only the optional ones can
  const toggleCoverageRef = (rid)=> setCoverageRefOff(off=>{
    const r = refPreview.find(x=>x.refId===rid);
    if(r && r.required) return off;
    return off.indexOf(rid)>=0 ? off.filter(x=>x!==rid) : [...off, rid];
  });
  const collectCoverageRefs = async ()=>{
    requireLocationSpatialPlan(l);
    const refs=mergeLocationReferences(await buildCoverageRefs(),await locationSpatialReferences(l));
    if(refs.some(r=>r.required&&!r.ready)){const e=new Error("Restore the required space plates before rendering.");e.requiredReference=true;throw e;}
    return refs
      .filter(r=>r.ready && r.url && (r.required || coverageRefOff.indexOf(r.refId)<0))
      .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note }));
  };
  const gen = useImageGen({
    id, slotId: "loccov-"+id,
    entity: l,
    buildFinal: ()=> buildLocationCoveragePrompt(l, v, project),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    attachmentsInSimple:true,
    referenceMaxDim:1536,
    beforeGenerate: async ()=>{
      const refs = await buildCoverageRefs();
      const missing = refs.filter(r=>r.required && !r.ready);
      const ok = missing.length===0;
      if(!ok && typeof window.appToast==="function"){
        const prev = missing.some(r=>String(r.refId||"").indexOf(l.id+"-")===0);
        window.appToast(prev
          ? "Generate the earlier Required Space Plate first — this one depends on it."
          : "Generate the parent location plate first — this Required Space Plate needs it as a reference.");
      }
      return ok;
    },
    attachments: collectCoverageRefs,
    attachmentsText: (refs)=> refs && refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". The screenplay page snapshots are context only: read the scene geography from them, but never copy their typography, page border, text, captions or layout into the location sheet."
      : "",
    metaExtra:({mode})=> mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream }
      : locationAssetDependencySnapshot(l.id,previousIds,"screenplay-coverage"),
    buildEdit: (instr)=> "Edit this "+(v.role||"INT")+" Required Space Plate for "+(v.name||l.name||"the location")+". Apply ONLY: "+instr+". Keep it consistent with the parent location's architecture, materials and light."+locationSpatialPrompt(l),
  });
  const viewerEntity = {
    ...l,
    id,
    name:(v.name||l.name||"Location")+" · "+(v.role||"INT")
  };
  return React.createElement("div",{className:"loc-variant loc-coverage-sheet"},
    React.createElement("div",{className:"loc-variant-head"},
      React.createElement("div",{className:"loc-coverage-title"},
        React.createElement("span",{className:"loc-intext-badge "+(/EXT/.test(v.role||"")?"ext":"int")},v.role||"INT"),
        React.createElement("b",null,v.name||"Required Space Plate")),
      React.createElement("span",{className:"loc-coverage-source",title:v.summary||""},sourceLabel)),
    v.summary && React.createElement("div",{className:"loc-variants-empty loc-coverage-summary"},v.summary),
    React.createElement(SheetFrame,{ gen, slotId:"loccov-"+id, name:(v.name||l.name||"Location")+" \u00b7 "+(v.role||"INT"),
      avatarColor:locSwatch(v.role), initials:(v.role||"?").slice(0,2).toUpperCase(), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a finished side plate", noun:"Required Space Plate", compact:true,
      // match the unit-plate card: the empty slot itself imports on drop/click, which also
      // drops the redundant "Upload a finished Required Space Plate" button below the generate CTA
      dropToImport:true,
      referenceControls: React.createElement(CoverageReferenceStrip,{ refs:refPreview, excludedIds:coverageRefOff, onToggle:toggleCoverageRef, onView }),
      generateDisabled:!canGenerateCoverage,
      generateDisabledLabel: missingPrev ? "Generate earlier plate first" : "Generate parent plate first",
      generateDisabledTitle: missingPrev
        ? "This Required Space Plate depends on an earlier plate. Generate that plate first so the geometry and sightlines can carry forward."
        : "This Required Space Plate needs the parent location plate as a visual reference before it can generate." }));
}

function CoverageReferenceStrip({ refs, excludedIds, onToggle, onView }){
  refs = refs || [];
  excludedIds = excludedIds || [];
  return React.createElement("div",{className:"coverage-refs"},
    React.createElement("div",{className:"shot-refs-lab"},
      React.createElement(Icon.layers,{s:12}),"Reference images"),
    React.createElement(window.RefStripScroller||"div",{className:"shot-refs-row coverage-refs-row"},
      refs.map((r,i)=>{
        // required refs are locked in — no exclude tick (they gate generation)
        const canToggle = !!(onToggle && r.refId!=null && !r.required);
        const off = canToggle && excludedIds.indexOf(r.refId)>=0;
        // fullscreen SWIPE SET — viewing one reference opens it with the strip's
        // other ready images as siblings, so swipes page through the screenplay
        // snapshots (and the other refs) without closing the viewer
        const viewRef = ()=>{
          if(!onView) return;
          const ready = refs.filter(x=>x && x.ready && x.url);
          const sibsAll = ready.map(x=>({ url:x.url, character:{ name:x.label||"Reference image" } }));
          const at = ready.indexOf(r);
          onView(r.url, { name:r.label||"Reference image" },
            (sibsAll.length>1 && at>=0) ? { siblings:sibsAll, startIndex:at } : null);
        };
        if(r.ready && r.url) return React.createElement("div",{key:i,role:"button",tabIndex:0,
            className:"shot-ref-thumb "+(r.kind==="script"?"script":"location")+(off?" off":""),
            title:(r.required?"Needed to unlock":"Optional")+" — "+(r.note||r.label||"Reference image")+(off?" — excluded from generation":""),
            onClick:viewRef,
            onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); viewRef(); } }},
            React.createElement("img",{src:r.url,alt:r.label||"Reference",loading:"lazy"}),
            r.required && React.createElement("span",{className:"coverage-ref-req"},"need"),
            canToggle && React.createElement("button",{className:"shot-ref-tick"+(off?"":" on"),
              title: off ? "Excluded — click to include this reference image in generation."
                : "Included — click to exclude this reference image from generation.",
              onClick:(e)=>{ e.stopPropagation(); onToggle(r.refId); }},
              off ? "\u00d7" : "\u2713"));
        return React.createElement("div",{key:i,className:"shot-ref-thumb missing "+(r.kind==="script"?"script":"location"),
            title:(r.required?"Required missing":"Optional missing")+" — "+(r.label||"Reference image")},
            React.createElement("span",{className:"coverage-ref-missing"},r.required?"needed":"later"),
            React.createElement("span",{className:"coverage-ref-cap"},r.label||"Reference"));
      })));
}

async function buildSluglineUnitReferences(l,u,imgId,pseudo,scenes,drafts,parentGenUrl){
  const out = [];
  const C = window.turnContinuity || {};
  const scriptImgs = (typeof locationScreenplayReferenceImages==="function")
    ? locationScreenplayReferenceImages(l, pseudo, scenes||C.scenes||[], drafts||C.drafts||{})
    : [];
  scriptImgs.forEach((scriptImg, i)=> out.push({ url:scriptImg, kind:"script", refId:"script-"+imgId+"-"+i, required:false, ready:true,
      label:"Screenplay p"+(i+1), note:"screenplay page "+(i+1)+" for "+(u.name||"this Slugline Unit")+" \u2014 use it to infer what the script implies, but do not render any text from it" }));
  const grab = async (rid)=>{ let u2=(typeof nbGetImage==="function")?nbGetImage(rid):"";
    if(!u2 && typeof nbLoadImage==="function"){ try{ u2=await nbLoadImage(rid); }catch(e){} } return u2||""; };
  const parent = parentGenUrl || await grab(l.id);
  out.push({ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
    label:(l.name||"Parent location"), note:(l.name||"parent location")+" child/master plate \u2014 preserve this exact subspace geometry, materials and continuity anchors" });
  if(l.parentLocation && l.parentLocation.id){
    const rootUrl=await grab(l.parentLocation.id);
    out.push(locationParentReference(l,rootUrl));
  }
  return out;
}

/* An additional environment state. The legacy linked-unit resolver is retained
   for asset compatibility; ordinary linked states render only in their unit. */
function LocationVariant({ l, v, project, scenes, drafts, units, parentGenUrl, onTime, onState, onRemove, onView }){
  const unit = v.linkedUnit || ((typeof locationVariantSluglineUnit==="function")
    ? locationVariantSluglineUnit(l,v,units||[]) : null);
  const stateUnit = unit ? {...unit,appearance:v.state||unit.appearance||""} : null;
  const id = (typeof locationAppearanceStateAssetId==="function")
    ? locationAppearanceStateAssetId(l,v,units||[]) : l.id+"-"+v.id;
  const slotId = "locstate-"+String(id).replace(/[^a-z0-9-]+/gi,"-");
  const pseudo = stateUnit ? { id, name:stateUnit.name, role:stateUnit.intExt,
    sceneNos:stateUnit.sceneNos||[], scriptExcerpt:String(stateUnit.scriptText||"").slice(0,720),
    summary:"Time-of-Day Variant: "+(stateUnit.sluglines||[]).join(" \u00b7 ") } : null;
  const [refPreview,setRefPreview]=React.useState([]);
  const [refOff,setRefOff]=React.useState([]);
  const refsKey=[l.id,id,stateUnit&&stateUnit.scriptText,parentGenUrl,l.parentLocation&&l.parentLocation.id,(scenes&&scenes.length)].join("|");
  const buildRefs=async()=> stateUnit
    ? buildSluglineUnitReferences(l,stateUnit,id,pseudo,scenes,drafts,parentGenUrl)
    : buildSluglineUnitReferences(l,{name:l.name},id,{sceneNos:[]},[],{},parentGenUrl);
  React.useEffect(()=>{
    let alive=true,seq=0;
    const refresh=()=>{const my=++seq;buildRefs().then(refs=>{if(alive&&my===seq)setRefPreview(refs);});};
    refresh();
    const onDone=(e)=>{const rid=e&&e.detail&&e.detail.id;
      if(rid===l.id||rid===id||(l.parentLocation&&rid===l.parentLocation.id))refresh();};
    window.addEventListener("nb-gen-done",onDone);
    return()=>{alive=false;window.removeEventListener("nb-gen-done",onDone);};
  },[refsKey]);
  const missingRequired=refPreview.filter(r=>r.required&&!r.ready);
  const canGenerate=!(stateUnit&&stateUnit.orphan)&&refPreview.length>0&&!missingRequired.length;
  const toggleRef=(rid)=>setRefOff(off=>{
    const r=refPreview.find(x=>x.refId===rid);
    if(r&&r.required)return off;
    return off.indexOf(rid)>=0?off.filter(x=>x!==rid):[...off,rid];
  });
  const collectRefs=async()=>{
    requireLocationSpatialPlan(l);
    const refs=mergeLocationReferences(await buildRefs(),await locationSpatialReferences(l));
    if(refs.some(r=>r.required&&!r.ready))throw new Error("Restore the required location plates before generating this state.");
    return refs.filter(r=>r.ready&&r.url&&(r.required||refOff.indexOf(r.refId)<0))
      .map(r=>({url:r.url,kind:r.kind==="script"?"script":"location",refId:r.refId,note:r.note}));
  };
  const gen = useImageGen({
    id, slotId,
    entity: locationRenderEntity(stateUnit ? {...l,appearanceState:stateUnit} : l),
    buildFinal: ()=> stateUnit && typeof buildSluglineUnitPrompt==="function"
      ? buildSluglineUnitPrompt(l,stateUnit,project)
      : buildLocationVariantPrompt(l, project, { time:v.time, state:v.state }),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    beforeGenerate: async()=>{
      const refs=await buildRefs();
      const ok=!refs.some(r=>r.required&&!r.ready);
      if(!ok&&typeof window.appToast==="function")
        window.appToast("Generate the parent location plate first \u2014 this time-of-day variant needs it as a reference.");
      return ok;
    },
    attachmentsRequired:true,
    attachments: collectRefs,
    attachmentsText: (refs)=> refs&&refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". Read screenplay snapshots as context only; never copy their text, typography, borders or layout."
      : "",
    metaExtra:({mode})=> mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream }
      : locationAssetDependencySnapshot(l.id,[],stateUnit?"slugline-unit":"continuity-state"),
    buildEdit: (instr)=> "Edit this establishing frame of "+(l.name||"the place")+" ("+v.time+"). Apply ONLY: "+instr+". Keep the same space and architecture."+locationSpatialPrompt(l),
  });
  const viewerEntity = {
    ...l,
    id,
    name:(stateUnit&&stateUnit.name||l.name||"Location")+" · "+(v.time||"Variant")
  };
  return React.createElement("div",{className:"loc-variant"},
    React.createElement("div",{className:"loc-variant-head"},
      stateUnit
        ? React.createElement("div",{className:"loc-coverage-title"},
            React.createElement("span",{className:"loc-intext-badge "+(/EXT/.test(stateUnit.intExt||"")?"ext":"int")},stateUnit.intExt||"INT"),
            React.createElement("b",null,stateUnit.name||l.name||"Location"),
            stateUnit.time&&React.createElement("span",{className:"loc-time-badge"},stateUnit.time))
        : React.createElement(EditText,{value:v.time,placeholder:"State name / time, e.g. Dawn \u00b7 storm\u2026",onCommit:onTime}),
      onRemove&&React.createElement("button",{className:"loc-variant-x",title:"Remove environment state",onClick:onRemove},React.createElement(Icon.x,{s:12}))),
    React.createElement(SheetField,{label:"What changes",value:v.state||"",multiline:true,
      placeholder:"Weather, practicals on/off, damage, wear or another persistent environment change\u2026",onCommit:onState}),
    stateUnit&&React.createElement("div",{className:"loc-shared-state-note"},
      "Applies to "+((stateUnit.sceneNos||[]).length>1?"Scenes ":"Scene ")+(stateUnit.sceneNos||[]).join(", ")+
      " \u00b7 uses the exact Slugline Unit plate and version history"),
    React.createElement(SheetFrame,{ gen, slotId, name:(stateUnit&&stateUnit.name||l.name||"")+" \u00b7 "+v.time,
      avatarColor:locSwatch(stateUnit&&stateUnit.intExt||l.intExt), initials:(v.time||"?").slice(0,2).toUpperCase(), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a photo", noun:"time-of-day variant plate", compact:true,
      dropToImport:true,
      referenceControls:React.createElement(CoverageReferenceStrip,{refs:refPreview,excludedIds:refOff,onToggle:toggleRef,onView}),
      generateDisabled:!canGenerate,
      generateDisabledLabel:"Generate parent plate first",
      generateDisabledTitle:"This time-of-day variant needs the parent location plate as a visual reference before it can generate." }));
}

/* SLUGLINE UNIT card — the atomic addressed unit of this location
   (place × INT/EXT × time-of-day), with provenance and a spatial reference
   plate. Reuses the coverage-sheet machinery: the unit shapes like a sheet
   (sceneNos / scriptExcerpt / role) so the screenplay-snapshot references and
   SheetFrame work unchanged. Generation is per-unit click ONLY (never batched,
   never auto) and requires the parent master plate as its visual anchor. Orphan
   units (slugline edited away) stay visible so their plate and notes aren't
   silently lost; the user removes them explicitly. */
function SluglineUnitCard({ l, u, project, scenes, drafts, parentGenUrl, onEnvironmentChange, onRemoveUnit, onView }){
  // collision-safe id: readable slug + djb2 hash of the FULL key (locations.jsx)
  const imgId = (typeof sluglineUnitImageId==="function")
    ? sluglineUnitImageId(u.key)
    : "locunit-"+String(u.key||"").replace(/[^a-z0-9-]+/gi,"-");
  const slotId = imgId.replace(/^locunit-/,"luslot-");
  const role = String(u.intExt||"INT").toUpperCase();
  const sceneNos = Array.isArray(u.sceneNos) ? u.sceneNos.filter(n=>n!=null) : [];
  const sourceLabel = sceneNos.length
    ? ((sceneNos.length>1 ? "Scenes " : "Scene ")+sceneNos.map(n=>String(n)).join(", "))
    : "Scene";
  const sourceMeta=(typeof screenplaySpaceSourceMeta==="function")
    ? screenplaySpaceSourceMeta(u) : {kind:"authored",label:"Authored slugline"};
  const pseudo = { id:imgId, name:u.name, role, sceneNos,
    scriptExcerpt:String(u.scriptText||"").slice(0,720),
    summary:"Slugline Unit: "+(u.sluglines||[]).join(" \u00b7 ") };
  const [refPreview, setRefPreview] = React.useState([]);
  const [refOff, setRefOff] = React.useState([]);
  const refsKey = [l.id, imgId, u.scriptText, parentGenUrl,
    l.parentLocation&&l.parentLocation.id, (scenes&&scenes.length)].join("|");
  const buildUnitRefs = async ()=>{
    const out = [];
    const C = window.turnContinuity || {};
    const scriptImgs = (typeof locationScreenplayReferenceImages==="function")
      ? locationScreenplayReferenceImages(l, pseudo, scenes||C.scenes||[], drafts||C.drafts||{})
      : [];
    scriptImgs.forEach((scriptImg, i)=> out.push({ url:scriptImg, kind:"script", refId:"script-"+imgId+"-"+i, required:false, ready:true,
      label:"Screenplay p"+(i+1), note:"screenplay page "+(i+1)+" for "+(u.name||"this Slugline Unit")+" \u2014 use it to infer what the script implies, but do not render any text from it" }));
    const grab = async (rid)=>{ let u2=(typeof nbGetImage==="function")?nbGetImage(rid):"";
      if(!u2 && typeof nbLoadImage==="function"){ try{ u2=await nbLoadImage(rid); }catch(e){} } return u2||""; };
    const parent = parentGenUrl || await grab(l.id);
    out.push({ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
      label:(l.name||"Parent location"), note:(l.name||"parent location")+" child/master plate \u2014 preserve this exact subspace geometry, materials and scale" });
    if(l.parentLocation){
      const rootUrl=await grab(l.parentLocation.id);
      out.push(locationParentReference(l,rootUrl));
    }
    return out;
  };
  React.useEffect(()=>{
    // seq: same out-of-order guard as the coverage card above
    let alive = true, seq = 0;
    const refresh = ()=>{ const my = ++seq;
      buildUnitRefs().then(refs=>{ if(alive && my===seq) setRefPreview(refs); }); };
    refresh();
    const onDone = (e)=>{ const rid = e && e.detail && e.detail.id;
      if(rid===l.id || rid===imgId || (l.parentLocation&&rid===l.parentLocation.id)) refresh(); };
    window.addEventListener("nb-gen-done", onDone);
    return ()=>{ alive=false; window.removeEventListener("nb-gen-done", onDone); };
  },[refsKey]);
  const missingRequired = refPreview.filter(r=>r.required && !r.ready);
  const canGenerate = !u.orphan && refPreview.length>0 && missingRequired.length===0;
  // required parent plate can't be opted out (see coverage card above)
  const toggleRef = (rid)=> setRefOff(off=>{
    const r = refPreview.find(x=>x.refId===rid);
    if(r && r.required) return off;
    return off.indexOf(rid)>=0 ? off.filter(x=>x!==rid) : [...off, rid];
  });
  const collectRefs = async ()=>{
    requireLocationSpatialPlan(l);
    const refs=mergeLocationReferences(await buildUnitRefs(),await locationSpatialReferences(l));
    if(refs.some(r=>r.required&&!r.ready))throw new Error("Restore the required location plates before generating this unit.");
    return refs.filter(r=>r.ready && r.url && (r.required || refOff.indexOf(r.refId)<0))
      .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note }));
  };
  const gen = useImageGen({
    id: imgId, slotId, entity: locationRenderEntity(l),
    buildFinal: ()=> (typeof buildSluglineUnitPrompt==="function")
      ? buildSluglineUnitPrompt(l, u, project)
      : buildLocationCoveragePrompt(l, pseudo, project),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    beforeGenerate: async ()=>{
      const refs = await buildUnitRefs();
      const missing = refs.filter(r=>r.required && !r.ready);
      const ok = missing.length===0;
      if(!ok && typeof window.appToast==="function")
        window.appToast("Generate the parent location plate first \u2014 this Slugline Unit needs it as a reference.");
      return ok;
    },
    attachmentsRequired:true,
    attachments: collectRefs,
    attachmentsText: (refs)=> refs && refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". The screenplay page snapshots are context only: read the scene geography from them, but never copy their typography, page border, text, captions or layout into the location sheet."
      : "",
    metaExtra:({mode})=> mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream }
      : locationAssetDependencySnapshot(l.id,[],"slugline-unit"),
    buildEdit: (instr)=> "Edit this "+role+" Slugline Unit plate for "+(u.name||l.name||"the location")+(u.time?(" at "+u.time):"")+". Apply ONLY: "+instr+". Keep it consistent with the parent location's architecture, materials and light."+locationSpatialPrompt(l),
  });
  const viewerEntity = {
    ...l,
    id:imgId,
    name:(u.name||l.name||"Location")+" · "+role+(u.time?(" · "+u.time):"")
  };
  return React.createElement("div",{className:"loc-variant loc-coverage-sheet loc-unit-card"+(u.orphan?" orphan":"")},
    React.createElement("div",{className:"loc-variant-head"},
      React.createElement("div",{className:"loc-coverage-title"},
        React.createElement("span",{className:"loc-intext-badge "+(/EXT/.test(role)?"ext":"int")},role),
        React.createElement("b",null,u.name||"Slugline unit"),
        u.time && React.createElement("span",{className:"loc-time-badge"},u.time)),
      React.createElement("span",{className:"loc-coverage-source",title:(u.sluglines||[]).join("\n")},sourceLabel)),
    React.createElement("div",{className:"loc-space-provenance "+sourceMeta.kind,title:(u.sluglines||[]).join("\n")},
      sourceMeta.label,
      (u.occurrences||[]).length>1&&React.createElement("span",null," · ",(u.occurrences||[]).length," occurrences")),
    u.orphan && React.createElement("div",{className:"loc-unit-orphan"},
      React.createElement(Icon.alert,{s:12}),
      React.createElement("span",null,"No longer in the script \u2014 kept so its plate and notes aren't lost."),
      onRemoveUnit && React.createElement("button",{className:"loc-unit-remove",
        title:"Delete this Slugline Unit's stored data and generated plate",
        onClick:async ()=>{ if(typeof nbClearAsset==="function"){ try{ await nbClearAsset(imgId); }catch(e){} } onRemoveUnit(u.key); }},"Remove")),
    React.createElement("details",{className:"loc-nested-section loc-unit-environment"},
      React.createElement("summary",null,"Lighting & environment"),
      React.createElement(SheetField,{label:"Environment notes",value:u.appearance||"",multiline:true,
        placeholder:"Light, weather, active practicals, damage or wear for this unit. Keep the same architecture; temporary props and blocking belong in Spatial Layout & Staging.",
        onCommit:onEnvironmentChange})),
    React.createElement(SheetFrame,{ gen, slotId, name:(u.name||l.name||"Location")+" \u00b7 "+role+(u.time?(" \u00b7 "+u.time):""),
      avatarColor:locSwatch(role), initials:role.slice(0,2), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a finished Slugline Unit plate", noun:"Slugline Unit plate", compact:true,
      dropToImport:true,
      referenceControls: React.createElement(CoverageReferenceStrip,{ refs:refPreview, excludedIds:refOff, onToggle:toggleRef, onView }),
      generateDisabled:!canGenerate,
      generateDisabledLabel: u.orphan ? "No longer in script" : "Generate parent plate first",
      generateDisabledTitle: u.orphan
        ? "This Slugline Unit is no longer in the screenplay, so it can't generate new plates. Its existing plate and notes are kept until you Remove it."
        : "This Slugline Unit needs the parent location plate as a visual reference before it can generate." }));
}

function SceneSetupCard({setup,unit,onUpdate}){
  const sceneLabel=setup.sceneNo!=null?("Scene "+String(setup.sceneNo).padStart(2,"0")):"Scene";
  const source=setup.orphan ? {label:"Saved setup \u00b7 source removed"} : (typeof screenplaySpaceSourceMeta==="function")
    ? screenplaySpaceSourceMeta({sourceKinds:[setup.sourceKind]}) : {label:"Screenplay occurrence"};
  return React.createElement("div",{className:"loc-variant loc-scene-setup"},
    React.createElement("div",{className:"loc-variant-head"},
      React.createElement("div",{className:"loc-coverage-title"},
        React.createElement("span",{className:"loc-scene-badge"},sceneLabel),
        React.createElement("b",null,setup.spaceName||"Location"),
        setup.time&&React.createElement("span",{className:"loc-time-badge"},setup.time),
        Number(setup.occurrenceCount)>1&&React.createElement("span",{className:"loc-time-badge",
          title:"This screenplay returns to the same space more than once in this scene."},
          "Occurrence ",setup.occurrenceOrdinal," of ",setup.occurrenceCount)),
      React.createElement("span",{className:"loc-coverage-source",title:setup.sourceSlug||""},source.label)),
    setup.orphan&&React.createElement("div",{className:"loc-unit-orphan"},
      "This saved setup no longer matches a screenplay occurrence. Its production notes are preserved here for deliberate review instead of being discarded during a script edit."),
    setup.screenplayExcerpt&&React.createElement("details",{className:"loc-setup-source"},
      React.createElement("summary",null,"Screenplay occurrence"),
      React.createElement("pre",null,setup.screenplayExcerpt)),
    React.createElement(UnitDressing,{u:unit,items:setup.temporaryDressing,
      suggestions:unit&&unit.dressingDerived,onChange:temporaryDressing=>onUpdate({temporaryDressing})}),
    React.createElement(SheetField,{label:"Blocking & action path",value:setup.blocking||"",multiline:true,
      placeholder:"Marcus crosses from the recliner to the kitchen table; keep the archway clear\u2026",
      onCommit:blocking=>onUpdate({blocking})}),
    React.createElement(SheetField,{label:"Handled props",value:setup.handledProps||"",multiline:true,
      placeholder:"Eulogy pages in left hand; phone set face-down; red pen uncapped\u2026",
      onCommit:handledProps=>onUpdate({handledProps})}),
    React.createElement(SheetField,{label:"Object states at the start",value:setup.objectStates||"",multiline:true,
      placeholder:"Pill bottles in rows; recliner empty; lamp on; kitchen practical off\u2026",
      onCommit:objectStates=>onUpdate({objectStates})}),
    React.createElement(SheetField,{label:"Setup notes",value:setup.notes||"",multiline:true,
      placeholder:"Only facts specific to this occurrence, not permanent set identity\u2026",
      onCommit:notes=>onUpdate({notes})}));
}

/* temporary, occurrence-scoped dressing used by Scene Setups. */
function UnitDressing({ u, onUpdateUnit, items, suggestions, onChange, label="Temporary dressing" }){
  const [draft, setDraft] = React.useState("");
  const list = Array.isArray(items) ? items : (Array.isArray(u&&u.dressing) ? u.dressing : []);
  const editable = !!(onChange||onUpdateUnit);
  if(!editable && !list.length) return null;
  const lower = {}; list.forEach(x=>{ lower[String(x).toLowerCase()] = true; });
  const sugg = editable
    ? (Array.isArray(suggestions)?suggestions:(Array.isArray(u&&u.dressingDerived)?u.dressingDerived:[])).filter(x=>!lower[String(x).toLowerCase()])
    : [];
  const commit = (next)=> onChange ? onChange(next) : (onUpdateUnit&&u&&onUpdateUnit(u.key,{dressing:next}));
  const add = (val)=>{ const v = String(val||"").replace(/\s+/g," ").trim();
    setDraft("");
    if(!v || lower[v.toLowerCase()]) return;
    commit(list.concat([v])); };
  return React.createElement("div",{className:"loc-dress"},
    React.createElement("div",{className:"loc-dress-lab"},label),
    React.createElement("div",{className:"loc-dress-row"},
      list.map((x,i)=>React.createElement("span",{className:"loc-dress-chip",key:"d"+i},x,
        editable && React.createElement("button",{title:"Remove",onClick:()=>commit(list.slice(0,i).concat(list.slice(i+1)))},"\u00d7"))),
      editable && React.createElement("span",{className:"loc-dress-add"},
        React.createElement("input",{value:draft,placeholder:"add item\u2026",
          onChange:(e)=>setDraft(e.target.value),
          onBlur:()=>add(draft),
          onKeyDown:(e)=>{ if(e.key==="Enter"){ e.preventDefault(); add(draft); } }}),
        React.createElement("button",{className:"loc-dress-sugg",title:"Add temporary state dressing",onClick:()=>add(draft)},"+"))),
    sugg.length>0 && React.createElement("div",{className:"loc-dress-row sugg"},
      React.createElement("span",{className:"loc-dress-sugg-lab"},"from the script:"),
      sugg.map((x,i)=>React.createElement("button",{className:"loc-dress-sugg",key:"s"+i,
        title:"Mentioned in this screenplay occurrence \u2014 click to add",onClick:()=>add(x)},"+ "+x))));
}

function LocationSheets({ project, locations, scenes, drafts, onUpdate, onDraft, onDraftAll, onDelete, draftingId, draftingIds, draftingAll, scriptHasLocs, onDraftStaging, draftingStageId, trashItems, onRestore, onPurge, lookbookStale, onApplyLookbook, onApplyLookbookDraftOnly, sluglineUnits, onUpdateUnit, onRemoveUnit, readOnly=false }){
  const [view, setView] = React.useState(null);
  if(window.useRenderStyleVersion) window.useRenderStyleVersion();   // re-render dropdowns when a style is locked/unlocked
  const [sceneFilter, setSceneFilter] = React.useState("");
  const [query, setQuery] = React.useState("");               // free-text name search
  const [searchOpen, setSearchOpen] = React.useState(false);  // collapsible search: icon-only until clicked
  const searchRef = React.useRef(null);
  const batch = useBatchGen();
  const batchActiveId = batch.activeId;
  const rawLocations = locations || [];
  const locationFold = (typeof deriveSubspaceFold==="function") ? deriveSubspaceFold(scenes||[],drafts||{}) : {};
  const masterKeyOf = (loc)=> String((loc&&loc.key)||((typeof locSlug==="function")
    ? locSlug(loc&&loc.name).split("-").slice(0,4).join("-") : "")||"");
  const rootLocationIdOf = (loc)=>{
    let current=loc;
    for(let depth=0;current&&depth<16;depth++){
      const parentKey=String(current.parentKey||locationFold[masterKeyOf(current)]||"");
      const parent=parentKey&&rawLocations.find(x=>x&&masterKeyOf(x)===parentKey);
      if(!parent) return current.id;
      current=parent;
    }
    return loc&&loc.id;
  };
  /* Resolve ownership before grouping the UI; each room retains its own assets. */
  const list = rawLocations.filter(Boolean).map(l=>{
    const key=masterKeyOf(l);
    const parentKey=String(l.parentKey||locationFold[key]||"");
    const parent=parentKey?rawLocations.find(x=>x&&masterKeyOf(x)===parentKey):null;
    const children=rawLocations.filter(c=>c&&c!==l&&String(c.parentKey||locationFold[masterKeyOf(c)]||"")===key);
    const scope=parentKey?"atomic":(children.length?"compound":(l.scope||"atomic"));
    return {...l,key,parentKey,scope,
      continuityRootKey:parentKey||key,rootLocationId:rootLocationIdOf(l),
      parentLocation:parent?{id:parent.id,key:masterKeyOf(parent),name:parent.name,
        parentKey:parent.parentKey,renderStyle:parent.renderStyle,renderStyleKey:parent.renderStyleKey,
        renderStyleIndependent:parent.renderStyleIndependent,surpriseRender:parent.surpriseRender,
        spatialPlan:parent.spatialPlan,spatialNotes:parent.spatialNotes,
        architecture:parent.architecture||"",materials:parent.materials||"",lighting:parent.lighting||"",
        permanentDressing:parent.permanentDressing||"",topology:parent.topology||"",
        continuityAnchors:parent.continuityAnchors||""}:null,
      childLocations:children.map(c=>({id:c.id,key:masterKeyOf(c),name:c.name,intExt:c.intExt}))};
  });
  // STYLE · ALL LOCATIONS — apply one render style to every location at once (mirrors the
  // cast's 'Style · all cast'); each location can still be overridden on its own card.
  const [allStyling, setAllStyling] = React.useState(null);   // null | {i,total} (surprise progress)
  const LOC_TEXT = window.LOC_RENDER_TEXT || {};
  const defaultStyleKey = window.turnDefaultRenderStyleKey ? window.turnDefaultRenderStyleKey() : "photoreal";
  const effectiveKey=l=>locationRenderStyleSource(l,list).renderStyleKey||defaultStyleKey;
  const allStyleKey = (list.length && list.every(l=>effectiveKey(l)===effectiveKey(list[0])))
    ? effectiveKey(list[0]) : "";
  const locBibleOf = (l)=> [l.name&&("Name: "+l.name), l.architecture&&("Architecture: "+l.architecture),
    l.materials&&("Materials: "+l.materials), l.lighting&&("Lighting: "+l.lighting), l.significance&&("Significance: "+l.significance),
    (project&&project.genre)&&("Genre: "+project.genre)].filter(Boolean).join("\n");
  const applyStyleAll = async (key)=>{
    if(!key || allStyling) return;
    if(key!=="surprise"){ const t=(typeof window.renderStyleText==="function" ? window.renderStyleText("loc", key) : (LOC_TEXT[key]||LOC_TEXT.photoreal)); list.forEach(l=> onUpdate(l.id, { renderStyleIndependent:false,renderStyleKey:key, renderStyle:t })); return; }
    list.forEach(l=> onUpdate(l.id, { renderStyleIndependent:false,renderStyleKey:"surprise" }));
    if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())) return;
    const need = list.filter(l=>!l.parentLocation&&!(l.surpriseRender && l.surpriseRender.style));
    if(!need.length) return;
    let ok = true;
    if(typeof window.appConfirm==="function") ok = await window.appConfirm({
      title:"Invent a surprise style for "+need.length+" location"+(need.length!==1?"s":"")+"?",
      body:"Each parent or standalone location gets a bespoke style; its subspaces share it — that's "+need.length+" AI call"+(need.length!==1?"s":"")+".",
      confirmLabel:"Invent styles" });
    if(!ok) return;
    setAllStyling({ i:0, total:need.length });
    for(let i=0;i<need.length;i++){ setAllStyling({ i:i+1, total:need.length });
      try{ const r = await aiSurpriseStyleText({ name:need[i].name, kind:"location", bible:locBibleOf(need[i]) }, project);
        if(r) onUpdate(need[i].id, { surpriseRender:r, renderStyle:r.style }); }catch(e){} }
    setAllStyling(null);
  };
  const sceneList = scenesInStoryOrder(scenes);
  const inScene = (l, sid)=> Array.isArray(l.scenes) && l.scenes.indexOf(sid)>=0;
  const q = query.trim().toLowerCase();
  const matchesQuery = (l)=> (typeof searchWordMatch==="function") ? searchWordMatch((l.name||"")+" "+(l.intExt||""), q) : (!q || (l.name||"").toLowerCase().indexOf(q)>=0);
  const shown = (sceneFilter ? list.filter(l=>inScene(l, sceneFilter)) : list).filter(matchesQuery);
  const groups=locationWorkspaceGroups(list);
  const shownIds=shown.map(l=>l.id);
  const shownGroups=groups.filter(g=>g.members.some(l=>shownIds.includes(l.id))||g.members.some(l=>l.id===batchActiveId));
  // 9-up pagination; suspended while a batch runs so the queue can reach every card
  const pager = usePager(shownGroups.length, !!batchActiveId);
  const sceneNoOf = (sid)=>{ const s=(scenes||[]).find(x=>x.id===sid); return s?s.no:sid; };

  // ---- batch generation ---- (eligible = drafted locations only; the spec is what
  // the plate is built from, so an undrafted/hand-added card never makes a generic plate)
  const draftedIds = (subset)=> locationGenerationOrder(subset).filter(l=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l) : true).map(l=>l.id);
  const startSceneBatch = ()=>{
    if(!sceneFilter || batchActiveId) return;
    const eligible = draftedIds(shown);
    if(!eligible.length){ batch.setMsg("Draft these location specifications first \u2014 nothing in this scene is ready to generate."); return; }
    batch.begin(eligible, shown.length - eligible.length);
  };
  const startAllBatch = ()=>{
    if(batchActiveId) return;
    const eligible = draftedIds(list);
    if(!eligible.length){ batch.setMsg("Draft the location specifications first \u2014 nothing is ready to generate yet."); return; }
    // clear the SEARCH too, not just the scene/kind filters: the queue advances only
    // when the target CARD is mounted, so a batch whose first target was filtered out
    // by a search box never generated anything and hung until Cancel
    if(sceneFilter) setSceneFilter("");
    if(query) setQuery("");
    batch.begin(eligible, list.length - eligible.length);
  };
  const eligibleAll = list.filter(l=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l) : true).length;

  return React.createElement("div",{className:"art-scroll"},
    view && React.createElement(ImageLightbox,{url:view.url,character:view.character,
      siblings:view.siblings,startIndex:view.startIndex,onClose:()=>setView(null)}),
    React.createElement(NbKeyBar,null),
    React.createElement(NbControls,null),
    window.LookbookStaleNotice && React.createElement(window.LookbookStaleNotice,{stale:lookbookStale,onApply:onApplyLookbook,onDraftOnly:onApplyLookbookDraftOnly,label:"these locations",dept:"locations"}),
    React.createElement("div",{className:"art-intro"},
      React.createElement("div",{className:"art-intro-row"},
        React.createElement("div",{style:{flex:1}},
          React.createElement("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Location Scout",
            React.createElement(window.InfoTip,{label:"About Locations",
              text:"Locations prepares reusable sets for the art department. The Space and Narrative Significance define the place. Screenplay Evidence shows the source passages; Slugline Units identify the rooms, times and scenes. Each unit has one plate and Lighting & environment notes, so scripted Night / Dawn states are not repeated in a separate section. Additional environment states and additional space plates are nested there. Spatial Layout & Staging holds reusable camera views, depth grids and scene dressing/blocking notes. The header's Render style picker sets the visual treatment; saved style instructions can be fine-tuned under Generation Prompt → Render style details. Blender Studio builds the selected set, and Generation Prompt shows the current specification sent to the image model.\n\nEach established parent place has one card with a room selector. Choose Whole location for the shared canon and all room-unit links, or a room to edit its own plate and layout. Search and scene focus include rooms. A Kitchen with no evidenced parent remains a standalone place. Shot timing, cuts and performance are directed in Shots / Blender previz."}))),
        React.createElement("div",{className:"art-intro-actions"},
          window.RecentlyDeleted && React.createElement(window.RecentlyDeleted,{
            items:trashItems,kind:"location",onRestore,onPurge,compact:true}),
          // NO arbitrary hand-adding: continuity places anchor master cards, room
          // headings become Slugline Units; implied side spaces become Required Space Plates
          // sheets from screenplay body text + page snapshots.
          React.createElement("label",{className:"char-style-all",
            title:"Read only. Each location's plate scale is derived automatically from the characters who drive its scenes."},
            React.createElement("span",{className:"char-style-all-lab"},"World scale"),
            React.createElement("select",{className:"char-style-select",value:"",disabled:true,"aria-label":"World scale (read only)"},
              React.createElement("option",{value:""},"\u2728 Auto (by occupant)"))),
          React.createElement("button",{className:"art-draftall ghost",disabled:draftingAll||(!list.length&&!scriptHasLocs),onClick:onDraftAll,
            title:"Build every location from the screenplay in one pass \u2014 pull missing canonical places, derive Slugline Units and required spatial plates, draft each spec, and prepare the primary Coverage View"},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":"Design all locations"),
          React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId||!eligibleAll,onClick:startAllBatch,
            title:"Generate (or regenerate) the canonical location plate for every drafted location \u2014 you choose whether to redo ones that already have a plate"},
            React.createElement(Icon.sparkles,{s:14}), batchActiveId?"Generating\u2026":"Generate all locations", typeof window.nbCostChip==="function" && window.nbCostChip(1)))),),
    BatchBar && React.createElement(BatchBar,{batch,noun:"location"}),
    list.length>0 && React.createElement("div",{className:"prop-toolbar"},
      React.createElement("div",{className:"prop-searchbar collapsible"+((searchOpen||q)?" open":""),
        title:(searchOpen||q)?"":"Search locations",
        onClick:()=>{ if(!searchOpen && !q){ setSearchOpen(true); setTimeout(()=>{ if(searchRef.current) searchRef.current.focus(); },0); } }},
        React.createElement(Icon.search,{s:14}),
        React.createElement("input",{className:"prop-search-input",type:"text",value:query,ref:searchRef,
          placeholder:"Search locations by name…",tabIndex:(searchOpen||q)?0:-1,
          onChange:e=>setQuery(e.target.value),
          onBlur:()=>{ if(!query) setSearchOpen(false); },
          onKeyDown:e=>{ if(e.key==="Escape"){ setQuery(""); setSearchOpen(false); if(searchRef.current) searchRef.current.blur(); } }}),
        q && React.createElement("span",{className:"prop-search-count"}, shownGroups.length+" of "+groups.length),
        q && React.createElement("button",{className:"prop-search-clear",title:"Clear search",onClick:(e)=>{ e.stopPropagation(); setQuery(""); setSearchOpen(false); }},React.createElement(Icon.x,{s:14}))),
      // Render style stays editable; world scale is always resolved from the scene's occupants.
      React.createElement("div",{className:"char-style-all",
        title:"Apply one render style to ALL locations at once. Each location can still be overridden on its own card."},
        React.createElement("span",{className:"char-style-all-lab"},
          allStyling ? ("Inventing… "+allStyling.i+"/"+allStyling.total) : "Style · all locations"),
        React.createElement(window.RenderStylePicker,{context:"location",value:allStyleKey,disabled:!!allStyling,
          placeholderLabel:"Mixed — per location",onPick:applyStyleAll})),
      sceneList.length>0 && React.createElement("div",{className:"prop-scenebar"},
        React.createElement("span",{className:"prop-scenebar-lab"},React.createElement(Icon.layers,{s:14}),"Focus a scene"),
        React.createElement("select",{className:"prop-select prop-scenebar-select",value:sceneFilter,
          onChange:e=>setSceneFilter(e.target.value)},
          React.createElement("option",{value:""},"All scenes \u2014 show every location"),
          sceneList.map(s=>{
            const n = groups.filter(g=>g.members.some(l=>inScene(l,s.id))).length;
            return React.createElement("option",{key:s.id,value:s.id},
              "Scene "+String(s.no).padStart(2,"0")+" \u00b7 "+(s.title||"")+"  ("+n+" location"+(n!==1?"s":"")+")");
          })),
        sceneFilter && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId,onClick:startSceneBatch,
          title:"Generate canonical location plates for the locations in this scene"},
          React.createElement(Icon.sparkles,{s:14}),
          batchActiveId?"Generating\u2026":("Generate all in Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")), typeof window.nbCostChip==="function" && window.nbCostChip(1)))),
    list.length
      ? (shownGroups.length
          ? React.createElement(React.Fragment,null,
              React.createElement("div",{className:"sheet-grid"},
                pager.slice(shownGroups).map(group=>React.createElement(LocationWorkspace,{key:group.root.id,group,
                  matchingIds:group.members.filter(l=>shownIds.includes(l.id)).map(l=>l.id),
                  filterKey:sceneFilter+"|"+q,batchActiveId,
                  renderLocation:(l,workspaceProps)=>React.createElement(LocationSheet,{key:l.id,...workspaceProps,l,project,scenes,drafts,onUpdate,onDelete,onDraft,
                  drafting:draftingId===l.id||(draftingIds||[]).indexOf(l.id)>=0||draftingAll,
                  // SWIPE SET — fullscreen swipes walk this location's master plate +
                  // required space plates in display order. Tapping anything else
                  // (Slugline Unit plates, variants, reference snapshots) opens the plain viewer.
                  onView:(url,pr,extra)=>{
                    // callers may hand over a ready-made swipe set (reference strips do) —
                    // use it as-is
                    if(extra && Array.isArray(extra.siblings) && extra.siblings.length>1){
                      setView({ url, character:pr, siblings:extra.siblings, startIndex:extra.startIndex||0 });
                      return;
                    }
                    const entries = [{ id:l.id, chr:l },
                      ...(l.coverageSheets||[]).slice()
                        .sort((a,b)=>(Number(a.order||0)-Number(b.order||0)) || String(a.name||"").localeCompare(String(b.name||"")))
                        .map(v=>({ id:l.id+"-"+v.id,
                          chr:{ ...l, id:l.id+"-"+v.id, name:(v.name||l.name||"Location")+" \u00b7 "+(v.role||"INT") } }))];
                    // the tapped image keeps ITS url (it may be an older version); the rest
                    // come from the image cache — sheets without a plate yet are skipped
                    const sibsAll = entries.map(x=>({
                      url: (pr && pr.id===x.id) ? url : ((typeof nbGetImage==="function") ? nbGetImage(x.id) : ""),
                      character: x.chr }));
                    const sibs = sibsAll.filter(s=>s.url);
                    const at = sibs.findIndex(s=>s.character.id===(pr&&pr.id));
                    setView((at>=0 && sibs.length>1)
                      ? { url, character:pr, siblings:sibs, startIndex:at }
                      : { url, character:pr });
                  },
                  batchActiveId,onBatchDone:batch.advance,onChipClick:(sid)=>setSceneFilter(sid),
                  onDraftStaging,draftingStage:draftingStageId===l.id,sluglineUnits,onUpdateUnit,onRemoveUnit,readOnly})}))),
              React.createElement(PagerBar,{pager,noun:"location"}))
          : React.createElement("div",{className:"prop-empty"},
              React.createElement("div",{className:"art-soon-t"}, sceneFilter ? "No locations in this scene" : "No matching locations"),
              React.createElement("button",{className:"art-draftall",style:{marginTop:16},
                onClick:()=>{ setSceneFilter(""); setQuery(""); }},"Show all locations")))
      : React.createElement("div",{className:"prop-empty"},
          React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon.layers,{s:30})),
          React.createElement("div",{className:"art-soon-t"},"No locations yet"),
          React.createElement("div",{className:"art-soon-d"}, scriptHasLocs
            ? "Your screenplay names continuity-bearing places and screenplay-addressable spaces. \u201cDesign all locations\u201d builds the location hierarchy, then derives Slugline Units and any Required Space Plates."
            : "Write the scene's staged place in the Writers' Room first. Room-level sluglines can group under an evidenced parent place; extra implied spaces can live in the scene action."),
          scriptHasLocs
            ? React.createElement("div",{style:{display:"flex",gap:8,marginTop:16}},
                React.createElement("button",{className:"art-draftall",disabled:draftingAll,onClick:onDraftAll},
                  React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":"Design all locations"))
            : React.createElement("div",{className:"art-soon-d",style:{marginTop:12}},"No screenplay-staged location anchor yet.")));
}
window.LocationSheets = LocationSheets;
window.locationWorkspaceGroups=locationWorkspaceGroups;

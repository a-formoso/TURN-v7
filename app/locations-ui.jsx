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
  // a shot's missing view can name a room of this location: show that room (window.turnOpenLocationCard, 2026-10-20)
  React.useEffect(()=>{ const h=(e)=>{ const id=e&&e.detail&&e.detail.id;
      if(id && group.members.some(l=>l.id===id)) setSelection({id,section:e.detail.section||""}); };
    if(typeof window.addEventListener!=="function") return undefined;
    window.addEventListener("turn-location-select",h); return ()=>window.removeEventListener("turn-location-select",h); },[group]);
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
      "Screenplay passages establish the space and its uses. Rooms & times identify where and when each passage occurs."),
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

/* THE PROMPT BUDGET (2026-10-14, owner — "go ahead with all of it"): a plate card's prompt is rebuilt once its
   references are known — the screenplay goes as the attached pages OR as text (the image numbers of its pages), and
   the prompt fits its engine less the reference list that follows it (an upper bound of that list's length) */
function _locScriptPages(attach){ return (attach||[]).map((r,i)=>r&&r.kind==="script"?i+1:0).filter(Boolean); }
function _locRefListReserve(attach){ return 360+(attach||[]).reduce((n,r)=>n+String((r&&r.note)||"").length+16,0); }
/* the budget options of a card's rebuild: its pages, the room for its reference list and the engine this run renders
   on (a batch / "Try <engine>" pick — gopts.model; else the picked engine) */
function _locBudgetOpts(attach, gopts){
  // (2026-10-14, final pass) the scenes the pages carry — a master plate sends the scenes left out as text
  const sceneIds=(typeof _locPageScenes==="function")?_locPageScenes(attach):null;
  return {screenplayPages:_locScriptPages(attach), reserve:_locRefListReserve(attach), ...((gopts&&gopts.model)?{model:gopts.model}:{}),
    ...(sceneIds?{screenplaySceneIds:sceneIds}:{})};
}

/* PLATE CAMERAS (2026-10-13, owner — Location coordinates): the camera of each panel of this space's 2x2 plate.
   A room's panels are cameras INSIDE the room; through each window or door they show the space beyond from that
   camera's position, using the panel of that space's plate whose recorded camera faces the same way (cut out and
   attached as its own reference), or a view made from here ("Make a … view" — one paid image). An owner space's
   cameras are suggestions until they are set: its plate prompt only states cameras that are set.
   (2026-10-14, owner — "go ahead with all of it") AN OUTDOOR PART (a stretch of quay) has cameras standing on it at eye
   level, each framed differently from its parent's own panels. THIS PLATE'S CAMERAS: a plate made before its cameras
   were recorded can be given them without regenerating — each panel's direction set by hand (free), or "Read the
   cameras from this plate" (one writing call, priced on the button) — saved on the card for that plate version
   (l.plateCameras), so the rooms inside can cut out its panels; the plate's own prompt and layout are unchanged. */
/* MOVING PARTS (owner 2026-11-01): the parts of this set the screenplay moves — a stern ramp lowered for the cars and
   raised to seal the hold. Each part has its states, the usual one (what the description, plate and set show) and the
   moments it changes. Shots show each part as it is at their moment; Build the set can build it in any moment's state.
   Read from the screenplay (one writing call) proposes them for review; every field can be set by hand. */
function LocationMovingParts({l,scenes,drafts,onUpdate,readOnly=false}){
  const E=React.createElement;
  const parts=typeof normalizeLocationMovingParts==="function"?normalizeLocationMovingParts(l.movingParts):[];
  const [pending,setPending]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
  const save=list=>onUpdate(l.id,{movingParts:normalizeLocationMovingParts(list)});
  const patchPart=(i,patch)=>save(parts.map((p,j)=>j===i?{...p,...patch,source:"user"}:p));
  const C=window.turnContinuity||{};
  const locScenes=(scenes||C.scenes||[]).filter(s=>s&&(l.scenes||[]).indexOf(s.id)>=0).sort((a,b)=>(Number(a.no)||0)-(Number(b.no)||0));
  const momentsOf=(sc)=>{
    const opts={drafts:drafts||C.drafts||{},characters:C.characters||[],beatsMap:C.beatsMap||{}};
    const rows=typeof window.shotScreenplayBeatRows==="function"?window.shotScreenplayBeatRows(sc,opts):[];
    return rows.flatMap(r=>(window.shotBeatMoments?window.shotBeatMoments(sc,r.n,opts):[]).map(m=>({beatN:r.n,moment:m.moment.n,text:m.openingAction||m.text})));
  };
  const allMoments=locScenes.flatMap(sc=>momentsOf(sc).map(m=>({...m,scene:sc})));
  const momentLabel=c=>{const sc=locScenes.find(x=>x.id===c.sceneId)||(scenes||[]).find(x=>x.id===c.sceneId);
    return "Scene "+(sc?sc.no:"?")+" · beat "+c.beatN+" · moment "+c.moment;};
  const anchors=typeof locationSpaceAnchors==="function"?(()=>{try{return locationSpaceAnchors(l);}catch(e){return [];}})():[];
  async function read(){
    if(busy||typeof window.aiReadLocationMovingParts!=="function")return;
    setBusy(true);setError("");
    try{
      const found=await window.aiReadLocationMovingParts(l,{scenes,drafts});
      setPending(found);
      if(!found.length)setError("The screenplay doesn't move any part of this set. Nothing was changed.");
    }catch(e){setError(String(e&&e.message||e));}
    finally{setBusy(false);}
  }
  const keep=()=>{const ids=new Set(pending.map(p=>p.id));save(parts.filter(p=>!ids.has(p.id)).concat(pending));setPending(null);};
  const addPart=()=>save(parts.concat([{id:"part-"+Date.now().toString(36),name:"New part",states:[{id:"closed",label:"Closed",pose:"as-built"},{id:"open",label:"Open",pose:"open"}],usual:"closed",changes:[],source:"user"}]));
  const field=(label,input)=>E("label",{className:"loc-cam-field"},E("span",null,label),input);
  const partView=(p,i)=>E("details",{key:p.id+i,className:"loc-nested-section loc-part",open:true},
    E("summary",null,p.name+" · usually "+((p.states.find(s=>s.id===p.usual)||{}).label||"").toLowerCase()+" · "+p.changes.length+" change"+(p.changes.length===1?"":"s")),
    E("div",{className:"loc-cam-fields"},
      field("Name",E("input",{className:"prop-select",type:"text",defaultValue:p.name,key:p.name,disabled:readOnly,onBlur:e=>e.target.value.trim()&&e.target.value!==p.name&&patchPart(i,{name:e.target.value})})),
      field("Floor-plan object",E("select",{className:"prop-select",value:p.anchorId||"",disabled:readOnly,onChange:e=>patchPart(i,{anchorId:e.target.value})},
        E("option",{value:""},"None"),anchors.map(a=>E("option",{key:a.id,value:a.id},a.name)))),
      field("Usual state",E("select",{className:"prop-select",value:p.usual,disabled:readOnly,onChange:e=>patchPart(i,{usual:e.target.value})},
        p.states.map(s=>E("option",{key:s.id,value:s.id},s.label))))),
    E("p",{className:"loc-layer-note"},"The usual state is the one the description, the location image and the built set show."),
    p.states.map((st,k)=>E("div",{key:st.id,className:"loc-cam-fields"},
      field("State",E("input",{className:"prop-select",type:"text",defaultValue:st.label,key:st.label,disabled:readOnly,
        onBlur:e=>e.target.value.trim()&&e.target.value!==st.label&&patchPart(i,{states:p.states.map((x,m)=>m===k?{...x,label:e.target.value}:x)})})),
      field("In the built set",E("select",{className:"prop-select",value:st.pose,disabled:readOnly||!p.anchorId,
        title:p.anchorId?"":"Link the part to a floor-plan object to build it in this state",
        onChange:e=>patchPart(i,{states:p.states.map((x,m)=>m===k?{...x,pose:e.target.value}:x)})},
        [["as-built","As in the floor plan"],["lowered","Lowered (hinged at its base, laid outward)"],["open","Swung open"],["hidden","Not there"]].map(([v,t])=>E("option",{key:v,value:v},t)))),
      E("label",{className:"loc-cam-field",style:{gridColumn:"1 / -1"}},E("span",null,"What it looks like"),
        E("input",{className:"prop-select",type:"text",defaultValue:st.look,key:st.look,disabled:readOnly,placeholder:"One sentence for the shot prompt",
          onBlur:e=>e.target.value!==st.look&&patchPart(i,{states:p.states.map((x,m)=>m===k?{...x,look:e.target.value}:x)})})))),
    E("p",{className:"loc-field-label"},"Changes"),
    p.changes.length?E("ul",{className:"loc-part-changes"},p.changes.map((c,k)=>E("li",{key:k},
      E("span",null,momentLabel(c)+": "+((p.states.find(s=>s.id===c.state)||{}).label||c.state).toLowerCase()+(c.during?" during the moment":" as it opens")),
      c.evidence&&E("small",null," “"+c.evidence+"”"),
      !readOnly&&E("button",{type:"button",className:"art-draftall ghost",onClick:()=>patchPart(i,{changes:p.changes.filter((_,m)=>m!==k)})},"Remove"))))
      :E("p",{className:"loc-layer-note"},"No changes: the part stays in its usual state in every shot."),
    !readOnly&&allMoments.length>0&&E(MovingPartChangeAdder,{p,allMoments,onAdd:c=>patchPart(i,{changes:p.changes.concat([c])})}),
    !readOnly&&E("button",{type:"button",className:"art-draftall ghost",onClick:()=>save(parts.filter((_,j)=>j!==i))},"Remove this part"));
  return E("div",{className:"loc-moving-parts","data-testid":"location-moving-parts"},
    E("p",{className:"loc-layer-note"},"Parts of this set the screenplay moves, such as a ramp lowered for the cars and raised to seal the hold. Each shot shows the part as it is at its moment."),
    parts.map(partView),
    pending&&pending.length>0&&E("div",{className:"loc-map-check",role:"status"},
      E("p",null,"Found in the screenplay: "+pending.map(p=>p.name+" ("+p.changes.map(c=>momentLabel(c)+" "+c.state).join(", ")+")").join("; ")+"."),
      E("button",{type:"button",className:"art-draftall",onClick:keep},"Keep"),
      E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setPending(null)},"Discard")),
    error&&E("p",{className:"loc-spatial-error",role:"alert"},error),
    !readOnly&&E("div",{className:"loc-step-actions"},
      E("button",{type:"button",className:"art-draftall",disabled:busy||!locScenes.length,onClick:read,
        title:"Reads this location's scenes for parts of the set that move. One writing call (writing credits); you review before anything is saved."},
        busy?"Reading\u2026":"Read from the screenplay (writing credits)"),
      E("button",{type:"button",className:"art-draftall ghost",onClick:addPart},"Add a moving part")));
}
function MovingPartChangeAdder({p,allMoments,onAdd}){
  const E=React.createElement;
  const [pick,setPick]=React.useState(0),[state,setState]=React.useState(p.states[1]?p.states[1].id:p.states[0].id),[during,setDuring]=React.useState(false);
  const m=allMoments[pick]||allMoments[0];
  return E("div",{className:"loc-cam-fields"},
    E("label",{className:"loc-cam-field"},E("span",null,"At"),E("select",{className:"prop-select",value:pick,onChange:e=>setPick(Number(e.target.value))},
      allMoments.map((x,k)=>E("option",{key:k,value:k},"Scene "+x.scene.no+" · beat "+x.beatN+" · moment "+x.moment+" \u2014 "+String(x.text||"").slice(0,50))))),
    E("label",{className:"loc-cam-field"},E("span",null,"Becomes"),E("select",{className:"prop-select",value:state,onChange:e=>setState(e.target.value)},
      p.states.map(s=>E("option",{key:s.id,value:s.id},s.label)))),
    E("label",{className:"loc-cam-field loc-cam-check"},E("span",null,"Moves during this moment"),
      E("input",{type:"checkbox",checked:during,onChange:e=>setDuring(e.target.checked)})),
    E("button",{type:"button",className:"art-draftall ghost",onClick:()=>m&&onAdd({sceneId:m.scene.id,beatN:m.beatN,moment:m.moment,state,during})},"Add change"));
}
function LocationPlateCameras({l,project,onUpdate,readOnly=false,plateMeta}){
  const [,refresh]=React.useReducer(n=>n+1,0);
  const [busy,setBusy]=React.useState("");
  React.useEffect(()=>{const h=()=>refresh();
    window.addEventListener("nb-gen-done",h);window.addEventListener("nb-prefetched",h);
    return ()=>{window.removeEventListener("nb-gen-done",h);window.removeEventListener("nb-prefetched",h);};},[]);
  const alive=React.useRef(true);
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  if(typeof locationPanelPoses!=="function")return null;
  const panels=locationPanelPoses(l);
  let problems={};try{problems=window.KinolotCloudRender&&window.KinolotCloudRender.cameraProblems?window.KinolotCloudRender.cameraProblems(l):{};}catch(_){problems={};}
  const parent=locationParentOf(l);
  const plan=parent&&typeof locationSubspacePanelPlan==="function"?locationSubspacePanelPlan(l):null;
  const anchors=locationSpaceAnchors(l);
  const openings=locationSpaceOpenings(l);
  const layout=locationSpatialPlanState(l);
  const storedAny=panels.some(p=>p.source==="set");
  const statedAny=panels.some(p=>p.stated);   // set by hand or from the reviewed floor plan (step B)
  const name=l.name||"this space";
  const outdoor=!!(plan&&plan.outdoor);
  // the cameras noted on the card for the CURRENT plate (2026-10-14) — set by hand or read from it
  const noted=plateMeta&&typeof normalizeLocationPlateCameras==="function"?normalizeLocationPlateCameras(l.plateCameras):null;
  const notedNow=!!(noted&&plateMeta&&plateMeta.iso&&noted.iso===plateMeta.iso);
  const rooms=typeof locationChildrenOf==="function"?locationChildrenOf(l,((window.turnContinuity||{}).locations)||[]):[];
  const ownsLayout=typeof locationSpatialOwner==="function"&&locationSpatialOwner(l).id===l.id;
  // the reviewed layout read from THIS plate already says where its cameras stood (step B) — the rooms use those
  const layoutKnows=!notedNow&&rooms.length>0&&!!plateMeta&&!plateMeta.platePanels&&typeof locationViewCandidates==="function"
    &&(()=>{try{return !!locationViewCandidates(l,rooms[0]).recorded;}catch(e){return false;}})();
  const storedPose=key=>({...(((locationStoredPanelViews(l)[key])||{}).pose||{})});
  const save=(key,pose)=>{ if(readOnly)return; onUpdate(l.id,{coverageViews:locationCoverageViewsWithPose(l,key,pose)}); };
  const setField=(p,field,raw)=>{
    const next=storedPose(p.key);
    if(field==="position"){
      const parts=String(raw||"").split(/[,\s]+/).filter(Boolean).map(Number);
      next.position=parts.length===3&&parts.every(Number.isFinite)?parts:null;
    }else if(field==="target")next.target=raw||"";
    else{const n=String(raw).trim()===""?null:Number(raw);next[field]=Number.isFinite(n)?n:null;}
    Object.keys(next).forEach(k=>{if(next[k]==null||next[k]==="")delete next[k];});
    delete next.basis;
    save(p.key,Object.keys(next).length?{...next,basis:"user"}:null);
  };
  const useSuggested=()=>{
    if(readOnly)return;
    let tmp={...l};
    panels.filter(p=>p.suggestedPose&&p.suggestedPose.yaw!=null).forEach(p=>{
      tmp={...tmp,coverageViews:locationCoverageViewsWithPose(tmp,p.key,{...p.suggestedPose,basis:"design"})};});
    onUpdate(l.id,{coverageViews:tmp.coverageViews||[]});
  };
  const makeView=async(openingId)=>{
    if(readOnly||busy)return;
    const req=locationParentViewRequest(l,openingId);
    if(!req)return;
    const toast=(m,k)=>{if(typeof window.appToast==="function")window.appToast(m,k);};
    // a view already made (a cold cache on this device) is used, never paid for twice
    let exists=false;
    try{exists=!!((typeof nbGetImage==="function"&&nbGetImage(req.assetId))||(typeof nbLoadImage==="function"&&await nbLoadImage(req.assetId)));}catch(e){}
    const meta=exists&&typeof nbGetMeta==="function"?nbGetMeta(req.assetId):null;
    const parentMeta=typeof nbGetMeta==="function"?nbGetMeta(req.targetId):null;
    if(meta&&meta.parentViewPose&&!(parentMeta&&parentMeta.iso&&meta.locationParentIso&&meta.locationParentIso!==parentMeta.iso)){
      refresh();toast("That view is already made — "+name+"'s plate uses it for "+(req.opening.name||"the opening")+".","info");return;}
    setBusy(openingId);
    try{
      const ok=await generateLocationParentView(l,req,project);
      if(ok)toast("Made "+req.targetName+" seen from "+name+" — it is used for "+(req.opening.name||"the opening")+" when you generate "+name+"'s plate.");
    }catch(e){toast((e&&e.message)||"Couldn't make that view.","error");}
    finally{if(alive.current){setBusy("");refresh();}}
  };
  const unknownFacing=openings.filter(o=>o.yaw==null);
  /* WHERE EACH OPENING LEADS (2026-10-14, owner — "go ahead with all of it"): never the parent by default. One that
     names another location points to that card; for one whose words say nothing, a room's card says where it leads
     (openingLeadsTo — costs nothing, generates nothing) */
  const leadMap=(l.openingLeadsTo&&typeof l.openingLeadsTo==="object")?l.openingLeadsTo:{};
  const leadsCard=openings.filter(o=>o.destination==="card"&&o.leadsTo);
  const leadsChosen=openings.filter(o=>Object.prototype.hasOwnProperty.call(leadMap,o.id)&&(o.destination==="chosen"||o.destination==="elsewhere"));
  const leadsUnknown=parent?openings.filter(o=>o.destination==="unknown"):[];
  const setLead=(id,value)=>{ if(readOnly)return;
    const next={...leadMap}; if(value==null)delete next[id]; else next[id]=value;
    onUpdate(l.id,{openingLeadsTo:Object.keys(next).length?next:undefined}); };
  const goToCard=(t)=>{
    const sel=String(t.id||"").replace(/["\\]/g,"");
    const el=typeof document!=="undefined"&&document.querySelector('[data-location-card="'+sel+'"],[data-location-workspace="'+sel+'"]');
    if(el&&el.scrollIntoView){el.scrollIntoView({behavior:"smooth",block:"start"});return;}
    if(typeof window.appToast==="function")window.appToast((t.name||"That location")+"'s card isn't on this page — find it in Locations.","info");
  };
  const recorded=!!(plateMeta&&plateMeta.platePanels);
  const setPlateFacing=(key,raw)=>{
    if(readOnly||!plateMeta||!plateMeta.iso)return;
    const base=notedNow?{...noted.panels}:{};
    const yaw=String(raw)===""?null:Number(raw);
    if(yaw==null||!Number.isFinite(yaw))delete base[key];
    else base[key]={...(base[key]||{}),yaw,basis:"user"};
    const next=normalizeLocationPlateCameras({iso:plateMeta.iso,source:"set",panels:base});
    onUpdate(l.id,{plateCameras:next||undefined});
  };
  const readPlateCameras=async()=>{
    if(readOnly||busy||!plateMeta)return;
    const toast=(m,k)=>{if(typeof window.appToast==="function")window.appToast(m,k);};
    if(typeof window.aiReadPlateCameras!=="function"){toast("Reading cameras isn't available here.","error");return;}
    const epoch=typeof nbEpoch==="function"?nbEpoch():null;
    setBusy("read-cameras");
    try{
      const rec=await window.aiReadPlateCameras(l,((window.turnContinuity||{}).scenes)||[],project);
      if(typeof nbEpoch==="function"&&nbEpoch()!==epoch)return;
      onUpdate(l.id,{plateCameras:rec});
      const n=Object.keys(rec.panels).length;
      toast("Read "+n+" camera"+(n===1?"":"s")+" from "+name+"'s plate — the rooms inside can now use its panels.");
    }catch(e){toast((e&&e.message)||"Couldn't read the cameras.","error");}
    finally{if(alive.current)setBusy("");}
  };
  const num=(label,value,placeholder,onCommit,unit)=>React.createElement("label",{className:"loc-cam-field"},
    React.createElement("span",null,label),
    React.createElement("input",{className:"prop-select",type:"number",inputMode:"decimal",step:"any",
      key:String(value==null?"":value),defaultValue:value==null?"":value,placeholder:placeholder==null?"":String(placeholder),
      disabled:readOnly,onBlur:e=>{if(String(e.target.value)!==String(value==null?"":value))onCommit(e.target.value);}}),
    unit&&React.createElement("small",null,unit));
  const sightRow=(s,i)=>{
    const head="“"+s.openingName+"”"+(s.wallYaw!=null?" ("+locCompass(s.wallYaw)+(outdoor&&s.kind==="arch"?" side)":" wall)"):"")+" → "+s.targetName+", looking "+locCompass(s.yaw);
    if(s.sourceId){
      const src=(plan.sources||[]).find(x=>x.id===s.sourceId)||{};
      return React.createElement("li",{key:i,className:"loc-cam-sight ok"},React.createElement("b",null,head),
        React.createElement("span",null,src.kind==="view"?": the view made from "+name+"'s position."
          :": the "+LOC_PANEL_INFO[src.key].label.toLowerCase()+" panel of "+s.targetName+"'s plate, cut out and attached as its own reference."
          +(s.approx?" Matched by facing — positions would make the check exact.":"")));
    }
    const reason=s.reason==="no-plate"?s.targetName+" has no plate yet."
      :s.reason==="no-record"?s.targetName+"'s plate was made before its cameras were recorded, so its panels' facings are unknown — set them (free) or read them from the plate under "+s.targetName+"'s Plate cameras."
      :"No "+s.targetName+" view faces "+locCompass(s.yaw)+" from here.";
    const beyond=(s.beyond||[]).map(a=>a.name).filter(Boolean);
    const req=locationParentViewRequest(l,s.openingId);
    const refs=typeof locationParentViewRefCount==="function"?locationParentViewRefCount(l,req):1;
    return React.createElement("li",{key:i,className:"loc-cam-sight open"},React.createElement("b",null,head),
      React.createElement("span",null,": "+reason+" The plate describes what lies that way from the shared layout"
        +(beyond.length?" ("+beyond.join(", ")+")":"")+" and marks it unresolved."),
      req&&React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",
        disabled:readOnly||!!busy||!layout.ready||s.reason==="no-plate",
        title:!layout.ready?layout.reason:"One image: "+s.targetName+" seen from "+name+", looking "+locCompass(s.yaw)
          +" through "+s.openingName+". It becomes the reference for that opening. Uses image credits.",
        onClick:()=>makeView(s.openingId)},
        busy===s.openingId?"Making the view…":"Make a "+s.targetName+" view from "+name+"'s position",
        busy!==s.openingId&&typeof window.nbCostChip==="function"&&window.nbCostChip(1,{refs})));
  };
  // opens by itself when a camera stands somewhere it can't (step 3 · Cameras says which and why)
  return React.createElement("details",{className:"loc-nested-section loc-plate-cameras",open:parent||Object.keys(problems).length?true:undefined},
    React.createElement("summary",null,"Plate cameras \u00b7 where each panel is shot from",React.createElement("span",{className:"loc-spatial-status"+(storedAny||parent?" ready":"")},
      parent?(plan&&plan.unresolved.length?plan.unresolved.length+" view"+(plan.unresolved.length===1?"":"s")+" unresolved":"Planned")
        :storedAny?"Set":statedAny?"From the layout":"Suggested")),
    React.createElement("p",{className:"loc-layer-note"},parent
      ?(outdoor
        ?"Each panel of "+name+"'s plate is a camera standing on "+name+", part of "+parent.name+", at eye level — each framed differently from "+parent.name
          +"'s own panels, with the rest of "+parent.name+" around it matching "+parent.name+"'s plate. Beyond an open side it uses the panel of "+parent.name+"'s plate that faces the same way, cut out on its own — never the whole sheet. Compass directions follow the shared layout's frame (north = the way it faces); positions are metres from its origin."
        :"Each panel of "+name+"'s plate is a camera inside "+name+". Through a window or door it shows "+parent.name
        +" as seen from that camera, using the panel of "+parent.name+"'s plate that faces the same way — never its most striking panel. Compass directions follow the shared layout's frame (north = the way it faces); positions are metres from its origin.")
      :"The camera of each panel of this plate. Rooms inside "+name+" use these to pick the panel that faces the same way as their windows. Compass directions follow the shared layout's frame (north = the way it faces). Until a camera is set, the plate prompt is unchanged."),
    !parent&&statedAny&&!recorded&&!notedNow&&plateMeta&&React.createElement("p",{className:"loc-layer-note loc-cam-warn",role:"status"},
      "The current plate was made before these cameras were set — regenerate it so the rooms inside can use its panels."),
    /* THIS PLATE'S CAMERAS (2026-10-14): a plate without recorded cameras, with rooms inside that would use its panels —
       not when the reviewed layout was read from this very plate (its observed cameras already serve the rooms) */
    !recorded&&!layoutKnows&&plateMeta&&plateMeta.iso&&rooms.length>0&&React.createElement("div",{className:"loc-cam-plate"},
      React.createElement("b",null,"This plate's cameras"),
      React.createElement("p",{className:"loc-layer-note"},notedNow
        ?(noted.source==="read"?"Read from this plate.":"Set by hand for this plate.")+" "+rooms.map(r=>r.name).join(", ")
          +" can now use the panel of it that faces the way a window, door or open side looks. They are kept for this plate only; the plate itself is unchanged."
        :"This plate was made before its cameras were recorded, so "+rooms.map(r=>r.name).join(", ")
          +" can't use its panels — "+(rooms.length===1?"it gets":"they get")+" one small panel of it for materials and colour only. Say which way each panel faces (free)"+(ownsLayout?", or read them from the plate.":".")),
      React.createElement("div",{className:"loc-cam-plate-grid"},LOC_PANEL_KEYS.map(k=>React.createElement("label",{key:k,className:"loc-cam-field"},
        React.createElement("span",null,LOC_PANEL_INFO[k].label+" faces"),
        React.createElement("select",{className:"prop-select",disabled:readOnly||!!busy,
          value:notedNow&&noted.panels[k]?String(Math.round(noted.panels[k].yaw/45)%8*45):"",
          onChange:e=>setPlateFacing(k,e.target.value)},
          React.createElement("option",{value:""},"Not known"),
          ["north","north-east","east","south-east","south","south-west","west","north-west"].map((w,i)=>React.createElement("option",{key:w,value:String(i*45)},w)))))),
      React.createElement("div",{className:"loc-cam-plate-acts"},
        // the read is the Draft shared layout read — only a location that owns its layout has one (a room inside: by hand)
        ownsLayout&&React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",disabled:readOnly||!!busy,
          title:"Reads where each panel's camera stood from this plate, the way Draft shared layout reads it. Only the cameras are kept — the layout and the plate are unchanged. Uses writing credits, not image credits.",
          onClick:readPlateCameras},
          busy==="read-cameras"?"Reading the cameras…":"Read the cameras from this plate",
          busy!=="read-cameras"&&typeof window.aiPlateCamerasReadCostText==="function"&&React.createElement("small",{className:"loc-cam-price"}," · "+window.aiPlateCamerasReadCostText())),
        notedNow&&React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",disabled:readOnly||!!busy,
          onClick:()=>{if(!readOnly)onUpdate(l.id,{plateCameras:undefined});}},"Clear"))),
    unknownFacing.length>0&&React.createElement("p",{className:"loc-layer-note loc-cam-warn"},
      "Set which way "+unknownFacing.map(o=>"“"+o.name+"”").join(", ")+" faces in the shared layout's objects (“Faces”) so the panels can see through "+(unknownFacing.length===1?"it":"them")+"."),
    (leadsCard.length>0||leadsChosen.length>0||leadsUnknown.length>0)&&React.createElement("ul",{className:"loc-cam-sights loc-cam-leads"},
      leadsCard.map(o=>React.createElement("li",{key:"card-"+o.id,className:"loc-cam-sight"},
        React.createElement("b",null,"“"+o.name+"”"),
        React.createElement("span",null," opens onto "+o.leadsTo.name+" — another location with its own card"
          +(parent?", so "+name+"'s plate never shows "+parent.name+" through it.":".")),
        React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",onClick:()=>goToCard(o.leadsTo)},"Go to "+o.leadsTo.name))),
      leadsChosen.map(o=>React.createElement("li",{key:"set-"+o.id,className:"loc-cam-sight ok"},
        React.createElement("b",null,"“"+o.name+"”"),
        React.createElement("span",null,o.destination==="chosen"
          ?" opens onto "+(((locationSpatialFamily(l)||[]).find(x=>x.id===o.connectsTo))||{}).name+" (set here)."
          :" opens somewhere else (set here) — no view of "+(parent?parent.name:"the space beyond")+" goes through it."),
        React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",disabled:readOnly,onClick:()=>setLead(o.id,null)},"Change"))),
      leadsUnknown.map(o=>React.createElement("li",{key:"ask-"+o.id,className:"loc-cam-sight open"},
        React.createElement("b",null,"“"+o.name+"”"),
        React.createElement("span",null,": the shared layout doesn't say what it opens onto, so no view of "+parent.name+" goes through it."),
        React.createElement("span",{className:"loc-cam-lead-buttons"},
          React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",disabled:readOnly,onClick:()=>setLead(o.id,parent.id)},"It opens onto "+parent.name),
          React.createElement("button",{type:"button",className:"art-draftall ghost loc-cam-make",disabled:readOnly,onClick:()=>setLead(o.id,"elsewhere")},"Somewhere else"))))),
    !parent&&!statedAny&&React.createElement("button",{type:"button",className:"art-draftall ghost",disabled:readOnly,onClick:useSuggested},
      "Use the suggested cameras"),
    React.createElement("div",{className:"loc-cam-grid"},
      (plan?plan.panels:panels).map(p=>React.createElement("div",{key:p.key,className:"loc-cam-panel"},
        React.createElement("div",{className:"loc-cam-head"},React.createElement("b",null,p.label),
          React.createElement("span",{className:"loc-cam-badge"+(p.source==="set"||p.source==="layout"?" set":"")},
            p.source==="set"?"Set":p.source==="layout"?"From the layout":(parent?"Planned":"Suggested"))),
        React.createElement("p",{className:"loc-cam-purpose"},p.purpose),
        React.createElement("p",{className:"loc-cam-text"},locationPoseText(p.pose,parent?name:"",anchors,outdoor?parent.name:undefined)),
        // (2026-10-14) outdoors: lowered to about 6 m, typed above it, or a framing one of the parent's views already has
        (typeof locationPanelCameraNotes==="function"?locationPanelCameraNotes(p,name,outdoor?parent.name:""):[]).map(n=>
          React.createElement("p",{key:n.kind,className:"loc-layer-note loc-cam-warn loc-cam-note-"+n.kind,role:"note"},n.text)),
        // where it stands is wrong for the room (inside a wall, outside it, inside an object): say so on the camera itself
        problems[p.key]&&React.createElement("p",{className:"loc-spatial-error loc-cam-problem",role:"note"},problems[p.key]+" Open Edit camera to change its position."),
        p.sights&&p.sights.length>0&&React.createElement("ul",{className:"loc-cam-sights"},p.sights.map(sightRow)),
        // the reverse direction (step B): the rooms this camera sees, named in its prompt
        (()=>{const kids=typeof locationPanelChildrenVisible==="function"?locationPanelChildrenVisible(l,p):[];
          return kids.length?React.createElement("p",{className:"loc-cam-kids"},"Sees "+kids.map(k=>k.name+" ("+(k.depth==="middle"?"":k.depth+" ")+k.frame+", about "+(Math.round(k.distance*10)/10)+" m"
            +((k.openings||[]).length?"; "+k.openings.map(o=>o.name+(o.faces==="camera"?" facing the camera":o.faces==="away"?" facing away":" side-on")).join(", "):"")+")").join("; ")
            +" \u2014 named in this panel's prompt so it stays where the layout puts it."):null;})(),
        React.createElement("details",{className:"loc-cam-edit",open:problems[p.key]?true:undefined},
          React.createElement("summary",null,"Edit camera"),
          React.createElement("div",{className:"loc-cam-fields"},
            num("Facing",storedPose(p.key).yaw,p.suggestedPose.yaw,v=>setField(p,"yaw",v),p.pose.yaw!=null?locCompass(p.pose.yaw)+" · degrees, 0 = north, 90 = east":"degrees, 0 = north, 90 = east"),
            num("Tilt",storedPose(p.key).pitch,p.suggestedPose.pitch,v=>setField(p,"pitch",v),"degrees, negative looks down"),
            num("Lens",storedPose(p.key).lensMm,p.suggestedPose.lensMm,v=>setField(p,"lensMm",v),"mm"),
            React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,"Position"),
              React.createElement("input",{className:"prop-select",type:"text",inputMode:"decimal",disabled:readOnly,
                key:JSON.stringify(storedPose(p.key).position||null),
                defaultValue:(storedPose(p.key).position||[]).join(", "),
                placeholder:p.suggestedPose.position?p.suggestedPose.position.join(", "):"x, y, height (metres)",
                onBlur:e=>{if(e.target.value!==(storedPose(p.key).position||[]).join(", "))setField(p,"position",e.target.value);}}),
              React.createElement("small",null,"x, y, height in metres from the layout's origin")),
            React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,"Aimed at"),
              React.createElement("select",{className:"prop-select",disabled:readOnly,value:storedPose(p.key).target||"",
                onChange:e=>setField(p,"target",e.target.value)},
                React.createElement("option",{value:""},p.suggestedPose.target?"Suggested: "+(((anchors.find(a=>a.id===p.suggestedPose.target))||{}).name||p.suggestedPose.target):"Nothing in particular"),
                anchors.map(a=>React.createElement("option",{key:a.id,value:a.id},a.name||a.id))))),
          p.source==="set"&&React.createElement("button",{type:"button",className:"art-draftall ghost",disabled:readOnly,
            onClick:()=>save(p.key,null)},parent?"Back to the planned camera":(JSON.stringify(p.suggestedPose)!==JSON.stringify(locationDefaultPanelPoses(l)[p.key].pose)?"Back to the floor plan's camera":"Back to the suggestion")))))),
    React.createElement("p",{className:"loc-layer-note"},parent
      ?"Each matched view is sent as its own reference image — one panel cut out of "+parent.name+"'s plate, never its whole sheet (on some engines each reference adds a little to the price). With none matched, one small panel of it goes for materials and colour only; you can untick it under the plate's reference images. Setting cameras uses no credits."
      :"Setting cameras uses no credits and generates nothing."));
}

/* THE FLOOR PLAN (step B of Location coordinates, owner 2026-10-13 — "include the top-down map"): the shared layout's
   approximate metric plan as a top-down map — footprints, openings, anchors and each plate panel's camera as a little
   frustum (position, facing, field of view); selecting a panel highlights its frustum. The numbers are estimates
   (drafted from the plates and the screenplay, or entered by hand), editable below, never presented as surveyed. */
const LOC_BASIS_OPTIONS=[["observed","Read from a plate"],["script","Stated in the screenplay"],["design","Proposed design"],["user","Set by hand"]];
function _locFmt(v){ return v==null||v===""?"":String(Math.round(Number(v)*100)/100); }
function _locPtsText(pts){ return (pts||[]).map(p=>_locFmt(p[0])+", "+_locFmt(p[1])).join("; "); }
function _locParsePts(text){
  return String(text||"").split(/;|\n/).map(x=>x.trim()).filter(Boolean)
    .map(x=>x.split(/[,\s]+/).filter(Boolean).map(Number)).filter(p=>p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>[p[0],p[1]]);
}
function _locParseVec(text,n){
  const parts=String(text||"").split(/[,\s]+/).filter(Boolean).map(Number);
  return parts.length===n&&parts.every(Number.isFinite)?parts:null;
}
function _locParseNum(text){ const t=String(text==null?"":text).trim(); if(!t)return null; const n=Number(t); return Number.isFinite(n)?n:null; }
/* a text field that commits on leaving it (numbers typed as text, so "1.2, -3" works on every phone keyboard) */
function LocCoordInput({label,value,placeholder,onCommit,hint,disabled,mode="decimal"}){
  return React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,label),
    React.createElement("input",{className:"prop-select",type:"text",inputMode:mode,disabled,key:String(value),defaultValue:value,
      placeholder:placeholder||"",onBlur:e=>{if(e.target.value!==value)onCommit(e.target.value);}}),
    hint&&React.createElement("small",null,hint));
}
function LocBasisSelect({value,onChange,disabled,label="Basis"}){
  return React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,label),
    React.createElement("select",{className:"prop-select",value:value||"design",disabled,onChange:e=>onChange(e.target.value)},
      LOC_BASIS_OPTIONS.map(o=>React.createElement("option",{key:o[0],value:o[0]},o[1]))));
}
/* READABLE TOP-DOWN MAP (owner 2026-10-13, "is this intended?" — no): the map takes the plan's shape (wide for a long
   quay, square for a room; 160–480 px tall on a phone, up to 560 px on a desktop; one scale for x and y, never
   stretched), fits the footprints and what stands in or near them (outliers point from the edge), zooms and pans
   ("+" / "−" / "Fit", Ctrl/⌘ + scroll or a pinch; once zoomed in, scroll zooms and a drag or one finger pans — at the fit
   a finger on the map still scrolls the page), shows one space at a time, and labels everything through numbered
   markers and a key under it (tap a marker or a row: its full label on the map, one at a time). */
const LOC_MAP_PAD=28,LOC_MAP_MAX_ZOOM=12,LOC_MAP_STEP=1.6;
function locMapBox(fit,width){
  const W=Math.max(240,Math.round(width||343)),phone=W<600,P=LOC_MAP_PAD;
  const fw=Math.max(2,fit.maxX-fit.minX),fh=Math.max(2,fit.maxY-fit.minY);
  const H=Math.round(Math.max(160,Math.min(phone?480:560,(W-2*P)*fh/fw+2*P)));
  const s=Math.min((W-2*P)/fw,(H-2*P)/fh);   // px per metre — the same on both axes
  return {W,H,s,cx:(fit.minX+fit.maxX)/2,cy:(fit.minY+fit.maxY)/2,vw:W/s,vh:H/s};
}
/* keep the zoomed view inside the fitted area (at the fit it cannot move) */
function locMapClamp(box,v){
  const zoom=Math.max(1,Math.min(LOC_MAP_MAX_ZOOM,(v&&v.zoom)||1));
  const lim=(c,mid,full)=>{const span=full/zoom,half=(full-span)/2;return c==null?mid:Math.max(mid-half,Math.min(mid+half,c));};
  return {zoom,cx:lim(v&&v.cx,box.cx,box.vw),cy:lim(v&&v.cy,box.cy,box.vh)};
}
/* zoom by `factor` keeping the plan point under (px, py) where it is */
function locMapZoomAt(box,v,factor,px,py){
  const z=Math.max(1,Math.min(LOC_MAP_MAX_ZOOM,v.zoom*factor)),k=box.s;
  const x=v.cx+(px-box.W/2)/(k*v.zoom),y=v.cy-(py-box.H/2)/(k*v.zoom);
  return locMapClamp(box,{zoom:z,cx:x-(px-box.W/2)/(k*z),cy:y+(py-box.H/2)/(k*z)});
}
/* a scale bar 40–110 px long, in round metres */
function locMapScaleBar(pxPerM){
  const steps=[0.5,1,2,5,10,20,50,100,200,500,1000];
  const m=steps.filter(x=>x*pxPerM<=110).pop()||steps[0];
  return {m,px:Math.round(m*pxPerM),label:(m<1?String(m):String(Math.round(m)))+" m"};
}
/* first candidate box that stays on the map and clear of everything placed so far (null: leave it to the key) */
function locMapPlace(taken,cands,w,h,W,H){
  for(const c of cands){
    const r={x:c[0],y:c[1],w,h};
    if(r.x<2||r.y<2||r.x+w>W-2||r.y+h>H-2)continue;
    if(taken.some(t=>r.x<t.x+t.w&&r.x+w>t.x&&r.y<t.y+t.h&&r.y+h>t.y))continue;
    taken.push(r);return r;
  }
  return null;
}
function locMapTextW(s,size){ return Math.ceil(String(s||"").length*size*0.58)+6; }
const LOC_MAP_KIND_WORD={window:"window",glass:"glazing",door:"door",arch:"opening"};
function _locMapPos(xy){ return "x "+_locFmt(xy[0])+", y "+_locFmt(xy[1])+" m"; }
function LocationFloorPlanMap({scene,selected,onSelect,spaceId=""}){
  const [filterPick,setFilterPick]=React.useState(null);
  const [width,setWidth]=React.useState(343);
  const [viewRaw,setView]=React.useState(null);
  const wrapRef=React.useRef(null),svgRef=React.useRef(null),live=React.useRef({}),gest=React.useRef({pts:{},n:0,start:null,pinch:null,moved:false});
  const list=(scene&&scene.spaceList)||[];
  const dflt=list.length>1&&list.some(s=>s.id===spaceId)?spaceId:"";
  const filter=list.length>1?(filterPick==null?dflt:filterPick):"";
  React.useEffect(()=>{setFilterPick(null);},[spaceId]);
  React.useEffect(()=>{setView(null);},[filter]);
  React.useEffect(()=>{
    const el=wrapRef.current;if(!el)return;
    const measure=()=>{const w=Math.round(el.clientWidth||el.getBoundingClientRect().width);if(w>0)setWidth(w);};
    measure();
    if(typeof ResizeObserver!=="function")return;
    const ro=new ResizeObserver(measure);ro.observe(el);return ()=>ro.disconnect();
  },[]);
  // wheel: Ctrl/⌘ + scroll (a trackpad pinch) always zooms; a plain scroll zooms only once zoomed in
  React.useEffect(()=>{
    const el=svgRef.current;if(!el||!el.addEventListener)return;
    const wheel=e=>{const L=live.current;if(!L.box)return;
      if(!(e.ctrlKey||e.metaKey)&&L.view.zoom<=1)return;
      e.preventDefault();
      const r=el.getBoundingClientRect(),px=(e.clientX-r.left)*L.box.W/r.width,py=(e.clientY-r.top)*L.box.H/r.height;
      const f=Math.exp(-Math.max(-60,Math.min(60,e.deltaY))*(e.ctrlKey?0.012:0.004));
      setView(locMapZoomAt(L.box,L.view,f,px,py));};
    el.addEventListener("wheel",wheel,{passive:false});
    return ()=>el.removeEventListener("wheel",wheel);
  },[!scene||scene.empty]);
  if(!scene||scene.empty)return React.createElement("p",{className:"loc-layer-note loc-map-empty"},
    "No floor plan numbers yet. Draft shared layout drafts approximate ones from the plate and the screenplay, or add a room's footprint under Floor plan numbers.");
  const fit=(typeof locationFloorPlanFit==="function"&&locationFloorPlanFit(scene,filter))||scene.fit||scene.bounds;
  const box=locMapBox(fit,width),view=locMapClamp(box,viewRaw||{}),k=box.s*view.zoom,W=box.W,H=box.H;
  live.current={box,view};
  const X=x=>Math.round((W/2+(x-view.cx)*k)*10)/10,Y=y=>Math.round((H/2-(y-view.cy)*k)*10)/10;
  const pts=arr=>arr.map(q=>X(q[0])+","+Y(q[1])).join(" ");
  const shown=x=>!filter||x.spaceId===filter;
  const nameOf=id=>((list.find(s=>s.id===id))||{}).name||"";
  const cams=scene.cameras.filter(shown),anchors=scene.anchors.filter(a=>!a.opening&&shown(a)),openings=scene.openings.filter(shown);
  const camKey=c=>c.spaceId+":"+c.panel,aKey=a=>"#a:"+a.id,oKey=o=>"#o:"+o.spaceId+":"+o.id;
  const selCam=cams.find(c=>camKey(c)===selected)||null,selA=anchors.find(a=>aKey(a)===selected)||null,selO=openings.find(o=>oKey(o)===selected)||null;
  const sel=selCam||selA||selO;
  const pick=key=>onSelect&&onSelect(selected===key?"":key);
  const inset=14,inside=(px,py)=>px>=inset&&px<=W-inset&&py>=inset&&py<=H-inset;
  const edge=(px,py,pad=inset)=>{   // where the ray from the centre to an off-map point leaves the map (pad: room for the arrow)
    const dx=px-W/2,dy=py-H/2,t=Math.min(Math.abs(dx)>1e-6?(W/2-pad)/Math.abs(dx):Infinity,Math.abs(dy)>1e-6?(H/2-pad)/Math.abs(dy):Infinity);
    return [W/2+dx*t,H/2+dy*t,Math.atan2(dy,dx)*180/Math.PI];
  };
  // fixed furniture first, so labels keep clear of it: the north arrow (top-left) and the scale bar (bottom-left)
  const taken=[{x:6,y:6,w:30,h:42}],bar=locMapScaleBar(k);
  taken.push({x:8,y:H-34,w:Math.max(bar.px,40)+8,h:28});
  // 1. the selected item's full label
  const selLabel=sel?(selCam?selCam.panel+" \u2014 "+selCam.label:selA?selA.num+" · "+selA.name:selO.tag+" · "+selO.name):"";
  const selXY=sel?(selCam?selCam.position:selA?selA.xy:selO.centre):null;
  let selBox=null;
  if(sel){
    let sx=X(selXY[0]),sy=Y(selXY[1]);
    if(!inside(sx,sy)){const e=edge(sx,sy);sx=e[0];sy=e[1];}
    const w=Math.min(W-8,locMapTextW(selLabel,12)+4),h=22;
    selBox=locMapPlace(taken,[[sx-w/2,sy-h-14],[sx-w/2,sy+14],[sx+14,sy-h/2],[sx-w-14,sy-h/2],[sx-w/2,sy-h-34],[sx-w/2,sy+34],
      [Math.min(W-w-4,Math.max(4,sx-w/2)),4],[Math.min(W-w-4,Math.max(4,sx-w/2)),H-h-4]],w,h,W,H)
      ||{x:Math.max(4,Math.min(W-w-4,sx-w/2)),y:4,w,h};
  }
  // 2. numbered object markers (nudged apart, with a leader line to where they stand)
  const R=10,markers=anchors.map(a=>{
    let px=X(a.xy[0]),py=Y(a.xy[1]),arrow=null;
    if(!inside(px,py)){const e=edge(px,py,28);px=e[0];py=e[1];arrow=e[2];}
    const ring=[[0,0]].concat(...[22,40].map(d=>[[0,-d],[d,0],[0,d],[-d,0],[d*.7,-d*.7],[d*.7,d*.7],[-d*.7,d*.7],[-d*.7,-d*.7]]));
    const r=locMapPlace(taken,ring.map(o=>[px+o[0]-R,py+o[1]-R]),2*R,2*R,W,H);
    return {a,px,py,arrow,mx:r?r.x+R:px,my:r?r.y+R:py};
  });
  // 3. opening tags, just outside their wall
  const tags=openings.map(o=>{
    const cx=X(o.centre[0]),cy=Y(o.centre[1]);
    if(!inside(cx,cy))return {o,cx,cy,off:true};
    const d=o.yaw!=null?_locDir(o.yaw):[0,1],w=locMapTextW(o.tag,10),h=14;
    const at=s=>[cx+d[0]*s-w/2,cy-d[1]*s-h/2];
    return {o,cx,cy,box:locMapPlace(taken,[at(14),at(-14),at(26),at(-26),[cx+8,cy-h-4],[cx-w-8,cy+4]],w,h,W,H)};
  });
  // 4. space names inside their footprints (smallest first); one that doesn't fit is named in the key only
  const names=scene.spaces.slice().sort((p,q)=>_locMapArea(p)-_locMapArea(q))
    .map(sp=>{const b=_locMapBounds(sp.footprint),bw=(b.maxX-b.minX)*k,bh=(b.maxY-b.minY)*k,w=locMapTextW(sp.name,11),h=16;
      if(!sp.name||w>bw-6||h>bh-4)return {sp,box:null};
      const cx=X(sp.centre[0]),cy=Y(sp.centre[1]);
      const cands=[].concat(...[0,-.25,.25,-.4,.4].map(fx=>[0,-18,18,-36,36].map(dy=>[cx+fx*bw-w/2,cy+dy-h/2]))).filter(c=>{
        const mx=view.cx+(c[0]+w/2-W/2)/k,my=view.cy-(c[1]+h/2-H/2)/k;return _locMapInside([mx,my],sp.footprint);});
      return {sp,box:locMapPlace(taken,cands,w,h,W,H)};});
  const spaceCls=sp=>"loc-map-space s"+((sp.index||0)%6)+(sp.owner?" owner":" room")+(filter&&sp.id!==filter?" dim":"");
  const zoomBy=f=>setView(locMapZoomAt(box,view,f,W/2,H/2));
  // gestures: a drag (mouse) or one finger (touch, once zoomed in) pans; two fingers pinch
  const G=gest.current;
  const at=e=>{const r=svgRef.current.getBoundingClientRect();return [(e.clientX-r.left)*W/r.width,(e.clientY-r.top)*H/r.height];};
  const down=e=>{
    if(e.pointerType==="mouse"&&e.button!==0)return;
    G.pts[e.pointerId]=at(e);G.n=Object.keys(G.pts).length;
    if(G.n===1){G.start={p:G.pts[e.pointerId],view};G.moved=false;}
    if(G.n===2){const [a,b]=Object.values(G.pts);G.pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1])||1,mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],view};G.moved=true;
      Object.keys(G.pts).forEach(id=>{try{svgRef.current.setPointerCapture(Number(id));}catch(x){}});}
  };
  const move=e=>{
    if(!G.pts[e.pointerId])return;
    G.pts[e.pointerId]=at(e);
    if(G.n>=2&&G.pinch){const [a,b]=Object.values(G.pts),P0=G.pinch,v0=P0.view;
      const z=Math.max(1,Math.min(LOC_MAP_MAX_ZOOM,v0.zoom*Math.hypot(a[0]-b[0],a[1]-b[1])/P0.d)),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      const x=v0.cx+(P0.mid[0]-W/2)/(box.s*v0.zoom),y=v0.cy-(P0.mid[1]-H/2)/(box.s*v0.zoom);
      setView(locMapClamp(box,{zoom:z,cx:x-(mid[0]-W/2)/(box.s*z),cy:y+(mid[1]-H/2)/(box.s*z)}));return;}
    if(!G.start)return;
    const dx=G.pts[e.pointerId][0]-G.start.p[0],dy=G.pts[e.pointerId][1]-G.start.p[1];
    if(!G.moved){if(Math.hypot(dx,dy)<5||G.start.view.zoom<=1)return;G.moved=true;try{svgRef.current.setPointerCapture(e.pointerId);}catch(x){}}
    const v0=G.start.view,kk=box.s*v0.zoom;
    setView(locMapClamp(box,{zoom:v0.zoom,cx:v0.cx-dx/kk,cy:v0.cy+dy/kk}));
  };
  const up=e=>{delete G.pts[e.pointerId];G.n=Object.keys(G.pts).length;
    if(G.n<2)G.pinch=null;
    if(G.n===1){G.start={p:Object.values(G.pts)[0],view:live.current.view};}
    if(!G.n)G.start=null;};
  const svg=React.createElement("svg",{ref:svgRef,className:"loc-map-svg"+(view.zoom>1?" zoomed":""),width:W,height:H,
    viewBox:"0 0 "+W+" "+H,style:{height:H+"px"},preserveAspectRatio:"xMidYMid meet",role:"group",
    "aria-label":"Top-down map of the shared layout"+(scene.frame?" — north is: "+scene.frame:""),
    onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:up,
    onClickCapture:e=>{if(G.moved){e.stopPropagation();G.moved=false;}}},
    React.createElement("rect",{className:"loc-map-bg",x:0,y:0,width:W,height:H,onClick:()=>sel&&onSelect&&onSelect("")}),
    scene.spaces.slice().sort((p,q)=>_locMapArea(q)-_locMapArea(p)).map(sp=>React.createElement("polygon",{key:"s-"+sp.id,points:pts(sp.footprint),className:spaceCls(sp)},
      React.createElement("title",null,sp.name))),
    openings.map(o=>React.createElement("line",{key:"o-"+o.spaceId+o.id,x1:X(o.a[0]),y1:Y(o.a[1]),x2:X(o.b[0]),y2:Y(o.b[1]),
      className:"loc-map-opening "+o.kind+(selO===o?" on":"")})),
    cams.map(c=>{const on=selCam===c,px=X(c.position[0]),py=Y(c.position[1]);
      if(c.outlier&&!inside(px,py)){const e=edge(px,py,22);
        return React.createElement("g",{key:"c-"+camKey(c),className:"loc-map-cam out"+(on?" on":""),onClick:()=>pick(camKey(c))},
          React.createElement("circle",{cx:e[0],cy:e[1],r:6}),
          React.createElement("path",{className:"loc-map-arrow",d:"M8,-5 L16,0 L8,5 Z",transform:"translate("+e[0]+","+e[1]+") rotate("+Math.round(e[2])+")"}),
          React.createElement("circle",{className:"loc-map-hit",cx:e[0],cy:e[1],r:16}));}
      return React.createElement("g",{key:"c-"+camKey(c),className:"loc-map-cam"+(on?" on":"")+(sel&&!on?" dim":"")+(c.outlier?" out":""),onClick:()=>pick(camKey(c))},
        React.createElement("polygon",{points:pts(c.frustum)}),
        React.createElement("circle",{cx:px,cy:py,r:on?5:4}),
        React.createElement("circle",{className:"loc-map-hit",cx:px,cy:py,r:16}));}),
    tags.filter(t=>t.box).map(t=>React.createElement("g",{key:"t-"+oKey(t.o),className:"loc-map-tag"+(selO===t.o?" on":""),onClick:()=>pick(oKey(t.o))},
      React.createElement("rect",{x:t.box.x,y:t.box.y,width:t.box.w,height:t.box.h,rx:3}),
      React.createElement("text",{x:t.box.x+t.box.w/2,y:t.box.y+10.5,textAnchor:"middle"},t.o.tag))),
    names.filter(n=>n.box).map(n=>React.createElement("text",{key:"n-"+n.sp.id,x:n.box.x+n.box.w/2,y:n.box.y+12,textAnchor:"middle",
      className:"loc-map-label"+(filter&&n.sp.id!==filter?" dim":"")},n.sp.name)),
    // leader lines first, under every marker, so a nudged marker's line never crosses another's number
    React.createElement("g",{className:"loc-map-leaders","aria-hidden":"true"},markers.filter(m=>m.mx!==m.px||m.my!==m.py).map(m=>React.createElement("g",{key:"l-"+m.a.id},
      React.createElement("line",{className:"loc-map-leader",x1:m.px,y1:m.py,x2:m.mx,y2:m.my}),
      m.arrow==null&&React.createElement("circle",{className:"loc-map-foot",cx:m.px,cy:m.py,r:2.5})))),
    markers.map(m=>{const on=selA===m.a,key=aKey(m.a);
      return React.createElement("g",{key:"a-"+m.a.id,className:"loc-map-anchor"+(on?" on":"")+(m.a.outlier?" out":"")+(sel&&!on?" dim":""),onClick:()=>pick(key)},
        m.arrow!=null&&React.createElement("path",{className:"loc-map-arrow",d:"M12,-5 L20,0 L12,5 Z",transform:"translate("+m.px+","+m.py+") rotate("+Math.round(m.arrow)+")"}),
        React.createElement("circle",{cx:m.mx,cy:m.my,r:R}),
        React.createElement("circle",{className:"loc-map-hit",cx:m.mx,cy:m.my,r:16}),
        React.createElement("text",{x:m.mx,y:m.my+3.8,textAnchor:"middle"},String(m.a.num)));}),
    selBox&&React.createElement("g",{className:"loc-map-sel"},
      React.createElement("rect",{x:selBox.x,y:selBox.y,width:selBox.w,height:selBox.h,rx:5}),
      React.createElement("text",{x:selBox.x+selBox.w/2,y:selBox.y+15,textAnchor:"middle"},selLabel)),
    React.createElement("g",{className:"loc-map-north","aria-hidden":"true"},
      React.createElement("circle",{cx:21,cy:24,r:15}),
      React.createElement("path",{d:"M21,12 L27,26 L21,22 L15,26 Z"}),
      React.createElement("text",{x:21,y:36,textAnchor:"middle"},"N")),
    React.createElement("g",{className:"loc-map-scale","aria-label":"Scale: "+bar.label},
      React.createElement("rect",{className:"loc-map-scale-bg",x:8,y:H-34,width:Math.max(bar.px,40)+8,height:28,rx:4}),
      React.createElement("path",{d:"M12,"+(H-14)+" v6 h"+bar.px+" v-6"}),
      React.createElement("text",{x:12,y:H-19},bar.label)));
  // the key: spaces, numbered objects, openings, then each space's cameras as one compact row
  const showSpaces=list.filter(s=>!filter||s.id===filter);
  const row=(key,mark,name,meta,warn)=>React.createElement("button",{key,type:"button",className:"loc-map-row"+(selected===key?" on":"")+(warn?" warn":""),
    "aria-pressed":selected===key,onClick:()=>pick(key)},
    React.createElement("span",{className:"loc-map-mark"},mark),
    React.createElement("span",{className:"loc-map-row-text"},React.createElement("b",null,name),React.createElement("small",null,meta),
      warn&&React.createElement("em",null,"outside the plan — check this position")));
  const camRows=showSpaces.map(sp=>{
    const mine=LOC_PANEL_KEYS.map(key=>({key,c:cams.find(c=>c.spaceId===sp.id&&c.panel===key),n:scene.noPosition.find(n=>n.spaceId===sp.id&&n.panel===key)}));
    if(!mine.some(m=>m.c||m.n))return null;
    return React.createElement("div",{key:"cr-"+sp.id,className:"loc-map-camrow",role:"group","aria-label":(sp.name||"This space")+" cameras"},
      React.createElement("span",{className:"loc-map-camrow-name"},sp.name),
      React.createElement("span",{className:"loc-map-seg"},mine.map(m=>{
        const label=(sp.name||"")+" · "+LOC_PANEL_INFO[m.key].label.toLowerCase();
        if(!m.c)return React.createElement("button",{key:m.key,type:"button",className:"loc-map-segbtn off","aria-disabled":"true",
          "aria-label":label+" camera — no position yet",title:"This camera has no position yet, so it isn't drawn"},m.key);
        const key=camKey(m.c);
        return React.createElement("button",{key:m.key,type:"button",className:"loc-map-segbtn"+(selected===key?" on":"")+(m.c.outlier?" warn":""),
          "aria-pressed":selected===key,"aria-label":label+" camera"+(m.c.outlier?" — outside the plan, check this position":""),
          title:label,onClick:()=>pick(key)},m.key);})));
  }).filter(Boolean);
  const hidden=scene.noPosition.filter(shown);
  const detail=selCam?selCam.label+": "+locationPoseText({position:selCam.position,yaw:selCam.yaw,pitch:selCam.pitch,lensMm:selCam.lensMm},"",[])
      +" Field of view "+Math.round(selCam.hfov)+"°."+(selCam.source==="set"?" Set by hand in Plate cameras.":selCam.source==="layout"?" From the floor plan.":" Suggested.")
      +(selCam.lowered?" Lowered to "+selCam.lowered.to+" m ("+(selCam.lowered.source==="layout"?"the floor plan says ":"saved at ")+selCam.lowered.from+" m) — outdoor cameras stay at eye level or a low high-angle.":"")
      +(selCam.heightWarning?" "+selCam.heightWarning.height+" m up, as set by hand — outdoor cameras stay at eye level or a low high-angle (at most about "+selCam.heightWarning.max+" m).":"")
      +(selCam.outlier?" Far outside every footprint — check this position.":"")
    : selA?selA.num+" · "+selA.name+" — "+(selA.spaceName||nameOf(selA.spaceId))+", "+_locMapPos(selA.xy)+(selA.facing!=null?", front faces "+locCompass(selA.facing):"")+"."
      +(selA.placement?" "+selA.placement:"")+(selA.outlier?" Far outside every footprint — check this position.":"")
    : selO?selO.tag+" · "+selO.name+" ("+(LOC_MAP_KIND_WORD[selO.kind]||selO.kind)+") — "+(selO.spaceName||nameOf(selO.spaceId))
      +(selO.yaw!=null?", faces "+locCompass(selO.yaw):"")+"."+(selO.outlier?" Far outside every footprint — check this position.":"")
    : "";
  return React.createElement("div",{className:"loc-map"},
    list.length>1&&React.createElement("div",{className:"loc-map-spaces",role:"group","aria-label":"Spaces on the map"},
      list.map(s=>React.createElement("button",{key:s.id,type:"button",className:"loc-map-chip"+(filter===s.id?" on":""),"aria-pressed":filter===s.id,
        onClick:()=>{setFilterPick(s.id);onSelect&&selected&&onSelect("");}},s.name||"Unnamed space")),
      React.createElement("button",{type:"button",className:"loc-map-chip"+(!filter?" on":""),"aria-pressed":!filter,
        onClick:()=>{setFilterPick("");}},list.length===2?"Both":"All")),
    React.createElement("div",{className:"loc-map-frame",ref:wrapRef},svg),
    React.createElement("div",{className:"loc-map-tools"},
      React.createElement("small",null,view.zoom>1?"Drag or use one finger to move · pinch or scroll to zoom":"Pinch, Ctrl/⌘ + scroll or + to zoom"),
      React.createElement("span",{className:"loc-map-zoom",role:"group","aria-label":"Map zoom"},
        React.createElement("button",{type:"button",className:"loc-map-zbtn","aria-label":"Zoom out",title:"Zoom out",disabled:view.zoom<=1,onClick:()=>zoomBy(1/LOC_MAP_STEP)},"−"),
        React.createElement("button",{type:"button",className:"loc-map-zbtn","aria-label":"Zoom in",title:"Zoom in",disabled:view.zoom>=LOC_MAP_MAX_ZOOM,onClick:()=>zoomBy(LOC_MAP_STEP)},"+"),
        React.createElement("button",{type:"button",className:"loc-map-zbtn fit","aria-label":"Fit the plan to the map",title:"Fit the plan",onClick:()=>setView(null)},"Fit"))),
    detail&&React.createElement("p",{className:"loc-layer-note loc-map-detail",role:"status"},detail),
    React.createElement("div",{className:"loc-map-legend",role:"group","aria-label":"Map key"},
      React.createElement("div",{className:"loc-map-legend-spaces"},showSpaces.map(s=>{const sp=scene.spaces.find(x=>x.id===s.id);
        return React.createElement("span",{key:s.id,className:"loc-map-swatch-row"},
          React.createElement("span",{className:"loc-map-swatch s"+((sp?sp.index:0)%6)+(sp?"":" none")}),s.name||"Unnamed space",
          sp?null:React.createElement("small",null," — no footprint yet"));})),
      anchors.length>0&&React.createElement("div",{className:"loc-map-legend-group"},React.createElement("h5",null,"Objects"),
        anchors.map(a=>row(aKey(a),String(a.num),a.name,(filter||list.length<2?"":(a.spaceName||nameOf(a.spaceId))+" · ")+_locMapPos(a.xy),a.outlier))),
      openings.length>0&&React.createElement("div",{className:"loc-map-legend-group"},React.createElement("h5",null,"Windows & doors"),
        openings.map(o=>row(oKey(o),o.tag,o.name,(filter||list.length<2?"":(o.spaceName||nameOf(o.spaceId))+" · ")+(LOC_MAP_KIND_WORD[o.kind]||o.kind)
          +(o.yaw!=null?", faces "+locCompass(o.yaw):""),o.outlier))),
      camRows.length>0&&React.createElement("div",{className:"loc-map-legend-group"},React.createElement("h5",null,"Plate cameras"),camRows,
        cams.filter(c=>c.outlier).map(c=>React.createElement("p",{key:"w"+camKey(c),className:"loc-map-warn"},c.label+" camera: outside the plan — check this position"))),
      hidden.length>0&&React.createElement("p",{className:"loc-layer-note"},"Not drawn (no position yet): "+hidden.map(c=>c.label).join(", ")+".")),
    React.createElement("p",{className:"loc-layer-note"},"Approximate — estimated from the plates and the screenplay, not surveyed. Metres; north (↑) is the way the layout's frame faces."));
}
function _locMapArea(sp){ const b=_locMapBounds(sp.footprint); return (b.maxX-b.minX)*(b.maxY-b.minY); }
function _locMapBounds(poly){ const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
  return {minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)}; }
function _locMapInside(pt,poly){
  let ins=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
    if(((a[1]>pt[1])!==(b[1]>pt[1]))&&(pt[0]<(b[0]-a[0])*(pt[1]-a[1])/((b[1]-a[1])||1e-9)+a[0]))ins=!ins;}
  return ins;
}
/* the outliers to name near Review / Confirm: "Check these positions" (a draft only; it never blocks) */
function locationFloorPlanCheckText(scene){
  const o=(scene&&scene.outliers)||[];
  if(!o.length)return "";
  const word={object:"",opening:"",camera:" camera"};
  return "Check these positions: "+o.slice(0,6).map(x=>x.name+word[x.kind]).join(", ")+(o.length>6?" and "+(o.length-6)+" more":"")
    +" — far outside every footprint on the drafted floor plan. Fix them under Floor plan numbers, or confirm if they are right.";
}
/* every floor plan number as an editable field — a change makes the layout a draft to confirm again */
function LocationFloorPlanFields({plan,family,change,readOnly}){
  const coords=plan.coordinates||{origin:{anchorId:"",note:""},spaces:[],cameras:[]};
  const spaces=coords.spaces||[],cameras=coords.cameras||[];
  const set=patch=>change({coordinates:{...coords,...patch}});
  const setSpace=(id,patch)=>set({spaces:spaces.map(s=>s.id===id?{...s,...patch}:s)});
  const setOpening=(sid,oid,patch)=>setSpace(sid,{openings:(spaces.find(s=>s.id===sid).openings||[]).map(o=>o.id===oid?{...o,...patch}:o)});
  const setCamera=(c,patch)=>set({cameras:cameras.map(x=>x===c?{...x,...patch}:x)});
  const nameOf=id=>((family.find(f=>f.id===id))||{}).name||id;
  const missing=family.filter(f=>!spaces.some(s=>s.id===f.id));
  /* (2026-10-14) the number stays as written, but outdoors a camera above about 6 m is used lower unless it is marked
     Set by hand (locationPanelPoses) — the Position hint says so, so the number here never silently disagrees */
  const camHint=(sp,c)=>{
    const base="m; height above the main floor",max=window.LOC_OUTDOOR_MAX_Z||6;
    if(!c.position||typeof locationIsOutdoor!=="function")return base;
    const card=family.find(f=>f.id===sp.id);
    if(!(card?locationIsOutdoor(card,undefined,sp):!!sp.openSky)||!(c.position[2]>(sp.floorZ||0)+max+0.05))return base;
    return c.basis==="user"?base+" — above the outdoor limit of about "+max+" m, used as set by hand"
      :base+" — outdoors it is used at most "+max+" m above this space's floor; mark it Set by hand to keep it higher";
  };
  return React.createElement("details",{className:"loc-spatial-assist loc-floorplan-fields"},
    // (owner 2026-10-27: plain words) the measured numbers matter for Blender; the image model reads placements in words
    React.createElement("summary",null,"Blender details",React.createElement("small",null,"Floor plan in metres · approximate")),
    React.createElement("p",{className:"loc-layer-note"},"Every number is an estimate you can change: footprints as corner points “x, y; x, y; …”, heights above the main floor, facings in degrees (0 = north, 90 = east). Changing a number makes the layout a draft to confirm again."),
    React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,"Origin (0, 0, floor level)"),
      React.createElement("select",{className:"prop-select",disabled:readOnly,value:coords.origin&&coords.origin.anchorId||"",
        onChange:e=>set({origin:{...(coords.origin||{}),anchorId:e.target.value}})},
        React.createElement("option",{value:""},"Not named"),
        plan.anchors.map(a=>React.createElement("option",{key:a.id,value:a.id},a.name||a.id)))),
    spaces.map(sp=>React.createElement("div",{key:sp.id,className:"loc-floorplan-space"},
      React.createElement("div",{className:"loc-cam-head"},React.createElement("b",null,nameOf(sp.id)),
        React.createElement("button",{type:"button",className:"loc-variant-x",disabled:readOnly,"aria-label":"Remove "+nameOf(sp.id)+" from the floor plan",
          onClick:()=>set({spaces:spaces.filter(s=>s.id!==sp.id),cameras:cameras.filter(c=>c.spaceId!==sp.id)})},React.createElement(Icon.x,{s:12}))),
      React.createElement("div",{className:"loc-cam-fields"},
        React.createElement(LocCoordInput,{label:"Footprint corners",value:_locPtsText(sp.footprint),placeholder:"0, 0; 6, 0; 6, 4; 0, 4",disabled:readOnly,
          hint:"x, y in metres; at least 3 corners",mode:"text",onCommit:v=>{const f=_locParsePts(v);setSpace(sp.id,{footprint:f,
            openings:(sp.openings||[]).map(o=>({...o,edge:null}))});}}),
        React.createElement(LocCoordInput,{label:"Floor height",value:_locFmt(sp.floorZ),placeholder:"0",disabled:readOnly,hint:"m above the main floor",
          onCommit:v=>setSpace(sp.id,{floorZ:_locParseNum(v)})}),
        React.createElement(LocCoordInput,{label:"Ceiling height",value:_locFmt(sp.ceilingH),placeholder:"2.6",disabled:readOnly,hint:"m",
          onCommit:v=>setSpace(sp.id,{ceilingH:_locParseNum(v)})}),
        // (2026-10-14) a space with no roof: its plate's cameras stand at eye level, none above about 6 m
        React.createElement("label",{className:"loc-cam-field loc-cam-check"},React.createElement("span",null,"Open sky"),
          React.createElement("input",{type:"checkbox",checked:!!sp.openSky,disabled:readOnly,
            onChange:e=>setSpace(sp.id,{openSky:e.target.checked?true:undefined})}),
          React.createElement("small",null,"no roof \u2014 cameras at eye level, none above about 6 m")),
        React.createElement(LocBasisSelect,{value:sp.basis,disabled:readOnly,onChange:v=>setSpace(sp.id,{basis:v})})),
      (sp.openings||[]).map(o=>React.createElement("div",{key:o.id,className:"loc-floorplan-opening"},
        React.createElement("div",{className:"loc-cam-head"},React.createElement("span",null,(o.name||o.id)+" · "+o.kind),
          React.createElement("button",{type:"button",className:"loc-variant-x",disabled:readOnly,"aria-label":"Remove "+(o.name||o.id),
            onClick:()=>setSpace(sp.id,{openings:sp.openings.filter(x=>x.id!==o.id)})},React.createElement(Icon.x,{s:12}))),
        React.createElement("div",{className:"loc-cam-fields"},
          React.createElement(LocCoordInput,{label:"Name",value:o.name||"",disabled:readOnly,mode:"text",onCommit:v=>setOpening(sp.id,o.id,{name:v})}),
          React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,"Kind"),
            React.createElement("select",{className:"prop-select",disabled:readOnly,value:o.kind,onChange:e=>setOpening(sp.id,o.id,{kind:e.target.value})},
              ["window","door","glass","arch"].map(k=>React.createElement("option",{key:k,value:k},k)))),
          React.createElement(LocCoordInput,{label:"Centre",value:o.centre?_locPtsText([o.centre]):"",placeholder:"x, y",disabled:readOnly,mode:"text",
            hint:"on its wall; its facing follows the nearest wall",onCommit:v=>setOpening(sp.id,o.id,{centre:_locParseVec(v,2),edge:null,yaw:null})}),
          React.createElement(LocCoordInput,{label:"Faces (outward)",value:_locFmt(o.yaw),placeholder:"degrees",disabled:readOnly,
            hint:o.yaw!=null?locCompass(o.yaw):"",onCommit:v=>setOpening(sp.id,o.id,{yaw:_locParseNum(v)})}),
          React.createElement(LocCoordInput,{label:"Width",value:_locFmt(o.width),placeholder:"0.9",disabled:readOnly,hint:"m",onCommit:v=>setOpening(sp.id,o.id,{width:_locParseNum(v)})}),
          React.createElement(LocCoordInput,{label:"Sill",value:_locFmt(o.sillZ),placeholder:"0.9",disabled:readOnly,hint:"m above the main floor",onCommit:v=>setOpening(sp.id,o.id,{sillZ:_locParseNum(v)})}),
          React.createElement(LocCoordInput,{label:"Head",value:_locFmt(o.headZ),placeholder:"2.1",disabled:readOnly,hint:"m above the main floor",onCommit:v=>setOpening(sp.id,o.id,{headZ:_locParseNum(v)})}),
          React.createElement("label",{className:"loc-cam-field"},React.createElement("span",null,"Opens onto"),
            React.createElement("select",{className:"prop-select",disabled:readOnly,value:o.connectsTo||"",onChange:e=>setOpening(sp.id,o.id,{connectsTo:e.target.value})},
              React.createElement("option",{value:""},"Outside / not set"),
              family.filter(f=>f.id!==sp.id).map(f=>React.createElement("option",{key:f.id,value:f.id},f.name||f.id)))),
          React.createElement(LocBasisSelect,{value:o.basis,disabled:readOnly,onChange:v=>setOpening(sp.id,o.id,{basis:v})})))),
      React.createElement("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||(sp.openings||[]).length>=16,
        onClick:()=>setSpace(sp.id,{openings:[...(sp.openings||[]),{id:"opening-"+Date.now().toString(36),name:"",kind:"window",basis:"user"}]})},"Add window or door"),
      React.createElement("div",{className:"loc-floorplan-cams"},
        LOC_PANEL_KEYS.map(k=>{const c=cameras.find(x=>x.spaceId===sp.id&&x.panel===k);
          if(!c)return React.createElement("button",{key:k,type:"button",className:"art-draftall ghost",disabled:readOnly,
            onClick:()=>set({cameras:[...cameras,{spaceId:sp.id,panel:k,basis:"user"}]})},"Add the "+LOC_PANEL_INFO[k].label.toLowerCase()+" camera");
          return React.createElement("div",{key:k,className:"loc-floorplan-opening"},
            React.createElement("div",{className:"loc-cam-head"},React.createElement("span",null,LOC_PANEL_INFO[k].label+" camera"),
              React.createElement("button",{type:"button",className:"loc-variant-x",disabled:readOnly,"aria-label":"Remove the "+LOC_PANEL_INFO[k].label.toLowerCase()+" camera",
                onClick:()=>set({cameras:cameras.filter(x=>x!==c)})},React.createElement(Icon.x,{s:12}))),
            React.createElement("div",{className:"loc-cam-fields"},
              React.createElement(LocCoordInput,{label:"Position",value:c.position?c.position.map(_locFmt).join(", "):"",placeholder:"x, y, height",mode:"text",disabled:readOnly,
                hint:camHint(sp,c),onCommit:v=>setCamera(c,{position:_locParseVec(v,3)})}),
              React.createElement(LocCoordInput,{label:"Facing",value:_locFmt(c.yaw),placeholder:"degrees",disabled:readOnly,hint:c.yaw!=null?locCompass(c.yaw):"0 = north",
                onCommit:v=>setCamera(c,{yaw:_locParseNum(v)})}),
              React.createElement(LocCoordInput,{label:"Tilt",value:_locFmt(c.pitch),placeholder:"0",disabled:readOnly,hint:"degrees; negative looks down",
                onCommit:v=>setCamera(c,{pitch:_locParseNum(v)})}),
              React.createElement(LocCoordInput,{label:"Lens",value:_locFmt(c.lensMm),placeholder:"24",disabled:readOnly,hint:"mm",onCommit:v=>setCamera(c,{lensMm:_locParseNum(v)})}),
              React.createElement(LocBasisSelect,{value:c.basis,disabled:readOnly,onChange:v=>setCamera(c,{basis:v})})));})))),
    missing.map(f=>React.createElement("button",{key:f.id,type:"button",className:"art-draftall ghost",disabled:readOnly||spaces.length>=16,
      onClick:()=>set({spaces:[...spaces,{id:f.id,name:f.name||"",footprint:[],floorZ:0,ceilingH:null,openings:[],basis:"user"}]})},
      "Add "+(f.name||"this room")+" to the floor plan")));
}

function LocationSpatialPlanEditor({l,scenes,project,onUpdate,readOnly=false,reviewRequest=0,onReturnToImage}){
  const [candidate,setCandidate]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
  const [,refresh]=React.useReducer(n=>n+1,0);
  const state=locationSpatialPlanState(l),owner=state.owner,plan=candidate||state.plan;
  const [open,setOpen]=React.useState(!state.ready);
  const summaryRef=React.useRef(null);
  const [mapSel,setMapSel]=React.useState("");   // the selected panel camera on the top-down map ("spaceId:TL")
  const confirmed=!candidate&&state.ready;
  // the map's scene, once per render: drawn below and read for "Check these positions" on a draft (never blocking)
  const mapScene=typeof locationFloorPlanScene==="function"?locationFloorPlanScene(owner,plan):null;
  const checkPositions=!confirmed&&typeof locationFloorPlanCheckText==="function"?locationFloorPlanCheckText(mapScene):"";
  // (2026-10-14) the outdoor cameras the draft proposed above about 6 m, lowered in the draft (while it is untouched)
  const loweredNote=candidate&&typeof locationLoweredCamerasText==="function"?locationLoweredCamerasText(candidate.loweredCameras):"";
  const keptNote=candidate&&typeof locationKeptOnRedraftText==="function"?locationKeptOnRedraftText(candidate.keptOnRedraft):"";
  const empty=!plan.frame.trim()&&!plan.anchors.length&&!plan.sightlines.trim()&&!plan.unresolved.trim();
  const check=locationSpatialPlanState({...owner,spatialPlan:normalizeLocationSpatialPlan({...plan,status:"reviewed",source:state.source})});
  const reviewHint=empty
    ? "No fixed placements have been saved. Draft specification writes the location description; use Draft shared layout to fill the fields below, or enter them manually."
    : !check.complete
    ? ((typeof locationSpatialPlanTooLarge==="function"?locationSpatialPlanTooLarge(plan):JSON.stringify(plan).length>12000)?check.reason:"Add a viewing direction and at least one object below. Each object needs a room, name and fixed placement. You can also draft with AI.")
    : candidate?"Check this proposed layout against your reference panels, then confirm it. Your saved layout is unchanged until you confirm."
    : state.stale&&state.plan.status==="reviewed"?"The parent image changed. Check the placements below against the new image, then confirm again."
    : "Check the placements below against your reference panels, then confirm to enable image generation.";
  const alive=React.useRef(true);
  const draftBasis=React.useRef(null);
  const currentState=()=>locationSpatialPlanState((((window.turnContinuity||{}).locations)||[]).find(x=>x.id===owner.id)||owner);
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{setCandidate(null);setError("");},[owner.id]);
  // a layout being drafted, or drafted and waiting to be confirmed, holds "Draft view composition" (2026-10-12)
  const pendingToken=React.useRef({});
  React.useEffect(()=>{
    if(typeof setLocationLayoutDraftPending!=="function")return;
    const id=owner.id,token=pendingToken.current;
    setLocationLayoutDraftPending(id,token,busy||!!candidate);
    return ()=>setLocationLayoutDraftPending(id,token,false);
  },[owner.id,busy,!!candidate]);
  React.useEffect(()=>{if(reviewRequest){setOpen(true);summaryRef.current?.focus({preventScroll:true});}},[reviewRequest]);
  React.useEffect(()=>{const changed=()=>refresh();window.addEventListener("nb-gen-done",changed);
    return ()=>window.removeEventListener("nb-gen-done",changed);},[]);
  const change=patch=>{
    if(readOnly)return;
    const next=normalizeLocationSpatialPlan({...plan,...patch,status:"draft"});
    if(candidate)setCandidate(next);else onUpdate(owner.id,{spatialPlan:next});
  };
  const anchorChange=(id,patch)=>change({anchors:plan.anchors.map(a=>a.id===id?{...a,...patch}:a)});
  // editing an older plan's object records how its height was meant, so adding a size never re-reads it
  const heightBasis=a=>a.zBasis||plan.heights==="centre"?{}:{zBasis:locationAnchorHeightBasis(a,plan)};
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
    React.createElement("summary",{ref:summaryRef},"Floor plan \u00b7 where everything stands",React.createElement("span",{className:"loc-spatial-status"+(confirmed?" ready":"")},
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
        ? "Reads the parent image when available; otherwise uses the written specification. Also drafts an approximate floor plan in metres (footprints, windows and doors, object positions, each panel's camera) \u2014 every number editable. Uses writing-model credits, not image credits. Review and confirm the result before generating."
        : "Confirmation uses no credits and does not generate an image."),
      checkPositions&&React.createElement("p",{className:"loc-map-check",role:"note"},checkPositions),
      loweredNote&&React.createElement("p",{className:"loc-map-check",role:"note"},loweredNote),
      keptNote&&React.createElement("p",{className:"loc-map-check",role:"note"},keptNote),
      candidate&&React.createElement("button",{type:"button",className:"art-draftall ghost",disabled:readOnly||busy,onClick:()=>{setCandidate(null);setError("");}},"Discard draft"),
      error&&React.createElement("p",{role:"alert",className:"loc-spatial-error"},error)),
    React.createElement("p",{className:"loc-layer-note loc-spatial-owner"},"One physical layout for "+(owner.name||"this location")+" and every room. Camera views below change the framing, not the furniture."),
    // the top-down map of the floor plan — the draft under review when there is one (step B, 2026-10-13)
    mapScene&&React.createElement("div",{className:"loc-map-wrap"},
      React.createElement("h4",{className:"loc-spatial-heading"},candidate?"Top-down map \u2014 draft to review":"Top-down map"),
      React.createElement(LocationFloorPlanMap,{scene:mapScene,selected:mapSel,onSelect:setMapSel,spaceId:l.id})),
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
        field("Supporting panels / evidence",a.evidence,value=>anchorChange(a.id,{evidence:value}),"Top-left: through archway. Top-right: direct kitchen view."),
        // which way a window / door faces, so a room's panels can see through it (2026-10-13, Location coordinates)
        typeof locationAnchorIsOpening==="function"&&locationAnchorIsOpening(a)&&React.createElement("label",{className:"loc-spatial-field"},
          React.createElement("span",null,"Faces (outward from "+(a.space||"its room")+")"),
          React.createElement("select",{className:"prop-select",value:a.facing==null?"":String(a.facing),
            onChange:e=>anchorChange(a.id,{facing:e.target.value===""?undefined:Number(e.target.value)})},
            React.createElement("option",{value:""},(()=>{const w=locWallYawFromText((a.placement||"")+" "+(a.name||""));
              return w?"From its placement: "+locCompass(w.yaw):"Not set";})()),
            (a.facing!=null&&a.facing%45?[a.facing]:[]).concat([0,45,90,135,180,225,270,315]).map(y=>
              React.createElement("option",{key:y,value:String(y)},locCompass(y)+" ("+Math.round(y)+"\u00b0)")))),
        // where it stands on the floor plan (step B): approximate metres, with where the numbers came from
        React.createElement("div",{className:"loc-cam-fields loc-anchor-coords"},
          React.createElement(LocCoordInput,{label:"Floor plan position",value:a.xy?a.xy.map(_locFmt).join(", "):"",placeholder:"x, y",mode:"text",
            hint:"metres from the origin (approximate)",onCommit:v=>anchorChange(a.id,{xy:_locParseVec(v,2)||undefined})}),
          React.createElement(LocCoordInput,{label:"Height",value:_locFmt(a.z),placeholder:"0",
            hint:(locationAnchorHeightBasis(a,plan)==="base"?"object base":"object centre")+", m above the main floor",
            onCommit:v=>{const z=_locParseNum(v);anchorChange(a.id,{z:z==null?undefined:z,...heightBasis(a)});}}),
          !(typeof locationAnchorIsOpening==="function"&&locationAnchorIsOpening(a))&&React.createElement(LocCoordInput,{
            label:"Object dimensions",value:a.size?a.size.map(_locFmt).join(", "):"",placeholder:"width, depth, height",mode:"text",
            hint:"metres; measured or proposed blockout dimensions",onCommit:v=>anchorChange(a.id,{size:_locParseVec(v,3)||undefined,sizeBasis:"user",...heightBasis(a)})}),
          !(typeof locationAnchorIsOpening==="function"&&locationAnchorIsOpening(a))&&React.createElement(LocCoordInput,{label:"Front faces",value:_locFmt(a.facing),
            placeholder:"degrees",hint:a.facing!=null?locCompass(a.facing):"0 = north, 90 = east",
            onCommit:v=>{const f=_locParseNum(v);anchorChange(a.id,{facing:f==null?undefined:f});}}),
          (a.xy||a.z!=null||a.facing!=null)&&React.createElement(LocBasisSelect,{label:"Position basis",value:a.posBasis,onChange:v=>anchorChange(a.id,{posBasis:v})})))),
      React.createElement("button",{className:"art-draftall ghost",disabled:plan.anchors.length>=24,
        onClick:()=>change({anchors:[...plan.anchors,{id:"anchor-"+Date.now().toString(36),space:l.name||"",name:"",placement:"",basis:"design",evidence:""}]})},"Add fixed anchor"),
      typeof locationSpatialFamily==="function"&&React.createElement(LocationFloorPlanFields,{plan,family:locationSpatialFamily(owner),change,readOnly}),
      field("Connections & doorway sightlines",plan.sightlines,value=>change({sightlines:value}),"Which rooms connect? What objects are visible through each opening?"),
      field("Unknowns / conflicts to resolve in 3D",plan.unresolved,value=>change({unresolved:value}),"Unseen walls, conflicting panels, dimensions that still need measurement…"),
      React.createElement("p",{className:"loc-layer-note"},"Check placements across all source panels and explicitly resolve any disagreement in Layout corrections. Floor plan numbers are approximate estimates for a 3D blockout \u2014 never a survey; unknown dimensions stay in Unknowns. A new parent plate requires another review."),
      !confirmed&&!empty&&React.createElement("div",{className:"loc-spatial-footer"},
        React.createElement("p",{className:"loc-layer-note"},check.complete?"Finished checking? Confirm this layout to enable image generation.":reviewHint),
        confirmButton(),
        error&&React.createElement("p",{className:"loc-spatial-error"},error))));
}

function LocationSheet({ l, project, scenes, drafts, onUpdate, onDelete, onDraft, drafting, onView, batchActiveId, onBatchDone, onChipClick, onDraftStaging, draftingStage, sluglineUnits, onUpdateUnit, onRemoveUnit, readOnly=false, workspaceMembers=[],onSelectLocation,initialSection="",embedded=false,
  samePlace=[], mergeChoices=[], onMergeLocations, onPlaceDecision }){
  // "Same place as…" (2026-10-14): the card picked to merge this one with — null while the picker is closed
  const [samePick, setSamePick] = React.useState(null);
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
  // (2026-10-08) the card only reads "Surprise me" once a style has come back; a failure says so
  const rollSurprise = async (asPick)=>{
    if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())){
      if(typeof window.appToast==="function") window.appToast("Surprise me needs the writing model \u2014 it isn't available right now.","info"); return; }
    setStyling(true);
    try{ const r = await aiSurpriseStyleText({ name:l.name, kind:"location", bible:locBible() }, project);
      if(r) onUpdate(l.id, { ...(asPick===true ? { renderStyleIndependent:true, renderStyleKey:"surprise" } : {}), surpriseRender:r, renderStyle:r.style });
      else if(typeof window.appToast==="function") window.appToast("No surprise style came back \u2014 the style is unchanged.","info"); }
    catch(e){ if(typeof window.appToast==="function") window.appToast("Couldn't invent a style ("+((e&&e.message)||"error")+"). The style is unchanged.","error"); }
    setStyling(false);
  };
  const pickLocStyle = async (key)=>{
    if(key!=="surprise"){ onUpdate(l.id, { renderStyleIndependent:true,renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function" ? window.renderStyleText("loc", key) : (LOC_TEXT[key]||LOC_TEXT.photoreal)) }); return; }
    if(l.surpriseRender && l.surpriseRender.style){ onUpdate(l.id, { renderStyleIndependent:true, renderStyleKey:"surprise", renderStyle:l.surpriseRender.style }); return; }
    await rollSurprise(true);
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
  const masterPlanSig=React.useRef("");
  // a room's panel plan and the cameras its prompt states, fixed when its references are read (2026-10-13)
  const masterSubPlan=React.useRef(null);
  const masterPanelRecord=React.useRef(null);
  const masterLayoutSig=React.useRef("");
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
  /* SINGLE CUT-OUT PANELS, NEVER THE WHOLE SHEET (2026-10-14, owner — "go ahead with all of it"): a room's strip shows
     the parent's part as it will be sent — each quadrant matched to a view (needed: the prompt names it), or the one
     small material panel (optional: it can be unticked). Thumbnails are cut small here; Generate cuts them full size. */
  const [rootRefs,setRootRefs]=React.useState([]);
  const rootPlanKey=(()=>{ if(!l.parentLocation||typeof locationSubspacePanelPlan!=="function")return "";
    try{ const pl=locationSubspacePanelPlan(l); const pm=(typeof nbGetMeta==="function"&&nbGetMeta(l.parentLocation.id))||{};
      return pl.sources.map(x=>x.id+":"+(x.uses||[]).map(u=>u.panel+u.openingId).join("+")).join(",")+"|"+(pm.iso||"")+"|"+JSON.stringify(((locationParentOf(l)||{}).plateCameras)||null); }
    catch(e){ return "x"; } })();
  React.useEffect(()=>{
    let alive=true;
    if(!l.parentLocation||!parentRefUrl||typeof locationSubspaceRootReferences!=="function"){ setRootRefs([]); return ()=>{alive=false;}; }
    locationSubspaceRootReferences(l,{preview:true}).then(r=>{ if(alive) setRootRefs((r&&r.refs||[]).map(x=>({...x,preview:true}))); },
      ()=>{ if(alive) setRootRefs([]); });
    return ()=>{alive=false;};
  },[l.id,parentRefUrl,rootPlanKey]);
  const buildMasterRefs = ()=>{
    const out = [];
    const C = window.turnContinuity || {};
    if(l.parentLocation){
      // the parent's part: its cut-out panels (above), or — its plate missing — the one slot that says it is needed
      if(parentRefUrl) rootRefs.forEach(r=>out.push(r));
      else { const miss=typeof locationParentMissingReference==="function"?locationParentMissingReference(l):null; if(miss) out.push(miss); }
    }
    /* the same pages the headless runs attach (locationScriptPageRefs): whole scenes, in the slots the parent's plate,
       the cut-out panels and the layout's plate leave (2026-10-14) */
    const fixed=(typeof locationPlateFixedRefCount==="function")?locationPlateFixedRefCount(l):{n:null};
    if(typeof locationScriptPageRefs==="function")
      locationScriptPageRefs(l, scenes||C.scenes||[], drafts||C.drafts||{}, Math.max(0,6-(fixed.n!=null?fixed.n:out.length))).forEach(r=>out.push(r));
    return out;
  };
  const masterScriptSig = JSON.stringify((l.scenes||[]).map(sid=>(((drafts||{})[sid]||{}).blocks||[])));
  const masterRefsKey = [l.id, l.parentLocation&&l.parentLocation.id, parentRefUrl, (l.scenes||[]).join(","), scenes&&scenes.length, masterScriptSig,
    rootRefs.map(r=>r.refId+":"+(r.url?r.url.length:0)).join(",")].join("|");
  React.useEffect(()=>{ setMasterRefs(buildMasterRefs()); },[masterRefsKey]);
  /* WHAT GENERATE SENDS, FOR ITS PRICE (2026-10-14): the parent's part (or, on a main location, the layout's plate), then
     whole scenes' pages in the slots left — as attachments() builds it, the unticked ones left out */
  const masterGenerateRefs = (()=>{
    try{
      const parentN = l.parentLocation
        ? (parentRefUrl ? rootRefs.filter(r=>r.required!==false || masterRefOff.indexOf(r.refId)<0).length : 0)
        : ((typeof locationPlateFixedRefCount==="function" ? locationPlateFixedRefCount(l).n : 0) || 0);
      const pages = masterRefs.filter(r=>r.kind==="script" && !r.required && r.url && masterRefOff.indexOf(r.refId)<0);
      return Math.min(6, parentN + (typeof locationWholeScenePages==="function" ? locationWholeScenePages(pages, 6-parentN) : pages).length);
    }catch(e){ return undefined; }
  })();
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

  // the reference list that follows a master plate's prompt (the prompt budget keeps room for it — 2026-10-14)
  const masterAttachmentsText = (refs)=> refs && refs.length
    ? "REFERENCE IMAGES are attached: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")
      +". Read screenplay pages together as evidence for permanent geography. A continuity-root plate is binding inherited identity, not a panel map. "
      +"They are NOT a quadrant map: do not make one panel per page or per scene. The 2x2 is four different camera views of the same coherent space, following the prompt's panel plan. "
      +"Aggregate architecture, fixtures, sightlines and action affordances only. Do NOT bake in scene-specific time of day, weather or progression (for example NIGHT/rain versus DAWN); those belong to each Slugline Unit or Time-of-Day Variant plate. "
      +"Never copy screenplay typography, page borders, text, captions or layout."
    : "";
  const gen = useImageGen({
    id: l.id, slotId: "locref-"+l.id,
    entity: locationRenderEntity(l),
    /* Clear cascades to this location's room & time, environment-state and extra-space plates so they
       aren't orphaned in storage (the confirm counts the ones that exist). */
    relatedClearLabel:"room, state or extra-space plate",
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
    /* a room's references are required — unless the parent's part is its one small material panel and the strip unticked
       it (2026-10-14); a failure reading the parent's part is never turned into a render without it (requiredReference) */
    attachmentsRequired:!!l.parentLocation&&!masterRefs.some(r=>r&&/^pm-/.test(String(r.refId))&&masterRefOff.indexOf(r.refId)>=0),
    attachmentsInSimple:true,
    referenceMaxDim:1536,
    attachments: async ()=>{
      requireLocationSpatialPlan(l);
      masterPlanSig.current=(typeof locationSpatialPlanSigFor==="function") ? locationSpatialPlanSigFor(l) : "";
      masterPanelRecord.current=(typeof locationPlatePanelRecord==="function") ? locationPlatePanelRecord(l) : null;
      masterLayoutSig.current=(typeof locationPlateLayoutSig==="function") ? locationPlateLayoutSig(l,{panels:true}) : "";
      /* A ROOM (2026-10-13, Location coordinates): the view of the space beyond each opening its panels see — numbered,
         so the prompt can say "match Image N"; (2026-10-14) single panels cut out of the parent's plate, never its whole
         sheet — or, none matched, one small material panel */
      let parentRefs;
      if(l.parentLocation&&typeof locationSubspacePlateReferences==="function"){
        let sub;
        try{ sub=await locationSubspacePlateReferences(l); }
        catch(e){ if(e&&typeof e==="object")e.requiredReference=true; throw e; }
        // an optional reference (the material panel) the strip unticked stays out (2026-10-14)
        masterSubPlan.current=sub.plan;parentRefs=sub.refs.filter(r=>r.required!==false||masterRefOff.indexOf(r.refId)<0);
      } else {
        masterSubPlan.current=null;
        parentRefs=mergeLocationReferences(await locationParentReferences(l),await locationSpatialReferences(l));
      }
      masterParentSnapshot.current=l.parentLocation
        ? locationAssetDependencySnapshot(locationParentOf(l).id,[],"subspace") : {};
      // the parent's cut-out panels (or the layout's plate) take the slots first; then whole scenes' pages in what is left (2026-10-14)
      const pages=buildMasterRefs().filter(r=>r.kind==="script"&&!r.required&&r.url&&masterRefOff.indexOf(r.refId)<0);
      return [...parentRefs,...(typeof locationWholeScenePages==="function"?locationWholeScenePages(pages,6-parentRefs.length):pages)].slice(0,6)
        .map(r=>({url:r.url,kind:r.kind==="script"?"script":"location",refId:r.refId,note:r.note,
          ...(r.maxDim?{maxDim:r.maxDim}:{}),...(r.numbered?{numbered:true}:{}),
          ...(r.kind==="script"&&r.sceneId!=null?{sceneId:r.sceneId}:{})}));   // its scene: the scenes left out go as text
    },
    /* once the final list is known: a room's views name their images by number (2026-10-13), the screenplay goes as
       its attached pages OR as text (a pointer to the pages), and the prompt fits its engine less the reference list
       that follows it (2026-10-14, the prompt budget) */
    rebuildPromptAfterAttachments:(attach,mode,gopts)=> mode==="final"
      ? combinedLocationPrompt(stagingDraftRef.current?{...l,staging:stagingDraftRef.current}:l,project,{
          ...(masterSubPlan.current?{panelPlan:masterSubPlan.current,panelRefs:locationReferenceNumbers(attach)}:{}),
          ..._locBudgetOpts(attach,gopts), reserve:masterAttachmentsText(attach).length+1})
      : null,
    attachmentsText: (refs)=> masterAttachmentsText(refs),
    metaExtra:async ({mode,prompt,url,iso})=>({
      specPrompt:locationCanonicalSpecPrompt(mode,prompt,finalPrompt,gen.genMeta),
      ...masterParentSnapshot.current,
      // made from the reviewed layout (not an edit): the layout stays reviewed — 2026-10-08
      ...(mode!=="edit" && masterPlanSig.current ? { spatialPlanSig:masterPlanSig.current } : {}),
      // the cameras its prompt stated (a fresh plate) or the ones the edited plate had (2026-10-13)
      ...(mode==="final"&&masterPanelRecord.current?{platePanels:masterPanelRecord.current}
        :mode==="edit"&&gen.genMeta&&gen.genMeta.platePanels?{platePanels:gen.genMeta.platePanels}:{}),
      // the layout (and cameras) it was made from — "Layout changed — regenerate" (step B); an edit keeps the old one
      ...(mode==="edit"?(gen.genMeta&&gen.genMeta.plateLayoutSig?{plateLayoutSig:gen.genMeta.plateLayoutSig}:{})
        :masterLayoutSig.current?{plateLayoutSig:masterLayoutSig.current}:{}),
      // the written spec it was made from ("Description changed" — an edit keeps the one it started from)
      locSpecSig: mode==="edit" ? (gen.genMeta && gen.genMeta.locSpecSig) : (typeof locationSpecSig==="function" ? locationSpecSig(l) : undefined),
      // the eye level it was drawn at (scale plan step 3, 2026-10-28) — an edit keeps the one it started from
      ...(mode==="edit" ? (gen.genMeta && gen.genMeta.drawnAt ? {drawnAt:gen.genMeta.drawnAt} : {})
        : (typeof locationDrawnAtMeta==="function" ? locationDrawnAtMeta(locationDrawnAtEntity(l)) : {})),
      // a sub-space's panels against its parent's plate, in the browser — free, never in the way of the save (2026-10-14)
      ...(l.parentLocation&&typeof locationCopyCheckMeta==="function"?await locationCopyCheckMeta(l,url,iso):{})
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
        window.appToast("Drafting the view composition first \u2014 the plate follows");
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
  // (2026-10-08) on an INT+EXT place the plate follows locationMasterPanelPlan — the hints say so
  const _panelPlan = (typeof locationMasterPanelPlan==="function") ? (()=>{ try{ return locationMasterPanelPlan(l, scenes, drafts); }catch(e){ return null; } })() : null;
  const _hintOf = (txt, dflt)=> txt ? String(txt).split(/\s+(?:\u2014|-|because)\s+|:/)[0].replace(/\s+/g," ").trim().toLowerCase().slice(0,48) : dflt;
  // a room's panels are its own planned cameras (2026-10-13)
  const _roomPanels = (l.parentLocation && typeof locationPanelPoses==="function") ? (()=>{ try{ return locationPanelPoses(l); }catch(e){ return null; } })() : null;
  const _roomHint = (i, dflt)=> _roomPanels && _roomPanels[i] ? _hintOf(_roomPanels[i].purpose, dflt) : dflt;
  const LOC_PANELS = [
    { grid:"TOP-LEFT",     label:"Top-left",     hint:_hintOf(_panelPlan&&_panelPlan.top_left, "wide establishing") },
    { grid:"TOP-RIGHT",    label:"Top-right",    hint:_hintOf(_panelPlan&&_panelPlan.top_right, "high overview") },
    { grid:"BOTTOM-LEFT",  label:"Bottom-left",  hint:_hintOf(_panelPlan&&_panelPlan.bottom_left, "close-up") },
    { grid:"BOTTOM-RIGHT", label:"Bottom-right", hint:_hintOf(_panelPlan&&_panelPlan.bottom_right, "close-up") },
  ];
  if(_roomPanels) LOC_PANELS.forEach((p,i)=>{ p.hint = _roomHint(i, p.hint); });
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
  // asked first, and its plate goes with it (2026-10-03, owner — it used to vanish on one click and
  // leave its image behind in storage)
  const removeVariant = async (vid)=>{
    const v = (l.variants||[]).find(x=>x.id===vid); if(!v) return;
    const assetId = (typeof locationAppearanceStateAssetId==="function") ? locationAppearanceStateAssetId(l,v,sluglineUnits||[]) : l.id+"-"+v.id;
    // what EXISTS, not what's cached (2026-10-08): a cold cache said "no plate yet" and left the image behind
    let has = (typeof nbGetImage==="function") && !!nbGetImage(assetId);
    if(!has && typeof nbLoadImage==="function"){ try{ has = !!(await nbLoadImage(assetId)); }catch(e){} }
    // a legacy state that resolves to a ROOM & TIME plate's slot shares that plate — never delete it with the state
    const sharesUnit = (typeof sluglineUnitImageId==="function") && (sluglineUnits||[]).some(u=> u && sluglineUnitImageId(u.key)===assetId);
    if(sharesUnit) has = false;
    const ok = !window.appConfirm || await window.appConfirm({
      title:"Remove this environment state?",
      body:sharesUnit ? "Only its notes go \u2014 its image is the room & time plate, which stays."
        : has ? "Its plate is deleted with it \u2014 this can't be undone." : "It has no plate yet, so only its notes go.",
      confirmLabel:"Remove", cancelLabel:"Cancel", danger:has });
    if(!ok) return;
    if(has && typeof nbClearAsset==="function"){ try{ await nbClearAsset(assetId); }catch(e){} }
    onUpdate(l.id,{ variants:(l.variants||[]).filter(x=>x.id!==vid) });
  };
  const saveCoverageViews = (next)=>{
    const list=(next||[]).map(v=>({...v,legacy:undefined}));
    onUpdate(l.id,{coverageViews:list,staging:list[0]&&list[0].staging||l.staging||{}});
  };
  const updateCoverageView = (vid,patch)=> saveCoverageViews(coverageViews.map(v=>v.id===vid?{...v,...patch}:v));
  const addCoverageView = ()=>{
    const id="view-"+Date.now().toString(36), base=(typeof emptyStaging==="function"?emptyStaging():{});
    const name="Camera view "+(coverageViews.length+1);
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

  // ONE NUMBERED PATH PER CARD (owner 2026-11-01): where each step stands, for the guide and the numbered folds
  // building the set is per room: a whole location without a room of its own on the floor plan has no 4 / 5
  const ownRoom=!!(((spatialState.plan.coordinates||{}).spaces||[]).some(s=>s.id===l.id&&(s.footprint||[]).length>=3));
  const cloudPilot=!!(ownRoom&&window.KinolotCloudRender&&window.KinolotCloudRender.enabled()&&window.LocationCloudRender);
  const cloudJob=useLocationCloudJob(l,cloudPilot);
  const cardSteps=locationCardSteps({l,drafted,spatialState,gen,cloudPilot,cloudJob});
  const stepCount=n=>{const st=cardSteps.find(x=>x.n===n);return !st?null:st.done?"\u2713 done":st.next?"next":st.optional?"optional":null;};
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
      menuExtra:[
        ...(gen.genUrl ? [{ label: panelEdit?"Close panel edit":"Edit a panel\u2026", placement:"beforeEdit",
          title:"Change just ONE view of the multi-angle plate, leaving the others untouched",
          onClick:()=> setPanelEdit(pe=> pe ? null : { idx:null, text:"" }) }] : []),
        // SAME PLACE, TWO NAMES (2026-10-14): merge with a card nothing points at (Fiorin Furnace and Furnace) — confirmed first
        ...(!readOnly && typeof onMergeLocations==="function" && (mergeChoices||[]).length ? [{ label:"Same place as\u2026", icon:Icon.layers,
          title:"This card and another one are the same place under two names \u2014 pick the other card, see what a merge keeps, and confirm. Nothing is generated or charged.",
          onClick:()=>setSamePick(p=> p ? null : { otherId:"" }) }] : [])],
      referenceControls: masterRefs.length>0 && React.createElement(CoverageReferenceStrip,{ refs:masterRefs, excludedIds:masterRefOff, onToggle:toggleMasterRef, onView }),
      generateRefs: masterGenerateRefs,
      generateDisabled:!spatialState.ready||!!l.parentLocation&&(!parentRefUrl||masterRefs.some(r=>r.required&&!r.ready&&!r.preview)),
      generateDisabledLabel:!spatialState.ready?"Review shared layout":"Generate parent plate first",
      onResolveGenerationBlock:!spatialState.ready?reviewLayout:undefined,
      generateDisabledTitle:!spatialState.ready?"Open the shared layout to review and confirm it. No image will be generated.":"Generate or restore the whole location's plate first so this room can match its visual design.",
      // say it when Generate also writes the layout first (a small writing charge on top of the plate)
      generateTitle:(!locStaged && !gen.slotHasRef && typeof aiAvailable==="function" && aiAvailable())
        ? "Writes this place's view composition first \u2014 a small writing charge \u2014 then generates the plate from it" : undefined,
      onDelete:()=>onDelete(l.id), deleteLabel:"Delete location" }),
    // a sub-space's plate that copies a panel of its parent's — said, never regenerated on its own (2026-10-14)
    l.parentLocation && React.createElement(LocationCopyCheckNotice,{ l, assetId:l.id, gen, readOnly,
      refs:()=>(typeof locationPlateRefCount==="function" ? locationPlateRefCount(l).n : undefined),
      disabled:!spatialState.ready||!parentRefUrl||masterRefs.some(r=>r.required&&!r.ready&&!r.preview),
      regenerateTitle:(!locStaged && !gen.slotHasRef && typeof aiAvailable==="function" && aiAvailable())
        ? "Writes this place's view composition first — a small writing charge — then makes a new plate (one image); this one stays in its version history" : undefined,
      onRegenerate:()=>genPlate.generate() }),
    // a small room that borrows its parent's plate (2026-10-27)
    l.parentLocation && React.createElement(LocationParentStyleNotice,{ l, gen, readOnly, onUpdate }),
    // SAME PLACE, TWO NAMES (2026-10-14): "These look like one place" on both cards, and the "Same place as…" picker
    (samePlace||[]).map(s=>React.createElement(LocationSamePlaceNotice,{ key:s.pair, l, s, readOnly,
      onMerge:onMergeLocations, onDecide:onPlaceDecision })),
    samePick && !readOnly && React.createElement(LocationSamePlacePicker,{ l, choices:mergeChoices||[], value:samePick.otherId,
      onChange:(v)=>setSamePick({ otherId:v }), onCancel:()=>setSamePick(null),
      onMerge:()=>{ const other = samePick.otherId; if(!other || typeof onMergeLocations!=="function") return; setSamePick(null); onMergeLocations(l.id, other, {}); } }),
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
            // DRAWN AT (scale plan step 3, 2026-10-28): whose eye level the plate is drawn from — what the plate
            // recorded once there is one, else what the next one will use; nothing at plain human eye level
            (typeof locationDrawnAtEntity==="function") && (()=>{
              const rec = gen.genUrl && gen.genMeta && gen.genMeta.drawnAt;
              const d = rec || locationDrawnAtMeta(locationDrawnAtEntity(l)).drawnAt;
              if(!d || d.human || !d.mm) return null;
              return React.createElement("span",{className:"loc-scale-badge","data-testid":"loc-drawn-at-badge",
                title:(rec?"This plate was drawn at ":"The next plate is drawn at ")+locationDrawnAtLabel(d)
                  +" — the eye level of whoever is in this place's scenes (Drawn at, below, changes it)."},
                "\ud83d\udc41 "+locationDrawnAtLabel(d)); })()
              || (typeof locationScaleClass==="function" && locationDrawnAtPick(l)!=="human") && (()=>{
              const cls = locationScaleClass(l, project||{});
              if(cls==="A") return null;
              const M = ({B:["\ud83d\udc01","Critter world"],C:["\ud83d\uddff","Giant world"],D:["\ud83d\udd2c","Microscopic world"]})[cls]||["",("Class "+cls)];
              return React.createElement("span",{className:"loc-scale-badge",
                title:M[1]+" (Class "+cls+") \u2014 derived automatically from the characters who drive this place's scenes. Plates here render at this scale."},
                M[0]+" "+cls); })(),
            React.createElement(EditText,{value:l.name,placeholder:"Location name\u2026",onCommit:val=>onUpdate(l.id,{name:val})}),
            // what this plate was made from has changed since (2026-10-08) — the plate stays until you regenerate it
            gen.genUrl && typeof locationSpecChanged==="function" && locationSpecChanged(gen.genMeta, l) && React.createElement("span",{className:"shot-source-badge stale",
              title:"This location's description or render style changed after the plate was made. The plate stays as it is until you regenerate it."},"Description changed"),
            gen.genUrl && typeof locationPlateLayoutChanged==="function" && locationPlateLayoutChanged(gen.genMeta, l, {panels:true}) && React.createElement("span",{className:"shot-source-badge stale",
              title:"The shared layout or this plate's cameras changed after the plate was made. Nothing regenerates on its own \u2014 regenerate it when you are ready."},"Layout changed \u2014 regenerate"),
            gen.genUrl && l.parentLocation && typeof locationDerivedPlateChanged==="function" && locationDerivedPlateChanged(gen.genMeta) && React.createElement("span",{className:"shot-source-badge stale",
              title:"The parent location's plate was regenerated after this plate was made from it. This plate stays as it is until you regenerate it."},"Parent plate changed")),
          l.parentLocation&&React.createElement("div",{className:"loc-parent-breadcrumb"},
            "within ",React.createElement("b",null,l.parentLocation.name)," \u00b7 inherits continuity"),
          null)),
      // where this card stands and what to do next (owner 2026-11-01: one numbered path per card)
      React.createElement(LocationStepGuide,{l,steps:cardSteps}),

      React.createElement("div",{className:"char-style-row"},
        React.createElement("span",{className:"char-style-lab"},"Render style"),
        React.createElement("div",{className:"char-style-pick"},
          React.createElement(window.RenderStylePicker,{context:"location",value:styleKey,disabled:styling,onPick:pickLocStyle}),
          (window.turnCanLockStyles && window.turnCanLockStyles()) && React.createElement("span",{className:"char-style-count"+(((window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)>=(window.turnGlobalStyleCap||40))?" full":""),title:"Global render styles ("+(window.turnGlobalStyleCap||40)+" max, admin-managed). You can save up to "+(window.turnPersonalStyleCap||10)+" personal render styles. The admin manages them via Styles in the Film menu."}, (window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)+"/"+(window.turnGlobalStyleCap||40))),
        styling && React.createElement("span",{className:"char-style-busy"},React.createElement("span",{className:"ns-spin"}),"Inventing\u2026"),
        (!inheritsStyle && !styling && l.renderStyleKey==="surprise" && l.surpriseRender && l.surpriseRender.label) &&
          React.createElement("span",{className:"char-style-name",title:"Re-roll a new surprise style \u2014 one small writing call (writing credits)",onClick:()=>rollSurprise()},
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

      React.createElement(CardFold,{label:"1 \u00b7 Describe the place",foldId:locationStepFoldId(l,1),count:stepCount(1),defaultOpen:(!drafted && !!l.manual)},
        React.createElement("div",{className:"loc-step-actions"},
          React.createElement("button",{className:"char-draft-btn"+(drafting?" busy":""),disabled:drafting,onClick:()=>onDraft(l),
            title:"Draft the written description of this place. Where its objects stand comes next, in 2 \u00b7 Floor plan."},
            React.createElement(Icon.sparkles,{s:12}), drafting?"Drafting\u2026":"Draft specification")),
        React.createElement("h4",{className:"loc-step-sub"},"The space"),
        React.createElement(LocationSectionHelp,{
          label:"About The Space",
          text:"Defines the persistent physical location: architecture, layout, materials, fixed features, geography, entrances and exits. This is the location's identity."}),
        l.parentLocation && React.createElement("div",{className:"loc-inheritance-note"},
          React.createElement(Icon.layers,{s:12}),
          React.createElement("span",null,"Inherited from ",React.createElement("b",null,l.parentLocation.name),": shared architecture, material language, scale, topology and locked anchors. Store only what is specific to ",l.name||"this child"," below.")),
        React.createElement("div",{className:"sheet-field"},
          React.createElement("div",{className:"obj-lab"},"Screenplay sides"),
          React.createElement("select",{className:"prop-select",value:l.intExt||"INT",
            title:"Which sides of this place the screenplay shows \u2014 your pick stays even when the script changes",
            onChange:e=>onUpdate(l.id,{intExt:e.target.value, intExtLocked:true})},
            [["INT","INT"],["EXT","EXT"],["INT/EXT","INT+EXT"]].map(o=>React.createElement("option",{key:o[0],value:o[0]},o[1])))),
        React.createElement(LocationIdentityField,{l,field:"architecture",label:"Architecture & layout",value:l.architecture,
          placeholder:"The space's layout, scale, structure and defining built features\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"materials",label:"Materials & palette",value:l.materials,
          placeholder:"Permanent surfaces, colours, textures and wear\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"lighting",label:"Permanent lighting & daylight interfaces",value:l.lighting,
          placeholder:"Fixtures, windows and orientation only \u2014 changing conditions belong to each room & time's Lighting & environment\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"permanentDressing",label:"Permanent / baseline dressing",value:l.permanentDressing||"",
          placeholder:"Furniture and fixtures that remain part of the place\u2026",onUpdate}),
        React.createElement(LocationIdentityField,{l,field:"topology",label:"How the rooms connect",value:l.topology||"",
          placeholder:"Living Room \u2194 Kitchen: cased archway; Kitchen \u2192 Rear Yard: window over sink\u2026",onUpdate}),
        // TRUE SIZES (2026-10-28): what everything else in the place is measured against
        React.createElement(LocationIdentityField,{l,field:"keySizes",label:"Sizes of key features",value:l.keySizes||"",
          placeholder:"With units: oak trunks about 1 m across and 20 m tall; the doorway 2 m high; raindrops about 4 mm\u2026",onUpdate}),
        // DRAWN AT (scale plan step 3, 2026-10-28): whose eye level this place is drawn from — only in a film whose
        // cast isn't all human-sized. A room follows its place unless it picks its own.
        (()=>{
          const chars = ((window.turnContinuity||{}).characters||[]).filter(c=>c && c.id && typeof heightMMOf==="function" && heightMMOf(c)>0
            && typeof scaleClassOf==="function" && scaleClassOf(c)!=="A");
          if(!chars.length && !l.drawnAt) return null;
          return React.createElement("div",{className:"sheet-field"},
            React.createElement("div",{className:"obj-lab"},"Drawn at"),
            React.createElement("select",{className:"prop-select","data-testid":"loc-drawn-at",value:l.drawnAt||"",
              title:"Whose eye level this place's plates are drawn from. Automatic: the point of view most of its scenes share; a room & time plate follows its own scenes, so human scenes here still get a human-scale plate.",
              onChange:e=>onUpdate(l.id,{drawnAt:e.target.value})},
              [["",l.parentLocation?"Same as "+(l.parentLocation.name||"its place"):"Automatic \u2014 whoever is in its scenes"],["human","Human eye level"]]
                .concat(chars.map(c=>[c.id, (c.name||"Character")+"'s eye level"]))
                .map(o=>React.createElement("option",{key:o[0],value:o[0]},o[1]))));
        })(),
        React.createElement("div",{className:"loc-anchor-field"},
          React.createElement("div",{className:"loc-anchor-head"},
            React.createElement("span",{className:"loc-field-label"},
              React.createElement("span",null,"Fixed landmarks"),
              React.createElement(LocationProvenanceSelect,{l,field:"continuityAnchors",label:"Fixed landmarks",onUpdate})),
            React.createElement("button",{className:"loc-anchor-lock"+(l.anchorsLocked===false?"":" locked"),
              title:l.anchorsLocked===false?"Make these anchors binding for generation":"Binding: these facts cannot drift across representations",
              onClick:()=>onUpdate(l.id,{anchorsLocked:l.anchorsLocked===false})},l.anchorsLocked===false?"\ud83d\udd13 Editable":"\ud83d\udd12 Binding")),
          React.createElement(EditText,{value:l.continuityAnchors||"",multiline:true,
            placeholder:"Low ceiling; cased kitchen archway; three-pane front door; sink-window geometry\u2026",
            onCommit:val=>onUpdate(l.id,{continuityAnchors:val})})),

      React.createElement(CardFold,{label:"Narrative significance",defaultOpen:false},
        React.createElement(LocationSectionHelp,{
          label:"About Narrative Significance",
          text:"Explains what the location means dramatically: how it functions in the story, its mood and thematic role, and each character's relationship to the space."}),
        React.createElement(SheetField,{label:"Narrative function \u2014 interpretive guidance",value:l.significance,multiline:true,
          placeholder:"Its dramatic role \u2014 what happens here, what it represents\u2026",onCommit:val=>onUpdate(l.id,{significance:val})})),

      React.createElement(CardFold,{label:"Screenplay evidence",defaultOpen:false},
        React.createElement(LocationScreenplayEvidence,{units:evidenceUnits,onScene:onChipClick})),

      // the settings that change the plate live ON the card (2026-10-05); the prompt itself is read-only
      React.createElement(CardFold,{label:"Look & exclusions",defaultOpen:false},
        React.createElement("div",{className:"loc-render-style-details"},
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
        React.createElement(SheetField,{label:"Leave out \u2014 what the plate must not show (negative prompt)",value:l.negativePrompt||d.negativePrompt,multiline:true,
          onCommit:val=>onUpdate(l.id,{negativePrompt:val})})),
      ),

      React.createElement(CardFold,{label:"2 \u00b7 Floor plan",foldId:layoutFoldId,defaultOpen:initialSection==="layout",
        count:stepCount(2)||(!spatialState.ready?"layout needs review":locStaged?((typeof locationStagingLayoutChanged==="function"&&locationStagingLayoutChanged(l))?"layout changed":null):(stagingPrep?"staging\u2026":"drafts on first render"))},
        React.createElement(LocationSpatialPlanEditor,{l,scenes,project,onUpdate,readOnly,reviewRequest:layoutReviewRequest,onReturnToImage:returnToImage}),
        React.createElement(LocationRoomLinks,{entries:roomLocations.map(owner=>({owner,key:owner.id,
          label:owner.name,detail:"Open room layout and staging"})),onSelectLocation,section:"layout"}),
      ),

      React.createElement(CardFold,{label:"3 \u00b7 Cameras",foldId:locationStepFoldId(l,3),count:stepCount(3)},
        React.createElement(LocationPlateCameras,{l,project,onUpdate,readOnly,plateMeta:gen.genUrl?gen.genMeta:null}),
        React.createElement(CoverageViewsEditor,{l,views:coverageViews,onUpdateView:updateCoverageView,
          onAdd:addCoverageView,onRemove:removeCoverageView,onDraftStaging,draftingStage}),
      ),

      // the cloud set pilot: build the set in 3D, then style it (owner-only, local development)
      cloudPilot&&React.createElement(CardFold,{label:"4 \u00b7 Build the set",foldId:locationStepFoldId(l,4),count:stepCount(4)},
        React.createElement(window.LocationCloudRender,{location:l,readOnly})),
      cloudPilot&&React.createElement(CardFold,{label:"5 \u00b7 Style it",foldId:locationStepFoldId(l,5),count:stepCount(5)},
        React.createElement(window.LocationStyleStep,{location:l,readOnly})),

      // foldId: a shot's missing room & time view opens this fold from the Shots tab (2026-10-20)
      React.createElement(CardFold,{label:"Rooms & times",foldId:"loc-units-"+l.id,defaultOpen:initialSection==="units"||initialSection==="environments"},
        React.createElement("div",{className:"loc-variants"},
          units.length
            ? environment.units.map(u=>React.createElement(SluglineUnitCard,{key:u.key, l, u, project, scenes, drafts,
                parentGenUrl:gen.genUrl, onRemoveUnit, onView, readOnly,
                onEnvironmentChange:state=>saveLocationUnitEnvironment(l,u,appearanceStates,state,onUpdateUnit,onUpdate)}))
            : !roomUnits.length&&React.createElement("div",{className:"loc-variants-empty"},"No authored or screenplay-derived slugline unit currently addresses this location."),
          React.createElement(LocationRoomLinks,{entries:roomUnits,onSelectLocation,section:"units"}),
          React.createElement("details",{className:"loc-nested-section",open:initialSection==="environments"?true:undefined},
            React.createElement("summary",null,"Additional environment states"),
            React.createElement("p",{className:"loc-layer-note"},"Only for another look not already represented by a room & time, such as a storm or power outage. Scripted Night / Dawn changes are edited in each room & time's Lighting & environment."),
            environment.additional.map(v=>React.createElement(LocationVariant,{key:v.id,l,v,project,scenes,drafts,units,readOnly,
              parentGenUrl:gen.genUrl,onTime:time=>updateVariant(v.id,{time}),
              onState:state=>updateVariant(v.id,{state}),onRemove:()=>removeVariant(v.id),onView})),
            React.createElement(LocationRoomLinks,{entries:roomStates,onSelectLocation,section:"environments"}),
            React.createElement("button",{className:"art-draftall ghost loc-variant-add",onClick:addVariant},
              React.createElement(Icon.plus,{s:14}),"Add environment state")),
          !l.parentLocation&&coverageSheets.length>0&&React.createElement("details",{className:"loc-nested-section"},
            React.createElement("summary",null,"Extra spaces"),
            React.createElement("p",{className:"loc-layer-note"},"Extra empty-set references required by the screenplay, such as an exterior, threshold or connecting space."),
            coverageSheets.map((v,i)=>React.createElement(LocationCoverageSheet,{key:v.id,l,v,project,scenes,drafts,
              previousSheets:coverageSheets.slice(0,i),parentGenUrl:gen.genUrl,onView}))))),

      // parts of the set the screenplay moves, and when (owner 2026-11-01)
      React.createElement(CardFold,{label:"Moving parts",foldId:"loc-parts-"+l.id,defaultOpen:false,
          count:(Array.isArray(l.movingParts)&&l.movingParts.length)||undefined},
        React.createElement(LocationMovingParts,{l,scenes,drafts,onUpdate,readOnly})),

      // reference and tools, after the steps
      React.createElement(CardFold,{label:"More",foldId:"loc-more-"+l.id,defaultOpen:false},
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
            label:"Room & time · "+(u.name||l.name||"Location")+(u.time?(" · "+u.time):""),kind:"location"})),
          ...coverageSheets.map(v=>({entityId:l.id+"-"+v.id,label:"Extra space · "+(v.name||l.name||"Location"),kind:"location"})),
          ...appearanceStates.map(v=>({entityId:(typeof locationAppearanceStateAssetId==="function"
              ? locationAppearanceStateAssetId(l,v,units):l.id+"-"+v.id),
            label:"Time-of-Day Variant · "+(v.time||v.id||"Variant"),kind:"location"}))],
        readOnly}),
        window.QaCheckButton && React.createElement("div",{className:"loc-step-actions"},
          React.createElement(window.QaCheckButton,{ gen, name:l.name, noun:"location plate",
            specFields:()=>({ architecture:(l.architecture||""), materials:(l.materials||""), lighting:(l.lighting||"") }),
            onApplySpec:(patch)=>onUpdate(l.id, patch) })),
      // read-only, a folded section of every card (owner 2026-10-28 — it used to hide behind the ⋯ menu or the Film
      // menu's "Always show prompts")
      React.createElement(CardFold,{label:"Generation Prompt",defaultOpen:false},
        React.createElement(CopyBox,{label:"Current specification \u2014 next generation",text:finalPrompt}),
        React.createElement("p",{className:"loc-layer-note"},"Built from this space's current specification. Selected reference instructions are added when you generate."),
        gen.genUrl&&gen.genMeta&&gen.genMeta.prompt&&React.createElement("details",{className:"loc-nested-section"},
          React.createElement("summary",null,"Prompt used for the current plate"),
          React.createElement(CopyBox,{label:"Saved generation prompt",text:gen.genMeta.prompt}))))));
}

/* ONE NUMBERED PATH PER LOCATION CARD (owner 2026-11-01 — "make it simpler … numbers … which item to generate first"):
   1 Describe · 2 Floor plan · 3 Cameras · 4 Build the set · 5 Style it (cloud set pilot only) · 6 Location image. Each
   step says whether it is done, and the first that isn't is "next", with what to do there. */
function useLocationCloudJob(l,on){
  const [,tick]=React.useReducer(n=>n+1,0);
  React.useEffect(()=>{if(!on)return;const h=e=>{if(!e||!e.detail||e.detail.locationId===l.id)tick();};
    window.addEventListener("kinolot-cloud-job",h);return ()=>window.removeEventListener("kinolot-cloud-job",h);},[on,l.id]);
  // the build step reports its job; until it has been opened, read the latest one once
  React.useEffect(()=>{
    if(!on)return;const api=window.KinolotCloudRender;if(api.jobState(l.id))return;
    let alive=true;
    (async()=>{try{
      const s=window.BlenderPreview.scope();
      const r=await api.request("job.latest",{projectId:s.projectId,locationId:l.id},s);if(!alive||api.jobState(l.id))return;
      let current=false;
      if(r.job&&r.job.status==="completed"){try{current=r.job.sceneHash===await window.KinolotRenderContract.hash(window.KinolotRenderContract.canonical(api.buildScene(l)));}catch(_){current=false;}}
      api.noteJob(l.id,r.job?{status:r.job.status,current}:{status:"none",current:false});
    }catch(_){}})();
    return ()=>{alive=false;};
  },[on,l.id]);
  return on?window.KinolotCloudRender.jobState(l.id):null;
}
function locationCardSteps({l,drafted,spatialState,gen,cloudPilot,cloudJob}){
  let problems={},labels={};
  try{
    problems=spatialState.ready&&window.KinolotCloudRender?window.KinolotCloudRender.cameraProblems(l):{};
    labels=Object.fromEntries(locationPanelPoses(l).map(p=>[p.key,p.label||p.key]));
  }catch(_){problems={};}
  const camKey=Object.keys(problems)[0];
  const imageStale=!!gen.genUrl&&((typeof locationSpecChanged==="function"&&locationSpecChanged(gen.genMeta,l))
    ||(typeof locationPlateLayoutChanged==="function"&&locationPlateLayoutChanged(gen.genMeta,l,{panels:true})));
  const steps=[
    {n:1,name:"Describe",done:!!drafted,todo:"Draft the description: architecture, materials, light and landmarks."},
    {n:2,name:"Floor plan",done:!!spatialState.ready,todo:spatialState.reason||"Check the floor plan and confirm it."},
    {n:3,name:"Cameras",done:!!spatialState.ready&&!camKey,
      todo:!spatialState.ready?"Confirm the floor plan first.":camKey?"The "+labels[camKey]+" camera: "+problems[camKey].charAt(0).toLowerCase()+problems[camKey].slice(1):""},
    ...(cloudPilot?[
      {n:4,name:"Build the set",done:!!(cloudJob&&cloudJob.current),
        todo:cloudJob&&["queued","running"].includes(cloudJob.status)?"The set is building.":cloudJob&&cloudJob.status==="completed"?"Rebuild the set: the floor plan or cameras changed.":"Build the set in 3D from the floor plan."},
      {n:5,name:"Style it",optional:true,done:false,todo:"Optional: try materials and light over the built set."}]:[]),
    {n:6,name:"Location image",done:!!gen.genUrl&&!imageStale,
      todo:gen.genUrl?"Regenerate the image: the description or layout changed since it was made.":"Generate the location image at the top of the card."}];
  const next=steps.find(x=>!x.done&&!x.optional);if(next)next.next=true;
  return steps;
}
function LocationStepGuide({l,steps}){
  const ref=React.useRef(null);
  const go=n=>{
    if(n===6){const card=ref.current&&ref.current.closest("[data-location-card]");if(card)try{card.scrollIntoView({behavior:"smooth",block:"start"});}catch(_){}return;}
    window.dispatchEvent(new CustomEvent("nb-open-fold",{detail:locationStepFoldId(l,n)}));
  };
  const next=steps.find(x=>x.next),E=React.createElement;
  return E("div",{className:"loc-steps",ref,"data-testid":"location-step-guide"},
    next?E("div",{className:"loc-steps-next"},
      E("span",{className:"loc-steps-next-label"},"Next"),
      E("span",{className:"loc-steps-next-text"},E("b",null,next.n+" \u00b7 "+next.name+" \u2014 "),next.todo),
      E("button",{type:"button",className:"art-draftall loc-step-go",onClick:()=>go(next.n)},"Go")
    ):E("div",{className:"loc-steps-next done"},E("span",{className:"loc-steps-next-text"},"Every step is done.")),
    E("ol",{className:"loc-steps-list","aria-label":"Steps for this location"},steps.map(st=>E("li",{key:st.n},
      E("button",{type:"button",className:"loc-step"+(st.done?" done":st.next?" next":""),onClick:()=>go(st.n),
        title:(st.done?"Done":st.optional?"Optional":st.next?"Next":"Later")+(st.todo&&!st.done?" \u2014 "+st.todo:"")},
        E("span",{className:"loc-step-n"},st.done?"\u2713":st.n),E("span",{className:"loc-step-name"},st.name))))));
}

/* Camera-relative composition, not a measured room plan. The visual editor
   keeps the existing depth-grid fields used by generation and Blender. */
function CoverageViewsEditor({l,views,onUpdateView,onAdd,onRemove,onDraftStaging,draftingStage}){
  const list=Array.isArray(views)?views:[];
  return React.createElement("div",{className:"loc-coverage-views"},
    React.createElement("div",{className:"loc-layer-note"},
      "What the plate's main view (its top-left panel) shows, from far away to close to the lens. Click a box to change what's there."),
    list.map((v,index)=>React.createElement("div",{className:"loc-variant loc-camera-view",key:v.id},
      React.createElement("div",{className:"loc-variant-head"},
        React.createElement("div",{className:"loc-camera-view-title"},
          index===0&&React.createElement("span",{className:"loc-primary-badge"},"Main view"),
          v.panel&&typeof LOC_PANEL_INFO!=="undefined"&&LOC_PANEL_INFO[v.panel]&&React.createElement("span",{className:"loc-primary-badge loc-panel-badge",
            title:"This camera makes the "+LOC_PANEL_INFO[v.panel].label.toLowerCase()+" panel of the plate (Plate cameras)"},"Plate · "+LOC_PANEL_INFO[v.panel].label.toLowerCase()),
          React.createElement(EditText,{value:v.name||"",placeholder:"Named camera view",
            onCommit:name=>onUpdateView(v.id,{name,staging:{...(v.staging||{}),viewLabel:name}})})),
        list.length>1&&React.createElement("button",{className:"loc-variant-x",title:"Remove camera view",
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
        React.createElement(SheetField,{label:"Visible fixed landmarks",value:v.visibleAnchors||"",multiline:true,
          placeholder:"Cased archway, sink window, three-pane front door\u2026",
          onCommit:visibleAnchors=>onUpdateView(v.id,{visibleAnchors})}))}))),
    React.createElement("button",{className:"art-draftall ghost loc-variant-add",onClick:onAdd},
      React.createElement(Icon.plus,{s:14}),"Add camera view"));
}
function StagingGrid({ l, onUpdate, onDraftStaging, draftingStage, value, onChange, lockViewLabel=false, cameraPosition="",target="",viewDetails }){
  const source=value?{...l,staging:value}:l;
  const s = (typeof stagingOf==="function") ? stagingOf(source) : (source.staging||{bg:{},mid:{},fg:{}});
  const [selected,setSelected]=React.useState({plane:"bg",col:"center"});
  const planes=[{key:"bg",label:"Far",term:"Background"},{key:"mid",label:"Middle",term:"Midground"},{key:"fg",label:"Near",term:"Foreground"}];
  const columns=[{key:"left",label:"Left"},{key:"center",label:"Centre"},{key:"right",label:"Right"}];
  const isFloor=selected.key==="floor";
  const plane=planes.find(p=>p.key===selected.plane), col=columns.find(c=>c.key===selected.col);
  /* THE LAYOUT FIRST (2026-10-12): the draft waits for the shared layout (drafting, waiting to be confirmed, or
     not ready — the plate's own reason); hand edits stay open. A composition drafted from a layout that has
     changed since says so (plates still render). */
  const [,refreshLayoutGate]=React.useReducer(n=>n+1,0);
  React.useEffect(()=>{
    if(!onDraftStaging)return;
    const h=()=>refreshLayoutGate();
    window.addEventListener("loc-layout-draft-pending",h);window.addEventListener("nb-gen-done",h);
    return ()=>{window.removeEventListener("loc-layout-draft-pending",h);window.removeEventListener("nb-gen-done",h);};
  },[!!onDraftStaging]);
  const draftBlock=(onDraftStaging&&!draftingStage&&typeof locationStagingDraftBlock==="function")?locationStagingDraftBlock(l):"";
  const layoutChanged=!!(onDraftStaging&&typeof locationStagingLayoutChanged==="function"&&locationStagingLayoutChanged(l));
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
      React.createElement("span",{className:"stage-map-title"},"Main view \u00b7 far, middle, near"),
      onDraftStaging && React.createElement("button",{className:"art-draftall",disabled:draftingStage||!!draftBlock,onClick:()=>onDraftStaging(l),
        title:draftBlock||"Draft this view's composition from the script (writing credits) \u2014 asks first when one is already written, because it replaces it"},
        React.createElement(Icon.sparkles,{s:14}), draftingStage?"Drafting\u2026":"Draft view composition")),
    draftBlock&&React.createElement("p",{className:"loc-layer-note stage-draft-wait",role:"status"},draftBlock),
    layoutChanged&&React.createElement("p",{className:"loc-layer-note stage-layout-changed",role:"status"},"Layout changed \u2014 re-draft view composition"),
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
    React.createElement("p",{className:"stage-map-disclaimer"},"Left and right here are the picture's left and right. Where things really stand is the floor plan."),
    // which panel this is, and a composition drafted for another space (2026-10-27)
    (()=>{ const tl = (typeof locationRequestedViews==="function") ? ((locationRequestedViews(l)||[]).find(v=>v && v.key==="TL")||{}).purpose : "";
      if(!tl) return null;
      // the room each names, of this place's rooms (Marmorica: the composition's Upper Deck vs the panel's CAR Deck)
      const key = (x)=> (typeof _locNameKey==="function") ? " "+_locNameKey(x||"")+" " : "";
      const rooms = (typeof locationChildrenOf==="function" ? (locationChildrenOf(l, ((window.turnContinuity||{}).locations)||[])||[]) : []).map(c=>c && c.name).filter(Boolean);
      const roomIn = (x)=>{ const k = key(x); return rooms.filter(n=>k.indexOf(key(n))>=0).sort((a,b)=>b.length-a.length)[0] || ""; };
      const vRoom = roomIn(s.viewLabel), tRoom = roomIn(tl);
      const other = !!(s.viewLabel && vRoom && tRoom && vRoom!==tRoom);
      return React.createElement("p",{className:"loc-layer-note stage-main-panel"+(other?" stage-layout-changed":""),role:other?"status":undefined},
        "The plate's top-left panel: "+String(tl).replace(/\s+\u2014.*$/,"").slice(0,140)+"."
        +(other ? " This composition was drafted for \u201c"+vRoom+"\u201d \u2014 re-draft it so the two match." : "")); })(),
    React.createElement("div",{className:"stage-zone-editor",key:isFloor?"floor":selected.plane+"-"+selected.col},
      React.createElement("div",{className:"stage-zone-editor-head"},React.createElement("b",null,selectedLabel),
        React.createElement("span",null,isFloor?"Surface underfoot":plane.term)),
      React.createElement("label",null,React.createElement("span",{className:"stage-editor-label"},"What belongs here?"),
        React.createElement(EditText,{value:selectedValue||"",multiline:true,
          placeholder:isFloor?"Ground material and texture\u2026":"Describe a fixed landmark or framing element. Leave empty for open space.",
          onCommit:val=>set(isFloor?{key:"floor",val}:{plane:selected.plane,col:selected.col,val})}))),
    React.createElement("details",{className:"loc-nested-section stage-view-details"},
      React.createElement("summary",null,"Lens, scale and camera notes"),
      viewDetails,
      React.createElement("div",{className:"stage-meta-fields"},
        !lockViewLabel&&React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Camera view / representation"),
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
/* the parent snapshot taken when THIS run attached its references, used once (a later run takes its own) */
/* the screenplay text a plate was made from, as a short signature (2026-10-18, owner — "Redraft script from
   beats" review): a plate made from a scene's pages or a unit's script text says "Script changed" once a redraft
   changes that text; nothing regenerates on its own */
function _plateScriptSig(text){
  const str = String(text||"").replace(/\s+/g," ").trim();
  if(!str) return "";
  let h = 5381; for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0;
  return "ps1:"+(h>>>0).toString(36)+":"+str.length;
}
function _draftScriptText(draft){ return ((draft&&draft.blocks)||[]).map(b=>(b&&b.type||"")+":"+(b&&b.text||"")).join("\n"); }
function _parentChangedBadge(gen, l, scriptSig){
  // the screenplay text it was made from changed (only plates that recorded it)
  const script = (gen && gen.genUrl && gen.genMeta && gen.genMeta.plateScriptSig && scriptSig && gen.genMeta.plateScriptSig!==scriptSig)
    ? React.createElement("span",{key:"script",className:"shot-source-badge stale",
        title:"The screenplay this plate was made from was redrafted afterwards. The plate stays as it is until you regenerate it \u2014 check it still fits the scene."},"Script changed")
    : null;
  const parent = (gen && gen.genUrl && typeof locationDerivedPlateChanged==="function" && locationDerivedPlateChanged(gen.genMeta))
    ? React.createElement("span",{key:"parent",className:"shot-source-badge stale",
        title:"The location plate this was made from was regenerated afterwards. This plate stays as it is until you regenerate it."},"Parent plate changed")
    : null;
  // (step B, 2026-10-13) the shared layout it was made from changed — said, never regenerated on its own
  const layout = (gen && gen.genUrl && l && typeof locationPlateLayoutChanged==="function" && locationPlateLayoutChanged(gen.genMeta, l))
    ? React.createElement("span",{key:"layout",className:"shot-source-badge stale",
        title:"The shared layout changed after this plate was made. Nothing regenerates on its own \u2014 regenerate it when you are ready."},"Layout changed \u2014 regenerate")
    : null;
  return parent||layout||script ? React.createElement(React.Fragment,null,script,parent,layout) : null;
}
/* the layout stamp a single-frame plate records (an edit keeps the one it was made with) */
function _withLayoutStamp(l, mode, gen, meta, scriptSig){
  const sig = mode==="edit" ? (gen && gen.genMeta && gen.genMeta.plateLayoutSig)
    : (typeof locationPlateLayoutSig==="function" ? locationPlateLayoutSig(l) : "");
  const ss = mode==="edit" ? (gen && gen.genMeta && gen.genMeta.plateScriptSig) : scriptSig;
  const out = sig ? {...(meta||{}), plateLayoutSig:sig} : meta;
  return ss ? {...(out||{}), plateScriptSig:ss} : out;
}
function _takeDepSnap(ref){ const x = ref && ref.current; if(ref) ref.current = null; return x; }
/* the size a location card sends its screenplay pages at (locations.jsx LOC_SCREENPLAY_PAGE_MAX_DIM, 2026-10-14): their
   own size, never shrunk — every other reference keeps its card's size */
function _locPageMaxDim(){ return Number(window.LOC_SCREENPLAY_PAGE_MAX_DIM)||1536; }
/* a sub-space's single-frame plate (room & time, environment state — a sub-space has no extra-space plates): its copy
   check against the parent's plate, read before the save and recorded with it (2026-10-14 — locations.jsx "THE COPY
   CHECK") */
async function _withCopyCheck(l, url, iso, meta){
  if(!(l && l.parentLocation) || typeof locationCopyCheckMeta!=="function") return meta;
  return {...(meta||{}), ...(await locationCopyCheckMeta(l, url, iso, {single:true}))};
}
/* THE COPY CHECK'S NOTICE (2026-10-14, owner — "go ahead with all of it"; the maths: locations.jsx "THE COPY CHECK").
   A sub-space plate's panel that is a near-copy of a panel of its parent's plate says "This panel looks like <parent>'s
   sheet — regenerate?" with Regenerate (its price) and Keep. Nothing happens on its own: the check is free and runs in
   this browser, Regenerate is the viewer's click, Keep only hides the notice for this plate version (recorded on its
   meta). A plate saved without a check (made before it, or the check couldn't run) is checked here once a session. */
const _locCopySession = new Map();
function _locCopyRun(key, url, parentId, single){
  if(_locCopySession.has(key)) return _locCopySession.get(key).promise;
  const entry = { result:undefined };
  entry.promise = (async ()=>{
    let parentUrl = "";
    try{ parentUrl = (typeof nbGetImage==="function" ? nbGetImage(parentId) : "")
      || (typeof nbLoadImage==="function" ? await nbLoadImage(parentId) : ""); }catch(e){}
    let r = null;
    try{ r = parentUrl && typeof locationCopyCheck==="function" ? await locationCopyCheck(url, parentUrl, {single}) : null; }catch(e){}
    entry.result = r || null;
    // a check that couldn't read an image isn't kept: the card tries again the next time it is shown
    if(!r && _locCopySession.get(key)===entry) _locCopySession.delete(key);
    return entry.result;
  })();
  _locCopySession.set(key, entry);
  return entry.promise;
}
/* disabled: the card's own Generate is unavailable (its layout, the parent's plate, a room & time no longer in the
   script) — Regenerate waits too; regenerateTitle: what Regenerate does when it is more than one image */
function LocationCopyCheckNotice({ l, assetId, gen, single=false, refs, readOnly=false, disabled=false, regenerateTitle, onRegenerate }){
  const parent = l && l.parentLocation;
  const [,bump] = React.useReducer(n=>n+1,0);
  const [kept,setKept] = React.useState("");
  const url = gen && gen.genUrl, meta = gen && gen.genMeta;
  const parentMeta = parent && parent.id && typeof nbGetMeta==="function" ? nbGetMeta(parent.id) : null;
  const key = parent && assetId && url && meta && meta.iso && parentMeta && parentMeta.iso
    ? [assetId, meta.iso, parentMeta.iso, single ? "1" : "4"].join("|") : "";
  const recorded = key && typeof locationCopyCheckCurrent==="function" ? locationCopyCheckCurrent(meta, parentMeta) : null;
  // the parent's plate (or this one) changes or loads → read again
  React.useEffect(()=>{
    if(!parent) return;
    const h = (e)=>{ const id = e && e.detail && e.detail.id; if(!id || id===parent.id || id===assetId) bump(); };
    window.addEventListener("nb-gen-done",h); window.addEventListener("nb-prefetched",h);
    return ()=>{ window.removeEventListener("nb-gen-done",h); window.removeEventListener("nb-prefetched",h); };
  },[parent&&parent.id, assetId]);
  React.useEffect(()=>{
    if(!key || recorded) return;
    let alive = true;
    _locCopyRun(key, url, parent.id, single).then(()=>{ if(alive) bump(); });
    return ()=>{ alive = false; };
  },[key, !!recorded]);
  if(!key) return null;
  const check = recorded || (_locCopySession.get(key)||{}).result;
  if(!check || !check.near || check.kept || kept===key) return null;
  const name = parent.name || "the parent location";
  const near = (check.panels||[]).filter(p=>p && p.near);
  const label = (k)=> (typeof LOC_PANEL_INFO!=="undefined" && LOC_PANEL_INFO[k]) ? LOC_PANEL_INFO[k].label : "";
  const th = typeof LOC_COPY_CHECK!=="undefined" ? LOC_COPY_CHECK : { detail:0.6, layout:0.62 };
  const why = (p)=> "Compared in your browser, free: "+(single ? "this plate" : "its "+label(p.key).toLowerCase()+" panel")
    +" is a near-copy of the "+label(p.match).toLowerCase()+" panel of "+name+"'s plate (detail "+p.detail+", layout "+p.layout
    +" — a near-copy scores at least "+th.detail+" and "+th.layout+"). Nothing changes unless you regenerate.";
  const keep = async ()=>{
    setKept(key);
    if(typeof nbSetAssetCopyCheck==="function"){
      try{ await nbSetAssetCopyCheck(assetId, meta.iso, { ...check, iso:meta.iso, parentId:parent.id, parentIso:parentMeta.iso, kept:true }); }catch(e){}
    }
  };
  const n = typeof refs==="function" ? refs() : refs;
  // the card's own Generate rules: never while it runs, while an unsaved image waits for its save, or while blocked
  const regenOff = !!(gen && (gen.gening || gen.pendingSave)) || !!disabled || typeof onRegenerate!=="function";
  return React.createElement("div",{className:"loc-copy-check",role:"status","data-copy-check":assetId},
    React.createElement(Icon.alert,{s:12}),
    React.createElement("div",{className:"loc-copy-check-body"},
      near.map(p=>React.createElement("p",{key:p.key,title:why(p)},
        single ? null : React.createElement("b",null,label(p.key)+": "),
        (single ? "This plate" : "This panel")+" looks like "+name+"'s sheet — regenerate?")),
      !readOnly && React.createElement("div",{className:"loc-copy-check-acts"},
        React.createElement("button",{type:"button",className:"art-draftall",
          disabled:regenOff,
          title:regenerateTitle || "Make a new plate (one image) — this one stays in its version history",
          onClick:()=>{ if(!regenOff) onRegenerate(); }},
          React.createElement(Icon.sparkles,{s:12}), gen && gen.gening ? "Generating…" : "Regenerate",
          !(gen && gen.gening) && typeof window.nbCostChip==="function" && window.nbCostChip(1, n!=null ? {refs:n} : undefined)),
        React.createElement("button",{type:"button",className:"art-draftall ghost",
          title:"Keep this plate as it is — the check won't ask again about this version",onClick:keep},"Keep"))));
}
/* A SMALL ROOM BORROWS ITS PARENT'S PLATE (2026-10-27, owner — "go ahead with 5 and 6"): on a room with no plate of
   its own. Off: a one-off room (in one or two scenes) is offered "Use <parent>'s plate". On: the panel its shots and
   Stage clips get (one small panel of the parent's plate — materials, colour and light) and "Give it its own plate".
   Free: the panel is cut in the browser; nothing is generated or charged. Generating the room's own plate turns it off. */
function LocationParentStyleNotice({ l, gen, readOnly=false, onUpdate }){
  const parent = (l && typeof locationParentOf==="function") ? locationParentOf(l) : null;
  const on = !!(l && l.usesParentPlate && parent);
  const own = !!(gen && gen.genUrl);
  const [url,setUrl] = React.useState("");
  const [tick,bump] = React.useReducer(n=>n+1,0);
  React.useEffect(()=>{
    if(!on || !parent) return;
    const h = (e)=>{ const id = e && e.detail && e.detail.id; if(!id || id===parent.id) bump(); };
    window.addEventListener("nb-gen-done",h); window.addEventListener("nb-prefetched",h);
    return ()=>{ window.removeEventListener("nb-gen-done",h); window.removeEventListener("nb-prefetched",h); };
  },[on, parent&&parent.id]);
  const parentIso = (parent && typeof nbGetMeta==="function" && (nbGetMeta(parent.id)||{}).iso) || "";
  React.useEffect(()=>{
    let alive = true;
    if(!on || typeof locationEnsureParentStyle!=="function"){ setUrl(""); return ()=>{ alive=false; }; }
    locationEnsureParentStyle(l, { readOnly }).then(u=>{ if(alive) setUrl(u||""); }, ()=>{ if(alive) setUrl(""); });
    return ()=>{ alive=false; };
  },[on, l && l.id, parentIso, tick]);
  // the room got its own plate: it no longer borrows
  React.useEffect(()=>{ if(on && own && !readOnly && typeof onUpdate==="function") onUpdate(l.id,{ usesParentPlate:false }); },[on, own]);
  if(!parent || own) return null;
  const pName = parent.name || "the parent location", name = l.name || "This room";
  const sceneN = Array.isArray(l.scenes) ? l.scenes.length : 0;
  if(!on){
    if(readOnly || sceneN>2 || typeof onUpdate!=="function") return null;
    return React.createElement("div",{className:"loc-parent-style off","data-parent-style":l.id},
      React.createElement("p",null,"In "+(sceneN===1 ? "one scene" : sceneN+" scenes")+" only? "+name
        +" can borrow "+pName+"'s plate instead of having its own."),
      React.createElement("button",{type:"button",className:"art-draftall ghost",
        title:"Its shots and Stage clips get one small panel of "+pName+"'s plate for materials, colour and light, and the room is described in words. Nothing is generated or charged.",
        onClick:()=>onUpdate(l.id,{ usesParentPlate:true })},"Use "+pName+"'s plate"));
  }
  return React.createElement("div",{className:"loc-parent-style on",role:"status","data-parent-style":l.id},
    url ? React.createElement("img",{className:"loc-parent-style-thumb",src:url,alt:pName+" materials panel"})
      : React.createElement("span",{className:"loc-parent-style-thumb empty"}),
    React.createElement("div",{className:"loc-parent-style-body"},
      React.createElement("p",null,React.createElement("b",null,name+" borrows "+pName+"'s plate. "),
        url ? ((typeof locationParentStylePick==="function" && (locationParentStylePick(l)||{}).showsRoom)
            ? "Its shots and Stage clips get this panel of "+pName+"'s plate, which shows "+name+" itself."
            : "Its shots and Stage clips get this panel for materials, colour and light; the room itself is described in words.")
          : "Generate "+pName+"'s plate first: its shots and Stage clips will get one panel of it for materials, colour and light."),
      !readOnly && typeof onUpdate==="function" && React.createElement("button",{type:"button",className:"art-draftall ghost",
        title:"Stop borrowing: this room needs its own plate before its shots can show it",
        onClick:()=>onUpdate(l.id,{ usesParentPlate:false })},"Give it its own plate")));
}
/* SAME PLACE, TWO NAMES (owner-approved 2026-10-14, "go ahead with all of it"; Story Pipeline "Locations"): the
   suggestion on both cards — "These look like one place: scene 13's card says FONDAMENTA, its screenplay says FONDAMENTA
   DEI VETRAI" — with Merge… (one confirmed action: app.jsx mergeLocations), Part of and Keep separate (app.jsx
   decideLocationPlace), and the "Same place as…" picker of any card. Read from the screenplay, free; nothing is merged
   without its confirm, nothing is generated or charged. Only a role that saves the Art Room (the owner, an Art
   director) gets the buttons. */
function LocationSamePlaceNotice({ l, s, readOnly=false, onMerge, onDecide }){
  if(!l || !s) return null;
  const q = (x)=> "“"+String(x||"")+"”";
  const isPart = s.childId===l.id;
  const partLabel = isPart ? "Part of "+(s.parentName||"it") : (s.childName||"It")+" is a part of it";
  const evidence = (s.scenes||[]).map(x=>"scene "+x.no+" — card: "+x.card+"; screenplay: "+x.heading).join(" · ");
  return React.createElement("div",{className:"loc-copy-check loc-same-place",role:"status","data-same-place":s.pair},
    React.createElement(Icon.layers,{s:12}),
    React.createElement("div",{className:"loc-copy-check-body"},
      React.createElement("p",{title:"Read from the screenplay, free: "+evidence},s.text+"."),
      readOnly
        ? React.createElement("p",{className:"loc-same-place-note"},"The owner or an Art director can merge them or keep them apart.")
        : React.createElement("div",{className:"loc-copy-check-acts"},
            React.createElement("button",{type:"button",className:"art-draftall",
              title:"One card for both, named as the screenplay names it ("+q(s.headingName)+"), keeping the shared layout and plate — you see exactly what happens and confirm first. Nothing is generated or charged.",
              onClick:()=>{ if(typeof onMerge==="function") onMerge(s.cardId, s.headingId, { nameFrom:s.headingId, detected:true }); }},"Merge…"),
            React.createElement("button",{type:"button",className:"art-draftall ghost",
              title:q(s.childName)+" is a part of "+q(s.parentName)+": keep the two cards as they are and stop asking.",
              onClick:()=>{ if(typeof onDecide==="function") onDecide(s.childId, s.parentId, "part"); }},partLabel),
            React.createElement("button",{type:"button",className:"art-draftall ghost",
              title:"Two different places: "+q(s.childName)+" becomes a location of its own (you confirm first).",
              onClick:()=>{ if(typeof onDecide==="function") onDecide(s.cardId, s.headingId, "separate"); }},"Keep separate"))));
}
function LocationSamePlacePicker({ l, choices=[], value="", onChange, onMerge, onCancel }){
  return React.createElement("div",{className:"loc-copy-check loc-same-place loc-same-pick","data-same-place-pick":l && l.id},
    React.createElement(Icon.layers,{s:12}),
    React.createElement("div",{className:"loc-copy-check-body"},
      React.createElement("label",{className:"loc-same-pick-row"},
        React.createElement("span",null,"“"+((l && l.name)||"This location")+"” is the same place as"),
        React.createElement("select",{className:"loc-same-pick-select",value:value||"","aria-label":"The card that is the same place",
          onChange:(e)=>{ if(typeof onChange==="function") onChange(e.target.value); }},
          React.createElement("option",{value:""},"Choose a card…"),
          (choices||[]).map(c=>React.createElement("option",{key:c.id,value:c.id},c.name||"Untitled location")))),
      React.createElement("div",{className:"loc-copy-check-acts"},
        React.createElement("button",{type:"button",className:"art-draftall",disabled:!value,
          title:"Shows what the merge keeps and asks you to confirm. Nothing is generated or charged.",
          onClick:()=>{ if(value && typeof onMerge==="function") onMerge(); }},"Merge…"),
        React.createElement("button",{type:"button",className:"art-draftall ghost",
          onClick:()=>{ if(typeof onCancel==="function") onCancel(); }},"Cancel"))));
}
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
  const _coverScriptSig = _plateScriptSig(_draftScriptText(_sheetDraft));
  const refsKey = [l.id, id, v.id, v.order, v.scriptExcerpt, parentGenUrl, _scriptSig, (previousSheets||[]).map(p=>p&&p.id).join(","), scenes&&scenes.length].join("|");
  const buildCoverageRefs = async ()=>{
    const out = [];
    const C = window.turnContinuity || {};
    const scriptImgs = (typeof locationScreenplayReferenceImages==="function")
      ? locationScreenplayReferenceImages(l, v, scenes||C.scenes||[], drafts||C.drafts||{})
      : ((typeof locationScreenplayReferenceImage==="function") ? [locationScreenplayReferenceImage(l, v, scenes||C.scenes||[], drafts||C.drafts||{})].filter(Boolean) : []);
    scriptImgs.forEach((scriptImg, i)=> out.push({ url:scriptImg, kind:"script", refId:"script-"+id+"-"+i, required:false, ready:true, maxDim:_locPageMaxDim(),
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
      .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note, ...(r.maxDim?{maxDim:r.maxDim}:{}) }));
  };
  const depSnap = React.useRef(null);
  const gen = useImageGen({
    id, slotId: "loccov-"+id,
    entity: l,
    buildFinal: ()=> buildLocationCoveragePrompt(l, v, project),
    rebuildPromptAfterAttachments:(attach,mode,gopts)=> mode==="final"
      ? buildLocationCoveragePrompt(l, v, project, _locBudgetOpts(attach,gopts)) : null,
    buildSimple: ()=> buildSimpleLocationPrompt(l,{ name:v.name||l.name, side:v.role }),
    attachmentsInSimple:true,
    referenceMaxDim:1536,
    beforeGenerate: async ()=>{
      const refs = await buildCoverageRefs();
      const missing = refs.filter(r=>r.required && !r.ready);
      const ok = missing.length===0;
      if(!ok && typeof window.appToast==="function"){
        const prev = missing.some(r=>String(r.refId||"").indexOf(l.id+"-")===0);
        window.appToast(prev
          ? "Generate the earlier extra-space plate first — this one depends on it."
          : "Generate the parent location plate first — this extra space needs it as a reference.");
      }
      return ok;
    },
    attachments: async (...a)=>{ depSnap.current = locationAssetDependencySnapshot(l.id,previousIds,"screenplay-coverage"); return collectCoverageRefs(...a); },   // the parent as ATTACHED (2026-10-08)
    attachmentsText: (refs)=> refs && refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". The screenplay page snapshots are context only: read the scene geography from them, but never copy their typography, page border, text, captions or layout into the location sheet."
      : "",
    /* no copy check here (2026-10-14): an extra space belongs to a MAIN location only — a sub-space derives none and its
       card shows no "Extra spaces" — so it has no parent plate to be compared with; it is made from its own location's
       plate, which it is meant to match */
    metaExtra:async ({mode,url,iso})=> _withLayoutStamp(l,mode,gen,mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream }
      : (_takeDepSnap(depSnap) || locationAssetDependencySnapshot(l.id,previousIds,"screenplay-coverage")), _coverScriptSig),
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
        React.createElement("b",null,v.name||"Extra space"),
        _parentChangedBadge(gen, l, _coverScriptSig)),
      React.createElement("span",{className:"loc-coverage-source",title:v.summary||""},sourceLabel)),
    v.summary && React.createElement("div",{className:"loc-variants-empty loc-coverage-summary"},v.summary),
    React.createElement(SheetFrame,{ gen, slotId:"loccov-"+id, name:(v.name||l.name||"Location")+" \u00b7 "+(v.role||"INT"),
      avatarColor:locSwatch(v.role), initials:(v.role||"?").slice(0,2).toUpperCase(), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a finished side plate", noun:"extra-space plate", compact:true,
      // match the unit-plate card: the empty slot itself imports on drop/click, which also
      // drops the redundant "Upload a finished Required Space Plate" button below the generate CTA
      dropToImport:true,
      referenceControls: React.createElement(CoverageReferenceStrip,{ refs:refPreview, excludedIds:coverageRefOff, onToggle:toggleCoverageRef, onView }),
      // its price counts what it sends: the ready references it keeps (2026-10-14)
      generateRefs: refPreview.length ? refPreview.filter(r=>r.ready && r.url && (r.required || coverageRefOff.indexOf(r.refId)<0)).length : undefined,
      generateDisabled:!canGenerateCoverage,
      generateDisabledLabel: missingPrev ? "Generate earlier plate first" : "Generate parent plate first",
      generateDisabledTitle: missingPrev
        ? "This extra space depends on an earlier plate. Generate that plate first so the geometry and sightlines can carry forward."
        : "This extra space needs the parent location plate as a visual reference before it can generate." }));
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
  const C = window.turnContinuity || {};
  const grab = async (rid)=>{ let u2=(typeof nbGetImage==="function")?nbGetImage(rid):"";
    if(!u2 && typeof nbLoadImage==="function"){ try{ u2=await nbLoadImage(rid); }catch(e){} } return u2||""; };
  const parent = parentGenUrl || await grab(l.id);
  const plates = [{ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
    label:(l.name||"Parent location"), note:(l.name||"parent location")+" child/master plate \u2014 preserve this exact subspace geometry, materials and continuity anchors" }];
  // the root's part: single panels cut out of its plate, never its whole sheet (2026-10-14)
  if(l.parentLocation && l.parentLocation.id) plates.push(...await _locRootRefsFor(l, grab));
  // (2026-10-14) every scene of the unit: whole scenes' pages, first in the list, in the slots the plates leave
  return [..._locUnitPages(l, u, imgId, scenes||C.scenes||[], drafts||C.drafts||{}, plates.length), ...plates];
}
/* A ROOM & TIME PLATE'S PAGES ON ITS CARD (2026-10-14 — locations.jsx sluglineUnitPageRefs): every scene of its unit in
   story order, whole scenes in the slots its plates leave (6 images in all) — the scenes left out go as text */
function _locUnitPages(l, u, imgId, scenes, drafts, taken){
  const max = Math.max(0, (Number(window.LOC_PLATE_MAX_REFS)||6) - (Number(taken)||0));
  return (typeof sluglineUnitPageRefs==="function" ? sluglineUnitPageRefs(l, u, imgId, scenes, drafts, max) : [])
    .map(r=>({ ...r, required:false, ready:true, maxDim:_locPageMaxDim() }));
}
/* the unit's scenes and their screenplay — a card's pages are redrawn when any of them changes (2026-10-14) */
function _locUnitScriptSig(u, drafts){
  const dr = drafts || ((window.turnContinuity||{}).drafts) || {};
  return JSON.stringify(((u && u.scenes) || []).map(sid=>[sid, ((dr[sid]||{}).blocks)||[]]));
}
/* what a room & time / state card sends: the references it keeps (ticked, ready), its pages cut to whole scenes in the
   slots the rest leave, each page with its scene (the scenes left out go as text — _locBudgetOpts) */
function _locUnitAttachments(refs, off){
  const kept = (refs||[]).filter(r=>r && r.ready && r.url && (r.required || (off||[]).indexOf(r.refId)<0));
  const others = kept.filter(r=>r.kind!=="script"), max = (Number(window.LOC_PLATE_MAX_REFS)||6) - others.length;
  const pages = kept.filter(r=>r.kind==="script");
  return [...(typeof locationWholeScenePages==="function" ? locationWholeScenePages(pages, max) : pages), ...others]
    .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note, ...(r.maxDim?{maxDim:r.maxDim}:{}),
      ...(r.numbered?{numbered:true}:{}), ...(r.kind==="script"&&r.sceneId!=null?{sceneId:r.sceneId}:{}) }));
}
/* THE BATCH PRICES' REFERENCE COUNTS, KEPT (2026-10-14): the same card, room & time, parent, plates and screenplay give
   the same count, so a keystroke in search or a progress tick doesn't count every missing plate again */
const _locRefCountMemo = new WeakMap();
function _locMemoRefCount(l, u, extra, count){
  const C = window.turnContinuity || {};
  const parent = typeof locationParentOf==="function" ? locationParentOf(l) : null;
  const metaOf = (id)=>{ try{ const m = id && typeof nbGetMeta==="function" ? nbGetMeta(id) : null;
    return m ? String(m.iso||"")+(m.platePanels ? "+cams" : "") : ""; }catch(e){ return ""; } };
  const deps = [u||null, parent, C.scenes, C.drafts, C.locations, metaOf(l.id), metaOf(parent && parent.id), String(extra)];
  const kept = _locRefCountMemo.get(l) || [];
  const hit = kept.find(e=> e.deps.length===deps.length && e.deps.every((d,i)=>d===deps[i]));
  if(hit) return hit.n;
  const n = count();
  _locRefCountMemo.set(l, [{ deps, n }, ...kept].slice(0, 8));
  return n;
}
/* the parent's plate cameras noted on its card (l.plateCameras, 2026-10-14) — a card strip refreshes when they change */
function _locParentCamerasKey(l){
  if(!l || !l.parentLocation || typeof locationParentOf!=="function") return "";
  try{ return JSON.stringify(((locationParentOf(l)||{}).plateCameras)||null); }catch(e){ return ""; }
}
/* a sub-space's single-frame plates (room & time, environment state): the root's part — its panels matched to a view
   through an opening, else one optional small material panel; the root's plate missing → one "needed" slot */
async function _locRootRefsFor(l, grab){
  if(!(await grab(l.parentLocation.id))){
    const miss = typeof locationParentMissingReference==="function" ? locationParentMissingReference(l) : null;
    return miss ? [miss] : [];
  }
  try{ return (await locationSubspaceRootReferences(l,{single:true})).refs; }
  catch(e){ const miss = typeof locationParentMissingReference==="function" ? locationParentMissingReference(l) : null;
    // the slot says why (a panel that couldn't be cut out of the plate: try again), not only that it is needed
    return miss ? [{...miss, note:(e && e.message) || miss.note}] : []; }
}

/* An additional environment state. The legacy linked-unit resolver is retained
   for asset compatibility; ordinary linked states render only in their unit. */
/* readOnly (2026-10-14): a viewer who can't change the Art Room sees its copy check's words, never Regenerate / Keep */
function LocationVariant({ l, v, project, scenes, drafts, units, parentGenUrl, onTime, onState, onRemove, onView, readOnly=false }){
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
  // the parent's cameras noted on its card (2026-10-14) change which of its panels this state is sent
  const refsKey=[l.id,id,stateUnit&&stateUnit.scriptText,parentGenUrl,l.parentLocation&&l.parentLocation.id,(scenes&&scenes.length),_locParentCamerasKey(l),
    stateUnit?_locUnitScriptSig(stateUnit,drafts):""].join("|");
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
    return _locUnitAttachments(refs,refOff);   // its pages keep their scenes (2026-10-14: the rest go as text)
  };
  const depSnap = React.useRef(null);
  const gen = useImageGen({
    id, slotId,
    entity: locationRenderEntity(stateUnit ? {...l,appearanceState:stateUnit} : l),
    buildFinal: ()=> stateUnit && typeof buildSluglineUnitPrompt==="function"
      ? buildSluglineUnitPrompt(l,stateUnit,project)
      : buildLocationVariantPrompt(l, project, { time:v.time, state:v.state }),
    rebuildPromptAfterAttachments:(attach,mode,gopts)=> mode==="final" && stateUnit && typeof buildSluglineUnitPrompt==="function"
      ? buildSluglineUnitPrompt(l,stateUnit,project,_locBudgetOpts(attach,gopts)) : null,
    buildSimple: ()=> buildSimpleLocationPrompt(l,{ name:(stateUnit&&stateUnit.name)||l.name, side:stateUnit&&stateUnit.intExt, time:v.time, state:v.state }),
    beforeGenerate: async()=>{
      const refs=await buildRefs();
      const ok=!refs.some(r=>r.required&&!r.ready);
      if(!ok&&typeof window.appToast==="function")
        window.appToast("Generate the parent location plate first \u2014 this time-of-day variant needs it as a reference.");
      return ok;
    },
    attachmentsRequired:true,
    attachments: async (...a)=>{ depSnap.current = locationAssetDependencySnapshot(l.id,locationRootIds(l),stateUnit?"slugline-unit":"continuity-state"); return collectRefs(...a); },   // the parent as ATTACHED (2026-10-08)
    attachmentsText: (refs)=> refs&&refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". Read screenplay snapshots as context only; never copy their text, typography, borders or layout."
      : "",
    metaExtra:async ({mode,url,iso})=> _withCopyCheck(l,url,iso,_withLayoutStamp(l,mode,gen,mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream }
      : (_takeDepSnap(depSnap) || locationAssetDependencySnapshot(l.id,locationRootIds(l),stateUnit?"slugline-unit":"continuity-state")), stateUnit ? _plateScriptSig(stateUnit.scriptText) : "")),
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
            stateUnit.time&&React.createElement("span",{className:"loc-time-badge"},stateUnit.time),
            _parentChangedBadge(gen, l, stateUnit ? _plateScriptSig(stateUnit.scriptText) : ""))
        : React.createElement(EditText,{value:v.time,placeholder:"State name / time, e.g. Dawn \u00b7 storm\u2026",onCommit:onTime}),
      onRemove&&React.createElement("button",{className:"loc-variant-x",title:"Remove environment state",onClick:onRemove},React.createElement(Icon.x,{s:12}))),
    React.createElement(SheetField,{label:"What changes",value:v.state||"",multiline:true,
      placeholder:"Weather, practicals on/off, damage, wear or another persistent environment change\u2026",onCommit:onState}),
    stateUnit&&React.createElement("div",{className:"loc-shared-state-note"},
      "Applies to "+((stateUnit.sceneNos||[]).length>1?"Scenes ":"Scene ")+(stateUnit.sceneNos||[]).join(", ")+
      " \u00b7 uses the exact room & time plate and version history"),
    React.createElement(SheetFrame,{ gen, slotId, name:(stateUnit&&stateUnit.name||l.name||"")+" \u00b7 "+v.time,
      avatarColor:locSwatch(stateUnit&&stateUnit.intExt||l.intExt), initials:(v.time||"?").slice(0,2).toUpperCase(), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a photo", noun:"time-of-day variant plate", compact:true,
      dropToImport:true,
      referenceControls:React.createElement(CoverageReferenceStrip,{refs:refPreview,excludedIds:refOff,onToggle:toggleRef,onView}),
      generateRefs: refPreview.length ? _locUnitAttachments(refPreview, refOff).length : undefined,   // what it sends (2026-10-14)
      generateDisabled:!canGenerate,
      generateDisabledLabel:"Generate parent plate first",
      generateDisabledTitle:"This time-of-day variant needs the parent location plate as a visual reference before it can generate." }),
    // its price counts what it sends: a state of its own (a storm, no room & time) sends the room's plate and the root's
    // part, no pages — priced as such, never as an image with no references (2026-10-14)
    l.parentLocation && React.createElement(LocationCopyCheckNotice,{ l, assetId:id, gen, single:true, readOnly,
      refs:()=>(typeof sluglineUnitPlateRefCount==="function" ? sluglineUnitPlateRefCount(l,stateUnit||{name:l.name},{rootPlate:true}).n : undefined),
      disabled:!canGenerate, onRegenerate:()=>gen.generate() }));
}

/* SLUGLINE UNIT card — the atomic addressed unit of this location
   (place × INT/EXT × time-of-day), with provenance and a spatial reference
   plate. Reuses the coverage-sheet machinery: the unit shapes like a sheet
   (sceneNos / scriptExcerpt / role) so the screenplay-snapshot references and
   SheetFrame work unchanged. Generation is per-unit click ONLY (never batched,
   never auto) and requires the parent master plate as its visual anchor. Orphan
   units (slugline edited away) stay visible so their plate and notes aren't
   silently lost; the user removes them explicitly. */
function SluglineUnitCard({ l, u, project, scenes, drafts, parentGenUrl, onEnvironmentChange, onRemoveUnit, onView, readOnly=false }){
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
    l.parentLocation&&l.parentLocation.id, (scenes&&scenes.length), _locParentCamerasKey(l), _locUnitScriptSig(u, drafts)].join("|");
  const buildUnitRefs = async ()=>{
    const C = window.turnContinuity || {};
    const grab = async (rid)=>{ let u2=(typeof nbGetImage==="function")?nbGetImage(rid):"";
      if(!u2 && typeof nbLoadImage==="function"){ try{ u2=await nbLoadImage(rid); }catch(e){} } return u2||""; };
    const parent = parentGenUrl || await grab(l.id);
    const plates = [{ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
      label:(l.name||"Parent location"), note:(l.name||"parent location")+" child/master plate \u2014 preserve this exact subspace geometry, materials and scale" }];
    // the root's part: single panels cut out of its plate, never its whole sheet (2026-10-14)
    if(l.parentLocation) plates.push(...await _locRootRefsFor(l, grab));
    // (2026-10-14) every scene of the unit: whole scenes' pages, first in the list, in the slots the plates leave
    return [..._locUnitPages(l, u, imgId, scenes||C.scenes||[], drafts||C.drafts||{}, plates.length), ...plates];
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
    return _locUnitAttachments(refs, refOff);   // its pages keep their scenes (2026-10-14: the rest go as text)
  };
  const depSnap = React.useRef(null);
  const gen = useImageGen({
    id: imgId, slotId, entity: locationRenderEntity(l),
    buildFinal: ()=> (typeof buildSluglineUnitPrompt==="function")
      ? buildSluglineUnitPrompt(l, u, project)
      : buildLocationCoveragePrompt(l, pseudo, project),
    rebuildPromptAfterAttachments:(attach,mode,gopts)=> mode!=="final" ? null
      : (typeof buildSluglineUnitPrompt==="function")
        ? buildSluglineUnitPrompt(l, u, project, _locBudgetOpts(attach,gopts))
        : buildLocationCoveragePrompt(l, pseudo, project, _locBudgetOpts(attach,gopts)),
    buildSimple: ()=> buildSimpleLocationPrompt(l,{ name:u.name||l.name, side:role, time:u.time, state:u.appearance||u.environment||"" }),
    beforeGenerate: async ()=>{
      const refs = await buildUnitRefs();
      const missing = refs.filter(r=>r.required && !r.ready);
      const ok = missing.length===0;
      if(!ok && typeof window.appToast==="function")
        window.appToast("Generate the parent location plate first \u2014 this room & time plate needs it as a reference.");
      return ok;
    },
    attachmentsRequired:true,
    attachments: async (...a)=>{ depSnap.current = locationAssetDependencySnapshot(l.id,locationRootIds(l),"slugline-unit"); return collectRefs(...a); },   // the parent as ATTACHED (2026-10-08)
    attachmentsText: (refs)=> refs && refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". The screenplay page snapshots are context only: read the scene geography from them, but never copy their typography, page border, text, captions or layout into the location sheet."
      : "",
    metaExtra:async ({mode,url,iso})=> _withCopyCheck(l,url,iso,_withLayoutStamp(l,mode,gen,mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream,
          ...(gen.genMeta&&gen.genMeta.drawnAt?{drawnAt:gen.genMeta.drawnAt}:{}) }
      // with the eye level of this room & time's own scenes (scale plan step 3, 2026-10-28; an edit keeps its own)
      : Object.assign(typeof locationDrawnAtMeta==="function" ? locationDrawnAtMeta(locationDrawnAtEntity(l,{sceneNos:u.sceneNos})) : {},
          _takeDepSnap(depSnap) || locationAssetDependencySnapshot(l.id,locationRootIds(l),"slugline-unit")), _plateScriptSig(u.scriptText))),
    buildEdit: (instr)=> "Edit this "+role+" Slugline Unit plate for "+(u.name||l.name||"the location")+(u.time?(" at "+u.time):"")+". Apply ONLY: "+instr+". Keep it consistent with the parent location's architecture, materials and light."+locationSpatialPrompt(l),
  });
  const viewerEntity = {
    ...l,
    id:imgId,
    name:(u.name||l.name||"Location")+" · "+role+(u.time?(" · "+u.time):"")
  };
  return React.createElement("div",{className:"loc-variant loc-coverage-sheet loc-unit-card"+(u.orphan?" orphan":""),"data-location-unit-image":imgId},
    React.createElement("div",{className:"loc-variant-head"},
      React.createElement("div",{className:"loc-coverage-title"},
        React.createElement("span",{className:"loc-intext-badge "+(/EXT/.test(role)?"ext":"int")},role),
        React.createElement("b",null,u.name||"Slugline unit"),
        u.time && React.createElement("span",{className:"loc-time-badge"},u.time),
        _parentChangedBadge(gen, l, _plateScriptSig(u.scriptText))),
      React.createElement("span",{className:"loc-coverage-source",title:(u.sluglines||[]).join("\n")},sourceLabel)),
    React.createElement("div",{className:"loc-space-provenance "+sourceMeta.kind,title:(u.sluglines||[]).join("\n")},
      sourceMeta.label,
      (u.occurrences||[]).length>1&&React.createElement("span",null," · ",(u.occurrences||[]).length," occurrences")),
    u.orphan && React.createElement("div",{className:"loc-unit-orphan"},
      React.createElement(Icon.alert,{s:12}),
      React.createElement("span",null,"No longer in the script \u2014 kept so its plate and notes aren't lost."),
      onRemoveUnit && React.createElement("button",{className:"loc-unit-remove",
        title:"Delete this room & time's stored data and generated plate",
        onClick:async ()=>{
          // a PERMANENT delete — asked first (2026-10-03, owner — Locations review)
          const ok = !window.appConfirm || await window.appConfirm({
            title:"Remove "+(u.name||"this room")+(u.time?" \u00b7 "+u.time:"")+" for good?",
            body:"It's no longer in the screenplay. Removing it deletes its notes and its plate permanently \u2014 this can't be undone.",
            confirmLabel:"Remove for good", cancelLabel:"Keep it", danger:true });
          if(!ok) return;
          if(typeof nbClearAsset==="function"){ try{ await nbClearAsset(imgId); }catch(e){} } onRemoveUnit(u.key); }},"Remove")),
    React.createElement("details",{className:"loc-nested-section loc-unit-environment"},
      React.createElement("summary",null,"Lighting & environment"),
      React.createElement(SheetField,{label:"Environment notes",value:u.appearance||"",multiline:true,
        placeholder:"Light, weather, active practicals, damage or wear for this unit. Keep the same architecture; temporary props and blocking belong in Spatial Layout & Staging.",
        onCommit:onEnvironmentChange})),
    React.createElement(SheetFrame,{ gen, slotId, name:(u.name||l.name||"Location")+" \u00b7 "+role+(u.time?(" \u00b7 "+u.time):""),
      avatarColor:locSwatch(role), initials:role.slice(0,2), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a finished room & time plate", noun:"room & time plate", compact:true,
      dropToImport:true,
      referenceControls: React.createElement(CoverageReferenceStrip,{ refs:refPreview, excludedIds:refOff, onToggle:toggleRef, onView }),
      generateRefs: refPreview.length ? _locUnitAttachments(refPreview, refOff).length : undefined,   // what it sends (2026-10-14)
      generateDisabled:!canGenerate,
      generateDisabledLabel: u.orphan ? "No longer in script" : "Generate parent plate first",
      generateDisabledTitle: u.orphan
        ? "This room & time is no longer in the screenplay, so it can't generate new plates. Its existing plate and notes are kept until you Remove it."
        : "This room & time plate needs the parent location plate as a visual reference before it can generate." }),
    l.parentLocation && React.createElement(LocationCopyCheckNotice,{ l, assetId:imgId, gen, single:true, readOnly:readOnly||!!u.orphan,
      refs:()=>(typeof sluglineUnitPlateRefCount==="function" ? sluglineUnitPlateRefCount(l,u,{rootPlate:true}).n : undefined),
      disabled:!canGenerate, onRegenerate:()=>gen.generate() }));
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

/* SHARED-HEAD PARENTS (owner-approved 2026-10-26, "go ahead with the locations plan"): the places a screenplay names as
   "PLACE - ROOM" without ever heading a scene "INT. PLACE" — "These 9 places are parts of one place: Marmorica" — with
   Group under Marmorica and Keep separate (app.jsx decideSharedHead, which asks first). Read from the screenplay, free. */
function LocationSharedHeadNotice({ sug, readOnly=false, onDecide }){
  if(!sug) return null;
  const names = (sug.children||[]).map(c=>c.name).filter(Boolean);
  return React.createElement("div",{className:"loc-copy-check loc-same-place loc-shared-head",role:"status","data-shared-head":sug.headKey},
    React.createElement(Icon.layers,{s:12}),
    React.createElement("div",{className:"loc-copy-check-body"},
      React.createElement("p",null,"These "+names.length+" places are parts of one place, \u201c"+sug.headName+"\u201d: "+names.join(", ")
        +". Grouped, they share its identity, one layout with one north, and its 2\u00d72 plate, which each room's plates are made from."),
      readOnly
        ? React.createElement("p",{className:"loc-same-place-note"},"The owner or an Art director can group them.")
        : React.createElement("div",{className:"loc-copy-check-acts"},
            React.createElement("button",{type:"button",className:"art-draftall",
              title:"A new \u201c"+sug.headName+"\u201d card becomes the place they're part of; each room keeps its card, plates and notes. You confirm first. Nothing is generated or charged.",
              onClick:()=>{ if(typeof onDecide==="function") onDecide(sug, "group"); }},"Group under "+sug.headName),
            React.createElement("button",{type:"button",className:"art-draftall ghost",
              title:"They stay locations of their own and this isn't suggested again (you confirm first).",
              onClick:()=>{ if(typeof onDecide==="function") onDecide(sug, "separate"); }},"Keep separate"))));
}
function LocationSheets({ project, locations, scenes, drafts, onUpdate, onDraft, onDraftAll, onDelete, draftingId, draftingIds, draftingAll, scriptHasLocs, onDraftStaging, draftingStageId, trashItems, onRestore, onPurge, lookbookStale, onApplyLookbook, onApplyLookbookDraftOnly, sluglineUnits, onUpdateUnit, onRemoveUnit, readOnly=false, onMergeLocations, onPlaceDecision, onSharedHeadDecision }){
  const [view, setView] = React.useState(null);
  if(window.useRenderStyleVersion) window.useRenderStyleVersion();   // re-render dropdowns when a style is locked/unlocked
  const [sceneFilter, setSceneFilter] = React.useState(()=>{ const f = window.turnPeekArtFocus && window.turnPeekArtFocus("locations"); return (f && f.sceneId) || ""; });   // a Breakdown hand-off opens on its scene
  React.useEffect(()=>{ if(window.turnClearArtFocus) window.turnClearArtFocus("locations"); },[]);
  const [query, setQuery] = React.useState("");               // free-text name search
  const [searchOpen, setSearchOpen] = React.useState(false);  // collapsible search: icon-only until clicked
  const searchRef = React.useRef(null);
  const batch = useBatchGen("locations");
  const batchActiveId = batch.activeId;
  const rawLocations = locations || [];
  const locationFold = (typeof deriveSubspaceFold==="function") ? deriveSubspaceFold(scenes||[],drafts||{}) : {};
  // SAME PLACE, TWO NAMES (2026-10-14): the pairs of cards that look like one place (read from the screenplay, free)
  const placeSig = (typeof locationPlaceDecisionsNow==="function" && locationPlaceDecisionsNow().sig) || "";
  const samePlace = React.useMemo(()=> (typeof locationSamePlaceSuggestions==="function")
    ? locationSamePlaceSuggestions(rawLocations, scenes||[], drafts||{}) : [], [rawLocations, scenes, drafts, placeSig]);
  const sharedHeads = React.useMemo(()=> (typeof locationSharedHeadSuggestions==="function")
    ? locationSharedHeadSuggestions(rawLocations, scenes||[], drafts||{}) : [], [rawLocations, scenes, drafts, placeSig]);
  const mergeChoicesFor = (l)=> rawLocations.filter(x=>x && x.id!==l.id && x.key)
    .map(x=>({ id:x.id, name:x.name||"" })).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
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
    // ASK FIRST, THEN SWITCH (2026-10-08, owner — Locations review): the cards used to read "Surprise me"
    // before the confirm, so Cancel (or no writing model) left every card mislabelled
    const need = list.filter(l=>!l.parentLocation&&!(l.surpriseRender && l.surpriseRender.style));
    const has = list.filter(l=>!l.parentLocation&&l.surpriseRender&&l.surpriseRender.style);
    const kids = list.filter(l=>l.parentLocation);
    if(need.length){
      if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())){
        if(typeof window.appToast==="function") window.appToast("Surprise me needs the writing model \u2014 it isn't available right now.","info"); return; }
      let ok = true;
      if(typeof window.appConfirm==="function") ok = await window.appConfirm({
        title:"Invent a surprise style for "+need.length+" location"+(need.length!==1?"s":"")+"?",
        body:"Each parent or standalone location gets a bespoke style; its rooms share it. That's "+need.length+" small writing call"+(need.length!==1?"s":"")+" (writing credits).",
        confirmLabel:"Invent styles" });
      if(!ok) return;
    }
    has.forEach(l=> onUpdate(l.id, { renderStyleIndependent:false, renderStyleKey:"surprise", renderStyle:l.surpriseRender.style }));
    setAllStyling(need.length ? { i:0, total:need.length } : null);
    for(let i=0;i<need.length;i++){ setAllStyling({ i:i+1, total:need.length });
      try{ const r = await aiSurpriseStyleText({ name:need[i].name, kind:"location", bible:locBibleOf(need[i]) }, project);
        if(r) onUpdate(need[i].id, { renderStyleIndependent:false, renderStyleKey:"surprise", surpriseRender:r, renderStyle:r.style }); }catch(e){} }
    kids.forEach(l=> onUpdate(l.id, { renderStyleIndependent:false, renderStyleKey:"surprise" }));   // rooms share their parent's
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
  const byLocId = {}; list.forEach(l=>{ byLocId[l.id]=l; });
  /* EACH PLATE'S REFERENCE IMAGES IN THE BATCH PRICES (2026-10-14): a location plate's parent panels or layout plate and
     its pages, a room & time plate's location plate, root panels and pages — counted as the cards send them (nothing
     unticked); an image that can't be counted is priced at the most it could send. `run`: the plates the run makes, in
     order — a room whose parent's plate the run makes (or remakes, when its cameras were never recorded) has its panels
     matched only once that plate exists: up to 4 of them on its own plate, 2 on a room & time plate, not the 1 */
  const inRun = (ids, id)=> !!(ids && id) && (typeof ids.has==="function" ? ids.has(id) : Array.prototype.indexOf.call(ids, id)>=0);
  const parentUnknown = (l, run)=>{
    const p = typeof locationParentOf==="function" ? locationParentOf(l) : null;
    if(!p || !inRun(run, p.id)) return false;
    const m = hasImg(p.id) && typeof nbGetMeta==="function" ? nbGetMeta(p.id) : null;
    return !(m && m.platePanels);
  };
  const plateRefsOf = (l, run)=>{ try{
    if(!l || typeof locationPlateRefCount!=="function") return 6;
    const n = _locMemoRefCount(l, null, "", ()=>{ const r = locationPlateRefCount(l); return r && r.n!=null ? r.n : 6; });
    return parentUnknown(l, run) ? Math.min(6, n+3) : n;
  }catch(e){ return 6; } };
  const unitRefsOf = (x, rootPlate, run)=>{ try{
    if(typeof sluglineUnitPlateRefCount!=="function") return 6;
    const n = _locMemoRefCount(x.owner, x.u, rootPlate, ()=>{ const r = sluglineUnitPlateRefCount(x.owner, x.u, { rootPlate }); return r && r.n!=null ? r.n : 6; });
    return rootPlate && parentUnknown(x.owner, run) ? Math.min(6, n+1) : n;
  }catch(e){ return 6; } };
  const refsWhat = "each plate's reference images (its parent's panels or the layout's plate, and the screenplay pages)";
  const batchChip = (refs)=> typeof window.LikenessBatchCost==="function"
    ? React.createElement(window.LikenessBatchCost,{ refs, what:refsWhat })
    : (typeof window.nbCostChip==="function" ? window.nbCostChip(refs.length) : null);
  // MISSING PLATES FIRST (2026-10-03, owner — Locations review): the buttons price exactly the
  // plates they will make; redoing existing ones is the quiet "Regenerate…" (which asks first)
  const [, setPlateTick] = React.useState(0);
  React.useEffect(()=>{
    const h = ()=> setPlateTick(t=>t+1);
    window.addEventListener("nb-gen-done", h);
    return ()=> window.removeEventListener("nb-gen-done", h);
  },[]);
  const hasImg = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  // a plate renders only once its shared layout is reviewed (the card's own gate) — those waiting
  // are left out of the counts and prices, and named instead
  const layoutReady = (l)=>{ try{ if(typeof requireLocationSpatialPlan==="function") requireLocationSpatialPlan(l); return true; }catch(e){ return false; } };
  // a room that borrows its parent's plate has none of its own to make (2026-10-27)
  const borrows = (l)=> typeof locationUsesParentPlate==="function" && locationUsesParentPlate(l);
  const missingDrafted = draftedIds(list.filter(l=>!borrows(l))).filter(id=>!hasImg(id));
  const missingAll = missingDrafted.filter(id=>layoutReady(byLocId[id]));
  const waitingLayout = missingDrafted.length - missingAll.length;
  const [sceneRun, setSceneRun] = React.useState(null);   // {i,total,label} while a scene run works
  const sceneStop = React.useRef(false);
  const startAllBatch = (onlyMissing)=>{
    if(batchActiveId || sceneRun) return;
    const eligible = onlyMissing ? missingAll : draftedIds(list);
    if(!eligible.length){ batch.setMsg(onlyMissing ? "Every drafted location already has its plate." : "Draft the location specifications first \u2014 nothing is ready to generate yet."); return; }
    // clear the SEARCH too, not just the scene/kind filters: the queue advances only
    // when the target CARD is mounted, so a batch whose first target was filtered out
    // by a search box never generated anything and hung until Cancel
    if(sceneFilter) setSceneFilter("");
    if(query) setQuery("");
    // ALWAYS ASKS, WITH THE PRICE (2026-10-08, owner — Locations review), and names the writing a plate
    // with no view composition spends first (the card drafts it before rendering)
    batch.begin(eligible, onlyMissing ? 0 : list.length - eligible.length, { alwaysAsk:true, note:(missing, existing)=>{
      const n = [...missing, ...existing].map(id=>byLocId[id]).filter(l=> l && !(typeof stagingHasContent==="function" ? stagingHasContent(l) : true)).length;
      return n ? "Plus writing credits to draft "+n+" view composition"+(n!==1?"s":"")+" first." : ""; },
      refsOf:(id, i, run)=>plateRefsOf(byLocId[id], run), refsWhat });
  };
  const eligibleAll = list.filter(l=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l) : true).length;
  const undraftedN = list.filter(l=> (typeof locVisualsDrafted==="function") ? !locVisualsDrafted(l) : false).length;
  // ONE SCENE: everything the focused scene needs, in order — the location plates (a room's parent
  // first), then the scene's own room/time plates (Slugline Units, which have no other batch).
  const scenePlan = (sid)=>{
    if(!sid) return { masters:[], units:[], waiting:0 };
    const need = new Set();
    const addWithParent = (l)=>{ need.add(l.id); if(l.parentLocation && byLocId[l.parentLocation.id]) need.add(l.parentLocation.id); };
    list.filter(l=>inScene(l, sid)).forEach(addWithParent);
    const units = (sluglineUnits||[]).filter(u=> u && !u.orphan && (u.scenes||[]).indexOf(sid)>=0)
      .map(u=>({ u, owner:list.find(l=> String(l.key||"")===String(u.subspaceKey||u.locationKey||"")) }))
      .filter(x=> x.owner && !borrows(x.owner));
    units.forEach(x=> addWithParent(x.owner));
    const mastersAll = draftedIds(list.filter(l=>need.has(l.id) && !borrows(l))).filter(id=>!hasImg(id)).map(id=>byLocId[id]);
    const masters = mastersAll.filter(layoutReady);
    const unitsAll = (typeof sluglineUnitImageId==="function") ? units.filter(x=>!hasImg(sluglineUnitImageId(x.u.key))) : [];
    // a room plate needs its location's plate: one that exists, or one this run will make
    const willHave = (l)=> hasImg(l.id) || masters.some(m=>m.id===l.id);
    const missingUnits = unitsAll.filter(x=> layoutReady(x.owner) && willHave(x.owner));
    return { masters, units:missingUnits, waiting:(mastersAll.length-masters.length)+(unitsAll.length-missingUnits.length) };
  };
  // a room & time plate gets its root's panels only when the root has a plate, or this run makes it
  const sceneRefsList = (p)=>{
    const run = p.masters.map(l=>l.id);
    return [...p.masters.map(l=>plateRefsOf(l, run)), ...p.units.map(x=>{
      const root = typeof locationParentOf==="function" ? locationParentOf(x.owner) : null;
      return unitRefsOf(x, !root || hasImg(root.id) || run.indexOf(root.id)>=0, run);
    })];
  };
  const plan = scenePlan(sceneFilter);
  const sceneMissingN = plan.masters.length + plan.units.length;
  const startSceneRun = async ()=>{
    if(!sceneFilter || batchActiveId || sceneRun) return;
    const p = scenePlan(sceneFilter);
    const n = p.masters.length + p.units.length;
    // asks first, with the price (2026-10-08 — it used to start at once)
    if(n && typeof window.appConfirm==="function"){
      const price = (typeof window.nbBatchCostText==="function") ? window.nbBatchCostText(sceneRefsList(p))
        : (typeof window.nbImageCostText==="function") ? window.nbImageCostText(n) : "";
      const unstaged = p.masters.filter(l=> !(typeof stagingHasContent==="function" ? stagingHasContent(l) : true)).length;
      const ok = await window.appConfirm({ title:"Make "+n+" plate"+(n!==1?"s":"")+" for Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")+"?",
        body:p.masters.length+" location plate"+(p.masters.length!==1?"s":"")+" (a room's parent first), then "+p.units.length+" room & time plate"+(p.units.length!==1?"s":"")+"."
          +(price ? " About "+price+" credit"+(price==="1"?"":"s")+"." : "")
          +(unstaged ? " Plus writing credits to draft "+unstaged+" view composition"+(unstaged!==1?"s":"")+" first." : ""),
        items:[...p.masters.map(l=>l.name||"Location"), ...p.units.map(x=>(x.u.name||x.owner.name||"Room")+(x.u.time?" \u00b7 "+x.u.time:""))],
        confirmLabel:"Make "+n+" plate"+(n!==1?"s":""), cancelLabel:"Cancel" });
      if(!ok) return;
    }
    const plateOpts = { draftStaging:true, onStaged:(id, st)=> onUpdate(id, { staging:st }) };
    const steps = [...p.masters.map(l=>({ label:l.name||"Location", run:()=>window.generateLocationPlate(l, project, plateOpts) })),
      ...p.units.map(x=>({ label:(x.u.name||x.owner.name||"Room")+(x.u.time?" \u00b7 "+x.u.time:""), run:()=>window.generateSluglineUnitPlate(x.owner, x.u, project) }))];
    if(!steps.length){ batch.setMsg("This scene already has every plate it needs."); return; }
    sceneStop.current = false;
    const failed = [];
    for(let i=0;i<steps.length;i++){
      if(sceneStop.current) break;
      setSceneRun({ i:i+1, total:steps.length, label:steps[i].label });
      try{ const ok = await steps[i].run(); if(!ok) failed.push(steps[i].label); }
      catch(e){ failed.push(steps[i].label+" \u2014 "+((e&&e.message)||"error")); }
    }
    setSceneRun(null);
    if(failed.length && typeof window.appToast==="function")
      window.appToast(failed.length+" plate"+(failed.length!==1?"s":"")+" couldn't be made: "+failed.join("; "),"error");
  };
  const startSceneRegenerate = ()=>{
    if(!sceneFilter || batchActiveId || sceneRun) return;
    const eligible = draftedIds(shown);
    if(!eligible.length){ batch.setMsg("Draft these location specifications first \u2014 nothing in this scene is ready to generate."); return; }
    batch.begin(eligible, shown.length - eligible.length, { refsOf:(id, i, run)=>plateRefsOf(byLocId[id], run), refsWhat });
  };

  return React.createElement("div",{className:"art-scroll"},
    view && React.createElement(ImageLightbox,{url:view.url,character:view.character,
      siblings:view.siblings,startIndex:view.startIndex,onClose:()=>setView(null)}),
    React.createElement(NbKeyBar,null),
    React.createElement(NbControls,null),
    window.LookbookStaleNotice && React.createElement(window.LookbookStaleNotice,{stale:lookbookStale,onApply:onApplyLookbook,onDraftOnly:onApplyLookbookDraftOnly,label:"these locations",dept:"locations"}),
    (sharedHeads||[]).map(sug=>React.createElement(LocationSharedHeadNotice,{ key:sug.headKey, sug, readOnly, onDecide:onSharedHeadDecision })),
    React.createElement("div",{className:"art-intro"},
      React.createElement("div",{className:"art-intro-row"},
        React.createElement("div",{style:{flex:1}},
          React.createElement(window.ArtDeptTitle||"div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Location Scout",
            React.createElement(window.InfoTip,{label:"About Locations",
              text:"Locations prepares reusable sets for the art department. The Space and Narrative Significance define the place. Screenplay Evidence shows the source passages; Rooms & times (the screenplay's sluglines) identify the rooms, times and scenes. Each one has one plate and Lighting & environment notes, so scripted Night / Dawn states are not repeated in a separate section. Additional environment states and extra spaces are nested there. Spatial Layout & Staging holds the shared set layout (review and confirm it before the first plate), reusable camera views with their view compositions, and scene dressing/blocking notes. A room's plates are made from its location's plate, so that one comes first. The header's Render style picker sets the visual treatment; the card's Look & exclusions section fine-tunes it, and the generation prompt (the card's \u22ef menu \u25b8 Show the generation prompt) shows, read-only, the specification sent to the image model. Plates spend image credits; drafting specs, layouts and view compositions, and Surprise me, spend writing credits \u2014 each button says which, and the batches ask first with the price. Blender Studio builds the selected set.\n\nEach established parent place has one card with a room selector. Choose Whole location for the shared canon and all room-unit links, or a room to edit its own plate and layout. Search and scene focus include rooms. A Kitchen with no evidenced parent remains a standalone place. Shot timing, cuts and performance are directed in Shots / Blender previz."}))),
        React.createElement("div",{className:"art-intro-actions"},
          window.RecentlyDeleted && React.createElement(window.RecentlyDeleted,{
            items:trashItems,kind:"location",onRestore,onPurge,compact:true}),
          // NO arbitrary hand-adding: continuity places anchor master cards, room
          // headings become Slugline Units; implied side spaces become Required Space Plates
          // sheets from screenplay body text + page snapshots.
          // (the read-only "World scale" control is gone, 2026-10-03: each plate's scale still comes
          // automatically from the characters who drive its scenes)
          (undraftedN>0 || (!list.length && scriptHasLocs)) && React.createElement("button",{className:"art-draftall ghost",disabled:draftingAll,onClick:()=>onDraftAll(),
            title:"Build what's missing from the screenplay \u2014 pull new places, derive rooms & times and extra spaces, and draft the spec (and the layout of places used in 2+ scenes) of every location that doesn't have one yet; finished and edited locations are left alone. Writing credits, no images."},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":(list.length ? "Design "+undraftedN+" location"+(undraftedN!==1?"s":"") : "Design all locations")),
          (list.length>0 && !undraftedN) && React.createElement("button",{className:"art-draftall ghost",disabled:draftingAll,onClick:()=>onDraftAll("redraft"),
            title:"Design every location again from the screenplay \u2014 asks first; replaces the current specs and layouts, including your edits"},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":"Redesign all\u2026"),
          missingAll.length>0 && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId||!!sceneRun,onClick:()=>startAllBatch(true),
            title:"Generate the plate of every drafted location that doesn't have one yet (a room's parent first) \u2014 existing plates are left as they are"
              +(waitingLayout ? ". "+waitingLayout+" more wait for their shared layout to be reviewed (Spatial Layout & Staging)" : "")},
            React.createElement(Icon.sparkles,{s:14}), batchActiveId?"Generating\u2026":("Generate "+missingAll.length+" missing plate"+(missingAll.length!==1?"s":"")),
            batchChip(missingAll.map(id=>plateRefsOf(byLocId[id], missingAll)))),
          (!missingAll.length && eligibleAll>0) && React.createElement("button",{className:"art-draftall ghost",disabled:!!batchActiveId||!!sceneRun,onClick:()=>startAllBatch(false),
            title:"Regenerate the location plates \u2014 you'll be asked before anything is redone, with the price"},
            React.createElement(Icon.sparkles,{s:14}), batchActiveId?"Generating\u2026":"Regenerate plates\u2026")))),
    sceneRun && React.createElement("div",{className:"prop-review-actions",role:"status"},
      React.createElement("span",null,"Making Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")+"'s plates \u2014 "+sceneRun.i+" of "+sceneRun.total+" \u00b7 "+sceneRun.label),
      React.createElement("button",{className:"char-draft-btn ghost",onClick:()=>{ sceneStop.current = true; }},"Stop after this one")),
    BatchBar && React.createElement(BatchBar,{batch,noun:"location"}),
    /* THE SLATE (owner 2026-10-22, option A): one bar laid out like a film slate — labelled cells split by hairlines:
       how many places (and rooms & times), the style for every location, the scene to focus, and search */
    list.length>0 && React.createElement("div",{className:"loc-slate",role:"group","aria-label":"Locations: count, style, scene and search"},
      React.createElement("div",{className:"loc-slate-cell loc-slate-count",
          title:groups.length+" place"+(groups.length!==1?"s":"")+((sluglineUnits||[]).length ? " and "+(sluglineUnits||[]).length+" rooms & times from the sluglines" : "")},
        React.createElement("span",{className:"loc-slate-lab"},"Places"),
        React.createElement("b",null, groups.length+((sluglineUnits||[]).length ? " \u00b7 "+(sluglineUnits||[]).length+" rooms" : ""))),
      React.createElement("div",{className:"loc-slate-cell loc-slate-style"},
        React.createElement("span",{className:"loc-slate-lab"}, allStyling ? ("Inventing\u2026 "+allStyling.i+"/"+allStyling.total) : "Style \u00b7 all"),
      // Render style stays editable; world scale is always resolved from the scene's occupants.
        React.createElement("div",{className:"char-style-all",
          title:"Apply one render style to ALL locations at once. Each location can still be overridden on its own card."},
        React.createElement(window.RenderStylePicker,{context:"location",value:allStyleKey,disabled:!!allStyling,
          placeholderLabel:"Mixed — per location",onPick:applyStyleAll}))),
      sceneList.length>0 && React.createElement("div",{className:"loc-slate-cell loc-slate-scene prop-scenebar"},
        React.createElement("span",{className:"loc-slate-lab"},"Scene"),
        React.createElement("select",{className:"prop-select prop-scenebar-select",value:sceneFilter,
          onChange:e=>setSceneFilter(e.target.value)},
          React.createElement("option",{value:""},"All scenes \u2014 show every location"),
          sceneList.map(s=>{
            const n = groups.filter(g=>g.members.some(l=>inScene(l,s.id))).length;
            return React.createElement("option",{key:s.id,value:s.id},
              "Scene "+String(s.no).padStart(2,"0")+" \u00b7 "+(s.title||"")+"  ("+n+" location"+(n!==1?"s":"")+")");
          }))),
      React.createElement("div",{className:"loc-slate-cell loc-slate-search"+((searchOpen||q)?" open":"")},
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
        q && React.createElement("button",{className:"prop-search-clear",title:"Clear search",onClick:(e)=>{ e.stopPropagation(); setQuery(""); setSearchOpen(false); }},React.createElement(Icon.x,{s:14}))))),
    // a focused scene's own batch: under the slate
    (sceneFilter && (sceneMissingN>0 || draftedIds(shown).length>0)) && React.createElement("div",{className:"loc-slate-acts"},
        (sceneFilter && sceneMissingN>0) && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId||!!sceneRun,onClick:startSceneRun,
          title:"Make every plate this scene needs that doesn't exist yet: "+plan.masters.length+" location plate"+(plan.masters.length!==1?"s":"")+" (a room's parent first), then "+plan.units.length+" room & time plate"+(plan.units.length!==1?"s":"")
            +(plan.waiting ? ". "+plan.waiting+" more wait for a shared layout to be reviewed (Spatial Layout & Staging)" : "")},
          React.createElement(Icon.sparkles,{s:14}),
          sceneRun?"Generating\u2026":("Generate "+sceneMissingN+" missing in Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")),
          batchChip(sceneRefsList(plan))),
        (sceneFilter && !sceneMissingN && draftedIds(shown).length>0) && React.createElement("button",{className:"art-draftall ghost",disabled:!!batchActiveId||!!sceneRun,onClick:startSceneRegenerate,
          title:"Regenerate this scene's location plates \u2014 you'll be asked before anything is redone, with the price"},
          React.createElement(Icon.sparkles,{s:14}),
          batchActiveId?"Generating\u2026":("Regenerate Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")+"\u2026"))),
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
                  onDraftStaging,draftingStage:draftingStageId===l.id,sluglineUnits,onUpdateUnit,onRemoveUnit,readOnly,
                  samePlace:samePlace.filter(s=>s.cardId===l.id||s.headingId===l.id),mergeChoices:mergeChoicesFor(l),
                  onMergeLocations,onPlaceDecision})}))),
              React.createElement(PagerBar,{pager,noun:"location"}))
          : React.createElement("div",{className:"prop-empty"},
              React.createElement("div",{className:"art-soon-t"}, sceneFilter ? "No locations in this scene" : "No matching locations"),
              React.createElement("button",{className:"art-draftall",style:{marginTop:16},
                onClick:()=>{ setSceneFilter(""); setQuery(""); }},"Show all locations")))
      : React.createElement("div",{className:"prop-empty"},
          React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon.layers,{s:30})),
          React.createElement("div",{className:"art-soon-t"},"No locations yet"),
          React.createElement("div",{className:"art-soon-d"}, scriptHasLocs
            ? "Your screenplay names continuity-bearing places and screenplay-addressable spaces. \u201cDesign all locations\u201d builds the location hierarchy, then derives its rooms & times and any extra spaces."
            : "Write the scene's staged place in the Writers' Room first. Room-level sluglines can group under an evidenced parent place; extra implied spaces can live in the scene action."),
          scriptHasLocs
            ? React.createElement("div",{style:{display:"flex",gap:8,marginTop:16}},
                React.createElement("button",{className:"art-draftall",disabled:draftingAll,onClick:()=>onDraftAll()},
                  React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":"Design all locations"))
            : React.createElement("div",{className:"art-soon-d",style:{marginTop:12}},"No screenplay-staged location anchor yet.")));
}
window.LocationSheets = LocationSheets;
window.locationWorkspaceGroups=locationWorkspaceGroups;

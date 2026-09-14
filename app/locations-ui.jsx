/* locations-ui.jsx — The Art Room ▸ Locations tab (React).
   Mirrors PropSheets: derive-from-screenplay → draft fields → generate a multi-angle
   coverage plate → screenplay-derived INT/EXT side sheets → per-scene batch. Adds
   continuity-state plates and reads the Style Bible preset assigned to each
   location's scenes. */

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

/* Keep the canonical location's single Studio entry in the shared card fold. */
function LocationBlenderStudioSection({location,readOnly=false}){
  const studioLocation=location||{};
  return window.BlenderStudioEntry && React.createElement(CardFold,{label:"Blender Studio · reusable set",defaultOpen:false},
    React.createElement(window.BlenderStudioEntry,{
      location:studioLocation,
      references:(typeof nbGetMeta==="function"&&nbGetMeta(studioLocation.id))
        ? [{entityId:studioLocation.id,label:studioLocation.name||"Location",kind:"location"}] : [],
      readOnly,compact:true}));
}
window.LocationBlenderStudioSection=LocationBlenderStudioSection;

function LocationSheet({ l, project, scenes, drafts, onUpdate, onDelete, onDraft, drafting, onView, batchActiveId, onBatchDone, onChipClick, onDraftStaging, draftingStage, sluglineUnits, onUpdateUnit, onRemoveUnit, readOnly=false }){
  const d = locVisualDefaults(l);
  const scenePresets = (typeof locScenePresets==="function") ? locScenePresets(l, project) : [];
  const locationUnits=(sluglineUnits||[]).filter(u=>u&&!u.orphan&&
    (String(u.subspaceKey||u.locationKey||"")===String(l.key||"") || (l.scope==="compound"&&String(u.locationKey||"")===String(l.key||""))));
  const displaySide=(typeof locationEffectiveSide==="function")
    ? locationEffectiveSide(l,locationUnits,l.parentLocation?[]:(l.coverageSheets||[]),l.parentLocation?[]:(l.childLocations||[]))
    : (l.intExt||"INT");
  const displaySideLabel=displaySide==="INT/EXT"?"INT+EXT":displaySide;
  const finalPrompt = combinedLocationPrompt(l, project, {});
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
    l.continuityAnchors&&("Continuity anchors: "+l.continuityAnchors), l.significance&&("Story significance: "+l.significance),
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
    if(key!=="surprise"){ onUpdate(l.id, { renderStyleKey:key, renderStyle:(typeof window.renderStyleText==="function" ? window.renderStyleText("loc", key) : (LOC_TEXT[key]||LOC_TEXT.photoreal)) }); return; }
    onUpdate(l.id, { renderStyleKey:"surprise" });
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
      const rootUrl=parentRefUrl||((typeof nbGetImage==="function")?nbGetImage(l.parentLocation.id):"");
      if(rootUrl) out.push({url:rootUrl,kind:"location",ready:true,required:false,
        refId:"continuity-root-"+l.parentLocation.id,label:l.parentLocation.name||"Continuity root",
        note:(l.parentLocation.name||"continuity root")+" master plate — inherit its approved architecture, material language, scale and continuity anchors; preserve this child space's own geometry"});
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
  const toggleMasterRef = (rid)=> setMasterRefOff(off=> off.indexOf(rid)>=0 ? off.filter(x=>x!==rid) : [...off, rid]);

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
    entity: l,
    /* Clear cascades to this location's time-of-day variant plates so they aren't
       orphaned in storage. */
    relatedClearIds: ()=> Array.from(new Set([
      ...(l.variants||[]).map(v=> (typeof locationAppearanceStateAssetId==="function")
        ? locationAppearanceStateAssetId(l,v,sluglineUnits||[]) : l.id+"-"+v.id),
      ...(l.coverageSheets||[]).map(v=>l.id+"-"+v.id),
      ...((typeof sluglineUnitImageId==="function") ? units.map(u=>sluglineUnitImageId(u.key)) : [])
    ])),
    buildFinal: ()=> stagingDraftRef.current
      ? combinedLocationPrompt({ ...l, staging: stagingDraftRef.current }, project, {})
      : finalPrompt,
    buildFromPhoto: ()=> buildLocationFromPhotoPrompt(l, project),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    attachments: async ()=> buildMasterRefs()
      .filter(r=>r.url && masterRefOff.indexOf(r.refId)<0)
      .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note })),
    attachmentsText: (refs)=> refs && refs.length
      ? "REFERENCE IMAGES are attached: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")
        +". Read screenplay pages together as evidence for permanent geography. A continuity-root plate is binding inherited identity, not a panel map. "
        +"They are NOT a quadrant map: do not make one panel per page or per scene. The 2x2 is four different camera views of the same coherent space, following the prompt's panel plan. "
        +"Aggregate architecture, fixtures, sightlines and action affordances only. Do NOT bake in scene-specific time of day, weather or progression (for example NIGHT/rain versus DAWN); those belong to each slugline unit's appearance plate. "
        +"Never copy screenplay typography, page borders, text, captions or layout."
      : "",
    metaExtra:({mode,prompt})=>({
      specPrompt:locationCanonicalSpecPrompt(mode,prompt,finalPrompt,gen.genMeta)
    }),
    /* NO set-dressing refs at generation — the clean plate anchors the look;
       fixtures are painted in afterwards via the Edit panel's Set-dressing buttons */
    buildEdit: (instr)=>
      "Edit this location reference plate for "+(l.name||"the place")+". "
      +"Apply ONLY this change: "+instr+". "
      +"Preserve everything else \u2014 the SAME architecture, proportions, materials and light "
      +"across all panels. Keep the same multi-angle grid of the same empty space. "
      +"Do not redesign or re-imagine the location.",
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
  const appearanceStates = (typeof locationAppearanceStates==="function")
    ? locationAppearanceStates(l,units)
    : (l.variants||[]);

  // Screenplay-derived states are projections of the matching slugline unit. The
  // two folds share one asset id and one appearance description; only genuinely
  // extra, non-screenplay states remain independent variants on the location.
  const addVariant = ()=>{
    const used = appearanceStates.map(v=>v.time);
    const suggest = (l.times||[]).find(t=>used.indexOf(t)<0) || "Night";
    onUpdate(l.id,{ variants:[...(l.variants||[]), { id:"v"+Date.now().toString(36), time:suggest, state:"" }] });
  };
  const updateVariant = (vid,patch)=> onUpdate(l.id,{ variants:(l.variants||[]).map(v=>v.id===vid?{...v,...patch}:v) });
  const removeVariant = (vid)=> onUpdate(l.id,{ variants:(l.variants||[]).filter(v=>v.id!==vid) });

  return React.createElement("div",{className:"sheet-card"+(batchActiveId===l.id?" batch-on":""),"data-location-card":l.id},
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
              title:displaySideLabel+" screenplay coverage"},
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
          React.createElement("div",{className:"loc-scope-line"},
            l.parentLocation
              ? React.createElement(React.Fragment,null,
                  React.createElement("span",{className:"loc-scope-chip child"},"Child space"),
                  React.createElement("span",null," within ",React.createElement("b",null,l.parentLocation.name)," \u00b7 inherits continuity"))
              : React.createElement(React.Fragment,null,
                  React.createElement("span",{className:"loc-scope-chip "+(l.scope==="compound"?"compound":"atomic")},l.scope==="compound"?"Compound place":"Self-contained place"),
                  l.scope==="compound"&&React.createElement("span",null,(l.childLocations||[]).length+" filmable subspace"+((l.childLocations||[]).length===1?"":"s")))),
          (l.childLocations||[]).length>0 && React.createElement("div",{className:"loc-child-row"},
            React.createElement("span",{className:"loc-child-lab"},"Contains"),
            l.childLocations.map(c=>React.createElement("span",{className:"loc-child-chip",key:c.id},c.name))),
          null),
        // one flex row (like Props' head actions) \u2014 otherwise .sheet-head's column
        // layout stacks each button on its own full-width line
        React.createElement("div",{className:"sheet-head-actions"},
          React.createElement("button",{className:"char-draft-btn"+(drafting?" busy":""),disabled:drafting,onClick:()=>onDraft(l)},
            React.createElement(Icon.sparkles,{s:12}), drafting?"Drafting\u2026":"Draft specification"),
          window.QaCheckButton && React.createElement(window.QaCheckButton,{ gen, name:l.name, noun:"location plate",
            specFields:()=>({ architecture:(l.architecture||""), materials:(l.materials||""), lighting:(l.lighting||"") }),
            onApplySpec:(patch)=>onUpdate(l.id, patch) }))),

      React.createElement("div",{className:"char-style-row"},
        React.createElement("span",{className:"char-style-lab"},"Render style"),
        React.createElement("div",{className:"char-style-pick"},
          React.createElement(window.RenderStylePicker,{value:l.renderStyleKey||(window.turnDefaultRenderStyleKey?window.turnDefaultRenderStyleKey():"photoreal"),disabled:styling,onPick:pickLocStyle}),
          (window.turnCanLockStyles && window.turnCanLockStyles()) && React.createElement("span",{className:"char-style-count"+(((window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)>=(window.turnGlobalStyleCap||40))?" full":""),title:"Global render styles ("+(window.turnGlobalStyleCap||40)+" max, admin-managed). You can save up to "+(window.turnPersonalStyleCap||10)+" personal render styles. Manage via Styles in the top bar."}, (window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)+"/"+(window.turnGlobalStyleCap||40))),
        styling && React.createElement("span",{className:"char-style-busy"},React.createElement("span",{className:"ns-spin"}),"Inventing\u2026"),
        (!styling && l.renderStyleKey==="surprise" && l.surpriseRender && l.surpriseRender.label) &&
          React.createElement("span",{className:"char-style-name",title:"Re-roll a new surprise style",onClick:rollSurprise},
            l.surpriseRender.label," \u21bb"),
        (!styling && l.renderStyleKey==="surprise" && l.surpriseRender && l.surpriseRender.style && window.turnCanLockStyles && window.turnCanLockStyles()) &&
          React.createElement("button",{className:"char-style-lock",title:"Lock this style \u2014 keep it and reuse it across Characters, Props & Locations",onClick:lockSurprise},"\ud83d\udd12 Lock this style"),
        (!styling && unlockVisible && window.turnIsUserStyle && window.turnIsUserStyle(l.renderStyleKey)) &&
          React.createElement("span",{className:"char-style-name char-style-locked",title:"Your saved style \u2014 reusable everywhere. Click to unlock.",onClick:unlockCurrent},"\ud83d\udd12 saved \u00b7 unlock")),

      React.createElement("div",{className:"prop-scenes location-scenes"},
        React.createElement("span",{className:"prop-scenes-lab"},"SCENES"),
        React.createElement(SceneChipPager,{ none:"No scenes reference this place",
          items: locScenes.map(s=>({ key:s.id, label:String(s.no).padStart(2,"0"), className:"prop-scene-chip",
            title:s.title||("Scene "+s.no), onClick:()=>onChipClick&&onChipClick(s.id) })) })),

      React.createElement(CardFold,{label:"The space",defaultOpen:(!drafted && !!l.manual)},
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
          placeholder:"Fixtures, windows and orientation only \u2014 on/off state, weather and mood belong to an appearance state\u2026",onUpdate}),
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

      React.createElement(CardFold,{label:"Story significance",defaultOpen:false},
        React.createElement(SheetField,{label:"Narrative function \u2014 interpretive guidance",value:l.significance,multiline:true,
          placeholder:"Its dramatic role \u2014 what happens here, what it represents\u2026",onCommit:val=>onUpdate(l.id,{significance:val})})),

      React.createElement(CardFold,{label:"Screenplay sluglines",defaultOpen:units.length>0},
        React.createElement("div",{className:"loc-variants"},
          units.length
            ? units.map(u=>React.createElement(SluglineUnitCard,{key:u.key, l, u, project, scenes, drafts,
                parentGenUrl:gen.genUrl, onUpdateUnit, onRemoveUnit, onView}))
            : React.createElement("div",{className:"loc-variants-empty"},"No screenplay sluglines currently address this place or one of its subspaces."))),

      React.createElement(CardFold,{label:"Appearance states",defaultOpen:false},
        React.createElement("div",{className:"loc-variants"},
          appearanceStates.length
            ? appearanceStates.map(v=>React.createElement(LocationVariant,{
                key:v.unitKey||v.id, l, v, project, scenes, drafts, units,
                parentGenUrl:gen.genUrl,
                onTime:v.linkedUnit ? null : (t)=>updateVariant(v.id,{time:t}),
                onState:v.linkedUnit
                  ? (state)=>onUpdateUnit && onUpdateUnit(v.linkedUnit.key,{appearance:state})
                  : (state)=>updateVariant(v.id,{state}),
                onRemove:v.linkedUnit ? null : ()=>removeVariant(v.id),
                onView}))
            : React.createElement("div",{className:"loc-variants-empty"},"No appearance states yet \u2014 add a time, weather, dressing, damage or story-progress state."),
          React.createElement("button",{className:"art-draftall ghost loc-variant-add",onClick:addVariant},
            React.createElement(Icon.plus,{s:13}),"Add state"))),

      !l.parentLocation && React.createElement(CardFold,{label:"Coverage views",defaultOpen:coverageSheets.length>0},
        React.createElement("div",{className:"loc-variants"},
          coverageSheets.length
            ? coverageSheets.map((v,i)=>React.createElement(LocationCoverageSheet,{key:v.id, l, v, project, scenes, drafts, previousSheets:coverageSheets.slice(0,i), parentGenUrl:gen.genUrl, onView}))
            : React.createElement("div",{className:"loc-variants-empty"},"No additional visual coverage view is required by the current screenplay."))),

      React.createElement(CardFold,{label:"Staging & composition",defaultOpen:false,
        count: locStaged ? null : (stagingPrep ? "staging\u2026" : "not staged \u2014 drafts itself on first render")},
        React.createElement(StagingGrid,{l,onUpdate,onDraftStaging,draftingStage})),

      React.createElement(LocationBlenderStudioSection,{
        location:{id:l.id,name:l.name,parentLocationId:l.parentLocation&&l.parentLocation.id||null,
          rootLocationId:l.rootLocationId||l.id,
          context:{description:l.significance||"",architecture:l.architecture||"",materials:l.materials||"",staging:l.staging||""}},
        readOnly}),

      React.createElement(CardFold,{label:"Look dev",defaultOpen:false},
        scenePresets.length ? React.createElement("div",{className:"loc-style-note"},
          React.createElement(Icon.layers,{s:12}),
          React.createElement("span",null,"Scenes here use ",
            React.createElement("b",null,scenePresets.map(p=>p.name).join(", ")),
            " in the Styles tab. This reference plate is rendered grade-neutral on purpose \u2014 that scene grade is applied per shot, not baked into the plate.")) : null,
        React.createElement(SheetField,{label:"Render style \u2014 edit freely",value:l.renderStyle||d.renderStyle,multiline:true,
          placeholder:"photoreal architectural cinematography, wide lens, natural light\u2026",onCommit:val=>onUpdate(l.id,{renderStyle:val})})),

      React.createElement(CardFold,{label:"Compiled prompt",defaultOpen:false},
        React.createElement(CopyBox,{label:(gen.genUrl && gen.genMeta && gen.genMeta.prompt)
            ? "Compiled prompt \u2014 generated the CURRENT plate" : "Compiled prompt \u2014 sent to the image model",
          text:(gen.genUrl && gen.genMeta && gen.genMeta.prompt) || finalPrompt}),
        React.createElement(SheetField,{label:"Negative prompt \u2014 exclude",value:l.negativePrompt||d.negativePrompt,multiline:true,
          onCommit:val=>onUpdate(l.id,{negativePrompt:val})}))));
}

/* the 3×3 depth-grid staging editor — a top-down map of the space. Each cell is
   an EditText (empty = open space). Rows: Background / Midground / Foreground;
   cols: Left / Center / Right. Plus Floor, Scale Class and Camera/Lens. */
function StageCell({ label, sub, role, value, placeholder, onCommit, accent, wide }){
  const filled = !!(value||"").trim();
  return React.createElement("div",{className:"stage-cell"+(filled?" filled":"")+(accent?" "+accent:"")+(wide?" wide":"")},
    React.createElement("div",{className:"stage-cell-lab"},
      React.createElement("span",{className:"stage-cell-zone"},label,
        sub && React.createElement("span",{className:"stage-cell-sub"},sub)),
      role && React.createElement("span",{className:"stage-cell-role"},role)),
    React.createElement(EditText,{value:value||"",multiline:true,placeholder:placeholder||"open space\u2026",onCommit}));
}
function StagingGrid({ l, onUpdate, onDraftStaging, draftingStage }){
  const s = (typeof stagingOf==="function") ? stagingOf(l) : (l.staging||{bg:{},mid:{},fg:{}});
  const set = (patch)=>{
    const next = { viewLabel:s.viewLabel, scaleClass:s.scaleClass, lens:s.lens, floor:s.floor,
      bg:{...s.bg}, mid:{...s.mid}, fg:{...s.fg} };
    // patch is a path like {plane:'bg',col:'left',val:'...'} or {key:'scaleClass',val}
    if(patch.key){ next[patch.key] = patch.val; }
    else { next[patch.plane][patch.col] = patch.val; }
    onUpdate(l.id,{ staging: next });
  };
  return React.createElement("div",{className:"stage-wrap"},
    React.createElement("div",{className:"stage-toolbar"},
      React.createElement("div",{className:"stage-meta-fields"},
        React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Coverage view / representation"),
          React.createElement(EditText,{value:s.viewLabel||"",placeholder:(l.name||"Location")+" principal view\u2026",onCommit:val=>set({key:"viewLabel",val})})),
        React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Scale class"),
          React.createElement(EditText,{value:s.scaleClass||"",placeholder:"Human scale / Gigantism\u2026",onCommit:val=>set({key:"scaleClass",val})})),
        React.createElement("label",{className:"stage-meta-field"},
          React.createElement("span",{className:"stage-meta-lab"},"Camera / lens"),
          React.createElement(EditText,{value:s.lens||"",placeholder:"35mm wide / 100mm macro\u2026",onCommit:val=>set({key:"lens",val})}))),
      onDraftStaging && React.createElement("button",{className:"art-draftall",disabled:draftingStage,onClick:()=>onDraftStaging(l),
        title:"Let AI draft the selected view's staging and composition from the script"},
        React.createElement(Icon.sparkles,{s:13}), draftingStage?"Staging\u2026":"Draft staging")),
    React.createElement("div",{className:"stage-legend"},
      React.createElement(Icon.layers?Icon.layers:Icon.eye,{s:12}),
      React.createElement("span",null,"Top-down composition for this selected coverage view only \u2014 rows are depth (background \u2192 foreground), columns are screen position (left \u2192 right). Leave a cell blank for open space.")),
    React.createElement("div",{className:"stage-grid"},
      // BACKGROUND row (farthest from camera)
      React.createElement(StageCell,{label:"Background left",sub:"L3",value:s.bg.left,onCommit:val=>set({plane:"bg",col:"left",val})}),
      React.createElement(StageCell,{label:"Background center",role:"Wall A",accent:"wallA",value:s.bg.center,
        placeholder:"primary landmark\u2026",onCommit:val=>set({plane:"bg",col:"center",val})}),
      React.createElement(StageCell,{label:"Background right",sub:"R3",value:s.bg.right,onCommit:val=>set({plane:"bg",col:"right",val})}),
      // MIDGROUND row (subject plane)
      React.createElement(StageCell,{label:"Midground left",role:"Wall B",accent:"wallB",value:s.mid.left,
        placeholder:"primary framing element\u2026",onCommit:val=>set({plane:"mid",col:"left",val})}),
      React.createElement(StageCell,{label:"Midground center",role:"Subject",accent:"subject",value:s.mid.center,
        placeholder:"where the character stands \u2014 usually left empty",onCommit:val=>set({plane:"mid",col:"center",val})}),
      React.createElement(StageCell,{label:"Midground right",role:"Wall C",accent:"wallC",value:s.mid.right,
        placeholder:"secondary framing element\u2026",onCommit:val=>set({plane:"mid",col:"right",val})}),
      // FOREGROUND row (closest to camera)
      React.createElement(StageCell,{label:"Foreground left",sub:"L1",value:s.fg.left,placeholder:"foreground veil\u2026",onCommit:val=>set({plane:"fg",col:"left",val})}),
      React.createElement("div",{className:"stage-cell camera"},
        React.createElement("div",{className:"stage-cell-lab"},
          React.createElement("span",{className:"stage-cell-zone"},"Foreground center"),
          React.createElement("span",{className:"stage-cell-role"},"camera")),
        React.createElement("div",{className:"stage-camera-mark"},React.createElement(Icon.camera?Icon.camera:Icon.eye,{s:18}),
          React.createElement("span",null,s.lens||"viewer / lens"))),
      React.createElement(StageCell,{label:"Foreground right",sub:"R1",value:s.fg.right,placeholder:"foreground veil\u2026",onCommit:val=>set({plane:"fg",col:"right",val})})),
    // FLOOR strip
    React.createElement(StageCell,{label:"Floor \u2014 ground plane",value:s.floor,wide:true,
      placeholder:"surface texture underfoot\u2026",onCommit:val=>set({key:"floor",val})}));
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
      label:"Screenplay p"+(i+1), note:"full-scene screenplay page "+(i+1)+" for "+(v.name||l.name||"this coverage sheet")+" — use it to infer what the script implies, but do not render any text from it" }));
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
        label:p.name||"Previous coverage", note:(p.name||"previous coverage sheet")+" — earlier screenplay coverage; keep geometry and thresholds consistent" });
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
    return (await buildCoverageRefs())
      .filter(r=>r.ready && r.url && (r.required || coverageRefOff.indexOf(r.refId)<0))
      .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note }));
  };
  const gen = useImageGen({
    id, slotId: "loccov-"+id,
    entity: l,
    buildFinal: ()=> buildLocationCoveragePrompt(l, v, project),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    beforeGenerate: async ()=>{
      const refs = await buildCoverageRefs();
      const missing = refs.filter(r=>r.required && !r.ready);
      const ok = missing.length===0;
      if(!ok && typeof window.appToast==="function"){
        const prev = missing.some(r=>String(r.refId||"").indexOf(l.id+"-")===0);
        window.appToast(prev
          ? "Generate the earlier coverage sheet first — this one depends on it."
          : "Generate the parent location plate first — this coverage sheet needs it as a reference.");
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
    buildEdit: (instr)=> "Edit this "+(v.role||"INT")+" coverage sheet for "+(v.name||l.name||"the location")+". Apply ONLY: "+instr+". Keep it consistent with the parent location's architecture, materials and light.",
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
        React.createElement("b",null,v.name||"Coverage sheet")),
      React.createElement("span",{className:"loc-coverage-source",title:v.summary||""},sourceLabel)),
    v.summary && React.createElement("div",{className:"loc-variants-empty loc-coverage-summary"},v.summary),
    React.createElement(SheetFrame,{ gen, slotId:"loccov-"+id, name:(v.name||l.name||"Location")+" \u00b7 "+(v.role||"INT"),
      avatarColor:locSwatch(v.role), initials:(v.role||"?").slice(0,2).toUpperCase(), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a finished side plate", noun:"coverage sheet", compact:true,
      // match the unit-plate card: the empty slot itself imports on drop/click, which also
      // drops the redundant "Upload a finished coverage sheet" button below the generate CTA
      dropToImport:true,
      referenceControls: React.createElement(CoverageReferenceStrip,{ refs:refPreview, excludedIds:coverageRefOff, onToggle:toggleCoverageRef, onView }),
      generateDisabled:!canGenerateCoverage,
      generateDisabledLabel: missingPrev ? "Generate earlier coverage first" : "Generate parent plate first",
      generateDisabledTitle: missingPrev
        ? "This coverage sheet depends on an earlier coverage sheet. Generate that sheet first so the geometry and sightlines can carry forward."
        : "This coverage sheet needs the parent location plate as a visual reference before it can generate." }));
}

function CoverageReferenceStrip({ refs, excludedIds, onToggle, onView }){
  refs = refs || [];
  excludedIds = excludedIds || [];
  return React.createElement("div",{className:"coverage-refs"},
    React.createElement("div",{className:"shot-refs-lab"},
      React.createElement(Icon.layers,{s:11}),"Reference images"),
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
    label:"Screenplay p"+(i+1), note:"screenplay page "+(i+1)+" for "+(u.name||"this unit")+" \u2014 use it to infer what the script implies, but do not render any text from it" }));
  const grab = async (rid)=>{ let u2=(typeof nbGetImage==="function")?nbGetImage(rid):"";
    if(!u2 && typeof nbLoadImage==="function"){ try{ u2=await nbLoadImage(rid); }catch(e){} } return u2||""; };
  const parent = parentGenUrl || await grab(l.id);
  out.push({ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
    label:(l.name||"Parent location"), note:(l.name||"parent location")+" child/master plate \u2014 preserve this exact subspace geometry, materials and continuity anchors" });
  if(l.parentLocation && l.parentLocation.id){
    const rootUrl=await grab(l.parentLocation.id);
    if(rootUrl) out.push({url:rootUrl,kind:"location",refId:l.parentLocation.id,required:false,ready:true,
      label:l.parentLocation.name||"Continuity root",
      note:(l.parentLocation.name||"continuity root")+" reference \u2014 inherit its approved place identity, topology and locked anchors"});
  }
  return out;
}

/* One appearance-state projection. When linked to a screenplay slugline, both
   surfaces use the slugline unit's exact asset id and generation prompt. */
function LocationVariant({ l, v, project, scenes, drafts, units, parentGenUrl, onTime, onState, onRemove, onView }){
  const unit = v.linkedUnit || ((typeof locationVariantSluglineUnit==="function")
    ? locationVariantSluglineUnit(l,v,units||[]) : null);
  const stateUnit = unit ? {...unit,appearance:v.state||unit.appearance||""} : null;
  const id = (typeof locationAppearanceStateAssetId==="function")
    ? locationAppearanceStateAssetId(l,v,units||[]) : l.id+"-"+v.id;
  const slotId = "locstate-"+String(id).replace(/[^a-z0-9-]+/gi,"-");
  const pseudo = stateUnit ? { id, name:stateUnit.name, role:stateUnit.intExt,
    sceneNos:stateUnit.sceneNos||[], scriptExcerpt:String(stateUnit.scriptText||"").slice(0,720),
    summary:"Appearance state: "+(stateUnit.sluglines||[]).join(" \u00b7 ") } : null;
  const [refPreview,setRefPreview]=React.useState([]);
  const [refOff,setRefOff]=React.useState([]);
  const refsKey=[l.id,id,stateUnit&&stateUnit.scriptText,parentGenUrl,l.parentLocation&&l.parentLocation.id,(scenes&&scenes.length)].join("|");
  const buildRefs=async()=> stateUnit
    ? buildSluglineUnitReferences(l,stateUnit,id,pseudo,scenes,drafts,parentGenUrl)
    : [];
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
  const canGenerate=!stateUnit||(!stateUnit.orphan&&refPreview.length>0&&!missingRequired.length);
  const toggleRef=(rid)=>setRefOff(off=>{
    const r=refPreview.find(x=>x.refId===rid);
    if(r&&r.required)return off;
    return off.indexOf(rid)>=0?off.filter(x=>x!==rid):[...off,rid];
  });
  const collectRefs=async()=> (await buildRefs())
    .filter(r=>r.ready&&r.url&&(r.required||refOff.indexOf(r.refId)<0))
    .map(r=>({url:r.url,kind:r.kind==="script"?"script":"location",refId:r.refId,note:r.note}));
  const gen = useImageGen({
    id, slotId,
    entity: stateUnit ? {...l,appearanceState:stateUnit} : l,
    buildFinal: ()=> stateUnit && typeof buildSluglineUnitPrompt==="function"
      ? buildSluglineUnitPrompt(l,stateUnit,project)
      : buildLocationVariantPrompt(l, project, { time:v.time, state:v.state }),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    beforeGenerate: stateUnit ? async()=>{
      const refs=await buildRefs();
      const ok=!refs.some(r=>r.required&&!r.ready);
      if(!ok&&typeof window.appToast==="function")
        window.appToast("Generate the parent location plate first \u2014 this state needs it as a reference.");
      return ok;
    } : undefined,
    attachments: stateUnit ? collectRefs : undefined,
    attachmentsText: (refs)=> stateUnit&&refs&&refs.length
      ? "REFERENCE IMAGES are attached in this order: "+refs.map((r,i)=>"Image "+(i+1)+" = "+r.note).join("; ")+". Read screenplay snapshots as context only; never copy their text, typography, borders or layout."
      : "",
    metaExtra:({mode})=> mode==="edit"
      ? { locationDependencyKind:gen.genMeta&&gen.genMeta.locationDependencyKind,
          locationParentId:gen.genMeta&&gen.genMeta.locationParentId,
          locationParentIso:gen.genMeta&&gen.genMeta.locationParentIso,
          locationUpstream:gen.genMeta&&gen.genMeta.locationUpstream }
      : locationAssetDependencySnapshot(l.id,[],stateUnit?"slugline-unit":"continuity-state"),
    buildEdit: (instr)=> "Edit this establishing frame of "+(l.name||"the place")+" ("+v.time+"). Apply ONLY: "+instr+". Keep the same space and architecture.",
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
        : React.createElement(EditText,{value:v.time,placeholder:"Night / Day / Rain\u2026",onCommit:onTime}),
      onRemove&&React.createElement("button",{className:"loc-variant-x",title:"Remove variant",onClick:onRemove},React.createElement(Icon.x,{s:12}))),
    React.createElement(SheetField,{label:"Appearance state",value:v.state||"",multiline:true,
      placeholder:"Weather, practicals on/off, temporary dressing, damage or story-progress change\u2026",onCommit:onState}),
    stateUnit&&React.createElement("div",{className:"loc-shared-state-note"},"Shared with Screenplay Sluglines \u00b7 one plate, one version history"),
    React.createElement(SheetFrame,{ gen, slotId, name:(stateUnit&&stateUnit.name||l.name||"")+" \u00b7 "+v.time,
      avatarColor:locSwatch(stateUnit&&stateUnit.intExt||l.intExt), initials:(v.time||"?").slice(0,2).toUpperCase(), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a photo", noun:stateUnit?"state plate":"variant", compact:true,
      dropToImport:true,
      referenceControls:stateUnit&&React.createElement(CoverageReferenceStrip,{refs:refPreview,excludedIds:refOff,onToggle:toggleRef,onView}),
      generateDisabled:!canGenerate,
      generateDisabledLabel:"Generate parent plate first",
      generateDisabledTitle:"This state needs the parent location plate as a visual reference before it can generate." }));
}

/* SLUGLINE UNIT card — the atomic filmable unit of this master location
   (place × INT/EXT × time-of-day), with its own appearance state and coverage
   plate. Reuses the coverage-sheet machinery: the unit shapes like a sheet
   (sceneNos / scriptExcerpt / role) so the screenplay-snapshot references and
   SheetFrame work unchanged. Generation is per-unit click ONLY (never batched,
   never auto) and requires the parent master plate as its visual anchor. Orphan
   units (slugline edited away) stay visible so their plate and notes aren't
   silently lost; the user removes them explicitly. */
function SluglineUnitCard({ l, u, project, scenes, drafts, parentGenUrl, onUpdateUnit, onRemoveUnit, onView }){
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
  const pseudo = { id:imgId, name:u.name, role, sceneNos,
    scriptExcerpt:String(u.scriptText||"").slice(0,720),
    summary:"Slugline unit: "+(u.sluglines||[]).join(" \u00b7 ") };
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
      label:"Screenplay p"+(i+1), note:"screenplay page "+(i+1)+" for "+(u.name||"this unit")+" \u2014 use it to infer what the script implies, but do not render any text from it" }));
    const grab = async (rid)=>{ let u2=(typeof nbGetImage==="function")?nbGetImage(rid):"";
      if(!u2 && typeof nbLoadImage==="function"){ try{ u2=await nbLoadImage(rid); }catch(e){} } return u2||""; };
    const parent = parentGenUrl || await grab(l.id);
    out.push({ url:parent, kind:"location", refId:l.id, required:true, ready:!!parent,
      label:(l.name||"Parent location"), note:(l.name||"parent location")+" child/master plate \u2014 preserve this exact subspace geometry, materials and scale" });
    if(l.parentLocation){
      const rootUrl=await grab(l.parentLocation.id);
      if(rootUrl) out.push({url:rootUrl,kind:"location",refId:l.parentLocation.id,required:false,ready:true,
        label:l.parentLocation.name||"Continuity root",
        note:(l.parentLocation.name||"continuity root")+" reference \u2014 inherit its approved place identity, topology and locked anchors"});
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
  const collectRefs = async ()=> (await buildUnitRefs())
    .filter(r=>r.ready && r.url && (r.required || refOff.indexOf(r.refId)<0))
    .map(r=>({ url:r.url, kind:r.kind==="script"?"script":"location", refId:r.refId, note:r.note }));
  const gen = useImageGen({
    id: imgId, slotId, entity: l,
    buildFinal: ()=> (typeof buildSluglineUnitPrompt==="function")
      ? buildSluglineUnitPrompt(l, u, project)
      : buildLocationCoveragePrompt(l, pseudo, project),
    buildSimple: ()=> buildSimpleLocationPrompt(l),
    beforeGenerate: async ()=>{
      const refs = await buildUnitRefs();
      const missing = refs.filter(r=>r.required && !r.ready);
      const ok = missing.length===0;
      if(!ok && typeof window.appToast==="function")
        window.appToast("Generate the parent location plate first \u2014 this unit needs it as a reference.");
      return ok;
    },
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
    buildEdit: (instr)=> "Edit this "+role+" coverage plate for "+(u.name||l.name||"the location")+(u.time?(" at "+u.time):"")+". Apply ONLY: "+instr+". Keep it consistent with the parent location's architecture, materials and light.",
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
    u.orphan && React.createElement("div",{className:"loc-unit-orphan"},
      React.createElement(Icon.alert,{s:12}),
      React.createElement("span",null,"No longer in the script \u2014 kept so its plate and notes aren't lost."),
      onRemoveUnit && React.createElement("button",{className:"loc-unit-remove",
        title:"Delete this unit's stored data and generated plate",
        onClick:async ()=>{ if(typeof nbClearAsset==="function"){ try{ await nbClearAsset(imgId); }catch(e){} } onRemoveUnit(u.key); }},"Remove")),
    React.createElement(SheetField,{label:"Appearance state",value:u.appearance||"",multiline:true,
      // per-unit prompt built from THIS unit's own slugline facts (name, TOD, scenes) —
      // a static example ("dawn and raining") read as if every location should be dawn
      // and raining. Mirrors how character appearance state is framed: what THIS unit
      // looks like at THIS point in the story.
      placeholder:"How "+(u.name||l.name||"this space")+" looks"
        +(u.time?(" at "+String(u.time).toLowerCase()):"")
        +(sceneNos.length?(" in "+sourceLabel.toLowerCase()):"")
        +" \u2014 weather, light, wear, and what's changed here by this point in the story\u2026",
      onCommit:(val)=>onUpdateUnit && onUpdateUnit(u.key,{ appearance:val })}),
    React.createElement(UnitDressing,{ u, onUpdateUnit: u.orphan ? null : onUpdateUnit }),
    React.createElement(SheetFrame,{ gen, slotId, name:(u.name||l.name||"Location")+" \u00b7 "+role+(u.time?(" \u00b7 "+u.time):""),
      avatarColor:locSwatch(role), initials:role.slice(0,2), drafted:true, drafting:false,
      entity:viewerEntity, onView, slotPlaceholder:"Drop a finished unit plate", noun:"unit plate", compact:true,
      dropToImport:true,
      referenceControls: React.createElement(CoverageReferenceStrip,{ refs:refPreview, excludedIds:refOff, onToggle:toggleRef, onView }),
      generateDisabled:!canGenerate,
      generateDisabledLabel: u.orphan ? "No longer in script" : "Generate parent plate first",
      generateDisabledTitle: u.orphan
        ? "This unit's slugline is no longer in the screenplay, so it can't generate new plates. Its existing plate and notes are kept until you Remove it."
        : "This unit needs the parent location plate as a visual reference before it can generate." }));
}

/* per-unit STATE DRESSING — temporary/scene-specific items, kept separate from
   the location card's permanent baseline dressing. The user's curated list plus
   deterministic suggestions pulled from the unit's own action prose (skeleton
   `dressingDerived`). Click a suggestion to accept it into the list; the curated
   list is what the generation prompt binds. Orphans render read-only. */
function UnitDressing({ u, onUpdateUnit }){
  const [draft, setDraft] = React.useState("");
  const list = Array.isArray(u.dressing) ? u.dressing : [];
  const editable = !!onUpdateUnit;
  if(!editable && !list.length) return null;
  const lower = {}; list.forEach(x=>{ lower[String(x).toLowerCase()] = true; });
  const sugg = editable
    ? (Array.isArray(u.dressingDerived) ? u.dressingDerived : []).filter(x=>!lower[String(x).toLowerCase()])
    : [];
  const commit = (next)=> onUpdateUnit && onUpdateUnit(u.key, { dressing: next });
  const add = (val)=>{ const v = String(val||"").replace(/\s+/g," ").trim();
    setDraft("");
    if(!v || lower[v.toLowerCase()]) return;
    commit(list.concat([v])); };
  return React.createElement("div",{className:"loc-dress"},
    React.createElement("div",{className:"loc-dress-lab"},"State dressing"),
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
        title:"Mentioned in this unit's action prose \u2014 click to add",onClick:()=>add(x)},"+ "+x))));
}

function LocationSheets({ project, locations, scenes, drafts, onUpdate, onDraft, onDraftAll, onAdd, onDelete, draftingId, draftingIds, draftingAll, onPullFromScript, scriptHasLocs, onDraftStaging, draftingStageId, onScout, trashItems, onRestore, onPurge, lookbookStale, onApplyLookbook, onApplyLookbookDraftOnly, sluglineUnits, onUpdateUnit, onRemoveUnit, readOnly=false }){
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
  /* Every atomic child remains a full workspace. Grouping establishes an explicit
     inheritance edge; it never hides or deletes the child's plate/staging/history. */
  const list = rawLocations.filter(Boolean).map(l=>{
    const key=masterKeyOf(l);
    const parentKey=String(l.parentKey||locationFold[key]||"");
    const parent=parentKey?rawLocations.find(x=>x&&masterKeyOf(x)===parentKey):null;
    const children=rawLocations.filter(c=>c&&c!==l&&String(c.parentKey||locationFold[masterKeyOf(c)]||"")===key);
    const scope=parentKey?"atomic":(children.length?"compound":(l.scope||"atomic"));
    return {...l,key,parentKey,scope,
      continuityRootKey:parentKey||key,rootLocationId:rootLocationIdOf(l),
      parentLocation:parent?{id:parent.id,key:masterKeyOf(parent),name:parent.name}:null,
      childLocations:children.map(c=>({id:c.id,key:masterKeyOf(c),name:c.name,intExt:c.intExt}))};
  });
  // STYLE · ALL LOCATIONS — apply one render style to every location at once (mirrors the
  // cast's 'Style · all cast'); each location can still be overridden on its own card.
  const [allStyling, setAllStyling] = React.useState(null);   // null | {i,total} (surprise progress)
  const LOC_TEXT = window.LOC_RENDER_TEXT || {};
  const defaultStyleKey = window.turnDefaultRenderStyleKey ? window.turnDefaultRenderStyleKey() : "photoreal";
  const allStyleKey = (list.length && list.every(l=>(l.renderStyleKey||defaultStyleKey)===(list[0].renderStyleKey||defaultStyleKey)))
    ? (list[0].renderStyleKey||defaultStyleKey) : "";
  const locBibleOf = (l)=> [l.name&&("Name: "+l.name), l.architecture&&("Architecture: "+l.architecture),
    l.materials&&("Materials: "+l.materials), l.lighting&&("Lighting: "+l.lighting), l.significance&&("Significance: "+l.significance),
    (project&&project.genre)&&("Genre: "+project.genre)].filter(Boolean).join("\n");
  const applyStyleAll = async (key)=>{
    if(!key || allStyling) return;
    if(key!=="surprise"){ const t=(typeof window.renderStyleText==="function" ? window.renderStyleText("loc", key) : (LOC_TEXT[key]||LOC_TEXT.photoreal)); list.forEach(l=> onUpdate(l.id, { renderStyleKey:key, renderStyle:t })); return; }
    list.forEach(l=> onUpdate(l.id, { renderStyleKey:"surprise" }));
    if(!(typeof aiSurpriseStyleText==="function" && typeof aiAvailable==="function" && aiAvailable())) return;
    const need = list.filter(l=>!(l.surpriseRender && l.surpriseRender.style));
    if(!need.length) return;
    let ok = true;
    if(typeof window.appConfirm==="function") ok = await window.appConfirm({
      title:"Invent a surprise style for "+need.length+" location"+(need.length!==1?"s":"")+"?",
      body:"Each location gets its OWN bespoke fused style invented from its bible — that's "+need.length+" AI call"+(need.length!==1?"s":"")+".",
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
  // 9-up pagination; suspended while a batch runs so the queue can reach every card
  const pager = usePager(shown.length, !!batchActiveId);
  const sceneNoOf = (sid)=>{ const s=(scenes||[]).find(x=>x.id===sid); return s?s.no:sid; };

  // ---- batch generation ---- (eligible = drafted locations only; the spec is what
  // the plate is built from, so an undrafted/hand-added card never makes a generic plate)
  const draftedIds = (subset)=> subset.filter(l=> (typeof locVisualsDrafted==="function") ? locVisualsDrafted(l) : true).map(l=>l.id);
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
              text:"TURN separates continuity roots, child spaces and appearance states. A self-contained place such as Kitchen can stand alone. When the screenplay establishes Kitchen within Father's House, Father's House becomes the compound continuity root and Kitchen remains a full child workspace whose identity inherits the root's binding Continuity Anchors and Spatial Topology. Scene-specific time, active lights, weather and temporary dressing live in Screenplay Sluglines or Appearance States, not canonical place identity. Coverage Views are required visual plates, not automatic locations; Staging & Composition describes one selected view.\n\nLOCATIONS DERIVE FROM THE SCREENPLAY \u2014 stage the place or subspace in the Writers' Room scene, and 'Design all locations' pulls that geography into the Art Room."}))),
        React.createElement("div",{className:"art-intro-actions"},
          window.RecentlyDeleted && React.createElement(window.RecentlyDeleted,{
            items:trashItems,kind:"location",onRestore,onPurge,compact:true}),
          // NO arbitrary hand-adding: continuity places anchor master cards, room
          // headings become slugline units, and implied side spaces derive as coverage
          // sheets from screenplay body text + page snapshots.
          React.createElement("label",{className:"char-style-all",
            title:"Read only. Each location's plate scale is derived automatically from the characters who drive its scenes."},
            React.createElement("span",{className:"char-style-all-lab"},"World scale"),
            React.createElement("select",{className:"char-style-select",value:"",disabled:true,"aria-label":"World scale (read only)"},
              React.createElement("option",{value:""},"\u2728 Auto (by occupant)"))),
          React.createElement("button",{className:"art-draftall ghost",disabled:draftingAll||(!list.length&&!scriptHasLocs),onClick:onDraftAll,
            title:"Build every location from the screenplay in one pass \u2014 pull missing master places, derive screenplay sluglines and coverage views, draft each spec, and prepare Staging & Composition"},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":"Design all locations"),
          React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId||!eligibleAll,onClick:startAllBatch,
            title:"Generate (or regenerate) the coverage plate for every drafted location \u2014 you choose whether to redo ones that already have a plate"},
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
        q && React.createElement("span",{className:"prop-search-count"}, shown.length+" of "+list.length),
        q && React.createElement("button",{className:"prop-search-clear",title:"Clear search",onClick:(e)=>{ e.stopPropagation(); setQuery(""); setSearchOpen(false); }},React.createElement(Icon.x,{s:13}))),
      // Render style stays editable; world scale is always resolved from the scene's occupants.
      React.createElement("div",{className:"char-style-all",
        title:"Apply one render style to ALL locations at once. Each location can still be overridden on its own card."},
        React.createElement("span",{className:"char-style-all-lab"},
          allStyling ? ("Inventing… "+allStyling.i+"/"+allStyling.total) : "Style · all locations"),
        React.createElement(window.RenderStylePicker,{value:allStyleKey,disabled:!!allStyling,
          placeholderLabel:"Mixed — per location",onPick:applyStyleAll})),
      sceneList.length>0 && React.createElement("div",{className:"prop-scenebar"},
        React.createElement("span",{className:"prop-scenebar-lab"},React.createElement(Icon.layers,{s:13}),"Focus a scene"),
        React.createElement("select",{className:"prop-select prop-scenebar-select",value:sceneFilter,
          onChange:e=>setSceneFilter(e.target.value)},
          React.createElement("option",{value:""},"All scenes \u2014 show every location"),
          sceneList.map(s=>{
            const n = list.filter(l=>inScene(l,s.id)).length;
            return React.createElement("option",{key:s.id,value:s.id},
              "Scene "+String(s.no).padStart(2,"0")+" \u00b7 "+(s.title||"")+"  ("+n+" location"+(n!==1?"s":"")+")");
          })),
        sceneFilter && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId,onClick:startSceneBatch,
          title:"Generate coverage plates for the locations in this scene"},
          React.createElement(Icon.sparkles,{s:14}),
          batchActiveId?"Generating\u2026":("Generate all in Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")), typeof window.nbCostChip==="function" && window.nbCostChip(1)))),
    list.length
      ? (shown.length
          ? React.createElement(React.Fragment,null,
              React.createElement("div",{className:"sheet-grid"},
                pager.slice(shown).map(l=>React.createElement(LocationSheet,{key:l.id,l,project,scenes,drafts,onUpdate,onDelete,onDraft,
                  drafting:draftingId===l.id||(draftingIds||[]).indexOf(l.id)>=0||draftingAll,
                  // SWIPE SET — fullscreen swipes walk this location's master plate +
                  // screenplay coverage sheets in display order. Tapping anything else
                  // (unit plates, variants, reference snapshots) opens the plain viewer.
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
                  onDraftStaging,draftingStage:draftingStageId===l.id,sluglineUnits,onUpdateUnit,onRemoveUnit,readOnly}))),
              React.createElement(PagerBar,{pager,noun:"location"}))
          : React.createElement("div",{className:"prop-empty"},
              React.createElement("div",{className:"art-soon-t"}, sceneFilter ? "No locations in this scene" : "No matching locations"),
              React.createElement("button",{className:"art-draftall",style:{marginTop:16},
                onClick:()=>{ setSceneFilter(""); setQuery(""); }},"Show all locations")))
      : React.createElement("div",{className:"prop-empty"},
          React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon.layers,{s:30})),
          React.createElement("div",{className:"art-soon-t"},"No locations yet"),
          React.createElement("div",{className:"art-soon-d"}, scriptHasLocs
            ? "Your screenplay names continuity-bearing places and filmable subspaces. \u201cDesign all locations\u201d builds compound roots and inherited child workspaces, then derives slugline states and any required coverage views."
            : "Write the scene's staged place in the Writers' Room first. Room-level sluglines can group under an evidenced parent place; extra implied spaces can live in the scene action."),
          scriptHasLocs
            ? React.createElement("div",{style:{display:"flex",gap:8,marginTop:16}},
                React.createElement("button",{className:"art-draftall",disabled:draftingAll,onClick:onDraftAll},
                  React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":"Design all locations"))
            : React.createElement("div",{className:"art-soon-d",style:{marginTop:12}},"No screenplay-staged location anchor yet.")));
}
window.LocationSheets = LocationSheets;

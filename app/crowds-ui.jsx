/* CROWDS — Characters › Crowds (owner-approved 2026-10-27, "go ahead with 5 and 6"; app/crowds.js derives them).
   One card per crowd the screenplay calls for: where it appears, the screenplay lines that name it, its look (editable),
   how many people its image shows, and ONE group image (an image call, priced on its Generate button like every sheet).
   That image goes with every shot frame and Stage clip whose action names the crowd. "Don't use" keeps a crowd out
   without touching the screenplay. */
function CrowdSheet({ c, readOnly=false, onUpdateCrowd, onView }){
  const [showPrompt, setShowPrompt] = React.useState(false);
  const alwaysPrompts = (typeof window.useArtAlwaysPrompts==="function") ? window.useArtAlwaysPrompts() : false;
  const styleLine = ()=>{
    const cast = ((window.turnContinuity||{}).characters)||[];
    try{ return (typeof shotRenderStyleLine==="function" && typeof shotRenderStyleKey==="function")
      ? shotRenderStyleLine(shotRenderStyleKey(cast, null), cast) : ""; }catch(e){ return ""; }
  };
  const lookbook = ()=> (typeof window.turnLookbookBriefFor==="function") ? (window.turnLookbookBriefFor("characters")||"") : "";
  const finalPrompt = crowdImagePrompt(c, { style:styleLine(), lookbook:lookbook() });
  const gen0 = useImageGen({
    id: c.id, slotId: "crowdref-"+c.id,
    entity: { ...c, kind:"crowd" },
    buildFinal: ()=> finalPrompt,
    buildSimple: ()=> crowdImagePrompt({ ...c, excerpts:[] }, {}),
    buildEdit: (instr)=> "Edit this crowd reference image. Apply ONLY this change: "+instr+". Keep every other person, the row, "
      +"the plain mid-grey background and the even light exactly as they are. No text, no labels.",
  });
  // a group in a row reads best wide, whatever the dock's aspect
  const gen = Object.assign({}, gen0, { generate:(o)=>gen0.generate({ aspectRatio:"16:9", ...(o||{}) }) });
  const sceneLabel = (c.sceneNos||[]).map(n=>String(n).padStart(2,"0")).join(", ");
  const update = (patch)=>{ if(!readOnly && typeof onUpdateCrowd==="function") onUpdateCrowd(c.key, patch); };
  return React.createElement("div",{className:"sheet-card crowd-card"+(c.off?" off":""),"data-crowd-card":c.key},
    React.createElement(SheetFrame,{ gen, slotId:"crowdref-"+c.id, name:c.name, avatarColor:"#7a7f87",
      initials:String(c.name||"C").slice(0,2).toUpperCase(), drafted:true, drafting:false, onDraft:()=>{}, entity:{ ...c, kind:"crowd" }, onView,
      slotPlaceholder:"Drop a photo of the group", noun:"crowd reference", hideUploadButton:true,
      specGate:{ ready:true, hint:"" },
      menuExtra:alwaysPrompts ? [] : [{ label:showPrompt ? "Hide the image prompt" : "Show the image prompt", icon:Icon.eye,
        onClick:()=>setShowPrompt(v=>!v) }] }),
    React.createElement("div",{className:"sheet-body"},
      React.createElement("div",{className:"sheet-head"},
        React.createElement("div",{style:{flex:1,minWidth:0}},
          React.createElement("div",{className:"sheet-name"}, c.name),
          React.createElement("div",{className:"crowd-scenes"}, "Background people · Scene"+((c.sceneNos||[]).length!==1?"s ":" ")+(sceneLabel||"—")))),
      c.off && React.createElement("div",{className:"sheet-undrafted"},
        React.createElement(Icon.alert,{s:14}),
        React.createElement("span",null,"Not used: shots and Stage clips don't get this crowd's image.")),
      React.createElement(CardFold,{label:"Crowd",defaultOpen:true},
        (c.excerpts||[]).length>0 && React.createElement("div",{className:"crowd-excerpts"},
          React.createElement("div",{className:"obj-lab"},"In the screenplay"),
          c.excerpts.map((x,i)=>React.createElement("p",{key:i},x))),
        React.createElement(SheetField,{label:"Their look — wardrobe, ages, the feel of the group",value:c.look||"",multiline:true,
          placeholder:"e.g. late-season ferry passengers: windbreakers, rucksacks, a few families, mostly over forty…",
          onCommit:val=>update({ look:val })}),
        React.createElement("div",{className:"sheet-field"},
          React.createElement("div",{className:"obj-lab"},"People in the image"),
          React.createElement("select",{className:"prop-select",value:String(c.count||6),disabled:readOnly,
            onChange:e=>update({ count:Number(e.target.value) })},
            [3,4,5,6,7,8,9,10].map(n=>React.createElement("option",{key:n,value:String(n)},n+" people")))),
        !readOnly && React.createElement("button",{type:"button",className:"art-draftall ghost",
          title:c.off ? "Give this crowd's image to its shots and Stage clips again" : "Keep this crowd's image out of its shots and Stage clips (the screenplay doesn't change)",
          onClick:()=>update({ off:!c.off })}, c.off ? "Use this crowd" : "Don't use this crowd")),
      (showPrompt || alwaysPrompts) && React.createElement(CopyBox,{ label:"Image prompt", text:finalPrompt })));
}

function CrowdSheets({ project, scenes, drafts, readOnly=false, onUpdateCrowd, sceneFilter, onView }){
  const crowds = React.useMemo(()=> (typeof deriveCrowds==="function")
    ? deriveCrowds(scenes||[], drafts||{}, (project && project.crowds) || {}) : [],
    [scenes, drafts, project && project.crowds]);
  const shown = sceneFilter ? crowds.filter(c=>c.scenes.indexOf(sceneFilter)>=0) : crowds;
  if(!shown.length) return null;
  return React.createElement("section",{className:"crowd-section","aria-label":"Crowds"},
    React.createElement("div",{className:"crowd-section-head"},
      React.createElement("h3",null,"Crowds"),
      React.createElement("p",null,"The background people your screenplay calls for. One group image each keeps the same faces in every shot that names them; none of them is a named character.")),
    React.createElement("div",{className:"sheet-grid"},
      shown.map(c=>React.createElement(CrowdSheet,{ key:c.key, c, readOnly, onUpdateCrowd, onView }))));
}
window.CrowdSheets = CrowdSheets;

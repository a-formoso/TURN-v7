/* PREVIS on a location card (owner 2026-11-15: "build the card step and call it Previs").
   The set in 3D, drawn in the browser from the saved floor plan and the four cameras. Dress the set (one writing call)
   furnishes it to belong to the film. Make the location image sends the sheet to the image engine with the card's own
   prompt, in the card's render style: the result is a DRAFT shown under the button at once (owner 2026-11-15:
   "preview as soon as image is generated, with option for the user to use as location image or discard"), kept with
   the drafts before it until discarded. The floor plan stays the authority. This is the card's one road from the set
   to its image (the cloud build and its styling step left the card on 2026-11-15). */
function LocationPrevisStep({location:l,project,readOnly=false,onUpdate,hasImage=false,imageMeta=null,imageN}){
  const E=React.createElement,D=window.KinolotSetDressing,P=window.KinolotPrevis,api=window.KinolotCloudRender;
  const [sheet,setSheet]=React.useState(""),[error,setError]=React.useState(""),[drawing,setDrawing]=React.useState(false);
  const [info,setInfo]=React.useState(null),[busy,setBusy]=React.useState(""),[phase,setPhase]=React.useState("");
  const [notice,setNotice]=React.useState(""),[fail,setFail]=React.useState(""),[left,setLeft]=React.useState([]);
  const [tick,setTick]=React.useState(0),alive=React.useRef(true);
  // the drafts kept for this card, what the set and the look are now, and the open comparison
  const [kept,setKept]=React.useState({current:null,lastDiscarded:false,earlier:[]}),[nowKeys,setNowKeys]=React.useState(undefined);
  const [review,setReview]=React.useState(null),[camera,setCamera]=React.useState("all"),[wipe,setWipe]=React.useState(50),[other,setOther]=React.useState("");
  const dialog=React.useRef(null);
  // THE CAMERA CHECK (2026-11-11; on this section since 2026-11-15): each saved camera's view of the set, graded.
  // null = still checking, or the check could not run (it then says nothing).
  const [faults,setFaults]=React.useState(null),[fixing,setFixing]=React.useState(false),[fixNote,setFixNote]=React.useState("");
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{
    const bump=e=>{if(!e||!e.detail||!e.detail.id||e.detail.id===l.id)setTick(n=>n+1);},any=()=>setTick(n=>n+1);
    const moment=e=>{if(e&&e.detail&&e.detail.locationId===l.id)setTick(n=>n+1);};
    window.addEventListener("kinolot-previs-changed",bump);window.addEventListener("kinolot-set-moment",moment);
    ["nb-settings-changed","nb-model-changed","turn-pricing-changed"].forEach(n=>window.addEventListener(n,any));
    return ()=>{window.removeEventListener("kinolot-previs-changed",bump);window.removeEventListener("kinolot-set-moment",moment);
      ["nb-settings-changed","nb-model-changed","turn-pricing-changed"].forEach(n=>window.removeEventListener(n,any));};
  },[l.id]);
  // MOVING PARTS: the story moment the set is drawn at. A moment whose parts differ makes that state's own image.
  let moments=[],at=null;
  try{moments=api&&api.buildMoments?api.buildMoments(l):[];at=api&&api.buildMoment?api.buildMoment(l):null;}catch(_){moments=[];at=null;}
  let target=l.id,part=null;
  if(at&&typeof window.locationMovingPartsAt==="function")try{
    const states=window.locationMovingPartsAt(l,at),key=window.locationPartStateKey(states);
    if(key){part={loc:l.id,at,key,label:window.locationPartStateLabel(states)};target=part;}
  }catch(_){part=null;target=l.id;}
  const atKey=at?[at.sceneId,at.beatN,at.moment].join(":"):"";
  const becomes=part?"the \u201c"+part.label+"\u201d image":"the location image";
  // what the sheet is drawn from: the floor plan, the cameras, the saved dressing and the story moment
  const drawnFrom=(()=>{try{return [l.id,typeof locationSpatialPlanSigFor==="function"?locationSpatialPlanSigFor(l):"",
    typeof locationPlateLayoutSig==="function"?locationPlateLayoutSig(l,{panels:true}):"",(l.previs&&l.previs.iso)||"",atKey].join("|");}catch(_){return l.id+"|"+atKey;}})();
  const lookNow=(()=>{try{return typeof locationSpecSig==="function"?String(locationSpecSig(l)):"";}catch(_){return "";}})();
  React.useEffect(()=>{
    let live=true;setError("");
    let built;
    try{built=P.scene(l,undefined,at);}catch(e){setSheet("");setInfo(null);setError((e&&e.message)||"The floor plan is not ready.");return;}
    setInfo({dressed:built.dressed,parts:built.parts});setDrawing(true);
    P.sheet(built.scene,built.light,{panelWidth:640,type:"image/jpeg",quality:0.9})
      .then(s=>{if(live)setSheet(s.dataUrl);},e=>{if(live){setSheet("");setError((e&&e.message)||"The previs could not be drawn.");}})
      .finally(()=>{if(live)setDrawing(false);});
    return ()=>{live=false;};
  },[drawnFrom]);
  React.useEffect(()=>{
    let live=true;setFaults(null);
    if(api&&typeof api.assessCameras==="function")try{api.assessCameras(l).then(f=>{if(live)setFaults(f||{});},()=>{if(live)setFaults({});});}catch(_){setFaults({});}
    return ()=>{live=false;};
  },[drawnFrom]);
  // the kept drafts (read again whenever one is made, used, discarded or brought back)
  React.useEffect(()=>{
    let live=true;
    P.drafts(target).then(d=>{if(live)setKept(d);},()=>{if(live)setKept({current:null,lastDiscarded:false,earlier:[]});});
    return ()=>{live=false;};
  },[l.id,part?part.key:"",tick]);
  // what a draft must still match to be used: the set as drawn, and the card's description and look
  React.useEffect(()=>{
    let live=true;setNowKeys(undefined);
    P.keys(target).then(k=>{if(live)setNowKeys(k);},()=>{if(live)setNowKeys(null);});
    return ()=>{live=false;};
  },[drawnFrom,lookNow]);
  // the comparison opens as a modal whenever it is on the page (it leaves the page when closed)
  React.useEffect(()=>{const el=dialog.current;if(el&&review&&!el.open&&typeof el.showModal==="function")el.showModal();});
  const writable=()=>!readOnly&&(typeof window.turnArtRoomWritable!=="function"||window.turnArtRoomWritable());
  const run=async(name,fn,failText)=>{
    if(busy||!writable())return;
    setBusy(name);setFail("");setNotice("");
    try{await fn();}catch(e){if(alive.current)setFail((e&&e.message)||failText);}
    finally{if(alive.current){setBusy("");setPhase("");}}
  };
  const dress=()=>run("dress",async()=>{
    setLeft([]);
    const r=await D.draft(l,{project});
    // saved with the location even if this section was closed meanwhile: the call is paid for
    onUpdate(l.id,{previs:D.pack(r.dressing,{engine:D.MODEL})});
    if(alive.current){setLeft(r.report.left);setNotice("The set is dressed: "+r.report.parts+" shapes, from this card and its scenes.");}
  },"The set could not be dressed.");
  function undress(){
    if(busy||!writable()||!l.previs)return;
    const was=l.previs;
    onUpdate(l.id,{previs:null});setLeft([]);setNotice("");setFail("");
    if(typeof window.appToast==="function")window.appToast("The dressing was removed.","info",{action:{label:"Undo",onClick:()=>onUpdate(l.id,{previs:was})}});
  }
  const make=()=>run("render",async()=>{
    setPhase("drawing");
    await P.render(target,{project,onPhase:p=>{if(alive.current)setPhase(p);}});
    if(alive.current)setNotice("The draft is ready, just below. It becomes "+becomes+" only when you choose to use it.");
  },"The image could not be made.");
  const saveKept=()=>run("render",async()=>{
    setPhase("saving");await P.retrySave(target);
    if(alive.current)setNotice("The draft was saved. It is just below.");
  },"The draft could not be saved.");
  const useDraft=d=>run("use",async()=>{
    await P.use(target,d.meta.iso);
    if(alive.current){setReview(null);setNotice(part?"Saved as the \u201c"+part.label+"\u201d image. Shots at those moments use it in place of the location image."
      :"This draft is now the location image, at the top of the card."+(hasImage?" The image before it stays in the card\u2019s versions.":""));}
  },"The draft could not be used.");
  const discardDraft=d=>run("discard",async()=>{
    await P.discard(target,d.meta.iso);
    if(alive.current){setReview(null);setNotice("The draft was discarded. "+(part?"That state\u2019s image":"The location image")+" was not changed.");}
  },"The draft could not be discarded.");
  const bringBack=d=>run("restore",async()=>{
    await P.restore(target,d.meta.iso);
    if(alive.current){setReview(null);setNotice("That draft is the current one again. The draft it replaced is kept with the earlier drafts.");}
  },"The earlier draft could not be brought back.");
  const PANEL_NAMES={TL:"Top-left",TR:"Top-right",BL:"Bottom-left",BR:"Bottom-right"};
  const faulty=Object.entries(faults||{}).filter(([,why])=>why);
  // Fix cameras: only the cameras named by the check move, to clear views of this set; the others stay. Free.
  async function fixCameras(){
    if(fixing||busy||!writable()||!onUpdate||!faulty.length)return;
    setFixing(true);setFail("");setFixNote("");
    try{
      const list=((window.turnContinuity||{}).locations)||[],now=list.find(x=>x.id===l.id);
      if(!now)throw new Error("The open location changed. Open it again.");
      const keep=["TL","TR","BL","BR"].filter(k=>!faulty.some(([bad])=>bad===k));
      const proposal=await api.proposeCamerasAuto(now,list,{keep});
      const latest=((window.turnContinuity||{}).locations)||[],still=latest.find(x=>x.id===l.id);
      if(!still||!writable())throw new Error("The open location changed. Open it again.");
      onUpdate(l.id,{coverageViews:api.cameraProposalViews(still,proposal,latest)},{kind:"suggested-cameras"});
      if(alive.current)setFixNote("Cameras updated: "+proposal.panels.filter(x=>!keep.includes(x.key)).map(x=>PANEL_NAMES[x.key]+" is now \u201c"+x.label+"\u201d").join("; ")+". You can review them in 3 \u00b7 Cameras.");
    }catch(e){if(alive.current)setFail((e&&e.message)||"The cameras could not be fixed.");}
    finally{if(alive.current)setFixing(false);}
  }
  const pend=P.pending(target),working=busy==="render"||(pend.running&&!busy);
  let choice=null;try{choice=P.settings();}catch(_){choice=null;}
  const style=String((typeof locVisualDefaults==="function"?locVisualDefaults(l).renderStyle:"")||"").replace(/\s+/g," ").trim();
  const phaseText={drawing:"Drawing the sheet\u2026",generating:"Making the image\u2026 about a minute",saving:"Saving the draft\u2026"}[phase]||"Making the image\u2026";
  let fixStep=2;
  if(error&&!sheet)try{const first=(api.inputIssueList(l)||[])[0];if(first&&first.step===3)fixStep=3;}catch(_){fixStep=2;}
  if(error&&!sheet)return E(React.Fragment,null,
    E("p",{className:"loc-layer-note","data-testid":"previs-intro"},"The set in 3D, drawn in your browser from its floor plan and its four cameras. It is free and redraws at once."),
    E("div",{className:"loc-step-fixes","data-testid":"previs-not-ready"},
      E("p",{className:"loc-step-fixes-head"},"Previs needs the floor plan and the cameras first."),
      E("p",{style:{margin:"0 0 8px"}},error),
      E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>window.goToLocationStep&&window.goToLocationStep(l,fixStep)},fixStep===3?"Go to 3 \u00b7 Cameras":"Go to 2 \u00b7 Floor plan")));
  // ONE RULE: a draft can be used while it still matches the set and the look it was made from
  const stale=d=>!nowKeys||d.meta.setKey!==nowKeys.setKey||d.meta.lookKey!==nowKeys.lookKey;
  const checking=nowKeys===undefined;
  const isImage=d=>!part&&!!imageMeta&&imageMeta.previsDraftIso===d.meta.iso;
  const when=iso=>{try{return new Date(iso).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch(_){return "";}};
  const draftLine=d=>(d.meta.modelLabel||(typeof window.nbModelLabel==="function"?window.nbModelLabel(d.meta.modelId):"")||"Image engine")+(when(d.meta.iso)?" \u00b7 "+when(d.meta.iso):"");
  const status=d=>isImage(d)?"This is the location image now.":checking?"Checking it against the set\u2026":stale(d)?"Out of date."
    :d.used?(part?"Used as this state\u2019s image.":"Used as the location image before."):"Not used yet.";
  const canUse=d=>!readOnly&&!checking&&!stale(d)&&!isImage(d)&&!(part&&d.used);
  const useLabel=part?"Use as the \u201c"+part.label+"\u201d image":"Use as location image";
  const cur=kept.current,earlier=kept.earlier||[];
  const open=(mode,draft)=>{setCamera("all");setWipe(50);if(mode==="drafts"&&!earlier.some(d=>d.meta.iso===other))setOther(earlier[0]?earlier[0].meta.iso:"");setReview({mode,iso:draft?draft.meta.iso:""});};
  // the open comparison: a draft beside the sheet it was made from, or the current draft beside an earlier one
  const shown=review&&review.mode==="set"?[cur].concat(earlier).find(d=>d&&d.meta.iso===review.iso):null;
  const right=review&&review.mode==="drafts"?earlier.find(d=>d.meta.iso===other)||earlier[0]:null;
  const views={all:"All four views",TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const position={all:[0,0],TL:[0,0],TR:[-100,0],BL:[0,-100],BR:[-100,-100]}[camera];
  const imageStyle={width:camera==="all"?"100%":"200%",height:camera==="all"?"100%":"200%",left:position[0]+"%",top:position[1]+"%"};
  const pairLeft=shown?{url:shown.sheet,label:"The set in 3D"}:cur&&right?{url:cur.url,label:"Current draft \u00b7 "+draftLine(cur)}:null;
  const pairRight=shown?{url:shown.url,label:"The draft"}:cur&&right?{url:right.url,label:"Earlier draft \u00b7 "+draftLine(right)}:null;
  const thumb=(d,small,label)=>E("button",{key:d.meta.iso,type:"button",className:"style-draft-thumb"+(small?" small":""),disabled:!!busy,
      onClick:()=>open("set",d),title:d.sheet?"Open this draft beside the 3D set it was made from":"Open this draft","aria-label":label},
    E("img",{src:d.url,alt:label+": "+draftLine(d),draggable:false,loading:small?"lazy":undefined}),
    small?E("span",null,draftLine(d)):null);
  return E(React.Fragment,null,
    E("p",{className:"loc-layer-note","data-testid":"previs-intro"},
      "The set in 3D, drawn in your browser from 2 \u00b7 Floor plan and 3 \u00b7 Cameras. It is free and redraws at once. Check where everything stands, dress the set for this film, then make the location image from it."),
    E("div",{className:"loc-sub previs-view","data-testid":"previs-sheet"},
      E("h4",{className:"loc-step-sub"},"The set from its four cameras"),
      E("div",{className:"previs-sheet"+(drawing?" drawing":""),"aria-busy":drawing?"true":"false"},
        sheet?E("img",{src:sheet,alt:"Previs of "+(l.name||"this location")+": four camera views of the set",draggable:false})
          :E("span",{className:"previs-sheet-wait"},drawing?"Drawing the set\u2026":"")),
      E("p",{className:"loc-layer-note"},info&&info.dressed
        ?"Dressed: "+info.parts+" shapes on the saved floor plan. It redraws when the floor plan or a camera changes."
        :"Not dressed yet: these are the floor plan's plain blocks."),
      // the camera check: which views are blocked or empty, and the one-press fix
      faulty.length>0&&E("div",{className:"loc-step-fixes",role:"alert","data-testid":"camera-check"},
        E("p",{className:"loc-step-fixes-head"},faulty.length===1?"One camera does not show the set clearly:":faulty.length+" cameras do not show the set clearly:"),
        E("ul",null,faulty.map(([key,why])=>E("li",{key},E("span",null,PANEL_NAMES[key]+" camera: "+why)))),
        E("div",{className:"loc-step-actions"},
          !readOnly&&onUpdate&&E("button",{type:"button",className:"art-draftall",disabled:fixing||!!busy,"data-testid":"camera-check-fix",onClick:fixCameras,
            title:"Moves only the cameras named above to clear views of this set and keeps the others. Free."},fixing?"Finding clear views\u2026":"Fix cameras"),
          E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>window.goToLocationStep&&window.goToLocationStep(l,3)},"Go to 3 \u00b7 Cameras"))),
      fixNote&&!faulty.length&&E("p",{className:"loc-layer-note",role:"status","data-testid":"camera-check-fixed"},fixNote),
      // a set with moving parts: which story moment it is drawn at
      moments.length>1&&E("label",{className:"loc-cam-field loc-cloud-moment","data-testid":"previs-moment"},E("span",null,"Drawn at"),
        E("select",{className:"prop-select",value:atKey,disabled:!!busy||working,onChange:e=>api.setBuildMoment(l.id,e.target.value)},
          moments.map(m=>E("option",{key:m.key,value:m.key},m.label))),
        E("small",null,"The moving parts are drawn as they are at that moment. An image made at a moment becomes that state\u2019s own image, which shots at those moments use; the usual state makes the location image."))),
    E("div",{className:"loc-sub","data-testid":"previs-dress"},
      E("h4",{className:"loc-step-sub"},"Dress the set"),
      E("p",{className:"loc-layer-note"},"Furnishes the set from this card, the film and the scenes set here, so that it belongs to this story. The floor plan and the cameras stay as saved."),
      !readOnly&&E("div",{className:"loc-step-actions"},
        E("button",{type:"button",className:"art-draftall",disabled:!!busy||working,onClick:dress,
          title:"One writing call reads this card, the film and this location's scenes, and draws the set's dressing in 3D."},
          busy==="dress"?"Dressing the set\u2026 about a minute":(info&&info.dressed?"Dress it again":"Dress the set")+" (writing credits)"),
        info&&info.dressed&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy||working,onClick:undress,
          title:"Back to the floor plan's plain blocks. The floor plan itself is not changed."},"Remove the dressing")),
      left.length>0&&E("details",{className:"loc-nested-section","data-testid":"previs-adjusted"},
        E("summary",null,"Fitted or left out ("+left.length+")"),
        E("ul",{className:"previs-left"},left.map((line,i)=>E("li",{key:i},line))))),
    E("div",{className:"loc-sub","data-testid":"previs-render"},
      E("h4",{className:"loc-step-sub"},part?"Make the \u201c"+part.label+"\u201d image":"Make the location image"),
      E("p",{className:"loc-layer-note"},"The image engine follows this sheet and this card's description, in this card's render style"
        +(style?": "+(style.length>110?style.slice(0,107).replace(/\s+\S*$/,"")+"\u2026":style):"")+"."
        +(choice?" Engine: "+choice.label+", chosen in the top bar.":"")
        +" The result is a draft, shown here at once: "+becomes+" changes only when you choose to use it."),
      pend.unsaved&&!working
        ?E("div",{className:"loc-step-actions","data-testid":"previs-unsaved"},
            E("span",{className:"loc-spatial-error",role:"alert"},"An image was made but not saved."),
            E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:saveKept},"Save it"),
            E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>P.discardUnsaved(target)},"Discard it"))
        :!readOnly&&E("div",{className:"loc-step-actions"},
            E("button",{type:"button",className:"art-draftall",disabled:!!busy||working||drawing||!sheet,onClick:make,
              title:"One image from this sheet, kept as a draft. Nothing is replaced until you use it."},
              working?phaseText:cur||earlier.length?"Make another draft":part?"Make the image":"Make the location image",
              !working&&choice&&typeof window.nbCostChip==="function"?window.nbCostChip(1,choice.cost):null)),
      // THE DRAFT, RIGHT UNDER THE BUTTON: look at it, use it or discard it
      cur&&E("div",{className:"style-draft","data-testid":"previs-draft"},
        thumb(cur,false,"The draft"),
        E("p",{role:"status",className:"loc-layer-note"},draftLine(cur)+" \u00b7 "+status(cur)),
        !checking&&stale(cur)&&!isImage(cur)&&E("p",{className:"loc-spatial-error","data-testid":"previs-draft-stale"},P.OUT_OF_DATE),
        E("div",{className:"loc-step-actions"},
          canUse(cur)&&E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>useDraft(cur),
            title:"Nothing is generated."+(part?"":" The image you have now stays in the card's versions.")},busy==="use"?"Saving\u2026":useLabel),
          cur.sheet&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>open("set",cur),
            title:"The draft beside the 3D sheet it was made from, with a slider"},"Compare with the 3D set"),
          !readOnly&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>discardDraft(cur),
            title:"Takes this draft off the card. No image is changed; its image credits are not given back."},"Discard"))),
      !cur&&kept.lastDiscarded&&E("p",{role:"status",className:"loc-layer-note"},"You discarded the last draft."),
      earlier.length>0&&E("div",{className:"style-draft-earlier","data-testid":"previs-drafts-earlier"},
        E("p",{className:"loc-layer-note"},"Earlier drafts ("+earlier.length+"). Open one to look at it or to make it the current draft again."),
        E("div",{className:"style-draft-strip"},earlier.map(d=>thumb(d,true,"Earlier draft")))),
      // any two kept drafts side by side: two engines, or two tries with one engine
      cur&&earlier.length>0&&E("div",{className:"loc-step-actions"},
        E("button",{type:"button",className:"art-draftall ghost","data-testid":"previs-compare-drafts",disabled:!!busy,onClick:()=>open("drafts"),
          title:"The current draft beside an earlier one, each with its engine. No credits."},"Compare drafts"))),
    notice&&E("p",{className:"loc-layer-note previs-notice",role:"status"},notice),
    fail&&E("p",{className:"loc-spatial-error",role:"alert"},fail),
    review&&pairRight&&E("dialog",{ref:dialog,className:"loc-style-dialog","data-testid":"previs-review","aria-label":shown?"A draft beside the 3D set":"Two drafts side by side",onCancel:()=>setReview(null)},
      E("div",{className:"loc-cloud-render-head"},
        E("h3",null,!shown?"Compare drafts":shown===cur?"The draft and the 3D set":"Earlier draft"),
        E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setReview(null)},"Close")),
      E("p",null,shown
        ?(shown.sheet?"Left: the 3D sheet this draft was made from. Right: the draft. Move the slider to compare them, camera by camera: doors and windows, where things stand, what is in front of what. An image engine can change details.":"This draft's 3D sheet is no longer saved, so it is shown on its own.")
          +" Closing this keeps the draft on the card."
        :"Left: the current draft. Right: an earlier draft. Each is labelled with its engine. Move the slider to compare them, camera by camera. Nothing is changed by looking."),
      E("div",{className:"loc-style-toolbar"},
        !shown&&earlier.length>1&&E("label",null,"Earlier draft",E("select",{value:right?right.meta.iso:"",onChange:e=>setOther(e.target.value)},
          earlier.map(d=>E("option",{key:d.meta.iso,value:d.meta.iso},draftLine(d))))),
        E("label",null,"Camera",E("select",{value:camera,onChange:e=>setCamera(e.target.value)},Object.entries(views).map(([value,text])=>E("option",{key:value,value},text)))),
        pairLeft&&pairLeft.url&&E("label",null,"Left side shown: "+wipe+"%",E("input",{type:"range",min:0,max:100,value:wipe,onChange:e=>setWipe(Number(e.target.value)),"aria-label":"How much of the left image is shown"}))),
      pairLeft&&pairLeft.url&&E("div",{className:"loc-style-legend"},E("span",null,pairLeft.label),E("span",null,pairRight.label)),
      E("div",{className:"loc-style-compare","aria-label":views[camera]+" comparison"},
        E("div",{className:"loc-style-layer"},E("img",{src:pairRight.url,alt:views[camera]+" \u00b7 "+pairRight.label,style:imageStyle})),
        pairLeft&&pairLeft.url&&E("div",{className:"loc-style-layer",style:{clipPath:"inset(0 "+(100-wipe)+"% 0 0)"}},E("img",{src:pairLeft.url,alt:views[camera]+" \u00b7 "+pairLeft.label,style:imageStyle})),
        pairLeft&&pairLeft.url&&E("div",{className:"loc-style-divider",style:{left:wipe+"%"}})),
      fail&&E("p",{role:"alert",className:"loc-spatial-error"},fail),
      shown&&shown===cur&&!checking&&stale(cur)&&!isImage(cur)&&E("p",{className:"loc-spatial-error"},P.OUT_OF_DATE),
      shown&&shown===cur&&E("div",{className:"loc-cloud-render-actions"},
        canUse(cur)&&E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>useDraft(cur)},busy==="use"?"Saving\u2026":useLabel),
        !readOnly&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>discardDraft(cur)},"Discard")),
      shown&&shown!==cur&&!readOnly&&E("div",{className:"loc-cloud-render-actions"},
        E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>bringBack(shown)},"Make this the current draft")),
      !shown&&right&&!readOnly&&E("div",{className:"loc-cloud-render-actions"},
        E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>bringBack(right)},"Make the earlier draft the current one")),
      (shown&&shown!==cur||!shown)&&E("p",{className:"loc-layer-note"},"Only the current draft can become "+becomes+". Making an earlier draft current keeps the one it replaces with the earlier drafts; no image is generated.")));
}
window.LocationPrevisStep=LocationPrevisStep;

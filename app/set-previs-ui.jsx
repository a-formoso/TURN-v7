/* PREVIS on a location card (owner 2026-11-15: "build the card step and call it Previs").
   The set in 3D, drawn in the browser from the saved floor plan and the four cameras. Dress the set (one writing call)
   furnishes it to belong to the film. Make the location image sends the sheet to the image engine with the card's own
   prompt, in the card's render style: the result is a DRAFT shown under the button at once (owner 2026-11-15:
   "preview as soon as image is generated, with option for the user to use as location image or discard"), kept with
   the drafts before it until discarded. The floor plan stays the authority. This is the card's one road from the set
   to its image (the cloud build and its styling step left the card on 2026-11-15). */
/* PROGRESS BESIDE THE BUTTON (owner 2026-11-16: "show progress and a cancel button, inline, to the right"). The image
   engine reports no progress, so the bar runs against the time an image usually takes and stops short of full until
   the draft is saved. */
function previsProgress({phase,since,now,model}){
  const E=React.createElement,clock=x=>Math.floor(x/60)+":"+String(Math.floor(x%60)).padStart(2,"0");
  const estimate=/nano-banana/.test(String(model||""))?35:50,elapsed=Math.max(0,((now||since)-since)/1000);
  let pct,text;
  if(phase==="saving"){pct=96;text="Saving the draft";}
  else if(phase!=="generating"){pct=3;text="Drawing the set";}
  else{pct=Math.min(95,Math.max(4,Math.round(elapsed/estimate*100)));text=elapsed<=estimate?clock(elapsed)+" of about "+clock(estimate):"Longer than usual \u00b7 "+clock(elapsed);}
  return E("span",{className:"previs-progress",role:"status","data-testid":"previs-progress"},
    E("span",{className:"previs-progress-bar",role:"progressbar","aria-label":"Image progress","aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":pct},E("span",{style:{width:pct+"%"}})),
    E("span",{className:"previs-progress-text"},text));
}
// One run at a time, a clock while an image is made, and Cancel: the same in the location step and in a variant.
function usePrevisRun(alive,writable){
  const [busy,setBusy]=React.useState(""),[phase,setPhase]=React.useState(""),[notice,setNotice]=React.useState(""),[fail,setFail]=React.useState("");
  const [since,setSince]=React.useState(0),[now,setNow]=React.useState(0),token=React.useRef(0);
  React.useEffect(()=>{
    if(busy!=="render")return;
    const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);
  },[busy]);
  const run=async(name,fn,failText)=>{
    if(busy||!writable())return;
    const mine=++token.current,live=()=>alive.current&&token.current===mine;
    setBusy(name);setFail("");setNotice("");
    try{await fn(live);}catch(e){if(live())setFail((e&&e.message)||failText);}
    finally{if(live()){setBusy("");setPhase("");}}
  };
  const step=(live,name)=>{if(live()){setPhase(name);if(name!=="saving"){setSince(Date.now());setNow(Date.now());}}};
  // Cancel: the card is free at once; a request already sent finishes on its own and its result is thrown away
  const cancel=target=>{
    const r=window.KinolotPrevis.cancel(target);
    if(!r.ok){setNotice(r.reason==="saving"?"The draft is already being saved.":"The image has already finished.");return;}
    token.current++;setBusy("");setPhase("");setFail("");
    setNotice(r.submitted?"Cancelled. The image request had already been sent, so it may still be charged. Its result will not be saved."
      :"Cancelled before the image request was sent. Nothing was charged.");
  };
  return {busy,phase,notice,fail,since,now,setNotice,setFail,run,step,cancel};
}
function LocationPrevisStep({location:l,project,readOnly=false,onUpdate,hasImage=false,imageMeta=null,imageN,asRoom=false,onOpenCard}){
  const E=React.createElement,D=window.KinolotSetDressing,P=window.KinolotPrevis,api=window.KinolotCloudRender;
  const [sheet,setSheet]=React.useState(""),[error,setError]=React.useState(""),[drawing,setDrawing]=React.useState(false);
  const [info,setInfo]=React.useState(null),[left,setLeft]=React.useState([]);
  const [tick,setTick]=React.useState(0),alive=React.useRef(true),tries=React.useRef(0);
  const R=usePrevisRun(alive,()=>writable()),{busy,phase,notice,fail,setNotice,setFail,run}=R;
  // the drafts kept for this card, what the set and the look are now, and the open comparison
  const [kept,setKept]=React.useState({current:null,lastDiscarded:false,earlier:[]}),[nowKeys,setNowKeys]=React.useState(undefined);
  const [review,setReview]=React.useState(null),[camera,setCamera]=React.useState("all"),[wipe,setWipe]=React.useState(50),[other,setOther]=React.useState("");
  const dialog=React.useRef(null);
  // the image engine for this section's drafts (owner 2026-11-16: "the dropdown option for picking an image model of choice")
  const [engine,setEngine]=React.useState(()=>{try{return typeof window.nbGetModel==="function"?window.nbGetModel():"";}catch(_){return "";}});
  // THE CAMERA CHECK (2026-11-11; on this section since 2026-11-15): each saved camera's view of the set, graded.
  // null = still checking, or the check could not run (it then says nothing).
  const [faults,setFaults]=React.useState(null),[fixing,setFixing]=React.useState(false),[fixNote,setFixNote]=React.useState(""),[tightNote,setTightNote]=React.useState("");
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{
    const bump=e=>{if(!e||!e.detail||!e.detail.id||e.detail.id===l.id)setTick(n=>n+1);},any=()=>setTick(n=>n+1);
    const moment=e=>{if(e&&e.detail&&e.detail.locationId===l.id)setTick(n=>n+1);};
    window.addEventListener("kinolot-previs-changed",bump);window.addEventListener("kinolot-set-moment",moment);
    // "nb-prefetched": the film's images have arrived (a section opened straight after the film did read no drafts)
    ["nb-settings-changed","nb-model-changed","turn-pricing-changed","nb-prefetched"].forEach(n=>window.addEventListener(n,any));
    return ()=>{window.removeEventListener("kinolot-previs-changed",bump);window.removeEventListener("kinolot-set-moment",moment);
      ["nb-settings-changed","nb-model-changed","turn-pricing-changed","nb-prefetched"].forEach(n=>window.removeEventListener(n,any));};
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
  // a room (a card with a place above it) makes its own image, with the look of its place's finished image
  const isRoom=!!asRoom||!!l.parentLocation;
  const becomes=part?"the \u201c"+part.label+"\u201d image":isRoom?"this room\u2019s image":"the location image";
  // what the sheet is drawn from: the floor plan, the cameras, the saved dressing and the story moment
  const drawnFrom=(()=>{try{return [l.id,typeof locationSpatialPlanSigFor==="function"?locationSpatialPlanSigFor(l):"",
    typeof locationPlateLayoutSig==="function"?locationPlateLayoutSig(l,{panels:true}):"",typeof P.dressingSig==="function"?P.dressingSig(l):(l.previs&&l.previs.iso)||"",atKey].join("|");}catch(_){return l.id+"|"+atKey;}})();
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
    let again=null;
    P.drafts(target).then(d=>{if(live){tries.current=0;setKept(d);}},()=>{
      // a read that failed is tried again, a few times: the drafts are saved, so "none" must not be the answer to an error
      if(live&&tries.current<3){tries.current++;again=setTimeout(()=>setTick(n=>n+1),2500);}
    });
    return ()=>{live=false;clearTimeout(again);};
  },[l.id,part?part.key:"",tick]);
  // what a draft must still match to be used: the set as drawn, and the card's description and look
  React.useEffect(()=>{
    let live=true;setNowKeys(undefined);
    P.keys(target).then(k=>{if(live)setNowKeys(k);},()=>{if(live)setNowKeys(null);});
    return ()=>{live=false;};
  },[drawnFrom,lookNow,tick]);
  // the comparison opens as a modal whenever it is on the page (it leaves the page when closed)
  React.useEffect(()=>{const el=dialog.current;if(el&&review&&!el.open&&typeof el.showModal==="function")el.showModal();});
  // "Go to 2 / 3": on a room shown inside its place's Previs, the room's own card opens first (its floor plan and
  // cameras are there), then the section
  const go=step=>{
    if(asRoom&&typeof onOpenCard==="function"){onOpenCard(step===2?"layout":"");setTimeout(()=>{if(window.goToLocationStep)window.goToLocationStep(l,step);},350);return;}
    if(window.goToLocationStep)window.goToLocationStep(l,step);
  };
  const writable=()=>!readOnly&&(typeof window.turnArtRoomWritable!=="function"||window.turnArtRoomWritable());
  const dress=()=>run("dress",async live=>{
    setLeft([]);
    const r=await D.draft(l,{project});
    // saved with the location even if this section was closed meanwhile: the call is paid for
    onUpdate(l.id,{previs:D.pack(r.dressing,{engine:D.MODEL})});
    if(live()){setLeft(r.report.left);setNotice("The set is dressed: "+r.report.parts+" shapes, from this card and its scenes.");}
  },"The set could not be dressed.");
  function undress(){
    if(busy||!writable()||!l.previs)return;
    const was=l.previs;
    onUpdate(l.id,{previs:null});setLeft([]);setNotice("");setFail("");
    if(typeof window.appToast==="function")window.appToast("The dressing was removed.","info",{action:{label:"Undo",onClick:()=>onUpdate(l.id,{previs:was})}});
  }
  const make=()=>run("render",async live=>{
    R.step(live,"drawing");
    await P.render(target,{project,location:l,settings:choice||undefined,onPhase:p=>R.step(live,p)});
    if(live())setNotice("The draft is ready, just below. It becomes "+becomes+" only when you choose to use it.");
  },"The image could not be made.");
  const saveKept=()=>run("render",async live=>{
    R.step(live,"saving");await P.retrySave(target);
    if(live())setNotice("The draft was saved. It is just below.");
  },"The draft could not be saved.");
  const useDraft=d=>run("use",async live=>{
    await P.use(target,d.meta.iso);
    if(live()){setReview(null);setNotice(part?"Saved as the \u201c"+part.label+"\u201d image. Shots at those moments use it in place of the location image."
      :(isRoom?"This draft is now this room\u2019s image.":"This draft is now the location image, at the top of the card.")+(hasImage?" The image before it stays in the card\u2019s versions.":""));}
  },"The draft could not be used.");
  // DELETE (owner 2026-11-16: "give the user the option to delete drafts"): any draft, the current one or an earlier
  // one, for good, after asking. The comparison closes first: the question would open behind it.
  const deleteDraft=async d=>{
    if(busy||!writable()||!d)return;
    setReview(null);
    const theirs=part?"That state\u2019s image":isRoom?"This room\u2019s image":"The location image";
    const ok=typeof window.appConfirm!=="function"||await window.appConfirm({title:"Delete this draft?",
      body:"The draft is deleted for good. "+theirs+" is not changed, and the draft\u2019s image credits are not given back.",confirmLabel:"Delete",cancelLabel:"Keep it",danger:true});
    if(!ok)return;
    run("delete",async live=>{
      await P.remove(target,d.meta.iso);
      if(live())setNotice("The draft was deleted. "+theirs+" was not changed.");
    },"The draft could not be deleted.");
  };
  const bringBack=d=>run("restore",async live=>{
    await P.restore(target,d.meta.iso);
    if(live()){setReview(null);setNotice("That draft is the current one again. The draft it replaced is kept with the earlier drafts.");}
  },"The earlier draft could not be brought back.");
  const PANEL_NAMES={TL:"Top-left",TR:"Top-right",BL:"Bottom-left",BR:"Bottom-right"};
  const faulty=Object.entries(faults||{}).filter(([,why])=>why);
  // Fix cameras: only the cameras named by the check move, to clear views of this set; the others stay. Free.
  async function fixCameras(all){
    if(fixing||busy||!writable()||!onUpdate||(!all&&!faulty.length))return;
    setFixing(true);setFail("");setFixNote("");setTightNote("");
    try{
      const list=((window.turnContinuity||{}).locations)||[],now=list.find(x=>x.id===l.id);
      if(!now)throw new Error("The open location changed. Open it again.");
      const keep=all===true?[]:["TL","TR","BL","BR"].filter(k=>!faulty.some(([bad])=>bad===k));
      const proposal=await api.proposeCamerasAuto(now,list,{keep});
      const latest=((window.turnContinuity||{}).locations)||[],still=latest.find(x=>x.id===l.id);
      if(!still||!writable())throw new Error("The open location changed. Open it again.");
      onUpdate(l.id,{coverageViews:api.cameraProposalViews(still,proposal,latest)},{kind:"suggested-cameras"});
      /* A SPACE TOO TIGHT FOR CLEAR VIEWS (2026-11-21, a paid run on a car): in a minicab three cameras "stand
         inside or against part of the set" whatever is done, and Fix cameras put them back where they were and said
         nothing: the same red list, press after press. It now says that this is as clear as the space allows. */
      if(alive.current&&proposal.simple)setTightNote("This space is too tight for clearer views: the cameras now stand as clear of the set as it allows. The image can still be made from them. To change a view yourself, use Move a camera.");
      else if(alive.current)setFixNote("Cameras updated: "+proposal.panels.filter(x=>!keep.includes(x.key)).map(x=>PANEL_NAMES[x.key]+" is now \u201c"+x.label+"\u201d").join("; ")+". You can review them in Cameras.");
    }catch(e){if(alive.current)setFail((e&&e.message)||"The cameras could not be fixed.");}
    finally{if(alive.current)setFixing(false);}
  }
  // about what dressing this set costs, in writing credits (re-read when the set or the price table changes)
  const dressCost=React.useMemo(()=>{try{return error?null:D.estimate(l,{project});}catch(_){return null;}},[drawnFrom,error,tick]);
  const pend=P.pending(target),cancelling=pend.running&&pend.cancelled&&busy!=="render",working=busy==="render"||(pend.running&&!busy&&!pend.cancelled);
  let whole=null;try{whole=typeof P.look==="function"?P.look(l):null;}catch(_){whole=null;}
  let choice=null;try{choice=P.settings(engine||undefined,whole?2:1);}catch(_){choice=null;}
  const engines=(window.NB_MODELS||[]).map(m=>m&&m.id||m).filter(x=>typeof x==="string");
  const engineName=id=>typeof window.nbModelLabel==="function"?window.nbModelLabel(id):id;
  const style=String((typeof locVisualDefaults==="function"?locVisualDefaults(l).renderStyle:"")||"").replace(/\s+/g," ").trim();
  const phaseText="Making the image\u2026";
  let fixStep=2;
  if(error&&!sheet)try{const first=(api.inputIssueList(l)||[])[0];if(first&&first.step===3)fixStep=3;}catch(_){fixStep=2;}
  if(error&&!sheet)return E(React.Fragment,null,
    E("p",{className:"loc-layer-note","data-testid":"previs-intro"},"The set in 3D, drawn in your browser from its floor plan and its four cameras. It is free and redraws at once."),
    E("div",{className:"loc-step-fixes","data-testid":"previs-not-ready"},
      E("p",{className:"loc-step-fixes-head"},"Previs needs the floor plan and the cameras first."),
      E("p",{style:{margin:"0 0 8px"}},error),
      E("div",{className:"loc-step-actions"},
        // a room with no cameras of its own yet (or one standing in a wall): four clear ones in one press
        fixStep===3&&!readOnly&&onUpdate&&E("button",{type:"button",className:"art-draftall",disabled:fixing,"data-testid":"previs-set-cameras",onClick:()=>fixCameras(true),
          title:"Fits four cameras to this space, each checked for a clear view, and saves them. Free. You can change them in Cameras."},fixing?"Finding clear views\u2026":"Set 4 clear cameras (free)"),
        E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>go(fixStep)},fixStep===3?"Go to Cameras":"Go to Floor plan")),
      fail&&E("p",{className:"loc-spatial-error",role:"alert"},fail)));
  // ONE RULE: a draft can be used while it still matches the set and the look it was made from
  const stale=d=>!nowKeys||d.meta.setKey!==nowKeys.setKey||d.meta.lookKey!==nowKeys.lookKey;
  const checking=nowKeys===undefined;
  const isImage=d=>!part&&!!imageMeta&&imageMeta.previsDraftIso===d.meta.iso;
  const when=iso=>{try{return new Date(iso).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch(_){return "";}};
  const draftLine=d=>(d.meta.modelLabel||(typeof window.nbModelLabel==="function"?window.nbModelLabel(d.meta.modelId):"")||"Image engine")+(when(d.meta.iso)?" \u00b7 "+when(d.meta.iso):"");
  const status=d=>isImage(d)?(isRoom?"This is this room\u2019s image now.":"This is the location image now."):checking?"Checking it against the set\u2026":stale(d)?"Out of date."
    :d.used?(part?"Used as this state\u2019s image.":isRoom?"Used as this room\u2019s image before.":"Used as the location image before."):"Not used yet.";
  const canUse=d=>!readOnly&&!checking&&!stale(d)&&!isImage(d)&&!(part&&d.used);
  const useLabel=part?"Use as the \u201c"+part.label+"\u201d image":isRoom?"Use as this room\u2019s image":"Use as location image";
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
      "The set in 3D, drawn in your browser from Floor plan and Cameras. It is free and redraws at once. Check where everything stands, dress the set for this film, then make the location image from it."),
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
          E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>go(3)},"Go to Cameras"))),
      fixNote&&!faulty.length&&E("p",{className:"loc-layer-note",role:"status","data-testid":"camera-check-fixed"},fixNote),
      tightNote&&E("p",{className:"loc-layer-note",role:"status","data-testid":"camera-check-tight"},tightNote),
      // MOVE A CAMERA (owner 2026-11-16: a live camera on the dressed set, opened from here): the camera tool of
      // Cameras, drawing this same lit, dressed set; saving a view redraws the sheet above
      sheet&&!readOnly&&typeof onUpdate==="function"&&window.LocationCameraAngleWorkbench&&E("div",{className:"loc-step-actions previs-move-camera","data-testid":"previs-move-camera"},
        E(window.LocationCameraAngleWorkbench,{l,onUpdate,readOnly,inline:true,label:"Move a camera"})),
      // a set with moving parts: which story moment it is drawn at
      moments.length>1&&E("label",{className:"loc-cam-field loc-cloud-moment","data-testid":"previs-moment"},E("span",null,"Drawn at"),
        E("select",{className:"prop-select",value:atKey,disabled:!!busy||working,onChange:e=>api.setBuildMoment(l.id,e.target.value)},
          moments.map(m=>E("option",{key:m.key,value:m.key},m.label))),
        E("small",null,"The moving parts are drawn as they are at that moment. An image made at a moment becomes that state\u2019s own image, which shots at those moments use; the usual state makes the location image."))),
    E("div",{className:"loc-sub","data-testid":"previs-dress"},
      E("h4",{className:"loc-step-sub"},"Dress the set"),
      E("p",{className:"loc-layer-note"},"Furnishes the set from this card, the film and the scenes set here, so that it belongs to this story. The floor plan and the cameras stay as saved."),
      !readOnly&&E("div",{className:"loc-step-actions previs-dress-row"},
        E("button",{type:"button",className:"art-draftall",disabled:!!busy||working,onClick:dress,
          title:"One writing call reads this card, the film and this location's scenes, and draws the set's dressing in 3D."},
          busy==="dress"?"Dressing the set\u2026 about a minute":l.previs?"Dress it again":"Dress the set",
          // about how many writing credits: the same chip as an image's price, with the credit mark
          busy!=="dress"&&dressCost&&E("span",{className:"nb-cost","data-testid":"previs-dress-cost",
            title:"About "+dressCost.credits+" writing credits. An estimate: a writing call is charged by its length."},
            typeof window.nbCreditMark==="function"?window.nbCreditMark():null,String(dressCost.credits))),
        l.previs&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy||working,onClick:undress,
          title:"Back to the floor plan's plain blocks for this card. The floor plan itself is not changed."},"Remove dressing")),
      left.length>0&&E("details",{className:"loc-nested-section","data-testid":"previs-adjusted"},
        E("summary",null,"Fitted or left out ("+left.length+")"),
        E("ul",{className:"previs-left"},left.map((line,i)=>E("li",{key:i},line))))),
    E("div",{className:"loc-sub","data-testid":"previs-render"},
      // the heading, with what the step does behind the (i) beside it (owner 2026-11-16)
      E("h4",{className:"loc-step-sub loc-control-heading"},part?"Make the \u201c"+part.label+"\u201d image":isRoom?"Make this room\u2019s image":"Make the location image",
        window.InfoTip&&E(window.InfoTip,{label:"About making the image",text:"The image engine follows this sheet and this card's description, in this card's render style"
          +(style?": "+(style.length>110?style.slice(0,107).replace(/\s+\S*$/,"")+"\u2026":style):"")+"."
          +(whole?" It also gets "+whole.name+"\u2019s finished image, for the look only, so that the room and its place belong together.":"")
          +" The result is a draft, shown here at once: "+becomes+" changes only when you choose to use it."})),
      // plain blocks give the engine little to keep to: say so before an image is paid for
      info&&!info.dressed&&E("p",{className:"loc-layer-note","data-testid":"previs-undressed-hint"},"This set is not dressed yet. The image engine keeps to a dressed set much more closely than to plain blocks: dress the set first."),
      isRoom&&!whole&&E("p",{className:"loc-layer-note","data-testid":"previs-place-first"},"Make the image of the whole place first: this room then takes its look from it."),
      E("label",{className:"loc-cam-field previs-engine","data-testid":"previs-engine"},E("span",null,"Image engine"),
        E("select",{className:"prop-select",value:engines.includes(engine)?engine:(choice?choice.model:""),disabled:readOnly||!!busy||working,onChange:e=>setEngine(e.target.value)},
          engines.map(id=>E("option",{key:id,value:id},engineName(id)))),
        choice&&engine&&choice.model!==engine&&E("small",null,"Your plan makes this image with "+choice.label+".")),
      pend.unsaved&&!working
        ?E("div",{className:"loc-step-actions","data-testid":"previs-unsaved"},
            E("span",{className:"loc-spatial-error",role:"alert"},"An image was made but not saved."),
            E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:saveKept},"Save it"),
            E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>P.discardUnsaved(target)},"Discard it"))
        :!readOnly&&E("div",{className:"loc-step-actions"},
            E("button",{type:"button",className:"art-draftall",disabled:!!busy||working||cancelling||drawing||!sheet,onClick:make,
              title:"One image from this sheet, kept as a draft. Nothing is replaced until you use it."},
              working?phaseText:cur||earlier.length?"Make another draft":part?"Make the image":isRoom?"Make this room\u2019s image":"Make the location image",
              !working&&choice&&typeof window.nbCostChip==="function"?window.nbCostChip(1,choice.cost):null),
            // progress and Cancel, on the same row, to the right of the button
            busy==="render"&&previsProgress({phase,since:R.since,now:R.now,model:choice&&choice.model}),
            busy==="render"&&phase!=="saving"&&E("button",{type:"button",className:"art-draftall ghost previs-cancel","data-testid":"previs-cancel",onClick:()=>R.cancel(target),
              title:"Stop this image. If the request was already sent it may still be charged; its result is not saved."},"Cancel")),
      cancelling&&E("p",{className:"loc-layer-note",role:"status","data-testid":"previs-cancelling"},"The cancelled request is still finishing. Another image can be made when it has."),
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
          !readOnly&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,"data-testid":"previs-draft-delete",onClick:()=>deleteDraft(cur),
            title:"Deletes this draft for good, after asking. No image is changed; its image credits are not given back."},"Delete"))),
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
        !readOnly&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>deleteDraft(cur)},"Delete")),
      shown&&shown!==cur&&!readOnly&&E("div",{className:"loc-cloud-render-actions"},
        E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>bringBack(shown)},"Make this the current draft"),
        E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>deleteDraft(shown)},"Delete this draft")),
      !shown&&right&&!readOnly&&E("div",{className:"loc-cloud-render-actions"},
        E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>bringBack(right)},"Make the earlier draft the current one"),
        E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>deleteDraft(right)},"Delete the earlier draft")),
      (shown&&shown!==cur||!shown)&&E("p",{className:"loc-layer-note"},"Only the current draft can become "+becomes+". Making an earlier draft current keeps the one it replaces with the earlier drafts; no image is generated.")));
}
window.LocationPrevisStep=LocationPrevisStep;

/* THE WHOLE PLACE FROM ABOVE: one picture of the place's single 3D set, ceilings off, each space named. */
function LocationPrevisOverview({location:l}){
  const E=React.createElement,P=window.KinolotPrevis;
  const [shot,setShot]=React.useState(null),[error,setError]=React.useState(""),[drawing,setDrawing]=React.useState(false),[turn,setTurn]=React.useState(null);
  const from=(()=>{try{return [l.id,typeof locationSpatialPlanSigFor==="function"?locationSpatialPlanSigFor(l):"",P.dressingSig(l),turn].join("|");}catch(_){return l.id+"|"+turn;}})();
  React.useEffect(()=>{
    let live=true;setError("");setDrawing(true);
    P.overview(l,undefined,turn==null?{}:{yaw:turn}).then(o=>{if(live)setShot(o);},e=>{if(live){setShot(null);setError((e&&e.message)||"The place could not be drawn.");}})
      .finally(()=>{if(live)setDrawing(false);});
    return ()=>{live=false;};
  },[from]);
  return E("div",{className:"loc-sub previs-view","data-testid":"previs-overview"},
    E("h4",{className:"loc-step-sub"},"The whole place from above"),
    E("p",{className:"loc-layer-note"},"One set for "+(l.name||"this place")+" and every room in it, drawn from the floor plan with the ceilings off. Check that the rooms meet where they should and that each door leads where it should. Every room\u2019s four views are taken inside this same set."),
    error&&!shot?E("div",{className:"loc-step-fixes"},E("p",{className:"loc-step-fixes-head"},"The place cannot be drawn yet."),E("p",{style:{margin:"0 0 8px"}},error),
        E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>window.goToLocationStep&&window.goToLocationStep(l,2)},"Go to Floor plan"))
      :E("div",{className:"previs-sheet"+(drawing?" drawing":""),"aria-busy":drawing?"true":"false"},
        shot?E("img",{src:shot.dataUrl,alt:"The whole of "+(l.name||"this place")+" from above: "+(shot.spaces||[]).join(", "),draggable:false})
          :E("span",{className:"previs-sheet-wait"},drawing?"Drawing the place\u2026":"")),
    shot&&E("div",{className:"loc-step-actions"},
      E("button",{type:"button",className:"art-draftall ghost",disabled:drawing,onClick:()=>setTurn(t=>((t==null?30:t)+90)%360),title:"See the place from its next side"},"Turn the view"),
      E("span",{className:"loc-layer-note"},shot.dressed?"Dressed: "+shot.parts+" shapes across the place.":"Not dressed yet: plain blocks.")));
}
/* DRESS THE WHOLE PLACE (owner 2026-11-16, the whole place first: "one press furnishes the house and each room in turn,
   with the total price shown first"). Every space of the place that stands on the floor plan and is not dressed yet is
   dressed by its own writing call, one after the other (one call a space keeps each well inside the time a writing
   call is given). The total is an estimate shown on the button and asked about before anything is sent; each space is
   saved as soon as it is dressed, so stopping, or a call that fails, loses nothing already done. A space that is
   already dressed is never dressed again from here: that is done on the space itself. */
function LocationPrevisDressAll({location:l,rooms=[],project,readOnly=false,onUpdate}){
  const E=React.createElement,D=window.KinolotSetDressing;
  const [run,setRun]=React.useState(null),[note,setNote]=React.useState(""),[fail,setFail]=React.useState("");
  const alive=React.useRef(true),stop=React.useRef(false);
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  let on=[];try{on=D.place(l).spaces.map(s=>s.id);}catch(_){on=[];}
  const cards=[l].concat(rooms||[]).filter(c=>c&&on.indexOf(c.id)>=0);
  const todo=cards.filter(c=>!c.previs),done=cards.filter(c=>c.previs);
  let cost=0;try{cost=todo.reduce((n,c)=>n+D.estimate(c,{project}).credits,0);}catch(_){cost=0;}
  const writable=()=>!readOnly&&typeof onUpdate==="function"&&(typeof window.turnArtRoomWritable!=="function"||window.turnArtRoomWritable());
  if(!cards.length)return null;
  async function dressAll(){
    if(run||!writable()||!todo.length)return;
    const names=todo.map(c=>c.name||"Room");
    const ok=typeof window.appConfirm!=="function"||await window.appConfirm({title:todo.length===1?"Dress "+names[0]+"?":"Dress these "+todo.length+" spaces?",
      body:"One writing call a space, one after the other: "+names.join(", ")+"."+(cost?" About "+cost+" writing credits in all. It is an estimate: a writing call is charged by its length.":"")
        +" Each space is saved as soon as it is dressed, and you can stop between two spaces.",confirmLabel:todo.length===1?"Dress it":"Dress them",cancelLabel:"Not now"});
    if(!ok||!alive.current)return;
    stop.current=false;setFail("");setNote("");
    const epoch=typeof window.nbEpoch==="function"?window.nbEpoch():0,finished=[];let at="";
    try{
      for(let i=0;i<todo.length;i++){
        if(stop.current)break;
        const card=(((window.turnContinuity||{}).locations)||[]).find(x=>x.id===todo[i].id)||todo[i];
        at=card.name||"Room";
        if(alive.current)setRun({i:i+1,n:todo.length,name:at});
        const r=await D.draft(card,{project});
        if(!writable()||(typeof window.nbEpoch==="function"?window.nbEpoch():0)!==epoch)throw new Error("The open film changed. Nothing more was saved.");
        // saved at once, even if this section was closed meanwhile: the call is paid for
        onUpdate(card.id,{previs:D.pack(r.dressing,{engine:D.MODEL})});
        finished.push(at+" ("+r.report.parts+" shapes)");
      }
      if(alive.current)setNote((finished.length?"Dressed: "+finished.join(", ")+".":"Nothing was dressed.")+(stop.current&&finished.length<todo.length?" Stopped before "+todo.slice(finished.length).map(c=>c.name||"Room").join(", ")+".":""));
    }catch(e){
      if(alive.current)setFail((finished.length?"Dressed and saved: "+finished.join(", ")+". ":"")+"Stopped at "+(at||"the first space")+": "+((e&&e.message)||"the set could not be dressed."));
    }finally{if(alive.current)setRun(null);}
  }
  return E("div",{className:"loc-sub previs-dress","data-testid":"previs-dress-all"},
    E("h4",{className:"loc-step-sub"},"Dress the whole place"),
    E("p",{className:"loc-layer-note"},"Furnishes every space of "+(l.name||"this place")+" for this film, one after the other, each from its own card and its scenes. The floor plan and the cameras stay as saved."),
    E("p",{className:"loc-layer-note","data-testid":"previs-dress-all-state"},
      [done.length?"Dressed: "+done.map(c=>c.name||"Room").join(", ")+".":"",todo.length?"Not dressed yet: "+todo.map(c=>c.name||"Room").join(", ")+".":"Every space is dressed. To dress one again, open that space above."].filter(Boolean).join(" ")),
    todo.length>0&&!readOnly&&E("div",{className:"loc-step-actions previs-dress-row"},
      E("button",{type:"button",className:"art-draftall",disabled:!!run,onClick:dressAll,"data-testid":"previs-dress-all-go",
        title:"One writing call a space, one after the other. You are asked first, with the total."},
        run?"Dressing "+run.name+" ("+run.i+" of "+run.n+")\u2026":done.length?"Dress the rest of the place":"Dress the whole place",
        !run&&cost>0&&E("span",{className:"nb-cost","data-testid":"previs-dress-all-cost",title:"About "+cost+" writing credits for "+todo.length+(todo.length===1?" space":" spaces")+". An estimate: a writing call is charged by its length."},
          typeof nbCreditMark==="function"?nbCreditMark():null,String(cost))),
      run&&run.i<run.n&&E("button",{type:"button",className:"art-draftall ghost",disabled:stop.current,onClick:()=>{stop.current=true;setRun(r=>r?{...r}:r);},
        title:"The space being dressed now is finished and saved; the ones after it are left for later."},stop.current?"Stopping after this space\u2026":"Stop after this space")),
    note&&E("p",{className:"loc-layer-note",role:"status"},note),
    fail&&E("p",{className:"loc-spatial-error",role:"alert"},fail));
}
window.LocationPrevisDressAll=LocationPrevisDressAll;
/* ONE PLACE, ALL ITS ROOMS, ON ONE CARD (owner 2026-11-16: "the main location has to house those subspaces ... all on
   the same card"). On a place that has rooms, Previs opens with a row of its spaces: the whole place from above, the
   place itself, and each room. A room shown here is the room's own Previs (its four cameras, its dressing, its image
   and drafts), inside the same 3D set. A place with no rooms shows the one step as before. */
function LocationPrevisPlace({location:l,rooms=[],project,readOnly=false,onUpdate,hasImage=false,imageMeta=null,imageN,onSelectLocation}){
  const E=React.createElement,list=(rooms||[]).filter(r=>r&&r.id&&r.id!==l.id);
  const [view,setView]=React.useState(l.id),[,setTick]=React.useState(0);
  React.useEffect(()=>{setView(l.id);},[l.id]);
  React.useEffect(()=>{
    const h=()=>setTick(n=>n+1);
    ["nb-gen-done","nb-prefetched"].forEach(n=>window.addEventListener(n,h));
    return ()=>["nb-gen-done","nb-prefetched"].forEach(n=>window.removeEventListener(n,h));
  },[]);
  const own=E(LocationPrevisStep,{location:l,project,readOnly,onUpdate,hasImage,imageMeta,imageN});
  // THE WHOLE PLACE FIRST (owner 2026-11-16): the rooms with no usable cameras yet get them in one press (free), and a
  // room that is not on the floor plan is named, with the way to add it
  const api=window.KinolotCloudRender,alive=React.useRef(true);
  const [fitting,setFitting]=React.useState(false),[camNote,setCamNote]=React.useState(""),[camFail,setCamFail]=React.useState("");
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  if(!list.length)return own;
  let lacking=[],outside=[];
  try{lacking=api&&typeof api.camerasMissingForPlace==="function"?api.camerasMissingForPlace(l):[];}catch(_){lacking=[];}
  try{outside=typeof locationRoomsOutsidePlan==="function"?locationRoomsOutsidePlan(l):[];}catch(_){outside=[];}
  const writable=()=>!readOnly&&typeof onUpdate==="function"&&(typeof window.turnArtRoomWritable!=="function"||window.turnArtRoomWritable());
  async function setAllCameras(){
    if(fitting||!writable())return;
    setFitting(true);setCamFail("");setCamNote("");
    try{
      const all=((window.turnContinuity||{}).locations)||[],now=all.find(x=>x.id===l.id);
      if(!now)throw new Error("The open location changed. Open it again.");
      const epoch=typeof window.nbEpoch==="function"?window.nbEpoch():0,rows=await api.proposeCamerasForPlace(now,all);
      const latest=((window.turnContinuity||{}).locations)||[];
      if(!writable()||(typeof window.nbEpoch==="function"?window.nbEpoch():0)!==epoch)throw new Error("The open film changed. Nothing was saved.");
      // saved only onto the cameras each was fitted to
      const same=id=>JSON.stringify((latest.find(x=>x.id===id)||{}).coverageViews||[])===JSON.stringify((all.find(x=>x.id===id)||{}).coverageViews||[]);
      const done=rows.map(r=>r.views&&!same(r.id)?{id:r.id,name:r.name,error:"its cameras changed meanwhile"}:r);
      done.filter(r=>r.views).forEach(r=>onUpdate(r.id,{coverageViews:r.views},{kind:"suggested-cameras"}));
      if(alive.current)setCamNote(api.placeCamerasText(done)||"Every room already has its cameras.");
    }catch(e){if(alive.current)setCamFail((e&&e.message)||"The cameras could not be set.");}
    finally{if(alive.current)setFitting(false);}
  }
  const room=list.find(r=>r.id===view);
  const chip=(id,label,title)=>E("button",{key:id,type:"button",className:"art-draftall ghost previs-space"+(view===id?" on":""),"aria-pressed":view===id,title,onClick:()=>setView(id)},label);
  const got=id=>{try{return typeof window.nbGetImage==="function"?window.nbGetImage(id):"";}catch(_){return "";}};
  const metaOf=id=>{try{return typeof window.nbGetMeta==="function"?window.nbGetMeta(id):null;}catch(_){return null;}};
  return E(React.Fragment,null,
    E("div",{className:"previs-spaces",role:"group","aria-label":"Which space of "+(l.name||"this place")+" to show","data-testid":"previs-spaces"},
      chip("all","Whole place","The whole set from above, ceilings off"),
      chip(l.id,l.name||"This place","The place itself, from its four cameras"),
      list.map(r=>chip(r.id,(r.name||"Room")+(got(r.id)?" \u2713":""),(r.name||"This room")+", from its own four cameras"+(got(r.id)?" (it has its image)":"")))),
    (lacking.length>0||camNote||camFail)&&E("div",{className:"loc-step-fixes previs-place-cameras","data-testid":"previs-place-cameras"},
      lacking.length>0&&E("p",{className:"loc-step-fixes-head"},"No usable cameras yet: "+lacking.map(r=>r.name).join(", ")+"."),
      lacking.length>0&&E("div",{className:"loc-step-actions"},
        !readOnly&&typeof onUpdate==="function"&&E("button",{type:"button",className:"art-draftall",disabled:fitting,"data-testid":"previs-set-all-cameras",onClick:setAllCameras,
          title:"Fits four clear cameras to every room named here, each checked for an unobstructed view, and saves them. Cameras that are already usable stay as they are. Free."},
          fitting?"Finding clear views\u2026":"Set cameras for every room (free)")),
      camNote&&E("p",{className:"loc-layer-note",role:"status"},camNote),
      camFail&&E("p",{className:"loc-spatial-error",role:"alert"},camFail)),
    outside.length>0&&E("div",{className:"loc-step-fixes","data-testid":"previs-rooms-outside"},
      E("p",{className:"loc-step-fixes-head"},"Not on the floor plan yet: "+outside.map(r=>r.name).join(", ")+"."),
      E("p",{style:{margin:"0 0 8px"}},"A room is drawn here once it stands on "+(l.name||"this place")+"\u2019s floor plan."),
      E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>window.goToLocationStep&&window.goToLocationStep(l,2)},"Add it in Floor plan")),
    view==="all"?E(React.Fragment,null,E(LocationPrevisOverview,{location:l}),E(LocationPrevisDressAll,{location:l,rooms:list,project,readOnly,onUpdate}))
      :room?E(LocationPrevisStep,{key:room.id,location:room,project,readOnly,onUpdate,hasImage:!!got(room.id),imageMeta:got(room.id)?metaOf(room.id):null,asRoom:true,
        onOpenCard:typeof onSelectLocation==="function"?section=>onSelectLocation(room.id,section):undefined})
      :own);
}
/* A VARIANT FROM THE LOCATION IMAGE (owner 2026-11-16: "variants should be deriving from already generated location
   image ... the image a user chooses to be the location image", so that nothing is redrawn from the 3D set and no new
   mistake can come in). A variant is the same place at another hour or in another state, and its image is ONE frame:
   one of the location image's four views (or the whole image, when it is not a four-view sheet), redrawn with only
   the hour and the state changed. The result is a draft: used as the variant's image, or deleted. It needs the
   location image first. Nothing is read until the fold is opened.
   notes(): the variant in words (its time, its environment notes); meta(): what its own Generate records. */
function LocationPrevisVariant({location:l,variantKey,asset,label,time,notes,meta,readOnly=false}){
  const E=React.createElement,P=window.KinolotPrevis;
  const [open,setOpen]=React.useState(false),touched=React.useRef(false);
  const [camera,setCamera]=React.useState("TL"),[from,setFrom]=React.useState(null),[error,setError]=React.useState("");
  const [kept,setKept]=React.useState({current:null,lastDiscarded:false,earlier:[]}),[nowKeys,setNowKeys]=React.useState(undefined);
  const [review,setReview]=React.useState(""),[wipe,setWipe]=React.useState(50),[tick,setTick]=React.useState(0);
  const alive=React.useRef(true),dialog=React.useRef(null),took=React.useRef("");
  const R=usePrevisRun(alive,()=>writable()),{busy,phase,notice,fail,setNotice,setFail,run}=R;
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  // THE ONE ROAD to a variant's image (owner 2026-11-16: the older Generate left the card): the box opens by itself
  // when the variant is known to have no image yet (read from the film, never guessed), unless the user folded it
  React.useEffect(()=>{
    let live=true;
    Promise.resolve().then(()=>window.nbLoadDetailsAsset(asset,"")).then(saved=>{if(live&&!touched.current&&!(saved&&saved.url))setOpen(true);},()=>{});
    return ()=>{live=false;};
  },[asset]);
  React.useEffect(()=>{
    const bump=e=>{if(!e||!e.detail||!e.detail.id||e.detail.id===l.id)setTick(n=>n+1);};
    // the location image changed (a draft was used, a new image was generated), or the film's images arrived
    const image=e=>{const d=e&&e.detail,ids=d&&(d.ids||[d.id]);if(!ids||ids.indexOf(l.id)>=0)setTick(n=>n+1);};
    window.addEventListener("kinolot-previs-changed",bump);["nb-gen-done","nb-prefetched"].forEach(n=>window.addEventListener(n,image));
    return ()=>{window.removeEventListener("kinolot-previs-changed",bump);["nb-gen-done","nb-prefetched"].forEach(n=>window.removeEventListener(n,image));};
  },[l.id]);
  const cur=kept.current,earlier=kept.earlier||[];
  // a draft is checked, and used, with the view it was made from
  const draftCamera=(cur&&cur.meta.variantCamera)||camera;
  const targetFor=cam=>({loc:l.id,variant:{key:variantKey,asset,label,time,camera:cam}});
  const notesText=(()=>{try{return open&&typeof notes==="function"?String(notes()||"").replace(/\s+/g," ").trim():"";}catch(_){return "";}})();
  let imageIso="";try{const m=typeof window.nbGetMeta==="function"?window.nbGetMeta(l.id):null;imageIso=(m&&m.iso)||"";}catch(_){imageIso="";}
  // the view of the location image this variant is made from
  React.useEffect(()=>{
    if(!open)return;
    let live=true;setError("");
    P.variantSource(l.id,camera).then(x=>{if(live)setFrom(x);},e=>{if(live){setFrom(null);setError((e&&e.message)||"The location image could not be read.");}});
    return ()=>{live=false;};
  },[open,l.id,camera,imageIso,tick]);
  React.useEffect(()=>{
    if(!open)return;
    let live=true;
    P.drafts(targetFor(camera)).then(d=>{if(!live)return;setKept(d);
      // the view list starts on the view of the draft that is waiting
      const c=d.current&&d.current.meta.variantCamera;if(c&&took.current!==d.current.meta.iso){took.current=d.current.meta.iso;setCamera(c);}},
      ()=>{if(live)setKept({current:null,lastDiscarded:false,earlier:[]});});
    return ()=>{live=false;};
  },[open,l.id,variantKey,tick]);
  React.useEffect(()=>{
    if(!open)return;
    let live=true;setNowKeys(undefined);
    P.keys(targetFor(draftCamera),undefined,{spec:notesText}).then(k=>{if(live)setNowKeys(k);},()=>{if(live)setNowKeys(null);});
    return ()=>{live=false;};
  },[open,draftCamera,notesText,imageIso,tick]);
  React.useEffect(()=>{const el=dialog.current;if(el&&review&&!el.open&&typeof el.showModal==="function")el.showModal();});
  const writable=()=>!readOnly&&(typeof window.turnArtRoomWritable!=="function"||window.turnArtRoomWritable());
  const make=()=>run("render",async live=>{
    R.step(live,"drawing");
    let extra={};try{extra=typeof meta==="function"?(meta()||{}):{};}catch(_){extra={};}
    await P.render(targetFor(camera),{spec:notesText,meta:extra,settings:choice||undefined,onPhase:x=>R.step(live,x)});
    if(live())setNotice("The draft is ready, just below. It becomes this variant\u2019s image only when you choose to use it.");
  },"The image could not be made.");
  const useDraft=d=>run("use",async live=>{
    await P.use(targetFor(d.meta.variantCamera||camera),d.meta.iso,{spec:notesText});
    if(live()){setReview("");setNotice("This draft is now this variant\u2019s image. The image before it stays in its versions.");}
  },"The draft could not be used.");
  const deleteDraft=async d=>{
    if(busy||!writable()||!d)return;
    setReview("");
    const ok=typeof window.appConfirm!=="function"||await window.appConfirm({title:"Delete this draft?",
      body:"The draft is deleted for good. This variant\u2019s image is not changed, and the draft\u2019s image credits are not given back.",confirmLabel:"Delete",cancelLabel:"Keep it",danger:true});
    if(!ok)return;
    run("delete",async live=>{
      await P.remove(targetFor(camera),d.meta.iso);
      if(live())setNotice("The draft was deleted. This variant\u2019s image was not changed.");
    },"The draft could not be deleted.");
  };
  const bringBack=d=>run("restore",async live=>{
    await P.restore(targetFor(camera),d.meta.iso);
    if(live()){setReview("");setNotice("That draft is the current one again. The draft it replaced is kept with the earlier drafts.");}
  },"The earlier draft could not be brought back.");
  let choice=null;try{choice=P.settings(undefined,1);}catch(_){choice=null;}
  let names={};try{names=Object.fromEntries((typeof locationPanelPoses==="function"?locationPanelPoses(l):[]).map(x=>[x.key,x.label||""]));}catch(_){names={};}
  const PANEL={TL:"Top left",TR:"Top right",BL:"Bottom left",BR:"Bottom right"};
  const checking=nowKeys===undefined;
  const stale=d=>!nowKeys||d.meta.setKey!==nowKeys.setKey||d.meta.lookKey!==nowKeys.lookKey;
  const when=iso=>{try{return new Date(iso).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch(_){return "";}};
  const line=d=>(d.meta.modelLabel||"Image engine")+(when(d.meta.iso)?" \u00b7 "+when(d.meta.iso):"")+(d.meta.variantCamera&&PANEL[d.meta.variantCamera]?" \u00b7 "+PANEL[d.meta.variantCamera].toLowerCase()+" view":"");
  const pend=P.pending(targetFor(camera)),cancelling=pend.running&&pend.cancelled&&busy!=="render",working=busy==="render";
  const shown=review?[cur].concat(earlier).find(d=>d&&d.meta.iso===review):null;
  const what=time?"at "+time:"in this state";
  const OLD="This draft is out of date: the location image or this variant\u2019s notes changed after it was made. Make a new one.";
  return E("details",{className:"loc-nested-section previs-variant","data-testid":"previs-variant",open,onToggle:e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}},
    E("summary",{onClick:()=>{touched.current=true;}},"Make this variant\u2019s image"),
    open&&E(React.Fragment,null,
      // the location image comes first: a variant is that image at another hour
      error&&!from?E("div",{className:"loc-step-fixes","data-testid":"previs-variant-not-ready"},
          E("p",{className:"loc-step-fixes-head"},"Choose the location image first."),
          E("p",{style:{margin:"0 0 8px"}},"A variant is the location image itself "+what+", so "+(l.name||"this place")+" needs its image before its variants. "+error),
          E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>window.goToLocationStep&&window.goToLocationStep(l,4)},"Go to Previs"))
      :E(React.Fragment,null,
        E("p",{className:"loc-layer-note"},"This variant is made from the location image itself: "+(from&&from.sheet?"one of its four views":"the same picture")+", redrawn "+what+". Only the light and the state change; nothing is drawn again from the 3D set. One frame, as every variant is."),
        from&&from.sheet&&E("label",{className:"loc-cam-field previs-engine"},E("span",null,"View"),
          E("select",{className:"prop-select",value:camera,disabled:!!busy,onChange:e=>setCamera(e.target.value)},
            Object.keys(PANEL).map(k=>E("option",{key:k,value:k},PANEL[k]+(names[k]&&names[k].toLowerCase().replace(/[^a-z]/g,"")!==PANEL[k].toLowerCase().replace(/[^a-z]/g,"")?" \u00b7 "+names[k]:""))))),
        E("div",{className:"previs-sheet"},from?E("img",{src:from.dataUrl,alt:"The location image of "+(l.name||"this place")+(from.sheet?", "+PANEL[camera].toLowerCase()+" view":"")+", by day",draggable:false})
          :E("span",{className:"previs-sheet-wait"},"Reading the location image\u2026")),
        !readOnly&&E("div",{className:"loc-step-actions"},
          E("button",{type:"button",className:"art-draftall",disabled:!!busy||cancelling||!from||!notesText,onClick:make,
            title:"One image from this view of the location image, kept as a draft. Nothing is replaced until you use it."+(choice?" Engine: "+choice.label+", chosen in the top bar.":"")},
            working?"Making the image\u2026":cur||earlier.length?"Make another draft":"Make this variant from the location image",
            !working&&choice&&typeof window.nbCostChip==="function"?window.nbCostChip(1,choice.cost):null),
          working&&previsProgress({phase,since:R.since,now:R.now,model:choice&&choice.model}),
          working&&phase!=="saving"&&E("button",{type:"button",className:"art-draftall ghost previs-cancel",onClick:()=>R.cancel(targetFor(camera)),
            title:"Stop this image. If the request was already sent it may still be charged; its result is not saved."},"Cancel")),
        cancelling&&E("p",{className:"loc-layer-note",role:"status"},"The cancelled request is still finishing. Another image can be made when it has."),
        cur&&E("div",{className:"style-draft","data-testid":"previs-variant-draft"},
          E("button",{type:"button",className:"style-draft-thumb",disabled:!!busy,onClick:()=>setReview(cur.meta.iso),title:"Open this draft beside the location image it was made from","aria-label":"The draft"},
            E("img",{src:cur.url,alt:"Draft of "+(label||"this variant"),draggable:false})),
          E("p",{role:"status",className:"loc-layer-note"},line(cur)+" \u00b7 "+(checking?"Checking it against the location image\u2026":stale(cur)?"Out of date.":cur.used?"Used as this variant\u2019s image.":"Not used yet.")),
          !checking&&stale(cur)&&E("p",{className:"loc-spatial-error"},OLD),
          E("div",{className:"loc-step-actions"},
            !readOnly&&!checking&&!stale(cur)&&!cur.used&&E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>useDraft(cur),title:"Nothing is generated. The image this variant has now stays in its versions."},busy==="use"?"Saving\u2026":"Use as this variant\u2019s image"),
            cur.sheet&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>setReview(cur.meta.iso)},"Compare with the location image"),
            !readOnly&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>deleteDraft(cur),title:"Deletes this draft for good, after asking. No image is changed; its image credits are not given back."},"Delete"))),
        !cur&&kept.lastDiscarded&&E("p",{role:"status",className:"loc-layer-note"},"You discarded the last draft."),
        earlier.length>0&&E("div",{className:"style-draft-earlier"},
          E("p",{className:"loc-layer-note"},"Earlier drafts ("+earlier.length+"). Open one to look at it or to make it the current draft again."),
          E("div",{className:"style-draft-strip"},earlier.map(d=>E("button",{key:d.meta.iso,type:"button",className:"style-draft-thumb small",disabled:!!busy,onClick:()=>setReview(d.meta.iso),title:"Open this earlier draft"},
            E("img",{src:d.url,alt:"Earlier draft: "+line(d),draggable:false,loading:"lazy"}),E("span",null,line(d)))))),
        notice&&E("p",{className:"loc-layer-note previs-notice",role:"status"},notice),
        fail&&E("p",{className:"loc-spatial-error",role:"alert"},fail))),
    shown&&E("dialog",{ref:dialog,className:"loc-style-dialog","data-testid":"previs-variant-review","aria-label":"A draft beside the location image",onCancel:()=>setReview("")},
      E("div",{className:"loc-cloud-render-head"},E("h3",null,shown===cur?"The draft and the location image":"Earlier draft"),
        E("button",{type:"button",className:"art-draftall ghost",onClick:()=>setReview("")},"Close")),
      E("p",null,shown.sheet?"Left: what this draft was made from. Right: the draft. Move the slider: everything should stand where it stood, with only the light and the state changed.":"What this draft was made from is no longer saved, so it is shown on its own."),
      shown.sheet&&E("div",{className:"loc-style-toolbar"},E("label",null,"Left side shown: "+wipe+"%",E("input",{type:"range",min:0,max:100,value:wipe,onChange:e=>setWipe(Number(e.target.value)),"aria-label":"How much of the left image is shown"}))),
      E("div",{className:"loc-style-compare"},
        E("div",{className:"loc-style-layer"},E("img",{src:shown.url,alt:"The draft",style:{width:"100%",height:"100%",left:0,top:0}})),
        shown.sheet&&E("div",{className:"loc-style-layer",style:{clipPath:"inset(0 "+(100-wipe)+"% 0 0)"}},E("img",{src:shown.sheet,alt:"What it was made from",style:{width:"100%",height:"100%",left:0,top:0}})),
        shown.sheet&&E("div",{className:"loc-style-divider",style:{left:wipe+"%"}})),
      fail&&E("p",{role:"alert",className:"loc-spatial-error"},fail),
      !readOnly&&E("div",{className:"loc-cloud-render-actions"},
        shown===cur&&!checking&&!stale(cur)&&!cur.used&&E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>useDraft(cur)},busy==="use"?"Saving\u2026":"Use as this variant\u2019s image"),
        shown===cur&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>deleteDraft(cur)},"Delete"),
        shown!==cur&&E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:()=>bringBack(shown)},"Make this the current draft"),
        shown!==cur&&E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>deleteDraft(shown)},"Delete this draft"))));
}
window.LocationPrevisOverview=LocationPrevisOverview;window.LocationPrevisPlace=LocationPrevisPlace;window.LocationPrevisVariant=LocationPrevisVariant;

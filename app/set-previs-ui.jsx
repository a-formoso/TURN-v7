/* PREVIS on a location card (owner 2026-11-15: "build the card step and call it Previs").
   A live 3D version of the set, drawn in the browser from the saved floor plan and the four cameras. Dress the set
   (one writing call) furnishes it to belong to the film; Make the location image sends the sheet to the image engine
   with the card's own prompt, in the card's render style. The floor plan stays the authority; Build the set (the
   cloud build) stays beside it. */
function LocationPrevisStep({location:l,project,readOnly=false,onUpdate,hasImage=false,imageN}){
  const E=React.createElement,D=window.KinolotSetDressing,P=window.KinolotPrevis;
  const [sheet,setSheet]=React.useState(""),[error,setError]=React.useState(""),[drawing,setDrawing]=React.useState(false);
  const [info,setInfo]=React.useState(null),[busy,setBusy]=React.useState(""),[phase,setPhase]=React.useState("");
  const [notice,setNotice]=React.useState(""),[fail,setFail]=React.useState(""),[left,setLeft]=React.useState([]);
  const [,setTick]=React.useState(0),alive=React.useRef(true);
  React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  React.useEffect(()=>{
    const bump=e=>{if(!e||!e.detail||!e.detail.id||e.detail.id===l.id)setTick(n=>n+1);},any=()=>setTick(n=>n+1);
    window.addEventListener("kinolot-previs-changed",bump);
    ["nb-settings-changed","nb-model-changed","turn-pricing-changed"].forEach(n=>window.addEventListener(n,any));
    return ()=>{window.removeEventListener("kinolot-previs-changed",bump);
      ["nb-settings-changed","nb-model-changed","turn-pricing-changed"].forEach(n=>window.removeEventListener(n,any));};
  },[l.id]);
  // what the sheet is drawn from: the floor plan, the cameras and the saved dressing
  const drawnFrom=(()=>{try{return [l.id,typeof locationSpatialPlanSigFor==="function"?locationSpatialPlanSigFor(l):"",
    typeof locationPlateLayoutSig==="function"?locationPlateLayoutSig(l,{panels:true}):"",(l.previs&&l.previs.iso)||""].join("|");}catch(_){return l.id;}})();
  React.useEffect(()=>{
    let live=true;setError("");
    let built;
    try{built=P.scene(l);}catch(e){setSheet("");setInfo(null);setError((e&&e.message)||"The floor plan is not ready.");return;}
    setInfo({dressed:built.dressed,parts:built.parts});setDrawing(true);
    P.sheet(built.scene,built.light,{panelWidth:640,type:"image/jpeg",quality:0.9})
      .then(s=>{if(live)setSheet(s.dataUrl);},e=>{if(live){setSheet("");setError((e&&e.message)||"The previs could not be drawn.");}})
      .finally(()=>{if(live)setDrawing(false);});
    return ()=>{live=false;};
  },[drawnFrom]);
  const writable=()=>!readOnly&&(typeof window.turnArtRoomWritable!=="function"||window.turnArtRoomWritable());
  async function dress(){
    if(busy||!writable())return;
    setBusy("dress");setFail("");setNotice("");setLeft([]);
    try{
      const r=await D.draft(l,{project});
      // saved with the location even if this section was closed meanwhile: the call is paid for
      onUpdate(l.id,{previs:D.pack(r.dressing,{engine:D.MODEL})});
      if(alive.current){setLeft(r.report.left);setNotice("The set is dressed: "+r.report.parts+" shapes, from this card and its scenes.");}
    }catch(e){if(alive.current)setFail((e&&e.message)||"The set could not be dressed.");}
    finally{if(alive.current)setBusy("");}
  }
  function undress(){
    if(busy||!writable()||!l.previs)return;
    const kept=l.previs;
    onUpdate(l.id,{previs:null});setLeft([]);setNotice("");setFail("");
    if(typeof window.appToast==="function")window.appToast("The dressing was removed.","info",{action:{label:"Undo",onClick:()=>onUpdate(l.id,{previs:kept})}});
  }
  async function render(){
    if(busy||!writable())return;
    if(hasImage&&window.appConfirm&&!await window.appConfirm({title:"Make a new location image?",
      body:"It is made from this previs, in this card's render style. The image you have now stays in the card's versions.",
      confirmLabel:"Make the image",cancelLabel:"Cancel"}))return;
    setBusy("render");setFail("");setNotice("");setPhase("drawing");
    try{
      await P.render(l.id,{project,onPhase:p=>{if(alive.current)setPhase(p);}});
      if(alive.current)setNotice("The location image was made from this previs. It is at the top of the card.");
    }catch(e){if(alive.current)setFail((e&&e.message)||"The image could not be made.");}
    finally{if(alive.current){setBusy("");setPhase("");}}
  }
  async function saveKept(){
    if(busy||!writable())return;
    setBusy("render");setFail("");setPhase("saving");
    try{await P.retrySave(l.id);if(alive.current)setNotice("The location image was saved. It is at the top of the card.");}
    catch(e){if(alive.current)setFail((e&&e.message)||"The image could not be saved.");}
    finally{if(alive.current){setBusy("");setPhase("");}}
  }
  const pend=P.pending(l.id),working=busy==="render"||pend.running;
  let choice=null;try{choice=P.settings();}catch(_){choice=null;}
  const style=String((typeof locVisualDefaults==="function"?locVisualDefaults(l).renderStyle:"")||"").replace(/\s+/g," ").trim();
  const phaseText={drawing:"Drawing the sheet\u2026",generating:"Making the image\u2026 about a minute",saving:"Saving the image\u2026"}[phase]||"Making the image\u2026";
  const imageName=(imageN?imageN+" \u00b7 ":"")+"Location image";
  if(error&&!sheet)return E(React.Fragment,null,
    E("p",{className:"loc-layer-note","data-testid":"previs-intro"},"A live 3D version of this set, drawn from its floor plan and its four cameras."),
    E("div",{className:"loc-step-fixes","data-testid":"previs-not-ready"},
      E("p",{className:"loc-step-fixes-head"},"Previs needs the floor plan and the cameras first."),
      E("p",{style:{margin:"0 0 8px"}},error),
      E("button",{type:"button",className:"art-draftall ghost loc-step-go",onClick:()=>window.goToLocationStep&&window.goToLocationStep(l,2)},"Go to 2 \u00b7 Floor plan")));
  return E(React.Fragment,null,
    E("p",{className:"loc-layer-note","data-testid":"previs-intro"},
      "A live 3D version of this set, drawn from 2 \u00b7 Floor plan and 3 \u00b7 Cameras. Check where everything stands, then make the location image from it."),
    E("div",{className:"loc-sub previs-view","data-testid":"previs-sheet"},
      E("h4",{className:"loc-step-sub"},"The set from its four cameras"),
      E("div",{className:"previs-sheet"+(drawing?" drawing":""),"aria-busy":drawing?"true":"false"},
        sheet?E("img",{src:sheet,alt:"Previs of "+(l.name||"this location")+": four camera views of the set",draggable:false})
          :E("span",{className:"previs-sheet-wait"},drawing?"Drawing the set\u2026":"")),
      E("p",{className:"loc-layer-note"},info&&info.dressed
        ?"Dressed: "+info.parts+" shapes on the saved floor plan. It redraws when the floor plan or a camera changes."
        :"Not dressed yet: these are the floor plan's plain blocks.")),
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
      E("h4",{className:"loc-step-sub"},"Make the location image"),
      E("p",{className:"loc-layer-note"},"The image engine follows this sheet and this card's description, in this card's render style"
        +(style?": "+(style.length>110?style.slice(0,107).replace(/\s+\S*$/,"")+"\u2026":style):"")+"."
        +(choice?" Engine: "+choice.label+", chosen in the top bar.":"")),
      pend.unsaved&&!working
        ?E("div",{className:"loc-step-actions","data-testid":"previs-unsaved"},
            E("span",{className:"loc-spatial-error",role:"alert"},"An image was made but not saved."),
            E("button",{type:"button",className:"art-draftall",disabled:!!busy,onClick:saveKept},"Save it"),
            E("button",{type:"button",className:"art-draftall ghost",disabled:!!busy,onClick:()=>P.discardUnsaved(l.id)},"Discard it"))
        :!readOnly&&E("div",{className:"loc-step-actions"},
            E("button",{type:"button",className:"art-draftall",disabled:!!busy||working||drawing||!sheet,onClick:render,
              title:"One image from this sheet. It becomes "+imageName+"; the image before it stays in the card's versions."},
              working?phaseText:"Make the location image",
              !working&&choice&&typeof window.nbCostChip==="function"?window.nbCostChip(1,choice.cost):null)),
      E("p",{className:"loc-layer-note"},"It becomes "+imageName+". The image before it stays in the card's versions.")),
    notice&&E("p",{className:"loc-layer-note previs-notice",role:"status"},notice),
    fail&&E("p",{className:"loc-spatial-error",role:"alert"},fail));
}
window.LocationPrevisStep=LocationPrevisStep;

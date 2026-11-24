/* THE PROP'S MODEL ON ITS CARD (owner 2026-11-24: "let's build props in code so we can have them referenced in code so
   that image previs captures the exact size"). The fold "Model in code" on a prop card shows the prop as every shot's
   drawing will have it: its shape built from parts and its true size (prop-model.js), drawn from the front, the side
   and three-quarter beside a ruler. Its size comes from the card's "Physical dimensions"; three numbers set here are
   exact and win; the shape can be chosen by hand. Drawn only when the fold is open, one model at a time, kept for the
   session. Drawing calls no engine and costs nothing; only what the person sets here (the three numbers, the shape) is
   saved, on the prop's own card.
   STAGE 2 (owner 2026-11-24: "yes, go on to stage 2"). Two buttons, each with its number, each pressed by the person:
   "Build its own model" (one writing pass builds this prop from its card, part by part, in its own colours; saved on
   the card as p.model) and "Make the image from this model" (the model, laid out as the sheet is, goes to the image
   engine as the layout: it keeps the shape and adds material, colour and light). The layout is shown before it is sent. */
const PMU_E = React.createElement;
const PROP_MODEL_KEPT = new Map();          // what a model was drawn from → its three pictures (this session)
let propModelLine = Promise.resolve();      // one 3D view at a time
const PROP_MODEL_VIEWS = [["quarter","Three-quarter"],["front","Front"],["side","Side"]];   // the first is shown large
const PROP_MODEL_BUILDING = {};             // prop id → {since} while its model is being built (this session)
const PROP_MODEL_BASIS = {
  built:"built for this prop from its card",
  set:"the three numbers set here",
  text:"read from this card’s Physical dimensions",
  usual:"the usual size of such a thing: this card has no measurements yet",
  guess:"a guess: this card has no measurements, and its shape is not one the app knows" };
function propModelSig(p){ return JSON.stringify([p.name||"", p.size||"", p.detail||"", p.form||"", p.modelForm||"", (p.dims||[]).join("x"), (p.model && p.model.at)||""]); }
// the model alone on a plain floor beside its ruler: {front, side, quarter (pictures), tick (a ruler block, in metres)}
async function propModelDraw(model, width){
  const P = window.KinolotPrevis, M = window.KinolotPropModel;
  if(!P || !M) throw new Error("The 3D view did not load. Refresh this page.");
  const st = M.stage(model), w = Math.max(240,Math.min(1920,Math.round(width||640))), h = Math.round(w*9/16);
  const run = async ()=>{
    const view = await P.viewer(st.scene, { time:"day", sky:"#e2e0db" }, { surfaces:false });
    try{
      const out = { tick:st.tick };
      PROP_MODEL_VIEWS.forEach(v=>{ const c = document.createElement("canvas"); view.render(c, st.poses[v[0]], w, h); out[v[0]] = c.toDataURL("image/jpeg",0.9); });
      return out;
    }finally{ view.dispose(); }
  };
  const turn = propModelLine.then(run, run);
  propModelLine = turn.catch(()=>{});
  return turn;
}
/* THE SHEET'S LAYOUT (stage 2): the model as its reference sheet shows it, three equal panels on off-white: front, side,
   close-up. Each view is drawn 16:9 and its middle third is kept (prop-model.js sheet() holds the thing inside it).
   → {url, stood, thin, own, size}. This picture is what "Make the image from this model" sends as the layout. */
const PROP_SHEET_PAPER = "#f1efea";
async function propModelSheetBase(model, width){
  const P = window.KinolotPrevis, M = window.KinolotPropModel;
  if(!P || !M) throw new Error("The 3D view did not load. Refresh this page.");
  const st = M.sheet(model), W = Math.max(768,Math.min(1536,Math.round((width||1536)/3)*3)), H = Math.round(W*9/16), third = W/3;
  const run = async ()=>{
    const view = await P.viewer(st.scene, { time:"day", sky:PROP_SHEET_PAPER }, { surfaces:false });
    try{
      const out = document.createElement("canvas"); out.width = W; out.height = H;
      const g = out.getContext("2d"); g.fillStyle = PROP_SHEET_PAPER; g.fillRect(0,0,W,H);
      ["front","side","close"].forEach((k,i)=>{ const c = document.createElement("canvas"); view.render(c, st.poses[k], W, H); g.drawImage(c, third, 0, third, H, i*third, 0, third, H); });
      g.fillStyle = "#c9c6bf"; g.fillRect(third-1,0,2,H); g.fillRect(2*third-1,0,2,H);
      return { url:out.toDataURL("image/jpeg",0.92), stood:st.stood, thin:st.thin, own:st.own, size:st.size };
    }finally{ view.dispose(); }
  };
  const turn = propModelLine.then(run, run);
  propModelLine = turn.catch(()=>{});
  return turn;
}
// the engine that builds a model, by its name in the engine list (never its id)
const propModelEngine = id=>{ try{ const m = (window.WRITING_MODELS||[]).find(x=>x && x.id===(id||window.KinolotPropModel.MODEL)); return (m && m.label) || ""; }catch(e){ return ""; } };
const propModelCm = n=>{ const v = Number(n)*100; return Number.isFinite(v) && v>0 ? String(v>=10 ? Math.round(v*10)/10 : Math.round(v*100)/100) : ""; };
function PropModelBody({ p, onUpdate, onView, gen, modelBase }){
  const M = window.KinolotPropModel;
  const sig = propModelSig(p);
  const model = React.useMemo(()=>M.modelOf(p, null), [sig]);
  const [state, setState] = React.useState(()=> PROP_MODEL_KEPT.has(sig) ? { pics:PROP_MODEL_KEPT.get(sig) } : { busy:true });
  React.useEffect(()=>{
    let live = true;
    if(PROP_MODEL_KEPT.has(sig)){ setState({ pics:PROP_MODEL_KEPT.get(sig) }); return ()=>{ live = false; }; }
    setState({ busy:true });
    propModelDraw(model, 640).then(async pics=>{
        // (the sheet's layout is drawn with them: what "Make the image from this model" will send)
        try{ pics = { ...pics, layout:(await propModelSheetBase(model, 960)).url }; }catch(e){}
        PROP_MODEL_KEPT.set(sig, pics); if(live) setState({ pics }); })
      .catch(e=>{ if(live) setState({ error:String((e && e.message) || e || "It could not be drawn.") }); });
    return ()=>{ live = false; };
  },[sig]);
  // the three numbers, typed in centimetres; saved together once all three are numbers
  const [cm, setCm] = React.useState(()=>model.dims.map(propModelCm));
  React.useEffect(()=>{ setCm(model.dims.map(propModelCm)); },[sig]);
  const commit = ()=>{
    const v = cm.map(x=>Number(String(x).replace(",",".")));
    if(!v.every(n=>Number.isFinite(n) && n>0 && n<2000)){ setCm(model.dims.map(propModelCm)); return; }
    const next = v.map(n=>Math.round(n*100)/10000);
    if(next.every((n,i)=>Math.abs(n-model.dims[i])<0.00005)) return;
    onUpdate(p.id, { dims:next });
  };
  /* BUILD ITS OWN MODEL (stage 2): one writing pass, asked for here, shown where it was pressed (bar, clock, engine). */
  const writable = ()=> typeof onUpdate==="function" && (typeof window.turnArtRoomWritable!=="function" || window.turnArtRoomWritable());
  const [build, setBuild] = React.useState(()=> PROP_MODEL_BUILDING[p.id] ? { since:PROP_MODEL_BUILDING[p.id].since } : null);
  const own = M.saved(p.model);
  const est = React.useMemo(()=>{ try{ return M.estimate(p).credits; }catch(e){ return 0; } }, [sig, p.material, p.signatureFeature]);
  const buildNow = async ()=>{
    if(PROP_MODEL_BUILDING[p.id] || !writable()) return;
    const since = Date.now(); PROP_MODEL_BUILDING[p.id] = { since }; setBuild({ since });
    try{
      const r = await M.draft(p);
      if(!writable()) throw new Error("The open film changed. Nothing was saved.");
      onUpdate(p.id, { model:r.model, modelForm:"" });
      delete PROP_MODEL_BUILDING[p.id]; setBuild(r.left.length ? { left:r.left } : null);
    }catch(e){ delete PROP_MODEL_BUILDING[p.id]; setBuild({ error:String((e && e.message) || "The model could not be built. Nothing was changed.") }); }
  };
  const dropOwn = async ()=>{
    const ok = typeof window.appConfirm==="function" ? await window.appConfirm({ title:"Drop this prop’s own model?",
      body:"The model built for "+(p.name||"this prop")+" is removed, and the standard shape is used again. Building it again is a new writing step.",confirmLabel:"Drop it",cancelLabel:"Keep it" }) : true;
    if(ok) onUpdate(p.id, { model:null });
  };
  /* MAKE THE IMAGE FROM THIS MODEL (stage 2): the layout is drawn now, large, and goes with the card's own Generate. */
  const [making, setMaking] = React.useState(false);
  const makeImage = async ()=>{
    if(!gen || typeof gen.generate!=="function" || gen.gening || making) return;
    setMaking(true);
    try{
      const base = await propModelSheetBase(model, 1536);
      const sent = { url:base.url, form:model.form, basis:model.basis, dims:model.dims.slice(), own:!!base.own, stood:!!base.stood };
      // held on the card for this one render: its prompts lead with the layout (the simpler second try too)
      if(modelBase) modelBase.current = sent;
      await gen.generate({ modelBase:sent, baseMaxDim:1536 });
    }catch(e){ if(typeof window.appToast==="function") window.appToast((e && e.message) || "The layout could not be drawn. No image was made.","error"); }
    finally{ if(modelBase) modelBase.current = null; setMaking(false); }
  };
  const forms = React.useMemo(()=>M.forms(), []);
  const auto = M.formById(M.formOf(p.name, p.form));
  const pics = state.pics || null;
  return PMU_E("div",{className:"prop-model","data-testid":"prop-model","data-form":model.form||"none","data-basis":model.basis},
    PMU_E("p",{className:"prop-model-line","data-testid":"prop-model-line"},
      PMU_E("b",null,model.label.replace(/^./,c=>c.toUpperCase()))," · ",M.sizeWords(model.dims)," · ",
      // (a bunch of keys: its card measures its pieces, the remote's head, the ring, never the bunch)
      (model.basis==="usual" && (M.formById(model.form)||{}).loose && M.numbers(p.size)) ? "the usual size of such a thing: this card measures its pieces, not the whole" : (PROP_MODEL_BASIS[model.basis]||"")),
    state.error ? PMU_E("p",{className:"shot-previs-note","data-testid":"prop-model-error"},state.error)
      : PMU_E("div",{className:"prop-model-pics"},PROP_MODEL_VIEWS.map(v=>
          PMU_E("figure",{key:v[0],className:"shot-previs-pic"},
            pics ? PMU_E("img",{src:pics[v[0]],alt:p.name+", "+v[1].toLowerCase()+", drawn in code","data-testid":"prop-model-"+v[0],
                onClick:()=>{ if(typeof onView==="function") onView(pics[v[0]], { name:p.name+" · "+v[1]+" · model in code" }); }})
              : PMU_E("div",{className:"prop-model-wait"},"Drawing…"),
            PMU_E("figcaption",null,v[1])))),
    pics && PMU_E("p",{className:"prop-model-ruler"},"Each block of the ruler is "+(pics.tick<0.05 ? "1 cm" : "10 cm")+"."),
    // its own model: who built it, and whether the card's words have changed since
    own && model.built && PMU_E("p",{className:"prop-model-ruler","data-testid":"prop-model-own"},
      "Its own model"+(propModelEngine(own.by) ? ", built by "+propModelEngine(own.by) : "")+"."+(M.stale(p) ? " This card’s description has changed since: build it again to follow it." : "")),
    build && build.error && PMU_E("p",{className:"shot-previs-note","data-testid":"prop-model-build-error",role:"alert"},build.error),
    build && build.left && PMU_E("p",{className:"shot-previs-note","data-testid":"prop-model-left"},"Left out of the model: "+build.left.join("; ")+"."),
    (typeof onUpdate==="function") && PMU_E("div",{className:"prop-model-acts"},
      (build && build.since)
        ? PMU_E("span",{className:"prop-model-building","data-testid":"prop-model-building",role:"status"},"Building the model…",
            window.LocationRunProgress && PMU_E(window.LocationRunProgress,{work:{ text:"Building the model", since:build.since, est:45, engine:propModelEngine() }}))
        : PMU_E("button",{type:"button",className:"char-draft-btn","data-testid":"prop-model-build",
            title:"Builds this prop from its card, part by part, in its own colours: its shape, material, details and size as written there. The standard shape is kept until it is done.",onClick:buildNow},
            PMU_E(Icon.sparkles,{s:12}), own ? "Build again" : "Build its own model",
            est>0 && PMU_E("span",{className:"nb-cost",title:"About "+est+" writing credit"+(est===1?"":"s")},typeof window.nbCreditMark==="function" ? window.nbCreditMark() : null,String(est))),
      own && !(build && build.since) && PMU_E("button",{type:"button",className:"char-draft-btn ghost","data-testid":"prop-model-drop",
          title:"Removes the model built for this prop, after asking. The standard shape is used again.",onClick:dropOwn},"Use the standard shape")),
    // the sheet's layout, and the image made from it
    pics && pics.layout && PMU_E("figure",{className:"shot-previs-pic prop-model-layout"},
      PMU_E("img",{src:pics.layout,alt:p.name+", the layout of its image, drawn in code","data-testid":"prop-model-layout",
        onClick:()=>{ if(typeof onView==="function") onView(pics.layout, { name:p.name+" · layout of its image · model in code" }); }}),
      PMU_E("figcaption",null,"Layout of its image")),
    gen && typeof gen.generate==="function" && PMU_E("div",{className:"prop-model-acts"},
      PMU_E("button",{type:"button",className:"char-draft-btn","data-testid":"prop-model-image",disabled:!!gen.gening || making || !pics,
          title:"Sends this layout with the card’s description: the image keeps the model’s shape and proportions in each panel and adds material, colour, wear and light. The image you have now stays in its versions.",onClick:makeImage},
        PMU_E(Icon.sparkles,{s:12}), gen.gening || making ? "Making the image…" : "Make the image from this model",
        !(gen.gening || making) && typeof window.nbCostChip==="function" && window.nbCostChip(1,{ refs:1 }))),
    PMU_E("div",{className:"prop-model-set"},
      PMU_E("label",{className:"sheet-field prop-model-shape"},PMU_E("span",{className:"obj-lab"},"Shape"),
        PMU_E("select",{className:"prop-select","data-testid":"prop-model-shape",value:p.modelForm||"",onChange:e=>onUpdate(p.id,{ modelForm:e.target.value||"" })},
          PMU_E("option",{value:""},"Chosen from its name: "+(auto ? auto.label : "a plain box")),
          forms.map(f=>PMU_E("option",{key:f.id,value:f.id},f.label.replace(/^./,c=>c.toUpperCase()))))),
      PMU_E("div",{className:"sheet-field prop-model-size"},PMU_E("span",{className:"obj-lab",title:"Its true size as it rests on a table: a phone lies flat, a mug stands."},"True size, in cm"),
        PMU_E("div",{className:"prop-model-cm"},[["Wide",0],["Deep",1],["High",2]].map(a=>
          PMU_E("label",{key:a[0]},PMU_E("span",null,a[0]),
            PMU_E("input",{type:"text",inputMode:"decimal",className:"prop-model-num","data-testid":"prop-model-"+a[0].toLowerCase(),value:cm[a[1]],
              onChange:e=>setCm(c=>c.map((x,i)=>i===a[1] ? e.target.value : x)),onBlur:commit,
              onKeyDown:e=>{ if(e.key==="Enter"){ e.preventDefault(); e.target.blur(); } }})))))),
    Array.isArray(p.dims) && p.dims.length===3 && PMU_E("button",{type:"button",className:"char-draft-btn ghost prop-model-back","data-testid":"prop-model-back",
        title:"Drops the three numbers set here. The size is read from Physical dimensions again.",onClick:()=>onUpdate(p.id,{ dims:null })},
      "Use the card’s text again"));
}
function PropModelFold({ p, onUpdate, onView, gen, modelBase }){
  const M = window.KinolotPropModel;
  if(!M || !p) return null;
  const model = M.modelOf(p, null);
  const tip = window.InfoTip && PMU_E(window.InfoTip,{label:"About the model in code",
    text:"This prop built in code: its shape and its true size. Every shot’s drawing puts this same model in the set, so the prop is the same size in every frame, and the frame is told that size. The size is read from Physical dimensions; three numbers set here are exact and win. Drawing it costs nothing. ‘Build its own model’ builds this prop part by part from its card, in its own colours. ‘Make the image from this model’ sends the layout shown here, so the image keeps the model’s shape."});
  return PMU_E(CardFold,{label:"Model in code",count:M.sizeWords(model.dims)+(model.basis==="guess" ? " · a guess" : ""),defaultOpen:false,foldId:"prop-model-"+p.id},
    PMU_E("div",{className:"shot-previs-head"},PMU_E("span",{className:"shot-end-lab"},"This prop, built in code"),tip),
    PMU_E(PropModelBody,{p,onUpdate,onView,gen,modelBase}));
}
Object.assign(window,{ PropModelFold, propModelDraw, propModelSig, propModelSheetBase });

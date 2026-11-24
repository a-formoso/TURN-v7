/* THE PROP'S MODEL ON ITS CARD (owner 2026-11-24: "let's build props in code so we can have them referenced in code so
   that image previs captures the exact size"). The fold "Model in code" on a prop card shows the prop as every shot's
   drawing will have it: its shape built from parts and its true size (prop-model.js), drawn from the front, the side
   and three-quarter beside a ruler. Its size comes from the card's "Physical dimensions"; three numbers set here are
   exact and win; the shape can be chosen by hand. Drawn only when the fold is open, one model at a time, kept for the
   session. No engine is called and nothing costs anything; only what the person sets here (the three numbers, the
   shape) is saved, on the prop's own card. */
const PMU_E = React.createElement;
const PROP_MODEL_KEPT = new Map();          // what a model was drawn from → its three pictures (this session)
let propModelLine = Promise.resolve();      // one 3D view at a time
const PROP_MODEL_VIEWS = [["quarter","Three-quarter"],["front","Front"],["side","Side"]];   // the first is shown large
const PROP_MODEL_BASIS = {
  set:"the three numbers set here",
  text:"read from this card’s Physical dimensions",
  usual:"the usual size of such a thing: this card has no measurements yet",
  guess:"a guess: this card has no measurements, and its shape is not one the app knows" };
function propModelSig(p){ return JSON.stringify([p.name||"", p.size||"", p.detail||"", p.form||"", p.modelForm||"", (p.dims||[]).join("x")]); }
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
const propModelCm = n=>{ const v = Number(n)*100; return Number.isFinite(v) && v>0 ? String(v>=10 ? Math.round(v*10)/10 : Math.round(v*100)/100) : ""; };
function PropModelBody({ p, onUpdate, onView }){
  const M = window.KinolotPropModel;
  const sig = propModelSig(p);
  const model = React.useMemo(()=>M.modelOf(p, null), [sig]);
  const [state, setState] = React.useState(()=> PROP_MODEL_KEPT.has(sig) ? { pics:PROP_MODEL_KEPT.get(sig) } : { busy:true });
  React.useEffect(()=>{
    let live = true;
    if(PROP_MODEL_KEPT.has(sig)){ setState({ pics:PROP_MODEL_KEPT.get(sig) }); return ()=>{ live = false; }; }
    setState({ busy:true });
    propModelDraw(model, 640).then(pics=>{ PROP_MODEL_KEPT.set(sig, pics); if(live) setState({ pics }); })
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
function PropModelFold({ p, onUpdate, onView }){
  const M = window.KinolotPropModel;
  if(!M || !p) return null;
  const model = M.modelOf(p, null);
  const tip = window.InfoTip && PMU_E(window.InfoTip,{label:"About the model in code",
    text:"This prop built in code: its shape and its true size. Every shot’s drawing puts this same model in the set, so the prop is the same size in every frame, and the frame is told that size. The size is read from Physical dimensions; three numbers set here are exact and win. It costs nothing."});
  return PMU_E(CardFold,{label:"Model in code",count:M.sizeWords(model.dims)+(model.basis==="guess" ? " · a guess" : ""),defaultOpen:false,foldId:"prop-model-"+p.id},
    PMU_E("div",{className:"shot-previs-head"},PMU_E("span",{className:"shot-end-lab"},"This prop, built in code"),tip),
    PMU_E(PropModelBody,{p,onUpdate,onView}));
}
Object.assign(window,{ PropModelFold, propModelDraw, propModelSig });

/* shot-previs-ui.jsx — THE PREVIS OF A SHOT, ON ITS CARD (owner 2026-11-22, after the first real frames of Scene 5:
   "we need to start with code ... pull out the actual 3D set ... lock in the cameras considering the composition for
   the shot ... then ... bring image model to support with rendering"). Step 1 of that: the shot DRAWN IN CODE, before
   any image engine. A fold on every planned shot card shows two pictures from one camera, how the shot starts and how
   it ends, drawn by app/shot-previs.js from the place's own 3D set, with a block for each person (their real height,
   on the mark the scene plan put them on, facing who the plan says) and a box for each prop (its card's size). Under
   them: where the camera stands, and what the app had to change when the planned camera could not stand there.

   FREE AND NOT SAVED: drawing calls no engine and writes nothing to the film. A drawing is kept for the session (by
   what it was drawn from), and drawn again when the plan, the set or the shot changes. One is drawn at a time. It
   draws only when its fold is open. STEP 2 (2026-11-23): "Make the frame from this previs" hands the drawing to the
   shot's own Generate (shots-ui.jsx), which sends it to the image engine as the layout to follow. */
const SPV_E = React.createElement;
const SHOT_PREVIS_KEPT = new Map();          // what it was drawn from → the drawing (this session; the newest 80)
let shotPrevisLine = Promise.resolve();      // one drawing at a time: each starts a 3D view of its own

// the place a planned shot plays in: its set's own card, else the shot's, else the scene's
function shotPrevisPlace(sh, plan, ctx){
  const list = ((ctx||{}).locations)||[];
  const set = (((plan||{}).sets)||[]).find(s=>s && s.id===sh.planSet) || null;
  const byId = (id)=> id ? list.find(l=>l && String(l.id)===String(id)) : null;
  return byId(set && set.locationId) || byId(sh.locationId) || (ctx||{}).location || null;
}
// the plan's camera for this shot, in numbers (a beat kept as one shot takes its first moment's)
function shotPrevisCamera(sh, plan){
  const SP = window.ScenePlan;
  const cams = (plan && plan.cameras) || null;
  if(!cams || !SP || typeof SP.shotCameraKey!=="function") return null;
  return cams[SP.shotCameraKey(sh)] || null;
}
// what a drawing is drawn from, as a text: when it changes, the drawing is out of date
function shotPrevisSig(sh, plan, cam, loc, ctx){
  const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
  const here = new Set(Object.keys(((sh.startState||{}).people)||{}).concat(Object.keys(((sh.endState||{}).people)||{})));
  let place = "", dress = "";
  try{ place = JSON.stringify((window.locationSpatialContract(loc, ctx.locations)||{}).coordinates||null); }catch(e){ place = "none"; }
  try{ dress = window.KinolotPrevis.dressingSig(loc, ctx.locations); }catch(e){ dress = ""; }
  const block = ((plan.blocking||[]).find(b=>b && Number(b.beat)===Number(sh.beatN))) || null;
  return JSON.stringify([sh.id, sh.startState||null, sh.endState||null, sh.size, sh.angle, sh.lens, sh.subjects||[], sh.planThings||[], cam,
    plan.marks||[], block, (plan.things||[]).map(t=>[t.key,t.kind,t.propId]), loc.id, place, dress,
    cast.filter(c=>here.has(c.id)).map(c=>[c.id,c.height||""]), props.map(p=>[p.id,p.size||"",p.scale||"",(p.dims||[]).join("x")])]);
}
const shotPrevisNum = (n,d)=>{ const v = Number(n); return Number.isFinite(v) ? String(Math.round(v*Math.pow(10,d||0))/Math.pow(10,d||0)) : ""; };

function ShotPrevisBody({ sh, plan, cam, loc, ctx, sig, onView, beatLabel, onMake, makeDisabled }){
  const [state, setState] = React.useState(()=> SHOT_PREVIS_KEPT.has(sig) ? { res:SHOT_PREVIS_KEPT.get(sig) } : { busy:true });
  React.useEffect(()=>{
    if(SHOT_PREVIS_KEPT.has(sig)){ setState({ res:SHOT_PREVIS_KEPT.get(sig) }); return; }
    let live = true;
    setState({ busy:true });
    const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
    const run = ()=> live ? window.ShotPrevis.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:960 }) : null;
    const turn = shotPrevisLine.then(run, run);
    shotPrevisLine = turn.then(()=>{}, ()=>{});
    turn.then(res=>{
      if(!res) return;
      SHOT_PREVIS_KEPT.set(sig, res);
      if(SHOT_PREVIS_KEPT.size>80) SHOT_PREVIS_KEPT.delete(SHOT_PREVIS_KEPT.keys().next().value);
      if(live) setState({ res });
    }, e=>{ if(live) setState({ err:String((e && e.message) || "The previs could not be drawn.") }); });
    return ()=>{ live = false; };
  },[sig]);
  if(state.busy) return SPV_E("div",{className:"shot-previs-wait",role:"status","data-testid":"shot-previs-wait"},SPV_E("span",{className:"ns-spin"}),"Drawing this shot from the set in 3D…");
  if(state.err) return SPV_E("p",{className:"shot-previs-note","data-testid":"shot-previs-none"},state.err);
  const res = state.res||{};
  if(!res.start) return SPV_E("div",{className:"shot-previs","data-testid":"shot-previs"},
    (res.notes||[]).concat(res.missing||[]).map((t,i)=>SPV_E("p",{key:i,className:"shot-previs-note"},t)));
  const pic = (f, lab, name)=> SPV_E("figure",{className:"shot-previs-pic"},
    SPV_E("img",{src:f.dataUrl,alt:lab+", drawn in code",role:"button",tabIndex:0,title:"View larger",
      onClick:()=>onView && onView(f.dataUrl,{name}),
      onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onView && onView(f.dataUrl,{name}); } }}),
    SPV_E("figcaption",null,lab));
  const pose = res.pose||{}, pos = pose.position||[];
  const byLabel = (plan.camerasBy && plan.camerasBy.label) || "the writing engine";
  const who = res.source==="plan" ? "Placed by "+byLabel+", checked against the set."
    : res.source==="moved" ? "Placed by "+byLabel+", then moved by the app."
    : "Placed by the app.";
  const line = ["The camera stands "+shotPrevisNum(res.distance,1)+" m away", shotPrevisNum(pos[2],1)+" m high", shotPrevisNum(pose.lensMm)+" mm lens"].join(", ")+". "+who;
  const moving = sh.move && sh.move!=="static";
  const notes = (res.notes||[]).slice();
  if(res.fits===false && !notes.length) notes.push("No camera position in this place frames the shot as planned.");
  (res.missing||[]).forEach(t=>notes.push(String(t).replace(/\.$/,"")+"."));
  if((res.rough||[]).length) notes.push("Drawn at a guessed size, since "+((res.rough.length>1)?"their cards have":"its card has")+" no measurements yet: "+res.rough.join(", ")+".");
  if(moving) notes.push("The camera moves in this shot: both pictures are from where it starts.");
  if(res.source==="app" && !cam) notes.push("Place the cameras, in the Scene plan, lets the writing engine compose each shot's camera.");
  const base = (beatLabel ? beatLabel+" · " : "")+"previs";
  return SPV_E("div",{className:"shot-previs","data-testid":"shot-previs","data-source":res.source||""},
    SPV_E("div",{className:"shot-previs-pics"+(res.end?"":" one")},
      pic(res.start, res.end ? "How it starts" : "Start and end", base+(res.end?", start":"")),
      res.end && pic(res.end, "How it ends", base+", end")),
    !res.end && SPV_E("p",{className:"shot-previs-line"},"Nothing moves in this shot: it ends as it starts."),
    SPV_E("p",{className:"shot-previs-line","data-testid":"shot-previs-camera"},line),
    notes.map((t,i)=>SPV_E("p",{key:i,className:"shot-previs-note"},t)),
    // step 2: the frame made FROM this drawing (the image engine only adds the people, the surfaces and the light)
    onMake && SPV_E("div",{className:"shot-previs-make"},
      SPV_E("button",{type:"button",className:"char-draft-btn","data-testid":"shot-previs-make",disabled:!!makeDisabled,
        title:makeDisabled ? "Another frame is being made. Wait for it to finish."
          : "Make this shot\u2019s frame from this drawing: the set, the camera and where everyone and everything is come from the drawing; the image engine adds the people, the surfaces and the light.",
        onClick:()=>onMake()},SPV_E(Icon.sparkles,{s:12}),"Make the frame from this previs",
        typeof window.nbCostChip==="function" && window.nbCostChip(1)),
      window.InfoTip && SPV_E(window.InfoTip,{label:"About a frame made from its previs",
        text:"The drawing goes to the image engine as the layout it must follow, with the character sheets, the prop sheets and the location image. The frame is kept on this card like any other, with its earlier versions. Its QA check then also compares it with the drawing: an added door, a thing that moved, a prop at the wrong size."})));
}

function ShotPrevisFold({ sh, ctx, onView, beatLabel, onMake, makeDisabled }){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!sh || !sh.planned || !sh.startState || !SP || !SPv || !window.KinolotPrevis) return null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[sh.sceneId] || null;
  if(!plan || !SP.exact(plan)) return null;
  const loc = shotPrevisPlace(sh, plan, ctx);
  const cam = shotPrevisCamera(sh, plan);
  let ready = false;
  try{ ready = !!(loc && typeof window.locationSpatialContract==="function"
    && ((((window.locationSpatialContract(loc, ctx.locations)||{}).coordinates||{}).spaces)||[]).some(s=>s && Array.isArray(s.footprint) && s.footprint.length>=3)); }catch(e){ ready = false; }
  const tip = window.InfoTip && SPV_E(window.InfoTip,{label:"About the previs",
    text:"This shot drawn in code, before any image is made. The place is its own 3D set from the Locations tab. Each block is a person, at their real height, on the mark the scene plan gave them; each red box is a prop at its card’s size. One camera draws how the shot starts and how it ends, so the two differ only by what moved. It costs nothing and changes nothing."});
  return SPV_E(CardFold,{label:"Previs",count:!ready ? "needs a floor plan" : cam ? "camera placed" : "camera by the app",defaultOpen:false,foldId:"shot-previs-"+sh.id},
    SPV_E("div",{className:"shot-previs-head"},SPV_E("span",{className:"shot-end-lab"},"This shot, drawn in code"),tip),
    ready
      ? SPV_E(ShotPrevisBody,{sh,plan,cam,loc,ctx,sig:shotPrevisSig(sh,plan,cam,loc,ctx),onView,beatLabel,onMake,makeDisabled})
      : SPV_E("p",{className:"shot-previs-note","data-testid":"shot-previs-none"},
          (loc ? (loc.name||"This place")+" has no floor plan yet." : "This shot has no location card yet.")+" Draw its floor plan in Locations, and this shot can be drawn from its set."));
}
/* THE PREVIS A FRAME IS MADE FROM (2026-11-23, code-first frames, step 2: "once the cameras are locked in ... bring
   image model to support with rendering"). The shot drawn at working size, with what each stand-in is, in words.
   which = "start" (the shot's frame) or "end" (its end frame); pose = a camera to reuse (the end frame and the check
   use the camera the shot's frame was made with). Returns null when the shot has no previs to give (no plan with
   marks, no floor plan); throws the drawing's own sentence when the 3D view cannot start.
   → {url, which, legend:[sentences], words (the camera and what its frame holds, read from the set), pose, source,
      moves (the shot ends differently from how it starts)} */
async function shotPrevisForFrame(sh, ctx, which, pose, width){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!sh || !sh.planned || !sh.startState || !SP || !SPv || !window.KinolotPrevis) return null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[sh.sceneId] || null;
  if(!plan || !SP.exact(plan)) return null;
  const loc = shotPrevisPlace(sh, plan, ctx);
  if(!loc) return null;
  const cam = shotPrevisCamera(sh, plan);
  const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
  const run = ()=> SPv.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:width||1536, words:true, ...(pose ? { pose } : {}) });
  const turn = shotPrevisLine.then(run, run);
  shotPrevisLine = turn.then(()=>{}, ()=>{});
  const res = await turn;
  if(!res || !res.start || !res.pose) return null;
  const end = which==="end";
  const pic = end ? (res.end || res.start) : res.start;
  const people = (end && res.end && res.end.people) || res.people, things = (end && res.end && res.end.things) || res.things;
  return { url:pic.dataUrl, which:end?"end":"start", legend:SPv.legend(people, things), words:pic.words||"", pose:res.pose, source:res.source||"", moves:!!res.end };
}
// a frame "made from its previs": the next Generate of this shot takes it (set by the Previs fold's button, read once by the card)
// (the mark lasts ten minutes: a run the person then cancels must not turn a later, ordinary Generate into this one)
function shotPrevisAskNext(id){ window.__shotPrevisNext = window.__shotPrevisNext || {}; window.__shotPrevisNext[id] = Date.now(); }
function shotPrevisTakeNext(id){ const m = window.__shotPrevisNext, at = m && m[id]; if(!at) return false; delete m[id]; return Date.now()-at < 600000; }
Object.assign(window, { ShotPrevisFold, shotPrevisPlace, shotPrevisCamera, shotPrevisSig, shotPrevisForFrame, shotPrevisAskNext, shotPrevisTakeNext });

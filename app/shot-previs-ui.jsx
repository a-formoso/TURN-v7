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
    cast.filter(c=>here.has(c.id)).map(c=>[c.id,c.height||""]), props.map(p=>[p.id,p.size||"",p.scale||"",(p.dims||[]).join("x"),p.name||"",p.detail||"",p.form||"",p.modelForm||"",(p.model&&p.model.at)||""])]);
}
const shotPrevisNum = (n,d)=>{ const v = Number(n); return Number.isFinite(v) ? String(Math.round(v*Math.pow(10,d||0))/Math.pow(10,d||0)) : ""; };

/* COLOUR, CLAY, DEPTH (owner 2026-11-23, the Previs look brief, step 1): the same drawing of the shot three ways.
   (Since 2026-11-25 the first is CALLED "Previs" wherever it is shown, as on the shot's picture: owner.)
   Colour is the set as built, and the one a frame is made from; Clay is the set in one matt white, the people and
   props in their colours; Depth is how far each thing is from the camera. Each look is drawn when it is first asked
   for and kept apart from the others for the session; a shot remembers the look it was left on. */
const SHOT_PREVIS_LOOKS = [
  { id:"", name:"Previs", title:"The set as built. A frame is made from this drawing." },
  { id:"clay", name:"Clay", title:"The set in one matt white: only shape and light. People and props keep their colours." },
  { id:"depth", name:"Depth", title:"How far each thing is from the camera: near is light, far is dark." }];
const SHOT_PREVIS_LOOK = new Map();          // shot id → the look it was left on (this session)
function ShotPrevisBody({ sh, plan, cam, loc, ctx, sig:colourSig, onView, beatLabel, onMake, makeDisabled, staged }){
  const [look, setLookNow] = React.useState(()=> SHOT_PREVIS_LOOK.get(sh.id) || "");
  const setLook = id=>{ SHOT_PREVIS_LOOK.set(sh.id, id); setLookNow(id); };
  // what a drawing was made from, with its look: a look never replaces another's drawing
  const sig = colourSig+(look ? "|look:"+look : "");
  const [state, setState] = React.useState(()=> SHOT_PREVIS_KEPT.has(sig) ? { res:SHOT_PREVIS_KEPT.get(sig) } : { busy:true });
  React.useEffect(()=>{
    if(SHOT_PREVIS_KEPT.has(sig)){ setState({ res:SHOT_PREVIS_KEPT.get(sig) }); return; }
    let live = true;
    setState({ busy:true });
    const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
    const run = ()=> live ? window.ShotPrevis.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:960,
      ...(look ? { look } : {}),
      ...(staged ? { startState:staged.start, endState:staged.end } : {}) }) : null;
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
  const looks = SPV_E("div",{className:"shot-previs-looks",role:"group","aria-label":"How the previs is drawn","data-testid":"shot-previs-looks"},
    SHOT_PREVIS_LOOKS.map(x=>SPV_E("button",{key:x.id||"colour",type:"button","aria-pressed":x.id===look?"true":"false",title:x.title,onClick:()=>setLook(x.id)},x.name)));
  if(state.busy) return SPV_E(React.Fragment,null,looks,SPV_E("div",{className:"shot-previs-wait",role:"status","data-testid":"shot-previs-wait"},SPV_E("span",{className:"ns-spin"}),"Drawing this shot from the set in 3D…"));
  if(state.err) return SPV_E(React.Fragment,null,looks,SPV_E("p",{className:"shot-previs-note","data-testid":"shot-previs-none"},state.err));
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
  /* YOUR ANGLE (2026-11-24, step 5): a camera set by hand in a location's camera tool. The card says where it came
     from and offers the way back to the camera the plan had (or, with none, to the one the app finds). */
  const hand = res.source==="hand";
  const from = (hand && (res.from || (cam && cam.from))) || {};
  const who = hand ? "It stays exactly where you set it; the checks only say what they find."
    : res.source==="plan" ? "Placed by "+byLabel+", checked against the set."
    : res.source==="moved" ? "Placed by "+byLabel+", then moved by the app."
    : "Placed by the app.";
  const canReturn = hand && typeof window.turnReturnPlannedCamera==="function" && window.ScenePlan && !(ctx && ctx.readOnly);
  const handLine = hand && SPV_E("p",{className:"shot-previs-line shot-previs-hand","data-testid":"shot-previs-hand"},
    SPV_E("span",null,"Camera: your angle from "+(String(from.locationName||"").trim()||"a location")+(String(from.angleName||"").trim() ? " (\u201c"+String(from.angleName).trim()+"\u201d)" : "")+"."),
    canReturn && SPV_E("button",{type:"button",className:"char-draft-btn ghost","data-testid":"shot-previs-return",
      title:cam && cam.planned ? "Give this shot back the camera the scene plan placed for it. Your angle stays saved on its location." : "Remove your angle from this shot: the app finds a camera for it again. Your angle stays saved on its location.",
      onClick:()=>window.turnReturnPlannedCamera(sh.sceneId, window.ScenePlan.shotCameraKey(sh))},"Return to the planned camera"));
  const line = ["The camera stands "+shotPrevisNum(res.distance,1)+" m away", shotPrevisNum(pos[2],1)+" m high", shotPrevisNum(pose.lensMm)+" mm lens"].join(", ")+". "+who;
  const moving = sh.move && sh.move!=="static";
  const notes = (res.notes||[]).slice();
  if(res.fits===false && !notes.length) notes.push("No camera position in this place frames the shot as planned.");
  (res.missing||[]).forEach(t=>notes.push(String(t).replace(/\.$/,"")+"."));
  if((res.rough||[]).length) notes.push("Drawn at a guessed size, since "+((res.rough.length>1)?"their cards have":"its card has")+" no measurements yet: "+res.rough.join(", ")+".");
  if(moving) notes.push("The camera moves in this shot: both pictures are from where it starts.");
  if(res.source==="app" && !cam) notes.push("Place the cameras, in the Scene plan, lets the writing engine compose each shot's camera.");
  const base = (beatLabel ? beatLabel+" · " : "")+"previs";
  return SPV_E("div",{className:"shot-previs","data-testid":"shot-previs","data-source":res.source||"","data-look":look||"colour"},
    looks,
    SPV_E("div",{className:"shot-previs-pics"+(res.end?"":" one")},
      pic(res.start, res.end ? "How it starts" : "Start and end", base+(res.end?", start":"")),
      res.end && pic(res.end, "How it ends", base+", end")),
    !res.end && SPV_E("p",{className:"shot-previs-line"},"Nothing moves in this shot: it ends as it starts."),
    handLine,
    SPV_E("p",{className:"shot-previs-line","data-testid":"shot-previs-camera"},line),
    notes.map((t,i)=>SPV_E("p",{key:i,className:"shot-previs-note"},t)),
    // (a frame is always made from the Colour drawing: said while another look is on)
    onMake && look && SPV_E("p",{className:"shot-previs-note","data-testid":"shot-previs-look-note"},"A frame is made from the Previs drawing, not from this one."),
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

function ShotPrevisFold({ sh, ctx, onView, beatLabel, onMake, makeDisabled, sceneShots }){
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
    text:"This shot drawn in code, before any image is made. The place is its own 3D set from the Locations tab. Each jointed figure is a person, at their real height, on the mark the scene plan gave them; each red shape is a prop, built in code at its true size. One camera draws how the shot starts and how it ends, so the two differ only by what moved. It costs nothing and changes nothing."});
  return SPV_E(CardFold,{label:"Previs",count:!ready ? "needs a floor plan" : (cam && cam.hand) ? "your angle" : cam ? "camera placed" : "camera by the app",defaultOpen:false,foldId:"shot-previs-"+sh.id},
    SPV_E("div",{className:"shot-previs-head"},SPV_E("span",{className:"shot-end-lab"},"This shot, drawn in code"),tip),
    ready
      ? (()=>{ const st = shotPrevisStaged(sceneShots||[sh])[sh.id] || null;
          return SPV_E(ShotPrevisBody,{sh,plan,cam,loc,ctx,sig:shotPrevisSig(sh,plan,cam,loc,ctx)+JSON.stringify(st),onView,beatLabel,onMake,makeDisabled,staged:st}); })()
      : SPV_E("p",{className:"shot-previs-note","data-testid":"shot-previs-none"},
          (loc ? (loc.name||"This place")+" has no floor plan yet." : "This shot has no location card yet.")+" Draw its floor plan in Locations, and this shot can be drawn from its set."));
}
/* THE BEAT STRIP (owner 2026-11-23: "render an entire beat in code and then extract shots from that beat ... it is
   important to show each shot inside each scene beat"). One row above a beat's cards: the whole beat staged ONCE in
   code (ShotPrevis.beat: one room that goes on, everyone and everything where the shot before left them), and every
   shot of the beat drawn from it through its own camera, in order: how it starts, a middle picture when someone
   crosses the room, how it ends. Between two shots a mark says whether the next one starts at the same instant or
   after time has passed. Pressing a shot's name goes to its card. Free and not saved; drawn when the row is opened,
   one drawing at a time, kept for the session. */
const BEAT_STRIP_KEPT = new Map();
/* THE SCENE STAGED ONCE: every planned shot of the scene, in order, as one room that goes on (ShotPrevis.beatStates
   over the whole scene, so a beat's first shot also starts where the beat before it ended, unless time has passed).
   The strip, a card's Previs, the frame made from it, its check and its end frame all read THIS, so they are one
   picture. → {shot id: {start, end, joins, cut, differs}} */
function shotPrevisStaged(sceneShots){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!SP || !SPv || typeof SPv.beatStates!=="function") return {};
  const list = (sceneShots||[]).filter(sh=>sh && sh.planned && sh.startState && SP.isKeyShot(sh))
    .slice().sort((a,b)=>(Number(a.beatN)-Number(b.beatN)) || (SP.momentOf(a)-SP.momentOf(b)));
  const out = {}; SPv.beatStates(list).forEach(st=>{ out[st.id] = st; });
  return out;
}
// a frame is made by its own card: each card leaves its "make from the previs" here, and the strip presses it
function shotPrevisMaker(id){ const m = window.__shotPrevisMake; return (m && typeof m[id]==="function") ? m[id] : null; }
const shotPrevisBusy = (id)=> !!((window.__nbGenInflight && window.__nbGenInflight[id]) || (window.__nbShotPhase && window.__nbShotPhase[id]));
const shotPrevisWait = (ms)=> new Promise(r=>setTimeout(r, ms));
/* MAKE A BEAT'S FRAMES, IN ORDER, FROM THE STRIP. One shot at a time through its own card (so every rule a frame
   follows holds: the order, the seed question, the prop sheets, the approval), then the beat's end frame. A shot that
   does not start within three minutes (a question left unanswered, a card that refused) ends the run there.
   onStep(text). Returns how many were made. */
async function shotPrevisMakeBeat(list, endOwnerId, onStep){
  let made = 0;
  const one = async (id, press, label)=>{
    if(typeof press!=="function") return false;
    const iso0 = (typeof nbGetMeta==="function") ? String((nbGetMeta(id)||{}).iso||"") : "";
    onStep && onStep(label);
    try{ press(); }catch(e){ return false; }
    let started = false;
    const asking = ()=> !!document.querySelector('[role="dialog"],[role="alertdialog"]');
    const waiting = ()=> !!(window.__shotPrevisNext && window.__shotPrevisNext[id]);   // marked, and its card has not taken it yet
    for(let t=0; t<1800; t++){            // up to 15 minutes a frame, checked twice a second
      await shotPrevisWait(500);
      const busy = shotPrevisBusy(id);
      if(busy) started = true;
      else if(started) break;
      else if(t>360) return false;       // three minutes and it never started
      /* PRESSED TOO SOON (the first real run, 2026-11-23): the scene's runner was still closing the frame before, so
         it let this press go by and nothing started. While nothing has started and no question is on screen, a shot
         whose card has not taken its mark is pressed again every ten seconds; an end frame (it has no mark) once,
         ten seconds on. Never while it may already be on its way: a second press would make a second frame. */
      else if(t>0 && t%20===0 && !asking() && (/-end$/.test(id) ? t===20 : waiting())){ try{ press(); }catch(e){} }
    }
    const iso1 = (typeof nbGetMeta==="function") ? String((nbGetMeta(id)||{}).iso||"") : "";
    if(!iso1 || iso1===iso0) return false;
    made++;
    await shotPrevisWait(2500);          // the runner closes this frame before the next is asked for
    return true;
  };
  for(let i=0; i<list.length; i++){
    const sh = list[i], m = window.ScenePlan.momentOf(sh);
    if(!(await one(sh.id, shotPrevisMaker(sh.id), "Making moment "+m+" ("+(i+1)+" of "+list.length+")\u2026"))) return made;
  }
  if(endOwnerId){ const endId = endOwnerId+"-end";
    await one(endId, shotPrevisMaker(endId), "Making the end frame\u2026"); }
  return made;
}
function beatStripShots(shots){
  const SP = window.ScenePlan;
  return (shots||[]).filter(sh=>sh && sh.planned && sh.startState && SP && SP.isKeyShot(sh))
    .slice().sort((a,b)=>SP.momentOf(a)-SP.momentOf(b));
}
function BeatStripBody({ list, plan, ctx, sig, onView, beatN, staged, readOnly, endOwnerId, bare }){
  // the frames the cards hold change while this is open (a frame was made, loaded or approved): look again
  const [, tick] = React.useState(0);
  const [run, setRun] = React.useState("");
  React.useEffect(()=>{ const h = ()=>tick(n=>n+1);
    ["nb-gen-done","nb-meta-changed","nb-prefetched"].forEach(ev=>window.addEventListener(ev,h));
    const t = setInterval(h, 2000);
    // what each frame was made from is read with the frame itself: ask for both once (the picture alone may be at hand)
    // (the picture's own loader can answer from a picture already at hand, without its record: the one that reads the row does)
    list.map(sh=>sh.id).concat(endOwnerId?[endOwnerId+"-end"]:[]).forEach(id=>{
      if(typeof nbGetMeta==="function" && nbGetMeta(id)) return;
      const load = (typeof window.nbRemoteImageUrl==="function") ? window.nbRemoteImageUrl : (typeof nbLoadImage==="function" ? nbLoadImage : null);
      if(load){ try{ Promise.resolve(load(id)).then(h,()=>{}); }catch(e){} } });
    return ()=>{ ["nb-gen-done","nb-meta-changed","nb-prefetched"].forEach(ev=>window.removeEventListener(ev,h)); clearInterval(t); }; },[]);
  const [state, setState] = React.useState(()=> BEAT_STRIP_KEPT.has(sig) ? { rows:BEAT_STRIP_KEPT.get(sig) } : { busy:true });
  React.useEffect(()=>{
    if(BEAT_STRIP_KEPT.has(sig)){ setState({ rows:BEAT_STRIP_KEPT.get(sig) }); return; }
    let live = true;
    setState({ busy:true });
    const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
    const draw = ()=> live ? window.ShotPrevis.beat(plan, list, { list:ctx.locations||[], cast, props, width:640, states:staged,
      locationOf:(sh)=>shotPrevisPlace(sh, plan, ctx), cameraOf:(sh)=>shotPrevisCamera(sh, plan) }) : null;
    const turn = shotPrevisLine.then(draw, draw);
    shotPrevisLine = turn.then(()=>{}, ()=>{});
    turn.then(rows=>{ if(!rows) return;
      BEAT_STRIP_KEPT.set(sig, rows);
      if(BEAT_STRIP_KEPT.size>24) BEAT_STRIP_KEPT.delete(BEAT_STRIP_KEPT.keys().next().value);
      if(live) setState({ rows }); },
      e=>{ if(live) setState({ err:String((e && e.message) || "The beat could not be drawn.") }); });
    return ()=>{ live = false; };
  },[sig]);
  if(state.busy) return SPV_E("div",{className:"shot-previs-wait",role:"status","data-testid":"beat-strip-wait"},SPV_E("span",{className:"ns-spin"}),"Staging beat "+beatN+" in code\u2026");
  if(state.err) return SPV_E("p",{className:"shot-previs-note"},state.err);
  const rows = state.rows||[], SP = window.ScenePlan;
  const go = (id)=>{ const card = document.querySelector('[data-shot-card="'+String(id).replace(/"/g,"")+'"]');
    if(card){ try{ card.scrollIntoView({behavior:"smooth",block:"start"}); }catch(e){} } };
  // who is which colour, said once for the whole beat
  const seen = new Map(); rows.forEach(r=>[].concat(r.people||[], (r.end && r.end.people)||[]).forEach(p=>{ if(p && p.colour && !seen.has(p.id)) seen.set(p.id, p); }));
  const pic = (f, lab, name)=> SPV_E("figure",{className:"beat-strip-pic"},
    SPV_E("img",{src:f.dataUrl,alt:lab+", drawn in code",role:"button",tabIndex:0,title:"View larger",
      onClick:()=>onView && onView(f.dataUrl,{name}),
      onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onView && onView(f.dataUrl,{name}); } }}),
    SPV_E("figcaption",null,lab));
  const img = (id)=> (typeof nbGetImage==="function") ? (nbGetImage(id)||"") : "";
  const metaOf = (id)=> (typeof nbGetMeta==="function") ? (nbGetMeta(id)||null) : null;
  const anyBusy = list.some(sh=>shotPrevisBusy(sh.id)) || (endOwnerId && shotPrevisBusy(endOwnerId+"-end")) || !!run;
  const makeOne = (id)=>{ const press = shotPrevisMaker(id); if(press) press(); };
  const makeAll = async ()=>{
    if(anyBusy) return;
    const n = list.length+(endOwnerId?1:0);
    const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(n) : "";
    const ok = typeof window.appConfirm==="function" ? await window.appConfirm({
      title:"Make beat "+beatN+"\u2019s "+n+" frame"+(n!==1?"s":"")+" from the strip?",
      body:"Each shot\u2019s frame is made from its drawing here, in order"+(endOwnerId?", then the beat\u2019s end frame":"")+". The set, the camera and where everyone and everything is come from the drawings; the image engine adds the people, the surfaces and the light."
        +(price ? " About "+price+" credit"+(price==="1"?"":"s")+"." : "")+" A frame that is there now is kept as an earlier version. Nothing is approved.",
      confirmLabel:"Make "+n+" frame"+(n!==1?"s":""), cancelLabel:"Cancel" }) : true;
    if(!ok) return;
    setRun("Starting\u2026");
    try{ const made = await shotPrevisMakeBeat(list, endOwnerId, setRun);
      if(typeof window.appToast==="function") window.appToast("Beat "+beatN+": "+made+" of "+n+" frame"+(n!==1?"s":"")+" made from the strip."+(made<n?" The run stopped there: a frame did not start or was not made.":""), made<n?"info":"success"); }
    finally{ setRun(""); }
  };
  return SPV_E("div",{className:"beat-strip-body","data-testid":"beat-strip-body"},
    SPV_E("div",{className:"beat-strip-row"},rows.map((r,i)=>{
      const sh = list[i]||{}, m = SP.momentOf(sh), name = "Beat "+beatN+", moment "+m+" \u00b7 previs";
      const lens = r.pose ? Math.round(r.pose.lensMm)+" mm" : "";
      const join = i===0 ? null : SPV_E("div",{key:"j"+r.id,className:"beat-strip-join"+(r.joins?"":" cut"),
        title:r.joins ? "This shot starts at the instant the one before it ends: everyone and everything is where that shot left them."
          : r.cut==="set" ? "Another place: this shot starts as the scene plan wrote it." : "Time has passed: this shot starts as the scene plan wrote it."},
        r.joins ? "\u2192" : r.cut==="set" ? "new place" : "time passes");
      const notes = (r.notes||[]).slice();
      if(r.error) notes.unshift(r.error);
      if((r.differs||[]).length) notes.push("The plan wrote another start for "+r.differs.join(" and ")+"; the strip keeps them where the shot before left them.");
      return SPV_E(React.Fragment,{key:r.id},join,
        SPV_E("div",{className:"beat-strip-shot","data-testid":"beat-strip-shot","data-shot":r.id},
          SPV_E("button",{type:"button",className:"beat-strip-name",title:"Go to this shot\u2019s card",onClick:()=>go(r.id)},
            "Moment "+m+[sh.size, lens].filter(Boolean).map(x=>" \u00b7 "+x).join("")),
          r.start ? SPV_E("div",{className:"beat-strip-pics"},
              pic(r.start, r.end ? "Starts" : "Starts and ends", name+(r.end?", start":"")),
              r.mid && pic(r.mid, "Midway", name+", midway"),
              r.end && pic(r.end, "Ends", name+", end"))
            : null,
          /* THE FRAMES, UNDER THEIR DRAWINGS (2026-11-23: "make each shot's frame from its panel in the strip"): the
             shot's frame under how it starts and, on the beat's last shot, the end frame under how it ends. A frame
             made from the strip says so; one made another way, or out of date with it, says that. */
          r.start && (()=>{
            const f = img(sh.id), fm = metaOf(sh.id), fromStrip = !!(fm && fm.previs);
            const isLast = endOwnerId===sh.id, e = isLast ? img(sh.id+"-end") : "", em = isLast ? metaOf(sh.id+"-end") : null;
            const busy = shotPrevisBusy(sh.id), ebusy = isLast && shotPrevisBusy(sh.id+"-end");
            const slot = (url, lab, nm, state)=> SPV_E("figure",{className:"beat-strip-pic frame"+(url?"":" none")},
              url ? SPV_E("img",{src:url,alt:lab,role:"button",tabIndex:0,title:"View larger",onClick:()=>onView && onView(url,{name:nm}),
                  onKeyDown:(ev)=>{ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); onView && onView(url,{name:nm}); } }})
                : SPV_E("div",{className:"beat-strip-empty"},state||"No frame yet"),
              SPV_E("figcaption",null,lab));
            return SPV_E("div",{className:"beat-strip-pics frames","data-testid":"beat-strip-frames"},
              // (until a frame's own record is read, it is just "Frame": never called "another way" on a guess)
              slot(f, busy ? "Frame \u00b7 making\u2026" : (f && fm) ? (fromStrip ? "Frame \u00b7 from the strip" : "Frame \u00b7 made another way") : "Frame", "Beat "+beatN+", moment "+m, busy?"Making\u2026":""),
              r.mid && SPV_E("div",{className:"beat-strip-pic gap","aria-hidden":"true"}),
              (r.end && isLast) ? slot(e, ebusy ? "End frame \u00b7 making\u2026" : (e && em) ? (em.previs ? "End frame \u00b7 from the strip" : "End frame \u00b7 made another way") : "End frame", "Beat "+beatN+", end frame", ebusy?"Making\u2026":"")
                : (r.end ? SPV_E("div",{className:"beat-strip-pic gap","aria-hidden":"true"}) : null));
          })(),
          (!readOnly && r.start && shotPrevisMaker(sh.id)) && SPV_E("div",{className:"beat-strip-acts"},
            SPV_E("button",{type:"button",className:"char-draft-btn ghost","data-testid":"beat-strip-make",disabled:anyBusy,
              title:"Make this shot\u2019s frame from its drawing here. A frame that is there now is kept as an earlier version.",
              onClick:()=>makeOne(sh.id)},SPV_E(Icon.sparkles,{s:12}),img(sh.id)?"Make again":"Make frame",
              typeof window.nbCostChip==="function" && window.nbCostChip(1)),
            (endOwnerId===sh.id && r.end && shotPrevisMaker(sh.id+"-end")) && SPV_E("button",{type:"button",className:"char-draft-btn ghost","data-testid":"beat-strip-make-end",
              disabled:anyBusy || !img(sh.id),
              title:img(sh.id) ? "Make the beat\u2019s end frame: this shot\u2019s frame, moved on to how the drawing says it ends." : "Make this shot\u2019s frame first: the end frame is made from it.",
              onClick:()=>makeOne(sh.id+"-end")},img(sh.id+"-end")?"End frame again":"End frame",
              typeof window.nbCostChip==="function" && window.nbCostChip(1))),
          notes.map((t,k)=>SPV_E("p",{key:k,className:"beat-strip-note"},t))));
    })),
    // (inside a beat's own card the card has this button: "Make frames in order")
    !bare && !readOnly && list.some(sh=>shotPrevisMaker(sh.id)) && SPV_E("div",{className:"beat-strip-all"},
      run ? SPV_E("span",{className:"shot-previs-wait",role:"status","data-testid":"beat-strip-run"},SPV_E("span",{className:"ns-spin"}),run)
        : SPV_E("button",{type:"button",className:"char-draft-btn","data-testid":"beat-strip-make-all",disabled:anyBusy,
            title:"Make every frame of this beat from its drawing, in order"+(endOwnerId?", then the end frame":"")+". It asks first.",
            onClick:makeAll},SPV_E(Icon.sparkles,{s:12}),"Make this beat\u2019s frames",
            typeof window.nbCostChip==="function" && window.nbCostChip(list.length+(endOwnerId?1:0)))),
    seen.size>0 && SPV_E("p",{className:"beat-strip-key"},Array.from(seen.values()).map(p=>p.name+" is "+p.colour).join(" \u00b7 ")+" \u00b7 red shapes are props, at their true size"));
}
/* WHAT A BEAT'S STRIP IS DRAWN FROM, AND ITS DRAWINGS, for the beat card (owner 2026-11-24, the beat-first shot
   card: a small picture of every shot on its beat's card). beatStripInfo says what the strip of a beat holds (its
   shots in order, the scene staged once, the key its drawings are kept under, the shot that owns the end frame);
   beatStripRows draws them once, in turn with every other drawing, and keeps them where the strip itself looks: a
   beat drawn for its card is not drawn again when its strip is opened. Free; nothing is saved. */
function beatStripInfo(scene, shots, sceneShots, ctx){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!scene || !SP || !SPv || typeof SPv.beat!=="function" || !window.KinolotPrevis) return null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[scene.id] || null;
  if(!plan || !SP.exact(plan)) return null;
  const list = beatStripShots(shots);
  if(!list.length) return null;
  const staged = shotPrevisStaged(sceneShots||shots);
  let sig = "";
  try{ sig = JSON.stringify(list.map(sh=>{ const loc = shotPrevisPlace(sh, plan, ctx); return [loc ? shotPrevisSig(sh, plan, shotPrevisCamera(sh, plan), loc, ctx) : sh.id, staged[sh.id]||null]; })); }catch(e){ sig = ""; }
  const last = list[list.length-1];
  const endOwnerId = (last && typeof shotEndFrameWanted==="function" && shotEndFrameWanted(last, sceneShots||shots)) ? last.id : "";
  return { plan, list, staged, sig, endOwnerId };
}
const BEAT_STRIP_DRAWING = new Map();
function beatStripRows(info, ctx){
  if(!info || !info.sig) return Promise.resolve(null);
  if(BEAT_STRIP_KEPT.has(info.sig)) return Promise.resolve(BEAT_STRIP_KEPT.get(info.sig));
  if(BEAT_STRIP_DRAWING.has(info.sig)) return BEAT_STRIP_DRAWING.get(info.sig);
  const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
  const draw = ()=> window.ShotPrevis.beat(info.plan, info.list, { list:ctx.locations||[], cast, props, width:640, states:info.staged,
    locationOf:(sh)=>shotPrevisPlace(sh, info.plan, ctx), cameraOf:(sh)=>shotPrevisCamera(sh, info.plan) });
  const turn = shotPrevisLine.then(draw, draw);
  shotPrevisLine = turn.then(()=>{}, ()=>{});
  const kept = turn.then(rows=>{ BEAT_STRIP_DRAWING.delete(info.sig);
    if(rows){ BEAT_STRIP_KEPT.set(info.sig, rows); if(BEAT_STRIP_KEPT.size>24) BEAT_STRIP_KEPT.delete(BEAT_STRIP_KEPT.keys().next().value); }
    return rows||null; }, e=>{ BEAT_STRIP_DRAWING.delete(info.sig); throw e; });
  BEAT_STRIP_DRAWING.set(info.sig, kept);
  return kept;
}
/* ONE SHOT'S DRAWING, FOR ITS CARD (the beat-first shot card: the picture at the top of an open shot, its small
   floor plan and its Previs step all read one drawing). The same drawing the Previs section makes, kept under the
   same key, so nothing is drawn twice. look = "" (Colour), "clay" or "depth"; on = false draws nothing yet.
   → {able (the shot has a scene plan to draw from), ready (its place has a floor plan), plan, cam, loc, busy, err, res} */
function useShotDrawing(sh, ctx, sceneShots, look, on){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  const plan = (sh && SP) ? (((((ctx||{}).project||{}).scenePlans)||{})[sh.sceneId] || null) : null;
  const able = !!(sh && sh.planned && sh.startState && SP && SPv && window.KinolotPrevis && plan && SP.exact(plan));
  const loc = able ? shotPrevisPlace(sh, plan, ctx) : null;
  const cam = able ? shotPrevisCamera(sh, plan) : null;
  let ready = false;
  if(able){ try{ ready = !!(loc && typeof window.locationSpatialContract==="function"
    && ((((window.locationSpatialContract(loc, ctx.locations)||{}).coordinates||{}).spaces)||[]).some(s=>s && Array.isArray(s.footprint) && s.footprint.length>=3)); }catch(e){ ready = false; } }
  const staged = (able && ready) ? (shotPrevisStaged(sceneShots||[sh])[sh.id] || null) : null;
  let sig = "";
  if(able && ready && on!==false){ try{ sig = shotPrevisSig(sh, plan, cam, loc, ctx)+JSON.stringify(staged)+(look ? "|look:"+look : ""); }catch(e){ sig = ""; } }
  const [state, setState] = React.useState(()=> (sig && SHOT_PREVIS_KEPT.has(sig)) ? { res:SHOT_PREVIS_KEPT.get(sig) } : { busy:!!sig });
  React.useEffect(()=>{
    if(!sig){ setState({}); return; }
    if(SHOT_PREVIS_KEPT.has(sig)){ setState({ res:SHOT_PREVIS_KEPT.get(sig) }); return; }
    let live = true;
    setState({ busy:true });
    const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
    // (asked again when its turn comes: the Previs section may have drawn the same thing meanwhile)
    const run = ()=> !live ? null : SHOT_PREVIS_KEPT.has(sig) ? SHOT_PREVIS_KEPT.get(sig)
      : window.ShotPrevis.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:960,
          ...(look ? { look } : {}), ...(staged ? { startState:staged.start, endState:staged.end } : {}) });
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
  return { able, ready, plan, cam, loc, staged, ...state };
}
// (bare = inside a beat's own card: no row of its own to open, the drawings alone)
function BeatStrip({ scene, beatN, shots, sceneShots, ctx, onView, readOnly, bare }){
  const [open, setOpen] = React.useState(!!bare);
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!scene || !SP || !SPv || typeof SPv.beat!=="function" || !window.KinolotPrevis) return null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[scene.id] || null;
  if(!plan || !SP.exact(plan)) return null;
  const list = beatStripShots(shots);
  if(!list.length) return null;
  const staged = open ? shotPrevisStaged(sceneShots||shots) : {};
  const sig = open ? JSON.stringify(list.map(sh=>{ const loc = shotPrevisPlace(sh, plan, ctx); return [loc ? shotPrevisSig(sh, plan, shotPrevisCamera(sh, plan), loc, ctx) : sh.id, staged[sh.id]||null]; })) : "";
  // the beat's end frame sits on its last planned shot (shots.jsx shotEndFrameWanted)
  const last = list[list.length-1];
  const endOwnerId = (last && typeof shotEndFrameWanted==="function" && shotEndFrameWanted(last, sceneShots||shots)) ? last.id : "";
  // (sheet-card: the Art Room's own light card, so the strip reads as one of the beat's cards)
  if(bare) return SPV_E("div",{className:"beat-strip bare open","data-testid":"beat-strip","data-beat":beatN},
    SPV_E(BeatStripBody,{list,plan,ctx,sig,onView,beatN,staged,readOnly,endOwnerId,bare:true}));
  return SPV_E("div",{className:"sheet-card beat-strip"+(open?" open":""),"data-testid":"beat-strip","data-beat":beatN},
    SPV_E("div",{className:"beat-strip-head"},
      SPV_E("button",{type:"button",className:"beat-strip-toggle","aria-expanded":open?"true":"false",onClick:()=>setOpen(o=>!o)},
        SPV_E(open?Icon.chevD:Icon.chevR,{s:12}),
        SPV_E("span",{className:"beat-strip-lab"},"Beat "+beatN+" in code"),
        SPV_E("span",{className:"beat-strip-sum"},list.length+" shot"+(list.length!==1?"s":"")+", start to end")),
      window.InfoTip && SPV_E(window.InfoTip,{label:"About the beat in code",
        text:"The whole beat staged once, in code, in the place\u2019s own 3D set: one room that goes on, with everyone and everything where the shot before left them. Each shot of the beat is drawn from it through its own camera: how it starts, a middle picture when someone crosses the room, and how it ends. An arrow between two shots means the next one starts at the very instant the last one ends. It costs nothing and changes nothing."})),
    open && SPV_E(BeatStripBody,{list,plan,ctx,sig,onView,beatN,staged,readOnly,endOwnerId}));
}
/* THE PREVIS A FRAME IS MADE FROM (2026-11-23, code-first frames, step 2: "once the cameras are locked in ... bring
   image model to support with rendering"). The shot drawn at working size, with what each stand-in is, in words.
   which = "start" (the shot's frame) or "end" (its end frame); pose = a camera to reuse (the end frame and the check
   use the camera the shot's frame was made with). Returns null when the shot has no previs to give (no plan with
   marks, no floor plan); throws the drawing's own sentence when the 3D view cannot start.
   → {url, which, legend:[sentences], words (the camera and what its frame holds, read from the set), pose, source,
      moves (the shot ends differently from how it starts)} */
async function shotPrevisForFrame(sh, ctx, which, pose, width, sceneShots){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!sh || !sh.planned || !sh.startState || !SP || !SPv || !window.KinolotPrevis) return null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[sh.sceneId] || null;
  if(!plan || !SP.exact(plan)) return null;
  const loc = shotPrevisPlace(sh, plan, ctx);
  if(!loc) return null;
  const cam = shotPrevisCamera(sh, plan);
  const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
  // the room as the WHOLE SCENE staged once has it for this shot: the strip's own panel
  const st = shotPrevisStaged(sceneShots||[sh])[sh.id] || null;
  const run = ()=> SPv.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:width||1536, words:true, ...(pose ? { pose } : {}),
    ...(st ? { startState:st.start, endState:st.end } : {}) });
  const turn = shotPrevisLine.then(run, run);
  shotPrevisLine = turn.then(()=>{}, ()=>{});
  const res = await turn;
  if(!res || !res.start || !res.pose) return null;
  const end = which==="end";
  const pic = end ? (res.end || res.start) : res.start;
  const people = (end && res.end && res.end.people) || res.people, things = (end && res.end && res.end.things) || res.things;
  /* WHERE THE DRAWING HAS EACH PROP (2026-11-24: a prop's sheet was labelled by who owns it, "held by LIAQAT", while
     the drawing had it on the shelf). By prop card: in whose hands, on what, hanging from what. A prop whose sheet
     rides along and which the drawing does not hold is said to be out of the picture. */
  const who = id=>{ const p = (people||[]).find(x=>x && x.id===id); return p ? p.name : ""; };
  const low = t=>String(t||"").replace(/^the /i,"").replace(/^./,c=>c.toLowerCase());
  const placed = (things||[]).map(t=>{ const pt = ((plan.things||[]).find(x=>x && x.key===t.key))||{};
    const holder = t.held && (people||[]).find(x=>x && x.id===t.held);
    return { propId:String(pt.propId||""), name:t.name, where:(holder && holder.unseen) ? "" : t.held ? "in "+who(t.held)+"\u2019s hands" : t.on ? (t.hung ? "hanging from the " : "on the ")+low(t.on) : "standing on its own" }; }).filter(x=>x.where);
  // who each stand-in is, then what sits on the shelves and hooks in frame (so the image engine dresses nothing itself)
  // (map = the frame measured in code; size / pitch = the size of shot and the tilt the drawing really has)
  return { url:pic.dataUrl, which:end?"end":"start", legend:SPv.legend(people, things).concat(pic.dressing||[]), words:pic.words||"", pose:res.pose, source:res.source||"", moves:!!res.end,
    map:pic.map||"", size:(pic.frame && pic.frame.size)||"", pitch:(pic.frame ? pic.frame.pitch : 0)||0, placed };
}
/* THE LAYOUT A WHOLE-BEAT CLIP IS GIVEN FOR A SHOT (owner 2026-11-24, the Previs look brief, step 6: "each shot's
   clay drawing is attached as a layout reference, one per shot, in shot order ... The prompt says, for each shot,
   which reference is its layout and which figure is which person"). The shot as it STARTS, drawn in clay through
   the camera the plan holds for it (placed, or set by hand), with the room as the whole scene staged once has it.
   Clay, not Colour: a video engine copies what it is shown, and clay has no surface or colour of the set to copy,
   only where things are. Free; nothing is saved; kept for the session by what it was drawn from.
   → {url, legend:[who each figure is, what each red shape is], camera:"stands … m away, … m high, … mm lens",
      lensMm, source ("plan" | "moved" | "hand" | "app"), from, sig} or null when the shot has no previs. */
const SHOT_LAYOUT_KEPT = new Map();
async function shotPrevisLayout(sh, ctx, sceneShots, width){
  const SP = window.ScenePlan, SPv = window.ShotPrevis;
  if(!sh || !sh.planned || !sh.startState || !SP || !SPv || !window.KinolotPrevis) return null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[sh.sceneId] || null;
  if(!plan || !SP.exact(plan)) return null;
  const loc = shotPrevisPlace(sh, plan, ctx);
  if(!loc) return null;
  const cam = shotPrevisCamera(sh, plan);
  const st = shotPrevisStaged(sceneShots||[sh])[sh.id] || null;
  let sig = "";
  try{ sig = shotPrevisSig(sh, plan, cam, loc, ctx)+"|layout|"+JSON.stringify(st||null)+"|"+(width||960); }catch(e){ sig = ""; }
  if(sig && SHOT_LAYOUT_KEPT.has(sig)) return SHOT_LAYOUT_KEPT.get(sig);
  const cast = Object.values(((ctx||{}).charById)||{}), props = Object.values(((ctx||{}).propById)||{});
  const run = ()=> SPv.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:width||960, look:"clay",
    ...(st ? { startState:st.start, endState:st.end } : {}) });
  const turn = shotPrevisLine.then(run, run);
  shotPrevisLine = turn.then(()=>{}, ()=>{});
  const res = await turn;
  if(!res || !res.start || !res.pose) return null;
  const pos = res.pose.position||[];
  const out = { url:res.start.dataUrl, legend:SPv.legend(res.people, res.things), lensMm:Number(res.pose.lensMm)||0,
    camera:["stands "+shotPrevisNum(res.distance,1)+" m from what it frames", shotPrevisNum(pos[2],1)+" m high", shotPrevisNum(res.pose.lensMm)+" mm lens"].join(", "),
    source:res.source||"", from:res.from||null, sig };
  if(sig){ SHOT_LAYOUT_KEPT.set(sig, out); if(SHOT_LAYOUT_KEPT.size>60) SHOT_LAYOUT_KEPT.delete(SHOT_LAYOUT_KEPT.keys().next().value); }
  return out;
}
/* THE LOOK OF THE FRAME BEFORE, WITHOUT ITS LAYOUT (2026-11-23, after the first whole beat made from the strip: every
   frame came back framed like the one before it, because that frame rode along whole "for its look" and the image
   engine took its composition too). The frame is cut into a grid of twelve pieces, the pieces are moved to other
   places and every other one is mirrored: a sheet of SWATCHES. It still shows the colour grade, the light, skin and
   cloth, and every surface at its real grain; it is no longer a picture of the room, so it cannot say where the
   camera stands. Drawn in the browser, no engine. Returns a JPEG data URL, or "" when the picture cannot be read
   (the caller then sends no look reference at all, never the whole frame). */
const SHOT_SWATCH_ORDER = [7,2,10,5,0,11,3,8,1,6,9,4];   // where each piece of the 4 x 3 grid goes: none stays in its place
function shotLookSwatches(url, width){
  return new Promise(resolve=>{
    if(!url || typeof Image==="undefined" || typeof document==="undefined"){ resolve(""); return; }
    const im = new Image();
    let done = false; const end = (v)=>{ if(!done){ done = true; resolve(v); } };
    setTimeout(()=>end(""), 20000);
    if(!/^(data|blob):/.test(url)) im.crossOrigin = "anonymous";
    im.onerror = ()=>end("");
    im.onload = ()=>{
      try{
        const COLS = 4, ROWS = 3, W = Math.max(640,Math.min(1536,Math.round(Number(width)||960))), H = Math.round(W*9/16), tw = W/COLS, th = H/ROWS;
        const sw = im.naturalWidth/COLS, sh = im.naturalHeight/ROWS;
        if(!(sw>8 && sh>8)){ end(""); return; }
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d"); if(!g){ end(""); return; }
        g.fillStyle = "#111"; g.fillRect(0,0,W,H);
        SHOT_SWATCH_ORDER.forEach((to, from)=>{
          const sx = (from%COLS)*sw, sy = Math.floor(from/COLS)*sh, dx = (to%COLS)*tw, dy = Math.floor(to/COLS)*th;
          g.save();
          if(from%2){ g.translate(dx+tw, dy); g.scale(-1,1); g.drawImage(im, sx, sy, sw, sh, 0, 0, tw-4, th-4); }
          else g.drawImage(im, sx, sy, sw, sh, dx, dy, tw-4, th-4);
          g.restore();
        });
        end(c.toDataURL("image/jpeg", 0.88));
      }catch(e){ end(""); }
    };
    im.src = url;
  });
}
// a frame "made from its previs": the next Generate of this shot takes it (set by the Previs fold's button, read once by the card)
// (the mark lasts ten minutes: a run the person then cancels must not turn a later, ordinary Generate into this one)
function shotPrevisAskNext(id){ window.__shotPrevisNext = window.__shotPrevisNext || {}; window.__shotPrevisNext[id] = Date.now(); }
function shotPrevisTakeNext(id){ const m = window.__shotPrevisNext, at = m && m[id]; if(!at) return false; delete m[id]; return Date.now()-at < 600000; }
Object.assign(window, { useShotDrawing, beatStripInfo, beatStripRows, shotPrevisBusy, SHOT_PREVIS_LOOKS, ShotPrevisFold, BeatStrip, shotLookSwatches, SHOT_SWATCH_ORDER, beatStripShots, shotPrevisStaged, shotPrevisMaker, shotPrevisMakeBeat, shotPrevisPlace, shotPrevisCamera, shotPrevisSig, shotPrevisForFrame, shotPrevisLayout, shotPrevisAskNext, shotPrevisTakeNext });

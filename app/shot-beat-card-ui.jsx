/* THE SHOTS TAB, BEAT FIRST: THE SCREEN (owner 2026-11-24, their design "Shots tab: a beat and its open shot").
   ShotBeatFace is a beat's own card: its number and name, where it plays, how many shots and seconds, four counts,
   a small picture of every shot (pressing one opens that shot under the card), and the beat's actions: Send this
   beat to the Stage, Draw the beat, Make frames in order, New shot in this beat.
   ShotFacePicture, ShotPlanMap and ShotStep are the pieces an open shot's card is laid out with (shots-ui.jsx
   ShotCard, face). The words and numbers come from shot-beat-card.js; the drawings from shot-previs-ui.jsx.
   Nothing here makes an image, a clip or a charge by itself: "Make frames in order" asks first, with the price. */
const SBC_E = React.createElement;
// true once the element has been on screen (a beat far down the page is not drawn until it is reached)
function useSbcSeen(ref){
  const [seen, setSeen] = React.useState(false);
  React.useEffect(()=>{
    if(seen) return;
    const el = ref.current;
    if(!el || typeof IntersectionObserver!=="function"){ setSeen(true); return; }
    const io = new IntersectionObserver(es=>{ if(es.some(e=>e.isIntersecting)){ setSeen(true); io.disconnect(); } },{ rootMargin:"300px" });
    io.observe(el);
    return ()=>io.disconnect();
  },[seen]);
  return seen;
}
function ShotBeatFace({ L, lanesLen, bm, scene, ctx, ordered, openId, onOpen, onView, readOnly=false, onAddShot, momentsLine=null, busy=false, strip=false, onStrip=null }){
  const K = window.KinolotBeatCard;
  const ref = React.useRef(null), seen = useSbcSeen(ref);
  const [, tick] = React.useState(0);
  const [rows, setRows] = React.useState(null);
  const [run, setRun] = React.useState("");
  // the frames the cards hold change while this is open (a frame was made, loaded or approved): look again
  React.useEffect(()=>{ const h = ()=>tick(n=>n+1);
    ["nb-gen-done","nb-meta-changed","nb-prefetched","nb-gen-start"].forEach(ev=>window.addEventListener(ev,h));
    const t = setInterval(h, 2500);
    return ()=>{ ["nb-gen-done","nb-meta-changed","nb-prefetched","nb-gen-start"].forEach(ev=>window.removeEventListener(ev,h)); clearInterval(t); }; },[]);
  const shots = K.order(L.shots);
  const info = (seen && typeof window.beatStripInfo==="function") ? window.beatStripInfo(scene, L.shots, ordered, ctx) : null;
  const sig = info ? info.sig : "";
  React.useEffect(()=>{
    if(!sig || typeof window.beatStripRows!=="function"){ setRows(null); return; }
    let live = true;
    window.beatStripRows(info, ctx).then(r=>{ if(live) setRows(r||null); }, ()=>{ if(live) setRows(null); });
    return ()=>{ live = false; };
  },[sig]);
  const img = (id)=> (typeof nbGetImage==="function") ? (nbGetImage(id)||"") : "";
  const rowOf = (sh)=>{ const i = info ? info.list.findIndex(x=>x.id===sh.id) : -1; return (i>=0 && rows && rows[i]) || null; };
  const drawn = (sh)=>{ const r = rowOf(sh); return !!(r && r.start); };
  const making = (id)=> typeof window.shotPrevisBusy==="function" && window.shotPrevisBusy(id);
  const c = K.counts(shots, { frame:sh=>img(sh.id), drawn });
  const seconds = shots.reduce((n,sh)=>n+(typeof shotDur==="function" ? (Number(shotDur(sh))||0) : (Number(sh.dur)||0)), 0);
  const first = shots[0] || null;
  const plan = ((((ctx||{}).project||{}).scenePlans)||{})[scene.id] || null;
  const place = first ? (((typeof window.shotPrevisPlace==="function" && plan) ? window.shotPrevisPlace(first, plan, ctx) : null)
    || (ctx.locations||[]).find(l=>l && l.id===first.locationId) || (typeof locationForScene==="function" ? locationForScene(ctx.locations||[], scene.id) : null)) : null;
  const beatRows = typeof window.shotScreenplayBeatRows==="function"
    ? window.shotScreenplayBeatRows(scene,{drafts:ctx.drafts||((window.turnContinuity||{}).drafts)||{},beatsMap:{[scene.id]:bm||{}}}) : ((bm && bm.rows)||[]);
  const title = K.beatTitle((beatRows||[]).find(r=>Number(r && r.n)===Number(L.n)));
  const anyBusy = !!run || !!busy || shots.some(sh=>making(sh.id));
  const canMake = !readOnly && shots.some(sh=>typeof window.shotPrevisMaker==="function" && window.shotPrevisMaker(sh.id) && drawn(sh));
  const makeAll = async ()=>{
    if(anyBusy || !info) return;
    const n = info.list.length+(info.endOwnerId?1:0);
    const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(n) : "";
    const ok = typeof window.appConfirm==="function" ? await window.appConfirm({
      title:"Make beat "+L.n+"’s "+n+" frame"+(n!==1?"s":"")+" in order?",
      body:"Each shot’s frame is made from its drawing, in order"+(info.endOwnerId?", then the beat’s end frame":"")+". The set, the camera and where everyone and everything is come from the drawings; the image engine adds the people, the surfaces and the light."
        +(price ? " About "+price+" credit"+(price==="1"?"":"s")+"." : "")+" A frame that is there now is kept as an earlier version. Nothing is approved.",
      confirmLabel:"Make "+n+" frame"+(n!==1?"s":""), cancelLabel:"Cancel" }) : true;
    if(!ok) return;
    setRun("Starting…");
    try{ const made = await window.shotPrevisMakeBeat(info.list, info.endOwnerId, setRun);
      if(typeof window.appToast==="function") window.appToast("Beat "+L.n+": "+made+" of "+n+" frame"+(n!==1?"s":"")+" made."+(made<n?" The run stopped there: a frame did not start or was not made.":""), made<n?"info":"success"); }
    finally{ setRun(""); }
  };
  const toStage = ()=>{ if(typeof window.turnSendBeatToStage==="function") window.turnSendBeatToStage(scene.id, L.n, first ? first.id : ""); };
  return SBC_E("section",{ref,className:"sheet-card sbc-beat","data-testid":"beat-card","data-beat":L.n,"aria-label":"Beat "+L.n},
    SBC_E("div",{className:"sbc-beat-head"},
      SBC_E("span",{className:"sbc-kicker"},"Beat "+L.n+(lanesLen>1?" of "+lanesLen:""),
        String((bm||{}).turnAt||"")===String(L.n) && SBC_E("span",{className:"sbc-turn",title:"The scene turns in this beat."},Icon.bolt && SBC_E(Icon.bolt,{s:10}),"Turning point")),
      SBC_E("h3",{className:"sbc-beat-title"},title || "Beat "+L.n),
      SBC_E("span",{className:"sbc-beat-meta","data-testid":"beat-card-meta"},K.beatMeta({ place:place && place.name, shots:shots.length, seconds }))),
    SBC_E("div",{className:"sbc-chips","data-testid":"beat-card-counts"},K.countWords(c).map((t,i)=>SBC_E("span",{key:i,className:"sbc-chip"},t))),
    momentsLine,
    shots.length>0 && SBC_E("div",{className:"sbc-thumbs",role:"group","aria-label":"The shots of beat "+L.n},shots.map(sh=>{
      const r = rowOf(sh), frame = img(sh.id), open = sh.id===openId;
      const pic = frame || (r && r.start && r.start.dataUrl) || "";
      const state = K.state({ open, making:making(sh.id), approved:!!sh.locked, frame:!!frame, drawn:!!(r && r.start), planned:!!(sh.planned && sh.startState) });
      return SBC_E("button",{key:sh.id,type:"button",className:"sbc-thumb"+(open?" open":""),"aria-pressed":open?"true":"false","data-testid":"beat-card-shot","data-shot":sh.id,
          title:open ? "This shot is open below." : "Open this shot below.",onClick:()=>onOpen && onOpen(sh.id)},
        pic ? SBC_E("img",{src:pic,alt:""}) : SBC_E("span",{className:"sbc-thumb-none","aria-hidden":"true"},K.SHORT[String(sh.size||"").toUpperCase()]||"Shot"),
        SBC_E("span",{className:"sbc-thumb-name"},K.number(sh)+" "+K.name(sh)),
        SBC_E("span",{className:"sbc-thumb-state"+(open?" open":state==="Frame made"||state==="Approved"?" made":"")},state));
    })),
    SBC_E("div",{className:"sbc-acts"},
      SBC_E("button",{type:"button",className:"sbc-btn primary","data-testid":"beat-card-stage",
        title:"Open the Stage on this beat’s clip. Nothing is rendered until you press Generate there.",onClick:toStage},"Send this beat to the Stage"),
      SBC_E("div",{className:"sbc-acts-row"},
        SBC_E("button",{type:"button",className:"sbc-btn","data-testid":"beat-card-draw","aria-expanded":strip?"true":"false",disabled:!info,
          title:info ? "The whole beat staged once in code: every shot from start to end, with the frames under their drawings. Free." : "Plan this scene first (Scene plan, above): a beat is drawn from its plan.",
          onClick:()=>onStrip && onStrip(!strip)},strip ? "Hide the beat’s drawings" : "Draw the beat"),
        SBC_E("button",{type:"button",className:"sbc-btn","data-testid":"beat-card-frames",disabled:!canMake || anyBusy,
          title:canMake ? "Make every frame of this beat from its drawing, in order. It asks first, with the price." : "Draw the beat first: a frame is made from its drawing.",
          onClick:makeAll},"Make frames in order",
          canMake && info && typeof window.nbCostChip==="function" && window.nbCostChip(info.list.length+(info.endOwnerId?1:0)))),
      run && SBC_E("span",{className:"shot-previs-wait",role:"status","data-testid":"beat-card-run"},SBC_E("span",{className:"ns-spin"}),run),
      (!readOnly && onAddShot) && SBC_E("button",{type:"button",className:"sbc-btn dashed","data-testid":"beat-card-new",
        title:"Add a shot to this beat.",onClick:()=>onAddShot()},"New shot in this beat")));
}

/* THE PICTURE AT THE TOP OF AN OPEN SHOT: one box, four ways to look at it. Previs, Clay and Depth are the shot drawn
   in code as it starts; Frame is the shot's own frame, with everything a frame's picture has (its menu, its versions,
   its Generate button). The frame's picture stays in the page while another view shows: it is only hidden. */
function ShotFacePicture({ view, onView, views, drawing, frame, tag, onLarger }){
  const shown = view!=="frame";
  const res = drawing && drawing.res, pic = res && res.start;
  return SBC_E("div",{className:"sbc-pic-wrap"},
    SBC_E("div",{className:"sbc-pic"+(shown?"":" frame"),"data-view":view},
      shown && (pic
        ? SBC_E("img",{src:pic.dataUrl,alt:tag+", drawn in code",role:"button",tabIndex:0,title:"View larger",
            onClick:()=>onLarger && onLarger(pic.dataUrl,{name:tag}),
            onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onLarger && onLarger(pic.dataUrl,{name:tag}); } }})
        : SBC_E("div",{className:"sbc-pic-none","data-testid":"shot-face-none"},
            drawing && drawing.busy ? SBC_E("span",{className:"shot-previs-wait",role:"status"},SBC_E("span",{className:"ns-spin"}),"Drawing this shot…")
              : SBC_E(React.Fragment,null,
                  SBC_E("b",null,drawing && drawing.err ? "This shot could not be drawn" : "No drawing yet"),
                  SBC_E("span",null,drawing && drawing.err ? drawing.err
                    : !(drawing && drawing.able) ? "Plan this scene (Scene plan, above) and each shot is drawn from its plan."
                    : !drawing.ready ? "This place has no floor plan yet. Draw it in Locations."
                    : "It is drawn when this shot is opened.")))),
      SBC_E("div",{className:"sbc-pic-frame",hidden:shown},frame),
      shown && pic && SBC_E("span",{className:"sbc-pic-tag"},tag)),
    SBC_E("div",{className:"sbc-views",role:"group","aria-label":"What the picture shows","data-testid":"shot-face-views"},
      views.map(v=>SBC_E("button",{key:v.id,type:"button","aria-pressed":v.id===view?"true":"false",title:v.title,onClick:()=>onView(v.id)},v.name))));
}

// the small floor plan of an open shot's Camera step: the camera, where it looks, each person on their mark
function ShotPlanMap({ model, label }){
  if(!model) return null;
  const pts = a=>a.map(q=>q[0]+","+q[1]).join(" ");
  return SBC_E("svg",{className:"lsc-plan sbc-plan",viewBox:"0 0 "+model.W+" "+model.H,role:"img","aria-label":label,"data-testid":"shot-face-plan"},
    model.rooms.map(r=>SBC_E("polygon",{key:r.id,points:pts(r.points),className:"lsc-room"+(r.lit?" lit":""),style:{strokeWidth:model.wall}})),
    model.doors.map((o,i)=>SBC_E("line",{key:"d"+i,x1:o.a[0],y1:o.a[1],x2:o.b[0],y2:o.b[1],className:"lsc-door",style:{strokeWidth:model.wall+1.5}})),
    model.windows.map((o,i)=>SBC_E("line",{key:"w"+i,x1:o.a[0],y1:o.a[1],x2:o.b[0],y2:o.b[1],className:"lsc-window",style:{strokeWidth:model.wall+1.5}})),
    model.rooms.map(r=>SBC_E("text",{key:"n"+r.id,x:r.at[0],y:r.at[1],className:"lsc-room-name"+(r.lit?" lit":""),textAnchor:"middle",dominantBaseline:"central"},r.name)),
    model.camera && model.camera.cone && SBC_E("polygon",{points:pts(model.camera.cone),className:"lsc-cone"}),
    model.people.map(p=>SBC_E("g",{key:p.id,className:"sbc-mark",transform:"translate("+p.at[0]+" "+p.at[1]+")"},
      SBC_E("circle",{r:10,style:p.css?{fill:p.css}:undefined}),
      SBC_E("text",{textAnchor:"middle",dominantBaseline:"central"},p.initial))),
    model.camera && SBC_E("g",{className:"lsc-cam sbc-cam",transform:"translate("+model.camera.at[0]+" "+model.camera.at[1]+")"},SBC_E("circle",{r:9})));
}

// one numbered step of an open shot: its number, its name, where it stands (done, next, later), and its content
function ShotStep({ step, children, id }){
  return SBC_E("section",{className:"sbc-step "+step.state,"data-testid":"shot-face-step","data-step":step.n,id},
    SBC_E("div",{className:"sbc-step-head"},
      SBC_E("span",{className:"sbc-step-n"},step.n),
      SBC_E("h4",{className:"sbc-step-name"},step.name),
      SBC_E("span",{className:"sbc-step-state"+(step.state==="next"?" next":"")},step.note)),
    children);
}
Object.assign(window, { ShotBeatFace, ShotFacePicture, ShotPlanMap, ShotStep });

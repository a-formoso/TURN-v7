/* THE SET CARD, DRAWN (owner 2026-11-23: a card the owner designed, built here on the place's own data; "keep this
   exact same structure and design and layout used in the demo ... change the colors, button sizes, the spacing, the
   font type, so it matches our app", then: "create sections on the card that allow us to fold each section as we are
   able to do for other tab cards ... a floor plan section ... the exact same level of detail we have on the demo").
   Top to bottom, as designed:
     the chosen camera's view (MASTER SET, CAM n) · the name, and a chip for the place and each room · the facts and
     what the camera is for · Blockout / Clay / Depth
   then sections that fold, as on a character or a prop card:
     Location sheet (four views, tap one, and what the space connects to) · The place (its description, the card's
     own section) · Floor plan (the walls, the doors and windows, the chosen room lit, the camera and what it takes
     in, two stand-ins to drag, their place in metres; the plan's own tools under it) · Reference pack · Location
     image (the card's picture, with all it could do before).
   The chips are the rooms (owner 2026-11-23): pressing one makes the whole card that space's (onSpace).
   It draws from the place's own 3D set (KinolotPrevis: the floor plan, the four cameras, the saved dressing) with
   painted surfaces and two jointed stand-ins, and saves nothing. A browser keeps only a few 3D views alive, so the
   whole tab shares ONE: it belongs to the card last worked on and closes after half a minute of rest. */
const LSC_E = React.createElement;
let lscLine = Promise.resolve();
let lscLive = null;   // {key, view, built, timer}
function lscClose(){ if(!lscLive) return; clearTimeout(lscLive.timer); try{ lscLive.view.dispose(); }catch(_){} lscLive = null; }
/* jobs: [{key, w, h, look}] → the pictures, as JPEG data URLs in the same order ("" for a camera that is not set).
   cast = the stand-ins as the viewer takes them. stale() true = nobody waits for this drawing any more: it is
   skipped (a stand-in being dragged asks for many). Throws the set builder's own sentence when the floor plan or the
   cameras are not ready. */
function lscDraw(space, jobs, cast, stale){
  const run = async ()=>{
    if(typeof stale==="function" && stale()) return null;
    const P = window.KinolotPrevis;
    if(!P || typeof P.scene!=="function" || typeof P.viewer!=="function") throw new Error("The set in 3D is not available here.");
    const key = lscSig(space);
    if(lscLive && lscLive.key!==key) lscClose();
    if(!lscLive){
      const built = P.scene(space);
      const view = await P.viewer(built.scene, built.light, { surfaces:true });
      lscLive = { key, view, built, timer:0 };
    }
    clearTimeout(lscLive.timer);
    lscLive.timer = setTimeout(lscClose, 30000);
    const view = lscLive.view, built = lscLive.built;
    try{
      return { dressed:!!built.dressed, parts:built.parts||0, urls:jobs.map(j=>{
        const pose = built.scene.cameras[j.key]; if(!pose) return "";
        const cv = document.createElement("canvas");
        view.render(cv, pose, j.w, j.h, j.look||"", cast||[]);
        return cv.toDataURL("image/jpeg", 0.88); }) };
    }catch(e){ lscClose(); throw e; }
  };
  const turn = lscLine.then(run, run);
  lscLine = turn.then(()=>{}, ()=>{});
  return turn;
}
// what a space's pictures are drawn from, as a text: when it changes they are out of date (as LocationSetPicture)
function lscSig(l){
  const P = window.KinolotPrevis;
  try{ return [l.id, typeof locationSpatialPlanSigFor==="function" ? locationSpatialPlanSigFor(l) : "",
    typeof locationPlateLayoutSig==="function" ? locationPlateLayoutSig(l,{panels:true}) : "",
    P && typeof P.dressingSig==="function" ? P.dressingSig(l) : (l.previs&&l.previs.iso)||""].join("|"); }
  catch(_){ return l.id; }
}
// is this element on screen (or nearly)? Cards far down the tab draw only when they are reached.
function useLscOnScreen(ref){
  const [seen, setSeen] = React.useState(false);
  React.useEffect(()=>{
    const el = ref.current; if(!el || seen) return undefined;
    if(typeof IntersectionObserver!=="function"){ setSeen(true); return undefined; }
    const io = new IntersectionObserver(es=>{ if(es.some(e=>e.isIntersecting)) setSeen(true); }, { rootMargin:"300px" });
    io.observe(el); return ()=>io.disconnect();
  },[seen]);
  return seen;
}

/* A SECTION THAT FOLDS, with the look and the behaviour of the other cards' sections (CardFold): pressing its name
   opens or shuts it, and a link elsewhere that names it (nb-open-fold with its id) opens it and brings it into view.
   keep = what is inside stays on the page while it is shut (the location image goes on being made or edited). */
function LscFold({ label, count, defaultOpen, foldId, keep=false, testid, children }){
  const [open, setOpen] = React.useState(!!defaultOpen);
  const ref = React.useRef(null);
  React.useEffect(()=>{ if(!foldId) return undefined;
    const h = e=>{ if(!e || e.detail!==foldId) return;
      setOpen(true);
      setTimeout(()=>{ const el = ref.current; if(!el) return;
        try{ el.scrollIntoView({ behavior:"smooth", block:"start" }); }catch(_){}
        el.classList.remove("fold-flash"); void el.offsetWidth; el.classList.add("fold-flash");
        setTimeout(()=>{ if(ref.current) ref.current.classList.remove("fold-flash"); }, 2000); }, 60); };
    window.addEventListener("nb-open-fold", h); return ()=>window.removeEventListener("nb-open-fold", h); },[foldId]);
  const Chev = (window.Icon && (open ? window.Icon.chevD : window.Icon.chevR)) || null;
  return LSC_E("div",{ className:"sheet-fold lsc-fold "+(open?"open":""), ref, "data-testid":testid, "data-fold":label },
    LSC_E("button",{ type:"button", className:"sheet-fold-head", "aria-expanded":open?"true":"false", onClick:()=>setOpen(o=>!o) },
      LSC_E("span",{ className:"sheet-fold-ic" }, Chev ? LSC_E(Chev,{ s:12 }) : (open ? "▾" : "▸")),
      LSC_E("span",{ className:"sheet-sec", style:{ margin:0, border:0, padding:0 } }, label),
      count!=null && count!=="" && LSC_E("span",{ className:"sheet-fold-count" }, count)),
    (open || keep) && LSC_E("div",{ className:"sheet-fold-body", hidden:!open }, children));
}

/* THE PLAN: every room's walls at their thickness, a door as a gap and a window as a pane of glass, the chosen room
   lit with its size, the chosen camera as a numbered dot with what it takes in, and the two stand-ins. A stand-in is
   dragged with a finger or the mouse, or moved 10 cm at a time with the arrow keys; onMove(id, [x, y] in metres,
   done) says where. */
function LocationSetPlan({ model, label, onMove }){
  const svg = React.useRef(null), drag = React.useRef("");
  if(!model) return null;
  const K = window.KinolotSetCard;
  const pts = a=>a.map(q=>q[0]+","+q[1]).join(" ");
  const metres = e=>{ const el = svg.current; if(!el || !el.createSVGPoint) return null;
    const pt = el.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(el.getScreenCTM().inverse()); return K.planMetres(model, q.x, q.y); };
  const person = k=>{
    const down = e=>{ if(!onMove) return; drag.current = k.id; try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){} e.preventDefault(); };
    const move = e=>{ if(drag.current!==k.id) return; const q = metres(e); if(q) onMove(k.id, q, false); };
    const up = e=>{ if(drag.current!==k.id) return; drag.current = ""; const q = metres(e); if(q) onMove(k.id, q, true); };
    const key = e=>{ const d = { ArrowLeft:[-0.1,0], ArrowRight:[0.1,0], ArrowUp:[0,0.1], ArrowDown:[0,-0.1] }[e.key]; if(!d || !onMove) return;
      e.preventDefault(); const here = K.planMetres(model, k.at[0], k.at[1]); onMove(k.id, [here[0]+d[0], here[1]+d[1]], true); };
    return LSC_E("g",{ key:k.id, className:"lsc-person"+(onMove?" can-move":""), transform:"translate("+k.at[0]+" "+k.at[1]+")", tabIndex:onMove?0:undefined,
        role:onMove?"slider":undefined, "aria-label":onMove?"Stand-in "+k.id+". Drag it, or use the arrow keys to move it 10 centimetres.":"Stand-in "+k.id,
        "data-person":k.id, onPointerDown:down, onPointerMove:move, onPointerUp:up, onPointerCancel:()=>{ drag.current = ""; }, onKeyDown:key },
      LSC_E("circle",{ r:17, className:"lsc-person-hit" }),
      LSC_E("rect",{ x:-9, y:-9, width:18, height:18, rx:4, style:{ fill:k.css } }),
      LSC_E("text",{ textAnchor:"middle", dominantBaseline:"central" }, k.id));
  };
  return LSC_E("svg",{ ref:svg, className:"lsc-plan", viewBox:"0 0 "+model.W+" "+model.H, role:"group", "aria-label":label, "data-testid":"set-card-plan" },
    model.rooms.map(r=>LSC_E("polygon",{ key:r.id, points:pts(r.points), className:"lsc-room"+(r.lit?" lit":""), style:{ strokeWidth:model.wall } })),
    // the chosen space, outlined in the app's amber over its walls, so it is the first thing seen
    model.rooms.filter(r=>r.lit).map(r=>LSC_E("polygon",{ key:"lit"+r.id, points:pts(r.points), className:"lsc-room-lit" })),
    model.doors.map((o,i)=>LSC_E("line",{ key:"d"+i, x1:o.a[0], y1:o.a[1], x2:o.b[0], y2:o.b[1], className:"lsc-door", style:{ strokeWidth:model.wall+1.5 } })),
    model.windows.map((o,i)=>LSC_E("line",{ key:"w"+i, x1:o.a[0], y1:o.a[1], x2:o.b[0], y2:o.b[1], className:"lsc-window", style:{ strokeWidth:model.wall+1.5 } })),
    model.rooms.map(r=>LSC_E("text",{ key:"n"+r.id, x:r.at[0], y:r.at[1]-(r.size?6:0), className:"lsc-room-name"+(r.lit?" lit":""), textAnchor:"middle", dominantBaseline:"central" }, r.name)),
    model.rooms.filter(r=>r.size).map(r=>LSC_E("text",{ key:"s"+r.id, x:r.at[0], y:r.at[1]+8, className:"lsc-room-size", textAnchor:"middle", dominantBaseline:"central" }, r.size)),
    model.camera && model.camera.cone && LSC_E("polygon",{ points:pts(model.camera.cone), className:"lsc-cone" }),
    model.camera && LSC_E("g",{ className:"lsc-cam", transform:"translate("+model.camera.at[0]+" "+model.camera.at[1]+")" },
      LSC_E("circle",{ r:10 }),
      LSC_E("text",{ textAnchor:"middle", dominantBaseline:"central" }, model.camera.n)),
    model.people.map(person));
}

// what a place's card was last looking at (the look, and where the stand-ins were put): kept while the tab is open,
// so that pressing a room's chip, which brings that room's own card, does not start over
const lscKept = {};
function LocationSetCard({ place, rooms, space:spaceId="", onSpace=null, project, scenes, readOnly=false, slots=null, planOpen=false, planReady=false, onUpdate=null }){
  const K = window.KinolotSetCard;
  const ref = React.useRef(null), onScreen = useLscOnScreen(ref);
  const all = K.spaces(place, rooms);
  const kept = lscKept[place.id] || (lscKept[place.id] = { look:"blockout", moved:{} });
  const [pick, setPickNow] = React.useState({ space:spaceId || place.id, cam:0, look:kept.look });
  const setPick = fn=>setPickNow(p=>{ const next = fn(p); kept.look = next.look; return next; });
  // space = the card's own space when the card says which (the chips then change the card), else the one picked here
  const space = all.find(s=>s.id===(spaceId || pick.space)) || all[0];
  const choose = id=>{ if(typeof onSpace==="function") onSpace(id); else setPick(p=>({ ...p, space:id, cam:0 })); };
  const list = ((window.turnContinuity||{}).locations) || undefined;
  const views = K.views(space.location, list);
  const camIndex = Math.min(pick.cam, Math.max(0, views.length-1)), view = views[camIndex] || null;
  const look = K.LOOKS.find(x=>x.id===pick.look) || K.LOOKS[0];
  // the floor plan, whatever its state (a plan not confirmed yet is still worth looking at)
  let plan = null, coords = null, ready = false;
  try{ const st = typeof locationSpatialPlanState==="function" ? locationSpatialPlanState(place) : null;
    const owner = (st && st.owner) || place;
    plan = typeof locationFloorPlanScene==="function" ? locationFloorPlanScene(owner, st && st.plan) : null;
    coords = st && st.plan && st.plan.coordinates; ready = !!(st && st.ready); }catch(_){ plan = null; }
  const drawn = !!(plan && (plan.spaces||[]).length);
  const links = drawn ? K.connections(space.id, plan) : [];
  const sig = lscSig(space.location);

  // the two stand-ins: where a scene's marks put them, or the middle of the room, until they are dragged
  const found = K.marks(project, [space.id], scenes);
  const start = drawn ? K.standIns(space, plan, found, coords) : null;
  const [moved, setMovedNow] = React.useState(kept.moved);
  const setMoved = fn=>setMovedNow(m=>{ const next = fn(m); kept.moved = next; return next; });
  const mine = moved[space.id] || {};
  const people = start ? { A:mine.A || start.A, B:mine.B || start.B } : null;
  const names = start ? { A:mine.A ? "" : start.names.A, B:mine.B ? "" : start.names.B } : null;
  const [settled, setSettled] = React.useState(0);   // goes up when a stand-in is let go: the four views are drawn again
  const movePerson = (id, xy, done)=>{ if(!start) return;
    const at = K.keepInside(start.footprint, xy, people[id]);
    setMoved(m=>({ ...m, [space.id]:{ ...(m[space.id]||{}), [id]:at } }));
    if(done) setSettled(n=>n+1); };
  const cast = people ? K.PEOPLE.map(k=>({ xy:people[k.id], z:start.floorZ, to:people[k.id==="A"?"B":"A"], colour:k.colour, height:k.height })) : [];
  const castKey = people ? K.PEOPLE.map(k=>people[k.id].map(n=>n.toFixed(2)).join(",")).join(";") : "";
  const model = drawn ? K.planModel(plan, space, view ? view.key : "", people, 440) : null;

  /* the pictures: the four views (drawn again when the set changes or a stand-in is let go) and the chosen view,
     larger. While a new picture is on its way the one before stays up. */
  const [pics, setPics] = React.useState({ thumbs:null, thumbsOf:"", hero:"", heroOf:"", space:"", error:"", drawing:false });
  const thumbKey = sig+"|"+settled, heroKey = sig+"|"+(view?view.key:"")+"|"+look.look+"|"+castKey;
  const latest = React.useRef(""); latest.current = heroKey;
  React.useEffect(()=>{
    if(!onScreen || !view) return undefined;
    const needThumbs = pics.thumbsOf!==thumbKey;
    if(pics.heroOf===heroKey && !needThumbs) return undefined;
    let live = true;
    const jobs = (needThumbs ? K.KEYS.map(key=>({ key, w:320, h:180, look:"" })) : []).concat([{ key:view.key, w:960, h:540, look:look.look }]);
    setPics(p=>({ ...p, drawing:true, error:"" }));
    lscDraw(space.location, jobs, cast, ()=>!live || latest.current!==heroKey).then(res=>{ if(!live || !res) return;
      setPics(p=>({ thumbs:needThumbs ? Object.fromEntries(K.KEYS.map((key,i)=>[key, res.urls[i]])) : p.thumbs, thumbsOf:thumbKey,
        hero:res.urls[res.urls.length-1], heroOf:heroKey, space:space.id, error:"", drawing:false }));
    }, e=>{ if(live) setPics(p=>({ ...p, hero:"", heroOf:heroKey, space:space.id, drawing:false, error:(e&&e.message)||"The set could not be drawn." })); });
    return ()=>{ live = false; };
  },[onScreen, heroKey, thumbKey]);
  /* A SET THAT WAS NEVER DRESSED IS DRESSED BY ITSELF, the first time it is drawn here (owner 2026-11-23): one
     writing pass gives its objects their shape and colour, its fixed parts and its light (previsAutoDress, in Previs). */
  const drewIt = pics.space===space.id && !!pics.hero, undressed = !space.location.previs;
  React.useEffect(()=>{ if(drewIt && undressed && typeof window.previsAutoDress==="function") window.previsAutoDress(space.location, project, onUpdate, readOnly); },[drewIt, undressed, space.id]);
  const sameSpace = pics.space===space.id;
  const heroNow = sameSpace ? pics.hero : "", thumbsNow = sameSpace ? pics.thumbs : null;

  // the reference pack of the chosen view: made on request, shown until the view, the set or the stand-ins change
  const [pack, setPack] = React.useState({ of:"", urls:null, busy:false, error:"" });
  const packKey = sig+"|"+(view?view.key:"")+"|"+castKey;
  const build = ()=>{
    if(!view || pack.busy) return;
    setPack({ of:packKey, urls:null, busy:true, error:"" });
    lscDraw(space.location, K.PACK.map(p=>({ key:view.key, w:1280, h:720, look:p.look })), cast).then(
      res=>setPack({ of:packKey, urls:res ? res.urls : null, busy:false, error:"" }),
      e=>setPack({ of:packKey, urls:null, busy:false, error:(e&&e.message)||"The pack could not be made." }));
  };
  const packNow = pack.of===packKey ? pack : { of:"", urls:null, busy:false, error:"" };
  const go = n=>()=>{ if(typeof window.goToLocationStep==="function") window.goToLocationStep(space.location, n); };
  const cannot = sameSpace && !!pics.error && !heroNow;
  const S = slots || {};
  // the Floor plan section of the card itself: its name, its count and its link id, with its tools inside
  const planFold = (S.plan && S.plan.props) || {};
  const planTools = planFold.children;

  return LSC_E("div",{ ref, className:"lsc", "data-testid":"set-card", "data-set-card":place.id },
    // the chosen camera's view
    LSC_E("div",{ className:"lsc-stage"+(pics.drawing?" drawing":""), "aria-busy":pics.drawing?"true":"false", "data-look":look.id },
      heroNow ? LSC_E("img",{ src:heroNow, alt:(space.name||"This place")+", camera "+(view?view.n:1)+": "+(view?view.role:""), draggable:false })
        : cannot ? LSC_E("div",{ className:"lsc-empty", "data-testid":"set-card-empty" },
            LSC_E("b",null,"The set cannot be drawn yet"),
            // (until the floor plan is confirmed that is the one thing to say, in plain words)
            LSC_E("span",null, ready ? pics.error : "The set is built from the floor plan. Check the floor plan and confirm it first."),
            LSC_E("div",{ className:"lsc-empty-acts" },
              LSC_E("button",{ type:"button", className:"char-draft-btn ghost", onClick:go(2) },"Open Floor plan"),
              // (a confirmed plan whose set still cannot be drawn: the cameras are fitted and fixed in The set in 3D)
              ready && LSC_E("button",{ type:"button", className:"char-draft-btn ghost", onClick:go(4) },"Open The set in 3D")))
        : LSC_E("span",{ className:"lsc-wait" }, onScreen ? "Drawing the set…" : ""),
      LSC_E("span",{ className:"lsc-badge" },"MASTER SET"),
      view && !cannot && LSC_E("span",{ className:"lsc-camtag", "data-testid":"set-card-camtag" }, K.camTag(view))),
    LSC_E("div",{ className:"lsc-body" },
      // the name, and the place and its rooms
      LSC_E("div",{ className:"lsc-head" },
        S.nameRow || LSC_E("h3",{ className:"lsc-name", title:place.name||"" }, place.name||"This place"),
        // (one line that pans when the place has many rooms, as the owner asked of this row on 2026-11-21)
        all.length>1 && LSC_E("div",{ className:"lsc-chips", role:"group", "aria-label":"Space", "data-testid":"set-card-spaces" },
          LSC_E(typeof LocationChipScroller==="function" ? LocationChipScroller : React.Fragment, null,
            all.map(s=>LSC_E("button",{ key:s.id, type:"button", className:"lsc-chip", "aria-pressed":s.id===space.id?"true":"false",
              title:s.whole ? "The whole place" : s.name, onClick:()=>choose(s.id) }, s.chip))))),
      // the facts, and what this camera is for
      LSC_E("div",{ className:"lsc-info" },
        LSC_E("p",{ className:"lsc-mono", "data-testid":"set-card-facts" }, K.facts(space, all, plan, coords) || (drawn ? "" : "No floor plan yet")),
        LSC_E("p",{ className:"lsc-role" }, view ? view.role : "")),
      // the same view, three ways
      LSC_E("div",{ className:"lsc-seg", role:"group", "aria-label":"How the view is drawn" },
        K.LOOKS.map(x=>LSC_E("button",{ key:x.id, type:"button", "aria-pressed":x.id===look.id?"true":"false", title:x.title, disabled:cannot,
          onClick:()=>setPick(p=>({ ...p, look:x.id })) }, x.name))),

      // the set being dressed by itself: what it is doing, or what went wrong
      undressed && window.PrevisAutoLine && LSC_E(window.PrevisAutoLine,{ location:space.location, project, onUpdate, readOnly }),

      LSC_E("div",{ className:"lsc-folds" },
        LSC_E(LscFold,{ label:"Location sheet", defaultOpen:true, testid:"set-card-fold-sheet", count:views.length ? views.length+(views.length===1?" view":" views") : "" },
          LSC_E("div",{ className:"lsc-thumbs", "data-testid":"set-card-sheet" },
            views.map((v,i)=>LSC_E("button",{ key:v.key, type:"button", className:"lsc-thumb", "aria-pressed":i===camIndex?"true":"false",
                "aria-label":"Camera "+v.n+": "+v.role, title:"Camera "+v.n+": "+v.role+". Press to see it on top.", onClick:()=>setPick(p=>({ ...p, cam:i })) },
              thumbsNow && thumbsNow[v.key] ? LSC_E("img",{ src:thumbsNow[v.key], alt:"", draggable:false }) : LSC_E("span",{ className:"lsc-thumb-wait" }),
              LSC_E("span",{ className:"lsc-num" }, v.n)))),
          // what the space connects to, with its views (owner 2026-11-23: one section, not two)
          LSC_E("div",{ className:"lsc-sec lsc-connects", "data-testid":"set-card-connects" },
            LSC_E("h4",{ className:"lsc-lab" },"Connects to"),
            links.length ? LSC_E("ul",{ className:"lsc-links", "data-testid":"set-card-links" },
                links.map(x=>LSC_E("li",{ key:x.name }, LSC_E("span",null,x.name), LSC_E("span",{ className:"lsc-mono dim" }, x.kinds.join(", ")))))
              : LSC_E("p",{ className:"lsc-mono dim" }, drawn ? "No doors or windows on the plan yet." : "Shown once the place has a floor plan."))),

        // the description of the place, to read and to edit: the card's own section, first after the views
        S.place || null,

        LSC_E(LscFold,{ label:planFold.label || "Floor plan", foldId:planFold.foldId, count:planFold.count, defaultOpen:true, testid:"set-card-fold-plan" },
          model ? LSC_E(React.Fragment,null,
              LSC_E(LocationSetPlan,{ model, label:"Plan of "+(place.name||"this place")+(people ? ". Drag A and B to try where people stand; nothing is saved." : ""),
                onMove:people && !readOnly ? movePerson : null }),
              LSC_E("p",{ className:"lsc-mono dim", "data-testid":"set-card-people" },
                // a space that is not on the plan cannot be lit on it: said, with where to add it
                model.missing ? (space.name||"This space")+" is not on the floor plan yet, so it cannot be shown on it. Add it in Edit the floor plan, below."
                  : K.peopleLine(people, names)+(start && start.sceneNo!=null && (names.A || names.B) ? "   ·   marks of scene "+start.sceneNo : "")))
            : LSC_E("div",{ className:"lsc-noplan" },
                LSC_E("span",null,"No floor plan yet. The place is drawn to scale from its description and its scenes.")),
          // the plan's own tools (drafting it, checking it, its numbers, its moving parts): open until it is confirmed
          planTools && LSC_E("details",{ className:"loc-nested-section lsc-plan-tools", open:(!planReady || planOpen) ? true : undefined, "data-testid":"set-card-plan-tools" },
            LSC_E("summary",null, planReady ? "Edit the floor plan" : "Draft and confirm the floor plan"),
            planTools)),

        LSC_E(LscFold,{ label:"Reference pack", defaultOpen:true, testid:"set-card-fold-pack" },
          LSC_E("button",{ type:"button", className:"lsc-primary", "data-testid":"set-card-build", disabled:!view || cannot || packNow.busy, onClick:build },
            packNow.busy ? "Building the reference pack…" : "Build reference pack for "+space.chip+", camera "+(view?view.n:1)),
          packNow.error && LSC_E("p",{ className:"lsc-mono dim", role:"status" }, packNow.error),
          packNow.urls && LSC_E("div",{ className:"lsc-sec", "data-testid":"set-card-pack" },
            LSC_E("h4",{ className:"lsc-lab" },"1280 × 720"),
            LSC_E("div",{ className:"lsc-pack" },
              K.PACK.map((p,i)=>LSC_E("figure",{ key:p.id },
                LSC_E("img",{ src:packNow.urls[i], alt:p.name+": "+p.text, width:1280, height:720 }),
                LSC_E("figcaption",null, LSC_E("b",null,p.name+"."), " "+p.text)))),
            !readOnly && LSC_E("div",{ className:"lsc-row" },
              LSC_E("button",{ type:"button", className:"lsc-ghost", onClick:go(4),
                title:"Previs is where the location image is made from this set, in the card’s style." },"Make the location image in Previs")))),

        // the card's picture: the location image, with its menu, its versions and its edits, as before
        S.image && LSC_E(LscFold,{ label:"Location image", keep:true, defaultOpen:false, testid:"set-card-fold-image" }, S.image))));
}

Object.assign(window, { LocationSetCard, LocationSetPlan, LscFold, lscDraw, lscClose });

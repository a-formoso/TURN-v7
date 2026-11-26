/* beat-frames-ui.jsx — THE FRAME BOARD OF A BEAT (owner 2026-11-26, with their own board of Scene 06: "let's use this
   structure to breakdown each beat in a scene using code, treating each moment as a shot"; stage 1: "draw the frames
   in the app's own 3D and put your frame board on the beat card").
   One picture at a time: the beat's frames in order, each drawn in code on the place's own set. Under the picture:
   which moment and which frame it is (1.2.1 is beat 1, moment 2, frame 1), the shot's camera words, what is said or
   done, a square for every frame grouped by moment, Previous / Play frames / Next, and the time.
   A MOMENT IS A SHOT, and its first frame is that shot's starting frame: the first square of each moment is marked,
   and the board says so. Until a beat's frames are written out one by one (stage 2), a shot's frames are how it
   starts, midway when someone crosses the room, and how it ends: the drawings the beat already has
   (shot-previs-ui.jsx beatStripRows; KinolotBeatFrames.board shares each shot's seconds out among them).
   Nothing here makes an image or a charge, and nothing is saved: the pictures are drawn in the page. */
const BFB_E = React.createElement;
function BeatFrameBoard({ scene, L, bm, shots, sceneShots, ctx, onView, onOpen, readOnly=false }){
  const F = window.KinolotBeatFrames, K = window.KinolotBeatCard;
  const [look, setLook] = React.useState("");
  const [rows, setRows] = React.useState({});          // look → the beat's drawings
  const [err, setErr] = React.useState("");
  const [at, setAt] = React.useState(0);               // which frame is shown
  const [playing, setPlaying] = React.useState(false);
  const info = typeof window.beatStripInfo==="function" ? window.beatStripInfo(scene, shots, sceneShots, ctx) : null;
  const sig = info ? info.sig : "";
  /* THE FRAMES WRITTEN OUT FOR THIS BEAT (stage 2: scenePlans[scene].frames, one entry a shot). A shot's written frames
     are used while they still fit it (its start and its end are the ones they were written for: KinolotBeatFrames
     writtenFor); a shot without them keeps how it starts, midway and how it ends. */
  const SP = window.ScenePlan, saved = (info && info.plan && info.plan.frames) || null;
  // (a shot staged from its written frames keeps the plan's own start and end in `plain`: what the frames were written for)
  const writtenOf = sh=>{ if(!saved || !F || !SP) return null; const st0 = (info.staged||{})[sh.id] || {}, st = st0.plain || st0;
    return F.writtenFor(saved, SP.shotCameraKey(sh), st.start||sh.startState, st.end||sh.endState||sh.startState); };
  const wkey = (saved && info) ? (info.list.some(writtenOf) ? String(info.plan.framesAt||"")+"|"+info.list.map(sh=>writtenOf(sh)?"1":"0").join("") : "") : "";
  const written = wkey ? { key:wkey, of:sh=>{ const m = writtenOf(sh); return m ? m.frames.map(f=>f.state) : null; } } : null;
  const rowKey = lk=>sig+"|"+lk+"|"+wkey;
  React.useEffect(()=>{
    if(!sig || typeof window.beatStripRows!=="function") return undefined;
    let live = true; setErr("");
    window.beatStripRows(info, ctx, look, written).then(r=>{ if(live) setRows(o=>({ ...o, [rowKey(look)]:r||[] })); },
      e=>{ if(live) setErr((e && e.message) || "This beat could not be drawn."); });
    return ()=>{ live = false; };
  },[sig, look, wkey]);
  const colour = rows[rowKey("")] || null, mine = rows[rowKey(look)] || null;
  // the beat's shots as moments, each with the drawings it has (read from the colour drawings: every look has the same)
  const board = React.useMemo(()=>{
    if(!F || !K || !info || !colour) return null;
    return F.board(L.n, "", info.list.map((sh,i)=>{ const r = colour[i] || {}, steps = [];
      if(r.start) steps.push("start"); if(r.mid) steps.push("mid"); if(r.end) steps.push("end");
      const n = Number(String(K.number(sh)).split(".")[1]) || (i+1);
      const line = String(sh.dialogue||"").trim() || String(sh.action||"").trim() || String(sh.purpose||"").trim();
      const m = writtenOf(sh);
      return { n, name:(m && m.name) || K.name(sh), seconds:typeof window.shotDur==="function" ? window.shotDur(sh) : (Number(sh.dur)||4), says:line,
        cam:K.chips ? (K.chips(sh)||[]).slice(0,3).join(" · ") : "", shotId:sh.id, steps, ...(m && r.steps && r.steps.length===m.frames.length ? { written:m.frames } : {}) }; }));
  },[sig, !!colour, wkey]);
  const frames = board ? board.frames : [];
  const i = Math.min(at, Math.max(0, frames.length-1)), f = frames[i] || null;
  // Play frames: each frame stays up for its own time (the time it takes to reach it and the time it rests)
  React.useEffect(()=>{
    if(!playing || !f) return undefined;
    if(i>=frames.length-1){ const t = setTimeout(()=>setPlaying(false), Math.max(300,(f.t2-f.t0)*1000)); return ()=>clearTimeout(t); }
    const t = setTimeout(()=>setAt(i+1), Math.max(300,(f.t2-f.t0)*1000));
    return ()=>clearTimeout(t);
  },[playing, i, frames.length]);
  if(!F || !K) return null;
  const idx = f && info ? info.list.findIndex(sh=>sh.id===f.shotId) : -1;
  const pick = (set)=>{ const r = set && idx>=0 ? set[idx] : null; if(!r || !f) return "";
    return f.written ? ((r.steps && r.steps[f.step] && r.steps[f.step].dataUrl) || "") : ((r[f.step] && r[f.step].dataUrl) || ""); };
  const hasWritten = frames.some(x=>x.written);
  const [writing, setWriting] = React.useState(false);
  const canWrite = !readOnly && !!info && typeof window.turnWriteBeatFrames==="function";
  const write = async ()=>{ if(writing || !canWrite) return; setWriting(true); setPlaying(false);
    try{ await window.turnWriteBeatFrames(scene.id, L.n); setAt(0); }finally{ setWriting(false); } };
  const pic = pick(mine) || "", waiting = !!look && !pic && !!pick(colour);
  const shown = pic || pick(colour);
  const go = n=>{ setPlaying(false); setAt(Math.max(0, Math.min(frames.length-1, n))); };
  const play = ()=>{ if(!frames.length) return; if(playing){ setPlaying(false); return; } if(i>=frames.length-1) setAt(0); setPlaying(true); };
  const looks = (window.SHOT_PREVIS_LOOKS || [{ id:"", name:"Previs", title:"" }]);
  const moments = board ? board.moments : [];
  const secs = v=>(Math.round(v*10)/10).toFixed(1);
  return BFB_E("div",{ className:"bfb", "data-testid":"beat-frame-board", "data-beat":L.n },
    BFB_E("div",{ className:"bfb-stage" },
      shown ? BFB_E("img",{ src:shown, alt:f ? "Frame "+f.id+", drawn in code" : "", role:"button", tabIndex:0, title:"View larger", className:waiting ? "wait" : undefined,
          onClick:()=>onView && onView(shown,{ name:"Frame "+(f ? f.id : "") }),
          onKeyDown:e=>{ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); onView && onView(shown,{ name:"Frame "+(f ? f.id : "") }); } } })
        : BFB_E("div",{ className:"bfb-none", "data-testid":"beat-frame-board-none" },
            err ? BFB_E(React.Fragment,null,BFB_E("b",null,"This beat could not be drawn"),BFB_E("span",null,err))
              : !info ? BFB_E(React.Fragment,null,BFB_E("b",null,"No drawing yet"),BFB_E("span",null,"Plan this scene first (Scene plan, above): a beat is drawn from its plan."))
              : BFB_E("span",{ className:"shot-previs-wait", role:"status" },BFB_E("span",{ className:"ns-spin" }),"Drawing the beat…")),
      BFB_E("div",{ className:"lsc-seg bfb-looks", role:"group", "aria-label":"How the frame is drawn" },
        looks.map(x=>BFB_E("button",{ key:x.id||"colour", type:"button", "aria-pressed":x.id===look?"true":"false", title:x.title, onClick:()=>setLook(x.id) }, x.name))),
      waiting && BFB_E("span",{ className:"lsc-camtag bfb-wait", role:"status" },"Drawing…")),
    BFB_E("div",{ className:"bfb-side" },
      f ? BFB_E(React.Fragment,null,
        BFB_E("h4",{ className:"bfb-title", "data-testid":"beat-frame-board-title" },"Moment "+f.moment+" · "+f.momentName+" · frame "+f.id),
        BFB_E("p",{ className:"bfb-cam" },[f.stepWord, f.cam].filter(Boolean).join(" · ")),
        f.says && BFB_E("p",{ className:"bfb-says" }, f.says),
        // a moment is a shot: its first frame is the shot's starting frame
        BFB_E("p",{ className:"lsc-mono dim", "data-testid":"beat-frame-board-key" },
          f.first ? "This is the starting frame of shot "+f.beat+"."+f.moment+": its frame is made from this picture."
            : "A frame inside shot "+f.beat+"."+f.moment+". The shot’s frame is made from its first frame, "+f.beat+"."+f.moment+".1."))
        : null,
      frames.length>0 && BFB_E("div",{ className:"bfb-squares", role:"group", "aria-label":"The frames of beat "+L.n, "data-testid":"beat-frame-board-squares" },
        moments.map(m=>BFB_E("span",{ key:m.n, className:"bfb-moment" },
          BFB_E("span",{ className:"bfb-moment-n", title:"Moment "+m.n+": "+m.name+", "+secs(m.seconds)+" s" }, m.n),
          frames.map((x,k)=>x.moment===m.n ? BFB_E("button",{ key:x.id, type:"button", className:"bfb-square"+(x.first?" key":""), "aria-pressed":k===i?"true":"false",
            "aria-label":"Frame "+x.id+(x.first ? ", the starting frame of its shot" : ""), title:"Frame "+x.id+(x.stepWord ? ": "+x.stepWord.toLowerCase() : "")+(x.first ? " (the shot’s starting frame)" : ""), onClick:()=>go(k) }) : null)))),
      BFB_E("div",{ className:"bfb-acts" },
        BFB_E("button",{ type:"button", className:"sbc-btn", disabled:!frames.length || i<=0, "data-testid":"beat-frame-board-prev", onClick:()=>go(i-1) },"Previous"),
        BFB_E("button",{ type:"button", className:"sbc-btn primary", disabled:frames.length<2, "data-testid":"beat-frame-board-play", "aria-pressed":playing?"true":"false",
          title:"Show the frames one after another, each for its own time.", onClick:play }, playing ? "Stop" : "Play frames"),
        BFB_E("button",{ type:"button", className:"sbc-btn", disabled:!frames.length || i>=frames.length-1, "data-testid":"beat-frame-board-next", onClick:()=>go(i+1) },"Next"),
        f && onOpen && BFB_E("button",{ type:"button", className:"sbc-btn", "data-testid":"beat-frame-board-open", title:"Open this frame’s shot beside the beat.", onClick:()=>onOpen(f.shotId) },"Open shot "+f.beat+"."+f.moment),
        board && f && BFB_E("span",{ className:"bfb-time", "data-testid":"beat-frame-board-time" }, secs(f.t0)+" / "+secs(board.seconds)+" s")),
      // stage 2: the beat's frames written out one by one (a writing pass; it asks first)
      canWrite && BFB_E("div",{ className:"bfb-write" },
        BFB_E("button",{ type:"button", className:"sbc-btn", disabled:writing, "data-testid":"beat-frame-board-write", onClick:write,
          title:"One writing pass breaks each shot of this beat into its frames: the steps of the action, with each person’s place, pose and what is in their hands. It asks first. Writing credits." },
          writing ? "Writing the frames…" : hasWritten ? "Write the frames again" : "Write this beat’s frames"),
        BFB_E("span",{ className:"lsc-mono dim", "data-testid":"beat-frame-board-source" }, hasWritten
          ? "These frames were written for this beat"+(info && info.plan && info.plan.framesBy && info.plan.framesBy.label ? " by "+info.plan.framesBy.label : "")+"."
          : "For now each shot shows how it starts and how it ends. Write the frames to see the steps between."))));
}
Object.assign(window, { BeatFrameBoard });

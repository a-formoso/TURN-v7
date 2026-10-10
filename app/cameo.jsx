/* cameo.jsx — a character's LIKENESS (internal name "cameo"): a real face, captured with the
   webcam (or uploaded stills), locked to one character of one film. Every captured angle rides as
   a face reference on every generation of that character, so the face stays consistent across
   sheets and state variants. The store (app/imagegen.jsx, "LIKENESS") keeps the photos on this
   device unless the person syncs them, scoped to the film and the account.

   (2026-10-10, owner — Likeness review)
     • the capture window starts from the person's saved likeness (its angles, whose face it is,
       its consent and its sync setting) — a recapture never silently drops any of them;
     • consent: "Whose likeness is this?" — Me / Someone else (with their name), and the box
       "This is me and I'm 18 or over" / "I have their permission to use their likeness, and
       they're 18 or over"; each photo records whether it came from the webcam or an upload;
     • three static pose sketches (front, ¾ left, ¾ right) — line drawings, free, the same for
       everyone — are the empty slots and the faint ghost in the capture ring;
     • the Likenesses window: this film's likenesses (a teammate's photos only to the film's owner),
       this person's other films on this device, and the earlier ones not tied to a film;
     • window.cameoConsentGate({ purpose }) → Promise<boolean>: the same consent question before a
       photo of a real person is sent (it remembers nothing); window.cameoRevokeFlow(target, opts).

   Exports: CameoModal (capture) + CameoManager (the Likenesses window). */

/* The preview is MIRRORED (like a mirror), so "your left" always reads as the LEFT
   side of the frame — every direction cue states both to kill the ambiguity. */
const CAMEO_ANGLES = [
  { key:"front", label:"Front",   hint:"Look straight at the camera", say:"Look straight at the camera.", req:true  },
  { key:"left",  label:"¾ Left",  hint:"Turn toward your LEFT shoulder — face swings to the LEFT side of the frame",
    say:"Turn toward your left shoulder — your face should swing to the left side of the frame.", req:false },
  { key:"right", label:"¾ Right", hint:"Turn toward your RIGHT shoulder — face swings to the RIGHT side of the frame",
    say:"Turn toward your right shoulder — your face should swing to the right side of the frame.", req:false },
];
const CAMEO_KEYS = CAMEO_ANGLES.map(a=>a.key);

/* shared: square centre-crop a video frame or image to <=1024 jpeg data URL */
function cameoCropToDataUrl(src, sw, sh){
  const side = Math.min(sw, sh), out = Math.min(side, 1024);
  const cv = document.createElement("canvas"); cv.width=out; cv.height=out;
  const ctx = cv.getContext("2d");
  ctx.drawImage(src, (sw-side)/2, (sh-side)/2, side, side, 0, 0, out, out);
  return { url: cv.toDataURL("image/jpeg", 0.92), out };
}

/* ── pose sketches (decision H) ────────────────────────────────────────────
   Three neutral line drawings — front, ¾ left, ¾ right — drawn as the person SEES themselves in
   the mirrored preview (¾ Left: the face turned toward the left side of the frame). They are the
   empty-slot placeholders and the faint ghost in the capture ring. Static and free: nothing is
   generated, nothing is cached. */
const CAMEO_POSE_3Q = [
  ["e", { cx:51, cy:46, rx:21, ry:28 }],
  ["p", "M31 38 C33 22 42 16 52 16 C62 16 71 24 72 40"],
  ["g", "M42 19 Q33 46 41 74"],
  ["p", "M29 42 Q32 41 35 42"], ["p", "M41 41.5 Q46.5 39.5 52 42"],
  ["p", "M30 47 Q32.5 45.5 35 47"], ["p", "M42 47 Q47 44.5 52 47"],
  ["p", "M37 49 L31 58 Q33 60 36.5 58.5"],
  ["p", "M33 65 Q38 67.5 44 65"],
  ["p", "M66 43 Q72 49 66.5 56"],
  ["p", "M45 72 L45 84"], ["p", "M60 72 L60 84"],
  ["p", "M45 84 Q26 87 15 108"], ["p", "M60 84 Q78 87 87 108"],
];
const CAMEO_POSE = {
  front: [
    ["e", { cx:50, cy:46, rx:22, ry:28 }],
    ["p", "M29 40 C31 22 41 16 50 16 C59 16 69 22 71 40"],
    ["g", "M50 20 L50 72"], ["g", "M31 47 L69 47"],
    ["p", "M37 42 Q42 40 46 41.5"], ["p", "M54 41.5 Q58 40 63 42"],
    ["p", "M38 47 Q42 44.5 46 47"], ["p", "M54 47 Q58 44.5 62 47"],
    ["p", "M50 49 L48 58 Q50 60 52 58.5"],
    ["p", "M44 65 Q50 68.5 56 65"],
    ["p", "M28 44 Q24 49 28.5 55"], ["p", "M72 44 Q76 49 71.5 55"],
    ["p", "M42 72 L42 84"], ["p", "M58 72 L58 84"],
    ["p", "M42 84 Q24 87 14 108"], ["p", "M58 84 Q76 87 86 108"],
  ],
  left: CAMEO_POSE_3Q,
  right: CAMEO_POSE_3Q,   // the ¾ left drawing, mirrored
};
function CameoPoseSketch({ angle, className }){
  const key = CAMEO_POSE[angle] ? angle : "front";
  const parts = CAMEO_POSE[key].map(([kind, d], i)=>
    kind==="e" ? React.createElement("ellipse",{ key:i, ...d })
    : React.createElement("path",{ key:i, d, ...(kind==="g" ? { strokeDasharray:"2 3", strokeWidth:1, opacity:0.55 } : {}) }));
  return React.createElement("svg",{ className:"cameo-pose "+(className||""), viewBox:"0 0 100 120", fill:"none", stroke:"currentColor",
    strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":"true", "data-pose":key },
    key==="right" ? React.createElement("g",{ transform:"translate(100 0) scale(-1 1)" }, parts) : parts);
}
/* the generated pencil sketches the old capture window cached here (made with a personal key)
   aren't used any more: free the space they took (a cache, not anyone's data) */
try{
  const stale = [];
  for(let i=0; i<localStorage.length; i++){ const k = localStorage.key(i)||""; if(k.indexOf("cameo_guide_v")===0) stale.push(k); }
  stale.forEach(k=>localStorage.removeItem(k));
}catch(e){}

/* infer the character's presented gender from their text (pronouns / gendered nouns). Not used
   by the capture window any more (the pose sketches are neutral); app/ai.jsx reads it. */
function cameoInferGender(c){
  if(!c) return "neutral";
  const blob = [c.role,c.identity,c.conscious,c.unconscious,c.arc,c.coreBody,
    c.physique&&Object.values(c.physique).join(" "),c.wardrobeMask,c.wardrobeInner]
    .filter(Boolean).join(" ").toLowerCase();
  const m = (blob.match(/\b(he|him|his|man|men|male|boy|gentleman|father|husband|brother|son|mr|sir|king|actor|widower)\b/g)||[]).length;
  const f = (blob.match(/\b(she|her|hers|woman|women|female|girl|lady|mother|wife|sister|daughter|mrs|ms|miss|queen|actress|widow)\b/g)||[]).length;
  if(m>f && m>0) return "male";
  if(f>m && f>0) return "female";
  return "neutral";
}

/* ── consent (decision D) ──────────────────────────────────────────────────
   The wording is versioned in the store (CAMEO_CONSENT_TEXT_VERSION, "2026-10-10"); the record
   is { subject:"self"|"other", name, adult:true, textVersion, at, by }. */
const CAMEO_CONSENT_SELF = "This is me and I'm 18 or over";
const CAMEO_CONSENT_OTHER = "I have their permission to use their likeness, and they're 18 or over";
function cameoConsentValid(v){
  return !!(v && v.agreed===true && (v.subject==="self" || (v.subject==="other" && String(v.name||"").trim())));
}
/* the capture window's starting answer from a saved likeness: ticked only for a consent given
   with today's wording */
function cameoConsentFromRecord(rec){
  const c = rec && rec.consent;
  if(c && typeof c==="object" && (c.subject==="self" || c.subject==="other")){
    const name = c.subject==="other" ? String(c.name||"") : "";
    const current = c.adult===true && c.textVersion===(window.CAMEO_CONSENT_TEXT_VERSION||"2026-10-10") && (c.subject==="self" || !!name.trim());
    return { subject:c.subject, name, agreed:!!current };
  }
  return { subject:"", name:"", agreed:false };
}
function CameoConsentFields({ value, onChange, hideQuestion }){
  const v = value || {};
  const set = (patch)=>{ if(onChange) onChange({ ...v, ...patch }); };
  // a different answer reads a different sentence: the box is ticked again for it
  const pick = (subject)=> set({ subject, agreed: subject===v.subject ? !!v.agreed : false });
  return React.createElement("div",{ className:"cameo-whose" },
    !hideQuestion && React.createElement("div",{ className:"cameo-whose-q", id:"cameo-whose-q" },"Whose likeness is this?"),
    React.createElement("div",{ className:"cameo-whose-opts", role:"radiogroup", "aria-label":"Whose likeness is this?" },
      [["self","Me"],["other","Someone else"]].map(([s,label])=>React.createElement("button",{ key:s, type:"button", role:"radio",
        "aria-checked":v.subject===s?"true":"false", "data-subject":s, className:"cameo-whose-opt"+(v.subject===s?" on":""),
        onClick:()=>pick(s) }, label))),
    v.subject==="other" && React.createElement("input",{ className:"cameo-subject", type:"text", value:v.name||"", maxLength:80,
      "data-role":"consent-name", "aria-label":"Their name", placeholder:"Their name (required)",
      onChange:(e)=>set({ name:e.target.value }) }),
    v.subject && React.createElement("label",{ className:"cameo-check" },
      React.createElement("input",{ type:"checkbox", checked:!!v.agreed, "data-role":"consent-box",
        onChange:(e)=>set({ agreed:e.target.checked }) }),
      React.createElement("span",null, v.subject==="other" ? CAMEO_CONSENT_OTHER : CAMEO_CONSENT_SELF)));
}

/* a small dialog of its own (above whatever window is open); resolves with what it's closed with */
function _cameoShowDialog(render){
  return new Promise((resolve)=>{
    const RD = window.ReactDOM;
    if(!RD || typeof RD.createRoot!=="function" || typeof document==="undefined" || !document.body){ resolve(null); return; }
    const host = document.createElement("div");
    host.className = "cameo-dialog-host";
    document.body.appendChild(host);
    const root = RD.createRoot(host);
    let settled = false;
    const done = (v)=>{
      if(settled) return; settled = true;
      try{ root.unmount(); }catch(e){}
      try{ if(host.parentNode) host.parentNode.removeChild(host); }catch(e){}
      resolve(v===undefined ? null : v);
    };
    root.render(render(done));
  });
}
function useCameoEscape(onEscape){
  React.useEffect(()=>{
    const onKey = (e)=>{ if(e.key==="Escape"){ e.preventDefault(); if(e.stopPropagation) e.stopPropagation(); onEscape(); } };
    window.addEventListener("keydown", onKey, true);
    return ()=> window.removeEventListener("keydown", onKey, true);
  },[]);
}
/* the line under the question: a caller names its purpose with a key (or passes its own sentence) */
const CAMEO_CONSENT_PURPOSES = {
  "reference":"This photo shows a real person. Say whose face it is before it's used to make this image.",
  "reference-photo":"This photo shows a real person. Say whose face it is before it's used to make this image.",
  "edit":"This photo shows a real person. Say whose face it is before it's used in this edit.",
  "motion-control-face":"This picture shows a real person's face. Say whose it is before it's sent for the motion video.",
  "motion-control-body":"This video shows a real person. Say who it is before it's sent for the motion video.",
  "sync":"Before this likeness is synced to the cloud, say whose it is.",
};
function cameoConsentPurposeText(purpose){
  const p = String(purpose||"").trim();
  if(CAMEO_CONSENT_PURPOSES[p]) return CAMEO_CONSENT_PURPOSES[p];
  if(/\s/.test(p)) return p;   // a sentence of the caller's own
  return "This shows a real person. Say who it is before it's used to make an image.";
}
function CameoConsentDialog({ purpose, initial, done }){
  const [v, setV] = React.useState(()=>({ subject:"", name:"", agreed:false, ...(initial||{}) }));
  useCameoEscape(()=>done(null));
  const ok = cameoConsentValid(v);
  return React.createElement("div",{ className:"cameo-overlay", onClick:()=>done(null) },
    React.createElement("div",{ className:"cameo-modal cameo-gate", role:"dialog", "aria-modal":"true", "aria-label":"Whose likeness is this?",
      onClick:(e)=>e.stopPropagation() },
      React.createElement("div",{ className:"cameo-head" },
        React.createElement("div",null,
          React.createElement("div",{ className:"cameo-title" }, React.createElement(Icon.userScan,{ s:16 }), " Whose likeness is this?"),
          React.createElement("div",{ className:"cameo-sub" }, cameoConsentPurposeText(purpose))),
        React.createElement("button",{ className:"cameo-x", onClick:()=>done(null), "aria-label":"Close" }, React.createElement(Icon.x,{ s:16 }))),
      React.createElement("div",{ className:"cameo-consent" }, React.createElement(CameoConsentFields,{ value:v, onChange:setV, hideQuestion:true })),
      React.createElement("div",{ className:"cameo-acts" },
        React.createElement("button",{ className:"cameo-btn ghost", "data-role":"cancel", onClick:()=>done(null) }, "Cancel"),
        React.createElement("button",{ className:"cameo-btn primary", "data-role":"continue", disabled:!ok,
          title:ok ? "" : "Say whose likeness this is and tick the box", onClick:()=>{ if(ok) done(v); } }, "Continue"))));
}
/* the consent question on its own: { subject, name, adult:true } or null (cancelled). opts.purpose:
   a key ("reference", "reference-photo", "edit", "motion-control-face", "motion-control-body",
   "sync") or a sentence of the caller's own, shown under the question; opts.initial pre-fills it.
   Nothing is remembered. */
function cameoConsentAsk(opts){
  opts = opts || {};
  return _cameoShowDialog((done)=>React.createElement(CameoConsentDialog,{ purpose:opts.purpose, initial:opts.initial,
    done:(v)=>done(cameoConsentValid(v) ? { subject:v.subject, name:v.subject==="other" ? String(v.name).trim() : "", adult:true } : null) }));
}
/* before a photo of a real person is sent (an Art Room reference drop, a Motion Control face):
   true once the person answered "Whose likeness is this?" and ticked the box; false if cancelled */
async function cameoConsentGate(opts){ return !!(await cameoConsentAsk({ purpose:opts && opts.purpose })); }
window.cameoConsentAsk = cameoConsentAsk;
window.cameoConsentGate = cameoConsentGate;
window.cameoConsentValid = cameoConsentValid;

function CameoModal({ character, onClose, onSaved }){
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const [phase, setPhase] = React.useState("live");     // live | denied | nocam
  const [shots, setShots] = React.useState({});          // {front,left,right} -> dataURL
  const [sources, setSources] = React.useState({});      // {front,left,right} -> "webcam" | "upload"
  const [activeIdx, setActiveIdx] = React.useState(0);   // which angle the camera targets
  const [dims, setDims] = React.useState({w:0,h:0});
  const [consentV, setConsentV] = React.useState({ subject:"", name:"", agreed:false });
  const [sync, setSync] = React.useState(false);
  const [wasSynced, setWasSynced] = React.useState(false);
  const [teamNote, setTeamNote] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState("");
  const consentTouchedRef = React.useRef(false);

  const cloudReady = (typeof nbBackend==="function" && nbBackend()==="cloud");
  const activeAngle = CAMEO_ANGLES[activeIdx] || CAMEO_ANGLES[0];
  const hasFront = !!shots.front;
  const shotCount = Object.values(shots).filter(Boolean).length;
  const consentOk = cameoConsentValid(consentV);
  const onConsent = (v)=>{ consentTouchedRef.current = true; setConsentV(v); };

  /* RECAPTURE STARTS FROM THE SAVED LIKENESS (finding 6): its angles, whose face it is, its
     consent and its sync setting — so locking again never drops a cloud copy or a note by accident.
     Anything captured in this session before it arrives wins. */
  React.useEffect(()=>{
    let alive = true;
    (async()=>{
      let mine = null;
      try{ mine = (typeof window.nbLoadMyCameo==="function") ? await window.nbLoadMyCameo(character.id) : null; }catch(e){}
      if(!alive) return;
      const info = (typeof window.nbCameoInfo==="function") ? window.nbCameoInfo(character.id) : null;
      if(info && info.locked && !info.mine) setTeamNote(true);
      if(!mine) return;
      const s = {}, src = {};
      for(const a of (mine.angles||[])) if(a && a.url && CAMEO_KEYS.indexOf(a.key)>=0){ s[a.key] = a.url; src[a.key] = a.source==="upload" ? "upload" : "webcam"; }
      const next = { ...s, ...(shotsRef.current||{}) };
      setShots(next); setActiveIdx(firstEmptyOf(next));
      setSources(cur=>({ ...src, ...cur }));
      if(!consentTouchedRef.current) setConsentV(cameoConsentFromRecord(mine));
      setSync(!!mine.sync); setWasSynced(!!mine.sync);
      if(mine.w) setDims({ w:mine.w, h:mine.h||mine.w });
    })();
    return ()=>{ alive = false; };
  },[character && character.id]);

  /* auto-capture engine state */
  const [auto, setAuto] = React.useState(true);
  const [det, setDet] = React.useState({ face:false, bright:true, still:false, prog:0, size:null, pose:null, same:null, secs:null });

  /* ── spoken feedback (Web Speech, local, no API) — the user is posing, not reading:
     key moments are announced aloud: shot-is-good ("hold still"), each capture + the
     next pose to strike, the same-pose warning, and all-angles-done. Toggleable. ── */
  const [voiceOn, setVoiceOn] = React.useState(()=>{ try{ return localStorage.getItem("turn_cameo_voice")!=="0"; }catch(e){ return true; } });
  const voiceOnRef = React.useRef(voiceOn); voiceOnRef.current = voiceOn;
  const toggleVoice = ()=>setVoiceOn(v=>{ const n=!v; try{ localStorage.setItem("turn_cameo_voice", n?"1":"0"); }catch(e){} if(!n){ try{ window.speechSynthesis&&window.speechSynthesis.cancel(); }catch(e){} } return n; });
  const lastSpeakRef = React.useRef({ msg:"", at:0 });
  const speak = React.useCallback((msg, force)=>{
    try{
      if(!voiceOnRef.current || !window.speechSynthesis || !msg) return;
      const now = Date.now(), last = lastSpeakRef.current;
      if(!force && (msg===last.msg || now-last.at < 2200)) return;   // no chatter
      lastSpeakRef.current = { msg, at:now };
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = 1.05; u.volume = 0.9;
      window.speechSynthesis.speak(u);
    }catch(e){}
  },[]);
  React.useEffect(()=>()=>{ try{ window.speechSynthesis&&window.speechSynthesis.cancel(); }catch(e){} },[]);
  const [flash, setFlash] = React.useState(false);
  const activeIdxRef = React.useRef(activeIdx); activeIdxRef.current = activeIdx;
  const shotsRef = React.useRef(shots); shotsRef.current = shots;
  const autoRef = React.useRef(auto); autoRef.current = auto;
  const analyRef = React.useRef(null);
  const faceAnalyRef = React.useRef(null);    // face-box-only sample canvas
  const prevLumaRef = React.useRef(null);
  const sigRef = React.useRef({});            // key -> 64px luma signature at capture time —
                                              // blocks auto-capturing the SAME pose into two angles
  const steadyRef = React.useRef(0);
  const busyRef = React.useRef(false);
  const faceDetRef = React.useRef(undefined);   // FaceDetector instance | null
  const faceOkRef = React.useRef(null);         // last detector verdict
  const faceBoxRef = React.useRef(null);        // last detector bounding box (video px)
  const detectingRef = React.useRef(false);

  const stopStream = ()=>{ try{ (streamRef.current&&streamRef.current.getTracks()||[]).forEach(t=>t.stop()); }catch(e){} streamRef.current=null; };
  const startCam = React.useCallback(async ()=>{
    setErr("");
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ setPhase("nocam"); return; }
    try{
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:"user", width:{ideal:1280}, height:{ideal:1280} }, audio:false });
      streamRef.current = stream; setPhase("live");
      requestAnimationFrame(()=>{ if(videoRef.current){ videoRef.current.srcObject=stream; videoRef.current.play().catch(()=>{}); } });
    }catch(e){ setPhase((e && (e.name==="NotAllowedError"||e.name==="SecurityError")) ? "denied" : "nocam"); }
  },[]);
  React.useEffect(()=>{ startCam(); return stopStream; },[startCam]);

  function firstEmptyOf(next){ for(let i=0;i<CAMEO_ANGLES.length;i++){ if(!next[CAMEO_ANGLES[i].key]) return i; } return activeIdxRef.current||0; }
  const nextEmpty = (next)=> firstEmptyOf(next);

  /* commit a frame for a specific angle, flash, then advance to the next empty */
  const doCapture = (key)=>{
    const v = videoRef.current; if(!v || !v.videoWidth || busyRef.current) return;
    const { url, out } = cameoCropToDataUrl(v, v.videoWidth, v.videoHeight);
    const next = { ...shotsRef.current, [key]:url };
    // remember what this angle LOOKED like (latest 64px luma sample) so another angle
    // can't auto-capture the same pose
    if(prevLumaRef.current) sigRef.current[key] = Float32Array.from(prevLumaRef.current);
    busyRef.current = true; steadyRef.current = 0; prevLumaRef.current = null;
    setFlash(true); setShots(next); setSources(s=>({ ...s, [key]:"webcam" })); setDims({w:out,h:out});
    // announce the capture + the next pose to strike (or that the set is complete)
    const nextAngle = CAMEO_ANGLES.find(a=>!next[a.key]);
    speak(nextAngle
      ? ("Captured. Next: "+nextAngle.label.replace("¾","three-quarter")+". "+(nextAngle.say||""))
      : "Captured. All angles done — say whose likeness it is, tick the box and lock it.", true);
    setTimeout(()=>{ setFlash(false); busyRef.current = false; setActiveIdx(nextEmpty(next)); }, 280);
  };
  const captureNow = ()=> doCapture(CAMEO_ANGLES[activeIdxRef.current].key);

  /* ── auto-capture loop ───────────────────────────────────────────────────
     Samples the webcam ~5×/s into a 64px canvas and scores the framed centre:
       • bright  — mean luma in a usable band (not too dark / blown out)
       • still   — low frame-to-frame motion (subject holding the pose)
       • face    — a subject is present (FaceDetector when available, else a
                   centre-detail/variance heuristic that fires on a face)
     When all three hold for ~1s it auto-captures and advances. Fail-open: if
     the FaceDetector API is missing or errors, the heuristic carries it. */
  React.useEffect(()=>{
    if(phase!=="live") return;
    if(faceDetRef.current===undefined){
      try{ faceDetRef.current = ("FaceDetector" in window) ? new window.FaceDetector({ fastMode:true, maxDetectedFaces:1 }) : null; }
      catch(e){ faceDetRef.current = null; }
    }
    let raf=0, stopped=false, last=0, detClock=0;
    const SAMPLE=180, NEED=5, N=64;
    const loop = (t)=>{
      if(stopped) return;
      raf = requestAnimationFrame(loop);
      if(t-last < SAMPLE) return; last=t;
      const v = videoRef.current; if(!v || !v.videoWidth) return;
      const key = CAMEO_ANGLES[activeIdxRef.current].key;
      if(busyRef.current || !autoRef.current || shotsRef.current[key]){
        if(steadyRef.current!==0){ steadyRef.current=0; setDet(d=>({...d,prog:0})); }
        return;
      }
      const cv = analyRef.current || (analyRef.current=document.createElement("canvas"));
      cv.width=N; cv.height=N;
      const ctx = cv.getContext("2d",{willReadFrequently:true});
      const side = Math.min(v.videoWidth, v.videoHeight);
      ctx.drawImage(v,(v.videoWidth-side)/2,(v.videoHeight-side)/2,side,side,0,0,N,N);
      const img = ctx.getImageData(0,0,N,N).data;
      const luma = new Float32Array(N*N);
      let sum=0;
      for(let i=0,p=0;i<img.length;i+=4,p++){ const l=0.299*img[i]+0.587*img[i+1]+0.114*img[i+2]; luma[p]=l; sum+=l; }
      const mean = sum/(N*N);
      /* centre-region detail split LEFT vs RIGHT half (in the unmirrored video
         frame). When the user turns their head, the cheek facing the camera shows
         MORE skin/detail than the receding side, so |lStd - rStd| spikes — and
         the sign of the imbalance tells us which way they're turned. */
      const lo=N*0.27, hi=N*0.73, mid=N*0.5;
      let lS=0,lS2=0,lN=0, rS=0,rS2=0,rN=0;
      for(let y=0;y<N;y++) for(let x=0;x<N;x++){
        if(y>=lo&&y<=hi){
          if(x>=lo&&x<mid){ const l=luma[y*N+x]; lS+=l; lS2+=l*l; lN++; }
          else if(x>=mid&&x<=hi){ const l=luma[y*N+x]; rS+=l; rS2+=l*l; rN++; }
        }
      }
      const lStd = lN ? Math.sqrt(Math.max(0, lS2/lN-(lS/lN)*(lS/lN))) : 0;
      const rStd = rN ? Math.sqrt(Math.max(0, rS2/rN-(rS/rN)*(rS/rN))) : 0;
      const cstd = (lStd+rStd)/2;
      const sym  = Math.min(lStd,rStd)/Math.max(lStd,rStd,1);
      /* motion vs previous sample */
      let motion=999; const prev=prevLumaRef.current;
      if(prev && prev.length===luma.length){ let d=0; for(let p=0;p<luma.length;p++) d+=Math.abs(luma[p]-prev[p]); motion=d/luma.length; }
      prevLumaRef.current = luma;
      const bright = mean>45 && mean<228;
      const still  = motion < 6.5;
      let face = cstd > 15;
      /* optional FaceDetector refinement (throttled, non-blocking, fail-open) */
      if(faceDetRef.current && t-detClock>500 && !detectingRef.current){
        detClock=t; detectingRef.current=true;
        faceDetRef.current.detect(v).then(f=>{ const ok=!!(f&&f.length);
          faceOkRef.current = f ? ok : null;
          faceBoxRef.current = ok ? (f[0].boundingBox||null) : null; })
          .catch(()=>{ faceOkRef.current=null; faceBoxRef.current=null; }).finally(()=>{ detectingRef.current=false; });
      }
      if(faceOkRef.current===true) face = true;
      /* positioning (only when the detector gives us a box): too far / too close
         / off-centre. Fail-open when there's no FaceDetector — the pose guide
         and the framing ring carry it instead. */
      let sizeState = null;
      const box = faceBoxRef.current;
      if(box && v.videoWidth && v.videoHeight){
        const sideF = Math.min(v.videoWidth, v.videoHeight);
        const frac = (box.width||0)/sideF;
        const cx = (box.x||0)+(box.width||0)/2, cy = (box.y||0)+(box.height||0)/2;
        const offX = Math.abs(cx - v.videoWidth/2)/sideF, offY = Math.abs(cy - v.videoHeight/2)/sideF;
        if(frac>0 && frac<0.30) sizeState = "far";
        else if(frac>0.92) sizeState = "close";
        else if(offX>0.20 || offY>0.20) sizeState = "offcenter";
      }
      /* pose match: measure left/right detail asymmetry INSIDE the face box only
         (whole-frame asymmetry was too noisy — background, hair on one side, side
         lighting all read as a "turn"). When the user turns their head, the cheek
         facing the camera shows noticeably more detail; the sign of the imbalance
         tells us which way. yawSignal > 0 = turned to their LEFT (image-left has
         more detail), < 0 = turned to their RIGHT. */
      let yawSignal = null;
      if(box && box.width>10 && box.height>10){
        const fx=Math.max(0,box.x), fy=Math.max(0,box.y);
        const fw=Math.min(v.videoWidth-fx, box.width), fh=Math.min(v.videoHeight-fy, box.height);
        if(fw>10 && fh>10){
          const fc = faceAnalyRef.current || (faceAnalyRef.current=document.createElement("canvas"));
          fc.width=32; fc.height=32;
          const fctx = fc.getContext("2d",{willReadFrequently:true});
          fctx.drawImage(v, fx, fy, fw, fh, 0, 0, 32, 32);
          const fd = fctx.getImageData(0,0,32,32).data;
          let flS=0,flS2=0,flN=0, frS=0,frS2=0,frN=0;
          for(let y=4;y<28;y++) for(let x=2;x<30;x++){
            const o=(y*32+x)*4; const l=0.299*fd[o]+0.587*fd[o+1]+0.114*fd[o+2];
            if(x<16){ flS+=l; flS2+=l*l; flN++; } else { frS+=l; frS2+=l*l; frN++; }
          }
          const flStd = flN?Math.sqrt(Math.max(0,flS2/flN-(flS/flN)*(flS/flN))):0;
          const frStd = frN?Math.sqrt(Math.max(0,frS2/frN-(frS/frN)*(frS/frN))):0;
          const mx = Math.max(flStd, frStd, 1);
          yawSignal = (flStd - frStd) / mx;     // -1 .. +1
        }
      }
      let poseState = null;
      let sizeState_ = sizeState;
      if(yawSignal !== null){
        if(key==="front"){       if(Math.abs(yawSignal) > 0.20) poseState = "front"; }
        else if(key==="left"){   if(yawSignal < 0.20)            poseState = "left"; }
        else if(key==="right"){  if(yawSignal > -0.20)           poseState = "right"; }
      }
      // Auto must PROGRESS through all three angles. FRONT insists on a forward-facing
      // pose (so it's actually frontal). The ¾ angles can't be verified reliably (the yaw
      // heuristic is noisy and FaceDetector is often absent), so pose there is ADVISORY,
      // not a hard block — otherwise Auto stalls forever after the first capture. Instead
      // the ¾ angles use a LONGER steady hold (~1.8s) so there's time to turn into the
      // pose the on-screen cue asks for; manual "Capture now" is always available too.
      const poseBlocks = (key==="front") && poseState==="front";
      /* SAME-POSE GUARD (hard block) — a ¾ angle must actually LOOK different from the
         other captured angles. Compares the live 64px luma against each captured angle's
         signature: if the candidate is nearly identical to the OPPOSITE ¾ (or to Front),
         the user hasn't turned — block auto-capture and say which way to turn. This is
         what stops one head turn being captured as BOTH ¾ Left and ¾ Right. */
      let sameAs = null;
      if(key!=="front"){
        const dist = (k)=>{ const s=sigRef.current[k];
          if(!s || s.length!==luma.length) return Infinity;
          let dd=0; for(let p=0;p<luma.length;p++) dd+=Math.abs(luma[p]-s[p]);
          return dd/luma.length; };
        const opp = key==="left" ? "right" : "left";
        if(dist(opp) < 11) sameAs = opp;
        else if(dist("front") < 9) sameAs = "front";
      }
      const need = (key==="front") ? NEED : NEED*2;
      const ready = bright && still && face && !sizeState_ && !poseBlocks && !sameAs;
      steadyRef.current = ready ? steadyRef.current+1 : 0;
      const prog = Math.min(1, steadyRef.current/need);
      // countdown to the shutter — shown in the cue so the user KNOWS the shot is good
      // and holds the pose instead of drifting out of it
      const secs = ready ? Math.max(1, Math.ceil(((need - steadyRef.current) * SAMPLE) / 1000)) : null;
      setDet({ face, bright, still, prog, size:sizeState, pose:poseState, same:sameAs, secs });
      if(steadyRef.current>=need) doCapture(key);
    };
    raf = requestAnimationFrame(loop);
    return ()=>{ stopped=true; cancelAnimationFrame(raf); };
  },[phase]);

  // upload lands in the ACTIVE slot (the one highlighted / labelled on the button), so a
  // profile photo goes to ¾ Left/Right when that slot is selected — not always Front.
  // After it lands, stay on that slot (don't jump back to an empty Front) so the user sees
  // their upload took, then picks the next angle themselves.
  const onPickFile = (e)=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const targetKey = CAMEO_ANGLES[activeIdxRef.current].key;
    const rd = new FileReader();
    rd.onload = ()=>{ const img=new Image(); img.onload=()=>{
      const { url, out } = cameoCropToDataUrl(img, img.width, img.height);
      setShots(s=>({ ...s, [targetKey]:url })); setSources(s=>({ ...s, [targetKey]:"upload" })); setDims({w:out,h:out});
    }; img.src = rd.result; };
    rd.readAsDataURL(f);
    e.target.value = "";
  };
  const clearShot = (key)=>{ const next={...shots}; delete next[key]; setShots(next);
    setSources(s=>{ const n={ ...s }; delete n[key]; return n; });
    delete sigRef.current[key];
    const idx=CAMEO_ANGLES.findIndex(a=>a.key===key); if(idx>=0) setActiveIdx(idx); };

  const save = async ()=>{
    if(!hasFront || !consentOk) return;
    setSaving(true); setErr("");
    try{
      const angles = CAMEO_ANGLES.filter(a=>shots[a.key]).map(a=>({ key:a.key, label:a.label, url:shots[a.key], source:sources[a.key]==="upload" ? "upload" : "webcam" }));
      const meta = await nbSetCameo(character.id, { angles,
        consent:{ subject:consentV.subject, name:consentV.subject==="other" ? String(consentV.name||"").trim() : "", adult:true },
        sync: !!(sync && cloudReady), w:dims.w, h:dims.h, charName:character.name||"" });
      // NOTE: locking does NOT overwrite the character's design sheet — it stores the
      // face-lock reference. The likeness is applied on the next "Regenerate sheet"
      // (the sheet's useImageGen carries cameoId and folds the angles in as face anchors).
      onSaved && onSaved({ angles, sync: !!(meta && meta.sync), meta });
      onClose && onClose();
    }catch(e){ setErr((e&&e.message)||"Couldn't save the likeness."); setSaving(false); }
  };

  const stop = (e)=>e.stopPropagation();
  const liveOk = phase==="live";
  /* live readiness cue for the active angle */
  const targetFilled = !!shots[activeAngle.key];
  let cue;
  if(targetFilled) cue = { k:"done", t:"Captured — pick another angle or lock the likeness" };
  else if(!auto)   cue = { k:"off",  t:"Auto-capture paused — use “Capture now”" };
  else if(!det.face)              cue = { k:"wait", t:"Match the sketch — center your "+activeAngle.label+" in the ring" };
  else if(det.size==="far")       cue = { k:"wait", t:"Move a little closer" };
  else if(det.size==="close")     cue = { k:"wait", t:"Move back a little" };
  else if(det.size==="offcenter") cue = { k:"wait", t:"Center your face in the ring" };
  else if(det.same==="front")     cue = { k:"wait", t:"You're still facing forward — turn toward your "+(activeAngle.key==="left"?"LEFT":"RIGHT")+" shoulder ("+(activeAngle.key==="left"?"left":"right")+" side of the frame)" };
  else if(det.same)               cue = { k:"wait", t:"Same pose as your ¾ "+(det.same==="left"?"Left":"Right")+" — turn toward the "+(activeAngle.key==="left"?"LEFT":"RIGHT")+" side of the frame" };
  else if(det.pose==="front")     cue = { k:"wait", t:"Face the camera straight on" };
  else if(det.pose==="left")      cue = { k:"wait", t:"Turn toward your LEFT shoulder — face to the LEFT side of the frame" };
  else if(det.pose==="right")     cue = { k:"wait", t:"Turn toward your RIGHT shoulder — face to the RIGHT side of the frame" };
  else if(!det.bright) cue = { k:"wait", t:"Find more even light" };
  else if(!det.still)  cue = { k:"wait", t:"Hold still…" };
  else cue = { k:"go", t:"Shot looks good — hold still… capturing"+(det.secs?(" in "+det.secs+"s"):"") };
  /* voice the two moments that matter while posing: "shot is good, hold still" and
     the same-pose correction (captures announce themselves from doCapture) */
  const spokenCue = cue.k==="go" ? "Shot looks good. Hold still."
    : det.same ? ("That's the same pose. Turn toward the "+(activeAngle.key==="left"?"left":"right")+" side of the frame.")
    : null;
  React.useEffect(()=>{ if(liveOk && !targetFilled && spokenCue) speak(spokenCue); }, [spokenCue, liveOk, targetFilled, speak]);

  return React.createElement("div",{className:"cameo-overlay",onClick:onClose},
    React.createElement("div",{className:"cameo-modal",onClick:stop},
      React.createElement("div",{className:"cameo-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"cameo-title"},
            React.createElement(Icon.userScan,{s:16})," Likeness · ",character.name),
          React.createElement("div",{className:"cameo-sub"},"Match the pose sketch for each angle — capture ",
            React.createElement("b",null,"Front"),", and optionally the two ¾ angles, to lock the likeness")),
        React.createElement("button",{className:"cameo-x",onClick:onClose,"aria-label":"Close"},
          React.createElement(Icon.x,{s:16}))),

      /* stage: live camera with the active angle's guide + hint, or fallbacks */
      React.createElement("div",{className:"cameo-stage"},
        liveOk && React.createElement(React.Fragment,null,
          React.createElement("video",{ref:videoRef,className:"cameo-video",playsInline:true,muted:true}),
          React.createElement("div",{className:"cameo-guide"+(cue.k==="go"?" go":"")}),
          !targetFilled && React.createElement(CameoPoseSketch,{ angle:activeAngle.key, className:"cameo-guide-ghost" }),
          flash && React.createElement("div",{className:"cameo-flash"}),
          React.createElement("div",{className:"cameo-anglebadge"},
            "Capturing: ",React.createElement("b",null,activeAngle.label),activeAngle.req?" · required":" · optional"),
          React.createElement("div",{className:"cameo-cue "+cue.k},
            React.createElement("span",{className:"cameo-cue-dot"}),
            React.createElement("span",null,cue.t)),
          !targetFilled && auto && React.createElement("div",{className:"cameo-prog"},
            React.createElement("div",{className:"cameo-prog-fill",style:{width:(Math.round(det.prog*100))+"%"}})),
          React.createElement("button",{className:"cameo-capnow",onClick:captureNow,
            title:"Capture this angle manually"},"Capture now")),
        phase==="denied" && React.createElement("div",{className:"cameo-msg"},
          React.createElement(Icon.warn,{s:26}),
          React.createElement("div",{className:"cameo-msg-t"},"Camera access blocked"),
          React.createElement("div",{className:"cameo-msg-s"},"Allow camera in your browser's address bar, or upload photos instead."),
          React.createElement("div",{className:"cameo-msg-acts"},
            // retry WITHOUT reopening the modal — after the user flips the permission,
            // this re-requests the stream and drops straight into live capture
            React.createElement("button",{className:"cameo-btn ghost",onClick:startCam},
              React.createElement(Icon.undo,{s:14}),"Try camera again"),
            React.createElement("button",{className:"cameo-btn ghost",onClick:()=>fileRef.current&&fileRef.current.click()},
              React.createElement(Icon.image,{s:14}),"Upload ",activeAngle.label))),
        phase==="nocam" && React.createElement("div",{className:"cameo-msg"},
          React.createElement(Icon.image,{s:26}),
          React.createElement("div",{className:"cameo-msg-t"},"No camera available"),
          React.createElement("div",{className:"cameo-msg-s"},"Upload clear, front-facing photos to use as the likeness."),
          React.createElement("button",{className:"cameo-btn ghost",onClick:()=>fileRef.current&&fileRef.current.click()},
            React.createElement(Icon.image,{s:14}),"Choose photo"))),

      /* angle strip — captured thumbnails / target slots (an empty slot shows its pose sketch) */
      React.createElement("div",{className:"cameo-strip"},
        CAMEO_ANGLES.map((a,i)=>{
          const filled = !!shots[a.key];
          return React.createElement("button",{key:a.key,"data-angle":a.key,
            className:"cameo-slot"+(filled?" filled":"")+(i===activeIdx&&liveOk?" active":""),
            onClick:()=>setActiveIdx(i),title:filled?("Recapture "+a.label):("Capture "+a.label)},
            filled
              ? React.createElement(React.Fragment,null,
                  React.createElement("img",{src:shots[a.key],alt:a.label}),
                  React.createElement("span",{className:"cameo-slot-x",onClick:(e)=>{ e.stopPropagation(); clearShot(a.key); }},
                    React.createElement(Icon.x,{s:10,sw:2.4})))
              : React.createElement(CameoPoseSketch,{ angle:a.key, className:"cameo-slot-guide" }),
            React.createElement("span",{className:"cameo-slot-lab"},a.label,a.req?React.createElement("i",null," *"):null));
        })),

      teamNote && React.createElement("div",{className:"cameo-team-note"},
        "A teammate's likeness is already used for this character. Locking your own uses yours in the images you make."),

      /* provenance + consent (once we have at least the Front shot) */
      hasFront && React.createElement("div",{className:"cameo-consent"},
        React.createElement(CameoConsentFields,{ value:consentV, onChange:onConsent }),
        React.createElement("label",{className:"cameo-check sync"+(cloudReady?"":" disabled")},
          React.createElement("input",{type:"checkbox","data-role":"sync",checked:sync && cloudReady,disabled:!cloudReady,
            onChange:e=>setSync(e.target.checked)}),
          React.createElement("span",null,
            React.createElement("b",null,"Sync this likeness to the cloud."),
            !cloudReady ? " Sign in to sync it — for now it stays on this device."
            : (wasSynced && !sync) ? " Unticking removes its cloud copy when you lock it."
            : React.createElement(React.Fragment,null," Off by default — the photos stay ",
                React.createElement("b",null,"on this device"),
                " unless you tick this. Synced, only you and the film's owner see the photos; its Art directors can make images with it."))),
        err && React.createElement("div",{className:"cameo-err"},err)),

      React.createElement("div",{className:"cameo-acts"},
        (liveOk || phase==="denied" || phase==="nocam") && React.createElement("button",
          {className:"cameo-btn ghost",onClick:()=>fileRef.current&&fileRef.current.click(),
           title:"Upload a photo into the "+activeAngle.label+" slot (click another slot above to change the target)"},
          React.createElement(Icon.image,{s:14}),"Upload ",activeAngle.label),
        liveOk && React.createElement("button",{className:"cameo-autopill"+(auto?" on":""),
          onClick:()=>setAuto(a=>!a),
          title:auto?"Auto-capture on — snaps when the shot looks good":"Auto-capture off — capture manually"},
          React.createElement(Icon.bolt,{s:14}),"Auto"),
        liveOk && React.createElement("button",{className:"cameo-autopill"+(voiceOn?" on":""),
          onClick:toggleVoice,
          title:voiceOn?"Spoken directions on — announces when the shot is good, each capture, and the next pose":"Spoken directions off"},
          React.createElement(Icon.mic,{s:14}),"Voice"),
        React.createElement("button",{className:"cameo-btn primary","data-role":"lock",onClick:save,disabled:!hasFront||!consentOk||saving,
          title:!hasFront?"Capture the Front angle first":(!consentOk?"Say whose likeness this is and tick the box":"")},
          saving ? React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin dark"}),"Saving…")
                 : React.createElement(React.Fragment,null,React.createElement(Icon.check,{s:16}),
                     "Lock likeness",shotCount>1?(" · "+shotCount+" angles"):"")) ),

      React.createElement("input",{ref:fileRef,type:"file",accept:"image/*",style:{display:"none"},onChange:onPickFile})));
}
window.CameoModal = CameoModal;

/* ── revoke (decision D): where the likeness lives, with the sheets made from it ───── */
function cameoSheetLabel(sheet, charId, stateLabel){
  const id = String(sheet && sheet.id || "");
  if(id===String(charId)) return "Master sheet";
  if(id==="charscale-"+charId) return "Scale sheet";
  const named = (typeof stateLabel==="function") ? stateLabel(id) : "";
  return named ? ("Appearance variant · "+named) : "Appearance variant";
}
function CameoRevokeDialog({ entry, name, stateLabel, done }){
  const [sheets, setSheets] = React.useState(null);   // null while looking
  const [clear, setClear] = React.useState(false);
  useCameoEscape(()=>done(null));
  React.useEffect(()=>{
    let alive = true;
    (async()=>{
      let s = [];
      try{ s = (typeof window.nbCameoSheets==="function") ? await window.nbCameoSheets(entry) : []; }catch(e){ s = []; }
      if(alive) setSheets(Array.isArray(s) ? s : []);
    })();
    return ()=>{ alive = false; };
  },[]);
  const teammate = entry.kind==="team" || entry.mine===false;
  const synced = teammate || !!(entry.meta && entry.meta.sync);
  const n = (sheets||[]).length;
  return React.createElement("div",{ className:"cameo-overlay", onClick:()=>done(null) },
    React.createElement("div",{ className:"cameo-modal cameo-revoke", role:"dialog", "aria-modal":"true", "aria-label":"Revoke this likeness?",
      onClick:(e)=>e.stopPropagation() },
      React.createElement("div",{ className:"cameo-head" },
        React.createElement("div",null,
          React.createElement("div",{ className:"cameo-title" }, React.createElement(Icon.userScan,{ s:16 }), " Revoke this likeness?"),
          React.createElement("div",{ className:"cameo-sub" }, name)),
        React.createElement("button",{ className:"cameo-x", onClick:()=>done(null), "aria-label":"Close" }, React.createElement(Icon.x,{ s:16 }))),
      React.createElement("div",{ className:"cameo-revoke-body" },
        React.createElement("p",null, teammate
          ? ("This removes a teammate's likeness of "+name+" from the cloud, for everyone on this film. New images of "+name+" won't use it.")
          : ("The likeness is deleted from this device"+(synced ? " and from the cloud" : "")+", and new images of "+name+" won't use this face.")),
        React.createElement("p",{ className:"cameo-revoke-note" }, "Sheets already made with this face keep it unless you clear them."),
        sheets===null
          ? React.createElement("p",{ className:"cameo-revoke-look" }, "Looking for sheets made with this face…")
          : n===0
            ? React.createElement("p",{ className:"cameo-revoke-look" }, "No sheet of "+name+" in its film was made with it.")
            : React.createElement(React.Fragment,null,
                React.createElement("label",{ className:"cameo-check" },
                  React.createElement("input",{ type:"checkbox", checked:clear, "data-role":"clear-sheets", onChange:(e)=>setClear(e.target.checked) }),
                  React.createElement("span",null, "Also clear "+(n===1 ? "this sheet" : "these "+n+" sheets")+" (their versions too)")),
                React.createElement("ul",{ className:"cameo-revoke-list" },
                  sheets.map((s,i)=>React.createElement("li",{ key:i }, cameoSheetLabel(s, entry.charId, stateLabel)))))),
      React.createElement("div",{ className:"cameo-acts" },
        React.createElement("button",{ className:"cameo-btn ghost", "data-role":"cancel", onClick:()=>done(null) }, "Cancel"),
        React.createElement("button",{ className:"cameo-btn danger", "data-role":"revoke",
          onClick:()=>done({ clear:!!(clear && n), sheets: (clear && sheets) ? sheets.slice() : [] }) }, "Revoke"))));
}
/* revoke a likeness where it lives — target: a character id (the likeness used for it in the open
   film) or an entry from nbListCameoEntries / nbListOtherCameos. opts: { name, stateLabel(sheetId) }.
   Offers to clear the character's sheets made with it (unticked by default). → Promise<boolean> */
async function cameoRevokeFlow(target, opts){
  opts = opts || {};
  const entry = (target && typeof target==="object") ? target
    : (typeof window.nbCameoEntryFor==="function" ? window.nbCameoEntryFor(target) : null);
  if(!entry) return false;
  const name = opts.name || (entry.meta && entry.meta.charName) || "this character";
  const choice = await _cameoShowDialog((done)=>React.createElement(CameoRevokeDialog,{ entry, name, stateLabel:opts.stateLabel, done }));
  if(!choice) return false;
  const toast = (m,k)=>{ try{ if(typeof window.appToast==="function") window.appToast(m,k); }catch(e){} };
  const r = (typeof window.nbRevokeCameo==="function") ? await window.nbRevokeCameo(entry) : { ok:false };
  if(!r || !r.ok){ toast((r && r.message) || "This likeness couldn't be revoked right now.", "error"); return false; }
  let cleared = 0, failed = 0;
  if(choice.clear){
    for(const s of choice.sheets){
      try{ const x = await window.nbCameoClearSheet(s); if(x && x.ok!==false) cleared++; else failed++; }catch(e){ failed++; }
    }
  }
  if(failed) toast("Likeness revoked. "+cleared+" of "+choice.sheets.length+" sheets were cleared — clear the rest on their cards.", "error");
  else toast("Likeness revoked"+(cleared ? (" and "+cleared+" sheet"+(cleared!==1?"s":"")+" cleared") : "")+".", "success");
  return true;
}
window.cameoRevokeFlow = cameoRevokeFlow;

/* CameoManager — the Likenesses window (the Art Room's Characters header). nameOf(id) maps a
   character id → its name; characters (optional) lists the cast, for placing an earlier likeness. */
function CameoManager({ nameOf, onClose, onChanged, characters }){
  const [, setTick] = React.useState(0);
  const [thumbs, setThumbs] = React.useState({});
  const [busy, setBusy] = React.useState("");
  const [target, setTarget] = React.useState({});      // earlier id -> the character it's placed on
  React.useEffect(()=>{
    const on = ()=>setTick(t=>t+1);
    window.addEventListener("turn-cameo-changed", on);
    return ()=> window.removeEventListener("turn-cameo-changed", on);
  },[]);
  const changed = ()=>{ setTick(t=>t+1); if(onChanged) onChanged(); };
  const call = (fn, ...a)=> (typeof window[fn]==="function") ? window[fn](...a) : null;
  const film = call("nbListCameoEntries") || [];
  const other = call("nbListOtherCameos") || [];
  const earlier = call("nbListEarlierCameos") || [];
  const me = call("nbCameoAccount") || "local";
  const cloudReady = (typeof nbBackend==="function" && nbBackend()==="cloud");
  const keyOf = (e)=> e.kind==="earlier" ? "earlier|"+e.id : e.key;
  // a teammate's PHOTOS are shown only to the film's owner (the person who captured them sees their own)
  const canSee = (e)=> e.kind==="earlier" || e.mine || (me!=="local" && call("nbCameoFilmOwner", e.scope)===me);
  const all = [...film, ...other, ...earlier];
  const sig = all.map(e=>keyOf(e)+":"+String((e.meta && e.meta.capturedAt) || e.capturedAt || "")+":"+(e.available===false?0:1)).join(",");
  React.useEffect(()=>{
    let alive = true;
    (async()=>{
      const out = {};
      for(const e of all){
        if(!canSee(e)) continue;
        try{
          const r = e.kind==="earlier" ? await call("nbLoadEarlierCameo", e.id) : await call("nbLoadCameoEntry", e);
          out[keyOf(e)] = r ? (r.angles||[]).filter(a=>/^data:image\//i.test(String(a.url||""))).map(a=>({ label:a.label, url:a.url })) : [];
        }catch(err){}
      }
      if(alive) setThumbs(out);
    })();
    return ()=>{ alive = false; };
  },[sig]);

  const nameFor = (e)=>{
    const id = e.charId || e.id;
    const n = nameOf ? nameOf(id) : "";
    return (n && n!==id) ? n : ((e.meta && e.meta.charName) || id);
  };
  const inThisFilm = (id)=> !!(nameOf && nameOf(id) && nameOf(id)!==id) || (characters||[]).some(c=>c && c.id===id);
  const toast = (m,k)=>{ try{ if(typeof window.appToast==="function") window.appToast(m,k); }catch(e){} };
  const run = async (key, fn)=>{ if(busy) return; setBusy(key); try{ await fn(); }finally{ setBusy(""); changed(); } };
  const doSync = (e, on)=> run(keyOf(e), async ()=>{
    let opts;
    if(on && call("nbCameoNeedsConsent", e)){
      const c = await cameoConsentAsk({ purpose:"sync" });
      if(!c) return;
      opts = { consent:c };
    }
    await call("nbSyncCameo", e, on, opts);   // a failure says so itself (a toast)
  });
  const doRevoke = (e)=> run(keyOf(e), ()=>cameoRevokeFlow(e, { name:nameFor(e) }));
  const doAdopt = (e)=> run(keyOf(e), async ()=>{
    const id = target[e.id] || (inThisFilm(e.id) ? e.id : "");
    if(!id) return;
    const r = await call("nbAdoptEarlierCameo", e.id, id);
    if(r && r.ok) toast("Now used for "+((nameOf && nameOf(id)) || id)+" in this film.", "success");
    else toast((r && r.message) || "That earlier likeness couldn't be used.", "error");
  });
  const doDeleteEarlier = (e)=> run(keyOf(e), async ()=>{
    const ok = !window.appConfirm || await window.appConfirm({ title:"Delete this earlier likeness?",
      body:"Its photos are deleted from this device. This can't be undone.", confirmLabel:"Delete", danger:true });
    if(ok) await call("nbDeleteEarlierCameo", e.id);
  });

  const perChar = {};
  film.forEach(e=>{ perChar[e.charId] = (perChar[e.charId]||0)+1; });
  const stop = (e)=>e.stopPropagation();
  const row = (e, section)=>{
    const m = e.kind==="earlier" ? e : (e.meta || {});
    const angles = thumbs[keyOf(e)] || [];
    const n = m.angleCount || angles.length || 1;
    const prov = [m.subject ? ("“"+m.subject+"”") : "", n+" angle"+(n!==1?"s":""), m.source || "webcam",
      (m.date ? "captured "+m.date : "")].filter(Boolean).join(" · ");
    const pill = e.kind==="earlier" ? ["local","On this device · not tied to a film"]
      : !e.mine ? ["cloud","A teammate's · synced"]
      : m.sync ? ["cloud","Synced to the cloud"] : ["local","On this device only"];
    const isOwner = me!=="local" && call("nbCameoFilmOwner", e.scope)===me;
    const k = keyOf(e), working = busy===k;
    return React.createElement("div",{ key:k, className:"cameo-mgr-row"+(e.available===false?" off":""), "data-key":k },
      React.createElement("div",{ className:"cameo-mgr-thumbs" },
        angles.length ? angles.slice(0,3).map((a,i)=>React.createElement("img",{ key:i, src:a.url, alt:a.label, title:a.label }))
        : React.createElement("div",{ className:"cameo-mgr-noimg", title:canSee(e) ? "" : "Only the film's owner and the person who captured it see the photos" },
            React.createElement(Icon.userScan,{ s:16 }))),
      React.createElement("div",{ className:"cameo-mgr-meta" },
        React.createElement("div",{ className:"cameo-mgr-name" }, nameFor(e),
          section==="other" ? React.createElement("span",{ className:"cameo-mgr-film" }," · another film") : null),
        React.createElement("div",{ className:"cameo-mgr-prov" }, prov),
        React.createElement("div",{ className:"cameo-mgr-store" },
          React.createElement("span",{ className:"cameo-store-pill "+pill[0] },
            React.createElement(Icon[pill[0]==="cloud"?"globe":"check"],{ s:10, sw:2 }), pill[1]),
          (section==="film" && e.inUse && perChar[e.charId]>1) ? React.createElement("span",{ className:"cameo-store-pill use" },"Used for your images") : null),
        e.available===false && e.why ? React.createElement("div",{ className:"cameo-mgr-why" }, e.why) : null),
      React.createElement("div",{ className:"cameo-mgr-acts" },
        e.kind==="earlier"
          ? React.createElement(React.Fragment,null,
              (characters && characters.length) ? React.createElement("select",{ className:"cameo-mgr-select", "aria-label":"Character",
                  value:target[e.id] || (inThisFilm(e.id) ? e.id : ""), onChange:(ev)=>setTarget(t=>({ ...t, [e.id]:ev.target.value })) },
                React.createElement("option",{ value:"" },"Choose a character…"),
                characters.map(c=>React.createElement("option",{ key:c.id, value:c.id }, c.name||c.id))) : null,
              (target[e.id] || inThisFilm(e.id)) ? React.createElement("button",{ className:"cameo-mgr-btn", disabled:working, "data-role":"adopt",
                  onClick:()=>doAdopt(e) }, "Use for "+((nameOf && nameOf(target[e.id]||e.id)) || target[e.id] || e.id)+" in this film") : null,
              React.createElement("button",{ className:"cameo-mgr-btn danger", disabled:working, "data-role":"delete-earlier", onClick:()=>doDeleteEarlier(e) },"Delete"))
          : e.mine
            ? React.createElement(React.Fragment,null,
                cloudReady && e.available!==false && React.createElement("button",{ className:"cameo-mgr-btn", disabled:working, "data-role":"sync",
                  onClick:()=>doSync(e, !m.sync),
                  title:m.sync ? "Stop syncing — keep it on this device only" : "Sync to the cloud for your other devices (and, on a shared film, its owner and Art directors)" },
                  m.sync ? "Unsync" : "Sync"),
                React.createElement("button",{ className:"cameo-mgr-btn danger", disabled:working, "data-role":"revoke", onClick:()=>doRevoke(e) },"Revoke"))
            : (isOwner ? React.createElement("button",{ className:"cameo-mgr-btn danger", disabled:working, "data-role":"revoke", onClick:()=>doRevoke(e) },"Remove") : null)));
  };
  const count = film.length + other.length + earlier.length;
  const section = (title, list, kind)=> list.length ? React.createElement("div",{ className:"cameo-mgr-sec", key:kind },
    React.createElement("div",{ className:"cameo-mgr-sec-t" }, title), list.map(e=>row(e, kind))) : null;
  return React.createElement("div",{className:"cameo-overlay",onClick:onClose},
    React.createElement("div",{className:"cameo-modal mgr",onClick:stop},
      React.createElement("div",{className:"cameo-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"cameo-title"},React.createElement(Icon.userScan,{s:16})," Likenesses"),
          React.createElement("div",{className:"cameo-sub"},count+" locked likeness"+(count!==1?"es":"")+" · biometric data, kept privately")),
        React.createElement("button",{className:"cameo-x",onClick:onClose,"aria-label":"Close"},React.createElement(Icon.x,{s:16}))),
      React.createElement("div",{className:"cameo-mgr-body"},
        count===0
          ? React.createElement("div",{className:"cameo-mgr-empty"},
              React.createElement(Icon.userScan,{s:24}),
              React.createElement("div",null,"No likenesses yet. On any character card, click ",
                React.createElement("b",null,"Likeness")," to capture and lock a face."))
          : React.createElement(React.Fragment,null,
              section("This film", film, "film"),
              section("Your other films on this device", other, "other"),
              section("Earlier likenesses (not tied to a film)", earlier, "earlier")))));
}
window.CameoManager = CameoManager;

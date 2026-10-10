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

/* (2026-10-10, owner — "it can't tell left from right") ONE person's left everywhere: the slot key
   "left" is the head turned to the person's OWN left (as it always meant), and the preview is MIRRORED,
   so their left is the LEFT edge of the screen — every direction says both. The stored labels stay
   "Front" / "¾ Left" / "¾ Right" (label, what save() writes); the window SHOWS show / strip / long.
   The head's pose is checked ON THE DEVICE by app/face-pose.js (window.turnFacePose): a side photo is
   taken only when the head is turned the right way, far enough, and held for 5 s (Front: 3 s).
   (2026-10-10, owner — Likeness voice guidance) a CLEAN PICTURE: over the camera only the arrow, the turn meter,
   the pose sketch, the hold ring and the "Now: …" badge; every instruction is SPOKEN (recorded clips, the device's
   voice as the fallback), and shown as one line under the picture only when the voice is off or can't play.
   Capture now sits under the picture too, shown only when the photo doesn't take itself. */
const CAMEO_ANGLES = [
  { key:"front", label:"Front",   show:"Front",      strip:"Front",        long:"Front",                side:null,    req:true  },
  { key:"left",  label:"¾ Left",  show:"Your left",  strip:"← Your left",  long:"Turned to your left",  side:"left",  req:false },
  { key:"right", label:"¾ Right", show:"Your right", strip:"Your right →", long:"Turned to your right", side:"right", req:false },
];
const CAMEO_KEYS = CAMEO_ANGLES.map(a=>a.key);
/* a stored angle (its key, or a label an older version saved) → front | left | right */
function cameoAngleKey(a){
  const k = String((a && typeof a==="object") ? (a.key||"") : (a||"")).toLowerCase();
  if(CAMEO_KEYS.indexOf(k)>=0) return k;
  const l = String((a && typeof a==="object") ? (a.label||"") : (a||"")).toLowerCase();
  return /left/.test(l) ? "left" : /right/.test(l) ? "right" : "front";
}
/* how a saved angle reads outside the capture window (the Likenesses window, whose thumbnails are in
   true orientation — an own-left turn's nose points to the photo's right — so it says whose left) */
function cameoAngleShow(a){
  const k = cameoAngleKey(a);
  return k==="left" ? "Turned to their own left" : k==="right" ? "Turned to their own right" : "Front";
}

/* shared: square centre-crop a video frame or image to <=1024 jpeg data URL. flip: the camera already
   flips its picture (P2), so the photo is flipped back — saved photos are always in true orientation. */
function cameoCropToDataUrl(src, sw, sh, flip){
  const side = Math.min(sw, sh), out = Math.min(side, 1024);
  const cv = document.createElement("canvas"); cv.width=out; cv.height=out;
  const ctx = cv.getContext("2d");
  if(flip){ ctx.translate(out, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, (sw-side)/2, (sh-side)/2, side, side, 0, 0, out, out);
  return { url: cv.toDataURL("image/jpeg", 0.92), out, canvas: cv };
}
function cameoLoadImage(url){
  return new Promise((resolve, reject)=>{
    const im = new Image();
    im.onload = ()=>resolve(im); im.onerror = ()=>reject(new Error("image"));
    im.src = url;
  });
}
/* a photo flipped left-to-right (a Front taken before / after the camera setting changed) */
async function cameoFlipDataUrl(url){
  const im = await cameoLoadImage(url);
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.translate(w, 0); ctx.scale(-1, 1);
  ctx.drawImage(im, 0, 0, w, h);
  return cv.toDataURL("image/jpeg", 0.92);
}
/* the pose module, when it's on the page (a missing one behaves as "the pose check couldn't start") */
const cameoFP = ()=> (typeof window.turnFacePose==="object" && window.turnFacePose) ? window.turnFacePose : null;
const cameoPerfNow = ()=> (typeof performance!=="undefined" && performance && typeof performance.now==="function") ? performance.now() : Date.now();
/* (only the pose check and the live picture: the photos the person LOCKS are kept, and are sent as face
   references when this character's images are made) */
const CAMEO_NOTE_OK = "The pose check runs on this device — the camera picture isn't sent anywhere while you pose. Only the photos you lock are kept, as face references for this character's images.";
const CAMEO_NOTE_WHY = { unsupported:"in this browser", offline:"(check your connection, then reopen this window)",
  timeout:"(check your connection, then reopen this window)", failed:"on this device" };
function cameoNoteOff(why){
  return "Automatic side photos are off — the pose check couldn't start "+(CAMEO_NOTE_WHY[why]||CAMEO_NOTE_WHY.failed)+". Turn as the sketch shows, then press Capture now.";
}
/* the cue without the pose module (it failed to load): Front keeps its simple automatic capture */
function cameoFallbackCue(a, filled, auto, allDone, st){
  if(allDone) return { key:"complete", k:"done", text:"All three done — say whose likeness it is, tick the box and lock it", say:null };
  if(st && st.phase==="camera") return { key:"camera", k:"wait", text:"Allow the camera to start — or upload a photo", say:null };
  if(filled) return { key:"filled", k:"done", text:"Done — pick another photo or lock the likeness", say:null };
  if(!auto) return { key:"manual", k:"off", text:"Automatic capture is off — press Capture now when you're in position", say:null };
  if(a.side) return { key:"unavailable-side", k:"off", text:"Turn your head to your "+a.side+", then press Capture now", say:null };
  if(st && st.phase==="holding") return { key:"holding", k:"go", text:"Hold still — "+(st.secsLeft||1), say:null };
  return { key:"unavailable-front", k:"wait", text:"Look straight at the camera and hold still", say:null };
}
const CAMEO_RING_D = "M50 11 A27 35 0 1 1 49.999 11";

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
     Anything captured in this session before it arrives wins. The saved photos are checked on this
     device once the pose check is ready (a side slot holding a front view is marked, never changed). */
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
      for(const k of Object.keys(s)) if(next[k]===s[k]) prefillRef.current[k] = s[k];
      shotsRef.current = next;
      setShots(next); setActiveIdx(firstEmptyOf(next));
      setSources(cur=>({ ...src, ...cur }));
      if(!consentTouchedRef.current) setConsentV(cameoConsentFromRecord(mine));
      setSync(!!mine.sync); setWasSynced(!!mine.sync);
      if(mine.w) setDims({ w:mine.w, h:mine.h||mine.w });
      setPrefillN(n=>n+1);
    })();
    return ()=>{ alive = false; };
  },[character && character.id]);

  /* the capture loop's view: the cue, the ring, the turn meter (set by the loop, only on a change) */
  const [auto, setAuto] = React.useState(true);
  const [det, setDet] = React.useState(null);

  /* ── SPOKEN GUIDANCE (2026-10-10, owner — Likeness voice guidance: "once the head is turned you can't read the
     screen"): every instruction is said in Frances's recorded voice (FP.VOICE_LINES clips, played by
     FP.createVoiceGuide); a clip that can't play is said by a voice built into the device (nothing leaves it); when
     neither can, or Voice is off, the one-line caption under the picture shows the instruction. ── */
  const [voiceOn, setVoiceOn] = React.useState(()=>{ try{ return localStorage.getItem("turn_cameo_voice")!=="0"; }catch(e){ return true; } });
  const voiceOnRef = React.useRef(voiceOn); voiceOnRef.current = voiceOn;
  const guideRef = React.useRef(null);
  const toggleVoice = ()=>setVoiceOn(v=>{ const n=!v; try{ localStorage.setItem("turn_cameo_voice", n?"1":"0"); }catch(e){}
    if(guideRef.current) guideRef.current.setEnabled(n); return n; });
  const [voiceStatus, setVoiceStatus] = React.useState({ clips:null, silent:false });   // from the guide
  /* the device's own voice, for a line whose clip can't play: done(ok) when it ends */
  const speakDevice = (text, done)=>{
    try{
      const ss = window.speechSynthesis, voice = voiceListRef.current;
      if(!ss || !voice || typeof SpeechSynthesisUtterance!=="function" || !text) return false;
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; if(voice.lang) u.lang = voice.lang;
      u.rate = 1; u.volume = 0.8;
      u.onend = ()=>done(true);
      u.onerror = (e)=>{ const er = e && e.error; done(er==="interrupted" || er==="canceled"); };
      ss.speak(u);
      return true;
    }catch(e){ return false; }
  };
  const cancelSpeech = ()=>{ try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){} };
  const [flash, setFlash] = React.useState(false);
  const activeIdxRef = React.useRef(activeIdx); activeIdxRef.current = activeIdx;
  const shotsRef = React.useRef(shots); shotsRef.current = shots;
  const autoRef = React.useRef(auto); autoRef.current = auto;
  const analyRef = React.useRef(null);        // the simple Front check's 64px sample canvas
  const prevLumaRef = React.useRef(null);
  const busyRef = React.useRef(false);        // a capture's flash, or a confirmation open: the loop waits

  /* ── the pose check (app/face-pose.js) — appended state ── */
  const aliveRef = React.useRef(true);
  const [engineState, setEngineState] = React.useState("idle");   // idle | loading | ready | unavailable
  const engineRef = React.useRef(null);
  const engineWhyRef = React.useRef(null);                        // unsupported | offline | timeout | failed
  const smootherRef = React.useRef(null);
  const machineRef = React.useRef(null);
  const lastEvRef = React.useRef(null);                           // { ev, key, at } — the last frame checked
  const poseRef = React.useRef({});                               // key -> { measured, yaw, checked } — memory only
  const [checkState, setCheckState] = React.useState({});         // key -> "ok" | "mismatch" (saved photos)
  /* P2: a camera that already flips its picture — set for THIS window only, after the person checked it
     ("Preview not like a mirror? Check it"); never remembered, so another camera or a later window starts
     as a mirror again */
  const [camFlipped, setCamFlipped] = React.useState(false);
  const voiceListRef = React.useRef(null);                        // the device's own voice, or null
  const [announce, setAnnounce] = React.useState("");             // the screen-reader line
  const [voiceDev, setVoiceDev] = React.useState(false);          // a voice built into the device (the clips' fallback)
  const [camSeq, setCamSeq] = React.useState(0);                  // a camera stream arrived
  const [prefillN, setPrefillN] = React.useState(0);
  const [flipFix, setFlipFix] = React.useState(false);            // P2: offer "Preview not like a mirror? Check it"
  const nowRef = React.useRef(0);                                 // the loop's clock (the frame time)
  const engineStateRef = React.useRef(engineState); engineStateRef.current = engineState;
  const camFlippedRef = React.useRef(camFlipped); camFlippedRef.current = camFlipped;
  const checkStateRef = React.useRef(checkState); checkStateRef.current = checkState;
  const phaseRef = React.useRef(phase); phaseRef.current = phase;
  const savingRef = React.useRef(saving); savingRef.current = saving;
  const onCloseRef = React.useRef(onClose); onCloseRef.current = onClose;
  const prefillRef = React.useRef({});                            // key -> the saved photo's url (to check)
  const auditedRef = React.useRef({});
  const recreatedRef = React.useRef(false);
  const confirmOpenRef = React.useRef(false);
  const loopRef = React.useRef({ times:[], evPrev:{}, legacy:{ start:null, bad:null, at:null }, sig:"", cueKey:"", cueTarget:"",
    cueSince:0, srAt:0, srDone:true, spokenOnce:{}, lastCount:null, wrongSince:null, wrongBad:null, loadSince:null, bootSeq:0 });
  const captureNowRef = React.useRef(null);
  const [engineWanted, setEngineWanted] = React.useState(false);  // the camera runs, or a photo was uploaded to check
  const loadCtlRef = React.useRef(null);                          // aborts the download when the window closes
  const modeRef = React.useRef({});                               // key -> camera setting (flipped?) of a webcam photo taken in this window
  const lastObsRef = React.useRef(null);                          // { sobs, luma, at } — the loop's last frame
  const camSeqRef = React.useRef(camSeq); camSeqRef.current = camSeq;
  React.useEffect(()=>{ aliveRef.current = true; return ()=>{ aliveRef.current = false; }; },[]);

  const stopStream = ()=>{ try{ (streamRef.current&&streamRef.current.getTracks()||[]).forEach(t=>t.stop()); }catch(e){} streamRef.current=null; };
  const startCam = React.useCallback(async ()=>{
    setErr("");
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ setPhase("nocam"); return; }
    try{
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:"user", width:{ideal:1280}, height:{ideal:1280} }, audio:false });
      // the window closed while the browser asked: this camera must not stay on
      if(!aliveRef.current){ try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){} return; }
      streamRef.current = stream; setPhase("live"); setCamSeq(n=>n+1);
      requestAnimationFrame(()=>{ if(videoRef.current){ videoRef.current.srcObject=stream; videoRef.current.play().catch(()=>{}); } });
    }catch(e){ if(aliveRef.current) setPhase((e && (e.name==="NotAllowedError"||e.name==="SecurityError")) ? "denied" : "nocam"); }
  },[]);
  React.useEffect(()=>{ startCam(); return stopStream; },[startCam]);

  /* the device's own voices only */
  React.useEffect(()=>{
    const ss = window.speechSynthesis;
    const pick = ()=>{
      try{
        const vs = (ss && typeof ss.getVoices==="function" ? ss.getVoices() : []) || [];
        const local = vs.filter(v=>v && v.localService===true);
        voiceListRef.current = local.find(v=>/^en/i.test(String(v.lang||""))) || local[0] || null;
      }catch(e){ voiceListRef.current = null; }
      setVoiceDev(!!voiceListRef.current);
    };
    pick();
    if(!ss) return undefined;
    if(typeof ss.addEventListener==="function"){ ss.addEventListener("voiceschanged", pick); return ()=>{ try{ ss.removeEventListener("voiceschanged", pick); }catch(e){} }; }
    ss.onvoiceschanged = pick;
    return ()=>{ if(ss.onvoiceschanged===pick) ss.onvoiceschanged = null; };
  },[]);
  /* the voice guide: one per window, its clips preloaded when the window opens (opening it was a click, so the
     browser lets it play); everything stops when the window closes */
  React.useEffect(()=>{
    const FP = cameoFP();
    if(!FP || typeof FP.createVoiceGuide!=="function") return undefined;
    let base = FP.VOICE_DIR;
    try{ base = new URL(FP.VOICE_DIR, document.baseURI).href; }catch(e){}
    const g = FP.createVoiceGuide({
      base, enabled: !!voiceOnRef.current,
      now: ()=>nowRef.current,
      setTimeout: (fn, ms)=>setTimeout(fn, ms), clearTimeout: (id)=>clearTimeout(id),
      // one audio element plays every clip, one at a time
      makeAudio: ()=> (typeof Audio==="function") ? new Audio() : null,
      // the manifest says which clips were recorded, and with which words (a missing one: the device voice)
      loadManifest: ()=> (typeof fetch==="function")
        ? Promise.resolve().then(()=>fetch(base+"manifest.json", { cache:"no-cache", credentials:"same-origin" }))
            .then(r=> r && r.ok ? r.json() : null).catch(()=>null)
        : null,
      // each clip is read once when the window opens (small files, cached) and played from memory
      loadClip: (url)=> Promise.resolve().then(()=>fetch(url, { credentials:"same-origin" }))
        .then(r=> r && r.ok ? r.blob() : null)
        .then(b=>{ if(!b) return null; try{ return URL.createObjectURL(b); }catch(e){ return url; } })
        .catch(()=>null),
      releaseClip: (u)=>{ try{ if(/^blob:/.test(String(u))) URL.revokeObjectURL(u); }catch(e){} },
      speak: speakDevice, cancelSpeech, canSpeak: ()=>!!voiceListRef.current,
      onStatus: (st)=>{ if(aliveRef.current) setVoiceStatus(cur=> (cur.clips===st.clips && cur.silent===st.silent) ? cur : { clips:st.clips, silent:!!st.silent }); },
    });
    guideRef.current = g;
    g.preload();
    return ()=>{ if(guideRef.current===g) guideRef.current = null; g.close(); cancelSpeech(); };
  },[]);

  /* a break in what the loop saw (a dialog closed, the tab hidden, the check restarted): a hold in
     progress starts over — time nobody watched never counts */
  const holdBreak = ()=>{
    if(machineRef.current) machineRef.current.retarget(nowRef.current);
    loopRef.current.legacy = { start:null, bad:null, at:null };
  };
  /* the pose check loads only once the camera runs, or a photo is uploaded to be checked (neither →
     nothing is downloaded); one engine per window, closed (and its download stopped) when the window closes */
  const bootEngine = ()=>{
    const FP = cameoFP();
    if(!FP || typeof FP.load!=="function"){ engineWhyRef.current = "unsupported"; setEngineState("unavailable"); return; }
    const L = loopRef.current, my = ++L.bootSeq;
    let ctl = null; try{ ctl = (typeof AbortController==="function") ? new AbortController() : null; }catch(e){ ctl = null; }
    loadCtlRef.current = ctl;
    setEngineState("loading");
    let p; try{ p = FP.load(ctl ? { signal:ctl.signal } : {}); }catch(e){ p = Promise.reject(e); }
    Promise.resolve(p).then((eng)=>{
      if(!aliveRef.current || my!==loopRef.current.bootSeq){ try{ if(eng) eng.close(); }catch(e){} return; }
      engineRef.current = eng;
      if(smootherRef.current) smootherRef.current.reset();
      holdBreak();
      setEngineState("ready");
    }, (e)=>{
      if(!aliveRef.current || my!==loopRef.current.bootSeq) return;
      engineWhyRef.current = (typeof FP.mapLoadError==="function") ? FP.mapLoadError(e) : "failed";
      setEngineState("unavailable");
    });
  };
  React.useEffect(()=>{ if(phase==="live" && camSeq) setEngineWanted(true); },[phase, camSeq]);
  React.useEffect(()=>{
    if(!engineWanted) return undefined;
    bootEngine();
    return ()=>{
      loopRef.current.bootSeq++;
      const c = loadCtlRef.current; loadCtlRef.current = null;
      if(c){ try{ c.abort(); }catch(x){} }
      const e = engineRef.current; engineRef.current = null;
      if(e){ try{ e.close(); }catch(x){} }
      if(aliveRef.current) setEngineState("idle");
    };
  },[engineWanted]);
  /* the tab hidden: whatever was being held starts over when it's back */
  React.useEffect(()=>{
    if(typeof document==="undefined" || typeof document.addEventListener!=="function") return undefined;
    const onVis = ()=>{ if(document.hidden) holdBreak(); };
    document.addEventListener("visibilitychange", onVis);
    return ()=>{ try{ document.removeEventListener("visibilitychange", onVis); }catch(e){} };
  },[]);
  /* a detector error mid-session: close it and try once more, quietly; a second failure → manual */
  const engineFailed = ()=>{
    const e = engineRef.current; engineRef.current = null;
    if(e){ try{ e.close(); }catch(x){} }
    if(!recreatedRef.current){ recreatedRef.current = true; bootEngine(); }
    else { engineWhyRef.current = "failed"; setEngineState("unavailable"); }
  };

  function firstEmptyOf(next){ for(let i=0;i<CAMEO_ANGLES.length;i++){ if(!next[CAMEO_ANGLES[i].key]) return i; } return activeIdxRef.current||0; }
  /* where to go after a photo: the first empty slot; with none, the first photo marked as the wrong angle */
  const nextTargetOf = (next, skip)=>{
    for(let i=0;i<CAMEO_ANGLES.length;i++){ if(!next[CAMEO_ANGLES[i].key]) return i; }
    for(let i=0;i<CAMEO_ANGLES.length;i++){ const k = CAMEO_ANGLES[i].key; if(k!==skip && checkStateRef.current[k]==="mismatch") return i; }
    return activeIdxRef.current||0;
  };
  const markMismatch = (key)=>{
    checkStateRef.current = { ...checkStateRef.current, [key]:"mismatch" };
    setCheckState(s=>{ const n = { ...s, [key]:"mismatch" }; checkStateRef.current = n; return n; });
  };
  const dropCheck = (key)=>{
    delete poseRef.current[key]; delete prefillRef.current[key];
    if(key in checkStateRef.current){ const c = { ...checkStateRef.current }; delete c[key]; checkStateRef.current = c; }
    setCheckState(s=>{ if(!(key in s)) return s; const n = { ...s }; delete n[key]; checkStateRef.current = n; return n; });
  };

  /* commit a frame for a specific angle, flash, then advance to the next empty. o.shot: the frame cropped
     when the decision was made (Capture now crops BEFORE it asks, so the photo is the frame that was
     checked — never the one on screen when the question is answered) */
  const doCapture = (key, o)=>{
    o = o || {};
    const v = videoRef.current;
    if(busyRef.current) return false;
    if(!o.shot && (!v || !v.videoWidth)) return false;
    const FP = cameoFP();
    const t = nowRef.current;
    const { url, out } = o.shot || cameoCropToDataUrl(v, v.videoWidth, v.videoHeight, !!camFlippedRef.current);
    const next = { ...shotsRef.current, [key]:url };
    shotsRef.current = next;
    busyRef.current = true;
    if(machineRef.current) machineRef.current.markCaptured(o.measured || key, t);
    dropCheck(key);
    poseRef.current[key] = { measured:o.measured || null, yaw:(o.yaw==null ? null : o.yaw), checked:!!o.measured };
    modeRef.current[key] = o.shot ? !!o.shot.flipped : !!camFlippedRef.current;
    if(o.measured && o.measured!==key) markMismatch(key);   // taken anyway (Capture now, confirmed): marked "!"
    setFlash(true); setShots(next); setSources(s=>({ ...s, [key]:"webcam" })); setDims({w:out,h:out});
    // announce the capture + the next pose to strike (or that the set is complete)
    const nextA = CAMEO_ANGLES.find(x=>!next[x.key]);
    const eng = FP ? engineStateRef.current : "unavailable";
    const nextLine = FP ? FP.nextStepLine(nextA ? nextA.key : null, eng)
      : (nextA ? (nextA.side ? "Turn your head to your "+nextA.side+", then press Capture now." : "Look straight at the camera.") : "All three done. Say whose likeness it is, tick the box, and lock it.");
    // "Got it." interrupts everything, then the next step (the first time the sides are manual, why)
    const G = guideRef.current;
    if(G && FP){
      let ids = ["got-it"].concat(FP.voiceNextIds(nextA ? nextA.key : null, eng));
      if(eng==="unavailable" && nextA && nextA.side && !loopRef.current.noCheckSaid){ ids = ["got-it", "no-pose-check"].concat(ids.slice(1)); loopRef.current.noCheckSaid = true; }
      G.say(ids, { kind:"now" });
    }
    try{ if(navigator.vibrate) navigator.vibrate(40); }catch(e){}
    setAnnounce(FP && typeof FP.srCapturedLine==="function" ? FP.srCapturedLine(key, nextA ? nextA.key : null, eng) : "Photo taken. "+nextLine);
    const allDone = CAMEO_KEYS.every(k=>next[k]);
    const cue = FP ? FP.cueFor({ phase:"settle" }, null, key, {}) : { key:"settle", k:"done", text:"Got it!", say:null };
    loopRef.current.sig = "";
    setDet(d=>({ ...(d||{}), key, cue, phase:"settle", progress:0, yaw:null, inBand:false, filled:true, allDone, auto:autoRef.current, eng, mismatch:false, marked:-1 }));
    setTimeout(()=>{
      setFlash(false); busyRef.current = false;
      const ni = nextTargetOf(next, key), nk = CAMEO_ANGLES[ni].key;
      setActiveIdx(ni);
      setDet(d=>d ? ({ ...d, key:nk, filled:!!next[nk] }) : d);
    }, 280);
    return true;
  };

  /* ask before a photo that doesn't fit (the loop waits while the question is open; the hold starts
     over afterwards — the time the question was open isn't a held pose) */
  const cameoAsk = async (opts)=>{
    if(typeof window.appConfirm!=="function") return true;
    confirmOpenRef.current = true; busyRef.current = true;
    try{ return !!(await window.appConfirm(opts)); }
    catch(e){ return false; }
    finally{ confirmOpenRef.current = false; busyRef.current = false; holdBreak(); }
  };
  /* the frame on screen now, checked: a fresh detection of it, or (it's the frame the loop just checked)
     the loop's own reading of it, for this angle */
  const freshEv = (key)=>{
    const FP = cameoFP(), eng = engineRef.current, v = videoRef.current;
    if(!FP || !eng || !v || !v.videoWidth) return null;
    let res = null;
    try{ res = eng.detect(v, nowRef.current+1); }catch(e){ res = null; }
    if(res){
      const obs = FP.observe(res, v.videoWidth, v.videoHeight, { mirroredSource:!!camFlippedRef.current });
      const luma = obs.primary ? FP.sampleLuma(v, obs.primary.bboxPx) : null;
      const sm = smootherRef.current || (smootherRef.current = FP.createSmoother());
      const sobs = sm.push(obs, nowRef.current+1);
      lastObsRef.current = { sobs, luma, at:nowRef.current };
      const ev = FP.evaluateFrame(sobs, key, { luma, prev:loopRef.current.evPrev });
      lastEvRef.current = { ev, key, at:nowRef.current };
      return ev;
    }
    const le = lastEvRef.current, lo = lastObsRef.current;
    if(le && le.key===key && nowRef.current-le.at <= 400) return le.ev;
    if(lo && nowRef.current-lo.at <= 400) return FP.evaluateFrame(lo.sobs, key, { luma:lo.luma, prev:{ ...loopRef.current.evPrev } });
    return null;
  };
  /* Capture now (or the C key): straight away when the frame fits, or when only the light or holding
     still failed; otherwise it asks first — the pose, a second face, an uncertain direction, closed
     eyes, the framing. The frame is cropped at the press, so what's saved is what was checked. */
  const CAMEO_ASK_FIRST = ["two-faces", "uncertain", "eyes-closed", "far", "close", "offcenter"];
  const captureNow = async ()=>{
    if(busyRef.current || confirmOpenRef.current) return;
    const a = CAMEO_ANGLES[activeIdxRef.current] || CAMEO_ANGLES[0], key = a.key;
    const v = videoRef.current; if(!v || !v.videoWidth) return;
    const FP = cameoFP();
    const eng = FP ? engineStateRef.current : "unavailable";
    const ev = (eng==="ready" && engineRef.current) ? freshEv(key) : null;
    const flipped = !!camFlippedRef.current;
    const shot = { ...cameoCropToDataUrl(v, v.videoWidth, v.videoHeight, flipped), flipped };
    let measured = null;
    const asks = [];
    if(eng==="ready" && engineRef.current){
      if(!ev || ev.base==="none") asks.push(FP.confirmFor("C4", key, null));
      else if(!ev.ok){
        const fails = Array.isArray(ev.fails) ? ev.fails : [ev.reason];
        if(ev.measured!==key) asks.push(FP.confirmFor("C1", key, ev.measured));
        const more = fails.filter(r=>CAMEO_ASK_FIRST.indexOf(r)>=0);
        // a second person is asked about even after the pose question; the rest once is enough
        if(more.indexOf("two-faces")>=0) asks.push(FP.confirmFor("C5", key, null, { reason:"two-faces" }));
        else if(!asks.length && more.length) asks.push(FP.confirmFor("C5", key, null, { reason:more[0] }));
      }
      if(ev && ev.base!=="none") measured = ev.base;
    } else if(a.side){
      asks.push(FP ? FP.confirmFor("C2", key, null)
        : { title:"The pose couldn't be checked", body:"Make sure your head is turned to your "+a.side+" — toward the "+a.side+" edge of the screen. Use this frame for “"+a.show+"”?", confirmLabel:"Use this frame" });
    }
    for(const ask of asks){ if(!(await cameoAsk(ask))) return; }
    if(!aliveRef.current) return;
    doCapture(key, { measured, auto:false, shot });
  };
  captureNowRef.current = captureNow;

  /* the simple Front check (only when the pose check can't start): steady, well lit, something in
     the ring — held for 3 s */
  const legacyFrontStep = (v, t)=>{
    if(!v || !v.videoWidth) return null;
    const N = 64;
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
    const lo=N*0.27, hi=N*0.73;
    let s=0,s2=0,n=0;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(y>=lo&&y<=hi&&x>=lo&&x<=hi){ const l=luma[y*N+x]; s+=l; s2+=l*l; n++; }
    const cstd = n ? Math.sqrt(Math.max(0, s2/n-(s/n)*(s/n))) : 0;
    let motion=999; const prev=prevLumaRef.current;
    if(prev && prev.length===luma.length){ let d=0; for(let p=0;p<luma.length;p++) d+=Math.abs(luma[p]-prev[p]); motion=d/luma.length; }
    prevLumaRef.current = luma;
    const bright = mean>45 && mean<228, still = motion < 6.5, face = cstd > 15;
    const ready = bright && still && face;
    const G = loopRef.current.legacy, HOLD = 3000;
    // no frame for over 400 ms (a hidden tab, a dialog) breaks the hold, as in the pose check
    if(G.at!=null && t-G.at>400){ G.start = null; G.bad = null; }
    G.at = t;
    let started = false;
    if(ready){ if(G.start==null){ G.start = t; started = true; } G.bad = null; }
    else if(G.start!=null){ if(G.bad==null) G.bad = t; if(t-G.bad>=400){ G.start = null; G.bad = null; } }
    const el = G.start!=null ? t-G.start : 0;
    const fire = G.start!=null && ready && el>=HOLD;
    if(fire){ G.start = null; G.bad = null; }
    return { phase:(G.start!=null||fire) ? "holding" : "wait", progress: fire ? 1 : (G.start!=null ? Math.min(1, el/HOLD) : 0),
      secsLeft: G.start!=null ? Math.max(1, Math.ceil((HOLD-el)/1000)) : null, fire, started, reset:null, hint:null,
      reason: ready ? null : !bright ? (mean<=45 ? "dark" : "bright") : !still ? "moving" : "no-face" };
  };

  /* the loop's output: the cue (with its spoken line), the ring, the meter — set only on a change */
  /* how many photos are marked as the wrong angle (the saved-photo / upload check) */
  const markedCount = (cs, sh)=> CAMEO_KEYS.filter(k=>(sh||{})[k] && (cs||{})[k]==="mismatch").length;
  /* P2 is offered only when it can be a camera that flips its picture and not just someone unsure of
     their left: no side photo was taken live in this window yet (a camera that flips would have made
     that impossible), and the "wrong way" is a fresh turn the person is holding — not the pose they were
     just photographed in (the leave-first wait after a photo never counts) */
  const flipCanBeOffered = ()=> !camFlippedRef.current && !CAMEO_KEYS.some(k=>k!=="front" && (shotsRef.current||{})[k] && (k in modeRef.current));
  const publish = (st, ev, a, yaw, t, info)=>{
    const FP = cameoFP(), L = loopRef.current, key = a.key;
    const mismatch = !!info.filled && checkStateRef.current[key]==="mismatch";
    const marked = markedCount(checkStateRef.current, shotsRef.current);
    if(info.eng==="loading"){ if(L.loadSince==null) L.loadSince = t; } else L.loadSince = null;
    const slow = L.loadSince!=null && t-L.loadSince > 8000;
    const nextA = CAMEO_ANGLES.find(x=>!(shotsRef.current||{})[x.key]);
    const pr = poseRef.current[key];
    const cue = FP ? FP.cueFor(st, ev, key, { engine:info.eng==="idle" ? "loading" : info.eng, slow, allDone:info.allDone, mismatch,
        mismatchCount:marked, measured: mismatch && pr ? pr.measured : null, next: nextA ? nextA.key : null })
      : cameoFallbackCue(a, info.filled, autoRef.current, info.allDone, st);
    const inBand = !!(ev && ev.base===key);
    // P2: a side target turned "the wrong way" for 6 s straight while the machine waits for a pose →
    // offer the check (it asks a question the person can see for themselves; nothing changes without it)
    if(a.side && st.phase==="wait" && cue.key==="wrong-way" && flipCanBeOffered()){
      if(L.wrongSince==null) L.wrongSince = t;
      L.wrongBad = null;
      if(t-L.wrongSince >= 6000){
        setFlipFix(true);
        if(!L.fixSaid && guideRef.current && guideRef.current.say(["check-mirror"], { kind:"line" })) L.fixSaid = true;
      }
    } else if(L.wrongSince!=null){
      if(L.wrongBad==null) L.wrongBad = t;
      if(t-L.wrongBad >= 400){ L.wrongSince = null; L.wrongBad = null; }
    }
    const prog = Math.round((st.progress||0)*50);
    const yawR = (yaw==null || !isFinite(yaw)) ? null : Math.round(yaw);
    const sig = [key, cue.key, cue.text, cue.hint||"", st.secsLeft, prog, yawR, inBand?1:0, st.phase, info.eng, info.filled?1:0, autoRef.current?1:0, mismatch?1:0, info.allDone?1:0, marked, info.cam?1:0].join("|");
    if(sig!==L.sig){
      L.sig = sig;
      setDet({ key, cue, phase:st.phase, progress:prog/50, yaw:yawR, inBand, filled:!!info.filled, allDone:!!info.allDone,
        auto:!!autoRef.current, eng:info.eng, mismatch, marked, cam:!!info.cam });
    }
    // what is said (the voice guide), and what a screen reader hears
    if(cue.key!==L.cueKey || key!==L.cueTarget){ L.cueKey = cue.key; L.cueTarget = key; L.cueSince = t; L.srAt = t; L.srDone = false; }
    const G = guideRef.current;
    if(st.started){
      L.lastCount = st.secsLeft;
      // "Hold it there. Five." — after a small move that restarted the count, "Hold still. Five."
      if(G && FP) G.say(FP.voiceHoldIds(key, st.secsLeft, !!st.reset), { kind:"count" });
      setAnnounce("Hold still for "+(a.side ? 5 : 3)+" seconds");
    } else if(st.phase==="holding" && st.secsLeft!=null && st.secsLeft!==L.lastCount){
      L.lastCount = st.secsLeft;
      const id = FP && FP.voiceCountId(st.secsLeft);
      if(G && id) G.say([id], { kind:"count" });
    }
    if(st.phase!=="holding" && L.lastCount!=null){ L.lastCount = null; if(G) G.dropCount(); }
    if(st.reset && !st.started && FP && G){
      const r = FP.cueFor({ phase:"wait", reason:st.reset }, null, key, { engine:info.eng });
      if(r.voice) G.say(r.voice, { kind:"line" });
    }
    if(G){
      // a line is said once it has held for 0.7 s (no chatter while the pose flickers between two cues); "allow the
      // camera" and "getting ready" only when they really take a while
      // (2026-10-10, owner: "a bit slow catching up") a correction is said after 0.25 s, not 0.7
      const dwell = cue.key==="camera" ? 2500 : (cue.key==="loading" ? 1500 : 250);
      if(cue.key==="holding" || cue.key==="settle") G.cue(cue.key+"|"+key, null);
      else if(t-L.cueSince >= dwell){
        // a tip after 20 s without a photo: once per angle
        if(cue.hint && cue.hintVoice && !L.spokenOnce["h|"+key] && G.say(cue.hintVoice, { kind:"line" })) L.spokenOnce["h|"+key] = true;
        let ids = cue.voice;
        if(cue.key==="unavailable-side" && !L.noCheckSaid && ids){ ids = ["no-pose-check"].concat(ids); }
        if(G.cue(cue.key+"|"+key, ids, { remind:!cue.once }) && cue.key==="unavailable-side") L.noCheckSaid = true;
      }
    }
    if(!L.srDone && t-L.srAt >= 800 && cue.key!=="holding" && cue.key!=="settle"){
      L.srDone = true; setAnnounce(cue.text+(cue.hint ? " "+cue.hint : ""));
    }
  };

  /* one tick of the capture loop (about 10 a second): the frame → the pose → the hold → maybe the photo */
  const tick = (t)=>{
    const FP = cameoFP(), L = loopRef.current;
    const a = CAMEO_ANGLES[activeIdxRef.current] || CAMEO_ANGLES[0], key = a.key;
    const v = videoRef.current;
    const sh = shotsRef.current || {};
    const filled = !!sh[key];
    const allDone = CAMEO_KEYS.every(k=>sh[k]);
    const eng = FP ? engineStateRef.current : "unavailable";
    const autoOn = !!autoRef.current;
    const cam = !!camSeqRef.current;           // a camera stream arrived (until then the browser is asking)
    let st = null, ev = null, yaw = null;
    if(!cam){
      st = { phase:"camera", progress:0, secsLeft:null, fire:false, reason:null, hint:null, started:false, reset:null };
    } else if(eng==="ready" && engineRef.current && !filled){
      if(!v || !v.videoWidth) return;
      let res = null;
      const t0 = cameoPerfNow();
      try{ res = engineRef.current.detect(v, t); }
      catch(e){ engineFailed(); return; }
      if(res==null) return;
      L.times.push(cameoPerfNow()-t0); if(L.times.length>10) L.times.shift();
      const obs = FP.observe(res, v.videoWidth, v.videoHeight, { mirroredSource:!!camFlippedRef.current });
      const luma = obs.primary ? FP.sampleLuma(v, obs.primary.bboxPx) : null;
      const sm = smootherRef.current || (smootherRef.current = FP.createSmoother());
      const sobs = sm.push(obs, t);
      lastObsRef.current = { sobs, luma, at:t };
      ev = FP.evaluateFrame(sobs, key, { luma, prev:L.evPrev });
      yaw = sobs.pose ? sobs.pose.yaw : null;
      lastEvRef.current = { ev, key, at:t };
      const m = machineRef.current || (machineRef.current = FP.createHoldMachine());
      st = m.step(ev, t, { target:key, filled, auto:autoOn, engine:"ready" });
      // the photo is the frame that was just checked
      if(st.fire){ doCapture(key, { measured:ev.base, auto:true, yaw }); return; }
    } else if(eng==="unavailable" && autoOn && !filled && (FP ? FP.canAutoCapture(key, eng) : key==="front")){
      // the pose check couldn't start: Front keeps its simple automatic capture, the sides are manual
      st = legacyFrontStep(v, t);
      if(!st) return;
      if(st.fire){ doCapture(key, { measured:null, auto:true }); return; }
    } else {
      st = { phase: !autoOn ? "manual" : filled ? "filled" : (eng==="unavailable" ? "wait" : "loading"),
        progress:0, secsLeft:null, fire:false, reason:null, hint:null, started:false, reset:null };
    }
    publish(st, ev, a, yaw, t, { eng, filled, allDone, cam });
  };

  /* ── the capture loop: one rAF loop, every 100 ms (160 ms on a slow device) ── */
  React.useEffect(()=>{
    if(phase!=="live") return undefined;
    let raf=0, stopped=false, last=-1e9;
    const loop = (t)=>{
      if(stopped) return;
      raf = requestAnimationFrame(loop);
      const times = loopRef.current.times.slice().sort((x,y)=>x-y);
      const median = times.length ? times[Math.floor(times.length/2)] : 0;
      if(t-last < (median > 60 ? 160 : 100)) return;
      last = t; nowRef.current = t;
      if(busyRef.current) return;
      try{ tick(t); }catch(e){}
    };
    raf = requestAnimationFrame(loop);
    return ()=>{ stopped=true; cancelAnimationFrame(raf); };
  },[phase, engineState]);

  /* a new target (a slot click or the advance after a photo) */
  React.useEffect(()=>{
    if(machineRef.current) machineRef.current.retarget(nowRef.current);
    const L = loopRef.current;
    L.spokenOnce = {}; L.wrongSince = null; L.wrongBad = null; L.lastCount = null; L.fixSaid = false; L.legacy = { start:null, bad:null, at:null };
    setFlipFix(false);
  },[activeIdx]);

  /* the saved photos — and photos uploaded before the check was ready — are checked once each, on this
     device: a side slot that holds a front view (or a front slot that doesn't) is marked "!" — nothing
     is changed. When the slot on screen is fine, the window moves to the first marked one. */
  React.useEffect(()=>{
    const FP = cameoFP(), eng = engineRef.current;
    if(engineState!=="ready" || !FP || !eng) return undefined;
    const todo = Object.keys(prefillRef.current).filter(k=>{ const u = prefillRef.current[k]; return u && !auditedRef.current[k+"|"+u] && (shotsRef.current||{})[k]===u; });
    if(!todo.length) return undefined;
    let alive = true;
    (async()=>{
      const found = {};
      for(const k of todo){
        const url = prefillRef.current[k];
        let img = null;
        try{ img = await cameoLoadImage(url); }catch(e){ img = null; }
        if(!alive || engineRef.current!==eng) break;
        let obs = null;
        if(img){ try{ obs = eng.audit(img); }catch(e){ obs = null; } }
        auditedRef.current[k+"|"+url] = true;
        if(!obs || (shotsRef.current||{})[k]!==url) continue;
        const measured = obs.primary ? FP.classifyPose(obs.primary.pose, null).base : "none";
        const yaw = obs.primary && obs.primary.pose ? obs.primary.pose.yaw : null;
        poseRef.current[k] = { measured, yaw, checked:true };
        /* ONLY A REAL MISTAKE IS MARKED (2026-10-10, owner: a right-side photo the live check had taken was marked "!"
           only after reopening): a still photo reads a few degrees differently from the live picture, so a side photo
           a little short of or past the live band is fine. Marked: a side slot holding a front view (under ~15°) or a
           turn the other way; a Front slot turned more than ~15°; no face at all. */
        const ay = (typeof yaw==="number" && isFinite(yaw)) ? Math.abs(yaw) : null;
        const mistake = ay==null ? true
          : k==="front" ? ay > 15
          : (ay < 15 || (k==="left" ? yaw < 0 : yaw > 0));
        found[k] = mistake ? "mismatch" : "ok";
      }
      if(smootherRef.current) smootherRef.current.reset();
      if(!aliveRef.current || !Object.keys(found).length) return;
      const merged = { ...checkStateRef.current, ...found };
      checkStateRef.current = merged;
      setCheckState(s=>{ const n = { ...s, ...found }; checkStateRef.current = n; return n; });
      const sh = shotsRef.current || {}, cur = CAMEO_ANGLES[activeIdxRef.current] || CAMEO_ANGLES[0];
      if(sh[cur.key] && merged[cur.key]!=="mismatch"){
        const i = CAMEO_ANGLES.findIndex(a=>sh[a.key] && merged[a.key]==="mismatch");
        if(i>=0) setActiveIdx(i);
      }
    })();
    return ()=>{ alive = false; };
  },[engineState, prefillN]);

  /* C = Capture now (not while typing); Escape closes (not while saving; an open confirmation takes
     Escape first — it listens in the capture phase and stops it) */
  React.useEffect(()=>{
    const onKey = (e)=>{
      if(!e || e.defaultPrevented || confirmOpenRef.current) return;
      const el = e.target, tag = (el && el.tagName) ? String(el.tagName).toLowerCase() : "";
      const typing = tag==="input" || tag==="textarea" || tag==="select" || !!(el && el.isContentEditable);
      if(e.key==="Escape"){
        if(savingRef.current) return;
        if(e.preventDefault) e.preventDefault();
        if(onCloseRef.current) onCloseRef.current();
        return;
      }
      if((e.key==="c" || e.key==="C") && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && phaseRef.current==="live"){
        if(e.preventDefault) e.preventDefault();
        if(captureNowRef.current) captureNowRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return ()=> window.removeEventListener("keydown", onKey);
  },[]);

  // upload lands in the ACTIVE slot (the one highlighted / labelled on the button), so a
  // profile photo goes to a side slot when that slot is selected — not always Front.
  // With the camera on, it stays on that slot (don't jump back to an empty Front) so the user sees
  // their upload took; without a camera it moves on to the next empty slot. With the pose check ready,
  // a photo that doesn't look like its slot's angle (or shows a second person) asks first; before it's
  // ready the photo goes in and is checked on this device once it is (the check is started for it, so a
  // blocked camera still gets it) — a photo that doesn't fit is then marked "!".
  const onPickFile = (e)=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const targetKey = CAMEO_ANGLES[activeIdxRef.current].key;
    const rd = new FileReader();
    rd.onload = ()=>{ const img=new Image(); img.onload=async ()=>{
      const { url, out, canvas } = cameoCropToDataUrl(img, img.width, img.height);
      const FP = cameoFP(), eng = engineRef.current;
      let measured = null, checkLater = false;
      if(FP && eng && engineStateRef.current==="ready"){
        let obs = null;
        try{ obs = eng.audit(canvas); }catch(x){ obs = null; }
        if(smootherRef.current) smootherRef.current.reset();
        if(obs){
          measured = obs.primary ? FP.classifyPose(obs.primary.pose, null).base : "none";
          const asks = [];
          if(!obs.primary) asks.push(FP.confirmFor("C4", targetKey, null, { photo:true }));
          else {
            if(measured!==targetKey) asks.push(FP.confirmFor("C3", targetKey, measured));
            if(obs.faces > 1) asks.push(FP.confirmFor("C5", targetKey, null, { reason:"two-faces", photo:true }));
          }
          for(const ask of asks){ if(!(await cameoAsk(ask))) return; }
        }
      } else if(FP && typeof FP.load==="function" && engineStateRef.current!=="unavailable"){
        checkLater = true;
      }
      if(!aliveRef.current) return;
      const next = { ...shotsRef.current, [targetKey]:url };
      shotsRef.current = next;
      dropCheck(targetKey);
      delete modeRef.current[targetKey];
      poseRef.current[targetKey] = { measured, yaw:null, checked:!!measured };
      if(measured && measured!==targetKey) markMismatch(targetKey);   // kept anyway: marked "!" like a saved one
      // (an upload is no live pose: it doesn't arm the "change your pose" rule — the hold just starts over)
      holdBreak();
      setShots(next); setSources(s=>({ ...s, [targetKey]:"upload" })); setDims({w:out,h:out});
      if(checkLater){ prefillRef.current[targetKey] = url; setPrefillN(n=>n+1); setEngineWanted(true); }
      if(phaseRef.current!=="live") setActiveIdx(firstEmptyOf(next));
    }; img.src = rd.result; };
    rd.readAsDataURL(f);
    e.target.value = "";
  };
  const clearShot = (key)=>{ const next={ ...shotsRef.current }; delete next[key]; shotsRef.current = next; setShots(next);
    setSources(s=>{ const n={ ...s }; delete n[key]; return n; });
    if(machineRef.current) machineRef.current.cleared(nowRef.current);   // a deliberate retake
    dropCheck(key);
    delete modeRef.current[key];
    const idx=CAMEO_ANGLES.findIndex(a=>a.key===key); if(idx>=0) setActiveIdx(idx); };
  /* P2: a camera that already flips its picture — show it as it comes, read its sides swapped back,
     and flip the photo back to true orientation. For this window only. A Front taken in the other
     setting is flipped to match; a side photo taken in it was read the wrong way round, so switching
     back clears it (after asking). */
  const setFlip = async (on)=>{
    on = !!on;
    setFlipFix(false);
    if(on===!!camFlippedRef.current) return;
    const FP = cameoFP();
    const other = CAMEO_KEYS.filter(k=>(shotsRef.current||{})[k] && (k in modeRef.current) && modeRef.current[k]!==on);
    const sides = other.filter(k=>k!=="front");
    if(sides.length && !(await cameoAsk(FP ? FP.confirmFor("unflip") : { title:"Switch back to the usual mirror view?", body:"The side photos taken since the switch will be cleared to take again.", confirmLabel:"Switch back" }))) return;
    if(!aliveRef.current) return;
    camFlippedRef.current = on; setCamFlipped(on);
    if(smootherRef.current) smootherRef.current.reset();
    loopRef.current.evPrev = {}; loopRef.current.wrongSince = null; loopRef.current.wrongBad = null;
    holdBreak();
    if(sides.length){
      const next = { ...shotsRef.current };
      for(const k of sides){ delete next[k]; delete modeRef.current[k]; dropCheck(k); }
      shotsRef.current = next; setShots(next);
      setSources(s=>{ const n={ ...s }; for(const k of sides) delete n[k]; return n; });
      if(machineRef.current) machineRef.current.cleared(nowRef.current);
      setActiveIdx(firstEmptyOf(next));
    }
    for(const k of other.filter(x=>x==="front")){
      const url = shotsRef.current[k];
      let flipped = null;
      try{ flipped = await cameoFlipDataUrl(url); }catch(e){ flipped = null; }
      if(!aliveRef.current || !flipped || shotsRef.current[k]!==url) continue;
      const next = { ...shotsRef.current, [k]:flipped };
      shotsRef.current = next; setShots(next);
      modeRef.current[k] = on;
    }
  };
  /* "Preview not like a mirror? Check it": a question the person can answer by looking (writing reads
     backwards in a mirror) — only a "reads normally" switches anything */
  const checkFlip = async ()=>{
    const FP = cameoFP();
    setFlipFix(false); loopRef.current.wrongSince = null; loopRef.current.wrongBad = null;
    if(!FP) return;
    if(await cameoAsk(FP.confirmFor("flip"))) await setFlip(true);
  };

  const save = async ()=>{
    if(!hasFront || !consentOk || saving) return;
    // photos marked as the wrong angle: asked once, the safe answer is to retake them
    const FP = cameoFP();
    const marked = CAMEO_ANGLES.filter(a=>shots[a.key] && checkState[a.key]==="mismatch");
    if(marked.length && FP){
      const items = marked.map(a=>{ const pr = poseRef.current[a.key]; return "“"+a.show+"” shows "+FP.describeClass(pr && pr.measured, "the person's"); });
      if(!(await cameoAsk(FP.confirmFor("lock", null, null, { count:marked.length, items })))) return;
      if(!aliveRef.current) return;
    }
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
  const FPr = cameoFP();
  const engUi = FPr ? engineState : "unavailable";
  const targetFilled = !!shots[activeAngle.key];
  const allDone = CAMEO_KEYS.every(k=>shots[k]);
  const mismatchNow = targetFilled && checkState[activeAngle.key]==="mismatch";
  const markedNow = markedCount(checkState, shots);
  const camOn = camSeq > 0;
  /* the live cue: the loop's, when it describes this very state; otherwise the resting one */
  let cue;
  if(det && det.key===activeAngle.key && det.filled===targetFilled && det.auto===auto && det.eng===engUi && det.allDone===allDone
    && det.mismatch===mismatchNow && det.marked===markedNow && det.cam===camOn) cue = det.cue;
  else {
    const nextA = CAMEO_ANGLES.find(x=>!shots[x.key]);
    const pr = poseRef.current[activeAngle.key];
    const restPhase = !camOn ? "camera" : !auto ? "manual" : targetFilled ? "filled" : (engUi==="ready" || engUi==="unavailable") ? "wait" : "loading";
    cue = FPr ? FPr.cueFor({ phase:restPhase, reason:null },
        null, activeAngle.key, { engine:engUi==="idle" ? "loading" : engUi, allDone, mismatch:mismatchNow, mismatchCount:markedNow,
          measured:mismatchNow && pr ? pr.measured : null, next:nextA ? nextA.key : null })
      : cameoFallbackCue(activeAngle, targetFilled, auto, allDone, { phase:restPhase });
  }
  const live = det && det.key===activeAngle.key;
  const ringPct = live && !targetFilled ? Math.round((det.progress||0)*100) : 0;
  const holding = cue.k==="go";
  const inBand = !!(live && det.inBand);
  const yawNow = live ? det.yaw : null;
  const band = FPr ? FPr.bandFor(activeAngle.key) : null;
  const showFix = flipFix && !camFlipped && cue.key==="wrong-way";
  /* the voice: recorded clips (known once the manifest answered) or a voice built into the device */
  const canVoice = !!FPr && (voiceDev || voiceStatus.clips==null || voiceStatus.clips > 0);
  const captionOn = !voiceOn || !canVoice || !!voiceStatus.silent;
  /* Capture now: hidden while the photo takes itself (Auto on, the pose check running), shown when it doesn't — the
     check can't start or is still loading, Auto is off, or the 20-second tip says "or press Capture now". The C key
     works either way. */
  const capNowOn = camOn && (!auto || engUi!=="ready" || !!cue.hint);
  const why = engineWhyRef.current || "unsupported";
  const describe = (m, who)=> FPr ? FPr.describeClass(m, who) : "another angle";
  /* which photo to pick for the slot: a true-orientation photo of an own-left turn has the nose pointing
     to the photo's RIGHT (the strip shows it mirrored, like the sketch) */
  const uploadFor = "Upload for “"+activeAngle.show+"”";
  const uploadTitle = "Upload a photo into the “"+activeAngle.show+"” slot — "
    + (activeAngle.side ? "the person turned to their own "+activeAngle.side+" (in the photo, their nose points to the "+(activeAngle.side==="left" ? "right" : "left")+")"
      : "the person looking straight at the camera")
    + ". Click another slot above to change the target.";

  return React.createElement("div",{className:"cameo-overlay",onClick:onClose},
    React.createElement("div",{className:"cameo-modal",onClick:stop,
        // a click lets clips the browser held back play again (they were said by the device voice meanwhile)
        onPointerDown:()=>{ if(guideRef.current) guideRef.current.unlock(); }},
      React.createElement("div",{className:"cameo-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"cameo-title"},
            React.createElement(Icon.userScan,{s:16})," Likeness · ",character.name),
          React.createElement("div",{className:"cameo-sub"},"Look straight at the camera for Front, then turn your head to each side. The preview works like a mirror: your left is the left of the screen.")),
        React.createElement("button",{className:"cameo-x",onClick:onClose,"aria-label":"Close"},
          React.createElement(Icon.x,{s:16}))),

      /* stage: live camera with the active angle's guide, ring, arrow, meter and cue — or fallbacks */
      React.createElement("div",{className:"cameo-stage","data-engine":liveOk ? engUi : phase,...(liveOk ? { "data-cue":cue.key } : {})},
        liveOk && React.createElement(React.Fragment,null,
          React.createElement("video",{ref:videoRef,className:"cameo-video"+(camFlipped?" unmirror":""),playsInline:true,muted:true}),
          React.createElement("div",{className:"cameo-guide"+(holding?" go":"")}),
          !targetFilled && React.createElement(CameoPoseSketch,{ angle:activeAngle.key, className:"cameo-guide-ghost" }),
          !targetFilled && React.createElement("svg",{ className:"cameo-ring"+(holding?" holding":""), viewBox:"0 0 100 100", preserveAspectRatio:"none",
              "aria-hidden":"true", "data-progress":ringPct },
            // (no vector-effect:non-scaling-stroke — with it the browser lays the dashes out in screen pixels,
            // ignoring pathLength, and the fill breaks into pieces; the stage is square, so it scales evenly)
            React.createElement("path",{ className:"cameo-ring-track", d:CAMEO_RING_D, pathLength:100 }),
            React.createElement("path",{ className:"cameo-ring-fill", d:CAMEO_RING_D, pathLength:100,
              strokeDasharray:ringPct+" 100" })),
          activeAngle.side && !targetFilled && React.createElement("div",{ className:"cameo-turn-arrow "+activeAngle.side+(inBand?" in-band":""), "aria-hidden":"true" },
            React.createElement("svg",{ viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:2.6, strokeLinecap:"round", strokeLinejoin:"round" },
              React.createElement("path",{ d: activeAngle.side==="left" ? "M12 5 L5 12 L12 19 M19 5 L12 12 L19 19" : "M12 5 L19 12 L12 19 M5 5 L12 12 L5 19" }))),
          flash && React.createElement("div",{className:"cameo-flash"}),
          React.createElement("div",{className:"cameo-anglebadge"},
            "Now: ",React.createElement("b",null,activeAngle.show),activeAngle.req?" · required":" · optional"),
          engUi==="ready" && band && React.createElement("div",{className:"cameo-meter","aria-hidden":"true"},
            React.createElement("span",{className:"cameo-meter-lab"},"your left"),
            React.createElement("div",{className:"cameo-meter-track"},
              React.createElement("div",{className:"cameo-meter-band",style:{left:band.from+"%",width:(band.to-band.from)+"%"}}),
              yawNow!=null && React.createElement("div",{className:"cameo-meter-dot"+(inBand?" in-band":""),style:{left:FPr.meterPos(yawNow)+"%"}})),
            React.createElement("span",{className:"cameo-meter-lab"},"your right"))),
        phase==="denied" && React.createElement("div",{className:"cameo-msg"},
          React.createElement(Icon.warn,{s:26}),
          React.createElement("div",{className:"cameo-msg-t"},"Camera access blocked"),
          React.createElement("div",{className:"cameo-msg-s"},"Allow camera in your browser's address bar, or upload photos instead — click a slot below to choose where each one goes."),
          React.createElement("div",{className:"cameo-msg-acts"},
            // retry WITHOUT reopening the modal — after the user flips the permission,
            // this re-requests the stream and drops straight into live capture
            React.createElement("button",{className:"cameo-btn ghost",onClick:startCam},
              React.createElement(Icon.undo,{s:14}),"Try camera again"),
            React.createElement("button",{className:"cameo-btn ghost",onClick:()=>fileRef.current&&fileRef.current.click(),title:uploadTitle},
              React.createElement(Icon.image,{s:14}),uploadFor))),
        phase==="nocam" && React.createElement("div",{className:"cameo-msg"},
          React.createElement(Icon.image,{s:26}),
          React.createElement("div",{className:"cameo-msg-t"},"No camera available"),
          React.createElement("div",{className:"cameo-msg-s"},"Upload clear photos instead: Front first, then, if you like, the head turned to the person's own left and to their own right. Click a slot below to choose where each one goes."),
          React.createElement("button",{className:"cameo-btn ghost",onClick:()=>fileRef.current&&fileRef.current.click(),title:uploadTitle},
            React.createElement(Icon.image,{s:14}),"Choose a photo for “"+activeAngle.show+"”"))),
      /* under the picture (never over it): the instruction as one line when it isn't spoken, the mirror check, and
         Capture now when the photo doesn't take itself */
      liveOk && React.createElement("div",{className:"cameo-under"},
        React.createElement("div",{className:"cameo-caption "+cue.k,"data-cue":cue.key,"data-k":cue.k,hidden:!captionOn,"aria-hidden":"true",
            title:cue.text+(cue.hint ? " "+cue.hint : "")},
          React.createElement("span",{className:"cameo-caption-dot"}),
          React.createElement("span",{className:"cameo-caption-t"},cue.text),
          cue.hint && React.createElement("span",{className:"cameo-caption-hint"},cue.hint)),
        showFix && React.createElement("button",{className:"cameo-fix-link","data-role":"flip-fix",onClick:checkFlip},"Preview not like a mirror? Check it"),
        capNowOn && React.createElement("button",{className:"cameo-capnow","data-role":"capture-now",onClick:captureNow,
          title:"Take this photo now (C)","aria-keyshortcuts":"C"},"Capture now")),
      liveOk && camOn && React.createElement("div",{className:"cameo-note"+(engUi==="unavailable"?" warn":"")},
        engUi==="unavailable" ? cameoNoteOff(why) : CAMEO_NOTE_OK),
      liveOk && React.createElement("div",{className:"cameo-sr",role:"status","aria-live":"polite","aria-atomic":"true"},announce),

      /* angle strip — captured thumbnails / target slots (an empty slot shows its pose sketch) */
      React.createElement("div",{className:"cameo-strip"},
        CAMEO_ANGLES.map((a,i)=>{
          const filled = !!shots[a.key];
          const chk = filled ? checkState[a.key] : null;
          const mism = chk==="mismatch";
          const pr = poseRef.current[a.key];
          const title = !filled ? "Capture: "+a.long
            : mism ? ("This photo shows "+describe(pr && pr.measured, "the person's")+" — click × to take it again")
            : "Click × to take this one again";
          return React.createElement("button",{key:a.key,"data-angle":a.key,...(chk ? { "data-check":chk } : {}),
            className:"cameo-slot"+(filled?" filled":"")+(i===activeIdx?" active":"")+(mism?" warn":""),
            onClick:()=>setActiveIdx(i),title},
            filled
              ? React.createElement(React.Fragment,null,
                  // every photo here is shown like the mirrored preview (webcam and upload alike), so it faces the
                  // same way as the slot's sketch and its ←/→ label; they're SAVED in true orientation
                  React.createElement("img",{src:shots[a.key],alt:a.show,className:"mirror"}),
                  mism && React.createElement("span",{className:"cameo-slot-warn","aria-hidden":"true"},"!"),
                  React.createElement("span",{className:"cameo-slot-x",onClick:(e)=>{ e.stopPropagation(); clearShot(a.key); }},
                    React.createElement(Icon.x,{s:10,sw:2.4})))
              : React.createElement(CameoPoseSketch,{ angle:a.key, className:"cameo-slot-guide" }),
            React.createElement("span",{className:"cameo-slot-lab"},a.strip,a.req?React.createElement("i",null," *"):null));
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
          {className:"cameo-btn ghost","data-role":"upload",onClick:()=>fileRef.current&&fileRef.current.click(),
           title:uploadTitle},
          React.createElement(Icon.image,{s:14}),uploadFor),   // always says which slot it fills (2026-10-10)
        liveOk && React.createElement("button",{className:"cameo-autopill"+(auto?" on":""),"data-role":"auto",
          onClick:()=>setAuto(a=>!a),
          title: !auto ? "Automatic capture off — use Capture now"
            : engUi==="unavailable" ? "Automatic capture works for Front only on this device"
            : "Automatic capture on — takes the photo after you hold the pose (3 s for Front, 5 s for each side)"},
          React.createElement(Icon.bolt,{s:14}),"Auto"),
        liveOk && React.createElement("button",{className:"cameo-autopill"+(voiceOn&&canVoice?" on":""),"data-role":"voice",
          onClick:toggleVoice, disabled:!canVoice, "aria-pressed":voiceOn&&canVoice?"true":"false",
          title: !canVoice ? "Spoken directions aren't available in this browser"
            : voiceOn ? "Spoken directions on — says every step out loud, so you don't need to read the screen while you turn" : "Spoken directions off — the steps are shown under the picture"},
          React.createElement(Icon.mic,{s:14}),"Voice"),
        liveOk && camFlipped && React.createElement("button",{className:"cameo-autopill on","data-role":"cam-flipped",
          onClick:()=>setFlip(false), title:"Your camera already flips the picture — click to undo"},"Flipped camera"),
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
          out[keyOf(e)] = r ? (r.angles||[]).filter(a=>/^data:image\//i.test(String(a.url||""))).map(a=>({ key:a.key, label:a.label, url:a.url })) : [];
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
        angles.length ? angles.slice(0,3).map((a,i)=>React.createElement("img",{ key:i, src:a.url, alt:cameoAngleShow(a), title:cameoAngleShow(a) }))
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

/* newstory.jsx — the New Story intake. Many doors in (seed types), one logline out,
   then hands off to the Adaptation agent. Meets a filmmaker where their idea lives. */

const SEED_TYPES = [
  { id:"logline",   label:"Logline",     icon:"target",  hint:"You have a one-line pitch.",
    inputLabel:"Your logline", placeholder:"A grieving deep-sea welder hears her dead daughter\u2019s voice in the drowned city she was hired to repair." },
  { id:"whatif",    label:"\u201cWhat if\u2026\u201d", icon:"sparkles", hint:"A premise as a question.",
    inputLabel:"Your \u201cwhat if\u2026\u201d", placeholder:"What if a town could sell its memories \u2014 and one family sold too much?" },
  { id:"talk",      label:"Talk it through", icon:"mic", hint:"Not sure yet? Talk it out loud \u2014 I\u2019ll ask a few questions and listen.",
    inputLabel:"", placeholder:"" },
];
/* BRING YOUR OWN SCRIPT (owner 2026-10-18, docs/Script Import Plan.md): a finished screenplay comes in through its
   own window (script-import-ui.jsx) — shown only when the app passes onImportScript */
const SEED_SCRIPT = { id:"script", label:"I have a script", icon:"script",
  hint:"Bring your finished screenplay \u2014 Fountain, Final Draft, Highland or plain text, or paste it. Every word is kept exactly as you wrote it.",
  inputLabel:"", placeholder:"" };

// the four intake screens, in order — drives the header progress stepper
/* Step order (reordered 2026-07-11, owner-approved): the SEED comes first — a
   creator arrives with an idea, not a container. Developing the seed recommends
   the format + framework, and the SHAPE step then shows that recommendation
   pre-selected (an explicit pick there still always wins). */
const NS_STEPS = [
  { id:"seed",     label:"Seed" },
  { id:"format",   label:"Shape" },
  { id:"loglines", label:"Logline" },
  { id:"research", label:"Research" },   // its own moment (2026-10-02, owner-approved): read, edit, steer
  { id:"synopsis", label:"Synopsis" },
];
/* the LOGLINE CHECK's words (2026-10-02, owner-approved): what the writer's own logline doesn't
   name yet — it only advises, never blocks */
const NS_CHECK_PARTS = { protagonist:"one protagonist the story follows", want:"what they want", obstacle:"what stands in their way" };
function nsLoglineCheckText(missing){
  const parts = (missing||[]).map(k=>NS_CHECK_PARTS[k]).filter(Boolean);
  if(!parts.length) return "";
  const list = parts.length===1 ? parts[0] : parts.slice(0,-1).join(", ")+" or "+parts[parts.length-1];
  return "Your logline doesn\u2019t yet name "+list+". The spine builds best from one protagonist with a clear want and something in their way \u2014 the sharpened versions below each have all three. You can still build from yours.";
}
window.nsLoglineCheckText = nsLoglineCheckText;
const nsNorm = (s)=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

// ⌘/Ctrl+Enter (and plain Enter on single-line inputs) advances the flow
const onCmdEnter = (fn, plainToo)=> (e)=>{
  if(e.key==="Enter" && (e.metaKey || e.ctrlKey || (plainToo && !e.shiftKey))){
    e.preventDefault(); fn();
  }
};

/* ---- Voice adapter — the swappable speak()/listen() layer for "Talk it through".
   PREFERS ElevenLabs (TTS via window.elSpeak, STT via MediaRecorder → window.elTranscribe,
   both through the signed-in proxy) and FALLS BACK to the browser's free Web Speech API when
   the proxy isn't available. The interview/logline logic above is untouched: it still just
   calls speak()/listen(). ElevenLabs STT has no live interim transcript and is tap-to-stop
   (record until the user clicks the mic again), unlike Web Speech's auto-stop on a pause.
   FREE-TIER ACCOUNTS (repair 2026-09-30): the paid voice is Writer-and-up (the server refuses it
   for a trial or no-plan account), so a free-tier account (window.turnOnFreeTier()) always uses
   the browser's own speech — the paid voice service is never called for it. If the paid voice is
   refused anyway (a ledger that hadn't loaded yet, a plan that just ended), the interview calls
   are QUIET (no Plans window, app/voicegen.jsx) and the adapter switches to the browser's speech
   for the rest of the page session. Writer and up keep the paid voice, which uses credits —
   NSLegacyInterview says so once, next to the voice toggle.
   A RECORDING THE SERVER CAN'T TAKE (billing round 5): transcription is charged by the recording's
   own length, read from the file before anything is held, so the server refuses (400, a plain
   sentence) a recording it can't read or one longer than the longest answer this adapter records.
   That refusal is quiet too: the browser's speech recognition listens from the next tap on (the
   paid voice keeps speaking). A spoken answer records for NS_MAX_ANSWER_SECONDS at most, then stops
   by itself and is transcribed as if the mic had been tapped. ---- */
/* the longest spoken answer the interview records (billing round 5) — image-proxy refuses a
   recording longer than its own limit, which must stay above this */
const NS_MAX_ANSWER_SECONDS = 300;
window.NS_MAX_ANSWER_SECONDS = NS_MAX_ANSWER_SECONDS;
const Voice = (()=>{
  const SR = (typeof window!=="undefined") && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const synth = (typeof window!=="undefined") && window.speechSynthesis;
  const mediaOk = (typeof navigator!=="undefined") && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && (typeof window!=="undefined") && window.MediaRecorder;
  let paidRefused = false;   // a billing refusal this page session: browser speech from now on
  let sttRefused = false;    // a recording refused as it stands (400): the browser listens from now on
  const freeTier = ()=>{ try{ return typeof window.turnOnFreeTier==="function" && !!window.turnOnFreeTier(); }catch(e){ return false; } };
  const elReady = ()=> (typeof window!=="undefined") && !paidRefused && !freeTier()
    && typeof window.voiceProxyReady==="function" && window.voiceProxyReady()
    && typeof window.elSpeak==="function" && typeof window.elTranscribe==="function";
  let rec = null, mr = null, mrStream = null, currentAudio = null, speakSeq = 0, mrTimer = null;
  const paidListen = ()=> elReady() && !!mediaOk && !sttRefused;
  const clearMrTimer = ()=>{ if(mrTimer){ try{ clearTimeout(mrTimer); }catch(e){} mrTimer = null; } };
  const pickRecMime = ()=>{
    const want = ["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus","audio/ogg"];
    for(const m of want){ try{ if(window.MediaRecorder.isTypeSupported(m)) return m; }catch(e){} }
    return "";
  };
  const blobToB64 = (blob)=> new Promise((res,rej)=>{ const fr=new FileReader();
    fr.onload=()=>{ const s=String(fr.result||""); res(s.slice(s.indexOf(",")+1)); }; fr.onerror=()=>rej(fr.error); fr.readAsDataURL(blob); });
  const synthSpeak = (text, onend)=>{
    if(!synth){ onend&&onend(); return; }
    try{ synth.cancel(); const u=new SpeechSynthesisUtterance(String(text||"")); u.rate=1.03; u.pitch=1;
      u.onend=()=>onend&&onend(); u.onerror=()=>onend&&onend(); synth.speak(u); }catch(e){ onend&&onend(); }
  };
  return {
    // capability is dynamic: ElevenLabs (proxy + mic) OR the browser fallback
    get sttSupported(){ return paidListen() || !!SR; },
    // spoken answers were refused by the server and this browser has no speech recognition to fall back on
    get spokenRefused(){ return (sttRefused || paidRefused) && !SR; },
    get ttsSupported(){ return elReady() || !!synth; },
    // true while the interview uses the paid voice (it uses credits); false = the browser's speech
    get paidVoice(){ return elReady(); },
    async speak(text, onend){
      this.stopSpeaking();   // cancel anything playing (bumps speakSeq)
      const seq = speakSeq;  // this call now owns the latest generation
      if(elReady()){
        let url=""; try{ url = await window.elSpeak(text); }catch(e){ if(e && e.billing) paidRefused = true; }
        if(seq!==speakSeq) return;                 // superseded or stopped while fetching
        if(url){
          try{
            const a = new Audio(url); currentAudio = a;
            a.onended = a.onerror = ()=>{ if(currentAudio===a) currentAudio=null; onend&&onend(); };
            await a.play();
            return;
          }catch(e){ if(seq!==speakSeq) return; /* autoplay/format blocked → fall back */ }
        }
      }
      if(seq!==speakSeq) return;
      synthSpeak(text, onend);
    },
    stopSpeaking(){ speakSeq++; try{ if(currentAudio){ currentAudio.pause(); currentAudio=null; } }catch(e){} try{ synth && synth.cancel(); }catch(e){} },
    // begin a single listening turn; callbacks deliver partial (Web Speech only) + final transcripts
    listen({ onInterim, onFinal, onError }){
      if(paidListen()){
        navigator.mediaDevices.getUserMedia({ audio:true }).then(stream=>{
          mrStream = stream;
          try{
            const mime = pickRecMime();
            const chunks = [];
            mr = new MediaRecorder(stream, mime?{ mimeType:mime }:undefined);
            mr.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };
            mr.onstop = async ()=>{
              clearMrTimer();
              try{ mrStream && mrStream.getTracks().forEach(t=>t.stop()); }catch(e){} mrStream=null;
              const type = (mr && mr.mimeType) || mime || "audio/webm";
              const blob = new Blob(chunks, { type });
              if(!blob.size){ onFinal && onFinal(""); return; }
              try{
                const b64 = await blobToB64(blob);
                const text = await window.elTranscribe(b64, type.split(";")[0]);
                onFinal && onFinal(text||"");
              }catch(e){
                // a recording the server can't take (400: unreadable, or too long): the browser
                // listens from the next tap on, quietly — the paid voice keeps speaking (round 5)
                if(e && Number(e.status)===400){ sttRefused = true; onError && onError(SR ? "switched-to-browser" : "stt-refused"); }
                // refused for billing: the browser listens from the next tap on (no Plans window)
                else if(e && e.billing){ paidRefused = true; onError && onError(SR ? "switched-to-browser" : "stt-refused"); }
                else onError && onError("stt-failed");
              }
            };
            mr.start();
            // the longest answer it records: stop by itself and transcribe what was said (round 5)
            const thisMr = mr;
            clearMrTimer();
            mrTimer = setTimeout(()=>{ mrTimer = null; try{ if(thisMr && thisMr.state==="recording") thisMr.stop(); }catch(e){} }, NS_MAX_ANSWER_SECONDS*1000);
          }catch(e){ try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){} onError && onError(String(e)); }
        }).catch(err=>{ onError && onError(err && (err.name==="NotAllowedError"||err.name==="SecurityError") ? "not-allowed" : "error"); });
        return;
      }
      // Web Speech fallback
      if(!SR){ onError&&onError("unsupported"); return; }
      try{
        rec = new SR();
        rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
        let finalText = "";
        rec.onresult = (e)=>{
          let interim = "";
          for(let i=e.resultIndex; i<e.results.length; i++){
            const r = e.results[i];
            if(r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
          }
          onInterim && onInterim((finalText+" "+interim).trim());
        };
        rec.onerror = (e)=>onError&&onError((e&&e.error)||"error");
        rec.onend = ()=>{ onFinal && onFinal(finalText.trim()); };
        rec.start();
      }catch(e){ onError&&onError(String(e)); }
    },
    stopListening(){
      clearMrTimer();
      try{ if(mr && mr.state!=="inactive"){ mr.stop(); mr=null; return; } }catch(e){}
      try{ if(mrStream){ mrStream.getTracks().forEach(t=>t.stop()); mrStream=null; } }catch(e){}
      try{ rec && rec.stop(); }catch(e){}
    },
  };
})();

/* the once-per-account line for the paid interview voice (Writer and up) */
const NS_PAID_VOICE_NOTE = "Frances’s voice uses a few credits a line here, and so do spoken answers. Turn Voice off, or type, to save them.";
window.NS_PAID_VOICE_NOTE = NS_PAID_VOICE_NOTE;
function nsVoiceNoteKey(){ return "turn-interview-voice-note:"+String(window.turnUserId||window.turnUserEmail||"local"); }

/* Recovery interview for browsers/environments where GPT-Live cannot open. It
   retains the previous turn-by-turn TTS/STT + typed conversation (the same Frances voice). */
function NSLegacyInterview({ formatLabel, onComplete, onBack, liveNotice }){
  const [chat, setChat] = React.useState([]);     // [{role:'assistant'|'user', content}]
  const [thinking, setThinking] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [voiceOn, setVoiceOn] = React.useState(true);
  const [err, setErr] = React.useState("");
  const voiceOnRef = React.useRef(voiceOn); voiceOnRef.current = voiceOn;
  // a Writer-and-up account hears the paid voice, which uses credits: said ONCE per account, next to
  // the voice toggle (repair 2026-09-30); free-tier accounts use the browser's own speech (free)
  const [voiceCostNote] = React.useState(()=>{
    if(!Voice.paidVoice || window.turnIsAdmin) return false;
    try{ return !localStorage.getItem(nsVoiceNoteKey()); }catch(e){ return true; }
  });
  React.useEffect(()=>{ if(voiceCostNote){ try{ localStorage.setItem(nsVoiceNoteKey(), "1"); }catch(e){} } },[voiceCostNote]);
  const scrollRef = React.useRef(null);
  const hErr = (e)=>String((e&&e.message)||"Something went wrong — try again.");
  const say = (t)=>{ if(voiceOnRef.current) Voice.speak(t); };

  // greet + first question on mount
  React.useEffect(()=>{ let alive=true;
    (async()=>{
      setThinking(true);
      try{
        const r = await aiSeedInterview([], formatLabel);
        if(alive && r){ setChat([{role:"assistant",content:r.say}]); say(r.say); }
      }catch(e){ if(alive) setErr(hErr(e)); }
      if(alive) setThinking(false);
    })();
    return ()=>{ alive=false; Voice.stopSpeaking(); Voice.stopListening(); };
  // eslint-disable-next-line
  },[]);

  React.useEffect(()=>{ const el=scrollRef.current; if(el) el.scrollTop=el.scrollHeight; },[chat,interim,thinking]);

  const send = async (raw)=>{
    const t = String(raw||"").trim();
    if(!t || thinking) return;
    Voice.stopSpeaking();
    const next = [...chat, {role:"user", content:t}];
    setChat(next); setTyped(""); setInterim(""); setErr(""); setThinking(true);
    try{
      const r = await aiSeedInterview(next, formatLabel);
      if(!r){ setErr("I didn’t catch that — try again."); setThinking(false); return; }
      setChat(c=>[...c, {role:"assistant", content:r.say}]);
      say(r.say);
      if(r.done && r.loglines && r.loglines.length){
        setThinking(false);
        const transcript=[...next,{role:"assistant",content:r.say}]
          .map(m=>(m.role==="user"?"WRITER: ":"FRANCES: ")+m.content).join("\n");
        onComplete(r.loglines,transcript);   // hand off to Step 3 (loglines)
        return;
      }
    }catch(e){ setErr(hErr(e)); }
    setThinking(false);
  };

  const toggleMic = ()=>{
    if(listening){ Voice.stopListening(); setListening(false); return; }
    if(!Voice.sttSupported){ setErr("Voice input isn’t supported in this browser — type your answer instead."); return; }
    Voice.stopSpeaking();
    setErr(""); setInterim(""); setListening(true);
    Voice.listen({
      onInterim:(tx)=>setInterim(tx),
      onFinal:(tx)=>{ setListening(false); if(tx) send(tx); else setInterim(""); },
      onError:(er)=>{ setListening(false);
        setErr(er==="not-allowed"||er==="service-not-allowed" ? "Mic access was blocked — type your answer instead."
          : er==="unsupported" ? "Voice input isn’t supported here — type your answer instead."
          : er==="switched-to-browser" ? "Your browser will listen from now on — tap the mic and answer again, or type it."
          : er==="stt-refused" ? "Spoken answers aren’t available here any more — type your answer."
          : "Didn’t catch that — try again, or type it."); },
    });
  };

  return React.createElement("div",{className:"ns-body ns-talk"},
    React.createElement("div",{className:"ns-talk-head"},
      React.createElement("div",{className:"ns-talk-status"},
        React.createElement("span",{className:"ns-talk-orb"+(thinking?" think":listening?" live":"")}),
        thinking ? "Thinking…" : listening ? "Listening…" : "Let’s find your story"),
      Voice.ttsSupported && React.createElement("button",{className:"ns-talk-mute",onClick:()=>{ if(voiceOn) Voice.stopSpeaking(); setVoiceOn(v=>!v); },
        title:voiceOn?"Mute voice":"Unmute voice"},
        React.createElement(Icon[voiceOn?"sparkles":"x"]||Icon.sparkles,{s:12}), voiceOn?"Voice on":"Voice off")),

    voiceCostNote && React.createElement("div",{className:"ns-talk-note ns-voice-cost",role:"note"},
      React.createElement(Icon.sparkles,{s:14}),
      React.createElement("span",null,NS_PAID_VOICE_NOTE)),

    liveNotice && React.createElement("div",{className:"ns-talk-note"},
      React.createElement(Icon.alert,{s:14}),
      React.createElement("span",null,liveNotice," You can continue with the typed interview here.")),

    // tell the user plainly when their browser can't do spoken answers
    !Voice.sttSupported && Voice.spokenRefused && React.createElement("div",{className:"ns-talk-note"},
      React.createElement(Icon.alert,{s:14}),
      React.createElement("span",null,"Spoken answers are off for the rest of this visit — type your replies below; it's the same conversation.")),
    !Voice.sttSupported && !Voice.spokenRefused && React.createElement("div",{className:"ns-talk-note"},
      React.createElement(Icon.alert,{s:14}),
      React.createElement("span",null,
        React.createElement("b",null,"Voice answers need Chrome or Edge."),
        " In this browser, just type your replies below — it's the same conversation. Open Kinolot in Chrome to talk it through out loud.")),

    React.createElement("div",{className:"ns-talk-thread",ref:scrollRef},
      chat.map((m,i)=>React.createElement("div",{key:i,className:"ns-talk-msg "+m.role},
        React.createElement("div",{className:"ns-talk-bubble"},m.content))),
      (listening && interim) && React.createElement("div",{className:"ns-talk-msg user pending"},
        React.createElement("div",{className:"ns-talk-bubble"},interim)),
      thinking && React.createElement("div",{className:"ns-talk-msg assistant"},
        React.createElement("div",{className:"ns-talk-bubble"},
          React.createElement("span",{className:"ns-talk-dots"},
            React.createElement("i"),React.createElement("i"),React.createElement("i"))))),

    err && React.createElement("div",{className:"ns-err"},(window.turnLinkifyReact?window.turnLinkifyReact(err):err)),

    React.createElement("div",{className:"ns-talk-input"},
      Voice.sttSupported && React.createElement("button",{className:"ns-mic"+(listening?" on":""),onClick:toggleMic,disabled:thinking,
        title:listening?"Stop":"Speak your answer"},
        React.createElement(Icon.mic,{s:18})),
      React.createElement("input",{className:"ns-input ns-talk-type",value:typed,
        placeholder:Voice.sttSupported?"…or type your answer":"Type your answer",
        onChange:e=>setTyped(e.target.value),onKeyDown:onCmdEnter(()=>send(typed),true),disabled:thinking,autoFocus:!Voice.sttSupported}),
      React.createElement("button",{className:"ns-btn primary",onClick:()=>send(typed),disabled:thinking||!typed.trim()},"Send")),

    React.createElement("div",{className:"ns-foot"},
      React.createElement("button",{className:"ns-btn ghost",onClick:()=>{ Voice.stopSpeaking(); Voice.stopListening(); onBack(); }},"← Back")));
}

/* Each fragment carries the conversation it came from (`attempt`: "Start another conversation"
   opens a NEW session whose clock restarts at 0). A fragment from another conversation always
   starts a new row — Frances's greeting in the new session is never glued into her last bubble
   from the earlier one (repair round 2). */
function nsLiveRows(fragments){
  const rows=[];
  (fragments||[]).forEach(f=>{
    if(!f || !String(f.delta||"")) return;
    const last=rows[rows.length-1];
    const attempt=Number(f.attempt)||0;
    const closeEnough=last && last.role===f.role && last.attempt===attempt
      && (!last.endMs || !f.startMs || f.startMs-last.endMs<1400);
    if(closeEnough){ last.content+=String(f.delta); last.endMs=f.endMs||last.endMs; }
    else rows.push({role:f.role,content:String(f.delta),startMs:f.startMs||0,endMs:f.endMs||0,attempt});
  });
  return rows.filter(r=>r.content.trim());
}

/* The primary "Talk it through" experience: one continuous, interruptible Frances
   conversation over WebRTC. Transcript fragments remain UI/state data; choosing
   Finish explicitly shapes them into candidate loglines through the normal next
   pipeline step. */
function NSLiveInterview({ formatLabel, onComplete, onBack, onUseFallback }){
  const [fragments,setFragments]=React.useState([]);
  const [status,setStatus]=React.useState("connecting");
  const [err,setErr]=React.useState("");
  const [finalizing,setFinalizing]=React.useState(false);
  const [muted,setMuted]=React.useState(false);
  const [playbackBlocked,setPlaybackBlocked]=React.useState(false);
  const [attempt,setAttempt]=React.useState(0);
  // the session reached its 15 minutes and ended itself (app/livevoice.js): Frances's line, and the
  // choice to finish or start another conversation (which uses another of the day's questions)
  const [timeUp,setTimeUp]=React.useState("");
  const sessionRef=React.useRef(null);
  const scrollRef=React.useRef(null);
  const rows=nsLiveRows(fragments);
  const hasWriter=fragments.some(f=>f.role==="user" && String(f.delta||"").trim());

  React.useEffect(()=>{ let alive=true;
    setStatus("connecting"); setErr(""); setMuted(false); setPlaybackBlocked(false); setTimeUp("");
    (async()=>{
      try{
        const session=await window.turnStartLiveVoice({
          mode:"new-story",context:{formatLabel},
          onTranscript:fragment=>{ if(alive) setFragments(prev=>[...prev,{ ...fragment, attempt }]); },
          onStatus:next=>{ if(alive) setStatus(next); },
          onError:message=>{ if(alive) setErr(String(message||"The live conversation hit an audio error.")); },
          onPlaybackBlocked:()=>{ if(alive) setPlaybackBlocked(true); },
          onTimeLimit:message=>{ if(alive){ sessionRef.current=null; setTimeUp(String(message||"This conversation with Frances has ended.")); } },
        });
        if(!alive){ session.close({timeoutMs:700}); return; }
        sessionRef.current=session;
      }catch(e){
        if(alive){ setStatus("failed"); setErr(String((e&&e.message)||"Couldn’t start live voice.")); }
      }
    })();
    return ()=>{ alive=false; const session=sessionRef.current; sessionRef.current=null;
      if(session) session.close({timeoutMs:700}); };
  },[formatLabel,attempt]);

  React.useEffect(()=>{ const el=scrollRef.current; if(el) el.scrollTop=el.scrollHeight; },[fragments,status]);

  const closeAnd=(fn)=>{ const session=sessionRef.current; sessionRef.current=null;
    Promise.resolve(session&&session.close({timeoutMs:1400})).finally(fn); };
  const retry=()=>{ const session=sessionRef.current; sessionRef.current=null;
    Promise.resolve(session&&session.close({timeoutMs:700})).finally(()=>{ setFragments([]); setAttempt(n=>n+1); }); };
  // after the 15-minute end: a NEW conversation, keeping what was already said for the loglines
  const another=()=>{ setTimeUp(""); setErr(""); setAttempt(n=>n+1); };
  const toggleMute=()=>{ const session=sessionRef.current; if(!session) return;
    const next=session.mute(); setMuted(next); };
  const hear=async()=>{ try{ const session=sessionRef.current; if(session){ await session.play(); setPlaybackBlocked(false); } }
    catch(_e){ setErr("Your browser is blocking Frances’s voice. Allow sound for this page, then try again."); } };
  const finish=async()=>{
    if(finalizing) return;
    if(!hasWriter){ setErr("Tell Frances a little about the story before shaping the loglines."); return; }
    setFinalizing(true); setErr(""); setStatus("closing");
    const transcript=rows.map(r=>(r.role==="user"?"WRITER: ":"FRANCES: ")+r.content.trim()).join("\n");
    try{
      const session=sessionRef.current; sessionRef.current=null;
      if(session) await session.close({timeoutMs:2500});
      setStatus("shaping");
      const lls=typeof aiSeedToLoglines==="function" ? await aiSeedToLoglines("talk",transcript) : null;
      if(!lls || !lls.length) throw new Error("That conversation couldn’t be shaped into loglines yet — try Finish again, or continue with the typed interview.");
      onComplete(lls,transcript);
    }catch(e){ setErr(String((e&&e.message)||"Couldn’t shape the conversation into loglines.")); setStatus("ended"); setFinalizing(false); }
  };
  const statusText=finalizing || status==="shaping" ? "Shaping your loglines…"
    : timeUp ? "Conversation ended"
    : status==="connecting" ? "Connecting to Frances…"
    : status==="speaking" ? "Frances is speaking…"
    : status==="muted" || muted ? "Mic is off"
    : status==="failed" ? "Live voice unavailable"
    : status==="ended" || status==="closed" ? "Conversation ended"
    : "Frances is listening…";
  const orbClass=(status==="connecting"||finalizing||status==="shaping")?" think"
    :(status==="listening"||status==="speaking")?" live":"";

  return React.createElement("div",{className:"ns-body ns-talk ns-live"},
    React.createElement("div",{className:"ns-talk-head"},
      React.createElement("div",{className:"ns-talk-status"},
        React.createElement("span",{className:"ns-talk-orb"+orbClass}),statusText),
      React.createElement("button",{className:"ns-talk-mute"+(muted?" off":""),onClick:toggleMute,
        disabled:!sessionRef.current||finalizing,title:muted?"Turn microphone on":"Turn microphone off"},
        React.createElement(Icon[muted?"x":"mic"]||Icon.mic,{s:12}),muted?"Mic off":"Mic on")),

    React.createElement("div",{className:"ns-talk-note ns-live-note"},
      React.createElement(Icon.mic,{s:14}),
      React.createElement("span",null,"Speak naturally — Frances will respond aloud, and you can interrupt as you would in a real conversation. When the idea is clear, finish to shape the transcript into loglines.")),

    React.createElement("div",{className:"ns-talk-thread",ref:scrollRef},
      rows.length===0 && React.createElement("div",{className:"ns-talk-empty"},
        status==="failed"?"The live session didn’t open.":"Frances will begin in a moment…"),
      rows.map((m,i)=>React.createElement(React.Fragment,{key:i},
        i>0 && rows[i-1].attempt!==m.attempt && React.createElement("div",{className:"ns-live-newconv",role:"separator"},"New conversation"),
        React.createElement("div",{className:"ns-talk-msg "+m.role},
          React.createElement("div",{className:"ns-talk-bubble"},m.content.trim()))))),

    timeUp && React.createElement("div",{className:"ns-talk-note ns-live-timeup",role:"status"},
      React.createElement(Icon.mic,{s:14}),
      React.createElement("span",null,timeUp)),
    playbackBlocked && React.createElement("div",{className:"ns-talk-note"},
      React.createElement(Icon.alert,{s:14}),
      React.createElement("span",null,"Your browser paused Frances’s voice."),
      React.createElement("button",{className:"ns-btn ghost ns-hear",onClick:hear},"Hear Frances")),
    err && React.createElement("div",{className:"ns-err"},(window.turnLinkifyReact?window.turnLinkifyReact(err):err)),

    React.createElement("div",{className:"ns-foot ns-live-foot"},
      React.createElement("button",{className:"ns-btn ghost",disabled:finalizing,onClick:()=>closeAnd(onBack)},"← Back"),
      React.createElement("button",{className:"ns-btn link",disabled:finalizing,onClick:()=>closeAnd(onUseFallback)},"Use typed interview"),
      status==="failed" && !timeUp && React.createElement("button",{className:"ns-btn ghost",disabled:finalizing,onClick:retry},"Try live again"),
      timeUp && React.createElement("button",{className:"ns-btn ghost",disabled:finalizing,onClick:another},"Start another conversation"),
      React.createElement("button",{className:"ns-btn primary",disabled:finalizing||!hasWriter,onClick:finish},
        finalizing?React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin"}),"Shaping…")
          :React.createElement(React.Fragment,null,React.createElement(Icon.sparkles,{s:14}),"Finish & shape loglines"))));
}

function NSInterview(props){
  const support=(typeof window.turnLiveVoiceSupport==="function")
    ? window.turnLiveVoiceSupport()
    : {ok:false,reason:"The live-voice module isn’t loaded."};
  const [useFallback,setUseFallback]=React.useState(!support.ok);
  if(useFallback) return React.createElement(NSLegacyInterview,{...props,liveNotice:support.ok?"Live voice was closed.":support.reason});
  return React.createElement(NSLiveInterview,{...props,onUseFallback:()=>setUseFallback(true)});
}

function NewStoryIntake({ onClose, onLaunch, aiOn, initialFormat, formatLocked, formatOwnerLabel, onImportScript, initialSeedText }){
  const seedTypes = (typeof onImportScript==="function") ? SEED_TYPES.concat([SEED_SCRIPT]) : SEED_TYPES;
  // the writing model developing THIS story — synced with the global drafting picker,
  // so loglines, research, synopsis and the spine build all run on the picked engine
  const [mid, setMid] = React.useState(()=> (typeof window.getWritingModelId==="function") ? window.getWritingModelId("story") : "");
  const pickModel = (id)=>{ setMid(id); if(typeof window.setWritingModelId==="function") window.setWritingModelId(id); };
  // follow a change made in the Writing dock while this window is open
  React.useEffect(()=>{
    const h = ()=>{ if(typeof window.getWritingModelId==="function") setMid(window.getWritingModelId("story")); };
    window.addEventListener("turn-writing-model-changed", h);
    return ()=>window.removeEventListener("turn-writing-model-changed", h);
  },[]);
  const _rec = (window.recommendedWritingModelId && window.recommendedWritingModelId("story")) || "";
  const _initialFormat = ((window.FORMATS||[]).some(f=>f.id===initialFormat) ? initialFormat : "film");
  const [format, setFormat] = React.useState(_initialFormat);   // Step 0 — what are we making?
  const [framework, setFramework] = React.useState("threeact");   // Step 0 — how is it told?
  // did the writer ACTIVELY pick these, or sail past the defaults? An explicit pick is
  // never overridden; untouched knobs get the AI's recommended shape at develop time.
  const [formatTouched, setFormatTouched] = React.useState(false);
  const [frameworkTouched, setFrameworkTouched] = React.useState(false);
  const [autoShape, setAutoShape] = React.useState(null);   // {formatLabel?, frameworkLabel?, why} — shown on the logline step
  const [seed, setSeed] = React.useState("logline");
  // a prose text from Import your script arrives as the seed (2026-10-18) — the writer develops it from here
  const [text, setText] = React.useState(()=> String(initialSeedText||""));
  const [step, setStep] = React.useState("seed");  // seed | interview | format(=shape) | loglines | research | synopsis
  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState([]);
  const [chosen, setChosen] = React.useState("");
  const [err, setErr] = React.useState("");
  // while this window is open, provider ERROR toasts land in ITS error line
  // (links clickable) instead of a detached corner toast
  React.useEffect(()=>{
    const prev = window.turnErrorSink;
    window.turnErrorSink = (msg)=>{ setErr(msg); return true; };
    return ()=>{ window.turnErrorSink = prev; };
  },[]);
  // synopsis stage
  const [syn, setSyn] = React.useState(null);        // full research+synopsis object
  const [title, setTitle] = React.useState("");      // editable work-title (seeds from research)
  const [synLoading, setSynLoading] = React.useState(false);
  // the synopsis paragraphs take the FRAMEWORK's shape (3 for three-act/journey,
  // 4 for kishōtenketsu/circle) — editable [{key,label,text}]
  const [paras, setParas] = React.useState([]);
  const [showResearch, setShowResearch] = React.useState(false);
  // RESEARCH, ITS OWN MOMENT (2026-10-02, owner-approved): gathered for one logline, read and
  // edited (or re-researched with a steer) before the synopsis is written FROM it
  const [research, setResearch] = React.useState(null);   // { memory, imagination, fact:{ world, roles[] }, sources, grounded }
  const [researchFor, setResearchFor] = React.useState(""); // seed, logline and shape it was gathered for
  const [researchLoading, setResearchLoading] = React.useState(false);
  const [researchEdited, setResearchEdited] = React.useState(false);
  const [steer, setSteer] = React.useState("");
  const [synFrom, setSynFrom] = React.useState("");       // the research the synopsis was written from
  const [loglineCheck, setLoglineCheck] = React.useState(null);   // { missing:[...] } for the writer's own logline
  // The auto-shape's setFramework/setFormat land a render AFTER develop() runs; mirror
  // them into refs so researchSynopsis always reads the APPLIED shape (never a stale
  // closure that would silently fall back to the default three-act synopsis).
  const frameworkRef = React.useRef(framework); frameworkRef.current = framework;
  const formatRef = React.useRef(format); formatRef.current = format;
  const cfg = seedTypes.find(s=>s.id===seed) || SEED_TYPES[0];
  const needsText = seed !== "talk" && seed !== "script";
  const formatLabel = (((window.FORMATS||[]).find(f=>f.id===format)||{}).label || "film").toLowerCase();
  const liveSeedSupport = (typeof window.turnLiveVoiceSupport==="function")
    ? window.turnLiveVoiceSupport() : {ok:false};

  const applyRecommendedShape = (outs)=>{
    const sh=outs && outs.shape;
    if(sh){
      const applied={};
      if(sh.format && !formatLocked && !formatTouched && sh.format!==format){ setFormat(sh.format);
        applied.formatLabel=(((window.FORMATS||[]).find(f=>f.id===sh.format))||{}).label||sh.format; }
      if(sh.framework && !frameworkTouched && sh.framework!==framework){ setFramework(sh.framework);
        applied.frameworkLabel=(((window.FRAMEWORKS||[]).find(f=>f.id===sh.framework))||{}).label||sh.framework; }
      setAutoShape((applied.formatLabel||applied.frameworkLabel)?{...applied,why:sh.why||""}:null);
    }else setAutoShape(null);
  };

  const develop = async (dest)=>{
    if(loading) return;
    if(needsText && !text.trim()){ setErr("Add a little more to work from."); return; }
    setErr(""); setLoading(true);
    try{
      const outs = (typeof aiSeedToLoglines==="function") ? await aiSeedToLoglines(seed, text) : null;
      if(outs && outs.length){
        // the writer's own LOGLINE seed is candidate #1, verbatim and pre-selected \u2014
        // the sharpened variants are optional, never the default (their words win)
        const mine = seed==="logline" ? text.trim() : "";
        const norm = (s)=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
        const cands = mine ? [mine, ...outs.filter(o=>norm(o)!==norm(mine))] : outs.slice();
        setCandidates(cands); setChosen(cands[0]);
        setLoglineCheck(mine && outs.check && Array.isArray(outs.check.missing) && outs.check.missing.length ? { text:mine, missing:outs.check.missing } : null);
        // AUTO-SHAPE: apply the recommended format/framework to any knob the writer
        // didn't actively pick \u2014 an explicit Step-1 choice always wins
        applyRecommendedShape(outs);
        setStep(dest==="loglines" ? "loglines" : "format");   // first pass confirms the SHAPE; regenerate stays put
      }
      else setErr("Couldn\u2019t shape that into a logline \u2014 try adding a detail or two.");
    }catch(e){ setErr(String((e&&e.message)||"Something went wrong. Try again.")); }
    setLoading(false);
  };

  const askFirst = async (title, body, confirmLabel)=>{
    if(typeof window.appConfirm!=="function") return true;
    return !!(await window.appConfirm({ title, body, confirmLabel }));
  };
  const intakeKey = ()=>JSON.stringify({ logline:(chosen||"").trim(), seed:text.trim(),
    format:formatRef.current, framework:frameworkRef.current });
  // Research is reusable only for the same seed, logline, format and framework.
  const runResearch = async (again)=>{
    if(researchLoading || synLoading) return;
    const l=(chosen||"").trim();
    if(!l){ setErr("Choose a logline first."); return; }
    const inputKey = intakeKey();
    if(!again && research && researchFor===inputKey){ setErr(""); setStep("research"); return; }
    if(research && researchEdited && !(await askFirst("Research again?",
      "A new research replaces your edits to this one.", "Research again"))) return;
    setErr(""); setResearchLoading(true);
    try{
      const r = (typeof aiResearch==="function") ? await aiResearch(l, text, frameworkRef.current, formatRef.current, again ? steer : "") : null;
      if(r && r.research){
        const fresh = researchFor!==inputKey;
        setResearch(r.research); setResearchFor(inputKey); setResearchEdited(false);
        if(fresh){ setSyn(null); setParas([]); setSynFrom(""); setTitle(r.title||""); }
        else if(!title) setTitle(r.title||"");
        setStep("research");
      } else setErr("Couldn\u2019t research that logline \u2014 try again, or tweak the logline.");
    }catch(e){ setErr(String((e&&e.message)||"Something went wrong. Try again.")); }
    setResearchLoading(false);
  };
  const editResearch = (fn)=>{ setResearch(r=>{ const n = JSON.parse(JSON.stringify(r||{})); fn(n); return n; }); setResearchEdited(true); };
  const researchKey = JSON.stringify({ input:intakeKey(), research:research||null });
  // write (or rewrite) the synopsis FROM the research as it stands now
  const writeSynopsis = async ()=>{
    if(synLoading || researchLoading) return;
    const l=(chosen||"").trim();
    if(!l || !research){ setErr("Research the logline first."); return; }
    if(researchFor!==intakeKey()){
      setErr("The seed or story shape changed \u2014 research it again before writing the synopsis."); setStep("loglines"); return;
    }
    if(paras.length && !(await askFirst("Rewrite the synopsis from the research?",
      "It replaces the paragraphs below, including your edits to them.", "Rewrite synopsis"))) return;
    setErr(""); setSynLoading(true);
    try{
      const s = (typeof aiSynopsisFromResearch==="function") ? await aiSynopsisFromResearch(l, text, frameworkRef.current, formatRef.current, research) : null;
      if(s && Array.isArray(s.paras) && s.paras.length){
        setParas(s.paras.map(pg=>({ ...pg, text: pg.text||"" })));
        setSyn({ title: title || "" }); setSynFrom(researchKey);
        setStep("synopsis");
      } else setErr("Couldn\u2019t write a synopsis from that research \u2014 try again.");
    }catch(e){ setErr(String((e&&e.message)||"Something went wrong. Try again.")); }
    setSynLoading(false);
  };

  // Research → Synopsis is mandatory (it's what makes the build specific), so the
  // spine always builds FROM the reviewed synopsis — there is no logline-only path.
  const build = ()=>{
    const l=(chosen||"").trim(); if(!l || !syn) return;
    if(researchFor!==intakeKey()){
      setErr("The seed or story shape changed \u2014 research it again before building."); setStep("loglines"); return;
    }
    const edited = paras.map(pg=>({ ...pg, text:(pg.text||"").trim() }));
    const synopsis = { paras: edited };
    edited.forEach(pg=>{ synopsis[pg.key] = pg.text; });
    const kept = research ? { ...((typeof normaliseResearch==="function") ? normaliseResearch(research) : research),
      sources: research.sources || [], grounded: !!research.grounded, ...(researchEdited ? { edited:true } : {}) } : null;
    const synOut = { title:(title||"").trim()||(syn&&syn.title)||"", synopsis, ...(kept ? { research:kept } : {}) };
    onLaunch(l, synOut, formatLocked ? _initialFormat : format, framework);
  };

  const pillar = (label, body)=> body ? React.createElement("div",{className:"syn-pillar"},
    React.createElement("div",{className:"syn-pillar-lab"},label),
    React.createElement("div",{className:"syn-pillar-tx"},body)) : null;

  const fact = (research && research.fact) || {};
  const roles = Array.isArray(fact.roles) && fact.roles.length ? fact.roles : ((fact.role||fact.whatHappens) ? [fact] : []);
  const factSources = (research && research.grounded && Array.isArray(research.sources)) ? research.sources : [];
  const LENS_KEYS = [["whatHappens","What happens"],["howItFeels","How it feels"],["frustrating","Frustrating"],["lovely","Lovely"]];
  const synStale = !!(paras.length && synFrom && synFrom!==researchKey);
  // where the facts come from: the pages a web-grounded Fact pillar used, or a plain note
  const sourcesBlock = ()=> factSources.length
    ? React.createElement("div",{className:"syn-sources"},
        React.createElement("div",{className:"syn-sources-k"},"Checked against the web \u00b7 sources"+(researchEdited?" \u00b7 edited by you since":"")),
        factSources.map((x,i)=>React.createElement("a",{key:i,className:"syn-source",href:x.url,target:"_blank",rel:"noopener noreferrer",title:x.url},
          React.createElement("span",{className:"syn-source-host"},x.host), x.title ? " \u2014 "+x.title : "")))
    : React.createElement("div",{className:"syn-sources-note"},
        "From general knowledge \u2014 not checked against the web. Verify real people, places and events before you rely on them.");
  const resField = (label, value, onChange, rows)=> React.createElement("label",{className:"res-field"},
    React.createElement("span",{className:"syn-pillar-lab"},label),
    React.createElement("textarea",{className:"ns-input res-input",value:value||"",rows:rows||2,onChange:e=>onChange(e.target.value)}));

  return React.createElement("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"ns-panel"},
      React.createElement("div",{className:"ns-head"},
        React.createElement("div",{className:"ns-head-t"},
          React.createElement("span",{className:"ns-orb"}),
          React.createElement("div",null,
            React.createElement("div",{className:"ns-title"},"New Story"),
            React.createElement("div",{className:"ns-sub"},
              step==="format"?"Confirm the shape \u2014 format & structure"
              :step==="seed"?"Bring your idea in whatever shape it\u2019s in"
              :step==="interview"?"Talk it through \u00b7 I\u2019ll listen and shape loglines"
              :step==="loglines"?"Pick the logline to build from"
              :step==="research"?"Research \u00b7 read it, edit it or steer it before the synopsis"
              :"Synopsis \u00b7 written from your research \u00b7 review before the spine builds"))),
        React.createElement("label",{className:"ns-model-badge",title:"The model that develops this story — loglines, research, synopsis and the spine build"},
          React.createElement(Icon.sparkles,{s:12}),
          React.createElement("select",{className:"ns-model-sel",value:mid,disabled:loading,
            onChange:(e)=>pickModel(e.target.value)},
            (window.WRITING_MODELS||[]).map(m=>React.createElement("option",{key:m.id,value:m.id,title:m.note||""},m.label + (m.id===_rec ? "  · recommended" : ""))))),
        React.createElement("button",{className:"ag-x",onClick:onClose,title:"Close","aria-label":"Close"},React.createElement(Icon.x,{s:16}))),

      // progress stepper — which of the four intake screens we're on
      // (the voice interview is a sub-mode of Seed, so it keeps Seed lit)
      (()=>{ const cur = NS_STEPS.findIndex(s=>s.id===(step==="interview"?"seed":step));
        return React.createElement("div",{className:"ns-steps"},
          NS_STEPS.map((s,i)=>React.createElement("div",{key:s.id,
            className:"ns-step "+(i<cur?"done":i===cur?"on":"todo")},
            React.createElement("span",{className:"ns-step-dot"}, i<cur?React.createElement(Icon.check,{s:12}):String(i+1)),
            React.createElement("span",{className:"ns-step-lab"},s.label)))); })(),

      !aiOn && React.createElement("div",{className:"ag-warn"},
        React.createElement(Icon.alert,{s:14}),"The model isn\u2019t available right now \u2014 idea development needs it."),

      step==="format"
        ? React.createElement("div",{className:"ns-body"},
            // the seed's recommendation, pre-applied to any knob the writer hasn't
            // touched — this screen CONFIRMS the shape rather than cold-asking for it
            autoShape && React.createElement("div",{className:"ns-autoshape"},
              React.createElement(Icon.sparkles,{s:12}),
              React.createElement("span",null,
                "Recommended for this story: ",
                React.createElement("b",null,[autoShape.formatLabel, autoShape.frameworkLabel].filter(Boolean).join(" · ")),
                autoShape.why ? (" — "+autoShape.why) : "",
                formatLocked
                  ? " The Show format stays fixed; you can still change the framework below."
                  : " Pick anything below to override — your choice always wins.")),
            formatLocked && React.createElement("div",{className:"ns-autoshape ns-format-locked"},
              React.createElement(Icon.layers||Icon.film,{s:12}),
              React.createElement("span",null,
                "Format inherited from ",React.createElement("b",null,formatOwnerLabel||"this Show"),
                ". Every episode shares one format; create a separate Show to use a different one.")),
            React.createElement("div",{className:"ns-seclab"},formatLocked
              ? "Show format — inherited by every episode"
              : "Pick a format — it sets the size, not the method; every format works with every structure"),
            // formats in their groups (Long form · Short form · Non-fiction & brand)
            ((typeof window.formatsForPicker==="function") ? window.formatsForPicker()
              : [{ id:"all", label:"", formats:(window.FORMATS||[]) }]).map(g=>
              React.createElement("div",{key:g.id,className:"ns-format-group"},
                g.label && React.createElement("div",{className:"ns-format-grouplab"},g.label),
                React.createElement("div",{className:"ns-formats"},
                  g.formats.map(f=>
                    React.createElement("button",{key:f.id,className:"ns-format "+(format===f.id?"on":""),
                      disabled:!!formatLocked,
                      title:formatLocked?("Inherited from "+(formatOwnerLabel||"this Show")):undefined,
                      onClick:()=>{ if(formatLocked) return; setFormat(f.id); setFormatTouched(true); }},
                      React.createElement(Icon[f.icon]||Icon.film,{s:16}),
                      React.createElement("span",{className:"ns-format-name"},f.label),
                      React.createElement("span",{className:"ns-format-blurb"},f.blurb)))))),
            React.createElement("div",{className:"ns-seclab",style:{marginTop:18}},"How should it be told?"),
            React.createElement("div",{className:"ns-formats fw"},
              ((typeof window.frameworkChoices==="function") ? window.frameworkChoices() : (window.FRAMEWORKS||[])).map(f=>
                React.createElement("button",{key:f.id,className:"ns-format "+(framework===f.id?"on":""),
                  onClick:()=>{ setFramework(f.id); setFrameworkTouched(true); }},
                  React.createElement(Icon[f.icon]||Icon.graph,{s:16}),
                  React.createElement("span",{className:"ns-format-name"},f.label),
                  React.createElement("span",{className:"ns-format-blurb"},f.blurb)))),
            React.createElement("div",{className:"ns-foot"},
              React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("seed")},"← Back"),
              React.createElement("button",{className:"ns-btn primary",onClick:()=>setStep(candidates.length?"loglines":"seed")},
                "Continue →")))

        : step==="seed"
        ? React.createElement("div",{className:"ns-body"},
            React.createElement("div",{className:"ns-seclab"},"How did your idea arrive?"),
            React.createElement("div",{className:"ns-chips"},
              seedTypes.map(s=>
                React.createElement("button",{key:s.id,className:"ns-chip "+(seed===s.id?"on":""),
                  onClick:()=>{ setSeed(s.id); setErr(""); }},
                  React.createElement(Icon[s.icon]||Icon.target,{s:14}), s.label))),
            React.createElement("div",{className:"ns-hint"},cfg.hint),
            needsText && React.createElement("div",{className:"ns-field"},
              React.createElement("div",{className:"ns-input-lab"},cfg.inputLabel),
              React.createElement("textarea",{className:"ns-input",value:text,placeholder:cfg.placeholder,
                onChange:e=>setText(e.target.value),onKeyDown:onCmdEnter(develop),rows:4,autoFocus:true})),
            seed==="talk" && React.createElement("div",{className:"ns-surprise"},
              React.createElement(Icon.mic,{s:16}),
              liveSeedSupport.ok
                ? "Start once and talk naturally with Frances — she listens and responds aloud in one continuous conversation. When the idea is clear, finish to shape the transcript into loglines."
                : Voice.sttSupported
                  ? "I’ll ask a few friendly questions aloud and shape loglines from your answers. Live conversation isn’t available here, so the turn-by-turn mic and typing options will open instead."
                  : "I’ll ask a few friendly questions and shape loglines from your answers. Voice isn’t available here, so you’ll type your answers — same conversation."),
            err && React.createElement("div",{className:"ns-err"},(window.turnLinkifyReact?window.turnLinkifyReact(err):err)),
            React.createElement("div",{className:"ns-foot"},
              React.createElement("button",{className:"ns-btn ghost",onClick:onClose},"Cancel"),
              seed==="script"
                ? React.createElement("button",{className:"ns-btn primary",onClick:()=>onImportScript()},
                    React.createElement(Icon.script,{s:16}),"Choose your script \u2192")
              : seed==="talk"
                ? React.createElement("button",{className:"ns-btn primary",onClick:()=>{ setErr(""); setStep("interview"); },disabled:!aiOn},
                    React.createElement(Icon.mic,{s:16}),"Start the conversation")
                : React.createElement("button",{className:"ns-btn primary",onClick:develop,disabled:loading||!aiOn},
                    loading?React.createElement(React.Fragment,null,
                      React.createElement("span",{className:"ns-spin"}),"Developing\u2026")
                      :React.createElement(React.Fragment,null,
                      React.createElement(Icon.sparkles,{s:16}),"Develop into a logline"))))

        : step==="interview"
        ? React.createElement(NSInterview,{ formatLabel,
            onComplete:(lls,transcript)=>{ if(transcript) setText(transcript); setCandidates(lls); setChosen(lls[0]||"");
              applyRecommendedShape(lls); setErr(""); setStep("format"); },
            onBack:()=>setStep("seed") })

        : step==="loglines"
        ? React.createElement("div",{className:"ns-body"},
            // the AI picked the story's SHAPE for any knob the writer left on defaults \u2014
            // say so, say why, and offer the way back to change it
            autoShape && React.createElement("div",{className:"ns-autoshape"},
              React.createElement(Icon.sparkles,{s:12}),
              React.createElement("span",null,
                "Shaped for this story: ",
                React.createElement("b",null,[autoShape.formatLabel, autoShape.frameworkLabel].filter(Boolean).join(" \u00b7 ")),
                autoShape.why ? (" \u2014 "+autoShape.why) : ""),
              React.createElement("button",{className:"ns-btn link",onClick:()=>setStep("format"),
                title:"Back to the Shape step \u2014 an explicit pick there always wins"},"Change")),
            React.createElement("div",{className:"ns-seclab"},"Choose a logline \u2014 edit it freely"),
            React.createElement("div",{className:"ns-cands"},
              candidates.map((c,i)=>
                React.createElement("button",{key:i,className:"ns-cand "+(chosen===c?"on":""),
                  onClick:()=>setChosen(c)},
                  React.createElement("span",{className:"ns-cand-dot"}),
                  React.createElement("span",{className:"ns-cand-tx"},c),
                  (i===0 && seed==="logline" && c===text.trim()) &&
                    React.createElement("span",{className:"ns-cand-mine"},"yours \u2014 untouched")))),
            loglineCheck && nsNorm(chosen)===nsNorm(loglineCheck.text) && React.createElement("div",{className:"ns-loglinecheck",role:"note"},
              React.createElement(Icon.sparkles,{s:12}),
              React.createElement("span",null,nsLoglineCheckText(loglineCheck.missing))),
            React.createElement("div",{className:"ns-field"},
              React.createElement("div",{className:"ns-input-lab"},"Final logline"),
              React.createElement("textarea",{className:"ns-input",value:chosen,
                onChange:e=>setChosen(e.target.value),rows:3})),
            err && React.createElement("div",{className:"ns-err"},(window.turnLinkifyReact?window.turnLinkifyReact(err):err)),
            React.createElement("div",{className:"ns-foot"},
              React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("format")},"\u2190 Back"),
              React.createElement("button",{className:"ns-btn link",onClick:()=>develop("loglines"),disabled:loading||synLoading},
                loading?"Re-developing\u2026":"Regenerate"),
              React.createElement("button",{className:"ns-btn primary",onClick:()=>runResearch(false),disabled:researchLoading||synLoading||loading||!chosen.trim()||!aiOn},
                researchLoading?React.createElement(React.Fragment,null,
                  React.createElement("span",{className:"ns-spin"}),"Researching\u2026")
                  :React.createElement(React.Fragment,null,
                  React.createElement(Icon.search||Icon.sparkles,{s:16}),
                  (research && researchFor===chosen.trim()) ? "Research \u2192" : "Research"))))

        : step==="research"
        ? React.createElement("div",{className:"ns-body"},
            React.createElement("div",{className:"syn-research res-edit"},
              React.createElement("div",{className:"syn-research-head"},"Three Pillars of Research \u2014 edit anything before the synopsis"),
              resField("Memory", research&&research.memory, v=>editResearch(r=>{ r.memory=v; }), 3),
              resField("Imagination", research&&research.imagination, v=>editResearch(r=>{ r.imagination=v; }), 3),
              React.createElement("div",{className:"syn-pillar"},
                React.createElement("div",{className:"syn-pillar-lab"},"Fact"),
                resField("World", fact.world, v=>editResearch(r=>{ r.fact=r.fact||{}; r.fact.world=v; }), 3),
                roles.map((x,i)=>React.createElement("div",{key:i,className:"res-role"},
                  React.createElement("input",{className:"ns-input res-who",value:x.who||"",placeholder:i?"Another principal":"The protagonist",
                    "aria-label":"Who this role is",
                    onChange:e=>{ const v=e.target.value; editResearch(r=>{ r.fact.roles=r.fact.roles&&r.fact.roles.length?r.fact.roles:[{...r.fact}]; r.fact.roles[i].who=v; }); }}),
                  resField("Role", x.role, v=>editResearch(r=>{ r.fact.roles=r.fact.roles&&r.fact.roles.length?r.fact.roles:[{...r.fact}]; r.fact.roles[i].role=v; }), 2),
                  React.createElement("div",{className:"syn-lens-grid"},
                    LENS_KEYS.map(([k,lab])=>React.createElement("div",{key:k,className:"syn-lens"},
                      resField(lab, x[k], v=>editResearch(r=>{ r.fact.roles=r.fact.roles&&r.fact.roles.length?r.fact.roles:[{...r.fact}]; r.fact.roles[i][k]=v; }), 4)))))),
                sourcesBlock())),
            React.createElement("div",{className:"ns-field res-steer"},
              React.createElement("div",{className:"ns-input-lab"},"Steer the research \u2014 optional"),
              React.createElement("div",{className:"res-steer-row"},
                React.createElement("input",{className:"ns-input",value:steer,placeholder:"e.g. go deeper on the police officer, or set it in Derry instead",
                  onChange:e=>setSteer(e.target.value), onKeyDown:onCmdEnter(()=>{ if(steer.trim()) runResearch(true); }, true)}),
                React.createElement("button",{className:"ns-btn",onClick:()=>runResearch(true),disabled:researchLoading||synLoading||!aiOn},
                  researchLoading?"Researching\u2026":"Research again"))),
            err && React.createElement("div",{className:"ns-err"},(window.turnLinkifyReact?window.turnLinkifyReact(err):err)),
            React.createElement("div",{className:"ns-foot"},
              React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("loglines")},"\u2190 Back"),
              React.createElement("button",{className:"ns-btn primary",
                onClick:()=>{ if(paras.length){ setErr(""); setStep("synopsis"); } else writeSynopsis(); },
                disabled:synLoading||researchLoading||!research||!aiOn},
                synLoading?React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin"}),"Writing\u2026")
                  :React.createElement(React.Fragment,null,React.createElement(Icon.sparkles,{s:16}),
                    paras.length ? "Synopsis \u2192" : "Write synopsis"))))

        : React.createElement("div",{className:"ns-body"},
            React.createElement("div",{className:"syn-titlerow"},
              React.createElement("input",{className:"syn-worktitle syn-title-input",value:title,
                placeholder:(syn&&syn.title)||"Working title",
                onChange:e=>setTitle(e.target.value),
                onKeyDown:onCmdEnter(()=>build(),true),
                title:"Working title — edit before building; the whole story inherits it"}),
              React.createElement("button",{className:"syn-research-toggle",onClick:()=>setShowResearch(v=>!v)},
                React.createElement(Icon.layers,{s:12}), showResearch?"Hide research":"Show research")),

            showResearch && React.createElement("div",{className:"syn-research"},
              React.createElement("div",{className:"syn-research-head"},"Three Pillars of Research"),
              pillar("Memory", research&&research.memory),
              pillar("Imagination", research&&research.imagination),
              (fact.world||roles.length>0) && React.createElement("div",{className:"syn-pillar"},
                React.createElement("div",{className:"syn-pillar-lab"},"Fact"),
                fact.world && React.createElement("div",{className:"syn-fact-line"},
                  React.createElement("span",{className:"syn-fact-k"},"World"), fact.world),
                roles.map((x,i)=>React.createElement("div",{key:i,className:"res-role-read"},
                  x.role && React.createElement("div",{className:"syn-fact-line"},
                    React.createElement("span",{className:"syn-fact-k"},x.who||"Role"), x.role),
                  React.createElement("div",{className:"syn-lens-grid"},
                    LENS_KEYS.filter(([k])=>x[k]).map(([k,lab])=>React.createElement("div",{key:k,className:"syn-lens"},
                      React.createElement("div",{className:"syn-lens-k"},lab),
                      React.createElement("div",{className:"syn-lens-v"},x[k])))))),
                sourcesBlock())),
            synStale && React.createElement("div",{className:"ns-loglinecheck",role:"status"},
              React.createElement(Icon.alert,{s:12}),
              React.createElement("span",null,"The research has changed since this synopsis was written \u2014 rewrite it from the research, or keep it as it is.")),

            React.createElement("div",{className:"syn-seclab"},"Synopsis \u2014 edit any paragraph before building"),
            paras.map((pg,i)=>React.createElement("div",{key:pg.key,className:"syn-para"},
              React.createElement("div",{className:"syn-para-lab"},pg.label||pg.key),
              React.createElement("textarea",{className:"ns-input syn-input",value:pg.text,rows:3,
                onChange:e=>{ const v=e.target.value; setParas(ps=>ps.map((x,j)=>j===i?{...x,text:v}:x)); }}))),
            err && React.createElement("div",{className:"ns-err"},(window.turnLinkifyReact?window.turnLinkifyReact(err):err)),
            React.createElement("div",{className:"ns-foot"},
              React.createElement("button",{className:"ns-btn ghost",onClick:()=>setStep("research")},"\u2190 Research"),
              React.createElement("button",{className:"ns-btn link",onClick:writeSynopsis,disabled:synLoading||!research},
                synLoading?"Rewriting\u2026":"Rewrite synopsis from research"),
              React.createElement("button",{className:"ns-btn primary",onClick:()=>build(),disabled:synLoading||!chosen.trim()},
                React.createElement(Icon.film,{s:16}),"Build this story")))));
}
window.NewStoryIntake = NewStoryIntake;

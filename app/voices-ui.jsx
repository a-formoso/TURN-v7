/* voices-ui.jsx — the Voices tab (Art Room), Phase 1 of the audio-first Stage.
   Each speaking character gets a LOCKED voice the way Cameo locks a face: designed
   from the bible, picked from the library, or cloned (consent-gated). Locking writes
   `voiceLock` (a voiceId + settings) onto the character via onUpdate. Generation runs
   through voicegen.jsx → the server proxy, so no ElevenLabs key is in the browser.
   See docs/Voice & Lip-Sync (Seedance) Plan.md §8A. */

const _vcEl = React.createElement;

function vcAudioIcon(playing){
  return playing
    ? _vcEl("span",{className:"vc-pause-mark","aria-hidden":"true"})
    : _vcEl(Icon.play,{s:11});
}

// parse the canonical "FUNCTION · ARCHETYPE — IDENTITY" role string
function vcParseRole(role){
  const r = String(role||"");
  let identity="", head=r;
  const dash = r.split(/\s[—-]\s/);
  if(dash.length>1){ identity = dash.slice(1).join(" ").trim(); head = dash[0]; }
  const dot = head.split(/\s·\s/);
  return { fn:(dot[0]||"").trim(), archetype:(dot[1]||"").trim(), identity };
}

/* origin/heritage read from the identity text — capitalized (possibly hyphenated)
   descriptors like "Turkish-Kurdish minicab driver" or "Glaswegian fixer" become the
   accent ElevenLabs actually needs NAMED (ethnic/biographical facts alone produce a
   generic neutral voice — the model doesn't infer accent from backstory). */
function vcOriginFrom(text, charName){
  const nameWords = new Set(String(charName||"").toUpperCase().split(/\s+/));
  for(const w of String(text||"").split(/\s+/)){
    const clean = w.replace(/[^A-Za-z-]/g,"");
    if(!clean || clean.length<4 || nameWords.has(clean.toUpperCase())) continue;
    const parts = clean.split("-");
    if(parts.length && parts.every(p=>/^[A-Z][a-z]{2,}$/.test(p))) return clean;
  }
  return "";
}

// a non-empty, editable VOICE descriptor built deterministically from the bible
// (no AI call) — every clause describes SOUND (age/gender → explicit accent →
// pitch/timbre → habitual cadence → quirks → recording quality); biography words are
// dropped because they don't change the voice. The character's authored VOICE
// BLOCK (c.voice = { accent, pitch, pace, quirks } — written at spine build and
// enriched by Script Breakdown) wins over every heuristic. User refines before
// designing.
function buildVoiceSpec(c){
  const role = vcParseRole(c.role);
  const pron = c.canonicalPronouns || c.pronouns || "";
  const gender = pron==="she/her" ? "female" : pron==="he/him" ? "male" : "";
  const phys = c.physique||{};
  const age = phys.age || phys.ageRange || phys.ageBand || "";
  const fn = (role.fn||"").toLowerCase();
  const vb = c.voice || {};
  // role-based delivery is only the FALLBACK when the voice block has no pitch/pace
  let pitch = String(vb.pitch||"").trim(), pace = String(vb.pace||"").trim();
  if(!pitch || !pace){
    let dPitch = "medium pitch, natural grounded timbre", dPace = "even, unhurried pacing";
    if(/antagonist|villain|rival/.test(fn)){ dPitch="low pitch, controlled and quiet with a cold edge"; dPace="deliberate pacing"; }
    else if(/protagonist|hero|lead/.test(fn)){ dPitch="low-medium pitch, warm, clear and expressive"; dPace="measured pacing"; }
    else if(/mentor|guide/.test(fn)){ dPitch="low pitch, weathered and reassuring"; dPace="slow, patient pacing"; }
    else if(/comic|wildcard/.test(fn)){ dPitch="lighter pitch, bright and quick"; dPace="playful pacing"; }
    if(!pitch) pitch = dPitch;
    if(!pace) pace = dPace;
  } else {
    if(!/pitch|timbre|voice/i.test(pitch)) pitch = pitch+" pitch";
    if(!/pac|rhythm|tempo/i.test(pace)) pace = pace+" pacing";
  }
  // accent priority: authored voice block → legacy voiceAccent → identity heuristic
  const origin = String(vb.accent||"").trim() || String(c.voiceAccent||"").trim() || vcOriginFrom(role.identity, c.name);
  const accent = origin
    ? (/\baccent|dialect|speaks\b/i.test(origin) ? origin : ("speaks English with a noticeable "+origin+" accent"))
    : "";
  const quirks = String(vb.quirks||"").trim();
  const base = [
    [age, gender, "voice"].filter(Boolean).join(" "),
    accent,
    pitch+"; "+pace,
    quirks,
    "clean close-mic recording, dry, with no background noise"
  ].filter(Boolean).join("; ")+".";
  const identity = (typeof window.turnIdentityPrompt==="function")
    ? String(window.turnIdentityPrompt([c])||"").trim() : "";
  return identity ? (base+" "+identity) : base;
}

// who actually needs a voice — characters in-frame on any shot that has dialogue;
// falls back to scene drivers when no shots/dialogue exist yet
function speakingCharIds(characters, scenes, shots){
  const set = new Set();
  const norm=v=>String(v||"").toLowerCase().replace(/\(cont'?d\)/ig,"").replace(/[^a-z0-9]+/g," ").trim();
  const byName=name=>{ const n=norm(name); return (characters||[]).find(c=>norm(c&&c.name)===n); };
  const byScene = {}; (shots||[]).forEach(sh=>{ (byScene[sh.sceneId]=byScene[sh.sceneId]||[]).push(sh); });
  (scenes||[]).forEach(scene=>{
    (byScene[scene.id]||[]).forEach(sh=>{
      if(!String(sh.dialogue||"").trim()&&!(Array.isArray(sh.dialogueLines)&&sh.dialogueLines.length)) return;
      let exact=false;
      (Array.isArray(sh.dialogueLines)?sh.dialogueLines:[]).forEach(row=>{
        const c=(row&&row.speakerId&&(characters||[]).find(x=>x.id===row.speakerId))||byName(row&&row.speaker);
        if(c){ set.add(c.id); exact=true; }
      });
      const stamped=(sh.lineAudio&&sh.lineAudio.speakerId&&(characters||[]).find(c=>c.id===sh.lineAudio.speakerId))
        ||byName(sh.lineAudio&&sh.lineAudio.speaker);
      if(stamped){ set.add(stamped.id); exact=true; }
      if(exact) return; // a remote/VO speaker is not required to be physically in frame
      const ids = (typeof inFrameCast==="function") ? inFrameCast(sh, scene, characters||[]) : (sh.subjects||[]);
      (ids||[]).forEach(id=>set.add(id));
    });
  });
  if(!set.size) (scenes||[]).forEach(s=>{ if(s.driver) set.add(s.driver); });
  return set;
}
window.speakingCharIds = speakingCharIds;

const VC_SRC_LABEL = { designed:"Designed", library:"Library", cloned:"Cloned" };
const VC_AUDITION_TEXT = window.VG_VOICE_MASTER_TEXT || "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos";
function vcStableSeed(id){
  const s=String(id||"voice");let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}

function VoiceCard({ c, project, speaks, onUpdate, titleId }){
  const lock = c.voiceLock && c.voiceLock.voiceId ? c.voiceLock : null;
  const projectId=(project&&project.id)||window.__turnCurrentProjectId||"local";
  const masterAssetId=(typeof window.vgVoiceMasterAssetId==="function")
    ? window.vgVoiceMasterAssetId(c.id) : ("voice-master-"+c.id);
  const masterFileName=(typeof window.vgVoiceMasterFileName==="function")
    ? window.vgVoiceMasterFileName(c.name) : ((c.name||"Character").replace(/[^A-Za-z0-9]+/g,"_")+"_voice.mp3");
  const masterAudio=window.useVoiceGen(masterAssetId);
  const masterStatus=(typeof window.vgVoiceMasterStatus==="function")
    ? window.vgVoiceMasterStatus(lock,masterAudio.audioUrl,masterAudio.meta,projectId)
    : {ready:!!masterAudio.audioUrl,state:masterAudio.audioUrl?"ready":"missing",reason:""};
  const [spec, setSpec] = React.useState(()=> c.voiceSpec || buildVoiceSpec(c));
  // Per-character delivery model. Once a voice is locked, its model is part of that
  // canonical production master and never follows a later app-default migration.
  const effModel = (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(lock) : ((lock&&lock.modelId) || window.VG_TTS_MODEL || "eleven_v3");
  const [ttsModel, setTtsModel] = React.useState(effModel);
  const ttsModels = window.VG_TTS_MODELS || [{ id:"eleven_v3", label:"Expressive (v3)" }];
  const changeDelivery = (v)=>{
    setTtsModel(v);
    if(lock){
      const revision=Date.now().toString(36);
      const next={ ...lock, modelId:v, modelChosen:true, revision, revisedAt:new Date().toISOString() };
      next.fingerprint=(typeof window.vgVoiceLockSignature==="function")?window.vgVoiceLockSignature(next):"";
      onUpdate(c.id, { voiceLock:next });
      if(typeof window.appToast==="function"){
        const m = ttsModels.find(x=>x.id===v);
        window.appToast("Delivery model set to "+((m&&m.label)||v)+" — existing lines are marked for revoice.","ok");
      }
    }
  };
  const [mode, setMode] = React.useState("design");       // design | library | clone
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [previews, setPreviews] = React.useState([]);     // design previews
  const [library, setLibrary] = React.useState([]);       // library voices
  const [samples, setSamples] = React.useState([]);       // clone: data URLs
  const [consent, setConsent] = React.useState(false);
  const ready = (typeof voiceProxyReady==="function") && voiceProxyReady();
  const aliveRef = React.useRef(true);
  const audioRef = React.useRef(null); // { audio, url } — private to this character card
  const [playingUrl, setPlayingUrl] = React.useState("");
  const stopAudio = React.useCallback((discard)=>{
    const current=audioRef.current;
    if(!current) return;
    try{ current.audio.pause(); }catch(e){}
    if(discard){
      current.audio.onended=null;
      current.audio.onerror=null;
      audioRef.current=null;
    }
    if(aliveRef.current) setPlayingUrl("");
  },[]);
  const toggleAudio = React.useCallback((url)=>{
    if(!url) return;
    const current=audioRef.current;
    if(current && current.url===url){
      if(!current.audio.paused && !current.audio.ended){
        current.audio.pause();
        if(aliveRef.current) setPlayingUrl("");
        return;
      }
      if(current.audio.ended){ try{ current.audio.currentTime=0; }catch(e){} }
      if(aliveRef.current) setPlayingUrl(url);
      try{
        const started=current.audio.play();
        if(started && typeof started.catch==="function") started.catch(()=>{
          if(aliveRef.current && audioRef.current===current) setPlayingUrl("");
        });
      }catch(e){ if(aliveRef.current && audioRef.current===current) setPlayingUrl(""); }
      return;
    }
    if(current){
      try{ current.audio.pause(); }catch(e){}
      current.audio.onended=null;
      current.audio.onerror=null;
    }
    const audio=new Audio(url);
    const entry={audio,url};
    audioRef.current=entry;
    audio.onended=()=>{
      if(audioRef.current!==entry) return;
      try{ audio.currentTime=0; }catch(e){}
      if(aliveRef.current) setPlayingUrl("");
    };
    audio.onerror=()=>{
      if(audioRef.current!==entry) return;
      audioRef.current=null;
      if(aliveRef.current) setPlayingUrl("");
    };
    if(aliveRef.current) setPlayingUrl(url);
    try{
      const started=audio.play();
      if(started && typeof started.catch==="function") started.catch(audio.onerror);
    }catch(e){ audio.onerror(); }
  },[]);
  React.useEffect(()=>{
    aliveRef.current=true;
    return ()=>{
      aliveRef.current=false;
      const current=audioRef.current;
      if(current){
        try{ current.audio.pause(); }catch(e){}
        current.audio.onended=null;
        current.audio.onerror=null;
        audioRef.current=null;
      }
    };
  },[c.id]);
  const isPlaying=(url)=>!!url && playingUrl===url;

  const initials = (c.name||"?").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const roleSummary = (c.role||"").split(/\s[—-]\s/)[0] || "Character";

  const lockVoice = (voiceId, voiceName, source, provenance)=>{
    const fallbackName = (typeof clipWords==="function") ? clipWords(spec,40) : spec.slice(0,40);
    const now=new Date().toISOString();
    const next={
      voiceId, voiceName: voiceName||fallbackName, source,
      modelId: ttsModel || (window.VG_TTS_MODEL||"eleven_v3"),
      modelChosen:true,
      identityRevision: c.identityRevision!=null ? String(c.identityRevision) : "",
      identityPronouns: c.canonicalPronouns || c.pronouns || "",
      defaults: window.VG_DEFAULTS || { stability:0.7, similarity:0.75, style:0.1, speed:1.0, speakerBoost:true },
      revision:Date.now().toString(36), lockedAt:now, specSnapshot:spec,
      auditionText:(provenance&&provenance.auditionText)||VC_AUDITION_TEXT,
      auditionSeed:(provenance&&provenance.seed)!=null?provenance.seed:null,
      designModel:(provenance&&provenance.designModel)||"",
      generatedVoiceId:(provenance&&provenance.generatedVoiceId)||"",
      master:null,
      consent: source==="cloned", sync:false,
    };
    next.fingerprint=(typeof window.vgVoiceLockSignature==="function")?window.vgVoiceLockSignature(next):"";
    onUpdate(c.id, { voiceSpec: spec, voiceLock:next });
    setPreviews([]); setLibrary([]); setErr("");
    return next;
  };

  const renderMaster = async (voiceLock,force)=>{
    const r=await window.elGenerateVoiceMaster(c,voiceLock,{force:!!force,projectId,
      identityCharacter:c,identityCharacterIds:[c.id],identityCast:[c],
      identityContext:{characterIds:[c.id],cast:[c]} });
    const master={assetId:r.assetId||masterAssetId,fileName:r.fileName||masterFileName,
      text:r.text||VC_AUDITION_TEXT,durationMs:r.durationMs||0,hash:r.hash||"",
      voiceId:voiceLock.voiceId,voiceRevision:voiceLock.revision||"",
      voiceSignature:r.voiceSignature||voiceLock.fingerprint||"",modelId:r.modelId||voiceLock.modelId||"",
      provider:r.provider||"",backend:r.backend||"",renderedAt:r.renderedAt||new Date().toISOString()};
    onUpdate(c.id,{voiceLock:{...voiceLock,master}});
    if(aliveRef.current) toggleAudio(r.audioUrl);
    return r;
  };

  const design = async ()=>{
    if(busy) return; stopAudio(true); setBusy(true); setErr(""); setPreviews([]);
    try{ const ps = await window.elDesignVoice(spec, { text:VC_AUDITION_TEXT,seed:vcStableSeed(c.id),identityCharacter:c, identityCharacterIds:[c.id],
      identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} }); setPreviews(ps||[]);
      if(!ps || !ps.length) setErr("No previews came back — tweak the description and try again.");
    }catch(e){ setErr(String((e&&e.message)||"Couldn't design a voice.")); }
    setBusy(false);
  };
  const lockPreview = async (p)=>{
    if(busy) return; setBusy(true); setErr("");
    stopAudio(true);
    try{ const r = await window.elSaveVoice(p.generatedVoiceId, { name:c.name, description:spec,
        identityCharacter:c, identityCharacterIds:[c.id], identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} });
      const next=lockVoice(r.voiceId, r.name, "designed",p);
      try{ await renderMaster(next,false); }
      catch(e){ setErr("Voice locked, but its named master file could not be generated yet. Retry below. "+String((e&&e.message)||"")); }
    }
    catch(e){ setErr(String((e&&e.message)||"Couldn't lock that voice.")); }
    setBusy(false);
  };
  const browse = async ()=>{
    if(busy) return; stopAudio(true); setBusy(true); setErr(""); setLibrary([]);
    try{ const vs = await window.elListVoices({ identityCharacter:c, identityCharacterIds:[c.id],
      identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} }); setLibrary(vs||[]); if(!vs||!vs.length) setErr("No library voices on this account yet."); }
    catch(e){ setErr(String((e&&e.message)||"Couldn't load the library.")); }
    setBusy(false);
  };
  const onFiles = (e)=>{
    const files = Array.from(e.target.files||[]);
    Promise.all(files.map(f=> new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>res(""); r.readAsDataURL(f); })))
      .then(urls=> setSamples(urls.filter(Boolean)));
  };
  const clone = async ()=>{
    if(busy || !consent || !samples.length) return; setBusy(true); setErr("");
    try{ const r = await window.elCloneVoice(samples, { name:c.name, description:spec,
        identityCharacter:c, identityCharacterIds:[c.id], identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} }); lockVoice(r.voiceId, r.name, "cloned"); setSamples([]); }
    catch(e){ setErr(String((e&&e.message)||"Cloning failed.")); }
    setBusy(false);
  };
  const test = async (force)=>{
    if(busy || !lock) return; stopAudio(true); setBusy(true); setErr("");
    try{ await renderMaster(lock,!!force); }
    catch(e){ setErr(String((e&&e.message)||"Couldn't render the voice master.")); }
    setBusy(false);
  };

  return _vcEl("div",{className:"vc-card"+(lock?" locked":"")+(speaks?"":" silent")},
    _vcEl("div",{className:"vc-head"},
      _vcEl("span",{className:"vc-av",style:{background:c.color||"var(--bg-4)"}}, initials),
      _vcEl("div",{className:"vc-id"},
        _vcEl("div",{className:"vc-name",id:titleId||undefined}, c.name||"Character"),
        _vcEl("div",{className:"vc-role"}, roleSummary)),
      speaks ? _vcEl("span",{className:"vc-tag speaks"},"Speaks")
             : _vcEl("span",{className:"vc-tag"},"No dialogue")),

    lock
      ? _vcEl("div",{className:"vc-locked"},
          _vcEl("div",{className:"vc-locked-row"},
            _vcEl(Icon.check,{s:14}),
            _vcEl("span",{className:"vc-locked-name"}, lock.voiceName||"Voice"),
            _vcEl("span",{className:"vc-src"}, VC_SRC_LABEL[lock.source]||lock.source)),
          _vcEl("div",{className:"vc-role"},"Canonical voice · "+((ttsModels.find(m=>m.id===effModel)||{}).label||effModel)
            +(lock.voiceId?(" · ID "+String(lock.voiceId).slice(0,8)):"")
            +(lock.lockedAt?(" · locked "+new Date(lock.lockedAt).toLocaleDateString()):"")),
          _vcEl("div",{className:"vc-note"},
            _vcEl("span",null,lock.specSnapshot||c.voiceSpec||"This voice is the character's reusable production master.")),
          _vcEl("div",{className:"vc-master","data-testid":"character-voice-master","data-state":masterStatus.state},
            _vcEl("div",{className:"vc-master-head"},
              _vcEl("div",null,
                _vcEl("div",{className:"vc-lab"},"Voice master"),
                _vcEl("div",{className:"vc-master-file"},masterFileName)),
              _vcEl("div",{className:"vc-master-tools"},
                window.InfoTip && _vcEl(window.InfoTip,{
                  label:"How the voice master is used",
                  text:"Scene dialogue is synthesized from its exact screenplay words using this same voice ID; the sample phrase is never substituted for a line."
                }),
                _vcEl("span",{className:"vc-master-state "+masterStatus.state},masterStatus.ready?"Ready":"Needs render"))),
            _vcEl("div",{className:"vc-master-text"},"“"+VC_AUDITION_TEXT+"”"),
            !masterStatus.ready && masterStatus.reason && _vcEl("div",{className:"vc-note vc-master-note"},masterStatus.reason),
            _vcEl("div",{className:"vc-actions vc-master-actions"},
              _vcEl("button",{className:"vc-btn audio-toggle"+(masterStatus.ready?" playback":"")+(isPlaying(masterAudio.audioUrl)?" playing":""),type:"button",
                onClick:masterStatus.ready?()=>toggleAudio(masterAudio.audioUrl):()=>test(false),
                disabled:masterStatus.ready?false:(busy||!ready),
                "aria-pressed":masterStatus.ready?(isPlaying(masterAudio.audioUrl)?"true":"false"):undefined,
                "aria-label":masterStatus.ready?((isPlaying(masterAudio.audioUrl)?"Pause":"Play")+" the saved canonical voice master for "+(c.name||"character")):"Generate the canonical voice master",
                title:masterStatus.ready?(isPlaying(masterAudio.audioUrl)?"Pause the saved canonical voice master":"Play the saved canonical voice master"):"Generate the canonical voice master through ElevenLabs"},
                masterStatus.ready?vcAudioIcon(isPlaying(masterAudio.audioUrl)):_vcEl(Icon.sparkles,{s:13}),
                masterStatus.ready?(isPlaying(masterAudio.audioUrl)?"Pause":"Play"):(busy?"…":"Generate voice file")),
              masterStatus.ready && _vcEl("a",{className:"vc-btn",href:masterAudio.audioUrl,download:masterFileName,
                title:"Download "+masterFileName},"Download"),
              masterStatus.ready && _vcEl("button",{className:"vc-btn ghost",onClick:()=>test(true),disabled:busy||!ready,title:"Render the canonical phrase again with the current voice settings"},"Regenerate"))),
          _vcEl("div",{className:"vc-field"},
            _vcEl("div",{className:"vc-lab"},"Delivery model"),
            _vcEl("select",{className:"vc-delivery",value:effModel,
              title:"How this canonical voice renders its lines — switching marks existing lines for revoice",
              onChange:e=>changeDelivery(e.target.value)},
              ttsModels.map(m=>_vcEl("option",{key:m.id,value:m.id,title:m.note},m.label+(m.note?(" — "+m.note):""))))),
          _vcEl("div",{className:"vc-actions"},
            _vcEl("button",{className:"vc-btn ghost",onClick:()=>{ stopAudio(true); onUpdate(c.id,{ voiceLock:null }); }},"Remove")),
          err && _vcEl("div",{className:"vc-err"}, err))

      : _vcEl("div",{className:"vc-body"},
          !ready && _vcEl("div",{className:"vc-note"},
            _vcEl(Icon.alert,{s:12}),
            _vcEl("span",null,"Voice runs on your server — deploy the media proxy and set the ElevenLabs key to design and lock voices.")),
          _vcEl("div",{className:"vc-modes"},
            ["design","library","clone"].map(m=> _vcEl("button",{key:m,className:"vc-mode"+(mode===m?" on":""),onClick:()=>{ stopAudio(true); setMode(m); setErr(""); }},
              m==="design"?"Design":m==="library"?"Library":"Clone"))),

          mode!=="library" && _vcEl("div",{className:"vc-field"},
            _vcEl("div",{className:"vc-lab"},"Voice description",
              _vcEl("button",{className:"vc-rebuild",type:"button",
                title:"Rebuild this description from the character's bible (age, role, derived accent)",
                onClick:()=>{
                  const built = buildVoiceSpec(c);
                  const changed = built !== spec;
                  setSpec(built);
                  if(typeof window.appToast==="function")
                    window.appToast(changed
                      ? "Voice description rebuilt from "+(c.name||"the character")+"'s bible."
                      : "Already matches "+(c.name||"the character")+"'s bible — nothing to change.", "ok");
                }},"↺ From character")),
            _vcEl("textarea",{className:"ns-input vc-spec",value:spec,rows:3,
              onChange:e=>setSpec(e.target.value),
              placeholder:"40s male voice; speaks English with a noticeable Turkish accent; low-medium pitch, warm and slightly gravelly; measured pacing; clear studio-quality recording"}),
            // ElevenLabs won't infer accent from backstory — it must be NAMED, or the
            // voice comes out generic. Soft nudge, never a block.
            mode==="design" && spec.trim() && !/\baccent|dialect\b/i.test(spec) && _vcEl("div",{className:"vc-note vc-accent-note"},
              _vcEl(Icon.alert,{s:12}),
              _vcEl("span",null,"No accent named — describe it explicitly (e.g. “speaks English with a slight Turkish accent”) or the voice will sound generic. Backstory words like a job or heritage don’t change the sound."))),
          mode!=="library" && _vcEl("div",{className:"vc-field"},
            _vcEl("div",{className:"vc-lab"},"Delivery model"),
            _vcEl("select",{className:"vc-delivery",value:ttsModel,
              title:"How the locked voice will render its lines — saved with the lock",
              onChange:e=>changeDelivery(e.target.value)},
              ttsModels.map(m=>_vcEl("option",{key:m.id,value:m.id,title:m.note},m.label+(m.note?(" — "+m.note):""))))),

          mode==="design" && _vcEl(React.Fragment,null,
            _vcEl("button",{className:"vc-btn primary",onClick:design,disabled:busy||!ready||!spec.trim()},
              busy?_vcEl(React.Fragment,null,_vcEl("span",{className:"ns-spin"}),"Designing…"):_vcEl(React.Fragment,null,_vcEl(Icon.sparkles,{s:14}),"Design voices")),
            previews.length>0 && _vcEl("div",{className:"vc-previews"},
              _vcEl("div",{className:"vc-note"},"Every option uses the same audition line: “"+VC_AUDITION_TEXT+"”"),
              previews.map((p,i)=> _vcEl("div",{key:p.generatedVoiceId||i,className:"vc-preview"},
                _vcEl("button",{className:"vc-play"+(isPlaying(p.audioUrl)?" playing":""),type:"button",onClick:()=>toggleAudio(p.audioUrl),
                  title:isPlaying(p.audioUrl)?"Pause":"Play","aria-pressed":isPlaying(p.audioUrl)?"true":"false",
                  "aria-label":(isPlaying(p.audioUrl)?"Pause":"Play")+" Option "+(i+1)+" for "+(c.name||"character"),
                  "data-voice-option":i+1}, vcAudioIcon(isPlaying(p.audioUrl))),
                _vcEl("span",{className:"vc-preview-lab"},"Option "+(i+1)),
                _vcEl("button",{className:"vc-btn",onClick:()=>lockPreview(p),disabled:busy},"Lock this"))))),

          mode==="library" && _vcEl(React.Fragment,null,
            _vcEl("button",{className:"vc-btn primary",onClick:browse,disabled:busy||!ready},
              busy?"Loading…":"Browse library"),
            library.length>0 && _vcEl("div",{className:"vc-previews"},
              library.slice(0,12).map(v=> _vcEl("div",{key:v.voiceId,className:"vc-preview"},
                v.previewUrl && _vcEl("button",{className:"vc-play"+(isPlaying(v.previewUrl)?" playing":""),type:"button",onClick:()=>toggleAudio(v.previewUrl),
                  title:isPlaying(v.previewUrl)?"Pause":"Play","aria-pressed":isPlaying(v.previewUrl)?"true":"false",
                  "aria-label":(isPlaying(v.previewUrl)?"Pause ":"Play ")+(v.name||"library voice")+" for "+(c.name||"character")}, vcAudioIcon(isPlaying(v.previewUrl))),
                _vcEl("span",{className:"vc-preview-lab"}, v.name||v.voiceId),
                _vcEl("button",{className:"vc-btn",onClick:()=>{ stopAudio(true); lockVoice(v.voiceId, v.name, "library"); },disabled:busy},"Lock"))))),

          mode==="clone" && _vcEl(React.Fragment,null,
            _vcEl("label",{className:"vc-upload"},
              _vcEl(Icon.plus,{s:13}), samples.length?(samples.length+" sample"+(samples.length>1?"s":"")+" ready"):"Add voice samples",
              _vcEl("input",{type:"file",accept:"audio/*",multiple:true,onChange:onFiles,style:{display:"none"}})),
            _vcEl("label",{className:"vc-consent"},
              _vcEl("input",{type:"checkbox",checked:consent,onChange:e=>setConsent(e.target.checked)}),
              _vcEl("span",null,"This is my voice or I have the speaker's permission to clone it.")),
            _vcEl("button",{className:"vc-btn primary",onClick:clone,disabled:busy||!ready||!consent||!samples.length},
              busy?"Cloning…":"Clone & lock")),

          err && _vcEl("div",{className:"vc-err"}, err)));
}

/* VoiceModal is deliberately NON-modal and card-contained. CharacterSheets owns the
   set of open character IDs, while each mounted CharacterSheet hosts its own dimmer +
   Voice card so several characters' cards can remain open independently. */
function VoiceModal({ character, project, speaks, onUpdate, onClose }){
  const safeId=String((character&&character.id)||"character").replace(/[^A-Za-z0-9_-]/g,"-");
  const titleId="voice-window-title-"+safeId;
  const popupId="voice-popup-"+safeId;
  const overlayRef=React.useRef(null);
  const panelRef=React.useRef(null);
  React.useEffect(()=>{
    const overlay=overlayRef.current;
    const siblings=overlay&&overlay.parentElement
      ? Array.from(overlay.parentElement.children).filter(el=>el!==overlay) : [];
    const previous=siblings.map(el=>({el,inert:el.hasAttribute("inert"),ariaHidden:el.getAttribute("aria-hidden")}));
    siblings.forEach(el=>{ el.setAttribute("inert",""); el.setAttribute("aria-hidden","true"); });
    if(panelRef.current){ try{ panelRef.current.focus({preventScroll:true}); }catch(e){ panelRef.current.focus(); } }
    return ()=>{
      previous.forEach(row=>{
        if(row.inert) row.el.setAttribute("inert",""); else row.el.removeAttribute("inert");
        if(row.ariaHidden==null) row.el.removeAttribute("aria-hidden"); else row.el.setAttribute("aria-hidden",row.ariaHidden);
      });
      requestAnimationFrame(()=>{
        const trigger=Array.from(document.querySelectorAll('[data-testid="voice-popup-trigger"]'))
          .find(el=>el.getAttribute("data-character-id")===String(character&&character.id));
        if(trigger){ try{ trigger.focus({preventScroll:true}); }catch(e){ trigger.focus(); } }
      });
    };
  },[character&&character.id]);
  return _vcEl("div",{className:"voice-card-overlay",ref:overlayRef,"data-testid":"voice-card-overlay",
      "data-character-id":character&&character.id,
      onClick:e=>{ if(e.target===e.currentTarget) onClose&&onClose(); }},
    _vcEl("section",{
        className:"dt-panel voice-modal voice-window",ref:panelRef,id:popupId,
        role:"dialog","aria-modal":"false","aria-labelledby":titleId,tabIndex:-1,
        "data-testid":"voice-popup","data-character-id":character&&character.id,
        onKeyDown:e=>{ if(e.key==="Escape"){ e.stopPropagation(); onClose&&onClose(); } }},
      _vcEl("button",{className:"ag-x voice-modal-x",type:"button",onClick:onClose,
        "aria-label":"Close voice design for "+((character&&character.name)||"character"),
        "data-testid":"voice-popup-close",title:"Close "+((character&&character.name)||"voice")}, _vcEl(Icon.x,{s:17})),
      _vcEl("div",{className:"dt-scroll voice-modal-scroll"},
        _vcEl(VoiceCard,{c:character,project,speaks,onUpdate,titleId}))));
}
window.VoiceModal = VoiceModal;

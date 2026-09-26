/* voicegen.jsx — the VOICE generation + persistence layer for the Stage (audio-first).
   Structural twin of imagegen.jsx's nb* layer, for ElevenLabs audio instead of images.
   Every call goes through the SAME server-side Supabase proxy (the `image-proxy`
   Edge Function, task:"voice"), using the proxy's ELEVENLABS_API_KEY server secret,
   with admin API Keys able to override for testing. Local-first persistence (IndexedDB); cloud is a
   guarded extension hook (window.cloudCommitAudio) wired in a later turn.

   Public surface (mirrors the plan):
     elGenerate(id, text, {voiceId, settings, modelId, force}) -> {audioUrl, durationMs, alignment, cached}
     elDesignVoice(description, {text, modelId})  -> [{generatedVoiceId, audioUrl}]   (audition)
     elSaveVoice(generatedVoiceId, {name, description}) -> {voiceId}                  (the lock)
     elListVoices()                               -> [{voiceId, name, ...}]           (library)
     elCloneVoice(samples[], {name, description}) -> {voiceId}                        (consent-gated)
     vgGetAudio(id) / vgGetMeta(id) / vgLoadAudio(id) / vgClearAudio(id)
     useVoiceGen(id) -> {audioUrl, durationMs, gening, err, generate, clear}
*/

// ---- config -----------------------------------------------------------------
const VG_TTS_MODEL = "eleven_v3";      // DEFAULT delivery: the most expressive model
const VG_OUTPUT_FORMAT = "mp3_44100_128";
const VG_DEFAULTS = { stability:0.70, similarity:0.75, style:0.10, speed:1.0, speakerBoost:true };
const VG_VOICE_MASTER_TEXT = "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos";
function vgVoiceMasterAssetId(characterId){ return "voice-master-"+String(characterId||"character"); }
function vgVoiceMasterFileName(characterName){
  const stem=String(characterName||"character").trim().replace(/[\u2018\u2019']/g,"")
    .replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"")||"character";
  return stem+"_voice.mp3";
}
// selectable per-character DELIVERY models (stored on the voice lock, honoured on every
// line render + test line). v3 is the app default; v2 stays available for a flatter,
// maximally-consistent timbre.
const VG_TTS_MODELS = [
  { id:"eleven_v3", label:"Expressive (v3)", note:"The default — most expressive delivery; understands audio tags like [whispers] or [sighs] written into the line." },
  { id:"eleven_multilingual_v2", label:"Classic (v2)", note:"Flatter but maximally consistent timbre — pick when a voice should never vary." },
];
/* A voice lock is a production master, so its delivery model is immutable until the
   director explicitly changes it. Silently migrating an older lock to a new global
   default can mix two delivery engines inside one character's scene. */
function vgDeliveryModelOf(lock){
  return (lock && lock.modelId) ? lock.modelId : VG_TTS_MODEL;
}
window.VG_DEFAULTS = VG_DEFAULTS; window.VG_TTS_MODEL = VG_TTS_MODEL; window.VG_TTS_MODELS = VG_TTS_MODELS;
window.VG_VOICE_MASTER_TEXT=VG_VOICE_MASTER_TEXT;
window.vgVoiceMasterAssetId=vgVoiceMasterAssetId;
window.vgVoiceMasterFileName=vgVoiceMasterFileName;
window.vgDeliveryModelOf = vgDeliveryModelOf;

/* voice always runs server-side — so it needs the proxy on, the Supabase client,
   and a signed-in user. The proxy uses the platform server secret unless an
   administrator overrides it for testing. There is no browser-direct path. */
function voiceProxyReady(){
  return !!(window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxy
    && typeof window.sbClient==="function" && window.sbClient());
}
window.voiceProxyReady = voiceProxyReady;

// ---- local IndexedDB store for audio (mp3 data URLs are large, like images) ---
const VGIDB_DB="turn-audio", VGIDB_STORE="audio";
let _vgIdbPromise=null;
function vgIdbOpen(){
  if(_vgIdbPromise) return _vgIdbPromise;
  _vgIdbPromise = new Promise((res,rej)=>{
    try{
      if(!window.indexedDB){ rej(new Error("no idb")); return; }
      const req=indexedDB.open(VGIDB_DB,1);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(VGIDB_STORE)) db.createObjectStore(VGIDB_STORE); };
      req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error);
    }catch(e){ rej(e); }
  });
  return _vgIdbPromise;
}
function vgIdbSet(k,v){ return vgIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VGIDB_STORE,"readwrite"); tx.objectStore(VGIDB_STORE).put(v,k); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); })); }
function vgIdbGet(k){ return vgIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VGIDB_STORE,"readonly"); const r=tx.objectStore(VGIDB_STORE).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function vgIdbDel(k){ return vgIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VGIDB_STORE,"readwrite"); tx.objectStore(VGIDB_STORE).delete(k); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); })); }

// in-memory mirror for instant SYNC reads (mirrors imagegen's _nbImgMemory)
const _vgMem = new Map();          // project:id -> { url, meta }
function vgProjectScope(projectId){ return String(projectId||window.__turnCurrentProjectId||"local"); }
function vgMemKey(id,projectId){ return vgProjectScope(projectId)+":"+id; }
function vgKey(id,projectId){ return "a:"+vgProjectScope(projectId)+":"+id; }

function vgGetAudio(id,projectId){ const e=_vgMem.get(vgMemKey(id,projectId)); return (e&&e.url)||""; }
function vgGetMeta(id,projectId){ const e=_vgMem.get(vgMemKey(id,projectId)); return (e&&e.meta)||null; }
async function vgLoadAudio(id,projectId){
  const scope=vgProjectScope(projectId),memKey=vgMemKey(id,scope);
  const sync=vgGetAudio(id,scope); if(sync) return sync;
  try{
    let v=await vgIdbGet(vgKey(id,scope));
    // One-time read compatibility for audio created before film-scoped keys. The
    // Stage lineage guard still validates its text/voice/hash before attachment.
    if(!v)v=await vgIdbGet("a:"+id);
    if(v&&v.meta&&v.meta.projectId&&String(v.meta.projectId)!==scope)return "";
    if(v && v.url){ _vgMem.set(memKey,{url:v.url,meta:v.meta||null}); return v.url; }
  }catch(e){}
  return "";
}
window.vgGetAudio=vgGetAudio; window.vgGetMeta=vgGetMeta; window.vgLoadAudio=vgLoadAudio;
// drop the in-memory line-audio cache (call on project switch so no audio leaks across films)
function vgResetAll(){ _vgMem.clear(); }
window.vgResetAll=vgResetAll;

// ---- hash for skip-if-unchanged (text + voice + resolved settings) -----------
// Cost discipline (§5): a line whose text/voice/settings haven't changed is never re-rendered.
function vgHash(text, voiceId, settings){
  const s = JSON.stringify({ t:text||"", v:voiceId||"", st:settings||{} });
  let h=5381; for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))|0; }
  return (h>>>0).toString(36);
}
window.vgHash=vgHash;

function vgResolvedSettings(lock){
  const d=(lock&&lock.defaults)||{};
  return {
    stability:d.stability!=null?d.stability:VG_DEFAULTS.stability,
    similarity:d.similarity!=null?d.similarity:VG_DEFAULTS.similarity,
    style:d.style!=null?d.style:VG_DEFAULTS.style,
    speed:d.speed!=null?d.speed:VG_DEFAULTS.speed,
    speakerBoost:d.speakerBoost!=null?d.speakerBoost:VG_DEFAULTS.speakerBoost
  };
}
/* Stable fingerprint for the canonical voice master. It covers the actual voice,
   delivery model and effective settings, but not per-line words or performance. */
function vgVoiceLockSignature(lock){
  if(!lock||!lock.voiceId)return "";
  const settings=vgResolvedSettings(lock);
  return vgHash("",lock.voiceId,{modelId:vgDeliveryModelOf(lock),...settings});
}
function vgVoiceMasterStatus(lock,audioUrl,assetMeta,projectId){
  const fail=(state,reason)=>({ready:false,state,reason});
  if(!lock||!lock.voiceId)return fail("missing-lock","Lock the character's canonical voice first.");
  if(!audioUrl)return fail("missing","Generate the canonical voice master.");
  const meta=assetMeta||{};
  if(!meta.voiceId||!meta.text)return fail("unverified","This older sample has no canonical voice provenance. Regenerate it once.");
  if(String(meta.text||"").trim()!==VG_VOICE_MASTER_TEXT)return fail("stale-text","The canonical voice-master phrase changed. Regenerate the sample.");
  if(String(meta.voiceId||"")!==String(lock.voiceId||""))return fail("stale-voice","This sample belongs to a different voice. Regenerate it.");
  const modelId=vgDeliveryModelOf(lock),signature=vgVoiceLockSignature(lock);
  if(meta.modelId&&String(meta.modelId)!==String(modelId))return fail("stale-model","This sample uses a different delivery model. Regenerate it.");
  if(meta.voiceSignature&&meta.voiceSignature!==signature)return fail("stale-settings","This sample uses older voice settings. Regenerate it.");
  if(meta.projectId&&projectId&&String(meta.projectId)!==String(projectId))return fail("wrong-project","This sample belongs to a different film.");
  return {ready:true,state:"ready",reason:""};
}
/* One shared readiness rule for Shoot: bytes AND matching provenance are required.
   Legacy rows without version fields remain usable when their words + voiceId match;
   every newly rendered row is checked strictly. Stale bytes stay recoverable in IDB,
   but can never be attached to a paid video request. */
function vgLineAudioStatus(lineAudio,lock,text,audioUrl,projectId,assetMeta){
  const la=lineAudio||{},spoken=String(text||"").trim();
  const fail=(state,reason)=>({ready:false,state,reason});
  if(!spoken)return {ready:true,state:"silent",reason:""};
  if(!lock||!lock.voiceId)return fail("missing-lock","The speaker has no canonical voice lock.");
  if(!la.durationMs)return fail("missing","This line has not been voiced.");
  if(!audioUrl)return fail("missing-bytes","The line metadata exists, but its audio file is unavailable.");
  if(la.stale)return fail("stale",la.staleReason||"The character's canonical voice changed.");
  if(String(la.text||"").trim()!==spoken)return fail("stale-text","The screenplay words changed after this audio was rendered.");
  if(String(la.voiceId||"")!==String(lock.voiceId||""))return fail("stale-voice","This line was rendered with a different voice.");
  const modelId=vgDeliveryModelOf(lock),signature=vgVoiceLockSignature(lock);
  if(la.modelId&&String(la.modelId)!==String(modelId))return fail("stale-model","This line was rendered with a different delivery model.");
  if(la.voiceSignature&&la.voiceSignature!==signature)return fail("stale-settings","This line was rendered with different voice settings.");
  if(la.voiceRevision&&lock.revision&&String(la.voiceRevision)!==String(lock.revision))
    return fail("stale-revision","This line belongs to an older version of the canonical voice.");
  if(la.projectId&&projectId&&String(la.projectId)!==String(projectId))
    return fail("wrong-project","This audio belongs to a different film.");
  if(assetMeta){
    if(assetMeta.projectId&&projectId&&String(assetMeta.projectId)!==String(projectId))
      return fail("wrong-project","The stored audio file belongs to a different film.");
    if(la.hash&&assetMeta.hash&&la.hash!==assetMeta.hash)
      return fail("stale-bytes","The stored audio file does not match this line's render record.");
    if(assetMeta.voiceId&&String(assetMeta.voiceId)!==String(lock.voiceId))
      return fail("stale-bytes","The stored audio file was made with a different voice.");
    if(assetMeta.text&&String(assetMeta.text).trim()!==spoken)
      return fail("stale-bytes","The stored audio file contains different words.");
  }
  if(la.modelId&&la.hash){
    const expected=vgHash(spoken,lock.voiceId,{...vgResolvedSettings(lock),modelId});
    if(la.hash!==expected)return fail("stale-render","This line's render fingerprint no longer matches its voice master.");
  }
  return {ready:true,state:"ready",reason:""};
}
window.vgResolvedSettings=vgResolvedSettings;
window.vgVoiceLockSignature=vgVoiceLockSignature;
window.vgVoiceMasterStatus=vgVoiceMasterStatus;
window.vgLineAudioStatus=vgLineAudioStatus;

// ---- persist one rendered line ----------------------------------------------
async function elCommit(id, dataUrl, meta){
  const scope=vgProjectScope(meta&&meta.projectId),memKey=vgMemKey(id,scope);
  _vgMem.set(memKey, { url:dataUrl, meta:meta||null });
  // cloud extension hook (the turn_audios table) — guarded; defaults to local IDB until wired
  if(typeof window.cloudCommitAudio==="function" && typeof window.nbBackend==="function" && window.nbBackend()==="cloud"){
    try{ const r=await window.cloudCommitAudio(id, dataUrl, meta); if(r && r.url){ _vgMem.set(memKey,{url:r.url,meta:meta||null}); } }catch(e){}
  }
  try{ await vgIdbSet(vgKey(id,scope), { url:dataUrl, meta:meta||null }); }catch(e){}
  try{ window.dispatchEvent(new CustomEvent("vg-audio-done",{ detail:{ ids:[id] } })); }catch(e){}
  return { url:dataUrl };
}
async function vgClearAudio(id){
  const scope=vgProjectScope();
  _vgMem.delete(vgMemKey(id,scope));
  try{ await vgIdbDel(vgKey(id,scope)); }catch(e){}
  try{ window.dispatchEvent(new CustomEvent("vg-audio-done",{ detail:{ ids:[id] } })); }catch(e){}
}
window.elCommit=elCommit; window.vgClearAudio=vgClearAudio;

function vgAssertIdentity(opts, phase){
  opts=opts||{};
  const c=opts.identityCharacter||opts.character;
  const lock=opts.voiceLock||opts.voiceIdentity||null;
  if(c && lock){
    const normalize=(v)=>typeof window.turnNormalizePronouns==="function"
      ? String(window.turnNormalizePronouns(v)||"") : String(v||"").trim().toLowerCase();
    const currentRevision=c.identityRevision!=null ? String(c.identityRevision) : "";
    const savedRevision=lock.identityRevision!=null ? String(lock.identityRevision) : "";
    const savedPronouns=normalize(lock.identityPronouns||lock.canonicalPronouns||lock.pronouns);
    const currentPronouns=normalize(c.canonicalPronouns||c.pronouns);
    if((currentRevision!==savedRevision && (currentRevision||savedRevision))
      || (savedPronouns && currentPronouns && savedPronouns!==currentPronouns)){
      const e=new Error("This locked voice predates a character identity change. Review and explicitly relock the voice before rendering.");
      e.name="StaleCharacterVoiceError"; throw e;
    }
  }
  if(typeof window.nbAssertMediaIdentity==="function")
    return window.nbAssertMediaIdentity(opts, phase||"voice");
  const ids=opts.identityCharacterIds||opts.characterIds;
  if(!c && !(ids&&ids.length) && !(opts.identityCast&&opts.identityCast.length)) return true;
  let r;
  try{
    const ctx=opts.identityContext||{ characterIds:ids||(c&&c.id?[c.id]:[]),
      scenes:opts.identityScenes, drafts:opts.identityDrafts,
      ...(opts.identityCast&&opts.identityCast.length ? {cast:opts.identityCast} : (c ? {cast:[c]} : {})) };
    if(c&&typeof window.turnAssertCharacterIdentity==="function") r=window.turnAssertCharacterIdentity(c,ctx);
    else if(typeof window.turnAssertProjectIdentity==="function") r=window.turnAssertProjectIdentity(ctx);
  }catch(e){
    if(e && e.identityReport && e.identityReport.status==="unset"
      && !c && !(ids&&ids.length)) return true;
    throw e instanceof Error ? e : new Error(String(e&&e.message||e));
  }
  if(r===false || (r&&(r.ok===false||r.valid===false||r.blocked))) throw new Error(String(r.message||"Character identity needs review before rendering."));
  return r;
}
window.vgAssertIdentity=vgAssertIdentity;

// ---- the proxy call (task:"voice") ------------------------------------------
async function vgProxy(op, payload){
  vgAssertIdentity(payload, "voice-provider-start");
  if(!voiceProxyReady()) throw new Error("Voice runs through your server proxy — sign in and make sure Supabase + the proxy are configured.");
  const sb = window.sbClient();
  const fnName = (window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxyFn) || "image-proxy";
  let data, error;
  vgAssertIdentity(payload, "voice-provider-submit");
  try{ ({ data, error } = await sb.functions.invoke(fnName, { body:{ task:"voice", op, ...(payload||{}),
    userApiKeys: window.turnApiKeysForProxy ? window.turnApiKeysForProxy(["elevenlabs"]) : undefined } })); }
  catch(e){ error=e; }
  if(error){
    const status=(error&&error.context&&error.context.status)||error.status||0;
    const _safe = window.turnSafeError || (x=>x);
    if(status===401) throw new Error("Sign in to render voice — it runs on your server, not the browser.");
    if(status===404) throw new Error(_safe("The media proxy isn't deployed yet. Deploy supabase/functions/image-proxy (the voice route), then have an administrator set ELEVENLABS_API_KEY."));
    throw new Error(_safe("Couldn't reach the voice proxy: "+((error&&error.message)||"unknown error")+"."));
  }
  if(data && data.error){
    const raw = (window.turnSafeError||(x=>x))(data.error);
    const msg = vgVoiceUserError(raw, data.code, op);
    const e = new Error(msg);
    e.code = data.code || "";
    e.rawMessage = raw;
    throw e;
  }
  return data||{};
}

function vgVoiceUserError(message, code, op){
  const raw = String(message||"").trim();
  const blocked = code==="VOICE_PROVIDER_BILLING" || /\b(subscription|invoice|payment|billing)\b/i.test(raw);
  if(!blocked) return raw || "Voice generation failed.";
  const action = op==="design" ? "Voice design"
    : op==="saveVoice" ? "Saving this voice"
    : op==="listVoices" ? "The voice library"
    : op==="clone" ? "Voice cloning"
    : "Voice rendering";
  const adminHint = window.turnIsAdmin
    ? " Open the top-bar API Keys panel and save a working ElevenLabs key, or update the server ELEVENLABS_API_KEY secret."
    : " The platform voice account needs attention; try again later or use an already locked voice.";
  return action+" is paused because the voice-provider account has a billing issue."+adminHint;
}
window.vgVoiceUserError = vgVoiceUserError;

// Measure a rendered line off the audio itself (fallback when the route reports no timing).
function vgMeasureDuration(url){
  return new Promise(function(resolve){
    try{
      const a = new Audio();
      let done=false;
      const finish=(ms)=>{ if(done) return; done=true; resolve(ms); };
      a.addEventListener("loadedmetadata", ()=>{
        const s = Number(a.duration);
        finish(isFinite(s) && s>0 ? Math.round(s*1000) : 0);
      });
      a.addEventListener("error", ()=>finish(0));
      setTimeout(()=>finish(0), 8000);
      a.preload="metadata"; a.src=url;
    }catch(e){ resolve(0); }
  });
}

// ---- TTS one line: render + (with-timestamps) duration; cache by hash --------
async function elGenerate(id, text, opts){
  opts = opts||{};
  vgAssertIdentity(opts, "voice-generate-start");
  const voiceId=opts.voiceId; const t=String(text||"").trim();
  if(!voiceId) throw new Error("No locked voice for this character yet — lock one on their character card: The Art Room → Characters tab → the Voice button.");
  if(!t) return { audioUrl:"", durationMs:0 };
  const settings = { ...VG_DEFAULTS, ...(opts.settings||{}) };
  const modelId = opts.modelId || VG_TTS_MODEL;
  const hash = vgHash(t, voiceId, { ...settings, modelId });
  const voiceSignature = vgVoiceLockSignature(opts.voiceLock||{
    voiceId,modelId,modelChosen:true,defaults:settings
  });
  // skip-if-unchanged: same text+voice+settings already rendered for this id → reuse
  if(id && !opts.force){
    const url = vgGetAudio(id,opts.projectId) || await vgLoadAudio(id,opts.projectId);
    const meta = vgGetMeta(id,opts.projectId);
    if(url && meta && meta.hash===hash) return { ...meta,audioUrl:url,cached:true };
  }
  vgAssertIdentity(opts, "voice-before-submit");
  const d = await vgProxy("tts", { voiceId, text:t, modelId, settings, outputFormat:VG_OUTPUT_FORMAT,
    identityCharacter:opts.identityCharacter||opts.character,
    identityCharacterIds:opts.identityCharacterIds||opts.characterIds,
    identityContext:opts.identityContext, identityCast:opts.identityCast });
  if(!d.audioB64) throw new Error("The proxy returned no audio.");
  const audioUrl = "data:"+(d.mime||"audio/mpeg")+";base64,"+d.audioB64;
  // Duration is the cut clock — every route must yield one. The with-timestamps route
  // reports it; routes that don't get measured off the decoded audio instead.
  let durationMs = d.durationMs||0;
  if(!durationMs) durationMs = await vgMeasureDuration(audioUrl);
  vgAssertIdentity(opts, "voice-before-commit");
  const meta = { durationMs, voiceId, text:t, modelId, settings, hash, voiceSignature,
    projectId:opts.projectId||"",
    provider:d.via||d.provider||"elevenlabs", backend:d.via||d.backend||"elevenlabs",
    outputFormat:VG_OUTPUT_FORMAT, renderedAt:new Date().toISOString(), alignment:d.alignment||null,
    fileName:opts.fileName||"",assetRole:opts.assetRole||"",
    characterId:opts.characterId||"",characterName:opts.characterName||"" };
  if(id) await elCommit(id, audioUrl, meta);
  return { ...meta,audioUrl,cached:false };
}
window.elGenerate=elGenerate;

/* Render the one durable, human-auditionable master sample for a canonical voice.
   Scene dialogue never reuses these words: it renders each screenplay line through
   the same voiceId. The sample is proof/download of that identity, with a stable
   character-named file and the same model/settings fingerprint used by production. */
async function elGenerateVoiceMaster(character,lock,opts){
  opts=opts||{};
  if(!character||!character.id)throw new Error("The voice master needs a character.");
  if(!lock||!lock.voiceId)throw new Error("Lock this character's voice before generating its master sample.");
  const assetId=vgVoiceMasterAssetId(character.id),fileName=vgVoiceMasterFileName(character.name);
  const r=await elGenerate(assetId,VG_VOICE_MASTER_TEXT,{
    ...opts,
    voiceId:lock.voiceId,settings:lock.defaults,modelId:vgDeliveryModelOf(lock),voiceLock:lock,
    projectId:opts.projectId||vgProjectScope(),fileName,assetRole:"character_voice_master",
    characterId:character.id,characterName:character.name||"Character"
  });
  return {...r,assetId,fileName,text:VG_VOICE_MASTER_TEXT};
}
window.elGenerateVoiceMaster=elGenerateVoiceMaster;

// ---- New Story "Talk it through" voice: one-off speak (no caching/commit) + transcribe ----
// Resolve a default interviewer voice once: the account's first voice, else a known public one.
let _interviewVoiceId = "";
async function elInterviewVoiceId(){
  if(_interviewVoiceId) return _interviewVoiceId;
  try{ const r = await elListVoices(); const v = r && r.voices && r.voices[0]; if(v && v.voiceId) _interviewVoiceId = v.voiceId; }catch(e){}
  if(!_interviewVoiceId) _interviewVoiceId = "21m00Tcm4TlvDq8ikWAM";   // ElevenLabs default ("Rachel")
  return _interviewVoiceId;
}
// speak one line and return an audio data URL — NOT committed to the asset store (ephemeral).
async function elSpeak(text, opts){
  opts = opts||{}; const t = String(text||"").trim(); if(!t) return "";
  vgAssertIdentity(opts, "voice-speak-start");
  const voiceId = opts.voiceId || await elInterviewVoiceId();
  const settings = { ...VG_DEFAULTS, ...(opts.settings||{}) };
  vgAssertIdentity(opts, "voice-speak-submit");
  const d = await vgProxy("tts", { voiceId, text:t, modelId:opts.modelId||VG_TTS_MODEL, settings, outputFormat:VG_OUTPUT_FORMAT,
    identityCharacter:opts.identityCharacter||opts.character, identityCharacterIds:opts.identityCharacterIds||opts.characterIds,
    identityContext:opts.identityContext, identityCast:opts.identityCast });
  if(!d.audioB64) throw new Error("The proxy returned no audio.");
  return "data:"+(d.mime||"audio/mpeg")+";base64,"+d.audioB64;
}
// transcribe recorded audio (base64 + mime) → text, via the proxy's ElevenLabs Scribe route.
async function elTranscribe(audioB64, mime){
  if(!audioB64) return "";
  const d = await vgProxy("stt", { audioB64, mime: mime||"audio/webm" });
  return String(d.text||"").trim();
}
window.elInterviewVoiceId=elInterviewVoiceId; window.elSpeak=elSpeak; window.elTranscribe=elTranscribe;

// ---- Voice Design: previews to audition before locking ----------------------
// The proxy defaults to the v3 design model (eleven_ttv_v3) for better accent and
// character adherence; guidanceScale/loudness/quality/seed pass through when given.
async function elDesignVoice(description, opts){
  opts=opts||{};
  vgAssertIdentity(opts, "voice-design-start");
  vgAssertIdentity(opts, "voice-design-submit");
  const d = await vgProxy("design", { description:String(description||""), text:opts.text, modelId:opts.modelId,
    guidanceScale:opts.guidanceScale, loudness:opts.loudness, quality:opts.quality, seed:opts.seed,
    identityCharacter:opts.identityCharacter||opts.character, identityCharacterIds:opts.identityCharacterIds||opts.characterIds,
    identityContext:opts.identityContext, identityCast:opts.identityCast });
  return (d.previews||[]).map(p=>({
    generatedVoiceId: p.generatedVoiceId,
    audioUrl: p.audioB64 ? ("data:"+(p.mime||"audio/mpeg")+";base64,"+p.audioB64) : "",
    auditionText:p.text||d.text||opts.text||"",
    seed:opts.seed!=null?opts.seed:null,
    designModel:opts.modelId||"eleven_ttv_v3",
  })).filter(p=>p.generatedVoiceId);
}
// lock a chosen preview into a permanent voiceId (the identity lock)
async function elSaveVoice(generatedVoiceId, opts){
  opts=opts||{};
  vgAssertIdentity(opts, "voice-save-start");
  const d = await vgProxy("saveVoice", { generatedVoiceId, name:opts.name, description:opts.description,
    identityCharacter:opts.identityCharacter||opts.character, identityCharacterIds:opts.identityCharacterIds||opts.characterIds,
    identityContext:opts.identityContext, identityCast:opts.identityCast });
  if(!d.voiceId) throw new Error("Couldn't save that voice — try another preview.");
  return { voiceId:d.voiceId, name:d.name||opts.name };
}
// the account's voices (the "picked from library" origin)
async function elListVoices(opts){
  opts=opts||{}; vgAssertIdentity(opts, "voice-list-start");
  const d = await vgProxy("listVoices", { identityCharacter:opts.identityCharacter||opts.character,
    identityCharacterIds:opts.identityCharacterIds||opts.characterIds, identityContext:opts.identityContext, identityCast:opts.identityCast });
  return d.voices||[];
}
// instant clone from samples (consent-gated on the client, like a cameo face)
async function elCloneVoice(samples, opts){
  opts=opts||{};
  vgAssertIdentity(opts, "voice-clone-start");
  if(!samples || !samples.length) throw new Error("Add at least one voice sample to clone.");
  vgAssertIdentity(opts, "voice-clone-submit");
  const d = await vgProxy("clone", { samples, name:opts.name, description:opts.description,
    identityCharacter:opts.identityCharacter||opts.character, identityCharacterIds:opts.identityCharacterIds||opts.characterIds,
    identityContext:opts.identityContext, identityCast:opts.identityCast });
  if(!d.voiceId) throw new Error("Cloning failed — check the samples and try again.");
  return { voiceId:d.voiceId, name:d.name||opts.name };
}
window.elDesignVoice=elDesignVoice; window.elSaveVoice=elSaveVoice;
window.elListVoices=elListVoices; window.elCloneVoice=elCloneVoice;

// ---- React hook (mirrors useImageGen) — one line's audio, by asset id --------
function useVoiceGen(id){
  const [audioUrl,setAudioUrl]=React.useState(()=>vgGetAudio(id));
  const [durationMs,setDurationMs]=React.useState(()=>(vgGetMeta(id)||{}).durationMs||0);
  const [meta,setMeta]=React.useState(()=>vgGetMeta(id)||null);
  const [gening,setGening]=React.useState(false);
  const [err,setErr]=React.useState("");
  const idRef=React.useRef(id); idRef.current=id;

  React.useEffect(()=>{ let alive=true;
    const sync=vgGetAudio(id),syncMeta=vgGetMeta(id);
    if(sync){ setAudioUrl(sync); setDurationMs((syncMeta||{}).durationMs||0); setMeta(syncMeta||null); }
    else{ vgLoadAudio(id).then(u=>{ if(alive&&u){ const m=vgGetMeta(id); setAudioUrl(u); setDurationMs((m||{}).durationMs||0); setMeta(m||null); } }); }
    const onDone=(e)=>{ if(!alive||!e.detail||!e.detail.ids||e.detail.ids.indexOf(idRef.current)<0) return;
      const m=vgGetMeta(idRef.current); setAudioUrl(vgGetAudio(idRef.current)); setDurationMs((m||{}).durationMs||0); setMeta(m||null); };
    window.addEventListener("vg-audio-done", onDone);
    return ()=>{ alive=false; window.removeEventListener("vg-audio-done", onDone); };
  },[id]);

  const generate = React.useCallback(async (text, opts)=>{
    setGening(true); setErr("");
    try{ const r=await elGenerate(idRef.current, text, opts); setAudioUrl(r.audioUrl); setDurationMs(r.durationMs||0); setMeta(r); return r; }
    catch(e){ setErr(String((e&&e.message)||"Voice render failed.")); throw e; }
    finally{ setGening(false); }
  },[]);
  const clear = React.useCallback(async ()=>{ await vgClearAudio(idRef.current); setAudioUrl(""); setDurationMs(0); setMeta(null); },[]);

  return { audioUrl, durationMs, meta, gening, err, generate, clear };
}
window.useVoiceGen=useVoiceGen;

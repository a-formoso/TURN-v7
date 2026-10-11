/* voicegen.jsx — the VOICE generation + persistence layer for the Stage (audio-first).
   Structural twin of imagegen.jsx's nb* layer, for ElevenLabs audio instead of images.
   Every call goes through the SAME server-side Supabase proxy (the `image-proxy`
   Edge Function, task:"voice"), using the proxy's ELEVENLABS_API_KEY server secret,
   with admin API Keys able to override for testing. Local-first persistence (IndexedDB); in a cloud
   film every voiced line is also a film asset (window.cloudCommitAudio, 2026-10-09).

   Public surface (mirrors the plan):
     elGenerate(id, text, {voiceId, settings, modelId, force}) -> {audioUrl, durationMs, alignment, cached}
     elDesignVoice(description, {text, modelId})  -> [{generatedVoiceId, audioUrl}]   (audition)
     elSaveVoice(generatedVoiceId, {name, description}) -> {voiceId}                  (the lock)
     elListVoices()                               -> [{voiceId, name, ...}]           (library)
     elListVoicesFull()                           -> {voices, customVoices:{used, limit}, realVoices:{used, limit}}
     elCloneVoice(samples[], {consent, removeNoise, meName}) -> {voiceId, name, kind, personKind, personName}
     elDeleteVoice(voiceId) / elAttachVoice(voiceId)                                  (real voices, free)
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
/* A VOICE LINE'S PRICE (2026-10-05, owner — Stage review): the server prices text-to-speech by
   characters (image-proxy billing-pricing.mjs: ttsPer1kChars $0.10, the fast models $0.05) and
   holds each line on its own, rounded up to whole credits — so a clip's total is the sum per line. */
function vgLineCredits(text, modelId){
  const chars = String(text||"").length;
  const per1k = /turbo|flash/i.test(String(modelId||"")) ? 0.05 : 0.10;
  const usd = chars/1000*per1k;
  return (typeof window.turnCreditCost==="function") ? window.turnCreditCost(usd) : Math.max(1, Math.ceil(usd/0.01 - 1e-9));
}
window.vgLineCredits = vgLineCredits;
/* DESIGNING OR CLONING A VOICE (2026-10-11, owner — real voices): a flat provider cost per call, the same
   table as image-proxy billing-pricing.mjs VOICE_USD (design / clone $0.10), turned into whole credits by the
   app's live credit unit (pricing.jsx turnCreditCost) — so "Clone voice · 10 credits" follows the unit. */
const VG_VOICE_OP_USD = { design:0.10, clone:0.10 };
function vgVoiceOpCredits(op){
  const usd = VG_VOICE_OP_USD[op==="clone" ? "clone" : "design"];
  return (typeof window.turnCreditCost==="function") ? window.turnCreditCost(usd) : Math.max(1, Math.ceil(usd/0.01 - 1e-9));
}
window.VG_VOICE_OP_USD = VG_VOICE_OP_USD;
window.vgVoiceOpCredits = vgVoiceOpCredits;
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
// a write the browser aborts (storage full) rejects too — it used to leave the promise hanging (2026-10-09)
function vgIdbSet(k,v){ return vgIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VGIDB_STORE,"readwrite"); tx.objectStore(VGIDB_STORE).put(v,k); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error||new Error("The browser's storage refused the write.")); })); }
function vgIdbGet(k){ return vgIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VGIDB_STORE,"readonly"); const r=tx.objectStore(VGIDB_STORE).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function vgIdbDel(k){ return vgIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VGIDB_STORE,"readwrite"); tx.objectStore(VGIDB_STORE).delete(k); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error||new Error("The browser's storage refused the change.")); })); }

// in-memory mirror for instant SYNC reads (mirrors imagegen's _nbImgMemory)
const _vgMem = new Map();          // project:id -> { url, meta }
function vgProjectScope(projectId){ return String(projectId||window.__turnCurrentProjectId||"local"); }
function vgMemKey(id,projectId){ return vgProjectScope(projectId)+":"+id; }
function vgKey(id,projectId){ return "a:"+vgProjectScope(projectId)+":"+id; }

function vgGetAudio(id,projectId){ const e=_vgMem.get(vgMemKey(id,projectId)); return (e&&e.url)||""; }
function vgGetMeta(id,projectId){ const e=_vgMem.get(vgMemKey(id,projectId)); return (e&&e.meta)||null; }

/* ---- VOICED LINES LIVE WITH THE FILM (Stage editor review, 2026-10-09, decision B) -------------
   A voiced line used to stay in the browser that voiced it: every collaborator (and the owner on
   another device) saw "missing-bytes" and paid to voice it again. elCommit now also saves the bytes
   to the film (cloud.jsx cloudCommitAudio: one 'aud-<line id>-<who+render>' row per voicing + a Storage
   file in the voicer's own folder), and a line whose bytes aren't on this device is fetched from the
   film: the film's audio rows load ONCE per film open (cloudAudioLoadAll, one query; the voicing whose
   hash matches the line's render record is used), the bytes only for a line that needs them (a signed URL; size and
   SHA-256 checked), then cached in IndexedDB. The usual lineage checks (vgLineAudioStatus: words,
   voice, render fingerprint, film) still decide whether the bytes may ride a render. Local mode and
   a film opened without the cloud keep the device-only behaviour. */
function _vgCloudScope(projectScope){
  if(typeof window.nbCloudScope!=="function") return null;
  const sc = window.nbCloudScope();
  if(!sc || sc.projectId==null || sc.uid==null) return null;
  return String(sc.projectId)===String(projectScope) ? sc : null;
}
const _vgCloudIdx = new Map();        // projectId -> Promise<{ 'aud-…': {path, meta, owner} } | null>
function vgCloudIndex(projectId){
  const pid = String(projectId);
  if(typeof window.cloudAudioLoadAll!=="function") return Promise.resolve(null);
  if(!_vgCloudIdx.has(pid)){
    const p = Promise.resolve().then(()=>window.cloudAudioLoadAll(pid)).catch(()=>null).then(r=>{
      if(!r && _vgCloudIdx.get(pid)===p) _vgCloudIdx.delete(pid);   // a failed read is asked again later
      if(r) _vgCloudFlushUnsynced(pid);
      return r || null;
    });
    _vgCloudIdx.set(pid, p);
  }
  return _vgCloudIdx.get(pid);
}
function _vgCloudKey(id){ return typeof window.cloudAudioEntityId==="function" ? window.cloudAudioEntityId(id) : "aud-"+id; }
/* a line's voicings in the film (one row per person + render): [{ key, path, meta, owner }] */
function _vgCloudRecs(idx, id){
  const out=[], base=_vgCloudKey(id);
  Object.keys(idx||{}).forEach(key=>{
    const rec=idx[key], m=(rec&&rec.meta)||{};
    if(rec && (String(m.lineId==null ? "" : m.lineId)===String(id) || (m.lineId==null && key===base))) out.push({ key, ...rec });
  });
  return out;
}
/* the voicing to use: the one whose hash matches the line's render record when it is known (others
   are ignored), else the newest */
function _vgCloudPick(recs, hash){
  if(hash) return recs.find(r=>r.meta && r.meta.hash===hash) || null;
  return recs.slice().sort((a,b)=>String((b.meta||{}).renderedAt||"").localeCompare(String((a.meta||{}).renderedAt||"")))[0] || null;
}
// the film's copy is the one to use when this device has none, or an older render of another take on it
function _vgCloudNewer(remoteMeta, localMeta){
  const rm = remoteMeta||{}, lm = localMeta||{};
  if(rm.hash && lm.hash && rm.hash===lm.hash) return false;
  const r = String(rm.renderedAt||""), l = String(lm.renderedAt||"");
  return !!r && (!l || r>l);
}
async function _vgBlobToDataUrl(blob){
  if(typeof FileReader!=="undefined") return new Promise((res,rej)=>{
    const r = new FileReader(); r.onload = ()=>res(String(r.result||"")); r.onerror = ()=>rej(r.error); r.readAsDataURL(blob); });
  const u8 = new Uint8Array(await blob.arrayBuffer()); let bin = "";
  for(let i=0;i<u8.length;i+=0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i+0x8000));
  return "data:"+(blob.type||"audio/mpeg")+";base64,"+btoa(bin);
}
const _vgCloudFetching = new Map();   // project:id -> promise (one download per line at a time)
function _vgCloudFetch(id, scope, rec){
  const memKey = vgMemKey(id,scope);
  if(_vgCloudFetching.has(memKey)) return _vgCloudFetching.get(memKey);
  const p = (async ()=>{
    if(typeof window.cloudAudioDownload!=="function") return "";
    const m = rec.meta || {};
    if(m.projectId && String(m.projectId)!==String(scope)) return "";   // another film's line: never
    const blob = await window.cloudAudioDownload(scope, rec);
    if(!blob || !_vgCloudScope(scope)) return "";
    const url = await _vgBlobToDataUrl(blob);
    if(!/^data:audio\//i.test(url) || !_vgCloudScope(scope)) return "";
    const meta = { ...m, cloudPath:rec.path };
    _vgMem.set(memKey, { url, meta });
    try{ await vgIdbSet(vgKey(id,scope), { url, meta }); }catch(e){}
    return url;
  })().catch(()=>"").then(u=>{ _vgCloudFetching.delete(memKey); return u; });
  _vgCloudFetching.set(memKey, p);
  return p;
}
/* lines voiced on this device that didn't reach the film yet (a network failure): saved again the next
   time the film's audio loads. A refusal is never retried. */
const VG_UNSYNCED_KEY = "turn_vg_unsynced";
function _vgUnsyncedAll(){ try{ return JSON.parse(localStorage.getItem(VG_UNSYNCED_KEY)||"{}")||{}; }catch(e){ return {}; } }
function _vgUnsyncedMark(projectId, id, on){
  try{
    const m = _vgUnsyncedAll(), l = new Set(m[projectId]||[]);
    if(on) l.add(String(id)); else l.delete(String(id));
    if(l.size) m[projectId] = Array.from(l).slice(-200); else delete m[projectId];
    localStorage.setItem(VG_UNSYNCED_KEY, JSON.stringify(m));
  }catch(e){}
}
let _vgFlushing = false;
async function _vgCloudFlushUnsynced(projectId){
  if(_vgFlushing) return;
  const ids = (_vgUnsyncedAll()[projectId]||[]).slice();
  if(!ids.length) return;
  _vgFlushing = true;
  try{
    for(const id of ids){
      const sc = _vgCloudScope(projectId); if(!sc) break;
      let v = null; try{ v = await vgIdbGet(vgKey(id,projectId)); }catch(e){}
      if(!v || !/^data:audio\//i.test(String(v.url||""))){ _vgUnsyncedMark(projectId, id, false); continue; }
      await _vgCloudSave(id, v.url, v.meta||null, projectId, sc, true);
    }
  }finally{ _vgFlushing = false; }
}
let _vgCloudToastAt = 0;
async function _vgCloudSave(id, dataUrl, meta, scope, sc, quiet){
  try{
    const r = await window.cloudCommitAudio(id, dataUrl, meta, { projectId:sc.projectId, uid:sc.uid });
    _vgUnsyncedMark(scope, id, false);
    if(r && r.path){
      const memKey = vgMemKey(id,scope), merged = { ...(meta||{}), ...(r.meta||{}), cloudPath:r.path };
      const cur = _vgMem.get(memKey);
      if(cur && cur.url===dataUrl) _vgMem.set(memKey, { url:dataUrl, meta:merged });
      try{ const v = await vgIdbGet(vgKey(id,scope)); if(v && v.url===dataUrl) await vgIdbSet(vgKey(id,scope), { url:dataUrl, meta:merged }); }catch(e){}
      const idx = _vgCloudIdx.has(String(scope)) ? await _vgCloudIdx.get(String(scope)) : null;
      if(idx && r.entityId){
        // this person's older voicings of the line are gone from the film now (cloudCommitAudio)
        _vgCloudRecs(idx, id).forEach(x=>{ if(x.key!==r.entityId && String(x.path||"").indexOf(String(sc.uid)+"/")===0) delete idx[x.key]; });
        idx[r.entityId] = { path:r.path, meta:r.meta||merged, owner:sc.uid };
      }
    }
    return true;
  }catch(e){
    const refused = typeof window.cloudPermissionRefused==="function" ? window.cloudPermissionRefused(e)
      : /42501|row-level security|permission denied|TURN_TEAM:|TURN_ROLE_SCOPE/i.test(String((e&&e.code)||"")+" "+String((e&&e.message)||""));
    _vgUnsyncedMark(scope, id, !refused);
    if(!quiet && Date.now()-_vgCloudToastAt > 30000 && typeof window.appToast==="function"){
      _vgCloudToastAt = Date.now();
      window.appToast(refused
        ? "This line's voice couldn't be saved to the film — your access to it changed. It stays on this device."
        : "Couldn't save this line's voice to the film — it's safe on this device and will be saved again when the film reopens.",
        refused ? "error" : "info");
    }
    return false;
  }
}
/* opts.hash (Stage editor review, 2026-10-09): the line's render record (lineAudio.hash) — the film's
   voicing with that hash is the one fetched; without it, the newest voicing of the line */
async function vgLoadAudio(id,projectId,opts){
  const scope=vgProjectScope(projectId),memKey=vgMemKey(id,scope);
  const want=opts && opts.hash ? String(opts.hash) : "";
  const sync=vgGetAudio(id,scope);
  if(sync && (!want || (vgGetMeta(id,scope)||{}).hash===want)) return sync;
  let local=null;
  try{
    let v=await vgIdbGet(vgKey(id,scope));
    // One-time read compatibility for audio created before film-scoped keys. The
    // Stage lineage guard still validates its text/voice/hash before attachment.
    if(!v)v=await vgIdbGet("a:"+id);
    if(v&&v.meta&&v.meta.projectId&&String(v.meta.projectId)!==scope)return "";
    if(v && v.url) local=v;
  }catch(e){}
  // the film's copy, when this device has none (or an older render) — Stage editor review, 2026-10-09
  if(_vgCloudScope(scope)){
    try{
      const idx=await vgCloudIndex(scope), rec=idx && _vgCloudPick(_vgCloudRecs(idx, id), want);
      const localHash=local && local.meta && local.meta.hash;
      if(rec && (!local || (want ? localHash!==want : _vgCloudNewer(rec.meta, local.meta)))){
        const u=await _vgCloudFetch(id, scope, rec);
        if(u) return u;
      }
    }catch(e){}
  }
  if(local){ _vgMem.set(memKey,{url:local.url,meta:local.meta||null}); return local.url; }
  return sync || "";
}
window.vgGetAudio=vgGetAudio; window.vgGetMeta=vgGetMeta; window.vgLoadAudio=vgLoadAudio;
window.vgCloudIndex=vgCloudIndex;
// drop the in-memory line-audio cache (call on project switch so no audio leaks across films)
function vgResetAll(){ _vgMem.clear(); _vgCloudIdx.clear(); }
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
  /* the device copy first; then the film's (Stage editor review, 2026-10-09): the bytes stay a data URL
     here — a signed link expires — and the film's file path rides the meta (cloudPath) */
  _vgMem.set(memKey, { url:dataUrl, meta:meta||null });
  try{ await vgIdbSet(vgKey(id,scope), { url:dataUrl, meta:meta||null }); }catch(e){}
  if(typeof window.cloudCommitAudio==="function" && typeof window.nbBackend==="function" && window.nbBackend()==="cloud"){
    const sc=_vgCloudScope(scope);
    if(sc) await _vgCloudSave(id, dataUrl, meta, scope, sc, false);
  }
  try{ window.dispatchEvent(new CustomEvent("vg-audio-done",{ detail:{ ids:[id] } })); }catch(e){}
  return { url:dataUrl };
}
async function vgClearAudio(id){
  const scope=vgProjectScope();
  _vgMem.delete(vgMemKey(id,scope));
  try{ await vgIdbDel(vgKey(id,scope)); }catch(e){}
  _vgUnsyncedMark(scope, id, false);
  /* the film's copies go too — only this person's own voicings (files in their own folder), never
     someone else's, the owner's included; a refusal is ignored quietly (Stage editor review, 2026-10-09) */
  const sc=_vgCloudScope(scope);
  if(sc && typeof window.cloudDeleteAudio==="function"){
    try{
      const idx=await vgCloudIndex(scope), own=String(sc.uid)+"/"+String(sc.projectId)+"/stage-audio/";
      for(const rec of _vgCloudRecs(idx, id)){
        if(String(rec.path||"").indexOf(own)!==0) continue;
        const r=await window.cloudDeleteAudio(sc.projectId, rec.key, sc.uid);
        if(r && r.ok && idx) delete idx[rec.key];
      }
    }catch(e){}
  }
  try{ window.dispatchEvent(new CustomEvent("vg-audio-done",{ detail:{ ids:[id] } })); }catch(e){}
}
window.elCommit=elCommit; window.vgClearAudio=vgClearAudio;

/* ---- Mix beds (owner 2026-10-05 — Stage review: "persist the Mix") -----------
   An imported ambience / music file per SCENE, kept with the film on this device
   (the same per-film IndexedDB store as the voiced lines) so the Mix and the film
   export find it again after a reload. Never sent anywhere. */
const VG_MIX_BED_MAX_BYTES = 50*1024*1024;
function vgMixBedId(sceneId, kind){ return "mix-bed:"+String(sceneId||"scene")+":"+(kind==="music"?"music":"amb"); }
/* (2026-10-09, owner — Mix review) a bed is kept as the FILE itself (a Blob) and played from an object URL —
   a 50 MB file used to become a ~67 MB text string held in memory; older saved beds (text) still load.
   projectId: the film the user acted in, captured when they acted — a save or removal that finishes after
   a film switch used to land in the newly opened film. */
async function vgSaveMixBed(sceneId, kind, data, name, projectId){
  const scope=vgProjectScope(projectId), id=vgMixBedId(sceneId, kind);
  const isBlob = typeof Blob!=="undefined" && data instanceof Blob;
  const meta={ kind:"mix-bed", bed:(kind==="music"?"music":"amb"), sceneId:String(sceneId||""), name:String(name||"").slice(0,120), projectId:scope, iso:new Date().toISOString(),
    ...(isBlob ? { type:String(data.type||""), bytes:data.size } : {}) };
  const stored = isBlob ? { blob:data, meta } : { url:String(data||""), meta };
  const live = isBlob ? { url:URL.createObjectURL(data), meta } : stored;
  const prev=_vgMem.get(vgMemKey(id,scope)); _vgRevokeBedUrl(prev);
  _vgMem.set(vgMemKey(id,scope), live);
  await vgIdbSet(vgKey(id,scope), stored);
  return live;
}
function _vgRevokeBedUrl(v){ try{ if(v && v.url && /^blob:/.test(v.url)) URL.revokeObjectURL(v.url); }catch(e){} }
async function vgLoadMixBed(sceneId, kind, projectId){
  const scope=vgProjectScope(projectId), id=vgMixBedId(sceneId, kind), mem=_vgMem.get(vgMemKey(id,scope));
  if(mem && mem.url) return mem;
  try{
    const v=await vgIdbGet(vgKey(id,scope));
    if(!v || !(v.url || v.blob)) return null;
    if(v.meta && v.meta.projectId && String(v.meta.projectId)!==scope) return null;
    const live = v.blob ? { url:URL.createObjectURL(v.blob), meta:v.meta||{} } : v;
    _vgMem.set(vgMemKey(id,scope), live); return live;
  }catch(e){ return null; }
}
async function vgClearMixBed(sceneId, kind, projectId){
  const scope=vgProjectScope(projectId), id=vgMixBedId(sceneId, kind);
  _vgRevokeBedUrl(_vgMem.get(vgMemKey(id,scope)));
  _vgMem.delete(vgMemKey(id,scope));
  await vgIdbDel(vgKey(id,scope));
}
window.VG_MIX_BED_MAX_BYTES=VG_MIX_BED_MAX_BYTES; window.vgMixBedId=vgMixBedId;
window.vgSaveMixBed=vgSaveMixBed; window.vgLoadMixBed=vgLoadMixBed; window.vgClearMixBed=vgClearMixBed;

function vgAssertIdentity(opts, phase){
  opts=opts||{};
  const c=opts.identityCharacter||opts.character;
  const lock=opts.voiceLock||opts.voiceIdentity||null;
  /* A REAL PERSON'S VOICE (2026-10-11, owner — real voices) doesn't depend on the character's pronouns or
     identity text: a cloned lock never goes stale on an identity change (no re-clone). */
  if(c && lock && lock.source!=="cloned"){
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
/* opts.quiet (repair 2026-09-30): the New Story interview's voice is optional — the browser's own
   speech takes over when the paid voice is refused — so its calls never open the Plans window on a
   billing refusal; the error still carries .billing for the caller's fallback. */
async function vgProxy(op, payload, opts){
  vgAssertIdentity(payload, "voice-provider-start");
  if(!voiceProxyReady()) throw new Error("Voice runs through your server proxy — sign in and make sure Supabase + the proxy are configured.");
  const sb = window.sbClient();
  const fnName = (window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxyFn) || "image-proxy";
  let data, error;
  vgAssertIdentity(payload, "voice-provider-submit");
  try{ ({ data, error } = await sb.functions.invoke(fnName, { body:{ ...(typeof window.turnFilmContext==="function" && window.turnFilmContext() ? { context:window.turnFilmContext() } : {}), task:"voice", op, ...(payload||{}),
    userApiKeys: window.turnApiKeysForProxy ? window.turnApiKeysForProxy(["elevenlabs"]) : undefined } })); }
  catch(e){ error=e; }
  if(error){
    const status=(error&&error.context&&error.context.status)||error.status||0;
    const _safe = window.turnSafeError || (x=>x);
    /* VOICE IS CHARGED ON THE SERVER (billing fixes, 2026-09-30): image-proxy holds the
       line's credits before calling the voice provider and refunds them if it fails. Its
       billing refusals (402 no plan / not enough credits, a frozen account, a plan-only
       feature) become one calm sentence; credit/plan refusals open the Plans window. */
    let body=null;
    const ctx=error&&error.context;
    if(ctx && typeof ctx.json==="function"){
      try{ body=await (typeof ctx.clone==="function" ? ctx.clone() : ctx).json(); }catch(e){}
    }
    const billing=(typeof window.turnBillingError==="function") ? window.turnBillingError(body, status) : null;
    if(billing){
      const quiet = !!(opts && opts.quiet);
      const msg=(!quiet && typeof window.turnHandleBillingError==="function") ? window.turnHandleBillingError(billing) : billing.message;
      const e=new Error(msg||billing.message);
      e.code=billing.code; e.billing=billing.code; e.status=status;
      throw e;
    }
    // a request the server refuses as it stands (400 — say, a recording it can't read or one longer
    // than the app records): its own plain sentence, and the status, so the New Story interview can
    // switch to the browser's speech recognition quietly (billing round 5)
    /* A VOICE THE SERVER WON'T USE OR MAKE (2026-10-11, owner — real voices): the server's own plain sentence,
       with its code — whose voice it is, the recordings, the plan's number of real voices, a voice that isn't
       this account's or the film's, a deleted one. */
    if((status===400 || status===403) && body && VG_VOICE_REFUSAL_CODES.indexOf(String(body.code||""))>=0){
      const said=typeof body.error==="string" && body.error.trim() ? body.error.trim() : (typeof body.message==="string" ? body.message.trim() : "");
      const e=new Error(_safe(said || vgVoiceRefusalFallback(body.code)));
      e.code=String(body.code); e.status=status;
      throw e;
    }
    if(status===400){
      const said=body && typeof body.error==="string" && body.error.trim() && !/^[a-z_]+$/.test(body.error.trim()) ? body.error.trim()
        : (body && typeof body.message==="string" && body.message.trim() ? body.message.trim() : "");
      const e=new Error(_safe(said || "The voice service couldn't use this request."));
      e.code=String((body && body.code) || "bad_request"); e.status=400;
      throw e;
    }
    if(status===401) throw new Error("Sign in to render voice — it runs on your server, not the browser.");
    if(status===404) throw new Error(_safe("The media proxy isn't deployed yet. Deploy supabase/functions/image-proxy (the voice route), then have an administrator set ELEVENLABS_API_KEY."));
    throw new Error(_safe("Couldn't reach the voice proxy: "+((error&&error.message)||"unknown error")+"."));
  }
  if(data && data.error){
    const raw = (window.turnSafeError||(x=>x))(data.error) || (data.code ? vgVoiceRefusalFallback(data.code) : "");
    const msg = vgVoiceUserError(raw, data.code, op);
    const e = new Error(msg);
    e.code = data.code || "";
    e.rawMessage = raw;
    throw e;
  }
  // a paid voice call settled on the server — refresh the balance readout
  if(op==="tts" || op==="stt" || op==="design" || op==="clone"){
    try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason:"voice-"+op } })); }catch(e){}
  }
  return data||{};
}

const VG_VOICE_REFUSAL_CODES = ["consent_required","samples_invalid","voice_limit","voice_library_full","voice_not_allowed","voice_deleted","voice_verification","VOICE_SLOTS_FULL"];
function vgVoiceRefusalFallback(code){
  switch(String(code||"")){
    case "consent_required": return "Say whose voice this is, and confirm they agreed and are 18 or over.";
    case "samples_invalid": return "Those recordings can't be used. Record about a minute and a half of clear speech.";
    case "voice_limit": return "This account already has as many voices as its plan holds. Delete one in Voices to add another.";
    case "voice_library_full": return "New voices can't be added right now \u2014 the studio's voice library is full. Please try again later.";
    case "voice_not_allowed": return "This voice isn't available to this account. Choose another voice for this character.";
    case "voice_deleted": return "This voice was deleted. Choose another voice for this character.";
    case "voice_verification": return "This voice couldn't be cloned. Try another recording of the person's own voice.";
    case "VOICE_SLOTS_FULL": return "New voices can't be added right now. Please try again later.";
    default: return "The voice service couldn't use this request.";
  }
}
window.VG_VOICE_REFUSAL_CODES = VG_VOICE_REFUSAL_CODES;
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
// These calls are QUIET (vgProxy opts.quiet): a billing refusal never opens the Plans window — the
// interview falls back to the browser's own speech (app/newstory.jsx Voice adapter).
// Resolve a default interviewer voice once: the first STOCK voice of the library, else a known public one.
// (2026-10-11) elListVoices returns the list itself (it used to read r.voices of it, so it never found one), and
// the interviewer never speaks with a recorded voice — a real person's or a designed one — only a stock voice.
function vgPickStockVoice(list){
  const vs = Array.isArray(list) ? list : [];
  const stock = vs.filter(v=>v && v.voiceId && !v.own && !v.onFilm && !v.kind && !/^(cloned|generated|professional_clone)$/i.test(String(v.category||"")));
  return stock.find(v=>String(v.category||"")==="premade") || stock[0] || null;
}
window.vgPickStockVoice = vgPickStockVoice;
let _interviewVoiceId = "";
async function elInterviewVoiceId(){
  if(_interviewVoiceId) return _interviewVoiceId;
  try{ const v = vgPickStockVoice(await elListVoices({ quiet:true })); if(v && v.voiceId) _interviewVoiceId = v.voiceId; }
  catch(e){ if(e && e.billing) throw e; }   // refused for billing: no point asking for speech next
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
    identityContext:opts.identityContext, identityCast:opts.identityCast }, { quiet:true });
  if(!d.audioB64) throw new Error("The proxy returned no audio.");
  return "data:"+(d.mime||"audio/mpeg")+";base64,"+d.audioB64;
}
// transcribe recorded audio (base64 + mime) → text, via the proxy's ElevenLabs Scribe route.
async function elTranscribe(audioB64, mime){
  if(!audioB64) return "";
  const d = await vgProxy("stt", { audioB64, mime: mime||"audio/webm" }, { quiet:true });
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
  // a designed voice is one of the account's own voices too (they count together — 2026-10-11)
  if(_vgRealSeen) _vgRealSeen = { ..._vgRealSeen, used:_vgRealSeen.used+1 };
  _vgVoicesChanged("save");
  return { voiceId:d.voiceId, name:d.name||opts.name };
}
/* the voices this account may use (the "picked from library" origin): the provider's stock voices, the
   account's own recorded voices (own:true — designed or a real person's, kind "designed" / "cloned") and, with
   the film context, the film's linked voices (onFilm:true). customVoices { used, limit }: the account's OWN voices,
   designed and real together (the studio's voice plan holds a fixed number for everyone — owner 2026-10-11; Director 3,
   Producer 6, set on the server); realVoices { used, limit }: the real ones only (kept for older servers). limit null =
   no limit. The last answer is remembered for the Characters header (vgRealVoicesSeen: { used, real, limit }). */
let _vgRealSeen = null;
function vgRealVoicesSeen(){ return _vgRealSeen; }
window.vgRealVoicesSeen = vgRealVoicesSeen;
function _vgVoicesChanged(reason){ try{ window.dispatchEvent(new CustomEvent("vg-voices-changed",{ detail:{ reason } })); }catch(e){} }
async function elListVoicesFull(opts){
  opts=opts||{}; vgAssertIdentity(opts, "voice-list-start");
  const d = await vgProxy("listVoices", { identityCharacter:opts.identityCharacter||opts.character,
    identityCharacterIds:opts.identityCharacterIds||opts.characterIds, identityContext:opts.identityContext, identityCast:opts.identityCast },
    { quiet:!!opts.quiet });
  const voices = Array.isArray(d.voices) ? d.voices : [];
  const count = (x)=> x && typeof x==="object" ? { used:Math.max(0, Number(x.used)||0), limit:(x.limit==null ? null : Math.max(0, Number(x.limit)||0)) } : null;
  const realVoices = count(d.realVoices), customVoices = count(d.customVoices);
  const ownAll = voices.filter(v=>v && v.own && (v.kind==="cloned" || v.kind==="designed")).length;
  const ownReal = voices.filter(v=>v && v.own && v.kind==="cloned").length;
  _vgRealSeen = { used:customVoices ? customVoices.used : ownAll, real:realVoices ? realVoices.used : ownReal,
    limit:customVoices ? customVoices.limit : (realVoices ? realVoices.limit : null), at:Date.now() };
  _vgVoicesChanged("list");
  return { voices, customVoices, realVoices };
}
async function elListVoices(opts){
  return (await elListVoicesFull(opts)).voices;
}
/* A REAL PERSON'S VOICE (2026-10-11, owner — real voices): an instant clone from recordings. opts.consent
   { personKind:"me"|"someone", personName, adult:true, attest:true } is checked again on the server (and kept with
   the voice); opts.removeNoise asks the provider to clean the recordings; opts.meName labels a "me" voice. */
async function elCloneVoice(samples, opts){
  opts=opts||{};
  vgAssertIdentity(opts, "voice-clone-start");
  if(!samples || !samples.length) throw new Error("Add a recording of the voice to clone.");
  vgAssertIdentity(opts, "voice-clone-submit");
  const c = opts.consent || null;
  const consent = c ? { personKind:c.personKind, personName:c.personKind==="someone" ? String(c.personName||"").trim() : "",
    adult:c.adult===true, attest:c.attest===true } : undefined;
  const d = await vgProxy("clone", { samples, name:opts.name, description:opts.description,
    ...(consent ? { consent } : {}), removeNoise:opts.removeNoise===true,
    ...(opts.meName ? { meName:String(opts.meName).slice(0,80) } : {}),
    identityCharacter:opts.identityCharacter||opts.character, identityCharacterIds:opts.identityCharacterIds||opts.characterIds,
    identityContext:opts.identityContext, identityCast:opts.identityCast });
  if(!d.voiceId) throw new Error("The voice couldn't be cloned. Check the recordings and try again.");
  if(_vgRealSeen) _vgRealSeen = { ..._vgRealSeen, used:_vgRealSeen.used+1, real:(_vgRealSeen.real||0)+1 };
  _vgVoicesChanged("clone");
  return { voiceId:d.voiceId, name:d.name||opts.name||"", kind:d.kind||"cloned",
    personKind:d.personKind||(consent&&consent.personKind)||"", personName:d.personName!=null ? d.personName : ((consent&&consent.personName)||"") };
}
// delete one of this account's voices for good, at the provider too (free, any plan; only its owner)
async function elDeleteVoice(voiceId){
  const id = String(voiceId||"").trim();
  if(!id) throw new Error("Which voice?");
  const d = await vgProxy("deleteVoice", { voiceId:id });
  if(!(d && (d.deleted || d.ok))) throw new Error("The voice couldn't be deleted right now. Please try again.");
  if(_vgRealSeen) _vgRealSeen = { ..._vgRealSeen, used:Math.max(0, _vgRealSeen.used-1) };   // (a list reload corrects .real)
  _vgVoicesChanged("delete");
  return { ok:true, deleted:true };
}
/* link one of this account's voices (or the film's) to the open film, so everyone on it can voice lines with it
   (free). Without a film open there is nothing to link: { linked:false, skipped:true }. */
async function elAttachVoice(voiceId){
  const id = String(voiceId||"").trim();
  if(!id) throw new Error("Which voice?");
  const ctx = typeof window.turnFilmContext==="function" ? window.turnFilmContext() : null;
  if(!ctx || !ctx.projectId) return { ok:true, linked:false, skipped:true };
  const d = await vgProxy("attachVoice", { voiceId:id });
  return { ok:true, linked:!!(d && d.linked) };
}
window.elDesignVoice=elDesignVoice; window.elSaveVoice=elSaveVoice;
window.elListVoices=elListVoices; window.elListVoicesFull=elListVoicesFull; window.elCloneVoice=elCloneVoice;
window.elDeleteVoice=elDeleteVoice; window.elAttachVoice=elAttachVoice;

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

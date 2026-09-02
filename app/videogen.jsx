/* videogen.jsx — VIDEO generation (Seedance 2.0 via fal.ai) for the Stage, Phase 3.
   The async twin of voicegen.jsx: a shot FRAME + the locked-voice LINE AUDIO →
   a lip-synced clip. Runs through the SAME server proxy (image-proxy, task:"video"),
   using the proxy's FAL_KEY server secret, with admin API Keys able to override for testing.
   Videos take minutes, so the flow is
   SUBMIT → POLL (each proxy call is short; the waiting is the client's poll loop).
   See docs/Voice & Lip-Sync (Seedance) Plan.md §6A.

   Public surface:
     seedanceGenerate(id, { frameUrl, audioUrl, prompt, durationMs, aspectRatio,
                            resolution, fast, seed, generateAudio, endImageUrl,
                            force, onStatus, shouldCancel })
       -> { videoUrl, seed, cached }
     vidGetVideo(id) / vidGetMeta(id) / vidGetTakes(id) / vidLoadVideo(id) / vidLoadTakes(id) / vidClear(id)
     useSeedanceGen(id) -> { videoUrl, status, gening, err, generate, clear }
*/

const VID_MODEL      = "bytedance/seedance-2.0/reference-to-video";
const VID_MODEL_FAST = "bytedance/seedance-2.0/fast/reference-to-video";
// the dedicated image-to-video endpoint — used only for start->end frame transitions.
// reference-to-video's multi-asset shape (image_urls[]) has no confirmed end_image_url
// support; the singular image-to-video endpoint does, so a transition request switches
// to this pair instead of guessing at an undocumented field on the multimodal endpoint.
const VID_MODEL_I2V      = "bytedance/seedance-2.0/image-to-video";
const VID_MODEL_I2V_FAST = "bytedance/seedance-2.0/fast/image-to-video";
// Seedance 2.5 transition endpoint (verified live on fal 2026-08-07: supports
// end_image_url, 480p/720p, 4–30s). fal lists NO fast variant for 2.5, so the
// "fast" constant aliases the standard endpoint — the registry has no 2.5 fast
// tier, so it's never selected; the alias just makes a stale opts.fast harmless.
const VID25_MODEL_I2V      = "bytedance/seedance-2.5/image-to-video";
const VID25_MODEL_I2V_FAST = VID25_MODEL_I2V;
window.VID_MODEL = VID_MODEL; window.VID_MODEL_FAST = VID_MODEL_FAST;
window.VID_MODEL_I2V = VID_MODEL_I2V; window.VID_MODEL_I2V_FAST = VID_MODEL_I2V_FAST;

// video always runs server-side — proxy on + signed-in
function videoProxyReady(){
  return !!(window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxy
    && typeof window.sbClient==="function" && window.sbClient());
}
window.videoProxyReady = videoProxyReady;

// ---- local IndexedDB for rendered clip URLs + meta (the fal.media URL is a CDN link) ---
const VIDIDB_DB="turn-video", VIDIDB_STORE="video";
let _vidIdbPromise=null;
function vidIdbOpen(){
  if(_vidIdbPromise) return _vidIdbPromise;
  _vidIdbPromise = new Promise((res,rej)=>{
    try{
      if(!window.indexedDB){ rej(new Error("no idb")); return; }
      const req=indexedDB.open(VIDIDB_DB,1);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(VIDIDB_STORE)) db.createObjectStore(VIDIDB_STORE); };
      req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error);
    }catch(e){ rej(e); }
  });
  return _vidIdbPromise;
}
function vidIdbSet(k,v){ return vidIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VIDIDB_STORE,"readwrite"); tx.objectStore(VIDIDB_STORE).put(v,k); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); })); }
function vidIdbGet(k){ return vidIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VIDIDB_STORE,"readonly"); const r=tx.objectStore(VIDIDB_STORE).get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function vidIdbDel(k){ return vidIdbOpen().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(VIDIDB_STORE,"readwrite"); tx.objectStore(VIDIDB_STORE).delete(k); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); })); }

const _vidMem = new Map();      // id -> { url, meta }
function vidKey(id){ return "v:"+id; }
function vidGetVideo(id){ const e=_vidMem.get(id); return (e&&e.url)||""; }
function vidGetMeta(id){ const e=_vidMem.get(id); return (e&&e.meta)||null; }
function vidGetTakes(id){
  const e=_vidMem.get(id), out=[];
  if(e&&e.url) out.push({ id:id+":current", url:e.url, meta:e.meta||null, current:true });
  (((e&&e.meta&&e.meta.takes)||[])).forEach((t,i)=>{ if(t&&t.url) out.push({ id:id+":take-"+i, url:t.url, meta:t.meta||null, current:false }); });
  return out;
}
async function vidLoadVideo(id){
  const sync=vidGetVideo(id); if(sync) return sync;
  try{ const v=await vidIdbGet(vidKey(id)); if(v && v.url){ _vidMem.set(id,{url:v.url,meta:v.meta||null}); return v.url; } }catch(e){}
  return "";
}
async function vidLoadTakes(id){ await vidLoadVideo(id); return vidGetTakes(id); }
window.vidGetVideo=vidGetVideo; window.vidGetMeta=vidGetMeta; window.vidGetTakes=vidGetTakes; window.vidLoadVideo=vidLoadVideo; window.vidLoadTakes=vidLoadTakes;
// drop the in-memory clip cache (call on project switch so no video leaks across films)
function vidResetAll(){ _vidMem.clear(); }
window.vidResetAll=vidResetAll;

/* ── CLOUD SYNC — takes are PROJECT records, not browser state ────────────────
   A paid render that exists only in one browser profile is one cache-clear away
   from gone. Every take write below therefore lands in the film's cloud row
   (cloudCommitVideo → turn_generations, the same collaboration rules as images);
   IndexedDB stays as the fast local cache. A failed push marks the clip DIRTY
   (localStorage, per project), retries on the next write / film open / reconnect,
   and TELLS the user — never a silent catch. Local mode keeps IDB-only behavior. */
function vidScope(){ return (typeof window.nbCloudScope==="function") ? window.nbCloudScope() : null; }
const VID_DIRTY_KEY = "turn_vid_dirty";
function _vidDirtyAll(){ try{ return JSON.parse(localStorage.getItem(VID_DIRTY_KEY)||"{}")||{}; }catch(e){ return {}; } }
function _vidDirtySaveAll(m){ try{ localStorage.setItem(VID_DIRTY_KEY, JSON.stringify(m)); }catch(e){} }
function _vidDirtyMark(projectId, id, del){ const m=_vidDirtyAll(); const p=m[projectId]||(m[projectId]={}); p[id]= del?"del":"put"; _vidDirtySaveAll(m); }
function _vidDirtyClear(projectId, id){ const m=_vidDirtyAll(); if(m[projectId]){ delete m[projectId][id]; if(!Object.keys(m[projectId]).length) delete m[projectId]; _vidDirtySaveAll(m); } }
/* which clips THIS film has cloud take rows for (locally known) — lets hydrate
   detect REMOTE deletions without touching other films' caches. IndexedDB is
   shared across films, so a blind "not in the cloud answer" sweep would eat
   local-mode films' takes; the sweep below only ever visits ids on this list. */
const VID_IDS_KEY = "turn_vid_ids";
function _vidIdsAll(){ try{ return JSON.parse(localStorage.getItem(VID_IDS_KEY)||"{}")||{}; }catch(e){ return {}; } }
function _vidIdsMark(projectId, id, del){
  try{
    const m = _vidIdsAll(); const l = new Set(m[projectId]||[]);
    if(del) l.delete(id); else l.add(id);
    if(l.size) m[projectId] = [...l]; else delete m[projectId];
    localStorage.setItem(VID_IDS_KEY, JSON.stringify(m));
  }catch(e){}
}
let _vidSyncToastAt = 0;
async function _vidCloudPush(id, entry, scope){
  const sc = scope || vidScope(); if(!sc) return;               // local mode: IDB only
  _vidIdsMark(sc.projectId, id, !(entry && entry.url));         // intended membership, even if the push fails
  try{
    if(entry && entry.url){
      if(typeof window.cloudCommitVideo!=="function") throw new Error("cloud unavailable");
      await window.cloudCommitVideo(sc.projectId, sc.uid, id, entry);
    } else {
      if(typeof window.cloudVideoDelete!=="function") throw new Error("cloud unavailable");
      await window.cloudVideoDelete(sc.projectId, id);
    }
    _vidDirtyClear(sc.projectId, id);
  }catch(e){
    _vidDirtyMark(sc.projectId, id, !(entry && entry.url));
    if(Date.now()-_vidSyncToastAt > 30000 && typeof window.appToast==="function"){
      _vidSyncToastAt = Date.now();
      window.appToast("Couldn't save this clip's takes to the cloud — they're safe on this device and will re-sync automatically.","info");
    }
  }
}
/* re-push everything that failed for the CURRENT film (runs on film open,
   reconnect, and before hydrate so local edits win over stale cloud rows) */
async function vidCloudFlushDirty(){
  const sc = vidScope(); if(!sc) return 0;
  const m = { ...(_vidDirtyAll()[sc.projectId]||{}) };
  let n = 0;
  for(const id of Object.keys(m)){
    if(m[id]==="del") await _vidCloudPush(id, null, sc);
    else{
      const e = await _vidLoadEntry(id);
      if(e && e.url) await _vidCloudPush(id, e, sc);
      else _vidDirtyClear(sc.projectId, id);      // nothing local left to push
    }
    n++;
  }
  return n;
}
window.vidCloudFlushDirty = vidCloudFlushDirty;
/* pull the film's take records on open (the app calls this right after the image
   scope re-points). Cloud wins EXCEPT where a clip is locally dirty — those push
   up first. Queued like every store write so a mid-hydrate commit can't clobber. */
function vidCloudHydrate(){
  return _vidQueued(async ()=>{
    const sc = vidScope(); if(!sc) return 0;
    await vidCloudFlushDirty();
    const rows = (typeof window.cloudVideoLoadAll==="function") ? await window.cloudVideoLoadAll(sc.projectId) : null;
    if(!rows) return 0;
    const now = vidScope();                        // film switched while loading → drop
    if(!now || now.projectId!==sc.projectId) return 0;
    const dirty = _vidDirtyAll()[sc.projectId]||{};
    const ids = [];
    for(const id of Object.keys(rows)){
      if(dirty[id] || !rows[id] || !rows[id].url) continue;
      const e = { url:rows[id].url, meta:rows[id].meta||null };
      _vidMem.set(id, e);
      try{ await vidIdbSet(vidKey(id), e); }catch(err){}
      ids.push(id);
    }
    /* reconcile REMOTE DELETIONS: clips this film was known to have take rows
       for that the authoritative cloud answer no longer lists (and that aren't
       locally dirty) were cleared elsewhere — drop the local cache so they
       can't resurrect from IndexedDB on the next lazy load. */
    const known = (_vidIdsAll()[sc.projectId]||[]).slice();
    const removed = [];
    for(const id of known){
      if(rows[id] || dirty[id]) continue;
      _vidMem.delete(id);
      try{ await vidIdbDel(vidKey(id)); }catch(err){}
      _vidIdsMark(sc.projectId, id, true);
      removed.push(id);
    }
    for(const id of ids) _vidIdsMark(sc.projectId, id);
    const changed = ids.concat(removed);
    if(changed.length){ try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:changed } })); }catch(e){} }
    return ids.length;
  });
}
window.vidCloudHydrate = vidCloudHydrate;
try{ window.addEventListener("online", ()=>{ try{ vidCloudFlushDirty(); }catch(e){} }); }catch(e){}

/* ── RUN OWNERSHIP — Clear must beat an in-flight render ─────────────────────
   Clearing a clip bumps its run token. seedanceGenerate captures the token at
   start and re-checks it after the last await before committing, so a render
   that finishes AFTER "Clear" can never resurrect the clip (the old race:
   cleared clips came back when the poll landed). The paid-for result is
   disclosed, never silently swallowed. */
const _vidRunEpoch = new Map();   // id -> int
function vidRunToken(id){ return _vidRunEpoch.get(id)||0; }
function vidRunBump(id){ _vidRunEpoch.set(id, (0|_vidRunEpoch.get(id))+1); }
window.vidRunToken = vidRunToken; window.vidRunBump = vidRunBump;

// stable per-clip asset id (a sceneSequences group → one Seedance generation)
function clipVidId(sceneId, index){ return "clip-"+sceneId+"-"+index; }
window.clipVidId=clipVidId;
/* CONTENT-STABLE clip id — derived from the MEMBER SHOTS, not the position. Positional
   ids migrate: re-voicing a line changes its duration, repacking shifts every later
   clip's index, and clip #2's takes suddenly display under a different shot group.
   Hashing the shot ids means a clip keeps its takes as long as it's the same shots. */
function clipStableId(sceneId, shots){
  const key = (shots||[]).map(s=>s&&s.id).filter(Boolean).join("|");
  let h=5381; for(let i=0;i<key.length;i++){ h=((h<<5)+h+key.charCodeAt(i))|0; }
  return "clip-"+sceneId+"-s"+(h>>>0).toString(36);
}
window.clipStableId=clipStableId;
/* one-time MIGRATION: takes saved under the old positional id move to the stable id
   the first time the clip is seen (queued like every store write; no-op afterwards). */
function vidAdoptTakes(id, legacyId){
  if(!id || !legacyId || id===legacyId) return Promise.resolve(null);
  return _vidQueued(async ()=>{
    const cur = await _vidLoadEntry(id);
    if(cur && cur.url) return null;                      // already migrated / has its own takes
    const old = await _vidLoadEntry(legacyId);
    if(!old || !old.url) return null;
    await _vidWriteEntry(id, old);
    _vidMem.delete(legacyId);
    try{ await vidIdbDel(vidKey(legacyId)); }catch(e){}
    await _vidCloudPush(legacyId, null);   // retire the old positional cloud row too
    return { migrated:true };
  });
}
window.vidAdoptTakes=vidAdoptTakes;

// skip-if-unchanged: same assets + prompt + settings → reuse the existing clip
function vidHash(assets, prompt, settings){
  const tail = (u)=> String(u||"").slice(-120);
  const a = Array.isArray(assets)
    ? assets.map(tail)
    : [tail(assets&&assets.frameUrl), tail(assets&&assets.audioUrl)];   // back-compat (frame,audio)
  const s = JSON.stringify({ a, p:prompt||"", st:settings||{} });
  let h=5381; for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))|0; }
  return (h>>>0).toString(36);
}
window.vidHash=vidHash;

/* Commits are SERIALIZED through a queue: a batch render finishes N takes near-
   simultaneously, and vidCommit's read-merge-write of the take list would otherwise
   let a later commit clobber an earlier one's take. */
let _vidCommitQ = Promise.resolve();
function _vidQueued(run){
  const p = _vidCommitQ.then(run, run);
  _vidCommitQ = p.catch(()=>{});
  return p;
}
function vidCommitQueued(id, url, meta, scope){
  return _vidQueued(()=>_vidCommitRaw(id, url, meta, scope));
}
async function _vidCommitRaw(id, url, meta, scope){
  /* scope re-check at EXECUTION time: this commit may have waited in the queue
     behind hydrate/cloud I/O while the user switched films. Writing then would
     plant another film's take into the fresh state — skip every write and tell
     the caller, which keeps the job pending for project-scoped recovery. */
  if(scope){
    const now = vidScope();
    if(!now || now.projectId!==scope.projectId || (scope.epoch!=null && now.epoch!==scope.epoch)) return { skipped:true };
  }
  const prev = _vidMem.get(id) || (async()=>{ try{ return await vidIdbGet(vidKey(id)); }catch(e){ return null; } })();
  const old = prev && typeof prev.then==="function" ? await prev : prev;
  const takes = [];
  const oldMeta = (old&&old.meta)||null;
  if(old&&old.url&&old.url!==url) takes.push({ url:old.url, meta:oldMeta, savedAt:(oldMeta&&oldMeta.createdAt)||Date.now() });
  ((oldMeta&&oldMeta.takes)||[]).forEach(t=>{ if(t&&t.url&&t.url!==url&&!takes.some(x=>x.url===t.url)) takes.push(t); });
  meta = { ...(meta||{}) };
  if(typeof window.nbWithAssetProvenance==="function") meta = window.nbWithAssetProvenance(id, meta, "video");
  else if(!meta.assetRole){ meta.assetRole = "final_take"; meta.assetRoleLabel = "Final take"; meta.assetRolePriority = 100; }
  /* STABLE version number: assigned once on first commit, carried by the take forever
     (never renumbered when older takes roll over) — restoring an old take keeps its vno. */
  if(meta.vno==null){
    const nums = [oldMeta&&oldMeta.vno].concat(takes.map(t=>t&&t.meta&&t.meta.vno)).map(Number).filter(n=>n>0);
    meta.vno = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  }
  // APPROVED takes never roll over; everything else keeps the newest 20
  const capped = [];
  takes.forEach(t=>{ const ap = t&&t.meta&&t.meta.status==="approved"; if(ap || capped.length<20) capped.push(t); });
  meta = { ...meta, createdAt:meta.createdAt||Date.now(), takes:capped };
  _vidMem.set(id, { url, meta:meta||null });
  try{ await vidIdbSet(vidKey(id), { url, meta:meta||null }); }catch(e){}
  await _vidCloudPush(id, { url, meta:meta||null }, scope);
  try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(e){}
  return { url };
}
/* did the film change while an action WAITED in the queue? Take mutations are
   user intent aimed at the film that was open at click time — after a switch
   they must not write into the new film's memory/IDB or cloud rows. */
function _vidScopeSame(a){
  const b = vidScope();
  if(!a && !b) return true;
  if(!a || !b) return false;
  return a.projectId===b.projectId && (a.epoch==null || b.epoch==null || a.epoch===b.epoch);
}
function vidClear(id){
  vidRunBump(id);                 // synchronously disown any in-flight render first —
  _vidPendingRemoveByClip(id);    // it must never commit or be "recovered" back
  const scope0 = vidScope();      // the clear targets THIS film's cloud row, even if queued past a switch
  return _vidQueued(async ()=>{
    /* local caches are only touched while the SAME film is still open — after a
       switch the new film may hold a same-id take in shared IDB/memory that the
       old film's queued clear must not eat. The cloud delete still lands on the
       old film's row via scope0. */
    if(_vidScopeSame(scope0)){
      _vidMem.delete(id);
      try{ await vidIdbDel(vidKey(id)); }catch(e){}
    }
    await _vidCloudPush(id, null, scope0);
    try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(e){}
  });
}
const vidCommit = vidCommitQueued;   // every commit path goes through the queue
window.vidCommit=vidCommit; window.vidClear=vidClear;

/* ---- Versions-view helpers — approve / annotate / restore / delete ONE take.
   All writes run through the same serialized queue as commits so a mid-batch
   completion can never clobber an approval. The clip entry shape is
   { url, meta:{ ..., takes:[{url, meta, savedAt}] } } — current first. ---- */
async function _vidLoadEntry(id){
  let e = _vidMem.get(id);
  if(!e){ try{ e = await vidIdbGet(vidKey(id)); }catch(err){ e = null; } if(e) _vidMem.set(id, e); }
  return e || null;
}
async function _vidWriteEntry(id, e, scope){
  _vidMem.set(id, e);
  try{ await vidIdbSet(vidKey(id), e); }catch(err){}
  await _vidCloudPush(id, e, scope);   // approvals/notes/restores/deletes are project records too
  try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(err){}
  return e;
}
// merge a meta patch into one take (current or archived), matched by url
function vidUpdateTake(id, url, patch){
  const scope0 = vidScope();
  return _vidQueued(async ()=>{
    if(!_vidScopeSame(scope0)) return null;   // film switched while queued — drop, never cross-write
    const e = await _vidLoadEntry(id); if(!e || !e.url) return null;
    if(e.url===url) return _vidWriteEntry(id, { url:e.url, meta:{ ...(e.meta||{}), ...patch } }, scope0);
    const takes = ((e.meta&&e.meta.takes)||[]).map(t=> (t&&t.url===url) ? { ...t, meta:{ ...(t.meta||{}), ...patch } } : t);
    return _vidWriteEntry(id, { url:e.url, meta:{ ...(e.meta||{}), takes } }, scope0);
  });
}
// one approved take per clip: approving a url clears the star everywhere else
function vidApproveTake(id, url, on){
  const scope0 = vidScope();
  return _vidQueued(async ()=>{
    if(!_vidScopeSame(scope0)) return null;   // film switched while queued — drop, never cross-write
    const e = await _vidLoadEntry(id); if(!e || !e.url) return null;
    const set = (m, hit)=>{ const n = { ...(m||{}) }; if(hit && on) n.status="approved"; else delete n.status; return n; };
    const takes = ((e.meta&&e.meta.takes)||[]).map(t=> ({ ...t, meta:set(t&&t.meta, t&&t.url===url) }));
    return _vidWriteEntry(id, { url:e.url, meta:{ ...set(e.meta, e.url===url), takes } }, scope0);
  });
}
// make an archived take the CURRENT one (the old current becomes a take; vno travels)
function vidRestoreTake(id, url){
  const scope0 = vidScope();
  return _vidQueued(async ()=>{
    if(!_vidScopeSame(scope0)) return null;   // film switched while queued
    const e = await _vidLoadEntry(id); if(!e) return null;
    const t = ((e.meta&&e.meta.takes)||[]).find(x=>x&&x.url===url);
    if(!t) return null;
    const m = { ...(t.meta||{}) }; delete m.takes;
    return _vidCommitRaw(id, t.url, m, scope0);   // commitRaw re-checks scope0 at execution too
  });
}
// delete one take; deleting the current promotes the newest remaining take
function vidDeleteTake(id, url){
  const scope0 = vidScope();
  return _vidQueued(async ()=>{
    if(!_vidScopeSame(scope0)) return null;   // film switched while queued — drop, never cross-write
    const e = await _vidLoadEntry(id); if(!e || !e.url) return null;
    const takes = ((e.meta&&e.meta.takes)||[]);
    if(e.url===url){
      const next = takes[0];
      if(!next){ _vidMem.delete(id); try{ await vidIdbDel(vidKey(id)); }catch(err){}
        await _vidCloudPush(id, null, scope0);
        try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(err){}
        return { cleared:true }; }
      return _vidWriteEntry(id, { url:next.url, meta:{ ...(next.meta||{}), takes:takes.slice(1) } }, scope0);
    }
    return _vidWriteEntry(id, { url:e.url, meta:{ ...(e.meta||{}), takes:takes.filter(t=>!(t&&t.url===url)) } }, scope0);
  });
}
window.vidUpdateTake=vidUpdateTake; window.vidApproveTake=vidApproveTake;
window.vidRestoreTake=vidRestoreTake; window.vidDeleteTake=vidDeleteTake;

// ---- the proxy call (task:"video") ------------------------------------------
async function vidProxy(op, payload){
  if(!videoProxyReady()) throw new Error("Video runs through your server proxy — sign in and make sure Supabase + the proxy are configured.");
  const sb = window.sbClient();
  const fnName = (window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxyFn) || "image-proxy";
  // TRANSIENT-SAFE: "Failed to send a request to the Edge Function" is a NETWORK-level
  // failure (no HTTP status — the call never completed: a wifi blip, VPN hiccup or a
  // brief edge hiccup), so retry briefly before surfacing. submit is NEVER retried
  // here — if the request did reach the server before the connection dropped, a blind
  // retry would start (and charge) a second render.
  const netRetries = op==="submit" ? 0 : 2;
  let data, error;
  for(let a=0;; a++){
    data=undefined; error=undefined;
    try{ ({ data, error } = await sb.functions.invoke(fnName, { body:{ task:"video", op, ...(payload||{}),
      userApiKeys: window.turnApiKeysForProxy ? window.turnApiKeysForProxy(["fal"]) : undefined } })); }
    catch(e){ error=e; }
    const netFail = !!error && !((error&&error.context&&error.context.status)||error.status||0);
    if(netFail && a<netRetries){ await new Promise(r=>setTimeout(r, 900*(a+1))); continue; }
    break;
  }
  if(error){
    const status=(error&&error.context&&error.context.status)||error.status||0;
    const _safe = window.turnSafeError || (x=>x);
    if(status===401) throw new Error("Sign in to render video — it runs on your server, not the browser.");
    if(status===404) throw new Error(_safe("The media proxy isn't deployed yet. Deploy supabase/functions/image-proxy (the video route), then have an administrator set FAL_KEY."));
    if(!status) throw new Error(_safe("Couldn't reach the video proxy — the request never made it to the server (usually a brief connection drop or VPN/ad-blocker interference). Check your connection and try again"+(op==="submit"?"; the render was most likely not submitted or charged":"")+"."));
    throw new Error(_safe("Couldn't reach the video proxy: "+((error&&error.message)||"unknown error")+"."));
  }
  if(data && data.error) throw new Error((window.turnSafeError||(x=>x))(data.error));   // fal error relayed by the proxy
  return data||{};
}

// ---- render ONE clip: multimodal assets (frame/images + line audio + ref videos) →
//      lip-synced mp4; cache by hash. Seedance 2.0 takes up to ~12 combined assets. ----
function _dedupCap(arr, cap){ const out=[], seen=new Set();
  (arr||[]).forEach(u=>{ if(u && !seen.has(u)){ seen.add(u); out.push(u); } });
  return cap ? out.slice(0,cap) : out; }
function vidResolutionForModel(model, requested){
  const raw = String(requested || "720p").trim();
  const norm = raw.toLowerCase()==="4k" ? "4K" : raw.toLowerCase();
  const maxRank = /seedance-2\.0\/fast/.test(String(model||"")) ? 1
    : /seedance-2\.5/.test(String(model||"")) ? 1   // fal lists 480p/720p ONLY for 2.5 — no 1080p/4K
    : /kling-video|sora-2\/image-to-video\/pro/.test(String(model||"")) ? 2
    : /sora-2/.test(String(model||"")) ? 1
    : 3;
  const ladder = ["480p","720p","1080p","4K"];
  const idx = ladder.indexOf(norm);
  return ladder[Math.max(0, Math.min(idx>=0 ? idx : 1, maxRank))].toLowerCase();
}
function _blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    try{
      const r = new FileReader();
      r.onload = ()=>resolve(String(r.result||""));
      r.onerror = ()=>reject(r.error||new Error("Could not read media blob."));
      r.readAsDataURL(blob);
    }catch(e){ reject(e); }
  });
}
async function vidProxyReadyUrl(url){
  url = String(url||"");
  if(!url) return "";
  if(/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
  if(/^blob:/i.test(url)){
    const res = await fetch(url);
    if(!res.ok) throw new Error("One selected Stage asset is no longer available in this browser. Re-open or regenerate it, then try Generate clip again.");
    return await _blobToDataUrl(await res.blob());
  }
  return url;
}
async function vidProxyReadyUrls(urls){
  const out = [];
  for(const u of (urls||[])){
    const r = await vidProxyReadyUrl(u);
    if(r) out.push(r);
  }
  return out;
}
window.vidProxyReadyUrl = vidProxyReadyUrl;

/* fal validates audio references at >= 2.0s ("Audio duration is too short. Minimum is
   2.0 seconds."); a short spoken line ("Yes.") measures well under that. Pad the decoded
   audio with trailing silence and re-encode as 16-bit WAV before staging. Best-effort:
   any fetch/decode failure sends the original through untouched. */
const VID_MIN_AUDIO_SEC = 2.4;
function _vidWavFromBuffer(buf, frames){
  const ch = Math.min(2, buf.numberOfChannels||1), rate = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + frames*ch*2));
  const ws = (o,s)=>{ for(let i=0;i<s.length;i++) data.setUint8(o+i, s.charCodeAt(i)); };
  ws(0,"RIFF"); data.setUint32(4, 36 + frames*ch*2, true); ws(8,"WAVE");
  ws(12,"fmt "); data.setUint32(16,16,true); data.setUint16(20,1,true); data.setUint16(22,ch,true);
  data.setUint32(24,rate,true); data.setUint32(28,rate*ch*2,true); data.setUint16(32,ch*2,true); data.setUint16(34,16,true);
  ws(36,"data"); data.setUint32(40, frames*ch*2, true);
  for(let c=0;c<ch;c++){
    const src = buf.getChannelData(Math.min(c, buf.numberOfChannels-1));
    for(let i=0;i<frames;i++){
      const v = i<src.length ? Math.max(-1, Math.min(1, src[i])) : 0;
      data.setInt16(44 + (i*ch+c)*2, v<0 ? v*0x8000 : v*0x7FFF, true);
    }
  }
  return new Blob([data.buffer], { type:"audio/wav" });
}
let _vidAC = null;
async function vidPadShortAudio(url){
  try{
    if(!/^(data:audio|blob:|https?:)/i.test(String(url||""))) return url;
    const res = await fetch(url); if(!res.ok) return url;
    const raw = await res.arrayBuffer();
    _vidAC = _vidAC || new (window.AudioContext||window.webkitAudioContext)();
    const dec = await _vidAC.decodeAudioData(raw.slice(0));
    if(!dec || dec.duration >= 2.05) return url;      // already clears fal's 2.0s floor
    const frames = Math.ceil(dec.sampleRate * VID_MIN_AUDIO_SEC);
    return await _blobToDataUrl(_vidWavFromBuffer(dec, frames));
  }catch(e){ return url; }
}
window.vidPadShortAudio = vidPadShortAudio;

/* ---- BLACK-MP4 voice carrier: fal caps audio references at 3 clips, so extra
   locked-voice lines ride as VIDEO references — a 1fps black 64x64 H.264 stream
   with the voice encoded as AAC on top, muxed in-browser (WebCodecs + mp4-muxer
   via esm.sh, no server round-trip). The black picture carries no visual identity
   (the Stage's prompt flags it voice-only). Returns a blob: URL — vidProxyReadyUrl
   serverizes it like any other staged asset. Throws a clear error when the browser
   lacks WebCodecs H.264/AAC encoding (older Safari/Firefox). */
let _mp4MuxerMod = null;
async function _mp4Muxer(){
  if(!_mp4MuxerMod) _mp4MuxerMod = await import("https://esm.sh/mp4-muxer@5.2.0");
  return _mp4MuxerMod;
}
async function blackMp4FromAudio(audioUrl){
  if(typeof VideoEncoder==="undefined" || typeof AudioEncoder==="undefined" || typeof VideoFrame==="undefined" || typeof AudioData==="undefined")
    throw new Error("This browser can't package voice references (WebCodecs missing) — try Chrome or Edge.");
  const res = await fetch(audioUrl);
  if(!res.ok) throw new Error("Could not read the voice audio for packaging.");
  _vidAC = _vidAC || new (window.AudioContext||window.webkitAudioContext)();
  const dec = await _vidAC.decodeAudioData(await res.arrayBuffer());
  if(!dec || !dec.duration) throw new Error("The voice audio couldn't be decoded for packaging.");
  const rate = dec.sampleRate;
  // mono mixdown, padded past fal's 2.0s audio floor (same rule as audio refs)
  const frames = Math.max(dec.length, Math.ceil(rate*VID_MIN_AUDIO_SEC));
  const pcm = new Float32Array(frames);
  for(let c=0;c<dec.numberOfChannels;c++){ const ch=dec.getChannelData(c);
    for(let i=0;i<ch.length;i++) pcm[i]+=ch[i]/dec.numberOfChannels; }
  const aCfg = { codec:"mp4a.40.2", sampleRate:rate, numberOfChannels:1, bitrate:96000 };
  const vCfg = { codec:"avc1.42001f", width:64, height:64, framerate:1, bitrate:50000 };
  const aOk = await AudioEncoder.isConfigSupported(aCfg).catch(()=>({supported:false}));
  const vOk = await VideoEncoder.isConfigSupported(vCfg).catch(()=>({supported:false}));
  if(!aOk.supported || !vOk.supported)
    throw new Error("This browser can't encode the voice mp4 (AAC/H.264 encode missing) — try Chrome or Edge.");
  const Mp4 = await _mp4Muxer();
  const target = new Mp4.ArrayBufferTarget();
  const muxer = new Mp4.Muxer({ target,
    video:{ codec:"avc", width:64, height:64 },
    audio:{ codec:"aac", sampleRate:rate, numberOfChannels:1 },
    fastStart:"in-memory" });
  let encErr = null;
  const vEnc = new VideoEncoder({ output:(c,m)=>muxer.addVideoChunk(c,m), error:e=>{ encErr = encErr||e; } });
  vEnc.configure(vCfg);
  const aEnc = new AudioEncoder({ output:(c,m)=>muxer.addAudioChunk(c,m), error:e=>{ encErr = encErr||e; } });
  aEnc.configure(aCfg);
  // 1fps black frames spanning the voice
  const secs = Math.max(1, Math.ceil(frames/rate));
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const cx = cv.getContext("2d"); cx.fillStyle = "#000"; cx.fillRect(0,0,64,64);
  for(let i=0;i<secs;i++){ const f = new VideoFrame(cv, { timestamp:i*1000000, duration:1000000 });
    vEnc.encode(f, { keyFrame:i%5===0 }); f.close(); }
  // PCM → AAC in ~1s f32-planar chunks
  for(let off=0; off<frames; off+=rate){ const n = Math.min(rate, frames-off);
    const ad = new AudioData({ format:"f32-planar", sampleRate:rate, numberOfFrames:n, numberOfChannels:1,
      timestamp:Math.round(off/rate*1000000), data:pcm.subarray(off, off+n) });
    aEnc.encode(ad); ad.close(); }
  await Promise.all([vEnc.flush(), aEnc.flush()]);
  vEnc.close(); aEnc.close();
  if(encErr) throw encErr;
  muxer.finalize();
  return URL.createObjectURL(new Blob([target.buffer], { type:"video/mp4" }));
}
window.blackMp4FromAudio = blackMp4FromAudio;

/* ---- RELOAD/CRASH RECOVERY: a render is a server-side fal job — if the page reloads
   mid-poll the job still finishes, but nobody collects it (credits spent, take lost).
   Every submitted job persists in localStorage until it definitively completes; the
   next load re-polls the leftovers once and commits any finished video as a take. ---- */
const VID_PENDING_KEY = "turn_vid_pending";
function _vidPendingList(){ try{ return JSON.parse(localStorage.getItem(VID_PENDING_KEY)||"[]")||[]; }catch(e){ return []; } }
function _vidPendingSave(list){ try{ localStorage.setItem(VID_PENDING_KEY, JSON.stringify(list.slice(-20))); }catch(e){} }
function _vidPendingAdd(job){ const l=_vidPendingList().filter(j=>j.requestId!==job.requestId); l.push(job); _vidPendingSave(l); }
function _vidPendingRemove(requestId){ _vidPendingSave(_vidPendingList().filter(j=>j.requestId!==requestId)); }
function _vidPendingRemoveByClip(id){ if(id!=null) _vidPendingSave(_vidPendingList().filter(j=>!j || j.id!==id)); }
window.vidPendingList = _vidPendingList;   // read-only view (UI / tests)
/* Recovery is PROJECT-SCOPED: each pending entry carries the film it belongs to, and
   a pass only replays entries for the film that's open — jobs from other films wait
   for their film (committing them here would write takes into the wrong project).
   Every outcome is TOLD to the user: recovered, failed at the provider, expired, or
   still cooking (a slow patrol below keeps checking those). */
const _vidPollLease = new Set();   // requestIds actively polled by THIS tab's generate loop
/* settle a job's spend record (fire-and-forget): the shared per-job event id
   means live poll and recovery can BOTH call this for the same render and the
   charge still lands exactly once, pinned to the launching account. */
function _vidSettleSpend(spend){
  if(!spend || !spend.cost || typeof window.cloudSpendCreditReliable!=="function") return;
  try{
    const p = window.cloudSpendCreditReliable(spend.cost, spend.reason||"stage-video-render", spend.uid||null, spend.id||null);
    if(p && p.catch) p.catch(()=>{});
  }catch(e){}
}
async function vidRecoverPending(opts){
  opts = opts||{};
  const sc = vidScope();
  const scopeKey = sc ? sc.projectId : null;
  const list = _vidPendingList().filter(j=> j && (j.projectId||null)===scopeKey);
  if(!list.length) return 0;
  let saved=0, failed=0, expired=0, cooking=0;
  for(const j of list){
    // a live generate loop OWNS its job — recovery touching it too would
    // double-commit the same finished render (duplicate writes + toasts)
    if(!j.requestId || _vidPollLease.has(j.requestId)) continue;
    _vidPollLease.add(j.requestId);   // recovery claims the job too — the load pass and the 5-min patrol can overlap
    try{
    if((Date.now()-(j.at||0)) > 24*3600*1000){ _vidPendingRemove(j.requestId); expired++; continue; }
    try{
      const st = await vidProxy("poll", { model:j.model, statusUrl:j.statusUrl, responseUrl:j.responseUrl });
      if(st.status==="COMPLETED" && st.videoUrl){
        _vidSettleSpend(j.spend);   // a recovered render is a rendered render — settle its charge (same event id as the live path: never twice)
        await vidCommit(j.id, st.videoUrl, { ...(j.meta||{}), seed:st.seed||null, recovered:true });
        _vidPendingRemove(j.requestId); saved++;
      } else if(st.error || /^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(String(st.status||""))){
        _vidPendingRemove(j.requestId); failed++;
      } else cooking++;
      // still IN_QUEUE / IN_PROGRESS → the patrol below re-checks it
    }catch(e){
      /* a provider-relayed failure (the proxy throws its error text) is TERMINAL —
         drop the job and report it; only an unreachable proxy (network blip) leaves
         the job for the next patrol pass. */
      if(!/Couldn't reach the video proxy/i.test(String(e&&e.message))){ _vidPendingRemove(j.requestId); failed++; }
    }
    }finally{ _vidPollLease.delete(j.requestId); }
  }
  const toast = (m,k)=>{ if(typeof window.appToast==="function") window.appToast(m,k); };
  if(saved) toast(saved===1 ? "Recovered a finished render from an earlier session — it's saved in its clip's takes." : ("Recovered "+saved+" finished renders from an earlier session — saved as takes."),"success");
  if(failed) toast(failed===1 ? "A render from an earlier session failed at the provider — no take was produced." : (failed+" renders from an earlier session failed at the provider — no takes were produced."),"error");
  if(expired) toast(expired===1 ? "A pending render was over a day old and could no longer be checked — it was dropped." : (expired+" pending renders were over a day old and were dropped."),"info");
  if(cooking && !opts.quiet) toast(cooking===1 ? "A render from an earlier session is still processing — it will be saved automatically when it finishes." : (cooking+" renders from an earlier session are still processing — they'll be saved automatically."),"info");
  return saved;
}
window.vidRecoverPending = vidRecoverPending;
// one recovery pass per load after the auth/proxy state settles, then a slow
// patrol while anything is still pending (quiet: no repeat "still processing")
setTimeout(()=>{ try{ if(videoProxyReady()) vidRecoverPending(); }catch(e){} }, 4000);
setInterval(()=>{ try{ if(videoProxyReady() && _vidPendingList().length) vidRecoverPending({ quiet:true }); }catch(e){} }, 5*60*1000);

/* ---- LIKENESS FALSE POSITIVES: Seedance's safety filter sometimes decides an
   AI-generated character sheet shows a REAL person's likeness and rejects the job.
   Every Art Room reference IS AI-generated, so that rejection is a false positive:
   retry ONCE with an explicit fictional-cast declaration prepended to the prompt,
   and if the filter still refuses, explain it in human terms (regenerate a more
   stylized sheet / switch model) instead of relaying raw provider text. ---- */
const VID_LIKENESS_RE = /likeness|celebrit|public figure|famous|real (?:person|people|face)|portrait right|impersonat|face (?:match|verification|detect)|risk control|content (?:risk|policy|moderation)|moderation|sensitive content|prohibited content/i;
function vidLikenessError(msg){
  const s = String(msg||"");
  return !!s && !/cancelled/i.test(s) && VID_LIKENESS_RE.test(s);
}
window.vidLikenessError = vidLikenessError;
const VID_FICTION_NOTE = "Note: every person appearing in the reference images is an original, fully AI-generated fictional character created for this film. They are not real people, celebrities, or public figures — no real person's likeness, face, or identity is used or implied.";
const VID_LIKENESS_HELP = "The model's safety filter flagged an input image as a real person's likeness and refused the render — even after declaring the cast as AI-generated fictional characters. It's a false positive on the provider's side, and their API has no switch to turn it off. Any image can trip it: character sheets, the shot FRAME itself, even a location still with a person in it. What works: regenerate the suspect image (character sheet or frame) with a more stylized / less photoreal look in the Art Room, exclude it from this clip's inputs, or set the clip's source to prompt-only and render without images.";

async function seedanceGenerate(id, opts){
  opts = opts||{};
  /* ownership + scope captured at START: Clear bumps the clip's run token; a film
     switch bumps the asset epoch. Both are re-checked after the LAST await before
     committing — a finished render must never resurrect a cleared clip or land in
     another film. */
  const runToken0 = (id!=null) ? vidRunToken(id) : null;
  const scope0 = vidScope();
  const epoch0 = (typeof window.nbEpoch==="function") ? window.nbEpoch() : 0;
  /* the SPEND RECORD rides the job from submit to settlement: the launcher's
     uid and one event id fixed here mean the render is charged to whoever
     LAUNCHED it, exactly once, no matter which path delivers it — live poll,
     crash-recovery in a later session, or both racing (the shared id dedupes
     client- and server-side). A likeness retry shares the id too: one render
     delivered, one charge. */
  const spendRec = (opts.spend && opts.spend.cost) ? {
    cost: Math.max(1, Number(opts.spend.cost)||1),
    reason: String(opts.spend.reason||"stage-video-render"),
    uid: opts.spend.uid||null,
    id: (typeof crypto!=="undefined" && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)),
  } : null;
  /* SEEDANCE 2.5 rides the same multimodal reference-to-video shape as 2.0, named by
     the tier's falModel: 30s duration ceiling and longer renders (the poll ceiling
     stretches below). Per-modality caps verified against fal's live schema 2026-08-07:
     2.5 takes ≤30 images, ≤10 videos, ≤10 audio (50 files total, budgeted upstream by
     the tier's assetLimit); 2.0 takes ≤9 images, ≤3 videos, ≤3 audio (12 total). */
  const isSeedance25 = /seedance-2\.5/.test(String(opts.falModel||""));
  // assemble the multimodal asset lists (single frameUrl/audioUrl kept for back-compat)
  const images = _dedupCap([opts.frameUrl, ...(opts.imageUrls||[])], isSeedance25 ? 30 : 9);
  const videos = _dedupCap(opts.videoUrls||[], isSeedance25 ? 10 : 3);
  const audios = _dedupCap([opts.audioUrl, ...(opts.audioUrls||[])], isSeedance25 ? 10 : 3);
  if(!images.length && !videos.length) throw new Error("This clip has no start frame yet — generate the shot's frame in the Shot List first.");
  /* SORA 2 rides the same queue but a different shape: the tier names its fal endpoint
     (opts.falModel), takes ONE start image, and has no video/audio refs, no end-frame
     transition, no seed. The proxy maps the payload to Sora's field names + snaps the
     duration to its 4/8/12/16/20s grid. */
  const isSora = /sora-2/.test(String(opts.falModel||""));
  /* KLING 3.0 rides the same queue: ONE start image (identity rides the frame — no
     reference sheets, no audio refs; speech is generated natively by the model),
     optional end frame, and NATIVE MULTI-SHOT — opts.multiShot [{prompt,duration}]
     maps to Kling's multi_prompt so each Multi-shot row renders on its own prompt. */
  const isKling = /kling-video/.test(String(opts.falModel||""));
  // a start->end frame transition only makes sense with exactly a start image and no
  // video/audio refs — those require the multimodal reference-to-video shape instead.
  // (Kling takes end_image_url natively on its one endpoint — no endpoint switch.)
  const endFrame = isSora ? "" : (opts.endImageUrl||"").trim();
  const useTransition = !isKling && !!(endFrame && images.length && !videos.length && !audios.length);
  const model = (isSora || isKling) ? opts.falModel
    : isSeedance25
    ? (useTransition ? (opts.fast ? VID25_MODEL_I2V_FAST : VID25_MODEL_I2V) : opts.falModel)
    : useTransition
    ? (opts.fast ? VID_MODEL_I2V_FAST : VID_MODEL_I2V)
    : (opts.fast ? VID_MODEL_FAST : VID_MODEL);
  // audio-as-clock: the measured line duration sets the clip length (Seedance/Kling 3–15s; Sora up to 20s; Seedance 2.5 up to 30s)
  const duration = opts.durationMs ? Math.max(isKling?3:4, Math.min(isSora?20:(isSeedance25?30:15), Math.round(opts.durationMs/1000))) : (opts.duration||"auto");
  const klingShots = (isKling && Array.isArray(opts.multiShot))
    ? opts.multiShot.map(s=>({ prompt:String(s&&s.prompt||"").trim(), duration:Math.max(1,Math.round(Number(s&&s.duration)||3)) })).filter(s=>s.prompt)
    : [];
  const resolution = vidResolutionForModel(model, opts.resolution);   // clamp stale/local choices to the model's current fal ceiling
  const aspectRatio = opts.aspectRatio || "auto";
  const controls = (opts.controls||"").trim();
  const basePrompt = (opts.prompt||"").trim() || (audios.length
    ? "@Image1 comes alive — the character speaks the line in @Audio1 with natural, accurate lip-sync. Subtle, grounded motion; hold the framing and the lighting."
    : "@Image1 comes alive with subtle, natural motion; hold the framing and the lighting.");
  const promptText = controls ? (basePrompt + "\n" + controls) : basePrompt;
  /* generate_audio controls the WHOLE output audio track (SFX, ambience AND the
     lip-synced speech built from audio references) — sending false with audio refs
     yields a silent video, so it stays ON whenever line audio rides along. */
  const generateAudio = opts.generateAudio!=null ? !!opts.generateAudio : true;
  const bitrateMode = opts.bitrateMode==="high" ? "high" : "standard";
  const settings = { model, resolution, aspectRatio, duration, endFrame, generateAudio, bitrateMode, seed:opts.seed!=null?opts.seed:null };
  const hash = vidHash([...images, ...videos, ...audios], promptText, settings);
  // skip-if-unchanged
  if(id && !opts.force){
    const url = vidGetVideo(id) || await vidLoadVideo(id);
    const meta = vidGetMeta(id);
    if(url && meta && meta.hash===hash) return { videoUrl:url, seed:(meta&&meta.seed)||null, cached:true };
  }
  const proxyImages = await vidProxyReadyUrls((isSora||isKling) ? images.slice(0,1) : images);   // Sora/Kling: the start frame only
  const proxyVideos = (isSora||isKling) ? [] : await vidProxyReadyUrls(videos);
  const proxyAudios = [];
  if(!isSora && !isKling) for(const u of await vidProxyReadyUrls(audios)) proxyAudios.push(await vidPadShortAudio(u));
  const proxyEndFrame = (useTransition || (isKling && endFrame)) ? await vidProxyReadyUrl(endFrame) : "";
  // ONE submit→poll pass with the given prompt text — extracted so a likeness
  // rejection can rerun the whole pass with the fictional-cast declaration prepended.
  const attempt = async (pText, tag)=>{
    /* status emissions carry the attempt's tag so an automatic safety retry
       reads as a labeled retry in the player — not the same render mysteriously
       starting over from a low percentage */
    const _tag = tag || opts.statusTag || "";
    const emit = (s)=>{ if(opts.onStatus) opts.onStatus(_tag ? (_tag+" · "+s) : s); };
    const sub = await vidProxy("submit", {
      model, prompt:pText,
      ...(isKling
        ? { image_url:proxyImages[0],
            ...(proxyEndFrame ? { end_image_url:proxyEndFrame } : {}),
            ...(klingShots.length>1 ? { multi_prompt:klingShots } : {}) }
        : useTransition
        ? { image_url:proxyImages[0], end_image_url:proxyEndFrame }
        : { image_urls:proxyImages,
            ...(proxyVideos.length ? { video_urls:proxyVideos } : {}),
            ...(proxyAudios.length ? { audio_urls:proxyAudios } : {}) }),
      duration, resolution, aspectRatio,
      generateAudio,    // ON with audio refs (they become the speech in the track); user-toggled otherwise
      bitrateMode,      // "high" = less compression / larger file; "standard" = smaller draft
      ...(opts.seed!=null && !isSora && !isKling ? { seed:opts.seed } : {}),   // Sora/Kling have no seed control
    });
    if(!sub.requestId || !sub.statusUrl || !sub.responseUrl) throw new Error("The video proxy didn't accept the job.");
    // persist the job until it DEFINITIVELY completes — a reload mid-poll would otherwise
    // orphan a paid render (recovery re-polls leftovers on the next load). Cancels and
    // timeouts keep the entry on purpose: the job may still finish server-side.
    _vidPendingAdd({ requestId:sub.requestId, id, model, statusUrl:sub.statusUrl, responseUrl:sub.responseUrl, at:Date.now(),
      projectId:(scope0&&scope0.projectId)||null, uid:(scope0&&scope0.uid)||null,   // recovery is project-scoped
      spend:spendRec,   // settled at COMPLETION by whichever path delivers first — event id dedupes
      meta:{ hash, model, durationMs:opts.durationMs||0, aspectRatio, prompt:pText, ...(opts.takeMeta||{}) } });
    _vidPollLease.add(sub.requestId);   // this poll OWNS the job while it runs — recovery keeps its hands off
    try{
    emit(sub.status||"IN_QUEUE");
    // poll until COMPLETED — each call is short; the wait is here on the client.
    // PROGRESS: fal's status logs carry real "NN%" lines for some models (the proxy
    // relays the last one as st.progress); when they don't, an elapsed-time asymptote
    // against a per-tier expected render time stands in. Whichever is FURTHEST wins,
    // it never moves backwards, and it caps at 97% until COMPLETED lands.
    const pollMs = opts.pollMs || 4000;
    const maxPolls = opts.maxPolls || (isSeedance25 ? 300 : 150);   // ~10 min at 4s — 30s renders get ~20
    const t0 = Date.now();
    const wantSec = typeof duration==="number" ? duration : 8;
    const estSec = (opts.fast ? 50 : 100) + wantSec*(opts.fast ? 4 : 8);   // rough tier-typical wall time
    let lastPct = 0;
    let pollMiss = 0;   // consecutive unreachable-proxy polls — the render itself is still cooking server-side
    for(let i=0; i<maxPolls; i++){
      if(opts.shouldCancel && opts.shouldCancel()) throw new Error("Render cancelled.");
      await new Promise(r=>setTimeout(r, pollMs));
      let st;
      try{ st = await vidProxy("poll", { model, statusUrl:sub.statusUrl, responseUrl:sub.responseUrl }); pollMiss = 0; }
      catch(e){
        // a network blip mid-poll must NOT kill a render that's still running on the
        // provider — tolerate a few consecutive misses (each already retried inside
        // vidProxy), then surface the real error. Terminal provider failures don't
        // land here: they arrive as a successful poll with st.error/st.status.
        if(/Couldn't reach the video proxy/i.test(String(e&&e.message)) && ++pollMiss<=4){
          emit("RECONNECTING");
          continue;
        }
        throw e;
      }
      // a terminal failure the proxy relayed without an error field still ends here —
      // throw so the likeness retry/help path can see the reason instead of timing out
      if(/^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(String(st.status||"")))
        throw new Error(String(st.error||("The provider reported the render as "+st.status+".")));
      if(st.status){
        let label = st.status;
        if(st.status==="IN_QUEUE"){
          if(Number(st.queuePosition)>0) label += " · #"+Number(st.queuePosition)+" in line";
        } else if(st.status!=="COMPLETED"){
          const elapsed = (Date.now()-t0)/1000;
          const est = Math.round(100*(1-Math.exp(-1.6*elapsed/estSec)));
          lastPct = Math.max(lastPct, Math.min(97, Math.max(Number(st.progress)||0, est)));
          label += " · "+lastPct+"%";
        }
        emit(label);
      }
      if(st.status==="COMPLETED" && st.videoUrl){
        /* the provider rendered — the charge is incurred NOW, before any
           discard/stale branching (a cleared clip's render was still rendered).
           The job's event id keeps a racing recovery pass from charging again. */
        _vidSettleSpend(spendRec);
        const meta = { hash, model, durationMs:opts.durationMs||0, aspectRatio, seed:st.seed||null, prompt:pText,
          ...(opts.takeMeta||{}) };   // Versions-view facts: source, tier, resolution, recipe, audio, batch position…
        /* OWNERSHIP RE-CHECK after the last await (memory: agent-run-lifecycle):
           the user may have cleared the clip or switched films while this cooked. */
        if(id!=null && vidRunToken(id)!==runToken0){
          // cleared mid-render — the paid result is discarded, and SAYS so
          _vidPendingRemove(sub.requestId);
          if(typeof window.appToast==="function")
            window.appToast("A render finished after you cleared its clip — the take was discarded as requested (the render itself was already charged).","info");
          return { videoUrl:st.videoUrl, seed:st.seed||null, cached:false, discarded:true };
        }
        const epochNow = (typeof window.nbEpoch==="function") ? window.nbEpoch() : 0;
        if(epochNow!==epoch0){
          /* film switched mid-render: DON'T commit into the wrong scope — leave the
             job pending; recovery is project-scoped and delivers it into the right
             film the next time that film opens. */
          return { videoUrl:st.videoUrl, seed:st.seed||null, cached:false, stale:true };
        }
        if(id){
          const cr = await vidCommit(id, st.videoUrl, meta, scope0);
          // scope changed while the commit WAITED IN THE QUEUE — job stays
          // pending; project-scoped recovery delivers it to the right film
          if(cr && cr.skipped) return { videoUrl:st.videoUrl, seed:st.seed||null, cached:false, stale:true };
        }
        _vidPendingRemove(sub.requestId);   // delivered — nothing left to recover
        return { videoUrl:st.videoUrl, seed:st.seed||null, cached:false };
      }
    }
    throw new Error("The video render timed out — try again, or pick a faster tier / lower resolution in Render settings.");
    }finally{ _vidPollLease.delete(sub.requestId); }   // cancel/timeout/failure: the job is up for recovery again
  };
  /* likenessRetry:false = the caller already burned a declaration pass (stage's
     dropped-char-refs fallback): render ONCE with the fiction note up front and
     surface the help on a repeat flag — never a third silent multi-minute pass. */
  if(opts.likenessRetry===false){
    try{ return await attempt(VID_FICTION_NOTE+"\n"+promptText); }
    catch(e){
      if(vidLikenessError(e && e.message)) throw new Error(VID_LIKENESS_HELP);
      throw e;
    }
  }
  try{ return await attempt(promptText); }
  catch(e){
    if(!vidLikenessError(e && e.message)) throw e;
    // likeness false positive — one retry with the declaration up front,
    // VISIBLY tagged: it's a full re-render, not the same render stuck
    if(opts.onStatus) opts.onStatus("RETRY");
    try{ return await attempt(VID_FICTION_NOTE+"\n"+promptText, "SAFETY_PASS_2"); }
    catch(e2){
      if(vidLikenessError(e2 && e2.message)) throw new Error(VID_LIKENESS_HELP);
      throw e2;
    }
  }
}
window.seedanceGenerate=seedanceGenerate;

/* ---- In-flight render registry ------------------------------------------------
   Stage tabs unmount the Shoot console when you visit Takes/Timeline/Mix. The fal
   job must keep polling and the UI must be able to resubscribe when Shoot remounts,
   so active render state lives at module scope instead of inside one React hook. */
const _vidJobs = new Map();   // id -> { gening,status,err,promise,cancelRef }
function _vidJobState(id){
  return _vidJobs.get(id) || { gening:false, status:"", err:"", promise:null, cancelRef:null };
}
function _vidJobPatch(id, patch){
  const prev = _vidJobState(id);
  const next = { ...prev, ...(patch||{}) };
  if(!next.gening && !next.status && !next.err && !next.promise) _vidJobs.delete(id);
  else _vidJobs.set(id, next);
  try{ window.dispatchEvent(new CustomEvent("vid-job",{ detail:{ id } })); }catch(e){}
  return next;
}
function _vidJobCancel(id){
  const j = _vidJobs.get(id);
  if(j && j.cancelRef) j.cancelRef.current = true;
  _vidJobPatch(id, { status:"CANCELLED" });
}

// ---- React hook (mirrors useVoiceGen) — one clip's video, by asset id --------
function useSeedanceGen(id){
  const [videoUrl,setVideoUrl]=React.useState(()=>vidGetVideo(id));
  const [jobTick,setJobTick]=React.useState(0);
  const idRef=React.useRef(id); idRef.current=id;
  const job = _vidJobState(id);
  const status = job.status || "";
  const gening = !!job.gening;
  const err = job.err || "";

  React.useEffect(()=>{ let alive=true;
    if(!vidGetVideo(id)){ vidLoadVideo(id).then(u=>{ if(alive&&u) setVideoUrl(u); }); }
    const onDone=(e)=>{ if(!alive||!e.detail||!e.detail.ids||e.detail.ids.indexOf(idRef.current)<0) return; setVideoUrl(vidGetVideo(idRef.current)); };
    const onJob=(e)=>{ if(!alive||!e.detail||e.detail.id!==idRef.current) return; setJobTick(t=>t+1); };
    window.addEventListener("vid-done", onDone);
    window.addEventListener("vid-job", onJob);
    return ()=>{ alive=false; window.removeEventListener("vid-done", onDone); window.removeEventListener("vid-job", onJob); };
  },[id]);

  const generate = React.useCallback(async (opts)=>{
    const jid = idRef.current;
    const existing = _vidJobs.get(jid);
    if(existing && existing.gening && existing.promise) return existing.promise;
    const cancelRef = { current:false };
    _vidJobPatch(jid, { gening:true, err:"", status:"IN_QUEUE", cancelRef });
    const promise = (async()=>{
      try{
        const r = await seedanceGenerate(jid, { ...(opts||{}),
          onStatus:(s)=>_vidJobPatch(jid, { gening:true, status:s }),
          shouldCancel:()=>cancelRef.current });
        // a discarded (cleared mid-render) or stale (film switched) result was NOT
        // committed — painting it here would ghost a take that isn't in the store
        if(!r.discarded && !r.stale) setVideoUrl(r.videoUrl);
        return r;
      }catch(e){
        const m = String((e&&e.message)||"Video render failed.");
        _vidJobPatch(jid, { err:m });
        throw e;
      }finally{
        _vidJobPatch(jid, { gening:false, status:"", promise:null, cancelRef:null });
      }
    })();
    _vidJobPatch(jid, { promise });
    return promise;
  },[]);
  const cancel = React.useCallback(()=>{ _vidJobCancel(idRef.current); },[]);
  const clear = React.useCallback(async ()=>{ _vidJobCancel(idRef.current); await vidClear(idRef.current); setVideoUrl(""); },[]);

  /* BATCH: N parallel Seedance jobs for the same clip. Each job gets a distinct random
     seed (a pinned seed is honoured on the first job only — identical seeds would just
     produce identical takes); every completion lands as a take via the serialized commit
     queue. Resolves with the successful results; partial failures surface in `err`
     without discarding the takes that did land. */
  const generateBatch = React.useCallback(async (base, count)=>{
    const n = Math.max(1, Math.min(4, Number(count)||1));
    if(n===1) return [await generate(base)];
    const jid = idRef.current;
    const existing = _vidJobs.get(jid);
    if(existing && existing.gening && existing.promise) return existing.promise;
    const cancelRef = { current:false };
    const states = new Array(n).fill("IN_QUEUE");
    const paint = ()=>{ const done=states.filter(s=>s==="COMPLETED").length;
      _vidJobPatch(jid, { gening:true, err:"", status:done+"/"+n+" takes · "+(states.find(s=>s!=="COMPLETED")||"COMPLETED") }); };
    paint();
    const promise = (async()=>{
      try{
        const jobs = Array.from({length:n},(_,i)=> seedanceGenerate(jid, { ...(base||{}),
          seed: (base && base.seed!=null && i===0) ? base.seed : undefined,
          takeMeta: { ...((base&&base.takeMeta)||{}), batchIndex:i+1, batchCount:n },
          force:true,
          onStatus:(s)=>{ states[i]=s; paint(); },
          shouldCancel:()=>cancelRef.current }));
        const settled = await Promise.allSettled(jobs);
        const ok = settled.filter(s=>s.status==="fulfilled").map(s=>s.value);
        const bad = settled.filter(s=>s.status==="rejected");
        if(!ok.length){
          const m = String((bad[0]&&bad[0].reason&&bad[0].reason.message)||"Video render failed.");
          _vidJobPatch(jid, { err:m });
          throw new Error(m);
        }
        if(bad.length) _vidJobPatch(jid, { err:bad.length+" of "+n+" takes failed: "+String((bad[0].reason&&bad[0].reason.message)||"render error") });
        setVideoUrl(vidGetVideo(jid));
        return ok;
      } finally {
        _vidJobPatch(jid, { gening:false, status:"", promise:null, cancelRef:null });
      }
    })();
    _vidJobPatch(jid, { promise, cancelRef });
    return promise;
  },[generate]);

  return { videoUrl, status, gening, err, generate, generateBatch, cancel, clear };
}
window.useSeedanceGen=useSeedanceGen;

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
const VID_MODEL_T2V      = "bytedance/seedance-2.0/text-to-video";
const VID_MODEL_T2V_FAST = "bytedance/seedance-2.0/fast/text-to-video";
// Seedance 2.5 transition endpoint (supports end_image_url, 480p/720p/1080p,
// 4–30s). fal lists NO fast variant for 2.5, so the
// "fast" constant aliases the standard endpoint — the registry has no 2.5 fast
// tier, so it's never selected; the alias just makes a stale opts.fast harmless.
const VID25_MODEL          = "bytedance/seedance-2.5/reference-to-video";
const VID25_MODEL_I2V      = "bytedance/seedance-2.5/image-to-video";
const VID25_MODEL_I2V_FAST = VID25_MODEL_I2V;
const VID25_MODEL_T2V      = "bytedance/seedance-2.5/text-to-video";
// Kling 3.0 Motion Control (Stage "Motion Control" tab): character image + motion video.
const VID_KLING_MOTION_STD = "fal-ai/kling-video/v3/standard/motion-control";
const VID_KLING_MOTION_PRO = "fal-ai/kling-video/v3/pro/motion-control";
// Seedance 2.5 reference-to-video task modes (fal `task`): editing rewrites @Video1
// (duration + aspect follow the source), extension continues @Video1 (aspect follows
// the source). Only the 2.5 reference endpoint accepts the parameter.
const VID_TASKS = ["reference","editing","extension"];
window.VID_MODEL = VID_MODEL; window.VID_MODEL_FAST = VID_MODEL_FAST;
window.VID25_MODEL = VID25_MODEL; window.VID_KLING_MOTION_STD = VID_KLING_MOTION_STD; window.VID_KLING_MOTION_PRO = VID_KLING_MOTION_PRO;
window.VID_MODEL_I2V = VID_MODEL_I2V; window.VID_MODEL_I2V_FAST = VID_MODEL_I2V_FAST;
function vidAssertIdentity(opts, phase){
  opts=opts||{};
  if(typeof window.nbAssertMediaIdentity==="function")
    return window.nbAssertMediaIdentity(opts, phase||"video");
  const c=opts.identityCharacter||opts.character, ids=opts.identityCharacterIds||opts.characterIds;
  if(!c && !(ids&&ids.length) && !(opts.identityCast&&opts.identityCast.length)) return true;
  const ctx=opts.identityContext||{characterIds:ids||(c&&c.id?[c.id]:[]),
    scenes:opts.identityScenes,drafts:opts.identityDrafts,
    ...(opts.identityCast&&opts.identityCast.length ? {cast:opts.identityCast} : (c ? {cast:[c]} : {}))};
  let r;
  try{
    if(c&&typeof window.turnAssertCharacterIdentity==="function") r=window.turnAssertCharacterIdentity(c,ctx);
    else if(typeof window.turnAssertProjectIdentity==="function") r=window.turnAssertProjectIdentity(ctx);
  }catch(e){
    if(e && e.identityReport && e.identityReport.status==="unset" && !c && !(ids&&ids.length)) return true;
    throw e;
  }
  if(r===false || (r&&(r.ok===false||r.valid===false||r.blocked))) throw new Error(String(r.message||"Character identity needs review before rendering."));
  return r;
}
window.vidAssertIdentity=vidAssertIdentity;
function _seedanceEndpoint(modelOrEndpoint){
  const raw=String(modelOrEndpoint||VID_MODEL);
  if(!raw.includes("/") && /seedance-2\.5/i.test(raw)) return "bytedance/seedance-2.5/reference-to-video";
  if(!raw.includes("/") && /seedance-2\.0/i.test(raw)) return VID_MODEL;
  return raw;
}

/* ── STAGE SCREENPLAY REFERENCE -----------------------------------------------
   Stage owns the immutable source snapshot; this worker owns delivery.  The
   reference is deliberately text-only.  In particular, it must never turn a
   screenplay page into a video/image reference or be shortened to fit a
   provider's media limits. */
const VID_SCREENPLAY_SCHEMA = "cm-stage-screenplay-v1";
function _vidClone(value){
  if(Array.isArray(value)) return value.map(_vidClone);
  if(value && typeof value==="object"){
    const out={}; Object.keys(value).forEach(k=>{ out[k]=_vidClone(value[k]); }); return out;
  }
  return value;
}
function _vidFreeze(value){
  if(value && typeof value==="object" && !Object.isFrozen(value)){
    Object.keys(value).forEach(k=>_vidFreeze(value[k]));
    try{ Object.freeze(value); }catch(e){}
  }
  return value;
}
function _vidScreenplayReferenceSnapshot(value){
  if(!value || typeof value!=="object" || Array.isArray(value))
    throw new Error("Stage screenplay reference is missing or malformed.");
  if(value.schema!==VID_SCREENPLAY_SCHEMA || value.kind!=="screenplay" || value.delivery!=="prompt-text")
    throw new Error("Stage screenplay reference has an unsupported schema or delivery mode.");
  if(value.sceneId==null || String(value.sceneId)==="")
    throw new Error("Stage screenplay reference is missing sceneId.");
  if(typeof value.sourceRev!=="string" || !value.sourceRev)
    throw new Error("Stage screenplay reference is missing sourceRev.");
  if(typeof value.fullText!=="string" || !value.fullText.trim())
    throw new Error("Stage screenplay reference has no full scene screenplay source.");
  if(value.hasSource!==true)
    throw new Error("Stage screenplay reference has no current screenplay source.");
  if(!Array.isArray(value.targetBeats) || !value.targetBeats.length
     || value.targetBeats.some(beat=>typeof beat!=="number" || !Number.isFinite(beat) || beat<=0)
     || typeof value.targetText!=="string" || !value.targetText.trim() ||
     !Array.isArray(value.errors) || value.errors.length)
    throw new Error("Stage screenplay reference is incomplete or contains source errors.");
  if(typeof value.signature!=="string" || !value.signature)
    throw new Error("Stage screenplay reference is missing signature.");
  const copy=_vidClone({
    schema:value.schema, kind:value.kind, delivery:value.delivery,
    sceneId:value.sceneId, sceneNo:value.sceneNo==null?"":value.sceneNo,
    sceneTitle:value.sceneTitle==null?"":String(value.sceneTitle),
    sourceRev:value.sourceRev, fullText:value.fullText,
    targetBeats:value.targetBeats, targetText:value.targetText,
    hasSource:value.hasSource, errors:value.errors, signature:value.signature,
  });
  return _vidFreeze(copy);
}

/* Stage screenplay pages are a second, deliberately separate reference class.
   They are reading material for the provider, never a start frame.  Keep this
   validation here (rather than trusting takeMeta or a UI count) so a caller
   cannot submit a partial, stale, or metadata-only page package. */
const VID_SCREENPLAY_IMAGE_GUARD =
  "SCREENPLAY PAGE IMAGE REFERENCES (binding): @ImageN page refs are reading context only. " +
  "NEVER photograph, animate, reproduce, or render the screenplay page, its captions, " +
  "borders, panels, watermarks, or text. Page refs are not visual composition or " +
  "cast/permission to perform any later beat; they are not character likeness or " +
  "authorization to perform later action; perform " +
  "only the selected target beat from the authored screenplay.";
function _vidSameNumbers(a,b){
  return Array.isArray(a) && Array.isArray(b) && a.length===b.length
    && a.every((v,i)=>v===b[i]);
}
function _vidScreenplayImagesSnapshot(value, screenplayReference, imageUrls, frameUrl, requireComplete){
  if(value===undefined) return null;
  if(!Array.isArray(value))
    throw new Error("Stage screenplayImages must be an array of page descriptors; render was not submitted.");
  if(!value.length){
    if(requireComplete) throw new Error("Stage screenplayImages must contain every screenplay page; no page images were supplied.");
    return null;
  }
  if(!screenplayReference)
    throw new Error("Stage screenplayImages require a matching screenplayReference; render was not submitted.");
  const actual = _vidDedup(Array.isArray(imageUrls) ? imageUrls : []);
  const pages = value.map((page,i)=>{
    if(!page || typeof page!=="object" || Array.isArray(page))
      throw new Error("Stage screenplayImages page "+(i+1)+" is malformed; render was not submitted.");
    const id=String(page.id==null ? "" : page.id).trim();
    const url=String(page.url==null ? "" : page.url).trim();
    const label=String(page.label==null ? "" : page.label);
    const n=page.page, total=page.totalPages;
    if(!id || !url) throw new Error("Stage screenplayImages page "+(i+1)+" is missing id or url; render was not submitted.");
    if(!Number.isInteger(n) || n<1 || !Number.isInteger(total) || total<1 || n>total)
      throw new Error("Stage screenplayImages page "+(i+1)+" has an invalid page/totalPages value; render was not submitted.");
    if(typeof page.sourceSignature!=="string" || page.sourceSignature!==screenplayReference.signature)
      throw new Error("Stage screenplayImages page "+n+" has a stale or mismatched source signature; render was not submitted.");
    if(!Array.isArray(page.targetBeats) || !_vidSameNumbers(page.targetBeats,screenplayReference.targetBeats))
      throw new Error("Stage screenplayImages page "+n+" has mismatched target beats; render was not submitted.");
    if(actual.indexOf(url)<0)
      throw new Error("Stage screenplayImages page "+n+" is not present in the actual imageUrls payload; render was not submitted.");
    if(String(frameUrl||"").trim()===url)
      throw new Error("A screenplay page image cannot be used as the start frame; render was not submitted.");
    return {
      id, url, label, page:n, totalPages:total,
      sourceSignature:page.sourceSignature,
      targetBeats:page.targetBeats.slice(),
    };
  });
  const total=pages[0].totalPages;
  if(pages.some(page=>page.totalPages!==total))
    throw new Error("Stage screenplayImages must use one complete totalPages value; render was not submitted.");
  const seenPages=new Set(), seenIds=new Set(), seenUrls=new Set();
  pages.forEach(page=>{
    if(seenPages.has(page.page) || seenIds.has(page.id) || seenUrls.has(page.url))
      throw new Error("Stage screenplayImages contains duplicate page descriptors; render was not submitted.");
    seenPages.add(page.page); seenIds.add(page.id); seenUrls.add(page.url);
  });
  if(requireComplete && (pages.length!==total || pages.some((page,i)=>!seenPages.has(i+1))))
    throw new Error("Stage screenplayImages must contain the complete page set 1–"+total+"; render was not submitted.");
  const snapshot=_vidClone(pages);
  return _vidFreeze(snapshot);
}
function _vidScreenplayImageGuard(pages, images){
  const refs=(pages||[]).map(page=>{
    const index=(images||[]).indexOf(page.url);
    return index>=0 ? "@Image"+(index+1) : "@ImageN";
  });
  const label=refs.length ? refs.join(", ") : "@ImageN";
  return VID_SCREENPLAY_IMAGE_GUARD.replace("@ImageN",label);
}
/* takeMeta can also contain the Stage reference tray.  Once screenplayImages
   is present, its page URLs are already losslessly owned by screenplayImages;
   retaining those same PNG strings in references and caller-provided page
   fields only multiplies localStorage pressure. */
function _vidCompactScreenplayTakeMeta(value, pages){
  const out=_vidClone(value&&typeof value==="object"&&!Array.isArray(value) ? value : {});
  if(!pages || !pages.length) return out;
  ["screenplayImages","screenplayImageSnapshots","screenplayImageProvenance"].forEach(k=>{ delete out[k]; });
  const byUrl=new Map(pages.map(page=>[page.url,page]));
  if(Array.isArray(out.references)){
    out.references=out.references.map(ref=>{
      const page=ref&&typeof ref==="object" ? byUrl.get(String(ref.url||"")) : null;
      if(!page) return ref;
      const compact={...ref};
      delete compact.url;
      compact.screenplayImageId=page.id;
      compact.screenplayPage=page.page;
      return compact;
    });
  }
  return out;
}

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

const _vidMem = new Map();      // id -> { url, meta, owner? } (legacy/local entries omit owner)
function vidKey(id){ return "v:"+id; }
function _vidCacheOwner(scope){
  const sc = scope===undefined ? vidScope() : scope;
  if(!sc || sc.projectId==null){
    /* New local commits carry the asset epoch so a local film switch cannot
       lazily read an overlapping IDB key.  Truly old records stay ownerless
       for backwards compatibility. */
    return sc && sc.epoch!=null ? { projectId:null, uid:null, epoch:sc.epoch } : null;
  }
  return { projectId:sc.projectId, uid:sc.uid==null ? null : sc.uid };
}
function _vidStoreEntry(url, meta, scope){
  const owner = _vidCacheOwner(scope);
  return owner ? { url, meta:meta||null, owner } : { url, meta:meta||null };
}
function _vidCacheEntryVisible(entry, scope){
  if(!entry || !entry.url) return false;
  const owner = entry.owner;
  if(!owner) return true; // legacy/local cache compatibility
  const sc = scope===undefined ? _vidScopeSnapshot(vidScope()) : scope;
  if(owner.projectId==null){
    if(sc && sc.projectId!=null) return true; // preserve legacy/local visibility across cloud mode
    return owner.epoch==null || sc.epoch==null || owner.epoch===sc.epoch;
  }
  return !!sc && sc.projectId===owner.projectId
    && (owner.uid==null || sc.uid===owner.uid);
}
function _vidCacheEntryOwnedBy(entry, scope){
  if(!entry || !entry.url) return false;
  const owner = entry.owner;
  if(!owner)
    return !scope || scope.projectId==null; // legacy/local deletion stays local-only
  if(owner.projectId==null)
    return !!scope && scope.projectId==null
      && (owner.epoch==null || scope.epoch==null || owner.epoch===scope.epoch);
  return _vidCacheEntryVisible(entry,scope);
}
function vidGetVideo(id){
  const e=_vidMem.get(id); return _vidCacheEntryVisible(e) ? e.url : "";
}
function vidGetMeta(id){
  const e=_vidMem.get(id); return _vidCacheEntryVisible(e) ? (e.meta||null) : null;
}
function vidGetTakes(id){
  const e=_vidMem.get(id), out=[];
  if(!_vidCacheEntryVisible(e)) return out;
  if(e&&e.url) out.push({ id:id+":current", url:e.url, meta:e.meta||null, current:true });
  (((e&&e.meta&&e.meta.takes)||[])).forEach((t,i)=>{ if(t&&t.url) out.push({ id:id+":take-"+i, url:t.url, meta:t.meta||null, current:false }); });
  return out;
}
async function vidLoadVideo(id){
  const sync=vidGetVideo(id); if(sync) return sync;
  const scope0 = _vidScopeSnapshot(vidScope());
  try{
    const v=await vidIdbGet(vidKey(id));
    if(!_vidScopeMatches(scope0)) return "";
    if(v && _vidCacheEntryVisible(v,scope0)){ _vidMem.set(id,v); return v.url; }
  }catch(e){}
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
function _vidScopeSnapshot(scope){
  const live = scope || null;
  return {
    projectId:live && live.projectId!=null ? live.projectId : null,
    uid:live && live.uid!=null ? live.uid : null,
    epoch:live && live.epoch!=null
      ? live.epoch
      : (typeof window.nbEpoch==="function" ? window.nbEpoch() : null),
  };
}
function _vidScopeMatches(scope){
  if(!scope || typeof scope!=="object") return true;
  const live = vidScope();
  const projectId = live && live.projectId!=null ? live.projectId : null;
  const uid = live && live.uid!=null ? live.uid : null;
  const epoch = live && live.epoch!=null
    ? live.epoch
    : (typeof window.nbEpoch==="function" ? window.nbEpoch() : null);
  return projectId===scope.projectId
    && (scope.uid==null || uid===scope.uid)
    && (scope.epoch==null || epoch===scope.epoch);
}
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
  if(scope && !_vidScopeMatches(scope)) return { skipped:true };
  const sc = scope || vidScope(); if(!sc || sc.projectId==null) return;  // local mode: IDB only
  _vidIdsMark(sc.projectId, id, !(entry && entry.url));         // intended membership, even if the push fails
  try{
    if(entry && entry.url){
      if(typeof window.cloudCommitVideo!=="function") throw new Error("cloud unavailable");
      await window.cloudCommitVideo(sc.projectId, sc.uid, id, entry);
    } else {
      if(typeof window.cloudVideoDelete!=="function") throw new Error("cloud unavailable");
      await window.cloudVideoDelete(sc.projectId, id);
    }
    if(scope && !_vidScopeMatches(scope)) return { skipped:true };
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
  const scope0 = _vidScopeSnapshot(sc);
  const m = { ...(_vidDirtyAll()[sc.projectId]||{}) };
  let n = 0;
  for(const id of Object.keys(m)){
    if(!_vidScopeMatches(scope0)) break;
    if(m[id]==="del") await _vidCloudPush(id, null, scope0);
    else{
      const e = await _vidLoadEntry(id, scope0);
      if(!_vidScopeMatches(scope0)) break;
      if(e && e.url) await _vidCloudPush(id, e, scope0);
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
    if(!_vidScopeSame(sc)) return 0;
    const rows = (typeof window.cloudVideoLoadAll==="function") ? await window.cloudVideoLoadAll(sc.projectId) : null;
    if(!rows) return 0;
    if(!_vidScopeSame(sc)) return 0;               // film/user/epoch switched while loading → drop
    const dirty = _vidDirtyAll()[sc.projectId]||{};
    const ids = [];
    for(const id of Object.keys(rows)){
      if(dirty[id] || !rows[id] || !rows[id].url) continue;
      if(!_vidScopeSame(sc)) return 0;
      const e = _vidStoreEntry(rows[id].url, rows[id].meta||null, sc);
      _vidMem.set(id, e);
      try{ await vidIdbSet(vidKey(id), e); }catch(err){}
      if(!_vidScopeSame(sc)) return 0;
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
      await _vidDeleteStoredEntry(id, sc);
      if(!_vidScopeSame(sc)) return 0;
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
/* the shots a take records (meta.shotSources) */
function _vidTakeShotIds(meta){
  return ((meta&&meta.shotSources)||[]).map(x=>x&&x.shotId).filter(Boolean).map(String);
}
function vidAdoptTakes(id, legacyId, shotIds){
  if(!id || !legacyId || id===legacyId) return Promise.resolve(null);
  return _vidQueued(async ()=>{
    const scope0 = _vidScopeSnapshot(vidScope());
    const cur = await _vidLoadEntry(id, scope0);
    if(!_vidScopeMatches(scope0)) return null;
    if(cur && cur.url) return null;                      // already migrated / has its own takes
    const old = await _vidLoadEntry(legacyId, scope0);
    if(!_vidScopeMatches(scope0)) return null;
    if(!old || !old.url) return null;
    /* (2026-10-09, owner — Stage review) a positional take moves only onto the SAME shots: when it records
       its shots and they aren't this clip's, it stays where it is (it was attached to whatever clip now
       sat at its position) */
    const recorded = _vidTakeShotIds(old.meta);
    if(Array.isArray(shotIds) && recorded.length
      && (recorded.length!==shotIds.length || recorded.some((x,i)=>x!==String(shotIds[i])))) return null;
    if(!_vidCacheEntryOwnedBy(old,scope0)) return null;
    if(!await _vidWriteEntry(id, old, scope0)) return null;
    if(!_vidScopeMatches(scope0)) return null;
    await _vidDeleteStoredEntry(legacyId, scope0);
    if(!_vidScopeMatches(scope0)) return null;
    const retired = await _vidCloudPush(legacyId, null, scope0);   // retire the old positional cloud row too
    if(retired && retired.skipped) return null;
    return { migrated:true };
  });
}
window.vidAdoptTakes=vidAdoptTakes;

/* TAKES FROM AN EARLIER GROUPING (2026-10-09, owner — Stage review): a clip's id is built from its shots,
   so adding or removing a shot, switching model or clip scope, or re-voicing a line that splits a beat
   gives it a new id — its takes stayed under the old one, out of sight. vidKnownIds lists the clip ids
   this film has takes for; vidMergeTakes moves one id's takes onto a clip when the user says so (never
   automatically): they join as takes, and the old take becomes current only when the clip has none. */
function vidKnownIds(){
  const sc = _vidScopeSnapshot(vidScope());
  const out = new Set(((sc && sc.projectId!=null) ? (_vidIdsAll()[sc.projectId]||[]) : []));
  _vidMem.forEach((e,id)=>{ if(e && e.url && _vidCacheEntryVisible(e,sc)) out.add(id); });
  return Array.from(out);
}
window.vidKnownIds = vidKnownIds;
window.vidTakeShotIds = _vidTakeShotIds;
function vidMergeTakes(toId, fromId){
  if(!toId || !fromId || toId===fromId) return Promise.resolve(null);
  return _vidQueued(async ()=>{
    const scope0 = _vidScopeSnapshot(vidScope());
    const from = await _vidLoadEntry(fromId, scope0);
    if(!_vidScopeMatches(scope0) || !from || !from.url || !_vidCacheEntryOwnedBy(from,scope0)) return null;
    const to = await _vidLoadEntry(toId, scope0);
    if(!_vidScopeMatches(scope0)) return null;
    const fromMeta = { ...(from.meta||{}) }; const fromTakes = fromMeta.takes||[]; delete fromMeta.takes;
    const moved = [{ url:from.url, meta:fromMeta, savedAt:fromMeta.createdAt||Date.now() }].concat(fromTakes)
      .filter(t=>t && t.url);
    let entry;
    if(to && to.url){
      const toMeta = to.meta||{};
      const have = new Set([to.url].concat((toMeta.takes||[]).map(t=>t&&t.url)));
      entry = { url:to.url, meta:{ ...toMeta, takes:(toMeta.takes||[]).concat(moved.filter(t=>!have.has(t.url))) } };
    } else {
      entry = { url:from.url, meta:{ ...fromMeta, takes:fromTakes } };
    }
    if(!await _vidWriteEntry(toId, entry, scope0)) return null;
    if(!_vidScopeMatches(scope0)) return null;
    await _vidDeleteStoredEntry(fromId, scope0);
    if(!_vidScopeMatches(scope0)) return null;
    await _vidCloudPush(fromId, null, scope0);
    try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[toId, fromId] } })); }catch(e){}
    return { merged:moved.length };
  });
}
window.vidMergeTakes = vidMergeTakes;

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
function vidCommitQueued(id, url, meta, scope, opts){
  return _vidQueued(()=>_vidCommitRaw(id, url, meta, scope, opts));
}
/* WHICH TAKE STAYS CURRENT (2026-10-09, owner — Stage review): a NEW take (opts.newTake: a render or a
   recovered render) used to always become the clip's current take — a render collected days later,
   or whichever batch take landed last, replaced the take you approved. Now a new take joins the takes
   WITHOUT replacing the current one when that one is approved, when it arrives by recovery after
   another take was made current, or when it is flagged (identity changed: opts.asDraft). */
function _vidKeepsCurrent(old, url, opts){
  if(!opts || !opts.newTake || !old || !old.url || old.url===url) return false;
  const om = old.meta || {};
  return om.status==="approved" || !!opts.asDraft || !!opts.recovered;
}
async function _vidCommitRaw(id, url, meta, scope, opts){
  /* scope re-check at EXECUTION time: this commit may have waited in the queue
     behind hydrate/cloud I/O while the user switched films. Writing then would
     plant another film's take into the fresh state — skip every write and tell
     the caller, which keeps the job pending for project-scoped recovery. */
  if(scope && !_vidScopeMatches(scope)) return { skipped:true };
  const commitScope = scope && typeof scope==="object" ? scope : _vidScopeSnapshot(vidScope());
  let old = _vidMem.get(id);
  if(!_vidCacheEntryVisible(old,commitScope)) old = null;
  if(!old){
    try{ old = await vidIdbGet(vidKey(id)); }catch(e){ old = null; }
    /* This check is deliberately immediately after the IDB read.  A project
       switch here must not install the old film's overlapping clip in memory
       or roll it into the new film's takes. */
    if(!_vidScopeMatches(commitScope)) return { skipped:true };
    if(!_vidCacheEntryOwnedBy(old,commitScope)) old = null;
  }
  if(!_vidScopeMatches(commitScope)) return { skipped:true };
  if(old && !_vidCacheEntryOwnedBy(old,commitScope)) old = null;
  const takes = [];
  const oldMeta = (old&&old.meta)||null;
  const keepCurrent = _vidKeepsCurrent(old, url, opts);
  if(old&&old.url&&old.url!==url&&!keepCurrent) takes.push({ url:old.url, meta:oldMeta, savedAt:(oldMeta&&oldMeta.createdAt)||Date.now() });
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
  meta = { ...meta, createdAt:meta.createdAt||Date.now() };
  const capTakes = (list)=>{ const capped = [];
    list.forEach(t=>{ const ap = t&&t.meta&&t.meta.status==="approved"; if(ap || capped.filter(x=>!(x&&x.meta&&x.meta.status==="approved")).length<20) capped.push(t); });
    return capped; };
  if(keepCurrent){
    // the new take goes first among the others; the current (approved / chosen) take stays
    const nm = { ...meta }; delete nm.takes;
    const others = capTakes([{ url, meta:nm, savedAt:Date.now() }].concat(takes));
    const keptEntry = _vidStoreEntry(old.url, { ...(oldMeta||{}), takes:others }, commitScope);
    _vidMem.set(id, keptEntry);
    try{ await vidIdbSet(vidKey(id), keptEntry); }catch(e){}
    if(!_vidScopeMatches(commitScope)) return { skipped:true };
    const cloudKept = await _vidCloudPush(id, { url:keptEntry.url, meta:keptEntry.meta||null }, commitScope);
    if(cloudKept && cloudKept.skipped) return cloudKept;
    if(!_vidScopeMatches(commitScope)) return { skipped:true };
    try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(e){}
    return { url, keptCurrent:true };
  }
  // APPROVED takes never roll over; everything else keeps the newest 20
  meta = { ...meta, takes:capTakes(takes) };
  const stored = _vidStoreEntry(url, meta, commitScope);
  _vidMem.set(id, stored);
  try{ await vidIdbSet(vidKey(id), stored); }catch(e){}
  if(!_vidScopeMatches(commitScope)) return { skipped:true };
  const cloudResult = await _vidCloudPush(id, { url, meta:meta||null }, commitScope);
  if(cloudResult && cloudResult.skipped) return cloudResult;
  if(!_vidScopeMatches(commitScope)) return { skipped:true };
  try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(e){}
  return { url };
}
/* did the film change while an action WAITED in the queue? Take mutations are
   user intent aimed at the film that was open at click time — after a switch
   they must not write into the new film's memory/IDB or cloud rows. */
function _vidScopeSame(a){
  if(a && typeof a==="object") return _vidScopeMatches(a);
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
    if(!_vidScopeSame(scope0)) return;
    await _vidDeleteStoredEntry(id, scope0);
    if(!_vidScopeSame(scope0)) return;
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
async function _vidLoadEntry(id, scope){
  const scope0 = scope && typeof scope==="object" ? scope : _vidScopeSnapshot(vidScope());
  let e = _vidMem.get(id);
  if(e && _vidCacheEntryVisible(e,scope0)) return e;
  e = null;
  try{ e = await vidIdbGet(vidKey(id)); }catch(err){ e = null; }
  /* Never install a lazy IDB result after a film/user/epoch switch. */
  if(!_vidScopeMatches(scope0) || !_vidCacheEntryVisible(e,scope0)) return null;
  _vidMem.set(id, e);
  return e;
}
async function _vidDeleteStoredEntry(id, scope){
  const scope0 = scope && typeof scope==="object" ? scope : _vidScopeSnapshot(vidScope());
  if(!_vidScopeMatches(scope0)) return false;
  let stored = null;
  try{ stored = await vidIdbGet(vidKey(id)); }catch(e){}
  if(!_vidScopeMatches(scope0)) return false;
  const mem = _vidMem.get(id);
  if(!_vidCacheEntryOwnedBy(mem,scope0) && !_vidCacheEntryOwnedBy(stored,scope0)) return false;
  if(_vidCacheEntryOwnedBy(mem,scope0)) _vidMem.delete(id);
  if(!_vidCacheEntryOwnedBy(stored,scope0)) return _vidScopeMatches(scope0);
  try{ await vidIdbDel(vidKey(id)); }catch(e){}
  return _vidScopeMatches(scope0);
}
async function _vidWriteEntry(id, e, scope){
  const scope0 = scope && typeof scope==="object" ? scope : _vidScopeSnapshot(vidScope());
  if(!_vidScopeMatches(scope0)) return null;
  const stored = _vidStoreEntry(e&&e.url, e&&e.meta, scope0);
  _vidMem.set(id, stored);
  try{ await vidIdbSet(vidKey(id), stored); }catch(err){}
  if(!_vidScopeMatches(scope0)) return null;
  const cloudResult = await _vidCloudPush(id, { url:stored.url, meta:stored.meta }, scope0);   // approvals/notes/restores/deletes are project records too
  if(cloudResult && cloudResult.skipped) return null;
  if(!_vidScopeMatches(scope0)) return null;
  try{ window.dispatchEvent(new CustomEvent("vid-done",{ detail:{ ids:[id] } })); }catch(err){}
  return stored;
}
// merge a meta patch into one take (current or archived), matched by url
function vidUpdateTake(id, url, patch){
  const scope0 = vidScope();
  return _vidQueued(async ()=>{
    if(!_vidScopeSame(scope0)) return null;   // film switched while queued — drop, never cross-write
    const e = await _vidLoadEntry(id, scope0); if(!e || !e.url) return null;
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
    const e = await _vidLoadEntry(id, scope0); if(!e || !e.url) return null;
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
    const e = await _vidLoadEntry(id, scope0); if(!e) return null;
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
    const e = await _vidLoadEntry(id, scope0); if(!e || !e.url) return null;
    const takes = ((e.meta&&e.meta.takes)||[]);
    if(e.url===url){
      const next = takes[0];
      if(!next){
        await _vidDeleteStoredEntry(id, scope0);
        if(!_vidScopeSame(scope0)) return null;
        const cloudResult = await _vidCloudPush(id, null, scope0);
        if(cloudResult && cloudResult.skipped) return null;
        if(!_vidScopeSame(scope0)) return null;
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
  if(!videoProxyReady()) throw new Error("Video rendering isn't available right now — sign in and try again.");
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
    try{ ({ data, error } = await sb.functions.invoke(fnName, { body:{ ...(typeof window.turnFilmContext==="function" && window.turnFilmContext() ? { context:window.turnFilmContext() } : {}), task:"video", op, ...(payload||{}),
      userApiKeys: window.turnApiKeysForProxy ? window.turnApiKeysForProxy(["fal"]) : undefined } })); }
    catch(e){ error=e; }
    const netFail = !!error && !((error&&error.context&&error.context.status)||error.status||0);
    if(netFail && a<netRetries){ await new Promise(r=>setTimeout(r, 900*(a+1))); continue; }
    break;
  }
  if(error){
    const status=(error&&error.context&&error.context.status)||error.status||0;
    const _safe = window.turnSafeError || (x=>x);
    /* supabase-js FunctionsHttpError keeps the Edge Function response on
       error.context. Read a CLONE so its structured provider detail/code survives
       the non-2xx wrapper instead of collapsing into "Edge Function returned…". */
    let errorBody=null;
    const context=error&&error.context;
    if(context && typeof context.json==="function"){
      try{
        const readable=typeof context.clone==="function" ? context.clone() : context;
        errorBody=await readable.json();
      }catch(e){}
    }
    /* a BILLING refusal (402 no plan / not enough credits, a frozen account, a plan-only
       engine) becomes one calm sentence, and credit/plan refusals open the Plans window */
    const billing = (typeof window.turnBillingError==="function") ? window.turnBillingError(errorBody, status) : null;
    if(billing){
      const msg = (typeof window.turnHandleBillingError==="function") ? window.turnHandleBillingError(billing) : billing.message;
      const ex=new Error(msg||billing.message);
      ex.billing=billing.code; ex.code=billing.code; ex.httpStatus=status||null;
      /* a 409 price_changed carries the server's price (creditsRequired) and, when a reference
         video's length couldn't be read, reason:"length_unreadable" (+ detail: why) — the Stage
         then offers to render at that price (app/stage.jsx stageWithLengthReprice) */
      if(errorBody && typeof errorBody==="object"){
        const need=Math.ceil(Number(errorBody.creditsRequired));
        if(need>0) ex.creditsRequired=need;
        if(errorBody.reason!=null) ex.reason=String(errorBody.reason);
        else if(errorBody.lengthUnverified===true) ex.reason="length_unreadable";   // the first server repair's flag
        if(typeof errorBody.detail==="string" && errorBody.detail.trim()) ex.detail=errorBody.detail.trim();
      }
      throw ex;
    }
    if(errorBody && typeof errorBody==="object"){
      const raw=errorBody.error!=null ? errorBody.error
        : errorBody.detail!=null ? errorBody.detail : errorBody.message;
      if(raw!=null){
        const detail=typeof raw==="string" ? raw : JSON.stringify(raw);
        const ex=new Error(detail);
        ex.providerDetail=detail;
        if(errorBody.errorCode!=null) ex.errorCode=errorBody.errorCode;
        if(errorBody.code!=null) ex.code=errorBody.code;
        if(errorBody.retry===true) ex.retry=true;
        ex.providerStatus=errorBody.status!=null ? errorBody.status : status;
        ex.httpStatus=status||null;
        throw ex;
      }
    }
    if(status===401) throw new Error("Sign in to render video — it runs on your server, not the browser.");
    if(status===404) throw new Error(_safe("The media proxy isn't deployed yet. Deploy supabase/functions/image-proxy (the video route), then have an administrator set FAL_KEY."));
    if(!status) throw new Error(_safe(op==="submit"
      ? "Couldn't confirm the video service's response. The render may already have started: wait a few minutes and check this clip's takes before rendering again, so you don't start a duplicate (a render that started is charged only if it finishes)."
      : "Couldn't reach the video service while checking the existing render. The job may still be processing; its pending record is preserved so it can be checked again."));
    throw new Error(_safe("Couldn't reach the video service: "+((error&&error.message)||"unknown error")+"."));
  }
  if(data && data.error){
    const detail=typeof data.error==="string" ? data.error : JSON.stringify(data.error);
    const ex=new Error(detail);   // fal detail is preserved verbatim for classification/support
    ex.providerDetail=detail;
    if(data.errorCode!=null) ex.errorCode=data.errorCode;
    if(data.code!=null) ex.code=data.code;
    if(data.retry===true) ex.retry=true;   // "poll again": the job's credits stay held (result_pending)
    if(data.status!=null) ex.providerStatus=data.status;
    throw ex;
  }
  return data||{};
}
/* A POLL ANSWER TO RETRY, NOT A FAILURE (billing round 2). The server answers
   { error, code:"result_pending", retry:true, status:"IN_PROGRESS" } when it couldn't check the
   job's credits, couldn't fetch a finished render's result yet, or the result has no video URL
   yet — it keeps the credits held and the job is still collectable. Treating that as final used
   to drop the pending record (the server then kept the hold for a video nobody collected) or end
   a live render with an error (inviting a second paid Generate). */
function _vidPollRetryable(e){
  return !!e && (e.retry===true || String(e.code||"")==="result_pending");
}
/* the video service briefly failing to report the job's status: an older proxy relays fal's
   408 / 425 / 429 / 5xx status answer as { error, status:<http number> } (a newer one answers result_pending,
   above). The job itself is still running, so this is never a final answer (billing round 3). */
function _vidStatusHiccup(e){
  const ps=Number(e&&e.providerStatus);
  return ps===408 || ps===425 || ps===429 || (ps>=500 && ps<600);   // the same codes the server now answers result_pending for
}
/* transient for the crash-recovery patrol: a retry answer, an unreachable proxy, a lapsed
   sign-in, or the video service briefly failing to report the job's status (429 / 5xx) */
function _vidPollTransient(e){
  if(_vidPollRetryable(e)) return true;
  const msg=String((e&&e.message)||"");
  if(/Couldn't reach the video (proxy|service)|Sign in to render video/i.test(msg)) return true;
  if(Number(e&&e.httpStatus)===401) return true;
  return _vidStatusHiccup(e);
}
/* the server doesn't know this job for the signed-in account (404 render_not_found): another
   account's render, or one it no longer has — never a provider failure, and nothing to refund */
function _vidPollNotFound(e){
  return !!e && String(e.code||"")==="render_not_found";
}
function _vidPollTerminal(e){
  return /^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(String((e&&e.providerStatus)||"")) || vidPolicyError(e);
}
window.vidPollRetryable=_vidPollRetryable;

// ---- render ONE clip: multimodal assets (frame/images + line audio + ref videos) →
//      lip-synced mp4; cache by hash. Limits are rejected, never silently truncated. ----
function _vidDedup(arr){ const out=[], seen=new Set();
  (arr||[]).forEach(u=>{ if(u && !seen.has(u)){ seen.add(u); out.push(u); } });
  return out; }
function seedanceCapabilities(modelOrEndpoint){
  const model = _seedanceEndpoint(modelOrEndpoint);
  const version = /seedance-2\.5/.test(model) ? "2.5" : "2.0";
  const fast = version==="2.0" && /\/fast\//.test(model);
  return {
    version, fast,
    duration:{ min:4, max:version==="2.5"?30:15, auto:true },
    resolutions:fast ? ["480p","720p"] : (version==="2.5" ? ["480p","720p","1080p"] : ["480p","720p","1080p","4K"]),
    aspectRatios:["auto","16:9","9:16","1:1","4:3","3:4","21:9"],
    bitrateModes:["standard","high"],
    references:version==="2.5"
      ? { images:{maxFiles:30,maxBytesEach:30*1024*1024}, videos:{maxFiles:10,maxBytesEach:200*1024*1024,minSecondsEach:1.8,maxSecondsEach:30.2,maxSecondsCombined:30.2}, audios:{maxFiles:10,maxBytesEach:15*1024*1024,minSecondsEach:1.8,maxSecondsEach:30.2,maxSecondsCombined:30.2}, maxFilesTotal:50 }
      : { images:{maxFiles:9}, videos:{maxFiles:3,maxBytesCombined:50*1024*1024,minSecondsCombined:2,maxSecondsCombined:15}, audios:{maxFiles:3,maxBytesCombined:15*1024*1024,maxSecondsCombined:15}, maxFilesTotal:12 },
    directAudioFiles:version==="2.5"?10:3,
  };
}
window.seedanceCapabilities = seedanceCapabilities;
const _seedanceRuntimeCaps = new Map();
async function seedanceGetRuntimeCapabilities(modelOrEndpoint){
  const model=_seedanceEndpoint(modelOrEndpoint);
  if(_seedanceRuntimeCaps.has(model)) return _seedanceRuntimeCaps.get(model);
  const pending=(async()=>{
    if(!videoProxyReady()) return { known:false, model, capabilities:null, schema:null, reason:"the video service is unavailable" };
    try{
      const reply=await vidProxy("capabilities",{model});
      const known=!!(reply&&reply.known&&reply.schema&&reply.capabilities);
      return { known, model, capabilities:known?reply.capabilities:null, schema:known?reply.schema:null,
        reason:known?"":"the video service hasn't confirmed this yet" };
    }catch(e){
      return { known:false, model, capabilities:null, schema:null,
        reason:"the video service hasn't confirmed what it supports yet" };
    }
  })();
  _seedanceRuntimeCaps.set(model,pending);
  const result=await pending;
  if(!result.known) _seedanceRuntimeCaps.delete(model);
  return result;
}
window.seedanceGetRuntimeCapabilities=seedanceGetRuntimeCapabilities;
function vidResolutionForModel(model, requested){
  const raw = String(requested || "720p").trim();
  const norm = raw.toLowerCase()==="4k" ? "4K" : raw.toLowerCase();
  const maxRank = /seedance-2\.5/.test(String(model||"")) ? 2
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

function _vidDataUrlFacts(url){
  const m=/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(url||""));
  if(!m) return {};
  const encoded=m[2].replace(/\s/g,""), pad=(encoded.match(/=*$/)||[""])[0].length;
  return { mime:m[1].toLowerCase(), sizeBytes:Math.max(0,Math.floor(encoded.length*3/4)-pad) };
}
/* ---- device media staged DIRECTLY into storage ---------------------------------
   Edge Functions cap request memory/CPU, so a device video (up to 200MB) can never
   ride the proxy body as a data URL. The proxy instead opens a one-shot signed
   upload slot in the caller's private `<uid>/stage-tmp/` namespace (op
   "stage-upload", non-spending); the browser PUTs the file there and submits the
   returned `stage:<path>` reference, which only the proxy can turn back into a
   short-lived read URL at job time. Facts (duration / size / mime) are probed
   from the local file BEFORE upload and kept here so validation never has to load
   a `stage:` reference in a media element. The registry is per tab on purpose:
   a `stage:` reference without facts fails closed. */
const _vidStagedFacts = new Map();
function vidStagedFacts(ref){ return _vidStagedFacts.get(String(ref||"")) || null; }
window.vidStagedFacts = vidStagedFacts;
function vidStagingCapability(caps){
  const st = caps && caps.staging;
  return !!(st && st.signedUpload && st.scheme==="stage:");
}
window.vidStagingCapability = vidStagingCapability;
async function vidStageDeviceMedia(file, kind, opts){
  opts = opts||{};
  kind = String(kind||"").toLowerCase();
  if(!file || typeof file.size!=="number") throw new Error("Choose a file from this device first.");
  if(!["video","image","audio"].includes(kind)) throw new Error("Only video, image or audio files can be staged.");
  const mime = String(file.type||"").toLowerCase();
  if(!mime.startsWith(kind+"/")) throw new Error("That file is not a "+kind+" ("+(mime||"unknown type")+").");
  if(!videoProxyReady()) throw new Error("Device uploads aren't available right now — sign in and try again.");
  // capability handshake (non-spending): an older deployed proxy has no upload
  // slot op and cannot resolve `stage:` references — refuse before uploading.
  const runtime = await seedanceGetRuntimeCapabilities(opts.capabilityModel || VID25_MODEL);
  if(!runtime.known || !vidStagingCapability(runtime.capabilities))
    throw new Error("Device uploads aren't available yet — they're waiting on a server update. Pick one of this clip's takes instead.");
  const st = runtime.capabilities.staging;
  const maxBytes = Number((st.maxBytes||{})[kind]) || (kind==="video" ? 200*1024*1024 : kind==="image" ? 30*1024*1024 : 15*1024*1024);
  if(file.size > maxBytes) throw new Error("That "+kind+" is "+Math.round(file.size/1024/1024)+"MB — the limit is "+Math.round(maxBytes/1024/1024)+"MB.");
  const blobUrl = URL.createObjectURL(file);
  let facts;
  try{ facts = kind==="image" ? { mime, sizeBytes:file.size } : await vidMediaFacts(blobUrl, kind); }
  catch(e){ URL.revokeObjectURL(blobUrl); throw e; }
  facts = { ...facts, mime, sizeBytes:file.size };
  if(opts.onStatus) opts.onStatus("Uploading "+kind+"…");
  let slot;
  try{ slot = await vidProxy("stage-upload", { kind, mime, sizeBytes:file.size }); }
  catch(e){ URL.revokeObjectURL(blobUrl); throw e; }
  if(!slot || !slot.ok || !slot.path || !slot.token || !slot.ref){ URL.revokeObjectURL(blobUrl); throw new Error("The upload couldn't be started — please try again."); }
  const sb = window.sbClient();
  const bucket = slot.bucket || (window.TURN_SUPABASE && window.TURN_SUPABASE.bucket) || "turn-assets";
  const up = await sb.storage.from(bucket).uploadToSignedUrl(slot.path, slot.token, file, { contentType: mime || "application/octet-stream", upsert:false });
  if(up && up.error){ URL.revokeObjectURL(blobUrl); throw new Error("Upload failed: "+(up.error.message||"storage refused the file")+"."); }
  const expiresAt = Date.now() + (Number(slot.expiresInSeconds)||7200)*1000;
  _vidStagedFacts.set(slot.ref, { ...facts, origin:"device", expiresAt });
  return { ref:slot.ref, blobUrl, facts:{ ...facts }, expiresAt, name:String(file.name||""), kind };
}
window.vidStageDeviceMedia = vidStageDeviceMedia;

async function vidMediaFacts(url, kind){
  if(/^stage:/i.test(String(url||""))){
    const staged=_vidStagedFacts.get(String(url));
    if(!staged) throw new Error("A device upload's metadata is no longer available in this tab — choose the file again before submitting.");
    if(staged.expiresAt && Date.now()>staged.expiresAt) throw new Error("A device upload has expired — choose the file again before submitting.");
    // explicit copy, never object-rest destructuring (the page's Babel files share one
    // global helper list, so rest-destructuring outside app.jsx drops the wrong keys)
    const facts = { ...staged }; delete facts.origin; delete facts.expiresAt;
    return kind==="image" ? { mime:facts.mime, sizeBytes:facts.sizeBytes } : { ...facts };
  }
  const facts=_vidDataUrlFacts(url);
  if(/^blob:/i.test(String(url||""))){
    try{ const b=await (await fetch(url)).blob(); facts.sizeBytes=b.size; facts.mime=b.type||facts.mime; }catch(e){}
  }
  if(kind==="image") return facts;
  const el=document.createElement(kind==="video"?"video":"audio");
  el.preload="metadata"; el.muted=true;
  const duration=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(kind+" metadata probe timed out")),12000);
    el.onloadedmetadata=()=>{ clearTimeout(timer); Number.isFinite(el.duration)&&el.duration>0 ? resolve(el.duration) : reject(new Error(kind+" duration unavailable")); };
    el.onerror=()=>{ clearTimeout(timer); reject(new Error(kind+" metadata could not be loaded")); };
    el.src=url;
  }).catch(e=>{ throw new Error("Could not verify a reference "+kind+"'s duration before submitting: "+e.message+". Re-select or re-upload that asset so its metadata can be probed."); });
  el.removeAttribute("src"); try{ el.load(); }catch(e){}
  return { ...facts, durationSeconds:duration };
}
window.vidMediaFacts = vidMediaFacts;
async function vidReferenceMetadata(images,videos,audios){
  return {
    images:await Promise.all(images.map(u=>vidMediaFacts(u,"image"))),
    videos:await Promise.all(videos.map(u=>vidMediaFacts(u,"video"))),
    audios:await Promise.all(audios.map(u=>vidMediaFacts(u,"audio"))),
  };
}
function vidValidateSeedancePackage(model, payload){
  const cap=seedanceCapabilities(model), errors=[], refs=cap.references;
  const textOnlyEndpoint=/\/text-to-video$/.test(String(model||""));
  const lists={images:payload.images||[],videos:payload.videos||[],audios:payload.audios||[]};
  Object.keys(lists).forEach(k=>{ if(lists[k].length>refs[k].maxFiles) errors.push(k+" accepts at most "+refs[k].maxFiles+" files (received "+lists[k].length+")"); });
  const total=lists.images.length+lists.videos.length+lists.audios.length;
  if(total>refs.maxFilesTotal) errors.push("references accept at most "+refs.maxFilesTotal+" total files (received "+total+")");
  if(!(payload.duration==="auto")){
    const d=Number(payload.duration);
    if(!Number.isFinite(d)||d<cap.duration.min||d>cap.duration.max) errors.push("duration must be auto or "+cap.duration.min+"–"+cap.duration.max+" seconds");
  }
  if(!cap.resolutions.includes(payload.resolution)) errors.push("resolution must be "+cap.resolutions.join(", "));
  if(!cap.aspectRatios.includes(payload.aspectRatio)) errors.push("aspect ratio "+payload.aspectRatio+" is unsupported");
  if(!textOnlyEndpoint&&!cap.bitrateModes.includes(payload.bitrateMode)) errors.push("bitrate mode must be standard or high");
  const md=payload.metadata||{};
  ["videos","audios"].forEach(k=>{
    const rule=refs[k], facts=md[k]||[]; let secs=0, bytes=0;
    facts.forEach((f,i)=>{
      const d=Number(f.durationSeconds), b=Number(f.sizeBytes);
      if(!Number.isFinite(d)||d<=0) errors.push(k.slice(0,-1)+" "+(i+1)+" duration could not be verified");
      else { secs+=d; if(rule.minSecondsEach&&d<rule.minSecondsEach) errors.push(k.slice(0,-1)+" "+(i+1)+" must be at least "+rule.minSecondsEach+"s"); if(rule.maxSecondsEach&&d>rule.maxSecondsEach) errors.push(k.slice(0,-1)+" "+(i+1)+" must be at most "+rule.maxSecondsEach+"s"); }
      if(Number.isFinite(b)){ bytes+=b; if(rule.maxBytesEach&&b>rule.maxBytesEach) errors.push(k.slice(0,-1)+" "+(i+1)+" is too large"); }
    });
    if(lists[k].length&&rule.minSecondsCombined&&secs<rule.minSecondsCombined) errors.push(k+" must total at least "+rule.minSecondsCombined+"s");
    if(rule.maxSecondsCombined&&secs>rule.maxSecondsCombined) errors.push(k+" exceed "+rule.maxSecondsCombined+"s combined");
    if(rule.maxBytesCombined&&bytes>rule.maxBytesCombined) errors.push(k+" exceed the combined size limit");
  });
  (md.images||[]).forEach((f,i)=>{ if(refs.images.maxBytesEach&&Number(f.sizeBytes)>refs.images.maxBytesEach) errors.push("image "+(i+1)+" exceeds 30MB"); });
  const counts={image:lists.images.length,video:lists.videos.length,audio:lists.audios.length};
  let m, re=/@(Image|Video|Audio)(\d+)\b/gi;
  while((m=re.exec(String(payload.prompt||"")))){ const k=m[1].toLowerCase(); if(Number(m[2])<1||Number(m[2])>counts[k]) errors.push(m[0]+" has no matching reference"); }
  if(errors.length) throw new Error("Invalid Seedance reference package: "+errors.join("; ")+".");
}
/* Kling 3.0 Motion Control limits (mirrors the proxy's validateMotionControlRequest):
   ONE character image, ONE motion video of 3–30s — only 3–10s when the character
   follows the IMAGE (orientation "image"). Checked before anything is spent. */
function vidMotionControlLimits(orientation){
  return { minSeconds:3, maxSeconds: orientation==="image" ? 10 : 30, maxBytes:200*1024*1024 };
}
window.vidMotionControlLimits = vidMotionControlLimits;
function vidValidateMotionControlPackage(payload){
  const errors=[];
  const orientation=String(payload.characterOrientation||"");
  if(!["video","image"].includes(orientation)) errors.push("scene control must follow the video or the image");
  if(!(payload.images||[]).length) errors.push("a character image is required");
  if(!(payload.videos||[]).length) errors.push("a motion video is required");
  const lim=vidMotionControlLimits(orientation);
  const f=((payload.metadata||{}).videos||[])[0]||{};
  const d=Number(f.durationSeconds), b=Number(f.sizeBytes);
  if((payload.videos||[]).length){
    if(!Number.isFinite(d)||d<=0) errors.push("the motion video's duration could not be verified");
    else if(d<lim.minSeconds) errors.push("the motion video must be at least "+lim.minSeconds+"s");
    else if(d>lim.maxSeconds+0.05) errors.push("the motion video must be at most "+lim.maxSeconds+"s when the character follows the "+orientation);
    if(Number.isFinite(b)&&b>lim.maxBytes) errors.push("the motion video exceeds 200MB");
  }
  if(String(payload.prompt||"").length>2000) errors.push("the prompt exceeds 2000 characters");
  if(errors.length) throw new Error("Invalid motion-control package: "+errors.join("; ")+".");
}

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
/* how long an uncollected job stays on the list: at least 7 days (billing round 2). The server
   keeps a submitted job's credits held until it sees the job finish (settle) or fail (refund), so
   the app keeps asking for a week instead of dropping the job after a day; even then it polls it
   once more before letting go (vidRecoverPending). */
const VID_PENDING_KEEP_MS = 7*24*3600*1000;
window.VID_PENDING_KEEP_MS = VID_PENDING_KEEP_MS;
function _vidPendingList(){ try{ return JSON.parse(localStorage.getItem(VID_PENDING_KEY)||"[]")||[]; }catch(e){ return []; } }
function _vidPendingSave(list, strict, requestId){
  try{
    /* NEVER EVICTED (2026-10-09, owner — Stage review): the list used to keep only the newest 20,
       silently dropping older paid jobs (another film's included) that nothing would then collect */
    const serialized=JSON.stringify(list);
    localStorage.setItem(VID_PENDING_KEY, serialized);
    if(strict){
      const savedRaw=localStorage.getItem(VID_PENDING_KEY);
      if(savedRaw!==serialized) return false;
      const saved=JSON.parse(savedRaw||"[]");
      if(!Array.isArray(saved) || !saved.some(j=>j&&j.requestId===requestId)) return false;
    }
    return true;
  }catch(e){ return false; }
}
function _vidPendingAdd(job, strict){
  const l=_vidPendingList().filter(j=>j.requestId!==job.requestId); l.push(job);
  if(strict && l.length>VID_PENDING_LEDGER_LIMIT) return false;
  // a full list refuses to save (the caller warns the record wasn't kept) instead of dropping one
  if(!strict && l.length>VID_PENDING_SOFT_LIMIT) return false;
  return _vidPendingSave(l,!!strict,job.requestId);
}
/* A job whose recovery record this browser COULDN'T SAVE (pendingPersistenceWarning: storage full
   or unavailable) is kept here, in memory, once its live wait ends — so the patrol below still
   collects it while this page stays open (billing round 3). It can't survive a reload. */
const _vidPendingMem = new Map();   // requestId -> pending job
function _vidPendingAll(){
  const list=_vidPendingList();
  const ids=new Set(list.map(j=>j&&j.requestId));
  _vidPendingMem.forEach((j,id)=>{ if(!ids.has(id)) list.push(j); });
  return list;
}
function _vidPendingRemove(requestId){ _vidPendingMem.delete(requestId); _vidPendingSave(_vidPendingList().filter(j=>j.requestId!==requestId)); }
function _vidPendingRemoveByClip(id){
  if(id==null) return;
  _vidPendingMem.forEach((j,rid)=>{ if(j && j.id===id) _vidPendingMem.delete(rid); });
  _vidPendingSave(_vidPendingList().filter(j=>!j || j.id!==id));
}
/* Screenplay page PNGs are intentionally lossless, so one large source can
   exceed a browser's localStorage quota after it is JSON-encoded.  Only the
   new page-reference path is bounded; legacy callers retain their historical
   pending behavior.  The reserve set closes the small race where a batch of
   page renders all preflights against the same old pending list. */
/* One million JSON code units is deliberately below common per-origin
   localStorage limits, leaving headroom for the app's other local keys. */
const VID_PENDING_SCREENPLAY_BUDGET = 1000000;
const VID_PENDING_LEDGER_LIMIT = 20;
const VID_PENDING_SOFT_LIMIT = 80;   // every other render: far more than one browser runs at once
/* Provider status/result URLs are only known after submit; reserve this
   bounded allowance now, then validate the actual record before saving. */
const VID_PENDING_PROVIDER_OVERHEAD = 64*1024;
const VID_PENDING_RESERVATION_PREFIX = "turn_vid_pending_reservation:";
const VID_PENDING_RESERVATION_TTL = 15*60*1000;
const _vidPendingReservations = new Map();
const _vidStorageReservations = new Map();
let _vidPendingReserveReason="";
function _vidPendingSerialized(job, excludeReservationToken){
  const reservations=Array.from(_vidPendingReservations.entries())
    .filter(([token])=>token!==excludeReservationToken).map(([,value])=>value);
  const list=_vidPendingList().filter(Boolean).concat(reservations,job);
  /* Required-image records must never be admitted by silently evicting an
     older paid job. Legacy _vidPendingSave retains its historical slice. */
  if(list.length>VID_PENDING_LEDGER_LIMIT) return null;
  return JSON.stringify(list);
}
function _vidStorageReservationCleanup(){
  try{
    if(typeof localStorage.length!=="number" || typeof localStorage.key!=="function") return;
    const now=Date.now();
    for(let i=localStorage.length-1;i>=0;i--){
      const key=localStorage.key(i)||"";
      if(!key.startsWith(VID_PENDING_RESERVATION_PREFIX)) continue;
      const at=Number(key.slice(VID_PENDING_RESERVATION_PREFIX.length).split("-")[0]);
      if(Number.isFinite(at) && now-at>VID_PENDING_RESERVATION_TTL){
        try{ localStorage.removeItem(key); }catch(e){}
      }
    }
  }catch(e){}
}
function _vidStorageReservationChars(){
  let total=0;
  _vidStorageReservations.forEach(n=>{ total+=n; });
  try{
    if(typeof localStorage.length==="number" && typeof localStorage.key==="function"){
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i)||"";
        if(!key.startsWith(VID_PENDING_RESERVATION_PREFIX) || _vidStorageReservations.has(key)) continue;
        const value=localStorage.getItem(key);
        if(value==null) return Infinity;
        total+=key.length+value.length;
      }
    }
  }catch(e){ return Infinity; }
  return total;
}
function _vidStorageReservationReserve(job, token){
  _vidStorageReservationCleanup();
  try{
    const current=localStorage.getItem(VID_PENDING_KEY)||"[]";
    const candidate=_vidPendingSerialized(job);
    if(candidate==null) return false;
    const reserved=_vidStorageReservationChars();
    if(!Number.isFinite(reserved)) return false;
    const key=VID_PENDING_RESERVATION_PREFIX+token;
    /* The marker is zero padding plus a tiny header — never page bytes.  It
       occupies the additional serialized-job space while paid submission is
       attempted, so a successful setItem proves the later pending write fits. */
    const delta=Math.max(0,candidate.length+VID_PENDING_PROVIDER_OVERHEAD-current.length-reserved);
    const marker=JSON.stringify({ v:1, at:Date.now(), chars:delta, pad:"0".repeat(delta) });
    localStorage.setItem(key,marker);
    const verify=localStorage.getItem(key);
    if(verify==null || verify.length!==marker.length){
      try{ localStorage.removeItem(key); }catch(e){}
      return false;
    }
    _vidStorageReservations.set(key,key.length+marker.length);
    return true;
  }catch(e){ return false; }
}
function _vidStorageReservationRelease(token){
  if(!token) return true;
  const key=VID_PENDING_RESERVATION_PREFIX+token;
  let ok=true;
  try{ localStorage.removeItem(key); }catch(e){ ok=false; }
  _vidStorageReservations.delete(key);
  return ok;
}
function _vidPendingFits(job){
  try{
    const serialized=_vidPendingSerialized(job);
    return serialized!=null && serialized.length+VID_PENDING_PROVIDER_OVERHEAD<=VID_PENDING_SCREENPLAY_BUDGET;
  }catch(e){ return false; }
}
function _vidPendingReserve(job){
  _vidPendingReserveReason="";
  let serialized;
  try{ serialized=_vidPendingSerialized(job); }catch(e){ serialized=null; }
  if(serialized==null){ _vidPendingReserveReason="ledger"; return ""; }
  if(serialized.length+VID_PENDING_PROVIDER_OVERHEAD>VID_PENDING_SCREENPLAY_BUDGET){ _vidPendingReserveReason="size"; return ""; }
  const token=Date.now()+"-"+Math.random().toString(36).slice(2);
  const reservation={...job,requestId:token};
  if(!_vidStorageReservationReserve(reservation,token)){ _vidPendingReserveReason="storage"; return ""; }
  _vidPendingReservations.set(token,reservation);
  return token;
}
function _vidPendingRelease(token){
  if(!token) return true;
  const released=_vidStorageReservationRelease(token);
  _vidPendingReservations.delete(token);
  return released;
}
window.vidPendingList = _vidPendingList;   // read-only view (UI / tests)
/* Recovery is PROJECT-SCOPED: each pending entry carries the film it belongs to, and
   a pass only replays entries for the film that's open — jobs from other films wait
   for their film (committing them here would write takes into the wrong project).
   Every outcome is TOLD to the user: recovered, failed at the provider, expired, or
   still cooking (a slow patrol below keeps checking those). */
const _vidPollLease = new Set();   // requestIds actively polled by THIS tab's generate loop
/* VIDEO IS CHARGED ON THE SERVER (billing fixes, 2026-09-30). image-proxy HOLDS the
   render's credits before it submits the job (refusing when the balance can't cover it or
   the account is on hold), SETTLES the hold when the render completes and RELEASES it when
   the render fails — so the browser no longer spends anything for video. What stays here:
   the cost the user was shown rides the submit as quotedCredits (the server may refuse a
   job whose real price differs from the quote), and every settle point just asks the
   balance readout to refresh. */
function _vidBalanceChanged(reason){
  try{ window.dispatchEvent(new CustomEvent("turn-credits-changed",{ detail:{ reason:reason||"stage-video" } })); }catch(e){}
}
async function vidRecoverPending(opts){
  opts = opts||{};
  const recoveryScope = _vidScopeSnapshot(vidScope());
  const scopeKey = recoveryScope.projectId;
  /* ACCOUNT-SCOPED too (billing round 3): the list lives in this browser, and two accounts can
     share a browser and a film. A record another account launched (its uid set and different from
     the signed-in one) is skipped and KEPT for that account — the server wouldn't hand it to this
     one anyway (render_not_found), and dropping it would lose that account's take. */
  const list = _vidPendingAll().filter(j=> j && (j.projectId||null)===scopeKey
    && !(j.uid!=null && j.uid!==recoveryScope.uid));
  if(!list.length) return 0;
  let saved=0, savedLive=0, failed=0, expired=0, cooking=0, gone=0;
  for(const j of list){
    // a live generate loop OWNS its job — recovery touching it too would
    // double-commit the same finished render (duplicate writes + toasts)
    if(!j.requestId || _vidPollLease.has(j.requestId)) continue;
    _vidPollLease.add(j.requestId);   // recovery claims the job too — the load pass and the 5-min patrol can overlap
    try{
    /* A recovered job still belongs to the canon that launched it.  If that
       canon is now contradictory, leave the pending job untouched rather than
       polling/committing a result into an unresolved project. */
    /* (2026-10-09, owner — Stage review) a changed identity no longer leaves the job pending forever
       (it was skipped on every load while the server charged it): it is collected and kept, flagged */
    let identityChanged = false;
    try{
      vidAssertIdentity({
        identityCharacterIds:j.identityCharacterIds,
        identityContext:j.identityContext,
        identityCast:j.identityCast,
      }, "video-recovery");
    }catch(identityErr){ identityChanged = true; }
    /* An OLD record is still polled ONCE before it is dropped (billing round 2): the server then
       settles and returns a finished video, or refunds a failed one. Only a job still unfinished
       or unreachable after VID_PENDING_KEEP_MS leaves the list (the server reconciles its hold). */
    const tooOld = (Date.now()-(j.at||0)) > VID_PENDING_KEEP_MS;
    try{
      const st = await vidProxy("poll", { model:j.model, statusUrl:j.statusUrl, responseUrl:j.responseUrl });
      if(st.status==="COMPLETED" && st.videoUrl){
        _vidBalanceChanged("stage-video-recovered");   // the server settled the hold when it saw the completed job
        try{ vidAssertIdentity({ identityCharacterIds:j.identityCharacterIds, identityContext:j.identityContext, identityCast:j.identityCast }, "video-recovery-before-commit"); }
        catch(identityErr){ identityChanged = true; }
        // a recovered take joins the takes; it never replaces a current take you have since
        const commit = await vidCommit(j.id, st.videoUrl,
          { ...(j.meta||{}), seed:st.seed||null, recovered:true, ...(identityChanged ? { identityChanged:true } : {}) },
          recoveryScope, { newTake:true, recovered:true, asDraft:identityChanged });
        /* The provider job succeeded, but a film/user/epoch switch while its
           poll was awaiting must leave it for the correct film's recovery. */
        if(commit && commit.skipped){ cooking++; continue; }
        if(_vidPendingMem.has(j.requestId)) savedLive++;
        _vidPendingRemove(j.requestId); saved++;
      } else if(st.error || /^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(String(st.status||""))){
        _vidPendingRemove(j.requestId); failed++;
        _vidBalanceChanged("stage-video-released");
      } else if(tooOld){ _vidPendingRemove(j.requestId); expired++; }
      else cooking++;
      // still IN_QUEUE / IN_PROGRESS → the patrol below re-checks it
    }catch(e){
      /* TRANSIENT (a retry answer — result_pending: the job's credits stay held and it can still
         be collected —, an unreachable proxy, a lapsed sign-in, the video service briefly unable to
         report the status): the record STAYS for the next pass. A provider-relayed failure (the
         proxy throws its error text) is TERMINAL — drop the job and report it. */
      if(_vidPollTransient(e)){
        if(tooOld){ _vidPendingRemove(j.requestId); expired++; } else cooking++;
      } else if(_vidPollNotFound(e)){
        /* the server has no such render for this account (another account's, or one it no longer
           has): not a provider failure, and no hold of this account's changed — no balance refresh */
        _vidPendingRemove(j.requestId); gone++;
      } else {
        _vidPendingRemove(j.requestId); failed++;
        if(_vidPollTerminal(e)) _vidBalanceChanged("stage-video-released");
      }
    }
    }finally{ _vidPollLease.delete(j.requestId); }
  }
  const toast = (m,k)=>{ if(typeof window.appToast==="function") window.appToast(m,k); };
  if(saved && savedLive===saved) toast(saved===1 ? "A render that took longer than expected has finished — it's saved in its clip's takes." : (saved+" renders that took longer than expected have finished — saved as takes."),"success");
  else if(saved) toast(saved===1 ? "Recovered a finished render from an earlier session — it's saved in its clip's takes." : ("Recovered "+saved+" finished renders from an earlier session — saved as takes."),"success");
  if(gone) toast(gone===1 ? "A render from an earlier session isn’t available to this account any more (it may belong to another account), so it was taken off the pending list." : (gone+" renders from an earlier session aren’t available to this account any more (they may belong to another account), so they were taken off the pending list."),"info");
  if(failed) toast(failed===1 ? "A render from an earlier session failed at the provider — no take was produced, and no credits were charged for it." : (failed+" renders from an earlier session failed at the provider — no takes were produced, and no credits were charged for them."),"error");
  if(expired) toast(expired===1 ? "A render from over a week ago still couldn’t be collected, so it was taken off the pending list. It’s charged only if it finished." : (expired+" renders from over a week ago still couldn’t be collected, so they were taken off the pending list. Each is charged only if it finished."),"info");
  if(cooking && !opts.quiet) toast(cooking===1 ? "A render from an earlier session is still processing — it will be saved automatically when it finishes." : (cooking+" renders from an earlier session are still processing — they'll be saved automatically."),"info");
  return saved;
}
window.vidRecoverPending = vidRecoverPending;
// one recovery pass per load after the auth/proxy state settles, then a slow
// patrol while anything is still pending (quiet: no repeat "still processing")
setTimeout(()=>{ try{ if(videoProxyReady()) vidRecoverPending(); }catch(e){} }, 4000);
setInterval(()=>{ try{ if(videoProxyReady() && _vidPendingAll().length) vidRecoverPending({ quiet:true }); }catch(e){} }, 5*60*1000);

/* Provider policy classification is informational only. A policy/moderation refusal
   is terminal for this job: never alter its prompt or launch another paid render. */
const VID_LIKENESS_RE = /likeness|celebrit|public figure|famous|real (?:person|people|face)|portrait right|impersonat|face (?:match|verification|detect)|risk control|content (?:risk|policy|moderation)|moderation|sensitive content|prohibited content/i;
function vidPolicyError(value){
  const s = String(value && (value.providerDetail||value.message) || value || "");
  const code = String(value && (value.errorCode||value.code) || "");
  return !!(s||code) && !/cancelled/i.test(s+" "+code)
    && (VID_LIKENESS_RE.test(s) || /policy|moderation|safety|sensitive|risk|likeness/i.test(code));
}
function vidLikenessError(value){ return vidPolicyError(value); } // compatibility for Stage callers
function vidPolicyFailure(error, request){
  request=request||{};
  const detail=String(error && (error.providerDetail||error.message) || error || "The provider supplied no detail.");
  const out=new Error("The provider rejected this render under its content, safety, or likeness policy. No automatic retry was submitted. Provider detail: "+detail+" Review the submitted inputs and policy requirements, or contact the provider if you believe the decision was mistaken.");
  out.name="ProviderPolicyError";
  out.providerDetail=detail;
  out.providerStatus=error&&error.providerStatus;
  out.httpStatus=error&&error.httpStatus;
  // Keep the failed request mode and non-sensitive input counts with the error.
  // Stage needs this to avoid offering the same paid text-only retry again when
  // the provider has already rejected a request containing no media at all.
  out.requestMode=request.textOnly ? "text-only" : "reference";
  out.inputCounts={
    images:Math.max(0,Number(request.images)||0),
    videos:Math.max(0,Number(request.videos)||0),
    audio:Math.max(0,Number(request.audio)||0)
  };
  if(error&&error.errorCode!=null) out.errorCode=error.errorCode;
  if(error&&error.code!=null) out.code=error.code;
  out.cause=error;
  return out;
}
window.vidPolicyError = vidPolicyError;
window.vidLikenessError = vidLikenessError;

async function seedanceGenerate(id, opts){
  opts = opts||{};
  /* Snapshot before any preparation work.  A Stage render is allowed to use
     the source it started with, never a refetched/partially edited source. */
  const hasScreenplayReference = opts.screenplayReference!=null;
  const screenplayReference = hasScreenplayReference
    ? _vidScreenplayReferenceSnapshot(opts.screenplayReference) : null;
  const screenplayAppend = hasScreenplayReference
    ? window.stageAppendScreenplayReference : null;
  if(hasScreenplayReference && typeof screenplayAppend!=="function")
    throw new Error("Stage screenplay helper is unavailable. Reload Stage before rendering; render was not submitted.");
  const screenplayBlock = hasScreenplayReference
    ? String(screenplayAppend("",screenplayReference)||"") : "";
  if(hasScreenplayReference && (!screenplayBlock
      || screenplayBlock.indexOf(screenplayReference.fullText)<0
      || screenplayBlock.indexOf(screenplayReference.targetText)<0))
    throw new Error("Stage screenplay reference delivery helper returned no full scene source; render was not submitted.");
  if(opts.screenplayImagesRequired===true && !Array.isArray(opts.screenplayImages))
    throw new Error("This render requires the complete screenplay page image set; render was not submitted.");
  const appendScreenplay=(prompt)=>{
    if(!hasScreenplayReference) return String(prompt==null?"":prompt);
    const out=screenplayAppend(prompt,screenplayReference);
    if(typeof out!=="string" || out.indexOf(screenplayReference.fullText)<0
       || out.indexOf(screenplayReference.targetText)<0)
      throw new Error("Stage screenplay reference delivery dropped the full scene source; render was not submitted.");
    return out;
  };
  const assertScreenplayCurrent=(phase)=>{
    if(!hasScreenplayReference) return true;
    if(typeof opts.assertScreenplayCurrent!=="function")
      throw new Error("Stage screenplay freshness check is unavailable; render was not submitted.");
    const result=opts.assertScreenplayCurrent(phase||"video");
    if(result===false || (result && (result.ok===false || result.valid===false || result.blocked)))
      throw new Error(String(result.message||"The screenplay changed before the video render was submitted."));
    return result;
  };
  /* Fail stale/malformed source before touching cache, capability handshakes,
     media preparation, or the paid transport. */
  assertScreenplayCurrent("video-generate-start");
  vidAssertIdentity(opts, "video-generate-start");
  /* ownership + scope captured at START: Clear bumps the clip's run token; a film
     switch bumps the asset epoch. Both are re-checked after the LAST await before
     committing — a finished render must never resurrect a cleared clip or land in
     another film. */
  const runToken0 = (id!=null) ? vidRunToken(id) : null;
  const scope0 = vidScope();
  const epoch0 = (typeof window.nbEpoch==="function") ? window.nbEpoch() : 0;
  /* the QUOTE — the credit cost the Stage showed for this job. Display/audit only: the
     server computes, holds and settles the real charge itself (see _vidBalanceChanged).
     `spend` is the pre-2026-09-30 name for the same record and is read as a quote. */
  const quoteSrc = opts.quote || opts.spend || null;
  const quoteRec = (quoteSrc && Number(quoteSrc.cost)>0) ? {
    cost: Math.max(1, Math.ceil(Number(quoteSrc.cost)||1)),
    reason: String(quoteSrc.reason||"stage-video-render"),
  } : null;
  /* SEEDANCE 2.5 rides the same multimodal reference-to-video shape as 2.0, named by
     the tier's falModel: 30s duration ceiling and longer renders (the poll ceiling
     stretches below). Per-modality caps verified against fal's live schema 2026-08-07:
     2.5 takes ≤30 images, ≤10 videos, ≤10 audio (50 files total, budgeted upstream by
     the tier's assetLimit); 2.0 takes ≤9 images, ≤3 videos, ≤3 audio (12 total). */
  const isSeedance25 = /seedance-2\.5/.test(String(opts.falModel||""));
  const textOnly = !!opts.textOnly;
  // assemble the multimodal asset lists (single frameUrl/audioUrl kept for back-compat)
  const imageUrls = Array.isArray(opts.imageUrls) ? opts.imageUrls : [];
  const images = _vidDedup([opts.frameUrl, ...imageUrls]);
  const videos = _vidDedup(opts.videoUrls||[]);
  const audios = _vidDedup([opts.audioUrl, ...(opts.audioUrls||[])]);
  const screenplayImages = _vidScreenplayImagesSnapshot(
    opts.screenplayImages, screenplayReference, imageUrls, opts.frameUrl,
    opts.screenplayImagesRequired===true
  );
  const hasScreenplayImages = !!screenplayImages;
  if(opts.screenplayImagesRequired===true && !hasScreenplayImages)
    throw new Error("This render requires complete screenplay page images; render was not submitted.");
  if(hasScreenplayImages && textOnly)
    throw new Error("A text-only video request cannot include screenplay page images.");
  if(textOnly && (images.length || videos.length || audios.length))
    throw new Error("A text-only video request cannot include image, video, or audio references.");
  if(!textOnly && !images.length && !videos.length){
    // task modes and motion control are video-first — name the missing video, not a frame
    const vt=(opts.videoTask && String(opts.videoTask)!=="reference") ? String(opts.videoTask) : "";
    if(vt==="editing") throw new Error("Add the video to edit first — it becomes @Video1.");
    if(vt==="extension") throw new Error("Choose the video to extend first — it becomes @Video1.");
    if(/motion-control$/.test(String(opts.falModel||""))) throw new Error("Motion Control needs a motion video to copy and a character image.");
    throw new Error("This clip has no start frame yet — generate the shot's frame in the Shot List first.");
  }
  /* SORA 2 rides the same queue but a different shape: the tier names its fal endpoint
     (opts.falModel), takes ONE start image, and has no video/audio refs, no end-frame
     transition, no seed. The proxy maps the payload to Sora's field names + snaps the
     duration to its 4/8/12/16/20s grid. */
  const isSora = /sora-2/.test(String(opts.falModel||""));
  /* KLING 3.0 rides the same queue: ONE start image (identity rides the frame — no
     reference sheets, no audio refs; speech is generated natively by the model),
     optional end frame, and NATIVE MULTI-SHOT — opts.multiShot [{prompt,duration}]
     maps to Kling's multi_prompt so each Multi-shot row renders on its own prompt. */
  /* KLING 3.0 MOTION CONTROL is its own shape: ONE character image + ONE motion video,
     character_orientation "video" | "image", optional prompt, keep_original_sound.
     No duration/resolution/aspect/seed controls — the output follows the motion video. */
  const isKlingMotion = /kling-video\/v3\/(standard|pro)\/motion-control$/.test(String(opts.falModel||""));
  const isKling = /kling-video/.test(String(opts.falModel||"")) && !isKlingMotion;
  const characterOrientation = isKlingMotion ? String(opts.characterOrientation||"") : "";
  const keepOriginalSound = isKlingMotion ? (opts.keepOriginalSound!==false) : null;
  if(isKlingMotion){
    if(!["video","image"].includes(characterOrientation)) throw new Error("Motion Control needs a scene control choice — follow the motion video or the character image.");
    if(images.length!==1) throw new Error("Motion Control needs exactly one character image (a clear face and body).");
    if(videos.length!==1) throw new Error("Motion Control needs exactly one motion video to copy.");
    if(audios.length) throw new Error("Motion Control takes no audio references — the motion video's own sound is kept or dropped with 'Keep original sound'.");
    // the prompt is optional flavour text; screenplay delivery would be recorded as
    // provenance the provider never saw
    if(hasScreenplayReference || opts.screenplayImages) throw new Error("Motion Control copies a performance and takes no screenplay reference.");
  }
  /* SEEDANCE 2.5 TASK MODES — "editing" rewrites @Video1 (fal coerces duration and
     aspect to the source's), "extension" continues @Video1 (aspect follows the source).
     Both need a video reference and the 2.5 reference endpoint; both are gated on
     the deployed proxy advertising them (an older proxy would silently render a
     plain reference job — and charge for it). */
  const videoTask = (opts.videoTask && String(opts.videoTask)!=="reference") ? String(opts.videoTask) : "";
  if(videoTask){
    if(!VID_TASKS.includes(videoTask)) throw new Error("Unknown video task \""+videoTask+"\".");
    if(!isSeedance25 || textOnly || isSora || isKling || isKlingMotion) throw new Error((videoTask==="editing"?"Edit Video":"Extend Video")+" runs on Seedance 2.5 only — pick Seedance 2.5 as the model.");
    if(!videos.length) throw new Error((videoTask==="editing"?"Add the video to edit":"Choose the video to extend")+" first — it becomes @Video1.");
    if(opts.endImageUrl) throw new Error((videoTask==="editing"?"Edit Video":"Extend Video")+" cannot combine with an end frame.");
  }
  // a start->end frame transition only makes sense with exactly a start image and no
  // video/audio refs — those require the multimodal reference-to-video shape instead.
  // (Kling takes end_image_url natively on its one endpoint — no endpoint switch.)
  const endFrame = (isSora || isKlingMotion) ? "" : (opts.endImageUrl||"").trim();
  if(hasScreenplayImages && (isSora || isKling || isKlingMotion))
    throw new Error("This video model accepts only one start image and cannot consume screenplay page images separately; choose a Seedance reference-to-video route.");
  if(hasScreenplayImages && endFrame)
    throw new Error("Start-to-end image transitions cannot consume screenplay page images separately; choose a Seedance reference-to-video route.");
  const useTransition = !isKling && !isKlingMotion && !!(endFrame && images.length && !videos.length && !audios.length);
  const model = (isSora || isKling || isKlingMotion) ? opts.falModel
    : textOnly
    ? (isSeedance25 ? VID25_MODEL_T2V : (opts.fast ? VID_MODEL_T2V_FAST : VID_MODEL_T2V))
    : isSeedance25
    ? (useTransition ? (opts.fast ? VID25_MODEL_I2V_FAST : VID25_MODEL_I2V) : opts.falModel)
    : useTransition
    ? (opts.fast ? VID_MODEL_I2V_FAST : VID_MODEL_I2V)
    : (opts.fast ? VID_MODEL_FAST : VID_MODEL);
  // Never silently clamp Seedance: reject an unsupported requested duration before spending.
  // Preserve the established snapping/clamping behavior of the unrelated Sora/Kling paths.
  // Editing follows the source video's length and format; extension follows its format.
  // Motion control follows the motion video. Those requests carry no duration/aspect.
  const duration = (isKlingMotion || videoTask==="editing") ? "auto"
    : opts.durationMs
    ? (isKling ? Math.max(3,Math.min(15,Math.round(opts.durationMs/1000)))
      : isSora ? Math.max(4,Math.min(20,Math.round(opts.durationMs/1000)))
      : Math.ceil(opts.durationMs/1000))
    : (opts.duration||"auto");
  const resolution = vidResolutionForModel(model, opts.resolution);
  const aspectRatio = (isKlingMotion || videoTask) ? "auto" : (opts.aspectRatio || "auto");
  const controls = (opts.controls||"").trim();
  const onlyDocumentImages = hasScreenplayImages && images.length===screenplayImages.length
    && !videos.length && !audios.length
    && images.every(url=>screenplayImages.some(page=>page.url===url));
  const suppliedPrompt = (opts.prompt||"").trim();
  const nonDocumentImages = hasScreenplayImages
    ? images.filter(url=>!screenplayImages.some(page=>page.url===url)) : images;
  const firstVisualToken = nonDocumentImages.length
    ? "@Image"+(images.indexOf(nonDocumentImages[0])+1)
    : videos.length ? "@Video1" : "";
  if(onlyDocumentImages && !suppliedPrompt)
    throw new Error("A render with only screenplay page images needs an explicit video direction; page images are reading context, not a start frame.");
  if(hasScreenplayImages && !suppliedPrompt && !firstVisualToken)
    throw new Error("Screenplay page images provide reading context only; an explicit video direction or actual visual reference is required.");
  const basePrompt = suppliedPrompt || (audios.length
    ? firstVisualToken+" comes alive — the character speaks the line in @Audio1 with natural, accurate lip-sync. Subtle, grounded motion; hold the framing and the lighting."
    : firstVisualToken+" comes alive with subtle, natural motion; hold the framing and the lighting.");
  const identityCast = opts.identityCast || [];
  const identityPrompt = (identityCast.length && typeof window.turnIdentityPrompt==="function")
    ? String(window.turnIdentityPrompt(identityCast)||"").trim() : "";
  const promptWithIdentity = identityPrompt && basePrompt.indexOf(identityPrompt)<0
    ? basePrompt+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identityPrompt : basePrompt;
  const pageGuard = hasScreenplayImages ? _vidScreenplayImageGuard(screenplayImages,images) : "";
  const promptWithPageGuard = pageGuard
    ? promptWithIdentity+"\n\n"+pageGuard : promptWithIdentity;
  // Motion control's prompt is optional guidance only (no @-tokens, no fallback
  // "comes alive" direction, no controls/identity block — the motion video drives).
  const promptText = isKlingMotion ? suppliedPrompt : appendScreenplay(controls
    ? (promptWithPageGuard + "\n" + controls) : promptWithPageGuard);
  /* Native Kling multi-shot rows override the top-level prompt.  Every row
     therefore receives the same exact screenplay block, rather than relying
     on the top-level prompt. */
  const klingShots = (isKling && Array.isArray(opts.multiShot))
    ? opts.multiShot.map(s=>({ prompt:String(s&&s.prompt||"").trim(), duration:Math.max(1,Math.round(Number(s&&s.duration)||3)) }))
      .filter(s=>s.prompt)
      .map(s=>({ ...s, prompt:appendScreenplay(s.prompt) }))
    : [];
  if(isKling && klingShots.some(s=>s.prompt.length>2000))
    throw new Error("Kling native multi-shot screenplay prompt exceeds the provider's 2000-character row limit; shorten the beat prompt or split the beat. The source was not truncated and no render was submitted.");
  /* generate_audio controls the WHOLE output audio track (SFX, ambience AND the
     lip-synced speech built from audio references) — sending false with audio refs
     yields a silent video, so it stays ON whenever line audio rides along. */
  const generateAudio = opts.generateAudio!=null ? !!opts.generateAudio : true;
  // fal's Seedance text-to-video schema has no bitrate_mode field. Keep the
  // reference/image endpoint control, but omit it from an explicit text-only job.
  const bitrateMode = textOnly ? null : (opts.bitrateMode==="high" ? "high" : "standard");
  if(isSeedance25 && resolution==="1080p"){
    const runtime=await seedanceGetRuntimeCapabilities(model);
    vidAssertIdentity(opts, "video-after-capabilities");
    if(!runtime.known || !runtime.capabilities || !runtime.capabilities.resolutions.includes("1080p"))
      throw new Error("1080p on this model isn't available yet — it's waiting on a server update. 720p is available.");
  }
  /* Non-spending capability handshakes for the newer shapes: an older deployed proxy
     ignores unknown fields, so without the handshake an "editing" job would render
     (and bill) as a plain reference job, and a motion-control model would be
     rejected only after staging. Fail closed before any preparation work. */
  if(videoTask){
    const runtime=await seedanceGetRuntimeCapabilities(model);
    vidAssertIdentity(opts, "video-after-capabilities");
    const tasks=runtime.known && runtime.capabilities && Array.isArray(runtime.capabilities.tasks) ? runtime.capabilities.tasks : [];
    if(!tasks.includes(videoTask))
      throw new Error((videoTask==="editing"?"Edit Video":"Extend Video")+" isn't available yet — it's waiting on a server update. Nothing was submitted.");
  }
  if(isKlingMotion){
    const runtime=await seedanceGetRuntimeCapabilities(model);
    vidAssertIdentity(opts, "video-after-capabilities");
    const orientations=runtime.known && runtime.capabilities && Array.isArray(runtime.capabilities.characterOrientations) ? runtime.capabilities.characterOrientations : [];
    if(!orientations.includes(characterOrientation))
      throw new Error("Motion Control isn't available yet — it's waiting on a server update. Nothing was submitted.");
  }
  const settings = { model, resolution, aspectRatio, duration, endFrame, generateAudio, bitrateMode, seed:opts.seed!=null?opts.seed:null,
    ...(videoTask ? { videoTask } : {}),
    ...(isKlingMotion ? { characterOrientation, keepOriginalSound } : {}) };
  if(screenplayReference) settings.screenplayReference = {
    signature:screenplayReference.signature, sourceRev:screenplayReference.sourceRev,
    fullText:screenplayReference.fullText, targetBeats:screenplayReference.targetBeats,
    targetText:screenplayReference.targetText
  };
  /* Page bytes already participate in the asset hash.  Hash only the compact
     page identity here; full URLs belong once in take/pending provenance. */
  if(hasScreenplayImages) settings.screenplayImages = screenplayImages.map(page=>({
    id:page.id, page:page.page, totalPages:page.totalPages,
    sourceSignature:page.sourceSignature, targetBeats:page.targetBeats,
  }));
  if(screenplayReference && isKling && klingShots.length) settings.klingMultiPrompt=klingShots;
  const hash = vidHash([...images, ...videos, ...audios], promptText, settings);
  // skip-if-unchanged
  if(id && !opts.force){
    const url = vidGetVideo(id) || await vidLoadVideo(id);
    const meta = vidGetMeta(id);
    assertScreenplayCurrent("video-before-cache-return");
    if(url && meta && meta.hash===hash) return { videoUrl:url, seed:(meta&&meta.seed)||null, cached:true };
  }
  const proxyImages = await vidProxyReadyUrls((isSora||isKling||isKlingMotion) ? images.slice(0,1) : images);   // Sora/Kling: the start frame only
  vidAssertIdentity(opts, "video-after-image-prep");
  const screenplayImageSnapshots = hasScreenplayImages
    ? _vidFreeze(_vidClone(screenplayImages.map(page=>{
        const imageIndex=images.indexOf(page.url);
        const proxyInputUrl=imageIndex>=0 ? (proxyImages[imageIndex]||"") : "";
        if(imageIndex<0 || !proxyInputUrl)
          throw new Error("A screenplay page image couldn't be attached to the render, so it was not submitted.");
        /* screenplayImages already stores the exact source URL.  Avoid storing
           that same potentially multi-megabyte data URL a second time when
           staging did not transform it; a differing proxyInputUrl (blob→data,
           refreshed signed URL, etc.) remains exact and is retained. This is
           the browser-to-proxy input, not a final provider URL. */
        const snapshot={ id:page.id, label:page.label, page:page.page,
          totalPages:page.totalPages, sourceSignature:page.sourceSignature,
          targetBeats:page.targetBeats.slice(), imageIndex:imageIndex+1 };
        if(proxyInputUrl!==page.url) snapshot.proxyInputUrl=proxyInputUrl;
        return snapshot;
      })))
    : null;
  const persistedTakeMeta = hasScreenplayImages
    ? _vidCompactScreenplayTakeMeta(opts.takeMeta,screenplayImages)
    : (opts.takeMeta||{});
  /* Provenance is source-descriptor exactness plus the 1-based image slot and,
     only when staging changed bytes, the exact browser→proxy input.  The
     transport/proxy may replace that input, so no final provider URL is
     fabricated or recorded here. */
  const proxyVideos = (isSora||isKling) ? [] : await vidProxyReadyUrls(videos);
  vidAssertIdentity(opts, "video-after-video-prep");
  const proxyAudios = [];
  if(!isSora && !isKling) for(const u of await vidProxyReadyUrls(audios)) proxyAudios.push(await vidPadShortAudio(u));
  vidAssertIdentity(opts, "video-after-audio-prep");
  const proxyEndFrame = (useTransition || (isKling && endFrame)) ? await vidProxyReadyUrl(endFrame) : "";
  vidAssertIdentity(opts, "video-after-reference-prep");
  let referenceMetadata = null;
  if(isKlingMotion){
    referenceMetadata = await vidReferenceMetadata(proxyImages,proxyVideos,[]);
    vidValidateMotionControlPackage({ images:proxyImages, videos:proxyVideos, metadata:referenceMetadata,
      characterOrientation, prompt:promptText });
  } else if(!isSora && !isKling){
    referenceMetadata = await vidReferenceMetadata(proxyImages,proxyVideos,proxyAudios);
    vidValidateSeedancePackage(model,{ images:proxyImages,videos:proxyVideos,audios:proxyAudios,
      metadata:referenceMetadata,duration,resolution,aspectRatio,bitrateMode,prompt:promptText });
  }
  /* This is the last preparation boundary.  In particular, do not perform a
     screenplay refetch here: the immutable snapshot is what gets submitted. */
  assertScreenplayCurrent("video-after-preparation");
  // Exactly one submit→poll pass with the user's final prompt.
  const attempt = async (pText)=>{
    const _tag = opts.statusTag || "";
    const emit = (s)=>{ if(opts.onStatus) opts.onStatus(_tag ? (_tag+" · "+s) : s); };
    vidAssertIdentity(opts, "video-before-submit");
    /* Keep this check immediately adjacent to submit.  There is intentionally
       no screenplay freshness check after the provider accepts the paid job:
       a later edit cannot invalidate settlement or trigger a second submit. */
    assertScreenplayCurrent("video-before-submit");
    if(opts.shouldCancel && opts.shouldCancel()) throw new Error("Render cancelled.");
    let pendingReservation="";
    if(hasScreenplayImages){
      const pendingCandidate = {
        requestId:"screenplay-preflight", id, model, statusUrl:"", responseUrl:"",
        at:Date.now(), projectId:(scope0&&scope0.projectId)||null, uid:(scope0&&scope0.uid)||null,
        identityCharacterIds:opts.identityCharacterIds||opts.characterIds||[],
        identityContext:opts.identityContext||null, identityCast:opts.identityCast||[],
        quote:quoteRec, meta:{
          hash, model, durationMs:opts.durationMs||0, aspectRatio, prompt:pText,
          ...persistedTakeMeta,
          ...(hasScreenplayReference ? {
            actualPrompt:pText, screenplayReference, screenplayReferenceProvenance:screenplayReference,
            screenplayReferenceBlock:screenplayBlock, screenplayReferenceSignature:screenplayReference.signature,
          } : {}),
          screenplayImages, screenplayImageSnapshots,
          screenplayImagesRequired:opts.screenplayImagesRequired===true, screenplayImageGuard:pageGuard,
        },
      };
      pendingReservation=_vidPendingReserve(pendingCandidate);
      if(!pendingReservation)
        throw new Error(_vidPendingReserveReason==="storage"
          ? "Browser pending-render storage is unavailable or full, so this screenplay-image render cannot be retained safely for crash recovery. Free local storage and try again; no render was submitted."
          : _vidPendingReserveReason==="ledger"
          ? "The browser already has 20 pending paid renders, so this required-image render was not submitted; finish or clear an existing pending render first."
          : "This screenplay image package is too large to retain safely for crash recovery; reduce the page images or render fewer pages. No render was submitted.");
    }
    let sub;
    try{
      sub = await vidProxy("submit", isKlingMotion
        ? { model, prompt:pText,
            image_url:proxyImages[0], video_url:proxyVideos[0],
            characterOrientation, keepOriginalSound,
            referenceMetadata,
            ...(quoteRec ? { quotedCredits:quoteRec.cost } : {}) }
        : {
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
        ...(videoTask ? { videoTask } : {}),   // Seedance 2.5 task mode (editing / extension); body.task stays the proxy op selector
        ...(referenceMetadata ? { referenceMetadata } : {}),
        generateAudio,    // ON with audio refs (they become the speech in the track); user-toggled otherwise
        bitrateMode,      // "high" = less compression / larger file; "standard" = smaller draft
        ...(opts.seed!=null && !isSora && !isKling ? { seed:opts.seed } : {}),   // Sora/Kling have no seed control
        ...(quoteRec ? { quotedCredits:quoteRec.cost } : {}),   // the price the user saw; the server charges its own
        // the takes this Generate starts, so the server's plan limit on batches applies (2026-10-09)
        batchSize:Math.max(1, Number(persistedTakeMeta&&persistedTakeMeta.batchCount)||1),
      });
    }catch(e){
      _vidPendingRelease(pendingReservation);
      /* the server couldn't tie the job to its credit hold, so it stopped the job and returned the
         credits (code hold_attach_failed): nothing is pending, nothing was charged — say so */
      if(String((e&&e.code)||"")==="hold_attach_failed"){
        _vidBalanceChanged("stage-video-released");
        const back=new Error("The render couldn’t be started right now. Its credits were returned — please try again.");
        back.code="hold_attach_failed"; back.creditsReturned=true;
        throw back;
      }
      throw e;
    }
    _vidBalanceChanged("stage-video-hold");   // the server held this job's credits at submit
    if(!sub.requestId || !sub.statusUrl || !sub.responseUrl){
      _vidPendingRelease(pendingReservation);
      throw new Error("The video service didn't accept the render. If credits were held they're returned — please try again.");
    }
    // persist the job until it DEFINITIVELY completes — a reload mid-poll would otherwise
    // orphan a paid render (recovery re-polls leftovers on the next load). Cancels and
    // timeouts keep the entry on purpose: the job may still finish server-side.
    let pendingPersistenceWarning=false;
    let pendingJob=null;
    const warnPendingPersistence=()=>{
      pendingPersistenceWarning=true;
      const warning="Render submitted, but browser storage could not retain crash-recovery metadata; live polling and settlement continue in this tab. Keep this tab open until it finishes.";
      try{ if(typeof window.appToast==="function") window.appToast(warning,"error"); }catch(e){}
      try{ emit("WARNING · crash-recovery metadata was not saved; live polling continues"); }catch(e){}
    };
    try{
      const pendingMeta = { hash, model, durationMs:opts.durationMs||0, aspectRatio, prompt:pText, ...persistedTakeMeta };
      if(hasScreenplayReference) Object.assign(pendingMeta, {
        prompt:pText, actualPrompt:pText,
        screenplayReference, screenplayReferenceProvenance:screenplayReference,
        screenplayReferenceBlock:screenplayBlock,
        screenplayReferenceSignature:screenplayReference.signature,
      });
      if(hasScreenplayImages) Object.assign(pendingMeta, {
        screenplayImages, screenplayImageSnapshots,
        screenplayImagesRequired:opts.screenplayImagesRequired===true, screenplayImageGuard:pageGuard,
      });
      pendingJob = { requestId:sub.requestId, id, model, statusUrl:sub.statusUrl, responseUrl:sub.responseUrl, at:Date.now(),
         projectId:(scope0&&scope0.projectId)||null, uid:(scope0&&scope0.uid)||null,   // recovery is project-scoped
         identityCharacterIds:opts.identityCharacterIds||opts.characterIds||[],
         identityContext:opts.identityContext||null, identityCast:opts.identityCast||[],
        quote:quoteRec,   // what the user was shown; the server holds and settles the real charge
         meta:pendingMeta };
      let pendingSaved=true;
      if(hasScreenplayImages){
        /* The marker reserved provider-field headroom, but validate the
           actual response URLs and the complete ledger before releasing it. */
        const actualSerialized=_vidPendingSerialized(pendingJob,pendingReservation);
        pendingSaved=actualSerialized!=null && actualSerialized.length<=VID_PENDING_SCREENPLAY_BUDGET;
      }
      const quotaReleased=_vidPendingRelease(pendingReservation); // free the reserved quota immediately before the real pending save
      if(hasScreenplayImages && !quotaReleased) pendingSaved=false;
      if(pendingSaved) pendingSaved=_vidPendingAdd(pendingJob,hasScreenplayImages);
      // any render whose record didn't save says so (billing round 3: not only screenplay-page ones),
      // so its timeout message never promises a recovery that can't happen
      if(!pendingSaved) warnPendingPersistence();
    }catch(pendingError){
      if(!hasScreenplayImages) throw pendingError;
      warnPendingPersistence();
    }finally{
      _vidPendingRelease(pendingReservation);
    }
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
    let pollMiss = 0;   // consecutive unreachable-proxy polls / status hiccups — the render itself is still cooking server-side
    let statusHiccup = false;   // the last misses were the video service failing to report the status
    /* THE WAIT ENDS but the job keeps going (billing round 2/3): its pending record stays, so the
       patrol collects it when it finishes — the message must not invite a second paid render. When
       the record couldn't be saved (pendingPersistenceWarning), nothing would collect it after this
       page closes: the job is kept in memory for the patrol while the page stays open, and the
       message says so. */
    const stillGoing = (lead)=>{
      let err;
      if(pendingPersistenceWarning){
        if(pendingJob && pendingJob.requestId) _vidPendingMem.set(pendingJob.requestId, { ...pendingJob, inMemory:true });
        err = new Error(lead+" This browser couldn’t save the record that recovers it later, so it can’t be recovered automatically: keep this film open until it lands. It’s checked every few minutes and saved to this clip’s takes when it finishes, so there’s no need to render it again. It’s charged only if it finishes.");
        err.notRecoverable = true;
      } else {
        err = new Error(lead+" It keeps going on the server and is saved to this clip’s takes automatically when it finishes (while this film is open, or the next time you open it), so there’s no need to render it again. It’s charged only if it finishes.");
      }
      err.stillPending = true;
      return err;
    };
    for(let i=0; i<maxPolls; i++){
      // AFTER SUBMIT a cancel only stops this browser waiting — the job keeps going on the server and
      // its record stays, so say so honestly (2026-10-05, owner — Stage review)
      if(opts.shouldCancel && opts.shouldCancel()){
        const e = new Error("Stopped waiting. The render was already sent, so it keeps going on the server: if it finishes it is still charged and appears in this clip\u2019s takes.");
        e.stillPending = true; e.cancelledAfterSubmit = true;
        throw e;
      }
      await new Promise(r=>setTimeout(r, pollMs));
      let st;
      try{ st = await vidProxy("poll", { model, statusUrl:sub.statusUrl, responseUrl:sub.responseUrl }); pollMiss = 0; statusHiccup = false;
        // an identity change mid-render no longer ends the wait (the job kept going and was charged):
        // the take is kept and flagged at commit ("video-before-commit")
        try{ vidAssertIdentity(opts, "video-after-poll"); }catch(_identityErr){} }
      catch(e){
        // "poll again" (result_pending / retry:true): the proxy answered, the job's credits stay
        // held and its video can still be collected — keep polling (within maxPolls), never fail
        if(_vidPollRetryable(e)){ pollMiss = 0; statusHiccup = false; emit("RECONNECTING"); continue; }
        // A provider-declared terminal result is not recoverable. vidProxy can
        // throw it before the status branch below when the response carries an
        // error body; remove only that definitive job record. Transport errors,
        // user cancellation and ambiguous lost responses deliberately remain.
        if(_vidPollTerminal(e)){
          _vidPendingRemove(sub.requestId);
          _vidBalanceChanged("stage-video-released");   // the server released the failed job's hold
          try{ if(e && !e.creditsReturned){ e.creditsReturned = true; if(e.message && !/No credits were charged/.test(e.message)) e.message += " No credits were charged for it."; } }catch(_e){}
          throw e;
        }
        // a network blip mid-poll, or the video service briefly failing to report the job's
        // status (429 / 5xx — what the patrol treats as temporary; billing round 3), must NOT kill
        // a render that's still running on the provider — tolerate a few consecutive misses (each
        // network miss already retried inside vidProxy). Terminal provider failures don't land
        // here: they arrive as a successful poll with st.error/st.status.
        const hiccup = _vidStatusHiccup(e);
        if((hiccup || /Couldn't reach the video (proxy|service)/i.test(String(e&&e.message))) && ++pollMiss<=4){
          statusHiccup = hiccup;
          emit("RECONNECTING");
          continue;
        }
        // still no status after the misses: the job is still running — say so, keep its record
        if(hiccup) throw stillGoing("The video service couldn’t report this render’s status just now.");
        throw e;
      }
      // a terminal failure the proxy relayed without an error field still ends here —
      // throw so the provider's terminal detail surfaces instead of timing out
      if(/^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(String(st.status||""))){
        _vidPendingRemove(sub.requestId);
        _vidBalanceChanged("stage-video-released");   // the server released the failed job's hold
        const fe = new Error(String(st.error||("The provider reported the render as "+st.status+"."))+" No credits were charged for it.");
        fe.creditsReturned = true;
        throw fe;
      }
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
        /* the provider rendered — the server settled the job's hold when this poll saw it
           complete (a cleared clip's render was still rendered, and still charged). */
        _vidBalanceChanged("stage-video-render");
        const meta = { hash, model, durationMs:opts.durationMs||0, aspectRatio, seed:st.seed||null,
          prompt:pText, ...persistedTakeMeta,   // Versions-view facts: source, tier, resolution, recipe, audio, batch position…
          // provider-request facts the caller cannot restate differently
          ...(videoTask ? { videoTask } : {}),
          ...(isKlingMotion ? { characterOrientation, keepOriginalSound } : {}) };
        if(hasScreenplayReference) Object.assign(meta, {
          prompt:pText, actualPrompt:pText,
          screenplayReference, screenplayReferenceProvenance:screenplayReference,
          screenplayReferenceBlock:screenplayBlock,
          screenplayReferenceSignature:screenplayReference.signature,
        });
        if(hasScreenplayImages) Object.assign(meta, {
          screenplayImages, screenplayImageSnapshots,
          screenplayImagesRequired:opts.screenplayImagesRequired===true, screenplayImageGuard:pageGuard,
        });
        /* IDENTITY CHANGED WHILE IT RENDERED (2026-10-09, owner — Stage review): the paid take used to be
           thrown away. It is kept, flagged, beside the current take (never replacing it) — you decide. */
        let identityChanged = false;
        try{ vidAssertIdentity(opts, "video-before-commit"); }
        catch(identityErr){ identityChanged = true; meta.identityChanged = true; }
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
        let keptCurrent = false;
        if(id){
          const cr = await vidCommit(id, st.videoUrl, meta, scope0, { newTake:true, asDraft:identityChanged });
          // scope changed while the commit WAITED IN THE QUEUE — job stays
          // pending; project-scoped recovery delivers it to the right film
          if(cr && cr.skipped) return { videoUrl:st.videoUrl, seed:st.seed||null, cached:false, stale:true };
          keptCurrent = !!(cr && cr.keptCurrent);
        }
        _vidPendingRemove(sub.requestId);   // delivered — nothing left to recover
        if(identityChanged && typeof window.appToast==="function")
          window.appToast("A character\u2019s identity changed while this video rendered. The take is saved and marked \u201cIdentity changed\u201d \u2014 check it in Takes before you use it.","info");
        return { videoUrl:st.videoUrl, seed:st.seed||null, cached:false,
          ...(keptCurrent ? { keptCurrent:true } : {}), ...(identityChanged ? { identityChanged:true } : {}),
          ...(pendingPersistenceWarning ? { pendingPersistenceWarning:true } : {}) };
      }
    }
    /* the job keeps its pending record: the patrol collects it when it finishes, so the
       message must not invite a second paid render (billing round 2) */
    throw stillGoing(statusHiccup ? "The video service couldn’t report this render’s status just now." : "This render is taking longer than expected.");
    }finally{ _vidPollLease.delete(sub.requestId); }   // cancel/timeout/failure: the job is up for recovery again
  };
  try{ return await attempt(promptText); }
  catch(e){
    if(vidPolicyError(e)) throw vidPolicyFailure(e,{
      textOnly,
      images:images.length,
      videos:videos.length,
      audio:audios.length
    });
    throw e;
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
        // Preserve structured provider evidence (request mode, exact provider
        // detail and input counts) instead of flattening it to a string.
        _vidJobPatch(jid, { err:e||new Error("Video render failed.") });
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
          const reason=bad[0]&&bad[0].reason;
          const m = String((reason&&reason.message)||"Video render failed.");
          _vidJobPatch(jid, { err:reason||new Error(m) });
          throw (reason||new Error(m));
        }
        // a take still running on the server is not a failed one (2026-10-09, owner — Stage review)
        const running = bad.filter(b=>b.reason && b.reason.stillPending);
        const failedTakes = bad.filter(b=>!(b.reason && b.reason.stillPending));
        if(bad.length){
          const parts = [];
          if(failedTakes.length) parts.push(failedTakes.length+" of "+n+" takes failed and weren't charged: "+String((failedTakes[0].reason&&failedTakes[0].reason.message)||"render error"));
          if(running.length) parts.push(running.length+" of "+n+" takes are still rendering on the server \u2014 they're saved to this clip's takes when they finish.");
          const be = new Error(parts.join(" "));
          if(!failedTakes.length) be.stillPending = true;
          _vidJobPatch(jid, { err:be });
        }
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

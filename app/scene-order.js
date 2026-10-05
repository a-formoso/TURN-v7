/* One screenplay-order rule for every room and generation context.
   Scene numbers may arrive as numbers, numeric strings, or production-style
   alphanumerics (12A). Numbered scenes sort naturally; equal and unnumbered
   entries keep their input order because modern Array#sort is stable. */
function compareSceneOrder(a, b){
  const av = a && a.no != null ? String(a.no).trim() : "";
  const bv = b && b.no != null ? String(b.no).trim() : "";
  if(!av && !bv) return 0;
  if(!av) return 1;
  if(!bv) return -1;
  return av.localeCompare(bv, undefined, { numeric:true, sensitivity:"base" });
}

function scenesInStoryOrder(scenes){
  return (Array.isArray(scenes) ? scenes : []).slice().sort(compareSceneOrder);
}

/* Small deterministic hashes used as source-revision stamps. They are deliberately
   content-derived: old documents need no migration transaction, and undoing content
   returns to the same revision instead of manufacturing a new lineage. */
function storyRevisionOf(value){
  const s = JSON.stringify(value==null ? null : value);
  let h=2166136261;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return (h>>>0).toString(36);
}
function screenplayBeatRevision(draft, beatN){
  const blocks = ((draft&&draft.blocks)||[]).filter(b=>Number(b&&b.beat)===Number(beatN))
    .map(b=>({type:b.type||"",text:String(b.text||"")}));
  return storyRevisionOf(blocks);
}
const SHOT_SPEC_FIELDS = ["beatN","size","angle","move","lens","composition","subjects","props",
  "action","dialogue","purpose","covers","beatPlan","locationId","locationSide","priority",
  "referenceLocationsSet","referenceLocationIds","referenceCharactersSet","referenceCharacterIds",
  "negativePrompt","directives","camera","cameraHeight","cameraRoll","focus","aperture","shutter",
  "focalDistance","movementSpeed",
  // (2026-10-05, owner — Shots review) an Action written by hand replaces the screenplay's opening in
  // the frame prompt; a shot without the flag hashes as before
  "actionByHand"];
/* fields only the FRAME reads — a change re-renders the frame, never a Stage take (the video prompt
   doesn't read them). Takes stamped since 2026-10-05 carry a `videoHash` without them. */
const SHOT_FRAME_ONLY_FIELDS = ["negativePrompt"];
function shotSpecFingerprint(shot){
  const spec={}; SHOT_SPEC_FIELDS.forEach(k=>{ if(shot&&shot[k]!==undefined) spec[k]=shot[k]; });
  // Advanced cinematography is stored as a nested object. Only explicit overrides
  // belong to source provenance: missing settings, {} and six "auto" values are
  // semantically identical, while a real override changes the generated prompt.
  const camera={};
  ["camera","lensType","focalLength","aperture","shutter","iso"].forEach(k=>{
    const v=shot&&shot.cameraSettings&&shot.cameraSettings[k];
    if(v && v!=="auto") camera[k]=v;
  });
  if(Object.keys(camera).length) spec.cameraSettings=camera;
  return storyRevisionOf(spec);
}
function shotSpecRevision(shot){ return Math.max(1,Math.round(Number(shot&&shot.specRev))||1); }
/* the part of a shot's spec the VIDEO reads (the frame-only fields left out) */
function shotVideoSpecFingerprint(shot){
  if(!shot) return shotSpecFingerprint(shot);
  const s={...shot}; SHOT_FRAME_ONLY_FIELDS.forEach(k=>{ delete s[k]; });
  return shotSpecFingerprint(s);
}
/* the reference sheets ticked OFF on a shot (sh.refOff), as stored on each frame since 2026-10-05 */
function shotRefOffSig(shot){
  return (Array.isArray(shot&&shot.refOff) ? shot.refOff.map(String).sort() : []).join("|");
}
function shotSourceStamp(shot,draft){
  return { shotId:shot&&shot.id||"", specRev:shotSpecRevision(shot),
    specHash:shotSpecFingerprint(shot), videoHash:shotVideoSpecFingerprint(shot),
    screenplayRev:screenplayBeatRevision(draft,shot&&shot.beatN) };
}
/* a FRAME's stamp: the whole spec (the frame reads every field) */
function _frameStampMatches(old,cur){
  return !!old && old.shotId===cur.shotId && Number(old.specRev)===cur.specRev
    && old.specHash===cur.specHash && old.screenplayRev===cur.screenplayRev;
}
/* a TAKE's stamp: what the video reads — a take stamped with `videoHash` ignores frame-only edits
   (and the revision counter they bump); an older take keeps the whole-spec check */
function _takeStampMatches(old,cur){
  if(!old) return false;
  if(old.videoHash) return old.shotId===cur.shotId && old.videoHash===cur.videoHash && old.screenplayRev===cur.screenplayRev;
  return _frameStampMatches(old,cur);
}
function shotAssetProvenanceStatus(shot,draft,meta){
  if(!meta || !meta.shotSource) return "unverified";
  const cur=shotSourceStamp(shot,draft), old=meta.shotSource;
  if(!_frameStampMatches(old,cur)) return "stale";
  // a reference sheet ticked on/off since the frame was made (frames from before this was recorded aren't judged)
  if(typeof meta.refOffSig==="string" && meta.refOffSig!==shotRefOffSig(shot)) return "stale";
  return "current";
}
function shotSourcesStatus(shots,drafts,meta){
  const saved=meta&&meta.shotSources;
  if(!Array.isArray(saved)||!saved.length) return "unverified";
  const current=(shots||[]).map(sh=>shotSourceStamp(sh,(drafts||{})[sh.sceneId]));
  if(saved.length!==current.length) return "stale";
  return current.every((cur,i)=>_takeStampMatches(saved[i]||{},cur)) ? "current" : "stale";
}
function shotSourcesSnapshot(shots,drafts){
  return (shots||[]).map(sh=>shotSourceStamp(sh,(drafts||{})[sh.sceneId]));
}
function shotSourcesOverrideCurrent(shots,drafts,meta){
  const saved=meta&&meta.sourceOverride;
  if(!Array.isArray(saved)||!saved.length) return false;
  const current=shotSourcesSnapshot(shots,drafts);
  if(saved.length!==current.length) return false;
  return current.every((cur,i)=>_takeStampMatches(saved[i]||{},cur));
}
function shotSourcesEditorialStatus(shots,drafts,meta){
  const base=shotSourcesStatus(shots,drafts,meta);
  return base==="current" ? "current"
    : shotSourcesOverrideCurrent(shots,drafts,meta) ? "override" : base;
}
function shotSourcesFromMeta(allShots,meta){
  const saved=(meta&&meta.shotSources)||[];
  const byId={}; (allShots||[]).forEach(sh=>{ if(sh&&sh.id) byId[sh.id]=sh; });
  return saved.map(s=>byId[s&&s.shotId]).filter(Boolean);
}
function shotSourceOverrideCurrent(shot,draft){
  const old=shot&&shot.sourceOverride, cur=shotSourceStamp(shot,draft);
  return !!(old && old.shotId===cur.shotId && Number(old.specRev)===cur.specRev
    && old.specHash===cur.specHash && old.screenplayRev===cur.screenplayRev);
}

/* ---- SEED LINEAGE (chain provenance) ----------------------------------------
   Every generated shot frame records WHICH frame seeded it (shot id + that frame's
   version/timestamp at render time). Staleness is then DERIVED, never flagged:
   shotChainStatus recomputes the current seed and compares — so regenerating,
   re-ordering, deleting, or anchor-toggling an upstream shot automatically makes
   every dependent downstream frame report "stale" with no bookkeeping pass. */
function shotSeedStamp(prevSh, prevMeta){
  if(!prevSh) return { seedShotId:"" };
  return { seedShotId: prevSh.id||"",
    seedVersion: (prevMeta && prevMeta.version!=null) ? Number(prevMeta.version) : null,
    seedIso: (prevMeta && prevMeta.iso) || "" };
}
function shotChainStatus(sh, sceneShots, getMeta){
  const meta = (typeof getMeta==="function") ? getMeta(sh && sh.id) : null;
  if(!meta) return "";                          // no frame / meta not loaded — nothing to judge
  const src = meta.seedSource;
  if(!src) return "unverified";                 // legacy frame predating lineage stamps — don't cry wolf
  if(src.fresh) return "current";               // deliberately rendered WITHOUT the chain seed — no upstream dependency
  const seedFn = (typeof window!=="undefined" && typeof window.seedShotOf==="function") ? window.seedShotOf : null;
  const prevFn = (typeof window!=="undefined" && typeof window.prevShotOf==="function") ? window.prevShotOf : null;
  const cur = seedFn ? seedFn(sh, sceneShots) : (prevFn ? prevFn(sh, sceneShots) : null);
  const curId = cur ? (cur.id||"") : "";
  if((src.seedShotId||"") !== curId) return "stale";   // seed re-ordered, deleted, or anchor changed
  if(!curId) return "current";                          // head then, head now
  const seedMeta = getMeta(curId);
  if(!seedMeta) return "unverified";            // seed's meta not loaded (cold cache) — never a false alarm
  if(src.seedVersion==null && !src.seedIso) return "unverified";
  const vOk = src.seedVersion==null || Number(seedMeta.version||0)===Number(src.seedVersion);
  const tOk = !src.seedIso || (seedMeta.iso||"")===src.seedIso;
  return (vOk && tOk) ? "current" : "stale";    // the seed frame was re-rendered after this one
}

function beatRowId(sceneId,row,index){
  if(row&&row.id) return row.id;
  const seed=[sceneId||"scene",index,String(row&&row.drive&&row.drive.a||""),
    String(row&&row.drive&&row.drive.d||""),String(row&&row.react&&row.react.d||"")];
  return "beat-"+String(sceneId||"scene")+"-"+storyRevisionOf(seed);
}
function withBeatIdentity(map,sceneId){
  if(!map || !Array.isArray(map.rows)) return map;
  const rows=map.rows.map((r,i)=>({...r,id:beatRowId(sceneId,r,i),n:i+1}));
  const legacyN=Math.max(0,Math.round(Number(map.turnAt))||0);
  const hasIdentity=Object.prototype.hasOwnProperty.call(map,"turnBeatId");
  const turnBeatId=hasIdentity ? (map.turnBeatId||"") : ((rows[legacyN-1]&&rows[legacyN-1].id)||"");
  const turnAt=turnBeatId ? Math.max(0,rows.findIndex(r=>r.id===turnBeatId)+1) : 0;
  return {...map,rows,turnBeatId:turnAt?turnBeatId:"",turnAt};
}
function withBeatMapIdentity(beatsMap){
  const out={}; Object.keys(beatsMap||{}).forEach(sceneId=>{ out[sceneId]=withBeatIdentity(beatsMap[sceneId],sceneId); });
  return out;
}

window.compareSceneOrder = compareSceneOrder;
window.scenesInStoryOrder = scenesInStoryOrder;
/* the scene's TURNING POINT as text: the beat marked as the turn (Beats tab → Mark
   turn), else the legacy stored field (only the bundled sample ever filled it) */
function sceneTurnText(scene, beatsMap){
  if(!scene) return "";
  const map = beatsMap || ((typeof window!=="undefined" && window.turnContinuity && window.turnContinuity.beatsMap) || {});
  const b = map[scene.id], rows = (b && b.rows) || [];
  const r = rows.find(x=>x && b.turnBeatId && x.id===b.turnBeatId) || (b && b.turnAt ? rows[b.turnAt-1] : null);
  if(r){
    const t = [r.drive && (r.drive.d || r.drive.a), r.react && (r.react.d || r.react.a)]
      .filter(Boolean).map(x=>String(x).trim().replace(/\.$/,"")).join(" \u2014 ");
    if(t) return t+".";
  }
  return String(scene.turningPoint || "");
}
window.sceneTurnText = sceneTurnText;
window.storyRevisionOf = storyRevisionOf;
window.screenplayBeatRevision = screenplayBeatRevision;
window.shotSpecFingerprint = shotSpecFingerprint;
window.shotSpecRevision = shotSpecRevision;
window.shotSourceStamp = shotSourceStamp;
window.shotVideoSpecFingerprint = shotVideoSpecFingerprint;
window.shotRefOffSig = shotRefOffSig;
window.shotAssetProvenanceStatus = shotAssetProvenanceStatus;
window.shotSourcesStatus = shotSourcesStatus;
window.shotSourcesSnapshot = shotSourcesSnapshot;
window.shotSourcesOverrideCurrent = shotSourcesOverrideCurrent;
window.shotSourcesEditorialStatus = shotSourcesEditorialStatus;
window.shotSourcesFromMeta = shotSourcesFromMeta;
window.shotSourceOverrideCurrent = shotSourceOverrideCurrent;
window.shotSeedStamp = shotSeedStamp;
window.shotChainStatus = shotChainStatus;
window.beatRowId = beatRowId;
window.withBeatIdentity = withBeatIdentity;
window.withBeatMapIdentity = withBeatMapIdentity;

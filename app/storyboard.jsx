/* storyboard.jsx — The Art Room ▸ Storyboards: the PRESENTATION LAYER of the shot chain
   (user ruling 2026-08-01 — storyboards are a VIEW over work already paid for, not a
   second generation pipeline; the sheet-painting path and the Storyboard Director agent
   were removed). Each sheet is COMPOSED on a canvas from the shots' existing frames —
   instant, free, with REAL annotation text (always legible, always correct — the thing
   image models can't do) — and re-derives itself: a scene whose frames exist composes
   on first view, and a composed sheet re-composes whenever one of its shot frames
   re-renders in the Shots tab. Sheets paginate on BEAT BOUNDARIES (a beat never splits
   across sheets unless it overflows a page on its own) and honor the project's format
   aspect. Presentation furniture: one-scene pager, per-panel beat & shot briefs with
   jump-to-Shot-List links, saved top/bottom halves (the Stage's video-gen hand-off),
   per-panel repair (edits the shot frame, then recomposes), upload of a board made
   elsewhere, and a durable print/PDF export. */

const _sbEl = React.createElement;

/* the grid shape a page paints to. Sheets are fixed 2×2 (page.grid is always "2x2"):
   four cells keep every panel in the strongest frame geometry, and the saved top/bottom
   HALVES the Stage consumes are the sheet's two panel rows — a 2-column layout is what
   makes that mapping well-defined. */
function sbGridShape(N, grid){
  // every sheet is a 2×2 page (the other layouts were never used — removed 2026-10-05)
  return { cols:2, rows:2 };
}
/* the composed sheet's pixel layout for a format aspect — ONE place, shared by the canvas compose and the
   upload shape check (2026-10-09: an upload gets halves only when it is shaped like this sheet) */
function sbSheetLayout(asp, N, grid){
  const ap = String(asp||"16:9").split(":").map(Number);
  const vert = ap[1] > ap[0];
  const PAD=8, GAP=8, CELL_W=vert?400:632, IMG_H=Math.round(CELL_W*ap[1]/ap[0]), STRIP_H=148, CELL_H=IMG_H+STRIP_H;
  const { cols, rows } = sbGridShape(N, grid);
  return { PAD, GAP, CELL_W, IMG_H, STRIP_H, CELL_H, cols, rows,
    W: PAD*2 + cols*CELL_W + (cols-1)*GAP, H: PAD*2 + rows*CELL_H + (rows-1)*GAP };
}
/* UPLOADS AND HALVES (2026-10-09, owner decision): the halves are the sheet's two panel rows, so an uploaded
   board gets them only when it is shaped like a composed 2×2 sheet (width/height within 10%); otherwise no
   halves are saved. null = the size isn't known. */
const SB_UPLOAD_SHAPE_TOLERANCE = 0.10;
function sbUploadShapeOk(w, h, asp){
  w = Number(w); h = Number(h);
  if(!(w>0) || !(h>0)) return null;
  const L = sbSheetLayout(asp);
  return Math.abs((w/h)/(L.W/L.H) - 1) <= SB_UPLOAD_SHAPE_TOLERANCE;
}
const SB_UPLOAD_SHAPE_MSG = "Halves aren\u2019t made from this upload \u2014 its shape isn\u2019t a 2\u00d72 sheet.";
window.sbSheetLayout = sbSheetLayout;
window.sbUploadShapeOk = sbUploadShapeOk;

/* the scene's beat/subtext map (driver/reactor/desire/antagonism + per-beat rows) */
function sbBeatMeta(beatsMap, sceneId){ return (beatsMap||{})[sceneId] || {}; }
/* the beat row that a shot came from (one beat = one shot) */
function sbBeatRow(beatsMap, sh){
  const bm = (beatsMap||{})[sh.sceneId]; if(!bm) return null;
  return (bm.rows||[]).find(r=> String(r.n)===String(sh.beatN)) || null;
}

const SB_CONF_LABELS = ["Inner","Personal","Extra-personal"];
function StoryboardSceneStyleChip({ project, sceneId }){
  const preset = (typeof scenePreset==="function") ? scenePreset(project, sceneId) : null;
  if(!preset) return _sbEl("span",{className:"shot-style-chip empty",
    title:"No colour look assigned to this scene yet. Use the Color tab to set one."},
    _sbEl(Icon.layers,{s:12}),"No style preset");
  const pal = (preset.palette||[]).slice(0,3);
  const title = [preset.name||"Scene style",preset.grade,
    preset.lighting?("Lighting: "+preset.lighting):"",
    preset.lens?("Lens: "+preset.lens):"",
    preset.texture?("Texture: "+preset.texture):""].filter(Boolean).join("\n");
  return _sbEl("span",{className:"shot-style-chip",title},
    _sbEl(Icon.layers,{s:12}),
    _sbEl("span",{className:"shot-style-chip-text"},"Style: "+(preset.name||"Scene preset")),
    !!pal.length && _sbEl("span",{className:"shot-style-swatches"},
      pal.map((c,i)=>_sbEl("span",{key:i,className:"shot-style-swatch",style:{background:c}}))));
}

function StoryboardSceneCtxItem({ label, value }){
  if(!value) return null;
  return _sbEl("div",{className:"ssx-item"},
    _sbEl("div",{className:"ssx-k"},label),
    _sbEl("div",{className:"ssx-v"},value));
}
/* the names of the characters in a shot's frame */
function sbInFrame(sh, ctx){
  const ids = (typeof inFrameCast==="function") ? inFrameCast(sh, ctx.scene, Object.values(ctx.charById||{})) : (sh.subjects||[]);
  return ids.map(id=>ctx.charById[id]).filter(Boolean).map(c=>c.name);
}


/* the prop sheets this page's frames ATTACH (owner 2026-10-08 — Props review): the frame's rule (worn
   close-ups only on tight shots, never a text-only object) and the sheet it uses at that moment (a state
   variant only when it was made) — [{ propId, sheetId, label }] */
function sbPropRefsForPage(scene, shots, ctx){
  const out=[], seen=new Set();
  (shots||[]).forEach(sh=>{
    const ids = (typeof inFrameProps==="function") ? (inFrameProps(sh, scene, ctx.charById, ctx.propById)||[]) : ((sh&&sh.props)||[]);
    ids.forEach(id=>{ const p=(ctx.propById||{})[id]; if(!p || seen.has(id)) return;
      if(typeof shotPropAttachable==="function"){ try{ if(!shotPropAttachable(p, sh, scene)) return; }catch(e){} }
      const so = (typeof shotPropSheetId==="function") ? shotPropSheetId(p, scene, ctx.scenes||null, sh.beatN, sh.microBeatId, sh.id, ctx) : { id:p.id, state:null };
      seen.add(id); out.push({ propId:p.id, sheetId:(so&&so.id)||p.id, label:(p.name||"Prop")+((so&&so.state&&so.state.label)?(" \u00b7 "+so.state.label):"") }); });
  });
  return out;
}
window.sbPropRefsForPage = sbPropRefsForPage;
/* the LOCATION plates the scene's frames attach (2026-10-08, owner — Locations review): each frame's room &
   time / extra-space / state plates by its render plan — never the master plate, which frames don't attach */
function sbLocRefsForShots(shots, ctx){
  const out = [], seen = new Set();
  (shots||[]).forEach(sh=>{
    let plan = null; try{ plan = (typeof shotRenderPlan==="function") ? shotRenderPlan(sh, shots, ctx||{}) : null; }catch(e){}
    const off = (Array.isArray(sh && sh.refOff) ? sh.refOff : []).map(String);
    ((plan && plan.activeLocSpec)||[]).forEach(sp=>{ if(!sp || !sp.id || seen.has(sp.id) || off.indexOf(String(sp.id))>=0) return;
      seen.add(sp.id); out.push({ id:String(sp.id), label:String(sp.label||sp.name||sp.note||"Location plate").replace(/\s*[\u2014(][\s\S]*$/,"").slice(0,48) }); });
  });
  return out;
}
window.sbLocRefsForShots = sbLocRefsForShots;

/* the scene's screenplay as a short signature: a redraft changes it, so the page's "frames need source refresh"
   count is recounted at once (2026-10-18 — it used to wait for the tab to be opened again or a frame to land) */
function sbDraftSig(scene){
  const d = scene ? ((((window.turnContinuity||{}).drafts)||{})[scene.id]) : null;
  return (typeof window.screenplayDraftSig==="function") ? window.screenplayDraftSig(d) : "";
}
/* a mood phrase from the scene's closing value charge */
function sbMood(scene){
  const c = (scene&&scene.closeCharge)||0;
  return c<=-2 ? "stark, urgent, high-tension" : c<0 ? "tense, dramatic"
    : c>=2 ? "hopeful, warm, uplifting" : c>0 ? "lifting, warmer" : "even, observational";
}

/* the FOUR production-note slug lines under a panel — CAMERA / MOTION / ACTION /
   PERFORMANCE. The canvas-composed sheet draws REAL text and word-wraps, so ACTION /
   PERFORMANCE carry the whole first sentence / line. */
function sbStrip(sh, scene, row){
  const camera = [
    (typeof shotSizeOf==="function")  ? shotSizeOf(sh.size).label   : sh.size,
    (typeof shotAngleOf==="function") ? shotAngleOf(sh.angle).label : sh.angle,
    (typeof shotLensOf==="function")  ? shotLensOf(sh.lens).label   : sh.lens,
  ].filter(Boolean).join(" · ");
  const motion = ((typeof shotMoveOf==="function") ? shotMoveOf(sh.move).label : (sh.move||"Static")) || "Static";
  // the action and line as the CURRENT screenplay has them (shot-screenplay.js shotLiveText, 2026-10-18)
  const lt = (typeof window.shotLiveText==="function") ? window.shotLiveText(scene, sh) : { action:sh.action||"", dialogue:sh.dialogue||"" };
  let action = (lt.action||"").replace(/\s+/g," ").trim();
  const m = action.match(/^[^.!?]*[.!?]/); if(m) action=m[0];
  action = action.replace(/[.!?]+$/,"");
  const dlg = (lt.dialogue||"").trim().replace(/^["“]|["”]$/g,"").replace(/[.!?]+$/,"");
  const beh = ((row && ((row.drive&&row.drive.d)||(row.react&&row.react.d)))||"").replace(/\s+/g," ").trim();
  const performance = dlg ? ('"'+((typeof clipWords==="function") ? clipWords(dlg,160) : dlg.slice(0,160))+'"')
    : (beh || sbMood(scene));
  return { camera, motion, action, performance };
}

/* ============================================================================
   PAGINATION — pages break on BEAT BOUNDARIES. A page packs whole beats up to 4
   shots; a beat never splits across pages unless it overflows a page on its own,
   and a beat that WOULD fit on one page but not in the space left starts a fresh
   page — so every page reads as whole beats. Page ids stay
   "sbpage-<sceneId>-2x2-<index>": the Stage's clip→sheet/halves bridge and the
   Art Room's progress count construct those ids directly, so the scheme is frozen.
   ============================================================================ */
const SB_PAGE_SIZE = 4;
function sbPaginateBeats(shots, pageSize){
  pageSize = pageSize || SB_PAGE_SIZE;
  const beats=[]; let cur=null;
  (shots||[]).forEach(sh=>{ const n=Number(sh.beatN)||0;
    if(!cur || cur.n!==n){ cur={ n, shots:[] }; beats.push(cur); }
    cur.shots.push(sh); });
  const pages=[]; let page=[];
  const flush=()=>{ if(page.length){ pages.push(page); page=[]; } };
  beats.forEach(b=>{
    let i=0;
    while(i < b.shots.length){
      const space = pageSize - page.length;
      const left = b.shots.length - i;
      if(!space){ flush(); continue; }
      if(left > space && b.shots.length <= pageSize && page.length){ flush(); continue; }
      const take = Math.min(space, left);
      page.push.apply(page, b.shots.slice(i, i+take)); i += take;
    }
  });
  flush();
  let start=0;
  return pages.map(p=>{ const o={ shots:p, start }; start += p.length; return o; });
}
/* ONE KEYFRAME PER BEAT ON THE BOARD (2026-10-09, owner — Storyboards review): Shots has one opening keyframe
   per beat, older extras shown as "Alternative N"; the board draws each beat's MAIN keyframe only
   (shotPrimaryOf — the same rule the Shots card uses). The Storyboards tab, the Stage's clip→board bridge
   and the Breakdown all page THIS list, so they agree. A shot with no beat number is kept. */
function sbBoardShots(orderedShots){
  const list = (orderedShots||[]).filter(Boolean);
  const byBeat = {};
  list.forEach(sh=>{ const n = Number(sh.beatN); if(!(n>0)) return; (byBeat[n] = byBeat[n] || []).push(sh); });
  const primary = {};
  Object.keys(byBeat).forEach(n=>{ const p = (typeof window.shotPrimaryOf==="function") ? window.shotPrimaryOf(byBeat[n]) : byBeat[n][0]; if(p) primary[n] = p.id; });
  return list.filter(sh=>{ const n = Number(sh.beatN); return !(n>0) || primary[n]===sh.id; });
}
window.sbBoardShots = sbBoardShots;
/* "Beat N" for a panel (the Shots tab's own label) */
function sbPanelLabel(sh){ const n = Number(sh && sh.beatN); return n>0 ? "Beat "+n : "Shot"; }
window.sbPanelLabel = sbPanelLabel;
/* page geometry for a scene's ordered shots — the SINGLE source of truth the Stage's
   clip→sheet mapping (stage.jsx storyboardClipIds) shares, so a clip always finds the
   sheet/halves its shots actually landed on. */
function sbPageRanges(shots, pageSize){
  return sbPaginateBeats(shots, pageSize).map(p=>({ start:p.start, count:p.shots.length }));
}
window.sbPageRanges = sbPageRanges;

/* WHICH SHOTS A SHEET WAS DRAWN FROM (2026-10-02): page ids are positional (frozen, above), so
   adding or removing a shot earlier in a scene moves shots onto another page's id while that id's
   sheet still shows the old panels. A composed sheet now records the shot ids it drew (meta.shotIds)
   and each saved half the ids in its row; a sheet or half whose page now holds different shots is
   OUT OF DATE — the tab says so (Recompose is a free redraw) and the Stage won't use it. An older
   composed sheet without ids is checked by its panel count; a half without ids follows its sheet;
   an uploaded board (no composed meta) can't be checked and is trusted as before. */
function sbIdsEqual(a, b){
  if(!Array.isArray(a) || !Array.isArray(b) || a.length!==b.length) return false;
  for(let i=0;i<a.length;i++) if(String(a[i])!==String(b[i])) return false;
  return true;
}
function sbHalfShotIds(shotIds, half){ return half==="top" ? (shotIds||[]).slice(0,2) : (shotIds||[]).slice(2); }
/* the halves a page of n panels has: a page of one or two panels has no bottom row (2026-10-09). Panels fill
   the 2×2 grid row by row, so "top" = cells 0/1 and "bottom" = cells 2/3 (the names stay — saved ids use them) */
function sbHalvesFor(n){ return Number(n)>2 ? ["top","bottom"] : ["top"]; }
window.sbHalvesFor = sbHalvesFor;
/* WHICH FRAMES A SHEET WAS DRAWN FROM (2026-10-05, owner — Storyboards review): a sheet only redraws
   itself while its scene is open in this tab, so a frame re-rendered from Shots left the sheet (and its
   halves) showing the old image as if current. Each composed sheet and saved half now records every
   panel's frame version ("<shotId>@<iso>#<version>"); a panel whose frame changed since makes it out of
   date. Judged only when that frame's meta is loaded — a cold cache is never a false alarm — and a
   sheet from before this was recorded keeps the shot-id check alone. */
function sbFrameVersions(shots){
  return (shots||[]).map(sh=>{ const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
    return String(sh.id)+"@"+((m&&m.iso)||"")+"#"+((m&&m.version)||""); });
}
/* A DELETED FRAME DATES ITS SHEET (2026-10-09, owner — Storyboards review): a frame's meta is judged only when
   warm, so a deleted frame read like a cold cache and its sheet (and halves) stayed "current" for the Stage.
   A frame the store clears in this session (its nb-gen-done with an empty url) is remembered per film and
   counts as a change; a frame made again is forgotten. */
const _sbGoneFrames = new Set();
function sbGoneKey(id){ return String((typeof nbEpoch==="function") ? nbEpoch() : "")+"|"+String(id); }
function sbFrameGone(id){ return _sbGoneFrames.has(sbGoneKey(id)); }
try{ window.addEventListener("nb-gen-done", (e)=>{ const d = (e && e.detail) || {};
  if(d.id==null || /^sbsheet-/.test(String(d.id))) return;
  if(d.url) _sbGoneFrames.delete(sbGoneKey(d.id));
  else if(Object.prototype.hasOwnProperty.call(d, "url")) _sbGoneFrames.add(sbGoneKey(d.id)); }); }catch(e){}
window.sbFrameGone = sbFrameGone;
/* the recorded frames of a sheet / half that were deleted since (a frame missing when it was drawn doesn't count) */
function sbFramesGone(meta){
  const list = (meta && Array.isArray(meta.frameVersions)) ? meta.frameVersions : [];
  return list.some(entry=>{ const s = String(entry||""), at = s.lastIndexOf("@"); if(at<1) return false;
    return s.slice(at+1)!=="#" && sbFrameGone(s.slice(0, at)); });
}
function sbFramesChanged(meta){
  const list = (meta && Array.isArray(meta.frameVersions)) ? meta.frameVersions : null;
  if(!list || typeof nbGetMeta!=="function") return false;
  if(sbFramesGone(meta)) return true;
  return list.some(entry=>{ const s = String(entry||""), at = s.lastIndexOf("@"); if(at<1) return false;
    const id = s.slice(0, at), m = nbGetMeta(id); if(!m) return false;
    return (id+"@"+(m.iso||"")+"#"+(m.version||""))!==s; });
}
/* a sheet's own version — what its halves record as `sourceVersion` */
function sbSheetVersionOf(meta){ return String((meta && (meta.iso||meta.ts||meta.version)) || ""); }
function sbSheetStale(meta, shotIds){
  if(!meta) return false;
  if(Array.isArray(meta.shotIds)) return !sbIdsEqual(meta.shotIds, shotIds||[]) || sbFramesChanged(meta);
  if(meta.composed && Number(meta.panels)>0) return Number(meta.panels)!==(shotIds||[]).length;
  return false;
}
function sbHalfStale(meta, shotIds, half, sheetMeta){
  if(!meta) return false;
  // cut from an OLDER sheet (a recompose, a replaced upload) — the tab said so; now the Stage listens too
  const sv = sbSheetVersionOf(sheetMeta);
  if(meta.sourceVersion && sv && String(meta.sourceVersion)!==sv) return true;
  if(Array.isArray(meta.shotIds)) return !sbIdsEqual(meta.shotIds, sbHalfShotIds(shotIds, half)) || sbFramesChanged(meta);
  return sbSheetStale(sheetMeta, shotIds);
}
window.sbFrameVersions = sbFrameVersions;
window.sbFramesChanged = sbFramesChanged;
window.sbFramesGone = sbFramesGone;
window.sbSheetVersionOf = sbSheetVersionOf;
window.sbSheetStale = sbSheetStale;
window.sbHalfStale = sbHalfStale;
window.sbHalfShotIds = sbHalfShotIds;

/* Truthful board readiness: a composed sheet that still contains placeholder panels
   is partial, not ready. Uploaded boards have no composed metadata and count complete. */
/* (2026-10-09, owner — Storyboards review) an OUT-OF-DATE sheet (its page's shots or frames changed since it
   was drawn — sbSheetStale) is counted on its own, never as complete: the Stage won't use it until it is
   recomposed. `stale` is only reported when there is one, so older callers' shapes stay as they were. */
/* decision D (2026-10-09, owner — Breakdown review): ONE rule for "drawn from frames with an EARLIER LOOK", shared by the
   Storyboards tab and the Breakdown — a COMPOSED sheet (an upload wasn't drawn from frames) any of whose frames was made
   before the scene's look or the film stock changed is not up to date */
function sbSheetFromEarlierLook(meta, frameIds, project, sceneId){
  if(!meta || !meta.composed || !project || typeof shotLookIsEarlier!=="function") return false;
  return (frameIds||[]).some(fid=>{ const fm = (fid && typeof nbGetMeta==="function") ? nbGetMeta(fid) : null;
    return !!(fm && shotLookIsEarlier(fm.lookSig, project, sceneId)); });
}
window.sbSheetFromEarlierLook = sbSheetFromEarlierLook;
/* a sheet drawn from frames with an earlier look counts as OUT OF DATE (stale), and is counted apart too (oldLook) */
function sbStoryboardReadiness(pagesByScene, frames, metaOf, project){
  const out = { complete:0, partial:0, missing:0, total:0 };
  let stale = 0, oldLook = 0;
  const getMeta = typeof metaOf==="function" ? metaOf : ()=>null;
  const proj = project || window.turnProject || null;
  (pagesByScene||[]).forEach(g=>(g.pages||[]).forEach(page=>{
    out.total++;
    const id = "sbsheet-"+page.id;
    if(!(frames&&frames[id])){ out.missing++; return; }
    const meta = getMeta(id)||{};
    const ids = (page.shots||[]).map(x=>x && x.id);
    if(sbSheetStale(meta, ids)){ stale++; return; }
    const sceneId = (g.scene && g.scene.id) || ((page.shots||[]).find(x=>x && x.sceneId)||{}).sceneId;
    if(sbSheetFromEarlierLook(meta, ids, proj, sceneId)){ stale++; oldLook++; return; }
    const missing = Math.max(0, Number(meta.missing)||0);
    if(meta.composed && missing>0) out.partial++; else out.complete++;
  }));
  if(stale) out.stale = stale;
  if(oldLook) out.oldLook = oldLook;
  return out;
}
window.sbStoryboardReadiness = sbStoryboardReadiness;

/* ============================================================================
   SHEET-COMPOSE COORDINATOR — ONE writer per sheet id. A mounted card's compose
   (auto-recompose, Recompose button) and the bulk Compose-all / per-scene runs
   all go through here, so two composes can never interleave commits on one
   sheet: a second request coalesces onto the running one, which redraws ONCE
   with fresh frames if the frames changed under it (or a new request arrived)
   before committing. Only the winning run clears the user's Clear-hold or
   announces the new sheet; a film switch mid-run stays a quiet discard (epoch);
   and a failed save returns status:"failed" — callers surface it, never mask it.
   ============================================================================ */
const _sbComposeRuns = {};   // film + sheet id -> { again, explicit, promise }
/* each panel's frame as the coordinator sees it: "<id>@<iso>#<version>" + the url it paints from */
function sbSnapParts(page){
  return ((page&&page.shots)||[]).map(sh=>{
    const u = (typeof nbGetImage==="function") ? (nbGetImage(sh.id)||"") : "";
    const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
    return { id:String(sh.id), frame:sh.id+"@"+((m&&m.iso)||"")+"#"+((m&&m.version)||""), url:u };
  });
}
function sbSheetSnapshot(page){ return sbSnapParts(page).map(p=>p.frame+"|"+p.url).join("~"); }
/* did a frame change since `before`? A url the draw itself refreshed (B1: a fresh signed url for the SAME
   frame) is not a change — otherwise an unreadable frame would redraw forever */
function sbSnapChanged(before, page, refreshed){
  const now = sbSnapParts(page), skip = refreshed || [];
  if(now.length!==before.length) return true;
  return now.some((p,i)=> p.id!==before[i].id || p.frame!==before[i].frame || (p.url!==before[i].url && skip.indexOf(p.id)<0));
}
/* warm the frame caches BEFORE snapshotting, so a cold cache doesn't read as a frame change */
async function sbWarmFrames(page){
  for(const sh of ((page&&page.shots)||[])){
    if(typeof nbGetImage==="function" && !nbGetImage(sh.id) && typeof nbLoadImage==="function"){
      try{ await nbLoadImage(sh.id); }catch(e){}
    }
  }
}
/* A RESTORED SHEET STAYS (2026-10-09, owner — Storyboards review): a version you restore (Details' Restore or
   Delete current, or a halves restore) used to be undone as soon as the card remounted — the hold lived in the
   card. It is kept per film in this tab session with the page's shots and frames AT THE RESTORE; automatic and
   bulk composes leave it alone until a frame really changes after the restore, and any compose that commits
   (a Recompose) ends it. It stays marked out of date while it is (the Stage won't use it). */
function sbRestoreKey(projectId, sid){ return "turn_sb_restored_"+String(projectId||"")+":"+sid; }
function sbMarkRestored(projectId, sid, page){
  try{ sessionStorage.setItem(sbRestoreKey(projectId, sid), JSON.stringify({
    ids:((page&&page.shots)||[]).map(x=>String(x.id)), fv:sbFrameVersions((page&&page.shots)||[]) })); }catch(e){}
}
function sbRestoreHeld(projectId, sid, page){
  let saved = null;
  try{ saved = JSON.parse(sessionStorage.getItem(sbRestoreKey(projectId, sid))||"null"); }catch(e){ saved = null; }
  if(!saved || !Array.isArray(saved.ids)) return false;
  // the same shots, and no frame changed since the restore (a cold frame is never a change — sbFramesChanged)
  return sbIdsEqual(saved.ids, ((page&&page.shots)||[]).map(x=>String(x.id))) && !sbFramesChanged({ frameVersions:saved.fv||[] });
}
window.sbMarkRestored = sbMarkRestored;
window.sbRestoreHeld = sbRestoreHeld;
/* the outcomes in which a run drew nothing — an explicit Recompose that joined such a run then runs itself */
const SB_NOT_DRAWN = { kept:1, current:1, held:1 };
/* (2026-10-09, owner — Storyboards review) a run belongs to the FILM it started in: its scope is taken once,
   a film switch between passes ends it quietly, and runs are keyed by film + sheet (sheet ids repeat across
   films). An UPLOADED board is never drawn over unless you ask (extraMeta.explicit — Recompose / Compose from
   frames): the sheet is loaded first, so a slow load can't read as "no sheet yet". Automatic and bulk composes
   also leave a sheet that is UP TO DATE (same shots, no frame changed, nothing missing) and a RESTORED version
   alone ("current" / "held"); only an explicit Recompose redraws them. An explicit request that meets a running
   automatic run makes that run draw, and if it had already decided not to, runs again once it ends. A Clear
   made while a run draws ends that run without a commit ("cleared"). */
function sbComposeSheet(scene, page, ctx, beatsMap, extraMeta, _drawFn){
  const sid = "sbsheet-"+page.id;
  const ep0 = (typeof nbEpoch==="function") ? nbEpoch() : null;
  const key = String(ep0)+"|"+sid;
  const explicit = !!(extraMeta && extraMeta.explicit);
  const cur = _sbComposeRuns[key];
  if(cur){
    cur.again = true;                                 // coalesce onto the running writer
    if(!explicit) return cur.promise;
    cur.explicit = true;                              // ...which now draws even over an upload / a current sheet
    return cur.promise.then(res=> (res && SB_NOT_DRAWN[res.status])
      ? sbComposeSheet(scene, page, ctx, beatsMap, extraMeta, _drawFn) : res);
  }
  const draw = _drawFn || composeStoryboardSheet;    // _drawFn: headless-test seam only
  const extra = { ...(extraMeta||{}) }; delete extra.explicit;
  const projectId = (ctx && ctx.project && ctx.project.id) || "";
  const run = { again:false, explicit };
  run.promise = (async ()=>{
    // yield once so the run is REGISTERED before it can finish — a run that returned synchronously (an
    // upload already in memory) cleaned up before it was registered and then stayed registered for good
    await Promise.resolve();
    let holdAtStart = null; try{ holdAtStart = sessionStorage.getItem("turn_sb_hold_"+sid); }catch(e){}
    try{
      if(!run.explicit){
        let has = (typeof nbGetImage==="function") ? nbGetImage(sid) : "";
        if(!has && typeof nbLoadImage==="function"){ try{ has = await nbLoadImage(sid); }catch(e){} }
        const m0 = (typeof nbGetMeta==="function") ? nbGetMeta(sid) : null;
        if(!run.explicit && has && m0 && (m0.uploaded || m0.mode==="upload" || !m0.composed)) return { status:"kept" };
        if(has && m0 && m0.composed){
          await sbWarmFrames(page);
          const ids = (page.shots||[]).map(x=>x.id);
          if(!run.explicit && sbRestoreHeld(projectId, sid, page)) return { status:"held" };
          // (a sheet from before frame versions were recorded can't be judged — it is redrawn as before)
          if(!run.explicit && Array.isArray(m0.shotIds) && Array.isArray(m0.frameVersions) && sbIdsEqual(m0.shotIds, ids)
            && !sbSheetStale(m0, ids) && !(Number(m0.missing)>0))
            return { status:"current" };
        }
      }
      // NEVER commit a payload drawn from superseded frames — on ANY pass, including
      // after a successful commit if a newer request arrived during the save. The
      // loop only repeats when something really changed (a frame re-rendered, a new
      // request coalesced), so it settles as soon as renders settle; each pass is a
      // cheap canvas redraw, never a generation.
      while(true){
        run.again = false;
        if(typeof nbEpoch==="function" && nbEpoch()!==ep0) return { status:"stale" };   // the film changed
        const _ep = ep0;
        await sbWarmFrames(page);
        const before = sbSnapParts(page);
        // how many panels have no frame at all — the fallback count when the draw doesn't report its own
        const missingAtDraw = (page.shots||[]).filter(x=> !(typeof nbGetImage==="function" && nbGetImage(x.id))).length;
        const drawn = await draw(scene, page, ctx, beatsMap);
        const dataUrl = (typeof drawn==="string") ? drawn : ((drawn && drawn.dataUrl) || "");
        // THE REAL MISSING COUNT (2026-10-09, owner — Storyboards review): a frame that exists but couldn't be
        // drawn (failed fetch, expired link, decode error) is a "Frame not generated" panel too — the draw says
        // how many panels it really painted, and that is what the sheet records (the Stage reads sm.missing)
        const missingDrawn = (drawn && typeof drawn==="object" && typeof drawn.missing==="number") ? drawn.missing : missingAtDraw;
        const refreshed = (drawn && typeof drawn==="object" && Array.isArray(drawn.refreshed)) ? drawn.refreshed.map(String) : [];
        if(!dataUrl){
          if(run.again) continue;      // a frame may have JUST arrived — try again
          return { status:"skipped" }; // nothing to draw — not a failure
        }
        if(run.again || sbSnapChanged(before, page, refreshed)) continue;   // outdated payload: redraw, don't commit
        // you pressed Clear while this run drew: the sheet stays cleared (2026-10-09)
        let holdNow = null; try{ holdNow = sessionStorage.getItem("turn_sb_hold_"+sid); }catch(e){}
        if(holdNow==="1" && holdAtStart!=="1") return { status:"cleared" };
        // the version is stamped HERE (not inside the store) so the halves cut below record exactly it
        const meta = { model:"Composited from shot frames", composed:true,
          panels:(page.shots||[]).length, shotIds:(page.shots||[]).map(x=>x.id),
          frameVersions:sbFrameVersions(page.shots), ...extra, missing:missingDrawn, ts:Date.now(), iso:new Date().toISOString() };
        const r = (typeof nbCommit==="function") ? await nbCommit(sid, dataUrl, meta, [], undefined, _ep) : null;
        if(r && r.tier==="stale") return { status:"stale" };   // film switched: quiet discard
        if(!r || r.tier==="error") return { status:"failed", error:"the composed sheet couldn't be saved. Check your connection and try again." };
        try{ sessionStorage.removeItem("turn_sb_hold_"+sid); }catch(e){}
        try{ sessionStorage.removeItem(sbRestoreKey(projectId, sid)); }catch(e){}   // a new sheet ends a restore's hold
        try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:sid, url:r.url||dataUrl } })); }catch(e){}
        // THE STAGE'S HALVES, AUTOMATICALLY (2026-10-03, owner — Storyboards review): a COMPLETE
        // sheet (every panel has a frame) saves its top/bottom halves at once — free, and the Stage
        // stops falling back to the whole sheet because nobody pressed "Save halves". Best effort:
        // the ⋮ menu's Save halves stays for a manual re-save. Never when a panel was drawn as a
        // placeholder (missingDrawn) — those halves would send "Frame not generated" to a paid render.
        const missingNow = (page.shots||[]).filter(x=> !(typeof nbGetImage==="function" && nbGetImage(x.id))).length;
        // in the BACKGROUND: the compose resolves at once; the halves land a moment later. Cut from the
        // canvas just drawn (the same pixels — no re-fetch of the stored copy, no cross-origin canvas)
        if(!missingDrawn && !missingNow && !run.again){
          try{
            Promise.resolve(sbSaveHalves(dataUrl, sid, page, sbSheetVersionOf(meta), _ep, meta))
              .then(()=>{ try{ window.dispatchEvent(new CustomEvent("sb-halves-saved",{ detail:{ id:sid } })); }catch(e){} })
              .catch(()=>{});
          }catch(e){}
        }
        // a coalesced request landed while the commit was saving: its frames are
        // newer than what we just wrote — go around once more so the stored sheet
        // ends on the newest state
        if(run.again) continue;
        return { status:"composed", url:r.url||dataUrl };
      }
    } finally { delete _sbComposeRuns[key]; }
  })();
  _sbComposeRuns[key] = run;
  return run.promise;
}
/* is a compose running for this sheet right now (any card, a bulk run)? */
function sbComposeRunning(sid){
  const ep = (typeof nbEpoch==="function") ? nbEpoch() : null;
  return !!_sbComposeRuns[String(ep)+"|"+sid];
}
window.sbComposeRunning = sbComposeRunning;
window.sbComposeSheet = sbComposeSheet;   // exported for the headless coordinator tests

/* ============================================================================
   COMPOSE FROM SHOT FRAMES — the sheet is just a VIEW over work already paid for:
   the frames laid into a 2×2 grid on a canvas, in the format's native frame (16:9,
   or vertical 9:16 for micro-drama), with the CAMERA / MOTION / ACTION /
   PERFORMANCE strips drawn as REAL text. Per-panel repair comes free: regenerate
   one shot in the Shots tab, the sheet recomposes around it.
   ============================================================================ */
async function sbLoadBitmap(url){
  if(!url) return null;
  let revoke = null;
  try{
    if(/^https?:/.test(url)){   // cross-origin signed URL would TAINT the canvas — pull bytes first
      const res = await fetch(url, { mode:"cors" }); if(!res.ok) return null;
      url = URL.createObjectURL(await res.blob()); revoke = url;
    }
    const img = new Image(); img.decoding = "async"; img.src = url;
    if(img.decode) await img.decode();
    else await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; });
    return { img, revoke };
  }catch(e){ if(revoke){ try{ URL.revokeObjectURL(revoke); }catch(_){} } return null; }
}
/* greedy word-wrap for the canvas strips; overflow past maxLines ellipsizes the
   last line (so ACTION / PERFORMANCE read whole, not chopped mid-thought). */
function sbWrapText(g, text, maxW, maxLines){
  const words = String(text||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  if(!words.length) return ["—"];
  const lines = []; let cur = words[0];
  for(let i=1;i<words.length;i++){
    const t = cur+" "+words[i];
    if(g.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = words[i]; }
  }
  lines.push(cur);
  if(lines.length > maxLines){
    let last = lines[maxLines-1];
    while(last && g.measureText(last+" …").width > maxW) last = last.replace(/\s*\S+$/,"");
    lines.length = maxLines; lines[maxLines-1] = (last?last+" ":"")+"…";
  }
  return lines;
}

async function composeStoryboardSheet(scene, page, ctx, beatsMap){
  const shots = page.shots || [];
  const N = shots.length; if(!N) return null;
  const off = page.start || 0;   // scene-relative shot numbering (page 2+)
  // gather the shots' generated frames (cache-first; cloud byte-cache makes this instant)
  const urls = [];
  for(const sh of shots){
    let u = (typeof nbGetImage==="function") ? nbGetImage(sh.id) : "";
    if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(sh.id); }catch(e){} }
    urls.push(u || "");
  }
  if(!urls.some(Boolean)) return null;
  // layout — a 2×2 grid in the FORMAT's native frame (16:9, or vertical 9:16 for
  // micro-drama), an annotation strip under each: CAMERA + MOTION one line each,
  // ACTION + PERFORMANCE up to TWO wrapped lines (fixed slots — 6 rows — so every
  // panel's strip is the same height)
  const _asp = (typeof aspectFor==="function") ? aspectFor(ctx && ctx.project) : "16:9";
  const { PAD, GAP, CELL_W, IMG_H, STRIP_H, CELL_H, cols, W, H } = sbSheetLayout(_asp, N, page.grid);
  const canvas = document.createElement("canvas"); canvas.width=W; canvas.height=H;
  const g = canvas.getContext("2d");
  g.fillStyle = "#101012"; g.fillRect(0,0,W,H);
  const bitmaps = await Promise.all(urls.map(u=>sbLoadBitmap(u)));
  // A FRAME THAT WON'T LOAD GETS ONE MORE TRY (2026-10-09, owner — Storyboards review): an expired signed link
  // or a revoked cached blob is re-resolved for the SAME frame (nbRefreshImage — no generation) before the
  // panel is drawn as "Frame not generated"; the ids tried are reported so the coordinator doesn't read
  // the fresh link as a frame change
  const refreshed = [];
  for(let i=0;i<N;i++){
    if((bitmaps[i] && bitmaps[i].img) || !urls[i] || typeof window.nbRefreshImage!=="function") continue;
    refreshed.push(String(shots[i].id));
    let fresh = ""; try{ fresh = await window.nbRefreshImage(shots[i].id, urls[i]); }catch(e){}
    if(fresh) bitmaps[i] = await sbLoadBitmap(fresh);
  }
  // the panels really drawn without a frame — what the sheet records as `missing`
  const missing = bitmaps.filter(bm=> !(bm && bm.img)).length;
  // [label, key, line slots] — ACTION and PERFORMANCE get two wrapped lines
  const SLOTS = [["CAMERA","camera",1],["MOTION","motion",1],["ACTION","action",2],["PERFORMANCE","performance",2]];
  for(let i=0;i<N;i++){
    const sh = shots[i], row = sbBeatRow(beatsMap, sh);
    const x = PAD + (i%cols)*(CELL_W+GAP), y = PAD + Math.floor(i/cols)*(CELL_H+GAP);
    // frame (cover-fit; shot frames match the format aspect so this is exact in practice)
    const bm = bitmaps[i];
    if(bm && bm.img){
      const im=bm.img, s=Math.max(CELL_W/im.naturalWidth, IMG_H/im.naturalHeight);
      const dw=im.naturalWidth*s, dh=im.naturalHeight*s;
      g.save(); g.beginPath(); g.rect(x,y,CELL_W,IMG_H); g.clip();
      g.drawImage(im, x+(CELL_W-dw)/2, y+(IMG_H-dh)/2, dw, dh); g.restore();
    } else {
      g.fillStyle="#17171a"; g.fillRect(x,y,CELL_W,IMG_H);
      g.strokeStyle="rgba(255,255,255,.14)"; g.setLineDash([6,6]); g.strokeRect(x+8.5,y+8.5,CELL_W-17,IMG_H-17); g.setLineDash([]);
      g.fillStyle="#6f6a60"; g.font="500 15px 'Hanken Grotesk', sans-serif"; g.textAlign="center";
      g.fillText("Frame not generated — "+sbPanelLabel(sh), x+CELL_W/2, y+IMG_H/2-8);
      g.font="500 12px 'Space Mono', monospace";
      g.fillText("generate it in the Shots tab — the sheet redraws when you next open it here", x+CELL_W/2, y+IMG_H/2+14);
      g.textAlign="left";
    }
    // annotation strip — real text, exact content
    const sy = y + IMG_H;
    g.fillStyle = "#f2eee4"; g.fillRect(x, sy, CELL_W, STRIP_H);
    g.strokeStyle = "#d8d2c2"; g.beginPath(); g.moveTo(x, sy+.5); g.lineTo(x+CELL_W, sy+.5); g.stroke();
    const st = sbStrip(sh, scene, row);
    const LABEL_X = x+12, VALUE_X = x+128, MAX_W = CELL_W-(VALUE_X-x)-12;
    let rowI = 0;
    SLOTS.forEach(([lab,key,maxL])=>{
      const ly = sy + 22 + rowI*20;
      g.fillStyle = "#8a8474"; g.font = "700 11px 'Space Mono', monospace";
      g.fillText(lab, LABEL_X, ly);
      g.fillStyle = "#1b1a16"; g.font = "500 14px 'Hanken Grotesk', sans-serif";
      sbWrapText(g, String(st[key]||"—"), MAX_W, maxL)
        .forEach((ln,k)=> g.fillText(ln, VALUE_X, ly + k*20));
      rowI += maxL;
    });
    // panel number, top-right of the strip
    g.fillStyle = "#8a8474"; g.font = "700 11px 'Space Mono', monospace"; g.textAlign="right";
    g.fillText(sbPanelLabel(sh), x+CELL_W-12, sy+22); g.textAlign="left";
  }
  bitmaps.forEach(bm=>{ if(bm && bm.revoke){ try{ URL.revokeObjectURL(bm.revoke); }catch(e){} } });
  return { dataUrl:canvas.toDataURL("image/jpeg", 0.92), missing, refreshed };
}
window.composeStoryboardSheet = composeStoryboardSheet;

/* one SHEET card — the composed grid image + its furniture: options menu (view /
   details / edit a panel / recompose / upload / save halves / clear), the saved-halves
   manager (the Stage's hand-off), the per-panel repair flow, and the details modal.
   The card also SELF-DERIVES: it composes on first view when frames exist, and a
   composed sheet recomposes (debounced) when one of its frames re-renders. */
// Saved-half timestamps belong in the sheet's Details, not its compact thumbnails.
function sbHalfDateDetails(halves){
  return ["top","bottom"].flatMap(h=>{
    const meta=halves&&halves[h]&&halves[h].meta;
    if(!meta)return [];
    let date=meta.date||"",time=meta.time||"";
    if(meta.iso&&(!date||!time)){
      const d=new Date(meta.iso);
      if(!Number.isNaN(d.getTime())){
        if(!date)date=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
        if(!time)time=d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
      }
    }
    const v=[date,time].filter(Boolean).join(" · ");
    return v?[{k:"Current "+h+" half saved",v}]:[];
  });
}

function StoryboardComposite({ scene, page, ctx, beatsMap, onView, onUpdateShot, readOnly=false, bulkBusy=false }){
  const sid = "sbsheet-"+page.id;
  // store/display ONLY — this tab never paints sheets; compose-from-frames is the path
  // (2026-10-09) an upload records the page's shots, so a page whose shots change flags it; a version you
  // restore (here, in Details — Restore or Delete current) is held off the automatic redraws for good: the
  // hold is kept per film in this tab session (sbMarkRestored), not in the card, so a remount can't undo it
  const pageIdsRef = React.useRef([]);
  const pageRef = React.useRef(page); pageRef.current = page;
  const projectId = (ctx && ctx.project && ctx.project.id) || "";
  const gen = useImageGen({ id: sid, slotId: sid,
    importMeta: ()=>({ shotIds: pageIdsRef.current.slice() }),
    onReverted: ()=>{ sbMarkRestored(projectId, sid, pageRef.current); } });
  const shotIds = (page.shots||[]).map(s=>s.id);
  pageIdsRef.current = shotIds;
  // (2026-10-09) the card is still on screen — a panel edit that ends after you paged away says so in a toast
  const mountedRef = React.useRef(true);
  React.useEffect(()=>{ mountedRef.current = true; return ()=>{ mountedRef.current = false; }; },[]);
  // a plain message on the sheet's error strip (no retry button): a refused or failed Clear / Save halves /
  // halves restore or delete, a film switch mid-action (2026-10-09)
  const [actionErr, setActionErr] = React.useState("");
  const filmEpoch = ()=> (typeof nbEpoch==="function") ? nbEpoch() : null;
  const [ready, setReady] = React.useState({ n:0, total:shotIds.length });
  const [composing, setComposing] = React.useState(false);
  const [composeErr, setComposeErr] = React.useState("");
  const sheetAsp = (typeof aspectFor==="function") ? aspectFor(ctx && ctx.project) : "16:9";
  /* Panel repair is a paid image edit even though the surrounding storyboard is
     a free canvas composition.  Resolve its cast at each guard rather than
     retaining a render-start object: a character/cast edit during an image
     await must be observed before submission and commit. */
  const panelIdentityIds = ()=>{
    const live=(window.turnIdentityContext&&typeof window.turnIdentityContext==="object")
      ? window.turnIdentityContext : {};
    const chars=Array.isArray(live.characters) ? live.characters
      : (Array.isArray(live.cast) ? live.cast : Object.values((ctx&&ctx.charById)||{}));
    const sceneNow=live.scenes&&scene ? (live.scenes.find(s=>String(s&&s.id)===String(scene&&scene.id))||scene) : scene;
    const ids=[];
    (page.shots||[]).forEach(sh=>{
      const got=(typeof inFrameCast==="function") ? inFrameCast(sh,sceneNow,chars) : (sh.subjects||[]);
      (got||[]).forEach(id=>{ if(ids.indexOf(id)<0) ids.push(id); });
    });
    const cast=chars.filter(c=>ids.some(id=>String(id)===String(c&&c.id)));
    return { characterIds:ids, cast, scenes:Array.isArray(live.scenes)?live.scenes:[sceneNow],
      drafts:Object.prototype.hasOwnProperty.call(live,"drafts") ? live.drafts : (ctx&&ctx.drafts)||{} };
  };
  const panelIdentityOpts = ()=>{
    const x=panelIdentityIds();
    return { identityCharacterIds:x.characterIds, identityCast:x.cast, identityContext:x };
  };

  // split the sheet into halves and save both to the project's image store (cloud) —
  // the Stage's video-generation hand-off; no local files to manage. Saved halves are
  // shown under the sheet with View / Restore previous / Delete, and re-saving is a
  // guarded no-op while the halves already match the sheet's current version.
  const [halvesBusy, setHalvesBusy] = React.useState(false);
  const [halvesDone, setHalvesDone] = React.useState(false);
  const [halvesErr, setHalvesErr] = React.useState("");
  const [halves, setHalves] = React.useState({});   // { top:{url,meta}, bottom:{url,meta} }
  const [halvesOpen, setHalvesOpen] = React.useState(false);   // collapsed by default — keeps the sheet area tidy
  const loadHalves = async ()=>{
    const out = {};
    for(const h of ["top","bottom"]){
      const id = sid+":half-"+h;
      let u = (typeof nbGetImage==="function") ? nbGetImage(id) : "";
      if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(id); }catch(e){} }
      if(u) out[h] = { url:u, meta:(typeof nbGetMeta==="function") ? (nbGetMeta(id)||null) : null };
    }
    setHalves(out);
  };
  React.useEffect(()=>{ let alive=true; (async()=>{ if(alive) await loadHalves(); })(); return ()=>{ alive=false; }; },[sid]);
  React.useEffect(()=>{
    const h = (e)=>{ if(e && e.detail && e.detail.id===sid) loadHalves(); };
    window.addEventListener("sb-halves-saved", h);
    return ()=> window.removeEventListener("sb-halves-saved", h);
  },[sid]);

  // BUILT FROM — the reference images this sheet's frames lock to, as small thumbnails
  // (click to enlarge): the location plate, in-frame character sheets and prop sheets.
  // Recomputed live so they're always displayable.
  const [refImgs, setRefImgs] = React.useState([]);
  const _sbRefKey = [page.id, gen.genUrl||"", (page.shots||[]).map(s=>s.id).join(","),
    (ctx.location&&ctx.location.id)||""].join("|");
  React.useEffect(()=>{
    let alive = true;
    (async()=>{
      const grab = async (id)=>{ let u=(typeof nbGetImage==="function")?nbGetImage(id):"";
        if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(id); }catch(e){} } return u||""; };
      const out=[], seen=new Set();
      const shots = (ctx.sceneShots && ctx.sceneShots.length) ? ctx.sceneShots : (page.shots||[]);   // scene-wide refs (same across pages)
      for(const r of sbLocRefsForShots(shots, ctx)){ const u=await grab(r.id); if(u){ out.push({ url:u, label:r.label, kind:"location" }); seen.add(r.id); } }
      const ids=[]; const _chars=Object.values(ctx.charById||{});
      shots.forEach(sh=>{ const inc=(typeof inFrameCast==="function")?inFrameCast(sh, scene, _chars):(sh.subjects||[]); inc.forEach(id=>{ if(ids.indexOf(id)<0) ids.push(id); }); });
      // the sheet this scene's frames attach — its appearance variant, else the master (2026-10-06)
      for(const id of ids){ if(seen.has(id)) continue; const c=ctx.charById[id]; if(!c) continue;
        const spec=(typeof shotCharacterReferenceSpec==="function") ? shotCharacterReferenceSpec(c, scene, ctx.scenes||null) : null;
        const rid=(spec&&spec.id)||id; const u=await grab(rid);
        if(u){ out.push({ url:u, label:(spec&&spec.label)||c.name, kind:"character" }); seen.add(id); } }
      for(const r of sbPropRefsForPage(scene, shots, ctx)){ if(seen.has(r.propId)) continue; const u=await grab(r.sheetId); if(u){ out.push({ url:u, label:r.label, kind:"prop" }); seen.add(r.propId); } }
      if(alive){ setRefImgs(out); }
    })();
    return ()=>{ alive=false; };
  },[_sbRefKey]);

  // optional EXTRA REFERENCES for panel edits — the scene's characters, props and
  // location plate, opt-in chips so a panel repair can be pinned to the canon designs.
  const [editRefSel, setEditRefSel] = React.useState([]);
  const editRefOptions = React.useMemo(()=>{
    const seen = new Set(), out = [];
    const refShots = (ctx.sceneShots && ctx.sceneShots.length) ? ctx.sceneShots : (page.shots||[]);
    const _chars = Object.values(ctx.charById||{});
    refShots.forEach(sh=> ((typeof inFrameCast==="function")?inFrameCast(sh, scene, _chars):(sh.subjects||[])).forEach(cid=>{
      if(seen.has(cid)) return; seen.add(cid);
      const c = ctx.charById[cid]; if(!c) return;
      const spec = (typeof shotCharacterReferenceSpec==="function") ? shotCharacterReferenceSpec(c, scene, ctx.scenes||null) : null;
      out.push({ id:(spec&&spec.id)||c.id, label:(spec&&spec.label)||c.name, note:(spec&&spec.note)||(c.name+"'s character sheet") });
    }));
    sbPropRefsForPage(scene, refShots, ctx).forEach(r=>{
      if(seen.has(r.propId)) return; seen.add(r.propId);
      out.push({ id:r.sheetId, label:r.label, note:r.label+" prop sheet" });
    });
    sbLocRefsForShots(refShots, ctx).forEach(r=>{ if(seen.has(r.id)) return; seen.add(r.id);
      out.push({ id:r.id, label:r.label, note:r.label+" location plate" }); });
    return out;
  },[scene, page.shots, ctx]);
  const toggleEditRef = (rid)=> setEditRefSel(sel=> sel.indexOf(rid)>=0 ? sel.filter(x=>x!==rid) : [...sel, rid]);
  const editRefChips = (key)=> editRefOptions.length>0 && _sbEl("div",{key, className:"sb-editrefs"},
    _sbEl("span",{className:"sb-editrefs-lab"},"Reference:"),
    editRefOptions.map(o=> _sbEl("button",{key:o.id, type:"button", "aria-pressed":editRefSel.indexOf(o.id)>=0?"true":"false", className:"sb-editref-chip"+(editRefSel.indexOf(o.id)>=0?" on":""),
      title:"Attach "+o.note+" to this edit so the model matches that design exactly",
      onClick:()=>toggleEditRef(o.id)}, o.label)));

  // the sheet version the halves must match to count as "already saved"
  const sheetVersion = ()=> sbSheetVersionOf(gen.genMeta || ((typeof nbGetMeta==="function") ? nbGetMeta(sid) : null) || {});
  // the page's shots changed since this sheet / these halves were made (see sbSheetStale)
  const sheetMetaNow = () => gen.genMeta || ((typeof nbGetMeta==="function") ? nbGetMeta(sid) : null);
  // the halves this page has: a page of one or two panels has no bottom row, so none is saved or listed (2026-10-09)
  const halfNames = sbHalvesFor(shotIds.length);
  const halvesStale = halfNames.some(h=> halves[h] && sbHalfStale((halves[h]||{}).meta, shotIds, h, sheetMetaNow()));
  const halvesCurrent = !halvesStale && halfNames.every(h=>!!halves[h]) && (()=>{ const v = sheetVersion();
    return v ? halfNames.every(h=> String(((halves[h]||{}).meta||{}).sourceVersion||"")===v) : true; })();
  // AN UPLOAD THAT ISN'T SHAPED LIKE A 2×2 SHEET gets no halves (2026-10-09, owner decision) — said on the card
  const _gm = gen.genMeta || {};
  const uploadShapeOff = !!(gen.genUrl && !(_gm.composed) && sbUploadShapeOk(_gm.pixelW, _gm.pixelH, sheetAsp)===false);
  const saveHalves = async ()=>{
    if(readOnlyRef.current || halvesBusy || !gen.genUrl || halvesCurrent) return;   // duplicate guard
    setActionErr("");
    if(uploadShapeOff){ setMenuOpen(false); setHalvesErr(SB_UPLOAD_SHAPE_MSG); return; }
    if(isComposed && readyRef.current.n < readyRef.current.total){
      setHalvesErr("Stage hand-off needs every required panel. This sheet is partial ("+
        readyRef.current.n+"/"+readyRef.current.total+" frames); generate the missing frames in the Shots tab first.");
      setMenuOpen(false);
      return;
    }
    // an OUT-OF-DATE sheet's halves would hand the Stage its old panels as current (2026-10-09)
    const _sm = (typeof nbGetMeta==="function") ? nbGetMeta(sid) : null;
    if(_sm && sbSheetStale(_sm, (page.shots||[]).map(x=>x.id))){
      setHalvesErr(isComposed ? "This sheet is out of date — Recompose it first (free), then its halves are saved with it."
        : "This uploaded sheet shows other shots than this page holds now — upload a sheet for these shots first.");
      setMenuOpen(false); return; }
    // a sheet drawn with "Frame not generated" panels (a frame that wouldn't load counts) never hands the Stage
    // placeholder panels (2026-10-09)
    if(_sm && _sm.composed && Number(_sm.missing)>0){
      setHalvesErr("This sheet was drawn with "+_sm.missing+" panel"+(_sm.missing===1?"":"s")+" missing — Recompose it (free) once every frame loads, then its halves are saved with it.");
      setMenuOpen(false); return; }
    // the film this click belongs to: a film switch while the halves save never writes into the other film
    const _ep = filmEpoch();
    setHalvesBusy(true); setHalvesDone(false); setHalvesErr("");
    try{
      await sbSaveHalves(gen.genUrl, sid, page, sheetVersion(), _ep, _sm, sheetAsp);
      if(_ep!=null && filmEpoch()!==_ep){ setHalvesBusy(false); return; }
      await loadHalves();
      setHalvesDone(true);
      setTimeout(()=>{ setHalvesDone(false); setMenuOpen(false); }, 1600);
    }catch(e){ setMenuOpen(false); setHalvesErr((e && e.code==="shape") ? e.message : ("Saving the halves failed — "+((e&&e.message)||e))); }
    setHalvesBusy(false);
  };
  // THE TWO HALVES STAY A PAIR (2026-10-05): restoring one restores the other too, so the Stage never
  // gets a top and a bottom cut from different sheet versions
  const restoreHalf = async (h)=>{
    if(typeof nbRevertAsset!=="function" || readOnlyRef.current) return;
    const _ep = filmEpoch();   // (2026-10-09) every write below belongs to the film this click was made in
    const sameFilm = ()=> _ep==null || filmEpoch()===_ep;
    // it brings back the earlier PAIR and the sheet version they were cut from — which the Stage then uses (2026-10-09)
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Restore the earlier halves?",
        body:"Both halves go back to their previous version, and the sheet they were cut from comes back on this page with them — the Stage then uses that version. The current ones stay in the version history.",
        confirmLabel:"Restore", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    if(!sameFilm()) return;
    setHalvesErr(""); setActionErr("");
    try{
      const r = await nbRevertAsset(sid+":half-"+h, 0);
      if(!r){ setHalvesErr("No earlier version of the "+h+" half to restore."); return; }
      if(!sameFilm()) return;
      const other = h==="top" ? "bottom" : "top";
      const srcV = String(((r && r.meta)||{}).sourceVersion||"");
      let r2 = null; if(halfNames.indexOf(other)>=0){ try{ r2 = await nbRevertAsset(sid+":half-"+other, 0); }catch(e){} }
      if(!sameFilm()) return;
      await loadHalves();
      if(srcV && halfNames.indexOf(other)>=0 && (!r2 || String(((r2 && r2.meta)||{}).sourceVersion||"")!==srcV)){
        setHalvesErr("The "+h+" half was restored, but the "+other+" half has no matching earlier version — re-save the halves from the ⋮ menu so both come from the same sheet.");
        return;
      }
      // sync the DISPLAYED SHEET to the version this half was cut from, so there's no
      // ambiguity about which sheet the restored half belongs to
      const srcVer = String(((r && r.meta)||{}).sourceVersion||"");
      if(!srcVer){ setHalvesErr("Half restored — but it predates version stamps, so the matching sheet version couldn't be shown."); return; }
      if(srcVer === sheetVersion()) return;   // the matching sheet is already on display
      const det = await gen.loadDetails();
      if(!sameFilm()) return;
      const hist = (det && det.history) || [];
      const idx = hist.findIndex(e=>{ const m=(e && e.meta)||{}; return String(m.iso||m.ts||m.version||"")===srcVer; });
      if(idx < 0){ setHalvesErr("Half restored — but the sheet version it was cut from is no longer in the sheet's history."); return; }
      await gen.revertTo(idx);
    }catch(e){ setHalvesErr("Couldn't restore the "+h+" half — "+((e&&e.message)||e)); }
  };
  const deleteHalf = async (h)=>{
    if(readOnlyRef.current) return;
    const _ep = filmEpoch();   // (2026-10-09) never deletes another film's half after a film switch
    let ok = true;
    if(typeof window.appConfirm==="function"){
      ok = await window.appConfirm({ title:"Delete the "+h+" half?",
        body:"Removes this saved half from your project (the Stage won't see it). The sheet itself is untouched — you can re-save halves anytime.",
        confirmLabel:"Delete", danger:true });
    }
    if(!ok) return;
    if(_ep!=null && filmEpoch()!==_ep) return;
    setHalvesErr(""); setActionErr("");
    try{ if(typeof nbClearAsset==="function") await nbClearAsset(sid+":half-"+h); }
    catch(e){ setHalvesErr("Couldn't delete the "+h+" half — "+((e&&e.message)||e)); return; }
    if(_ep!=null && filmEpoch()!==_ep) return;
    await loadHalves();
  };

  // ---- self-derivation: the sheet is a VIEW over the shot frames ----------------
  const isComposed = !!((gen.genMeta && gen.genMeta.composed) || ((typeof nbGetMeta==="function") && (nbGetMeta(sid)||{}).composed));
  const [panelBusy, setPanelBusy] = React.useState(false);
  // refs so the nb-gen-done listener (registered once per page) always sees fresh state
  const isComposedRef = React.useRef(isComposed); isComposedRef.current = isComposed;
  // ...or (2026-10-09) it was drawn with every frame and a frame it shows is now GONE (looked up, not a cold cache)
  const _smNow = sheetMetaNow();
  const frameGone = !!(isComposed && ready.checked && ready.n < ready.total && _smNow && Array.isArray(_smNow.shotIds) && typeof _smNow.missing==="number" && _smNow.missing===0);
  // why it is out of date — the banner names it (2026-10-09: a deleted frame was called "re-rendered")
  const staleWhy = (_smNow && Array.isArray(_smNow.shotIds) && !sbIdsEqual(_smNow.shotIds, shotIds)) ? "shots"
    : (frameGone || sbFramesGone(_smNow)) ? "deleted" : "frames";
  const sheetOutOfDate = !!(gen.genUrl && isComposed && (sbSheetStale(_smNow, shotIds) || frameGone));
  const panelBusyRef = React.useRef(panelBusy);   panelBusyRef.current = panelBusy;
  const composingRef = React.useRef(composing);   composingRef.current = composing;
  const readyRef     = React.useRef(ready);       readyRef.current = ready;
  const autoTimer    = React.useRef(null);
  const readOnlyRef  = React.useRef(readOnly);    readOnlyRef.current = readOnly;
  // OPEN AND OUT OF DATE (2026-10-05): a composed sheet whose panels' frames were re-rendered while
  // this scene wasn't open redraws itself once when it is (free) — it used to wait for the next render
  const staleTried = React.useRef(false);
  React.useEffect(()=>{ staleTried.current=false; },[sid]);
  React.useEffect(()=>{
    if(readOnly || staleTried.current || composing || !ready.n || !gen.genUrl || !isComposed) return;
    // a restored version stays until a frame changes after the restore (sbRestoreHeld — survives a remount)
    if(sbRestoreHeld(projectId, sid, page)) return;
    // a frame re-rendered, OR (2026-10-09) the page now holds other shots — both are free redraws
    const _m = sheetMetaNow();
    if(!(sbFramesChanged(_m) || (_m && Array.isArray(_m.shotIds) && !sbIdsEqual(_m.shotIds, shotIds)))) return;
    try{ if(sessionStorage.getItem("turn_sb_hold_"+sid)==="1") return; }catch(e){}
    staleTried.current = true;
    doComposeRef.current();
  },[gen.genUrl, ready.n, composing, isComposed, readOnly, shotIds.join(",")]);

  // lay the existing shot frames into the sheet grid with REAL text strips —
  // instant, zero generation cost, per-panel repair via the Shot List
  // opts.explicit: YOU asked (Recompose) — it may draw over an upload; the automatic composes never do.
  // A role that can't change the Art Room never composes, checked when it RUNS (2026-10-09)
  const doCompose = async (opts)=>{
    if(readOnlyRef.current) return;
    if(!readyRef.current.n) return;
    const explicit = !!(opts && opts.explicit);
    if(composingRef.current){
      // a compose is already running — still route this request into the coordinator
      // (fire-and-forget): it marks the active run superseded so it redraws with the
      // newest frames before committing, instead of this event being silently lost
      try{ const p = sbComposeSheet(scene, page, ctx, beatsMap,
          { aspect:sheetAsp, explicit });
        if(p && p.catch) p.catch(()=>{}); }catch(e){}
      return;
    }
    setComposing(true); setComposeErr("");
    try{
      // the shared coordinator serializes this sheet against bulk runs and other
      // mounted cards, redraws once if frames change mid-draw, and reports honestly
      const res = await sbComposeSheet(scene, page, ctx, beatsMap,
        { aspect:sheetAsp, explicit });
      if(res.status==="skipped")
        setComposeErr("The sheet couldn't be drawn from the shot frames — try regenerating the frames in the Shots tab, then compose again.");
      else if(res.status==="failed")
        setComposeErr("Compose failed — "+(res.error||"the sheet couldn't be saved. Try again."));
      // "composed" and "stale" (film switched) both end quietly — the coordinator
      // already fired the done event for the winning compose
    }catch(e){ setComposeErr("Compose failed — "+((e&&e.message)||e)); }
    setComposing(false);
  };
  const doComposeRef = React.useRef(doCompose); doComposeRef.current = doCompose;

  // PANEL HEALTH — the same lineage/provenance checks the Shot List runs, so the board
  // never presents a stale/unapproved frame as finished work. Computed on WARM data only
  // (each frame is awaited first): cold caches read "unverified", never "stale".
  const [health, setHealth] = React.useState(null);
  React.useEffect(()=>{
    let alive = true;
    const count = async ()=>{
      let n=0;
      const drafts = ((window.turnContinuity||{}).drafts)||{};
      const chain = (ctx.sceneShots && ctx.sceneShots.length) ? ctx.sceneShots : (page.shots||[]);
      const h = { total:(page.shots||[]).length, unrendered:0, approved:0, unapproved:0, staleSeed:0, staleSrc:0, oldLook:0 };
      for(const sh of (page.shots||[])){
        let u = (typeof nbGetImage==="function") ? nbGetImage(sh.id) : "";
        if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(sh.id); }catch(e){} }
        if(!u){ h.unrendered++; continue; }
        n++;
        if(sh.locked) h.approved++; else h.unapproved++;
        const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
        const st = (typeof shotAssetProvenanceStatus==="function") ? shotAssetProvenanceStatus(sh, drafts[sh.sceneId], m) : "unverified";
        const ov = (typeof shotSourceOverrideCurrent==="function") && shotSourceOverrideCurrent(sh, drafts[sh.sceneId]);
        if(st==="stale" && !ov) h.staleSrc++;
        if(typeof shotChainStatus==="function" && shotChainStatus(sh, chain, (x)=> (typeof nbGetMeta==="function") ? nbGetMeta(x) : null)==="stale") h.staleSeed++;
        if(m && typeof shotLookIsEarlier==="function" && shotLookIsEarlier(m.lookSig, ctx.project, scene.id)) h.oldLook++;   // made before the scene's look / film stock changed
      }
      if(alive){ setReady({ n, total:shotIds.length, checked:true }); setHealth(h); }
    };
    count();
    // a page shot's frame landed or RE-RENDERED (Shots tab, chain render, panel edit):
    // refresh the count, and if this sheet is a composed one, re-compose it around the
    // new frame — the board always mirrors the latest frames. Debounced: a chain render
    // delivers frames one by one. (Skipped while a panel edit owns the recompose, and
    // never self-triggers: the compose commit dispatches with the SHEET's id, not a shot's.)
    const onChange = (e)=>{ const d=(e&&e.detail)||{};
      // nb-gen-done carries a single id; nb-prefetched carries ids[] — filter on both,
      // otherwise every prefetch anywhere recounts every mounted page
      const _ids = Array.isArray(d.ids) ? d.ids : (d.id!=null ? [d.id] : []);
      if(_ids.length && !_ids.some(x=>shotIds.indexOf(x)>=0)) return;
      count();
      if(d.id && isComposedRef.current && !panelBusyRef.current && !readOnlyRef.current){
        clearTimeout(autoTimer.current);
        autoTimer.current = setTimeout(()=>{ doComposeRef.current(); }, 900);
      }
    };
    window.addEventListener("nb-gen-done", onChange);
    window.addEventListener("nb-prefetched", onChange);
    return ()=>{ alive=false; clearTimeout(autoTimer.current);
      window.removeEventListener("nb-gen-done", onChange); window.removeEventListener("nb-prefetched", onChange); };
  },[(page.shots||[]).map(s=>s.id+":"+(s.locked?1:0)).join(","), sbDraftSig(scene),   // a redraft of the scene's script (2026-10-18)
     (typeof shotLookSig==="function" && scene) ? shotLookSig(ctx.project, scene.id) : ""]);   // approve/unapprove, and a look change on Color (2026-10-08), refresh health

  // FIRST VIEW: a scene whose frames already exist gets its sheet composed
  // automatically — the board builds itself from the shot chain. A Clear in this tab
  // session holds the auto-compose off (sessionStorage) so it never fights the user.
  const autoTried = React.useRef(false);
  React.useEffect(()=>{ autoTried.current=false; },[sid]);
  React.useEffect(()=>{
    if(readOnly) return;   // a view-only viewer never writes a board (2026-10-05)
    if(gen.genUrl || !ready.n || composing || autoTried.current) return;
    try{ if(sessionStorage.getItem("turn_sb_hold_"+sid)==="1") return; }catch(e){}
    autoTried.current = true;
    doComposeRef.current();   // (an upload that hadn't loaded yet is kept — sbComposeSheet loads the sheet first)
  },[gen.genUrl, ready.n, composing, readOnly]);

  // ---- per-panel repair --------------------------------------------------------
  // Edit the underlying SHOT FRAME (same language as the Shots tab's edit), then
  // recompose; the Shots card adopts the new frame too. Composed sheets only —
  // an uploaded sheet has no per-shot frames to edit through.
  // the panel is tracked by its SHOT ID (2026-10-09, owner — Storyboards review): a redraw after a collaborator's
  // change moves panels, and an index would then edit another shot
  const [panelEdit, setPanelEdit] = React.useState(null);   // {shotId:string|null, text:string} | null
  const [panelErr, setPanelErr] = React.useState("");
  const panelShot = (panelEdit && panelEdit.shotId!=null) ? ((page.shots||[]).find(x=>String(x.id)===String(panelEdit.shotId))||null) : null;
  const panelPos = panelShot ? (page.shots||[]).indexOf(panelShot) : -1;
  // the panel edit's result is kept when you page away mid-edit — as a toast (2026-10-09)
  const panelReport = (msg, kind)=>{
    if(mountedRef.current){ if(kind!=="ok") setPanelErr(msg); return; }
    if(typeof window.appToast==="function") window.appToast("Scene "+scene.no+" storyboard — "+msg, kind==="ok" ? "ok" : "error");
  };
  // the edit's engine and quality — what it sends AND what its price chip shows (2026-10-09: the chip priced the
  // picker's quality at the picker's aspect, not the forced "medium" at the sheet's format)
  const panelEditEngine = ()=>{
    const model = typeof nbGetModel==="function" ? nbGetModel() : undefined;
    const quality = /^gpt-image-2\.5-/.test(model||"") && typeof nbGetOaiQuality==="function" ? nbGetOaiQuality(model) : "medium";
    return { model, quality };
  };
  // may this role change a shot frame? (it saves shots, which an Art Room role without that right can't)
  const canEditFrames = ()=> !readOnlyRef.current && !(typeof window.turnCanMutateShots==="function" && !window.turnCanMutateShots());
  const applyPanelEdit = async ()=>{
    if(!panelEdit || panelEdit.shotId==null || !panelEdit.text.trim() || panelBusy || composing || !isComposed) return;
    if(!canEditFrames()){ setPanelErr("Your role can't change shot frames on this film."); return; }
    if(sheetOutOfDate){ setPanelErr("This sheet shows other panels than the page holds now \u2014 Recompose it first, then edit a panel."); return; }
    const text = panelEdit.text.trim();
    const sh = (page.shots||[]).find(x=>String(x.id)===String(panelEdit.shotId));
    if(!sh){ setPanelErr("That panel isn't on this page any more \u2014 pick a panel again."); setPanelEdit(p=>p ? { ...p, shotId:null } : p); return; }
    // an APPROVED frame is a continuity seed: editing it unapproves it — asked, not just noted (2026-10-09)
    if(sh && sh.locked && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Edit an approved frame?",
        body:sbPanelLabel(sh)+"'s frame is approved and later shots may be seeded from it. Editing it (one image edit) unapproves it until you approve it again in Shots.",
        confirmLabel:"Edit it", cancelLabel:"Cancel" });
      if(!ok) return;
    }
    const { model:requestedModel, quality:requestedQuality } = panelEditEngine();
    // never race the Shots tab: if this shot is generating right now (chain run,
    // manual render), a second writer would double-commit — refuse up front
    if(!window.__nbGenInflight) window.__nbGenInflight = {};
    if(window.__nbGenInflight[sh.id]){
      setPanelErr("That shot is rendering right now in the Shots tab — wait for it to finish, then edit the panel."); return;
    }
    // FIRST-CLASS RUN: claim the shot in the shared inflight registry BEFORE any await,
    // so a Shots tab / batch render (and a double-tap on Apply) sees this edit and
    // refuses to start a competing writer. Token-owned: only this run may clear it,
    // and a takeover (cancel + newer render) is detected by the token changing.
    const _tok = "sbpanel-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    window.__nbGenInflight[sh.id] = _tok;
    const _own = ()=> !!(window.__nbGenInflight && window.__nbGenInflight[sh.id]===_tok);
    const _release = ()=>{ if(_own()) delete window.__nbGenInflight[sh.id]; };
    try{ window.dispatchEvent(new CustomEvent("nb-gen-start",{ detail:{ id:sh.id } })); }catch(e){}
    // film scope at edit start — entity ids repeat across films, and a project switch
    // during the model await must NOT commit these pixels into the other film's shot
    const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;
    setPanelErr("");
    setPanelBusy(true);
    try{
      const identityOpts = panelIdentityOpts();
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity(identityOpts,"storyboard-panel-edit-start");
      if(typeof window.nbRequireImageQuality==="function") await window.nbRequireImageQuality(requestedModel,requestedQuality);
      if(!_own()) return;
      if(_ep!=null && typeof nbEpoch==="function" && nbEpoch()!==_ep)
        throw new Error("Film changed before render; nothing was rendered.");
      let frame = (typeof nbGetImage==="function") ? nbGetImage(sh.id) : "";
      if(!frame && typeof nbLoadImage==="function"){ try{ frame = await nbLoadImage(sh.id); }catch(e){} }
      if(!frame) throw new Error("This panel has no frame yet — generate it in the Shots tab first.");
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity(panelIdentityOpts(),"storyboard-panel-edit-after-frame");
      const prompt = "Edit this film frame. Apply ONLY this change: "+text+". "
        +"Everything the instruction does NOT name stays IDENTICAL to the reference — the same characters "
        +"(identical faces & wardrobe), the same location and set, the same lighting and colour grade, and "
        +"(unless the instruction changes them) the same shot size, lens and staging. Do not re-imagine the frame.";
      // GPT Image 2.5 uses the captured quality choice.
      const extra = [];
      for(const rid of editRefSel){ let u=(typeof nbGetImage==="function")?nbGetImage(rid):"";
        if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(rid); }catch(e){} } if(u) extra.push(u); }
      const submitIdentity = panelIdentityOpts();
      if(typeof window.nbAssertIdentityAssetFresh==="function"){
        for(const rid of editRefSel){
          const owner=submitIdentity.identityCast.find(c=>String(rid)===String(c&&c.id)
            || String(rid).indexOf(String(c&&c.id)+":")===0);
          if(owner) window.nbAssertIdentityAssetFresh(rid,owner,submitIdentity.identityContext);
        }
      }
      const identityPrompt = submitIdentity.identityCast.length && typeof window.turnIdentityPrompt==="function"
        ? String(window.turnIdentityPrompt(submitIdentity.identityCast)||"").trim() : "";
      const promptWithIdentity = identityPrompt
        ? prompt+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identityPrompt : prompt;
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity(submitIdentity,"storyboard-panel-edit-before-submit");
      const url = await nbGenerate(promptWithIdentity + (extra.length?" Additional reference images are attached (character sheets / location plate) — match those identities and that exact set faithfully.":""),
        { referenceImage:frame, aspectRatio:sheetAsp, model:requestedModel, quality:requestedQuality,
          ...submitIdentity, ...(extra.length?{extraImages:extra}:{}), assetId:sh.id,
          noRetry:true });   // a paid edit is never re-sent on its own (2026-10-09)
      const afterProviderIdentity = panelIdentityOpts();
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity(afterProviderIdentity,"storyboard-panel-edit-after-provider");
      // ownership re-check after the long model await: if a newer run took the shot
      // over (a cancel released our token, then a Shots tab render claimed it), that
      // render is the newer intent — discard this edit; the newer owner's events
      // drive the UI, not ours, so no cancel event is fired here
      if(!_own()){
        panelReport("That shot started a new render while the edit ran — this edit was discarded so it can't overwrite the newer frame.");
        setPanelBusy(false); return;
      }
      const prior = (typeof nbGetMeta==="function") ? (nbGetMeta(sh.id)||{}) : {};
      const now = new Date();
      const finalIdentity = panelIdentityOpts();
      const meta = { ...prior, mode:"edit", editInstruction:text, prompt:promptWithIdentity,
        ...(requestedModel?{modelId:requestedModel,
          modelLabel:((window.NB_MODELS||[]).find(m=>m.id===requestedModel)||{}).label||requestedModel,
          quality:/^gpt-image/.test(requestedModel)?requestedQuality:null}:{}),
        identityCharacterIds:finalIdentity.identityCharacterIds,
        identitySnapshots:finalIdentity.identityCast.map(c=>typeof window.nbIdentitySnapshot==="function" ? window.nbIdentitySnapshot(c) : null).filter(Boolean),
        identitySnapshot:finalIdentity.identityCast[0]&&typeof window.nbIdentitySnapshot==="function"
          ? window.nbIdentitySnapshot(finalIdentity.identityCast[0]) : undefined,
        date:now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
        time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
        iso:now.toISOString(), version:((prior.version||1)+1) };
       if(typeof window.nbAssertMediaIdentity==="function")
         window.nbAssertMediaIdentity(finalIdentity,"storyboard-panel-edit-before-commit");
       if(!canEditFrames()) throw new Error("Your role changed while the edit ran \u2014 the frame wasn't changed.");
       const r = (typeof nbCommit==="function") ? await nbCommit(sh.id, url, meta, [{kind:"edit",label:"Previous frame (edited)",url:frame}], "shot", _ep) : null;
      if(r && r.tier==="stale"){   // film switched mid-edit: quiet discard (no result event)
        _release();
        try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id:sh.id } })); }catch(e){}
        setPanelEdit(null); setPanelBusy(false); return;
      }
      // a failed save is a FAILED edit — never unlock the shot or announce new pixels
      // that a reload would lose (the catch below releases the token and shows this)
      if(!r || r.tier==="error")
        throw new Error("The repaired frame couldn't be saved — nothing was changed. Check your connection and apply the edit again.");
      _release();
      // the pixels changed: this frame is no longer an APPROVED seed — un-approve it so
      // the continuity gate holds (re-approve from the shot image's Options menu once
      // you're happy)
      if(sh.locked && typeof onUpdateShot==="function") onUpdateShot(sh.id, { locked:false, sourceOverride:null });
      window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:sh.id, url:(r&&r.url)||url } }));
      setPanelEdit(null);
      await doCompose({ explicit:true });   // rebuild the sheet with the repaired panel
      if(!mountedRef.current) panelReport(sbPanelLabel(sh)+"'s frame was edited and the sheet redrawn with it.", "ok");
    }catch(e){
      _release();
      try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id:sh.id } })); }catch(err){}
      panelReport((e&&e.message)||"Edit failed.");
    }
    setPanelBusy(false);
  };

  const [menuOpen,setMenuOpen]=React.useState(false);
  const [detailsOpen,setDetailsOpen]=React.useState(false);
  const menuRef=React.useRef(null);
  React.useEffect(()=>{ if(!menuOpen) return;
    const h=(e)=>{ if(menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h); },[menuOpen]);

  const name = (scene.title||("Scene "+scene.no))+" — storyboard sheet";
  // upload a finished storyboard sheet from the machine (made elsewhere) — reuses the
  // shared importSheet so it commits to this sheet's slot at full resolution.
  const sbUploadRef = React.useRef(null);
  // (2026-10-09) nothing that replaces or removes the sheet runs while it is being drawn or uploaded — a
  // compose would commit after it and bring the sheet back (any card, Compose all, a panel edit)
  const sheetBusy = !!(composing || bulkBusy || panelBusy || gen.gening);
  const busyNow = ()=> !!(composingRef.current || panelBusyRef.current || gen.gening || sbComposeRunning(sid));
  const pickUpload = ()=>{ if(readOnlyRef.current) return;
    if(busyNow()){ setActionErr("This sheet is being composed — wait for it to finish, then upload."); return; }
    if(sbUploadRef.current) sbUploadRef.current.click(); };
  const onUploadPicked = (e)=>{ const f=e.target.files&&e.target.files[0]; if(f && gen.importSheet && !readOnlyRef.current) gen.importSheet(f); e.target.value=""; };
  // CLEAR SAYS WHAT IT DOES (2026-10-09, owner — Storyboards review): it permanently deletes the sheet, its
  // earlier versions and its two Stage halves (the copy said the history stayed); it asks whenever an upload
  // or saved halves would go, and both halves are always cleared (they were left behind if not loaded yet).
  // It waits for the sheet's own clear: a failed one says why (on the sheet) and leaves the halves alone, and
  // it belongs to the film it was pressed in (2026-10-09)
  const clearSheet = async ()=>{ if(readOnlyRef.current) return; setMenuOpen(false); setActionErr("");
    if(busyNow()){ setActionErr("This sheet is being composed — wait for it to finish, then Clear."); return; }
    const _ep = filmEpoch();
    const hasHalves = !!(halves.top || halves.bottom);
    if((!isComposed || hasHalves) && typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title: !isComposed ? "Clear this uploaded sheet?" : "Clear this sheet and its halves?",
        body:(!isComposed ? "It was uploaded, so it can't be rebuilt from the shot frames. " : "")
          +"Clearing permanently deletes the sheet and its earlier versions"+(hasHalves ? ", and the two halves the Stage uses for its clips (the Stage falls back to each clip's own frames)" : "")+"."
          +(isComposed ? " You can compose it again from the shot frames for free." : ""),
        confirmLabel:"Clear sheet", cancelLabel:"Keep it", danger:true });
      if(!ok) return;
    }
    if(_ep!=null && filmEpoch()!==_ep) return;
    if(busyNow()){ setActionErr("This sheet is being composed — wait for it to finish, then Clear."); return; }
    // hold off the auto-compose for the rest of this tab session, so Clear sticks
    try{ sessionStorage.setItem("turn_sb_hold_"+sid,"1"); }catch(e){}
    const cleared = await gen.clearGen();
    if(!cleared){ try{ sessionStorage.removeItem("turn_sb_hold_"+sid); }catch(e){} return; }   // gen.genErr says why
    if(_ep!=null && filmEpoch()!==_ep) return;
    let halvesFailed = false;
    if(typeof nbClearAsset==="function"){ for(const h of ["top","bottom"]){ try{ await nbClearAsset(sid+":half-"+h); }catch(e){ halvesFailed = true; } } }
    try{ window.dispatchEvent(new CustomEvent("sb-sheet-cleared",{ detail:{ id:sid } })); }catch(e){}
    if(halvesFailed) setActionErr("The sheet was cleared, but its halves couldn't be deleted — delete them under Saved halves below.");
    await loadHalves(); };
  // the sheet's error strip: a compose / halves failure, a refused action, or a failed upload or Clear (B3, 2026-10-09)
  const stripErr = composeErr || halvesErr || actionErr || gen.genErr || "";
  const stripRetry = !readOnly && (composeErr ? "compose" : (halvesErr && /^Saving the halves failed/.test(halvesErr)) ? "halves" : "");
  const shownHalves = halfNames.filter(h=>halves[h]);
  const sheetAlt = "Scene "+scene.no+" storyboard, page "+((page.index||0)+1);
  const engine = panelEditEngine();
  const [canonOpen, setCanonOpen] = React.useState(false);   // the scene canon folds to one line (2026-10-23)
  return _sbEl("div",{className:"sb-comp","data-sbsheet":page.id},
    _sbEl("input",{type:"file",accept:"image/png,image/jpeg,image/webp,image/avif",ref:sbUploadRef,style:{display:"none"},onChange:onUploadPicked}),
    // (2026-10-23, option A) the sheet's health sits on top of it, in one row
    /* PANEL HEALTH strip — same chips as the Shots tab's chain strip, so a sheet never
       reads as finished while its panels are unrendered, unapproved or stale */
    health && !!health.total && _sbEl("div",{className:"ssx-chain-strip sb-health"},
      _sbEl("span",{className:"ssx-chain-chip"+((health.approved===health.total)?" ok":""),
        title:"Approved frames are the verified, locked panels — use Approve frame as seed in the shot image's Options menu."},
        health.approved+"/"+health.total+" approved"),
      health.unrendered>0 && _sbEl("span",{className:"ssx-chain-chip warn",
        title:"Panels with no generated frame yet — they print as empty placeholders."},
        health.unrendered+" unrendered"),
      health.staleSeed>0 && _sbEl("span",{className:"ssx-chain-chip warn",
        title:"Frames whose continuity source has since changed — 'Render Scene in order' in Shots re-renders them."},
        health.staleSeed+" frame"+(health.staleSeed===1?" needs":"s need")+" continuity refresh"),
      health.staleSrc>0 && _sbEl("span",{className:"ssx-chain-chip warn",
        title:"Frames rendered before their shot specification or screenplay beat changed — regenerate in the Shots tab."},
        health.staleSrc+" frame"+(health.staleSrc!==1?"s need":" needs")+" source refresh"),
      health.oldLook>0 && _sbEl("span",{className:"ssx-chain-chip warn",
        title:"These frames were made before the scene's colour look or the film stock changed in the Color tab — regenerate them in the Shots tab for the new look."},
        health.oldLook+" frame"+(health.oldLook===1?"":"s")+" made with an earlier look"),
      !health.unrendered && !health.staleSeed && !health.staleSrc && !health.oldLook && health.approved===health.total &&
        _sbEl("span",{className:"ssx-chain-chip ok"},"Sheet solid")),
    _sbEl("div",{className:"sb-comp-frame"},
      gen.genUrl && _sbEl("div",{className:"sheet-tools-menu sb-tpanel-menu",ref:menuRef,
          // the menu closes when keyboard focus leaves it (2026-10-09)
          onBlur:(e)=>{ if(menuOpen && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false); }},
        _sbEl("button",{type:"button",className:"sb-tpanel-opts"+(menuOpen?" on":""),onClick:()=>setMenuOpen(m=>!m),title:"Options","aria-label":"Sheet options",
          "aria-haspopup":"true","aria-expanded":menuOpen?"true":"false",onKeyDown:(e)=>{ if(e.key==="Escape" && menuOpen){ e.preventDefault(); e.stopPropagation(); setMenuOpen(false); } }}, _sbEl(Icon.moreV,{s:14})),
        menuOpen && _sbEl("div",{className:"sheet-tools-dropdown",role:"group","aria-label":"Sheet options",
          onKeyDown:(e)=>{ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); setMenuOpen(false); } }},
          _sbEl("button",{className:"sheet-tools-item",onClick:()=>{ onView({url:gen.genUrl,character:{name}}); setMenuOpen(false); }}, _sbEl(Icon.eye,{s:14}),"View full"),
          // a view-only role SEES the board (it pages, views and exports it) but changes nothing: the version
          // history (Details: restore / delete) and every changing item stay out of its menu (2026-10-09)
          !readOnly && _sbEl("button",{className:"sheet-tools-item",onClick:()=>{ setDetailsOpen(true); setMenuOpen(false); }}, _sbEl(Icon.info,{s:14}),"Details"),
          !readOnly && _sbEl("button",{className:"sheet-tools-item "+(panelEdit?"on":""), disabled:!isComposed||sheetOutOfDate||!canEditFrames(),
            title: !isComposed ? "Panel repair needs a composed sheet (it edits the shot's frame) — this sheet was uploaded or painted elsewhere"
              : sheetOutOfDate ? "This sheet shows other panels than the page holds now — Recompose it first (free)"
              : "Edit one panel (an image edit, priced on Apply) — the change is applied to that shot's frame, then the sheet recomposes",
            onClick:()=>{ if(!isComposed || sheetOutOfDate) return; setPanelEdit(panelEdit?null:{shotId:null,text:""}); setPanelErr(""); setMenuOpen(false); }},
            _sbEl(Icon.grid,{s:14}), panelEdit?"Close panel edit":"Edit a panel…"),
          !readOnly && _sbEl("button",{className:"sheet-tools-item",disabled:composing||!ready.n,
            title: ready.n ? "Recompose the sheet from the shots' current frames" : "No shot frames to compose from",
            onClick:()=>{ doCompose({ explicit:true }); setMenuOpen(false); }}, _sbEl(Icon.board,{s:14}),"Recompose from frames"),
          !readOnly && _sbEl("button",{className:"sheet-tools-item",disabled:sheetBusy,
            title: sheetBusy ? "Wait for the sheet to finish composing" : "Upload a finished sheet made elsewhere in place of this one",
            onClick:async ()=>{ setMenuOpen(false);
              // replacing a COMPOSED sheet turns off panel repair and the automatic redraws for it — say so (2026-10-09)
              if(isComposed && typeof window.appConfirm==="function"){
                const ok = await window.appConfirm({ title:"Replace this sheet with an upload?",
                  body:"Your upload replaces the composed sheet (it stays in the version history). An uploaded sheet isn't redrawn when frames change, and its panels can't be repaired here.",
                  confirmLabel:"Choose a file", cancelLabel:"Cancel" });
                if(!ok) return; }
              pickUpload(); }}, _sbEl(Icon.image,{s:14}),"Replace with upload"),
          !readOnly && _sbEl("button",{className:"sheet-tools-item"+((halvesDone||halvesCurrent)?" on":""),disabled:!gen.genUrl||halvesBusy||halvesCurrent||uploadShapeOff,
            title: uploadShapeOff ? SB_UPLOAD_SHAPE_MSG
              : halvesCurrent
              ? "Both halves of this sheet version are already saved — recompose or edit the sheet to re-save"
              : "Split the sheet horizontally and save BOTH halves to your project (cloud) — on a 2×2 sheet each half is one panel row (two frames side by side), ready for the Stage's video generation",
            onClick:saveHalves},
            _sbEl(Icon.download,{s:14}),
            halvesBusy?"Saving halves…"
              :halvesDone?"Halves saved ✓"
              :halvesCurrent?"Halves saved (current)"
              :(halves.top||halves.bottom)?"Re-save halves (sheet changed)"
              :"Save halves (for the Stage)"),
          !readOnly && _sbEl("div",{className:"sheet-tools-divider"}),
          !readOnly && _sbEl("button",{className:"sheet-tools-item danger",disabled:sheetBusy,
            title: sheetBusy ? "Wait for the sheet to finish composing" : undefined,onClick:clearSheet}, _sbEl(Icon.x,{s:14}),"Clear"))),
      gen.genUrl
        ? _sbEl("img",{className:"sb-comp-img",src:gen.genUrl,alt:sheetAlt,loading:"lazy",onClick:()=>onView({url:gen.genUrl,character:{name}})})
        : (composing || gen.gening)
          ? _sbEl("div",{className:"sb-comp-empty",style:{cursor:"default"}},
              _sbEl("span",{className:"ns-spin"}),_sbEl("span",null, gen.gening ? "Uploading sheet…" : "Composing sheet…"))
          : readOnly
          ? _sbEl("div",{className:"sb-comp-empty",style:{cursor:"default"}},
              _sbEl(Icon.board,{s:16}),_sbEl("span",null,"No sheet yet"))
          : _sbEl("div",{className:"sb-comp-choices"},
              _sbEl("button",{className:"sb-comp-choice primary",onClick:()=>doCompose(),disabled:!ready.n,
                title: ready.n ? "Lay the shots' generated frames into the sheet — instant, free, real text strips"
                               : "No shot frames yet — generate frames in the Shots tab; the sheet composes itself"},
                _sbEl(Icon.board,{s:16}),_sbEl("span",null,"Compose from shot frames"),
                _sbEl("span",{className:"sb-comp-empty-sub"}, ready.n+" of "+ready.total+" frames ready · instant · free")),
              _sbEl("button",{className:"sb-comp-choice",onClick:pickUpload,disabled:sheetBusy,
                title:"Import a finished storyboard sheet you made elsewhere at full resolution"},
                _sbEl(Icon.image,{s:16}),_sbEl("span",null,"Upload a sheet"),
                _sbEl("span",{className:"sb-comp-empty-sub"}, "from your computer · full resolution"))),
      (composing||panelBusy||gen.gening) && gen.genUrl && _sbEl("div",{className:"sb-tpanel-spin"},
        _sbEl("span",{className:"ns-spin"}),
        _sbEl("span",{className:"sb-spin-lab"},
          panelBusy ? "Editing panel — regenerating that shot's frame…"
          : gen.gening ? "Uploading sheet…"
          : "Composing sheet from shot frames…")),
      /* the page's shots changed since this sheet was composed: it shows other panels, and
         the Stage won't use it (or its halves) until it is recomposed — a free redraw */
      sheetOutOfDate && !composing && !composeErr && _sbEl("div",{className:"sb-sheet-err sb-sheet-stale"},
        _sbEl(Icon.alert,{s:14}),
        _sbEl("span",{className:"sb-sheet-err-msg"}, staleWhy==="shots"
          ? "The shots on this page changed since this sheet was composed, so it shows the wrong panels. The Stage won’t use it until you recompose it (free)."
          : staleWhy==="deleted"
          ? "A panel’s frame was deleted since this sheet was composed, so it still shows that frame. The Stage won’t use it until you recompose it (free)."
          : "A panel’s frame was re-rendered since this sheet was composed, so it shows the old image. The Stage won’t use it until you recompose it (free)."),
        !readOnly && _sbEl("div",{className:"sb-sheet-err-acts"},
          _sbEl("button",{className:"sb-sheet-err-btn primary",onClick:()=>doCompose({ explicit:true }),disabled:!ready.n},"Recompose"))),
      /* compose / halves / upload / Clear failed or was refused: show the REAL message on the sheet (not a
         hover-only icon), plus the way out — retry the failed action, or dismiss a plain message (2026-10-09:
         a refused Save halves was hidden while halves existed; a failed upload or Clear said nothing) */
      stripErr && !composing && !halvesBusy && _sbEl("div",{className:"sb-sheet-err",role:"alert"},
        _sbEl(Icon.alert,{s:14}),
        _sbEl("span",{className:"sb-sheet-err-msg"}, stripErr),
        _sbEl("div",{className:"sb-sheet-err-acts"},
          stripRetry && _sbEl("button",{className:"sb-sheet-err-btn primary",
            onClick:()=>{ if(stripRetry==="halves"){ saveHalves(); } else { doCompose({ explicit:true }); } }},
            "Try again"),
          !stripRetry && (halvesErr || actionErr) && _sbEl("button",{className:"sb-sheet-err-btn",
            onClick:()=>{ setHalvesErr(""); setActionErr(""); }}, "Dismiss")))),
    /* SCENE CANON — the master designs this scene locks to, as small thumbnails (click
       to enlarge). These are the scene-wide reference sheets, NOT a per-frame input
       list — each panel's actual render inputs are in its beat & shot brief below. */
    // folded to one line (2026-10-23): "Scene canon · N reference sheets"
    refImgs.length>0 && _sbEl("div",{className:"shot-refs sb-refs"+(canonOpen?" open":"")},
      _sbEl("button",{type:"button",className:"shot-refs-lab sb-canon-toggle","aria-expanded":canonOpen?"true":"false",onClick:()=>setCanonOpen(o=>!o),
          title:"The Character, Prop & Location designs this scene locks to (each panel's own render inputs are in its beat & shot brief)"},
        _sbEl(canonOpen?Icon.chevD:Icon.chevR,{s:12}), _sbEl(Icon.layers,{s:12}),
        "Scene canon \u00b7 "+refImgs.length+" reference sheet"+(refImgs.length!==1?"s":"")),
      canonOpen && _sbEl("div",{className:"shot-refs-row"},
        refImgs.map((r,i)=> _sbEl("button",{key:"a"+i,className:"shot-ref-thumb "+r.kind,
          title:r.label+" — click to enlarge", onClick:()=>onView&&onView({ url:r.url, character:{ name:r.label } })},
          _sbEl("img",{src:r.url,alt:r.label,loading:"lazy"}))))),

    // an upload that isn't shaped like a 2×2 sheet: no halves are made from it (owner decision 2026-10-09)
    uploadShapeOff && _sbEl("div",{className:"sb-halves-err"}, _sbEl(Icon.alert,{s:12}), SB_UPLOAD_SHAPE_MSG),

    /* saved halves — the Stage's video-gen hand-off, managed in place: view, restore
       the previous saved version, or delete. Stale halves (cut from an older sheet
       version) say so and point at the ⋮ menu's re-save. A page of one or two panels
       has only a top half. */
    shownHalves.length>0 && _sbEl("div",{className:"sb-halves"},
      _sbEl("button",{className:"sb-halves-head",onClick:()=>setHalvesOpen(o=>!o),
        "aria-expanded":halvesOpen?"true":"false",
        title: halvesOpen?"Hide the saved halves":"Show the saved halves"},
        _sbEl("span",{className:"sb-halves-chev"+(halvesOpen?" open":"")}, _sbEl(Icon.chevR,{s:12})),
        _sbEl(Icon.board,{s:12}),
        "Saved halves ("+shownHalves.length+") — the Stage's video-gen hand-off",
        !halvesCurrent && _sbEl("span",{className:"sb-halves-stale"},"· cut from an older sheet version — re-save from the ⋮ menu")),
      halvesOpen && _sbEl("div",{className:"sb-halves-row"},
        shownHalves.map(h=> _sbEl("div",{key:h,className:"sb-half"},
          _sbEl("button",{type:"button",className:"sb-half-view",title:"View the "+h+" half full size","aria-label":"View the "+h+" half full size",
            onClick:()=>onView({url:halves[h].url,character:{name:name+" — "+h+" half"}})},
            _sbEl("img",{src:halves[h].url,alt:sheetAlt+", "+h+" half",loading:"lazy"})),
          _sbEl("div",{className:"sb-half-meta"},
            _sbEl("span",{className:"sb-half-tag"},h.toUpperCase()),
            !readOnly && _sbEl("button",{className:"sb-half-btn",onClick:()=>restoreHalf(h),
              title:"Restore the halves' previous saved version (both halves together) — the sheet on display switches to the sheet version they were cut from"},"Restore"),
            !readOnly && _sbEl("button",{className:"sb-half-btn danger",onClick:()=>deleteHalf(h),
              title:"Delete this saved half from the project — the sheet itself is untouched"},"Delete")))))),

    // per-panel repair: pick the panel (by its shot), describe the change
    panelEdit && gen.genUrl && !readOnly && _sbEl("div",{className:"sheet-edit-panel sb-panel-edit"},
      _sbEl("div",{className:"sb-panel-chips"},
        page.shots.map((sh)=> _sbEl("button",{key:sh.id,
          className:"sb-panel-chip"+(panelShot===sh?" on":""), type:"button", "aria-pressed":panelShot===sh?"true":"false",
          title:(typeof shotGrammarLabel==="function")?shotGrammarLabel(sh):"",
          onClick:()=>{ setPanelEdit(p=>({ ...p, shotId:sh.id })); setPanelErr(""); }},
          sbPanelLabel(sh),
          _sbEl("span",{className:"sb-panel-chip-sub"},(typeof shotSizeOf==="function")?shotSizeOf(sh.size).label:(sh.size||""))))),
      panelShot && panelShot.locked &&
        _sbEl("div",{className:"sb-panel-note"},
          "This frame is APPROVED (it seeds later shots). Applying an edit changes its pixels, so it un-approves — use Approve frame as seed in the shot image's Options menu once you're happy."),
      panelShot && _sbEl("input",{className:"sheet-edit-input",type:"text",autoFocus:true,
        "aria-label":"Change to "+sbPanelLabel(panelShot)+"'s frame",
        placeholder:"Change panel "+scene.no+"."+((page.start||0)+panelPos+1)+" — edits that shot's frame, then recomposes (⌘/Ctrl+Enter applies)…",
        value:panelEdit.text,onChange:e=>setPanelEdit(p=>({ ...p, text:e.target.value })),
        // a paid edit: a stray Enter no longer spends it — ⌘/Ctrl+Enter (or the button) applies (2026-10-05)
        onKeyDown:e=>{ if(e.key==="Enter" && (e.metaKey||e.ctrlKey)){ e.preventDefault(); applyPanelEdit(); } if(e.key==="Escape") setPanelEdit(null); }}),
      panelErr && _sbEl("div",{className:"sb-panel-err"}, _sbEl(Icon.alert,{s:12}), panelErr),
      editRefChips("panel-edit-refs"),
      _sbEl("div",{className:"sheet-edit-acts"},
        _sbEl("button",{className:"sheet-edit-apply",disabled:!panelShot||!panelEdit.text.trim()||panelBusy||composing,
          onClick:applyPanelEdit},
          _sbEl(Icon.wand,{s:12}), panelBusy?"Editing panel…":"Apply to panel",
          // the one paid action in this tab — one image edit of that shot's frame, priced as it is sent:
          // its engine and quality, the sheet's format, the frame plus any references you attach (2026-10-09)
          !panelBusy && typeof window.nbCostChip==="function" && window.nbCostChip(1, { model:engine.model, quality:engine.quality,
            aspect:sheetAsp, refs:1+editRefSel.length })),
        _sbEl("button",{className:"sheet-edit-cancel",onClick:()=>setPanelEdit(null)},"Cancel"))),
    detailsOpen && !readOnly && ReactDOM.createPortal(_sbEl(window.SheetDetails,{ gen, name, noun:"sheet",extraMeta:sbHalfDateDetails(halves),
      onClose:()=>setDetailsOpen(false), onView:(url)=>onView({url,character:{name}}) }), document.body));
}

/* one scene PAGE = a storyboard SHEET: a header bar + the composed sheet image,
   plus a beat-briefs expander. */
function StoryboardPage({ project, scene, page, pageCount, ctx, beatsMap, onView, jumpToShot, onUpdateShot, readOnly=false, bulkBusy=false }){
  /* OPTION A (owner 2026-10-23): the sheet leads; ONE panel's beat & shot brief sits beside it (pick the panel above it) */
  const [panelIdx, setPanelIdx] = React.useState(0);
  const pIdx = Math.min(panelIdx, Math.max(0, (page.shots||[]).length-1));
  return _sbEl("div",{className:"sb-page-a"},
  _sbEl("div",{className:"sb-sheet","data-sbpage":page.id},
    _sbEl("div",{className:"sb-sheet-head"},
      _sbEl("span",{className:"sb-sheet-hi"}, _sbEl("b",null,"PROJECT: "), (project&&project.title)||"Untitled film"),
      _sbEl("span",{className:"sb-sheet-hi"}, _sbEl("b",null,"SCENE: "), String(scene.no).padStart(2,"0")),
      _sbEl("span",{className:"sb-sheet-hi"}, _sbEl("b",null,"TITLE: "), scene.title||"Untitled scene"),
      _sbEl("span",{className:"sb-sheet-hi page"}, _sbEl("b",null,"PAGE: "), (page.index+1)+" of "+pageCount)),
    _sbEl(StoryboardComposite,{ scene, page, ctx, beatsMap, onView, onUpdateShot, readOnly, bulkBusy })),

    // the panel's full detail — Shots tab fields + Writers' Room beat subtext + the final frame prompt
    _sbEl("aside",{className:"sb-side","aria-label":"Beat & shot brief"},
      _sbEl("div",{className:"sb-side-head"},
        _sbEl("span",{className:"loc-slate-lab"},"Beat & shot brief"),
        (page.shots||[]).length>1 && _sbEl("div",{className:"sb-side-picks",role:"group","aria-label":"Panel"},
          page.shots.map((sh,i)=>_sbEl("button",{key:sh.id,type:"button",className:"sb-side-pick"+(i===pIdx?" on":""),"aria-pressed":i===pIdx?"true":"false",
            title:sbPanelLabel(sh)+((typeof shotGrammarLabel==="function")?" \u00b7 "+shotGrammarLabel(sh):""),onClick:()=>setPanelIdx(i)}, String((page.start||0)+i+1))))),

      (()=>{ const bm = sbBeatMeta(beatsMap, scene.id);
        return (bm.driverLabel || bm.reactorLabel || bm.desire || bm.obstacle)
          ? _sbEl("div",{className:"sb-brief-scene"},
              (bm.driverLabel||bm.reactorLabel) && _sbEl("div",{className:"sb-brief-pair"},
                _sbEl("span",null,_sbEl("b",null,"Driver: "), bm.driverLabel||"—"),
                _sbEl("span",null,_sbEl("b",null,"Reactor: "), bm.reactorLabel||"—")),
              bm.desire && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"Desire — "), bm.desire),
              bm.obstacle && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"Antagonism — "), bm.obstacle))
          : null;
      })(),
      page.shots.map((sh,i)=>{
        if(i!==pIdx) return null;
        const bm = sbBeatMeta(beatsMap, scene.id);
        const row = sbBeatRow(beatsMap, sh);
        const who = sbInFrame(sh, ctx);
        const lt = (typeof window.shotLiveText==="function") ? window.shotLiveText(scene, sh) : { action:sh.action||"", dialogue:sh.dialogue||"" };
        return _sbEl("div",{className:"sb-brief",key:sh.id},
          _sbEl("div",{className:"sb-brief-head"},
            _sbEl("span",{className:"sb-brief-no"}, sbPanelLabel(sh)),
            _sbEl("span",{className:"sb-brief-gram"}, (typeof shotGrammarLabel==="function")?shotGrammarLabel(sh):""),
            _sbEl("button",{className:"sb-brief-jump",onClick:()=>jumpToShot(sh),title:"Edit in Shots"},
              _sbEl(Icon.film,{s:10}),"Edit")),
          _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"In frame — "), who.length?who.join(", "):"—"),
          lt.action && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"Action — "), lt.action),
          sh.composition && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"Composition — "), sh.composition),
          lt.dialogue && _sbEl("div",{className:"sb-brief-line dlg"},_sbEl("b",null,"Dialogue — "), "“"+lt.dialogue+"”",
            lt.dialogueGone && _sbEl("span",{className:"sb-brief-gone",title:"A redraft removed or rewrote this line — check the shot in Shots"}," · no longer in the script")),
          row && row.drive && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,(bm.driverLabel||"Driver")+" ▸ "), (row.drive.a||"")+(row.drive.d?(" — "+row.drive.d):"")),
          row && row.react && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,(bm.reactorLabel||"Reactor")+" ▸ "), (row.react.a||"")+(row.react.d?(" — "+row.react.d):"")),
          // the REAL inputs — from the frame's own render record, never re-derived
          (()=>{
            const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
            if(!m) return null;
            const all = (ctx.sceneShots && ctx.sceneShots.length) ? ctx.sceneShots : page.shots;
            const ss = m.seedSource;
            const seedTxt = !ss ? "no lineage stamp (rendered before seed tracking)"
              : !ss.seedShotId ? (ss.fresh ? "no seed — deliberate fresh start" : "no seed recorded")
              : (()=>{ const k = all.findIndex(x=>x.id===ss.seedShotId);
                  return "Seed: "+(k>=0 ? (sbPanelLabel(all[k])+"'s frame") : "a removed shot")
                    +(ss.seedVersion?(" v"+ss.seedVersion):"")
                    +(ss.seedUnapproved?" — unapproved at render (director's choice)":""); })();
            const refN = (m.sourceReferences||[]).length;
            return _sbEl("div",{className:"sb-brief-line",
              title:refN?("Attached reference sheets: "+(m.sourceReferences||[]).map(r=>r.note||r.assetRole).filter(Boolean).join(" · ")):undefined},
              _sbEl("b",null,"Rendered from — "), seedTxt+(refN?(" · "+refN+" reference sheet"+(refN>1?"s":"")):""));
          })(),
          // the prompt: the frame's AS-RENDERED prompt when it exists; otherwise the
          // PLANNED prompt built from the same render plan the Shots tab would use now
          (()=>{
            const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
            if(m && m.prompt) return _sbEl(CopyBox,{label:"Frame prompt — as rendered",text:m.prompt});
            if(typeof combinedShotPrompt!=="function") return null;
            let pctx = ctx;
            try{
              if(typeof shotRenderPlan==="function"){
                const all = (ctx.sceneShots && ctx.sceneShots.length) ? ctx.sceneShots : page.shots;
                const plan = shotRenderPlan(sh, all, ctx);
                const si = all.findIndex(x=>x.id===sh.id);
                pctx = { ...ctx, carriedForward:plan.carriedForward, carriedTextOnly:plan.carriedTextOnly, prevFrameRole:!!plan.prevSh,
                  prevShot:plan.prevSh||null, laterShots: si>=0 ? all.slice(si+1) : [] };
              }
            }catch(e){}
            return _sbEl(CopyBox,{label:"Planned frame prompt — as the Shots tab would render it now",text:combinedShotPrompt(sh, pctx)});
          })());
      })));
}

function StoryboardView({ project, scenes, shots, characters, props, locations, beatsMap, setArtView, onUpdateShot, readOnly=false }){
  const [view, setView]   = React.useState(null);   // lightbox {url, character}
  const [frames, setFrames] = React.useState({});    // sheetId -> url (for the progress count)
  const [jumpOpen, setJumpOpen] = React.useState(false);
  // the scene brief folds to one line, as on Shots (owner 2026-10-23)
  const [briefOpen,setBriefOpen]=React.useState(false);

  const ordered = React.useMemo(()=> scenesInStoryOrder(scenes), [scenes]);
  const shotsByScene = React.useMemo(()=>{
    const m={}; (shots||[]).forEach(s=>{ (m[s.sceneId]=m[s.sceneId]||[]).push(s); });
    Object.values(m).forEach(arr=>arr.sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0)));
    return m;
  }, [shots]);
  const charById = React.useMemo(()=>{ const m={}; (characters||[]).forEach(c=>m[c.id]=c); return m; },[characters]);
  const propById = React.useMemo(()=>{ const m={}; (props||[]).forEach(p=>m[p.id]=p); return m; },[props]);
  const ctxFor = (scene)=>({ scene, scenes:ordered,
    location:(typeof locationForScene==="function")?locationForScene(locations,scene.id):null,
    charById, propById, project, locations:locations||[], sceneShots:(shotsByScene[scene.id]||[]) });

  // scene -> its sheets: 2×2 pages packed on BEAT boundaries (sbPaginateBeats); the id
  // scheme is frozen — the Stage's clip→sheet bridge + the Art Room progress build them.
  const pagesByScene = React.useMemo(()=> ordered
    .filter(s=>(shotsByScene[s.id]||[]).length)
    .map(scene=>({
      scene,
      pages: sbPaginateBeats(sbBoardShots(shotsByScene[scene.id]||[])).map((pg,index)=>({
        id:"sbpage-"+scene.id+"-2x2-"+index, index, shots:pg.shots, start:pg.start, grid:"2x2" }))
    })), [ordered, shotsByScene]);
  const allSheetIds = React.useMemo(()=> pagesByScene.flatMap(g=>g.pages.map(p=>"sbsheet-"+p.id)), [pagesByScene]);

  // one scene at a time — ← / → pager instead of one long scroll
  const [pIdx, setPIdx] = useScenePager(pagesByScene.length);
  // OPEN ON THE SCENE another tab asked for (the Breakdown's Boards chip) — 2026-10-09
  const sbFocusDone = React.useRef(false);
  React.useEffect(()=>{
    if(sbFocusDone.current || !pagesByScene.length) return;
    sbFocusDone.current = true;
    const f = window.turnPeekArtFocus && window.turnPeekArtFocus("storyboard");
    if(window.turnClearArtFocus) window.turnClearArtFocus("storyboard");
    if(!f) return;
    const i = pagesByScene.findIndex(g=>g.scene && g.scene.id===f.sceneId);
    if(i>=0) setPIdx(i);
  },[pagesByScene.length]);

  // load sheet image urls (for the X-of-Y progress) + adopt freshly composed ones
  React.useEffect(()=>{
    let alive = true;
    (async ()=>{
      const map = {};
      for(const id of allSheetIds){
        let u = (typeof nbGetImage==="function") ? nbGetImage(id) : "";
        if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(id); }catch(e){} }
        if(u) map[id] = u;
      }
      if(alive) setFrames(map);
    })();
    return ()=>{ alive=false; };
  }, [allSheetIds.join(",")]);
  React.useEffect(()=>{
    // a cleared sheet leaves the count at once (2026-10-09 — it stayed until a reload)
    const onDone = (e)=>{ const d=e.detail||{}; if(!d.id || String(d.id).indexOf("sbsheet-")!==0 || /:half-/.test(String(d.id))) return;
      setFrames(f=>{ const n={ ...f }; if(d.url) n[d.id]=d.url; else delete n[d.id]; return n; }); };
    const onCleared = (e)=>{ const d=e.detail||{}; if(d.id) setFrames(f=>{ const n={ ...f }; delete n[d.id]; return n; }); };
    window.addEventListener("nb-gen-done", onDone); window.addEventListener("sb-sheet-cleared", onCleared);
    return ()=>{ window.removeEventListener("nb-gen-done", onDone); window.removeEventListener("sb-sheet-cleared", onCleared); };
  }, []);

  const readiness = sbStoryboardReadiness(pagesByScene, frames,
    (id)=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null);
  const totalSheets = readiness.total;
  const readySheets = readiness.complete + readiness.partial + (readiness.stale||0);
  // the role is re-checked before EACH sheet of a bulk compose (2026-10-09): a downgrade mid-run stops it
  const readOnlyRef = React.useRef(readOnly); readOnlyRef.current = readOnly;

  // compose every sheet whose shots have frames — instant per sheet, no generation cost
  const [composingAll, setComposingAll] = React.useState(null);   // {i,total} | null
  const [composingScene, setComposingScene] = React.useState(null); // {id,i,total} | null
  const composeJobs = async (jobs, onProgress)=>{
    // structured outcome — a bulk run must never end silently on failures
    const out = { composed:0, skipped:0, kept:0, current:0, held:0, failed:[], stale:false, stopped:false };
    for(let i=0;i<jobs.length;i++){
      if(readOnlyRef.current){ out.stopped = true; break; }
      if(onProgress) onProgress(i+1,jobs.length);
      const { scene, page } = jobs[i];
      // an UPLOADED board is never drawn over (2026-10-05): the automatic redraw already kept it;
      // Compose all / Compose Scene used to overwrite it silently
      const had = (typeof nbGetMeta==="function") ? nbGetMeta("sbsheet-"+page.id) : null;
      const hasImg = (typeof nbGetImage==="function") && !!nbGetImage("sbsheet-"+page.id);
      if(hasImg && had && (had.uploaded || had.mode==="upload" || !had.composed)){ out.kept++; continue; }
      let res = null;
      try{ res = await sbComposeSheet(scene, page, ctxFor(scene), beatsMap); }
      catch(e){ res = { status:"failed" }; }
      if(res.status==="stale"){ out.stale = true; break; }   // film switched: stop the whole batch quietly
      if(res.status==="composed") out.composed++;
      else if(res.status==="kept") out.kept++;
      else if(res.status==="current") out.current++;   // already up to date — not redrawn (2026-10-09)
      else if(res.status==="held") out.held++;         // a version you restored — kept until you Recompose it
      else if(res.status==="cleared") {}               // you cleared it while it drew
      else if(res.status==="skipped") out.skipped++;
      else out.failed.push("Scene "+scene.no+" sheet "+(page.index+1));
    }
    return out;
  };
  const reportComposeRun = (out)=>{
    if(!out || out.stale || typeof window.appToast!=="function") return;
    if(out.stopped){ window.appToast("Composing stopped \u2014 your role on this film no longer changes the Art Room."+(out.composed?(" "+out.composed+" sheet"+(out.composed===1?" was":"s were")+" composed before that."):""),"error"); return; }
    // sheets left as they were: up to date, restored by you, uploaded (2026-10-09)
    const left = [out.current ? out.current+" already up to date" : "", out.held ? out.held+" restored version"+(out.held===1?"":"s")+" kept" : ""].filter(Boolean).join(", ");
    if(!out.failed.length && !out.composed && !out.skipped && !out.kept && left){
      window.appToast("Nothing to compose \u2014 "+left+". Use Recompose on a sheet to redraw it anyway."); return; }
    if(out.failed.length){
      const names = out.failed.slice(0,3).join(", ") + (out.failed.length>3 ? " +"+(out.failed.length-3)+" more" : "");
      window.appToast("Composed "+out.composed+" sheet"+(out.composed===1?"":"s")+" — "+out.failed.length+" failed: "+names+". Open those scenes and Recompose to retry.","error");
    } else if(out.composed){
      window.appToast("Composed "+out.composed+" sheet"+(out.composed===1?"":"s")+(out.skipped?(" — "+out.skipped+" skipped (no generated frames yet)"):"")
        +(out.kept?(" \u00b7 "+out.kept+" uploaded sheet"+(out.kept===1?"":"s")+" kept as "+(out.kept===1?"it is":"they are")):"")
        +(left?(" \u00b7 "+left):"")+".");
    } else if(out.kept && !out.skipped){
      window.appToast("Nothing to compose \u2014 "+out.kept+" uploaded sheet"+(out.kept===1?" is":"s are")+" kept as "+(out.kept===1?"it is":"they are")+".");
    } else if(out.skipped){
      window.appToast("No sheets composed — "+out.skipped+" skipped: no generated frames yet. Render frames in the Shots tab first.","error");
    }
  };
  const composeAll = async ()=>{
    if(composingAll || composingScene) return;
    const jobs = pagesByScene.flatMap(g=>g.pages.map(p=>({ scene:g.scene, page:p })));
    setComposingAll({ i:0, total:jobs.length });
    const out = await composeJobs(jobs,(i,total)=>setComposingAll({i,total}));
    setComposingAll(null);
    reportComposeRun(out);
  };
  const composeOneScene = async (scene,pages)=>{
    if(composingAll || composingScene || !scene) return;
    const jobs=(pages||[]).map(page=>({scene,page}));
    setComposingScene({id:scene.id,i:0,total:jobs.length});
    const out = await composeJobs(jobs,(i,total)=>setComposingScene({id:scene.id,i,total}));
    setComposingScene(null);
    reportComposeRun(out);
  };

  // jump to a shot in the Shots tab (pre-expand its scene, switch tab, scroll + flash)
  const jumpToShot = (sh)=>{
    // the Shots tab's fold map is per film since 2026-10-03 (shots-ui.jsx foldKey) — open the scene there
    const foldKey = "turn_shots_collapsed"+(project && project.id ? ":"+project.id : "");
    try{ const c = JSON.parse(localStorage.getItem(foldKey)||"{}")||{}; c[sh.sceneId]=false;
      localStorage.setItem(foldKey, JSON.stringify(c)); }catch(e){}
    // open THIS scene in Shots (2026-10-09 — the Shots tab opened on its first scene, so the jump quietly failed)
    if(typeof window.turnFocusArtScene==="function") window.turnFocusArtScene("shots", sh.sceneId);
    if(setArtView) setArtView("shots");
    let tries=0;
    const tick=()=>{
      const el = document.querySelector('[data-shot-card="'+sh.id+'"]');
      const scroller = el && el.closest('.art-scroll');
      if(el && scroller){ el.scrollIntoView({block:"center"}); el.classList.add("sb-flash"); setTimeout(()=>el.classList.remove("sb-flash"),1200); return; }
      if(tries++<30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ---- empty state ----
  if(!pagesByScene.length){
    return _sbEl("div",{className:"art-scroll"},
      _sbEl("div",{inert:readOnly?"":undefined,"aria-disabled":readOnly?"true":undefined}, _sbEl(NbKeyBar,null), _sbEl(NbControls,null)),
      _sbEl("div",{className:"art-intro"},
        _sbEl("div",{className:"art-intro-row"},
          _sbEl("div",{style:{flex:1}},
            // department-professional title, matching the other Art Room tabs
            _sbEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Storyboard Artist",
              _sbEl(window.InfoTip,{label:"About Storyboards",
                text:"Storyboards are the presentation layer of your shot chain: each scene's generated shot frames lay into printable 2×2 sheets — paginated on beat boundaries, with real CAMERA / MOTION / ACTION / PERFORMANCE annotations — and re-compose automatically when a frame re-renders while the scene is open here, or the next time you open it."}))))),
      _sbEl("div",{className:"prop-empty"},
        _sbEl("div",{className:"art-soon-ic"},_sbEl(Icon.board,{s:30})),
        _sbEl("div",{className:"art-soon-t"},"No shots to board yet"),
        _sbEl("div",{className:"art-soon-d"},
          "Break your scenes into shots in the Shots tab and generate their frames — each scene's storyboard sheet then composes itself here."),
        _sbEl("button",{className:"art-draftall",style:{marginTop:16},onClick:()=> setArtView && setArtView("shots")},
          _sbEl(Icon.film,{s:14}),"Go to Shots")));
  }

  return _sbEl("div",{className:"art-scroll"},
    view && _sbEl(ImageLightbox,{url:view.url,character:view.character,onClose:()=>setView(null)}),
    // VIEW-ONLY ROLES SEE THE BOARD (2026-10-09, owner — Storyboards review): this tab is outside the Art Room's
    // `inert` boundary (artroom.jsx) so a read-only role or a Stage editor can page, open the briefs, view
    // sheets and halves and export; the engine settings stay inert and every changing control is disabled or
    // hidden for them below
    _sbEl("div",{inert:readOnly?"":undefined,"aria-disabled":readOnly?"true":undefined}, _sbEl(NbKeyBar,null), _sbEl(NbControls,null)),
    // (no Lookbook banner: the boards are composed from the shot frames and read no references
    //  of their own — the look reaches them through Shots, Locations and Color. 2026-10-05, owner)
    _sbEl("div",{className:"art-intro"},
      _sbEl("div",{className:"art-intro-row"},
        _sbEl("div",{style:{flex:1}},
          _sbEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Storyboard Artist",
            _sbEl(window.InfoTip,{label:"About Storyboards",
              text:"Storyboards are the presentation layer of your shot chain: each scene's generated shot frames lay into printable 2×2 sheets — paginated on beat boundaries, with real CAMERA / MOTION / ACTION / PERFORMANCE annotations — and re-compose automatically when a frame re-renders while the scene is open here, or the next time you open it. Save top/bottom halves to hand panel rows to the Stage, repair a single panel (it edits that shot's frame), upload a board made elsewhere, or export the whole board as a print-ready PDF."})),
          _sbEl("div",{style:{fontFamily:"var(--f-mono)",fontSize:11,letterSpacing:".03em",color:"var(--txt-3)",marginTop:4}},
            readiness.complete+"/"+totalSheets+" complete"+
            (readiness.stale ? " · "+readiness.stale+"/"+totalSheets+" out of date" : "")+
            (readiness.partial ? " · "+readiness.partial+"/"+totalSheets+" partial" : "")+
            (readiness.missing ? " · "+readiness.missing+"/"+totalSheets+" missing" : ""))),
        _sbEl("div",{className:"art-intro-actions"},
          _sbEl("button",{className:"art-draftall",disabled:readOnly||!!composingAll||!!composingScene||!totalSheets,onClick:composeAll,
            title:"Lay every scene's generated shot frames into its sheets — instant and free; scenes with no frames yet are skipped"},
            _sbEl(Icon.board,{s:14}), composingAll?("Composing "+composingAll.i+"/"+composingAll.total+"…"):"Compose all from frames"),
          _sbEl("button",{className:"art-draftall ghost",disabled:!readySheets,
            onClick:()=> exportStoryboard(pagesByScene, frames, project, shotsByScene),
            title:"Preview the storyboard as a printable document (sheet images inlined for keeps), then print / save as PDF or download the HTML"},
            _sbEl(Icon.download,{s:14}),"Export storyboard"))) ),

    pagesByScene.slice(Math.min(pIdx,pagesByScene.length-1), Math.min(pIdx,pagesByScene.length-1)+1).map(({scene,pages})=>{
      const ctx = ctxFor(scene);
      const ln = ctx.location ? ctx.location.name : "";
      const sceneShots=shotsByScene[scene.id]||[];
      const bm=sbBeatMeta(beatsMap,scene.id);
      const driver=scene.driver&&charById[scene.driver];
      const driverName=(driver&&driver.name)||bm.driverLabel||"";
      const confLab=scene.conf ? SB_CONF_LABELS[scene.conf-1] : "";
      const sceneBusy=composingScene&&composingScene.id===scene.id;
      const boardN=pages.reduce((n,p)=>n+(p.shots||[]).length,0);
      return _sbEl("div",{className:"sb-scene",key:scene.id},
        _sbEl("div",{className:"shot-scene-card sb-scene-summary"},
          _sbEl("div",{className:"shot-scene-head merged"},
            _sbEl("button",{className:"scene-pager-arrow",disabled:pIdx<=0,
              onClick:()=>{setJumpOpen(false);setPIdx(i=>Math.max(0,i-1));},title:"Previous scene (←)","aria-label":"Previous scene"},
              _sbEl(Icon.chevL,{s:18})),
            _sbEl("div",{className:"shot-scene-meta"},
              // a real button with its menu beside it; Escape closes it (2026-10-09 — the Shots tab's own fix)
              _sbEl("span",{className:"scene-pager-no ssg-jump"},
                _sbEl("button",{type:"button",className:"scene-pager-btn",title:"Jump to a scene","aria-haspopup":"true","aria-expanded":jumpOpen?"true":"false",
                  onClick:()=>setJumpOpen(o=>!o), onKeyDown:(e)=>{ if(e.key==="Escape" && jumpOpen){ e.preventDefault(); e.stopPropagation(); setJumpOpen(false); } }},
                  "Scene "+(pIdx+1)+" of "+pagesByScene.length,_sbEl(Icon.chevD,{s:10})),
                jumpOpen&&_sbEl("div",{className:"scene-pager-menu",role:"group","aria-label":"Scenes",onClick:e=>e.stopPropagation(),
                  onKeyDown:(e)=>{ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); setJumpOpen(false);
                    try{ const b = e.currentTarget.parentNode.querySelector(".scene-pager-btn"); b && b.focus(); }catch(x){} } }},
                  pagesByScene.map((sx,i)=>_sbEl("button",{key:sx.scene.id||i,type:"button",className:"scene-pager-menu-item"+(i===pIdx?" on":""),"aria-current":i===pIdx?"true":undefined,
                    onClick:()=>{setPIdx(i);setJumpOpen(false);}},
                    _sbEl("span",{className:"scene-pager-menu-no"},String(sx.scene.no||(i+1)).padStart(2,"0")),
                    _sbEl("span",{className:"scene-pager-menu-t"},sx.scene.title||"Untitled scene"),
                    i===pIdx&&_sbEl(Icon.check,{s:14}))))),
              _sbEl("div",{className:"shot-scene-title"},scene.title||"Untitled scene")),
            _sbEl("div",{className:"shot-scene-acts"},
              _sbEl("button",{className:"char-draft-btn primary",disabled:!!composingAll||!!composingScene||!!readOnly,
                onClick:()=>composeOneScene(scene,pages),
                title:"Lay this scene's current shot frames into its storyboard sheets — instant and free"},
                _sbEl(Icon.board,{s:12}),sceneBusy?("Composing "+composingScene.i+"/"+composingScene.total+"…"):("Compose Scene "+String(scene.no).padStart(2,"0")+" from frames")),
              _sbEl("button",{className:"char-draft-btn ghost",onClick:()=>{ if(typeof window.turnFocusArtScene==="function") window.turnFocusArtScene("shots", scene.id); setArtView&&setArtView("shots"); },
                title:"Open this scene's source frames and shot design in the Shots tab"},
                _sbEl(Icon.film,{s:12}),"Edit shots")),
            _sbEl("button",{className:"scene-pager-arrow",disabled:pIdx>=pagesByScene.length-1,
              onClick:()=>{setJumpOpen(false);setPIdx(i=>Math.min(pagesByScene.length-1,i+1));},title:"Next scene (→)","aria-label":"Next scene"},
              _sbEl(Icon.chevR,{s:18}))),
          /* THE SLATE (owner 2026-10-23, as Shots): Look · Location · Board (the PANELS drawn — one keyframe per
             beat — and the sheets) */
          _sbEl("div",{className:"loc-slate art-slate ssx-slate",role:"group","aria-label":"Scene "+String(scene.no).padStart(2,"0")+": look, location and board"},
            _sbEl("div",{className:"loc-slate-cell ssx-look"},
              _sbEl("span",{className:"loc-slate-lab"},"Look"),
              _sbEl(StoryboardSceneStyleChip,{project,sceneId:scene.id})),
            _sbEl("div",{className:"loc-slate-cell"},
              _sbEl("span",{className:"loc-slate-lab"},"Location"),
              _sbEl("b",{title:ln||""}, ln||"\u2014")),
            _sbEl("div",{className:"loc-slate-cell"},
              _sbEl("span",{className:"loc-slate-lab"},"Board"),
              _sbEl("b",null, boardN+" panel"+(boardN!==1?"s":"")+" \u00b7 "+pages.length+" sheet"+(pages.length!==1?"s":"")))),
          _sbEl("button",{type:"button",className:"ssx-brief-toggle","aria-expanded":briefOpen?"true":"false",onClick:()=>setBriefOpen(o=>!o)},
            _sbEl(briefOpen?Icon.chevD:Icon.chevR,{s:12}),
            _sbEl("span",{className:"ssx-brief-lab"},"Scene brief"),
            !briefOpen&&_sbEl("span",{className:"ssx-brief-sum"},
              [(()=>{ const nm=(x)=>typeof window.railNameCase==="function"?window.railNameCase(x):x;
                return driverName&&bm.reactorLabel ? nm(driverName)+" vs "+nm(bm.reactorLabel) : nm(driverName||""); })(), confLab||""].filter(Boolean).join(" \u00b7 "))),
          briefOpen&&_sbEl("div",{className:"shot-scene-ctx"},
            scene.summary&&_sbEl("div",{className:"ssx-desc"},scene.summary),
            _sbEl("div",{className:"ssx-grid"},
              _sbEl(StoryboardSceneCtxItem,{label:"Driver",value:driverName}),
              _sbEl(StoryboardSceneCtxItem,{label:"Reactor",value:bm.reactorLabel}),
              _sbEl(StoryboardSceneCtxItem,{label:"Driver's goal",value:scene.objective}),
              _sbEl(StoryboardSceneCtxItem,{label:"Antagonism",value:bm.obstacle}),
              scene.conf&&_sbEl("div",{className:"ssx-item"},
                _sbEl("div",{className:"ssx-k"},"Conflict source"),
                _sbEl("div",{className:"ssx-conf"},
                  confLab&&_sbEl("span",{className:"ssx-conf-lab"},confLab),
                  _sbEl("div",{className:"ssx-pips"},[1,2,3].map(i=>_sbEl("span",{key:i,className:"ssx-pip"+(i<=scene.conf?" on":"")})))))))),
        pages.map(page=>_sbEl(StoryboardPage,{key:page.id,project,scene,page,pageCount:pages.length,ctx,beatsMap,
          onView:setView,jumpToShot,onUpdateShot,readOnly,bulkBusy:!!composingAll||!!sceneBusy})));
    }));
}
window.StoryboardView = StoryboardView;

/* ---- split a sheet into TOP / BOTTOM halves and SAVE BOTH to the project's image
   store (Supabase in cloud mode, local otherwise) — no file downloads to manage.
   Each half becomes its own asset, `<sheetId>:half-top` / `<sheetId>:half-bottom`,
   ready for the Stage's video generation (frame-conditioning). On a
   2×2 sheet each half is one panel ROW — two frames side by side. The image is
   inlined first (sbToDataUrl) so cropping a cloud sheet's signed URL doesn't taint
   the canvas. Re-saving after a sheet recomposes overwrites the halves (the previous
   pair stays in each asset's version history). */
/* sheetMeta (2026-10-09): the halves record what the SHEET was drawn from — its shot ids and frame versions —
   never the page's live shots (a re-save of an out-of-date sheet stamped its old panels as current). An
   uploaded sheet's halves record its shots but no frame versions (re-rendering a frame can't change it). */
/* (2026-10-09, owner — Storyboards review) an UPLOAD is cut only when it is shaped like a composed 2×2 sheet
   (sbUploadShapeOk — `aspect` is the film's format; an Error with code "shape" otherwise), and a page of one or
   two panels saves only its TOP half — its bottom row is empty. Returns the halves saved. */
async function sbSaveHalves(url, sid, page, sourceVersion, _ep, sheetMeta, aspect){
  const data = await sbToDataUrl(url);
  const img = new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=data; });
  const mid = Math.floor(img.height/2);
  const _sm = sheetMeta || ((typeof nbGetMeta==="function") ? nbGetMeta(sid) : null) || {};
  if(!_sm.composed){
    const asp = aspect || ((typeof aspectFor==="function") ? aspectFor(window.turnProject) : "16:9");
    if(sbUploadShapeOk(img.naturalWidth||img.width, img.naturalHeight||img.height, asp)===false){
      const e = new Error(SB_UPLOAD_SHAPE_MSG); e.code = "shape"; throw e; }
  }
  const _ids = Array.isArray(_sm.shotIds) ? _sm.shotIds : ((page&&page.shots)||[]).map(x=>x.id);
  const _fv = Array.isArray(_sm.frameVersions) ? _sm.frameVersions : ((_sm.uploaded || _sm.mode==="upload") ? null : sbFrameVersions((page&&page.shots)||[]));
  const cuts = [["top",0,mid],["bottom",mid,img.height-mid]].filter(([half])=> half==="top" || sbHalvesFor(_ids.length).indexOf("bottom")>=0);
  const saved = [];
  for(const [half, sy, sh] of cuts){
    const c = document.createElement("canvas"); c.width=img.width; c.height=sh;
    c.getContext("2d").drawImage(img, 0,sy,img.width,sh, 0,0,img.width,sh);
    const now = new Date();
    // sourceVersion = the sheet version these halves were cut from — the duplicate guard:
    // while it matches the sheet's current version, re-saving is blocked as a no-op
    const meta = { kind:"sheet-half", half, source:sid, sourceVersion:String(sourceVersion||""),
      shotIds: sbHalfShotIds(_ids, half),
      ...(_fv ? { frameVersions: half==="top" ? _fv.slice(0,2) : _fv.slice(2) } : {}),
      grid:(page&&page.grid)||"", model:"Cropped from the storyboard sheet",
      date:now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
      time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}), iso:now.toISOString() };
    if(typeof nbCommit!=="function") throw new Error("the image store isn't available");
    // _ep (the film scope at compose start): a film switch mid-save is a quiet discard
    const r = await nbCommit(sid+":half-"+half, c.toDataURL("image/png"), meta, [], undefined, _ep);
    if(r && r.tier==="stale") return saved;
    if(!r || r.tier==="error") throw new Error("the "+half+" half didn't save");
    saved.push(half);
  }
  return saved;
}

/* ---- export: printable storyboard SHEETS (header + the composed sheet image), Save as PDF ----
   DURABLE: every sheet image is inlined as a data URL before the document is written —
   cloud sheets are served on SIGNED URLs that expire within the hour, so an export that
   merely links them goes blank as soon as it's saved or printed later (one that can't be
   inlined is said to expire). Each sheet prints at its own shape (2026-10-09). */
async function sbToDataUrl(url){
  if(!url || /^data:/.test(url)) return url || "";
  try{
    const res = await fetch(url, { mode:"cors" }); if(!res.ok) return url;
    const blob = await res.blob();
    return await new Promise((resolve)=>{ const r = new FileReader();
      r.onload = ()=>resolve(String(r.result||url)); r.onerror = ()=>resolve(url); r.readAsDataURL(blob); });
  }catch(e){ return url; }
}
/* board health for the EXPORT — same checks as the on-screen strip, computed on WARM
   data (each frame awaited first, so a scene the user never opened is judged exactly,
   never guessed from a cold cache). Returns per-sheet warning counts + board totals. */
/* sceneShotsOf (2026-10-09): the scene's FULL shot list — the continuity chain the tab's strip judges against
   (ctx.sceneShots), not only the panels on the board; the board's panels are the fallback */
async function sbBoardHealth(pagesByScene, sceneShotsOf){
  const drafts = ((window.turnContinuity||{}).drafts)||{};
  const perSheet = {}; const tot = { unrendered:0, unapproved:0, staleSeed:0, staleSrc:0, oldLook:0 };
  for(const g of pagesByScene){
    const full = (sceneShotsOf && g.scene && Array.isArray(sceneShotsOf[g.scene.id])) ? sceneShotsOf[g.scene.id] : null;
    const chain = (full && full.length) ? full : g.pages.flatMap(p=>p.shots||[]);   // the scene's full running order
    for(const page of g.pages){
      const w = { unrendered:0, unapproved:0, staleSeed:0, staleSrc:0, oldLook:0 };
      for(const sh of (page.shots||[])){
        let u = (typeof nbGetImage==="function") ? nbGetImage(sh.id) : "";
        if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(sh.id); }catch(e){} }
        if(!u){ w.unrendered++; continue; }
        if(!sh.locked) w.unapproved++;
        const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
        const st = (typeof shotAssetProvenanceStatus==="function") ? shotAssetProvenanceStatus(sh, drafts[sh.sceneId], m) : "unverified";
        const ov = (typeof shotSourceOverrideCurrent==="function") && shotSourceOverrideCurrent(sh, drafts[sh.sceneId]);
        if(st==="stale" && !ov) w.staleSrc++;
        // the earlier-look count the tab shows, in the export too (2026-10-09)
        if(m && typeof shotLookIsEarlier==="function" && shotLookIsEarlier(m.lookSig, window.turnProject, sh.sceneId)) w.oldLook++;
        if(typeof shotChainStatus==="function" && shotChainStatus(sh, chain, (x)=> (typeof nbGetMeta==="function") ? nbGetMeta(x) : null)==="stale") w.staleSeed++;
      }
      perSheet["sbsheet-"+page.id] = w;
      tot.unrendered+=w.unrendered; tot.unapproved+=w.unapproved; tot.staleSeed+=w.staleSeed; tot.staleSrc+=w.staleSrc; tot.oldLook+=w.oldLook;
    }
  }
  return { perSheet, tot };
}
const sbWarnParts = (w)=> !w ? [] : [
  w.unapproved ? (w.unapproved+" not approved") : "",
  w.unrendered ? (w.unrendered+" unrendered") : "",
  w.staleSeed ? (w.staleSeed+" frame"+(w.staleSeed===1?" needs":"s need")+" continuity refresh") : "",
  w.staleSrc ? (w.staleSrc+" frame"+(w.staleSrc!==1?"s need":" needs")+" source refresh") : "",
  w.oldLook ? (w.oldLook+" frame"+(w.oldLook!==1?"s":"")+" made with an earlier look") : "",
].filter(Boolean);
/* the export's file name keeps the title's letters in any language — the Home poster's rule (home-dashboard.jsx
   posterFileName), 2026-10-09: "東京物語" came out "_STORYBOARD.html" */
function sbExportFileName(title){
  const raw = String(title||"").trim();
  let slug = "";
  try{ slug = raw.normalize("NFC").replace(new RegExp("[^\\p{L}\\p{M}\\p{N}\\-]+","gu"),"-"); }catch(e){ slug = raw.replace(/[^\w-]+/g,"-"); }
  slug = slug.replace(/-+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);
  return (slug || "film")+"-storyboard.html";
}
window.sbExportFileName = sbExportFileName;
async function exportStoryboard(pagesByScene, frames, project, sceneShotsOf){
  const esc = (s)=> String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const title = (project && project.title) || "Storyboard";
  const placeholder = '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)
    +' — Storyboard</title></head><body style="background:#000;color:#9a958b;font:13px -apple-system,Segoe UI,sans-serif;'
    +'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Checking the board\u2019s panels, then inlining sheet images\u2026</body></html>';
  // in-app PREVIEW (same overlay as the screenplay export): opens instantly on the
  // placeholder, swaps in the finished document once the images are inlined —
  // print/download from there, nothing prints uninvited. Opened FIRST, inside the
  // click gesture: the health scan below awaits, and popup blockers kill a fallback
  // window opened after an await. (The confirm dialog stacks above this overlay.)
  const prev = (typeof window.docPreview==="function")
    ? window.docPreview({ title:"Storyboard preview", sub:title,
        fileName:sbExportFileName(project && project.title), html:placeholder,
        hint:"Sheet images are copied into the file, so it stays viewable after image links expire \u2014 the document says so if one couldn't be." })
    : null;
  // fallback tab (overlay unavailable) — open NOW, inside the click
  const w = prev ? null : window.open("", "_blank");
  if(w){ w.document.open(); w.document.write(placeholder); w.document.close(); }
  // TRUTHFUL EXPORT: a printable board must not present unverified work as final.
  // Check every panel first; if anything is off, the director exports EXPLICITLY
  // with warnings (and the affected sheets are marked in the document itself).
  let health = null;
  try{ health = await sbBoardHealth(pagesByScene, sceneShotsOf); }catch(e){}
  const readiness = sbStoryboardReadiness(pagesByScene, frames,
    (id)=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null);
  const _totParts = health ? sbWarnParts(health.tot) : [];
  // sheets whose page's shots or frames changed since they were drawn (2026-10-05) — said up front
  const outOfDate = {};
  for(const g of pagesByScene){ for(const page of g.pages){
    const k = "sbsheet-"+page.id, m = (typeof nbGetMeta==="function") ? nbGetMeta(k) : null;
    if(m && (typeof nbGetImage!=="function" || nbGetImage(k)) && sbSheetStale(m, (page.shots||[]).map(x=>x.id))) outOfDate[k] = true;
  } }
  const outOfDateN = Object.keys(outOfDate).length;
  if((readiness.partial || readiness.missing || outOfDateN || _totParts.length) && typeof window.appConfirm==="function"){
    const sheetState = [
      readiness.partial ? readiness.partial+"/"+readiness.total+" partial sheets" : "",
      readiness.missing ? readiness.missing+"/"+readiness.total+" missing sheets" : "",
      outOfDateN ? outOfDateN+"/"+readiness.total+" out-of-date sheets (recompose them \u2014 free)" : "",
    ].filter(Boolean);
    const ok = await window.appConfirm({ title:"Export with warnings?",
      body:"This board is incomplete"+(sheetState.length?" ("+sheetState.join(", ")+")":"")+
        (_totParts.length?" — across its panels: "+_totParts.join(", "):"")+
        ". The export preserves partial compositions and marks affected sheets so nothing reads as final. Generate missing frames, then use Approve frame as seed in each shot image's Options menu or re-render for a complete board.",
      confirmLabel:"Export with warnings", cancelLabel:"Cancel" });
    if(!ok){ if(prev) prev.close(); if(w){ try{ w.close(); }catch(e){} } return; }
  }
  // inline every sheet image (cache-keyed by page id; data URLs pass straight through)
  const inline = {};
  // read each sheet NOW (a sheet cleared after the tab loaded used to export anyway), and mark one
  // that's out of date — its page's shots or frames changed since it was drawn (2026-10-05)
  let linked = 0;   // sheets that couldn't be inlined — they stay links, which expire (2026-10-09)
  for(const g of pagesByScene){ for(const page of g.pages){
    const k = "sbsheet-"+page.id;
    const now = (typeof nbGetImage==="function") ? nbGetImage(k) : (frames[k]||"");
    if(now){ inline[k] = await sbToDataUrl(now); if(!/^data:/.test(inline[k]||"")) linked++; }
  } }
  let body = "";
  pagesByScene.forEach(({scene,pages})=>{
    pages.forEach((page)=>{
      const url = inline["sbsheet-"+page.id];
      const alt = "Scene "+scene.no+" storyboard, page "+(page.index+1);
      const img = url ? '<img src="'+esc(url)+'" alt="'+esc(alt)+'">' : '<div class="ph">No sheet yet</div>';
      const wp = (health ? sbWarnParts(health.perSheet["sbsheet-"+page.id]) : [])
        .concat(outOfDate["sbsheet-"+page.id] ? ["out of date \u2014 recompose it in the Storyboards tab"] : []);
      body += '<section class="sheet"><div class="sheet-h">'
        + '<span><b>PROJECT:</b> '+esc(title)+'</span>'
        + '<span><b>SCENE:</b> '+esc(String(scene.no).padStart(2,"0"))+'</span>'
        + '<span><b>TITLE:</b> '+esc(scene.title||"")+'</span>'
        + '<span><b>PAGE:</b> '+(page.index+1)+' of '+pages.length+'</span>'
        + (wp.length ? '<span class="warn">&#9888; '+esc(wp.join(" · "))+'</span>' : '')
        + '</div><div class="sheet-img">'+img+'</div></section>';
    });
  });
  // a sheet that couldn't be inlined is still a signed link — say so instead of promising a durable file (2026-10-09)
  const linkNote = linked ? '<p class="note">'+linked+' sheet image'+(linked===1?' couldn\u2019t':'s couldn\u2019t')
    +' be copied into this file, so '+(linked===1?'it is a link that expires':'they are links that expire')
    +' in about an hour. Export again later to keep '+(linked===1?'it':'them')+'.</p>' : '';
  // THE SHEET PRINTS AS A SHEET (2026-10-09, owner — Storyboards review): the image is sized to the sheet itself
  // (it sat in a box shaped like one PANEL — black bars), and paper gets a light page with dark text
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+' — Storyboard</title>'
    + '<style>'
    + 'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#000;color:#eee;margin:24px;}'
    + '.note{color:#d8a35d;font-size:13px;margin:0 0 20px;}'
    + '.sheet{break-inside:avoid;margin:0 0 32px;}'
    + '.sheet-h{display:flex;gap:26px;flex-wrap:wrap;font-size:12px;letter-spacing:.04em;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:14px;}'
    + '.sheet-h b{color:#999;font-weight:600;}'
    + '.sheet-h .warn{color:#d86b61;font-weight:600;}'
    + '.sheet-img{background:#111;border:1px solid #333;border-radius:6px;overflow:hidden;}'
    + '.sheet-img img{width:100%;height:auto;display:block;}'
    + '.sheet-img .ph{display:flex;align-items:center;justify-content:center;min-height:180px;color:#9a958b;font-size:14px;'
    +   'background:repeating-linear-gradient(135deg,#111,#111 6px,#181818 6px,#181818 12px);}'
    + '@media print{body{margin:10mm;background:#fff;color:#111;}'
    +   '.sheet-h{border-bottom-color:#bbb;}.sheet-h b{color:#555;}.sheet-h .warn{color:#a3271c;}.note{color:#7a4b00;}'
    +   '.sheet-img{background:#fff;border-color:#ccc;}.sheet-img .ph{background:#f4f4f4;color:#555;}}'
    + '</style></head><body>'
    + linkNote
    + (body||'<p>No sheets composed yet.</p>')
    + '</body></html>';
  if(prev){ prev.setHtml(html); return; }
  if(w){ w.document.open();
    w.document.write(html.replace('</body>','<script>setTimeout(function(){try{window.print();}catch(e){}},450);<\/script></body>'));
    w.document.close(); }
}
window.exportStoryboard = exportStoryboard;

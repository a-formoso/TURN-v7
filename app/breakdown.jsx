/* breakdown.jsx — the Art Room's BREAKDOWN tab (the First AD's stripboard) and the
   ART DEPARTMENT BIBLE export. Owner-approved 2026-09-26 (Art Room part 3).

   The stripboard reads what the other tabs made. One strip per scene in story order, coloured
   the way crews colour a stripboard (white INT day, yellow EXT day, blue INT night, green EXT
   night, pink dawn/dusk). Each strip lists who is in the scene (in the look they wear there), its
   location, wardrobe and props, its shots, storyboard sheets and Stage clips, and what is still
   missing before it can be shot. Readiness follows the SHOTS rules: with shots, what's missing is
   what the scene's frames attach and don't have (sceneReferenceNeeds), and a frame is done when it
   is rendered, approved and current (shotFrameState); without shots, the older sheet / plate /
   prop-sheet checks stand. Two strip buttons spend (both priced): "Make what this scene needs" and
   "Render Scene NN" (Shots asks first). */

const _bdEl = React.createElement;

/* "INT. FATHER'S HOUSE - NIGHT" → { ie:"INT", place:"Father's House", tod:"NIGHT", todKind:"night" } */
function bdSlug(loc){
  const raw = String(loc||"").trim();
  const m = raw.match(/^\s*(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?)\s+/i);
  const pre = m ? m[1].toUpperCase().replace(/[.\s]/g,"") : "";
  const ie = !pre ? "" : pre.indexOf("/")>=0 ? "INT/EXT" : pre==="EXT" ? "EXT" : "INT";
  const body = m ? raw.slice(m[0].length) : raw;
  const cut = body.lastIndexOf(" - ");
  const place = (cut>0 ? body.slice(0,cut) : body).trim();
  const tod = (cut>0 ? body.slice(cut+3) : "").trim().toUpperCase();
  const nice = place.toLowerCase().replace(/(^|[\s\-\/(])([a-zà-ÿ])/g,(x,p1,ch)=>p1+ch.toUpperCase());
  const todKind = /\b(NIGHT|MIDNIGHT)\b/.test(tod) ? "night"
    : /\b(DAWN|DUSK|SUNSET|SUNRISE|TWILIGHT|MAGIC HOUR|EVENING)\b/.test(tod) ? "dusk"
    : /\b(DAY|MORNING|NOON|AFTERNOON)\b/.test(tod) ? "day" : "";
  return { ie, place:nice, tod, todKind };
}

/* one row per scene, in story order. `img(id)` says whether an image exists for an asset
   id; `tierOf(prop)` is the prop's reference-image tier ("text" = described, not drawn).
   `cache` (optional, the tab's own): SPEED ON BIG FILMS (2026-10-09, owner — Breakdown review) — a scene's
   row is kept while its inputs are the same objects and no image it reads changed (bdCacheDirty); `only`
   (optional) builds just that scene's row (the Characters and Props tabs' scene count). */
function breakdownRows({ scenes, characters, props, locations, shots, drafts, img, tierOf, project, stageStatus, cache, only }){
  const ordered = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]).slice();
  const C = characters||[];
  // decision C (2026-10-09, owner — Breakdown review): a carried prop with no owner, and one the screenplay
  // doesn't establish (once it has been read), need an owner / a screenplay mention, not an image
  const PS = window.PropScreenplay;
  const extracted = (props||[]).some(p=> p && (p.screenplaySources||[]).length);
  const blockOf = (p)=>{ if(!p || p.kind==="worn") return "";
    if((p.kind||"carried")==="carried" && !p.ownerId) return "owner";
    // (2026-10-12, owner) a proposal — a carried object the screenplay doesn't name — on ANY film
    try{ if(PS && typeof PS.batchSkip==="function" ? PS.batchSkip(p, extracted)
      : (extracted && PS && typeof PS.notInScreenplay==="function" && PS.notInScreenplay(p))) return "screenplay"; }catch(e){}
    return ""; };
  const BLOCK_TEXT = { owner:"needs an owner", screenplay:"not in the screenplay" };
  let prevKind = "";
  const res = ordered.map(scene=>{
    const slug = bdSlug(scene.loc);
    // CONTINUOUS / LATER / SAME keep the previous scene's clock, as on a real stripboard
    let todKind = slug.todKind;
    if(!todKind && /CONTINUOUS|LATER|SAME|MOMENTS/.test(slug.tod)) todKind = prevKind;
    if(todKind) prevKind = todKind;
    if(only && scene.id!==only) return null;
    const sceneShots = (shots||[]).filter(s=> s && s.sceneId===scene.id);
    const clipsSig = JSON.stringify((stageStatus && stageStatus[scene.id]) || null);
    const sig = [scene, todKind, scenes, characters, props, locations, drafts, project, clipsSig].concat(sceneShots);
    const kept = cache && !cache.all && !cache.dirty.has(scene.id) ? cache.rows.get(scene.id) : null;
    if(kept && kept.sig.length===sig.length && kept.sig.every((x,i)=>x===sig[i])) return kept.row;
    const row = bdSceneRow({ scene, slug, todKind, ordered, C, props, locations, sceneShots, drafts, img, tierOf, project, stageStatus, blockOf, BLOCK_TEXT });
    if(cache) cache.rows.set(scene.id, { sig, row });
    return row;
  });
  if(cache){ cache.all = false; cache.dirty.clear(); }
  return only ? res.filter(Boolean) : res;
}
/* which scenes an image event touches (2026-10-09): a shot frame or a storyboard sheet is its own scene's;
   any other image (a sheet, a plate) can be read by every scene, so they all recount. `ids` null = unknown. */
function bdCacheDirty(cache, ids, shots){
  if(!cache) return;
  if(!ids){ cache.all = true; return; }
  const sceneOf = {}; (shots||[]).forEach(s=>{ if(s && s.id) sceneOf[String(s.id)] = s.sceneId; });
  for(const raw of ids){ const id = String(raw||""); if(!id) continue;
    if(sceneOf[id]){ cache.dirty.add(sceneOf[id]); continue; }
    const m = id.match(/^sbsheet-sbpage-(.+)-2x2-\d+$/);
    if(m){ cache.dirty.add(m[1]); continue; }
    cache.all = true; return; }
}
function bdNewCache(){ return { rows:new Map(), dirty:new Set(), all:true }; }
window.bdCacheDirty = bdCacheDirty;
window.bdNewCache = bdNewCache;

function bdSceneRow({ scene, slug, todKind, ordered, C, props, locations, sceneShots, drafts, img, tierOf, project, stageStatus, blockOf, BLOCK_TEXT }){
    const roster = (typeof sceneRoster==="function") ? sceneRoster(scene, C, drafts||{}, sceneShots)
      : (scene.driver ? [scene.driver] : []);
    const cast = roster.map(id=> C.find(c=>c.id===id)).filter(Boolean).map(c=>{
      const spec = (typeof shotCharacterReferenceSpec==="function") ? shotCharacterReferenceSpec(c, scene, ordered) : null;
      const sheetId = (spec && spec.id) || c.id;
      return { id:c.id, name:c.name||"Unnamed", state:(spec && spec.state && String(spec.state.label||"").trim()) || "", sheetId, ready:img(sheetId) };
    });
    const loc = (typeof locationForScene==="function") ? locationForScene(locations||[], scene.id) : null;
    const location = loc ? { id:loc.id, name:loc.name||slug.place||"Location", ready:img(loc.id) } : null;
    const mapped = (props||[]).filter(p=> p && Array.isArray(p.scenes) && p.scenes.indexOf(scene.id)>=0).map(p=>{
      const needs = p.kind==="worn" || tierOf(p)!=="text";
      // WORN = the Shots rule (2026-10-08): it rides on its owner's character sheet; its own macro sheet
      // is optional (close-ups only), so the owner's sheet is enough to be ready
      // (2026-10-09) the owner's sheet THIS scene's frames attach — its appearance variant when there is one
      const ownerC = p.ownerId ? (C||[]).find(c=>c && c.id===p.ownerId) : null;
      const ownerSpec = (ownerC && typeof shotCharacterReferenceSpec==="function") ? (()=>{ try{ return shotCharacterReferenceSpec(ownerC, scene, ordered); }catch(e){ return null; } })() : null;
      const ownerSheet = (ownerSpec && ownerSpec.id) || p.ownerId;
      const macro = img(p.id), onOwner = p.kind==="worn" && !macro && !!(ownerSheet && img(ownerSheet));
      const ready = !needs || !!macro || onOwner;
      return { id:p.id, name:p.name||"Prop", kind:p.kind||"carried", owner:p.ownerName||"", ownerId:p.ownerId||"", needs, onOwner, ready,
        blocked:(needs && !ready && blockOf) ? blockOf(p) : "" };
    });
    const blockedById = {}; mapped.forEach(p=>{ if(p.blocked) blockedById[String(p.id)] = p; });
    // worn items are WARDROBE (part of the cast's look), listed apart from the props
    const wardrobe = mapped.filter(p=> p.kind==="worn");
    const sceneProps = mapped.filter(p=> p.kind!=="worn");
    const rendered = sceneShots.filter(s=> img(s.id)).length;
    // approved = a FRAME you approved (a locked shot with no frame isn't one — 2026-10-05)
    const approved = sceneShots.filter(s=> (s.approved || s.locked) && img(s.id)).length;
    const missing = [], notes = [];
    // THE SAME RULES AS SHOTS (2026-10-03, owner — Breakdown review): with shots, what's missing is
    // exactly what the scene's frames attach and don't have yet (sceneReferenceNeeds — so the room &
    // time plate a scene shoots in counts, not just the main plate), and a frame is done only when
    // it is rendered, APPROVED and CURRENT (shotFrameState). Without the shared helpers (or shots),
    // the older sheet / plate / rendered-frame checks stand.
    const sceneCtx = { scene, scenes:ordered, location:loc, locations:locations||[], project:project||{},
      charById:Object.fromEntries(C.map(c=>[c.id,c])), propById:Object.fromEntries((props||[]).filter(Boolean).map(p=>[p.id,p])) };
    let needs = null;
    if(sceneShots.length && typeof sceneReferenceNeeds==="function"){
      try{ needs = sceneReferenceNeeds(sceneShots, sceneCtx, img); }catch(e){ needs = null; }
    }
    // the card each missing item is made on (2026-10-09): Characters and Props say which card to open
    const cardOf = (n)=> n.kind==="character" ? String(n.baseId||n.id).split(":")[0] : String(n.baseId||n.id);
    if(needs){
      const TAB = { character:"characters", location:"locations", prop:"props" };
      if(!location) missing.push({ tab:"locations", text:"a location card" });
      needs.forEach(n=>{ const b = n.kind==="prop" ? blockedById[String(n.baseId||n.id)] : null;
        if(b){ missing.push({ tab:"props", text:b.name+" \u2014 "+BLOCK_TEXT[b.blocked], need:n, cardId:String(b.id), blocked:b.blocked }); return; }
        missing.push({ tab:TAB[n.kind]||"shots", text:(n.prereq ? (n.name||n.label)+" plate (needed first)" : n.label+(n.kind==="prop"?" sheet":n.kind==="location"?" plate":"")), need:n, cardId:cardOf(n) }); });
    } else {
      cast.filter(c=>!c.ready).forEach(c=> missing.push({ tab:"characters", text: c.state ? (c.name+" \u00b7 "+c.state+" variant") : (c.name+"'s sheet"), cardId:String(c.id) }));
      if(!location) missing.push({ tab:"locations", text:"a location card" });
      else if(!location.ready) missing.push({ tab:"locations", text:location.name+" plate", cardId:String(location.id) });
      sceneProps.filter(p=>!p.ready).forEach(p=> missing.push({ tab:"props", text:p.blocked ? p.name+" \u2014 "+BLOCK_TEXT[p.blocked] : p.name+" sheet", cardId:String(p.id), ...(p.blocked?{ blocked:p.blocked }:{}) }));
      // a worn item needs its owner's sheet, which the cast line above already asks for
    }
    let toRender = 0, oldLook = 0, done = 0, toApprove = 0, approvedOld = 0;
    if(!sceneShots.length) missing.push({ tab:"shots", text:"shots" });
    else if(typeof shotFrameState==="function"){
      let locChanged = 0, charChanged = 0, propChanged = 0;
      // every RENDERED frame counts for the notes, as Shots, Storyboards and the Stage count them (2026-10-08)
      // (2026-10-09, owner — Breakdown review) the same reach as Shots' Render: an approved frame that follows one
      // being re-rendered in the chain re-renders too; and a frame that's only waiting for approval is said apart
      let cascade = 0;
      // (2026-10-09, owner — Breakdown review) in the order Shots' Render walks them (its runPlanFor), so the
      // chain's re-renders count the same
      const chain = (typeof sceneShotsDependencyOrdered==="function") ? sceneShotsDependencyOrdered(sceneShots)
        : (typeof sceneShotsOrdered==="function") ? sceneShotsOrdered(sceneShots) : sceneShots;
      const will = new Set();
      chain.forEach(sh=>{ const st = shotFrameState(sh, sceneShots, drafts, project, img);
        if(!st.done){ toRender++; will.add(sh.id); if(st.rendered && st.current && !st.approved) toApprove++; }
        else { const seed = (typeof seedShotOf==="function") ? seedShotOf(sh, sceneShots) : null;
          if(seed && will.has(seed.id)){ will.add(sh.id); cascade++; } else done++; }
        // an approved frame that is no longer current — the export says how many (2026-10-09)
        if(st.rendered && st.approved && !st.current) approvedOld++;
        if(st.rendered || st.done){ if(st.oldLook) oldLook++; if(st.locChanged) locChanged++; if(st.charChanged) charChanged++; if(st.propChanged) propChanged++; } });
      // a changed location plate is a note, like an earlier look (2026-10-08)
      if(locChanged>0) notes.push({ tab:"shots", text:locChanged+" frame"+(locChanged===1?"":"s")+" made before its location changed \u2014 re-render to apply it" });
      // the same notes the Shots card shows (2026-10-09)
      if(charChanged>0) notes.push({ tab:"shots", text:charChanged+" frame"+(charChanged===1?"":"s")+" made before a character sheet changed \u2014 re-render to apply it" });
      if(propChanged>0) notes.push({ tab:"shots", text:propChanged+" frame"+(propChanged===1?"":"s")+" made before a prop changed \u2014 re-render to apply it" });
      const unrendered = sceneShots.length-rendered, notDone = toRender-unrendered, toRefresh = notDone-toApprove;
      if(unrendered>0) missing.push({ tab:"shots", text:unrendered+" frame"+(unrendered===1?"":"s") });
      if(toApprove>0) missing.push({ tab:"shots", text:toApprove+" frame"+(toApprove===1?"":"s")+" to approve" });
      if(toRefresh>0) missing.push({ tab:"shots", text:toRefresh+" frame"+(toRefresh===1?"":"s")+" to refresh" });
      if(cascade>0) notes.push({ tab:"shots", text:cascade+" approved frame"+(cascade===1?"":"s")+" after "+(cascade===1?"it":"them")+" in the chain re-render"+(cascade===1?"s":"")+" with "+(toRender===1?"it":"them") });
      toRender += cascade;
      // a NOTE, not a block (2026-10-05, owner — Breakdown review): Shots and the Stage treat an earlier
      // colour look the same way; the scene stays ready, and the strip says so
      if(oldLook>0) notes.push({ tab:"shots", text:oldLook+" frame"+(oldLook===1?"":"s")+" with an earlier look \u2014 re-render to apply it" });
    }
    else if(rendered<sceneShots.length){ const n=sceneShots.length-rendered; toRender=n; missing.push({ tab:"shots", text:n+" frame"+(n===1?"":"s") }); }
    // THE CHIPS FOLLOW THE SAME RULE AS THE STATUS (2026-10-05): with shots, an item is missing only when
    // a frame attaches it and it doesn't exist; one no frame uses reads "not in a frame", never red
    // (2026-10-09, owner — Breakdown review) a worn item whose owner's sheet is missing has its own status, "owner":
    // it is on that sheet, which is made first
    if(needs){
      const want = new Set(); needs.forEach(n=>{ want.add(String(n.id)); if(n.baseId) want.add(String(n.baseId)); });
      const st = (ids, ready)=> ids.some(x=>want.has(String(x))) ? "missing" : (ready ? "ready" : "unused");
      cast.forEach(c=>{ c.status = st([c.sheetId, c.id], c.ready); });
      wardrobe.forEach(p=>{ p.status = st([p.id], p.ready); if(p.status==="unused" && p.ownerId) p.status = "owner"; });
      sceneProps.forEach(p=>{ p.status = p.needs ? st([p.id], p.ready) : "text"; });
      // the location chip is ITS plate (2026-10-08): red when a frame — or a room & time plate a frame needs
      // (sceneReferenceNeeds' "needed first") — needs it; a missing room plate is its own line
      if(location){ const mine = needs.find(n=>n.kind==="location" && String(n.id)===String(location.id));
        location.status = mine ? "missing" : (location.ready ? "ready" : "unused");
        if(mine && mine.prereq) location.prereq = true; }
    } else {
      cast.forEach(c=>{ c.status = c.ready ? "ready" : "missing"; });
      wardrobe.forEach(p=>{ p.status = p.ready ? "ready" : (p.ownerId ? "owner" : "missing"); });
      sceneProps.forEach(p=>{ p.status = !p.needs ? "text" : (p.ready ? "ready" : "missing"); });
      if(location) location.status = location.ready ? "ready" : "missing";
    }
    // the scene's storyboard sheets, by the Storyboards tab's own rules (sbSheetStale: other shots or re-rendered frames)
    let boards = null; const boardIds = [];
    if(sceneShots.length && typeof window.sbPageRanges==="function"){
      const ordered2 = sceneShots.slice().sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0));
      boards = { total:0, current:0, stale:0, oldLook:0, partial:0, none:0 };
      const board = (typeof window.sbBoardShots==="function") ? window.sbBoardShots(ordered2) : ordered2;   // one keyframe per beat, as the tab boards it
      (window.sbPageRanges(board)||[]).forEach((rg,i)=>{
        boards.total++;
        const id = "sbsheet-sbpage-"+scene.id+"-2x2-"+i;
        boardIds.push(id);   // looked up on a cold cache like everything else (2026-10-09)
        if(!img(id)){ boards.none++; return; }
        const m = (typeof nbGetMeta==="function") ? nbGetMeta(id) : null;
        const ids = board.slice(rg.start, rg.start+rg.count).map(x=>x.id);
        // a sheet drawn from frames made with an earlier look isn't up to date either (2026-10-08)
        // an uploaded board wasn't drawn from frames — the frames' look doesn't date it
        // decision D (2026-10-09, owner — Breakdown review): ONE rule with Storyboards (sbSheetFromEarlierLook), and
        // it dates the sheet before "frames still missing" does, as sbStoryboardReadiness counts it
        const earlier = (typeof window.sbSheetFromEarlierLook==="function") ? window.sbSheetFromEarlierLook(m, ids, project, scene.id)
          : (!!(m && m.composed) && typeof shotLookIsEarlier==="function" && ids.some(fid=>{ const fm = (typeof nbGetMeta==="function") ? nbGetMeta(fid) : null;
            return !!(fm && shotLookIsEarlier(fm.lookSig, project, scene.id)); }));
        if(typeof window.sbSheetStale==="function" && m && window.sbSheetStale(m, ids)) boards.stale++;
        else if(earlier) boards.oldLook++;
        else if(m && m.composed && Number(m.missing)>0) boards.partial++;   // drawn with frames missing (2026-10-09)
        else boards.current++;
      });
    }
    const clips0 = (stageStatus && stageStatus[scene.id]) || null;
    /* (2026-10-18) counted against an earlier screenplay: a redraft since the last Stage visit changed this scene,
       so the takes the count calls current may be out of date — said so, never shown as done */
    const scriptNow = (typeof window.screenplayDraftSig==="function") ? window.screenplayDraftSig((drafts||{})[scene.id]) : "";
    const scriptChanged = !!(clips0 && clips0.scriptSig && scriptNow && clips0.scriptSig!==scriptNow);
    const clips = clips0 ? (scriptChanged ? { ...clips0, scriptChanged:true } : clips0) : null;
    return { scene, slug:{ ...slug, todKind }, cast, location, wardrobe, props:sceneProps,
      shots:{ total:sceneShots.length, rendered, approved, toRender, toApprove, approvedOld }, framesDone:done, missing, notes, ready:!missing.length,
      needs: needs||[], boards, clips, boardIds };
}

/* film-wide totals — each missing asset counts ONCE however many scenes need it */
/* (2026-10-09, owner — Breakdown review) a frame only waiting for approval is FREE (approve it in Shots): it is its own
   item, never in "frames" or the credit estimate; a prop that needs an owner or a screenplay mention isn't an image to
   make (decision C) — its own item too */
function breakdownSummary(rows){
  const castSheets = new Set(), plates = new Set(), propSheets = new Set(), blocked = new Set();
  let frames = 0, toApprove = 0, noShots = 0, noLoc = 0;
  (rows||[]).forEach(r=>{
    const blockedIds = new Set((r.missing||[]).filter(m=>m && m.blocked && m.cardId).map(m=>String(m.cardId)));
    blockedIds.forEach(id=>blocked.add(id));
    if(r.needs && r.needs.length){
      // the render-plan needs (deduped across scenes by asset id)
      r.needs.forEach(n=>{ if(n.kind==="character"){ castSheets.add(n.id);
          // a variant whose master doesn't exist yet makes the master first (2026-10-09)
          const sid = String(n.id); if(sid.indexOf(":")>0 && n.masterMissing) castSheets.add(sid.split(":")[0]); }
        else if(n.kind==="location") plates.add(n.id); else if(!blockedIds.has(String(n.baseId||n.id))) propSheets.add(n.baseId||n.id); });
      if(!r.location) noLoc++;
    } else {
      r.cast.forEach(c=>{ if(!c.ready) castSheets.add(c.sheetId); });
      if(!r.location) noLoc++; else if(!r.location.ready) plates.add(r.location.id);
      // a worn item needs only its owner's sheet, which the cast line counts (2026-10-09 — it was counted twice)
      r.props.forEach(p=>{ if(!p.ready && !p.blocked) propSheets.add(p.id); });
    }
    if(!r.shots.total) noShots++;
    else { const appr = r.shots.toApprove||0; toApprove += appr;
      frames += (r.shots.toRender!=null ? r.shots.toRender - appr : r.shots.total - r.shots.rendered); }
  });
  // the images still to make, for the "≈ N credits to finish" estimate
  const images = castSheets.size + plates.size + propSheets.size + frames;
  return { total:(rows||[]).length, ready:(rows||[]).filter(r=>r.ready).length,
    castSheets:castSheets.size, plates:plates.size, propSheets:propSheets.size, frames, toApprove, propsBlocked:blocked.size, noShots, noLoc, images };
}

/* the Stage's clips per scene, as the Stage last counted them for this film (it saves them on every
   visit — the clip grouping follows the Stage's model and settings, so it isn't recomputed here) */
function bdStageStatus(projectId){
  try{ const raw = localStorage.getItem("turn_stage_scene_status:"+(projectId||"local")); return raw ? (JSON.parse(raw)||null) : null; }catch(e){ return null; }
}
window.bdStageStatus = bdStageStatus;

const BD_STRIP_LABEL = { "int-day":"INT · Day", "ext-day":"EXT · Day", "int-night":"INT · Night", "ext-night":"EXT · Night", "dusk":"Dawn / Dusk" };
/* the strip colour: dawn/dusk wins; INT/EXT counts as EXT (it is shot as an exterior) */
function bdStripKind(slug){
  if(!slug || !slug.todKind) return "";
  if(slug.todKind==="dusk") return "dusk";
  const ext = slug.ie==="EXT" || slug.ie==="INT/EXT";
  return (ext?"ext-":"int-")+slug.todKind;
}

/* the slate's "To go" cell: the images and frames still to make, short (the full line is its hover) */
function bdToGoShort(sum){
  const t = [];
  if(sum.castSheets) t.push(sum.castSheets+" cast sheet"+(sum.castSheets===1?"":"s"));
  if(sum.plates) t.push(sum.plates+" plate"+(sum.plates===1?"":"s"));
  if(sum.propSheets) t.push(sum.propSheets+" prop sheet"+(sum.propSheets===1?"":"s"));
  if(sum.frames) t.push(sum.frames+" frame"+(sum.frames===1?"":"s"));
  if(sum.toApprove) t.push(sum.toApprove+" to approve");
  if(sum.noShots) t.push(sum.noShots+" without shots");
  return t.join(" \u00b7 ");
}
window.bdToGoShort = bdToGoShort;

// noPrice: the exported stripboard is for the crew — no credit estimate on it (2026-10-09)
function bdSummaryLine(sum, noPrice){
  const todo = [];
  if(sum.castSheets) todo.push(sum.castSheets+" cast sheet"+(sum.castSheets===1?"":"s"));
  if(sum.plates) todo.push(sum.plates+" plate"+(sum.plates===1?"":"s"));
  if(sum.propSheets) todo.push(sum.propSheets+" prop sheet"+(sum.propSheets===1?"":"s"));
  if(sum.frames) todo.push(sum.frames+" frame"+(sum.frames===1?"":"s"));
  if(sum.toApprove) todo.push(sum.toApprove+" frame"+(sum.toApprove===1?"":"s")+" to approve (free, in Shots)");
  if(sum.propsBlocked) todo.push(sum.propsBlocked+" prop"+(sum.propsBlocked===1?" needs":"s need")+" an owner or a screenplay mention");
  if(sum.noShots) todo.push(sum.noShots+" scene"+(sum.noShots===1?"":"s")+" without shots");
  if(sum.noLoc) todo.push(sum.noLoc+" without a location card");
  // what's left to spend, from the current engine's price for one image
  const cost = (!noPrice && sum.images && typeof window.nbImageCostText==="function") ? window.nbImageCostText(sum.images) : "";
  return sum.ready+" of "+sum.total+" scene"+(sum.total===1?"":"s")+" ready to shoot"+(todo.length ? " · to go: "+todo.join(", ") : "")
    +(cost ? " \u00b7 \u2248 "+cost+" credit"+(cost==="1"?"":"s")+" for the images still to make (scenes without shots cost more to design; drafting adds a little writing; Shots gives each run's exact price; video is priced on the Stage)" : "");
}

/* ONE "Make what this scene needs" PROGRESS FOR THE WHOLE APP (2026-10-09, owner — Breakdown review): App exposes
   window.turnSceneNeedsProgress() → { sceneId, i, total, label } | null and dispatches "turn-scene-needs-progress", so a
   running scene still reads "Making 2 of 5…" after a tab switch, and a run started from Shots or the Stage shows here too */
function bdSceneNeedsProgress(){
  try{ const r = (typeof window.turnSceneNeedsProgress==="function") ? window.turnSceneNeedsProgress() : null;
    if(!r || !r.sceneId) return null;
    // a run on ANOTHER film (one you switched away from) isn't this board's
    if(r.filmId && window.turnOpenFilmId && String(r.filmId)!==String(window.turnOpenFilmId)) return null;
    return r; }catch(e){ return null; }
}
window.bdSceneNeedsProgress = bdSceneNeedsProgress;
/* what a finished run says out loud (the screen-reader live region), from makeSceneNeeds' result */
function bdRunResultText(tag, res){
  if(!res || !res.status) return "";
  if(res.status==="cancelled") return tag+": cancelled \u2014 nothing was made.";
  if(res.status==="nothing" || res.status==="refused" || res.status==="busy") return "";
  const made = Number(res.made)||0, failed = Number(res.failed)||0, already = Number(res.already)||0;
  if(res.status==="stopped") return tag+": stopped \u2014 "+made+" made"+(failed?", "+failed+" couldn't be":"")+".";
  return tag+": "+made+" reference image"+(made===1?"":"s")+" made"+(already?", "+already+" already there":"")+(failed?", "+failed+" couldn't be made":"")+".";
}
window.bdRunResultText = bdRunResultText;

function BreakdownView({ project, scenes, characters, props, locations, shots, drafts, setArtView, onMakeSceneNeeds, onOpenStage, readOnly=false, loading=false }){
  const [tick, setTick] = React.useState(0);
  // the price on the summary line follows the engine and the price list (it used to stay stale)
  const [, setPriceTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setPriceTick(t=>t+1);
    ["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(ev=>window.addEventListener(ev, h));
    return ()=>["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(ev=>window.removeEventListener(ev, h)); },[]);
  // ONE "Make what this scene needs" at a time across the board (each strip used to run its own)
  const [needsBusy, setNeedsBusy] = React.useState(null);   // { sceneId, i, total } | null
  // ...and across the app: a run from Shots or the Stage, or one this tab started before you left it (2026-10-09)
  const [appRun, setAppRun] = React.useState(()=>bdSceneNeedsProgress());
  React.useEffect(()=>{ const h = ()=> setAppRun(bdSceneNeedsProgress());
    window.addEventListener("turn-scene-needs-progress", h); h();
    return ()=> window.removeEventListener("turn-scene-needs-progress", h); },[]);
  const run = needsBusy || appRun;
  // SCREEN READERS (2026-10-09): Make's progress and its result are announced
  const [said, setSaid] = React.useState("");
  const checkedRef = React.useRef(new Set());              // ids already looked up on this device
  const [filter, setFilter] = React.useState("all");   // all | todo | ready
  const [found, setFound] = React.useState(()=>new Set());   // ids found in local storage after mount
  // until the image cache is warm every sheet would read as missing — say "checking" instead
  const [checking, setChecking] = React.useState(true);
  const cloud = typeof window.nbBackend==="function" && window.nbBackend()==="cloud";
  // SPEED ON BIG FILMS (2026-10-09, owner — Breakdown review): rows are cached per scene; an image event recounts only
  // the scenes it touches (bdCacheDirty) — the counts are the same as a full recount
  const cacheRef = React.useRef(null); if(!cacheRef.current) cacheRef.current = bdNewCache();
  const shotsRef = React.useRef(shots); shotsRef.current = shots;
  const dirty = (ids)=> bdCacheDirty(cacheRef.current, ids, shotsRef.current);
  // a run delivers images one by one: recount the film once per burst, not once per image (2026-10-05)
  React.useEffect(()=>{
    let t = null;
    const bump = ()=>{ clearTimeout(t); t = setTimeout(()=>setTick(x=>x+1), 250); };
    const idsOf = (e)=>{ const d=(e&&e.detail)||{}; return Array.isArray(d.ids) && d.ids.length ? d.ids : (d.id ? [d.id] : null); };
    // a CLEARED image (a done event with no url) leaves the found set, and may be looked up again (2026-10-09 —
    // a deleted sheet or frame stayed "ready")
    const gone = (e)=>{ const d=(e&&e.detail)||{}; dirty(idsOf(e)); if(d.id && !d.url){ checkedRef.current.delete(d.id);
      setFound(f=>{ if(!f.has(d.id)) return f; const n=new Set(f); n.delete(d.id); return n; }); } bump(); };
    const warmed = (e)=>{ dirty(idsOf(e)); bump(); };
    window.addEventListener("nb-prefetched", warmed); window.addEventListener("nb-gen-done", gone); window.addEventListener("nb-approval-changed", warmed);
    return ()=>{ clearTimeout(t); window.removeEventListener("nb-prefetched", warmed); window.removeEventListener("nb-gen-done", gone); window.removeEventListener("nb-approval-changed", warmed); };
  },[]);
  const mountedRef = React.useRef(true);
  React.useEffect(()=>()=>{ mountedRef.current = false; },[]);
  const [checkFailed, setCheckFailed] = React.useState(false);
  const img = (id)=> found.has(id) || ((typeof nbGetImage==="function") ? !!nbGetImage(id) : false);
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts||{}).tier : "own"; }catch(e){ return "own"; } };
  // the same open-film key the Stage writes with (stageFilmKey — films carry no project.id)
  const stageStatus = bdStageStatus(window.turnOpenFilmId || (project && project.id));
  const rows = React.useMemo(()=> breakdownRows({ scenes, characters, props, locations, shots, drafts, img, tierOf, project, stageStatus, cache:cacheRef.current }),
    [scenes, characters, props, locations, shots, drafts, tick, found, project]);
  const sum = breakdownSummary(rows);
  // a cloud film: ONE batched prefetch (shared with the Art Room's own) warms every asset url
  React.useEffect(()=>{
    if(!cloud) return;
    let alive = true;
    // a prefetch that FAILS says so (2026-10-09 — everything read as missing, with export enabled); nbPrefetchAll
    // resolves { ok:false } on a failed or timed-out check (2026-10-09, fourth pass — it never rejected), and forgets
    // it, so reopening the tab checks again
    Promise.resolve(typeof nbPrefetchAll==="function" ? nbPrefetchAll() : null).then((r)=>({ ok:!(r && r.ok===false) }), ()=>({ ok:false }))
      .then((r)=>{ if(alive){ dirty(null); setCheckFailed(!(r && r.ok)); setChecking(false); setTick(t=>t+1); } });
    return ()=>{ alive=false; };
  },[project && project.id]);
  // a film stored on this device keeps large sheets in IndexedDB (async): look up what the
  // synchronous cache didn't have, once per id, so a finished sheet never reads as missing
  React.useEffect(()=>{
    if(cloud) return;
    if(typeof nbLoadImage!=="function"){ setChecking(false); return; }
    const want = new Set();
    // every id a strip or its frames' needs name — wardrobe, rooms & times and variants too (2026-10-05), and
    // (2026-10-09) the scene's storyboard sheets and each cast member's / worn item owner's master sheet
    rows.forEach(r=>{ r.cast.forEach(c=>{ if(!c.ready) want.add(c.sheetId); if(c.id && !img(c.id)) want.add(c.id); });
      if(r.location && !r.location.ready) want.add(r.location.id);
      r.props.concat(r.wardrobe||[]).forEach(p=>{ if(!p.ready) want.add(p.id); if(p.ownerId && !img(p.ownerId)) want.add(p.ownerId); });
      (r.needs||[]).forEach(n=>{ if(n && n.id) want.add(n.id); });
      (r.boardIds||[]).forEach(id=>{ if(!img(id)) want.add(id); });
      (shots||[]).forEach(s=>{ if(s && s.sceneId===r.scene.id && !img(s.id)) want.add(s.id); }); });
    // each id is looked up once (a later render lands in the synchronous cache anyway)
    const ids = [...want].filter(id=> !found.has(id) && !checkedRef.current.has(id));
    ids.forEach(id=>checkedRef.current.add(id));
    if(!ids.length){ setChecking(false); return; }
    // NOT cancelled by a re-render (2026-10-09): a pass interrupted by the next tick left its ids marked as
    // checked but never looked up, so finished sheets stayed missing — only leaving the tab stops it
    (async ()=>{
      const hit = [];
      for(const id of ids){ try{ if(await nbLoadImage(id)) hit.push(id); }catch(e){} if(!mountedRef.current) return; }
      if(!mountedRef.current) return;
      if(hit.length){ dirty(hit); setFound(f=>{ const n=new Set(f); hit.forEach(x=>n.add(x)); return n; }); }
      setChecking(false);
    })();
  },[rows.length, (shots||[]).length, tick]);
  // the ⋮ menu's "Export stripboard" while this tab is open
  // (not while "Checking…": every sheet would print as missing — 2026-10-05)
  React.useEffect(()=>{ window.turnExportBreakdown = checking
      ? ()=>{ if(typeof window.appToast==="function") window.appToast("The Breakdown is still checking which sheets and frames exist \u2014 export it in a moment.","info"); }
      : ()=> exportStripboard(rows, project, { checkFailed });
    return ()=>{ if(window.turnExportBreakdown) delete window.turnExportBreakdown; }; });

  // OPEN ON THE SCENE (2026-10-03): the tab opens focused on this strip's scene ("render" also
  // starts Shots' Render Scene NN, which asks first with its price)
  const go = (tab, sceneId, action)=>{
    if(!tab || !setArtView) return;
    if(sceneId && typeof window.turnFocusArtScene==="function") window.turnFocusArtScene(tab, sceneId, action);
    setArtView(tab);
  };
  // ONE BIBLE AT A TIME, FROM ANYWHERE (2026-10-09, owner — Breakdown review): the guard lives in exportArtBible (this
  // button and the ⋮ menu share it); the button follows its progress, "Preparing 12 of 140…"
  const [bible, setBible] = React.useState(()=> (typeof window.bdBibleProgress==="function" ? window.bdBibleProgress() : null));
  React.useEffect(()=>{ const h = ()=> setBible(typeof window.bdBibleProgress==="function" ? window.bdBibleProgress() : null);
    window.addEventListener("turn-art-bible-progress", h); return ()=> window.removeEventListener("turn-art-bible-progress", h); },[]);
  const bibleBusy = !!bible;
  const [exportOpen, setExportOpen] = React.useState(false);
  React.useEffect(()=>{ if(!exportOpen) return undefined;
    const away = (e)=>{ if(!(e.target.closest && e.target.closest(".bd-export"))) setExportOpen(false); };
    const esc = (e)=>{ if(e.key==="Escape") setExportOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return ()=>{ document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); }; },[exportOpen]);
  const exportBible = ()=>{ if(bibleBusy) return; exportArtBible({ project, characters, props, locations, scenes, drafts, shots }); };
  const shown = rows.filter(r=> filter==="all" || (filter==="ready" ? r.ready : !r.ready));
  // the live region says the run's progress, then its result
  const tagOf = (sid)=>{ const r = rows.find(x=>x.scene.id===sid); return "Scene "+String(r && r.scene.no!=null ? r.scene.no : "").padStart(2,"0"); };
  const runSaid = run && run.total ? tagOf(run.sceneId)+": making "+(run.i||0)+" of "+run.total+(run.label?" \u2014 "+run.label:"")+"\u2026" : "";
  const header = _bdEl("div",{className:"art-intro"},
    _bdEl("div",{className:"sb-sr-only",role:"status","aria-live":"polite","aria-atomic":"true"}, runSaid || said),
    _bdEl("div",{className:"art-intro-row"},
      _bdEl("div",null,
        _bdEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"First Assistant Director",
          window.InfoTip && _bdEl(window.InfoTip,{label:"About the Breakdown",
            text:"The Breakdown is your stripboard: one strip per scene, in story order, coloured the way film crews colour them \u2014 white for INT day, yellow for EXT day, blue for INT night, green for EXT night, pink for dawn and dusk, grey when the slugline has no time of day. Each strip lists who is in the scene (in the look they wear there), its location, the props it needs and its shots, and says what is still missing before the scene can be shot: a cast sheet or appearance variant, a location plate (a room's location plate comes first), a prop sheet, shot frames, frames to approve (free, in Shots) or to refresh \u2014 and notes for frames made before a look, sheet, location or prop changed. A worn item is ready when it's on its owner's character sheet; until that sheet exists it reads \u201con their sheet \u2014 make that first\u201d. A carried prop with no owner, or one the screenplay doesn't mention, says so: it needs an owner or a screenplay mention on its card, not an image. Click a missing item to open its tab on this scene. Two buttons on a strip spend credits: \u201cMake what this scene needs\u201d makes the missing reference images (it asks first, with the price, and drafts any look that isn't written yet), and \u201cRender Scene NN\u201d opens Shots on that scene, which asks with the exact price. Each strip also shows its storyboard sheets and, as of your last visit to the Stage, its video clips. Each scene is one line — its five dots say whether its cast, place, shots, board and clips are done; click the line to open the full strip. Export the stripboard or the whole art department bible from Export."})),
        // say why the spending buttons aren't there (2026-10-09) — while a film is still loading, say that instead
        loading ? _bdEl("div",{className:"bd-sum bd-readonly"},"Loading\u2026")
          : readOnly && rows.length>0 && _bdEl("div",{className:"bd-sum bd-readonly"},"View only \u2014 your role can't make images or render here.")),
      rows.length>0 && !checking && _bdEl("div",{className:"art-intro-actions"},
        // the two exports under ONE "Export" menu (owner 2026-10-23, option A; they also stay in the top bar's \u22ee menu)
        _bdEl("div",{className:"bd-export"},
          _bdEl("button",{type:"button",className:"art-draftall ghost",onClick:()=>setExportOpen(o=>!o),"aria-haspopup":"menu","aria-expanded":exportOpen?"true":"false",
            title:"Export the stripboard or the art department bible"},
            _bdEl(Icon.download,{s:14}), "Export", _bdEl(Icon.chevD,{s:12})),
          exportOpen && _bdEl("div",{className:"bd-export-menu",role:"menu"},
            _bdEl("button",{type:"button",role:"menuitem",className:"bd-export-item",onClick:()=>{ setExportOpen(false); exportStripboard(rows, project, { checkFailed }); },
              title:"Preview the stripboard as a printable document, then print / save as PDF or download it"},"Export stripboard"),
            _bdEl("button",{type:"button",role:"menuitem",className:"bd-export-item",onClick:()=>{ setExportOpen(false); exportBible(); },disabled:bibleBusy,"aria-busy":bibleBusy?"true":undefined,
              title:"The cast, props and locations as one printable document, with their current sheets (and appearance states, rooms & times) embedded"},
              bibleBusy?(bible.total ? "Preparing "+bible.i+" of "+bible.total+"\u2026" : "Preparing\u2026"):"Art department bible"))))),
    /* THE SLATE (owner 2026-10-23, option A, as the other Art Room tabs): Ready \u00b7 To go \u00b7 Cost \u00b7 Show */
    rows.length>0 && _bdEl("div",{className:"loc-slate art-slate bd-slate",role:"group","aria-label":"Breakdown: ready, to go, cost and which scenes to show"},
      _bdEl("div",{className:"loc-slate-cell"},
        _bdEl("span",{className:"loc-slate-lab"},"Ready"),
        _bdEl("b",null, checking ? "Checking\u2026" : sum.ready+" of "+sum.total+" scene"+(sum.total===1?"":"s"))),
      _bdEl("div",{className:"loc-slate-cell bd-slate-togo",title:checkFailed ? "" : bdSummaryLine(sum)},
        _bdEl("span",{className:"loc-slate-lab"},"To go"),
        _bdEl("b",{className:checkFailed?"bd-slate-warn":""}, checking ? "Checking which sheets and frames exist\u2026"
          : checkFailed ? "Couldn't check which sheets and frames exist (no connection?) \u2014 the counts below may be too high. Reopen the tab to check again."
          : (bdToGoShort(sum) || "Nothing \u2014 every scene is ready"))),
      (!checking && !checkFailed && sum.images>0 && typeof window.nbImageCostText==="function") && _bdEl("div",{className:"loc-slate-cell",
          title:"For the images still to make, at the current engine's price \u2014 scenes without shots cost more to design; drafting adds a little writing; Shots gives each run's exact price; video is priced on the Stage"},
        _bdEl("span",{className:"loc-slate-lab"},"Cost"),
        _bdEl("b",null,"\u2248 "+window.nbImageCostText(sum.images)+" credits")),
      _bdEl("label",{className:"loc-slate-cell bd-slate-show"},
        _bdEl("span",{className:"loc-slate-lab"},"Show"),
        _bdEl("select",{className:"prop-select",value:filter,onChange:e=>setFilter(e.target.value),"aria-label":"Show scenes"},
          [["all","All"],["todo","Needs work"],["ready","Ready"]].map(([id,lab])=>_bdEl("option",{key:id,value:id},
            lab+" ("+(id==="all"?rows.length:id==="ready"?sum.ready:rows.length-sum.ready)+")"))))));

  if(!rows.length){
    return _bdEl("div",{className:"art-scroll"}, header,
      _bdEl("div",{className:"prop-empty"},
        _bdEl("div",{className:"art-soon-ic"},_bdEl(Icon.grid,{s:30})),
        _bdEl("div",{className:"art-soon-t"},"No scenes to break down yet"),
        _bdEl("div",{className:"art-soon-d"},"Build the story in the Writers' Room — every scene gets a strip here, with its cast, props, location and shots.")));
  }
  if(checking){
    return _bdEl("div",{className:"art-scroll"}, header,
      _bdEl("div",{className:"bd-none",role:"status"}, _bdEl("span",{className:"ai-typing","aria-hidden":"true"},_bdEl("i",null),_bdEl("i",null),_bdEl("i",null)),
        _bdEl("span",{className:"sb-sr-only"},"Checking which sheets and frames exist\u2026")));
  }
  return _bdEl("div",{className:"art-scroll"}, header,
    // the strip colours as a quiet key under the slate, each named (2026-10-23: the long row became swatches with their names)
    _bdEl("div",{className:"bd-legend",role:"group","aria-label":"Strip colours"},
      Object.keys(BD_STRIP_LABEL).map(k=> _bdEl("span",{key:k,className:"bd-legend-i"}, _bdEl("span",{className:"bd-sw bd-k-"+k}), BD_STRIP_LABEL[k])),
      // the export's legend has it — the tab's does too (2026-10-09)
      _bdEl("span",{key:"none",className:"bd-legend-i"}, _bdEl("span",{className:"bd-sw bd-k-none"}), "No time of day")),
    // SCREEN READERS (2026-10-09): the strips are a list, each under its scene heading
    _bdEl("div",{className:"bd-board",role:"list","aria-label":"Scenes"},
      shown.length ? shown.map(r=> _bdEl(BreakdownLine,{key:r.scene.id, row:r, go, onMakeSceneNeeds, needsBusy:run, setNeedsBusy, onOpenStage, readOnly, onSaid:setSaid}))
        : _bdEl("div",{className:"bd-none",role:"listitem"}, filter==="ready" ? "No scene is ready to shoot yet." : "Every scene is ready to shoot.")));
}
window.BreakdownView = BreakdownView;

const BD_PROPS_SHOWN = 6;
function BreakdownStrip({ row, go:goTab, onMakeSceneNeeds, needsBusy=null, setNeedsBusy=()=>{}, onOpenStage, readOnly=false, onSaid=()=>{}, nested=false }){
  const { scene, slug, cast, location, wardrobe, props, shots, missing, ready } = row;
  const go = (tab, action)=> goTab(tab, scene.id, action);   // every link opens on THIS scene
  const needsRun = (needsBusy && needsBusy.sceneId===scene.id) ? needsBusy : null;
  // decision C (2026-10-09): a prop that needs an owner or a screenplay mention isn't made here
  const blockedIds = new Set((missing||[]).filter(m=>m && m.blocked && m.cardId).map(m=>String(m.cardId)));
  const makeable = (row.needs||[]).filter(n=>n.makeable && !(n.kind==="prop" && blockedIds.has(String(n.baseId||n.id))));
  // the images it really makes — a variant whose master is missing makes the master too (2026-10-09)
  // (2026-10-09) the plan's own count (turnSceneNeedsImageCount, the number its question asks about) when App has it
  const makeImages = (typeof window.turnSceneNeedsImageCount==="function") ? window.turnSceneNeedsImageCount(makeable)
    : (typeof window.sceneNeedsImageCount==="function") ? window.sceneNeedsImageCount(makeable) : makeable.length;
  const [allMissing, setAllMissing] = React.useState(false);   // the status column's "+N more" opens the rest
  const tag = "Scene "+String(scene.no!=null?scene.no:"").padStart(2,"0");
  const makeNeeds = async ()=>{
    if(!onMakeSceneNeeds || needsBusy || !makeable.length) return;
    // busy only once the run starts (after its question) — the strip read "Making 0 of N" while you decided
    onSaid("");
    let res = null;
    try{ res = await onMakeSceneNeeds(scene, makeable, (i,total,label)=>setNeedsBusy({ sceneId:scene.id, i, total, label:label||"" }), { from:"breakdown" }); }
    finally{ setNeedsBusy(null); }
    onSaid(bdRunResultText(tag, res));
  };
  // ONE SCENE, FROM HERE: make what it needs, then render it (both priced)
  const canRender = !readOnly && shots.total>0 && !(row.needs||[]).length && (shots.toRender||0)>0;
  const sceneActs = (onMakeSceneNeeds && makeable.length>0) || canRender ? _bdEl("div",{className:"bd-strip-acts"},
    (onMakeSceneNeeds && makeable.length>0) && _bdEl("button",{type:"button",className:"bd-act",disabled:!!needsBusy,onClick:makeNeeds,
        "aria-busy":needsRun?"true":undefined,
        "aria-label": (needsBusy && !needsRun) ? "Make what this scene needs (wait: another scene is making its images)" : undefined,
        title: (needsBusy && !needsRun) ? "Another scene is making its images \u2014 one at a time"
          : "Make the "+makeImages+" missing reference image"+(makeImages!==1?"s":"")+" this scene's frames use (location plates, rooms & times, character sheets, prop sheets \u2014 in that order). Asks first, with the price; a look that isn't written yet is drafted first (writing credits)."},
      needsRun ? ("Making "+(needsRun.i||0)+" of "+needsRun.total+"\u2026") : "Make what this scene needs",
      !needsRun && typeof window.nbCostChip==="function" && window.nbCostChip(makeImages)),
    canRender && _bdEl("button",{type:"button",className:"bd-act",onClick:()=>go("shots","render"),
        title:"Open Shots on this scene and render its "+shots.toRender+" frame"+(shots.toRender!==1?"s":"")+" that aren't approved and current (a frame only waiting for approval is re-rendered too \u2014 approve it in Shots instead, free) \u2014 Shots asks first, with the exact price"},
      "Render "+tag,
      typeof window.nbCostChip==="function" && window.nbCostChip(shots.toRender))) : null;
  // a run from elsewhere (Shots, the Stage) on THIS scene shows here too, with no buttons to press (2026-10-09)
  const runNote = needsRun && !(onMakeSceneNeeds && makeable.length>0)
    ? _bdEl("div",{className:"bd-strip-acts"}, _bdEl("span",{className:"bd-act is-run","aria-hidden":"true"}, "Making "+(needsRun.i||0)+" of "+needsRun.total+"\u2026")) : null;
  const [allProps, setAllProps] = React.useState(false);
  const [allWorn, setAllWorn] = React.useState(false);
  const kind = bdStripKind(slug);
  const dot = (ok)=> _bdEl("span",{className:"bd-dot"+(ok===true?" ok":ok==="unused"?" unused":ok==="owner"?" owner":""),"aria-hidden":"true"});
  // ok: true (ready) | false (missing) | "unused" (no frame of this scene attaches it — never red) | "owner" (a worn item
  // on its owner's sheet, which is missing). The status is READ too, not only shown by the dot's colour or on hover
  // (2026-10-09); each chip passes its own words for every status (the "unused" text used to be cut out of the missing one)
  const chip = (key, label, ok, tab, title)=>
    _bdEl("button",{key, type:"button", className:"bd-chip"+(ok===true?" ok":ok==="unused"?" unused":ok==="owner"?" owner":""), onClick:()=>go(tab),
      title, "aria-label":String(title||label)+(ok===true?" (ready)":(ok==="unused"||ok==="owner")?"":" (missing)")}, dot(ok), _bdEl("span",{className:"bd-chip-t"},label));
  const okOf = (x)=> !x ? false : (x.status==="unused" || x.status==="owner") ? x.status : x.status ? x.status==="ready" : !!x.ready;
  const NOT_IN_FRAME = " \u2014 not in any of this scene's frames";
  const propsShown = allProps ? props : props.slice(0, BD_PROPS_SHOWN);
  const wornShown = allWorn ? wardrobe : wardrobe.slice(0, BD_PROPS_SHOWN);
  const more = (list, open, set)=> list.length>BD_PROPS_SHOWN && _bdEl("button",{type:"button",className:"bd-chip more",onClick:()=>set(v=>!v),"aria-expanded":open?"true":"false"},
    open ? "Show fewer" : "+"+(list.length-BD_PROPS_SHOWN)+" more");
  const headId = "bd-h-"+String(scene.id).replace(/[^\w-]/g,"_");
  // inside its one-line row (2026-10-23) the row is the list item; the strip is a region under its heading
  return _bdEl("div",{className:"bd-strip"+(kind?" bd-k-"+kind:"")+(ready?" is-ready":""),role:nested?"region":"listitem","aria-labelledby":headId},
    _bdEl("div",{className:"bd-strip-id"},
      _bdEl("div",{className:"bd-strip-no","aria-hidden":"true"}, String(scene.no!=null?scene.no:"").padStart(2,"0")),
      _bdEl("div",{className:"bd-strip-ie"}, [slug.ie, slug.tod].filter(Boolean).join(" · ") || "—")),
    _bdEl("div",{className:"bd-strip-body"},
      _bdEl("div",{className:"bd-strip-head"},
        _bdEl("h3",{className:"bd-strip-title",id:headId}, _bdEl("span",{className:"sb-sr-only"},tag+": "), scene.title||"Untitled scene",
          _bdEl("span",{className:"sb-sr-only"}, ready ? " \u2014 ready" : " \u2014 "+missing.length+" to go")),
        _bdEl("div",{className:"bd-strip-set"}, slug.place || (location && location.name) || "")),
      _bdEl("div",{className:"bd-rows"},
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Cast"),
          _bdEl("div",{className:"bd-chips"}, cast.length ? cast.map(c=>{ const ok = okOf(c);
              const who = c.state ? c.name+"'s "+c.state+" variant" : c.name+"'s sheet";
              return chip(c.id, c.state ? [c.name, _bdEl("span",{key:"s",className:"bd-chip-sub"}," \u00b7 "+c.state)] : c.name,
                ok, "characters", ok===true ? who+" is ready" : ok==="unused" ? (c.ready ? who+" is ready" : c.name)+NOT_IN_FRAME
                  : (c.state ? c.name+" needs the "+c.state+" variant" : c.name+" needs a character sheet")); })
            : _bdEl("span",{className:"bd-empty"},"No one named in this scene"))),
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Location"),
          _bdEl("div",{className:"bd-chips"}, location ? (()=>{ const ok = okOf(location);
              return chip("loc", location.name, ok, "locations", ok===true ? "The plate is ready"
                : ok==="unused" ? "The "+location.name+" plate"+NOT_IN_FRAME
                : location.prereq ? "Needs its location plate \u2014 this scene's rooms & times are made from it" : "Needs its location plate"); })()
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>go("locations"),title:"No location card resolves to this scene — check its slugline"}, dot(false), "No location card"))),
        wardrobe.length>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Wardrobe"),
          _bdEl("div",{className:"bd-chips"}, wornShown.map(p=>{ const ok = okOf(p), owner = p.owner||"its owner";
              return chip(p.id, ok==="owner" ? [p.name, _bdEl("span",{key:"s",className:"bd-chip-sub"}," \u00b7 on "+owner+"\u2019s sheet")] : p.name, ok, p.onOwner || !p.ready ? "characters" : "props",
                p.name+(p.owner ? " \u2014 worn by "+p.owner : "")+" \u00b7 "+(p.onOwner ? "on "+owner+"\u2019s character sheet"
                  : p.ready ? "close-up sheet ready" : ok==="owner" ? "on "+owner+"\u2019s sheet \u2014 make that first" : "rides on "+owner+"\u2019s character sheet \u2014 make that sheet first")); }),
            more(wardrobe, allWorn, setAllWorn))),
        props.length>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Props"),
          _bdEl("div",{className:"bd-chips"}, propsShown.map(p=>{ const ok = okOf(p);
              if(!p.needs) return _bdEl("button",{key:p.id,type:"button",className:"bd-chip text",onClick:()=>go("props"),title:p.name+" \u2014 text only: shots describe it from its specification"},
                _bdEl("span",{className:"bd-chip-t"},p.name), _bdEl("span",{className:"bd-chip-sub"}," \u00b7 text"));
              // decision C (2026-10-09): what it needs is an owner, or a screenplay mention — set on its card
              const blk = p.blocked==="owner" ? "needs an owner" : p.blocked==="screenplay" ? "not in the screenplay" : "";
              return chip(p.id, blk ? [p.name, _bdEl("span",{key:"s",className:"bd-chip-sub"}," \u2014 "+blk)] : p.name, ok, "props",
                ok==="unused" ? (p.ready ? p.name+" \u2014 sheet ready" : p.name)+NOT_IN_FRAME
                : blk ? p.name+" \u2014 "+(p.blocked==="owner" ? "needs an owner: choose who carries it on its card, then make its sheet" : "not in the screenplay: it's made from its own card, once you confirm it there")
                : p.name+" \u2014 "+(p.ready ? "sheet ready" : "needs its prop sheet")+(p.owner ? " \u00b7 "+p.kind+" by "+p.owner : "")); }),
            more(props, allProps, setAllProps))),
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Shots"),
          _bdEl("div",{className:"bd-chips"}, shots.total
            ? (()=>{ const allDone = (shots.toRender||0)===0 && shots.rendered===shots.total;   // green = every frame approved and current
                return _bdEl("button",{type:"button",className:"bd-chip"+(allDone?" ok":""),onClick:()=>go("shots"),
                  title: allDone ? "Every frame is approved and up to date \u2014 open the Shots tab" : (shots.toRender+" frame"+(shots.toRender===1?"":"s")+" still to render, approve or refresh \u2014 open the Shots tab")},
                  dot(allDone), shots.total+" shot"+(shots.total===1?"":"s")+" · "+shots.rendered+" rendered"+(shots.approved?" · "+shots.approved+" approved":"")); })()
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>go("shots"),title:"Design this scene's shots (one keyframe per beat) in the Shots tab"}, dot(false), "No shots yet"))),
        // STORYBOARDS + THE STAGE on the strip (2026-10-05, owner — Breakdown review), read-only
        row.boards && row.boards.total>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Boards"),
          _bdEl("div",{className:"bd-chips"},
            _bdEl("button",{type:"button",className:"bd-chip"+(row.boards.current===row.boards.total?" ok":""),onClick:()=>go("storyboard"),
                title:"Storyboard sheets drawn from this scene's current shots and frames \u2014 open the Storyboards tab (composing is free)"},
              dot(row.boards.current===row.boards.total), bdBoardsText(row.boards)))),
        shots.total>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Clips"),
          _bdEl("div",{className:"bd-chips"}, row.clips && row.clips.total
            ? _bdEl("button",{type:"button",className:"bd-chip"+(bdClipsDone(row.clips)?" ok":""),
                onClick:()=>onOpenStage&&onOpenStage(), disabled:!onOpenStage,
                title:"The Stage's video clips for this scene, as of your last visit to the Stage \u2014 open the Stage"},
                dot(bdClipsDone(row.clips)), bdClipsText(row.clips)+(row.clips.scriptChanged?"":" (at your last Stage visit)"))
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>onOpenStage&&onOpenStage(),disabled:!onOpenStage,
                title:"Video clips are counted when you visit the Stage"}, dot("unused"), "Counted on your next visit to the Stage")))),
      (row.notes||[]).length>0 && _bdEl("div",{className:"bd-notes"}, row.notes.map((n,i)=>
        _bdEl("button",{key:i,type:"button",className:"bd-note",onClick:()=>go(n.tab)}, Icon.info&&_bdEl(Icon.info,{s:12}), n.text))),
      sceneActs || runNote),
    _bdEl("div",{className:"bd-strip-status"+(ready?" ok":"")},
      ready ? _bdEl(React.Fragment,null, _bdEl(Icon.check,{s:14}), "Ready")
        : _bdEl(React.Fragment,null, _bdEl("span",{className:"bd-need-n"}, missing.length), _bdEl("span",null,"to go"),
            _bdEl("div",{className:"bd-need-list"}, (allMissing ? missing : missing.slice(0,4)).map((m,i)=> _bdEl("button",{key:i,type:"button",className:"bd-need",title:m.text,onClick:()=>go(m.tab)}, m.text)),
              missing.length>4 && _bdEl("button",{type:"button",className:"bd-need more","aria-expanded":allMissing?"true":"false",onClick:()=>setAllMissing(v=>!v)},
                allMissing ? "Show fewer" : "+"+(missing.length-4)+" more")))));
}

/* ONE LINE PER SCENE (owner 2026-10-23, option A): number, INT/EXT \u00b7 time, title, set, five status dots (Cast \u00b7
   Place \u00b7 Shots \u00b7 Board \u00b7 Clips) and "N to go" / Ready; opening it shows the full strip (BreakdownStrip) under it. */
function BreakdownLine(props){
  const { row } = props;
  const { scene, slug, cast, location, shots, missing, ready } = row;
  const [open, setOpen] = React.useState(false);
  const kind = bdStripKind(slug);
  const allOk = (list)=> list.length>0 && list.every(x=> x.status ? (x.status==="ready" || x.status==="unused") : !!x.ready);
  const st = {
    cast: !cast.length ? "none" : allOk(cast) ? "ok" : "todo",
    place: !location ? "todo" : (location.status ? location.status==="ready" || location.status==="unused" : !!location.ready) ? "ok" : "todo",
    shots: !shots.total ? "todo" : ((shots.toRender||0)===0 && shots.rendered===shots.total) ? "ok" : "todo",
    board: !(row.boards && row.boards.total) ? "none" : row.boards.current===row.boards.total ? "ok" : "todo",
    clips: !(row.clips && row.clips.total) ? "none" : bdClipsDone(row.clips) ? "ok" : "todo",
  };
  const WORD = { ok:"ready", todo:"to do", none:"not yet" };
  const dots = [["cast","Cast"],["place","Place"],["shots","Shots"],["board","Board"],["clips","Clips"]];
  const tag = "Scene "+String(scene.no!=null?scene.no:"").padStart(2,"0");
  return _bdEl("div",{className:"bd-line"+(kind?" bd-k-"+kind:"")+(ready?" is-ready":"")+(open?" open":""),role:"listitem"},
    _bdEl("button",{type:"button",className:"bd-line-head","aria-expanded":open?"true":"false",onClick:()=>setOpen(o=>!o),
        title:(open?"Hide":"Show")+" what "+tag+" needs"},
      _bdEl("span",{className:"bd-line-no"}, String(scene.no!=null?scene.no:"").padStart(2,"0")),
      _bdEl("span",{className:"bd-line-ie"}, [slug.ie, slug.tod].filter(Boolean).join(" \u00b7 ") || "\u2014"),
      _bdEl("span",{className:"bd-line-title"}, scene.title||"Untitled scene",
        _bdEl("span",{className:"bd-line-set"}, slug.place || (location && location.name) || "")),
      _bdEl("span",{className:"bd-line-dots"}, dots.map(([k,lab])=>_bdEl("span",{key:k,className:"bd-line-dot "+st[k],title:lab+": "+WORD[st[k]]},
        _bdEl("i",{"aria-hidden":"true"}), lab, _bdEl("span",{className:"sb-sr-only"}," "+WORD[st[k]])))),
      _bdEl("span",{className:"bd-line-left"+(ready?" ok":"")}, ready ? "Ready" : missing.length+" to go"),
      _bdEl(open?Icon.chevD:Icon.chevR,{s:14})),
    open && _bdEl("div",{className:"bd-line-body"}, _bdEl(BreakdownStrip, { ...props, nested:true })));
}
window.BreakdownLine = BreakdownLine;

/* the Boards and Clips words, shared by the strip and the exported stripboard (2026-10-09) */
function bdBoardsText(b){
  if(!b || !b.total) return "";
  return b.current+" of "+b.total+" sheet"+(b.total===1?"":"s")+" up to date"+(b.stale?" \u00b7 "+b.stale+" out of date":"")
    +(b.oldLook?" \u00b7 "+b.oldLook+" from frames with an earlier look":"")
    +(b.partial?" \u00b7 "+b.partial+" with frames still missing":"")
    +(b.none?" \u00b7 "+b.none+" not composed yet":"");
}
/* B14 (2026-10-09, owner — Breakdown review): the Stage leaves a clip out of the film when a character's identity
   changed after its take — `identity` in the Stage's saved counts (read when present) */
function bdClipsDone(c){ return !!c && !c.scriptChanged && c.rendered===c.total && !c.stale && !(Number(c.identity)>0); }
function bdClipsText(c){
  if(!c || !c.total) return "";
  if(c.scriptChanged) return "Script changed since your last Stage visit \u2014 open the Stage to recount";
  const idn = Number(c.identity)||0;
  return c.rendered+" of "+c.total+" clip"+(c.total===1?"":"s")+" rendered"
    +(c.stale?" \u00b7 "+c.stale+" out of date":"")
    +(idn?" \u00b7 "+idn+" left out \u2014 a character changed; check "+(idn===1?"it":"them")+" in Takes":"")
    +(c.oldLook?" \u00b7 "+c.oldLook+" earlier look":"")
    +(c.notes?" \u00b7 "+c.notes+" with take notes":"");
}
window.bdClipsText = bdClipsText;
window.bdBoardsText = bdBoardsText;

/* B13 — ONE SCENE COUNT (2026-10-09, owner decision B — Breakdown review): the Characters and Props tabs count what a
   scene still needs with the Breakdown's own rules (the appearance variant this scene's frames use counts, an undrafted
   prop counts) and say which card to open for each; a carried prop with no owner, or one the screenplay doesn't name,
   is listed as needing that (decision C), not as an image to make. `film` fields left out are read from the open film
   (window.turnContinuity). Returns [{ text, cardId, blocked, variant }] for "characters" or "props". */
function bdSceneCardNeeds(sceneId, kind, film){
  if(!sceneId) return [];
  const T = window.turnContinuity || {}, f = film || {};
  const pick = (k)=> f[k]!==undefined && f[k]!==null ? f[k] : T[k];
  const img = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const drafts = pick("drafts") || {};
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts).tier : "own"; }catch(e){ return "own"; } };
  let rows = [];
  try{ rows = breakdownRows({ scenes:pick("scenes")||[], characters:pick("characters")||[], props:pick("props")||[], locations:pick("locations")||[],
    shots:pick("shots")||[], drafts, img, tierOf, project:f.project||window.turnProject||{}, stageStatus:null, only:sceneId }); }catch(e){ rows = []; }
  const r = rows[0]; if(!r) return [];
  const tab = kind==="characters" ? "characters" : "props";
  return (r.missing||[]).filter(m=> m && m.tab===tab && m.cardId).map(m=>({ text:m.text, cardId:String(m.cardId), blocked:m.blocked||"",
    variant: tab==="characters" && !!(m.need && String(m.need.id).indexOf(":")>0) }));
}
window.bdSceneCardNeeds = bdSceneCardNeeds;
/* the line under a tab's "Focus a scene" bar: the scene's count, and one chip per item that opens its card */
function BdSceneNeedsLine({ sceneId, sceneNo, kind, film, list, onFind }){
  const items = bdSceneCardNeeds(sceneId, kind, film);
  if(!items.length) return null;
  const byId = {}; (list||[]).forEach(x=>{ if(x && x.id) byId[String(x.id)] = x; });
  const tag = "Scene "+String(sceneNo!=null?sceneNo:"").padStart(2,"0");
  const noun = kind==="characters" ? "character image" : "prop";
  const open = (id, name)=>{
    const sel = kind==="characters" ? '[data-char-card="'+id+'"]' : '[data-prop-card="'+id+'"]';
    const el = (typeof document!=="undefined" && document.querySelector) ? document.querySelector(sel) : null;
    if(el && el.scrollIntoView){ try{ el.scrollIntoView({ block:"center" }); }catch(e){ el.scrollIntoView(); } return; }
    if(onFind) onFind(name||"");   // on another page of the grid: find it by name
  };
  const why = (it)=>{ const x = byId[it.cardId] || {}, name = x.name || "this";
    if(kind==="characters"){
      const drafted = typeof window.charVisualsDrafted==="function" ? window.charVisualsDrafted(x) : true;
      return "Open "+name+"\u2019s card \u2014 "+(it.variant ? "make this appearance variant under Appearance states" : "generate the character sheet")
        +(drafted ? "" : " (draft the look first)"); }
    if(it.blocked==="owner") return "Open "+name+"\u2019s card \u2014 choose who carries it; then its sheet can be made";
    if(it.blocked==="screenplay") return "Open "+name+"\u2019s card \u2014 the screenplay doesn't mention it; it's made from its own card once you confirm it";
    const drafted = typeof propVisualsDrafted==="function" ? propVisualsDrafted(x) : !!(String(x.form||"").trim() && String(x.material||"").trim());
    return "Open "+name+"\u2019s card \u2014 "+(drafted ? "generate its sheet" : "draft its specification, then generate its sheet"); };
  const imgs = items.filter(it=>!it.blocked).length, blocked = items.length-imgs;
  return _bdEl("div",{className:"bd-scene-needs",role:"group","aria-label":tag+" still needs"},
    _bdEl("span",{className:"bd-scene-needs-lab"}, tag+" still needs "+(imgs ? imgs+" "+noun+(imgs===1?"":"s") : "")
      +(imgs && blocked ? " \u00b7 " : "")+(blocked ? blocked+" prop"+(blocked===1?"":"s")+" an owner or a screenplay mention" : "")+" (as the Breakdown counts):"),
    items.map((it,i)=> _bdEl("button",{key:it.cardId+":"+i,type:"button",className:"bd-chip"+(it.blocked?" owner":""),title:why(it),"aria-label":it.text+" \u2014 "+why(it),
        onClick:()=>open(it.cardId, (byId[it.cardId]||{}).name)},
      _bdEl("span",{className:"bd-dot"+(it.blocked?" owner":""),"aria-hidden":"true"}), _bdEl("span",{className:"bd-chip-t"}, it.text))));
}
window.BdSceneNeedsLine = BdSceneNeedsLine;

const _bdEsc = (s)=> String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
/* B16 (2026-10-09, owner — Breakdown review): the file name keeps a title's own letters ("Café Ψ" no longer prints as
   "CAF__"), by the export's rule (exportSlug) — the same as Storyboards' */
const _bdSlugTitle = (title)=>{
  if(typeof exportSlug==="function"){ try{ return exportSlug(title, "film"); }catch(e){} }
  const raw = String(title||"").trim(); let slug = "";
  try{ slug = raw.normalize("NFC").replace(new RegExp("[^\\p{L}\\p{M}\\p{N}\\-]+","gu"),"_"); }catch(e){ slug = raw.replace(/[^\w\-]+/g,"_"); }
  slug = slug.replace(/_+/g,"_").replace(/^[_\-]+|[_\-]+$/g,"").slice(0,80);
  return slug || "film";
};
const _bdFileBase = (project)=> _bdSlugTitle(project && project.title).toUpperCase();
const _bdFormatLabel = (project)=>{ try{ return (typeof formatOf==="function" && project) ? (formatOf(project).label||"") : ""; }catch(e){ return ""; } };
function _bdPreview(title, sub, fileName, html, hint){
  if(typeof window.docPreview==="function"){ window.docPreview({ title, sub, fileName, html, hint }); return; }
  const w = window.open("", "_blank");
  if(w){ w.document.open(); w.document.write(html); w.document.close(); }
}
/* a preview that opens AT ONCE and is filled when the document is ready (2026-10-09 — the bible) */
function _bdOpenPreview(title, sub, fileName, html, hint){
  if(typeof window.docPreview==="function"){
    const h = window.docPreview({ title, sub, fileName, html, hint });
    if(h && typeof h.setHtml==="function") return { live:true, set:(x)=>h.setHtml(x), close:()=>{ try{ h.close(); }catch(e){} } };
    // a preview that can't be refilled: the finished document opens in its own
    return { live:false, set:(x)=> window.docPreview({ title, sub, fileName, html:x, hint }), close:()=>{} };
  }
  const w = (typeof window.open==="function") ? window.open("", "_blank") : null;
  const put = (x)=>{ if(w){ try{ w.document.open(); w.document.write(x); w.document.close(); }catch(e){} } };
  put(html);
  return { live:!!w, set:put, close:()=>{ try{ if(w) w.close(); }catch(e){} } };
}

/* the printable stripboard — the same rows as the tab, one coloured line per scene */
/* B17 (2026-10-09, owner — Breakdown review, decision I): "approved" is what the tab says (shots.approved), with the
   approved frames that are out of date noted; Boards and Clips columns like the strip; a failed check is said; landscape */
function exportStripboard(rows, project, opts){
  const o = opts || {};
  const title = (project && project.title) || "Stripboard";
  const sum = breakdownSummary(rows);
  const body = (rows||[]).map(r=>{
    const k = bdStripKind(r.slug);
    // "○ not made yet" follows the chip's status, as the tab shows it (2026-10-09): an item no frame uses isn't owed
    const owed = (x)=> x.status ? (x.status==="missing" || x.status==="owner") : !x.ready;
    const cast = r.cast.map(c=> _bdEsc(c.name)+(c.state?' <i>('+_bdEsc(c.state)+')</i>':"")+(owed(c)?" ○":"")).join(", ");
    const props = r.props.map(p=> _bdEsc(p.name)+(p.needs&&owed(p)?" \u25cb":"")+(p.blocked==="owner"?" <i>(needs an owner)</i>":p.blocked==="screenplay"?" <i>(not in the screenplay)</i>":"")).join(", ");
    const worn = r.wardrobe.map(p=> _bdEsc(p.name)+(p.owner?' <i>('+_bdEsc(p.owner)+')</i>':"")+(owed(p)?" ○":"")).join(", ");
    const notes = (r.notes||[]).map(n=>n.text).join("; ");
    const old = Number(r.shots.approvedOld)||0;
    const frames = r.shots.total
      ? (r.shots.approved||0)+' approved'+(old ? ' ('+old+' out of date)' : '')+' · '+r.shots.rendered+'/'+r.shots.total
      : "\u2014";
    return '<tr class="k-'+(k||"none")+'">'
      +'<td class="no">'+_bdEsc(String(r.scene.no!=null?r.scene.no:"").padStart(2,"0"))+'</td>'
      +'<td>'+_bdEsc(r.slug.ie||"")+'</td>'
      +'<td><b>'+_bdEsc(r.slug.place||(r.location&&r.location.name)||"")+'</b><div class="t">'+_bdEsc(r.scene.title||"")+'</div></td>'
      +'<td>'+_bdEsc(r.slug.tod||"")+'</td>'
      +'<td>'+cast+'</td>'
      +'<td class="w">'+worn+'</td>'
      +'<td>'+props+'</td>'
      +'<td class="num">'+_bdEsc(frames)+'</td>'
      +'<td class="w">'+(r.boards && r.boards.total ? _bdEsc(bdBoardsText(r.boards)) : "\u2014")+'</td>'
      +'<td class="w">'+(r.clips && r.clips.total ? _bdEsc(bdClipsText(r.clips)) : (r.shots.total ? "Not counted yet" : "\u2014"))+'</td>'
      +'<td>'+(r.ready ? '<b class="ok">Ready</b>' : _bdEsc(r.missing.map(m=>m.text).join(", ")))+(notes ? '<div class="t">'+_bdEsc(notes)+'</div>' : "")+'</td></tr>';
  }).join("");
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>'+_bdEsc(title)+' — Stripboard</title><style>'
    +'@page{size:landscape;}'
    +'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16181d;margin:36px;}'
    +'h1{font-size:20px;margin:0 0 4px;} .sub{color:#666;font-size:12px;margin-bottom:6px;} .legend{font-size:10.5px;color:#555;margin-bottom:16px;}'
    +'.warn{color:#8a4b00;font-size:12px;font-weight:600;margin:0 0 8px;}'
    +'.legend span{display:inline-block;padding:2px 8px;margin-right:6px;border:1px solid #cfd2d8;border-radius:3px;}'
    +'table{border-collapse:collapse;width:100%;font-size:11px;}'
    +'th,td{border:1px solid #cfd2d8;padding:5px 7px;vertical-align:top;text-align:left;}'
    +'th{background:#1b1e26;color:#fff;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;}'
    +'td.no{font-weight:700;font-variant-numeric:tabular-nums;} td.w{font-size:10px;color:#333;} td.num{font-variant-numeric:tabular-nums;white-space:nowrap;} .t{color:#555;font-size:10px;margin-top:2px;} .ok{color:#2c7a3b;}'
    +'.k-int-day{background:#ffffff;} .k-ext-day{background:#fff5b8;} .k-int-night{background:#d6e6ff;} .k-ext-night{background:#d4f0d2;} .k-dusk{background:#ffdbe6;} .k-none{background:#f1f1f1;}'
    +'*{-webkit-print-color-adjust:exact;print-color-adjust:exact;} @media print{body{margin:10mm;} tr{break-inside:avoid;}}'
    +'</style></head><body>'
    +'<h1>'+_bdEsc(title)+' &mdash; Stripboard</h1>'
    +'<div class="sub">'+(_bdFormatLabel(project)?_bdEsc(_bdFormatLabel(project))+' &middot; ':'')+_bdEsc(bdSummaryLine(sum, true))+' &middot; Made with Kinolot</div>'
    +(o.checkFailed ? '<p class="warn">The check of which sheets and frames exist failed (no connection?) &mdash; the counts may be high. Reopen the Breakdown and export again.</p>' : '')
    +'<div class="legend"><span class="k-int-day">INT day</span><span class="k-ext-day">EXT day</span><span class="k-int-night">INT night</span><span class="k-ext-night">EXT night</span><span class="k-none">No time of day</span><span class="k-dusk">Dawn / dusk</span> &nbsp;○ = not made yet</div>'
    +'<table><thead><tr><th>Sc</th><th>I/E</th><th>Set \u00b7 scene</th><th>Time</th><th>Cast</th><th>Wardrobe</th><th>Props</th><th>Frames</th><th>Boards</th><th>Clips</th><th>Status</th></tr></thead><tbody>'+body+'</tbody></table>'
    +'</body></html>';
  _bdPreview("Stripboard preview", title, _bdFileBase(project)+"_STRIPBOARD.html", html,
    "Review the strips, then print / save as PDF — or download the HTML.");
}
window.exportStripboard = exportStripboard;

/* ART DEPARTMENT BIBLE — the cast, props and locations as one printable document: every
   written spec field, the scenes each appears in, and the current sheet image where one
   exists. Reads the cards as they are; generates nothing. */
/* EMBEDDED (2026-10-03, owner — Breakdown review): stored sheets are served on links that expire
   within the hour, so a saved bible soon showed empty boxes. Every sheet image is inlined as a data
   URL first (like the storyboard export); one that can't be fetched keeps its link. */
/* (2026-10-09, owner — Breakdown review) an embedded image is DOWNSCALED first (long side 1600 px, JPEG 0.85 — never
   larger than the original), so a big film's bible stays a file you can open; returns { src, embedded } */
const BD_BIBLE_LONG_SIDE = 1600, BD_BIBLE_JPEG = 0.85, BD_BIBLE_IMAGE_MS = 20000, BD_BIBLE_PARALLEL = 4;
async function _bdShrink(dataUrl){
  if(!/^data:image\//.test(dataUrl||"") || typeof document==="undefined" || typeof Image==="undefined") return dataUrl;
  try{
    const im = await new Promise((res, rej)=>{ const x = new Image(); x.onload = ()=>res(x); x.onerror = rej; x.src = dataUrl; });
    const w = im.naturalWidth||im.width, h = im.naturalHeight||im.height; if(!w || !h) return dataUrl;
    const k = Math.min(1, BD_BIBLE_LONG_SIDE/Math.max(w, h));
    const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w*k)); cv.height = Math.max(1, Math.round(h*k));
    const g = cv.getContext("2d"); if(!g) return dataUrl;
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    const out = cv.toDataURL("image/jpeg", BD_BIBLE_JPEG);
    return (out && /^data:image\//.test(out) && out.length < dataUrl.length) ? out : dataUrl;
  }catch(e){ return dataUrl; }
}
async function _bdInline(url){
  if(!url) return { src:"", embedded:false };
  let src = url;
  if(!/^data:/.test(url)){
    try{
      if(typeof window.sbToDataUrl==="function") src = (await window.sbToDataUrl(url)) || url;
      else { const blob = await (await fetch(url)).blob();
        src = await new Promise((res)=>{ const fr = new FileReader(); fr.onload = ()=>res(String(fr.result||url)); fr.onerror = ()=>res(url); fr.readAsDataURL(blob); }); }
    }catch(e){ src = url; }
  }
  if(!/^data:/.test(src||"")) return { src:url, embedded:false };
  return { src:await _bdShrink(src), embedded:true };
}
/* a colour the palette prints — a full colour value, never a prefix (2026-10-09): hex, rgb()/hsl()/hwb()/lab()/lch()/
   oklab()/oklch() with numbers only, or a named colour; anything else (a ";", a url(), a note after it) is left out */
function bdCssColor(x){
  const v = String(x==null?"":x).trim();
  if(!v || v.length>64) return "";
  let ok = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)
    || /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:%|deg|rad|grad|turn)?|none|[\s,\/])+\)$/i.test(v)
    || /^[a-z]{3,24}$/i.test(v);
  if(ok && typeof CSS!=="undefined" && CSS && typeof CSS.supports==="function"){ try{ ok = CSS.supports("color", v); }catch(e){} }
  else if(ok && /^[a-z]+$/i.test(v)) ok = BD_NAMED.has(v.toLowerCase());
  return ok ? v : "";
}
const BD_NAMED = new Set(("black white red green blue yellow orange purple pink brown gray grey silver gold navy teal maroon olive lime aqua cyan "
  +"magenta fuchsia beige ivory khaki coral crimson salmon tan turquoise violet indigo lavender plum orchid tomato chocolate sienna peru "
  +"wheat linen azure mintcream honeydew seashell snow ghostwhite whitesmoke gainsboro lightgray lightgrey darkgray darkgrey dimgray dimgrey "
  +"slategray slategrey darkslategray darkslategrey midnightblue royalblue steelblue skyblue lightblue powderblue cadetblue dodgerblue "
  +"deepskyblue cornflowerblue darkblue mediumblue darkred firebrick darkgreen forestgreen seagreen olivedrab darkolivegreen darkkhaki "
  +"goldenrod darkgoldenrod saddlebrown rosybrown burlywood sandybrown darkorange orangered hotpink deeppink mediumvioletred palevioletred "
  +"thistle darkviolet darkorchid mediumpurple rebeccapurple slateblue darkslateblue lightcoral indianred darksalmon lightsalmon peachpuff "
  +"bisque moccasin navajowhite papayawhip blanchedalmond cornsilk lemonchiffon lightyellow oldlace floralwhite antiquewhite mistyrose "
  +"lavenderblush aliceblue lightcyan paleturquoise aquamarine mediumaquamarine mediumseagreen springgreen mediumspringgreen lawngreen "
  +"chartreuse greenyellow yellowgreen palegreen lightgreen darkseagreen lightseagreen darkcyan darkturquoise mediumturquoise lightsteelblue "
  +"lightskyblue mediumslateblue lightpink transparent").split(" "));
window.bdCssColor = bdCssColor;

/* B19 (2026-10-09, owner — Breakdown review): ONE bible at a time (the strip's button and the ⋮ menu share this guard);
   the preview opens at once and says "Preparing 12 of 140…"; sheets load a few at a time, each with its own time limit;
   and the run belongs to the film it started in — a film switch stops it quietly */
let _bdBibleRun = null;   // { i, total } while one is being prepared
function bdBibleProgress(){ return _bdBibleRun ? { i:_bdBibleRun.i, total:_bdBibleRun.total } : null; }
window.bdBibleProgress = bdBibleProgress;
const _bdBibleSay = ()=>{ try{ window.dispatchEvent(new CustomEvent("turn-art-bible-progress",{ detail:bdBibleProgress() })); }catch(e){} };
async function exportArtBible(args){
  if(_bdBibleRun){
    if(typeof window.appToast==="function") window.appToast("The art department bible is still being prepared \u2014 it opens in its preview when it's ready.","info");
    return;
  }
  _bdBibleRun = { i:0, total:0 }; _bdBibleSay();
  try{ return await _bdBuildBible(args||{}); }
  catch(e){ if(typeof window.appToast==="function") window.appToast("The art department bible couldn't be prepared. Try again in a moment.","error"); }
  finally{ _bdBibleRun = null; _bdBibleSay(); }
}
/* every image id the bible shows, the way the Art Room names them (decision H, 2026-10-09): each character's sheet and
   appearance states; each prop's sheet (text-only props have none to load; a worn item's own close-up only); each
   location's plate, its rooms & times plates and its appearance-state plates */
function _bdLocationImages(l, units){
  const out = [], seen = new Set();
  const lkey = (typeof locationKeyOf==="function") ? locationKeyOf(l) : String((l && l.key)||"");
  const unitId = (u)=> (typeof sluglineUnitImageId==="function") ? sluglineUnitImageId(u.key) : "";
  (Array.isArray(units)?units:[]).filter(u=> u && !u.orphan && lkey && String(u.subspaceKey||u.locationKey||"")===lkey).forEach(u=>{
    const id = unitId(u); if(!id || seen.has(id)) return; seen.add(id);
    out.push({ id, kind:"room", label:[u.intExt, u.name, u.time].filter(Boolean).join(" \u00b7 ") || "Room & time" }); });
  let states = [];
  try{ states = (typeof locationAppearanceStates==="function") ? locationAppearanceStates(l, units) : (Array.isArray(l && l.variants) ? l.variants : []); }catch(e){ states = []; }
  (states||[]).forEach(v=>{ if(!v) return;
    const id = (typeof locationAppearanceStateAssetId==="function") ? locationAppearanceStateAssetId(l, v, units) : String(l.id)+"-"+String(v.id||"state");
    const label = String(v.state||v.name||v.label||v.time||"Appearance state").trim();
    const hit = out.find(x=>x.id===id);
    if(hit){ if(label && hit.label.indexOf(label)<0) hit.label += " \u2014 "+label; return; }   // a room's plate that IS the state
    if(seen.has(id)) return; seen.add(id);
    out.push({ id, kind:"state", label }); });
  return out;
}
async function _bdBuildBible({ project, characters, props, locations, scenes, drafts, shots }){
  const title = (project && project.title) || "Art department bible";
  const ordered = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  const fileName = _bdFileBase(project)+"_ART_BIBLE.html";
  // the run belongs to the film it started in
  const film0 = window.turnOpenFilmId, epoch0 = (typeof nbEpoch==="function") ? nbEpoch() : null;
  const moved = ()=> window.turnOpenFilmId!==film0 || ((typeof nbEpoch==="function") ? nbEpoch() : null)!==epoch0;
  const units = ((window.turnContinuity||{}).sluglineUnits) || [];
  const KIND = { worn:"Worn", carried:"Carried", dressing:"Set dressing" };
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts||{}).tier : "own"; }catch(e){ return "own"; } };
  const isText = (p)=> p.kind!=="worn" && tierOf(p)==="text";
  const locImgs = {}; (locations||[]).forEach(l=>{ if(l && l.id) locImgs[l.id] = _bdLocationImages(l, units); });
  const _ids = [];
  (characters||[]).forEach(c=>{ if(c && c.id) _ids.push(c.id); });
  (props||[]).forEach(p=>{ if(p && p.id && !isText(p)) _ids.push(p.id); });   // text-only props load nothing
  (locations||[]).forEach(l=>{ if(l && l.id){ _ids.push(l.id); (locImgs[l.id]||[]).forEach(x=>_ids.push(x.id)); } });
  (characters||[]).forEach(c=>{ (c && Array.isArray(c.states) ? c.states : []).forEach(st=>{ if(st && st.id) _ids.push(c.id+":"+st.id); }); });
  const ids = [...new Set(_ids)];
  const placeholder = (i, n)=> '<!doctype html><html><head><meta charset="utf-8"><title>'+_bdEsc(title)+' \u2014 Art department bible</title></head>'
    +'<body style="font:13px -apple-system,Segoe UI,sans-serif;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">'
    +(n ? 'Preparing '+i+' of '+n+'\u2026' : 'Preparing\u2026')+'</body></html>';
  // opened AT ONCE, inside the click (a window opened after an await is blocked)
  const prev = _bdOpenPreview("Art department bible", title, fileName, placeholder(0, ids.length),
    "Sheet images are embedded, so the saved file keeps them. Any that couldn\u2019t be are counted at the top of the document (links that expire within the hour). Print / save as PDF, or download the HTML.");
  _bdBibleRun.total = ids.length; _bdBibleSay();
  const _raw = (id)=>{ try{ return (typeof nbGetImage==="function" && nbGetImage(id)) || ""; }catch(e){ return ""; } };
  // each sheet is LOADED, not only read from the cache (2026-10-09 — after a reload, sheets the Breakdown hadn't
  // looked up printed "No sheet yet"), and each character's appearance-state sheets come too
  const _load = async (id)=>{ let u = _raw(id); if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(id) || ""; }catch(e){ u = ""; } } return u; };
  const limit = (p, ms)=> (typeof setTimeout!=="function") ? p
    : Promise.race([p, new Promise(res=>setTimeout(()=>res(null), ms))]);
  const _inlined = {}; let linked = 0, done = 0, stopped = false, lastSaid = 0;
  const one = async (id)=>{
    const r = await limit((async ()=>{ const u = await _load(id); return u ? await _bdInline(u) : { src:"", embedded:false }; })(), BD_BIBLE_IMAGE_MS);
    if(r && r.src){ _inlined[id] = r.src; if(!r.embedded) linked++; }
    else if(!r){ const u = _raw(id); if(u){ _inlined[id] = u; if(!/^data:/.test(u)) linked++; } }   // timed out: its link, if any
    done++;
    if(_bdBibleRun){ _bdBibleRun.i = done; _bdBibleSay(); }
    const now = Date.now();
    if(prev.live && now-lastSaid>400){ lastSaid = now; prev.set(placeholder(done, ids.length)); }
  };
  let cursor = 0;
  await Promise.all(Array.from({ length:Math.min(BD_BIBLE_PARALLEL, ids.length) }, async ()=>{
    while(cursor<ids.length && !stopped){ if(moved()){ stopped = true; break; } const id = ids[cursor++]; await one(id); } }));
  if(stopped || moved()){ prev.close(); return; }   // another film is open now: stop quietly
  const imgUrl = (id)=> _inlined[id] || "";
  const scNos = (ids2)=> ordered.filter(s=> ids2.indexOf(s.id)>=0).map(s=> s.no);
  const scLine = (nos)=> nos.length ? "Sc "+nos.join(", ") : "";
  const field = (lab, v)=>{ const t = (v==null ? "" : Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v)).trim();
    return t ? '<div class="f"><span class="l">'+_bdEsc(lab)+'</span>'+_bdEsc(t)+'</div>' : ""; };
  const pic = (id, alt, none)=>{ const u = imgUrl(id); return u ? '<img src="'+_bdEsc(u)+'" alt="'+_bdEsc(alt)+'">' : '<div class="noimg">'+_bdEsc(none||"No sheet yet")+'</div>'; };
  const byScene = {}; (shots||[]).forEach(s=>{ if(s && s.sceneId) (byScene[s.sceneId]=byScene[s.sceneId]||[]).push(s); });
  const SCALE = { A:"Human scale", B:"Small / critter", C:"Massive / giant", D:"Microscopic / sub-insect" };
  const castHtml = (characters||[]).map(c=>{
    const inScenes = ordered.filter(s=>{ const r = (typeof sceneRoster==="function") ? sceneRoster(s, characters, drafts||{}, byScene[s.id]||[]) : [s.driver]; return r.indexOf(c.id)>=0; }).map(s=>s.no);
    const F = c.physique || {};
    // many cards fold the physique into Body already — print it once
    const body = String(c.coreBody||"").toLowerCase();
    const physInBody = !!body && [F.age,F.build,F.skin,F.eyes,F.hair,F.face].filter(Boolean)
      .some(x=> body.indexOf(String(x).toLowerCase().trim().slice(0,24))>=0);
    const v = c.voice || {};
    const states = (c.states||[]).map(st=>{ const at = st.sceneId ? ordered.find(s=>s.id===st.sceneId) : null;
      const su = imgUrl(c.id+":"+st.id);
      return '<li><b>'+_bdEsc(st.label||"State")+'</b>'+(st.change?' — '+_bdEsc(st.change):"")+(at?' <span class="m">(from Sc '+_bdEsc(at.no)+')</span>':"")
        +(su?'<br><img class="stimg" src="'+_bdEsc(su)+'" alt="'+_bdEsc((c.name||"")+" — "+(st.label||"state"))+'">':"")+'</li>'; }).join("");
    const swatches = (Array.isArray(c.palette)?c.palette:[]).map(x=> typeof x==="string" ? bdCssColor(x) : "").filter(Boolean).slice(0,8)
      .map(x=>'<span class="sw" style="background:'+_bdEsc(x)+'" title="'+_bdEsc(x)+'"></span>').join("");
    return '<section class="card"><div class="pic">'+pic(c.id, c.name)+'</div><div class="txt">'
      +'<h3>'+_bdEsc(c.name||"Unnamed")+'</h3>'
      +'<div class="m">'+_bdEsc([c.role, c.archetype].filter(Boolean).join(" · "))+'</div>'
      +field("Pronouns", c.pronouns)+field("Scale", SCALE[c.scaleClass]||"")+field("Height", c.height)
      +field("Identity", c.identity)+field("Body", (typeof window.charLegacyBodySplit==="function") ? window.charLegacyBodySplit(c).base : c.coreBody)
      // (2026-10-12, Character fidelity) the script's distinguishing features (older films: read from coreBody, unmigrated)
      +field("Distinguishing features", (typeof window.charScriptFeaturesRaw==="function") ? window.charScriptFeaturesRaw(c) : c.scriptFeatures)
      +(physInBody ? "" : field("Age", F.age)+field("Build", F.build)+field("Skin", F.skin)+field("Eyes", F.eyes)+field("Hair", F.hair)+field("Face", F.face))
      +field("Wardrobe", c.wardrobe)+field("Accessories", c.accessories)+field("Look", c.look)
      +field("Voice", [v.accent, v.pitch, v.pace, v.quirks].filter(Boolean).join("; "))
      +field("Signature expressions", Array.isArray(c.expressions)?c.expressions:"")
      +(swatches?'<div class="f"><span class="l">Palette</span>'+swatches+'</div>':"")
      +(states?'<div class="f"><span class="l">Appearance states</span><ul>'+states+'</ul></div>':"")
      +field("Scenes", scLine(inScenes))
      +'</div></section>';
  }).join("");
  const nameOf = (id)=>{ const c = (characters||[]).find(x=>x && x.id===id); return c ? (c.name||"") : ""; };
  const propsHtml = (props||[]).map(p=>{
    const text = isText(p);
    // a worn item with no close-up of its own is on its owner's sheet (2026-10-09)
    const owner = p.ownerName || nameOf(p.ownerId) || "its owner";
    const none = p.kind==="worn" ? "On "+owner+"\u2019s sheet" : "No sheet yet";
    return '<section class="card">'+(text ? '<div class="pic"><div class="noimg">Text only \u2014 described in shots</div></div>' : '<div class="pic">'+pic(p.id, p.name, none)+'</div>')
      +'<div class="txt"><h3>'+_bdEsc(p.name||"Prop")+'</h3>'
      +'<div class="m">'+_bdEsc([KIND[p.kind]||KIND.carried, p.ownerName].filter(Boolean).join(" · "))+'</div>'
      +field("Form", p.form)+field("Material", p.material)+field("Size", p.size)+field("Condition", p.condition)
      +field("Significance", p.detail)+field("Scenes", scLine(scNos(Array.isArray(p.scenes)?p.scenes:[])))
      +'</div></section>';
  }).join("");
  const locsHtml = (locations||[]).map(l=>{
    const plates = (locImgs[l.id]||[]).map(x=>{ const u = imgUrl(x.id);
      return '<li><b>'+_bdEsc(x.label)+'</b> <span class="m">('+(x.kind==="room" ? "room &amp; time" : "appearance state")+')</span>'
        +(u ? '<br><img class="stimg" src="'+_bdEsc(u)+'" alt="'+_bdEsc((l.name||"")+" \u2014 "+x.label)+'">' : ' <span class="m">\u2014 no plate yet</span>')+'</li>'; }).join("");
    const locScenes = ordered.filter(s=>{ const hit = (typeof locationForScene==="function") ? locationForScene(locations, s.id) : null; return hit && hit.id===l.id; }).map(s=>s.no);
    return '<section class="card wide"><div class="pic">'+pic(l.id, l.name)+'</div><div class="txt">'
      +'<h3>'+_bdEsc(l.name||"Location")+'</h3>'
      +'<div class="m">'+_bdEsc([l.intExt, l.parentLocation && l.parentLocation.name ? "within "+l.parentLocation.name : ""].filter(Boolean).join(" · "))+'</div>'
      +field("Architecture", l.architecture)+field("Materials", l.materials)+field("Permanent lighting", l.lighting)
      +field("Permanent dressing", l.permanentDressing)+field("How the rooms connect", l.topology)+field("Fixed landmarks", l.continuityAnchors)
      +field("Significance", l.significance)+field("Scenes", scLine(locScenes))
      // decision H (2026-10-09): its rooms & times plates and appearance-state plates, as the Locations tab makes them
      +(plates ? '<div class="f"><span class="l">Rooms, times &amp; states</span><ul>'+plates+'</ul></div>' : "")
      +'</div></section>';
  }).join("");
  const fmt = _bdFormatLabel(project);
  const counts = (characters||[]).length+" character"+((characters||[]).length===1?"":"s")+" · "+(props||[]).length+" prop"+((props||[]).length===1?"":"s")+" · "+(locations||[]).length+" location"+((locations||[]).length===1?"":"s");
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>'+_bdEsc(title)+' — Art department bible</title><style>'
    +'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16181d;margin:36px;line-height:1.45;}'
    +'h1{font-size:24px;margin:0 0 4px;} .sub{color:#666;font-size:12px;margin-bottom:24px;}'
    +'h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;border-bottom:2px solid #1b1e26;padding-bottom:4px;margin:28px 0 12px;}'
    +'.card{display:flex;gap:16px;padding:12px 0;border-bottom:1px solid #e3e5ea;break-inside:avoid;}'
    +'.pic{flex:0 0 240px;} .card.wide .pic{flex-basis:300px;} .pic img{width:100%;border-radius:4px;border:1px solid #d7dae0;display:block;}'
    +'.stimg{height:72px;width:auto;margin-top:4px;border-radius:4px;border:1px solid #e5e7eb}'
    +'.noimg{height:90px;display:flex;align-items:center;justify-content:center;background:#f3f4f6;border:1px dashed #cfd2d8;border-radius:4px;color:#888;font-size:11px;text-align:center;padding:6px;}'
    +'.txt{flex:1;min-width:0;font-size:11.5px;} h3{font-size:15px;margin:0 0 2px;} .m{color:#666;font-size:11px;margin-bottom:6px;}'
    +'.f{margin:3px 0;} .l{display:inline-block;min-width:118px;color:#888;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;vertical-align:top;}'
    +'ul{margin:2px 0 0 118px;padding-left:14px;} .sw{display:inline-block;width:16px;height:16px;border-radius:3px;margin-right:3px;border:1px solid #ccc;vertical-align:middle;}'
    +'.warn{color:#8a4b00;font-size:12px;font-weight:600;margin:-14px 0 18px;}'
    +'.empty{color:#888;font-size:12px;} *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'@media print{body{margin:12mm;} h2{break-after:avoid;}}'
    +'</style></head><body>'
    +'<h1>'+_bdEsc(title)+' &mdash; Art department bible</h1>'
    +'<div class="sub">'+(fmt?_bdEsc(fmt)+' &middot; ':'')+_bdEsc(counts)+' &middot; '+_bdEsc(new Date().toLocaleDateString())+' &middot; Made with Kinolot</div>'
    // B18 (2026-10-09): images that couldn't be copied into the file are links that expire — said, never "embedded"
    +(linked ? '<p class="warn">'+linked+' image'+(linked===1?' is a link that expires':'s are links that expire')+' within the hour \u2014 '+(linked===1?'it':'they')+' couldn\u2019t be copied into this file. Export again later to keep '+(linked===1?'it':'them')+'.</p>' : '')
    +'<h2>Cast</h2>'+(castHtml||'<div class="empty">No characters yet.</div>')
    +'<h2>Props</h2>'+(propsHtml||'<div class="empty">No props yet.</div>')
    +'<h2>Locations</h2>'+(locsHtml||'<div class="empty">No locations yet.</div>')
    +'</body></html>';
  prev.set(html);
}
window.exportArtBible = exportArtBible;
window.breakdownRows = breakdownRows;
window.breakdownSummary = breakdownSummary;
window.bdSlug = bdSlug;

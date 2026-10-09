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
   id; `tierOf(prop)` is the prop's reference-image tier ("text" = described, not drawn). */
function breakdownRows({ scenes, characters, props, locations, shots, drafts, img, tierOf, project, stageStatus }){
  const ordered = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]).slice();
  const C = characters||[];
  let prevKind = "";
  return ordered.map(scene=>{
    const slug = bdSlug(scene.loc);
    // CONTINUOUS / LATER / SAME keep the previous scene's clock, as on a real stripboard
    let todKind = slug.todKind;
    if(!todKind && /CONTINUOUS|LATER|SAME|MOMENTS/.test(slug.tod)) todKind = prevKind;
    if(todKind) prevKind = todKind;
    const sceneShots = (shots||[]).filter(s=> s && s.sceneId===scene.id);
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
      return { id:p.id, name:p.name||"Prop", kind:p.kind||"carried", owner:p.ownerName||"", ownerId:p.ownerId||"", needs, onOwner,
        ready:!needs || !!macro || onOwner };
    });
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
    if(needs){
      const TAB = { character:"characters", location:"locations", prop:"props" };
      if(!location) missing.push({ tab:"locations", text:"a location card" });
      needs.forEach(n=> missing.push({ tab:TAB[n.kind]||"shots", text:(n.prereq ? (n.name||n.label)+" plate (needed first)" : n.label+(n.kind==="prop"?" sheet":n.kind==="location"?" plate":"")), need:n }));
    } else {
      cast.filter(c=>!c.ready).forEach(c=> missing.push({ tab:"characters", text: c.state ? (c.name+" · "+c.state+" variant") : (c.name+"'s sheet") }));
      if(!location) missing.push({ tab:"locations", text:"a location card" });
      else if(!location.ready) missing.push({ tab:"locations", text:location.name+" plate" });
      sceneProps.filter(p=>!p.ready).forEach(p=> missing.push({ tab:"props", text:p.name+" sheet" }));
      // a worn item needs its owner's sheet, which the cast line above already asks for
    }
    let toRender = 0, oldLook = 0, done = 0;
    if(!sceneShots.length) missing.push({ tab:"shots", text:"shots" });
    else if(typeof shotFrameState==="function"){
      let locChanged = 0, charChanged = 0, propChanged = 0;
      // every RENDERED frame counts for the notes, as Shots, Storyboards and the Stage count them (2026-10-08)
      // (2026-10-09, owner — Breakdown review) the same reach as Shots' Render: an approved frame that follows one
      // being re-rendered in the chain re-renders too; and a frame that's only waiting for approval is said apart
      let toApprove = 0, cascade = 0;
      const chain = (typeof sceneShotsOrdered==="function") ? sceneShotsOrdered(sceneShots) : sceneShots;
      const will = new Set();
      chain.forEach(sh=>{ const st = shotFrameState(sh, sceneShots, drafts, project, img);
        if(!st.done){ toRender++; will.add(sh.id); if(st.rendered && st.current && !st.approved) toApprove++; }
        else { const seed = (typeof seedShotOf==="function") ? seedShotOf(sh, chain) : null;
          if(seed && will.has(seed.id)){ will.add(sh.id); cascade++; } else done++; }
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
    if(needs){
      const want = new Set(); needs.forEach(n=>{ want.add(String(n.id)); if(n.baseId) want.add(String(n.baseId)); });
      const st = (ids, ready)=> ids.some(x=>want.has(String(x))) ? "missing" : (ready ? "ready" : "unused");
      cast.forEach(c=>{ c.status = st([c.sheetId, c.id], c.ready); });
      wardrobe.concat(sceneProps).forEach(p=>{ p.status = p.needs ? st([p.id], p.ready) : "text"; });
      // the location chip is ITS plate (2026-10-08): red when a frame — or a room & time plate a frame needs
      // (sceneReferenceNeeds' "needed first") — needs it; a missing room plate is its own line
      if(location){ const mine = needs.find(n=>n.kind==="location" && String(n.id)===String(location.id));
        location.status = mine ? "missing" : (location.ready ? "ready" : "unused");
        if(mine && mine.prereq) location.prereq = true; }
    } else {
      cast.forEach(c=>{ c.status = c.ready ? "ready" : "missing"; });
      wardrobe.concat(sceneProps).forEach(p=>{ p.status = !p.needs ? "text" : (p.ready ? "ready" : "missing"); });
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
        const earlier = !!(m && m.composed) && typeof shotLookIsEarlier==="function" && ids.some(fid=>{ const fm = (typeof nbGetMeta==="function") ? nbGetMeta(fid) : null;
          return !!(fm && shotLookIsEarlier(fm.lookSig, project, scene.id)); });
        if(typeof window.sbSheetStale==="function" && m && window.sbSheetStale(m, ids)) boards.stale++;
        else if(m && m.composed && Number(m.missing)>0) boards.partial++;   // drawn with frames missing (2026-10-09)
        else if(earlier) boards.oldLook++; else boards.current++;
      });
    }
    const clips = (stageStatus && stageStatus[scene.id]) || null;
    return { scene, slug:{ ...slug, todKind }, cast, location, wardrobe, props:sceneProps,
      shots:{ total:sceneShots.length, rendered, approved, toRender }, framesDone:done, missing, notes, ready:!missing.length,
      needs: needs||[], boards, clips, boardIds };
  });
}

/* film-wide totals — each missing asset counts ONCE however many scenes need it */
function breakdownSummary(rows){
  const castSheets = new Set(), plates = new Set(), propSheets = new Set();
  let frames = 0, noShots = 0, noLoc = 0;
  (rows||[]).forEach(r=>{
    if(r.needs && r.needs.length){
      // the render-plan needs (deduped across scenes by asset id)
      r.needs.forEach(n=>{ if(n.kind==="character"){ castSheets.add(n.id);
          // a variant whose master doesn't exist yet makes the master first (2026-10-09)
          const sid = String(n.id); if(sid.indexOf(":")>0 && n.masterMissing) castSheets.add(sid.split(":")[0]); }
        else if(n.kind==="location") plates.add(n.id); else propSheets.add(n.baseId||n.id); });
      if(!r.location) noLoc++;
    } else {
      r.cast.forEach(c=>{ if(!c.ready) castSheets.add(c.sheetId); });
      if(!r.location) noLoc++; else if(!r.location.ready) plates.add(r.location.id);
      // a worn item needs only its owner's sheet, which the cast line counts (2026-10-09 — it was counted twice)
      r.props.forEach(p=>{ if(!p.ready) propSheets.add(p.id); });
    }
    if(!r.shots.total) noShots++; else frames += (r.shots.toRender!=null ? r.shots.toRender : r.shots.total - r.shots.rendered);
  });
  // the images still to make, for the "≈ N credits to finish" estimate
  const images = castSheets.size + plates.size + propSheets.size + frames;
  return { total:(rows||[]).length, ready:(rows||[]).filter(r=>r.ready).length,
    castSheets:castSheets.size, plates:plates.size, propSheets:propSheets.size, frames, noShots, noLoc, images };
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

// noPrice: the exported stripboard is for the crew — no credit estimate on it (2026-10-09)
function bdSummaryLine(sum, noPrice){
  const todo = [];
  if(sum.castSheets) todo.push(sum.castSheets+" cast sheet"+(sum.castSheets===1?"":"s"));
  if(sum.plates) todo.push(sum.plates+" plate"+(sum.plates===1?"":"s"));
  if(sum.propSheets) todo.push(sum.propSheets+" prop sheet"+(sum.propSheets===1?"":"s"));
  if(sum.frames) todo.push(sum.frames+" frame"+(sum.frames===1?"":"s"));
  if(sum.noShots) todo.push(sum.noShots+" scene"+(sum.noShots===1?"":"s")+" without shots");
  if(sum.noLoc) todo.push(sum.noLoc+" without a location card");
  // what's left to spend, from the current engine's price for one image
  const cost = (!noPrice && sum.images && typeof window.nbImageCostText==="function") ? window.nbImageCostText(sum.images) : "";
  return sum.ready+" of "+sum.total+" scene"+(sum.total===1?"":"s")+" ready to shoot"+(todo.length ? " · to go: "+todo.join(", ") : "")
    +(cost ? " \u00b7 \u2248 "+cost+" credit"+(cost==="1"?"":"s")+" for the images still to make (scenes without shots cost more to design; drafting adds a little writing; Shots gives each run's exact price; video is priced on the Stage)" : "");
}

function BreakdownView({ project, scenes, characters, props, locations, shots, drafts, setArtView, onMakeSceneNeeds, onOpenStage, readOnly=false }){
  const [tick, setTick] = React.useState(0);
  // the price on the summary line follows the engine and the price list (it used to stay stale)
  const [, setPriceTick] = React.useState(0);
  React.useEffect(()=>{ const h=()=>setPriceTick(t=>t+1);
    ["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(ev=>window.addEventListener(ev, h));
    return ()=>["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(ev=>window.removeEventListener(ev, h)); },[]);
  // ONE "Make what this scene needs" at a time across the board (each strip used to run its own)
  const [needsBusy, setNeedsBusy] = React.useState(null);   // { sceneId, i, total } | null
  const checkedRef = React.useRef(new Set());              // ids already looked up on this device
  const [filter, setFilter] = React.useState("all");   // all | todo | ready
  const [found, setFound] = React.useState(()=>new Set());   // ids found in local storage after mount
  // until the image cache is warm every sheet would read as missing — say "checking" instead
  const [checking, setChecking] = React.useState(true);
  const cloud = typeof window.nbBackend==="function" && window.nbBackend()==="cloud";
  // a run delivers images one by one: recount the film once per burst, not once per image (2026-10-05)
  React.useEffect(()=>{
    let t = null;
    const bump = ()=>{ clearTimeout(t); t = setTimeout(()=>setTick(x=>x+1), 250); };
    // a CLEARED image (a done event with no url) leaves the found set, and may be looked up again (2026-10-09 —
    // a deleted sheet or frame stayed "ready")
    const gone = (e)=>{ const d=(e&&e.detail)||{}; if(d.id && !d.url){ checkedRef.current.delete(d.id);
      setFound(f=>{ if(!f.has(d.id)) return f; const n=new Set(f); n.delete(d.id); return n; }); } bump(); };
    window.addEventListener("nb-prefetched", bump); window.addEventListener("nb-gen-done", gone);
    return ()=>{ clearTimeout(t); window.removeEventListener("nb-prefetched", bump); window.removeEventListener("nb-gen-done", gone); };
  },[]);
  const mountedRef = React.useRef(true);
  React.useEffect(()=>()=>{ mountedRef.current = false; },[]);
  const [checkFailed, setCheckFailed] = React.useState(false);
  const img = (id)=> found.has(id) || ((typeof nbGetImage==="function") ? !!nbGetImage(id) : false);
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts||{}).tier : "own"; }catch(e){ return "own"; } };
  // the same open-film key the Stage writes with (stageFilmKey — films carry no project.id)
  const stageStatus = bdStageStatus(window.turnOpenFilmId || (project && project.id));
  const rows = React.useMemo(()=> breakdownRows({ scenes, characters, props, locations, shots, drafts, img, tierOf, project, stageStatus }),
    [scenes, characters, props, locations, shots, drafts, tick, found, project]);
  const sum = breakdownSummary(rows);
  // a cloud film: ONE batched prefetch (shared with the Art Room's own) warms every asset url
  React.useEffect(()=>{
    if(!cloud) return;
    let alive = true;
    // a prefetch that FAILS says so (2026-10-09 — everything read as missing, with export enabled)
    Promise.resolve(typeof nbPrefetchAll==="function" ? nbPrefetchAll() : null).then(()=>({ ok:true }), ()=>({ ok:false }))
      .then((r)=>{ if(alive){ setCheckFailed(!(r && r.ok)); setChecking(false); setTick(t=>t+1); } });
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
      if(hit.length) setFound(f=>{ const n=new Set(f); hit.forEach(x=>n.add(x)); return n; });
      setChecking(false);
    })();
  },[rows.length, (shots||[]).length, tick]);
  // the ⋮ menu's "Export stripboard" while this tab is open
  // (not while "Checking…": every sheet would print as missing — 2026-10-05)
  React.useEffect(()=>{ window.turnExportBreakdown = checking
      ? ()=>{ if(typeof window.appToast==="function") window.appToast("The Breakdown is still checking which sheets and frames exist \u2014 export it in a moment.","info"); }
      : ()=> exportStripboard(rows, project);
    return ()=>{ if(window.turnExportBreakdown) delete window.turnExportBreakdown; }; });

  // OPEN ON THE SCENE (2026-10-03): the tab opens focused on this strip's scene ("render" also
  // starts Shots' Render Scene NN, which asks first with its price)
  const go = (tab, sceneId, action)=>{
    if(!tab || !setArtView) return;
    if(sceneId && typeof window.turnFocusArtScene==="function") window.turnFocusArtScene(tab, sceneId, action);
    setArtView(tab);
  };
  // one at a time, with a busy label — it loads and embeds every sheet (2026-10-09: a second click built it twice)
  const [bibleBusy, setBibleBusy] = React.useState(false);
  const exportBible = async ()=>{ if(bibleBusy) return; setBibleBusy(true);
    try{ await exportArtBible({ project, characters, props, locations, scenes, drafts, shots }); } finally { setBibleBusy(false); } };
  const shown = rows.filter(r=> filter==="all" || (filter==="ready" ? r.ready : !r.ready));
  const header = _bdEl("div",{className:"art-intro"},
    _bdEl("div",{className:"art-intro-row"},
      _bdEl("div",null,
        _bdEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"First Assistant Director",
          window.InfoTip && _bdEl(window.InfoTip,{label:"About the Breakdown",
            text:"The Breakdown is your stripboard: one strip per scene, in story order, coloured the way film crews colour them — white for INT day, yellow for EXT day, blue for INT night, green for EXT night, pink for dawn and dusk. Each strip lists who is in the scene (in the look they wear there), its location, the props it needs and its shots, and says what is still missing before the scene can be shot: a cast sheet or appearance variant, a location plate (a room's location plate comes first), a prop sheet, shot frames, frames to approve or to refresh \u2014 and notes for frames made before a look, sheet, location or prop changed. A worn item is ready when it's on its owner's character sheet. Click a missing item to open its tab on this scene. Two buttons on a strip spend credits: \u201cMake what this scene needs\u201d makes the missing reference images (it asks first, with the price, and drafts any look that isn't written yet), and \u201cRender Scene NN\u201d opens Shots on that scene, which asks with the exact price. Each strip also shows its storyboard sheets and, as of your last visit to the Stage, its video clips. Export the stripboard or the whole art department bible with the buttons beside this tip."})),
        _bdEl("div",{className:"bd-sum"}, !rows.length ? "No scenes yet" : checking ? "Checking which sheets and frames exist\u2026"
          : checkFailed ? "Couldn't check which sheets and frames exist (no connection?) \u2014 the counts below may be too high. Reopen the tab to check again."
          : bdSummaryLine(sum)),
        // say why the spending buttons aren't there (2026-10-09)
        readOnly && rows.length>0 && _bdEl("div",{className:"bd-sum bd-readonly"},"View only \u2014 your role can't make images or render here.")),
      rows.length>0 && !checking && _bdEl("div",{className:"art-intro-actions"},
        // the two exports, here too (they also stay in the top bar's ⋮ menu)
        _bdEl("button",{type:"button",className:"art-draftall ghost",onClick:()=>exportStripboard(rows, project),
          title:"Preview the stripboard as a printable document, then print / save as PDF or download it"},
          _bdEl(Icon.download,{s:14}),"Export stripboard"),
        _bdEl("button",{type:"button",className:"art-draftall ghost",onClick:exportBible,disabled:bibleBusy,"aria-busy":bibleBusy?"true":undefined,
          title:"The cast, props and locations as one printable document, with their current sheets (and appearance states) embedded"},
          _bdEl(Icon.download,{s:14}),bibleBusy?"Preparing\u2026":"Art department bible"),
        _bdEl("div",{className:"bd-filter",role:"group","aria-label":"Show scenes"},
          [["all","All"],["todo","Needs work"],["ready","Ready"]].map(([id,lab])=>
            _bdEl("button",{key:id,type:"button",className:"bd-filter-btn"+(filter===id?" on":""),"aria-pressed":filter===id?"true":"false",
              onClick:()=>setFilter(id)}, lab, _bdEl("span",{className:"bd-filter-n"},
                id==="all"?rows.length:id==="ready"?sum.ready:rows.length-sum.ready)))))));

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
    _bdEl("div",{className:"bd-legend",role:"group","aria-label":"Strip colours"},
      Object.keys(BD_STRIP_LABEL).map(k=> _bdEl("span",{key:k,className:"bd-legend-i"}, _bdEl("span",{className:"bd-sw bd-k-"+k}), BD_STRIP_LABEL[k]))),
    _bdEl("div",{className:"bd-board"},
      shown.length ? shown.map(r=> _bdEl(BreakdownStrip,{key:r.scene.id, row:r, go, onMakeSceneNeeds, needsBusy, setNeedsBusy, onOpenStage, readOnly}))
        : _bdEl("div",{className:"bd-none"}, filter==="ready" ? "No scene is ready to shoot yet." : "Every scene is ready to shoot.")));
}
window.BreakdownView = BreakdownView;

const BD_PROPS_SHOWN = 6;
function BreakdownStrip({ row, go:goTab, onMakeSceneNeeds, needsBusy=null, setNeedsBusy=()=>{}, onOpenStage, readOnly=false }){
  const { scene, slug, cast, location, wardrobe, props, shots, missing, ready } = row;
  const go = (tab, action)=> goTab(tab, scene.id, action);   // every link opens on THIS scene
  const needsRun = (needsBusy && needsBusy.sceneId===scene.id) ? needsBusy : null;
  const makeable = (row.needs||[]).filter(n=>n.makeable);
  // the images it really makes — a variant whose master is missing makes the master too (2026-10-09)
  const makeImages = (typeof window.sceneNeedsImageCount==="function") ? window.sceneNeedsImageCount(makeable) : makeable.length;
  const [allMissing, setAllMissing] = React.useState(false);   // the status column's "+N more" opens the rest
  const makeNeeds = async ()=>{
    if(!onMakeSceneNeeds || needsBusy || !makeable.length) return;
    // busy only once the run starts (after its question) — the strip read "Making 0 of N" while you decided
    try{ await onMakeSceneNeeds(scene, makeable, (i,total)=>setNeedsBusy({ sceneId:scene.id, i, total })); }
    finally{ setNeedsBusy(null); }
  };
  // ONE SCENE, FROM HERE: make what it needs, then render it (both priced)
  const canRender = !readOnly && shots.total>0 && !(row.needs||[]).length && (shots.toRender||0)>0;
  const sceneActs = (onMakeSceneNeeds && makeable.length>0) || canRender ? _bdEl("div",{className:"bd-strip-acts"},
    (onMakeSceneNeeds && makeable.length>0) && _bdEl("button",{type:"button",className:"bd-act",disabled:!!needsBusy,onClick:makeNeeds,
        "aria-busy":needsRun?"true":undefined,
        "aria-label": (needsBusy && !needsRun) ? "Make what this scene needs (wait: another scene is making its images)" : undefined,
        title: (needsBusy && !needsRun) ? "Another scene is making its images \u2014 one at a time"
          : "Make the "+makeImages+" missing reference image"+(makeImages!==1?"s":"")+" this scene's frames use (location plates, rooms & times, character sheets, prop sheets \u2014 in that order). Asks first, with the price; a look that isn't written yet is drafted first (writing credits)."},
      needsRun ? ("Making "+needsRun.i+" of "+needsRun.total+"\u2026") : "Make what this scene needs",
      !needsRun && typeof window.nbCostChip==="function" && window.nbCostChip(makeImages)),
    canRender && _bdEl("button",{type:"button",className:"bd-act",onClick:()=>go("shots","render"),
        title:"Open Shots on this scene and render its "+shots.toRender+" frame"+(shots.toRender!==1?"s":"")+" that aren't approved and current (a frame only waiting for approval is re-rendered too \u2014 approve it in Shots instead, free) \u2014 Shots asks first, with the exact price"},
      "Render Scene "+String(scene.no!=null?scene.no:"").padStart(2,"0"),
      typeof window.nbCostChip==="function" && window.nbCostChip(shots.toRender))) : null;
  const [allProps, setAllProps] = React.useState(false);
  const [allWorn, setAllWorn] = React.useState(false);
  const kind = bdStripKind(slug);
  const dot = (ok)=> _bdEl("span",{className:"bd-dot"+(ok===true?" ok":ok==="unused"?" unused":""),"aria-hidden":"true"});
  // ok: true (ready) | false (missing) | "unused" (no frame of this scene attaches it — never red)
  // the status is READ too, not only shown by the dot's colour or on hover (2026-10-09)
  const chip = (key, label, ok, tab, title)=>{ const t = ok==="unused" ? (String(title||"").split(" \u2014 ")[0].replace(/ needs .*$/,"")+" \u2014 not in any of this scene's frames") : title;
    return _bdEl("button",{key, type:"button", className:"bd-chip"+(ok===true?" ok":ok==="unused"?" unused":""), onClick:()=>go(tab),
      title:t, "aria-label":String(t||label)+(ok===true?" (ready)":ok==="unused"?"":" (missing)")}, dot(ok), _bdEl("span",{className:"bd-chip-t"},label)); };
  const okOf = (x)=> !x ? false : x.status==="unused" ? "unused" : x.status ? x.status==="ready" : !!x.ready;
  const propsShown = allProps ? props : props.slice(0, BD_PROPS_SHOWN);
  const wornShown = allWorn ? wardrobe : wardrobe.slice(0, BD_PROPS_SHOWN);
  const more = (list, open, set)=> list.length>BD_PROPS_SHOWN && _bdEl("button",{type:"button",className:"bd-chip more",onClick:()=>set(v=>!v),"aria-expanded":open?"true":"false"},
    open ? "Show fewer" : "+"+(list.length-BD_PROPS_SHOWN)+" more");
  return _bdEl("div",{className:"bd-strip"+(kind?" bd-k-"+kind:"")+(ready?" is-ready":"")},
    _bdEl("div",{className:"bd-strip-id"},
      _bdEl("div",{className:"bd-strip-no"}, String(scene.no!=null?scene.no:"").padStart(2,"0")),
      _bdEl("div",{className:"bd-strip-ie"}, [slug.ie, slug.tod].filter(Boolean).join(" · ") || "—")),
    _bdEl("div",{className:"bd-strip-body"},
      _bdEl("div",{className:"bd-strip-head"},
        _bdEl("div",{className:"bd-strip-title"}, scene.title||"Untitled scene"),
        _bdEl("div",{className:"bd-strip-set"}, slug.place || (location && location.name) || "")),
      _bdEl("div",{className:"bd-rows"},
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Cast"),
          _bdEl("div",{className:"bd-chips"}, cast.length ? cast.map(c=> chip(c.id, c.state ? [c.name, _bdEl("span",{key:"s",className:"bd-chip-sub"}," · "+c.state)] : c.name,
              okOf(c), "characters", c.ready ? (c.state ? c.name+"'s "+c.state+" variant is ready" : c.name+"'s sheet is ready")
                : (c.state ? c.name+" needs the "+c.state+" variant" : c.name+" needs a character sheet")))
            : _bdEl("span",{className:"bd-empty"},"No one named in this scene"))),
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Location"),
          _bdEl("div",{className:"bd-chips"}, location ? chip("loc", location.name, okOf(location), "locations", location.ready ? "The plate is ready"
              : location.prereq ? "Needs its location plate \u2014 this scene's rooms & times are made from it" : "Needs its location plate")
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>go("locations"),title:"No location card resolves to this scene — check its slugline"}, dot(false), "No location card"))),
        wardrobe.length>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Wardrobe"),
          _bdEl("div",{className:"bd-chips"}, wornShown.map(p=> chip(p.id, p.name, okOf(p), p.onOwner || !p.ready ? "characters" : "props",
              p.name+(p.owner ? " \u2014 worn by "+p.owner : "")+" \u00b7 "+(p.onOwner ? "on "+(p.owner||"the owner")+"\u2019s character sheet"
                : p.ready ? "close-up sheet ready" : "rides on "+(p.owner||"its owner")+"\u2019s character sheet \u2014 make that sheet first"))),
            more(wardrobe, allWorn, setAllWorn))),
        props.length>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Props"),
          _bdEl("div",{className:"bd-chips"}, propsShown.map(p=> p.needs
            ? chip(p.id, p.name, okOf(p), "props", p.name+" \u2014 "+(p.ready ? "sheet ready" : "needs its prop sheet")+(p.owner ? " · "+p.kind+" by "+p.owner : ""))
            : _bdEl("button",{key:p.id,type:"button",className:"bd-chip text",onClick:()=>go("props"),title:p.name+" \u2014 text only: shots describe it from its specification"},
                _bdEl("span",{className:"bd-chip-t"},p.name), _bdEl("span",{className:"bd-chip-sub"}," · text"))),
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
              dot(row.boards.current===row.boards.total),
              row.boards.current+" of "+row.boards.total+" sheet"+(row.boards.total===1?"":"s")+" up to date"+(row.boards.stale?" \u00b7 "+row.boards.stale+" out of date":"")
                +(row.boards.oldLook?" \u00b7 "+row.boards.oldLook+" from frames with an earlier look":"")
                +(row.boards.partial?" \u00b7 "+row.boards.partial+" with frames still missing":"")
                +(row.boards.none?" \u00b7 "+row.boards.none+" not composed yet":"")))),
        shots.total>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Clips"),
          _bdEl("div",{className:"bd-chips"}, row.clips && row.clips.total
            ? _bdEl("button",{type:"button",className:"bd-chip"+(row.clips.rendered===row.clips.total && !row.clips.stale?" ok":""),
                onClick:()=>onOpenStage&&onOpenStage(), disabled:!onOpenStage,
                title:"The Stage's video clips for this scene, as of your last visit to the Stage \u2014 open the Stage"},
                dot(row.clips.rendered===row.clips.total && !row.clips.stale),
                row.clips.rendered+" of "+row.clips.total+" clip"+(row.clips.total===1?"":"s")+" rendered"
                  +(row.clips.stale?" \u00b7 "+row.clips.stale+" out of date":"")+(row.clips.oldLook?" \u00b7 "+row.clips.oldLook+" earlier look":"")
                  +(row.clips.notes?" \u00b7 "+row.clips.notes+" with take notes":"")
                  +" (at your last Stage visit)")
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>onOpenStage&&onOpenStage(),disabled:!onOpenStage,
                title:"Video clips are counted when you visit the Stage"}, dot("unused"), "Counted on your next visit to the Stage")))),
      (row.notes||[]).length>0 && _bdEl("div",{className:"bd-notes"}, row.notes.map((n,i)=>
        _bdEl("button",{key:i,type:"button",className:"bd-note",onClick:()=>go(n.tab)}, Icon.info&&_bdEl(Icon.info,{s:12}), n.text))),
      sceneActs),
    _bdEl("div",{className:"bd-strip-status"+(ready?" ok":"")},
      ready ? _bdEl(React.Fragment,null, _bdEl(Icon.check,{s:14}), "Ready")
        : _bdEl(React.Fragment,null, _bdEl("span",{className:"bd-need-n"}, missing.length), _bdEl("span",null,"to go"),
            _bdEl("div",{className:"bd-need-list"}, (allMissing ? missing : missing.slice(0,4)).map((m,i)=> _bdEl("button",{key:i,type:"button",className:"bd-need",title:m.text,onClick:()=>go(m.tab)}, m.text)),
              missing.length>4 && _bdEl("button",{type:"button",className:"bd-need more","aria-expanded":allMissing?"true":"false",onClick:()=>setAllMissing(v=>!v)},
                allMissing ? "Show fewer" : "+"+(missing.length-4)+" more")))));
}

const _bdEsc = (s)=> String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const _bdFileBase = (project)=> ((project && project.title) || "film").replace(/[^\w\-]+/g,"_").toUpperCase();
const _bdFormatLabel = (project)=>{ try{ return (typeof formatOf==="function" && project) ? (formatOf(project).label||"") : ""; }catch(e){ return ""; } };
function _bdPreview(title, sub, fileName, html, hint){
  if(typeof window.docPreview==="function"){ window.docPreview({ title, sub, fileName, html, hint }); return; }
  const w = window.open("", "_blank");
  if(w){ w.document.open(); w.document.write(html); w.document.close(); }
}

/* the printable stripboard — the same rows as the tab, one coloured line per scene */
function exportStripboard(rows, project){
  const title = (project && project.title) || "Stripboard";
  const sum = breakdownSummary(rows);
  const body = (rows||[]).map(r=>{
    const k = bdStripKind(r.slug);
    // "○ not made yet" follows the chip's status, as the tab shows it (2026-10-09): an item no frame uses isn't owed
    const owed = (x)=> x.status ? x.status==="missing" : !x.ready;
    const cast = r.cast.map(c=> _bdEsc(c.name)+(c.state?' <i>('+_bdEsc(c.state)+')</i>':"")+(owed(c)?" ○":"")).join(", ");
    const props = r.props.map(p=> _bdEsc(p.name)+(p.needs&&owed(p)?" ○":"")).join(", ");
    const worn = r.wardrobe.map(p=> _bdEsc(p.name)+(p.owner?' <i>('+_bdEsc(p.owner)+')</i>':"")+(owed(p)?" ○":"")).join(", ");
    const notes = (r.notes||[]).map(n=>n.text).join("; ");
    return '<tr class="k-'+(k||"none")+'">'
      +'<td class="no">'+_bdEsc(String(r.scene.no!=null?r.scene.no:"").padStart(2,"0"))+'</td>'
      +'<td>'+_bdEsc(r.slug.ie||"")+'</td>'
      +'<td><b>'+_bdEsc(r.slug.place||(r.location&&r.location.name)||"")+'</b><div class="t">'+_bdEsc(r.scene.title||"")+'</div></td>'
      +'<td>'+_bdEsc(r.slug.tod||"")+'</td>'
      +'<td>'+cast+'</td>'
      +'<td class="w">'+worn+'</td>'
      +'<td>'+props+'</td>'
      +'<td class="num">'+(r.shots.total ? (r.framesDone!=null ? r.framesDone : r.shots.approved)+' approved · '+r.shots.rendered+'/'+r.shots.total : "—")+'</td>'
      +'<td>'+(r.ready ? '<b class="ok">Ready</b>' : _bdEsc(r.missing.map(m=>m.text).join(", ")))+(notes ? '<div class="t">'+_bdEsc(notes)+'</div>' : "")+'</td></tr>';
  }).join("");
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>'+_bdEsc(title)+' — Stripboard</title><style>'
    +'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#16181d;margin:36px;}'
    +'h1{font-size:20px;margin:0 0 4px;} .sub{color:#666;font-size:12px;margin-bottom:6px;} .legend{font-size:10.5px;color:#555;margin-bottom:16px;}'
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
    +'<div class="legend"><span class="k-int-day">INT day</span><span class="k-ext-day">EXT day</span><span class="k-int-night">INT night</span><span class="k-ext-night">EXT night</span><span class="k-none">No time of day</span><span class="k-dusk">Dawn / dusk</span> &nbsp;○ = not made yet</div>'
    +'<table><thead><tr><th>Sc</th><th>I/E</th><th>Set · scene</th><th>Time</th><th>Cast</th><th>Wardrobe</th><th>Props</th><th>Frames</th><th>Status</th></tr></thead><tbody>'+body+'</tbody></table>'
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
async function _bdInline(url){
  if(!url || /^data:/.test(url)) return url;
  try{
    if(typeof window.sbToDataUrl==="function") return (await window.sbToDataUrl(url)) || url;
    const blob = await (await fetch(url)).blob();
    return await new Promise((res)=>{ const fr = new FileReader(); fr.onload = ()=>res(String(fr.result||url)); fr.onerror = ()=>res(url); fr.readAsDataURL(blob); });
  }catch(e){ return url; }
}
async function exportArtBible({ project, characters, props, locations, scenes, drafts, shots }){
  const title = (project && project.title) || "Art department bible";
  const ordered = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  const _raw = (id)=>{ try{ return (typeof nbGetImage==="function" && nbGetImage(id)) || ""; }catch(e){ return ""; } };
  const _inlined = {};
  // each sheet is LOADED, not only read from the cache (2026-10-09 — after a reload, sheets the Breakdown hadn't
  // looked up printed "No sheet yet"), and each character's appearance-state sheets come too
  const _load = async (id)=>{ let u = _raw(id); if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(id) || ""; }catch(e){ u = ""; } } return u; };
  const _ids = [];
  [...(characters||[]), ...(props||[]), ...(locations||[])].forEach(x=>{ if(x && x.id) _ids.push(x.id); });
  (characters||[]).forEach(c=>{ (c && Array.isArray(c.states) ? c.states : []).forEach(st=>{ if(st && st.id) _ids.push(c.id+":"+st.id); }); });
  for(const id of _ids){ if(id in _inlined) continue; const u = await _load(id); if(u) _inlined[id] = await _bdInline(u); }
  const imgUrl = (id)=> _inlined[id] || _raw(id);
  const scNos = (ids)=> ordered.filter(s=> ids.indexOf(s.id)>=0).map(s=> s.no);
  const scLine = (nos)=> nos.length ? "Sc "+nos.join(", ") : "";
  const field = (lab, v)=>{ const t = (v==null ? "" : Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v)).trim();
    return t ? '<div class="f"><span class="l">'+_bdEsc(lab)+'</span>'+_bdEsc(t)+'</div>' : ""; };
  const pic = (id, alt)=>{ const u = imgUrl(id); return u ? '<img src="'+_bdEsc(u)+'" alt="'+_bdEsc(alt)+'">' : '<div class="noimg">No sheet yet</div>'; };
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
    const swatches = (Array.isArray(c.palette)?c.palette:[]).filter(x=>typeof x==="string" && /^#|^rgb|^oklch|^hsl/.test(x)).slice(0,8)
      .map(x=>'<span class="sw" style="background:'+_bdEsc(x)+'"></span>').join("");
    return '<section class="card"><div class="pic">'+pic(c.id, c.name)+'</div><div class="txt">'
      +'<h3>'+_bdEsc(c.name||"Unnamed")+'</h3>'
      +'<div class="m">'+_bdEsc([c.role, c.archetype].filter(Boolean).join(" · "))+'</div>'
      +field("Pronouns", c.pronouns)+field("Scale", SCALE[c.scaleClass]||"")+field("Height", c.height)
      +field("Identity", c.identity)+field("Body", c.coreBody)
      +(physInBody ? "" : field("Age", F.age)+field("Build", F.build)+field("Skin", F.skin)+field("Eyes", F.eyes)+field("Hair", F.hair)+field("Face", F.face))
      +field("Wardrobe", c.wardrobe)+field("Accessories", c.accessories)+field("Look", c.look)
      +field("Voice", [v.accent, v.pitch, v.pace, v.quirks].filter(Boolean).join("; "))
      +field("Signature expressions", Array.isArray(c.expressions)?c.expressions:"")
      +(swatches?'<div class="f"><span class="l">Palette</span>'+swatches+'</div>':"")
      +(states?'<div class="f"><span class="l">Appearance states</span><ul>'+states+'</ul></div>':"")
      +field("Scenes", scLine(inScenes))
      +'</div></section>';
  }).join("");
  const KIND = { worn:"Worn", carried:"Carried", dressing:"Set dressing" };
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts||{}).tier : "own"; }catch(e){ return "own"; } };
  const propsHtml = (props||[]).map(p=>{
    const text = p.kind!=="worn" && tierOf(p)==="text";
    return '<section class="card">'+(text ? '<div class="pic"><div class="noimg">Text only — described in shots</div></div>' : '<div class="pic">'+pic(p.id, p.name)+'</div>')
      +'<div class="txt"><h3>'+_bdEsc(p.name||"Prop")+'</h3>'
      +'<div class="m">'+_bdEsc([KIND[p.kind]||KIND.carried, p.ownerName].filter(Boolean).join(" · "))+'</div>'
      +field("Form", p.form)+field("Material", p.material)+field("Size", p.size)+field("Condition", p.condition)
      +field("Significance", p.detail)+field("Scenes", scLine(scNos(Array.isArray(p.scenes)?p.scenes:[])))
      +'</div></section>';
  }).join("");
  const locsHtml = (locations||[]).map(l=>{
    const locScenes = ordered.filter(s=>{ const hit = (typeof locationForScene==="function") ? locationForScene(locations, s.id) : null; return hit && hit.id===l.id; }).map(s=>s.no);
    return '<section class="card wide"><div class="pic">'+pic(l.id, l.name)+'</div><div class="txt">'
      +'<h3>'+_bdEsc(l.name||"Location")+'</h3>'
      +'<div class="m">'+_bdEsc([l.intExt, l.parentLocation && l.parentLocation.name ? "within "+l.parentLocation.name : ""].filter(Boolean).join(" · "))+'</div>'
      +field("Architecture", l.architecture)+field("Materials", l.materials)+field("Permanent lighting", l.lighting)
      +field("Permanent dressing", l.permanentDressing)+field("How the rooms connect", l.topology)+field("Fixed landmarks", l.continuityAnchors)
      +field("Significance", l.significance)+field("Scenes", scLine(locScenes))
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
    +'.empty{color:#888;font-size:12px;} *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    +'@media print{body{margin:12mm;} h2{break-after:avoid;}}'
    +'</style></head><body>'
    +'<h1>'+_bdEsc(title)+' &mdash; Art department bible</h1>'
    +'<div class="sub">'+(fmt?_bdEsc(fmt)+' &middot; ':'')+_bdEsc(counts)+' &middot; '+_bdEsc(new Date().toLocaleDateString())+' &middot; Made with Kinolot</div>'
    +'<h2>Cast</h2>'+(castHtml||'<div class="empty">No characters yet.</div>')
    +'<h2>Props</h2>'+(propsHtml||'<div class="empty">No props yet.</div>')
    +'<h2>Locations</h2>'+(locsHtml||'<div class="empty">No locations yet.</div>')
    +'</body></html>';
  _bdPreview("Art department bible", title, _bdFileBase(project)+"_ART_BIBLE.html", html,
    "Sheet images are embedded, so the saved file keeps them. Print / save as PDF, or download the HTML.");
}
window.exportArtBible = exportArtBible;
window.breakdownRows = breakdownRows;
window.breakdownSummary = breakdownSummary;
window.bdSlug = bdSlug;

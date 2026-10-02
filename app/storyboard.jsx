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
  if(grid==="2x2") return { cols:2, rows:2 };
  const cols = N<=1 ? 1 : (N<=4 ? 2 : 3);
  return { cols, rows:Math.ceil(Math.max(1,N)/cols) };
}

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

function sbPropIdsForPage(scene, shots, ctx){
  const out=[], seen=new Set();
  let ledger = {};
  try{ ledger = (typeof sceneContinuityLedger==="function")
    ? sceneContinuityLedger(scene, shots, ctx.charById, ctx.propById) : {}; }catch(e){}
  (shots||[]).forEach(sh=>{
    const own = (typeof inFrameProps==="function") ? inFrameProps(sh, scene, ctx.charById, ctx.propById) : ((sh&&sh.props)||[]);
    const ids = [].concat(own||[], (ledger && ledger[sh.id]) || []);
    ids.forEach(id=>{ if(id && !seen.has(id)){ seen.add(id); out.push(id); } });
  });
  return out;
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
  let action = (sh.action||"").replace(/\s+/g," ").trim();
  const m = action.match(/^[^.!?]*[.!?]/); if(m) action=m[0];
  action = action.replace(/[.!?]+$/,"");
  const dlg = (sh.dialogue||"").trim().replace(/^["“]|["”]$/g,"").replace(/[.!?]+$/,"");
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
function sbSheetStale(meta, shotIds){
  if(!meta) return false;
  if(Array.isArray(meta.shotIds)) return !sbIdsEqual(meta.shotIds, shotIds||[]);
  if(meta.composed && Number(meta.panels)>0) return Number(meta.panels)!==(shotIds||[]).length;
  return false;
}
function sbHalfStale(meta, shotIds, half, sheetMeta){
  if(!meta) return false;
  if(Array.isArray(meta.shotIds)) return !sbIdsEqual(meta.shotIds, sbHalfShotIds(shotIds, half));
  return sbSheetStale(sheetMeta, shotIds);
}
window.sbSheetStale = sbSheetStale;
window.sbHalfStale = sbHalfStale;
window.sbHalfShotIds = sbHalfShotIds;

/* Truthful board readiness: a composed sheet that still contains placeholder panels
   is partial, not ready. Uploaded boards have no composed metadata and count complete. */
function sbStoryboardReadiness(pagesByScene, frames, metaOf){
  const out = { complete:0, partial:0, missing:0, total:0 };
  const getMeta = typeof metaOf==="function" ? metaOf : ()=>null;
  (pagesByScene||[]).forEach(g=>(g.pages||[]).forEach(page=>{
    out.total++;
    const id = "sbsheet-"+page.id;
    if(!(frames&&frames[id])){ out.missing++; return; }
    const meta = getMeta(id)||{};
    const missing = Math.max(0, Number(meta.missing)||0);
    if(meta.composed && missing>0) out.partial++; else out.complete++;
  }));
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
const _sbComposeRuns = {};   // sheet id -> { again, promise }
function sbSheetSnapshot(page){
  return ((page&&page.shots)||[]).map(sh=>{
    const u = (typeof nbGetImage==="function") ? (nbGetImage(sh.id)||"") : "";
    const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
    return sh.id+"@"+((m&&m.iso)||"")+"#"+((m&&m.version)||"")+"|"+u;
  }).join("~");
}
function sbComposeSheet(scene, page, ctx, beatsMap, extraMeta, _drawFn){
  const sid = "sbsheet-"+page.id;
  const cur = _sbComposeRuns[sid];
  if(cur){ cur.again = true; return cur.promise; }   // coalesce onto the running writer
  const draw = _drawFn || composeStoryboardSheet;    // _drawFn: headless-test seam only
  const run = { again:false };
  run.promise = (async ()=>{
    try{
      // NEVER commit a payload drawn from superseded frames — on ANY pass, including
      // after a successful commit if a newer request arrived during the save. The
      // loop only repeats when something really changed (a frame re-rendered, a new
      // request coalesced), so it settles as soon as renders settle; each pass is a
      // cheap canvas redraw, never a generation.
      while(true){
        run.again = false;
        const _ep = (typeof nbEpoch==="function") ? nbEpoch() : null;   // film scope, per pass
        // warm the frame caches BEFORE snapshotting, so a cold cache doesn't read
        // as a frame change and force a pointless second draw
        for(const sh of (page.shots||[])){
          if(typeof nbGetImage==="function" && !nbGetImage(sh.id) && typeof nbLoadImage==="function"){
            try{ await nbLoadImage(sh.id); }catch(e){}
          }
        }
        const snap = sbSheetSnapshot(page);
        const dataUrl = await draw(scene, page, ctx, beatsMap);
        if(!dataUrl){
          if(run.again) continue;      // a frame may have JUST arrived — try again
          return { status:"skipped" }; // nothing to draw — not a failure
        }
        if(run.again || sbSheetSnapshot(page)!==snap) continue;   // outdated payload: redraw, don't commit
        const meta = { model:"Composited from shot frames", composed:true,
          panels:(page.shots||[]).length, shotIds:(page.shots||[]).map(x=>x.id), ...(extraMeta||{}), ts:Date.now() };
        const r = (typeof nbCommit==="function") ? await nbCommit(sid, dataUrl, meta, [], undefined, _ep) : null;
        if(r && r.tier==="stale") return { status:"stale" };   // film switched: quiet discard
        if(!r || r.tier==="error") return { status:"failed", error:"the composed sheet couldn't be saved. Check your connection and try again." };
        try{ sessionStorage.removeItem("turn_sb_hold_"+sid); }catch(e){}
        try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id:sid, url:r.url||dataUrl } })); }catch(e){}
        // a coalesced request landed while the commit was saving: its frames are
        // newer than what we just wrote — go around once more so the stored sheet
        // ends on the newest state
        if(run.again) continue;
        return { status:"composed", url:r.url||dataUrl };
      }
    } finally { delete _sbComposeRuns[sid]; }
  })();
  _sbComposeRuns[sid] = run;
  return run.promise;
}
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
  const _ap = _asp.split(":").map(Number);
  const _vert = _ap[1] > _ap[0];
  const PAD=8, GAP=8, CELL_W=_vert?400:632, IMG_H=Math.round(CELL_W*_ap[1]/_ap[0]), STRIP_H=148, CELL_H=IMG_H+STRIP_H;
  const { cols, rows } = sbGridShape(N, page.grid);
  const W = PAD*2 + cols*CELL_W + (cols-1)*GAP;
  const H = PAD*2 + rows*CELL_H + (rows-1)*GAP;
  const canvas = document.createElement("canvas"); canvas.width=W; canvas.height=H;
  const g = canvas.getContext("2d");
  g.fillStyle = "#101012"; g.fillRect(0,0,W,H);
  const bitmaps = await Promise.all(urls.map(u=>sbLoadBitmap(u)));
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
      g.fillText("Frame not generated — Shot "+scene.no+"."+(off+i+1), x+CELL_W/2, y+IMG_H/2-8);
      g.font="500 12px 'Space Mono', monospace";
      g.fillText("generate it in the Shots tab — the sheet recomposes itself", x+CELL_W/2, y+IMG_H/2+14);
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
    g.fillText(scene.no+"."+(off+i+1), x+CELL_W-12, sy+22); g.textAlign="left";
  }
  bitmaps.forEach(bm=>{ if(bm && bm.revoke){ try{ URL.revokeObjectURL(bm.revoke); }catch(e){} } });
  return canvas.toDataURL("image/jpeg", 0.92);
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

function StoryboardComposite({ scene, page, ctx, beatsMap, onView, onUpdateShot }){
  const sid = "sbsheet-"+page.id;
  // store/display ONLY — this tab never paints sheets; compose-from-frames is the path
  const gen = useImageGen({ id: sid, slotId: sid });
  const shotIds = (page.shots||[]).map(s=>s.id);
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
      if(ctx.location){ const u=await grab(ctx.location.id); if(u){ out.push({ url:u, label:(ctx.location.name||"Location")+" plate", kind:"location" }); seen.add(ctx.location.id); } }
      const ids=[]; const _chars=Object.values(ctx.charById||{});
      shots.forEach(sh=>{ const inc=(typeof inFrameCast==="function")?inFrameCast(sh, scene, _chars):(sh.subjects||[]); inc.forEach(id=>{ if(ids.indexOf(id)<0) ids.push(id); }); });
      for(const id of ids){ if(seen.has(id)) continue; const c=ctx.charById[id]; if(!c) continue; const u=await grab(id); if(u){ out.push({ url:u, label:c.name, kind:"character" }); seen.add(id); } }
      for(const id of sbPropIdsForPage(scene, shots, ctx)){ if(seen.has(id)) continue; const p=ctx.propById[id]; if(!p) continue; const u=await grab(id); if(u){ out.push({ url:u, label:p.name||"Prop", kind:"prop" }); seen.add(id); } }
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
      const c = ctx.charById[cid]; if(c) out.push({ id:c.id, label:c.name, note:c.name+"'s character sheet" });
    }));
    sbPropIdsForPage(scene, refShots, ctx).forEach(pid=>{
      if(seen.has(pid)) return; seen.add(pid);
      const p = ctx.propById[pid]; if(p) out.push({ id:p.id, label:p.name||"Prop", note:(p.name||"Prop")+" prop sheet" });
    });
    if(ctx.location) out.push({ id:ctx.location.id, label:(ctx.location.name||"Location")+" plate", note:(ctx.location.name||"the location")+" location plate" });
    return out;
  },[scene, page.shots, ctx]);
  const toggleEditRef = (rid)=> setEditRefSel(sel=> sel.indexOf(rid)>=0 ? sel.filter(x=>x!==rid) : [...sel, rid]);
  const editRefChips = (key)=> editRefOptions.length>0 && _sbEl("div",{key, className:"sb-editrefs"},
    _sbEl("span",{className:"sb-editrefs-lab"},"Reference:"),
    editRefOptions.map(o=> _sbEl("button",{key:o.id, className:"sb-editref-chip"+(editRefSel.indexOf(o.id)>=0?" on":""),
      title:"Attach "+o.note+" to this edit so the model matches that design exactly",
      onClick:()=>toggleEditRef(o.id)}, o.label)));

  // the sheet version the halves must match to count as "already saved"
  const sheetVersion = ()=>{ const m = gen.genMeta || ((typeof nbGetMeta==="function") ? nbGetMeta(sid) : null) || {};
    return String(m.iso||m.ts||m.version||""); };
  // the page's shots changed since this sheet / these halves were made (see sbSheetStale)
  const sheetMetaNow = () => gen.genMeta || ((typeof nbGetMeta==="function") ? nbGetMeta(sid) : null);
  const halvesStale = !!((halves.top && sbHalfStale((halves.top||{}).meta, shotIds, "top", sheetMetaNow()))
    || (halves.bottom && sbHalfStale((halves.bottom||{}).meta, shotIds, "bottom", sheetMetaNow())));
  const halvesCurrent = !halvesStale && !!(halves.top && halves.bottom && (()=>{ const v = sheetVersion();
    const tv = String(((halves.top||{}).meta||{}).sourceVersion||""), bv = String(((halves.bottom||{}).meta||{}).sourceVersion||"");
    return v ? (tv===v && bv===v) : true; })());
  const saveHalves = async ()=>{
    if(halvesBusy || !gen.genUrl || halvesCurrent) return;   // duplicate guard
    if(isComposed && readyRef.current.n < readyRef.current.total){
      setHalvesErr("Stage hand-off needs every required panel. This sheet is partial ("+
        readyRef.current.n+"/"+readyRef.current.total+" frames); generate the missing frames in the Shots tab first.");
      setMenuOpen(false);
      return;
    }
    setHalvesBusy(true); setHalvesDone(false); setHalvesErr("");
    try{
      await sbSaveHalves(gen.genUrl, sid, page, sheetVersion());
      await loadHalves();
      setHalvesDone(true);
      setTimeout(()=>{ setHalvesDone(false); setMenuOpen(false); }, 1600);
    }catch(e){ setMenuOpen(false); setHalvesErr("Saving the halves failed — "+((e&&e.message)||e)); }
    setHalvesBusy(false);
  };
  const restoreHalf = async (h)=>{
    if(typeof nbRevertAsset!=="function") return;
    setHalvesErr("");
    try{
      const r = await nbRevertAsset(sid+":half-"+h, 0);
      if(!r){ setHalvesErr("No earlier version of the "+h+" half to restore."); return; }
      await loadHalves();
      // sync the DISPLAYED SHEET to the version this half was cut from, so there's no
      // ambiguity about which sheet the restored half belongs to
      const srcVer = String(((r && r.meta)||{}).sourceVersion||"");
      if(!srcVer){ setHalvesErr("Half restored — but it predates version stamps, so the matching sheet version couldn't be shown."); return; }
      if(srcVer === sheetVersion()) return;   // the matching sheet is already on display
      const det = await gen.loadDetails();
      const hist = (det && det.history) || [];
      const idx = hist.findIndex(e=>{ const m=(e && e.meta)||{}; return String(m.iso||m.ts||m.version||"")===srcVer; });
      if(idx < 0){ setHalvesErr("Half restored — but the sheet version it was cut from is no longer in the sheet's history."); return; }
      await gen.revertTo(idx);
    }catch(e){ setHalvesErr("Couldn't restore the "+h+" half — "+((e&&e.message)||e)); }
  };
  const deleteHalf = async (h)=>{
    let ok = true;
    if(typeof window.appConfirm==="function"){
      ok = await window.appConfirm({ title:"Delete the "+h+" half?",
        body:"Removes this saved half from your project (the Stage won't see it). The sheet itself is untouched — you can re-save halves anytime.",
        confirmLabel:"Delete", danger:true });
    }
    if(!ok) return;
    setHalvesErr("");
    try{ if(typeof nbClearAsset==="function") await nbClearAsset(sid+":half-"+h); }
    catch(e){ setHalvesErr("Couldn't delete the "+h+" half — "+((e&&e.message)||e)); return; }
    await loadHalves();
  };

  // ---- self-derivation: the sheet is a VIEW over the shot frames ----------------
  const isComposed = !!((gen.genMeta && gen.genMeta.composed) || ((typeof nbGetMeta==="function") && (nbGetMeta(sid)||{}).composed));
  const [panelBusy, setPanelBusy] = React.useState(false);
  // refs so the nb-gen-done listener (registered once per page) always sees fresh state
  const isComposedRef = React.useRef(isComposed); isComposedRef.current = isComposed;
  const sheetOutOfDate = !!(gen.genUrl && isComposed && sbSheetStale(sheetMetaNow(), shotIds));
  const panelBusyRef = React.useRef(panelBusy);   panelBusyRef.current = panelBusy;
  const composingRef = React.useRef(composing);   composingRef.current = composing;
  const readyRef     = React.useRef(ready);       readyRef.current = ready;
  const autoTimer    = React.useRef(null);

  // lay the existing shot frames into the sheet grid with REAL text strips —
  // instant, zero generation cost, per-panel repair via the Shot List
  const doCompose = async ()=>{
    if(!readyRef.current.n) return;
    if(composingRef.current){
      // a compose is already running — still route this request into the coordinator
      // (fire-and-forget): it marks the active run superseded so it redraws with the
      // newest frames before committing, instead of this event being silently lost
      try{ const p = sbComposeSheet(scene, page, ctx, beatsMap,
          { missing: readyRef.current.total-readyRef.current.n, aspect:sheetAsp });
        if(p && p.catch) p.catch(()=>{}); }catch(e){}
      return;
    }
    setComposing(true); setComposeErr("");
    try{
      // the shared coordinator serializes this sheet against bulk runs and other
      // mounted cards, redraws once if frames change mid-draw, and reports honestly
      const res = await sbComposeSheet(scene, page, ctx, beatsMap,
        { missing: readyRef.current.total-readyRef.current.n, aspect:sheetAsp });
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
      const h = { total:(page.shots||[]).length, unrendered:0, approved:0, unapproved:0, staleSeed:0, staleSrc:0 };
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
      }
      if(alive){ setReady({ n, total:shotIds.length }); setHealth(h); }
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
      if(d.id && isComposedRef.current && !panelBusyRef.current){
        clearTimeout(autoTimer.current);
        autoTimer.current = setTimeout(()=>{ doComposeRef.current(); }, 900);
      }
    };
    window.addEventListener("nb-gen-done", onChange);
    window.addEventListener("nb-prefetched", onChange);
    return ()=>{ alive=false; clearTimeout(autoTimer.current);
      window.removeEventListener("nb-gen-done", onChange); window.removeEventListener("nb-prefetched", onChange); };
  },[(page.shots||[]).map(s=>s.id+":"+(s.locked?1:0)).join(",")]);   // approve/unapprove refreshes health too

  // FIRST VIEW: a scene whose frames already exist gets its sheet composed
  // automatically — the board builds itself from the shot chain. A Clear in this tab
  // session holds the auto-compose off (sessionStorage) so it never fights the user.
  const autoTried = React.useRef(false);
  React.useEffect(()=>{ autoTried.current=false; },[sid]);
  React.useEffect(()=>{
    if(gen.genUrl || !ready.n || composing || autoTried.current) return;
    try{ if(sessionStorage.getItem("turn_sb_hold_"+sid)==="1") return; }catch(e){}
    autoTried.current = true;
    doComposeRef.current();
  },[gen.genUrl, ready.n, composing]);

  // ---- per-panel repair --------------------------------------------------------
  // Edit the underlying SHOT FRAME (same language as the Shots tab's edit), then
  // recompose; the Shots card adopts the new frame too. Composed sheets only —
  // an uploaded sheet has no per-shot frames to edit through.
  const [panelEdit, setPanelEdit] = React.useState(null);   // {idx:int|null, text:string} | null
  const [panelErr, setPanelErr] = React.useState("");
  const applyPanelEdit = async ()=>{
    if(!panelEdit || panelEdit.idx==null || !panelEdit.text.trim() || panelBusy || composing || !isComposed) return;
    const text = panelEdit.text.trim();
    const i = panelEdit.idx, sh = page.shots[i];
    const requestedModel=typeof nbGetModel==="function"?nbGetModel():undefined;
    const requestedQuality=/^gpt-image-2\.5-/.test(requestedModel||"")&&typeof nbGetOaiQuality==="function"
      ?nbGetOaiQuality(requestedModel):"medium";
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
      // Preserve GPT Image 2's medium timeout guard; 2.5 uses the captured choice.
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
          ...submitIdentity, ...(extra.length?{extraImages:extra}:{}), assetId:sh.id });
      const afterProviderIdentity = panelIdentityOpts();
      if(typeof window.nbAssertMediaIdentity==="function")
        window.nbAssertMediaIdentity(afterProviderIdentity,"storyboard-panel-edit-after-provider");
      // ownership re-check after the long model await: if a newer run took the shot
      // over (a cancel released our token, then a Shots tab render claimed it), that
      // render is the newer intent — discard this edit; the newer owner's events
      // drive the UI, not ours, so no cancel event is fired here
      if(!_own()){
        setPanelErr("That shot started a new render while the edit ran — this edit was discarded so it can't overwrite the newer frame.");
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
      await doCompose();   // rebuild the sheet with the repaired panel
    }catch(e){
      _release();
      try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id:sh.id } })); }catch(err){}
      setPanelErr((e&&e.message)||"Edit failed.");
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
  const pickUpload = ()=>{ if(sbUploadRef.current) sbUploadRef.current.click(); };
  const onUploadPicked = (e)=>{ const f=e.target.files&&e.target.files[0]; if(f && gen.importSheet) gen.importSheet(f); e.target.value=""; };
  const clearSheet = ()=>{ setMenuOpen(false);
    // hold off the auto-compose for the rest of this tab session, so Clear sticks
    try{ sessionStorage.setItem("turn_sb_hold_"+sid,"1"); }catch(e){}
    gen.clearGen(); };
  return _sbEl("div",{className:"sb-comp","data-sbsheet":page.id},
    _sbEl("input",{type:"file",accept:"image/png,image/jpeg,image/webp,image/avif",ref:sbUploadRef,style:{display:"none"},onChange:onUploadPicked}),
    _sbEl("div",{className:"sb-comp-frame"},
      gen.genUrl && _sbEl("div",{className:"sheet-tools-menu sb-tpanel-menu",ref:menuRef},
        _sbEl("button",{className:"sb-tpanel-opts"+(menuOpen?" on":""),onClick:()=>setMenuOpen(m=>!m),title:"Options"}, _sbEl(Icon.moreV,{s:14})),
        menuOpen && _sbEl("div",{className:"sheet-tools-dropdown"},
          _sbEl("button",{className:"sheet-tools-item",onClick:()=>{ onView({url:gen.genUrl,character:{name}}); setMenuOpen(false); }}, _sbEl(Icon.eye,{s:14}),"View full"),
          _sbEl("button",{className:"sheet-tools-item",onClick:()=>{ setDetailsOpen(true); setMenuOpen(false); }}, _sbEl(Icon.info,{s:14}),"Details"),
          _sbEl("button",{className:"sheet-tools-item "+(panelEdit?"on":""), disabled:!isComposed,
            title: isComposed ? "Edit one panel — the change is applied to that shot's frame, then the sheet recomposes"
                              : "Panel repair needs a composed sheet (it edits the shot's frame) — this sheet was uploaded or painted elsewhere",
            onClick:()=>{ if(!isComposed) return; setPanelEdit(panelEdit?null:{idx:null,text:""}); setPanelErr(""); setMenuOpen(false); }},
            _sbEl(Icon.grid,{s:14}), panelEdit?"Close panel edit":"Edit a panel…"),
          _sbEl("button",{className:"sheet-tools-item",disabled:composing||!ready.n,
            title: ready.n ? "Recompose the sheet from the shots' current frames" : "No shot frames to compose from",
            onClick:()=>{ doCompose(); setMenuOpen(false); }}, _sbEl(Icon.board,{s:14}),"Recompose from frames"),
          _sbEl("button",{className:"sheet-tools-item",disabled:composing,onClick:()=>{ setMenuOpen(false); pickUpload(); }}, _sbEl(Icon.image,{s:14}),"Replace with upload"),
          _sbEl("button",{className:"sheet-tools-item"+((halvesDone||halvesCurrent)?" on":""),disabled:!gen.genUrl||halvesBusy||halvesCurrent,
            title: halvesCurrent
              ? "Both halves of this sheet version are already saved — recompose or edit the sheet to re-save"
              : "Split the sheet horizontally and save BOTH halves to your project (cloud) — on a 2×2 sheet each half is one panel row (two frames side by side), ready for the Stage's video generation (e.g. Seedance)",
            onClick:saveHalves},
            _sbEl(Icon.download,{s:14}),
            halvesBusy?"Saving halves…"
              :halvesDone?"Halves saved ✓"
              :halvesCurrent?"Halves saved (current)"
              :(halves.top||halves.bottom)?"Re-save halves (sheet changed)"
              :"Save halves (for the Stage)"),
          _sbEl("div",{className:"sheet-tools-divider"}),
          _sbEl("button",{className:"sheet-tools-item danger",onClick:clearSheet}, _sbEl(Icon.x,{s:14}),"Clear"))),
      gen.genUrl
        ? _sbEl("img",{className:"sb-comp-img",src:gen.genUrl,alt:"",loading:"lazy",onClick:()=>onView({url:gen.genUrl,character:{name}})})
        : composing
          ? _sbEl("div",{className:"sb-comp-empty",style:{cursor:"default"}},
              _sbEl("span",{className:"ns-spin"}),_sbEl("span",null,"Composing sheet…"))
          : _sbEl("div",{className:"sb-comp-choices"},
              _sbEl("button",{className:"sb-comp-choice primary",onClick:doCompose,disabled:!ready.n,
                title: ready.n ? "Lay the shots' generated frames into the sheet — instant, free, real text strips"
                               : "No shot frames yet — generate frames in the Shots tab; the sheet composes itself"},
                _sbEl(Icon.board,{s:16}),_sbEl("span",null,"Compose from shot frames"),
                _sbEl("span",{className:"sb-comp-empty-sub"}, ready.n+" of "+ready.total+" frames ready · instant · free")),
              _sbEl("button",{className:"sb-comp-choice",onClick:pickUpload,
                title:"Import a finished storyboard sheet you made elsewhere at full resolution"},
                _sbEl(Icon.image,{s:16}),_sbEl("span",null,"Upload a sheet"),
                _sbEl("span",{className:"sb-comp-empty-sub"}, "from your computer · full resolution"))),
      (composing||panelBusy) && gen.genUrl && _sbEl("div",{className:"sb-tpanel-spin"},
        _sbEl("span",{className:"ns-spin"}),
        _sbEl("span",{className:"sb-spin-lab"},
          panelBusy ? "Editing panel — regenerating that shot's frame…"
          : "Composing sheet from shot frames…")),
      /* the page's shots changed since this sheet was composed: it shows other panels, and
         the Stage won't use it (or its halves) until it is recomposed — a free redraw */
      sheetOutOfDate && !composing && !composeErr && _sbEl("div",{className:"sb-sheet-err sb-sheet-stale"},
        _sbEl(Icon.alert,{s:14}),
        _sbEl("span",{className:"sb-sheet-err-msg"},"The shots on this page changed since this sheet was composed, so it shows the wrong panels. The Stage won\u2019t use it until you recompose it."),
        _sbEl("div",{className:"sb-sheet-err-acts"},
          _sbEl("button",{className:"sb-sheet-err-btn primary",onClick:()=>doCompose(),disabled:!ready.n},"Recompose"))),
      /* compose/halves failed: show the REAL error on the sheet (not a hover-only
         icon) plus the way out — retry the failed action */
      (composeErr || (halvesErr && !(halves.top||halves.bottom))) && !composing && !halvesBusy && _sbEl("div",{className:"sb-sheet-err"},
        _sbEl(Icon.alert,{s:14}),
        _sbEl("span",{className:"sb-sheet-err-msg"}, (!(halves.top||halves.bottom) && halvesErr) || composeErr),
        _sbEl("div",{className:"sb-sheet-err-acts"},
          _sbEl("button",{className:"sb-sheet-err-btn primary",
            onClick:()=>{ if(halvesErr){ saveHalves(); } else { doCompose(); } }},
            "Try again")))),
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
        health.staleSrc+" stale source"),
      !health.unrendered && !health.staleSeed && !health.staleSrc && health.approved===health.total &&
        _sbEl("span",{className:"ssx-chain-chip ok"},"Sheet solid")),
    /* SCENE CANON — the master designs this scene locks to, as small thumbnails (click
       to enlarge). These are the scene-wide reference sheets, NOT a per-frame input
       list — each panel's actual render inputs are in its beat & shot brief below. */
    refImgs.length>0 && _sbEl("div",{className:"shot-refs sb-refs"},
      _sbEl("div",{className:"shot-refs-lab"}, _sbEl(Icon.layers,{s:12}),"Scene canon — the Character, Prop & Location designs this scene locks to (per-panel render inputs: see the beat & shot briefs)"),
      _sbEl("div",{className:"shot-refs-row"},
        refImgs.map((r,i)=> _sbEl("button",{key:"a"+i,className:"shot-ref-thumb "+r.kind,
          title:r.label+" — click to enlarge", onClick:()=>onView&&onView({ url:r.url, character:{ name:r.label } })},
          _sbEl("img",{src:r.url,alt:r.label,loading:"lazy"}))))),

    /* saved halves — the Stage's video-gen hand-off, managed in place: view, restore
       the previous saved version, or delete. Stale halves (cut from an older sheet
       version) say so and point at the ⋮ menu's re-save. */
    (halves.top||halves.bottom) && _sbEl("div",{className:"sb-halves"},
      _sbEl("button",{className:"sb-halves-head",onClick:()=>setHalvesOpen(o=>!o),
        "aria-expanded":halvesOpen?"true":"false",
        title: halvesOpen?"Hide the saved halves":"Show the saved halves"},
        _sbEl("span",{className:"sb-halves-chev"+(halvesOpen?" open":"")}, _sbEl(Icon.chevR,{s:12})),
        _sbEl(Icon.board,{s:12}),
        "Saved halves ("+["top","bottom"].filter(h=>halves[h]).length+") — the Stage's video-gen hand-off",
        !halvesCurrent && _sbEl("span",{className:"sb-halves-stale"},"· cut from an older sheet version — re-save from the ⋮ menu")),
      halvesOpen && _sbEl("div",{className:"sb-halves-row"},
        ["top","bottom"].map(h=> halves[h] && _sbEl("div",{key:h,className:"sb-half"},
          _sbEl("img",{src:halves[h].url,alt:h+" half",loading:"lazy",
            onClick:()=>onView({url:halves[h].url,character:{name:name+" — "+h+" half"}})}),
          _sbEl("div",{className:"sb-half-meta"},
            _sbEl("span",{className:"sb-half-tag"},h.toUpperCase()),
            _sbEl("button",{className:"sb-half-btn",onClick:()=>restoreHalf(h),
              title:"Restore this half's previous saved version — the sheet on display switches to the sheet version that half was cut from"},"Restore"),
            _sbEl("button",{className:"sb-half-btn danger",onClick:()=>deleteHalf(h),
              title:"Delete this saved half from the project — the sheet itself is untouched"},"Delete"))))),
      halvesOpen && halvesErr && _sbEl("div",{className:"sb-halves-err"}, _sbEl(Icon.alert,{s:12}), halvesErr)),

    // per-panel repair: pick the panel, describe the change
    panelEdit && gen.genUrl && _sbEl("div",{className:"sheet-edit-panel sb-panel-edit"},
      _sbEl("div",{className:"sb-panel-chips"},
        page.shots.map((sh,i)=> _sbEl("button",{key:sh.id,
          className:"sb-panel-chip"+(panelEdit.idx===i?" on":""),
          title:(typeof shotGrammarLabel==="function")?shotGrammarLabel(sh):"",
          onClick:()=>{ setPanelEdit(p=>({ ...p, idx:i })); setPanelErr(""); }},
          scene.no+"."+((page.start||0)+i+1),
          _sbEl("span",{className:"sb-panel-chip-sub"},(typeof shotSizeOf==="function")?shotSizeOf(sh.size).label:(sh.size||""))))),
      panelEdit.idx!=null && page.shots[panelEdit.idx] && page.shots[panelEdit.idx].locked &&
        _sbEl("div",{className:"sb-panel-note"},
          "This frame is APPROVED (it seeds later shots). Applying an edit changes its pixels, so it un-approves — use Approve frame as seed in the shot image's Options menu once you're happy."),
      panelEdit.idx!=null && _sbEl("input",{className:"sheet-edit-input",type:"text",autoFocus:true,
        placeholder:"Change panel "+scene.no+"."+((page.start||0)+panelEdit.idx+1)+" — edits that shot's frame, then recomposes…",
        value:panelEdit.text,onChange:e=>setPanelEdit(p=>({ ...p, text:e.target.value })),
        onKeyDown:e=>{ if(e.key==="Enter") applyPanelEdit(); if(e.key==="Escape") setPanelEdit(null); }}),
      panelErr && _sbEl("div",{className:"sb-panel-err"}, _sbEl(Icon.alert,{s:12}), panelErr),
      editRefChips("panel-edit-refs"),
      _sbEl("div",{className:"sheet-edit-acts"},
        _sbEl("button",{className:"sheet-edit-apply",disabled:panelEdit.idx==null||!panelEdit.text.trim()||panelBusy||composing,
          onClick:applyPanelEdit},
          _sbEl(Icon.wand,{s:12}), panelBusy?"Editing panel…":"Apply to panel"),
        _sbEl("button",{className:"sheet-edit-cancel",onClick:()=>setPanelEdit(null)},"Cancel"))),
    detailsOpen && ReactDOM.createPortal(_sbEl(window.SheetDetails,{ gen, name, noun:"sheet",extraMeta:sbHalfDateDetails(halves),
      onClose:()=>setDetailsOpen(false), onView:(url)=>onView({url,character:{name}}) }), document.body));
}

/* one scene PAGE = a storyboard SHEET: a header bar + the composed sheet image,
   plus a beat-briefs expander. */
function StoryboardPage({ project, scene, page, pageCount, ctx, beatsMap, onView, jumpToShot, onUpdateShot }){
  return _sbEl("div",{className:"sb-sheet","data-sbpage":page.id},
    _sbEl("div",{className:"sb-sheet-head"},
      _sbEl("span",{className:"sb-sheet-hi"}, _sbEl("b",null,"PROJECT: "), (project&&project.title)||"Untitled film"),
      _sbEl("span",{className:"sb-sheet-hi"}, _sbEl("b",null,"SCENE: "), String(scene.no).padStart(2,"0")),
      _sbEl("span",{className:"sb-sheet-hi"}, _sbEl("b",null,"TITLE: "), scene.title||"Untitled scene"),
      _sbEl("span",{className:"sb-sheet-hi page"}, _sbEl("b",null,"PAGE: "), (page.index+1)+" of "+pageCount)),
    _sbEl(StoryboardComposite,{ scene, page, ctx, beatsMap, onView, onUpdateShot }),

    // full per-panel detail — Shots tab fields + Writers' Room beat subtext + the final frame prompt
    _sbEl(CardFold,{label:"Beat & shot briefs",defaultOpen:false},
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
        const bm = sbBeatMeta(beatsMap, scene.id);
        const row = sbBeatRow(beatsMap, sh);
        const who = sbInFrame(sh, ctx);
        return _sbEl("div",{className:"sb-brief",key:sh.id},
          _sbEl("div",{className:"sb-brief-head"},
            _sbEl("span",{className:"sb-brief-no"}, scene.no+"."+((page.start||0)+i+1)),
            _sbEl("span",{className:"sb-brief-gram"}, (typeof shotGrammarLabel==="function")?shotGrammarLabel(sh):""),
            _sbEl("button",{className:"sb-brief-jump",onClick:()=>jumpToShot(sh),title:"Edit in Shots"},
              _sbEl(Icon.film,{s:10}),"Edit")),
          _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"In frame — "), who.length?who.join(", "):"—"),
          sh.action && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"Action — "), sh.action),
          sh.composition && _sbEl("div",{className:"sb-brief-line"},_sbEl("b",null,"Composition — "), sh.composition),
          sh.dialogue && _sbEl("div",{className:"sb-brief-line dlg"},_sbEl("b",null,"Dialogue — "), "“"+sh.dialogue+"”"),
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
                  return "Seed: "+(k>=0 ? ("Shot "+scene.no+"."+(k+1)) : "a removed shot")
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

function StoryboardView({ project, scenes, shots, characters, props, locations, beatsMap, setArtView, onUpdateShot, stale, onReviewLookbook }){
  const [view, setView]   = React.useState(null);   // lightbox {url, character}
  const [frames, setFrames] = React.useState({});    // sheetId -> url (for the progress count)
  const [jumpOpen, setJumpOpen] = React.useState(false);

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
      pages: sbPaginateBeats(shotsByScene[scene.id]||[]).map((pg,index)=>({
        id:"sbpage-"+scene.id+"-2x2-"+index, index, shots:pg.shots, start:pg.start, grid:"2x2" }))
    })), [ordered, shotsByScene]);
  const allSheetIds = React.useMemo(()=> pagesByScene.flatMap(g=>g.pages.map(p=>"sbsheet-"+p.id)), [pagesByScene]);

  // one scene at a time — ← / → pager instead of one long scroll
  const [pIdx, setPIdx] = useScenePager(pagesByScene.length);

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
    const onDone = (e)=>{ const d=e.detail||{}; if(d.id && d.url && d.id.indexOf("sbsheet-")===0) setFrames(f=>({ ...f, [d.id]: d.url })); };
    window.addEventListener("nb-gen-done", onDone);
    return ()=> window.removeEventListener("nb-gen-done", onDone);
  }, []);

  const readiness = sbStoryboardReadiness(pagesByScene, frames,
    (id)=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null);
  const totalSheets = readiness.total;
  const readySheets = readiness.complete + readiness.partial;

  // compose every sheet whose shots have frames — instant per sheet, no generation cost
  const [composingAll, setComposingAll] = React.useState(null);   // {i,total} | null
  const [composingScene, setComposingScene] = React.useState(null); // {id,i,total} | null
  const composeJobs = async (jobs, onProgress)=>{
    // structured outcome — a bulk run must never end silently on failures
    const out = { composed:0, skipped:0, failed:[], stale:false };
    for(let i=0;i<jobs.length;i++){
      if(onProgress) onProgress(i+1,jobs.length);
      const { scene, page } = jobs[i];
      let res = null;
      try{ res = await sbComposeSheet(scene, page, ctxFor(scene), beatsMap); }
      catch(e){ res = { status:"failed" }; }
      if(res.status==="stale"){ out.stale = true; break; }   // film switched: stop the whole batch quietly
      if(res.status==="composed") out.composed++;
      else if(res.status==="skipped") out.skipped++;
      else out.failed.push("Scene "+scene.no+" sheet "+(page.index+1));
    }
    return out;
  };
  const reportComposeRun = (out)=>{
    if(!out || out.stale || typeof window.appToast!=="function") return;
    if(out.failed.length){
      const names = out.failed.slice(0,3).join(", ") + (out.failed.length>3 ? " +"+(out.failed.length-3)+" more" : "");
      window.appToast("Composed "+out.composed+" sheet"+(out.composed===1?"":"s")+" — "+out.failed.length+" failed: "+names+". Open those scenes and Recompose to retry.","error");
    } else if(out.composed){
      window.appToast("Composed "+out.composed+" sheet"+(out.composed===1?"":"s")+(out.skipped?(" — "+out.skipped+" skipped (no generated frames yet)"):"")+".");
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
    try{ const c = JSON.parse(localStorage.getItem("turn_shots_collapsed")||"{}")||{}; c[sh.sceneId]=false;
      localStorage.setItem("turn_shots_collapsed", JSON.stringify(c)); }catch(e){}
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
      _sbEl(NbKeyBar,null), _sbEl(NbControls,null),
      _sbEl("div",{className:"art-intro"},
        _sbEl("div",{className:"art-intro-row"},
          _sbEl("div",{style:{flex:1}},
            // department-professional title, matching the other Art Room tabs
            _sbEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Storyboard Artist",
              _sbEl(window.InfoTip,{label:"About Storyboards",
                text:"Storyboards are the presentation layer of your shot chain: each scene's generated shot frames lay into printable 2×2 sheets — paginated on beat boundaries, with real CAMERA / MOTION / ACTION / PERFORMANCE annotations — and re-compose automatically whenever a frame re-renders."}))))),
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
    _sbEl(NbKeyBar,null), _sbEl(NbControls,null),
    stale && _sbEl("div",{className:"lb-stale-notice",role:"status"},
      _sbEl(Icon.alert,{s:14}),
      _sbEl("span",null,_sbEl("b",null,"Lookbook review needed")," — Composition or Atmosphere references changed. Existing boards remain untouched; review them against the new brief."),
      onReviewLookbook && _sbEl("button",{className:"lb-stale-btn ghost",onClick:onReviewLookbook,
        title:"Acknowledge that you reviewed the existing boards against the current Lookbook; this does not render or replace anything"},"Mark reviewed")),
    _sbEl("div",{className:"art-intro"},
      _sbEl("div",{className:"art-intro-row"},
        _sbEl("div",{style:{flex:1}},
          _sbEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"Storyboard Artist",
            _sbEl(window.InfoTip,{label:"About Storyboards",
              text:"Storyboards are the presentation layer of your shot chain: each scene's generated shot frames lay into printable 2×2 sheets — paginated on beat boundaries, with real CAMERA / MOTION / ACTION / PERFORMANCE annotations — and re-compose automatically whenever a frame re-renders in the Shots tab. Save top/bottom halves to hand panel rows to the Stage, repair a single panel (it edits that shot's frame), upload a board made elsewhere, or export the whole board as a print-ready PDF."})),
          _sbEl("div",{style:{fontFamily:"var(--f-mono)",fontSize:11,letterSpacing:".03em",color:"var(--txt-3)",marginTop:4}},
            readiness.complete+"/"+totalSheets+" complete"+
            (readiness.partial ? " · "+readiness.partial+"/"+totalSheets+" partial" : "")+
            (readiness.missing ? " · "+readiness.missing+"/"+totalSheets+" missing" : ""))),
        _sbEl("div",{className:"art-intro-actions"},
          _sbEl("button",{className:"art-draftall",disabled:!!composingAll||!!composingScene||!totalSheets,onClick:composeAll,
            title:"Lay every scene's generated shot frames into its sheets — instant and free; scenes with no frames yet are skipped"},
            _sbEl(Icon.board,{s:14}), composingAll?("Composing "+composingAll.i+"/"+composingAll.total+"…"):"Compose all from frames"),
          _sbEl("button",{className:"art-draftall ghost",disabled:!readySheets,
            onClick:()=> exportStoryboard(pagesByScene, frames, project),
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
      const beatCounts=[];
      sceneShots.forEach(sh=>{ const n=Number(sh.beatN)||0; let row=beatCounts.find(x=>x.n===n);
        if(!row){ row={n,count:0}; beatCounts.push(row); } row.count++; });
      const sceneBusy=composingScene&&composingScene.id===scene.id;
      return _sbEl("div",{className:"sb-scene",key:scene.id},
        _sbEl("div",{className:"shot-scene-card sb-scene-summary"},
          _sbEl("div",{className:"shot-scene-head merged"},
            _sbEl("button",{className:"scene-pager-arrow",disabled:pIdx<=0,
              onClick:()=>{setJumpOpen(false);setPIdx(i=>Math.max(0,i-1));},title:"Previous scene (←)","aria-label":"Previous scene"},
              _sbEl(Icon.chevL,{s:18})),
            _sbEl("div",{className:"shot-scene-meta"},
              _sbEl("span",{className:"scene-pager-no ssg-jump",role:"button",tabIndex:0,title:"Jump to a scene",
                onClick:()=>setJumpOpen(o=>!o)},
                "Scene "+(pIdx+1)+" of "+pagesByScene.length,_sbEl(Icon.chevD,{s:10}),
                jumpOpen&&_sbEl("div",{className:"scene-pager-menu",onClick:e=>e.stopPropagation()},
                  pagesByScene.map((sx,i)=>_sbEl("button",{key:sx.scene.id||i,className:"scene-pager-menu-item"+(i===pIdx?" on":""),
                    onClick:()=>{setPIdx(i);setJumpOpen(false);}},
                    _sbEl("span",{className:"scene-pager-menu-no"},String(sx.scene.no||(i+1)).padStart(2,"0")),
                    _sbEl("span",{className:"scene-pager-menu-t"},sx.scene.title||"Untitled scene"),
                    i===pIdx&&_sbEl(Icon.check,{s:14}))))),
              _sbEl("div",{className:"shot-scene-title"},scene.title||"Untitled scene"),
              _sbEl("div",{className:"shot-scene-style-row"},
                _sbEl(StoryboardSceneStyleChip,{project,sceneId:scene.id})),
              _sbEl("div",{className:"shot-scene-sub"},
                (ln?("Location: "+ln+"   ·   "):"")+sceneShots.length+" shot"+(sceneShots.length!==1?"s":"")+"   ·   "+pages.length+" sheet"+(pages.length!==1?"s":"")),
              beatCounts.length>1&&_sbEl("div",{className:"ssx-beat-strip",title:"Shots per beat — storyboard coverage distribution"},
                beatCounts.map(b=>_sbEl("span",{key:"sb"+b.n,className:"ssx-beat-seg",style:{flexGrow:Math.max(1,b.count)},
                  title:"Beat "+b.n+" — "+b.count+" shot"+(b.count!==1?"s":"")},b.count)))),
            _sbEl("div",{className:"shot-scene-acts"},
              _sbEl("button",{className:"char-draft-btn primary",disabled:!!composingAll||!!composingScene,
                onClick:()=>composeOneScene(scene,pages),
                title:"Lay this scene's current shot frames into its storyboard sheets — instant and free"},
                _sbEl(Icon.board,{s:12}),sceneBusy?("Composing "+composingScene.i+"/"+composingScene.total+"…"):("Compose Scene "+String(scene.no).padStart(2,"0")+" from frames")),
              _sbEl("button",{className:"char-draft-btn ghost",onClick:()=>setArtView&&setArtView("shots"),
                title:"Open this scene's source frames and shot design in the Shots tab"},
                _sbEl(Icon.film,{s:12}),"Edit shots")),
            _sbEl("button",{className:"scene-pager-arrow",disabled:pIdx>=pagesByScene.length-1,
              onClick:()=>{setJumpOpen(false);setPIdx(i=>Math.min(pagesByScene.length-1,i+1));},title:"Next scene (→)","aria-label":"Next scene"},
              _sbEl(Icon.chevR,{s:18}))),
          _sbEl("div",{className:"shot-scene-ctx"},
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
          onView:setView,jumpToShot,onUpdateShot})));
    }));
}
window.StoryboardView = StoryboardView;

/* ---- split a sheet into TOP / BOTTOM halves and SAVE BOTH to the project's image
   store (Supabase in cloud mode, local otherwise) — no file downloads to manage.
   Each half becomes its own asset, `<sheetId>:half-top` / `<sheetId>:half-bottom`,
   ready for the Stage's video generation (frame-conditioning, e.g. Seedance). On a
   2×2 sheet each half is one panel ROW — two frames side by side. The image is
   inlined first (sbToDataUrl) so cropping a cloud sheet's signed URL doesn't taint
   the canvas. Re-saving after a sheet recomposes overwrites the halves (the previous
   pair stays in each asset's version history). */
async function sbSaveHalves(url, sid, page, sourceVersion){
  const data = await sbToDataUrl(url);
  const img = new Image();
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=data; });
  const mid = Math.floor(img.height/2);
  for(const [half, sy, sh] of [["top",0,mid],["bottom",mid,img.height-mid]]){
    const c = document.createElement("canvas"); c.width=img.width; c.height=sh;
    c.getContext("2d").drawImage(img, 0,sy,img.width,sh, 0,0,img.width,sh);
    const now = new Date();
    // sourceVersion = the sheet version these halves were cut from — the duplicate guard:
    // while it matches the sheet's current version, re-saving is blocked as a no-op
    const meta = { kind:"sheet-half", half, source:sid, sourceVersion:String(sourceVersion||""),
      shotIds: sbHalfShotIds(((page&&page.shots)||[]).map(x=>x.id), half),
      grid:(page&&page.grid)||"", model:"Cropped from the storyboard sheet",
      date:now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
      time:now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}), iso:now.toISOString() };
    if(typeof nbCommit!=="function") throw new Error("the image store isn't available");
    const r = await nbCommit(sid+":half-"+half, c.toDataURL("image/png"), meta, []);
    if(!r || r.tier==="error") throw new Error("the "+half+" half didn't save");
  }
}

/* ---- export: printable storyboard SHEETS (header + the composed sheet image), Save as PDF ----
   DURABLE: every sheet image is inlined as a data URL before the document is written —
   cloud sheets are served on SIGNED URLs that expire within the hour, so an export that
   merely links them goes blank as soon as it's saved or printed later. The sheet cell
   honors the project's format aspect (a vertical board prints vertical). */
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
async function sbBoardHealth(pagesByScene){
  const drafts = ((window.turnContinuity||{}).drafts)||{};
  const perSheet = {}; const tot = { unrendered:0, unapproved:0, staleSeed:0, staleSrc:0 };
  for(const g of pagesByScene){
    const chain = g.pages.flatMap(p=>p.shots||[]);   // the scene's full running order
    for(const page of g.pages){
      const w = { unrendered:0, unapproved:0, staleSeed:0, staleSrc:0 };
      for(const sh of (page.shots||[])){
        let u = (typeof nbGetImage==="function") ? nbGetImage(sh.id) : "";
        if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(sh.id); }catch(e){} }
        if(!u){ w.unrendered++; continue; }
        if(!sh.locked) w.unapproved++;
        const m = (typeof nbGetMeta==="function") ? nbGetMeta(sh.id) : null;
        const st = (typeof shotAssetProvenanceStatus==="function") ? shotAssetProvenanceStatus(sh, drafts[sh.sceneId], m) : "unverified";
        const ov = (typeof shotSourceOverrideCurrent==="function") && shotSourceOverrideCurrent(sh, drafts[sh.sceneId]);
        if(st==="stale" && !ov) w.staleSrc++;
        if(typeof shotChainStatus==="function" && shotChainStatus(sh, chain, (x)=> (typeof nbGetMeta==="function") ? nbGetMeta(x) : null)==="stale") w.staleSeed++;
      }
      perSheet["sbsheet-"+page.id] = w;
      tot.unrendered+=w.unrendered; tot.unapproved+=w.unapproved; tot.staleSeed+=w.staleSeed; tot.staleSrc+=w.staleSrc;
    }
  }
  return { perSheet, tot };
}
const sbWarnParts = (w)=> !w ? [] : [
  w.unapproved ? (w.unapproved+" not approved") : "",
  w.unrendered ? (w.unrendered+" unrendered") : "",
  w.staleSeed ? (w.staleSeed+" frame"+(w.staleSeed===1?" needs":"s need")+" continuity refresh") : "",
  w.staleSrc ? (w.staleSrc+" stale source") : "",
].filter(Boolean);
async function exportStoryboard(pagesByScene, frames, project){
  const esc = (s)=> String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const title = (project && project.title) || "Storyboard";
  const _ar = String((typeof aspectFor==="function") ? aspectFor(project) : "16:9").replace(":", " / ");
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
        fileName:(title||"storyboard").replace(/[^\w\-]+/g,"_").toUpperCase()+"_STORYBOARD.html", html:placeholder,
        hint:"Sheet images are inlined as data URLs — the saved file stays viewable after image links expire." })
    : null;
  // fallback tab (overlay unavailable) — open NOW, inside the click
  const w = prev ? null : window.open("", "_blank");
  if(w){ w.document.open(); w.document.write(placeholder); w.document.close(); }
  // TRUTHFUL EXPORT: a printable board must not present unverified work as final.
  // Check every panel first; if anything is off, the director exports EXPLICITLY
  // with warnings (and the affected sheets are marked in the document itself).
  let health = null;
  try{ health = await sbBoardHealth(pagesByScene); }catch(e){}
  const readiness = sbStoryboardReadiness(pagesByScene, frames,
    (id)=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null);
  const _totParts = health ? sbWarnParts(health.tot) : [];
  if((readiness.partial || readiness.missing || _totParts.length) && typeof window.appConfirm==="function"){
    const sheetState = [
      readiness.partial ? readiness.partial+"/"+readiness.total+" partial sheets" : "",
      readiness.missing ? readiness.missing+"/"+readiness.total+" missing sheets" : "",
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
  for(const g of pagesByScene){ for(const page of g.pages){
    const k = "sbsheet-"+page.id;
    if(frames[k]) inline[k] = await sbToDataUrl(frames[k]);
  } }
  let body = "";
  pagesByScene.forEach(({scene,pages})=>{
    pages.forEach((page)=>{
      const url = inline["sbsheet-"+page.id];
      const img = url ? '<img src="'+esc(url)+'">' : '<div class="ph"></div>';
      const wp = health ? sbWarnParts(health.perSheet["sbsheet-"+page.id]) : [];
      body += '<section class="sheet"><div class="sheet-h">'
        + '<span><b>PROJECT:</b> '+esc(title)+'</span>'
        + '<span><b>SCENE:</b> '+esc(String(scene.no).padStart(2,"0"))+'</span>'
        + '<span><b>TITLE:</b> '+esc(scene.title||"")+'</span>'
        + '<span><b>PAGE:</b> '+(page.index+1)+' of '+pages.length+'</span>'
        + (wp.length ? '<span class="warn">&#9888; '+esc(wp.join(" · "))+'</span>' : '')
        + '</div><div class="sheet-img">'+img+'</div></section>';
    });
  });
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+' — Storyboard</title>'
    + '<style>'
    + 'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#000;color:#eee;margin:24px;}'
    + '.sheet{break-inside:avoid;margin:0 0 32px;}'
    + '.sheet-h{display:flex;gap:26px;flex-wrap:wrap;font-size:12px;letter-spacing:.04em;border-bottom:1px solid #444;padding-bottom:8px;margin-bottom:14px;}'
    + '.sheet-h b{color:#999;font-weight:600;}'
    + '.sheet-h .warn{color:#d86b61;font-weight:600;}'
    + '.sheet-img{aspect-ratio:'+_ar+';background:#111;border:1px solid #333;border-radius:6px;overflow:hidden;}'
    + '.sheet-img img{width:100%;height:100%;object-fit:contain;display:block;background:#000;}'
    + '.sheet-img .ph{width:100%;height:100%;background:repeating-linear-gradient(135deg,#111,#111 6px,#181818 6px,#181818 12px);}'
    + '@media print{body{margin:10mm;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}'
    + '</style></head><body>'
    + (body||'<p>No sheets composed yet.</p>')
    + '</body></html>';
  if(prev){ prev.setHtml(html); return; }
  if(w){ w.document.open();
    w.document.write(html.replace('</body>','<script>setTimeout(function(){try{window.print();}catch(e){}},450);<\/script></body>'));
    w.document.close(); }
}
window.exportStoryboard = exportStoryboard;

/* breakdown.jsx — the Art Room's BREAKDOWN tab (the First AD's stripboard) and the
   ART DEPARTMENT BIBLE export. Owner-approved 2026-09-26 (Art Room part 3).

   The stripboard reads what the other tabs made; it never generates or spends. One strip
   per scene in story order, coloured the way crews colour a stripboard (white INT day,
   yellow EXT day, blue INT night, green EXT night, pink dawn/dusk). Each strip lists who
   is in the scene (in the look they wear there), its location, wardrobe and props, its shots, and
   what is still missing before it can be shot. Readiness follows the SAME rules as the
   Run pre-production preview (CoordConfirm): a cast sheet (or the appearance variant the
   scene calls for), a location plate, a sheet for every prop that needs its own image
   (worn items, and objects not set to Text only), and a rendered frame for every shot. */

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
function breakdownRows({ scenes, characters, props, locations, shots, drafts, img, tierOf }){
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
      return { id:p.id, name:p.name||"Prop", kind:p.kind||"carried", owner:p.ownerName||"", needs, ready:!needs || img(p.id) };
    });
    // worn items are WARDROBE (part of the cast's look), listed apart from the props
    const wardrobe = mapped.filter(p=> p.kind==="worn");
    const sceneProps = mapped.filter(p=> p.kind!=="worn");
    const rendered = sceneShots.filter(s=> img(s.id)).length;
    const approved = sceneShots.filter(s=> s.approved || s.locked).length;
    const missing = [];
    cast.filter(c=>!c.ready).forEach(c=> missing.push({ tab:"characters", text: c.state ? (c.name+" · "+c.state+" variant") : (c.name+"'s sheet") }));
    if(!location) missing.push({ tab:"locations", text:"a location card" });
    else if(!location.ready) missing.push({ tab:"locations", text:location.name+" plate" });
    wardrobe.concat(sceneProps).filter(p=>!p.ready).forEach(p=> missing.push({ tab:"props", text:p.name+" sheet" }));
    if(!sceneShots.length) missing.push({ tab:"shots", text:"shots" });
    else if(rendered<sceneShots.length){ const n=sceneShots.length-rendered; missing.push({ tab:"shots", text:n+" frame"+(n===1?"":"s") }); }
    return { scene, slug:{ ...slug, todKind }, cast, location, wardrobe, props:sceneProps,
      shots:{ total:sceneShots.length, rendered, approved }, missing, ready:!missing.length };
  });
}

/* film-wide totals — each missing asset counts ONCE however many scenes need it */
function breakdownSummary(rows){
  const castSheets = new Set(), plates = new Set(), propSheets = new Set();
  let frames = 0, noShots = 0, noLoc = 0;
  (rows||[]).forEach(r=>{
    r.cast.forEach(c=>{ if(!c.ready) castSheets.add(c.sheetId); });
    if(!r.location) noLoc++; else if(!r.location.ready) plates.add(r.location.id);
    r.wardrobe.concat(r.props).forEach(p=>{ if(!p.ready) propSheets.add(p.id); });
    if(!r.shots.total) noShots++; else frames += r.shots.total - r.shots.rendered;
  });
  return { total:(rows||[]).length, ready:(rows||[]).filter(r=>r.ready).length,
    castSheets:castSheets.size, plates:plates.size, propSheets:propSheets.size, frames, noShots, noLoc };
}

const BD_STRIP_LABEL = { "int-day":"INT · Day", "ext-day":"EXT · Day", "int-night":"INT · Night", "ext-night":"EXT · Night", "dusk":"Dawn / Dusk" };
/* the strip colour: dawn/dusk wins; INT/EXT counts as EXT (it is shot as an exterior) */
function bdStripKind(slug){
  if(!slug || !slug.todKind) return "";
  if(slug.todKind==="dusk") return "dusk";
  const ext = slug.ie==="EXT" || slug.ie==="INT/EXT";
  return (ext?"ext-":"int-")+slug.todKind;
}

function bdSummaryLine(sum){
  const todo = [];
  if(sum.castSheets) todo.push(sum.castSheets+" cast sheet"+(sum.castSheets===1?"":"s"));
  if(sum.plates) todo.push(sum.plates+" plate"+(sum.plates===1?"":"s"));
  if(sum.propSheets) todo.push(sum.propSheets+" prop sheet"+(sum.propSheets===1?"":"s"));
  if(sum.frames) todo.push(sum.frames+" frame"+(sum.frames===1?"":"s"));
  if(sum.noShots) todo.push(sum.noShots+" scene"+(sum.noShots===1?"":"s")+" without shots");
  if(sum.noLoc) todo.push(sum.noLoc+" without a location card");
  return sum.ready+" of "+sum.total+" scene"+(sum.total===1?"":"s")+" ready to shoot"+(todo.length ? " · to go: "+todo.join(", ") : "");
}

function BreakdownView({ project, scenes, characters, props, locations, shots, drafts, setArtView }){
  const [tick, setTick] = React.useState(0);
  const [filter, setFilter] = React.useState("all");   // all | todo | ready
  const [found, setFound] = React.useState(()=>new Set());   // ids found in local storage after mount
  // until the image cache is warm every sheet would read as missing — say "checking" instead
  const [checking, setChecking] = React.useState(true);
  const cloud = typeof window.nbBackend==="function" && window.nbBackend()==="cloud";
  React.useEffect(()=>{
    const bump = ()=> setTick(t=>t+1);
    window.addEventListener("nb-prefetched", bump); window.addEventListener("nb-gen-done", bump);
    return ()=>{ window.removeEventListener("nb-prefetched", bump); window.removeEventListener("nb-gen-done", bump); };
  },[]);
  const img = (id)=> found.has(id) || ((typeof nbGetImage==="function") ? !!nbGetImage(id) : false);
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts||{}).tier : "own"; }catch(e){ return "own"; } };
  const rows = React.useMemo(()=> breakdownRows({ scenes, characters, props, locations, shots, drafts, img, tierOf }),
    [scenes, characters, props, locations, shots, drafts, tick, found]);
  const sum = breakdownSummary(rows);
  // a cloud film: ONE batched prefetch (shared with the Art Room's own) warms every asset url
  React.useEffect(()=>{
    if(!cloud) return;
    let alive = true;
    Promise.resolve(typeof nbPrefetchAll==="function" ? nbPrefetchAll() : null).catch(()=>{})
      .then(()=>{ if(alive){ setChecking(false); setTick(t=>t+1); } });
    return ()=>{ alive=false; };
  },[project && project.id]);
  // a film stored on this device keeps large sheets in IndexedDB (async): look up what the
  // synchronous cache didn't have, once per id, so a finished sheet never reads as missing
  React.useEffect(()=>{
    if(cloud) return;
    if(typeof nbLoadImage!=="function"){ setChecking(false); return; }
    let alive = true;
    const want = new Set();
    rows.forEach(r=>{ r.cast.forEach(c=>{ if(!c.ready) want.add(c.sheetId); });
      if(r.location && !r.location.ready) want.add(r.location.id);
      r.props.forEach(p=>{ if(!p.ready) want.add(p.id); });
      (shots||[]).forEach(s=>{ if(s && s.sceneId===r.scene.id && !img(s.id)) want.add(s.id); }); });
    const ids = [...want].filter(id=> !found.has(id));
    if(!ids.length){ setChecking(false); return; }
    (async ()=>{
      const hit = [];
      for(const id of ids){ try{ if(await nbLoadImage(id)) hit.push(id); }catch(e){} if(!alive) return; }
      if(!alive) return;
      if(hit.length) setFound(f=>{ const n=new Set(f); hit.forEach(x=>n.add(x)); return n; });
      setChecking(false);
    })();
    return ()=>{ alive=false; };
  },[rows.length, (shots||[]).length, tick]);
  // the ⋮ menu's "Export stripboard" while this tab is open
  React.useEffect(()=>{ window.turnExportBreakdown = ()=> exportStripboard(rows, project);
    return ()=>{ if(window.turnExportBreakdown) delete window.turnExportBreakdown; }; });

  const go = (tab)=>{ if(tab && setArtView) setArtView(tab); };
  const shown = rows.filter(r=> filter==="all" || (filter==="ready" ? r.ready : !r.ready));
  const header = _bdEl("div",{className:"art-intro"},
    _bdEl("div",{className:"art-intro-row"},
      _bdEl("div",null,
        _bdEl("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},"First Assistant Director",
          window.InfoTip && _bdEl(window.InfoTip,{label:"About the Breakdown",
            text:"The Breakdown is your stripboard: one strip per scene, in story order, coloured the way film crews colour them — white for INT day, yellow for EXT day, blue for INT night, green for EXT night, pink for dawn and dusk. Each strip lists who is in the scene (in the look they wear there), its location, the props it needs and its shots, and says what is still missing before the scene can be shot: a cast sheet or appearance variant, a location plate, a prop sheet, or shot frames. Click a missing item to open its tab. Nothing here generates or spends credits. Export the stripboard, or the whole art department bible, from the ⋮ menu."})),
        _bdEl("div",{className:"bd-sum"}, !rows.length ? "No scenes yet" : checking ? "Checking which sheets and frames exist\u2026" : bdSummaryLine(sum))),
      rows.length>0 && !checking && _bdEl("div",{className:"art-intro-actions"},
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
      _bdEl("div",{className:"bd-none",role:"status"}, _bdEl("span",{className:"ai-typing"},_bdEl("i",null),_bdEl("i",null),_bdEl("i",null))));
  }
  return _bdEl("div",{className:"art-scroll"}, header,
    _bdEl("div",{className:"bd-legend","aria-label":"Strip colours"},
      Object.keys(BD_STRIP_LABEL).map(k=> _bdEl("span",{key:k,className:"bd-legend-i"}, _bdEl("span",{className:"bd-sw bd-k-"+k}), BD_STRIP_LABEL[k]))),
    _bdEl("div",{className:"bd-board"},
      shown.length ? shown.map(r=> _bdEl(BreakdownStrip,{key:r.scene.id, row:r, go}))
        : _bdEl("div",{className:"bd-none"}, filter==="ready" ? "No scene is ready to shoot yet." : "Every scene is ready to shoot.")));
}
window.BreakdownView = BreakdownView;

const BD_PROPS_SHOWN = 6;
function BreakdownStrip({ row, go }){
  const { scene, slug, cast, location, wardrobe, props, shots, missing, ready } = row;
  const [allProps, setAllProps] = React.useState(false);
  const [allWorn, setAllWorn] = React.useState(false);
  const kind = bdStripKind(slug);
  const dot = (ok)=> _bdEl("span",{className:"bd-dot"+(ok?" ok":""),"aria-hidden":"true"});
  const chip = (key, label, ok, tab, title)=> _bdEl("button",{key, type:"button", className:"bd-chip"+(ok?" ok":""), onClick:()=>go(tab), title}, dot(ok), _bdEl("span",{className:"bd-chip-t"},label));
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
              c.ready, "characters", c.ready ? (c.state ? c.name+"'s "+c.state+" variant is ready" : c.name+"'s sheet is ready")
                : (c.state ? c.name+" needs the "+c.state+" variant" : c.name+" needs a character sheet")))
            : _bdEl("span",{className:"bd-empty"},"No one named in this scene"))),
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Location"),
          _bdEl("div",{className:"bd-chips"}, location ? chip("loc", location.name, location.ready, "locations", location.ready ? "The plate is ready" : "Needs its location plate")
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>go("locations"),title:"No location card resolves to this scene — check its slugline"}, dot(false), "No location card"))),
        wardrobe.length>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Wardrobe"),
          _bdEl("div",{className:"bd-chips"}, wornShown.map(p=> chip(p.id, p.name, p.ready, "props",
              p.name+(p.owner ? " \u2014 worn by "+p.owner : "")+" \u00b7 "+(p.ready ? "sheet ready" : "needs its sheet"))),
            more(wardrobe, allWorn, setAllWorn))),
        props.length>0 && _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Props"),
          _bdEl("div",{className:"bd-chips"}, propsShown.map(p=> p.needs
            ? chip(p.id, p.name, p.ready, "props", p.name+" \u2014 "+(p.ready ? "sheet ready" : "needs its prop sheet")+(p.owner ? " · "+p.kind+" by "+p.owner : ""))
            : _bdEl("button",{key:p.id,type:"button",className:"bd-chip text",onClick:()=>go("props"),title:p.name+" \u2014 text only: shots describe it from its specification"},
                _bdEl("span",{className:"bd-chip-t"},p.name), _bdEl("span",{className:"bd-chip-sub"}," · text"))),
            more(props, allProps, setAllProps))),
        _bdEl("div",{className:"bd-row"}, _bdEl("span",{className:"bd-row-lab"},"Shots"),
          _bdEl("div",{className:"bd-chips"}, shots.total
            ? _bdEl("button",{type:"button",className:"bd-chip"+(shots.rendered===shots.total?" ok":""),onClick:()=>go("shots"),title:"Open the Shots tab"},
                dot(shots.rendered===shots.total), shots.total+" shot"+(shots.total===1?"":"s")+" · "+shots.rendered+" rendered"+(shots.approved?" · "+shots.approved+" approved":""))
            : _bdEl("button",{type:"button",className:"bd-chip",onClick:()=>go("shots"),title:"Design this scene's coverage in the Shots tab"}, dot(false), "No shots yet"))))),
    _bdEl("div",{className:"bd-strip-status"+(ready?" ok":"")},
      ready ? _bdEl(React.Fragment,null, _bdEl(Icon.check,{s:14}), "Ready")
        : _bdEl(React.Fragment,null, _bdEl("span",{className:"bd-need-n"}, missing.length), _bdEl("span",null,"to go"),
            _bdEl("div",{className:"bd-need-list"}, missing.slice(0,4).map((m,i)=> _bdEl("button",{key:i,type:"button",className:"bd-need",title:m.text,onClick:()=>go(m.tab)}, m.text)),
              missing.length>4 && _bdEl("span",{className:"bd-need more"},"+"+(missing.length-4)+" more")))));
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
    const cast = r.cast.map(c=> _bdEsc(c.name)+(c.state?' <i>('+_bdEsc(c.state)+')</i>':"")+(c.ready?"":" ○")).join(", ");
    const props = r.props.map(p=> _bdEsc(p.name)+(p.needs&&!p.ready?" ○":"")).join(", ");
    const worn = r.wardrobe.map(p=> _bdEsc(p.name)+(p.owner?' <i>('+_bdEsc(p.owner)+')</i>':"")+(!p.ready?" ○":"")).join(", ");
    return '<tr class="k-'+(k||"none")+'">'
      +'<td class="no">'+_bdEsc(String(r.scene.no!=null?r.scene.no:"").padStart(2,"0"))+'</td>'
      +'<td>'+_bdEsc(r.slug.ie||"")+'</td>'
      +'<td><b>'+_bdEsc(r.slug.place||(r.location&&r.location.name)||"")+'</b><div class="t">'+_bdEsc(r.scene.title||"")+'</div></td>'
      +'<td>'+_bdEsc(r.slug.tod||"")+'</td>'
      +'<td>'+cast+'</td>'
      +'<td class="w">'+worn+'</td>'
      +'<td>'+props+'</td>'
      +'<td class="num">'+(r.shots.total ? r.shots.rendered+'/'+r.shots.total : "—")+'</td>'
      +'<td>'+(r.ready ? '<b class="ok">Ready</b>' : _bdEsc(r.missing.map(m=>m.text).join(", ")))+'</td></tr>';
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
    +'<div class="sub">'+(_bdFormatLabel(project)?_bdEsc(_bdFormatLabel(project))+' &middot; ':'')+_bdEsc(bdSummaryLine(sum))+' &middot; Made with Kinolot</div>'
    +'<div class="legend"><span class="k-int-day">INT day</span><span class="k-ext-day">EXT day</span><span class="k-int-night">INT night</span><span class="k-ext-night">EXT night</span><span class="k-dusk">Dawn / dusk</span> &nbsp;○ = not made yet</div>'
    +'<table><thead><tr><th>Sc</th><th>I/E</th><th>Set · scene</th><th>Time</th><th>Cast</th><th>Wardrobe</th><th>Props</th><th>Frames</th><th>Status</th></tr></thead><tbody>'+body+'</tbody></table>'
    +'</body></html>';
  _bdPreview("Stripboard preview", title, _bdFileBase(project)+"_STRIPBOARD.html", html,
    "Review the strips, then print / save as PDF — or download the HTML.");
}
window.exportStripboard = exportStripboard;

/* ART DEPARTMENT BIBLE — the cast, props and locations as one printable document: every
   written spec field, the scenes each appears in, and the current sheet image where one
   exists. Reads the cards as they are; generates nothing. */
function exportArtBible({ project, characters, props, locations, scenes, drafts, shots }){
  const title = (project && project.title) || "Art department bible";
  const ordered = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  const imgUrl = (id)=>{ try{ return (typeof nbGetImage==="function" && nbGetImage(id)) || ""; }catch(e){ return ""; } };
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
      return '<li><b>'+_bdEsc(st.label||"State")+'</b>'+(st.change?' — '+_bdEsc(st.change):"")+(at?' <span class="m">(from Sc '+_bdEsc(at.no)+')</span>':"")+'</li>'; }).join("");
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
      +field("Permanent dressing", l.permanentDressing)+field("Topology", l.topology)+field("Continuity anchors", l.continuityAnchors)
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
    "Sheet images link to your stored sheets and those links can expire — save as PDF to keep them.");
}
window.exportArtBible = exportArtBible;
window.breakdownRows = breakdownRows;
window.breakdownSummary = breakdownSummary;
window.bdSlug = bdSlug;

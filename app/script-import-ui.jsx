/* script-import-ui.jsx — the IMPORT A SCREENPLAY window (owner 2026-10-18, docs/Script Import Plan.md, phase 1).
   Two steps, both free and in the browser: (1) the source — drop or choose a file, or paste the text; (2) the
   preview — what was found (scenes, pages, speaking characters), the title and author, a suggested format and
   the structure to read it with, the characters (rename, merge duplicates), the scenes (merge with the next,
   split at a line), warnings in plain words, and the rights confirmation. "Import script" hands the film to the
   app (onImport), which creates it the way New Story does. The read — scene cards, beats and the cast from the
   script — is phase 2. Window family classes (ns-*) as New Story. */
function ScriptImportWindow({ onClose, onImport, onUseAsIdea, initialFile=null, busy=false, existing=null, onApplyDraft, beforeScanRead, shows=[], onImportSeries }){
  // A NEW DRAFT (phase 4): with an existing film, step 2 shows what changed scene by scene instead of a fresh preview
  const draftMode = !!(existing && Array.isArray(existing.scenes) && existing.scenes.length && typeof onApplyDraft==="function");
  const h = React.createElement;
  const SI = window.ScriptImport;
  const [stage, setStage] = React.useState("source");   // "source" | "preview"
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parsed, setParsed] = React.useState(null);
  const [err, setErr] = React.useState("");
  const [reading, setReading] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [format, setFormat] = React.useState("");
  const [framework, setFramework] = React.useState("");
  const [rights, setRights] = React.useState(false);
  const [splitOpen, setSplitOpen] = React.useState(-1);
  const [proseOk, setProseOk] = React.useState(false);   // "Import it as it is" chosen for a prose text
  const [removeMissing, setRemoveMissing] = React.useState(false);
  // A SCANNED PDF (phase 5): its pages are pictures — read them with the vision model, page by page, priced first
  const [scan, setScan] = React.useState(null);   // { file, pages, texts:[], reading, stopping, fileName }
  const scanStop = React.useRef(false);
  // INTO A SHOW (phase 6): one script as an episode, or several episode files at once
  const seriesOn = !draftMode && typeof onImportSeries==="function";
  const [episodes, setEpisodes] = React.useState(null);   // several parsed episode scripts, in order
  const [dest, setDest] = React.useState("film");          // "film" | "show"
  const [showPick, setShowPick] = React.useState("new");   // "new" | an owned Show's id
  const [showTitle, setShowTitle] = React.useState("");
  const showName = (t)=> String(t||"").replace(/\s+\u2014\s+Show$/i,"").trim();
  const pickShowFor = (series)=>{ const k = String(series||"").trim().toLowerCase();
    const hit = k && (shows||[]).find(x=>showName(x.title).toLowerCase()===k); return hit ? hit.id : "new"; };
  React.useEffect(()=>()=>{ scanStop.current = true; },[]);   // closing the window stops a scan read after its page
  const fileRef = React.useRef(null);

  React.useEffect(()=>{ const k=(e)=>{ if(e.key==="Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return ()=>window.removeEventListener("keydown", k); },[busy]);

  const took = (r)=>{
    setParsed(r); setErr("");
    setTitle(r.title || (r.fileName ? r.fileName.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ") : ""));
    setAuthor(r.author || "");
    const st = SI.stats(r);
    setFormat(SI.suggestFormat(st).id);
    setFramework((typeof frameworkChoices==="function" && frameworkChoices()[0] && frameworkChoices()[0].id) || "threeact");
    // an episode of a series? (phase 6) — offered, never assumed
    const ep = SI.episodeInfo ? SI.episodeInfo(r, r.fileName) : { likely:false };
    setDest(seriesOn && ep.likely ? "show" : "film");
    setShowTitle(ep.series || r.title || "");
    setShowPick(pickShowFor(ep.series));
    setStage("preview");
  };
  // several files at once: every one read, then one window for the episodes (phase 6)
  const readMany = async (files)=>{
    if(reading) return;
    setReading(true); setErr("");
    try{
      const out = [];
      for(const f of files){
        const r = await SI.parseFile(f);
        if(r && r.scanned) throw new Error("\u201c"+f.name+"\u201d is a scanned PDF \u2014 import it on its own (its pages are read with the vision model, priced first), then the others.");
        if(!r.scenes || !r.scenes.length) throw new Error("No scenes were found in \u201c"+f.name+"\u201d \u2014 check that file, or leave it out.");
        out.push(r);
      }
      const list = SI.orderEpisodes ? SI.orderEpisodes(out) : out;
      const ep0 = SI.episodeInfo ? SI.episodeInfo(list[0], list[0].fileName) : {};
      const series = ep0.series || "";
      setEpisodes(list); setAuthor(list[0].author || "");
      setShowTitle(series || list[0].title || ""); setShowPick(pickShowFor(series));
      setFramework((typeof frameworkChoices==="function" && frameworkChoices()[0] && frameworkChoices()[0].id) || "threeact");
      setStage("series");
    }catch(e){ setErr(String((e && e.message) || e || "Those files couldn\u2019t be read.")); }
    finally{ setReading(false); }
  };
  const readFiles = (list)=>{ const files = Array.from(list||[]).filter(Boolean);
    if(!files.length) return; if(files.length>1 && seriesOn) readMany(files); else readFile(files[0]); };
  const readFile = async (file)=>{
    if(!file || reading) return;
    setReading(true); setErr("");
    try{
      const r = await SI.parseFile(file);
      if(r && r.scanned){ setScan({ file, pages:r.pageCount||0, texts:[], reading:false, fileName:file.name||"" }); setStage("scan"); return; }
      took(r);
    }
    catch(e){ setErr(String((e && e.message) || e || "That file couldn’t be read.")); }
    finally{ setReading(false); }
  };
  // a file dropped on the page arrives already chosen (phase 3)
  React.useEffect(()=>{ if(initialFile) (Array.isArray(initialFile) ? readFiles(initialFile) : readFile(initialFile)); },[initialFile]);
  const readPaste = ()=>{
    if(!pasteText.trim()){ setErr("Paste the script's text first."); return; }
    try{ took(SI.parseText(pasteText)); }catch(e){ setErr(String((e && e.message) || e)); }
  };

  const head = h("div",{className:"ns-head"},
    h("div",{className:"ns-head-t"},
      h("span",{className:"ns-orb"}),
      h("div",null,
        h("div",{className:"ns-title"}, draftMode ? "Import a new draft" : "Import your script"),
        h("div",{className:"ns-sub"}, stage==="scan" ? "Step 1 of 2 \u00b7 a scanned PDF \u2014 reading its pages is charged as writing" : stage==="source"
          ? (draftMode ? "Step 1 of 2 \u00b7 the revised screenplay for \u201c"+(existing.title||"this film")+"\u201d" : "Step 1 of 2 \u00b7 your screenplay, word for word")
          : (draftMode ? "Step 2 of 2 \u00b7 what changed \u2014 nothing is charged yet" : "Step 2 of 2 \u00b7 check what we found \u2014 nothing is charged")))),
    h("button",{className:"ag-x",onClick:()=>{ if(!busy) onClose(); },title:"Close","aria-label":"Close"},Icon.x&&h(Icon.x,{s:16})));

  // ---- step 1: the source ----
  const source = h("div",{className:"ns-body si-body"},
    h("div",{className:"ns-seclab"},"Your screenplay"),
    h("button",{type:"button",className:"si-drop"+(drag?" over":"")+(reading?" busy":""),
        onClick:()=>fileRef.current && fileRef.current.click(),
        onDragOver:(e)=>{ e.preventDefault(); setDrag(true); }, onDragLeave:()=>setDrag(false),
        onDrop:(e)=>{ e.preventDefault(); setDrag(false); readFiles(e.dataTransfer && e.dataTransfer.files); },
        "aria-label":"Choose a script file, or drop one here"},
      Icon.script && h(Icon.script,{s:22}),
      h("b",null, reading ? "Reading your script…" : "Drop your script here, or choose a file"),
      h("span",null,"Fountain (.fountain), Final Draft (.fdx), Highland (.highland), PDF, Word (.docx) or plain text (.txt).")),
    h("input",{ref:fileRef,type:"file",accept:SI.ACCEPT,className:"si-file",tabIndex:-1,"aria-hidden":"true",multiple:seriesOn,
      onChange:(e)=>{ const fs=Array.from(e.target.files||[]); e.target.value=""; readFiles(fs); }}),
    seriesOn && h("div",{className:"si-many-hint"},"Episodes of a series? Choose or drop all their files at once \u2014 they go into one Show, with one shared cast."),
    h("button",{type:"button",className:"si-paste-toggle",onClick:()=>setPasteOpen(o=>!o),"aria-expanded":pasteOpen?"true":"false"},
      pasteOpen ? "Hide the text box" : "Or paste the script’s text"),
    pasteOpen && h("div",{className:"ns-field"},
      h("textarea",{className:"ns-input si-paste",value:pasteText,rows:10,placeholder:"INT. N68 BUS — NIGHT\n\nRain hammers the windscreen.\n\nTOMASZ\nGo home, mate.",
        onChange:e=>setPasteText(e.target.value)})),
    h("div",{className:"ns-hint si-hint"},"Reading the file is free and happens on this device. Your words are kept exactly — nothing is rewritten."),
    err && h("div",{className:"ns-err"},err),
    h("div",{className:"ns-foot"},
      h("button",{className:"ns-btn ghost",onClick:onClose},"Cancel"),
      pasteOpen && h("button",{className:"ns-btn primary",onClick:readPaste,disabled:!pasteText.trim()},"Read the text →")));

  // ---- a scanned PDF: read the page images (paid, stoppable; what's read is kept while the window is open) ----
  if(stage==="scan" && scan){
    const P = window.ScriptPages, SR = window.ScriptRead;
    const modelId = SR && SR.engineFor ? SR.engineFor() : undefined;
    const est = P.scanEstimate(scan.pages, modelId);
    const label = ((window.WRITING_MODELS||[]).find(m=>m.id===est.modelId)||{}).label || "The reading engine";
    const left = Math.max(0, scan.pages - scan.texts.length);
    const leftEst = P.scanEstimate(left, modelId);
    const readPages = async ()=>{
      if(scan.reading || !left) return;
      if(typeof beforeScanRead==="function" && !beforeScanRead()) return;
      scanStop.current = false; setErr("");
      setScan(x=>({ ...x, reading:true, stopping:false }));
      try{
        const buf = await scan.file.arrayBuffer();
        const res = await P.readScan(buf, { modelId, prior:scan.texts, shouldStop:()=>scanStop.current,
          onPage:(n, of, text)=>setScan(x=> x ? { ...x, texts:x.texts.concat([text]) } : x) });
        setScan(x=>({ ...x, reading:false, stopping:false, texts:res.texts }));
        if(res.done){ const r = P.fromScan(res.texts, scan.fileName); took(r); }
      }catch(e){
        setScan(x=> x ? { ...x, reading:false, stopping:false } : x);
        setErr(String((e && e.message) || e || "The pages couldn\u2019t be read."));
      }
    };
    const n = scan.texts.length;
    return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy && !scan.reading) onClose(); }},
      h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Read a scanned script"}, head,
        h("div",{className:"ns-body si-body"},
          h("div",{className:"si-prose si-scan"},
            h("b",null,"This PDF is a scan"),
            h("span",null,"Its "+scan.pages+" page"+(scan.pages!==1?"s are":" is")+" pictures, with no text to read on this device. "+label
              +" can read the page images into your script, page by page \u2014 about "+(est.lo===est.hi?est.lo:est.lo+"\u2013"+est.hi)+" credits for all of them. "
              +"It\u2019s a transcription of the pages, so check the words in the preview before you import."),
            (scan.reading || n>0) && h("div",{className:"si-scan-bar",role:"progressbar","aria-valuemin":0,"aria-valuemax":scan.pages,"aria-valuenow":n},
              h("i",{style:{width:Math.round(100*n/Math.max(1,scan.pages))+"%"}})),
            (scan.reading || n>0) && h("small",null, scan.reading ? (scan.stopping ? "Stopping after this page\u2026" : "Reading page "+Math.min(scan.pages, n+1)+" of "+scan.pages+"\u2026") : n+" of "+scan.pages+" pages read \u2014 the rest is about "+(leftEst.lo===leftEst.hi?leftEst.lo:leftEst.lo+"\u2013"+leftEst.hi)+" credits."),
            h("div",{className:"si-prose-acts"},
              !scan.reading && h("button",{type:"button",className:"ns-btn primary",onClick:readPages,disabled:!left},
                n>0 ? "Read the rest \u2192" : "Read the "+scan.pages+" page"+(scan.pages!==1?"s":"")+" \u2192"),
              scan.reading && h("button",{type:"button",className:"ns-btn ghost",disabled:!!scan.stopping,onClick:()=>{ scanStop.current = true; setScan(x=>({ ...x, stopping:true })); }},"Stop"))),
          h("div",{className:"ns-hint si-hint"},"Or export the script from your writing app as PDF, Fountain or .fdx \u2014 a PDF your writing app saves has its text in it, and reading that is free."),
          err && h("div",{className:"ns-err"},err),
          h("div",{className:"ns-foot"},
            h("button",{className:"ns-btn ghost",disabled:!!scan.reading,onClick:()=>{ setStage("source"); setScan(null); setErr(""); }},"\u2190 Back")))));
  }

  // ---- SEVERAL EPISODES (phase 6): one Show, the episodes in order, one cast across them ----
  if(stage==="series" && episodes){
    const newShow = showPick==="new";
    const pickRow = (shows||[]).find(x=>x.id===showPick) || null;
    const castMap = new Map();
    episodes.forEach((p,ei)=>(p.characters||[]).forEach(c=>{ const k = String(c.name||"").toLowerCase(); if(!k) return;
      const x = castMap.get(k) || { key:k, name:c.name, lines:0, eps:new Set() }; x.lines += c.lines||0; x.eps.add(ei); castMap.set(k, x); }));
    const cast = Array.from(castMap.values()).sort((a,b)=> b.eps.size-a.eps.size || b.lines-a.lines || a.name.localeCompare(b.name));
    // "Same person as…" across every episode: merged where both appear, renamed where only one does (the Show's cast
    // matches people by name)
    const mergeAcross = (fromK, intoK)=>{ const into = cast.find(c=>c.key===intoK); if(!into) return;
      setEpisodes(list=>list.map(p=>{
        const f = (p.characters||[]).find(c=>String(c.name).toLowerCase()===fromK), t = (p.characters||[]).find(c=>String(c.name).toLowerCase()===intoK);
        if(f && t) return SI.mergeCharacters(p, f.key, t.key);
        if(f) return SI.renameCharacter(p, f.key, into.name);
        return p; })); };
    const move = (i,d)=> setEpisodes(list=>{ const a = list.slice(), j = i+d; if(j<0 || j>=a.length) return list; const t = a[i]; a[i] = a[j]; a[j] = t; return a; });
    const epTitle = (p)=>{ const e = SI.episodeInfo ? SI.episodeInfo(p, p.fileName) : {}; return e.episodeTitle || p.title || String(p.fileName||"").replace(/\.[^.]+$/,""); };
    const firstNo = newShow ? 1 : (Number(pickRow && pickRow.episodes)||0)+1;
    const fws = (typeof frameworkChoices==="function") ? frameworkChoices() : [];
    const doImport = ()=>{
      const films = episodes.map((p,i)=>{
        const film = SI.toFilm(p, { title: i===0 && newShow ? (showTitle.trim() || epTitle(p)) : epTitle(p), author: author || p.author,
          format: newShow ? "series" : ((pickRow && pickRow.format) || "series"), framework, fileName:p.fileName||"" });
        film.project.importedFrom = { ...(film.project.importedFrom||{}), episodeTitle:epTitle(p) };
        return film; });
      onImportSeries({ films, showId: newShow ? null : showPick, showTitle: showTitle.trim() });
    };
    return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy) onClose(); }},
      h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Import episodes"}, head,
        h("div",{className:"ns-body si-body"},
          h("div",{className:"si-tiles"}, h("div",{className:"si-tile"},h("span",null,"Episodes"),h("b",null,String(episodes.length))),
            h("div",{className:"si-tile"},h("span",null,"Scenes"),h("b",null,String(episodes.reduce((n,p)=>n+(p.scenes||[]).length,0)))),
            h("div",{className:"si-tile"},h("span",null,"Pages"),h("b",null,"\u2248 "+episodes.reduce((n,p)=>n+SI.stats(p).pages,0))),
            h("div",{className:"si-tile"},h("span",null,"Cast"),h("b",null,String(cast.length)))),
          h("div",{className:"si-grid"},
            h("label",{className:"si-field"}, h("span",null,"Show"),
              h("select",{className:"ns-input",value:showPick,onChange:e=>setShowPick(e.target.value)},
                h("option",{value:"new"},"A new Show"),
                (shows||[]).map(x=>h("option",{key:x.id,value:x.id},showName(x.title)+(x.episodes?" \u00b7 "+x.episodes+" episode"+(x.episodes!==1?"s":""):""))))),
            newShow ? h("label",{className:"si-field"}, h("span",null,"The Show\u2019s name"),
                h("input",{className:"ns-input",value:showTitle,onChange:e=>setShowTitle(e.target.value),placeholder:"The series\u2019 title"}))
              : h("div",{className:"si-field"}, h("span",null,"Adds"), h("small",null,"Episodes "+firstNo+"\u2013"+(firstNo+episodes.length-1)+", after the Show\u2019s own")),
            h("label",{className:"si-field"}, h("span",null,"Written by"),
              h("input",{className:"ns-input",value:author,onChange:e=>setAuthor(e.target.value),placeholder:"Credited on every export"})),
            h("label",{className:"si-field"}, h("span",null,"Read it as"),
              h("select",{className:"ns-input",value:framework,onChange:e=>setFramework(e.target.value)}, fws.map(f=>h("option",{key:f.id,value:f.id},f.label))))),
          h("div",{className:"ns-seclab"},"Episodes \u00b7 in this order"),
          h("div",{className:"si-scenes"}, episodes.map((p,i)=>{ const st = SI.stats(p), w = (p.warnings||[]).length;
            return h("div",{key:(p.fileName||"")+i,className:"si-scene"},
              h("div",{className:"si-scene-row"},
                h("span",{className:"si-scene-no"},"E"+String(firstNo+i).padStart(2,"0")),
                h("div",{className:"si-scene-main"}, h("b",null,epTitle(p)),
                  h("span",null,(p.fileName||"pasted text")+" \u00b7 "+st.scenes+" scene"+(st.scenes!==1?"s":"")+" \u00b7 \u2248"+st.pages+" page"+(st.pages!==1?"s":"")+(w?" \u00b7 "+w+" note"+(w!==1?"s":"")+" to check":""))),
                h("div",{className:"si-scene-acts"},
                  h("button",{type:"button",className:"ns-btn ghost si-mini",disabled:i===0,"aria-label":"Move up",onClick:()=>move(i,-1)},"\u2191"),
                  h("button",{type:"button",className:"ns-btn ghost si-mini",disabled:i===episodes.length-1,"aria-label":"Move down",onClick:()=>move(i,1)},"\u2193")))); })),
          h("div",{className:"ns-seclab"},"The cast across the episodes \u00b7 "+cast.length),
          h("div",{className:"si-chars"}, cast.map(c=>h("div",{key:c.key,className:"si-char"},
            h("span",{className:"si-char-name ro"},c.name),
            h("span",{className:"si-char-meta"}, "in "+c.eps.size+" of "+episodes.length+" \u00b7 "+c.lines+" line"+(c.lines!==1?"s":"")),
            cast.length>1 && h("select",{className:"si-char-merge",value:"","aria-label":"Merge "+c.name+" into another character",
                onChange:e=>{ if(e.target.value) mergeAcross(c.key, e.target.value); }},
              h("option",{value:""},"Same person as\u2026"),
              cast.filter(x=>x.key!==c.key).map(x=>h("option",{key:x.key,value:x.key},x.name)))))),
          h("label",{className:"si-rights"},
            h("input",{type:"checkbox",checked:rights,onChange:e=>setRights(e.target.checked)}),
            h("span",null,"I wrote these scripts or have the rights to use them.")),
          h("div",{className:"ns-hint si-hint"},"Importing is free. Each episode comes in with its screenplay exactly as written; the cast is one shared Show cast, and each episode is read from its own Writers' Room bar."),
          err && h("div",{className:"ns-err"},err),
          h("div",{className:"ns-foot"},
            h("button",{className:"ns-btn ghost",onClick:()=>{ setStage("source"); setEpisodes(null); setRights(false); },disabled:busy},"\u2190 Back"),
            h("button",{className:"ns-btn primary",disabled:!rights||busy||(newShow && !showTitle.trim()),
                title:!rights ? "Confirm you have the rights to use these scripts first" : "", onClick:doImport},
              busy ? "Importing\u2026" : "Import "+episodes.length+" episodes \u2192")))));
  }

  if(stage==="source" || !parsed){
    return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy) onClose(); }},
      h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Import your script"}, head, source));
  }

  // ---- step 2: the preview ----
  const st = SI.stats(parsed);
  const sug = SI.suggestFormat(st);
  const formats = (typeof window.formatsForPicker==="function" ? window.formatsForPicker() : (window.FORMATS||[])) || [];
  const fmtList = Array.isArray(formats) ? formats.flatMap(x=> Array.isArray(x.formats) ? x.formats : [x]).filter(f=>f && f.id) : [];
  const fws = (typeof frameworkChoices==="function") ? frameworkChoices() : [];
  const chars = parsed.characters || [];
  const sugg = SI.characterSuggestions(chars);
  const merge = (from, into)=> setParsed(p=> SI.mergeCharacters(p, from, into));
  const tile = (k, v)=> h("div",{className:"si-tile"}, h("span",null,k), h("b",null,v));
  const firstLine = (sc)=>{ const b = (sc.blocks||[]).find(x=>x.type!=="scene"); return b ? b.text : ""; };
  const kindWord = { fountain:"Fountain", fdx:"Final Draft", highland:"Highland", text:"plain text", paste:"pasted text", pdf:"PDF", docx:"Word", "pdf-scan":"the page images of a scanned PDF" }[parsed.source] || "your script";

  // ---- a new draft: what changed ----
  if(draftMode){
    const m = SI.matchDraft(existing, parsed);
    const c = m.counts;
    const chip = { unchanged:"Unchanged", revised:"Revised", new:"New", removed:"Not in the new draft" };
    const edited = m.rows.filter(r=>r.editedHere).length;
    const nothing = !c.revised && !c.new && !c.removed && !c.moved;
    const body = h("div",{className:"ns-body si-body"},
      h("div",{className:"si-tiles"}, tile("Unchanged", String(c.unchanged)), tile("Revised", String(c.revised)), tile("New", String(c.new)), tile("Not in it", String(c.removed))),
      h("div",{className:"si-read-from"},"Read from "+(parsed.fileName||"the pasted text")+(c.moved?" · "+c.moved+" scene"+(c.moved!==1?"s":"")+" moved":"")),
      parsed.looksLikeProse && h("ul",{className:"si-warn"}, h("li",null,Icon.alert&&h(Icon.alert,{s:12}),"This reads like prose, not a screenplay — check it’s the right file.")),
      edited>0 && h("ul",{className:"si-warn"}, h("li",null,Icon.alert&&h(Icon.alert,{s:12}),
        edited+" revised scene"+(edited!==1?"s were":" was")+" also changed here in Kinolot. The new draft’s words replace them; your Kinolot text stays in each scene’s version history.")),
      nothing && h("div",{className:"ns-hint"},"This draft has the same words as the film — nothing to apply."),
      h("div",{className:"ns-seclab"},"Scenes in the new draft · "+m.rows.length),
      h("div",{className:"si-scenes"}, m.rows.map((r,k)=>h("div",{key:k,className:"si-scene"},
        h("div",{className:"si-scene-row"},
          h("span",{className:"si-scene-no"}, String(k+1).padStart(2,"0")),
          h("div",{className:"si-scene-main"},
            h("b",null, r.heading || "No heading"),
            h("span",null, (r.status==="new" ? "A new scene" : (r.oldNo!=null ? "Scene "+String(r.oldNo).padStart(2,"0")+(r.title?" · "+r.title:"") : ""))
              +(r.status==="revised" ? " · about "+r.changed+"% of its words changed" : "")+(r.moved ? " · moved" : "")
              +(r.editedHere ? " · also changed in Kinolot" : ""))),
          h("span",{className:"si-status "+r.status}, chip[r.status]))))
        .concat(m.removed.map((r,k)=>h("div",{key:"rm"+k,className:"si-scene removed"},
          h("div",{className:"si-scene-row"},
            h("span",{className:"si-scene-no"},"—"),
            h("div",{className:"si-scene-main"}, h("b",null, r.heading || r.title || "Scene"), h("span",null,"Scene "+String(r.oldNo).padStart(2,"0")+" · not in the new draft")),
            h("span",{className:"si-status removed"}, chip.removed)))))),
      c.removed>0 && h("div",{className:"si-choice",role:"radiogroup","aria-label":"Scenes not in the new draft"},
        h("label",null, h("input",{type:"radio",name:"si-missing",checked:!removeMissing,onChange:()=>setRemoveMissing(false)}),
          h("span",null,h("b",null,"Keep "+(c.removed!==1?"them":"it")),", marked “not in the new draft” — "+(c.removed!==1?"their":"its")+" beats, shots and takes stay")),
        h("label",null, h("input",{type:"radio",name:"si-missing",checked:removeMissing,onChange:()=>setRemoveMissing(true)}),
          h("span",null,h("b",null,"Remove "+(c.removed!==1?"them":"it")),", as the new draft does — Undo brings "+(c.removed!==1?"them":"it")+" back"))),
      h("label",{className:"si-rights"},
        h("input",{type:"checkbox",checked:rights,onChange:e=>setRights(e.target.checked)}),
        h("span",null,"I wrote this script or have the rights to use it.")),
      h("div",{className:"ns-hint si-hint"},"Unchanged scenes keep everything. Revised and new scenes take the new draft’s words exactly (the current text stays in version history) and are read again — you’re only charged for those, and you’re asked first. Everything made from the old words is flagged, never redone on its own."),
      err && h("div",{className:"ns-err"},err),
      h("div",{className:"ns-foot"},
        h("button",{className:"ns-btn ghost",onClick:()=>{ setStage("source"); setParsed(null); setRights(false); },disabled:busy},"← Back"),
        h("button",{className:"ns-btn primary",disabled:!rights||busy||nothing||!m.rows.length,
            title:!rights ? "Confirm you have the rights to use this script first" : "",
            onClick:()=>onApplyDraft({ parsed, match:m, removeMissing, fileName:parsed.fileName||"" })},
          busy ? "Applying…" : "Apply the new draft →")));
    return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy) onClose(); }},
      h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Import a new draft"}, head, body));
  }
  // PROSE, NOT A SCREENPLAY: offer New Story first (the studio writes the screenplay from it)
  if(parsed.looksLikeProse && !proseOk){
    return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy) onClose(); }},
      h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Import your script"}, head,
        h("div",{className:"ns-body si-body"},
          h("div",{className:"si-prose"},
            h("b",null,"This reads like prose, not a screenplay"),
            h("span",null,"There are no scene headings (INT. / EXT.) and no character names over dialogue \u2014 it looks like a story, a treatment or a synopsis ("+st.words+" words). The studio can write the screenplay from it, or bring it in as it is."),
            h("div",{className:"si-prose-acts"},
              typeof onUseAsIdea==="function" && h("button",{type:"button",className:"ns-btn primary",onClick:()=>onUseAsIdea(parsed.prose||"")},"Use it as the idea in New Story \u2192"),
              h("button",{type:"button",className:"ns-btn ghost",onClick:()=>setProseOk(true)},"Import it as it is"))),
          h("div",{className:"ns-foot"},
            h("button",{className:"ns-btn ghost",onClick:()=>{ setStage("source"); setParsed(null); }},"\u2190 Back")))));
  }
  const preview = h("div",{className:"ns-body si-body"},
    h("div",{className:"si-tiles"},
      tile("Scenes", String(st.scenes)), tile("Pages", "≈ "+st.pages), tile("Screen time", "≈ "+st.minutes+" min"), tile("Speaking", String(st.speaking))),
    h("div",{className:"si-read-from"},"Read from "+kindWord+(parsed.fileName?" · "+parsed.fileName:"")+(parsed.draftDate?" · "+parsed.draftDate:"")),
    (parsed.warnings||[]).length>0 && h("ul",{className:"si-warn"}, parsed.warnings.map((w,i)=>h("li",{key:i},Icon.alert&&h(Icon.alert,{s:12}),w))),
    h("div",{className:"si-grid"},
      h("label",{className:"si-field"}, h("span",null,"Title"),
        h("input",{className:"ns-input",value:title,onChange:e=>setTitle(e.target.value),placeholder:"The film’s title"})),
      h("label",{className:"si-field"}, h("span",null,"Written by"),
        h("input",{className:"ns-input",value:author,onChange:e=>setAuthor(e.target.value),placeholder:"Credited on every export"})),
      dest!=="show" && h("label",{className:"si-field"}, h("span",null,"Format"),
        h("select",{className:"ns-input",value:format,onChange:e=>setFormat(e.target.value)},
          fmtList.map(f=>h("option",{key:f.id,value:f.id},f.label+(f.id===sug.id?" · suggested":"")))),
        h("small",null,"Suggested from the length: "+sug.why+".")),
      h("label",{className:"si-field"}, h("span",null,"Read it as"),
        h("select",{className:"ns-input",value:framework,onChange:e=>setFramework(e.target.value)},
          fws.map(f=>h("option",{key:f.id,value:f.id},f.label))),
        h("small",null,"The structure names the acts and the big turns. Your script isn’t changed."))),

    // WHERE IT GOES (phase 6): its own film, or an episode of a Show (a new one, or one of yours)
    seriesOn && (()=>{ const ep = SI.episodeInfo ? SI.episodeInfo(parsed, parsed.fileName) : { likely:false, why:[] };
      const newShow = showPick==="new";
      return h("div",{className:"si-dest"},
        h("div",{className:"ns-seclab"},"Where it goes"),
        ep.likely && h("div",{className:"si-dest-why"},"This looks like an episode of a series \u2014 "+ep.why.join(", ")+"."),
        h("div",{className:"si-choice",role:"radiogroup","aria-label":"Where the script goes"},
          h("label",null, h("input",{type:"radio",name:"si-dest",checked:dest==="film",onChange:()=>setDest("film")}),
            h("span",null,h("b",null,"Its own film"))),
          h("label",null, h("input",{type:"radio",name:"si-dest",checked:dest==="show",onChange:()=>setDest("show")}),
            h("span",null,h("b",null,"An episode of a Show"),", sharing the Show\u2019s cast, locations, props and look"))),
        dest==="show" && h("div",{className:"si-grid"},
          h("label",{className:"si-field"}, h("span",null,"Show"),
            h("select",{className:"ns-input",value:showPick,onChange:e=>setShowPick(e.target.value)},
              h("option",{value:"new"},"A new Show (this is Episode 1)"),
              (shows||[]).map(x=>h("option",{key:x.id,value:x.id},showName(x.title)+" \u00b7 as Episode "+((Number(x.episodes)||0)+1))))),
          newShow && h("label",{className:"si-field"}, h("span",null,"The Show\u2019s name"),
            h("input",{className:"ns-input",value:showTitle,onChange:e=>setShowTitle(e.target.value),placeholder:"The series\u2019 title"}))));
    })(),
    h("div",{className:"ns-seclab"},"Characters · "+chars.length),
    sugg.length>0 && h("div",{className:"si-sugg"}, sugg.map(sg=>h("div",{key:sg.from,className:"si-sugg-row"},
      h("span",null,sg.text+"?"),
      h("button",{type:"button",className:"ns-btn ghost si-mini",onClick:()=>merge(sg.from, sg.into)},"Merge")))),
    h("div",{className:"si-chars"}, chars.map(c=>h("div",{key:c.key,className:"si-char"},
      h("input",{className:"si-char-name",value:c.name,"aria-label":"Name for "+c.cue,
        onChange:e=>{ const v=e.target.value; setParsed(p=>SI.renameCharacter(p, c.key, v||c.name)); }}),
      h("span",{className:"si-char-meta"}, c.lines+" line"+(c.lines!==1?"s":"")+(c.voiceOnly?" · voice only":"")
        +((c.aliases||[]).length?" · also "+c.aliases.join(", "):"")),
      chars.length>1 && h("select",{className:"si-char-merge",value:"","aria-label":"Merge "+c.cue+" into another character",
          onChange:e=>{ if(e.target.value) merge(c.key, e.target.value); }},
        h("option",{value:""},"Same person as…"),
        chars.filter(x=>x.key!==c.key).map(x=>h("option",{key:x.key,value:x.key},x.name)))))),

    h("div",{className:"ns-seclab"},"Scenes · "+st.scenes),
    h("div",{className:"si-scenes"}, (parsed.scenes||[]).map((sc,i)=>h("div",{key:i,className:"si-scene"+(splitOpen===i?" open":"")},
      h("div",{className:"si-scene-row"},
        h("span",{className:"si-scene-no"}, String(i+1).padStart(2,"0")),
        h("div",{className:"si-scene-main"},
          h("b",null, sc.heading || (sc.opening ? "Opening — before the first scene heading" : "No heading"),
            // a line the PDF / Word reader had to guess (phase 5)
            (sc.blocks||[]).some(b=>b.unsure) && h("span",{className:"si-check",title:"A line here was indented like dialogue with no character name over it \u2014 it came in as action. Open Split\u2026 to see the lines."},"Check")),
          h("span",null, (firstLine(sc)||"").slice(0,140))),
        h("div",{className:"si-scene-acts"},
          i<(parsed.scenes.length-1) && h("button",{type:"button",className:"ns-btn ghost si-mini",title:"Make this scene and the next one scene (both headings stay in the text)",
            onClick:()=>{ setSplitOpen(-1); setParsed(p=>SI.mergeScenes(p, i)); }},"Merge with next"),
          (sc.blocks||[]).length>2 && h("button",{type:"button",className:"ns-btn ghost si-mini","aria-expanded":splitOpen===i?"true":"false",
            onClick:()=>setSplitOpen(o=>o===i?-1:i)}, splitOpen===i?"Done":"Split…"))),
      splitOpen===i && h("div",{className:"si-split"},
        h("div",{className:"si-split-lab"},"Split before a line — the new scene starts there"),
        (sc.blocks||[]).map((b,bi)=> bi===0 ? null : h("div",{key:bi,className:"si-split-line "+b.type},
          h("button",{type:"button",className:"si-split-btn",onClick:()=>{ setSplitOpen(-1); setParsed(p=>SI.splitScene(p, i, bi)); }},"Split here"),
          h("span",null,(b.type==="char"?b.text.toUpperCase():b.text).slice(0,160)))))))),

    h("label",{className:"si-rights"},
      h("input",{type:"checkbox",checked:rights,onChange:e=>setRights(e.target.checked)}),
      h("span",null,"I wrote this script or have the rights to use it.")),
    h("div",{className:"ns-hint si-hint"},"Importing is free. The scenes come in with their headings and your screenplay exactly as written; reading it into scene cards, beats and the cast comes next."),
    err && h("div",{className:"ns-err"},err),
    h("div",{className:"ns-foot"},
      h("button",{className:"ns-btn ghost",onClick:()=>{ setStage("source"); setParsed(null); setRights(false); },disabled:busy},"← Back"),
      h("button",{className:"ns-btn primary",disabled:!rights||busy||!st.scenes,
          title:!rights ? "Confirm you have the rights to use this script first" : "",
          onClick:()=>{
            if(seriesOn && dest==="show"){
              const newShow = showPick==="new", row = (shows||[]).find(x=>x.id===showPick);
              const film = SI.toFilm(parsed, { title: newShow ? (showTitle.trim() || title) : title, author,
                format: newShow ? "series" : ((row && row.format) || "series"), framework, fileName:parsed.fileName||"" });
              film.project.importedFrom = { ...(film.project.importedFrom||{}), episodeTitle:title };
              onImportSeries({ films:[film], showId: newShow ? null : showPick, showTitle: showTitle.trim() || title });
              return; }
            const film = SI.toFilm(parsed, { title, author, format, framework, fileName:parsed.fileName||"" }); onImport(film); }},
        busy ? "Importing…" : (seriesOn && dest==="show" ? "Import as an episode →" : "Import script →"))));

  return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy) onClose(); }},
    h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Import your script"}, head, preview));
}
window.ScriptImportWindow = ScriptImportWindow;

/* WHAT NEXT after a read (phase 3, docs/Script Import Plan.md step 6): three plain choices — design the film (the Art
   Room), shoot it (honestly: the Stage shoots shots, so it starts in the Art Room's Shots), or get notes (the Story
   Editors) — or stay in the Writers' Room. The room a landing card was chosen for is the first choice. */
function ScriptReadDone({ info, onArt, onStage, onEditors, onClose }){
  const h = React.createElement;
  const i = info || {};
  React.useEffect(()=>{ const k=(e)=>{ if(e.key==="Escape") onClose(); }; window.addEventListener("keydown", k); return ()=>window.removeEventListener("keydown", k); },[]);
  const opts = [
    { id:"art", t:"Design the film", room:"The Art Room", d:"The lookbook, the cast sheets, props and locations \u2014 the Production check reads your script into each character.", on:onArt },
    { id:"stage", t:"Shoot it", room:"The Stage", d:"The Stage shoots your shots, so they come first: draft each scene\u2019s shots and frames in the Art Room, then open the Stage.", on:onStage },
    { id:"editors", t:"Get notes", room:"Story Editors", d:"The Story Doctor, Setups & Payoffs and the Final Read \u2014 every change asks you first.", on:onEditors },
  ];
  const first = i.room==="stage" ? "stage" : "art";
  opts.sort((a,b)=> (b.id===first) - (a.id===first));
  return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    h("div",{className:"ns-panel si-panel si-done",role:"dialog","aria-modal":"true","aria-label":"Your script is in"},
      h("div",{className:"ns-head"},
        h("div",{className:"ns-head-t"}, h("span",{className:"ns-orb"}),
          h("div",null, h("div",{className:"ns-title"},"Your script is in"),
            h("div",{className:"ns-sub"}, (i.scenes||0)+" scene"+(i.scenes!==1?"s":"")+" read \u00b7 "+(i.characters||0)+" character"+(i.characters!==1?"s":"")
              +(i.notes ? " \u00b7 "+i.notes+" story note"+(i.notes!==1?"s":"")+" to look at" : "")+" \u00b7 your words unchanged"))),
        h("button",{className:"ag-x",onClick:onClose,title:"Close","aria-label":"Close"},Icon.x&&h(Icon.x,{s:16}))),
      h("div",{className:"ns-body si-body"},
        h("div",{className:"ns-seclab"},"What next?"),
        h("div",{className:"si-next"}, opts.map((o,k)=>h("button",{key:o.id,type:"button",className:"si-next-card"+(k===0?" first":""),onClick:o.on},
          h("span",{className:"si-next-room"},o.room),
          h("b",null,o.t+" \u2192"),
          h("span",null,o.d)))),
        h("div",{className:"ns-foot"}, h("button",{className:"ns-btn ghost",onClick:onClose},"Stay in the Writers' Room")))));
}
window.ScriptReadDone = ScriptReadDone;

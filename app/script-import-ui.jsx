/* script-import-ui.jsx — the IMPORT A SCREENPLAY window (owner 2026-10-18, docs/Script Import Plan.md, phase 1).
   Two steps, both free and in the browser: (1) the source — drop or choose a file, or paste the text; (2) the
   preview — what was found (scenes, pages, speaking characters), the title and author, a suggested format and
   the structure to read it with, the characters (rename, merge duplicates), the scenes (merge with the next,
   split at a line), warnings in plain words, and the rights confirmation. "Import script" hands the film to the
   app (onImport), which creates it the way New Story does. The read — scene cards, beats and the cast from the
   script — is phase 2. Window family classes (ns-*) as New Story. */
function ScriptImportWindow({ onClose, onImport, onUseAsIdea, busy=false }){
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
  const fileRef = React.useRef(null);

  React.useEffect(()=>{ const k=(e)=>{ if(e.key==="Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return ()=>window.removeEventListener("keydown", k); },[busy]);

  const took = (r)=>{
    setParsed(r); setErr("");
    setTitle(r.title || (r.fileName ? r.fileName.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ") : ""));
    setAuthor(r.author || "");
    const st = SI.stats(r);
    setFormat(SI.suggestFormat(st).id);
    setFramework((typeof frameworkChoices==="function" && frameworkChoices()[0] && frameworkChoices()[0].id) || "threeact");
    setStage("preview");
  };
  const readFile = async (file)=>{
    if(!file || reading) return;
    setReading(true); setErr("");
    try{ took(await SI.parseFile(file)); }
    catch(e){ setErr(String((e && e.message) || e || "That file couldn’t be read.")); }
    finally{ setReading(false); }
  };
  const readPaste = ()=>{
    if(!pasteText.trim()){ setErr("Paste the script's text first."); return; }
    try{ took(SI.parseText(pasteText)); }catch(e){ setErr(String((e && e.message) || e)); }
  };

  const head = h("div",{className:"ns-head"},
    h("div",{className:"ns-head-t"},
      h("span",{className:"ns-orb"}),
      h("div",null,
        h("div",{className:"ns-title"},"Import your script"),
        h("div",{className:"ns-sub"}, stage==="source" ? "Step 1 of 2 · your screenplay, word for word" : "Step 2 of 2 · check what we found — nothing is charged"))),
    h("button",{className:"ag-x",onClick:()=>{ if(!busy) onClose(); },title:"Close","aria-label":"Close"},Icon.x&&h(Icon.x,{s:16})));

  // ---- step 1: the source ----
  const source = h("div",{className:"ns-body si-body"},
    h("div",{className:"ns-seclab"},"Your screenplay"),
    h("button",{type:"button",className:"si-drop"+(drag?" over":"")+(reading?" busy":""),
        onClick:()=>fileRef.current && fileRef.current.click(),
        onDragOver:(e)=>{ e.preventDefault(); setDrag(true); }, onDragLeave:()=>setDrag(false),
        onDrop:(e)=>{ e.preventDefault(); setDrag(false); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) readFile(f); },
        "aria-label":"Choose a script file, or drop one here"},
      Icon.script && h(Icon.script,{s:22}),
      h("b",null, reading ? "Reading your script…" : "Drop your script here, or choose a file"),
      h("span",null,"Fountain (.fountain), Final Draft (.fdx), Highland (.highland) or plain text (.txt). PDF and Word are coming next.")),
    h("input",{ref:fileRef,type:"file",accept:SI.ACCEPT,className:"si-file",tabIndex:-1,"aria-hidden":"true",
      onChange:(e)=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(f) readFile(f); }}),
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
  const kindWord = { fountain:"Fountain", fdx:"Final Draft", highland:"Highland", text:"plain text", paste:"pasted text" }[parsed.source] || "your script";

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
      h("label",{className:"si-field"}, h("span",null,"Format"),
        h("select",{className:"ns-input",value:format,onChange:e=>setFormat(e.target.value)},
          fmtList.map(f=>h("option",{key:f.id,value:f.id},f.label+(f.id===sug.id?" · suggested":"")))),
        h("small",null,"Suggested from the length: "+sug.why+".")),
      h("label",{className:"si-field"}, h("span",null,"Read it as"),
        h("select",{className:"ns-input",value:framework,onChange:e=>setFramework(e.target.value)},
          fws.map(f=>h("option",{key:f.id,value:f.id},f.label))),
        h("small",null,"The structure names the acts and the big turns. Your script isn’t changed."))),

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
          h("b",null, sc.heading || (sc.opening ? "Opening — before the first scene heading" : "No heading")),
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
          onClick:()=>{ const film = SI.toFilm(parsed, { title, author, format, framework, fileName:parsed.fileName||"" }); onImport(film); }},
        busy ? "Importing…" : "Import script →")));

  return h("div",{className:"ns-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget && !busy) onClose(); }},
    h("div",{className:"ns-panel si-panel",role:"dialog","aria-modal":"true","aria-label":"Import your script"}, head, preview));
}
window.ScriptImportWindow = ScriptImportWindow;

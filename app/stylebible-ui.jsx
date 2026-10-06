/* stylebible-ui.jsx — The Style Bible viewer (modal).
   Shows every style preset in the film as a graded STILL, its 60/30/10 palette,
   a before→after on a neutral reference frame, the raw grade/lighting/lens/texture
   values, and a film-strip of which scene uses which preset. The "stills" are not
   AI renders — they're a neutral cinematic reference frame colour-GRADED live with
   CSS mix-blend-mode (luminance from the frame, hue/sat from the preset palette),
   so you can judge the looks instantly and offline. */

/* relative luminance of a hex colour (0=black,1=white) */
function hexLum(hex){
  const m = String(hex||"").replace("#","");
  if(m.length<6) return 0.5;
  const r=parseInt(m.slice(0,2),16)/255, g=parseInt(m.slice(2,4),16)/255, b=parseInt(m.slice(4,6),16)/255;
  return 0.2126*r+0.7152*g+0.0722*b;
}
/* contrast/brightness/saturation derived from the grade keywords AND the dominant
   colour's luminance (so a near-black dominant actually darkens the frame). */
function gradeFilter(preset){
  const g = ((preset&&preset.grade)||"").toLowerCase() + " " + ((preset&&preset.lighting)||"").toLowerCase();
  let contrast=1, bright=1, sat=1;
  if(/high.?contrast|crushed|hard/.test(g)){ contrast=1.45; bright=0.96; }
  if(/lifted|honey|warm|golden|soft|bloom|halation/.test(g)){ bright=1.08; contrast=0.95; }
  if(/desaturat|clinical|flat|clean/.test(g)){ contrast=1.02; }
  if(/monochrome/.test(g)){ sat=0.6; }
  // pull brightness toward the dominant colour's luminance: dark palettes go dark
  const lum = hexLum((preset&&preset.palette&&preset.palette[0])||"#888");
  bright *= (0.72 + lum*0.7);                 // dominant ~black -> ~0.72x, ~white -> ~1.4x
  return "contrast("+contrast.toFixed(2)+") brightness("+bright.toFixed(2)+") saturate("+sat+")";
}
/* the grading overlay: a top→bottom palette ramp (highlights=accent, mids=secondary,
   shadows=dominant) blended onto the frame's luminance. Honors the 60/30/10 split. */
function gradeOverlay(preset){
  const p = (preset&&preset.palette)||[];
  if(p.length<3) return "transparent";
  return "linear-gradient(180deg, "+p[2]+" 0%, "+p[2]+" 10%, "+p[1]+" 34%, "+p[0]+" 70%, "+p[0]+" 100%)";
}
/* a neutral, grayscale cinematic reference frame (interior-with-window comp);
   when `preset` is given it is colour-graded, otherwise shown ungraded. */
function StyleStill({ preset, label, img }){
  const graded = !!preset;
  // THE FILM'S OWN IMAGE (2026-10-03, owner — Color review): with `img` (a location plate from a
  // scene using this look) the grade is previewed on the film itself; the drawn room is the fallback
  if(img) return React.createElement("div",{className:"sb-still"},
    React.createElement("div",{className:"sb-still-base",style:{filter: graded?gradeFilter(preset):"none"}},
      React.createElement("img",{className:"sb-still-img",src:img,alt:"",draggable:false})),
    graded && React.createElement("div",{className:"sb-grade",style:{background:gradeOverlay(preset)}}),
    graded && React.createElement("div",{className:"sb-grade-mult",style:{background:gradeOverlay(preset)}}),
    label && React.createElement("span",{className:"sb-still-tag"},label));
  return React.createElement("div",{className:"sb-still"},
    React.createElement("div",{className:"sb-still-base",style:{filter: graded?gradeFilter(preset):"contrast(1) saturate(0.18)"}},
      React.createElement("div",{className:"sb-sky"}),
      React.createElement("div",{className:"sb-glow"}),
      React.createElement("div",{className:"sb-floor"}),
      React.createElement("div",{className:"sb-window"}),
      React.createElement("div",{className:"sb-figure"}),
      React.createElement("div",{className:"sb-furn"}),
      React.createElement("div",{className:"sb-vig"})),
    graded && React.createElement("div",{className:"sb-grade",style:{background:gradeOverlay(preset)}}),
    graded && React.createElement("div",{className:"sb-grade-mult",style:{background:gradeOverlay(preset)}}),
    label && React.createElement("span",{className:"sb-still-tag"},label));
}

/* the 60/30/10 proportion bar with hex + role labels */
function PaletteBar({ preset }){
  const p = preset.palette||[];
  if(p.length<3) return null;
  const segs = [
    { w:60, c:p[0], lab:preset.dominantLabel||"dominant", pct:"60%" },
    { w:30, c:p[1], lab:preset.secondaryLabel||"secondary", pct:"30%" },
    { w:10, c:p[2], lab:preset.accentLabel||"accent", pct:"10%" },
  ];
  return React.createElement("div",{className:"sb-pal"},
    React.createElement("div",{className:"sb-pal-bar"},
      segs.map((s,i)=>React.createElement("div",{key:i,className:"sb-pal-seg",style:{flex:s.w,background:s.c},title:s.c}))),
    React.createElement("div",{className:"sb-pal-keys"},
      segs.map((s,i)=>React.createElement("div",{key:i,className:"sb-pal-key"},
        React.createElement("span",{className:"sb-pal-sw",style:{background:s.c}}),
        React.createElement("span",{className:"sb-pal-pct"},s.pct),
        React.createElement("span",{className:"sb-pal-lab"},s.lab),
        React.createElement("span",{className:"sb-pal-hex"},(s.c||"").toUpperCase())))));
}

/* one look: a graded preview (on the film's own image when there is one), its 60/30/10 palette,
   the raw grade / lighting / lens / texture, where it's applied — and, since 2026-10-03, EDITABLE
   (name, the three colours and their names, the four notes) and deletable */
function PresetCard({ preset, sceneList, count, img, example, onUpdate, onDelete }){
  const [editing, setEditing] = React.useState(false);
  const pal = (preset.palette||[]).slice(0,3);
  const setColor = (i, hex)=>{ const next = pal.slice(); while(next.length<3) next.push("#888888"); next[i] = hex; onUpdate({ palette:next }); };
  const ask = async ()=>{
    const ok = !window.appConfirm || await window.appConfirm({
      title:"Delete the look \u201c"+(preset.name||"Untitled")+"\u201d?",
      body: count ? (count+" scene"+(count!==1?"s":"")+" using it will have no look until you pick one (or Light the film again).") : "No scene uses it.",
      confirmLabel:"Delete look", cancelLabel:"Cancel", danger:true });
    if(ok) onDelete();
  };
  const field = (k, label)=> React.createElement("label",{className:"sb-edit-field",key:k},
    React.createElement("span",null,label),
    React.createElement("textarea",{rows:2,defaultValue:preset[k]||"",onBlur:e=>{ const v=e.target.value.trim(); if(v!==(preset[k]||"")) onUpdate({ [k]:v }); }}));
  return React.createElement("div",{className:"sb-card"+(example?" example":"")},
    React.createElement("div",{className:"sb-card-head"},
      React.createElement("div",{className:"sb-card-title"},
        React.createElement("span",{className:"sb-card-dot",style:{background:pal[0]||"#888"}}),
        preset.name),
      React.createElement("div",{className:"sb-card-acts"},
        React.createElement("span",{className:"sb-card-count"+(count?"":" zero"),
          title:count?"How many scenes use this look":"No scene is color-scripted with this look yet \u2014 'Light the film' assigns looks to scenes, or click a scene in the film-strip to assign by hand"},
          example ? "example" : count ? (count+" scene"+(count!==1?"s":"")) : "no scenes yet"),
        onUpdate && React.createElement("button",{type:"button",className:"sb-card-btn"+(editing?" on":""),onClick:()=>setEditing(v=>!v),
          title:editing?"Done editing":"Edit this look \u2014 its name, colours and notes"}, editing?"Done":"Edit"),
        onDelete && React.createElement("button",{type:"button",className:"sb-card-btn danger",onClick:ask,title:"Delete this look"},
          React.createElement(Icon.trash||Icon.x,{s:12})))),
    React.createElement(StyleStill,{preset,label:img?(preset.name+" \u00b7 on this film"):preset.name,img}),
    editing
      ? React.createElement("div",{className:"sb-edit"},
          React.createElement("label",{className:"sb-edit-field"},React.createElement("span",null,"Name"),
            React.createElement("input",{type:"text",defaultValue:preset.name||"",onBlur:e=>{ const v=e.target.value.trim(); if(v && v!==preset.name) onUpdate({ name:v }); }})),
          React.createElement("div",{className:"sb-edit-colors"},
            [["dominantLabel","60% dominant"],["secondaryLabel","30% secondary"],["accentLabel","10% accent"]].map(([k,role],i)=>
              React.createElement("div",{key:k,className:"sb-edit-color"},
                React.createElement("input",{type:"color",value:(pal[i]||"#888888").slice(0,7),"aria-label":role+" colour",onChange:e=>setColor(i, e.target.value)}),
                React.createElement("input",{type:"text",defaultValue:preset[k]||"",placeholder:role,"aria-label":role+" name",
                  onBlur:e=>{ const v=e.target.value.trim(); if(v!==(preset[k]||"")) onUpdate({ [k]:v }); }})))),
          field("grade","Grade"), field("lighting","Lighting"), field("lens","Lens"), field("texture","Texture"))
      : React.createElement(React.Fragment,null,
          React.createElement(PaletteBar,{preset}),
          React.createElement("div",{className:"sb-meta"},
            React.createElement(SbMetaRow,{k:"Grade",v:preset.grade}),
            React.createElement(SbMetaRow,{k:"Lighting",v:preset.lighting}),
            React.createElement(SbMetaRow,{k:"Lens",v:preset.lens}),
            React.createElement(SbMetaRow,{k:"Texture",v:preset.texture}))),
    // where applied
    sceneList && sceneList.length>0 && React.createElement("div",{className:"sb-scenes"},
      React.createElement("span",{className:"sb-scenes-lab"},"Applied to"),
      sceneList.map(s=>React.createElement("span",{key:s.id,className:"sb-scene-chip",title:s.title||("Scene "+s.no)},
        String(s.no).padStart(2,"0")))));
}
function SbMetaRow({ k, v }){
  if(!v) return null;
  return React.createElement("div",{className:"sb-meta-row"},
    React.createElement("span",{className:"sb-meta-k"},k),
    React.createElement("span",{className:"sb-meta-v"},v));
}

/* a strip of every scene in story order, each cell tinted by its assigned preset,
   plus a LEGEND naming each preset and the scenes it covers \u2014 the at-a-glance answer
   to "which preset is set where". Cells use the preset's full 60/30/10 palette as a
   gradient (its dominant alone is often near-black, so cells would look identical). */
function StyleFilmStrip({ scenes, project, presets, onSetScenePreset }){
  const { sceneStyles, sceneStylesManual, sceneWhy } = styleBibleOf(project);
  const sorted = scenesInStoryOrder(scenes);
  const presetOf = (pid)=> presets.find(x=>x.id===pid) || null;
  const swatchOf = (p)=>{ const pal=(p&&p.palette)||[]; return pal.length>=3
    ? `linear-gradient(135deg, ${pal[0]} 0%, ${pal[1]} 55%, ${pal[2]} 100%)` : (pal[0]||null); };
  const nameOf = (pid)=>{ const p=presetOf(pid); return p?p.name:"Unassigned"; };
  const pad = (no)=> String(no).padStart(2,"0");
  const unassigned = sorted.filter(s=>!sceneStyles[s.id]).length;
  const manual = (sid)=> !!(sceneStylesManual[sid] && sceneStyles[sid]);
  // presets actually in use, each with the scenes it covers \u2014 this IS the colour key
  const used = presets.map(p=>({ p, scs: sorted.filter(s=>sceneStyles[s.id]===p.id) })).filter(x=>x.scs.length);
  // manual per-scene override: click a cell to open a preset picker
  const editable = typeof onSetScenePreset==="function";
  const [pick, setPick] = React.useState(null);  // sceneId of the open picker
  React.useEffect(()=>{ if(!pick) return;
    const close = (e)=>{ if(!e.target.closest || !e.target.closest(".sb-pick")) setPick(null); };
    document.addEventListener("mousedown", close); return ()=>document.removeEventListener("mousedown", close); },[pick]);
  const choose = (sid, pid)=>{ onSetScenePreset(sid, pid); setPick(null); };
  return React.createElement("div",{className:"sb-strip-wrap"},
    React.createElement("div",{className:"sb-strip-head"},
      React.createElement("span",{className:"sb-strip-title"},"Across the film",
        React.createElement("span",{className:"sb-strip-count"},
          " · "+presets.length+" preset"+(presets.length!==1?"s":"")+" · "+(sorted.length-unassigned)+" of "+sorted.length+" scenes styled"),
        editable && React.createElement("span",{className:"sb-strip-hint"}," — click a scene to set its style")),
      unassigned>0 && React.createElement("span",{className:"sb-strip-warn"},
        React.createElement(Icon.alert,{s:12}), unassigned+" scene"+(unassigned!==1?"s":"")+" with no style yet")),
    React.createElement("div",{className:"sb-strip"},
      sorted.map((s,idx)=>{
        const pid = sceneStyles[s.id]; const bg = swatchOf(presetOf(pid));
        const open = pick===s.id; const alignRight = idx > sorted.length/2;
        return React.createElement("div",{key:s.id,
          className:"sb-strip-cell"+(bg?"":" none")+(editable?" editable":"")+(open?" picking":""),
          style:bg?{background:bg}:undefined,
          // reachable from the keyboard too (2026-10-05): Tab to a scene, Enter or Space opens its picker
          role: editable ? "button" : undefined, tabIndex: editable ? 0 : undefined,
          "aria-label": "Scene "+pad(s.no)+(s.title?" \u00b7 "+s.title:"")+" \u2014 "+nameOf(pid)+(editable?" (change the look)":""),
          "aria-expanded": editable ? (open?"true":"false") : undefined,
          onKeyDown: editable ? (e)=>{ if(e.target!==e.currentTarget) return;
            if(e.key==="Enter" || e.key===" "){ e.preventDefault(); setPick(open?null:s.id); } else if(e.key==="Escape" && open){ e.preventDefault(); setPick(null); } } : undefined,
          onClick: editable ? ()=>setPick(open?null:s.id) : undefined,
          title:"Scene "+pad(s.no)+" \u00b7 "+(s.title||"")+"  \u2014  "+nameOf(pid)
            +(manual(s.id)?"  (set by hand \u2014 Light the film keeps it)":"")
            +(sceneWhy[s.id]?("\n"+sceneWhy[s.id]):"")+(editable?"\n\u00b7 click to change":"")},
          React.createElement("span",{className:"sb-strip-no"},pad(s.no)),
          manual(s.id) && React.createElement("span",{className:"sb-strip-hand","aria-label":"set by hand"},"\u270b"),
          open && React.createElement("div",{className:"sb-pick"+(alignRight?" right":""),onClick:(e)=>e.stopPropagation()},
            React.createElement("div",{className:"sb-pick-h"},"Scene "+pad(s.no)+(s.title?" \u00b7 "+s.title:"")),
            sceneWhy[s.id] && React.createElement("div",{className:"sb-pick-why"},sceneWhy[s.id]),
            manual(s.id) && React.createElement("div",{className:"sb-pick-why"},"Set by hand \u2014 Light the film keeps it."),
            presets.map(p=>React.createElement("button",{key:p.id,className:"sb-pick-item"+(p.id===pid?" on":""),onClick:()=>choose(s.id,p.id)},
              React.createElement("span",{className:"sb-pick-sw",style:{background:swatchOf(p)||"#555"}}),
              React.createElement("span",{className:"sb-pick-nm"},p.name),
              p.id===pid && React.createElement(Icon.check,{s:14}))),
            React.createElement("button",{className:"sb-pick-item"+(!pid?" on":""),onClick:()=>choose(s.id,null)},
              React.createElement("span",{className:"sb-pick-sw none"}),
              React.createElement("span",{className:"sb-pick-nm"},"Unassigned"),
              !pid && React.createElement(Icon.check,{s:14}))));
      })),
    used.length>0 && React.createElement("div",{className:"sb-strip-legend"},
      used.map(({p,scs})=>
        React.createElement("div",{key:p.id,className:"sb-legend-item",
          title:p.name+" \u2014 scenes "+scs.map(s=>pad(s.no)).join(", ")},
          React.createElement("span",{className:"sb-legend-sw",style:{background:swatchOf(p)||"#555"}}),
          React.createElement("span",{className:"sb-legend-nm"},p.name),
          React.createElement("span",{className:"sb-legend-ct"},scs.length)))));
}


/* Sample a small palette from an uploaded image, entirely client-side, and keep a 384px copy
   (`view`) the Colorist LOOKS AT when it lights the film (owner 2026-10-05 — Color review: the
   sampled colours alone lost the light, contrast and texture). Returns
   { id, thumb (small JPEG dataURL), view (≤384px JPEG dataURL), colors:[hex] }. Stills added
   before keep only their colours (re-add one to let the Colorist see it). */
function extractImageRef(file){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onerror=()=>reject(new Error("read failed"));
    fr.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error("decode failed"));
      img.onload=()=>{
        try{
          const W=img.width||1, H=img.height||1;
          const hex=(r,g,b)=>"#"+[r,g,b].map(x=>Math.max(0,Math.min(255,x|0)).toString(16).padStart(2,"0")).join("");
          // small thumbnail
          const ts=Math.min(1,72/Math.max(W,H)), tc=document.createElement("canvas");
          tc.width=Math.max(1,Math.round(W*ts)); tc.height=Math.max(1,Math.round(H*ts));
          tc.getContext("2d").drawImage(img,0,0,tc.width,tc.height);
          const thumb=tc.toDataURL("image/jpeg",0.6);
          // the copy the Colorist sees: ≤384px on the long side (about 20–40 KB, kept with the film)
          const vs=Math.min(1,384/Math.max(W,H)), vc=document.createElement("canvas");
          vc.width=Math.max(1,Math.round(W*vs)); vc.height=Math.max(1,Math.round(H*vs));
          vc.getContext("2d").drawImage(img,0,0,vc.width,vc.height);
          const view=vc.toDataURL("image/jpeg",0.72);
          // palette from a ~40px sample, quantised by frequency
          const ss=Math.min(1,40/Math.max(W,H)), sc=document.createElement("canvas");
          sc.width=Math.max(1,Math.round(W*ss)); sc.height=Math.max(1,Math.round(H*ss));
          const cx=sc.getContext("2d"); cx.drawImage(img,0,0,sc.width,sc.height);
          const d=cx.getImageData(0,0,sc.width,sc.height).data, q=v=>Math.round(v/24)*24, buckets={};
          for(let i=0;i<d.length;i+=4){ if(d[i+3]<125) continue;
            const k=q(d[i])+","+q(d[i+1])+","+q(d[i+2]); buckets[k]=(buckets[k]||0)+1; }
          const colors=Object.keys(buckets).sort((a,b)=>buckets[b]-buckets[a]).slice(0,6)
            .map(k=>{ const p=k.split(",").map(Number); return hex(p[0],p[1],p[2]); });
          resolve({ id:"ri_"+Date.now().toString(36)+Math.floor(Math.random()*1e6).toString(36), thumb, view, colors });
        }catch(err){ reject(err); }
      };
      img.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* the uploaded reference-image thumbnails: each shows its sampled swatches + a remove ×.
   (The upload trigger lives in the reference bar itself — see StyleRefsField.) */
function StyleRefImages({ refImages, onRemoveRefImage }){
  const imgs = refImages||[];
  if(!imgs.length) return null;
  return React.createElement("div",{className:"sb-refimgs"},
    imgs.map(ri=>React.createElement("div",{key:ri.id,className:"sb-refimg",
      title: ri.view ? "Reference still \u2014 the Colorist looks at it and its sampled palette when it lights the film"
        : "Reference still \u2014 only its sampled colours reach the Colorist (added before it could see stills): remove it and add it again to let it see the image"},
      React.createElement("img",{src:ri.thumb,alt:"reference still"}),
      React.createElement("div",{className:"sb-refimg-sw"},
        (ri.colors||[]).slice(0,5).map((c,i)=>React.createElement("span",{key:i,style:{background:c}}))),
      onRemoveRefImage && React.createElement("button",{className:"sb-refimg-x",title:"Remove",
        onClick:()=>onRemoveRefImage(ri.id)},React.createElement(Icon.x,{s:12})))));
}

/* Reference-driven look-dev: a free-text field where the user names films,
   photographers or paintings whose look they want. 'Assign from script' then
   translates that cinematography into this film's bespoke palette. Local state so
   typing is smooth; commits on blur / Enter. */
function StyleRefsField({ value, onCommit, refImages, onAddRefImages, onRemoveRefImage, onLight, lightDisabled, manualCount }){
  const [v, setV] = React.useState(value||"");
  const [redoManual, setRedoManual] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const tRef = React.useRef(null);
  React.useEffect(()=>{ setV(value||""); },[value]);
  React.useEffect(()=>()=>{ if(tRef.current) clearTimeout(tRef.current); },[]);
  const commit = ()=>{ const t=(v||"").trim(); if(t!==((value||"").trim())) onCommit && onCommit(t);
    setSaved(true); if(tRef.current) clearTimeout(tRef.current); tRef.current = setTimeout(()=>setSaved(false), 2400); return t; };
  const imgs = refImages||[];
  const fileRef = React.useRef(null);
  const onFiles = async (e)=>{
    const files=[...((e.target&&e.target.files)||[])]; if(e.target) e.target.value="";
    if(!files.length || !onAddRefImages) return;
    const room=Math.max(0, 8-imgs.length), out=[];
    for(const f of files.slice(0,room)){ try{ out.push(await extractImageRef(f)); }catch(err){} }
    if(out.length) onAddRefImages(out);
  };
  return React.createElement("div",{style:{margin:"0 0 16px"}},
    React.createElement("div",{style:{display:"flex",alignItems:"center",gap:6,fontFamily:"var(--f-mono)",fontSize:11,
      letterSpacing:".06em",textTransform:"uppercase",color:"var(--txt-3)",marginBottom:6}},
      React.createElement(Icon.sparkles,{s:12}),"Visual references — optional look targets",
      React.createElement(InfoTip,{label:"About visual references",
        text:"Auto-filled from your Lookbook (and re-synced when it changes) until you edit it — then your version wins. Add films, photographers or paintings you love, then click “Light the film” — it saves your edits and the Colorist translates their cinematography (palette, light, lens, texture) into this film's looks."})),
    React.createElement("div",{className:"sb-refbar"},
      React.createElement("textarea",{value:v,rows:3,
        placeholder:"Auto-filled from your Lookbook as you research the look — or write your own (films, photographers, paintings: e.g. Her, Blade Runner 2049, Gregory Crewdson)",
        onChange:e=>{ setV(e.target.value); if(saved) setSaved(false); }, onBlur:commit,
        onKeyDown:e=>{ if(e.key==="Enter" && (e.metaKey||e.ctrlKey)){ e.preventDefault(); commit(); e.target.blur(); } }}),
      onAddRefImages && React.createElement("button",{className:"sb-refbar-btn",disabled:imgs.length>=8,
        onClick:()=>fileRef.current&&fileRef.current.click(),
        title:imgs.length>=8?"Up to 8 reference images":"Add reference stills \u2014 the Colorist looks at them (light, contrast, texture) and their sampled palette when it lights the film"},
        React.createElement(Icon.image,{s:14}), "Image"),
      // ONE button does both: saves whatever is in the box, then sends the Colorist —
      // the old separate Save + "Light the film above" two-step confused users (and
      // pressing Light with unsaved text silently used the STALE saved refs).
      onLight
        ? React.createElement("button",{className:"sb-refbar-btn secondary",disabled:!!lightDisabled,
            onClick:()=>{ const refs=commit(); onLight(refs, { redoManual:!!(manualCount && redoManual) }); },
            title: lightDisabled
              ? "Add scenes first — the Colorist designs the palette and color-scripts each scene"
              : "Saves these references, then the Colorist designs a bespoke palette + film stock from them and color-scripts every scene — proposed for your approval. Writing credits only, no images (a little more when it looks at your reference stills)."},
            React.createElement(Icon.palette,{s:14}),"Light the film")
        : React.createElement("button",{className:"sb-refbar-btn secondary"+(saved?" on":""),onClick:commit,
            title:"Save these references — they steer the palette when you run 'Light the film'"},
            saved && React.createElement(Icon.check,{s:14}), saved?"Saved":"Save")),
    (onLight && manualCount>0) && React.createElement("label",{className:"sb-redo"},
      React.createElement("input",{type:"checkbox",checked:redoManual,onChange:e=>setRedoManual(e.target.checked)}),
      React.createElement("span",null,"Also redo the "+manualCount+" scene"+(manualCount!==1?"s":"")+" I set by hand (\u270b) \u2014 otherwise they keep their look")),
    React.createElement("input",{type:"file",accept:"image/*",multiple:true,ref:fileRef,style:{display:"none"},onChange:onFiles}),
    imgs.length>0 && React.createElement(StyleRefImages,{refImages,onRemoveRefImage}),
    saved && React.createElement("div",{style:{fontSize:11.5,color:"var(--pos)",marginTop:6,lineHeight:1.5}},
      "References saved — “Light the film” designs the palette from them."));
}

/* InfoTip — a small "i" icon that reveals help text on hover (desktop) or tap
   (touch). Keeps long explainers out of the header without losing them. */
function InfoTip({ text, label }){
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const ref = React.useRef(null);
  const tipId = "infotip-"+React.useId().replace(/:/g,"");
  React.useEffect(()=>{ if(!open) return;
    const close=(e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close); return ()=>document.removeEventListener("pointerdown", close); },[open]);
  const show = !dismissed && (open || hover || focused);
  return React.createElement("span",{className:"infotip",ref:ref,
    onMouseEnter:()=>{ setDismissed(false); setHover(true); }, onMouseLeave:()=>setHover(false)},
    React.createElement("button",{type:"button",className:"infotip-btn"+(show?" on":""),
      "aria-label":label||"More information","aria-expanded":show?"true":"false",
      "aria-controls":tipId,"aria-describedby":show?tipId:undefined,
      onFocus:()=>{ setDismissed(false); setFocused(true); },
      onBlur:()=>{ setFocused(false); setDismissed(false); },
      onKeyDown:(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); setOpen(false); setHover(false); setDismissed(true); } },
      onClick:(e)=>{ e.stopPropagation(); setDismissed(false); setFocused(false); setOpen(o=>!o); }},
      React.createElement(Icon.info,{s:14})),
    show && React.createElement("span",{className:"infotip-pop",id:tipId,role:"tooltip"},text));
}
window.InfoTip = InfoTip;

/* StyleBibleView — the Style Bible as a full Art Room TAB (not a modal). Reuses the
   film-strip + preset cards. "Assign from script" writes the scene→preset map
   (scene-level, the source of truth); characters / locations / shots merely READ it. */
function StyleBibleView({ project, scenes, onSetRefs, onSetScenePreset, onAddRefImages, onRemoveRefImage, onColorist, lookbookStale, onApplyLookbook,
  onSetFilmStock, onUpdatePreset, onDeletePreset, refsOwned=false, onUseLookbookRefs, onKeepRefs }){
  const { presets, sceneStyles, sceneStylesManual, refs, refImages, filmStock, paletteWhy } = styleBibleOf(project);
  const scenesFor = (pid)=> scenesInStoryOrder((scenes||[]).filter(s=>sceneStyles[s.id]===pid));
  // NOT LIT YET: until the Colorist (or an edit) gives the film its own looks, the starter set is
  // shown as EXAMPLES, not as this film's looks
  const lit = !!(project && project.styleBible && project.styleBible.presets && project.styleBible.presets.length);
  const manualCount = (scenes||[]).filter(s=>sceneStylesManual[s.id] && sceneStyles[s.id]).length;
  // a look's preview image: a generated location plate from a scene that uses it, else any plate
  const plates = ((window.turnContinuity||{}).locations||[]).filter(l=>l && typeof nbGetImage==="function" && nbGetImage(l.id));
  const imgFor = (pid)=>{
    const sids = new Set(scenesFor(pid).map(s=>s.id));
    const hit = plates.find(l=>(l.scenes||[]).some(sid=>sids.has(sid))) || plates[0];
    return hit ? nbGetImage(hit.id) : "";
  };
  const stockNow = (window.FILM_STOCKS||[]).find(f=>f.id===filmStock) || { id:"none", name:"None (clean digital)" };
  return React.createElement("div",{className:"art-scroll"},
    // the references field is YOUR text: Light the film reads it, so the Lookbook change can't apply — say so (2026-10-06)
    lookbookStale && refsOwned && React.createElement("div",{className:"lb-stale-notice",role:"status"},
      React.createElement(Icon.alert,{s:14}),
      React.createElement("span",null,"The ",React.createElement("b",null,"Lookbook")," changed, but the Visual references below are your own words, so Light the film reads them, not the Lookbook. Put the Lookbook\u2019s colour notes back, or keep yours."),
      onUseLookbookRefs && React.createElement("button",{className:"lb-stale-btn ghost",onClick:onUseLookbookRefs,
        title:"Replace your text with the Lookbook's colour notes (the field follows the Lookbook again); then Light the film to use them"},"Use the Lookbook\u2019s colour notes"),
      onKeepRefs && React.createElement("button",{className:"lb-stale-btn ghost",onClick:onKeepRefs,title:"Keep your references; this banner goes away until the Lookbook changes again"},"Keep mine")),
    !refsOwned && window.LookbookStaleNotice && React.createElement(window.LookbookStaleNotice,{stale:lookbookStale,onApply:onApplyLookbook,label:"this palette",dept:"colorist",
      applyLabel:"Light the film again", applyTitle:"The Colorist proposes a new palette from the updated Lookbook \u2014 for your approval; scenes you set by hand (\u270b) keep their look. Writing credits only, no images."}),
    React.createElement("div",{className:"art-intro"},
      React.createElement("div",{className:"art-intro-row"},
        React.createElement("div",{style:{flex:1}},
          React.createElement("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},
            "Colorist",
            React.createElement(InfoTip,{label:"About the Colorist",
              text:"Your film's own cinematic look system \u2014 each a 60/30/10 colour grade with its own lighting, lens and texture. Click 'Light the film' and the Colorist designs a BESPOKE palette + film stock for this film (from the story and your visual references), color-scripts every scene along the value-charge spine \u2014 so the look tracks the emotional arc \u2014 and PROPOSES it for your approval, showing the swatches and a per-scene 'why' (hover a scene in the film-strip to read it later). Scenes you set by hand (\u270b) keep their look when you light the film again, unless you tick 'Also redo'. Each look can be edited (name, colours, notes) or deleted; the film stock is picked below. Shot frames and the Stage's video renders use each scene's look and the film stock; character sheets and location plates stay neutral on purpose, so the same sheet works in every scene. The previews grade one of the film's own location plates live in the browser (no generation); before any plate exists they use a drawn stand-in. Writing credits only, no images."}))),
        null)),
    !lit && React.createElement("div",{className:"sb-unlit",role:"note"},
      React.createElement(Icon.palette||Icon.sparkles,{s:14}),
      React.createElement("span",null,React.createElement("b",null,"Not lit yet. "),
        "The looks below are examples \u2014 \u201cLight the film\u201d designs this film's own palette and color-scripts every scene (writing credits only, no images). Or edit an example to start your own.")),
    lit && paletteWhy && React.createElement("div",{className:"sb-palette-why"},paletteWhy),
    onSetRefs && React.createElement(StyleRefsField,{value:refs,onCommit:onSetRefs,
      refImages,onAddRefImages,onRemoveRefImage,manualCount,
      onLight:onColorist,lightDisabled:!(scenes||[]).length}),
    // FILM STOCK (2026-10-03, owner): shown and changeable — it's added to every shot prompt
    React.createElement("div",{className:"sb-stock"},
      React.createElement("span",{className:"sb-stock-lab"},"Film stock"),
      onSetFilmStock
        ? React.createElement("select",{className:"prop-select sb-stock-sel",value:stockNow.id,"aria-label":"Film stock",onChange:e=>onSetFilmStock(e.target.value)},
            (window.FILM_STOCKS||[]).map(f=>React.createElement("option",{key:f.id,value:f.id},f.name)))
        : React.createElement("span",{className:"sb-stock-name"},stockNow.name),
      React.createElement("span",{className:"sb-stock-note"}, stockNow.id==="none"
        ? "No film look is added to shots."
        : "Added to every shot prompt: "+String(stockNow.clause||"").replace(/\s+$/,""))),
    React.createElement(StyleFilmStrip,{scenes,project,presets,onSetScenePreset}),
    React.createElement("div",{className:"sb-grid",style:{marginTop:16}},
      presets.map(p=>React.createElement(PresetCard,{key:p.id,preset:p,sceneList:scenesFor(p.id),count:scenesFor(p.id).length,
        img:imgFor(p.id), example:!lit,
        onUpdate:onUpdatePreset ? (patch)=>onUpdatePreset(p.id, patch) : null,
        onDelete:(onDeletePreset && presets.length>1) ? ()=>onDeletePreset(p.id) : null}))));
}
window.StyleBibleView = StyleBibleView;

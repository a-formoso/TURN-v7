/* Character turntables are additional takes, never replacements for a sheet. */
function characterOrbitPoseText(value) {
  return typeof value==="string"?value:String(value?.direction||value?.text||"");
}
function characterOrbitSavedCount(value) {
  return new Set((value?.frames||[]).map(f=>f.index)).size;
}
function CharacterOrbitButton({ character, project, readOnly=false }) {
  const [open,setOpen]=React.useState(false);
  const live=React.useRef({mounted:true,readOnly});
  live.current.readOnly=readOnly;
  React.useEffect(()=>{ live.current.mounted=true; return ()=>{ live.current.mounted=false; }; },[]);
  const canWrite=React.useCallback(()=>live.current.mounted&&!live.current.readOnly,[]);
  return React.createElement(React.Fragment,null,
    React.createElement("button",{
      className:"char-orbit-btn",onClick:()=>setOpen(true),
      title:"Draw a 288-frame character turntable and export images + video",
      "aria-label":"360° orbit for "+(character.name||"character"),
    },"360° orbit"),
    open&&React.createElement(CharacterOrbitModal,{
      key:character.id,character,project,readOnly,canWrite,onClose:()=>setOpen(false),
    }));
}

function CharacterOrbitModal({character,project,readOnly,canWrite,onClose}) {
  const api=window.CharacterOrbit;
  const ownerEpoch=React.useRef(typeof nbEpoch==="function"?nbEpoch():null);
  const ownsFilm=()=>ownerEpoch.current===null||typeof nbEpoch!=="function"||nbEpoch()===ownerEpoch.current;
  const [takes,setTakes]=React.useState([]);
  const [run,setRun]=React.useState(null);
  const [loading,setLoading]=React.useState(true);
  const [busy,setBusy]=React.useState(false);
  const [closing,setClosing]=React.useState(false);
  const [error,setError]=React.useState("");
  const [pose,setPose]=React.useState(()=>characterOrbitPoseText(api.suggestPose(character)));
  const [settings,setSettings]=React.useState(()=>{
    const model=typeof nbGetModel==="function"?nbGetModel():"gpt-image-2.5-flare";
    return {model,quality:typeof nbGetOaiQuality==="function"?nbGetOaiQuality(model):"medium",
      res:typeof nbGetRes==="function"?nbGetRes():"2K",aspect:"9:16"};
  });
  const [capsTick,setCapsTick]=React.useState(0);
  const [frameIndex,setFrameIndex]=React.useState(0);
  const [frameUrl,setFrameUrl]=React.useState("");
  const [frameError,setFrameError]=React.useState("");
  const [exporting,setExporting]=React.useState(false);
  const [exportProgress,setExportProgress]=React.useState(null);
  const [imagePart,setImagePart]=React.useState("all");
  const [download,setDownload]=React.useState(null);
  const [videoUrl,setVideoUrl]=React.useState("");
  const live=React.useRef({mounted:true,run:null,action:false,stopRequested:false});
  live.current.run=run;
  const canWriteForRun=React.useCallback(()=>live.current.mounted&&ownsFilm()&&canWrite(),[canWrite]);
  const cancelExport=React.useRef(false);
  const dialog=React.useRef(null);
  const urls=React.useRef([]);
  const urlFor=blob=>{ const url=URL.createObjectURL(blob); urls.current.push(url); return url; };
  const clearDownloads=()=>{
    setDownload(null);setVideoUrl("");
    urls.current.splice(0).forEach(url=>URL.revokeObjectURL(url));
  };
  function stopRun(id) {
    if(!id||live.current.stopSentTo===id)return;
    // stop() emits a status event itself; mark before calling to avoid a
    // subscribe → stop → subscribe recursion during early cancellation.
    live.current.stopSentTo=id;
    api.stop(id);
  }
  const syncTake=React.useCallback(value=>{
    if(!value||!live.current.mounted||!ownsFilm()||value.characterId!==character.id) return;
    if(live.current.action&&live.current.stopRequested) stopRun(value.id);
    setTakes(old=>[value,...old.filter(t=>t.id!==value.id)].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))));
    if(live.current.action||live.current.run?.id===value.id) setRun(value);
  },[character.id]);
  React.useEffect(()=>{
    live.current.mounted=true;
    let active=true;
    const off=api.subscribe(event=>syncTake(event?.run||event));
    api.list(character.id).then(rows=>{
      if(!active) return;
      setTakes(rows); if(rows.length) setRun(rows[0]);
    }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    const previous=document.activeElement;
    dialog.current?.focus();
    return ()=>{
      active=false; live.current.mounted=false; off();
      if(live.current.action&&live.current.run) stopRun(live.current.run.id);
      cancelExport.current=true;
      urls.current.forEach(url=>URL.revokeObjectURL(url));
      if(previous?.isConnected) previous.focus();
    };
  },[character.id]);
  React.useEffect(()=>{
    if(typeof nbRefreshImageQualityCapabilities!=="function") return;
    let active=true;
    const update=()=>{if(active)setCapsTick(t=>t+1);};
    nbRefreshImageQualityCapabilities().then(update).catch(update);
    window.addEventListener("nb-quality-capabilities",update);
    return ()=>{active=false;window.removeEventListener("nb-quality-capabilities",update);};
  },[settings.model]);
  React.useEffect(()=>{
    let active=true,owned="";
    setFrameUrl(""); setFrameError("");
    if(run?.frames?.some(f=>f.index===frameIndex)){
      api.frame(run,frameIndex).then(src=>{
        if(!active) return;
        if(src instanceof Blob){owned=URL.createObjectURL(src);setFrameUrl(owned);}
        else if(src) setFrameUrl(src);
        else setFrameError("This saved frame could not be loaded.");
      }).catch(e=>{if(active)setFrameError(e.message);});
    }
    return ()=>{active=false;if(owned)URL.revokeObjectURL(owned);};
  },[run?.id,run?.frames?.length,frameIndex]);
  React.useEffect(()=>{setFrameIndex(0);setImagePart("all");clearDownloads();},[run?.id]);
  React.useEffect(()=>{if(closing&&!busy&&!exporting)onClose();},[closing,busy,exporting]);

  const close=()=>{
    if(busy||exporting){
      live.current.stopRequested=true;
      if(run) stopRun(run.id);
      cancelExport.current=true;
      setClosing(true);
    }else onClose();
  };
  const onKeyDown=e=>{
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}
    if(e.key==="Tab"){
      const nodes=[...dialog.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),video[controls]')];
      const first=nodes[0],last=nodes[nodes.length-1];
      if(!first){e.preventDefault();return;}
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  };
  const locked=busy||exporting||loading||!!run||readOnly||!ownsFilm();
  const chosen=run?.settings||settings;
  const modelList=typeof NB_MODELS!=="undefined"?NB_MODELS:[{id:settings.model,label:settings.model}];
  const modelName=modelList.find(m=>m.id===chosen.model)?.label||chosen.model;
  const gpt=typeof isGptImageModel==="function"&&isGptImageModel(settings.model);
  const qualityChoices=typeof nbOaiQualityChoices==="function"?nbOaiQualityChoices(settings.model):["low","medium","high"];
  const qualityOK=!gpt||typeof nbCanUseImageQuality!=="function"||nbCanUseImageQuality(settings.model,settings.quality);
  const capMessage=gpt&&typeof nbImageQualitySupport==="function"?nbImageQualitySupport(settings.model).message:"";
  const completed=characterOrbitSavedCount(run);
  const needsPreview=completed===0;
  const remaining=288-completed;
  const totalQuote=api.quote(chosen,288);
  const remainingQuote=remaining?api.quote(chosen,remaining):{credits:0};
  const previewQuote=api.quote(chosen,1);
  const creditText=q=>Number.isFinite(q?.credits)?"≈ "+Math.ceil(q.credits).toLocaleString()+" credits":"Estimate unavailable";
  const availableFrames=(run?.frames||[]).map(f=>f.index).sort((a,b)=>a-b);
  const imageParts=[...new Set(availableFrames.map(i=>Math.floor(i/12)))];
  const position=availableFrames.indexOf(frameIndex);
  const full=completed===288;
  const support=window.CharacterOrbitExport.support();
  const canStart=ownsFilm()&&!readOnly&&!loading&&!busy&&!exporting&&qualityOK&&pose.trim()&&Number.isFinite(totalQuote?.credits);

  const render=async()=>{
    if(!canStart||!canWriteForRun()||live.current.action) return;
    // Freeze confirmation and submission together; later dock/canon edits cannot
    // change what the user agreed to buy.
    const snapshot={character:JSON.parse(JSON.stringify(character)),project:JSON.parse(JSON.stringify(project||{})),
      pose:String(pose),settings:{...settings}};
    const existing=run;
    const count=needsPreview?1:remaining;
    const estimate=needsPreview?previewQuote:remainingQuote;
    live.current.action=true;live.current.stopRequested=false;live.current.stopSentTo=null;
    setBusy(true);setError("");clearDownloads();
    try{
      const agreed=await window.appConfirm({
        title:needsPreview?"Draw the first pose frame?":"Draw "+count+" remaining orbit frames?",
        body:!needsPreview
          ?"Keep the exact pose, identity and outfit from frame 1 while drawing every remaining camera angle. "
            +creditText(estimate)+". This is a baseline estimate, not a fixed provider quote. "
            +"An interrupted request may already have been charged without saving an image; resuming can charge again for that missing frame. "
            +"Keep this tab visible. Stop finishes and saves the current frame before pausing."
          :"Draw 1 of 288 frames for "+(character.name||"this character")+" to review the pose. "
            +creditText(estimate)+" for this first frame; "+creditText(totalQuote)+" for the full sequence at these settings. "
            +"These are baseline estimates, not fixed quotes. The other 287 frames only start after your approval. Existing artwork is kept."
            +(existing?" If an earlier preview request was interrupted, it may already have been charged; retrying that missing image can charge again.":""),
        confirmLabel:needsPreview?"Draw pose preview":"Draw "+count+" frames",cancelLabel:"Not now",
      });
      if(agreed!==true||!canWriteForRun()||live.current.stopRequested) return;
      const result=existing
        ?await api.resume(existing.id,{canWrite:canWriteForRun,confirmed:!needsPreview,
          acknowledgeUncertain:true,retryFailed:true})
        :await api.create({...snapshot,canWrite:canWriteForRun});
      if(live.current.mounted&&result){setRun(result);syncTake(result);}
    }catch(e){if(live.current.mounted)setError(e.message||"Orbit generation stopped.");}
    finally{live.current.action=false;if(live.current.mounted)setBusy(false);}
  };
  const exportRun=async kind=>{
    if(!run||busy||exporting||!completed||!ownsFilm())return;
    const source=run;
    cancelExport.current=false;
    setExporting(true);setExportProgress(null);setError("");clearDownloads();
    try{
      const partStart=Number(imagePart)*12;
      const partFrames=kind==="frames"&&imagePart!=="all"
        ?source.frames.filter(f=>f.index>=partStart&&f.index<partStart+12):null;
      const exportSource=partFrames?{...source,frames:partFrames,completed:partFrames.length,complete:false}:source;
      const result=await window.CharacterOrbitExport.export(exportSource,{
        kind,loadFrame:i=>api.frame(source,i),
        shouldCancel:()=>cancelExport.current||!live.current.mounted||!ownsFilm(),
        onProgress:p=>{if(live.current.mounted)setExportProgress(p);},
      });
      if(cancelExport.current||!live.current.mounted)return;
      if(partFrames)result.filename=result.filename.replace(/\.zip$/i,
        "-part-"+String(Number(imagePart)+1).padStart(2,"0")+".zip");
      const url=urlFor(result.blob);
      setDownload({...result,url});
      if(kind==="video")setVideoUrl(url);
    }catch(e){if(live.current.mounted)setError(e.message||"Export could not be completed.");}
    finally{if(live.current.mounted){setExporting(false);setExportProgress(null);}}
  };
  const newTake=()=>{
    setRun(null);setError("");setFrameIndex(0);setDownload(null);setVideoUrl("");
    setPose(characterOrbitPoseText(api.suggestPose(character)));
  };
  const changeModel=model=>setSettings(s=>({...s,model,quality:typeof nbGetOaiQuality==="function"?nbGetOaiQuality(model):"medium"}));
  const h=React.createElement;
  return ReactDOM.createPortal(
    h("div",{className:"orbit-overlay",onMouseDown:e=>{if(e.target===e.currentTarget)close();}},
      h("section",{className:"orbit-modal",role:"dialog","aria-modal":true,"aria-labelledby":"orbit-title",
        tabIndex:-1,ref:dialog,onKeyDown},
        h("header",{className:"orbit-header"},
          h("div",null,h("div",{className:"orbit-eyebrow"},"CHARACTER STUDY"),
            h("h2",{id:"orbit-title"},character.name+" · 360° orbit"),
            h("p",null,"288 frames · 1.25° per view · 12 seconds at 24 fps")),
          h("button",{className:"orbit-close",onClick:close,"aria-label":busy?"Stop and close orbit":"Close orbit"},"×")),
        h("div",{className:"orbit-content"},
          h("div",{className:"orbit-visual"},
            h("div",{className:"orbit-preview"},
              videoUrl?h("video",{src:videoUrl,controls:true,loop:true,playsInline:true,"aria-label":"Assembled character orbit"}):
              frameUrl?h("img",{src:frameUrl,alt:character.name+", orbit frame "+(frameIndex+1)+" at "+api.angle(frameIndex)+"°"}):
              h("div",{className:"orbit-placeholder"},
                h("div",{className:"orbit-ring","aria-hidden":true},"360°"),
                h("strong",null,completed?"Loading saved frame…":"One pose. Every angle."),
                h("p",null,"Review the first frame, then draw the full orbit.")),
              !videoUrl&&completed>0&&h("span",{className:"orbit-angle"},api.angle(frameIndex)+"°")),
            frameError&&h("p",{className:"orbit-error",role:"alert"},frameError),
            !videoUrl&&completed>0&&h("div",{className:"orbit-scrubber"},
              h("button",{disabled:position<=0,onClick:()=>setFrameIndex(availableFrames[position-1]),"aria-label":"Previous orbit frame"},"‹"),
              h("input",{type:"range",min:0,max:Math.max(0,availableFrames.length-1),value:Math.max(0,position),
                "aria-label":"Orbit frame","aria-valuetext":"Frame "+(frameIndex+1)+" at "+api.angle(frameIndex)+" degrees",
                onChange:e=>setFrameIndex(availableFrames[Number(e.target.value)])}),
              h("button",{disabled:position<0||position===availableFrames.length-1,
                onClick:()=>setFrameIndex(availableFrames[position+1]),"aria-label":"Next orbit frame"},"›")),
            completed>0&&h("p",{className:"orbit-caption"},videoUrl?"Assembled playback":"Frame "+(frameIndex+1)+" · "+completed+" of 288 saved"),
            h("p",{className:"orbit-note"},"AI-drawn views, not a 3D model. Check for identity or pose drift before using the sequence.")),
          h("div",{className:"orbit-controls"},
            takes.length>0&&h("div",{className:"orbit-takes"},
              h("label",null,"Saved orbit",
                h("select",{"aria-label":"Saved orbit",value:run?.id||"",disabled:busy||exporting||loading,
                  onChange:e=>{setRun(takes.find(t=>t.id===e.target.value)||null);setError("");}},
                  h("option",{value:""},"New orbit"),
                  takes.map((t,i)=>h("option",{key:t.id,value:t.id},
                    "Take "+(takes.length-i)+" · "+characterOrbitSavedCount(t)+"/288 · "+new Date(t.createdAt).toLocaleDateString())))),
              h("button",{onClick:newTake,disabled:busy||exporting||readOnly,className:"orbit-secondary"},"New take")),
            h("label",{className:"orbit-field"},"Personality pose",
              h("textarea",{value:run?characterOrbitPoseText(run.pose):pose,disabled:locked,rows:5,
                onChange:e=>setPose(e.target.value),"aria-label":"Personality pose"})),
            h("p",{className:"orbit-note"},run
              ?"The pose and render settings are locked to this take. Start a new take to change them."
              :"A suggested direction from the character’s notes. Refine it here; the first frame establishes the exact pose. No animation or changing gestures."),
            !run?h("div",{className:"orbit-settings"},
              h("label",null,"Image model",h("select",{value:settings.model,disabled:locked,
                onChange:e=>changeModel(e.target.value)},modelList.map(m=>h("option",{key:m.id,value:m.id},m.label)))),
              h("label",null,"Resolution",h("select",{value:settings.res,disabled:locked,
                onChange:e=>setSettings(s=>({...s,res:e.target.value}))},["1K","2K","4K"].map(r=>h("option",{key:r},r)))),
              h("label",null,"Frame shape",h("select",{value:settings.aspect,disabled:locked,
                onChange:e=>setSettings(s=>({...s,aspect:e.target.value}))},["9:16","3:4","1:1","16:9"].map(r=>h("option",{key:r},r)))),
              gpt&&h("label",null,"Quality",h("select",{value:settings.quality,disabled:locked,
                onChange:e=>setSettings(s=>({...s,quality:e.target.value}))},qualityChoices.map(q=>h("option",{key:q,value:q,
                  disabled:typeof nbCanUseImageQuality==="function"&&!nbCanUseImageQuality(settings.model,q)},
                  typeof nbOaiQualityLabel==="function"?nbOaiQualityLabel(q):q))))):
              h("div",{className:"orbit-settings-summary"},modelName+" · "+chosen.res+" · "+chosen.aspect+
                (chosen.quality?" · "+chosen.quality:"")),
            !run&&capMessage&&h("div",{className:"orbit-note"},capMessage," ",
              h("button",{className:"orbit-link",disabled:busy,onClick:async()=>{
                try{await nbRefreshImageQualityCapabilities({force:true});setCapsTick(t=>t+1);}catch(e){setError(e.message);}
              }},"Retry availability")),
            h("div",{className:"orbit-cost"},
              h("strong",null,creditText(run?(needsPreview?previewQuote:remainingQuote):totalQuote)),
              h("span",null,run?(needsPreview?"Pose preview · 1 frame":remaining+" frames remaining"):"Full 288-frame baseline estimate"),
              run&&needsPreview&&h("small",null,"Full 288-frame baseline estimate: "+creditText(totalQuote)),
              h("small",null,"Actual provider costs vary. No charge to view or export saved frames.")),
            h("div",{className:"orbit-progress","aria-live":"polite"},
              h("div",null,h("strong",null,completed+" / 288")," frames saved",
                h("span",null,full?"Complete":busy?"Drawing…":run?(needsPreview?"Preview not drawn":"Paused for review"):"Ready to start")),
              h("progress",{value:completed,max:288,"aria-label":"Orbit frames saved"})),
            !ownsFilm()&&h("div",{className:"orbit-error",role:"alert"},"The active film changed. Close this panel and reopen an orbit in that film."),
            (error||run?.error)&&h("div",{className:"orbit-error",role:"alert"},error||run.error),
            loading&&h("p",{role:"status"},"Loading saved orbits…"),
            busy?h("button",{className:"orbit-primary",onClick:()=>{
              live.current.stopRequested=true;if(run)stopRun(run.id);setClosing(false);
            }},
              "Stop after current frame"):
              !full&&h("button",{className:"orbit-primary",disabled:!canStart,onClick:render},
                needsPreview?(run?"Retry pose preview · 1 frame":"Draw pose preview · 1 frame"):
                  completed===1?"Approve pose & draw 287 frames":"Resume · "+remaining+" frames"),
            h("p",{className:"orbit-note"},"Use a saved character sheet as the identity reference. Keep this tab visible during drawing and video export. Leaving pauses the run; saved frames remain available."),
            h("div",{className:"orbit-export"},
              h("h3",null,"Export"),
              completed>12&&h("label",null,"PNG images to include",
                h("select",{value:imagePart,disabled:busy||exporting,
                  onChange:e=>setImagePart(e.target.value),"aria-label":"PNG images to include"},
                  h("option",{value:"all"},"All "+completed+" saved frames"),
                  imageParts.map(part=>h("option",{key:part,value:String(part)},
                    "Part "+(part+1)+" · frames "+(part*12+1)+"–"+Math.min(part*12+12,availableFrames.at(-1)+1))))),
              h("div",{className:"orbit-export-buttons"},
                h("button",{disabled:!completed||busy||exporting,onClick:()=>exportRun("frames")},
                  full?"Images ZIP":"Images ZIP"+(completed?" · "+completed+" saved":"")),
                h("button",{disabled:!full||busy||exporting||!support.video,onClick:()=>exportRun("video")},"Video"),
                h("button",{disabled:!full||busy||exporting||!support.video||imagePart!=="all",
                  title:imagePart!=="all"?"Choose all frames for a combined ZIP":undefined,
                  onClick:()=>exportRun("bundle")},"Images + video")),
              h("p",{className:"orbit-note"},support.video
                ?"Numbered PNGs + angle manifest. Video is "+(support.videoMime?.includes("mp4")?"MP4":"WebM")+
                  " at 24 fps (up to 1080px). All 288 frames are needed for video. For large files or limited phone memory, export the PNGs in 12-frame parts—no new renders needed."
                :"Video export is unavailable in this browser. You can export the images, or open this film in a supported Safari/Chrome browser to assemble the video."),
              exporting&&h("div",{className:"orbit-export-progress",role:"status"},
                h("span",null,exportProgress?exportProgress.phase+" · "+exportProgress.done+" / "+exportProgress.total:"Preparing export…"),
                h("button",{onClick:()=>{cancelExport.current=true;}},"Cancel export")),
              download&&h("div",{className:"orbit-download"},
                h("a",{href:download.url,download:download.filename},"Download "+download.filename),
                typeof navigator.share==="function"&&h("button",{onClick:async()=>{
                  try{
                    const file=new File([download.blob],download.filename,{type:download.mime});
                    if(!navigator.canShare?.({files:[file]}))throw new Error("File sharing is unavailable here. Use Download instead.");
                    await navigator.share({files:[file],title:character.name+" · 360° orbit"});
                  }catch(e){if(e.name!=="AbortError")setError(e.message);}
                }},"Share / Save to Files"))),
            closing&&h("p",{role:"status",className:"orbit-note"},"Stopping safely before closing…"))))),
    document.body);
}
window.CharacterOrbitButton=CharacterOrbitButton;
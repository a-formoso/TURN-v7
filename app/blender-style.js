/* Reviewed image styling for the local cloud-set pilot. Geometry stays authoritative. */
(function(root){
  "use strict";
  const active=new Set(),memory=new Map(),unsaved=new Map(),PANELS=["TL","TR","BL","BR"];
  const enabled=()=>!!root.KinolotCloudRender?.enabled();
  const slot=id=>"cloud-set-style-"+String(id);
  const key=(s,id)=>["kinolot-style-request",s.uid,s.projectId,id].join(":");
  function pending(s,id){
    const k=key(s,id);let value=memory.get(k)||null;
    try{value=JSON.parse(root.localStorage.getItem(k)||"null")||value;}catch(_){}
    if(unsaved.get(k)?.scope.epoch!==s.epoch)unsaved.delete(k);
    return value?{...value,active:active.has(k),hasUnsaved:unsaved.has(k)}:null;
  }
  function marker(s,id,value){
    const k=key(s,id);value?memory.set(k,value):memory.delete(k);
    try{value?root.localStorage.setItem(k,JSON.stringify(value)):root.localStorage.removeItem(k);}catch(_){}
  }
  function announce(id,saved=false){root.dispatchEvent?.(new CustomEvent("kinolot-style-changed",{detail:{id,saved}}));}
  function assertScope(s){
    if(!enabled()||!root.BlenderPreview.isCurrent(s))throw Error("The open film or sign-in changed. Reopen the style preview.");
    if(typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw Error("This film is read-only.");
  }
  function live(id){
    const l=(root.turnContinuity?.locations||[]).find(l=>l.id===id);
    if(!l)throw Error("This location is no longer in the film.");return l;
  }
  function appearance(l){
    const visual=root.locVisualDefaults(l);
    return {name:l.name||"Location",materials:l.materials||"",lighting:l.lighting||"",style:visual.renderStyle||"",
      exclusions:l.negativePrompt||"",lookbook:["locations","colorist"].map(d=>root.turnLookbookBriefFor?.(d)||"").join("\n")};
  }
  const briefKey=l=>root.KinolotRenderContract.canonical(appearance(l));
  const sceneKey=l=>root.KinolotRenderContract.canonical(root.KinolotCloudRender.buildScene(l));
  function version(details){
    const exists=!!details?.url,iso=details?.meta?.iso||"";
    if(exists&&!iso)throw Error("The existing artwork version could not be verified. Refresh before styling.");
    return {exists,iso};
  }
  async function details(id,s){
    assertScope(s);
    const record=await root.nbLoadDetailsAsset(id,"");assertScope(s);return record;
  }
  function settings(){
    const choice=root.nbPlanImageChoice(root.nbGetModel(),root.nbGetRes()),model=choice.model;
    const quality=root.isGptImageModel(model)?root.nbGetOaiQuality(model):undefined;
    const credits=root.nbImageCostText(1,{model,res:choice.res,quality,aspect:"16:9",refs:1,ground:false});
    return {model,imageSize:choice.res,quality,aspectRatio:"16:9",credits};
  }
  function prompt(l,notes=""){
    const a=appearance(l);
    return "Create a finished surface treatment over Image 1, the exact 2x2 Blender camera grid of "+a.name+". "
      +"Preserve the equal four panels, exact framing, perspectives, silhouettes, wall openings, fixtures and all markings. "
      +"Each panel is a different camera of one shared set. Change materials, surface finish and atmosphere only. "
      +"Do not add, move, resize or remove objects. Keep every light fitting at its source position; do not invent visible lamps. "
      +"Keep doors and ramps in their exact source state. Keep arrow directions, lane edges, beam spacing and cabinet proportions. "
      +"No new people, vehicles, furnishings, doors, windows, signs, captions, borders or panel labels. "
      +"Use consistent materials and restrained wear across the four views. Source geometry takes priority over any conflicting style words.\n"
      +"MATERIALS: "+a.materials+"\nLIGHT: "+a.lighting+"\nRENDER STYLE: "+a.style
      +"\nLOOKBOOK: "+a.lookbook+"\nEXCLUSIONS: "+a.exclusions
      +(notes.trim()?"\nSURFACE NOTES (never change geometry): "+notes.trim().slice(0,1000):"");
  }
  function image(src){return new Promise((resolve,reject)=>{
    const im=new root.Image(),timer=setTimeout(()=>{im.src="";reject(Error("A comparison image took too long to load. Refresh the preview."));},20000);
    if(/^https?:/i.test(src))im.crossOrigin="anonymous";
    im.onload=()=>{clearTimeout(timer);resolve(im);};im.onerror=()=>{clearTimeout(timer);reject(Error("A comparison image could not be loaded. Refresh the preview."));};im.src=src;
  });}
  async function compose(job){
    if(job?.status!=="completed"||!job.result?.images)throw Error("Complete the four Blender views first.");
    const images=await Promise.all(PANELS.map(p=>{
      const url=job.result.images["colour_"+p];if(!url)throw Error("All four Blender views are required.");return image(url);
    }));
    const w=images[0].naturalWidth,h=images[0].naturalHeight;
    if(!w||!h||w>2048||h>2048||Math.abs(w/h-16/9)>.01||images.some(i=>i.naturalWidth!==w||i.naturalHeight!==h))
      throw Error("The Blender camera views have incompatible dimensions.");
    const canvas=root.document.createElement("canvas");canvas.width=w*2;canvas.height=h*2;
    const ctx=canvas.getContext("2d");images.forEach((im,i)=>ctx.drawImage(im,(i%2)*w,Math.floor(i/2)*h));
    return canvas.toDataURL("image/png");
  }
  function verify(meta,id,s){
    if(meta?.kind!=="cloud-set-style-draft"||meta.schema!==1||meta.projectId!==s.projectId||meta.locationId!==id||!meta.iso)
      throw Error("This style draft does not belong to the open location.");
  }
  async function load(id,s){
    const d=await details(slot(id),s);if(!d?.url)return null;verify(d.meta,id,s);
    const reference=d.refs?.find(r=>r.kind==="blender-style-source");
    if(reference?.deleted)throw Error("This draft's comparison source was removed. Generate a new draft before reviewing.");
    let source=reference?.url||"";
    if(!source){
      const old=await root.KinolotCloudRender.request("job.get",{projectId:s.projectId,jobId:d.meta.sourceJobId},s);
      if(old.job?.sceneHash!==d.meta.sceneHash||old.job?.locationId!==id)throw Error("The Blender comparison source could not be verified.");
      source=await compose(old.job);assertScope(s);
    }
    return {...d,source};
  }
  async function locked(id,s,fn){
    assertScope(s);const k=key(s,id);if(active.has(k))throw Error("A style request for this location is already in progress.");
    active.add(k);announce(id);
    try{return await fn();}finally{active.delete(k);announce(id);}
  }
  async function generate(id,job,s,options={}){return locked(id,s,async()=>{
    if(pending(s,id)&&!options.retryConfirmed)throw Error("An earlier image request may still finish. Check its usage before starting another paid request.");
    let l=live(id),revision=sceneKey(l),brief=briefKey(l);
    const guard=()=>{try{assertScope(s);return sceneKey(live(id))===revision&&briefKey(live(id))===brief;}catch(_){return false;}};
    const assert=()=>{if(!guard())throw Error("The layout or style brief changed. This draft was not adopted; check usage before retrying.");};
    await root.KinolotCloudRender.request("capabilities",{projectId:s.projectId},s);assert();
    const original=await root.KinolotCloudRender.request("job.get",{projectId:s.projectId,jobId:job?.id},s);assert();
    const hash=await root.KinolotRenderContract.hash(revision);assert();
    if(original.job?.status!=="completed"||original.job.locationId!==id||original.job.sceneHash!==hash)
      throw Error("Build the current floor plan before generating a style draft.");
    const base=version(await details(id,s));assert();
    const grid=await compose(original.job);assert();
    const choice=options.settings||settings();if(!(Number(choice.credits)>0))throw Error("The image estimate is unavailable. Refresh before generating.");
    const text=prompt(l,options.notes||""),metaOut={};
    const record={requestId:root.crypto.randomUUID(),startedAt:new Date().toISOString(),phase:"generating"};
    marker(s,id,record);announce(id);
    try{
      const url=await root.nbGenerate(text,{model:choice.model,imageSize:choice.imageSize,quality:choice.quality,aspectRatio:"16:9",
        referenceImage:grid,baseMaxDim:1536,referenceMaxDim:1536,referencesNumbered:true,groundSearch:false,noRetry:true,
        projectId:s.projectId,assetId:slot(id),assetPurpose:"cloud-set-style",metaOut,beforeSubmit:async()=>{
          assert();await root.KinolotCloudRender.request("capabilities",{projectId:s.projectId},s);assert();
          const latest=version(await details(id,s));assert();
          if(latest.exists!==base.exists||latest.iso!==base.iso)throw Error("The location artwork changed before generation. Refresh before starting another request.");
        }});
      assert();
      const meta={schema:1,kind:"cloud-set-style-draft",projectId:s.projectId,locationId:id,sourceJobId:original.job.id,
        sceneHash:hash,briefKey:brief,baseArtwork:base,prompt:text,modelId:choice.model,
        modelLabel:root.nbModelLabel(choice.model),quality:choice.quality,size:metaOut.imageSize||choice.imageSize,aspect:"16:9",
        mode:"draft",iso:new Date().toISOString(),notes:String(options.notes||"").slice(0,1000),
        platePanels:root.locationPlatePanelRecord?.(l),plateLayoutSig:root.locationPlateLayoutSig?.(l,{panels:true}),
        spatialPlanSig:root.locationSpatialPlanSigFor?.(l),locSpecSig:root.locationSpecSig?.(l)};
      const refs=[{kind:"blender-style-source",label:"Exact Blender camera grid",url:grid}];
      unsaved.set(key(s,id),{url,meta,refs,source:grid,scope:s,revision,brief});
      const saved=await root.nbCommit(slot(id),url,meta,refs,"location",s.epoch,()=>!guard());
      assert();if(saved?.tier!=="cloud")throw Error("The style draft save was not confirmed. Refresh drafts before generating again.");
      unsaved.delete(key(s,id));marker(s,id,null);announce(id,true);return {url:saved.url||url,meta,refs,source:grid};
    }catch(e){marker(s,id,{...record,phase:"uncertain"});throw e;}
  });}
  async function retrySave(id,s){return locked(id,s,async()=>{
    const entry=unsaved.get(key(s,id));
    if(!entry||entry.scope.epoch!==s.epoch)throw Error("The unsaved pixels are no longer in this session. Refresh drafts and check usage before generating again.");
    const guard=()=>{try{assertScope(s);return sceneKey(live(id))===entry.revision&&briefKey(live(id))===entry.brief;}catch(_){return false;}};
    if(!guard())throw Error("The location changed. These unsaved pixels cannot be adopted.");
    await root.KinolotCloudRender.request("capabilities",{projectId:s.projectId},s);
    const current=await details(slot(id),s);let result;
    if(current?.meta?.iso===entry.meta.iso)result=await load(id,s);
    else{
      if(current?.meta?.iso>entry.meta.iso)throw Error("A newer draft was saved. Refresh drafts before continuing.");
      const saved=await root.nbCommit(slot(id),entry.url,entry.meta,entry.refs,"location",s.epoch,()=>!guard());
      if(saved?.tier!=="cloud")throw Error("The draft still could not be saved. No new image was generated.");
      result={...entry,url:saved.url||entry.url};
    }
    assertScope(s);unsaved.delete(key(s,id));marker(s,id,null);announce(id,true);return result;
  });}
  async function reject(id,draft,s){return locked(id,s,async()=>{
    const current=await details(slot(id),s);verify(current.meta,id,s);
    if(current.meta.iso!==draft.meta.iso)throw Error("A newer draft is available. Reopen the review.");
    if(current.meta.approval&&current.meta.approval.iso===current.meta.iso&&current.meta.approval.approved)
      throw Error("This draft has already been used. Review the current location artwork.");
    const result=await root.nbSetAssetApproval(slot(id),draft.meta.iso,false,"cloud-set-style-rejected");assertScope(s);
    if(!result?.ok)throw Error(result?.error||"The rejection could not be saved.");announce(id,true);return result;
  });}
  async function accept(id,draft,s,reviewed){return locked(id,s,async()=>{
    if(reviewed!==true)throw Error("Review all four views against Blender before using this artwork.");
    const current=await load(id,s);if(!current)throw Error("The draft is no longer available.");
    if(current.meta.iso!==draft.meta.iso)throw Error("A newer draft is available. Reopen the review.");
    const meta=current.meta,approval=meta.approval;
    if(approval&&approval.iso===meta.iso&&!approval.approved)throw Error("This draft was rejected. Generate a new draft.");
    const revision=sceneKey(live(id)),brief=meta.briefKey;
    if(await root.KinolotRenderContract.hash(revision)!==meta.sceneHash)throw Error("The layout changed. Generate a current draft before accepting.");
    const guard=()=>{try{assertScope(s);return sceneKey(live(id))===revision&&briefKey(live(id))===brief;}catch(_){return false;}};
    if(!guard())throw Error("The layout or style brief changed. Generate a current draft before accepting.");
    await root.KinolotCloudRender.request("capabilities",{projectId:s.projectId},s);
    if(!guard())throw Error("The location changed while its review was open.");
    const target=await details(id,s);
    if(target.meta?.styleDraftIso===meta.iso)return {url:target.url,alreadyAccepted:true};
    if(approval&&approval.iso===meta.iso&&approval.approved)throw Error("This draft has already been used. Review the current location artwork.");
    const expected=meta.baseArtwork,now=version(target);
    if(!expected||now.exists!==expected.exists||now.iso!==expected.iso)throw Error("The location artwork changed. Keep that version or generate a new style draft.");
    const outputMeta={...meta,kind:"location",mode:"final",iso:new Date().toISOString(),styleDraftIso:meta.iso,
      styleReview:{reviewedAt:new Date().toISOString(),sourceJobId:meta.sourceJobId,sceneHash:meta.sceneHash},version:(Number(target.meta?.version)||0)+1};
    delete outputMeta.approval;
    const saved=await root.nbCommit(id,current.url,outputMeta,[{kind:"blender-style-source",label:"Reviewed Blender camera grid",url:current.source}],
      "location",s.epoch,()=>!guard(),expected);
    if(saved?.tier!=="cloud")throw Error(saved?.error||"The artwork save was not confirmed. Refresh before trying acceptance again.");
    assertScope(s);
    root.dispatchEvent?.(new CustomEvent("nb-gen-done",{detail:{id,url:saved.url}}));
    const recorded=await root.nbSetAssetApproval(slot(id),meta.iso,true,"cloud-set-style-accepted");
    announce(id,true);return {...saved,reviewRecorded:!!recorded?.ok};
  });}
  root.KinolotSetStyle={enabled,slot,pending,settings,appearance,briefKey,sceneKey,prompt,compose,load,generate,retrySave,accept,reject};
})(typeof window!=="undefined"?window:globalThis);

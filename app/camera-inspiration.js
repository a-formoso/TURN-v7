/* Optional text-to-image view ideas. Never a location plate, layout input, camera assignment or Blender reference. */
(function(root){
  "use strict";
  const ENGINES=["gemini-nano-banana-2.1","gpt-image-2.6-sunburst"],active=new Set(),unsaved=new Map(),memory=new Map();
  function slot(id){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(String(id)))throw Error("Invalid location identity.");return "camera-ideas-"+id;}
  const key=(s,id)=>["kinolot-camera-ideas",s.uid,s.projectId,slot(id)].join(":");
  function assertScope(s,write=false){
    if(!s?.uid||!s.projectId||!root.BlenderPreview?.isCurrent(s))throw Error("The open film or sign-in changed. Reopen camera ideas.");
    if(write&&typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw Error("This film is read-only.");
  }
  function live(id){const l=(root.turnContinuity?.locations||[]).find(x=>x.id===id);if(!l)throw Error("This location is no longer in the film.");return l;}
  function input(id){
    const l=live(id),list=root.turnContinuity?.locations||[],st=root.locationSpatialPlanState(l,list);
    if(!st.ready)throw Error("Confirm the floor plan in step 2 before generating camera ideas.");
    const visual=root.locVisualDefaults(l),plan=st.plan;
    if(!(plan.coordinates?.spaces||[]).some(s=>s.id===id&&s.footprint?.length>=3))throw Error("Add this location's room footprint in step 2 before generating camera ideas.");
    // Deliberately omit images, coverageViews, measured camera poses, and generation history.
    return {targetRoomId:id,name:l.name||"Location",architecture:l.architecture||"",materials:l.materials||"",lighting:l.lighting||"",
      fixtures:l.fixtures||"",continuityAnchors:l.continuityAnchors||"",topology:l.topology||"",exclusions:l.negativePrompt||"",
      style:visual.renderStyle||"",lookbook:root.turnLookbookBriefFor?.("locations")||"",
      floorPlan:{frame:plan.frame,heights:plan.heights,anchors:plan.anchors,spaces:plan.coordinates?.spaces||[]}};
  }
  const inputKey=id=>root.KinolotRenderContract.canonical(input(id));
  function settings(engine){
    if(!ENGINES.includes(engine))throw Error("Choose an available image engine.");
    const choice=root.nbPlanImageChoice(engine,root.nbGetRes()),model=choice.model;
    if(!ENGINES.includes(model))throw Error("Your current plan does not include these camera-ideas engines.");
    const quality=root.isGptImageModel(model)?"high":undefined;
    return {model,imageSize:choice.res,quality,credits:root.nbImageCostText(1,{model,res:choice.res,quality,aspect:"16:9",refs:0,ground:false})};
  }
  function prompt(data){
    return "Create a camera-composition inspiration sheet for this written location brief. Produce exactly four equal 16:9 views in a regular 2x2 grid, overall 16:9, with thin dividers and no text, labels, captions or people. "
      +"All four panels show the same fixed place, furniture counts, fixtures and openings. Top left: a useful establishing wide view. Top right: a complementary reverse view. Bottom left: a clear view of an important activity area. Bottom right: a different useful feature or furniture detail. "
      +"Choose unobstructed viewpoints appropriate to the requested targetRoomId; other rooms are context through openings, not replacement subjects. For a long narrow interior favour views along its length. Respect the supplied layout and render style while exploring compositions. "
      +"This is an illustrative idea sheet, not a measured reconstruction or a Blender render. Location brief and floor plan:\n"+JSON.stringify(data);
  }
  function pending(s,id){
    const k=key(s,id);let p=memory.get(k)||null;try{p=JSON.parse(root.localStorage.getItem(k)||"null")||p;}catch(_){}
    const saved=unsaved.get(k);
    return p?{...p,active:active.has(k),hasUnsaved:!!saved&&saved.scope.epoch===s.epoch}:null;
  }
  function mark(s,id,value){const k=key(s,id);value?memory.set(k,value):memory.delete(k);try{value?root.localStorage.setItem(k,JSON.stringify(value)):root.localStorage.removeItem(k);}catch(_){}}
  function announce(id){root.dispatchEvent?.(new CustomEvent("kinolot-camera-ideas-changed",{detail:{id}}));}
  function verify(meta,id,s){if(meta?.kind!=="camera-inspiration"||meta.schema!==1||meta.projectId!==s.projectId||meta.locationId!==id||!meta.iso||meta.inspirationOnly!==true)throw Error("This saved image is not a camera-ideas draft for this location.");}
  async function load(id,s){
    assertScope(s);const d=await root.nbLoadDetailsAsset(slot(id),"");assertScope(s);if(!d?.url)return null;
    verify(d.meta,id,s);let stale=true;try{stale=d.meta.inputKey!==inputKey(id);}catch(_){}
    return {url:d.url,meta:d.meta,stale};
  }
  async function locked(id,s,fn){
    assertScope(s,true);const k=key(s,id);if(active.has(k))throw Error("Camera ideas are already being generated for this location.");
    active.add(k);announce(id);try{return await fn(k);}finally{active.delete(k);announce(id);}
  }
  async function save(id,s,entry){
    const guard=()=>{try{assertScope(s,true);return inputKey(id)===entry.meta.inputKey;}catch(_){return false;}};
    if(!guard())throw Error("The location changed while the ideas were generated. Check usage before generating again.");
    const saved=await root.nbCommit(slot(id),entry.url,entry.meta,[],"location",s.epoch,()=>!guard());
    assertScope(s,true);if(!guard()||saved?.tier!=="cloud")throw Error("The camera-ideas save was not confirmed. Retry saving without generating again.");
    unsaved.delete(key(s,id));mark(s,id,null);announce(id);return {url:saved.url||entry.url,meta:entry.meta,stale:false};
  }
  async function generate(id,s,options={}){return locked(id,s,async k=>{
    const prior=pending(s,id);if(prior?.hasUnsaved)throw Error("Retry saving the completed ideas before generating another image.");
    if(prior&&!options.retryConfirmed)throw Error("An earlier image request may still finish. Check usage before starting another paid request.");
    const data=input(id),stamp=inputKey(id),choice=settings(options.engine||ENGINES[0]);
    if(!(Number(choice.credits)>0))throw Error("The image price is unavailable. Refresh before generating.");
    const text=prompt(data),limit=root.turnImagePromptMaxChars?.(choice.model)||31500;
    if(text.length>limit)throw Error("The location description is too long to send intact. Shorten it before generating view ideas.");
    const guard=()=>{assertScope(s,true);if(inputKey(id)!==stamp)throw Error("The floor plan or description changed. Reopen camera ideas before generating.");};
    const record={requestId:root.crypto.randomUUID(),startedAt:new Date().toISOString(),phase:"generating"};mark(s,id,record);
    try{
      options.onPhase?.("generating");const metaOut={};
      const url=await root.nbGenerate(text,{model:choice.model,imageSize:choice.imageSize,quality:choice.quality,aspectRatio:"16:9",
        groundSearch:false,noRetry:true,projectId:s.projectId,assetId:slot(id),assetPurpose:"camera-inspiration",metaOut,beforeSubmit:guard});
      guard();
      const entry={url,scope:{...s},meta:{schema:1,kind:"camera-inspiration",inspirationOnly:true,projectId:s.projectId,locationId:id,
        inputKey:stamp,prompt:text,modelId:choice.model,quality:choice.quality,size:metaOut.imageSize||choice.imageSize,
        aspect:"16:9",mode:"draft",iso:new Date().toISOString()}};
      unsaved.set(k,entry);options.onPhase?.("saving");return await save(id,s,entry);
    }catch(e){mark(s,id,{...record,phase:"uncertain"});throw e;}
  });}
  async function retrySave(id,s){return locked(id,s,async k=>{
    const entry=unsaved.get(k);if(!entry||entry.scope.epoch!==s.epoch)throw Error("No completed image is waiting to be saved in this window.");
    return save(id,s,entry);
  });}
  root.KinolotCameraInspiration={ENGINES,slot,inputKey,settings,prompt,load,pending,generate,retrySave};
})(window);

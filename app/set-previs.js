/* PREVIS SHEET (trial, owner 2026-11-15). Draws a built set, with its dressing, in the browser as the four camera
   views of the location on one 16:9 sheet: lit, shadowed, in the set's own colours. No account, worker or model call;
   the sheet is what the image engine is then asked to follow. Same shapes and cameras as the layout preview. */
(function(root){
  "use strict";
  const PANELS=["TL","TR","BL","BR"];
  const SKY={day:"#9fb6c9",dusk:"#6f6a86",night:"#0b1220"};
  const FILL={day:1.15,dusk:0.7,night:0.28};

  function build(T,scene,light){
    const three=new T.Scene(),disposables=[],materials=new Map();
    const time=light&&light.time||"day";
    three.background=new T.Color(light&&light.sky||SKY[time]);
    Object.entries(scene.materials).forEach(([id,m])=>{
      const colour=new T.Color(...m.baseColor);
      const material=new T.MeshStandardMaterial({color:colour,roughness:m.roughness==null?0.8:m.roughness,metalness:m.metallic||0,side:T.DoubleSide,
        emissive:colour,emissiveIntensity:m.emissionStrength?Math.min(2.5,m.emissionStrength*0.35):0});
      materials.set(id,material);disposables.push(material);
    });
    const box=new T.Box3();
    scene.objects.forEach(item=>{
      const geometry=root.KinolotAnglePreview.geometry(T,item),mesh=new T.Mesh(geometry,materials.get(item.material));
      disposables.push(geometry);
      mesh.position.set(...item.position);mesh.scale.set(...item.size);
      const [x,y,z]=item.rotation;
      mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeRotationZ(z).multiply(new T.Matrix4().makeRotationY(y)).multiply(new T.Matrix4().makeRotationX(x)));
      // a ceiling keeps the sun out of a room; a thin cloth only receives
      mesh.castShadow=item.kind!=="cloth";mesh.receiveShadow=true;
      three.add(mesh);
    });
    three.updateMatrixWorld(true);
    // shadows cover what the cameras stand in, not a far backdrop
    Object.values(scene.cameras).forEach(c=>box.expandByPoint(new T.Vector3(...c.position)));
    const centre=box.getCenter(new T.Vector3()),reach=Math.min(45,Math.max(8,box.getSize(new T.Vector3()).length()/2+14));
    const fill=(light&&light.fill!=null?light.fill:1)*FILL[time];
    three.add(new T.HemisphereLight(new T.Color(light&&light.sky||SKY[time]).lerp(new T.Color("#ffffff"),0.55),new T.Color("#5b554c"),fill*1.5));
    three.add(new T.AmbientLight(0xffffff,fill*0.35));
    const sun=light&&light.sun||{from:200,height:38,colour:"#fff4e0",power:1};
    if(sun.power>0){
      const az=sun.from*Math.PI/180,el=sun.height*Math.PI/180,key=new T.DirectionalLight(new T.Color(sun.colour),sun.power*(time==="night"?0.5:2.6));
      key.position.copy(centre).add(new T.Vector3(Math.sin(az)*Math.cos(el),Math.cos(az)*Math.cos(el),Math.sin(el)).multiplyScalar(reach*2));
      key.target.position.copy(centre);three.add(key.target);
      key.castShadow=true;key.shadow.mapSize.set(4096,4096);key.shadow.bias=-0.0004;key.shadow.normalBias=0.03;
      const cam=key.shadow.camera;cam.left=-reach;cam.right=reach;cam.top=reach;cam.bottom=-reach;cam.near=0.5;cam.far=reach*4.5;cam.updateProjectionMatrix();
      three.add(key);
    }
    // room lights the builder placed under each ceiling, then the lamps the dressing names
    (scene.previewLights||[]).forEach(l=>{
      const p=new T.PointLight(new T.Color(...l.colour),Math.max(6,Math.min(60,l.powerWatts/14))*(time==="night"?0.8:1),0,1.6);
      p.position.set(...l.position);three.add(p);
    });
    // by day a fitting is drawn but gives no light (the master view is daylight; the film's hours are variants)
    (time==="day"?[]:light&&light.lamps||[]).forEach(l=>{
      const p=new T.PointLight(new T.Color(l.colour),l.power*16,0,1.7);p.position.set(...l.at);three.add(p);
    });
    return {three,dispose:()=>disposables.forEach(d=>d.dispose())};
  }

  /* The four views on one sheet. Returns {dataUrl, width, height, panels}. */
  async function sheet(scene,light,options){
    options=options||{};
    if(!root.KinolotAnglePreview)throw new Error("The 3D view did not load. Refresh this page.");
    const T=await root.KinolotAnglePreview.load();
    const w=Math.max(320,Math.min(1280,Math.round(options.panelWidth||960))),h=Math.round(w*9/16);
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});}
    catch(_){throw new Error("This browser could not start the 3D view. Turn on graphics acceleration and try again.");}
    const rig=build(T,scene,light||null);
    try{
      renderer.setPixelRatio(1);renderer.setSize(w,h,false);renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=options.exposure||1;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
      const canvas=root.document.createElement("canvas");canvas.width=w*2;canvas.height=h*2;
      const ctx=canvas.getContext("2d");if(!ctx)throw new Error("This browser cannot draw the sheet.");
      PANELS.forEach((key,i)=>{
        const camera=root.KinolotAnglePreview.cameraFor(T,scene.cameras[key]);
        renderer.render(rig.three,camera);
        if(renderer.getContext().isContextLost())throw new Error("The 3D view stopped. Close other heavy tabs and try again.");
        ctx.drawImage(renderer.domElement,(i%2)*w,Math.floor(i/2)*h,w,h);
      });
      return {dataUrl:canvas.toDataURL(options.type||"image/png",options.quality),width:w*2,height:h*2,panels:PANELS.slice()};
    }finally{rig.dispose();renderer.dispose();renderer.forceContextLoss();}
  }
  /* THE SET AS PREVIS DRAWS IT: the built floor plan with the location's saved dressing on, when it has one.
     `at` = a story moment (moving parts): the set as it stands then. Throws the builder's own sentence when the floor
     plan or cameras are not ready. */
  function scene(location,list,at){
    if(!root.KinolotCloudRender||!root.KinolotSetDressing)throw new Error("The 3D view did not load. Refresh this page.");
    const built=root.KinolotCloudRender.buildScene(location,list,at||undefined),kept=root.KinolotSetDressing.saved(location,built);
    if(!kept)return {scene:built,light:null,dressed:false,parts:0,iso:""};
    return {scene:root.KinolotSetDressing.apply(built,kept.dressing),light:kept.dressing.light,dressed:true,parts:kept.report.parts,iso:kept.iso};
  }

  /* FROM THE SHEET TO THE IMAGE. The image engine gets the sheet as Image 1 and the card's own prompt, in the render
     style chosen on the card (or the tab's style when the card has none): photoreal, anime, anything. The sheet
     decides where things are; the card decides what they are and how they look. */
  function stylePrompt(location,project){
    const style=typeof root.locVisualDefaults==="function"?root.locVisualDefaults(location).renderStyle:"";
    const build=typeof root.combinedLocationPrompt==="function"?root.combinedLocationPrompt:root.buildLocationRefPrompt;
    const card=typeof build==="function"?build(location,project||root.turnProject||{},{}):"";
    if(!card)throw new Error("This location's prompt could not be built. Describe the place first.");
    return "Image 1 is the 3D previs sheet of this location: ONE set seen by four cameras, a 2x2 grid of equal 16:9 panels. It is the layout to follow. "
      +"Keep each panel's camera position, framing, horizon and lens. Keep every wall, opening, building and object, each in its place, size and proportion, and keep what is in front of what. "
      +"The previs is built from plain blocks: read each block as the real thing it stands for (named in the spec below) and give it its real surface, detail, edges and wear. "
      +"Do not add, remove or move buildings, objects or openings, and do not merge, swap, crop or reframe panels. "
      +"The sheet's flat colours and simple light only point to materials and the hour; the finished look is the spec's render style"+(style?" ("+style+")":"")+". "
      +"No people, no text, no labels, no borders and no panel numbers.\n\n"+card;
  }
  // The engine and size in the top bar, as the plan allows them, and what one image from the sheet costs.
  function settings(){
    const choice=root.nbPlanImageChoice(root.nbGetModel(),root.nbGetRes()),model=choice.model;
    const quality=typeof root.isGptImageModel==="function"&&root.isGptImageModel(model)?(typeof root.nbGetOaiQuality==="function"?root.nbGetOaiQuality(model):"high"):undefined;
    return {model,imageSize:choice.res,quality,label:typeof root.nbModelLabel==="function"?root.nbModelLabel(model):model,
      cost:{model,res:choice.res,quality,aspect:"16:9",refs:1,ground:false}};
  }
  /* One image call. Returns the image and what was sent; saves nothing and replaces no artwork. */
  async function style(location,sheetUrl,options){
    options=options||{};
    if(typeof root.nbGenerate!=="function")throw new Error("Sign in to make this image.");
    if(!/^data:image\//.test(String(sheetUrl||"")))throw new Error("Draw the previs sheet first.");
    const choice=options.settings||settings();
    const prompt=stylePrompt(location,options.project)+(options.after||""),metaOut={};
    const scope=root.BlenderPreview&&typeof root.BlenderPreview.scope==="function"?root.BlenderPreview.scope():null;
    const url=await root.nbGenerate(prompt,{model:choice.model,imageSize:choice.imageSize,quality:choice.quality,aspectRatio:"16:9",referenceImage:sheetUrl,
      baseMaxDim:1536,referenceMaxDim:1536,referencesNumbered:true,groundSearch:false,noRetry:true,
      ...(scope&&scope.projectId?{projectId:scope.projectId}:{}),assetId:options.assetId||location.id,assetPurpose:"previs-image",metaOut,
      ...(typeof options.beforeSubmit==="function"?{beforeSubmit:options.beforeSubmit}:{})});
    return {url,prompt,model:choice.model,label:choice.label,size:metaOut.imageSize||choice.imageSize,quality:choice.quality||""};
  }

  /* DRAFTS (owner 2026-11-15: "preview as soon as image is generated, with option for the user to use as location
     image or discard"). Make the location image makes a DRAFT: its own saved image, never the location image itself.
     It is shown under the button at once and stays on the card until it is discarded; the drafts made before it stay
     too. Use as location image saves a draft's pixels as the location image's new version, and the image before it
     stays in the card's versions.
     ONE RULE says whether a draft can be used: it must still match what it was made from, the set (floor plan,
     cameras, dressing, story moment) and the card's description and look. What the location image is today never
     matters: using a draft only adds a version.
     What a draft is for: a location id = the usual set, which becomes the location image; or a target
     {loc, at, key, label} = the set at a story moment whose moving parts differ ("Stern ramp lowered"), which becomes
     that state's own image and never touches the location image. */
  const unsaved=new Map(),running=new Set();
  const target=id=>id&&typeof id==="object"?{loc:String(id.loc),at:id.at||null,key:String(id.key||""),label:String(id.label||"")}
    :{loc:String(id),at:null,key:"",label:""};
  const slot=id=>{const t=target(id);return "previs-draft-"+t.loc+(t.key?"-parts-"+t.key.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,80):"");};
  const live=id=>{const l=((root.turnContinuity||{}).locations||[]).find(x=>x.id===id);if(!l)throw new Error("This location is no longer in the film.");return l;};
  const assetOf=id=>{const t=target(id);return t.key?root.locationPartStateAssetId(live(t.loc),t.key):t.loc;};
  const announce=id=>root.dispatchEvent&&root.dispatchEvent(new CustomEvent("kinolot-previs-changed",{detail:{id:target(id).loc}}));
  const scopeNow=()=>{try{return root.BlenderPreview.scope();}catch(_){throw new Error("Open a saved film and sign in to make this image.");}};
  const keyOf=(scope,id)=>[scope.uid,scope.projectId,slot(id)].join(":");
  function assertCurrent(scope){
    if(!root.BlenderPreview.isCurrent(scope))throw new Error("The open film or sign-in changed. Open the location again.");
  }
  function assertWritable(scope){
    assertCurrent(scope);
    if(typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw new Error("This film is read-only.");
  }
  // What a draft is made from, as two short keys: the set exactly as drawn, and the card's description and look.
  async function keys(id,list){
    const t=target(id),location=live(t.loc),built=scene(location,list,t.at),C=root.KinolotRenderContract;
    const look=typeof root.locationSpecSig==="function"?String(root.locationSpecSig(location)):stylePrompt(location);
    return {setKey:await C.hash(C.canonical({scene:built.scene,light:built.light||null})),lookKey:await C.hash(String(look))};
  }
  const discarded=meta=>!!(meta&&meta.approval&&meta.approval.iso===meta.iso&&meta.approval.approved===false);
  const used=meta=>!!(meta&&meta.approval&&meta.approval.iso===meta.iso&&meta.approval.approved===true);
  const mine=(meta,id,scope)=>{const t=target(id);
    return !!meta&&meta.kind==="previs-draft"&&meta.schema===1&&meta.projectId===scope.projectId&&meta.locationId===t.loc&&(meta.stateKey||"")===t.key&&!!meta.iso;};
  const shaped=d=>{const ref=(d.refs||[]).find(r=>r&&r.kind==="previs-sheet"&&!r.deleted);
    return {url:d.url,meta:d.meta,sheet:(ref&&ref.url)||"",used:used(d.meta),discarded:discarded(d.meta)};};
  /* The drafts kept for a location: the current one (null when none, or when it was discarded) and the earlier ones,
     newest first, without the discarded. Looking only: nothing is generated, charged or changed. */
  async function drafts(id){
    const scope=scopeNow(),saved=await root.nbLoadDetailsAsset(slot(id),"");assertCurrent(scope);
    const current=saved&&saved.url&&mine(saved.meta,id,scope)?shaped(saved):null,earlier=[];
    for(const d of (saved&&saved.history)||[]){
      if(!d||!d.url||!mine(d.meta,id,scope)||discarded(d.meta))continue;
      earlier.push(shaped(d));if(earlier.length>=8)break;
    }
    return {current:current&&!current.discarded?current:null,lastDiscarded:!!(current&&current.discarded),earlier};
  }
  function pending(id){
    try{const scope=root.BlenderPreview.scope(),key=keyOf(scope,id),entry=unsaved.get(key);
      if(entry&&entry.scope.epoch!==scope.epoch){unsaved.delete(key);return {running:running.has(key),unsaved:false};}
      return {running:running.has(key),unsaved:!!entry};
    }catch(_){return {running:false,unsaved:false};}
  }
  async function locked(id,scope,fn){
    const key=keyOf(scope,id);
    if(running.has(key))throw new Error("This location's image is already being worked on.");
    running.add(key);announce(id);
    try{return await fn(key);}finally{running.delete(key);announce(id);}
  }
  async function commit(entry){
    assertWritable(entry.scope);
    const saved=await root.nbCommit(entry.slot,entry.url,entry.meta,entry.refs,"location",entry.scope.epoch,()=>!root.BlenderPreview.isCurrent(entry.scope));
    if(!saved||["error","stale","cancelled"].includes(saved.tier))throw new Error((saved&&saved.error)||"The image was made but could not be saved.");
    unsaved.delete(entry.key);
    return {url:saved.url||entry.url,meta:entry.meta,sheet:entry.refs[0].url,used:false,discarded:false};
  }
  /* MAKE A DRAFT: draw the sheet, one image call, save the result as the newest draft. The location image is not touched. */
  async function render(id,options){
    options=options||{};
    const scope=scopeNow(),t=target(id);
    assertWritable(scope);
    if(unsaved.has(keyOf(scope,id)))throw new Error("An image was made but not saved yet. Save it first.");
    return locked(id,scope,async key=>{
      const location=live(t.loc),built=scene(location,undefined,t.at);
      options.onPhase&&options.onPhase("drawing");
      const drawn=await root.KinolotPrevis.sheet(built.scene,built.light,{panelWidth:960});
      assertWritable(scope);
      const made=await keys(id);
      // what the image is made from, as the card's own Generate records it: the layout, the cameras, the description
      const sig=name=>typeof root[name]==="function";
      const record={...(sig("locationSpatialPlanSigFor")?{spatialPlanSig:root.locationSpatialPlanSigFor(location)}:{}),
        ...(sig("locationPlatePanelRecord")?{platePanels:root.locationPlatePanelRecord(location)}:{}),
        ...(sig("locationPlateLayoutSig")?{plateLayoutSig:root.locationPlateLayoutSig(location,{panels:true})}:{}),
        ...(sig("locationSpecSig")?{locSpecSig:root.locationSpecSig(location)}:{})};
      // the set is drawn at a story moment: say which parts are not in their usual state, so the image keeps them
      const moved=t.key&&typeof root.locationMovingPartsAt==="function"?root.locationMovingPartsAt(location,t.at).filter(p=>p.differs&&p.state)
        .map(p=>p.name+" "+p.state.label.toLowerCase()+(p.state.look?" \u2014 "+p.state.look:"")).join("; "):"";
      options.onPhase&&options.onPhase("generating");
      const out=await style(location,drawn.dataUrl,{project:options.project,settings:options.settings,assetId:slot(id),
        after:moved?"\nMOVING PARTS AT THIS MOMENT (as drawn in the sheet): "+moved+". Where the sheet opens to the outside, show the exterior beyond as described (keep its position and size).":"",
        beforeSubmit:async()=>{assertWritable(scope);}});
      const meta={schema:1,kind:"previs-draft",mode:"draft",projectId:scope.projectId,locationId:t.loc,
        ...(t.key?{stateKey:t.key,stateLabel:t.label,stateAt:t.at}:{}),
        setKey:made.setKey,lookKey:made.lookKey,prompt:out.prompt,modelId:out.model,modelLabel:out.label,quality:out.quality||undefined,size:out.size,aspect:"16:9",
        iso:new Date().toISOString(),...record,previs:{dressed:built.dressed,dressingIso:built.iso,shapes:built.scene.objects.length}};
      const entry={key,slot:slot(id),scope,url:out.url,meta,refs:[{kind:"previs-sheet",label:"Previs sheet",url:drawn.dataUrl}]};
      unsaved.set(key,entry);
      options.onPhase&&options.onPhase("saving");
      return commit(entry);
    });
  }
  // Save a draft that was made but not saved (one more click, no new image).
  async function retrySave(id){
    const scope=scopeNow(),entry=unsaved.get(keyOf(scope,id));
    if(!entry||entry.scope.epoch!==scope.epoch)throw new Error("That image is no longer in this session.");
    return locked(id,scope,()=>commit(entry));
  }
  function discardUnsaved(id){
    try{unsaved.delete(keyOf(root.BlenderPreview.scope(),id));}catch(_){}
    announce(id);
  }
  // The draft's own image, as data: a data URL as it is, a stored image downloaded once (never made again).
  async function imageData(url){
    if(/^data:image\//i.test(String(url||"")))return url;
    let blob;
    try{const r=await root.fetch(url);if(!r.ok)throw new Error(String(r.status));blob=await r.blob();}
    catch(_){throw new Error("The draft image could not be downloaded. Check your connection and try again.");}
    if(!blob||!blob.size||!/^image\//i.test(blob.type||""))throw new Error("The draft image could not be read. Make a new one.");
    return await new Promise((resolve,reject)=>{const f=new root.FileReader();f.onload=()=>resolve(f.result);
      f.onerror=()=>reject(new Error("The draft image could not be read. Make a new one."));f.readAsDataURL(blob);});
  }
  const OUT_OF_DATE="This draft is out of date: the floor plan, the cameras, the dressing or the description changed after it was made. Make a new one.";
  /* USE AS LOCATION IMAGE: the current draft's pixels become the location image's new version (a moving-part state's
     draft becomes that state's image). Nothing is generated. The image before it stays in the card's versions. */
  async function use(id,iso){
    const scope=scopeNow(),t=target(id);
    assertWritable(scope);
    return locked(id,scope,async()=>{
      const saved=await root.nbLoadDetailsAsset(slot(id),"");assertWritable(scope);
      if(!saved||!saved.url||!mine(saved.meta,id,scope))throw new Error("The draft is no longer saved.");
      if(saved.meta.iso!==iso)throw new Error("Another draft is the current one now. Open the location again.");
      if(discarded(saved.meta))throw new Error("This draft was discarded. Make a new one.");
      const now=await keys(id);
      if(now.setKey!==saved.meta.setKey||now.lookKey!==saved.meta.lookKey)throw new Error(OUT_OF_DATE);
      const asset=assetOf(id),before=await root.nbLoadDetailsAsset(asset,"");assertWritable(scope);
      if(before&&before.url&&before.meta&&before.meta.previsDraftIso===iso)return {url:before.url,alreadyUsed:true};
      const pixels=await imageData(saved.url);assertWritable(scope);
      let meta={...saved.meta,kind:"location",mode:"final",iso:new Date().toISOString(),previsDraftIso:iso,version:(Number(before&&before.meta&&before.meta.version)||0)+1};
      delete meta.approval;delete meta.schema;
      if(typeof root.nbWithAssetProvenance==="function")meta={...meta,...root.nbWithAssetProvenance(asset,meta,"location")};
      const sheetRef=(saved.refs||[]).find(r=>r&&r.kind==="previs-sheet"&&!r.deleted&&r.url);
      const done=await root.nbCommit(asset,pixels,meta,sheetRef?[{kind:"previs-sheet",label:"Previs sheet",url:sheetRef.url}]:[],"location",scope.epoch,()=>!root.BlenderPreview.isCurrent(scope));
      if(!done||["error","stale","cancelled"].includes(done.tier))throw new Error((done&&done.error)||"The image could not be saved. Nothing was changed.");
      root.dispatchEvent(new CustomEvent("nb-gen-done",{detail:{id:asset,url:done.url||pixels}}));
      const marked=await root.nbSetAssetApproval(slot(id),iso,true,"previs-draft-used");
      return {url:done.url||pixels,marked:!!(marked&&marked.ok)};
    });
  }
  // DISCARD: the current draft leaves the card. Its file is not deleted, and no image is changed.
  async function discard(id,iso){
    const scope=scopeNow();assertWritable(scope);
    return locked(id,scope,async()=>{
      const result=await root.nbSetAssetApproval(slot(id),iso,false,"previs-draft-discarded");
      if(!result||!result.ok)throw new Error((result&&result.error==="asset version changed")?"Another draft is the current one now. Open the location again.":"The draft could not be discarded.");
      return result;
    });
  }
  // An earlier draft becomes the current one again; the draft it replaces stays with the earlier ones. No image call.
  async function restore(id,iso){
    const scope=scopeNow();assertWritable(scope);
    return locked(id,scope,async()=>{
      const saved=await root.nbLoadDetailsAsset(slot(id),""),index=((saved&&saved.history)||[]).findIndex(d=>d&&d.url&&d.meta&&d.meta.iso===iso&&mine(d.meta,id,scope));
      assertWritable(scope);
      if(!iso||index<0)throw new Error("That earlier draft is no longer saved.");
      const result=typeof root.nbRevertAsset==="function"?await root.nbRevertAsset(slot(id),index):null;
      if(!result||!result.url)throw new Error("The earlier draft could not be brought back. Nothing was changed.");
      return result;
    });
  }
  root.KinolotPrevis={PANELS,OUT_OF_DATE,sheet,scene,stylePrompt,settings,style,target,slot,assetOf,keys,drafts,render,use,discard,restore,retrySave,discardUnsaved,pending};
})(typeof window!=="undefined"?window:globalThis);

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
     Throws the builder's own sentence when the floor plan or cameras are not ready. */
  function scene(location,list){
    if(!root.KinolotCloudRender||!root.KinolotSetDressing)throw new Error("The 3D view did not load. Refresh this page.");
    const built=root.KinolotCloudRender.buildScene(location,list),kept=root.KinolotSetDressing.saved(location,built);
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
    const prompt=stylePrompt(location,options.project),metaOut={};
    const scope=root.BlenderPreview&&typeof root.BlenderPreview.scope==="function"?root.BlenderPreview.scope():null;
    const url=await root.nbGenerate(prompt,{model:choice.model,imageSize:choice.imageSize,quality:choice.quality,aspectRatio:"16:9",referenceImage:sheetUrl,
      baseMaxDim:1536,referenceMaxDim:1536,referencesNumbered:true,groundSearch:false,noRetry:true,
      ...(scope&&scope.projectId?{projectId:scope.projectId}:{}),assetId:location.id,assetPurpose:"previs-image",metaOut,
      ...(typeof options.beforeSubmit==="function"?{beforeSubmit:options.beforeSubmit}:{})});
    return {url,prompt,model:choice.model,label:choice.label,size:metaOut.imageSize||choice.imageSize,quality:choice.quality||""};
  }

  /* RENDER THE LOCATION IMAGE FROM THE PREVIS. The same thing the card's own Generate does, with the sheet as the
     layout: one image call, saved as the location image's new version (the one before it stays in the card's
     versions). An image that was made but could not be saved is kept for this session (unsaved) so that it is saved
     with one more click, never paid for twice. */
  const unsaved=new Map(),running=new Set();
  const live=id=>{const l=((root.turnContinuity||{}).locations||[]).find(x=>x.id===id);if(!l)throw new Error("This location is no longer in the film.");return l;};
  const announce=id=>root.dispatchEvent&&root.dispatchEvent(new CustomEvent("kinolot-previs-changed",{detail:{id}}));
  function assertWritable(scope){
    if(!root.BlenderPreview.isCurrent(scope))throw new Error("The open film or sign-in changed. Open the location again.");
    if(typeof root.turnArtRoomWritable==="function"&&!root.turnArtRoomWritable())throw new Error("This film is read-only.");
  }
  async function commit(entry){
    assertWritable(entry.scope);
    const saved=await root.nbCommit(entry.id,entry.url,entry.meta,entry.refs,"location",entry.scope.epoch,()=>!root.BlenderPreview.isCurrent(entry.scope));
    if(!saved||["error","stale","cancelled"].includes(saved.tier))throw new Error((saved&&saved.error)||"The image was made but could not be saved.");
    unsaved.delete(entry.key);
    root.dispatchEvent(new CustomEvent("nb-gen-done",{detail:{id:entry.id,url:saved.url||entry.url}}));
    return saved;
  }
  const keyOf=(scope,id)=>[scope.uid,scope.projectId,id].join(":");
  const scopeNow=()=>{try{return root.BlenderPreview.scope();}catch(_){throw new Error("Open a saved film and sign in to make this image.");}};
  function pending(id){
    try{const scope=root.BlenderPreview.scope(),key=keyOf(scope,id),entry=unsaved.get(key);
      if(entry&&entry.scope.epoch!==scope.epoch){unsaved.delete(key);return {running:running.has(key),unsaved:false};}
      return {running:running.has(key),unsaved:!!entry};
    }catch(_){return {running:false,unsaved:false};}
  }
  async function render(locationId,options){
    options=options||{};
    const scope=scopeNow(),key=keyOf(scope,locationId);
    assertWritable(scope);
    if(running.has(key))throw new Error("This location's image is already being made.");
    if(unsaved.has(key))throw new Error("An image was made but not saved yet. Save it first.");
    running.add(key);announce(locationId);
    try{
      const location=live(locationId),built=scene(location);
      options.onPhase&&options.onPhase("drawing");
      const drawn=await sheet(built.scene,built.light,{panelWidth:960});
      assertWritable(scope);
      // what the image is made from, as the card's own Generate records it: the layout, the cameras, the description
      const sig=name=>typeof root[name]==="function";
      const made={...(sig("locationSpatialPlanSigFor")?{spatialPlanSig:root.locationSpatialPlanSigFor(location)}:{}),
        ...(sig("locationPlatePanelRecord")?{platePanels:root.locationPlatePanelRecord(location)}:{}),
        ...(sig("locationPlateLayoutSig")?{plateLayoutSig:root.locationPlateLayoutSig(location,{panels:true})}:{}),
        ...(sig("locationSpecSig")?{locSpecSig:root.locationSpecSig(location)}:{})};
      const before=await root.nbLoadDetailsAsset(locationId,"");
      assertWritable(scope);
      options.onPhase&&options.onPhase("generating");
      const out=await style(location,drawn.dataUrl,{project:options.project,settings:options.settings,beforeSubmit:async()=>{assertWritable(scope);}});
      let meta={kind:"location",mode:"final",prompt:out.prompt,modelId:out.model,modelLabel:out.label,quality:out.quality||undefined,size:out.size,aspect:"16:9",
        iso:new Date().toISOString(),...made,version:(Number(before&&before.meta&&before.meta.version)||0)+1,
        previs:{dressed:built.dressed,dressingIso:built.iso,shapes:built.scene.objects.length}};
      if(typeof root.nbWithAssetProvenance==="function")meta={...meta,...root.nbWithAssetProvenance(locationId,meta,"location")};
      const entry={key,id:locationId,scope,url:out.url,meta,refs:[{kind:"previs-sheet",label:"Previs sheet",url:drawn.dataUrl}]};
      unsaved.set(key,entry);
      options.onPhase&&options.onPhase("saving");
      const saved=await commit(entry);
      return {url:saved.url||out.url,meta};
    }finally{running.delete(key);announce(locationId);}
  }
  // Save an image that was made but not saved (one more click, no new image).
  async function retrySave(locationId){
    const scope=scopeNow(),key=keyOf(scope,locationId),entry=unsaved.get(key);
    if(!entry||entry.scope.epoch!==scope.epoch)throw new Error("That image is no longer in this session.");
    if(running.has(key))throw new Error("This location's image is being saved.");
    running.add(key);announce(locationId);
    try{return await commit(entry);}finally{running.delete(key);announce(locationId);}
  }
  function discardUnsaved(locationId){
    try{unsaved.delete(keyOf(root.BlenderPreview.scope(),locationId));}catch(_){}
    announce(locationId);
  }
  root.KinolotPrevis={PANELS,sheet,scene,stylePrompt,settings,style,render,retrySave,discardUnsaved,pending};
})(typeof window!=="undefined"?window:globalThis);

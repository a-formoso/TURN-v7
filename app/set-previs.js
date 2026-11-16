/* PREVIS SHEET (trial, owner 2026-11-15). Draws a built set, with its dressing, in the browser as the four camera
   views of the location on one 16:9 sheet: lit, shadowed, in the set's own colours. No account, worker or model call;
   the sheet is what the image engine is then asked to follow. Same shapes and cameras as the layout preview. */
(function(root){
  "use strict";
  const PANELS=["TL","TR","BL","BR"];
  const SKY={day:"#9fb6c9",dusk:"#6f6a86",night:"#0b1220"};
  const FILL={day:1.15,dusk:0.7,night:0.28};

  function build(T,scene,light){
    const three=new T.Scene(),disposables=[],materials=new Map(),meshes=[];
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
      mesh.userData.name=String(item.name||"");meshes.push(mesh);
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
    return {three,meshes,dispose:()=>disposables.forEach(d=>d.dispose())};
  }
  /* WHAT EACH PANEL SHOWS (2026-11-16: the owner's first draft from plain blocks did not follow the sheet, because
     nothing told the image engine which block is which thing). Rays through each camera's frame name what is seen,
     where in the frame and how far: [{name, side, depth, share}], largest first. Structure (floors, walls, ceilings)
     is named once per kind. Never throws: a panel that cannot be read is an empty list. */
  const SIDES=["far left","left","centre","right","far right"];
  function seen(T,rig,camera){
    try{
      const ray=new T.Raycaster(),hits=new Map(),COLS=16,ROWS=9;
      for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
        ray.setFromCamera(new T.Vector2((c+0.5)/COLS*2-1,1-(r+0.5)/ROWS*2),camera);
        const hit=ray.intersectObjects(rig.meshes,false)[0];if(!hit)continue;
        const name=String(hit.object.userData.name||"").split(/ \u00b7 | - part /)[0].replace(/\s+/g," ").trim().slice(0,70);if(!name)continue;
        const e=hits.get(name)||{name,n:0,x:0,d:Infinity};e.n++;e.x+=(c+0.5)/COLS;e.d=Math.min(e.d,hit.distance);hits.set(name,e);
      }
      return Array.from(hits.values()).sort((a,b)=>b.n-a.n).slice(0,9).map(e=>({name:e.name,share:Math.round(e.n/(COLS*ROWS)*100),
        side:SIDES[Math.min(4,Math.floor(e.x/e.n*5))],depth:e.d<2.5?"close":e.d<8?"middle distance":"far"}));
    }catch(_){return [];}
  }
  const COMPASS=["north","north-east","east","south-east","south","south-west","west","north-west"];
  const PANEL_WORDS={TL:"TOP LEFT",TR:"TOP RIGHT",BL:"BOTTOM LEFT",BR:"BOTTOM RIGHT"};
  // The panels in words, for the image engine: where each camera stands and what its frame holds, read from the 3D set.
  function panelText(scene,views){
    if(!views)return "";
    const lines=PANELS.map(key=>{
      const cam=scene.cameras[key],list=views[key]||[];if(!cam)return "";
      return PANEL_WORDS[key]+": "+cameraWords(cam,list);
    }).filter(Boolean);
    return lines.length?"\nPANEL BY PANEL, read from the 3D set (this is what each panel shows, and nothing in the spec below may change it):\n"+lines.join("\n")+"\n":"";
  }
  function cameraWords(cam,list){
    {
      const lens=Number(cam.lensMm)||35,tilt=Number(cam.pitch)||0;
      const head="camera "+(Math.round(cam.position[2]*10)/10)+" m high, facing "+COMPASS[Math.round((((Number(cam.yaw)||0)%360)+360)%360/45)%8]
        +(tilt<=-12?", looking down":tilt>=12?", looking up":"")+", "+lens+" mm lens ("+(lens<=22?"very wide":lens<=32?"wide":lens<=60?"normal":"long")+").";
      return head+(list&&list.length?" In its frame: "+list.map(v=>v.name+" ("+v.side+", "+v.depth+")").join("; ")+".":"");
    }
  }
  /* A VARIANT IS ONE FRAME (owner 2026-11-16: "one frame"): the same set from ONE of its four cameras, lit for the
     variant's hour. lightFor turns a time of day into the light the set is drawn in; the place's own (day) light stays
     for a day variant, and the dressing's lamps come on when it is not day. */
  function lightFor(time,base){
    const t=String(time||"").toLowerCase(),lamps=(base&&base.lamps)||[];
    if(/pre-?dawn|night|midnight|small hours/.test(t))return {time:"night",sky:"#0b1220",sun:{from:230,height:40,colour:"#9fb4ff",power:0.7},fill:0.55,lamps};
    if(/dawn|sunrise|first light/.test(t))return {time:"dusk",sky:"#c7a694",sun:{from:85,height:7,colour:"#ffc49a",power:1.1},fill:0.8,lamps};
    if(/dusk|sunset|twilight|evening|magic hour|golden hour/.test(t))return {time:"dusk",sky:"#6f6a86",sun:{from:265,height:7,colour:"#ffb37a",power:1.1},fill:0.75,lamps};
    return base||null;
  }
  // What the image engine is told for a variant's frame. `spec` is the variant's own prompt, built by its card.
  function framePrompt(spec,drawn,info){
    info=info||{};
    const cam=drawn&&drawn.scene&&drawn.scene.cameras[drawn.camera];
    return "Image 1 is the 3D previs of this location from ONE camera, lit for the hour: a single 16:9 frame. It is the layout to follow, and it decides the camera. "
      +"Draw ONE full-frame 16:9 image, not a grid, from exactly that camera: the same standpoint, height, direction, tilt, horizon line and lens. Every large shape stays where it is in the frame, at its size, and what is in front of what stays so. "
      +"Keep every wall, opening, building and object, each in its place, size and proportion. "
      +"The previs is built from plain blocks: read each block as the real thing it stands for (named below, and described in the spec) and give it its real surface, detail, edges and wear. "
      +"Do not add, remove or move buildings, objects or openings. Never replace the frame with a different or more flattering view of the place. "
      +"The previs's flat colours and simple light only point to materials and the hour; the finished look is the spec's render style"+(info.style?" ("+info.style+")":"")+". "
      +"No people, no text, no labels and no borders.\n"
      +(info.look?"Image 2 is the finished image of this same place in its usual daylight (four views of it). Take from it what things are made of and how they look, so that this is recognisably the same place. Take NO layout or camera from Image 2, and NOT its hour or its weather: those come from the spec below and from the light of Image 1.\n":"")
      +(cam?"\nTHE FRAME, read from the 3D set (nothing in the spec below may change it): "+cameraWords(cam,drawn.views&&drawn.views[drawn.camera])+"\n":"")
      +"\nTHE SPEC (the place, and this variant's hour, weather and state). If it describes a camera position, a view or framing of its own, ignore that part: Image 1 alone decides it.\n"+String(spec||"");
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
      // options.only: one camera alone, as a single 16:9 frame (a variant is one frame, 2026-11-16)
      const only=PANELS.includes(options.only)?options.only:"",shown=only?[only]:PANELS,cols=only?1:2;
      const canvas=root.document.createElement("canvas");canvas.width=w*cols;canvas.height=h*cols;
      const ctx=canvas.getContext("2d");if(!ctx)throw new Error("This browser cannot draw the sheet.");
      const views={};
      shown.forEach((key,i)=>{
        if(!scene.cameras[key])throw new Error("That camera is not set yet.");
        const camera=root.KinolotAnglePreview.cameraFor(T,scene.cameras[key]);
        renderer.render(rig.three,camera);
        if(options.views)views[key]=seen(T,rig,camera);
        if(renderer.getContext().isContextLost())throw new Error("The 3D view stopped. Close other heavy tabs and try again.");
        ctx.drawImage(renderer.domElement,(i%cols)*w,Math.floor(i/cols)*h,w,h);
      });
      return {dataUrl:canvas.toDataURL(options.type||"image/png",options.quality),width:w*cols,height:h*cols,panels:shown.slice(),...(options.views?{views}:{})};
    }finally{rig.dispose();renderer.dispose();renderer.forceContextLoss();}
  }
  /* THE SET AS PREVIS DRAWS IT: the built floor plan with the dressing on. ONE PLACE, ONE SET (owner 2026-11-16): a
     place's floor plan holds all its rooms, so every card of the place is drawn from the same model, with the dressing
     of EVERY card of the place on (each card dresses its own space: set-dressing.js own). Only the four cameras differ.
     `at` = a story moment (moving parts): the set as it stands then. Throws the builder's own sentence when the floor
     plan or cameras are not ready. */
  function scene(location,list,at){
    if(!root.KinolotCloudRender||!root.KinolotSetDressing)throw new Error("The 3D view did not load. Refresh this page.");
    const D=root.KinolotSetDressing,built=root.KinolotCloudRender.buildScene(location,list,at||undefined);
    const where=D.place(location,list),count=d=>Object.values(d.objects).reduce((n,l)=>n+l.length,0)+d.extras.reduce((n,e)=>n+e.parts.length,0);
    let out=built,parts=0,light=null;const isos=[];
    where.family.forEach((member,k)=>{
      // the card on screen may be newer than the film's saved list
      const card=member.id===location.id?location:member;
      const kept=card&&card.previs?D.saved(card,built):null;if(!kept)return;
      const mine=D.own(kept.dressing,built,where,card.id).dressing,n=count(mine);
      if(!n&&!Object.keys(mine.surfaces).length)return;
      out=D.apply(out,mine,where.family.length>1&&k?String(k):"");
      parts+=n;isos.push(where.family.length>1?card.id+":"+kept.iso:kept.iso);
      if(!light)light=kept.dressing.light;   // the place's own light first (it comes first), else the first room's
    });
    return {scene:out,light,dressed:isos.length>0,parts,iso:isos.join("|")};
  }
  // What the place's dressing is now, as a short text: changes when any card of the place is dressed or undressed.
  function dressingSig(location,list){
    try{return root.KinolotSetDressing.place(location,list).family.map(m=>{const c=m.id===location.id?location:m;return c&&c.previs&&c.previs.iso?c.id+":"+c.previs.iso:"";}).filter(Boolean).join("|");}
    catch(_){return (location&&location.previs&&location.previs.iso)||"";}
  }
  /* THE WHOLE PLACE FROM ABOVE (owner 2026-11-16: "making sure the subspaces all connect"): the same set with its
     ceilings and roofs off, seen from high up, each space named. One 16:9 picture; free, nothing is saved. */
  async function overview(location,list,options){
    options=options||{};
    const built=scene(location,list);
    if(!root.KinolotAnglePreview)throw new Error("The 3D view did not load. Refresh this page.");
    const T=await root.KinolotAnglePreview.load();
    const floors=built.scene.objects.filter(o=>/^floor-\d+$/.test(o.id));
    if(!floors.length)throw new Error("The floor plan has no spaces yet.");
    const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];let ground=0;
    floors.forEach(f=>{for(const i of [0,1]){lo[i]=Math.min(lo[i],f.position[i]-f.size[i]/2);hi[i]=Math.max(hi[i],f.position[i]+f.size[i]/2);}ground+=f.position[2]/floors.length;});
    const ceilings=built.scene.objects.filter(o=>/^ceiling-\d+$/.test(o.id));
    const roofLine=ceilings.length?Math.min(...ceilings.map(c=>c.position[2]-c.size[2]/2)):Infinity;
    // off: every ceiling, and any dressing piece that sits over the rooms (a roof, an upper storey)
    const open={...built.scene,objects:built.scene.objects.filter(o=>!/^ceiling-\d+$/.test(o.id)
      &&!(/^(extra|dress)-/.test(o.id)&&o.position[2]-o.size[2]/2>=roofLine-0.05))};
    // by default from the side that puts the place's long side across the picture
    const yaw=Number.isFinite(options.yaw)?options.yaw:(hi[1]-lo[1]>hi[0]-lo[0]?120:30),pitch=-56,lens=35;
    const radius=Math.hypot(hi[0]-lo[0],hi[1]-lo[1])/2+1,ya=yaw*Math.PI/180,pa=pitch*Math.PI/180;
    const centre=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,ground+1],f=[Math.sin(ya)*Math.cos(pa),Math.cos(ya)*Math.cos(pa),Math.sin(pa)];
    // as close as keeps every corner of the place (floor to wall top) inside the picture
    const corners=[];for(const x of [lo[0]-0.5,hi[0]+0.5])for(const y of [lo[1]-0.5,hi[1]+0.5])for(const z of [ground,ground+2.6])corners.push([x,y,z]);
    const poseAt=d=>({position:centre.map((v,i)=>v-f[i]*d),yaw,pitch,lensMm:lens});
    const ndc=d=>{const cam=root.KinolotAnglePreview.cameraFor(T,poseAt(d));return corners.map(c=>new T.Vector3(c[0],c[1],c[2]).project(cam));};
    const fits=pts=>pts.every(p=>Math.abs(p.x)<=0.92&&Math.abs(p.y)<=0.88&&p.z<1);
    const fit=()=>{let d=Math.max(4,radius*0.6);for(let i=0;i<70&&d<170&&!fits(ndc(d));i++)d*=1.06;return Math.min(170,d);};
    // aim at the middle of what is seen, not the middle of the floor plan: a place seen at a slant sits low in the frame otherwise
    let far=fit();
    const halfV=Math.atan(36/(2*lens*16/9)),halfH=Math.atan(36/(2*lens));
    for(let round=0;round<4;round++){
      const pts=ndc(far);if(pts.some(p=>p.z>=1))break;
      const mx=(Math.max(...pts.map(p=>p.x))+Math.min(...pts.map(p=>p.x)))/2,my=(Math.max(...pts.map(p=>p.y))+Math.min(...pts.map(p=>p.y)))/2;
      if(Math.abs(mx)<0.03&&Math.abs(my)<0.03)break;
      const dx=mx*far*Math.tan(halfH),dy=my*far*Math.tan(halfV)/Math.max(0.3,Math.sin(-pa));
      centre[0]+=Math.cos(ya)*dx+Math.sin(ya)*dy;centre[1]+=-Math.sin(ya)*dx+Math.cos(ya)*dy;
      far=fit();
    }
    const pose=poseAt(far);
    const w=Math.max(480,Math.min(1600,Math.round(options.width||1280))),h=Math.round(w*9/16);
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});}
    catch(_){throw new Error("This browser could not start the 3D view. Turn on graphics acceleration and try again.");}
    const rig=build(T,{...open,cameras:{TL:pose}},built.light||null);
    try{
      renderer.setPixelRatio(1);renderer.setSize(w,h,false);renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
      const camera=root.KinolotAnglePreview.cameraFor(T,pose);
      renderer.render(rig.three,camera);
      if(renderer.getContext().isContextLost())throw new Error("The 3D view stopped. Close other heavy tabs and try again.");
      const canvas=root.document.createElement("canvas");canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext("2d");if(!ctx)throw new Error("This browser cannot draw the picture.");
      ctx.drawImage(renderer.domElement,0,0,w,h);
      // each space's name, on its floor
      const names=floors.map(f=>{const p=new T.Vector3(f.position[0],f.position[1],f.position[2]+0.1).project(camera);
        return {name:String(f.name||"").replace(/ floor$/,""),x:(p.x+1)/2*w,y:(1-p.y)/2*h,ok:p.z>-1&&p.z<1};}).filter(n=>n.ok&&n.name);
      const size=Math.round(w/42);
      ctx.font="600 "+size+"px system-ui, sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
      names.forEach(n=>{const tw=ctx.measureText(n.name).width+size,th=size+12;
        ctx.fillStyle="rgba(20,22,26,.72)";ctx.fillRect(n.x-tw/2,n.y-th/2,tw,th);ctx.fillStyle="#fff";ctx.fillText(n.name,n.x,n.y+1);});
      return {dataUrl:canvas.toDataURL(options.type||"image/jpeg",options.quality||0.9),width:w,height:h,spaces:names.map(n=>n.name),dressed:built.dressed,parts:built.parts};
    }finally{rig.dispose();renderer.dispose();renderer.forceContextLoss();}
  }

  /* FROM THE SHEET TO THE IMAGE. The image engine gets the sheet as Image 1 and the card's own prompt, in the render
     style chosen on the card (or the tab's style when the card has none): photoreal, anime, anything. The sheet
     decides where things are; the card decides what they are and how they look. */
  function stylePrompt(location,project,drawn){
    const style=typeof root.locVisualDefaults==="function"?root.locVisualDefaults(location).renderStyle:"";
    const build=typeof root.combinedLocationPrompt==="function"?root.combinedLocationPrompt:root.buildLocationRefPrompt;
    const card=typeof build==="function"?build(location,project||root.turnProject||{},{}):"";
    if(!card)throw new Error("This location's prompt could not be built. Describe the place first.");
    return "Image 1 is the 3D previs sheet of this location: ONE set seen by four cameras, a 2x2 grid of equal 16:9 panels. It is the layout to follow, and it decides every camera. "
      +"Draw each panel from exactly the camera of the same panel of Image 1: the same standpoint, height, direction, tilt, horizon line and lens. Every large shape stays where it is in that panel's frame, at its size, and what is in front of what stays so. "
      +"Keep every wall, opening, building and object, each in its place, size and proportion. "
      +"The previs is built from plain blocks: read each block as the real thing it stands for (named panel by panel below, and described in the spec) and give it its real surface, detail, edges and wear. "
      +"Do not add, remove or move buildings, objects or openings, and do not merge, swap, crop or reframe panels. Never replace a panel with a different or more flattering view of the place. "
      +"The sheet's flat colours and simple light only point to materials and the hour; the finished look is the spec's render style"+(style?" ("+style+")":"")+". "
      +"No people, no text, no labels, no borders and no panel numbers.\n"
      +(drawn&&drawn.look?"Image 2 is the finished image of "+drawn.look+", the place this space is part of. Take from it the materials, the palette, the weather and the quality of light, so that the two belong to one place. Take NO layout, camera or object from Image 2: Image 1 alone decides those.\n":"")
      +(drawn&&drawn.scene?panelText(drawn.scene,drawn.views):"")
      +"\nTHE SPEC (what things are and how they look). If it describes camera positions, views, panels or framing of its own, ignore those parts: Image 1 alone decides them.\n"+card;
  }
  // The engine and size in the top bar, as the plan allows them, and what one image from the sheet costs.
  function settings(engine,refs){
    const choice=root.nbPlanImageChoice(engine||root.nbGetModel(),root.nbGetRes()),model=choice.model;
    const quality=typeof root.isGptImageModel==="function"&&root.isGptImageModel(model)?(typeof root.nbGetOaiQuality==="function"?root.nbGetOaiQuality(model):"high"):undefined;
    return {model,imageSize:choice.res,quality,label:typeof root.nbModelLabel==="function"?root.nbModelLabel(model):model,
      cost:{model,res:choice.res,quality,aspect:"16:9",refs:refs||1,ground:false}};
  }
  /* One image call. Returns the image and what was sent; saves nothing and replaces no artwork. */
  async function style(location,sheetUrl,options){
    options=options||{};
    if(typeof root.nbGenerate!=="function")throw new Error("Sign in to make this image.");
    if(!/^data:image\//.test(String(sheetUrl||"")))throw new Error("Draw the previs sheet first.");
    const choice=options.settings||settings();
    const prompt=options.prompt||stylePrompt(location,options.project,options.drawn)+(options.after||""),metaOut={};
    const scope=root.BlenderPreview&&typeof root.BlenderPreview.scope==="function"?root.BlenderPreview.scope():null;
    const url=await root.nbGenerate(prompt,{model:choice.model,imageSize:choice.imageSize,quality:choice.quality,aspectRatio:"16:9",referenceImage:sheetUrl,
      ...(options.lookImage?{extraImages:[options.lookImage],extraImageMaxDims:[1024]}:{}),
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
  /* ...or {loc, variant:{key, asset, label, time, camera}} = one of the location's VARIANTS (a time of day or a state):
     one frame from one camera, which becomes that variant's own image (variant.asset). */
  const target=id=>id&&typeof id==="object"?{loc:String(id.loc),at:id.at||null,key:String(id.key||""),label:String(id.label||""),
      variant:id.variant&&id.variant.key&&id.variant.asset?{key:String(id.variant.key),asset:String(id.variant.asset),label:String(id.variant.label||""),
        time:String(id.variant.time||""),camera:PANELS.includes(id.variant.camera)?id.variant.camera:"TL"}:null}
    :{loc:String(id),at:null,key:"",label:"",variant:null};
  const slug=text=>String(text).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);
  const slot=id=>{const t=target(id);return "previs-draft-"+t.loc+(t.variant?"-var-"+slug(t.variant.key):t.key?"-parts-"+t.key.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,80):"");};
  const live=id=>{const l=((root.turnContinuity||{}).locations||[]).find(x=>x.id===id);if(!l)throw new Error("This location is no longer in the film.");return l;};
  const assetOf=id=>{const t=target(id);return t.variant?t.variant.asset:t.key?root.locationPartStateAssetId(live(t.loc),t.key):t.loc;};
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
  async function keys(id,list,extra){
    const t=target(id),location=live(t.loc),built=scene(location,list,t.at),C=root.KinolotRenderContract;
    // a variant: the set, its one camera and the hour's light; and the variant's own prompt
    if(t.variant)return {setKey:await C.hash(C.canonical({objects:built.scene.objects,materials:built.scene.materials,camera:built.scene.cameras[t.variant.camera]||null,
      light:lightFor(t.variant.time,built.light)||null})),lookKey:await C.hash(String(extra&&extra.spec||""))};
    const look=typeof root.locationSpecSig==="function"?String(root.locationSpecSig(location)):stylePrompt(location);
    return {setKey:await C.hash(C.canonical({scene:built.scene,light:built.light||null})),lookKey:await C.hash(String(look))};
  }
  // The finished image of the place a room is part of, when there is one: {name, url, id}.
  function look(location){
    try{
      const where=root.KinolotSetDressing.place(location),owner=where.owner;
      if(!owner||owner.id===location.id||typeof root.nbGetImage!=="function")return null;
      const url=root.nbGetImage(owner.id);
      return url?{name:String(owner.name||"the place"),url,id:owner.id}:null;
    }catch(_){return null;}
  }
  const discarded=meta=>!!(meta&&meta.approval&&meta.approval.iso===meta.iso&&meta.approval.approved===false);
  const used=meta=>!!(meta&&meta.approval&&meta.approval.iso===meta.iso&&meta.approval.approved===true);
  const mine=(meta,id,scope)=>{const t=target(id);
    return !!meta&&meta.kind==="previs-draft"&&meta.schema===1&&meta.projectId===scope.projectId&&meta.locationId===t.loc&&(meta.stateKey||"")===t.key&&(meta.variantKey||"")===(t.variant?t.variant.key:"")&&!!meta.iso;};
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
      const run=runs.get(key),cancelled=!!(run&&run.cancelled);
      if(entry&&entry.scope.epoch!==scope.epoch){unsaved.delete(key);return {running:running.has(key),unsaved:false,cancelled};}
      return {running:running.has(key),unsaved:!!entry,cancelled};
    }catch(_){return {running:false,unsaved:false,cancelled:false};}
  }
  /* CANCEL (owner 2026-11-16: "show progress and a cancel button"). Before the image request is sent, cancelling stops
     it: nothing is charged. After it is sent the engine cannot be stopped, so its result is thrown away when it comes
     back (it may still be charged) and nothing is saved. Once the draft is being saved it is too late to cancel. */
  const runs=new Map();
  function cancel(id){
    try{
      const run=runs.get(keyOf(root.BlenderPreview.scope(),id));
      if(!run)return {ok:false,reason:"finished"};
      if(run.stage==="saving")return {ok:false,reason:"saving"};
      run.cancelled=true;announce(id);return {ok:true,submitted:run.submitted};
    }catch(_){return {ok:false,reason:"finished"};}
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
      const run={cancelled:false,submitted:false,stage:"drawing"};runs.set(key,run);
      const halt=()=>{if(run.cancelled){const e=new Error(run.submitted?"Cancelled. The image request had already been sent, so it may still be charged; its result was not saved.":"Cancelled before the image request was sent. Nothing was charged.");e.code="previs_cancelled";throw e;}};
      try{
      const location=live(t.loc),built=scene(location,undefined,t.at);
      options.onPhase&&options.onPhase("drawing");
      if(t.variant){
        // ONE FRAME: the chosen camera, the hour's light; the look from the location's own finished image
        const spec=String(options.spec||"").trim();
        if(!spec)throw new Error("This variant's prompt could not be built. Describe the place first.");
        const light=lightFor(t.variant.time,built.light);
        const frame=await root.KinolotPrevis.sheet(built.scene,light,{panelWidth:1280,only:t.variant.camera,views:true});
        assertWritable(scope);
        const made=await keys(id,undefined,{spec});
        const master=typeof root.nbGetImage==="function"?root.nbGetImage(t.loc):"";
        const styleText=typeof root.locVisualDefaults==="function"?root.locVisualDefaults(location).renderStyle:"";
        options.onPhase&&options.onPhase("generating");
        const out=await style(location,frame.dataUrl,{settings:options.settings,assetId:slot(id),lookImage:master||"",
          prompt:framePrompt(spec,{scene:built.scene,views:frame.views,camera:t.variant.camera},{look:!!master,style:styleText}),
          beforeSubmit:async()=>{assertWritable(scope);halt();run.submitted=true;run.stage="generating";}});
        // what the variant's own Generate records (its place's image at that moment, the layout stamp) comes from its card
        const meta={schema:1,kind:"previs-draft",mode:"draft",projectId:scope.projectId,locationId:t.loc,variantKey:t.variant.key,variantLabel:t.variant.label,variantCamera:t.variant.camera,
          setKey:made.setKey,lookKey:made.lookKey,prompt:out.prompt,modelId:out.model,modelLabel:out.label,quality:out.quality||undefined,size:out.size,aspect:"16:9",
          iso:new Date().toISOString(),...(options.meta&&typeof options.meta==="object"?options.meta:{}),previs:{dressed:built.dressed,dressingIso:built.iso,shapes:built.scene.objects.length,frame:true}};
        const entry={key,slot:slot(id),scope,url:out.url,meta,refs:[{kind:"previs-sheet",label:"Previs frame",url:frame.dataUrl}]};
        halt();run.stage="saving";unsaved.set(key,entry);
        options.onPhase&&options.onPhase("saving");
        return await commit(entry);
      }
      const drawn=await root.KinolotPrevis.sheet(built.scene,built.light,{panelWidth:960,views:true});
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
      // a room takes its look from the finished image of its place (one place, one look)
      const whole=look(location);
      // the card's own object when the caller has it: a room's card carries its place (what it inherits), the film's saved list does not
      const card=options.location&&options.location.id===t.loc?options.location:location;
      const out=await style(card,drawn.dataUrl,{project:options.project,settings:options.settings,assetId:slot(id),
        drawn:{scene:built.scene,views:drawn.views,look:whole?whole.name:""},lookImage:whole?whole.url:"",
        after:moved?"\nMOVING PARTS AT THIS MOMENT (as drawn in the sheet): "+moved+". Where the sheet opens to the outside, show the exterior beyond as described (keep its position and size).":"",
        beforeSubmit:async()=>{assertWritable(scope);halt();run.submitted=true;run.stage="generating";}});
      const meta={schema:1,kind:"previs-draft",mode:"draft",projectId:scope.projectId,locationId:t.loc,
        ...(t.key?{stateKey:t.key,stateLabel:t.label,stateAt:t.at}:{}),
        setKey:made.setKey,lookKey:made.lookKey,prompt:out.prompt,modelId:out.model,modelLabel:out.label,quality:out.quality||undefined,size:out.size,aspect:"16:9",
        iso:new Date().toISOString(),...record,previs:{dressed:built.dressed,dressingIso:built.iso,shapes:built.scene.objects.length}};
      const entry={key,slot:slot(id),scope,url:out.url,meta,refs:[{kind:"previs-sheet",label:"Previs sheet",url:drawn.dataUrl}]};
      halt();run.stage="saving";unsaved.set(key,entry);
      options.onPhase&&options.onPhase("saving");
      return await commit(entry);
      }finally{runs.delete(key);}
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
  async function use(id,iso,extra){
    const scope=scopeNow(),t=target(id);
    assertWritable(scope);
    return locked(id,scope,async()=>{
      const saved=await root.nbLoadDetailsAsset(slot(id),"");assertWritable(scope);
      if(!saved||!saved.url||!mine(saved.meta,id,scope))throw new Error("The draft is no longer saved.");
      if(saved.meta.iso!==iso)throw new Error("Another draft is the current one now. Open the location again.");
      if(discarded(saved.meta))throw new Error("This draft was discarded. Make a new one.");
      const now=await keys(id,undefined,extra);
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
  root.KinolotPrevis={PANELS,OUT_OF_DATE,sheet,scene,dressingSig,overview,look,lightFor,framePrompt,stylePrompt,panelText,settings,style,target,slot,assetOf,keys,drafts,render,cancel,use,discard,restore,retrySave,discardUnsaved,pending};
})(typeof window!=="undefined"?window:globalThis);

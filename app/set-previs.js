/* PREVIS SHEET (trial, owner 2026-11-15). Draws a built set, with its dressing, in the browser as the four camera
   views of the location on one 16:9 sheet: lit, shadowed, in the set's own colours. No account, worker or model call;
   the sheet is what the image engine is then asked to follow. Same shapes and cameras as the layout preview. */
(function(root){
  "use strict";
  const PANELS=["TL","TR","BL","BR"];
  const SKY={day:"#9fb6c9",dusk:"#6f6a86",night:"#0b1220"};

  /* THREE LOOKS OF ONE SET (owner 2026-11-23, the Previs look brief, step 1): the same set through the same camera,
     as COLOUR (the set as built: what the image engine follows), CLAY or DEPTH. Only the materials and the ground
     colour differ, so the three agree shape for shape.
       clay   every surface in one matt white (#e9e7e2, roughness 0.95, no metal) on a pale ground (#d4d2cd), in even
              daylight whatever the hour, with the sun and its shadows kept: only form and light are left. The people
              and the props standing in the set (objects whose id starts "fig-" or "prop-") keep their own colours,
              so they are still told apart.
       depth  every surface drawn by its distance from the camera: white at 0.4 m, black at the set's far end and
              beyond, on black. The far end is one number for the whole set (depthFar), so every camera of a place
              is drawn on the same scale. */
  const CLAY={colour:0xe9e7e2,roughness:0.95,ground:0xd4d2cd,exposure:1},DEPTH={near:0.4,min:3,max:40,backdrop:80};
  /* THE LIGHT SET-UP (step 2): the sky and ground of the hemisphere light and its strength; the three suns as
     [degrees round from the place's own sun, degrees above the horizon, strength, shadow map]; the window spots
     (colour, strength, how many at most) and the room points (colour, strength). The colours, the three suns and the
     shapes of the lights are the reference's. Three strengths are higher than the reference's (its sky 0.8, room 1.3
     to 2, window 5 to 7): a room here has one room light and often one window, and at the reference's strengths it
     drew far darker than the drawing the image engine was following until now (tried side by side, 2026-11-23). */
  const RIG={sky:0xd6dde3,ground:0x8f887b,hemisphere:2.0,sun:0xe9eef2,suns:[[20,84,1.5,2048],[0,45,1.0,4096],[169,46,1.0,4096]],
    window:0xe4ebf0,windowPower:8,windows:8,room:0xe9e2d2,roomPower:6};
  // how much of the daylight is left at each hour
  const DIM={day:1,dusk:0.5,night:0.14};
  // how strongly each kind of surface mirrors the small sky (set-surfaces.js names the kinds); every other kind: not at all
  const SHEEN={metal:1.1,glass:1.6,gloss:0.5,tile:0.4};
  const LOOKS=["clay","depth"],lookOf=v=>LOOKS.includes(v)?v:"";
  // an object that stands in the set rather than being part of it: a person or a prop placed for a shot
  const standsIn=item=>/^(fig|prop)-/.test(String(item&&item.id||""));
  /* HOW FAR THE DARK END OF A DEPTH DRAWING IS: from the set's cameras to the farthest corner of the set, never under
     3 m or over 40 m. A backdrop (anything over 80 m in one direction: a sky, a far ground) is not part of it. With
     no camera, the set's own length. Plain numbers, the same on every draw. */
  function depthFar(scene,span){
    let lo=null,hi=null;
    /* THE CAMERA'S OWN SPACE (owner 2026-11-23: "go with your recommendation on depth"): a place is one set, and a
       flat's set holds its terrace, so measured to the far end of the whole set a 4 m room used only the lightest
       fifth of the range. span = the box of the space the cameras stand in (its outline, floor to ceiling): the far
       end is measured to its farthest corner, still one number for every camera of that space. */
    const box=span&&Array.isArray(span.min)&&Array.isArray(span.max)&&span.min.concat(span.max).every(n=>Number.isFinite(Number(n)))?span:null;
    if(box){lo=box.min.map(Number);hi=box.max.map(Number);}
    else
    ((scene&&scene.objects)||[]).forEach(item=>{
      if(!item||!Array.isArray(item.size)||!Array.isArray(item.position))return;
      const size=item.size.map(n=>Math.abs(Number(n)||0));
      if(Math.max(...size)>DEPTH.backdrop)return;
      // its four corners on the floor, turned as it is turned, and its bottom and top
      const p=item.position.map(Number),turn=Number((item.rotation||[])[2])||0,c=Math.cos(turn),n=Math.sin(turn),h=size[2]/2;
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(k=>{
        const x=k[0]*size[0]/2,y=k[1]*size[1]/2,at=[p[0]+x*c-y*n,p[1]+x*n+y*c];
        const a=[at[0],at[1],p[2]-h],b=[at[0],at[1],p[2]+h];
        lo=lo?lo.map((v,i)=>Math.min(v,a[i])):a;hi=hi?hi.map((v,i)=>Math.max(v,b[i])):b;
      });
    });
    if(!lo)return DEPTH.min;
    const corners=[];for(let i=0;i<8;i++)corners.push([i&1?hi[0]:lo[0],i&2?hi[1]:lo[1],i&4?hi[2]:lo[2]]);
    const cams=Object.values((scene&&scene.cameras)||{}).filter(c=>c&&Array.isArray(c.position)).map(c=>c.position.map(Number));
    const far=cams.length?Math.max(...cams.map(c=>Math.max(...corners.map(k=>Math.hypot(k[0]-c[0],k[1]-c[1],k[2]-c[2])))))
      :Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]);
    return Math.round(Math.max(DEPTH.min,Math.min(DEPTH.max,far))*100)/100;
  }
  const depthMaterial=(T,far)=>new T.ShaderMaterial({side:T.DoubleSide,uniforms:{near:{value:DEPTH.near},far:{value:far}},
    vertexShader:"varying float vz; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vz=-mv.z; gl_Position=projectionMatrix*mv; }",
    fragmentShader:"uniform float near; uniform float far; varying float vz; void main(){ float d=clamp((vz-near)/(far-near),0.0,1.0); gl_FragColor=vec4(vec3(1.0-d),1.0); }"});
  const clayMaterial=T=>new T.MeshStandardMaterial({color:CLAY.colour,roughness:CLAY.roughness,metalness:0,side:T.DoubleSide});
  /* opts.look = "clay" or "depth" (above); opts.surfaces (the location card's set card): each material gets the
     surface it names (brick, planks, tile, grass, glass that mirrors the sky ...), laid at real size, under a sky
     dome (set-surfaces.js). With neither, the set is drawn in its plain colours: the Colour drawing of the Previs
     sheet and of a shot, which the image engine follows. */
  function build(T,scene,light,opts){
    const three=new T.Scene(),disposables=[],materials=new Map(),meshes=[];
    const look=lookOf(opts&&opts.look);
    // clay is always in even daylight, with a sun to cast its shadows, whatever hour the set is lit for
    if(look==="clay")light={...(light||{}),time:"day",sky:undefined,lamps:[],sun:light&&light.sun&&light.sun.power>0?light.sun:undefined};
    const time=light&&light.time||"day";
    three.background=new T.Color(look==="clay"?CLAY.ground:look==="depth"?0x000000:light&&light.sky||SKY[time]);
    /* PAINTED SURFACES ON EVERY COLOUR DRAWING (owner 2026-11-24, the Previs look brief, step 4, stop 4: "textures on
       the Colour drawing: yes"). Until then only the location card's set card painted them; the Previs sheet and a
       shot's drawing were flat colour. Now brick, boards, tiles, carpet, wood grain and glass are drawn wherever the
       set is drawn in Colour; {surfaces:false} asks for the flat colours. Clay and Depth never have them. */
    const kit=root.KinolotSetSurfaces||null;let S=!look&&!(opts&&opts.surfaces===false)&&kit&&typeof kit.material==="function"&&kit||null;
    const place=(opts&&opts.place)||(light&&light.place)||null;
    const clay=look==="clay"?clayMaterial(T):null;if(clay)disposables.push(clay);
    /* A SHEEN (step 2): a small sky, light above and dark below, that only metal, glass, gloss paint and tiles
       mirror. It is what makes a pane read as glass and a tap as steel; a wall or a cloth mirrors nothing. */
    let dome=null;
    if(!look&&kit&&opts&&opts.renderer)try{dome=kit.sky(T,opts.renderer,light&&light.sky||SKY[time]);disposables.push(dome);}catch(_){dome=null;}
    /* THE FURNITURE KIT (step 4): a thing the kit knows by its name (a chair, a table, a door, a window, a run of
       kitchen units) is drawn as the kit's piece, at the size the set gives it, in place of its plain shapes. The
       set's own data is not touched: every check goes on reading the shapes it always read (set-kit.js). */
    let fitted=null;
    try{fitted=root.KinolotSetKit?root.KinolotSetKit.expand(scene,(opts&&opts.kit)||(light&&light.kit)||null):null;}catch(_){fitted=null;}
    if(fitted&&fitted.parts.length)scene={...scene,objects:scene.objects.filter(o=>!fitted.hide.has(o.id)).concat(fitted.parts),materials:{...scene.materials,...fitted.materials}};
    // which object wears each material: the builder's plain "floor" and "wall" are told apart by it
    const worn={};scene.objects.forEach(item=>{if(!worn[item.material])worn[item.material]=String(item.name||"");});
    // (a surface that cannot be painted never stops a drawing: the set is then drawn in its flat colours)
    if(S)try{
      Object.entries(scene.materials).forEach(([id,m])=>{materials.set(id,S.material(T,id,m,worn[id]||"",dome&&dome.texture,disposables));});
      if(dome)three.add(dome.dome);
    }catch(_){S=null;materials.clear();}
    if(!S)Object.entries(scene.materials).forEach(([id,m])=>{
      const colour=new T.Color(...m.baseColor);
      const material=new T.MeshStandardMaterial({color:colour,roughness:m.roughness==null?0.8:m.roughness,metalness:m.metallic||0,side:T.DoubleSide,
        emissive:colour,emissiveIntensity:m.emissionStrength?Math.min(2.5,m.emissionStrength*0.35):0});
      const sheen=dome&&dome.texture&&kit?SHEEN[kit.kindOf(id,worn[id]||"")]||0:0;
      if(sheen){material.envMap=dome.texture;material.envMapIntensity=sheen;}
      materials.set(id,material);disposables.push(material);
    });
    const box=new T.Box3();
    scene.objects.forEach(item=>{
      const own=standsIn(item);
      const geometry=root.KinolotAnglePreview.geometry(T,item),mesh=new T.Mesh(geometry,clay&&!own?clay:materials.get(item.material));
      disposables.push(geometry);
      mesh.userData.own=own;
      if(S)try{S.layUV(T,geometry,item.size);}catch(_){}
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
    /* SOFT LIGHT FROM THREE SIDES (owner 2026-11-23, the Previs look brief, step 2; it was one hard sun). One light
       set-up for every camera of a place:
         - the sky: a hemisphere light;
         - three soft suns that all cast shadows: one from above (1.5) and two from opposite sides (1.0 each). The
           first side light comes from where the place's own sun is, so its daylight still falls from that side;
         - window light: a spot just inside each window or glazed door of a roofed room, aimed across the room;
         - room fill: a point light under each ceiling (the builder's own room lights).
       By day a lamp is drawn but gives no light; at dusk and at night the suns and the sky are turned down and the
       lamps the dressing names are lit. The place's own fill (0 to 2) turns the sky up or down a little. */
    const rig=RIG,dim=DIM[time],fill=Math.max(0.6,Math.min(1.4,light&&light.fill!=null?Number(light.fill)||1:1));
    const skyTint=new T.Color(rig.sky).lerp(new T.Color(light&&light.sky||SKY[time]),time==="day"?0.25:0.7);
    three.add(new T.HemisphereLight(skyTint,new T.Color(rig.ground),rig.hemisphere*dim*fill));
    const own=light&&light.sun||null,from=(own&&Number.isFinite(Number(own.from))?Number(own.from):200)*Math.PI/180;
    const sunColour=new T.Color(rig.sun).lerp(new T.Color(own&&own.colour||rig.sun),0.3);
    rig.suns.forEach(u=>{
      // u = [degrees round from the place's own sun, degrees above the horizon, strength, shadow map]
      const az=from+u[0]*Math.PI/180,el=u[1]*Math.PI/180,key=new T.DirectionalLight(sunColour,u[2]*dim);
      key.position.copy(centre).add(new T.Vector3(Math.sin(az)*Math.cos(el),Math.cos(az)*Math.cos(el),Math.sin(el)).multiplyScalar(reach*2));
      key.target.position.copy(centre);three.add(key.target);
      key.castShadow=true;key.shadow.mapSize.set(u[3],u[3]);key.shadow.bias=-0.0005;key.shadow.normalBias=0.03;
      const cam=key.shadow.camera;cam.left=-reach;cam.right=reach;cam.top=reach;cam.bottom=-reach;cam.near=0.5;cam.far=reach*4.5;cam.updateProjectionMatrix();
      three.add(key);
    });
    // window light, by day and at dusk: where the daylight comes into each room
    if(time!=="night"&&T.SpotLight)((place&&place.windows)||[]).slice(0,rig.windows).forEach(w=>{
      const spot=new T.SpotLight(new T.Color(rig.window),rig.windowPower*dim,14,1.4,1,1.25);
      spot.position.set(...w.at);spot.target.position.set(...w.to);three.add(spot.target);
      spot.castShadow=true;spot.shadow.mapSize.set(512,512);spot.shadow.bias=-0.002;spot.shadow.normalBias=0.02;
      const cam=spot.shadow.camera;if(cam){cam.near=0.08;cam.far=12;}
      three.add(spot);
    });
    // room fill: the lights the builder placed under each ceiling
    (scene.previewLights||[]).forEach(l=>{
      const p=new T.PointLight(new T.Color(...l.colour).lerp(new T.Color(rig.room),0.5),rig.roomPower*(time==="night"?0.6:1),7,1.4);
      p.position.set(...l.position);three.add(p);
    });
    // by day a fitting is drawn but gives no light (the master view is daylight; the film's hours are variants)
    (time==="day"?[]:light&&light.lamps||[]).forEach(l=>{
      const p=new T.PointLight(new T.Color(l.colour),l.power*16,0,1.7);p.position.set(...l.at);three.add(p);
    });
    const far=depthFar(scene,place&&place.span);
    if(look==="depth"){const depth=depthMaterial(T,far);disposables.push(depth);three.overrideMaterial=depth;}
    return {three,meshes,look,far,kit:fitted?fitted.pieces:[],dispose:()=>disposables.forEach(d=>d.dispose())};
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
  /* A VARIANT COMES FROM THE LOCATION IMAGE (owner 2026-11-16: "variants should be deriving from already generated
     location image ... the image a user chooses to be the location image", so that nothing is drawn again from the 3D
     set and no new mistake can come in). A variant is ONE frame: one of the location image's four views (or the whole
     image, when it is not a four-view sheet), redrawn at the variant's hour or in its state, with nothing else changed. */
  function relightPrompt(info){
    info=info||{};
    return "Image 1 is the finished image of this place from one camera, as it usually is by day. Redraw EXACTLY this picture at another hour or in another state. "
      +"Keep the camera and the framing, and keep every building, wall, opening and object exactly where it is, at its size, with the same materials, colours and details. Add nothing, remove nothing and move nothing. "
      +"Change only what the hour, the weather and the state below change: the light and its direction, the sky, which lamps and windows are lit, shadows, wet or dry ground, and what the notes below name. "
      +"The place as it normally is at that hour: no people, and no marks of one scene (nothing knocked over, spilled or broken) unless the notes say so. "
      +"One full-frame 16:9 image, not a grid. No text, no labels and no borders."+(info.style?" Keep the look of Image 1: "+info.style+".":"")
      +"\nTHIS VARIANT: "+String(info.notes||"").trim();
  }
  // The location image a variant is made from: one of its four views cut out, or the whole image. {dataUrl, iso, sheet}
  const cuts=new Map();
  async function variantSource(locationId,camera){
    const saved=await root.nbLoadDetailsAsset(locationId,"");
    if(!saved||!saved.url)throw new Error("This place has no location image yet. Choose the location image first.");
    const meta=saved.meta||{},four=!!(meta.platePanels||meta.previs||meta.plateLayoutSig);
    let data=saved.url;
    if(!/^data:image\//i.test(data)){
      if(typeof root.oaiToDataUrl!=="function")throw new Error("The location image could not be read. Reload the page.");
      data=await root.oaiToDataUrl(saved.url);
    }
    if(!data)throw new Error("The location image could not be read. Check your connection and try again.");
    const info=root.LOC_PANEL_INFO&&root.LOC_PANEL_INFO[camera];
    if(four&&info&&info.crop&&typeof root.cropRegionAsDataUrl==="function"){
      // one cut per image and view: every variant of a place opens on the same view of the same image
      const memo=[saved.url,String(meta.iso||""),camera].join("|");
      let cutOut=cuts.get(memo);
      if(!cutOut){
        cutOut=await root.cropRegionAsDataUrl(data,info.crop,1536,1024);
        if(cutOut){if(cuts.size>=8)cuts.delete(cuts.keys().next().value);cuts.set(memo,cutOut);}
      }
      if(cutOut)return {dataUrl:cutOut,iso:String(meta.iso||""),sheet:true};
    }
    return {dataUrl:data,iso:String(meta.iso||""),sheet:false};
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
    // options.look: the sheet as clay or as depth (the Colour sheet, with no look, is what the image engine follows)
    const rig=build(T,scene,light||null,{look:options.look,surfaces:options.surfaces,renderer});
    try{
      renderer.setPixelRatio(1);renderer.setSize(w,h,false);renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=options.exposure||(rig.look==="clay"?CLAY.exposure:1);
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
  /* A LIVE VIEW of the set as Previs draws it (owner 2026-11-16: "the camera tool shows the set as dressed"): the set
     is built once, lit as the sheet is, and then drawn from any camera as often as wanted. viewer(scene, light) gives
     {render(canvas, pose, width, height, look, cast), dispose()}: render draws one 16:9 frame onto a 2D canvas (look and
     cast are the location card's: the clay or depth look, and stand-in people). options.surfaces = painted surfaces. The sun's shadows
     are worked out once, since nothing in the set moves. Throws when the browser cannot start the 3D view. */
  async function viewer(scene,light,options){
    if(!root.KinolotAnglePreview)throw new Error("The 3D view did not load. Refresh this page.");
    const T=await root.KinolotAnglePreview.load();
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});}
    catch(_){throw new Error("This browser could not start the 3D view. Turn on graphics acceleration and try again.");}
    // options.look: the whole view built as clay or depth (a shot's Previs); options.surfaces:false = flat colours
    const rig=build(T,scene,light||null,{look:options&&options.look,surfaces:options&&options.surfaces,renderer});
    let w=0,h=0,dead=false,drawn=false;
    const exposure=rig.look==="clay"?CLAY.exposure:1;
    renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=exposure;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    /* A LOOK FOR ONE DRAWING (the location card's Colour / Clay / Depth switch): a view built in colour draws one
       frame as clay or depth and is put back as it was, so the card keeps a single 3D view for all three. The same
       clay, the same depth and the same far end as a view built in that look. */
    let clay=null,depth=null;
    /* THE STAND-IN PEOPLE (the set card's A and B): cast = [{xy, z, to:[x,y], colour, height}], each a jointed figure
       standing at xy on the floor at height z, turned to face `to`. They are part of the view, never of the set. */
    const actors=[];let castKey="";
    const place=cast=>{
      const S=root.KinolotSetSurfaces,list=S&&Array.isArray(cast)?cast.filter(c=>c&&Array.isArray(c.xy)):[];
      const key=JSON.stringify(list);if(key===castKey)return;castKey=key;
      while(actors.length>list.length){const g=actors.pop();rig.three.remove(g);S.disposeMannequin(g);}
      list.forEach((c,i)=>{
        if(!actors[i]||actors[i].userData.made!==c.colour+"|"+c.height){
          if(actors[i]){rig.three.remove(actors[i]);S.disposeMannequin(actors[i]);}
          actors[i]=S.mannequin(T,c.height,c.colour);actors[i].userData.made=c.colour+"|"+c.height;rig.three.add(actors[i]);
        }
        actors[i].position.set(c.xy[0],c.xy[1],Number(c.z)||0);
        if(Array.isArray(c.to))S.face(actors[i],c.xy,c.to);
      });
      rig.three.updateMatrixWorld(true);
      renderer.shadowMap.needsUpdate=true;   // someone moved: the sun's shadows are worked out again, once
    };
    return {
      look:rig.look,far:rig.far,kit:rig.kit,
      render(canvas,pose,width,height,look,cast){
        if(dead)throw new Error("This view was closed.");
        width=Math.max(16,Math.round(width||canvas.width||640));height=Math.max(9,Math.round(height||canvas.height||360));
        if(width!==w||height!==h){renderer.setSize(width,height,false);w=width;h=height;}
        place(cast);
        look=rig.look?"":lookOf(look);   // a view built in a look is that look already
        if(look){
          const camera=root.KinolotAnglePreview.cameraFor(T,pose),sky=rig.three.background,swapped=[],hidden=[];
          rig.three.traverse(o=>{if(o.userData&&o.userData.sky&&o.visible){o.visible=false;hidden.push(o);}});
          if(look==="clay"){
            if(!clay)clay=clayMaterial(T);
            // the set in clay; what stands in it (a stand-in person, a placed prop) keeps its colours
            rig.meshes.forEach(m=>{if(m.userData.own)return;swapped.push([m,m.material]);m.material=clay;});
            rig.three.background=new T.Color(CLAY.ground);renderer.toneMappingExposure=CLAY.exposure;
          }else{
            if(!depth)depth=depthMaterial(T,rig.far);
            rig.three.overrideMaterial=depth;rig.three.background=new T.Color(0x000000);
          }
          try{renderer.render(rig.three,camera);}
          finally{rig.three.overrideMaterial=null;rig.three.background=sky;renderer.toneMappingExposure=exposure;
            swapped.forEach(q=>{q[0].material=q[1];});hidden.forEach(o=>{o.visible=true;});}
        }else{
          renderer.render(rig.three,root.KinolotAnglePreview.cameraFor(T,pose));
        }
        if(renderer.getContext().isContextLost())throw new Error("The 3D view stopped. Close other heavy tabs and try again.");
        if(!drawn){drawn=true;renderer.shadowMap.autoUpdate=false;}
        if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
        const ctx=canvas.getContext("2d");if(!ctx)throw new Error("This browser cannot draw the view.");
        ctx.drawImage(renderer.domElement,0,0,width,height);
      },
      dispose(){if(dead)return;dead=true;if(clay)clay.dispose();if(depth)depth.dispose();
        if(root.KinolotSetSurfaces)actors.forEach(g=>root.KinolotSetSurfaces.disposeMannequin(g));
        rig.dispose();renderer.dispose();renderer.forceContextLoss();}
    };
  }
  /* THE SET AS PREVIS DRAWS IT: the built floor plan with the dressing on. ONE PLACE, ONE SET (owner 2026-11-16): a
     place's floor plan holds all its rooms, so every card of the place is drawn from the same model, with the dressing
     of EVERY card of the place on (each card dresses its own space: set-dressing.js own). Only the four cameras differ.
     `at` = a story moment (moving parts): the set as it stands then. Throws the builder's own sentence when the floor
     plan or cameras are not ready. */
  function scene(location,list,at){
    if(!root.KinolotCloudRender||!root.KinolotSetDressing)throw new Error("The 3D view did not load. Refresh this page.");
    const D=root.KinolotSetDressing,built=root.KinolotCloudRender.buildScene(location,list,at||undefined);
    const where=D.place(location,list),count=D.count,kit={};
    let out=built,parts=0,light=null;const isos=[];
    where.family.forEach((member,k)=>{
      // the card on screen may be newer than the film's saved list
      const card=member.id===location.id?location:member;
      const kept=card&&card.previs?D.saved(card,built):null;if(!kept)return;
      const mine=D.own(kept.dressing,built,where,card.id).dressing,n=count(mine);
      if(!n&&!Object.keys(mine.surfaces).length)return;
      // (the kit pieces a dressing named travel beside the set, by the id of each one's box: set-dressing.js applied)
      const drawn=D.applied(out,mine,where.family.length>1&&k?String(k):"");
      out=drawn.scene;Object.assign(kit,drawn.kit);
      parts+=n;isos.push(where.family.length>1?card.id+":"+kept.iso:kept.iso);
      if(!light)light=kept.dressing.light;   // the place's own light first (it comes first), else the first room's
    });
    // (the place's own facts for the drawing ride with its light: where daylight comes in, and the card's own space)
    const facts=placeFacts(location,list),known=facts.windows.length>0||!!facts.span;
    const named=Object.keys(kit).length>0;
    // (what hangs on a wall is moved out of the wall's thickness onto its face: set-dressing.js seated)
    if(typeof D.seated==="function")out=D.seated(out);
    return {scene:out,light:light||known||named?{...(light||{}),place:facts,...(named?{kit}:{})}:null,dressed:isos.length>0,parts,iso:isos.join("|")};
  }
  // the light as the dressing saved it (null when the set is not dressed), without the place's facts added for drawing
  function lightAsSaved(light){
    if(!light||typeof light!=="object")return null;
    const own={};Object.keys(light).forEach(k=>{if(k!=="place"&&k!=="kit")own[k]=light[k];});
    return Object.keys(own).length?own:null;
  }
  /* WHAT THE DRAWING NEEDS TO KNOW OF THE PLACE, from its floor plan (never throws; an unknown is left out):
       windows  [{at, to}] for each window or glazed opening of a roofed space: a point 35 cm inside the glass at
                1.6 m, and the point 4 m across the room it is aimed at (the window light)
       span     {min, max}: the box of this card's own space, floor to ceiling (3 m for open air): what a depth
                drawing measures its far end in */
  function placeFacts(location,list){
    const out={windows:[],span:null};
    try{
      const st=root.locationSpatialPlanState(location,list),owner=st&&st.owner||location;
      const plan=root.locationFloorPlanScene(owner,st&&st.plan,list),coords=((st&&st.plan&&st.plan.coordinates)||{}).spaces||[];
      const inside=(pt,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
        if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/((b[1]-a[1])||1e-9)+a[0])hit=!hit;}return hit;};
      const roofed=id=>{const c=coords.find(x=>x&&x.id===id);return !!c&&!c.openSky;},heightOf=id=>{const c=coords.find(x=>x&&x.id===id);return c&&!c.openSky&&Number(c.ceilingH)>0?Number(c.ceilingH):3;};
      (plan.openings||[]).forEach(o=>{
        if(!o||o.outlier||!(o.kind==="window"||o.kind==="glass")||!Array.isArray(o.a)||!Array.isArray(o.b))return;
        const space=(plan.spaces||[]).find(x=>x.id===o.spaceId);if(!space||!roofed(space.id))return;
        const dx=o.b[0]-o.a[0],dy=o.b[1]-o.a[1],l=Math.hypot(dx,dy)||1,n=[-dy/l,dx/l],c=o.centre,z=Number(space.floorZ)||0;
        // into the room: the side of the opening that is inside this space
        const side=inside([c[0]+n[0]*0.4,c[1]+n[1]*0.4],space.footprint)?1:inside([c[0]-n[0]*0.4,c[1]-n[1]*0.4],space.footprint)?-1:0;
        if(!side)return;
        const r=v=>Math.round(v*100)/100;
        out.windows.push({at:[r(c[0]+n[0]*side*0.35),r(c[1]+n[1]*side*0.35),r(z+1.6)],to:[r(c[0]+n[0]*side*4),r(c[1]+n[1]*side*4),r(z+0.7)]});
      });
      const me=(plan.spaces||[]).find(x=>x.id===location.id);
      if(me&&me.footprint.length>=3){
        const xs=me.footprint.map(q=>q[0]),ys=me.footprint.map(q=>q[1]),z=Number(me.floorZ)||0;
        out.span={min:[Math.min(...xs),Math.min(...ys),z],max:[Math.max(...xs),Math.max(...ys),z+heightOf(me.id)]};
      }
    }catch(_){}
    return out;
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
  /* THE CARD'S SPEC, FOR AN IMAGE MADE FROM THE 3D SET (2026-11-16). The card's own prompt is written for an image made
     from words: it opens with "render this sheet EXACTLY as specified" and carries a view plan in words (a wide
     establishing view, an interior of the hallway...). Beside a 3D sheet that plan is a second, different set of
     cameras, and the engine followed parts of each. So the view plan is taken out and the opening line says what
     the spec is for. Anything that cannot be read as that spec is passed as it is. */
  function specFromSet(card){
    const text=String(card||""),a=text.indexOf("{"),b=text.lastIndexOf("}");
    if(a<0||b<=a)return text;
    let spec=null;try{spec=JSON.parse(text.slice(a,b+1));}catch(_){return text;}
    if(!spec||typeof spec!=="object"||Array.isArray(spec))return text;
    if(spec.views)spec.views={decided_by:"Image 1, the 3D previs sheet. Each panel's camera and what it shows are the previs panel's; no other view plan applies."};
    return "This place as a JSON spec: what things are, what they are made of and how they look. Its continuity fields are binding for materials, sizes and fixed features; it does not decide any camera.\n"
      +JSON.stringify(spec)+text.slice(b+1);
  }
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
      +"The four panels meet edge to edge: draw nothing along the lines where they meet, no post, frame, bar, border or gap. "
      +"Every object stands as its block stands in Image 1. Where the spec says that something happens to an object in one scene (it is knocked over, spilled, broken, trampled, moved or left open), do not draw that: draw the place as it normally is. "
      +"The sheet's drawn surfaces and simple light only point to materials and the hour; the finished look is the spec's render style"+(style?" ("+style+")":"")+". "
      +"No people, no text, no labels, no borders and no panel numbers.\n"
      +(drawn&&drawn.look?"Image 2 is the finished image of "+drawn.look+", the place this space is part of. Take from it the materials, the palette, the weather and the quality of light, so that the two belong to one place. Take NO layout, camera or object from Image 2: Image 1 alone decides those.\n":"")
      +(drawn&&drawn.scene?panelText(drawn.scene,drawn.views):"")
      +"\nTHE SPEC (what things are and how they look). If it describes camera positions, views, panels or framing of its own, ignore those parts: Image 1 alone decides them.\n"+specFromSet(card);
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
    const t=target(id),location=live(t.loc),C=root.KinolotRenderContract;
    // a variant: the location image it is made from (that version, that view), and the variant's own notes
    if(t.variant){
      const image=await root.nbLoadDetailsAsset(t.loc,"");
      return {setKey:await C.hash(C.canonical({image:String(image&&image.meta&&image.meta.iso||""),view:t.variant.camera})),lookKey:await C.hash(String(extra&&extra.spec||""))};
    }
    const built=scene(location,list,t.at);
    const look=typeof root.locationSpecSig==="function"?String(root.locationSpecSig(location)):stylePrompt(location);
    // (the place's facts that ride with the light are not part of what a draft was made from: a draft made before
    //  they were added must still match)
    return {setKey:await C.hash(C.canonical({scene:built.scene,light:lightAsSaved(built.light)})),lookKey:await C.hash(String(look))};
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
      const location=live(t.loc);
      options.onPhase&&options.onPhase("drawing");
      if(t.variant){
        // FROM THE LOCATION IMAGE: its chosen view, redrawn at the variant's hour; nothing is drawn again from the 3D set
        const notes=String(options.spec||"").trim();
        if(!notes)throw new Error("Say when or in what state this variant is first.");
        const from=await variantSource(t.loc,t.variant.camera);
        assertWritable(scope);
        const made=await keys(id,undefined,{spec:notes});
        const styleText=typeof root.locVisualDefaults==="function"?root.locVisualDefaults(location).renderStyle:"";
        options.onPhase&&options.onPhase("generating");
        const out=await style(location,from.dataUrl,{settings:options.settings,assetId:slot(id),prompt:relightPrompt({notes,style:styleText}),
          beforeSubmit:async()=>{assertWritable(scope);halt();run.submitted=true;run.stage="generating";}});
        // what the variant's own Generate records (its place's image at that moment, the layout stamp) comes from its card
        const meta={schema:1,kind:"previs-draft",mode:"draft",projectId:scope.projectId,locationId:t.loc,variantKey:t.variant.key,variantLabel:t.variant.label,variantCamera:from.sheet?t.variant.camera:"",
          setKey:made.setKey,lookKey:made.lookKey,prompt:out.prompt,modelId:out.model,modelLabel:out.label,quality:out.quality||undefined,size:out.size,aspect:"16:9",
          iso:new Date().toISOString(),...(options.meta&&typeof options.meta==="object"?options.meta:{}),madeFrom:{locationImage:from.iso,view:from.sheet?t.variant.camera:"whole"}};
        const entry={key,slot:slot(id),scope,url:out.url,meta,refs:[{kind:"previs-sheet",label:"The location image, by day",url:from.dataUrl}]};
        halt();run.stage="saving";unsaved.set(key,entry);
        options.onPhase&&options.onPhase("saving");
        return await commit(entry);
      }
      const built=scene(location,undefined,t.at);
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
      // ONE PASS (2026-11-21): while the place has no image yet, the caller hands over the place's DRAFT (options.look)
      const given=options.look&&options.look.url&&String(options.look.id||"")!==t.loc?{name:String(options.look.name||"the place"),url:String(options.look.url),id:String(options.look.id||""),draft:true}:null;
      const whole=look(location)||given;
      // the card's own object when the caller has it: a room's card carries its place (what it inherits), the film's saved list does not
      const card=options.location&&options.location.id===t.loc?options.location:location;
      const out=await style(card,drawn.dataUrl,{project:options.project,settings:options.settings,assetId:slot(id),
        drawn:{scene:built.scene,views:drawn.views,look:whole?whole.name:""},lookImage:whole?whole.url:"",
        after:moved?"\nMOVING PARTS AT THIS MOMENT (as drawn in the sheet): "+moved+". Where the sheet opens to the outside, show the exterior beyond as described (keep its position and size).":"",
        beforeSubmit:async()=>{assertWritable(scope);halt();run.submitted=true;run.stage="generating";}});
      const meta={schema:1,kind:"previs-draft",mode:"draft",projectId:scope.projectId,locationId:t.loc,
        ...(t.key?{stateKey:t.key,stateLabel:t.label,stateAt:t.at}:{}),
        setKey:made.setKey,lookKey:made.lookKey,prompt:out.prompt,modelId:out.model,modelLabel:out.label,quality:out.quality||undefined,size:out.size,aspect:"16:9",
        iso:new Date().toISOString(),...record,previs:{dressed:built.dressed,dressingIso:built.iso,shapes:built.scene.objects.length},
        ...(whole&&whole.draft?{lookFromDraft:true}:{})};
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
  /* DELETE A DRAFT FOR GOOD (owner 2026-11-16: "give the user the option to delete drafts"): the current draft or an
     earlier one. Its file is removed; no image of the film is touched. When the current draft is deleted, the draft
     made before it is the current one again. The card asks before calling this. */
  async function remove(id,iso){
    const scope=scopeNow();assertWritable(scope);
    return locked(id,scope,async()=>{
      const saved=await root.nbLoadDetailsAsset(slot(id),"");assertWritable(scope);
      if(!iso||!saved)throw new Error("That draft is no longer saved.");
      if(saved.url&&saved.meta&&saved.meta.iso===iso){
        if(!mine(saved.meta,id,scope))throw new Error("That draft is no longer saved.");
        const earlier=(saved.history||[]).some(d=>d&&d.url);
        const done=earlier?await root.nbDeleteCurrentAndPromoteAsset(slot(id)):await root.nbClearAsset(slot(id));
        if(earlier&&!done)throw new Error("The draft could not be deleted. Nothing was changed.");
        return {deleted:iso,current:true};
      }
      const index=(saved.history||[]).findIndex(d=>d&&d.meta&&d.meta.iso===iso&&mine(d.meta,id,scope));
      if(index<0)throw new Error("That draft is no longer saved.");
      const done=await root.nbDeleteHistoryEntry(slot(id),index);
      if(!done)throw new Error("The draft could not be deleted. Nothing was changed.");
      return {deleted:iso,current:false};
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
  root.KinolotPrevis={PANELS,OUT_OF_DATE,LOOKS,CLAY,DEPTH,RIG,depthFar,placeFacts,specFromSet,sheet,viewer,scene,dressingSig,overview,look,relightPrompt,variantSource,stylePrompt,panelText,settings,style,target,slot,assetOf,keys,drafts,render,cancel,use,discard,remove,restore,retrySave,discardUnsaved,pending};
})(typeof window!=="undefined"?window:globalThis);

/* THREE LOOKS OF ONE SET (owner 2026-11-23, the Previs look brief, step 1: "clay and depth").
   The same set through the same camera as Colour (the set as built: what the image engine follows), Clay and Depth.
   What must stay true: one place is one set, built once; every picture is that set through a camera; only the
   materials and the ground colour differ between looks.
     - build() takes {look:"clay"|"depth"}; sheet(), viewer(), ShotPrevis.pair() and beat() pass it through.
     - Clay: one material (#e9e7e2, roughness 0.95, no metal) on #d4d2cd; objects whose id starts "fig-" or "prop-"
       keep their own colours; always even daylight, with the sun and its shadows.
     - Depth: one override shader; 0.4 m is white, the far end is black, the ground black; the far end is the
       distance from the set's cameras to its farthest corner, 3 to 40 m, a backdrop over 80 m left out.
     - A Colour / Clay / Depth switch on the location card's 3D view and on a shot card's Previs; each look kept
       apart for the session; frames and location images still made from the Colour drawing. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const previs=read("app/set-previs.js"), shot=read("app/shot-previs.js"), shotUi=read("app/shot-previs-ui.jsx"), stepUi=read("app/set-previs-ui.jsx");
const card=read("app/location-set-card.js"), face=read("app/location-set-card-ui.jsx"), css=read("app/styles.css"), html=read("TURN.html"), ai=read("app/ai.jsx");
let pass=0, fail=0;
const test=async(name,fn)=>{ try{ await fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };

/* a stand-in 3D library: it draws nothing and remembers what each drawing was asked for */
function harness(){
  const drawn=[];
  class Color{ constructor(...a){ this.args=a; } lerp(){ return this; } }
  class Vector3{ constructor(x=0,y=0,z=0){ this.x=x; this.y=y; this.z=z; } copy(v){ this.x=v.x; this.y=v.y; this.z=v.z; return this; } add(){ return this; } multiplyScalar(){ return this; } length(){ return 10; } set(x,y,z){ this.x=x; this.y=y; this.z=z; } }
  class Material{ constructor(o){ Object.assign(this,o||{}); this.userData={}; } dispose(){ this.gone=true; } }
  class MeshStandardMaterial extends Material{ constructor(o){ super(o); this.kind="standard"; } }
  class ShaderMaterial extends Material{ constructor(o){ super(o); this.kind="shader"; } }
  class Obj{ constructor(){ this.children=[]; this.userData={}; this.visible=true; this.position=new Vector3(); this.scale=new Vector3(1,1,1); this.quaternion={setFromRotationMatrix(){}}; this.target={position:new Vector3()}; this.shadow={mapSize:{set(){}},camera:{updateProjectionMatrix(){}}}; }
    add(o){ this.children.push(o); } remove(o){ this.children=this.children.filter(x=>x!==o); } updateMatrixWorld(){} traverse(f){ f(this); this.children.forEach(c=>c.traverse?c.traverse(f):f(c)); } }
  class Scene extends Obj{ constructor(){ super(); this.background=null; this.overrideMaterial=null; this.fog=null; } }
  class Mesh extends Obj{ constructor(g,m){ super(); this.geometry=g; this.material=m; this.isMesh=true; } }
  class Light extends Obj{ constructor(colour,power){ super(); this.colour=colour; this.power=power; this.isLight=true; this.type=new.target.name; } }
  class HemisphereLight extends Light{ constructor(sky,ground,power){ super(sky,power); this.ground=ground; } } class AmbientLight extends Light{} class DirectionalLight extends Light{} class PointLight extends Light{} class SpotLight extends Light{}
  class Matrix4{ makeRotationZ(){ return this; } makeRotationY(){ return this; } makeRotationX(){ return this; } multiply(){ return this; } }
  class Box3{ expandByPoint(){ return this; } getCenter(v){ return v; } getSize(v){ return v; } }
  class WebGLRenderer{ constructor(){ this.shadowMap={}; this.domElement={}; this.toneMappingExposure=1; }
    setPixelRatio(){} setSize(){} getContext(){ return {isContextLost:()=>false}; } dispose(){} forceContextLoss(){}
    render(scene,camera){ drawn.push({override:scene.overrideMaterial,ground:scene.background,exposure:this.toneMappingExposure,camera,
      meshes:scene.children.filter(c=>c.isMesh).map(m=>({id:m.userData.id||m.geometry&&m.geometry.of,material:m.material,own:!!m.userData.own})),
      lights:scene.children.filter(c=>c.isLight).map(l=>l.type),rig:scene.children.filter(c=>c.isLight).map(l=>({type:l.type,power:l.power,at:[l.position.x,l.position.y,l.position.z],to:[l.target.position.x,l.target.position.y,l.target.position.z]}))}); } }
  const T={Color,Vector3,MeshStandardMaterial,ShaderMaterial,Scene,Mesh,HemisphereLight,AmbientLight,DirectionalLight,PointLight,SpotLight,Matrix4,Box3,WebGLRenderer,DoubleSide:2,SRGBColorSpace:"srgb",ACESFilmicToneMapping:4,PCFSoftShadowMap:2};
  const canvas=()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=>"data:image/png;base64,AAAA"});
  const box={console,document:{createElement:()=>canvas()}};box.window=box;vm.createContext(box);
  box.KinolotAnglePreview={load:async()=>T,geometry:(_,item)=>({of:item.id,dispose(){}}),cameraFor:(_,pose)=>({pose})};
  vm.runInContext(previs,box,{filename:"set-previs.js"});
  // tag each mesh with its object's id, as the test reads the drawing by it
  const scene=()=>({materials:{wall:{baseColor:[0.5,0.5,0.5],roughness:0.7},oak:{baseColor:[0.4,0.25,0.1]},skin:{baseColor:[0.1,0.6,0.2]},red:{baseColor:[0.8,0.1,0.1]}},
    objects:[{id:"floor-0",name:"Room floor",kind:"box",material:"oak",size:[4,3,0.15],position:[2,1.5,-0.075],rotation:[0,0,0]},
      {id:"wall-0",name:"Room wall",kind:"box",material:"wall",size:[4,0.15,2.4],position:[2,3,1.2],rotation:[0,0,0]},
      {id:"fig-ana",name:"ANA (stand-in)",kind:"box",material:"skin",size:[0.4,0.3,1.7],position:[1,1,0.85],rotation:[0,0,0]},
      {id:"prop-keys",name:"Keys (prop stand-in)",kind:"box",material:"red",size:[0.1,0.1,0.05],position:[1,1.4,1],rotation:[0,0,0]}],
    cameras:{TL:{position:[0.5,0.5,1.5],yaw:45,pitch:0,lensMm:24},TR:{position:[3.5,0.5,1.5],yaw:315,pitch:0,lensMm:24},
      BL:{position:[0.5,2.5,1.5],yaw:135,pitch:0,lensMm:28},BR:{position:[3.5,2.5,1.5],yaw:225,pitch:0,lensMm:35}},previewLights:[]});
  return {P:box.KinolotPrevis,drawn,canvas,scene,T,box};
}
const idOf=m=>m.material&&m.material.color&&m.material.color.args;

await test("1 the far end of a depth drawing: from the set's cameras to its farthest corner, 3 to 40 m, a backdrop left out", ()=>{
  const {P,scene}=harness();
  const room=scene();
  // camera TL at (0.5, 0.5, 1.5); the farthest corner of the set is the far bottom corner beyond its back wall
  assert.equal(P.depthFar(room),Math.round(Math.hypot(4-0.5,3.075-0.5,1.5+0.15)*100)/100);
  // a backdrop larger than 80 m in one direction is not part of the set
  const sky={id:"sky",kind:"box",material:"wall",size:[400,400,1],position:[0,0,50],rotation:[0,0,0]};
  assert.equal(P.depthFar({...room,objects:room.objects.concat([sky])}),P.depthFar(room));
  // a turned object reaches where its turned corners are
  const turned={...room,objects:[{id:"b",size:[10,0.2,1],position:[0,0,0.5],rotation:[0,0,Math.PI/2]}],cameras:{TL:{position:[0,0,0.5]}}};
  assert.equal(P.depthFar(turned),Math.round(Math.hypot(0.1,5,0.5)*100)/100);
  // never under 3 m, never over 40 m; with no camera, the set's own length; an empty set is 3 m
  assert.equal(P.depthFar({objects:[{id:"a",size:[1,1,1],position:[0,0,0.5]}],cameras:{TL:{position:[0,0,0.5]}}}),3);
  assert.equal(P.depthFar({objects:[{id:"g",size:[70,70,1],position:[0,0,0]}],cameras:{TL:{position:[0,0,1.5]}}}),40);
  assert.equal(P.depthFar({objects:[{id:"a",size:[6,8,0],position:[0,0,0]}],cameras:{}}),10);
  assert.equal(P.depthFar({objects:[]}),3); assert.equal(P.depthFar(null),3);
  assert.deepEqual(JSON.parse(JSON.stringify(P.DEPTH)),{near:0.4,min:3,max:40,backdrop:80});
});

await test("2 clay: one matt white for the set on a pale ground, in even daylight; people and props keep their colours", async()=>{
  const h=harness(), night={time:"night",sky:"#0b1220",sun:{from:200,height:30,colour:"#8090ff",power:0},lamps:[{at:[1,1,2],colour:"#ffd9a0",power:1}]};
  const view=await h.P.viewer(h.scene(),night,{look:"clay"});
  assert.equal(view.look,"clay");
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  const d=h.drawn[0], clay=d.meshes.find(m=>m.id===undefined)||d.meshes[0];
  const set=d.meshes.filter(m=>!m.own), own=d.meshes.filter(m=>m.own);
  assert.equal(set.length,2); assert.equal(own.length,2,"fig- and prop- objects are told apart");
  assert.ok(set.every(m=>m.material===set[0].material),"every surface of the set wears the one clay material");
  assert.equal(set[0].material.color,0xe9e7e2); assert.equal(set[0].material.roughness,0.95); assert.equal(set[0].material.metalness,0);
  assert.ok(own.every(m=>m.material!==set[0].material)&&own[0].material!==own[1].material,"each keeps its own colour");
  assert.deepEqual(d.ground.args,[0xd4d2cd]); assert.equal(d.override,null);
  // even daylight whatever the hour: the sun is kept (it casts the shadows), and no night lamp is lit
  assert.ok(d.lights.includes("DirectionalLight"),"a set lit for night still has its sun in clay");
  assert.ok(!d.lights.includes("PointLight"),"lamps give no light by day");
  assert.equal(d.exposure,h.P.CLAY.exposure);
  view.dispose();
  // the same set in colour, at night: its own materials, its night lamp lit, the daylight turned right down
  const colour=await h.P.viewer(h.scene(),night);
  colour.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  const c=h.drawn[1];
  assert.equal(new Set(c.meshes.map(m=>m.material)).size,4); assert.ok(c.lights.includes("PointLight"),"the lamp is lit at night");
  const day=d.rig.filter(l=>l.type==="DirectionalLight").map(l=>l.power), dark=c.rig.filter(l=>l.type==="DirectionalLight").map(l=>l.power);
  assert.deepEqual(day,[1.5,1,1]); assert.ok(dark.every((p,i)=>Math.abs(p-day[i]*0.14)<1e-9),"night keeps 14% of the daylight");
  assert.equal(c.exposure,1); assert.equal(colour.look,"");
});

await test("3 depth: one override shader; 0.4 m is white, the set's far end is black, the ground black", async()=>{
  const h=harness(), room=h.scene();
  const view=await h.P.viewer(room,null,{look:"depth"});
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  const d=h.drawn[0];
  assert.equal(d.override.kind,"shader");
  assert.equal(d.override.uniforms.near.value,0.4); assert.equal(d.override.uniforms.far.value,h.P.depthFar(room)); assert.equal(view.far,h.P.depthFar(room));
  assert.equal(d.override.vertexShader,"varying float vz; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vz=-mv.z; gl_Position=projectionMatrix*mv; }");
  assert.equal(d.override.fragmentShader,"uniform float near; uniform float far; varying float vz; void main(){ float d=clamp((vz-near)/(far-near),0.0,1.0); gl_FragColor=vec4(vec3(1.0-d),1.0); }");
  assert.deepEqual(d.ground.args,[0x000000]);
  // one scale for the whole place: a second camera of the same set is drawn against the same far end
  view.render(h.canvas(),{position:[3.5,2.5,1.5]},640,360);
  assert.equal(h.drawn[1].override.uniforms.far.value,d.override.uniforms.far.value);
});

await test("4 the sheet and the viewer take the look; the Colour sheet, with no look, is unchanged", async()=>{
  const h=harness();
  const colour=await h.P.sheet(h.scene(),null,{panelWidth:320});
  assert.equal(h.drawn.length,4,"one drawing a camera");
  assert.ok(h.drawn.every(d=>d.override===null&&new Set(d.meshes.map(m=>m.material)).size===4&&d.exposure===1));
  assert.ok(colour.dataUrl.startsWith("data:image/png"));
  h.drawn.length=0;
  await h.P.sheet(h.scene(),null,{panelWidth:320,look:"clay"});
  assert.ok(h.drawn.every(d=>d.meshes.filter(m=>!m.own).every(m=>m.material.color===0xe9e7e2)&&d.exposure===h.P.CLAY.exposure));
  h.drawn.length=0;
  await h.P.sheet(h.scene(),null,{panelWidth:320,look:"depth"});
  assert.ok(h.drawn.every(d=>d.override&&d.override.kind==="shader"));
  // a look that is not one is the Colour drawing
  h.drawn.length=0;
  const odd=await h.P.viewer(h.scene(),null,{look:"wireframe"}); odd.render(h.canvas(),{position:[0,0,1]},320,180);
  assert.equal(odd.look,""); assert.equal(h.drawn[0].override,null);
  assert.ok(previs.includes("const rig=build(T,scene,light||null,{look:options.look,surfaces:options.surfaces,renderer});"));
  assert.ok(previs.includes("const rig=build(T,scene,light||null,{look:options&&options.look,surfaces:options&&options.surfaces,renderer});"));
  assert.ok(previs.includes('const kit=root.KinolotSetSurfaces||null;let S=!look&&!(opts&&opts.surfaces===false)&&kit&&typeof kit.material==="function"&&kit||null;'),"a look has no painted surfaces");
});

await test("5 one 3D view draws a single frame in a look and is put back as it was (the location card)", async()=>{
  const h=harness(), view=await h.P.viewer(h.scene(),null);
  const pose={position:[0.5,0.5,1.5]};
  view.render(h.canvas(),pose,640,360,"clay");
  view.render(h.canvas(),pose,640,360,"depth");
  view.render(h.canvas(),pose,640,360);
  const [clay,depth,colour]=h.drawn;
  assert.ok(clay.meshes.filter(m=>!m.own).every(m=>m.material.color===0xe9e7e2)&&clay.meshes.filter(m=>m.own).every(m=>m.material.color!==0xe9e7e2));
  assert.deepEqual(clay.ground.args,[0xd4d2cd]); assert.equal(clay.exposure,h.P.CLAY.exposure);
  assert.equal(depth.override.kind,"shader"); assert.equal(depth.override.uniforms.far.value,view.far); assert.deepEqual(depth.ground.args,[0x000000]);
  // back to colour: every material, the ground and the exposure as built
  assert.equal(colour.override,null); assert.equal(new Set(colour.meshes.map(m=>m.material)).size,4); assert.equal(colour.exposure,1);
  assert.notDeepEqual(colour.ground.args,[0xd4d2cd]);
  // a view built in a look is that look, whatever is asked for a frame
  h.drawn.length=0;
  const built=await h.P.viewer(h.scene(),null,{look:"clay"}); built.render(h.canvas(),pose,640,360,"depth");
  assert.equal(h.drawn[0].override,null); assert.ok(h.drawn[0].meshes.filter(m=>!m.own).every(m=>m.material.color===0xe9e7e2));
});

await test("6 a shot's drawing and a beat's take the look; a frame is still made from the Colour drawing", ()=>{
  assert.ok(shot.includes("const draw=async(scene)=>{ const view=await P.viewer(scene,built.light,{look:o.look}), canvas=root.document.createElement(\"canvas\");"));
  assert.ok(shot.includes("startState:st.start,endState:st.end,midState:mid,look:o.look});"),"beat() passes it to each shot");
  // the frame: the drawing handed to the image engine is asked for with no look
  // (the function for a FRAME ends where the one for a clip's layout begins: that one is clay on purpose, step 6)
  const forFrame=shotUi.slice(shotUi.indexOf("async function shotPrevisForFrame("),shotUi.indexOf("/* THE LAYOUT A WHOLE-BEAT CLIP IS GIVEN FOR A SHOT"));
  assert.ok(forFrame.includes("SPv.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:width||1536, words:true,")&&!/look/.test(forFrame));
  // the Previs sheet a location image is made from is the Colour sheet
  const sheets=stepUi.match(/P\.sheet\([^)]*\)/g)||[];
  assert.ok(sheets.length>0&&sheets.every(c=>!/look/.test(c)),"no Previs sheet is asked for in a look");
});

await test("7 the switch on a shot card's Previs: Colour, Clay, Depth; each look kept apart for the session", ()=>{
  assert.ok(shotUi.includes('{ id:"", name:"Colour", title:"The set as built. A frame is made from this drawing." },'));
  assert.ok(shotUi.includes('{ id:"clay", name:"Clay",')&&shotUi.includes('{ id:"depth", name:"Depth",'));
  assert.ok(shotUi.includes('const sig = colourSig+(look ? "|look:"+look : "");'),"a look never replaces another's drawing");
  assert.ok(shotUi.includes("const [look, setLookNow] = React.useState(()=> SHOT_PREVIS_LOOK.get(sh.id) || \"\");")&&shotUi.includes("SHOT_PREVIS_LOOK.set(sh.id, id);"),"a shot remembers the look it was left on");
  assert.ok(shotUi.includes("...(look ? { look } : {}),"));
  assert.ok(shotUi.includes('"data-testid":"shot-previs-looks"')&&shotUi.includes('"data-look":look||"colour"'));
  assert.ok(shotUi.includes('onMake && look && SPV_E("p",{className:"shot-previs-note","data-testid":"shot-previs-look-note"},"A frame is made from the Colour drawing, not from this one."),'));
  assert.ok(css.includes(".shot-previs-looks{display:flex;")&&css.includes('.shot-previs-looks button[aria-pressed="true"]{background:var(--hs-amber,var(--pos));'));
});

await test("8 the switch on the location card: Colour, Clay, Depth, each look's picture kept", ()=>{
  const box={console};box.window=box;vm.createContext(box);vm.runInContext(card,box);
  const K=box.KinolotSetCard;
  assert.deepEqual(JSON.parse(JSON.stringify(K.LOOKS.map(x=>[x.id,x.name,x.look]))),[["colour","Colour",""],["clay","Clay","clay"],["depth","Depth","depth"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(K.PACK.map(x=>[x.name,x.look]))),[["Colour",""],["Clay","clay"],["Depth","depth"]]);
  assert.ok(face.includes("const heroes = React.useRef(new Map());")&&face.includes("heroes.current.set(heroKey, res.urls[res.urls.length-1]);"));
  assert.ok(face.includes("if(!needThumbs && heroes.current.has(heroKey)){"),"going back to a look is at once");
  assert.ok(face.includes('const kept = lscKept[place.id] || (lscKept[place.id] = { look:"colour", moved:{} });'));
  assert.ok(!/Blockout/.test(card+face),"the first look is called Colour");
});

await test("9 Frances knows the three looks; the files have fresh keys", ()=>{
  const shots=ai.slice(ai.indexOf('name:"Shots: the previs of a shot, and its camera on the floor plan"'));
  const fact=shots.slice(0,shots.indexOf("\n"));
  for(const s of ["COLOUR, CLAY, DEPTH (2026-11-23)","Colour is the set as built, and the one a frame is made from","with the people and the props in their own colours","white at 40 cm, black at the far end of the space the shot plays in","lit softly from three sides","A frame is always made from the Colour drawing"]) assert.ok(fact.includes(s),s);
  const place=ai.slice(ai.indexOf('name:"Location card: the set card on top (one card per set)"'));
  assert.ok(place.slice(0,place.indexOf("\n")).includes("COLOUR, CLAY, DEPTH: three ways to draw the same view; each is kept as drawn"));
  for(const f of ["app/set-previs.js","app/shot-previs.js","app/shot-previs-ui.jsx","app/location-set-card.js","app/location-set-card-ui.jsx","app/styles.css","app/ai.jsx","app/script.jsx"])
    assert.ok(["20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
});

/* ---- STEP 2: LIGHT AND SHEEN (owner 2026-11-23: "go with your recommendation on depth and start step 2") ---- */
await test("10 soft light from three sides: a sky, three suns that cast shadows, a room light under each ceiling; one set-up for every camera", async()=>{
  const h=harness(), room=h.scene(); room.previewLights=[{position:[2,1.5,2.3],colour:[1,0.9,0.8],powerWatts:200}];
  const view=await h.P.viewer(room,{time:"day",sky:"#c8ccce",sun:{from:110,height:28,colour:"#f0e8d8",power:0.9},fill:1.3});
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360); view.render(h.canvas(),{position:[3.5,2.5,1.5]},640,360);
  const [a,b]=h.drawn, R=h.P.RIG;
  assert.deepEqual(a.lights.slice().sort(),["DirectionalLight","DirectionalLight","DirectionalLight","HemisphereLight","PointLight"],"no single sun, no flat ambient");
  assert.deepEqual(a.rig.filter(l=>l.type==="DirectionalLight").map(l=>l.power),[1.5,1,1],"one from above, two from the sides");
  assert.equal(a.rig.find(l=>l.type==="HemisphereLight").power,R.hemisphere*1.3,"the place's own fill turns the sky up a little");
  assert.equal(a.rig.find(l=>l.type==="PointLight").power,R.roomPower);
  assert.deepEqual(JSON.parse(JSON.stringify(a.rig)),JSON.parse(JSON.stringify(b.rig)),"the same light for every camera of the place");
  assert.equal(a.exposure,1); assert.equal(b.exposure,1);
  // the three suns: the first side light comes from the place's own sun, the second from the far side, the third from above
  assert.deepEqual(JSON.parse(JSON.stringify(R.suns)),[[20,84,1.5,2048],[0,45,1,4096],[169,46,1,4096]]);
  assert.ok(previs.includes("const az=from+u[0]*Math.PI/180,el=u[1]*Math.PI/180,key=new T.DirectionalLight(sunColour,u[2]*dim);"));
  assert.ok(previs.includes("key.castShadow=true;key.shadow.mapSize.set(u[3],u[3]);key.shadow.bias=-0.0005;key.shadow.normalBias=0.03;"));
  // a place with a fill out of range is held between 0.6 and 1.4
  h.drawn.length=0; const bright=await h.P.viewer(h.scene(),{fill:9}); bright.render(h.canvas(),{position:[0,0,1]},320,180);
  assert.equal(h.drawn[0].rig.find(l=>l.type==="HemisphereLight").power,R.hemisphere*1.4);
});

await test("11 window light: a spot just inside each window or glazed opening of a roofed room, aimed across it; none at night", async()=>{
  const h=harness(), place={windows:[{at:[2,0.35,1.6],to:[2,4,0.7]}],span:{min:[0,0,0],max:[4,3,2.4]}};
  const view=await h.P.viewer(h.scene(),{time:"day",place});
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  const spot=h.drawn[0].rig.filter(l=>l.type==="SpotLight");
  assert.equal(spot.length,1); assert.equal(spot[0].power,h.P.RIG.windowPower); assert.deepEqual(spot[0].at,[2,0.35,1.6]); assert.deepEqual(spot[0].to,[2,4,0.7]);
  h.drawn.length=0; const night=await h.P.viewer(h.scene(),{time:"night",place}); night.render(h.canvas(),{position:[0,0,1]},320,180);
  assert.equal(h.drawn[0].rig.filter(l=>l.type==="SpotLight").length,0,"no daylight through a window at night");
  // where they are: read from the floor plan
  const flat={id:"flat",footprint:[[0,0],[4,0],[4,3],[0,3]],floorZ:0}, yard={id:"yard",footprint:[[-10,-9],[14,-9],[14,0],[-10,0]],floorZ:-0.15};
  h.box.locationSpatialPlanState=()=>({owner:{id:"flat"},plan:{coordinates:{spaces:[{id:"flat",ceilingH:2.5},{id:"yard",openSky:true}]}}});
  h.box.locationFloorPlanScene=()=>({spaces:[flat,yard],openings:[
    {spaceId:"flat",kind:"window",centre:[2,0],a:[1.4,0],b:[2.6,0]},            // a window in the flat's south wall
    {spaceId:"flat",kind:"door",centre:[0,1.5],a:[0,1],b:[0,2]},                // a door gives no window light
    {spaceId:"yard",kind:"window",centre:[5,-9],a:[4,-9],b:[6,-9]},             // a neighbour's window on open ground
    {spaceId:"flat",kind:"glass",centre:[4,1.5],a:[4,1],b:[4,2]}]});            // a glazed door in the east wall
  const facts=JSON.parse(JSON.stringify(h.P.placeFacts({id:"flat"},[])));
  assert.deepEqual(facts.windows,[{at:[2,0.35,1.6],to:[2,4,0.7]},{at:[3.65,1.5,1.6],to:[0,1.5,0.7]}],"35 cm inside the glass at 1.6 m, aimed 4 m across the room at 0.7 m");
  assert.deepEqual(facts.span,{min:[0,0,0],max:[4,3,2.5]},"the card's own space, floor to ceiling");
  assert.deepEqual(JSON.parse(JSON.stringify(h.P.placeFacts({id:"yard"},[]))).span,{min:[-10,-9,-0.15],max:[14,0,2.85]},"open air: 3 m");
  // a place whose floor plan cannot be read: no facts, and nothing throws
  h.box.locationSpatialPlanState=()=>{ throw new Error("no plan"); };
  assert.deepEqual(JSON.parse(JSON.stringify(h.P.placeFacts({id:"flat"},[]))),{windows:[],span:null});
});

await test("12 depth is measured in the camera's own space: the same room is not washed out by the terrace outside it", async()=>{
  const h=harness(), room=h.scene();
  room.objects.push({id:"terrace-floor",name:"Terrace floor",kind:"box",material:"wall",size:[26,9,0.15],position:[1,-4.5,-0.2],rotation:[0,0,0]});
  const whole=h.P.depthFar(room), own=h.P.depthFar(room,{min:[0,0,0],max:[4,3,2.4]});
  assert.ok(whole>12,"to the far corner of the terrace: "+whole);
  assert.equal(own,Math.round(Math.hypot(3.5,2.5,1.5)*100)/100,"to the far corner of the room itself");
  const view=await h.P.viewer(room,{place:{windows:[],span:{min:[0,0,0],max:[4,3,2.4]}}},{look:"depth"});
  assert.equal(view.far,own);
  // still never under 3 m; a span that is not numbers is ignored
  assert.equal(h.P.depthFar({objects:[],cameras:{TL:{position:[0.5,0.5,0.5]}}},{min:[0,0,0],max:[1,1,1]}),3); assert.equal(h.P.depthFar(room,{min:["a"],max:[]}),whole);
  // the facts ride with the light, and are not part of what a saved draft was made from
  assert.ok(previs.includes("return {scene:out,light:light||known||named?{...(light||{}),place:facts,...(named?{kit}:{})}:null,dressed:isos.length>0,parts,iso:isos.join(\"|\")};"),"a set with no light, no facts and no named piece still has none");
  assert.ok(previs.includes("setKey:await C.hash(C.canonical({scene:built.scene,light:lightAsSaved(built.light)}))"),"a draft made before step 2 still matches its set");
  assert.ok(previs.includes('Object.keys(light).forEach(k=>{if(k!=="place"&&k!=="kit")own[k]=light[k];});')&&previs.includes("return Object.keys(own).length?own:null;"));
});

await test("13 a sheen: only metal, glass, gloss paint and tiles mirror the small sky", async()=>{
  const h=harness(), sky={texture:{sky:true},dome:{},dispose(){}};
  h.box.KinolotSetSurfaces={sky:()=>sky,kindOf:id=>({steel:"metal",pane:"glass",door:"gloss",lino:"tile",wall:"paint",rug:"carpet"})[id]||"plain"};
  const room=h.scene(); room.materials={steel:{baseColor:[0.3,0.3,0.3],roughness:0.3,metallic:0.8},pane:{baseColor:[0.02,0.03,0.04],roughness:0.1},door:{baseColor:[0.8,0.8,0.7]},lino:{baseColor:[0.4,0.3,0.2]},wall:{baseColor:[0.7,0.6,0.5]},rug:{baseColor:[0.2,0.1,0.1]}};
  room.objects=Object.keys(room.materials).map((m,i)=>({id:"o"+i,name:m,kind:"box",material:m,size:[1,1,1],position:[i,0,0.5],rotation:[0,0,0]}));
  // (the sheen is what a FLAT-colour drawing has; a painted one gets its mirror from each surface's own painter)
  const view=await h.P.viewer(room,null,{surfaces:false}); view.render(h.canvas(),{position:[0,-3,1.5]},640,360);
  const by={}; h.drawn[0].meshes.forEach((m,i)=>{ by[Object.keys(room.materials)[i]]=m.material; });
  assert.deepEqual(Object.keys(by).map(k=>[k,by[k].envMap?by[k].envMapIntensity:0]),[["steel",1.1],["pane",1.6],["door",0.5],["lino",0.4],["wall",0],["rug",0]]);
  // clay and depth mirror nothing; and with no sky to mirror (the kit is not there) the set is drawn as before
  h.drawn.length=0; const clay=await h.P.viewer(room,null,{look:"clay"}); clay.render(h.canvas(),{position:[0,-3,1.5]},640,360);
  assert.ok(h.drawn[0].meshes.every(m=>!m.material.envMap));
  const bare=harness(); const v=await bare.P.viewer(bare.scene(),null); v.render(bare.canvas(),{position:[0,0,1]},320,180);
  assert.ok(bare.drawn[0].meshes.every(m=>!m.material.envMap));
});

/* ---- STEP 3: STAND-INS (owner 2026-11-24: "yes, go on to step 3") ---- */
await test("14 a person in a shot's Previs is a jointed figure: two new shapes draw it, the words to the image engine say figure", ()=>{
  const angle=read("app/camera-angle-preview.js"), shots=read("app/shots.jsx"), shotsUi=read("app/shots-ui.jsx");
  // a rounded rod (a limb) and a ball (a head, a hand), beside the shapes a set is built of
  assert.ok(angle.includes('else if(item.kind==="capsule"){')&&angle.includes("new T.CapsuleGeometry(.5,Math.max(.001,long/wide-1),6,14)"));
  assert.ok(angle.includes('}else if(item.kind==="sphere"){g=new T.SphereGeometry(.5,20,14);g.rotateX(Math.PI/2);}'));
  // the figure: 17 parts, built 1.80 m tall and scaled; the camera's numbers are the block figure's (test-shot-previs.mjs 1b)
  assert.ok(shot.includes("function figure(id,name,xy,floorZ,height,pose,turn,rgb,o){")&&shot.includes("const LOWERS={lying:0.22,kneeling:0.62,sitting:0.74,standing:1};"));
  assert.ok(shot.includes("const head=[x,y,z+h-0.115], chest=[x,y,z+h*0.72];"),"head and chest where the checks have always had them");
  assert.ok(shot.includes("{holding:arr(me.holding).length});"),"what a person holds brings their hands to it");
  assert.ok(shot.includes("scene.materials[fig.shade[0]]=fig.shade[1];"));
  // in clay a figure keeps its colours: its parts are objects whose id starts fig- (step 1)
  assert.ok(shot.includes('add=(part,kind,centre,size,rot,m)=>objects.push({id:"fig-"+id+"-"+part,'));
  // what the image engine and its check are told: figures, never block figures
  for(const src of [shot,ai,shots,shotsUi,shotUi]) assert.ok(!/block figure/.test(src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"")),"no block figure left in what is said");
  assert.ok(shot.includes('+" figure is "+p.name')&&ai.includes("its drawn surfaces, plain jointed figures and boxes are stand-in")&&shotsUi.includes("never its drawn surfaces, its plain jointed figures or it"));
  assert.ok(ai.includes("Each person is a plain jointed figure in one colour (a body, a head with a nose that shows which way they look, arms with hands, legs with shoes)"));
  for(const f of ["app/camera-angle-preview.js","app/shot-previs.js","app/shots.jsx","app/shots-ui.jsx","app/shot-previs-ui.jsx","app/ai.jsx","app/script.jsx"])
    assert.ok(["20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
});

await test("15 the furniture kit: a chair of the set is drawn from its parts; the set keeps its shapes; clay covers the parts too", async()=>{
  const h=harness(); vm.runInContext(read("app/set-kit.js"),h.box,{filename:"set-kit.js"});
  const scene=h.scene(), legs=[[1,1],[1,-1],[-1,1],[-1,-1]];
  scene.objects.push({id:"anchor-3-furniture-0",anchorId:"chair",name:"Kitchen chair \u00b7 seat",kind:"box",material:"oak",size:[0.45,0.45,0.06],position:[3,1,0.43],rotation:[0,0,0]},
    {id:"anchor-3-furniture-1",anchorId:"chair",name:"Kitchen chair \u00b7 backrest",kind:"box",material:"oak",size:[0.45,0.04,0.44],position:[3,0.8,0.68],rotation:[0,0,0]},
    ...legs.map((k,i)=>({id:"anchor-3-furniture-"+(i+2),anchorId:"chair",name:"Kitchen chair \u00b7 leg",kind:"box",material:"oak",size:[0.04,0.04,0.4],position:[3+k[0]*0.2,1+k[1]*0.2,0.2],rotation:[0,0,0]})));
  const kept=JSON.stringify(scene);
  const view=await h.P.viewer(scene,null);
  assert.equal(JSON.stringify(scene),kept,"the set's own data is exactly as it was: every check reads the shapes it always read");
  assert.deepEqual(JSON.parse(JSON.stringify(view.kit)),[{name:"Kitchen chair",piece:"chair",parts:10,kept:0}]);
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  const ids=h.drawn[0].meshes.map(m=>m.id);
  assert.equal(ids.filter(id=>/^kit-/.test(id)).length,10); assert.ok(!ids.some(id=>/^anchor-3-/.test(id)),"its six plain shapes are not drawn");
  assert.ok(["floor-0","wall-0","fig-ana","prop-keys"].every(id=>ids.includes(id)),"the room, the person and the prop are drawn as before");
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360,"clay");
  const clay=h.drawn[1].meshes, white=clay.find(m=>m.id==="wall-0").material;
  assert.ok(clay.filter(m=>/^kit-/.test(m.id)).every(m=>m.material===white&&!m.own),"in clay the chair is the set's one white");
  view.dispose();
  // without the kit (or with a kit that fails) the set is drawn as it always was
  const bare=harness(), plainView=await bare.P.viewer(scene,null);
  plainView.render(bare.canvas(),{position:[0.5,0.5,1.5]},640,360);
  assert.equal(bare.drawn[0].meshes.filter(m=>/^anchor-3-/.test(m.id)).length,6); assert.deepEqual(JSON.parse(JSON.stringify(plainView.kit)),[]);
  // stop 3: a piece the dressing named rides with the light (light.kit, by the box's id) and is drawn as that piece
  const said=harness(); vm.runInContext(read("app/set-kit.js"),said.box,{filename:"set-kit.js"});
  const stool=said.scene(); stool.objects.push({id:"anchor-9",anchorId:"stool",name:"Seat by the stove",kind:"box",material:"oak",size:[0.45,0.45,0.9],position:[3,1,0.45],rotation:[0,0,0]});
  const told=await said.P.viewer(stool,{kit:{"anchor-9":{piece:"chair",second:""}}}); told.render(said.canvas(),{position:[0.5,0.5,1.5]},640,360);
  assert.deepEqual(JSON.parse(JSON.stringify(told.kit)),[{name:"Seat by the stove",piece:"chair",parts:10,kept:0}]); assert.ok(!said.drawn[0].meshes.some(m=>m.id==="anchor-9"));
  const untold=await said.P.viewer(stool,null); assert.deepEqual(JSON.parse(JSON.stringify(untold.kit)),[],"nobody named it and its name says nothing: its box is drawn");
  assert.ok(/expand\(scene,\(opts&&opts\.kit\)\|\|\(light&&light\.kit\)\|\|null\)/.test(previs)&&/const drawn=D\.applied\(out,mine,/.test(previs)&&/Object\.assign\(kit,drawn\.kit\)/.test(previs),"scene() gathers the named pieces of every card of the place");
  const broken=harness(); broken.box.KinolotSetKit={expand(){ throw new Error("no"); }};
  const safe=await broken.P.viewer(scene,null); safe.render(broken.canvas(),{position:[0.5,0.5,1.5]},640,360);
  assert.equal(broken.drawn[0].meshes.filter(m=>/^anchor-3-/.test(m.id)).length,6,"a fault in the kit never stops a drawing");
});

await test("16 painted surfaces on every Colour drawing: the sheet, the viewer and a shot's drawing; never clay or depth", async()=>{
  const painted=()=>{ const h=harness(), log={materials:[],laid:[],dome:{isDome:true}};
    h.box.KinolotSetSurfaces={kindOf:()=>"plain",sky:()=>({texture:{sky:true},dome:log.dome,dispose(){}}),
      material:(T,id,m,name,env,owned)=>{ const made=new T.MeshStandardMaterial({painted:id,env:!!env}); log.materials.push([id,name]); owned.push(made); return made; },
      layUV:(T,geometry,size)=>{ log.laid.push(geometry.of); }};
    return {h,log}; };
  // Colour, asked for nothing: every material painted, every shape laid at its real size, the sky put behind
  let {h,log}=painted(); let view=await h.P.viewer(h.scene(),null); view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  assert.deepEqual(log.materials.map(x=>x[0]).sort(),["oak","red","skin","wall"]); assert.deepEqual(log.laid.sort(),["fig-ana","floor-0","prop-keys","wall-0"]);
  assert.ok(h.drawn[0].meshes.filter(m=>m.id).every(m=>m.material.painted),"each shape wears its painted surface");
  assert.equal(log.materials.find(x=>x[0]==="oak")[1],"Room floor","the painter is told what wears the material: a floor is boards, a wall is paint");
  // the same drawing in clay (asked at draw time): the set goes white, the painted materials come back after
  view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360,"clay");
  assert.ok(h.drawn[1].meshes.filter(m=>m.id&&!m.own).every(m=>!m.material.painted)); view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  assert.ok(h.drawn[2].meshes.filter(m=>m.id).every(m=>m.material.painted)); view.dispose();
  // the Previs sheet too
  ({h,log}=painted()); await h.P.sheet(h.scene(),null,{}); assert.equal(log.materials.length,4,"the sheet is painted"); assert.equal(log.laid.length,4);
  // a view built as clay or depth, and one that asks for flat colours, paint nothing
  for(const options of [{look:"clay"},{look:"depth"},{surfaces:false}]){
    ({h,log}=painted()); view=await h.P.viewer(h.scene(),null,options); view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
    assert.equal(log.materials.length+log.laid.length,0,JSON.stringify(options)); view.dispose();
  }
  // a surface that cannot be painted never stops a drawing: flat colours instead
  ({h,log}=painted()); h.box.KinolotSetSurfaces.material=()=>{ throw new Error("no canvas"); };
  view=await h.P.viewer(h.scene(),null); view.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  assert.equal(new Set(h.drawn[0].meshes.filter(m=>m.id).map(m=>m.material)).size,4); assert.ok(h.drawn[0].meshes.every(m=>m.material.kind==="standard"));
  // who asks: a shot's drawing and the location card both draw through viewer(); nobody turns the surfaces off
  assert.ok(shot.includes("P.viewer(scene, built.light, {look:o.look})")||/P\.viewer\(scene,\s*built\.light,\s*\{\s*look:\s*o\.look\s*\}\)/.test(shot),"a shot's drawing");
  assert.ok(![shot,shotUi,stepUi,face].some(t=>/surfaces:\s*false/.test(t)),"no drawing of the app asks for flat colours");
  // the kit's own materials have their surfaces
  const sb={document:{createElement:()=>({getContext:()=>({})})}}; sb.window=sb; vm.createContext(sb); vm.runInContext(read("app/set-surfaces.js"),sb,{filename:"set-surfaces.js"});
  const kind=sb.KinolotSetSurfaces.kindOf;
  assert.deepEqual(["kit_steel","kit_glass","kit_linen","kit_cover","kit_book3","kit_worktop","kit_dark","kit_bulb","d_oak_kitshade","d_darkdoor_kitshade"].map(id=>kind(id,"")),["metal","glass","fabric","fabric","paper","gloss","plain","lamp","wood","gloss"]);
  // the words: the image engine is told the drawn surfaces are stand-ins, and the help assistant knows
  assert.ok(previs.includes("The sheet's drawn surfaces and simple light only point to materials and the hour;")&&!/flat colours, plain jointed/.test(ai+read("app/shots.jsx")+read("app/shots-ui.jsx")));
  assert.ok(ai.split("\n").filter(l=>l.startsWith("APP_FEATURES.push")&&/PAINTED SURFACES EVERYWHERE \(2026-11-24\): every Colour drawing of a set is painted the same way/.test(l)).length===1);
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

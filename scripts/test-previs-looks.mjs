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
  class HemisphereLight extends Light{} class AmbientLight extends Light{} class DirectionalLight extends Light{} class PointLight extends Light{}
  class Matrix4{ makeRotationZ(){ return this; } makeRotationY(){ return this; } makeRotationX(){ return this; } multiply(){ return this; } }
  class Box3{ expandByPoint(){ return this; } getCenter(v){ return v; } getSize(v){ return v; } }
  class WebGLRenderer{ constructor(){ this.shadowMap={}; this.domElement={}; this.toneMappingExposure=1; }
    setPixelRatio(){} setSize(){} getContext(){ return {isContextLost:()=>false}; } dispose(){} forceContextLoss(){}
    render(scene,camera){ drawn.push({override:scene.overrideMaterial,ground:scene.background,exposure:this.toneMappingExposure,camera,
      meshes:scene.children.filter(c=>c.isMesh).map(m=>({id:m.userData.id,material:m.material,own:!!m.userData.own})),
      lights:scene.children.filter(c=>c.isLight).map(l=>l.type)}); } }
  const T={Color,Vector3,MeshStandardMaterial,ShaderMaterial,Scene,Mesh,HemisphereLight,AmbientLight,DirectionalLight,PointLight,Matrix4,Box3,WebGLRenderer,DoubleSide:2,SRGBColorSpace:"srgb",ACESFilmicToneMapping:4,PCFSoftShadowMap:2};
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
  return {P:box.KinolotPrevis,drawn,canvas,scene,T};
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
  // the same set in colour, at night: its own materials, its night lamp, no sun
  const colour=await h.P.viewer(h.scene(),night);
  colour.render(h.canvas(),{position:[0.5,0.5,1.5]},640,360);
  const c=h.drawn[1];
  assert.equal(new Set(c.meshes.map(m=>m.material)).size,4); assert.ok(!c.lights.includes("DirectionalLight")&&c.lights.includes("PointLight"));
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
  assert.ok(previs.includes("const rig=build(T,scene,light||null,{look:options.look});"));
  assert.ok(previs.includes("const rig=build(T,scene,light||null,{look:options&&options.look,surfaces:!!(options&&options.surfaces),renderer});"));
  assert.ok(previs.includes("const S=!look&&opts&&opts.surfaces&&root.KinolotSetSurfaces||null;"),"a look has no painted surfaces");
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
  const forFrame=shotUi.slice(shotUi.indexOf("async function shotPrevisForFrame("),shotUi.indexOf("/* THE LOOK OF THE FRAME BEFORE"));
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
  for(const s of ["COLOUR, CLAY, DEPTH (2026-11-23)","Colour is the set as built, and the one a frame is made from","with the people and the props in their own colours","white at 40 cm, black at the far end of the set","A frame is always made from the Colour drawing"]) assert.ok(fact.includes(s),s);
  const place=ai.slice(ai.indexOf('name:"Location card: the set card on top (one card per set)"'));
  assert.ok(place.slice(0,place.indexOf("\n")).includes("COLOUR, CLAY, DEPTH: three ways to draw the same view; each is kept as drawn"));
  for(const f of ["app/set-previs.js","app/shot-previs.js","app/shot-previs-ui.jsx","app/location-set-card.js","app/location-set-card-ui.jsx","app/styles.css","app/ai.jsx","app/script.jsx"])
    assert.ok(["20261123-looks1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

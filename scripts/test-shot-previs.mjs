#!/usr/bin/env node
/* THE PREVIS OF A SHOT (owner 2026-11-22, after the first real frames of Scene 5: "we need to start with code ...
   pull out the actual 3D set ... lock in the cameras considering the composition for the shot ... then ... bring
   image model to support with rendering"). Code-first frames, step 1: a planned shot DRAWN IN CODE.

   app/shot-previs.js puts one state of the scene plan into the place's own 3D set (a block for each person, at their
   height, on their mark, facing who the plan says; a box for each prop at its card's size; each door as the state has
   it) and finds or checks the camera. app/shot-previs-ui.jsx shows it on the shot card. One short writing pass
   (ai.jsx aiPlanCameras) gives each shot a camera in numbers, kept with the plan.

     1. people: their height, a stand-in that faces a way
     2. props: sizes read from a card's own words
     3. a state in the set: marks, facing, what is held, what stands on a fixed object, what is missing
     4. who or what a person faces
     5. doors: open swings the set's own leaf; shut leaves it; a door with no leaf gets a plain one
     5c-5g. a person at a shut door; a camera on the other side of it; what hangs; what sits on what; which way a leaf swings
     6. what hides a face, and where no camera can stand
     7. the planned camera, checked: kept, moved, its lens set, or left to the app
     8. the camera found by the app
     9. the camera pass's answer read safely, and what it asks
    10. the card, the plan's row, the app's action and the keys
    11. what Frances is told

   No browser, no network, no paid call (drawing itself needs a browser and is tried there). */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
const src=read("app/shot-previs.js"), ui=read("app/shot-previs-ui.jsx"), shotsUi=read("app/shots-ui.jsx"), ai=read("app/ai.jsx"),
  app=read("app/app.jsx"), html=read("TURN.html"), css=read("app/styles.css");
let pass=0, fail=0;
const pending=[];
const bad=(name,e)=>{ fail++; console.log("FAIL "+name+"\n    "+(process.env.FULL?String(e&&e.stack||e):String(e&&e.message||e).split("\n")[0])); };
// a test that returns a promise is waited for before the count is printed
const test=(name,fn)=>{ try{ const r=fn();
    if(r&&typeof r.then==="function"){ pending.push(r.then(()=>{ pass++; console.log("PASS "+name); },e=>bad(name,e))); return; }
    pass++; console.log("PASS "+name); }
  catch(e){ bad(name,e); } };
const plain=v=>JSON.parse(JSON.stringify(v));
const near=(a,b,eps)=>Math.abs(a-b)<=(eps==null?0.011:eps);

const box={console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,isFinite,parseInt,parseFloat};
box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/scene-plan.js","app/shot-previs.js"]) vm.runInContext(read(f),box,{filename:f});
const V=box.ShotPrevis, SP=box.ScenePlan;

/* A SMALL PLACE: a room 4 m by 3 m (x 0..4, y 0..3) and a yard south of it; a front door in the wall between them,
   with the leaf the dressing drew; a table; a short wall standing in the room. */
const wall=(id,p,s)=>({id,name:"wall",kind:"box",position:p,rotation:[0,0,0],size:s,material:"wall"});
const SET=()=>({materials:{wall:{baseColor:[1,1,1]}},cameras:{},objects:[
  {id:"floor",name:"floor",kind:"box",position:[2,1.5,-0.05],rotation:[0,0,0],size:[4,3,0.1],material:"wall"},
  wall("w-s1",[0.79,0,1.2],[1.58,0.1,2.4]), wall("w-s2",[3.21,0,1.2],[1.58,0.1,2.4]),
  wall("w-n",[2,3,1.2],[4,0.1,2.4]), wall("w-w",[0,1.5,1.2],[0.1,3,2.4]), wall("w-e",[4,1.5,1.2],[0.1,3,2.4]),
  wall("w-mid",[1,1.5,1.2],[0.1,1,2.4]),
  {id:"opening-detail-0",name:"Front door · frame jamb",kind:"box",anchorId:"front-door",position:[1.58,0,1],rotation:[0,0,0],size:[0.04,0.08,2.04],material:"wall"},
  {id:"opening-detail-1",name:"Front door · frame jamb",kind:"box",anchorId:"front-door",position:[2.42,0,1],rotation:[0,0,0],size:[0.04,0.08,2.04],material:"wall"},
  {id:"opening-detail-2",name:"Front door · frame head",kind:"box",anchorId:"front-door",position:[2,0,2.02],rotation:[0,0,0],size:[0.88,0.08,0.04],material:"wall"},
  {id:"extra-1",name:"front door leaf · 1",kind:"box",position:[2,0,1],rotation:[0,0,0],size:[0.8,0.05,2],material:"wall"},
  {id:"extra-2",name:"front door leaf · 2",kind:"box",position:[2.3,0.04,1],rotation:[0,0,0],size:[0.1,0.04,0.03],material:"wall"},
  {id:"extra-3",name:"front door leaf · 3",kind:"box",position:[2,0,2.03],rotation:[0,0,0],size:[0.9,0.1,0.05],material:"wall"},
  {id:"anchor-1-furniture-0",name:"Kitchen table · top",kind:"box",anchorId:"table",position:[3,2,0.73],rotation:[0,0,0],size:[1,0.6,0.04],material:"wall"},
  {id:"anchor-1-furniture-1",name:"Kitchen table · leg",kind:"box",anchorId:"table",position:[2.6,1.8,0.35],rotation:[0,0,0],size:[0.05,0.05,0.7],material:"wall"}]});
const SPACES=[{id:"room",name:"Kitchen",footprint:[[0,0],[4,0],[4,3],[0,3]],floorZ:0},{id:"yard",name:"Yard",footprint:[[0,-6],[4,-6],[4,0],[0,0]],floorZ:-0.1}];
const PLAN={marks:[{id:"m-a",set:"set1",name:"by the door",xy:[2,1]},{id:"m-b",set:"set1",name:"at the table",xy:[3.2,1]},{id:"m-c",set:"set1",name:"in the corner",xy:[0.5,1.5]}],
  fixed:[{id:"front-door",set:"set1",kind:"opening",name:"Front door"},{id:"table",set:"set1",kind:"object",name:"Kitchen table"}],
  things:[{key:"mug",name:"Mug",kind:"prop",propId:"p-mug"},{key:"coat",name:"Coat",kind:"wardrobe"},{key:"parcel",name:"Parcel",kind:"prop"},{key:"street-door",name:"Front door",kind:"set"}],
  blocking:[{beat:1,people:[{id:"ann",where:"m-a",facing:"Bob"},{id:"bob",where:"m-b",facing:"the kitchen table"},{id:"cy",where:"m-c",facing:"Ann"}]}]};
const CAST=[{id:"ann",name:"Ann Lee",height:"170 cm tall"},{id:"bob",name:"Bob Marsh",height:"180 cm tall"},{id:"cy",name:"Cy Dunn",height:""}];
const PROPS=[{id:"p-mug",name:"Mug",size:"9 x 8 x 10 cm"}];
const CTX={cast:CAST,props:PROPS,spaces:SPACES,plan:PLAN,beat:1};
const STATE={people:{ann:{where:"m-a",pose:"standing",holding:["mug"]},bob:{where:"m-b",pose:"standing",holding:[]}},
  things:{mug:{heldBy:"ann"},parcel:{at:"table"},coat:{worn:"ann"}},doors:[{id:"front-door",open:false}]};
// a sight line through the test set: free unless it crosses a tall box (seen from above); what the app does with the set's meshes
const clearOf=set=>(from,to)=>!set.objects.some(o=>{ if(o.size[2]<1.2||/^(fig|prop)-/.test(o.id)) return false;
  const hx=o.size[0]/2, hy=o.size[1]/2; let t0=0.02, t1=0.97;
  for(const [p,d,c,h] of [[from[0],to[0]-from[0],o.position[0],hx],[from[1],to[1]-from[1],o.position[1],hy]]){
    if(Math.abs(d)<1e-9){ if(Math.abs(p-c)>h) return false; continue; }
    const a=(c-h-p)/d, b=(c+h-p)/d; t0=Math.max(t0,Math.min(a,b)); t1=Math.min(t1,Math.max(a,b)); if(t0>t1) return false; }
  return true; });

/* ---- 1. people ---- */
test("1. a person's height is read from the card's own words; with none, 1.7 m",()=>{
  assert.equal(V.heightOf({height:"168 cm tall"}),1.68);
  assert.equal(V.heightOf({height:"1.8 m"}),1.8);
  assert.ok(near(V.heightOf({height:"5 ft 10"}),1.778,0.001));
  assert.equal(V.heightOf({heightCm:160}),1.6);
  assert.equal(V.heightOf({}),V.DEFAULT_HEIGHT);
  assert.equal(V.heightOf({height:"tall"}),1.7);
});
test("1b. a stand-in is a jointed figure of their own height, and its nose is on the side they look to",()=>{
  // (owner 2026-11-23, the Previs look brief, step 3: it was a block of legs, a block of torso and a block of head)
  const north=V.figure("ann","Ann",[2,1],0,1.7,"standing",0);
  const part=(f,name)=>f.objects.find(o=>o.id==="fig-ann-"+name);
  assert.deepEqual(plain(north.objects.map(o=>o.id.replace("fig-ann-",""))),["pelvis","torso","neck","head","nose",
    "arm-l","forearm-l","hand-l","thigh-l","shin-l","shoe-l","arm-r","forearm-r","hand-r","thigh-r","shin-r","shoe-r"]);
  assert.deepEqual(plain([...new Set(north.objects.map(o=>o.kind))].sort()),["box","capsule","sphere"]);
  assert.ok(near(north.head[2]+0.115,1.7),"the head's top is the person's height");
  // the figure itself is that tall and stands on the floor
  const top=o=>o.position[2]+o.size[2]/2;
  assert.ok(near(Math.max(...north.objects.map(top)),1.7,0.03),"its head ends at their height");
  assert.ok(near(Math.min(...north.objects.filter(o=>o.kind==="box").map(o=>o.position[2]-o.size[2]/2)),0,0.005),"its shoes are on the floor");
  assert.ok(near(part(north,"head").position[2],north.head[2],0.02),"its head is where the camera's checks have it");
  const nose=part(north,"nose");
  assert.ok(nose.position[1]>1.05&&near(nose.position[0],2),"looking north, the nose is north of the head");
  assert.equal(nose.material,"standin-ann-dark"); assert.equal(part(north,"shoe-l").material,"standin-ann-dark"); assert.equal(part(north,"torso").material,"standin-ann");
  assert.deepEqual(plain(north.shade[1].baseColor),plain(north.material[1].baseColor.map(v=>Math.round(v*0.55*1000)/1000)),"one colour, the nose and the shoes darker");
  const east=V.figure("ann","Ann",[2,1],0,1.7,"standing",V.turnTo([2,1],[5,1]));
  const n2=part(east,"nose");
  assert.ok(n2.position[0]>2.05&&near(n2.position[1],1),"looking east, the nose is east of the head");
  assert.ok(near(east.front[0],1)&&near(east.front[1],0));
  // left and right are theirs: looking north, the right arm is to the east
  assert.ok(part(north,"arm-r").position[0]>2.1&&part(north,"arm-l").position[0]<1.9);
  // the same person, smaller: every part is scaled to their height
  const child=V.figure("ann","Ann",[2,1],0,1.1,"standing",0);
  assert.ok(near(Math.max(...child.objects.map(top)),1.1,0.03)&&near(child.objects[1].size[2],north.objects[1].size[2]*1.1/1.7,0.002));
  // sitting: the hips at a seat's height, the thighs forward, the feet on the floor; the numbers the checks use are the old ones
  const sat=V.figure("ann","Ann",[2,1],0,1.7,"sitting at the table",0);
  assert.equal(sat.posture,"sitting"); assert.ok(near(sat.height,1.7*0.74)); assert.ok(near(sat.head[2],1.7*0.74-0.115));
  assert.ok(near(part(sat,"head").position[2],sat.head[2],0.01)); assert.ok(part(sat,"pelvis").position[2]>0.35&&part(sat,"pelvis").position[2]<0.6);
  assert.ok(part(sat,"thigh-l").position[1]>1.1,"the thighs go forward"); assert.ok(part(sat,"shoe-l").position[2]<0.1);
  // kneeling: the knees on the floor in front, the feet behind
  const knelt=V.figure("ann","Ann",[2,1],0,1.7,"kneeling by the bed",0);
  assert.equal(knelt.posture,"kneeling"); assert.ok(near(part(knelt,"head").position[2],knelt.head[2],0.01));
  assert.ok(part(knelt,"shin-l").position[2]<0.15&&part(knelt,"shoe-l").position[1]<1.05);
  // lying: flat on the floor, the head over the mark, the body behind it
  const lay=V.figure("ann","Ann",[2,1],0,1.7,"lying on the floor",0);
  assert.equal(lay.posture,"lying"); assert.ok(Math.max(...lay.objects.map(top))<0.4,"nothing of them is higher than a step");
  assert.ok(near(part(lay,"head").position[0],2,0.01)&&near(part(lay,"head").position[1],1,0.01)); assert.ok(part(lay,"shoe-l").position[1]<0);
  // what they hold brings their hands to it, 22 cm in front of them
  const holding=V.figure("ann","Ann",[2,1],0,1.7,"standing",0,null,{holding:1}), empty=part(north,"hand-l"), full=part(holding,"hand-l");
  assert.ok(full.position[1]>empty.position[1]+0.08&&full.position[2]>empty.position[2]+0.1,"the hands come up and forward");
  // the same on every draw
  assert.deepEqual(plain(V.figure("ann","Ann",[2,1],0,1.7,"standing",0).objects),plain(north.objects));
  // a pose word lowers them
  assert.ok(V.figure("a","A",[0,0],0,1.7,"sitting on the stairs",0).height<1.3);
  assert.ok(V.figure("a","A",[0,0],0,1.7,"kneeling",0).height<1.1);
  assert.equal(V.figure("a","A",[0,0],0,1.7,"standing, card raised",0).height,1.7);
  // the same person is the same colour every time, and two people differ
  assert.deepEqual(plain(V.colourOf("ann")),plain(V.colourOf("ann")));
  assert.notDeepEqual(plain(V.colourOf("ann")),plain(V.colourOf("bob")));
});

/* ---- 2. props ---- */
test("2. a prop's size is read from its card's words, in metres; no number is no size",()=>{
  assert.deepEqual(plain(V.sizeFromText("22 x 15 x 9 cm")),[0.22,0.09,0.15]);
  assert.deepEqual(plain(V.sizeFromText("about 30cm long")),[0.3,0.18,0.18]);
  assert.deepEqual(plain(V.sizeFromText("85 × 54 mm")),[0.085,0.02,0.054]);
  assert.equal(V.sizeFromText("hand-sized"),null);
  assert.deepEqual(plain(V.sizeOf({dims:[0.2,0.1,0.05],size:"1 m"})),[0.2,0.1,0.05]);
  assert.equal(V.sizeOf({size:"small"}),null);
});

/* ---- 3. a state in the set ---- */
test("3. a state in the set: people on their marks, facing as the plan says, things where it puts them",()=>{
  const set=SET(), before=JSON.stringify(set);
  const got=V.stateScene(set,PLAN,STATE,CTX);
  assert.equal(JSON.stringify(set),before,"the place's set is never changed: each state is a copy");
  assert.deepEqual(plain(got.people.map(p=>p.id)),["ann","bob"]);
  const ann=got.people[0], bob=got.people[1];
  assert.deepEqual(plain(ann.xy),[2,1]); assert.deepEqual(plain(bob.xy),[3.2,1]);
  assert.ok(near(ann.height,1.7)&&near(bob.height,1.8),"each at their own height");
  assert.ok(near(ann.front[0],1)&&near(ann.front[1],0),"Ann faces Bob (the blocking says so)");
  assert.ok(bob.front[1]>0.9,"Bob faces the kitchen table, north of him");
  // the mug is in Ann's hands, in front of her, at its card's size
  const mug=got.things.find(t=>t.key==="mug");
  assert.ok(mug&&mug.held==="ann"&&mug.measured);
  assert.ok(mug.at[0]>2.15&&near(mug.at[1],1,0.02)&&mug.at[2]>0.8&&mug.at[2]<1.2,"at her hands, on the side she faces");
  assert.deepEqual(plain(mug.size),[0.1,0.08,0.09]);
  // the parcel stands on the table's top, at a guessed size (no card, no measurements)
  const parcel=got.things.find(t=>t.key==="parcel");
  assert.ok(parcel&&!parcel.measured&&near(parcel.at[2],0.75)&&near(parcel.at[0],3)&&near(parcel.at[1],2));
  assert.deepEqual(plain(parcel.size),plain(V.DEFAULT_SIZE));
  // what is worn is not a box in the room
  assert.ok(!got.things.some(t=>t.key==="coat"));
  assert.ok(got.scene.objects.some(o=>o.id==="prop-mug"&&o.material==="prop-standin")&&got.scene.objects.some(o=>o.id==="fig-ann-torso"));
  // the set with nobody in it (what sight lines are read from)
  assert.ok(!got.base.objects.some(o=>/^(fig|prop)-/.test(o.id))&&got.base.objects.length===set.objects.length);
  assert.deepEqual(plain(got.missing),[]);
});
test("3c. two people on one mark stand side by side on it",()=>{
  const got=V.stateScene(SET(),PLAN,{people:{ann:{where:"m-a"},bob:{where:"m-a"}}},CTX);
  assert.deepEqual(plain(got.people.map(p=>p.xy)),[[1.75,1],[2.25,1]]);
  assert.deepEqual(plain(V.stateScene(SET(),PLAN,STATE,CTX).people.map(p=>p.xy)),[[2,1],[3.2,1]],"people on their own marks stay on them");
});
test("3b. what cannot be placed is said, never guessed",()=>{
  const got=V.stateScene(SET(),PLAN,{people:{ann:{where:"m-nowhere"},bob:{where:"m-b"}},things:{parcel:{at:"sideboard"},mug:{in:"parcel"}}},CTX);
  assert.deepEqual(plain(got.people.map(p=>p.id)),["bob"]);
  assert.equal(got.missing.length,2);
  assert.match(got.missing[0],/^Ann Lee has no place on the floor plan/);
  assert.match(got.missing[1],/^Parcel is somewhere the floor plan does not hold$/);
  assert.equal(got.things.length,0);
});

/* ---- 4. who or what a person faces ---- */
test("4. who or what a person faces: an id, a name in the blocking's words, someone out of frame, a fixed object, the camera",()=>{
  const set=SET(), ann={id:"ann",name:"Ann Lee",xy:[2,1]}, bob={id:"bob",name:"Bob Marsh",xy:[3.2,1]}, here=[ann,bob];
  assert.deepEqual(plain(V.faceTarget("bob",ann,here,set,PLAN)),[3.2,1]);
  assert.deepEqual(plain(V.faceTarget("Marsh at the table",ann,here,set,PLAN)),[3.2,1]);
  assert.deepEqual(plain(V.faceTarget("m-c",ann,here,set,PLAN)),[0.5,1.5]);
  const table=V.faceTarget("table",ann,here,set,PLAN); assert.ok(near(table[0],2.8)&&near(table[1],1.9));
  assert.ok(V.faceTarget("the kitchen table",ann,here,set,PLAN),"a fixed object named whole");
  // Cy is not in this frame: the beat's blocking says where he stands
  assert.deepEqual(plain(V.faceTarget("Cy in the corner",ann,here,set,PLAN,{block:PLAN.blocking[0],cast:CAST})),[0.5,1.5]);
  assert.deepEqual(plain(V.faceTarget("camera",ann,here,set,PLAN,{lookAt:[1,2]})),[1,2]);
  assert.equal(V.faceTarget("camera",ann,here,set,PLAN),null);
  assert.equal(V.faceTarget("the far distance",ann,here,set,PLAN),null);
  assert.equal(V.faceTarget("",ann,here,set,PLAN),null);
  // alone, with nobody and nothing to face: the camera
  const solo=V.stateScene(set,{...PLAN,blocking:[]},{people:{ann:{where:"m-a"}}},{...CTX,lookAt:[2,2.5]});
  assert.ok(near(solo.people[0].front[0],0)&&near(solo.people[0].front[1],1));
  // the camera pass's answer comes before the blocking's words
  const told=V.stateScene(set,PLAN,STATE,{...CTX,faces:{ann:"front-door"}});
  assert.ok(told.people[0].front[1]<-0.9,"Ann faces the front door, south of her");
});

/* ---- 5. doors ---- */
test("5. an open door swings the set's own leaf a quarter turn into the smaller room; the frame stays",()=>{
  const shut=V.stateScene(SET(),PLAN,{people:{},doors:[{id:"front-door",open:false}]},CTX).base;
  assert.deepEqual(plain(shut.objects.find(o=>o.id==="extra-1").position),[2,0,1],"shut: the leaf is where the dressing drew it");
  const open=V.stateScene(SET(),PLAN,{people:{},doors:[{id:"front-door",open:true}]},CTX).base;
  const leaf=open.objects.find(o=>o.id==="extra-1"), handle=open.objects.find(o=>o.id==="extra-2"), head=open.objects.find(o=>o.id==="extra-3");
  assert.ok(near(leaf.position[0],1.6)&&near(leaf.position[1],0.4)&&near(leaf.position[2],1),"it hangs on a jamb and stands into the kitchen (the smaller room), never the yard");
  assert.ok(near(Math.abs(leaf.rotation[2]),Math.PI/2,1e-6),"a quarter turn");
  assert.ok(near(handle.position[0],1.56)&&near(handle.position[1],0.7),"its handle goes with it");
  assert.deepEqual(plain(head.position),[2,0,2.03],"the frame's head does not move");
  assert.deepEqual(plain(open.objects.filter(o=>o.anchorId==="front-door").map(o=>o.position)),plain(SET().objects.filter(o=>o.anchorId==="front-door").map(o=>o.position)));
  assert.equal(open.objects.length,SET().objects.length,"nothing is added when the set has the leaf");
  // it hangs on the jamb where the open leaf meets fewer things
  const crowded=SET(); crowded.objects.push({id:"rack",name:"Shoe rack",kind:"box",position:[1.55,0.45,0.3],rotation:[0,0,0],size:[0.3,0.6,0.6],material:"wall"});
  const other=V.stateScene(crowded,PLAN,{people:{},doors:[{id:"front-door",open:true}]},CTX).base.objects.find(o=>o.id==="extra-1");
  assert.ok(near(other.position[0],2.4)&&near(other.position[1],0.4),"the shoe rack is on the first side, so it opens to the other");
});
test("5b. a door the plan tracks by its own key is the floor plan's opening; a door with no leaf gets a plain one; a doorway gets none",()=>{
  const byKey=V.stateScene(SET(),PLAN,{people:{},doors:[{id:"street-door",open:true}]},CTX).base.objects.find(o=>o.id==="extra-1");
  assert.equal(V.openingId(SET(),"street-door",PLAN),"");
  assert.equal(V.openingId(SET(),"front-door",PLAN),"front-door");
  assert.deepEqual(plain(byKey.position),[2,0,1],"a key that names no opening moves nothing");
  const plan2={...PLAN,fixed:PLAN.fixed.concat([{id:"hall-front-door",set:"set1",kind:"opening",name:"Front door (frosted panel)"}])};
  const twin=SET(); twin.objects.forEach(o=>{ if(o.anchorId==="front-door") o.anchorId="hall-front-door"; });
  assert.equal(V.openingId(twin,"front-door",plan2),"hall-front-door","front-door is the opening whose name has both words");
  // no leaf in the set
  const bare=SET(); bare.objects=bare.objects.filter(o=>!/^extra-/.test(o.id));
  const shut=V.stateScene(bare,PLAN,{people:{},doors:[{id:"front-door",open:false}]},CTX).base;
  const made=shut.objects.find(o=>o.id==="door-front-door");
  assert.ok(made&&near(made.position[0],2)&&near(made.position[1],0)&&made.size[2]<=2.02&&shut.materials["door-standin"],"a shut door is drawn shut");
  const open=V.stateScene(bare,PLAN,{people:{},doors:[{id:"front-door",open:true}]},CTX).base.objects.find(o=>o.id==="door-front-door");
  assert.ok(open&&near(open.position[1],0.39,0.03)&&near(Math.abs(open.rotation[2]-made.rotation[2]),Math.PI/2,1e-6));
  const arch={...PLAN,fixed:[{id:"front-door",set:"set1",kind:"opening",name:"Hall-kitchen doorway"}]};
  assert.ok(!V.stateScene(bare,arch,{people:{},doors:[{id:"front-door",open:false}]},CTX).base.objects.some(o=>/^door-/.test(o.id)),"an open doorway has no leaf to draw");
  // a state that says nothing of a door leaves it as the set has it
  assert.deepEqual(plain(V.stateScene(SET(),PLAN,{people:{}},CTX).base.objects),plain(SET().objects));
});

/* ---- 6. what hides, and what is solid ---- */
const placed=()=>V.stateScene(SET(),PLAN,STATE,CTX);
const SHOT={beatN:1,moment:{n:1,of:2},size:"MS",angle:"eye",lens:"35",move:"static",subjects:["ann","bob"],startState:STATE,endState:STATE};
/* ---- 5c. a person at a shut door (2026-11-23, after moment 2 of Scene 5: the plan had Pike "on the threshold",
   "standing outside the shut door"; the mark is 10 cm inside the door, so he was drawn in the hall in front of a shut
   door, and the image engine opened the door) ---- */
const STEP_PLAN={...PLAN,marks:PLAN.marks.concat([{id:"m-step",set:"set1",name:"on the threshold",xy:[2,0.1]}])};
const STEP_CTX={...CTX,plan:STEP_PLAN,outdoors:["yard"]};
const atStep=(pose,open,ctx)=>V.stateScene(SET(),STEP_PLAN,{people:{ann:{where:"m-step",pose,holding:["mug"]},bob:{where:"m-b",pose:"standing",holding:[]}},
  things:{mug:{heldBy:"ann"}},doors:[{id:"front-door",open:!!open}]},ctx||STEP_CTX);
test("5c. nobody stands in a shut doorway: clear of the leaf on their own side, or out of doors when the plan's words say so",()=>{
  const out=atStep("standing outside the shut door, a shape in the glass"), ann=out.people[0];
  assert.ok(near(ann.xy[0],2)&&near(ann.xy[1],-0.4),"outside the shut front door, clear of its leaf");
  assert.equal(ann.door.id,"front-door"); assert.equal(ann.door.name,"Front door");
  assert.ok(near(ann.head[2],-0.1+1.7-0.115),"on the yard's own ground");
  assert.ok(out.scene.objects.some(o=>o.id==="fig-ann-torso"),"still drawn: a camera in the yard sees them");
  for(const pose of ["knocking","on the doorstep, waiting","rings the bell"]) assert.ok(atStep(pose).people[0].xy[1]<0,pose);
  // the plan's words do not say outside: they stay on the side their mark is on, clear of the leaf
  const inside=atStep("standing, one hand on the latch").people[0];
  assert.ok(near(inside.xy[0],2)&&near(inside.xy[1],0.4)); assert.equal(inside.door.id,"front-door");
  assert.ok(near(atStep("standing inside, not outside").people[0].xy[1],0.4),"'inside' wins");
  // an inner door has no outdoor side: 'outside the bedroom door' is where the mark is
  assert.ok(near(atStep("standing outside the shut door",false,{...STEP_CTX,outdoors:[]}).people[0].xy[1],0.4));
  // an open door, and a mark away from it, change nothing
  const open=atStep("standing outside the shut door",true).people[0];
  assert.deepEqual(plain(open.xy),[2,0.1]); assert.equal(open.door,null);
  const away=V.stateScene(SET(),PLAN,STATE,{...CTX,outdoors:["yard"]}).people[0];
  assert.deepEqual(plain(away.xy),[2,1]); assert.equal(away.door,null);
  // with no floor plan to tell the sides apart, nobody is moved
  assert.deepEqual(plain(atStep("standing outside the shut door",false,{...STEP_CTX,spaces:[]}).people[0].xy),[2,0.1]);
});
test("5d. a camera on the other side of the shut door does not have to see them, and the picture's words leave them out",()=>{
  const st=atStep("standing outside the shut door, a shape in the glass"), clear=clearOf(st.base);
  assert.equal(clear([2.6,2.2,1.5],st.people[0].head),false,"the shut door and its wall are in the way");
  const got=V.planCamera({at:[2.6,2.2],height:1.5,aim:["ann","bob"],lens:35},SHOT,st,st.base,STEP_PLAN,SPACES,{clear});
  assert.equal(got.source,"plan","the planned camera is kept: nothing it could see is hidden"); assert.deepEqual(plain(got.notes),[]);
  assert.deepEqual(plain(got.pose.position),[2.6,2.2,1.5]);
  // the same camera with them inside the shut door must see them (the rule is the door's, not the person's)
  const inn=atStep("standing, one hand on the latch");
  assert.equal(V.planCamera({at:[2.6,2.2],height:1.5,aim:["ann","bob"],lens:35},SHOT,inn,inn.base,STEP_PLAN,SPACES,{clear:()=>false}).notes.length,1);
  // a camera out in the yard is on their side of the door: it must see them
  const yard=V.planCamera({at:[2,-2.5],height:1.5,aim:["ann"],lens:35},{...SHOT,subjects:["ann"]},st,st.base,STEP_PLAN,SPACES,{clear:()=>false});
  assert.match(yard.notes[0],/hides someone it frames/);
  // the app's own camera counts them as seen from inside
  const found=V.camera(SHOT,st.people,SPACES,{clear,set:st.base,all:st.people});
  assert.ok(found.fits&&!found.notes.some(n=>/Not everyone/.test(n)));
  // the legend: pair marks who the door hides from its camera
  st.people[0].unseen=true;
  assert.deepEqual(plain(V.legend(st.people,st.things)),[
    "Ann Lee is on the other side of the shut front door and is NOT in this picture: no figure stands for them (standing outside the shut door, a shape in the glass).",
    "The pink figure is Bob Marsh (standing)."],"and what they hold is not in it either");
  assert.match(src,/unseen\(first\.people\);[\s\S]{0,260}is on the other side of the shut "\+lowName\(p\.door\.name\)\+" as this shot starts, so the picture starts without them\./);
  assert.match(src,/const outdoors=arr\(list\)\.concat\(\[location\]\)\.filter\(l=>l&&\/ext\/i\.test\(String\(l\.intExt\|\|""\)\)&&!\/int\/i\.test/,"which spaces are out of doors comes from the location cards");
});
/* ---- 5e. what hangs, and what sits on what (2026-11-23: moment 2 of Scene 5 came back with a stack of tubs on the
   hall shelf; nothing had said what is on it) ---- */
const DRESSED=()=>{ const set=SET(); set.objects.push(
  {id:"dress-1",name:"Row of key hooks · 1",kind:"box",anchorId:"hooks",position:[0.07,2,1.45],rotation:[0,0,-Math.PI/2],size:[0.35,0.02,0.08],material:"d_brown"},
  {id:"dress-2",name:"Row of key hooks · 2",kind:"box",anchorId:"hooks",position:[0.09,2.12,1.44],rotation:[0,0,-Math.PI/2],size:[0.02,0.03,0.02],material:"d_steel"},
  {id:"dress-3",name:"Row of key hooks · 3",kind:"box",anchorId:"hooks",position:[0.09,2,1.44],rotation:[0,0,-Math.PI/2],size:[0.02,0.03,0.02],material:"d_steel"},
  {id:"dress-4",name:"Row of key hooks · 4",kind:"box",anchorId:"hooks",position:[0.09,1.88,1.44],rotation:[0,0,-Math.PI/2],size:[0.02,0.03,0.02],material:"d_steel"},
  {id:"extra-8",name:"table clutter · 1",kind:"box",position:[3.2,2.1,0.76],rotation:[0,0,0],size:[0.1,0.2,0.02],material:"d_paper"},
  {id:"extra-9",name:"table clutter · 2",kind:"cylinder",position:[2.8,1.9,0.78],rotation:[0,0,0],size:[0.08,0.08,0.06],material:"d_brown"},
  {id:"anchor-9",name:"Kettle · body",kind:"cylinder",anchorId:"kettle",position:[3.3,1.8,0.85],rotation:[0,0,0],size:[0.16,0.16,0.2],material:"kitchenOat"},
  {id:"extra-10",name:"rug · 1",kind:"box",position:[2,1.5,0.01],rotation:[0,0,0],size:[1.5,1,0.02],material:"d_red"}); return set; };
const DRESS_PLAN={...PLAN,fixed:PLAN.fixed.concat([{id:"hooks",set:"set1",kind:"object",name:"Row of key hooks"},{id:"kettle",set:"set1",kind:"object",name:"Kettle"}]),
  things:PLAN.things.concat([{key:"keys",name:"Cab keys",kind:"prop"}])};
test("5e. keys on a hook hang under it, flat to the wall, on the room's side",()=>{
  const got=V.stateScene(DRESSED(),DRESS_PLAN,{people:{},things:{keys:{at:"hooks",state:"hanging"},parcel:{at:"table"}},doors:[]},{...CTX,plan:DRESS_PLAN});
  const keys=got.things.find(t=>t.key==="keys"), box=got.scene.objects.find(o=>o.id==="prop-keys");
  assert.ok(keys.hung&&keys.onId==="hooks"&&keys.on==="Row of key hooks");
  assert.ok(near(box.position[1],2),"on the middle hook"); assert.ok(box.position[0]>0.1&&box.position[0]<0.2,"off the west wall, into the room");
  assert.ok(near(box.position[2]+box.size[2]/2,1.44),"its top at the hook"); assert.ok(box.size[2]>=box.size[0]&&box.size[1]<=box.size[0],"it hangs long, its thin side to the wall");
  const parcel=got.things.find(t=>t.key==="parcel");
  assert.ok(!parcel.hung&&parcel.onId==="table"&&near(parcel.at[2],0.75),"a parcel on a table still stands on its top");
  assert.match(V.legend([],got.things)[0],/^The red shape hanging from the row of key hooks is the Cab keys\.$/);
});
test("5f. what sits on each fixed thing is read from the set and said, and that nothing else is on it",()=>{
  const ctx={...CTX,plan:DRESS_PLAN};
  const got=V.stateScene(DRESSED(),DRESS_PLAN,{people:{},things:{keys:{at:"hooks",state:"hanging"},parcel:{at:"table"}},doors:[]},ctx);
  assert.deepEqual(plain(got.surfaces.map(s=>s.id)),["table","hooks"],"the rug on the floor holds the room, not a shelf; the kettle holds nothing");
  const table=got.surfaces[0];
  assert.deepEqual(plain(table.own),[{name:"table clutter",items:["a flat paper thing about 20 cm long","a round brown thing about 8 cm across"]},{name:"Kettle",fixture:true}]);
  assert.deepEqual(plain(table.things),[{name:"Parcel",hung:false}]); assert.equal(got.surfaces[1].hooks,3);
  assert.deepEqual(plain(V.dressingWords(got.surfaces)),[
    "On the kitchen table sit only a flat paper thing about 20 cm long, a round brown thing about 8 cm across, the kettle and the red shape that is the parcel: nothing else is on it.",
    "On the row of key hooks (3 hooks) hangs only the red shape that is the cab keys: every other hook is empty."]);
  // the hook once the keys are gone: said empty (the story's last image)
  const bare=V.stateScene(DRESSED(),DRESS_PLAN,{people:{},things:{},doors:[]},ctx);
  assert.deepEqual(plain(V.dressingWords(bare.surfaces.filter(s=>s.id==="hooks"))),["Nothing hangs on the row of key hooks: all 3 hooks are empty."]);
  // an open door's leaf is never something "on" the shelf it swings past
  const open=V.stateScene(DRESSED(),DRESS_PLAN,{people:{},things:{},doors:[{id:"front-door",open:true}]},ctx);
  assert.deepEqual(plain(open.surfaces),plain(bare.surfaces));
  assert.deepEqual(plain(V.dressingWords([])),[]);
  // only for a frame that is made (words), only what the camera has in frame, and it rides in the legend
  assert.ok(src.includes("if(o.words){ const seen=await seenIn(first.scene,found.pose); out.start.words=frameWords(found.pose,seen); out.start.dressing=dressingWords(await inView(first.surfaces,found.pose,first.base));"));
  assert.match(src,/return hit\.sort\(\(a,b\)=>a\.d-b\.d\)\.slice\(0,4\)\.map\(x=>x\.s\);/);
  assert.match(ui,/legend:SPv\.legend\(people, things\)\.concat\(pic\.dressing\|\|\[\]\)/);
});
test("5g. an open leaf is hung on the jamb where it passes through nothing; a wall beside it never counts",()=>{
  // a shelf on the wall on one side: the leaf would swing through it, so it opens to the other side, against the short wall there
  const set=SET(); set.objects.push({id:"dress-s",name:"Hall shelf · 1",kind:"box",anchorId:"shelf",position:[1.62,0.5,1.2],rotation:[0,0,-Math.PI/2],size:[0.6,0.18,0.03],material:"d_oak"},
    wall("wall-stub",[2.5,0.4,1.2],[0.15,0.8,2.4]));
  const leaf=V.stateScene(set,PLAN,{people:{},doors:[{id:"front-door",open:true}]},CTX).base.objects.find(o=>o.id==="extra-1");
  assert.ok(near(leaf.position[0],2.4)&&near(leaf.position[1],0.4),"away from the shelf, flat against the wall stub");
  // something low under the leaf's swing counts; something above the leaf does not
  const high=SET(); high.objects.push({id:"lamp",name:"Lamp",kind:"box",position:[1.6,0.4,2.2],rotation:[0,0,0],size:[0.2,0.2,0.1],material:"wall"});
  assert.ok(near(V.stateScene(high,PLAN,{people:{},doors:[{id:"front-door",open:true}]},CTX).base.objects.find(o=>o.id==="extra-1").position[0],1.6));
});
test("6. a person on the line hides a face; a point in a wall, a door or furniture is no place for a camera",()=>{
  const p={id:"ann",xy:[2,1],head:[2,1,1.585],height:1.7};
  assert.equal(V.hides([0.5,1,1.5],[3.2,1,1.6],p),true);
  assert.equal(V.hides([0.5,1.6,1.5],[3.2,1.6,1.6],p),false,"0.6 m to the side");
  assert.equal(V.hides([0.5,1,2.4],[3.2,1,2.3],p),false,"over her head");
  assert.equal(V.hides([2.02,1,1.5],[3.2,1,1.6],p),false,"the camera is at her own place (her point of view)");
  const set=SET();
  assert.equal(V.solidAt(set,[1,1.5,1.5]),true);
  assert.equal(V.solidAt(set,[1.12,1.5,1.5]),true,"too close to it to stand a camera");
  assert.equal(V.solidAt(set,[1.5,1.5,1.5]),false);
  assert.equal(V.solidAt(set,[3,2,1.5]),false,"over the table is free");
  assert.equal(V.solidAt(set,[3,2,0.73]),true);
  assert.equal(V.solidAt(set,[2,0,1.5]),true,"in the shut door");
});

/* ---- 7. the planned camera, checked ---- */
test("7. a planned camera that can stand there is kept as it is",()=>{
  const st=placed();
  const got=V.planCamera({at:[2.6,2.6],height:1.5,aim:["ann","bob"],lens:35},SHOT,st,st.base,PLAN,SPACES,{clear:clearOf(st.base)});
  assert.equal(got.source,"plan"); assert.equal(got.fits,true); assert.deepEqual(plain(got.notes),[]);
  assert.deepEqual(plain(got.pose.position),[2.6,2.6,1.5]);
  assert.equal(got.pose.lensMm,35);
  assert.ok(near(got.pose.yaw,180,0.5),"it looks south, at the middle of the two");
  assert.ok(got.pose.pitch<0&&got.pose.pitch>-20,"a little down, at a medium shot's height");
  assert.equal(V.planCamera({at:[2.6]},SHOT,st,st.base,PLAN,SPACES,{}),null,"no numbers is no planned camera");
  assert.equal(V.planCamera(null,SHOT,st,st.base,PLAN,SPACES,{}),null);
});
test("7b. in a wall, off the floor plan, or behind someone: it goes to the spot that works and keeps the shot best, and says why",()=>{
  const st=placed(), clear=clearOf(st.base);
  const inWall=V.planCamera({at:[1,1.5],height:1.5,aim:["ann"]},{...SHOT,subjects:["ann"]},st,st.base,PLAN,SPACES,{clear});
  assert.equal(inWall.source,"moved");
  assert.match(inWall.notes[0],/^The planned camera stood inside a wall or a piece of furniture\. It was moved 0\.\d+ m, to the spot that works and keeps the shot best\.$/);
  assert.ok(!V.solidAt(st.base,inWall.pose.position)&&V.spaceAt(SPACES,inWall.pose.position[0],inWall.pose.position[1]).id==="room");
  const off=V.planCamera({at:[2.6,3.4],height:1.5,aim:["ann","bob"]},SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(off.source,"moved");
  assert.match(off.notes[0],/^The planned camera stood off the floor plan\./);
  assert.ok(off.pose.position[1]<3&&off.pose.position[1]>2.4);
  const behind=V.planCamera({at:[1.3,1],height:1.5,aim:["bob"]},{...SHOT,subjects:["bob"]},st,st.base,PLAN,SPACES,{clear});
  assert.equal(behind.source,"moved");
  assert.match(behind.notes[0],/^From the planned camera one person hid another\./);
  assert.ok(!V.hides(behind.pose.position,st.people[1].head,st.people[0]));
  const onMark=V.planCamera({at:[2.05,1.05],height:1.5,aim:["bob"]},{...SHOT,subjects:["bob"]},st,st.base,PLAN,SPACES,{clear});
  assert.match(onMark.notes[0],/^The planned camera stood where a person stands\./);
});
test("7c. far off the floor plan the app places the camera; hidden from everywhere, the planned one stays and says so",()=>{
  const st=placed(), clear=clearOf(st.base);
  const far=V.planCamera({at:[2,9],height:1.5,aim:["ann","bob"]},SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(far.source,"app");
  assert.match(far.notes[0],/^The planned camera stood off the floor plan\. No spot near it works, so the app placed the camera\.$/);
  assert.ok(far.pose&&V.spaceAt(SPACES,far.pose.position[0],far.pose.position[1]));
  const blind=V.planCamera({at:[2.6,2.6],height:1.5,aim:["ann","bob"]},SHOT,st,st.base,PLAN,SPACES,{clear:()=>false});
  assert.equal(blind.source,"plan");
  assert.deepEqual(plain(blind.pose.position),[2.6,2.6,1.5]);
  assert.match(blind.notes[0],/something in the set hides someone it frames \(a wall or a shut door\), from the planned camera and from every spot near it that keeps the shot\./);
});
test("7d. the lens is the one that shows the planned shot size from where the camera stands",()=>{
  const st=placed(), clear=clearOf(st.base);
  const tight=V.planCamera({at:[2.6,1.7],height:1.5,aim:["ann","bob"],lens:85},SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(tight.lensPlanned,85);
  assert.ok(tight.pose.lensMm<30,"0.7 m away, an 85 mm lens would show a detail, not a medium shot");
  assert.match(tight.notes[0],/^From 0\.\d m a 85 mm lens shows less than the medium shot planned, so the lens is \d+ mm\.$/);
  const wide=V.planCamera({at:[2.6,2.8],height:1.5,aim:["ann"],lens:14},{...SHOT,size:"CU",subjects:["ann"]},st,st.base,PLAN,SPACES,{clear});
  assert.ok(wide.pose.lensMm>40);
  assert.match(wide.notes[0],/shows more than the close-up planned/);
  // an insert looks at the thing itself
  const ins=V.planCamera({at:[3,2.7],height:1.2,aim:["parcel"],lens:85},{...SHOT,size:"INSERT",subjects:[]},st,st.base,PLAN,SPACES,{clear});
  assert.ok(ins.pose&&ins.pose.pitch<-20&&near(ins.pose.yaw,180,1),"down at the parcel on the table");
  // what someone has on is looked at where it is worn: shoes at the floor
  const shod=V.stateScene(SET(),{...PLAN,things:PLAN.things.concat([{key:"ann-shoes",name:"Ann's shoes",kind:"wardrobe"}])},{...STATE,things:{...STATE.things,"ann-shoes":{worn:"ann"}}},CTX);
  assert.deepEqual(plain(shod.worn.map(w=>[w.key,w.by])),[["coat","ann"],["ann-shoes","ann"]]);
  const feet=V.aimOf({aim:["ann-shoes"]},{...SHOT,size:"ECU"},shod,shod.base,PLAN);
  assert.ok(feet.target[2]<0.2&&feet.who.length===0,"an extreme close-up of her shoes looks at the floor, not at her face");
  // over a shoulder: the person the camera stands behind is in the frame on purpose
  const ots=V.planCamera({at:[1.5,1.05],height:1.55,aim:["bob"],lens:35},{...SHOT,angle:"ots",subjects:["ann","bob"]},st,st.base,PLAN,SPACES,{clear});
  assert.equal(ots.source,"plan"); assert.deepEqual(plain(ots.pose.position),[1.5,1.05,1.55]);
  assert.equal(V.planCamera({at:[1.5,1.05],height:1.55,aim:["bob"],lens:35},{...SHOT,angle:"eye",subjects:["bob"]},st,st.base,PLAN,SPACES,{clear}).source,"moved","the same spot is in the way for any other shot");
  // everyone the shot frames must be seen, not only who the camera is centred on
  const both=V.planCamera({at:[1.3,1],height:1.5,aim:["ann"],lens:35},{...SHOT,subjects:["ann","bob"]},st,st.base,PLAN,SPACES,{clear});
  assert.equal(both.source,"moved"); assert.match(both.notes[0],/^From the planned camera one person hid another\./);
  assert.equal(V.planCamera({at:[1.3,1],height:1.5,aim:["ann"],lens:35},{...SHOT,subjects:["ann"]},st,st.base,PLAN,SPACES,{clear}).source,"plan","Bob is not in this frame: Ann in front of him is no fault");
  // someone right in front of the lens is said
  const close=V.planCamera({at:[1.72,1.02],height:1.55,aim:["bob"],lens:35},{...SHOT,angle:"ots",subjects:["ann","bob"]},st,st.base,PLAN,SPACES,{clear});
  assert.ok(close.notes.some(n=>/^Ann Lee stands 0\.3 m in front of the camera and fills much of the frame\.$/.test(n)),close.notes.join(" | "));
  // a shot with nobody named in aim frames the people in frame
  const auto=V.aimOf({},SHOT,st,st.base,PLAN);
  assert.deepEqual(plain(auto.who.map(p=>p.id)),["ann","bob"]);
  assert.ok(near(auto.target[0],2.6)&&near(auto.target[1],1));
  assert.equal(V.cameraKey(SHOT),"1.1"); assert.equal(V.cameraKey({beatN:4,moment:{n:3}}),"4.3"); assert.equal(V.cameraKey({beat:2,moment:2}),"2.2");
});

/* ---- 8. the camera found by the app ---- */
test("8. with no planned camera the app finds one: in the room, out of the walls, seeing every face",()=>{
  const st=placed(), clear=clearOf(st.base);
  const got=V.camera(SHOT,st.people,SPACES,{clear,set:st.base,all:st.people});
  assert.equal(got.fits,true);
  const p=got.pose.position;
  assert.equal(V.spaceAt(SPACES,p[0],p[1]).id,"room");
  assert.ok(!V.solidAt(st.base,p));
  assert.ok(st.people.every(a=>clear(p,a.head)&&!st.people.some(b=>b.id!==a.id&&V.hides(p,a.head,b))),"nobody hides anybody");
  assert.ok(Math.abs(p[1]-1)>0.5,"across the line between them, not along it");
  // an insert: a point to look at, nobody in frame
  const ins=V.camera({size:"INSERT",lens:"85",angle:"eye"},[],SPACES,{clear,set:st.base,point:[3,2,0.8]});
  assert.ok(ins.pose&&ins.fits);
  // nothing to aim at
  assert.equal(V.camera(SHOT,[],SPACES,{}).pose,null);
  // someone hidden from everywhere (behind a shut door as the shot starts): the spot that sees the most, and a note
  const half=V.camera(SHOT,st.people,SPACES,{clear:(from,to)=>to[0]<3,set:st.base,all:st.people});
  assert.equal(half.fits,true);
  assert.match(half.notes[0],/^Not everyone in this shot can be seen from any spot in the room as it starts/);
});

/* ---- 9. the camera pass ---- */
test("9. the camera pass's answer is read safely: the scene's own shots, real numbers, the plan's own ids",()=>{
  const out=SP.normalizeCameras({cameras:[
    {beat:1,moment:1,at:[2.604,2.6],height:1.5,aim:["Ann","table","the moon"],lens:"35mm",faces:{ann:"bob",bob:"camera",cy:"cy",zed:"ann"},why:"  across   the line "},
    {beat:1,moment:1,at:[0,0]},                 // the same shot twice
    {beat:1,moment:2,at:[1,"2"]},               // not two numbers
    {beat:7,moment:1,at:[1,1]},                 // not a shot of this scene
    {beat:2,moment:1,at:[1.5,0.5],height:9,lens:2}]},
    {keys:["1.1","1.2","2.1"],cast:CAST.map(c=>({id:c.id,name:c.name})),ids:["table","front-door","m-a","mug"]});
  assert.deepEqual(plain(out.cameras["1.1"]),{at:[2.6,2.6],height:1.5,aim:["ann","table"],lens:35,faces:{ann:"bob",bob:"camera"},why:"across the line"});
  assert.deepEqual(plain(out.cameras["2.1"]),{at:[1.5,0.5],aim:[],faces:{},why:""},"a height or a lens out of range is left to the app");
  assert.equal(out.dropped,3); assert.deepEqual(plain(out.missing),["1.2"]);
  assert.equal(SP.cameraKey(3,2),"3.2"); assert.equal(SP.cameraKey("3",null),"3.1");
  assert.equal(SP.shotCameraKey({beatN:4,moment:{n:5,of:5},keyframeMode:"moment"}),"4.5");
  assert.equal(SP.shotCameraKey({beatN:2,keyframeMode:"beat-opening"}),"2.1");
  assert.deepEqual(plain(SP.normalizeCameras(null,{keys:["1.1"]})),{cameras:{},dropped:0,missing:["1.1"]});
});
test("9b. placing the cameras asks first, by the engine's own name, and says what it does not change",()=>{
  const q=SP.camerasConfirmText({sceneNo:5,engine:"Engine X"});
  assert.equal(q.title,"Place the cameras of Scene 05 (writing credits)?");
  assert.equal(q.body,"One short writing pass on Engine X gives each planned shot a camera on the floor plan: where it stands, how high, what it looks at and its lens. The app then checks each one against the set in 3D and moves any that cannot stand there. No shot is changed and no image is made.");
  assert.equal(q.confirmLabel,"Place the cameras");
  assert.match(SP.camerasConfirmText({sceneNo:5,again:true}).body,/ It replaces the cameras this scene has now\.$/);
  // the pass: one short call for every five shots (a dozen ran past the server's limit), on the scene plan's engine
  assert.ok(ai.includes("const SCENE_CAMERAS_GROUP = 5;"));
  const at=ai.indexOf("async function aiPlanCameras(scene, ctx){"), body=ai.slice(at,ai.indexOf("window.aiPlanCameras = aiPlanCameras;",at));
  assert.ok(at>0&&body.includes("timeoutMs:SCENE_PLAN_CALL_MS")&&body.includes("SP.normalizeCameras(scrubbed"));
  assert.ok(body.includes("scenePlanSetLayout(loc, locations)")&&body.includes("SP.shotCameraKey(sh)"));
  for(const rule of ["The camera stands INSIDE a space's outline","crosses no wall and no fixed object","distance in metres = the height shown x the lens in mm / 20","Keep to the line's side for the whole scene","never change them"])
    assert.ok(body.includes(rule),rule);
  assert.ok(body.includes('throw new Error("Plan this scene first: the cameras stand on the plan\'s marks. Nothing was changed.")'));
  assert.ok(ai.includes('["aiPlanScene","aiPlanCameras","aiBeatFrames"].forEach(n=>{ const fn = window[n];'),"it runs on the scene plan's engine unless one is picked");
  assert.ok(!/claude|anthropic|fable|opus|sonnet|gemini|gpt/i.test(body.replace(/window\.claude\.complete|provider==="anthropic"/g,"")),"no engine is named in what it is told");
});

/* ---- 10. the card, the plan's row, the app's action, the keys ---- */
test("10. the shot card has a Previs fold: two pictures from one camera, the camera's line, plain notes; nothing is saved",()=>{
  assert.ok(shotsUi.includes('window.ShotPrevisFold && _el(window.ShotPrevisFold,{key:"previs-"+sh.id,sh,ctx,onView,beatLabel,'));
  assert.ok(shotsUi.indexOf("window.ShotPrevisFold && _el(")>shotsUi.indexOf('label:"2 \\u00b7 Camera"')&&shotsUi.indexOf("window.ShotPrevisFold && _el(")<shotsUi.indexOf('_el(CardFold,{label:"Shot prompt"'),"right under the camera");
  assert.ok(ui.includes('if(!sh || !sh.planned || !sh.startState || !SP || !SPv || !window.KinolotPrevis) return null;'),"planned shots only");
  assert.ok(ui.includes('if(!plan || !SP.exact(plan)) return null;'),"a plan with marks only");
  assert.ok(ui.includes('SPV_E(CardFold,{label:"Previs",count:!ready ? "needs a floor plan" : (cam && cam.hand) ? "your angle" : cam ? "camera placed" : "camera by the app",defaultOpen:false,foldId:"shot-previs-"+sh.id}'));
  assert.ok(ui.includes('window.ShotPrevis.pair(loc, ctx.locations||[], plan, sh, { cam, cast, props, width:960,')&&ui.includes("...(staged ? { startState:staged.start, endState:staged.end } : {}) }) : null;"),"the card's previs is the strip's own panel");
  assert.ok(ui.includes("const turn = shotPrevisLine.then(run, run);"),"one drawing at a time");
  assert.ok(ui.includes('pic(res.start, res.end ? "How it starts" : "Start and end"')&&ui.includes('res.end && pic(res.end, "How it ends"'));
  assert.ok(ui.includes('"Nothing moves in this shot: it ends as it starts."'));
  assert.ok(ui.includes('"The camera stands "+shotPrevisNum(res.distance,1)+" m away"'));
  assert.ok(ui.includes('"Placed by "+byLabel+", checked against the set."')&&ui.includes('"Placed by "+byLabel+", then moved by the app."')&&ui.includes('"Placed by the app."'));
  assert.ok(ui.includes("const byLabel = (plan.camerasBy && plan.camerasBy.label) || \"the writing engine\";"),"the engine by the name the plan kept, never a literal");
  assert.ok(ui.includes("It costs nothing and changes nothing."));
  assert.ok(!/setProject|onUpdate|nbCommit|nbGenerate|sbClient|claude\.complete/.test(ui),"the fold draws; it never saves, spends or calls an engine itself (its button asks the card's own Generate)");
  assert.ok(!/\b(TURN|MUSE|Claude|Anthropic|Fable|Opus|Gemini|GPT|Blender)\b/.test(ui.replace(/\/\*[\s\S]*?\*\//g,"")),"no internal or vendor name in what it shows");
  // the drawing itself: one camera for both pictures, worked out from how the shot starts
  const at=src.indexOf("async function pair("), body=src.slice(at,src.indexOf("async function frame(",at));
  assert.ok(body.includes("const first=stateScene(built.scene,plan,startState,ctx);")&&body.includes("out.start={dataUrl:await draw(first.scene)};")&&body.includes("out.end={dataUrl:await draw(last.scene)"));
  assert.equal((body.match(/view\.render\(canvas,found\.pose,width,height\)/g)||[]).length,1,"both are drawn through the one camera");
  assert.ok(body.includes("if(endState&&!sameState(startState,endState)){"),"a shot that ends as it starts has one picture");
  for(const c of [".shot-previs-pics{display:grid;grid-template-columns:1fr 1fr;gap:8px}",".shot-previs-note{","@media (max-width:560px){ .shot-previs-pics{grid-template-columns:1fr} }"]) assert.ok(css.includes(c),c);
});
test("10b. the Scene plan has a Cameras row; placing them is saved with the plan and never touches a shot",()=>{
  assert.ok(shotsUi.includes('"data-testid":"scene-plan-cameras"')&&shotsUi.includes('onClick:()=>onPlan(scene,{cameras:true})},_el(Icon.sparkles,{s:12}),camCount?"Place again":"Place the cameras")'));
  assert.ok(shotsUi.includes('"Not placed yet: each shot\\u2019s Previs uses a camera found by the app."'));
  assert.ok(app.includes("if(opts && opts.cameras) return placeSceneCameras(scene);"));
  const at=app.indexOf("const placeSceneCameras = async (scene, opts)=>{"), body=app.slice(at,app.indexOf("const planSceneShots = async (scene, opts)=>{",at));
  assert.ok(at>0&&body.includes("const q = SP.camerasConfirmText({ sceneNo:scene.no, engine,")&&body.indexOf("window.appConfirm(q)")<body.indexOf("window.aiPlanCameras(scene"),"alone, it asks before it spends");
  assert.ok(body.includes("if(!cur || cur.at!==plan.at) return p;"),"only onto the plan it was made for");
  assert.ok(body.includes("[scene.id]:{ ...cur, cameras:SP.keepHandCameras(cur.cameras, res.cameras, keysNow), camerasAt:new Date().toISOString(),"),"(an angle set by hand is kept: step 5)");
  assert.ok(!/setShots|shotsLiveRef\.current\s*=|commitBeatKeyframes/.test(body),"no shot, no frame and no approval changes");
  assert.ok(body.includes("if(!canDesignShots()) return 0;")||body.includes("|| !canDesignShots()) return 0;"));
  // a new plan places them as its last step, and a failure there leaves the plan
  assert.ok(app.includes("const cams = SP.exact(doc) ? await placeSceneCameras(scene, { plan:doc }) : 0;"));
  assert.ok(body.includes('"Scene "+no+" is planned, but its cameras could not be placed: "'));
  assert.match(SP.confirmText({sceneNo:5}).body,/\(the staging, then the shots a few beats at a time, then each shot's camera on the floor plan\); no image is made\./);
});
test("10c. the scripts load in order, with current keys",()=>{
  const i=s=>html.indexOf(s);
  assert.ok(i("app/set-previs.js?v=")<i("app/shot-previs.js?v=")&&i("app/scene-plan.js?v=")<i("app/shot-previs.js?v="),"after the set's own 3D and the plan");
  assert.ok(i("app/shots-ui.jsx?v=")<i("app/shot-previs-ui.jsx?v=")&&i("app/artroom.jsx?v=")<i("app/shot-previs-ui.jsx?v="));
  for(const f of ["shot-previs.js","shot-previs-ui.jsx","shots-ui.jsx","scene-plan.js","app.jsx","ai.jsx","script.jsx","styles.css"])
    assert.ok(["20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1"].some(k=>html.includes('app/'+f+'?v='+k+'"')),f+" has a current key");
});

/* ---- 11. Frances ---- */
test("11. Frances is told about the previs and the cameras, with no vendor and no billing word",()=>{
  const at=ai.indexOf('APP_FEATURES.push({ name:"Shots: the previs of a shot, and its camera on the floor plan"');
  assert.ok(at>0,"the fact is there");
  const fact=ai.slice(at,ai.indexOf("\n",at));
  for(const t of ["Previs","how it starts","how it ends","Place the cameras","floor plan","moves it to the spot that works and keeps the shot best","Make the frame from this previs","the layout it must follow","start with Layout","END FRAME"]) assert.ok(fact.includes(t),t);
  assert.ok(!fact.includes("NOT YET"));
  assert.ok(!/credit|\$|claude|anthropic|fable|opus|gemini|gpt|TURN|MUSE/i.test(fact.replace(/APP_FEATURES/,"")),"no price, no engine, no internal name");
});

/* ================= STEP 2 (2026-11-23): a frame made FROM its previs, and checked against it ================= */
const shotsBox={console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,isFinite,parseInt,parseFloat,setTimeout,clearTimeout,
  document:{createElement:()=>({getContext:()=>({measureText:()=>({width:1}),fillRect(){},fillText(){}}),toDataURL:()=>""})},turnContinuity:{},
  CustomEvent:(type,init)=>({type,detail:init&&init.detail}),dispatchEvent:()=>{}};
shotsBox.window=shotsBox; shotsBox.globalThis=shotsBox; vm.createContext(shotsBox);
for(const f of ["app/scene-order.js","app/shot-screenplay.js","app/shot-scene-context.js","app/shots.jsx","app/scene-plan.js"]) vm.runInContext(read(f),shotsBox,{filename:f});
const shotsSrc=read("app/shots.jsx"), art=read("app/artroom.jsx");

test("12. each person has a named colour, the same through a scene, never the props' red; the legend says what each stand-in is",()=>{
  const pal=V.paletteFor(PLAN,["ann","bob"]);
  assert.deepEqual(plain([pal.ann.name,pal.bob.name,pal.cy.name]),["blue","pink","green"],"by id order among everyone the plan blocks");
  assert.equal(V.paletteFor(PLAN,["bob"]).bob.name,"pink","the same person keeps the colour when the others are out of frame");
  assert.equal(V.paletteFor(PLAN,["zed"]).zed.name,"yellow","someone the blocking does not name takes the next colour");
  assert.ok(V.PALETTE.every(c=>!/red|orange/.test(c[0])));
  const st=V.stateScene(SET(),PLAN,STATE,CTX);
  assert.deepEqual(plain(st.people.map(p=>[p.id,p.colour,p.pose])),[["ann","blue","standing"],["bob","pink","standing"]]);
  assert.deepEqual(plain(st.scene.materials["standin-ann"].baseColor),plain(V.PALETTE[0][1]));
  assert.deepEqual(plain(V.legend(st.people,st.things)),["The blue figure is Ann Lee (standing).","The pink figure is Bob Marsh (standing).",
    "The red shape in Ann Lee’s hands is the Mug.","The red shape on the kitchen table is the Parcel."]);
  assert.deepEqual(plain(V.legend([],[])),[]);
});

test("13. the prompt of a frame made from its previs: Image 1 is the layout and wins; the engine adds nothing built",()=>{
  const scene={id:"s5",no:5,title:"The Lunch Box",loc:"INT. HUSSAIN KITCHEN - NIGHT"};
  const blocks=[{type:"scene",text:"INT. HUSSAIN KITCHEN - NIGHT",beat:1},{type:"action",text:"AMIRA HUSSAIN packs rice into a Tupperware at the counter.",beat:1}];
  const chars=[{id:"amira",name:"AMIRA HUSSAIN"}];
  const ctx={scene,location:null,project:{id:"f"},charById:{amira:chars[0]},propById:{},drafts:{s5:{version:"v1",blocks}},scenes:[scene]};
  const sh={id:"b1",sceneId:"s5",beatN:1,order:1,keyframeMode:"beat-opening",moment:{n:1,of:1},planned:true,subjectsByPlan:true,subjects:["amira"],size:"MS",angle:"eye",lens:"35",move:"static",action:"Amira packs rice."};
  const legend=["The blue figure is AMIRA HUSSAIN (standing).","The red shape in AMIRA HUSSAIN’s hands is the Tupperware."];
  const refs=[{note:"AMIRA HUSSAIN's character sheet",referenceKind:"character"},{note:"the finished frame of the shot before this one — take ONLY its look from it"},{note:"Hussain kitchen location image",locationId:"loc1"}];
  const words="camera 1.5 m high, facing south-west, 24 mm lens (wide). In its frame: AMIRA HUSSAIN (centre, close); Counter (right, close).";
  const p=shotsBox.buildShotPrompt(sh,{...ctx,resolvedRefs:refs,previs:{url:"data:x",legend,words}});
  assert.ok(p.includes("Image 4 is Hussain kitchen location image — for materials, surfaces, colour and light ONLY: take no layout, no camera, no viewpoint and no position of anything from it."),"the place's own image gives the look, never the layout");
  assert.ok(p.includes("WHAT IMAGE 1 SHOWS, read from the 3D set: camera 1.5 m high, facing south-west, 24 mm lens (wide). In its frame: AMIRA HUSSAIN (centre, close); Counter (right, close). Image 1 is built from plain shapes:"));
  assert.ok(p.includes("Never a different or more flattering view of the place: not a wider one, not one turned to look down a corridor, not one from another spot."));
  assert.ok(p.includes("Where a word below says where the camera stands, what it looks at or how the room is laid out, it describes Image 1 and never changes it."));
  assert.ok(p.startsWith("Render Image 1 as the finished cinematic still. Image 1 is a 3D PREVIS of this exact shot, drawn to scale from the set's own model through this shot's real camera"),p.slice(0,160));
  assert.ok(p.includes("Image 2 is AMIRA HUSSAIN's character sheet")&&p.includes("Image 3 is the finished frame of the shot before this one"),"the sheets and the look reference follow, numbered after it");
  for(const t of ["THE LAYOUT IS IMAGE 1 (binding: where Image 1 and any other image or any word below disagree about where something is, how big it is or which way it faces, Image 1 is right).",
    "ITS STAND-INS: The blue figure is AMIRA HUSSAIN (standing). The red shape in AMIRA HUSSAIN’s hands is the Tupperware.",
    "The pale panel on a figure's head is its face: the person looks that way.",
    "as tall in the frame as their block and facing the same way",
    "where the shape is, turned as the shape is, and exactly as large in the frame as the shape","each red shape is that thing built at its true size, so never draw the thing larger or smaller than its shape",
    "ADD NOTHING BUILT: no door, doorway, window, wall, step, furniture or fixture that Image 1 does not show, and none moved, widened, narrowed or removed;",
    "a door shut in Image 1 is shut, an open one is open at that same angle; the room is as wide and as deep as Image 1 draws it.",
    "No person and no object that Image 1 does not show."]) assert.ok(p.includes(t),t);
  assert.ok(!p.includes("the REFERENCE frame — carry its colour grade"),"the chained frame is never Image 1 here");
  assert.ok(!p.includes("Compose a new cinematic still"));
  // the same shot made the ordinary way is untouched
  const q=shotsBox.buildShotPrompt(sh,{...ctx,resolvedRefs:refs.slice(0,1)});
  assert.ok(q.startsWith("Compose a new cinematic still. Image 1 is AMIRA HUSSAIN's character sheet")&&!/PREVIS|THE LAYOUT IS IMAGE 1/.test(q));
  assert.ok(!shotsBox.buildShotPrompt(sh,{...ctx,resolvedRefs:refs}).includes("for materials, surfaces, colour and light ONLY"),"an ordinary frame reads its location image as before");
  // the camera and its frame in words
  assert.equal(V.frameWords({position:[1,1.3,1.5],yaw:-128.29,pitch:-12,lensMm:24},[{name:"Hall shelf",side:"right",depth:"close"}]),
    "camera 1.5 m high, facing south-west, looking down, 24 mm lens (wide). In its frame: Hall shelf (right, close).");
  assert.equal(V.frameWords({position:[0,0,1.6],yaw:0,pitch:0,lensMm:50},[]),"camera 1.6 m high, facing north, 50 mm lens (normal).");
  // an end frame never takes this road (it is an edit of its shot's frame, guided by the end drawing)
  assert.ok(shotsSrc.includes('const _previs = (ctx.previs && typeof ctx.previs==="object" && !_isEndFrame) ? ctx.previs : null;'));
  assert.ok(shotsSrc.includes('" Take the set\'s materials, surfaces and light direction from the location view and its geometry from Image 1 alone;'));
});

test("14. the card: the Previs fold's button sends the drawing with the shot's own Generate, as the base image, large",()=>{
  assert.ok(ui.includes('"data-testid":"shot-previs-make"')&&ui.includes('"Make the frame from this previs"'));
  assert.ok(shotsUi.includes('const makeFromPrevis = ()=>{ if(typeof window.shotPrevisAskNext==="function") window.shotPrevisAskNext(sh.id); return genGuarded.generate(); };')&&shotsUi.includes("onMake:readOnly ? null : makeFromPrevis,"),"through the scene's runner, as every Generate");
  const at=shotsUi.indexOf("const generateWithProps = async (gopts)=>{"), body=shotsUi.slice(at,shotsUi.indexOf("const guardedGenerate = async (gopts)=>{",at));
  assert.ok(body.includes('if(!(g.editInstruction || g.simple) && typeof window.shotPrevisTakeNext==="function" && window.shotPrevisTakeNext(sh.id)){'));
  assert.ok(body.includes('try{ pv = await window.shotPrevisForFrame(sh, ctx, "start", null, 0, sceneShots); }')&&body.includes('g = { ...g, previs:pv, baseMaxDim:1536 };'));
  assert.ok(body.includes('"The previs could not be drawn. No frame was made."')&&body.includes('"This shot has no previs to make a frame from. No frame was made."'),"asked for a frame from the previs, never another kind");
  assert.ok(shotsUi.includes("if(gopts && gopts.previs && gopts.previs.url && !gopts.editInstruction) return gopts.previs.url;"),"the drawing is Image 1");
  assert.ok(shotsUi.includes('return buildShotPrompt({ ...sh, composition:"", cameraPosition:"", ...(lensMm>0 ? { lens:String(Math.round(lensMm)) } : {}),')&&shotsUi.includes("},{...base,previs:gopts.previs});"),
    "the drawing is the composition: the plan's own line on it and its lens do not ride along");
  assert.ok(shotsUi.includes('const sw = (seedU && typeof window.shotLookSwatches==="function") ? await window.shotLookSwatches(seedU) : "";')
    &&shotsUi.includes('if(sw) return ranked.concat([{ url:sw, kind:"frame", refId:prevShot.id, maxDim:960, ephemeral:true, persist:false,'),"the frame before it rides last as shuffled swatches: its look, never its layout");
  assert.ok(!/ranked\.concat\(\[\{ url:seedU/.test(shotsUi),"never the whole frame");
  assert.ok(shotsUi.includes("it is not a picture of the scene: take no layout, no camera, no position and no object from it"));
  // the shuffle: twelve pieces, every one moved, every one used once
  { const b3={console,Date,Map,Promise,Object,Array,JSON,Math,Number,String,setTimeout,React:{createElement:()=>null},Icon:{}}; b3.window=b3; b3.globalThis=b3; vm.createContext(b3); vm.runInContext(ui,b3);
    const order=plain(b3.SHOT_SWATCH_ORDER); assert.equal(order.length,12); assert.deepEqual(order.slice().sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8,9,10,11]); assert.ok(order.every((to,from)=>to!==from),"no piece stays in its place");
    assert.ok(ui.includes('if(from%2){ g.translate(dx+tw, dy); g.scale(-1,1);'),"every other piece is mirrored"); }
  assert.ok(shotsUi.includes("_previsUsed = (pv && pv.pose) ? { which:pv.which||\"start\", pose:pv.pose, source:pv.source||\"\" } : null; }")&&shotsUi.includes("...(_previsUsed ? { previs:_previsUsed } : {})"),"the camera it was drawn through is kept with the frame");
  assert.ok(art.includes("else if(refImage && Number(gopts.baseMaxDim)>0) genOpts.baseMaxDim = Math.min(1536, Number(gopts.baseMaxDim));"));
  // the mark for the next Generate: taken once, and not after ten minutes
  const b2={console,Date,Map,Promise,Object,Array,JSON,Math,Number,String,React:{createElement:()=>null},Icon:{}};
  b2.window=b2; b2.globalThis=b2; vm.createContext(b2); vm.runInContext(ui,b2,{filename:"app/shot-previs-ui.jsx"});
  assert.equal(b2.shotPrevisTakeNext("a"),false);
  b2.shotPrevisAskNext("a"); assert.equal(b2.shotPrevisTakeNext("a"),true); assert.equal(b2.shotPrevisTakeNext("a"),false,"once");
  b2.shotPrevisAskNext("b"); b2.__shotPrevisNext.b=Date.now()-11*60000; assert.equal(b2.shotPrevisTakeNext("b"),false,"a mark left by a run that was cancelled does not turn a later Generate into this one");
});
test("14b. a shot with no plan, no marks or no floor plan has no previs to give",async()=>{
  const b2={console,Date,Map,Promise,Object,Array,JSON,Math,Number,String,React:{createElement:()=>null},Icon:{}};
  b2.window=b2; b2.globalThis=b2; vm.createContext(b2); vm.runInContext(ui,b2,{filename:"app/shot-previs-ui.jsx"});
  assert.equal(await b2.shotPrevisForFrame({id:"x",planned:false},{},"start"),null);
  assert.equal(await b2.shotPrevisForFrame(null,{},"start"),null);
  assert.equal(await b2.shotLookSwatches(""),"","no picture, no swatches");
  assert.equal(await b2.shotLookSwatches("data:x"),"","where nothing can be drawn (no browser), nothing is sent");
});

test("15. the QA check of a frame made from its previs reads it beside the drawing: added, removed, moved, wrong size",()=>{
  assert.ok(shotsUi.includes('layout:(gen.genMeta && gen.genMeta.previs && gen.genMeta.previs.pose && typeof window.shotPrevisForFrame==="function")')
    &&shotsUi.includes('? ()=>window.shotPrevisForFrame(sh, ctx, gen.genMeta.previs.which||"start", gen.genMeta.previs.pose, 896, sceneShots) : null,'),"only a frame made from one, through the camera it was made with");
  assert.ok(art.includes('let lay = null; if(typeof layout==="function"){ try{ lay = await layout(); }catch(e){ lay = null; } }')
    &&art.includes("...((lay && lay.url) ? { layout:{ url:lay.url, legend:Array.isArray(lay.legend) ? lay.legend : [] } } : {}),"));
  const at=ai.indexOf("async function aiImageQA(item){"), body=ai.slice(at,ai.indexOf("\n}\n",at));
  assert.ok(body.includes("const res = await aiVisionComplete([{ role:\"user\", content:prompt }], lay ? [img, lay] : [img]);"),"the drawing is the second image");
  for(const t of ["THE LAYOUT (binding, part of the contract): the SECOND attached image is the 3D previs this frame was made from",
    "one the layout does not have was ADDED; one it has that is gone was REMOVED","a shut door drawn open, or an open one drawn shut, is wrong",
    "a person with no figure was ADDED, a figure with no person is MISSING","about the same size in the frame as the shape: the shape is that object built at its true size",
    "Each difference is a deviation whose 'what' starts with 'Layout:'","What the layout cannot show is never a fault: faces, clothes, materials, texture, light","Never box the layout image."])
    assert.ok(body.includes(t),t);
  assert.ok(body.includes("...(lay ? { layoutRead:true } : {}),"));
});

test("16. an end frame is guided by the drawing of how its shot ends, when the shot's frame was made from its previs",()=>{
  const comp=shotsUi.slice(shotsUi.indexOf("function ShotEndFrame("),shotsUi.indexOf('const CONF_LABELS = ["Inner","Personal","Extra-personal"];'));
  assert.ok(comp.includes('const pv = await window.shotPrevisForFrame(sh, ctx, "end", pm.previs.pose, 1280, sceneShots);'),"through the same camera");
  assert.ok(comp.includes("if(pv && pv.moves) return { ...base, endPrevis:pv, editRefImages:[pv.url] }; }catch(e){}"),"a shot that ends as it starts is left to the words");
  assert.ok(comp.includes("if(pm && pm.previs && pm.previs.pose && typeof window.shotPrevisForFrame===\"function\"){"));
  assert.ok(shotsUi.includes('if(mode==="edit") return opts.buildEdit ? opts.buildEdit(gopts&&gopts.editInstruction||"",refs,runModel,gopts) : "";'));
  for(const t of ['out += "\\n\\nImage "+n+" is a 3D LAYOUT of this SAME shot as it ENDS, drawn to scale through the same camera:',
    "const n = (Array.isArray(resolvedRefs) ? resolvedRefs.length : 0)+2;","Take ONLY positions from it: never its drawn surfaces, its plain jointed figures or its boxes."])
    assert.ok(shotsUi.includes(t),t);
});

/* ================= THE BEAT, STAGED ONCE (2026-11-23) ================= */
test("17. a beat staged once is one room that goes on: a shot starts exactly where the one before it ended",()=>{
  const shots=[
    {id:"a",planSet:"set1",startState:{people:{ann:{where:"m-a",holding:["mug"]}},things:{mug:{heldBy:"ann"}},doors:[{id:"front-door",open:false}]},
      endState:{people:{ann:{where:"m-a",holding:[]}},things:{mug:{at:"table"}},doors:[{id:"front-door",open:true}]},handoff:{type:"cut"}},
    // the plan wrote Ann somewhere else for this start, and forgot the mug and the door: the room remembers
    {id:"b",planSet:"set1",startState:{people:{bob:{where:"m-b",holding:[]},ann:{where:"m-c",holding:["mug"]}},things:{},doors:[]},
      endState:{people:{bob:{where:"m-c",holding:["mug"]}},things:{mug:{heldBy:"bob"}}},handoff:{type:"time-cut"}},
    {id:"c",planSet:"set1",startState:{people:{ann:{where:"m-b",holding:[]}}},endState:{people:{ann:{where:"m-b",holding:[]}}},handoff:{type:"cut"}},
    {id:"d",planSet:"set2",startState:{people:{cy:{where:"m-c",holding:[]}}},endState:{people:{cy:{where:"m-c",holding:[]}}},handoff:{type:"cut"}}];
  const before=JSON.stringify(shots), st=plain(V.beatStates(shots));
  assert.equal(JSON.stringify(shots),before,"the shots are never changed");
  assert.deepEqual(st.map(x=>[x.id,x.joins,x.cut]),[["a",false,""],["b",true,""],["c",false,"time-cut"],["d",false,"set"]]);
  assert.deepEqual(st[1].start,{people:{ann:{where:"m-a",holding:[]},bob:{where:"m-b",holding:[]}},things:{mug:{at:"table"}},doors:[{id:"front-door",open:true}]},
    "Ann is where shot a left her, the mug is on the table, the door is open; Bob comes in as the plan says");
  assert.deepEqual(st[1].differs,["ann"],"and it says the plan wrote another start for her");
  assert.deepEqual(st[1].end.people,{ann:{where:"m-a",holding:[]},bob:{where:"m-c",holding:["mug"]}});
  assert.deepEqual(st[1].end.things,{mug:{heldBy:"bob"}});
  // time has passed: the plan's start is the new truth for whom it names; the others stay
  assert.deepEqual(st[2].start.people,{ann:{where:"m-b",holding:[]},bob:{where:"m-c",holding:["mug"]}}); assert.deepEqual(st[2].differs,[]);
  // another place: nobody is carried over
  assert.deepEqual(st[3].start,{people:{cy:{where:"m-c",holding:[]}},things:{},doors:[]});
  assert.deepEqual(plain(V.beatStates([])),[]);
  // someone who puts a thing down unseen no longer holds it
  const put=plain(V.beatStates([{id:"x",startState:{people:{ann:{where:"m-a",holding:["mug"]}}},endState:{people:{ann:{where:"m-a",holding:[]}}}}]));
  assert.deepEqual(put[0].end,{people:{ann:{where:"m-a",holding:[]}},things:{},doors:[]});
});
test("17b. a middle picture only when someone crosses the room; a person may stand between two marks",()=>{
  const mid=plain(V.midState({people:{bob:{where:"m-b",holding:["mug"]},ann:{where:"m-a",holding:[]}}},{people:{bob:{where:"m-c",holding:[]},ann:{where:"m-a",holding:[]}},things:{mug:{at:"table"}}},PLAN));
  assert.deepEqual(mid.people.bob,{where:"m-c",holding:["mug"],xy:[1.85,1.25],pose:"walking"},"halfway, still carrying what he had");
  assert.deepEqual(mid.people.ann,{where:"m-a",holding:[]}); assert.deepEqual(mid.things,{mug:{heldBy:"bob"}});
  assert.equal(V.midState({people:{ann:{where:"m-a"}}},{people:{ann:{where:"m-a"}}},PLAN),null,"nobody moves: start and end say it all");
  assert.equal(V.midState({people:{ann:{where:"m-a"}}},{people:{ann:{where:"m-b"}}},{marks:[{id:"m-a",xy:[2,1]},{id:"m-b",xy:[2.6,1]}]}),null,"a step aside is no crossing");
  const drawn=V.stateScene(SET(),PLAN,mid,CTX);
  assert.deepEqual(plain(drawn.people.find(p=>p.id==="bob").xy),[1.85,1.25]);
});
test("17c. the beat strip: above each beat's cards, every planned shot of the beat, drawn from the one staged beat",()=>{
  assert.ok(shotsUi.includes('window.BeatStrip && _el(window.BeatStrip,{key:"strip"+L.n,scene,beatN:L.n,shots:L.shots,sceneShots:ordered,ctx,onView,readOnly}),'));
  // (the earlier layout, kept for when the beat-first cards are not loaded: the strip is a row above the beat's cards)
  assert.ok(shotsUi.indexOf("window.BeatStrip && _el(")<shotsUi.lastIndexOf("_el(OpeningBeatCard,{L:Lopen"),"before the beat's own cards");
  for(const t of ['className:"sheet-card beat-strip"+(open?" open":"")','"Beat "+beatN+" in code"','list.length+" shot"+(list.length!==1?"s":"")+", start to end"',
    "window.ShotPrevis.beat(plan, list, { list:ctx.locations||[], cast, props, width:640, states:staged,",'pic(r.start, r.end ? "Starts" : "Starts and ends"','r.mid && pic(r.mid, "Midway"','r.end && pic(r.end, "Ends"',
    'r.joins ? "\\u2192" : r.cut==="set" ? "new place" : "time passes"',"This shot starts at the instant the one before it ends: everyone and everything is where that shot left them.",
    '"The plan wrote another start for "+r.differs.join(" and ")+"; the strip keeps them where the shot before left them."','"Go to this shot\\u2019s card"',"It costs nothing and changes nothing."])
    assert.ok(ui.includes(t),t);
  assert.ok(ui.includes("if(!plan || !SP.exact(plan)) return null;")&&ui.includes("if(!list.length) return null;"),"only a planned beat of a plan with marks");
  const at=src.indexOf("async function beat(plan,shots,o){"), body=src.slice(at,src.indexOf("// one drawn frame of a planned shot",at));
  assert.ok(body.includes("const own=o.states?null:beatStates(shots), states=arr(shots).map((sh,i)=>own?own[i]:(obj(o.states)[sh.id]||beatStates([sh])[0])), out=[];")&&body.includes('startState:st.start,endState:st.end,midState:mid,look:o.look,steps:typeof o.stepsOf==="function"?o.stepsOf(sh,st):null});'));
  assert.ok(body.includes('}catch(e){ row.error=String((e&&e.message)||"This shot could not be drawn."); }'),"one shot that cannot be drawn does not stop the others");
  const fa=ai.indexOf('APP_FEATURES.push({ name:"Shots: the beat in code (the beat strip)"'); assert.ok(fa>0,"Frances is told");
  const fact=ai.slice(fa,ai.indexOf("\n",fa));
  for(const t of ["Beat N in code","staged once","one room that goes on","time passes","which colour is which person","MAKE FRAME","MAKE THIS BEAT'S FRAMES","made from the strip or another way"]) assert.ok(fact.includes(t),t);
  assert.ok(!/credit|\$|claude|anthropic|fable|opus|gemini|gpt|TURN|MUSE/i.test(fact.replace(/APP_FEATURES/,"")));
  for(const c of [".beat-strip{grid-column:1/-1;",".beat-strip-row{display:flex;align-items:flex-start;gap:8px;overflow-x:auto;",".beat-strip-join.cut{"]) assert.ok(css.includes(c),c);
});

/* ================= FRAMES MADE FROM THE STRIP (2026-11-23) ================= */
const uiBox=()=>{ const b={console,Date,Map,Set,Promise,Object,Array,JSON,Math,Number,String,setTimeout,clearTimeout,setInterval,clearInterval,React:{createElement:()=>null},Icon:{}};
  b.window=b; b.globalThis=b; vm.createContext(b); vm.runInContext(read("app/scene-plan.js"),b); vm.runInContext(src,b); vm.runInContext(ui,b,{filename:"app/shot-previs-ui.jsx"}); return b; };
test("18. the whole scene is staged once: a beat's first shot starts where the beat before it ended, unless time has passed",()=>{
  const b=uiBox();
  const mk=(id,beatN,n,mode,start,end,handoff)=>({id,sceneId:"s",beatN,keyframeMode:mode,moment:{n,of:2},planned:true,planSet:"set1",startState:start,endState:end,handoff:{type:handoff||"cut"}});
  const shots=[
    mk("b2",2,1,"beat-opening",{people:{bob:{where:"m-b",holding:[]}}},{people:{bob:{where:"m-b",holding:[]}}}),
    mk("a2",1,2,"moment",{people:{ann:{where:"m-a",holding:[]}}},{people:{ann:{where:"m-c",holding:[]}}}),
    mk("a1",1,1,"beat-opening",{people:{ann:{where:"m-a",holding:[]}}},{people:{ann:{where:"m-a",holding:[]}}}),
    {id:"loose",sceneId:"s",beatN:1,planned:false,startState:{people:{}}}];
  const st=plain(b.shotPrevisStaged(shots));
  assert.deepEqual(Object.keys(st),["a1","a2","b2"],"in story order: beat, then moment; only planned key shots");
  assert.deepEqual(st.b2.start.people,{ann:{where:"m-c",holding:[]},bob:{where:"m-b",holding:[]}},"beat 2 opens with Ann where beat 1 left her");
  assert.equal(st.b2.joins,true);
  const cut=plain(b.shotPrevisStaged(shots.map(x=>x.id==="a2"?{...x,handoff:{type:"time-cut"}}:x)));
  assert.equal(cut.b2.joins,false); assert.equal(cut.b2.cut,"time-cut");
  assert.deepEqual(plain(b.shotPrevisStaged([])),{});
  // one staging for everything that reads a shot's previs
  for(const t of ["const st = shotPrevisStaged(sceneShots||[sh], plan)[sh.id] || null;","...(st ? { startState:st.start, endState:st.end } : {}) });","const staged = open ? shotPrevisStaged(sceneShots||shots, plan) : {};"]) assert.ok(ui.includes(t),t);
});
test("18b. a frame is made by its own card: the strip finds the card's own press by the shot's id",()=>{
  assert.ok(shotsUi.includes("window.__shotPrevisMake[sh.id] = makeFromPrevis;")&&shotsUi.includes("window.__shotPrevisMake[end.id] = press;"),"the shot's frame and the beat's end frame");
  assert.ok(shotsUi.includes("return ()=>{ if(window.__shotPrevisMake && window.__shotPrevisMake[sh.id]===makeFromPrevis) delete window.__shotPrevisMake[sh.id]; };"),"gone with its card");
  const b=uiBox();
  assert.equal(b.shotPrevisMaker("x"),null);
  let pressed=0; b.__shotPrevisMake={x:()=>{ pressed++; }}; b.shotPrevisMaker("x")(); assert.equal(pressed,1);
  for(const t of ['"data-testid":"beat-strip-make"','img(sh.id)?"Make again":"Make frame"','"data-testid":"beat-strip-make-end"','disabled:anyBusy || !img(sh.id),',
    '"Frame \\u00b7 from the strip" : "Frame \\u00b7 made another way"','"End frame \\u00b7 from the strip"','"data-testid":"beat-strip-make-all"','"Make this beat\\u2019s frames"',
    'title:"Make beat "+beatN+"\\u2019s "+n+" frame"+(n!==1?"s":"")+" from the strip?"','" A frame that is there now is kept as an earlier version. Nothing is approved."'])
    assert.ok(ui.includes(t),t);
  assert.ok(ui.indexOf("window.appConfirm({")<ui.indexOf("const made = await shotPrevisMakeBeat(list, endOwnerId, setRun);"),"the beat's run asks before it starts");
});
test("18c. a beat's frames are made in order, one at a time, then its end frame; a frame that never starts ends the run",async()=>{
  const b=uiBox();
  // a card that makes its frame at once: busy for a moment, then a new image
  const metas={}, order=[];
  b.nbGetMeta=id=>metas[id]||null; b.__nbGenInflight={};
  const card=id=>()=>{ order.push(id); b.__nbGenInflight[id]=true; setTimeout(()=>{ metas[id]={iso:"t"+order.length}; delete b.__nbGenInflight[id]; },700); };
  b.__shotPrevisMake={s1:card("s1"),s2:card("s2"),"s2-end":card("s2-end")};
  const list=[{id:"s1",moment:{n:1}},{id:"s2",moment:{n:2}}], steps=[];
  const made=await b.shotPrevisMakeBeat(list,"s2",t=>steps.push(t));
  assert.equal(made,3); assert.deepEqual(order,["s1","s2","s2-end"]);
  assert.deepEqual(steps,["Making moment 1 (1 of 2)…","Making moment 2 (2 of 2)…","Making the end frame…"]);
  // a card that is not there: nothing is pressed after it
  const b2=uiBox(); b2.nbGetMeta=()=>null; b2.__nbGenInflight={}; let later=0; b2.__shotPrevisMake={s2:()=>{ later++; }};
  assert.equal(await b2.shotPrevisMakeBeat(list,"",()=>{}),0); assert.equal(later,0);
});

/* ---- 19. a camera set by hand (owner 2026-11-24, the Previs look brief, step 5): "a camera set by hand keeps its
   own direction and is never moved. Every check still runs and its notes are shown" ---- */
test("19. a camera set by hand stands and looks exactly as it was chosen; the checks speak and move nothing",()=>{
  const st=placed(), clear=clearOf(st.base);
  const mine=(position,yaw,pitch,lensMm)=>SP.handCamera({position,yaw,pitch,lensMm},{floorZ:0,from:{locationId:"loc",locationName:"Kitchen",angleId:"a1",angleName:"From the window"}});
  const good=V.planCamera(mine([2.6,2.6,1.5],180,-8,35),SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(good.source,"hand"); assert.equal(good.fits,true); assert.deepEqual(plain(good.notes),[]);
  assert.deepEqual(plain(good.pose),{position:[2.6,2.6,1.5],yaw:180,pitch:-8,lensMm:35},"its own place, direction and lens: not aimed again");
  assert.deepEqual(plain(good.from),{locationId:"loc",locationName:"Kitchen",angleId:"a1",angleName:"From the window"});
  // the same spots a planned camera is moved from (7b): a hand-set one stays, and says why it is a problem
  const inWall=V.planCamera(mine([1,1.5,1.5],90,0,35),{...SHOT,subjects:["ann"]},st,st.base,PLAN,SPACES,{clear});
  assert.deepEqual(plain(inWall.pose.position),[1,1.5,1.5]); assert.equal(inWall.source,"hand");
  assert.equal(inWall.notes[0],"Your angle stands inside a wall or a piece of furniture.");
  const off=V.planCamera(mine([2.6,3.4,1.5],180,-8,35),SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.deepEqual(plain(off.pose.position),[2.6,3.4,1.5]); assert.equal(off.notes[0],"Your angle stands off this place\u2019s floor plan.");
  const onAnn=V.planCamera(mine([2,1.15,1.5],180,0,35),SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.deepEqual(plain(onAnn.pose.position),[2,1.15,1.5]); assert.equal(onAnn.notes[0],"Your angle stands where a person stands as this shot starts.");
  // looking the other way: the people the shot frames are not in the picture, and the card says so
  const away=V.planCamera(mine([2.6,2.6,1.5],0,0,35),SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(away.pose.yaw,0); assert.ok(away.notes.some(n=>/ and .* are outside the picture from your angle as this shot starts\.$/.test(n)),"said, not corrected");
  // something in the set in the way: said
  const blind=V.planCamera(mine([2.6,2.6,1.5],180,-8,35),SHOT,st,st.base,PLAN,SPACES,{clear:()=>false});
  assert.deepEqual(plain(blind.pose.position),[2.6,2.6,1.5]); assert.ok(blind.notes.includes("From your angle something in the set hides someone this shot frames."));
  // a very wide lens: the size note, the lens untouched; a very long one cuts both people out, and that is what is said
  const wide=V.planCamera(mine([2.6,2.9,1.5],180,-4,14),SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(wide.pose.lensMm,14); assert.ok(wide.notes.some(n=>/^From \d\.\d m your 14 mm lens shows more than the .* this shot was planned as\.$/.test(n)),"a planned camera would have had its lens changed");
  const tight=V.planCamera(mine([2.6,2.9,1.5],180,-4,120),SHOT,st,st.base,PLAN,SPACES,{clear});
  assert.equal(tight.pose.lensMm,120); assert.ok(tight.notes.some(n=>/are outside the picture from your angle/.test(n)));
  // what is in the picture: in front, inside the angle of the lens
  assert.equal(V.inFrame({position:[0,0,1.5],yaw:0,pitch:0,lensMm:35},[0,3,1.5]),true); assert.equal(V.inFrame({position:[0,0,1.5],yaw:0,pitch:0,lensMm:35},[0,-3,1.5]),false,"behind the camera");
  assert.equal(V.inFrame({position:[0,0,1.5],yaw:90,pitch:0,lensMm:35},[3,0,1.5]),true,"90 is east"); assert.equal(V.inFrame({position:[0,0,1.5],yaw:0,pitch:0,lensMm:100},[2,3,1.5]),false,"outside a long lens");
  // marked by hand but with no pose (damaged): read as an ordinary planned camera
  assert.equal(V.planCamera({hand:true,at:[2.6,2.6],height:1.5,aim:["ann","bob"],lens:35},SHOT,st,st.base,PLAN,SPACES,{clear}).source,"plan");
});

await Promise.all(pending);
console.log("\n"+pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

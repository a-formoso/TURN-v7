/* A WALL INSIDE A ROOM, AND FREE FIXES ON A DRAFT (owner 2026-11-17, "help me fix selected element"). Hussain Flat's
   drafted floor plan drew the hall and the kitchen as one outline with the doorway between them, and the review
   stopped at "Check the dimensions and wall placement of Hall to kitchen open doorway" with nothing to press.
   Now an opening that stands inside its room's outline stands in a wall of its own: straight across the room through
   the opening, square to the way it faces. The check accepts it, the map and the 3D set draw it, cameras treat it as
   a wall, the measurement repair leaves it where it is, and a draft that still needs measurements offers the free
   fixes where it says so. No model, account or render call here. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(e){failed++;console.log("FAIL "+name+"\n    "+String(e&&e.stack||e).split("\n").join("\n    "));}}
const copy=v=>JSON.parse(JSON.stringify(v));

const box={console,crypto,TextEncoder,URL,location:{hostname:"localhost"},turnIsAdmin:true,TURN_SUPABASE:{setBuild:true},
  nbGetMeta:()=>null,nbGetImage:()=>"",nbEpoch:()=>1,scenesInStoryOrder:x=>x||[]};
box.window=box;vm.createContext(box);
for(const f of ["locations.jsx","blender-render-contract.js","blender-set-detail.js","blender-render.js","location-measurement-repair.js"])
  vm.runInContext(read("app/"+f),box,{filename:"app/"+f});

// The draft as it came for Hussain Flat: one L-shaped outline (hall 1 m wide, kitchen 3 x 3.6 m east of it).
const OUTLINE=[[-0.5,0],[3.5,0],[3.5,3.6],[0.5,3.6],[0.5,6],[-0.5,6]];
const DOORWAY={id:"kitchen-doorway",name:"Hall to kitchen open doorway",kind:"arch",edge:5,centre:[0.5,1.4],width:0.8,sillZ:0,headZ:2,yaw:270,connectsTo:"flat"};
function flat(change){
  const space={id:"flat",name:"Hussain Flat",footprint:copy(OUTLINE),floorZ:0,ceilingH:2.5,openings:[
    {id:"hall-front-door",name:"Front door, frosted panel",kind:"door",edge:0,centre:[0,0],width:0.8,sillZ:0,headZ:2.1,yaw:180},
    {id:"kitchen-window",name:"Kitchen sash window",kind:"window",edge:0,centre:[2.6,0],width:1,sillZ:0.8,headZ:2.2,yaw:180},
    copy(DOORWAY),
    {id:"bedroom-passage",name:"Hall end to bedrooms",kind:"arch",edge:4,centre:[0,6],width:0.8,sillZ:0,headZ:2,yaw:0}]};
  const l={id:"flat",key:"flat",name:"Hussain Flat",spatialPlan:{status:"reviewed",source:{assetId:"flat",iso:""},heights:"centre",
    frame:"Standing inside the street door, facing down the hall",anchors:[
      {id:"kitchen-doorway",space:"Hussain Flat",name:"Open doorway hall to kitchen-diner (worn frame)",placement:"East hall wall",xy:[0.5,1.4],facing:90,size:[0.8,0.1,2]},
      {id:"kitchen-table",space:"Hussain Flat",name:"Small kitchen table",placement:"By the window",xy:[2.1,1.2],z:0.375,facing:0,size:[0.7,1.1,0.75]},
      {id:"kitchen-fridge",space:"Hussain Flat",name:"Fridge",placement:"Northeast corner",xy:[3.1,3.2],z:0.85,facing:270,size:[0.6,0.6,1.7]}],
    coordinates:{spaces:[space]}}};
  if(change)change(l,space);
  box.turnContinuity={locations:[l]};
  return l;
}
const spaceOf=l=>box.normalizeLocationSpatialPlan(l.spatialPlan).coordinates.spaces[0];
const step2=l=>box.KinolotCloudRender.inputIssueList(l).filter(i=>i.step===2).map(i=>i.text);
const hold={position:[2,2,1.5],yaw:0,pitch:0,lensMm:24},HOLD={cameras:{TL:hold,TR:hold,BL:hold,BR:hold}};

test("1 a doorway inside the outline stands in a wall of its own, straight across the room",()=>{
  const sp=spaceOf(flat()),w=box.locationInnerWall(sp,sp.openings[2]);
  assert.deepEqual(copy(w.a),[0.5,0]);assert.deepEqual(copy(w.b),[0.5,3.6]);
  assert.equal(w.length,3.6);assert.equal(w.at,1.4);
  // the wall stops where the outline's own wall begins (the corner at 0.5, 3.6), not at the far end of the hall
  assert.ok(w.b[1]<3.7);
});

test("2 an opening on the outline, outside it, or in an open-air space has no wall of its own",()=>{
  const sp=spaceOf(flat());
  assert.equal(box.locationInnerWall(sp,sp.openings[0]),null,"the front door is on the south wall");
  assert.equal(box.locationInnerWall(sp,sp.openings[3]),null,"the passage is on the north wall");
  assert.equal(box.locationInnerWall(sp,{...DOORWAY,centre:[-0.3,1.4]}),null,"20 cm from the hall's west wall is that wall's");
  assert.equal(box.locationInnerWall(sp,{...DOORWAY,centre:[5,1.4]}),null,"outside the outline is a mistyped position, not an inner wall");
  assert.equal(box.locationInnerWall({...sp,openSky:true},DOORWAY),null,"a yard has no walls to build");
  assert.equal(box.locationInnerWall(sp,{...DOORWAY,centre:null}),null);
});

test("3 the wall runs square to the way the doorway faces",()=>{
  const room={id:"r",name:"Room",footprint:[[0,0],[6,0],[6,4],[0,4]],floorZ:0,ceilingH:2.6,openings:[]};
  const east=box.locationInnerWall(room,{centre:[3,2],yaw:90,width:0.9,kind:"door"});
  assert.deepEqual([copy(east.a),copy(east.b)].sort(),[[3,0],[3,4]]);
  const north=box.locationInnerWall(room,{centre:[3,2],yaw:0,width:0.9,kind:"door"});
  assert.deepEqual([copy(north.a),copy(north.b)].sort(),[[0,2],[6,2]]);
  // facing the other way is the same wall
  const west=box.locationInnerWall(room,{centre:[3,2],yaw:270,width:0.9,kind:"door"});
  assert.deepEqual([copy(west.a),copy(west.b)].sort(),[[3,0],[3,4]]);
  // with no facing saved, it follows the nearest wall of the outline
  const none=box.locationInnerWall(room,{centre:[3,1],yaw:null,width:0.9,kind:"door"});
  assert.deepEqual([copy(none.a),copy(none.b)].sort(),[[0,1],[6,1]]);
});

test("4 two doorways on one line share their wall; doors and arches are left open, a window is not",()=>{
  const room={id:"r",name:"Room",footprint:[[0,0],[6,0],[6,4],[0,4]],floorZ:0,ceilingH:2.6,openings:[
    {id:"a",name:"Door A",kind:"door",centre:[3,1],yaw:90,width:0.8,sillZ:0,headZ:2},
    {id:"b",name:"Hatch window",kind:"window",centre:[3,3],yaw:270,width:0.6,sillZ:1,headZ:1.6}]};
  const walls=box.locationInnerWalls(room);
  assert.equal(walls.length,1);assert.equal(walls[0].openings.length,2);
  const solids=box.locationInnerWallSolids(room);
  assert.equal(solids.length,2,"the wall is open at the door only");
  const gap=solids.map(s=>[s[0][1],s[1][1]].map(n=>Math.round(n*100)/100).sort((p,q)=>p-q));
  assert.ok(gap.some(g=>g[1]===0.6)&&gap.some(g=>g[0]===1.4),JSON.stringify(gap));
});

test("5 the floor plan check accepts it, and still names a real measurement problem",()=>{
  assert.deepEqual(copy(step2(flat())),[]);
  // the doorway wider than the wall it stands in
  assert.ok(step2(flat((l,sp)=>{sp.openings[2].width=3.2;})).some(t=>/Check the dimensions and wall placement of Hall to kitchen open doorway/.test(t)));
  // its top above the ceiling is still said
  assert.ok(step2(flat((l,sp)=>{sp.openings[2].headZ=3;})).some(t=>/above the ceiling/.test(t)));
  // an opening away from its wall, outside the room, is still a problem
  assert.ok(step2(flat((l,sp)=>{sp.openings[1].centre=[2.6,-0.8];})).some(t=>/Check the dimensions and wall placement of Kitchen sash window/.test(t)));
});

test("6 the 3D set builds the wall floor to ceiling with the doorway cut in it, and leaves the outline's walls whole",()=>{
  const l=flat(),scene=box.KinolotCloudRender.buildScene(l,undefined,undefined,HOLD);
  box.KinolotRenderContract.validateScene(scene);
  const inner=scene.objects.filter(o=>/^wall-0-in0-/.test(o.id));
  assert.equal(inner.length,3,"south of the doorway, above it, north of it");
  inner.forEach(o=>assert.equal(Math.round(o.position[0]*100)/100,0.5));
  // nothing solid in the doorway below its head
  const inGap=o=>Math.abs(o.position[1]-1.4)<0.4&&o.position[2]-o.size[2]/2<2-0.001;
  assert.ok(!inner.some(inGap));
  assert.ok(inner.some(o=>Math.abs(o.position[1]-1.4)<0.01&&Math.abs(o.size[2]-0.5)<0.001),"the piece above the doorway, 2 m to 2.5 m");
  const total=inner.filter(o=>o.size[2]>2.4).reduce((n,o)=>n+o.size[0],0);
  assert.ok(Math.abs(total-2.8)<0.001,"1 m south of the doorway and 1.8 m north of it");
  // the hall's west wall (edge 5, the nearest outline wall) is one whole piece: no hole was cut in it
  const west=scene.objects.filter(o=>/^wall-0-5-/.test(o.id));
  assert.equal(west.length,1);assert.ok(Math.abs(west[0].size[0]-6)<0.001);
  // a room with no inner doorway builds exactly as before
  const plain=flat((l,sp)=>{sp.openings.splice(2,1);l.spatialPlan.anchors.shift();});
  const before=box.KinolotCloudRender.buildScene(plain,undefined,undefined,HOLD);
  assert.ok(!before.objects.some(o=>/-in\d+-/.test(o.id)));
  assert.deepEqual(scene.objects.filter(o=>/^wall-0-\d+-/.test(o.id)).map(o=>o.id),before.objects.filter(o=>/^wall-/.test(o.id)).map(o=>o.id),"the outline's wall pieces keep their names");
});

test("7 cameras treat it as a wall: none stands in it, the doorway itself is clear",()=>{
  const l=flat();
  const problems=box.KinolotCloudRender.cameraProblems(l,undefined,[
    {key:"TL",pose:{position:[0.6,2.6,1.5]}},    // 10 cm from the wall, north of the doorway
    {key:"TR",pose:{position:[0.5,1.4,1.5]}},    // standing in the doorway
    {key:"BL",pose:{position:[2,2,1.5]}},        // the middle of the kitchen
    {key:"BR",pose:{position:[0,3,1.5]}}]);      // the hall
  assert.match(problems.TL||"",/within 25 cm of a wall/);
  assert.ok(!problems.TR&&!problems.BL&&!problems.BR,JSON.stringify(problems));
  // the placed cameras keep clear of it
  const proposal=box.KinolotCloudRender.proposeCameras(l);
  assert.equal(proposal.panels.length,4);
  assert.deepEqual(copy(box.KinolotCloudRender.cameraProblems(l,undefined,proposal.panels)),{});
  const solids=box.locationInnerWallSolids(spaceOf(l));
  const dist=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
  proposal.panels.forEach(p=>solids.forEach(s=>assert.ok(dist(p.pose.position,s[0],s[1])>=0.25,p.key)));
});

test("8 the measurement repair leaves the doorway where it is (it used to move it onto the hall's outer wall)",()=>{
  const l=flat(),result=box.KinolotMeasurementRepair.propose(l);
  assert.equal(result.changes.length,0);assert.equal(result.remaining.length,0);
  assert.deepEqual(copy(result.plan.coordinates.spaces[0].openings[2].centre),[0.5,1.4]);
  // a missing width is estimated, and the doorway still stays put
  const narrow=box.KinolotMeasurementRepair.propose(flat((l,sp)=>{delete sp.openings[2].width;}));
  const o=narrow.plan.coordinates.spaces[0].openings[2];
  assert.ok(o.width>0&&o.width<=0.9);assert.deepEqual(copy(o.centre),[0.5,1.4]);
  assert.ok(narrow.changes.some(c=>c.field==="Opening width")&&!narrow.changes.some(c=>c.field==="Opening centre"||c.field==="Wall index"));
  assert.equal(narrow.remaining.length,0);
  // too wide for its own wall: brought inside it
  const wide=box.KinolotMeasurementRepair.propose(flat((l,sp)=>{sp.openings[2].width=3.2;}));
  assert.ok(wide.plan.coordinates.spaces[0].openings[2].width<=2.8);assert.equal(wide.remaining.length,0);
});

test("9 a draft's inner doorway faces the way its object does, and the review names it",()=>{
  // a doorway near the south wall would take that wall's facing (180): its object says it faces east
  const plan=box.normalizeLocationSpatialPlan({status:"draft",frame:"f",heights:"centre",anchors:[
    {id:"inner-door",space:"Room",name:"Pantry doorway",placement:"p",xy:[3,0.6],facing:90,size:[0.8,0.1,2]}],
    coordinates:{spaces:[{id:"r",name:"Room",footprint:[[0,0],[6,0],[6,4],[0,4]],floorZ:0,ceilingH:2.6,openings:[
      {id:"inner-door",name:"Pantry doorway",kind:"arch",centre:[3,0.6],width:0.8,sillZ:0,headZ:2},
      {id:"front",name:"Front door",kind:"door",centre:[1,0],width:0.9,sillZ:0,headZ:2.1}]}]}});
  assert.equal(plan.coordinates.spaces[0].openings[0].yaw,180,"read as the nearest wall's facing");
  const faced=box.locationDraftInnerDoorways(plan);
  assert.equal(faced.plan.coordinates.spaces[0].openings[0].yaw,90);
  assert.equal(faced.plan.coordinates.spaces[0].openings[1].yaw,plan.coordinates.spaces[0].openings[1].yaw,"an opening on the outline is left alone");
  assert.deepEqual(copy(faced.inner),[{spaceId:"r",spaceName:"Room",name:"Pantry doorway"}]);
  const w=box.locationInnerWall(faced.plan.coordinates.spaces[0],faced.plan.coordinates.spaces[0].openings[0]);
  assert.deepEqual([copy(w.a),copy(w.b)].sort(),[[3,0],[3,4]]);
  const text=box.locationInnerDoorwaysText(faced.inner);
  assert.match(text,/^Nothing to fix here\. A wall is drawn inside Room for Pantry doorway, straight across the room through the doorway\./);
  assert.ok(!/error|problem|check it/i.test(text),"it reads as information");
  assert.match(box.locationInnerDoorwaysText([{name:"A"},{name:"B"}]),/^Nothing to fix here\. A wall is drawn inside the room for each of these, straight across the room through the doorway: A, B\./);
  assert.match(text,/Room sizes & openings/);
  assert.equal(box.locationInnerDoorwaysText([]),"");
  // nothing inside: the same plan comes back
  const none=box.normalizeLocationSpatialPlan({...copy(plan),coordinates:{spaces:[{...copy(plan.coordinates.spaces[0]),openings:[copy(plan.coordinates.spaces[0].openings[1])]}]}});
  assert.equal(box.locationDraftInnerDoorways(none).plan,none);
});

test("10 the top-down map draws the wall, open at the doorway",()=>{
  const l=flat(),scene=box.locationFloorPlanScene(l,l.spatialPlan,[l]);
  assert.equal(scene.innerWalls.length,2);
  const ys=scene.innerWalls.map(w=>[w.a[1],w.b[1]].map(n=>Math.round(n*100)/100));
  assert.deepEqual(copy(ys),[[0,1],[1.8,3.6]]);
  scene.innerWalls.forEach(w=>assert.equal(w.spaceId,"flat"));
  const plain=flat((l,sp)=>{sp.openings.splice(2,1);l.spatialPlan.anchors.shift();});
  assert.deepEqual(copy(box.locationFloorPlanScene(plain,plain.spatialPlan,[plain]).innerWalls),[]);
});

const ui=read("app/locations-ui.jsx"),ai=read("app/ai.jsx"),css=read("app/styles.css"),dressing=read("app/set-dressing.js"),html=read("TURN.html");

test("11 a draft that still needs measurements offers the free fixes where it says so",()=>{
  const a=ui.indexOf('"This draft still needs measurements:"'),note=ui.slice(a,a+1100);
  assert.ok(a>0);
  assert.match(note,/"data-testid":"draft-suggest-fixes"/);
  assert.match(note,/onClick:repairDraft\},"Suggest measurement fixes"/);
  assert.match(note,/Free: no credits\./);
  assert.match(note,/Nothing is saved until you confirm\./);
  // only when a window or door measurement is what is missing, never while fixes are already shown, never read-only
  assert.match(note,/!readOnly&&!measurementRepair&&window\.KinolotMeasurementRepair&&draftIssues\.some\(i=>!i\.anchorId\)/);
  const b=ui.indexOf("const repairDraft=()=>{"),fn=ui.slice(b,ui.indexOf("const discardFixes=",b));
  assert.ok(b>0);
  assert.match(fn,/KinolotMeasurementRepair\.propose\(/);
  assert.match(fn,/draftBeforeRepair\.current=shown\.candidate/);
  assert.match(fn,/source:shown\.candidate\.source/);
  assert.ok(!/onUpdate\(/.test(fn),"suggesting saves nothing");
  assert.ok(!/aiDraft|claude\.complete|nbGenerate/.test(fn),"no model call");
  // Discard fixes goes back to the draft as it came
  const c=ui.indexOf("const discardFixes=()=>{"),back=ui.slice(c,c+260);
  assert.match(back,/const back=draftBeforeRepair\.current;draftBeforeRepair\.current=null;\s*setCandidate\(back\|\|null\);setMeasurementRepair\(null\)/);
  assert.match(ui,/onClick:discardFixes\},"Discard fixes"\)/);
  // a draft saved with its fixes is still recorded as a layout proposal
  assert.match(ui,/kind:repair&&!draftBeforeRepair\.current\?"measurement-repair":draft\?"layout-proposal":"floor-plan-edit"/);
});

test("12 the review, the editor and the map say and show the inner wall",()=>{
  assert.match(ui,/className:"loc-map-check info",role:"note","data-testid":"floor-plan-inner-walls"\},innerNote\)/);
  // a plain note, not the alert colours of "Check these positions" (the owner took the red box for an error)
  assert.match(css,/\.loc-map-check\.info\{border-left-color:var\(--line-3\);background:var\(--bg-2\)\}/);
  assert.match(ui,/innerNote=!confirmed&&/);
  assert.match(ui,/inside the room: it stands in a wall of its own/);
  assert.match(ui,/its wall runs square to this, across the room/);
  assert.match(ui,/className:"loc-map-inner-wall"/);
  assert.match(css,/\.loc-map-inner-wall\{[^}]*stroke-width:1\.5/);
});

test("13 the draft and the set dressing are told; Frances knows; the new files are served",()=>{
  assert.match(ai,/keep that space's one footprint and list the doorway in its openings with its centre where it really stands, inside the footprint/);
  assert.match(ai,/plan=locationDraftInnerDoorways\(plan\)\.plan;/);
  assert.match(dressing,/innerWalls:walls\.map\(w=>\(\{from:w\.a,to:w\.b/);
  assert.match(dressing,/A space that lists innerWalls has those walls already built inside its outline/);
  const entry=ai.slice(ai.indexOf('name:"Floor plan: a doorway inside a room, and free fixes on a draft"'));
  assert.ok(entry.length>0&&ai.includes('name:"Floor plan: a doorway inside a room, and free fixes on a draft"'));
  const what=entry.slice(0,entry.indexOf("\n"));
  for(const words of ["it stands in a wall of its own","top-down map","Previs","Room sizes & openings","Nothing to fix here","it is information, not an error","Suggest measurement fixes","Apply fixes & confirm","Discard fixes goes back to the draft as it came","no credits"])
    assert.ok(what.includes(words),"Frances: "+words);
  assert.ok(!/McKee|Claude|Anthropic|\bTURN\b|Blender/.test(what));
  for(const file of ["locations.jsx","locations-ui.jsx","ai.jsx","script.jsx","blender-render.js","location-measurement-repair.js","set-dressing.js","styles.css"])
    assert.ok(["20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1"].some(k=>html.includes(file+'?v='+k+'"')),"cache key: "+file);
});

console.log("\n"+passed+" passed, "+failed+" failed");
if(failed)process.exit(1);

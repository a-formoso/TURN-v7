#!/usr/bin/env node
/* Four different views of a set (owner 2026-11-27).

   The owner sent the four frames of a bakery: its oven wall twice and its window wall twice, a black door on the far
   wall of each. "Some of the frames seem to be capturing the same angle but with different layout or furniture in
   it ... it almost gives me the impression that the set's not being built out properly." The set was right: 13
   objects, none overlapping, every frame true to the plan. The four CAMERAS were the fault. They came with the floor
   plan's draft (two views square at the end walls, then each wall again), one had been refitted onto a view another
   already had, and their notes described other cameras. The owner's word: "yes, go ahead with all five. Or we could
   preserve both coverage options and have user asking for alternative when they are not satisfied with the default
   one (you decide for me which to have as default)".

     A  the fit (camera-coverage.js): two wide views turned across the room from opposite sides; a close-up of
        something a wide view faces comes from another side; what stands under something bigger, or outside the
        room, is never a close-up; `square` gives the other coverage, a wide view from each end
     B  through the app (blender-render.js): a confirmed DRAFT has its cameras fitted afresh, a camera set by hand
        stays; a fitted camera's note says what it is, a hand-written note stays; Try other views goes to the other
        coverage and back
     C  two doors of one set are told apart (set-kit.js)
     D  the card, the keys and what Frances is told
   The real app files against disposable rooms: no network, account, model or saved film.
   node scripts/test-camera-views-apart.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const b={console,crypto,TextEncoder,URL,nbEpoch:()=>1,location:{hostname:"localhost"},turnIsAdmin:true,TURN_SUPABASE:{setBuild:true,setBuildMcp:true},
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ["locations.jsx","blender-render-contract.js","blender-set-kitchen.js","blender-set-detail.js","blender-render.js","camera-angle-preview.js","camera-coverage.js"])
  vm.runInContext(read("app/"+f),b,{filename:f});
const T=await import(new URL("../app/vendor/three/r180/three.module.min.js",import.meta.url));
b.KinolotAnglePreview.load=async()=>T;
const cover=b.KinolotCameraCoverage,preview=b.KinolotAnglePreview,api=b.KinolotCloudRender;
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,6).join("\n    "));}};
const box=(id,position,size,anchorId)=>({id,name:id,position,size,rotation:[0,0,0],material:"grey",kind:"box",...(anchorId?{anchorId}:{})});
const hold={position:[1,1,1.5],yaw:0,pitch:0,lensMm:24};
const apart=(a,b)=>Math.abs(((a-b)%360+540)%360-180);                 // degrees between two facings, 0..180
const offSquare=yaw=>{const m=((yaw%90)+90)%90;return Math.min(m,90-m);};   // degrees from looking square at a wall, 0..45

/* the bakery of the owner's picture, in the room's own corner: 6.5 m by 7 m, the street wall at y = 0 */
const W=6.5,D=7,H=3;
const THINGS=[["bench",[5,1,.45],[2.6,.8,.9]],["bins",[5,1,.3],[2,.6,.6]],["shelf",[6.3,2.6,.9],[.35,1.2,1.8]],
  ["oven",[2,6.5,.95],[1.4,1,1.9]],["racks",[3.7,6.6,.9],[1.4,.6,1.8]],["counter",[.7,1.8,.475],[.6,1.6,.95]]];
function bakeryScene(){
  return {scene:{schema:b.KinolotRenderContract.MCP_SCHEMA,authoring:"mcp-procedural-v1",name:"Bakery",units:"metres",notes:[],
    materials:{grey:{baseColor:[.5,.5,.5],roughness:.8}},previewLights:[],cameras:{TL:hold,TR:hold,BL:hold,BR:hold},
    objects:[box("floor-0",[W/2,D/2,-.075],[W,D,.15]),box("ceiling-0",[W/2,D/2,H+.075],[W,D,.15]),
      box("wall-0-0",[W/2,0,H/2],[W,.15,H]),box("wall-0-1",[W/2,D,H/2],[W,.15,H]),box("wall-0-2",[0,D/2,H/2],[.15,D,H]),box("wall-0-3",[W,D/2,H/2],[.15,D,H]),
      ...THINGS.map(([id,p,s])=>box(id,p,s,id)),
      // a stone step outside the front door: part of the set, not of this room
      box("step",[2,-.6,.1],[1.1,.8,.6],"step")]},
    space:{footprint:[[0,0],[W,0],[W,D],[0,D]],floorZ:0,ceilingH:H}};
}
const SUBJECTS=[{id:"bench",name:"Work bench",weight:3},{id:"bins",name:"Flour sacks",weight:3},{id:"shelf",name:"Shelf of baskets",weight:2},
  {id:"oven",name:"Deck oven",weight:3},{id:"racks",name:"Cooling racks",weight:2},{id:"counter",name:"Service counter",weight:3}];

await test("A1 the two wide views are turned across the room, from opposite sides", ()=>{
  const {scene,space}=bakeryScene(),before=JSON.stringify(scene);
  const p=cover.plan(T,preview,scene,space,{subjects:SUBJECTS}),again=cover.plan(T,preview,scene,space,{subjects:SUBJECTS});
  assert.equal(JSON.stringify(p),JSON.stringify(again),"the same every time");
  assert.equal(JSON.stringify(scene),before,"planning moves nothing");
  assert.equal(p.panels.map(v=>v.role).join(),"wide,reverse,detail,detail");
  const [tl,tr]=p.panels;
  assert.ok(apart(tl.pose.yaw,tr.pose.yaw)>=120,"the reverse looks back from the other side: "+apart(tl.pose.yaw,tr.pose.yaw));
  assert.ok(Math.hypot(tl.pose.position[0]-tr.pose.position[0],tl.pose.position[1]-tr.pose.position[1])>=Math.hypot(W,D)*.45,"and stands most of the room away");
  // neither looks square at an end wall (the mirror pair of the owner's picture: 15 and 209 degrees, each a far wall)
  assert.ok(offSquare(tl.pose.yaw)>=20,"the wide view is turned across the room: "+tl.pose.yaw);
  assert.ok(offSquare(tr.pose.yaw)>=15,"and so is the reverse: "+tr.pose.yaw);
  assert.equal(Object.values(cover.assess(T,preview,scene,space,Object.fromEntries(p.panels.map(v=>[v.key,v.pose])),{subjects:SUBJECTS})).join("|"),"|||","all four are usable pictures");
});

await test("A2 a close-up is of the room's own standing things, and never repeats a wide view", ()=>{
  const {scene,space}=bakeryScene();
  const p=cover.plan(T,preview,scene,space,{subjects:SUBJECTS}),details=p.panels.slice(2),wides=p.panels.slice(0,2);
  assert.equal(details.filter(v=>v.targetId).length,2,"two close-ups, each of a named thing");
  assert.notEqual(details[0].targetId,details[1].targetId);
  // sacks kept under the bench are shown with the bench (no wide view sees them, so they used to win a frame of their own)
  assert.ok(!details.some(v=>v.targetId==="bins"),"what stands under something bigger is never a close-up");
  // the step outside the front door is in the set, not in this room
  assert.ok(!details.some(v=>v.targetId==="step"),"a thing outside the room is never its close-up");
  // a close-up of something a wide view faces is taken from another side
  const s=cover.survey(T,preview,scene,space,{subjects:SUBJECTS});
  try{
    for(const d of details)for(const w of wides){
      const shown=s.clarity(w.pose,s.groups.get(d.targetId)).value>=.3;
      assert.ok(!(shown&&apart(d.pose.yaw,w.pose.yaw)<45),d.label+" does not look the way of the "+w.label+" that already shows it");
    }
    // with no list of the room's own things (a bare call), every object of the set still counts: nothing is ruled out
    assert.equal(s.groups.get("step").detail,false);
    const bare=cover.survey(T,preview,scene,space);
    try{assert.equal(bare.groups.get("step").detail,true);assert.equal(bare.groups.get("bins").detail,false,"still under the bench");}finally{bare.dispose();}
  }finally{s.dispose();}
});

await test("A3 a camera kept as it is counts: the refitted close-up does not repeat it", ()=>{
  // the owner's bakery: three cameras kept, the bottom-left refitted. It came back as the window wall, again.
  const {scene,space}=bakeryScene();
  const keep={TL:{position:[1.4,.5,1.6],yaw:15,pitch:-5,lensMm:20},TR:{position:[5.4,6.2,1.6],yaw:209,pitch:-5,lensMm:20},BR:{position:[2.6,3.8,1.5],yaw:347,pitch:0,lensMm:35}};
  const p=cover.plan(T,preview,scene,space,{subjects:SUBJECTS,keep}),bl=p.panels[2];
  for(const k of ["TL","TR","BR"])assert.equal(JSON.stringify(p.panels.find(v=>v.key===k).pose),JSON.stringify(keep[k]),k+" stays exactly as set");
  assert.equal(bl.role,"detail");
  const s=cover.survey(T,preview,scene,space,{subjects:SUBJECTS});
  try{
    for(const k of ["TL","TR","BR"]){
      const shown=s.clarity(keep[k],s.groups.get(bl.targetId)).value>=.3;
      assert.ok(!(shown&&apart(bl.pose.yaw,keep[k].yaw)<45),"the new close-up ("+bl.label+") is not the kept "+k+" view again");
    }
  }finally{s.dispose();}
});

await test("A4 the other coverage: a wide view from each end of the room", ()=>{
  const {scene,space}=bakeryScene();
  const p=cover.plan(T,preview,scene,space,{subjects:SUBJECTS,square:true}),[tl,tr]=p.panels;
  assert.equal(p.panels.map(v=>v.role).join(),"wide,reverse,detail,detail");
  assert.ok(offSquare(tl.pose.yaw)<=20&&offSquare(tr.pose.yaw)<=20,"square to the walls: "+tl.pose.yaw+", "+tr.pose.yaw);
  assert.ok(apart(tl.pose.yaw,tr.pose.yaw)>=120,"from each end");
  assert.notEqual(JSON.stringify(p.panels.map(v=>v.pose)),JSON.stringify(cover.plan(T,preview,scene,space,{subjects:SUBJECTS}).panels.map(v=>v.pose)),"a different set from the default");
  assert.ok(!p.panels.slice(2).some(v=>v.targetId==="bins"||v.targetId==="step"));
  assert.equal(Object.values(cover.assess(T,preview,scene,space,Object.fromEntries(p.panels.map(v=>[v.key,v.pose])),{subjects:SUBJECTS})).join("|"),"|||");
});

// ── through the app
function bakery(){
  const anchor=(id,name,xy,size,more={})=>({id,name,space:"Bakery",xy,z:size[2]/2,size,facing:0,sizeBasis:"design",placement:"Saved test position",basis:"design",...more});
  const l={id:"bakery",key:"bakery",name:"Bakery",coverageViews:[],
    spatialPlan:{status:"reviewed",source:{assetId:"bakery",iso:""},frame:"North",heights:"centre",
      anchors:[anchor("bench","Work bench",[5,1],[2.6,.8,.9],{evidence:"Script: she works at the bench"}),anchor("shelf","Shelf of baskets",[6.3,2.6],[.35,1.2,1.8]),
        anchor("oven","Deck oven",[2,6.5],[1.4,1,1.9]),anchor("racks","Cooling racks",[3.7,6.6],[1.4,.6,1.8]),anchor("counter","Service counter",[.7,1.8],[.6,1.6,.95])],
      coordinates:{spaces:[{id:"bakery",name:"Bakery",floorZ:0,ceilingH:H,footprint:[[0,0],[W,0],[W,D],[0,D]],openings:[]}],
        // the cameras a floor plan draft came with: square at each end wall, then each wall again
        cameras:[{spaceId:"bakery",panel:"TL",position:[1.4,.5,1.6],yaw:15,pitch:-5,lensMm:20,target:"oven",basis:"design"},
          {spaceId:"bakery",panel:"TR",position:[5.4,6.2,1.6],yaw:209,pitch:-5,lensMm:20,basis:"design"},
          {spaceId:"bakery",panel:"BL",position:[3.2,4.8,1.5],yaw:155,pitch:-10,lensMm:28,target:"bench",basis:"design"},
          {spaceId:"bakery",panel:"BR",position:[2.6,3.8,1.5],yaw:347,pitch:0,lensMm:35,target:"oven",basis:"design"}]}}};
  b.turnContinuity={locations:[l]};return l;
}
const poseOf=(l,k)=>b.locationPanelPoses(l).find(p=>p.key===k).pose;
const same=(a,c)=>Math.hypot(a.position[0]-c.position[0],a.position[1]-c.position[1],a.position[2]-c.position[2])<.06&&apart(a.yaw,c.yaw)<2;

await test("B1 a confirmed draft has its cameras fitted afresh; a camera set by hand stays", async()=>{
  const l=bakery(),before=JSON.stringify(b.turnContinuity);
  assert.equal(poseOf(l,"TL").yaw,15,"the draft's cameras are the room's cameras until then");
  // as before: usable cameras are left alone (a hand edit of the plan only fills what is missing)
  const plain=await api.proposeCamerasForPlace(l);
  assert.equal(plain.length,1);assert.equal(plain[0].kept,true,"four usable cameras: nothing to do");
  // a DRAFT just confirmed: every camera nobody set by hand is fitted again, usable or not
  const rows=await api.proposeCamerasForPlace(l,undefined,{redo:true});
  assert.equal(JSON.stringify(b.turnContinuity),before,"nothing is saved by proposing");
  assert.deepEqual([...rows[0].set],["TL","TR","BL","BR"]);
  const next={...l,coverageViews:rows[0].views};b.turnContinuity={locations:[next]};
  for(const k of ["TL","TR","BL","BR"])assert.ok(!same(poseOf(next,k),poseOf(l,k)),k+" is no longer the draft's camera");
  assert.ok(apart(poseOf(next,"TL").yaw,poseOf(next,"TR").yaw)>=120&&offSquare(poseOf(next,"TL").yaw)>=20,"the fitted wide views are turned across the room");
  assert.equal(Object.keys(api.cameraProblems(next)).length,0);
  // …and one the writer set with Move a camera is theirs
  const mine={position:[3,3.5,1.5],yaw:300,pitch:-5,lensMm:28,basis:"user"};
  const hand={...l,coverageViews:b.locationCoverageViewsWithPose(l,"BR",mine)};b.turnContinuity={locations:[hand]};
  const kept=await api.proposeCamerasForPlace(hand,undefined,{redo:true});
  assert.deepEqual([...kept[0].set],["TL","TR","BL"],"the hand-set camera is not refitted");
  const after={...hand,coverageViews:kept[0].views};b.turnContinuity={locations:[after]};
  assert.ok(same(poseOf(after,"BR"),mine)&&poseOf(after,"BR").basis==="user");
});

await test("B2 a fitted camera's note says what the camera is; a note written by hand stays", async()=>{
  const l=bakery(),p=await api.proposeCamerasAuto(l),views=api.cameraProposalViews(l,p);
  const note=k=>views.find((v,i)=>v.panel===k||k==="TL"&&i===0&&!v.panel);
  assert.equal(note("TL").purpose,"wide three-quarter view across the space");
  assert.equal(note("TR").purpose,"reverse wide view of the space, from the opposite side");
  for(const k of ["BL","BR"]){
    const panel=p.panels.find(v=>v.key===k);
    assert.equal(note(k).purpose,"close-up of "+panel.label.replace(/ detail$/,""),"the close-up names its own subject");
    assert.ok(note(k).target,"and aims at it");
  }
  // (the notes used to be the replaced cameras': "high three-quarter overview from an elevated corner" at eye level)
  assert.ok(!views.some(v=>/elevated corner|key station/i.test(v.purpose||"")));
  assert.equal(note("TL").target||"","","a wide view aims at no one thing");
  // a note someone wrote on the card is theirs
  const authored={...l,coverageViews:[{id:"mine",name:"My master",purpose:"Keep this note",target:"The till"}]};b.turnContinuity={locations:[authored]};
  const kept=api.cameraProposalViews(authored,await api.proposeCamerasAuto(authored)).find(v=>v.id==="mine");
  assert.equal(kept.purpose,"Keep this note");assert.equal(kept.target,"The till");
  // the other coverage says so in its own words
  const ends={...(await api.proposeCamerasAuto(l,undefined,{square:true})),ends:true};b.turnContinuity={locations:[l]};
  const along=api.cameraProposalViews(l,ends);
  assert.equal(along[0].purpose,"wide view along the space from one end");
  assert.equal(along.find(v=>v.panel==="TR").purpose,"reverse wide view of the space, from its other end");
});

await test("B3 Try other views: to the default from an old set, on to the other coverage, and back", async()=>{
  const l=bakery();
  // a set that is not the default (the draft's): the default is offered first
  const first=await api.otherViews(l);
  assert.equal(first.coverage,"across");
  assert.equal(JSON.stringify(first.proposal.panels.map(v=>v.pose)),JSON.stringify((await api.proposeCamerasAuto(l)).panels.map(v=>v.pose)));
  assert.match(first.note,/^Views changed, free: two wide views across the space from opposite sides, and two close-ups\. Press Try other views again for a view from each end instead\.$/);
  let now={...l,coverageViews:api.cameraProposalViews(l,first.proposal)};b.turnContinuity={locations:[now]};
  // on the default: the other coverage
  const second=await api.otherViews(now);
  assert.equal(second.coverage,"ends");assert.equal(second.proposal.ends,true);assert.equal(second.proposal.auto,true,"the same checked fit");
  assert.ok(second.proposal.panels.slice(0,2).every(v=>offSquare(v.pose.yaw)<=20));
  assert.match(second.note,/^Views changed, free: a view from each end of the space and two details\. Press Try other views again to go back to the first views\.$/);
  now={...now,coverageViews:api.cameraProposalViews(now,second.proposal)};b.turnContinuity={locations:[now]};
  assert.equal(Object.keys(api.cameraProblems(now)).length,0);
  // …and back
  assert.equal((await api.otherViews(now)).coverage,"across");
  // a camera set by hand stays in both
  const mine={position:[3,3.5,1.5],yaw:300,pitch:-5,lensMm:28,basis:"user"};
  let hand={...l,coverageViews:b.locationCoverageViewsWithPose(l,"BR",mine)};b.turnContinuity={locations:[hand]};
  for(let i=0;i<2;i++){
    const o=await api.otherViews(hand);
    assert.ok(same(o.proposal.panels.find(v=>v.key==="BR").pose,mine),"the hand-set camera is in the "+o.coverage+" set as it was");
    hand={...hand,coverageViews:api.cameraProposalViews(hand,o.proposal)};b.turnContinuity={locations:[hand]};
    assert.equal(poseOf(hand,"BR").basis,"user");
  }
  // all four set by hand: nothing to change, said plainly
  let all=l;for(const k of ["TL","TR","BL","BR"])all={...all,coverageViews:b.locationCoverageViewsWithPose(all,k,{...poseOf(l,k),basis:"user"})};
  b.turnContinuity={locations:[all]};
  await assert.rejects(()=>api.otherViews(all),/^Error: All four cameras of this space were set by hand, so they stay as they are\. Change one with Move a camera\.$/);
  // a floor plan not confirmed yet has no views to change
  const draft={...l,spatialPlan:{...l.spatialPlan,status:"draft"}};b.turnContinuity={locations:[draft]};
  await assert.rejects(()=>api.otherViews(draft),/layout|floor plan/i);
});

// ── the furniture kit
await test("C two doors of one set are told apart: a back door is not drawn in the front door's colour", ()=>{
  const k={};k.window=k;vm.createContext(k);vm.runInContext(read("app/set-kit.js"),k,{filename:"set-kit.js"});
  const K=k.KinolotSetKit,door=(id,name,x,material)=>({id,name,kind:"box",size:[.9,.05,2.1],position:[x,0,1.05],rotation:[0,0,0],material});
  const materials={black:{baseColor:[.02,.02,.02],metallic:0,roughness:.6},white:{baseColor:[.9,.9,.9],metallic:0,roughness:.6}};
  const leaf=(r,name)=>r.parts.find(p=>p.name===name&&Math.abs(p.size[0]-.9)<.01&&Math.abs(p.size[2]-2.1)<.01);
  const both=K.expand({materials,objects:[door("extra-1","Iron front door",0,"black"),door("extra-2","Back door",3,"black")]});
  assert.equal(both.pieces.filter(p=>p.piece==="door").length,2);
  assert.equal(leaf(both,"Iron front door").material,"black","the front door keeps the colour it was dressed in");
  assert.equal(leaf(both,"Back door").material,"kit_service_door","the back door is drawn as a plain painted door");
  assert.ok(both.materials.kit_service_door&&both.materials.kit_service_door.baseColor.some(v=>v>.2),"a colour that reads against black");
  assert.ok(both.parts.some(p=>p.name==="Back door"&&p.material==="kit_service_door_kitshade"),"its panels are shaded from its own colour");
  // doors with their own colours stay as dressed
  const own=K.expand({materials,objects:[door("extra-1","Iron front door",0,"black"),door("extra-2","Back door",3,"white")]});
  assert.equal(leaf(own,"Back door").material,"white");
  // two doors of one kind stay as dressed, and so does a lone back door
  const twins=K.expand({materials,objects:[door("extra-1","Back door",0,"black"),door("extra-2","Side door",3,"black")]});
  assert.equal(leaf(twins,"Back door").material,"black");assert.equal(leaf(twins,"Side door").material,"black");
  const fronts=K.expand({materials,objects:[door("extra-1","Front door",0,"black"),door("extra-2","Hall door",3,"black")]});
  assert.equal(leaf(fronts,"Hall door").material,"black");
  assert.equal(leaf(K.expand({materials,objects:[door("extra-1","Back door",0,"black")]}),"Back door").material,"black");
});

// ── the card
await test("D the card offers Try other views; confirming a draft refits; fresh keys; Frances knows", ()=>{
  const card=read("app/location-set-card-ui.jsx"),previs=read("app/set-previs-ui.jsx"),ui=read("app/locations-ui.jsx"),render=read("app/blender-render.js"),
    coverage=read("app/camera-coverage.js"),css=read("app/styles.css"),html=read("TURN.html"),ai=read("app/ai.jsx");
  // beside Move a camera, on the set card
  assert.ok(card.includes('LSC_E(window.LocationCameraAngleWorkbench,{ l:space.location, onUpdate, readOnly, inline:true, label:"Move a camera" }),')
    &&card.includes("window.LocationOtherViews && LSC_E(window.LocationOtherViews,{ l:space.location, onUpdate, readOnly })),"));
  for(const t of ["function LocationOtherViews({l,onUpdate,readOnly}){","window.LocationOtherViews=LocationOtherViews;",'"data-testid":"set-card-other-views"','"Try other views"',
      "next=await api.otherViews(now,list);",'onUpdate(l.id,{coverageViews:api.cameraProposalViews(still,next.proposal,latest)},{kind:"suggested-cameras"});',
      'throw new Error("The open film changed. Nothing was saved.");','"data-testid":"set-card-other-views-note"'])
    assert.ok(previs.includes(t),t);
  assert.ok(css.includes(".previs-move-camera .previs-other-views-note{flex:1 1 100%;margin:0}"));
  // the camera step of the older card layout offers the same
  assert.ok(ui.includes('if(other===true)p={...(await api.proposeCamerasAuto(l,list,{square:true})),ends:true};')&&ui.includes('"data-testid":"camera-other-views"')
    &&ui.includes('proposal.ends?"Back to the first views":"Try other views"'));
  // confirming a DRAFT refits the place's cameras; a hand edit only fills what is missing
  for(const t of ["const fitPlaceCameras=async(ownerId,list,sig,epoch,redo)=>{","if(!place||!redo&&!api.camerasMissingForPlace(place,list).length)return;",
      "const rows=await api.proposeCamerasForPlace(place,list,{redo:!!redo});",
      "fitPlaceCameras(planOwner.id,list,locationSpatialPlanSig(reviewed),shown.epoch,!!draft&&!repair);}"])
    assert.ok(ui.includes(t),t);
  assert.ok(render.includes("async function proposeCamerasForPlace(location,list,{redo=false}={}){")&&render.includes('return bad.includes(k)||basis!=="user"&&basis!=="observed";'));
  // the stations the plan's own cameras aim at count as much as the screenplay's
  assert.ok(render.includes('aimed.has(String(a.id))?3:'));
  // the rule is a choice of the fit, never a fault of a saved camera
  assert.ok(coverage.includes("const adding=o=>!Object.values(chosen).some(v=>v.role!==\"detail\"&&turn(v.pose,o.pose)>.707&&v.c.get(o.primary.id).value>=.3);"));
  assert.ok(coverage.includes('try{return Object.fromEntries(KEYS.map(k=>[k,poses[k]?s.gate(poses[k]):"It has no position yet."]));}'),"the check of a saved camera is what it was");
  // keys
  const KEYS=["20261127-angles5"];
  for(const f of ["camera-coverage.js","blender-render.js","set-kit.js","locations-ui.jsx","set-previs-ui.jsx","location-set-card-ui.jsx","styles.css","ai.jsx","script.jsx"])
    assert.ok(KEYS.some(k=>html.includes("app/"+f+"?v="+k+'"')),f);
  // Frances: where it is, what it does, in plain words, no film's own names, no price words
  const fact=ai.slice(ai.indexOf('name:"Locations: the four views of a set, and Try other views"'));
  assert.ok(fact.startsWith('name:"Locations: the four views of a set, and Try other views"'));
  const what=fact.slice(0,fact.indexOf('" });'));
  for(const t of ["TWO WIDE VIEWS across the space from opposite sides","TWO CLOSE-UPS","no frame repeats another","WHEN A FLOOR PLAN DRAFT IS CONFIRMED","'Try other views'","a wide view from each end","TWO DOORS","a note someone wrote by hand is kept"])
    assert.ok(what.includes(t),t);
  assert.ok(!/\b(credits?|free|price|cost|bakery|oven)\b/i.test(what),"no price words, no film's own things");
});

console.log(`${checks} checks passed`+(failed?`, ${failed} FAILED`:""));
process.exit(failed?1:0);

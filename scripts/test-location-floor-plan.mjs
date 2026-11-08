#!/usr/bin/env node
/* LOCATION COORDINATES, step B (owner-approved 2026-10-13, "go ahead with both, include the top-down map"):
   1. "Draft floor plan" also drafts an APPROXIMATE metric floor plan (footprints, openings, anchor positions,
      panel cameras), each group with its basis; names become this family's ids; it stays a draft until confirmed
   2. the floor plan's cameras: used for the panels (a hand-set camera still wins); a plate the confirmed layout was
      read from lends its observed cameras to the rooms inside
   3. the reverse direction: a parent panel names the rooms its frustum sees (childrenVisible[], in prompt + record)
   4. "Layout changed — regenerate": plates record what they were made from; nothing regenerates on its own
   5. the top-down map's scene and the editable numbers (UI)
   All providers and persistence are mocked; this test spends nothing. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const json=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const deq=(a,b,m)=>assert.deepEqual(json(a),json(b),m||"values match");
const noop=()=>{};
let hooks=[],cursor=0,effects=[];
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  Fragment:"Fragment",
  useState:init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;
    return [hooks[i],v=>hooks[i]=typeof v==="function"?v(hooks[i]):v];},
  useReducer:(fn,init)=>React.useState(init),
  useRef:init=>{const i=cursor++;return hooks[i]||(hooks[i]={current:init});},
  useEffect:(fn,deps)=>{const i=cursor++;effects.push(fn);hooks[i]=deps;}
};
const box={console,React,setTimeout,clearTimeout,localStorage:{getItem:()=>null},Icon:new Proxy({},{get:()=>noop}),
  addEventListener:noop,removeEventListener:noop,dispatchEvent:()=>true,CustomEvent:class{constructor(t,i){this.type=t;this.detail=i&&i.detail;}},
  scenesInStoryOrder:x=>x||[],renderStyleText:()=>"Photoreal",nbEpoch:()=>1};
box.window=box;vm.createContext(box);
vm.runInContext(read("app/locations.jsx"),box);
vm.runInContext(read("app/locations-ui.jsx"),box);
let metas={},images={furnace:"furnace-plate"};
box.nbGetMeta=id=>metas[id]||null;box.nbGetImage=id=>images[id]||"";box.nbLoadImage=async id=>images[id]||"";
box.cropRegionAsDataUrl=async(url,rect)=>"crop:"+url+":"+rect.x+","+rect.y;

const anchors=[{id:"mouth",space:"Furnace",name:"Furnace mouth",placement:"north wall, centre",xy:[0,9.5],posBasis:"observed"},
  {id:"office-window",space:"Furnace Office",name:"Office window",placement:"south wall, overlooking the hall"},
  {id:"desk",space:"Furnace Office",name:"Foreman's desk",placement:"against the east wall",xy:[5.5,6]}];
const coordinates={origin:{anchorId:"mouth"},spaces:[
  {id:"furnace",name:"Furnace",footprint:[[-10,-10],[10,-10],[10,10],[-10,10]],ceilingH:12,basis:"observed"},
  {id:"office",name:"Furnace Office",footprint:[[2,4],[6,4],[6,8],[2,8]],floorZ:3,ceilingH:2.7,basis:"design",openings:[
    {id:"office-window",name:"Office window",kind:"window",centre:[4,4],width:2,sillZ:3.9,headZ:5,connectsTo:"furnace"},
    {id:"office-door",name:"Office door",kind:"door",centre:[2,6],width:0.9,sillZ:3,headZ:5.1,connectsTo:"furnace"}]}],
  cameras:[{spaceId:"furnace",panel:"TL",position:[0,-8,1.6],yaw:0,pitch:0,lensMm:24,basis:"observed"},
    {spaceId:"furnace",panel:"TR",position:[5,9,5],yaw:180,pitch:-30,lensMm:18,basis:"observed"},
    {spaceId:"furnace",panel:"BL",position:[4.3,3.5,4.4],yaw:160,pitch:-10,lensMm:24,basis:"observed"}]};
const planOf=(extra)=>box.normalizeLocationSpatialPlan({frame:"From the loading door facing the furnace mouth",status:"reviewed",
  source:{assetId:"furnace",iso:"f1"},anchors,coordinates,...(extra||{})});
const furnace={id:"furnace",key:"furnace",name:"Furnace",spatialPlan:planOf()};
const office={id:"office",key:"office",name:"Furnace Office",parentKey:"furnace"};
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};

/* ---- 1. the drafted floor plan ---- */
{
  const ai=read("app/ai.jsx");
  const ast=parseSync(ai,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
  const fn=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="aiDraftLocationSpatialPlan");
  let prompt="";
  const draft={frame:"From the loading door facing the furnace mouth",
    anchors:[{id:"mouth",space:"Furnace",name:"Furnace mouth",placement:"north wall",basis:"observed",xy:[0,9.5],z:0,facing:180,posBasis:"observed"}],
    sightlines:"Office window overlooks the hall",unresolved:"Ceiling height of the hall is a guess",
    coordinates:{origin:{anchorId:"mouth"},spaces:[{id:"Furnace Office",footprint:[[2,4],[6,4],[6,8],[2,8]],floorZ:3,ceilingH:2.7,basis:"observed",
      openings:[{id:"office-window",name:"Office window",kind:"window",centre:[4,4],width:2,connectsTo:"Furnace",basis:"observed"}]},
      {id:"the furnace",footprint:[[-10,-10],[10,-10],[10,10],[-10,10]],basis:"observed"}],
      cameras:[{space:"Furnace",panel:"TR",position:[5,9,5],yaw:180,pitch:-30,lensMm:18,basis:"observed"},
        {space:"Furnace Office",panel:"TL",position:[2.6,6,4.6],yaw:90,lensMm:24,basis:"design"}]}};
  Object.assign(box,{turnDownscaleDataUrl:async()=>"plate-data",aiAvailable:()=>true,extractJSON:JSON.parse,
    aiVisionComplete:async(messages)=>{prompt=messages[0].content;return {vision:true,text:JSON.stringify(draft)};}});
  vm.runInContext(ai.slice(fn.start,fn.end),box);
  metas.furnace={iso:"f1"};
  const proposal=await box.aiDraftLocationSpatialPlan(office,[],{});
  assert.equal(proposal.status,"draft","a drafted floor plan is reviewed like any layout");
  assert.match(prompt,/APPROXIMATE metric floor plan in the structured fields only/);
  assert.match(prompt,/never a survey/);
  assert.match(prompt,/REQUIRED-FIELD CHECKLIST/);
  assert.match(prompt,/z alone is NOT the object's physical height and never replaces size/);
  assert.match(prompt,/width and depth are LOCAL axes before facing rotation/);
  assert.match(prompt,/size \[2\.6,0\.6,0\.9\]/);
  assert.match(prompt,/existing user measurements conflict[\s\S]*unresolved rather than silently swapping them/);
  assert.match(prompt,/TR a complementary reverse wide from the other end of the room at roughly eye level/);
  assert.match(prompt,/BL and BR tighter views of two different named stations/);
  assert.match(prompt,/same landmark ID, explicit kind window\/door\/glass\/arch/);
  assert.match(prompt,/naming the exact object and field/);
  assert.match(prompt,/Do not invent metric dimensions in the prose fields/);
  assert.match(prompt,/\+Y = the facing named in your frame/);
  assert.match(prompt,/yaw = degrees clockwise from \+Y/);
  assert.match(prompt,/basis observed \(read from the panels\), script \(stated in the screenplay\) or design \(proposed\)/);
  assert.match(prompt,/for a room with no plate yet, propose cameras INSIDE it/);
  deq(proposal.coordinates.spaces.map(s=>[s.id,s.name]),[["office","Furnace Office"],["furnace","Furnace"]],"spaces named in the draft become this family's ids");
  assert.equal(proposal.coordinates.spaces[0].openings[0].connectsTo,"furnace");
  assert.equal(proposal.coordinates.spaces[0].openings[0].yaw,180);
  // the draft's cameras, then the saved ones it didn't propose (a new draft keeps what was set, owner 2026-11-01)
  deq(proposal.coordinates.cameras.map(c=>[c.spaceId,c.panel,c.basis]),[["furnace","TR","observed"],["office","TL","design"],["furnace","TL","observed"],["furnace","BL","observed"]]);
  assert.equal(proposal.keptOnRedraft.cameras.length,3,"the review lists the saved cameras it kept");
  assert.equal(proposal.anchors[0].facing,180);assert.equal(proposal.anchors[0].posBasis,"observed");
  // the words keep their 12,000-character limit; the numbers have their own 9,000
  const big={...proposal,coordinates:{...proposal.coordinates,spaces:Array.from({length:16},(_,i)=>({id:"s"+i,name:"Space "+i,
    footprint:Array.from({length:32},(_,j)=>[i*10+j*0.123,j*0.456]),openings:Array.from({length:6},(_,k)=>({id:"o"+k,centre:[i,k],width:1}))}))}};
  const nb=box.normalizeLocationSpatialPlan(big);
  assert.ok(JSON.stringify({...nb,coordinates:undefined}).length<12000&&box.locationSpatialPlanTooLarge(nb));
  assert.match(box.locationSpatialPlanState({...furnace,spatialPlan:{...nb,status:"reviewed"}}).reason,/and its floor plan to 9,000/);
  assert.equal(box.locationSpatialPlanTooLarge(furnace.spatialPlan),false);
}

/* ---- 2. the floor plan's cameras ---- */
let panels=box.locationPanelPoses(furnace);
deq(panels.map(p=>[p.key,p.source,p.stated]),[["TL","layout",true],["TR","layout",true],["BL","layout",true],["BR","suggested",false]],
  "a main location states the cameras its reviewed floor plan gives");
deq(panels[1].pose.position,[5,9,5]);
const handSet={...furnace,coverageViews:box.locationCoverageViewsWithPose(furnace,"TR",{yaw:170})};
panels=box.locationPanelPoses(handSet);
assert.equal(panels[1].source,"set");assert.equal(panels[1].pose.yaw,170,"a camera set by hand wins");
deq(panels[1].pose.position,[5,9,5],"…field by field over the floor plan's");
deq(panels[1].suggestedPose.position,[5,9,5],"'back' returns to the floor plan's camera");
// an older plate (no recorded cameras) that the confirmed layout was READ from lends its observed cameras to the rooms
metas.furnace={iso:"f1"};
let plan=box.locationSubspacePanelPlan(office);
assert.equal(plan.sources.length,1);
assert.equal(plan.sources[0].key,"BL","the camera in front of the window; TR stands behind the office and is never chosen");
assert.equal(plan.sources[0].approx,false,"positions from the floor plan make it a coverage-checked match");
metas.furnace={iso:"f2"};
assert.equal(box.locationSubspacePanelPlan(office).sources.length,0,"a newer plate than the one the layout was read from: nothing borrowed");
metas.furnace={iso:"f1"};
furnace.spatialPlan={...furnace.spatialPlan,status:"draft"};
assert.equal(box.locationSubspacePanelPlan(office).sources.length,0,"only a confirmed layout");
furnace.spatialPlan={...furnace.spatialPlan,status:"reviewed"};

/* ---- 3. the reverse direction ---- */
panels=box.locationPanelPoses(furnace);
let kids=box.locationPanelChildrenVisible(furnace,panels[0]);
deq(kids,[{spaceId:"office",name:"Furnace Office",frame:"right",depth:"far",distance:14.6,level:"raised",
  openings:[{id:"office-window",name:"Office window",kind:"window",faces:"camera"},{id:"office-door",name:"Office door",kind:"door",faces:"side"}]}],
  "TL, on the hall floor looking north, sees the office box: its window faces the camera, its west door is side-on");
assert.equal(box.locationChildrenVisibleText(kids)," In this view: Furnace Office sits in the far right of the frame, about 14.6 m away, raised above the camera; its window “Office window” faces the camera, its door “Office door” is side-on — keep it exactly where the shared layout puts it.");
assert.deepEqual(json(box.locationPanelChildrenVisible(furnace,{...panels[0],pose:{...panels[0].pose,yaw:180}})),[],"looking away: nothing");
assert.deepEqual(json(box.locationPanelChildrenVisible(furnace,{...panels[0],pose:{...panels[0].pose,position:[4,6,4.5]}})),[],"a camera inside the room doesn't 'see' the room");
assert.deepEqual(json(box.locationPanelChildrenVisible(furnace,{...panels[0],pose:{...panels[0].pose,position:null}})),[],"no positions: nothing claimed");
const record=box.locationPlatePanelRecord(furnace);
assert.equal(record.panels.TL.childrenVisible[0].spaceId,"office","stored per parent panel");
deq(record.panels.TR.childrenVisible.map(k=>[k.frame,k.depth,k.openings.map(o=>o.faces).join("/")]),[["right","middle","away/away"]],
  "TR, behind the office looking south over the hall, sees the office's back: its window and door face away");
const spec=JSON.parse(box.buildLocationRefPrompt(furnace,{}).split("\n").slice(1).join("\n"));
assert.match(spec.views.top_left,/Camera at x 0 m, y -8 m, 1\.6 m up, facing north \(0°\).*In this view: Furnace Office sits in the far right of the frame/);

/* ---- 4. Layout changed — regenerate ---- */
const generated=[],commits=[];
box.nbGenerate=async(prompt,opts)=>{generated.push({prompt,opts});return "rendered";};
box.nbCommit=async(id,url,meta)=>{commits.push({id,meta});return {tier:"local"};};
assert.equal(await box.generateLocationPlate(furnace,{}),true);
const made=commits[0].meta;
assert.match(made.plateLayoutSig,/^pl1:/);
assert.deepEqual(Object.keys(made.platePanels.panels),["TL","TR","BL"]);
assert.equal(made.platePanels.panels.TL.childrenVisible[0].name,"Furnace Office");
assert.equal(box.locationPlateLayoutChanged(made,furnace,{panels:true}),false,"just made: unchanged");
assert.equal(box.locationPlateLayoutChanged(made,{...furnace,spatialPlan:{...furnace.spatialPlan,status:"draft"}},{panels:true}),false,"review state alone is no change");
const moved={...furnace,spatialPlan:planOf({anchors:anchors.map(a=>a.id==="desk"?{...a,placement:"against the north wall"}:a)})};
box.turnContinuity={locations:[moved,office],scenes:[],drafts:{}};
assert.equal(box.locationPlateLayoutChanged(made,moved,{panels:true}),true,"a layout edit says so");
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};
const recam={...furnace,coverageViews:box.locationCoverageViewsWithPose(furnace,"TL",{yaw:10})};
assert.equal(box.locationPlateLayoutChanged(made,recam,{panels:true}),true,"a camera change says so on a 2x2 plate");
assert.equal(box.locationPlateLayoutChanged({plateLayoutSig:box.locationPlateLayoutSig(furnace)},recam),false,"…not on a single-frame plate");
assert.equal(box.locationPlateLayoutChanged({iso:"old"},moved,{panels:true}),false,"a plate made before this records nothing and says nothing");
assert.equal(generated.length,1,"nothing regenerates on its own");
commits.length=0;
images.office="room-plate";metas.office={iso:"o1"};
await box.generateLocationVariant(office,{id:"night",time:"Night",state:"Lights on"},{});
assert.match(commits[0].meta.plateLayoutSig,/^pl1:/,"a room's state plate records the layout too");
const ui=read("app/locations-ui.jsx");
assert.match(ui,/locationPlateChangeReasons\(meta,l\)/);
assert.ok(ui.includes("2 · Floor plan changed")&&ui.includes("3 · Cameras changed"));
// (2026-10-14) wrapped by the copy check, which adds its result to the same meta — on the state and room & time cards;
// an extra space (a main location's only, no parent plate to compare with) stamps it without one (headless paths)
assert.equal((ui.match(/metaExtra:async \(\{mode,url,iso\}\)=> _withCopyCheck\(l,url,iso,_withLayoutStamp\(l,mode,gen,/g)||[]).length,2,"the state and room & time cards stamp it");
assert.equal((ui.match(/metaExtra:async \(\{mode,url,iso\}\)=> _withLayoutStamp\(l,mode,gen,/g)||[]).length,1,"the extra-space card stamps it");
assert.match(ui,/plateLayoutSig:masterLayoutSig.current/);

/* ---- 5. the top-down map ---- */
const scene=box.locationFloorPlanScene(furnace,furnace.spatialPlan);
assert.equal(scene.spaces.length,2);assert.equal(scene.spaces[0].owner,true);
const win=scene.openings.find(o=>o.id==="office-window");
deq([win.a,win.b].sort((p,q)=>p[0]-q[0]),[[3,4],[5,4]],"a window is drawn along its wall, as wide as it is");
assert.ok(scene.anchors.some(a=>a.id==="desk"),"positioned anchors are drawn");
const tl=scene.cameras.find(c=>c.spaceId==="furnace"&&c.panel==="TL");
deq(tl.frustum[0],[0,-8]);
assert.ok(Math.abs(Math.atan2(tl.frustum[1][0]-0,tl.frustum[1][1]+8)*180/Math.PI+tl.hfov/2)<0.5,"the frustum opens by the lens's field of view");
assert.ok(scene.cameras.some(c=>c.spaceId==="office"),"the room's cameras are drawn too");
assert.ok(scene.noPosition.some(c=>c.spaceId==="furnace"&&c.panel==="BR"),"cameras without a position are listed, not drawn");
const other=box.locationFloorPlanScene(furnace,{...furnace.spatialPlan,coordinates:{...coordinates,spaces:[coordinates.spaces[0]]}});
assert.equal(other.spaces.length,1,"a draft under review is drawn as itself");
assert.equal(furnace.spatialPlan.coordinates.spaces.length,2,"…and the saved layout is untouched");
assert.equal(box.locationFloorPlanScene(furnace,box.normalizeLocationSpatialPlan({frame:"x",anchors:[]})).empty,true);

// the map component (READABLE MAP, owner 2026-10-13: "is this intended?" — a canal-side plan squashed into a strip)
let selected="";const flat=n=>!n||typeof n!=="object"?[]:[n,...(n.children||[]).flatMap(flat)];
const text=n=>n==null||n===false?"":typeof n!=="object"?String(n):(n.children||[]).map(text).join("");
const cls=n=>String((n.props&&n.props.className)||"");
const render=(props,keep)=>{if(!keep)hooks=[];cursor=0;effects=[];return box.LocationFloorPlanMap({selected:"",onSelect:v=>selected=v,...props});};
let map=render({scene});
const svg=flat(map).find(n=>n.type==="svg");
assert.ok(svg&&/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(svg.props.viewBox));
assert.match(svg.props["aria-label"],/Top-down map/);
assert.equal(flat(svg).filter(n=>n.type==="polygon").length,2+scene.cameras.length,"'Both' (no current space): every footprint and every cone");
let seg=flat(map).find(n=>n.type==="button"&&n.props["aria-label"]==="Furnace · top-left camera");
assert.equal(text(seg),"TL","a camera is one segment of its space's TL TR BL BR row");
seg.props.onClick();assert.equal(selected,"furnace:TL");
map=render({scene,selected:"furnace:TL"});
assert.match(text(map),/Furnace · top-left: Camera at x 0 m, y -8 m, 1\.6 m up, facing north \(0°\), level, 24 mm lens\. Field of view 74°\. From the floor plan\./);
assert.ok(flat(map).some(n=>n.type==="g"&&/loc-map-cam on/.test(cls(n))),"its frustum is highlighted");
assert.ok(flat(map).some(n=>n.type==="g"&&/dim/.test(cls(n))),"the others step back");
assert.equal(flat(map).filter(n=>n.type==="g"&&cls(n)==="loc-map-sel").length,1,"one full label on the map");
assert.match(text(flat(map).find(n=>cls(n)==="loc-map-sel")),/^TL — Furnace · top-left$/,"the panel letters show only when selected");
assert.match(text(map),/Approximate — estimated from the plates and the screenplay, not surveyed/);
assert.match(text(map),/Not drawn \(no position yet\): Furnace · bottom-right/);
assert.ok(flat(map).some(n=>n.type==="button"&&/no position yet/.test(n.props["aria-label"]||"")&&n.props["aria-disabled"]==="true"));
assert.match(text(box.LocationFloorPlanMap({scene:{empty:true}})),/No floor plan numbers yet/);

/* ---- 6. a canal-side place (long and thin) with a glassworks frontage on it, a stray dot far to the right ---- */
const quayAnchors=[{id:"pontoon",space:"Fondamenta",name:"Vaporetto landing pontoon",placement:"on the canal off the quay",xy:[12,-2.5]},
  {id:"shelter",space:"Fondamenta",name:"Break down shelter",placement:"mid-quay",xy:[30,4]},
  {id:"sacks",space:"Fondamenta dei Vetrai",name:"Wet sand sacks",placement:"by the furnace door",xy:[45,10]},
  {id:"post",space:"Fondamenta",name:"Mooring post",placement:"at the far end",xy:[400,3]},
  {id:"bench",space:"Fondamenta",name:"Bench",placement:"just off the west end",xy:[-14,4]},
  {id:"crate",space:"Fondamenta",name:"Crate",placement:"well off the west end",xy:[-20,4]},
  {id:"lamp1",space:"Fondamenta",name:"Lamp post one",xy:[20,1]},{id:"lamp2",space:"Fondamenta",name:"Lamp post two",xy:[20.2,1.1]},
  {id:"lamp3",space:"Fondamenta",name:"Lamp post three",xy:[20.1,0.9]}];
const quayCoords={origin:{anchorId:"shelter"},spaces:[
  {id:"fond",name:"Fondamenta",footprint:[[0,0],[60,0],[60,8],[0,8]],basis:"observed"},
  {id:"vetrai",name:"Fondamenta dei Vetrai",footprint:[[40,8],[52,8],[52,14],[40,14]],basis:"design",openings:[
    {id:"vdoor",name:"Furnace door",kind:"door",centre:[46,8],width:1.2,connectsTo:"fond"},
    {id:"vwin",name:"Shop window",kind:"window",centre:[42,8],width:2,connectsTo:"fond"}]}],
  cameras:[{spaceId:"fond",panel:"TL",position:[2,4,1.6],yaw:90,lensMm:24,basis:"observed"},
    {spaceId:"fond",panel:"TR",position:[30,-3,4],yaw:0,lensMm:18,basis:"observed"},      // on the water side of the quay: not an outlier
    {spaceId:"fond",panel:"BL",position:[58,4,1.6],yaw:270,lensMm:35,basis:"observed"},
    {spaceId:"vetrai",panel:"TL",position:[46,9,1.6],yaw:0,lensMm:24,basis:"design"},
    {spaceId:"vetrai",panel:"TR",position:[51,13,3],yaw:225,lensMm:16,basis:"design"},
    {spaceId:"vetrai",panel:"BR",position:[46,300,1.6],yaw:180,lensMm:24,basis:"design"}]};   // a stray camera
const fond={id:"fond",key:"fond",name:"Fondamenta",spatialPlan:box.normalizeLocationSpatialPlan({frame:"Along the quay, facing the canal",
  status:"draft",anchors:quayAnchors,coordinates:quayCoords})};
const vetrai={id:"vetrai",key:"vetrai",name:"Fondamenta dei Vetrai",parentKey:"fond"};
const quayList=[fond,vetrai];
const quay=box.locationFloorPlanScene(fond,fond.spatialPlan,quayList);
deq(quay.spaceList.map(s=>[s.id,s.owner]),[["fond",true],["vetrai",false]],"every space of the family, the owner first");
deq(quay.anchors.map(a=>[a.id,a.num,a.spaceId]).slice(0,4),[["pontoon",1,"fond"],["shelter",2,"fond"],["sacks",3,"vetrai"],["post",4,"fond"]],
  "objects are numbered for the key, each with its space");
deq(quay.openings.map(o=>[o.id,o.tag,o.spaceId]),[["vdoor","D1","vetrai"],["vwin","W1","vetrai"]],"openings get short W1 / D1 tags");
assert.equal(box.locationFloorPlanMargin([[0,0],[60,0],[60,8],[0,8]]),15,"the margin: 25% of a 60 m quay");
assert.equal(box.locationFloorPlanMargin([[0,0],[4,0],[4,4],[0,4]]),3,"…never under 3 m");
deq(quay.outliers.map(o=>[o.kind,o.id]),[["object","post"],["object","crate"],["camera","BR"]],
  "the mooring post 340 m out, the crate 20 m off the end and a camera 286 m off are outliers; the bench 14 m off and the pontoon on the water are not");
assert.equal(quay.anchors.find(a=>a.id==="bench").outlier,false);
assert.equal(quay.cameras.find(c=>c.spaceId==="fond"&&c.panel==="TR").outlier,false,"a camera on the exterior quay is drawn normally");
assert.ok(quay.bounds.maxX>=400,"the old bounds still include everything");
assert.ok(quay.fit.minX>=-14.5&&quay.fit.maxX<=60.5&&quay.fit.maxY<=14.5&&quay.fit.minY>=-3.5,"the fit: footprints, their cameras and what is near them — never an outlier");
const vfit=box.locationFloorPlanFit(quay,"vetrai");
assert.ok(vfit.minX>=40&&vfit.maxX<=52&&vfit.minY>=8&&vfit.maxY<=14,"one space: its own footprint, cameras and objects");
deq(box.locationFloorPlanFit(quay,"nowhere"),quay.fit,"an unknown space: the whole plan");
// a scene without any footprint has nothing to test against: no outliers
assert.equal(box.locationFloorPlanScene(fond,{...fond.spatialPlan,coordinates:{...quayCoords,spaces:[]}},quayList).outliers.length,0);

// the map takes the plan's shape — one scale on both axes, 160–480 px tall on a phone, ≤ 560 px on a desktop
let b=box.locMapBox(quay.fit,343);
assert.equal(b.W,343);assert.equal(b.H,160,"a long quay on a phone: a wide map at the 160 px floor");
assert.ok(Math.abs(b.vw/b.vh-b.W/b.H)<1e-9,"equal x / y scale");
const room={minX:0,maxX:6,minY:0,maxY:6};
b=box.locMapBox(room,343);assert.equal(b.H,343,"a square room on a phone: square");
b=box.locMapBox({minX:0,maxX:4,minY:0,maxY:40},343);assert.equal(b.H,480,"a tall corridor on a phone: capped at 480 px");
b=box.locMapBox(room,900);assert.equal(b.H,560,"a square room on a desktop: capped at 560 px");
b=box.locMapBox(quay.fit,900);assert.ok(b.H>=160&&b.H<260,"a long quay on a desktop stays wide");
// zoom and pan
b=box.locMapBox(quay.fit,343);
deq(box.locMapClamp(b,{zoom:1,cx:999,cy:-999}),{zoom:1,cx:b.cx,cy:b.cy},"at the fit the view cannot wander");
let v=box.locMapZoomAt(b,{zoom:1,cx:b.cx,cy:b.cy},3,100,80);
assert.equal(v.zoom,3);
const under=(view,px,py)=>[view.cx+(px-b.W/2)/(b.s*view.zoom),view.cy-(py-b.H/2)/(b.s*view.zoom)];
const p1=under({zoom:1,cx:b.cx,cy:b.cy},100,80),p2=under(v,100,80);
assert.ok(Math.abs(p1[0]-p2[0])<1e-6&&Math.abs(p1[1]-p2[1])<1e-6,"zooming keeps the point under the pointer");
assert.equal(box.locMapClamp(b,{zoom:99}).zoom,12,"zoom is capped");
assert.equal(box.locMapClamp(b,{zoom:0.2}).zoom,1,"never smaller than the fit");
deq(json(box.locMapScaleBar(20)),{m:5,px:100,label:"5 m"},"a scale bar in round metres");
assert.equal(box.locMapScaleBar(400).label,"0.5 m");
// label placement never overlaps and stays on the map
const taken=[];
assert.ok(box.locMapPlace(taken,[[10,10]],20,20,100,100));
assert.equal(box.locMapPlace(taken,[[15,15]],20,20,100,100),null,"an overlapping spot is refused");
deq(json(box.locMapPlace(taken,[[15,15],[95,10],[40,10]],20,20,100,100)),{x:40,y:10,w:20,h:20},"…the next free candidate on the map wins");

// rendered on a phone, the current space is the room (the card's "Whole location / room" picker)
map=render({scene:quay,spaceId:"vetrai"});
let qs=flat(map).find(n=>n.type==="svg");
assert.equal(qs.props.viewBox,"0 0 343 "+box.locMapBox(box.locationFloorPlanFit(quay,"vetrai"),343).H,"the viewBox is the map's own size — fitted to the room");
deq(flat(map).filter(n=>n.type==="button"&&/loc-map-chip/.test(cls(n))).map(n=>[text(n),n.props["aria-pressed"]]),
  [["Fondamenta",false],["Fondamenta dei Vetrai",true],["Both",false]],"one space at a time: the room, by default");
assert.ok(/dim/.test(cls(flat(qs).find(n=>n.type==="polygon"&&/owner/.test(cls(n))))),"the other space's footprint is dimmed");
deq(flat(qs).filter(n=>n.type==="g"&&/loc-map-cam/.test(cls(n))).map(n=>n.props.key),["c-vetrai:TL","c-vetrai:TR","c-vetrai:BL","c-vetrai:BR"],"…and its cameras are hidden (only the room's four)");
assert.deepEqual(flat(qs).filter(n=>n.type==="g"&&/loc-map-anchor/.test(cls(n))).map(n=>text(n)),["3"],"only the room's object, as its number");
assert.ok(!flat(qs).some(n=>n.type==="text"&&/Wet sand sacks|Fondamenta · /.test(text(n))),"names live in the key, not piled on the map");
assert.equal(text(flat(map).find(n=>/loc-map-camrow$/.test(cls(n)))),"Fondamenta dei VetraiTLTRBLBR","a compact TL TR BL BR row named for its space");
assert.equal(flat(map).filter(n=>/loc-map-camrow$/.test(cls(n))).length,1,"one camera row: the shown space");
assert.ok(flat(qs).some(n=>n.type==="path"&&/loc-map-arrow/.test(cls(n))),"the stray camera sits at the map's edge, pointing its way");
const legendText=text(flat(map).find(n=>cls(n)==="loc-map-legend"));
assert.match(legendText,/Wet sand sacks/);assert.match(legendText,/D1Furnace door/);
assert.match(legendText,/Fondamenta dei Vetrai · bottom-right camera: outside the plan — check this position/);
// Both: every space's things; the outliers listed and pointed at, the marker cluster nudged apart
map=render({scene:quay,spaceId:"vetrai"});
flat(map).find(n=>n.type==="button"&&text(n)==="Both").props.onClick();
map=render({scene:quay,spaceId:"vetrai"},true);
qs=flat(map).find(n=>n.type==="svg");
assert.equal(flat(qs).filter(n=>n.type==="polygon"&&/dim/.test(cls(n))).length,0,"Both: nothing dimmed");
const marks=flat(qs).filter(n=>n.type==="g"&&/loc-map-anchor/.test(cls(n))).map(g=>g.children.find(c=>c&&c.type==="circle"&&!c.props.className));
assert.equal(marks.length,quay.anchors.length);
for(let i=0;i<marks.length;i++)for(let j=i+1;j<marks.length;j++)
  assert.ok(Math.hypot(marks[i].props.cx-marks[j].props.cx,marks[i].props.cy-marks[j].props.cy)>=19.9,"numbered markers never overlap (three lamp posts 0.2 m apart)");
assert.ok(marks.every(c=>c.props.cx>=0&&c.props.cx<=343&&c.props.cy>=0&&c.props.cy<=qs.props.height),"every marker is on the map, outliers clamped at its edge");
const rows=flat(map).filter(n=>n.type==="button"&&/loc-map-row/.test(cls(n)));
deq(rows.filter(n=>/warn/.test(cls(n))).map(n=>text(n).replace(/\s+/g," ")),
  ["4Mooring postFondamenta · x 400, y 3 moutside the plan — check this position","6CrateFondamenta · x -20, y 4 moutside the plan — check this position"]);
// tapping a key row shows its full label on the map — one at a time
rows.find(n=>/Wet sand sacks/.test(text(n))).props.onClick();assert.equal(selected,"#a:sacks");
map=render({scene:quay,spaceId:"vetrai",selected:"#a:sacks"},true);
assert.deepEqual(flat(map).filter(n=>cls(n)==="loc-map-sel").map(text),["3 · Wet sand sacks"]);
assert.match(text(map),/3 · Wet sand sacks — Fondamenta dei Vetrai, x 45, y 10 m\. by the furnace door/);
flat(map).find(n=>n.type==="button"&&/loc-map-row/.test(cls(n))&&/Wet sand sacks/.test(text(n))).props.onClick();assert.equal(selected,"","tapping it again clears it");
const tagG=flat(qs).find(n=>n.type==="g"&&/loc-map-tag/.test(cls(n))&&text(n)==="D1");
assert.ok(tagG,"openings are short tags along their wall");tagG.props.onClick();assert.equal(selected,"#o:vetrai:vdoor");
// zoom buttons
const zb=l=>flat(map).find(n=>n.type==="button"&&n.props["aria-label"]===l);
assert.ok(zb("Zoom in")&&zb("Zoom out")&&zb("Fit the plan to the map"),"+ / − / Fit, with accessible labels");
assert.equal(zb("Zoom out").props.disabled,true,"already at the fit");
zb("Zoom in").props.onClick();
map=render({scene:quay,spaceId:"vetrai"},true);qs=flat(map).find(n=>n.type==="svg");
assert.match(cls(qs),/zoomed/,"zoomed in: the map takes one-finger pans (touch-action none) — at the fit a finger scrolls the page");
assert.equal(zb("Zoom out").props.disabled,false);
zb("Fit the plan to the map").props.onClick();
map=render({scene:quay,spaceId:"vetrai"},true);
assert.doesNotMatch(cls(flat(map).find(n=>n.type==="svg")),/zoomed/);
assert.ok(flat(map).some(n=>n.type==="g"&&/loc-map-north/.test(cls(n))&&text(n)==="N"),"a north arrow");
assert.match(text(flat(map).find(n=>n.type==="g"&&/loc-map-scale/.test(cls(n)))),/^\d+(\.5)? m$/,"a scale bar in metres");
const css=read("app/styles.css");
assert.match(css,/\.loc-map-svg\{[^}]*touch-action:pan-x pan-y/);assert.match(css,/\.loc-map-svg\.zoomed\{touch-action:none/);
assert.doesNotMatch(css,/\.loc-map-svg\{[^}]*aspect-ratio/,"no fixed box: the map's height comes from the plan");
assert.match(css,/\.loc-map-segbtn\{min-width:40px;min-height:34px/,"touch targets ≥ 32 px");
// "Check these positions" near Review / Confirm on a draft (never blocking)
assert.equal(box.locationFloorPlanCheckText(quay),"Check these positions: Mooring post, Crate, Fondamenta dei Vetrai · bottom-right camera — far outside every footprint on the drafted floor plan. Fix them under Floor plan numbers, or confirm if they are right.");
assert.equal(box.locationFloorPlanCheckText(scene),"","nothing to check: nothing said");
box.turnContinuity={locations:quayList,scenes:[],drafts:{}};
hooks=[];cursor=0;effects=[];
let ed=box.LocationSpatialPlanEditor({l:vetrai,scenes:[],project:{},onUpdate:noop});
assert.match(text(flat(ed).find(n=>/loc-map-check/.test(cls(n)))),/^Check these positions: Mooring post/);
assert.equal(flat(ed).find(n=>n.type===box.LocationFloorPlanMap).props.spaceId,"vetrai","the map opens on the card's current space");
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};
hooks=[];cursor=0;effects=[];
ed=box.LocationSpatialPlanEditor({l:furnace,scenes:[],project:{},onUpdate:noop});
assert.ok(!flat(ed).some(n=>/loc-map-check/.test(cls(n))),"a confirmed layout with nothing far off: no note");
// a square room fixture keeps its square
const sq=box.locationFloorPlanScene(office,{...furnace.spatialPlan,coordinates:{...coordinates,spaces:[coordinates.spaces[1]],cameras:[]}});
assert.ok(Math.abs(box.locMapBox(sq.fit,343).H-343)<=2,"a square room draws square");
// Frances knows how the map reads
const aiSrc=read("app/ai.jsx");
assert.match(aiSrc,/listed as 'outside the plan \\u2014 check this position'/);
assert.match(aiSrc,/one row of TL TR BL BR buttons/);
assert.match(aiSrc,/the map opens on the space chosen in the card's Whole location \/ room picker/);
// the brand rule: no internal names in the map's copy
const mapSrc=read("app/locations-ui.jsx").slice(read("app/locations-ui.jsx").indexOf("const LOC_MAP_PAD"),read("app/locations-ui.jsx").indexOf("/* every floor plan number"));
assert.doesNotMatch(mapSrc,/"[^"]*\bTURN\b[^"]*"/);

// every number is an editable field
const changes=[];
const fields=box.LocationFloorPlanFields({plan:furnace.spatialPlan,family:[furnace,office],change:p=>changes.push(p),readOnly:false});
// LocCoordInput is a small component: find it by its label and commit through it, as leaving the field does
const input=label=>flat(fields).filter(n=>n.type===box.LocCoordInput&&n.props.label===label).map(n=>({props:{onBlur:e=>n.props.onCommit(e.target.value)}}));
input("Footprint corners")[1].props.onBlur({target:{value:"2, 4; 7, 4; 7, 8; 2, 8"}});
deq(changes[0].coordinates.spaces[1].footprint,[[2,4],[7,4],[7,8],[2,8]]);
input("Ceiling height")[0].props.onBlur({target:{value:"14"}});
assert.equal(changes[1].coordinates.spaces[0].ceilingH,14);
input("Facing")[0].props.onBlur({target:{value:"15"}});
assert.equal(changes[2].coordinates.cameras[0].yaw,15);
input("Centre")[0].props.onBlur({target:{value:"4.5, 4"}});
const op=changes[3].coordinates.spaces[1].openings[0];
deq(op.centre,[4.5,4]);assert.equal(op.yaw,null,"a moved opening's facing follows its new wall");
assert.equal(box.normalizeLocationSpatialPlan({...furnace.spatialPlan,...changes[3]}).coordinates.spaces[1].openings[0].yaw,180);
assert.ok(flat(fields).filter(n=>n.type===box.LocBasisSelect).length>=4,"each group's basis is a field");
assert.match(text(box.LocBasisSelect({value:"observed",onChange:noop})),/Read from a plate.*Stated in the screenplay.*Proposed design.*Set by hand/);
assert.ok(flat(fields).some(n=>n.type==="button"&&text(n)==="Add the bottom-left camera"));
const ro=box.LocationFloorPlanFields({plan:furnace.spatialPlan,family:[furnace,office],change:noop,readOnly:true});
assert.ok(flat(ro).filter(n=>["input","select","button"].includes(n.type)||n.type===box.LocCoordInput||n.type===box.LocBasisSelect).every(n=>n.props.disabled),"view only: nothing editable");
const bare=box.LocationFloorPlanFields({plan:box.normalizeLocationSpatialPlan({frame:"x",anchors:[]}),family:[furnace,office],change:p=>changes.push(p),readOnly:false});
flat(bare).find(n=>n.type==="button"&&text(n)==="Add Furnace Office to the floor plan").props.onClick();
deq(changes.at(-1).coordinates.spaces.map(s=>s.id),["office"]);

// the layout editor carries the map, the numbers and each object's position
hooks=[];cursor=0;effects=[];
const editor=box.LocationSpatialPlanEditor({l:office,scenes:[],project:{},onUpdate:noop});
const et=text(editor);
assert.match(et,/Top-down map/);
assert.ok(flat(editor).some(n=>n.type===box.LocationFloorPlanMap),"the map");
assert.ok(flat(editor).some(n=>n.type===box.LocationFloorPlanFields),"the numbers");
assert.ok(flat(editor).some(n=>n.type===box.LocCoordInput&&n.props.label==="Floor plan position"),"each object's position");
assert.ok(flat(editor).some(n=>n.type===box.LocCoordInput&&n.props.label==="Front faces"),"each object's front");
assert.match(et,/Floor plan numbers are approximate estimates for a 3D blockout — never a survey/);
assert.doesNotMatch(et,/not exact Blender coordinates/);
assert.match(read("app/locations-ui.jsx"),/Also drafts an approximate floor plan in metres \(footprints, windows and doors, object positions, each panel's camera\)/);
console.log("PASS floor plan: drafted metric plan with bases, floor-plan cameras, borrowed observed cameras, rooms seen from the main space, 'Layout changed — regenerate', the top-down map and editable numbers");

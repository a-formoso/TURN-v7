#!/usr/bin/env node
/* LOCATION COORDINATES, step B (owner-approved 2026-10-13, "go ahead with both, include the top-down map"):
   1. "Draft shared layout" also drafts an APPROXIMATE metric floor plan (footprints, openings, anchor positions,
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
  assert.match(prompt,/Do not invent metric dimensions in the prose fields/);
  assert.match(prompt,/\+Y = the facing named in your frame/);
  assert.match(prompt,/yaw = degrees clockwise from \+Y/);
  assert.match(prompt,/basis observed \(read from the panels\), script \(stated in the screenplay\) or design \(proposed\)/);
  assert.match(prompt,/for a room with no plate yet, propose cameras INSIDE it/);
  deq(proposal.coordinates.spaces.map(s=>[s.id,s.name]),[["office","Furnace Office"],["furnace","Furnace"]],"spaces named in the draft become this family's ids");
  assert.equal(proposal.coordinates.spaces[0].openings[0].connectsTo,"furnace");
  assert.equal(proposal.coordinates.spaces[0].openings[0].yaw,180);
  deq(proposal.coordinates.cameras.map(c=>[c.spaceId,c.panel,c.basis]),[["furnace","TR","observed"],["office","TL","design"]]);
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
assert.match(ui,/locationPlateLayoutChanged\(gen.genMeta, l, \{panels:true\}\)/);
assert.match(ui,/"Layout changed \\u2014 regenerate"/);
assert.equal((ui.match(/metaExtra:\(\{mode\}\)=> _withLayoutStamp\(l,mode,gen,/g)||[]).length,3,"the extra-space, state and room & time cards stamp it");
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

// the map component
let selected="";const flat=n=>!n||typeof n!=="object"?[]:[n,...(n.children||[]).flatMap(flat)];
const text=n=>n==null||n===false?"":typeof n!=="object"?String(n):(n.children||[]).map(text).join("");
let map=box.LocationFloorPlanMap({scene,selected:"",onSelect:v=>selected=v});
const svg=flat(map).find(n=>n.type==="svg");
assert.ok(svg&&/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(svg.props.viewBox));
assert.match(svg.props["aria-label"],/Top-down map/);
assert.equal(flat(svg).filter(n=>n.type==="polygon").length,2+scene.cameras.length);
const chip=flat(map).find(n=>n.type==="button"&&/Furnace · top-left/.test(text(n)));
chip.props.onClick();assert.equal(selected,"furnace:TL");
map=box.LocationFloorPlanMap({scene,selected:"furnace:TL",onSelect:v=>selected=v});
assert.match(text(map),/Furnace · top-left: Camera at x 0 m, y -8 m, 1\.6 m up, facing north \(0°\), level, 24 mm lens\. Field of view 74°\. From the floor plan\./);
assert.ok(flat(map).some(n=>n.type==="g"&&/loc-map-cam on/.test(n.props.className||"")),"its frustum is highlighted");
assert.ok(flat(map).some(n=>n.type==="g"&&/dim/.test(n.props.className||"")),"the others step back");
assert.match(text(map),/Approximate — estimated from the plates and the screenplay, not surveyed/);
assert.match(text(map),/no position/);
assert.match(text(box.LocationFloorPlanMap({scene:{empty:true}})),/No floor plan numbers yet/);

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

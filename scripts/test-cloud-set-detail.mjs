/* Saved-plan detail invariants; no renderer, account or model call. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const box={console,crypto,TextEncoder,URL,location:{hostname:"localhost"},turnIsAdmin:true,
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};box.window=box;
vm.createContext(box);
for(const file of ["locations.jsx","blender-render-contract.js","blender-set-detail.js","blender-render.js"])
  vm.runInContext(readFileSync(new URL("../app/"+file,import.meta.url),"utf8"),box);
const fixture={id:"deck",key:"deck",name:"Ferry - CAR Deck",spatialPlan:{status:"reviewed",source:{assetId:"deck",iso:""},frame:"Bow is north",
  anchors:[
    {id:"stern-ramp",name:"Hinged steel stern ramp",xy:[0,0],z:1.9,size:[6,.25,3.8],facing:180},
    {id:"lane-markings",name:"Painted lane lines and arrows",xy:[0,15],z:.006,size:[.15,30,.012],facing:0},
    {id:"hose-cabinet",name:"Red fire-hose reel cabinet",xy:[7,9],z:1.2,size:[.8,.35,1],facing:270},
    {id:"vent-trunk",name:"Vertical ventilation trunk",xy:[6.5,16],z:2,size:[1.2,1,4],facing:270},
    {id:"deck-number",name:"Stencilled deck number",xy:[-7,9],z:2,size:[1.2,.03,1.6],facing:90},
    {id:"wheel-chocks",name:"Wheel chocks",xy:[-5.5,10],z:.09,size:[.25,.3,.18],facing:0},
    {id:"sodium-lights",name:"Sodium-vapour fittings",xy:[0,15],z:3.6,size:[.35,.6,.2],facing:0},
  ].map(a=>({...a,space:"Ferry - CAR Deck",placement:"Saved placement",sizeBasis:"design",posBasis:"design"})),
  coordinates:{spaces:[{id:"deck",name:"Ferry - CAR Deck",floorZ:0,ceilingH:4,footprint:[[-7,0],[7,0],[7,40],[-7,40]],
    openings:[
    // The aperture and the solid moving ramp are separate records: a door opening is not a solid ramp.
    {id:"stern-aperture",name:"Stern opening",kind:"door",centre:[0,0],width:6,sillZ:0,headZ:3.8},
      {id:"stair-door",name:"Stair door",kind:"door",centre:[-7,12],width:.9,sillZ:.1,headZ:2}]}],
    cameras:[{panel:"TL",position:[0,.6,1.6],yaw:35,pitch:0,lensMm:24},{panel:"TR",position:[-6.2,1,2.8],yaw:19,pitch:-8,lensMm:20},
      {panel:"BL",position:[4.8,8,1.6],yaw:210,pitch:-6,lensMm:24},{panel:"BR",position:[0,16.8,1.6],yaw:180,pitch:-4,lensMm:24}].map(c=>({...c,spaceId:"deck"}))}}};
box.turnContinuity={locations:[fixture]};
const before=JSON.stringify(fixture),detail=box.KinolotSetDetail.build;
box.KinolotSetDetail.build=s=>s;const basic=box.KinolotCloudRender.buildScene(fixture);
box.KinolotSetDetail.build=detail;const rich=box.KinolotCloudRender.buildScene(fixture);
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),label);checks++;};
const check=(value,label)=>{assert.ok(value,label);checks++;};
equal(JSON.stringify(fixture),before,"Building richer geometry never edits the saved film");
equal(rich.cameras,basic.cameras,"All four saved cameras remain exact");
for(const original of basic.objects){
  const current=rich.objects.find(o=>o.id===original.id);
  check(current,"Every saved shape keeps its identity");
  equal(current.position,original.position,"Original anchor and room centres stay fixed");
  equal(current.rotation,original.rotation,"Original facing stays fixed");
  if(!original.anchorId)equal(current.size,original.size,"Saved footprints, wall cuts and ceiling dimensions stay fixed");
}
check(rich.objects.length>basic.objects.length&&rich.objects.length<500,"Detail fits the worker's bounded shape budget");
check(new TextEncoder().encode(box.KinolotRenderContract.canonical(rich)).length<=131072,"The detailed set fits the existing transport limit");
check(Object.keys(rich.materials).length<=32&&rich.previewLights.length<=16,"The existing material and light budgets are respected");
check(rich.objects.some(o=>o.name==="Raised ramp rib")&&rich.objects.some(o=>o.name==="Weathertight door jamb"),"Structure and saved openings have recognisable detail");
check(rich.objects.find(o=>o.anchorId==="wheel-chocks").kind==="wedge","Chocks have a shaped profile");
check(rich.notes.some(n=>n.includes("proposed within the saved deck")),"Repeated detail and lane spacing are disclosed as design proposals");
const doorFrames=rich.objects.filter(o=>o.id.startsWith("detail-door-"));
check(doorFrames.every(o=>o.kind!=="prism")&&!doorFrames.some(o=>o.name.includes("leaf")),"Door detailing does not silently close the saved opening");
const lamps=rich.objects.filter(o=>o.name==="Warm practical lamp diffuser");
check(lamps.length>1&&lamps.every(o=>o.position[1]>=1&&o.position[1]<=39),"Repeated practicals remain inside the saved deck length");
equal(rich,box.KinolotCloudRender.buildScene(fixture),"Identical saved data produces an identical detailed set");
const updated=structuredClone(fixture);updated.spatialPlan.anchors.find(a=>a.id==="hose-cabinet").size[0]=1.2;
const wider=box.KinolotCloudRender.buildScene(updated,[updated]);
const doorWidth=s=>s.objects.find(o=>o.name==="Red hose cabinet door").size[0];
check(Math.abs(doorWidth(wider)/doorWidth(rich)-1.5)<.00001,"Fixture assemblies scale from saved dimensions rather than prototype constants");
const lowered=structuredClone(fixture);lowered.spatialPlan.anchors[0].size=[6,3.8,.25];lowered.spatialPlan.anchors[0].z=.125;
check(!box.KinolotCloudRender.buildScene(lowered,[lowered]).objects.some(o=>o.name==="Raised ramp rib"),"A saved lowered ramp is not turned into the raised-ramp assembly");
const clockwise=structuredClone(fixture);clockwise.spatialPlan.coordinates.spaces[0].footprint.reverse();
const reverse=box.KinolotCloudRender.buildScene(clockwise,[clockwise]);
check(reverse.objects.filter(o=>o.name==="Lower painted bulkhead").every(o=>o.position[0]>-7&&o.position[0]<7&&o.position[1]>0&&o.position[1]<40),
  "Interior wall finishes stay inside a footprint saved in clockwise order");
const ordinary=structuredClone(fixture);ordinary.name="Ordinary room";ordinary.spatialPlan.anchors=ordinary.spatialPlan.anchors.map(a=>({...a,space:ordinary.name}));ordinary.spatialPlan.coordinates.spaces[0].name=ordinary.name;
check(!box.KinolotCloudRender.buildScene(ordinary,[ordinary]).objects.some(o=>o.name==="Raised ramp rib"),"Car-deck detail is not applied to an unrelated room");
console.log("PASS cloud set detail: "+checks+" saved-geometry, camera, aperture, dimension, determinism and budget checks; "+rich.objects.length+" shapes");

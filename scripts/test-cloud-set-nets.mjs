/* Shared sports-net geometry: actual saved-plan builder, disposable data, no network or saved-film writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
const compiled=process.env.NET_TEST_DIST==='1',b={console,crypto,TextEncoder,URL,location:{hostname:'localhost'},turnIsAdmin:true,
  nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ['locations.jsx','blender-render-contract.js','blender-set-detail.js','blender-render.js'])
  vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8'),b);
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const room={id:'gym',key:'gym',name:'Test school gym',spatialPlan:{status:'reviewed',heights:'centre',source:{assetId:'gym',iso:''},frame:'North',
  anchors:[{id:'net',name:'Volleyball net',space:'Test school gym',placement:'Across centre court',xy:[0,10],z:1.2,size:[8,.1,2.4],facing:0,sizeBasis:'user'}],
  coordinates:{spaces:[{id:'gym',name:'Test school gym',floorZ:0,ceilingH:6,footprint:[[-6,0],[6,0],[6,20],[-6,20]],openings:[]}],
    cameras:[{panel:'TL',position:[-4,2,1.6],yaw:20,pitch:0,lensMm:24},{panel:'TR',position:[4,3,3],yaw:340,pitch:-8,lensMm:24},
      {panel:'BL',position:[-4,18,1.6],yaw:160,pitch:0,lensMm:24},{panel:'BR',position:[4,18,1.6],yaw:200,pitch:0,lensMm:24}].map(c=>({...c,spaceId:'gym'}))}}};
function build(l){b.turnContinuity={locations:[l]};return b.KinolotCloudRender.buildScene(l);}
const before=JSON.stringify(room),scene=build(room),parts=scene.objects.filter(o=>o.anchorId==='net');
ok(JSON.stringify(room)===before,'Building a net never edits the saved film');
ok(parts.length>10&&parts.length<65,'A named court net becomes bounded mesh detail');
ok(!parts.some(o=>o.size[0]===8&&o.size[2]===2.4),'The original solid panel is removed');
ok(parts.some(o=>o.name.includes('vertical mesh strand'))&&parts.some(o=>o.name.includes('horizontal mesh strand')),'The net has intersecting strands with real gaps');
ok(parts.filter(o=>o.name.includes('mesh strand')).every(o=>o.position[2]-o.size[2]/2>=1.5-.00001),'Proposed court net leaves space below the mesh');
ok(parts.reduce((v,o)=>v+o.size.reduce((a,n)=>a*n,1),0)<8*.1*2.4*.2,'Most of the old solid panel volume is open');
ok(parts.every(o=>Math.abs(o.position[0])+o.size[0]/2<=4.00001&&Math.abs(o.position[1]-10)+o.size[1]/2<=.05001&&Math.abs(o.position[2]-1.2)+o.size[2]/2<=1.20001),'All geometry stays in the saved net envelope');
ok(JSON.stringify(scene)===JSON.stringify(build(room)),'The same saved net produces identical geometry');
ok(scene.notes.some(n=>n.includes('Sports nets use open mesh')),'Proposed mesh detail is disclosed');
const explicit=structuredClone(room);explicit.spatialPlan.anchors[0].name='Central divider';explicit.spatialPlan.anchors[0].renderShape='sports-net';
ok(build(explicit).objects.filter(o=>o.anchorId==='net').length>10,'An explicit net choice works without name guessing');
const block=structuredClone(room);block.spatialPlan.anchors[0].renderShape='box';
ok(build(block).objects.filter(o=>o.anchorId==='net').length===1,'An explicit solid block overrides automatic recognition');
const unsupported=structuredClone(room);unsupported.spatialPlan.anchors[0].name='Complex equipment';
ok(build(unsupported).notes.some(n=>n.startsWith('Simplified solid blocks:')),'Unclassified proxies are disclosed for review');
for(const name of ['Basketball net','Netball court','Net storage cabinet','Rack beside volleyball net'])
  ok(b.KinolotSetDetail.anchorShape({name})==='box','Unrelated object is not silently turned into a sports net: '+name);
const turned=structuredClone(room);turned.spatialPlan.anchors[0].facing=90;
const rotated=build(turned).objects.filter(o=>o.anchorId==='net');
ok(rotated.every(o=>Math.abs(o.position[0])<=.00001&&Math.abs(o.position[1]-10)<=4),'Saved facing rotates the mesh around its saved centre');
const yNet=structuredClone(room);yNet.spatialPlan.anchors[0].size=[.1,8,2.4];
ok(build(yNet).objects.filter(o=>o.anchorId==='net').some(o=>o.name.includes('top tape')&&o.size[1]===8),'A net whose saved long axis is Y is not reoriented to X');
const normalized=b.normalizeLocationSpatialPlan(explicit.spatialPlan);
ok(normalized.anchors[0].renderShape==='sports-net','Explicit shape survives plan normalization and persistence');
explicit.spatialPlan.anchors[0].netMeshHeight=.6;
ok(build(explicit).objects.find(o=>o.name.includes('vertical mesh strand')).size[2]===.6,'An explicit mesh height replaces the proposed mesh height');
ok(b.normalizeLocationSpatialPlan(explicit.spatialPlan).anchors[0].netMeshHeight===.6,'Mesh height survives plan normalization');
explicit.spatialPlan.anchors[0].netMeshHeight=3;
assert.throws(()=>build(explicit),/must not exceed/);checks++;
const oldSig=b.locationSpatialPlanSig(room.spatialPlan),newSig=b.locationSpatialPlanSig(explicit.spatialPlan);
ok(oldSig!==newSig,'Changing representation invalidates old plan signatures');
const tiny=structuredClone(room);tiny.spatialPlan.anchors[0].size=[.01,.01,.01];tiny.spatialPlan.anchors[0].z=.005;
ok(build(tiny).objects.filter(o=>o.anchorId==='net').length>1,'Minimum-sized shapes obey the existing worker dimension limits');
ok(scene.objects.every(o=>['box','prism','cylinder','torus','wedge'].includes(o.kind)),'No worker upgrade or executable scene instructions are required');
if(process.env.NET_TEST_SCENE)writeFileSync(process.env.NET_TEST_SCENE,JSON.stringify(scene,null,2));
console.log('PASS sports nets: '+checks+' shared geometry, envelope, orientation, override, persistence and approximation checks');

import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expandInventory,inspectInventory} from './inventory.mjs';
const root = new URL('../../',import.meta.url);
const b={console,crypto,TextEncoder,URL,location:{hostname:'localhost'},turnIsAdmin:true,nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};
b.window=b; vm.createContext(b);
for (const name of ['locations.jsx','blender-render-contract.js','blender-set-kitchen.js','blender-set-detail.js','blender-render.js','camera-angle-preview.js'])
  vm.runInContext(readFileSync(new URL('app/'+name,root),'utf8'),b);
const T=await import(new URL('app/vendor/three/r180/three.module.min.js',root));
const copy=value=>JSON.parse(JSON.stringify(value));
let checks=0;
const ok=(condition,message)=>{assert.ok(condition,message);checks++;};
const throws=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
function room(id,objectName,size=[.45,.5,.9]) {
  const location={id,name:id,spatialPlan:{status:'reviewed',frame:'North',heights:'centre',source:{assetId:id,iso:''},
    anchors:[{id:'template',name:objectName,space:id,placement:'Measured template',xy:[1,2],z:size[2]/2,size,facing:0,sizeBasis:'user'}],
    coordinates:{spaces:[{id,name:id,footprint:[[0,0],[14,0],[14,18],[0,18]],floorZ:0,ceilingH:4,openings:[]}]}}};
  location.coverageViews=['TL','TR','BL','BR'].map((panel,i)=>({id:'camera-'+panel,panel,pose:{position:[7,i%2?16:1,1.6],yaw:i%2?180:0,pitch:-5,lensMm:24,basis:'user'}}));
  return location;
}
function build(location) {b.TURN_SUPABASE={setBuild:true,setBuildMcp:true};b.turnContinuity={locations:[location]};return copy(b.KinolotCloudRender.buildScene(location,[location]));}
const fixtures=[
  {name:'classroom',object:'Wooden chair',quantity:30,columns:5,columnStep:[1.2,0,0],rowStep:[0,1.4,0]},
  {name:'cafe',object:'Dining table',size:[.9,.7,.75],quantity:12,columns:3,columnStep:[2,0,0],rowStep:[0,2,0]},
  {name:'dormitory',object:'Single bed',size:[1,2,.9],quantity:8,columns:2,columnStep:[5,0,0],rowStep:[0,3,0]},
  {name:'changing-room',object:'Wardrobe',size:[.8,.6,1.9],quantity:10,columns:5,columnStep:[1.1,0,0],rowStep:[0,3,0]},
  {name:'dining-room',object:'Wooden chair',quantity:8,columns:4,columnStep:[1.3,0,0],rowStep:[0,3,0],rotationRadians:Math.PI},
];
const results=[];
for (const fixture of fixtures) {
  const location=room(fixture.name,fixture.object,fixture.size), saved=JSON.stringify(location), original=build(location);
  const group={id:fixture.name,templateAnchorId:'template',quantity:fixture.quantity,columns:fixture.columns,
    origin:[1,2,(fixture.size||[.45,.5,.9])[2]/2],columnStep:fixture.columnStep,rowStep:fixture.rowStep,rotationRadians:fixture.rotationRadians||0};
  const groups=[group], complete=expandInventory(original,groups,b.KinolotRenderContract.validateScene);
  const report=inspectInventory(complete,original,groups,b.KinolotRenderContract.validateScene);
  ok(report.status==='passed',fixture.name+' inventory agrees with its independent requirements');
  ok(JSON.stringify(complete)===JSON.stringify(expandInventory(original,groups,b.KinolotRenderContract.validateScene)),fixture.name+' rebuild is deterministic');
  ok(JSON.stringify(location)===saved,fixture.name+' saved plan never changes');
  ok(original.objects.filter(item=>item.anchorId==='template').length>1,fixture.name+' uses real furniture assemblies');
  const rig=b.KinolotAnglePreview.sceneFor(T,complete);
  ok(rig.meshes.length===complete.objects.length,fixture.name+' actual preview can construct every emitted part');
  rig.dispose();
  const missing=copy(complete);missing.objects=missing.objects.filter(item=>item.id!==complete.objects.at(-1).id);
  ok(inspectInventory(missing,original,groups,b.KinolotRenderContract.validateScene).status==='failed',fixture.name+' missing component refuses a complete result');
  const moved=copy(complete);moved.objects.at(-1).position[0]+=.1;
  ok(inspectInventory(moved,original,groups,b.KinolotRenderContract.validateScene).status==='failed',fixture.name+' altered placement is detected');
  const changed=copy(complete);changed.cameras.TL.yaw+=5;
  ok(inspectInventory(changed,original,groups,b.KinolotRenderContract.validateScene).status==='failed',fixture.name+' unintended camera edit is detected');
  results.push({location:fixture.name,requiredUnits:group.quantity,completeUnits:report.counts[0].complete,objects:complete.objects.length,status:report.status});
}
const unknown=room('unsupported','Wheelchair');
throws(()=>expandInventory(build(unknown),[{id:'chairs',templateAnchorId:'template',quantity:4,columns:2,origin:[1,2,.45],columnStep:[2,0,0],rowStep:[0,2,0],rotationRadians:0}],b.KinolotRenderContract.validateScene),/unassembled/);
const fixture=room('budget','Wooden chair'), original=build(fixture);
const group={id:'chairs',templateAnchorId:'template',quantity:500,columns:10,origin:[1,2,.45],columnStep:[2,0,0],rowStep:[0,2,0],rotationRadians:0};
throws(()=>expandInventory(original,[group],b.KinolotRenderContract.validateScene),/object budget/);
for(const quantity of [0,-1,NaN,2.5,501])throws(()=>expandInventory(original,[{...group,quantity}],b.KinolotRenderContract.validateScene),/count/);
throws(()=>expandInventory(original,[{...group,quantity:2,columns:2,columnStep:[NaN,0,0]}],b.KinolotRenderContract.validateScene),/finite/);
const many=copy(fixture.spatialPlan);many.anchors=Array.from({length:30},(_,i)=>({...many.anchors[0],id:'chair-'+i}));
ok(b.normalizeLocationSpatialPlan(many).anchors.length===24,'The current story-anchor limit is independently reproduced');
const report={status:'passed',checks,scope:'Offline explicit-inventory feasibility only; no image read, cloud render, account changes or deployment.',fixtures:results,
  limitations:['Inventories in this experiment are supplied explicitly, not extracted from natural language.','Only existing furniture assemblies are exercised; unsupported solid-block templates are rejected.','Spacing, wall bounds, camera composition, photometric lighting and styling fidelity are not established by this test.','This prototype is not wired to the app or render service.']};
if(process.argv[2]) {mkdirSync(process.argv[2],{recursive:true});writeFileSync(fileURLToPath(new URL('feasibility.json','file://'+process.argv[2].replace(/\/$/,'')+'/')),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));

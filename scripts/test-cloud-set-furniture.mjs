/* Actual shared scene builder, disposable furniture only; no account or network calls. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
const compiled=process.env.FURNITURE_TEST_DIST==='1',b={console,crypto,TextEncoder,URL,location:{hostname:'localhost'},turnIsAdmin:true,
 nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ['locations.jsx','blender-render-contract.js','blender-set-detail.js','blender-render.js'])vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8'),b);
const copy=x=>JSON.parse(JSON.stringify(x));let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++;};
const same=(a,c,message)=>{assert.deepEqual(copy(a),copy(c),message);checks++;};
const room={id:'bedroom',key:'bedroom',name:'Furniture test bedroom',spatialPlan:{status:'reviewed',heights:'centre',source:{assetId:'bedroom',iso:''},frame:'North',
 anchors:[{id:'bed',name:'Single bed',xy:[1.1,3.325],z:.45,size:[1,2,.9],facing:180},
  {id:'desk',name:'Study desk',xy:[3.25,3.3],z:.375,size:[1.2,.65,.75]},
  {id:'chair',name:'Wooden chair',xy:[3.25,2.55],z:.45,size:[.45,.5,.9]},
  {id:'nightstand',name:'Bedside cabinet',xy:[.4,4.0],z:.25,size:[.45,.45,.5]},
  {id:'wardrobe',name:'Wardrobe',xy:[3.45,.65],z:1,size:[.9,.6,2]}].map(a=>({...a,space:'Furniture test bedroom',placement:'Saved floor plan',sizeBasis:'user',posBasis:'user'})),
 coordinates:{spaces:[{id:'bedroom',name:'Furniture test bedroom',footprint:[[0,0],[4,0],[4,4.4],[0,4.4]],floorZ:0,ceilingH:2.6,
  openings:[{id:'window',name:'Bedroom window',kind:'window',centre:[0,3.1],width:1.3,sillZ:.8,headZ:2.1},
   {id:'door',name:'Bedroom door',kind:'door',centre:[1.5,0],width:.85,sillZ:0,headZ:2.1}]}]}}};
b.turnContinuity={locations:[room]};
const before=JSON.stringify(room),proposal=b.KinolotCloudRender.proposeCameras(room);
ok(JSON.stringify(room)===before,'Suggestions never edit saved data');
room.coverageViews=copy(b.KinolotCloudRender.cameraProposalViews(room,proposal));
b.turnContinuity={locations:[room]};
const saved=JSON.stringify(room),scene=b.KinolotCloudRender.buildScene(room),detail=b.KinolotSetDetail.build;
b.KinolotSetDetail.build=s=>s;const basic=b.KinolotCloudRender.buildScene(room);b.KinolotSetDetail.build=detail;
ok(JSON.stringify(room)===saved,'Building furniture never edits the saved floor plan');
same(scene.cameras,basic.cameras,'Furniture cannot silently reframe saved cameras');
same(scene,b.KinolotCloudRender.buildScene(room),'One saved set gives deterministic geometry for every view');
for(const anchor of room.spatialPlan.anchors){
 const parts=scene.objects.filter(o=>o.anchorId===anchor.id);
 ok(parts.length>1,'Named furniture has a recognisable assembly: '+anchor.name);
 ok(parts.every(o=>o.basis==='design'),'Internal furniture detail is disclosed as design, not a measurement');
 const parent=basic.objects.find(o=>o.anchorId===anchor.id);
 for(const part of parts){
  // Inverse saved rotation. Part boxes/prisms have the same orientation as their anchor.
  const angle=parent.rotation[2],dx=part.position[0]-parent.position[0],dy=part.position[1]-parent.position[1];
  const local=[Math.cos(angle)*dx+Math.sin(angle)*dy,-Math.sin(angle)*dx+Math.cos(angle)*dy,part.position[2]-parent.position[2]];
  ok(local.every((v,i)=>Math.abs(v)+part.size[i]/2<=parent.size[i]/2+.00001),'Every furniture part stays within the saved object envelope');
 }
}
for(const o of basic.objects.filter(o=>!o.anchorId))same(scene.objects.find(p=>p.id===o.id),o,'Room walls and openings stay exact');
ok(scene.objects.some(o=>o.name.includes('mattress'))&&scene.objects.some(o=>o.name.includes('pillow 1')),'The bed includes an actual mattress and pillow silhouette');
ok(!scene.objects.some(o=>o.anchorId==='desk'&&o.size[2]===.75),'The desk no longer fills the space between its legs');
const block=copy(room);block.spatialPlan.anchors[0].renderShape='box';
ok(b.KinolotCloudRender.buildScene(block,[block]).objects.filter(o=>o.anchorId==='bed').length===1,'Explicit Solid block always wins');
for(const shape of ['bed','pillow','nightstand','wardrobe','table','chair']){
 const explicit=copy(room);explicit.spatialPlan.anchors[0].renderShape=shape;explicit.spatialPlan.anchors[0].name='Chosen furniture';
 ok(b.normalizeLocationSpatialPlan(explicit.spatialPlan).anchors[0].renderShape===shape,'Shape choice persists: '+shape);
 ok(b.KinolotCloudRender.buildScene(explicit,[explicit]).objects.some(o=>o.anchorId==='bed'&&o.id.includes('furniture')),'Explicit shape works without name matching: '+shape);
}
for(const name of ['Cabinet beside the bed','Lamp above desk','Bunk bed','Bed frame','Office chair','Table lamp','Dressing table','Desk and chair'])
 ok(b.KinolotSetDetail.anchorShape({name})==='box','Ambiguous or unsupported name is not misclassified: '+name);
for(const facing of [45,90,180,270]){
 const turned=copy(room);turned.spatialPlan.anchors[0].facing=facing;
 const parts=b.KinolotCloudRender.buildScene(turned,[turned]).objects.filter(o=>o.anchorId==='bed');
 ok(parts.every(p=>Math.abs(p.rotation[2]+facing*Math.PI/180)<.000001),'Saved facing applies to every bed component');
}
const wideBed=copy(room);wideBed.spatialPlan.anchors[0].size=[2,1,.9];
const wideParts=b.KinolotCloudRender.buildScene(wideBed,[wideBed]).objects.filter(o=>o.anchorId==='bed');
ok(wideParts.find(o=>o.name.includes('headboard')).size[0]<wideParts.find(o=>o.name.includes('headboard')).size[1],'A bed along local X keeps its long axis instead of silently turning its envelope');
const tiny=copy(room);tiny.spatialPlan.anchors[0].size=[.01,.01,.01];
ok(b.KinolotCloudRender.buildScene(tiny,[tiny]).objects.filter(o=>o.anchorId==='bed').length===1,'Too-small envelopes retain a valid proxy instead of invalid sub-millimetre parts');
const pillow=copy(room);pillow.spatialPlan.anchors.push({id:'pillow',name:'Pillow',space:room.name,placement:'On bed',xy:[1.1,4.0],z:.64,size:[.5,.3,.12]});
ok(!b.KinolotCloudRender.buildScene(pillow,[pillow]).objects.some(o=>o.anchorId==='bed'&&o.name.includes('pillow')),'A separately saved pillow is not duplicated inside the bed assembly');
const bare=copy(room);bare.spatialPlan.anchors[0].placement='Bare bed, no pillow, no headboard';
ok(!b.KinolotCloudRender.buildScene(bare,[bare]).objects.some(o=>o.anchorId==='bed'&&o.name.includes('pillow')),'Explicit no-pillow instructions suppress proposed bedding');
ok(!b.KinolotCloudRender.buildScene(bare,[bare]).objects.some(o=>o.anchorId==='bed'&&o.name.includes('headboard')),'Explicit no-headboard instructions suppress proposed joinery');
ok(scene.objects.length<500&&new TextEncoder().encode(b.KinolotRenderContract.canonical(scene)).length<=131072,'Furniture remains inside the unchanged worker budgets');
// Wide views cover several landmarks; detail views put their selected subject near frame centre.
const first=scene.cameras.TL.position,reverse=scene.cameras.TR.position;
ok(Math.hypot((first[0]-reverse[0])/4,(first[1]-reverse[1])/4.4)>.5,'The second wide camera is separated from the first instead of repeating its corner');
for(const [panel,camera] of Object.entries(scene.cameras)){
 const yaw=camera.yaw*Math.PI/180,pitch=camera.pitch*Math.PI/180;
 const dir=[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)];
 const right=[Math.cos(yaw),-Math.sin(yaw),0],up=[-Math.sin(yaw)*Math.sin(pitch),-Math.cos(yaw)*Math.sin(pitch),Math.cos(pitch)];
 const inFrame=(point,margin=1)=>{const v=point.map((n,i)=>n-camera.position[i]),dot=a=>a.reduce((sum,n,i)=>sum+n*v[i],0),depth=dot(dir);
  return depth>0&&Math.abs(dot(right))<depth*18/camera.lensMm*margin&&Math.abs(dot(up))<depth*10.125/camera.lensMm*margin;};
 const planned=proposal.panels.find(p=>p.key===panel);
 if(planned.role!=="detail"){
  const landmarks=[...room.spatialPlan.anchors.map(a=>({name:a.name,point:[...a.xy,a.z]})),
   ...room.spatialPlan.coordinates.spaces[0].openings.map(o=>({name:o.name,point:[...o.centre,(o.sillZ+o.headZ)/2]}))];
  const seen=landmarks.filter(a=>inFrame(a.point));
  ok(seen.length>=2,'Wide '+panel+' includes multiple saved room landmarks; saw '+seen.map(a=>a.name).join(', ')+' from '+JSON.stringify(camera));
 }else{
  const target=room.spatialPlan.anchors.find(a=>a.id===planned.targetId);
  ok(!!target&&[-.5,0,.5].some(z=>inFrame([...target.xy,target.z+z*target.size[2]],.55)),'Each detail centres part of its chosen saved furniture subject');
 }
}

// A loose test arrangement must not produce an establishing shot directly behind the headboard.
const loose=copy(room);loose.coverageViews=[];loose.spatialPlan.anchors[0].xy=[1.1,2.6];loose.spatialPlan.anchors[0].facing=0;
const looseProposal=b.KinolotCloudRender.proposeCameras(loose,[loose]),eye=looseProposal.panels.find(p=>p.key==='TL').pose.position;
ok(eye[1]-2.6>=-Math.abs(eye[0]-1.1),'First wide avoids a head-on view from behind the bed headboard when a clear side is available');
ok(Math.hypot(eye[0]-1.1,eye[1]-2.6)>2,'First wide keeps enough distance to show the bed in context');
ok(['TL','TR','BL'].every(k=>scene.cameras[k].lensMm>=18),'Context cameras fit furniture without resorting to extreme wide lenses when space is available');

if(process.env.FURNITURE_TEST_SCENE)writeFileSync(process.env.FURNITURE_TEST_SCENE,JSON.stringify(scene,null,2));
console.log('PASS furniture: '+checks+' geometry, identity, envelope, camera, override, persistence and determinism checks; '+scene.objects.length+' shapes');

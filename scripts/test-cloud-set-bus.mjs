/* Complete a stated bus row pattern without using images or editing the saved plan. */
import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const compiled=process.env.BUS_TEST_DIST==='1',read=f=>readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8');
const b={console,crypto,TextEncoder,URL,location:{hostname:'localhost'},turnIsAdmin:true,nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ['locations.jsx','blender-render-contract.js','blender-set-kitchen.js','blender-set-detail.js','blender-render.js','camera-angle-preview.js','camera-framing.js','camera-match.js'])vm.runInContext(read(f),b);
const copy=x=>JSON.parse(JSON.stringify(x));let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;},same=(a,c,m)=>{assert.deepEqual(copy(a),copy(c),m);checks++;},throws=(f,re)=>{assert.throws(f,re);checks++;};
const anchor=(id,name,xy,z,size,placement='Written layout')=>({id,name,xy,z,size,placement,space:'Test bus',sizeBasis:'user',facing:0});
const l={id:'bus',name:'Test bus',architecture:'A bus with a curved ceiling. Twelve rows on each side: L1 to L12 and R1 to R12.',keySizes:'Row pitch about 0.7 m.',
 spatialPlan:{status:'reviewed',frame:'North is front',heights:'centre',source:{assetId:'bus',iso:''},anchors:[
  anchor('bench-L6','West story bench, row 6',[-.68,5],.5,[.9,.6,1]),anchor('bench-L9','West story bench, row 9',[-.68,2.9],.5,[.9,.6,1]),anchor('bench-R6','East story bench, row 6',[.68,5],.5,[.9,.6,1]),
  anchor('driver','Driver seat and dash',[-.55,10.1],.6,[.9,1.1,1.2]),anchor('ceiling-light','Centre line of fluorescent strips',[0,5.5],2.17,[.15,10,.04]),
  anchor('shelves','Parcel shelves',[0,5],1.7,[2.4,8,.05],'One above each window band'),
  anchor('rear-door','Rear emergency door',[0,0],.85,[.6,.08,1.7]),anchor('windshield','Front windshield',[0,11],1.2,[2.1,.06,.8]),
  anchor('window-west','West window band',[-1.2,5],1.15,[9.2,.05,.7]),anchor('window-east','East window band',[1.2,5],1.15,[9.2,.05,.7])],
 coordinates:{spaces:[{id:'bus',name:'Test bus',footprint:[[-1.2,0],[1.2,0],[1.2,11],[-1.2,11]],floorZ:0,ceilingH:2.2,openings:[
  {id:'rear-door',name:'Rear exit aperture',kind:'door',edge:0,centre:[0,0],width:.6,sillZ:0,headZ:1.7},
  {id:'windshield',name:'Windshield aperture',kind:'window',edge:2,centre:[0,11],width:2.1,sillZ:.8,headZ:1.6},
  {id:'window-west',name:'West windows',kind:'window',edge:3,centre:[-1.2,5],width:9.2,sillZ:.8,headZ:1.5},
  {id:'window-east',name:'East windows',kind:'window',edge:1,centre:[1.2,5],width:9.2,sillZ:.8,headZ:1.5}]}]}}};
l.spatialPlan.anchors.find(a=>a.id==='window-west').facing=270;l.spatialPlan.anchors.find(a=>a.id==='window-east').facing=90;
l.coverageViews=['TL','TR','BL','BR'].map((panel,i)=>({id:'camera-'+panel,panel,pose:{position:[0,i%2?9.5:.5,1.5],yaw:i%2?180:0,pitch:-7,lensMm:24,basis:'user'}}));
function build(data,detailed=true){b.TURN_SUPABASE={setBuild:true,setBuildMcp:detailed};b.turnContinuity={locations:[data]};return b.KinolotCloudRender.buildScene(data,[data]);}
const saved=JSON.stringify(l),scene=build(l),seats=scene.objects.filter(o=>o.name.endsWith('seat cushion'));
ok(seats.length===24,'Twelve explicitly stated rows on each side produce twenty-four bench units');
ok(JSON.stringify(l)===saved,'Building the full bus never changes saved anchors, cameras or source bindings');
ok(scene.objects.length<=500&&Buffer.byteLength(JSON.stringify(scene))<262144,'The full bus fits the existing worker and queue limits');
for(const a of l.spatialPlan.anchors.filter(a=>/^bench-/.test(a.id))){
 const parts=scene.objects.filter(o=>o.anchorId===a.id);ok(parts.length===9,'The named story bench retains its identity with visible cushion and support geometry');
 for(const p of parts)ok(p.position.every((v,i)=>Math.abs(v-[...a.xy,a.z][i])+p.size[i]/2<=a.size[i]/2+.000001),'Bench components remain inside the saved story-bench envelope');
}
ok(scene.objects.filter(o=>o.name.includes('curved ceiling')).length===1,'The written curved roof has actual arched geometry');
ok(scene.objects.some(o=>o.name.endsWith('steering wheel'))&&scene.objects.some(o=>o.name.endsWith('dashboard')),'The driver bay contains separate controls rather than a solid proxy');
ok(scene.objects.some(o=>o.name.endsWith('door leaf')),'The stated emergency door has a leaf instead of an empty full-height hole');
ok(scene.previewLights.length>1&&scene.previewLights.length<=16,'The stated light line distributes its sources within the existing light limit');
const power=scene.previewLights.reduce((n,l)=>n+l.powerWatts,0);ok(Math.abs(power-211.2)<.001,'Distributed preview lights retain the room light budget');
same(scene,build(l),'The complete bus is deterministic');
const old=copy(l);old.architecture='A bus with unspecified benches.';
ok(!build(old).objects.some(o=>o.id.startsWith('bus-repeat-')),'An unstated row count is never invented');
const compact=copy(l);compact.architecture=compact.architecture.replace('L1 to L12','L1–L12').replace('R1 to R12','R1-R12');
ok(build(compact).objects.filter(o=>o.name.endsWith('seat cushion')).length===24,'Compact row-range notation is supported');
const words=copy(l);words.architecture='A bus with a curved roof and twelve rows of paired benches on each side.';
ok(build(words).objects.filter(o=>o.name.endsWith('seat cushion')).length===24,'An explicit written row count works without technical row IDs in the brief');
const named=copy(words);named.spatialPlan.anchors.slice(0,3).forEach((a,i)=>a.id='story-seat-'+i);
ok(build(named).objects.filter(o=>o.name.endsWith('seat cushion')).length===24,'Row numbers and sides can come from saved bench names rather than a particular ID format');
const inconsistent=copy(l);inconsistent.spatialPlan.anchors[1].xy[1]=2.7;
throws(()=>build(inconsistent),/do not match the stated row pitch/);
const counts=copy(l);counts.architecture=counts.architecture.replace('R12','R10');throws(()=>build(counts),/matching left\/right/);
const empty=copy(l);empty.architecture='A bus with 0 rows on each side.';throws(()=>build(empty),/matching left\/right/);
const low=copy(l);low.coverageViews[0].pose.position=[-.68,6.4,.5];throws(()=>build(low),/inside a repeated/);
const explicit=copy(l);explicit.spatialPlan.anchors[0].renderShape='box';
ok(build(explicit).objects.filter(o=>o.anchorId==='bench-L6').length===1,'An explicit story-bench solid block choice stays authoritative');
ok(build(l,false).objects.every(o=>!['cushion','cloth'].includes(o.kind)),'Legacy scenes retain their supported primitive kinds');
const detail=b.KinolotSetDetail.build;b.KinolotSetDetail.build=s=>s;const raw=build(l);b.KinolotSetDetail.build=detail;
const hidden=copy(raw);hidden.objects=hidden.objects.filter(o=>o.anchorId!=='bench-L6');
const state=detail(hidden,{space:l.spatialPlan.coordinates.spaces[0],anchors:l.spatialPlan.anchors,allAnchors:l.spatialPlan.anchors,brief:l,partPoses:{'bench-L6':{pose:'hidden'},'rear-door':{pose:'hidden'}}});
ok(!state.objects.some(o=>o.anchorId==='bench-L6')&&state.objects.filter(o=>o.name.endsWith('seat cushion')).length===23,'A hidden story bench is not recreated or used to shift the repeated row pattern');
ok(!state.objects.some(o=>o.name.endsWith('door leaf')),'An explicit alternate rear-door state does not get a default closed leaf');
const proposal=b.KinolotCloudRender.proposeCameras(l,[l]);
ok(proposal.panels[0].label==='Front along the aisle'&&proposal.panels[1].label==='Rear along the aisle'&&proposal.panels[3].label==='Driver controls','Free bus defaults describe their intended coverage');
ok(Math.abs(proposal.panels[0].pose.position[1]-proposal.panels[1].pose.position[1])>8,'Wide proposals cover opposite ends of the cabin');
const edited=copy(l);edited.keySizes='Row pitch about 0.72 m.';throws(()=>b.KinolotCloudRender.cameraProposalViews(edited,proposal,[edited]),/changed/);
const T=await import('../app/vendor/three/r180/three.module.min.js'),M=b.KinolotCameraMatch,F=b.KinolotCameraFraming;
const rig=b.KinolotAnglePreview.sceneFor(T,scene),roof=rig.meshes.find(m=>m.userData.id===scene.objects.find(o=>o.name.includes('curved ceiling')).id);
const headroom=new T.Raycaster(new T.Vector3(0,5.5,1.5),new T.Vector3(0,0,1)).intersectObject(roof,false)[0];
ok(headroom&&Math.abs(headroom.point.z-2.2)<.000001,'The curved roof preserves the saved interior height at its centre');rig.dispose();
const features=F.inventory(M.catalogue(scene,l.spatialPlan,l.id),scene),rear=features.find(f=>f.id==='rear-door');
const viewer=b.KinolotAnglePreview.create(T,scene,{softwareOnly:true,anchors:l.spatialPlan.anchors,openings:b.KinolotAnglePreview.openingGuides(l.spatialPlan)});
try{
 const pose=proposal.panels[1].pose,rect=F.rectangle(pose,rear);ok(rect&&F.visible(viewer,pose,rear,rect),'A modeled door leaf is identified through its saved opening ID, even when the names differ');
 const diffuser=scene.objects.find(o=>o.material==='busLamp');
 const hit=viewer.inspect({position:[diffuser.position[0],diffuser.position[1],diffuser.position[2]-.3],yaw:0,pitch:89,lensMm:24},.5,.5);
 ok(hit?.part?.includes('strip diffuser'),'The modeled diffuser is visible below its housing rather than hidden inside a solid box');
}finally{viewer.dispose();}
console.log('PASS full bus: '+checks+' count, completeness, geometry, immutability, coverage and identity checks');

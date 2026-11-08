/* Paired shelf geometry and real lighting rays; disposable data, no accounts or providers. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const compiled=process.env.SHELF_TEST_DIST==='1',read=f=>readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8');
const b={console,crypto,TextEncoder,URL,location:{hostname:'localhost'},turnIsAdmin:true,nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ['locations.jsx','blender-render-contract.js','blender-set-kitchen.js','blender-set-detail.js','blender-render.js','camera-angle-preview.js'])vm.runInContext(read(f),b);
const copy=x=>JSON.parse(JSON.stringify(x));let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;},same=(a,c,m)=>{assert.deepEqual(copy(a),copy(c),m);checks++;};
const room={id:'vehicle',name:'Shelf fixture',spatialPlan:{status:'reviewed',frame:'North',heights:'centre',source:{assetId:'vehicle',iso:''},
 anchors:[{id:'shelves',name:'Painted parcel shelves',space:'Shelf fixture',placement:'One shelf above each window band.',xy:[0,5],z:1.7,size:[2.4,8,.05],facing:0,sizeBasis:'user'}],
 coordinates:{spaces:[{id:'vehicle',name:'Shelf fixture',footprint:[[-1.2,0],[1.2,0],[1.2,10],[-1.2,10]],floorZ:0,ceilingH:2.1,openings:[]}]}}};
room.coverageViews=['TL','TR','BL','BR'].map((panel,i)=>({id:'camera-'+panel,panel,pose:{position:[0,i%2?9:.5,1.4],yaw:i%2?180:0,pitch:-10,lensMm:24,basis:'user'}}));
function build(l,detailed=true){b.TURN_SUPABASE={setBuild:true,setBuildMcp:detailed};b.turnContinuity={locations:[l]};return b.KinolotCloudRender.buildScene(l,[l]);}
const before=JSON.stringify(room),scene=build(room),parts=scene.objects.filter(o=>o.anchorId==='shelves');
ok(JSON.stringify(room)===before,'Shelf assembly never edits saved measurements, source bindings or cameras');
ok(parts.length===2,'A clearly described pair becomes two boards rather than a cabin-wide slab');
const detail=b.KinolotSetDetail.build;b.KinolotSetDetail.build=s=>s;const solid=build(room);b.KinolotSetDetail.build=detail;
same(scene.cameras,solid.cameras,'All four saved camera poses stay exact');
same(scene.previewLights,solid.previewLights,'The fix does not brighten the image by changing lamps or exposure');
same(scene.materials[parts[0].material],solid.materials.dressing,'Shelf colour and surface properties stay unchanged');
for(const p of parts)ok(p.size[0]<=.3&&p.size[1]===8&&p.size[2]===.05,'Each board is narrow and keeps the saved run and thickness');
ok(parts.every(p=>Math.abs(p.position[0])-p.size[0]/2>=.89),'The centre aisle is open beneath the preview light');
ok(scene.notes.some(n=>n.startsWith('Paired parcel shelves')),'Internal board depth is disclosed as proposed design');
ok(!scene.notes.some(n=>n.startsWith('Simplified solid blocks:')&&n.includes('Painted parcel shelves')),'Recognised shelf boards are not reported as an unshaped solid proxy');
for(const o of solid.objects.filter(o=>!o.anchorId))same(scene.objects.find(p=>p.id===o.id),o,'Floor, ceiling and wall geometry are preserved');
for(const facing of [0,45,90,180,270]){
 const l=copy(room);l.spatialPlan.anchors[0].facing=facing;
 const shelves=build(l).objects.filter(o=>o.anchorId==='shelves'),angle=-facing*Math.PI/180;
 for(const p of shelves){const dx=p.position[0],dy=p.position[1]-5,local=[Math.cos(angle)*dx+Math.sin(angle)*dy,-Math.sin(angle)*dx+Math.cos(angle)*dy,p.position[2]-1.7];
  ok(local.every((v,i)=>Math.abs(v)+p.size[i]/2<=l.spatialPlan.anchors[0].size[i]/2+.00001),'Every board stays within the saved rotated envelope');
 }
}
const alongX=copy(room);alongX.spatialPlan.anchors[0].size=[8,2.4,.05];
ok(build(alongX).objects.filter(o=>o.anchorId==='shelves').every(o=>o.size[0]===8&&o.size[1]<=.3),'The saved long axis determines the shelf run');
const block=copy(room);block.spatialPlan.anchors[0].renderShape='box';
ok(build(block).objects.filter(o=>o.anchorId==='shelves').length===1,'Explicit Solid block remains authoritative');
const single=copy(room);single.spatialPlan.anchors[0].name='Parcel shelf';
ok(build(single).objects.filter(o=>o.anchorId==='shelves').length===1,'A single shelf is not silently turned into a pair');
const ambiguous=copy(room);ambiguous.spatialPlan.anchors[0].placement='Overhead storage.';
ok(build(ambiguous).objects.filter(o=>o.anchorId==='shelves').length===1,'Unspecified group arrangement remains a proxy');
ok(b.KinolotSetDetail.anchorShape({name:'Cabinet under parcel shelves',placement:'Near both window bands'})==='box','A neighbouring object is not misclassified');
ok(build(room,false).objects.filter(o=>o.anchorId==='shelves').length===2,'The assembly uses primitives supported by the existing basic and detailed workers');
const T=await import('../app/vendor/three/r180/three.module.min.js');
function hit(spec){const viewer=b.KinolotAnglePreview.create(T,spec,{softwareOnly:true,anchors:room.spatialPlan.anchors});
 try{return viewer.inspect({position:spec.previewLights[0].position,yaw:0,pitch:-89,lensMm:24},.5,.5);}finally{viewer.dispose();}}
ok(hit(solid).name==='Painted parcel shelves','Actual mesh rays reproduce the old shelf blocking the light');
ok(hit(scene).name==='Shelf fixture floor','The same lamp now has a clear ray to the cabin floor');
same(scene,build(room),'Repeated builds from the same data are deterministic');
console.log('PASS paired shelves: '+checks+' geometry, saved-data, override and actual-light-path checks');

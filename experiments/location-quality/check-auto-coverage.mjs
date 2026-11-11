import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {planCoverage} from './auto-coverage.mjs';
const root=new URL('../../',import.meta.url),b={console,crypto,TextEncoder};b.window=b;vm.createContext(b);
for(const file of ['blender-render-contract.js','camera-angle-preview.js'])vm.runInContext(readFileSync(new URL('app/'+file,root),'utf8'),b);
const T=await import(new URL('app/vendor/three/r180/three.module.min.js',root));
const copy=value=>JSON.parse(JSON.stringify(value));
const box=(id,position,size,anchorId)=>({id,name:id,position,size,rotation:[0,0,0],material:'grey',kind:'box',...(anchorId?{anchorId}:{})});
const scene={schema:b.KinolotRenderContract.MCP_SCHEMA,authoring:'mcp-procedural-v1',name:'Synthetic coverage fixture',units:'metres',notes:[],
  materials:{grey:{baseColor:[.5,.5,.5],roughness:.8}},previewLights:[],
  cameras:Object.fromEntries(['TL','TR','BL','BR'].map(key=>[key,{position:[.3,.3,1.6],yaw:0,pitch:0,lensMm:35}])),
  objects:[box('floor',[4,4,-.075],[8,8,.15]),box('north',[4,8,1.5],[8,.15,3]),box('south',[4,0,1.5],[8,.15,3]),
    box('west',[0,4,1.5],[.15,8,3]),box('east',[8,4,1.5],[.15,8,3]),box('desk',[2,4,.4],[2,1,.8],'desk'),box('chair',[6,4,.45],[.5,.5,.9],'chair')]};
const space={footprint:[[0,0],[8,0],[8,8],[0,8]],floorZ:0,ceilingH:3};
const before=JSON.stringify(scene),result=planCoverage(T,b.KinolotAnglePreview,scene,space);
assert.equal(JSON.stringify(scene),before,'The planner never moves objects or overwrites saved cameras.');
assert.equal(result.readyForFinalRender,false,'Visibility alone cannot mark a result ready for the user.');
assert.equal(result.semanticIntentValidated,false);
assert.deepEqual(result.panels.map(p=>p.key),['TL','TR','BL','BR']);
assert.equal(new Set(result.panels.slice(2).map(p=>p.subjectId)).size,2,'Details must show different subjects.');
for(const panel of result.panels){
  assert.ok(panel.pose.position[0]>.25&&panel.pose.position[0]<7.75&&panel.pose.position[1]>.25&&panel.pose.position[1]<7.75);
  assert.ok([panel.pose.yaw,panel.pose.pitch,panel.pose.lensMm,...panel.pose.position].every(Number.isFinite));
  if(panel.role==='detail')assert.ok(panel.visibleSamples>=3/9,'A proposed detail must actually hit its subject mesh.');
}
assert.deepEqual(planCoverage(T,b.KinolotAnglePreview,scene,space),result,'The same scene produces the same geometric proposal.');
const otherSeeds=copy(scene);Object.values(otherSeeds.cameras).forEach(p=>{p.yaw=180;p.lensMm=18;});
assert.deepEqual(planCoverage(T,b.KinolotAnglePreview,otherSeeds,space),result,'Output is searched from the scene, not copied from saved camera angles.');
const hidden=copy(scene);hidden.objects.push(box('opaque enclosure',[2,4,.5],[2.4,1.4,1.1]));
let disposals=0;const api={...b.KinolotAnglePreview,sceneFor(T,s){const rig=b.KinolotAnglePreview.sceneFor(T,s),dispose=rig.dispose;rig.dispose=()=>{disposals++;dispose();};return rig;}};
assert.throws(()=>planCoverage(T,api,hidden,space),/no clear establishing|distinct subjects|framed clearly/,'A blocked required subject must not produce a successful four-view fallback.');
assert.equal(disposals,1,'Failed searches release preview resources.');
assert.throws(()=>planCoverage(T,b.KinolotAnglePreview,{...scene,objects:scene.objects.filter(o=>o.anchorId!=='chair')},space),/at least two/);
console.log('PASS offline automatic coverage: deterministic scene search, actual-mesh visibility, diversity, saved-input independence, conservative refusal and cleanup. Semantic intent and final-image quality remain unvalidated.');

/* Geometry/camera parity and resource lifetime using the actual pinned preview library; no browser or network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as T from '../app/vendor/three/r180/three.module.min.js';
const b={console,crypto,TextEncoder};b.window=b;vm.createContext(b);
const compiled=process.env.ANGLE_TEST_DIST==='1';
for(const f of ['blender-render-contract.js','camera-angle-preview.js'])vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+f,'utf8'),b);
const api=b.KinolotAnglePreview;let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const close=(a,c,m)=>ok(Math.abs(a-c)<.00001,m);
const pose={position:[2,3,1.6],yaw:35,pitch:-8,lensMm:24};
const source={schema:'kinolot-blockout-test-v1',name:'Preview parity fixture',units:'metres',axes:'+Z up',status:'test',notes:[],materials:{wall:{baseColor:[.5,.5,.5]}},previewLights:[],
  objects:['box','cylinder','torus','wedge','prism'].map((kind,i)=>({id:'shape-'+i,name:kind,kind,position:[i*2,3,2],size:[2,3,4],rotation:[.2,.3,.4],material:'wall',
    ...(kind==='prism'?{footprint:[[-.5,-.5],[.5,-.5],[.5,-.25],[-.25,-.25],[-.25,.5],[-.5,.5]]}:{})})),
  cameras:Object.fromEntries(['TL','TR','BL','BR'].map(p=>[p,structuredClone(pose)]))};
const before=JSON.stringify(source),rig=api.sceneFor(T,source);
ok(rig.meshes.length===5,'All existing worker primitive kinds have a preview representation');
for(let i=0;i<5;i++){
 const mesh=rig.meshes[i],item=source.objects[i],bounds=mesh.geometry.boundingBox;
 for(const axis of ['x','y','z']){close(bounds.min[axis],-.5,'Local geometry min matches the worker');close(bounds.max[axis],.5,'Local geometry max matches the worker');}
 const local=[.3,-.4,.2],p=local.map((v,a)=>v*item.size[a]),[rx,ry,rz]=item.rotation;
 const y=p[1]*Math.cos(rx)-p[2]*Math.sin(rx),z=p[1]*Math.sin(rx)+p[2]*Math.cos(rx),x=p[0]*Math.cos(ry)+z*Math.sin(ry),z2=-p[0]*Math.sin(ry)+z*Math.cos(ry);
 const expected=[x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz),z2].map((v,a)=>v+item.position[a]);
 const actual=mesh.localToWorld(new T.Vector3(...local));['x','y','z'].forEach((axis,a)=>close(actual[axis],expected[a],'Saved scale, XYZ Euler order and translation match Blender'));
}
ok(JSON.stringify(source)===before,'Preview construction never changes the source scene');
for(const yaw of [0,35,90,180,270])for(const pitch of [-35,0,20]){
 const p={...pose,yaw,pitch},camera=api.cameraFor(T,p),direction=camera.getWorldDirection(new T.Vector3());
 const y=yaw*Math.PI/180,t=pitch*Math.PI/180;
 [Math.sin(y)*Math.cos(t),Math.cos(y)*Math.cos(t),Math.sin(t)].forEach((v,i)=>close(direction.getComponent(i),v,'Camera direction matches the worker'));
 close(camera.getFocalLength(),p.lensMm,'36 mm sensor focal length remains exact');
 close(camera.near,.05,'Near clipping matches Blender');close(camera.far,200,'Far clipping matches Blender');
 const right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion),half=10*36/(2*p.lensMm);
 const edge=camera.position.clone().addScaledVector(direction,10).addScaledVector(right,half).project(camera);
 close(edge.x,1,'Horizontal field of view matches the worker');close(edge.y,0,'Horizon and camera roll match the worker');
}
let renders=0,copies=0,disposed=0,lost=0,gpuLost=false;
class Renderer{constructor(){this.domElement={};}setPixelRatio(){}setSize(){}getContext(){return {isContextLost:()=>gpuLost};}render(scene,camera){assert.ok(scene.isScene&&camera.isPerspectiveCamera);renders++;}dispose(){disposed++;}forceContextLoss(){lost++;}}
let frame;const context={drawImage(){copies++;},createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData:f=>{frame=f;}};
const viewer=api.create({...T,WebGLRenderer:Renderer},source),canvas={getContext:()=>context};
viewer.render(canvas,pose);viewer.render(canvas,{...pose,yaw:90});
ok(renders===2&&copies===2,'Candidate updates render and copy frames through one reusable GPU renderer');
gpuLost=true;viewer.render(canvas,{...pose,yaw:180});
ok(viewer.mode==='software'&&frame?.data.length>0,'A lost GPU context switches to a drawn software frame');
ok(copies===2,'A lost GPU context never copies a blank GPU frame');
viewer.dispose();viewer.dispose();ok(disposed===1&&lost===1,'Closing releases GPU resources exactly once');
assert.throws(()=>viewer.render(canvas,pose),/closed/);checks++;
assert.throws(()=>api.cameraFor(T,{...pose,lensMm:0}),/valid camera/);checks++;
assert.throws(()=>api.cameraFor(T,{...pose,position:[NaN,0,0]}),/valid camera/);checks++;
// Actual pixels: compatibility rendering must keep foreground occlusion, direction and clipping.
class NoGPU{constructor(){throw Error('WebGL disabled');}}
const softwareScene={...structuredClone(source),materials:{red:{baseColor:[1,0,0]},blue:{baseColor:[0,0,1]},green:{baseColor:[0,1,0]}},objects:[
 {id:'near',name:'Near red',kind:'box',position:[0,3,1.6],size:[1,1,1],rotation:[0,0,0],material:'red'},
 {id:'far',name:'Far blue',kind:'box',position:[0,6,1.6],size:[3,1,3],rotation:[0,0,0],material:'blue'},
 {id:'behind',name:'Behind camera',kind:'box',position:[0,-3,1.6],size:[2,1,2],rotation:[0,0,0],material:'green'}]};
const fallback=api.create({...T,WebGLRenderer:NoGPU},softwareScene),forward={position:[0,0,1.6],yaw:0,pitch:0,lensMm:24};
fallback.render(canvas,forward,160,90);const centre=(45*160+80)*4;
ok(fallback.mode==='software'&&frame.data[centre]>150&&frame.data[centre+2]===0,'Foreground red occludes blue even when blue is drawn afterwards');
ok(frame.data.some((v,i)=>i%4===2&&v>100),'The larger background remains visible around the foreground');
ok(!frame.data.some((v,i)=>i%4===1&&v>100),'Geometry behind the camera is clipped');
const previous=frame.data.slice();fallback.render(canvas,{...forward,yaw:180},160,90);
ok(frame.data[centre+1]>150&&frame.data[centre]===0,'Turning the camera shows the object behind its original pose');
ok(previous.some((v,i)=>frame.data[i]!==v),'Moving a software camera changes the rendered image');
fallback.render(canvas,{...forward,position:[0,2.51,1.6]},160,90);
ok(frame.data.length===160*90*4&&frame.data.every(Number.isFinite),'A camera crossing near geometry clips safely without invalid pixels');
let attempts=0;class MustNotStart{constructor(){attempts++;throw Error('Do not start GPU');}}
const forced=api.create({...T,WebGLRenderer:MustNotStart},softwareScene,{softwareOnly:true});forced.render(canvas,forward,160,90);
ok(attempts===0&&forced.mode==='software'&&frame.data[centre]>150,'Manual compatibility mode skips the GPU and draws a usable camera frame');forced.dispose();
fallback.dispose();assert.throws(()=>fallback.render(canvas,forward),/closed/);checks++;
// Exercise the real dynamic-module loader, not just an injected graphics adapter.
const loader={URL,document:{baseURI:new URL('../',import.meta.url).href}};loader.window=loader;vm.createContext(loader);
vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+'camera-angle-preview.js','utf8'),loader,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const loaded=await loader.KinolotAnglePreview.load();
ok(loaded.REVISION==='180','The real local-module loader resolves the pinned graphics library');
ok(await loader.KinolotAnglePreview.load()===loaded,'Repeated openings reuse the loaded module');
rig.dispose();
console.log('PASS angle preview: '+checks+' geometry, camera projection, clipping, immutability and resource checks');

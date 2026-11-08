/* Fixed-geometry camera matching: numerical recovery, actual saved-pose integration and paid-boundary guards.
   All vision/storage adapters are local fakes. No paid providers or account writes. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const compiled=process.env.CAMERA_MATCH_TEST_DIST==='1';
const read=f=>readFileSync((compiled?'dist/app/':'app/')+f.replace(/\.jsx$/,compiled?'.js':'.jsx'),'utf8');
const b={console,crypto,TextEncoder,URL,setTimeout,structuredClone,location:{hostname:'localhost'},turnIsAdmin:true,
 nbEpoch:()=>1,nbGetMeta:()=>null,nbGetImage:()=>'',scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
// locations.jsx needs JSX compilation in source mode.
const {transformSync,parseSync}=await import('@babel/core');
for(const f of ['locations.jsx','blender-render-contract.js','blender-set-kitchen.js','blender-set-detail.js','blender-render.js','camera-match.js']){
 const code=read(f);vm.runInContext(!compiled&&f.endsWith('.jsx')?transformSync(code,{presets:['@babel/preset-react'],babelrc:false,configFile:false}).code:code,b);
}
const api=b.KinolotCameraMatch;let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const throws=(fn,re)=>{assert.throws(fn,re);checks++;};
const copy=x=>JSON.parse(JSON.stringify(x));
{
 const source=read('ai.jsx'),fn=parseSync(source,{sourceType:'script',parserOpts:{plugins:['jsx']}}).program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='aiVisionComplete');
 let invocations=0;
 const model={id:'test-writing',provider:'google',label:'Test writing engine'};
 const v={WRITING_MODELS:[model],getWritingModelId:()=>model.id,recommendedWritingModelId:()=>model.id,
  visionImageNeedsReencode:()=>false,turnDownscaleDataUrl:async u=>u,textSpendAdd(){},safeError:x=>x,
  sbClient:()=>({functions:{invoke:async()=>{invocations++;return {data:{text:'{}',vision:true},error:null};}}})};v.window=v;vm.createContext(v);vm.runInContext(source.slice(fn.start,fn.end),v);
 await rejects(()=>v.aiVisionComplete([{role:'user',content:'fixed set'}],['data:image/png;base64,TEST'],{beforeSubmit:()=>{throw Error('stale fixture');}}),/stale fixture/);
 ok(invocations===0,'The real shared vision adapter checks camera scope immediately before its billable proxy call');
 const result=await v.aiVisionComplete([{role:'user',content:'unchanged existing caller'}],['data:image/png;base64,TEST']);
 ok(result.vision&&invocations===1,'Existing vision callers without a guard retain the normal single-call behaviour');
}
let realPreview,realThree;
{
 const T=await import('../app/vendor/three/r180/three.module.min.js');
 vm.runInContext(read('camera-angle-preview.js'),b);
 const scene={schema:b.KinolotRenderContract.SCHEMA,units:'metres',name:'Visibility fixture',axes:'+Z up',status:'test',notes:[],previewLights:[],cameras:Object.fromEntries(['TL','TR','BL','BR'].map(k=>[k,{position:[0,0,1],yaw:0,pitch:0,lensMm:24}])),objects:[{id:'box',kind:'box',name:'Box',position:[0,2,1],size:[1,1,1],rotation:[0,0,0],material:'wall'}],materials:{wall:{baseColor:[.5,.5,.5],metallic:0,roughness:1}}};
 const instance=b.KinolotAnglePreview.create(T,scene,{softwareOnly:true}),pose={position:[0,0,1],yaw:0,pitch:0,lensMm:24};
 ok(instance.landmarkVisible(pose,[0,1.5,1]),'Actual preview mesh rays allow a visible feature on the front surface');
 ok(!instance.landmarkVisible(pose,[0,2.5,1])&&!instance.landmarkVisible(pose,[0,4,1]),'Actual mesh rays reject hidden back corners and features behind an obstruction');
 instance.dispose();throws(()=>instance.landmarkVisible(pose,[0,1.5,1]),/closed/);
 realPreview=b.KinolotAnglePreview;realThree=T;
}
const bounds={min:[.25,.25,.25],max:[5.75,5.75,2.85]};
const points=[...[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>[2+x*.45,3.1+y*.4,.8+z*.7]))),
 ...[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>[4+x*.5,4.2+y*.45,1+z*.8])))];
const truth={position:[1.2,.6,1.65],yaw:24,pitch:-14,lensMm:18};
const landmarks=points.map((point,i)=>({id:'L'+i,point,name:i<8?'Table':'Fridge'}));
const obs=landmarks.map(p=>({...p,uv:api.project(truth,p.point)}));
{
 const centre=api.project({position:[0,0,0],yaw:0,pitch:0,lensMm:36},[0,2,0]);
 ok(centre[0]===.5&&centre[1]===.5,'Projection follows +Y forward and +Z up');
 ok(api.project(truth,[1,-10,0])===null,'Points behind a camera are not usable projections');
 const seeds=[{position:[.5,1.1,1.9],yaw:36,pitch:-18,lensMm:18},{position:[2,.3,1.4],yaw:10,pitch:0,lensMm:40}];
 const fit=api.fit(obs,seeds,bounds);
 const held=[3,3.8,1.25],uv=api.project(truth,held),recovered=api.project(fit.pose,held);
 ok(fit.rms<1e-6&&Math.hypot(...fit.pose.position.map((x,i)=>x-truth.position[i]))<.001,'Fitter recovers a known camera from independent perturbed starts');
 ok(Math.hypot(...uv.map((v,i)=>v-recovered[i]))<1e-6,'Recovered camera also projects a held-out landmark accurately');
 const noisy=obs.map((p,i)=>({...p,uv:p.uv.map((v,j)=>v+Math.sin(i*3+j)*.001)}));
 ok(api.fit(noisy,seeds,bounds).rms<.002,'Small observation noise remains a bounded approximate fit');
 throws(()=>api.fit(obs,seeds,bounds,()=>false),/do not fit/);
 throws(()=>api.fit(obs.map((p,i)=>({...p,uv:[(i%5)/5,((i*7)%9)/9]})),seeds,bounds),/do not fit/);
 const outside={...truth,position:[-8,-3,1.6]};
 throws(()=>api.fit(landmarks.map(p=>({...p,uv:api.project(outside,p.point)})),seeds,bounds),/do not fit/);
}
{
 const raw={panels:['TL','TR','BL','BR'].map(key=>({key,points:obs.map(p=>({id:p.id,uv:p.uv}))}))};
 ok(api.observations(raw,landmarks).length===4,'Parser keeps only four measured landmark sets');
 const bad=copy(raw);bad.panels[0].points[0].id='invented';throws(()=>api.observations(bad,landmarks),/unknown/);
 const duplicate=copy(raw);duplicate.panels[0].points[1].id=duplicate.panels[0].points[0].id;throws(()=>api.observations(duplicate,landmarks),/repeated/);
 const sparse=copy(raw);sparse.panels[2].points=sparse.panels[2].points.slice(0,3);throws(()=>api.observations(sparse,landmarks),/enough shared features/);
 const oneObject=landmarks.map(p=>({...p,name:'One measured object'}));
 ok(api.observations(raw,oneObject).length===4,'The same non-coplanar landmarks can belong to one measured 3D object; a second object is not required');
 const nan=copy(raw);nan.panels[0].points[0].uv=[NaN,.5];throws(()=>api.observations(nan,landmarks),/invalid/);
 const flat=landmarks.map(p=>({...p,point:[p.point[0],3,p.point[2]]}));throws(()=>api.observations(raw,flat),/different depths/);
 const repeat=copy(raw);repeat.panels[3].key='TL';throws(()=>api.observations(repeat,landmarks),/repeated or omitted/);
}
{
 const plan={anchors:[],coordinates:{spaces:[{id:'room',name:'Room',footprint:[[0,0],[6,0],[6,6],[0,6]],floorZ:0,ceilingH:3}]}};
 const cat=api.catalogue({objects:[]},plan,'room');
 ok(cat.length===8&&cat.every(p=>p.name==='Room structure'),'An otherwise empty room provides its floor and ceiling wall-corner landmarks');
 ok(cat.some(p=>p.point.every((v,i)=>Math.abs(v-[.075,.075,0][i])<1e-8)),'Room landmarks lie on the actual inner wall faces, not inside wall-centre geometry');
 const reversed=copy(plan);reversed.coordinates.spaces[0].footprint.reverse();
 const points=api.catalogue({objects:[]},reversed,'room').map(p=>p.point.join(',')).sort();
 ok(JSON.stringify(points)===JSON.stringify(cat.map(p=>p.point.join(',')).sort()),'Inner wall corners remain correct for either footprint winding');
}
function harness({realGraphics=false}={}){
 const scope={uid:'owner',projectId:'film',epoch:1};let live=copy(scope),writable=true,calls=0,readHook=null,prepareHook=null,visible=true;
 const l={id:'room',name:'Room',coverageViews:[],spatialPlan:{status:'reviewed',frame:'North',heights:'centre',source:{assetId:'room',iso:''},
  anchors:[{id:'table',name:'Desk',space:'Room',placement:'Back',xy:[2,3.1],z:.8,size:[.9,.8,1.4],sizeBasis:'design'},
   {id:'fridge',name:'Fridge',space:'Room',placement:'Right',xy:[4,4.2],z:1,size:[1,.9,1.8],sizeBasis:'design'}],
  coordinates:{spaces:[{id:'room',name:'Room',floorZ:0,ceilingH:3,footprint:[[0,0],[6,0],[6,6],[0,6]],openings:[]}]}}};
 b.turnContinuity={locations:[l]};b.turnArtRoomWritable=()=>writable;b.BlenderPreview={scope:()=>copy(live),isCurrent:s=>JSON.stringify(s)===JSON.stringify(live)};
 let draft={url:'data:image/png;base64,IDEAS',meta:{iso:'first',inputKey:'same',modelId:'ideas'},stale:false};
 b.KinolotCameraInspiration={load:async()=>copy(draft)};
 b.document={createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},beginPath(){},arc(){},fill(){},strokeText(){},fillText(){}}),toDataURL:()=> 'data:image/png;base64,REF'})};
 const render=b.KinolotCloudRender,originalPropose=render.proposeCameras;
 const poses=['TL','TR','BL','BR'].map((key,i)=>({key,pose:{...truth,position:[truth.position[0]+i*.06,truth.position[1],truth.position[2]],yaw:truth.yaw-i*2},label:key,role:'wide'}));
 render.proposeCameras=(ll,list)=>({key:render.cameraProposalKey(ll,list),panels:copy(poses),warnings:[]});
 let scene;
 b.KinolotAnglePreview={load:async()=>{await prepareHook?.();return realGraphics?realThree:{};},openingGuides:()=>[],create:(_T,spec)=>{scene=spec;return realGraphics?realPreview.create(realThree,spec,{softwareOnly:true}):{render(){},landmarkVisible:()=>visible,dispose(){}};}};
 b.turnDownscaleDataUrl=async u=>u;
 b.aiVisionComplete=async(messages,images,opts)=>{
  await readHook?.('before');await opts.beforeSubmit();calls++;
  assert.equal(images.length,5);assert.ok(messages[0].content.includes('Never invent correspondences'));
  const cat=api.catalogue(scene,l.spatialPlan,l.id),instance=realGraphics?realPreview.create(realThree,scene,{softwareOnly:true}):null;
  const panels=poses.map(({key,pose})=>({key,points:cat.filter(p=>!instance||instance.landmarkVisible(pose,p.point)).map(p=>({id:p.id,uv:api.project(pose,p.point)})).filter(p=>p.uv&&p.uv.every(v=>v>=0&&v<=1))}));instance?.dispose();
  await readHook?.('after');return {vision:true,text:JSON.stringify({panels})};
 };
 return {l,scope,poses,get calls(){return calls;},changeSource:()=>draft.meta.iso='second',staleSource:()=>draft.stale=true,
  switchFilm:()=>live.projectId='other',readonly:()=>writable=false,readHook:fn=>readHook=fn,prepareHook:fn=>prepareHook=fn,
  visible:v=>visible=v,cleanup:()=>{render.proposeCameras=originalPropose;}};
}
{
 const h=harness(),before=JSON.stringify(h.l);const proposal=await api.match('room',h.scope);
 ok(proposal.panels.length===4&&h.calls===1,'One explicit vision call yields four fitted camera proposals');
 ok(JSON.stringify(h.l)===before,'Matching never mutates saved geometry, camera data or canonical artwork');
 const views=await api.confirm('room',h.scope,proposal);ok(views.length===4,'Explicit confirmation returns the same standard coverage views consumed by Step Four');
 const next={...h.l,coverageViews:views};b.turnContinuity.locations=[next];
 const scene=b.KinolotCloudRender.buildScene(next,[next]);
 ok(Object.keys(scene.cameras).length===4&&scene.cameras.TL.lensMm>12,'The normal Blender scene builder consumes the accepted fitted cameras');
 ok(JSON.stringify(next.spatialPlan)===JSON.stringify(h.l.spatialPlan),'Accepting measured camera poses keeps the floor plan byte-for-byte unchanged');
 await rejects(()=>api.confirm('room',h.scope,proposal),/floor plan or cameras changed/);h.cleanup();
}
{
 const h=harness();h.readonly();await rejects(()=>api.match('room',h.scope),/read-only/);ok(!h.calls,'Read-only matching refuses before a paid call');h.cleanup();
}
{
 const h=harness();h.staleSource();await rejects(()=>api.match('room',h.scope),/current view ideas/);ok(!h.calls,'Outdated ideas refuse before a paid call');h.cleanup();
}
{
 const h=harness();h.readHook(phase=>{if(phase==='before')h.switchFilm();});await rejects(()=>api.match('room',h.scope),/film or sign-in changed/);ok(!h.calls,'Film changes at the paid boundary refuse submission');h.cleanup();
}
{
 const h=harness();h.readHook(phase=>{if(phase==='before')h.changeSource();});await rejects(()=>api.match('room',h.scope),/ideas image or location changed/);ok(!h.calls,'Changed source ideas at the paid boundary refuse submission');h.cleanup();
}
{
 const h=harness();h.readHook(phase=>{if(phase==='after')h.l.spatialPlan.anchors[0].size[0]=1.2;});await rejects(()=>api.match('room',h.scope),/floor plan or cameras changed/);ok(h.calls===1,'A late response after a geometry edit cannot produce a stale proposal');h.cleanup();
}
{
 const h=harness(),p=await api.match('room',h.scope);h.changeSource();await rejects(()=>api.confirm('room',h.scope,p),/ideas image or location changed/);h.cleanup();
}
{
 const h=harness();let release;h.prepareHook(()=>new Promise(r=>release=r));const run=api.match('room',h.scope);await new Promise(setImmediate);
 await rejects(()=>api.match('room',h.scope),/already in progress/);h.prepareHook(null);release();await run;ok(h.calls===1,'Concurrent clicks cannot duplicate a paid match request');h.cleanup();
}
{
 const h=harness();h.visible(false);await rejects(()=>api.match('room',h.scope),/Too few visible/);ok(!h.calls,'An unlabelled reference fails before the writing call');h.cleanup();
}
{
 const h=harness({realGraphics:true}),before=JSON.stringify(h.l),proposal=await api.match('room',h.scope);
 ok(proposal.panels.every(p=>p.fit.count>=6&&p.fit.rms<.002),'The complete fitter also passes with actual labelled preview meshes and actual obstruction rays');
 ok(JSON.stringify(h.l)===before,'Actual 3D reference rendering does not mutate saved data');h.cleanup();
}
console.log(`PASS camera matching: ${checks} numeric, immutable-set, real-scene and paid-boundary checks`);

/* Offline image-gate tests; --serve exposes an isolated UI fixture (no cloud/AI). */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import http from 'node:http';
const clientSource=readFileSync('app/blender-studio.js','utf8');
const uiSource=readFileSync('app/blender-studio-ui.jsx','utf8');
const iso='2026-09-24T10:00:00.000Z';
let meta=null,image=null,current=true,loadImage=null;
const calls=[],scope={projectId:'fixture-film',uid:'fixture-user'};
const box={console,nbGetMeta:()=>meta,nbLoadImage:async()=>loadImage?loadImage():image,
  BlenderPreview:{scope:()=>scope,isCurrent:()=>current,request:async(action,body)=>{
    calls.push({action,body});return {workspace:{locationId:body.location?.id||body.locationId,revision:1}};
  }},BlenderStudioContract:{validateWorkspace:()=>{}}};
box.window=box;vm.createContext(box);vm.runInContext(clientSource,box);
const api=box.BlenderStudio;
await assert.rejects(api.open({location:{id:'house',name:'House'}}),/Generate this location/);
assert.equal(calls.length,0,'no workspace access for missing artwork');
meta={iso,modelId:'uploaded',uploaded:true};image='data:image/png;base64,AA==';
await assert.rejects(api.open({location:{id:'house'}}),/Generate this location/);
assert.equal(calls.length,0,'upload metadata cannot unlock access');
meta={iso,modelId:'gpt-image-2'};image=null;
await assert.rejects(api.get('house'),/Generate this location/);
image='data:image/png;base64,AA==';
await api.open({location:{id:'house',name:'House'},references:[]});
assert.equal(calls.length,1);
assert.equal(calls[0].body.references[0].version,iso,'canonical generated source is pinned automatically');
assert.equal(api.wasOpened('house'),true);
const before=calls.length;
loadImage=async()=>{current=false;return image;};
await assert.rejects(api.open({location:{id:'house'}}),/film or your access changed/);
assert.equal(calls.length,before,'late image load cannot open another project');
current=true;loadImage=async()=>{meta={...meta,iso:'2026-09-24T11:00:00.000Z'};return image;};
await assert.rejects(api.open({location:{id:'house'}}),/source image changed/);
loadImage=null;
const noop=()=>{},React={createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState:v=>[v,noop],useEffect:noop,useRef:v=>({current:v}),useMemo:f=>f(),useCallback:f=>f};
Object.assign(box,{React,Icon:{box:'icon'},ReactDOM:{createPortal:x=>x}});
vm.runInContext(uiSource,box);
meta=null;
let launcher=box.BlenderStudioLaunch({location:{id:'house'}});
assert.equal(launcher.children[0].props.disabled,true);
meta={iso,modelId:'gpt-image-2'};
launcher=box.BlenderStudioLaunch({location:{id:'house'}});
assert.equal(launcher.children[0].props.disabled,false);
assert.match(launcher.children[0].props.className,/\bprimary\b/);
assert.match(launcher.children[0].props.className,/\bbs-launch-button\b/);
assert.equal(box.BlenderStudioLaunch({location:{id:'house'},readOnly:true}).children[0].props.disabled,true,
  'the prominent launcher still respects read-only access');
assert.doesNotMatch(uiSource,/type:"file"|Prompt only|Local temporary image|imageDataUrl:/);
const shot=box.bsStudioShot({id:'shot-1',sceneId:'scene-1',size:'CU',lens:'50mm',prompt:'not part of the Studio schema'});
assert.equal(shot.camera.focalLength,50);
assert.equal(shot.prompt,undefined);
const entry=box.BlenderStudioEntry({location:{id:'house'},autoOpen:true});
assert.equal(JSON.stringify(entry).includes('BlenderStudioSetup'),false,'setup is not mounted before authorized workspace access');
console.log('PASS generated-image gate, upload rejection, version/scope races and compact launcher');

if(process.argv.includes('--serve')){
  const png='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ded6c9"/><rect x="40" y="40" width="85" height="60" fill="#9bafbc"/><path d="M160 110h110v15H160z" fill="#987653"/><text x="18" y="162" font-size="14">Test image — no AI call</text></svg>');
  const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio derived fixture</title>
  <link rel="stylesheet" href="/app/styles.css"><link rel="stylesheet" href="/app/blender-studio.css">
  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"></script>
  <div id="root"></div><script>
  const E=React.createElement,Icon={box:()=>E('span',{'aria-hidden':true},'◇')};
  const locations=[{id:'house',name:'Generated House'},{id:'empty',name:'No image yet'},{id:'upload',name:'Uploaded photo only'}];
  const characters=[{id:'char-1',name:'Generated character'}],props=[{id:'prop-1',name:'Generated prop'}];
  const scope={uid:'fixture-user',projectId:'fixture-film'},meta={iso:${JSON.stringify(iso)},modelId:'gpt-image-2'};
  window.nbGetMeta=id=>id==='empty'?null:id==='upload'?{...meta,uploaded:true}:meta;
  window.nbLoadImage=async id=>id==='empty'?null:${JSON.stringify(png)};
  window.nbPrefetchAll=async()=>{};
  let requests=0;window.BlenderPreview={scope:()=>scope,isCurrent:s=>s===scope,request:async(action,body)=>{
    if(action==='studio.capabilities')return {sourcePolicy:'generated-project-image-v1',models:[],meshModels:[],billingReady:false};
    if(action==='studio.workspace.open'){requests++;document.querySelector('#requests').textContent='Workspace opens: '+requests;
      return {workspace:{locationId:body.location.id,name:body.location.name,context:body.location.context,revision:1,references:body.references,shots:[],objects:[],assets:[],previews:[]}};}
    throw Error('No real services are available in this fixture');
  }};
  </script><script src="/app/blender-studio.js"></script><script src="/app/blender-studio-ui.jsx"></script><script>
  ReactDOM.createRoot(document.querySelector('#root')).render(E('main',{style:{padding:24}},
    E('h1',null,'Isolated Studio UI fixture'),E('p',{id:'requests'},'Workspace opens: 0'),
    E('button',{onClick:()=>window.dispatchEvent(new CustomEvent('turn-open-blender-studio'))},'Blender Studio'),
    ...locations.map(location=>E(BlenderStudioLaunch,{key:location.id,location})),
    E(BlenderStudioHost,{locations,characters,props})));
  </script>`;
  const paths=new Set(['/app/styles.css','/app/blender-studio.css','/app/blender-studio.js','/app/blender-studio-ui.jsx']);
  http.createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}
    else if(paths.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync('.'+req.url));}
    else{res.writeHead(404);res.end();}
  }).listen(5016,'127.0.0.1',()=>console.log('Non-spending fixture: http://127.0.0.1:5016/'));
}

/* Optional paid camera ideas: isolated identities, image/storage adapters and no real provider or account calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from '@babel/core';
const compiled=process.env.CAMERA_IDEAS_TEST_DIST==='1';let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
function harness(){
 const store=new Map(),ls=new Map(),calls=[],writes=[],reads=[],costs=[];
 const scope={uid:'owner',projectId:'film',epoch:1};let current={...scope},writable=true,reviewed=true,tier='cloud',providerHook=null,commitHook=null;
 const room={id:'room',name:'School bus',architecture:'Long narrow cabin',materials:'Painted steel',lighting:'Window light',coverageViews:[{panel:'TL',pose:{position:[99,99,99],note:'NEVER_COPY_CAMERA'}}],
   spatialPlan:{frame:'Front north',heights:'centre',anchors:[{id:'seat',name:'Bench',xy:[0,4],z:.5,size:[1,.7,1]}],
     coordinates:{spaces:[{id:'room',footprint:[[-1,0],[1,0],[1,10],[-1,10]],ceilingH:2}],cameras:[{note:'NEVER_COPY_CAMERA'}]}}};
 const b={console,crypto,TextEncoder,URL,setTimeout,clearTimeout,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},
  localStorage:{getItem:k=>ls.get(k)||null,setItem:(k,v)=>ls.set(k,v),removeItem:k=>ls.delete(k)},dispatchEvent(){},addEventListener(){},removeEventListener(){},
  turnContinuity:{locations:[room]},turnArtRoomWritable:()=>writable,locVisualDefaults:()=>({renderStyle:'cinematic'}),turnLookbookBriefFor:()=>'',
  locationSpatialPlanState:l=>({ready:reviewed,plan:l.spatialPlan}),KinolotRenderContract:{canonical:JSON.stringify},
  KinolotCloudRender:{request:()=>assert.fail('Inspiration cannot submit Blender jobs'),buildScene:()=>assert.fail('Inspiration cannot build or assign cameras')},
  BlenderPreview:{scope:()=>({...scope}),isCurrent:s=>['uid','projectId','epoch'].every(k=>s[k]===current[k])},
  nbPlanImageChoice:(model,res)=>({model,res}),nbGetRes:()=>'2K',isGptImageModel:model=>model.startsWith('gpt-image'),nbModelLabel:id=>id,
  nbImageCostText:(n,opts)=>{costs.push(opts);return '7';},turnImagePromptMaxChars:()=>31500,
  nbLoadDetailsAsset:async id=>{reads.push(id);assert.ok(id.startsWith('camera-ideas-'));return store.get(id)||null;},
  nbGenerate:async(prompt,opts)=>{await providerHook?.(opts);await opts.beforeSubmit();calls.push({prompt,opts});return 'data:image/png;base64,UE5H';},
  nbCommit:async(id,url,meta,refs,kind,epoch,cancelled)=>{
    assert.ok(id.startsWith('camera-ideas-'));await commitHook?.();if(cancelled())return {tier:'cancelled'};
    if(tier!=='cloud')return {tier};const d={url,meta:structuredClone(meta),refs:structuredClone(refs)};writes.push({id,kind,...d});store.set(id,d);return {...d,tier};
  },nbCostChip:(n,opts)=>({type:'span',props:{className:'nb-cost','data-refs':opts.refs},children:['7']})};b.window=b;vm.createContext(b);
 vm.runInContext(readFileSync((compiled?'dist/app/':'app/')+'camera-inspiration.js','utf8'),b);
 return {b,api:b.KinolotCameraInspiration,scope,room,store,ls,calls,writes,reads,costs,
  filmSwitch:()=>{current={...scope,projectId:'another-film'};},readonly:()=>{writable=false;},unreview:()=>{reviewed=false;},
  setTier:t=>{tier=t;},providerHook:fn=>{providerHook=fn;},commitHook:fn=>{commitHook=fn;}};
}
{
 const h=harness(),before=JSON.stringify(h.room);ok(await h.api.load('room',h.scope)===null&&h.calls.length===0,'Loading empty ideas starts no generation');
 const d=await h.api.generate('room',h.scope,{engine:h.api.ENGINES[0]});
 ok(h.calls.length===1&&h.calls[0].prompt.includes('2x2 grid')&&h.calls[0].prompt.includes('Long narrow cabin'),'One explicit request creates a four-view text-only inspiration sheet');
 ok(!h.calls[0].prompt.includes('NEVER_COPY_CAMERA'),'Ideas explore compositions without inheriting current camera poses');
 ok(!Object.keys(h.calls[0].opts).some(k=>/reference|imageUrl|image_url/i.test(k))&&h.calls[0].opts.noRetry===true,'No input images or automatic provider retry');
 ok(h.costs.every(c=>c.refs===0)&&h.calls[0].opts.assetId==='camera-ideas-room','Price and attribution describe a separate image with zero references');
 ok(h.writes.length===1&&h.writes[0].id==='camera-ideas-room'&&h.writes[0].refs.length===0,'Only the isolated inspiration slot is saved');
 ok(JSON.stringify(h.room)===before&&d.meta.inspirationOnly&&d.meta.kind==='camera-inspiration','Floor plan, cameras and canonical artwork stay untouched');
 ok(!h.api.accept&&!h.api.apply&&!h.api.assign,'There is no artwork-adoption, layout-application or camera-assignment API');
 ok(!h.api.pending(h.scope,'room'),'Confirmed saving clears the pending paid request');
 h.room.materials='Blue paint';ok((await h.api.load('room',h.scope)).stale,'Changed written requirements mark older ideas as outdated');
}
{
 const h=harness();const s=h.api.settings(h.api.ENGINES[1]);ok(s.quality==='high'&&h.costs.at(-1).refs===0,'The second engine is priced at its actual quality without a reference');
 await rejects(()=>h.api.generate('room',h.scope,{engine:'unsupported'}),/available image engine/);ok(h.calls.length===0,'Unsupported engines cannot spend');
 h.unreview();await rejects(()=>h.api.generate('room',h.scope),/Confirm the floor plan/);ok(h.calls.length===0,'Unreviewed plans cannot start paid ideas');
}
{
 const h=harness();h.readonly();await rejects(()=>h.api.generate('room',h.scope),/read-only/);ok(!h.calls.length&&!h.writes.length,'Read-only generation is refused before spending');
}
{
 const h=harness();h.providerHook(()=>h.filmSwitch());await rejects(()=>h.api.generate('room',h.scope),/film or sign-in changed/);ok(!h.calls.length&&!h.writes.length,'A film switch immediately before submission cannot spend or save');
}
{
 const h=harness();h.providerHook(()=>{h.room.spatialPlan.anchors[0].size[0]=2;});await rejects(()=>h.api.generate('room',h.scope),/floor plan or description changed/);ok(!h.calls.length,'A changed floor plan is checked at the paid submission boundary');
}
{
 const h=harness();h.providerHook(()=>{h.room.coverageViews[0].pose.position=[1,2,1.5];});await h.api.generate('room',h.scope);
 ok(h.calls.length===1,'Camera edits do not alter or invalidate the separate text/floor-plan inspiration request');
}
{
 const h=harness();let release;h.providerHook(()=>new Promise(r=>release=r));const first=h.api.generate('room',h.scope);
 await rejects(()=>h.api.generate('room',h.scope),/already being generated/);release();await first;ok(h.calls.length===1,'Duplicate clicks start only one paid request');
}
{
 const h=harness();h.setTier('local');await rejects(()=>h.api.generate('room',h.scope),/save was not confirmed/);
 ok(h.api.pending(h.scope,'room').hasUnsaved&&h.calls.length===1,'An uncertain cloud save retains completed pixels for recovery');
 await rejects(()=>h.api.generate('room',h.scope,{retryConfirmed:true}),/Retry saving/);h.setTier('cloud');await h.api.retrySave('room',h.scope);
 ok(h.calls.length===1&&h.writes.length===1&&!h.api.pending(h.scope,'room'),'Retry saving never charges for or generates another image');
}
{
 const h=harness();let fail=true;h.providerHook(()=>{if(fail)throw Error('provider uncertain');});await rejects(()=>h.api.generate('room',h.scope),/provider uncertain/);
 await rejects(()=>h.api.generate('room',h.scope),/earlier image request/);fail=false;
 await h.api.generate('room',h.scope,{retryConfirmed:true});ok(h.calls.length===1,'An uncertain request requires explicit acknowledgement before a new paid attempt');
}
{
 const h=harness();h.commitHook(()=>h.readonly());await rejects(()=>h.api.generate('room',h.scope),/read-only/);ok(h.writes.length===0,'Losing permission during saving cannot attach an image');
}
{
 const h=harness();h.store.set('camera-ideas-room',{url:'stored',meta:{kind:'location'}});
 await rejects(()=>h.api.load('room',h.scope),/not a camera-ideas draft/);
}
// The real help component: opening is free; its paid action is separate and read-only guarded.
{
 const h=harness();let hooks=[],cursor=0,effects=[],readonly=false,proposals=[];
 h.b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),
  useState:v=>{const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof v==='function'?v():v};return [hooks[i].value,v=>hooks[i].value=typeof v==='function'?v(hooks[i].value):v];},
  useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},
  useEffect:(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,k)=>v!==old.deps[k]))effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});hooks[i]={deps,cleanup:old?.cleanup};}};
 const src=readFileSync(compiled?'dist/app/camera-inspiration-ui.js':'app/camera-inspiration-ui.jsx','utf8');
 vm.runInContext(compiled?src:transformSync(src,{presets:['@babel/preset-react'],babelrc:false,configFile:false}).code,h.b);
 const flat=n=>!n||typeof n!=='object'?[]:[n,...(n.children||[]).flatMap(flat)],text=n=>n==null?'':typeof n==='object'?(n.children||[]).map(text).join(''):String(n);
 const render=()=>{cursor=0;effects=[];const tree=h.b.LocationCameraInspiration({l:h.room,readOnly:readonly,onPropose:p=>proposals.push(p)});effects.splice(0).forEach(fn=>fn());return tree;};
 let tree=render();tree=render();ok(!tree.props.open&&!h.calls.length,'The optional help starts collapsed and generates nothing');
 const details={open:true};tree.props.onToggle({target:details,currentTarget:details});tree=render();await new Promise(setImmediate);tree=render();
 ok(!h.calls.length&&text(tree).includes('image never changes Blender geometry'),'Opening help is free and explains its isolation');
 const generate=flat(tree).find(n=>n.type==='button'&&text(n).startsWith('Generate view ideas'));
 ok(generate&&!generate.props.disabled&&flat(generate).some(n=>n.props['data-refs']===0),'The explicit generation button shows a zero-reference image price');
 readonly=true;tree=render();const blocked=flat(tree).find(n=>n.type==='button'&&text(n).startsWith('Generate view ideas'));
 await blocked.props.onClick();ok(blocked.props.disabled&&!h.calls.length,'Read-only users cannot trigger the paid handler');
 readonly=false;tree=render();
 await flat(tree).find(n=>n.type==='button'&&text(n).startsWith('Generate view ideas')).props.onClick();tree=render();await new Promise(setImmediate);tree=render();
 ok(h.calls.length===1&&h.writes[0].id==='camera-ideas-room'&&flat(tree).some(n=>n.type==='img'),
   'The help button generates and displays its own image without touching the canonical location');
 ok(!flat(tree).some(n=>n.type==='button'&&/Use as|Apply|Use these cameras/.test(text(n))),
   'The rendered helper contains no adoption or camera-application control');
 let resolveMatch,matchCalls=0;
 h.b.KinolotCameraMatch={match:()=>{matchCalls++;return new Promise(resolve=>resolveMatch=resolve);}};
 h.b.InfoTip=function(){};
 tree=render();const match=flat(tree).find(n=>n.type==='button'&&text(n)==='Match these views to set');
 ok(match&&!match.props.disabled&&!text(tree).includes('including unsuccessful fits')&&!text(tree).includes('Matching:'),
   'Matching remains an explicit action without the removed per-attempt pricing paragraph');
 const actions=flat(tree).find(n=>n.props.className==='loc-camera-ideas-review-actions');
 ok(actions&&text(actions.children[0])==='Enlarge ideas'&&flat(actions.children[1]).includes(match),
   'Matching appears directly to the right of Enlarge ideas in the shared action row');
 const tip=flat(actions).find(n=>n.type===h.b.InfoTip);
 ok(tip?.props.text.includes('Experimental camera match')&&!text(tree).includes('Changed proportions or hidden features'),
   'The detailed matching explanation lives in the adjacent accessible tooltip instead of a standalone paragraph');
 const first=match.props.onClick(),again=match.props.onClick();await again;
 ok(matchCalls===1&&proposals.at(-1)===null,'Matching discards earlier unsaved proposals and guards duplicate clicks before React rerenders');
 resolveMatch({key:'fitted',panels:[]});await first;tree=render();
 ok(proposals.at(-1)?.key==='fitted'&&h.writes.length===1,'A fitted result goes to camera review without saving more images or camera data');
 readonly=true;tree=render();const readOnlyMatch=flat(tree).find(n=>n.type==='button'&&text(n)==='Match these views to set');
 await readOnlyMatch.props.onClick();ok(readOnlyMatch.props.disabled&&matchCalls===1,'Read-only users cannot start an image fit');
}
console.log('PASS camera inspiration: '+checks+' scope, billing-boundary, isolation, persistence, retry and UI checks');

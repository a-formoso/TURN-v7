/* Review workflow side effects with isolated identities, image/storage adapters and no model calls. */
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const compiled=process.env.STYLE_TEST_DIST==="1";
const source=readFileSync((compiled?"dist/app/":"app/")+"blender-style.js","utf8");
const clone=x=>structuredClone(x);
let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const rejects=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
function harness(){
  const store=new Map(),ls=new Map(),writes=[],calls=[];
  const scope={uid:"owner",projectId:"film",epoch:1};let current=scope,readonly=false,allowed=true,brief="night",scene={schema:1,layout:1};
  let generateHook=null,beforeCommit=null;
  const room={id:"room",name:"A working deck",materials:"painted steel",lighting:"warm practicals"};
  class Picture{constructor(){this.naturalWidth=640;this.naturalHeight=360;}set src(v){if(v)queueMicrotask(()=>this.onload?.());}}
  const b={console,crypto,setTimeout,clearTimeout,Image:Picture,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    dispatchEvent(){},location:{hostname:"localhost"},turnIsAdmin:true,
    localStorage:{getItem:k=>ls.get(k)||null,setItem:(k,v)=>ls.set(k,v),removeItem:k=>ls.delete(k)},
    document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>"data:image/png;base64,QkxFTkRFUg=="})},
    turnContinuity:{locations:[room]},turnArtRoomWritable:()=>!readonly,
    locVisualDefaults:()=>({renderStyle:"cinematic"}),turnLookbookBriefFor:()=>brief,
    nbPlanImageChoice:(model,res)=>({model,res}),nbGetModel:()=>"test-image",nbGetRes:()=>"2K",isGptImageModel:()=>false,
    nbGetOaiQuality:()=>"high",nbImageCostText:()=>"7",nbModelLabel:()=>"Image engine",
    BlenderPreview:{scope:()=>scope,isCurrent:s=>s.uid===current.uid&&s.projectId===current.projectId&&s.epoch===current.epoch},
    KinolotRenderContract:{canonical:JSON.stringify,hash:async s=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))).toString("hex")},
    KinolotCloudRender:{enabled:()=>b.location.hostname==="localhost"&&b.turnIsAdmin,buildScene:()=>clone(scene),request:async(action,body)=>{
      calls.push(action);if(!allowed)throw Error("Pilot access denied");if(action==="capabilities")return {};return {job:clone(job)};
    }},
    nbLoadDetailsAsset:async id=>clone(store.get(id)||{id,url:"",meta:null,refs:[]}),
    nbGenerate:async(prompt,opts)=>{
      if(generateHook)await generateHook("prepare",opts);
      await opts.beforeSubmit();calls.push("paid-image");
      if(generateHook)await generateHook("response",opts);
      return "data:image/png;base64,U1RZTEVE";
    },
    nbCommit:async(id,url,meta,refs,kind,epoch,cancelled,expected)=>{
      if(beforeCommit)await beforeCommit(id);
      if(cancelled())return {tier:"cancelled"};
      const old=store.get(id);
      if(expected&&(!!old?.url!==expected.exists||(old?.meta?.iso||"")!==expected.iso))return {tier:"error",error:"The artwork changed."};
      writes.push({id,expected,meta:clone(meta)});
      store.set(id,{id,url,meta:clone(meta),refs:clone(refs),history:[...(old?.url?[old]:[]),...(old?.history||[])]});
      return {tier:"cloud",url};
    },
    nbSetAssetApproval:async(id,iso,approved,reviewKey)=>{
      const d=store.get(id);if(d?.meta.iso!==iso)return {ok:false,error:"asset version changed"};
      d.meta.approval={iso,approved,reviewKey};return {ok:true,meta:clone(d.meta)};
    }
  };b.window=b;vm.createContext(b);vm.runInContext(source,b);
  let job;
  const ready=async()=>{job={id:"job",locationId:"room",status:"completed",sceneHash:await b.KinolotRenderContract.hash(JSON.stringify(scene)),result:{images:Object.fromEntries(["TL","TR","BL","BR"].map(p=>["colour_"+p,"data:image/png;base64,UE5H"]))}};return job;};
  store.set("room",{id:"room",url:"original-artwork",meta:{iso:"original",version:3},refs:[]});
  return {b,store,writes,calls,ls,scope,ready,api:()=>b.KinolotSetStyle,
    reload:()=>vm.runInContext(source,b),changeScope:()=>{current={...scope,projectId:"other",epoch:2};},
    layout:()=>scene.layout++,style:()=>{brief="day";},readonly:()=>{readonly=true;},deny:()=>{allowed=false;},
    hook:f=>{generateHook=f;},commitHook:f=>{beforeCommit=f;},job:()=>job};
}
{
  const h=harness(),job=await h.ready(),api=h.api();
  const original=clone(h.store.get("room"));
  const d=await api.generate("room",job,h.scope);
  ok(h.calls.filter(x=>x==="paid-image").length===1,"Exactly one image request");
  assert.deepEqual(h.store.get("room"),original);checks++;
  ok(h.writes.length===1&&h.writes[0].id!=="room","Generation writes only a separate draft");
  ok(d.meta.sceneHash===job.sceneHash&&d.source.startsWith("data:"),"Draft retains exact source revision and comparison pixels");
  h.reload();const restored=await h.api().load("room",h.scope);
  ok(restored.meta.iso===d.meta.iso&&restored.source===d.source,"Reload restores the draft and original comparison");
  await rejects(()=>h.api().accept("room",restored,h.scope,false),/Review all four/);
  ok(h.store.get("room").url===original.url,"Unchecked review cannot replace artwork");
  await h.api().accept("room",restored,h.scope,true);
  ok(h.store.get("room").meta.styleDraftIso===d.meta.iso,"Acceptance identifies the exact reviewed draft");
  ok(h.store.get("room").history[0].url===original.url,"Acceptance preserves previous artwork in history");
  ok(h.writes.at(-1).expected.iso==="original","Expected artwork version reaches the storage boundary");
  const count=h.writes.length;await h.api().accept("room",restored,h.scope,true);
  ok(h.writes.length===count,"Repeated acceptance is idempotent");
  await rejects(()=>h.api().reject("room",restored,h.scope),/already been used/);
}
{
  const h=harness(),job=await h.ready();
  h.hook(async phase=>{if(phase==="prepare")h.store.set("room",{url:"new",meta:{iso:"new"}});});
  await rejects(()=>h.api().generate("room",job,h.scope),/artwork changed before generation/);
  ok(!h.calls.includes("paid-image"),"A changed base artwork is checked at the last spending boundary");
}
{
  const h=harness(),d=await h.api().generate("room",await h.ready(),h.scope);
  await h.api().reject("room",d,h.scope);h.reload();
  const rejected=await h.api().load("room",h.scope);
  ok(rejected.meta.approval.approved===false&&h.store.get("room").url==="original-artwork","Rejection survives reload and leaves artwork unchanged");
  await rejects(()=>h.api().accept("room",rejected,h.scope,true),/rejected/);
}
for(const change of ["layout","style","readonly","changeScope"]){
  const h=harness(),d=await h.api().generate("room",await h.ready(),h.scope);h[change]();
  await rejects(()=>h.api().accept("room",d,h.scope,true),/changed|read-only/);
  ok(h.store.get("room").url==="original-artwork",change+" prevents replacement");
}
{
  const h=harness(),d=await h.api().generate("room",await h.ready(),h.scope);
  h.store.set("room",{url:"new-artwork",meta:{iso:"newer"},refs:[]});
  await rejects(()=>h.api().accept("room",d,h.scope,true),/artwork changed/);
  ok(h.store.get("room").url==="new-artwork","Newer artwork is preserved");
}
{
  const h=harness(),d=await h.api().generate("room",await h.ready(),h.scope);
  h.commitHook(async id=>{if(id==="room")h.store.set(id,{url:"concurrent",meta:{iso:"concurrent"}});});
  await rejects(()=>h.api().accept("room",d,h.scope,true),/artwork changed/);
  ok(h.store.get("room").url==="concurrent","Artwork changes during acceptance upload cannot be overwritten");
}
for(const phase of ["prepare","response"]){
  const h=harness(),job=await h.ready();h.hook(async p=>{if(p===phase)h.changeScope();});
  await rejects(()=>h.api().generate("room",job,h.scope),/changed/);
  ok(h.writes.length===0,"Film switch at "+phase+" cannot persist into either film");
  ok(h.calls.filter(x=>x==="paid-image").length===(phase==="prepare"?0:1),"Scope checked immediately before spending and after response");
}
{
  const h=harness(),job=await h.ready();h.deny();
  await rejects(()=>h.api().generate("room",job,h.scope),/access denied/);
  ok(!h.calls.includes("paid-image"),"Pilot capability refusal prevents spending");
}
{
  const h=harness(),job=await h.ready();h.layout();
  await rejects(()=>h.api().generate("room",job,h.scope),/current floor plan/);
  ok(!h.calls.includes("paid-image"),"Stale Blender result cannot be painted");
}
{
  const h=harness(),job=await h.ready();h.hook(async phase=>{if(phase==="response")throw Error("Uncertain transport");});
  await rejects(()=>h.api().generate("room",job,h.scope),/Uncertain/);h.reload();
  ok(h.api().pending(h.scope,"room").phase==="uncertain","Ambiguous generation persists a warning across reload");
  await rejects(()=>h.api().generate("room",job,h.scope),/earlier image request/);
  ok(h.calls.filter(x=>x==="paid-image").length===1,"No automatic or unacknowledged duplicate request");
  h.hook(null);await h.api().generate("room",job,h.scope,{retryConfirmed:true});
  ok(!h.api().pending(h.scope,"room"),"Explicit new request can recover and clear the warning");
}
{
  const h=harness(),job=await h.ready();let release;const wait=new Promise(r=>release=r);
  h.hook(async phase=>{if(phase==="response")await wait;});
  const first=h.api().generate("room",job,h.scope);
  while(!h.calls.includes("paid-image"))await new Promise(r=>setTimeout(r,1));
  await rejects(()=>h.api().generate("room",job,h.scope),/already in progress/);release();await first;
  ok(h.calls.filter(x=>x==="paid-image").length===1,"Double-clicks share one in-flight gate");
}
{
  const h=harness(),d=await h.api().generate("room",await h.ready(),h.scope);
  h.store.get(h.api().slot("room")).refs[0]={kind:"blender-style-source",deleted:true,url:""};
  await rejects(()=>h.api().load("room",h.scope),/source was removed/);
  h.b.location.hostname="kinolot.infinitestudioai.com";
  ok(!h.api().enabled(),"Live website cannot enable the pilot");
  await rejects(()=>h.api().generate("room",h.job(),h.scope),/changed/);
}
{
  const h=harness(),job=await h.ready();let fail=true;
  h.commitHook(async()=>{if(fail)throw Error("Temporary storage failure");});
  await rejects(()=>h.api().generate("room",job,h.scope),/storage failure/);
  ok(h.api().pending(h.scope,"room").hasUnsaved,"Failed save retains the generated pixels in the current session");
  fail=false;const saved=await h.api().retrySave("room",h.scope);
  ok(saved.url&&h.calls.filter(x=>x==="paid-image").length===1,"Retry saving does not submit or charge for another image");
  ok(!h.api().pending(h.scope,"room")&&h.store.get("room").url==="original-artwork","Successful save recovery clears the warning without adopting artwork");
}
{
  // Run the actual component and its acceptance handler against disposable storage.
  const h=harness(),job=await h.ready(),d=await h.api().generate("room",job,h.scope);
  h.b.nbOaiQualityLabel=x=>x;
  const states=[d,false,false,"","","",true,false,false,"all",50,0,0];let index=0;
  h.b.React={useState:initial=>{const i=index++;if(states[i]===undefined)states[i]=initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}];},
    useRef:v=>({current:v}),useEffect(){},createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  const render=(extra={})=>{index=0;return h.b.LocationSetStyle({location:h.b.turnContinuity.locations[0],job,sceneHash:job.sceneHash,...extra});};
  const find=(node,test)=>{if(!node||typeof node!=="object")return null;if(test(node))return node;for(const child of node.children||[]){const result=find(child,test);if(result)return result;}return null;};
  const button=(tree,label)=>find(tree,n=>n.type==="button"&&n.children.includes(label));
  let tree=render();
  ok(button(tree,"Use as location artwork").props.disabled,"Real review component disables acceptance until checked");
  ok(find(tree,n=>n.type==="dialog"&&n.props["aria-label"]==="Review style draft against Blender"),"Review uses an accessible native dialog");
  ok(find(tree,n=>n.type==="img"&&n.props.src===d.source),"Comparison displays the exact saved source");
  states[7]=true;tree=render();ok(button(tree,"Use as location artwork").props.disabled,"Even a checked review cannot accept images that have not loaded");
  find(tree,n=>n.type==="img"&&n.props.src===d.source).props.onLoad();
  find(tree,n=>n.type==="img"&&n.props.src===d.url).props.onLoad();
  tree=render();ok(!button(tree,"Use as location artwork").props.disabled,"Loading both images and checking review enables explicit acceptance");
  find(tree,n=>n.type==="img"&&n.props.src===d.source).props.onError();tree=render();
  ok(button(tree,"Use as location artwork").props.disabled,"A failed or expired comparison image blocks acceptance");
  find(tree,n=>n.type==="img"&&n.props.src===d.source).props.onLoad();
  tree=render({readOnly:true});ok(button(tree,"Use as location artwork").props.disabled&&button(tree,"Reject draft").props.disabled,"Read-only interface cannot accept or reject");
  tree=render({sceneHash:"changed"});ok(button(tree,"Use as location artwork").props.disabled,"Stale camera/layout revision disables acceptance in the interface");
  tree=render();await button(tree,"Use as location artwork").props.onClick();
  ok(h.store.get("room").meta.styleDraftIso===d.meta.iso,"Actual acceptance button handler adopts the reviewed pixels in disposable storage");
}
console.log("PASS cloud set styling: "+checks+" generation, review, persistence, race, ownership and no-retry checks");

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
function harness(initialScene){
  const store=new Map(),ls=new Map(),writes=[],calls=[];
  const scope={uid:"owner",projectId:"film",epoch:1};let current=scope,readonly=false,allowed=true,brief="night",scene=initialScene||{schema:1,layout:1};
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
    nbCostChip:(count,opts)=>({type:"span",props:{className:"nb-cost","data-model":opts.model,"data-quality":opts.quality},children:["7"]}),
    BlenderPreview:{scope:()=>scope,isCurrent:s=>s.uid===current.uid&&s.projectId===current.projectId&&s.epoch===current.epoch},
    KinolotRenderContract:{canonical:JSON.stringify,hash:async s=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(typeof s==="string"?s:JSON.stringify(s)))).toString("hex")},
    KinolotCloudRender:{enabled:()=>b.location.hostname==="localhost"&&b.turnIsAdmin,buildScene:()=>clone(scene),request:async(action,body)=>{
      calls.push(action);if(!allowed)throw Error("Pilot access denied");if(action==="capabilities")return {};
      // As the real service does: a job is only found inside the film it belongs to.
      if(/^job\.(get|cancel)$/.test(action)&&body?.projectId!==scope.projectId)throw Error("Render request not found in this film.");
      return {job:clone(job)};
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
    nbRevertAsset:async(id,index)=>{
      const row=store.get(id),history=(row?.history||[]).slice();if(!row||index<0||index>=history.length)return null;
      const chosen=history[index],present={url:row.url,meta:row.meta,refs:row.refs};
      store.set(id,{id,url:chosen.url,meta:chosen.meta,refs:chosen.refs||[],history:[present,...history.filter((_,i)=>i!==index)]});
      writes.push({id,revert:index});return {url:chosen.url,meta:chosen.meta};
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
  ok(await h.b.KinolotRenderContract.hash(d.meta.sourceScene)===job.sceneHash,"A new draft snapshots the exact verified numerical build inputs");
  ok(d.meta.prompt.includes("Keep netting and mesh open and see-through"),"Styling explicitly preserves the source mesh openings");
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
  const h=harness(),job=await h.ready(),api=h.api();
  await api.generate("room",job,h.scope);
  const row=h.store.get(api.slot("room")),snapshot=clone(row.meta.sourceScene);
  row.meta.sourceScene.layout=999;
  await rejects(()=>api.load("room",h.scope),/build inputs could not be verified/);
  row.meta.sourceScene=snapshot;
  ok(await api.load("room",h.scope),"An intact build snapshot loads successfully");
  delete row.meta.sourceScene;
  ok(await api.load("room",h.scope),"Older drafts without a numeric snapshot remain inspectable");
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
  const h=harness(),job=await h.ready(),api=h.api();
  h.hook(async phase=>{if(phase==="prepare")ok(api.cancel("room",h.scope).ok,"Cancellation is available before paid submission");});
  await rejects(()=>api.generate("room",job,h.scope),/cancelled/);
  ok(!h.calls.includes("paid-image")&&h.writes.length===0&&!api.pending(h.scope,"room"),"Pre-submission cancellation sends no paid request, saves nothing and clears the warning");
}
{
  const h=harness(),job=await h.ready(),api=h.api(),original=clone(h.store.get("room"));let release,started;
  const waiting=new Promise(r=>release=r),submitted=new Promise(r=>started=r);
  h.hook(async phase=>{if(phase==="response"){started();await waiting;}});
  const work=api.generate("room",job,h.scope);await submitted;
  const cancelled=api.cancel("room",h.scope);
  ok(cancelled.ok&&cancelled.submitted&&api.pending(h.scope,"room").cancelled,"In-flight cancellation records the possible paid request");
  await rejects(()=>api.generate("room",job,h.scope,{retryConfirmed:true}),/already in progress/);
  release();await rejects(()=>work,/cancelled/);
  ok(h.calls.filter(x=>x==="paid-image").length===1&&h.writes.length===0&&!h.store.has(api.slot("room")),"A late cancelled image is discarded rather than saved as a draft");
  assert.deepEqual(h.store.get("room"),original);checks++;
  ok(!api.pending(h.scope,"room").active&&!api.pending(h.scope,"room").hasUnsaved,"Cancelled pixels are not exposed through save recovery");
  await rejects(()=>api.generate("room",job,h.scope),/earlier image request/);
  h.hook(null);await api.generate("room",job,h.scope,{retryConfirmed:true});
  ok(h.calls.filter(x=>x==="paid-image").length===2,"A new paid attempt needs explicit acknowledgement after cancellation");
}
{
  const h=harness(),job=await h.ready(),api=h.api();let lateCancel;
  h.commitHook(async()=>{lateCancel=api.cancel("room",h.scope);});
  await api.generate("room",job,h.scope);
  ok(lateCancel.ok===false&&lateCancel.reason==="saving"&&h.store.has(api.slot("room")),"A stale Cancel click during persistence honestly reports saving rather than claiming to cancel a committed draft");
  ok(api.cancel("room",h.scope).ok===false,"No cancellation is reported after the request finishes");
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
  ok(button(tree,"Use as location image").props.disabled,"Real review component disables acceptance until checked");
  ok(find(tree,n=>n.type==="dialog"&&n.props["aria-label"]==="Review style draft against the built set"),"Review uses an accessible native dialog");
  ok(find(tree,n=>n.type==="img"&&n.props.src===d.source),"Comparison displays the exact saved source");
  ok(find(tree,n=>n.type===h.b.StyleGenerationDetails)?.props.meta===d.meta,"The Blender comparison receives the saved draft requirements");
  const requirements=h.b.StyleGenerationDetails({meta:{...d.meta,sourceScene:{name:"Original test set",objects:[{id:"net",name:"Saved net strand",position:[1,2,3],size:[.01,.01,1]}],cameras:{TL:{position:[0,0,1.6],yaw:0,pitch:-5,lensMm:24}},previewLights:[{position:[0,0,3],powerWatts:100,sizeMetres:1}],notes:["Original assumption"]}}});
  const contents=n=>typeof n==="string"?n:(n?.children||[]).map(contents).join(" ");
  ok(contents(requirements).includes(d.meta.prompt)&&contents(requirements).includes("Saved net strand")&&contents(requirements).includes("Original assumption"),"Requirements show the exact saved prompt, build geometry and assumptions");
  ok(contents(h.b.StyleGenerationDetails({meta:{prompt:"Legacy exact prompt"}})).includes("no saved numeric build snapshot"),"An older draft explicitly discloses that its original numeric inputs are unavailable");
  states[7]=true;tree=render();ok(button(tree,"Use as location image").props.disabled,"Even a checked review cannot accept images that have not loaded");
  find(tree,n=>n.type==="img"&&n.props.src===d.source).props.onLoad();
  find(tree,n=>n.type==="img"&&n.props.src===d.url&&n.props.onLoad).props.onLoad();   // the review's image, not the card's thumbnail
  tree=render();ok(!button(tree,"Use as location image").props.disabled,"Loading both images and checking review enables explicit acceptance");
  find(tree,n=>n.type==="img"&&n.props.src===d.source).props.onError();tree=render();
  ok(button(tree,"Use as location image").props.disabled,"A failed or expired comparison image blocks acceptance");
  find(tree,n=>n.type==="img"&&n.props.src===d.source).props.onLoad();
  tree=render({readOnly:true});ok(button(tree,"Use as location image").props.disabled&&button(tree,"Discard draft").props.disabled,"Read-only interface cannot accept or reject");
  tree=render({sceneHash:"changed"});ok(button(tree,"Use as location image").props.disabled,"Stale camera/layout revision disables acceptance in the interface");
  tree=render();await button(tree,"Use as location image").props.onClick();
  ok(h.store.get("room").meta.styleDraftIso===d.meta.iso,"Actual acceptance button handler adopts the reviewed pixels in disposable storage");
  states[0]=await h.api().load("room",h.scope);tree=render();
  ok(button(tree,"Open draft")&&find(tree,n=>n.props["data-testid"]==="style-draft-current"),"An accepted draft stays on the card and can be opened");
  ok(!find(find(tree,n=>n.props["data-testid"]==="style-draft-current"),b=>b.type==="button"&&b.children.includes("Discard draft")),"A used draft cannot be discarded from the card");
  states[0].meta.approval.approved=false;tree=render({sceneHash:"older"});
  ok(!find(tree,n=>n.props["data-testid"]==="style-draft-current")&&find(tree,n=>n.type==="p"&&n.children.some(c=>/You discarded the last draft/.test(c))),"A discarded draft leaves the card, and the card says so");
  states[18]={left:{url:"saved-nano",meta:{modelId:h.api().ENGINES[0],sceneHash:job.sceneHash}},right:{url:"saved-gpt",meta:{modelId:h.api().ENGINES[1]}}};
  tree=render();button(tree,"Compare engines").props.onClick();tree=render();
  ok(find(tree,n=>n.type==="img"&&n.props.src==="saved-nano")&&find(tree,n=>n.type==="img"&&n.props.src==="saved-gpt"),"Engine comparison displays both saved results");
  ok(find(tree,n=>n.type===h.b.StyleGenerationDetails)?.props.meta===states[18].left.meta&&find(tree,n=>n.type===h.b.StyleGenerationDetails)?.props.shared,"Engine comparison shows its saved shared requirements, not current editor notes");
  ok(!button(tree,"Use as location image")&&!button(tree,"Discard draft"),"Engine comparison has no artwork mutation controls");
  states[18]=null;tree=render();
  ok(!button(tree,"Use as location image"),"Losing the engine pair cannot fall through to artwork acceptance");
}
{
  // Actual UI cancellation with persistent hooks and a deferred provider response.
  const h=harness(),job=await h.ready();await h.api().generate("room",job,h.scope);
  const previous=clone(h.store.get(h.api().slot("room"))),writesBefore=h.writes.length;
  let hooks=[],cursor=0,effects=[];
  h.b.addEventListener=()=>{};h.b.removeEventListener=()=>{};h.b.setInterval=()=>1;h.b.clearInterval=()=>{};h.b.nbOaiQualityLabel=x=>x;
  h.b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),
    useState:v=>{const i=cursor++;if(!(i in hooks))hooks[i]={value:typeof v==="function"?v():v};return [hooks[i].value,v=>hooks[i].value=typeof v==="function"?v(hooks[i].value):v];},
    useRef:v=>{const i=cursor++;return hooks[i]||(hooks[i]={current:v});},
    useEffect:(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,k)=>v!==old.deps[k]))effects.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});hooks[i]={deps,cleanup:old?.cleanup};}};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  const flat=n=>!n||typeof n!=="object"?[]:[n,...(n.children||[]).flatMap(flat)],text=n=>n==null?"":typeof n==="object"?(n.children||[]).map(text).join(""):String(n);
  const render=()=>{cursor=0;effects=[];const tree=h.b.LocationSetStyle({location:h.b.turnContinuity.locations[0],job,sceneHash:job.sceneHash});effects.splice(0).forEach(fn=>fn());return tree;};
  const button=(tree,label)=>flat(tree).find(n=>n.type==="button"&&text(n).startsWith(label));
  let tree=render();
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,1));tree=render();if(button(tree,"Generate another style draft")&&!button(tree,"Generate another style draft").props.disabled)break;}
  ok(!button(tree,"Cancel"),"Cancel is hidden while style generation is idle");
  let release,started;const wait=new Promise(r=>release=r),sent=new Promise(r=>started=r);
  h.hook(async phase=>{if(phase==="response"){started();await wait;}});
  const work=button(tree,"Generate another style draft").props.onClick();await sent;tree=render();
  const row=flat(tree).find(n=>n.props.className==="loc-style-generate-row");
  ok(row.children[0].type==="button"&&row.children[1].type==="button"&&text(row.children[1])==="Cancel",
    "Cancel appears immediately to the right of the generating button in the same action row");
  button(tree,"Cancel").props.onClick();tree=render();
  ok(!button(tree,"Cancel")&&text(tree).includes("late image result will be discarded")&&text(tree).includes("may still be charged"),
    "Cancelling clears local progress immediately and explains already-started processing");
  release();await work;tree=render();
  ok(!flat(tree).some(n=>n.type==="dialog")&&h.writes.length===writesBefore,"A late cancelled response neither opens review nor saves another draft");
  assert.deepEqual(h.store.get(h.api().slot("room")),previous);checks++;
}
{
  // A location with a finished Blender job but no style draft yet (every location, the first time): the panel renders.
  const h=harness(),job=await h.ready();
  h.b.nbOaiQualityLabel=x=>x;
  const states=[null,false,false,"","","",false,false,false,"all",50,0,0];let index=0;
  h.b.React={useState:initial=>{const i=index++;if(states[i]===undefined)states[i]=initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}];},
    useRef:v=>({current:v}),useEffect(){},createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  let tree=null,error=null;
  try{tree=h.b.LocationSetStyle({location:h.b.turnContinuity.locations[0],job,sceneHash:job.sceneHash});}catch(e){error=e;}
  ok(!error&&tree,"The panel renders before any style draft exists ("+(error&&error.message)+")");
  const find=(node,test)=>{if(!node||typeof node!=="object")return null;if(test(node))return node;for(const child of node.children||[]){const result=find(child,test);if(result)return result;}return null;};
  ok(!find(tree,n=>n.type==="button"&&n.children.includes("Use as location image")),"Without a draft there is nothing to accept");
  ok(!find(tree,n=>n.props&&n.props["data-testid"]==="style-drafts"),"No drafts box before a draft exists");
  ok(!find(tree,n=>n.type==="button"&&(n.children.includes("Review draft")||n.children.includes("Compare engines"))),"Review and engine comparison appear only when there is something to open");
  ok(find(tree,n=>n.props&&n.props["data-testid"]==="style-intro"&&/kept below until you discard it/.test(n.children.join(""))),"The step says what it does and that drafts are kept");
}
{
  // Engine choice (owner 2026-10-31): Nano Banana 2.1 by default, GPT Image 2.6 Sunburst at High on request.
  const h=harness(),job=await h.ready(),api=h.api();
  h.b.isGptImageModel=m=>/^gpt-image/.test(m);
  ok(api.ENGINES[0]==="gemini-nano-banana-2.1"&&api.ENGINES[1]==="gpt-image-2.6-sunburst","Style preview offers Nano Banana 2.1 first and GPT Image 2.6 Sunburst");
  ok(api.settings().model==="gemini-nano-banana-2.1"&&api.settings().quality===undefined,"The default style engine is Nano Banana 2.1, whatever the top bar's engine");
  const sun=api.settings("gpt-image-2.6-sunburst");
  ok(sun.model==="gpt-image-2.6-sunburst"&&sun.quality==="high","Sunburst runs at High by default");
  ok(!api.ENGINES.includes("gpt-image-2.5-sunburst"),"Style preview removes 2.5 from new-generation choices");
  ok(!api.ENGINES.includes("gpt-image-2.6-flare"),"Style preview adds only 2.6 Sunburst, not Flare");
  for(const model of ["gpt-image-2.6-sunburst"]){
    ok(api.ENGINES.includes(model)&&api.settings(model).model===model&&api.settings(model).quality==="high","Style preview offers "+model+" at High");
  }
  ok(api.settings("some-other-engine").model==="gemini-nano-banana-2.1","An unknown engine falls back to the default");
  h.b.nbPlanImageChoice=(model,res)=>({model:"gemini-nano-banana-2.1",res:"1K",limited:true});
  ok(api.settings("gpt-image-2.6-sunburst").model==="gemini-nano-banana-2.1","The plan gate still decides what really runs");
  h.b.nbPlanImageChoice=(model,res)=>({model,res});
  h.b.nbOaiQualityLabel=x=>x;
  const states=[null,false,false,"","","",false,false,false,"all",50,0,0];let index=0;
  h.b.React={useState:initial=>{const i=index++;if(states[i]===undefined)states[i]=initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}];},
    useRef:v=>({current:v}),useEffect(){},createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  const find=(node,test)=>{if(!node||typeof node!=="object")return null;if(test(node))return node;for(const child of node.children||[]){const result=find(child,test);if(result)return result;}return null;};
  const render=()=>{index=0;return h.b.LocationSetStyle({location:h.b.turnContinuity.locations[0],job,sceneHash:job.sceneHash});};
  let tree=render(),select=find(tree,n=>n.type==="select");
  ok(select&&select.props.value==="gemini-nano-banana-2.1"&&select.children.filter(c=>c.type==="option").length===2,"The panel shows both engine choices, set to Nano Banana 2.1");
  const seen=[];h.hook(async(phase,opts)=>{if(phase==="prepare")seen.push([opts.model,opts.quality]);});
  select.props.onChange({target:{value:"gpt-image-2.6-sunburst"}});tree=render();
  ok(find(tree,n=>n.type==="select").props.value==="gpt-image-2.6-sunburst","Choosing Sunburst updates the panel");
  const go=find(tree,n=>n.type==="button"&&String(n.children[0]||"").startsWith("Generate style draft"));
  const chip=go&&go.children.find(c=>c&&c.props&&c.props.className==="nb-cost");
  ok(go.children[0]==="Generate style draft"&&chip&&chip.children[0]==="7"&&chip.props["data-model"]==="gpt-image-2.6-sunburst"&&chip.props["data-quality"]==="high",
    "The button carries the same credit chip as Generate new image, priced for the chosen engine");
  ok(!go.children.some(c=>typeof c==="string"&&/credits/.test(c)),"No 'credits' text on the button");
  ok(!find(tree,n=>n.type==="p"&&n.children.some(c=>/estimated/.test(c))),"No separate estimate line");
  ok(find(tree,n=>n.type==="select").children.every(o=>o.children.length===1&&o.children[0]==="Image engine"),"Options are just the engine names");
  await go.props.onClick();
  ok(seen.length===1&&seen[0][0]==="gpt-image-2.6-sunburst"&&seen[0][1]==="high","Generate sends the chosen engine (Sunburst at High) in one paid call");
  for(const model of ["gpt-image-2.6-sunburst"]){
    find(render(),n=>n.type==="select").props.onChange({target:{value:model}});tree=render();
    const generate=find(tree,n=>n.type==="button"&&/^Generate (another )?style draft$/.test(String(n.children[0]||"")));
    const price=generate.children.find(c=>c?.props?.className==="nb-cost");
    ok(price.props["data-model"]===model&&price.props["data-quality"]==="high","The selected 2.6 engine drives the price chip");
    const before=seen.length;await generate.props.onClick();
    ok(seen.length===before+1&&seen.at(-1)[0]===model&&seen.at(-1)[1]==="high","The selected 2.6 engine is sent once at High");
  }
}
{
  // Progress while a draft is made, and only the buttons that do something.
  const h=harness(),job=await h.ready();
  h.b.nbOaiQualityLabel=x=>x;h.b.nbModelLabel=m=>m==="gpt-image-2.5-sunburst"?"GPT Image 2.5 Sunburst":"Nano Banana 2.1";
  const api=h.api();
  ok(api.estimateSeconds("gemini-nano-banana-2.1")===35&&api.estimateSeconds("gpt-image-2.5-sunburst")===45,"Measured image times give the estimate");
  const phases=[];h.hook(async(p)=>{if(p==="prepare")phases.push("submitted");});
  await api.generate("room",job,h.scope,{onPhase:p=>phases.push(p)});
  ok(phases.join(",")==="generating,submitted,saving","The draft reports generating before the paid call and saving after it");
  h.b.React={useState:v=>[v,()=>{}],useEffect(){},useRef:v=>({current:v}),
    createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  const text=n=>JSON.stringify(n);const bar=n=>JSON.stringify(n).match(/"aria-valuenow":(\d+)/)[1]*1;
  const t=Date.parse("2026-11-01T12:00:00Z");
  let n=h.b.styleProgress({phase:"generating",since:t,now:t+12000,model:"gemini-nano-banana-2.1",api});
  ok(/Generating with Nano Banana 2.1 · 0:12 of about 0:35/.test(text(n))&&bar(n)===34,"Generating: engine, time so far, estimate and the bar");
  n=h.b.styleProgress({phase:"generating",since:t,now:t+70000,model:"gpt-image-2.5-sunburst",api});
  ok(/Taking longer than usual · 1:10 so far/.test(text(n))&&bar(n)===95,"Past the estimate: says so; the bar stops short");
  n=h.b.styleProgress({phase:"saving",since:t,now:t+1000,model:"gemini-nano-banana-2.1",api});
  ok(/Saving the draft/.test(text(n))&&bar(n)===96,"Saving: almost done, never 100%");
  const ui=readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8");
  ok(!/Refresh draft/.test(ui),"No Refresh draft button: the panel reloads the draft itself");
  ok(!ui.includes("Compare with Blender")&&ui.includes('"Review draft"')&&ui.includes('"Compare engines"'),"The review is named for what it does; engines are compared from the drafts");
  ok(ui.includes("This draft is out of date: the set or its look changed after it was made, so it can't become the location image. Click Generate another style draft to make a new one."),
    "An out-of-date draft says why and which button to click");
  ok(!ui.includes("style brief changed"),"No more 'layout, cameras or style brief changed'");
  ok(/!busy&&pending\?\.hasUnsaved/.test(ui)||compiled,"The unsaved warning waits until saving has finished");
}
{
  // A draft read back from storage is a signed address, not data: Use as location artwork downloads its pixels
  // and saves those (the error "The generated image data is invalid…" came from passing the address).
  const h=harness(),job=await h.ready(),d=await h.api().generate("room",job,h.scope);
  const slot=h.api().slot("room");h.store.set(slot,{...h.store.get(slot),url:"https://storage.test/draft.png"});
  const fetched=[];
  h.b.fetch=async u=>{fetched.push(u);return {ok:true,blob:async()=>new Blob([Buffer.from("PIXELS")],{type:"image/png"})};};
  h.b.FileReader=class{readAsDataURL(b){b.arrayBuffer().then(a=>{this.result="data:image/png;base64,"+Buffer.from(a).toString("base64");this.onload();});}};
  const stored=await h.api().load("room",h.scope);
  await h.api().accept("room",stored,h.scope,true);
  ok(fetched.includes("https://storage.test/draft.png")&&h.store.get("room").url==="data:image/png;base64,"+Buffer.from("PIXELS").toString("base64"),
    "A stored draft's pixels are downloaded and saved as the location image");
  const h2=harness(),job2=await h2.ready(),d2=await h2.api().generate("room",job2,h2.scope);
  const slot2=h2.api().slot("room");h2.store.set(slot2,{...h2.store.get(slot2),url:"https://storage.test/gone.png"});
  h2.b.fetch=async()=>({ok:false,status:404});
  await rejects(async()=>h2.api().accept("room",await h2.api().load("room",h2.scope),h2.scope,true),/could not be downloaded/);
  ok(h2.store.get("room").url==="original-artwork","A draft that can't be downloaded leaves the location image unchanged");
  h2.b.fetch=async()=>({ok:true,blob:async()=>new Blob(["<html>"],{type:"text/html"})});
  await rejects(async()=>h2.api().accept("room",await h2.api().load("room",h2.scope),h2.scope,true),/could not be read/);
}
{
  const h=harness(),job=await h.ready(),api=h.api();
  const a=await api.generate("room",job,h.scope,{settings:api.settings(api.ENGINES[0])});
  const b=await api.generate("room",job,h.scope,{settings:api.settings(api.ENGINES[1])});
  const before=h.calls.filter(x=>x==="paid-image").length,writes=h.writes.length;
  const pair=await api.comparisonPair("room",h.scope);
  ok(pair.left.meta.modelId===api.ENGINES[0]&&pair.right.meta.modelId===api.ENGINES[1],"Saved current/history versions form an ordered engine pair");
  ok(h.calls.filter(x=>x==="paid-image").length===before&&h.writes.length===writes,"Comparison does not generate, bill, copy or adopt images");
  const row=h.store.get(api.slot("room"));
  for(const k of ["sourceJobId","sceneHash","briefKey","prompt"]){
    const old=row.meta[k];row.meta[k]="different";
    ok(await api.comparisonPair("room",h.scope)===null,"Engine comparison refuses mismatched "+k);row.meta[k]=old;
  }
  row.meta.projectId="another-film";
  ok(await api.comparisonPair("room",h.scope)===null,"Cross-film versions cannot become comparison inputs");row.meta.projectId=h.scope.projectId;
  row.refs[0]={kind:"blender-style-source",deleted:true,url:""};
  ok(await api.comparisonPair("room",h.scope)===null,"A purged source is not restored for comparison");row.refs=b.refs;
  row.history.unshift({...a,meta:{...a.meta,stateKey:"another-state"}});
  ok((await api.comparisonPair("room",h.scope)).left.meta.iso===a.meta.iso,"Another moving-part state cannot displace the matching version");
  h.readonly();
  ok(await api.comparisonPair("room",h.scope),"Read-only film access may inspect a saved comparison");
  ok(await api.load("room",h.scope),"Read-only film access may load the Blender comparison");
  await rejects(()=>api.generate("room",job,h.scope),/read-only/);
  h.changeScope();await rejects(()=>api.comparisonPair("room",h.scope),/sign-in changed/);
}
{
  const h=harness(),job=await h.ready(),api=h.api();
  const draft=await api.generate("room",job,h.scope,{settings:api.settings("gpt-image-2.6-sunburst")});
  const row=h.store.get(api.slot("room"));
  row.history=[{...draft,meta:{...draft.meta,modelId:"gpt-image-2.5-sunburst",iso:"2026-10-31T12:00:00.000Z"}}];
  const before=h.calls.filter(x=>x==="paid-image").length,pair=await api.comparisonPair("room",h.scope);
  ok(pair.left.meta.modelId==="gpt-image-2.6-sunburst"&&pair.right.meta.modelId==="gpt-image-2.5-sunburst","Existing 2.5 drafts remain comparable after removal from the picker");
  ok(h.calls.filter(x=>x==="paid-image").length===before,"Inspecting an existing 2.5 comparison makes no image call");
}
{
  const numeric={schema:"kinolot-cloud-set-v2",authoring:"mcp-procedural-v1",materials:{light:{emissionStrength:4},wall:{}},
    objects:[{id:"lamp",anchorId:"sink-light",name:"Sink light · diffuser",material:"light"},{id:"wall",name:"Wall",material:"wall"}]};
  const h=harness(numeric),job=await h.ready(),api=h.api();
  job.result.report={renderer:"cloud-mcp-v1",visibleObjects:{TL:["lamp","wall"],TR:["wall"],BL:["wall"],BR:["wall"]}};
  const draft=await api.generate("room",job,h.scope);
  ok(draft.meta.sourceScene.schema===numeric.schema&&draft.meta.sourceScene.authoring===numeric.authoring,"A detailed draft retains its versioned numerical authoring inputs");
  ok(draft.meta.prompt.includes("TL: Sink light")&&draft.meta.prompt.includes("TR: no modeled emissive fitting is visible"),"Detailed styling receives the completed build's fitting visibility");
  ok(h.store.get("room").url==="original-artwork","Detailed generation remains a separate saved draft");
  await rejects(()=>api.accept("room",draft,h.scope,false),/Review all four/);
  await api.accept("room",draft,h.scope,true);
  ok(h.store.get("room").meta.sourceScene.schema===numeric.schema&&h.store.get("room").history[0].url==="original-artwork","Explicit detailed-draft approval retains its source version and previous artwork");
}
{
  // DRAFTS STAY ON THE CARD (owner 2026-11-15): earlier drafts are listed, a discarded one is not, and an earlier one
  // can be made current again without an image call; only the current draft can become the location image.
  const h=harness(),job=await h.ready(),api=h.api();
  const first=await api.generate("room",job,h.scope,{settings:api.settings(api.ENGINES[0])});
  await new Promise(r=>setTimeout(r,3));
  const second=await api.generate("room",job,h.scope,{settings:api.settings(api.ENGINES[1])});
  const paid=()=>h.calls.filter(x=>x==="paid-image").length,before=paid();
  let list=await api.earlier("room",h.scope);
  ok(list.length===1&&list[0].meta.iso===first.meta.iso&&list[0].url&&list[0].source===first.source,"The draft made before the current one is kept, with the views it was made from");
  ok((await api.load("room",h.scope)).meta.iso===second.meta.iso,"The newest draft is the current one");
  await rejects(()=>api.accept("room",first,h.scope,true),/newer draft/);
  const back=await api.restore("room",first.meta.iso,h.scope);
  ok(back.meta.iso===first.meta.iso&&back.source===first.source&&paid()===before,"An earlier draft becomes the current one again without an image call");
  list=await api.earlier("room",h.scope);
  ok(list.length===1&&list[0].meta.iso===second.meta.iso,"The draft it replaced joins the earlier drafts: nothing is lost");
  ok(h.store.get("room").url==="original-artwork","Bringing a draft back never touches the location image");
  await api.reject("room",back,h.scope);
  await api.restore("room",second.meta.iso,h.scope);
  ok((await api.earlier("room",h.scope)).length===0&&h.store.get(api.slot("room")).history.length===1,"A discarded draft leaves the list but is not deleted");
  await rejects(()=>api.restore("room","2020-01-01T00:00:00.000Z",h.scope),/no longer saved/);
  await api.accept("room",await api.load("room",h.scope),h.scope,true);
  ok(h.store.get("room").meta.styleDraftIso===second.meta.iso,"A draft brought back can become the location image");
  const other=h.store.get(api.slot("room"));other.history.unshift({url:"x",meta:{...first.meta,projectId:"another-film",iso:"2026-11-01T00:00:00.000Z"},refs:[]});
  ok(!(await api.earlier("room",h.scope)).some(d=>d.url==="x"),"Another film's version is never listed as a draft");
  h.readonly();
  ok(Array.isArray(await api.earlier("room",h.scope)),"A read-only film may look at its kept drafts");
  await rejects(()=>api.restore("room",first.meta.iso,h.scope),/read-only/);
}
{
  // The card shows the kept drafts; an earlier one opens in the review with one action, and no way to use it directly.
  const h=harness(),job=await h.ready(),api=h.api();
  const first=await api.generate("room",job,h.scope,{settings:api.settings(api.ENGINES[0])});
  await new Promise(r=>setTimeout(r,3));
  const second=await api.generate("room",job,h.scope,{settings:api.settings(api.ENGINES[1])});
  h.b.nbOaiQualityLabel=x=>x;
  const states=[await api.load("room",h.scope),false,false,"","","",false,false,false,"all",50,0,0];let index=0;
  h.b.React={useState:initial=>{const i=index++;if(states[i]===undefined)states[i]=initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}];},
    useRef:v=>({current:v}),useEffect(){},Fragment:"fragment",createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  const render=(extra={})=>{index=0;return h.b.LocationSetStyle({location:h.b.turnContinuity.locations[0],job,sceneHash:job.sceneHash,...extra});};
  const find=(node,test)=>{if(!node||typeof node!=="object")return null;if(test(node))return node;for(const child of node.children||[]){const result=find(child,test);if(result)return result;}return null;};
  const all=(node,test,out=[])=>{if(!node||typeof node!=="object")return out;if(test(node))out.push(node);for(const child of node.children||[])all(child,test,out);return out;};
  const button=(tree,label)=>find(tree,n=>n.type==="button"&&n.children.includes(label));
  let tree=render();
  const box=find(tree,n=>n.props["data-testid"]==="style-drafts"),now=find(tree,n=>n.props["data-testid"]==="style-draft-current");
  ok(box&&now&&find(now,n=>n.type==="img"&&n.props.src===states[0].url),"The current draft is shown in the section itself, not only in the review");
  ok(button(now,"Review draft")&&button(now,"Discard draft")&&!find(tree,n=>n.type==="dialog"),"It can be reviewed or discarded from the card, with the review closed");
  ok(find(now,n=>n.type==="p"&&n.children.some(c=>/Not used yet\./.test(c))),"The card says the draft has not been used");
  states[20]=await api.earlier("room",h.scope);tree=render();
  const strip=find(tree,n=>n.props["data-testid"]==="style-drafts-earlier");
  ok(strip&&all(strip,n=>n.type==="img").length===1&&find(strip,n=>n.type==="img"&&n.props.src===first.url),"Earlier drafts are listed under the current one");
  find(strip,n=>n.type==="button").props.onClick();tree=render();
  const dialog=find(tree,n=>n.type==="dialog");
  ok(dialog&&find(dialog,n=>n.type==="h3"&&n.children.includes("Earlier style draft"))&&find(dialog,n=>n.type==="img"&&n.props.src===first.url),"Opening an earlier draft shows that draft");
  ok(button(dialog,"Make this the current draft")&&!button(dialog,"Use as location image")&&!button(dialog,"Discard draft"),"An earlier draft is looked at or made current; it is never used directly");
  await button(dialog,"Make this the current draft").props.onClick();
  ok(states[0].meta.iso===first.meta.iso&&states[21]===null&&states[6]===false,"Make this the current draft swaps the drafts and closes the review");
  ok(h.calls.filter(x=>x==="paid-image").length===2&&h.store.get("room").url==="original-artwork","No image call and no change to the location image");
  tree=render({readOnly:true});
  ok(button(find(tree,n=>n.props["data-testid"]==="style-draft-current"),"Discard draft").props.disabled,"A read-only film cannot discard a draft");
}
console.log("PASS cloud set styling: "+checks+" generation, comparison, persistence, race, ownership and no-retry checks");

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
    nbCostChip:(count,opts)=>({type:"span",props:{className:"nb-cost","data-model":opts.model,"data-quality":opts.quality},children:["7"]}),
    BlenderPreview:{scope:()=>scope,isCurrent:s=>s.uid===current.uid&&s.projectId===current.projectId&&s.epoch===current.epoch},
    KinolotRenderContract:{canonical:JSON.stringify,hash:async s=>Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))).toString("hex")},
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
  ok(!find(tree,n=>n.type==="button"&&n.children.includes("Use as location artwork")),"Without a draft there is nothing to accept");
}
{
  // Engine choice (owner 2026-10-31): Nano Banana 2.1 by default, GPT Image 2.5 Sunburst at High on request.
  const h=harness(),job=await h.ready(),api=h.api();
  h.b.isGptImageModel=m=>/^gpt-image/.test(m);
  ok(api.ENGINES[0]==="gemini-nano-banana-2.1"&&api.ENGINES[1]==="gpt-image-2.5-sunburst","Style preview offers Nano Banana 2.1 first and GPT Image 2.5 Sunburst");
  ok(api.settings().model==="gemini-nano-banana-2.1"&&api.settings().quality===undefined,"The default style engine is Nano Banana 2.1, whatever the top bar's engine");
  const sun=api.settings("gpt-image-2.5-sunburst");
  ok(sun.model==="gpt-image-2.5-sunburst"&&sun.quality==="high","Sunburst runs at High, the tested setting");
  ok(api.settings("some-other-engine").model==="gemini-nano-banana-2.1","An unknown engine falls back to the default");
  h.b.nbPlanImageChoice=(model,res)=>({model:"gemini-nano-banana-2.1",res:"1K",limited:true});
  ok(api.settings("gpt-image-2.5-sunburst").model==="gemini-nano-banana-2.1","The plan gate still decides what really runs");
  h.b.nbPlanImageChoice=(model,res)=>({model,res});
  h.b.nbOaiQualityLabel=x=>x;
  const states=[null,false,false,"","","",false,false,false,"all",50,0,0];let index=0;
  h.b.React={useState:initial=>{const i=index++;if(states[i]===undefined)states[i]=initial;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}];},
    useRef:v=>({current:v}),useEffect(){},createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
  vm.runInContext(readFileSync(compiled?"dist/app/blender-style-ui.js":"app/blender-style-ui.jsx","utf8"),h.b);
  const find=(node,test)=>{if(!node||typeof node!=="object")return null;if(test(node))return node;for(const child of node.children||[]){const result=find(child,test);if(result)return result;}return null;};
  const render=()=>{index=0;return h.b.LocationSetStyle({location:h.b.turnContinuity.locations[0],job,sceneHash:job.sceneHash});};
  let tree=render(),select=find(tree,n=>n.type==="select");
  ok(select&&select.props.value==="gemini-nano-banana-2.1"&&select.children.filter(c=>c.type==="option").length===2,"The panel shows an engine choice, set to Nano Banana 2.1");
  const seen=[];h.hook(async(phase,opts)=>{if(phase==="prepare")seen.push([opts.model,opts.quality]);});
  select.props.onChange({target:{value:"gpt-image-2.5-sunburst"}});tree=render();
  ok(find(tree,n=>n.type==="select").props.value==="gpt-image-2.5-sunburst","Choosing Sunburst updates the panel");
  const go=find(tree,n=>n.type==="button"&&String(n.children[0]||"").startsWith("Generate style draft"));
  const chip=go&&go.children.find(c=>c&&c.props&&c.props.className==="nb-cost");
  ok(go.children[0]==="Generate style draft"&&chip&&chip.children[0]==="7"&&chip.props["data-model"]==="gpt-image-2.5-sunburst"&&chip.props["data-quality"]==="high",
    "The button carries the same credit chip as Generate new image, priced for the chosen engine");
  ok(!go.children.some(c=>typeof c==="string"&&/credits/.test(c)),"No 'credits' text on the button");
  ok(!find(tree,n=>n.type==="p"&&n.children.some(c=>/estimated/.test(c))),"No separate estimate line");
  ok(find(tree,n=>n.type==="select").children.every(o=>o.children.length===1&&o.children[0]==="Image engine"),"Options are just the engine names");
  await go.props.onClick();
  ok(seen.length===1&&seen[0][0]==="gpt-image-2.5-sunburst"&&seen[0][1]==="high","Generate sends the chosen engine (Sunburst at High) in one paid call");
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
  ok(/draft&&!decided&&!stale&&E\("button"/.test(ui)||compiled,"Review draft only while the draft is undecided and current");
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
console.log("PASS cloud set styling: "+checks+" generation, review, persistence, race, ownership and no-retry checks");

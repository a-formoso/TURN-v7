/* Seven Writers' Room integration regressions. Real application functions with
   deterministic service replies: no live requests, database writes or credits. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = p=>readFileSync(p,"utf8"), plain = x=>JSON.parse(JSON.stringify(x));
const files = Object.fromEntries(["agents","agents-ui","ai","app","newstory","artroom","script"].map(n=>[n,read("app/"+n+".jsx")]));
const ast = Object.fromEntries(Object.entries(files).map(([n,s])=>[n,parseSync(s,{sourceType:"script"})]));
function declaration(file,name){
  const n=ast[file].program.body.find(n=>n.type==="FunctionDeclaration" && n.id.name===name);
  assert.ok(n,"Missing "+name); return files[file].slice(n.start,n.end);
}
function find(node,predicate){
  if(!node || typeof node!=="object") return null;
  if(predicate(node)) return node;
  for(const value of Object.values(node)){
    if(Array.isArray(value)){ for(const n of value){ const got=find(n,predicate); if(got) return got; } }
    else if(value && typeof value==="object"){ const got=find(value,predicate); if(got) return got; }
  }
  return null;
}
const element=(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}});
const noop=()=>{}, icons=new Proxy({}, {get:()=>noop});
function box(extra={}){
  const b={console,React:{createElement:element,useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),
    useEffect:noop,useMemo:f=>f(),useCallback:f=>f,Fragment:"Fragment"},
    Icon:icons, setTimeout:f=>(f(),0),clearTimeout:noop,...extra};
  b.window=b; vm.createContext(b); return b;
}
function load(b,file,names){ for(const name of names) vm.runInContext(declaration(file,name),b); }
function agentsBox(extra={}){
  const b=box({chargeStr:String,...extra});
  vm.runInContext(read("app/frameworks.jsx"),b);
  vm.runInContext(read("app/build-state.js"),b);   // the one rule for "unwritten" (2026-11-11)
  vm.runInContext(files.agents,b);
  return b;
}
function context(b,model,ai={}){
  const events=[], cards=[];
  return {model,project:model.project||{},facts:(model.project||{}).continuityFacts||{},input:"A story",ai:{available:true,...ai},
    cancelled:()=>false,sync:noop,emit:e=>events.push(e),propose:async c=>(cards.push(c),true),events,cards};
}
const scene={id:"s1",no:1,title:"A choice",act:1,driver:"sora",openCharge:1,closeCharge:-1};
const draft={blocks:[{type:"action",text:"The writer's existing screenplay."}],ai:true};
const model=()=>({scenes:[{...scene}],beats:{s1:{rows:[]}},drafts:{s1:draft},continuity:{},project:{}});
let checks=0;
async function test(name,f){ await f(); console.log("PASS",name); checks++; }

await test("both check panels render after the actual application load order",()=>{
  const b=box();
  const html=read("TURN.html"); assert.ok(html.indexOf("app/artroom.jsx")<html.indexOf("app/script.jsx"));
  load(b,"artroom",["_qaTitleRow","CharacterScriptCheckReport"]);   // (2026-11-17) the report's title row is a function of its own
  load(b,"script",["ScriptCheckReport"]);
  assert.notEqual(b.CharacterScriptCheckReport,b.ScriptCheckReport);
  assert.doesNotThrow(()=>b.CharacterScriptCheckReport({c:{name:"空"},report:{checked:1,mismatches:[]}}));
  assert.doesNotThrow(()=>b.ScriptCheckReport({scene,report:{issues:[],units:[],stats:{}}}));
  const button=declaration("artroom","ScriptCheckButton");
  assert.ok(button.includes("React.createElement(CharacterScriptCheckReport,"));
});

await test("empty beat maps are retried without rewriting an existing screenplay",async()=>{
  const b=agentsBox(); let authored=0, drafted=0;
  const m=model();
  const ctx=context(b,m,{authorScene:async()=>++authored===1?null:{patch:{},beats:{rows:[{n:1,action:"A choice"}]}},
    draftScene:async()=>{drafted++;return draft;}});
  const r=await b.writeScenesSeq(ctx,[0]);
  assert.equal(authored,2); assert.equal(drafted,0); assert.equal(m.drafts.s1,draft);
  assert.equal(m.beats.s1.rows.length,1); assert.equal(r.failures.length,0);
});
await test("failed beat-only retries remain outstanding and keep the screenplay",async()=>{
  const b=agentsBox(); const m=model(); let calls=0;
  const r=await b.writeScenesSeq(context(b,m,{authorScene:async()=>{calls++;return null;},
    draftScene:async()=>{throw new Error("Must not rewrite");}}),[0]);
  assert.equal(calls,4); assert.equal(r.failures.length,1); assert.equal(m.drafts.s1,draft);
});
await test("beat-only recovery reads the existing screenplay rather than inventing new beats",async()=>{
  const b=agentsBox(); const m=model(); let reads=0;
  const r=await b.writeScenesSeq(context(b,m,{beatsFromScript:async(s,d)=>{
    reads++; assert.equal(d,draft); return reads===1?null:{rows:[{n:1,drive:{d:"The existing action"}}]};
  },authorScene:async()=>{throw new Error("Must read the screenplay");},
  draftScene:async()=>{throw new Error("Must keep the screenplay");}}),[0]);
  assert.equal(reads,2); assert.equal(r.failures.length,0); assert.equal(m.drafts.s1,draft);
});
await test("an exception in beat reconstruction cannot turn its retry into a screenplay rewrite",async()=>{
  const b=agentsBox(); const m=model(); let reads=0,rewrites=0;
  const r=await b.writeScenesSeq(context(b,m,{beatsFromScript:async()=>{reads++;throw new Error("Service failed");},
    draftScene:async()=>{rewrites++;return draft;}}),[0]);
  assert.equal(reads,2); assert.equal(rewrites,0); assert.equal(m.drafts.s1,draft); assert.equal(r.failures.length,1);
});
await test("Adaptation offers to finish a written scene whose beat map is missing",async()=>{
  const b=agentsBox(); const m=model();
  const ctx=context(b,m,{authorScene:async()=>({patch:{},beats:{rows:[{n:1}]}}),
    buildSpine:async()=>{throw new Error("Must not rebuild the film");}});
  await b.agentAdaptation(ctx);
  assert.equal(ctx.cards.length,1); assert.match(ctx.cards[0].reason,/no beat map/);
  assert.equal(m.beats.s1.rows.length,1); assert.equal(m.drafts.s1,draft);
});
await test("the App and Story Editors expose missing beat maps as incomplete work",()=>{
  const m=model(); const b=agentsBox({scenes:m.scenes,drafts:m.drafts,beatsMap:m.beats,project:m.project});
  const call=find(ast.app,n=>n.type==="CallExpression" && n.callee.type==="ArrowFunctionExpression"
    && !!find(n.callee,x=>x.type==="ObjectProperty" && x.key.name==="unwrittenBeatMaps"));
  assert.ok(call); const props=vm.runInContext(files.app.slice(call.start,call.end),b);
  assert.equal(props.unwritten,1); assert.equal(props.unwrittenBeatMaps,1);
  vm.runInContext(files["agents-ui"],b);
  const tree=b.AgentsPanel({...props,aiOn:true});
  const text=n=>typeof n==="string"?n:n && typeof n==="object"?(n.props?.children||[]).map(text).join(""):"";
  assert.match(text(tree),/with a screenplay but no beat map/);
});

await test("failed, missing and malformed ledger refreshes never produce a clean verdict",async()=>{
  for(const reply of [async()=>{throw new Error("Service failed");},undefined,async()=>null,async()=>({map:{}})]){
    let checked=0;
    const b=agentsBox({continuityLedgerSig:()=>"new",continuityReport:()=>{checked++;return {conflicts:[]};}});
    const m=model(); m.project={continuityFacts:{old:{label:"old"}},continuityLedger:{sig:"old"}};
    const ctx=context(b,m,{continuityLedger:reply});
    await b.agentContinuityRepair(ctx);
    assert.equal(checked,0); assert.ok(!ctx.events.some(e=>e.t.includes("Continuity check clean")));
    assert.equal(m.project.continuityLedger.sig,"old");
  }
});
await test("a successful ledger refresh can still report a clean check",async()=>{
  const b=agentsBox({continuityLedgerSig:()=>"new",continuityReport:()=>({conflicts:[]})});
  const m=model(); m.project={continuityLedger:{sig:"old"},continuityFacts:{old:{}}};
  const ctx=context(b,m,{continuityLedger:async()=>({map:{s1:{}},facts:{},ledger:{sig:"new"}})});
  await b.agentContinuityRepair(ctx);
  assert.equal(m.project.continuityLedger.sig,"new");
  assert.ok(ctx.events.some(e=>e.t.includes("Continuity check clean")));
});

await test("distinct Unicode characters keep their identities and scene drivers",async()=>{
  for(const names of [["空","蓮"],["李明","王芳"],["Анна","Борис"],["José","Zoë"]]){
    const b=agentsBox(); const m={scenes:[],beats:{},drafts:{},continuity:{},project:{}};
    const ids=["first","second"];
    const ctx=context(b,m,{buildSpine:async()=>({title:"A story",scenes:names.map((name,i)=>({...scene,driver:name,title:name,no:i+1}))}),
      buildStoryWorld:async()=>({cast:names.map((name,i)=>({id:ids[i],name,role:i?"Supporting":"Protagonist"}))}),
      authorScene:async()=>({patch:{},beats:{rows:[{n:1}]}}),draftScene:async()=>draft});
    await b.agentAdaptation(ctx);
    assert.deepEqual(plain(m.characters.map(c=>c.name)),names);
    assert.deepEqual(plain(m.scenes.map(s=>s.driver)),ids);
  }
});
await test("canonical Unicode spellings of one name still deduplicate",async()=>{
  const b=agentsBox(); const m={scenes:[],beats:{},drafts:{},continuity:{},project:{}};
  const ctx=context(b,m,{buildSpine:async()=>({title:"A story",scenes:[{...scene,driver:"one"},{...scene,driver:"two"}]}),
    buildStoryWorld:async()=>({cast:[{id:"one",name:"José",role:"Protagonist"},{id:"two",name:"Jose\u0301",role:"Supporting"}]}),
    authorScene:async()=>({patch:{},beats:{rows:[{n:1}]}}),draftScene:async()=>draft});
  await b.agentAdaptation(ctx);
  assert.equal(m.characters.length,1); assert.ok(m.scenes.every(s=>s.driver==="one"));
});
await test("script-derived beat labels resolve the right non-Latin cast member",async()=>{
  const b=box({aiAvailable:()=>true,storyContext:()=>"",castPronounBlock:()=>"",SELF_CONTAINED_BEATS:"",
    extractJSON:JSON.parse,scrubBrand:String,clipWords:String,writingStamp:()=>"test"});
  load(b,"ai",["aiBeatsFromScript","_beatChg"]);
  b.claude={complete:async()=>JSON.stringify({driverLabel:"蓮",reactorLabel:"空",beats:[{n:1,drive:{d:"A choice"},react:{d:"An answer"}}]})};
  const r=await b.aiBeatsFromScript(scene,draft,[{name:"空"},{name:"蓮"}],{});
  assert.equal(r.driverLabel,"蓮"); assert.equal(r.reactorLabel,"空");
});

function intake(){
  const states=[],refs=[]; let si=0,ri=0, calls=0, synopsisCalls=0;
  const b=box({Voice:{},addEventListener:noop,removeEventListener:noop});
  b.React.useState=v=>{const i=si++;if(!(i in states)) states[i]=typeof v==="function"?v():v;
    return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v;}];};
  b.React.useRef=v=>{const i=ri++;return refs[i]||(refs[i]={current:v});};
  b.React.useEffect=noop;
  b.aiResearch=async(l,seed,fw,fmt)=>{calls++;return {title:"A story",research:{memory:fmt,imagination:fw,fact:{world:seed},sources:[{url:"https://example.org/source"}],grounded:true}};};
  b.aiSynopsisFromResearch=async()=>{synopsisCalls++;return {paras:[{key:"setup",text:"A paragraph"}]};};
  vm.runInContext(files.newstory.slice(0,files.newstory.indexOf("function NSLegacyInterview")),b);
  const src=declaration("newstory","NewStoryIntake");
  vm.runInContext(src.slice(0,src.indexOf("  const pillar ="))+
    "return {runResearch,writeSynopsis,build,setChosen,setText,setFormat,setFramework,setResearchEdited,step,research,syn,paras,err};\n}",b);
  const launch=[];
  return {render:()=>{si=ri=0;return b.NewStoryIntake({aiOn:true,onLaunch:(...args)=>launch.push(args)});},
    calls:()=>calls,synopsisCalls:()=>synopsisCalls,launch,b};
}
await test("research cache tracks seed, logline, format and structure; stale synopsis cannot launch",async()=>{
  const h=intake(); let a=h.render(); a.setChosen("A traveller returns"); a.setText("A traveller returns");
  a=h.render(); await a.runResearch(false); a=h.render(); await a.writeSynopsis();
  a=h.render(); await a.runResearch(false); assert.equal(h.calls(),1);
  a=h.render(); a.setFormat("documentary");
  a=h.render(); a.build(); assert.equal(h.launch.length,0);
  await a.runResearch(false); a=h.render(); assert.equal(h.calls(),2); assert.equal(a.paras.length,0);
  assert.equal(a.research.memory,"documentary");
  await a.writeSynopsis(); a=h.render(); a.setFramework("kishotenketsu"); a=h.render();
  await a.writeSynopsis(); assert.equal(h.synopsisCalls(),2,"Old research must not write a new structure");
  await a.runResearch(false); a=h.render(); assert.equal(h.calls(),3); assert.equal(a.paras.length,0);
  assert.equal(a.research.imagination,"kishotenketsu");
  await a.writeSynopsis(); a=h.render(); a.build(); assert.equal(h.launch.length,1);
  a.setText("A changed seed with the same logline"); a=h.render(); await a.runResearch(false);
  assert.equal(h.calls(),4); a=h.render(); a.setChosen("Another logline"); a=h.render(); await a.runResearch(false);
  assert.equal(h.calls(),5);
});
await test("changing shape asks before replacing edited research",async()=>{
  const h=intake(); let a=h.render(); a.setChosen("A logline"); a=h.render(); await a.runResearch(false);
  a=h.render(); a.setResearchEdited(true); a.setFormat("documentary"); a=h.render();
  h.b.appConfirm=async()=>false; await a.runResearch(false); assert.equal(h.calls(),1);
  h.b.appConfirm=async()=>true; await a.runResearch(false); assert.equal(h.calls(),2);
});

await test("rebuild-as-new keeps a detached complete research object in local and cloud creation",async()=>{
  const prop=find(ast.app,n=>n.type==="ObjectProperty" && n.key.name==="onRebuildFromBrief");
  assert.ok(prop); const fn=files.app.slice(prop.value.start,prop.value.end);
  // the new film is minted by the helper Rebuild shares with Adapt into a new film (2026-10-18)
  const mint=find(ast.app,n=>n.type==="VariableDeclarator" && n.id && n.id.name==="mintFilmForBuild");
  assert.ok(mint); const mintSrc=files.app.slice(mint.init.start,mint.init.end);
  for(const cloudMode of [false,true]){
    const research={memory:"Edited memory",imagination:"Imagined days",fact:{roles:[{who:"Mara",role:"Officer"}]},
      sources:[{url:"https://example.org/source",title:"Source"}],grounded:true,edited:true};
    const project={title:"Original",format:"film",framework:"threeact",logline:"A logline",sourceBrief:"A brief",research};
    let next=project, launches=0;
    const b=box({project,cloudMode,canMutateWritersRoom:()=>true,planActive:()=>true,appConfirm:async()=>true,
      projIdRef:{current:"original"},loadSeqRef:{current:1},homeOpenRef:{current:false},
      createProject:async()=>{next={};return "new-film";},
      localStoryGenRef:{current:0},applyDoc:()=>{next={};},emptyDoc:()=>({}),setArtView:noop,setRoom:noop,setView:noop,
      setProject:f=>{next=f(next);},setAgentLaunch:()=>launches++,setAgentsOpen:noop});
    vm.runInContext("this.mintFilmForBuild="+mintSrc,b);
    vm.runInContext("this.rebuild="+fn,b); await b.rebuild();
    assert.deepEqual(plain(next.research),research); assert.notEqual(next.research,research);
    next.research.fact.roles[0].role="Changed"; assert.equal(research.fact.roles[0].role,"Officer"); assert.equal(launches,1);
  }
});
await test("Story Doctor fallback is a real turn for every opening charge",async()=>{
  const b=agentsBox({aiAvailable:()=>true,writingProjectOf:p=>p,storyContext:()=>"",clampCharge:(c,f)=>Number.isFinite(c)?Math.max(-3,Math.min(3,c)):f,
    extractJSON:JSON.parse,scrubAnalysis:s=>s,museStoryWords:()=>[]});
  load(b,"ai",["aiSuggestTurn"]);
  b.claude={complete:async()=>JSON.stringify({closeCharge:0,closeValue:"Calm",rationale:"A choice"})};
  for(let open=-3;open<=3;open++){
    const r=await b.aiSuggestTurn({...scene,openCharge:open},null,{});
    assert.ok(b.chargeTurn(open,r.closeCharge).turned,"Not a turn from "+open);
  }
});
console.log(checks+" Writers' Room recovery checks passed.");

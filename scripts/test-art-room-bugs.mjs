/* Art Room bugs 1-4 (owner, 2026-09-26): the Consistency Check keeps every approved fix in
   a scene; the Shot Designer merges coverage the Shots tab's safe way, covers every scene
   and leaves approved work alone under Run pre-production; the Coordinator promises only
   what it does, and its cost preview counts only what it renders. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const plain=x=>JSON.parse(JSON.stringify(x));
const box={console,setTimeout,clearTimeout}; box.window=box; vm.createContext(box);
for(const f of ["app/frameworks.jsx","app/scene-order.js","app/agents.jsx","app/beat-keyframe-merge.js"]) vm.runInContext(read(f),box,{filename:f});
box.turnProject={framework:"threeact"};

// ---- bug 1: Consistency Check ----
await test("approving several fixes in one scene keeps them all",async()=>{
  const blocks=[
    {type:"scene",beat:1,text:"INT. CHAPEL - DAY"},
    {type:"action",beat:1,text:"Marcsu grips the eulogy."},
    {type:"action",beat:1,text:"Behind the booth glass, Danile watches."},
    {type:"action",beat:1,text:"Marcus lifts the card. They place it down."},
  ];
  const model={characters:[{id:"marcus",name:"Marcus",pronouns:"he/him"},{id:"daniel",name:"Daniel",pronouns:"he/him"}],
    scenes:[{id:"s1",no:1,act:1,title:"Closing",loc:"INT. CHAPEL - DAY",driver:"marcus"}],
    drafts:{s1:{blocks}}, beats:{s1:{rows:[{id:"b1",n:1,drive:{a:"grips"},react:{a:"watches"}},{id:"b2",n:2,drive:{a:"lifts"},react:{a:"sets"}}]}}};
  // the re-map tags the CURRENT text (it used to be computed from the stale original)
  box.realignBlockBeats=(bs)=>bs.map((b,i)=>({...b,beat:i>=2?2:1}));
  box.findImpliedSpaces=(scene,bs)=>{ const at=bs.findIndex(b=>/booth glass/.test(b.text||"")); return at<0?[]:[{name:"BOOTH",atIndex:at,evidence:bs[at].text}]; };
  box.impliedSpaceSlugline=(sp)=>"INT. "+sp.name+" - CONTINUOUS";
  let syncs=0; const cards=[];
  const ctx={model, bible:{props:[],locations:[],shots:[],patchProp:()=>{},patchLocation:()=>{}},
    emit:()=>{}, cancelled:()=>false, sync:()=>{syncs++;}, propose:async c=>{cards.push(c.title); return true;}};
  await box.agentConsistency(ctx);
  const out=model.drafts.s1.blocks.map(b=>b.text);
  assert.ok(out.includes("Marcus grips the eulogy."),"typo 1 kept: "+out.join(" | "));
  assert.ok(out.some(t=>/Daniel watches/.test(t)),"typo 2 kept: "+out.join(" | "));
  assert.ok(out.includes("INT. BOOTH - CONTINUOUS"),"slugline kept");
  assert.equal(out.indexOf("INT. BOOTH - CONTINUOUS")+1, out.findIndex(t=>/booth glass/.test(t)),"slug sits right above the space");
  assert.ok(out.some(t=>t==="Marcus lifts the card. He places it down."),"pronoun fix kept, on the right line: "+out.join(" | "));
  assert.ok(model.drafts.s1.blocks.some(b=>b.beat===2),"beat re-map kept");
  assert.ok(cards.length>=5,"every fix was proposed: "+cards.join(" / "));
  assert.ok(syncs>=5,"every approved fix is saved, the slugline included");
});

// ---- bugs 2 + 4: Shot Designer ----
const mkCov=(scenes, shotsByScene, opts={})=>{
  let work=Object.entries(shotsByScene).flatMap(([sid,arr])=>arr.map(s=>({...s,sceneId:sid})));
  const applied=[];
  return { applied, get work(){ return work; },
    sceneCount:scenes.length,
    audit:()=>box.auditCoverage(scenes, work, opts.beatsMap||{}),
    sceneById:id=>scenes.find(s=>s.id===id),
    shotsOf:sid=>work.filter(s=>s.sceneId===sid),
    pickAnchor:arr=>(arr[0]||{}).id, grammarList:arr=>arr.map(s=>s.size),
    turnAtOf:()=>null,
    draftCoverage:async(scene)=>[{id:"new-"+scene.id+"-1",sceneId:scene.id,beatN:1,size:"WS"},{id:"new-"+scene.id+"-2",sceneId:scene.id,beatN:2,size:"MCU"},{id:"new-"+scene.id+"-3",sceneId:scene.id,beatN:3,size:"CU"}],
    applyCoverage:(sid,shots)=>{ applied.push(sid); work=box.mergeBeatKeyframes(work, shots.map(s=>({...s,anchor:false}))).shots; } };
};
await test("the Shot Designer covers every scene of a 40-scene feature, once each",async()=>{
  const scenes=Array.from({length:40},(_,i)=>({id:"sc"+i,no:i+1,title:"S"+(i+1)}));
  const cov=mkCov(scenes,{});   // no shots anywhere: every scene needs coverage
  const msgs=[];
  await box.agentShotDesigner({art:{coverage:cov},ai:{available:true},emit:e=>msgs.push(e),cancelled:()=>false,propose:async()=>true});
  assert.equal(cov.applied.length,40,"all 40 scenes designed (it used to stop at 12)");
  assert.equal(new Set(cov.applied).size,40,"each scene at most once");
  assert.ok(/Designed coverage for 40 scenes/.test(msgs.at(-1).t));
});
await test("under Run pre-production, scenes with approved or locked shots are left alone",async()=>{
  const scenes=[{id:"a",no:1,title:"A"},{id:"b",no:2,title:"B"}];
  const flat=sid=>[1,2,3].map(n=>({id:sid+"-"+n,beatN:n,size:"MS",order:n}));
  const cov=mkCov(scenes,{a:flat("a").map((s,i)=>i===0?{...s,approved:true}:s), b:flat("b")});
  const msgs=[];
  await box.agentShotDesigner({art:{coverage:cov},ai:{available:true},autoApprove:true,emit:e=>msgs.push(e),cancelled:()=>false,propose:async()=>true});
  assert.deepEqual(plain(cov.applied),["b"]);
  assert.ok(msgs.some(e=>/Scene 1 has approved or locked shots — left as it is/.test(e.t)));
  assert.ok(/1 scene with approved or locked shots was left as it is/.test(msgs.at(-1).t),msgs.at(-1).t);
  // run on its own (not auto-approved) it still proposes the approved scene
  const cov2=mkCov(scenes,{a:flat("a").map((s,i)=>i===0?{...s,approved:true}:s), b:flat("b")});
  await box.agentShotDesigner({art:{coverage:cov2},ai:{available:true},emit:()=>{},cancelled:()=>false,propose:async()=>true});
  assert.deepEqual(plain(cov2.applied).sort(),["a","b"]);
});
await test("a redesign merges like the Shots tab: IDs and frames kept, extras to Trash, other beats kept",()=>{
  const old=[
    {id:"k1",sceneId:"s",beatN:1,keyframeMode:"beat-opening",action:"old",approved:true,imageRev:3},
    {id:"alt1",sceneId:"s",beatN:1,manual:true,action:"hand-made alternative"},
    {id:"k9",sceneId:"s",beatN:9,action:"a beat the new plan doesn't cover"},
    {id:"x",sceneId:"other",beatN:1,action:"another scene"}];
  const m=box.mergeBeatKeyframes(old,[{id:"new-1",sceneId:"s",beatN:1,action:"new"}]);
  const k1=m.shots.find(s=>s.id==="k1");
  assert.ok(k1&&k1.action==="new"&&k1.imageRev===3&&k1.approved===false,"the beat keeps its shot ID and image history; changed → re-approve");
  assert.deepEqual(plain(m.archived.map(s=>s.id)),["alt1"],"the extra shot goes to Trash, restorable");
  assert.ok(m.shots.some(s=>s.id==="k9")&&m.shots.some(s=>s.id==="x"));
  const app=read("app/app.jsx"), a0=app.indexOf("applyCoverage: (sceneId, newShots, anchorId)=>{"), cov=app.slice(a0,app.indexOf("\n    };",a0));
  assert.ok(cov.includes("commitBeatKeyframes(fresh, ()=>{})")&&!cov.includes("ss.filter(s=>s.sceneId!==sceneId)"),"the agent path uses the Shots tab's merge");
  assert.ok(read("app/agents.jsx").includes("any extra shots on a re-planned beat move to Shots Trash"));
});

// ---- bug 3: the Coordinator promises only what it does ----
await test("the Coordinator's copy matches its seven steps; no storyboard promises",()=>{
  const ag=read("app/agents.jsx"), app=read("app/app.jsx"), chrome=read("app/chrome.jsx");
  const coord=ag.slice(ag.indexOf("async function agentDepartmentCoordinator"),ag.indexOf("AGENT — SCENE DIRECTOR"));
  assert.ok(coord.includes("autoApprove:true"));
  assert.ok(/Shot frames and storyboards aren't rendered by this run/.test(coord)&&!/and the storyboard are all built/.test(coord));
  const blurb=ag.slice(ag.indexOf('{ id:"coordinator"'),ag.indexOf("run:agentDepartmentCoordinator"));
  assert.ok(/doesn't render shot frames or storyboards/.test(blurb)&&!/then the storyboard/.test(blurb));
  assert.ok(chrome.includes("lookbook → cast → props → wardrobe → locations → colour → shot coverage")&&!chrome.includes("colour → shots → storyboard"));
  assert.ok(app.includes('viewLabel:"View Shots"')&&!app.includes('viewLabel:"View Storyboards"'));
  assert.ok(!/cast can now reference them|The cast can reference them/.test(ag));
});
await test("the cost preview counts only what the run renders",()=>{
  const art=read("app/artroom.jsx");
  const cc=art.slice(art.indexOf("function CoordConfirm("),art.indexOf("window.CoordConfirm = CoordConfirm;"));
  for(const lab of ['"Cast sheets"','"Appearance variants"','"Prop sheets"','"Wardrobe updates"','"Location plates"']) assert.ok(cc.includes(lab),lab);
  assert.ok(!/preProdStatus|"frame"|Storyboards", *unit/.test(cc),"no shot frames or storyboard sheets in the count");
  assert.ok(cc.includes("Not included: shot frames and storyboards"));
  assert.ok(cc.includes('tierOf(p)!=="text"'),"text-only props get no image, so they aren't counted");
  const app=read("app/app.jsx");
  assert.ok(app.includes("project, characters, props, locations, shots, scenes, drafts, wardrobeCount,")&&app.includes("setWardrobeCount(n)"));
});
console.log(checks+" checks passed");

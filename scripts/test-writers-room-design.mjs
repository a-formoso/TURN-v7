/* Writers' Room design (owner-approved 2026-09-25): the sign-reversal turn with a
   progression status, one value at stake per scene, the structural role in every scene
   prompt, psychology before the script with a check pass after it, and the Hook / Pinch
   Point / optional Hero's Journey beats. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=f=>readFileSync(f,"utf8");
let checks=0;
const test=async(name,f)=>{await f();checks++;console.log("PASS",name);};
const plain=x=>JSON.parse(JSON.stringify(x));
const box={console,React:{createElement:()=>null}}; box.window=box; vm.createContext(box);
vm.runInContext(read("app/frameworks.jsx"),box,{filename:"frameworks.jsx"});
vm.runInContext(read("app/scene-order.js"),box,{filename:"scene-order.js"});
const load=(file,names)=>{ const src=read(file), ast=parseSync(src,{sourceType:"script"});
  names.forEach(n=>{ const node=ast.program.body.find(x=>(x.type==="FunctionDeclaration"&&x.id.name===n)||
      (x.type==="VariableDeclaration"&&x.declarations.some(d=>d.id.name===n)));
    assert.ok(node,"missing "+n+" in "+file); vm.runInContext(src.slice(node.start,node.end).replace(/^const /,"var "),box); }); };
load("app/spine.jsx",["turnInfo","chargeStr","themeArgues"]);
box.turnProject={framework:"threeact"};

// ---- phase 3: the turn ----
await test("a turn is a sign reversal; a same-side move of 2+ is a progression",()=>{
  const t=(o,c)=>{ const r=box.chargeTurn(o,c); return r.turned?"turn":r.progression?"progression":"flat"; };
  assert.equal(t(2,-1),"turn"); assert.equal(t(-3,1),"turn");
  assert.equal(t(1,3),"progression"); assert.equal(t(2,0),"progression"); assert.equal(t(-1,-3),"progression");
  assert.equal(t(1,2),"flat"); assert.equal(t(0,1),"flat"); assert.equal(t(-2,-2),"flat");
  assert.equal(t(0,2),"turn"); assert.equal(t(0,-3),"turn");
});
await test("framework rules report the status and keep their exemptions",()=>{
  const fw=id=>box.FRAMEWORKS.find(f=>f.id===id).audit.rule;
  assert.equal(fw("threeact")({openCharge:1,closeCharge:3,kind:"normal"}).status,"progression");
  assert.equal(fw("threeact")({openCharge:1,closeCharge:3,kind:"normal"}).flagged,false);
  assert.equal(fw("threeact")({openCharge:1,closeCharge:2,kind:"normal"}).flagged,true);
  assert.equal(fw("threeact")({openCharge:1,closeCharge:1,kind:"resolution"}).status,"exempt");
  assert.equal(fw("herosjourney")({openCharge:2,closeCharge:2,kind:"elixir"}).flagged,false);
  assert.equal(fw("kishotenketsu")({openCharge:1,closeCharge:1,act:1}).flagged,false);
  assert.equal(fw("kishotenketsu")({openCharge:0,closeCharge:0,act:2}).flagged,true);
  assert.equal(fw("kishotenketsu")({openCharge:1,closeCharge:3,act:3}).status,"progression");
});
{
  const src=read("app/ai.jsx")+read("app/agents.jsx")+read("app/spine.jsx")+read("app/export.jsx")+read("app/character.jsx")+read("app/frameworks.jsx");
  await test("no second copy of the old 'sign or by 2' rule survives",()=>{
    assert.ok(!/Math\.abs\([a-z.]*closeCharge\s*-\s*[a-z.]*openCharge\)\s*>=\s*2/.test(src));
    assert.ok(!/differ in sign or by >=2/.test(src)&&!/sign reversal or a jump of 2/.test(src));
  });
}

// ---- phase 3: one value at stake ----
await test("the opening and closing words follow the value at stake",()=>{
  const s=box.withValueWords({value:{pos:"Love",neg:"Hate"},openCharge:2,closeCharge:-1,openValue:"x",closeValue:"y"});
  assert.equal(s.openValue,"Love"); assert.equal(s.closeValue,"Hate");
  assert.equal(box.valueWordFor({pos:"Love",neg:"Hate"},0),"Love / Hate");
  const legacy={openValue:"Grief",openCharge:-2,closeValue:"Worth",closeCharge:2};
  assert.equal(box.withValueWords(legacy),legacy);
  assert.deepEqual(plain(box.guessValueAxis(legacy)),{pos:"Worth",neg:"Grief"});
  assert.deepEqual(plain(box.guessValueAxis({openValue:"Value",openCharge:0,closeValue:"Value",closeCharge:1})),{pos:"",neg:""});
});

// ---- phase 4: hook + pinch points; optional Campbell stages ----
load("app/agents.jsx",["acceptDeclaredStages","assignPlotPoints","sd_turnInfo","auditSpine"]);
const film=()=>Array.from({length:16},(_,i)=>({id:"s"+(i+1),no:i+1,act:i<4?1:i<12?2:3,title:"S"+(i+1),openCharge:1,closeCharge:-1,kind:"normal"}));
await test("three-act films get a hook and two pinch points at 3/8 and 5/8",()=>{
  const sc=box.assignPlotPoints(film());
  const kinds=sc.map(s=>s.kind);
  assert.equal(kinds[0],"hook");
  assert.equal(kinds[5],"pinch"); assert.equal(kinds[9],"pinch");
  assert.ok(kinds.includes("midpoint")&&kinds.includes("incite")&&kinds.includes("story-climax"));
  const short=box.assignPlotPoints(film().slice(0,8).map((s,i)=>({...s,act:i<2?1:i<6?2:3})));
  // no second act long enough for pinch points; scene 1 hooks unless it is the inciting incident
  assert.ok(!short.some(s=>s.kind==="pinch")&&["hook","incite"].includes(short[0].kind));
  const declared=film(); declared[0].kind="incite";
  assert.equal(box.assignPlotPoints(declared)[0].kind,"incite");
});
await test("Hero's Journey offers Belly of the Whale and Rescue from Without by hand only",()=>{
  const hj=box.FRAMEWORKS.find(f=>f.id==="herosjourney");
  assert.ok(hj.kindOpts.some(o=>o[0]==="belly")&&hj.kindOpts.some(o=>o[0]==="rescue"));
  box.turnProject={framework:"herosjourney"};
  const sc=box.assignPlotPoints(Array.from({length:12},(_,i)=>({id:"h"+i,no:i+1,act:i<4?1:i<9?2:3,openCharge:1,closeCharge:-1,kind:"normal"})));
  assert.ok(!sc.some(s=>s.kind==="belly"||s.kind==="rescue"));
  box.turnProject={framework:"threeact"};
});
await test("every framework's structural beats carry a job for the writer",()=>{
  box.FRAMEWORKS.forEach(fw=>{ Object.keys(fw.kinds).filter(k=>fw.kindOpts.some(o=>o[0]===k)).forEach(k=>assert.ok(fw.jobs[k],fw.id+" "+k)); });
});
await test("the Doctor flags a peak that only progresses",()=>{
  box.KIND_LABEL=new Proxy({},{get:(_,k)=>box.fwKindLabel(k)});
  const sc=box.assignPlotPoints(film());
  const mid=sc.findIndex(s=>s.kind==="midpoint"); sc[mid]={...sc[mid],openCharge:1,closeCharge:3};
  const found=box.auditSpine(sc).find(i=>i.sceneId===sc[mid].id);
  assert.equal(found.kind,"weakpeak"); assert.ok(/only progresses/.test(found.msg));
});

await test("the Doctor flags conflict that never escalates in kind, and only on deliberate levels",()=>{
  const lv=(sc,fn)=>sc.map((s,i)=>({...s,conf:fn(s,i),confAuthored:true}));
  const base=box.assignPlotPoints(film());
  const flat=box.auditSpine(lv(base,()=>2)).find(i=>i.kind==="flatconflict");
  assert.ok(flat,"all-personal film is flagged");
  assert.equal(flat.toLevel,1,"escalate deeper first");
  assert.equal(base.find(s=>s.id===flat.sceneId).kind,"crisis","re-level the final act's first peak");
  assert.ok(/only in volume, never in kind/.test(flat.msg));
  const deeper=lv(base,s=>s.kind==="crisis"?1:2);
  assert.ok(!box.auditSpine(deeper).some(i=>i.kind==="flatconflict"),"a later act reaching a new level passes");
  assert.ok(!box.auditSpine(base.map(s=>({...s,conf:2}))).some(i=>i.kind==="flatconflict"),"default levels are never judged");
  const wideFirst=lv(base,(s,i)=>i<4?(i%2?1:2):[1,2][i%2]);
  const w=box.auditSpine(wideFirst).find(i=>i.kind==="flatconflict");
  assert.equal(w.toLevel,3,"when inner and personal are both used in Act I, escalate wider");
  box.turnProject={framework:"kishotenketsu"};
  assert.ok(!box.auditSpine(lv(base,()=>2)).some(i=>i.kind==="flatconflict"),"kish\u014dtenketsu: conflict is optional");
  box.turnProject={framework:"threeact"};
  const agents=read("app/agents.jsx");
  assert.ok(agents.includes('issue.kind==="flatconflict"')&&agents.includes("ctx.model.scenes[idx] = {...scene, conf:fix.conf, confAuthored:true};"));
});

// ---- phase 1: the structural role + story context ----
const scenes=box.assignPlotPoints(film());
await test("the structural role names the act, position, beat job and pacing",()=>{
  const mid=scenes.find(s=>s.kind==="midpoint"), i=scenes.indexOf(mid);
  const role=box.fwStructuralRole(mid,scenes,{framework:"threeact"});
  assert.ok(role.includes("Act 2 — Complication")&&role.includes("scene "+(i+1)+" of 16"));
  assert.ok(role.includes("MID-ACT CLIMAX: the true nature of the conflict is revealed"));
  assert.ok(role.includes("PACING: a structural peak"));
  assert.ok(box.fwStructuralRole(scenes[i-1],scenes,{framework:"threeact"}).includes("tighten and compress"));
  assert.ok(box.fwStructuralRole(scenes[i+1],scenes,{framework:"threeact"}).includes("room to breathe"));
  assert.ok(box.fwStructuralRole(scenes[5],scenes,{framework:"threeact"}).includes("PINCH POINT"));
});
load("app/ai.jsx",["writingProjectOf","writingLoglineOf","genreTag","driverNameOf","synopsisParasOf","protagonistOf","characterInnerBrief","CONFLICT_LEVELS","castMemberByLabel","sceneReactorOf","storyContext"]);
Object.assign(box,{contractBrief:()=>""});
await test("every scene prompt carries structure, synopsis, psychology, theme and the value at stake",()=>{
  const cast=[{id:"mara",name:"Mara",orbit:0,conscious:"to keep the shop alive",unconscious:"to be forgiven by her brother",
    arcStages:{1:"hides behind the ledger",2:"the ledger cracks",3:"chooses her brother over the shop"}},{id:"ivo",name:"Ivo",orbit:1}];
  const P={title:"Ledger",genre:"drama",framework:"threeact",premise:"What if the debt was love?",
    setting:{period:"1990s",location:"a pawnshop in Lisbon",conflict:"personal"},
    controllingIdea:{value:"Love survives",cause:"when pride is surrendered"},
    sourceBrief:"LOGLINE: x\n\nSYNOPSIS — Ledger:\nThe Setup: Mara opens the shop.\nThe Confrontation / Complication: Ivo returns with a debt.\nThe Resolution: She burns the ledger."};
  const sc={...scenes[6],driver:"mara",summary:"Mara refuses Ivo.",objective:"to refuse him",argues:"counter",conf:2,confAuthored:true,
    value:{pos:"Trust",neg:"Betrayal"},openValue:"Trust",openCharge:2,closeValue:"Betrayal",closeCharge:-2};
  const ctx=box.storyContext(sc,null,P,cast,scenes);
  for(const bit of ["Premise (the open question the story explores): What if the debt was love?",
    "Setting: 1990s · a pawnshop in Lisbon. Level of conflict: personal",
    "The protagonist's through-line (Mara's want across the whole story): to keep the shop alive",
    "This movement of the synopsis (The Confrontation / Complication): Ivo returns with a debt.",
    "STRUCTURAL ROLE: Act 2","Driver: Mara.",
    "needs, without admitting it","where their arc stands in this act: the ledger cracks",
    "argues AGAINST the controlling idea","Level of conflict in this scene: personal",
    "Value at stake: Trust (+) ↔ Betrayal (−)"]) assert.ok(ctx.includes(bit),bit+"\n---\n"+ctx);
  assert.ok(!box.storyContext({...sc,confAuthored:false,argues:""},null,P,cast,scenes).includes("Level of conflict in this scene"));
});

// ---- phase 2: psychology before the script + the check after ----
load("app/ai.jsx",["arcStagesAsk","normalizeArcStages","draftParagraphs","scriptEvidenceFor","aiCastPsychology"]);
{
  let sent=[], reply;
  Object.assign(box,{aiAvailable:()=>true,castOrbit:()=>0,identityContext:x=>x,assertPromptIdentity:()=>{},canonicalIdentity:()=>({explicit:true}),
    castPronounBlock:()=>"",inventionRules:()=>"",clipSpecText:(v,n)=>String(v==null?"":v).slice(0,n||999).trim(),normalizeDimensions:()=>null,
    isProtagonistChar:()=>true,binaryPronouns:()=>"",salvageBibleEntries:()=>null,extractJSON:JSON.parse,
    claude:{complete:async o=>{sent.push(o.messages[0].content);return JSON.stringify(reply);}}});
  const P={title:"Ledger",framework:"threeact",sourceBrief:"SYNOPSIS:\nThe Setup: Mara opens the shop."};
  const cast=[{id:"mara",name:"Mara",role:"Protagonist"}];
  await test("the pre-script pass designs from the synopsis and returns arc by act",async()=>{
    reply={cast:[{id:"mara",conscious:"to keep the shop",unconscious:"to be forgiven",arc:"pride to surrender",arcStages:{"1":"hides","2":"cracks","3":"chooses"}}]};
    const out=await box.aiCastPsychology(cast,scenes.map(s=>({...s,driver:"mara"})),P,{scenes:[],drafts:{},cast,mode:"before"});
    assert.ok(sent[0].includes("SYNOPSIS:\nThe Setup: Mara opens the shop.")&&sent[0].includes("The screenplay is NOT written yet"));
    assert.ok(sent[0].includes("[Act 3]"),"every driven scene, including Act III, is listed");
    assert.deepEqual(plain(out.mara.arcStages),{"1":"hides","2":"cracks","3":"chooses"});
  });
  await test("the check after the script revises only what the choices contradict",async()=>{
    sent=[]; reply={cast:[{id:"mara",unconscious:"to be seen by her brother",revised:"She never asks forgiveness; she wants to be seen."}]};
    const was=[{...cast[0],conscious:"to keep the shop",unconscious:"to be forgiven"}];
    const out=await box.aiCastPsychology(was,scenes,P,{scenes:[],drafts:{},cast:was,mode:"reconcile"});
    assert.ok(sent[0].includes("DRAFTED BEFORE THE SCRIPT — want: to keep the shop; need: to be forgiven")&&sent[0].includes("RECONCILE"));
    assert.equal(out.mara.unconscious,"to be seen by her brother"); assert.ok(out.mara._revised); assert.equal(out.mara.conscious,undefined);
    sent=[]; reply={cast:[]};
    assert.equal(await box.aiCastPsychology(was,scenes,P,{scenes:[],drafts:{},cast:was,mode:"reconcile"}),null);
    assert.equal(sent.length,1,"nothing to revise is an answer, not a miss to retry");
  });
}
{
  const agents=read("app/agents.jsx"), build=agents.slice(agents.indexOf("async function agentAdaptation"),agents.indexOf("async function agentTableRead"));
  await test("the build designs psychology before the beats and checks it after the script",()=>{
    const before=build.indexOf('mode:"before"'), write=build.indexOf("const r = await writeScenesSeq(ctx, ctx.model.scenes.map"), check=build.indexOf('mode:"reconcile"');
    assert.ok(before>0&&write>before&&check>write);
  });
  const ai=read("app/ai.jsx");
  await test("the spine build returns a value at stake and a conflict level per scene",()=>{
    load("app/ai.jsx",["clampCharge","normSpineScenes"]); box.scrubBrand=s=>String(s);
    const [s]=box.normSpineScenes([{a:2,t:"The Offer",l:"INT. SHOP - DAY",s:"x",d:"mara",vp:"Trust",vn:"Betrayal",oc:2,cc:-2,cl:3}]);
    assert.deepEqual(plain(s.value),{pos:"Trust",neg:"Betrayal"}); assert.equal(s.openValue,"Trust"); assert.equal(s.closeValue,"Betrayal");
    assert.equal(s.conf,3); assert.equal(s.confAuthored,true);
    assert.ok(ai.includes('"vp":"Love","vn":"Hate"')&&ai.includes("HOOK: open in motion")&&ai.includes("PINCH POINT"));
  });
  await test("the pipeline doc records every approved change",()=>{
    const doc=read("docs/Story Pipeline.md");
    for(const h of ["**Psychology before the script** *(approved 2026-09-25 by owner)*","**Structural role in every scene prompt** *(approved 2026-09-25 by owner)*",
      "**The turn and the value at stake** *(approved 2026-09-25 by owner","**Hook and pinch points** *(added 2026-09-25 by owner)*"]) assert.ok(doc.includes(h),h);
  });
}
console.log(checks+" checks passed");

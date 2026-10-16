/* Art Room part 2 (owner, 2026-09-26): the Production check merges the Writers' Room's
   Script Breakdown with the production half of the Consistency Check. The Writers' Room
   keeps a story-only Consistency Check; the Production check reads the script into the
   cast sheets FIRST, then holds every Art Room layer to the script; the expressions change
   asks first; the beat lint runs once; cards a role can't save are noted, not shown. */
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
const app=read("app/app.jsx"), chrome=read("app/chrome.jsx"), ui=read("app/agents-ui.jsx"), idUi=read("app/character-identity-ui.jsx"), ai=read("app/ai.jsx");

// one scene that trips a story check (a name typo, mis-tagged beats) AND the production
// checks (an unslugged booth, a they/them line)
const fixture=()=>{
  const blocks=[
    {type:"scene",beat:1,text:"INT. CHAPEL - DAY"},
    {type:"action",beat:1,text:"Marcsu grips the eulogy."},
    {type:"action",beat:1,text:"Behind the booth glass, Daniel watches."},
    {type:"action",beat:1,text:"Marcus lifts the card. They place it down."},
  ];
  return {characters:[{id:"marcus",name:"Marcus",pronouns:"he/him"},{id:"daniel",name:"Daniel",pronouns:"he/him"}],
    scenes:[{id:"s1",no:1,act:1,title:"Closing",loc:"INT. CHAPEL - DAY",driver:"marcus"}],
    drafts:{s1:{blocks}}, beats:{s1:{rows:[{id:"b1",n:1,drive:{a:"grips"},react:{a:"watches"}},{id:"b2",n:2,drive:{a:"lifts"},react:{a:"sets"}}]}}};
};
box.realignBlockBeats=(bs)=>bs.map((b,i)=>({...b,beat:i>=2?2:1}));
box.findImpliedSpaces=(scene,bs)=>{ const at=bs.findIndex(b=>/booth glass/.test(b.text||"")); return at<0?[]:[{name:"BOOTH",atIndex:at,evidence:bs[at].text}]; };
box.impliedSpaceSlugline=(sp)=>"INT. "+sp.name+" - CONTINUOUS";
let lintCalls=0;
box.beatContinuityLint=()=>{ lintCalls++; return [{msg:"ambiguous pronoun in beat 2"}]; };
const mkCtx=(model,over={})=>{
  const cards=[], trace=[];
  const ctx={model, bible:{props:[],locations:[],shots:[],patchProp:()=>{},patchLocation:()=>{}},
    emit:e=>trace.push(e), cancelled:()=>false, sync:()=>{}, ai:{available:false},
    propose:async c=>{cards.push(c.title); return over.approve ? over.approve(c) : true;}, ...over};
  return {ctx,cards,trace};
};

await test("the registry: a story Consistency Check in the Writers' Room, the Production check in the Art Room, no Script Breakdown",()=>{
  const A=box.AGENTS;
  assert.ok(!A.some(a=>a.id==="breakdown"),"Script Breakdown is merged away");
  const p=A.find(a=>a.id==="production");
  assert.ok(p && p.name==="Production check" && p.room==="art" && p.kind==="fix" && p.run===box.agentProductionCheck);
  const c=A.find(a=>a.id==="consistency");
  assert.ok(c && !c.room && /story layer/.test(c.blurb) && /Production check/.test(c.blurb));
  // the Story Editors picker never lists an Art Room agent
  assert.ok(ui.includes('agents.filter(a=>a.kind!=="build" && a.room!=="art")'));
});

await test("the Writers' Room Consistency Check runs only the story checks",async()=>{
  const model=fixture(); const {ctx,cards,trace}=mkCtx(model);
  lintCalls=0;
  await box.AGENTS.find(a=>a.id==="consistency").run(ctx);
  assert.ok(cards.some(t=>/misspelling of MARCUS/.test(t)),"name typo: "+cards.join(" / "));
  assert.ok(cards.some(t=>/mis-mapped to beats/.test(t)),"beat re-map");
  assert.ok(!cards.some(t=>/slug the space|real pronouns/.test(t)),"no production cards: "+cards.join(" / "));
  assert.equal(lintCalls,0,"the beat lint is a production check");
  assert.ok(/for story consistency/.test(trace[0].t));
  assert.equal(trace.filter(e=>e.k==="done").length,1);
});

await test("the Production check runs only the production checks, and the beat lint once per scene",async()=>{
  const model=fixture(); const {ctx,cards,trace}=mkCtx(model);
  lintCalls=0;
  await box.agentProductionCheck(ctx);
  assert.ok(cards.some(t=>/slug the space/.test(t))&&cards.some(t=>/real pronouns/.test(t)),cards.join(" / "));
  assert.ok(!cards.some(t=>/misspelling|mis-mapped/.test(t)),"no story cards: "+cards.join(" / "));
  assert.equal(lintCalls,1,"one beat lint for one scene (Script Breakdown used to run it a second time)");
  assert.ok(model.drafts.s1.blocks.some(b=>b.text==="Marcus lifts the card. He places it down."));
  const done=trace.filter(e=>e.k==="done");
  assert.equal(done.length,1,"one run, one closing line");
  assert.ok(/^Production check complete — 2 fixes applied/.test(done[0].t),done[0].t);
  assert.ok(trace.some(e=>e.k==="flag"&&/writing model isn't available/.test(e.t)),"says the script read was skipped");
});

// the script read: Marcus's sheet has no pronouns; the screenplay says "he" (exact quote)
const readFixture=()=>{
  const m=fixture(); m.characters[0]={id:"marcus",name:"Marcus",pronouns:""};
  m.drafts.s1.blocks[1]={type:"action",beat:1,text:"Marcus grips the eulogy. He steadies himself."};
  return m;
};
box.charPronouns=c=>String(c.pronouns||"");
box.scaleClassOf=()=>"A";
box.turnIdentityReport=(ch)=> ch.id==="marcus" && !ch.pronouns ? {status:"unset",scriptPronouns:"he/him",issues:[]} : {status:"ok",issues:[]};
box.screenplayPronounEvidence=(ch)=> ch.id==="marcus" ? {pronouns:"he/him",quote:"Marcus grips the eulogy. He steadies himself."} : {pronouns:"",quote:""};
let readCalls=0;
box.aiScriptBreakdown=async()=>{ readCalls++; return {characters:[{name:"Marcus",gender_used:"he",scale_used:"unclear",emotion:"grief",features:[],states:[],voice_cues:[]}]}; };

await test("sheet-from-script runs first, so the script pass rewrites against the settled sheet",async()=>{
  const model=readFixture(); const {ctx,cards}=mkCtx(model,{ai:{available:true}});
  readCalls=0;
  await box.agentProductionCheck(ctx);
  assert.equal(readCalls,1);
  const unset=cards.findIndex(t=>/Pronouns unset — Marcus/.test(t)), rewrite=cards.findIndex(t=>/real pronouns/.test(t));
  assert.ok(unset>=0 && rewrite>unset,"order: "+cards.join(" / "));
  assert.equal(model.characters[0].pronouns,"he/him");
  // the they/them line only became rewritable once the sheet said he/him
  assert.ok(model.drafts.s1.blocks.some(b=>b.text==="Marcus lifts the card. He places it down."));
});

await test("signature expressions ask first — one card for the cast",async()=>{
  const m1=readFixture(); const r1=mkCtx(m1,{ai:{available:true},approve:c=>!/Signature expressions/.test(c.title)});
  await box.agentProductionCheck(r1.ctx);
  assert.equal(r1.cards.filter(t=>/Signature expressions/.test(t)).length,1);
  assert.equal(m1.characters[0].expressions,undefined,"rejected: nothing written");
  const m2=readFixture(); const r2=mkCtx(m2,{ai:{available:true}});
  await box.agentProductionCheck(r2.ctx);
  assert.deepEqual(plain(m2.characters[0].expressions),["grief"]);
  // unchanged expressions aren't proposed again
  const m3=readFixture(); m3.characters[0].expressions=["grief"]; const r3=mkCtx(m3,{ai:{available:true}});
  await box.agentProductionCheck(r3.ctx);
  assert.ok(!r3.cards.some(t=>/Signature expressions/.test(t)));
});

await test("cards a role can't save are noted in the trace, not shown",async()=>{
  // an Art director: cast cards yes, script rewrites no
  const m1=readFixture(); const r1=mkCtx(m1,{ai:{available:true},can:{script:()=>false,art:()=>true}});
  await box.agentProductionCheck(r1.ctx);
  assert.ok(r1.cards.some(t=>/Pronouns unset/.test(t)),"cast card shown");
  assert.ok(!r1.cards.some(t=>/slug the space|real pronouns/.test(t)),"script cards not shown: "+r1.cards.join(" / "));
  assert.ok(r1.trace.some(e=>e.k==="flag"&&/real pronouns — your role can't change the script/.test(e.t)));
  assert.ok(!m1.drafts.s1.blocks.some(b=>/INT\. BOOTH/.test(b.text)),"the script is untouched");
  // a Writer: script rewrites yes, cast cards no
  const m2=readFixture(); const r2=mkCtx(m2,{ai:{available:true},can:{script:()=>true,art:()=>false}});
  await box.agentProductionCheck(r2.ctx);
  assert.ok(!r2.cards.some(t=>/Pronouns unset|Signature expressions/.test(t)),r2.cards.join(" / "));
  assert.ok(r2.cards.some(t=>/slug the space/.test(t)));
  assert.equal(m2.characters[0].pronouns,"","the cast sheet is untouched");
  assert.ok(r2.trace.some(e=>e.k==="flag"&&/Pronouns unset — Marcus — your role can't change the Art Room/.test(e.t)));
});

await test("the app launches it from the Art Room with a role-aware context",()=>{
  assert.ok(app.includes('initialAgentId:"production", single:true,')&&app.includes('ctxFactory:(args)=>agentCtxFactory({ ...args, scope:"production" }),'));
  assert.ok(app.includes("const productionCheckBlocked = projectLoading || (writersRoomReadOnly && artRoomReadOnly);"));
  assert.ok(/const artOnly = production && writersRoomReadOnlyRef\.current && !artRoomReadOnlyRef\.current;/.test(app));
  // an Art director's commit writes only the cast fields this run changed — a collaborator's
  // mid-run edit to another field (or another character) survives
  // (2026-10-09, Art Room third pass) it reports success (return true) and takes an Art Room undo step
  const a0=app.indexOf("      if(artOnly){"), a1=app.indexOf("        return true;\n      }",a0);
  assert.ok(a0>0&&a1>a0);
  const commit=new Function("castBase","model","setCharacters","artOnly","_prodArtSnap",app.slice(a0,a1)+"}");
  const was={id:"m",name:"Marcus",pronouns:"",coreBody:"tall"}, other={id:"d",name:"Daniel"};
  const castBase={m:was,d:other};
  const model={characters:[{...was,pronouns:"he/him"},other]};
  let live=[{id:"m",name:"Marcus",pronouns:"",coreBody:"tall, grey coat"},{id:"d",name:"Danny"}];
  commit(castBase,model,f=>{ live=f(live); },true,()=>{});
  assert.deepEqual(live,[{id:"m",name:"Marcus",pronouns:"he/him",coreBody:"tall, grey coat"},{id:"d",name:"Danny"}]);
  // a later commit doesn't re-apply what it already wrote over a newer manual edit
  live[0].pronouns="she/her";
  commit(castBase,model,f=>{ live=f(live); },true,()=>{});
  assert.equal(live[0].pronouns,"she/her");
  assert.ok(app.includes("can:{ script:()=> !writersRoomReadOnlyRef.current, art:()=> !artRoomReadOnlyRef.current },"));
  assert.ok(app.includes('window.addEventListener("turn-open-production-check",openProduction);')&&!app.includes("turn-open-consistency-check"));
  const nav=chrome.slice(chrome.indexOf("function ViewNav("),chrome.indexOf("window.ViewNav"));
  assert.ok(nav.includes('"aria-label":"Production check"')&&nav.includes("disabled:!!productionReadOnly"));
  assert.ok(app.includes("onProductionCheck:async ()=>")&&app.includes("productionReadOnly:productionCheckBlocked,"));
});

await test("the identity notice hands off only where the Production check can act",()=>{
  const R={useState:v=>[v,()=>{}],createElement:(t,p,...c)=>({t,p:p||{},c:c.flat()})};
  const events=[];
  const ibox={React:R,console,CustomEvent:function(n,o){this.type=n;this.detail=o&&o.detail;},dispatchEvent:e=>events.push(e.type)};
  ibox.window=ibox; vm.createContext(ibox); vm.runInContext(idUi,ibox);
  const find=(n,pred)=>{ if(!n||typeof n!=="object") return null; if(pred(n)) return n; for(const k of n.c||[]){ const r=find(k,pred); if(r) return r; } return null; };
  const labelOf=b=>b.c.join("");
  const render=(report)=>{ ibox.turnIdentityReport=()=>report; return ibox.CharacterIdentityNotice({character:{id:"a",name:"Ana"},scenes:[],drafts:{},cast:[],onUpdate:()=>{}}); };
  // they/them in the script against a gendered profile: the script pass can rewrite it
  let el=render({status:"conflict",pronouns:"she/her",scriptPronouns:"they/them",issues:[],advisories:[]});
  let b=find(el,n=>n.t==="button"&&/Production check/.test(labelOf(n)));
  assert.ok(b,"offers the Production check"); b.p.onClick(); assert.deepEqual(events,["turn-open-production-check"]);
  // he vs she: nothing rewrites that automatically — no hand-off, no promise
  events.length=0;
  el=render({status:"conflict",pronouns:"she/her",scriptPronouns:"he/him",issues:[],advisories:[]});
  b=find(el,n=>n.t==="button"&&labelOf(n)==="Keep profile");
  assert.ok(b&&!find(el,n=>n.t==="button"&&/Production check/.test(labelOf(n)))); b.p.onClick(); assert.deepEqual(events,[]);
  // unset: the script read proposes pronouns from the exact evidence
  el=render({status:"unset",pronouns:"",scriptPronouns:"he/him",issues:[],advisories:[]});
  assert.ok(find(el,n=>n.t==="button"&&labelOf(n)==="Run Production check"));
  assert.ok(!/Consistency Check/.test(idUi));
});

await test("MUSE knows the Production check, and the Story Editors list no longer offers Script Breakdown",()=>{
  const a=ai.indexOf("const APP_FEATURES"), b=ai.indexOf("function appBrief");
  const mbox={console,window:{}}; vm.createContext(mbox);
  vm.runInContext(ai.slice(a,b).replace(/^const APP_FEATURES/,"var APP_FEATURES")+"\n;this.__F=APP_FEATURES;",mbox);
  const F=mbox.__F, byName=n=>F.find(f=>f.name===n);
  const pc=byName("Production check (Art Room)");
  assert.ok(pc && /Production check' button on the Art Room's (?:view bar|page heading)/.test(pc.what) && /noted in the trace instead of shown/.test(pc.what));
  const se=byName("Story Editors (Writers' Room agents)").what;
  assert.ok(!/Script Breakdown \(the 1st-AD pass/.test(se)&&/Script Supervisor \(the FREE rule-based STORY audit/.test(se));
  assert.ok(/the PRODUCTION CHECK \(the 'Production check' button/.test(se));
  const all=F.map(f=>f.what).join("\n");
  assert.ok(!/Script Breakdown agent|Script Breakdown \(Writers' Room\)/.test(all));
});

console.log(checks+" checks passed");

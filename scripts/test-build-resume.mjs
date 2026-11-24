/* AN UNFINISHED FILM SAYS SO (owner 2026-11-11, Writers' Room audit item 1).
   "Half Strength" was created with 6 of 16 scenes written and nothing said so: a story build runs in the browser, and
   a reload, a closed tab or a sleeping computer ends it. This pins the fix:
     1. app/build-state.js — which scenes are unwritten, the build's record on the film, the Writers' Room notice;
     2. the real build code (app/agents.jsx) writes that record: "writing" from the first save, progress and the log
        with every scene, "done" at the end — and a build cut off mid-way leaves "writing" behind;
     3. Continue writing (ctx.finishOnly) writes just the unwritten scenes, with no approval card and never a rebuild;
     4. the beat map of the scene being written is saved as soon as it exists;
     5. the wiring: the notice strip, the leave question, the screen staying awake, Frances's notes, the page.
   node scripts/test-build-resume.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,6).join("\n    "));}};
const plain=v=>JSON.parse(JSON.stringify(v));

const noop=()=>{};
const box={console,setTimeout,clearTimeout,Promise,Date,JSON,Math,
  React:{createElement:()=>null,useState:v=>[typeof v==="function"?v():v,noop],useEffect:noop,useRef:v=>({current:v}),Fragment:"f"},
  Icon:new Proxy({},{get:()=>()=>null}),
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,
  CustomEvent:class{constructor(t,o){this.type=t;this.detail=o&&o.detail;}}};
box.window=box;box.globalThis=box;vm.createContext(box);
vm.runInContext(read("app/build-state.js"),box,{filename:"build-state.js"});
const BS=box.KinolotBuildState;
box.isStandInDraft=d=>!!(d&&d.standIn);
vm.runInContext(read("app/agents.jsx"),box,{filename:"agents.jsx"});

const sc=(n)=>Array.from({length:n},(_,i)=>({id:"s"+(i+1),no:i+1,title:"Scene "+(i+1),summary:"Something happens "+(i+1),act:1,driver:"ana",loc:"INT. ROOM - DAY"}));
const draft=()=>({blocks:[{type:"scene",text:"INT. ROOM - DAY",beat:1},{type:"action",text:"She waits.",beat:1}],ai:true});
const beats=()=>({rows:[{n:1,drive:{a:"Waits",d:"She waits."},react:{a:"Holds",d:"Nothing answers."},charge:1}]});
const written=(scenes,upTo)=>{const d={},b={};scenes.slice(0,upTo).forEach(s=>{d[s.id]=draft();b[s.id]=beats();});return{d,b};};

await test("unwritten scenes are counted the way Finish writing counts them",()=>{
  const scenes=sc(7),{d,b}=written(scenes,2);
  d.s3={blocks:[{type:"action",text:"x"}],standIn:true};b.s3=beats();   // a rough stand-in
  d.s4=draft();                                                          // a screenplay with no beat map
  const c=plain(BS.counts(scenes,d,b,box.isStandInDraft));
  assert.deepEqual({total:c.total,n:c.n,blank:c.blank,standIns:c.standIns,beatMaps:c.beatMaps,firstNo:c.firstNo},{total:7,n:5,blank:3,standIns:1,beatMaps:1,firstNo:3});
  assert.equal(c.ids.join(","),"s3,s4,s5,s6,s7");
  const all=written(scenes,7);
  assert.equal(BS.counts(scenes,all.d,all.b,box.isStandInDraft).n,0);
});

await test("the notice: a film cut off mid-build, a film built before this existed, and the films that get none",()=>{
  const scenes=sc(7),{d,b}=written(scenes,2),c=BS.counts(scenes,d,b);
  // cut off mid-build: the record still says "writing"
  const cut=BS.notice({project:{title:"Notice",sourceBrief:"A bride…",build:{status:"writing",updatedAt:"2026-11-11T21:14:00Z",log:[{k:"act",t:"Writing Sc 3"}]}},counts:c,running:false});
  assert.ok(cut&&cut.interrupted);
  assert.equal(cut.headline,"This film isn’t fully written");
  assert.equal(cut.what,"5 of 7 scenes have no screenplay yet.");
  assert.match(cut.why,/^The build stopped before it finished \(last progress .+\)\. Everything already written is kept\.$/);
  assert.equal(cut.action,"Continue writing");
  assert.equal(cut.actionHint,"Writes just the 5 unwritten scenes — nothing already written is redone.");
  assert.equal(cut.log.length,1);
  // "Half Strength": built before the record existed — its scenes alone say it
  const old=BS.notice({project:{title:"Half Strength",sourceBrief:"Two swimmers…"},counts:BS.counts(sc(16),written(sc(16),6).d,written(sc(16),6).b),running:false});
  assert.ok(old&&!old.interrupted);
  assert.equal(old.what,"10 of 16 scenes have no screenplay yet.");
  assert.equal(old.why,"Everything already written is kept.");
  assert.equal(old.log.length,0);
  // a build that reached its end with failures left: no "stopped before it finished"
  const d2={...d,s3:{blocks:[{type:"action",text:"x"}],standIn:true}},b2={...b,s3:beats()};
  const done=BS.notice({project:{sourceBrief:"x",build:{status:"done"}},counts:BS.counts(scenes.slice(0,3),d2,b2,box.isStandInDraft),running:false});
  assert.equal(done.what,"1 of 3 scenes has no screenplay yet (1 is a rough stand-in).");
  assert.equal(done.interrupted,false);
  // only beat maps missing
  const bm=BS.notice({project:{sourceBrief:"x"},counts:{total:4,n:1,blank:0,standIns:0,beatMaps:1,ids:["s2"]},running:false});
  assert.equal(bm.what,"1 scene has a screenplay but no beat map.");
  assert.equal(bm.actionHint,"Writes just the unwritten scene — nothing already written is redone.");
  // none: while a build is writing; a fully written film (even with a stale "writing" record); a film written by
  // hand; an imported screenplay (it has its own bar); an empty film
  assert.equal(BS.notice({project:{sourceBrief:"x",build:{status:"writing"}},counts:c,running:true}),null);
  const full=written(scenes,7);
  assert.equal(BS.notice({project:{sourceBrief:"x",build:{status:"writing"}},counts:BS.counts(scenes,full.d,full.b),running:false}),null);
  assert.equal(BS.notice({project:{title:"By hand"},counts:c,running:false}),null);
  assert.equal(BS.notice({project:{sourceBrief:"x",importedFrom:{file:"a.fdx"}},counts:c,running:false}),null);
  assert.equal(BS.notice({project:{sourceBrief:"x"},counts:BS.counts([],{},{}),running:false}),null);
  // a scene the writer just added by hand ("New Scene", not described yet) never raises the notice by itself —
  // it is still counted as unwritten, and it rides along when other scenes are unwritten too
  const hand=[...scenes,{id:"h1",no:8,title:"New Scene",summary:"A new scene \u2014 describe what happens here."}];
  const ch=BS.counts(hand,full.d,full.b);
  assert.equal(ch.n,1);assert.equal(ch.placeholders,1);
  assert.equal(BS.notice({project:{sourceBrief:"x",build:{status:"done"}},counts:ch,running:false}),null);
  assert.equal(BS.notice({project:{sourceBrief:"x"},counts:BS.counts(hand,d,b),running:false}).what,"6 of 8 scenes have no screenplay yet.");
  // "Not now" is per film and per set of unwritten scenes: one more written scene brings the bar back
  const k1=cut.key,k2=BS.notice({project:{title:"Notice",sourceBrief:"x"},counts:BS.counts(scenes,written(scenes,3).d,written(scenes,3).b),running:false}).key;
  assert.notEqual(k1,k2);
});

await test("the record on the film: merged, never mutating, log capped and trimmed",()=>{
  const p={title:"A",build:{status:"writing",startedAt:"t0",log:[{k:"act",t:"old"}]}};
  const steps=Array.from({length:90},(_,i)=>({k:i%2?"act":"ok",t:"line "+i+"  with   spaces"}));
  steps.push({k:"propose",t:"a card"},{k:"flag",t:"x".repeat(400)},null,{k:"ok",t:"  "});
  const q=BS.mark(p,{status:"done",endedAt:"t1",failed:undefined},steps);
  assert.equal(p.build.status,"writing");
  assert.equal(q.build.status,"done");assert.equal(q.build.startedAt,"t0");assert.equal(q.build.endedAt,"t1");
  assert.ok(!("failed" in q.build));
  assert.equal(q.build.log.length,BS.LOG_MAX);
  assert.equal(q.build.log[q.build.log.length-1].t.length,BS.LINE_MAX);
  assert.ok(q.build.log.every(s=>s.k!=="propose"&&!/\s{2}/.test(s.t)));
  assert.equal(BS.mark({title:"B"},{status:"writing"}).build.status,"writing");
});

/* ---- the real build code, with a writing engine that answers at once ---- */
const makeCtx=(scenes,drafts,beatsMap,opts={})=>{
  const saved=[];let stop=false;
  const ctx={
    input:opts.input||"",finishOnly:!!opts.finishOnly,
    model:{scenes:scenes.map(s=>({...s})),characters:[{id:"ana",name:"ANA"}],project:{title:"Film",sourceBrief:"brief",...(opts.project||{})},beats:{...beatsMap},drafts:{...drafts},continuity:{}},
    trace:[],proposals:[],
    emit:(s)=>ctx.trace.push(s),
    propose:async(card)=>{ctx.proposals.push(card);return opts.answer!==false;},
    cancelled:()=>stop,stopNow:()=>{stop=true;},
    sync:()=>{saved.push(plain({project:ctx.model.project,drafts:Object.keys(ctx.model.drafts),beats:Object.keys(ctx.model.beats)}));return true;},
    saved,
    ai:{available:true,
      authorScene:async(s)=>{if(opts.onAuthor)await opts.onAuthor(s,ctx);return{patch:{},beats:beats()};},
      draftScene:async(s)=>{if(opts.onDraft)await opts.onDraft(s,ctx);return draft();}},
  };
  return ctx;
};

await test("a build writes its record with every scene, and ends on \"done\" with the log",async()=>{
  const scenes=sc(3),ctx=makeCtx(scenes,{},{});
  const rec=box.buildRecorder(ctx);
  rec.start();ctx.sync();
  assert.equal(ctx.saved[0].project.build.status,"writing");
  assert.equal(ctx.saved[0].project.build.total,3);assert.equal(ctx.saved[0].project.build.written,0);
  const r=await box.writeScenesSeq(ctx,[0,1,2]);
  assert.equal(r.stopped,false);assert.equal(r.written,3);
  rec.end(r.failures.length);ctx.sync();
  const last=ctx.saved[ctx.saved.length-1].project.build;
  assert.equal(last.status,"done");assert.equal(last.written,3);assert.equal(last.failed,0);assert.ok(last.endedAt);
  assert.ok(last.log.some(s=>/Writing Sc 3/.test(s.t)));
  // progress was saved along the way: some save carried "writing" with 1, then 2 scenes written
  const seen=ctx.saved.filter(s=>s.project.build.status==="writing").map(s=>s.project.build.written);
  assert.ok(seen.includes(1)&&seen.includes(2),"progress saved: "+seen.join(","));
});

await test("a build cut off while scene 3 is being written leaves a film that says so",async()=>{
  // the page goes away during scene 3's screenplay: nothing after that point runs, so nothing after it is saved
  const scenes=sc(5);let frozen=null;
  const ctx=makeCtx(scenes,{},{},{onDraft:async(s,c)=>{if(s.no===3){frozen=plain(c.saved[c.saved.length-1]);c.stopNow();}}});
  const rec=box.buildRecorder(ctx);rec.start();ctx.sync();
  await box.writeScenesSeq(ctx,[0,1,2,3,4]);
  assert.ok(frozen,"the last save before the cut");
  assert.equal(frozen.project.build.status,"writing");
  assert.equal(frozen.project.build.written,2);
  // scene 3's beat map was saved as soon as it existed, before its screenplay
  assert.deepEqual(frozen.beats,["s1","s2","s3"]);assert.deepEqual(frozen.drafts,["s1","s2"]);
  const c=BS.counts(scenes,Object.fromEntries(frozen.drafts.map(id=>[id,draft()])),Object.fromEntries(frozen.beats.map(id=>[id,beats()])),box.isStandInDraft);
  const n=BS.notice({project:frozen.project,counts:c,running:false});
  assert.ok(n&&n.interrupted);assert.equal(n.what,"3 of 5 scenes have no screenplay yet.");
  // the log kept with the film ends on the scene the build was in
  assert.match(n.log[n.log.length-1].t,/^Writing Sc 3 /);
});

await test("Stop saves the log's last lines; a film switch saves nothing more",async()=>{
  const scenes=sc(3);
  const ctx=makeCtx(scenes,{},{},{onAuthor:async(s,c)=>{if(s.no===2)c.stopNow();}});
  const rec=box.buildRecorder(ctx);rec.start();ctx.sync();
  const r=await box.writeScenesSeq(ctx,[0,1,2]);
  assert.equal(r.stopped,true);
  const before=ctx.saved.length;rec.stopped();
  assert.equal(ctx.saved.length,before+1);
  const b=ctx.saved[ctx.saved.length-1].project.build;
  assert.equal(b.status,"writing");assert.ok(b.log.some(s=>/^Stopped/.test(s.t)));
  const ctx2=makeCtx(scenes,{},{});ctx2.switchedFilms=()=>true;
  const rec2=box.buildRecorder(ctx2);rec2.start();const n2=ctx2.saved.length;rec2.stopped();
  assert.equal(ctx2.saved.length,n2);
});

await test("Continue writing: just the unwritten scenes, no approval card, never a rebuild",async()=>{
  const scenes=sc(5),{d,b}=written(scenes,2);
  const wrote=[];
  const ctx=makeCtx(scenes,d,b,{finishOnly:true,input:"brief",onDraft:async(s)=>{wrote.push(s.no);}});
  ctx.ai.continuityLedger=null;
  await box.agentAdaptation(ctx);
  assert.deepEqual(wrote,[3,4,5]);
  assert.equal(ctx.proposals.length,0,"no approval card");
  assert.ok(ctx.trace.some(s=>/^Continuing this film: 3 of 5 scenes have no screenplay yet\./.test(s.t)));
  assert.match(ctx.saved[0].project.build.log[0].t,/^Continuing this film/,"the log starts with the run's first line");
  assert.ok(ctx.trace.some(s=>s.k==="done"&&/All 5 scenes now have beats and screenplay/.test(s.t)));
  const last=ctx.saved[ctx.saved.length-1].project.build;
  assert.equal(last.status,"done");assert.equal(last.written,5);
  assert.ok(last.log.some(s=>/All 5 scenes now have beats and screenplay/.test(s.t)),"the whole log is kept");
  assert.equal(BS.notice({project:ctx.model.project,counts:BS.counts(ctx.model.scenes,ctx.model.drafts,ctx.model.beats,box.isStandInDraft),running:false}),null);
  // a scene whose beat map was already saved is drafted from it, not authored again
  const authored=[];const s2=sc(3),w2=written(s2,1);w2.b.s2=beats();
  const ctx2=makeCtx(s2,w2.d,w2.b,{finishOnly:true,onAuthor:async(s)=>{authored.push(s.no);}});
  await box.agentAdaptation(ctx2);
  assert.deepEqual(authored,[3]);
  // nothing left to write: it says so and ends — it never goes on to build a new spine
  const full=written(scenes,5),ctx3=makeCtx(scenes,full.d,full.b,{finishOnly:true,input:"brief"});
  box.aiBuildSpine=async()=>{throw new Error("a rebuild was started");};
  await box.agentAdaptation(ctx3);
  assert.equal(ctx3.proposals.length,0);assert.equal(ctx3.saved.length,0);
  assert.ok(ctx3.trace.some(s=>s.k==="done"&&/already has its beats and screenplay/.test(s.t)));
});

await test("without Continue writing, the finish run still asks first (Story Editors' own route)",async()=>{
  const scenes=sc(4),{d,b}=written(scenes,3);
  const ctx=makeCtx(scenes,d,b,{input:"brief"});
  await box.agentAdaptation(ctx);
  assert.equal(ctx.proposals.length,1);assert.equal(ctx.proposals[0].title,"Finish writing this film first?");
  assert.equal(ctx.saved[ctx.saved.length-1].project.build.status,"done");
});

await test("the screen is kept awake only while asked, and let go afterwards",async()=>{
  const calls=[];let released=0;const listeners={};
  box.navigator={wakeLock:{request:(kind)=>{calls.push(kind);return Promise.resolve({release:()=>{released++;return Promise.resolve();}});}}};
  box.document={visibilityState:"visible",addEventListener:(t,f)=>{listeners[t]=f;},removeEventListener:(t)=>{delete listeners[t];}};
  const letGo=BS.keepAwake();
  await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(calls,["screen"]);assert.ok(listeners.visibilitychange);
  listeners.visibilitychange();await new Promise(r=>setTimeout(r,5));
  assert.equal(calls.length,2,"asked again when the tab comes back");
  letGo();assert.equal(released,1);assert.ok(!listeners.visibilitychange);
  // a browser without it: nothing breaks
  box.navigator={};assert.equal(typeof BS.keepAwake(),"function");BS.keepAwake()();
});

await test("the wiring: the notice strip, the leave question, the window, Frances, the page",()=>{
  const app=read("app/app.jsx"),ui=read("app/agents-ui.jsx"),ag=read("app/agents.jsx"),ai=read("app/ai.jsx"),html=read("TURN.html"),css=read("app/styles.css");
  // the strip: Writers' Room only, hidden while Story Editors is open, one press starts the finish run
  assert.ok(app.includes('room==="writers" && buildNotice && buildNoticeOff!==buildNotice.key && !agentsOpen'));
  assert.ok(app.includes('"data-testid":"build-notice"')&&app.includes('"data-testid":"build-continue"')&&app.includes('"data-testid":"build-log"'));
  assert.ok(app.includes('setAgentLaunch({ id:"adapt", input:String((project && (project.sourceBrief || project.logline)) || ""), finishNow:true }); setAgentsOpen(true);'));
  // (2026-11-12, audit A7: an Auto-draft all notice branches off between the two — scripts/test-writers-room-stops.mjs)
  assert.ok(app.includes('const go = ()=>{ if(!canMutateWritersRoom()) return;')&&app.includes('if(!planActive()){ requirePlan("finish writing this film"); return; }'));
  assert.ok(app.includes("disabled:writersRoomBlocked||!aiOn"));
  assert.ok(app.includes("finishNow: !!(agentLaunch && agentLaunch.finishNow),"));
  assert.ok(app.includes('finishOnly: force==="finish",'));
  assert.ok(app.includes("const c = window.KinolotBuildState.counts(scenes, drafts, beatsMap, window.isStandInDraft), n = c.n, st = c.standIns, bm = c.beatMaps;"),"Story Editors and the notice count with one rule");
  // leaving during a build asks; the app closing the window mid-build says so
  const guard=app.slice(app.indexOf("/* UNLOAD GUARD"),app.indexOf('window.addEventListener("beforeunload", h);'));
  assert.ok(guard.includes("const building = ((window.__turnAgentRunCount||{}).adapt||0)>0")&&guard.includes("if(!building && !dirtyRef.current"));
  assert.ok(app.includes("The story build was stopped because this film was reloaded or your access changed."));
  // the window: started at once on the finish run; the screen stays awake for a story build only
  assert.ok(ui.includes('(finishNow && initialAgentId==="adapt") ? { input:String(finishInput||""), now:true } : null'));
  assert.ok(ui.includes('force: (finishing && finishLaunch.now) ? "finish" : (active.id===initialAgentId ? force : false),'));
  assert.ok(ui.includes("runOnOpen: !!runOnOpen && active.id===initialAgentId && !finishing || (finishing && !!finishLaunch.now)})"));
  assert.ok(ui.includes('(agent.kind==="build" && !isArt && window.KinolotBuildState) ? window.KinolotBuildState.keepAwake() : null')&&ui.includes("if(letSleep) letSleep();"));
  // the build: both routes record themselves
  assert.equal(ag.split("const rec = buildRecorder(ctx);").length-1,2);
  assert.equal(ag.split("if(r.stopped){ rec.stopped(); return; }").length-1,2);
  assert.ok(ag.includes("const finish = ctx.finishOnly ? true : await ctx.propose({"));
  // Frances knows, in plain words
  const f=ai.slice(ai.indexOf("Unfinished film notice & Continue writing (Writers' Room)"));
  for(const s of ["'Unfinished · This film isn't fully written'","'Continue writing' button opens Story Editors and starts writing just the unwritten scenes at once","'What happened' opens the last build's log",
    "LEAVING DURING A BUILD ASKS FIRST","THE SCREEN STAYS AWAKE","The build does not carry on by itself after an interruption"]) assert.ok(f.includes(s),s);
  // the page loads the module before the build code, on the current key
  const at=s=>{const i=html.indexOf(s);assert.ok(i>=0,s);return i;};
  assert.ok(at("app/build-state.js?v=")<at("app/agents.jsx?v="));
  // the homepage says it, without promising a build that runs by itself
  assert.ok(read("app/landing.jsx").includes("If a build is ever interrupted, your film tells you what is left and carries on from there in one click \u2014 nothing already written is lost."));
  for(const file of ["build-state.js","agents.jsx","agents-ui.jsx","app.jsx","ai.jsx","script.jsx","styles.css","landing.jsx"])
    assert.ok(["20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
  assert.ok(css.includes(".build-strip-log ol{"));
  // no internal codename, no vendor, in anything this shows
  const shown=[read("app/build-state.js"),f.slice(0,2600)].join("\n");
  assert.ok(!/\bTURN\b|Claude|Anthropic|McKee/.test(shown.replace(/window\.TURN_[A-Z_]+/g,"")));
});

console.log(`\n${checks} checks passed${failed?`, ${failed} FAILED`:""}`);
process.exit(failed?1:0);

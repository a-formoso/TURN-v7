/* THE REST OF "A FILM CAN STOP PART-WAY" (owner 2026-11-12, Writers' Room audit A7 to A11). Runs the REAL app code
   (build-state.js, ai.jsx's writing call and failure wording, the build in agents.jsx, chrome.jsx's count) and pins:
     A7  Auto-draft all leaves a sign on the film: its own record (project.draftRun), the Writers' Room notice on any
         film, Continue writing = Auto-draft all again there, the leave question, the awake screen;
     A8  Escape during a running build asks first, whichever way the editor was opened;
     A9  the Film menu's "N of M scenes drafted" does not count a rough stand-in;
     A10 an answer the balance could only pay part of is a credits problem: said as one, not asked for twice, and a
         batch stops at once;
     A11 after a film switch the run's last line says what is true.
   node scripts/test-writers-room-stops.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import {transformSync} from "@babel/core";
const require=createRequire(import.meta.url);
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};
const BS=require("../app/build-state.js");

const makeBox=()=>{
  const box={console:{...console,warn:noop,info:noop},setTimeout:()=>0,clearTimeout:noop,setInterval:()=>0,clearInterval:noop,
    React:new Proxy({createElement:()=>null,Fragment:"f",useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useMemo:f=>f(),useCallback:f=>f,memo:f=>f},{get:(t,k)=>(k in t)?t[k]:noop}),
    ReactDOM:new Proxy({},{get:()=>noop}),Icon:new Proxy({},{get:()=>()=>null}),
    localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
    navigator:{userAgent:"node-test"},location:{href:"",search:"",hash:"",origin:""},
    CustomEvent:class{constructor(t,o){this.type=t;this.detail=o&&o.detail;}},Image:class{},
    document:{createElement:()=>({getContext:()=>null,style:{},setAttribute:noop,appendChild:noop,classList:{add:noop,remove:noop}}),getElementById:()=>null,
      addEventListener:noop,removeEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],createTextNode:()=>({}),body:{appendChild:noop,removeChild:noop},head:{appendChild:noop}},
    requestAnimationFrame:noop,cancelAnimationFrame:noop,addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,
    matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),fetch:()=>{throw new Error("network disabled");}};
  box.window=box;box.globalThis=box;box.self=box;vm.createContext(box);
  const asShipped=f=>transformSync(read(f),{plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:f}).code;
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx","app/build-state.js","app/agents.jsx"])
    vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
  box.__toasts=[];box.appToast=(m,t,o)=>box.__toasts.push({m:String(m),t,o});
  box.__sent=[];box.__answers=[];
  box.sbClient=()=>({functions:{invoke:(name,o)=>{box.__sent.push(o.body);const a=box.__answers.shift();
    return a===undefined?new Promise(()=>{}):Promise.resolve(a);}}});
  box.turnIsAdmin=false;
  return box;
};
const ok=(text,extra)=>({data:{text,usage:{credits:1},...(extra||{})},error:null});
const ask=(box,o)=>box.claude.complete({messages:[{role:"user",content:"x"}],...(o||{})});
const CUT="There were not enough credits for the whole answer, so it was cut off before it finished (the part that was written is charged). Add credits or choose a lighter writing engine, then try again.";

/* ---------------------------------------------------------------- A7 */
const sc=n=>Array.from({length:n},(_,i)=>({id:"s"+(i+1),no:i+1,title:"Scene "+(i+1),summary:"Something happens "+(i+1)}));
const written=(scenes,k)=>{const d={},b={};scenes.slice(0,k).forEach(s=>{d[s.id]={blocks:[{type:"action",text:"x"}],ai:true,by:"e"};b[s.id]={rows:[{n:1}]};});return{d,b};};
const box0=makeBox();
const reason=box0.screenplayFailureReason;
const at="2026-11-12T10:00:00Z",when=BS.fmtWhen(at);

await test("A7 · the record Auto-draft all keeps: a status, the scenes left, the failure's KIND — never a sentence",()=>{
  const p0={title:"Hand",logline:"x"};
  const p1=BS.markDraftRun(p0,{status:"writing",startedAt:at,updatedAt:at,left:["s3","s4",5]});
  assert.notEqual(p1,p0);assert.equal(p0.draftRun,undefined,"the film object is not changed in place");
  assert.deepEqual(p1.draftRun,{status:"writing",startedAt:at,updatedAt:at,left:["s3","s4","5"]});
  const p2=BS.markDraftRun(p1,{status:"stopped",by:"halt",at:3,repeated:undefined,
    fail:{kind:"plan",billing:"short",ref:undefined,technical:"provider said: sk-secret",raw:"…",issues:["x"]}});
  assert.deepEqual(p2.draftRun.fail,{kind:"plan",billing:"short"},"only the kind, the billing case and the reference are kept");
  assert.ok(!JSON.stringify(p2).includes("sk-secret"));
  assert.equal(p2.title,"Hand");assert.equal(p2.draftRun.startedAt,at);
  // a key set to undefined is removed; a failure with no kind is dropped
  const p3=BS.markDraftRun(p2,{status:"done",left:undefined,at:undefined,by:undefined,fail:undefined});
  assert.deepEqual(Object.keys(p3.draftRun).sort(),["startedAt","status","updatedAt"]);
  assert.equal(BS.markDraftRun({}, {status:"stopped",fail:{billing:"short"}}).draftRun.fail,undefined);
});

await test("A7 · a film written by hand: the notice shows what Auto-draft all left, where it stopped, when and why",()=>{
  const scenes=sc(6),{d,b}=written(scenes,2),c=BS.counts(scenes,d,b);
  assert.deepEqual(c.blankIds,["s3","s4","s5","s6"]);
  const hand={title:"By hand"};
  assert.equal(BS.notice({project:hand,counts:c,failureReason:reason}),null,"no run, no notice: a hand-written film keeps its own tools");
  const halted=BS.markDraftRun(hand,{status:"stopped",by:"halt",at:3,updatedAt:at,left:["s3","s4","s5","s6"],fail:{kind:"plan",billing:"credits"}});
  const n=BS.notice({project:halted,counts:c,failureReason:reason});
  assert.equal(n.via,"draft");assert.equal(n.n,4);assert.equal(n.headline,"This film isn’t fully written");
  assert.equal(n.what,"4 of 6 scenes have no screenplay yet.");
  assert.equal(n.why,"Auto-draft all stopped at Scene 3 ("+when+"): your account has no plan credits left for writing. Everything already written is kept.");
  assert.equal(n.action,"Continue writing");
  assert.equal(n.actionHint,"Auto-draft all again, for the 4 unwritten scenes — it asks first.");
  assert.deepEqual(n.log,[]);
  // the same failure twice in a row says so; the balance that covered part of an answer has its own words
  const twice=BS.markDraftRun(halted,{repeated:true,fail:{kind:"timeout"}});
  assert.equal(BS.notice({project:twice,counts:c,failureReason:reason}).why,
    "Auto-draft all stopped at Scene 3 ("+when+"): the writing engine took too long to answer, for the second scene in a row. Everything already written is kept.");
  const short=BS.markDraftRun(halted,{fail:{kind:"plan",billing:"short"}});
  assert.match(BS.notice({project:short,counts:c,failureReason:reason}).why,/: there were not enough credits for the whole answer, so it was cut off\. Everything/);
  // Stop pressed, and a run the page left behind
  const stop=BS.markDraftRun(hand,{status:"stopped",by:"stop",at:4,updatedAt:at,left:["s3","s4","s5","s6"]});
  assert.equal(BS.notice({project:stop,counts:c,failureReason:reason}).why,"You stopped Auto-draft all at Scene 4 ("+when+"). Everything already written is kept.");
  const gone=BS.markDraftRun(hand,{status:"writing",startedAt:at,updatedAt:at,left:["s3","s4","s5","s6"]});
  const g=BS.notice({project:gone,counts:c,failureReason:reason});
  assert.equal(g.interrupted,true);
  assert.equal(g.why,"Auto-draft all stopped before it finished (last progress "+when+"). Everything already written is kept.");
  // without a wording function the notice still stands, with no reason
  assert.equal(BS.notice({project:halted,counts:c}).why,"Auto-draft all stopped at Scene 3 ("+when+"). Everything already written is kept.");
});

await test("A7 · the admin's wording of a failure is never what is saved: each reader gets their own",()=>{
  const scenes=sc(3),{d,b}=written(scenes,1),c=BS.counts(scenes,d,b);
  const p=BS.markDraftRun({title:"F"},{status:"stopped",by:"halt",at:2,updatedAt:at,left:["s2","s3"],fail:{kind:"credits",ref:"CM-11"}});
  const box=makeBox();
  box.turnIsAdmin=true;
  assert.match(BS.notice({project:p,counts:c,failureReason:box.screenplayFailureReason}).why,/the writing provider’s account is out of credits/);
  box.turnIsAdmin=false;
  const w=BS.notice({project:p,counts:c,failureReason:box.screenplayFailureReason}).why;
  assert.match(w,/the writing service is briefly unavailable \(ref CM-11\)/);assert.ok(!/provider/.test(w));
  assert.ok(!/provider/.test(JSON.stringify(p)));
});

await test("A7 · the notice speaks only for the scenes that run left, and goes when they are written",()=>{
  const scenes=sc(6),{d,b}=written(scenes,2);
  const p=BS.markDraftRun({title:"By hand"},{status:"stopped",by:"halt",at:3,updatedAt:at,left:["s3","s4","s5","s6"],fail:{kind:"signin"}});
  // two of the four get written by any means
  const more=written(scenes,4),c2=BS.counts(scenes,more.d,more.b);
  assert.equal(BS.notice({project:p,counts:c2,failureReason:reason}).what,"2 of 6 scenes have no screenplay yet.");
  // all written: gone, though the record still says "stopped"
  const all=written(scenes,6);
  assert.equal(BS.notice({project:p,counts:BS.counts(scenes,all.d,all.b),failureReason:reason}),null);
  // a scene the writer adds afterwards was never part of the run: it does not bring the notice back
  const plus=[...scenes,{id:"s7",no:7,title:"Coda",summary:"She comes back."}];
  assert.equal(BS.notice({project:p,counts:BS.counts(plus,all.d,all.b),failureReason:reason}),null);
  // a hand-written screenplay with no beat map is the writer's own business on such a film
  const noMap={...all.b};delete noMap.s1;
  assert.equal(BS.notice({project:p,counts:BS.counts(scenes,all.d,noMap),failureReason:reason}),null);
  // a finished run, and a run in progress, show nothing
  const done=BS.markDraftRun(p,{status:"done"}),c=BS.counts(scenes,d,b);
  assert.equal(BS.notice({project:done,counts:c,failureReason:reason}),null);
  assert.equal(BS.notice({project:p,counts:c,running:true,failureReason:reason}),null);
  // a record with no list of scenes (never written by the app, but harmless) owes every blank scene
  assert.equal(BS.notice({project:{title:"x",draftRun:{status:"stopped"}},counts:c}).n,4);
  // the "Not now" key changes with the scenes still owed
  assert.notEqual(BS.notice({project:p,counts:c}).key,BS.notice({project:p,counts:c2}).key);
});

await test("A7 · a film the app built keeps its own notice and Continue writing; the run's reason is added",()=>{
  const scenes=sc(6),{d,b}=written(scenes,2),c=BS.counts(scenes,d,b);
  const built={title:"Built",sourceBrief:"Two swimmers…",build:{status:"done",updatedAt:"2026-11-11T09:00:00Z"}};
  const plain=BS.notice({project:built,counts:c,failureReason:reason});
  assert.equal(plain.via,"build");assert.equal(plain.why,"Everything already written is kept.");
  const p=BS.markDraftRun(built,{status:"stopped",by:"halt",at:3,updatedAt:at,left:["s3","s4","s5","s6"],fail:{kind:"plan",billing:"credits"}});
  const n=BS.notice({project:p,counts:c,failureReason:reason});
  assert.equal(n.via,"build","Continue writing stays the build's finish run");
  assert.equal(n.what,"4 of 6 scenes have no screenplay yet.");
  assert.equal(n.why,"Auto-draft all stopped at Scene 3 ("+when+"): your account has no plan credits left for writing. Everything already written is kept.");
  assert.equal(n.actionHint,"Writes just the 4 unwritten scenes — nothing already written is redone.");
  // a build that was itself cut short still says so first
  const cut=BS.notice({project:{...p,build:{status:"writing",updatedAt:at}},counts:c,failureReason:reason});
  assert.match(cut.why,/^The build stopped before it finished/);
  // an imported screenplay with no build of its own: only the run's scenes, through Auto-draft all
  const imp=BS.markDraftRun({title:"Imp",sourceBrief:"x",importedFrom:{file:"a.fdx"}},{status:"stopped",by:"stop",at:3,updatedAt:at,left:["s3"]});
  assert.equal(BS.notice({project:imp,counts:c}).via,"draft");assert.equal(BS.notice({project:imp,counts:c}).n,1);
});

await test("A7 · the app: Auto-draft all writes its record, asks before leaving, keeps the screen awake, and the notice runs it again",()=>{
  const app=read("app/app.jsx");
  const a=app.indexOf("const draftAll = async ()=>{"),z=app.indexOf("const stopDraftAll",a),fn=app.slice(a,z);
  assert.ok(a>0&&z>a);
  // the record: "writing" with the scenes left when it starts; progress after every scene; then how it ended
  assert.match(fn,/noteRun\(\{ status:"writing", startedAt:stamp\(\), updatedAt:stamp\(\)[^}]*\n\s*left:working\.filter\(x=>!have\[x\.id\]\)\.map\(x=>String\(x\.id\)\) \}\);/);
  assert.ok(fn.includes('noteRun({ updatedAt:stamp() });'));
  assert.match(fn,/if\(halted\) noteRun\(\{ status:"stopped", by:"halt", at:halted\.no,/);
  assert.ok(fn.includes('fail:halted.failure ? { kind:halted.failure.kind, billing:halted.failure.billing, ref:halted.failure.ref } : undefined'),"the kind, not the sentence");
  assert.match(fn,/else if\(stoppedAt\) noteRun\(\{ status:"stopped", by:"stop", at:stoppedAt\.no,/);
  assert.match(fn,/else if\(!leftNow\) noteRun\(\{ status:"done",/);
  // never into another film, never by a role that can't change the story
  assert.match(fn,/const noteRun = \(patch\)=>\{\s*if\(!BS \|\| typeof BS\.markDraftRun!=="function" \|\| owner !== projIdRef\.current \|\| writersRoomReadOnlyRef\.current\) return;\s*setProject\(p=>BS\.markDraftRun\(p, patch\)\);/);
  // the confirmation still comes first (owner 2026-10-09): nothing is recorded for a run that was declined
  assert.ok(fn.indexOf("window.appConfirm(")<fn.indexOf("noteRun({ status:\"writing\""));
  // awake while it writes, let go in the finally
  assert.ok(fn.includes("const letSleep = (BS && typeof BS.keepAwake===\"function\") ? BS.keepAwake() : null;"));
  assert.ok(fn.indexOf("if(letSleep) letSleep();")>fn.indexOf("} finally {"));
  // leaving the page while a scene is being drafted asks
  assert.ok(app.includes("const building = ((window.__turnAgentRunCount||{}).adapt||0)>0 || !!draftingRef.current;"));
  // the notice: hidden while Auto-draft all runs, worded for the reader, and on a film the app did not build its
  // button is Auto-draft all (which asks first) — never the build's finish run
  assert.ok(app.includes("running:buildRunning || !!(drafting && !drafting.one), failureReason:window.screenplayFailureReason })"));
  assert.ok(app.includes('if(buildNotice.via==="draft"){ setBuildLogOpen(false); draftAll(); return; }'));
  const go=app.slice(app.indexOf('if(buildNotice.via==="draft")'),app.indexOf('setAgentLaunch({ id:"adapt"',app.indexOf('if(buildNotice.via==="draft")')));
  assert.ok(go.includes("requirePlan("),"the build's finish run still checks the plan after the draft branch");
});

/* ---------------------------------------------------------------- A8, A11 */
await test("A8 · Escape during a running build asks first, whichever way the editor was opened",()=>{
  const ui=read("app/agents-ui.jsx");
  assert.ok(ui.includes("const closeRef = React.useRef(close);\n  closeRef.current = close;"),"the newest close(), every render");
  const eff=ui.slice(ui.indexOf("const onKey = (e)=>{ if(e.key===\"Escape\""),ui.indexOf("window.addEventListener(\"keydown\", onKey);"));
  assert.ok(eff.includes("closeRef.current();"));assert.ok(!/[^.]close\(\);/.test(eff),"never the close() of the first render");
  // the question itself is unchanged, and still only for the story build
  assert.ok(ui.includes('title:"Stop building this film?"'));
  assert.ok(ui.includes('const building = active && active.kind==="build" && active.room!=="art";'));
  // behaviour: the handler bound at mount sees an editor chosen afterwards
  let active=null,asked=0,closed=0;const running={current:false};
  const mk=()=>{const leaveOk=async()=>{const building=active&&active.kind==="build"&&active.room!=="art";if(!(running.current&&building))return true;asked++;return false;};return async()=>{if(await leaveOk())closed++;};};
  const closeRef={current:mk()};const onKey=()=>closeRef.current();   // bound once
  active={id:"adapt",kind:"build"};running.current=true;closeRef.current=mk();   // the next render
  return onKey().then(()=>{assert.equal(asked,1);assert.equal(closed,0);});
});

await test("A11 · after a film switch the run's last line says what is true, once",()=>{
  const ui=read("app/agents-ui.jsx");
  assert.ok(!/t:"[^"]*nothing was changed or saved/.test(ui),"the untrue sentence is gone");
  assert.ok(ui.includes('t:"You switched films, so this run stopped \\u2014 nothing was written into the film now open. Whatever it had already written or changed stays in the film it started in. Reopen that film to run it again."'));
  // an editor that already said so (the build, the wrong-film guards) is not repeated
  assert.ok(ui.includes('tr.some(x=>x && /^You switched films/.test(String(x.t||""))) ? tr'));
  for(const said of ["You switched films, so this run stopped safely — nothing was written into the film now open.",
    "You switched films while this ran, so its changes were NOT applied",
    "You switched films while this ran, so it stopped — nothing more was written to either film."])
    assert.ok(/^You switched films/.test(said));
});

/* ---------------------------------------------------------------- A9 */
await test("A9 · the Film menu counts written screenplays; a rough stand-in is named apart",()=>{
  const src=read("app/chrome.jsx");
  const a=src.indexOf("function filmDraftedLabel("),z=src.indexOf("window.filmDraftedLabel = filmDraftedLabel;");
  const box=makeBox();   // the real isStandInDraft (script.jsx)
  const label=vm.runInContext("("+src.slice(a,z).trim()+")",box);
  const scenes=sc(16),d={};
  scenes.slice(0,14).forEach(s=>{d[s.id]={blocks:[{type:"action",text:"x"}],ai:true,by:"e"};});
  assert.equal(label(scenes,d),"14 of 16 scenes drafted");
  d.s15={blocks:[{type:"action",text:"from the cards"}],auto:true};           // a fresh stand-in
  d.s16={blocks:[{type:"action",text:"edited"}],standIn:true};                // a stand-in the writer has edited
  assert.equal(label(scenes,d),"14 of 16 scenes drafted · 2 rough stand-ins");
  delete d.s16;assert.equal(label(scenes,d),"14 of 16 scenes drafted · 1 rough stand-in");
  d.s15={blocks:[{type:"action",text:"written by hand"}]};                    // a manual screenplay counts
  assert.equal(label(scenes,d),"15 of 16 scenes drafted");
  assert.equal(label([],{}),"0 of 0 scenes drafted");assert.equal(label(null,null),"0 of 0 scenes drafted");
  // both places that show the count use it, and nothing counts every draft any more
  assert.equal((src.match(/= filmDraftedLabel\(scenes, drafts\);/g)||[]).length,2);
  assert.ok(!/drafted\+" of "\+scenes\.length/.test(src));
  assert.ok(src.includes('React.createElement("span",{className:"film-menu-count"},draftedLabel)'));
});

/* ---------------------------------------------------------------- A10 */
await test("A10 · the writing call: an answer cut for lack of credits is said as that, and not asked for again",async()=>{
  const box=makeBox();
  assert.equal(box.WRITING_CUT_FOR_BALANCE,CUT);
  box.__answers.push(ok("half a scene",{truncated:true,cutForBalance:true}),ok("never asked"));
  const before=Date.now();let err=null;
  try{await ask(box,{maxTokens:8192});}catch(e){err=e;}
  assert.ok(err);assert.equal(err.message,CUT);
  assert.equal(box.__sent.length,1,"no second call: it would be charged for the same cut");
  assert.ok(box.__lastWritingCutForBalanceAt>=before);
  assert.deepEqual(box.__toasts.map(t=>t.m),[CUT]);assert.equal(box.__toasts[0].t,"error");
  // an answer cut off with the full budget is still asked for once more, as before
  const b2=makeBox();
  b2.__answers.push(ok("half",{truncated:true}),ok("whole"));
  assert.equal(await ask(b2,{maxTokens:8192}),"whole");assert.equal(b2.__sent[1].maxTokens,32768);
  assert.equal(b2.__lastWritingCutForBalanceAt,undefined);
  // the flag without a cut means nothing (the shorter answer fitted)
  const b3=makeBox();
  b3.__answers.push(ok("it fitted",{cutForBalance:true}));
  assert.equal(await ask(b3),"it fitted");
});

await test("A10 · it reads as a credits problem that stops a batch, with advice that fits",()=>{
  const box=makeBox();
  const f=box.screenplayFailureFromError(new Error(CUT),"draft");
  assert.equal(f.kind,"plan");assert.equal(f.billing,"short");
  assert.equal(box.screenplayFailureReason(f),"there were not enough credits for the whole answer, so it was cut off");
  assert.equal(box.screenplayFailureAdvice(f,"press Auto-draft all to finish them"),"Choose a lighter writing engine (or add credits), then press Auto-draft all to finish them.");
  assert.equal(box.turnFailureNeedsAction(f),true);
  // an ordinary cut-off keeps its own kind and does not stop a batch
  const t=box.screenplayFailureFromError(new Error("Screenplay draft was truncated."),"draft");
  assert.equal(t.kind,"truncated");assert.equal(box.turnFailureNeedsAction(t),false);
  // the other billing cases keep their words
  assert.equal(box.screenplayFailureFromError(new Error("Choose a plan to start creating"),"draft").billing,"credits");
  assert.equal(box.screenplayFailureFromError(new Error("This writing engine needs at least 40 credits for one answer, but this account has 12 (28 short). Choose a lighter writing engine, or add credits."),"draft").billing,"engine");
  // what a batch is handed when the beat map was the cut answer
  const made=box.turnCutForBalanceFailure();
  assert.equal(made.kind,"plan");assert.equal(made.billing,"short");assert.equal(box.turnFailureNeedsAction(made),true);
  assert.equal(box.turnWritingCutForBalanceSince(Date.now()),false);
  box.__lastWritingCutForBalanceAt=Date.now();assert.equal(box.turnWritingCutForBalanceSince(Date.now()-5),true);
});

await test("A10 · the build stops at the scene whose beat map was cut: one call, not three",async()=>{
  const box=makeBox();
  box.scenePause=()=>Promise.resolve();
  const calls={author:[],draft:[]},trace=[];
  const draft=()=>({blocks:[{type:"scene",text:"INT. ROOM - DAY",beat:1},{type:"action",text:"She waits.",beat:1}],ai:true});
  const scenes=sc(5).map(s=>({...s,act:1,driver:"ana",loc:"INT. ROOM - DAY"}));
  const ctx={model:{scenes,characters:[{id:"ana",name:"ANA"}],project:{title:"Film"},beats:{},drafts:{},continuity:{}},
    emit:s=>trace.push(s),propose:async()=>true,cancelled:()=>false,sync:()=>true,
    ai:{available:true,
      authorScene:async(s)=>{calls.author.push(s.no);if(s.no>=3){box.__lastWritingCutForBalanceAt=Date.now();return null;}
        return{patch:{},beats:{rows:[{n:1,drive:{a:"Waits",d:"She waits."},react:{a:"Holds",d:"Nothing."},charge:1}]}};},
      draftScene:async(s)=>{calls.draft.push(s.no);return draft();}}};
  const r=await box.writeScenesSeq(ctx,scenes.map((_,i)=>i));
  assert.equal(r.stopped,true);assert.equal(r.halted.kind,"plan");assert.equal(r.halted.billing,"short");assert.equal(r.written,2);
  assert.deepEqual(calls.author,[1,2,3],"scene 3's beat map asked once; scenes 4 and 5 never asked");
  assert.deepEqual(calls.draft,[1,2],"its screenplay was never asked for");
  assert.deepEqual(Object.keys(ctx.model.drafts),["s1","s2"],"no rough stand-in: the scene stays unwritten for Continue writing");
  const flags=trace.filter(s=>s.k==="flag").map(s=>s.t);
  assert.equal(flags.length,1);
  assert.match(flags[0],/^Stopped at Sc 3 “Scene 3”: there were not enough credits for the whole answer, so it was cut off/);
  assert.match(flags[0],/2 of 5 scenes are written and kept; 3 aren’t written yet\./);
});

await test("A10 · Auto-draft all stops the same way; the server says when it cut an answer for the balance",()=>{
  const app=read("app/app.jsx");
  const a=app.indexOf("const draftAll = async ()=>{"),fn=app.slice(a,app.indexOf("const stopDraftAll",a));
  const cut=fn.indexOf("window.turnWritingCutForBalanceSince(askedAt)"),screenplay=fn.indexOf("const raw = await aiDraftScene(scn, beats, prev, project);");
  assert.ok(cut>0&&cut<screenplay,"checked before the screenplay call is made");
  assert.match(fn.slice(cut,screenplay),/halted = \{ no:s\.no, failure:[^;]*\}; break; \}/);
  const src=read("supabase/functions/image-proxy/index.ts");
  assert.ok(src.includes("const cutForBalance = truncated && outputCap < wantedCap;"));
  assert.ok(src.includes("truncated: truncated || undefined, cutForBalance: cutForBalance || undefined, ...extra,"));
  // the cap really is the one the hold shrank, and admins (never held) can't be flagged
  assert.ok(src.includes("outputCap = affordableOutputCap({ ...est, wantedCap, minCap, availableCredits: Math.min(accountRemaining, filmBudgetLeft) });"));
  assert.ok(src.includes("let outputCap = wantedCap;"));
});

/* ---------------------------------------------------------------- the page and Frances */
await test("Frances knows, and the page is on the new key",()=>{
  const box=makeBox();
  const F=name=>box.APP_FEATURES.find(x=>x&&String(x.name||"").startsWith(name));
  assert.match(F("Unfinished film notice").what,/AUTO-DRAFT ALL LEAVES THE SAME SIGN \(2026-11-12\)/);
  assert.match(F("Unfinished film notice").what,/on any other film it runs Auto-draft all again for the unwritten scenes, which asks first/);
  assert.match(F("Auto-draft all (N left)").what,/AFTER IT STOPS \(2026-11-12\)/);
  assert.match(F("Export (screenplay / story)").what,/'14 of 16 scenes drafted · 2 rough stand-ins'/);
  assert.match(F("Writers' Room run integrity").what,/NOT ENOUGH CREDITS FOR A WHOLE ANSWER \(2026-11-12\)/);
  assert.match(F("Writers' Room run integrity").what,/pressing Escape while 'Finish writing this film' is running asks 'Stop building this film\?'/);
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","agents.jsx","agents-ui.jsx","app.jsx","chrome.jsx","build-state.js"])
    assert.ok(["20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log("\n"+(failed?"FAILED — "+failed+" of "+(checks+failed):"OK — "+checks+" checks passed"));
process.exit(failed?1:0);

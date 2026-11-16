/* A WRITING CALL HAS A TIME LIMIT, AND TWO TIME-OUTS IN A ROW STOP A BUILD (owner 2026-11-11, Writers' Room audit
   A5 / A6). "Half Strength" sat about 22 minutes on one scene: the app waited for every stalled call with no limit of
   its own (the server's is 380 s), a scene makes up to four calls, and a time-out was an unnumbered service error
   that never stopped the build. This runs the REAL app code (ai.jsx's writing call, the scene drafter, the build in
   agents.jsx) and pins:
     1. the call: a scene's beat map / screenplay asks for 3 minutes and tells the server; the app stops waiting
        20 s after the limit when nothing comes back; every other call keeps the server's limit;
     2. a time-out is its own kind of failure, in plain words;
     3. the build: a scene that timed out is not asked again at once (one wait, not four); two scenes in a row stop
        the build with one message; a single slow scene is retried at the end;
     4. the server: timeoutMs can only shorten the provider limit, on all three providers;
     5. Frances's notes and the page.
   node scripts/test-writing-time-limit.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};
const settle=()=>new Promise(r=>setImmediate(r));

/* the real app files, with a clock the test turns by hand and a writing server the test answers for */
const makeBox=()=>{
  const timers=[];let id=0;
  const box={console:{...console,warn:noop,info:noop},
    setTimeout:(fn,ms)=>{const t={id:++id,fn,ms:Number(ms)||0,live:true};timers.push(t);return t.id;},
    clearTimeout:(i)=>{const t=timers.find(x=>x.id===i);if(t)t.live=false;},
    setInterval:()=>0,clearInterval:noop,
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
  box.__toasts=[];box.appToast=(m,t)=>box.__toasts.push({m:String(m),t});
  box.__sent=[];box.__answers=[];
  box.sbClient=()=>({functions:{invoke:(name,o)=>{box.__sent.push(o.body);const a=box.__answers.shift();
    return a===undefined?new Promise(()=>{}):Promise.resolve(a);}}});
  box.turnIsAdmin=false;
  return{box,timers,fire:(ms)=>{const t=timers.find(x=>x.live&&x.ms===ms);assert.ok(t,"a live timer of "+ms+" ms (live: "+timers.filter(x=>x.live).map(x=>x.ms).join(",")+")");t.live=false;t.fire=true;t.fn();},
    live:()=>timers.filter(x=>x.live).map(x=>x.ms)};
};
const ok=(text,extra)=>({data:{text,usage:{credits:1},...(extra||{})},error:null});
const ask=(box,o)=>box.claude.complete({messages:[{role:"user",content:"x"}],...(o||{})});

await test("the limits: 3 minutes for a scene call, the server's 380 s for every other, 20 s of grace",()=>{
  const{box}=makeBox();
  assert.deepEqual({...box.turnWritingLimits},{call:380000,scene:180000,grace:20000});
  const ai=read("app/ai.jsx");
  // exactly the three scene calls of a build carry the scene limit: the beat map, the screenplay, the beat-map repair
  const marked=ai.split("\n").filter(l=>l.includes("timeoutMs:(window.turnWritingLimits||{}).scene"));
  assert.equal(marked.length,3);
  for(const fn of ["aiDraftScene","aiAuthorScene","aiBeatsFromScript"]){
    const at=ai.indexOf("async function "+fn+"("),next=ai.indexOf("\nasync function ",at+20);
    assert.ok(ai.slice(at,next).includes("timeoutMs:(window.turnWritingLimits||{}).scene"),fn);
  }
});

await test("a scene call tells the server its limit; an ordinary call sends none; an answer in time clears the clock",async()=>{
  const{box,live}=makeBox();
  box.__answers.push(ok("hello"));
  assert.equal(await ask(box,{timeoutMs:180000}),"hello");
  assert.equal(box.__sent[0].timeoutMs,180000);
  assert.deepEqual(live(),[],"no clock left running");
  box.__answers.push(ok("again"));
  assert.equal(await ask(box),"again");
  assert.ok(!("timeoutMs" in box.__sent[1]),"the server's own limit: nothing sent");
  // a limit outside 20 s … 380 s is not a limit
  for(const bad of [5000,999999,"soon",-1]){box.__answers.push(ok("x"));await ask(box,{timeoutMs:bad});assert.ok(!("timeoutMs" in box.__sent[box.__sent.length-1]),String(bad));}
});

await test("no answer at all: the app stops waiting 20 s after the limit, says so plainly, and notes the moment",async()=>{
  const{box,fire,live}=makeBox();
  const p=ask(box,{timeoutMs:180000});let err=null;p.catch(e=>{err=e;});
  await settle();assert.deepEqual(live(),[200000]);assert.equal(err,null,"still waiting");
  const before=Date.now();fire(200000);await settle();
  assert.ok(err);assert.equal(err.message,"The writing engine didn't answer in time, so the app stopped waiting for it. Try again in a few minutes.");
  assert.ok(box.__lastWritingTimeoutAt>=before);
  assert.equal(box.__toasts[box.__toasts.length-1].m,err.message);
  // an ordinary call waits for the server's limit plus the same grace
  const q=ask(box);q.catch(noop);await settle();assert.deepEqual(live(),[400000]);
});

await test("the server's own \"took too long\" is noted too, and both read as a time-out in plain words",async()=>{
  const{box}=makeBox();
  box.__answers.push({data:{error:"The writing engine took too long to answer. Please try again — a shorter request finishes sooner."},error:null});
  const before=Date.now();let err=null;
  try{await ask(box,{timeoutMs:180000});}catch(e){err=e;}
  assert.ok(err&&/took too long to answer/.test(err.message));assert.ok(box.__lastWritingTimeoutAt>=before);
  for(const msg of [err.message,"The writing engine didn't answer in time, so the app stopped waiting for it. Try again in a few minutes."]){
    const f=box.screenplayFailureFromError(new Error(msg),"draft");
    assert.equal(f.kind,"timeout",msg);
    assert.equal(box.screenplayFailureReason(f),"the writing engine took too long to answer");
    assert.equal(box.screenplayFailureAdvice(f,"press Auto-draft all to finish them"),"Press Auto-draft all to finish them in a few minutes, or choose another writing engine first.");
  }
  // other failures keep their kinds
  assert.equal(box.screenplayFailureFromError(new Error("Couldn't reach the writing model: Failed to send a request to the Edge Function."),"draft").kind,"service");
  assert.equal(box.screenplayFailureFromError(new Error("Choose a plan to start creating"),"draft").kind,"plan");
  assert.equal(box.turnIsWritingTimeout(new Error("The writing model's reply was cut off")),false);
});

await test("a cut-off answer is asked for once more with twice the time",async()=>{
  const{box}=makeBox();
  box.__answers.push(ok("half",{truncated:true}),ok("whole"));
  assert.equal(await ask(box,{timeoutMs:180000,maxTokens:8192}),"whole");
  assert.equal(box.__sent[1].timeoutMs,360000);assert.equal(box.__sent[1].maxTokens,32768);
  box.__answers.push(ok("half",{truncated:true}),ok("whole"));
  await ask(box,{maxTokens:8192});
  assert.ok(!("timeoutMs" in box.__sent[3]),"an ordinary call's second try keeps the server's limit");
});

await test("the real scene drafter: an engine that takes too long leaves a rough stand-in that says why",async()=>{
  const{box}=makeBox();
  box.__answers.push({data:{error:"The writing engine took too long to answer. Please try again — a shorter request finishes sooner."},error:null});
  const scene={id:"s1",no:1,title:"A Knock",act:1,loc:"INT. FLAT - DAY",summary:"She knocks.",driver:"ana",openValue:"Hope",openCharge:1,closeValue:"Fear",closeCharge:-2};
  const beats={driverLabel:"ANA",reactorLabel:"BO",desire:"to get in",obstacle:"to keep her out",result:"she leaves",turnAt:1,rows:[{n:1,drive:{a:"Knocks",d:"Ana knocks."},react:{a:"Waits",d:"Bo waits."},charge:-2}]};
  const out=await box.aiDraftScene(scene,beats,null,{title:"F",format:"film"},[{id:"ana",name:"ANA"},{id:"bo",name:"BO"}],[scene]);
  assert.equal(box.__sent[0].timeoutMs,180000);
  assert.ok(out&&out.auto,"a rough stand-in");assert.equal(out.failure.kind,"timeout");
  assert.equal(box.standInWhy(out.failure,false),"the writing engine took too long to answer, so a rough structural draft stands in — open it and redraft in a few minutes");
  assert.equal(box.standInWhy(out.failure,true),"the writing engine again took too long to answer, so a rough structural draft stands in — open it and redraft in a few minutes");
});

/* ---- the build (agents.jsx), with a writing engine the test plays ---- */
const sc=n=>Array.from({length:n},(_,i)=>({id:"s"+(i+1),no:i+1,title:"Scene "+(i+1),summary:"Something happens "+(i+1),act:1,driver:"ana",loc:"INT. ROOM - DAY"}));
const draft=()=>({blocks:[{type:"scene",text:"INT. ROOM - DAY",beat:1},{type:"action",text:"She waits.",beat:1}],ai:true});
const beats=()=>({rows:[{n:1,drive:{a:"Waits",d:"She waits."},react:{a:"Holds",d:"Nothing answers."},charge:1}]});
const build=async(n,play)=>{
  const{box}=makeBox();
  box.scenePause=()=>Promise.resolve();   // the breathers between tries, not under test
  const calls={author:[],draft:[]},trace=[];
  const slow=()=>{box.__lastWritingTimeoutAt=Date.now();};   // what ai.jsx notes when a call runs past its limit
  const ctx={model:{scenes:sc(n),characters:[{id:"ana",name:"ANA"}],project:{title:"Film"},beats:{},drafts:{},continuity:{}},
    emit:s=>trace.push(s),propose:async()=>true,cancelled:()=>false,sync:()=>true,
    ai:{available:true,
      authorScene:async(s)=>{calls.author.push(s.no);const r=play.author?play.author(s.no,calls.author.filter(x=>x===s.no).length):"ok";
        if(r==="slow"){slow();return null;}if(r==="bad")return null;return{patch:{},beats:beats()};},
      draftScene:async(s)=>{calls.draft.push(s.no);const r=play.draft?play.draft(s.no,calls.draft.filter(x=>x===s.no).length):"ok";
        if(r==="slow"){slow();return{blocks:[{type:"action",text:"stand-in"}],auto:true,failure:{kind:"timeout",issues:[],technical:"took too long"}};}
        return draft();}}};
  const r=await box.writeScenesSeq(ctx,ctx.model.scenes.map((_,i)=>i));
  return{r,calls,trace,ctx,box};
};
const count=(a,no)=>a.filter(x=>x===no).length;

await test("two scenes in a row take too long: the build stops there, with one message — two waits, not eight",async()=>{
  const{r,calls,trace,ctx}=await build(6,{author:(no)=>no>=3?"slow":"ok"});
  assert.equal(r.stopped,true);assert.equal(r.halted.kind,"timeout");assert.equal(r.written,2);
  // scene 3 and scene 4 were each asked ONCE, never drafted blind; scenes 5 and 6 were never asked
  assert.deepEqual(calls.author,[1,2,3,4]);assert.deepEqual(calls.draft,[1,2]);
  const flags=trace.filter(s=>s.k==="flag").map(s=>s.t);
  assert.equal(flags.length,1);
  assert.equal(flags[0],"Stopped at Sc 4 “Scene 4”: the writing engine took too long to answer, for the second scene in a row, so the remaining scenes would most likely fail the same way. "
    +"2 of 6 scenes are written and kept; 4 aren’t written yet. Wait a few minutes, or choose another writing engine, then finish just the unwritten scenes: "
    +"press Run again, or later open Story Editors and choose Finish writing this film.");
  // nothing was written into the scenes that timed out: they stay unwritten for Continue writing
  assert.deepEqual(Object.keys(ctx.model.drafts),["s1","s2"]);
});

await test("one slow scene does not stop the build: it is passed over, then written by the build's own retry",async()=>{
  const{r,calls,trace}=await build(4,{author:(no,nth)=>(no===2&&nth===1)?"slow":"ok"});
  assert.equal(r.stopped,false);assert.equal(r.written,4);assert.equal(r.failures.length,0);
  assert.deepEqual(calls.author,[1,2,3,4,2],"scene 2 asked once, then again at the end");
  assert.ok(trace.some(s=>/Sc 2 .* came good on the retry/.test(s.t)));
  // two slow scenes that are NOT in a row do not stop it either
  const b=await build(5,{author:(no,nth)=>((no===2||no===4)&&nth===1)?"slow":"ok"});
  assert.equal(b.r.stopped,false);assert.equal(b.r.written,5);
});

await test("a screenplay that takes too long is not asked for again at once; two in a row stop the build",async()=>{
  const{r,calls,trace,ctx}=await build(5,{draft:(no)=>no>=2?"slow":"ok"});
  assert.equal(r.stopped,true);assert.equal(r.halted.kind,"timeout");
  assert.equal(count(calls.draft,2),1,"one wait for scene 2's screenplay, not two");assert.equal(count(calls.draft,3),1);
  assert.deepEqual(calls.draft,[1,2,3]);
  assert.ok(trace.some(s=>s.k==="flag"&&/^Stopped at Sc 3 .*took too long to answer, for the second scene in a row.*\(Sc 3 has a rough stand-in\)/.test(s.t)));
  assert.ok(!trace.some(s=>/didn't take — trying again/.test(s.t)));
  assert.ok(ctx.model.drafts.s2.auto&&ctx.model.drafts.s3.auto,"each keeps its rough stand-in");
});

await test("an unreadable answer is still asked for again (only a time-out is not), and the pairs that count",async()=>{
  const{r,calls}=await build(2,{author:(no,nth)=>(no===1&&nth===1)?"bad":"ok"});
  assert.equal(r.written,2);assert.deepEqual(calls.author,[1,1,2]);
  const{box}=makeBox(),T={kind:"timeout"},S=(ref)=>({kind:"service",ref});
  assert.equal(box.turnRepeatedServiceFailure(T,T),true);
  assert.equal(box.turnRepeatedServiceFailure(T,S("CM-14")),false);assert.equal(box.turnRepeatedServiceFailure(S("CM-14"),T),false);
  assert.equal(box.turnRepeatedServiceFailure(S("CM-13"),S("CM-13")),true);assert.equal(box.turnRepeatedServiceFailure(S("CM-13"),S("CM-14")),false);
  assert.equal(box.turnRepeatedServiceFailure(null,T),false);assert.equal(box.turnRepeatedServiceFailure(S(""),S("")),false);
  assert.equal(box.turnFailureNeedsAction(T),false,"a time-out can pass: one alone never stops a build");
});

await test("the server: timeoutMs can only shorten the provider limit, on all three providers",()=>{
  const src=read("supabase/functions/image-proxy/index.ts");
  assert.match(src,/const TEXT_PROVIDER_TIMEOUT_MS = 380000;/);
  const at=src.indexOf("const TEXT_PROVIDER_TIMEOUT_MIN_MS"),end=src.indexOf("};",at)+2;
  const js=src.slice(at,end).replace("(asked: unknown): number","(asked)");
  const fn=vm.runInNewContext("const TEXT_PROVIDER_TIMEOUT_MS = 380000;\n"+js+"\ntextTimeoutFor");
  assert.equal(fn(180000),180000);assert.equal(fn(20000),20000);assert.equal(fn("60000"),60000);
  for(const full of [undefined,null,"",0,19999,380000,999999,-5,"soon",NaN]) assert.equal(fn(full),380000,String(full));
  assert.equal((src.match(/signal: AbortSignal\.timeout\(textTimeoutMs\)/g)||[]).length,3,"Anthropic, OpenAI and Google");
  assert.ok(!/AbortSignal\.timeout\(TEXT_PROVIDER_TIMEOUT_MS\)/.test(src));
  assert.ok(src.includes("const textTimeoutMs = textTimeoutFor(body.timeoutMs);"));
  // the same sentence the app reads as a time-out, on the path that releases the hold
  assert.ok(src.includes('"The writing engine took too long to answer. Please try again — a shorter request finishes sooner."'));
});

await test("Frances knows, and the page is on the new key",()=>{
  const{box}=makeBox();
  const f=(box.APP_FEATURES||[]).find(x=>x&&String(x.name||"").startsWith("Writers' Room run integrity"));
  assert.ok(f);
  for(const s of ["A WRITING CALL HAS A TIME LIMIT: one scene's beat map or screenplay is given 3 minutes","the credits held for it are given back",
    "TWO IN A ROW STOP THE BUILD","Continue writing finishes the rest","Auto-draft all stops the same way"]) assert.ok(f.what.includes(s),s);
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","agents.jsx"])
    assert.ok(["20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log(`\n${checks} checks passed${failed?`, ${failed} FAILED`:""}`);
process.exit(failed?1:0);

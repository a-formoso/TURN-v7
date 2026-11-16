/* LONG STORIES KEEP THEIR ENDING (owner 2026-11-12, Writers' Room audit B7 to B10, B13). Runs the REAL app code
   (ai.jsx's scene-list and story-world builders, the build in agents.jsx) with a writing engine the test plays:
     B7  the brief is read up to 12,000 characters (it was 4,000, silently), in every step that reads it, and a
         longer text is said to be cut;
     B8  the story world is written looking at every scene, numbered;
     B9  every person who drives a scene gets a cast entry;
     B10 a scene list that comes back long loses scenes at the midpoint, never the ending; the order of the scenes
         is never changed by an act label;
     B13 no credits / signed out at the scene list or the world stops at once with the real reason, and at the
         world step nothing is made.
   node scripts/test-long-films.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};

const makeBox=()=>{
  const box={console:{...console,warn:noop,info:noop},setTimeout:(f)=>{f();return 0;},clearTimeout:noop,setInterval:()=>0,clearInterval:noop,
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
  for(const f of ["app/story-names.js","app/character-identity.js","app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx","app/build-state.js","app/agents.jsx"])
    vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
  box.__toasts=[];box.appToast=(m,t)=>box.__toasts.push({m:String(m),t});
  box.aiAvailable=()=>true;box.turnIsAdmin=false;
  // the writing engine: the test answers each prompt (a string, or a thrown Error)
  box.__prompts=[];box.__play=()=>"{}";
  box.claude={complete:async(o)=>{const p=o.messages[0].content;box.__prompts.push(p);const r=box.__play(p,box.__prompts.length);if(r instanceof Error)throw r;return r;}};
  return box;
};
const scene=(i,act,extra)=>({a:act,t:"Scene "+i,l:"INT. ROOM "+i+" - DAY",s:"event number "+i+" happens",d:"ana",vp:"Hope",vn:"Fear",oc:-1,cc:2,cl:2,...(extra||{})});
const half=(from,n,actOf,title)=>JSON.stringify({...(title?{title}:{}),scenes:Array.from({length:n},(_,k)=>scene(from+k,actOf(from+k)))});
const isFirst=p=>!p.includes("THE FIRST HALF IS ALREADY WRITTEN");
const NO_CREDITS="Choose a plan to start creating — every generation runs on your plan's credits.";

/* ---------------------------------------------------------------- B7 */
await test("B7 · the limit is 12,000 characters, one number for every step that reads the brief",()=>{
  const box=makeBox(),ai=read("app/ai.jsx");
  assert.equal(box.STORY_BRIEF_MAX,12000);
  // no step reads the brief through the old 4,000 cut any more
  assert.ok(!/clipAtBoundary\(String\(brief(\|\|"")?\), 4000\)/.test(ai));
  assert.equal((ai.match(/clipAtBoundary\(String\(brief(?:\|\|"")?\), \(typeof window!=="undefined" && window\.STORY_BRIEF_MAX\) \|\| 12000\)/g)||[]).length,3,"scene list, world, contract");
  assert.ok(ai.includes("return clipAtBoundary(b, (typeof window!==\"undefined\" && window.STORY_BRIEF_MAX) || 12000);"),"the composed brief");
  const short=box.storyBriefRead("  A short logline.  ");
  assert.deepEqual({...short},{read:"A short logline.",cut:false,length:16,max:12000});
  const long=box.storyBriefRead("Sentence one is here. ".repeat(700));
  assert.equal(long.cut,true);assert.ok(long.read.length<=12000&&long.read.length>11900);assert.ok(/\.$/.test(long.read),"cut at a sentence end");
});

await test("B7 · a feature's synopsis with its research keeps its last paragraph and its world notes",()=>{
  const box=makeBox();
  const para=(label,n)=>({key:label.toLowerCase(),label,text:Array.from({length:5},(_,i)=>label+" sentence "+(i+1)+" of paragraph "+n+", long enough to be a real line of synopsis with a clause or two in it.").join(" ")});
  const synopsis={title:"The Long Road",synopsis:{paras:["Setup","Rising","Midpoint","Crisis","Climax","Resolution"].map((l,i)=>para(l,i+1))},
    research:{fact:{world:"A fishing port in 1974: "+"the cannery sets the town's hours. ".repeat(12),role:"A net-mender: "+"she works the loft above the ice house. ".repeat(8)}}};
  const brief=box.composeStoryBrief("A net-mender must choose between her brother and the boat that feeds the town.",synopsis);
  assert.ok(brief.length>4000,"this brief is "+brief.length+" characters — it used to be cut at 4,000");
  assert.ok(brief.includes("Resolution sentence 5 of paragraph 6"),"the ending is in it");
  assert.ok(brief.includes("Protagonist's role: A net-mender")&&brief.trim().endsWith("she works the loft above the ice house."),"and the world notes, to the last word");
});

await test("B7 · the scene list, the world and the contract are all given the whole brief",async()=>{
  const box=makeBox();
  const brief="LOGLINE: A net-mender chooses.\n\nSYNOPSIS:\n"+Array.from({length:60},(_,i)=>"Paragraph line "+(i+1)+" tells a further part of what happens in the story, in order.").join("\n")+"\nTHE LAST LINE: she burns the nets.";
  assert.ok(brief.length>4000&&brief.length<12000);
  box.__play=(p)=>isFirst(p)?half(1,8,i=>i<=4?1:2,"Nets"):half(9,8,i=>i<=12?2:3);
  const spine=await box.aiBuildSpine(brief,"film","threeact");
  assert.equal(spine.scenes.length,16);
  for(const p of box.__prompts) assert.ok(p.includes("THE LAST LINE: she burns the nets."),"a scene-list call lost the end of the brief");
  box.__prompts.length=0;
  box.__play=()=>JSON.stringify({premise:"What if?",cast:[{id:"ana",name:"ANA REIS",role:"Protagonist — a net-mender",pronouns:"she/her"}]});
  await box.aiBuildStoryWorld(brief,spine,"film",null);
  assert.ok(box.__prompts[0].includes("THE LAST LINE: she burns the nets."),"the world call lost the end of the brief");
  box.__prompts.length=0;box.__play=()=>"{}";
  await box.aiSuggestContract(brief,{title:"Nets",format:"film"});
  assert.ok(box.__prompts.length>=1&&box.__prompts[0].includes("THE LAST LINE: she burns the nets."),"the contract call lost the end of the brief");
});

/* ---------------------------------------------------------------- B10 */
await test("B10 · too many scenes: the surplus comes out at the midpoint, the opening and the ending are whole",()=>{
  const box=makeBox();
  const A=n=>Array.from({length:n},(_,i)=>({title:"A"+(i+1)})),B=n=>Array.from({length:n},(_,i)=>({title:"B"+(i+1)}));
  const titles=r=>r.scenes.map(s=>s.title).join(" ");
  // the second half is long: its first scenes go, its last ones stay
  let r=box.joinSpineHalves(A(8),B(10),16,8);
  assert.equal(r.dropped,2);assert.equal(titles(r),"A1 A2 A3 A4 A5 A6 A7 A8 B3 B4 B5 B6 B7 B8 B9 B10");
  // the first half is long: its last scenes go
  r=box.joinSpineHalves(A(10),B(8),16,8);
  assert.equal(r.dropped,2);assert.equal(titles(r),"A1 A2 A3 A4 A5 A6 A7 A8 B1 B2 B3 B4 B5 B6 B7 B8");
  // both long
  r=box.joinSpineHalves(A(9),B(11),16,8);
  assert.equal(r.dropped,4);assert.equal(r.scenes.length,16);assert.equal(r.scenes[0].title,"A1");assert.equal(r.scenes[15].title,"B11");assert.equal(r.scenes[8].title,"B4");
  // one short, one long: the long one fills the gap before anything is dropped
  r=box.joinSpineHalves(A(6),B(10),16,8);assert.equal(r.dropped,0);assert.equal(r.scenes.length,16);
  r=box.joinSpineHalves(A(6),B(12),16,8);assert.equal(r.dropped,2);assert.equal(r.scenes[6].title,"B3");assert.equal(r.scenes[15].title,"B12");
  // nothing over: nothing touched
  r=box.joinSpineHalves(A(8),B(8),16,8);assert.equal(r.dropped,0);assert.equal(r.scenes.length,16);
  r=box.joinSpineHalves(A(5),B(4),16,8);assert.equal(r.dropped,0);assert.equal(r.scenes.length,9);
  // the declared Inciting Incident is never the scene that goes
  const withIncite=A(10);withIncite[9].kind="incite";
  r=box.joinSpineHalves(withIncite,B(8),16,8);
  assert.equal(r.dropped,2);assert.ok(r.scenes.some(s=>s.kind==="incite"));assert.equal(r.scenes.length,16);assert.equal(r.scenes[15].title,"B8");
});

await test("B10 · the order of the scenes is the story's order: acts are repaired as labels",()=>{
  const box=makeBox();
  const acts=list=>box.repairActOrder(list.map((a,i)=>(a===0?{title:"S"+(i+1),act:1,_noAct:true}:{title:"S"+(i+1),act:a})));
  const read=list=>({acts:list.map(s=>s.act).join(""),order:list.map(s=>s.title).join(" ")});
  const inOrder=n=>Array.from({length:n},(_,i)=>"S"+(i+1)).join(" ");
  // already in step: untouched
  assert.deepEqual(read(acts([1,1,2,2,2,2,3,3])),{acts:"11222233",order:inOrder(8)});
  // one scene tagged with the wrong act stays where it is; only its label changes
  assert.deepEqual(read(acts([1,1,2,2,3,1,3,3])),{acts:"11222233",order:inOrder(8)});
  assert.deepEqual(read(acts([1,1,2,3,2,2,3,3])),{acts:"11222233",order:inOrder(8)});
  // a scene with no act takes its neighbour's — it is not act 1, and it does not move to the front
  assert.deepEqual(read(acts([1,1,2,2,0,2,3,0])),{acts:"11222233",order:inOrder(8)});
  assert.deepEqual(read(acts([0,0,2,2,3])),{acts:"22223",order:inOrder(5)});
  assert.deepEqual(read(acts([0,0,0])),{acts:"111",order:inOrder(3)});
  // four movements work the same way, and the marker never reaches a saved scene
  const k=acts([1,2,2,0,4,3,4,4]);
  assert.equal(k.map(s=>s.act).join(""),"12224444");assert.equal(k.map(s=>s.title).join(" "),inOrder(8));
  for(let i=1;i<k.length;i++) assert.ok(k[i].act>=k[i-1].act);
  assert.ok(k.every(s=>!("_noAct" in s)));
  // the old sort is gone from the builder
  assert.ok(!/scenes\.sort\(\(x,y\)=> x\.act - y\.act\)/.test(readFileSync(new URL("../app/ai.jsx",import.meta.url),"utf8")));
});

await test("B10 · the real builder: a long second half keeps its climax; a missing act does not move a scene",async()=>{
  const box=makeBox();
  // the second half comes back with 10 scenes for 8, and its 3rd scene has no act at all
  box.__play=(p)=>isFirst(p)?half(1,8,i=>i<=4?1:2,"The Cold Seam")
    :JSON.stringify({scenes:Array.from({length:10},(_,k)=>{const i=9+k;const s=scene(i,i<=14?2:3);if(k===2)delete s.a;return s;})});
  const spine=await box.aiBuildSpine("LOGLINE: a welder retraces a route.","film","threeact");
  assert.equal(spine.scenes.length,16);
  const titles=spine.scenes.map(s=>s.title);
  assert.deepEqual(Array.from(titles.slice(0,8)),["Scene 1","Scene 2","Scene 3","Scene 4","Scene 5","Scene 6","Scene 7","Scene 8"]);
  assert.deepEqual(Array.from(titles.slice(8)),["Scene 11","Scene 12","Scene 13","Scene 14","Scene 15","Scene 16","Scene 17","Scene 18"],"the last scenes are the model's last scenes");
  assert.equal(spine.scenes[8].act,2,"the scene with no act sits in act II where it was written, not at the front as act I");
  for(let i=1;i<16;i++) assert.ok(spine.scenes[i].act>=spine.scenes[i-1].act);
  assert.ok(spine.scenes.every(s=>!("_noAct" in s)));
  assert.deepEqual({...spine.trimmed},{dropped:2,note:"The scene list came back with 2 more scenes than the 16 this format aims for; those were taken out around the midpoint, so the opening and the ending are whole."});
  assert.equal(spine.short,undefined);
  // an exact list says nothing
  box.__play=(p)=>isFirst(p)?half(1,8,i=>i<=4?1:2,"T"):half(9,8,i=>i<=12?2:3);
  const exact=await box.aiBuildSpine("LOGLINE","film","threeact");
  assert.equal(exact.trimmed,undefined);assert.equal(exact.scenes.length,16);
});

/* ---------------------------------------------------------------- B8, B9 */
const bigSpine=(n,drivers)=>({title:"The Long Road",scenes:Array.from({length:n},(_,i)=>({act:i<n/4?1:i<3*n/4?2:3,title:"Scene "+(i+1),loc:"INT. ROOM - DAY",
  summary:"In scene "+(i+1)+" "+drivers[i%drivers.length]+" does the thing that only happens in scene "+(i+1)+" and it costs them something they wanted to keep for good",
  driver:drivers[i%drivers.length],openCharge:-1,closeCharge:2}))});

await test("B8 · the story world is written looking at every scene of a 40-scene film, numbered",async()=>{
  const box=makeBox();
  const spine=bigSpine(40,["ana","bo","cy"]);
  box.__play=()=>JSON.stringify({premise:"What if?",cast:[]});
  await box.aiBuildStoryWorld("LOGLINE: x",spine,"feature",null);
  const p=box.__prompts[0];
  assert.ok(p.includes("SCENES (all 40, in order, with summaries"));
  const list=p.slice(p.indexOf("SCENES (all 40"),p.indexOf("Driver ids used across scenes"));
  for(let i=1;i<=40;i++) assert.ok(new RegExp("\\nSc"+i+" Scene "+i+" \\(driver: ").test(list),"scene "+i+" is missing or has no number");
  assert.ok(list.includes("only happens in scene 40"),"the last scene's own event is there");
  assert.ok(list.length>2600,"the list is "+list.length+" characters — it used to stop at 2,600");
  // a short film's list is unchanged in shape, and scenes that already have numbers keep them
  box.__prompts.length=0;
  const small=bigSpine(4,["ana"]);small.scenes.forEach((s,i)=>{s.no=i+11;});
  await box.aiBuildStoryWorld("LOGLINE: x",small,"commercial",null);
  assert.ok(box.__prompts[0].includes("\nSc11 Scene 1 (driver: ana)")&&box.__prompts[0].includes("\nSc14 Scene 4 (driver: ana)"));
  // a very long list shortens each summary to share the room; no scene is dropped
  box.__prompts.length=0;
  await box.aiBuildStoryWorld("LOGLINE: x",bigSpine(90,["ana","bo"]),"feature",null);
  const l2=box.__prompts[0].slice(box.__prompts[0].indexOf("SCENES (all 90"),box.__prompts[0].indexOf("Driver ids used across scenes"));
  assert.equal((l2.match(/\nSc\d+ Scene \d+ \(driver: /g)||[]).length,90);assert.ok(l2.length<16000);
});

await test("B9 · every person who drives a scene gets a cast entry — ten drivers, ten identities",async()=>{
  const box=makeBox();
  const drivers=["ana","bo","cy","dee","eli","fay","gus","hal","ivy","jon"];
  const spine=bigSpine(40,drivers);
  const entry=(id,i)=>({id,name:id.toUpperCase()+" FAMILY"+i,role:"Ally — person number "+(i+1),pronouns:i%2?"he/him":"she/her",age:"30s",size:"170 cm tall",voice:{accent:"neutral",pitch:"low",pace:"even",quirks:""}});
  box.__play=()=>JSON.stringify({premise:"What if?",cast:[...drivers.map(entry),entry("kit",10),entry("lou",11),entry("mo",12)]});
  const world=await box.aiBuildStoryWorld("LOGLINE: x",spine,"feature",null);
  const p=box.__prompts[0];
  assert.ok(p.includes("cast: the PRINCIPAL characters — one for EVERY driver id above (all 10 of them; none may be left out), plus at most two essential others. For each: id"));
  assert.ok(!p.includes("cast: 3-6 PRINCIPAL"));
  assert.equal(world.cast.length,12,"ten drivers and two others (it used to stop at eight)");
  for(const d of drivers){const c=world.cast.find(x=>x.id===d);assert.ok(c&&c.pronouns&&c.ageRange&&c.voice,d+" has no full entry");}
  // a small cast is asked for as before
  box.__prompts.length=0;
  await box.aiBuildStoryWorld("LOGLINE: x",bigSpine(8,["ana","bo","cy"]),"short",null);
  assert.ok(box.__prompts[0].includes("cast: the PRINCIPAL characters — 3-6. For each: id"));
  // and the room is never below eight, never above twenty-four
  box.__play=()=>JSON.stringify({premise:"q",cast:Array.from({length:40},(_,i)=>entry("p"+String.fromCharCode(97+(i%26))+String.fromCharCode(97+Math.floor(i/26)),i))});
  assert.equal((await box.aiBuildStoryWorld("LOGLINE: x",bigSpine(8,["ana"]),"short",null)).cast.length,8);
  assert.equal((await box.aiBuildStoryWorld("LOGLINE: x",bigSpine(60,Array.from({length:30},(_,i)=>"d"+String.fromCharCode(97+i%26)+(i>25?"x":""))),"feature",null)).cast.length,24);
});

/* ---------------------------------------------------------------- B13 */
await test("B13 · no credits while the scene list is built: one call, the real reason, the right advice",async()=>{
  const box=makeBox();
  box.__play=()=>new Error(NO_CREDITS);
  const spine=await box.aiBuildSpine("LOGLINE: x","film","threeact");
  assert.equal(spine,null);
  assert.equal(box.__prompts.length,1,"not asked a second time");
  assert.equal(box.__lastSpineFailure,"The scene list wasn’t built: your account has no plan credits left for writing. Choose a plan or add credits, then run it again.");
  // signed out reads as that
  const b2=makeBox();b2.__play=()=>new Error("Sign in to use the writing engine.");
  assert.equal(await b2.aiBuildSpine("LOGLINE: x","film","threeact"),null);
  assert.equal(b2.__prompts.length,1);
  assert.equal(b2.__lastSpineFailure,"The scene list wasn’t built: you’re signed out of the writing service. Sign in, then run it again.");
  // the second half failing that way stops too, without a second try
  const b3=makeBox();b3.__play=(p)=>isFirst(p)?half(1,8,i=>i<=4?1:2,"T"):new Error(NO_CREDITS);
  assert.equal(await b3.aiBuildSpine("LOGLINE: x","film","threeact"),null);
  assert.equal(b3.__prompts.length,2);assert.match(b3.__lastSpineFailure,/^The scene list wasn’t built: your account has no plan credits left/);
});

await test("B13 · a passing fault is still asked for once more, and an old failure never stops a new build",async()=>{
  const box=makeBox();
  let n=0;
  box.__play=(p)=>{n++;if(n===1)return new Error("Couldn't reach the writing model: Failed to send a request to the Edge Function.");return isFirst(p)?half(1,8,i=>i<=4?1:2,"T"):half(9,8,i=>i<=12?2:3);};
  const spine=await box.aiBuildSpine("LOGLINE: x","film","threeact");
  assert.ok(spine&&spine.scenes.length===16);assert.equal(box.__prompts.length,3,"first half asked twice, second once");
  // an unreadable answer twice keeps its own message
  const b2=makeBox();b2.__play=()=>"not json at all";
  assert.equal(await b2.aiBuildSpine("LOGLINE: x","film","threeact"),null);
  assert.equal(b2.__prompts.length,2);
  assert.equal(b2.__lastSpineFailure,"The opening half of the spine (the film's setup and title) didn't come back after two tries, so nothing was built. Run it again in a moment.");
  // a billing failure noted by an EARLIER run does not stop this one
  const b3=makeBox();
  b3.__lastBuildFailure={at:Date.now()-60000,where:"spine",failure:{kind:"plan",billing:"credits"}};
  b3.__play=(p)=>p.includes("never comes back")?"x":(isFirst(p)?"not json":half(9,8,i=>3));
  assert.equal(await b3.aiBuildSpine("LOGLINE: x","film","threeact"),null);
  assert.equal(b3.__prompts.length,2);assert.match(b3.__lastSpineFailure,/didn't come back after two tries/);
});

await test("B13 · the story world: no credits is not asked again; a passing fault is",async()=>{
  const box=makeBox();
  const spine=bigSpine(8,["ana"]);
  box.__play=()=>new Error(NO_CREDITS);
  const t=Date.now();
  assert.equal(await box.aiBuildStoryWorld("LOGLINE: x",spine,"short",null),null);
  assert.equal(box.__prompts.length,1);
  const f=box.turnBuildFailureNeedingAction(t);
  assert.ok(f&&f.kind==="plan");
  assert.equal(box.turnBuildFailureSentence(f,"run it again"),"your account has no plan credits left for writing. Choose a plan or add credits, then run it again.");
  const b2=makeBox();let n=0;
  b2.__play=()=>{n++;return n===1?new Error("The writing service returned an error (500). Please try again."):JSON.stringify({premise:"What if?",cast:[]});};
  const w=await b2.aiBuildStoryWorld("LOGLINE: x",spine,"short",null);
  assert.equal(b2.__prompts.length,2);assert.equal(w.premise,"What if?");
  assert.equal(b2.turnBuildFailureNeedingAction(0),null,"an ordinary service error is not one that needs the writer to act");
});

/* the build itself (agents.jsx agentAdaptation), with the steps played */
const runBuild=async(play,opts)=>{
  const box=makeBox();
  const trace=[],cards=[];
  const o=opts||{};
  const had=o.existing?{scenes:[{id:"old1",no:1,title:"Old scene",act:1,driver:"ana"}],drafts:{old1:{blocks:[{type:"action",text:"kept"}],ai:true}},beats:{old1:{rows:[{n:1}]}}}:{scenes:[],drafts:{},beats:{}};
  const ctx={input:o.brief||"LOGLINE: a welder retraces a route.",project:{title:"Before",format:"film"},
    model:{scenes:had.scenes,characters:[],project:{title:"Before",format:"film"},beats:had.beats,drafts:had.drafts,continuity:{}},
    emit:s=>trace.push(s),propose:async(c)=>{cards.push(c);return true;},cancelled:()=>false,sync:()=>true,
    ai:{available:true,
      buildSpine:async(b)=>play.spine?play.spine(b):box.aiBuildSpine(b,"film","threeact"),
      buildStoryWorld:async(b,sp)=>play.world(b,sp,box),
      authorScene:async()=>{throw new Error("the scenes must never be reached");},draftScene:async()=>{throw new Error("the scenes must never be reached");}}};
  const run=box.AGENTS.find(a=>a.id==="adapt").run;
  let err=null;try{await run(ctx);}catch(e){err=e;}
  return{box,trace,cards,ctx,err};
};
const okSpine=()=>({title:"The Cold Seam",scenes:Array.from({length:16},(_,i)=>({act:i<4?1:i<12?2:3,title:"Scene "+(i+1),loc:"INT. ROOM - DAY",summary:"event "+(i+1),driver:"ana",openValue:"Hope",openCharge:-1,closeValue:"Fear",closeCharge:2}))});

await test("B13 · the build: no credits at the world step stops before anything is made, and says why",async()=>{
  const noCredits=(b,sp,box)=>{box.__lastBuildFailure={at:Date.now(),where:"world",failure:box.screenplayFailureFromError(new Error(NO_CREDITS),"world")};return null;};
  // a new film: nothing is saved
  const a=await runBuild({spine:okSpine,world:noCredits});
  assert.equal(a.err,null,String(a.err&&a.err.stack));
  assert.equal(a.cards.length,1,"only the scene list was approved");
  assert.deepEqual(a.ctx.model.scenes,[]);
  const flags=a.trace.filter(s=>s.k==="flag").map(s=>s.t);
  assert.deepEqual(flags,["Stopped before anything was made: the story world couldn’t be built — your account has no plan credits left for writing. Choose a plan or add credits, then run it again. No scenes were saved; the scene list above was not kept, so the next run builds it again."]);
  assert.equal(a.trace[a.trace.length-1].t,"Nothing was built.");
  // an existing project is not cleared for a build that cannot go on
  const b=await runBuild({spine:okSpine,world:noCredits},{existing:true});
  assert.equal(b.err,null,String(b.err&&b.err.stack));
  assert.equal(b.ctx.model.scenes.length,1);assert.equal(b.ctx.model.scenes[0].id,"old1");assert.ok(b.ctx.model.drafts.old1);
  assert.equal(b.ctx.model.project.title,"Before");
  assert.match(b.trace.filter(s=>s.k==="flag").map(s=>s.t).join(" | "),/Your current project is unchanged; the scene list above was not kept/);
});

await test("B13 · the build: the scene list failing for credits says the real reason; B7 and B10 are said in the log",async()=>{
  // the real aiBuildSpine with an engine that refuses for credits
  const a=await runBuild({world:()=>null});
  // (the engine in this box answers "{}" — make it refuse)
  const box=makeBox();box.__play=()=>new Error(NO_CREDITS);
  const trace=[];
  const ctx={input:"LOGLINE: x",project:{format:"film"},model:{scenes:[],characters:[],project:{format:"film"},beats:{},drafts:{},continuity:{}},
    emit:s=>trace.push(s),propose:async()=>true,cancelled:()=>false,sync:()=>true,
    ai:{available:true,buildSpine:(b)=>box.aiBuildSpine(b,"film","threeact"),buildStoryWorld:async()=>null}};
  await box.AGENTS.find(x=>x.id==="adapt").run(ctx);
  assert.equal(box.__prompts.length,1);
  assert.ok(trace.some(s=>s.k==="flag"&&s.t==="The scene list wasn’t built: your account has no plan credits left for writing. Choose a plan or add credits, then run it again."));
  assert.ok(!trace.some(s=>/didn't come back after two tries/.test(s.t)));
  assert.ok(a.trace.length>0);
  // a text longer than a build reads says so, with where it stops
  const longText="LOGLINE: a welder retraces a route.\n\n"+"The convoy leaves at dawn and the road is long. ".repeat(300)+"THE END: she lays the last weld.";
  const c=await runBuild({spine:okSpine,world:(b,sp,bx)=>{bx.__lastBuildFailure={at:Date.now(),where:"world",failure:{kind:"plan",billing:"credits"}};return null;}},{brief:longText});
  const said=c.trace.find(s=>s.k==="flag"&&/^Your text is /.test(s.t));
  assert.ok(said,"nothing was said about the cut");
  assert.match(said.t,/^Your text is 14,[0-9]{3} characters long; a build reads the first 12,000\. The story is being built from that part only — it stops reading at “….*the road is long\.”\. If the ending comes after that, decline the scene list below, shorten the text and run it again\.$/);
  assert.equal(c.trace.indexOf(said)<c.trace.findIndex(s=>s.k==="plan"),true,"said before the build starts");
  // a text that fits says nothing
  assert.ok(!a.trace.some(s=>/^Your text is /.test(s.t)));
  // a list that came back long is said on the way to the approval card
  const d=await runBuild({spine:()=>({...okSpine(),trimmed:{dropped:2,note:"The scene list came back with 2 more scenes than the 16 this format aims for; those were taken out around the midpoint, so the opening and the ending are whole."}}),
    world:(b,sp,bx)=>{bx.__lastBuildFailure={at:Date.now(),where:"world",failure:{kind:"signin"}};return null;}});
  assert.ok(d.trace.some(s=>s.k==="observe"&&/^The scene list came back with 2 more scenes/.test(s.t)));
  assert.match(d.trace.filter(s=>s.k==="flag").map(s=>s.t).join(" | "),/you’re signed out of the writing service\. Sign in, then run it again\./);
});

await test("a long setting line is cut at a word, never inside one",async()=>{
  const box=makeBox();
  box.__play=()=>JSON.stringify({premise:"What if?",cast:[],setting:{period:"present day, late autumn",duration:"three weeks of nights",
    location:"a three-ferry company's night dispatch hut, pontoon and lock basin on a tidal east-Scottish river",conflict:"institutional and personal"}});
  const w=await box.aiBuildStoryWorld("LOGLINE: x",bigSpine(8,["ana"]),"short",null);
  assert.equal(w.setting.location,"a three-ferry company's night dispatch hut, pontoon and lock basin on a tidal\u2026");
  assert.equal(w.setting.period,"present day, late autumn");assert.equal(w.setting.conflict,"institutional and personal");
});

await test("an ordinary world failure still carries on, as before (owner 2026-09-28)",async()=>{
  const ag=read("app/agents.jsx");
  assert.ok(ag.includes("Couldn't build the story world this time, so this film has no new premise"));
  const stop=ag.indexOf("NO CREDITS, OR SIGNED OUT, AT THE WORLD STEP"),carry=ag.indexOf("Couldn't build the story world this time"),made=ag.indexOf("ctx.model.scenes = newScenes;");
  assert.ok(stop>0&&stop<carry&&carry<made,"the stop comes before the film is made");
  assert.ok(ag.includes("const wf = (!world && typeof window.turnBuildFailureNeedingAction===\"function\") ? window.turnBuildFailureNeedingAction(_worldAt) : null;"));
});

await test("Frances knows, and the page is on the new key",()=>{
  const box=makeBox();
  const f=box.APP_FEATURES.find(x=>x&&String(x.name||"").startsWith("Long stories: what a build reads and keeps"));
  assert.ok(f);
  for(const part of ["reads up to 12,000 characters","THE ENDING IS NEVER WHAT GETS CUT","THE ORDER OF THE SCENES IS THE STORY'S ORDER","THE WORLD AND CAST SEE THE WHOLE FILM",
    "EVERY PERSON WHO DRIVES A SCENE GETS A FULL CAST ENTRY","NO CREDITS OR SIGNED OUT WHILE THE SCENE LIST OR THE WORLD IS BUILT"]) assert.ok(f.what.includes(part),part);
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","agents.jsx"])
    assert.ok(["20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log("\n"+(failed?"FAILED — "+failed+" of "+(checks+failed):"OK — "+checks+" checks passed"));
process.exit(failed?1:0);

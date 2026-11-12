/* AN EPISODE IS PLANNED WITH ITS SHOW'S PEOPLE; A CUT-OFF PLAN IS KNOWN AS ONE (owner 2026-11-12, Writers' Room
   audit B12 and B14). Runs the REAL app code (ai.jsx's planning and build calls, the build in agents.jsx, the Show's
   cast merge in series.js) with a writing engine the test plays:
     B12 the Show's cast reaches every call that can name someone — loglines, the typed interview, research, the
         synopsis (and its repair), the scene list (both halves), the story world — worded for each; a film that is
         not an episode gets none; the build says it, and an episode that uses the Show's people ends with the Show's
         people, not copies;
     B14 a cut-off scene-list half is asked for again; a cut-off story world is asked for once more and the fuller
         answer kept (and said when both were cut); a synopsis paragraph that stops mid-sentence is written again.
   node scripts/test-episode-show-cast.mjs */
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
  for(const f of ["app/story-names.js","app/character-identity.js","app/series.js","app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx","app/build-state.js","app/agents.jsx"])
    vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
  box.appToast=noop;box.aiAvailable=()=>true;box.turnIsAdmin=false;
  // the writing engine: the test answers each prompt, and may say the answer was cut off
  box.__prompts=[];box.__play=()=>"{}";
  box.claude={complete:async(o)=>{const p=(o.system?o.system+"\n":"")+o.messages.map(m=>m.content).join("\n");box.__prompts.push(p);
    let r=box.__play(p,box.__prompts.length);if(r instanceof Error)throw r;
    box.__lastWritingTruncated=false;if(r&&typeof r==="object"){box.__lastWritingTruncated=!!r.cut;r=r.text;}
    return r;}};
  return box;
};
const SHOW=[
  {id:"maya",name:"MAYA OKONKWO",role:"Protagonist · the fixer — night-shift paramedic who never leaves a call unfinished",pronouns:"she/her",ageRange:"mid 30s",voice:{accent:"soft Lagos-London"}},
  {id:"dez",name:"DEZ HARLAN",role:"Ally — her driver, twenty years on the same ambulance",pronouns:"he/him",ageRange:"50s"},
  {id:"ruth",name:"RUTH ABARA",role:"Antagonist · the system — the station's new controller",pronouns:"she/her",ageRange:"40s"},
  {id:"",name:"NO ID"},{id:"x",name:"  "},null,
];
const canonOf=(box)=>box.showCanonOf(SHOW,{showTitle:"Blue Hour",episodeNo:2});

/* ---------------------------------------------------------------- B12: the paragraph */
await test("B12 · what the app hands over: the Show's people, trimmed, never a film's empty cast",()=>{
  const box=makeBox();
  const c=canonOf(box);
  assert.equal(c.showTitle,"Blue Hour");assert.equal(c.episodeNo,2);assert.equal(c.total,3,"entries with no id or no name are not people");
  assert.deepEqual(JSON.parse(JSON.stringify(c.cast[0])),{id:"maya",name:"MAYA OKONKWO",role:"Protagonist · the fixer — night-shift paramedic who never leaves a call unfinished",pronouns:"she/her",age:"mid 30s"});
  assert.ok(!("voice" in c.cast[0]),"only what a plan needs");
  assert.equal(box.showCanonOf([],{showTitle:"X"}),null);assert.equal(box.showCanonOf(null),null);
  assert.equal(box.showCanonOf([{id:"a",name:"A"}],{}).episodeNo,null);
  // a very large Show hands over its first 24 and says how many there are
  const many=box.showCanonOf(Array.from({length:40},(_,i)=>({id:"p"+i,name:"PERSON "+i})),{});
  assert.equal(many.cast.length,24);assert.equal(many.total,40);
  // nothing in, nothing out
  for(const use of ["plan","spine","world"]){assert.equal(box.showCanonBlock(null,use),"");assert.equal(box.showCanonBlock({cast:[]},use),"");}
});

await test("B12 · the paragraph, worded for the step that reads it",()=>{
  const box=makeBox(),c=canonOf(box);
  const plan=box.showCanonBlock(c,"plan"),spine=box.showCanonBlock(c,"spine"),world=box.showCanonBlock(c,"world");
  for(const b of [plan,spine,world]){
    assert.ok(b.includes("THIS STORY IS EPISODE 2 OF THE SHOW \u201cBlue Hour\u201d."));
    assert.ok(b.includes("THE SHOW'S PEOPLE ALREADY EXIST and are canon: each keeps exactly the name and identity below \u2014 none is renamed, re-invented, replaced or split in two."));
    assert.ok(b.includes("the Show's protagonist stays its protagonist unless the writer's own words say this episode follows someone else"));
    assert.ok(b.includes("A person the story needs who is NOT on this list is new to the Show and gets a name that is not on it."));
    assert.ok(b.includes("the rules for naming NEW people do not apply to them"));
    assert.ok(b.includes("RUTH ABARA \u2014 Antagonist · the system — the station's new controller (she/her, 40s)"));
  }
  // a plan names people; the scene list and the world also need their ids
  assert.ok(plan.includes("THE SHOW'S CAST:\n\u2022 MAYA OKONKWO \u2014 Protagonist"));assert.ok(!plan.includes("maya = "));
  assert.ok(spine.includes("THE SHOW'S CAST (id = NAME):\n\u2022 maya = MAYA OKONKWO \u2014 Protagonist"));
  assert.ok(spine.includes("DRIVER IDS: a scene driven by one of these people uses EXACTLY the id before their '=' sign."));
  assert.ok(world.includes("\u2022 dez = DEZ HARLAN"));
  assert.ok(world.includes("IN \"cast\": return every one of these people who appears in this episode with EXACTLY the id and name shown"));
  assert.ok(world.includes("are kept as they are (repeat them, never redesign them). Add a full new entry only for a person this episode introduces."));
  assert.ok(!spine.includes("IN \"cast\"")&&!world.includes("DRIVER IDS"));
  // a Show with no title, an episode with no number
  const bare=box.showCanonBlock(box.showCanonOf(SHOW,{}),"plan");
  assert.ok(bare.includes("THIS STORY IS A NEW EPISODE OF THE SHOW. THE SHOW'S PEOPLE"));
  // nobody's vendor or the codename rides in
  assert.ok(!/TURN|Claude|Anthropic|McKee/.test(plan+spine+world));
});

/* ---------------------------------------------------------------- B12: every call */
const scene=(i,act,d)=>({a:act,t:"Scene "+i,l:"INT. AMBULANCE - NIGHT",s:"event number "+i+" happens",d:d||"maya",vp:"Trust",vn:"Doubt",oc:-1,cc:2,cl:2});
const half=(from,n,actOf,title,d)=>JSON.stringify({...(title?{title}:{}),scenes:Array.from({length:n},(_,k)=>scene(from+k,actOf(from+k),d))});
const isFirst=p=>!p.includes("THE FIRST HALF IS ALREADY WRITTEN");
const HEAD="THIS STORY IS EPISODE 2 OF THE SHOW \u201cBlue Hour\u201d.";

await test("B12 · the loglines, the typed interview, the research and the synopsis are told who is in the Show",async()=>{
  const box=makeBox(),c=canonOf(box);
  box.__play=()=>JSON.stringify({loglines:["Maya must choose."],shape:{format:"series",framework:"threeact",why:"x"}});
  await box.aiSeedToLoglines("whatif","What if a call comes from her own address?",c);
  assert.ok(box.__prompts[0].includes(HEAD)&&box.__prompts[0].includes("THE SHOW'S CAST:\n\u2022 MAYA OKONKWO"));
  assert.ok(box.__prompts[0].indexOf("WRITER'S INPUT")<box.__prompts[0].indexOf(HEAD)&&box.__prompts[0].indexOf(HEAD)<box.__prompts[0].indexOf("Each logline: ONE sentence"));
  // the conversation's transcript shaped into loglines, and the typed interview
  box.__prompts.length=0;
  await box.aiSeedToLoglines("talk","WRITER: it is about Maya's sister.",c);
  assert.ok(box.__prompts[0].includes(HEAD));
  box.__prompts.length=0;box.__play=()=>JSON.stringify({say:"Tell me more.",done:false});
  await box.aiSeedInterview([{role:"user",content:"A night call."}],"TV Series",c);
  assert.ok(box.__prompts[0].includes(HEAD)&&box.__prompts[0].includes("\u2022 DEZ HARLAN"));
  // research and synopsis
  box.__prompts.length=0;box.__play=()=>JSON.stringify({title:"T",research:{memory:"m",imagination:"i",fact:{world:"w",roles:[]}}});
  await box.aiResearch("Maya answers a call from her own address.","",null,"series","",c);
  assert.ok(box.__prompts[0].includes(HEAD)&&box.__prompts[0].indexOf(HEAD)<box.__prompts[0].indexOf("1) MEMORY"));
  box.__prompts.length=0;box.__play=()=>JSON.stringify({synopsis:{setup:"One. Two.",confrontation:"Three. Four.",resolution:"Five. Six."}});
  const syn=await box.aiSynopsisFromResearch("Maya answers a call from her own address.","","threeact","series",null,c);
  assert.equal(syn.paras.length,3);
  assert.ok(box.__prompts[0].includes(HEAD)&&box.__prompts[0].indexOf(HEAD)<box.__prompts[0].indexOf("NAMES FOR NEW PEOPLE"),"canon is read before the rules for new names");
  // both in a row (the one-call path) carries it to each
  box.__prompts.length=0;
  box.__play=(p)=>/Research the LOGLINE/.test(p)?JSON.stringify({title:"T",research:{memory:"m",imagination:"i",fact:{world:"w",roles:[]}}}):JSON.stringify({synopsis:{setup:"One.",confrontation:"Two.",resolution:"Three."}});
  await box.aiResearchSynopsis("Maya answers a call.","","threeact","series",c);
  assert.equal(box.__prompts.length,2);assert.ok(box.__prompts.every(p=>p.includes(HEAD)));
});

await test("B12 · a film that is not an episode is told nothing — every call, word for word as before",async()=>{
  const box=makeBox();
  const plays=[
    [()=>JSON.stringify({loglines:["x y z a b c d e f g h i j k l."],shape:{}}),()=>box.aiSeedToLoglines("whatif","What if?")],
    [()=>JSON.stringify({say:"Hi.",done:false}),()=>box.aiSeedInterview([],"Short Film")],
    [()=>JSON.stringify({title:"T",research:{memory:"m",imagination:"i",fact:{world:"w",roles:[]}}}),()=>box.aiResearch("L","",null,"film","")],
    [()=>JSON.stringify({synopsis:{setup:"One.",confrontation:"Two.",resolution:"Three."}}),()=>box.aiSynopsisFromResearch("L","","threeact","film",null)],
    [(p)=>isFirst(p)?half(1,8,i=>i<=4?1:2,"T"):half(9,8,i=>i<=12?2:3),()=>box.aiBuildSpine("LOGLINE: x","film","threeact")],
    [()=>JSON.stringify({premise:"q?",cast:[]}),()=>box.aiBuildStoryWorld("LOGLINE: x",{title:"T",scenes:[{act:1,title:"S",summary:"s",driver:"ana"}]},"film",null)],
  ];
  for(const [play,run] of plays){box.__play=play;await run();}
  assert.ok(box.__prompts.length>=7);
  for(const p of box.__prompts){assert.ok(!p.includes("THE SHOW'S PEOPLE ALREADY EXIST"));assert.ok(!p.includes("OF THE SHOW"));}
});

await test("B12 · the scene list (both halves) and the story world are built with the Show's people",async()=>{
  const box=makeBox(),c=canonOf(box);
  box.__play=(p)=>isFirst(p)?half(1,12,i=>i<=6?1:2,"The Call Home"):half(13,12,i=>i<=18?2:3);
  const spine=await box.aiBuildSpine("LOGLINE: Maya answers a call from her own address.","series","threeact",c);
  assert.equal(spine.scenes.length,24);assert.equal(box.__prompts.length,2);
  for(const p of box.__prompts){
    assert.ok(p.includes(HEAD)&&p.includes("\u2022 maya = MAYA OKONKWO")&&p.includes("DRIVER IDS: a scene driven by one of these people uses EXACTLY the id"));
    assert.ok(p.indexOf("LOGLINE / SYNOPSIS:")<p.indexOf(HEAD),"after the brief, so the brief's own names still come first");
  }
  box.__prompts.length=0;
  box.__play=()=>JSON.stringify({premise:"What if the call is home?",cast:[{id:"maya",name:"MAYA OKONKWO",role:"Protagonist — paramedic"},{id:"ines",name:"INÊS OKONKWO",role:"Catalyst — her sister",pronouns:"she/her",age:"late 20s"}]});
  const world=await box.aiBuildStoryWorld("LOGLINE: x",spine,"series",null,c);
  assert.ok(box.__prompts[0].includes(HEAD)&&box.__prompts[0].includes("IN \"cast\": return every one of these people who appears in this episode with EXACTLY the id and name shown"));
  assert.ok(box.__prompts[0].indexOf("SCENES (all 24")<box.__prompts[0].indexOf(HEAD)&&box.__prompts[0].indexOf(HEAD)<box.__prompts[0].indexOf("Driver ids used across scenes"));
  assert.deepEqual(Array.from(world.cast.map(x=>x.id)),["maya","ines"]);
});

await test("B12 · the app: New Story in an empty episode, and the build in an episode, are given the Show's cast",()=>{
  const app=read("app/app.jsx"),ns=read("app/newstory.jsx");
  // New Story: only when it builds the Show's current (empty) episode
  assert.ok(app.includes("const newStoryBuildsCurrentEpisode=!!(currentShowId && !scenes.length);"));
  assert.ok(app.includes("showCanon:(newStoryBuildsCurrentEpisode && typeof window.showCanonOf===\"function\")\n        ? window.showCanonOf(characters, { showTitle:newStoryShowRow&&newStoryShowRow.title, episodeNo:currentEpisodeNo }) : null,"));
  assert.ok(ns.includes("initialSeedText, showCanon }){"));
  for(const call of ["aiSeedToLoglines(seed, text, showCanon)","aiSeedToLoglines(\"talk\",transcript,showCanon)","aiSeedInterview([], formatLabel, showCanon)","aiSeedInterview(next, formatLabel, showCanon)",
    "aiResearch(l, text, frameworkRef.current, formatRef.current, again ? steer : \"\", showCanon)","aiSynopsisFromResearch(l, text, frameworkRef.current, formatRef.current, research, showCanon)"])
    assert.ok(ns.includes(call),call);
  assert.ok(ns.includes("React.createElement(NSInterview,{ formatLabel, showCanon,"));
  assert.ok(ns.includes("This episode is planned with the Show\\u2019s cast (\"+showCanon.total+"));
  // no writing call of New Story is left without it
  assert.equal((ns.match(/await ai(SeedToLoglines|SeedInterview|Research|SynopsisFromResearch)\(/g)||[]).length,6);
  // the build: the Adaptation run of a Show's episode, from the cast as it was when the run started
  assert.ok(app.includes("const showCanon = (currentShowId && agentName===\"Adaptation\" && typeof window.showCanonOf===\"function\")\n      ? window.showCanonOf(model.characters, {"));
  assert.ok(app.includes("(project&&project.framework)||\"threeact\", showCanon),"));
  assert.ok(app.includes("? project.research : null, showCanon),"));
  assert.ok(app.includes("return { model, sync, input, emit, propose, showCanon,"));
});

/* the build (agents.jsx) in an episode, then the Show's own cast merge (series.js) as the app runs it at save */
const runEpisodeBuild=async(worldCast)=>{
  const box=makeBox(),c=canonOf(box);
  const trace=[];
  const showCast=SHOW.filter(x=>x&&x.id&&String(x.name||"").trim()).map(x=>JSON.parse(JSON.stringify(x)));
  const spine={title:"The Call Home",scenes:Array.from({length:8},(_,i)=>({act:i<2?1:i<6?2:3,title:"Scene "+(i+1),loc:"INT. AMBULANCE - NIGHT",summary:"event "+(i+1),
    driver:["maya","maya","dez","ines","maya","ruth","ines","maya"][i],openValue:"Trust",openCharge:-1,closeValue:"Doubt",closeCharge:2}))};
  let stop=false;
  const ctx={input:"LOGLINE: Maya answers a call from her own address.",showCanon:c,project:{title:"",format:"series"},
    model:{scenes:[],characters:showCast.map(x=>({...x})),project:{title:"",format:"series"},beats:{},drafts:{},continuity:{}},
    emit:s=>trace.push(s),propose:async()=>true,cancelled:()=>stop,sync:()=>true,
    castCanon:(ch)=>showCast.some(x=>x.id===ch.id),
    ai:{available:true,buildSpine:async()=>spine,buildStoryWorld:async()=>({premise:"What if the call is home?",controllingIdea:{value:"v",cause:"c",polarity:"ironic"},setting:{},cast:worldCast}),
      authorScene:async()=>{stop=true;return null;},draftScene:async()=>{stop=true;return null;}}};
  box.aiSuggestContract=async()=>null;box.aiCastPsychology=async()=>null;
  await box.AGENTS.find(a=>a.id==="adapt").run(ctx);
  // the save-time reconcile (app.jsx: mergeAdaptationCast(live Show cast, the build's cast, scenes, …))
  const merged=box.turnSeries.mergeAdaptationCast(showCast,ctx.model.characters,ctx.model.scenes,{allowNew:true,revisable:[],base:{}});
  return{trace,ctx,merged,showCast};
};

await test("B12 · the build says it, and the episode ends with the Show's people — not copies — plus the one new person",async()=>{
  const{trace,merged,showCast}=await runEpisodeBuild([
    {id:"maya",name:"MAYA OKONKWO",role:"Protagonist — paramedic",pronouns:"she/her",ageRange:"mid 30s"},
    {id:"dez",name:"DEZ HARLAN",role:"Ally — her driver"},
    {id:"ruth",name:"RUTH ABARA",role:"Antagonist — controller"},
    {id:"ines",name:"INÊS OKONKWO",role:"Catalyst — Maya's younger sister",pronouns:"she/her",ageRange:"late 20s"}]);
  const said=trace.find(s=>/^This is episode 2 of /.test(s.t));
  assert.ok(said);
  assert.equal(said.t,"This is episode 2 of \u201cBlue Hour\u201d: the scene list and the cast are built with the Show\u2019s 3 people \u2014 they keep their names and who they are; anyone this episode introduces is added.");
  assert.ok(trace.indexOf(said)<trace.findIndex(s=>/Generating the scene breakdown/.test(s.t)));
  // the Show's three are the same three records (their canon untouched), and one person was added
  const ids=Array.from(merged.characters.map(x=>x.id));
  assert.deepEqual(ids.slice(0,3),["maya","dez","ruth"]);assert.equal(merged.characters.length,4);
  assert.equal(merged.characters[0].role,showCast[0].role,"the Show's own description of Maya stands");
  assert.deepEqual(JSON.parse(JSON.stringify(merged.characters[0].voice)),{accent:"soft Lagos-London"});
  assert.equal(merged.characters[3].name,"INÊS OKONKWO");
  assert.deepEqual(Array.from(merged.addedIds||[]).length,1);
  // every scene is driven by a person who exists, the Show's lead among them
  const drivers=new Set(Array.from(merged.scenes.map(s=>s.driver)));
  for(const d of drivers) assert.ok(merged.characters.some(x=>x.id===d),"scene driver "+d+" has no cast record");
  assert.ok(drivers.has("maya")&&drivers.has("dez")&&drivers.has("ruth"));
});

await test("B12 · a film that is not an episode: the build says nothing about a Show",async()=>{
  const box=makeBox(),trace=[];
  let stop=false;
  const ctx={input:"LOGLINE: x",project:{format:"film"},model:{scenes:[],characters:[],project:{format:"film"},beats:{},drafts:{},continuity:{}},
    emit:s=>trace.push(s),propose:async()=>true,cancelled:()=>stop,sync:()=>true,
    ai:{available:true,buildSpine:async()=>({title:"T",scenes:Array.from({length:4},(_,i)=>({act:1,title:"S"+i,loc:"INT. X - DAY",summary:"e",driver:"ana",openCharge:-1,closeCharge:1}))}),
      buildStoryWorld:async()=>({premise:"q?",cast:[{id:"ana",name:"ANA"}]}),authorScene:async()=>{stop=true;return null;},draftScene:async()=>{stop=true;return null;}}};
  box.aiSuggestContract=async()=>null;box.aiCastPsychology=async()=>null;
  await box.AGENTS.find(a=>a.id==="adapt").run(ctx);
  assert.ok(!trace.some(s=>/episode|Show\u2019s/.test(s.t)),trace.map(s=>s.t).join(" | "));
});

/* ---------------------------------------------------------------- B14 */
await test("B14 · a scene-list half that was cut off and came back short is asked for again; the longer answer is kept",async()=>{
  const box=makeBox();
  let n=0;
  // the first half: cut off with 7 of 8 scenes (7 is above the old 75% bar, so it used to be accepted)
  box.__play=(p)=>{n++;if(isFirst(p))return n===1?{text:half(1,7,i=>i<=4?1:2,"T"),cut:true}:half(1,8,i=>i<=4?1:2,"T");return half(9,8,i=>i<=12?2:3);};
  const spine=await box.aiBuildSpine("LOGLINE: x","film","threeact");
  assert.equal(box.__prompts.length,3,"first half twice, second once");
  assert.equal(spine.scenes.length,16);assert.equal(spine.short,undefined);
  // cut off but complete (the cut fell after the list): not asked again
  const b2=makeBox();
  b2.__play=(p)=>isFirst(p)?{text:half(1,8,i=>i<=4?1:2,"T"),cut:true}:half(9,8,i=>i<=12?2:3);
  assert.equal((await b2.aiBuildSpine("LOGLINE: x","film","threeact")).scenes.length,16);assert.equal(b2.__prompts.length,2);
  // short without being cut keeps the old bar (7 of 8 is accepted, and the list says it is short)
  const b3=makeBox();
  b3.__play=(p)=>isFirst(p)?half(1,7,i=>i<=4?1:2,"T"):half(9,8,i=>i<=12?2:3);
  const s3=await b3.aiBuildSpine("LOGLINE: x","film","threeact");
  assert.equal(b3.__prompts.length,2);assert.equal(s3.scenes.length,15);assert.equal(s3.short.got,15);
  // cut both times: the longer of the two is used and the list says it is short
  const b4=makeBox();let k=0;
  b4.__play=(p)=>{if(!isFirst(p))return half(9,8,i=>i<=12?2:3);k++;return {text:half(1,k===1?6:7,i=>i<=4?1:2,"T"),cut:true};};
  const s4=await b4.aiBuildSpine("LOGLINE: x","film","threeact");
  assert.equal(b4.__prompts.length,3);assert.equal(s4.scenes.length,15);assert.ok(s4.short);
});

await test("B14 · a cut-off story world is asked for once more; the fuller answer is kept; cut twice is said",async()=>{
  const spine={title:"T",scenes:[{act:1,title:"S",summary:"s",driver:"ana"}]};
  const cast=n=>Array.from({length:n},(_,i)=>({id:"p"+String.fromCharCode(97+i),name:"PERSON "+String.fromCharCode(65+i),role:"Ally — someone"}));
  // cut, then whole
  let box=makeBox(),n=0;
  box.__play=()=>{n++;return n===1?{text:JSON.stringify({premise:"q?",cast:cast(3)}),cut:true}:JSON.stringify({premise:"q?",cast:cast(6)});};
  let w=await box.aiBuildStoryWorld("LOGLINE: x",spine,"film",null);
  assert.equal(box.__prompts.length,2);assert.equal(w.cast.length,6);assert.equal(w.cut,undefined);
  // whole at once: one call, as before
  box=makeBox();box.__play=()=>JSON.stringify({premise:"q?",cast:cast(4)});
  w=await box.aiBuildStoryWorld("LOGLINE: x",spine,"film",null);
  assert.equal(box.__prompts.length,1);assert.equal(w.cut,undefined);
  // cut twice: the fuller one, marked
  box=makeBox();n=0;
  box.__play=()=>{n++;return {text:JSON.stringify({premise:"q?",cast:cast(n===1?5:3)}),cut:true};};
  w=await box.aiBuildStoryWorld("LOGLINE: x",spine,"film",null);
  assert.equal(box.__prompts.length,2);assert.equal(w.cast.length,5);assert.equal(w.cut,true);
  // cut, then an error: the first answer stands
  box=makeBox();n=0;
  box.__play=()=>{n++;return n===1?{text:JSON.stringify({premise:"q?",cast:cast(2)}),cut:true}:new Error("The writing service returned an error (500).");};
  w=await box.aiBuildStoryWorld("LOGLINE: x",spine,"film",null);
  assert.equal(w.cast.length,2);assert.equal(w.cut,true);
  // the build says it, with the count
  const ag=read("app/agents.jsx");
  assert.ok(ag.includes("if(world && world.cut && !ctx.cancelled()) ctx.emit({k:\"flag\", t:\"The story world\\u2019s answer was cut off before it finished, twice. What came back is used: \""));
});

await test("B14 · a synopsis paragraph that stops mid-sentence is written again, whole",async()=>{
  const box=makeBox();
  let n=0;
  box.__play=(p)=>{n++;
    if(n===1) return {text:JSON.stringify({synopsis:{setup:"She runs the night board. It is nineteen years.",confrontation:"The crews plan a hold. The auditor finds the fuel.",resolution:"On the night of the handover she sends every boat out on a true"}}),cut:true};
    return JSON.stringify({synopsis:{resolution:"On the night of the handover she sends every boat out on a true board. At dawn she rides the first ferry."}});};
  const syn=await box.aiSynopsisFromResearch("A dispatcher must choose.","","threeact","film",null);
  assert.equal(box.__prompts.length,2);
  assert.ok(box.__prompts[1].includes("MISSING paragraphs to write now:")&&box.__prompts[1].includes("resolution:")&&!/\u2022 setup:/.test(box.__prompts[1].split("MISSING paragraphs")[1]));
  assert.equal(syn.resolution,"On the night of the handover she sends every boat out on a true board. At dawn she rides the first ferry.");
  assert.equal(syn.setup,"She runs the night board. It is nineteen years.");
  // a cut that fell after a finished sentence changes nothing
  const b2=makeBox();
  b2.__play=()=>({text:JSON.stringify({synopsis:{setup:"One.",confrontation:"Two.",resolution:"Three."}}),cut:true});
  const s2=await b2.aiSynopsisFromResearch("L","","threeact","film",null);
  assert.equal(b2.__prompts.length,1);assert.equal(s2.resolution,"Three.");
  // an answer that was not cut keeps a paragraph without a full stop as the writer's engine wrote it
  const b3=makeBox();
  b3.__play=()=>JSON.stringify({synopsis:{setup:"One.",confrontation:"Two.",resolution:"She leaves — and does not look back"}});
  assert.equal((await b3.aiSynopsisFromResearch("L","","threeact","film",null)).resolution,"She leaves — and does not look back");assert.equal(b3.__prompts.length,1);
  // the repair asks for the format's own size (it said 3-5 sentences for every format)
  const b4=makeBox();let m=0;
  b4.__play=()=>{m++;return m===1?JSON.stringify({synopsis:{setup:"One."}}):JSON.stringify({synopsis:{confrontation:"Two.",resolution:"Three."}});};
  await b4.aiSynopsisFromResearch("L","","threeact","commercial",null);
  assert.ok(b4.__prompts[1].includes("Each paragraph "+b4.synopsisSentencesFor(b4.FORMATS.find(f=>f.id==="commercial"))+" sentences"));
  assert.ok(!b4.__prompts[1].includes("Each paragraph 3-5 sentences"));
});

await test("Frances knows, and the page is on the new key",()=>{
  const box=makeBox();
  const f=box.APP_FEATURES.find(x=>x&&String(x.name||"").startsWith("A new episode uses the Show's cast"));
  assert.ok(f);
  for(const part of ["planned and built WITH THE SHOW'S PEOPLE","the Show's protagonist stays its protagonist unless your own words say this episode follows someone else",
    "HOW TO FOLLOW SOMEONE ELSE","NOT COVERED: what HAPPENED in earlier episodes is not read","makes a separate film, not an episode"]) assert.ok(f.what.includes(part),part);
  const run=box.APP_FEATURES.find(x=>x&&String(x.name||"").startsWith("Writers' Room run integrity"));
  assert.ok(run.what.includes("A PLAN THAT WAS CUT OFF IS TREATED AS CUT OFF (2026-11-12)"));
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","agents.jsx","app.jsx","newstory.jsx"])
    assert.ok(["20261112-show1", "20261112-ns1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log("\n"+(failed?"FAILED — "+failed+" of "+(checks+failed):"OK — "+checks+" checks passed"));
process.exit(failed?1:0);

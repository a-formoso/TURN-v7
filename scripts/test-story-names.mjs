/* THE NAMES A STORY BUILD GIVES PEOPLE (owner 2026-11-12, Writers' Room audit B5 and B6).
     B6  "Inês" became the character id "ins"; a name in another script became "lead", the same for every such person.
     B5  the same names kept coming back across unrelated stories ("Teodor" in 12 of 24 scene lists).
   This runs the REAL code: app/story-names.js, the scene-list reader, the spine / world / synopsis / logline calls of
   app/ai.jsx (with the writing engine stubbed) and the build in app/agents.jsx.
   node scripts/test-story-names.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
const plain=v=>JSON.parse(JSON.stringify(v));

const mem={};
const box={console:{...console,warn:noop,info:noop},setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  React:new Proxy({createElement:h,Fragment:"f",useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useMemo:f=>f(),useCallback:f=>f,memo:f=>f},{get:(t,k)=>(k in t)?t[k]:noop}),
  ReactDOM:new Proxy({},{get:()=>noop}),Icon:new Proxy({},{get:()=>()=>null}),
  localStorage:{getItem:k=>(k in mem?mem[k]:null),setItem:(k,v)=>{mem[k]=String(v);},removeItem:k=>{delete mem[k];}},
  sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  navigator:{userAgent:"node-test"},location:{href:"",search:"",hash:"",origin:""},
  CustomEvent:class{constructor(t,o){this.type=t;this.detail=o&&o.detail;}},Image:class{},
  document:{createElement:()=>({getContext:()=>null,style:{},setAttribute:noop,appendChild:noop,classList:{add:noop,remove:noop}}),getElementById:()=>null,
    addEventListener:noop,removeEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],createTextNode:()=>({}),body:{appendChild:noop,removeChild:noop},head:{appendChild:noop}},
  requestAnimationFrame:noop,cancelAnimationFrame:noop,addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,
  matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),fetch:()=>{throw new Error("network disabled");}};
box.window=box;box.globalThis=box;box.self=box;vm.createContext(box);
const asShipped=f=>transformSync(read(f),{plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:f}).code;
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx","app/build-state.js","app/story-names.js","app/agents.jsx"])
  vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
box.appToast=noop;box.scenePause=()=>Promise.resolve();
box.sbClient=()=>({functions:{invoke:async()=>({data:{text:"",usage:{credits:0}},error:null})}});
box.isStandInDraft=d=>!!(d&&d.auto);
const N=box.KinolotNames;

/* the writing engine, stubbed: every prompt is kept, the reply is whatever the test queued */
const asked=[];
const engine=(replies)=>{ asked.length=0; const q=replies.slice();
  box.claude={...box.claude,complete:async({messages})=>{ asked.push(messages[messages.length-1].content); const r=q.length>1?q.shift():q[0]; return typeof r==="function"?r():r; }}; };
const seq=(vals)=>{ let i=0; return ()=>vals[(i++)%vals.length]; };
const lettersIn=(prompt,label)=>{ const m=prompt.match(new RegExp(label+"[^:]*: ((?:[A-Z], )+[A-Z])")); return m?m[1].split(", "):null; };
const scene=(d,i,act)=>({a:act||1,t:"Scene "+(i+1),l:"INT. ROOM - DAY",s:"Event "+(i+1)+".",d,vp:"Hope",vn:"Fear",oc:1,cc:-2,cl:2});

await test("B6 a name becomes an id: accents fold to the plain letter, another script gets its own stable id",()=>{
  assert.equal(N.id("Inês"),"ines");                 // it was "ins"
  assert.equal(N.id("Søren"),"soren");
  assert.equal(N.id("Łukasz"),"lukasz");
  assert.equal(N.id("Zoë"),"zoe");
  assert.equal(N.id("Strauß"),"strauss");
  assert.equal(N.id("D'Arcy"),"darcy");
  assert.equal(N.id("mara"),"mara");                 // a plain name is what it always was
  assert.equal(N.id("Christopherson-Vance"),"christophers");   // still at most 12 letters
  assert.equal(N.id(""),""); assert.equal(N.id(null),""); assert.equal(N.id("  - "),"");
  const yuri=N.id("Юрий"), oleg=N.id("Олег"), mei=N.id("美玲");
  for(const x of [yuri,oleg,mei]) assert.match(x,/^n[a-z]{7}$/);
  assert.equal(new Set([yuri,oleg,mei]).size,3,"three people, three ids (they were all \"lead\")");
  assert.equal(N.id("юрий"),yuri,"the same name gives the same id, whatever its capitals");
  assert.equal(N.id(yuri),yuri,"an id reads back as itself");
  // the id alone can no longer show these names
  assert.equal(N.idLosesName("inês"),true); assert.equal(N.idLosesName("Юрий"),true);
  assert.equal(N.idLosesName("mara"),false);
  assert.equal(N.display("inês"),"Inês"); assert.equal(N.display("юрий"),"Юрий");
  // two spellings of one name compare equal; two different names never both come out empty
  assert.equal(N.key("INÊS"),N.key("Inês")); assert.equal(N.key("Inês Duarte"),"ines duarte");
  assert.notEqual(N.key("Юрий"),N.key("Олег")); assert.ok(N.key("Юрий"));
});

await test("B6 the scene list keeps each person apart, and the names ride on the spine (never on a scene)",async()=>{
  const got=plain(box.normSpineScenes([scene("inês",0),scene("юрий",1),scene("олег",2),scene("mara",3),scene("",4)]));
  assert.deepEqual(got.map(s=>s.driver),["ines",N.id("юрий"),N.id("олег"),"mara","lead"]);
  assert.deepEqual(got.map(s=>s.driverName||null),["Inês","Юрий","Олег",null,null]);
  // the whole spine call
  const first=JSON.stringify({title:"The Ferry",scenes:[scene("inês",0,1),scene("юрий",1,1),scene("mara",2,2)]});
  const second=JSON.stringify({scenes:[scene("inês",3,2),scene("олег",4,3),scene("mara",5,3)]});
  engine([first,second]);
  const spine=plain(await box.aiBuildSpine("LOGLINE: A ferry pilot refuses a last crossing.","microshort","threeact"));
  assert.ok(spine && spine.scenes.length>=5,"a spine came back");
  assert.deepEqual(spine.driverNames,{ines:"Inês",[N.id("юрий")]:"Юрий",[N.id("олег")]:"Олег"});
  assert.ok(spine.scenes.every(s=>!("driverName" in s)),"a scene carries the id only");
  // a spine of plain names carries no such list
  engine([JSON.stringify({title:"Plain",scenes:[scene("mara",0,1),scene("tom",1,1),scene("mara",2,2)]}),JSON.stringify({scenes:[scene("tom",3,2),scene("mara",4,3),scene("tom",5,3)]})]);
  const plainSpine=plain(await box.aiBuildSpine("LOGLINE: Two people.","microshort","threeact"));
  assert.equal("driverNames" in plainSpine,false);
});

await test("B6 the cast is told whose id each code is, and takes the same ids back",async()=>{
  const yuri=N.id("юрий");
  const spine={title:"The Ferry",driverNames:{ines:"Inês",[yuri]:"Юрий"},
    scenes:[{no:1,title:"One",driver:"ines",summary:"Inês refuses."},{no:2,title:"Two",driver:yuri,summary:"Юрий insists."},{no:3,title:"Three",driver:"mara",summary:"Mara waits."}]};
  engine([JSON.stringify({genre:"drama",premise:"What if?",controllingIdea:{value:"Trust",cause:"x",polarity:"ironic"},setting:{},
    cast:[{id:"inês",name:"Inês Duarte",role:"Protagonist"},{id:"Юрий",name:"Юрий Петров",role:"Antagonist"},{id:"mara",name:"Mara Quill",role:"Ally"},{name:"Søren Holt",role:"Clerk"}]})]);
  const world=plain(await box.aiBuildStoryWorld("LOGLINE: A ferry pilot.",spine,"microshort",null));
  assert.ok(asked[0].includes("Driver ids used across scenes: ines (the id of Inês), "+yuri+" (the id of Юрий), mara. "));
  assert.deepEqual(world.cast.map(c=>c.id),["ines",yuri,"mara","sorenholt"]);
  assert.deepEqual(world.cast.map(c=>c.name),["Inês Duarte","Юрий Петров","Mara Quill","Søren Holt"]);
});

const beats=()=>({rows:[{n:1,drive:{a:"Waits",d:"She waits."},react:{a:"Holds",d:"Nothing answers."},charge:1}]});
const draft=()=>({blocks:[{type:"scene",text:"INT. ROOM - DAY",beat:1},{type:"action",text:"She waits.",beat:1}],ai:true});
const build=async(spine,world)=>{
  box.turnProject={format:"short",framework:"threeact"};
  const ctx={input:"LOGLINE: A ferry pilot refuses a last crossing.",project:{title:"Untitled",format:"short",framework:"threeact"},
    model:{scenes:[],characters:[],project:{},beats:{},drafts:{},continuity:{}},
    emit:noop,propose:async()=>true,cancelled:()=>false,sync:()=>true,
    ai:{available:true,buildSpine:async()=>spine,...(world?{buildStoryWorld:async()=>world}:{}),
      authorScene:async()=>({patch:{},beats:beats()}),draftScene:async()=>draft()}};
  await box.agentAdaptation(ctx);
  return ctx.model;
};
const builtSpine=()=>{ const yuri=N.id("юрий");
  return {title:"The Ferry",driverNames:{ines:"Inês",[yuri]:"Юрий"},scenes:["ines",yuri,"ines","mara",yuri,"ines"].map((d,i)=>({act:i<2?1:i<4?2:3,title:"Scene "+(i+1),loc:"INT. ROOM - DAY",summary:"Event "+(i+1)+".",driver:d,
    openValue:"Hope",openCharge:i%2?-2:2,closeValue:"Hope",closeCharge:i%2?2:-2,stage:""}))}; };

await test("B6 the build names people by their real names, with or without a cast from the story world",async()=>{
  const yuri=N.id("юрий");
  // no story world came back: every driver still becomes a person with their own name (it was "Ins")
  const a=plain(await build(builtSpine(),null));
  const byId=Object.fromEntries(a.characters.map(c=>[c.id,c.name]));
  assert.equal(byId.ines,"Inês"); assert.equal(byId[yuri],"Юрий"); assert.equal(byId.mara,"Mara");
  assert.equal(a.characters.length,3);
  // a cast whose ids differ is matched by NAME: no second "Inês", and a code never matches by its letters
  const b=plain(await build(builtSpine(),{premise:"What if?",controllingIdea:{},setting:{},
    cast:[{id:"duarte",name:"Inês Duarte",role:"Protagonist"},{id:"petrov",name:"Юрий Петров",role:"Antagonist"},{id:"nab",name:"Nab Corwin",role:"Clerk"},{id:"mara",name:"Mara Quill",role:"Ally"}]}));
  assert.deepEqual(b.scenes.map(s=>s.driver),["duarte","petrov","duarte","mara","petrov","duarte"]);
  assert.deepEqual(b.characters.map(c=>c.name),["Inês Duarte","Юрий Петров","Nab Corwin","Mara Quill"]);
});

await test("B6 a cue in capitals finds its person: accents, other scripts, and a film saved with the old id",()=>{
  const cast=[{id:"ines",name:"Inês Duarte"},{id:N.id("юрий"),name:"Юрий Петров"},{id:N.id("олег"),name:"Олег Сидоров"},{id:"mara",name:"Mara Quill"}];
  assert.equal(box.castMemberByLabel("INÊS",cast).name,"Inês Duarte");
  assert.equal(box.castMemberByLabel("INES",cast).name,"Inês Duarte");
  assert.equal(box.castMemberByLabel("ЮРИЙ",cast).name,"Юрий Петров");
  assert.equal(box.castMemberByLabel("ОЛЕГ СИДОРОВ",cast).name,"Олег Сидоров");
  assert.equal(box.castMemberByLabel("MARA",cast).name,"Mara Quill");
  assert.equal(box.castMemberByLabel("НИКТО",cast),null,"a stranger matches nobody");
  assert.equal(box.castMemberByLabel("",cast),null);
  // saved before this change: the id is still "ins" and is never rewritten
  assert.equal(box.castMemberByLabel("INÊS",[{id:"ins",name:"Inês Duarte"},{id:"mara",name:"Mara Quill"}]).id,"ins");
});

await test("B5 the initials are drawn in the app: different every call, never two alike, a person already named is kept",()=>{
  const a=N.draw(8,seq([0.01,0.5,0.99,0.3,0.7,0.2,0.85,0.6])), b=N.draw(8,seq([0.9,0.1,0.4,0.75,0.05,0.55,0.33,0.66]));
  assert.equal(a.length,8); assert.equal(new Set(a).size,8,"no letter twice");
  assert.notDeepEqual(plain(a),plain(b));
  // only initials common in most naming traditions: I, O, W, Y and Z pulled stories towards one country (seen live)
  assert.ok(a.concat(b).every(ch=>/^[A-Z]$/.test(ch)&&!"IOQUWXYZ".includes(ch)));
  assert.equal([...new Set(N.LETTERS.split(""))].sort().join(""),"ABCDEFGHJKLMNPRSTV");
  assert.equal(N.draw(40,Math.random).length,new Set(N.LETTERS.split("")).size,"it stops when the alphabet is used up");
  for(const k of Object.keys(mem)) delete mem[k];
  const text=N.brief({family:true,where:"the logline",rnd:seq([0.01,0.5,0.99,0.3,0.7,0.2,0.85,0.6,0.15,0.45,0.95,0.25,0.65,0.35])});
  assert.ok(text.startsWith("NAMES FOR NEW PEOPLE — invented people that the logline does not already name (a person it names keeps exactly that name, and a real person keeps their real name)"));
  assert.equal(lettersIn(text,"FIRST name").length,8); assert.equal(lettersIn(text,"FAMILY name").length,6);
  assert.ok(text.includes("their names fit the story's place, period and culture. "));
  assert.ok(text.includes("The story's place and period come from the story itself and are settled first; the letters only choose among names that belong there \u2014 never move a story, or change who its people are, to suit a letter. Skip a letter only when no name that fits the story begins with it."));
  for(const nm of ["Teodor","Odile","Priya","Chen","Reid"]) assert.ok(text.includes(nm),nm+" is on the list");
  assert.equal(text.includes("This writer's other films"),false,"nothing to list on a first film");
  assert.equal(lettersIn(N.brief({where:"x"}),"FAMILY name"),null,"first names only unless asked");
  // twenty calls, twenty draws: the same first letter does not lead every time
  const leads=new Set(); for(let i=0;i<20;i++) leads.add(lettersIn(N.brief({}),"FIRST name")[0]);
  assert.ok(leads.size>=5,"got "+leads.size+" different leading letters in 20 calls");
});

await test("B5 a finished build's names are remembered on this device, per account, and the next film is told them",async()=>{
  for(const k of Object.keys(mem)) delete mem[k];
  box.turnUserId="user-a";
  await build(builtSpine(),{premise:"What if?",controllingIdea:{},setting:{},
    cast:[{id:"ines",name:"Inês Duarte",role:"Protagonist"},{id:N.id("юрий"),name:"Юрий Петров",role:"Antagonist"},{id:"mara",name:"Mara Quill",role:"Ally"}]});
  assert.deepEqual(plain(N.recent()),["Inês","Duarte","Юрий","Петров","Mara","Quill"]);
  assert.deepEqual(Object.keys(mem),["turn-recent-names:user-a"]);
  assert.ok(N.brief({}).includes("This writer's other films already use these, so a new person gets none of them: Inês, Duarte, Юрий, Петров, Mara, Quill."));
  // newest first, no doubles, a short word ("Li") or an article is not a name, at most 48 kept and 24 shown
  N.remember(["Bao Li","INÊS Duarte","The Old Clerk","Oskar"]);
  assert.deepEqual(plain(N.recent()).slice(0,6),["Bao","INÊS","Duarte","Clerk","Oskar","Юрий"]);
  N.remember(Array.from({length:60},(_,i)=>"Name"+String.fromCharCode(97+(i%26))+String.fromCharCode(97+Math.floor(i/26))));
  assert.equal(N.recent().length,48);
  assert.equal(N.brief({}).split("so a new person gets none of them: ")[1].split(".")[0].split(", ").length,24);
  // another account on the same device starts clean
  box.turnUserId="user-b";
  assert.deepEqual(plain(N.recent()),[]);
  // no storage at all: nothing breaks, the paragraph is still written
  const keep=box.localStorage; box.localStorage={getItem:()=>{throw new Error("blocked");},setItem:()=>{throw new Error("blocked");}};
  assert.deepEqual(plain(N.remember(["Ana"])),[]); assert.ok(N.brief({}).startsWith("NAMES FOR NEW PEOPLE"));
  box.localStorage=keep; box.turnUserId=null;
});

await test("B5 every call that may name someone carries the paragraph: logline, synopsis, scene list, cast",async()=>{
  for(const k of Object.keys(mem)) delete mem[k];
  const has=(p,where)=>assert.ok(p.includes("NAMES FOR NEW PEOPLE — invented people that "+where+" does not already name"),"missing for: "+where+"\n"+p.slice(0,200));
  engine(["A ferry pilot refuses a last crossing."]);
  await box.aiSparkLogline(); has(asked[0],"this request");
  engine([JSON.stringify({loglines:["A ferry pilot refuses a last crossing."],format:"short",framework:"threeact"})]);
  await box.aiSeedToLoglines("whatif","What if a ferry pilot refused?"); has(asked[0],"the writer's input");
  engine([JSON.stringify({synopsis:{setup:"A.",confrontation:"B.",resolution:"C."}})]);
  await box.aiSynopsisFromResearch("A ferry pilot refuses a last crossing.","","threeact","short",null);
  has(asked[0],"the logline or the writer's seed"); assert.equal(lettersIn(asked[0],"FAMILY name").length,6);
  engine([JSON.stringify({title:"T",scenes:[scene("mara",0,1),scene("tom",1,1),scene("mara",2,2)]}),JSON.stringify({scenes:[scene("tom",3,2),scene("mara",4,3),scene("tom",5,3)]})]);
  await box.aiBuildSpine("LOGLINE: Two people.","microshort","threeact");
  assert.ok(asked.length>=2,"both halves were asked for (a short half is asked for once more)");
  for(const p of asked){ has(p,"the writer's text or the scenes already written");
    assert.equal(p.includes("Naming entropy seed"),false,"the old seed is gone: a random code did nothing");
    assert.ok(p.includes("never use a role word ('antagonist','mentor') as a driver id")); }
  assert.ok(asked[asked.length-1].includes("every person in it keeps EXACTLY the same name and driver id"),"the second half still continues the first");
  engine([JSON.stringify({premise:"What if?",controllingIdea:{},setting:{},cast:[{id:"mara",name:"Mara Quill",role:"Protagonist"}]})]);
  await box.aiBuildStoryWorld("LOGLINE: Two people.",{title:"T",scenes:[{no:1,title:"One",driver:"mara",summary:"x"}]},"short",null);
  has(asked[0],"the synopsis or the scenes above");
  assert.ok(asked[0].includes("NEVER name a character after their function"));
  assert.equal(asked[0].includes("Naming entropy seed"),false);
});

await test("the page loads the names file before the build, with new keys, and Frances knows the rule",()=>{
  const html=read("TURN.html"), at=s=>{ const i=html.indexOf(s); assert.ok(i>=0,s); return i; };
  assert.ok(at("app/story-names.js?v=")<at("app/agents.jsx?v="));
  assert.ok(["20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1"].some(k=>html.includes('app/story-names.js?v='+k+'"')),"story-names.js key");
  for(const file of ["ai.jsx","script.jsx","agents.jsx"])
    assert.ok(["20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
  const f=box.APP_FEATURES.find(x=>/^New Story \(format/.test(x.name));
  assert.ok(f && /NAMES \(2026-11-12\)/.test(f.what));
  assert.ok(/a name you gave is never changed/i.test(f.what));
});

console.log("\n"+(failed?"FAILED":"OK")+" — "+checks+" checks passed"+(failed?", "+failed+" failed":""));
process.exit(failed?1:0);

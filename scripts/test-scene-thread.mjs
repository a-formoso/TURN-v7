/* EACH SCENE KNOWS THE SCENES AROUND IT (owner 2026-11-11, Writers' Room audit B1 / B2).
   Measured on two test films: the same door was opened in scenes 3, 4 and 5; a bottle was handed over in scene 1 and
   again in scene 2; a character got her capitals-and-age introduction in scene 6 after appearing in scenes 2-4. A
   scene was written knowing only the previous scene's title and closing value. This runs the REAL prompt code
   (app/ai.jsx) and pins what every scene-writing call is now told:
     1. what is already on screen, how the previous screenplay ends, what the next scene covers, who is introduced;
     2. the edges: first and last scene, an unwritten or stand-in neighbour, a long film, names inside other words;
     3. the real calls: the scene author and the drafter carry it (with the build's own drafts), the functions
        that only read a finished scene do not;
     4. the scene list is asked for one event per scene; the build passes its drafts; Frances's notes; the page.
   node scripts/test-scene-thread.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};

const box={console:{...console,warn:noop,info:noop},setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
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
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx"])
  vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
box.appToast=noop;
const sent=[];let reply="";
box.sbClient=()=>({functions:{invoke:async(_n,o)=>{sent.push(String((o.body.messages[0]||{}).content||""));return{data:{text:reply,usage:{credits:1}},error:null};}}});
const brief=(...a)=>box.sceneThreadBrief(...a);

/* the Micro Short from the audit, as it should have been threaded */
const cast=[{id:"ray",name:"RAY MALLINDER",pronouns:"he/him"},{id:"priya",name:"PRIYA BHANDARI",pronouns:"she/her"},{id:"daniel",name:"DANIEL MALLINDER",pronouns:"he/him"}];
const S=(no,title,summary,extra)=>({id:"s"+no,no,title,summary,act:1,driver:"ray",loc:"INT. LANDING - DAY",openValue:"Hope",openCharge:1,closeValue:"Fear",closeCharge:-2,...(extra||{})});
const scenes=[
  S(1,"Ten to Six","Ray wakes at ten to six and listens for a landline that has no reason to ring."),
  S(2,"A Knock","Priya knocks, locked out of her flat two floors up, and Ray takes his tool roll."),
  S(3,"No Mark","Ray refuses to snap the cylinder and works the letterbox tool blind until the door gives."),
  S(4,"Through the Slot","Priya offers to pay; through the open door Ray sees whose flat it is."),
  S(5,"Red String","On a hook inside hangs the brass key on red string that Ray cut for Daniel."),
];
const A=(text,beat=1)=>({type:"action",text,beat}),C=(text)=>({type:"char",text,beat:1}),L=(text)=>({type:"dia",text,beat:1}),P=(text)=>({type:"paren",text,beat:1});
const drafts={
  s1:{ai:true,blocks:[{type:"scene",text:"INT. RAY'S BEDROOM - DAWN",beat:1},A("Dark. RAY MALLINDER (late 60s), a man who still sleeps like he's on a job sheet, opens his eyes."),A("He doesn't look at the phone.")]},
  s2:{ai:true,blocks:[{type:"scene",text:"INT. RAY'S KITCHEN - DAY",beat:1},A("A KNOCK. Ray holds his file still."),C("PRIYA"),L("Sorry, sorry. I'm locked out."),A("Ray takes the corridor toward the stairwell, roll under one arm.")]},
  s3:{ai:true,blocks:[{type:"scene",text:"INT. COMMUNAL LANDING - DAY",beat:1},A("Ray's thumb rides the proud cylinder of a white uPVC door."),A("The hook finds the handle. Draws it down."),
    A("A soft CLICK. The door sighs open an inch."),C("PRIYA"),P("(touching the cylinder)"),L("Not a mark."),L("What do I owe you?"),A("Ray, still on his knees, stares at the green coat on its hook.")]},
};

await test("scene 4 is told what is on screen, how scene 3 ends, what scene 5 covers and who is already introduced",()=>{
  const t=brief(scenes[3],scenes,drafts,cast);
  assert.ok(t.startsWith("ALREADY ON SCREEN (the scenes before this one, in order — the audience has seen all of it):\n"
    +"  1. Ten to Six — Ray wakes at ten to six and listens for a landline that has no reason to ring.\n"
    +"  2. A Knock — Priya knocks, locked out of her flat two floors up, and Ray takes his tool roll.\n"
    +"  3. No Mark — Ray refuses to snap the cylinder and works the letterbox tool blind until the door gives.\n"),t);
  assert.ok(t.includes("HOW THE PREVIOUS SCENE ENDS (its last lines, already written):\n"
    +"  Ray's thumb rides the proud cylinder of a white uPVC door.\n  The hook finds the handle. Draws it down.\n  A soft CLICK. The door sighs open an inch.\n"
    +"  PRIYA: Not a mark. What do I owe you?\n  Ray, still on his knees, stares at the green coat on its hook.\n"),t);
  assert.ok(t.includes("PICK UP AFTER IT: this scene starts after the previous one ends. Never restage an event that is already on screen (a door that was opened is open;"));
  assert.ok(t.includes("The one exception is a deliberate return the summary itself asks for (a flashback, a memory, a replayed moment)."));
  assert.ok(t.includes("WHAT COMES NEXT (scene 5, “Red String”): On a hook inside hangs the brass key on red string that Ray cut for Daniel.\n"
    +"That belongs to the NEXT scene: end this one before it, and do not play it here.\n"));
  // Ray and Priya are in the earlier screenplays; Daniel is not on screen yet (his name on a scene card doesn't count)
  assert.ok(t.endsWith("ALREADY INTRODUCED in earlier scenes: RAY MALLINDER, PRIYA BHANDARI — use the name only: no capitals-with-age introduction and no describing clause again. Anyone else is introduced the first time they appear here.\n"),t);
  assert.ok(!/slug|INT\. COMMUNAL/.test(t.split("HOW THE PREVIOUS")[1].split("PICK UP")[0]),"sluglines are left out of the ending");
});

await test("the edges: first scene, last scene, a neighbour that isn't written, a scene from another film",()=>{
  const first=brief(scenes[0],scenes,drafts,cast);
  assert.ok(first.startsWith("WHAT COMES NEXT (scene 2, “A Knock”): "));assert.ok(!/ALREADY ON SCREEN|ALREADY INTRODUCED|PICK UP/.test(first));
  const last=brief(scenes[4],scenes,drafts,cast);
  assert.ok(!/WHAT COMES NEXT/.test(last));
  assert.ok(/4\. Through the Slot — Priya offers to pay/.test(last));
  assert.ok(!/HOW THE PREVIOUS SCENE ENDS/.test(last),"scene 4 has no screenplay yet: its card is all there is");
  // a rough stand-in is not a screenplay: its lines are never quoted as how the scene ends, nor read for introductions
  box.isStandInDraft=d=>!!(d&&d.auto);
  const withStandIn={...drafts,s4:{auto:true,blocks:[A("PRIYA BHANDARI offers. DANIEL MALLINDER arrives.")]}};
  const t=brief(scenes[4],scenes,withStandIn,cast);
  assert.ok(!/HOW THE PREVIOUS SCENE ENDS/.test(t));assert.ok(!/DANIEL MALLINDER —|, DANIEL MALLINDER/.test(t));
  // a hand-added scene that isn't described yet is not announced as "what comes next"
  const plus=[...scenes,{id:"n1",no:6,title:"New Scene",summary:"A new scene — describe what happens here."}];
  assert.ok(!/WHAT COMES NEXT/.test(brief(plus[4],plus,drafts,cast)));
  assert.equal(brief({id:"zz"},scenes,drafts,cast),"");assert.equal(brief(scenes[0],[],drafts,cast),"");
});

await test("a long film: the nearest scenes keep their summaries, the oldest fall back to titles, under a cap",()=>{
  const many=Array.from({length:40},(_,i)=>S(i+1,"Title "+(i+1),("Event number "+(i+1)+" happens and it is described at some length here, ").repeat(3)));
  const t=brief(many[39],many,{},[]);
  const lines=t.split("\n").filter(l=>/^  \d+\. /.test(l));
  assert.equal(lines.length,39,"every earlier scene is listed");
  assert.ok(/^  39\. Title 39 — Event number 39/.test(lines[38])&&/^  30\. Title 30 — /.test(lines[29]),"the nearest keep their summary");
  assert.equal(lines[0],"  1. Title 1","the oldest are titles only");
  assert.ok(lines.join("\n").length<2400+39*16,"under the cap: "+lines.join("\n").length);
  assert.ok(lines.every(l=>l.length<=175));
});

await test("who counts as introduced: the name in capitals as a whole word (not a mention, not a scene heading)",()=>{
  const people=[{id:"a",name:"RAY MALLINDER"},{id:"b",name:"Inês Prata"},{id:"c",name:"ART"},{id:"d",name:"Will Okafor"},{id:"e",name:"MAY"}];
  const two=[S(1,"One","x"),S(2,"Two","y")];
  const seenIn=(blocks)=>{const t=brief(two[1],two,{s1:{ai:true,blocks}},people);const m=t.match(/ALREADY INTRODUCED in earlier scenes: (.*?) —/);return m?m[1]:"";};
  const seen=(text)=>seenIn([A(text)]);
  assert.equal(seen("RAY (late 60s) kneels. INÊS PRATA (40s) watches."),"RAY MALLINDER, INÊS PRATA");
  assert.equal(seenIn([C("ART (O.S.)"),L("Will you come? Maybe in May.")]),"ART","a cue is an appearance; words that only look like names are not");
  assert.equal(seen("AN ARRAY OF PARTS. THE PARTY STARTS. MAYBE."),"","a name inside another word is nobody");
  assert.equal(seenIn([C("PRIYA"),L("Ray fits all the locks himself. Will too.")]),"","a name that is only spoken has not appeared");
  assert.equal(seenIn([{type:"scene",text:"INT. RAY'S FLAT - DAY",beat:1},A("Empty.")]),"","nor one standing in a scene heading");
  assert.equal(seen("Nobody here."),"");
});

/* ---- the real calls ---- */
const beats={driverLabel:"RAY MALLINDER",reactorLabel:"PRIYA BHANDARI",desire:"to leave unseen",obstacle:"to pay her debt",result:"he waves it off",turnAt:1,
  rows:[{n:1,drive:{a:"Waves off",d:"Ray waves the money off."},react:{a:"Insists",d:"Priya holds the purse out."},charge:-2}]};
const project={title:"Without Force",format:"short",framework:"kishotenketsu",logline:"A retired locksmith opens his estranged son's door."};

await test("the scene author and the drafter carry it, built from the run's own drafts",async()=>{
  // the open film says nothing (a build's drafts are ahead of it): only the drafts handed in are read
  box.turnContinuity={scenes,drafts:{}};
  sent.length=0;reply="";
  await box.aiAuthorScene(scenes[3],scenes[2],cast,project,{scenes,drafts});
  assert.equal(sent.length,1);
  for(const s of ["ALREADY ON SCREEN (the scenes before this one","  PRIYA: Not a mark. What do I owe you?","WHAT COMES NEXT (scene 5, “Red String”)","ALREADY INTRODUCED in earlier scenes: RAY MALLINDER, PRIYA BHANDARI"])
    assert.ok(sent[0].includes(s),"author: "+s);
  // it sits between the old one-line hand-over and the scene's own card
  const at=(s)=>{const i=sent[0].indexOf(s);assert.ok(i>=0,s);return i;};
  assert.ok(at("Previous scene (3. No Mark) ended on")<at("ALREADY ON SCREEN")&&at("ALREADY INTRODUCED")<at('SCENE 4: "Through the Slot"'));
  sent.length=0;
  await box.aiDraftScene(scenes[3],beats,scenes[2],project,cast,scenes,{drafts});
  for(const s of ["HOW THE PREVIOUS SCENE ENDS (its last lines, already written):","  Ray, still on his knees, stares at the green coat on its hook.","That belongs to the NEXT scene: end this one before it"])
    assert.ok(sent[0].includes(s),"drafter: "+s);
  // without drafts handed in (the Draft button), the open film's are read
  box.turnContinuity={scenes,drafts};sent.length=0;
  await box.aiDraftScene(scenes[3],beats,scenes[2],project,cast,scenes);
  assert.ok(sent[0].includes("  PRIYA: Not a mark. What do I owe you?"));
});

await test("a redraft carries it too; the functions that only read a finished scene are left as they were",async()=>{
  box.turnContinuity={scenes,drafts};box.turnCast=cast;sent.length=0;reply="";
  try{await box.aiPolishScene(scenes[3],beats,[A("x")],scenes[2],project,{});}catch(e){}
  assert.ok(sent.length>=1&&sent[0].includes("ALREADY ON SCREEN (the scenes before this one"),"Redraft");
  sent.length=0;
  try{await box.aiSuggestTurn(scenes[3],scenes[2],project,{});}catch(e){}
  assert.ok(sent.length>=1&&!sent[0].includes("ALREADY ON SCREEN"),"the turn suggestion");
  sent.length=0;
  try{await box.aiBeatsFromScript(scenes[2],drafts.s3,cast,project);}catch(e){}
  assert.ok(sent.length>=1&&!sent[0].includes("ALREADY ON SCREEN"),"the beat map rebuilt from a script");
  const ai=read("app/ai.jsx");
  assert.equal(ai.split('if(drafts!==undefined && drafts!==null && drafts!==false && typeof window.sceneThreadBrief==="function") s += window.sceneThreadBrief(scene, order, drafts, crew);').length-1,1);
});

await test("the scene list is asked for one event per scene, in every structure",async()=>{
  for(const fw of ["threeact","kishotenketsu","herosjourney"]){
    sent.length=0;reply="";
    await box.aiBuildSpine("A retired locksmith opens his estranged son's door.","short",fw);
    assert.ok(sent.length>=1,fw);
    assert.ok(sent[0].includes("ONE EVENT PER SCENE: every scene is a DIFFERENT event that begins after the one before it ends — no two summaries describe the same action or moment (a door is opened once; a thing changes hands once; a secret is told once)."),fw);
  }
});

await test("the build hands its drafts over; Frances knows; the page is on the new key",()=>{
  const app=read("app/app.jsx"),html=read("TURN.html");
  assert.ok(app.includes("authorScene:(s,p)=>window.aiAuthorScene(s,p,model.characters,model.project,{scenes:model.scenes, drafts:model.drafts}),"));
  assert.ok(app.includes("draftScene:(s,b,p,o)=>window.aiDraftScene(s,b,p,model.project,model.characters,model.scenes,{ ...(o||{}), drafts:model.drafts }),"));
  const f=(box.APP_FEATURES||[]).find(x=>x&&x.name==="Scenes follow one another (what each scene is told when it is written)");
  assert.ok(f);
  for(const s of ["how the previous scene's screenplay actually ends","something that already happened is not played again","only the first time they appear in the film","one event per scene","press Redraft on it"]) assert.ok(f.what.includes(s),s);
  assert.ok(!/\bTURN\b|Claude|Anthropic|McKee/.test(f.what));
  for(const file of ["ai.jsx","script.jsx","app.jsx"])
    assert.ok(["20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log(`\n${checks} checks passed${failed?`, ${failed} FAILED`:""}`);
process.exit(failed?1:0);

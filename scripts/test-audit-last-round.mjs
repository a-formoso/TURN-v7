/* THE LAST ROUND OF THE WRITERS' ROOM AUDIT (owner 2026-11-12, B11, B16, D4). Runs the REAL app code (ai.jsx's
   scene-list builder and scene thread, agents.jsx's stage labels, frameworks.jsx's audit):
     B11 who drives the scenes is sized to the story and worded for its structure;
     B16 the clock runs forward in the scene list (and across its two halves), and a scene in the same place as the
         one before it is told not to describe the place again;
     D4  pinch points sit on the scenes the list was asked to write them in; a tiny Hero's Journey that came back a
         scene short keeps its stages; a Kishōtenketsu re-read scene only has to move.
   node scripts/test-audit-last-round.mjs */
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
  box.appToast=noop;box.aiAvailable=()=>true;box.turnIsAdmin=false;
  box.__prompts=[];box.__play=()=>"{}";
  box.claude={complete:async(o)=>{const p=o.messages.map(m=>m.content).join("\n");box.__prompts.push(p);const r=box.__play(p,box.__prompts.length);if(r instanceof Error)throw r;return r;}};
  return box;
};
const FULL="VARY THE DRIVER: protagonist drives most, but antagonist(s) and key supporting characters EACH drive several scenes. ";
const scene=(i,act,loc)=>({a:act,t:"Scene "+i,l:loc||"INT. ROOM - DAY",s:"event number "+i+" happens",d:"ana",vp:"Hope",vn:"Fear",oc:-1,cc:2,cl:2});
const isFirst=p=>!p.includes("THE FIRST HALF IS ALREADY WRITTEN");

/* ---------------------------------------------------------------- B11 */
await test("B11 · who drives: twelve scenes or more keep the sentence; fewer are asked for what fits",()=>{
  const box=makeBox(),R=box.spineDriverRule;
  const kisho=box.FRAMEWORKS.find(f=>f.id==="kishotenketsu"),hero=box.FRAMEWORKS.find(f=>f.id==="herosjourney");
  for(const n of [12,16,24,40]){assert.equal(R(n,null),FULL,"three-act "+n);assert.equal(R(n,hero),FULL,"hero "+n);}
  for(const n of [6,7,8,11]) assert.equal(R(n,null),"VARY THE DRIVER: protagonist drives most, but the antagonist and a key supporting character each drive at least one scene. ");
  for(const n of [1,3,4,5]){assert.ok(R(n,null).startsWith("DRIVERS: the protagonist drives most scenes; give a scene to another character only when the story turns on what THEY do"));assert.ok(!/several/.test(R(n,null)));}
  // Kishōtenketsu is never asked for an antagonist, at any size
  for(const n of [4,8,16,24]){const k=R(n,kisho);assert.ok(!/antagonist\(s\)|the antagonist and/.test(k),k);assert.ok(/needs no antagonist/.test(k));}
  assert.ok(R(16,kisho).includes("the other people in it EACH drive several scenes"));
  assert.ok(R(8,kisho).includes("the other people in it each drive at least one scene"));
  assert.ok(R(4,kisho).startsWith("DRIVERS: the story's central figure drives most scenes"));
  // every format gets one that fits its own scene count
  for(const f of box.FORMATS){const r=R(f.sceneTarget,null);assert.equal(/EACH drive several/.test(r),f.sceneTarget>=12,f.id+" ("+f.sceneTarget+" scenes)");}
});

await test("B11 · the real scene-list call: a Commercial is not asked for people who each drive several scenes",async()=>{
  const box=makeBox();
  const ask=async(fmtId,fwId)=>{box.__prompts.length=0;box.__play=()=>JSON.stringify({title:"T",scenes:[]});await box.aiBuildSpine("LOGLINE: x",fmtId,fwId);return box.__prompts[0];};
  const com=await ask("commercial","threeact");
  assert.ok(com.includes("DRIVERS: the protagonist drives most scenes;")&&!com.includes("EACH drive several scenes"));
  const film=await ask("film","threeact");
  assert.ok(film.includes(FULL));
  const micro=await ask("short","threeact");
  assert.ok(micro.includes("each drive at least one scene")&&!micro.includes("EACH drive several"));
  const kis=await ask("film","kishotenketsu");
  assert.ok(kis.includes("This structure needs no antagonist")&&!kis.includes("antagonist(s) and key supporting"));
  // exactly one driver rule per call
  for(const p of [com,film,micro,kis]) assert.equal((p.match(/VARY THE DRIVER:|DRIVERS: /g)||[]).length,1);
});

/* ---------------------------------------------------------------- B16 */
await test("B16 · the scene list: the clock runs forward, and the second half is told when and where the first half plays",async()=>{
  const box=makeBox();
  const times=["NIGHT","NIGHT","NIGHT","LATER","PRE-DAWN","PRE-DAWN","PRE-DAWN","PRE-DAWN"];
  box.__play=(p)=>isFirst(p)?JSON.stringify({title:"The Desk",scenes:times.map((t,i)=>scene(i+1,i<4?1:2,"INT. NEWSROOM - "+t))})
    :JSON.stringify({scenes:Array.from({length:8},(_,i)=>scene(9+i,i<4?2:3,"INT. NEWSROOM - DAWN"))});
  await box.aiBuildSpine("LOGLINE: a night editor holds a story.","film","threeact");
  assert.equal(box.__prompts.length,2);
  for(const p of box.__prompts) assert.ok(p.includes("TIME RUNS FORWARD: the time of day in each slugline follows the story's clock. From one scene to the next it holds or moves on (NIGHT, then PRE-DAWN, DAWN, MORNING, DAY, DUSK…); it never slips back to an earlier hour of the same day."));
  const second=box.__prompts[1];
  // each first-half scene with its slugline (it used to be title, summary and driver only)
  assert.ok(second.includes("8. [act 2] Scene 8 — event number 8 happens (driver: ana) · INT. NEWSROOM - PRE-DAWN"));
  assert.ok(second.includes("1. [act 1] Scene 1 — event number 1 happens (driver: ana) · INT. NEWSROOM - NIGHT"));
  assert.ok(second.includes("THE CLOCK CARRIES ON from where scene 8 stops: your first scene follows its time of day; it does not go back to an earlier hour of the same day."));
  assert.ok(!box.__prompts[0].includes("THE CLOCK CARRIES ON"));
});

await test("B16 · a scene in the same place as the one before it is told not to describe the place again",()=>{
  const box=makeBox();
  const scenes=[
    {id:"a",no:1,title:"The Desk",loc:"INT. NEWSROOM - NIGHT",summary:"She reads the wire."},
    {id:"b",no:2,title:"The Call",loc:"INT. NEWSROOM - NIGHT",summary:"The call comes."},
    {id:"c",no:3,title:"Later",loc:"INT. NEWSROOM – PRE-DAWN",summary:"She waits."},
    {id:"d",no:4,title:"Outside",loc:"EXT. LOADING BAY - DAWN",summary:"The vans leave."},
    {id:"e",no:5,title:"Back",loc:"INT. NEWS ROOM - DAY",summary:"She returns."}];
  const T=(i)=>box.sceneThreadBrief(scenes[i],scenes,{},[]);
  assert.ok(!T(0).includes("SAME PLACE"),"the first scene has nothing before it");
  assert.ok(T(1).includes("SAME PLACE AS THE PREVIOUS SCENE (NEWSROOM): the audience has just been here — do not describe the place again or re-open on the same picture of it. Open on what is DIFFERENT now (who is here, what has moved, what is being done).\n"));
  // the same place at another hour says the hours
  assert.ok(T(2).includes("SAME PLACE AS THE PREVIOUS SCENE (NEWSROOM)")&&T(2).includes("(it was NIGHT, it is now PRE-DAWN: the light, who is here, what has moved)"));
  // another place: nothing is said
  assert.ok(!T(3).includes("SAME PLACE"));assert.ok(!T(4).includes("SAME PLACE"),"NEWS ROOM after LOADING BAY");
  // it sits with the rest of the thread, before PICK UP AFTER IT
  assert.ok(T(1).indexOf("SAME PLACE AS THE PREVIOUS SCENE")<T(1).indexOf("PICK UP AFTER IT:"));
  // INT / EXT of the same place is still the same place; a card with no slugline says nothing
  const s2=[{id:"a",no:1,title:"A",loc:"EXT. PIER - DAY",summary:"x"},{id:"b",no:2,title:"B",loc:"INT. PIER - DAY",summary:"y"},{id:"c",no:3,title:"C",loc:"",summary:"z"}];
  assert.ok(box.sceneThreadBrief(s2[1],s2,{},[]).includes("SAME PLACE AS THE PREVIOUS SCENE (PIER)"));
  assert.ok(!box.sceneThreadBrief(s2[2],s2,{},[]).includes("SAME PLACE"));
});

/* ---------------------------------------------------------------- D4 */
const kinds=(box,fmt,fw,acts,extra)=>{
  box.turnProject={format:fmt,framework:fw};
  const scenes=acts.map((a,i)=>({id:"s"+i,no:i+1,act:a,title:"S"+(i+1),openCharge:-1,closeCharge:2,kind:"normal",...((extra&&extra[i])||{})}));
  box.assignPlotPoints(scenes);
  return Array.from(scenes.map(s=>s.kind));
};
const spread=(n)=>{const a1=Math.max(1,Math.round(n/4)),a3=a1;return Array.from({length:n},(_,i)=>i<a1?1:i<n-a3?2:3);};

await test("D4 · pinch points sit on the scenes the scene list was asked to write them in",()=>{
  const box=makeBox();
  const ai=read("app/ai.jsx");
  assert.ok(ai.includes("const pinchN = [Math.round(total*0.375), Math.round(total*0.625)];"),"the scene list's own numbers");
  const where=(n)=>{const k=kinds(box,n===12?"documentary":n===16?"film":n===24?"series":"feature","threeact",spread(n));return k.map((x,i)=>x==="pinch"?i+1:0).filter(Boolean);};
  // a 12-scene Documentary: 5 and 8 (the label used to sit on 4 and 7)
  assert.deepEqual(where(12),[Math.round(12*0.375),Math.round(12*0.625)]);assert.deepEqual(where(12),[5,8]);
  // the other formats were already right, and stay
  assert.deepEqual(where(16),[6,10]);assert.deepEqual(where(24),[9,15]);assert.deepEqual(where(40),[15,25]);
  // the big beats are untouched
  const doc=kinds(box,"documentary","threeact",spread(12));
  assert.equal(doc[0],"hook");assert.equal(doc[2],"act-climax");assert.equal(doc[5],"midpoint");assert.equal(doc[8],"act-climax");
  assert.deepEqual(doc.slice(9),["crisis","story-climax","resolution"]);
  // when the asked scene already has a job, the label falls back to the open stretch as before
  const moved=kinds(box,"documentary","threeact",[1,1,1,1,1,2,2,2,2,3,3,3]);
  assert.equal(moved.filter(x=>x==="pinch").length<=2,true);assert.notEqual(moved[4],"pinch","scene 5 is the Act I climax here");
  // fewer than ten scenes have none
  assert.ok(!kinds(box,"short","threeact",spread(8)).includes("pinch"));
});

await test("D4 · a four-scene Hero's Journey that came back with three keeps each scene on its own stage",()=>{
  const box=makeBox();
  // as planned: four scenes
  assert.deepEqual(kinds(box,"commercial","herosjourney",[1,1,2,3]),["ordinary-world","threshold","ordeal","elixir"]);
  // one short: the missing stage is the one left out (every label used to slide: threshold, ordeal, elixir)
  assert.deepEqual(kinds(box,"commercial","herosjourney",[1,2,3]),["ordinary-world","ordeal","elixir"]);
  assert.deepEqual(kinds(box,"commercial","herosjourney",[1,1,3]),["ordinary-world","threshold","elixir"]);
  assert.deepEqual(kinds(box,"commercial","herosjourney",[1,1,2]),["ordinary-world","threshold","ordeal"]);
  assert.deepEqual(kinds(box,"commercial","herosjourney",[2,3]),["ordeal","elixir"]);
  // acts that don't fit the table still get the next stage in order, never the same stage twice
  const odd=kinds(box,"commercial","herosjourney",[1,1,1]);
  assert.deepEqual(odd,["ordinary-world","threshold","ordeal"]);assert.equal(new Set(odd).size,3);
  // a format whose own plan has more than four scenes is untouched by this (it has no tiny table)
  const film=kinds(box,"film","herosjourney",[1,1,1,1,2,2,2,2,2,2,2,2,3,3,3,3]);
  assert.equal(film[0],"ordinary-world");assert.equal(film[15],"elixir");
  // and a three-scene format, if one existed, would use its own table exactly
  assert.deepEqual(Array.from(box.heroMiniStages(3).map(x=>x[0])),["threshold","ordeal","elixir"]);
});

await test("D4 · Kishōtenketsu: a re-read scene only has to move; the twist still has to reverse",()=>{
  const box=makeBox();
  const rule=box.FRAMEWORKS.find(f=>f.id==="kishotenketsu").audit.rule;
  const r=(s)=>JSON.parse(JSON.stringify(rule(s)));
  // a re-read scene drifting on one side: was flagged inert, now carries its movement
  assert.deepEqual(r({act:3,kind:"re-read",openCharge:1,closeCharge:2}),{turned:true,flagged:false,exempt:false,status:"turn"});
  assert.deepEqual(r({act:3,kind:"re-read",openCharge:-1,closeCharge:-2}),{turned:true,flagged:false,exempt:false,status:"turn"});
  // a re-read scene that does not move at all is still inert
  assert.deepEqual(r({act:3,kind:"re-read",openCharge:0,closeCharge:0}),{turned:false,flagged:true,exempt:false,status:"flat"});
  // the twist itself: a reversal passes, a drift on one side is flagged, a same-side jump is a progression
  assert.equal(r({act:3,kind:"ten",openCharge:2,closeCharge:-2}).status,"turn");
  assert.equal(r({act:3,kind:"ten",openCharge:1,closeCharge:2}).flagged,true);
  assert.equal(r({act:3,kind:"ten",openCharge:1,closeCharge:3}).status,"progression");
  // an act-3 scene with no stage of its own is held to the twist's rule, as before
  assert.equal(r({act:3,kind:"normal",openCharge:1,closeCharge:2}).flagged,true);
  // the other movements are unchanged
  assert.equal(r({act:1,kind:"plant",openCharge:0,closeCharge:1}).status,"turn");
  assert.equal(r({act:2,kind:"deepen",openCharge:0,closeCharge:0}).flagged,true);
  assert.equal(r({act:4,kind:"ketsu",openCharge:1,closeCharge:1}).exempt,true);
  // the audit's own words already said so
  assert.ok(read("app/frameworks.jsx").includes("only the ten has to reverse."));
});

await test("Frances knows, and the page is on the new key",()=>{
  const box=makeBox();
  const f=box.APP_FEATURES.find(x=>x&&String(x.name||"").startsWith("Scene list: who drives, the clock, and structure labels"));
  assert.ok(f);
  for(const part of ["WHO DRIVES THE SCENES IS SIZED TO THE STORY","never asked for an antagonist","THE CLOCK RUNS FORWARD","THE SAME PLACE IS NOT DESCRIBED TWICE","scenes 5 and 8","only the Twist itself has to reverse"]) assert.ok(f.what.includes(part),part);
  const html=read("TURN.html");
  for(const file of ["ai.jsx","script.jsx","agents.jsx","frameworks.jsx"])
    assert.ok(["20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log("\n"+(failed?"FAILED — "+failed+" of "+(checks+failed):"OK — "+checks+" checks passed"));
process.exit(failed?1:0);

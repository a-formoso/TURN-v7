#!/usr/bin/env node
import vm from "node:vm";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
const s={console};s.window=s;vm.createContext(s);
vm.runInContext(readFileSync("app/stage-plan.jsx","utf8"),s);
const shot=(id,beatN,dur=5)=>({id,sceneId:"scene",beatN,dur,action:"Action "+id});
let count=0;
function check(name,fn){try{fn();count++;}catch(e){console.error(name);throw e;}}
check("models both keep beat boundaries",()=>{
  for(const modelId of ["seedance-2.0","seedance-2.5"]){
    const groups=s.stagePlanClips([shot("a",1),shot("b",2)],{modelId});
    assert.equal(groups.length,2);
  }
});
check("split preserves every shot in order",()=>{
  const list=[shot("a",1,8),shot("b",1,8),shot("c",1,6)];
  const g=s.stagePlanClips(list,{modelId:"seedance-2.0"});
  assert.deepEqual(Array.from(g).flatMap(x=>Array.from(x.shots,sh=>sh.id)),["a","b","c"]);
  assert.equal(g.length,2);assert.equal(g[0].parts,2);assert.equal(g[1].part,2);
  assert.equal(g[1].dur,14);
});
check("2.5 fits content rather than filling thirty",()=>{
  const g=s.stagePlanClips([shot("a",1),shot("b",1)],{modelId:"seedance-2.5"});
  assert.equal(g.length,1);assert.equal(g[0].dur,10);
});
check("one micro only in selected shot",()=>{
  const sh={...shot("a",1),beatPlan:{micro:["Notice","Pick up","React"]},covers:[2]};
  const p=s.stageBuildTimedPlan([sh],{});
  assert.deepEqual(Array.from(p.units[0].micro),["Pick up"]);
  assert.equal(p.units[0].action,"Pick up");
});
check("single shot scope never merges",()=>{
  assert.equal(s.stagePlanClips([shot("a",1),shot("b",1)],{scope:"shot"}).length,2);
});
check("unassigned shots never become whole scene",()=>{
  assert.equal(s.stagePlanClips([shot("a",0),shot("b",0)],{}).length,2);
});
check("recorded audio cannot be clamped into ceiling",()=>{
  const a={...shot("a",1,5),dialogue:"A long line",lineAudio:{text:"A long line",durationMs:32000}};
  const g=s.stagePlanClips([a],{modelId:"seedance-2.5"});
  assert.equal(g[0].over,true);assert.ok(g[0].dur>30);
});
check("stale spoken recording blocks locked but not native",()=>{
  const a={...shot("a",1),dialogue:"New words",lineAudio:{text:"Old words",durationMs:2000}};
  assert.ok(s.stageBuildTimedPlan([a],{}).issues.some(i=>i.code==="stale-audio"&&i.blocking));
  assert.ok(!s.stageBuildTimedPlan([a],{audioMode:"native"}).issues.some(i=>i.code==="stale-audio"));
});
check("internal cuts may be shorter than four seconds",()=>{
  const p=s.stageBuildTimedPlan([shot("a",1,1),shot("b",1,2)],{});
  assert.equal(p.durationSec,4);assert.equal(p.units[0].end,1);assert.equal(p.units[1].end,4);
});
check("any length (2026-10-26): a shorter request paces the shots; a line too long for it still blocks",()=>{
  const p=s.stageBuildTimedPlan([shot("a",1,4),shot("b",1,6)],{durationSec:5});
  assert.equal(p.durationSec,5);assert.equal(p.paced,true);assert.equal(p.units[0].duration,2);assert.equal(p.units[1].duration,3);
  assert.ok(!p.issues.some(i=>i.blocking)&&p.issues.some(i=>i.code==="paced-to-duration"));
  const spoken={...shot("a",1,8),dialogue:"A line",lineAudio:{text:"A line",durationMs:6000}};
  assert.ok(s.stageBuildTimedPlan([spoken],{durationSec:4}).issues.some(i=>i.code==="duration-too-short"&&i.blocking));
});
check("longer request holds ending",()=>{
  const p=s.stageBuildTimedPlan([shot("a",1,5)],{durationSec:8});
  assert.equal(p.units[0].end,8);assert.equal(p.units[0].holdSec,3);
});
check("all planning is immutable",()=>{
  const shots=[shot("a",1),shot("b",1)];const original=JSON.stringify(shots);
  s.stagePlanClips(shots,{});s.stageBuildTimedPlan(shots,{});
  assert.equal(JSON.stringify(shots),original);
});
check("changed inputs change plan signature",()=>{
  const a=s.stageBuildTimedPlan([shot("a",1)],{});
  const b=s.stageBuildTimedPlan([{...shot("a",1),action:"Different"}],{});
  assert.notEqual(a.signature,b.signature);
});
check("invalid coverage is explicit",()=>{
  const p=s.stageBuildTimedPlan([{...shot("a",1),beatPlan:{micro:["One"]},covers:[2]}],{});
  assert.ok(p.issues.some(i=>i.code==="invalid-coverage"&&i.blocking));
});
console.log(`PASS Stage render planning: ${count} checks`);
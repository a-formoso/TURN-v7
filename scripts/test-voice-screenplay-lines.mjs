#!/usr/bin/env node
/* VOICING A LINE ONLY THE SCREENPLAY HOLDS (2026-10-26, live test film — owner: "I can't get past this"):
   1 "Voice clip now" failed with "We can't verify who speaks this line": the beat's lines were read without the cast,
     so the cue stayed "OTTAVIO" (no id) and didn't match "OTTAVIO SPADONI". stageBeatDialogueLines now reads them
     with the cast (the caller's, else the open film's) — the cue resolves to its character.
   2 then "its audio file is unavailable": the Stage loaded recordings only for shots whose own dialogue field had
     text; a designed shot's line lives only in the screenplay. A shot with a recording is loaded too. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={console,setTimeout,clearTimeout,requestAnimationFrame:noop,
  React:new Proxy({createElement:()=>null},{get:(o,k)=>o[k]||noop}),
  localStorage:{getItem:()=>null,setItem:noop},navigator:{},location:{},
  document:{createElement:()=>({}),addEventListener:noop,removeEventListener:noop,body:{appendChild:noop}},
  addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,CustomEvent:class{}};
box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/shot-screenplay.js","app/shot-scene-context.js","app/stage-screenplay.js","app/stage-plan.jsx","app/stage-references.jsx","app/stage-director-brief.js","app/stage.jsx"])
  vm.runInContext(readFileSync(f,"utf8"),box,{filename:f});
const stage=readFileSync("app/stage.jsx","utf8"), app=readFileSync("app/app.jsx","utf8"), bd=readFileSync("app/breakdown.jsx","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };
const scene={id:"s1",loc:"INT. FERRY - NIGHT"};
const characters=[{id:"ottavio",name:"OTTAVIO SPADONI"},{id:"aurelio",name:"AURELIO BASSI"}];
const drafts={s1:{version:1,blocks:[{beat:1,type:"scene",text:scene.loc},{beat:1,type:"action",text:"Aurelio Bassi punches tickets."},
  {beat:1,type:"char",text:"OTTAVIO"},{beat:1,type:"dia",text:"Last one, Bassi."}]}};
t("1 a cue resolves to its character with the cast — the caller's, else the open film's", ()=>{
  const withCast=box.stageBeatDialogueLines(scene,drafts,1,characters)[0];
  assert.equal(withCast.speakerId,"ottavio"); assert.equal(withCast.speaker,"OTTAVIO SPADONI");
  box.turnContinuity={characters};
  assert.equal(box.stageBeatDialogueLines(scene,drafts,1)[0].speakerId,"ottavio");
  assert.ok(app.includes("stageBeatDialogueLines(scene,drafts,shot.beatN,characters)"));
  assert.ok(bd.includes("stageBeatDialogueLines(scene, drafts||{}, n, C)"));
});
t("2 a shot with a recording has its audio loaded even when its own dialogue field is empty", ()=>{
  assert.ok(stage.includes('if(!String(sh.dialogue||"").trim() && !(sh.lineAudio && Number(sh.lineAudio.durationMs)>0)) continue;'));
});
console.log(pass+" passed, 0 failed");

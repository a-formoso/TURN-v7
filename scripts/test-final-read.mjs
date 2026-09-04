#!/usr/bin/env node
/* Functional final-read contract tests against the minified production build. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
let captured="";
const box={
  console,setTimeout,clearTimeout,setInterval,clearInterval,
  React:new Proxy({}, {get:(t,k)=>k==="createElement"?()=>null:noop}),
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  navigator:{userAgent:"node-test"},location:{href:"",search:"",hash:"",origin:""},
  CustomEvent:class{},Image:class{},
  document:{createElement:()=>({getContext:()=>null,style:{}}),getElementById:()=>null,addEventListener:noop,removeEventListener:noop,body:{}},
  addEventListener:noop,removeEventListener:noop,requestAnimationFrame:noop,cancelAnimationFrame:noop,
  chargeStr:n=>String(n),
  claude:{complete:async({messages})=>{
    captured=messages[0].content;
    return JSON.stringify({
      pacing:"Pace reads clearly.",tone:"Tone holds.",voice:"Voices separate.",
      visual:"Images tell the scene.",sound:"Sound carries suspense.",rhythm:"White space accelerates the turn.",
      causality:"Lines provoke behavior.",theme:"The choice resolves in action.",
      notes:[{scene:2,lens:"causality",issue:"The reply does not provoke the exit.",fixAt:"design"}]
    });
  }}
};
box.window=box;box.globalThis=box;box.turnCast=[];
vm.createContext(box);
vm.runInContext(readFileSync("dist/app/ai.js","utf8"),box,{filename:"dist/app/ai.js"});
let pass=0,fail=0;
const ok=(n,v)=>{if(v)pass++;else{fail++;console.log("FAIL "+n);}};
const scenes=[{id:"s1",no:2,title:"Choice",openCharge:-1,closeCharge:1}];
const drafts={s1:{blocks:[
  {type:"scene",text:"INT. KITCHEN - NIGHT"},
  {type:"action",text:"Mara closes the door."},
  {type:"char",text:"MARA"},{type:"dia",text:"Now."}
]}};
const r=await box.aiTableRead(scenes,drafts,{title:"Test Film"});
ok("returns all final-read lenses",["visual","sound","rhythm","causality","theme"].every(k=>r[k]));
ok("preserves note lens",r.notes[0].lens==="causality");
ok("preserves design-vs-lines diagnosis",r.notes[0].fixAt==="design");
ok("prompt includes production heading",captured.includes("INT. KITCHEN - NIGHT"));
ok("prompt includes measured page rhythm",captured.includes("MEASURED PAGE-RHYTHM FACTS")&&captured.includes("action paragraphs"));
ok("prompt judges finished page not metadata",captured.includes("judge ONLY what the finished screenplay actually puts on the page"));
ok("prompt covers action/dialogue causality",captured.includes("ACTION/DIALOGUE CAUSALITY"));
ok("prompt covers thematic payoff",captured.includes("THEMATIC PAYOFF"));

// A long script must still deliver its ending/climax, never a head-only slice.
captured="";
const longScenes=[], longDrafts={};
for(let i=1;i<=16;i++){
  const id="long"+i; longScenes.push({id,no:i,title:"Metadata title "+i,openCharge:-3,closeCharge:3});
  longDrafts[id]={blocks:[
    {type:"scene",text:"INT. ROOM "+i+" - NIGHT"},
    {type:"action",text:("middle action "+i+" ").repeat(260)},
    {type:"action",text:i===16?"FINAL CLIMAX CHOICE LANDS IN IMAGE AND SOUND.":"Scene "+i+" ending image."}
  ]};
}
await box.aiTableRead(longScenes,longDrafts,{title:"Long Film"});
ok("long-script prompt retains final scene",captured.includes("[SCENE 16]"));
ok("long-script prompt retains final climax",captured.includes("FINAL CLIMAX CHOICE LANDS IN IMAGE AND SOUND."));
ok("shortening is disclosed",captured.includes("middle of this scene omitted for context budget"));
ok("development charge values stay out of screenplay input",!captured.includes("(-3")&&!captured.includes("→3"));

// Large-but-supported scene counts must stay strictly within the screenplay cap.
captured=""; const manyScenes=[],manyDrafts={};
for(let i=1;i<=150;i++){
  const id="many"+i; manyScenes.push({id,no:i});
  manyDrafts[id]={blocks:[{type:"scene",text:"INT. SPACE "+i+" - DAY"},{type:"action",text:("movement "+i+" ").repeat(600)}]};
}
await box.aiTableRead(manyScenes,manyDrafts,{title:"Large Film"});
const scriptPayload=(captured.split("SCRIPT (every drafted scene represented; any shortened middle is explicitly marked):\n")[1]||"");
ok("large screenplay payload obeys strict 28k cap",scriptPayload.length<=28000,String(scriptPayload.length));
ok("large screenplay still includes first and final scene",scriptPayload.includes("[SCENE 1]")&&scriptPayload.includes("[SCENE 150]"));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
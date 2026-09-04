#!/usr/bin/env node
/* Deterministic screenplay-grammar tests. Run after npm run build. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const React=new Proxy({}, {get:(t,k)=>k==="createElement"?()=>null:(k==="useState"?x=>[typeof x==="function"?x():x,noop]:k==="useRef"?x=>({current:x}):k==="useMemo"?f=>f():k==="useEffect"?noop:noop)});
const box={console,React,Icon:new Proxy({}, {get:()=>noop}),localStorage:{getItem:()=>null,setItem:noop},
  document:{querySelector:()=>null},setTimeout,clearTimeout};
box.window=box; box.globalThis=box;
vm.createContext(box);
vm.runInContext(readFileSync("dist/app/locations.js","utf8"),box,{filename:"dist/app/locations.js"});
vm.runInContext(readFileSync("dist/app/script.js","utf8"),box,{filename:"dist/app/script.js"});

const report=box.screenplayFormatReport;
if(typeof report!=="function"){ console.log("FAIL screenplayFormatReport missing"); process.exit(1); }
let pass=0, fail=0;
const ok=(name,v,detail)=>{ if(v) pass++; else{ fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const scene={id:"s1",no:4,title:"The Choice",loc:"INT. KITCHEN - DAY"};
const beats={rows:[{n:1},{n:2}]};

const clean={blocks:[
  {beat:1,type:"scene",text:"INT. KITCHEN - DAY"},
  {beat:1,type:"action",text:"Mara sets down the glass."},
  {beat:1,type:"char",text:"MARA"},
  {beat:1,type:"paren",text:"quietly"},
  {beat:1,type:"dia",text:"You already know."},
  {beat:2,type:"scene",text:"EXT. FIRE ESCAPE - NIGHT"},
  {beat:2,type:"action",text:"Jon waits in the rain."},
]};
const snapshot=JSON.stringify(clean);
let r=report(scene,clean,beats);
ok("two headings are two production units",r.stats.productionUnits===2,JSON.stringify(r.stats));
ok("valid cue-parenthetical-dialogue is clean",!r.issues.some(x=>/dialogue|parenthetical|cue/.test(x.code)),JSON.stringify(r.issues));
ok("valid screenplay has no errors",r.stats.errors===0,JSON.stringify(r.issues));
ok("report does not mutate input",JSON.stringify(clean)===snapshot);

r=report(scene,{blocks:[
  {beat:1,type:"scene",text:"INT. KITCHEN - DAY"},
  {beat:1,type:"scene",text:"INTERCUT WITH:"},
  {beat:1,type:"action",text:"The two calls overlap."},
]},beats);
ok("INTERCUT is not a production unit",r.stats.productionUnits===1,JSON.stringify(r.units));

r=report(scene,{blocks:[
  {beat:1,type:"scene",text:"Kitchen somewhere"},
  {beat:9,type:"dia",text:"No cue."},
  {beat:1,type:"paren",text:"alone"},
  {beat:2,type:"char",text:"MARA"},
  {beat:2,type:"action",text:"She leaves."},
]},beats);
const codes=new Set(r.issues.map(x=>x.code));
["bad-slugline","orphan-dialogue","orphan-parenthetical","cue-without-dialogue","unknown-beat","missing-heading"].forEach(c=>
  ok("flags "+c,codes.has(c),JSON.stringify([...codes])));

r=report(scene,{blocks:[
  {beat:1,type:"scene",text:"int. kitchen - day"},
  {beat:1,type:"action",text:"MARA: \"Stop.\""},
]},beats);
ok("lowercase slugline warning",r.issues.some(x=>x.code==="slugline-case"));
ok("dialogue buried in action warning",r.issues.some(x=>x.code==="dialogue-in-action"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
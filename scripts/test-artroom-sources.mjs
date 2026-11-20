#!/usr/bin/env node
/* Trustworthy prop-origin and screenplay-source regressions against source code. */
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync("app/props.jsx","utf8");
const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,
  window:null,globalThis:null,
  document:{body:{},createElement:()=>({}),addEventListener:noop},
  React:{createElement:noop,useState:()=>[null,noop],useEffect:noop,useMemo:f=>f(),useRef:()=>({current:null})},
};
box.window=box;
box.globalThis=box;
vm.createContext(box);
vm.runInContext(source,box,{filename:"app/props.jsx"});

let pass=0,fail=0;
const ok=(name,value,detail)=>{
  if(value) pass++;
  else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); }
};

const label=box.propOriginLabel;
const mentions=box.propScreenplayMentions;
const fromCast=box.propsFromCast;
ok("source helpers exported",typeof label==="function"&&typeof mentions==="function"&&typeof fromCast==="function");

ok("explicit screenplay origin is truthful",label({origin:{kind:"screenplay"}})==="Screenplay-derived extraction");
ok("unknown origin makes no extraction claim",label({name:"Key"}).toLowerCase().includes("not recorded"));
ok("legacy manual origin remains reliable",label({manual:true})==="Added manually in Props");
ok("legacy cast origin does not invent a department",
  label({fromCast:true,kind:"worn",ownerName:"Mara"})==="Department design proposal from Mara's character brief");

const seeded=fromCast([{id:"c1",name:"Mara",accessories:"silver necklace",props:"brass key"}],[]);
const necklace=seeded.find(p=>p.name.toLowerCase().includes("necklace"));
const key=seeded.find(p=>p.name.toLowerCase().includes("key"));
ok("accessory seed records costume origin",necklace?.origin?.kind==="costume",JSON.stringify(necklace));
ok("carried seed records props origin",key?.origin?.kind==="props",JSON.stringify(key));
ok("cast seeds never claim screenplay origin",seeded.every(p=>p.origin?.kind!=="screenplay"));

const longPrefix="A quiet corridor stretches on. ".repeat(12);
const fullText=longPrefix+"Mara lifts the brass key from the table, then leaves.";
const scenes=[{id:"s1",no:1,title:"Hall"}];
const drafts={s1:{blocks:[{type:"action",beat:"b7",text:fullText}]}};
const exact=mentions({name:"Brass key"},scenes,drafts)[0];
ok("full source text is preserved",exact?.fullText===fullText);
ok("excerpt is centered near the match",exact?.text.includes("brass key")&&!exact.text.startsWith("A quiet corridor"));
ok("match offsets identify the displayed phrase",
  exact?.fullText.slice(exact.matchStart,exact.matchEnd)==="brass key",JSON.stringify(exact));
const spacedText="\n  Mara lifts the brass key.\n";
ok("full text preserves source whitespace",
  mentions({name:"Brass key"},scenes,{s1:{blocks:[{type:"action",text:spacedText}]}})[0]?.fullText===spacedText);

const plural=mentions({name:"Brass key"},scenes,{
  s1:{blocks:[{type:"action",text:"A ring of keys hangs beside the door."}]}
})[0];
ok("plural noun is cautious discovery",plural?.match==="possible",JSON.stringify(plural));
ok("lexical discovery does not alter recorded origin",
  label({name:"Brass key",origin:{kind:"manual"}})==="Added manually in Props");

const manyScenes=Array.from({length:7},(_,i)=>({id:"m"+i,no:i+1,title:"Scene "+(i+1)}));
const manyDrafts=Object.fromEntries(manyScenes.map(s=>[s.id,{blocks:[{type:"action",text:"Mara pockets the brass key."}]}]));
ok("more than five source entries remain available",mentions({name:"Brass key"},manyScenes,manyDrafts).length===7);
ok("evidence UI does not truncate source rows",
  source.includes("screenplayMentions.map((m,i)")&&!source.includes("screenplayMentions.slice(0,5)"));
ok("source navigation is separate from scene filtering",
  // (2026-11-20) the passages are small buttons with ONE passage shown: its "Go to the scene" opens that passage
  source.includes("role:\"prop-evi-matches\", onOpen:onSourceClick,")&&source.includes("tone: m.match===\"exact\" ? \"exact\" : \"possible\", target:m,")
    &&source.includes("onClick:()=>onOpen(it.target)},\"Go to the scene\")")&&source.includes("onChipClick:(sid)=>setSceneFilter(sid),onSourceClick"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
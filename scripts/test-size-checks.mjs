#!/usr/bin/env node
/* SIZE CHECKS (owner-approved 2026-10-28, scale plan step 4): the scale sheet shows the character beside familiar objects
   at their real sizes (chosen to suit the character's size), and the QA check reads true sizes — everyone in a shot frame
   (when it matters) and the scale sheet's character and objects — and flags a clear size error as "Size:".
   Run: node scripts/test-size-checks.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=(f)=>readFileSync(new URL("../"+f, import.meta.url),"utf8");
const shots=read("app/shots.jsx"), shotsUi=read("app/shots-ui.jsx"), art=read("app/artroom.jsx"), ai=read("app/ai.jsx");
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const slice=(src,a,b)=>{ const i=src.indexOf(a), j=src.indexOf(b,i+a.length); if(i<0||j<0) throw new Error("missing "+a); return src.slice(i,j); };
const box={ console }; box.window=box; vm.createContext(box);
// the window exports in these slices name helpers this test doesn't load: stub each one it meets
const SRC=[
  slice(shots,"const SCALE_CLASSES","function scaleInfoOf("),
  "function scaleInfoOf(entity){ return SCALE_CLASSES[scaleClassOf(entity)] || SCALE_CLASSES.A; }",
  slice(shots,"/* POINT OF VIEW, LENS AND PHYSICS","/* HEIGHT-AWARE measurement ruler"),
  slice(shots,"function heightMMOf(","window.buildScaleSheetPrompt")].join("\n").replace(/^const /gm,"var ");
for(let i=0;i<20;i++){ try{ vm.runInContext(SRC, box); break; }catch(e){ const m=/^(\w+) is not defined/.exec(e.message); if(!m) throw e; box[m[1]]=()=>""; } }

const names=(mm)=>box.scaleKnownObjects(mm).map(o=>o.name);
const firefly={id:"ff",name:"Lumi",height:"15 mm long",coreBody:"a small firefly"}, frog={id:"fr",name:"Old Croak",height:"8 cm long"},
  man={id:"m",name:"Aurelio",height:"178 cm",coreBody:"a tall man"}, girl={id:"g",name:"Nives",height:"142 cm"},
  woman={id:"w",name:"Mara",height:"175 cm"}, giant={id:"gi",name:"Titan",height:"40 m tall",coreBody:"a stone giant"}, mite={id:"mi",name:"Speck",height:"200 µm"};

ok("a firefly stands beside a coin and a grain of rice", JSON.stringify(names(15))===JSON.stringify(["a coin","a grain of rice"]), names(15).join());
ok("a person beside a door, a chair seat and a hand", JSON.stringify(names(1780))===JSON.stringify(["a standard door","a chair seat","an adult's hand"]), names(1780).join());
ok("a giant beside a building, a house and a bus", JSON.stringify(names(40000))===JSON.stringify(["a ten-storey building","a two-storey house","a single-decker bus"]), names(40000).join());
ok("a mite beside things of its own world", names(0.2).includes("a grain of fine sand") && names(0.2).every(n=>!/coin|door/.test(n)), names(0.2).join());
ok("nothing without a size", names(0).length===0);
let p=box.buildScaleSheetPrompt(firefly);
ok("the scale sheet prompt draws them at their real sizes, unlabelled", /beside the figure, plain and unlabelled, drawn at their exact real sizes against the same ruler: a coin 24 mm across, a grain of rice 6 mm long\./.test(p) && /No text anywhere except the ruler's numeric markings/.test(p), p);
ok("a size that says 'long' isn't also called 'tall'", /The figure is 15 mm long\. /.test(p) && /The figure is 178 cm tall\. /.test(box.buildScaleSheetPrompt(man)), p);
p=box.buildScaleSheetPrompt(giant);
ok("…a giant's too", /a ten-storey building 30 m tall, a two-storey house 7 m tall, a single-decker bus 3 m tall/.test(p), p);

ok("same-size human casts give the QA no size list", box.qaTrueSizes([man,woman]).length===0);
let q=box.qaTrueSizes([man,girl]);
ok("a man and a girl of clearly different heights do", q.length===2 && q[0].name==="Nives" && q[1].name==="Aurelio", JSON.stringify(q));
q=box.qaTrueSizes([frog,firefly]);
ok("a frog and a firefly: smallest first, with sizes in words", q[0].name==="Lumi" && q[0].size==="15 mm" && q[1].size==="80 mm", JSON.stringify(q));
ok("a lone firefly still gets checked", box.qaTrueSizes([firefly]).length===1 && box.qaTrueSizes([mite]).length===1);

ok("the QA read is told the sizes and how to report them", ai.includes("const sizes = (Array.isArray(item.sizes) ? item.sizes : []).filter(x=>x && x.name && x.size).slice(0,10);")
  && ai.includes("TRUE SIZES (binding, part of the contract)") && ai.includes("is a MAJOR deviation whose 'what' starts with 'Size:'") && /\\u00d7 the smallest/.test(ai));
ok("the QA button passes them", art.includes("function QaCheckButton({ gen, name, noun, className, specFields, onApplySpec, showWhenEmpty, script, sizes }){")
  && art.includes("...(sz.length ? { sizes:sz } : {})"));
ok("shot frames send who is in frame", shotsUi.includes('sizes:()=> (typeof qaTrueSizes==="function") ? qaTrueSizes(subjects) : [],'));
ok("scale sheets send the character and only the objects their prompt drew", art.includes('.filter(o=>String(contract||"").indexOf(o.name+" "+o.size)>=0);'));
ok("Frances knows", /SIZE CHECKS \(2026-10-28\)/.test(ai));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

#!/usr/bin/env node
/* TRUE SIZES (owner-approved 2026-10-28, "go ahead with step 1" of the scale plan): every character, creature, prop and
   key location feature has a real size with its unit; the scale class is worked out from it; prompts say how they
   compare; the story build writes each cast member's size.
   Run: node scripts/test-true-sizes.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=(f)=>readFileSync(new URL("../"+f, import.meta.url),"utf8");
const shots=read("app/shots.jsx"), art=read("app/artroom.jsx"), stage=read("app/stage.jsx"), brief=read("app/stage-director-brief.js"),
  ai=read("app/ai.jsx"), agents=read("app/agents.jsx"), loc=read("app/locations.jsx"), locUi=read("app/locations-ui.jsx"), doc=read("docs/Story Pipeline.md");
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const slice=(src,a,b)=>{ const i=src.indexOf(a), j=src.indexOf(b,i+a.length); if(i<0||j<0) throw new Error("missing "+a); return src.slice(i,j); };

const box={ console }; box.window=box; vm.createContext(box);
vm.runInContext(slice(shots,"function trueSizeMM(","/* the scale class of an entity")+"\n"+slice(shots,"function scaleClassOf(","function scaleInfoOf("), box);
const T=box.trueSizeMM;
ok("a size with its unit, in millimetres (metric, imperial, micro)",
  T("175 cm tall")===1750 && T("15 mm long")===15 && T("40 m tall")===40000 && T("5 ft 10 in")===1778 && T("200 µm")===0.2 && T("about 2 cm")===20 && T("3 inches")===76.2);
ok("…and nothing from a bare number", T("175")===0 && T("")===0 && T("tall")===0);
ok("the scale class is worked out from the size", box.scaleClassFromMM(0.2)==="D" && box.scaleClassFromMM(15)==="B" && box.scaleClassFromMM(1750)==="A" && box.scaleClassFromMM(40000)==="C");
ok("the size wins over a class picked by hand; without a unit the picked class stands",
  box.scaleClassOf({height:"15 mm long", scaleClass:"Class A · Human"})==="B" && box.scaleClassOf({height:"40 m tall", scaleClass:"B"})==="C"
  && box.scaleClassOf({height:"", scaleClass:"Class B · Critter"})==="B" && box.scaleClassOf({size:"8 cm long"})==="B");
ok("the character card: 'Size', and the scale shown from it (the menu only without a unit)",
  art.includes('Row("Size",c.height||v.height,') && art.includes('"data-testid":"char-scale-derived"') && art.includes('+" \\u00b7 from its size ("'));
ok("a non-human character with no size gets no invented human height", art.includes('height: c.height || (cls==="A" ? "approx. 175 cm" : ""),'));
// the Stage's comparisons
{
  const b={ console }; b.window=b; vm.createContext(b);
  vm.runInContext(read("app/stage-director-brief.js"), b);
  const ok2 = /HOW THEY COMPARE/.test(brief) && brief.includes('compareLines.push(text(a.name)+" is about "+times(r)+"\\u00d7 the size of "+text(b.name)+".");');
  ok("the Stage's TRUE SIZES say how many times bigger each is than the next, and the largest against the smallest", ok2
    && stage.includes('mm:_mm(h)') && stage.includes('mm:_mm(z)'));
}
ok("places: 'Sizes of key features', drafted, and sent with every plate (a room's own, else its place's)",
  locUi.includes('field:"keySizes",label:"Sizes of key features"') && ai.includes('keySizes = the REAL sizes of the place') && ai.includes('"significance":"...","keySizes":"...","style":"..."}')
  && (loc.match(/true_sizes: locationTrueSizesFor\(l\)/g)||[]).length===3 && loc.includes("const parent = (typeof locationParentOf===\"function\") ? locationParentOf(l) : null;"));
ok("the story build asks each cast member's true size and keeps it only with a unit",
  ai.includes('"SIZE \\u2014 give every cast member their TRUE SIZE with its unit') && ai.includes('"age":"early 30s","size":"175 cm tall","voice"')
  && ai.includes('window.trueSizeMM(sizeText)>0) ? sizeText : ""') && agents.includes('...(c.height ? { height:c.height, heightProvenance:"story" } : {}),'));
ok("the look drafter keeps a size the card already has", ai.includes('character && window.trueSizeMM(character.height)>0) ? String(character.height).slice(0,40)'));
ok("the pipeline doc records the approved step", /Cast true size\*\* \*\(approved 2026-10-28 by owner/.test(doc));
ok("Frances knows", /True sizes: characters, creatures, props and places at their real scale/.test(ai));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

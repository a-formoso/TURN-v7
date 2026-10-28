#!/usr/bin/env node
/* POINT OF VIEW, LENS AND PHYSICS (owner-approved 2026-10-28, scale plan step 2): whose eyes the camera has (the shot's
   chosen point of view, else the smallest in frame when the frame isn't all human-sized), the camera and optics at that
   size, and how things move at the sizes in frame — in shot frames and Stage clips; nothing for an all-human frame.
   Run: node scripts/test-scale-pov.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=(f)=>readFileSync(new URL("../"+f, import.meta.url),"utf8");
const shots=read("app/shots.jsx"), shotsUi=read("app/shots-ui.jsx"), stage=read("app/stage.jsx"), brief=read("app/stage-director-brief.js"), ai=read("app/ai.jsx");
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const slice=(src,a,b)=>{ const i=src.indexOf(a), j=src.indexOf(b,i+a.length); if(i<0||j<0) throw new Error("missing "+a); return src.slice(i,j); };
const box={ console }; box.window=box; vm.createContext(box);
vm.runInContext([
  slice(shots,"function trueSizeMM(","function scaleInfoOf("),
  slice(shots,"/* POINT OF VIEW, LENS AND PHYSICS","/* HEIGHT-AWARE measurement ruler"),
  slice(shots,"function heightMMOf(","function scaleRulerFor(")].join("\n"), box);

const firefly={id:"ff",name:"Lumi",height:"15 mm long"}, frog={id:"fr",name:"Old Croak",height:"8 cm long"},
  girl={id:"g",name:"Nives",height:"142 cm"}, man={id:"m",name:"Aurelio",height:"178 cm"}, giant={id:"gi",name:"Titan",height:"40 m tall"}, mite={id:"mi",name:"Speck",height:"200 µm"};

ok("an all-human frame adds nothing", box.shotScalePovClause({}, [girl,man], [girl,man])==="");
let t=box.shotScalePovClause({}, [firefly,frog], [firefly,frog]);
ok("a firefly and a frog: seen from the firefly (the smallest), at its eye level, with a macro lens", /seen from Lumi's size \(15 mm\)/.test(t) && /about 14 mm above the surface/.test(t) && /macro or probe lens/.test(t), t);
ok("…and the physics at each size: surface tension and raindrops for the firefly, quick darting for the frog", /surface tension rules: a raindrop is a heavy wobbling sphere that can knock Lumi down/.test(t) && /At Old Croak's size movement is quick and darting/.test(t), t);
t=box.shotScalePovClause({povCharacterId:"fr"}, [firefly,frog], [firefly,frog]);
ok("a chosen point of view wins (the frog's)", /seen from Old Croak's size \(80 mm\)/.test(t) && /camera is low, at Old Croak's eye level/.test(t), t);
t=box.shotScalePovClause({}, [man,giant], [man,giant]);
ok("a man and a giant: seen from the man — no special camera — but the giant moves slow and heavy",
  !/camera is at/.test(t) && /At Titan's size movement is slow and heavy/.test(t), t);
t=box.shotScalePovClause({povCharacterId:"gi"}, [man,giant], [man,giant]);
ok("from the giant's eyes: high, long lenses, haze, never tilt-shift", /about 36 m up: long lenses/.test(t) && /never the tilt-shift miniature look/.test(t), t);
t=box.shotScalePovClause({}, [mite], [mite]);
ok("a microscopic subject: microscope optics and viscous water", /optics like a microscope/.test(t) && /water is thick and sticky/.test(t), t);
ok("a subject with no size adds no physics", box.scalePhysicsText([{name:"Mystery"}])==="");
ok("shot frames carry it", shots.includes("const _povScale = (typeof shotScalePovClause===\"function\") ? shotScalePovClause(sh, subjects, _chars) : \"\";"));
ok("Stage clips carry it as POINT OF VIEW AND SCALE", stage.includes("window.shotScalePovClause(shots[0]||{}, _castFull,") && brief.includes('section("POINT OF VIEW AND SCALE",[text(d.scalePov)])'));
ok("the shot card's Point of view picker, only in a film that isn't all human-sized",
  shotsUi.includes('"data-testid":"shot-pov-pick"') && shotsUi.includes('const mixed = typeof scaleClassOf==="function" && cast.some(c=>scaleClassOf(c)!=="A");') && shotsUi.includes('"Automatic \\u2014 the smallest in frame"'));
ok("Frances knows", /POINT OF VIEW, LENS AND PHYSICS \(2026-10-28/.test(ai));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

#!/usr/bin/env node
/* DRAWN AT (owner-approved 2026-10-28, scale plan step 3): a place is drawn from the eye level of whoever is in it.
   Each scene's point of view is its smallest character when the cast isn't all human-sized (a giant among people sees
   from up there); a plate takes the point of view most of its scenes share, so a firefly's forest is drawn at the
   firefly's eye level while the human scenes in that forest get human-scale room & time plates. The card's "Drawn at"
   choice overrides it, and every plate records the eye level it was drawn at.
   Run: node scripts/test-location-drawn-at.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read=(f)=>readFileSync(new URL("../"+f, import.meta.url),"utf8");
const shots=read("app/shots.jsx"), locs=read("app/locations.jsx"), ui=read("app/locations-ui.jsx"), ai=read("app/ai.jsx");
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const slice=(src,a,b)=>{ const i=src.indexOf(a), j=src.indexOf(b,i+a.length); if(i<0||j<0) throw new Error("missing "+a); return src.slice(i,j); };
const box={ console }; box.window=box; vm.createContext(box);
vm.runInContext([
  slice(shots,"const SCALE_CLASSES","function scaleInfoOf("),
  slice(shots,"/* POINT OF VIEW, LENS AND PHYSICS","/* HEIGHT-AWARE measurement ruler"),
  slice(shots,"function heightMMOf(","function scaleRulerFor("),
  slice(shots,"function worldScaleClause(","window.SCALE_CLASSES"),
  slice(locs,"/* DRAWN AT (scale plan step 3","/* deterministic LOCATION coverage plate")].join("\n"), box);
// the scene roster: the scene's own cast list here
box.sceneRoster=(sc)=>sc.cast||[];
box.locationKeyOf=(l)=>l.key||l.id;
box.locationParentOf=(l)=>l.parentId ? (box.turnContinuity.locations||[]).find(x=>x.id===l.parentId) : null;

const firefly={id:"ff",name:"Lumi",height:"15 mm long"}, girl={id:"g",name:"Nives",height:"142 cm"},
  man={id:"m",name:"Aurelio",height:"178 cm"}, giant={id:"gi",name:"Titan",height:"40 m tall"};
const scenes=[
  {id:"s1",no:1,cast:["ff"]},{id:"s2",no:2,cast:["ff","g"]},{id:"s3",no:3,cast:["g","m"]},
  {id:"s4",no:4,cast:["m","gi"]},{id:"s5",no:5,cast:["m"]},{id:"s6",no:6,cast:["ff"]}];
const forest={id:"L1",name:"Forest",scenes:["s1","s2","s3","s6"]};
const glade={id:"L2",name:"Glade",parentId:"L1",scenes:["s3"]};
const town={id:"L3",name:"Town",scenes:["s4","s5"]};
box.turnContinuity={ characters:[firefly,girl,man,giant], scenes, shots:[], drafts:{}, locations:[forest,glade,town] };

ok("a scene with a firefly and a girl is seen from the firefly", box.locationScenePov(scenes[1], box.turnContinuity)===firefly);
ok("an all-human scene has no special point of view", box.locationScenePov(scenes[2], box.turnContinuity)===null);
ok("a giant among people sees from up there", box.locationScenePov(scenes[3], box.turnContinuity)===giant);
ok("the forest (3 firefly scenes, 1 human) is drawn at the firefly's eye level", box.locationDrawnAtEntity(forest)===firefly);
ok("its all-human scenes get a human-scale room & time plate", box.locationDrawnAtEntity(forest,{sceneNos:[3]})===null);
ok("…and its firefly scenes a firefly-scale one", box.locationDrawnAtEntity(forest,{sceneNos:[1,6]})===firefly);
ok("a tie between a giant scene and a human scene goes to the giant", box.locationDrawnAtEntity(town)===giant);
let t=box.locationDrawnAtClause(firefly);
ok("the plate's words: the firefly's eye level, a macro lens, grass like trees — and nobody shown, no name",
  /DRAWN AT THE EYE LEVEL OF A 15 MM-TALL INHABITANT \(nobody is shown\)/.test(t) && /about 14 mm above the surface/.test(t)
  && /grass blades, leaves and stems rising like walls and trees/.test(t) && /CRITTER SCALE/.test(t) && !/Lumi/.test(t), t);
ok("a human-sized point of view adds nothing", box.locationDrawnAtClause(man)==="" && box.locationDrawnAtClause(null)==="");
forest.drawnAt="human";
ok("the card's choice wins: Human eye level", box.locationDrawnAtEntity(forest)===null);
ok("a room follows its place's choice", box.locationDrawnAtEntity(glade)===null);
forest.drawnAt="gi";
ok("a chosen character wins for the place", box.locationDrawnAtEntity(forest)===giant);
ok("…but a room & time plate without that character in its scenes goes back to its own scenes", box.locationDrawnAtEntity(forest,{sceneNos:[1]})===firefly);
delete forest.drawnAt;
ok("the plate records it", JSON.stringify(box.locationDrawnAtMeta(firefly))===JSON.stringify({drawnAt:{id:"ff",name:"Lumi",mm:15}})
  && JSON.stringify(box.locationDrawnAtMeta(null))===JSON.stringify({drawnAt:{human:true}}));
ok("…and the card says it in words", box.locationDrawnAtLabel({id:"ff",name:"Lumi",mm:15})==="Lumi's eye level · 15 mm"
  && box.locationDrawnAtLabel({human:true})==="Human eye level");
ok("master, room & time and coverage plates all use it",
  (locs.match(/locationDrawnAtClause\(/g)||[]).length>=4 && locs.includes("locationDrawnAtEntity(l, { sceneNos:u.sceneNos })")
  && locs.includes("locationDrawnAtEntity(l, { sceneNos:sheet.sceneNos })"));
ok("plates record it in their meta and the card shows it", (ui.match(/locationDrawnAtMeta\(/g)||[]).length>=2
  && ui.includes('"data-testid":"loc-drawn-at"') && ui.includes('"data-testid":"loc-drawn-at-badge"'));
ok("Frances knows", /DRAWN AT THEIR EYE LEVEL \(2026-10-28/.test(ai));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

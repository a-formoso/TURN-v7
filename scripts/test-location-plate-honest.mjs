#!/usr/bin/env node
/* A PLATE THAT SHOWS THE LAYOUT, NOTHING INVENTED (owner 2026-10-27, "go ahead with A–F"), from Marmorica's plate:
   A  the drafter is told each field's length and cuts at a sentence (the fields were saved mid-word: "4 m…");
      lettering is given in quotes;
   B  the image model reads the layout in words: no metre floor plan, Blender axis convention, evidence, open
      questions or "no plate exists"; Blender and the writing calls keep the whole layout;
   C  the panels are written from this place's own layout (no "desk/terminal/counter", no "windows, glass, booth
      walls"); the script's needs come from action lines, not dialogue; only scenes in the rooms the panels show;
   D  one lettering rule; no "8k / hyper realistic / commercial photography";
   E  the main view composition is the top-left panel; the description is said once;
   F  plain labels on the card.
   Run: node scripts/test-location-plate-honest.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={ console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop, CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""},
  React:{createElement:()=>null,useState:(v)=>[v,noop],useEffect:noop,useRef:(v)=>({current:v}),useMemo:(f)=>f(),useCallback:(f)=>f,useReducer:()=>[0,noop],createContext:()=>({})} };
box.window=box; box.globalThis=box; box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box,{filename:"app/locations.jsx"});
const ai=readFileSync("app/ai.jsx","utf8"), loc=readFileSync("app/locations.jsx","utf8"), ui=readFileSync("app/locations-ui.jsx","utf8");
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const slice=(src,a,b)=>{ const i=src.indexOf(a), j=src.indexOf(b,i+a.length); if(i<0||j<0) throw new Error("missing "+a); return src.slice(i,j); };

// A
{
  const b={ clipWords:(t,n)=>String(t).slice(0,n).replace(/\s+\S*$/,"")+"…" }; b.window=b; vm.createContext(b);
  vm.runInContext(slice(ai,"function clipToSentence(","window.clipToSentence"),b);
  const t="Late ferry on the island run. CAR DECK (14 m beam × 40 m, 4 m high) with painted lanes. Upper deck has benches facing astern and a lifejacket locker by the deckhouse wall.";
  ok("A a long field is cut at the end of a sentence, never mid-word", b.clipToSentence(t,120)==="Late ferry on the island run. CAR DECK (14 m beam × 40 m, 4 m high) with painted lanes.", b.clipToSentence(t,120));
  ok("A …and kept whole when it fits", b.clipToSentence(t,400)===t);
  ok("A the drafter is told the lengths and to quote lettering",
    ai.includes("LENGTHS: write each field as complete sentences within its limit") && ai.includes("never stop mid-sentence")
    && ai.includes("give its exact short text in quotes, e.g. a stencilled deck number \\\"3\\\""));
  ok("A the limits: architecture 700, the rest 500 / 320", ai.includes("const LOC_FIELD_LIMITS = { architecture:700, materials:500, lighting:500, permanentDressing:500, topology:500, continuityAnchors:500, significance:320, style:160 };")
    && ai.includes("architecture: clean(e.architecture||e.layout, LOC_FIELD_LIMITS.architecture),"));
}
// B
const plan={schema:"cm-spatial-plan-v1",status:"reviewed",
  frame:"Ship frame. Stand on the stern-ramp hinge facing the bow. That forward direction is 'north' (+Y). Starboard is to the right (+X). No plate exists, so every placement is a design proposal for review.",
  anchors:[
    {id:"stern-ramp",space:"Marmorica - CAR Deck",name:"Hinged steel stern ramp",placement:"Spans the aft end of the hold.",evidence:"No image.",basis:"script",xy:[0,0],z:0,facing:180,posBasis:"design"},
    {id:"hose-cabinet",space:"Marmorica - CAR Deck",name:"Fire-hose reel cabinet",placement:"On the starboard bulkhead.",xy:[7,8]},
    {id:"stair-door-hold",space:"Marmorica - CAR Deck",name:"Steel door to internal stair",placement:"In the port bulkhead.",xy:[-7,12]},
    {id:"benches",space:"Marmorica - Upper Deck",name:"Fixed slatted benches in rows",placement:"Rows face astern.",xy:[0,6]},
    {id:"stair-door-upper",space:"Marmorica - Upper Deck",name:"Companionway door in deckhouse",placement:"Port side of the deckhouse wall.",xy:[-4,12]}],
  sightlines:"From the companionway you look aft down the aisle.", unresolved:"No reference plate: all geometry is design.",
  coordinates:{schema:"cm-location-coords-v1",spaces:[{id:"x",footprint:[[0,0],[1,0],[1,1]]}]}};
const ship={id:"loc-m",key:"marmorica",name:"Marmorica",intExt:"INT/EXT",spatialPlan:plan,scenes:[]};
box.turnContinuity={locations:[ship],scenes:[],drafts:{},sluglineUnits:[]};
box.locationSpatialPlanState=()=>({ready:true,stale:false,owner:ship,plan,source:{iso:"x"}});
{
  const c=box.locationSpatialImageContract(ship,[ship]), j=JSON.stringify(c);
  ok("B the image layout: every object's name, space and placement in words", c.anchors.length===5 && c.anchors[0].where==="Spans the aft end of the hold." && c.anchors[0].space==="Marmorica - CAR Deck");
  ok("B …no metre plan, convention, evidence, basis, positions or open questions", !/coordinates|convention|evidence|"basis"|"xy"|"facing"|posBasis|unresolved|schema|ownerId/.test(j), j);
  ok("B …and the frame in words: no axis labels, no 'no plate exists'", c.frame==="Ship frame. Stand on the stern-ramp hinge facing the bow. That forward direction is 'north'. Starboard is to the right.", c.frame);
  ok("B Blender and the writing calls keep the whole layout", /coordinates/.test(JSON.stringify(box.locationSpatialContract(ship,[ship])))
    && ai.includes("locationSpatialPrompt(location,{full:true})") && loc.includes("sharedSetLayout:locationSpatialContract(l),"));
  ok("B the identity layers (every plate prompt) carry the image layout", loc.includes("shared_set_layout:locationSpatialImageContract(l,list),"));
}
// C
{
  box.deriveLocationCoverageSheets=()=>[];
  box.deriveSluglineUnits=()=>[{locationKey:"marmorica",intExt:"INT",name:"Marmorica - CAR Deck"},{locationKey:"marmorica",intExt:"EXT",name:"Marmorica - Upper Deck"}];
  const p=box.locationMasterPanelPlan(ship,[],{}), j=JSON.stringify(p);
  ok("C the panels name what the layout puts there", /INTERIOR closer view of Marmorica - CAR Deck where the first business plays: Fire-hose reel cabinet, placed as the layout says/.test(p.top_right), p.top_right);
  ok("C the threshold names the ways between the two", /the way between Marmorica - Upper Deck and Marmorica - CAR Deck as the layout sets it \(Steel door to internal stair, Companionway door in deckhouse\)/.test(p.bottom_right), p.bottom_right);
  ok("C no template guesses", !/desk\/terminal\/counter|windows, glass|booth walls/.test(j));
  ok("C the rooms the panels show ride along, never into the prompt", JSON.stringify(p.rooms)==='["Marmorica - CAR Deck","Marmorica - Upper Deck"]' && !/rooms/.test(j));
  box.locationSceneScriptText=(s)=>s.text;
  const scenes=[{id:"a",text:"EXT. MARMORICA STERN DECK - NIGHT\nNives at the rail."},{id:"b",text:"INT. MARMORICA - CAR DECK - NIGHT\nHeadlights."},{id:"c",text:"EXT. MARMORICA - UPPER DECK - NIGHT\nBenches."}];
  const got=box.locationUnattachedScreenplayTexts({scenes:["a","b","c"]},scenes,{},["zz"],p.rooms);
  ok("C only the scenes in the rooms the panels show", got.length===2 && !got.some(t=>/STERN DECK/.test(t)), JSON.stringify(got));
  ok("C …and all of them with no rooms named", box.locationUnattachedScreenplayTexts({scenes:["a","b","c"]},scenes,{},["zz"]).length===3);
  ok("C the script's needs come from action lines and headings, not dialogue",
    loc.includes('b.type==="action" || b.type==="scene"') && !loc.includes('(typeof sceneScriptText==="function" && _C.drafts) ? sceneScriptText(sc.id, _C.drafts) : ""'));
}
// D
ok("D one lettering rule everywhere, quoted lettering exact", (loc.match(/LOC_TEXT_RULE/g)||[]).length>=4 && !loc.includes('"no text, no labels, no typography, no captions, no watermarks"')
  && box.LOC_TEXT_RULE===undefined && loc.includes("no text added to the picture of any kind: no titles, headings, labels, captions, panel or view names, annotations"));
ok("D every location prompt's AVOID list bans captioned panels", box.locationAvoidText("people")==="people, panel titles, view labels, captions, annotations, text overlays");
ok("E the last plate goes back as the layout's source only when the layout was read from it",
  loc.includes("if(!state.plan.source || !state.plan.source.iso)return [];"));
ok("E the main view's landmark is at an angle, not dead-centre", loc.includes("the primary landmark, seen at an angle from the main camera's corner, not centred"));
ok("D no '8k / hyper realistic / commercial photography'", !/"8k ultra detailed"|"hyper realistic"|"photorealistic commercial photography"/.test(loc));
// E
ok("E the composition is the top-left panel, in the plate prompt and in its drafter",
  loc.includes('fixture_projection_rule: opts.reverse ? undefined :"These fixtures describe ONLY the main (top-left) view"') && ai.includes("THE VIEW TO STAGE: the plate's MAIN view, its top-left panel"));
ok("E the place's description is said once", loc.includes("delete spec.location.identity_layers.place_identity;"));
ok("E the card says which panel and when the composition was drafted for another space",
  ui.includes('"The plate\'s top-left panel: "') && ui.includes("This composition was drafted for \\u201c"));
// F
ok("F plain labels", ui.includes('"Floor plan \\u00b7 where everything stands"') && ui.includes('"Plate cameras \\u00b7 where each panel is shot from"')
  && ui.includes('"Main view \\u00b7 far, middle, near"') && ui.includes('"Blender details"') && ui.includes('"Lens, scale and camera notes"') && ui.includes('"Main view"'));
// STORY MOMENTS (2026-10-27, from the test run: the Lounge plate drew a scene's wet footprints)
{
  box.turnContinuity={locations:[],scenes:[{id:"s1"}],drafts:{s1:{blocks:[
    {type:"action",text:"Amber night-lamps. Empty benches."},
    {type:"action",text:"It stops on small, wet, bare footprints tracking in from the spray-slick deck."},
    {type:"dia",text:"The blood on the deck is mine."},
    {type:"action",text:"A mug lies smashed by the door."}]}}};
  const t=box.locationStoryTraces({scenes:["s1"]});
  ok("story moments come from action lines only (never dialogue), with the trace words",
    t.items.length===2 && /footprints tracking in/.test(t.items[0]) && /smashed/.test(t.items[1]) && JSON.stringify(t.words)==='["footprints","broken glass"]', JSON.stringify(t));
  ok("…and a quiet place has none", box.locationStoryTraces({scenes:[]}).items.length===0);
  ok("the neutral plate is told to leave them out, and its AVOID list names them",
    loc.includes('leave_out_story_moments: (()=>{ const t = locationStoryTraces(l);') && loc.includes("locationAvoidText(l.negativePrompt || locVisualDefaults(l).negativePrompt || \"\", extra, traces.words.join(\", \"))"));
}
ok("Frances knows", /PLATES THAT SHOW THE LAYOUT \(2026-10-27\)/.test(ai) && /STORY MOMENTS ARE LEFT OUT/.test(ai));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

#!/usr/bin/env node
/* SHARED-HEAD PARENTS (owner-approved 2026-10-26, "go ahead with the locations plan"). A screenplay that names a
   place's spaces only as "PLACE - ROOM" (MARMORICA - CAR DECK, MARMORICA - UPPER DECK…) and never heads a scene with
   the place alone used to make every space a top-level location, each with its own layout and north. Now:
   - a NEW film's first derivation (sharedHeads "all") makes a parent card for the shared head and nests every
     "PLACE - …" and "PLACE …" space under it; an unrelated place stays apart;
   - an EXISTING film never regroups by itself: the Locations tab suggests it; Group makes the parent card (marked
     sharedHeadParent, its layout drafted from the room that places the most anchors) and the next derivation nests the
     rooms; Keep separate (notAliasOf) stops the suggestion and nests nothing;
   - each room keeps its own slugline units (subspaceKey) with the parent as continuity root.
   Run: node scripts/test-location-shared-head.mjs (no browser, no network) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const noop=()=>{};
const box={ console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop, CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""} };
box.window=box; box.globalThis=box; box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box,{filename:"app/locations.jsx"});
let pass=0, fail=0;
const ok=(name,value,detail)=>{ if(value){ pass++; console.log("PASS "+name); } else { fail++; console.log("FAIL "+name+(detail?" — "+detail:"")); } };
const scenes=[
  {id:"s1",no:1,title:"Final Ramp",loc:"INT. MARMORICA - CAR DECK/UPPER DECK - NIGHT"},
  {id:"s2",no:2,title:"Say Your Name",loc:"INT. MARMORICA - LIFEJACKET LOCKER - NIGHT"},
  {id:"s3",no:3,title:"Lounge",loc:"INT. MARMORICA PASSENGER LOUNGE - NIGHT"},
  {id:"s4",no:4,title:"Arrival",loc:"EXT. PORTOFERRAIO RAMP - DAWN"},
];
const drafts={ s1:{blocks:[{type:"scene",text:"INT. MARMORICA - CAR DECK/UPPER DECK - NIGHT"},{type:"action",text:"Sodium light."},
  {type:"scene",text:"EXT. MARMORICA - UPPER DECK - NIGHT"},{type:"action",text:"Black water."}]} };
const D=(locs)=>box.locationPlaceDecisions(locs||[]);
const view=(xs)=>xs.map(l=>l.name+(l.parentKey?" < "+l.parentKey:"")+(l.sharedHeadParent?" [parent]":"")).join(" | ");

// a new film: grouped at its first derivation
const first=box.deriveLocations(scenes,[],drafts,{placeDecisions:D(),sharedHeads:"all"});
ok("a new film's first pass makes the shared head a parent card and nests its spaces; another place stays apart",
  view(first)==="Marmorica [parent] | Marmorica - CAR Deck < marmorica | Marmorica - Upper Deck < marmorica | Marmorica - Lifejacket Locker < marmorica | Marmorica Passenger Lounge < marmorica | Portoferraio Ramp", view(first));
const parent=first[0];
ok("the parent is compound, the continuity root, and holds every room's scenes",
  parent.scope==="compound" && parent.continuityRootKey==="marmorica" && JSON.stringify(Array.from(parent.scenes))===JSON.stringify(["s1","s2","s3"]));
ok("after the first pass the parent card keeps the grouping (no sharedHeads option needed)",
  view(box.deriveLocations(scenes,[],drafts,{placeDecisions:D(first)})).startsWith("Marmorica [parent] | Marmorica - CAR Deck < marmorica"));

// an existing film: separate cards, never regrouped by itself
const existing=box.deriveLocations(scenes,[],drafts,{placeDecisions:D()}).map((l,i)=>({...l,
  ...(l.key==="marmorica-car-deck" ? { spatialPlan:{ frame:"North is the bow.", anchors:[
    {id:"ramp",space:"Marmorica - CAR Deck",name:"Stern ramp",placement:"aft",xy:[0,0]},
    {id:"rail",space:"Marmorica - Upper Deck",name:"Stern rail",placement:"aft",xy:[0,0],z:4.4}], status:"reviewed" } } : {}),
  ...(l.key==="marmorica-upper-deck" ? { spatialPlan:{ frame:"North is aft.", anchors:[{id:"door",space:"Marmorica - Upper Deck",name:"Weather door",placement:"fwd"}], status:"reviewed" } } : {})}));
ok("an existing film derives as before — no parent, no nesting", !existing.some(l=>l.parentKey||l.sharedHeadParent), view(existing));
const sug=box.locationSharedHeadSuggestions(existing,scenes,drafts,{placeDecisions:D(existing)});
ok("…and the Locations tab suggests grouping the four Marmorica places (not Portoferraio)",
  sug.length===1 && sug[0].headKey==="marmorica" && sug[0].headName==="Marmorica"
  && Array.from(sug[0].children,c=>c.name).join(", ")==="Marmorica - CAR Deck, Marmorica - Upper Deck, Marmorica - Lifejacket Locker, Marmorica Passenger Lounge", JSON.stringify(sug));
const ids=Array.from(sug[0].children,c=>c.id);
const grouped=box.locationSharedHeadApply(existing,"marmorica","Marmorica",ids,"group");
const p=grouped.find(l=>l.sharedHeadParent);
ok("Group adds one parent card before its first room, INT/EXT, with the layout of the room that places the most anchors, as a draft it owns",
  grouped.length===existing.length+1 && grouped[0]===p && p.key==="marmorica" && p.intExt==="INT/EXT"
  && p.spatialPlan.frame==="North is the bow." && p.spatialPlan.anchors.length===2 && p.spatialPlan.status==="draft"
  && p.spatialPlan.source.assetId===p.id && existing.every(l=>grouped.includes(l)), JSON.stringify(p));
const regrouped=box.deriveLocations(scenes,[],drafts,{placeDecisions:D(grouped)});
ok("the next derivation nests the rooms under it", view(regrouped).includes("Marmorica - Upper Deck < marmorica") && view(regrouped).includes("Marmorica Passenger Lounge < marmorica"), view(regrouped));
ok("…and nothing is suggested any more", box.locationSharedHeadSuggestions(grouped,scenes,drafts,{placeDecisions:D(grouped)}).length===0);
ok("Group never makes a second parent", box.locationSharedHeadApply(grouped,"marmorica","Marmorica",ids,"group")===null);
const units=box.deriveSluglineUnits(scenes,drafts,{placeDecisions:D(grouped)});
const upper=units.find(u=>/Upper Deck/i.test(u.place));
ok("a room keeps its own slugline units, with the parent as continuity root",
  upper && upper.subspaceKey==="marmorica-upper-deck" && upper.continuityRootKey==="marmorica", JSON.stringify(upper&&{s:upper.subspaceKey,r:upper.continuityRootKey}));
const kept=box.locationSharedHeadApply(existing,"marmorica","Marmorica",ids,"separate");
ok("Keep separate marks each place apart from the head, stops the suggestion and nests nothing",
  kept.filter(l=>Array.from(l.notAliasOf||[]).includes("marmorica")).length===4
  && box.locationSharedHeadSuggestions(kept,scenes,drafts,{placeDecisions:D(kept)}).length===0
  && !box.deriveLocations(scenes,[],drafts,{placeDecisions:D(kept)}).some(l=>l.parentKey));
ok("a head needs two places, three letters and isn't INT/EXT",
  box.locationSharedHead("Marmorica - CAR Deck").key==="marmorica" && box.locationSharedHead("Pier")===null
  && box.locationSharedHead("AB - Room")===null && box.locationSharedHead("INT - Hall")===null);
const app=readFileSync("app/app.jsx","utf8"), ui=readFileSync("app/locations-ui.jsx","utf8"), ai=readFileSync("app/ai.jsx","utf8");
ok("the app seeds a new film with every head, asks before grouping, and the Locations tab shows the suggestion",
  app.includes('deriveLocations(scenes, known, drafts, known.length ? undefined : { sharedHeads:"all" })')
  && app.includes("const decideSharedHead = async (sug, kind)=>{") && app.includes('confirmLabel:"Group under "+sug.headName')
  && ui.includes("(sharedHeads||[]).map(sug=>React.createElement(LocationSharedHeadNotice,{ key:sug.headKey, sug, readOnly, onDecide:onSharedHeadDecision }))")
  && ai.includes("PARENT PLACES FROM 'PLACE - ROOM' HEADINGS (2026-10-26)"));
console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

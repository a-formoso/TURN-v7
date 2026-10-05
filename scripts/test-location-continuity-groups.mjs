#!/usr/bin/env node
/* Functional tests for continuity-bearing master locations and Slugline Units. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  document:{createElement:()=>({getContext:()=>null}),addEventListener:noop},
  addEventListener:noop,removeEventListener:noop,
  CustomEvent:class{},Image:class{},URL:{createObjectURL:()=>""}
};
box.window=box;box.globalThis=box;
box.scenesInStoryOrder=(xs)=>xs||[];
vm.createContext(box);
const locationSource=readFileSync("app/locations.jsx","utf8");
vm.runInContext(locationSource,box,{filename:"app/locations.jsx"});

let pass=0,fail=0;
const ok=(name,value,detail)=>{if(value)pass++;else{fail++;console.log("FAIL "+name+(detail?" — "+detail:""));}};
const keys=(xs)=>Array.from(xs||[]).sort().join(",");

const scenes=[
  {id:"s1",no:1,title:"Closing Argument",loc:"INT. FATHER'S HOUSE - NIGHT",
    summary:"At his father's house, Marcus rehearses before the funeral."},
  {id:"s3",no:3,title:"Dead Man's Wishes",loc:"INT. KITCHEN - NIGHT",
    summary:"Inside his father's house, Marcus searches the kitchen."},
  {id:"s6",no:6,title:"The Drawer Letter",loc:"INT. KITCHEN - DAWN",
    summary:"The house still smells like a sick man's house."}
];
const drafts={
  s1:{blocks:[
    {type:"scene",text:"INT. FATHER'S HOUSE - NIGHT"},
    {type:"action",text:"A dead man's living room. One lamp fights the dark."},
    {type:"action",text:"THE KITCHEN. Marcus sets the phone face-down beside the pill bottles."}
  ]},
  s3:{blocks:[
    {type:"scene",text:"INT. KITCHEN - NIGHT"},
    {type:"action",text:"The kitchen of his father's house is dark."}
  ]},
  s6:{blocks:[
    {type:"scene",text:"INT. KITCHEN - DAWN"},
    {type:"action",text:"The house still smells like a sick man's house."},
    {type:"scene",text:"INT. LIVING ROOM - DAWN"},
    {type:"action",text:"Daniel sprawls across the couch."},
    {type:"scene",text:"INT. KITCHEN - DAWN"},
    {type:"action",text:"Marcus finds an envelope stamped BRUMFIELD FUNERAL HOME, then returns to his father's kitchen table."}
  ]}
};

const fold=box.deriveSubspaceFold(scenes,drafts);
const parentKey=box.locSlug("Father's House").split("-").slice(0,4).join("-");
ok("kitchen folds under the house continuity master",fold.kitchen===parentKey,JSON.stringify(fold));
ok("living room folds under the house continuity master",fold["living-room"]===parentKey,JSON.stringify(fold));

const masters=box.deriveLocations(scenes,[],drafts);
ok("root plus two child workspaces are derived",masters.length===3,JSON.stringify(masters));
const root=masters.find(x=>x.key===parentKey);
const kitchen=masters.find(x=>x.key==="kitchen");
const living=masters.find(x=>x.key==="living-room");
ok("master is Father's House and explicitly compound",root?.scope==="compound",JSON.stringify(masters));
ok("master owns all three scenes",keys(root?.scenes)==="s1,s3,s6",JSON.stringify(root));
ok("master records both filmable subspaces",
  (root?.areas||[]).includes("Kitchen")&&(root?.areas||[]).includes("Living Room"),JSON.stringify(root));
ok("Kitchen is an atomic child workspace with inherited root identity",
  kitchen?.scope==="atomic"&&kitchen?.parentKey===parentKey&&kitchen?.continuityRootKey===parentKey,JSON.stringify(kitchen));
ok("Living Room is an atomic child workspace with inherited root identity",
  living?.scope==="atomic"&&living?.parentKey===parentKey&&living?.continuityRootKey===parentKey,JSON.stringify(living));

const units=box.deriveSluglineUnits(scenes,drafts);
const wanted=[["Kitchen","INT","Night"],["Kitchen","INT","Dawn"],
  ["Living Room","INT","Night"],["Living Room","INT","Dawn"]];
wanted.forEach(([name,side,time])=>ok(
  name+" "+side+" "+time+" remains a Slugline Unit",
  units.some(u=>u.name===name&&u.intExt===side&&u.time===time&&u.locationKey===parentKey&&u.subspaceKey===box.locSlug(name)),
  JSON.stringify(units.map(u=>({name:u.name,side:u.intExt,time:u.time,parent:u.locationKey,subspace:u.subspaceKey})))
));
ok("repeated Kitchen Dawn headings consolidate to one unit",
  units.filter(u=>u.name==="Kitchen"&&u.intExt==="INT"&&u.time==="Dawn").length===1);
const livingNight=units.find(u=>u.name==="Living Room"&&u.time==="Night");
const kitchenNight=units.find(u=>u.name==="Kitchen"&&u.time==="Night");
ok("an unslugged establishing room records derived provenance",
  livingNight?.sourceKinds?.includes("derived-establishing-action")&&
  livingNight?.occurrences?.some(o=>o.sourceKind==="derived-establishing-action"),JSON.stringify(livingNight));
ok("an inline room transition records derived provenance",
  kitchenNight?.sourceKinds?.includes("derived-inline-room-cue")&&
  kitchenNight?.occurrences?.some(o=>o.sourceKind==="derived-inline-room-cue"),JSON.stringify(kitchenNight));
ok("each screenplay occurrence retains a bounded source excerpt",
  units.every(u=>(u.occurrences||[]).every(o=>typeof o.scriptText==="string"&&o.scriptText.length<=1402)));

const kitchenStates=box.locationAppearanceStates({...kitchen,variants:[
  {id:"legacy-dawn",time:"Dawn",state:"gray window light; practicals off"}
]},units);
ok("Time-of-Day Variants contains only the changed Kitchen state",
  kitchenStates.length===1&&!kitchenStates.some(v=>v.time==="Night")&&kitchenStates.some(v=>v.time==="Dawn"),
  JSON.stringify(kitchenStates));
kitchenStates.forEach(v=>ok(
  "Time-of-Day Variant shares the "+v.time+" slugline asset id",
  box.locationAppearanceStateAssetId(kitchen,v,units)===box.sluglineUnitImageId(v.linkedUnit.key),
  JSON.stringify(v)
));
ok("legacy Dawn notes are adopted without creating a duplicate state",
  kitchenStates.filter(v=>v.time==="Dawn").length===1&&kitchenStates.find(v=>v.time==="Dawn")?.state==="gray window light; practicals off",
  JSON.stringify(kitchenStates));
ok("child subspaces do not derive their own Required Space Plates",
  box.deriveLocationCoverageSheets(kitchen,scenes,drafts,masters,units).length===0);

const sideOnlyUnits=[
  {key:"yard|INT|Night",name:"Yard",subspaceKey:"yard",locationKey:"yard",intExt:"INT",time:"Night",sceneNos:[1],occurrences:[]},
  {key:"yard|EXT|Night",name:"Yard",subspaceKey:"yard",locationKey:"yard",intExt:"EXT",time:"Night",sceneNos:[1],occurrences:[]}
];
ok("INT versus EXT alone is geography, not an appearance state",
  box.locationAppearanceStates({key:"yard",variants:[]},sideOnlyUnits).length===0);

const kitchenDawn=units.find(u=>u.name==="Kitchen"&&u.time==="Dawn");
const manualState={id:"storm-state",manualState:true,intExt:"INT",time:"Dawn",state:"Rain lashes the windows"};
ok("a manual Time-of-Day Variant owns a distinct asset unless explicitly linked",
  box.locationAppearanceStateAssetId(kitchen,manualState,units)===kitchen.id+"-storm-state"&&
  box.locationAppearanceStateAssetId(kitchen,manualState,units)!==box.sluglineUnitImageId(kitchenDawn.key));
ok("a manual Time-of-Day Variant may explicitly share a Slugline Unit asset",
  box.locationAppearanceStateAssetId(kitchen,{...manualState,unitKey:kitchenDawn.key},units)===
    box.sluglineUnitImageId(kitchenDawn.key)&&
  box.locationAppearanceStates({...kitchen,variants:[{...manualState,unitKey:kitchenDawn.key}]},units)
    .some(v=>v.id===manualState.id&&v.linkedUnit?.key===kitchenDawn.key));

const legacyView=box.locationCoverageViews({id:"loc-kitchen",name:"Kitchen",staging:{viewLabel:"Sink axis",lens:"35mm",bg:{center:"Window"}}});
ok("legacy staging upgrades to one reusable coverage view without data loss",
  legacyView.length===1&&legacyView[0].id==="principal"&&legacyView[0].staging.bg.center==="Window"&&legacyView[0].lens==="35mm",
  JSON.stringify(legacyView));
const setups=box.locationSceneSetups(kitchen,units);
ok("scene setups are occurrence scoped rather than stored on the canonical space",
  setups.length===(units.filter(u=>u.subspaceKey==="kitchen").flatMap(u=>u.occurrences||[])).length&&
  setups.every(s=>s.id.includes("@")&&s.id.includes("#")&&s.sceneId),JSON.stringify(setups));
const repeatedSceneSetups=setups.filter(s=>s.sceneId==="s6"&&s.unitKey===kitchenDawn.key);
ok("repeated visits to one Slugline Unit are visibly distinguishable",
  repeatedSceneSetups.length===2&&repeatedSceneSetups.map(s=>s.occurrenceOrdinal).join(",")==="1,2"&&
  repeatedSceneSetups.every(s=>s.occurrenceCount===2),JSON.stringify(repeatedSceneSetups));

const shiftedDrafts={...drafts,s1:{blocks:[
  drafts.s1.blocks[0],drafts.s1.blocks[1],
  {type:"action",text:"The old wall clock ticks once."},
  drafts.s1.blocks[2]
]}};
const shiftedUnits=box.deriveSluglineUnits(scenes,shiftedDrafts);
const setupId=(candidateUnits)=>box.locationSceneSetups(kitchen,candidateUnits)
  .find(s=>s.unitKey.includes("kitchen|")&&s.sceneId==="s1")?.id;
ok("Scene Setup identity survives earlier unrelated screenplay block insertion",
  setupId(units)===setupId(shiftedUnits),setupId(units)+" versus "+setupId(shiftedUnits));

const kitchenNightOccurrence=kitchenNight.occurrences.find(o=>o.sceneId==="s1");
const legacySetupId=kitchenNight.key+"@s1:"+kitchenNightOccurrence.start;
const reconciled=box.reconcileSluglineUnits(units,[{key:kitchenNight.key,setups:[
  {id:legacySetupId,notes:"Keep Marcus by the table"},
  {id:"retired-setup",sceneId:"deleted-scene",notes:"Preserve this abandoned setup"}
]}]);
const reconciledSetups=box.locationSceneSetups(kitchen,reconciled);
const migratedSetup=reconciledSetups.find(s=>s.unitKey===kitchenNight.key&&s.sceneId==="s1"&&!s.orphan);
ok("legacy block-offset setup IDs migrate by their old unit and scene prefix",
  migratedSetup?.id===box.screenplayOccurrenceKey(kitchenNight.key,kitchenNightOccurrence,0,kitchenNight.occurrences)&&
  migratedSetup?.storageId===legacySetupId&&migratedSetup?.notes==="Keep Marcus by the table",JSON.stringify(reconciledSetups));
const sceneMatched=box.reconcileSceneSetupRecords(kitchenNight.key,[kitchenNightOccurrence],[
  {id:"opaque-legacy-id",sceneId:"s1",notes:"Matched by persisted scene identity"}
]);
ok("legacy setup records also migrate by their persisted sceneId",
  sceneMatched[0]?.id===box.screenplayOccurrenceKey(kitchenNight.key,kitchenNightOccurrence,0,[kitchenNightOccurrence])&&
  sceneMatched[0]?.notes==="Matched by persisted scene identity"&&!sceneMatched[0]?.orphan,
  JSON.stringify(sceneMatched));
ok("saved setups with no remaining screenplay occurrence stay visible as orphans",
  reconciledSetups.some(s=>s.id==="retired-setup"&&s.orphan===true&&s.notes==="Preserve this abandoned setup"),
  JSON.stringify(reconciledSetups));

const planLocation={...kitchen,id:"loc-kitchen",coverageSheets:[{id:"threshold",name:"Threshold",sceneNos:[1]}],
  variants:[{id:"manual-rain",manualState:true,time:"Night",state:"Rain on the glass"}],
  parentLocation:{id:"loc-house",key:parentKey,name:"Father's House",architecture:"A".repeat(1800),
    materials:"Dark wood",lighting:"Warm practicals",permanentDressing:"Worn furniture",
    topology:"Living room opens to kitchen",continuityAnchors:"Front door, archway, kitchen window"}};
const plan=box.locationProductionPlan(planLocation,units);
ok("the Blender handoff exposes all production layers under a versioned schema",
  plan.schema==="cm-location-plan-v1"&&Array.isArray(plan.screenplaySpaces)&&
  Array.isArray(plan.appearanceStates)&&Array.isArray(plan.requiredSpacePlates)&&
  Array.isArray(plan.coverageViews)&&Array.isArray(plan.sceneSetups)&&
  plan.requiredSpacePlates[0]?.id==="threshold",JSON.stringify(plan));
ok("production-plan assets use the exact durable Art Room IDs",
  plan.screenplaySpaces.every(s=>s.assetId===box.sluglineUnitImageId(s.key))&&
  plan.appearanceStates.every(s=>typeof s.assetId==="string"&&s.assetId.length>0)&&
  plan.requiredSpacePlates[0]?.assetId==="loc-kitchen-threshold",JSON.stringify(plan));
ok("a child production plan carries a bounded parent continuity canon",
  plan.continuityRoot?.id==="loc-house"&&plan.continuityRoot?.canonicalSet?.materials==="Dark wood"&&
  plan.continuityRoot?.canonicalSet?.architecture.length===1600,JSON.stringify(plan.continuityRoot));

const competingFold=box.deriveSubspaceFold(scenes.concat([
  {id:"s2",no:2,loc:"INT. FUNERAL HOME OFFICE - NIGHT",summary:"Marcus waits at the funeral home."}
]),drafts);
ok("an unrelated Funeral Home does not make Father's House ambiguous",
  competingFold.kitchen===parentKey&&competingFold["living-room"]===parentKey,JSON.stringify(competingFold));

const ambiguousScenes=[
  {id:"a",no:1,loc:"INT. FATHER'S HOUSE - NIGHT",summary:"A house at night."},
  {id:"b",no:2,loc:"INT. MOTHER'S HOUSE - NIGHT",summary:"A house at night."},
  {id:"c",no:3,loc:"INT. KITCHEN - NIGHT",summary:"A kitchen in the house."}
];
const ambiguous=box.deriveSubspaceFold(ambiguousScenes,{});
ok("ambiguous room ownership remains separate",!ambiguous.kitchen,JSON.stringify(ambiguous));

const ui=readFileSync("app/locations-ui.jsx","utf8");
const ai=readFileSync("app/ai.jsx","utf8");
const shots=readFileSync("app/shots.jsx","utf8");
ok("child records retain their explicit parent relationship",
  ui.includes("rawLocations.filter(Boolean).map")&&ui.includes("parentLocation")&&ui.includes("childLocations"));
ok("redundant root scope and Contains rows stay out of the clean card header",
  !ui.includes('className:"loc-scope-line"')&&
  !ui.includes('className:"loc-child-row"')&&
  !ui.includes('"Compound place"')&&!ui.includes('"Contains"'));
ok("child relationship remains explicit as a compact parent breadcrumb",
  ui.includes('className:"loc-parent-breadcrumb"')&&
  ui.includes('"within "')&&ui.includes('" \\u00b7 inherits continuity"'));
ok("unit cards live on their matching subspace workspace",
  ui.includes("String(u.subspaceKey||u.locationKey||\"\")===String(l.key||\"\")"));
ok("place identity fields stay separate from unit environment notes",
  ui.includes('label:"Permanent lighting & daylight interfaces"')&&
  ui.includes('label:"Environment notes"')&&ui.includes('"Fixed landmarks"'));
ok("location folds use the approved filmmaker-facing names",
  // plainer names (owner 2026-10-03): Slugline Units → Rooms & times
  ["The Space","Narrative Significance","Screenplay Evidence","Rooms & times","Spatial Layout & Staging","Generation Prompt"]
    .every(label=>ui.includes('label:"'+label+'"')));
ok("location folds follow identity to screenplay to view to generation order",
  ["label:\"The Space\"","label:\"Narrative Significance\"","label:\"Screenplay Evidence\"","label:\"Rooms & times\"",
    "label:\"Spatial Layout & Staging\"","label:\"Generation Prompt\""]
    .map(token=>ui.indexOf(token)).every((at,i,all)=>at>=0&&(i===0||at>all[i-1])));
// 2026-10-05 (owner): the settings that change the plate sit ON the card in "Look & exclusions",
// just before the read-only Generation Prompt
ok("location style fine-tuning is in Look & exclusions (before Generation Prompt) without a separate Look dev fold",
  !ui.includes('label:"Look dev"')&&
  ui.indexOf('className:"loc-render-style-details"')>ui.indexOf('label:"Look & exclusions"')&&
  ui.indexOf('label:"Look & exclusions"')<ui.indexOf('label:"Generation Prompt"')&&
  ui.includes('label:"Render style instructions"'));
ok("topology and anchors stay nested inside The Space",
  ui.indexOf('field:"topology",label:"How the rooms connect"')>ui.indexOf('label:"The Space"')&&
  ui.indexOf('"Fixed landmarks"')>ui.indexOf('field:"topology",label:"How the rooms connect"')&&
  ui.indexOf('"Fixed landmarks"')<ui.indexOf('label:"Narrative Significance"'));
ok("location folds provide concise definitions without expanding the headings",
  ui.includes("function LocationSectionHelp")&&
  ui.includes('label:"About The Space"')&&ui.includes("persistent physical location")&&
  ui.includes('label:"About Narrative Significance"')&&ui.includes("means dramatically")&&
  ui.includes("Rooms & times (the screenplay's sluglines) identify the rooms, times and scenes")&&ui.includes("Lighting & environment"));
ok("script evidence and reusable staging have separate roles",
  ui.includes("Spatial Layout & Staging holds reusable camera views")&&
  ui.includes("function LocationScreenplayEvidence")&&
  ui.includes("Shot timing, cuts and performance are directed in Shots / Blender previz."));
ok("location identity fields expose editable provenance",
  ui.includes("function LocationProvenanceSelect")&&ui.includes('field:"architecture"')&&
  ui.includes('field:"continuityAnchors"')&&ui.includes('className:"loc-prov-select"'));
ok("continuity-state descriptions reach the actual generator",
  readFileSync("app/locations.jsx","utf8").includes("{ time:v.time, state:v.state }")&&
  readFileSync("app/locations.jsx","utf8").includes('"continuity-state"'));
ok("linked states have one unit editor, while independent states retain their asset resolver",
  ui.includes("locationAppearanceStateAssetId(l,v,units||[])")&&
  ui.includes("environment.units.map")&&ui.includes("environment.additional.map")&&
  !ui.includes('label:"Time-of-Day Variants"')&&
  ui.includes('"Extra spaces"')&&ui.includes("!l.parentLocation&&coverageSheets.length>0"));
ok("coverage views and scene setups have distinct editors",
  ui.includes("function CoverageViewsEditor")&&ui.includes("function SceneSetupCard")&&
  ui.includes('label:"Blocking & action path"')&&ui.includes('label:"Object states at the start"')&&
  ui.includes("setup.storageId||setup.id")&&ui.includes('"Saved setup \\u00b7 source removed"')&&
  ui.includes('"Occurrence ",setup.occurrenceOrdinal," of ",setup.occurrenceCount'));
ok("visible location-reference copy uses the approved production-layer names",
  ui.includes('noun:"room & time plate"')&&
  ui.includes('label:"Room & time · "')&&
  ui.includes('label:"Time-of-Day Variant · "')&&
  ui.includes('"Make every plate this scene needs that doesn\'t exist yet: "')&&
  shots.includes('" — Required Space Plate · "')&&
  !shots.includes('" slugline/subspace unit"')&&!shots.includes('" coverage sheet (one full-frame view)"'));
ok("Location Scout generates screenplay-derived shared variants, not only legacy variants",
  readFileSync("app/app.jsx","utf8").includes("locationAppearanceStates(l,sluglineUnits||[])"));
ok("MUSE capability manifest names the approved location architecture",
  ai.includes('{ name:"Location Generation Prompt"')&&
  ai.includes("organizes production work into five explicit layers")&&
  ai.includes("one card represents each established continuity root")&&
  ai.includes("Screenplay Evidence -> Slugline Units -> Spatial Layout & Staging")&&
  ai.includes("TIME-OF-DAY VARIANTS own only persistent environment changes")&&
  ai.includes("COVERAGE VIEWS own reusable visual interpretations tied to Slugline Units")&&
  ai.includes("Screenplay Evidence shows actual source passages")&&
  ai.includes("There is NO separate Time-of-Day Variants fold")&&
  ai.includes("SCENE SETUPS hold occurrence-specific blocking"));

console.log(pass+" passed, "+fail+" failed");
process.exit(fail?1:0);

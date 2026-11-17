#!/usr/bin/env node
/* Shared physical layout, cross-panel evidence and review gates. All providers
   and persistence are mocked; this test consumes no generation credits. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";
import {boundedSceneBuilderContext,sceneBuilderProviderPrompt} from "../supabase/functions/blender-bridge/studio-provider-prompt.mjs";

const box={console,setTimeout,clearTimeout,localStorage:{getItem:()=>null},
  scenesInStoryOrder:x=>x||[],dispatchEvent:()=>{},CustomEvent:class{},renderStyleText:()=>"Photoreal"};
box.window=box;vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box);
let epoch=1,image="plate-v1",iso="version-1",calls=[];
box.nbEpoch=()=>epoch;box.nbGetImage=id=>id==="house"?image:"room";
box.nbLoadImage=async id=>box.nbGetImage(id);box.nbGetMeta=()=>({iso});
const house={id:"house",key:"house",name:"Father's House",architecture:"House",spatialNotes:"Keep the table in front of the fridge."};
const kitchen={id:"kitchen",key:"kitchen",name:"Kitchen",parentKey:"house",staging:{mid:{right:"Legacy moved table"}}};
const pantry={id:"pantry",key:"pantry",name:"Pantry",parentKey:"kitchen"};
box.turnContinuity={locations:[pantry,kitchen,house],scenes:[],drafts:{}};
const draft={frame:"From living-room archway facing into kitchen",
  anchors:[{id:"fridge",space:"Kitchen",name:"Fridge",placement:"Left of sink-window in named room frame",basis:"observed",evidence:"Top-left through archway; top-right direct view"},
    {id:"table",space:"Kitchen",name:"Dining table",placement:"In front of fridge, on archway-to-fridge sightline",basis:"observed",evidence:"Both upper panels"}],
  sightlines:"Living Room -> Kitchen through cased archway: table and fridge visible.",
  unresolved:"Exact room dimensions and wall behind camera are unknown."};
assert.equal(box.normalizeLocationSpatialPlan({frame:"From the "}).frame,"From the ",
  "controlled editors must preserve spaces while the user types");
assert.equal(box.locationSpatialOwner(pantry),house,"all descendants use the root's plan");
assert.throws(()=>box.requireLocationSpatialPlan(kitchen),/Prepare the shared set layout/);
house.spatialPlan=box.normalizeLocationSpatialPlan({...draft,status:"draft",source:{assetId:"house",iso}});
assert.throws(()=>box.requireLocationSpatialPlan(house),/Review the shared set layout/);
house.spatialPlan.status="reviewed";
assert.equal(box.locationSpatialPlanState(kitchen).ready,true);
const contract=box.locationSpatialContract(kitchen);
assert.equal(contract.ownerId,"house");
assert.equal(contract.anchors[1].id,"table");
assert.equal(contract.anchors[1].placement,draft.anchors[1].placement);
assert.match(contract.rules,/NOT screen-left\/right/);
assert.match(contract.rules,/Move only cameras/);
assert.match(contract.unresolved,/unknown/);
assert.equal(contract.corrections,house.spatialNotes);
const copy=JSON.stringify([house,kitchen]);
for(const prompt of [box.buildLocationRefPrompt(kitchen,{}),box.buildSimpleLocationPrompt(kitchen),
  box.buildLocationVariantPrompt(kitchen,{}, {time:"Night"}),box.buildLocationCoveragePrompt(kitchen,{name:"Kitchen"},{}),
  box.buildSluglineUnitPrompt(kitchen,{name:"Kitchen",time:"Dawn"},{}),box.buildLocationFromPhotoPrompt(kitchen,{})]){
  assert.match(prompt,/archway-to-fridge sightline/,"every generation mode carries fixed placement");
  // (2026-10-27) the layout's open questions are for the review and Blender (the full contract above keeps them);
  // an image prompt reads only what is placed, in words
  assert.ok(!/"unresolved"/.test(prompt) && !/"coordinates"/.test(prompt),"no open questions or metre plan in an image prompt");
}
const spec=JSON.parse(box.buildLocationRefPrompt(kitchen,{}).split("\n").slice(1).join("\n"));
assert.match(spec.fixture_projection_rule,/takes precedence/);
assert.match(spec.fixtures[0].position,/principal camera view only/);
assert.equal(JSON.stringify([house,kitchen]),copy,"no migration or mutation from prompt compilation");
assert.equal(box.locationProductionPlan(kitchen,[]).sharedSetLayout.ownerId,"house");
// (2026-10-14) a sub-space gets neither the parent's nor the layout's whole sheet — single cut-out panels only
box.cropRegionAsDataUrl=async(url,rect,max)=>"crop("+url+","+rect.x+","+rect.y+","+max+")";
assert.deepEqual(Array.from(await box.locationSpatialReferences(kitchen)),[],"the layout reaches a sub-space as text, not as its source sheet");
const merged=box.mergeLocationReferences(await box.locationParentReferences(kitchen),await box.locationSpatialReferences(kitchen));
assert.equal(merged.length,1,"one image of the parent");
assert.equal(merged[0].url,"crop(plate-v1,50.5,50.5,640)","a small panel cut out of it, never the sheet");
assert.doesNotMatch(merged[0].note,/ALL panels/);
assert.match(merged[0].note,/materials and colour only/);
// the owner itself still reads its own reviewed source sheet
assert.equal((await box.locationSpatialReferences(house))[0].url,image);
delete box.cropRegionAsDataUrl;
iso="version-2";
assert.throws(()=>box.requireLocationSpatialPlan(kitchen),/parent image changed/);
house.spatialPlan.source.iso=iso;
assert.equal(box.locationSpatialPlanState(kitchen).ready,true);
box.nbGenerate=async(prompt,opts)=>{calls.push({prompt,opts});return "result";};
box.nbCommit=async()=>({tier:"local"});
house.spatialPlan.status="draft";
await assert.rejects(box.generateLocationPlate(kitchen,{}),/Review the shared set layout/);
assert.equal(calls.length,0,"unreviewed plans block headless image spending");
house.spatialPlan.status="reviewed";
let fail=true;
box.nbGenerate=async(prompt,opts)=>{calls.push({prompt,opts});if(fail){fail=false;throw Error("no image");}return "result";};
await box.generateLocationPlate(house,{});
assert.equal(calls.length,2);
assert.ok(calls.every(c=>c.prompt.includes("archway-to-fridge sightline")&&c.opts.extraImages[0]===image),
  "root regeneration and its simple retry keep the reviewed source and layout");

// Vision planning consumes the complete parent image, never a selected panel.
const ai=readFileSync("app/ai.jsx","utf8");
const ast=parseSync(ai,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
const fn=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="aiDraftLocationSpatialPlan");
let visionCalls=0,textCalls=0,prompt="",seenImage="";
box.turnDownscaleDataUrl=async(url,dim)=>{assert.equal(dim,1536);seenImage=url;return "full-parent-grid";};
box.aiVisionComplete=async(messages,images)=>{visionCalls++;prompt=messages[0].content;
  assert.equal(images[0],"full-parent-grid");return {vision:true,text:JSON.stringify({...draft,status:"reviewed"})};};
box.aiAvailable=()=>true;box.extractJSON=JSON.parse;
box.claude={complete:async({messages})=>{textCalls++;prompt=messages[0].content;return JSON.stringify(draft);}};
vm.runInContext(ai.slice(fn.start,fn.end),box);
const proposal=await box.aiDraftLocationSpatialPlan(kitchen,[],{});
assert.equal(proposal.status,"draft","a model cannot approve its own geometry");
assert.equal(seenImage,image);assert.equal(visionCalls,1);
assert.match(prompt,/EVERY panel jointly/);
assert.match(prompt,/Do not invent metric dimensions/);
assert.match(prompt,/Keep the table in front of the fridge/);
assert.equal(house.spatialPlan.status,"reviewed","draft proposal never overwrites saved plan");
assert.match(prompt,/renderShape sports-net/);
const oldShape=house.spatialPlan.anchors[0].renderShape,oldMesh=house.spatialPlan.anchors[0].netMeshHeight;
house.spatialPlan.anchors[0].renderShape="sports-net";house.spatialPlan.anchors[0].netMeshHeight=.7;
const refined=await box.aiDraftLocationSpatialPlan(kitchen,[],{});
assert.equal(refined.anchors.find(a=>a.id===house.spatialPlan.anchors[0].id).renderShape,"sports-net","Layout refinement preserves explicit shape choices");
assert.equal(refined.anchors.find(a=>a.id===house.spatialPlan.anchors[0].id).netMeshHeight,.7,"Layout refinement preserves explicit mesh height");
if(oldShape===undefined)delete house.spatialPlan.anchors[0].renderShape;else house.spatialPlan.anchors[0].renderShape=oldShape;
if(oldMesh===undefined)delete house.spatialPlan.anchors[0].netMeshHeight;else house.spatialPlan.anchors[0].netMeshHeight=oldMesh;
box.aiVisionComplete=async()=>({vision:false,text:JSON.stringify(draft)});
await assert.rejects(box.aiDraftLocationSpatialPlan(house,[],{}),/did not read the image/);
assert.equal(textCalls,0,"no silent blind-text fallback for an existing image");
image="";iso="";
await box.aiDraftLocationSpatialPlan(house,[],{});assert.equal(textCalls,1,"new places can be designed before their first image");
const visionBeforeSwitch=visionCalls;
image="plate";box.turnDownscaleDataUrl=async()=>{epoch++;return "data";};
await assert.rejects(box.aiDraftLocationSpatialPlan(house,[],{}),/film changed/);
assert.equal(visionCalls,visionBeforeSwitch,"project switches block subsequent paid vision calls");

// The Blender context keeps the physical plan even when scene history is huge.
const plan=box.locationProductionPlan(kitchen,[]);
plan.sceneSetups=Array.from({length:500},(_,i)=>({id:String(i),blocking:"x".repeat(500)}));
const workspace={locationId:"kitchen",context:{productionPlan:JSON.stringify(plan)}};
const bounded=JSON.parse(boundedSceneBuilderContext(workspace));
assert.deepEqual(bounded.productionPlan.sharedSetLayout.anchors,JSON.parse(JSON.stringify(plan.sharedSetLayout.anchors)));
assert.match(sceneBuilderProviderPrompt({mode:"scene",prompt:"Build this set",workspace}),/not alternative room layouts/);
const tiny=boundedSceneBuilderContext(workspace,1100);
assert.ok(tiny.length<=1100);
assert.equal(JSON.parse(tiny).productionPlan.sharedSetLayout.status,"unavailable",
  "if the layout cannot fit, request review rather than guessing from a truncated plan");

// All UI attachment paths enforce the same guard, even when beforeGenerate is
// skipped for edits/batches/simple retries. Existing composition stays intact.
const ui=readFileSync("app/locations-ui.jsx","utf8");
// 5 generation paths + the header's layoutReady() check that keeps waiting plates out of the counts
// and prices (2026-10-03, Locations review)
assert.equal((ui.match(/requireLocationSpatialPlan\(l\);/g)||[]).length,6);
assert.equal((ui.match(/await locationSpatialReferences\(l\)/g)||[]).length,4);
assert.match(ui,/function LocationSpatialPlanEditor/);
assert.match(ui,/fieldset",\{[^}]*disabled:readOnly\|\|busy/);
assert.match(ui,/setCandidate\(result\)/);
assert.match(ui,/onUpdate\((?:owner|planOwner)\.id,\{spatialPlan:reviewed\}/);
assert.ok(!/layout needs review/.test(ui));   // (2026-11-17) the tracker alone says where the card stands: the fold no longer repeats it
console.log("PASS shared spatial plans, review gates, source invalidation, all prompt modes, vision evidence, cancellation and Blender handoff");

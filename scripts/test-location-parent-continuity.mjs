#!/usr/bin/env node
/* Parent/subspace continuity: pure helpers and mocked generation, no paid calls. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const noop=()=>{};
const box={console,setTimeout,clearTimeout,localStorage:{getItem:()=>null},
  scenesInStoryOrder:xs=>xs||[],dispatchEvent:noop,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  renderStyleText:(_kind,key)=>"Style "+key};
box.window=box;vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box);
const parent={id:"house",key:"house",name:"House",renderStyleKey:"anime",renderStyle:"Hand-painted animation",
  architecture:"House with cased doorways",materials:"Oak trim",continuityAnchors:"Kitchen sink under yard window"};
const child={id:"kitchen",key:"kitchen",name:"Kitchen",parentKey:"house",architecture:"Galley kitchen",
  renderStyleKey:"photoreal",renderStyle:"Saved old room style",staging:{mid:{right:"Kitchen table"}}};
box.turnContinuity={locations:[child,parent],scenes:[],drafts:{},characters:[]};
const before=JSON.stringify([child,parent]);
assert.equal(box.locVisualDefaults(child).renderStyle,"Hand-painted animation");
assert.equal(box.locationRenderStyleSource(child),parent);
assert.equal(box.locVisualDefaults({...child,renderStyleIndependent:true}).renderStyle,"Saved old room style");
parent.renderStyle="New parent look";
assert.equal(box.locVisualDefaults(child).renderStyle,"New parent look","parent edits flow live into children");
parent.renderStyle="Hand-painted animation";
assert.equal(JSON.stringify([child,parent]),before,"inheritance does not overwrite child settings");
const layers=box.locationIdentityLayers(child);
assert.equal(layers.continuity_root.invariants.materials,"Oak trim");
assert.equal(layers.child_space.specific_identity.architecture,"Galley kitchen");
assert.match(layers.visual_continuity.rule,/never transplant sibling-room/);
const spec=JSON.parse(box.buildLocationRefPrompt(child,{}).split("\n").slice(1).join("\n"));
assert.equal(spec.render.style,"Hand-painted animation");
assert.ok(!spec.render.rules.includes("photorealistic commercial photography"));
assert.equal(spec.location.space,"Galley kitchen");
assert.equal(box.locationParentOf({id:"other",name:"Kitchen"}),null,"a name alone never establishes ownership");
const grandchild={id:"pantry",key:"pantry",parentKey:"kitchen",name:"Pantry"};
assert.equal(box.locationRenderStyleSource(grandchild,[grandchild,child,parent]),parent);
assert.deepEqual(Array.from(box.locationGenerationOrder([grandchild,child,parent]),x=>x.id),["house","kitchen","pantry"]);
const cyclic=[{id:"a",key:"a",parentKey:"b"},{id:"b",key:"b",parentKey:"a"}];
assert.equal(box.locationGenerationOrder(cyclic).length,2);
assert.ok(box.locationRenderStyleSource(cyclic[0],cyclic));

let images={house:"parent-v1",kitchen:"room-v1"},epoch=1;
box.nbGetImage=id=>images[id]||"";
box.nbLoadImage=async id=>images[id]||"";
box.nbGetMeta=id=>images[id]?{iso:images[id]}:null;
const refs=await box.locationParentReferences(child);
assert.equal(refs[0].required,true);
assert.equal(refs[0].url,"parent-v1");
assert.match(refs[0].note,/reproduce that exact room/);
images.house="parent-v2";
assert.equal((await box.locationParentReferences(child))[0].url,"parent-v2","fresh generation uses the current parent plate");
delete images.house;
await assert.rejects(box.locationParentReferences(child),/Generate or restore House/);
assert.deepEqual(Array.from(await box.locationParentReferences(parent)),[],"standalone roots need no parent image");
await assert.rejects(box.locationParentReferences({...child,parentKey:"missing"}),/Restore the parent location/);
box.nbLoadImage=async id=>id==="house"?"loaded-parent":"";
assert.equal((await box.locationParentReferences(child))[0].url,"loaded-parent","cold-storage references are awaited");
images.house="parent-v3";box.nbLoadImage=async id=>images[id]||"";
const reviewLayout=()=>{parent.spatialPlan=box.normalizeLocationSpatialPlan({
  frame:"From the living-room archway facing the kitchen",status:"reviewed",source:{assetId:"house",iso:images.house},
  anchors:[{id:"table",name:"Dining table",space:"Kitchen",placement:"In front of the fridge"}]});};
reviewLayout();

const generated=[],commits=[];
box.nbEpoch=()=>epoch;
box.nbGenerate=async (prompt,opts)=>{generated.push({prompt,opts});return "rendered";};
box.nbCommit=async (id,url,meta,used)=>{commits.push({id,url,meta,used});return {tier:"local"};};
assert.equal(await box.generateLocationPlate(child,{}),true);
assert.equal(generated[0].opts.extraImages[0],"parent-v3");
assert.match(generated[0].prompt,/binding visual continuity/);
assert.equal(commits[0].meta.locationParentIso,"parent-v3");
assert.equal(commits[0].used[0].url,"parent-v3");
delete images.house;generated.length=0;commits.length=0;
await assert.rejects(box.generateLocationPlate(child,{}),/Generate or restore House/);
assert.equal(generated.length,0,"missing parent blocks paid generation");
assert.equal(commits.length,0);
assert.equal(box.__nbGenInflight.kitchen,undefined,"missing-parent failure cleans the run lock");
images.house="parent-v4";
reviewLayout();
let first=true;
box.nbGenerate=async(prompt,opts)=>{generated.push({prompt,opts});if(first){first=false;throw Error("no image");}return "rendered";};
assert.equal(await box.generateLocationPlate(child,{}),true);
assert.equal(generated.length,2);
assert.ok(generated.every(g=>g.opts.extraImages[0]==="parent-v4"&&g.prompt.includes("binding visual continuity")),
  "simple retries cannot silently discard the required parent reference");
generated.length=0;
box.nbGenerate=async(prompt,opts)=>{generated.push({prompt,opts});return "rendered";};
await box.generateLocationVariant(child,{id:"night",time:"Night",state:"Lights on"},{});
assert.deepEqual(Array.from(generated[0].opts.extraImages),["room-v1","parent-v4"]);
assert.match(generated[0].prompt,/change only the requested environment state/);
delete images.kitchen;generated.length=0;
await assert.rejects(box.generateLocationVariant(child,{id:"night"},{}),/before its environment states/);
assert.equal(generated.length,0);
delete images.house;
let release;
box.nbLoadImage=async()=>new Promise(resolve=>{release=resolve;});
const pending=box.generateLocationPlate(child,{});
await Promise.resolve();epoch++;release("late-parent");
assert.equal(await pending,false);
assert.equal(generated.length,0,"switching films while loading a reference blocks generation");

// Exercise the real draft function with a fake model. It must pass a freshly
// drafted parent's design into the child's later request, not just its name.
const ai=readFileSync("app/ai.jsx","utf8");
const ast=parseSync(ai,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
const draftFn=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="aiDesignLocationBible");
// the real genre helper the prompt header uses
{const g=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="genreTag");vm.runInContext(ai.slice(g.start,g.end),box);}
Object.assign(box,{aiAvailable:()=>true,writingProjectOf:p=>p,writingLoglineOf:()=>"",_lookbookBlock:()=>"",
  extractJSON:JSON.parse,mapLocEntry:e=>e,writingStamp:()=>({}),locationScreenplayContext:()=>"Script evidence"});
const prompts=[];
box.claude={complete:async({messages})=>{
  const prompt=messages[0].content;prompts.push(prompt);
  const ids=Array.from(prompt.matchAll(/^- id:([^ |]+)/gm),m=>m[1]);
  return JSON.stringify({locations:ids.map(id=>({id,materials:id==="house"?"Fresh oak design":"Kitchen tile"}))});
}};
vm.runInContext(ai.slice(draftFn.start,draftFn.end),box);
const drafted=await box.aiDesignLocationBible([child,parent],[],{});
assert.equal(prompts.length,2);
assert.ok(prompts[0].includes("id:house")&&!prompts[0].includes("id:kitchen"));
assert.match(prompts[1],/PARENT DESIGN.*Fresh oak design/);
assert.match(prompts[1],/SCREENPLAY EVIDENCE: Script evidence/);
assert.equal(drafted.kitchen.materials,"Kitchen tile");
assert.equal(parent.materials,"Oak trim","drafting never mutates stored parent records");

// Check the production card's attachment contract, including exclusion state.
const ui=readFileSync("app/locations-ui.jsx","utf8");
const uiAst=parseSync(ui,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
const sheet=uiAst.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="LocationSheet");
const nodes=[];
const visit=n=>{if(!n||typeof n!=="object")return;nodes.push(n);
  for(const [key,value] of Object.entries(n))if(!["loc","start","end"].includes(key)){
    if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==="object")visit(value);
  }};
visit(sheet);
const config=nodes.find(n=>n.type==="CallExpression"&&n.callee.name==="useImageGen").arguments[0];
images={house:"current-parent",kitchen:"room"};box.nbLoadImage=async id=>images[id]||"";
reviewLayout();
box.l={...child,parentLocation:parent};
Object.assign(box,{stagingDraftRef:{current:null},finalPrompt:"SPEC",masterParentSnapshot:{current:{}},
  masterRefOff:["house","page"],buildMasterRefs:()=>[
    box.locationParentReference(child,"old-preview"),{url:"script-page",kind:"script",refId:"page"}
  ]});
const options=vm.runInContext("("+ui.slice(config.start,config.end)+")",box);
assert.equal(options.attachmentsRequired,true);
assert.equal(options.attachmentsInSimple,true);
const attached=await options.attachments();
assert.deepEqual(Array.from(attached,r=>r.url),["current-parent"],
  "the parent cannot be excluded; optional screenplay exclusions still work and stale preview URLs are not reused");
assert.equal(box.masterParentSnapshot.current.locationParentIso,"current-parent");
delete images.house;
await assert.rejects(options.attachments(),/parent plate changed|Generate or restore House/);
const wrapper=nodes.find(n=>n.type==="VariableDeclarator"&&n.id.name==="generatePlate").init;
let completed=null,draftCalls=0;
Object.assign(box,{batchActiveId:"kitchen",onBatchDone:id=>completed=id,
  aiDraftStaging:async()=>{draftCalls++;},appToast:noop});
const generatePlate=vm.runInContext("("+ui.slice(wrapper.start,wrapper.end)+")",box);
assert.equal(await generatePlate(),false);
assert.equal(draftCalls,0,"missing parents block even the preliminary paid staging draft");
assert.equal(completed,"kitchen","a blocked child cannot strand the UI batch queue");
console.log("PASS parent references, live style inheritance, overrides, prompts, ordering, retries, cancellation and drafting");

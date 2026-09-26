#!/usr/bin/env node
/* Narrow source/VM coverage for the Locations Blender Studio section. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync,transformSync} from "@babel/core";

const source=readFileSync("app/locations-ui.jsx","utf8");
const transformed=transformSync(source,{
  presets:[["@babel/preset-react",{runtime:"classic"}]],
  plugins:["@babel/plugin-transform-block-scoping"],
  babelrc:false,configFile:false,filename:"locations-ui.jsx"
}).code;

const noop=()=>{};
const calls=[];
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  Fragment:"fragment",
  useState:init=>[typeof init==="function"?init():init,noop],
  useEffect:noop,useRef:()=>({current:null}),useMemo:f=>f(),useCallback:f=>f
};
const box={
  console,React,
  CardFold:{name:"CardFold"},
  BlenderStudioLaunch:{name:"BlenderStudioLaunch"},
  nbGetMeta:id=>{calls.push({kind:"meta",id});return {iso:"location-v1"};},
  window:null,globalThis:null
};
box.window=box;box.globalThis=box;
vm.createContext(box);
vm.runInContext(transformed,box,{filename:"app/locations-ui.jsx"});

assert.equal(typeof box.LocationBlenderStudioSection,"function","section is exported on window");

const location={
  id:"loc-kitchen",name:"Kitchen",parentLocationId:"loc-house",rootLocationId:"loc-house",
  context:{description:"A working kitchen",architecture:"brick",materials:"tile",staging:"island"}
};
const tree=box.LocationBlenderStudioSection({location,readOnly:true});
assert.equal(tree.type,box.BlenderStudioLaunch,"the card only renders a contextual launcher");

const entries=[];
const visit=node=>{
  if(!node||typeof node!=="object")return;
  if(node.type===box.BlenderStudioLaunch)entries.push(node);
  (node.children||[]).forEach(visit);
};
visit(tree);
assert.equal(entries.length,1,"the section owns one real BlenderStudioEntry");
const entry=entries[0];
assert.equal(entry.props.location,location,"the canonical location object is passed through unchanged");
assert.equal(entry.props.location.parentLocationId,"loc-house","child parent identity is preserved");
assert.equal(entry.props.location.rootLocationId,"loc-house","child root identity is preserved");
assert.deepEqual(entry.props.location.context,location.context);
assert.equal(JSON.stringify(entry.props.references),
  JSON.stringify([{entityId:"loc-kitchen",label:"Kitchen",kind:"location"}]));
assert.equal(entry.props.readOnly,true,"readOnly reaches the real entry");
assert.equal(JSON.stringify(calls),JSON.stringify([{kind:"meta",id:"loc-kitchen"}]),
  "reference metadata is checked only for the canonical ID");

assert.equal(tree.children.length,0,"there is no nested Studio workflow inside the card");
assert.equal(tree.children.some(node=>node&&node.type==="details"),false,
  "the redundant About Blender Studio disclosure is removed");

const ast=parseSync(source,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
const locationSheet=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="LocationSheet");
assert.ok(locationSheet,"LocationSheet is available in the production source");
const createElement=node=>node&&node.type==="CallExpression"&&node.callee.type==="MemberExpression"&&
  node.callee.object.type==="Identifier"&&node.callee.object.name==="React"&&
  node.callee.property.type==="Identifier"&&node.callee.property.name==="createElement";
const firstName=node=>createElement(node)&&node.arguments[0]&&node.arguments[0].type==="Identifier"
  ? node.arguments[0].name : "";
const stringValue=node=>node&&(["StringLiteral","Literal"].includes(node.type))
  ? node.value : undefined;
const propValue=(node,key)=>{
  if(!node||node.type!=="ObjectExpression")return undefined;
  const prop=node.properties.find(p=>p.type==="ObjectProperty"||p.type==="Property"
    ? ((p.key.type==="Identifier"&&p.key.name===key)||(p.key.type==="StringLiteral"&&p.key.value===key))
    : false);
  return prop&&stringValue(prop.value);
};
const astCalls=[];
const walk=node=>{
  if(!node||typeof node!=="object")return;
  if(createElement(node))astCalls.push(node);
  for(const key of Object.keys(node)){
    if(key==="loc"||key==="start"||key==="end")continue;
    const value=node[key];
    if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object")walk(value);
  }
};
walk(locationSheet.body);
const sheetBody=astCalls.find(n=>stringValue(n.arguments[0])==="div"&&
  String(propValue(n.arguments[1],"className")||"")==="sheet-body");
assert.ok(sheetBody,"LocationSheet has a sheet-body producer");
const bodyChildren=sheetBody.arguments.slice(2);
const directStudio=astCalls.find(n=>firstName(n)==="LocationBlenderStudioSection");
assert.ok(directStudio,"LocationSheet produces the contextual launcher");
assert.ok(!bodyChildren.includes(directStudio),"Studio is not a separate top-level section");
const childIndex=n=>bodyChildren.indexOf(n);
const directClass=needle=>bodyChildren.find(n=>createElement(n)&&
  String(propValue(n.arguments[1],"className")||"").split(/\s+/).includes(needle));
const directFold=label=>bodyChildren.find(n=>firstName(n)==="CardFold"&&propValue(n.arguments[1],"label")===label);
const studioIndex=childIndex(directStudio),headIndex=childIndex(directClass("sheet-head")),
  styleIndex=childIndex(directClass("char-style-row")),scenesIndex=childIndex(directClass("location-scenes")),
  viewsIndex=childIndex(directFold("Spatial Layout & Staging")),
  promptIndex=childIndex(directFold("Generation Prompt"));
for(const [name,index] of [["header",headIndex],["render style",styleIndex],["scene chips",scenesIndex],
  ["Spatial Layout & Staging",viewsIndex],["Generation Prompt",promptIndex]])
  assert.ok(index>=0,`LocationSheet retains ${name} before/after Studio`);
const spatialFold=directFold("Spatial Layout & Staging");
assert.ok(spatialFold.start<directStudio.start&&spatialFold.end>directStudio.end,
  "the compact Blender handoff is inside Spatial Layout & Staging");
assert.ok(!astCalls.some(n=>firstName(n)==="LocationSectionHelp"&&
  n.start>spatialFold.start&&n.end<spatialFold.end),
  "Spatial Layout & Staging has no standalone help icon or empty help row");
const unitsFold=directFold("Slugline Units");
assert.ok(!astCalls.some(n=>firstName(n)==="LocationSectionHelp"&&
  n.start>unitsFold.start&&n.end<unitsFold.end),
  "Slugline Units has no standalone help icon or empty help row");
assert.ok(viewsIndex<promptIndex,"set preparation still precedes Generation Prompt");
assert.equal(directFold("Look dev"),undefined,"locations no longer have a standalone Look dev fold");
const promptFold=directFold("Generation Prompt");
const styleDetails=astCalls.find(n=>stringValue(n.arguments[0])==="details"&&
  propValue(n.arguments[1],"className")==="loc-nested-section loc-render-style-details");
assert.ok(styleDetails&&styleDetails.start>promptFold.start&&styleDetails.end<promptFold.end,
  "render style details are nested inside Generation Prompt");
assert.ok(!styleDetails.arguments[1].properties.some(p=>p.key.name==="open"),
  "render style details start collapsed");
const styleField=astCalls.find(n=>firstName(n)==="SheetField"&&
  propValue(n.arguments[1],"label")==="Render style instructions");
assert.ok(styleField&&styleField.start>styleDetails.start&&styleField.end<styleDetails.end,
  "the existing free-text style editor remains available in render style details");
const updates=[];
Object.assign(box,{
  SheetField:{name:"SheetField"},l:{id:"loc-kitchen",renderStyle:"Saved custom style"},
  d:{renderStyle:"Resolved parent style"},styleKey:"anime",onUpdate:(id,patch)=>updates.push({id,...patch})
});
const renderStyleField=()=>vm.runInContext(source.slice(styleField.start,styleField.end),box);
assert.equal(renderStyleField().props.value,"Resolved parent style","the editor displays the effective inherited style");
renderStyleField().props.onCommit("Updated custom style");
assert.deepEqual(updates,[{id:"loc-kitchen",renderStyle:"Updated custom style",renderStyleKey:"anime",renderStyleIndependent:true}],
  "editing the selected room's style explicitly overrides inheritance without changing the parent");
box.l.renderStyle="";
box.d.renderStyle="Default style";
assert.equal(renderStyleField().props.value,"Default style","the original default-style fallback remains");
const producer=source.slice(directStudio.start,directStudio.end);
for(const token of [
  "id:l.id","name:l.name","parentLocationId:l.parentLocation&&l.parentLocation.id||null",
  "rootLocationId:l.rootLocationId||l.id","description:l.significance||",
  "architecture:l.architecture||","materials:l.materials||","staging:l.staging||","productionPlan:"
]) assert.ok(producer.includes(token),"LocationSheet producer keeps "+token);
assert.ok(producer.includes("locationProductionPlan(l,units)"),
  "LocationSheet sends the versioned location production package");
assert.ok(producer.includes("Required Space Plate")&&producer.includes("Time-of-Day Variant"),
  "approved production-layer references are offered to Studio");
assert.equal((source.match(/React\.createElement\(window\.BlenderStudioEntry/g)||[]).length,0,
  "location cards no longer mount the full Studio workflow");
const sectionSource=source.slice(source.indexOf("function LocationBlenderStudioSection"),source.indexOf("function LocationSpatialAnchorEditor"));
assert.doesNotMatch(sectionSource,/useEffect|setTimeout|generate\(|request\(/,
  "opening the section does not add effects, generation, or service calls");

console.log("PASS Locations Blender Studio section wrapper");

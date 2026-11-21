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
// a fold shown on demand ("showPrevis && CardFold(…)") still counts as that fold
const unwrapShown=n=>n&&n.type==="LogicalExpression"&&n.operator==="&&"?unwrapShown(n.right):n;
// 2026-11-15 (owner: one road, "remove Blender"): a location card has no Blender hand-off any more. Its set is drawn
// in 4 · Previs; Blender Studio is opened from the Art Room toolbar, which builds the same production package itself.
assert.equal(astCalls.find(n=>firstName(n)==="LocationBlenderStudioSection"),undefined,"LocationSheet no longer produces the contextual launcher");
/* THE CARD, PICTURE FIRST (owner 2026-11-21, "I like B"): each section is made as a named part of LocationSheet and
   shown in one of four tabs. A part is read here by its name; the tabs' own lines say where each is shown, in order. */
const parts={};
(function decls(node){
  if(!node||typeof node!=="object")return;
  if(node.type==="VariableDeclarator"&&node.id&&node.id.type==="Identifier"&&node.init&&!(node.id.name in parts))parts[node.id.name]=unwrapShown(node.init);
  for(const key of Object.keys(node)){
    if(key==="loc"||key==="start"||key==="end")continue;
    const value=node[key];
    if(Array.isArray(value))value.forEach(decls);else if(value&&typeof value==="object")decls(value);
  }
})(locationSheet.body);
const sheetSource=source.slice(locationSheet.start,locationSheet.end);
const hasClass=(n,needle)=>!!n&&createElement(n)&&String(propValue(n.arguments[1],"className")||"").split(/\s+/).includes(needle);
const labelSource=n=>{const prop=n&&createElement(n)&&firstName(n)==="CardFold"&&n.arguments[1].properties.find(p=>p.key&&p.key.name==="label");
  return prop?source.slice(prop.value.start,prop.value.end):"";};
const cardFolds=astCalls.filter(n=>firstName(n)==="CardFold");
const foldLabelled=label=>cardFolds.find(n=>propValue(n.arguments[1],"label")===label);
assert.ok(hasClass(parts.headEl,"sheet-head"),"LocationSheet retains header");
assert.ok(hasClass(parts.styleRowEl,"char-style-row"),"LocationSheet retains render style");
assert.ok(sheetSource.includes('render:()=>React.createElement(LocationScenesList,{l,locScenes,units:evidenceUnits,onChipClick})'),"LocationSheet retains its scenes, as a tab");
assert.equal(labelSource(parts.foldSpace),'"1 \\u00b7 The Space"');
assert.equal(labelSource(parts.foldPlan),'"2 \\u00b7 Floor plan"');
assert.equal(labelSource(parts.foldCameras),'"3 \\u00b7 Cameras"');
assert.equal(labelSource(parts.foldPrevis),'"4 \\u00b7 Previs"');
assert.equal(labelSource(parts.foldImage),'sectionNo.image+" \\u00b7 Location image"');
assert.equal(labelSource(parts.foldSubspaces),'"Subspaces"');
assert.equal(labelSource(parts.foldPrompt),'"Generation Prompt"');
// the four tabs, and what each holds, in order: the set's steps in Set; the description, the look and the prompt in About
assert.ok(sheetSource.includes('{id:"todo",name:"To do",render:()=>React.createElement(LocationTodoList,{l,steps:cardSteps,looks,onLook:pickLook})},'));
assert.ok(sheetSource.includes('{id:"set",name:"Set",render:()=>React.createElement(React.Fragment,null,foldPlan,foldCameras,foldPrevis,foldSubspaces)},'));
assert.ok(sheetSource.includes('{id:"about",name:"About",render:()=>React.createElement(React.Fragment,null,foldSpace,styleRowEl,foldImage,foldPrompt)}]})));'),
  "Generation Prompt is its own section, the last one");
const spatialFold=parts.foldPlan,promptFold=parts.foldPrompt,imageFold=parts.foldImage;
assert.equal(foldLabelled("More"),undefined,"the More section is gone (owner 2026-11-13)");
const within=(fold,name)=>{const src=source.slice(fold.start,fold.end);return new RegExp("\\b"+name+"\\b").test(src);};
assert.equal(foldLabelled("Blender Studio"),undefined,"no Blender Studio section");
assert.equal(cardFolds.find(n=>/Build the set|Style it/.test(String(propValue(n.arguments[1],"label")||""))),undefined,"no Build the set or Style it section");
assert.ok(!/studioHandoff|loc-own-blender|BlenderStudioLaunch/.test(sheetSource),"no hand-off box anywhere on the card");
assert.ok(imageFold&&within(imageFold,"QaCheckButton")&&!within(promptFold,"QaCheckButton"),"the QA check sits in the image's own section");
assert.ok(!astCalls.some(n=>firstName(n)==="LocationSectionHelp"&&
  n.start>spatialFold.start&&n.end<spatialFold.end),
  "2 · Floor plan has no standalone help icon or empty help row");
// Variants are the card's LOOKS now (a row of them under the name), no longer a section
assert.equal(cardFolds.find(n=>/Variants/.test(labelSource(n))),undefined,"no Variants section: they are the looks");
assert.ok(sheetSource.includes('React.createElement(LocationLooks,{looks,selected:lookNow,onSelect:pickLook,onAdd:addVariant,readOnly}),'));
// 2026-10-05 (owner): the editable style settings moved ON the card (collapsed), before the read-only Generation Prompt
// …and since 2026-11-15 (owner) as The look (Look Dev from 2026-11-13 until then): the look of the image, so in the image's own numbered
// section (Location image), before Generation Prompt
const lookFold=imageFold;
assert.ok(astCalls.some(n=>stringValue(n.arguments[0])==="h4"&&stringValue(n.arguments[2])==="The look"&&n.start>lookFold.start&&n.end<lookFold.end),
  "The look is a heading inside the section");
assert.ok(!source.slice(locationSheet.start,locationSheet.end).includes('"Look Dev"'),"the old name is gone from the card");
assert.equal(foldLabelled("Look & exclusions"),undefined);
assert.equal(foldLabelled("The look"),undefined,"The look is not a section of its own");
assert.ok(lookFold.arguments[1].properties.some(p=>p.key&&p.key.name==="defaultOpen"&&p.value&&p.value.value===false),"Location image starts collapsed");
const styleDetails=astCalls.find(n=>stringValue(n.arguments[0])==="div"&&
  propValue(n.arguments[1],"className")==="loc-render-style-details");
assert.ok(styleDetails&&styleDetails.start>lookFold.start&&styleDetails.end<lookFold.end,
  "render style details are inside Location image, under The look");
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
// the toolbar's launcher builds the versioned location production package itself, so nothing is lost with the card's box
const launcher=readFileSync(new URL("../app/blender-studio-ui.jsx",import.meta.url),"utf8");
assert.ok(launcher.includes("locationProductionPlan(l,units||[])"),"Blender Studio still sends the versioned location production package");
assert.equal((source.match(/React\.createElement\(window\.BlenderStudioEntry/g)||[]).length,0,
  "location cards no longer mount the full Studio workflow");
const sectionSource=source.slice(source.indexOf("function LocationBlenderStudioSection"),source.indexOf("function LocationSpatialAnchorEditor"));
assert.doesNotMatch(sectionSource,/useEffect|setTimeout|generate\(|request\(/,
  "opening the section does not add effects, generation, or service calls");

console.log("PASS Locations Blender Studio section wrapper");

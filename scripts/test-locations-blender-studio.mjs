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
// a fold shown on demand ("showPrompt && CardFold(…)", the ⋯ menu's "Show the generation prompt",
// 2026-10-03) still counts as that fold, in place
// a part handed to the set card on a place's own card (slot("nameRow", …), slot("plan", …), 2026-11-23) is still
// written here, in its place, and drawn here on a room's card
const unwrapShown=n=>n&&n.type==="LogicalExpression"&&n.operator==="&&"?unwrapShown(n.right)
  :n&&n.type==="CallExpression"&&n.callee.type==="Identifier"&&n.callee.name==="slot"&&n.arguments.length===2?unwrapShown(n.arguments[1]):n;
const bodyChildren=sheetBody.arguments.slice(2).map(unwrapShown);
// 2026-11-15 (owner: one road, "remove Blender"): a location card has no Blender hand-off any more. Its set is drawn
// in Previs; Blender Studio is opened from the Art Room toolbar, which builds the same production package itself.
assert.equal(astCalls.find(n=>firstName(n)==="LocationBlenderStudioSection"),undefined,"LocationSheet no longer produces the contextual launcher");
const childIndex=n=>bodyChildren.indexOf(n);
const directClass=needle=>bodyChildren.find(n=>createElement(n)&&
  String(propValue(n.arguments[1],"className")||"").split(/\s+/).includes(needle));
const directFold=label=>bodyChildren.find(n=>firstName(n)==="CardFold"&&propValue(n.arguments[1],"label")===label);
// FIVE SECTIONS, NO NUMBERS (owner 2026-11-21, "build the 5 sections, no numbers"; they were eight, numbered): The place, Floor plan,
// The set in 3D (a group: Cameras, Previs), Variants, Advanced (a group: Look & exclusions, Quick image & image check, Generation prompt),
// and Rooms on a place that has rooms. A group is a CardGroup; its parts are CardFolds inside it.
const directGroup=label=>bodyChildren.find(n=>firstName(n)==="CardGroup"&&propValue(n.arguments[1],"label")===label);
const partsOf=group=>group?group.arguments.slice(2).map(unwrapShown).filter(n=>firstName(n)==="CardFold"):[];
const partOf=(group,label)=>partsOf(group).find(n=>propValue(n.arguments[1],"label")===label);
const setGroup=directGroup("The set in 3D"),advanced=directGroup("Advanced");
assert.ok(setGroup&&advanced,"LocationSheet has its two groups of parts");
assert.deepEqual(partsOf(setGroup).map(n=>propValue(n.arguments[1],"label")),["Cameras","Previs"]);
assert.deepEqual(partsOf(advanced).map(n=>propValue(n.arguments[1],"label")),["Look & exclusions","Quick image & image check","Generation prompt"]);
// no section's name is built from a number any more
assert.ok(!/sectionNo|locationSectionNumbers/.test(source),"no section number is computed");
for(const n of bodyChildren.filter(n=>["CardFold","CardGroup"].includes(firstName(n)))){
  const prop=n.arguments[1].properties.find(p=>p.key&&p.key.name==="label");
  assert.ok(prop&&!/\d \\u00b7 |\d · /.test(source.slice(prop.value.start,prop.value.end)),"no number on a section");
}
const headIndex=childIndex(directClass("sheet-head")),
  styleIndex=childIndex(directClass("char-style-row")),scenesIndex=childIndex(directClass("location-scenes")),
  // the prompt is the last part of the last section (Advanced)
  viewsIndex=childIndex(directFold("Floor plan")),
  promptIndex=childIndex(advanced);
for(const [name,index] of [["header",headIndex],["render style",styleIndex],["scene chips",scenesIndex],
  ["Floor plan",viewsIndex],["Generation prompt (in Advanced)",promptIndex]])
  assert.ok(index>=0,`LocationSheet retains ${name}`);
// the sections in the order of the work
const roomsFold=bodyChildren.find(n=>firstName(n)==="CardFold"&&/hasRooms\?"Rooms":"Extra spaces"/.test(source.slice(n.arguments[1].start,n.arguments[1].end)));
assert.ok(roomsFold,"Rooms (it was Subspaces) is a section of its own, on a place with rooms");
const order=[directFold("The place"),directFold("Floor plan"),setGroup,directFold("Variants"),roomsFold,advanced].map(childIndex);
assert.ok(order.every((x,i)=>x>=0&&(i===0||x>order[i-1])),"The place, Floor plan, The set in 3D, Variants, Rooms, Advanced");
const spatialFold=directFold("Floor plan");
assert.equal(directFold("More"),undefined,"the More section is gone (owner 2026-11-13)");
const within=(fold,name)=>{const src=source.slice(fold.start,fold.end);return new RegExp("\\b"+name+"\\b").test(src);};
assert.equal(directFold("Blender Studio"),undefined,"no section without a number");
assert.equal(bodyChildren.find(n=>firstName(n)==="CardFold"&&/Build the set|Style it/.test(String(propValue(n.arguments[1],"label")||""))),undefined,"no Build the set or Style it section");
assert.ok(!/studioHandoff|loc-own-blender|BlenderStudioLaunch/.test(source.slice(locationSheet.start,locationSheet.end)),"no hand-off box anywhere on the card");
const promptFold=partOf(advanced,"Generation prompt");
assert.ok(promptFold&&childIndex(advanced)===bodyChildren.length-1&&partsOf(advanced).indexOf(promptFold)===partsOf(advanced).length-1,
  "Generation prompt is its own part, the last one of the last section");
const imageFold=partOf(advanced,"Quick image & image check");
assert.ok(imageFold&&within(imageFold,"QaCheckButton")&&!within(promptFold,"QaCheckButton"),"the QA check sits with the quick image");
assert.ok(!astCalls.some(n=>firstName(n)==="LocationSectionHelp"&&
  n.start>spatialFold.start&&n.end<spatialFold.end),
  "Floor plan has no standalone help icon or empty help row");
const unitsFold=directFold("Variants");   // Rooms & times (owner 2026-10-03) until the tree (owner 2026-11-13); no number since 2026-11-21
assert.ok(!astCalls.some(n=>firstName(n)==="LocationSectionHelp"&&
  n.start>unitsFold.start&&n.end<unitsFold.end),
  "Variants has no standalone help icon or empty help row");
assert.ok(viewsIndex<promptIndex,"set preparation still precedes Generation Prompt");
// 2026-10-05 (owner): the editable style settings moved ON the card (collapsed), before the read-only Generation Prompt
// …as The look, in the Location image section, from 2026-11-15; since 2026-11-21 (five sections) as Look & exclusions, the
// first part of Advanced: after the set and the variants, before the quick image and the prompt
const describeFold=directFold("The place");
const lookFold=partOf(advanced,"Look & exclusions");
assert.ok(lookFold&&describeFold&&childIndex(describeFold)<viewsIndex&&viewsIndex<childIndex(setGroup)&&
  childIndex(unitsFold)<childIndex(advanced)&&lookFold.start<imageFold.start&&imageFold.start<promptFold.start,
  "Look & exclusions is in Advanced: after the set and the variants, before the quick image and the prompt");
assert.ok(!astCalls.some(n=>stringValue(n.arguments[0])==="h4"&&stringValue(n.arguments[2])==="The look"),
  "the part's own name says it: no second heading inside");
assert.ok(!source.slice(locationSheet.start,locationSheet.end).includes('"Look Dev"'),"the old name is gone from the card");
assert.equal(directFold("Look & exclusions"),undefined,"it is a part of Advanced, not a section of its own");
assert.equal(directFold("The look"),undefined);
assert.ok(lookFold.arguments[1].properties.some(p=>p.key&&p.key.name==="defaultOpen"&&p.value&&p.value.value===false),"Look & exclusions starts collapsed");
assert.ok(!advanced.arguments[1].properties.some(p=>p.key&&p.key.name==="defaultOpen"),"Advanced starts closed, as on a character or a prop card");
const styleDetails=astCalls.find(n=>stringValue(n.arguments[0])==="div"&&
  propValue(n.arguments[1],"className")==="loc-render-style-details");
assert.ok(styleDetails&&styleDetails.start>lookFold.start&&styleDetails.end<lookFold.end,
  "render style details are inside Look & exclusions");
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

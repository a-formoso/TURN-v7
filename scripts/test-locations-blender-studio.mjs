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
  BlenderStudioEntry:{name:"BlenderStudioEntry"},
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
assert.equal(tree.type,box.CardFold,"the section uses the real CardFold");
assert.equal(tree.props.label,"Blender Studio · reusable set");
assert.equal(tree.props.defaultOpen,false,"the reusable-set fold starts closed");

const entries=[];
const visit=node=>{
  if(!node||typeof node!=="object")return;
  if(node.type===box.BlenderStudioEntry)entries.push(node);
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
assert.equal(entry.props.compact,true,"the compact entry contract is preserved");
assert.equal(JSON.stringify(calls),JSON.stringify([{kind:"meta",id:"loc-kitchen"}]),
  "reference metadata is checked only for the canonical ID");

const details=tree.children.find(node=>node&&node.type==="details");
assert.ok(details,"About Blender Studio is expandable");
assert.equal(details.children[0].type,"summary");
assert.equal(details.children[0].children[0],"About Blender Studio");
const helpText=JSON.stringify(details);
for(const phrase of [
  "reusable 3D set","Shots Blender preview","one-shot proof","Arrange objects and lighting",
  "3D models from a prompt or image","basic character or camera movement",
  "not a complete performance","Review the proposal","Apply",
  "cost credits","acknowledge paid processing",
  "Reference images","exact reconstructions","no pairing","Open current workspace",
  "Refresh","parent and root relationships","full building map"
]) assert.ok(helpText.includes(phrase),"help mentions "+phrase);

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
const directStudio=bodyChildren.find(n=>firstName(n)==="LocationBlenderStudioSection");
assert.ok(directStudio,"LocationSheet produces the wrapper inside the sheet body");
const childIndex=n=>bodyChildren.indexOf(n);
const directClass=needle=>bodyChildren.find(n=>createElement(n)&&
  String(propValue(n.arguments[1],"className")||"").split(/\s+/).includes(needle));
const directFold=label=>bodyChildren.find(n=>firstName(n)==="CardFold"&&propValue(n.arguments[1],"label")===label);
const studioIndex=childIndex(directStudio),headIndex=childIndex(directClass("sheet-head")),
  styleIndex=childIndex(directClass("char-style-row")),scenesIndex=childIndex(directClass("location-scenes")),
  stagingIndex=childIndex(directFold("Staging & composition")),lookIndex=childIndex(directFold("Look dev"));
for(const [name,index] of [["header",headIndex],["render style",styleIndex],["scene chips",scenesIndex],
  ["Staging & composition",stagingIndex],["Look dev",lookIndex]])
  assert.ok(index>=0,`LocationSheet retains ${name} before/after Studio`);
assert.ok(headIndex<studioIndex&&styleIndex<studioIndex&&scenesIndex<studioIndex,
  "Studio follows the location header, render style, and scenes");
assert.ok(stagingIndex<studioIndex&&studioIndex<lookIndex,
  "Studio is after Staging & composition and before Look dev");
const producer=source.slice(directStudio.start,directStudio.end);
for(const token of [
  "id:l.id","name:l.name","parentLocationId:l.parentLocation&&l.parentLocation.id||null",
  "rootLocationId:l.rootLocationId||l.id","description:l.significance||",
  "architecture:l.architecture||","materials:l.materials||","staging:l.staging||"
]) assert.ok(producer.includes(token),"LocationSheet producer keeps "+token);
assert.equal((source.match(/React\.createElement\(window\.BlenderStudioEntry/g)||[]).length,1,
  "there is no duplicate direct BlenderStudioEntry producer");
const sectionSource=source.slice(source.indexOf("function LocationBlenderStudioSection"),locationSheet.start);
assert.doesNotMatch(sectionSource,/useEffect|setTimeout|generate\(|request\(/,
  "reading the section/help does not add effects, generation, or service calls");

console.log("PASS Locations Blender Studio section wrapper/help");
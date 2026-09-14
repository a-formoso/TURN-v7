#!/usr/bin/env node
/* Narrow source/VM coverage for the Locations Blender Studio section. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";

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

const sheetStart=source.indexOf("function LocationSheet(");
const sectionCall=source.indexOf("React.createElement(LocationBlenderStudioSection",sheetStart);
assert.ok(sectionCall>sheetStart,"LocationSheet produces the wrapper");
const producer=source.slice(sectionCall,source.indexOf("panelEdit && gen.genUrl",sectionCall));
for(const token of [
  "id:l.id","name:l.name","parentLocationId:l.parentLocation&&l.parentLocation.id||null",
  "rootLocationId:l.rootLocationId||l.id","description:l.significance||",
  "architecture:l.architecture||","materials:l.materials||","staging:l.staging||"
]) assert.ok(producer.includes(token),"LocationSheet producer keeps "+token);
assert.equal((source.match(/React\.createElement\(window\.BlenderStudioEntry/g)||[]).length,1,
  "there is no duplicate direct BlenderStudioEntry producer");
const sectionSource=source.slice(source.indexOf("function LocationBlenderStudioSection"),sheetStart);
assert.doesNotMatch(sectionSource,/useEffect|setTimeout|generate\(|request\(/,
  "reading the section/help does not add effects, generation, or service calls");

console.log("PASS Locations Blender Studio section wrapper/help");
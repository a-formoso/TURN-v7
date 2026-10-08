#!/usr/bin/env node
/* A room/time unit owns one image and one environment editor. UI consolidation
   must not migrate asset IDs, lose legacy notes or erase manual alternate looks. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:init=>[init,noop],useEffect:noop,useRef:v=>({current:v}),
};
let generator;
const box={console,React,setTimeout,clearTimeout,
  localStorage:{getItem:()=>null,setItem:noop},document:{},
  SheetFrame:function SheetFrame(){},SheetField:function SheetField(){},
  CoverageReferenceStrip:function CoverageReferenceStrip(){},Icon:{alert:noop,x:noop},
  useImageGen:options=>{generator=options;return {};},
};
box.window=box;
vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box);
vm.runInContext(readFileSync("app/locations-ui.jsx","utf8"),box);
const units=[
  {key:"kitchen|INT|Night",subspaceKey:"kitchen",name:"Kitchen",intExt:"INT",time:"Night",appearance:"",sceneNos:[3],occurrences:[]},
  {key:"kitchen|INT|Dawn",subspaceKey:"kitchen",name:"Kitchen",intExt:"INT",time:"Dawn",appearance:"",sceneNos:[6],occurrences:[]},
  {key:"kitchen|INT|Day",subspaceKey:"kitchen",name:"Kitchen",intExt:"INT",time:"Day",appearance:"Preserved orphan note",orphan:true},
];
const l={id:"loc-kitchen",key:"kitchen",name:"Kitchen",variants:[
  {id:"legacy-dawn",time:"Dawn",state:"Soft dawn light, practicals off"},
  {id:"storm",time:"Dawn",state:"Rain lashes the windows",manualState:true},
  {id:"winter",time:"Winter",state:"Snow beyond the window"},
]};
const snapshot=JSON.stringify({l,units});
let view=box.locationEnvironmentPresentation(l,units);
assert.equal(view.units.length,3,"script units and preserved orphans remain accessible");
assert.equal(view.units[1].appearance,"Soft dawn light, practicals off","legacy notes appear in the unit editor and prompt");
assert.equal(view.units[2].appearance,"Preserved orphan note");
assert.deepEqual(Array.from(view.additional,v=>v.id),["storm","winter"],"scripted Dawn has no second state card");
assert.equal(JSON.stringify({l,units}),snapshot,"rendering never rewrites saved records");
const dawnState=view.states.find(v=>v.linkedUnit);
const imageId=box.sluglineUnitImageId(units[1].key);
assert.equal(box.locationAppearanceStateAssetId(l,dawnState,units),imageId);
assert.equal(box.locationAppearanceStateAssetId(l,view.additional[0],units),"loc-kitchen-storm","manual Dawn storm retains its distinct asset");

let unitWrite,locationWrite;
box.saveLocationUnitEnvironment(l,view.units[1],view.states,"",
  (key,patch)=>{unitWrite={key,patch};},(id,patch)=>{locationWrite={id,patch};});
assert.equal(unitWrite.key,units[1].key);
assert.equal(unitWrite.patch.appearance,"");
assert.equal(locationWrite.id,l.id);
assert.equal(locationWrite.patch.variants[0].state,"");
assert.equal(locationWrite.patch.variants[1],l.variants[1],"clearing a linked note does not touch an independent state");
view=box.locationEnvironmentPresentation({...l,...locationWrite.patch},units.map(u=>u.key===unitWrite.key?{...u,...unitWrite.patch}:u));
assert.equal(view.units[1].appearance,"","cleared notes cannot resurrect from a legacy alias");

locationWrite=null;
box.saveLocationUnitEnvironment(l,units[0],view.states,"One warm table lamp",
  (key,patch)=>{unitWrite={key,patch};},(id,patch)=>{locationWrite={id,patch};});
assert.equal(unitWrite.patch.appearance,"One warm table lamp");
assert.equal(locationWrite,null,"editing baseline notes creates no extra variant record");

const bound={...l,variants:[{id:"bound",unitKey:units[1].key,time:"Dawn",state:"Bound custom state",manualState:true}]};
const boundView=box.locationEnvironmentPresentation(bound,units);
assert.equal(boundView.additional.length,0,"explicitly linked manual states also use the one unit editor");
assert.equal(boundView.units[1].appearance,"Bound custom state");

// Exercise the actual unit card: one generator, one frame, same saved asset ID,
// and the displayed environment notes feed that generator without a variant card.
box.buildSluglineUnitPrompt=(location,unit)=>unit.appearance;
const tree=box.SluglineUnitCard({l,u:boundView.units[1],project:{},scenes:[],drafts:{},onEnvironmentChange:noop});
const flatten=node=>!node||typeof node!=="object"?[]:[node,...(node.children||[]).flatMap(flatten)];
const nodes=flatten(tree);
assert.equal(nodes.filter(n=>n.type===box.SheetFrame).length,1);
assert.equal(generator.id,imageId,"the surviving unit card uses the original image and history ID");
assert.equal(generator.buildFinal(),"Bound custom state","generation consumes the same notes the editor displays");
assert.equal(nodes.find(n=>n.type===box.SheetField).props.value,"Bound custom state");
const source=readFileSync("app/locations-ui.jsx","utf8");
assert.ok(!source.includes('label:"Time-of-Day Variants"'),"no duplicate top-level time variants fold");
assert.ok(source.includes('"Additional environment states"'));
console.log("PASS consolidated unit environments, legacy edits, independent states and one-plate generation");

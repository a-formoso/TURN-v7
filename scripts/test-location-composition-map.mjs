#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

let selection;
const noop=()=>{};
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:init=>{if(selection===undefined)selection=init;return [selection,next=>selection=next];}};
const box={console,React,localStorage:{getItem:()=>null},window:null,
  EditText:function EditText(){},SheetField:function SheetField(){},Icon:{sparkles:noop,camera:noop,eye:noop,layers:noop,x:noop,plus:noop}};
box.window=box;vm.createContext(box);
vm.runInContext(readFileSync("app/locations.jsx","utf8"),box);
vm.runInContext(readFileSync("app/locations-ui.jsx","utf8"),box);
const flatten=n=>!n||typeof n!=="object"?[]:[n,...(n.children||[]).flatMap(flatten)];
const hasClass=(n,name)=>(n.props.className||"").split(" ").includes(name);
const byClass=(tree,name)=>flatten(tree).find(n=>hasClass(n,name));
const text=n=>n==null||n===false?"":typeof n==="object"?(n.children||[]).map(text).join(""):String(n);
const staging={viewLabel:"Kitchen principal view",scaleClass:"Human scale",lens:"35mm",floor:"Worn linoleum",
  bg:{left:"Cupboards",center:"Sink and window",right:"Calendar"},
  mid:{left:"Counter",center:"",right:"Table"},fg:{left:"Mug",right:"Door jamb"},customField:"retained"};
const l={id:"kitchen",name:"Kitchen",staging};
let saved=null,drafted=0;
const props={l,value:staging,lockViewLabel:true,onChange:s=>saved=s,onDraftStaging:()=>drafted++};
let tree=box.StagingGrid(props);
const zones=t=>flatten(t).filter(n=>hasClass(n,"stage-zone"));
const editor=t=>flatten(byClass(t,"stage-zone-editor")).find(n=>n.type===box.EditText);
assert.equal(zones(tree).length,8,"eight landmark zones; near centre remains the implicit camera");
assert.equal(editor(tree).props.value,"Sink and window");
assert.equal(zones(tree).filter(n=>n.props["aria-pressed"]).length,1);
assert.equal(text(byClass(tree,"stage-map-title")),"View composition");
assert.equal(text(byClass(tree,"stage-map-direction")),"Farther from the camera");
assert.deepEqual(flatten(tree).filter(n=>hasClass(n,"stage-map-depth")).map(text),["Far","Middle","Near"]);
assert.ok(byClass(tree,"stage-map-cone"));
assert.ok(text(tree).includes("not a measured floor plan"));
assert.ok(text(byClass(tree,"stage-map-camera")).includes("Camera"));
assert.ok(!byClass(tree,"stage-view-details").props.open);
assert.equal(drafted,0,"rendering the diagram never calls AI");
assert.equal(saved,null);

for(const [plane,label,cols] of [["bg","Far",["left","center","right"]],["mid","Middle",["left","center","right"]],["fg","Near",["left","right"]]]){
  for(const col of cols){
    const position={left:"left",center:"centre",right:"right"}[col];
    saved=null;
    zones(tree).find(n=>n.props["aria-label"].startsWith(label+" "+position+":")).props.onClick();
    tree=box.StagingGrid(props);
    assert.equal(saved,null,"selection does not save or overwrite data");
    assert.equal(editor(tree).props.value,staging[plane][col]);
    assert.equal(zones(tree).filter(n=>n.props["aria-pressed"]).length,1);
    editor(tree).props.onCommit("Edited "+plane+" "+col);
    const expected=JSON.parse(JSON.stringify(staging));
    expected[plane][col]="Edited "+plane+" "+col;
    assert.deepEqual(JSON.parse(JSON.stringify(saved)),expected,"only the targeted field changes");
  }
}
assert.equal(staging.mid.right,"Table","source record is not mutated");
byClass(tree,"stage-map-floor").props.onClick();tree=box.StagingGrid(props);
assert.equal(editor(tree).props.value,"Worn linoleum");
assert.equal(zones(tree).filter(n=>n.props["aria-pressed"]).length,0);
editor(tree).props.onCommit("Tile");assert.equal(saved.floor,"Tile");assert.equal(saved.fg.right,"Door jamb");
zones(tree).find(n=>n.props["aria-label"].startsWith("Middle centre:")).props.onClick();tree=box.StagingGrid(props);
assert.equal(editor(tree).props.value,"");
assert.ok(zones(tree).find(n=>n.props["aria-pressed"]).props["aria-label"].endsWith("Open space"));
editor(tree).props.onCommit("");assert.equal(saved.mid.center,"");
const draftButton=flatten(tree).find(n=>n.type==="button"&&text(n)==="Draft layout");
draftButton.props.onClick();assert.equal(drafted,1);
assert.equal(flatten(box.StagingGrid({...props,draftingStage:true})).find(n=>n.type==="button"&&text(n)==="Drafting…").props.disabled,true);
assert.equal(text(byClass(box.StagingGrid({...props,target:"North wall",cameraPosition:"Doorway"}),"stage-map-direction")),"Looking toward: North wall");
assert.ok(text(byClass(box.StagingGrid({...props,cameraPosition:"Doorway"}),"stage-map-camera-caption")).includes("Doorway"));

let patch,added=0,removed;
const views=[{id:"v1",name:"Wide",staging,purpose:"Establish the kitchen",target:"Window",cameraPosition:"Doorway"},
  {id:"v2",name:"Reverse",staging:{...staging,viewLabel:"Reverse"}}];
const viewTree=box.CoverageViewsEditor({l,views,onUpdateView:(id,value)=>patch={id,value},onDraftStaging:noop,
  onAdd:()=>added++,onRemove:id=>removed=id});
const maps=flatten(viewTree).filter(n=>n.type===box.StagingGrid);
assert.equal(maps.length,2);
assert.equal(maps[0].props.target,"Window");assert.equal(maps[0].props.cameraPosition,"Doorway");
assert.ok(text(byClass(viewTree,"loc-layer-note")).startsWith("Plan what the camera sees:"));
assert.equal(maps[0].props.onDraftStaging,noop);assert.equal(maps[1].props.onDraftStaging,null);
maps[1].props.onChange({...staging,lens:"50mm"});
assert.equal(patch.id,"v2","edits stay scoped to the selected coverage view");assert.equal(patch.value.lens,"50mm");
const detailFields=flatten(maps[0].props.viewDetails).filter(n=>n.type===box.SheetField);
assert.deepEqual(detailFields.map(n=>n.props.label),["Purpose / framing","Camera position","Target","Visible fixed landmarks"]);
detailFields[2].props.onCommit("Archway");assert.equal(patch.id,"v1");assert.equal(patch.value.target,"Archway");
flatten(viewTree).find(n=>n.type==="button"&&text(n)==="Add camera view").props.onClick();assert.equal(added,1);
flatten(viewTree).filter(n=>n.props.title==="Remove camera view")[1].props.onClick();assert.equal(removed,"v2");

selection=undefined;
const emptyTree=box.StagingGrid({l:{id:"empty",name:"Empty"},onUpdate:(id,value)=>patch={id,value}});
assert.equal(editor(emptyTree).props.value,"");
assert.ok(zones(emptyTree).every(n=>n.props["aria-label"].endsWith("Open space")));
editor(emptyTree).props.onCommit("Distant ridge");
assert.equal(patch.id,"empty");assert.equal(patch.value.staging.bg.center,"Distant ridge");
assert.equal(patch.value.staging.mid.center,"");
assert.ok(readFileSync("app/ai.jsx","utf8").includes("VISUAL COMPOSITION MAP"));
console.log("PASS restored composition map, selection, editing, data preservation, view isolation and drafting controls");

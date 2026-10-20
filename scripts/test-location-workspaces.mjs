#!/usr/bin/env node
/* Navigation regression: grouping must never change a room's storage identity
   or strand the batch generator on a child that is not mounted. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

let state, effects=[];
// each effect keeps its own deps, by call order (the workspace has two effects since 2026-10-20)
const effectDeps=[]; let effectAt=0;
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:init=>{effectAt=0;if(state===undefined)state=init;return [state,next=>{state=next;}];},
  useEffect:(fn,deps)=>{
    const i=effectAt++, prev=effectDeps[i];
    if(!prev||deps.some((v,k)=>v!==prev[k]))effects.push(fn);
    effectDeps[i]=deps;
  }
};
const box={console,React,window:null};box.window=box;
vm.createContext(box);
vm.runInContext(readFileSync("app/locations-ui.jsx","utf8"),box);
const house={id:"house",rootLocationId:"house",name:"House",scenes:["s1"]};
const kitchen={id:"kitchen",rootLocationId:"house",name:"Kitchen",scenes:["s3","s6"],staging:{lens:"35mm"}};
const living={id:"living",rootLocationId:"house",name:"Living Room",scenes:["s6"]};
const office={id:"office",rootLocationId:"office",name:"Office",scenes:["s2"]};
const missing={id:"orphan",rootLocationId:"missing",name:"Room with missing parent",scenes:[]};
const input=[kitchen,office,house,living,missing];
const before=JSON.stringify(input);
const groups=box.locationWorkspaceGroups(input);
assert.deepEqual(Array.from(groups,g=>g.root.id),["house","office","orphan"]);
const group=groups[0];
assert.deepEqual(Array.from(group.members,m=>m.id),["house","kitchen","living"]);
assert.equal(group.members[1],kitchen,"room retains its original record and asset identity");
assert.deepEqual(Array.from(group.root.scenes).sort(),["s1","s3","s6"]);
assert.equal(JSON.stringify(input),before,"grouping never mutates persisted locations");
assert.equal(groups[2].root.id,"orphan","missing parents must not hide surviving rooms");

let rendered;
const props={group,matchingIds:["house","kitchen","living"],filterKey:"|",batchActiveId:null,
  renderLocation:(l,options)=>{rendered={l,options};return {type:"sheet",props:{id:l.id}};}};
const render=()=>{let tree=box.LocationWorkspace(props);while(effects.length){effects.splice(0).forEach(f=>f());tree=box.LocationWorkspace(props);}return tree;};
const find=(tree,type)=>tree.type===type?tree:tree.children?.map(n=>n&&typeof n==="object"?find(n,type):null).find(Boolean);
let tree=render();
assert.equal(rendered.l.id,"house");
find(tree,"select").props.onChange({target:{value:"kitchen"}});
render();
assert.equal(rendered.l,kitchen);
rendered.options.onSelectLocation("living","units");
render();
assert.equal(rendered.l,living);
assert.equal(rendered.options.initialSection,"units","unit links open the requested room section");
props.batchActiveId="kitchen";
tree=render();
assert.equal(rendered.l,kitchen,"batch targets are mounted even when another room was selected");
assert.equal(find(tree,"select").props.disabled,true);
props.batchActiveId="house";render();assert.equal(rendered.l.id,"house");
props.batchActiveId=null;render();assert.equal(rendered.l,living,"selection resumes after batch");
props.matchingIds=["kitchen"];props.filterKey="|kitchen";render();
assert.equal(rendered.l,kitchen,"search can surface a matching room inside its parent");
props.matchingIds=["house","kitchen","living"];props.filterKey="|";render();
assert.equal(rendered.l.id,"house","clearing filters restores the parent overview");

const evidence=box.LocationScreenplayEvidence({units:[
  {key:"kitchen|night",name:"Kitchen",intExt:"INT",time:"Night",occurrences:[{sceneNo:3,sceneId:"s3",scriptText:"The window faces the yard."}]},
  {key:"kitchen|dawn",name:"Kitchen",intExt:"INT",time:"Dawn",occurrences:[
    {sceneNo:6,sceneId:"s6",scriptText:"First visit"},
    {sceneNo:6,sceneId:"s6",scriptText:"Return to the kitchen"}
  ]},
  {key:"removed",orphan:true,occurrences:[{scriptText:"Removed source"}]}
]});
const evidenceText=JSON.stringify(evidence);
assert.ok(evidenceText.includes("The window faces the yard."));
assert.ok(evidenceText.includes("Scene 06 · visit 1 of 2"));
assert.ok(evidenceText.includes("Scene 06 · visit 2 of 2"),"repeated visits in the same scene are distinguishable");
assert.ok(!evidenceText.includes("Removed source"),"retired units are not current screenplay evidence");
console.log("PASS location workspace grouping, navigation, filtering, batch targets and source evidence");

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
  useState:init=>{effectAt=0;if(state===undefined)state=init;return [state,next=>{state=typeof next==="function"?next(state):next;}];},
  useEffect:(fn,deps)=>{
    const i=effectAt++, prev=effectDeps[i];
    if(!prev||deps.some((v,k)=>v!==prev[k]))effects.push(fn);
    effectDeps[i]=deps;
  }
};
const opened=[];
const box={console,React,window:null,CustomEvent:class{constructor(t,i){this.type=t;this.detail=i&&i.detail;}},
  dispatchEvent:e=>{opened.push(e.detail);return true;},setTimeout:fn=>{fn();return 0;}};box.window=box;
vm.createContext(box);
vm.runInContext(readFileSync("app/locations-ui.jsx","utf8"),box);
const house={id:"house",rootLocationId:"house",name:"House",scenes:["s1"]};
const kitchen={id:"kitchen",rootLocationId:"house",name:"House - Kitchen",scenes:["s3","s6"],staging:{lens:"35mm"}};
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

/* ONE CARD FOR A PLACE AND ITS ROOMS (owner 2026-11-21): the place's card is always the card; a room opens inside it. */
let rendered=[];
const props={group,matchingIds:["house","kitchen","living"],filterKey:"|",batchActiveId:null,
  renderLocation:(l,options)=>{rendered.push({l,options});return {type:"sheet",props:{id:l.id}};}};
const render=()=>{rendered=[];let tree=box.LocationWorkspace(props);while(effects.length){effects.splice(0).forEach(f=>f());rendered=[];tree=box.LocationWorkspace(props);}return tree;};
const all=(tree,test,out=[])=>{if(tree&&typeof tree==="object"){if(test(tree))out.push(tree);(tree.children||[]).forEach(n=>all(n,test,out));}return out;};
const text=n=>n==null?"":typeof n==="string"||typeof n==="number"?String(n):(n.children||[]).map(text).join("");
let tree=render();
assert.equal(rendered.length,1);assert.equal(rendered[0].l.id,"house","the place's card is the card");
assert.equal(all(tree,n=>n.type==="select").length,0,"no picker swaps the card for a room's any more");
// the top row names the place and each room; a room's own name is short on its place's card
const isChip=n=>!!(n.props&&String(n.props.className||"").split(" ").includes("loc-space-chip"));
const chips=all(tree,isChip);
assert.deepEqual(chips.map(text),["House","Kitchen","Living Room"]);
assert.equal(box.locationRoomShortName({name:"Minicab Rank"},{name:"Minicab"}),"Minicab Rank","only a dash sets a room's own name apart");
// the place's card is given the way to open its rooms inside itself
const blocks=rendered[0].options.roomBlocks;
assert.ok(blocks&&typeof blocks.toggle==="function"&&typeof blocks.render==="function");
assert.equal(JSON.stringify(blocks.open),"{}","closed until asked");
assert.equal(rendered[0].options.asSection,undefined);
// a room's chip opens it: under Subspaces, inside the same card
chips[1].props.onClick();
assert.ok(opened.includes("loc-subspaces-house"),"the Subspaces section opens");
tree=render();
assert.equal(rendered[0].l.id,"house","the place's card stays");
assert.equal(rendered[0].options.roomBlocks.open.kitchen,true);
const room=rendered[0].options.roomBlocks.render(kitchen);
const asRoom=rendered[rendered.length-1];
assert.equal(asRoom.l,kitchen,"the room keeps its own record");assert.equal(asRoom.options.asSection,true);assert.equal(asRoom.options.embedded,true);
assert.equal(room.props.id,"kitchen");
// a link to a room's section opens that room and that section (a variant's link, a shot's missing view)
opened.length=0;
rendered[0].options.onSelectLocation("living","units");
tree=render();
assert.equal(rendered[0].options.roomBlocks.open.living,true);assert.equal(rendered[0].options.roomBlocks.open.kitchen,true,"the room opened before stays open");
rendered[0].options.roomBlocks.render(living);
assert.equal(rendered[rendered.length-1].options.initialSection,"units","unit links open the requested room section");
assert.ok(opened.includes("loc-units-living")&&opened.includes("loc-subspaces-house"));
// ...and a link to the place's own section opens it on the card that is already there
opened.length=0;rendered[0].options.onSelectLocation("house","layout");render();
assert.deepEqual(opened,["loc-layout-house"]);assert.equal(rendered[0].l.id,"house");
assert.equal(box.locationSectionFoldId({id:"x"},"previs"),"loc-step4-x");assert.equal(box.locationSectionFoldId({id:"x"},""),"");
// closing a room
rendered[0].options.roomBlocks.toggle("kitchen");render();
assert.equal(rendered[0].options.roomBlocks.open.kitchen,false);
// a batch needs the card it works on mounted: while it makes a room's image, that room is shown alone
props.batchActiveId="kitchen";
tree=render();
assert.equal(rendered.length,1);assert.equal(rendered[0].l,kitchen,"batch targets are mounted even when the room was closed");
assert.equal(rendered[0].options.asSection,undefined);
assert.ok(text(tree).includes("Making House - Kitchen"));
props.batchActiveId="house";render();assert.equal(rendered[0].l.id,"house");
props.batchActiveId=null;render();assert.equal(rendered[0].l.id,"house");assert.equal(rendered[0].options.roomBlocks.open.living,true,"what was open is open again after the batch");
// a search that finds a room and not its place: the room is open inside the card
rendered[0].options.roomBlocks.toggle("living");render();
props.matchingIds=["kitchen"];props.filterKey="|kitchen";render();
assert.equal(rendered[0].l.id,"house");assert.equal(rendered[0].options.roomBlocks.open.kitchen,true,"search can surface a matching room inside its place");
props.matchingIds=["house","kitchen","living"];props.filterKey="|";render();
assert.equal(rendered[0].l.id,"house","clearing filters keeps the place's card");
// a place with no rooms: no top row, no room blocks
const lone={root:office,members:[office]};
rendered=[];state=undefined;effectDeps.length=0;
const loneTree=box.LocationWorkspace({...props,group:lone,matchingIds:["office"]});
assert.equal(all(loneTree,isChip).length,0);
assert.equal(rendered[0].options.roomBlocks,null);

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
console.log("PASS location workspace: one card for a place and its rooms, navigation, filtering, batch targets and source evidence");

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

/* ONE CARD FOR A PLACE AND ITS ROOMS (owner 2026-11-21). Picture first (the same day, "I like B"): the space that is
   on takes the card's place; a card that was shown stays on the page, hidden, so nothing under way on it is lost. */
let rendered=[];
const props={group,matchingIds:["house","kitchen","living"],filterKey:"|",batchActiveId:null,
  renderLocation:(l,options)=>{rendered.push({l,options});return {type:"sheet",props:{id:l.id}};}};
const render=()=>{rendered=[];let tree=box.LocationWorkspace(props);while(effects.length){effects.splice(0).forEach(f=>f());rendered=[];tree=box.LocationWorkspace(props);}return tree;};
const all=(tree,test,out=[])=>{if(tree&&typeof tree==="object"){if(test(tree))out.push(tree);(tree.children||[]).forEach(n=>all(n,test,out));}return out;};
const text=n=>n==null?"":typeof n==="string"||typeof n==="number"?String(n):(n.children||[]).map(text).join("");
const spaces=t=>all(t,n=>!!(n.props&&n.props["data-location-space"])).map(n=>n.props["data-location-space"]+(n.props.hidden?" (hidden)":""));
const of=id=>rendered.find(r=>r.l.id===id);
let tree=render();
assert.deepEqual(rendered.map(r=>r.l.id),["house"]);assert.deepEqual(spaces(tree),["house"],"the place's card is the card");
assert.equal(all(tree,n=>n.type==="select").length,0,"no picker: the top row names the spaces");
// the top row names the place and each room; a room's own name is short on its place's card
const isChip=n=>!!(n.props&&String(n.props.className||"").split(" ").includes("loc-space-chip"));
const chips=()=>all(tree,isChip);
assert.deepEqual(chips().map(text),["House","Kitchen","Living Room"]);
assert.deepEqual(chips().map(n=>n.props["aria-pressed"]),["true","false","false"]);
assert.equal(box.locationRoomShortName({name:"Minicab Rank"},{name:"Minicab"}),"Minicab Rank","only a dash sets a room's own name apart");
assert.equal(of("house").options.embedded,true);assert.equal(of("house").options.asSection,undefined);assert.equal(of("house").options.roomBlocks,undefined,"no card inside the card");
// a room's chip shows that room in the card's place; the place's card stays on the page, hidden
chips()[1].props.onClick();
tree=render();
assert.deepEqual(spaces(tree),["house (hidden)","kitchen"]);
assert.equal(of("kitchen").l,kitchen,"the room keeps its own record");assert.equal(of("kitchen").options.embedded,true);assert.equal(of("kitchen").options.asSection,undefined);
assert.deepEqual(chips().map(n=>n.props["aria-pressed"]),["false","true","false"]);
// a link to a room's section shows that room and opens that section (a variant's link, a shot's missing view)
opened.length=0;
of("house").options.onSelectLocation("living","units");
tree=render();
assert.deepEqual(spaces(tree),["house (hidden)","kitchen (hidden)","living"],"a room shown before stays on the page");
assert.equal(of("living").options.initialSection,"units","unit links open the requested room section");
assert.ok(opened.includes("loc-units-living"));
// ...and a link to the place's own section shows the place again and opens it
opened.length=0;of("kitchen").options.onSelectLocation("house","layout");tree=render();
assert.deepEqual(opened,["loc-layout-house"]);assert.deepEqual(spaces(tree),["house","kitchen (hidden)","living (hidden)"]);
assert.equal(box.locationSectionFoldId({id:"x"},"previs"),"loc-step4-x");assert.equal(box.locationSectionFoldId({id:"x"},""),"");
// an unknown id shows the place
of("house").options.onSelectLocation("nowhere");tree=render();assert.equal(spaces(tree)[0],"house");
// a batch needs the card it works on on the page: while it makes a room's image, that room is the one shown
props.batchActiveId="kitchen";
tree=render();
assert.deepEqual(spaces(tree),["house (hidden)","kitchen","living (hidden)"],"the batch's room is shown");
assert.deepEqual(chips().map(n=>!!n.props.disabled),[true,false,true],"the other spaces wait for the batch");
assert.match(chips()[0].props.title,/^An image of House - Kitchen is being made\./);
props.batchActiveId="house";tree=render();assert.equal(spaces(tree)[0],"house");
props.batchActiveId=null;tree=render();assert.deepEqual(spaces(tree),["house","kitchen (hidden)","living (hidden)"],"what was shown is shown again after the batch");
assert.deepEqual(chips().map(n=>!!n.props.disabled),[false,false,false]);
// a search that finds a room and not its place: that room is the one shown
props.matchingIds=["kitchen"];props.filterKey="|kitchen";tree=render();
assert.deepEqual(spaces(tree),["house (hidden)","kitchen","living (hidden)"],"search can surface a matching room");
props.matchingIds=["house","kitchen","living"];props.filterKey="|";tree=render();
assert.equal(spaces(tree)[1],"kitchen","clearing filters keeps what is shown");
// a place with no rooms: no top row
const lone={root:office,members:[office]};
rendered=[];state=undefined;effectDeps.length=0;
const loneTree=box.LocationWorkspace({...props,group:lone,matchingIds:["office"]});
assert.equal(all(loneTree,isChip).length,0);
assert.deepEqual(spaces(loneTree),["office"]);assert.equal(rendered[0].options.roomBlocks,undefined);

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

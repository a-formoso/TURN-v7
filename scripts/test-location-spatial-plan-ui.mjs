#!/usr/bin/env node
/* UI-only mocks: no browser state, network, paid calls or saved film changes. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const compiled=process.env.PLAN_UI_TEST_DIST==="1";
const source=f=>readFileSync((compiled?"dist/app/":"app/")+f.replace(/\.jsx$/,compiled?".js":".jsx"),"utf8");
const noop=()=>{};
let hooks=[],cursor=0,effects=[],writes=[],aiCalls=0,returned=0,timers=[];
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;
    return [hooks[i],v=>hooks[i]=typeof v==="function"?v(hooks[i]):v];},
  useReducer:(fn,init)=>React.useState(init),
  useRef:init=>{const i=cursor++;return hooks[i]||(hooks[i]={current:init});},
  useEffect:(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((d,j)=>d!==hooks[i][j]))effects.push(fn);hooks[i]=deps;}
};
const box={console,React,TextEncoder,crypto,localStorage:{getItem:()=>null},Icon:new Proxy({},{get:()=>noop}),
  addEventListener:noop,removeEventListener:noop,nbEpoch:()=>1,nbGetMeta:()=>({iso:"v1"}),
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:noop};
box.window=box;vm.createContext(box);
vm.runInContext(source("locations.jsx"),box);
vm.runInContext(source("locations-ui.jsx"),box);
const plan={status:"draft",source:{assetId:"house",iso:"v1"},frame:"From archway toward kitchen",
  anchors:[{id:"table",space:"Kitchen",name:"Table",placement:"In front of fridge",basis:"observed",evidence:"Both upper panels"}],sightlines:"Open archway",unresolved:"Dimensions unmeasured"};
const house={id:"house",name:"House",spatialPlan:plan};
const room={id:"kitchen",name:"Kitchen",parentKey:"house"};house.key="house";
box.turnContinuity={locations:[house,room]};
box.aiDraftLocationSpatialPlan=async()=>{aiCalls++;return {...plan,frame:"Candidate frame"};};
const props={l:room,scenes:[],project:{},onUpdate:(id,patch)=>writes.push({id,patch}),onReturnToImage:()=>returned++};
const flat=n=>!n||typeof n!=="object"?[]:[n,...n.children.flatMap(flat)];
const text=n=>n==null||n===false?"":typeof n!=="object"?String(n):n.children.map(text).join("");
const cls=(tree,name)=>flat(tree).find(n=>(n.props.className||"").split(" ").includes(name));
const button=(tree,name)=>flat(tree).find(n=>n.type==="button"&&text(n)===name);
const render=(over={})=>{cursor=0;effects=[];const tree=box.LocationSpatialPlanEditor({...props,...over});effects.forEach(f=>f());return tree;};
const reset=()=>{hooks=[];writes=[];};

let tree=render();
assert.equal(tree.props.open,true,"unreviewed layout opens when the outer fold is opened");
assert.equal(cls(tree,"loc-spatial-assist").props.open,undefined,"paid drafting is collapsed and optional");
assert.match(text(cls(tree,"loc-spatial-assist")),/Optional/);
assert.ok(text(tree).indexOf("Confirm shared layout")<text(tree).indexOf("Draft shared layout"));
assert.equal(flat(tree).filter(n=>n.type==="button"&&text(n)==="Confirm shared layout").length,2);
assert.equal(button(tree,"Confirm shared layout").props.disabled,false);
assert.match(text(tree),/Confirmation uses no credits and does not generate an image/);
assert.equal(writes.length,0);assert.equal(aiCalls,0,"opening never drafts or approves");
button(tree,"Confirm shared layout").props.onClick();
assert.equal(writes.length,1);assert.equal(writes[0].id,"house","room review confirms its parent's plan");
assert.equal(writes[0].patch.spatialPlan.status,"reviewed");assert.equal(aiCalls,0);
assert.equal(house.spatialPlan.status,"draft","source fixture remains untouched");

reset();tree=render({readOnly:true});
assert.equal(button(tree,"Confirm shared layout").props.disabled,true);
assert.equal(flat(tree).find(n=>n.type==="fieldset").props.disabled,true);
button(tree,"Confirm shared layout").props.onClick();await button(tree,"Draft shared layout").props.onClick();
assert.equal(writes.length,0);assert.equal(aiCalls,0);

reset();house.spatialPlan={};tree=render();
assert.match(text(tree),/No layout yet/);
assert.match(text(tree),/Draft specification writes the location description/);
assert.match(text(tree),/Uses writing-model credits, not image credits/);
assert.match(text(tree),/Or enter placements manually/);
assert.equal(button(tree,"Confirm shared layout"),undefined,"an empty layout offers preparation, not a dead confirm button");
assert.equal(cls(tree,"loc-spatial-assist"),undefined,"the initial draft action is not hidden in another disclosure");
assert.ok(flat(cls(tree,"loc-spatial-review")).includes(button(tree,"Draft shared layout")),
  "empty layouts put the draft action at the top");
await button(tree,"Draft shared layout").props.onClick();tree=render();
assert.match(text(tree),/Draft to review/);
assert.equal(flat(tree).find(n=>n.type==="textarea"&&n.props.value==="Candidate frame").props.value,"Candidate frame");
assert.equal(flat(tree).find(n=>n.type==="textarea"&&n.props.value==="In front of fridge").props.value,"In front of fridge",
  "drafting fills object placements as well as the viewing direction");
assert.equal(button(tree,"Confirm shared layout").props.disabled,false);
assert.equal(writes.length,0,"filling draft fields does not silently confirm or save geometry");

reset();tree=render({readOnly:true});
assert.equal(button(tree,"Draft shared layout").props.disabled,true);
const readOnlyCalls=aiCalls;
await button(tree,"Draft shared layout").props.onClick();
assert.equal(aiCalls,readOnlyCalls,"empty-state action also enforces read-only access");

reset();house.spatialPlan={frame:"Facing the window"};tree=render();
assert.match(text(tree),/Placements incomplete/);
assert.match(text(tree),/Each object needs a room, name and fixed placement/);
assert.equal(button(tree,"Confirm shared layout").props.disabled,true);

reset();house.spatialPlan={...plan,status:"reviewed"};tree=render();
assert.equal(tree.props.open,false);assert.ok(button(tree,"Confirm shared layout"),"The editor keeps a confirmation action available for reviewing saved edits");
assert.ok(button(tree,"Edit floor plan"),"A confirmed layout remains explicitly editable");
assert.match(text(tree),/placements are confirmed, not locked/);
button(tree,"Back to image").props.onClick();assert.equal(returned,1);assert.equal(writes.length,0);
let focused=0;
tree.children[0].props.ref.current={focus:()=>focused++};
render({reviewRequest:1});tree=render({reviewRequest:1});
assert.equal(tree.props.open,true);assert.equal(focused,1,"review navigation reopens and focuses the section");

reset();house.spatialPlan={...plan,status:"reviewed",source:{assetId:"house",iso:"old"}};tree=render();
assert.equal(tree.props.open,true);assert.match(text(tree),/parent image changed/);

reset();house.spatialPlan=plan;tree=render();const beforeDraft=aiCalls;
await button(tree,"Draft shared layout").props.onClick();tree=render();
assert.equal(aiCalls,beforeDraft+1);assert.equal(writes.length,0);assert.match(text(tree),/Draft to review/);
assert.match(text(tree),/saved layout is unchanged until you confirm/);
button(tree,"Discard draft").props.onClick();tree=render();
assert.equal(button(tree,"Discard draft"),undefined);assert.equal(writes.length,0);
await button(tree,"Draft shared layout").props.onClick();tree=render();
button(tree,"Confirm shared layout").props.onClick();
assert.equal(writes[0].patch.spatialPlan.frame,"Candidate frame");

reset();house.spatialPlan={};box.aiDraftLocationSpatialPlan=async()=>{throw new Error("Reference image could not be read");};
tree=render();await button(tree,"Draft shared layout").props.onClick();tree=render();
assert.match(text(flat(tree).find(n=>n.props.role==="alert")),/Reference image could not be read/);
assert.equal(button(tree,"Draft shared layout").props.disabled,false,"a failed draft leaves a usable retry action");
assert.equal(writes.length,0);

reset();tree=box.LocationSpatialAnchorEditor({anchor:plan.anchors[0],onRemove:noop});
assert.equal(tree.props.open,false);assert.match(text(tree.children[0]),/In front of fridge/,
  "collapsed object exposes placement, not just its name");

// A Build-set repair link must survive the outer fold not having mounted its editor yet.
const bus={id:"bus",key:"bus",name:"School Bus",spatialPlan:{...plan,status:"reviewed",source:{assetId:"bus",iso:"v1"},
  anchors:plan.anchors.map(a=>({...a,space:"School Bus"}))}};
box.turnContinuity={locations:[bus]};
box.KinolotCloudRender={inputIssueList:()=>[{step:2,text:"Add the School Bus footprint to the floor plan first."}]};
const navigation=[];box.CustomEvent=class{constructor(type,opts){this.type=type;this.detail=opts.detail;}};box.dispatchEvent=e=>navigation.push(e);
vm.runInContext(source("blender-render-ui.jsx"),box);
box.goToLocationStep(bus,2);
assert.ok(box.KinolotFloorPlanEditRequests.get("bus"),"Repair is recorded before the closed editor mounts");
assert.deepEqual(navigation.map(e=>e.type),["nb-open-fold","kinolot-edit-floor-plan"]);
reset();timers=[];tree=render({l:bus});
assert.equal(tree.props.open,true,"A confirmed layout opens on a pending build repair");
assert.match(text(tree),/Add the School Bus footprint/);
assert.equal(flat(tree).find(n=>n.type==="fieldset").props.disabled,false,"Confirmed data is not locked for an editor");
let scrolled=0,fieldFocused=0;
const metric={open:false,scrollIntoView:()=>scrolled++,querySelector:()=>({focus:()=>fieldFocused++})};
flat(tree).find(n=>n.type==="fieldset").props.ref.current={querySelector:()=>metric};
timers.splice(0).forEach(f=>f());
assert.equal(metric.open,true);assert.equal(scrolled,1);assert.equal(fieldFocused,1);
assert.equal(box.KinolotFloorPlanEditRequests.has("bus"),false,"A consumed request does not keep forcing the editor open later");
assert.equal(writes.length,0,"Opening repairs never edits a saved film");
// A general edit starts at a labelled guide; repair navigation still targets the missing metrics.
reset();timers=[];box.KinolotFloorPlanEditRequests?.clear();tree=render({l:bus});
button(tree,"Edit floor plan").props.onClick();tree=render({l:bus});
let manualScroll=0,manualFocus=0;const requested=[];
const start={scrollIntoView:()=>manualScroll++,focus:()=>manualFocus++};
const objects={open:false,scrollIntoView:noop,querySelector:()=>({focus:noop})};
const rooms={open:false,scrollIntoView:noop,querySelector:()=>({focus:noop})};
const links={open:false,scrollIntoView:noop,querySelector:()=>({focus:noop})};
const groups={".loc-plan-editor-start":start,".loc-plan-objects":objects,".loc-plan-metrics":rooms,".loc-plan-connections":links};
flat(tree).find(n=>n.type==="fieldset").props.ref.current={querySelector:selector=>{requested.push(selector);return groups[selector];}};
timers.splice(0).forEach(f=>f());
assert.deepEqual(requested,[".loc-plan-editor-start"],"General editing does not jump directly to a lower metrics fold");
assert.equal(manualScroll,1);assert.equal(manualFocus,1);assert.match(text(cls(tree,"loc-plan-editor-start")),/Choose what to change/);
button(tree,"Room sizes & openings").props.onClick();assert.equal(rooms.open,true);assert.equal(objects.open,false);assert.equal(links.open,false);
button(tree,"Objects & placements").props.onClick();assert.equal(objects.open,true);
button(tree,"Connections & unknowns").props.onClick();assert.equal(links.open,true);
assert.equal(writes.length,0,"Editor navigation and shortcuts never alter saved layout data");
// Follow the real edit callbacks through a disposable narrow bus plan into the exact Build-set scene.
for(const f of ["blender-render-contract.js","blender-set-detail.js","blender-render.js"])vm.runInContext(source(f),box);
box.TURN_SUPABASE={setBuild:true};
let flow={...structuredClone(bus),spatialPlan:{...structuredClone(bus.spatialPlan),anchors:[{id:"seat",space:"School Bus",name:"Seat",placement:"Near the rear",basis:"design",evidence:"Test fixture",xy:[0,3],z:0}]}};
box.turnContinuity={locations:[flow]};
const flowUpdate=(id,patch)=>{assert.equal(id,flow.id);flow={...flow,...patch};box.turnContinuity.locations=[flow];};
const flowEditor=()=>render({l:flow,onUpdate:flowUpdate});
const flowSteps=()=>box.locationCardSteps({l:flow,drafted:true,spatialState:box.locationSpatialPlanState(flow),gen:{},cloudPilot:true,cloudJob:null});
assert.equal(flowSteps().find(s=>s.n===2).done,false,"Written approval alone cannot mark a cloud floor plan complete");
assert.equal(flowSteps().find(s=>s.n===3).done,false,"Absent room measurements cannot mark cameras complete");
reset();tree=flowEditor();assert.match(text(tree),/Placements confirmed · measurements needed/);
function metrics(){const entry=flat(flowEditor()).find(n=>n.type===box.LocationFloorPlanFields);return box.LocationFloorPlanFields(entry.props);}
let fields=metrics();assert.equal(fields.type,"div","Opening Room sizes exposes its fields without a second Blender-details disclosure");
button(fields,"Add School Bus to the floor plan").props.onClick();assert.equal(flow.spatialPlan.status,"draft");
fields=metrics();const setup=flat(fields).find(n=>n.type===box.LocationRoomOutline);assert.ok(setup,"A missing outline offers a simple width-and-length setup");
hooks=[];function outline(){cursor=0;return box.LocationRoomOutline(setup.props);}
let rectangle=outline();assert.equal(button(rectangle,"Create rectangular outline").props.disabled,true);
const dimensions=flat(rectangle).filter(n=>n.type==="input");dimensions[0].props.onChange({target:{value:"2.6"}});dimensions[1].props.onChange({target:{value:"10"}});
rectangle=outline();button(rectangle,"Create rectangular outline").props.onClick();
assert.equal(flow.spatialPlan.coordinates.spaces[0].footprint.length,4);assert.deepEqual(flow.spatialPlan.anchors[0].xy,[0,3],"Creating an outline never relocates existing objects");
reset();
function commitField(tree,label,value){const field=flat(tree).find(n=>n.type===box.LocCoordInput&&n.props.label===label);assert.ok(field,"Editable field: "+label);const input=flat(box.LocCoordInput(field.props)).find(n=>n.type==="input");input.props.onBlur({target:{value}});}
commitField(metrics(),"Ceiling height","2.4");commitField(flowEditor(),"Object dimensions","0.5, 0.8, 0.8");
tree=flowEditor();assert.ok(button(tree,"Confirm shared layout"),"Editing leaves a visible confirmation action");button(tree,"Confirm shared layout").props.onClick();
assert.equal(flow.spatialPlan.status,"reviewed");
assert.equal(box.KinolotCloudRender.inputIssueList(flow).filter(i=>i.step===2).length,0,"The saved plan now passes the actual measurement validator");
tree=flowEditor();assert.ok(button(tree,"Continue to 3 · Cameras"),"A measured, confirmed plan leads directly to cameras");
assert.equal(flowSteps().find(s=>s.n===2).done,true);assert.equal(flowSteps().find(s=>s.n===3).done,false);
const proposal=box.KinolotCloudRender.proposeCameras(flow);flowUpdate(flow.id,{coverageViews:box.KinolotCloudRender.cameraProposalViews(flow,proposal)});
assert.equal(flowSteps().find(s=>s.n===3).done,true);assert.equal(flowSteps().find(s=>s.n===4).next,true);
const scene=box.KinolotCloudRender.buildScene(flow);box.KinolotRenderContract.validateScene(scene);
assert.equal(Object.keys(scene.cameras).length,4);assert.ok(scene.objects.some(o=>o.anchorId==="seat"),"The saved fixture reaches Build set with its existing object");
assert.equal(box.KinolotCloudRender.inputIssueList(flow).length,0,"Steps 2, 3 and 4 use consistent prerequisites");
// Replacing an empty outline is explicit and never allowed through a read-only handler.
hooks=[];cursor=0;let illicit=0;const readonlyOutline=box.LocationRoomOutline({space:{},onCreate:()=>illicit++,readOnly:true});
button(readonlyOutline,"Create rectangular outline").props.onClick();assert.equal(illicit,0);
console.log("PASS shared-layout review hierarchy, empty/ready/stale/read-only states, parent ownership, optional draft/discard, navigation focus and readable placements");

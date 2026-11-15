#!/usr/bin/env node
/* UI-only mocks: no browser state, network, paid calls or saved film changes. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const compiled=process.env.PLAN_UI_TEST_DIST==="1";
const source=f=>readFileSync((compiled?"dist/app/":"app/")+f.replace(/\.jsx$/,compiled?".js":".jsx"),"utf8");
const noop=()=>{};
let hooks=[],cursor=0,effects=[],writes=[],aiCalls=0,timers=[];
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
const props={l:room,scenes:[],project:{},onUpdate:(id,patch)=>writes.push({id,patch})};
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
assert.ok(flat(tree).indexOf(button(tree,"Confirm floor plan"))>flat(tree).indexOf(button(tree,"Draft floor plan")),"The single approval action follows the optional AI helper inside the editor");
assert.equal(flat(tree).filter(n=>n.type==="button"&&text(n)==="Confirm floor plan").length,1);
assert.equal(button(tree,"Confirm floor plan").props.disabled,false);
assert.match(text(tree),/Confirmation uses no credits and does not generate an image/);
assert.equal(writes.length,0);assert.equal(aiCalls,0,"opening never drafts or approves");
button(tree,"Confirm floor plan").props.onClick();
assert.equal(writes.length,1);assert.equal(writes[0].id,"house","room review confirms its parent's plan");
assert.equal(writes[0].patch.spatialPlan.status,"reviewed");assert.equal(aiCalls,0);
assert.equal(house.spatialPlan.status,"draft","source fixture remains untouched");

reset();tree=render({readOnly:true});
assert.equal(button(tree,"Confirm floor plan").props.disabled,true);
assert.equal(flat(tree).find(n=>n.type==="fieldset").props.disabled,true);
button(tree,"Confirm floor plan").props.onClick();await button(tree,"Draft floor plan").props.onClick();
assert.equal(writes.length,0);assert.equal(aiCalls,0);

reset();house.spatialPlan={};tree=render();
assert.match(text(tree),/No layout yet/);
assert.match(text(tree),/Draft specification writes the location description/);
assert.match(text(tree),/Uses writing-model credits, not image credits/);
assert.match(text(tree),/Or enter placements manually/);
assert.equal(button(tree,"Confirm floor plan"),undefined,"an empty layout offers preparation, not a dead confirm button");
assert.equal(cls(tree,"loc-spatial-assist"),undefined,"the initial draft action is not hidden in another disclosure");
assert.ok(flat(cls(tree,"loc-spatial-review")).includes(button(tree,"Draft floor plan")),
  "empty layouts put the draft action at the top");
await button(tree,"Draft floor plan").props.onClick();tree=render();
assert.match(text(tree),/Draft to review/);
assert.equal(flat(tree).find(n=>n.type==="textarea"&&n.props.value==="Candidate frame").props.value,"Candidate frame");
assert.equal(flat(tree).find(n=>n.type==="textarea"&&n.props.value==="In front of fridge").props.value,"In front of fridge",
  "drafting fills object placements as well as the viewing direction");
assert.equal(button(tree,"Confirm floor plan").props.disabled,false);
assert.equal(writes.length,0,"filling draft fields does not silently confirm or save geometry");

reset();tree=render({readOnly:true});
assert.equal(button(tree,"Draft floor plan").props.disabled,true);
const readOnlyCalls=aiCalls;
await button(tree,"Draft floor plan").props.onClick();
assert.equal(aiCalls,readOnlyCalls,"empty-state action also enforces read-only access");

reset();house.spatialPlan={frame:"Facing the window"};tree=render();
assert.match(text(tree),/Placements incomplete/);
assert.match(text(tree),/Each object needs a room, name and fixed placement/);
assert.equal(button(tree,"Confirm floor plan").props.disabled,true);

reset();house.spatialPlan={...plan,status:"reviewed"};tree=render();
assert.equal(tree.props.open,false);assert.equal(button(tree,"Confirm floor plan"),undefined,"An unchanged approved plan does not request approval again");
assert.ok(button(tree,"Done editing"),"Unchanged approved plans offer a close action");
assert.ok(button(tree,"Floor plan confirmed"),"A confirmed layout has a checked, editable status action");
assert.equal(button(tree,"Floor plan confirmed").props['aria-expanded'],false);
assert.equal(cls(tree,"loc-plan-editor").props.hidden,true,"The confirmed editor starts folded");
assert.match(text(tree),/reopen it to edit/);
assert.equal(button(tree,"Back to image"),undefined,"Floor-plan repair does not send users back to artwork");assert.equal(writes.length,0);
let focused=0;
tree.children[0].props.ref.current={focus:()=>focused++};
render({reviewRequest:1});tree=render({reviewRequest:1});
assert.equal(tree.props.open,true);assert.equal(focused,1,"review navigation reopens and focuses the section");

reset();house.spatialPlan={...plan,status:"reviewed",source:{assetId:"house",iso:"old"}};tree=render();
assert.equal(tree.props.open,true);assert.match(text(tree),/parent image changed/);

reset();house.spatialPlan=plan;tree=render();const beforeDraft=aiCalls;
await button(tree,"Draft floor plan").props.onClick();tree=render();
assert.equal(aiCalls,beforeDraft+1);assert.equal(writes.length,0);assert.match(text(tree),/Draft to review/);
assert.match(text(tree),/saved layout is unchanged until you confirm/);
button(tree,"Discard draft").props.onClick();tree=render();
assert.equal(button(tree,"Discard draft"),undefined);assert.equal(writes.length,0);
await button(tree,"Draft floor plan").props.onClick();tree=render();
button(tree,"Confirm floor plan").props.onClick();
assert.equal(writes[0].patch.spatialPlan.frame,"Candidate frame");

reset();house.spatialPlan={};box.aiDraftLocationSpatialPlan=async()=>{throw new Error("Reference image could not be read");};
tree=render();await button(tree,"Draft floor plan").props.onClick();tree=render();
assert.match(text(flat(tree).find(n=>n.props.role==="alert")),/Reference image could not be read/);
assert.equal(button(tree,"Draft floor plan").props.disabled,false,"a failed draft leaves a usable retry action");
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
const groups={".loc-plan-editor-start":start};
flat(tree).find(n=>n.type==="fieldset").props.ref.current={querySelector:selector=>{requested.push(selector);return groups[selector];}};
timers.splice(0).forEach(f=>f());
assert.deepEqual(requested,[".loc-plan-editor-start"],"General editing does not jump directly to a lower metrics fold");
assert.equal(manualScroll,1);assert.equal(manualFocus,1);assert.match(text(cls(tree,"loc-plan-editor-start")),/Open a section below/);
const contained=cls(tree,"loc-plan-editor");
for(const group of ["loc-plan-objects","loc-plan-metrics","loc-plan-connections"]){
 assert.ok(contained.children.includes(cls(tree,group)),"The "+group+" fold is directly inside the edit area");
 assert.equal(cls(tree,group).type,"details","The section can open and fold in place");
}
for(const label of ["Objects & placements","Room sizes & openings","Connections & unknowns"])assert.equal(button(tree,label),undefined,"No duplicate shortcut: "+label);
assert.ok(flat(contained).includes(button(tree,"Confirm floor plan")),"Confirmation stays in the same edit area");
assert.ok(contained.children.indexOf(cls(tree,"loc-spatial-assist"))>contained.children.indexOf(cls(tree,"loc-plan-connections")),"Optional AI help follows the three editing sections");
assert.equal(writes.length,0,"Opening the contained editor never alters saved layout data");
// Follow the real edit callbacks through a disposable narrow bus plan into the exact Build-set scene.
for(const f of ["blender-render-contract.js","blender-set-detail.js","blender-render.js","location-measurement-repair.js"])vm.runInContext(source(f),box);
box.TURN_SUPABASE={setBuild:true};
let flow={...structuredClone(bus),spatialPlan:{...structuredClone(bus.spatialPlan),anchors:[{id:"seat",space:"School Bus",name:"Seat",placement:"Near the rear",basis:"design",evidence:"Test fixture",xy:[0,3],z:0}]}};
box.turnContinuity={locations:[flow]};
const flowUpdate=(id,patch)=>{assert.equal(id,flow.id);flow={...flow,...patch};box.turnContinuity.locations=[flow];};
const flowEditor=()=>render({l:flow,onUpdate:flowUpdate});
const flowSteps=()=>box.locationCardSteps({l:flow,drafted:true,spatialState:box.locationSpatialPlanState(flow),gen:{},previs:true});
assert.equal(flowSteps().find(s=>s.n===2).done,false,"Written approval alone cannot mark the floor plan complete where the set is drawn in 3D");
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
tree=flowEditor();assert.ok(button(tree,"Confirm floor plan"),"Editing leaves a visible confirmation action");button(tree,"Confirm floor plan").props.onClick();
assert.equal(flow.spatialPlan.status,"reviewed");
assert.equal(box.KinolotCloudRender.inputIssueList(flow).filter(i=>i.step===2).length,0,"The saved plan now passes the actual measurement validator");
tree=flowEditor();assert.ok(button(tree,"Continue to 3 · Cameras"),"A measured, confirmed plan leads directly to cameras");
assert.ok(flat(cls(tree,"loc-spatial-review")).includes(button(tree,"Continue to 3 · Cameras")),"Cameras is the top-level next action, not buried inside the editor");
assert.equal(flat(cls(tree,"loc-plan-editor")).includes(button(tree,"Continue to 3 · Cameras")),false);
assert.equal(button(tree,"Back to 5 · Build the set"),undefined,"Step 2 does not skip over camera review");
assert.equal(flowSteps().find(s=>s.n===2).done,true);assert.equal(flowSteps().find(s=>s.n===3).done,false);
const proposal=box.KinolotCloudRender.proposeCameras(flow);flowUpdate(flow.id,{coverageViews:box.KinolotCloudRender.cameraProposalViews(flow,proposal)});
// 4 · Previs is optional, so the next step is 5 · Location image (2026-11-15: one road, the cloud build's steps are gone),
// and its Go button opens Previs, where the image is made from the set
assert.equal(flowSteps().find(s=>s.n===3).done,true);assert.equal(flowSteps().find(s=>s.n===4).optional,true);
const imageStep=flowSteps().find(s=>s.n===5);
assert.equal(imageStep.key,"image");assert.equal(imageStep.next,true);assert.equal(imageStep.goTo,4);assert.match(imageStep.todo,/Open 4 · Previs, choose Make the location image, then Use as location image on the draft/);
assert.equal(flowSteps().length,5);
const scene=box.KinolotCloudRender.buildScene(flow);box.KinolotRenderContract.validateScene(scene);
assert.equal(Object.keys(scene.cameras).length,4);assert.ok(scene.objects.some(o=>o.anchorId==="seat"),"The saved fixture reaches the 3D set with its existing object");
assert.equal(box.KinolotCloudRender.inputIssueList(flow).length,0,"Steps 2, 3 and 4 use consistent prerequisites");
// Replacing an empty outline is explicit and never allowed through a read-only handler.
hooks=[];cursor=0;let illicit=0;const readonlyOutline=box.LocationRoomOutline({space:{},onCreate:()=>illicit++,readOnly:true});
button(readonlyOutline,"Create rectangular outline").props.onClick();assert.equal(illicit,0);
// Successful confirmation collapses the editor, closes its folds and returns focus to the visible result.
reset();timers=[];tree=flowEditor();button(tree,"Floor plan confirmed").props.onClick();tree=flowEditor();
assert.equal(cls(tree,"loc-plan-editor").props.hidden,false,"The checked status remains an edit action");
assert.match(button(tree,"Floor plan confirmed").props.className,/ghost/,"The confirmed status is secondary");
assert.doesNotMatch(button(tree,"Continue to 3 · Cameras").props.className,/ghost/,"Cameras is the primary next action");
const unchangedPlan=JSON.stringify(flow);button(tree,"Done editing").props.onClick();tree=flowEditor();
assert.equal(JSON.stringify(flow),unchangedPlan,"Done editing closes without writing another approval");assert.equal(cls(tree,"loc-plan-editor").props.hidden,true);
button(tree,"Floor plan confirmed").props.onClick();tree=flowEditor();commitField(tree,"Object dimensions","0.5, 0.8, 0.9");tree=flowEditor();
assert.ok(button(tree,"Confirm floor plan"),"An actual edit restores the confirmation action");assert.equal(button(tree,"Done editing"),undefined);
timers=[];
const openGroups=[{open:true},{open:true},{open:true}];let returnedTop=0,returnedFocus=0;
cls(tree,"loc-plan-editor").props.ref.current={querySelectorAll:()=>openGroups,querySelector:()=>null};
cls(tree,"loc-spatial-review").props.ref.current={scrollIntoView:opts=>{assert.equal(opts.behavior,"smooth");returnedTop++;},focus:opts=>{assert.equal(opts.preventScroll,true);returnedFocus++;}};
button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();
assert.ok(cls(tree,"loc-confirm-result"),"A confirmation click must produce visible local feedback");
assert.ok(flat(cls(tree,"loc-spatial-review")).includes(cls(tree,"loc-confirm-result")),"Success is visible above the folded editor");
assert.match(text(cls(tree,"loc-confirm-result")),/Ready for cameras/);
assert.match(text(cls(tree,"loc-confirm-status")),/Confirmed · ready for cameras/,"The edit area reflects the saved confirmation state");
assert.equal(cls(tree,"loc-plan-editor").props.hidden,true);assert.ok(openGroups.every(g=>!g.open),"All editor subsections fold after success");
timers.splice(0).forEach(fn=>fn());assert.equal(returnedTop,1);assert.equal(returnedFocus,1,"The user lands at the confirmed floor-plan controls");
button(tree,"Continue to 3 · Cameras").props.onClick();assert.equal(navigation.at(-1).detail,"loc-step3-"+flow.id,"Continue opens the current location's Cameras section");
commitField(flowEditor(),"Object dimensions","0.5, 0.8, 1");tree=flowEditor();
assert.match(text(cls(tree,"loc-confirm-status")),/Unconfirmed edits/);assert.equal(cls(tree,"loc-confirm-result"),undefined,"A later edit clears the old successful confirmation");
button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();

// Existing invalid measurements remain blocked and receive an actionable explanation.
flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,status:"reviewed",coordinates:{...flow.spatialPlan.coordinates,spaces:flow.spatialPlan.coordinates.spaces.map(sp=>({...sp,openings:[{id:"entry",name:"Folding entry door",kind:"door",edge:0,centre:[0,-5],width:.8,sillZ:0,headZ:3}]}))}}});
reset();tree=flowEditor();button(tree,"Edit floor plan").props.onClick();tree=flowEditor();button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();
assert.match(text(cls(tree,"loc-confirm-result")),/above the ceiling/);
assert.equal(cls(tree,"loc-plan-editor").props.hidden,false,"Remaining measurements keep the editor open for repair");
assert.match(text(cls(tree,"loc-confirm-status")),/measurements needed/,"Confirmation status does not hide unresolved 3D measurements");
assert.equal(button(tree,"Floor plan confirmed"),undefined,"Incomplete geometry never gets a completed status");
assert.ok(button(tree,"Edit measurements manually"),"Confirmation explains how to repair a remaining opening-height problem");
const repairMetric={open:false,scrollIntoView:noop,querySelector:()=>({focus:noop})};
flat(tree).find(n=>n.type==="fieldset").props.ref.current={querySelector:selector=>selector===".loc-plan-metrics"?repairMetric:null};
button(tree,"Edit measurements manually").props.onClick();assert.equal(repairMetric.open,true,"The repair action opens the actual measurement fields");

assert.equal(button(tree,"Continue to 3 · Cameras"),undefined,"Approval must not hide an invalid measurement");
// A repair preview must show real before/after values, write nothing, and apply only on explicit confirmation.
const savedBeforeRepair=JSON.stringify(flow);button(tree,"Suggest measurement fixes").props.onClick();tree=flowEditor();
assert.equal(JSON.stringify(flow),savedBeforeRepair,"Opening a repair preview does not save changes");
assert.ok(cls(tree,"loc-measurement-repair"));assert.match(text(tree),/Before/);assert.match(text(tree),/After/);
assert.ok(button(tree,"Apply fixes & confirm"));button(tree,"Discard fixes").props.onClick();tree=flowEditor();
assert.equal(JSON.stringify(flow),savedBeforeRepair,"Discarding fixes preserves the saved plan");
button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();button(tree,"Suggest measurement fixes").props.onClick();tree=flowEditor();
button(tree,"Apply fixes & confirm").props.onClick();tree=flowEditor();
assert.equal(box.KinolotCloudRender.inputIssueList(flow).filter(i=>i.step===2).length,0,"Applying the shown repairs corrects the measurement blocker");
assert.match(text(cls(tree,"loc-confirm-result")),/Applied/);assert.match(text(cls(tree,"loc-confirm-result")),/Ready for cameras/);
assert.equal(flow.spatialPlan.status,"reviewed");
assert.equal(cls(tree,"loc-plan-editor").props.hidden,true,"Apply fixes & confirm completes the flow without another confirmation click");
assert.ok(button(tree,"Floor plan confirmed"));
// A stale click must approve the current saved data, never overwrite a newer saved edit.
flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,status:"draft"}});
reset();tree=flowEditor();const oldConfirm=button(tree,"Confirm floor plan");
flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,frame:"A newer saved viewing direction"}});
oldConfirm.props.onClick();assert.equal(flow.spatialPlan.frame,"A newer saved viewing direction");
tree=flowEditor();assert.match(text(tree),/changed since this view was shown/,"An unseen concurrent edit asks for review rather than approving stale data");
// Rendered React state can lead the legacy global mirror until its passive effect runs.
const visible={...flow,spatialPlan:{...flow.spatialPlan,frame:"The latest visible numeric edit"}};
reset();tree=render({l:visible,onUpdate:flowUpdate});button(tree,"Confirm floor plan").props.onClick();
assert.equal(flow.spatialPlan.frame,"The latest visible numeric edit","Confirmation preserves a visible edit even when the global mirror has not caught up");

flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,status:"draft"}});
reset();tree=flowEditor();box.turnArtRoomWritable=()=>false;const protectedPlan=JSON.stringify(flow);
button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();assert.match(text(tree),/read-only/);assert.equal(JSON.stringify(flow),protectedPlan);assert.equal(cls(tree,"loc-confirm-result"),undefined);
box.turnArtRoomWritable=()=>true;
reset();tree=render({l:flow,onUpdate:()=>{throw Error("Local confirmation failed");}});button(tree,"Confirm floor plan").props.onClick();tree=render({l:flow,onUpdate:noop});
assert.match(text(tree),/Local confirmation failed/,"A failed update reports an error instead of silently ignoring the click");
assert.equal(cls(tree,"loc-plan-editor").props.hidden,false,"A failed update never folds away the user's editor");
// A repair that becomes stale or loses access must never apply to the saved film.
flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,status:"reviewed",coordinates:{...flow.spatialPlan.coordinates,spaces:flow.spatialPlan.coordinates.spaces.map(sp=>({...sp,openings:sp.openings.map(o=>({...o,headZ:4}))}))}}});
reset();tree=flowEditor();button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();button(tree,"Suggest measurement fixes").props.onClick();tree=flowEditor();
const pendingApply=button(tree,"Apply fixes & confirm");flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,frame:"Concurrent edit during repair preview"}});const concurrent=JSON.stringify(flow);
pendingApply.props.onClick();assert.equal(JSON.stringify(flow),concurrent);tree=flowEditor();assert.match(text(tree),/saved layout changed/);
button(tree,"Discard fixes").props.onClick();tree=flowEditor();button(tree,"Confirm floor plan").props.onClick();tree=flowEditor();button(tree,"Suggest measurement fixes").props.onClick();tree=flowEditor();
box.turnArtRoomWritable=()=>false;const guarded=JSON.stringify(flow);button(tree,"Apply fixes & confirm").props.onClick();assert.equal(JSON.stringify(flow),guarded);box.turnArtRoomWritable=()=>true;
box.nbEpoch=()=>2;button(tree,"Apply fixes & confirm").props.onClick();assert.equal(JSON.stringify(flow),guarded,"A proposal cannot cross a film switch");box.nbEpoch=()=>1;

// Missing object dimensions must identify the actual input, not send the user to a generic fold.
flowUpdate(flow.id,{spatialPlan:{...flow.spatialPlan,status:'draft',anchors:[{id:'alcove',space:'School Bus',name:'Open tiled shower alcove mouth',placement:'East side',xy:[.7,3],z:1.1,basis:'design'}],coordinates:{...flow.spatialPlan.coordinates,spaces:flow.spatialPlan.coordinates.spaces.map(sp=>({...sp,openings:[]}))}}});
reset();tree=flowEditor();button(tree,'Confirm floor plan').props.onClick();tree=flowEditor();
const missingText=text(cls(tree,'loc-confirm-result'));
assert.match(missingText,/Set Object dimensions \(width, depth, height\) for Open tiled shower alcove mouth/);
assert.doesNotMatch(missingText,/Set Floor plan position/,'An existing position is not reported missing');
assert.ok(flat(tree).some(n=>n.type===box.LocCoordInput&&n.props.label==='Vertical position'));
let dimensionFocused=0,rowScrolled=0;
const objectRow={open:false,getAttribute:()=> 'alcove',scrollIntoView:()=>rowScrolled++,querySelector:selector=>selector==='[data-floor-plan-field="size"] input'?{focus:()=>dimensionFocused++}:null};
const objectGroup={open:false,scrollIntoView:noop,querySelector:()=>({focus:noop}),querySelectorAll:()=>[objectRow]};
flat(tree).find(n=>n.type==='fieldset').props.ref.current={querySelector:selector=>selector==='.loc-plan-objects'?objectGroup:null};
const beforeFocus=JSON.stringify(flow);button(tree,'Enter missing dimensions').props.onClick();
assert.ok(objectGroup.open&&objectRow.open&&rowScrolled===1&&dimensionFocused===1,'Repair opens the named object and focuses its size input');
assert.equal(JSON.stringify(flow),beforeFocus,'Opening the precise field leaves measurements unchanged');
// A model can still omit a requested field: expose it during draft review rather than only after confirmation.
box.aiDraftLocationSpatialPlan=async()=>({...structuredClone(flow.spatialPlan),status:'draft',source:box.locationSpatialPlanState(flow).source});
const beforeIncompleteDraft=JSON.stringify(flow);
await button(tree,'Draft floor plan').props.onClick();tree=flowEditor();
assert.match(text(cls(tree,'loc-draft-measurements')),/Object dimensions \(width, depth, height\)/,'An incomplete proposal shows the missing dimensions before confirmation');
assert.equal(JSON.stringify(flow),beforeIncompleteDraft,'Reviewing incomplete AI output does not write it to the saved plan');

console.log("PASS shared-layout review hierarchy, empty/ready/stale/read-only states, parent ownership, optional draft/discard, navigation focus and readable placements");

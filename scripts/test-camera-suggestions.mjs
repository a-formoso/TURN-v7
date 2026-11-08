/* Real placement/validation and component handlers, with disposable locations only. No network or saved-film writes. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const compiled=process.env.CAMERA_TEST_DIST==="1";
const read=f=>readFileSync((compiled?"dist/app/":"app/")+f.replace(/\.jsx$/,compiled?".js":".jsx"),"utf8");
let epoch=1;
const b={console,crypto,TextEncoder,URL,nbEpoch:()=>epoch,location:{hostname:"localhost"},turnIsAdmin:true,
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ["locations.jsx","blender-render-contract.js","blender-set-kitchen.js","blender-set-detail.js","blender-render.js"])vm.runInContext(read(f),b);
const api=b.KinolotCloudRender,copy=v=>JSON.parse(JSON.stringify(v));let checks=0;
const ok=(v,label)=>{assert.ok(v,label);checks++;};
function room(poly=[[0,0],[5,0],[5,4],[0,4]],extra={}){
  const l={id:"room",key:"room",name:"Room",coverageViews:[{id:"authored",name:"Authored view",purpose:"Keep this note",panel:"TL",pose:{position:[99,99,9],yaw:90,pitch:0,lensMm:35,basis:"user"}}],
    spatialPlan:{status:"reviewed",source:{assetId:"room",iso:""},frame:"North",heights:"centre",
      anchors:[{id:"desk",name:"Desk",space:"Room",placement:"East",xy:[4,2],z:(extra.floorZ||0)+.5,size:[1,.8,1],sizeBasis:"design"}],
      coordinates:{spaces:[{id:"room",name:"Room",floorZ:0,ceilingH:3,footprint:poly,openings:[],...extra}]}}};
  b.turnContinuity={locations:[l]};return l;
}
function verify(l){
  const before=JSON.stringify(b.turnContinuity),p=api.proposeCameras(l),again=api.proposeCameras(l);
  ok(JSON.stringify(p)===JSON.stringify(again),"placement is deterministic");
  ok(JSON.stringify(b.turnContinuity)===before,"suggestion leaves saved layout and cameras unchanged");
  ok(p.panels.map(v=>v.role).join() === "wide,reverse,detail,detail","Default coverage always gives each panel a distinct role");
  ok(p.panels.slice(0,2).every(v=>Math.abs(v.pose.pitch)<=20&&v.pose.lensMm>=18&&v.pose.lensMm<=26),"Wide views use modest downward tilt and interior wide lenses");
  const views=api.cameraProposalViews(l,p),next={...l,coverageViews:views};
  ok(JSON.stringify(b.turnContinuity)===before,"preparing a preview is also read-only");
  b.turnContinuity.locations=b.turnContinuity.locations.map(x=>x.id===l.id?next:x);
  ok(Object.keys(api.cameraProblems(next)).length===0,"all four proposed cameras pass the actual room/wall/height/object validator");
  ok(b.locationPanelPoses(next).length===4&&b.locationPanelPoses(next).every(x=>x.pose.position&&x.pose.yaw!=null),"every panel has a numeric position and facing");
  ok(Object.keys(api.buildScene(next).cameras).length===4,"All four Blender views build without drafting composition notes");
  ok(views.find(v=>v.id==="authored").purpose==="Keep this note","applying keeps authored coverage notes");
  return {p,next};
}
verify(room());
verify(room([[0,0],[7,0],[7,1.3],[1.3,1.3],[1.3,6],[0,6]]));
verify(room([[0,0],[6,1],[5,5],[-1,4]],{floorZ:4.4,ceilingH:2.1}));
verify(room([[0,0],[3,0],[3,2],[0,2]],{openSky:true,ceilingH:null}));
{
  const l=room([[-1,0],[2.5,0],[2.5,4],[-1,4]]);
  const anchor=(id,name,xy,size,facing=0,z=size[2]/2)=>({id,name,space:"Room",xy,size,facing,z,sizeBasis:"design",placement:"Saved test position"});
  l.spatialPlan.anchors=[anchor("counter-north","Sink run counter",[.75,3.7],[3.5,.6,.9],180),
    anchor("counter-east","Fridge run counter",[2.2,2.1],[2.6,.6,.9],270),
    anchor("sink","Single-basin sink",[.7,3.7],[.6,.5,.2],180,.8),
    anchor("fridge","Full-height fridge",[2.15,.5],[.7,.7,1.85],270),
    anchor("table","Dining table",[.9,1.3],[.8,.8,.75]),anchor("chair","Dining chair",[.9,.6],[.45,.45,.9])];
  // A historical high corner and wide station must not override the requested coverage pattern.
  l.spatialPlan.coordinates.cameras=[{spaceId:"room",panel:"TR",position:[1.6,3.6,2.1],yaw:160,pitch:-43,lensMm:18},
    {spaceId:"room",panel:"BL",position:[.7,.35,1.5],yaw:0,pitch:-15,lensMm:24}];
  const {p}=verify(l),[wide,reverse,sink,fridge]=p.panels;
  const delta=(wide.pose.yaw-reverse.pose.yaw)*Math.PI/180;
  ok(Math.cos(delta)<.5,"Kitchen wide and reverse provide complementary directions");
  ok(wide.pose.position[1]<1&&reverse.pose.position[1]>2.5&&reverse.pose.position[0]<.75,
    "Kitchen coverage follows the tested front/back positions along the same room side");
  ok(Math.abs(wide.pose.position[2]-reverse.pose.position[2])<=.25,"Wide and reverse stay near eye level with modest height variation");
  ok(sink.targetId==="sink"&&fridge.targetId==="fridge","Kitchen details select the sink and fridge instead of repeating a counter or table");
  ok(sink.pose.lensMm>=28&&fridge.pose.lensMm>=28,"The bottom pair use tighter lenses");
  ok(Math.hypot(sink.pose.position[0]-.7,sink.pose.position[1]-3.7)<2,"The sink is approached for a detail rather than repeated from the doorway");
  ok(Math.hypot(sink.pose.position[0]-.7,sink.pose.position[1]-3.7)>1.4,"Sink detail retains the contextual distance of the approved grid");
  ok(fridge.pose.position[1]>1.4&&fridge.pose.position[0]<1,"Fridge detail uses the tested oblique approach along the counter");
  ok(sink.label.includes("sink")&&fridge.label.includes("fridge"),"Proposal labels identify the two detail subjects");
}
{
  const l=room();
  l.spatialPlan.anchors=[{id:"bed",name:"Single bed",space:"Room",xy:[1,2.7],z:.5,size:[1,2,1],facing:0,sizeBasis:"design"},
    {id:"desk",name:"Writing desk",space:"Room",xy:[4,2.7],z:.375,size:[1.1,.6,.75],facing:180,sizeBasis:"design"},
    {id:"wardrobe",name:"Wardrobe",space:"Room",xy:[4,.5],z:1,size:[1,.6,2],facing:0,sizeBasis:"design"}];
  l.spatialPlan.anchors.forEach(a=>a.placement="Saved fixture placement");
  const {p}=verify(l);
  ok(p.panels[2].targetId==="bed"&&p.panels[3].targetId==="desk","Other rooms adapt detail subjects to their own saved features");
}
{
  const l=room(),root={...l,id:"parent",key:"parent",name:"Whole place"};
  root.spatialPlan.source.assetId="parent";root.spatialPlan.coordinates.spaces[0].id="room";l.spatialPlan=undefined;l.parentKey="parent";
  b.turnContinuity={locations:[root,l]};verify(l);
}
{
  const l=room(),p=api.proposeCameras(l);
  l.spatialPlan.coordinates.spaces[0].ceilingH=2;
  assert.throws(()=>api.cameraProposalViews(l,p),/changed/);checks++;
}
{
  const l=room(),p=api.proposeCameras(l);epoch++;
  assert.throws(()=>api.cameraProposalViews(l,p),/changed/);checks++;
  l.spatialPlan.status="draft";assert.throws(()=>api.proposeCameras(l),/Review|Confirm/i);checks++;
}
{
  const l=room();l.spatialPlan.anchors[0]={...l.spatialPlan.anchors[0],xy:[2.5,2],size:[5,4,3],z:1.5};
  assert.throws(()=>api.proposeCameras(l),/clear space/);checks++;
}
// Real UI handlers: propose -> preview -> discard/use, with onUpdate as the only write boundary.
{
  const l=room(),saved=JSON.stringify(l),states=[],writes=[];let i=0;
  b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
    useState:v=>{const n=i++;if(!(n in states))states[n]=v;return [states[n],v=>states[n]=typeof v==="function"?v(states[n]):v];},useEffect(){},useRef:v=>{const n=i++;if(!(n in states))states[n]={current:v};return states[n];}};
  vm.runInContext(transformSync(read("locations-ui.jsx"),{presets:["@babel/preset-react"],babelrc:false,configFile:false}).code,b);
  b.LocationSuggestedCameraPreviews=function(){};
  b.LocationCameraAngleWorkbench=function(){};
  const render=(readOnly=false)=>{i=0;return b.LocationCameraSuggestions({l,onUpdate:(id,patch)=>writes.push({id,patch}),readOnly});};
  const nodes=n=>n&&typeof n==="object"?[n,...(n.children||[]).flatMap(nodes)]:[];
  const text=n=>typeof n==="string"?n:(n?.children||[]).map(text).join("");
  const button=(tree,label)=>nodes(tree).find(n=>n.type==="button"&&text(n)===label);
  const inspection=tree=>nodes(tree).find(n=>(n.props.className||"").includes("loc-camera-inspection"));
  let tree=render();ok(inspection(tree).props.open===false,"The duplicate overhead map starts collapsed");
  const cameraEditor=nodes(tree).find(n=>n?.type===b.LocationCameraAngleWorkbench);
  ok(tree.children[0].children.includes(cameraEditor)&&cameraEditor.props.inline===true,
    "The angle editor shares the action row to the right of Suggest 4 cameras when no other actions appear");
  button(tree,"Suggest 4 cameras").props.onClick();tree=render();
  ok(inspection(tree).props.open===true,"A proposal opens the map for review before saving");
  ok(writes.length===0&&JSON.stringify(l)===saved,"clicking Suggest makes no saved-data changes");
  const map=nodes(tree).find(n=>n.type===b.LocationFloorPlanMap);
  ok(map&&map.props.scene.cameras.filter(c=>c.spaceId===l.id).length===4,"the preview map receives all four proposed cameras");
  const thumbnails=nodes(tree).find(n=>n.type===b.LocationSuggestedCameraPreviews);
  ok(thumbnails?.props.proposal.panels.length===4&&thumbnails.props.l===l&&writes.length===0,
    "The suggestion card shows proposed 3D thumbnails before saving without substituting saved views");
  map.props.onSelect(l.id+":BR");tree=render();
  ok(nodes(tree).find(n=>n.type===b.LocationSuggestedCameraPreviews).props.previewRequest.panel==="BR"&&writes.length===0,
    "Selecting a proposed camera on the map requests that panel's enlarged 3D view without saving");
  ok(button(render(true),"Use these cameras").props.disabled,"read-only access cannot apply a proposal");
  button(tree,"Discard proposal").props.onClick();ok(!button(render(),"Use these cameras")&&writes.length===0,"discard leaves original cameras untouched");
  ok(inspection(render()).props.open===false,"Discard returns the camera controls to their compact state");
  button(render(),"Suggest 4 cameras").props.onClick();
  const old=l.coverageViews;l.coverageViews=[...old,{id:"new",name:"A later edit"}];
  ok(button(render(),"Use these cameras").props.disabled,"a later camera edit disables stale proposal acceptance");
  button(render(),"Use these cameras").props.onClick();ok(writes.length===0,"a stale apply handler is also guarded");l.coverageViews=old;
  button(render(),"Suggest 4 cameras").props.onClick();const beforeSwitch=render();
  b.turnContinuity.locations=[{...l,coverageViews:[...old,{id:"remote",name:"A concurrent edit"}]}];
  button(beforeSwitch,"Use these cameras").props.onClick();ok(writes.length===0,"an old handler rereads current saved camera data before applying");b.turnContinuity.locations=[l];
  button(render(),"Suggest 4 cameras").props.onClick();tree=render();button(tree,"Use these cameras").props.onClick();
  ok(writes.length===1&&writes[0].id===l.id&&Object.keys(writes[0].patch).join()==="coverageViews","Use saves this room's camera settings exactly once");
  ok(inspection(render()).props.open===false,"Applying the proposal folds the optional inspection map");
  l.coverageViews=writes[0].patch.coverageViews;
  b.turnContinuity.locations=[l];let destination=null;b.goToLocationStep=(location,step)=>destination={location,step};
  tree=render();button(tree,"Go to 4 · Build the set").props.onClick();
  ok(destination?.location===l&&destination.step===4&&writes.length===1,"Ready cameras offer a direct build-step route without saving or drafting notes");
  nodes(tree).find(n=>n.type===b.LocationFloorPlanMap).props.onSelect(l.id+":TR");tree=render();
  ok(nodes(tree).find(n=>n.type===b.LocationCameraAngleWorkbench).props.previewRequest.panel==="TR"&&writes.length===1,
    "A saved camera marker opens the matching saved angle editor without writing");
  b.nbGetMeta=()=>({iso:"a-new-location-image"});tree=render();
  ok(button(tree,"Suggest 4 cameras").props.disabled&&button(tree,"Suggest 4 cameras").props.title.includes("no longer match"),
    "An image/layout mismatch explains the actual blocker instead of implying cameras are already set");
  button(tree,"Review floor plan").props.onClick();
  ok(destination.step===2&&writes.length===1,"The blocked camera action offers a direct floor-plan review route without automatic approval");
  b.nbGetMeta=()=>null;
  b.LocationCameraInspiration=function(){};
  b.BlenderPreview={scope:()=>({uid:"owner",projectId:"film",epoch:1})};
  let resolveConfirm;
  b.KinolotCameraMatch={confirm:()=>new Promise(resolve=>resolveConfirm=resolve)};
  const matchProposal=()=>({...api.proposeCameras(l),imageMatch:{scope:b.BlenderPreview.scope()},referenceUrl:"private-ideas"});
  const propose=p=>nodes(render()).find(n=>n.type===b.LocationCameraInspiration).props.onPropose(p);
  const inspiration=nodes(render()).find(n=>n.type===b.LocationCameraInspiration),ticket=inspiration.props.onPropose(null);
  button(render(),"Suggest 4 cameras").props.onClick();
  inspiration.props.onPropose({...matchProposal(),imageMatch:{stale:true}},ticket);
  ok(!nodes(render()).find(n=>n.type===b.LocationSuggestedCameraPreviews).props.proposal.imageMatch,
    "A late image match cannot overwrite a newer suggestion or discard action");
  propose(matchProposal());tree=render();
  ok(nodes(tree).find(n=>n.type===b.LocationCameraAngleWorkbench).props.inline===false,
    "A proposal with Use and Discard moves the preview button below the action row");
  const originalWrites=writes.length,accept=button(tree,"Use these cameras").props.onClick();
  button(render(),"Discard proposal").props.onClick();resolveConfirm();await accept;
  ok(writes.length===originalWrites,"Discarding during source-image verification prevents a late camera save");
  propose(matchProposal());tree=render();const changed=button(tree,"Use these cameras").props.onClick();
  const prior=l.coverageViews;l.coverageViews=[...prior,{id:"newer-change"}];resolveConfirm();await changed;
  ok(writes.length===originalWrites,"A changed saved camera during async source verification blocks a stale image fit");l.coverageViews=prior;
  propose(matchProposal());tree=render();const readonlyAccept=button(tree,"Use these cameras").props.onClick();
  b.turnArtRoomWritable=()=>false;resolveConfirm();await readonlyAccept;
  ok(writes.length===originalWrites,"Losing edit permission during source verification prevents accepting a fit");b.turnArtRoomWritable=()=>true;
  propose(matchProposal());tree=render();const accepted=button(tree,"Use these cameras").props.onClick();resolveConfirm();await accepted;
  ok(writes.length===originalWrites+1&&Object.keys(writes.at(-1).patch).join()==="coverageViews",
    "Explicit image-fit acceptance saves camera poses only through the existing update boundary");
}
console.log("PASS camera suggestions: "+checks+" deterministic placement, validation, scope and preview/apply checks");

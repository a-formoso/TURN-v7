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
for(const f of ["locations.jsx","blender-render-contract.js","blender-set-detail.js","blender-render.js"])vm.runInContext(read(f),b);
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
  const views=api.cameraProposalViews(l,p),next={...l,coverageViews:views};
  ok(JSON.stringify(b.turnContinuity)===before,"preparing a preview is also read-only");
  b.turnContinuity.locations=b.turnContinuity.locations.map(x=>x.id===l.id?next:x);
  ok(Object.keys(api.cameraProblems(next)).length===0,"all four proposed cameras pass the actual room/wall/height/object validator");
  ok(b.locationPanelPoses(next).length===4&&b.locationPanelPoses(next).every(x=>x.pose.position&&x.pose.yaw!=null),"every panel has a numeric position and facing");
  ok(views.find(v=>v.id==="authored").purpose==="Keep this note","applying keeps authored coverage notes");
  return {p,next};
}
verify(room());
verify(room([[0,0],[7,0],[7,1.3],[1.3,1.3],[1.3,6],[0,6]]));
verify(room([[0,0],[6,1],[5,5],[-1,4]],{floorZ:4.4,ceilingH:2.1}));
verify(room([[0,0],[3,0],[3,2],[0,2]],{openSky:true,ceilingH:null}));
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
    useState:v=>{const n=i++;if(!(n in states))states[n]=v;return [states[n],v=>states[n]=typeof v==="function"?v(states[n]):v];},useEffect(){}};
  vm.runInContext(transformSync(read("locations-ui.jsx"),{presets:["@babel/preset-react"],babelrc:false,configFile:false}).code,b);
  const render=(readOnly=false)=>{i=0;return b.LocationCameraSuggestions({l,onUpdate:(id,patch)=>writes.push({id,patch}),readOnly});};
  const nodes=n=>n&&typeof n==="object"?[n,...(n.children||[]).flatMap(nodes)]:[];
  const text=n=>typeof n==="string"?n:(n?.children||[]).map(text).join("");
  const button=(tree,label)=>nodes(tree).find(n=>n.type==="button"&&text(n)===label);
  let tree=render();button(tree,"Suggest four cameras").props.onClick();tree=render();
  ok(writes.length===0&&JSON.stringify(l)===saved,"clicking Suggest makes no saved-data changes");
  const map=nodes(tree).find(n=>n.type===b.LocationFloorPlanMap);
  ok(map&&map.props.scene.cameras.filter(c=>c.spaceId===l.id).length===4,"the preview map receives all four proposed cameras");
  ok(button(render(true),"Use these cameras").props.disabled,"read-only access cannot apply a proposal");
  button(tree,"Discard proposal").props.onClick();ok(!button(render(),"Use these cameras")&&writes.length===0,"discard leaves original cameras untouched");
  button(render(),"Suggest four cameras").props.onClick();
  const old=l.coverageViews;l.coverageViews=[...old,{id:"new",name:"A later edit"}];
  ok(button(render(),"Use these cameras").props.disabled,"a later camera edit disables stale proposal acceptance");
  button(render(),"Use these cameras").props.onClick();ok(writes.length===0,"a stale apply handler is also guarded");l.coverageViews=old;
  button(render(),"Suggest four cameras").props.onClick();const beforeSwitch=render();
  b.turnContinuity.locations=[{...l,coverageViews:[...old,{id:"remote",name:"A concurrent edit"}]}];
  button(beforeSwitch,"Use these cameras").props.onClick();ok(writes.length===0,"an old handler rereads current saved camera data before applying");b.turnContinuity.locations=[l];
  button(render(),"Suggest four cameras").props.onClick();tree=render();button(tree,"Use these cameras").props.onClick();
  ok(writes.length===1&&writes[0].id===l.id&&Object.keys(writes[0].patch).join()==="coverageViews","Use saves this room's camera settings exactly once");
}
console.log("PASS camera suggestions: "+checks+" deterministic placement, validation, scope and preview/apply checks");

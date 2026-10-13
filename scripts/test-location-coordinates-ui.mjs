#!/usr/bin/env node
/* LOCATION COORDINATES, step A — the card (owner-approved 2026-10-13): "Plate cameras" in Spatial Layout & Staging.
   A room shows each panel's camera and, per window / door, the view it uses — or, when no parent panel faces that
   way, says so, describes what the layout puts there, and offers "Make a <parent> view from <room>'s position"
   (one image, priced on the button). An owner shows suggestions until set ("Use the suggested cameras" — free),
   and warns when its current plate predates its cameras. A window / door object in the shared layout gets a
   "Faces" picker. UI-only mocks: no network, no paid calls, no saved film changes. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const noop=()=>{};
let hooks=[],cursor=0,effects=[];
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;
    return [hooks[i],v=>hooks[i]=typeof v==="function"?v(hooks[i]):v];},
  useReducer:(fn,init)=>React.useState(init),
  useRef:init=>{const i=cursor++;return hooks[i]||(hooks[i]={current:init});},
  useEffect:(fn,deps)=>{const i=cursor++;effects.push(fn);hooks[i]=deps;}
};
const toasts=[];
const box={console,React,setTimeout,clearTimeout,localStorage:{getItem:()=>null},Icon:new Proxy({},{get:()=>noop}),
  addEventListener:noop,removeEventListener:noop,dispatchEvent:()=>true,CustomEvent:class{},nbEpoch:()=>1,
  scenesInStoryOrder:x=>x||[],renderStyleText:()=>"Photoreal",appToast:(m)=>toasts.push(m),
  nbCostChip:(n,o)=>({type:"cost",props:{n,refs:o&&o.refs},children:["≈ cost"]})};
box.window=box;vm.createContext(box);
vm.runInContext(read("app/locations.jsx"),box);
vm.runInContext(read("app/locations-ui.jsx"),box);
let metas={},images={furnace:"furnace-plate"};
box.nbGetMeta=id=>metas[id]||null;box.nbGetImage=id=>images[id]||"";box.nbLoadImage=async id=>images[id]||"";
const anchors=[{id:"mouth",space:"Furnace",name:"Furnace mouth",placement:"north wall, centre"},
  {id:"office-door",space:"Furnace Office",name:"Office door",placement:"on the west wall"},
  {id:"office-window",space:"Furnace Office",name:"Office window",placement:"south wall, overlooking the hall"},
  {id:"desk",space:"Furnace Office",name:"Foreman's desk",placement:"against the east wall"},
  {id:"conveyor",space:"Furnace",name:"Slag conveyor",placement:"along the south wall"}];
const furnace={id:"furnace",key:"furnace",name:"Furnace",spatialPlan:box.normalizeLocationSpatialPlan({frame:"From the loading door facing the furnace mouth",
  status:"reviewed",source:{assetId:"furnace",iso:"f1"},anchors})};
const office={id:"office",key:"office",name:"Furnace Office",parentKey:"furnace"};
box.turnContinuity={locations:[furnace,office],scenes:[],drafts:{}};
metas.furnace={iso:"f1",platePanels:{schema:"cm-plate-panels-v1",spaceId:"furnace",panels:{TL:{yaw:0,lensMm:24}}}};

const flat=n=>!n||typeof n!=="object"?[]:[n,...(n.children||[]).flatMap(flat)];
const text=n=>n==null||n===false?"":typeof n!=="object"?String(n):(n.children||[]).map(text).join("");
const render=(props)=>{cursor=0;effects=[];const tree=box.LocationPlateCameras(props);effects.forEach(f=>f());return tree;};
const writes=[];
const props={l:office,project:{},onUpdate:(id,patch)=>writes.push({id,patch}),readOnly:false,plateMeta:null};

/* a room: its planned cameras, the window that no parent panel faces, and the offer */
hooks=[];
let tree=render(props);
let t=text(tree);
assert.match(t,/Plate cameras/);
assert.match(t,/2 views unresolved/);
assert.match(t,/Each panel of Furnace Office's plate is a camera inside Furnace Office/);
assert.match(t,/never its most striking panel/);
assert.match(t,/from the doorway, looking at the far wall of Furnace Office/);
assert.match(t,/Camera inside Furnace Office just inside Office door, facing east \(90°\)/);
assert.match(t,/“Office window” \(south wall\) → Furnace, looking south/);
assert.match(t,/No Furnace view faces south from here\. The plate describes what lies that way from the shared layout \(Slag conveyor\) and marks it unresolved\./);
const make=flat(tree).filter(n=>n.type==="button"&&/Make a Furnace view from Furnace Office's position/.test(text(n)));
assert.equal(make.length,2,"offered on each panel that sees the window");
const chip=flat(make[0]).find(n=>n.type==="cost");
assert.ok(chip,"the button carries its price");assert.equal(chip.props.n,1);assert.equal(chip.props.refs,1,"priced with the reference it attaches");
assert.match(make[0].props.title,/One image: Furnace seen from Furnace Office/);
assert.equal(make[0].props.disabled,false);
let made=[];
box.generateLocationParentView=async(l,req)=>{made.push(req);return true;};
await make[0].props.onClick();
assert.equal(made.length,1,"one paid image");assert.equal(made[0].assetId,"office-pview-office-window");
assert.match(toasts.pop(),/Made Furnace seen from Furnace Office/);
// already made on this device (a cold cache) → used, never paid twice
images["office-pview-office-window"]="view";metas["office-pview-office-window"]={iso:"v",parentViewPose:{yaw:135,lensMm:16},locationParentIso:"f1"};
made=[];hooks=[];tree=render(props);
t=text(tree);
assert.match(t,/the view made from Furnace Office's position/,"the made view now serves the window");
assert.doesNotMatch(t,/unresolved/);
delete images["office-pview-office-window"];delete metas["office-pview-office-window"];
// a matched parent quadrant
metas.furnace.platePanels.panels.TR={yaw:180,lensMm:18};
hooks=[];t=text(render(props));
assert.match(t,/the top-right panel of Furnace's plate, cut out and attached as its own reference\. Matched by facing/);
assert.match(t,/on some engines each reference adds a little to the price/);
delete metas.furnace.platePanels.panels.TR;
// an old parent plate: unknown facings; view only
metas.furnace={iso:"f1"};
hooks=[];t=text(render(props));
assert.match(t,/Furnace's plate was made before its cameras were recorded, so its panels' facings are unknown/);
// view only: the offer is disabled, nothing is written
hooks=[];tree=render({...props,readOnly:true});
assert.ok(flat(tree).filter(n=>n.type==="button"&&/Make a Furnace view/.test(text(n))).every(b=>b.props.disabled));
assert.ok(flat(tree).filter(n=>n.type==="input"||n.type==="select").every(n=>n.props.disabled));
// layout not reviewed → the offer waits (its title says why)
furnace.spatialPlan={...furnace.spatialPlan,status:"draft"};
hooks=[];tree=render(props);
const waiting=flat(tree).find(n=>n.type==="button"&&/Make a Furnace view/.test(text(n)));
assert.equal(waiting.props.disabled,true);assert.match(waiting.props.title,/Review the shared set layout/);
furnace.spatialPlan={...furnace.spatialPlan,status:"reviewed"};

/* editing a room's camera stores a pose on its coverage views */
hooks=[];tree=render(props);writes.length=0;
const facing=flat(tree).find(n=>n.type==="input"&&n.props.type==="number");
facing.props.onBlur({target:{value:"200"}});
assert.equal(writes.length,1);
const cv=writes[0].patch.coverageViews;
assert.equal(cv[0].panel,"TL");assert.equal(cv[0].pose.yaw,200);assert.equal(cv[0].pose.basis,"user");
assert.match(cv[0].cameraPosition,/facing south \(200°\)/);

/* an owner: suggestions until set; one click stores them (free) */
writes.length=0;hooks=[];
tree=render({...props,l:furnace,plateMeta:{iso:"f1"}});
t=text(tree);
assert.match(t,/Suggested/);
assert.match(t,/Until a camera is set, the plate prompt is unchanged/);
const use=flat(tree).find(n=>n.type==="button"&&text(n)==="Use the suggested cameras");
use.props.onClick();
const ov=writes[0].patch.coverageViews;
assert.deepEqual(JSON.parse(JSON.stringify(ov.map(v=>[v.panel,v.pose.yaw]))),[["TL",0],["TR",45],["BL",0],["BR",180]],
  "the suggestions with a known facing are stored (the stations face the walls their anchors are on)");
assert.equal(ov[0].pose.basis,"design");
assert.match(t,/Setting cameras uses no credits and generates nothing/);
const furnaceSet={...furnace,coverageViews:ov};
hooks=[];t=text(render({...props,l:furnaceSet,plateMeta:{iso:"f1"}}));
assert.match(t,/The current plate was made before these cameras were set — regenerate it so the rooms inside can use its panels\./);
hooks=[];t=text(render({...props,l:furnaceSet,plateMeta:{iso:"f2",platePanels:{panels:{TL:{yaw:0}}}}}));
assert.doesNotMatch(t,/made before these cameras/);

/* the shared layout's window / door objects get a "Faces" picker */
hooks=[];cursor=0;effects=[];
const editor=box.LocationSpatialPlanEditor({l:office,scenes:[],project:{},onUpdate:(id,patch)=>writes.push({id,patch})});
const faces=flat(editor).filter(n=>n.type==="label"&&/^Faces \(outward from/.test(text(n.children[0])));
assert.equal(faces.length,2,"the door and the window, not the desk or the furnace mouth");
const sel=flat(faces[1]).find(n=>n.type==="select");
assert.match(text(flat(sel).find(n=>n.type==="option")),/From its placement: south/);
writes.length=0;sel.props.onChange({target:{value:"180"}});
const saved=writes[0].patch.spatialPlan.anchors.find(a=>a.id==="office-window");
assert.equal(saved.facing,180);assert.equal(writes[0].patch.spatialPlan.status,"draft","a changed layout is reviewed again");

/* wiring and styles */
const ui=read("app/locations-ui.jsx"),css=read("app/styles.css");
assert.match(ui,/function LocationPlateCameras\(/);
assert.match(ui,/"Plate \u00b7 "\+LOC_PANEL_INFO\[v.panel\].label.toLowerCase\(\)/);
assert.match(css,/\.loc-cam-grid\{/);assert.match(css,/@media\(max-width:600px\)\{\n  \.loc-cam-grid\{grid-template-columns:1fr\}/);
console.log("PASS plate cameras on the card: room views, the priced 'Make a … view' offer, owner suggestions, record warning, Faces picker");

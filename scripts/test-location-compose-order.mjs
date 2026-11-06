#!/usr/bin/env node
/* VIEW COMPOSITION FOLLOWS THE SHARED LAYOUT (owner 2026-10-12, "go ahead with all of it").
   1. "Draft notes for this view" waits while the shared layout is drafting / waiting to be confirmed / not ready;
      hand edits stay open.
   2. A drafted composition records the layout it came from (staging.layoutSig) and says
      "Layout changed — re-draft view composition" when that layout changes later (never a block).
   3. The batch paths check the layout first: "Design N locations" and the Location Scout skip (and name) places
      whose layout isn't ready; generateLocationPlate refuses before it drafts any composition.
   4. A composition draft never overwrites grid edits made while it ran (it asks), and a failed draft is said
      in plain words.
   All providers and persistence are mocked; this test spends nothing. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const noop=()=>{};
let hooks=[],cursor=0,effects=[],events=[];
const React={
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;
    return [hooks[i],v=>hooks[i]=typeof v==="function"?v(hooks[i]):v];},
  useReducer:(fn,init)=>React.useState(init),
  useRef:init=>{const i=cursor++;return hooks[i]||(hooks[i]={current:init});},
  useEffect:(fn,deps)=>{const i=cursor++;if(!hooks[i]||!deps||deps.some((d,j)=>d!==hooks[i].deps[j]))effects.push({i,fn});
    hooks[i]={deps:deps||[],cleanup:(hooks[i]&&hooks[i].cleanup)||null};}
};
class CustomEvent{constructor(type,init){this.type=type;this.detail=init&&init.detail;}}
const box={console,React,CustomEvent,setTimeout,clearTimeout,localStorage:{getItem:()=>null},
  Icon:new Proxy({},{get:()=>noop}),EditText:"EditText",SheetField:"SheetField",addEventListener:noop,removeEventListener:noop,
  dispatchEvent:e=>{events.push(e.type);return true;},
  scenesInStoryOrder:x=>x||[],renderStyleText:()=>"Photoreal",nbEpoch:()=>1};
box.window=box;vm.createContext(box);
vm.runInContext(read("app/locations.jsx"),box);
vm.runInContext(read("app/locations-ui.jsx"),box);

let iso="v1";
box.nbGetMeta=()=>({iso});box.nbGetImage=()=>"";
const plan={frame:"From the archway facing the kitchen",
  anchors:[{id:"table",space:"Kitchen",name:"Table",placement:"In front of the fridge",basis:"observed",evidence:"Both upper panels"}],
  sightlines:"Open archway",unresolved:"Dimensions unmeasured",status:"reviewed",source:{assetId:"house",iso:"v1"}};
const house={id:"house",key:"house",name:"House",spatialPlan:box.normalizeLocationSpatialPlan(plan)};
const room={id:"kitchen",key:"kitchen",name:"Kitchen",parentKey:"house"};
box.turnContinuity={locations:[house,room],scenes:[]};
const WAIT="Waiting for the shared layout \u2014 confirm it first.";
assert.equal(box.LOCATION_STAGING_LAYOUT_WAIT,WAIT);

/* ---- 1. the layout gate (registry + reason) ---- */
assert.equal(box.locationStagingDraftBlock(room),"","a confirmed, current layout lets the composition draft");
const t1={},t2={};
box.setLocationLayoutDraftPending("house",t1,true);
assert.equal(box.locationLayoutDraftPending("house"),true);
assert.equal(box.locationStagingDraftBlock(room),WAIT,"a room waits for its parent's layout draft");
assert.equal(box.locationStagingDraftBlock(house),WAIT);
assert.ok(events.includes("loc-layout-draft-pending"),"open composition buttons are told to look again");
box.setLocationLayoutDraftPending("house",t2,true);
box.setLocationLayoutDraftPending("house",t2,false);
assert.equal(box.locationLayoutDraftPending("house"),true,"one idle editor never clears another editor's pending draft");
box.setLocationLayoutDraftPending("house",t1,false);
assert.equal(box.locationLayoutDraftPending("house"),false);
house.spatialPlan={...house.spatialPlan,status:"draft"};
const plateReason=(()=>{try{box.requireLocationSpatialPlan(room);return "";}catch(e){return e.message;}})();
assert.match(plateReason,/Review the shared set layout before rendering/);
assert.equal(box.locationStagingDraftBlock(room),plateReason,"not ready: the plate's own reason, word for word");
house.spatialPlan={...house.spatialPlan,status:"reviewed"};

/* the layout editor registers its draft (busy, then a candidate waiting to be confirmed) */
const flat=n=>!n||typeof n!=="object"?[]:[n,...(n.children||[]).flatMap(flat)];
const text=n=>n==null||n===false?"":typeof n!=="object"?String(n):(n.children||[]).map(text).join("");
const button=(tree,name)=>flat(tree).find(n=>n.type==="button"&&text(n)===name);
const runEffects=()=>{const list=effects;effects=[];list.forEach(({i,fn})=>{const h=hooks[i];if(h.cleanup)h.cleanup();h.cleanup=fn()||null;});};
const render=(Comp,props)=>{cursor=0;effects=[];const tree=Comp(props);runEffects();return tree;};
let resolveDraft;
box.aiDraftLocationSpatialPlan=()=>new Promise(r=>{resolveDraft=r;});
const editorProps={l:room,scenes:[],project:{},onUpdate:noop};
hooks=[];
let tree=render(box.LocationSpatialPlanEditor,editorProps);
assert.equal(box.locationLayoutDraftPending("house"),false,"an idle editor holds nothing");
const draftButton=flat(tree).find(n=>n.type==="button"&&/Draft floor plan/.test(text(n)));
const drafting=draftButton.props.onClick();
tree=render(box.LocationSpatialPlanEditor,editorProps);
assert.equal(box.locationLayoutDraftPending("house"),true,"drafting the layout holds the composition");
assert.equal(box.locationStagingDraftBlock(room),WAIT);
resolveDraft(box.normalizeLocationSpatialPlan({...plan,frame:"Candidate frame",status:"draft",source:{assetId:"house",iso:"v1"}}));
await drafting;
tree=render(box.LocationSpatialPlanEditor,editorProps);
assert.match(text(tree),/Draft to review/);
assert.equal(box.locationLayoutDraftPending("house"),true,"a drafted layout waiting to be confirmed still holds it");
button(tree,"Discard draft").props.onClick();
tree=render(box.LocationSpatialPlanEditor,editorProps);
assert.equal(box.locationLayoutDraftPending("house"),false,"discarding (or confirming) releases it");

/* the composition button: disabled with the reason; hand edits stay open */
const gridProps=(over={})=>({l:room,value:null,onDraftStaging:noop,draftingStage:false,onChange:noop,...over});
const draftCompose=t=>flat(t).find(n=>n.type==="button"&&/Draft notes for this view|Drafting/.test(text(n)));
hooks=[];tree=render(box.StagingGrid,gridProps());
assert.equal(draftCompose(tree).props.disabled,false);
assert.ok(!text(tree).includes(WAIT));
box.setLocationLayoutDraftPending("house",t1,true);
hooks=[];tree=render(box.StagingGrid,gridProps());
assert.equal(draftCompose(tree).props.disabled,true,"waits while the layout is drafting / waiting to be confirmed");
assert.equal(draftCompose(tree).props.title,WAIT);
assert.ok(text(tree).includes(WAIT),"the reason is said next to the button");
const zone=flat(tree).find(n=>n.type==="button"&&/stage-zone/.test(n.props.className||""));
assert.ok(zone&&!zone.props.disabled,"the grid can still be edited by hand");
box.setLocationLayoutDraftPending("house",t1,false);
house.spatialPlan={...house.spatialPlan,status:"draft"};
hooks=[];tree=render(box.StagingGrid,gridProps());
assert.equal(draftCompose(tree).props.disabled,true,"an unconfirmed layout holds it too");
assert.ok(text(tree).includes(plateReason));
house.spatialPlan={...house.spatialPlan,status:"reviewed"};

/* ---- 2. each composition remembers its layout ---- */
const ai=read("app/ai.jsx");
const ast=parseSync(ai,{sourceType:"script",parserOpts:{plugins:["jsx"]},babelrc:false,configFile:false});
const fnSrc=name=>{const f=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id&&n.id.name===name);assert.ok(f,name);return ai.slice(f.start,f.end);};
vm.runInContext(fnSrc("aiDraftStaging"),box);
let completes=0,reply=JSON.stringify({viewLabel:"Kitchen view",bgCenter:"Fridge",midLeft:"Table",floor:"Tiles"});
Object.assign(box,{aiAvailable:()=>true,writingProjectOf:p=>p||{},genreTag:()=>"",extractJSON:s=>{try{return JSON.parse(s);}catch(e){return null;}},
  clipWords:s=>s,scrubBrand:s=>String(s).replace(/Anthropic|Claude/g,"the studio"),writingStamp:t=>({task:t}),
  safeError:e=>String((e&&e.message)||e),claude:{complete:async()=>{completes++;if(reply instanceof Error)throw reply;return reply;}}});
const sigNow=box.locationSpatialPlanSig(house.spatialPlan);
const staged=await box.aiDraftStaging(room,[],{});
assert.equal(staged.layoutSig,sigNow,"the composition is stamped with the layout the prompt read");
const roomStaged={...room,staging:staged};
assert.equal(box.locationStagingLayoutChanged(roomStaged),false);
assert.equal(box.locationStagingLayoutChanged({...room,staging:{...staged,layoutSig:undefined}}),false,"an unstamped (older) composition says nothing");
// re-confirming the same layout (a new source stamp) is not a change; a changed placement is
house.spatialPlan={...house.spatialPlan,source:{assetId:"house",iso:"v1"},reviewedAt:"later"};
assert.equal(box.locationStagingLayoutChanged(roomStaged),false);
house.spatialPlan=box.normalizeLocationSpatialPlan({...plan,anchors:[{...plan.anchors[0],placement:"Against the window wall"}]});
assert.equal(box.locationStagingLayoutChanged(roomStaged),true,"the confirmed layout changed since the draft");
hooks=[];tree=render(box.StagingGrid,gridProps({l:roomStaged}));
assert.ok(text(tree).includes("Layout changed \u2014 re-draft view composition"));
assert.equal(draftCompose(tree).props.disabled,false,"a changed layout is said, never a block");
assert.ok(box.requireLocationSpatialPlan(roomStaged),"plates may still render");
// the stamp survives the coverage-view projection (so a grid edit keeps it)
assert.equal(box.locationCoverageViews(roomStaged)[0].staging.layoutSig,sigNow);
assert.equal(box.locationCoverageViews({...roomStaged,coverageViews:[{id:"v1",name:"Main",staging:staged}]})[0].staging.layoutSig,sigNow);
house.spatialPlan=box.normalizeLocationSpatialPlan(plan);

/* ---- 4b. failures are said in plain words (only when asked; other callers keep the null) ---- */
reply=new Error("Anthropic API overloaded");
assert.equal(await box.aiDraftStaging(room,[],{}),null,"batch callers keep the quiet null");
await assert.rejects(box.aiDraftStaging(room,[],{},{throwErrors:true}),e=>!/Anthropic|Claude/.test(e.message));
reply="not json";
await assert.rejects(box.aiDraftStaging(room,[],{},{throwErrors:true}),/no composition came back/);
box.aiAvailable=()=>false;
await assert.rejects(box.aiDraftStaging(room,[],{},{throwErrors:true}),/writing isn't available/);
box.aiAvailable=()=>true;

/* ---- 3. generateLocationPlate checks the layout BEFORE drafting a composition ---- */
completes=0;let images=0;
box.nbGenerate=async()=>{images++;return "img";};box.nbCommit=async()=>({tier:"local"});
house.spatialPlan={...house.spatialPlan,status:"draft"};
const bare={...room};
await assert.rejects(box.generateLocationPlate(bare,{},{draftStaging:true,onStaged:()=>assert.fail("nothing staged")}),
  /Review the shared set layout before rendering/);
assert.equal(completes,0,"no composition is paid for when the plate would be refused");
assert.equal(images,0);
house.spatialPlan={...house.spatialPlan,status:"reviewed"};

/* ---- 3/4. the app's paths (source checks: they live inside the App component) ---- */
const app=read("app/app.jsx"),agents=read("app/agents.jsx"),ui=read("app/locations-ui.jsx");
const design=app.slice(app.indexOf("const draftAllLocations = async"),app.indexOf("const draftLocationStaging = async"));
assert.ok(design.indexOf("const stageTargets = wantStage.filter(layoutReady)")>0,"'Design N locations' drafts only where the layout is ready");
assert.ok(design.indexOf("filter(layoutReady)")<design.indexOf("aiDraftStaging(l, scenes, project)"),"checked before anything is paid");
assert.match(design,/View composition not drafted for "\+shown\+" \\u2014 confirm "/,"the skipped places are named");
assert.match(app,/stagingWaiting = want\.filter\(l=>!layoutReady\(l\)\)/,"the Location Scout skips them too");
assert.match(app,/const todo = want\.filter\(layoutReady\);/);
assert.match(agents,/waiting for "\+\(waitS\.length!==1\?"their":"its"\)\+" shared layout to be confirmed/);
const single=app.slice(app.indexOf("const draftLocationStaging = async"),app.indexOf("SUB-SPACE CLEANUP"));
assert.ok(single.indexOf("locationStagingDraftBlock(l)")<single.indexOf("setDraftingStageId(l.id)"),"the single draft refuses before it starts");
assert.match(single,/const basis = basisOf\(liveLoc\(\) \|\| l\)/,"a basis is kept when the draft starts");
assert.match(single,/if\(basisOf\(now\)!==basis\)/,"edits made while it ran are noticed");
assert.match(single,/title:"Use the new view composition\?"/);
assert.match(single,/confirmLabel:"Use the new draft", cancelLabel:"Keep my edits"/);
assert.match(single,/your edits were kept and the draft wasn't applied/);
assert.match(single,/aiDraftStaging\(l, scenes, project, \{ throwErrors:true,viewId:target.view.id \}\)/);
assert.match(single,/Couldn't draft \\u201c"\+name\+"\\u201d\\u2019s view composition \("\+why\+"\)\. Nothing was changed \\u2014 try again\./);
assert.doesNotMatch(single,/catch\(e\)\{\}/,"no failure is dropped silently");
assert.match(ui,/setLocationLayoutDraftPending\(id,token,busy\|\|!!candidate\)/);
// the basis compares content (a re-saved, normalised copy of the same grid is not an edit)
const s0={...room,staging:{bg:{center:"Fridge"}}};
assert.equal(box.locationStagingBasis(s0),box.locationStagingBasis({...room,staging:box.stagingOf(s0)}));
assert.notEqual(box.locationStagingBasis(s0),box.locationStagingBasis({...room,staging:{bg:{center:"Sink"}}}));

/* ---- Frances knows ---- */
for(const phrase of ["Waiting for the shared layout \\u2014 confirm it first.","Layout changed \\u2014 re-draft view composition",
  "Use the new view composition?","only for places whose floor plan is confirmed"])
  assert.ok(ai.includes(phrase),"APP_FEATURES: "+phrase);
console.log("PASS view composition waits for the shared layout, remembers it, batch paths check it first, edits kept, failures said");

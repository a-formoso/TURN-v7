/* Real manual-card preflight + real source/seed helpers; no provider or cloud writes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ui=fs.readFileSync("app/shots-ui.jsx","utf8");
const label=ui.slice(ui.indexOf("function shotCardReferenceLabel("),ui.indexOf("/* a labelled grammar"));
const gate=ui.slice(ui.indexOf("  const shotFrameStatus ="),ui.indexOf("  const shotChainOk ="));
const start=ui.slice(ui.indexOf("  const startShot = async"),ui.indexOf("  // Every Art Room department"));
assert.ok(start.includes("const startShot = async"));
const plain=x=>JSON.parse(JSON.stringify(x));
const records=[
  {id:"b1",beatN:1,order:0,keyframeMode:"beat-opening",locked:true},
  {id:"b1-old-a",beatN:1,order:1},
  {id:"b1-old-b",beatN:1,order:2},
  {id:"b2",beatN:2,order:3,keyframeMode:"beat-opening",locked:true,anchor:true,size:"MWS"},
  {id:"b2-old-a",beatN:2,order:4},
  {id:"b2-old-b",beatN:2,order:5},
  {id:"b3",beatN:3,order:6,keyframeMode:"beat-opening"},
].map(s=>({...s,sceneId:"scene"}));
function harness(options={}){
  const shots=plain(records),images=new Map(),metas=new Map();
  const h={console,shots,images,metas,epoch:1,loads:[],notices:[],runs:[],confirms:[],
    batchActiveId:null,chain:null,chainStartingRef:{current:false},
    shotById:Object.fromEntries(shots.map(s=>[s.id,s])),shotsByScene:{scene:shots},
    turnContinuity:{drafts:{scene:{blocks:[
      {type:"action",beat:1,text:"Living room."},
      {type:"action",beat:2,text:"THE KITCHEN. Marcus sets the phone down."},
      {type:"action",beat:3,text:"He opens the notebook."},
    ]}}},
    chainKeyOk:()=>true,batch:{setMsg:()=>{}},
    setNotice:text=>h.notices.push(text),setCollapsed:()=>{},
    stepChain:(ids,index,force)=>h.runs.push({ids:plain(ids),index,force}),
    nbEpoch:()=>h.epoch,nbGetImage:id=>images.get(id)||"",nbGetMeta:id=>metas.get(id)||null,
    nbLoadImage:async id=>{h.loads.push(id);return options.load?await options.load(h,id):images.get(id)||"";},
    appConfirm:async config=>{h.confirms.push(config);return options.confirm?await options.confirm(h):false;},
  };
  h.manualShotInputsRef={current:h.shotsByScene};
  if(options.remote) h.nbRemoteImageUrl=id=>options.remote(h,id);
  h.window=h;
  vm.createContext(h);
  vm.runInContext(fs.readFileSync("app/scene-order.js","utf8"),h);
  vm.runInContext(fs.readFileSync("app/shots.jsx","utf8"),h);
  vm.runInContext(label+"\n"+gate+"\n"+start+"\nwindow.start=startShot;",h);
  images.set("b2","saved-kitchen-frame");
  metas.set("b2",{version:4,iso:"2026-09-11T16:00:00Z",
    shotSource:h.shotSourceStamp(h.shotById.b2,h.turnContinuity.drafts.scene)});
  return h;
}
const onlyClicked=h=>assert.deepEqual(h.runs,[{ids:["b3"],index:0,force:true}]);
{
  const h=harness(),before=plain(h.shots);
  await h.start("b3");
  onlyClicked(h);
  assert.deepEqual(h.loads,[],"the saved Beat 2 primary is used, not the missing raw Shot 6");
  assert.deepEqual(h.notices,[]);
  assert.deepEqual(plain(h.shots),before,"no saved frame, approval, alternative or order is rewritten");
}
{
  const h=harness();
  h.shotById.b2.order=5.5;
  h.shotsByScene.scene.sort((a,b)=>a.order-b.order);
  await h.start("b3");
  onlyClicked(h);
  assert.equal(h.seedShotOf(h.shotById["b2-old-a"],h.shots).id,"b2");
}
{
  const h=harness({load:async(h,id)=>id==="b2"?"loaded-existing-frame":""});
  h.images.clear();
  await h.start("b3");
  onlyClicked(h);
  assert.deepEqual(h.loads,["b2"],"cold cache waits for the correct stored primary only");
}
{
  const h=harness({remote:async(h,id)=>id==="b2"?"signed-existing-reference":""});
  h.images.clear();
  await h.start("b3");
  onlyClicked(h);
}
{
  const h=harness();h.images.clear();
  await h.start("b3");
  assert.deepEqual(h.runs,[]);
  assert.match(h.notices[0],/Beat 3 uses Beat 2/);
  assert.match(h.notices[0],/no available image/);
  assert.doesNotMatch(h.notices[0],/Shot [67]/);
  assert.equal(h.chainStartingRef.current,false);
}
{
  const h=harness({load:async()=>{throw Error("Storage unavailable");}});
  h.images.clear();await h.start("b3");
  assert.deepEqual(h.runs,[]);
  assert.match(h.notices[0],/could not be loaded/);
  assert.doesNotMatch(h.notices[0],/Generate Beat/);
}
for(const status of ["unverified","stale"]){
  const h=harness();
  if(status==="unverified") h.metas.set("b2",{version:4});
  else h.metas.get("b2").shotSource.specHash="old-spec";
  await h.start("b3");
  assert.deepEqual(h.runs,[]);
  assert.match(h.notices[0],/Beat 2 already has a generated image/);
  assert.match(h.notices[0],status==="stale"?/has changed/:/unverified/);
  assert.match(h.notices[0],/Approve with override/);
  assert.doesNotMatch(h.notices[0],/Generate Beat 2 first/);
  h.shotById.b2.sourceOverride=h.shotSourceStamp(h.shotById.b2,h.turnContinuity.drafts.scene);
  await h.start("b3");onlyClicked(h);
}
for(const approved of [false,true]){
  const h=harness({confirm:async()=>approved});
  h.shotById.b2.locked=false;await h.start("b3");
  assert.equal(h.confirms.length,1);
  assert.match(h.confirms[0].body,/Beat 3 chains from Beat 2/);
  assert.equal(h.runs.length,approved?1:0);
  assert.equal(h.shotById.b2.locked,false,"one-time seed consent never silently persists approval");
}
{
  const h=harness();h.images.clear();h.shotById.b3.anchor=true;
  await h.start("b3");onlyClicked(h);
  assert.deepEqual(h.loads,[],"Fresh start has no incoming image dependency");
}
for(const mutate of [
  h=>h.epoch++,
  h=>{h.manualShotInputsRef.current=null;},
  h=>{h.shotById.b2.size="CU";},
  h=>{h.shotsByScene.scene=h.shots.filter(s=>s.id!=="b2");},
  h=>{h.turnContinuity.drafts.scene.blocks[1].text="Writer changed the beat";},
]){
  const h=harness({load:async(h)=>{mutate(h);return "late-frame";}});
  h.images.clear();await h.start("b3");
  assert.deepEqual(h.runs,[],"changed scope/spec/source during loading cannot queue a paid render");
  assert.equal(h.chainStartingRef.current,false);
}
{
  const h=harness({confirm:async h=>{h.epoch++;return true;}});
  h.shotById.b2.locked=false;await h.start("b3");
  assert.deepEqual(h.runs,[],"changed scope during approval cannot queue a paid render");
}
console.log("Beat-primary manual generation preflight regressions passed.");
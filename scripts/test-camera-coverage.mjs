#!/usr/bin/env node
/* Automatic camera coverage (2026-11-11, owner: a useful first result for any location — the app chooses the
   cameras, nothing blocks a frame, and no room gets its own camera recipe). The real app/camera-coverage.js and
   blender-render.js against disposable rooms; no network, account, model or saved-film writes.
     A  the check: a camera too close to an object, facing one flat surface, inside an object, or showing no object
        of the set fails with a plain reason; a clear view passes
     B  the plan: four different clear views (wide, reverse, two details), deterministic, the set untouched; a
        corridor is seen from both ends; a camera stands where a person could; kept cameras stay exactly as set
     C  what steers the details: the screenplay's objects first, one of each kind, furniture-scale subjects, small
        props and floor markings shown beside others; a room with one object still gets four clear views
     D  through the app: proposeCamerasAuto gives a proposal the card can save; assessCameras names a blocked saved
        camera; the fix keeps the good cameras; the older placement is still there
     E  the card: Suggest 4 cameras uses the fit, the Build step shows the check and its four choices; script order;
        Frances's notes
   node scripts/test-camera-coverage.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const b={console,crypto,TextEncoder,URL,nbEpoch:()=>1,location:{hostname:"localhost"},turnIsAdmin:true,TURN_SUPABASE:{setBuild:true,setBuildMcp:true},
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};b.window=b;vm.createContext(b);
for(const f of ["locations.jsx","blender-render-contract.js","blender-set-kitchen.js","blender-set-detail.js","blender-render.js","camera-angle-preview.js","camera-coverage.js"])
  vm.runInContext(read("app/"+f),b,{filename:f});
const T=await import(new URL("../app/vendor/three/r180/three.module.min.js",import.meta.url));
b.KinolotAnglePreview.load=async()=>T;
const cover=b.KinolotCameraCoverage,preview=b.KinolotAnglePreview,api=b.KinolotCloudRender;
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,5).join("\n    "));}};
const box=(id,position,size,anchorId,rotation=[0,0,0])=>({id,name:anchorId?id:id,position,size,rotation,material:"grey",kind:"box",...(anchorId?{anchorId}:{})});
const hold={position:[1,1,1.5],yaw:0,pitch:0,lensMm:24};
function shell(w,d,h,objects){
  return {scene:{schema:b.KinolotRenderContract.MCP_SCHEMA,authoring:"mcp-procedural-v1",name:"Test room",units:"metres",notes:[],
    materials:{grey:{baseColor:[.5,.5,.5],roughness:.8}},previewLights:[],cameras:{TL:hold,TR:hold,BL:hold,BR:hold},
    objects:[box("floor-0",[w/2,d/2,-.075],[w,d,.15]),box("ceiling-0",[w/2,d/2,h+.075],[w,d,.15]),
      box("wall-0-0",[w/2,0,h/2],[w,.15,h]),box("wall-0-1",[w/2,d,h/2],[w,.15,h]),box("wall-0-2",[0,d/2,h/2],[.15,d,h]),box("wall-0-3",[w,d/2,h/2],[.15,d,h]),...objects]},
    space:{footprint:[[0,0],[w,0],[w,d],[0,d]],floorZ:0,ceilingH:h}};
}
const pose=(position,yaw,pitch=0,lensMm=24)=>({position,yaw,pitch,lensMm});
const room=()=>shell(8,6,3,[box("desk",[2,5,.4],[1.6,.8,.8],"desk"),box("cabinet",[7.3,3,1],[.8,2.4,2],"cabinet"),box("sofa",[4,1,.45],[2.2,.9,.9],"sofa")]);

await test("A the check names a blocked view in plain words, and passes a clear one", ()=>{
  const {scene,space}=room();
  const r=cover.assess(T,preview,scene,space,{TL:pose([4,3,1.6],300,-8),            // across the room at the desk: clear
    TR:pose([6.2,3,1.5],90),                                                         // 0.7 m from the cabinet, facing it
    BL:pose([4,3,1.6],180,60),                                                       // up at the ceiling
    BR:pose([2,5,.5],0)});                                                           // inside the desk
  assert.equal(r.TL,"");
  assert.match(r.TR,/^(It is too close to cabinet, which fills the frame|It faces one flat surface: cabinet)\.$/);
  assert.ok(r.BL,"a view of bare ceiling and wall is not a usable picture");assert.match(r.BL,/No object of the set is clearly visible|flat surface/);
  assert.match(r.BR,/^It stands inside or against part of the set\.$/);
  assert.equal(cover.assess(T,preview,scene,space,{TL:pose([4,3,1.6],300,-8)}).TR,"It has no position yet.");
  // an empty room has nothing to show: only a camera pressed against a surface fails there
  const empty=shell(5,4,2.6,[]);
  assert.equal(cover.assess(T,preview,empty.scene,empty.space,{TL:pose([1,1,1.6],45,-5),TR:pose([1,1,1.6],45,-5),BL:pose([1,1,1.6],45,-5),BR:pose([1,1,1.6],45,-5)}).TL,"");
});

await test("B the plan: four different clear views, deterministic, the set untouched", ()=>{
  const {scene,space}=room(),before=JSON.stringify(scene);
  const p=cover.plan(T,preview,scene,space),again=cover.plan(T,preview,scene,space);
  assert.equal(JSON.stringify(scene),before,"planning never moves an object or a saved camera");
  assert.equal(JSON.stringify(p),JSON.stringify(again),"the same set gives the same cameras");
  assert.equal(p.panels.map(v=>v.key).join(),"TL,TR,BL,BR");
  assert.equal(p.panels.map(v=>v.role).join(),"wide,reverse,detail,detail");
  const poses=Object.fromEntries(p.panels.map(v=>[v.key,v.pose]));
  assert.equal(Object.values(cover.assess(T,preview,scene,space,poses)).join("|"),"|||","every proposed view passes the check");
  assert.ok(Math.hypot(poses.TL.position[0]-poses.TR.position[0],poses.TL.position[1]-poses.TR.position[1])>=10*.3,"the reverse view stands in another part of the room");
  assert.ok(Math.cos((poses.TL.yaw-poses.TR.yaw)*Math.PI/180)<=.2,"…and looks the other way");
  assert.equal(new Set(p.panels.slice(2).map(v=>v.targetId)).size,2,"two different detail subjects");
  for(const v of p.panels){
    assert.ok(v.pose.position.every(n=>Math.abs(n*100-Math.round(n*100))<1e-6)&&Math.abs(v.pose.yaw*10-Math.round(v.pose.yaw*10))<1e-6,"saved precision: what is checked is what is saved");
    assert.equal(JSON.stringify(b.normalizeLocationCameraPose({...v.pose,basis:"design"}).position),JSON.stringify(v.pose.position));
    assert.ok(v.pose.lensMm>=18&&v.pose.lensMm<=35&&Math.abs(v.pose.pitch)<=40);
  }
  assert.ok(p.panels.slice(0,2).every(v=>v.pose.lensMm<=24)&&p.panels.slice(2).every(v=>v.pose.lensMm>=21));
});

await test("B a corridor is seen from both ends; a camera stands where a person could, never over the furniture", ()=>{
  const seats=[];for(let i=0;i<8;i++)for(const x of [.5,1.9])seats.push(box("seat-"+i+"-"+x,[x,1.2+i*1.1,.5],[.9,.6,1],i===3&&x===.5?"story-seat":i===5&&x===1.9?"other-seat":undefined));
  const {scene,space}=shell(2.4,10.4,2,[...seats,box("dash",[1.2,9.9,.6],[1.2,.6,1.2],"dash")]);
  const p=cover.plan(T,preview,scene,space,{subjects:[{id:"story-seat",name:"Their seat",weight:3},{id:"other-seat",name:"Other seat",weight:1},{id:"dash",name:"Driver's dash",weight:2}]});
  const [a,c]=p.panels;
  assert.ok(Math.abs(a.pose.position[1]-c.pose.position[1])>5,"the two wide views stand at opposite ends");
  assert.ok(Math.cos((a.pose.yaw-c.pose.yaw)*Math.PI/180)<0,"…facing each other's end");
  for(const v of p.panels){
    const [x,y]=v.pose.position;
    // seats occupy x 0.05–0.95 and 1.45–2.35: a camera may lean 0.3 m over one from the aisle, no further
    assert.ok(x>.95-.31&&x<1.45+.31||!seats.some(s=>Math.abs(y-s.position[1])<.3),v.key+" stands in or beside the aisle: "+x);
  }
  assert.ok(p.panels.slice(2).some(v=>v.targetId==="story-seat"),"the screenplay's seat gets a detail");
  assert.ok(p.panels.slice(2).some(v=>v.targetId==="dash"),"…and the other detail is a different kind of thing, not the twin seat");
});

await test("B kept cameras stay exactly as set; only the other panels are placed, to add to them", ()=>{
  const {scene,space}=room(),mine={position:[7.2,5.4,1.7],yaw:232.4,pitch:-9.5,lensMm:28,basis:"user"};
  const p=cover.plan(T,preview,scene,space,{keep:{TR:mine,BL:{...mine,position:[1,1,1.4],yaw:20}}});
  assert.equal(p.panels[1].pose,mine);assert.equal(p.panels[1].role,"kept");assert.equal(p.panels[2].role,"kept");
  assert.equal(p.panels[0].role,"wide");assert.equal(p.panels[3].role,"detail");
});

await test("C details: screenplay objects first, one of each kind, furniture scale; small props and floor marks ride along", ()=>{
  const {scene,space}=shell(9,7,3,[box("bench-a",[2,6,.5],[1.8,.6,1],"bench-a"),box("bench-b",[6,6,.5],[1.8,.6,1],"bench-b"),
    box("table",[4.5,2.5,.4],[1.6,.9,.8],"table"),box("mug",[4.5,2.5,.86],[.1,.1,.12],"mug"),box("tape",[7,3,.005],[.6,.05,.01],"tape"),
    box("lamp",[4.5,3.5,2.9],[1.2,.2,.08],"lamp")]);
  const meta=[{id:"bench-a",name:"Bench A",weight:3,kind:"bench"},{id:"bench-b",name:"Bench B",weight:3,kind:"bench"},{id:"table",name:"Table",weight:1},
    {id:"mug",name:"Mug",weight:3},{id:"tape",name:"Tape mark",weight:3},{id:"lamp",name:"Ceiling lamp",weight:3}];
  const p=cover.plan(T,preview,scene,space,{subjects:meta}),targets=p.panels.slice(2).map(v=>v.targetId);
  assert.ok(targets.includes("bench-a")||targets.includes("bench-b"),"a screenplay bench is a detail");
  assert.ok(!(targets.includes("bench-a")&&targets.includes("bench-b")),"not both benches: they are the same kind");
  assert.ok(targets.includes("table"),"the second detail is a different kind of object");
  assert.ok(!targets.some(t=>["mug","tape","lamp"].includes(t)),"a small prop, a floor mark and a ceiling fitting are never the subject of a detail");
  // an opening the caller flags is not a detail subject either
  const q=cover.plan(T,preview,scene,space,{subjects:meta.map(m=>m.id==="table"?{...m,opening:true}:m)});
  assert.ok(!q.panels.slice(2).some(v=>v.targetId==="table"));
});

await test("C a sparse room still gets four clear, different views (no forced close-up)", ()=>{
  const {scene,space}=shell(6,5,2.8,[box("bed",[1.2,3.8,.25],[1.4,2,.5],"bed")]);
  const p=cover.plan(T,preview,scene,space),poses=Object.fromEntries(p.panels.map(v=>[v.key,v.pose]));
  assert.equal(Object.values(cover.assess(T,preview,scene,space,poses)).join("|"),"|||");
  assert.equal(p.panels[2].targetId,"bed");assert.equal(p.panels[3].role,"wide");assert.equal(p.panels[3].label,"Another room view");
  assert.equal(new Set(p.panels.map(v=>JSON.stringify(v.pose))).size,4);
});

// ── through the app
function location(){
  const anchor=(id,name,xy,size,extra={})=>({id,name,space:"Room",xy,z:size[2]/2,size,facing:0,sizeBasis:"design",placement:"Saved test position",basis:"design",...extra});
  const l={id:"room",key:"room",name:"Room",coverageViews:[],
    spatialPlan:{status:"reviewed",source:{assetId:"room",iso:""},frame:"North",heights:"centre",
      anchors:[anchor("stand",  "Wide display stand",[4,5.2],[5,1.2,2.2],{basis:"script",evidence:"Script: she leans on the stand"}),
        anchor("crate","Packing crate",[1.5,1.5],[1,1,1]),anchor("crate-2","Second packing crate",[6.5,1.5],[1,1,1]),
        anchor("workbench","Workbench",[7,3.4],[.8,1.8,.9],{basis:"script"})],
      coordinates:{spaces:[{id:"room",name:"Room",floorZ:0,ceilingH:3,footprint:[[0,0],[8,0],[8,6],[0,6]],openings:[]}]}}};
  b.turnContinuity={locations:[l]};return l;
}
await test("D proposeCamerasAuto: a proposal the card can save, fitted to the built set; nothing is saved by proposing", async()=>{
  const l=location(),before=JSON.stringify(b.turnContinuity);
  // (a room whose cameras were never set — its default cameras may stand against a wall — can still be planned)
  const p=await api.proposeCamerasAuto(l);
  assert.equal(JSON.stringify(b.turnContinuity),before);
  assert.equal(p.auto,true);assert.equal(p.key,api.cameraProposalKey(l));
  assert.equal(p.panels.map(v=>v.role).join(),"wide,reverse,detail,detail");
  assert.ok(p.panels.every(v=>v.pose.basis==="design"));
  assert.ok(p.panels.slice(2).some(v=>v.targetId==="stand"),"the screenplay's object gets a detail");
  assert.ok(!(p.panels[2].targetId?.startsWith("crate")&&p.panels[3].targetId?.startsWith("crate")),"the twin crates are one kind");
  assert.match(p.warnings[0],/^Automatic coverage: Wide room view, Reverse room view, .+ detail, .+ detail\. Each view was checked against the set as it will be built/);
  const views=api.cameraProposalViews(l,p),next={...l,coverageViews:views};
  b.turnContinuity={locations:[next]};
  assert.equal(Object.keys(api.cameraProblems(next)).length,0);
  assert.equal(Object.values(await api.assessCameras(next)).join("|"),"|||","saved, they pass the check the Build step runs");
  assert.equal(Object.keys(api.buildScene(next).cameras).length,4);
});

await test("D assessCameras names a blocked saved camera; the fix keeps the good ones and passes", async()=>{
  const l=location(),p=await api.proposeCamerasAuto(l);
  let next={...l,coverageViews:api.cameraProposalViews(l,p)};
  // a hand-set camera 0.6 m from the stand's front, facing it
  next={...next,coverageViews:b.locationCoverageViewsWithPose(next,"BR",{position:[4,4,1.5],yaw:0,pitch:0,lensMm:35,basis:"user"})};
  b.turnContinuity={locations:[next]};
  const faults=await api.assessCameras(next);
  assert.equal([faults.TL,faults.TR,faults.BL].join("|"),"||");
  assert.match(faults.BR,/^(It is too close to Wide display stand, which fills the frame|It faces one flat surface: Wide display stand)\.$/);
  const keep=["TL","TR","BL"],fix=await api.proposeCamerasAuto(next,undefined,{keep}),saved=b.locationPanelPoses(next);
  for(const k of keep)assert.equal(JSON.stringify(fix.panels.find(v=>v.key===k).pose),JSON.stringify(saved.find(v=>v.key===k).pose),k+" is untouched");
  assert.notEqual(JSON.stringify(fix.panels[3].pose.position),"[4,4,1.5]");
  assert.match(fix.warnings[0],/^Automatic coverage: [^,]+\. Each view/,"only the refitted panel is named");
  const fixed={...next,coverageViews:api.cameraProposalViews(next,fix)};b.turnContinuity={locations:[fixed]};
  assert.equal(Object.values(await api.assessCameras(fixed)).join("|"),"|||");
  assert.equal(typeof api.proposeCameras,"function","the older placement remains as the fallback");
});

await test("E the real step-3 handlers: Suggest fits to the built set, shows the proposal, and saves only on Use these cameras", async()=>{
  const {transformSync}=await import("@babel/core");
  const l=location(),saved=JSON.stringify(l),states=[],writes=[];let i=0;
  b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
    useState:v=>{const n=i++;if(!(n in states))states[n]=v;return [states[n],v=>states[n]=typeof v==="function"?v(states[n]):v];},useEffect(){},useRef:v=>{const n=i++;if(!(n in states))states[n]={current:v};return states[n];}};
  vm.runInContext(transformSync(read("app/locations-ui.jsx"),{presets:["@babel/preset-react"],babelrc:false,configFile:false}).code,b);
  b.LocationSuggestedCameraPreviews=function(){};b.LocationCameraAngleWorkbench=function(){};
  const render=()=>{i=0;return b.LocationCameraSuggestions({l,onUpdate:(id,patch,meta)=>writes.push({id,patch,meta})});};
  const nodes=n=>n&&typeof n==="object"?[n,...(n.children||[]).flatMap(nodes)]:[];
  const text=n=>typeof n==="string"?n:(n?.children||[]).map(text).join("");
  const button=(tree,label)=>nodes(tree).find(n=>n.type==="button"&&text(n)===label);
  const pending=button(render(),"Suggest 4 cameras").props.onClick();
  assert.ok(button(render(),"Finding clear views\u2026")?.props.disabled,"the button says it is working, and cannot be pressed twice");
  await pending;
  let tree=render();
  const shown=nodes(tree).find(n=>n.type===b.LocationSuggestedCameraPreviews)?.props.proposal;
  assert.equal(shown?.auto,true,"the proposal on the card is the fitted one, not the older placement");
  assert.ok(nodes(tree).some(n=>n.type==="p"&&/^Automatic coverage: Wide room view, Reverse room view/.test(text(n))));
  assert.equal(writes.length,0);assert.equal(JSON.stringify(l),saved,"suggesting saves nothing");
  await button(tree,"Use these cameras").props.onClick();
  assert.equal(writes.length,1);assert.equal(writes[0].meta.kind,"suggested-cameras");
  assert.equal(writes[0].patch.coverageViews.filter(v=>v.pose&&v.pose.position).length,4);
  // without the 3D module the older placement still answers, so the button never dead-ends
  const load=b.KinolotAnglePreview.load;b.KinolotAnglePreview.load=async()=>{throw Error("offline");};
  states.length=0;await button(render(),"Suggest 4 cameras").props.onClick();
  const fallback=nodes(render()).find(n=>n.type===b.LocationSuggestedCameraPreviews)?.props.proposal;
  b.KinolotAnglePreview.load=load;
  assert.ok(fallback&&!fallback.auto&&fallback.panels.length===4);
});

await test("E the real Build step: a blocked camera is named, the build waits, and one press refits only that camera", async()=>{
  // saved cameras: the fitted four, then BR moved by hand to 0.6 m from the stand
  const l0=location(),p=await api.proposeCamerasAuto(l0);
  let l={...l0,coverageViews:api.cameraProposalViews(l0,p)};
  l={...l,coverageViews:b.locationCoverageViewsWithPose(l,"BR",{position:[4,4,1.5],yaw:0,pitch:0,lensMm:35,basis:"user"})};
  b.turnContinuity={locations:[l]};
  const states=[],writes=[];let i=0;
  b.React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
    useState:v=>{const n=i++;if(!(n in states))states[n]=typeof v==="function"?v():v;return [states[n],x=>states[n]=typeof x==="function"?x(states[n]):x];},
    useEffect(){},useRef:v=>{const n=i++;if(!(n in states))states[n]={current:v};return states[n];}};
  b.BlenderPreview={scope:()=>({uid:"u",projectId:"p",epoch:1}),isCurrent:()=>true};
  vm.runInContext(read("app/blender-render-ui.jsx"),b);
  const render=()=>{i=0;return b.LocationCloudRender({location:l,onUpdate:(id,patch,meta)=>{writes.push({id,patch,meta});l={...l,...patch};b.turnContinuity={locations:[l]};}});};
  const nodes=n=>n&&typeof n==="object"?[n,...(n.children||[]).flatMap(nodes)]:[];
  const text=n=>typeof n==="string"?n:(n?.children||[]).map(text).join("");
  const byId=(tree,id)=>nodes(tree).find(n=>n.props&&n.props["data-testid"]===id);
  const build=tree=>nodes(tree).find(n=>n.type==="button"&&/^(Build set|Rebuild set)/.test(text(n)));
  // the card's effects do not run here: give it what they would — a connected renderer and the check's answer
  render();
  const slot=states.findIndex(x=>x&&typeof x==="object"&&"faults" in x),capable=states.findIndex(x=>x===false);
  states[capable]=true;
  const answer=async()=>{states[slot]={key:b.KinolotRenderContract.canonical(api.buildScene(l)),faults:await api.assessCameras(l)};};
  let tree=render();
  assert.equal(byId(tree,"camera-check"),undefined,"nothing is shown while the check is still running");
  await answer();tree=render();
  const block=byId(tree,"camera-check");
  assert.match(text(block),/^One camera would not show the set clearly:Bottom-right camera: (It is too close to|It faces one flat surface:) Wide display stand/);
  assert.ok(build(tree).props.disabled,"the paid build waits");
  assert.equal(build(tree).props.title,"Fix the cameras named above first, or choose Keep these cameras");
  for(const id of ["camera-check-fix-build","camera-check-fix","camera-check-anyway"])assert.ok(byId(tree,id),id);
  const before=JSON.stringify(b.locationPanelPoses(l).map(v=>v.pose));
  await byId(tree,"camera-check-fix").props.onClick();
  assert.equal(writes.length,1);assert.equal(writes[0].meta.kind,"suggested-cameras");
  const after=b.locationPanelPoses(l).map(v=>v.pose),was=JSON.parse(before);
  assert.equal(JSON.stringify(after.slice(0,3)),JSON.stringify(was.slice(0,3)),"the three good cameras are untouched");
  assert.notEqual(JSON.stringify(after[3]),JSON.stringify(was[3]),"only the blocked camera moved");
  await answer();tree=render();
  assert.equal(byId(tree,"camera-check"),undefined);
  assert.match(text(byId(tree,"camera-check-fixed")),/^Cameras updated: Bottom-right is now \u201c.+\u201d\. You can review them in Cameras\.$/);
  assert.ok(!build(tree).props.disabled||build(tree).props.title===undefined,"the build is no longer held by the cameras");
  // Keep these cameras: the build is released for exactly this set
  l={...l,coverageViews:b.locationCoverageViewsWithPose(l,"BR",{position:[4,4,1.5],yaw:0,pitch:0,lensMm:35,basis:"user"})};b.turnContinuity={locations:[l]};
  await answer();tree=render();assert.ok(byId(tree,"camera-check"));
  byId(tree,"camera-check-anyway").props.onClick();tree=render();
  assert.equal(byId(tree,"camera-check"),undefined,"kept on purpose: the warning steps aside");
});

await test("E the card, the script order and Frances's notes", ()=>{
  const ui=read("app/locations-ui.jsx"),build=read("app/blender-render-ui.jsx"),html=read("TURN.html"),ai=read("app/ai.jsx");
  assert.ok(ui.includes("try{p=api.proposeCamerasAuto?await api.proposeCamerasAuto(l,list):api.proposeCameras(l,list);}"));
  assert.ok(ui.includes('fitting?"Finding clear views\\u2026":"Suggest 4 cameras"'));
  // 2026-11-15 (owner: one road): the cloud build left the card, so the camera check and its free fix are in Previs
  const previs=read("app/set-previs-ui.jsx");
  assert.ok(!ui.includes("window.LocationCloudRender"),"the card no longer mounts the cloud build");
  for(const id of ["camera-check","camera-check-fix","camera-check-fixed"])assert.ok(previs.includes('"data-testid":"'+id+'"'),id);
  // a space too tight for clear views (a car): Fix cameras says so instead of showing the same list again in silence
  assert.ok(previs.includes('if(alive.current&&proposal.simple)setTightNote("This space is too tight for clearer views: the cameras now stand as clear of the set as it allows. The image can still be made from them. To change a view yourself, use Move a camera.");'));
  assert.ok(previs.includes('tightNote&&E("p",{className:"loc-layer-note",role:"status","data-testid":"camera-check-tight"},tightNote),'));
  assert.ok(previs.includes('setFixing(true);setFail("");setFixNote("");setTightNote("");'),"a new press starts clean");
  assert.ok(previs.includes('" cameras do not show the set clearly:"')&&previs.includes('"Fix cameras"')&&previs.includes("api.proposeCamerasAuto(now,list,{keep})"),
    "only the cameras named by the check move; the others are kept");
  assert.ok(previs.includes("()=>{if(live)setFaults({});}"),"a check that cannot run says nothing");
  assert.ok(build.includes("()=>{if(alive)setCheck({key:checkKey,faults:{}});}"));
  const at=n=>html.indexOf(n);
  assert.ok(at("app/blender-render.js")<at("app/camera-coverage.js")&&at("app/camera-coverage.js")<at("app/blender-render-ui.jsx")&&at("app/camera-coverage.js")<at("app/locations-ui.jsx"));
  for(const f of ["camera-coverage.js","blender-render.js","blender-render-ui.jsx","locations-ui.jsx","ai.jsx","script.jsx"])
    assert.ok(["20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2"].some(k=>html.includes('src="app/'+f+"?v="+k+'"')),f);
  assert.ok(ai.includes("'Suggest 4 cameras' (2026-11-11: fitted to the set as it will be built, the same way for every location)"));
  assert.ok(ai.includes("THE CAMERA CHECK (2026-11-11; in Previs since 2026-11-15): each saved camera's view of the set is checked"));
});

/* F  a space too tight for the checked fit (a car's cabin) still gets four cameras, on every road (2026-11-21: "make this
      work for any location"; the film's Minicab had none, so its set could not be drawn) */
function cabin(){
  const anchor=(id,name,xy,size,z)=>({id,name,space:"Cab",xy,z,size,facing:0,sizeBasis:"design",placement:"Saved test position",basis:"design"});
  const l={id:"cab",key:"cab",name:"Minicab",coverageViews:[],
    spatialPlan:{status:"reviewed",source:{assetId:"cab",iso:""},frame:"Bonnet is north",heights:"centre",
      anchors:[anchor("console","Centre console",[0,0],[.22,.7,.3],.15),anchor("driver","Driver seat",[.38,-.1],[.5,.7,1.05],.53),
        anchor("passenger","Front passenger seat",[-.38,-.1],[.5,.7,1.05],.53),anchor("bench","Three-seat rear bench",[0,-.95],[1.3,.6,.9],.45),
        anchor("dash","Dashboard",[0,.68],[1.4,.55,.4],.6),anchor("wheel","Steering wheel",[.38,.38],[.38,.12,.38],.75)],
      coordinates:{spaces:[{id:"cab",name:"Cab",floorZ:0,ceilingH:1.2,footprint:[[-.7,-1.15],[.7,-1.15],[.7,1.15],[-.7,1.15]],openings:[]}]}}};
  b.turnContinuity={locations:[l]};return l;
}
await test("F a car's cabin: the checked fit cannot stand a clear wide view, so the simpler placement answers on every road", async()=>{
  const l=cabin();
  // its stand-in cameras stand at eye height, above its roof: that is why the set could not be drawn
  assert.ok(Object.values(api.cameraProblems(l)).some(m=>/not between the floor and the ceiling/.test(m)));
  const p=await api.proposeCamerasAuto(l);
  assert.equal(p.panels.length,4); assert.equal(p.panels.map(x=>x.key).join(","),"TL,TR,BL,BR");
  assert.equal(p.simple,true,"this cabin is too tight for the checked fit"); assert.equal(p.auto,false); assert.match(p.warnings[0],/too tight for a checked, unobstructed fit/);
  // either way the proposal can be saved, every camera stands inside the cabin under its roof, and none has a problem
  const views=api.cameraProposalViews(l,p),next={...l,coverageViews:views};b.turnContinuity={locations:[next]};
  for(const row of b.locationPanelPoses(next,[next])){ assert.ok(row.pose.position[2]>0.2&&row.pose.position[2]<1.1,"under the roof: "+row.pose.position[2]); assert.ok(Math.abs(row.pose.position[0])<.7&&Math.abs(row.pose.position[1])<1.15); }
  assert.deepEqual(JSON.parse(JSON.stringify(api.cameraProblems(next))),{});
  // the whole-place road (after Confirm, Prepare this place, Previs) gets them too: it used to end in an error row
  b.turnContinuity={locations:[cabin()]};
  const rows=await api.proposeCamerasForPlace(b.turnContinuity.locations[0]);
  assert.equal(rows.length,1); assert.ok(!rows[0].error,"no error row: "+rows[0].error); assert.ok(Array.isArray(rows[0].views)&&rows[0].set.length===4);
  // and the set can then be built
  const done={...b.turnContinuity.locations[0],coverageViews:rows[0].views};b.turnContinuity={locations:[done]};
  assert.ok(api.buildScene(done).objects.length>6);
  // a room the checked fit can serve is still served by it (the simpler rule is only the way out)
  const big=await api.proposeCamerasAuto(location()); assert.equal(big.auto,true); assert.ok(!big.simple);
  const src=read("app/blender-render.js");
  assert.ok(src.includes("catch(first){return tight(first);}")&&src.includes("if(Object.keys(problems).length)return tight(Error("));
});

console.log(`\n${checks} checks passed${failed?`, ${failed} FAILED`:""}`);
process.exit(failed?1:0);

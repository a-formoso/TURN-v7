/* Cloud set preview (2026-11-01): a camera must stand inside its room, clear of walls and objects, between floor and
   ceiling, before a set is built; and a running render shows how long is left. No renderer, account or model call. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const box={console,crypto,TextEncoder,URL,location:{hostname:"localhost"},turnIsAdmin:true,
  nbGetMeta:()=>null,nbGetImage:()=>"",scenesInStoryOrder:x=>x||[]};box.window=box;
vm.createContext(box);
for(const file of ["locations.jsx","blender-render-contract.js","blender-set-detail.js","blender-render.js"])
  vm.runInContext(read("app/"+file),box);
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};

// A 4 x 3 m office (floor 4.4, ceiling 2.1) with a desk against the east wall.
function office(cameras){
  const l={id:"office",key:"office",name:"Ferry - Office",spatialPlan:{status:"reviewed",source:{assetId:"office",iso:""},frame:"Bow is north",heights:"centre",
    anchors:[{id:"desk",name:"Desk with lamp",space:"Ferry - Office",placement:"East wall",xy:[3.4,1.5],z:4.8,size:[1.2,0.7,0.8],facing:0,posBasis:"design",sizeBasis:"design"}],
    coordinates:{spaces:[{id:"office",name:"Ferry - Office",floorZ:4.4,ceilingH:2.1,footprint:[[0,0],[4,0],[4,3],[0,3]],openings:[]}],
      cameras:cameras.map((c,i)=>({spaceId:"office",panel:["TL","TR","BL","BR"][i],yaw:90,pitch:0,lensMm:24,...c}))}}};
  box.turnContinuity={locations:[l]};return l;
}
const good=[{position:[0.6,1.5,6]},{position:[0.5,0.5,6.2]},{position:[1,2.5,6]},{position:[2.5,0.6,6]}];
const issues=cams=>box.KinolotCloudRender.inputIssues(office(cams));
check(issues(good).length===0,"Four cameras inside the room, clear of walls and objects, pass");
{
  const found=issues([{position:[5,1.5,6]},good[1],good[2],good[3]]);
  check(found.some(i=>/Top-left camera: it stands outside Ferry - Office/.test(i)),"A camera outside its room is flagged");
}
check(issues([{position:[0.1,1.5,6]},good[1],good[2],good[3]]).some(i=>/within 25 cm of a wall/.test(i)),"A camera inside the wall (10 cm from its line) is flagged");
check(issues([{position:[0.6,1.5,4.5]},good[1],good[2],good[3]]).some(i=>/between the floor and the ceiling/.test(i)),"A camera at floor level is flagged");
check(issues([{position:[0.6,1.5,6.45]},good[1],good[2],good[3]]).some(i=>/between the floor and the ceiling/.test(i)),"A camera in the ceiling is flagged");
check(issues([{position:[3.4,1.5,4.8]},good[1],good[2],good[3]]).some(i=>/stands inside Desk with lamp/.test(i)),"A camera inside an object is flagged");
check(issues([{position:[3.4,1.5,6]},good[1],good[2],good[3]]).length===0,"A camera above an object (not inside it) passes");
{
  const l=office([{position:[5,1.5,6]},good[1],good[2],good[3]]);
  assert.throws(()=>box.KinolotCloudRender.buildScene(l),/stands outside/);checks++;
  const tagged=box.KinolotCloudRender.inputIssueList(l);
  check(tagged.length===1&&tagged[0].step===3&&tagged[0].panel==="TL","A camera problem is tagged for step 3 · Cameras, with its panel");
  const per=box.KinolotCloudRender.cameraProblems(l);
  check(Object.keys(per).join()==="TL"&&/^It stands outside Ferry - Office/.test(per.TL),"Each camera's own problem is available for its row in step 3");
  const noFloor={...l,spatialPlan:{...l.spatialPlan,status:"draft"}};box.turnContinuity={locations:[noFloor]};
  check(box.KinolotCloudRender.inputIssueList(noFloor).every(i=>i.step===2),"An unconfirmed floor plan is a step 2 · Floor plan issue");
}

// Render time estimate: the worker's measured runs, or this location's own last render.
const est=box.KinolotCloudRender.estimateSeconds;
check(Math.abs(est(58)-78)<=2&&Math.abs(est(236)-244)<=2,"The estimate matches the measured 58-shape (78 s) and 236-shape (244 s) renders");
check(est(236,180)===180,"A location's last render time is preferred");
check(est(0)===60,"Never less than a minute");

// The progress display, with the real component function and a stand-in React.
box.React={useState:v=>[v,()=>{}],useEffect(){},useRef:v=>({current:v}),
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)})};
vm.runInContext(read("app/blender-render-ui.jsx"),box);
const t0=Date.parse("2026-11-01T10:00:00Z"),api=box.KinolotCloudRender;
const text=n=>JSON.stringify(n).match(/"(Rendering[^"]*|Taking[^"]*|Waiting[^"]*|Saving[^"]*)"/)[1];
const bar=n=>{const find=x=>x&&typeof x==="object"?(x.props&&x.props.role==="progressbar"?x:(x.children||[]).map(find).find(Boolean)):null;return find(n).props["aria-valuenow"];};
const job=(status,extra={})=>({id:"j1",status,progress:status==="running"?"rendering":status,createdAt:new Date(t0).toISOString(),attempts:1,...extra});
{
  const started={};
  let n=box.renderProgress(job("queued"),{now:t0+20000,started,objects:236,lastSeconds:0,api});
  check(/^Waiting for the renderer/.test(text(n))&&/0:20 so far/.test(text(n))&&/about 4 min/.test(text(n)),"Queued: says it waits for the one renderer, how long so far and how long rendering will take");
  n=box.renderProgress(job("running"),{now:t0+30000,started,objects:236,lastSeconds:0,api});
  check(text(n).startsWith("Rendering · 0:00 of about 4:04"),"Render time counts from when the job left the queue");
  n=box.renderProgress(job("running"),{now:t0+90000,started,objects:236,lastSeconds:0,api});
  check(text(n).startsWith("Rendering · 1:00 of about 4:04")&&bar(n)===25,"One minute in: the time, the estimate and a quarter of the bar");
  n=box.renderProgress(job("running"),{now:t0+600000,started,objects:236,lastSeconds:0,api});
  check(/^Taking longer than usual · 9:30 so far/.test(text(n))&&bar(n)===95,"Past the estimate: says so, and the bar stops short of full");
  n=box.renderProgress(job("running",{progress:"uploading"}),{now:t0+250000,started,objects:236,lastSeconds:0,api});
  check(/^Saving the four camera views/.test(text(n))&&bar(n)===96,"Saving: almost done, still not 100%");
}
{
  const n=box.renderProgress(job("running"),{now:t0+120000,started:{},objects:236,lastSeconds:0,api});
  check(text(n).startsWith("Rendering · 2:00 of about 4:04")&&bar(n)===49,"A job found already running (a reload) counts from its request");
}
const ui=read("app/blender-render-ui.jsx");
check(/running&&renderProgress\(/.test(ui)&&/job&&!running&&job\.status!=="completed"&&E\("p",\{role:"status"/.test(ui),"The panel shows the progress while queued or running, and a failure or cancellation otherwise");
check(ui.includes("(blockedViews?otherIssues:issues).length>0&&cloudFixList(location,blockedViews?otherIssues:issues)")&&/"Go to "\+issue\.step\+" · "\+LOCATION_STEP_NAMES\[issue\.step\]/.test(ui),"What stops the build is listed, each with a Go to step button");
check(!/layout issues above/.test(ui),"No more 'the layout issues above'");
console.log(`PASS cloud render cameras and progress: ${checks} camera-placement, estimate and progress checks`);

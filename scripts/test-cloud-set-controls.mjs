/* Offline UI regression: unfinished/parent cards keep cloud steps discoverable;
   connection recovery is read-only and works for read-only film members. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {parseSync,transformSync} from "@babel/core";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const compiled=process.env.CLOUD_SET_TEST_DIST==="1";
const runtime=p=>read(compiled?"dist/"+p.replace(/\.jsx$/,".js"):p);
const source=read("app/locations-ui.jsx");
for(const [hostname,setBuild,admin,expected] of [
  ["kinolot.infinitestudioai.com",true,false,true],
  ["kinolot.infinitestudioai.com",false,true,false],
  ["localhost",false,true,true],
  ["localhost",false,false,false],
]){
  const b={location:{hostname},TURN_SUPABASE:{setBuild},turnIsAdmin:admin};b.window=b;vm.createContext(b);
  vm.runInContext(runtime("app/blender-render.js"),b);
  assert.equal(b.KinolotCloudRender.enabled(),expected,"public switch works independently of admin/localhost pilot");
}
const noop=()=>{};
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop};
const box={React,console,Icon:{chevR:"icon"},window:null,events:[],goToLocationStep:(l,n)=>box.events.push([l.id,n])};
box.window=box;vm.createContext(box);
for(const [name,text] of [["locations-ui.jsx",runtime("app/locations-ui.jsx")],["blender-render-ui.jsx",runtime("app/blender-render-ui.jsx")]]){
  vm.runInContext(transformSync(text,{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],
    babelrc:false,configFile:false,filename:name}).code,box);
}
const nodes=tree=>{const out=[];const walk=n=>{if(n&&typeof n==="object"){out.push(n);(n.children||[]).forEach(walk);}};walk(tree);return out;};
const text=n=>typeof n==="string"?n:(n?.children||[]).map(text).join("");
const button=(tree,label)=>nodes(tree).find(n=>n.type==="button"&&text(n)===label);
const location={id:"parent",name:"Ferry"},room={id:"deck",name:"Car deck"};
box.goToLocationStep=(l,n)=>box.events.push([l.id,n]);
const setup=box.LocationCloudBuildSetup({location,rooms:[room],onSelectLocation:(id,section)=>box.events.push([id,section])});
assert.match(text(setup),/Choose a room/);
const links=nodes(setup).find(n=>n.type===box.LocationRoomLinks);
const rooms=box.LocationRoomLinks(links.props);
nodes(rooms).find(n=>n.type==="button").props.onClick();
assert.deepEqual(box.events.pop(),["deck","build"],"room navigation opens the build fold");
button(setup,"Go to 2 · Floor plan").props.onClick();
assert.deepEqual(box.events.pop(),["parent",2]);
assert.match(text(box.LocationCloudBuildSetup({location,rooms:[],onSelectLocation:noop})),/Add this location's footprint/);

const ast=parseSync(source,{sourceType:"script",babelrc:false,configFile:false});
const sheet=ast.program.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="LocationSheet");
const walk=n=>{if(!n||typeof n!=="object")return [];return [n,...Object.values(n).flatMap(v=>Array.isArray(v)?v.flatMap(walk):typeof v==="object"?walk(v):[])];};
const descendants=walk(sheet.body);
const flag=descendants.find(n=>n.type==="VariableDeclarator"&&n.id.name==="cloudPilot");
assert.ok(flag);assert.doesNotMatch(source.slice(flag.init.start,flag.init.end),/ownRoom/,
  "missing footprint cannot hide both cloud steps");
const folds=descendants.filter(n=>n.type==="CallExpression"&&n.arguments?.[0]?.name==="CardFold");
for(const [number,name] of [[4,"Build the set"],[5,"Style it"]]){
  const fold=folds.find(n=>n.arguments[1]?.properties?.some(p=>p.key.name==="label"&&p.value.value===number+" · "+name));
  assert.ok(fold);assert.ok(fold.arguments[1].properties.some(p=>p.key.name==="defaultOpen"));
  assert.equal(fold.arguments[2].type,"ConditionalExpression","each step has a room/setup branch");
  const selected=fold.arguments[2];box.ownRoom=false;box.l=location;box.roomLocations=[room];box.onSelectLocation=noop;
  const content=vm.runInContext(source.slice(selected.start,selected.end),box);
  if(number===4)assert.equal(content.type,box.LocationCloudBuildSetup);
  else assert.match(text(content),/Choose a room and build/);
}

let refreshes=0,requests=0;
const state={api:{},show:true,scope:{},scene:{objects:[]},issues:[],scopeKey:"test",sceneKey:"scene",
  current:{current:{scopeKey:"test",sceneKey:"scene"}},job:null,busy:false,sceneHash:"hash",stale:false,
  caps:{open:true,canBuild:true,credits:15},capable:false,message:"Renderer unavailable",refresh:()=>refreshes++,
  setBusy:noop,setMessage:noop,setJob:noop};
state.api.request=()=>{requests++;throw Error("A status click must not submit a paid request");};
state.api.estimateSeconds=()=>60;
box.useCloudSetJob=()=>state;
for(const readOnly of [false,true]){
  const tree=box.LocationCloudRender({location,readOnly});
  assert.equal(button(tree,"Retry renderer connection").props.disabled,false);
  assert.equal(nodes(tree).find(n=>n.type==="button"&&text(n).startsWith("Build set")).props.disabled,true,
    "unavailable connection cannot build");
  button(tree,"Retry renderer connection").props.onClick();
  const style=box.LocationStyleStep({location,readOnly});
  button(style,"Retry renderer connection").props.onClick();
}
assert.equal(refreshes,4);assert.equal(requests,0);
state.message="";
for(const capable of [false,true]){
  state.capable=capable;const initial=box.LocationCloudRender({location});
  assert.equal(button(initial,"Refresh render status"),undefined,"No render-status action appears before a job exists");
  assert.equal(button(initial,"Retry renderer connection"),undefined,"Normal loading and readiness need no recovery action");
  assert.equal(button(initial,"Check render request"),undefined);
}
state.message="The request could not be confirmed";
button(box.LocationCloudRender({location}),"Check render request").props.onClick();
assert.equal(refreshes,5);assert.equal(requests,0,"An uncertain request can be checked without submitting another build");
state.message="";
state.scene.notes=["Simplified solid blocks: Bench. These show object bounds, not confirmed shapes."];
const represented=box.LocationCloudRender({location});
const shapeNote=nodes(represented).find(n=>n.props['data-testid']==='set-shape-review');
assert.equal(shapeNote,undefined,"Generic blocks do not add an extra pre-build review step");
assert.equal(button(represented,"Review object shapes"),undefined,"Approximate shapes do not appear as a new repair requirement");
assert.equal(button(represented,"Edit object shapes"),undefined,"The edit shortcut waits for rendered results");
state.scene.notes=[];
for(const status of ["queued","running","completed","failed","cancelled"]){
  state.job={id:"test",status};
  assert.ok(button(box.LocationCloudRender({location}),"Refresh render status"),"Existing "+status+" jobs retain status refresh");
  assert.equal(button(box.LocationCloudRender({location}),"Edit object shapes"),undefined,"Shape editing is not prompted until rendered results exist");
}
state.job=null;
state.busy=true;
assert.equal(button(box.LocationCloudRender({location}),"Refresh render status").props.disabled,true);
state.busy=false;state.capable=true;state.job={id:"old",status:"completed",sceneHash:"older"};state.stale=true;
state.job.result={images:{},report:{wallSeconds:60,cameras:Object.fromEntries(["TL","TR","BL","BR"].map(k=>[k,{direction:[0,1,0]}]))}};
const completed=box.LocationCloudRender({location});
button(completed,"Edit object shapes").props.onClick();assert.deepEqual(box.events.pop(),[location.id,2],"Completed results offer an optional path back to shape editing before rebuilding");
box.LocationSetStyle="saved-style-panel";
const archived=nodes(box.LocationStyleStep({location})).find(n=>n.type==="saved-style-panel");
assert.ok(archived,"saved comparisons stay mounted while a rebuild is required");
assert.equal(archived.props.sceneHash,"","an outdated build cannot enable new styling or acceptance");
console.log("PASS cloud set controls: parent/unfinished-room discovery, room routing, both fold prerequisites, and read-only connection recovery");

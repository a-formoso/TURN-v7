/* FROM A LOCATION'S CAMERA TO A SHOT (owner 2026-11-24, the Previs look brief, step 5).
   "On a location card, I move the camera until I like the view. I press Use this angle in a shot. I pick where it
   goes: the scene, then the beat, then the shot inside that beat. That shot now holds my angle."
   What must stay true:
     - the picker lists the scenes that play in this place (the place and its rooms are one set), then that scene's
       beats, then that beat's shots; the last choice is always a shot the scene plan knows;
     - on confirm the angle is written into the plan's camera list under ScenePlan.shotCameraKey(shot): where it
       stands, its height, its lens, the direction it looks, a mark that it was set by hand, the location and the
       angle name it came from, and the camera the plan had before;
     - the angle is saved on the location under a name;
     - a camera set by hand is never moved (test-shot-previs 19); "Place the cameras", "Place again" and a plan
       written again leave it alone;
     - the shot card's Previs says "Camera: your angle from <location>" and offers "Return to the planned camera";
     - after confirm the Shots tab opens on that shot with its Previs open;
     - no shot, frame or approval changes, and nothing is charged. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const box={console};box.window=box;vm.createContext(box);
for(const f of ["app/scene-plan.js","app/shot-angle.js"])vm.runInContext(read(f),box,{filename:f});
const SP=box.ScenePlan,A=box.KinolotShotAngle,plain=v=>JSON.parse(JSON.stringify(v));
const tool=read("app/camera-angle-preview-ui.jsx"),app=read("app/app.jsx"),shotsUi=read("app/shots-ui.jsx"),previsUi=read("app/shot-previs-ui.jsx"),html=read("TURN.html"),ai=read("app/ai.jsx"),css=read("app/styles.css");
let pass=0,fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };
const POSE={position:[1.234567,2.5,1.75],yaw:-90,pitch:-12.346,lensMm:27.6};
const FROM={locationId:"loc-flat",locationName:"Hussain Flat",angleId:"angle-1",angleName:"From the kitchen door"};
const PLANNED={at:[2,3],height:1.5,aim:["liaqat"],lens:35,faces:{liaqat:"pike"},why:"Over the shelf."};

test("1 an angle as the plan keeps it: where, how high, the lens, the direction, set by hand, where it came from", ()=>{
  const c=SP.handCamera(POSE,{floorZ:0.15,from:FROM,planned:PLANNED,at:"2026-11-24T10:00:00.000Z"});
  assert.deepEqual(plain(c),{at:[1.23,2.5],height:1.6,aim:[],lens:28,faces:{liaqat:"pike"},why:"Set by hand.",hand:true,
    pose:{position:[1.235,2.5,1.75],yaw:270,pitch:-12.35,lensMm:28},from:FROM,setAt:"2026-11-24T10:00:00.000Z",planned:PLANNED});
  assert.equal(SP.isHandCamera(c),true); assert.equal(SP.isHandCamera(PLANNED),false); assert.equal(SP.isHandCamera({hand:true}),false,"no pose is no angle");
  // who faces whom is the plan's: an angle moves the camera, not the people
  assert.deepEqual(plain(SP.handCamera(POSE,{from:FROM}).faces),{}); assert.ok(!("planned" in SP.handCamera(POSE,{from:FROM})),"a shot that had no camera has none to return to");
  // numbers that are not numbers, or a place far off any set: no camera
  for(const bad of [null,{},{position:[1,2],yaw:0,pitch:0,lensMm:35},{position:[1,2,"x"],yaw:0,pitch:0,lensMm:35},{position:[1,2,3],yaw:NaN,pitch:0,lensMm:35},{position:[9000,2,3],yaw:0,pitch:0,lensMm:35}])
    assert.equal(SP.handCamera(bad,{from:FROM}),null);
  // kept inside what a camera can be
  const edge=SP.handCamera({position:[0,0,9],yaw:725,pitch:120,lensMm:900},{floorZ:0,from:{locationName:"x".repeat(300)}});
  assert.deepEqual(plain([edge.height,edge.lens,edge.pose.yaw,edge.pose.pitch,edge.pose.lensMm,edge.from.locationName.length]),[4,200,5,89,200,120]);
  // an angle put over an angle returns to the PLAN's camera, never to the first angle
  const second=SP.handCamera({...POSE,yaw:10},{from:FROM,planned:c});
  assert.deepEqual(plain(second.planned),PLANNED); assert.deepEqual(plain(second.faces),{liaqat:"pike"});
});

test("2 into the plan's camera list under the shot's own key, and back to the planned camera", ()=>{
  const shot={beatN:2,moment:{n:3,of:4}}, key=SP.shotCameraKey(shot);
  assert.equal(key,"2.3");
  const plan={marks:[{id:"m"}],cameras:{"2.3":PLANNED,"1.1":{at:[0,0]}},camerasBy:{label:"x"}};
  const kept=JSON.stringify(plan), c=SP.handCamera(POSE,{from:FROM,planned:plan.cameras[key]});
  const next=SP.setHandCamera(plan,key,c);
  assert.equal(JSON.stringify(plan),kept,"the plan given is not edited");
  assert.equal(next.cameras["2.3"].hand,true); assert.deepEqual(plain(next.cameras["1.1"]),{at:[0,0]}); assert.equal(next.camerasBy.label,"x");
  assert.equal(SP.handCameraCount(next),1); assert.equal(SP.handCameraCount(plan),0); assert.equal(SP.handCameraCount(null),0);
  assert.equal(SP.setHandCamera(plan,key,PLANNED),plan,"only an angle is written this way"); assert.equal(SP.setHandCamera(plan,"",c),plan);
  const back=SP.returnPlannedCamera(next,key);
  assert.deepEqual(plain(back.cameras),plain(plan.cameras),"exactly the cameras the plan had");
  assert.equal(SP.returnPlannedCamera(plan,key),plan,"a planned camera has nothing to return to");
  // a shot that had no camera: returning leaves it to the app again
  const bare=SP.setHandCamera({marks:[{id:"m"}]},"1.1",SP.handCamera(POSE,{from:FROM}));
  assert.deepEqual(plain(SP.returnPlannedCamera(bare,"1.1").cameras),{});
});

test("3 cameras placed again, or a plan written again: an angle set by hand stays", ()=>{
  const mine=SP.handCamera(POSE,{from:FROM,planned:PLANNED});
  const old={"1.1":{at:[0,0],why:"old"},"2.3":mine,"9.9":SP.handCamera(POSE,{from:FROM})};
  const fresh={"1.1":{at:[1,1],why:"new"},"2.3":{at:[5,5],why:"new for 2.3"},"3.1":{at:[2,2]}};
  const merged=SP.keepHandCameras(old,fresh,["1.1","2.3","3.1"]);
  assert.deepEqual(plain(merged["1.1"]),{at:[1,1],why:"new"},"a planned camera is replaced as before");
  assert.equal(merged["2.3"].hand,true); assert.deepEqual(plain(merged["2.3"].pose),plain(mine.pose),"the angle itself is untouched");
  assert.deepEqual(plain(merged["2.3"].planned),{at:[5,5],why:"new for 2.3"},"the camera just placed is what it would return to");
  assert.ok(!("9.9" in merged),"the angle of a shot the scene no longer has goes with it"); assert.deepEqual(plain(merged["3.1"]),{at:[2,2]});
  // a plan written again starts with no cameras: the angles of the shots it still has are carried over
  assert.deepEqual(Object.keys(SP.keepHandCameras(old,{},["2.3"])),["2.3"]); assert.deepEqual(plain(SP.keepHandCameras(old,{},[])),{});
  assert.deepEqual(Object.keys(SP.keepHandCameras(old,{})).sort(),["2.3","9.9"],"with no list of shots, all are kept");
  assert.deepEqual(plain(SP.keepHandCameras(null,fresh)),fresh); assert.deepEqual(plain(SP.keepHandCameras(old,null,["1.1"])),{});
  // the question before placing again says so
  assert.match(SP.camerasConfirmText({sceneNo:5,again:true,hand:1}).body,/It replaces the cameras this scene has now, except the one angle you set yourself: it stays as it is\.$/);
  assert.match(SP.camerasConfirmText({sceneNo:5,again:true,hand:3}).body,/except the 3 angles you set yourself: they stay as they are\.$/);
  assert.match(SP.camerasConfirmText({sceneNo:5,again:true}).body,/It replaces the cameras this scene has now\.$/);
});

test("4 the picker: the scenes that play in this place, then the beats, then the shots the plan knows", ()=>{
  const plan={marks:[{id:"m"}],sets:[{id:"set-hall",locationId:"loc-hall"}],cameras:{"1.2":SP.handCamera(POSE,{from:FROM})}};
  const state={people:{}};
  const key=(id,sceneId,beatN,n,of,more)=>({id,sceneId,beatN,order:beatN+n/100,keyframeMode:n===1?"beat-opening":"moment",moment:{n,of},planned:true,startState:state,endState:state,size:"MS",action:"Does a thing",locationId:"loc-flat",...(more||{})});
  const ctx={locations:[{id:"loc-flat",name:"Hussain Flat"},{id:"loc-hall",name:"Hall"},{id:"loc-street",name:"Street"}],
    scenes:[{id:"s1",no:4,title:"The Driver's Name"},{id:"s2",no:5,title:"Shoes On"},{id:"s3",no:6,title:"Unplanned Here"},{id:"s4",no:7,title:"Elsewhere"}],
    plans:{s2:plan,s4:{marks:[{id:"m"}]}},
    shots:[key("a","s2",1,1,3),key("b","s2",1,2,3,{size:"CU",action:"He ties the lace, slowly, watching the door the whole time, and then some more words that run on"}),key("c","s2",1,3,3,{locationId:"loc-street"}),
      key("d","s2",2,1,1,{planSet:"set-hall",locationId:"loc-street"}),{id:"e","sceneId":"s2",beatN:2,order:2.5,locationId:"loc-flat",size:"MS"},
      key("f","s3",1,1,1),key("g","s4",1,1,1,{locationId:"loc-street"}),key("h","s1",1,1,1,{locationId:"loc-street"})]};
  // the place and its rooms are one set
  box.KinolotSetDressing={place:()=>({owner:{id:"loc-flat"},family:[{id:"loc-flat"},{id:"loc-hall"}]})};
  assert.deepEqual(plain(A.family(ctx.locations[0],ctx.locations)),["loc-flat","loc-hall"]);
  const got=plain(A.targets(ctx.locations[0],ctx));
  assert.deepEqual(got.map(s=>[s.no,s.planned,s.beats.length,s.waiting]),[[5,true,2,1],[6,false,0,1]],"only scenes with a shot in this place; one not planned yet is listed and cannot be chosen");
  const s2=got[0];
  assert.deepEqual(s2.beats.map(b=>[b.n,b.shots.map(x=>x.id)]),[[1,["a","b"]],[2,["d"]]],"a shot in another place is not offered; a room of this place is; a shot the plan does not know is not");
  assert.deepEqual(s2.beats[0].shots.map(x=>[x.key,x.hand]),[["1.1",false],["1.2",true]],"each shot's own place in the camera list, and whether it already has an angle");
  assert.equal(s2.beats[0].shots[0].label,"Moment 1 of 3 · medium shot · Does a thing");
  assert.equal(s2.beats[1].shots[0].label,"The beat’s shot · medium shot · Does a thing");
  assert.ok(s2.beats[0].shots[1].label.startsWith("Moment 2 of 3 · close-up · He ties the lace")&&s2.beats[0].shots[1].label.length<=110,"what happens, kept short");
  assert.equal(s2.title,"Shoes On");
  // every shot size the plan knows has its words
  for(const size of SP.SIZES){ const one=plain(A.targets(ctx.locations[0],{...ctx,shots:[key("z","s2",1,1,1,{size})]}))[0].beats[0].shots[0].label; assert.ok(!one.includes(" "+size+" "),size+" is said in words: "+one); }
  // seen from the street, another list
  box.KinolotSetDressing={place:()=>({owner:{id:"loc-street"},family:[{id:"loc-street"}]})};
  assert.deepEqual(plain(A.targets(ctx.locations[2],ctx)).map(s=>s.no),[4,5,7]);
  // nothing loaded, nothing listed; never a throw
  delete box.KinolotSetDressing; assert.deepEqual(plain(A.family({id:"x"},[])),["x"]); assert.deepEqual(plain(A.targets({id:"nowhere"},ctx)),[]); assert.deepEqual(plain(A.targets(null,null)),[]);
  assert.equal(A.angleName({no:5},2),"Angle for Scene 05, beat 2");
  // the floor a camera stands on, for its height: the smallest space it is in
  box.locationSpatialContract=()=>({coordinates:{spaces:[{id:"house",footprint:[[0,0],[10,0],[10,10],[0,10]],floorZ:0},{id:"hall",footprint:[[1,1],[3,1],[3,3],[1,3]],floorZ:0.15}]}});
  assert.equal(A.floorAt({},[],2,2),0.15); assert.equal(A.floorAt({},[],8,8),0); assert.equal(A.floorAt({},[],50,50),0);
  box.locationSpatialContract=()=>{ throw new Error("no plan"); }; assert.equal(A.floorAt({},[],2,2),0);
});

test("5 the camera tool: the button, three choices that end in a shot, a name, and the angle saved on the location", ()=>{
  assert.ok(tool.includes('data-testid="angle-use-open"')&&tool.includes(">Use this angle in a shot</button>"),"the button the brief names");
  for(const id of ["angle-use-scene","angle-use-beat","angle-use-shot","angle-use-name","angle-use-confirm"]) assert.ok(tool.includes('data-testid="'+id+'"'),id);
  assert.ok(tool.indexOf('data-testid="angle-use-scene"')<tool.indexOf('data-testid="angle-use-beat"')&&tool.indexOf('data-testid="angle-use-beat"')<tool.indexOf('data-testid="angle-use-shot"'),"scene, then beat, then shot");
  assert.ok(tool.includes("<span>1 · Scene</span>")&&tool.includes("<span>2 · Beat</span>")&&tool.includes("<span>3 · Shot</span>"));
  assert.ok(tool.includes("disabled={readOnly||!ready||!!problem||!use.shotId}"),"it cannot be confirmed without a shot, on a read-only film, or from a camera that cannot stand there");
  assert.ok(tool.includes("disabled={!s.planned||!s.beats.length}"),"a scene that is not planned cannot be chosen");
  // on confirm: the same guard as every save, the angle kept on the location under its name, then handed to the app
  const fn=tool.slice(tool.indexOf("function useInShot(){"),tool.indexOf("function assign(){"));
  assert.ok(fn.includes("const location=guard()")&&fn.indexOf("guard()")<fn.indexOf("keepAngle("),"the camera is checked before anything is saved");
  assert.ok(fn.includes("const angleId=keepAngle(location,title);")&&fn.includes("A.angleName(scene,beat.n)"),"saved under a name, one offered when none is typed");
  assert.ok(fn.includes("window.turnUseAngleInShot({sceneId:scene.id,shotId:shot.id,pose:{position:[...pose.position],yaw:pose.yaw,pitch:pose.pitch,lensMm:pose.lensMm},"));
  assert.ok(fn.includes("from:{locationId:location.id,locationName:location.name||\"\",angleId,angleName:title}")&&fn.includes("floorZ:A.floorAt(location,list(),pose.position[0],pose.position[1])"));
  assert.ok(fn.includes("if(!done||!done.ok)throw Error(")&&fn.includes("setUse(null);setOpen(false);"),"a refusal is shown; on success the tool closes");
  // one way of keeping an extra camera, used by both
  const keep=tool.slice(tool.indexOf("function keepAngle(location,title){"),tool.indexOf("function shotTargets(){"));
  assert.ok(keep.includes('pose:{...pose,position:[...pose.position],basis:"user"}')&&keep.includes("onUpdate(location.id,{coverageViews:existing?views.map(v=>v.id===id?view:v):views.concat(view)});"));
  assert.ok(tool.includes("const id=keepAngle(location,title);")&&(tool.match(/keepAngle\(/g)||[]).length===3);
  assert.ok(tool.includes("A.targets(current()||l,{locations:list(),scenes:C.scenes||[],shots:C.shots||[],plans:(window.turnProject||{}).scenePlans||{}})"));
  assert.ok(css.includes(".loc-angle-use-pick{")&&css.includes(".shot-previs-hand{"));
});

test("6 the app: the angle goes into the plan and nowhere else; the Shots tab opens on the shot with its Previs open", ()=>{
  const fn=app.slice(app.indexOf("const useAngleInShot = (o)=>{"),app.indexOf("window.turnUseAngleInShot = useAngleInShot;"));
  assert.ok(fn.length>400);
  assert.ok(fn.includes("if(!canDesignShots()) return { ok:false,")&&fn.includes("if(!sh || !plan || !SP.exact(plan) || !sh.planned) return { ok:false,"),"read-only, or a shot the plan no longer has: refused, in words");
  assert.ok(fn.includes("const key = SP.shotCameraKey(sh);")&&fn.includes("SP.handCamera(o.pose, { floorZ:o.floorZ, from:o.from, planned:(plan.cameras||{})[key] })"));
  assert.ok(fn.includes("[o.sceneId]:SP.setHandCamera(cur, key, cam)"));
  assert.ok(!/setShots\(|claude\.complete|proxyGenerate|turn_spend|holdCredits/.test(fn),"no shot is changed, no engine is called, nothing is charged");
  assert.ok(fn.includes('window.turnFocusArtScene("shots", o.sceneId, "shot:"+sh.id);')&&fn.includes('setArtView("shots");'));
  const back=app.slice(app.indexOf("const returnPlannedCamera = (sceneId, key)=>{"),app.indexOf("window.turnUseAngleInShot = useAngleInShot;"));
  assert.ok(back.includes("[sceneId]:SP.returnPlannedCamera(cur, key)")&&back.includes("!canDesignShots()")&&app.includes("window.turnReturnPlannedCamera = returnPlannedCamera;"));
  // "Place the cameras", "Place again", and a plan written again
  assert.ok(app.includes("cameras:SP.keepHandCameras(cur.cameras, res.cameras, keysNow)")&&app.includes("hand:SP.handCameraCount(plan) });"));
  assert.ok(app.includes("const mine = SP.keepHandCameras(old && old.cameras, {}, sceneNow.map(sh=>SP.shotCameraKey(sh)));"));
  // the Shots tab: the hand-off names the shot; its card is brought into view and its Previs opened
  assert.ok(shotsUi.includes('if(String(f.action||"").indexOf("shot:")===0){')&&shotsUi.includes('window.dispatchEvent(new CustomEvent("nb-open-fold",{ detail:"shot-previs-"+shotId }));')&&shotsUi.includes("if(++tries<24) setTimeout(go, 250);"));
  assert.ok(previsUi.includes('foldId:"shot-previs-"+sh.id'),"the Previs section answers to that name");
  assert.ok(shotsUi.includes('handCount ? handCount+" your own angle"+(handCount!==1?"s":"")+" from a location\\u2019s camera" : ""'),"the Scene plan's Cameras row counts them");
});

test("7 the shot card: Camera: your angle from the location, and Return to the planned camera", ()=>{
  assert.ok(previsUi.includes('"Camera: your angle from "+(String(from.locationName||"").trim()||"a location")'));
  assert.ok(previsUi.includes('"data-testid":"shot-previs-return"')&&previsUi.includes('},"Return to the planned camera"));'));
  assert.ok(previsUi.includes("onClick:()=>window.turnReturnPlannedCamera(sh.sceneId, window.ScenePlan.shotCameraKey(sh))"));
  assert.ok(previsUi.includes('const hand = res.source==="hand";')&&previsUi.includes('(cam && cam.hand) ? "your angle" : cam ? "camera placed" : "camera by the app"'));
  assert.ok(previsUi.indexOf("handLine,")<previsUi.indexOf('"data-testid":"shot-previs-camera"},line)'),"above the line that says where the camera stands");
  assert.ok(previsUi.includes('notes.map((t,i)=>SPV_E("p",{key:i,className:"shot-previs-note"},t))'),"the checks' notes are shown as for any camera");
  // the drawing is made from whatever camera the plan holds for the shot, so an angle redraws it
  assert.ok(previsUi.includes("return cams[SP.shotCameraKey(sh)] || null;")&&/JSON\.stringify\(\[sh\.id, sh\.startState\|\|null, sh\.endState\|\|null, sh\.size, sh\.angle, sh\.lens, sh\.subjects\|\|\[\], sh\.planThings\|\|\[\], cam,/.test(previsUi));
});

test("8 loaded in order, with fresh keys; Frances knows; no vendor, codename or billing word", ()=>{
  const i=s=>html.indexOf(s);
  assert.ok(i("app/scene-plan.js?v=")<i("app/shot-angle.js?v=")&&i("app/shot-angle.js?v=")<i("app/camera-angle-preview-ui.jsx?v="),"the plan, then the picker's list, then the camera tool");
  for(const f of ["app/shot-angle.js","app/scene-plan.js","app/shot-previs.js","app/camera-angle-preview-ui.jsx","app/shots-ui.jsx","app/shot-previs-ui.jsx","app/app.jsx","app/styles.css","app/ai.jsx"])
    assert.ok(["20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
  const g={APP_FEATURES:[]}; vm.runInNewContext(ai.split("\n").filter(l=>l.startsWith('APP_FEATURES.push({ name:"Locations: use a camera angle in a shot"')).join("\n"),g);
  assert.equal(g.APP_FEATURES.length,1);
  const fact=g.APP_FEATURES[0].what;
  for(const t of ["Use this angle in a shot","the scene (only scenes that play in this place are listed), then the beat, then the shot","The last choice is always a shot","saved on the location under its name",
    "Camera: your angle from","Return to the planned camera","A CAMERA SET BY HAND IS NEVER MOVED","Place the cameras and Plan again leave these angles alone","a planned scene","NOT AVAILABLE: adding a new shot to a beat"]) assert.ok(fact.includes(t),t);
  assert.ok(!/credit|\$|claude|anthropic|fable|opus|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(fact));
  const words=[tool.slice(tool.indexOf('data-testid="angle-use"')),previsUi.slice(previsUi.indexOf("YOUR ANGLE"),previsUi.indexOf("handLine,"))].join(" ");
  assert.ok(!/claude|anthropic|\bTURN\b|\bMUSE\b|credit/i.test(words));
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

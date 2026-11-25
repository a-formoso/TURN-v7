/* THE SHOTS TAB, BEAT FIRST (owner 2026-11-24, their design "Shots tab: a beat and its open shot").
   What must stay true:
     - each beat has a card of its own: its number, its name, the place, how many shots and seconds, four counts, a
       small picture of every shot with its number, what it is and its state, and four actions;
     - ONE shot is open under its beat; every other shot's card stays in the page, hidden, so a run of frames still
       finds each card's own generator;
     - the open shot is a picture with four views, its name and camera words, five steps (What happens, Camera,
       Previs, Frame, Approve) and Advanced; nothing the card had is gone, only moved;
     - the beat's end frame and the frame's own picture are never inside a part that can unmount them;
     - "Send this beat to the Stage" only goes there; "Make frames in order" asks first, with the price;
     - no price, shot, frame or approval changes by laying the tab out this way. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const logic=read("app/shot-beat-card.js"),face=read("app/shot-beat-card-ui.jsx"),ui=read("app/shots-ui.jsx"),previsUi=read("app/shot-previs-ui.jsx"),
  stage=read("app/stage.jsx"),app=read("app/app.jsx"),html=read("TURN.html"),css=read("app/styles.css"),ai=read("app/ai.jsx");
const box={console};box.window=box;vm.createContext(box);vm.runInContext(logic,box,{filename:"shot-beat-card.js"});
const K=box.KinolotBeatCard,plain=v=>JSON.parse(JSON.stringify(v));
let pass=0,fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };
const shot=(beatN,n,of,more)=>({id:"s"+beatN+"-"+n,beatN,keyframeMode:n===1?"beat-opening":"moment",moment:{n,of},planned:true,startState:{people:{}},size:"MS",angle:"eye",lens:"35",move:"static",subjects:["a"],...(more||{})});

test("1 a shot's number, what it is, and its camera words", ()=>{
  assert.equal(K.number(shot(1,3,6)),"1.3"); assert.equal(K.number({beatN:2}),"2.1","a beat kept as one shot"); assert.equal(K.number({}),"0.1");
  assert.equal(K.name(shot(1,1,1)),"Medium"); assert.equal(K.name(shot(1,1,1,{subjects:["a","b"]})),"Two-shot");
  assert.equal(K.name(shot(1,1,1,{size:"INSERT",subjects:["a","b"]})),"Insert","an insert is an insert, whoever holds the thing");
  assert.equal(K.name(shot(1,1,1,{size:"WS",move:"handheld"})),"Wide, moving"); assert.equal(K.name(shot(1,1,1,{size:"CU",subjects:["a","b"]})),"Close","two faces in a close-up is not called a two-shot");
  assert.equal(K.name({}),"Shot");
  for(const size of ["EWS","WS","FS","MWS","MS","MCU","CU","ECU","INSERT"]){ assert.ok(K.SHORT[size]&&K.FULL[size],size); assert.ok(!/^[A-Z]{2,}$/.test(K.name({size})),"said in words: "+size); }
  assert.deepEqual(plain(K.chips(shot(1,3,6),{seconds:5})),["Medium shot","Eye level","35 mm","Static","5 s"],"the design's own five");
  assert.deepEqual(plain(K.chips(shot(1,1,1,{size:"CU",angle:"low",lens:"85mm",move:"push"}),{seconds:3.26})),["Close-up","Low angle","85 mm","Push in","3.3 s"]);
  assert.deepEqual(plain(K.chips(shot(1,1,1),{seconds:4,lensMm:24})),["Medium shot","Eye level","24 mm","Static","4 s"],"the lens its drawing was made through, when there is one");
  assert.deepEqual(plain(K.chips({size:"MS",angle:"auto",move:""},{})),["Medium shot","Static"]);
});

test("2 the word under a small picture, the four counts, the beat's name and its line", ()=>{
  const s=o=>K.state(o);
  assert.equal(s({open:true,frame:true,approved:true}),"Open below"); assert.equal(s({making:true,frame:true}),"Making…");
  assert.equal(s({frame:true,approved:true,drawn:true}),"Approved"); assert.equal(s({frame:true,drawn:true}),"Frame made");
  assert.equal(s({drawn:true,planned:true}),"Drawn"); assert.equal(s({planned:true}),"Planned"); assert.equal(s({}),"Not planned");
  assert.equal(s({approved:true}),"Not planned","approved means nothing without its frame");
  const list=[shot(1,1,3,{locked:true}),shot(1,2,3),shot(1,3,3,{planned:false}),{id:"x",beatN:1}];
  const c=K.counts(list,{frame:sh=>sh.id==="s1-1"||sh.id==="s1-2",drawn:sh=>sh.id!=="x"});
  assert.deepEqual(plain(c),{planned:2,drawn:3,frames:2,approved:1}); assert.deepEqual(plain(K.countWords(c)),["2 planned","3 drawn","2 frames","1 approved"]);
  assert.deepEqual(plain(K.countWords({planned:1,drawn:1,frames:1,approved:0})),["1 planned","1 drawn","1 frame","0 approved"]);
  assert.deepEqual(plain(K.counts(null,{})),{planned:0,drawn:0,frames:0,approved:0});
  assert.equal(K.beatTitle({drive:{a:"Disarms",d:"long"},react:{a:"Accommodates"}}),"Disarms","the beat is named by what its driver does");
  assert.equal(K.beatTitle({}),""); assert.equal(K.beatTitle(null),"");
  assert.equal(K.beatMeta({place:"Custody Suite",shots:6,seconds:25.4}),"Custody Suite · 6 shots · 25 seconds");
  assert.equal(K.beatMeta({place:"",shots:1,seconds:1}),"1 shot · 1 second"); assert.equal(K.beatMeta({shots:2}),"2 shots");
});

test("3 the order a beat's shots play in, and which one is open when none was chosen", ()=>{
  const list=[shot(1,3,3),{id:"alt",beatN:1,order:9},shot(1,1,3),shot(1,2,3)];
  assert.deepEqual(K.order(list).map(sh=>sh.id),["s1-1","s1-2","s1-3","alt"],"its moments in their order, then any other shot it holds");
  assert.equal(K.firstOpen(list,sh=>sh.id==="s1-1"),"s1-2","the first with no frame yet");
  assert.equal(K.firstOpen(list,()=>true),"s1-1","every frame made: the first"); assert.equal(K.firstOpen([],()=>false),"");
  assert.deepEqual(plain(K.order(null)),[]);
});

test("4 the five steps of an open shot: one is next, the rest done or later", ()=>{
  const st=o=>plain(K.steps(o)).map(s=>s.n+" "+s.name+": "+s.state+" ("+s.note+")");
  assert.deepEqual(st({words:true,camera:true,previs:"ok"}),["1 What happens: done (done)","2 Camera: done (done)","3 Previs: done (done)","4 Frame: next (next)","5 Approve: later (after the frame)"],"the design's own state");
  assert.deepEqual(st({words:true,camera:true,previs:"ok",frame:true}).slice(3),["4 Frame: done (done)","5 Approve: next (next)"]);
  assert.deepEqual(st({words:true,camera:true,previs:"ok",frame:true,approved:true}).map(x=>x.split(": ")[1].split(" ")[0]),["done","done","done","done","done"]);
  assert.equal(st({words:true,camera:true,previs:"notes"})[2],"3 Previs: done (see the notes)","drawn, with something a check found");
  assert.equal(st({words:true,camera:true,previs:""})[2],"3 Previs: next (drawing…)"); assert.equal(st({words:true,camera:true,previs:""})[3],"4 Frame: later (later)");
  // a shot that cannot be drawn (no scene plan, no floor plan) skips the drawing: its frame is next
  assert.deepEqual(st({words:true,camera:true,previs:"none"}).slice(2,4),["3 Previs: done (no drawing here)","4 Frame: next (next)"]);
  assert.equal(st({words:true,camera:true,previs:"ok",busy:true})[3],"4 Frame: next (making…)");
  assert.equal(st({})[0],"1 What happens: next (next)"); assert.equal(st({approved:true})[4],"5 Approve: later (after the frame)","approved without its frame is not done");
  assert.equal(K.steps({}).length,5);
});

test("5 the small floor plan, the camera's line and the line that says every check passed", ()=>{
  // a stand-in for the Locations tab's own plan (KinolotSetCard.planModel): it is handed one camera, the shot's
  let given=null;
  box.KinolotSetCard={planModel:(plan,space,key,people,width)=>{ given={plan,space,key,people,width};
    return {W:300,H:200,scale:50,origin:[2,1],wall:4,rooms:[{id:"r",points:[[0,0]],lit:true,at:[1,1],name:"Hall"}],doors:[],windows:[],camera:{at:[150,100],n:0,cone:[[150,100],[1,1],[2,2]]},people:[],missing:false}; }};
  const m=K.planModel({spaces:[1],cameras:[{old:true}]},"hall",{position:[2,1,1.5],yaw:90,lensMm:36},
    [{id:"liaqat",name:"LIAQAT HUSSAIN",xy:[3,1],colour:"green"},{id:"lena",name:"Lena",xy:[2,2],colour:"blue"},{id:"pike",name:"DARREN PIKE",xy:[1,1],colour:"nope"},{id:"bad",name:"X"}],324);
  assert.equal(given.key,"shot"); assert.equal(given.width,324); assert.deepEqual(plain(given.space),{id:"hall"}); assert.equal(given.people,null);
  assert.equal(given.plan.cameras.length,1,"only this shot's camera: the place's four are not drawn");
  const cam=given.plan.cameras[0];
  assert.deepEqual(plain([cam.spaceId,cam.panel,cam.position]),["hall","shot",[2,1]]);
  // yaw 90 looks east; a 36 mm lens on a 36 mm frame sees 53 degrees: the wedge opens 26.6 either side
  assert.ok(cam.frustum[1][0]>4&&cam.frustum[2][0]>4&&cam.frustum[1][1]>1&&cam.frustum[2][1]<1,"the wedge it looks through, east");
  assert.ok(Math.abs(Math.atan2(cam.frustum[1][1]-1,cam.frustum[1][0]-2)-Math.atan(0.5))<1e-6);
  assert.deepEqual(plain(m.people.map(p=>[p.initial,p.name,p.at,p.css])),[["Li","LIAQAT HUSSAIN",[200,100],"#2F9A45"],["Le","Lena",[150,50],"#2E4FD6"],["D","DARREN PIKE",[100,100],""]],"each on their mark, an initial each (two letters when two share one), in the drawing's own colour");
  assert.deepEqual(plain(m.camera),{at:[150,100],cone:[[150,100],[1,1],[2,2]]}); assert.equal(m.rooms.length,1);
  assert.equal(K.planModel(null,"hall",{},[],324),null); delete box.KinolotSetCard; assert.equal(K.planModel({},"hall",{},[],324),null,"no plan reader, no plan: never a throw");
  const res={start:{},pose:{position:[1,2,1.5],yaw:0,lensMm:35},distance:1.94,notes:[],missing:[],fits:true,people:[{id:"a"},{id:"b"}]};
  assert.equal(K.cameraLine(res),"1.9 m from them · 1.5 m high · 35 mm lens","the design's own line");
  assert.equal(K.cameraLine({...res,people:[{id:"a"}]}),"1.9 m from who it frames · 1.5 m high · 35 mm lens"); assert.equal(K.cameraLine({}),"");
  assert.equal(K.checkLine(res),"Both faces are seen. Nothing stands in the way.");
  assert.equal(K.checkLine({...res,people:[{id:"a"}]}),"The face is seen. Nothing stands in the way."); assert.equal(K.checkLine({...res,people:[{},{},{}]}),"Every face is seen. Nothing stands in the way.");
  assert.equal(K.checkLine({...res,people:[{id:"a"},{id:"b",unseen:true}]}),"The face is seen. Nothing stands in the way.","someone behind a shut door is not counted as seen");
  assert.equal(K.checkLine({...res,notes:["From your angle one person hides another."]}),null,"a check that found something: its note is shown instead");
  assert.equal(K.checkLine({...res,fits:false}),null); assert.equal(K.checkLine({...res,missing:["x"]}),null); assert.equal(K.checkLine({pose:{}}),null);
});

test("6 the beat's own card: what it shows and its four actions", ()=>{
  for(const id of ["beat-card","beat-card-meta","beat-card-counts","beat-card-shot","beat-card-stage","beat-card-draw","beat-card-frames","beat-card-new"]) assert.ok(face.includes('"data-testid":"'+id+'"'),id);
  assert.ok(face.includes('"Send this beat to the Stage"')&&face.includes('"Draw the beat"')&&face.includes('"Make frames in order"')&&face.includes('"New shot in this beat"'),"the design's four");
  assert.ok(face.includes('K.number(sh)+" "+K.name(sh)')&&face.includes("K.beatMeta({ place:place && place.name, shots:shots.length, seconds })")&&face.includes("K.countWords(c).map("));
  assert.ok(face.includes('onClick:()=>onOpen && onOpen(sh.id)')&&face.includes('"aria-pressed":open?"true":"false"'),"a small picture opens its shot");
  assert.ok(face.includes("const pic = frame || (r && r.start && r.start.dataUrl) || \"\";"),"its frame when it has one, else its drawing");
  // drawn only once the card has been on screen, in turn with every other drawing, and kept where the strip looks
  assert.ok(face.includes("const info = (seen && typeof window.beatStripInfo===\"function\") ? window.beatStripInfo(scene, L.shots, ordered, ctx) : null;")&&face.includes("window.beatStripRows(info, ctx).then("));
  assert.ok(previsUi.includes("if(BEAT_STRIP_KEPT.has(info.sig)) return Promise.resolve(BEAT_STRIP_KEPT.get(info.sig));")&&previsUi.includes("const turn = shotPrevisLine.then(draw, draw);"));
  // Make frames in order: it asks first, with the price, and goes through each shot's own card
  const make=face.slice(face.indexOf("const makeAll = async ()=>{"),face.indexOf("const toStage ="));
  assert.ok(make.indexOf("window.appConfirm({")<make.indexOf("window.shotPrevisMakeBeat(info.list, info.endOwnerId, setRun)")&&make.includes("if(!ok) return;")&&make.includes("window.nbImageCostText(n)"));
  assert.ok(make.includes("A frame that is there now is kept as an earlier version. Nothing is approved."));
  assert.ok(face.includes("const toStage = ()=>{ if(typeof window.turnSendBeatToStage===\"function\") window.turnSendBeatToStage(scene.id, L.n, first ? first.id : \"\"); };"));
  assert.ok(!/proxyGenerate|claude\.complete|setProject|onUpdateShot|nbCommit/.test(face),"the card itself makes nothing and saves nothing");
});

test("7 one shot open under its beat; every other card stays in the page", ()=>{
  const at=ui.indexOf("if(window.ShotBeatFace && window.KinolotBeatCard){"), fn=ui.slice(at,ui.indexOf('return _el(React.Fragment,{key:"bc"+(L.canonical?"c":"o")+L.n},',at));
  assert.ok(at>0&&fn.length>1500);
  assert.ok(fn.includes('_el("div",{className:"sbc-shot",hidden:momentOpen},')&&fn.includes('momentShots.map(sh=>_el("div",{key:sh.id,className:"sbc-shot",hidden:sh.id!==openNow},'),"hidden, never unmounted: a run of frames finds each card's own generator");
  assert.ok(css.includes(".sbc-shot[hidden]{display:none}"));
  assert.ok(fn.includes("face:true, faceOpen:!momentOpen, pickId:momentOpen?\"\":openNow")&&fn.includes("face:true, faceOpen:sh.id===openNow"),"only the open one draws");
  assert.ok(fn.includes("const openNow=running || (picked&&L.shots.some(sh=>sh.id===picked) ? picked : KB.firstOpen(L.shots,sh=>_kf(sh.id)));")&&fn.includes("const running=(L.shots.find(sh=>shotRunsHere(sh,batchActiveId))||{}).id||\"\";"),"the shot a run is making shows itself");
  assert.ok(fn.includes("onAddShot:(onAddShot&&!readOnly)?()=>setAddBeat(L.n):null")&&fn.includes("onAdd:(chosen)=>{ setAddBeat(null); onAddShot(scene.id,L.n,chosen); }"),"New shot in this beat opens the window that adds one");
  assert.ok(fn.includes("(stripByBeat[L.n] && window.BeatStrip) && _el(\"div\",{className:\"sheet-card sbc-strip\",\"data-testid\":\"beat-row-strip\"},")&&fn.includes("readOnly,bare:true})"),"Draw the beat: the strip, across the row");
  assert.ok(previsUi.includes("!bare && !readOnly && list.some(sh=>shotPrevisMaker(sh.id)) && SPV_E(\"div\",{className:\"beat-strip-all\"},"),"the strip does not repeat the card's own Make frames in order");
  assert.ok(fn.includes("momentsLine:beatMomentsLine({L:Lopen,")&&ui.includes("!face && beatMomentsLine({L,scene,ctx,characters,bm,primary,momentShots,"),"the beat's moments are said once, on its card");
  assert.ok(ui.includes('className:"beat-card-grid"+((window.ShotBeatFace && window.KinolotBeatCard)?" beat-first":"")')&&css.includes(".sbc-row{display:grid;grid-template-columns:minmax(300px,400px) minmax(0,1fr)"));
  assert.ok(css.includes("@media (max-width:980px){\n  .sbc-row{grid-template-columns:minmax(0,1fr)}"),"under its beat on a narrow screen");
  // (owner 2026-11-25) the open shot fills the rest of the row: its right edge is the scene header's, on any width
  assert.ok(css.includes(".sbc-open{min-width:0}\n")&&!/\.sbc-open\{[^}]*max-width:\d/.test(css),"no fixed width on the open shot");
  assert.ok(css.includes(".sbc-side{min-width:0;align-self:stretch}")&&fn.includes('_el("div",{className:"sbc-side"},_el(window.ShotBeatFace,{'),"the beat's card follows the page inside its own column");
  // the earlier layout is still there for when the new cards are not loaded
  assert.ok(ui.includes('window.BeatStrip && _el(window.BeatStrip,{key:"strip"+L.n,scene,beatN:L.n,shots:L.shots,sceneShots:ordered,ctx,onView,readOnly}),'));
});

test("8 the open shot: a picture with four views, five steps, Advanced; every part moved, none removed", ()=>{
  const at=ui.indexOf("  if(!faceOn) return cardTree;"), fn=ui.slice(at,ui.indexOf("/* THE END FRAME OF A BEAT, on the card of the beat's last shot",at));
  assert.ok(at>0&&fn.length>3000);
  assert.deepEqual([...ui.matchAll(/\{ id:"(previs|clay|depth|frame)", name:"(\w+)"/g)].map(m=>m[2]),["Previs","Clay","Depth","Frame"],"the design's four views");
  assert.ok(ui.includes('const viewNow = faceView || (gen.genUrl ? "frame" : "previs");'),"its frame when it has one, else its drawing");
  const order=["// 1 · What happens","// 2 · Camera","// 3 · Previs","// 4 · Frame","// 5 · Approve","faceSlots.endFrame,",'className:"sbc-adv"'].map(t=>fn.indexOf(t));
  assert.ok(order.every((v,i)=>v>0&&(i===0||v>order[i-1])),"in the design's order: "+order.join(","));
  assert.ok(fn.includes("fSteps[0]")&&fn.includes("fSteps[4]")&&fn.includes("KF.steps({ words:shotSteps[0].done, camera:shotSteps[1].done, previs:previsState, frame:shotSteps[2].done, approved:shotSteps[3].done,"));
  // every part the card had is handed to a step or to Advanced
  const slots=[...ui.matchAll(/slot\("(\w+)",/g)].map(m=>m[1]);
  assert.deepEqual(slots,["frame","context","scripted","planLines","startsFrom","words","inFrame","camera","previsFold","refNote","review","prompt","endFrame"]);
  for(const s of slots.filter(x=>x!=="previsFold")) assert.ok(fn.includes("faceSlots."+s),"shown in the new layout: "+s);
  assert.ok(ui.includes("const slot = (name, el)=>{ if(!faceOn) return el; faceSlots[name] = el; return null; };"),"in the earlier layout each part stays exactly where it was");
  // what must never unmount: the frame's own picture (hidden behind another view) and the beat's end frame
  assert.ok(face.includes('SBC_E("div",{className:"sbc-pic-frame",hidden:shown},frame)')&&css.includes(".sbc-pic-frame[hidden]{display:none}"));
  assert.ok(fn.indexOf("faceSlots.endFrame,")<fn.indexOf('_el("details",{className:"sbc-adv"')&&!/CardFold/.test(fn),"no part of the open shot is unmounted by folding");
  // the steps' own content
  for(const t of ['"Make the frame from this previs"','"Approve this frame"','"Return to the planned camera"','_el("b",null,"Your angle")','"Amber dot: the camera and where it looks"',
    '"The drawing sets where everything is. The sheets and the location image give the look."','"How it starts"','"How it ends"','_el("summary",null,"Advanced: shot prompt, cinematography")',
    '_el("span",{className:"sbc-lab"},"In frame")','_el("span",{className:"sbc-lab"},"Uses")']) assert.ok(fn.includes(t),t);
  assert.ok(fn.includes('const fMake = ()=>{ setFaceView("frame"); return (res && res.start) ? makeFromPrevis() : genGuarded.generate(); };'),"the same two ways a frame was always made");
  assert.ok(fn.includes("onClick:toggleFrameApproval},sh.locked ? \"Unlock this frame\" : \"Approve this frame\")")&&fn.includes("disabled:readOnly || !gen.genUrl,"));
  assert.ok(fn.includes('className:"sbc-btn"+(fSteps[3].state==="next"?" primary":"")'),"one amber button: the step that is next");
  // drawn only for the open shot, sharing the Previs section's own drawings
  assert.ok(ui.includes('const drawColour = useDraw ? useDraw(sh, ctx, sceneShots, "", faceOn && faceOpen) : {};')&&previsUi.includes('sig = shotPrevisSig(sh, plan, cam, loc, ctx)+JSON.stringify(staged)+(look ? "|look:"+look : "");'));
  assert.ok(previsUi.includes("ShotPrevisBody,{sh,plan,cam,loc,ctx,sig:shotPrevisSig(sh,plan,cam,loc,ctx)+JSON.stringify(st)"),"the same key the Previs section keeps its drawings under");
});

test("9 Send this beat to the Stage only goes there; loaded in order; Frances knows; no vendor or billing word", ()=>{
  const send=app.slice(app.indexOf("window.turnSendBeatToStage = (sceneId, beatN, shotId)=>{"),app.indexOf("const planSceneShots = async"));
  assert.ok(send.includes('window.turnStageBeat = { sceneId, beatN, shotId:shotId||"", at:Date.now(), film:window.turnOpenFilmId||null };')&&send.includes('if(!guardedSetRoom("stage")) window.turnStageBeat = null;'));
  assert.ok(!/setShots|setProject|vidSubmit|generate\(/.test(send),"nothing is rendered, saved or charged by it");
  const got=stage.slice(stage.indexOf("const beatSentRef = React.useRef(false);"),stage.indexOf("},[allClips.length]);",stage.indexOf("const beatSentRef")));
  assert.ok(got.includes("Date.now()-f.at>20000")&&got.includes("(f.film||null)!==(window.turnOpenFilmId||null)")&&got.includes("if(hit) setSelId(hit.id);")&&got.includes("sh.id===f.shotId"));
  assert.ok(!/saveFilmStage|setClipScope|onUpdateShot/.test(got),"it only selects a clip");
  const i=s=>html.indexOf(s);
  assert.ok(i("app/location-set-card.js?v=")<i("app/shot-beat-card.js?v=")&&i("app/shot-beat-card.js?v=")<i("app/shot-beat-card-ui.jsx?v="),"the plan reader, the words, then the screen");
  for(const f of ["app/shot-beat-card.js","app/shot-beat-card-ui.jsx","app/shots-ui.jsx","app/shot-previs-ui.jsx","app/stage.jsx","app/app.jsx","app/styles.css","app/ai.jsx"])
    assert.ok(["20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
  const g={APP_FEATURES:[]}; new Function("APP_FEATURES",ai.split("\n").filter(l=>l.startsWith('APP_FEATURES.push({ name:"Shots: a beat and its open shot')).join("\n"))(g.APP_FEATURES);
  assert.equal(g.APP_FEATURES.length,1);
  const fact=g.APP_FEATURES[0].what;
  for(const t of ["This entry is the newest word on how the Shots tab is laid out","ONE shot is open beside it","Send this beat to the Stage opens the Stage on that beat's clip and renders nothing by itself",
    "Make frames in order makes every frame of the beat from its drawing, in order, and asks first","Previs, Clay and Depth","1 What happens","2 Camera","3 Previs","4 Frame","5 Approve","ADVANCED, folded at the bottom","Nothing was removed from the shot card"]) assert.ok(fact.includes(t),t);
  assert.ok(!/credit|\$|claude|anthropic|fable|opus|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(fact),"no price, no engine, no internal name");
  // (the codename is the word in capitals; "in turn" and "the scene turns" are plain English)
  assert.ok(!/claude|anthropic/i.test(face+logic)&&!/\bTURN\b|\bMUSE\b/.test(face+logic));
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

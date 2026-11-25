/* THE FRAME MATCHES THE DRAWING (owner 2026-11-24: "fix the framing so the frame matches the drawing").
   Shot 2.1 of Scene 5, made from its previs, held its props' sizes and lost the picture: the drawing looks across a
   hall at a flat wall, through a doorway, looking down 12 degrees; the frame came back as a level view along the hall,
   as the location's image shows the place. Three things pulled it off, and each is answered in code:
   1 the drawing is MEASURED (shot-previs.js project / measure / frameMap) and the frame is told the measurements;
   2 the plan's own size of shot and angle are replaced, for that render, by the ones the drawing really has;
   3 the location's image rides as shuffled SWATCHES (materials, colour and light, no viewpoint), and each prop's
     sheet says where the drawing has that prop, not who owns it. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const src=read("app/shot-previs.js"), ui=read("app/shot-previs-ui.jsx"), shotsUi=read("app/shots-ui.jsx"), shots=read("app/shots.jsx"), ai=read("app/ai.jsx"), html=read("TURN.html");
const box={console}; box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/scene-plan.js","app/prop-model.js","app/shot-previs.js"]) vm.runInContext(read(f),box,{filename:f});
const V=box.ShotPrevis, plain=v=>JSON.parse(JSON.stringify(v));
let pass=0,fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n").slice(0,3).join(" | ")); } };
const near=(a,b,eps=1e-3)=>Math.abs(a-b)<=eps;

test("1 a point through the camera: across from the left edge, down from the top edge, as the drawing is made (36 mm wide, 16:9)", ()=>{
  const level={position:[0,0,1.5],yaw:0,pitch:0,lensMm:36};
  const mid=V.project(level,[0,2,1.5]); assert.ok(near(mid.across,0.5)&&near(mid.down,0.5)&&near(mid.depth,2));
  // a 36 mm lens sees half a metre each side at one metre; 0.28125 m up and down
  assert.ok(near(V.project(level,[0.5,1,1.5]).across,1)&&near(V.project(level,[-0.5,1,1.5]).across,0)); assert.ok(near(V.project(level,[0,1,1.78125]).down,0)&&near(V.project(level,[0,1,1.21875]).down,1));
  // yaw 90 looks east: north is then on the left
  assert.ok(V.project({...level,yaw:90},[2,1,1.5]).across<0.5); assert.ok(near(V.project({...level,yaw:90},[2,0,1.5]).across,0.5));
  // looking down, a point at the camera's own height rises in the frame
  assert.ok(V.project({...level,pitch:-20},[0,2,1.5]).down<0.5);
  assert.equal(V.project(level,[0,-1,1.5]),null,"behind the camera"); assert.equal(V.project({},[0,1,1]),null);
});

// the camera of shot 2.1, and two people about where the drawing has them
const POSE={position:[0.943,1.339,1.5],yaw:-118.58,pitch:-11.57,lensMm:21};
const a=POSE.yaw*Math.PI/180, look=[Math.sin(a),Math.cos(a)], at=(d,side)=>[POSE.position[0]+look[0]*d-look[1]*side,POSE.position[1]+look[1]*d+look[0]*side];
const PEOPLE=[{id:"d",name:"DARREN PIKE",head:[...at(0.9,-0.15),1.78-0.115],height:1.78,pose:"standing, both hands on mug"},
  {id:"l",name:"LIAQAT HUSSAIN",head:[...at(1.3,0.35),1.68-0.115],height:1.68,pose:"standing, facing Pike"}];
const THINGS=[{key:"mug",name:"Mug of tea",at:[...at(0.8,0.05),1.05],size:[0.112,0.08,0.095],held:"d"},{key:"tub",name:"Rinsed rice Tupperware",at:[...at(1.6,0.1),1.27],size:[0.17,0.12,0.07],on:"Narrow hall wall shelf"}];
const FIXED=[{id:"shelf",name:"Narrow hall wall shelf",centre:[...at(1.6,0.1),1.25]}];

test("2 the drawing, measured: each head, what the lower edge cuts, each thing, the order across, who is nearest, the real size and tilt", ()=>{
  const m=V.measure(POSE,PEOPLE,THINGS,FIXED);
  assert.equal(m.pitch,-12); assert.equal(m.size,"MS","cut at mid-thigh: a medium shot, whatever the distance says");
  const d=m.people.find(p=>p.id==="d"), l=m.people.find(p=>p.id==="l");
  assert.ok(d.across>l.across&&d.head>l.head,"the nearer man is larger; his side of the frame is his");
  assert.equal(d.room,-1,"the top edge cuts through his head"); assert.ok(l.room>5&&l.room<30); assert.equal(d.cut,"mid-thigh"); assert.equal(l.cut,"the knees");
  assert.deepEqual(plain(m.order),["LIAQAT HUSSAIN","the narrow hall wall shelf","DARREN PIKE"],"left to right; a thing in someone's hands or on a shelf goes with them");
  assert.deepEqual(plain(m.nearest.map(x=>x.name)),["DARREN PIKE","LIAQAT HUSSAIN"]);
  const mug=m.things.find(t=>t.key==="mug"); assert.ok(mug.wide>=5&&mug.wide<=12&&mug.down>60,JSON.stringify(mug));
  // what a person stands in front of from this camera is not seen: said, and left out of the order (their own mug is theirs)
  const hooks={id:"hooks",name:"Row of key hooks",centre:[PEOPLE[1].head[0]+look[0]*0.5,PEOPLE[1].head[1]+look[1]*0.5,1.5]}, keys={key:"keys",name:"Cab keys",at:[hooks.centre[0],hooks.centre[1],1.38],size:[0.06,0.014,0.11],on:"Row of key hooks",hung:true};
  const h=V.measure(POSE,PEOPLE,THINGS.concat([keys]),FIXED.concat([hooks]));
  assert.equal(h.fixed.find(f=>f.id==="hooks").hidden,"LIAQAT HUSSAIN"); assert.equal(h.things.find(t=>t.key==="keys").hidden,"LIAQAT HUSSAIN"); assert.equal(h.things.find(t=>t.key==="mug").hidden,"");
  assert.ok(!h.order.includes("the row of key hooks")); const said=V.frameMap(h,2.4);
  assert.ok(said.includes("The row of key hooks is behind LIAQAT HUSSAIN from this camera: it is not seen.")&&said.includes("The Cab keys is behind LIAQAT HUSSAIN from this camera: it is not seen."));
  // someone behind a shut door from here, or out of frame, is not measured; a whole figure in frame is a full shot
  assert.equal(V.measure(POSE,[{...PEOPLE[0],unseen:true}],[],[]).people.length,0);
  assert.equal(V.measure(POSE,[{...PEOPLE[0],head:[5,5,1.6]}],[],[]).people.length,0);
  const far=V.measure({position:[0,0,1.5],yaw:0,pitch:0,lensMm:24},[{id:"x",name:"X",head:[0,4,1.665],height:1.78,pose:"standing"}],[],[]);
  assert.equal(far.people[0].cut,"whole"); assert.equal(far.size,"FS"); assert.ok(far.people[0].feet>50);
  // someone sitting: no word on where the edge cuts them (it is said of people who stand)
  assert.equal(V.measure({position:[0,0,1.2],yaw:0,pitch:0,lensMm:35},[{id:"s",name:"S",head:[0,1.5,1.2],height:1.7,pose:"sitting on the sofa"}],[],[]).people[0].cut,"");
});

test("3 the same, in sentences the image engine is given", ()=>{
  const t=V.frameMap(V.measure(POSE,PEOPLE,THINGS,FIXED),2.4);
  for(const x of ["THE FRAME, MEASURED ON IMAGE 1 (the finished picture measures the same;","It is a medium shot (from the waist or the thighs up), and the camera looks DOWN about 12 degrees: it is not a level view.",
    "From left to right the frame holds: LIAQAT HUSSAIN, then the narrow hall wall shelf, then DARREN PIKE. Keep that order.","DARREN PIKE: the head is ","the top edge of the frame cuts through the head; the lower edge of the frame cuts them at mid-thigh.",
    "LIAQAT HUSSAIN: the head is ","% of the frame is above the head; the lower edge of the frame cuts them at the knees.","The narrow hall wall shelf is ","The Mug of tea is ","% of the frame’s width.",
    "Nearest the camera is DARREN PIKE (0.8 m), then LIAQAT HUSSAIN (1.3 m).","Nothing in this picture is further than about 2.4 m from the camera: it is a close view against what stands behind the people, with NO view along a corridor and no far room."]) assert.ok(t.includes(x),x);
  assert.ok(V.frameMap(V.measure(POSE,PEOPLE,THINGS,FIXED),9).includes("The furthest thing in this picture is about 9 m from the camera.")&&!V.frameMap(V.measure(POSE,PEOPLE,THINGS,FIXED),9).includes("NO view along a corridor"));
  assert.ok(V.frameMap(V.measure({...POSE,pitch:2},PEOPLE,THINGS,FIXED),0).includes(", from a level camera."));
  assert.equal(V.frameMap(V.measure(POSE,[],[],[]),2),"","nothing measured, nothing said");
  assert.ok(!/claude|anthropic|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(t));
});

test("4 measured when a frame is made, with how deep the picture goes; it rides with the drawing", ()=>{
  assert.ok(src.includes("reach.push(hit.distance);")&&src.includes("list.far=reach.length>=COLS*ROWS*0.6?Math.round(reach[Math.floor(reach.length*0.97)]*10)/10:0;"),"how far the frame reaches, read by the same rays that name what it holds");
  assert.ok(src.includes("out.start.frame=measure(found.pose,first.people,first.things,first.surfaces); out.start.map=frameMap(out.start.frame,seen.far);"));
  assert.ok(src.includes("out.end.frame=measure(found.pose,last.people,last.things,last.surfaces); out.end.map=frameMap(out.end.frame,seen.far);"),"an end frame is measured as it ends");
  assert.ok(ui.includes('map:pic.map||"", size:(pic.frame && pic.frame.size)||"", pitch:(pic.frame ? pic.frame.pitch : 0)||0, placed };'));
  // in the prompt, after what Image 1 shows; what an edge cuts stays cut
  const at=shots.indexOf('clean(_previs.map)+" What an edge of Image 1 cuts, the same edge of the finished picture cuts in the same place: do not pull back to show more of anyone or of the room. "');
  assert.ok(at>shots.indexOf('"WHAT IMAGE 1 SHOWS, read from the 3D set: "')&&at<shots.indexOf('"ITS STAND-INS: "'));
  assert.ok(!/nbCommit|claude\.complete|proxyGenerate/.test(src.slice(src.indexOf("function project(pose,point){"),src.indexOf("const sameState="))),"plain numbers: no engine, nothing saved");
});

test("5 the drawing's own size of shot and tilt replace the plan's words for that render", ()=>{
  for(const t of ['const drawnSize = String(gopts.previs.size||""), tilt = Number(gopts.previs.pitch)||0;','...((drawnSize && (window.SHOT_SIZES||[]).some(x=>x.id===drawnSize) && sh.size!=="INSERT") ? { size:drawnSize } : {}),',
    '...(tilt<=-8 ? { angle:"high" } : tilt>=8 ? { angle:"low" } : ((sh.angle==="high" || sh.angle==="low") ? { angle:"eye" } : {})) },{...base,previs:gopts.previs});']) assert.ok(shotsUi.includes(t),t);
  // the ids are the app's own
  for(const id of ["ECU","CU","MCU","MS","MWS","FS","WS"]) assert.ok(shots.includes('{ id:"'+id+'",'),id);
  for(const id of ["eye","high","low"]) assert.ok(shots.includes('{ id:"'+id+'",'),id);
});

test("6 the location's image rides as swatches, and a prop's sheet says where the drawing has it", ()=>{
  const at=shotsUi.indexOf("MADE FROM ITS PREVIS, THE FRAME MATCHES THE DRAWING"), fn=shotsUi.slice(at,shotsUi.indexOf("/* made from its previs: the previs is Image 1, so the frame this shot chains from",at));
  assert.ok(at>0&&fn.length>800);
  assert.ok(fn.includes("if(gopts && gopts.previs && gopts.previs.url && !gopts.editInstruction){"),"only a frame made from its drawing; an ordinary Generate and an edit are as they were");
  assert.ok(fn.includes('if(!r || r.assetRole==="screenplay_context") return r;'));
  assert.ok(fn.includes("const sw = await window.shotLookSwatches(r.url, 1536);")&&fn.includes("return sw ? { ...r, url:sw, maxDim:1536, ephemeral:true, persist:false, swatches:true,")&&fn.includes("} : r;"),"cut and shuffled; whole when it cannot be cut");
  assert.ok(fn.includes('note:"a sheet of SWATCHES cut from "+(r.note||"the location\\u2019s image")+" and shuffled: it is not a picture of the place"'));
  assert.ok(shots.includes('((_previs && r.locationId) ? " \\u2014 for materials, surfaces, colour and light ONLY: take no layout, no camera, no viewpoint and no position of anything from it" : "")'),"and the map still says what it is for");
  assert.ok(ui.includes("function shotLookSwatches(url, width){")&&ui.includes("W = Math.max(640,Math.min(1536,Math.round(Number(width)||960)))"),"larger for a place than for the frame before");
  // props: where the drawing has each, by its card; one the drawing does not hold is not drawn
  assert.ok(fn.includes('const hit = placed.find(x=>x.propId && String(x.propId)===String(r.baseId));')&&fn.includes('(hit ? "in this picture it is "+hit.where : "NOT in this picture: Image 1 does not hold it, so it is not drawn")'));
  for(const t of ['t.held ? "in "+who(t.held)+"\\u2019s hands" : t.on ? (t.hung ? "hanging from the " : "on the ")+low(t.on) : "standing on its own"','propId:String(pt.propId||"")','(holder && holder.unseen) ? ""']) assert.ok(ui.includes(t),t);
});

test("7 fresh keys, and Frances knows", ()=>{
  for(const f of ["app/shot-previs.js","app/shot-previs-ui.jsx","app/shots-ui.jsx","app/shots.jsx","app/ai.jsx","app/script.jsx"]) assert.ok(["20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
  const fact=ai.split("\n").find(l=>l.startsWith('APP_FEATURES.push({ name:"Shots: the previs of a shot, and its camera on the floor plan"'));
  for(const t of ["SO THAT THE FRAME MATCHES THE DRAWING, the drawing is measured","where the lower edge of the frame cuts each person","the size of shot and the tilt the drawing really has","cut into shuffled swatches, for its materials, colour and light only","says where the drawing has that prop"]) assert.ok(fact.includes(t),t);
  assert.ok(!/credit|\$|claude|anthropic|opus|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(fact.slice(fact.indexOf("SO THAT THE FRAME"),fact.indexOf("SO THAT THE FRAME")+900)));
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

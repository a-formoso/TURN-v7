/* A SCENE IS WRITTEN TO ITS LENGTH (owner 2026-11-11, Writers' Room audit B3 / C4).
   By the app's own estimate the test films ran 142% (Short Film) to 303% (Commercial) of their format's running
   time: the budget was stated in lines and words, which a model does not count. Measured after this change, on 29
   redrafted scenes of the same films: 98% to 113%. This runs the REAL code and pins:
     1. the shape: the budget as a count of units (formats.jsx sceneShapeFor), for every format;
     2. the drafter's prompt carries it (a redraft keeps its own ceiling); the synopsis is sized to the format;
     3. a draft written one unit a beat is not thrown away: a beat the writer wrote is never emptied by the beat
        matching (the side effect the first trial showed), and a reply that really skips a beat is still caught;
     4. Frances's notes and the page.
   node scripts/test-scene-length.mjs */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {transformSync} from "@babel/core";
const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
let checks=0,failed=0;
const test=async(name,fn)=>{try{await fn();checks++;console.log("PASS",name);}catch(e){failed++;console.log("FAIL",name,"\n   ",String(e&&e.stack||e).split("\n").slice(0,7).join("\n    "));}};
const noop=()=>{};
const plain=v=>JSON.parse(JSON.stringify(v));

const box={console:{...console,warn:noop,info:noop},setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,
  React:new Proxy({createElement:()=>null,Fragment:"f",useState:v=>[typeof v==="function"?v():v,noop],useRef:v=>({current:v}),useEffect:noop,useMemo:f=>f(),useCallback:f=>f,memo:f=>f},{get:(t,k)=>(k in t)?t[k]:noop}),
  ReactDOM:new Proxy({},{get:()=>noop}),Icon:new Proxy({},{get:()=>()=>null}),
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},sessionStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  navigator:{userAgent:"node-test"},location:{href:"",search:"",hash:"",origin:""},
  CustomEvent:class{constructor(t,o){this.type=t;this.detail=o&&o.detail;}},Image:class{},
  document:{createElement:()=>({getContext:()=>null,style:{},setAttribute:noop,appendChild:noop,classList:{add:noop,remove:noop}}),getElementById:()=>null,
    addEventListener:noop,removeEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],createTextNode:()=>({}),body:{appendChild:noop,removeChild:noop},head:{appendChild:noop}},
  requestAnimationFrame:noop,cancelAnimationFrame:noop,addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,
  matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),fetch:()=>{throw new Error("network disabled");}};
box.window=box;box.globalThis=box;box.self=box;vm.createContext(box);
const asShipped=f=>transformSync(read(f),{plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:f}).code;
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/script.jsx","app/ai.jsx"])
  vm.runInContext(f==="app/script.jsx"?asShipped(f):read(f),box,{filename:f});
box.appToast=noop;
const sent=[];let reply="";
box.sbClient=()=>({functions:{invoke:async(_n,o)=>{sent.push(String((o.body.messages[0]||{}).content||""));return{data:{text:reply,usage:{credits:1}},error:null};}}});
const scenesOf=(n)=>Array.from({length:n},(_,i)=>({id:"s"+(i+1),no:i+1,title:"Scene "+(i+1),summary:"Event "+(i+1)+".",act:1,driver:"ana",loc:"INT. ROOM - DAY",openValue:"Hope",openCharge:1,closeValue:"Fear",closeCharge:-2}));
const beatsOf=(n)=>({driverLabel:"ANA",reactorLabel:"BO",desire:"to get in",obstacle:"to keep her out",result:"she leaves",turnAt:n,
  rows:Array.from({length:n},(_,i)=>({n:i+1,drive:{a:"Acts",d:"Ana does thing "+(i+1)+"."},react:{a:"Reacts",d:"Bo answers thing "+(i+1)+"."},charge:1}))});
const cast=[{id:"ana",name:"ANA"},{id:"bo",name:"BO"}];

await test("the shape: each format's scene budget as a count of units, never fewer units than beats",()=>{
  const shape=(format,beats)=>{const F=box.FORMATS.find(f=>f.id===format);const b=box.sceneBudgetFor({format},F.sceneTarget);const s=box.sceneShapeFor(b,beats);return s&&[b.lines,b.words,s.units,s.perBeatLo,s.perBeatHi,s.unitWords];};
  //                                    lines words units lo hi words/unit
  assert.deepEqual(plain(shape("commercial",3)),[7,28,3,1,1,9]);
  assert.deepEqual(plain(shape("microdrama",3)),[16,64,6,2,2,11]);
  assert.deepEqual(plain(shape("short",4)),[28,112,10,2,3,11]);
  assert.deepEqual(plain(shape("musicvideo",3)),[28,112,10,3,4,11]);
  assert.deepEqual(plain(shape("film",5)),[52,208,19,3,4,11]);
  const tv=shape("series",5),feat=shape("feature",5);
  assert.ok(tv[2]>19&&feat[2]>tv[2],"longer formats get more units: "+tv[2]+", "+feat[2]);
  // a film cut into far more scenes than its format holds: still one unit for every beat
  const crowded=box.sceneShapeFor(box.sceneBudgetFor({format:"commercial"},12),3);
  assert.equal(crowded.units,3);assert.equal(crowded.unitWords>=6,true);
  // a documentary's planned testimony is budgeted in seconds: no unit count for it
  assert.equal(box.sceneShapeFor(box.sceneBudgetFor({format:"documentary"},12),5),null);
  assert.equal(box.sceneShapeFor(null,3),null);
});

await test("the drafter is given the shape, in plain counts; a redraft keeps its own ceiling",async()=>{
  const P={title:"Spot",format:"commercial",framework:"threeact",logline:"A runner nearly quits."},sc=scenesOf(4);
  box.turnContinuity={scenes:sc,drafts:{}};box.turnCast=cast;
  sent.length=0;reply="";
  await box.aiDraftScene(sc[1],beatsOf(3),sc[0],P,cast,sc);
  const want="THE SHAPE THAT FITS (a hard limit — this format has no room for more): at most 3 units in the whole scene, 1 per beat. "
    +"A unit is ONE action paragraph or ONE speech (a character cue with its line); a parenthetical rides with its speech. "
    +"About 9 words a unit, and never more than 28 words of screenplay text in the scene. "
    +"A beat is one image or one exchange, not a sequence: choose its single strongest moment and cut the rest. "
    +"Saving room never changes the form: a spoken line is still a cue block and a line block, never folded into an action paragraph or a parenthetical. Count the units before you answer.\n\n";
  assert.ok(sent[0].includes(want),sent[0].slice(sent[0].indexOf("THE SHAPE"),sent[0].indexOf("THE SHAPE")+400));
  // right after the screen-time line it restates, and before the answer format
  const at=s=>{const i=sent[0].indexOf(s);assert.ok(i>=0,s);return i;};
  assert.ok(at("SCREEN TIME: this scene plays about 8 seconds")<at("THE SHAPE THAT FITS")&&at("THE SHAPE THAT FITS")<at("Return ONLY JSON"));
  // a Micro Short scene of four beats
  sent.length=0;const sc8=scenesOf(8);box.turnContinuity={scenes:sc8,drafts:{}};
  await box.aiDraftScene(sc8[2],beatsOf(4),sc8[1],{title:"M",format:"short"},cast,sc8);
  assert.ok(sent[0].includes("at most 10 units in the whole scene, 2–3 per beat.")&&sent[0].includes("About 11 words a unit, and never more than 112 words"));
  // a redraft is held to the current script, not to the shape
  sent.length=0;
  try{await box.aiPolishScene(sc8[2],beatsOf(4),[{type:"action",text:"x",beat:1}],sc8[1],{title:"M",format:"short"},{});}catch(e){}
  assert.ok(sent.length>=1&&!sent[0].includes("THE SHAPE THAT FITS")&&sent[0].includes("SCREEN TIME:"));
});

await test("the synopsis is sized to the format",async()=>{
  const want={commercial:"1-2",microdrama:"2-3",short:"2-3",musicvideo:"2-3",film:"3-5",documentary:"3-5",series:"3-5",feature:"3-5"};
  for(const [id,n] of Object.entries(want)) assert.equal(box.synopsisSentencesFor({format:id}),n,id);
  const research={memory:"m",imagination:"i",fact:{world:"w",roles:[]}};
  sent.length=0;reply=JSON.stringify({synopsis:{setup:"a",confrontation:"b",resolution:"c"}});
  await box.aiSynopsisFromResearch("A runner nearly quits.","","threeact","commercial",research);
  assert.ok(sent[0].includes("Each paragraph 1-2 sentences, vivid and concrete — this format is short, so each paragraph holds only what its screen time can show.\n"),"commercial");
  sent.length=0;
  await box.aiSynopsisFromResearch("A locksmith opens a door.","","threeact","film",research);
  assert.ok(sent[0].includes("Each paragraph 3-5 sentences, vivid and concrete.\n"),"a Short Film keeps the paragraph it had");
});

await test("a draft written one unit a beat is kept: a beat the writer wrote is never emptied",()=>{
  // the reply the first trial lost: three beats, one unit each, the middle one a short speech
  const rows=[{n:1,drive:{a:"Plants",d:"Oisin Fahy plants himself between Priya Raman and the curb."},react:{a:"Pushes",d:"Priya Raman pushes the Tidewell bottle toward Oisin Fahy."}},
    {n:2,drive:{a:"Rotates",d:"Oisin Fahy reaches out and rotates the Tidewell bottle in Priya Raman's hand."},react:{a:"Stops",d:"Priya Raman stops sinking toward the curb."}},
    {n:3,drive:{a:"Presses",d:"Oisin Fahy presses his thumb onto the bare dented space below the twelfth sticker."},react:{a:"Freezes",d:"Priya Raman's cement legs freeze half-bent over the curb."}}];
  const bm={rows,driverLabel:"OISIN FAHY",reactorLabel:"PRIYA RAMAN"};
  const raw=JSON.stringify({beats:[{n:1,blocks:[{type:"action",text:"Priya holds the bottle out, sinking. Oisin's hands lock behind him."}]},
    {n:2,blocks:[{type:"char",text:"OISIN"},{type:"paren",text:"(thumb on the blank)"},{type:"dia",text:"This is thirteen."}]},
    {n:3,blocks:[{type:"action",text:"Plastic creaks in her fist. Priya straightens. Runs."}]}]});
  const scene={id:"s2",no:2,loc:"EXT. MARATHON CURB - DAY"};
  const people=[{id:"oisin",name:"OISIN FAHY"},{id:"priya",name:"PRIYA RAMAN"}];
  const ok=box.resolveScreenplayResponse(raw,scene,bm,{requireAllBeats:true,cast:people});
  assert.equal(ok.valid,true,JSON.stringify(ok.issues));
  assert.equal(ok.blocks.filter(b=>b.type!=="scene").map(b=>b.beat).join(","),"1,2,2,2,3");
  // more units than beats: boundaries may still move, but every beat keeps something
  const many=[{type:"action",text:"Oisin plants himself between Priya and the curb.",beat:1},{type:"action",text:"She pushes the bottle at him.",beat:1},
    {type:"action",text:"He rotates the bottle in her hand.",beat:2},{type:"action",text:"She stops sinking.",beat:2},{type:"action",text:"Thumb on the dented space. Her legs freeze.",beat:3}];
  const got=box.realignBlockBeats(many,bm).map(b=>b.beat);
  assert.equal([...new Set(got)].join(","),"1,2,3");assert.ok(got.every((n,i)=>i===0||n>=got[i-1]),"still in order");
  // a reply that really leaves a beat out is still caught, as before
  const skipped=JSON.stringify({beats:[{n:1,blocks:[{type:"action",text:"Oisin plants himself between Priya and the curb."}]},
    {n:3,blocks:[{type:"action",text:"Oisin presses his thumb onto the dented space. Priya's legs freeze over the curb."}]}]});
  const bad=box.resolveScreenplayResponse(skipped,scene,bm,{requireAllBeats:true,cast:people});
  assert.equal(bad.valid,false);assert.ok(bad.issues.some(x=>/missing screenplay section for beat/.test(x)));
});

await test("Frances knows; the page is on the new key",()=>{
  const f=(box.APP_FEATURES||[]).find(x=>x&&x.name==="Scenes written to the format's length");
  assert.ok(f);
  for(const s of ["a unit is one action paragraph or one speech","A 30-second commercial's scene is about three short units","The synopsis is sized the same way",
    "'Long for this format' note","nothing is rewritten automatically","Redraft never makes a scene longer"]) assert.ok(f.what.includes(s),s);
  assert.ok(!/\bTURN\b|Claude|Anthropic|McKee/.test(f.what));
  const html=read("TURN.html");
  for(const file of ["formats.jsx","ai.jsx","script.jsx"])
    assert.ok(["20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3"].some(k=>html.includes("app/"+file+"?v="+k+'"')),file+" key");
});

console.log(`\n${checks} checks passed${failed?`, ${failed} FAILED`:""}`);
process.exit(failed?1:0);

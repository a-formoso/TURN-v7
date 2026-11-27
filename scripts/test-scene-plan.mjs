/* THE SCENE PLAN (owner 2026-11-22: "a system for scene creation or shot creation ... tackle scenes beat by beat";
   "yes, go with it, end frames per beat"; then: the tracked things "could be turned into props for that scene ...
   we need these props listed in the props tab ... assign them to each character like we have in the character sheet,
   and assign them to their particular scenes ... How do we ensure this happens for every project?").

   Stage 1, writing and code only:
     A. one writing pass plans a whole scene: blocking, the line, a THINGS TRACKER, a camera idea, and the shots, one
        per screenplay moment, each with how it starts, how it ends and how it hands off;
     B. the shots are ordinary shots (a beat's first shot is its opening shot, the later ones its moments) that carry
        those states, and checks in code say what does not join up;
     C. a tracked thing becomes a prop card on request: kept, in its scene, tied to the character who carries it.
   No model call, no image, no saved film here: the pure functions are run on a small made-up scene. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const ai=read("app/ai.jsx"), app=read("app/app.jsx"), ui=read("app/shots-ui.jsx"), shotsSrc=read("app/shots.jsx"), art=read("app/artroom.jsx");
const propsSrc=read("app/props.jsx"), css=read("app/styles.css"), html=read("TURN.html"), pipe=read("docs/Story Pipeline.md"), planSrc=read("app/scene-plan.js");
let pass=0, fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+(process.env.FULL?String(e&&e.stack||e):String(e&&e.message||e).split("\n")[0])); } };

/* the real shots code, with the plan beside it */
const box={console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,isFinite,parseInt,parseFloat,setTimeout,clearTimeout,
  turnContinuity:{},CustomEvent:(type,init)=>({type,detail:init&&init.detail}),dispatchEvent:()=>{}};
box.window=box; box.globalThis=box; vm.createContext(box);
for(const f of ["app/scene-order.js","app/shot-screenplay.js","app/shot-scene-context.js","app/shots.jsx","app/beat-keyframe-merge.js","app/prop-screenplay.js","app/scene-plan.js"])
  vm.runInContext(read(f),box,{filename:f});
const SP=box.ScenePlan;
const plain=v=>JSON.parse(JSON.stringify(v));

/* a small made-up scene: two people, a kitchen and, in beat 3, the terrace outside */
const scene={id:"s5",no:5,title:"The Lunch Box",loc:"INT. HUSSAIN KITCHEN - NIGHT",driver:"amira",
  summary:"Amira packs her brother's lunch and refuses him the car.",openValue:"Trust",openCharge:1,closeValue:"Distance",closeCharge:-1,
  objective:"To keep Yusuf at home.",turningPoint:"He puts the keys down and says he will walk."};
const A=(beat,text)=>({beat,type:"action",text});
const blocks=[{beat:1,type:"scene",text:"INT. HUSSAIN KITCHEN - NIGHT"},
  A(1,"AMIRA HUSSAIN packs rice into a Tupperware at the counter."),
  A(1,"YUSUF HUSSAIN watches from the doorway, car keys in his hand."),
  {beat:1,type:"char",text:"AMIRA"},{beat:1,type:"dia",text:"You are not taking the car."},
  A(2,"Yusuf sets the keys on the counter."),
  {beat:2,type:"char",text:"YUSUF"},{beat:2,type:"dia",text:"Then I will walk."},
  {beat:3,type:"scene",text:"EXT. HUSSAIN TERRACE - DAWN"},
  A(3,"Amira stands at the rail, the Tupperware in her hands.")];
const drafts={s5:{version:1,blocks}};
const characters=[{id:"amira",name:"Amira Hussain"},{id:"yusuf",name:"Yusuf Hussain"}];
const beatsMap={s5:{driverLabel:"Amira",reactorLabel:"Yusuf",obstacle:"He means to leave tonight.",turnAt:2,
  rows:[{n:1,drive:{a:"refuses",d:"Amira refuses the car"},react:{a:"waits",d:"Yusuf waits"}},{n:2,drive:{a:"holds",d:"Amira holds"},react:{a:"yields",d:"Yusuf gives up the keys"}},{n:3,drive:{a:"watches",d:"Amira watches him go"},react:{a:"leaves",d:"Yusuf is gone"}}]}};
const locations=[{id:"loc-kitchen",name:"Hussain Kitchen",intExt:"INT",scenes:["s5"]},{id:"loc-terrace",name:"Hussain Terrace",intExt:"EXT",scenes:["s5"]}];
const props=[{id:"prop-keys",name:"Car keys",kind:"carried",ownerId:"yusuf",ownerName:"Yusuf Hussain",scenes:["s5"]}];
box.turnContinuity={drafts,characters,scenes:[scene],beatsMap,locations,props,sluglineUnits:[]};
const sopts={drafts,characters,beatsMap};
const cast=characters.map(c=>({id:c.id,name:c.name}));
const sets=SP.sets(scene,drafts.s5,{locations,sceneLocation:locations[0]});
const moments={}; [1,2,3].forEach(n=>{ moments[n]=box.shotBeatMoments(scene,n,sopts).length; });
const lines=blocks.filter(b=>b.type==="dia").map(b=>({beat:b.beat,text:b.text}));
// the kitchen has a floor plan with numbers (so its marks may carry an [x, y]); the terrace has none
const planSets=()=>sets.map(st=>({...st,hasPlan:st.id==="set1"}));
const fixed=[{id:"back-door",name:"Back door",set:"set1",kind:"opening"},{id:"worktop",name:"Worktop",set:"set1",kind:"object"}];
const ctx=()=>({beats:[1,2,3],moments,cast,sets:planSets(),fixed,props,lines});

/* what an engine might answer: mostly right, with the usual faults */
const answer=()=>({
  marks:[
    {id:"m-counter",set:"set1",name:"at the counter",near:"the worktop under the window",xy:[1.234,0.5]},
    {id:"m-door",set:"set1",name:"in the doorway",near:"the hall door"},
    {id:"backdoor-spot",set:"INT. HUSSAIN KITCHEN - NIGHT",name:"the back door",near:"back door",xy:[9999,1]},
    {id:"m-rail",set:"set2",name:"at the terrace rail",near:"the rail",xy:[3,4]},
    {id:"m-door",set:"set1",name:"by the fridge"},
    {id:"worktop",set:"set1",name:"on the worktop side"},
    {id:"ghost-mark"}],
  blocking:[
    {beat:1,people:[{id:"amira",where:"m-counter",facing:"the window",pose:"standing"},{id:"Yusuf Hussain",where:"in the doorway",facing:"Amira"},{id:"ghost",where:"m-door"}],note:"He does not come in."},
    {beat:2,people:[{id:"amira",where:"m-counter"},{id:"yusuf",where:"by the sink"}]},
    {beat:3,people:[{id:"amira",where:"m-rail"}]},
    {beat:9,people:[{id:"amira",where:"m-rail"}]}],
  line:{axis:"between Amira at the counter and Yusuf in the doorway",cameraSide:"the window side",note:""},
  things:[
    {key:"tupperware",name:"Tupperware",kind:"prop",carriedBy:"Amira Hussain",propId:"",beats:[{n:1,state:"open on the counter"},{n:2,state:"lid on, on the counter"},{n:3,state:"in Amira's hands"},{n:8,state:"gone"}],why:"The lunch she packs for him and is left holding."},
    {key:"keys",name:"the car keys",kind:"prop",carriedBy:"yusuf",propId:"prop-keys",beats:[{n:1,state:"in Yusuf's hand"},{n:2,state:"on the counter"}],why:"What he gives up."},
    {key:"apron",name:"Amira's apron",kind:"wardrobe",carriedBy:"amira",beats:[{n:1,state:"on"}],why:"She is at work."},
    {key:"kettle",name:"kettle",kind:"set",carriedBy:"nobody-id",propId:"prop-missing",beats:[{n:1,state:"off"},{n:3,state:"on"}],why:"It marks the hour."},
    {kind:"prop",why:"no name"}],
  cameraIdea:"Hold wide while they are apart; close in when the keys go down.",
  shots:[
    {beat:1,moment:1,purpose:"Set the room and the lunch.",size:"wide",angle:"eye level",lens:"32mm",move:"dolly in",cameraPosition:"by the window, looking at the counter",composition:"Amira at the counter, the doorway empty behind her",
      set:"set1",subjects:["Amira Hussain","ghost"],props:["tupperware","lighter"],action:"Amira packs rice.",dialogue:"",
      start:{people:{amira:{where:"m-counter",pose:"standing",holding:[]}},things:{tupperware:{at:"worktop",state:"open"},apron:{worn:"amira"}},doors:[{id:"back-door",open:false}]},
      end:{people:{amira:{where:"m-counter",pose:"standing",holding:[]}},things:{tupperware:{at:"worktop",state:"open"},apron:{worn:"amira"}},doors:[{id:"back-door",open:false}]},
      handoff:{type:"cut",note:""},cameraSide:"same"},
    {beat:1,moment:2,purpose:"Yusuf, and what he holds.",size:"MCU",angle:"ots",lens:"85",move:"static",cameraPosition:"behind Amira's shoulder, on the doorway",composition:"Yusuf framed by the door",
      set:"set1",subjects:["yusuf"],props:["keys"],action:"Yusuf watches.",dialogue:"AMIRA: You're not taking the car!",
      start:{people:{yusuf:{where:"m-door",pose:"leaning",holding:["keys"]}},things:{},doors:[{id:"Back door",open:"shut"}]},
      end:{people:{yusuf:{where:"in the doorway",pose:"leaning",holding:[]}},things:{keys:{heldBy:"yusuf"}},doors:{"back-door":false,"cat flap":true}},
      handoff:{type:"match cut",note:"on his hand"},cameraSide:"same"},
    {beat:2,moment:1,purpose:"The keys go down.",size:"INSERT",angle:"high angle",lens:"50",move:"locked off",cameraPosition:"over the counter",composition:"his hand, the keys, the lunch box",
      set:"set1",subjects:[],props:["keys","tupperware"],action:"Yusuf sets the keys down.",dialogue:"",
      start:{people:{yusuf:{where:"m-counter",pose:"standing",holding:["keys"]}},things:{tupperware:{at:"worktop",state:"lid on"}},doors:[{id:"back-door",open:false}]},
      end:{people:{yusuf:{where:"m-counter",pose:"standing",holding:[]}},things:{keys:{at:"worktop"}},doors:[{id:"back-door",open:false}]},
      handoff:{type:"cut"},cameraSide:"on-line"},
    {beat:2,moment:1,purpose:"His line.",size:"close-up",angle:"eye",lens:"85",move:"static",cameraPosition:"across the counter",composition:"Yusuf, close",
      set:"set1",subjects:["yusuf"],props:[],action:"",dialogue:"Then I'll walk.",
      start:{people:{yusuf:{where:"m-counter",pose:"standing",holding:[]}},things:{keys:{at:"worktop"}}},
      end:{people:{yusuf:{where:"backdoor-spot",pose:"turning away",holding:[]}},things:{keys:{at:"worktop"},tupperware:{in:"keys",at:"nowhere"},kettle:{at:"the moon",state:"on"}},doors:[{id:"back-door",open:true}]},
      handoff:{type:"time cut",note:"It is dawn; he has gone."},cameraSide:"other",crossNote:"We go round to her side as he leaves."},
    {beat:7,moment:1,size:"WS",subjects:["amira"]}]});

test("1 a scene's sets come from its sluglines: an EXT heading inside the scene is another set, with its own location card", ()=>{
  assert.equal(sets.length,2);
  assert.deepEqual(plain(sets.map(s=>[s.id,s.side,s.locationId,s.beats.join()])),[["set1","INT","loc-kitchen","1,2"],["set2","EXT","loc-terrace","3"]]);
  assert.equal(sets[0].heading,"INT. HUSSAIN KITCHEN - NIGHT");
  assert.equal(sets[1].time.toLowerCase(),"dawn");
  // the scene's own slugline worded another way on the page is one set, not two; a heading with no card says so
  const two=SP.sets({...scene,loc:"INT. HUSSAIN HOUSE · NIGHT"},drafts.s5,{locations,sceneLocation:locations[0]});
  assert.equal(two.length,2); assert.equal(two[0].heading,"INT. HUSSAIN KITCHEN - NIGHT");
  const noCard=SP.sets(scene,drafts.s5,{locations:[locations[0]],sceneLocation:locations[0]});
  assert.equal(noCard[1].locationId,""); assert.equal(noCard[0].locationId,"loc-kitchen");
  // the same heading met again is the same set
  const back=SP.sets(scene,{blocks:[...blocks,{beat:4,type:"scene",text:"INT. HUSSAIN KITCHEN - NIGHT"},A(4,"The kitchen, empty.")]},{locations});
  assert.equal(back.length,2); assert.equal(back[0].beats.join(),"1,2,4");
  assert.equal(SP.beatSets(sets,3)[0].id,"set2");
});

test("2 an answer is made safe: unknown ids dropped, marks by id, the app's own camera words, the screenplay's exact lines, one shot per moment", ()=>{
  assert.deepEqual(plain(moments),{1:2,2:1,3:1});
  const out=SP.normalize(answer(),ctx());
  const P=out.plan;
  assert.equal(P.v,2);
  // THE MARKS: an id each (a repeated one is told apart, one that is a fixed object's id is renamed), a set, a name that
  // reads after a person's name; an [x, y] only where the set has a floor plan and the numbers can be a place
  assert.deepEqual(plain(P.marks.map(m=>[m.id,m.set,m.name,m.xy||null])),[["m-counter","set1","at the counter",[1.23,0.5]],["m-door","set1","in the doorway",null],
    ["backdoor-spot","set1","at the back door",null],["m-rail","set2","at the terrace rail",null],["m-door-2","set1","by the fridge",null],["m-worktop","set1","on the worktop side",null]]);
  assert.deepEqual(plain(P.fixed),fixed);
  // blocking: a beat out of range and a person who is not in the cast are dropped; a name resolves to its id; where a
  // person stands is a MARK ID (given by id or by the mark's name), and words that name no mark are emptied and reported
  assert.deepEqual(plain(P.blocking.map(b=>[b.beat,b.people.map(p=>p.id+"@"+p.where).join()])),[[1,"amira@m-counter,yusuf@m-door"],[2,"amira@m-counter,yusuf@"],[3,"amira@m-rail"]]);
  assert.equal(P.blocking[0].people[0].pose,"standing");
  assert.deepEqual(plain(out.dropped.marks),["ghost-mark","by the sink"]);
  // things: no name = dropped; a carrier or a prop card that does not exist is emptied; beats out of range are dropped
  assert.deepEqual(plain(P.things.map(t=>[t.key,t.kind,t.carriedBy,t.propId,t.beats.map(b=>b.n).join()])),
    [["tupperware","prop","amira","","1,2,3"],["keys","prop","yusuf","prop-keys","1,2"],["apron","wardrobe","amira","","1"],["kettle","set","","","1,3"]]);
  // shots: one per moment of each beat, in order
  assert.deepEqual(plain(P.shots.map(s=>[s.beat,s.moment,s.of])),[[1,1,2],[1,2,2],[2,1,1],[3,1,1]]);
  const [a,b,c,d]=P.shots;
  assert.deepEqual([a.size,a.angle,a.lens,a.move],["WS","eye","35","push"]);
  assert.deepEqual([b.size,b.angle,b.lens,b.move],["MCU","ots","85","static"]);
  assert.deepEqual([c.size,c.angle,c.move],["INSERT","high","static"]);
  // people and things that do not exist leave the shot; a thing the tracker does not hold is remembered for the checks
  assert.deepEqual(plain(a.subjects),["amira"]);
  assert.deepEqual(plain(c.subjects),[],"an insert shows nobody: an empty list is an answer");
  assert.deepEqual(plain(a.props),["tupperware"]); assert.deepEqual(plain(a.untracked),["lighter"]);
  // A STATE, BY IDS: a person on a mark; a thing in exactly one place (held, worn, in another thing, at a mark or a
  // fixed object) with a few free words beside it; a door open or shut
  assert.deepEqual(plain(a.start),{people:{amira:{where:"m-counter",pose:"standing",holding:[]}},
    things:{tupperware:{at:"worktop",state:"open"},apron:{worn:"amira"}},doors:[{id:"back-door",open:false}]});
  assert.deepEqual(plain(b.start.doors),[{id:"back-door",open:false}],"a door named by its name, shut said in a word");
  // what is in a hand and where the thing is are one fact: said either way, it is kept both ways
  assert.deepEqual(plain(b.start.things),{keys:{heldBy:"yusuf"}}); assert.deepEqual(plain(b.end.people.yusuf.holding),["keys"]);
  assert.equal(b.end.people.yusuf.where,"m-door","a mark given by its name is its id");
  assert.deepEqual(plain(b.end.doors),[{id:"back-door",open:false}]);
  // one place only (the first that holds), a place that names nothing is dropped and reported, the free words stay
  assert.deepEqual(plain(c.end.things),{keys:{at:"worktop"},tupperware:{in:"keys"},kettle:{state:"on"}});
  assert.deepEqual(plain(out.dropped.places),["kettle"]); assert.deepEqual(plain(out.dropped.doors),["cat flap"]);
  // the line spoken is the screenplay's own, word for word; a speaker's name and a paraphrase never get through
  assert.equal(b.dialogue,"You are not taking the car.");
  assert.equal(SP.snapLine("Then I'll walk.",lines,2),"Then I will walk.");
  assert.equal(SP.snapLine("Give me the money now",lines,2),"");
  // two shots for one moment: the moment keeps the first one's camera and ends where the last one ends
  assert.equal(c.purpose,"The keys go down."); assert.equal(c.end.people.yusuf.where,"backdoor-spot");
  assert.equal(c.handoff.type,"time-cut"); assert.equal(out.dropped.merged,1);
  assert.equal(b.handoff.type,"match"); assert.equal(a.handoff.type,"cut");
  assert.equal(c.cameraSide,"on-line");
  // a beat the answer left out is caught, and gets a plain shot that keeps the state before it
  assert.deepEqual(plain(out.missingBeats),[3]); assert.deepEqual(plain(out.filled),[{beat:3,moment:1}]);
  assert.equal(d.filled,true); assert.equal(d.set,"set2");
  assert.deepEqual(plain(d.start.things),plain(c.end.things)); assert.notEqual(d.start,c.end);
  assert.equal(d.start.people.yusuf.where,"","in another set nobody stands on the last set's marks");
  assert.equal(out.dropped.shots,1); assert.ok(out.dropped.people>=2); assert.equal(out.dropped.things,1);
  // the camera words: what an answer may say, in the app's own
  for(const [v,id] of [["Extreme wide","EWS"],["medium close-up","MCU"],["Medium wide","MWS"],["two shot","MS"],["full shot","FS"],["ECU","ECU"],["nonsense",""]]) assert.equal(SP.sizeId(v),id,v);
  for(const [v,id] of [["Over the shoulder","ots"],["bird's-eye","top"],["low angle","low"],["POV","pov"],["Dutch tilt","dutch"]]) assert.equal(SP.angleId(v),id,v);
  for(const [v,id] of [["handheld","handheld"],["Steadicam follow","steadi"],["pull out","pull"],["tracking","track"],["whip pan","pan"]]) assert.equal(SP.moveId(v),id,v);
  assert.equal(SP.lensId("28"),"24"); assert.equal(SP.lensId("100mm"),"85"); assert.equal(SP.lensId("wide"),"");
  // nothing usable is nothing: no shot, every beat named
  const none=SP.normalize({shots:"no"},ctx());
  assert.deepEqual(plain(none.missingBeats),[1,2,3]); assert.ok(none.plan.shots.every(s=>s.filled)); assert.deepEqual(plain(none.plan.marks),[]);
});

/* the plan's shots through the app's own shot code: normalizeShot, the re-draft's merge, the beat's moments */
const planned=()=>{
  const out=SP.normalize(answer(),ctx());
  const rows=SP.shotRows(out.plan,{missingBeats:out.missingBeats,sets});
  const names=SP.namesOf(out.plan,cast);
  const made=rows.map((r,i)=>({...box.normalizeShot(r,scene,i,locations,props,characters,beatsMap,drafts),order:i}));
  // the scene had shots already: an approved opening shot with a frame's history, and an extra shot on beat 1
  const before=[{id:"old-1",sceneId:"s5",beatN:1,order:0,keyframeMode:"beat-opening",size:"MS",angle:"eye",move:"static",lens:"50",composition:"old",locked:true,approved:true,specRev:3,action:"x",subjects:[]},
    {id:"alt-1",sceneId:"s5",beatN:1,order:0.5,size:"CU",angle:"eye",move:"static",lens:"85",composition:"an extra angle",subjects:[]},
    {id:"other",sceneId:"s9",beatN:1,order:0,keyframeMode:"beat-opening",size:"WS"}];
  const merged=box.mergeBeatKeyframes(before,made);
  const split=box.beatMomentShots(scene,merged.shots,{drafts,characters,beatsMap,props,beats:[1,2,3],stamp:"t"});
  const propIdOf=key=>{ const t=out.plan.things.find(x=>x.key===key); const c=t&&t.kind==="prop"?SP.thingProp(t,props):null; return c?c.id:""; };
  const mine=split.shots.filter(sh=>sh.sceneId==="s5");
  const applied=SP.applyToShots(mine,out.plan,{sets,propIdOf,propKind:id=>(props.find(p=>p.id===id)||{}).kind});
  return {out,rows,made,merged,split,applied,names,shots:box.sceneShotsOrdered(applied.shots)};
};

test("3 the plan's shots are ordinary shots: a beat's first shot is its opening shot, the later ones its moments, and each carries how it starts and ends", ()=>{
  const R=planned();
  // the rows the shot draft takes: one a beat, the later moments as momentSpecs; an unanswered beat says so
  assert.deepEqual(plain(R.rows.map(r=>[r.beat,r.fromModel,r.planned,r.momentSpecs.length,r.locationId||""])),
    [[1,true,true,1,"loc-kitchen"],[2,true,true,0,"loc-kitchen"],[3,false,true,0,"loc-terrace"]]);
  // normalizeShot keeps the plan's own fields, and the planned set's location card
  const m1=R.made[0];
  assert.equal(m1.planned,true); assert.equal(m1.keyframeMode,"beat-opening");
  assert.equal(m1.cameraPosition,"by the window, looking at the counter");
  assert.equal(m1.handoff.type,"cut"); assert.ok(m1.startState&&m1.endState);
  assert.equal(R.made[2].locationId,"loc-terrace"); assert.equal(m1.locationId,"loc-kitchen");
  assert.equal(m1.action,"AMIRA HUSSAIN packs rice into a Tupperware at the counter.","the action is the screenplay's opening");
  // a row that is not planned gets none of them, and a location id it brings is not taken on trust
  const plainShot=box.normalizeShot({beat:1,size:"MS",locationId:"loc-terrace",startState:{people:{}}},scene,0,locations,props,characters,beatsMap,drafts);
  assert.equal(plainShot.planned,undefined); assert.equal(plainShot.startState,undefined); assert.notEqual(plainShot.locationId,"loc-terrace");
  // as a re-draft: the opening shot keeps its ID, its approval goes where the shot changed, the extra shot is archived
  assert.deepEqual(plain(R.merged.archived.map(s=>s.id)),["alt-1"]);
  const s=R.shots;
  assert.deepEqual(plain(s.map(x=>[x.beatN,x.keyframeMode,x.moment?x.moment.n+"/"+x.moment.of:""])),
    [[1,"beat-opening","1/2"],[1,"moment","2/2"],[2,"beat-opening",""],[3,"beat-opening",""]]);
  assert.equal(s[0].id,"old-1"); assert.equal(s[0].locked,false); assert.equal(s[0].specRev,4);
  assert.ok(s.every(x=>x.planned));
  // the moment shot took its camera from the plan (the momentSpecs road) and its states from the plan's second shot
  assert.deepEqual([s[1].size,s[1].angle,s[1].lens],["MCU","ots","85"]);
  assert.equal(s[1].purpose,"Yusuf, and what he holds.");
  assert.deepEqual(plain(s[1].startState.people.yusuf),{where:"m-door",pose:"leaning",holding:["keys"]});
  assert.equal(s[1].handoff.type,"match");
  // WHO IS IN FRAME is the plan's own answer for each shot, never the beat's whole cast; an empty list is an answer
  const byId=Object.fromEntries(characters.map(c=>[c.id,c]));
  assert.deepEqual(plain(box.shotScreenplayFor(scene,s[1],sopts).openingCharacterIds).sort(),["amira","yusuf"],"the screenplay has both in the room for this moment");
  assert.deepEqual(plain(s[1].subjects),["yusuf"]); assert.equal(s[1].subjectsByPlan,true);
  assert.deepEqual(plain(box.inFrameCast(s[1],scene,characters,{drafts,charById:byId,beatsMap})),["yusuf"],"the card, the references and the prompt read the plan's one");
  assert.deepEqual(plain(box.inFrameCast(s[1],scene,characters)),["yusuf"]);
  assert.deepEqual(plain(s[2].subjects),[]); assert.deepEqual(plain(box.inFrameCast(s[2],scene,characters,{drafts,charById:byId,beatsMap})),[],"the insert of the keys shows nobody");
  assert.ok(box.shotScreenplayFor(scene,s[2],sopts).openingCharacterIds.includes("yusuf"),"though the screenplay has Yusuf there");
  assert.ok(/Exactly 1 person in frame/.test(box.buildShotPrompt(s[1],{scene,location:null,project:{id:"f"},charById:byId,propById:{},drafts,scenes:[scene]})));
  // it is not a pick made by hand (a re-draft does not warn about it), and a pick made by hand on the card still wins
  assert.equal(s[1].referenceCharactersSet,true); assert.equal(s[1].referenceCharactersAuto,true); assert.deepEqual(plain(s[1].referenceCharacterIds),["yusuf"]);
  assert.deepEqual(plain(box.inFrameCast({...s[1],referenceCharactersAuto:false,referenceCharacterIds:["amira"]},scene,characters,{drafts,charById:byId,beatsMap})),["amira"]);
  // a shot the plan did not write keeps the screenplay's people; a person only heard is never in frame
  assert.equal(s[3].subjectsByPlan,undefined); assert.deepEqual(plain(box.inFrameCast(s[3],scene,characters,{drafts,charById:byId,beatsMap})),["amira"]);
  assert.deepEqual(plain(box.inFrameCast({...s[1],subjects:["yusuf","nobody"]},scene,characters,{drafts,charById:byId,beatsMap})),["yusuf"]);
  assert.ok(shotsSrc.includes("if(sh && sh.subjectsByPlan && Array.isArray(sh.subjects) && !(sh.referenceCharactersSet && !sh.referenceCharactersAuto)){"));
  // the reading is kept for a shot while nothing it is read from changes, and read again when something does
  const again={...s[1]};
  assert.deepEqual(plain(box.inFrameCast(again,scene,characters)),["yusuf"]); again.subjects=["amira"];
  assert.deepEqual(plain(box.inFrameCast(again,scene,characters)),["amira"],"the same shot object, changed: read again");
  // a thing in frame that is a prop card: its sheet is named on the shot, so the frame's own code attaches it
  assert.deepEqual(plain(s[1].referencePropIds),["prop-keys"]); assert.deepEqual(plain(s[1].planThings),["keys"]);
  assert.ok(box.inFrameProps(s[1],scene,Object.fromEntries(characters.map(c=>[c.id,c])),{"prop-keys":props[0]},{drafts}).includes("prop-keys"));
  assert.deepEqual(plain(s[0].planThings),["tupperware"]); assert.equal((s[0].referencePropIds||[]).length,0,"no card yet for the Tupperware");
  assert.equal(s[2].lineSide,"on-line"); assert.equal(s[2].handoff.type,"time-cut");
  assert.equal(s[3].locationId,"loc-terrace"); assert.equal(s[3].planSet,"set2"); assert.equal(s[3].planFilled,true);
  // none of the plan's own fields is part of a frame's fingerprint (stage 1 changes no image)
  const fp=box.shotSpecFingerprint;
  assert.equal(fp({...s[1],startState:{},endState:{},handoff:{type:"cut"},cameraPosition:"elsewhere",planThings:[],lineSide:"other",referencePropIds:[]}),fp(s[1]));
  // a beat joined by hand stays one shot: it starts where its first moment starts and ends where its last one ends
  const joined=SP.applyToShots([{id:"j",sceneId:"s5",beatN:1,keyframeMode:"beat-opening",momentsJoined:true}],R.out.plan,{sets}).shots[0];
  assert.deepEqual(plain(Object.keys(joined.startState.people)),["amira"]); assert.deepEqual(plain(Object.keys(joined.endState.people)),["yusuf"]);
  assert.deepEqual(plain(joined.planThings),["tupperware","keys"]); assert.deepEqual(plain(joined.subjects),["amira"]);
  // a shot drafted again without a plan drops the plan's words (they would be about another shot)
  const un=SP.unplan(s[1]);
  for(const k of SP.PLAN_FIELDS) assert.equal(un[k],undefined,k);
  assert.equal(un.size,"MCU"); assert.equal(SP.unplan(plainShot),plainShot);
  assert.ok(app.includes('if(redone.size) merged.shots=merged.shots.map(sh=>redone.has(sh.id) ? window.ScenePlan.unplan(sh) : sh);'));
  // a shot's states read as a sentence: the mark's name, the fixed object's name, the people's names, never an id
  assert.equal(SP.stateText(s[1].startState,R.names),"Yusuf Hussain in the doorway, leaning, holding the car keys. Doors: the back door shut.");
  assert.equal(SP.stateText(s[0].startState,R.names),"Amira Hussain at the counter, standing. Tupperware: at the worktop, open. Amira's apron: worn by Amira Hussain. Doors: the back door shut.");
  assert.equal(SP.stateText(s[2].endState,R.names),"Yusuf Hussain at the back door, turning away. The car keys: at the worktop. Tupperware: in the car keys. Kettle: on. Doors: the back door open.");
  // a plan made before marks still reads (its words are what it has)
  assert.equal(SP.stateText({people:{yusuf:{where:"in the doorway",pose:"leaning",holding:["keys"]}},things:{tupperware:"open on the counter"},doors:"back door shut"},R.names),
    "Yusuf Hussain in the doorway, leaning, holding the car keys. Tupperware: open on the counter. Doors: back door shut.");
  assert.equal(SP.handoffText(s[1].handoff),"Match cut: on his hand"); assert.equal(SP.handoffText({type:"cut"}),"Cut");
});

/* each check, on a scene small enough to read */
const P0=()=>({v:2,
  marks:[{id:"m-counter",set:"set1",name:"at the counter"},{id:"m-door",set:"set1",name:"in the doorway"},{id:"m-window",set:"set1",name:"by the window"},{id:"m-rail",set:"set2",name:"at the rail"}],
  fixed:[{id:"back-door",name:"Back door",set:"set1",kind:"opening"},{id:"shelf",name:"Shelf",set:"set1",kind:"object"}],
  blocking:[{beat:1,people:[{id:"amira",where:"m-counter"},{id:"yusuf",where:"m-door"}]},{beat:2,people:[{id:"amira",where:"m-counter"},{id:"yusuf",where:"m-counter"}]},{beat:3,people:[{id:"amira",where:"m-rail"}]}],
  line:{axis:"counter to doorway",cameraSide:"window side"},
  things:[{key:"mug",name:"mug",kind:"prop",carriedBy:"yusuf",propId:"",beats:[]},{key:"keys",name:"the car keys",kind:"prop",carriedBy:"yusuf",propId:"prop-keys",beats:[]},
    {key:"shoes",name:"shoes",kind:"wardrobe",carriedBy:"yusuf",beats:[]},{key:"bag",name:"evidence bag",kind:"prop",carriedBy:"yusuf",propId:"prop-bag",beats:[]},{key:"apron",name:"apron",kind:"wardrobe",carriedBy:"amira",beats:[]}]});
const st=(people,things,doors)=>({people:people||{},things:things||{},doors:doors||[]});
const at=(where,holding,pose)=>({where,pose:pose||"",holding:holding||[]});
const sh=(beat,moment,o)=>({beat,moment,set:beat===3?"set2":"set1",subjects:["yusuf"],props:[],untracked:[],start:st(),end:st(),handoff:{type:"cut",note:""},cameraSide:"same",crossNote:"",...o});
const cards=[...props,{id:"prop-mug",name:"Mug"},{id:"prop-bag",name:"Evidence bag"}];
const run=(shots,plan,extra)=>plain(SP.checks(plan||P0(),shots,{beats:[1,2,3],sets,cast,props:cards,...(extra||{})}));
const texts=list=>list.map(c=>c.text);
const ok=[sh(1,1),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"]})];
const rest=[sh(2,1),sh(3,1,{subjects:["amira"]})];

test("4 checks compare ids: another mark, another holder or place, a door the other way is a fix; other words for the same thing are not", ()=>{
  assert.deepEqual(run(ok),[]);
  // THE FALSE ALARMS OF THE FIRST REAL PLAN: the same mark and the same hand, said in other words, are the same
  assert.deepEqual(run([sh(1,1,{end:st({yusuf:at("m-door",["bag"],"facing Pike")},{bag:{heldBy:"yusuf",state:"clear"}})}),
    sh(1,2,{start:st({yusuf:at("m-door",["bag"],"in the hall, by the key hooks")},{bag:{heldBy:"yusuf",state:"clear"}})}),...rest]),[]);
  // a few free words that differ are a NOTE (shown, not counted as work): "clear" against "sealed, hanging"
  const worded=run([sh(1,1,{end:st({yusuf:at("m-door",["bag"])},{bag:{heldBy:"yusuf",state:"clear"}})}),sh(1,2,{start:st({yusuf:at("m-door",["bag"])},{bag:{heldBy:"yusuf",state:"sealed, hanging"}})}),...rest]);
  assert.deepEqual(worded.map(c=>[c.level,c.text]),[["note","Shot 1 ends with the evidence bag clear; shot 2 starts with it sealed, hanging."]]);
  // THE REAL ONES. A person on another mark:
  const moved=run([sh(1,1,{end:st({yusuf:at("m-door")})}),sh(1,2,{start:st({yusuf:at("m-window")})}),...rest]);
  assert.deepEqual(moved.map(c=>[c.level,c.shot,c.text]),[["fix",1,"Shot 1 ends with Yusuf Hussain in the doorway; shot 2 starts with Yusuf Hussain by the window."]]);
  // a thing in another place: on the shelf, then in a hand; from one hand to another, across a beat; in a hand, then worn
  assert.deepEqual(texts(run([sh(1,1,{end:st({},{mug:{at:"shelf"}})}),sh(1,2,{start:st({yusuf:at("m-door",["mug"])},{mug:{heldBy:"yusuf"}})}),...rest])),
    ["Shot 1 ends with the mug at the shelf; shot 2 starts with it in Yusuf Hussain’s hand."]);
  assert.deepEqual(texts(run([sh(1,1),sh(1,2,{end:st({yusuf:at("m-counter",["mug"])},{mug:{heldBy:"yusuf"}})}),
    sh(2,1,{subjects:["amira"],start:st({amira:at("m-counter",["mug"])},{mug:{heldBy:"amira"}})}),sh(3,1,{subjects:["amira"]})])),
    ["Shot 2 ends with the mug in Yusuf Hussain’s hand; shot 3 starts with it in Amira Hussain’s hand."]);
  assert.deepEqual(texts(run([sh(1,1,{end:st({yusuf:at("m-door",["shoes"])},{shoes:{heldBy:"yusuf"}})}),sh(1,2,{start:st({yusuf:at("m-door")},{shoes:{worn:"yusuf"}})}),...rest])),
    ["Shot 1 ends with the shoes in Yusuf Hussain’s hand; shot 2 starts with it worn by Yusuf Hussain."]);
  assert.deepEqual(texts(run([sh(1,1,{end:st({},{mug:{at:"m-counter"}})}),sh(1,2,{start:st({},{mug:{in:"bag"}})}),...rest])),
    ["Shot 1 ends with the mug at the counter; shot 2 starts with it in the evidence bag."]);
  // a door the other way
  assert.deepEqual(texts(run([sh(1,1,{end:st({},{},[{id:"back-door",open:true}])}),sh(1,2,{start:st({},{},[{id:"back-door",open:false}])}),...rest])),
    ["Shot 1 ends with the back door open; shot 2 starts with it shut."]);
  // a time cut that says what changed is not checked; one that says nothing is asked to; a plain cut over the same change is a fix
  const cut=o=>[sh(1,1),sh(1,2),sh(2,1,{end:st({yusuf:at("m-counter")},{mug:{at:"shelf"}},[{id:"back-door",open:true}]),handoff:o}),
    sh(3,1,{subjects:["amira"],start:st({amira:at("m-rail",["mug"])},{mug:{heldBy:"amira"}},[{id:"back-door",open:false}])})];
  assert.deepEqual(run(cut({type:"time-cut",note:"It is dawn; she has picked it up."})),[]);
  assert.deepEqual(run(cut({type:"time-cut",note:""})).map(c=>[c.level,c.text]),[["fix","Shot 3 ends on a time cut that does not say what changed."]]);
  assert.deepEqual(run(cut({type:"cut",note:""})).map(c=>c.level),["fix","fix"],"the thing and the door; nobody is in both shots");
  // what one shot does not say about a person or a thing is not a contradiction; a person on no mark is a note, not a gap
  assert.deepEqual(run([sh(1,1,{end:st({yusuf:at("m-door")},{mug:{at:"shelf"}})}),sh(1,2,{start:st({yusuf:at("",[],"leaning")},{mug:{state:"full"}})}),...rest]).map(c=>[c.level,c.text]),
    [["note","Shot 2 does not say which mark Yusuf Hussain is on."]]);
  // A PLAN MADE BEFORE MARKS (the one saved before this change) still checks, by its words; each row is a NOTE, never a
  // fix, and the list says how to get exact checks
  const old={...P0(),v:1,marks:undefined,fixed:undefined};
  const o1=st({yusuf:{where:"at the key hooks, facing Pike",holding:["bag"]}},{mug:"on the shelf"},"back door shut");
  const o2=st({yusuf:{where:"hall by the key hooks",holding:[]}},{mug:"in his other hand, lifted",bag:"sealed, hanging in Pike's hand"},"back door open");
  const was=run([sh(1,1,{end:o1}),sh(1,2,{start:o2}),sh(2,1,{start:st({},{},""),end:st({},{},"")}),sh(3,1,{subjects:["amira"]})],old);
  assert.ok(was.length>=3); assert.ok(was.every(c=>c.level==="note"),"an old plan's rows are notes");
  assert.equal(was[0].text,SP.OLD_PLAN_NOTE); assert.match(was[0].text,/Plan again to get exact checks\.$/);
  assert.ok(texts(was).includes("Shot 1 ends with the doors like this: back door shut. Shot 2 starts with: back door open."));
  assert.equal(SP.exact(old),false); assert.equal(SP.exact(P0()),true); assert.equal(SP.exact(null),false);
  assert.deepEqual(run([sh(1,1),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"]})],old),[],"an old plan with nothing to say says nothing");
});

test("5 checks: the right set, people placed and in frame, the line, a beat with no shot, an untracked thing, things with no prop card", ()=>{
  // a shot of the EXT beat set in the kitchen: another location
  assert.deepEqual(texts(run([sh(1,1),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"],set:"set1"})])),
    ["Shot 4 is set at INT. HUSSAIN KITCHEN - NIGHT, but beat 3 plays at EXT. HUSSAIN TERRACE - DAWN."]);
  assert.deepEqual(texts(run([sh(1,1),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"],set:"set9"})])),["Shot 4 names no set of this scene."]);
  // a person put on a mark of another set
  assert.deepEqual(texts(run([sh(1,1),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"],start:st({amira:at("m-counter")})})])),
    ["Shot 4 is set at EXT. HUSSAIN TERRACE - DAWN, but it puts Amira Hussain at the counter, a mark of INT. HUSSAIN KITCHEN - NIGHT."]);
  // a saved shot of the EXT set that points at the interior's location card
  const saved=(id,beatN,o)=>({id,sceneId:"s5",beatN,keyframeMode:"beat-opening",planned:true,subjects:["amira"],startState:st(),endState:st(),handoff:{type:"cut",note:""},planSet:beatN===3?"set2":"set1",planThings:[],...o});
  const wrong=run([saved("a",1),saved("b",2),saved("c",3,{locationId:"loc-kitchen"})]);
  assert.deepEqual(texts(wrong),["Shot 3 plays at EXT. HUSSAIN TERRACE - DAWN, but it points at the location card of INT. HUSSAIN KITCHEN - NIGHT: another location."]);
  assert.equal(wrong[0].shot,"c","a saved shot is named by its id, so the row can go to its card");
  // a set with no location card is a note, said once
  const bare=SP.sets(scene,drafts.s5,{locations:[locations[0]],sceneLocation:locations[0]});
  const noted=plain(SP.checks(P0(),ok,{beats:[1,2,3],sets:bare,cast,props:cards}));
  assert.deepEqual(noted.map(c=>[c.level,c.text]),[["note","EXT. HUSSAIN TERRACE - DAWN has no location card yet, so its shots have no location image to follow."]]);
  // a person in frame the beat's blocking does not place
  assert.deepEqual(texts(run([sh(1,1),sh(1,2),sh(2,1),sh(3,1)])),["Shot 4 shows Yusuf Hussain, but the blocking for beat 3 does not place Yusuf Hussain."]);
  // someone holding something who is not listed in frame
  assert.deepEqual(texts(run([sh(1,1,{subjects:["amira"],start:st({yusuf:at("m-door",["keys"])})}),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"]})])),
    ["Shot 1 has Yusuf Hussain holding the car keys, but Yusuf Hussain is not listed in frame."]);
  // the line crossed with no reason; with one, nothing
  assert.deepEqual(texts(run([sh(1,1),sh(1,2,{cameraSide:"other"}),sh(2,1),sh(3,1,{subjects:["amira"]})])),["Shot 2 crosses the line and does not say why."]);
  assert.deepEqual(run([sh(1,1),sh(1,2,{cameraSide:"other",crossNote:"He walks round her."}),sh(2,1),sh(3,1,{subjects:["amira"]})]),[]);
  // a beat with no shot; a moment the plan left out
  assert.deepEqual(texts(run([sh(1,1),sh(1,2),sh(3,1,{subjects:["amira"]})])),["Beat 2 has no shot."]);
  assert.match(run([sh(1,1),sh(1,2),sh(2,1,{filled:true}),sh(3,1,{subjects:["amira"]})])[0].text,/^Shot 3 \(beat 2\) was not planned: it is a plain shot/);
  // a thing a shot shows that the tracker does not hold
  assert.deepEqual(texts(run([sh(1,1,{untracked:["lighter"]}),sh(1,2),sh(2,1),sh(3,1,{subjects:["amira"]})])),["Shot 1 shows the lighter, which is not in the things tracker."]);
  // EVERY PROJECT: while a tracked object has no prop card, the checks say how many (wardrobe is not counted)
  const missing=plain(SP.checks(P0(),ok,{beats:[1,2,3],sets,cast,props}));
  assert.deepEqual(missing.map(c=>[c.level,c.kind,c.text]),[["fix","props","2 things in this scene have no prop card: mug, evidence bag."]]);
  assert.deepEqual(plain(SP.checks(P0(),ok,{beats:[1,2,3],sets,cast,props:[]})).map(c=>c.text),["3 things in this scene have no prop card: mug, the car keys, evidence bag."]);
  // a shot drafted after the plan is named, never checked as if the plan had written it
  const later=run([saved("a",1),{id:"b",sceneId:"s5",beatN:2,keyframeMode:"beat-opening",subjects:["yusuf"]},saved("c",3)]);
  assert.deepEqual(later.map(c=>[c.level,c.shot]),[["note","b"]]); assert.match(later[0].text,/^Shot 2 \(beat 2\) was drafted after this plan/);
  // the whole run on the answer of test 2: what it finds is what is wrong with that answer, and nothing else
  const R=planned();
  const found=plain(SP.checks(R.out.plan,R.shots,{beats:[1,2,3],sets,cast,props}));
  assert.deepEqual(found.map(c=>[c.level,c.text]),[
    ["fix","Shot 4 (beat 3) was not planned: it is a plain shot that keeps the shot before it. Plan again, or set it by hand."],
    ["fix","Shot 2 ends with Yusuf Hussain in the doorway; shot 3 starts with Yusuf Hussain at the counter."],
    ["fix","Shot 3 has Yusuf Hussain holding the car keys, but Yusuf Hussain is not listed in frame."],
    ["fix","Shot 1 shows the lighter, which is not in the things tracker."],
    ["fix","1 thing in this scene has no prop card: Tupperware."]]);
  assert.ok(shotsSrc.includes("window.normalizeShot = normalizeShot;")&&planSrc.includes("root.scenePlanChecks=checks;"));
});

test("6 a tracked thing is a prop card it already is, or becomes one: kept, in its scene, tied to the character who carries it", ()=>{
  const out=SP.normalize(answer(),ctx());
  const [tup,keys,apron]=out.plan.things;
  // matched to a card: by its id, by its name, by another name of the card, or by its one word when its carrier owns the card
  assert.equal(SP.thingProp(keys,props).id,"prop-keys");
  assert.equal(SP.thingProp({name:"The car keys",kind:"prop"},props).id,"prop-keys");
  assert.equal(SP.thingProp({name:"key ring",kind:"prop"},[{id:"p",name:"Car keys",aliases:["Key ring"]}]).id,"p");
  assert.equal(SP.thingProp({name:"keys",kind:"prop",carriedBy:"yusuf"},props).id,"prop-keys");
  assert.equal(SP.thingProp({name:"keys",kind:"prop",carriedBy:"amira"},props),null,"one word is not enough for someone else's card");
  assert.equal(SP.thingProp({name:"phone",kind:"prop",carriedBy:"yusuf"},[{id:"a",name:"Yusuf's phone",ownerId:"yusuf"},{id:"b",name:"Work phone",ownerId:"yusuf"}]),null,"two cards answer: none is taken");
  assert.equal(SP.thingProp(tup,props),null);
  // a new card: an ordinary prop, in the scene, with its carrier as owner, and marked as coming from the plan
  const card=plain(SP.thingCard(tup,scene,characters[0],{stamp:"t1",now:"2026-11-22T10:00:00.000Z"}));
  assert.equal(card.id,"prop-plan-tupperware-t1"); assert.equal(card.name,"Tupperware"); assert.equal(card.kind,"carried");
  assert.deepEqual(card.scenes,["s5"]); assert.equal(card.ownerId,"amira"); assert.equal(card.ownerName,"Amira Hussain");
  assert.deepEqual(card.origin,{kind:"scene-plan",sceneId:"s5",sceneNo:5,thingKey:"tupperware",characterId:"amira",characterName:"Amira Hussain"});
  assert.match(card.detail,/^The lunch she packs for him and is left holding\. In scene 5: Beat 1: open on the counter; Beat 2: lid on, on the counter; Beat 3: in Amira's hands$/);
  assert.equal(card.form,""); assert.equal(card.material,"","adding writes no design: the card's own Draft does that later");
  // KEPT: the same marks 'Keep this prop' sets, so the app counts it as a story prop and a batch may work on it
  assert.deepEqual([card.keptAsProp,card.proposalAccepted,card.inventoryGroup],[true,true,"story"]);
  const PS=box.PropScreenplay;
  assert.deepEqual(Object.keys(PS.acceptPatch()).sort(),["inventoryGroup","keptAsProp","proposalAccepted","proposalAcceptedAt"]);
  assert.equal(PS.storyChoice(card),true); assert.equal(PS.isStoryProp(card,drafts),true); assert.equal(PS.batchSkip(card),false);
  // a later screenplay read never removes it: the read only adds to and merges into the cards there are
  assert.ok(PS.accept([card],[],drafts).some(p=>p.id===card.id));
  // its scene stays its scene: the scene map is rewritten only for cards read from the screenplay, worn ones and word matches
  assert.ok(app.includes('(Array.isArray(p.screenplaySources)||p.kind==="worn"||p.sceneMapBasis==="lexical"));'));
  assert.equal(card.screenplaySources,undefined); assert.equal(card.sceneMapBasis,undefined);
  assert.ok(box.propsForScene([card],"s5").length===1&&box.propsForScene([card],"s9").length===0);
  // tied to its character as the character card ties an item to its prop card: the item, by the card's name, in their carried list
  assert.equal(SP.ownerItems("phone, house keys","Tupperware"),"phone, house keys, Tupperware");
  assert.equal(SP.ownerItems("","Tupperware"),"Tupperware"); assert.equal(SP.ownerItems("none","Tupperware"),"Tupperware");
  assert.equal(SP.ownerItems("phone; a bag (old, torn)","Tupperware"),"phone; a bag (old, torn); Tupperware");
  assert.equal(SP.ownerItems("phone, tupperware","Tupperware"),null,"already listed: nothing to add");
  assert.ok(art.includes('...split(c.props).map(t=>({ t, src:"carried" }))')&&art.includes('const exact = byNorm[normName(b.t)];'),"the character card links an item to the card of that name");
  // the label the Props tab shows for it
  assert.equal(SP.originLabel(card),"From the scene plan · Sc 05"); assert.equal(SP.originLabel({origin:{kind:"manual"}}),"");
  assert.ok(propsSrc.includes('if(o.kind==="scene-plan") return (window.ScenePlan && window.ScenePlan.originLabel(p)) || "From the scene plan";'));
  // the planned shots that show the thing take its sheet, and no other shot does
  const R=planned();
  const linked=SP.linkPropToShots(R.shots,"tupperware",card.id);
  assert.equal(linked.linked,2);
  assert.deepEqual(plain(linked.shots.map(s=>(s.referencePropIds||[]).join())),["prop-plan-tupperware-t1","prop-keys","prop-keys,prop-plan-tupperware-t1",""]);
  assert.equal(SP.linkPropToShots(linked.shots,"tupperware",card.id).linked,0,"a second press changes nothing");
  assert.equal(box.shotSpecFingerprint(linked.shots[0]),box.shotSpecFingerprint(R.shots[0]),"a reference is not part of the shot's fingerprint");
  // planning again: a card made since is on the shots, and a sheet only the old plan asked for is taken off
  const again=SP.applyToShots(linked.shots,R.out.plan,{sets,propIdOf:k=>k==="keys"?"prop-keys":"",propKind:()=>"carried"});
  assert.deepEqual(plain(again.shots[0].referencePropIds),[]);
  // a worn card is never forced onto a shot (its owner's sheet wears it)
  const worn=SP.applyToShots(R.shots,R.out.plan,{sets,propIdOf:k=>k==="keys"?"prop-keys":"",propKind:()=>"worn"});
  assert.deepEqual(plain(worn.shots[1].planPropIds),[]);
  // wardrobe and parts of the set are tracked, never offered as props
  assert.equal(apron.kind,"wardrobe");
  assert.ok(ui.includes('t.kind!=="prop" ? _el("span",{className:"ssx-plan-card"},t.kind==="wardrobe" ? "Wardrobe" : "Part of the set")'));
  // the app's own road: an ordinary card through setProps, the owner through updateCharacter, the plan and the shots told
  const fn=app.slice(app.indexOf("const addScenePlanProps = (scene, keys)=>{"),app.indexOf("const [draftingAllShots, setDraftingAllShots]"));
  for(const t of ['if(!scene || !SP || !canMutateSharedFilm()) return 0;','t.kind==="prop" && (!want || want.has(t.key)) && !SP.thingProp(t, live)',
    'const card = SP.thingCard(t, scene, owner, { stamp:stamp+i });','cards.push(withEpisodeSceneRefs(card, card.scenes, scenesRef.current||scenes)); links[t.key] = card.id;',
    'setProps(ps=>[...ps, ...cards.filter(c=>!ps.some(x=>x.id===c.id))]);','if(list!==c.props) updateCharacter(cid, { props:list });',
    'things:(cur.things||[]).map(t=>links[t.key] ? { ...t, propId:links[t.key] } : t)','out = SP.linkPropToShots([out], key, links[key]).shots[0];','if(!sh || sh.sceneId!==scene.id) return sh;'])
    assert.ok(fn.includes(t),"addScenePlanProps has "+t);
  assert.ok(!/aiPropVisuals|aiDesignPropBible|nbGenerate|proxyGenerate|window\.claude/.test(fn),"adding a card drafts and draws nothing");
});

test("7 the scene plan runs on Fable 5.2 by default; a pick wins; a trial stays on its lightest engine", ()=>{
  assert.ok(ai.includes('WRITING_TASK_DEFAULTS.scenePlan = "claude-fable-5-2";'));
  const from=ai.indexOf("const WRITING_TASK_DEFAULTS"),to=ai.indexOf("window.TURN_FREE_TIER_WRITING_MODEL");
  const b={window:{}}; vm.createContext(b);
  vm.runInContext('const WRITING_MODELS=[{id:"claude-opus-5-5"},{id:"claude-fable-5-2"},{id:"gemini-3.8-flash"}];'+ai.slice(from,to)
    +';let _writingPick=null;function getWritingModelId(task){ if(_writingPick && WRITING_MODELS.find(m=>m.id===_writingPick)) return _writingPick; return recommendedWritingModelId(task); }'
    +';globalThis.rec=recommendedWritingModelId;globalThis.get=getWritingModelId;globalThis.pick=id=>{_writingPick=id;};',b);
  assert.equal(b.rec("scenePlan"),"claude-fable-5-2");
  assert.equal(b.rec("specs"),"claude-opus-5-5"); assert.equal(b.rec("locations"),"claude-fable-5-2");
  b.pick("claude-opus-5-5"); assert.equal(b.get("scenePlan"),"claude-opus-5-5"); b.pick(null);
  b.window.turnOnFreeTier=()=>true;
  assert.equal(b.rec("scenePlan"),"gemini-3.8-flash");
  // the call itself runs under that task (one place makes every call), and what it asks for is checked in code
  assert.ok(ai.includes('["aiPlanScene","aiPlanCameras","aiBeatFrames"].forEach(n=>{ const fn = window[n];\n  if(typeof fn === "function") window[n] = (...a)=> window.turnWithWritingTask("scenePlan", ()=> fn(...a)); });'));
  const fn=ai.slice(ai.indexOf("async function aiPlanScene("),ai.indexOf("window.aiPlanScene = aiPlanScene;"));
  assert.equal((fn.match(/window\.claude\.complete\(/g)||[]).length,1);
  assert.ok(fn.includes("const out = SP.normalize(scrubbed, { beats:beatNos, moments:momentCount, cast:cast.map(c=>({ id:c.id, name:c.name })), sets, fixed, props:propCards, lines });"));
  for(const t of ["Value turn: ","Driver: ","Reactor: ","Turning point","CAST PRESENT (use these ids exactly)","SETS IN THIS SCENE","PROP CARDS (","BEAT TABLE","SCREENPLAY \\u2014 THE WHOLE SCENE, BY BEAT AND MOMENT",
    "EXACTLY ONE shot for each MOMENT of each beat","A shot's end state is the next shot's start state, across beats too","A moment under an EXT heading plays in that EXT set and on that set's marks, never in the interior","A person's where is always a mark id",
    "1. marks: the named standing places this scene uses in each set","EXACTLY ONE place: heldBy (a cast id), or at (a mark id, or the id of a fixed object of the set), or worn (a cast id), or in (another thing's key)",
    "doors, a list of {id, open}","the people actually IN THIS FRAME as the shot opens: nobody for an insert or an empty street, never the whole room for a close-up",
    "Just before this scene","The next scene opens at: "]) assert.ok(fn.includes(t),"the brief has "+t);
  // nothing in what the engine is told names a vendor or a method's author
  assert.ok(!/Anthropic|Claude|OpenAI|Gemini|GPT|McKee|Fable|Opus/.test(fn.replace(/claude\.complete/g,"")));
  // the engine shown is its label in the engine list, never a literal
  assert.ok(app.includes('const engine = (typeof window.writingModelInfo==="function" && window.writingModelInfo("scenePlan").label) || "";'));
  assert.ok(!/Fable|Opus/.test(ui.slice(ui.indexOf("function ShotPlanLines("),ui.indexOf("function SceneShotGroup("))));
  assert.ok(!/Fable|Opus|Claude/.test(planSrc.replace(/owner 2026[^\n]*/g,"")));
});

test("8 it asks first, says what it replaces as Re-draft does, shows its progress where it was pressed, and a failure changes nothing", ()=>{
  const q=SP.confirmText({sceneNo:5,engine:"Engine X",hasShots:true,replaces:" It replaces 1 approved frame (unapproved where the shot changes)."});
  assert.equal(q.title,"Plan Scene 05 (writing credits)?"); assert.equal(q.confirmLabel,"Plan this scene"); assert.equal(q.cancelLabel,"Cancel");
  assert.match(q.body,/^Reads the whole scene, then every beat, and writes: where each person stands, the side the camera keeps to, a tracker of every prop, what people wear and each door, and the shots, each with how it starts and how it ends\. A few short writing passes on Engine X \(the staging, then the shots a few beats at a time, then each shot's camera on the floor plan\); no image is made\./);
  assert.match(q.body,/It replaces this scene's drafted shots as Re-draft does: each beat's opening shot keeps its ID and its images, changed frames need making again, and extra shots move to Recently deleted, where you can restore them\. It replaces 1 approved frame/);
  const first=SP.confirmText({sceneNo:12,engine:"",hasShots:false});
  assert.ok(!/replaces/.test(first.body)&&/A few short writing passes \(the staging, then the shots a few beats at a time, then each shot's camera on the floor plan\); no image is made\./.test(first.body));
  assert.equal(SP.confirmText({sceneNo:5,again:true,hasShots:true}).title,"Plan Scene 05 again (writing credits)?");
  // the run: the question before the call, the same road as Re-draft for the shots, the plan saved with the film
  const fn=app.slice(app.indexOf("const planSceneShots = async (scene, opts)=>{"),app.indexOf("const addScenePlanProps = (scene, keys)=>{"));
  const order=['const q = SP.confirmText({ sceneNo:scene.no, engine, hasShots:live.length>0, replaces:redraftReplaces(live), again:had });',
    'ok = typeof window.appConfirm==="function" ? await window.appConfirm(q)','if(!ok) return;','setPlanningScene({ id:scene.id, since:Date.now(), est:SP.estimateSeconds(beatRows.length), engine, text:"Planning Scene "+no+"\\u2026" });',
    'const res = await window.aiPlanScene(scene,','assertCurrent();\n      if(typeof normalizeShot','const k = keepUnansweredBeats(scene, rows, made); made = k.made;','if(made.length) commitBeatKeyframes(made, assertCurrent);',
    'const applied = SP.applyToShots(','shotsLiveRef.current = next; setShots(next);','return { ...p, scenePlans:{ ...((p && p.scenePlans)||{}), [scene.id]:Object.keys(mine).length ? { ...doc, cameras:mine } : doc } }; });']
    .map(t=>{ const i=fn.indexOf(t); assert.ok(i>=0,"the run has "+t); return i; });
  order.forEach((x,i)=>assert.ok(i===0||x>order[i-1],"step "+i+" follows the one before it"));
  // a shot whose specification changed loses its approval, as a re-draft does; one that did not keeps it
  assert.ok(fn.includes("if(!was || print(was)===h) return { ...sh, specHash:h };"));
  assert.ok(fn.includes("specRev:Math.max(Number(sh.specRev)||1, (Number(was.specRev)||1)+1), locked:false, approved:false }; };"));
  // nothing is changed on a failure, and it is said where the button is; the busy mark always goes
  assert.ok(fn.includes('setScenePlanFailed({ id:scene.id, text:/Nothing was (?:changed|replaced)/.test(msg) ? msg : msg.replace(/\\s*$/,"")+" Nothing was changed." });'));
  assert.ok(fn.includes("}finally{\n      if(started) keyframeBusyRef.current.delete(scene.id);\n      setPlanningScene(null);\n    }"));
  assert.ok(fn.indexOf("commitBeatKeyframes(")>fn.indexOf("await window.aiPlanScene("),"nothing is written before the answer is in");
  assert.ok(!/setRoom|setArtView|scrollIntoView|scrollTo/.test(fn),"the run never changes tab or moves the page");
  // the plan saved: the body, who wrote it, the screenplay it was written from, its sets and its checks; not the shots
  assert.ok(fn.includes("const { shots:_planShots, ...planBody } = res.plan;"));
  assert.ok(fn.includes('screenplayRev:res.screenplayRev||"", sets:res.sets, beats:beatNos, shotCount:(res.plan.shots||[]).length, checks:found };'));
  // the usual time grows with the beats
  assert.equal(SP.estimateSeconds(1),200); assert.equal(SP.estimateSeconds(6),340); assert.equal(SP.estimateSeconds(40),1200);
  // the block: the button, or the progress line where the button was (text, bar, clock, engine), or the failure
  const block=ui.slice(ui.indexOf("function ScenePlanBlock("),ui.indexOf("function SceneShotGroup("));
  for(const t of ['_el("span",{className:"ssx-brief-lab"},"Scene plan")','mine ? _el("div",{className:"ssx-plan-work","data-testid":"scene-plan-work",role:"status"},',
    '_el("span",{className:"ssx-plan-work-text"},mine.text),','typeof LocationRunProgress==="function" ? _el(LocationRunProgress,{work:mine})',
    'onClick:()=>onPlan(scene)},_el(Icon.sparkles,{s:12}),plan?"Plan again":"Plan this scene")','fail && _el("div",{className:"ssx-plan-fail",role:"alert","data-testid":"scene-plan-failed"},fail)',
    '"The screenplay changed since this plan was made. Plan again to bring it up to date."','row("The line",','row("Camera idea",plan.cameraIdea)','"Blocking by beat"',
    '"Add all "+noCard.length','"Add to Props")','_el("span",{className:"ssx-plan-card"},"Prop card: "+(card.name||t.name))','title:c.shot==null ? undefined : "Go to this shot",onClick:()=>goShot(c.shot)},',
    'const found = plan ? SP.checks(plan, ordered||[], { beats, sets:plan.sets||[], cast, props:allProps }) : [];'])
    assert.ok(block.includes(t),"the block has "+t);
  // it sits under the scene's brief, and Re-draft waits while a plan is written
  assert.ok(ui.includes("open && _el(ScenePlanBlock,{scene,bm,ordered,ctx,characters,planning:planningScene,failed:scenePlanFailed,"));
  // INSIDE the scene's card, directly under Scene brief (it was drawn on the page under the card)
  { const card=ui.indexOf('_el("div",{className:"shot-scene-card"},'), brief=ui.indexOf('(open && briefOpen) && _el("div",{className:"shot-scene-ctx"},'),
      row=ui.indexOf("open && _el(ScenePlanBlock,{"), grid=ui.indexOf("// BEAT CARDS \u2014 one card per beat");
    assert.ok(card>=0&&brief>card&&row>brief&&grid>row);
    const between=ui.slice(row,grid);
    assert.ok(/planningScene\}\)\),\n/.test(between),"the card closes after the row, not before it");
    assert.ok(/\(i<=scene\.conf\?" on":""\)\}\)\)\)\)\)\)\),\n    \/\/ THE SCENE PLAN/.test(ui),"the brief no longer closes the card"); }
  assert.ok(ui.includes("disabled:!!draftingScene||!!renderBusy||!!planningScene,onClick:()=>onDraftScene(scene),"));
  // on a planned shot's card, in step 1: what it is for, how it starts, how it ends, how it hands off
  assert.ok(ui.includes('slot("planLines", sh.planned && _el(ShotPlanLines,{sh,ctx})),'),"(in the beat-first layout the same lines sit under the open shot's first step)");
  for(const t of ['row("Purpose",sh.purpose),','row("Camera",sh.cameraPosition),','row("Starts",SP.stateText(sh.startState,names)),','row("Ends",SP.stateText(sh.endState,names)),','row("Hands off",SP.handoffText(sh.handoff)));'])
    assert.ok(ui.includes(t),"the shot card has "+t);
  // wired from the app to the tab; a read-only role gets no button
  assert.ok(app.includes("onPlanScene:planSceneShots,planningScene,scenePlanFailed,onAddScenePlanProps:addScenePlanProps}))"));
  assert.ok(art.includes("onPlanScene:readOnly?null:onPlanScene,planningScene,scenePlanFailed,onAddScenePlanProps:readOnly?null:onAddScenePlanProps,"));
  assert.ok(ui.includes("onPlanScene:readOnly?null:onPlanScene,planningScene,scenePlanFailed,onAddScenePlanProps:readOnly?null:onAddScenePlanProps,"));
  for(const t of [".ssx-plan-head{display:flex;",".ssx-plan-work{display:flex;",".ssx-plan-check{display:flex;",".shot-plan{margin:6px 0 4px;"]) assert.ok(css.includes(t),"styles have "+t);
});

test("9 the brief, Frances's fact, the pipeline and the keys", ()=>{
  // the brief: the Writers' Room facts of the scene, in three lines
  assert.deepEqual(plain(SP.brief(scene,beatsMap.s5,{driver:"Amira Hussain",turn:scene.turningPoint})),
    ["Amira packs her brother's lunch and refuses him the car.","Turn: Trust (+) → Distance (−). He puts the keys down and says he will walk.",
     "Amira Hussain wants: To keep Yusuf at home. Yusuf stands in the way: He means to leave tonight."]);
  // Frances knows it, in words she is allowed to say: every sentence survives her filter, and none names a vendor or an engine
  const line=ai.split("\n").find(l=>l.startsWith('APP_FEATURES.push({ name:"Shots: the scene plan, its checks, and tracked things becoming props"'));
  assert.ok(line,"the fact is in the list");
  const b={}; vm.createContext(b);
  vm.runInContext(ai.slice(ai.indexOf("const MUSE_OFF_LIMITS"),ai.indexOf("/* SHOTS REVIEW (owner 2026-10-03)"))+";globalThis.pub=musePublicFeature;globalThis.sent=factSentences;",b);
  const fact=vm.runInContext("("+line.slice("APP_FEATURES.push(".length,-2)+")",b);
  const told=b.pub(fact);
  assert.ok(told&&told.what.length>1500);
  assert.equal(b.sent(told.what).length,b.sent(fact.what.replace(/\s+/g," ")).length,"no sentence is dropped as billing, plan or vendor talk");
  assert.ok(!/Anthropic|Claude|OpenAI|Google|Gemini|GPT|Fable|Opus|Sonnet|McKee|\bTURN\b|Cinema Machine|MUSE/.test(fact.name+" "+fact.what));
  for(const t of ["press Plan this scene. It asks first.","it reads the whole scene first","It works in a few short steps, the staging first and then the shots a few beats at a time, and the row says which step it is on.","MARKS: the named standing places of each set","BLOCKING: the mark each person is on in each beat",
    "WHO IS IN FRAME is the plan's own answer for that shot: nobody for an insert or an empty street","They compare marks, holders and doors, never wording","A row marked Note is a difference of a few words only",
    "The count on the Scene plan row (3 to fix) counts the rows to fix only","it says Plan again to get exact checks","how it STARTS and how it ENDS","each beat's opening shot keeps its ID and its images",
    "THE CHECKS are worked out by the app itself","how many tracked things have no prop card","Add to Props; Add all N adds every one of the scene at once","From the scene plan, with the scene's number",
    "a later reading of the screenplay never removes it","the item is also added to that character's Props, carried list on their character card","What people wear and parts of the set are listed in the tracker but are not offered as props"])
    assert.ok(fact.what.includes(t),"Frances is told: "+t);
  // the pipeline: the Shots part of step 9 only, and the change log
  const shotsPart=pipe.slice(pipe.indexOf("- **Shot List (the convergence tab).**"),pipe.indexOf("### 10. The Stage"));
  assert.ok(shotsPart.includes('**The scene plan (added 2026-11-22 by owner approval: "yes, go with it").**'));
  for(const t of ["**marks**","by comparing marks, holders and doors, never wording","**blocking**","**the line**","**things tracker**","**start state**","**end state**","**Checks**","**Tracked things become props**"]) assert.ok(shotsPart.includes(t),"the pipeline says "+t);
  assert.equal(pipe.split("The scene plan (added 2026-11-22").length,2,"said once, in the Shots part");
  assert.ok(pipe.includes("- *(2026-11-22 — Step 9, Shots, by owner approval:")&&pipe.includes("No other step was added, removed or reordered."));
  assert.equal((pipe.match(/^### \d+\. /gm)||[]).length,11,"no step was added or removed");
  // the new file is loaded before the files that use it, and every changed file has a new key
  const at=t=>{ const i=html.indexOf(t); assert.ok(i>=0,t); return i; };
  assert.ok(at('<script src="app/scene-plan.js?v=')<at('src="app/props.jsx?v=')&&at('<script src="app/scene-plan.js?v=')<at('src="app/shots.jsx?v='));
  assert.ok(at('src="app/locations-ui.jsx?v=')<at('src="app/shots-ui.jsx?v='),"the progress line's own file comes before the Shots tab");
  for(const f of ["scene-plan.js","shots.jsx","shots-ui.jsx","props.jsx","artroom.jsx","ai.jsx","script.jsx","app.jsx","styles.css"])
    assert.ok(["20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1", "20261127-place1", "20261127-note1", "20261127-angles5"].some(k=>html.includes('app/'+f+'?v='+k+'"')),f+" has a current key");
});

test("9b the shots are written a few beats at a time: whole beats up to six moments, a long beat in runs of six", ()=>{
  const g=(bn,mc,max)=>plain(SP.shotGroups(bn,mc,max));
  assert.equal(SP.SHOT_GROUP_MOMENTS,6);
  assert.deepEqual(g([1,2,3,4,5],{1:3,2:3,3:4,4:5,5:2}),[[{n:1,from:0,to:2},{n:2,from:0,to:2}],[{n:3,from:0,to:3}],[{n:4,from:0,to:4}],[{n:5,from:0,to:1}]]);
  assert.deepEqual(g([1,2,3],{1:1,2:1,3:1}),[[{n:1,from:0,to:0},{n:2,from:0,to:0},{n:3,from:0,to:0}]]);
  assert.deepEqual(g([1,2],{1:14,2:2}),[[{n:1,from:0,to:5,part:true}],[{n:1,from:6,to:11,part:true}],[{n:1,from:12,to:13,part:true}],[{n:2,from:0,to:1}]]);
  assert.deepEqual(g([4],{}),[[{n:4,from:0,to:0}]]); assert.deepEqual(g([],{}),[]);
  // every moment is in exactly one group, in order
  const flat=plain(SP.shotGroups([1,2,3,4],{1:7,2:2,3:6,4:1})).flat().flatMap(u=>Array.from({length:u.to-u.from+1},(_,i)=>u.n+"."+(u.from+i+1)));
  assert.deepEqual(flat,["1.1","1.2","1.3","1.4","1.5","1.6","1.7","2.1","2.2","3.1","3.2","3.3","3.4","3.5","3.6","4.1"]);
  assert.equal(SP.groupLabel([{n:3,from:0,to:2}]),"beat 3"); assert.equal(SP.groupLabel([{n:1,from:0,to:1},{n:2,from:0,to:0}]),"beats 1 and 2");
  assert.equal(SP.groupLabel([{n:1,from:0,to:0},{n:2,from:0,to:0},{n:3,from:0,to:0}]),"beats 1 to 3"); assert.equal(SP.groupLabel([{n:4,from:6,to:11,part:true}]),"beat 4, moments 7 to 12");
  assert.equal(SP.groupLabel([{n:4,from:0,to:5,part:true}]),"beat 4, moments 1 to 6"); assert.equal(SP.groupLabel([]),"");
  // the progress line's estimate: the staging and each group; a guess from the beats until the groups are known
  assert.equal(SP.estimateSeconds(5),340); assert.equal(SP.estimateSeconds(5,4),340); assert.equal(SP.estimateSeconds(5,2),200); assert.equal(SP.estimateSeconds(1),200);   // the staging, the shots, then the cameras (50 s)
  assert.equal(SP.estimateSeconds(60),1200);
  // no single call may wait past the server's limit, and the run says which step it is on
  const fn=ai.slice(ai.indexOf("const SCENE_PLAN_CALL_MS"),ai.indexOf("window.aiPlanScene = aiPlanScene;"));
  assert.ok(fn.startsWith("const SCENE_PLAN_CALL_MS = 140000;")&&fn.includes("maxTokens:16000, timeoutMs:SCENE_PLAN_CALL_MS,"));
  assert.ok(fn.includes("const groups = SP.shotGroups(beatNos, momentCount);")&&fn.includes('step(2+g, "the shots of "+SP.groupLabel(units));'));
  assert.ok(app.includes('const onStep = (st)=> setPlanningScene(cur=> (cur && cur.id===scene.id) ? { ...cur, est:SP.estimateSeconds(beatRows.length, st.of),')
    &&app.includes('text:"Planning Scene "+no+", step "+st.step+" of "+st.of+": "+st.text+"\\u2026" } : cur);'));
  assert.ok(app.includes('+(res.stopped ? "The writing engine stopped answering part of the way; press Plan again to finish it. " : "")'));
  // a gateway time-out is said in plain words, as a time-out
  assert.ok(ai.includes('if(status===504 || status===546){')&&ai.includes('const msg = "The writing engine didn\'t answer in time, so the server stopped waiting for it. Try again in a few minutes.";'));
  assert.ok(/took too long to answer|didn[’']t answer in time/i.test("The writing engine didn't answer in time, so the server stopped waiting for it."));
});

/* the writing pass itself, with a stand-in for the engine: what it is told, that it is asked once, and what comes back */
await (async ()=>{
  const name="10 the writing pass: the whole scene goes in (facts, cast, sets, prop cards, beats, the screenplay by moment), one call, and its answer comes back checked";
  try{
    let asked=[];
    const b={console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,isFinite,parseInt,parseFloat,Promise,turnContinuity:box.turnContinuity,
      CustomEvent:(type)=>({type}),dispatchEvent:()=>{}};
    b.window=b; b.globalThis=b; vm.createContext(b);
    for(const f of ["app/scene-order.js","app/shot-screenplay.js","app/shot-scene-context.js","app/shots.jsx","app/scene-plan.js"]) vm.runInContext(read(f),b,{filename:f});
    Object.assign(b,{aiAvailable:()=>true,writingProjectOf:p=>p||{},genreTag:()=>"",writingLoglineOf:p=>p.logline||"",turnTextOf:s=>s.turningPoint||"",
      extractJSON:t=>{ try{ return JSON.parse(t); }catch(e){ return null; } },scrubBrand:s=>String(s).replace(/Claude Opus 5/g,"the writing engine"),
      writingStamp:t=>({model:"Engine X",modelId:"engine-x",task:t}),WRITING_MODELS:[{id:"engine-x",provider:"anthropic"}],writingModelInfo:()=>({id:"engine-x",label:"Engine X"}),
      screenplayDraftSig:d=>"sig"+d.blocks.length,__lastWritingTruncated:false,
      claude:{complete:async o=>{ asked.push(o); return JSON.stringify(b.__answer); }}});
    vm.runInContext(ai.slice(ai.indexOf("function scenePlanSetFacts("),ai.indexOf("window.aiPlanScene = aiPlanScene;"))+";globalThis.aiPlanScene=aiPlanScene;",b);
    b.__answer={...answer(),cameraIdea:"As Claude Opus 5 would: hold wide, then close in."};
    const scenes=[{id:"s4",no:4,loc:"INT. BUS - DAY",summary:"Yusuf is told the job is his."},scene,{id:"s6",no:6,loc:"EXT. COAST ROAD - DAY"}];
    const args=[scene,beatsMap.s5,blocks,{project:{title:"Slack Water",logline:"A brother leaves."},characters:[{...characters[0],pronouns:"she/her"},characters[1]],
      locations:[{...locations[0],architecture:"A narrow galley kitchen with one window over the sink."},locations[1]],props,scenes,drafts,beatsMap}];
    const res=await b.aiPlanScene(...args);
    // SHORT CALLS: the staging from the whole scene, then the shots (four moments here: one group), each under the server's limit
    assert.equal(asked.length,3,"the staging (two calls at the same time: the places, the things), then one group of shots");
    for(const a of asked){ assert.equal(a.maxTokens,16000); assert.equal(a.effort,"medium"); assert.equal(a.timeoutMs,140000); assert.equal(a.quietTimeout,true); }
    assert.equal(res.calls,2); assert.equal(res.stopped,"");
    const told=asked[0].messages[0].content, toldThings=asked[1].messages[0].content, toldShots=asked[2].messages[0].content;
    assert.ok(told.includes("SCREENPLAY \u2014 THE WHOLE SCENE, BY BEAT AND MOMENT. This is canon")&&told.includes("Return four things:\n1. marks: ")&&told.includes("\n4. cameraIdea: ")&&!told.includes("EXACTLY ONE shot for each MOMENT")&&!told.includes("THINGS TRACKER"));
    assert.ok(toldThings.includes("SCREENPLAY \u2014 THE WHOLE SCENE, BY BEAT AND MOMENT. This is canon")&&toldThings.includes("Return one thing:\nthings: the THINGS TRACKER.")&&!toldThings.includes("1. marks: "));
    assert.ok(toldThings.includes("- prop-keys: \u201cCar keys\u201d (carried by Yusuf Hussain)")&&/Return ONLY compact JSON: \{"things":\[.*\]\}$/.test(toldThings),"the things call has the prop cards and asks for the tracker only");
    assert.ok(/Return ONLY compact JSON: \{"marks":.*"cameraIdea":"\.\.\."\}$/.test(told),"the staging asks for no shot");
    for(const t of ["FILM: Slack Water. Logline: A brother leaves.","- amira: Amira Hussain (she/her)","BEAT TABLE","THE STAGING OF THIS SCENE (settled: use its mark ids, its thing keys and its line exactly as given; never rename or move them):\n{\"marks\":[",
      "These are the scene's first shots.","SCREENPLAY \u2014 THE MOMENTS TO SHOOT NOW, BY BEAT AND MOMENT. This is canon","===== BEAT 3 \u2014 set set2 =====","These are the scene's last moments.",
      "shots: EXACTLY ONE shot for each MOMENT of each beat given here, in order.","A shot's end state is the next shot's start state, across beats too",
      "A mark or a tracked thing a moment needs and the staging lacks may be added"]) assert.ok(toldShots.includes(t),"the shots call is told: "+t.slice(0,60));
    assert.ok(/Return ONLY compact JSON: \{"shots":\[.*\],"marks":\[\],"things":\[\]\}$/.test(toldShots));
    assert.ok(!/Anthropic|Claude|OpenAI|Gemini|GPT|McKee|Fable|Opus|\bTURN\b/.test(toldShots),"a vendor's name in the staging answer is not passed on to the next call");
    assert.ok(toldShots.includes("As the writing engine would: hold wide, then close in."));
    for(const t of ["FILM: Slack Water. Logline: A brother leaves.","SCENE #5 “The Lunch Box” (INT. HUSSAIN KITCHEN - NIGHT)","Value turn: Trust (positive) → Distance (negative)",
      "Driver: Amira Hussain — objective: To keep Yusuf at home.","Reactor: Yusuf — obstacle: He means to leave tonight.","Turning point (beat 2): He puts the keys down and says he will walk.",
      "Just before this scene (scene 4): Yusuf is told the job is his.","The next scene opens at: EXT. COAST ROAD - DAY","- amira: Amira Hussain (she/her)\n- yusuf: Yusuf Hussain",
      "- set1: INT. HUSSAIN KITCHEN - NIGHT — beats 1, 2 — location card “Hussain Kitchen”. A narrow galley kitchen with one window over the sink.",
      "- set2: EXT. HUSSAIN TERRACE - DAWN — beat 3 — location card “Hussain Terrace”","- prop-keys: “Car keys” (carried by Yusuf Hussain)",
      "Beat 2 (the turning point): Amira — holds: Amira holds / Yusuf — yields: Yusuf gives up the keys",
      "===== BEAT 1 — set set1 =====\n[Moment 1 of 2]\nAMIRA HUSSAIN packs rice into a Tupperware at the counter.\n[Moment 2 of 2]\nYUSUF HUSSAIN watches from the doorway, car keys in his hand.\nAMIRA\nYou are not taking the car.",
      "===== BEAT 3 — set set2 =====\n[Moment 1 of 1]\nAmira stands at the rail, the Tupperware in her hands."])
      assert.ok(told.includes(t),"the engine is told: "+t.slice(0,60));
    assert.ok(!/Anthropic|Claude|OpenAI|Gemini|GPT|McKee|Fable|Opus|\bTURN\b/.test(told),"no vendor, author or codename in what the engine is told");
    // what comes back: the checked plan, the shot draft's rows, the sets, who wrote it, the screenplay it was written from
    assert.deepEqual(plain(res.plan.shots.map(s=>[s.beat,s.moment])),[[1,1],[1,2],[2,1],[3,1]]);
    assert.deepEqual(plain(res.rows.map(r=>[r.beat,r.fromModel])),[[1,true],[2,true],[3,false]]);
    assert.deepEqual(plain(res.missingBeats),[3]); assert.equal(res.sets.length,2);
    assert.equal(res.by.model,"Engine X"); assert.equal(res.by.task,"Scene plan"); assert.equal(res.screenplayRev,"sig"+blocks.length);
    assert.equal(res.plan.cameraIdea,"As the writing engine would: hold wide, then close in.","a vendor's name in the answer never reaches the film");
    // A SET WITH A FLOOR PLAN: its spaces, openings and fixed objects go in with their ids and positions, so a mark can
    // be given an [x, y] of that frame, a thing can be AT a fixed object and a door IS an opening; the terrace has none
    b.locationSpatialContract=(loc)=>loc.id!=="loc-kitchen" ? {anchors:[]} : {ownerName:"Hussain House",targetSpace:"Hussain Kitchen",frame:"x runs along the window wall",
      anchors:[{id:"worktop",name:"Worktop",space:"Kitchen",placement:"under the window",xy:[1.2,0.3]},{id:"kettle-shelf",name:"Kettle shelf",space:"Kitchen",placement:"left of the cooker"}],
      coordinates:{spaces:[{id:"sp1",name:"Kitchen",footprint:[[0,0],[3.2,0],[3.2,2.4],[0,2.4]],openings:[{id:"back-door",name:"Back door",kind:"door",centre:[3.2,1.2],width:0.8,connectsTo:"Terrace"}]}]}};
    b.__answer=answer(); asked=[];
    const withPlan=await b.aiPlanScene(...args);
    const told2=asked[0].messages[0].content;
    for(const t of ["FLOOR PLAN (metres; x and y in the plan's own frame; this set is the space named Hussain Kitchen). Spaces: Kitchen outline [[0, 0], [3.2, 0], [3.2, 2.4], [0, 2.4]].",
      "Openings: back-door \u201cBack door\u201d (door, Kitchen) at [3.2, 1.2], 0.8 wide, to Terrace.","Fixed objects: worktop \u201cWorktop\u201d (Kitchen) at [1.2, 0.3]: under the window; kettle-shelf \u201cKettle shelf\u201d (Kitchen): left of the cooker.",
      "- set2: EXT. HUSSAIN TERRACE - DAWN \u2014 beat 3 \u2014 location card \u201cHussain Terrace\u201d (no floor plan: give its marks no xy)"])
      assert.ok(told2.includes(t),"the engine is told: "+t.slice(0,70));
    assert.ok(!/set1: [^\n]*no floor plan/.test(told2));
    assert.deepEqual(plain(withPlan.sets.map(x=>[x.id,!!x.hasPlan])),[["set1",true],["set2",false]]);
    assert.deepEqual(plain(withPlan.plan.fixed),[{id:"back-door",name:"Back door",set:"set1",kind:"opening"},{id:"worktop",name:"Worktop",set:"set1",kind:"object"},{id:"kettle-shelf",name:"Kettle shelf",set:"set1",kind:"object"}]);
    assert.deepEqual(plain(withPlan.plan.marks.filter(m=>m.xy).map(m=>[m.id,m.xy])),[["m-counter",[1.23,0.5]]],"an [x, y] only in the set that has a plan, and only when it can be a place");
    assert.equal(withPlan.plan.shots[0].start.things.tupperware.at,"worktop"); assert.deepEqual(plain(withPlan.plan.shots[0].start.doors),[{id:"back-door",open:false}]);
    // with no floor plan anywhere, no mark keeps an [x, y]
    assert.ok(res.plan.marks.length>=4&&res.plan.marks.every(m=>!m.xy)); assert.deepEqual(plain(res.plan.fixed),[]);
    delete b.locationSpatialContract;
    // an answer that cannot be read, or that names no shot, is a failure with nothing changed (never a made-up plan)
    b.__answer="not json"; b.claude.complete=async()=>"I cannot do that.";
    await assert.rejects(()=>b.aiPlanScene(...args),/could not be read\. Nothing was changed/);
    b.claude.complete=async o=>JSON.stringify(/THE STAGING OF THIS SCENE/.test(o.messages[0].content) ? {shots:[{beat:9,size:"WS"}]} : {marks:[],blocking:[],things:[]});
    await assert.rejects(()=>b.aiPlanScene(...args),/named no shot for this scene's beats\. Nothing was changed/);
    // an answer that cannot be read is asked for once more, then it is a failure
    let tries=0; b.claude.complete=async()=>{ tries++; return "I cannot do that."; };
    await assert.rejects(()=>b.aiPlanScene(...args),/could not be read\. Nothing was changed/); assert.equal(tries,4,"each of the two staging calls is asked twice");
    // a call that runs out of time is asked once more; any other failure (credits, plan) is said once
    tries=0; b.turnIsWritingTimeout=e=>/took too long|didn.t answer in time/.test(String(e&&e.message||e));
    b.claude.complete=async()=>{ tries++; throw new Error("The writing engine took too long to answer."); };
    await assert.rejects(()=>b.aiPlanScene(...args),/took too long/); assert.equal(tries,4);
    tries=0; b.claude.complete=async()=>{ tries++; throw new Error("Not enough credits."); };
    await assert.rejects(()=>b.aiPlanScene(...args),/Not enough credits/); assert.equal(tries,2,"one try each, no second");
    /* A FEW BEATS AT A TIME: with groups of two moments this scene is three calls. Each shots call gets the staging, its
       own moments only, how the shot before it ended, and what comes next; each step is reported as it starts. */
    const groupsOf=b.ScenePlan.shotGroups; b.ScenePlan.shotGroups=(bn,mc)=>groupsOf(bn,mc,2);
    const full=answer(); asked=[]; const stepsSeen=[];
    const shotsFor=o=>{ const c=o.messages[0].content, part=c.slice(c.indexOf("THE MOMENTS TO SHOOT NOW")); const beats=[...part.matchAll(/===== BEAT (\d+)/g)].map(m=>Number(m[1]));
      return {shots:full.shots.filter(x=>beats.includes(x.beat)),marks:[{id:"m-new",set:"set2",name:"by the step"},{id:"m-rail",set:"set2",name:"renamed"}],things:[{key:"new-thing",name:"A cup",kind:"prop",beats:[{n:3,state:"on the rail"}]}]}; };
    b.claude.complete=async o=>{ asked.push(o); const c=o.messages[0].content; return JSON.stringify(/THE STAGING OF THIS SCENE/.test(c) ? shotsFor(o) : {marks:full.marks,blocking:full.blocking,line:full.line,things:full.things,cameraIdea:full.cameraIdea}); };
    const three=await b.aiPlanScene(args[0],args[1],args[2],{...args[3],onStep:st=>stepsSeen.push(st.step+"/"+st.of+" "+st.text)});
    assert.equal(asked.length,4); assert.equal(three.calls,3);
    assert.deepEqual(stepsSeen,["1/3 the staging","2/3 the shots of beat 1","3/3 the shots of beats 2 and 3"]);
    const g1=asked[2].messages[0].content, g2=asked[3].messages[0].content;
    assert.ok(g1.includes("===== BEAT 1 \u2014 set set1 =====")&&!g1.includes("===== BEAT 2")&&!g1.includes("===== BEAT 3"),"a group is told its own moments only");
    assert.ok(/WHAT COMES NEXT \(for your last hand-off only; do not shoot it\): \S/.test(g1)&&g1.includes("These are the scene's first shots."));
    assert.ok(g2.includes("THE SHOT JUST BEFORE THESE (beat 1, moment 2) ENDS LIKE THIS, and your first shot starts from it:\n{\"end\":{\"people\":{\"yusuf\":"),"the next group starts from how the last shot ended");
    assert.ok(g2.includes("===== BEAT 2 ")&&g2.includes("===== BEAT 3 ")&&!g2.includes("===== BEAT 1 ")&&g2.includes("These are the scene's last moments."));
    assert.ok(g2.includes('"id":"m-new"'),"a mark an earlier group added is part of the staging the next group is given");
    assert.deepEqual(plain(three.plan.shots.map(x=>[x.beat,x.moment])),[[1,1],[1,2],[2,1],[3,1]]);
    assert.ok(three.plan.marks.some(m=>m.id==="m-new")&&three.plan.marks.find(m=>m.id==="m-rail").name==="at the terrace rail","a group may add a mark, never rename one");
    assert.ok(three.plan.things.some(t=>t.key==="new-thing"));
    // a group that fails twice ends the run there: what was written is kept, and the result says it stopped
    let n3=0; b.claude.complete=async o=>{ const c=o.messages[0].content; if(c.includes("THE SHOT JUST BEFORE THESE")){ n3++; throw new Error("The writing engine took too long to answer."); }
      return JSON.stringify(/THE STAGING OF THIS SCENE/.test(c) ? shotsFor(o) : {marks:full.marks,blocking:full.blocking,line:full.line,things:full.things,cameraIdea:full.cameraIdea}); };
    const partPlan=await b.aiPlanScene(...args);
    assert.equal(n3,2); assert.match(partPlan.stopped,/took too long/);
    assert.deepEqual(plain(partPlan.plan.shots.filter(x=>!x.filled).map(x=>[x.beat,x.moment])),[[1,1],[1,2]]);
    assert.ok(partPlan.missingBeats.includes(2)&&partPlan.missingBeats.includes(3),"the beats after it keep the shots they have");
    b.ScenePlan.shotGroups=groupsOf;
    // a beat with no screenplay is asked for before any call is made
    let calls=0; b.claude.complete=async()=>{ calls++; return "{}"; };
    await assert.rejects(()=>b.aiPlanScene(scene,beatsMap.s5,[],{...args[3],drafts:{s5:{blocks:[]}}}),/Write (?:this scene's screenplay|the screenplay for beat 1) before planning/);
    assert.equal(calls,0);
    pass++; console.log("PASS "+name);
  }catch(e){ fail++; console.log("FAIL "+name+"\n    "+(process.env.FULL?String(e&&e.stack||e):String(e&&e.message||e).split("\n")[0])); }
})();

/* the block and the shot card's lines, drawn with a stand-in React */
test("11 what the Shots tab shows: the plan in the scene's card, its progress where the button was, a failure, and a planned shot's lines", ()=>{
  const {transformSync}=createRequire(import.meta.url)("@babel/core");
  const noop=()=>{};
  let openAll=false;
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false)}),
    useState:v=>[(openAll&&v===false)?true:(typeof v==="function"?v():v),noop],useRef:v=>({current:v}),useEffect:noop,useMemo:f=>f(),useReducer:()=>[0,noop],Fragment:"Fragment"};
  const b={React,console,Date,JSON,Math,Icon:new Proxy({},{get:(t,k)=>"icon-"+String(k)}),document:{querySelector:()=>null,addEventListener:noop,removeEventListener:noop},
    localStorage:{getItem:()=>null,setItem:noop},addEventListener:noop,removeEventListener:noop};
  b.window=b; b.globalThis=b; vm.createContext(b);
  for(const f of ["app/scene-order.js","app/shot-screenplay.js","app/scene-plan.js"]) vm.runInContext(read(f),b,{filename:f});
  vm.runInContext(transformSync(ui,{presets:["@babel/preset-react"],plugins:["@babel/plugin-transform-block-scoping"],babelrc:false,configFile:false,filename:"shots-ui.jsx",compact:false}).code,b);
  b.LocationRunProgress=({work})=>React.createElement("span",{"data-testid":"location-work"},"BAR",work.engine);
  const flat=n=>typeof n==="string"||typeof n==="number"?String(n):!n?"":typeof n.type==="function"?flat(n.type({...n.props,children:n.children})):(n.children||[]).map(flat).join("|");
  const find=(n,t,out=[])=>{ if(!n||typeof n!=="object") return out; if(typeof n.type==="function") return find(n.type({...n.props,children:n.children}),t,out); if(t(n)) out.push(n); (n.children||[]).forEach(c=>find(c,t,out)); return out; };
  const R=planned();
  const {shots:_s,...body}=R.out.plan;
  const doc={...body,v:1,at:"2026-11-22T10:00:00.000Z",by:{id:"engine-x",label:"Engine X"},screenplayRev:b.screenplayDraftSig(drafts.s5),sets};
  const ctxOf=project=>({project,charById:Object.fromEntries(characters.map(c=>[c.id,c])),propById:{"prop-keys":props[0]},drafts});
  const calls=[];
  const draw=(o)=>b.ScenePlanBlock({scene,bm:beatsMap.s5,ordered:R.shots,ctx:ctxOf({scenePlans:{s5:doc}}),characters,planning:null,failed:null,
    onPlan:s=>calls.push(["plan",s.id]),onAddProps:(s,k)=>calls.push(["add",s.id,k||null]),blocked:false,...o});
  // closed: one line that says where the scene stands, and the button
  const shut=draw();
  assert.equal(shut.props["data-testid"],"scene-plan");
  // the row counts what is TO FIX; a note is shown in the list and is not counted as work
  assert.equal(flat(shut).replace(/\|+$/,""),"|Scene plan|4 shots planned · 5 to fix · 1 thing with no prop card||Plan again");
  const withNote={...doc,sets:[sets[0],{...sets[1],locationId:"",locationName:""}]};
  assert.equal(flat(draw({ctx:ctxOf({scenePlans:{s5:withNote}})})).replace(/\|+$/,""),"|Scene plan|4 shots planned · 5 to fix · 1 thing with no prop card||Plan again");
  openAll=true;
  assert.ok(flat(draw({ctx:ctxOf({scenePlans:{s5:withNote}})})).includes("Checks|5 to fix · 1 note|"));
  assert.ok(flat(draw({ctx:ctxOf({scenePlans:{s5:withNote}})})).includes("Note|EXT. HUSSAIN TERRACE - DAWN has no location card yet"));
  openAll=false;
  assert.equal(find(shut,n=>n.props&&n.props.className==="ssx-plan-body").length,0);
  // open: the brief, the line, the camera idea, the blocking, the things and the checks
  openAll=true;
  const open=draw(), text=flat(open);
  for(const t of ["Amira packs her brother's lunch and refuses him the car.","Turn: Trust (+) → Distance (−). He puts the keys down and says he will walk.",
    "The line|between Amira at the counter and Yusuf in the doorway. The camera keeps to the window side.","Camera idea|Hold wide while they are apart; close in when the keys go down.",
    "Marks|6 standing places|At the counter|near the worktop under the window · INT. HUSSAIN KITCHEN - NIGHT · x 1.23 m, y 0.5 m|In the doorway|near the hall door · INT. HUSSAIN KITCHEN - NIGHT|",
    "At the terrace rail|near the rail · EXT. HUSSAIN TERRACE - DAWN|",
    "Blocking by beat|3 beats|Beat 1|Amira Hussain at the counter, standing, facing the window · Yusuf Hussain in the doorway, facing Amira. He does not come in.",
    "Beat 2|Amira Hussain at the counter · Yusuf Hussain|Beat 3|Amira Hussain at the terrace rail",
    "Things|4 · 1 with no prop card|Tupperware|carried by Amira Hussain · beats 1–3|Add to Props|the car keys|carried by Yusuf Hussain · beats 1–2|Prop card: Car keys|Amira's apron|carried by Amira Hussain · beat 1|Wardrobe|kettle|beats 1, 3|Part of the set",
    "Checks|5 to fix|Fix|Shot 4 (beat 3) was not planned",
    "Fix|1 thing in this scene has no prop card: Tupperware.","Fix|Shot 1 shows the lighter, which is not in the things tracker.","Written by Engine X · 2026-11-22"])
    assert.ok(text.includes(t),"the plan shows: "+t.slice(0,50));
  // a check goes to its shot; the buttons do what they say and nothing else
  const check=find(open,n=>n.type==="button"&&/ssx-plan-check/.test(n.props.className||"")&&/lighter/.test(flat(n)))[0];
  assert.equal(check.props.disabled,false); assert.equal(check.props.title,"Go to this shot");
  const whole=find(open,n=>n.type==="button"&&/ssx-plan-check/.test(n.props.className||"")&&/no prop card/.test(flat(n)))[0];
  assert.equal(whole.props.disabled,true,"a check about the whole scene has no shot to go to");
  find(open,n=>n.type==="button"&&n.props["data-testid"]==="scene-plan-run")[0].props.onClick();
  find(open,n=>n.type==="button"&&n.props["data-testid"]==="scene-plan-add-prop")[0].props.onClick();
  assert.deepEqual(plain(calls),[["plan","s5"],["add","s5",["tupperware"]]]);
  assert.equal(find(open,n=>n.props&&n.props["data-testid"]==="scene-plan-add-all").length,0,"Add all shows from two things up");
  // with no prop card in the film, both tracked objects wait: one button adds them all
  const all=find(draw({ctx:{...ctxOf({scenePlans:{s5:{...doc,things:doc.things.map(t=>({...t,propId:""}))}}}),propById:{}}}),n=>n.props&&n.props["data-testid"]==="scene-plan-add-all");
  assert.equal(all.length,1); assert.equal(flat(all[0]),"Add all 2");
  // a role that cannot change the film sees the plan and no button
  const ro=draw({readOnly:true,onPlan:null,onAddProps:null});
  assert.equal(find(ro,n=>n.type==="button"&&n.props["data-testid"]).length,0); assert.ok(flat(ro).includes("Tupperware|carried by Amira Hussain · beats 1–3|No prop card"));
  // while it is written: what is being done, the bar and the engine, where the button was; no button
  const busy=draw({planning:{id:"s5",since:Date.now()-5000,est:85,engine:"Engine X",text:"Planning Scene 05…"}});
  assert.match(flat(busy.children[0]),/^\|Scene plan\|\|Planning Scene 05…\|BAR\|Engine X$/);
  assert.equal(find(busy.children[0],n=>n.type==="button"&&n.props["data-testid"]).length,0);
  assert.equal(find(draw({planning:{id:"other",since:1,est:85,engine:"E",text:"x"}}),n=>n.props&&n.props["data-testid"]==="scene-plan-work").length,0,"another scene's plan is not this one's");
  // a failure: said in the block, the scene as it was
  openAll=false;
  const failed=b.ScenePlanBlock({scene,bm:beatsMap.s5,ordered:[],ctx:ctxOf({}),characters,planning:null,failed:{id:"s5",text:"The scene plan could not be read. Nothing was changed; try again."},onPlan:noop});
  assert.equal(flat(failed),"|Scene plan|Not planned yet||Plan this scene|The scene plan could not be read. Nothing was changed; try again.");
  // the screenplay changed since: said, with what to do
  assert.ok(flat(draw({ctx:{...ctxOf({scenePlans:{s5:{...doc,screenplayRev:"old"}}})}})).includes("The screenplay changed since this plan was made. Plan again to bring it up to date."));
  // a plan saved before marks: it is drawn and checked without a fault, its rows are notes, and it says what to do
  const oldShots=R.shots.map((x,i)=>({...x,startState:{people:{yusuf:{where:i%2?"hall by the key hooks":"at the key hooks, facing Pike",holding:[]}},things:{keys:i%2?"on the shelf":"in his hand"},doors:i%2?"front door open":"front door shut"},
    endState:{people:{yusuf:{where:"at the key hooks, facing Pike",holding:[]}},things:{keys:"in his hand"},doors:"front door shut"},handoff:{type:"cut",note:""},planFilled:false,planUntracked:[],subjects:["yusuf"]}));
  const {marks:_m,fixed:_f,...oldBody}=doc;
  const oldDoc={...oldBody,v:1,blocking:[{beat:1,people:[{id:"yusuf",where:"at the key hooks",facing:"Pike"}]},{beat:2,people:[{id:"yusuf",where:"in the hall"}]},{beat:3,people:[{id:"yusuf",where:"outside"}]}]};
  openAll=true;
  const oldText=flat(draw({ordered:oldShots,ctx:ctxOf({scenePlans:{s5:oldDoc}})}));
  openAll=false;
  assert.match(oldText,/^\|Scene plan\|4 shots planned · 1 to fix · 1 thing with no prop card\|/,"only the missing prop card is a fix on an old plan");
  for(const t of ["Blocking by beat|3 beats|Beat 1|Yusuf Hussain at the key hooks, facing Pike","Note|"+SP.OLD_PLAN_NOTE,"Note|Shot 1 ends with Yusuf Hussain at the key hooks, facing Pike; shot 2 starts with Yusuf Hussain hall by the key hooks.",
    "This plan has no marks. Plan again to get exact checks."]) assert.ok(oldText.includes(t),"an old plan shows: "+t.slice(0,60));
  assert.ok(!oldText.includes("Marks|"),"no marks part without marks");
  assert.equal(flat(b.ShotPlanLines({sh:oldShots[1],ctx:ctxOf({scenePlans:{s5:oldDoc}})})).split("|Starts|")[1].split("|Ends|")[0],"Yusuf Hussain hall by the key hooks. The car keys: on the shelf. Doors: front door open.");
  // a planned shot's card: what it is for, where the camera stands, how it starts, how it ends, how it hands off
  assert.equal(flat(b.ShotPlanLines({sh:R.shots[1],ctx:ctxOf({scenePlans:{s5:doc}})})),
    "From the scene plan|Purpose|Yusuf, and what he holds.|Camera|behind Amira's shoulder, on the doorway|Starts|Yusuf Hussain in the doorway, leaning, holding the car keys. Doors: the back door shut.|Ends|Yusuf Hussain in the doorway, leaning, holding the car keys. Doors: the back door shut.|Hands off|Match cut: on his hand");
  assert.equal(b.ShotPlanLines({sh:{id:"x",sceneId:"s5"},ctx:ctxOf({})}),null,"a shot the plan did not write shows none");
  assert.equal(b.scenePlanBeatList([3,1,2,5,7,8]),"1–3, 5, 7–8");
});

/* THE SHOTS TAB WENT DEAD ON A SCENE OF 17 SHOTS (2026-11-22). Each card read the screenplay again for every shot of
   its scene (about 1,300 readings to draw one scene: several seconds in which the page did nothing). A tool that
   drives the page stopped that script half-way, which leaves React with a render it never finishes: nothing answers
   any more, and the next image event logs "Cannot update a component while rendering a different component
   (ShotCard)". There was no setState in ShotCard's render; the render was too long. A shot's cast is now read once
   and kept while nothing it is read from changes, and a scene's ledger is worked out once for a list of shots. */
test("11b a shot card builds its image prompt only when asked: a render, the Stage, or an open Shot prompt section", ()=>{
  const from=ui.indexOf("function shotFrameGenOpts("), to=ui.indexOf("\nwindow.shotFrameGenOpts",from);
  const b={console,JSON,Math,Date,Object,Array,String,Number}; b.window=b; vm.createContext(b);
  let built=[];
  Object.assign(b,{combinedShotPrompt:(sh,c)=>{ built.push("final"); return "FINAL "+sh.id; },buildShotPrompt:(sh,c)=>{ built.push(c.simpleMode?"simple":"chain"); return "CHAIN "+sh.id; }});
  vm.runInContext(ui.slice(from,to)+"\nglobalThis.shotFrameGenOpts=shotFrameGenOpts;",b,{filename:"shots-ui#shotFrameGenOpts"});
  const sh={id:"s1",sceneId:"sc"}; const pack=b.shotFrameGenOpts(sh,[sh],{scene:{id:"sc"},charById:{},propById:{},project:{},locations:[]});
  assert.deepEqual(built,[],"drawing a card builds no prompt");
  assert.equal(pack.opts.buildFinal(),"FINAL s1"); assert.equal(pack.opts.buildFinal(),"FINAL s1"); assert.equal(pack.finalPrompt,"FINAL s1");
  assert.deepEqual(built,["final"],"the final prompt is built once, when a render or the preview asks");
  assert.equal(pack.chainPrompt,"CHAIN s1"); assert.equal(pack.opts.buildFromBase(),"CHAIN s1");
  assert.deepEqual(built,["final","chain"]);
  // the card's preview is its own small part, drawn only while the section is open
  assert.ok(ui.includes('slot("prompt", _el(CardFold,{label:"Shot prompt",defaultOpen:false},\n        _el(ShotPromptBox,{pack:framePack,isHead}))),'),"(still a folded section: built only when it is opened)");
  assert.ok(ui.includes("text: isHead ? pack.finalPrompt : pack.chainPrompt});"));
  const card=ui.slice(ui.indexOf("function ShotCard("),ui.indexOf("function ScenePlanBlock("));
  assert.ok(card.length>1000&&!/framePack\.(finalPrompt|chainPrompt)/.test(card),"the card itself never reads a prompt while drawing");
});

test("11c who is in frame on a planned shot stays the plan's answer: the old re-anchor pass skips it, and gives back what it changed", ()=>{
  const from=ui.indexOf("  const subjFixed = React.useRef(false);"), to=ui.indexOf("  },[(shots||[]).length]);",from);
  assert.ok(from>0&&to>from);
  const body=ui.slice(ui.indexOf("(shots||[]).forEach(sh=>{",from),to);
  const run=(list)=>{ const out={}; const b={out,shots:list,beatsMap:{},characters:[{id:"liaqat",name:"Liaqat"},{id:"darren",name:"Darren"},{id:"eshita",name:"Eshita"}],
      scanTextForChars:(t,cs)=>cs.filter(c=>new RegExp("\\b"+c.name+"\\b","i").test(t)).map(c=>c.id),onUpdateShot:(id,patch)=>{ out[id]=patch; },
      beatActionOf:()=>""};
    vm.createContext(b); vm.runInContext(body.replace(/\}\);\s*$/,"});"),b); return plain(out); };
  const planned={subjectsByPlan:true,referenceCharactersSet:true,referenceCharactersAuto:true};
  const got=run([
    {id:"a",...planned,action:"Liaqat lifts the keys off the hook.",subjects:["liaqat","darren","eshita"],referenceCharacterIds:["liaqat","darren","eshita"]},   // untouched: left alone
    {id:"b",...planned,action:"Darren watches the laces.",subjects:["darren"],referenceCharacterIds:["liaqat"]},                                              // changed before: given back
    {id:"c",...planned,referenceCharactersAuto:false,action:"Darren watches.",subjects:["liaqat"],referenceCharacterIds:["eshita"]},                            // the list was set by hand: left alone
    {id:"d",...planned,action:"The empty hook.",subjects:[],referenceCharacterIds:[]},                                                                         // nobody in frame is an answer
    {id:"e",action:"Darren watches.",subjects:["liaqat"]},                                                                                                      // not planned: the old rule
    {id:"f",subjectsSet:true,action:"Darren watches.",subjects:["liaqat"]}]);                                                                                   // set by hand: left alone
  assert.deepEqual(got,{b:{subjects:["liaqat"]},e:{subjects:["darren"]}});
});

test("12 a scene of many shots is read once: a shot's cast is kept while its inputs are the same, the ledger once for a list", ()=>{
  const N=17;
  const big={id:"big",no:9,title:"Hall",loc:"INT. HALL - DAY",driver:"amira"};
  const bb=[{beat:1,type:"scene",text:"INT. HALL - DAY"}], rows=[];
  for(let k=1;k<=N;k++){ bb.push(A(k,(k%2?"AMIRA HUSSAIN":"YUSUF HUSSAIN")+(k===2?" picks up the car keys.":" crosses the hall, step "+k+"."))); rows.push({n:k}); }
  const D={big:{blocks:bb}}, BM={big:{rows}};
  const list=rows.map((r,i)=>({id:"b"+r.n,sceneId:"big",beatN:r.n,order:i,keyframeMode:"beat-opening",size:"MS",action:bb[i+1].text,subjects:[]}));
  const charById=Object.fromEntries(characters.map(c=>[c.id,c])), propById={"prop-keys":{...props[0],scenes:["big"]}};
  const keep=box.turnContinuity;
  box.turnContinuity={drafts:D,characters,scenes:[big],beatsMap:BM,locations:[],props:Object.values(propById),sluglineUnits:[]};
  let reads=0; const real=box.shotBeatScreenplay;
  box.shotBeatScreenplay=function(){ reads++; return real.apply(this,arguments); };
  try{
    // as the cards of one scene ask: every card wants the scene's ledger, for the same list
    const first=box.sceneContinuityLedger(big,list,charById,propById);
    const once=reads;
    assert.ok(once>0&&once<=N*2,"one reading a shot or so, not one a shot for every card ("+once+")");
    for(let i=0;i<N;i++) assert.equal(box.sceneContinuityLedger(big,list,charById,propById),first);
    assert.equal(reads,once,"asked again for the same list: nothing is read again");
    assert.ok(Object.keys(first).length===N&&first.b4.includes("prop-keys")&&!first.b1.length&&!first.b2.length,"and the ledger is the ledger: Yusuf's keys carry forward into the shots after he picks them up");
    // another list of the same shots (the tab drew again): the ledger is worked out again, the cast readings are kept
    const second=box.sceneContinuityLedger(big,list.slice(),charById,propById);
    assert.notEqual(second,first); assert.deepEqual(plain(second),plain(first)); assert.equal(reads,once);
    // a card's own questions cost nothing more either
    for(const sh of list){ assert.deepEqual(plain(box.inFrameCast(sh,big,characters)),sh.beatN===1?["amira"]:["amira","yusuf"]); box.inFrameCast(sh,big,characters,{drafts:D,charById,beatsMap:BM}); }
    assert.ok(reads<=once+N,"the card's own context is one more reading a shot at most ("+(reads-once)+")");
    const settled=reads;
    for(const sh of list){ box.inFrameCast(sh,big,characters); box.inFrameCast(sh,big,characters,{drafts:D,charById,beatsMap:BM}); }
    assert.equal(reads,settled);
    // what comes back is the caller's own list: changing it changes nothing that is kept
    const got=box.inFrameCast(list[0],big,characters); got.push("nobody"); assert.deepEqual(plain(box.inFrameCast(list[0],big,characters)),["amira"]);
    // READ AGAIN when something it is read from changes: the screenplay, a character, the shot's own words
    box.turnContinuity={...box.turnContinuity,drafts:{big:{blocks:bb.map((x,i)=>i===1?A(1,"YUSUF HUSSAIN crosses the hall alone."):x)}}};
    assert.deepEqual(plain(box.inFrameCast(list[0],big,characters)),["yusuf"],"the screenplay was rewritten: the shot is read from the new one");
    assert.ok(reads>settled);
    box.turnContinuity={...box.turnContinuity,drafts:D};
    const renamed=[{...characters[0],name:"Amira Khan"},characters[1]];
    box.turnContinuity={...box.turnContinuity,characters:renamed};
    assert.deepEqual(plain(box.inFrameCast(list[0],big,renamed)),["amira","yusuf"],"a character renamed: read again (HUSSAIN is now Yusuf's name alone, so it names him too)");
    box.turnContinuity={...box.turnContinuity,characters};
    assert.deepEqual(plain(box.inFrameCast(list[0],big,characters)),["amira"]);
    assert.deepEqual(plain(box.inFrameCast({...list[0],referenceCharactersSet:true,referenceCharacterIds:[]},big,characters)),[],"a shot changed by hand is another shot");
    // the ledger follows the film too: new props, a new ledger
    const before=reads; const third=box.sceneContinuityLedger(big,list,charById,{});
    assert.notEqual(third,first); assert.ok(!third.b4.length); assert.ok(reads>=before);
  }finally{ box.shotBeatScreenplay=real; box.turnContinuity=keep; }
  for(const t of ["function inFrameCastRead(sh, scene, characters, ctx){","function sceneContinuityLedgerRead(scene, sceneShots, charById, propById){",
    "if(was && was.text===now.text && was.draft===now.draft && was.beats===now.beats && _sameList(was.readers,now.readers) && _sameList(was.cast,now.cast))"])
    assert.ok(shotsSrc.includes(t),"shots.jsx has "+t);
});

console.log("\n"+pass+" passed, "+fail+" failed");
if(fail) process.exit(1);

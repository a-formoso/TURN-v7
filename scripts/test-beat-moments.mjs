#!/usr/bin/env node
/* A BEAT'S MOMENTS (owner 2026-11-01, "Final Ramp": "Headlights crawl up the ramp into the hold" never reached the
   frame). A beat's screenplay splits into its moments; a split beat has one shot per moment, each showing only its
   own moment, chained one into the next, and its Stage clip performs only those moments. An opening frame never
   voices a line from a later moment. No model or image call. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=f=>readFileSync(new URL("../"+f,import.meta.url),"utf8");
const box={console,Date,Set,Map,Math,JSON,Number,String,Object,Array,RegExp,isFinite,parseInt,parseFloat,setTimeout,clearTimeout,
  turnContinuity:{},CustomEvent:(type,init)=>({type,detail:init&&init.detail}),dispatchEvent:()=>{}};
box.window=box;box.globalThis=box;vm.createContext(box);
for(const f of ["app/scene-order.js","app/shot-screenplay.js","app/shot-scene-context.js","app/shots.jsx","app/beat-keyframe-merge.js",
  "app/stage-screenplay.js","app/stage-plan.jsx"])vm.runInContext(read(f),box,{filename:f});
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};

const scene={id:"final",no:1,title:"Final Ramp",loc:"INT. MARMORICA - CAR DECK - NIGHT"};
const A=(beat,text)=>({beat,type:"action",text});
const blocks=[{beat:1,type:"scene",text:"INT. MARMORICA - CAR DECK/UPPER DECK - NIGHT"},
  A(1,"Sodium light. Diesel haze. Headlights crawl up the ramp into the hold."),
  A(1,"AURELIO BASSI (mid 60s), a man who knows every regular by the bumper and none by the face, punches tickets without looking up."),
  A(1,"CLICK. A dented white Panda. He waves it through by the dent."),
  A(1,"OTTAVIO SPADONI (late 40s), the purser, a man who balances people like ledgers, ticks his clipboard."),
  {beat:1,type:"char",text:"OTTAVIO"},{beat:1,type:"dia",text:"Last one, Bassi."},
  A(1,"CLICK."),A(1,"The ramp GROANS up behind the last car and seals the hold."),
  A(4,"Aurelio unclips his radio. Thumb rises to the button."),A(4,"Stops."),A(4,"On the envelope, in a slanted woman's hand: Aurelio."),
  A(4,"The thumb hangs. Doesn't press."),A(4,"Nives opens her eyes. Looks straight at him. No fear."),A(4,"She holds the envelope out.")];
const drafts={final:{version:1,blocks}};
const characters=[{id:"aurelio",name:"Aurelio Bassi"},{id:"ottavio",name:"Ottavio Spadoni"},{id:"nives",name:"Nives Mibelli"}];
const opts={drafts,characters,beatsMap:{}};
box.turnContinuity={drafts,characters,scenes:[scene],beatsMap:{}};

// 1 · the moments
const ms=box.shotBeatMoments(scene,1,opts);
check(ms.length===4,"Final Ramp's beat 1 is four moments");
check(ms[0].openingAction==="Sodium light. Diesel haze. Headlights crawl up the ramp into the hold.","Moment 1: the headlights");
check(/punches tickets/.test(ms[1].text)&&/He waves it through by the dent/.test(ms[1].text),"Moment 2: Bassi punches tickets and waves the Panda through (a 'CLICK.' or 'He' paragraph carries on)");
check(/ticks his clipboard/.test(ms[2].text)&&ms[2].dialogue.length===1&&ms[2].dialogue[0].text==="Last one, Bassi."&&/CLICK\.$/.test(ms[2].text),"Moment 3: Ottavio, his line, and the CLICK after it");
check(ms[3].openingAction==="The ramp GROANS up behind the last car and seals the hold.","Moment 4: the ramp seals the hold");
check(ms[0].dialogue.length===0&&ms[1].dialogue.length===0,"Lines belong to their own moment only");
check(ms.every(m=>m.moment.of===4)&&ms.map(m=>m.moment.n).join()==="1,2,3,4","Each moment knows its place");
check(JSON.stringify(ms[0].openingCharacterIds)==='["aurelio","ottavio"]',"Moment 1 keeps the beat's opening cast (the people already at work)");
check(JSON.stringify(ms[1].openingCharacterIds)==='["aurelio"]'&&JSON.stringify(ms[2].openingCharacterIds)==='["ottavio"]',"A moment that names someone shows them");
check(ms[3].openingCharacterIds.indexOf("aurelio")>=0&&ms[3].openingCharacterIds.indexOf("ottavio")>=0&&!ms[3].namedCharacterIds.length,"A moment that names nobody keeps the people already there");
const b4=box.shotBeatMoments(scene,4,opts);
check(b4.length===4&&/Stops\./.test(b4[0].text)&&/She holds the envelope out/.test(b4[3].text),"A two-word paragraph and a 'She' paragraph carry on their moment");
check(box.shotBeatMoments({id:"x"},1,{drafts:{x:{blocks:[A(1,"Rain.")]}},characters:[]}).length===1,"A one-paragraph beat is one moment");

// 2 · what a shot reads
const primary={id:"p",sceneId:"final",beatN:1,keyframeMode:"beat-opening",order:0,size:"WS",angle:"eye",move:"static",lens:"35",action:ms[0].openingAction,subjects:[]};
const m=(n)=>({id:"m"+n,sceneId:"final",beatN:1,keyframeMode:"moment",moment:{n,of:4},order:n/100,size:"MS",angle:"eye",move:"static",lens:"50",
  action:ms[n-1].openingAction,referenceCharactersSet:true,referenceCharacterIds:ms[n-1].openingCharacterIds.slice(),subjects:ms[n-1].openingCharacterIds.slice()});
check(box.shotScreenplayFor(scene,primary,opts).text.indexOf("Last one")>=0,"An unsplit opening shot reads the whole beat");
check(box.shotScreenplayFor(scene,{...primary,moment:{n:1,of:4}},opts).text.indexOf("Last one")<0,"A split beat's opening shot reads moment 1 only");
check(box.shotScreenplayFor(scene,m(3),opts).dialogue[0].text==="Last one, Bassi.","A moment shot reads its moment");
const union=box.shotScreenplayForShots(scene,[m(3),m(2)],opts);
check(union.moment.n===2&&union.moment.to===3&&/punches tickets/.test(union.text)&&/Last one/.test(union.text)&&!/Headlights/.test(union.text),"A clip of moments 2 and 3 reads those two, in order");
check(box.shotScreenplayForShots(scene,[primary],opts).text.indexOf("GROANS")>=0,"A clip of an unsplit beat reads the whole beat");

// 3 · the frame prompt
const charById=Object.fromEntries(characters.map(c=>[c.id,c]));
const ctx={scene,location:null,project:{id:"film"},charById,propById:{},drafts,scenes:[scene]};
const opening=box.buildShotPrompt(primary,ctx);
check(!/About to speak/.test(opening),"The headlights frame is no longer told Ottavio is about to say a line from three paragraphs later");
check(/Headlights crawl up the ramp into the hold/.test(opening),"The opening frame stages the headlights");
check(/vehicles and machines the action names are not people and stay in frame/.test(opening),"The people count leaves the headlights' car in frame");
const p3=box.buildShotPrompt(m(3),{...ctx,prevShot:m(2)});
check(/ticks his clipboard/.test(p3)&&/About to speak — face engaged, lips just parting for "Last one, Bassi"/.test(p3),"Moment 3's frame: Ottavio ticks his clipboard, about to say his line");
const target3=(p3.split("TARGET BEAT OPENING")[1]||"").split("\n\n")[0];
check(/OPENING instant of moment 3 of 4/.test(p3)&&/ticks his clipboard/.test(target3)&&!/Headlights crawl/.test(target3)&&!/GROANS/.test(target3),"Moment 3's frame stages its own moment, and its screenplay target is that moment");
check(/Exactly 1 person in frame — ONLY Ottavio Spadoni/.test(p3),"Moment 3 shows Ottavio alone");
const p4=box.buildShotPrompt(m(4),ctx);
check(/The ramp GROANS up behind the last car/.test(p4)&&!/About to speak/.test(p4),"Moment 4: the ramp, no line");

// 4 · the chain and a redraft
const all=[primary,m(2),m(3),m(4),{id:"b2",sceneId:"final",beatN:2,keyframeMode:"beat-opening",order:1}];
check(box.seedShotOf(m(2),all).id==="p"&&box.seedShotOf(m(3),all).id==="m2"&&box.seedShotOf(m(4),all).id==="m3","Each moment is seeded by the moment before it");
check(box.seedShotOf(all[4],all).id==="p","The next beat's opening is still seeded by this beat's opening");
check(box.sceneShotsDependencyOrdered(all.slice().reverse()).map(s=>s.id).join()==="p,m2,m3,m4,b2","Moments render in order, before the next beat");
const merged=box.mergeBeatKeyframes(all,[{...primary,id:"new",composition:"Wider"}]);
check(merged.archived.length===0&&merged.shots.filter(s=>s.keyframeMode==="moment").length===3,"Redrafting the opening keeps the beat's moment shots");

// 5 · the Stage
box.shotSceneContextPlan=box.shotSceneContextPlan||(()=>null);
const ref=box.stageScreenplayReference(scene,[m(2),m(3)],{drafts,characters,beatsMap:{}});
check(/punches tickets/.test(ref.targetText)&&/Last one/.test(ref.targetText)&&!/Headlights/.test(ref.targetText)&&!/GROANS/.test(ref.targetText),"A Stage clip of moments 2 and 3 performs only those moments");
check(/Headlights/.test(box.stageScreenplayReference(scene,[primary],{drafts,characters,beatsMap:{}}).targetText)&&/GROANS/.test(box.stageScreenplayReference(scene,[primary],{drafts,characters,beatsMap:{}}).targetText),"An unsplit beat's clip still performs the whole beat");
const brief=read("app/stage-director-brief.js"),stage=read("app/stage.jsx"),refs=read("app/stage-references.jsx");
check(/const scriptOf=sh=>\(d\.shotScripts&&d\.shotScripts\[sh\.id\]\)\|\|scripts\[sh\.beatN\]/.test(brief)&&/canonicalOpening=openingFrame\(sh\)/.test(brief),"The director brief gives each moment cut its own moment's screenplay");
check(/sh\.keyframeMode==="beat-opening"\|\|sh\.keyframeMode==="moment"/.test(stage)&&/const src=stageBeatSource\(scene,beatShots,ctx\);/.test(stage)&&/shotScripts\[sh\.id\]=/.test(stage),"The Stage treats a moment as an opening keyframe and reads each one's own screenplay");
check(/g\.shotScreenplayFor\(scene,sh,/.test(refs),"Stage references read a moment's own cast");

// 6 · the Shots tab
const ui=read("app/shots-ui.jsx"),app=read("app/app.jsx"),css=read("app/styles.css");
check(/"Split into "\+list\.length\+" shots"/.test(ui)&&/"Join into one shot"/.test(ui)&&/function MomentShotCard/.test(ui),"A beat card offers the split, a split beat a join, and each moment its own card");
check(/const splitBeatIntoMoments = /.test(app)&&/const joinBeatMoments = async/.test(app)&&/onSplitMoments:splitBeatIntoMoments,onJoinMoments:joinBeatMoments/.test(app),"The split and the join are wired");
check(/if\(line && primary\.lineAudio && words\(primary\.lineAudio\.text\)===words\(line\.text\)\) sh\.lineAudio=\{\.\.\.primary\.lineAudio\};/.test(app),"A line voiced on the opening shot goes with the moment that speaks it");
check(/setTrash\(t=>\(\{\.\.\.t,shots:\[\.\.\.parts\.map\(_trashStamp\)/.test(app),"Join moves the moment shots to Recently deleted (images kept)");
check(/\.bc-moments\{/.test(css),"The moments line is styled");
check(/onSplitMoments:readOnly\?null:onSplitMoments,onJoinMoments:readOnly\?null:onJoinMoments/.test(read("app/artroom.jsx")),"The Art Room passes the split and the join to the Shots tab");
console.log(`PASS beat moments: ${checks} split, prompt, chain and Stage checks`);

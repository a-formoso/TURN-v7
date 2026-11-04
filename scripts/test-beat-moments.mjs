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

{ const lane=[{...primary,moment:{n:1,of:4}},m(2),m(3),m(4)];
check(box.shotBeatDisplayLabel(m(3),lane)==="Beat 1 · Moment 3"&&box.shotBeatDisplayLabel(lane[0],lane)==="Beat 1 · Moment 1","Shots of a split beat are named by moment, never 'Alternative'"); }
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
// 7 · split by default (owner 2026-11-01: "for future projects as well as anything we are doing now")
{
  const voiced={...primary,lineAudio:{text:"Last one, Bassi.",voiceId:"v"},momentSpecs:[{moment:2,size:"CU",angle:"high",lens:"85",composition:"Tight on the punch."},{moment:9,size:"WS"}]};
  const others=[{id:"b2",sceneId:"final",beatN:2,keyframeMode:"beat-opening",order:1}];
  const out=box.beatMomentShots(scene,[voiced,...others],{...opts,stamp:"t"});
  const ids=out.shots.map(x=>x.id);
  check(out.added===3&&out.split.join()==="1"&&ids.join()==="p,b2,shot-final-1-moment2-t,shot-final-1-moment3-t,shot-final-1-moment4-t","Every beat with several moments gets a shot per moment; a beat with one moment is left as it is");
  const p1=out.shots[0],m2=out.shots[2],m3=out.shots[3],m4=out.shots[4];
  check(p1.moment.n===1&&p1.moment.of===4&&!p1.momentSpecs,"The opening shot is moment 1; the drafted moment cameras are used and dropped");
  check(m2.size==="CU"&&m2.angle==="high"&&m2.lens==="85"&&m2.composition==="Tight on the punch.","A later moment takes the camera the writing call drafted for it");
  check(m4.size==="WS"&&m3.size==="MS","Without a drafted camera: a wide when the moment names nobody, else a medium");
  check(m3.lineAudio&&m3.lineAudio.voiceId==="v"&&!m2.lineAudio,"A line voiced on the opening shot goes with the moment that speaks it");
  check(box.beatMomentShots(scene,out.shots,opts).added===0,"Splitting again adds nothing");
  const refreshed=box.beatMomentShots(scene,out.shots.map(x=>x.id==="p"?{...x,momentSpecs:[{moment:2,size:"MCU"}]}:x),opts).shots;
  check(refreshed.find(x=>x.id===m2.id).size==="MCU"&&refreshed.find(x=>x.id===m2.id).specRev===2,"A redraft refreshes an already split beat's moment cameras");
  check(box.beatMomentShots(scene,[{...primary,momentsJoined:true}],opts).added===0,"A beat joined by hand stays joined");
  check(box.beatMomentShots(scene,[primary],{...opts,beats:[4]}).added===0,"Only the beats asked for are split");
}
check(/drafted beats come out in their moments/.test(app)&&/const out=window\.beatMomentShots\(sc,merged\.shots,/.test(app)&&/merged\.shots=out\.shots;/.test(app),"Drafting (Design all shots, a scene's or a beat's redraft, the Shot Designer) splits beats into their moments");
check(/const splitAllBeatMoments = async/.test(app)&&/onSplitAllMoments:splitAllBeatMoments/.test(app)&&/"Split beats into moments"/.test(ui),"Split beats into moments converts a film drafted before");
check(/momentsJoined:true\} : x\)\);/.test(app),"Join remembers itself, so a redraft keeps the beat whole");
const aiSrc=read("app/ai.jsx");
check(/MOMENTS \(each becomes its own shot; moment 1 is this row's opening keyframe\)/.test(aiSrc)&&/also return momentSpecs: one row per moment AFTER the first/.test(aiSrc),"The keyframe writing call drafts each later moment's camera");
check(/momentSpecs: Array\.isArray\(raw\.momentSpecs\)/.test(read("app/shots.jsx")),"The drafted moment cameras survive normalizing");
check(/setTrash\(t=>\(\{\.\.\.t,shots:\[\.\.\.parts\.map\(_trashStamp\)/.test(app),"Join moves the moment shots to Recently deleted (images kept)");
check(/\.bc-moments\{/.test(css),"The moments line is styled");
check(/onSplitMoments:readOnly\?null:onSplitMoments,onJoinMoments:readOnly\?null:onJoinMoments,onSplitAllMoments:readOnly\?null:onSplitAllMoments/.test(read("app/artroom.jsx")),"The Art Room passes the split, the join and split-all to the Shots tab");
check(/const beatSrc = \(typeof window\.shotMomentSource==="function"\)\s*\? window\.shotMomentSource\(scene, sh, ctx,/.test(read("app/shots-ui.jsx")),"A moment card's Action and Dialogue show its own moment, not the beat's first");
// 8 · no repeated cards (owner 2026-11-03): lines before a beat's first action have no picture of their own
{
  const lead={id:"lead",no:3,title:"Purser"};
  const D=(beat,type,text)=>({beat,type,text});
  const lb=[D(2,"char","OTTAVIO"),D(2,"dia","Portoferraio, Marmorica. Repeat procedure for ticketless passengers."),
    D(2,"char","PORT POLICE (V.O.)"),D(2,"paren","(filtered)"),D(2,"dia","Met at the ramp. Every one."),
    A(2,"Ottavio holds Aurelio's eyes through every word."),D(2,"char","AURELIO"),D(2,"dia","Quiet night. I'll sweep the upper deck."),
    A(2,"He is already half-turned to the door."),
    D(5,"char","OTTAVIO (V.O.)"),D(5,"paren","(filtered, from Aurelio's belt)"),D(5,"dia","Possible stowaway, stern sector."),
    A(5,"The lifejacket locker BANGS open. Nives bolts barefoot across wet steel."),
    A(5,"Aurelio halts three steps short, ticket punch still in his fist.")];
  const lopts={drafts:{lead:{version:1,blocks:lb}},characters,beatsMap:{}};
  const two=box.shotBeatMoments(lead,2,lopts);
  check(two.length===1&&/Portoferraio/.test(two[0].text)&&two[0].openingAction==="Ottavio holds Aurelio's eyes through every word.","A radio call before the first action joins that action's moment (one moment, no empty moment 1)");
  const five=box.shotBeatMoments(lead,5,lopts);
  check(five.length===2&&/Possible stowaway/.test(five[0].text)&&/locker BANGS/.test(five[0].openingAction)&&/Aurelio halts/.test(five[1].openingAction),"A voice-over before the first action is heard over moment 1");
  // a beat split before the fix: moment 1 (the call) + moments 2 and 3 → the repeat goes to Recently deleted, the rest renumbered
  const p5={id:"p5",sceneId:"lead",beatN:5,keyframeMode:"beat-opening",order:4,moment:{n:1,of:3},action:"The lifejacket locker BANGS open. Nives bolts barefoot across wet steel."};
  const r2={id:"r2",sceneId:"lead",beatN:5,keyframeMode:"moment",order:4.02,moment:{n:2,of:3},action:"The lifejacket locker BANGS open. Nives bolts barefoot across wet steel.",beatScript:"The lifejacket locker BANGS open. Nives bolts barefoot across wet steel."};
  const r3={id:"r3",sceneId:"lead",beatN:5,keyframeMode:"moment",order:4.03,moment:{n:3,of:3},action:"Aurelio halts three steps short, ticket punch still in his fist.",beatScript:"Aurelio halts three steps short, ticket punch still in his fist."};
  const fx=box.beatMomentShots(lead,[p5,r2,r3],{...lopts,stamp:"f"});
  check(fx.removed.map(x=>x.id).join()==="r2"&&fx.added===0,"The moment card that repeated the opening frame is removed (the app keeps it in Recently deleted)");
  const nr3=fx.shots.find(x=>x.id==="r3"), np5=fx.shots.find(x=>x.id==="p5");
  check(nr3.moment.n===2&&nr3.moment.of===2&&np5.moment.n===1&&np5.moment.of===2&&fx.renumbered.join()==="r3","The others take their moment's number");
  // a beat that is now one moment: its moment card goes, the opening shot is a plain beat opening again
  const p2={id:"p2",sceneId:"lead",beatN:2,keyframeMode:"beat-opening",order:1,moment:{n:1,of:2},action:"Ottavio holds Aurelio's eyes through every word."};
  const q2={id:"q2",sceneId:"lead",beatN:2,keyframeMode:"moment",order:1.02,moment:{n:2,of:2},action:"Ottavio holds Aurelio's eyes through every word."};
  const fy=box.beatMomentShots(lead,[p2,q2],{...lopts,stamp:"g"});
  check(fy.removed.map(x=>x.id).join()==="q2"&&fy.shots.length===1&&!fy.shots[0].moment,"A beat that is one moment again keeps only its opening shot");
  // Final Ramp's split is untouched
  const kept=box.beatMomentShots(scene,box.beatMomentShots(scene,[primary],{...opts,stamp:"k"}).shots,opts);
  check(!kept.removed.length&&!kept.renumbered.length&&kept.added===0,"A beat split correctly is left as it is");
  check(/const trashMomentRepeats=/.test(app)&&/trashMomentRepeats\(out\.removed\)/.test(app)&&/trashMomentRepeats\(removed\)/.test(app)&&/merged\.archived=\[\.\.\.merged\.archived,\.\.\.out\.removed\]/.test(app),"Every split path keeps removed cards in Recently deleted");
}
// 9 · the Stage renders each moment as a whole (2026-11-03: Final Ramp's 01A was blocked as a "partial beat" with no
// Covers, and 01C because the opening shot still carried moment 3's line from before the split)
{
  const st=read("app/stage.jsx");
  const fn=(name,end)=>st.slice(st.indexOf("function "+name+"("),st.indexOf(end,st.indexOf("function "+name+"(")));
  vm.runInContext([fn("stageBeatOpeningShot","\nfunction stageDeliveryIsRemote"),fn("stageDeliveryIsRemote","\nfunction stageDeliveryIsText"),
    fn("stageDeliveryIsText","\nfunction stageBeatSource"),fn("stageBeatSource","\n/*"),
    fn("stageCurrentScreenplayDirection","\nfunction stageDialogueAssignmentKey")].join("\n")
    +"\nthis.stageCurrentScreenplayDirection=stageCurrentScreenplayDirection;",box);
  const sctx={drafts,characters,beatsMap:{}};
  const p1={...primary,moment:{n:1,of:4},dialogue:"Last one, Bassi."}, peers=[p1,m(2),{...m(3),dialogue:"Last one, Bassi."},m(4)];
  const d1=box.stageCurrentScreenplayDirection(scene,p1,sctx,peers,false);
  check(d1&&!d1.blocked&&/Headlights/.test(d1.text||d1.script||JSON.stringify(d1)),"A split beat's opening clip renders moment 1 whole, without Covers");
  const d3=box.stageCurrentScreenplayDirection(scene,peers[2],sctx,peers,false);
  check(d3&&!d3.blocked,"Moment 3's line is its own, even though the opening shot still carries it from before the split");
  check(/const ownMoment=stageBeatOpeningShot\(sh\)&&/.test(st)&&/\(\(ownMoment\|\|!group\.length\)\?\[sh\]:group\)/.test(st),"The Stage reads a moment as its own unit");
}
// 10 · a screenplay-given cast is AUTO (2026-11-03, "Slack Water"): it follows the screenplay; only a hand pick pins it
{
  const made=box.beatMomentShots(scene,[{...primary,referenceCharactersSet:true,referenceCharactersAuto:true}],{...opts,stamp:"a"}).shots.filter(x=>x.keyframeMode==="moment");
  check(made.length===3 && made.every(x=>x.referenceCharactersSet===true && x.referenceCharactersAuto===true),"A moment's cast is marked as the screenplay's (auto)");
  // the screenplay now has nobody in moment 2's place but Aurelio; an auto pin that says Ottavio too follows the screenplay
  const m2=made.find(x=>x.moment.n===2);
  const ids=box.inFrameCast({...m2,referenceCharacterIds:["aurelio","ottavio"]},scene,characters,opts);
  check(JSON.stringify(ids)==='["aurelio"]',"An auto pin follows the screenplay ("+JSON.stringify(ids)+")");
  const hand=box.inFrameCast({...m2,referenceCharactersAuto:false,referenceCharacterIds:[]},scene,characters,opts);
  check(JSON.stringify(hand)==="[]","A hand pick (no one) still wins over the screenplay");
  check(/picks = n\(x=>x && x\.referenceCharactersSet && !x\.referenceCharactersAuto\)/.test(app),"A re-draft only counts casts picked by hand");
  const refs=read("app/stage-references.jsx");
  check(/if\(sh\.referenceCharactersSet&&!sh\.referenceCharactersAuto&&screenplay&&screenplay\.hasSource\)/.test(refs),"The Stage never warns about an auto cast as a manual selection");
}
console.log(`PASS beat moments: ${checks} split, prompt, chain and Stage checks`);

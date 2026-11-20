#!/usr/bin/env node
/*
 * Clip length and where each line lands (owner 2026-10-25, "go with A, then C"):
 *  A — a beat-opening clip is timed from its screenplay in page order (stage-plan.jsx beatTimeline): action
 *      paragraphs and lines one after another, fitted to the engine's limit by pacing the estimated action;
 *      the prompt, the Mix and the Timeline use those moments.
 *  C — once a take exists its soundtrack is heard (stage-speech.js) and its lines follow the speech heard.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const noop=()=>{};
const box={
  console,setTimeout,clearTimeout,requestAnimationFrame:noop,
  React:new Proxy({createElement:()=>null},{get:(o,k)=>o[k]||noop}),
  localStorage:{getItem:()=>null,setItem:noop},navigator:{},location:{},
  document:{createElement:()=>({}),addEventListener:noop,removeEventListener:noop,body:{appendChild:noop}},
  addEventListener:noop,removeEventListener:noop,dispatchEvent:noop,CustomEvent:class{}
};
box.window=box;box.globalThis=box;
vm.createContext(box);
for(const file of ["app/shot-screenplay.js","app/shot-scene-context.js","app/stage-screenplay.js","app/stage-plan.jsx",
  "app/stage-references.jsx","app/stage-director-brief.js","app/stage-speech.js","app/stage.jsx"])
  vm.runInContext(readFileSync(file,"utf8"),box,{filename:file});
const stage=readFileSync("app/stage.jsx","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,400)); process.exit(1); } pass++; console.log("PASS "+name); };

const scene={id:"s1",loc:"INT. MARMORICA - CAR DECK - NIGHT"};
const characters=[{id:"o",name:"Ottavio Spadoni"},{id:"a",name:"Aurelio Bassi"}];
const beat=(blocks)=>({s1:{version:1,blocks:[{beat:1,type:"scene",text:scene.loc},...blocks.map(b=>({beat:1,...b}))]}});
const ramp=beat([
  {type:"action",text:"Sodium light. Diesel haze. Headlights crawl up the ramp into the hold."},
  {type:"action",text:"Aurelio punches tickets without looking up and waves a dented white Panda through by its bumper."},
  {type:"char",text:"OTTAVIO"},{type:"dia",text:"Last one, Bassi."},
  {type:"action",text:"The ramp groans up behind the last car and seals the hold."}]);
const shot={id:"x",sceneId:"s1",beatN:1,keyframeMode:"beat-opening",dur:5};
const opts=(drafts,extra)=>({modelId:"seedance-2.0",maxSeconds:15,scene,drafts,characters,beatsMap:{},...(extra||{})});

t("A1 the beat is timed in page order: the line lands after the action that comes before it", ()=>{
  const p=box.stageBuildTimedPlan([shot],opts(ramp));
  const seg=p.units[0].segments.map(x=>[x.kind,x.start,x.end]);
  assert.equal(JSON.stringify(seg),JSON.stringify([["action",0,3.43],["action",3.43,8],["line",8.3,9.55],["action",9.85,13.28]]));
  assert.equal(p.durationSec,14);   // it was 4 s: the line alone
  assert.equal(p.issues.length,0);
});
t("A2 a voiced line takes its recorded length; a recording of one of the beat's lines is not 'stale'", ()=>{
  const voiced={...shot,lineAudio:{text:"Last one, Bassi.",durationMs:2000}};
  const p=box.stageBuildTimedPlan([voiced],opts(ramp));
  const line=p.units[0].segments.find(x=>x.kind==="line");
  assert.equal(line.end-line.start,2); assert.equal(line.recorded,true);
  assert.ok(!p.issues.some(i=>i.code==="stale-audio"));
  const old=box.stageBuildTimedPlan([{...shot,lineAudio:{text:"First one, Bassi.",durationMs:2000}}],opts(ramp));
  assert.ok(old.issues.some(i=>i.code==="stale-audio"&&i.blocking));
  const native=box.stageBuildTimedPlan([voiced],opts(ramp,{audioMode:"native"}));
  assert.equal(native.units[0].segments.find(x=>x.kind==="line").recorded,false);
});
t("A3 a beat longer than the engine is paced to fit: lines, order and length of each line kept", ()=>{
  const long="He checks every lashing chain along the port lane, kneels at each wheel chock, tugs it twice, and moves on without hurry.";
  const drafts=beat([{type:"action",text:long},{type:"action",text:long},{type:"char",text:"OTTAVIO"},{type:"dia",text:"Last one, Bassi."},{type:"action",text:long}]);
  const p=box.stageBuildTimedPlan([shot],opts(drafts));
  const u=p.units[0];
  assert.ok(u.pageSec>15,"the page asks for more"); assert.equal(u.paced,true);
  assert.ok(p.durationSec<=15 && !p.over, "fits Seedance 2.0: "+p.durationSec);
  assert.equal(u.segments.map(x=>x.kind).join(","),"action,action,line,action");
  const line=u.segments.find(x=>x.kind==="line");
  assert.equal(Math.round((line.end-line.start)*100)/100,1.25);
  assert.ok(u.segments.filter(x=>x.kind==="action").every(x=>x.end-x.start>=1.5-1e-9));
  const on25=box.stageBuildTimedPlan([shot],{...opts(drafts),modelId:"seedance-2.5",maxSeconds:30});
  assert.equal(on25.units[0].paced,false);   // the 30 s engine takes the page's own pace
});
t("A4 a beat that can't fit even at the fastest pace is still blocked", ()=>{
  const many=[]; for(let i=0;i<12;i++) many.push({type:"action",text:"Marcus crosses the workshop and checks the locked drawer once more "+i+"."});
  const p=box.stageBuildTimedPlan([shot],opts(beat(many)));
  assert.ok(p.over && p.issues.some(i=>i.code==="over-duration"));
  assert.equal(p.durationSec,18);   // 12 paragraphs × 1.5 s
});
t("A5 the prompt gives each moment its time and says to start each line at its moment", ()=>{
  const p=box.stageBuildTimedPlan([shot],opts(ramp));
  const source=box.shotBeatScreenplay(scene,1,{drafts:ramp,characters,beatsMap:{}});
  const clip={id:"c",scene,data:{shots:[shot],cast:[],beatScripts:{1:source},beatDialogues:{1:source.dialogue},panelLines:[]}};
  const brief=box.seedanceDirectorBrief(clip,[shot],shot,false,[],{},{renderPlan:p});
  assert.ok(brief.includes("0–3.4s · Sodium light."),brief.slice(0,600));
  assert.ok(brief.includes("8.3–9.6s · [D1 — Ottavio Spadoni]"));
  assert.ok(brief.includes("start each line at its moment"));
});
t("A6 the Mix and the Timeline place the line at its moment in the clip's plan", ()=>{
  const p=box.stageBuildTimedPlan([shot],opts(ramp));
  const clip={id:"c",scene,g:{plan:p},data:{shots:[{...shot,dialogue:""}],panelLines:[],
    lineShots:[{...shot,dialogue:"Last one, Bassi.",lineSpeaker:{id:"o",name:"OTTAVIO SPADONI"}}]}};
  const pl=box.stageClipLinePlacements(clip,{},characters);
  assert.equal(pl.length,1); assert.equal(pl[0].at,8.3); assert.equal(pl[0].sec,1.3);
});
t("A7 any length: a shorter one paces the action, the line keeps its length; too short for the line is refused", ()=>{
  const p10=box.stageBuildTimedPlan([shot],{...opts(ramp),durationSec:10});
  assert.equal(p10.durationSec,10); assert.equal(p10.paced,true);
  assert.ok(p10.issues.some(i=>i.code==="paced-to-duration"&&!i.blocking) && !p10.issues.some(i=>i.blocking));
  const line=p10.units[0].segments.find(x=>x.kind==="line");
  assert.equal(Math.round((line.end-line.start)*100)/100,1.25);
  assert.equal(p10.units[0].segments.map(x=>x.kind).join(","),"action,action,line,action");
  const p4=box.stageBuildTimedPlan([shot],{...opts(ramp),durationSec:4});
  assert.ok(p4.issues.some(i=>i.code==="duration-too-short"&&i.blocking&&/even with its action paced/.test(i.message)));
  const stage2=readFileSync("app/stage.jsx","utf8");
  assert.ok(stage2.includes('(plannedSec>0 && v===plannedSec) ? " · planned"'));
  assert.ok(stage2.includes("const durationFloorSec = Math.max(4, durationLocked ? Math.ceil(measuredSec) : 0);"));
  assert.ok(readFileSync("app/ai.jsx","utf8").includes("click it for a 'Choose duration' box and type any length"));
});
t("C1 speech is found where the voice band is loud; a low hum and silence are not speech", ()=>{
  const n=250, band=[], full=[];   // 5 s of 20 ms frames
  for(let i=0;i<n;i++){ const sec=i*0.02;
    const voice=sec>=2&&sec<3.2, hum=sec>=0.5&&sec<1.5;
    band.push(voice?1e-2:hum?1e-6:1e-7); full.push(voice?1.4e-2:hum?5e-2:1e-6); }
  assert.equal(JSON.stringify(box.stageSpeechRegions(band,full,0.02)),"[[2,3.2]]");
});
t("C2 lines take the nearest speech in order; a take's lines follow the speech heard", ()=>{
  assert.equal(JSON.stringify(box.stageMatchHeard([{at:1},{at:8}],[[0.9,2],[7.2,8],[9,9.5]])),"[0.9,7.2]");
  assert.equal(JSON.stringify(box.stageMatchHeard([{at:1},{at:8}],[[5,6]])),"[5,null]");
  const p=box.stageBuildTimedPlan([shot],opts(ramp));
  const clip={id:"c",scene,g:{plan:p},data:{shots:[{...shot,dialogue:""}],panelLines:[],
    lineShots:[{...shot,dialogue:"Last one, Bassi.",lineSpeaker:{id:"o",name:"OTTAVIO SPADONI"}}]}};
  const early=box.stageTakeLinePlacements(clip,{},characters,{speechHeard:{regions:[[2.1,3]]}},"u");
  assert.equal(early[0].at,2.1); assert.equal(early[0].plannedAt,8.3); assert.equal(early[0].heardAt,2.1);
  const close=box.stageTakeLinePlacements(clip,{},characters,{speechHeard:{regions:[[8.4,9.6]]}},"u");
  assert.equal(close[0].at,8.3);   // within 0.3 s: the plan stands
  const none=box.stageTakeLinePlacements(clip,{},characters,{speechHeard:{regions:[]}},"u");
  assert.equal(none[0].notHeard,true);
  const silent=box.stageTakeLinePlacements(clip,{},characters,{speechHeard:{regions:[],noAudio:true}},"u");
  assert.ok(!silent[0].notHeard);
});
t("C3 the Takes tab hears the picked take, keeps the result with it and says where each line was heard", ()=>{
  assert.ok(stage.includes("window.stageHearSpeech(sel.url).then(r=>{"));
  assert.ok(stage.includes("if(!readOnly && typeof window.vidUpdateTake===\"function\") window.vidUpdateTake(clipId, sel.url, { speechHeard:r });"));
  assert.ok(stage.includes('...(speechText ? [["Speech", speechText]] : []),'));
  assert.ok(stage.includes("the model may have left a line out. Play it before you use it; Details \\u203a Speech says which."));
});
t("C4 the Mix hears its scene's takes, keeps the result and redraws when one is heard", ()=>{
  assert.ok(stage.includes('window.addEventListener("stage-speech-heard", h);'));
  assert.ok(stage.includes("if(m.speechHeard || !(((c.data||{}).lineShots)||[]).length) return;"));
  assert.ok(stage.includes('_stEl(StageAudioView,{ key:"au", allClips, vids, staleVids, identityVids, noteVids, vidsLoaded, auds, characters, selId, onSelectClip, readOnly })'));
});
t("Frances knows; the files load", ()=>{
  assert.ok(ai.includes("Clip length and where each line lands (Stage)"));
  assert.ok(["20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('<script src="app/stage-speech.js?v='+k+'"></script>')));
  assert.ok(["20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('app/stage-plan.jsx?v='+k+'"')));
  assert.ok(html.indexOf("app/stage-speech.js")<html.indexOf("app/stage.jsx"));
});
console.log(pass+" passed, 0 failed");

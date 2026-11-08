#!/usr/bin/env node
/* WHO IS IN A BEAT'S OPENING FRAME (2026-10-25, owner: "no character reference in beat 1 … have the actual character in
   the keyframe instead of having AI generate a random character"): an establishing first paragraph that names nobody
   looks at the next three action paragraphs for the people already there; an entrance, a door, the first line of
   dialogue or a first paragraph with someone in it stop it (a reveal stays a reveal). Also: the Stage player's
   full-screen button is always shown. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const box={console}; box.window=box; vm.createContext(box);
vm.runInContext(readFileSync("app/shot-screenplay.js","utf8"),box);
const css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
const scene={id:"s1",loc:"INT. FERRY - NIGHT"};
const characters=[{id:"aurelio",name:"Aurelio Bassi"},{id:"ottavio",name:"Ottavio Spadoni"},{id:"mara",name:"Mara"}];
const open=(blocks)=>JSON.stringify(box.shotBeatScreenplay(scene,1,{drafts:{s1:{version:1,blocks:[{beat:1,type:"scene",text:scene.loc},...blocks.map(b=>({beat:1,...b}))]}},characters,beatsMap:{}}).openingCharacterIds);
const A=(text)=>({type:"action",text});
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,300)); process.exit(1); } pass++; console.log("PASS "+name); };
t("an establishing line, then the people already at work, are the opening cast", ()=>{
  assert.equal(open([A("Sodium light. Diesel haze. Headlights crawl up the ramp into the hold."),
    A("AURELIO BASSI (mid 60s) punches tickets without looking up."), A("CLICK. A dented white Panda."),
    A("OTTAVIO SPADONI (late 40s), the purser, ticks his clipboard.")]), '["aurelio","ottavio"]');
});
t("an entrance, a door or the first line of dialogue stops it", ()=>{
  assert.equal(open([A("The kitchen is dark."), A("Mara walks in and flips the light.")]), "[]");
  assert.equal(open([A("Amber night-lamps. Empty benches."), A("The deck door BANGS. Ottavio Spadoni drags a torch beam low.")]), "[]");
  assert.equal(open([A("Rain on the glass."), {type:"char",text:"OTTAVIO"}, {type:"dia",text:"Last one."}, A("Aurelio Bassi looks up.")]), "[]");
});
t("a first paragraph with someone in it is no establishing line: a reveal stays a reveal", ()=>{
  assert.equal(open([A("The lifejacket locker. He swings it open, counting vests."), A("Two bare feet."), A("Mara, asleep, presses an envelope to her chest.")]), "[]");
});
t("a first paragraph that names someone is unchanged; only three paragraphs are read ahead", ()=>{
  assert.equal(open([A("Mara sits alone."), A("Aurelio Bassi watches from the door.")]), '["mara"]');
  assert.equal(open([A("Fog."), A("Gulls."), A("A horn."), A("Rain."), A("Aurelio Bassi coils a rope.")]), "[]");
});
t("the Stage player's full-screen button is always shown", ()=>{
  assert.ok(css.includes("  opacity:1;transition:opacity .15s,background .15s}"));
  assert.ok(!css.includes(".stage2-fs-wrap:hover .stage2-player-fs"));
});
t("Frances knows; keys", ()=>{
  assert.ok(ai.includes('name:"Who is in a beat\'s opening frame"'));
  assert.ok(["20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('app/shot-screenplay.js?v='+k+'"')));
});
console.log(pass+" passed, 0 failed");

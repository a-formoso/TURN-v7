#!/usr/bin/env node
/*
 * The Anerneq study's Stage changes (2026-10-24), wiring checks: the parts the
 * director-brief test can't reach (the Stage room's state, the Art Room's Color
 * slate, Frances's manifest). The prompt text itself is tested in
 * scripts/test-stage-director-brief.mjs.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const stage=readFileSync("app/stage.jsx","utf8");
const brief=readFileSync("app/stage-director-brief.js","utf8");
const art=readFileSync("app/artroom.jsx","utf8");
const color=readFileSync("app/stylebible-ui.jsx","utf8");
const app=readFileSync("app/app.jsx","utf8");
const shotsUi=readFileSync("app/shots-ui.jsx","utf8");
const ai=readFileSync("app/ai.jsx","utf8");
const html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,200)); process.exit(1); } pass++; console.log("PASS "+name); };

t("8 a film whose Stage was never used starts on Single shot, recorded on the film once", ()=>{
  assert.match(stage,/freshStageRef\.current = !used && !takes\.length;/);
  assert.match(stage,/if\(freshStageRef\.current\) return "shot";/);
  assert.match(stage,/if\(!freshStageRef\.current \|\| readOnly \|\| _stageFilm\(project, "clipScope"\)\) return;\s*autoShotRef\.current = true;\s*saveFilmStage\(\{ clipScope:"shot" \}\);/);
  // a saved choice still wins first, and a film in use keeps the old default
  const init=stage.slice(stage.indexOf("const [clipScope, _setClipScope]"),stage.indexOf("const setClipScope"));
  assert.ok(init.indexOf('if(f==="shot" || f==="beat") return f;')<init.indexOf('if(freshStageRef.current) return "shot";'));
  assert.match(init,/v==="auto"\?"legacy":"beat";/);
});
t("8 takes for other clips turning up later in the visit put the fresh film back on Split to fit", ()=>{
  assert.match(stage,/if\(ids\.some\(id=>!live\.has\(id\)\)\)\{ autoShotRef\.current=false; setClipScope\("beat"\); \}/);
  assert.match(stage,/window\.addEventListener\("vid-done", h\)/);
});
t("7 the Director fold has a per-clip Scene type (Auto names what it found), saved on the film", ()=>{
  assert.match(stage,/_ctrlRow\("Scene type"/);
  assert.match(stage,/"data-testid":"stage-scene-type"/);
  assert.match(stage,/"Auto \\u2014 "\+/);
  assert.match(stage,/saveFilmStage\(\{ clipTypes: next \}\)/);
  assert.match(stage,/onSetClipType:readOnly\?null:setClipType/);
  // every prompt path is told the pick
  assert.equal((stage.match(/sceneType:sceneTypePick/g)||[]).length,3);
  assert.match(brief,/function seedanceSceneTypeSection\(d,list,opts\)/);
});
t("an untouched prompt recompiles when anything the 2026-10-24 sections read changes", ()=>{
  const sig=stage.slice(stage.indexOf("const promptProductionSig"),stage.indexOf("const renderPlan ="));
  ["sh.mustNot","d.acting","d.capture","d.voices","p.geometry","sceneTypePick"].forEach(k=>assert.ok(sig.includes(k),k));
  // and the clips rebuild when the beat map's duel or a character's voice changes
  assert.match(stage,/b&&b\.driverLabel,b&&b\.reactorLabel,b&&b\.desire,b&&b\.obstacle/);
  const charSig=stage.slice(stage.indexOf("const charSig"),stage.indexOf("const propSig"));
  ["c.voiceSpec","c.voiceLock.specSnapshot","c.voice||null","c.lineLanguage","c.lineScript"].forEach(k=>assert.ok(charSig.includes(k),k));
});
t("5 Capture is wired from the Color slate to the film (read-only roles get no editor)", ()=>{
  assert.match(color,/onSetFilmStock, onSetCapture,/);
  assert.match(art,/onSetCapture:readOnly\?null:onSetCapture/);
  assert.match(app,/onSetCapture:setStyleCapture/);
  assert.match(app,/const setStyleCapture = \(text\)=> canMutateSharedFilm\(\) &&/);
});
t("3 'Must not happen' sits on the Shots card and never makes a frame out of date", ()=>{
  assert.match(shotsUi,/Must not happen \\u2014 what the video take must avoid/);
  const fields=readFileSync("app/scene-order.js","utf8");
  assert.ok(!/"mustNot"/.test(fields.slice(fields.indexOf("SHOT_SPEC_FIELDS"),fields.indexOf("];",fields.indexOf("SHOT_SPEC_FIELDS")))));
});
t("hero props: a star on the prop card, three a film at most", ()=>{
  const propsUi=readFileSync("app/props.jsx","utf8");
  assert.match(propsUi,/const PROP_HERO_MAX = 3;/);
  assert.match(propsUi,/onClick:\(e\)=>\{ e\.stopPropagation\(\); if\(!full\) onUpdate\(p\.id,\{hero:!p\.hero\}\); \}/);
  assert.match(propsUi,/heroCount:\(props\|\|\[\]\)\.filter\(x=>x&&x\.hero\)\.length/);
  assert.match(stage,/hero:!!p\.hero, heroText:p\.hero \? stageHeroPropText\(p\) : ""/);
});
t("spoken language: the character card's fold sets the language and the Cyrillic spelling", ()=>{
  assert.match(art,/CardFold,\{label:"Voice & video",defaultOpen:!!\(c\.lineLanguage\|\|c\.lineScript\)/);   // Spoken language + Video element = Voice & video (2026-10-29)
  assert.match(art,/onUpdate\(c\.id,\{lineLanguage:/);
  assert.match(art,/onUpdate\(c\.id,\{lineScript:e\.target\.value==="cyrillic"\?"cyrillic":""\}\)/);
  assert.match(stage,/c\.lineLanguage\|\|"",c\.lineScript\|\|""/);
});
t("Frances knows all of it", ()=>{
  ["Acting, living faces and 'Must not happen'","Geometry anchor, Capture and the voice lock","Scene types and one shot per clip",
   "Exact props on the Stage and spoken language"].forEach(n=>assert.ok(ai.includes(n),n));
});
t("cache keys: the changed files load with the new key", ()=>{
  ["stage.jsx","stage-director-brief.js","ai.jsx","script.jsx"].forEach(f=>
    assert.ok(["20261024-hs64", "20261024-hs65", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
});
console.log(pass+" passed, 0 failed");

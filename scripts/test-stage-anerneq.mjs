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
  assert.match(art,/CardFold,\{label:"Spoken language"/);
  assert.match(art,/onUpdate\(c\.id,\{lineLanguage:/);
  assert.match(art,/onUpdate\(c\.id,\{lineScript:e\.target\.value==="cyrillic"\?"cyrillic":""\}\)/);
  assert.match(stage,/c\.lineLanguage\|\|"",c\.lineScript\|\|""/);
});
t("Frances knows all of it", ()=>{
  ["Acting, living faces and 'Must not happen'","Geometry anchor, Capture and the voice lock","Scene types and one shot per clip",
   "Hero props and spoken language"].forEach(n=>assert.ok(ai.includes(n),n));
});
t("cache keys: the changed files load with the new key", ()=>{
  ["stage.jsx","stage-director-brief.js","ai.jsx","script.jsx"].forEach(f=>
    assert.ok(["20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
});
console.log(pass+" passed, 0 failed");

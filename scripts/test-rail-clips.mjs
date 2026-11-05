#!/usr/bin/env node
/* The Scenes rail as "clips you can see" (2026-10-24, owner — rail option A). Source checks; the browser
   test (test-stage-browser) clicks its beat rows and scene rows. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const stage=readFileSync("app/stage.jsx","utf8"), css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
const dec=x=>String(x).replace(/\\u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
// (2026-11-03, mobile step 4) the row takes a part ("head" / "body") for the narrow screen's compact strip
const r=dec(stage.slice(stage.indexOf("const sceneRow = (scene, part)=>{"), stage.indexOf('const rail = _stEl("div",{className:"stage2-rail"+(compactRail?" compact":"")},')));
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,200)); process.exit(1); } pass++; console.log("PASS "+name); };
t("R1 every other scene: a mini strip of its clips (frame, ✓ when rendered, dashed when no frame)", ()=>{
  assert.ok(r.includes('if(!isOpen) return sceneClips.length>0 && _stEl("div",{className:"stage2-rail-mini","aria-hidden":"true"},'));
  assert.ok(r.includes('className:"stage2-rail-mini-th"+(fr?"":known?" none":" unknown")+(ok?" done":"")'));
  // a scene that isn't open never claims "no frame" before its images load (2026-10-09)
  assert.ok(r.includes("const known = hydrated || !!fr;") && r.includes("its images load when you open this scene"));
});
t("R2 the open scene: its clips as cards with code · length and the state in words", ()=>{
  assert.ok(r.includes('className:"stage2-clip-card"+(on?" on":"")+(rendered?" done":"")'));
  assert.ok(["\"Ready to render\"","\"No frame — Shots\"","\"Rendered · take notes\"","\"Rendered\""].every(x=>r.includes(x)));
  assert.ok(r.includes('_stEl("b",null, c.label+" · "+_fmtSecs(Math.round(secs)))'));
});
t("R3 a card's beats still pick their own first shot; the card picks the clip", ()=>{
  assert.ok(r.includes("onClick:()=>{ if(c.id!==clip.id) onSelectClip(c.id); setSelShotId(bt.shots[0].id); }"));
  assert.ok(r.includes("onClick:()=>{ if(c.id!==clip.id) onSelectClip(c.id); if(shotsIn[0]) setSelShotId(shotsIn[0].id); }"));
  assert.ok(!r.includes("stage2-beat-dot") && !r.includes("stage2-clip-chip-glyph"), "no signs to decode");
});
t("R4 styles and Frances", ()=>{
  assert.ok(css.includes(".stage2-clip-state.warn{") && css.includes(".stage2-rail-mini-th.none::after{"));
  assert.ok(ai.includes("CLIPS YOU CAN SEE, 2026-10-24, owner"));
});
t("R5 cache keys", ()=>{ ["stage.jsx","ai.jsx","script.jsx","styles.css"].forEach(f=>assert.ok(["20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f)); });
console.log(pass+" passed, 0 failed");

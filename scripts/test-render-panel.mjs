#!/usr/bin/env node
/* Render settings as a price card and three tabs (2026-10-24, owner — panel option A). Source checks; the
   browser test (test-stage-browser) drives the tabs by name (Settings / Direction / Inputs). */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const stage=readFileSync("app/stage.jsx","utf8"), css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,200)); process.exit(1); } pass++; console.log("PASS "+name); };
t("P1 three tabs, every one mounted (the inactive hidden), Settings first", ()=>{
  assert.ok(stage.includes('const panelTabs = [["settings","Settings"],["direction","Direction"],["inputs","Inputs"]];'));
  assert.ok(stage.includes('className:"stage2-ptab-pane",hidden:(panelTab||"settings")!==id}'));
  assert.ok(stage.includes('React.useState("settings"); // Render-settings panel tab'));
});
t("P2 the price card shows the balance it comes out of", ()=>{
  assert.ok(stage.includes('" credits left") : ""'));
  assert.ok(stage.includes('_stEl("div",{className:"stage2-rc-balance",role:"img",'));
});
t("P3 the engine's limits beside the controls: resolution note and an ⓘ by Engine", ()=>{
  assert.ok(stage.includes('resNote && _stEl("div",{className:"stage2-capnote"}'));
  assert.ok(stage.includes('_stEl(window.InfoTip,{label:"What "+model.label+" can do",'));
  assert.ok(!stage.includes('"What "+model.label+" can do"),onClick:()=>setCapsOpen'), "the fold is gone");
});
t("P4 the price shows once: no hint; the foot line only for Extend / Edit / Motion", ()=>{
  assert.ok(!stage.includes('composer \\u2014 its button carries this render\'s price.'));
  assert.ok(stage.includes('(composerTab!=="create" || createTask!=="reference" || footerCredit.short) && _stEl("div",{className:"stage2-credit sd-gen-credit"'));
});
t("P5 Inputs: the assets summary cards are gone; the 'added at render' text folds", ()=>{
  assert.ok(!stage.includes('_stEl("label",{className:"sd-gen-label"},"Assets summary")'));
  assert.ok(stage.includes('_stEl("summary",null,"What\'s added to the prompt at render")'));
});
t("P6 styles, Frances and keys", ()=>{
  assert.ok(css.includes(".stage2-ptab-pane[hidden]{display:none}") && css.includes(".stage2-rc-balance i{"));
  assert.ok(ai.includes("RENDER SETTINGS, PRICE CARD AND THREE TABS (2026-10-24, owner)"));
  ["stage.jsx","ai.jsx","script.jsx","styles.css"].forEach(f=>assert.ok(["20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
});
console.log(pass+" passed, 0 failed");

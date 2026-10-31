#!/usr/bin/env node
/* Takes as a contact sheet (2026-10-24, owner — Takes option A). Source checks on StageVersionsView; the
   browser test (test-stage-browser) opens it with two takes and compares them side by side. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const stage=readFileSync("app/stage.jsx","utf8"), css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
const dec=x=>String(x).replace(/\\u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
const a=stage.indexOf("function StageVersionsView({"), v=dec(stage.slice(a, stage.indexOf("\n}\n", a)));
const has=x=>v.includes(dec(x));
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,200)); process.exit(1); } pass++; console.log("PASS "+name); };
t("T1 one head line (clip, count, filters); no Back arrow, no engine card, no 'Iteration tools' column", ()=>{
  assert.ok(!has('"aria-label":"Back to Shoot"') && !has("modelCard") && !has('"Iteration tools"'));
  assert.ok(has('[["all","All"],["approved","\\u2605 Approved"],["drafts","Drafts"]]'));
});
t("T2 the take in the film beside the picked one; Play both, the film's take muted", ()=>{
  assert.ok(has("const pair = inFilm && sel && inFilm.url!==sel.url ? [inFilm, sel] : (sel ? [sel] : []);"));
  assert.ok(has("v.muted = els.length>1 && i===0;") && has('"▶ Play both"'));
});
t("T3 the action row says what it does: 'Use vN in the film', 'In the film', 'Check and use this take'", ()=>{
  assert.ok(has('flagged ? "Check and use this take" : leftOut ? "Left out \\u2014 shots changed" : sel&&sel.current ? "In the film" : "Use "+vno(sel).toLowerCase()+" in the film"'));
  assert.ok(stage.includes('"In the film now — the scene strip, Timeline, Mix and export use it."'));
  // (2026-10-27) Fix this take joins choose, approve and delete
  assert.equal((v.match(/disabled:readOnly\|\|!sel/g)||[]).length, 4, "choose, approve, Fix this take and delete stay gated");
});
t("T4 the contact sheet: number, ★, In the film, a warning badge, a note mark", ()=>{
  assert.ok(has('className:"stage2-vcard"+(sel&&sel.url===t.url?" sel":"")+(usedByFilm(t)?" infilm":"")'));
  assert.ok(has('usedByFilm(t) ? _stEl("span",{className:"stage2-takes-badge film"},"In the film")') && has('className:"stage2-takes-badge warn"'));
  assert.ok(css.includes(".stage2-takes-a .stage2-takes-sheet{display:grid;"));
});
t("T5 the details fold: settings, note, prompt and references, open unless closed (remembered)", ()=>{
  assert.ok(has('localStorage.getItem("turn_stage_take_details")!=="closed"') && has('"Version details"') && has('"Prompt used"') && has('"References used"'));
});
t("T6 Frances knows the contact sheet", ()=>{ assert.ok(ai.includes("THE CONTACT SHEET (2026-10-24, owner)") && !ai.includes("Branch from version (reuse")); });
t("T7 cache keys", ()=>{ ["stage.jsx","ai.jsx","script.jsx","styles.css"].forEach(f=>assert.ok(["20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f)); });
console.log(pass+" passed, 0 failed");

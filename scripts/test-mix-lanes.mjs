#!/usr/bin/env node
/* The Mix as scene lanes (2026-10-24, owner — Mix option B). Source checks on StageAudioView; the mix's
   playback, levels and bed storage stay pinned by scripts/test-mix-third-pass.mjs. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const stage=readFileSync("app/stage.jsx","utf8"), css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
const dec=x=>String(x).replace(/\\u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
const au=dec(stage.slice(stage.indexOf("function StageAudioView({"),stage.indexOf("/* ================================ the room shell")));
const has=(x)=>au.includes(dec(x));
let pass=0;
const t=(name,fn)=>{ try{ fn(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,200)); process.exit(1); } pass++; console.log("PASS "+name); };
t("B1 one header: the rail's scene, its clips and length, Play scene mix and an ⓘ (no second title bar, no scene menu)", ()=>{
  assert.ok(!has('"voiced lines over the picture · beds under them · exported with the film"') && !has('"aria-label":"Scene to mix"'));
  assert.ok(has('("Scene "+_pad2(sceneNow.no)+" \\u00b7 "+(sceneNow.title||sceneNow.loc||"Scene"))'));
  assert.ok(has('window.InfoTip && _stEl(window.InfoTip,{label:"How the mix works",'));
});
t("B2 the scene on a ruler: clips as long as their takes, lines where they land, a playhead through every lane", ()=>{
  assert.ok(has("const spans = sceneClips.map(spanOf);") && has('style:{left:pct(starts[i]),width:"calc("+pct(spans[i])+" - 2px)"}'));
  assert.ok(has("style:{left:pct(starts[i]+(Number(pl.at)||0)),"));
  assert.ok(has("rendered ? stageTakeLinePlacements(c, auds, characters) : clipLinePlacements(c, auds, characters)"));
  assert.ok((au.match(/playhead\)/g)||[]).length>=3 && has("const headT = cur ? starts[shownIdx] + (auPlay.id===cur.id ? auPlay.t : 0) : 0;"));
});
t("B3 line marks: voiced, not voiced, spoken by the take, re-voiced / past its clip, clip not rendered", ()=>{
  assert.ok(has('className:"stage2-au-line"+(pl.url&&rendered?" ready":"")+(pl.native?" native":"")+(pl.heardAt!=null?" heard":"")+(pl.revoiced?" revoiced":"")+(!rendered?" later":"")+(pl.pastEnd?" past":"")'));
  ["ready","native","revoiced","past","later"].forEach(k=>assert.ok(css.includes(".stage2-au-line."+k),k));
});
t("B4 each lane's name, level and Mute at its left; beds: Import / Replace / Remove there, and a dropped file imports", ()=>{
  assert.ok(has('"aria-labelledby":"au-lab-"+key,"aria-valuetext":levelText(gain[key]),') && has('"aria-label":"Mute "+label,'));
  assert.ok(has('sceneBeds[k] ? "Replace" : "Import"') && has("onClick:()=>removeBed(k)"));
  assert.ok(has("if(f) importBed(k)({ target:{ files:[f], value:\"\" } });") && has('onDragOver:(e)=>{ e.preventDefault(); if(dragK!==k) setDragK(k); }'));
  assert.ok(has('loop ? "100%" : pct(bedDur[k] ? Math.min(sceneLen, bedDur[k]) : sceneLen)'), "music runs for its own length");
});
t("B5 Frances knows the lanes", ()=>{ assert.ok(ai.includes("THE MIX AS SCENE LANES (2026-10-24")); });
t("B6 cache keys", ()=>{ ["stage.jsx","ai.jsx","script.jsx","styles.css"].forEach(f=>assert.ok(["20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f)); });
console.log(pass+" passed, 0 failed");

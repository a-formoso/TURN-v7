#!/usr/bin/env node
/* The Scenes rail as "clips you can see" (2026-10-24, owner — rail option A). Source checks; the browser
   test (test-stage-browser) clicks its beat rows and scene rows. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const stage=readFileSync("app/stage.jsx","utf8"), css=readFileSync("app/styles.css","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
const dec=x=>String(x).replace(/\\u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
const r=dec(stage.slice(stage.indexOf("const sceneRow = (scene)=>{"), stage.indexOf('const rail = _stEl("div",{className:"stage2-rail"},')));
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
t("R5 cache keys", ()=>{ ["stage.jsx","ai.jsx","script.jsx","styles.css"].forEach(f=>assert.ok(["20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f)); });
console.log(pass+" passed, 0 failed");

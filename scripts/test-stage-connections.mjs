#!/usr/bin/env node
/* How the Stage's tabs hand work to each other (2026-10-25 review). Each check pins one fix:
   1 Branch keeps its seed · 2 Takes says "In the film" only when the film uses the take · 3 the Timeline's line
   lane reads the take's own placements, like the Mix · 4 the scene strip leaves out an identity-changed take ·
   5 the Mix follows the rail within a scene · 6 a finished render pulls you into Takes only from Shoot on that
   clip · 8 Reuse keeps the tier on this engine and doesn't promise the recipe; a failed "Use in the film" says so. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const stage=readFileSync("app/stage.jsx","utf8"), ai=readFileSync("app/ai.jsx","utf8"), html=readFileSync("TURN.html","utf8");
const dec=x=>String(x).replace(/\\u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
const src=dec(stage), has=x=>src.includes(dec(x));
const fn=(name, end)=>{ const a=src.indexOf(name); assert.ok(a>=0, name); return src.slice(a, src.indexOf(end, a)); };
let pass=0;
const t=(name,f)=>{ try{ f(); }catch(e){ console.error("FAIL "+name+" — "+String(e.message).slice(0,200)); process.exit(1); } pass++; console.log("PASS "+name); };
t("1 Branch keeps its seed: the per-clip reset skips the moment Shoot opens", ()=>{
  assert.ok(has('const resetKeyRef = React.useRef(clip.id+"|"+activeShot.id);'));
  assert.ok(has('if(resetKeyRef.current===k) return; resetKeyRef.current = k;'));
  // (option B, 2026-10-25) the Reuse effect runs after the reset and after the clip memory, so a Branch's seed wins
  const reuseAt=src.indexOf("setSeedInput(pendingReuse.pin && m.seed!=null ? String(m.seed) : \"\");");
  assert.ok(reuseAt > src.indexOf("const resetKeyRef") && reuseAt > src.indexOf("const memOwnerRef = React.useRef(clip.id);"));
});
t("2 Takes: 'In the film' only for a take the film uses; a current take left out says so", ()=>{
  const v=fn("function StageVersionsView({", "\n}\n");
  assert.ok(v.includes('const usedByFilm = (t)=> !!(t && t.current && !(t.meta&&t.meta.identityChanged) && ["current","override"].includes(versionEditorialStatus(t)));'));
  assert.ok(v.includes('"Current · left out of the film"') && v.includes('leftOut ? "Left out — shots changed"'));
  assert.ok(!/t\.current \? _stEl\("span",\{className:"stage2-takes-badge film"\}/.test(v));
});
t("3 the Timeline's line lane uses the take's own placements for a rendered clip", ()=>{
  const tl=fn("function StageTimelineView(", "/* ---- AUDIO tab");
  assert.ok(tl.includes("pl = vids[c.id] && typeof stageTakeLinePlacements===\"function\" ? (stageTakeLinePlacements(c, auds, characters)||[])"));
  assert.ok(tl.includes('" — spoken by the take itself"') && tl.includes('" — re-voiced since the render, not laid over it"'));
});
t("4 the scene strip leaves out a take whose character identity changed", ()=>{
  assert.ok(has('const usable=!!(current&&["current","override"].includes(sourceStatus)&&!meta.identityChanged);'));
});
t("5 the Mix follows the rail within a scene", ()=>{
  assert.ok(has("React.useEffect(()=>{ if(selInScene<0 || selInScene===clipIdx) return; if(playing) stopAll();"));
  assert.ok(has("setClipIdx(vids[sceneClips[selInScene].id] ? selInScene : -1); }, [selId]);"));
});
t("6 a first take pulls you into Takes only from Shoot, on that clip", ()=>{
  assert.ok(has("setTimeout(()=>onFirstVideo(clipId0), 0)"));
  assert.ok(has('onFirstVideo:(id)=>{ if(stageViewRef.current==="stage" && (!id || selIdRef.current===id)) setStageView("versions"); },'));
});
t("8 Reuse: the tier only from this engine; no recipe promise; a failed 'Use in the film' says so", ()=>{
  assert.ok(has("const tierHere = m.tier && (model.tiers||[]).some(t0=>t0.id===m.tier);") && has("if(tierHere) setTier(m.tier);"));
  assert.ok(!has("bitrate and recipe back into the Stage composer"));
  assert.ok(has('if(!done || done.skipped || !done.url){'));
});
t("7 (option B) Shoot remembers each clip's choices for the session", ()=>{
  assert.ok(has("const shootMemRef = React.useRef(null); if(!shootMemRef.current) shootMemRef.current = new Map();"));
  assert.ok(has("shootMemory:shootMemRef.current,"));
  assert.ok(has("React.useEffect(()=>{ if(shootMemory && memOwnerRef.current) shootMemory.set(memOwnerRef.current, shootSnap); });"));
  // saved under the clip the choices belong to; the restore (declared after the save) moves the owner on
  assert.ok(src.indexOf("shootMemory.set(memOwnerRef.current, shootSnap)") < src.indexOf("memOwnerRef.current = clip.id;"));
  assert.ok(has("const memOwnerRef = React.useRef(null);"), "opening Shoot never saves its defaults over the clip's choices");
  ["tier","resolution","bitrate","seedInput","batchN","durationOverride","endFrameId","aspectOverride","sourceOverride","nativeAudio",
   "dialogueAudio","camera","cameraProfile","lighting","perf","panelTab","composerTab","createTask","extendVideo","editVideo","editPrompt",
   "motionVideo","motionImage","motionTier","sceneControl","motionOrientation","keepOriginalSound","motionPrompt","modeOverride"]
    .forEach(k=>assert.ok(new RegExp("const shootSnap = \\{[^}]*\\b"+k+"\\b").test(src), k));
  // what the engine, tier or plan can't give isn't brought back
  assert.ok(has("const tierOk = !!m.tier && (model.tiers||[]).some(t0=>t0.id===m.tier);") && has("&& planAllowsRes(m.resolution)) setResolution(m.resolution);"));
  assert.ok(has("setBatchN(Math.max(1, Math.min(planMaxBatch, Number(m.batchN)||1)));"));
});
t("Frances and keys", ()=>{
  assert.ok(ai.includes("STAGE TABS, HOW THEY CONNECT (2026-10-25)") && ai.includes("SHOOT REMEMBERS EACH CLIP (2026-10-25, owner)"));
  ["stage.jsx","ai.jsx","script.jsx"].forEach(f=>assert.ok(["20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes("app/"+f+"?v="+k+'"')),f));
});
console.log(pass+" passed, 0 failed");

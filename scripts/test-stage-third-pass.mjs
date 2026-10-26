#!/usr/bin/env node
/* The Stage, third pass (owner 2026-10-09: "go ahead with all of it") — do takes stay findable, does
   paid work land where it should, and does the Stage judge only what a render really sends?
   A  takes: the current take stays when it's approved or a render is collected later; identity-changed
      takes are kept and flagged; the pending list never drops a paid job; earlier groupings come back
      only when you say so; a positional take only moves onto the same shots
   B  money: the batch size reaches the server; a failure says nothing was charged; a still-running take
      isn't "failed"; the reference-video hold is shown; takes past 20 ask first; honest result toasts
   C  inputs: a loading frame isn't missing; only the frames a render sends are judged; prop state sheets
      load; Extend / Edit / Motion takes record shots and look; a take records only what was sent
   D  one set of take notes everywhere; the Breakdown's counts are keyed by the open film; prompt drafts
   E  rights, copy, accessibility, Frances
     node scripts/test-stage-third-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
const fn = (src, name)=>{ const i = src.indexOf("function "+name+"("); assert.ok(i>=0, name); const k = src.lastIndexOf("\n", i)+1; return src.slice(k, src.indexOf("\n}\n", i)+3); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};

const stage = read("app/stage.jsx"), vg = read("app/videogen.jsx"), app = read("app/app.jsx"), bd = read("app/breakdown.jsx"),
  ai = read("app/ai.jsx"), plan = read("app/stage-plan.jsx"), refs = read("app/stage-references.jsx"), html = read("TURN.html");

/* the real video client, in a sandbox with no network, no IndexedDB and no cloud (local film) */
function storage(){ const d = new Map(); return { getItem:(k)=>d.has(String(k)) ? d.get(String(k)) : null,
  setItem:(k,v)=>d.set(String(k), String(v)), removeItem:(k)=>d.delete(String(k)), clear:()=>d.clear() }; }
function videoBox(invoke){
  const box = { console, localStorage:storage(), setTimeout, clearTimeout, setInterval:()=>0, clearInterval:noop, queueMicrotask,
    Date, Promise, URL, Blob, document:{ createElement:()=>({ style:{} }) }, addEventListener:noop, removeEventListener:noop,
    dispatchEvent:()=>true, CustomEvent:class{ constructor(t,i){ this.type=t; this.detail=i&&i.detail; } },
    React:{ createElement:()=>null, useState:(v)=>[v,noop], useEffect:noop, useRef:(v)=>({ current:v }), useMemo:(f)=>f(), useCallback:(f)=>f, Fragment:"f" } };
  box.window = box; box.globalThis = box; vm.createContext(box);
  box.TURN_SUPABASE = { imageProxy:true, imageProxyFn:"fake-video-proxy" };
  box.nbCloudScope = ()=>null;
  box.toasts = []; box.appToast = (m,k)=>box.toasts.push({ m, k });
  box.sbClient = ()=>({ functions:{ invoke:async (name, req)=>invoke(req && req.body) } });
  vm.runInContext(read("app/character-identity.js"), box);
  vm.runInContext(vg, box, { filename:"app/videogen.jsx" });
  return box;
}

/* ═══ A ═══ */
await test("A1 a new take never replaces an approved current take, nor (collected later) the one you chose; restore still does", async ()=>{
  const b = videoBox(()=>({ data:{} }));
  await b.vidCommit("c1", "u1", { prompt:"one" });
  await b.vidCommit("c1", "u2", { prompt:"two" }, null, { newTake:true });
  assert.equal(b.vidGetVideo("c1"), "u2", "an unapproved current take is replaced by a new render, as before");
  await b.vidApproveTake("c1", "u2", true);
  const r = await b.vidCommit("c1", "u3", { prompt:"three" }, null, { newTake:true });
  assert.equal(r.keptCurrent, true);
  assert.equal(b.vidGetVideo("c1"), "u2", "the approved take stays current");
  assert.deepEqual(J(b.vidGetTakes("c1").map(t=>t.url)), ["u2", "u3", "u1"], "the new take is first among the others");
  await b.vidApproveTake("c1", "u2", false);
  await b.vidCommit("c1", "u4", { recovered:true }, null, { newTake:true, recovered:true });
  assert.equal(b.vidGetVideo("c1"), "u2", "a render collected later never replaces the current take");
  await b.vidRestoreTake("c1", "u4");
  assert.equal(b.vidGetVideo("c1"), "u4", "Restore still makes a take current");
  const fresh = await b.vidCommit("c2", "v1", {}, null, { newTake:true, recovered:true });
  assert.ok(!fresh.keptCurrent && b.vidGetVideo("c2")==="v1", "a clip with no take gets the recovered one as current");
});
await test("A2 past 20: approved takes never roll off; the 20 kept are the newest unapproved ones", async ()=>{
  const b = videoBox(()=>({ data:{} }));
  await b.vidCommit("c", "a0", {});
  await b.vidApproveTake("c", "a0", true);
  for(let i=1;i<=23;i++) await b.vidCommit("c", "u"+i, {}, null, { newTake:true });
  const urls = b.vidGetTakes("c").map(t=>t.url);
  assert.equal(urls[0], "a0", "the approved take stayed current");
  assert.equal(urls.length, 21);
  assert.ok(urls.includes("u23") && !urls.includes("u3") && urls.includes("u4"));
  // the Stage asks before a render pushes one out
  assert.ok(stage.includes('title:"Remove the oldest take"+(over!==1?"s":"")+"?",') && stage.includes("const over = loose.length + n - 20;"));
});
await test("A3 the pending list never drops a paid job: past 20 it keeps them all; a full list refuses and the render warns", ()=>{
  const b = videoBox(()=>({ data:{} }));
  const add = vm.runInContext("_vidPendingAdd", b);
  for(let i=0;i<30;i++) assert.equal(add({ requestId:"r"+i, id:"c", at:Date.now() }, false), true);
  assert.equal(b.vidPendingList().length, 30, "nothing evicted (it kept only the newest 20)");
  for(let i=30;i<=80;i++) add({ requestId:"r"+i, id:"c", at:Date.now() }, false);
  assert.equal(add({ requestId:"r-over", id:"c", at:Date.now() }, false), false, "a full list refuses instead of dropping one");
  assert.ok(b.vidPendingList().some(j=>j.requestId==="r0"));
  assert.ok(!vg.includes("list.slice(-20)") && vg.includes("if(pendingSaved) pendingSaved=_vidPendingAdd(pendingJob,hasScreenplayImages);") && vg.includes("if(!pendingSaved) warnPendingPersistence();"));
});
await test("A4 a take finished after an identity change is kept and flagged, beside the current take — never thrown away", ()=>{
  assert.ok(!vg.includes("its take was not saved because character identity changed during rendering"));
  assert.ok(vg.includes("catch(identityErr){ identityChanged = true; meta.identityChanged = true; }"));
  assert.ok(vg.includes("const cr = await vidCommit(id, st.videoUrl, meta, scope0, { newTake:true, asDraft:identityChanged });"));
  assert.ok(vg.includes('try{ vidAssertIdentity(opts, "video-after-poll"); }catch(_identityErr){} }'), "an identity change mid-poll no longer ends the wait");
  // a flagged take is never used as is on the timeline, and says why in Takes
  assert.ok(stage.includes("const usable=!(meta && meta.identityChanged) && (!clip ||"));
  assert.ok(stage.includes('if(m.identityChanged) out.push({ key:"i", label:"Identity changed",'));
});
await test("A5 earlier groupings: listed, moved only when you say so; a positional take only moves onto the same shots", async ()=>{
  const b = videoBox(()=>({ data:{} }));
  await b.vidCommit("clip-sc-old", "o1", { shotSources:[{ shotId:"s1" },{ shotId:"s2" }] });
  await b.vidCommit("clip-sc-old", "o2", { shotSources:[{ shotId:"s1" },{ shotId:"s2" }] }, null, { newTake:true });
  await b.vidCommit("clip-sc-new", "n1", { shotSources:[{ shotId:"s1" }] });
  assert.ok(b.vidKnownIds().includes("clip-sc-old"));
  assert.deepEqual(J(b.vidTakeShotIds(b.vidGetMeta("clip-sc-old"))), ["s1","s2"]);
  const r = await b.vidMergeTakes("clip-sc-new", "clip-sc-old");
  assert.equal(r.merged, 2);
  assert.equal(b.vidGetVideo("clip-sc-new"), "n1", "the clip's current take stays current");
  assert.deepEqual(J(b.vidGetTakes("clip-sc-new").map(t=>t.url)), ["n1","o2","o1"]);
  assert.equal(b.vidGetVideo("clip-sc-old"), "", "the old id is cleared");
  // a positional take that records other shots stays where it is
  await b.vidCommit("clip-sc-0", "p1", { shotSources:[{ shotId:"x1" }] });
  assert.equal(await b.vidAdoptTakes("clip-sc-sNEW", "clip-sc-0", ["y1"]), null);
  assert.equal(b.vidGetVideo("clip-sc-sNEW"), "");
  const ok = await b.vidAdoptTakes("clip-sc-sNEW", "clip-sc-0", ["x1"]);
  assert.ok(ok && ok.migrated);
  // the Stage offers them, with a question, and passes the clip's shots to the legacy migration
  assert.ok(stage.includes('"Bring them into this clip"') && stage.includes('title:"Bring "+n+" earlier take"+(n!==1?"s":"")+" into this clip?",'));
  assert.ok(stage.includes("window.vidAdoptTakes(c.id, c.legacyId, (c.g.shots||[]).map(s=>s.id));"));
});

/* ═══ B ═══ */
await test("B1 the batch size reaches the server; a failed render says no credits were charged; a still-running take isn't 'failed'", async ()=>{
  assert.ok(vg.includes("batchSize:Math.max(1, Number(persistedTakeMeta&&persistedTakeMeta.batchCount)||1),"));
  const calls = [];
  const b = videoBox((body)=>{ calls.push(body);
    if(body && body.op==="submit") return { data:{ requestId:"r1", statusUrl:"s", responseUrl:"r" } };
    return { data:{ status:"FAILED", error:"The video service reported the render as failed." } }; });
  await assert.rejects(b.seedanceGenerate("cf", { frameUrl:"https://x.invalid/f.png", prompt:"go", pollMs:2, maxPolls:5, durationMs:4000 }), /No credits were charged/);
  const submit = calls.find(c=>c && c.op==="submit");
  assert.ok(submit && (submit.batchSize===1 || (submit.payload && submit.payload.batchSize===1)) || JSON.stringify(calls).includes('"batchSize":1'), JSON.stringify(calls[0]||{}).slice(0,200));
  assert.ok(vg.includes("takes are still rendering on the server") && vg.includes("takes failed and weren't charged:"));
  assert.ok(stage.includes('(e&&(e.repriceDeclined||e.stillPending))?"info":"error"'));
});
await test("B2 a reference video the server can't size by its length shows the hold, not just the estimate", ()=>{
  const b = { URL, window:{} }; vm.createContext(b);
  vm.runInContext(fn(stage, "stageProjectStorageObject")+fn(stage, "stageLengthSizesHold"), b);
  assert.equal(b.stageLengthSizesHold({ url:"stage:abc" }), true);
  assert.equal(b.stageLengthSizesHold({ url:"https://elsewhere.example/v.mp4" }), false);
  assert.ok(stage.includes("const refVideoUnsized = refVideoMul>0 && onVideos.some(a=>a && a.url && !stageLengthSizesHold({ url:a.url }));"));
  assert.ok(stage.includes("stageCreditInfo(creditBalance, totalHold, { hold:true, refs:true, estimate:totalCost, basis:\"stored\" })"));
  const ci = { window:{}, Number, Math, String }; vm.createContext(ci); vm.runInContext(fn(stage, "stageCreditInfo"), ci);
  const info = ci.stageCreditInfo({ remaining:500 }, 300, { hold:true, refs:true, estimate:120, basis:"stored" });
  assert.match(info.label, /^Holds up to 300 credits; charged for the reference video’s real length \(about 120\)/);
  // the main render re-signs its reference videos like Extend / Edit / Motion
  assert.ok(stage.includes('const u = await stageFreshVideoRef({ kind:"take", url:a.url }); if(u) videoUrls.push(u); }'));
});
await test("B3 what landed, said honestly; a render still running for this clip is shown and asked about", ()=>{
  assert.ok(stage.includes("const landed = results.filter(r=>r && !r.stale && !r.discarded);"));
  assert.ok(stage.includes("lands\") +\" in this clip's takes when you reopen that film.\"") || stage.includes("in this clip's takes when you reopen that film."));
  assert.ok(stage.includes('data-testid":"stage-pending-on-server"') && stage.includes('title:"Render this clip again?",'));
  assert.ok(stage.includes("A batch") || stage.includes('body:n+" separate renders start together, each with its own seed"+(each ? " \\u2014 about "+(each*n)+" credits in all ("+each+" each; the charge follows the actual cost'));
});

/* ═══ C ═══ */
await test("C1 a frame still loading is LOADING; only the frames a render sends are judged; out of date AND unapproved counts once", ()=>{
  const b = { console, Object, Array, String, Math, window:{} }; b.window = b; vm.createContext(b);
  vm.runInContext(fn(stage, "stageClipReadiness"), b);
  b.stageClipSourcePlan = ()=>({ mode:"frames" });
  const states = { s1:{ rendered:true, approved:false, current:false }, s2:{ rendered:true, approved:false, current:true }, s3:{ rendered:false } };
  b.shotFrameState = (sh)=>states[sh.id];
  b.sceneReferenceNeeds = ()=>[];
  const clip = { scene:{ id:"sc" }, data:{ first:{ id:"s1" }, shots:[{ id:"s1" },{ id:"s2" },{ id:"s3" }] } };
  let r = b.stageClipReadiness(clip, {}, {}, {}, { loading:{ s3:"loading" } });
  assert.deepEqual([r.frames.stale, r.frames.unapproved, r.frames.loading, r.frames.missing], [1, 1, 1, 0]);
  assert.match(r.text, /^1 frame still loading · 1 frame not approved · 1 frame out of date$/);
  r = b.stageClipReadiness(clip, {}, {}, {}, { sourceMode:"halves" });
  assert.equal(r.issues.length, 0, "a storyboard render sends no frames");
  r = b.stageClipReadiness(clip, {}, {}, {}, { sourceMode:"frame" });
  assert.deepEqual([r.frames.stale, r.frames.unapproved, r.frames.missing], [1, 0, 0], "a one-frame render judges its first frame only");
  // Generate waits for a loading frame instead of rendering without it
  assert.ok(stage.includes("if(!referenceFree && readiness.frames.loading){") && stage.includes("const readiness = stageClipReadiness(clip, ctx, imgs, drafts, { loading:imageLoadState, sourceMode });"));
});
await test("C2 the Scenes rail: other scenes read the cache and say their images load when opened; the open scene reads readiness", ()=>{
  const b = { Proxy, window:{} }; vm.createContext(b); vm.runInContext(fn(stage, "stageImgsWithCache"), b);
  b.nbGetImage = (id)=> id==="cached" ? "u:c" : "";
  const m = b.stageImgsWithCache({ own:"u:o" });
  assert.equal(m.own, "u:o"); assert.equal(m.cached, "u:c"); assert.equal(m.none, undefined);
  assert.ok(stage.includes(" \u2014 its images load when you open this scene") && stage.includes("stageClipReadiness(c, ctx, imgs, drafts, { loading:imageLoadState })"))   // (2026-10-24, rail option A) per clip card;
  assert.ok(!stage.includes("function clipFrameState("), "the unused helper is gone");
});
await test("C3 prop state sheets are loaded for the open scene, and the clips are rebuilt when one arrives", ()=>{
  assert.ok(stage.includes("if(rs.referenceAssetId){ s.add(rs.referenceAssetId); variantIds.add(rs.referenceAssetId); }"));
  assert.ok(stage.includes("if(alive && u && propVariantIdsRef.current.has(id)) setPropVariantTick(t=>t+1);"));
  assert.ok(stage.includes("beatsSig, project, propVariantTick]);")||stage.includes("beatsSig, project, propVariantTick, geoTick]);"));
});
await test("C4 Extend, Edit and Motion Control takes record the shots and the look they were made from; rights re-checked before each submit", ()=>{
  assert.equal((stage.match(/shotSources:clipShotSources\(\),/g)||[]).length, 3);
  assert.ok(stage.includes("takeMeta:{ lookSig:(editVideo && _earlierOf(editVideo.lookSig)) ? editVideo.lookSig : clipLookSig, shotSources:clipShotSources(),"));
  assert.ok(stage.includes("takeMeta:{ lookSig:(motionImage && motionImage.asset && earlierLookIn([motionImage.asset.id])) || clipLookSig, shotSources:clipShotSources(),"));
  assert.equal((stage.match(/stageWithLengthReprice\(\(p\)=>\{ assertSameClip\(clipId0\); return gen\.generate\(p\); \}, \{/g)||[]).length, 3);
  assert.ok(stage.includes("const runPayload = (p)=>{ assertSameClip(clipId0);"));
  assert.ok(stage.includes("if(readOnlyRef.current) throw new Error(\"Your access to this film changed to view-only while the render was being prepared"));
});
await test("C5 a take records only what was sent (a transition: its two frames), frame versions, and the prop sheets it attached", ()=>{
  assert.ok(stage.includes("const resolvedSourceVersions=packageSourceVersions.filter(r=>sentSet.has(r.assetId));"));
  assert.ok(stage.includes("? [frameAsset && frameAsset.id, endFrameId]"));
  assert.ok(stage.includes("omittedReferenceSourceVersions:referenceFree?packageSourceVersions:[],"));
  assert.ok(stage.includes("takeMeta:{ lookSig:takeLookSig, frameVersions,"));
  // the prop stamp: a sheet attached → stamped by its sheet, read back from the stamp itself
  const b = { console, Object, Array, String, JSON, Set, window:{} }; b.window = b; vm.createContext(b);
  const props = read("app/props.jsx");
  vm.runInContext(fn(props, "propFrameDependencies")+fn(props, "propDependenciesChanged")
    +fn(stage, "stageClipPropDependencySignature")+fn(stage, "stageClipPropDependenciesV2")+fn(stage, "stageClipPropDependenciesChanged"), b);
  const P = [{ id:"lamp", desc:"brass" }];
  b.propStateAt = ()=>({ bindingMode:"carried", condition:"intact" });
  b.propTextSig = (p)=>"t:"+p.desc;
  b.propRevisionKnown = (id)=>"rev-"+(b.rev||1);
  b.inFrameProps = ()=>["lamp"];
  const C = { props:P, characters:[], scenes:[{ id:"sc" }] };
  const clipData = { shots:[{ id:"s1" }] };
  const stamp = b.stageClipPropDependenciesV2(clipData, "sc", C, { s1:{ lamp:"lamp:dmg" } });
  assert.ok(stamp.includes('\\"sheet\\":\\"lamp:dmg\\"'), stamp);
  P[0].desc = "silver";   // a description edit doesn't flag a prop that rode as its sheet
  assert.equal(b.stageClipPropDependenciesChanged(stamp, clipData, "sc", C), false);
  b.rev = 2;              // the sheet itself was redrawn
  assert.equal(b.stageClipPropDependenciesChanged(stamp, clipData, "sc", C), true);
});

/* ═══ D ═══ */
await test("D1 one set of take notes: Takes, the Timeline, the rail and the Breakdown read stageTakeNotes", ()=>{
  const b = { console, Object, Array, String, Number, window:{} }; b.window = b; vm.createContext(b);
  vm.runInContext(fn(stage, "stageTakeFramesChanged"), b);
  const metas = { f1:{ iso:"2026-10-09T01:00:00Z", version:2 } };
  b.nbGetMeta = (id)=>metas[id]||null;
  assert.equal(b.stageTakeFramesChanged({ frameVersions:[{ id:"f1", iso:"2026-10-09T01:00:00Z", version:2 }] }), false);
  assert.equal(b.stageTakeFramesChanged({ frameVersions:[{ id:"f1", iso:"2026-10-08T01:00:00Z", version:1 }] }), true);
  assert.equal(b.stageTakeFramesChanged({ frameVersions:[{ id:"unloaded", iso:"x", version:1 }] }), false, "not loaded here: unknown, never a warning");
  assert.ok(stage.includes("stageTakeNotes(clip, m, project).forEach(nt=>"));
  assert.ok(stage.includes("const notes = m ? stageTakeNotes(c, m, project).filter(x=>x.key!==\"l\") : [];"));
  assert.ok(stage.includes('" with take notes"') && bd.includes('" with take notes"'));
  assert.ok(stage.includes('"Open in Shoot"'));
});
await test("D2 the Breakdown's clip counts are keyed by the open film (films carry no project.id)", ()=>{
  const b = { window:{} }; vm.createContext(b); b.window = b; vm.runInContext(fn(stage, "stageFilmKey"), b);
  assert.equal(b.stageFilmKey({ title:"x" }), "local");
  b.turnOpenFilmId = "film-9"; assert.equal(b.stageFilmKey({ title:"x" }), "film-9");
  assert.ok(stage.includes('localStorage.setItem("turn_stage_scene_status:"+stageFilmKey(project), JSON.stringify(out));'));
  assert.ok(bd.includes("const stageStatus = bdStageStatus(window.turnOpenFilmId || (project && project.id));"));
  assert.ok(stage.includes('const _draftsKey = "turn_stage_prompt_drafts:"+stageFilmKey(ctx.project);'));
});
await test("D3 prompt drafts: restored on open, exact shots first (another grouping's is marked), the most recently edited kept", ()=>{
  assert.ok(stage.includes('const promptKeyRef = React.useRef("");'));
  assert.ok(stage.includes("saved=all.find(x=>(x.shotIds||[]).length===ids.length && (x.shotIds||[]).slice().sort().join(\",\")===key);"));
  assert.ok(stage.includes("otherGrouping=!!saved;") && stage.includes('data-testid":"stage-prompt-other-shots"'));
  assert.ok(stage.includes(".sort((a,b)=>Number((all[b]&&all[b].updatedAt)||0)-Number((all[a]&&all[a].updatedAt)||0)).slice(0,60);"));
  assert.equal((stage.match(/shotIds:shownShots\.map\(s=>s\.id\),updatedAt:Date\.now\(\)\}/g)||[]).length, 5);
});

/* ═══ E ═══ */
await test("E1 rights: a view-only Stage never voices, edits shot text, notes, approves, restores or uploads", ()=>{
  assert.ok(app.includes("onVoiceLine:roomReadOnly?null:voiceLine,") && !app.includes("voiceAllLines"));
  assert.ok(stage.includes("if(!onVoiceLine || voicingClip || readOnly) return;") && stage.includes("((onVoiceLine && !readOnly) ? (voicingClip"));
  assert.ok(stage.includes("setValue:(v)=>{ if(!onUpdateShot || readOnly) return;") && stage.includes("included && edited && !readOnly && _stEl"));
  assert.ok(stage.includes("if(!window.vidApproveTake || readOnly) return;") && stage.includes("if(!window.vidRestoreTake || readOnly ||"));
  assert.ok(stage.includes("note:(url,text)=>{ if(window.vidUpdateTake && !readOnly)"));
  assert.ok(stage.includes('className:"stage2-dz-btn upload",disabled:busy||gening||readOnly,'));
  assert.ok(!stage.includes("onVoiceAll") && !stage.includes("setVisualSource,"));
});
await test("E2 copy: no plumbing or 'coverage' wording in the Stage's messages; errors say 'the video model'", ()=>{
  for(const bad of ["Supabase + the proxy", "Deploy the image-proxy Edge Function", "browser-to-proxy image payload", "The video proxy didn't accept", "Checking the video proxy", "Seedance refused one", "Seedance 2.5 is not configured", "for Seedance…", "Check pending renders"])
    assert.ok(!vg.includes(bad) && !stage.includes(bad), bad);
  for(const bad of ['" · Shot coverage"', '" coverage sheet"', "location coverage or prop-state", "editorial coverage", "coverage's speech", '"Shot / coverage"', "This coverage needs", "location coverage reference is missing"])
    assert.ok(!stage.includes(bad) && !plan.includes(bad) && !refs.includes(bad), bad);
  assert.ok(stage.includes('"The video model refused one selected video reference.') || stage.includes("The video model refused one selected video reference."));
});
await test("E3 accessibility: the viewer is a dialog (Escape, focus), players and icon buttons are named, Mix import is a button, Remove undoes", ()=>{
  assert.ok(stage.includes('role:"dialog","aria-modal":"true","aria-label":maxImg.label||"Video"') && stage.includes('if(e.key==="Escape"){ e.stopPropagation(); setMaxImg(null); }'));
  // (2026-10-24, Takes option A) the Back arrow went with the sub-header — Shoot is the tab beside Takes
  assert.ok(stage.includes('"aria-label":"Takes of this clip"') && stage.includes('"aria-label":"Previous clip"') && stage.includes('"aria-label":"Notes for this take"'));
  assert.ok(stage.includes('"aria-label":"Take of "+(clip.label||"this clip")') && stage.includes('"aria-label":"Mix preview"'));
  assert.ok(!stage.includes('_stEl("label",{className:"stage2-au-import"}') && (stage.includes('action:{ label:"Undo", onClick:()=>{') || stage.includes('action:{ label:"Undo", onClick:async()=>{')));
  assert.ok(stage.includes('"aria-hidden":"true",tabIndex:-1}),'));
});
await test("E4 Frances: the Stage entry tells today's truth (no 'Voice all lines', per-clip source, Takes), plus the third pass", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="The Stage (Production)")||{}).what || "";
  for(const gone of ["'Voice beat'", "'Voice all lines'", "double-click one to jump to the Stage tab", "the Versions tab decides", "the newest render is always the current one", "visual source (shot frames or storyboard halves) are saved WITH THE FILM"])
    assert.ok(!w.includes(gone), gone);
  for(const re of [/STAGE REVIEW, THIRD PASS/, /'Voice clip now'/, /Bring them into this clip/, /'Identity changed'/, /still running on the server/, /a frame still loading is never treated as missing/, /'Frame changed'/, /most recently edited/, /shown as a hold/, /view-only Stage nothing writes or spends/])
    assert.ok(re.test(w), String(re));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE/.test(between(ai, "STAGE REVIEW, THIRD PASS (owner 2026-10-09)", "/* TIMELINE REVIEW, THIRD PASS")));
});
await test("E5 cache keys: every changed file loads with the new key (script.jsx shares ai.jsx's)", ()=>{
  // (later passes re-key some of these files again)
  for(const f of ["stage.jsx", "ai.jsx", "script.jsx", "app.jsx", "breakdown.jsx", "videogen.jsx", "stage-plan.jsx", "stage-references.jsx"])
    assert.ok(["20261009-stage3", "20261009-tl3", "20261009-mix3", "20261009-wr3", "20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91"].some(k=>html.includes('src="app/'+f+'?v='+k+'"')), f);
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

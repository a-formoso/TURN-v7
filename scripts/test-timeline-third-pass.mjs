#!/usr/bin/env node
/* The Stage's Timeline, third pass (owner 2026-10-09: "go ahead with all of it") — does the film play and
   export the way it says?
   A  export, run for real against fake browser media: a clip that never loads times out with its name,
      Cancel works while a clip loads, a hidden tab pauses the recording, MP4-only browsers get .mp4,
      missing features are said plainly, a recorder error is never a success
   B  the Timeline: selection follows the rail, Play film from the first and a Stop, skips a broken take,
      leaving stops an export, one export at a time, the dialog always says what goes in and how to keep it
      going, out-of-date vs not rendered, thumbnails for every scene, loading state
   C  "Identity changed" takes can be checked and put back; the rail agrees with the Timeline
   D  routes, the recipe rename, accessibility, Frances, keys
     node scripts/test-timeline-third-pass.mjs */
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

const stage = read("app/stage.jsx"), app = read("app/app.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css"), html = read("TURN.html");
const tl = between(stage, "function StageTimelineView({", "/* ---- AUDIO tab");

/* the real export function with fake media: o.load: "ok" | "never" | "error"; o.mime: the one type supported */
function exportBox(o){
  o = o||{};
  const log = { recPaused:0, recResumed:0, acSuspended:0 };
  const listeners = {};
  const doc = { visibilityState:"visible",
    addEventListener:(t,f)=>{ listeners[t]=f; }, removeEventListener:(t)=>{ delete listeners[t]; },
    createElement:(tag)=>{
      if(tag==="canvas") return o.noCapture ? {} : { width:0, height:0, getContext:()=>({ fillRect(){}, drawImage(){}, getImageData(){ return {}; }, set fillStyle(v){} }),
        captureStream:()=>({ addTrack(){}, getTracks:()=>[] }) };
      if(tag==="video"){ const v = { videoWidth:640, videoHeight:360, readyState:4, currentTime:0, ended:false,
        load(){ if(o.load==="ok") setTimeout(()=>v.onloadedmetadata && v.onloadedmetadata(), 5);
          else if(o.load==="error") setTimeout(()=>v.onerror && v.onerror(), 5); },
        play(){ v.ended=false; let t=0; const iv=setInterval(()=>{ t+=0.1; v.currentTime=t; if(t>=0.3){ clearInterval(iv); v.ended=true; v.onended && v.onended(); } }, 10); return Promise.resolve(); },
        pause(){}, removeAttribute(){} }; return v; }
      if(tag==="a") return { click(){} };
      return {};
    } };
  class MR { constructor(){ this.state="inactive"; this.mimeType = o.mime||""; }
    static isTypeSupported(m){ return m===o.mime; }
    start(){ this.state="recording"; setTimeout(()=>this.ondataavailable && this.ondataavailable({ data:{ size:10 } }), 1); if(o.recError) setTimeout(()=>this.onerror && this.onerror(new Error("x")), 2); }
    pause(){ this.state="paused"; log.recPaused++; } resume(){ this.state="recording"; log.recResumed++; }
    stop(){ this.state="inactive"; setTimeout(()=>this.onstop && this.onstop(), 1); } }
  class AC { constructor(){ this.currentTime=0; }
    createMediaElementSource(){ return { connect(){}, disconnect(){} }; } createMediaStreamDestination(){ return { stream:{ getAudioTracks:()=>[] } }; }
    createGain(){ return { gain:{ value:1 }, connect(){} }; } resume(){ return Promise.resolve(); } suspend(){ log.acSuspended++; return Promise.resolve(); } close(){} }
  const box = { console, Object, Array, String, Number, Math, JSON, Promise, Date, Error, setTimeout, clearTimeout, setInterval, clearInterval,
    Blob:class{ constructor(parts, opts){ this.type=(opts&&opts.type)||""; } },
    document:doc, MediaRecorder:o.noRecorder ? undefined : MR, AudioContext:o.noAudio ? undefined : AC, requestAnimationFrame:(f)=>setTimeout(f,16), cancelAnimationFrame:clearTimeout };
  box.window = box; vm.createContext(box);
  vm.runInContext(fn(stage, "stageClipBeatName")+fn(stage, "stageExportPlaylist")+fn(stage, "stageExportFilm"), box);
  box.__log = log; box.__hide = (h)=>{ doc.visibilityState = h ? "hidden" : "visible"; listeners.visibilitychange && listeners.visibilitychange(); };
  return box;
}
const PL = [{ id:"c1", label:"01A", name:"01A · Beat 1", url:"u1" }, { id:"c2", label:"01B", name:"01B · Beat 2", url:"u2" }];

/* ═══ A ═══ */
await test("A1 a clip that never loads times out naming the clip; one that errors names it too; Cancel works while loading", async ()=>{
  let b = exportBox({ load:"never", mime:"video/webm" });
  await assert.rejects(b.stageExportFilm(PL, { loadTimeoutMs:60 }), /The take for 01A · Beat 1 didn't load/);
  b = exportBox({ load:"error", mime:"video/webm" });
  await assert.rejects(b.stageExportFilm(PL, {}), /The take for 01A · Beat 1 couldn't be loaded/);
  b = exportBox({ load:"never", mime:"video/webm" });
  let cancel = false; setTimeout(()=>{ cancel = true; }, 40);
  await assert.rejects(b.stageExportFilm(PL, { loadTimeoutMs:5000, shouldCancel:()=>cancel }), /Export cancelled/);
});
await test("A2 the whole film records; MP4-only browsers get an MP4 blob; a recorder error is never a success", async ()=>{
  let b = exportBox({ load:"ok", mime:"video/webm;codecs=vp9,opus" });
  const prog = [];
  let blob = await b.stageExportFilm(PL, { onProgress:(i,n,name,phase)=>prog.push([i,name,phase]) });
  assert.match(blob.type, /webm/);
  assert.deepEqual(J(prog), [[1,"01A · Beat 1","recording"],[2,"01B · Beat 2","recording"]]);
  b = exportBox({ load:"ok", mime:"video/mp4" });
  blob = await b.stageExportFilm(PL, {});
  assert.match(blob.type, /mp4/);
  b = exportBox({ load:"ok", mime:"video/webm", recError:true });
  await assert.rejects(b.stageExportFilm(PL, {}), /The recording stopped with an error/);
});
await test("A3 missing browser features are said plainly", async ()=>{
  await assert.rejects(exportBox({ noRecorder:true }).stageExportFilm(PL, {}), /can't record video/);
  await assert.rejects(exportBox({ noAudio:true, mime:"video/webm" }).stageExportFilm(PL, {}), /can't mix audio/);
  await assert.rejects(exportBox({ noCapture:true, mime:"video/webm" }).stageExportFilm(PL, {}), /can't record a canvas/);
});
await test("A4 a hidden tab pauses the picture, the sound, the recorder and the mix clock; they pick up when it's back", async ()=>{
  const b = exportBox({ load:"ok", mime:"video/webm" });
  const paused = [];
  const run = b.stageExportFilm(PL, { onPaused:(p)=>paused.push(p) });
  await new Promise(r=>setTimeout(r, 12));
  b.__hide(true);
  await new Promise(r=>setTimeout(r, 30));
  b.__hide(false);
  await run;
  assert.deepEqual(paused, [true, false]);
  assert.ok(b.__log.recPaused===1 && b.__log.recResumed===1 && b.__log.acSuspended===1, JSON.stringify(b.__log));
  assert.ok(!stage.slice(stage.indexOf("async function stageExportFilm("), stage.indexOf("window.stageExportFilm = stageExportFilm;")).includes("raf = requestAnimationFrame(draw);"));
});
await test("A5 the file's name follows its type; the playlist names each clip; left-out reasons include identity", ()=>{
  const b = { window:{}, String, Array }; vm.createContext(b);
  vm.runInContext(fn(stage, "stageFilmFileName")+fn(stage, "stageFilmExt")+fn(stage, "stageClipBeatName")+fn(stage, "stageExportSkipped"), b);
  assert.equal(b.stageFilmFileName("The Matrix", "2026-10-09", b.stageFilmExt("video/mp4")), "The_Matrix-2026-10-09.mp4");
  assert.equal(b.stageFilmFileName("", "2026-10-09", "webm"), "Kinolot-film-2026-10-09.webm");
  assert.equal(b.stageFilmFileName("The Matrix", "2026-10-09"), "The_Matrix-2026-10-09.webm");
  const clips = [{ id:"a", label:"01A", g:{ shots:[{ beatN:1 }] } }, { id:"b", label:"01B", g:{ shots:[] } }, { id:"c", label:"01C", g:{ shots:[] } }];
  assert.deepEqual(J(b.stageExportSkipped(clips, {}, { a:true, b:true }, { a:true })).map(x=>x.why),
    ["identity changed — check it in Takes", "out of date", "not rendered"]);
});

/* ═══ B ═══ */
await test("B1 the selection is the rail's, found by id on every render; Play film from the first, with a Stop", ()=>{
  assert.ok(tl.includes("const idx = Math.max(0, ordered.findIndex(c=>c.id===pickId));") && !tl.includes("const [idx, setIdx]"));
  assert.ok(tl.includes("const playFilm = ()=>{ const first = nextPlayable(-1);"));
  assert.ok(tl.includes('playAll?"■ Stop film":"▶ Play film"') && tl.includes("onClick:playAll ? stopFilm : playFilm"));
  // (2026-10-24, option A) a click on the track places the playhead in that clip — and still stops the film
  assert.ok(tl.includes("onClick:(e)=>{ if(playAll) stopFilm(); pickAt(i, e); }"), "picking a clip stops the film");
  assert.ok(tl.includes("if(playAll && v && !v.ended && !autoPlayIdRef.current) setPlayAll(false);"), "pausing stops it");
  // each clip starts when its video can play — never on a fixed timer
  assert.ok(tl.includes("onCanPlay") && !tl.includes("}, 60); };"));
  assert.ok(tl.includes("const pr = e.currentTarget.play(); if(pr && pr.catch) pr.catch(()=>{});"));
});
await test("B2 a take that can't play is said and skipped; the player names it", ()=>{
  assert.ok(tl.includes("onError:onVideoError") && tl.includes("'s take couldn't be played \u2014 skipped."));
  assert.ok(tl.includes("'s take couldn't be played \u2014 its link may have expired."));
});
await test("B3 one export at a time; leaving the Timeline stops it and nothing downloads elsewhere", ()=>{
  assert.ok(tl.includes("if(exportBusyRef.current) return;   // a double-click never starts two recordings"));
  assert.ok(tl.includes("Film export stopped \u2014 leaving the Timeline stops the recording."));
  assert.ok(tl.includes("if(!mountedRef.current) return;   // left mid-export: nothing downloads into another tab or film"));
});
await test("B4 the export always asks: what's left out, earlier-look and noted takes going in, real time, keep the tab in front", ()=>{
  assert.ok(tl.includes("if(typeof window.appConfirm===\"function\"){") && !tl.includes("if((mix || skipped.length) && typeof window.appConfirm"));
  assert.ok(tl.includes("made with an earlier look (included).") && tl.includes("take notes in Takes (included)."));
  assert.ok(tl.includes("keep this tab open and in front \u2014 the recording pauses while the tab is hidden, and leaving the Timeline stops it."));
  assert.ok(tl.includes("about 60 MB a minute"));
  assert.ok(tl.includes('"■ Preparing the sound…"') && tl.includes('" (tab hidden)"'));
});
await test("B5 out of date apart from not rendered; real take lengths; every scene's thumbnails; 'Loading takes…'", ()=>{
  assert.ok(tl.includes('(staleN ? " · "+staleN+" out of date" : "")'));
  assert.ok(tl.includes("const doneSec = ordered.reduce((t,c)=>t+(vids[c.id]?takeSecs(c):0),0);"));
  assert.ok(tl.includes("const thumbs = stageImgsWithCache(imgs);") && tl.includes("clipPrimaryFrame(c, thumbs, visualSource)"));
  assert.ok(tl.includes('!vidsLoaded ? "Loading takes\u2026"'));
  assert.ok(css.includes(".stage2-tl-dot.stale{") && css.includes(".stage2-tl-clip.noted .stage2-tl-dot.ok{"));
  assert.ok(stage.includes("const urls = await Promise.all(videoIds.map(async id=>{") && !stage.includes("stageBeatVidId"));
});

/* ═══ C ═══ */
await test("C1 an 'Identity changed' take can be checked and put back; Choose / Approve ask first, then clear the flag", ()=>{
  assert.ok(stage.includes('title:"Have you checked this take?",'));
  assert.ok(stage.includes("{ identityChanged:false, identityCheckedAt:new Date().toISOString() }"));
  assert.ok(stage.includes('flagged ? "Check and use this take"'));
  assert.ok(stage.includes('if(on && !(await confirmIdentity(t,"Approve"))) return;') && stage.includes('!(await confirmIdentity(t,"Choose"))'));
  assert.ok(stage.includes("'s take finished after a character's identity changed"));
});
await test("C2 the rail counts a clip rendered exactly when the Timeline plays it", ()=>{
  const b = { window:{} }; vm.createContext(b); vm.runInContext(fn(stage, "clipVideoReady"), b);
  b.vidGetVideo = ()=>"u"; b.vidGetMeta = ()=>({ identityChanged:true }); b.shotSourcesEditorialStatus = ()=>"current";
  assert.equal(b.clipVideoReady({ id:"c" }, {}), false, "not in the vetted list → not rendered");
  assert.equal(b.clipVideoReady({ id:"c" }, { c:"u" }), true);
});

/* ═══ D ═══ */
await test("D1 routes: the app's Stage tabs open in the Stage; the tab bar marks the current tab", ()=>{
  assert.ok(app.includes('const stageTab = { timeline:"timeline", audio:"audio", versions:"versions", shoot:"stage" }[tab];') && !app.includes('if(tab==="timeline"){ setRoom("writers"); setView("script"); return; }'));
  assert.ok(stage.includes('window.addEventListener("turn-stage-view", h);'));
  assert.ok(stage.includes('"aria-pressed":on?"true":"false",') && !stage.includes('title: on ? "Current workspace" : tip'));
});
await test("D2 the prompt recipe is 'Time-coded' (the tab keeps 'Timeline'); the strip says click selects", ()=>{
  assert.ok(stage.includes('["timeline",   "Time-coded",') && !stage.includes('["timeline",   "Timeline",'));
  assert.ok(!tl.includes('" — click to play"') && tl.includes("click to place the playhead, double-click to open it in Shoot"));
  assert.ok(tl.includes('"aria-pressed":i===idx ? "true" : "false"') && tl.includes('role:"status","aria-live":"polite"'));
});
await test("D3 view-only people are told they can export and download; Frances knows the Timeline's third pass", ()=>{
  assert.ok(app.includes("you can watch the takes and the timeline, and export the film or download a take, here;"));
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const all = fb.__F.map(f=>f.what||"").join(" ");
  const w = (fb.__F.find(f=>f.name==="The Stage (Production)")||{}).what || "";
  for(const gone of ["(Timeline, Shots, Assets, Audio, Versions, Stage)", "Timeline and Audio view players", "the Timeline recipe", "open on Timeline", "Timeline on a one-shot clip", "use 'Open in Shoot', to render it there", "isn't used on the timeline until you check it"])
    assert.ok(!all.includes(gone), gone);
  for(const re of [/TIMELINE REVIEW, THIRD PASS/, /FROM THE FIRST/, /'Stop film'/, /PAUSES while the tab is hidden/, /'Check and use this take'/, /export the film and download takes/, /'Time-coded'/])
    assert.ok(re.test(w), String(re));
});
await test("D4 cache keys", ()=>{
  // (later passes re-key some of these files again)
  for(const f of ["stage.jsx", "ai.jsx", "script.jsx", "app.jsx"]) assert.ok(["20261009-tl3","20261009-mix3", "20261009-wr3", "20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/'+f+'?v='+k+'"')), f);
  assert.ok(["20261009-tl3", "20261009-mix3", "20261009-home3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

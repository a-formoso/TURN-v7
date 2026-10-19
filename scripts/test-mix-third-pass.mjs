#!/usr/bin/env node
/* The Stage's Mix tab, third pass (owner 2026-10-09: "go ahead with all of it") — does the mix play what the
   take really holds, in step with the picture, and keep the beds safe?
   A  one action estimate for the clip's length, the Time-coded prompt and the Mix's line placements
   B  the take's own line record: where its lines were placed; re-voiced lines and native-performance takes
      get no line laid over them; a line past the take's end is marked
   C  the export: lines end with their clip, beds read a scene at a time, a Picture level you set counts
   D  beds: kept as the file itself, for the film you acted in; a storage abort is said
   E  the Mix tab: lines follow the video's own time, pause/seek/hidden tab, a broken take is skipped, levels
      reach lines not started yet, what's shown and said, rights note, accessibility
   F  Frances and keys
     node scripts/test-mix-third-pass.mjs */
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

const stage = read("app/stage.jsx"), vg = read("app/voicegen.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html"), css = read("app/styles.css");
const au = between(stage, "function StageAudioView({", "/* ================================ the room shell");

const lineBox = ()=>{ const b = { console, Object, Array, String, Number, Math, JSON }; b.window = b; vm.createContext(b);
  vm.runInContext("const CLIP_AIR = { lead:0.6, gap:0.8, tail:0.6 };\n"+fn(stage, "stageActionSec")+fn(stage, "clipLinePlacements")+fn(stage, "stageTakeLinePlacements"), b);
  b._shotAudioState = (sh, auds)=>({ ready:!!(auds && auds[sh.id]) });
  b.stageShotRuntime = (sh)=> Number(sh && sh.dur) || 5; b._seedanceVoiceSec = ()=>2;
  return b; };
const clip = { id:"c", label:"01A", data:{ shots:[{ id:"act", dur:6 }, { id:"talk", dialogue:"Hello.", lineAudio:{ durationMs:1500, hash:"h-new" } }] } };

/* ═══ A ═══ */
await test("A1 an action shot before a line counts at most 3.5 s everywhere — the line lands at 0.6 + 3.5", ()=>{
  const b = lineBox();
  assert.equal(b.stageActionSec({ dur:6 }), 3.5);
  const pl = b.clipLinePlacements(clip, { talk:"u" }, []);
  assert.deepEqual(J(pl).map(x=>[x.shotId, x.at, x.sec]), [["talk", 4.1, 1.5]]);
  // the clip's length and the Time-coded prompt use the same estimate
  assert.ok(stage.includes("else t += stageActionSec(sh);\n  });\n  t += CLIP_AIR.tail;"));
  assert.ok(stage.includes("const dur = dialogue ? (lead + lineSec + tail) : (lastSpokenIdx>=0 ? stageActionSec(sh) : stageShotRuntime(sh));"));
  assert.equal(stage.split("Math.min(3.5, (typeof stageShotRuntime").length-1, 1, "one helper, not three copies");
});

/* ═══ B ═══ */
await test("B1 the take's record places the lines; a re-voiced line is left out and says why; native takes get none", ()=>{
  const b = lineBox();
  let pl = b.stageTakeLinePlacements(clip, { talk:"u" }, [], { linePlacements:[{ shotId:"talk", at:5.2, sec:1.5, hash:"h-new" }], durationSec:8 });
  assert.equal(pl[0].at, 5.2, "where this render placed it");
  assert.equal(pl[0].url, "u");
  pl = b.stageTakeLinePlacements(clip, { talk:"u" }, [], { linePlacements:[{ shotId:"talk", at:5.2, sec:1.5, hash:"h-old" }] });
  assert.ok(pl[0].revoiced && pl[0].url==="", "new audio over lips timed to the old: not played");
  pl = b.stageTakeLinePlacements(clip, { talk:"u" }, [], { voiceReferences:[{ shotId:"talk", renderHash:"h-old" }] });
  assert.ok(pl[0].revoiced, "an older take's voice record counts too");
  pl = b.stageTakeLinePlacements(clip, { talk:"u" }, [], { audio:"native" });
  assert.ok(pl[0].native && pl[0].url==="");
  pl = b.stageTakeLinePlacements(clip, { talk:"u" }, [], { durationSec:5 });
  assert.equal(pl[0].pastEnd, true, "4.1 + 1.5 > 5");
  pl = b.stageTakeLinePlacements(clip, { talk:"u" }, [], {});
  assert.ok(!pl[0].revoiced && pl[0].url==="u" && pl[0].at===4.1, "no record: today's placement");
  // each new render records them
  assert.ok(stage.includes("linePlacements:clipLinePlacements(clip, auds, ctx.characters||[]).map(pl=>{"));
});

/* ═══ C ═══ */
await test("C1 the export: the take's line record, lines end with the clip, beds a scene at a time, a set Picture level counts", ()=>{
  assert.ok(stage.includes("lines:stageTakeLinePlacements(c, o.auds, o.characters).filter(pl=>pl.url).map(pl=>({ at:pl.at, url:pl.url })) }));"));
  assert.ok(stage.includes("video.onended = ()=>{ clearInterval(tick); stopClipLines(); res(); };"));
  assert.ok(stage.includes("if(nextScene) loadBeds(nextScene);") && stage.includes("if(bedScene) releaseBeds(bedScene);"));
  const b = { console, Object, Array, String, Number, Math, JSON }; b.window = b; vm.createContext(b);
  vm.runInContext("const STAGE_MIX_DEFAULTS = { native:0.35, dialogue:1, amb:0.7, music:0.5 };\n"+fn(stage, "stageExportMixPlan"), b);
  b.stageTakeLinePlacements = ()=>[];
  const c = { id:"x", scene:{ id:"s" } };
  assert.equal(b.stageExportMixPlan([c], { x:"u" }, {}).has, false, "nothing set: recorded as rendered");
  assert.equal(b.stageExportMixPlan([c], { x:"u" }, { gainSet:{ native:true }, gain:{ native:0.2 } }).has, true, "a Picture level you set counts");
  assert.equal(b.stageExportMixPlan([c], { x:"u" }, { mute:{ native:true } }).has, true, "a Picture mute counts");
  assert.ok(stage.includes("Nothing in the Mix changes this film's sound"));
});

/* ═══ D ═══ */
function bedBox(abort){
  const store = new Map(); let urls = 0;
  const idb = { open(){ const req = {}; setTimeout(()=>{ req.result = { objectStoreNames:{ contains:()=>true }, transaction(){ const t = { objectStore(){ return {
      put(v, k){ if(abort){ setTimeout(()=>t.onabort && t.onabort(), 0); return; } store.set(k, v); setTimeout(()=>t.oncomplete && t.oncomplete(), 0); },
      get(k){ const r = {}; setTimeout(()=>{ r.result = store.get(k); r.onsuccess && r.onsuccess(); }, 0); return r; },
      delete(k){ store.delete(k); setTimeout(()=>t.oncomplete && t.oncomplete(), 0); } }; } }; return t; } }; req.onsuccess(); }, 0); return req; } };
  class FakeBlob { constructor(parts, o){ this.size = 3; this.type = (o&&o.type)||""; } }
  const b = { console, Promise, Map, String, Date, Error, setTimeout, indexedDB:idb, Blob:FakeBlob,
    URL:{ createObjectURL:()=>"blob:bed-"+(++urls), revokeObjectURL(){} } }; b.window = b; vm.createContext(b);
  vm.runInContext(between(vg, "const VGIDB_DB=", "// ---- persist one rendered line") + between(vg, "/* ---- Mix beds", "window.vgSaveMixBed=vgSaveMixBed;"), b);
  return { b, store };
}
await test("D1 a bed is kept as the file itself, for the film the user acted in (even after a switch)", async ()=>{
  const { b, store } = bedBox(false);
  b.__turnCurrentProjectId = "film-2";   // the user switched films before the save finished
  const file = new b.Blob(["x"], { type:"audio/mpeg" });
  const live = await b.vgSaveMixBed("s1", "amb", file, "rain.mp3", "film-1");
  assert.ok(/^blob:/.test(live.url));
  assert.ok(store.has("a:film-1:mix-bed:s1:amb") && !store.has("a:film-2:mix-bed:s1:amb"), "saved with the film it was imported in");
  assert.ok(store.get("a:film-1:mix-bed:s1:amb").blob === file, "the file itself, not a text copy");
  b.vgResetAll();
  const back = await b.vgLoadMixBed("s1", "amb", "film-1");
  assert.ok(/^blob:/.test(back.url) && back.meta.name==="rain.mp3");
  assert.equal(await b.vgLoadMixBed("s1", "amb"), null, "the open film (film-2) doesn't see it");
  await b.vgClearMixBed("s1", "amb", "film-1");
  assert.ok(!store.has("a:film-1:mix-bed:s1:amb"));
});
await test("D2 an older text bed still loads; a write the storage aborts is an error, never a hang", async ()=>{
  let { b } = bedBox(false);
  b.__turnCurrentProjectId = "f";
  await b.vgSaveMixBed("s1", "music", "data:audio/mp3;base64,AAA", "old.mp3");
  b.vgResetAll();
  assert.equal((await b.vgLoadMixBed("s1", "music")).url, "data:audio/mp3;base64,AAA");
  ({ b } = bedBox(true));
  await assert.rejects(b.vgSaveMixBed("s1", "amb", "data:x", "big.mp3", "f"), /refused|./);
  assert.ok(vg.includes("tx.onabort=()=>rej(tx.error||new Error(\"The browser's storage refused the write.\"));"));
});

/* ═══ E ═══ */
await test("E1 the lines follow the video's own time: play/seek place them from here, pause stops everything, lines stop at the take's end", ()=>{
  assert.ok(au.includes("const from = Number(v.currentTime)||0;") && au.includes("const startIn = Math.max(0, pl.at-from), offset = Math.max(0, from-pl.at);"));
  assert.ok(au.includes("onPlay:onVideoPlay,onPause:onVideoPause,onSeeked:onVideoSeeked,onCanPlay,onError:onVideoError,"));
  assert.ok(au.includes("const onVideoPause = (e)=>{ const v = e.currentTarget; if(v.ended) return; stopLines(); pauseBeds();"));
  assert.ok(au.includes("Math.max(0, (end-pl.at-offset)*1000)"), "a line past the take's end stops there");
  assert.ok(!au.includes("}, 80);"), "no fixed start timers");
  assert.ok(au.includes('document.addEventListener("visibilitychange", h);'));
});
await test("E2 a broken take is named and skipped; a level or mute reaches lines that haven't started", ()=>{
  assert.ok(au.includes("'s take couldn't be played \u2014 its link may have expired."));
  assert.ok(au.includes("const levelRef = React.useRef({ gain, mute }); levelRef.current = { gain, mute };"));
  assert.ok(au.includes('const g = (k)=>{ const L = levelRef.current; return L.mute[k] ? 0 : L.gain[k]; };'));
});
await test("E3 what's shown and said: the rail's clip or the first rendered, statuses, loading, no dialogue, re-locked voice", ()=>{
  assert.ok(au.includes("(selInScene>=0 && vids[sceneClips[selInScene].id]) ? selInScene : firstRendered;"));
  assert.ok(au.includes("const pickScene = (id)=>{ setSceneId(id);") && au.includes("if(c && onSelectClip) onSelectClip(c.id); };"));
  assert.ok(au.includes('"identity changed \u2014 check it in Takes"') && au.includes('!vidsLoaded ? "Loading takes\u2026"'));
  assert.ok(au.includes('"No dialogue in this scene\'s rendered clips."'));
  assert.ok(au.includes("the take still speaks in the earlier voice."));
  assert.ok(stage.includes("_stEl(StageAudioView,{ key:\"au\", allClips, vids, staleVids, identityVids, noteVids, vidsLoaded, auds, characters, selId, onSelectClip })"));
  assert.ok(au.includes("kept on this device only \u2014 collaborators don't hear them, and each person's export uses their own."));
  assert.ok(au.includes("where the render was told to put them") && !au.includes("exactly where the render placed them"));
});
await test("E4 beds: a file the browser can't play is refused; only the open scene is read and merged; Undo awaits", ()=>{
  assert.ok(au.includes("if(f.type && probe.canPlayType && !probe.canPlayType(f.type))"));
  assert.ok(au.includes("stageLoadMixBeds(sceneClips, [sceneId])"));
  assert.ok(au.includes("await window.vgSaveMixBed(sid, k, keptFile || old.url, old.name, film);"));
});
await test("E5 accessibility: labelled sliders with a % value, mute buttons pressed/named, a labelled scene picker, focusable lines", ()=>{
  assert.ok(au.includes('"aria-labelledby":"au-lab-"+key,"aria-valuetext":levelText(gain[key]),'));
  assert.ok(au.includes('"aria-pressed":mute[key]?"true":"false",') && au.includes('"aria-label":"Mute "+label,'));
  assert.ok(au.includes('"aria-label":"Scene to mix"') && au.includes("tabIndex:0,"));
  assert.ok(css.includes("button.stage2-au-block{cursor:pointer}"));
});

/* ═══ F ═══ */
await test("F1 Frances: no ducking, 'told to put', the third pass; keys", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const all = fb.__F.map(f=>f.what||"").join(" ");
  assert.ok(!all.includes("duckable") && !all.includes("exactly where the render put each line"));
  const w = (fb.__F.find(f=>f.name==="The Stage (Production)")||{}).what || "";
  for(const re of [/MIX REVIEW, THIRD PASS/, /placed from the video's own time/, /re-voiced since/, /native performance/, /one estimate for action shots/, /on this device only/, /a scene at a time/])
    assert.ok(re.test(w), String(re));
  // (later passes re-key some of these files again)
  for(const f of ["stage.jsx", "ai.jsx", "script.jsx", "voicegen.jsx"]) assert.ok(["20261009-mix3","20261009-wr3", "20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31"].some(k=>html.includes('src="app/'+f+'?v='+k+'"')), f);
  assert.ok(["20261009-mix3", "20261009-home3", "20261009-teamrv1", "20261009-bd4", "20261009-stageed1", "20261009-sb4", "20261010-pose2", "20261010-voice1", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

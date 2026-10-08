#!/usr/bin/env node
/* The Stage review (owner 2026-10-05: "go ahead with all of it").
   A  continuity: the previous clip's take rides only within the same scene; the hooks run before the empty state
   B  honest Stop; a priced, asked-first voice clip; several takes ask first; view-only can't render or change takes
   C  one status per clip (stageClipReadiness): frames missing / not approved / out of date / earlier look + missing references
   D  plain labels: no vendor names in the Stage's copy, Split to fit / Earlier grouping, clip codes carry their beats
   E  the film export: the clips left out (and why), the Mix plan, and the recording itself with the Mix
      (the take's sound at the Picture level, lines where the render put them, each scene's beds) — or without it
   F  the Mix's beds are kept with the film on this device (per film, per scene), and the Mix tab uses them
   G  Frances knows all of it, and no older Stage sentence contradicts it
     node scripts/test-stage-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
const fn = (src, name)=>{ const i = src.indexOf("function "+name+"("); assert.ok(i>=0, name); const k = src.lastIndexOf("\n", i)+1; return src.slice(k, src.indexOf("\n}\n", i)+3); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const tx = (src)=> transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code;
const st = read("app/stage.jsx"), vg = read("app/voicegen.jsx"), vgen = read("app/videogen.jsx"), ai = read("app/ai.jsx");

/* ═══ A ═══ */
await test("A1 the previous clip's take is a continuity reference only inside the same scene", ()=>{
  const line = between(st, "const prevBeatVideoId = ", ";\n");
  const pick = vm.runInNewContext("(function(allClips, clipIdx, clip){ "+line+"; return prevBeatVideoId; })");
  const a = { id:"a", scene:{ id:"s1" } }, b = { id:"b", scene:{ id:"s1" } }, c = { id:"c", scene:{ id:"s2" } };
  assert.equal(pick([a,b,c], 1, b), "a");
  assert.equal(pick([a,b,c], 2, c), null, "a new scene starts fresh");
  assert.equal(pick([a,b,c], 0, a), null);
});
await test("A2 the Stage's hooks all run before its empty state returns (no hook-order crash)", ()=>{
  const view = between(st, "function StageView({", "window.StageView = StageView;");
  const early = view.indexOf("if(!scenesWithShots.length){");
  assert.ok(early > 0 && view.indexOf("const [railOpen, _setRailOpen] = React.useState(") < early);
  assert.ok(!/React\.use(State|Effect|Memo|Ref|Callback)\(/.test(view.slice(early, view.indexOf("\n  }\n", early))));
});

/* ═══ B ═══ */
await test("B1 Stop says the truth: the sent render keeps going and is charged if it finishes", ()=>{
  assert.ok(vgen.includes("Stopped waiting. The render was already sent, so it keeps going on the server: if it finishes it is still charged and appears in this clip\\u2019s takes."));
  assert.ok(!/"Cancel render"/.test(st));
});
await test("B2 a voice clip is priced per line and asks first", ()=>{
  const b = { console, Math, Number, String }; b.window = b; vm.createContext(b);
  vm.runInContext(fn(vg, "vgLineCredits"), b);
  b.turnCreditCost = (usd)=>Math.max(1, Math.ceil(usd/0.01 - 1e-9));
  const turbo = b.vgLineCredits("x".repeat(1000), "eleven_turbo_v2_5"), full = b.vgLineCredits("x".repeat(1000), "eleven_multilingual_v2");
  assert.ok(turbo >= 1 && full > turbo, turbo+" / "+full);
  const vc = between(st, "const onVoiceClip = ", "\n  };\n");
  assert.ok(vc.includes("window.appConfirm") && vc.includes("about \"+voiceClipCredits+\" credit"));
});
await test("B3 several takes ask first with the total; a view-only role can't render, choose, approve or delete takes", ()=>{
  const g = between(st, "const onGenerate = async (attemptOptions)=>{", "if(typeof window.nbAssertMediaIdentity===\"function\"){");
  assert.ok(g.indexOf("if(readOnly){") < g.indexOf("Render \"+n+\" takes of this clip?"));
  assert.ok(g.includes('confirmLabel:"Render "+n+" takes"'));
  const vers = between(st, "function StageVersionsView({ clip, stageModel, onBack, onReuse, readOnly=false, project }){", "\n}\n");
  assert.equal((vers.match(/disabled:readOnly\|\|!sel/g)||[]).length, 3);
  assert.ok(vers.includes("del:async (url)=>{ if(!window.vidDeleteTake || readOnly) return;") && vers.includes("window.appConfirm"));
});

/* ═══ C ═══ */
await test("C1 one status per clip: frames and references in one sentence", ()=>{
  const b = { console, Object, Array, String, Math }; b.window = b; vm.createContext(b);
  vm.runInContext(fn(st, "stageClipReadiness"), b);
  b.stageClipSourcePlan = ()=>({ mode:"frames" });
  const states = { s1:{ rendered:false }, s2:{ rendered:true, approved:false, current:true }, s3:{ rendered:true, approved:true, current:false, oldLook:true } };
  b.shotFrameState = (sh)=>states[sh.id];
  b.sceneReferenceNeeds = ()=>[{ label:"NEO sheet" }];
  const r = b.stageClipReadiness({ scene:{ id:"sc" }, data:{ shots:[{ id:"s1" },{ id:"s2" },{ id:"s3" }] } }, {}, {}, {});
  assert.deepEqual(J(r.frames), { missing:1, unapproved:1, stale:1, oldLook:1, charChanged:0 });
  assert.equal(r.text, "1 frame not made yet · 1 frame not approved · 1 frame out of date · 1 frame made with an earlier look · missing: NEO sheet");
  assert.ok(st.includes('title:"Render with these inputs?"') && st.includes('"Make what this clip needs"'));
});

/* ═══ D ═══ */
await test("D1 the Stage's copy names no vendor and uses the new grouping names", ()=>{
  const literals = (st.match(/"(?:[^"\\\n]|\\.)*"/g)||[]).filter(x=>/[a-z] [a-z]/i.test(x));
  const bad = literals.filter(x=>/ElevenLabs|fal\.ai|\bfal\b|bytedance/i.test(x));
  assert.deepEqual(bad, []);
  assert.ok(!/"Fit beat"|"Previous packing"/.test(st) && st.includes('"Split to fit"') && st.includes('"Earlier grouping"'));
});
await test("D2 clip codes carry their beats", ()=>{
  const b = {}; vm.createContext(b); vm.runInContext(fn(st, "stageClipBeatName"), b);
  assert.equal(b.stageClipBeatName({ label:"03A", g:{ shots:[{ beatN:4 }, { beatN:4 }] } }), "03A · Beat 4");
  assert.equal(b.stageClipBeatName({ label:"03B", g:{ shots:[{ beatN:6 }, { beatN:5 }] } }), "03B · Beats 5–6");
  assert.equal(b.stageClipBeatName({ label:"03C", g:{ shots:[] } }), "03C");
});

/* ═══ E ═══ */
const mixSrc = between(st, "const STAGE_MIX_DEFAULTS = ", "window.stageMixSettings = stageMixSettings;");
const mkBox = (extra)=>{ const b = { console, Object, Array, String, Number, Math, JSON, Set, Promise, Error, ...(extra||{}) }; b.window = b; vm.createContext(b);
  vm.runInContext("const CLIP_AIR = { lead:0.6, gap:0.8, tail:0.6 };\n"+fn(st, "clipLinePlacements")+fn(st, "stageClipBeatName")+mixSrc, b);
  b._shotAudioState = (sh, auds)=>({ ready:!!(auds && auds[sh.id]) }); b.stageShotRuntime = ()=>2; b._seedanceVoiceSec = ()=>2;
  return b; };
const clipA = { id:"A", label:"01A", scene:{ id:"s1" }, g:{ shots:[{ beatN:1 }] }, data:{ shots:[{ id:"a1", dialogue:"Hello.", lineAudio:{ durationMs:1500 } }] } };
const clipB = { id:"B", label:"01B", scene:{ id:"s1" }, g:{ shots:[{ beatN:2 }] }, data:{ shots:[{ id:"b1", action:"walks" }] } };
const clipC = { id:"C", label:"02A", scene:{ id:"s2" }, g:{ shots:[{ beatN:3 }] }, data:{ shots:[{ id:"c1", dialogue:"Bye." }] } };
const clipD = { id:"D", label:"02B", scene:{ id:"s2" }, g:{ shots:[{ beatN:4 }] }, data:{ shots:[] } };
await test("E1 the clips left out, and why, in the Timeline's names", ()=>{
  const b = mkBox();
  const sk = b.stageExportSkipped([clipA, clipB, clipC, clipD], { A:"u", B:"u" }, { C:true });
  assert.deepEqual(J(sk), [{ id:"C", name:"02A · Beat 3", why:"out of date" }, { id:"D", name:"02B · Beat 4", why:"not rendered" }]);
  assert.equal(b.stageExportSkippedText(sk), "Left out: 02A · Beat 3 (out of date), 02B · Beat 4 (not rendered)");
  assert.equal(b.stageExportSkippedText([]), "");
  const many = Array.from({ length:8 }, (_, i)=>({ name:"0"+i, why:"not rendered" }));
  assert.match(b.stageExportSkippedText(many), / and 2 more$/);
});
await test("E2 the Mix plan: levels (a mute is 0), the voiced lines only, each scene's beds; nothing to mix = no question", ()=>{
  const b = mkBox();
  const vids = { A:"va", B:"vb", C:"vc" };
  const plan = b.stageExportMixPlan([clipA, clipB, clipC], vids, { auds:{ a1:"line-a1" }, beds:{ s1:{ amb:{ url:"bed-amb" }, music:{ url:"bed-mus" } } },
    gain:{ native:0.3, dialogue:0.9, amb:0.6, music:0.4 }, mute:{ music:true } });
  assert.deepEqual(J(plan.gains), { native:0.3, dialogue:0.9, amb:0.6, music:0 });
  assert.deepEqual(J(plan.items), [{ id:"A", sceneId:"s1", lines:[{ at:0.6, url:"line-a1" }] }, { id:"B", sceneId:"s1", lines:[] }, { id:"C", sceneId:"s2", lines:[] }],
    "C's line isn't voiced, so it isn't in the mix");
  assert.deepEqual(J(plan.beds), { s1:{ amb:"bed-amb", music:"bed-mus" }, s2:{ amb:"", music:"" } });
  assert.equal(plan.lineN, 1); assert.equal(plan.bedN, 1, "the muted music bed doesn't count"); assert.equal(plan.has, true);
  const none = b.stageExportMixPlan([clipB], { B:"vb" }, {});
  assert.equal(none.has, false); assert.deepEqual(J(none.gains), { native:0.35, dialogue:1, amb:0.7, music:0.5 });
  assert.equal(b.stageExportMixPlan([clipA], { A:"va" }, { auds:{ a1:"x" }, mute:{ dialogue:true } }).has, false, "muted dialogue = nothing to mix");
});
await test("E3 the Mix settings are read from the same per-film key the Mix tab writes", ()=>{
  const ls = new Map([["turn_stage_mix_film-1", JSON.stringify({ gain:{ native:0.2, dialogue:1, amb:0.5, music:0.1 }, mute:{ amb:true } })]]);
  const b = mkBox({ localStorage:{ getItem:(k)=>ls.has(k) ? ls.get(k) : null } });
  b.nbCloudScope = ()=>({ projectId:"film-1" });
  assert.deepEqual(J(b.stageMixSettings()), { gain:{ native:0.2, dialogue:1, amb:0.5, music:0.1 }, mute:{ amb:true } });
  assert.deepEqual(J(b.stageMixSettings("other")).gain, { native:0.35, dialogue:1, amb:0.7, music:0.5 });
  const au = between(st, "function StageAudioView({", "\n}\n");
  assert.ok(au.includes("const mixKey = stageMixKey();") && au.includes("localStorage.setItem(mixKey, JSON.stringify({ gain, mute }))"));
});

/* the real recorder, in a fake browser */
const exportSrc = between(st, "async function stageExportFilm(playlist, opts){", "window.stageExportFilm = stageExportFilm;");
const fakeBrowser = (bad)=>{
  const log = { starts:[], fetched:[], gains:[] };
  const node = (kind)=>{ const n = { kind, connect(t){ n.out = t; }, disconnect(){} }; return n; };
  class AC { constructor(){ this.currentTime = 10; }
    createMediaElementSource(){ return node("media"); }
    createMediaStreamDestination(){ const n = node("dest"); n.stream = { getAudioTracks:()=>[] }; return n; }
    createGain(){ const n = node("gain"); n.gain = { value:1 }; log.gains.push(n); return n; }
    createBufferSource(){ const n = node("buf"); n.start = (when)=>log.starts.push({ url:n.buffer.url, when, loop:n.loop, gain:n.out.gain.value }); n.stop = noop; return n; }
    decodeAudioData(ab, res){ res({ url:ab.url }); }
    resume(){ return Promise.resolve(); } close(){} }
  const video = { readyState:2, videoWidth:1280, videoHeight:720, load:noop, pause:noop, removeAttribute:noop,
    play(){ setTimeout(()=>video.onended && video.onended(), 2); return Promise.resolve(); } };
  Object.defineProperty(video, "src", { set(v){ this._src = v; setTimeout(()=>this.onloadedmetadata && this.onloadedmetadata(), 0); }, get(){ return this._src; } });
  class MR { static isTypeSupported(){ return true; } constructor(){ this.state = "inactive"; } start(){ this.state = "recording"; }
    stop(){ if(this.state==="inactive") return; this.state = "inactive"; this.ondataavailable({ data:{ size:1 } }); setTimeout(()=>this.onstop(), 0); } }
  const b = { console, Promise, Error, Object, Array, String, Number, Math, setTimeout, clearTimeout, setInterval, clearInterval,
    MediaRecorder:MR, requestAnimationFrame:()=>1, cancelAnimationFrame:noop,
    Blob:class { constructor(c, o){ this.parts = c.length; this.type = o.type; } },
    fetch:async (url)=>{ log.fetched.push(url); if(url===bad) throw new Error("blocked"); return { arrayBuffer:async ()=>({ url }) }; },
    document:{ createElement:(t)=> t==="video" ? video : { getContext:()=>({ fillRect:noop, drawImage:noop, getImageData:noop }), captureStream:()=>({ addTrack:noop, getTracks:()=>[] }) } } };
  b.window = b; b.AudioContext = AC; vm.createContext(b);
  vm.runInContext(exportSrc, b);
  return { b, log };
};
const playlist = [{ id:"A", url:"va" }, { id:"B", url:"vb" }, { id:"C", url:"vc" }];
const plan = { has:true, gains:{ native:0.3, dialogue:0.9, amb:0.6, music:0.4 },
  items:[{ id:"A", sceneId:"s1", lines:[{ at:0.6, url:"line-a1" }, { at:2.5, url:"line-bad" }] }, { id:"B", sceneId:"s1", lines:[] }, { id:"C", sceneId:"s2", lines:[] }],
  beds:{ s1:{ amb:"bed-amb", music:"bed-mus" }, s2:{ amb:"", music:"" } } };
await test("E4 with the Mix: the take's sound at the Picture level, lines at their seconds, each scene's beds once (ambience loops)", async ()=>{
  const { b, log } = fakeBrowser("line-bad");
  const report = {};
  const blob = await b.stageExportFilm(playlist, { mix:plan, report });
  assert.equal(blob.type, "video/webm;codecs=vp9,opus");
  assert.deepEqual(log.gains.map(g=>g.gain.value), [0.3, 0.9, 0.6, 0.4], "Picture, Dialogue, Ambience, Music");
  assert.deepEqual(J(log.starts), [
    { url:"bed-amb", when:10, loop:true, gain:0.6 }, { url:"bed-mus", when:10, loop:false, gain:0.4 },
    { url:"line-a1", when:10.6, loop:false, gain:0.9 } ], "scene 1's beds start once (not again for clip B); scene 2 has none; the unreadable line is skipped");
  assert.equal(report.audioMissed, 1);
});
await test("E5 without the Mix: each take's sound as rendered, nothing else read or played", async ()=>{
  const { b, log } = fakeBrowser();
  await b.stageExportFilm(playlist, { mix:null, report:{} });
  assert.deepEqual(log.gains.map(g=>g.gain.value), [1]);
  assert.equal(log.starts.length, 0); assert.equal(log.fetched.length, 0);
});
await test("E6 the Timeline asks first (with the Mix / Picture sound only / the clips left out) and says what was left out after", ()=>{
  const tl = between(st, "function StageTimelineView({", "\n}\n");
  assert.ok(/function StageTimelineView\(\{[^}]*\bauds, characters\b[^}]*\}\)/.test(st));
  assert.ok(tl.includes('confirmLabel: mix ? "Export with the Mix" : "Export", altLabel: mix ? "Picture sound only" : undefined'));
  assert.ok(tl.includes('if(ans==="alt") mix = null;') && tl.includes("mix, report,"));
  assert.ok(tl.includes("const left = stageExportSkippedText(skipped);") && tl.includes("couldn't be read and "));
  assert.ok(st.includes('filmTitle:(project&&project.title)||"", auds, characters,'));
});

/* ═══ F ═══ */
await test("F1 Mix beds are kept per film and per scene on this device; another film never sees them", async ()=>{
  const store = new Map();
  const idb = { open(){ const req = {}; setTimeout(()=>{ req.result = { objectStoreNames:{ contains:()=>true }, transaction(){ const t = { objectStore(){ return {
      put(v, k){ store.set(k, v); setTimeout(()=>t.oncomplete && t.oncomplete(), 0); },
      get(k){ const r = {}; setTimeout(()=>{ r.result = store.get(k); r.onsuccess && r.onsuccess(); }, 0); return r; },
      delete(k){ store.delete(k); setTimeout(()=>t.oncomplete && t.oncomplete(), 0); } }; } }; return t; } }; req.onsuccess(); }, 0); return req; } };
  const b = { console, Promise, Map, String, Date, setTimeout, indexedDB:idb }; b.window = b; vm.createContext(b);
  vm.runInContext(between(vg, "const VGIDB_DB=", "// ---- persist one rendered line")
    + between(vg, "/* ---- Mix beds", "window.vgSaveMixBed=vgSaveMixBed;"), b);
  b.__turnCurrentProjectId = "film-1";
  await b.vgSaveMixBed("s1", "amb", "data:audio/mp3;base64,AAA", "rain.mp3");
  assert.ok(store.has("a:film-1:mix-bed:s1:amb"));
  b.vgResetAll();
  const back = await b.vgLoadMixBed("s1", "amb");
  assert.equal(back.url, "data:audio/mp3;base64,AAA"); assert.equal(back.meta.name, "rain.mp3");
  assert.equal(await b.vgLoadMixBed("s1", "music"), null);
  assert.equal(await b.vgLoadMixBed("s2", "amb"), null, "per scene");
  b.__turnCurrentProjectId = "film-2"; b.vgResetAll();
  assert.equal(await b.vgLoadMixBed("s1", "amb"), null, "per film");
  b.__turnCurrentProjectId = "film-1";
  await b.vgClearMixBed("s1", "amb");
  assert.equal(await b.vgLoadMixBed("s1", "amb"), null);
});
await test("F2 the Mix tab loads each scene's saved beds, saves imports (50 MB cap), and can remove one", async ()=>{
  const b = mkBox();
  const saved = { "s1:amb":{ url:"u1", meta:{ name:"rain.mp3" } }, "s2:music":{ url:"u2", meta:{} } };
  b.vgLoadMixBed = async (sid, k)=> saved[sid+":"+k] || null;
  assert.deepEqual(J(await b.stageLoadMixBeds([clipA, clipB, clipC])), { s1:{ amb:{ url:"u1", name:"rain.mp3" } }, s2:{ music:{ url:"u2", name:"Music" } } });
  const au = between(st, "function StageAudioView({", "\n}\n");
  assert.ok(au.includes("stageLoadMixBeds(allClips).then(b=>{ if(on) setBeds(b); })"));
  assert.ok(au.includes("await window.vgSaveMixBed(sid, k, url, f.name)") && au.includes("window.VG_MIX_BED_MAX_BYTES"));
  assert.ok(au.includes("window.vgClearMixBed(sid, k)") && au.includes('"Remove"'));
  assert.ok(!/imported beds live for this session only/i.test(au), "the old 'session only' line is gone");
});

/* ═══ G ═══ */
await test("G1 Frances: the Stage review, and no older sentence contradicts it", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="The Stage (Production)")||{}).what || "";
  for(const re of [/only when it is in the SAME scene/, /button reads 'Stop'/, /'Voice clip' shows its price and asks first/, /more than one take at once asks first/,
    /'Make what this clip needs'/, /'Render with these inputs\?'/, /'Split to fit'/, /'Earlier grouping'/, /'Export with the Mix'/, /'Picture sound only'/, /listed as left out/,
    /kept with the film on this device/]) assert.ok(re.test(w), String(re));
  const all = fb.__F.map(f=>String(f.what||"")).join(" ");
  assert.ok(!/Beds are session-only|Fit beat|Previous packing/.test(all));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

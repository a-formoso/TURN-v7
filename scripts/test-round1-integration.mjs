#!/usr/bin/env node
/* test-round1-integration.mjs — Writers' Room readiness, round 1: the SEAMS between the four
   builders' changes (owner request 2026-09-28, "Go round 1").

   Each builder's own suite (test-round1-ai / -script / -state / -ui) proves its side. This one
   runs the REAL files together in node:vm (stubbed model calls — no network, no Supabase) and
   proves the wiring across them:
     1  the spine's plain failure reason (ai.jsx aiBuildSpine → window.__lastSpineFailure) is what
        the Adaptation log says (agents.jsx), a stale reason never leaks into a later build, and a
        short spine's note is flagged before the proposal card;
     2  aiCastPsychology's report (ai.jsx) drives the build's honest psychology log (agents.jsx):
        a pass that never came back is never called "the script bears out every character";
     3  the Inspector's beat maps (inspector.jsx) carry the film token app.jsx's setBeatsFor drops
        after a film switch — "Create beat map" and "Rebuild from script" alike;
     4  the Script view gets the app's live drafts and film key (app.jsx → script.jsx "Write this
        beat"), the same key the redraft and beat-map guards use;
     5  "Redraft N out-of-date" stopped by a film switch says so once, never with a borrowed reason;
     6  APP_FEATURES (MUSE's facts) describe the round's behaviour, drop the claims that were never
        true, and every new sentence reaches MUSE with no vendor name;
     7  every file changed this round loads under the round's cache key.
   node scripts/test-round1-integration.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f)=>readFileSync(ROOT + f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,8).join("\n    ")); }
};
const noop = ()=>{};
const between = (src, a, b)=>{
  const i = src.indexOf(a); assert.ok(i>=0, "marker not found: "+a);
  const j = src.indexOf(b, i + a.length); assert.ok(j>=0, "marker not found: "+b);
  return src.slice(i, j);
};
const fnSrc = (src, name, indent)=>{
  indent = indent || "  ";
  const start = src.indexOf("\n"+indent+"const "+name+" = ");
  assert.ok(start>=0, "found "+name);
  const end = src.indexOf("\n"+indent+"};", start);
  return src.slice(start+1, end+indent.length+3);
};

/* ---------------- sandbox: the real app files ---------------- */
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const ReactStub = new Proxy({
  createElement:h, Fragment:"frag",
  useState:(x)=>[typeof x==="function" ? x() : x, noop], useRef:(x)=>({ current:x }), useEffect:noop,
  useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f, memo:(f)=>f, forwardRef:(f)=>f,
  createContext:()=>({ Provider:"provider" }), useContext:()=>null,
}, { get:(t,k)=> (k in t) ? t[k] : noop });
const asShipped = (f)=>transformSync(read(f), { plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename:f }).code;
const box = {
  console:{ ...console, warn:noop, info:noop, log:noop }, clearTimeout, setInterval, clearInterval,
  setTimeout:(f)=>setTimeout(f, 0),
  React:ReactStub, ReactDOM:new Proxy({}, { get:()=>noop }),
  Icon:new Proxy({}, { get:(t,k)=>{ const f = ()=>null; f.iconName = String(k); return f; } }),
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
  CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
  Image:class {},
  document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop, classList:{ add:noop, remove:noop } }),
    getElementById:()=>null, addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], createTextNode:()=>({}),
    body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
  requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
  matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
  fetch:()=>{ throw new Error("network disabled in this test"); },
};
box.window = box; box.globalThis = box; box.self = box;
box.__replies = []; box.__toasts = [];
// installed BEFORE ai.jsx, so its proxy shim is skipped; an empty queue answers "" (unreadable)
box.claude = { complete: async ()=>{ const r = box.__replies.shift(); if(r instanceof Error) throw r; return r == null ? "" : r; } };
vm.createContext(box);
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx",
  "app/spine.jsx","app/script.jsx","app/ai.jsx","app/agents.jsx"])
  vm.runInContext(f==="app/script.jsx" ? asShipped(f) : read(f), box, { filename:f });
box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
box.appConfirm = async ()=>true;
const compile = (body, env, ret)=>{
  const names = Object.keys(env);
  return vm.runInContext("(function("+names.join(",")+"){\n"+body+"\n return { "+ret.join(", ")+" }; })", box)(...names.map(n=>env[n]));
};
const appSrc = read("app/app.jsx"), inspSrc = read("app/inspector.jsx"), agentsSrc = read("app/agents.jsx"), html = read("TURN.html");

/* one Adaptation build on a fresh film, with the spine / world / scene calls stubbed */
const real = (s)=>({ blocks:[{ beat:1, type:"action", text:"Scene "+s.no+" written." }], ai:true, auto:false });
const TWO = [
  { act:1, title:"Open", loc:"INT. DINER - NIGHT", summary:"Mara opens up.", driver:"mara", openValue:"calm", openCharge:1, closeValue:"alarm", closeCharge:-1 },
  { act:2, title:"Push", loc:"INT. DINER - NIGHT", summary:"Tomas pushes.", driver:"tomas", openValue:"calm", openCharge:1, closeValue:"alarm", closeCharge:-1 }];
const build = async (ai)=>{
  const model = { scenes:[], beats:{}, drafts:{}, continuity:{}, characters:[], project:{ title:"Night Shift", format:"film" } };
  const trace = []; let proposed = -1;
  const ctx = { input:"A night cook inherits a diner.", project:model.project, model,
    emit:(e)=>trace.push(e), propose:async ()=>{ proposed = trace.length; return true; }, cancelled:()=>false, switchedFilms:()=>false, sync:noop,
    ai:{ available:true,
      buildStoryWorld:async ()=>({ genre:"drama", premise:"p", controllingIdea:{ value:"v" }, setting:{},
        cast:[{ id:"mara", name:"Mara Quinn", role:"Protagonist" }, { id:"tomas", name:"Tomas Iturbe", role:"Supporting" }] }),
      authorScene:async ()=>({ patch:{}, beats:{ rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] } }),
      draftScene:async (s)=>real(s),
      continuityLedger:async ()=>({ map:{}, facts:{}, ledger:{} }), ...ai } };
  await box.agentAdaptation(ctx);
  return { trace, proposed, flags:trace.filter(e=>e.k==="flag").map(e=>e.t) };
};

/* ======================= 1. spine failure reason and short-spine note ======================= */
await test("1a the REAL aiBuildSpine's plain failure reason is what the Adaptation log says", async ()=>{
  box.__replies = [];   // every spine half comes back empty, twice
  const r = await build({ buildSpine:(b)=>box.aiBuildSpine(b, "film", "threeact") });
  assert.ok(r.flags.some(t=>/^The opening half of the spine \(the film's setup and title\) didn't come back after two tries, so nothing was built\./.test(t)), JSON.stringify(r.flags));
  assert.ok(!r.flags.some(t=>/Try a more concrete logline/.test(t)), "never the old guess");
  assert.equal(r.proposed, -1, "nothing is proposed");
  assert.ok(r.trace.some(e=>e.k==="done" && e.t==="Aborted."));
});
await test("1b a reason left by an earlier build never leaks into a later one", async ()=>{
  box.__lastSpineFailure = "The closing half of the spine (the climax and ending) didn't come back after two tries, so nothing was built. Run it again in a moment.";
  const r = await build({ buildSpine:async ()=>null });   // a builder that fails without saying why
  assert.ok(r.flags.includes("The model didn't return a usable spine. Try a more concrete logline."), JSON.stringify(r.flags));
  assert.ok(!r.flags.some(t=>/closing half/.test(t)));
});
await test("1c a short spine's note is flagged before the proposal card, and the build goes on", async ()=>{
  const r = await build({ buildSpine:async ()=>({ title:"Night Shift", scenes:TWO.map(s=>({ ...s })),
    short:{ got:2, want:16, note:"Built 2 of the 16 scenes this format aims for." } }) });
  const i = r.trace.findIndex(e=>e.k==="flag" && e.t==="Built 2 of the 16 scenes this format aims for. You can approve it as it is, or decline and run it again.");
  assert.ok(i>=0, JSON.stringify(r.flags));
  assert.ok(r.proposed>i, "the note comes before the proposal");
  const plain = await build({ buildSpine:async ()=>({ title:"Night Shift", scenes:TWO.map(s=>({ ...s })) }) });
  assert.ok(!plain.flags.some(t=>/scenes this format aims for/.test(t)), "a full spine carries no note");
});

/* ======================= 2. psychology report → honest log ======================= */
await test("2 a psychology pass that never came back (real aiCastPsychology, unreadable replies) is said so — never 'bears out every character'", async ()=>{
  box.__replies = [];   // every model call answers "" — the psychology batches stay unreadable after their retry
  const r = await build({ buildSpine:async ()=>({ title:"Night Shift", scenes:TWO.map(s=>({ ...s })) }) });
  assert.ok(r.flags.some(t=>/^Couldn't design the cast's inner life before writing this time/.test(t)), JSON.stringify(r.flags));
  assert.ok(r.flags.some(t=>/^Couldn't design the cast's inner life this time, so the characters have no want, need or arc yet\./.test(t)), JSON.stringify(r.flags));
  assert.ok(!r.trace.some(e=>/bears out every character/.test(e.t||"")), "no false success");
  assert.ok(Array.isArray((box.__lastCastPsychology||{}).failedIds) && box.__lastCastPsychology.failedIds.length>0, "ai.jsx reported who failed");
});

/* ======================= 3. Inspector beat maps carry the film token ======================= */
await test("3 'Create beat map' and 'Rebuild from script' land only in the film they were asked for", async ()=>{
  // the REAL setBeatsFor (app.jsx) and the REAL BeatEditor handlers (inspector.jsx)
  let film = "film:A"; const beatsMap = {};
  const app = compile(fnSrc(appSrc, "setBeatsFor"), { castDraftFilmKey:()=>film, canMutateWritersRoom:()=>true,
    withBeatIdentity:undefined, setBeatsMap:(f)=>{ Object.assign(beatsMap, f(beatsMap)); } }, ["setBeatsFor"]);
  box.turnFilmToken = ()=>film;
  const handlers = between(inspSrc, "  const filmToken = ", "  const id = scene.id;");
  let release = null;
  const MAP = { rows:[{ n:1, drive:{ a:"A", d:"d" }, react:{ a:"R", d:"r" } }] };
  // deriveFails: the script couldn't be read, so "Create beat map" falls back to a blank skeleton
  // (2026-10-09, Writers' Room third pass) deriveFromScript answers { map } or { error }, and a failure is said
  const mk = (deriveFails)=> compile(handlers, { readOnly:false, deriving:false, hasScript:true, scene:{ id:"s1" }, setDeriving:noop, beats:null, toast:noop,
    deriveFromScript:()=> new Promise(r=>{ release = ()=>r(deriveFails ? { error:"x" } : { map:MAP }); }), onBeats:app.setBeatsFor, window:box }, ["createMap","rebuildFromScript"]);
  // switch films while the map is being built → dropped
  for(const [label, run] of [["create", ()=>mk(false).createMap()], ["rebuild", ()=>mk(false).rebuildFromScript(true)], ["create, blank fallback", ()=>mk(true).createMap()]]){
    film = "film:A"; delete beatsMap.s1;
    const p = run(); await new Promise(r=>setTimeout(r, 0));
    film = "film:B"; release(); await p;
    assert.equal(beatsMap.s1, undefined, label+": film B's Sc 1 is untouched");
  }
  // same film → applied (the map, or the blank skeleton when the script couldn't be read)
  film = "film:A";
  const p = mk(false).createMap(); await new Promise(r=>setTimeout(r, 0)); release(); await p;
  assert.deepEqual(beatsMap.s1, MAP, "applied in the film it was asked for");
  delete beatsMap.s1;
  const q = mk(true).createMap(); await new Promise(r=>setTimeout(r, 0)); release(); await q;
  assert.equal(beatsMap.s1 && beatsMap.s1.driverLabel, "DRIVER", "the blank skeleton lands in its own film");
  // the Inspector hands BeatEditor app.jsx's setBeatsFor itself (no wrapper that drops the token)
  assert.ok(/onBeats:setBeatsFor,/.test(appSrc) && /React\.createElement\(BeatEditor,\{scene,beats,onBeats,/.test(inspSrc));
});

/* ======================= 4. Script view ← app.jsx live state ======================= */
await test("4 the Script view gets the app's live drafts and film key — one key for every late writer", ()=>{
  const sv = between(appSrc, "React.createElement(ScriptView,{scene:sel,beats,", "// click a beat in the Script gutter");
  assert.ok(sv.includes("onEditScene:commitVersion,"), "Write this beat commits through commitVersion");
  assert.ok(sv.includes("getDraft:(id)=>draftsRef.current[id], filmKey:castDraftFilmKey,"), sv);
  assert.ok(/window\.turnFilmToken = castDraftFilmKey;/.test(appSrc) && /window\.turnSameFilm = \(tok\)=> tok===castDraftFilmKey\(\);/.test(appSrc),
    "the redraft and beat-map guards use the same key");
  assert.ok(/const draftsRef = React\.useRef\(\{\}\); draftsRef\.current = drafts;/.test(appSrc), "draftsRef is the live drafts");
  assert.ok(/function ScriptView\(\{[^)]*getDraft, filmKey \}\)/.test(read("app/script.jsx")), "ScriptView takes both props");
});

/* ======================= 5. Redraft N out-of-date stopped by a film switch ======================= */
await test("5 a film switch during 'Redraft N out-of-date' is said once, with no borrowed failure reason", async ()=>{
  box.__toasts = [];
  const projIdRef = { current:"A" }; let busy = null;
  const scenes = [{ id:"s1", no:1, act:1 }, { id:"s2", no:2, act:1 }, { id:"s3", no:3, act:1 }];
  let calls = 0;
  const env = { redraftingAll:null, canMutateWritersRoom:()=>true, scenesInStoryOrder:(x)=>x.slice(), scenes,
    staleMap:{ s1:["title"], s2:["title"], s3:["title"] }, currentProjectId:"A", projIdRef, setRedraftingAll:(v)=>{ busy = v; },
    lastPolishFailureRef:{ current:null }, beatsMap:{}, window:box,
    // Sc 1 lands; the writer switches films while Sc 2 is being redrafted (polishScene drops it)
    redraftScene:async ()=>{ calls++; if(calls===1) return true; projIdRef.current = "B"; return false; } };
  const { redraftAllStale } = compile(fnSrc(appSrc, "redraftAllStale"), env, ["redraftAllStale"]);
  await redraftAllStale();
  assert.equal(calls, 2, "the batch stops at the switch");
  assert.equal(box.__toasts.length, 1, JSON.stringify(box.__toasts));
  assert.equal(box.__toasts[0].t, "info");
  assert.ok(/^You switched films, so Redraft out-of-date stopped: 1 of 3 scenes were redrafted in that film/.test(box.__toasts[0].m), box.__toasts[0].m);
  assert.ok(!/read-only/.test(box.__toasts[0].m));
  assert.equal(busy, null);
  // polishScene stays quiet about the switch inside the batch (the batch says it once)
  const ps = fnSrc(appSrc, "polishScene");
  assert.ok(/if\(res && filmTok!==undefined && !window\.turnSameFilm\(filmTok\)\)\{\s*\/\/[^\n]*\n\s*if\(!\(opts && opts\.quiet\) && typeof window\.appToast==="function"\) window\.appToast\("You switched films while Scene /.test(ps));
});

await test("5 (review) 'Redraft N out-of-date' has its own progress card with i of N and a Stop: the scene in flight is kept, the rest stay marked", async ()=>{
  box.__toasts = [];
  const projIdRef = { current:"A" }; let busy = null; const seen = [];
  const scenes = [1,2,3,4].map(n=>({ id:"s"+n, no:n, act:1 }));
  let calls = 0;
  const env = { redraftingAll:null, canMutateWritersRoom:()=>true, scenesInStoryOrder:(x)=>x.slice(), scenes,
    staleMap:{ s1:["summary"], s2:["summary"], s3:["summary"], s4:["summary"] }, currentProjectId:"A", projIdRef,
    setRedraftingAll:(v)=>{ busy = typeof v==="function" ? v(busy) : v; if(busy) seen.push({ ...busy }); },
    lastPolishFailureRef:{ current:null }, beatsMap:{}, window:box,
    // the writer presses Stop while Scene 2 is being redrafted
    redraftScene:async ()=>{ calls++; if(calls===2){ const stop = compile(fnSrc(appSrc, "stopRedraftAll"), { redraftingAll:busy, setRedraftingAll:env.setRedraftingAll }, ["stopRedraftAll"]).stopRedraftAll; stop(); } return true; } };
  const { redraftAllStale } = compile(fnSrc(appSrc, "redraftAllStale"), env, ["redraftAllStale"]);
  await redraftAllStale();
  assert.equal(calls, 2, "Scene 2 (in flight) finishes; Scenes 3 and 4 aren't started");
  assert.deepEqual(seen.map(x=>[x.i, x.total, x.no, !!x.stopping]), [[1,4,1,false],[2,4,2,false],[2,4,2,true]]);
  assert.equal(busy, null, "the card closes");
  assert.equal(box.__toasts.length, 1);
  assert.equal(box.__toasts[0].m, "Redraft out-of-date stopped: 2 of 4 scenes redrafted — 2 are still marked out of date and unchanged. Press Redraft out-of-date to continue.");
  assert.equal(box.__toasts[0].t, "info");
  // the card itself: the batch's own title, the scene, progress, and the Stop wired to it
  const expr = between(appSrc, "    redraftingAll ? {", "    polishBusy ? {").replace(/\s*:\s*$/, "").trim();
  const card = (r)=>vm.runInContext("(function(redraftingAll, stopRedraftAll){ return ("+expr+" : null); })", box)(r, "STOP");
  const c1 = card({ i:3, total:8, no:5, run:{} });
  assert.equal(c1.title, "Redrafting 3 of 8 out-of-date scenes");
  assert.ok(c1.detail.startsWith("Scene 5: rebuilding its screenplay from the current card and beats."));
  assert.equal(c1.onStop, "STOP"); assert.equal(c1.stopping, false); assert.equal(Math.round(c1.progress), 31);
  const c2 = card({ i:3, total:8, no:5, run:{}, stopping:true });
  assert.equal(c2.detail, "Stopping after Scene 5 — it is kept, and the rest stay marked out of date."); assert.equal(c2.stopping, true);
  assert.ok(appSrc.indexOf("    redraftingAll ? {") < appSrc.indexOf("    polishBusy ? {"), "the batch card wins over the single-scene card");
  // a Stop during the LAST scene is just the end of the run: the usual summary
  box.__toasts = []; calls = 0; busy = null;
  const env2 = { ...env, redraftScene:async ()=>{ calls++; if(calls===4) busy.run.stop = true; return true; } };
  await compile(fnSrc(appSrc, "redraftAllStale"), env2, ["redraftAllStale"]).redraftAllStale();
  assert.equal(box.__toasts[0].m, "Redrafted 4 scenes from their current cards — Undo restores any of them.");
});

/* ======================= 6. APP_FEATURES — MUSE's facts ======================= */
await test("6 MUSE's facts describe the round, drop the claims that were never true, and name no vendor", ()=>{
  const F = vm.runInContext("APP_FEATURES", box);
  const what = (n)=> (F.find(f=>f.name===n) || F.find(f=>String(f.name).startsWith(n)) || {}).what || "";
  assert.ok(!F.some(f=>/STATUS DOCK/.test(f.what)), "there is no live status dock");
  const mobile = what("Mobile & small screens");
  assert.ok(!/under ~1100px the story rail and inspector become slide-in drawers/.test(mobile) && /only one of them is open at a time/.test(mobile)
    && /are in it at every width/.test(mobile), mobile.slice(0,300));   // the Film menu (2026-10-16)
  const expect = [
    ["Undo agent changes", /UNDO BELONGS TO ITS FILM/, /Undo <agent>’s changes\?/],
    ["Story Editors (Writers' Room agents)", /'Finish writing this film' button/, /'Stop building this film\?'/],
    ["Auto-draft all (N left)", /stops at that scene instead of filling the rest with rough stand-ins/, /Stop button/],
    ["Writers' Room run integrity", /the story build stops at that scene/, /THE SPINE IS WHOLE OR NOT AT ALL/],
    ["Redraft script from beats", /A REDRAFT LANDS ONLY IN ITS OWN FILM/],
    ["Undo / Redo (version history)", /up to 12 earlier versions per scene/, /it isn't added and a message says so/],
    ["Script view", /REMOVING A LINE WHILE TYPING IN ANOTHER/, /'ACT III → IV'/],
    ["Editing", /takes an act its new neighbours allow/],
    ["Board view", /Enter or Space/],
    ["Spine view", /FOLLOW verdict counts every act/, /total runtime stays/],
    ["Psychology before the script", /IN AN EPISODE, BEFORE THE SCRIPT TOO/],
    ["Screenplay page forms", /the subject's name followed by a colon/],
    ["Export (screenplay / story)", /⋯ menu/], ["Story brief (Brief button)", /'Story brief' entry/], ["Team collaboration", /'Team' entry/],
  ];
  for(const [n, ...res] of expect) for(const re of res) assert.ok(re.test(what(n)), n+" says "+re);
  // what MUSE actually receives keeps every new sentence, with no vendor or engine name
  const pub = Object.fromEntries(vm.runInContext("museFacts()", box).map(f=>[f.name, f.what]));
  const vendor = /\b(?:anthropic|openai|google|moonshot|claude|gpt|gemini|kimi|opus|fable|sonnet|haiku|mckee|supabase|prox(?:y|ies))\b/i;
  const R1 = F.filter(f=>/UNDO BELONGS TO ITS FILM|FINISH WRITING THIS FILM|STOPS WHEN EVERY SCENE WOULD FAIL|A REDRAFT LANDS ONLY|HOW MUCH IS KEPT|IN AN EPISODE, BEFORE THE SCRIPT TOO/.test(f.what));
  assert.ok(R1.length>=6);
  for(const f of R1){
    const tail = f.what.slice(f.what.search(/UNDO BELONGS|FINISH WRITING THIS FILM|STOPS WHEN EVERY|A REDRAFT LANDS|HOW MUCH IS KEPT|IN AN EPISODE, BEFORE/));
    const first = tail.split(/(?<=\.)\s/)[0];
    assert.ok((pub[f.name]||"").includes(first), f.name+": MUSE hears '"+first.slice(0,60)+"…'");
    assert.ok(!vendor.test(tail), f.name+": no vendor name");
  }
});

/* ======================= 7. cache keys ======================= */
await test("7 every file changed this round loads under the round's cache key (or a later one)", ()=>{
  const key = (f)=>(html.match(new RegExp(f.replace(/\./g, "\\.")+"\\?v=([^\"']+)")) || [])[1] || "";
  const LATER = ["20260928-brand1", "20260928-brand2", "20260929-look1", "20260929-look2", "20260929-look3", "20260929-look4", "20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-consent1", "20261002-tip1", "20261002-btn1", "20261002-team1", "20261002-scene1", "20261002-research1", "20261002-research2", "20261002-artlive1", "20261002-artundo1", "20261002-stagefilm1", "20261002-attrib1", "20261002-planpick2", "20261002-planpick3", "20261002-trialwelcome1", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team5", "20261003-team6", "20261003-team7", "20261003-team8", "20261003-lookbook1", "20261003-cast1", "20261004-props1", "20261004-locs1", "20261004-color1", "20261004-shots1", "20261005-sb1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261009-stage3", "20261009-tl3", "20261009-mix3", "20261009-wr3", "20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"];   // a later change that re-keys one of these files adds its key here (the Kinolot rebrand, the identity pass, Manage plan 2026-09-30: styles.css, ai.jsx, script.jsx) (billing fixes 2026-09-30: styles.css, ai.jsx, script.jsx) (consumer rights + tax 2026-10-01: styles.css, ai.jsx, script.jsx) (the 14-day note 2026-10-02: styles.css, ai.jsx, script.jsx) (the note behind an ⓘ 2026-10-02: styles.css, ai.jsx, script.jsx) (Team "Coming soon" 2026-10-02: styles.css, team.jsx, chrome.jsx, ai.jsx, script.jsx, app.jsx: 20261002-team1)
  for(const f of ["app/styles.css","app/team.jsx","app/spine.jsx","app/chrome.jsx","app/inspector.jsx","app/script.jsx",
    "app/ai.jsx","app/agents.jsx","app/agents-ui.jsx","app/app.jsx"])
    assert.ok(key(f)==="20260928-round1" || LATER.includes(key(f)), f+" re-keyed: "+key(f));
  assert.equal(key("app/script.jsx"), key("app/ai.jsx"), "script.jsx and ai.jsx share a key");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

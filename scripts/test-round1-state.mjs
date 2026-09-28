#!/usr/bin/env node
/* Writers' Room readiness — round 1, STATE & AGENTS (owner request 2026-09-28, "Go round 1").

   Runs the REAL app files (formats, frameworks, contract, scene-order, story-data, spine,
   script, ai, agents, locations) in node:vm with stubbed model calls (no network), plus the
   REAL handlers extracted from app.jsx and agents-ui.jsx. It proves:
     1  Agent Undo is tied to its film: a snapshot records the film, is never offered or applied
        in another film, and a film switch drops other films' snapshots;
     2  Agent Undo asks first when the film changed since the run wrote it (and says later
        changes will be lost too); unchanged, it undoes at once as before;
     3  closing a running story build asks first ("Stop building this film?"), and Story
        Editors offers "Finish writing this film" (Adaptation, ready, with the film's brief);
     4  Auto-draft all stops on a failure retrying can't fix (plan credits, sign-in, provider
        credits) — written scenes kept, the rest left undrafted (no stand-ins), one message —
        and its progress overlay has a Stop;
     5  the story build stops the same way (no retries of the rest, one clear message);
     6  an Episode build designs no psychology for the Show's existing characters before the script;
     7  moving a scene across an act boundary gives it an act its new neighbours allow;
     8  late Redraft / Recast / commit / beat-map results land only in the film they were asked for;
     9  single-line manual edits never evict the version a Redraft promised Undo would restore;
    10  overlapping agent runs never leave the writing model pinned;
    11  honest logs: story world not built, psychology passes that failed or never ran;
    12  tablet: opening one side panel closes the other;
    13  Board cards and folded act strips work from the keyboard.
   node scripts/test-round1-state.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const read = (f)=>readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,8).join("\n    ")); }
};
const noop = ()=>{};
const tick = ()=>new Promise(r=>setTimeout(r, 0));
const plain = (x)=>JSON.parse(JSON.stringify(x));

/* ---------------- sandbox: the real app files ---------------- */
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
// a tiny hooks runtime: state and refs persist across renders by call order, as React's do
const makeHooks = ()=>{
  const states = [], refs = []; let si = 0, ri = 0;
  const R = new Proxy({
    createElement:h, Fragment:"frag",
    useState:(x)=>{ const k = si++; if(!(k in states)) states[k] = typeof x==="function" ? x() : x;
      return [states[k], (v)=>{ states[k] = typeof v==="function" ? v(states[k]) : v; }]; },
    useRef:(x)=>{ const k = ri++; if(!refs[k]) refs[k] = { current:x }; return refs[k]; },
    useEffect:noop, useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f, memo:(f)=>f, forwardRef:(f)=>f,
    createContext:()=>({ Provider:"provider" }), useContext:()=>null,
  }, { get:(t,k)=> (k in t) ? t[k] : noop });
  return { R, reset:()=>{ si = 0; ri = 0; } };
};
const makeBox = ()=>{
  const box = {
    console:{ ...console, warn:noop, info:noop }, clearTimeout, setInterval, clearInterval,
    setTimeout:(f)=>setTimeout(f, 0),            // the build's retry breathers run instantly
    React:makeHooks().R, ReactDOM:new Proxy({}, { get:()=>noop }),
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
  box.__replies = []; box.__toasts = []; box.__confirms = []; box.__confirmAnswer = true;
  box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
  box.appConfirm = async (o)=>{ box.__confirms.push(o); return box.__confirmAnswer; };
  box.claude = { complete: async ()=>{ const r = box.__replies.shift(); if(r instanceof Error) throw r; return r == null ? "" : r; } };
  vm.createContext(box);
  return box;
};
const asShipped = (f)=>transformSync(read(f), { plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename:f }).code;
const loadApp = (box)=>{
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx",
    "app/spine.jsx","app/script.jsx","app/ai.jsx","app/agents.jsx","app/locations.jsx","app/series.js"])
    vm.runInContext(f==="app/script.jsx" ? asShipped(f) : read(f), box, { filename:f });
  box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
  box.appConfirm = async (o)=>{ box.__confirms.push(o); return box.__confirmAnswer; };
  return box;
};
const box = loadApp(makeBox());
const reset = ()=>{ box.__replies = []; box.__toasts = []; box.__confirms = []; box.__confirmAnswer = true; box.turnIsAdmin = false; };

const appSrc = read("app/app.jsx"), uiSrc = read("app/agents-ui.jsx"), agentsSrc = read("app/agents.jsx");
const between = (src, a, b)=>{
  const i = src.indexOf(a); assert.ok(i>=0, "marker not found: "+a);
  const j = src.indexOf(b, i + a.length); assert.ok(j>=0, "marker not found: "+b);
  return src.slice(i, j);
};
// `const <name> = …` up to the matching "\n<indent>};" (the technique the other suites use)
const fnSrc = (src, name, indent)=>{
  indent = indent || "  ";
  const start = src.indexOf("\n"+indent+"const "+name+" = ");
  assert.ok(start>=0, "found "+name);
  const end = src.indexOf("\n"+indent+"};", start);
  return src.slice(start+1, end+indent.length+3);
};
// run `body` inside a function whose parameters are env's keys; returns what `ret` names
const compile = (body, env, ret)=>{
  const names = Object.keys(env);
  return vm.runInContext("(function("+names.join(",")+"){\n"+body+"\n return { "+ret.join(", ")+" }; })", box)(...names.map(n=>env[n]));
};
vm.runInContext(between(appSrc, "function stableJson(v){", "\n/* ---- persistence"), box, { filename:"app/app.jsx#stableJson" });

/* =====================================================================================
   1 + 2. AGENT UNDO — tied to its film; asks first when the film moved on
   ===================================================================================== */
// the REAL agent ctx factory and the REAL undo block, in one "component" that re-renders
const FACTORY_SRC = between(appSrc, "  const agentLiveRef = React.useRef(null);", "  const artAgentCtxFactory = (");
const UNDO_SRC = between(appSrc, "  // restore the most recent pre-run snapshot OF THE OPEN FILM", "  // apply grade vars");
const makeFilmApp = ()=>{
  const hooks = makeHooks();
  const st = { film:"A", scenes:[], characters:[], project:{}, beats:{}, drafts:{}, continuity:{}, undo:[], selId:null };
  const projIdRef = { current:"A" };
  const agentUndoRef = { current:[] };
  const set = (k)=>(v)=>{ st[k] = typeof v==="function" ? v(st[k]) : v; };
  let app = null;
  const render = ()=>{
    hooks.reset(); projIdRef.current = st.film; agentUndoRef.current = st.undo;
    const env = { React:hooks.R, scenes:st.scenes, characters:st.characters, project:st.project, beatsMap:st.beats, drafts:st.drafts,
      continuityMap:st.continuity, currentProjectId:st.film, projIdRef, currentShowId:null,
      writersRoomReadOnlyRef:{ current:false }, artRoomReadOnlyRef:{ current:false }, characterBibleWritableRef:{ current:true },
      setScenes:set("scenes"), setCharacters:set("characters"), setProject:set("project"), setBeatsMap:set("beats"),
      setDrafts:set("drafts"), setContinuityMap:set("continuity"), setAgentUndo:set("undo"),
      setProps:noop, setPropsSeeded:noop, setVisualsSeeded:noop, setLocations:noop, cloudMode:false, renameProject:noop,
      withBeatMapIdentity:undefined, storyFacts:{}, props:[], locations:[], shots:[], _projRow:null, shareRole:"owner",
      aiAvailable:()=>true, castDraftFilmKey:()=>"film:"+projIdRef.current,
      agentUndo:st.undo, agentUndoRef, canMutateWritersRoom:()=>true, selId:st.selId, setSelId:set("selId") };
    app = compile(FACTORY_SRC+"\n"+UNDO_SRC, env, ["agentCtxFactory","undoLastAgent","agentUndoHere"]);
    return app;
  };
  // one agent run that retitles Scene 1 (a stand-in for Story Doctor's approved fix)
  const runAgent = (label, title)=>{
    const ctx = render().agentCtxFactory({ input:"", emit:noop, propose:async ()=>true, cancelled:()=>false, agentName:label });
    ctx.model.scenes = ctx.model.scenes.map((s,i)=> i===0 ? { ...s, title } : s);
    ctx.sync(); render();
  };
  const open = (film, scenes)=>{ st.film = film; st.scenes = scenes; st.drafts = {}; st.beats = {}; st.continuity = {}; st.characters = []; st.project = { title:film }; render(); };
  return { st, render, runAgent, open, get app(){ return app; } };
};
const SC = (id, title, act)=>({ id, no:Number(id.replace(/\D/g,""))||1, act:act||1, title, summary:"s", driver:"a", openCharge:1, closeCharge:-1 });

await test("1 an agent-undo snapshot records its film and is never offered or applied in another film", async ()=>{
  reset();
  const f = makeFilmApp();
  f.open("A", [SC("s1","Alpha opening"), SC("s2","Alpha close")]);
  f.runAgent("Story Doctor", "Alpha, fixed");
  assert.equal(f.st.scenes[0].title, "Alpha, fixed");
  assert.equal(f.st.undo.length, 1);
  assert.equal(f.st.undo[0].filmKey, "film:A", "the snapshot names its film");
  assert.equal(f.app.agentUndoHere.length, 1, "offered in its own film");
  // switch to film B (same scene ids — manual scenes start at s1001 in every film)
  f.open("B", [SC("s1","Bravo opening"), SC("s2","Bravo close")]);
  assert.equal(f.app.agentUndoHere.length, 0, "never offered in film B (banner + Story Editors row read this list)");
  await f.app.undoLastAgent(); f.render();
  assert.deepEqual(f.st.scenes.map(s=>s.title), ["Bravo opening","Bravo close"], "Undo in film B never writes film A's story over it");
  assert.equal(box.__confirms.length, 0);
  // the Agents panel and the floating banner read only the open film's snapshots
  assert.ok(/undoCount:agentUndoHere\.length,/.test(appSrc) && /undoLabel:agentUndoHere\.length\?agentUndoHere\[agentUndoHere\.length-1\]\.label:null,/.test(appSrc));
  assert.ok(/!writersRoomBlocked && agentUndoHere\.length>0 && agentUndoHere\[agentUndoHere\.length-1\]\.label!=="Adaptation"/.test(appSrc));
  assert.ok(!/agentUndo\.length/.test(appSrc), "no view reads the raw, all-films stack");
  // a film switch drops the other film's snapshots from the stack
  assert.ok(/React\.useEffect\(\(\)=>\{\s*const k = castDraftFilmKey\(\);\s*setAgentUndo\(st=> st\.some\(x=>!x \|\| x\.filmKey!==k\) \? st\.filter\(x=>x && x\.filmKey===k\) : st\);\s*\},\[currentProjectId\]\);/.test(appSrc),
    "the stack is filtered to the open film whenever the film changes");
});

await test("1 back in its own film, the snapshot still undoes that film exactly", async ()=>{
  reset();
  const f = makeFilmApp();
  f.open("A", [SC("s1","Alpha opening")]);
  f.runAgent("Story Doctor", "Alpha, fixed");
  const snap = f.st.undo[0];
  f.open("B", [SC("s1","Bravo")]);
  f.st.film = "A"; f.st.scenes = [{ ...SC("s1","Alpha, fixed") }]; f.render();   // reopened as it was saved
  assert.equal(f.app.agentUndoHere[0], snap);
  await f.app.undoLastAgent(); f.render();
  assert.equal(f.st.scenes[0].title, "Alpha opening");
  assert.equal(f.st.undo.length, 0);
});

await test("2 unchanged since the run: Undo restores at once, no question", async ()=>{
  reset();
  const f = makeFilmApp();
  f.open("A", [SC("s1","One"), SC("s2","Two")]);
  f.runAgent("Story Doctor", "One (fixed)");
  await f.app.undoLastAgent(); f.render();
  assert.equal(box.__confirms.length, 0, "no confirmation when nothing changed since the run");
  assert.equal(f.st.scenes[0].title, "One");
  assert.equal(f.st.undo.length, 0);
});

await test("2 changed since the run: Undo asks first, says later changes go too; No keeps everything", async ()=>{
  reset();
  const f = makeFilmApp();
  f.open("A", [SC("s1","One"), SC("s2","Two")]);
  f.runAgent("Story Doctor", "One (fixed)");
  // later work: the user edits Scene 2 (a redraft, a beat edit… any change)
  f.st.scenes = f.st.scenes.map(s=> s.id==="s2" ? { ...s, title:"Two, rewritten later" } : s); f.render();
  box.__confirmAnswer = false;
  await f.app.undoLastAgent(); f.render();
  assert.equal(box.__confirms.length, 1);
  const q = box.__confirms[0];
  assert.equal(q.title, "Undo Story Doctor’s changes?");
  assert.ok(/will be lost too/.test(q.body) && /whole film back/.test(q.body), q.body);
  assert.equal(q.confirmLabel, "Undo anyway"); assert.equal(q.cancelLabel, "Keep everything");
  assert.deepEqual(f.st.scenes.map(s=>s.title), ["One (fixed)","Two, rewritten later"], "declined: nothing changes");
  assert.equal(f.st.undo.length, 1, "…and the Undo stays available");
  box.__confirmAnswer = true;
  await f.app.undoLastAgent(); f.render();
  assert.deepEqual(f.st.scenes.map(s=>s.title), ["One","Two"], "confirmed: the film goes back to before the run");
  assert.equal(f.st.undo.length, 0);
});

await test("2 a film switch while the question is open applies nothing", async ()=>{
  reset();
  const f = makeFilmApp();
  f.open("A", [SC("s1","One")]);
  f.runAgent("Story Doctor", "One (fixed)");
  f.st.scenes = [{ ...f.st.scenes[0], summary:"edited later" }]; f.render();
  box.appConfirm = async (o)=>{ box.__confirms.push(o); f.open("B", [SC("s1","Bravo")]); return true; };
  try{ await f.app.undoLastAgent(); } finally { box.appConfirm = async (o)=>{ box.__confirms.push(o); return box.__confirmAnswer; }; }
  f.render();
  assert.equal(f.st.scenes[0].title, "Bravo", "film B is untouched");
});

/* =====================================================================================
   4. AUTO-DRAFT ALL — stops on a failure retrying can't fix; Stop in the overlay
   ===================================================================================== */
const DRAFT_ALL_SRC = fnSrc(appSrc, "draftAll") + "\n" + fnSrc(appSrc, "stopDraftAll");
const makeDraftAll = (n, replyFor)=>{
  const scenes = Array.from({ length:n }, (_,i)=>({ ...SC("s"+(i+1), "Scene "+(i+1)), no:i+1 }));
  const beats = Object.fromEntries(scenes.map(s=>[s.id, { rows:[{ n:1, drive:{ a:"a", d:"Does." }, react:{ a:"r", d:"Reacts." } }] }]));
  const st = { drafts:{}, drafting:null, calls:[] };
  const env = { canMutateWritersRoom:()=>true, draftingRef:{ current:false }, scenesInStoryOrder:(x)=>x.slice(), scenes, drafts:{},
    currentProjectId:"p1", projIdRef:{ current:"p1" }, writersRoomReadOnlyRef:{ current:false },
    setDrafting:(v)=>{ st.drafting = typeof v==="function" ? v(st.drafting) : v; }, beatsMap:beats, aiAuthorScene:null, aiAvailable:()=>true,
    characters:[], project:{ title:"T", format:"short" }, setScenes:noop, setBeatsFor:noop, rememberRejection:noop, stampDraft:(d)=>d,
    setDrafts:(f)=>{ st.drafts = typeof f==="function" ? f(st.drafts) : f; },
    aiDraftScene:async (s)=>{ st.calls.push(s.no); await tick(); return replyFor(s, st, api); } };
  const api = compile(DRAFT_ALL_SRC, env, ["draftAll","stopDraftAll"]);
  return { st, api, env, scenes };
};
const real = (s)=>({ blocks:[{ beat:1, type:"action", text:"Scene "+s.no+" written." }], ai:true, auto:false });
const standInWith = (s, failure)=>box.withScreenplayFailure(box.autoDraftScene(s, { rows:[{ n:1, drive:{ a:"a", d:"Does." }, react:{ a:"r", d:"Reacts." } }] }, null), failure);

await test("4 Auto-draft all stops at the first plan-credits failure: written kept, the rest undrafted, one message", async ()=>{
  reset();
  const d = makeDraftAll(8, (s)=> s.no<=2 ? real(s) : standInWith(s, box.screenplayFailureFromError(new Error("Choose a plan to keep writing."), "draft")));
  await d.api.draftAll();
  assert.deepEqual(d.st.calls, [1,2,3], "no model call after the failure that can't be retried");
  assert.deepEqual(Object.keys(d.st.drafts), ["s1","s2"], "the two written scenes are kept; scene 3 and the rest stay undrafted (no stand-ins)");
  assert.equal(box.__toasts.length, 1, "said once: "+JSON.stringify(box.__toasts));
  const m = box.__toasts[0].m;
  assert.equal(m, "Auto-draft all stopped at Scene 3 — your account has no plan credits left for writing, so the other scenes would fail the same way. 2 scenes were drafted and kept; 6 scenes are left undrafted (no rough stand-ins). Choose a plan or add credits, then press Auto-draft all to finish them.");
  assert.equal(box.__toasts[0].t, "error");
  assert.equal(d.env.draftingRef.current, false, "the run is over");
});

await test("4 signed out and the provider account (masked for non-admins) stop it too; a passing service error does not", async ()=>{
  reset();
  let d = makeDraftAll(4, (s)=> s.no===1 ? real(s) : standInWith(s, box.screenplayFailureFromError(new Error("Sign in to use the writing AI — it runs on your server."), "draft")));
  await d.api.draftAll();
  assert.deepEqual(d.st.calls, [1,2]);
  assert.ok(/stopped at Scene 2 — you’re signed out of the writing service/.test(box.__toasts[0].m) && /Sign in, then press Auto-draft all/.test(box.__toasts[0].m), box.__toasts[0].m);
  reset();
  d = makeDraftAll(4, (s)=> standInWith(s, box.screenplayFailureFromError(new Error("The studio's engine is briefly unavailable — please try again in a moment. (ref CM-11)"), "draft")));
  await d.api.draftAll();
  assert.deepEqual(d.st.calls, [1]);
  assert.ok(/briefly unavailable \(ref CM-11\)/.test(box.__toasts[0].m) && !/claude|anthropic|openai|provider/i.test(box.__toasts[0].m), box.__toasts[0].m);
  // a transient service error (ref CM-14) is not a stop: the run goes on and names the stand-in
  reset();
  d = makeDraftAll(3, (s)=> s.no===2 ? standInWith(s, box.screenplayFailureFromError(new Error("The studio's engine is briefly unavailable — please try again in a moment. (ref CM-14)"), "draft")) : real(s));
  await d.api.draftAll();
  assert.deepEqual(d.st.calls, [1,2,3]);
  assert.equal(Object.keys(d.st.drafts).length, 3);
  assert.equal(box.__toasts.length, 1);
  assert.ok(/^Scene 2 got a rough structural draft instead/.test(box.__toasts[0].m), box.__toasts[0].m);
});

await test("4 with no writing model from the start, Auto-draft all still writes structural drafts (unchanged)", async ()=>{
  reset();
  const d = makeDraftAll(3, (s)=> standInWith(s, { kind:"unavailable", issues:[], technical:"no writing model available" }));
  d.env.aiAvailable = ()=>false;
  const api = compile(DRAFT_ALL_SRC, d.env, ["draftAll","stopDraftAll"]);
  await api.draftAll();
  assert.deepEqual(d.st.calls, [1,2,3], "offline mode is not a stop");
});

await test("4 the drafting overlay's Stop ends the run after the scene being written (kept)", async ()=>{
  reset();
  const d = makeDraftAll(6, (s, st, api)=>{ if(s.no===2) api.stopDraftAll(); return real(s); });
  await d.api.draftAll();
  assert.deepEqual(d.st.calls, [1,2]);
  assert.deepEqual(Object.keys(d.st.drafts), ["s1","s2"], "the scene in flight when Stop was pressed is kept");
  assert.equal(box.__toasts.length, 1);
  assert.equal(box.__toasts[0].m, "Auto-draft all stopped — 2 scenes were drafted and kept. 4 scenes are still undrafted — press Auto-draft all to continue.");
  // the overlay wiring: a Stop button on the batch overlay only (not on a single Draft with MUSE)
  assert.ok(/\.\.\.\(drafting\.one \? \{\} : \{ onStop:stopDraftAll, stopping:!!drafting\.stopping \}\)/.test(appSrc));
  assert.ok(/function StudioProgressOverlay\(\{ title, detail, progress, role, onStop, stopping \}\)/.test(appSrc));
  const ov = vm.runInContext("("+between(appSrc, "function StudioProgressOverlay(", "\n/* ---- alternate view: Turn Audit table")+")", box);
  const walkFind = (n, f, out=[])=>{ if(!n || typeof n!=="object") return out; if(f(n)) out.push(n); (n.children||[]).forEach(c=>walkFind(c, f, out)); return out; };
  let clicked = 0;
  const btn = walkFind(ov({ title:"Drafting the screenplay", detail:"x", progress:10, role:"Screenwriter", onStop:()=>clicked++, stopping:false }), n=>n.type==="button")[0];
  assert.ok(btn && btn.children.join("")==="Stop"); btn.props.onClick(); assert.equal(clicked, 1);
  const busy = walkFind(ov({ title:"t", onStop:noop, stopping:true }), n=>n.type==="button")[0];
  assert.ok(busy.props.disabled && busy.children.join("")==="Stopping…");
  assert.equal(walkFind(ov({ title:"t" }), n=>n.type==="button").length, 0, "no Stop where there is nothing to stop");
});

/* =====================================================================================
   5. THE STORY BUILD — stops on a failure retrying can't fix
   ===================================================================================== */
const W = (no, id)=>({ id, no, title:id.toUpperCase(), loc:"INT. ROOM - DAY", summary:"s", driver:"a" });
const buildRun = async (n, draftFor, opts)=>{
  const bm = { rows:[{ n:1, drive:{ a:"a", d:"Does." }, react:{ a:"r", d:"Reacts." } }] };
  const scenes = Array.from({ length:n }, (_,i)=>W(i+1, "sc"+(i+1)));
  const model = { scenes, beats:Object.fromEntries(scenes.map(s=>[s.id, bm])), drafts:{}, characters:[], project:{} };
  const trace = [], calls = [];
  const ctx = { model, emit:(e)=>trace.push(e), cancelled:()=>false, sync:noop, switchedFilms:()=>false,
    ai:{ available:(opts && "available" in opts) ? opts.available : true, authorScene:async ()=>null,
      draftScene:async (s)=>{ calls.push(s.no); return draftFor(s, bm); } } };
  const r = await box.writeScenesSeq(ctx, scenes.map((_,i)=>i));
  return { r, trace, calls, model };
};
const planFail = ()=>box.screenplayFailureFromError(new Error("Choose a plan to keep writing."), "draft");

await test("5 the build stops at the first plan-credits failure: no retries of the rest, one clear message", async ()=>{
  reset();
  const b = await buildRun(5, (s, bm)=> s.no===1 ? real(s) : box.withScreenplayFailure(box.autoDraftScene(s, bm, null), planFail()));
  assert.deepEqual(b.calls, [1,2], "one try at Sc 2, nothing after it (it used to be 2 tries + a retry round for every scene)");
  assert.equal(b.r.stopped, true); assert.equal(b.r.halted.kind, "plan");
  assert.equal(b.r.written, 1);
  assert.ok(b.model.drafts.sc1.ai && box.isStandInDraft(b.model.drafts.sc2), "Sc 1 kept; Sc 2 keeps its rough stand-in");
  assert.ok(!b.model.drafts.sc3 && !b.model.drafts.sc4 && !b.model.drafts.sc5, "the rest are NOT turned into stand-ins");
  assert.ok(!b.trace.some(e=>/Retrying|trying again|retrying/.test(e.t)), "no retry round");
  const flags = b.trace.filter(e=>e.k==="flag");
  assert.equal(flags.length, 1, JSON.stringify(flags));
  assert.equal(flags[0].t, "Stopped at Sc 2 “SC2”: your account has no plan credits left for writing, and every remaining scene would fail the same way. 1 of 5 scenes is written and kept; 4 aren’t written yet (Sc 2 has a rough stand-in). Choose a plan or add credits, then finish just the unwritten scenes: press Run again, or later open Story Editors and choose Finish writing this film.");
  // the finish path picks up exactly those scenes later (stand-in + blank)
  assert.deepEqual(b.model.scenes.map((s,i)=>i).filter(i=>{ const d = b.model.drafts[b.model.scenes[i].id]; return !(d && (d.blocks||[]).length) || box.isStandInDraft(d); }), [1,2,3,4]);
});

await test("5 a format rejection still gets its retries; only unfixable kinds stop the build", async ()=>{
  reset();
  const b = await buildRun(2, (s, bm)=> s.no===1 ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), { kind:"invalid", issues:["cue without dialogue"], details:[] }) : real(s));
  assert.equal(b.r.stopped, false);
  assert.deepEqual(b.calls, [1,1,2,1], "Sc 1: two tries, then the retry round");
  // signed out halts in the retry round too (the run started with a model)
  reset();
  let n = 0;
  const c = await buildRun(2, (s, bm)=>{ n++; return n<=2 && s.no===1 ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), { kind:"service", issues:[] })
    : s.no===2 ? real(s) : box.withScreenplayFailure(box.autoDraftScene(s, bm, null), box.screenplayFailureFromError(new Error("Sign in to use the writing AI"), "draft")); });
  assert.equal(c.r.stopped, true); assert.equal(c.r.halted.kind, "signin");
  assert.ok(c.trace.some(e=>e.k==="flag" && /^Stopped at Sc 1 .*you’re signed out of the writing service/.test(e.t) && /Sign in, then finish just the unwritten scenes/.test(e.t)), JSON.stringify(c.trace.filter(e=>e.k==="flag")));
  // with no model at all the rough draft IS the product (unchanged): no stop
  reset();
  const off = await buildRun(2, (s, bm)=> box.withScreenplayFailure(box.autoDraftScene(s, bm, null), { kind:"unavailable", issues:[] }), { available:false });
  assert.equal(off.r.stopped, false); assert.deepEqual(off.calls, [1,2]);
});

await test("5 the provider account: admins are told to top it up, everyone else gets the masked reference", async ()=>{
  reset(); box.turnIsAdmin = true;
  const cr = ()=>box.screenplayFailureFromError(new Error("Writing model: Your credit balance is too low to access the API."), "draft");
  const a = await buildRun(3, (s, bm)=> box.withScreenplayFailure(box.autoDraftScene(s, bm, null), cr()));
  const fa = a.trace.filter(e=>e.k==="flag")[0].t;
  assert.ok(/provider’s account is out of credits/.test(fa) && /Top up the provider account, then finish/.test(fa), fa);
  reset();
  const u = await buildRun(3, (s, bm)=> box.withScreenplayFailure(box.autoDraftScene(s, bm, null), box.screenplayFailureFromError(new Error("The studio's engine is briefly unavailable — please try again in a moment. (ref CM-11)"), "draft")));
  const fu = u.trace.filter(e=>e.k==="flag")[0].t;
  assert.ok(/briefly unavailable \(ref CM-11\)/.test(fu) && /quote ref CM-11 to support/.test(fu) && !/provider|claude|anthropic/i.test(fu), fu);
});

const svc = (ref)=>box.screenplayFailureFromError(new Error("The studio's engine is briefly unavailable — please try again in a moment. (ref "+ref+")"), "draft");
await test("5 (review) the provider's key rejected (ref CM-12) stops the build at once — every call would fail the same way", async ()=>{
  reset();
  assert.equal(box.turnFailureNeedsAction(svc("CM-12")), true);
  for(const r of ["CM-13","CM-14",""]) assert.equal(box.turnFailureNeedsAction({ kind:"service", ref:r }), false, "a passing blip is not a stop: "+r);
  const b = await buildRun(5, (s, bm)=> s.no===1 ? real(s) : box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-12")));
  assert.deepEqual(b.calls, [1,2], "no second try, no retry round");
  assert.equal(b.r.stopped, true); assert.equal(b.r.halted.ref, "CM-12");
  const flags = b.trace.filter(e=>e.k==="flag");
  assert.equal(flags.length, 1);
  assert.ok(/^Stopped at Sc 2 “SC2”: the writing service is briefly unavailable \(ref CM-12\), and every remaining scene would fail the same way\. 1 of 5 scenes is written and kept; 4 aren’t written yet \(Sc 2 has a rough stand-in\)\. Wait a little \(if it keeps failing, quote ref CM-12 to support\), then finish just the unwritten scenes/.test(flags[0].t), flags[0].t);
  // an admin's raw provider text is read for the same reference
  box.turnIsAdmin = true;
  assert.equal(box.screenplayFailureFromError(new Error("Anthropic is not configured on the server. An administrator can add it in TURN's API Keys modal"), "draft").ref, "CM-12");
  box.turnIsAdmin = false;
});
await test("5 (review) the same service failure on two scenes in a row stops the build; one blip, or two different ones, does not", async ()=>{
  reset();
  // Sc 2 and Sc 3 both fail with CM-14 (each after its two tries): the build stops at Sc 3
  const b = await buildRun(6, (s, bm)=> (s.no===2 || s.no===3) ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-14")) : real(s));
  assert.deepEqual(b.calls, [1,2,2,3,3], "two tries each, then the stop — no Sc 4-6, no retry round");
  assert.equal(b.r.stopped, true); assert.equal(b.r.halted.ref, "CM-14");
  assert.ok(b.model.drafts.sc1.ai && box.isStandInDraft(b.model.drafts.sc2) && box.isStandInDraft(b.model.drafts.sc3));
  assert.ok(!b.model.drafts.sc4 && !b.model.drafts.sc5 && !b.model.drafts.sc6, "the rest are left for the finish run");
  const flags = b.trace.filter(e=>e.k==="flag");
  assert.equal(flags.length, 1, JSON.stringify(flags));
  assert.ok(flags[0].t.startsWith("Stopped at Sc 3 “SC3”: the writing service is briefly unavailable (ref CM-14), for the second scene in a row, so the remaining scenes would most likely fail the same way. 1 of 6 scenes is written and kept; 5 aren’t written yet (Sc 3 has a rough stand-in). Wait a little (if it keeps failing, quote ref CM-14 to support), then finish just the unwritten scenes"), flags[0].t);
  // one blip in between good scenes: no stop (the retry round still runs)
  reset();
  const one = await buildRun(3, (s, bm)=> s.no===2 ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-14")) : real(s));
  assert.equal(one.r.stopped, false); assert.deepEqual(one.calls, [1,2,2,3,2]);
  // two scenes in a row, different references: no stop
  reset();
  const diff = await buildRun(3, (s, bm)=> s.no===1 ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-13"))
    : s.no===2 ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-14")) : real(s));
  assert.equal(diff.r.stopped, false);
  // a good scene between two same failures resets the count
  reset();
  const apart = await buildRun(4, (s, bm)=> (s.no===1 || s.no===3) ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-14")) : real(s));
  assert.equal(apart.r.stopped, false, "not in a row");
  // …but the automatic retries run right after the main pass: when the last scene failed and the
  // first retry fails the same way (with more retries still to go), the round stops there
  reset();
  const rr = await buildRun(5, (s, bm)=> (s.no%2===1) ? box.withScreenplayFailure(box.autoDraftScene(s, bm, null), svc("CM-14")) : real(s));
  assert.deepEqual(rr.calls, [1,1,2,3,3,4,5,5, 1], "Sc 5 failed, then the retry of Sc 1 failed the same way: Sc 3 and Sc 5 aren't retried");
  assert.equal(rr.r.stopped, true);
  assert.ok(rr.trace.some(e=>e.k==="flag" && /^Stopped at Sc 1 .*for the second scene in a row/.test(e.t)));
});
await test("4 (review) Auto-draft all: the same service failure twice in a row stops it; the first keeps its stand-in, the rest stay undrafted", async ()=>{
  reset();
  const d = makeDraftAll(6, (s)=> (s.no===2 || s.no===3) ? standInWith(s, svc("CM-14")) : real(s));
  await d.api.draftAll();
  assert.deepEqual(d.st.calls, [1,2,3], "no call after the second failure in a row");
  assert.deepEqual(Object.keys(d.st.drafts), ["s1","s2"], "Scene 2 keeps its stand-in; Scene 3 and the rest stay undrafted");
  const stop = box.__toasts.find(t=>/^Auto-draft all stopped at Scene 3/.test(t.m));
  assert.ok(stop, JSON.stringify(box.__toasts));
  assert.ok(stop.m.includes("the writing service is briefly unavailable (ref CM-14), for the second scene in a row, so the other scenes would most likely fail the same way. 2 scenes were drafted and kept; 4 scenes are left undrafted (no rough stand-ins)."), stop.m);
  // CM-12 stops it at the first
  reset();
  const k = makeDraftAll(4, (s)=> s.no===2 ? standInWith(s, svc("CM-12")) : real(s));
  await k.api.draftAll();
  assert.deepEqual(k.st.calls, [1,2]); assert.deepEqual(Object.keys(k.st.drafts), ["s1"]);
  // a single blip still goes on (unchanged)
  reset();
  const one = makeDraftAll(4, (s)=> s.no===2 ? standInWith(s, svc("CM-14")) : real(s));
  await one.api.draftAll();
  assert.deepEqual(one.st.calls, [1,2,3,4]);
});

/* =====================================================================================
   6 + 11. THE BUILD'S PSYCHOLOGY PASSES AND STORY WORLD — canon untouched, honest logs
   ===================================================================================== */
const adaptBuild = async (opts)=>{
  const calls = [];
  const cast0 = (opts.cast || []).map(c=>({ ...c }));
  const model = { scenes:[], beats:{}, drafts:{}, continuity:{}, characters:cast0, project:{ title:"Show E2", format:"film" } };
  const trace = [];
  const canonIds = new Set(opts.canon || []);
  const prevPsych = box.aiCastPsychology, prevSpine = box.aiBuildSpine;
  box.aiCastPsychology = async (chars, scenes, P, o)=>{ calls.push({ mode:(o&&o.mode)||"full", ids:chars.map(c=>c.id) });
    return opts.psych ? opts.psych(chars, o) : null; };
  const ctx = { input:"A night cook inherits a diner.", project:model.project, model, emit:(e)=>trace.push(e),
    propose:async ()=>true, cancelled:()=>false, switchedFilms:()=>false,
    sync:()=>{ if(opts.onSync) opts.onSync(model); },
    castCanon:(c)=> canonIds.has(c.id),
    ai:{ available:true,
      buildSpine:async ()=>({ title:"Night Shift", scenes:[
        { act:1, title:"Open", loc:"INT. DINER - NIGHT", summary:"s", driver:"mara", openValue:"calm", openCharge:1, closeValue:"alarm", closeCharge:-1 },
        { act:2, title:"Push", loc:"INT. DINER - NIGHT", summary:"s", driver:"tomas", openValue:"calm", openCharge:1, closeValue:"alarm", closeCharge:-1 }] }),
      buildStoryWorld:async ()=> opts.world===null ? null : { genre:"drama", premise:"p", controllingIdea:{ value:"v" }, setting:{},
        cast:[{ id:"mara", name:"Mara Quinn", role:"Protagonist" }, { id:"tomas", name:"Tomas Iturbe", role:"Supporting" }] },
      authorScene:async (s)=>({ patch:{}, beats:{ rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] } }),
      draftScene:async (s)=>real(s),
      continuityLedger:async ()=>({ map:{}, facts:{}, ledger:{} }) } };
  try{ await box.agentAdaptation(ctx); }
  finally { box.aiCastPsychology = prevPsych; box.aiBuildSpine = prevSpine; }
  return { trace, calls, model };
};

await test("6 the pass before the script designs only the characters this build introduced", async ()=>{
  reset();
  // the world build names Mara (new) and Tomas; the ctx marks "tomas" as Show canon
  const r = await adaptBuild({ canon:["tomas"], psych:(chars, o)=>Object.fromEntries(chars.map(c=>[c.id, { conscious:(o&&o.mode||"full")+" want "+c.id }])) });
  const before = r.calls.find(c=>c.mode==="before");
  assert.ok(before, JSON.stringify(r.calls));
  assert.deepEqual(before.ids, ["mara"], "Show canon is not sent to the design pass (and costs nothing)");
  const tomas = r.model.characters.find(c=>c.id==="tomas");
  assert.ok(!/before want/.test(String(tomas.conscious||"")), "no field of a canon character is filled before the script: "+JSON.stringify(tomas));
  assert.equal(r.model.characters.find(c=>c.id==="mara").conscious.startsWith("before want") || r.model.characters.find(c=>c.id==="mara").conscious.startsWith("reconcile"), true);
  // sensitivity: the build as it shipped before this round sent Tomas too
  const head = execSync("git show HEAD:app/agents.jsx", { encoding:"utf8" });
  assert.ok(/const psych = await window\.aiCastPsychology\(ctx\.model\.characters, ctx\.model\.scenes, ctx\.model\.project, \{\s*scenes:ctx\.model\.scenes, drafts:\{\}, cast:ctx\.model\.characters, mode:"before"/.test(head),
    "HEAD designed every character before the script");
  assert.ok(/const psych = await window\.aiCastPsychology\(designFor, ctx\.model\.scenes/.test(agentsSrc));
});

await test("11 the story world not coming back is said, once, in plain words", async ()=>{
  reset();
  const r = await adaptBuild({ world:null, psych:()=>null });
  const f = r.trace.filter(e=>e.k==="flag" && /story world/.test(e.t));
  assert.equal(f.length, 1);
  assert.equal(f[0].t, "Couldn't build the story world this time, so this film has no new premise, controlling idea or setting, and the cast has names but no identities or voices. The build carries on with the scenes; fill those in afterwards in the Story panel on the left.");
  const ok = await adaptBuild({ psych:()=>null });
  assert.ok(!ok.trace.some(e=>/story world this time/.test(e.t)), "no flag when it was built");
});

await test("11 psychology: a failed pass is said; a check that never ran is never 'the script bears out every character'", async ()=>{
  reset();
  // both passes return nothing: the before pass is flagged, and the full-design check too
  let r = await adaptBuild({ psych:()=>null });
  let flags = r.trace.filter(e=>e.k==="flag").map(e=>e.t);
  assert.ok(flags.includes("Couldn't design the cast's inner life before writing this time; the scenes are written without it, and the check after the script tries again."), JSON.stringify(flags));
  assert.ok(flags.includes("Couldn't design the cast's inner life this time, so the characters have no want, need or arc yet. Open each one in the Cast panel and press Draft with MUSE to fill it in."), JSON.stringify(flags));
  assert.ok(!r.trace.some(e=>/bears out every character/.test(e.t)));
  // designed before, the check returns nothing and REPORTS a failure: flagged, named
  const reported = (failedIds)=>(chars, o)=>{ if(o && o.mode==="reconcile"){ if(o.report) o.report.failedIds = failedIds; return null; }
    return Object.fromEntries(chars.map(c=>[c.id, { conscious:"want "+c.id }])); };
  r = await adaptBuild({ psych:reported(["mara","tomas"]) });
  flags = r.trace.filter(e=>e.k==="flag").map(e=>e.t);
  assert.ok(flags.includes("Couldn't check Mara Quinn, Tomas Iturbe against the script this time — the psychology designed before the script stands. To revisit a character, open it in the Cast panel and press Draft with MUSE."), JSON.stringify(flags));
  assert.ok(!r.trace.some(e=>/bears out every character/.test(e.t)));
  // it ran and found nothing to revise: the success line stands
  r = await adaptBuild({ psych:reported([]) });
  assert.ok(r.trace.some(e=>e.k==="ok" && e.t==="Psychology checked — the script bears out every character."));
  // a writer that can't tell (no report) claims neither
  r = await adaptBuild({ psych:(chars, o)=> o && o.mode==="reconcile" ? null : Object.fromEntries(chars.map(c=>[c.id, { conscious:"want "+c.id }])) });
  assert.ok(r.trace.some(e=>e.k==="observe" && e.t==="Psychology check: no revisions came back for the cast."));
  assert.ok(!r.trace.some(e=>/bears out every character/.test(e.t)));
  // a thrown check is said too (it used to be swallowed)
  r = await adaptBuild({ psych:(chars, o)=>{ if(o && o.mode==="reconcile") throw new Error("boom"); return Object.fromEntries(chars.map(c=>[c.id, { conscious:"want "+c.id }])); } });
  assert.ok(r.trace.some(e=>e.k==="flag" && /^Couldn't check the cast's psychology against the script this time \(boom\)/.test(e.t)));
});

await test("11 in an Episode, 'designed' is judged on the build's own people (canon always has a want)", async ()=>{
  reset();
  const r = await adaptBuild({ canon:["tomas"], cast:[], psych:(chars, o)=> o && o.mode==="before" ? null : Object.fromEntries(chars.map(c=>[c.id, { conscious:"full "+c.id }])),
    onSync:(m)=>{ m.characters = m.characters.map(c=> c.id==="tomas" && !c.conscious ? { ...c, conscious:"Show canon want" } : c); } });
  const check = r.calls.filter(c=>c.mode!=="before").pop();
  assert.equal(check.mode, "full", "the new people are fully designed, not sent through reconcile (which returns only revisions)");
});

/* =====================================================================================
   7. MOVING A SCENE ACROSS AN ACT BOUNDARY
   ===================================================================================== */
const makeReorder = (acts)=>{
  const st = { scenes:acts.map((a,i)=>({ id:"x"+i, no:i+1, act:a, title:"T"+i })) };
  const env = { canMutateWritersRoom:()=>true, setScenes:(f)=>{ st.scenes = typeof f==="function" ? f(st.scenes) : f; },
    renum:(arr)=>arr.map((s,i)=>({ ...s, no:i+1 })), get scenes(){ return st.scenes; } };
  const api = compile(fnSrc(appSrc, "reorderScenes"), env, ["reorderScenes"]);
  return { st, api };
};
const actsOf = (st)=>st.scenes.map(s=>s.act);
const nonDecreasing = (a)=>a.every((x,i)=>!i || a[i-1]<=x);
await test("7 a moved scene takes an act its new neighbours allow; acts stay in story order; nobody else's act moves", async ()=>{
  // Inspector "Down" on the last Act I scene: it now sits among Act II
  let r = makeReorder([1,1,2,2]); r.api.reorderScenes(1,2);
  assert.deepEqual(actsOf(r.st), [1,2,2,2]); assert.equal(r.st.scenes[2].id, "x1");
  // "Up" on the first Act II scene
  r = makeReorder([1,1,2,2]); r.api.reorderScenes(2,1);
  assert.deepEqual(actsOf(r.st), [1,1,1,2]); assert.equal(r.st.scenes[1].id, "x2");
  // dragging an Act III scene to the Act I/II boundary: the nearer act (II)
  r = makeReorder([1,1,2,2,3,3]); r.api.reorderScenes(5,2);
  assert.deepEqual(actsOf(r.st), [1,1,2,2,2,3]);
  // dragging Act I's opener to the end: the last act
  r = makeReorder([1,1,2,3]); r.api.reorderScenes(0,3);
  assert.deepEqual(actsOf(r.st), [1,2,3,3]);
  // dragging the finale to the front: the first act
  r = makeReorder([1,2,2,3]); r.api.reorderScenes(3,0);
  assert.deepEqual(actsOf(r.st), [1,1,2,2]);
  // a move that stays inside its act — or sits right on a boundary it fits — keeps its act
  r = makeReorder([1,1,2,2]); r.api.reorderScenes(3,2);
  assert.deepEqual(actsOf(r.st), [1,1,2,2]);
  r = makeReorder([1,1,2,2]); r.api.reorderScenes(0,1);
  assert.deepEqual(actsOf(r.st), [1,1,2,2]);
  // Kishōtenketsu's four movements
  r = makeReorder([1,2,3,3,4]); r.api.reorderScenes(4,1);
  assert.deepEqual(actsOf(r.st), [1,2,2,3,3]);
  // every one of those stays in order; numbers follow position
  for(const [acts, from, to] of [[[1,1,2,2,3,3],0,5],[[1,2,3],2,0],[[1,1,1,2,2,3,3],6,1],[[1,2,2,2,3],1,4]]){
    const x = makeReorder(acts); x.api.reorderScenes(from, to);
    assert.ok(nonDecreasing(actsOf(x.st)), acts+" "+from+"→"+to+": "+actsOf(x.st));
    assert.deepEqual(x.st.scenes.map(s=>s.no), acts.map((_,i)=>i+1));
    const unmoved = x.st.scenes.filter(s=>s.id!=="x"+from);
    unmoved.forEach(s=>assert.equal(s.act, acts[Number(s.id.slice(1))], "unmoved "+s.id+" keeps its act"));
  }
});

await test("7 (review) a move into another act that changes the arc stage says so — still marked (psychology is on the owner's list)", async ()=>{
  const cast = [{ id:"mara", name:"Mara Vey", conscious:"to keep the shop", unconscious:"to be forgiven", arcStages:{ 1:"hides", 2:"cracks", 3:"chooses" } },
    { id:"ivo", name:"Ivo Tanaka", conscious:"to collect", unconscious:"to be wanted", arcStages:{ 1:"circles", 2:"strikes" } }];
  const beats = { driverLabel:"MARA VEY", reactorLabel:"IVO", rows:[] };
  const card = { id:"s4", no:4, act:1, title:"The Offer", loc:"INT. SHOP - DAY", summary:"Mara refuses.", objective:"to refuse", driver:"mara",
    openValue:"Trust", openCharge:1, closeValue:"Doubt", closeCharge:-1 };
  const was = box.sceneCardSnap(card, cast, beats);
  assert.equal(was.act, 1, "the snapshot remembers the act its psychology was read for");
  // Inspector Down on the last Act I scene: reorderScenes gives it act 2
  assert.deepEqual(plain(box.cardChanges(was, box.sceneCardSnap({ ...card, act:2 }, cast, beats))),
    ["the driver's arc stage (the scene moved to Act II)", "the reactor's arc stage (the scene moved to Act II)"]);
  // moved AND the character edited: the edit is named as before
  const edited = cast.map(c=>c.id==="mara" ? { ...c, conscious:"to sell the shop" } : c);
  assert.deepEqual(plain(box.cardChanges(was, box.sceneCardSnap({ ...card, act:2 }, edited, beats))),
    ["the driver's psychology", "the reactor's arc stage (the scene moved to Act II)"]);
  // not moved: an arc-stage edit still reads "psychology" (unchanged)
  const staged = cast.map(c=>c.id==="mara" ? { ...c, arcStages:{ ...c.arcStages, 1:"lies" } } : c);
  assert.deepEqual(plain(box.cardChanges(was, box.sceneCardSnap(card, staged, beats))), ["the driver's psychology"]);
  // a move where the arc stage is the same in both acts marks nothing (no new trigger: the act itself isn't one)
  const flat = cast.map(c=>({ ...c, arcStages:{ 1:"steady", 2:"steady" } }));
  assert.deepEqual(plain(box.cardChanges(box.sceneCardSnap(card, flat, beats), box.sceneCardSnap({ ...card, act:2 }, flat, beats))), []);
  // a draft snapshot from before this change (no act) still works, with the old label
  const legacy = { ...was }; delete legacy.act;
  assert.deepEqual(plain(box.cardChanges(legacy, box.sceneCardSnap({ ...card, act:2 }, cast, beats))), ["the driver's psychology", "the reactor's psychology"]);
  const labels = vm.runInContext("CARD_CHANGE_LABELS", box).map(([k])=>k);
  assert.ok(labels.length>10 && !labels.includes("act"), "the act is not a trigger of its own");
});

/* =====================================================================================
   8. LATE RESULTS LAND ONLY IN THE FILM THEY WERE ASKED FOR
   ===================================================================================== */
const makeWriters = (over)=>{
  const st = { film:"A", drafts:{ s1:{ blocks:[{ beat:1, type:"action", text:"A's current draft." }], ai:true } }, history:{}, beats:{}, scenes:[], toasts:[] };
  const key = ()=>"film:"+st.film;
  box.turnFilmToken = key; box.turnSameFilm = (t)=>t===key();
  const env = { canMutateWritersRoom:()=>true, castDraftFilmKey:key, HISTORY_MAX:12,
    get drafts(){ return st.drafts; }, get history(){ return st.history; },
    setDrafts:(f)=>{ st.drafts = typeof f==="function" ? f(st.drafts) : f; }, setHistory:(f)=>{ st.history = typeof f==="function" ? f(st.history) : f; },
    setBeatsMap:(f)=>{ st.beats = typeof f==="function" ? f(st.beats) : f; }, withBeatIdentity:undefined,
    setPolishBusy:noop, scenesInStoryOrder:(x)=>x.slice(), scenes:[SC("s1","One")], autoDraftScene:box.autoDraftScene,
    aiPolishScene:async ()=>{ st.film = "B"; return { blocks:[{ beat:1, type:"action", text:"A's redraft." }], ai:true, polished:true }; },
    project:{ title:"T", format:"short" }, currentProjectId:"A", polishRetryRef:{ current:{} }, lastPolishFailureRef:{ current:null },
    stampDraft:(d)=>d, ...(over||{}) };
  const build = ()=>{ const names = Object.keys(env).filter(n=>n!=="drafts" && n!=="history").concat(["drafts","history"]);
    const body = ["commitVersion","setBeatsFor","rememberRejection","polishScene"].map(n=>fnSrc(appSrc, n)).join("\n");
    return vm.runInContext("(function("+names.join(",")+"){\n"+body+"\n return { commitVersion, setBeatsFor, polishScene }; })", box)(...names.map(n=>env[n])); };
  return { st, build, key };
};
await test("8 commitVersion / setBeatsFor drop a result whose film token is stale; a Redraft that returns after a switch is not applied", async ()=>{
  reset();
  const w = makeWriters();
  const tokA = w.key();
  w.st.film = "B"; w.st.drafts = { s1:{ blocks:[{ beat:1, type:"action", text:"B's own draft." }], ai:true } };
  assert.equal(w.build().commitVersion("s1", { blocks:[], ai:true }, tokA), false, "film A's late result is refused in film B");
  assert.equal(w.st.drafts.s1.blocks[0].text, "B's own draft.");
  assert.deepEqual(w.st.history, {}, "…and nothing is pushed into film B's history");
  w.build().setBeatsFor("s1", { rows:[{ n:1 }] }, tokA);
  assert.deepEqual(w.st.beats, {}, "a late beat map for film A never lands in film B");
  // same film: works as before (with or without a token)
  assert.equal(w.build().commitVersion("s1", { blocks:[{ beat:1, type:"action", text:"B edit." }], edited:true }, w.key()), true);
  w.build().setBeatsFor("s1", { rows:[{ n:1 }] }, w.key());
  assert.ok(w.st.beats.s1);
  // a Redraft whose reply arrives after the switch
  reset();
  const r = makeWriters();
  const ok = await r.build().polishScene(SC("s1","One"), { rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] });
  assert.equal(ok, false);
  assert.equal(r.st.drafts.s1.blocks[0].text, "A's current draft.", "nothing replaced");
  assert.deepEqual(box.__toasts.map(t=>t.m), ["You switched films while Scene 1 was being redrafted, so the new draft was not applied. Reopen that film and redraft it there."]);
  // the app's wiring: the token globals, and polishScene passes its token on
  assert.ok(/window\.turnFilmToken = castDraftFilmKey;\s*window\.turnSameFilm = \(tok\)=> tok===castDraftFilmKey\(\);/.test(appSrc));
  assert.ok(/return commitVersion\(s\.id, stampDraft\(res, s, beatsForScene\), filmTok\);/.test(appSrc));
});

await test("8 a driver Recast that returns after a film switch changes nothing", async ()=>{
  reset();
  const projIdRef = { current:"A" };
  const calls = { update:0, beats:0 };
  const scene = { ...SC("s1","One"), driver:"a" };
  const env = { canMutateWritersRoom:()=>true, currentProjectId:"A", projIdRef, scenes:[scene],
    beatsMap:{ s1:{ rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] } }, characters:[{ id:"a", name:"Ann" }, { id:"b", name:"Bo" }],
    aiAvailable:()=>true, project:{}, setRecastBusy:noop, updateScene:()=>calls.update++, setBeatsMap:()=>calls.beats++ };
  box.aiRecastDriver = async ()=>{ projIdRef.current = "B"; return { summary:"Bo drives.", rows:[{ n:1 }] }; };
  const api = compile(fnSrc(appSrc, "_offerDriverRecast"), env, ["_offerDriverRecast"]);
  await api._offerDriverRecast("s1", "a", "b");
  assert.deepEqual(calls, { update:0, beats:0 });
  delete box.aiRecastDriver;
});

/* =====================================================================================
   9. VERSION HISTORY — the cap never eats the version Undo was promised
   ===================================================================================== */
await test("9 twelve-plus line edits after a Redraft keep the pre-redraft draft (and the redraft) reachable by Undo", async ()=>{
  reset();
  const w = makeWriters();
  const P = { blocks:[{ beat:1, type:"action", text:"Paid-for draft." }], ai:true, by:{ model:"m" } };
  w.st.drafts = { s1:P };
  const R = { blocks:[{ beat:1, type:"action", text:"Redraft." }], ai:true, polished:true };
  w.build().commitVersion("s1", R);
  for(let k=1;k<=15;k++) w.build().commitVersion("s1", { blocks:[{ beat:1, type:"action", text:"Edit "+k }], edited:true, ai:false });
  const back = w.st.history.s1.back;
  assert.equal(back.length, 12, "the cap still holds");
  assert.ok(back.includes(P), "the pre-redraft draft is still in history");
  assert.ok(back.includes(R), "…and so is the redraft");
  assert.equal(back[back.length-1].blocks[0].text, "Edit 14", "the latest steps are kept for Undo");
  // the dropped entries were in-between manual steps only
  assert.ok(back.slice(back.indexOf(R)+1).every(v=>v.edited));
  // sensitivity: the old rule (oldest out) would have dropped both
  const old = [P, R, ...Array.from({ length:14 }, (_,k)=>({ edited:true, k }))].slice(-12);
  assert.ok(!old.includes(P) && !old.includes(R));
  // AI versions alone still age out oldest-first (the storage cap is unchanged)
  const w2 = makeWriters(); w2.st.drafts = { s1:{ blocks:[], ai:true, n:0 } };
  for(let k=1;k<=14;k++) w2.build().commitVersion("s1", { blocks:[], ai:true, polished:true, n:k });
  assert.deepEqual(plain(w2.st.history.s1.back.map(v=>v.n)), [2,3,4,5,6,7,8,9,10,11,12,13]);
});

/* =====================================================================================
   10. THE WRITING-MODEL PIN — no stale pin after overlapping runs
   ===================================================================================== */
await test("10 overlapping runs: the newest live run's model is pinned; when none is live, the Writing dock decides", async ()=>{
  reset();
  const startSrc = fnSrc(uiSrc, "start");
  const gates = {};
  const mkStart = (mid, id)=>{
    const env = { runIdRef:{ current:0 }, cancelled:{ current:false }, setTrace:noop, setPending:noop, setStatus:noop,
      agentReportProjectId:()=>"p", _mid:mid, agent:{ id:"doctor", kind:"fix", run:()=>new Promise(r=>{ gates[id] = r; }) },
      ctxFactory:()=>({ switchedFilms:()=>false }), inputRef:{ current:"" }, force:false, resolver:{ current:null }, saveAgentReport:noop };
    return compile(startSrc, env, ["start"]).start;
  };
  box.__forceWritingModel = undefined; box.__turnWritingPins = [];
  const p1 = mkStart("model-one", 1)();
  assert.equal(box.__forceWritingModel, "model-one");
  const p2 = mkStart("model-two", 2)();              // "Run again" while run 1 is still winding down
  assert.equal(box.__forceWritingModel, "model-two");
  gates[1](); await p1;                               // the stopped run ends first
  assert.equal(box.__forceWritingModel, "model-two", "the live run keeps its pin");
  gates[2](); await p2;
  assert.equal(box.__forceWritingModel, undefined, "no run live: no pin (it used to stay on model-two for the session)");
  // the other order
  const q1 = mkStart("model-one", 3)(), q2 = mkStart("model-two", 4)();
  gates[4](); await q2;
  assert.equal(box.__forceWritingModel, "model-one", "run 1 is still live, so its pin is back");
  gates[3](); await q1;
  assert.equal(box.__forceWritingModel, undefined);
  assert.ok(!/prevForce/.test(uiSrc), "no captured-and-restored pin left");
});

/* =====================================================================================
   3. CLOSING A RUNNING BUILD, AND "FINISH WRITING THIS FILM"
   ===================================================================================== */
vm.runInContext(asShipped("app/agents-ui.jsx"), box, { filename:"app/agents-ui.jsx" });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n) : (!n || typeof n!=="object") ? "" : (n.children||[]).map(textOf).join("");
const mountPanel = (props)=>{
  const hooks = makeHooks(); box.React = hooks.R;
  return ()=>{ hooks.reset(); box.React = hooks.R; return box.AgentsPanel(props); };
};
await test("3 closing a RUNNING story build (X, backdrop, All agents) asks first; No keeps it building", async ()=>{
  reset();
  let closed = 0;
  const render = mountPanel({ onClose:()=>closed++, onView:noop, ctxFactory:noop, aiOn:true, undoCount:0, issues:{},
    initialAgentId:"adapt", initialInput:"A brief.", autoStart:true });
  let tree = render();
  const runner = findAll(tree, n=>n.type===box.AgentRunner)[0];
  assert.ok(runner, "the build runner is up");
  runner.props.onRunningChange(true);                 // the build is running
  const overlay = tree;
  box.__confirmAnswer = false;
  await overlay.props.onMouseDown({ target:1, currentTarget:1 });
  assert.equal(closed, 0, "a stray backdrop click no longer stops the build");
  assert.equal(box.__confirms.length, 1);
  const q = box.__confirms[0];
  assert.equal(q.title, "Stop building this film?");
  assert.equal(q.body, "Closing this window stops the build now. Every scene already written is kept. To finish just the unwritten scenes later, open Story Editors and choose Finish writing this film.");
  assert.equal(q.confirmLabel, "Stop the build"); assert.equal(q.cancelLabel, "Keep building"); assert.ok(q.safeDefault);
  await runner.props.onClose(); assert.equal(closed, 0, "the X asks too");
  await runner.props.onBack(); assert.equal(box.__confirms.length, 3, "and 'All agents'");
  box.__confirmAnswer = true;
  await runner.props.onClose(); assert.equal(closed, 1, "Yes closes (and so stops) it");
  // not running (idle, done or waiting for approval): closes at once, no question
  reset(); closed = 0;
  runner.props.onRunningChange(false);
  await tree.props.onMouseDown({ target:1, currentTarget:1 });
  assert.equal(closed, 1); assert.equal(box.__confirms.length, 0);
  // a click INSIDE the panel is not a backdrop click
  await tree.props.onMouseDown({ target:1, currentTarget:2 }); assert.equal(closed, 1);
});

/* (review 2026-09-28) the runner's OWN effect reports "running" to the panel — no hand-driven
   onRunningChange: a hooks runtime that runs effects, like one mounted component */
const makeLiveHooks = ()=>{
  const slots = []; let i = 0, pending = [];
  const R = new Proxy({ createElement:h, Fragment:"frag",
    useState:(x)=>{ const k = i++; if(!(k in slots)) slots[k] = { v:typeof x==="function" ? x() : x }; const sl = slots[k];
      return [sl.v, (v)=>{ sl.v = typeof v==="function" ? v(sl.v) : v; }]; },
    useRef:(x)=>{ const k = i++; if(!(k in slots)) slots[k] = { current:x }; return slots[k]; },
    useEffect:(fn, deps)=>{ const k = i++; const prev = slots[k];
      const changed = !prev || !deps || deps.length!==prev.deps.length || deps.some((d,j)=>d!==prev.deps[j]);
      if(!changed) return;
      const sl = { deps:deps||[], cleanup:null }; slots[k] = sl;
      pending.push(()=>{ if(prev && prev.cleanup) prev.cleanup(); const c = fn(); sl.cleanup = typeof c==="function" ? c : null; }); },
    useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f, memo:(f)=>f, forwardRef:(f)=>f,
    createContext:()=>({ Provider:"provider" }), useContext:()=>null,
  }, { get:(t,k)=> (k in t) ? t[k] : noop });
  return {
    render:(C, props)=>{ i = 0; pending = []; box.React = R; const t = C(props); pending.forEach(f=>f()); return t; },
    unmount:()=>slots.forEach(sl=>{ if(sl && typeof sl.cleanup==="function") sl.cleanup(); }),
  };
};
await test("3 (review) the build runner itself tells the panel when it starts and stops running", async ()=>{
  reset();
  const said = [];
  let release; const gate = new Promise(r=>{ release = r; });
  const agent = { id:"adapt", name:"Adaptation", kind:"build", needsInput:true, run:async ()=>{ await gate; } };
  const props = { agent, ctxFactory:(o)=>({ ...o, switchedFilms:()=>false }), onClose:noop, onView:noop, onBack:noop,
    initialInput:"A brief.", autoStart:true, onRunningChange:(v)=>said.push(v) };
  const L = makeLiveHooks();
  L.render(box.AgentRunner, props);
  assert.deepEqual(said, [false], "idle on mount");
  await tick(); await tick();                          // the auto-start timer runs start()
  L.render(box.AgentRunner, props);
  assert.deepEqual(said, [false, true], "running once the build starts");
  release(); await tick(); await tick();
  L.render(box.AgentRunner, props);
  assert.deepEqual(said, [false, true, false], "not running once it ends");
  L.unmount();
  assert.equal(said[said.length-1], false, "an unmounted runner is never left 'running'");
});
await test("3 (review) closing any OTHER agent while it runs closes at once — no build question", async ()=>{
  for(const id of ["doctor", "continuity"]){
    reset();
    let closed = 0;
    const render = mountPanel({ onClose:()=>closed++, onView:noop, ctxFactory:noop, aiOn:true, undoCount:0, issues:{}, initialAgentId:id });
    const tree = render();
    const runner = findAll(tree, n=>n.type===box.AgentRunner)[0];
    assert.ok(runner && runner.props.agent.id===id, id);
    runner.props.onRunningChange(true);
    await tree.props.onMouseDown({ target:1, currentTarget:1 });
    await runner.props.onClose();
    assert.equal(closed, 2, id+" closes"); assert.equal(box.__confirms.length, 0, id+" asks nothing");
  }
});
await test("3 Story Editors offers 'Finish writing this film' and opens Adaptation READY with the film's brief", async ()=>{
  reset();
  const render = mountPanel({ onClose:noop, onView:noop, ctxFactory:noop, aiOn:true, undoCount:0, issues:{},
    unwritten:3, unwrittenStandIns:1, finishInput:"The film's own brief." });
  let tree = render();
  const btn = findAll(tree, n=>n.type==="button" && textOf(n)==="Finish writing this film")[0];
  assert.ok(btn, "the row is there");
  const row = findAll(tree, n=>n.props && n.props.className==="ag-undo-row ag-finish-row")[0];
  assert.equal(textOf(row), "3 scenes aren’t written yet (1 is a rough stand-in) — Adaptation can write just those, leaving everything already written untouched.Finish writing this film");
  btn.props.onClick();
  tree = render();
  const runner = findAll(tree, n=>n.type===box.AgentRunner)[0];
  assert.ok(runner && runner.props.agent.id==="adapt");
  assert.equal(runner.props.initialInput, "The film's own brief.");
  assert.equal(runner.props.autoStart, false, "never starts on its own (the engine can be switched first)");
  assert.equal(runner.props.runOnOpen, false);
  assert.equal(textOf(runner.props.introExtra), "This film has 3 unwritten scenes (1 of them a rough stand-in). Press Run Adaptation: it first offers to write just those — every scene already written stays untouched. Decline only if you want to rebuild the whole film from the logline above.");
  // no row when everything is written, or with no writing model
  const none = mountPanel({ onClose:noop, ctxFactory:noop, aiOn:true, undoCount:0, issues:{}, unwritten:0 })();
  assert.equal(findAll(none, n=>n.type==="button" && textOf(n)==="Finish writing this film").length, 0);
  const off = mountPanel({ onClose:noop, ctxFactory:noop, aiOn:false, undoCount:0, issues:{}, unwritten:2 })();
  assert.equal(findAll(off, n=>n.type==="button" && textOf(n)==="Finish writing this film").length, 0);
  // the app passes the counts (blank + stand-in scenes) and the film's brief
  assert.ok(/return \{ unwritten:n, unwrittenStandIns:st, finishInput:String\(\(project && \(project\.sourceBrief \|\| project\.logline\)\) \|\| ""\) \};/.test(appSrc));
  // the build's own messages point there
  assert.ok(agentsSrc.includes('const FINISH_WHERE = "press Run again, or later open Story Editors and choose Finish writing this film";'));
  assert.ok(!/Run Adaptation again/.test(agentsSrc), "no dead-end 'Run Adaptation again' advice left");
});

/* =====================================================================================
   12. TABLET — one side panel at a time
   ===================================================================================== */
await test("12 on a tablet, opening one side panel closes the other (as on mobile); desktop keeps both", async ()=>{
  const lines = between(appSrc, "  const excl = ()=>", "  const [drafts, setDrafts]");
  for(const vp of ["tablet","mobile","desktop"]){
    const st = { rail:false, insp:true };
    const env = { vp, setRailOpen:(v)=>{ st.rail = typeof v==="function" ? v(st.rail) : v; }, setInspOpen:(v)=>{ st.insp = typeof v==="function" ? v(st.insp) : v; } };
    const api = compile(lines, env, ["openRail","openInsp","toggleRail","toggleInsp"]);
    api.openRail();
    assert.deepEqual(st, vp==="desktop" ? { rail:true, insp:true } : { rail:true, insp:false }, vp+" openRail");
    api.openInsp();
    assert.deepEqual(st, vp==="desktop" ? { rail:true, insp:true } : { rail:false, insp:true }, vp+" openInsp");
    // (review) the view bar's panel toggles — a tablet's main way in — follow the same rule
    const t = { rail:false, insp:true };
    const env2 = { vp, setRailOpen:(v)=>{ t.rail = typeof v==="function" ? v(t.rail) : v; }, setInspOpen:(v)=>{ t.insp = typeof v==="function" ? v(t.insp) : v; } };
    const api2 = compile(lines, env2, ["toggleRail","toggleInsp"]);
    api2.toggleRail();
    assert.deepEqual(t, vp==="desktop" ? { rail:true, insp:true } : { rail:true, insp:false }, vp+" toggleRail opens the Story panel");
    api2.toggleInsp();
    assert.deepEqual(t, vp==="desktop" ? { rail:true, insp:false } : { rail:false, insp:true }, vp+" toggleInsp");
    api2.toggleInsp();
    assert.deepEqual(t, vp==="desktop" ? { rail:true, insp:true } : { rail:false, insp:false }, vp+" closing a panel opens nothing");
  }
  // every path that opens a panel on a tablet goes through them
  assert.ok(/React\.createElement\(CollapsedStrip,\{side:"left",label:"Story",icon:Icon\.panelLeft,\s*onExpand:openRail,/.test(appSrc), "the Story strip");
  assert.ok(/onExpand:openInsp\}\)\);/.test(appSrc), "the Inspector strip");
  assert.ok(/if\(!inspDrawer\) openInsp\(\);\s*\};/.test(appSrc), "selecting a scene");
  assert.ok(/onSelectChar:\(id\)=>\{ setSelChar\(id\); openInsp\(\); \},/.test(appSrc), "picking a cast member");
  assert.ok(!/if\(!inspDrawer\) setInspOpen\(true\)/.test(appSrc));
});

/* =====================================================================================
   13. BOARD — keyboard access
   ===================================================================================== */
await test("13 Board scene cards and folded act strips are buttons that answer Enter and Space", async ()=>{
  const hooks = makeHooks(); box.React = hooks.R;
  const Board = vm.runInContext("("+between(appSrc, "function Board(", "\n/* viewport mode")+")", box);
  const picked = [];
  const scenes = [{ ...SC("s1","Open",1), conf:2, kind:"normal" }, { ...SC("s2","Push",2), conf:1, kind:"normal", no:2 }];
  const tree = Board({ scenes, selId:"s1", onSelect:(id)=>picked.push(id) });
  const cards = findAll(tree, n=>n.props && typeof n.props.className==="string" && /^scard( |$)/.test(n.props.className));
  assert.equal(cards.length, 2);
  cards.forEach(c=>{ assert.equal(c.props.role, "button"); assert.equal(c.props.tabIndex, 0); });
  assert.equal(cards[0].props["aria-label"], "Scene 1: Open"); assert.equal(cards[0].props["aria-pressed"], true);
  let prevented = 0; const ev = (key)=>({ key, preventDefault:()=>prevented++ });
  cards[1].props.onKeyDown(ev("Enter")); cards[1].props.onKeyDown(ev(" ")); cards[1].props.onKeyDown(ev("a"));
  assert.deepEqual(picked, ["s2","s2"]); assert.equal(prevented, 2);
  // a folded act column: a strip that opens from the keyboard too
  box.localStorage = { getItem:()=>JSON.stringify({ 2:true }), setItem:noop, removeItem:noop };
  box.React = makeHooks().R;                            // a fresh mount reads the saved fold state
  const folded = Board({ scenes, selId:"s1", onSelect:noop });
  const strip = findAll(folded, n=>n.props && n.props.className==="board-act-strip")[0];
  assert.ok(strip && strip.props.role==="button" && strip.props.tabIndex===0 && /^Expand Act II/.test(strip.props["aria-label"]));
  box.localStorage = { getItem:()=>null, setItem:noop, removeItem:noop };
});

console.log((failed ? "FAILED" : "OK")+" — "+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

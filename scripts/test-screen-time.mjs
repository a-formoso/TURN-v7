#!/usr/bin/env node
/* Screen time per scene (docs/Story Pipeline.md step 5, owner-approved 2026-09-27).

   Incident (the nine 2026-09-27 sample builds): every film came out 1.5x to 11x longer than its
   format promises — the 30-60 s commercial was a 6.5-minute script, the micro-drama episode 22
   minutes, the TV episodes 76-88 minutes. The format's runtime (formats.jsx runtimeMin) was read
   nowhere: the beat builder always asked for "4-6 beats", the scene writer, the redraft and the
   single-beat writer had no length target, five formats were drafted with no format line at all,
   and the spine's heat flag compared each scene with the film's own (equally bloated) average.

   The doc now says each scene "is written to a screen-time budget — the format's runtime divided
   by its scene count — and the beat map is sized to it: 2–3 beats per scene for Commercial,
   Micro-drama and Music Video, 3–4 for Micro Short, 4–6 for every other format", with the owner's
   runtimes; "the spine, beat and scene prompts all state the budget, and a redraft never makes a
   scene longer. A scene that still runs long gets a free warning on its card and in the Script
   view — nothing is rewritten automatically".

   This runs the REAL app files (formats, frameworks, contract, scene-order, story-data, spine,
   script, ai) in node:vm with a stubbed window.claude.complete that records every prompt (no
   network), and proves:
     A. the budgets per format: the owner's runtimes, ÷ the actual scene count, in seconds, lines
        (the estimator's own 55 lines/min) and words; the blurbs agree with the runtimes;
     B. the beat ranges per format reach the beat builder, with the budget, never the fixed 4-6
        for a short format;
     C. every writing prompt carries exactly one SCREEN TIME instruction with the budget (draft,
        redraft, single beat), every format is described to the writer, the redraft is told not
        to run past the budget (and to come back shorter when over), and the spine prompt states
        each format's total runtime;
     D. the free check's thresholds (past 1.5x, drafted scenes only), the runtime estimate keeps
        working (legacy figures unchanged without a budget; a short format's scenes are not
        floored to 20 s), and the app's runtime map flags by the budget, not the film's average;
     E. the warning shows on the spine's scene card and in the Script view, only when long;
     F. MUSE's product knowledge describes it, names no vendor; the doc says it; keys moved.
   node scripts/test-screen-time.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const read = (f)=>readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,6).join("\n    ")); }
};

/* ---------------- sandbox: the real app files ---------------- */
const noop = ()=>{};
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const ReactStub = new Proxy({
  createElement:h, Fragment:"frag",
  useState:(x)=>[typeof x==="function" ? x() : x, noop], useRef:(x)=>({ current:x }), useEffect:noop,
  useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f, memo:(f)=>f, forwardRef:(f)=>f,
  createContext:()=>({ Provider:"provider" }), useContext:()=>null,
}, { get:(t,k)=> (k in t) ? t[k] : noop });
const box = {
  console:{ ...console, warn:noop, info:noop }, clearTimeout, setInterval, clearInterval,
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
box.__replies = []; box.__prompts = [];
box.appToast = noop; box.appConfirm = async ()=>true;
// installed BEFORE ai.jsx, so its proxy shim is skipped; every prompt is recorded
box.claude = { complete: async (o)=>{ box.__prompts.push(String(o.messages[0].content)); const r = box.__replies.shift(); if(r instanceof Error) throw r; return r == null ? "" : r; } };
vm.createContext(box);
const asShipped = (f)=>transformSync(read(f), { plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename:f }).code;
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx",
  "app/spine.jsx","app/script.jsx","app/ai.jsx"])
  vm.runInContext(f==="app/script.jsx" ? asShipped(f) : read(f), box, { filename:f });
box.console = { ...console, warn:noop, info:noop, log:noop };
const reset = ()=>{ box.__replies = []; box.__prompts = []; box.turnCast = undefined; box.turnContinuity = undefined; };
const plain = (x)=>JSON.parse(JSON.stringify(x));
const F = (id)=>box.FORMATS.find(f=>f.id===id);

/* ---------------- fixtures ---------------- */
const CAST = [{ id:"isamu", name:"Isamu" }, { id:"hana", name:"Hana" }];
const mkScenes = (n)=>Array.from({ length:n }, (_, i)=>({ id:"s"+(i+1), no:i+1, act:i<n/4?1:i<3*n/4?2:3, title:"Scene "+(i+1),
  loc:"INT. WORKSHOP - DAY", driver:"isamu", summary:"Isamu pockets the tape measure.", objective:"to keep it",
  openValue:"Trust", openCharge:1, closeValue:"Suspicion", closeCharge:-1 }));
const BEATS = { driverLabel:"Isamu", reactorLabel:"Hana", turnAt:2, desire:"to keep it", obstacle:"to expose him", rows:[
  { n:1, drive:{ a:"Arrives", d:"Isamu steps in early." }, react:{ a:"Watches", d:"Hana watches." } },
  { n:2, drive:{ a:"Pockets", d:"He pockets the tape measure." }, react:{ a:"Notices", d:"Hana sees the empty hook." } },
]};
const GOOD_REPLY = JSON.stringify({ beats:[
  { n:1, blocks:[{ type:"action", text:"ISAMU (50s) slides the door open." }, { type:"char", text:"HANA" }, { type:"dia", text:"You're early." }] },
  { n:2, blocks:[{ type:"action", text:"Isamu pockets the tape measure. HANA (30s) sets her plane down." }] },
]});
// a draft of exactly `lines` estimated screenplay lines: the app's heading (2) + 2-line action blocks
const draftOfLines = (lines)=>{
  const blocks = [{ beat:1, type:"scene", text:"INT. WORKSHOP - DAY" }];
  for(let l = 2; l + 2 <= lines; l += 2) blocks.push({ beat:1, type:"action", text:"He waits by the door and counts." });
  return { blocks, ai:true, auto:false, by:{ model:"Writing model", at:1 } };
};
const OWNER = { commercial:30, microdrama:120, short:240, musicvideo:240, film:900, series:1800, documentary:600, feature:6000 };
const RANGES = { commercial:[2,3], microdrama:[2,3], musicvideo:[2,3], short:[3,4], film:[4,6], series:[4,6], documentary:[4,6], feature:[4,6] };

/* ============================ A. budgets ============================ */
await test("A the owner's runtimes per format, divided by the scene count, in seconds, lines and words", ()=>{
  assert.deepEqual(Object.fromEntries(box.FORMATS.map(f=>[f.id, Math.round(f.runtimeMin*60)])), OWNER, "the registry holds the owner's runtimes");
  for(const f of box.FORMATS){
    const b = box.sceneBudgetFor(f, f.sceneTarget);
    assert.equal(b.runtimeSec, OWNER[f.id], f.id);
    assert.equal(b.scenes, f.sceneTarget);
    assert.ok(Math.abs(b.sec - OWNER[f.id]/f.sceneTarget) < 1e-9, f.id+" sec = runtime ÷ scenes");
    assert.equal(b.lines, Math.max(3, Math.round(b.sec/60*55)), f.id+" lines at the estimator's 55 lines/min");
    assert.equal(b.words, b.lines*4, f.id+" words at ~4 per line");
    assert.equal(b.label, f.label);
  }
  const want = { commercial:7.5, microdrama:120/7, short:30, musicvideo:30, film:56.25, series:75, documentary:50, feature:150 };
  for(const [id, sec] of Object.entries(want)) assert.ok(Math.abs(box.sceneBudgetFor(F(id), F(id).sceneTarget).sec - sec) < 1e-9, id);
  // the ACTUAL scene count decides, not the target
  assert.equal(box.sceneBudgetFor({ format:"commercial" }, 3).sec, 10);
  assert.equal(box.sceneBudgetFor({ format:"film" }, 18).sec, 50);
  // no count: the format's target count; an unknown format is the Short Film
  assert.equal(box.sceneBudgetFor({ format:"microdrama" }).scenes, 7);
  assert.equal(box.sceneBudgetFor({}, 16).format, "film");
  assert.equal(box.sceneBudgetFor({ format:"Feature Film" }, 40).sec, 150, "a legacy label resolves");
  // an Episode is written as a TV episode (the Show's format), 30 minutes
  assert.equal(box.sceneBudgetFor({ format:"series" }, 24).runtimeText, "30 minutes");
  assert.equal(box.sceneBudgetFor(F("commercial"), 4).runtimeText, "30 seconds");
  assert.equal(box.budgetPhrase(box.sceneBudgetFor(F("microdrama"), 7)), "a ~2-minute Micro-drama in 7 scenes");
  assert.equal(box.budgetPhrase(box.sceneBudgetFor(F("commercial"), 1)), "a ~30-second Commercial in 1 scene");
});

await test("A the writer's line budget and the runtime estimate agree (the same 55 lines ≈ 60 s)", ()=>{
  for(const f of box.FORMATS){
    const b = box.sceneBudgetFor(f, f.sceneTarget);
    const est = box.sceneRuntime(null, draftOfLines(b.lines % 2 ? b.lines+1 : b.lines), null, b);
    assert.ok(est.sec <= b.sec*1.25 + 2 && est.sec >= b.sec*0.75 - 2, f.id+": a draft at the line budget estimates "+est.sec+" s against "+b.sec.toFixed(1));
    assert.equal(box.sceneLengthCheck(est, b).long, false, f.id+": a draft at its budget is not long");
  }
});

await test("A the blurbs and the planning briefs agree with the runtimes", ()=>{
  const blurb = (id)=>F(id).blurb;
  assert.ok(/^30 seconds/.test(blurb("commercial")) && !/60/.test(blurb("commercial")), blurb("commercial"));
  assert.ok(/About 100 minutes/.test(blurb("feature")) && !/90\+/.test(blurb("feature")), blurb("feature"));
  assert.ok(/About 10 minutes/.test(blurb("documentary")), blurb("documentary"));
  assert.ok(/About 4 minutes/.test(blurb("musicvideo")), blurb("musicvideo"));
  assert.ok(/Under 5 minutes/.test(blurb("short")) && /1–3 minutes/.test(blurb("microdrama")) && /10–20 minutes/.test(blurb("film")) && /about 30 minutes/.test(blurb("series")));
  assert.ok(F("commercial").spineBrief.startsWith("a 30-second commercial") && !/30–60/.test(F("commercial").spineBrief));
});

/* ============================ B. beats per scene ============================ */
await test("B beat ranges per format: 2-3 Commercial, Micro-drama, Music Video; 3-4 Micro Short; 4-6 the rest", ()=>{
  for(const f of box.FORMATS) assert.deepEqual(plain(box.sceneBudgetFor(f, f.sceneTarget).beats), RANGES[f.id], f.id);
});

await test("B the beat builder asks for the format's range and states the budget — never the fixed 4-6 for a short format", async ()=>{
  box.aiAvailable = ()=>true;
  for(const f of box.FORMATS){
    reset();
    const scenes = mkScenes(f.sceneTarget);
    box.__replies = ["{}"];
    await box.aiAuthorScene(scenes[1], scenes[0], CAST, { format:f.id, title:"T" }, { scenes, keepCard:true });
    const p = box.__prompts[0];
    const [lo, hi] = RANGES[f.id], b = box.sceneBudgetFor(f, f.sceneTarget);
    assert.ok(p.includes("Give "+lo+"-"+hi+" beats \u2014 this scene plays about "+Math.round(b.sec)+" seconds of screen time ("+box.budgetPhrase(b)+"), so size the beats to fit it."), f.id+": "+p.slice(p.indexOf("Give"), p.indexOf("Give")+200));
    if(lo < 4) assert.ok(!p.includes("Give 4-6 beats"), f.id+" lost the fixed 4-6");
  }
  // without opts.scenes the film's live scene list decides the count
  reset(); box.turnContinuity = { scenes:mkScenes(5) }; box.__replies = ["{}"];
  await box.aiAuthorScene(mkScenes(5)[0], null, CAST, { format:"commercial" }, { keepCard:true });
  assert.ok(box.__prompts[0].includes("Give 2-3 beats \u2014 this scene plays about 6 seconds"), box.__prompts[0].slice(box.__prompts[0].indexOf("Give"), box.__prompts[0].indexOf("Give")+120));
  // no registry loaded (a stripped test sandbox): the old ask survives
  const sb = { console }; sb.window = sb; vm.createContext(sb);
  const ai = read("app/ai.jsx");
  const grab = (name)=>{ const i = ai.indexOf("function "+name+"("); const j = ai.indexOf("\nwindow."+name+" = "+name+";", i); return ai.slice(i, j); };
  vm.runInContext("function writingProjectOf(p){ return p||{}; }\n"+grab("screenTimeBudgetOf").split("\nfunction screenTimeBrief(")[0]+"\n"+grab("beatCountAsk"), sb);
  assert.equal(sb.beatCountAsk({ format:"commercial" }, null), "Give 4-6 beats. ");
});

/* ============================ C. the prompts carry the budget ============================ */
const ONE = (p)=> (p.match(/SCREEN TIME:/g)||[]).length;
await test("C the scene writer: one SCREEN TIME instruction with the budget, for every format, and a FORMAT line for every format", async ()=>{
  box.aiAvailable = ()=>true;
  for(const f of box.FORMATS){
    reset();
    const scenes = mkScenes(f.sceneTarget), b = box.sceneBudgetFor(f, f.sceneTarget);
    box.__replies = [GOOD_REPLY];
    await box.aiDraftScene(scenes[1], BEATS, scenes[0], { format:f.id, title:"T" }, CAST, scenes);
    const p = box.__prompts[0];
    assert.equal(ONE(p), 1, f.id+" has one SCREEN TIME instruction");
    const want = "SCREEN TIME: this scene plays about "+Math.max(1, Math.round(b.sec))+" seconds of "+box.budgetPhrase(b)+
      " \u2014 about "+b.lines+" screenplay lines (\u2248"+b.words+" words) in all, counting character cues but not the scene heading"+
      (f.id==="documentary" ? "; each EXPECTED TESTIMONY note stands for about 15 seconds of recorded testimony and counts that much against the budget" : "")+
      "; give the turning beat the most room and cut anything that doesn\u2019t earn its seconds.";
    assert.ok(p.includes(want), f.id+": "+p.slice(p.indexOf("SCREEN TIME"), p.indexOf("SCREEN TIME")+260));
    assert.ok(/\nFORMAT: \S/.test("\n"+p) || p.includes("\n\nFORMAT: "), f.id+" gets a FORMAT line");
    assert.ok(p.includes("FORMAT: "+(f.screenplayBrief || ("this is "+f.spineBrief))+"."), f.id+" format line");
    assert.ok(p.indexOf("SCREEN TIME:") < p.indexOf("Return ONLY JSON"), "stated before the output spec");
  }
  // the five formats that had NO format line before
  reset(); box.__replies = [GOOD_REPLY];
  await box.aiDraftScene(mkScenes(7)[0], BEATS, null, { format:"microdrama" }, CAST, mkScenes(7));
  assert.ok(box.__prompts[0].includes("FORMAT: this is a vertical micro-drama episode \u2014 hook inside the first scene"), "micro-drama is told what it is");
  assert.equal(box.formatDraftBrief({ format:"commercial" }), F("commercial").screenplayBrief, "a screenplay brief still wins");
  for(const id of ["film","feature","short","microdrama","series"]) assert.ok(box.formatDraftBrief({ format:id }).startsWith("this is "), id);
});

await test("C the redraft: never longer than the current script; a script already over its budget comes back shorter", async ()=>{
  box.aiAvailable = ()=>true;
  const scenes = mkScenes(7), b = box.sceneBudgetFor(F("microdrama"), 7);
  const structural = box.autoDraftScene(scenes[1], BEATS, scenes[0]).blocks;
  // over budget: a 3-minute script for a 17-second scene
  reset(); box.__replies = [GOOD_REPLY];
  const long = draftOfLines(170);
  await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], { format:"microdrama" }, {}, { current:long, scenes });
  let p = box.__prompts[0];
  assert.equal(ONE(p), 1);
  const cur = box.sceneRuntime(null, long, null, b).sec;
  assert.ok(p.includes("SCREEN TIME: this scene plays about 17 seconds of a ~2-minute Micro-drama in 7 scenes"), p.slice(p.indexOf("SCREEN TIME"), p.indexOf("SCREEN TIME")+200));
  assert.ok(p.includes("This redraft must NOT make the scene longer \u2014 the current script runs about "+cur+" seconds, over the budget, so the redraft comes back SHORTER, at the budget"), p.slice(p.indexOf("This redraft"), p.indexOf("This redraft")+220));
  assert.ok(p.includes("FORMAT: this is a vertical micro-drama episode"), "the redraft is told the format too");
  // within budget: capped at the CURRENT script's length (never longer), no "shorter"
  reset(); box.__replies = [GOOD_REPLY];
  const short = draftOfLines(10), shortT = box.sceneRuntime(null, short, null, b);
  await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], { format:"microdrama" }, {}, { current:short, scenes });
  p = box.__prompts[0];
  assert.ok(p.includes("This redraft must NOT make the scene longer \u2014 the current script runs about "+shortT.raw+" seconds (about "+shortT.lines+" lines); come back at or under that") && !p.includes("SHORTER"),
    p.slice(p.indexOf("This redraft"), p.indexOf("This redraft")+200));
  // no script yet, or only a rough stand-in (its text is the beat cards): held to the budget
  for(const cur of [null, { ...box.autoDraftScene(scenes[1], BEATS, scenes[0]) }]){
    reset(); box.__replies = [GOOD_REPLY];
    await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], { format:"microdrama" }, {}, { current:cur, scenes });
    assert.ok(box.__prompts[0].includes("This redraft must NOT run longer than that budget;"), box.__prompts[0].slice(box.__prompts[0].indexOf("This redraft"), box.__prompts[0].indexOf("This redraft")+120));
  }
  // no current draft and no scenes passed: the film's live scene list gives the count
  reset(); box.turnContinuity = { scenes:mkScenes(4) }; box.__replies = [GOOD_REPLY];
  await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], { format:"commercial" }, {});
  assert.ok(box.__prompts[0].includes("this scene plays about 8 seconds of a ~30-second Commercial in 4 scenes"), box.__prompts[0].slice(box.__prompts[0].indexOf("SCREEN TIME"), box.__prompts[0].indexOf("SCREEN TIME")+160));
  // the app hands the redraft the scene's current draft and the film's scenes
  const app = read("app/app.jsx");
  assert.ok(/aiPolishScene\(s, beatsForScene, structural\.blocks, prev, project, report,\s*\{ retry:[^}]*current:drafts\[s\.id\] \|\| null, scenes \}\)/.test(app), "polishScene passes current + scenes");
});

await test("C a redraft NEVER makes a scene longer: a reply longer than the current script is discarded, said plainly, and the retry is told", async ()=>{
  box.aiAvailable = ()=>true;
  const scenes = mkScenes(16), fmt = { format:"film" }, b = box.sceneBudgetFor(F("film"), 16);
  const structural = box.autoDraftScene(scenes[1], BEATS, scenes[0]).blocks;
  // the current script: 8 lines by the estimate (headings take no screen time); a reply of 6 action
  // paragraphs is 12 lines — longer, although well inside the 56 s budget
  const current = draftOfLines(10), ceiling = box.sceneRuntime(null, current, null, b);
  assert.equal(ceiling.lines, 8);
  const para = "Isamu counts the chisels twice and lines them up by the bench.";
  const LONG = JSON.stringify({ beats:[{ n:1, blocks:[1,2,3].map(()=>({ type:"action", text:para })) }, { n:2, blocks:[1,2,3].map(()=>({ type:"action", text:para })) }] });
  reset(); box.__replies = [LONG];
  const report = {};
  const res = await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], fmt, report, { current, scenes });
  assert.equal(res, null, "the longer redraft is not returned (the current script stays)");
  assert.equal(report.failure.kind, "long");
  assert.equal(report.failure.lines, 12); assert.equal(report.failure.capLines, 8);
  const msg = box.screenplayFailureMessage("redraft", 2, report.failure, { kept:"Your current draft is unchanged.", retryLabel:"press Redraft again", carries:true });
  assert.ok(msg.startsWith("Couldn\u2019t redraft Scene 2 \u2014 the new draft ran longer than the current script (about 0:13 against 0:09) \u2014 a redraft never makes a scene longer, so it was discarded."), msg);
  assert.ok(msg.includes("the next attempt is told how long the current script runs"), msg);
  assert.ok(!/claude|anthropic|openai|mckee/i.test(msg));
  // the retry is told by how much
  reset(); box.__replies = [GOOD_REPLY];
  const ok2 = await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], fmt, {}, { current, scenes, retry:report.failure });
  assert.ok(box.__prompts[0].includes("A PREVIOUS REDRAFT OF THIS SCENE WAS DISCARDED for running longer than the current script (about 12 lines against 8): a redraft never makes a scene longer \u2014 come back at or under 8 lines."), box.__prompts[0].slice(-400));
  assert.ok(ok2 && ok2.blocks.length, "a reply at or under the current length is committed");
  assert.ok(box.sceneRuntime(null, ok2, null, b).lines <= 8);
  // a rough stand-in is not a script: its redraft (MUSE writing it) is held only to the budget
  reset(); box.__replies = [LONG];
  const si = await box.aiPolishScene(scenes[1], BEATS, structural, scenes[0], fmt, {}, { current:box.autoDraftScene(scenes[1], BEATS, scenes[0]), scenes });
  assert.ok(si && si.blocks.filter(x=>x.type==="action").length === 6, "a stand-in's redraft is written: "+JSON.stringify(si && si.blocks.map(x=>x.type)));
  // the app remembers a length rejection for the next Redraft, like a format rejection
  const app = read("app/app.jsx");
  assert.ok(/if\(f && \(f\.kind==="invalid" \|\| f\.kind==="long"\)\) polishRetryRef\.current\[k\] = f;/.test(app) && /if\(failure\.kind==="invalid" \|\| failure\.kind==="long"\) rememberRejection/.test(app));
  // sensitivity: a prompt-only rule (no ceiling check) commits the longer redraft
  const sb = vm.runInContext("aiPolishScene.toString()", box);
  assert.ok(sb.includes("next.lines > ceiling.lines"), "the ceiling is enforced in code, not only asked for");
});

await test("C the single-beat writer gets the beat's share of the scene's budget", async ()=>{
  box.aiAvailable = ()=>true;
  reset(); box.turnContinuity = { scenes:mkScenes(16) };
  box.__replies = [JSON.stringify({ beats:[{ n:2, blocks:[{ type:"action", text:"Isamu pockets the tape measure." }] }] })];
  const draft = { blocks:[{ beat:1, type:"scene", text:"INT. WORKSHOP - DAY" }, { beat:1, type:"action", text:"ISAMU (50s) slides the door open." }], ai:true };
  await box.aiWriteBeatText(mkScenes(16)[1], BEATS, 2, draft, null, { format:"film" }, {});
  const p = box.__prompts[0], b = box.sceneBudgetFor(F("film"), 16), bb = box.beatBudgetFor(b, 2);
  assert.equal(ONE(p), 1);
  assert.ok(p.includes("SCREEN TIME: this scene plays about 56 seconds of a ~15-minute Short Film in 16 scenes"), p.slice(p.indexOf("SCREEN TIME"), p.indexOf("SCREEN TIME")+160));
  assert.ok(p.includes("; this ONE beat gets about "+bb.lines+" lines (\u2248"+bb.words+" words) of it \u2014 never more."), p.slice(p.indexOf("this ONE beat"), p.indexOf("this ONE beat")+100));
  assert.equal(bb.lines, 26);
  assert.ok(p.includes("FORMAT: this is a short film of about 10\u201320 minutes"), "the film is described");
});

await test("C the spine prompt states the total runtime and the seconds per scene for every format and structure", async ()=>{
  const ai = read("app/ai.jsx");
  const { parseSync } = await import("@babel/core");
  const ast = parseSync(ai, { sourceType:"script" });
  const node = ast.program.body.find(x=>x.type==="FunctionDeclaration" && x.id.name==="spineBatch");
  vm.runInContext(ai.slice(node.start, node.end), box);
  let sent = "";
  const saved = { extractJSON:box.extractJSON, salvageSpineScenes:box.salvageSpineScenes, normSpineScenes:box.normSpineScenes, claude:box.claude };
  Object.assign(box, { extractJSON:()=>({ scenes:[] }), salvageSpineScenes:()=>[], normSpineScenes:x=>x,
    claude:{ complete:async o=>{ sent = o.messages[0].content; return "{}"; } } });
  const words = { commercial:"30 seconds", microdrama:"2 minutes", short:"4 minutes", musicvideo:"4 minutes", film:"15 minutes", series:"30 minutes", documentary:"10 minutes", feature:"100 minutes" };
  try{
    for(const f of box.FORMATS) for(const fwId of [null, "kishotenketsu", "herosjourney"]){
      const fw = fwId ? box.FRAMEWORKS.find(x=>x.id===fwId) : null;
      for(const part of ["first", "second"]){
        await box.spineBatch("brief", part, f, fw);
        const total = f.id==="film" ? 16 : f.sceneTarget, b = box.sceneBudgetFor(f, total);
        const want = "SCREEN TIME: the whole "+f.label+" runs about "+words[f.id]+" \u2014 about "+Math.max(1, Math.round(b.sec))+" seconds per scene across its "+total+" scenes";
        assert.ok(sent.includes(want), f.id+" x "+(fwId||"threeact")+" ("+part+"): "+sent.slice(0, 400));
        assert.equal(ONE(sent), 1);
      }
    }
    await box.spineBatch("brief", "first", null, null);
    assert.ok(sent.includes("SCREEN TIME: the whole Short Film runs about 15 minutes \u2014 about 56 seconds per scene across its 16 scenes"), "no format: the Short Film");
  } finally { Object.assign(box, saved); }
});

/* ============================ D. the check and the estimate ============================ */
await test("D the warning threshold: past 1.5x the budget, drafted scenes only", ()=>{
  const b = box.sceneBudgetFor(F("series"), 24);          // 75 s
  assert.equal(box.LONG_FOR_FORMAT, 1.5);
  assert.equal(box.sceneLengthCheck({ sec:112, approx:false }, b).long, false, "1.49x: fine");
  assert.equal(box.sceneLengthCheck({ sec:112.5, approx:false }, b).long, false, "exactly 1.5x: fine");
  assert.equal(box.sceneLengthCheck({ sec:113, approx:false }, b).long, true, "past 1.5x: long");
  assert.equal(box.sceneLengthCheck({ sec:219, approx:false }, b).long, true, "the sample TV scene (219 s) is long");
  assert.ok(Math.abs(box.sceneLengthCheck({ sec:150, approx:false }, b).ratio - 2) < 1e-9);
  assert.equal(box.sceneLengthCheck({ sec:600, approx:true }, b).long, false, "an undrafted estimate never warns");
  assert.equal(box.sceneLengthCheck({ sec:600, approx:false }, null).long, false, "no budget, no warning");
  assert.equal(box.sceneLengthCheck(null, b).long, false);
  // the 2026-09-27 samples' average scene: every short format's is flagged (2.5x-11x); the
  // Feature's (223 s against 150 s, 1.49x) sits just inside the line, as a scene within the
  // estimate's ~10% noise of 1.5x should; every format's on-budget scene is fine
  const samples = { commercial:98, microdrama:188, short:178, musicvideo:144, documentary:151, film:146, series:219 };
  for(const [id, sec] of Object.entries(samples)){
    const bb = box.sceneBudgetFor(F(id), F(id).sceneTarget);
    assert.equal(box.sceneLengthCheck({ sec, approx:false }, bb).long, true, id+" sample ("+sec+" s) is long");
  }
  const fb = box.sceneBudgetFor(F("feature"), 40);
  assert.equal(box.sceneLengthCheck({ sec:223, approx:false }, fb).long, false, "the Feature sample (1.49x) is inside the line");
  assert.equal(box.sceneLengthCheck({ sec:226, approx:false }, fb).long, true, "226 s (1.51x) is long for a Feature");
  for(const f of box.FORMATS){
    const bb = box.sceneBudgetFor(f, f.sceneTarget);
    assert.equal(box.sceneLengthCheck({ sec:Math.round(bb.sec), approx:false }, bb).long, false, f.id+" on budget is fine");
  }
});

await test("D the runtime estimate keeps working: legacy figures without a budget; a short format's scenes are not floored to 20 s", ()=>{
  const sc = mkScenes(1)[0];
  // without a budget: exactly as before
  assert.deepEqual(plain(box.sceneRuntime(sc, null, null)), { sec:90, approx:true });
  assert.deepEqual(plain(box.sceneRuntime(sc, null, BEATS)), { sec:70, approx:true });
  assert.deepEqual(plain(box.sceneRuntime(sc, null, { rows:[1] })), { sec:45, approx:true });
  assert.deepEqual(plain(box.sceneRuntime(sc, null, { rows:new Array(9).fill(0) })), { sec:240, approx:true });
  assert.deepEqual(plain(box.sceneRuntime(sc, draftOfLines(6), null)), { sec:20, approx:false }, "the 20 s floor");
  assert.deepEqual(plain(box.sceneRuntime(sc, draftOfLines(110), null)), { sec:120, approx:false }, "110 lines = 2 minutes");
  // with a budget: an undrafted scene plays its budget; the floor never rises above it
  const com = box.sceneBudgetFor(F("commercial"), 4);
  assert.deepEqual(plain(box.sceneRuntime(sc, null, BEATS, com)), { sec:8, approx:true, fromBudget:true });
  assert.equal(box.sceneRuntime(sc, draftOfLines(6), null, com).sec, 7, "a 6-line spot scene is 7 s, not floored to 20 s");
  assert.equal(box.sceneRuntime(sc, draftOfLines(2), null, com).sec, 7, "the floor is the budget's whole seconds (7 of 7.5), never above it");
  assert.equal(box.sceneRuntime(sc, draftOfLines(10), null, box.sceneBudgetFor(F("microdrama"), 7)).sec, 17, "a Micro-drama floor (17 of 17.1) never tips a scene over its budget");
  assert.equal(box.sceneLengthCheck(box.sceneRuntime(sc, draftOfLines(6), null, com), com).long, false);
  assert.equal(box.sceneLengthCheck(box.sceneRuntime(sc, draftOfLines(90), null, com), com).long, true, "the sample's 90-line spot scene is long");
  const feat = box.sceneBudgetFor(F("feature"), 40);
  assert.equal(box.sceneRuntime(sc, draftOfLines(6), null, feat).sec, 20, "long formats keep the 20 s floor");
  // totals: seconds under two minutes, minutes above
  assert.equal(box.fmtRuntime(30), "30 s"); assert.equal(box.fmtRuntime(119), "119 s");
  assert.equal(box.fmtRuntime(120), "2 min"); assert.equal(box.fmtRuntime(900), "15 min");
});

await test("D a minimal Commercial scene the brief requires is not 'long'; a VO beat fits its share; headings take no screen time", ()=>{
  const com = box.sceneBudgetFor(F("commercial"), 4);                       // 7.5 s, 7 lines
  const endScene = { blocks:[{ beat:1, type:"scene", text:"INT. KITCHEN - DAWN" }, { beat:1, type:"action", text:"Steam curls off a fresh mug." },
    { beat:2, type:"char", text:"VO" }, { beat:2, type:"dia", text:"Mornings, made easy." }, { beat:2, type:"action", text:"SUPER: Mornings, made easy." },
    { beat:2, type:"action", text:"END CARD: KETTLEWORKS." }], ai:true };
  const rt = box.sceneRuntime(null, endScene, null, com);
  assert.equal(box.sceneLengthCheck(rt, com).long, false, "the brief's own final scene ("+rt.sec+" s) is not flagged");
  assert.equal(box.sceneRuntime(null, { blocks:[{ type:"scene", text:"INT. KITCHEN - DAWN" }] }, null, com).raw, 0, "a slugline alone plays no seconds");
  const bb = box.beatBudgetFor(com, 3);
  assert.ok(bb.lines >= 3, "a beat's share holds a cue + a short line (3 lines): "+bb.lines);
  // a Commercial pushed to 10 scenes (3 s each): the ask is still writable and a two-line scene isn't flagged
  const ten = box.sceneBudgetFor(F("commercial"), 10);
  assert.ok(ten.lines >= 4, "never fewer lines than the fewest beats need: "+ten.lines);
  const tiny = { blocks:[{ beat:1, type:"scene", text:"EXT. STREET - DAY" }, { beat:1, type:"action", text:"She runs." }, { beat:2, type:"action", text:"The bus waits." }] };
  assert.equal(box.sceneLengthCheck(box.sceneRuntime(null, tiny, null, ten), ten).long, false);
  // without a budget (legacy callers) a heading still counts, as before
  assert.equal(box.sceneRuntime(null, { blocks:[{ type:"scene", text:"X" }] }, null).sec, 20);
});

await test("D a documentary's planned testimony counts the seconds it will play; the writers are told", ()=>{
  const doc = box.sceneBudgetFor(F("documentary"), 12);                    // 50 s
  assert.equal(doc.testimonySec, 15);
  assert.equal(box.sceneBudgetFor(F("film"), 16).testimonySec, undefined, "only the documentary has it");
  const note = (who)=>({ beat:1, type:"action", text:"EXPECTED TESTIMONY: "+who+" on the flood night." });
  const four = { blocks:[{ beat:1, type:"scene", text:"EXT. SALT PANS - DAY" }, { beat:1, type:"action", text:"Dawn over the slumped wall." },
    note("Leonor"), note("Armindo"), note("Gracinda"), note("Benedita")] };
  const rt = box.sceneRuntime(null, four, null, doc);
  assert.ok(rt.sec >= 60, "four planned testimonies play a minute at least: "+rt.sec);
  assert.equal(box.sceneLengthCheck({ ...rt }, doc).long, false, "…which is 1.2x — inside the line");
  const six = { blocks:[...four.blocks, note("Quitéria"), note("Damião")] };
  assert.equal(box.sceneLengthCheck(box.sceneRuntime(null, six, null, doc), doc).long, true, "six testimonies in a 50 s scene run long");
  // a 12-scene documentary with four testimonies per scene now reads past its 10 minutes
  let total = 0; for(let i=0;i<12;i++) total += box.sceneRuntime(null, four, null, doc).sec;
  assert.ok(total > 600, "the film's estimate exceeds 10 minutes: "+total);
  // a paragraph with a note and other action counts both; no budget, no testimony figure
  const mixed = box.sceneRuntime(null, { blocks:[{ type:"action", text:"She sits. EXPECTED TESTIMONY: Leonor on the wall. The camera holds." }] }, null, doc);
  assert.ok(mixed.raw >= 15 && mixed.raw <= 19, "note + a little action: "+mixed.raw);
  assert.equal(box.sceneRuntime(null, four, null).sec, 20, "legacy (no budget): as before");
});

await test("D the app's runtime map flags by the format's budget, not the film's average (the real app.jsx code)", ()=>{
  const app = read("app/app.jsx");
  const start = app.indexOf("  const sceneBudget = (typeof sceneBudgetFor");
  const end = app.indexOf("  // ---- editing handlers (scenes + beats) ----", start);
  assert.ok(start > 0 && end > start, "found the runtime map");
  const code = app.slice(start, end);
  assert.ok(!/rtAvg|1\.75/.test(code), "the film-average heat is gone");
  const run = vm.runInContext("(function(project, scenes, drafts, beatsMap){ "+code+" return { runtimeMap, runtimeTotal, sceneBudget }; })", box);
  // every scene equally bloated: the old average heat lit nothing; the budget flags them all
  const scenes = mkScenes(7), drafts = {};
  scenes.forEach(s=>{ drafts[s.id] = draftOfLines(170); });
  const r = run({ format:"microdrama" }, scenes, drafts, {});
  assert.ok(scenes.every(s=>r.runtimeMap[s.id].long === true), "all seven 3-minute scenes are long for a Micro-drama");
  assert.equal(r.runtimeMap.s1.budget.format, "microdrama");
  // an undrafted film: no warnings, and the total is the format's runtime
  const r2 = run({ format:"commercial" }, mkScenes(4), {}, {});
  assert.ok(mkScenes(4).every(s=>r2.runtimeMap[s.id].long === false && r2.runtimeMap[s.id].approx === true));
  assert.equal(r2.runtimeTotal, 32, "4 × ~8 s");
  // a mixed film: only the long scene is flagged
  const d3 = { s1:draftOfLines(60), s2:draftOfLines(200) };
  const r3 = run({ format:"film" }, mkScenes(16), d3, {});
  assert.equal(r3.runtimeMap.s1.long, false); assert.equal(r3.runtimeMap.s2.long, true);
  // the legend shows seconds under two minutes and the target on hover
  assert.ok(app.includes('fmtRuntime(runtimeTotal)') && app.includes('" is meant to run about "+sceneBudget.runtimeText'));
});

/* ============================ E. where the warning shows ============================ */
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n) : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const find = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };

await test("E the spine's scene card: amber with a warning mark and the figures on hover, only when long", ()=>{
  const scenes = mkScenes(7), b = box.sceneBudgetFor(F("microdrama"), 7);
  const long = { sec:188, approx:false, budget:b, long:true };
  const fine = { sec:17, approx:false, budget:b, long:false };
  const rough = { sec:17, approx:true, fromBudget:true, budget:b, long:false };
  const tree = box.SpineCanvas({ scenes, selId:null, onSelect:noop, onReorder:noop, onAddScene:null, follow:null, readOnly:true, staleIds:new Set(),
    runtimes:{ s1:long, s2:fine, s3:rough } });
  const chip = (id)=>{
    const card = find(tree, n=>n.props && n.props.draggable!==undefined && textOf(n).includes("Scene "+id.slice(1)) && /\bscard\b/.test(n.props.className||""))[0];
    assert.ok(card, "card "+id);
    return find(card, n=>/\bscard-rt\b/.test((n.props && n.props.className)||""))[0];
  };
  const c1 = chip("s1"), c2 = chip("s2"), c3 = chip("s3");
  assert.ok(/\bhot\b/.test(c1.props.className) && c1.props["data-long"]==="1" && textOf(c1)==="3:08", c1.props.className+" / "+textOf(c1));
  assert.ok(c1.children.some(n=>n && n.type && n.type.iconName==="alert"), "a warning mark");
  assert.equal(c1.props["aria-label"], "3:08, long for this format");
  assert.ok(!c2.children.some(n=>n && n.type && n.type.iconName==="alert") && c2.props["data-long"]===undefined, "no mark on a scene within budget");
  assert.ok(c1.props.title.startsWith("Long for this format \u2014 about 3:08 against a budget of about 0:17 (a ~2-minute Micro-drama in 7 scenes)."), c1.props.title);
  assert.ok(c1.props.title.includes("Nothing is rewritten automatically"));
  assert.ok(!/\bhot\b/.test(c2.props.className) && textOf(c2)==="0:17" && c2.props.title.includes("budget about 0:17"), textOf(c2)+" "+c2.props.title);
  assert.ok(textOf(c3)==="~0:17" && c3.props.title.includes("this format\u2019s budget per scene"), c3.props.title);
});

const SCENE = mkScenes(7)[1];
const renderScript = (draft, project, scenes)=>box.ScriptView({
  scene:SCENE, beats:BEATS, drafts:{ [SCENE.id]:draft }, scenes:scenes || mkScenes(7), onSelectScene:noop, onDraftOne:noop, onDraftAll:noop,
  onPolish:async ()=>true, drafting:null, total:7, history:{ back:[], fwd:[] }, labelOf:()=>"x", onRevert:noop, onRedo:noop,
  onEditScene:noop, continuityMap:{}, project:project || { title:"Micro", format:"microdrama" }, onBeatFocus:noop, readOnly:false,
  facts:{}, staleChanges:[], staleCount:0 });
const longLine = (tree)=>find(tree, n=>n.props && n.props["data-long"]==="1");

await test("E the Script view: a 'Long for this format' line with both lengths, only when long", ()=>{
  box.aiAvailable = ()=>true;
  const lines = longLine(renderScript(draftOfLines(170)));
  assert.equal(lines.length, 1, "one line");
  const t = textOf(lines[0]);
  assert.ok(t.startsWith("Long for this format: about 3:03 of screen time against a budget of about 0:17 (a ~2-minute Micro-drama in 7 scenes)."), t);
  assert.ok(t.includes("Nothing is rewritten automatically") && t.includes("Redraft script from beats"), t);
  assert.equal(lines[0].props.role, "status");
  assert.equal(longLine(renderScript(draftOfLines(16))).length, 0, "on budget: no line");
  assert.equal(longLine(renderScript(null)).length, 0, "undrafted: no line");
  // the same draft is fine for a Feature scene (150 s budget)
  assert.equal(longLine(renderScript(draftOfLines(170), { format:"feature" }, mkScenes(40))).length, 0, "a Feature's 3-minute scene is within 1.5x");
  // the Script view and the spine read the same numbers
  const info = box.scriptLengthInfo(SCENE, draftOfLines(170), BEATS, { format:"microdrama" }, 7);
  assert.equal(info.long, true); assert.equal(info.sec, 183); assert.ok(Math.abs(info.budget.sec - 120/7) < 1e-9);
  assert.equal(box.scriptLengthInfo(SCENE, null, BEATS, { format:"microdrama" }, 7).long, false);
});

await test("E nothing rewrites on its own: the check makes no model call", ()=>{
  reset();
  renderScript(draftOfLines(170));
  box.sceneLengthCheck(box.sceneRuntime(SCENE, draftOfLines(170), null, box.sceneBudgetFor({ format:"microdrama" }, 7)), box.sceneBudgetFor({ format:"microdrama" }, 7));
  assert.equal(box.__prompts.length, 0, "no prompt was sent");
});

/* ============================ F. MUSE, the doc, the keys ============================ */
await test("F MUSE's product knowledge describes screen time as it behaves, names no vendor", ()=>{
  const what = (name)=>vm.runInContext("(APP_FEATURES.find(f=>f.name===" + JSON.stringify(name) + ")||{}).what||''", box);
  const st = what("Screen time per scene (format runtime budget)");
  assert.ok(st, "the entry exists");
  for(const s of ["SCREEN-TIME BUDGET", "the format's runtime divided by the film's scene count", "Commercial 30 seconds",
    "Micro-drama about 2 minutes per episode (1\u20133)", "Micro Short about 4 minutes (under 5)", "Music Video about 4 minutes",
    "Short Film about 15 minutes (10\u201320)", "TV Series about 30 minutes per episode", "Documentary about 10 minutes", "Feature Film about 100 minutes",
    "2\u20133 beats for Commercial, Micro-drama and Music Video, 3\u20134 for Micro Short, 4\u20136 for every other format",
    "one SCREEN TIME instruction", "A REDRAFT NEVER MAKES A SCENE LONGER", "may not come back longer", "is discarded: the current script stays", "come back shorter",
    "a scene heading or a transition counts nothing", "each 'EXPECTED TESTIMONY' note counts about 15 seconds", "LONG FOR THIS FORMAT", "1.5\u00d7",
    "small warning mark on its scene card", "'Long for this format' line above its script", "no model call and no credits", "NOTHING IS REWRITTEN AUTOMATICALLY"])
    assert.ok(st.includes(s), "mentions: "+s);
  const spine = what("Spine view");
  assert.ok(spine.includes("LONG FOR THIS FORMAT") && !spine.includes("against the film's average"), "the Spine entry lost the average-heat wording");
  assert.ok(spine.includes("in seconds when it's under two minutes"));
  assert.ok(what("Beats tab").includes("sized to the scene's screen-time budget"));
  assert.ok(what("Script view").includes("'Long for this format' line above its script"));
  assert.ok(what("Redraft script from beats").includes("never makes the scene longer: a reply that runs longer than the current script is discarded"));
  assert.ok(what("Draft (one scene)").includes("screen-time budget"));
  const ns = vm.runInContext("APP_FEATURES.find(f=>String(f.name).startsWith('New Story')).what", box);
  assert.ok(ns.includes("Feature Film (about 100 minutes") && ns.includes("Music Video (about 4 minutes") && ns.includes("Commercial (30 seconds)") && ns.includes("Documentary (about 10 minutes)"));
  assert.ok(!/90\+ minutes|30\u201360 seconds|3\u20135 minutes/.test(ns), "no stale runtimes");
  const brief = vm.runInContext("appBrief()", box);
  assert.ok(brief.includes("Screen time per scene (format runtime budget)"), "it reaches MUSE's brief");
  assert.ok(!/claude|anthropic|openai|\bgpt|gemini|opus|sonnet|kimi|mckee/i.test(st), "no vendor or method author named");
});

await test("F the owner's doc still says what this implements (the code follows the doc)", ()=>{
  const doc = read("docs/Story Pipeline.md").replace(/\s+/g, " ").replace(/> /g, "");
  for(const s of ["each scene is written to a screen-time budget — the format's runtime divided by its scene count — and the beat map is sized to it: **2–3 beats** per scene for Commercial, Micro-drama and Music Video, **3–4** for Micro Short, **4–6** for every other format.",
    "Commercial **30 s**, Micro-drama 1–3 min per episode, Micro Short under 5 min, Music Video **4 min**, Short Film 10–20 min, TV episode ~30 min, Documentary **10 min**, Feature Film **100 min**.",
    "spine, beat and scene prompts all state the budget, and a redraft never makes a scene longer.",
    "gets a **free warning** on its card and in the Script view — nothing is rewritten automatically, so no credits are spent on it."])
    assert.ok(doc.includes(s), "doc: "+s);
});

await test("F the files that changed load under a new cache key, script.jsx and ai.jsx together", ()=>{
  const html = read("TURN.html");
  const key = (f)=>(html.match(new RegExp(f.replace(/\./g, "\\.")+"\\?v=([^\"']+)")) || [])[1] || "";
  assert.equal(key("app/script.jsx"), key("app/ai.jsx"), "script.jsx and ai.jsx share a key");
  // this change's key — or a LATER change's (the page-forms fix re-keyed formats.jsx, script.jsx
  // and ai.jsx; never back to a pre-change key; the Round 1 fixes of 2026-09-28 re-keyed spine.jsx,
  // script.jsx, ai.jsx and app.jsx together)
  const LATER = ["20260927-pageforms1", "20260927-review1", "20260928-dock2", "20260928-round1", "20260928-brand1", "20260928-brand2", "20260929-look1", "20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-consent1", "20261002-tip1", "20261002-btn1", "20261002-team1", "20261002-scene1", "20261002-research1", "20261002-research2", "20261002-artlive1", "20261002-artundo1", "20261002-stagefilm1", "20261002-attrib1", "20261002-planpick2", "20261002-planpick3", "20261002-trialwelcome1", "20261003-room1", "20261003-login1", "20261003-login2", "20261003-team2", "20261003-team3", "20261003-team4", "20261003-team5", "20261003-team6", "20261003-team7", "20261003-team8", "20261003-lookbook1", "20261003-cast1", "20261004-props1", "20261004-locs1", "20261004-color1", "20261004-shots1", "20261005-sb1", "20261005-bd1", "20261005-comma1", "20261005-stage1", "20261005-stage2", "20261005-prompts1", "20261005-lbshots1", "20261005-color2", "20261005-shots2", "20261005-sb2", "20261005-bd2", "20261006-lb2", "20261006-chars2", "20261008-props2", "20261008-locs2", "20261008-color3", "20261009-shots3", "20261009-sb3", "20261009-bd3", "20261009-stage3", "20261009-tl3", "20261009-mix3", "20261009-wr3", "20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"];   // Manage plan (2026-09-30) re-keyed ai.jsx, with script.jsx on its key (billing fixes 2026-09-30: ai.jsx and script.jsx; consumer rights + tax 2026-10-01: ai.jsx and script.jsx; the 14-day note 2026-10-02: ai.jsx and script.jsx; the note behind an ⓘ 2026-10-02: ai.jsx and script.jsx; Team "Coming soon" 2026-10-02: ai.jsx, script.jsx and app.jsx)
  for(const f of ["app/formats.jsx", "app/spine.jsx", "app/script.jsx", "app/ai.jsx", "app/app.jsx"])
    assert.ok(key(f)==="20260927-screentime1" || LATER.includes(key(f)), f+" re-keyed: "+key(f));
  // formats.jsx and spine.jsx load before the files that read their helpers
  const at = (f)=>html.indexOf('src="'+f+'?v=');
  assert.ok(at("app/formats.jsx") < at("app/spine.jsx") && at("app/spine.jsx") < at("app/script.jsx") && at("app/script.jsx") < at("app/ai.jsx") && at("app/ai.jsx") < at("app/app.jsx"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/* Rough stand-in drafts (docs/Story Pipeline.md step 7, owner-approved 2026-09-27).

   Incident (Short Film, 2026-09-27): Sc 14's redraft was rejected and nothing was saved, so
   the scene stayed the build's structural stand-in: five paragraphs of beat-card text that
   read like finished prose. The Script view showed no sign of it and the Script check showed
   green. The doc now says a stand-in "is marked as such in the Script view (the Script check
   does not show it as clean), and keeps that mark until MUSE writes the scene", and
   Adaptation's "finish just the unwritten scenes" includes "any scene left as a rough
   stand-in".

   This runs the REAL app files (formats, frameworks, contract, scene-order, spine, script,
   ai, agents, locations, story-data) in node:vm with a stubbed window.claude.complete that
   replays canned replies (no network), plus the REAL handlers extracted from script.jsx
   (commitEdit / removeBlock / insertBlock / writeMissingBeat) and app.jsx (commitVersion /
   revertVersion / rememberRejection / polishScene). It proves:
     A. which drafts are stand-ins: the structural draft and a drafter fallback are; a
        MUSE draft, an edited MUSE draft and the sample film's drafts are not;
     B. the Script check warns on a stand-in (never green) and is clean on the same blocks
        written by MUSE; the report names it "Rough stand-in";
     C. the Script view shows a plain "Rough stand-in" line with a one-line hint to redraft,
        and only on a stand-in;
     D. small manual edits and writing one missing beat keep the mark; a successful
        redraft clears it (a rejected one leaves it); Undo back brings it back;
     E. Adaptation's "Finish writing this film first?" offers stand-ins (labelled) with the
        blank scenes, writes them from their existing beats, leaves written scenes alone,
        and a stand-in that fails again is offered again next run — also with agents.jsx
        loaded alone (its fallback), and a sensitivity check that the old filter fails;
     F. MUSE's product knowledge (APP_FEATURES) describes all of this, names no vendor, and
        the doc still carries the sentence the code implements; the cache keys moved.
   node scripts/test-standin.mjs */
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
// a tiny element tree, so ScriptView / ScriptCheckReport can be rendered one level deep
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const ReactStub = new Proxy({
  createElement:h, Fragment:"frag",
  useState:(x)=>[typeof x==="function" ? x() : x, noop], useRef:(x)=>({ current:x }), useEffect:noop,
  useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f, memo:(f)=>f, forwardRef:(f)=>f,
  createContext:()=>({ Provider:"provider" }), useContext:()=>null,
}, { get:(t,k)=> (k in t) ? t[k] : noop });
const makeBox = ()=>{
  const box = {
    console, clearTimeout, setInterval, clearInterval,
    setTimeout:(f)=>setTimeout(f, 0),            // the build's retry breathers run instantly
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
  box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
  box.appConfirm = async ()=>true;
  // installed BEFORE ai.jsx, so its proxy shim is skipped
  box.claude = { complete: async ()=>{ const r = box.__replies.shift(); if(r instanceof Error) throw r; return r == null ? "" : r; } };
  vm.createContext(box);
  return box;
};
const box = makeBox();
// script.jsx runs as the app ships it: Babel lowers const/let to var in the browser (and the
// dist build does the same with this plugin), so ScriptView's header may name a button that is
// declared further down without a TDZ error
const asShipped = (f)=>transformSync(read(f), { plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename:f }).code;
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx",
  "app/spine.jsx","app/script.jsx","app/ai.jsx","app/agents.jsx","app/locations.jsx"])
  vm.runInContext(f==="app/script.jsx" ? asShipped(f) : read(f), box, { filename:f });
box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
box.console = { ...console, warn:noop, info:noop };
const reset = ()=>{ box.__replies = []; box.__toasts = []; box.turnCast = undefined; box.turnIsAdmin = false; };
const plain = (x)=>JSON.parse(JSON.stringify(x));

/* ---------------- fixtures ---------------- */
const SCENE = { id:"s14", no:14, act:2, title:"Tape Measure Pocketed", loc:"INT. MACHIYA WORKSHOP - DAY", driver:"isamu",
  summary:"Isamu pockets the tape measure before the client arrives.", objective:"", openValue:"Trust", openCharge:1, closeValue:"Suspicion", closeCharge:-1 };
// beat cards written as full prose paragraphs, like the incident's — the stand-in reads finished
const BEATS = { driverLabel:"Isamu", reactorLabel:"Hana", turnAt:2, rows:[
  { n:1, drive:{ a:"Arrives early", d:"Isamu steps up to the lattice door ahead of schedule, rain beading on his collar." },
         react:{ a:"Watches", d:"Hana watches him from the bench and says nothing, her hands still on the plane." } },
  { n:2, drive:{ a:"Pockets", d:"He slides the tape measure off the bench and into his coat while she turns away." },
         react:{ a:"Notices", d:"Hana sees the empty hook and sets the plane down very carefully." } },
]};
const CAST = [{ id:"isamu", name:"Isamu" }, { id:"hana", name:"Hana" }];
// a MUSE reply the screenplay check accepts: every beat, CAPS introductions, cue + dialogue
const GOOD_REPLY = JSON.stringify({ beats:[
  { n:1, blocks:[{ type:"action", text:"ISAMU (50s), rain on his collar, slides the lattice door open ahead of schedule." },
                 { type:"action", text:"HANA (30s) keeps planing. She does not look up." },
                 { type:"char", text:"HANA" }, { type:"dia", text:"You're early." }] },
  { n:2, blocks:[{ type:"action", text:"Isamu lifts the tape measure from its hook and pockets it." },
                 { type:"action", text:"Hana stops. She lays the plane down, very carefully." }] },
]});
const standIn = ()=>box.autoDraftScene(SCENE, BEATS, null);
const museDraft = ()=>({ blocks:plain(standIn().blocks), ai:true, auto:false, by:{ model:"Writing model", at:1 } });

/* ---------------- a minimal element-tree reader ---------------- */
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n) : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const find = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const renderScript = (draft, over)=>box.ScriptView({
  scene:SCENE, beats:BEATS, drafts:{ [SCENE.id]:draft }, scenes:[SCENE], onSelectScene:noop, onDraftOne:noop, onDraftAll:noop,
  onPolish:async ()=>true, drafting:null, total:1, history:{ back:[], fwd:[] }, labelOf:()=>"x", onRevert:noop, onRedo:noop,
  onEditScene:noop, continuityMap:{}, project:{ title:"Short Film", format:"short" }, onBeatFocus:noop, readOnly:false,
  facts:{}, staleChanges:[], staleCount:0, ...(over||{}) });
const standInLine = (tree)=>find(tree, n=>n.props && n.props["data-standin"]==="1");
const scriptCheckBtn = (tree)=>find(tree, n=>n.type==="button" && /Script check/.test(textOf(n)))[0];

/* ---------------- handler extraction (the same technique as test-screenplay-validator) ---------------- */
const appSrc = read("app/app.jsx"), scriptSrc = read("app/script.jsx");
const fnSrc = (src, name, indent)=>{
  const start = src.indexOf("\n"+indent+"const "+name+" = ");
  assert.ok(start>=0, "found "+name);
  const end = src.indexOf("\n"+indent+"};", start);
  return src.slice(start+1, end+indent.length+3);
};

/* ============================ A. what is a stand-in ============================ */
await test("A the structural draft and the drafter's fallback are stand-ins; MUSE's drafts and the sample film are not", async ()=>{
  assert.equal(typeof box.isStandInDraft, "function");
  assert.equal(box.isStandInDraft(standIn()), true, "autoDraftScene output");
  reset(); box.__replies = ["not a screenplay"];
  const fell = await box.aiDraftScene(SCENE, BEATS, null, { format:"short" }, CAST, [SCENE]);
  assert.equal(fell.auto, true, "the drafter fell back");
  assert.equal(box.isStandInDraft(fell), true, "the drafter's fallback is a stand-in");
  reset(); box.__replies = [GOOD_REPLY];
  const real = await box.aiDraftScene(SCENE, BEATS, null, { format:"short" }, CAST, [SCENE]);
  assert.equal(real.ai, true, "the canned reply is accepted: "+JSON.stringify(real).slice(0,200));
  assert.equal(box.isStandInDraft(real), false, "a MUSE draft is not");
  assert.equal(box.isStandInDraft({ ...real, blocks:real.blocks.slice(1), edited:true, ai:false, auto:false, by:null }), false, "an edited MUSE draft is not");
  assert.equal(box.isStandInDraft({ blocks:[{ beat:1, type:"action", text:"x" }] }), false, "an unflagged original draft is not");
  assert.equal(box.isStandInDraft({ auto:true, blocks:[] }), false, "no blocks, nothing to mark");
  assert.equal(box.isStandInDraft(null), false);
  assert.equal(box.isStandInDraft({ ...standIn(), standIn:true, auto:false, edited:true, ai:false, by:null }), true, "an edited stand-in keeps the mark");
  const sample = box.TURN_DATA.SCREENPLAY;
  assert.ok(Object.keys(sample).length > 3, "the sample film has drafts");
  assert.ok(Object.values(sample).every(d=>!box.isStandInDraft(d)), "no sample-film scene is marked");
});

/* ============================ B. the Script check ============================ */
await test("B the Script check warns on a stand-in (never green) and is clean on the same blocks written by MUSE", ()=>{
  const muse = box.screenplayFormatReport(SCENE, museDraft(), BEATS);
  assert.equal(muse.issues.length, 0, "the blocks themselves are well formed (the incident: 0 issues, green): "+JSON.stringify(muse.issues));
  const rep = box.screenplayFormatReport(SCENE, standIn(), BEATS);
  const si = rep.issues.filter(x=>x.code==="stand-in");
  assert.equal(si.length, 1);
  assert.equal(si[0].severity, "warn", "a warning: counted on the button");
  assert.equal(rep.issues[0].code, "stand-in", "listed first");
  assert.equal(si[0].blockIndex, 0, "Go to top lands on the heading");
  assert.ok(/rough stand-in built from its beat cards/.test(si[0].message) && /Redraft script from beats/.test(si[0].message), si[0].message);
  assert.equal(rep.stats.warnings, 1); assert.equal(rep.stats.errors, 0);
  const edited = box.screenplayFormatReport(SCENE, { ...standIn(), standIn:true, auto:false, edited:true, ai:false, by:null }, BEATS);
  assert.ok(edited.issues.some(x=>x.code==="stand-in"), "an edited stand-in still warns");
  // the "Missing:" status line is about screenplay elements and is unaffected
  assert.deepEqual(plain(box.sceneMissing(SCENE, { [SCENE.id]:standIn() })), []);
});

await test("B the Script check button and report: 'Script check · 1' in warn, a 'Rough stand-in' row, no 'clean' line", ()=>{
  const btn = scriptCheckBtn(renderScript(standIn()));
  assert.ok(btn, "the Script check button renders");
  assert.ok(/\bwarn\b/.test(btn.props.className) && !/\bok\b/.test(btn.props.className), btn.props.className);
  assert.equal(textOf(btn), "Script check · 1");
  const okBtn = scriptCheckBtn(renderScript(museDraft()));
  assert.ok(/\bok\b/.test(okBtn.props.className) && textOf(okBtn)==="Script check", "a MUSE draft stays green: "+okBtn.props.className);
  const report = box.ScriptCheckReport({ scene:SCENE, report:box.screenplayFormatReport(SCENE, standIn(), BEATS), onClose:noop, onIssue:noop });
  const t = textOf(report);
  assert.ok(t.includes("Rough stand-in") && t.includes("Whole scene · Go to top") && t.includes("1 warning"), t);
  assert.ok(!t.includes("structurally clean"), "never shown as clean");
  assert.ok(!t.includes("Format note"), "named for what it is, not a format note");
});

/* ============================ C. the Script view marker ============================ */
await test("C the Script view shows a plain 'Rough stand-in' line with a one-line hint, only on a stand-in", ()=>{
  box.aiAvailable = ()=>true;
  const lines = standInLine(renderScript(standIn()));
  assert.equal(lines.length, 1, "one marker");
  const t = textOf(lines[0]);
  assert.ok(t.startsWith("Rough stand-in: "), t);
  assert.ok(/built from the beat cards/.test(t) && /this scene hasn’t been written yet/.test(t), t);
  // (rebrand 2026-09-28) the writing actions carry no persona: no assistant name on the marker
  assert.ok(!/MUSE|Frances/.test(t), t);
  assert.ok(/Press Redraft script from beats to write it\.$/.test(t), "the hint names the button: "+t);
  assert.equal(lines[0].props.role, "status");
  assert.equal(standInLine(renderScript(museDraft())).length, 0, "no marker on a MUSE draft");
  assert.equal(standInLine(renderScript({ ...museDraft(), edited:true, ai:false, auto:false, by:null })).length, 0, "none on an edited MUSE draft");
  assert.equal(standInLine(renderScript({ ...standIn(), standIn:true, auto:false, edited:true, ai:false, by:null })).length, 1, "kept on an edited stand-in");
  box.aiAvailable = ()=>false;
  const off = textOf(standInLine(renderScript(standIn()))[0]);
  assert.ok(/Once a writing model is available, Redraft script from beats writes it\./.test(off), "offline hint: "+off);
  box.aiAvailable = ()=>true;
  // it sits ABOVE the script, with the other status rows, not inside the toolbar
  const tree = renderScript(standIn());
  const top = tree.children.map(c=>c && c.props && c.props["data-standin"]);
  assert.ok(top.includes("1"), "a direct row of the Script view");
});

/* ============================ D. the mark's lifecycle ============================ */
const makeEditors = (screenplay, over)=>{
  const committed = [];
  const env = { onEditScene:(id, d)=>committed.push({ id, d }), screenplay, scene:SCENE, beats:BEATS, prevScene:null, project:{ format:"short" },
    readOnly:false, beatWriting:null, live:true, setBeatWriting:noop, setVerFlash:noop, verFlashTimer:{ current:null },
    aiWriteBeatText:async ()=>({ blocks:[{ beat:2, type:"action", text:"Hana stops." }], by:{ model:"Writing model" } }), ...(over||{}) };
  const names = Object.keys(env), fns = ["commitEdit","removeBlock","insertBlock","writeMissingBeat"];
  const body = fns.map(n=>fnSrc(scriptSrc, n, "    ")).join("\n");
  const made = vm.runInContext("(function("+names.join(",")+"){\n"+body+"\n return { "+fns.join(", ")+" }; })", box)(...names.map(n=>env[n]));
  return { ...made, committed };
};
await test("D small manual edits and writing one missing beat keep the mark; on a MUSE draft they add none", async ()=>{
  const sp = standIn();
  const ed = makeEditors(sp);
  ed.commitEdit(sp.blocks[1], "Isamu steps up to the lattice door early.");
  ed.removeBlock(sp.blocks[2]);
  ed.insertBlock(1, "action");
  await ed.writeMissingBeat(2);
  assert.equal(ed.committed.length, 4);
  ed.committed.forEach(({ d }, i)=>{
    assert.equal(d.standIn, true, "edit "+i+" carries standIn");
    assert.equal(box.isStandInDraft(d), true, "edit "+i+" is still a stand-in");
  });
  assert.equal(ed.committed[0].d.edited, true); assert.equal(ed.committed[0].d.auto, false, "the version itself is a manual edit");
  assert.equal(ed.committed[3].d.ai, true, "a written beat is MUSE's, but the scene is still the beat cards");
  // an edit of an edited stand-in keeps it (the mark rides through any number of edits)
  const again = makeEditors(ed.committed[0].d);
  again.commitEdit(ed.committed[0].d.blocks[1], "Isamu steps in.");
  assert.equal(box.isStandInDraft(again.committed[0].d), true);
  // a MUSE draft edited by hand is not turned into a stand-in
  const md = museDraft();
  const me = makeEditors(md);
  me.commitEdit(md.blocks[1], "Changed.");
  await me.writeMissingBeat(2);
  me.committed.forEach(({ d })=>{ assert.ok(!("standIn" in d), "no mark added"); assert.equal(box.isStandInDraft(d), false); });
});

const makeApp = (initial)=>{
  const st = { drafts:{ [SCENE.id]:initial }, history:{} };
  const env = {
    canMutateWritersRoom:()=>true, setPolishBusy:noop, scenesInStoryOrder:(x)=>x.slice(), scenes:[SCENE],
    autoDraftScene:box.autoDraftScene, aiPolishScene:box.aiPolishScene, project:{ title:"Short Film", format:"short" },
    currentProjectId:"p1", polishRetryRef:{ current:{} }, lastPolishFailureRef:{ current:null },
    stampDraft:(d)=>d, HISTORY_MAX:12,
    get drafts(){ return st.drafts; }, get history(){ return st.history; },
    setDrafts:(f)=>{ st.drafts = typeof f==="function" ? f(st.drafts) : f; },
    setHistory:(f)=>{ st.history = typeof f==="function" ? f(st.history) : f; },
  };
  const fns = ["commitVersion","revertVersion","rememberRejection","polishScene"];
  // commitVersion / revertVersion read `drafts` / `history` at call time from the closure,
  // so they are rebuilt per call to see the current state (as React re-renders would)
  const build = ()=>{
    const names = Object.keys(env).filter(n=>n!=="drafts" && n!=="history").concat(["drafts","history"]);
    const body = fns.map(n=>fnSrc(appSrc, n, "  ")).join("\n");
    return vm.runInContext("(function("+names.join(",")+"){\n"+body+"\n return { "+fns.join(", ")+" }; })", box)(...names.map(n=>env[n]));
  };
  return { st, build, lastFail:()=>env.lastPolishFailureRef.current };
};
await test("D a successful Redraft clears the mark; a rejected one leaves it; Undo back brings it back", async ()=>{
  const edited = { ...standIn(), standIn:true, auto:false, edited:true, ai:false, by:null };
  const app = makeApp(edited);
  reset(); box.turnCast = CAST; box.__replies = ["{\"beats\":[]}"];
  assert.equal(await app.build().polishScene(SCENE, BEATS), false, "the rejected redraft is not committed");
  assert.equal(app.st.drafts[SCENE.id], edited, "the draft is unchanged");
  assert.equal(box.isStandInDraft(app.st.drafts[SCENE.id]), true, "and still marked");
  assert.ok(box.__toasts.some(x=>/Couldn’t redraft Scene 14/.test(x.m)), "the rejection is not silent");
  reset(); box.turnCast = CAST; box.__replies = [GOOD_REPLY];
  const okRun = await app.build().polishScene(SCENE, BEATS);
  assert.equal(okRun, true, "the redraft commits: "+JSON.stringify(box.__toasts)+" "+JSON.stringify(app.lastFail()));
  const now = app.st.drafts[SCENE.id];
  assert.equal(now.ai, true); assert.equal(now.polished, true);
  assert.ok(!("standIn" in now), "MUSE's draft replaces the whole object, mark and all");
  assert.equal(box.isStandInDraft(now), false, "the mark is cleared");
  assert.equal(box.screenplayFormatReport(SCENE, now, BEATS).issues.filter(x=>x.code==="stand-in").length, 0, "the Script check drops the warning");
  assert.equal(app.st.history[SCENE.id].back[0], edited, "the stand-in is in version history");
  app.build().revertVersion(SCENE.id);
  assert.equal(box.isStandInDraft(app.st.drafts[SCENE.id]), true, "Undo back to the stand-in brings the mark back");
});

/* ============================ E. Adaptation: finish just the unwritten scenes ============================ */
const W = (no, id)=>({ id, no, title:id.toUpperCase(), loc:"INT. ROOM - DAY", summary:"s", driver:"isamu" });
const runFinish = async (b, model, over)=>{
  const trace = [], proposals = [], drafted = [], authored = [];
  const ctx = {
    input:"", project:{ title:"Short Film", format:"short" }, model,
    ai:{ available:true,
      authorScene:async (s)=>{ authored.push(s.id); return { patch:{}, beats:{ rows:[{ n:1, drive:{ a:"a", d:"a" }, react:{ a:"r", d:"r" } }] } }; },
      draftScene:async (s)=>{ drafted.push(s.id); return (over && over.draft) ? over.draft(s) : { blocks:[{ beat:1, type:"scene", text:s.loc }, { beat:1, type:"action", text:"Written." }], ai:true, auto:false, by:{ model:"Writing model" } }; },
      continuityLedger:async ()=>({ map:{}, facts:{}, ledger:{} }) },
    propose:async (p)=>{ proposals.push(p); return true; }, emit:(e)=>trace.push(e), sync:noop, cancelled:()=>false,
  };
  await b.agentAdaptation(ctx);
  return { trace, proposals, drafted, authored, ctx };
};
const mixedModel = ()=>{
  const bm = { rows:[{ n:1, drive:{ a:"a", d:"Card one." }, react:{ a:"r", d:"Card two." } }] };
  const muse = { blocks:[{ beat:1, type:"scene", text:"INT. ROOM - DAY" }, { beat:1, type:"action", text:"Real prose." }], ai:true, auto:false, by:{ model:"m" } };
  const editedMuse = { ...muse, edited:true, ai:false, auto:false, by:null };
  const si = box.autoDraftScene(W(2,"b"), bm, null);
  const editedSi = { ...box.autoDraftScene(W(3,"c"), bm, null), standIn:true, auto:false, edited:true, ai:false, by:null };
  return { scenes:[W(1,"a"), W(2,"b"), W(3,"c"), W(4,"d"), W(5,"e")],
    beats:{ a:bm, b:bm, c:bm, e:bm }, drafts:{ a:muse, b:si, c:editedSi, e:editedMuse }, characters:[], project:{} };
};
await test("E the finish offer lists stand-ins (labelled) with the blank scenes, and writes only those", async ()=>{
  const model = mixedModel(), a0 = model.drafts.a, e0 = model.drafts.e, bBeats = model.beats.b;
  const r = await runFinish(box, model);
  assert.equal(r.proposals.length, 1);
  const p = r.proposals[0];
  assert.equal(p.title, "Finish writing this film first?");
  assert.deepEqual(plain(p.list), ["Sc 2 · B (rough stand-in)", "Sc 3 · C (rough stand-in)", "Sc 4 · D"]);
  assert.ok(p.reason.startsWith("3 of 5 scenes aren’t written yet: 1 has no screenplay and 2 are rough stand-ins built from the beat cards."), p.reason);
  assert.ok(/written from the beat cards it already has/.test(p.reason) && /Undo agent changes brings it back/.test(p.reason), p.reason);
  assert.ok(/everything already written stays untouched/.test(p.reason));
  assert.deepEqual(r.drafted, ["b","c","d"], "only the unwritten scenes are drafted");
  assert.deepEqual(r.authored, ["d"], "stand-ins keep their beat cards; only the beat-less scene is authored");
  assert.equal(model.beats.b, bBeats, "the stand-in's beat cards are not replaced");
  ["b","c","d"].forEach(id=>{ assert.equal(box.isStandInDraft(model.drafts[id]), false, id+" is written now"); assert.equal(model.drafts[id].ai, true); });
  assert.equal(model.drafts.a, a0, "a MUSE draft is untouched");
  assert.equal(model.drafts.e, e0, "an edited MUSE draft is untouched (it is not a stand-in)");
  const done = r.trace.filter(e=>e.k==="done");
  assert.equal(done.length, 1);
  assert.equal(done[0].t, "All 5 scenes now have beats and screenplay. Open the Script view to read the film.");
});

await test("E the offer's wording: only stand-ins, one stand-in, and the unchanged blank-only case", async ()=>{
  const bm = { rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] };
  const muse = { blocks:[{ beat:1, type:"action", text:"x" }], ai:true, by:{ model:"m" } };
  const one = await runFinish(box, { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm, b:bm }, drafts:{ a:muse, b:box.autoDraftScene(W(2,"b"), bm, null) }, characters:[], project:{} });
  assert.ok(one.proposals[0].reason.startsWith("1 of 2 scenes is still a rough stand-in built from the beat cards \u2014 not written yet. Approve"), one.proposals[0].reason);
  const two = await runFinish(box, { scenes:[W(1,"a"), W(2,"b"), W(3,"c")], beats:{ a:bm, b:bm, c:bm },
    drafts:{ a:muse, b:box.autoDraftScene(W(2,"b"), bm, null), c:box.autoDraftScene(W(3,"c"), bm, null) }, characters:[], project:{} });
  assert.ok(two.proposals[0].reason.startsWith("2 of 3 scenes are still a rough stand-in"), two.proposals[0].reason);
  const blank = await runFinish(box, { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm }, drafts:{ a:muse }, characters:[], project:{} });
  assert.ok(blank.proposals[0].reason.startsWith("1 of 2 scenes have no screenplay yet. Approve to write beats + script for JUST those scenes \u2014 everything"), "the blank-only offer reads as before: "+blank.proposals[0].reason);
  assert.deepEqual(plain(blank.proposals[0].list), ["Sc 2 · B"]);
  // a fully written film gets no offer at all
  const full = await runFinish(box, { scenes:[W(1,"a")], beats:{ a:bm }, drafts:{ a:muse }, characters:[], project:{} });
  assert.ok(!full.proposals.some(p=>p.title==="Finish writing this film first?"), "no finish offer on a written film");
});

await test("E a stand-in that fails again is reported and offered again on the next run", async ()=>{
  const bm = { rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] };
  const muse = { blocks:[{ beat:1, type:"action", text:"x" }], ai:true, by:{ model:"m" } };
  const model = { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm, b:bm }, drafts:{ a:muse, b:box.autoDraftScene(W(2,"b"), bm, null) }, characters:[], project:{} };
  const again = (s)=>box.autoDraftScene(s, bm, null);
  const r1 = await runFinish(box, model, { draft:again });
  assert.ok(r1.drafted.length >= 2, "the build retried it: "+r1.drafted.length);
  assert.ok(r1.trace.some(e=>e.k==="flag" && /Sc 2 .*rough structural draft stands in/.test(e.t)), "reported by number with the reason");
  assert.ok(/still failed even after automatic retries/.test(r1.trace.filter(e=>e.k==="done")[0].t), "the finish summary is honest");
  assert.equal(box.isStandInDraft(model.drafts.b), true, "it is still a stand-in");
  const r2 = await runFinish(box, model);
  assert.deepEqual(plain(r2.proposals[0].list), ["Sc 2 · B (rough stand-in)"], "…so 'run again later to retry just those' finds it");
  assert.equal(box.isStandInDraft(model.drafts.b), false, "and this time it is written");
});

await test("E (review) a HAND-EDITED stand-in whose rewrite fails again is kept exactly as the user left it", async ()=>{
  const bm = { rows:[{ n:1, drive:{ a:"a", d:"Card one." }, react:{ a:"r", d:"Card two." } }] };
  const muse = { blocks:[{ beat:1, type:"action", text:"x" }], ai:true, by:{ model:"m" } };
  const base = box.autoDraftScene(W(2,"b"), bm, null);
  const edited = box.keepStandInMark(base, { ...base, blocks:[...base.blocks, { beat:1, type:"char", text:"ISAMU" }, { beat:1, type:"dia", text:"My own line." }],
    edited:true, polished:false, ai:false, auto:false, by:null });
  const model = { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm, b:bm }, drafts:{ a:muse, b:edited }, characters:[], project:{} };
  const r = await runFinish(box, model, { draft:(sc)=>box.autoDraftScene(sc, bm, null) });
  assert.ok(r.drafted.length >= 2, "it was retried: "+r.drafted.length);
  assert.equal(model.drafts.b, edited, "the edited stand-in object is untouched");
  assert.ok(model.drafts.b.blocks.some(b=>b.text==="My own line."), "the hand-written line is kept");
  assert.equal(box.isStandInDraft(model.drafts.b), true, "and it is still marked");
  // sensitivity: overwriting on a failed attempt (the old code) loses the line
  const src = read("app/agents.jsx");
  const fixed = "if(res && !(standIn && heldStandIn)) ctx.model.drafts[scn.id]";
  assert.ok(src.includes(fixed));
  const b2 = makeBox();
  for(const f of ["app/script.jsx"]) vm.runInContext(asShipped(f), b2, { filename:f });
  vm.runInContext(src.replace(fixed, "if(res) ctx.model.drafts[scn.id]"), b2, { filename:"app/agents.jsx(old)" });
  const m2 = { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm, b:bm }, drafts:{ a:muse, b:edited }, characters:[], project:{} };
  await runFinish(b2, m2, { draft:(sc)=>box.autoDraftScene(sc, bm, null) });
  assert.ok(!m2.drafts.b.blocks.some(b=>b.text==="My own line."), "the harness sees the old overwrite");
});

await test("E (review) counts are honest: a stand-in that failed again is never 'finished' or 'written'", async ()=>{
  const bm = { rows:[{ n:1, drive:{ a:"a", d:"d" }, react:{ a:"r", d:"r" } }] };
  const muse = { blocks:[{ beat:1, type:"action", text:"x" }], ai:true, by:{ model:"m" } };
  const si = (id)=>box.autoDraftScene(W(2,id), bm, null);
  // every stand-in fails again
  const one = await runFinish(box, { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm, b:bm }, drafts:{ a:muse, b:si("b") }, characters:[], project:{} },
    { draft:(sc)=>box.autoDraftScene(sc, bm, null) });
  const done1 = one.trace.filter(e=>e.k==="done")[0].t;
  assert.ok(done1.startsWith("No scene was finished this time \u2014 1 still failed even after automatic retries"), done1);
  assert.ok(!/Finished 1 scene/.test(done1));
  // one written, one failed again
  const two = await runFinish(box, { scenes:[W(1,"a"), W(2,"b"), W(3,"c")], beats:{ a:bm, b:bm, c:bm }, drafts:{ a:muse, b:si("b"), c:si("c") }, characters:[], project:{} },
    { draft:(sc)=> sc.id==="c" ? box.autoDraftScene(sc, bm, null) : { blocks:[{ beat:1, type:"action", text:"Written." }], ai:true, auto:false, by:{ model:"m" } } });
  const done2 = two.trace.filter(e=>e.k==="done")[0].t;
  assert.ok(done2.startsWith("Finished 1 scene \u2014 1 still failed even after automatic retries"), done2);
  // writeScenesSeq's own count: a real script counts, a stand-in doesn't (the build's "Wrote N of M")
  const model = { scenes:[W(1,"a"), W(2,"b")], beats:{ a:bm, b:bm }, drafts:{}, characters:[], project:{} };
  const ctx = { model, ai:{ available:true, authorScene:async ()=>null,
      draftScene:async (sc)=> sc.id==="b" ? box.autoDraftScene(sc, bm, null) : { blocks:[{ beat:1, type:"action", text:"Written." }], ai:true, auto:false, by:{ model:"m" } } },
    emit:noop, sync:noop, cancelled:()=>false };
  const r = await box.writeScenesSeq(ctx, [0, 1]);
  assert.equal(r.written, 1, "Wrote 1 of 2 — the stand-in is reported, not counted");
  assert.equal(r.failures.length, 1);
});

await test("E agents.jsx alone (no script.jsx) still offers stand-ins, through the same rule", async ()=>{
  const b = makeBox();
  vm.runInContext(read("app/agents.jsx"), b, { filename:"app/agents.jsx" });
  assert.equal(typeof b.isStandInDraft, "undefined", "the fallback path is the one under test");
  const r = await runFinish(b, mixedModel());
  assert.deepEqual(plain(r.proposals[0].list), ["Sc 2 · B (rough stand-in)", "Sc 3 · C (rough stand-in)", "Sc 4 · D"]);
});

await test("E sensitivity: with the old 'any draft with blocks is written' filter, the stand-ins are not offered", async ()=>{
  const src = read("app/agents.jsx");
  const fixed = "return !(d && (d.blocks||[]).length) || isStandIn(d); });";
  assert.ok(src.includes(fixed));
  const b = makeBox();
  vm.runInContext(src.replace(fixed, "return !(d && (d.blocks||[]).length); });"), b, { filename:"app/agents.jsx(old)" });
  const r = await runFinish(b, mixedModel());
  assert.deepEqual(plain(r.proposals[0].list), ["Sc 4 · D"], "the harness sees the regression");
});

/* ============================ F. MUSE, the doc, the cache keys ============================ */
await test("F MUSE's product knowledge describes stand-ins as they behave, names no vendor", ()=>{
  const what = (name)=>vm.runInContext("(APP_FEATURES.find(f=>f.name===" + JSON.stringify(name) + ")||{}).what||''", box);
  const si = what("Rough stand-in drafts (Script view)");
  assert.ok(si, "the entry exists");
  for(const s of ["ROUGH STAND-IN built straight from the scene's beat cards", "MARKED IN THE SCRIPT VIEW", "'Rough stand-in' line",
    "NEVER GREEN IN THE SCRIPT CHECK", "'Rough stand-in' warning", "THE MARK STAYS UNTIL THE SCENE IS WRITTEN",
    "small manual edits", "writing a single missing beat keep it", "a successful Redraft script from beats", "clears it",
    "Undo back to the stand-in brings the mark back", "'Finish writing this film first?'", "'(rough stand-in)'", "from the beat cards it already has"])
    assert.ok(si.includes(s), "mentions: "+s);
  const ri = vm.runInContext("APP_FEATURES.find(f=>String(f.name).startsWith(\"Writers' Room run integrity\")).what", box);
  assert.ok(ri.includes("FINISHING INCLUDES STAND-INS"));
  const sf = vm.runInContext("APP_FEATURES.find(f=>String(f.name).startsWith('Screenplay format check')).what", box);
  assert.ok(sf.includes("A ROUGH STAND-IN") && sf.includes("never shown as clean"));
  assert.ok(!/account is the problem|credit|billing|provider/i.test(sf), "the format-check entry stays free of billing detail");
  assert.ok(what("Redraft script from beats").includes("clears its 'Rough stand-in' mark"));
  assert.ok(what("Script view").includes("'Rough stand-in' line above its script"));
  const brief = vm.runInContext("appBrief()", box);
  assert.ok(brief.includes("Rough stand-in drafts (Script view)"), "it reaches MUSE's brief");
  const all = [si, ri.slice(ri.indexOf("FINISHING INCLUDES")), sf.slice(sf.indexOf("A ROUGH STAND-IN"))].join(" ");
  assert.ok(!/claude|anthropic|openai|\bgpt|gemini|opus|sonnet|kimi|mckee/i.test(all), "no vendor or method author named");
});

await test("F the owner's doc still says what this implements (the code follows the doc)", ()=>{
  const doc = read("docs/Story Pipeline.md").replace(/\s+/g, " ").replace(/> /g, "");
  for(const s of ["just the unwritten scenes** on the next run rather than rebuilding everything — including any scene left as a **rough stand-in**",
    "is marked as such in the Script view (the Script check does not show it as clean), and keeps that mark until the AI writes the scene"])
    assert.ok(doc.includes(s), "doc: "+s);
});

await test("F the files that changed load under a new cache key, script.jsx and ai.jsx together", ()=>{
  const html = read("TURN.html");
  const key = (f)=>(html.match(new RegExp(f.replace(/\./g, "\\.")+"\\?v=([^\"']+)")) || [])[1] || "";
  assert.equal(key("app/script.jsx"), key("app/ai.jsx"), "script.jsx and ai.jsx share a key");
  for(const f of ["app/script.jsx", "app/ai.jsx", "app/agents.jsx"]){
    const k = key(f);
    assert.ok(k && k.slice(0,8)>="20260927" && !["20260927-epbuild1", "20260927-spcheck4", "20260927-spcheck2"].includes(k), f+" re-keyed: "+k);
  }
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

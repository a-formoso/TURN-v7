#!/usr/bin/env node
/* The Writers' Room, third pass (owner 2026-10-09: "go ahead with all of it") — the room and its Story Editors.
   A  rights: cast cards follow the cast's own right; story edits check rights themselves; recast re-checks
   B  scenes: a delete writes back the film as it is after the question; five deletes can be undone; the
      only scene can't be deleted
   C  drafting: Auto-draft all asks with the calls and engine; one Draft at a time, never stuck, never
      overwriting; buttons wait while a draft runs
   D  beat map from the script: failures said, a rebuild undoable, fields wait while it reads
   E  typing is never overwritten by a collaborator's version; an edited line that changed says so
   F  exports: PDF numbering, file names in any language, Fountain transitions / action / notes
   G  the Writing dock names no AI vendor
   H  Story Editors: no card after Stop, the Doctor stops on billing failures and labels rule-based fixes,
      Setups & Payoffs asks before the ledger and never shows a fix it didn't write, Final Read reads only
      written scenes, plain errors, old names mapped, what a run uses said before it runs
   I  the run panel: a real dialog, focus on the card, the trace stays put, Stop says what was used
   J  Frances and keys
     node scripts/test-writers-room-third-pass.mjs */
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

const app = read("app/app.jsx"), ai = read("app/ai.jsx"), script = read("app/script.jsx"), insp = read("app/inspector.jsx"),
  spine = read("app/spine.jsx"), exp = read("app/export.jsx"), dock = read("app/aiwriter.jsx"), agents = read("app/agents.jsx"),
  agUi = read("app/agents-ui.jsx"), html = read("TURN.html");

/* ═══ A ═══ */
await test("A1 cast cards follow the cast's own right; story edits and the recast check rights themselves", ()=>{
  assert.ok(app.includes("const canMutateCharacters = ()=> !canMutateSharedFilm() ? false\n    : characterBibleWritableRef.current ? true : _mutationNotice(\"characters\");"));
  assert.ok(app.includes("const updateCharacter = (id,patch)=>{\n    if(!canMutateCharacters()) return;"));
  assert.ok(app.includes("const draftCharacter = async (ch)=>{\n    if(!canMutateCharacters() || charDrafting) return;"));
  assert.ok(app.includes("readOnly:writersRoomBlocked || !characterBibleWritableRef.current,"));
  assert.ok(app.includes('"This role can read the cast but cannot change it."'));
  assert.ok(app.includes("const updateContract = (patch)=>{ if(!canMutateWritersRoom()) return;") && app.includes("const updateGenre = (genre)=>{ if(!canMutateWritersRoom()) return;"));
  assert.ok(app.includes("if(!ok || owner !== projIdRef.current || !canMutateWritersRoom()) return;"));
});

/* ═══ B ═══ */
await test("B1 a scene delete writes back the film as it is after the question, not the list from before it", ()=>{
  const del = between(app, "  const deleteScene = async (id)=>{", "  const undoDeleteScene = ()=>{");
  const ask = del.indexOf("window.appConfirm({"), live = del.indexOf("const liveScenes = scenesRef.current || scenes;");
  assert.ok(ask>0 && live>ask, "the live list is read after the question");
  assert.ok(del.includes("setScenes(ss=>renum(ss.filter(s=>s.id!==id)));") && !del.includes("setScenes(renum(remaining));"));
  assert.ok(del.includes("beats:beatsMap0[id], draft:drafts0[id],"));
});
await test("B2 the last five deleted scenes of this film can be brought back; the only scene can't be deleted", ()=>{
  // the stack, run for real
  const b = { Array, Object }; vm.createContext(b);
  vm.runInContext(`let list=[]; const setDeletedScenes=(f)=>{ list=f(list); };
    const setDeletedScene = (d)=>setDeletedScenes(list=> d ? [d].concat(list.filter(x=>x && x.scene && x.scene.id!==d.scene.id)).slice(0,5) : list.slice(1));
    for(let i=1;i<=7;i++) setDeletedScene({ owner:"f", scene:{ id:"s"+i } }); this.ids = list.map(x=>x.scene.id);`, b);
  assert.deepEqual(J(b.ids), ["s7","s6","s5","s4","s3"]);
  assert.ok(app.includes("const deletedScene = deletedScenes.find(d=>d && d.owner===currentProjectId) || null;"));
  assert.ok(app.includes(" more deleted scene"));
  assert.ok(app.includes('"A film keeps at least one scene \\u2014 add another scene before deleting this one."'));
  assert.ok(insp.includes("disabled:readOnly||sceneCount<=1,"));
});

/* ═══ C ═══ */
await test("C1 Auto-draft all asks first with the scenes, the writing calls and the engine", ()=>{
  const b = { window:{}, Math, Number, String }; b.window = b; vm.createContext(b);
  vm.runInContext("const WRITING_MODELS=[{id:'claude-opus-5-5',label:'Opus 5.5'}]; function getWritingModelId(){ return 'claude-opus-5-5'; }\n"+fn(ai, "turnWritingCallsText"), b);
  assert.equal(b.turnWritingCallsText(3, "story"), "about 3 writing calls on Opus 5.5");
  assert.equal(b.turnWritingCallsText(1), "about 1 writing call on Opus 5.5");
  const all = between(app, "  const draftAll = async ()=>{", "    // the run's own record");
  assert.ok(all.includes("const calls = todo.reduce((t,x)=>t+(beatsMap[x.id] ? 1 : 2), 0);") && all.includes("window.turnWritingCallsText(calls, \"story\")"));
  assert.ok(all.includes("if(!ok || !canMutateWritersRoom() || draftingRef.current) return;"));
});
await test("C2 one Draft at a time, never stuck, never overwriting; Stop before the screenplay call; buttons wait", ()=>{
  const one = between(app, "  const draftOne = async (s)=>{", "  const draftAll = async ()=>{");
  assert.ok(one.includes("if(!canMutateWritersRoom() || drafts[s.id] || draftingRef.current) return;"));
  assert.ok(one.includes("} finally { draftingRef.current = false; setDrafting(null); }"));
  assert.ok(one.includes("if((draftsRef.current||{})[s.id]){ commitVersion(s.id, stampDraft(res, scn, beats)); landed = true; }"));
  assert.ok(one.includes("if(run.stop){") && one.includes("canStop:!beats"));
  assert.ok(app.includes("...((drafting.one && !drafting.canStop) ? {} : { onStop:stopDraftAll, stopping:!!drafting.stopping })"));
  assert.ok(script.includes("disabled:readOnly||!!drafting,onClick:()=>onDraftOne(scene),") && script.includes("disabled:readOnly||!!drafting,onClick:onDraftAll,"));
  assert.ok(script.includes("(one writing call, writing credits)"));
});

/* ═══ D ═══ */
await test("D1 the beat map from the script: a failure is said, a rebuild can be undone, fields wait while it reads", ()=>{
  const be = between(insp, "function BeatEditor({", "  const id = scene.id;");
  assert.ok(be.includes("const readOnly = !!readOnlyIn || deriving;"));
  assert.ok(be.includes("React.useEffect(()=>{ setDeriving(false); }, [scene && scene.id]);"));
  assert.ok(be.includes('return { error:"The writing service isn\'t available right now') && be.includes("catch(e){ return { error:\"Couldn't read the script into beats (\"+"));
  assert.ok(be.includes('toast(r.error+" A blank beat map was started instead.","error");') && be.includes('toast(r.error+" Your beats are unchanged.","error");'));
  assert.ok(be.includes('action:{ label:"Undo", onClick:()=>onBeats(scene.id, prior, tok) }'));
});

/* ═══ E ═══ */
await test("E1 a newer version from a collaborator waits while you type; an edited line that changed says so", ()=>{
  assert.ok(app.includes("if(dirtyRef.current || hydratingRef.current || editingNow()) return;   // never fight local edits"));
  assert.ok(app.includes("!dirtyRef.current && !hydratingRef.current && !editingNow()){"));
  const ce = between(script, "    const commitEdit = (b, newText)=>{", "    // EDIT MODE: remove one element");
  assert.ok(ce.includes("gi = screenplay.blocks.findIndex(x=>x && _spBlockKey(x)===k);"));
  assert.ok(ce.includes("That line changed while you were editing it, so your edit wasn't applied"));
});

/* ═══ F ═══ */
const exBox = ()=>{ const b = { window:{} }; b.window = b; vm.createContext(b); vm.runInContext(exp, b); return b; };
await test("F1 the PDF numbers each scene once, with its own number", ()=>{
  const b = exBox();
  const html = b.screenplayHTML({ title:"T" }, [{ id:"a", no:4 }, { id:"b", no:5 }],
    { a:{ blocks:[{ type:"scene", text:"INT. A" }, { type:"scene", text:"EXT. A2" }, { type:"action", text:"x" }] }, b:{ blocks:[{ type:"scene", text:"INT. B" }] } });
  assert.deepEqual(J(html.match(/class="sn">\d+/g)), ['class="sn">4', 'class="sn">5']);
  assert.ok(html.includes('<p class="slug">EXT. A2</p>'));
});
await test("F2 file names keep the title's letters in any language", ()=>{
  const b = exBox();
  assert.equal(b.safeName({ title:"Zoë's Café" }, "fountain"), "Zoë_s_Café.fountain");
  assert.equal(b.safeName({ title:"東京物語" }, "txt"), "東京物語.txt");
  assert.equal(b.safeName({ title:"" }, "fountain"), "Screenplay.fountain");
  assert.ok(!/TURN/.test(b.safeName({ title:"" }, "fountain")));
});
await test("F3 Fountain: transitions forced, risky action lines forced, undrafted scenes and stand-ins noted", ()=>{
  const b = exBox();
  const f = b.buildFountain({ title:"T" }, [{ id:"a", no:1, loc:"INT. A" }, { id:"b", no:2, loc:"INT. B", summary:"She waits." }, { id:"c", no:3 }],
    { a:{ blocks:[{ type:"scene", text:"INT. A" }, { type:"action", text:"BANG!" }, { type:"action", text:"INT. something reads like a heading" }, { type:"trans", text:"Cut to:" }, { type:"action", text:"He runs." }], by:{ model:"x" } },
      c:{ blocks:[{ type:"scene", text:"INT. C" }, { type:"action", text:"A sketch." }], auto:true } });
  assert.ok(f.includes("\n!BANG!") && f.includes("\n!INT. something reads like a heading") && f.includes("\nHe runs."));
  assert.ok(f.includes("\n>CUT TO:"));
  assert.ok(f.includes("[[Not drafted yet — this is the scene card's summary.]]"));
  assert.ok(f.includes("[[Rough draft built from the beat cards — not written yet.]]"));
});

/* ═══ G ═══ */
await test("G1 the Writing dock groups engines by what they're good at and names no AI vendor", ()=>{
  assert.ok(dock.includes('const PROV = { anthropic:"Story", google:"Fast", openai:"Alternative" };'));
  const notes = between(ai, "const WRITING_MODELS = [", "];");
  assert.ok(!/Anthropic's|Google's|OpenAI's|Moonshot's/.test(notes));
});

/* ═══ H ═══ */
await test("H1 no approval card after Stop or a film switch; the editors check for Stop after each model answer", ()=>{
  assert.ok(agUi.includes("propose:(card)=> (runIdRef.current!==myRun || cancelled.current) ? Promise.resolve(false) : new Promise(res=>{"));
  const doc = between(agents, "async function agentStoryDoctor(ctx){", "async function agentContinuityRepair(ctx){");
  assert.ok(doc.includes("const sug = ctx.ai.available ? await ctx.ai.suggestTurn(scene, prev, rep) : null;\n      if(ctx.cancelled()) return;"));
  const sp = between(agents, "async function agentContinuityRepair(ctx){", "/* =========================================================\n   AGENT 3");
  assert.ok(sp.includes("const line = ctx.ai.available ? await ctx.ai.plantLine(target, factLabel, mode) : null;\n    if(ctx.cancelled()) return;"));
});
await test("H2 the Story Doctor stops on a failure retrying can't fix, labels rule-based fixes, gives a soft peak a strong close", ()=>{
  const doc = between(agents, "async function agentStoryDoctor(ctx){", "async function agentContinuityRepair(ctx){");
  assert.ok(doc.includes("if(f && (needsAction(f) || repeated)){") && doc.includes("so the other fixes would fail the same way."));
  assert.ok(doc.includes("!ctx.cancelled() && !halted){") && doc.includes("!ctx.cancelled() && !halted && ctx.model.scenes.length>=6){"), "no re-read or fusion call after a halt");
  assert.ok(doc.includes('"Rule-based fix (the writing model "'));
  assert.ok(doc.includes('const strong = (c)=> issue.kind==="weakpeak" && Math.abs(c)<3'));
  assert.ok(ai.includes("}catch(e){ if(report) report.failure = screenplayFailureFromError(e, \"turn\"); return null; }"));
  assert.ok(app.includes("suggestTurn:(s,p,r)=>window.aiSuggestTurn(s,p,model.project,r),"));
  assert.ok(doc.includes("if(ctx.sync()===false) return;") && app.includes("      return true;\n    };\n    return { model, sync, input, emit, propose,"));
});
await test("H3 Setups & Payoffs asks before the ledger and never shows a fix it didn't write", ()=>{
  const sp = between(agents, "async function agentContinuityRepair(ctx){", "/* =========================================================\n   AGENT 3");
  const ask = sp.indexOf("const okL = await ctx.propose({"), build = sp.indexOf("await buildContinuityLedgerStep(ctx);");
  assert.ok(ask>0 && build>ask, "the ledger is (re)built only after the card");
  assert.ok(sp.includes("if(!line){") && sp.includes("so there's nothing to approve"));
  assert.ok(sp.includes("after: target.summary+\"  \"+line,") && !sp.includes('["+(mode==="setup"?"Setup":"Payoff")+": "+factLabel+"]"'));
  assert.ok(!/Continuity repair/.test(sp));
});
await test("H4 Final Read reads only written scenes and says when the service failed", ()=>{
  const tr = between(agents, "async function agentTableRead(ctx){", "/* =========================================================\n   SCRIPT READ");
  assert.ok(tr.includes("if(standInDraft(d)){ standIns++; return; }") && tr.includes("ctx.ai.tableRead(ctx.model.scenes, written)") && tr.includes("ctx.ai.voiceCheck(ctx.model.scenes, written)"));
  assert.ok(tr.includes('rep.unavailable==="service"') && tr.includes('why==="service"'));
  assert.ok(ai.includes('return { unavailable:"service", failure:f, message:"The Final Read couldn\'t run \\u2014 "+screenplayFailureReason(f)+"." }; }'));
  assert.ok(ai.includes('}catch(e){ const out = bail("service"); out.failure = screenplayFailureFromError(e, "voice-check"); return out; }'));
});
await test("H5 plain errors; old names mapped in saved reports; what each run uses", ()=>{
  const b = { window:{}, String }; b.window = b; vm.createContext(b);
  vm.runInContext(fn(agents, "agentErrText"), b);
  assert.equal(b.agentErrText(new TypeError("Cannot read properties of undefined (reading 'x')")), "an unexpected error");
  assert.equal(b.agentErrText(new Error("Choose a plan to start creating.")), "Choose a plan to start creating");
  b.turnIsAdmin = true; assert.match(b.agentErrText(new TypeError("x is not a function")), /\[admin: x is not a function\]/);
  assert.ok(!/\(\(e&&e\.message\)\|\|e\)/.test(agents));
  const nb = { window:{} }; nb.window = nb; vm.createContext(nb);
  vm.runInContext(between(agents, "const LEGACY_DISPLAY_NAMES = [", "window.turnDisplayNames = turnDisplayNames;"), nb);
  assert.equal(nb.turnDisplayNames("Table-read complete. Continuity repair finished."), "Final Read complete. Setups & Payoffs finished.");
  assert.equal(nb.turnDisplayNames("A continuity repair of the text"), "A continuity repair of the text", "whole phrases only");
  const reg = between(agents, "const AGENTS = [", "window.AGENTS = AGENTS;");
  assert.ok(reg.includes("maxCalls:7, run:agentStoryDoctor") && reg.includes("maxCalls:0, run:(ctx)=>agentConsistency") && reg.includes("maxCalls:6, run:agentContinuityRepair") && reg.includes("maxCalls:2, run:agentTableRead"));
});

/* ═══ I ═══ */
await test("I1 the run panel: what a run uses, a real dialog, focus on the card, the trace stays put, Stop says what was used", ()=>{
  assert.ok(agUi.includes(': agent.maxCalls===0 ? "It makes no writing calls \\u2014 running it is free."'));
  assert.ok(agUi.includes('role:"dialog","aria-modal":"true",') && agUi.includes(': "Story Editors",style:{outline:"none"}},') && agUi.includes('if(e.key==="Escape" && !document.querySelector(".appconfirm-overlay, .appconfirm"))'));
  assert.ok(agUi.includes("React.useEffect(()=>{ if(pending && cardRef.current){ try{ cardRef.current.focus(); }catch(e){} } },[pending]);"));
  assert.ok(agUi.includes("if(bodyRef.current && (nearBottomRef.current || pending))"));
  assert.ok(agUi.includes(" So far it used ") && agUi.includes("A writing call already on its way still finishes (and is charged)"));
  assert.ok(agUi.includes('"Something went wrong and the run stopped') && !agUi.includes('"The agent hit an error and stopped: "'));
  assert.ok(ai.includes("&& !(typeof window.__turnAgentRunCancelled===\"function\" && window.__turnAgentRunCancelled())){"));
  assert.ok(agUi.includes('"A reply was cut off, so it asked once more with more room (one more writing call)."'));
  assert.ok(agUi.includes('function noteKeys(go, scene){') && agUi.includes('"aria-label":"Dismiss"},"✕")'));
});
await test("I2 accessibility in the room: continuity rows, beat gutter, act strips, the spine graph, the × button", ()=>{
  assert.ok(script.includes('className:`cont-row ${k.sev}`,role:"button",tabIndex:0,'));
  assert.ok(script.includes('onMouseEnter:()=>setActiveBeat(n),role:"button",tabIndex:0,'));
  assert.ok(script.includes('"aria-label":"Remove this element",'));
  assert.ok(spine.includes('role:"img",') && spine.includes('"aria-label":"Value-charge graph: "'));
  assert.ok(spine.includes('role:"button",tabIndex:0,"aria-label":`Expand Act ${roman(g.act)}`,'));   // a folded act's tile
});

/* ═══ J ═══ */
await test("J1 Frances knows the pass, names no vendor for the dock; keys", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const by = (n)=> ((fb.__F.find(f=>f.name===n)||{}).what || "");
  assert.ok(!/Anthropic \/ Google \/ OpenAI \/ Moonshot/.test(by("Writing engine dock")) && /Story \/ Fast \/ Alternative\)/.test(by("Writing engine dock")));
  for(const re of [/WRITERS' ROOM REVIEW, THIRD PASS/, /Script Supervisor is free/, /no line, no card/, /A card never appears after Stop/, /rough stand-ins are skipped/])
    assert.ok(re.test(by("Story Editors (Writers' Room agents)")), String(re));
  assert.ok(/It asks first, with how many scenes and writing calls/.test(by("Auto-draft all (N left)")));
  assert.ok(/numbers each scene once/.test(by("Export (screenplay / story)")));
  assert.ok(/last five deleted scenes/.test(by("Script view")));
  for(const f of ["app", "ai", "script", "agents", "agents-ui", "inspector", "spine", "export", "aiwriter"])
    assert.ok(["20261009-wr3","20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261106-views22", "20261106-views23", "20261106-views24", "20261106-views25", "20261106-views26", "20261106-views27", "20261107-cloud1", "20261107-cloud2", "20261107-cloud3", "20261107-cloud4", "20261107-cloud5", "20261107-cloud6", "20261108-cam1", "20261108-cam2", "20261108-cam3", "20261108-style1", "20261108-ideas1", "20261108-cancel1", "20261108-match1", "20261108-match2", "20261108-match3", "20261108-match4", "20261108-match5", "20261108-match6", "20261108-match7", "20261108-shelves1", "20261108-bus1", "20261108-bus2", "20261108-bus3", "20261108-release5", "20261111-auto1", "20261112-models1", "20261112-resume1", "20261112-limit1", "20261112-thread1", "20261112-length1", "20261112-small1", "20261112-head1", "20261112-names1", "20261112-stops1", "20261112-long1", "20261112-show1", "20261112-ns1", "20261112-last1", "20261112-conv1", "20261113-tree1", "20261113-order1", "20261113-step1", "20261113-rhythm1", "20261113-buttons1", "20261113-cards1", "20261113-bar1", "20261113-capture1", "20261115-previs2", "20261115-previs3", "20261115-drafts1", "20261115-oneroad1", "20261116-place2", "20261116-variants1", "20261116-cancel1", "20261116-shell1", "20261116-delete1", "20261116-relight1", "20261116-variants2", "20261116-place3", "20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f);   // (later passes re-key some)
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

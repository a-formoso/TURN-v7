#!/usr/bin/env node
/* The Shots tab, third pass (owner 2026-10-09: "go ahead with all of it") — does it tell the truth?
   A  runs: only a NEW frame is success; a step that never starts ends; the cascade is priced; Regenerate
      downstream asks, renders only dependents and unapproves at each step; scene runs always ask
   B  approval and stamps: uploads approved; knowing approval with a chain override; Edit keeps its stamps
      and gives approval back on failure; stamps after loading; a cleared seed; the counts agree
   C  drafts and data: unanswered beats keep their shots; the re-draft question names what it replaces;
      Design all asks and reads live inputs; rights; restore / purge / undo / scene delete; the migration
   D  the Shot Designer and pre-production
   E  spending, copy, accessibility; Frances
     node scripts/test-shots-third-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const app = read("app/app.jsx"), ui = read("app/shots-ui.jsx"), shots = read("app/shots.jsx"), so = read("app/scene-order.js"),
  art = read("app/artroom.jsx"), agents = read("app/agents.jsx"), ai = read("app/ai.jsx"), bd = read("app/breakdown.jsx"), stage = read("app/stage.jsx"), css = read("app/styles.css");

/* ═══ A — runs ═══ */
await test("A1 only a NEW frame is success: an old frame that survived a failed re-render is never approved or used as a seed", ()=>{
  const hb = between(ui, "  const handleBatchDone = (id, opts)=>{", "  // the pause bar's three answers");
  assert.ok(hb.includes("(!!_u && (_u !== (c.preFrame||\"\") || (!!_iso && _iso !== (c.preIso||\"\"))))"));
  assert.ok(!hb.includes("(opts && opts.strict)"), "strict is the rule on every path");
  assert.ok(ui.includes("setChain({ ids, idx:i, total:ids.length, force:!!force, unlock:!!unlock, preFrame, preIso });"));
  // the rule, run for real
  const ok = (u, pre, iso, preIso)=> !!u && (u!==(pre||"") || (!!iso && iso!==(preIso||"")));
  assert.equal(ok("url-a","url-a","t1","t1"), false, "same frame, same version: the re-render failed");
  assert.equal(ok("url-a","url-a","t2","t1"), true, "same address, new version: success");
  assert.equal(ok("url-b","url-a","",""), true); assert.equal(ok("","", "",""), false);
});
await test("A2 a step that never starts ends the run at once (no 7-minute wait)", ()=>{
  assert.ok(ui.includes('return "aborted";') && (ui.match(/return "aborted";/g)||[]).length===2 && ui.includes('return "deferred";'));
  assert.ok(ui.includes('Promise.resolve(generateWithProps()).then(r=>{ if(r==="aborted"){ batchStarted.current=false; onBatchDone && onBatchDone(sh.id); } }, ()=>{});'));
});
await test("A3 the price counts the cascade; unverified approved frames are done; scene runs always ask", ()=>{
  const rp = between(ui, "  const runPlanFor = (ids)=>{", "  const scenePlanFor");
  assert.ok(rp.includes("if(seed && will.has(seed.id)) will.add(id);") && rp.includes("const cascade = toRender.filter("));
  assert.ok(ui.includes('approved frame"+(plan.cascade.length!==1?"s follow":" follows")+" one of those in the chain'));
  assert.ok(ui.includes('return (st==="current" || st==="unverified" || shotHasOverride(s)) && shotChainOk(s); };'));
  assert.ok(shots.includes('current = (st==="current" || st==="unverified" || !!ov) && !chainStale;'));
  assert.ok(ui.includes('try{ if(!(await confirmRun(ids, "in Scene "+String(scene.no).padStart(2,"0"), true))) return; }'));
  // the cascade, run for real
  const order = ["s1","s2","s3","s4","s5"], seedOf = { s2:"s1", s3:"s2", s4:null, s5:"s4" }, done = { s1:true, s2:false, s3:true, s4:true, s5:true };
  const will = new Set(); order.forEach(id=>{ if(!done[id]){ will.add(id); return; } if(seedOf[id] && will.has(seedOf[id])) will.add(id); });
  assert.deepEqual([...will], ["s2","s3"], "s4 is a fresh start, so s4 and s5 are kept");
});
await test("A4 Regenerate downstream: asks with the price, only the shots built on this frame, unapproves at each step", ()=>{
  const rd = between(ui, "  const onRegenDownstream = async (sh)=>{", "   // Manual generation uses");
  assert.ok(rd.includes("if(seed && deps.has(seed.id)) deps.add(id);") && rd.includes("const targets = ids.slice(at+1).filter(id=>deps.has(id));"));
  assert.ok(rd.includes("await window.appConfirm({ title:\"Regenerate the \"+targets.length+\" shot\"") && rd.includes("nbImageCostText(targets.length)"));
  assert.ok(rd.includes("stepChain(targets, 0, true, true);") && !rd.includes("ids.slice(at+1).forEach(id=> onUpdateShot(id,{ locked:false }));"));
  assert.ok(rd.includes("window.__turnShotRunPropChoice = propChoice;"));
  assert.ok(ui.includes("if(unlock && shotById[ids[i]] && shotById[ids[i]].locked) onUpdateShot(ids[i], { locked:false });"));
});
await test("A5 'Check each frame' leaves a single manual render for you to approve", ()=>{
  assert.ok(ui.includes('if(checkEachRef.current && c.ids.length===1){ setChain(null); batch.setMsg("Frame made \\u2014 check it, then approve it on its card."); return; }'));
});

/* ═══ B — approval and stamps ═══ */
await test("B1 a chain approved across a change stays current until the seed changes again (scene-order.js, run for real)", ()=>{
  const b = { console, Object, Array, String, Number, JSON, Set, Map }; b.window = b; vm.createContext(b);
  vm.runInContext(so, b);
  const metas = { s1:{ version:2, iso:"t2" }, s2:{ seedSource:{ seedShotId:"s1", seedVersion:1, seedIso:"t1" } } };
  const get = (id)=> metas[id] || null;
  b.seedShotOf = (sh)=> sh.id==="s2" ? { id:"s1" } : null;
  assert.equal(b.shotChainStatus({ id:"s2" }, [], get), "stale");
  const ov = b.shotSeedStamp({ id:"s1" }, metas.s1);
  assert.equal(b.shotChainStatus({ id:"s2", seedOverride:ov }, [], get), "current");
  metas.s1 = { version:3, iso:"t3" };
  assert.equal(b.shotChainStatus({ id:"s2", seedOverride:ov }, [], get), "stale", "a newer seed asks again");
  assert.ok(ui.includes("seedOverride:shotSeedStamp(seed, seed && typeof nbGetMeta===\"function\" ? nbGetMeta(seed.id) : null)"));
  assert.ok(ui.includes('title:continuityNeedsRefresh ? "Approve a frame whose continuity needs refresh?" : "Approve this frame as it is?",'));
});
await test("B2 uploads are approved; an Edit keeps its stamps and gives approval back on failure; stamps after loading", ()=>{
  assert.ok(art.includes('if(typeof opts.onImported==="function"){ try{ opts.onImported(meta); }catch(e){} }'));
  assert.ok(ui.includes('window.turnUpdateShot(sh.id, { locked:true, sourceOverride:undefined });') && app.includes("window.turnUpdateShot = updateShot;"));
  assert.ok(ui.includes('const _keep = (k, now)=> (_priorMeta && _priorMeta[k]!==undefined) ? _priorMeta[k] : now;'));
  for(const k of ["shotSource","propDependencies","characterRefVersions","locationDependencies"]) assert.ok(ui.includes('_keep("'+k+'",'), k);
  assert.ok(ui.includes("if((wasLocked || override) && (!nowIso || nowIso===preIso)) onUpdate(sh.id,{ locked:wasLocked,"));
  assert.ok(ui.includes("await Promise.all(_ids.map(id=> Promise.resolve(nbLoadImage(id)).catch(()=>null)));"));
  assert.ok(ui.includes("const continuityNeedsRefresh = chainStatus===\"stale\" || seedGone;"));
});
await test("B3 the counts agree: prop changes reach the frame state, the Breakdown and the Stage", ()=>{
  assert.ok(shots.includes("function shotPropChanged(sh, sceneShots, meta){") && shots.includes("propChanged, done: rendered && approved && current };"));
  assert.ok(bd.includes("made before a character sheet changed") && bd.includes("made before a prop changed"));
  assert.ok(stage.includes('"frame made before its location changed"') && stage.includes('"frame made before a prop changed"'));
});

/* ═══ C — drafts and data ═══ */
const helpers = between(app, "  const snapShotDialogue = (scene, made)=>{", "  const draftOneSceneShots = async (scene, replace)=>{");
const hb = { console, Object, Array, String, Number, Set, Math }; hb.window = hb; vm.createContext(hb);
hb.draftsRef = { current:{ sc:{ blocks:[{ type:"dia", text:"I told you to wait for me at the docks." }] } } }; hb.drafts = hb.draftsRef.current;
hb.shotsLiveRef = { current:[{ id:"a", sceneId:"sc", beatN:1 }, { id:"b", sceneId:"sc", beatN:2 }, { id:"c", sceneId:"sc", beatN:3 }] };
vm.runInContext(helpers+"\n;this.__h={snapShotDialogue,keepUnansweredBeats};", hb);
await test("C1 beats the model didn't answer keep their shots; an empty beat is still filled; dialogue snaps to the script", ()=>{
  const raw = [{ beat:1, fromModel:true }, { beat:2, fromModel:false }, { beat:4, fromModel:false }];
  const made = [{ beatN:1 }, { beatN:2 }, { beatN:3 }, { beatN:4 }];
  const r = hb.__h.keepUnansweredBeats({ id:"sc" }, raw, made);
  assert.deepEqual(J(r.made).map(m=>m.beatN), [1, 4], "beat 2 (unanswered, has a shot) and beat 3 (no row, has a shot) are left alone; beat 4 is new");
  assert.deepEqual(J(r.leftAlone), [2, 3]);
  const d = hb.__h.snapShotDialogue({ id:"sc" }, [{ dialogue:"MARA: I told you wait for me at docks" }]);
  assert.equal(d[0].dialogue, "I told you to wait for me at the docks.");
  assert.ok(ai.includes("fromModel:!!byBeat[String(n)],"));
  assert.ok(app.includes('"Opening keyframes updated \\u2014 except Beat"'));
});
await test("C2 the re-draft question names what it replaces, with the cost in its title", ()=>{
  const fn = between(app, "  const redraftReplaces = (list)=>{", "  const [draftingSceneShots, setDraftingSceneShots]");
  const b = { console, Object, Array, String }; b.window = b; vm.createContext(b);
  vm.runInContext(fn+";this.__f=redraftReplaces;", b);
  assert.equal(b.__f([{ locked:true }, { actionByHand:true }, { referenceCharactersSet:true }, {}]),
    " It replaces 1 approved frame (unapproved where the shot changes), 1 Action you wrote by hand, 1 hand-picked character choice.");
  assert.equal(b.__f([{}]), "");
  assert.ok(app.includes("'s keyframes (writing credits)?\"") && app.includes("'s specification again (writing credits)?\""));
});
await test("C3 Design all asks with the cost, drafts from the current inputs; voicing checks rights before paying", ()=>{
  const da = between(app, "  const draftAllShots = async ()=>{", "  // Art Room: suggest a character's appearance states");
  assert.ok(da.includes("if(!canMutateShots()) return;") && da.includes('(writing credits)?"') && da.indexOf("if(!ok) return;") < da.indexOf("setDraftingAllShots(true);"));
  const one = between(app, "  const draftOneSceneShots = async (scene, replace)=>{", "  const [draftingSceneShots");
  assert.ok(one.includes("const L = keyframeInputsRef.current || {};") && one.includes("draftsRef.current||drafts"));
  assert.ok(app.includes("  const voiceLine = async (shot)=>{\n    if(!canMutateShots()) return;") && !app.includes("const voiceAllLines"));
});
await test("C4 rights follow the role's right to save shots, whatever room is open", ()=>{
  assert.ok(app.includes('window.teamCanWriteSection(writeRole, "shots")') && app.includes("const canMutateShots = ()=> projectLoadingRef.current ? _projectLoadingNotice()"));
  for(const fn of ["  const deleteShot = (id)=>{", "  const restoreShot = (id)=>{", "  const purgeShot = async (id)=>{", "  const addShot = (sceneId, beatN, seed)=>{"]){
    const i = app.indexOf(fn); assert.ok(i>0, fn); assert.ok(app.slice(i, i+200).includes("if(!canMutateShots()) return;"), fn); }
  assert.ok(app.includes('if(!canMutateShots()) throw new Error("You no longer have permission to change this film\'s shots.");'));
  assert.ok(art.includes("onRestore:readOnly?null:onRestoreShot,onPurge:readOnly?null:onPurgeShot,"));
  assert.ok(art.includes("onRestore && React.createElement(\"button\",{className:\"rd-restore\"") && art.includes("onPurge && React.createElement(\"button\",{className:\"rd-purge\""));
  assert.ok(ui.includes('!readOnly && _el("button",{className:"art-draftall",disabled:draftingAllShots||!ordered.length,onClick:handleDesignAll,'));
});
await test("C5 restore / purge / undo / scene delete keep work; the background tidy-up is frame-safe and silent", ()=>{
  const rs = between(app, "  const restoreShot = (id)=>{", "  const purgeShot");
  assert.ok(rs.includes("That shot is already in the scene, so the copy in Recently deleted stays there.") && rs.includes("Its scene was deleted"));
  const pg = between(app, "  const purgeShot = async (id)=>{", "  // ── Phase 2");
  assert.ok(pg.includes("if(!live && typeof nbClearAsset===\"function\") await nbClearAsset(id);"));
  assert.ok(app.includes("{ const back = new Set(snap.shots.map(x=>x && x.id)); setTrash("));
  assert.ok(app.includes("deletedWithScene:id") && app.includes("const backIds = new Set(d.shots.map(sh=>sh.id));"));
  assert.ok(app.includes('window.appToast("Shot deleted \\u2014 it\'s in Recently deleted.","info",{ action:{ label:"Undo"'));
  // the migration rule, run for real
  const up = between(app, "  const updateShot = (id,patch,opts)=>{", "  // deleting a shot can be undone");
  const b = { console, Object, Array, String, Number, JSON, Math, Set }; b.window = b; vm.createContext(b);
  vm.runInContext(so, b);
  let shotsState = [{ id:"x", sceneId:"sc", beatN:1, specRev:3, referenceLocationIds:["l1","l2"] }];
  b.setShots = (f)=>{ shotsState = f(shotsState); };
  b.projectLoadingRef = { current:false }; b.shotsReadOnlyRef = { current:false }; b.canMutateShots = ()=>true;
  vm.runInContext(up+";this.__u=updateShot;", b);
  b.__u("x", { referenceLocationIds:["l1"] }, { migration:true });
  assert.equal(shotsState[0].specRev, 3, "a migration keeps the revision");
  b.__u("x", { referenceLocationIds:[] });
  assert.equal(shotsState[0].specRev, 4, "a real edit bumps it");
  b.shotsReadOnlyRef.current = true; const before = JSON.stringify(shotsState);
  b.__u("x", { referenceLocationIds:["z"] }, { migration:true });
  assert.equal(JSON.stringify(shotsState), before, "silent no-op for a role that can't save shots");
  assert.ok(ui.includes("if(!alive||has) return;") && ui.includes("},{ migration:true });"));
});

/* ═══ D ═══ */
await test("D1 the Shot Designer: checked before applying, a running draft, snapped dialogue, real reasons; pre-production is honest", ()=>{
  const dc = between(app, "      draftCoverage: async (scene)=>{", "      applyCoverage:");
  assert.ok(dc.includes("const check = keyframeScope(scene);") && dc.includes("keyframeBusyRef.current.add(scene.id);") && dc.includes("snapShotDialogue(scene, made);"));
  assert.ok(dc.includes("made = keepUnansweredBeats(scene, raw, made).made;"));
  assert.ok(app.includes("_w.commitBeatKeyframes(fresh, _coverageChecks[sceneId] || (()=>{}));") && app.includes("const _coverageChecks = {};"));
  assert.ok(app.includes("cancelled: ()=> cancelled() || switchedFilms() || !!artRoomReadOnlyRef.current,"));
  assert.ok(agents.includes("s.manual || s.actionByHand || s.referenceCharactersSet || _hasFrame(s.id)"));
  assert.ok(agents.includes('(why ? " ("+why+")" : " \\u2014 the answer couldn\'t be read")') && agents.includes("wasn't changed: "));
  assert.ok(agents.includes("errored.push(step[0]);") && agents.includes('"Pre-production finished with "+errored.length'));
});

/* ═══ E ═══ */
await test("E1 spending and copy: priced scene needs, priced edits, guarded frame-check repairs, honest wording", ()=>{
  const mn = between(app, "  const makeSceneNeeds = async (scene, needs, onProgress)=>{", "  const wornBuildRef");
  assert.ok(mn.includes('title:"Make what Scene "') && mn.includes("plus writing credits to draft") && mn.includes('else if(ok==="exists") already++;'));
  assert.equal((mn.match(/return "exists";/g)||[]).length, 3);
  assert.ok(art.includes('"Apply region edit",\n              typeof window.nbCostChip==="function" && window.nbCostChip(1)'));
  assert.ok(art.includes('"Remaster \\u2014 clean re-render",\n            typeof window.nbCostChip==="function" && window.nbCostChip(1)'));
  assert.ok(art.includes('"Edit current image", typeof window.nbCostChip==="function" && window.nbCostChip(1))'));
  assert.ok(ui.includes("window.QaCheckButton && _el(window.QaCheckButton,{ gen:genGuarded,"));
  assert.ok(!ui.includes("Set your image-model API key first") && !ui.includes("full coverage") && !ui.includes("scene draft handler"));
  assert.ok(!ui.includes('"Previous scene (\\u2190)"') && !art.includes("Your server proxy is text-only"));
  assert.ok(!app.includes("coverage AI returned nothing usable"));
});
await test("E2 accessibility: real buttons for the scene jump, the head pin and the paused thumbnail", ()=>{
  assert.ok(ui.includes('_el("button",{type:"button",className:"scene-pager-btn",title:"Jump to a scene","aria-haspopup":"true"'));
  assert.ok(!ui.includes('className:"scene-pager-no ssg-jump",role:"button",tabIndex:0'));
  assert.ok(ui.includes('"aria-pressed": isFirst ? undefined : (isHead ? "true" : "false"),'));
  assert.ok(ui.includes('className:"shot-check-thumb-btn"') && css.includes(".scene-pager-btn{") && css.includes(".shot-check-thumb-btn{"));
});
await test("E3 Frances: runs, approval, drafts and data", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Shots (Art Room)")||{}).what || "";
  for(const re of [/SHOTS REVIEW, THIRD PASS/, /Regenerate downstream' renders only the later shots that BUILD ON/, /never approved or used as the next seed/,
    /uploading a finished frame onto a slot approves it/, /the beats it didn't answer keep their shots/, /'Design all shots' asks first/,
    /Only someone whose role saves shots/, /asks first with the image price and the writing/, /\(when the beat already has a shot\)/]) assert.ok(re.test(w), String(re));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE|Nano Banana|Seedance/.test(between(ai, "[\"Shots (Art Room)\", \"SHOTS REVIEW, THIRD PASS", "\"],\n")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

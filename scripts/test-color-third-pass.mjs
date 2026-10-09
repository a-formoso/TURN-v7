#!/usr/bin/env node
/* The Color tab, third pass (owner 2026-10-08: "go ahead with all of it") — does it tell the truth?
   A  edit rights on every colour change; the panels close and the background sync stops for other roles
   B  your picks stay: a reused look id is renamed, your film stock is kept, the redo choice is the run's,
      a deleted scene gets no look; undo for a deleted look or still; clearing the field brings the notes back
   C  the Colorist: failures say why, the stills fall back once, the vision call honours the pinned model,
      the cost is said before Run
   D  freshness: Shots edits and seeded frames, Stage takes and extends, the hand-edited prompt (kept per
      film), the lighting override, the counts
   E  copy, accessibility, location plates and video lighting
   F  Frances knows
     node scripts/test-color-third-pass.mjs */
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
const app = read("app/app.jsx"), ai = read("app/ai.jsx"), agents = read("app/agents.jsx"), agentsUi = read("app/agents-ui.jsx"),
  ui = read("app/stylebible-ui.jsx"), art = read("app/artroom.jsx"), shotsUi = read("app/shots-ui.jsx"), shots = read("app/shots.jsx"),
  stage = read("app/stage.jsx"), bd = read("app/breakdown.jsx"), sb = read("app/storyboard.jsx"), locs = read("app/locations.jsx"), css = read("app/styles.css");

/* the real colour handlers (app.jsx) in a sandbox */
const colourSrc = between(app, "  const applyStyleResult = (res, seed, opts)=>{", "  // ---- Art Room: SHOT LIST ----");
const harness = (start, opt)=>{
  const o = opt || {};
  const b = { console, Object, Array, String, Set, JSON, Math, toasts:[], denied:0 };
  b.window = b; vm.createContext(b);
  b.project = J(start);
  b.setProject = (f)=>{ b.project = typeof f==="function" ? f(b.project) : f; return true; };
  b.canMutateSharedFilm = ()=>{ if(o.readOnly){ b.denied++; return false; } return true; };
  b.artRoomReadOnlyRef = { current:!!o.readOnly };
  b.coloristRedoManualRef = { current:false };
  b.projIdRef = { current:"film-1" };
  b.scenesRef = { current:(o.scenes||[{ id:"s1" }, { id:"s2" }, { id:"s3" }]) };
  b.scenes = b.scenesRef.current;
  b.lookbook = []; b.lookbookNote = "";
  b.lookbookBriefFor = ()=> "Overall look: amber dusk, sodium light";
  b.markApplied = ()=>{};
  b.styleBibleOf = (p)=> ({ presets:((p.styleBible||{}).presets)||[], sceneStyles:((p.styleBible||{}).sceneStyles)||{} });
  b.appToast = (msg, type, opts)=> b.toasts.push({ msg, type, opts });
  vm.runInContext(colourSrc+"\n;this.__h={applyStyleResult,setStyleRefs,addStyleRefImages,removeStyleRefImage,setScenePreset,setFilmStock,updateStylePreset,deleteStylePreset};", b);
  return b;
};
const look = (id, extra)=>({ id, name:id.toUpperCase(), grade:"g-"+id, palette:["#111111","#222222","#333333"], ...(extra||{}) });

/* ═══ A ═══ */
await test("A1 a role that can't change the Art Room changes nothing — every colour handler checks", ()=>{
  const b = harness({ styleBible:{ presets:[look("noir")], sceneStyles:{ s1:"noir" }, refs:"mine", refImages:[{ id:"r1" }] } }, { readOnly:true });
  const before = JSON.stringify(b.project);
  const h = b.__h;
  h.setStyleRefs("x"); h.addStyleRefImages([{ id:"r2" }]); h.removeStyleRefImage("r1"); h.setScenePreset("s2","noir");
  h.setFilmStock("kodak"); h.updateStylePreset("noir",{ name:"N" }); h.deleteStylePreset("noir");
  h.applyStyleResult({ presets:[look("warm")], sceneStyles:{ s1:"warm" } });
  assert.equal(JSON.stringify(b.project), before);
  assert.ok(b.denied >= 7);
});
await test("A2 the panels close and the Lookbook sync stops for other roles; read-only gets no colour actions", ()=>{
  assert.ok(app.includes("React.useEffect(()=>{ if(artRoomReadOnly){ setColoristOpen(false); setCoordOpen(false);"));
  assert.ok(app.includes("coloristOpen && !artRoomReadOnly && React.createElement(AgentsPanel,{"));
  const sync = between(app, "  React.useEffect(()=>{\n    if(hydratingRef.current) return;\n    if(artRoomReadOnlyRef.current) return;   // (2026-10-08) a role", "},[lookbook, lookbookNote, hydrationTick]);");
  assert.ok(sync.includes("colorRefsFor(sb, lookbook, lookbookNote)"));
  assert.ok(art.includes("onSetRefs:readOnly?null:onSetStyleRefs,onSetScenePreset:readOnly?null:onSetScenePreset,"));
  assert.ok(art.includes("onAddRefImages:readOnly?null:onAddStyleRefImages,onRemoveRefImage:readOnly?null:onRemoveStyleRefImage,onColorist:readOnly?null:onColorist,"));
  assert.ok(app.includes("onColorist:(refs, opts)=>{ if(!canMutateSharedFilm()) return;") && app.includes("  const applyLookbook = async (dept, mode)=>{\n    if(!canMutateSharedFilm()) return;"));
});

/* ═══ B ═══ */
await test("B1 a hand-picked scene keeps ITS look when the new palette reuses the id", ()=>{
  const mine = look("noir", { grade:"my own edited grade", edited:true });
  const b = harness({ styleBible:{ presets:[mine, look("old")], sceneStyles:{ s1:"noir", s2:"old" }, sceneStylesManual:{ s1:true } } });
  b.__h.applyStyleResult({ presets:[look("noir", { grade:"model grade" }), look("warm")], sceneStyles:{ s1:"noir", s2:"noir", s3:"warm" } }, null, { redoManual:false });
  const sbx = b.project.styleBible, byId = Object.fromEntries(sbx.presets.map(p=>[p.id,p]));
  assert.equal(byId.noir.grade, "my own edited grade", "your look kept its id and content");
  assert.equal(byId["noir-2"].grade, "model grade", "the model's look was renamed");
  assert.deepEqual(J(sbx.sceneStyles), { s1:"noir", s2:"noir-2", s3:"warm" });
  assert.equal(sbx.sceneStylesManual.s1, true);
});
await test("B2 your film stock stays unless the run redoes your picks; the redo choice is the run's own", ()=>{
  const b = harness({ styleBible:{ presets:[look("a")], sceneStyles:{}, filmStock:"none" } });
  b.__h.setFilmStock("kodak-vision3");
  assert.equal(b.project.styleBible.filmStockManual, true);
  b.__h.applyStyleResult({ presets:[look("b")], sceneStyles:{ s1:"b" }, filmStock:"fuji-eterna" }, null, { redoManual:false });
  assert.equal(b.project.styleBible.filmStock, "kodak-vision3");
  b.coloristRedoManualRef.current = true;   // another panel's choice must not leak into this run
  b.__h.applyStyleResult({ presets:[look("b")], sceneStyles:{ s1:"b" }, filmStock:"fuji-eterna" }, null, { redoManual:false });
  assert.equal(b.project.styleBible.filmStock, "kodak-vision3");
  b.__h.applyStyleResult({ presets:[look("b")], sceneStyles:{ s1:"b" }, filmStock:"fuji-eterna" }, null, { redoManual:true });
  assert.equal(b.project.styleBible.filmStock, "fuji-eterna"); assert.equal(b.project.styleBible.filmStockManual, false);
  assert.ok(app.includes('const _redoManual0 = agentName==="Colorist" && !!coloristRedoManualRef.current;'));
  assert.ok(app.includes("applyStyles: (res)=> _w.applyStyleResult(res, null, { redoManual:_redoManual0 }),"));
  assert.ok(agents.includes('" Your film stock ("') && agents.includes('" Film stock: "'));
});
await test("B3 a scene deleted while the run worked gets no look", ()=>{
  const b = harness({ styleBible:{ presets:[look("a")], sceneStyles:{} } }, { scenes:[{ id:"s1" }] });
  b.__h.applyStyleResult({ presets:[look("b")], sceneStyles:{ s1:"b", gone:"b" } }, null, {});
  assert.deepEqual(J(b.project.styleBible.sceneStyles), { s1:"b" });
});
await test("B4 deleting a look and removing a still can be undone; clearing the field brings the Lookbook notes back", ()=>{
  const b = harness({ styleBible:{ presets:[look("a"), look("b")], sceneStyles:{ s1:"a", s2:"b" }, sceneStylesManual:{ s1:true }, sceneWhy:{ s1:"why" },
    refImages:[{ id:"r1" }, { id:"r2" }], refs:"mine" } });
  b.__h.deleteStylePreset("a");
  assert.deepEqual(J(b.project.styleBible.presets).map(p=>p.id), ["b"]);
  const t = b.toasts.pop(); assert.match(t.msg, /deleted/); assert.equal(t.opts.action.label, "Undo");
  t.opts.action.onClick();
  assert.deepEqual(J(b.project.styleBible.presets).map(p=>p.id), ["a","b"]);
  assert.equal(b.project.styleBible.sceneStyles.s1, "a"); assert.equal(b.project.styleBible.sceneStylesManual.s1, true); assert.equal(b.project.styleBible.sceneWhy.s1, "why");
  b.__h.removeStyleRefImage("r1");
  assert.deepEqual(J(b.project.styleBible.refImages).map(r=>r.id), ["r2"]);
  b.toasts.pop().opts.action.onClick();
  assert.deepEqual(J(b.project.styleBible.refImages).map(r=>r.id), ["r1","r2"], "back in its place");
  b.__h.setStyleRefs("   ");
  assert.equal(b.project.styleBible.refs, "amber dusk, sodium light"); assert.equal(b.project.styleBible.lookbookSynced, "amber dusk, sodium light");
  b.__h.addStyleRefImages([{ id:"r3" }], "another-film");
  assert.equal(b.project.styleBible.refImages.length, 2, "stills picked in another film don't land here");
  b.__h.addStyleRefImages([{ id:"r3" }], "film-1");
  assert.equal(b.project.styleBible.refImages.length, 3);
  assert.ok(ui.includes("onAddRefImages(out, film0);") && app.includes("window.turnOpenFilmId = currentProjectId;"));
  assert.ok(ai.includes('if(opts && opts.action && typeof opts.action.onClick==="function"){') && css.includes(".turn-toast-act{"));
});
await test("B5 deleting a scene removes (and Undo restores) its hand-pick mark and reason too", ()=>{
  assert.ok(app.includes("styleManual:!!(sb.sceneStylesManual||{})[id], styleWhy:(sb.sceneWhy||{})[id],"));
  assert.ok(app.includes("if(b.sceneStylesManual && id in b.sceneStylesManual){ out.sceneStylesManual={...b.sceneStylesManual}; delete out.sceneStylesManual[id]; }"));
  assert.ok(app.includes("...(d.styleManual ? { sceneStylesManual:{...(b.sceneStylesManual||{}), [id]:true} } : {}),"));
});

/* ═══ C ═══ */
await test("C1 the Colorist: a failure says why; an unreadable answer is the only 'run again'; stills fall back once", ()=>{
  const fn = between(ai, "async function aiAssignSceneStyles(", "window.aiAssignSceneStyles = aiAssignSceneStyles;");
  assert.ok(fn.includes("if(/credit|budget|allowance|plan doesn|limit reached/i.test(why)) throw e;"));
  assert.ok(fn.includes("visionSkipped = why;") && fn.includes("...(visionSkipped ? { visionSkipped } : {})"));
  const col = between(agents, "async function agentColorist(ctx){", "/* =========================================================\n   AGENT 7");
  assert.ok(col.includes('"The Colorist couldn\'t run: "+failure+(hopeless ? "" : " — try again in a moment.")'));
  assert.ok(col.includes("couldn't be read as a palette") && !col.includes("didn't return a usable palette. Try again."));
  assert.ok(col.includes("Couldn't look at your reference stills ("));
});
await test("C2 the stills' vision call honours the run's pinned model and records it", ()=>{
  const v = between(ai, "async function aiVisionComplete(messages, images){", "\n}\n");
  assert.ok(v.includes("const forced = window.__forceWritingModel ? WRITING_MODELS.find(x=>x.id===window.__forceWritingModel) : null;"));
  assert.ok(v.includes("const picked = forced || WRITING_MODELS.find("));
  assert.ok(v.includes("window.__lastWritingModel = { id:m.id, label:m.label };"));
});
await test("C3 the cost is said before Run; the panel no longer says 'Nothing happens without your OK'", ()=>{
  assert.ok(!agentsUi.includes("Nothing happens without your OK.") && agentsUi.includes("nothing is applied without your OK. Running it uses writing credits"));
  assert.ok(app.includes('"Cost: one writing call"') && app.includes("spent when you press Run. Nothing is applied until you approve it."));
  assert.ok(app.includes('viewLabel:"View Color"') && app.includes("on the Color tab's Visual references bar"));
  assert.equal((ui.match(/a little more when it looks at your reference stills/g)||[]).length >= 3, true);
});

/* ═══ D ═══ */
await test("D1 Shots: an Edit keeps the frame's look stamp; a frame seeded from an earlier-look frame carries that stamp", ()=>{
  assert.ok(shotsUi.includes("metaExtra: async (mx)=>{") && shotsUi.includes('const _isEdit = !!(mx && mx.mode==="edit");'));
  assert.ok(shotsUi.includes("lookSig: (_prior && _prior.lookSig!==undefined) ? _prior.lookSig : (!_isEdit && _seedEarlierLook) ? _seedEarlierLook : _lookNow,"));
  assert.ok(shotsUi.includes('let _seedEarlierLook = "";'));
});
await test("D2 Stage: takes, extends and hand-edited prompts carry the look they really have", ()=>{
  assert.ok(stage.includes("const inputEarlierLook = (()=>{"));
  assert.ok(stage.includes("takeMeta:{ lookSig:(!referenceFree && inputEarlierLook) ? inputEarlierLook : ((promptEditedRef.current && promptLookStamp) ? promptLookStamp : clipLookSig),"));
  assert.ok(stage.includes("takeMeta:{ lookSig:(extendVideo && _earlierOf(extendVideo.lookSig)) ? extendVideo.lookSig : clipLookSig,"));
  assert.ok(stage.includes('lookSig:(t && t.meta && t.meta.lookSig) || "",'));
  assert.ok(stage.includes("This scene's look changed on the Color tab after you edited this prompt"));
  assert.equal((stage.match(/setPromptSourceStamp\(promptSourceSig\),setPromptLookStamp\(clipLookSig\)/g)||[]).length, 6);
  assert.equal((stage.match(/sourceSig:promptSourceSig,lookSig:clipLookSig,shotIds:/g)||[]).length, 5);
});
await test("D3 Stage: hand-edited prompts are kept per film on this device; a lighting override stays", ()=>{
  assert.ok(stage.includes('const _draftsKey = "turn_stage_prompt_drafts:"+') && stage.includes("localStorage.setItem(_draftsKey, JSON.stringify(out))"));
  assert.ok(stage.includes("setTimeout(savePromptDrafts, 400)"));
  // the lighting rule, run for real
  const b = { cur:"base", key:"", from:"" };
  const step = (key, dl)=>{ const prev = { key:b.key, from:b.from }; b.cur = (prev.key===key && b.cur!==prev.from) ? b.cur : dl; b.key = key; b.from = dl; };
  step("c1|a", "Warm key"); assert.equal(b.cur, "Warm key");
  b.cur = "My override"; step("c1|a", "Cold key"); assert.equal(b.cur, "My override", "kept when only the look's lighting changed");
  step("c2|a", "Other"); assert.equal(b.cur, "Other", "a new clip starts from its own");
  assert.ok(stage.includes("setLighting(cur=> (prev.key===key && cur!==prev.from) ? cur : d.lighting);"));
});
await test("D4 the counts agree: Breakdown counts every rendered frame and earlier-look sheets; Takes read the live project", ()=>{
  assert.ok(bd.includes("if(st.rendered || st.done){ if(st.oldLook) oldLook++; if(st.locChanged) locChanged++;"));
  assert.ok(bd.includes("boards = { total:0, current:0, stale:0, oldLook:0, partial:0, none:0 };") && bd.includes('" from frames with an earlier look"'));
  assert.ok(bd.includes('" (at your last Stage visit)"'));
  assert.ok(stage.includes("shotLookIsEarlier(m.lookSig, project || window.turnProject, clip.scene.id))") && stage.includes("StageVersionsView,{ key:\"vers-\"+clip.id, clip, stageModel, readOnly, project,"));
  assert.ok(sb.includes("(typeof shotLookSig===\"function\" && scene) ? shotLookSig(ctx.project, scene.id) : \"\"]);"));
});
await test("D5 an open look editor can't write stale text over a replaced look", ()=>{
  assert.ok(ui.includes('key:"ed-"+["name","dominantLabel","secondaryLabel","accentLabel","grade","lighting","lens","texture"]'));
});

/* ═══ E ═══ */
await test("E1 copy and accessibility: looks not presets; labelled swatches and buttons; a real button per scene", ()=>{
  assert.ok(ui.includes('" look"+(presets.length!==1?"s":"")') && ui.includes('" scenes with a look"') && ui.includes('" with no look yet"'));
  assert.ok(!/ preset"\+\(presets\.length/.test(ui) && !ui.includes("scenes styled"));
  assert.ok(ui.includes('"aria-label":"Remove reference still "+(ix+1)') && ui.includes('role:"img","aria-label":"Sampled colours: "'));
  assert.ok(ui.includes('className:"sb-strip-hit","aria-label":label,"aria-haspopup":"true"') && ui.includes('"aria-pressed":p.id===pid?"true":"false"'));
  assert.ok(!ui.includes('role: editable ? "button" : undefined') && ui.includes('if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); setPick(null);'));
  assert.ok(css.includes(".sb-strip-hit{") && css.includes(".sb-sr-only{"));
  assert.ok(!/Assign from script/.test(ui));
});
await test("E2 location plates and video prompts: colour comes from the scene's look", ()=>{
  assert.ok(!locs.includes("desaturated cold green-teal grade") && locs.includes("colour left neutral (the scene's look grades it)"));
  assert.ok(shots.includes("its colour grade and palette come from this scene's look, not from the view."));
  assert.ok(stage.includes('const lighting = (preset && preset.lighting) || "";') && !stage.includes('"Naturalistic, motivated light"'));
});

/* ═══ F ═══ */
await test("F1 Frances: rights, picks, undo, cost, freshness — and the Colorist opens, it doesn't run on its own", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Color / scene looks (Art Room)")||{}).what || "";
  for(const re of [/COLOR REVIEW, THIRD PASS/, /only the owner or an Art director can change the colour system/, /a film stock you pick yourself is kept/,
    /the new one is renamed/, /Run pre-production re-lights Color without asking/, /shows an Undo/, /says what a run costs before you press Run/,
    /only suggests trying again when that can help/, /OPENS the Colorist/, /read-only, the visual references it will read/, /'Earlier look' stays/]) assert.ok(re.test(w), String(re));
  assert.ok(!/then runs the agent/.test(w) && !/so you can add taste first/.test(w));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE|Nano Banana/.test(between(ai, "[\"Color / scene looks (Art Room)\", \"COLOR REVIEW, THIRD PASS", "\"],\n")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

#!/usr/bin/env node
/* The Shots tab, second pass (owner 2026-10-05: "go ahead with all of it") — do your edits reach the
   frame and the video?
   A  out of date, decided right: a frame-only edit ("Leave out") re-renders the frame but no longer
      knocks a take out of the film (takes stamped with `videoHash`); older takes keep the whole-spec
      check; ticking a reference on/off marks frames made since out of date; nothing flags at once
   B  Action: an edit made on the card wins over the screenplay's opening in the frame prompt; a
      re-draft starts from the screenplay again without un-approving unchanged shots
   C  the card: Action says whose words the frame uses (+ "Use the screenplay's"); Dialogue on a
      screenplay beat is the screenplay's line, read-only; "Leave out" is on the card; an approved
      frame that went out of date says so, and the run question counts them; dead code gone
   D  lens: any whole mm from the Blender preview is that lens, in the control and in both prompts
   E  multi-shot rows carry each shot's size · angle · move · lens and composition
   F  Frances knows
     node scripts/test-shots-second-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const shots = read("app/shots.jsx"), ui = read("app/shots-ui.jsx"), stage = read("app/stage.jsx"), ai = read("app/ai.jsx");

/* the real stamps */
const so = { console, Object, Array, String, Number, JSON, Math, Set, Map }; so.window = so; vm.createContext(so);
vm.runInContext(read("app/scene-order.js"), so);
vm.runInContext(read("app/beat-keyframe-merge.js"), so);
const draft = { blocks:[{ beat:1, type:"action", text:"Mara crosses to the desk." }] };
const shot = { id:"s1", sceneId:"sc", beatN:1, size:"MS", action:"Mara crosses", negativePrompt:"no fog", specRev:1 };
const edit = (s, patch)=>({ ...s, ...patch, specRev:(so.shotSpecFingerprint(s)!==so.shotSpecFingerprint({ ...s, ...patch })) ? s.specRev+1 : s.specRev });

await test("A1 'Leave out' re-renders the frame but leaves a new take in the film; a real change still dates it", ()=>{
  const frameMeta = { shotSource:so.shotSourceStamp(shot, draft) };
  const takeMeta = { shotSources:[so.shotSourceStamp(shot, draft)] };
  assert.ok(takeMeta.shotSources[0].videoHash, "takes are stamped with the video-only hash");
  const neg = edit(shot, { negativePrompt:"no fog, no rain" });
  assert.equal(so.shotAssetProvenanceStatus(neg, draft, frameMeta), "stale", "the frame reads it");
  assert.equal(so.shotSourcesStatus([neg], { sc:draft }, takeMeta), "current", "the video doesn't");
  const size = edit(shot, { size:"CU" });
  assert.equal(so.shotSourcesStatus([size], { sc:draft }, takeMeta), "stale");
  assert.equal(so.shotSourcesStatus([shot], { sc:{ blocks:[{ beat:1, type:"action", text:"Changed." }] } }, takeMeta), "stale", "a screenplay change too");
});
await test("A2 an older take (no videoHash) keeps the whole-spec check; overrides follow the same rule", ()=>{
  const { videoHash, ...legacy } = so.shotSourceStamp(shot, draft);
  const neg = edit(shot, { negativePrompt:"x" });
  assert.equal(so.shotSourcesStatus([neg], { sc:draft }, { shotSources:[legacy] }), "stale");
  assert.equal(so.shotSourcesStatus([shot], { sc:draft }, { shotSources:[legacy] }), "current", "unchanged → still current");
  const take = { shotSources:[{ ...legacy, specRev:99 }], sourceOverride:[so.shotSourceStamp(shot, draft)] };
  assert.equal(so.shotSourcesEditorialStatus([neg], { sc:draft }, take), "override", "a new-style override ignores a frame-only edit");
});
await test("A3 ticking a reference on/off dates frames that recorded it; older frames aren't judged", ()=>{
  const meta = { shotSource:so.shotSourceStamp(shot, draft), refOffSig:so.shotRefOffSig(shot) };
  assert.equal(so.shotAssetProvenanceStatus(shot, draft, meta), "current");
  assert.equal(so.shotAssetProvenanceStatus({ ...shot, refOff:["char-mara"] }, draft, meta), "stale");
  assert.equal(so.shotRefOffSig({ refOff:["b","a"] }), so.shotRefOffSig({ refOff:["a","b"] }), "order doesn't matter");
  const old = { shotSource:so.shotSourceStamp(shot, draft) };
  assert.equal(so.shotAssetProvenanceStatus({ ...shot, refOff:["char-mara"] }, draft, old), "current", "a frame from before isn't judged");
  assert.ok(ui.includes('refOffSig:(typeof shotRefOffSig==="function") ? shotRefOffSig(sh) : undefined,'));
});
await test("A4 nothing flags at once: a shot without the new field hashes as before", ()=>{
  assert.equal(so.shotSpecFingerprint(shot), so.shotSpecFingerprint({ ...shot, actionByHand:undefined }));
  assert.notEqual(so.shotSpecFingerprint(shot), so.shotSpecFingerprint({ ...shot, actionByHand:true }), "writing your own Action is a change");
  assert.equal(so.shotVideoSpecFingerprint({ ...shot, negativePrompt:undefined }), so.shotSpecFingerprint({ ...shot, negativePrompt:undefined }));
});

/* ═══ B ═══ */
await test("B1 the frame prompt uses an Action written by hand instead of the screenplay's opening", ()=>{
  const f = between(shots, "    const actionByHand = !!(sh && sh.actionByHand && clean(sh.action));", "if(openingAction)");
  assert.ok(f.includes("(screenplaySource&&screenplaySource.hasSource && !actionByHand)"));
  assert.ok(shots.includes('"\\n\\nOPENING ACTION (the director\'s own wording for this first frame — it replaces the screenplay\'s opening): "'));
  assert.ok(read("app/scene-order.js").includes('"actionByHand"];'));
});
await test("B2 a re-draft drops the hand-written flag without un-approving a shot that didn't change", ()=>{
  const prior = { id:"s1", sceneId:"sc", beatN:1, keyframeMode:"beat-opening", action:"Mara crosses", locked:true, specRev:2, actionByHand:true };
  const next = { id:"n1", sceneId:"sc", beatN:1, action:"Mara crosses" };
  const m = so.mergeBeatKeyframes([prior], [next]).shots[0];
  assert.equal("actionByHand" in m, false);
  const plain = { id:"s2", sceneId:"sc", beatN:2, keyframeMode:"beat-opening", action:"A door", locked:true, specRev:3, covers:[], beatPlan:null, referenceCharactersSet:false, referenceCharacterIds:[] };
  const m2 = so.mergeBeatKeyframes([plain], [{ id:"n2", sceneId:"sc", beatN:2, action:"A door" }]).shots[0];
  assert.equal(m2.locked, true, "unchanged → still approved"); assert.equal(m2.specRev, 3);
});

/* ═══ C ═══ */
const card = between(ui, "function ShotCard({", "\nconst CONF_LABELS");
await test("C1 Action says whose words the frame uses; 'Use the screenplay's' goes back", ()=>{
  assert.ok(card.includes("value: actionFromScript ? spOpening : sh.action, multiline:true,") && card.includes("onCommit:commitAction"));
  assert.ok(card.includes('"Action \\u2014 your words (the frame uses them instead of the screenplay\'s opening)"'));
  assert.ok(card.includes('onClick:()=>onUpdate(sh.id,{action:spOpening, actionByHand:undefined})},"Use the screenplay\'s")'));
  const fx = between(card, "const commitAction = (v)=>{", "\n  };");
  assert.ok(fx.includes("if(t===spOpening){ onUpdate(sh.id,{action:t, actionByHand:undefined}); return; }"));
  assert.ok(card.includes("onApplySpec:(patch)=>onUpdate(sh.id, (patch && patch.action!=null && spOpening) ? { ...patch, actionByHand:true } : patch)"), "a QA fix to the Action counts as your words");
});
await test("C2 Dialogue on a screenplay beat is the screenplay's line, read-only; 'Leave out' is on the card", ()=>{
  assert.ok(card.includes('"Dialogue \\u2014 from the screenplay"') && card.includes('"No line is spoken as this frame opens."'));
  assert.ok(card.includes("spLine!==undefined"));
  const notes = between(card, 'label:"Action \\u00b7 composition \\u00b7 dialogue"', 'label:"In frame"');
  assert.ok(notes.includes('label:shotFieldLabel("Leave out (negative prompt)","Leave out")'));
  const prompt = between(card, 'label:"Shot prompt"', "\n}");
  assert.ok(!/SheetField/.test(prompt), "the prompt fold is read-only now");
});
await test("C3 an approved frame that went out of date says so; the run question counts them; dead code gone", ()=>{
  assert.ok(card.includes("const approvedButStale = !!(sh.locked && gen.genUrl && frameSourceStatus===\"stale\""));
  assert.ok(card.includes("Approved, but out of date \\u2014 this shot changed after you approved its frame"));
  // (2026-10-09, third pass) approved frames that went out of date — the cascade is counted apart
  assert.ok(ui.includes("approvedRedo:redo.filter(id=>{ const s=shotById[id]; return s && s.locked && !shotIsDone(s); })"));
  assert.ok(ui.includes('" you approved that went out of date."'));
  assert.ok(!/const toggleIn\b/.test(ui));
});

/* ═══ D: the real lens lookups ═══ */
await test("D1 a 37mm lens from the Blender preview is 37mm in the control, the frame and the settings", ()=>{
  const b = { console, Array, String, Object, JSON }; b.window = b; vm.createContext(b);
  vm.runInContext(between(shots, "const SHOT_SIZES = [", "function shotHasCameraSettings(") + "\n;this.lensOf=lensOf;", b);
  assert.equal(b.lensOf("37").label, "37mm"); assert.equal(b.lensOf("35").label, "35mm"); assert.equal(b.lensOf("zoom").label, "50mm", "a non-number still falls back");
  assert.match(b.shotCameraSettingsClause({ cameraSettings:{ focalLength:"37" } }), /focal length: 37mm/);
  assert.equal(b.shotEffectiveCameraSettings({ cameraSettings:{ focalLength:"37" } }).focalLength.effectiveLabel, "37mm");
  const gs = between(ui, "function GrammarSelect(", "\n}\n");
  assert.ok(gs.includes('label:String(value)+"mm", desc:"set in the Blender preview"'));
});

/* ═══ E ═══ */
await test("E1 multi-shot rows carry their camera setup and composition (never twice)", ()=>{
  const ms = between(stage, "const multiShot = recipe===\"multishot\" ? msShots.map(sh=>{", "}).filter(s=>s.prompt) : undefined;");
  assert.ok(ms.includes('const camLine = [String(p.camera||"").trim(), String(p.composition||"").trim().replace(/[.\\s]+$/,"")].filter(Boolean).join("; ");'));
  assert.ok(ms.includes('". Camera: "+camLine+"."') && ms.includes("!_normStageText(text).includes(_normStageText(camLine))"));
  assert.ok(ms.includes("return { prompt:withCam+((dlg && !dup)?"));
});

/* ═══ F ═══ */
await test("F1 Frances: Action, Dialogue, Leave out, references, lens, approved frames, multi-shot", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Shots (Art Room)")||{}).what || "";
  for(const re of [/uses YOUR words in the frame/, /'Use the screenplay's'/, /screenplay's spoken line, read-only/, /named 'Leave out'/,
    /no longer knocks the clip's Stage takes out of the film/, /ticking a reference sheet on or off now marks the frame out of date/,
    /e\.g\. 37mm/, /'Approved, but out of date'/, /each row now carries its shot's size, angle, move, lens and composition/]) assert.ok(re.test(w), String(re));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

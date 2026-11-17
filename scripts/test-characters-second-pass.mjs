#!/usr/bin/env node
/* The Characters tab, second pass (owner 2026-10-06: "go ahead with all of it") — do characters reach the film?
   A  frames record each attached character sheet's version; a regenerated sheet = "Character sheet changed"
      (cold cache never flags); the frame state and the Stage readiness count it
   B  Stage takes: "References need review" only for a real change (never a sheet's approval); a re-locked
      voice = "Voice changed"
   C  variants remember their master; unpinned states say so and are never made or priced
   D  Storyboards use the scene's own variant; a character with no sheet says so on the shot
   E  the "Update sheet with new wardrobe" button exists; removing a state asks; delete forever takes the
      scale sheet, likeness photos and voice file, and frees the props; edit rights on delete/restore/suggest
   F  prices (Likeness, voice, Surprise me); copy (likeness line, scale hint, vendor names); dead code
   G  Frances knows
     node scripts/test-characters-second-pass.mjs */
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
const noop = ()=>{};
const shots = read("app/shots.jsx"), ui = read("app/shots-ui.jsx"), stage = read("app/stage.jsx"), art = read("app/artroom.jsx"),
  app = read("app/app.jsx"), ag = read("app/agents.jsx"), voices = read("app/voices-ui.jsx"), sb = read("app/storyboard.jsx"), ai = read("app/ai.jsx");

/* ═══ A ═══ */
const box = { console, Array, String, Object }; box.window = box; vm.createContext(box);
vm.runInContext(between(shots, "function shotCharacterRefVersions(castSpec, refOff){", "window.shotCharacterRefVersions"), box);
let metas = {};
box.nbGetMeta = (id)=> metas[id] || null;
await test("A1 a frame records its character sheets (the variant it used), minus the ones ticked off", ()=>{
  metas = { ana:{ iso:"1", version:1 }, "ben:wet":{ iso:"2", version:3 } };
  const spec = [{ id:"ana", baseId:"ana" }, { id:"ben:wet", baseId:"ben" }, { id:"cal", baseId:"cal" }];
  assert.deepEqual(J(box.shotCharacterRefVersions(spec, ["cal"])), ["ana@1#1", "ben:wet@2#3"]);
});
await test("A2 a regenerated sheet = changed; a cold cache never is; a sheet made later counts as a change", ()=>{
  metas = { ana:{ iso:"1", version:1 } };
  assert.equal(box.shotCharacterRefsChanged(["ana@1#1"]), false);
  metas.ana = { iso:"9", version:2 };
  assert.equal(box.shotCharacterRefsChanged(["ana@1#1"]), true);
  assert.equal(box.shotCharacterRefsChanged(["zed@1#1"]), false, "not loaded → no alarm");
  metas.cal = { iso:"5", version:1 };
  assert.equal(box.shotCharacterRefsChanged(["cal@#"]), true, "rendered before Cal's sheet existed");
  assert.equal(box.shotCharacterRefsChanged(undefined), false, "frames from before this was recorded");
});
await test("A3 recorded on new frames; the card badge, the frame state and the Stage readiness use it", ()=>{
  assert.ok(ui.includes("characterRefVersions:_keep(\"characterRefVersions\", (typeof shotCharacterRefVersions===\"function\" && renderPlan) ? shotCharacterRefVersions(renderPlan.castSpec, sh.refOff) : []),"));
  assert.ok(ui.includes('"Character sheet changed"') && ui.includes("shotCharacterRefsChanged(gen.genMeta.characterRefVersions)"));
  assert.ok(shots.includes("const charChanged = !!(m && shotCharacterRefsChanged(m.characterRefVersions));") && shots.includes("oldLook, charChanged, locChanged, propChanged, done:"));
  assert.ok(stage.includes("if(st.charChanged) frames.charChanged++;") && stage.includes('"frame made with an older character sheet"'));
});

/* ═══ B ═══ */
await test("B1 takes: 'References need review' only when a reference changed or is missing; 'Voice changed'", ()=>{
  // (2026-10-09, Stage third pass) the take notes live in one shared helper the Takes view reads
  const vers = between(stage, "function stageTakePropChanged(clip, meta){", "\nfunction StageVersionsView({")+between(stage, "function StageVersionsView({", "\n}\n");
  assert.ok(vers.includes("return st.missing||st.excluded||st.stale; });") && !vers.includes("st.stale||!st.approved") && !vers.includes("s.stale||!s.approved"));
  assert.ok(!vers.includes("or is not currently approved"));
  assert.ok(vers.includes("String(window.vgVoiceLockSignature(c.voiceLock)||\"\")!==String(v.fingerprint)"));
  assert.ok(vers.includes('"Voice changed"'));
  // the fingerprint a take saves is the one the voice check compares
  assert.ok(read("app/voicegen.jsx").includes("const voiceSignature = vgVoiceLockSignature(opts.voiceLock||{"));
});

/* ═══ C ═══ */
await test("C1 a variant remembers its master and says when it's older; unpinned states say so", ()=>{
  const row = between(art, "function StateRow({", "\nfunction CharacterSheet(");
  assert.ok(row.includes('metaExtra: async ({ mode })=> mode==="base" ? { baseMasterIso:'));
  assert.ok(row.includes("m.baseMasterIso!==masterIso") && row.includes("Made from an older master sheet"));
  assert.ok(row.includes("!st.sceneId && React.createElement(") && row.includes("Not pinned \\u2014 no shot uses this state"));
});
await test("C2 the Casting Director never makes an unpinned state's variant; the tab doesn't count or price one", async ()=>{
  const ab = { console, Set }; ab.window = ab; vm.createContext(ab);
  vm.runInContext(between(ag, "async function agentCastingDirector(ctx){", "/* =========================================================\n   WEAR PROPS"), ab);
  const log = [];
  const D = (id, name, extra)=>({ id, name, coreBody:"b", wardrobeMask:"w", ...(extra||{}) });
  const list = [ D("a","Ana",{ states:[{ id:"p", label:"Pinned", sceneId:"s1" }, { id:"u", label:"Loose" }] }) ];
  await ab.agentCastingDirector({ castOnly:null, castVariants:true, force:false, ai:{ available:true }, emit:(e)=>log.push(e.t||""), cancelled:()=>false,
    art:{ markApplied:noop, cast:{ list, isDrafted:()=>true, draftSpec:async ()=>null, suggestStates:async ()=>[],
      imageOf:async ()=>"", generateMaster:async ()=>"u", generateState:async (c, st)=>{ log.push("var:"+st.id); } } } });
  assert.ok(log.includes("var:p") && !log.includes("var:u"));
  assert.ok(log.some(t=>/isn't pinned to a scene, so no shot uses it; skipped/.test(t)));
  assert.equal((art.match(/filter\(st=>st && st\.sceneId && !img\(c\.id\+":"\+st\.id\)\)/g)||[]).length, 2);
});

/* ═══ D ═══ */
await test("D1 Storyboards use the scene's own variant; a character with no sheet says so on the shot", ()=>{
  const comp = between(sb, "function StoryboardComposite({", "\nfunction StoryboardPage(");
  assert.equal((comp.match(/shotCharacterReferenceSpec\(c, scene, ctx\.scenes\|\|null\)/g)||[]).length, 2);
  assert.ok(comp.includes("const rid=(spec&&spec.id)||id; const u=await grab(rid);") && comp.includes("id:(spec&&spec.id)||c.id"));
  // (2026-10-20) a character with no sheet stops the frame; the card says so under its reference strip
  assert.ok(ui.includes('" no usable sheet yet, so this frame won\\u2019t render: make "') && !ui.includes("this frame renders without "));
});

/* ═══ E ═══ */
await test("E1 'Update sheet with new wardrobe' exists (the app knows which masters); removing a state asks", ()=>{
  const card = between(art, "function CharacterSheet({", "\n}\n");
  assert.ok(card.includes('"Update sheet with new wardrobe"') && card.includes("wardrobeStale && gen.genUrl && !readOnly"));
  assert.ok(app.includes("if(stale && stale.length){ n++; ids.push(c.id); }") && app.includes("setWardrobeIds(ids);"));
  assert.ok(art.includes("wardrobeStale:(wardrobeIds||[]).indexOf(c.id)>=0") && art.includes("readOnly,wardrobeIds:wardrobeIds||[],project,characters"));
  const del = between(card, "const deleteState = async (id)=>{", "updateStates(states.filter(s=>s.id!==id));");
  assert.ok(del.includes('title:"Remove the appearance state \\u201c"') && del.indexOf("if(!ok) return;") < del.indexOf("nbClearAsset"));
});
await test("E2 delete forever takes the scale sheet, likeness photos and voice file, and frees the props; edit rights", ()=>{
  const purge = between(app, "const purgeCharacter = async (id)=>{", "const [charDrafting");
  assert.ok(purge.includes('"charscale-"+id') && purge.includes("await nbClearCameo(id)") && purge.includes("window.vgClearAudio(window.vgVoiceMasterAssetId(id))"));
  assert.ok(purge.includes("p.ownerId===id ? { ...p, ownerId:null } : p"));
  for(const fn of ["const deleteCharacter = (id)=>{", "const restoreCharacter = (id)=>{", "const purgeCharacter = async (id)=>{"])
    assert.ok(between(app, fn, "\n  };").includes("if(!canMutateSharedFilm()) return;"), fn);
  assert.ok(app.includes("if(!canMutateSharedFilm() || suggestingStatesId || !(typeof aiSuggestStates===\"function\")) return;"));
});

/* ═══ F ═══ */
await test("F1 prices: Likeness 'Put it on the sheet' (it was 'Apply to sheet'), the voice buttons, Surprise me", ()=>{
  // (2026-10-10, owner — Likeness review) the price counts the likeness photos + worn sheets (GPT Image charges each)
  assert.ok(art.includes('gen.gening?"Making the sheet\\u2026":"Put it on the sheet",\n          !gen.gening && typeof window.nbCostChip==="function" && window.nbCostChip(1, { refs:cardGenerateRefs() })),'));
  assert.ok(voices.includes('"Design voices"+vcDesignPrice') && voices.includes('("Generate voice file"+vcMasterPrice)') && voices.includes('"Regenerate"+vcMasterPrice'));
  assert.ok(voices.includes("window.turnCreditCost(0.10)") && voices.includes("window.vgLineCredits(window.VG_VOICE_MASTER_TEXT"));
  assert.ok(art.includes('label:"Surprise me \\u2728 (one writing call)"') && art.includes('label:"Surprise me ✨ (one writing call)"'));
});
await test("F2 copy: the likeness line, the scale hint, no vendor names, no 'Not approved'; dead code gone", ()=>{
  // (2026-10-10, owner — Likeness review) a sheet made with an OLDER likeness says so too
  // (2026-11-17, owner: plain words) on the sheet / not on the sheet yet / the sheet shows an earlier face
  assert.ok(art.includes('(gen.likenessStale ? "the sheet shows an earlier face" : "on the sheet")\n            : "not on the sheet yet"'));
  assert.ok(art.includes('React.createElement("span",{className:"scs-t"},"Real face saved")') && !art.includes('"Likeness locked"') && !art.includes('"Recapture"') && !art.includes('"Apply to sheet"'));
  assert.ok(art.includes('((lkInfo.angleCount||1)+" photo"+((lkInfo.angleCount||1)!==1?"s":""))') && art.includes('(lkInfo.synced?"in the cloud too":"on this device")'), "photos, not angles");
  assert.ok(art.includes("for you to check the size at a glance. Shots use the size written on the card") && !art.includes("Used as the scale reference in shots"));
  const userStrings = (src)=> (src.match(/"(?:[^"\\\n]|\\.)*"/g)||[]).filter(x=>/[a-z] [a-z]/i.test(x));
  for(const [f, src] of [["artroom", art], ["voices-ui", voices]])
    assert.deepEqual(userStrings(src).filter(x=>/ElevenLabs|fal\.ai|Google Search|GPT Image blocked/.test(x)), [], f);
  assert.ok(!art.includes(': "Not approved"'));
  assert.ok(!/function sheetReviewReasons|ArtReviewContext|function _nbKeyBarRetired|10-panel design/.test(art));
});

/* ═══ G ═══ */
await test("G1 Frances knows", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Character Sheets (Art Room)")||{}).what || "";
  for(const re of [/'Character sheet changed'/, /Made from an older master sheet/, /'Voice changed'/, /now means a reference really changed or is missing/,
    /'Not pinned \\u2014 no shot uses this state'|'Not pinned — no shot uses this state'/, /'UPDATE SHEET WITH NEW WARDROBE'/, /'Delete forever' also removes/]) assert.ok(re.test(w), String(re));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

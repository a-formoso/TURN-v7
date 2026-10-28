#!/usr/bin/env node
/* test-stage-editor-review.mjs — the Stage editor review (owner 2026-10-09: "go ahead with all of it"), the app's
   own wiring. Takes, voiced lines, cleanup paths and take addresses are in test-stage-editor-takes.mjs; the database
   in test-team-relaunch-db.mjs; the server in test-film-payer.mjs.
     A  on someone else's film the owner pays: the Stage's price labels, the budget, no Plans
     B  the owner's plan: a failed read keeps the tier; the Stage editor role pauses below Producer; why it's read-only
     C  a Stage editor's shot changes: the Stage's fields only; designing, adding, deleting shots stay with others
     D  `shots` merges shot by shot on save, and the merged list comes back
     E  takes: delete only your own; untrusted addresses aren't played; renders that finished while you were away
     F  refusal words, Frances, keys
   No network, no browser. node scripts/test-stage-editor-review.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, f)=>{ try{ await f(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };

const app = read("app/app.jsx"), stage = read("app/stage.jsx"), cloud = read("app/cloud.jsx"), team = read("app/team.jsx"),
  plans = read("app/plans.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");

/* ═══ A ═══ */
const stageBox = { console };
stageBox.window = stageBox; vm.createContext(stageBox);
vm.runInContext(between(stage, "/* can this person change the Art Room (Shots, frames)?", "/* PLAN NAMES AS USERS SEE THEM")
  +";this.info=stageCreditInfo;this.shortText=stageCreditShortText;this.panelText=stageCreditPanelText;", stageBox);
await test("A1 on a shared film the Stage checks the person's budget on the film, never their own balance", ()=>{
  stageBox.turnFilmPaidByOwner = ()=>true;
  stageBox.turnFilmBudget = { limit:500, spent:100 };
  const own = { plan:null, remaining:0 };                 // an invitee with no plan and no credits
  let i = stageBox.info(own, 300);
  assert.equal(i.ownerPays, true); assert.equal(i.empty, false, "covered by the budget");
  assert.equal(i.label, "Uses about 300 credits · paid by the film's owner · 400 of your budget left this month");
  i = stageBox.info(own, 710, { hold:true });
  assert.equal(i.empty, true);
  assert.equal(stageBox.shortText(i), "This needs about 710 credits, and your budget on this film has 400 left this month. The film's owner can raise it.");
  assert.equal(stageBox.panelText(i), "Your budget on this film doesn't cover this render.");
  stageBox.turnFilmBudget = { limit:null, spent:9999 };
  i = stageBox.info(own, 5000);
  assert.equal(i.empty, false, "no limit"); assert.equal(i.label, "Uses about 5,000 credits · paid by the film's owner");
  stageBox.turnFilmPaidByOwner = ()=>false;
  i = stageBox.info({ remaining:0 }, 300);
  assert.equal(i.ownerPays, undefined); assert.equal(i.empty, true, "your own film: your own balance");
});
await test("A2 nothing on a shared film opens Plans: the blocker has no action, the warning no 'Get credits'", ()=>{
  assert.ok(stage.includes('if(creditInfo.empty) blockers.push(creditInfo.ownerPays ? { key:"credits", text:stageCreditShortText(creditInfo) }'));
  assert.ok(stage.includes('!footerCredit.ownerPays && _stEl("button",{type:"button",className:"stage2-warn-act",'));
  assert.equal((stage.match(/if\((?:ci|info)\.ownerPays\) return stageCreditShortText\((?:ci|info)\);/g)||[]).length, 2, "Extend / Motion Control / Edit");
  assert.ok(app.includes("window.turnFilmPaidByOwner = ()=> isSharedFilm;"));
  assert.ok(app.includes("if(alive && own) window.turnFilmBudget = { limit:own.budget==null ? null : Number(own.budget), spent:Number(own.spent)||0 };"));
});

/* ═══ B ═══ */
await test("B1 a failed read of the owner's plan keeps the tier (\"\" only when the function is missing)", async ()=>{
  const fn = between(cloud, "async function cloudFilmOwnerTier(projectId){", "\n}\n")+"\n}";
  const run = async (res)=>{ const box = { sbClient:()=>({ rpc:async ()=>res }) }; vm.createContext(box);
    vm.runInContext(fn+";this.f=cloudFilmOwnerTier;", box); return box.f("p1"); };
  assert.equal(await run({ data:"studio" }), "studio");
  assert.equal(await run({ error:{ code:"PGRST202", message:"Could not find the function" } }), "");
  assert.equal(await run({ error:{ code:"57014", message:"timeout" } }), undefined);
  assert.ok(app.includes("if(t===undefined){ if(!filmOwnerTierSeenRef.current){ clearTimeout(retry); retry = setTimeout(()=>{ if(live) load(); }, 15000); } return; }"));
});
await test("B2 below Producer the Stage editor role pauses (the rest of a person's roles still work) and it's said once", ()=>{
  assert.ok(app.includes('const stageRolePaused = isSharedFilm && filmOwnerTier==="director" && String(shareRole||"").split("+").includes("stage_editor");'));
  assert.ok(app.includes('const _rolesNow = stageRolePaused ? String(shareRole).split("+").filter(r=>r!=="stage_editor").join("+") : shareRole;'));
  assert.ok(app.includes("Renders that were already running still finish and land in the film."));
  assert.ok(team.includes('" (Stage editor paused: Producer plan)"'), "the owner's Team window says so");
});
await test("B3 why a shared film is read-only, in one sentence, for every reason", ()=>{
  const w = between(app, "const sharedReadOnlyWhy = ", "\n    : \"\";");
  for(const k of ["ownerPlanLapsed", "sharingPaused", "sharedOffList", "stageRolePaused"]) assert.ok(w.includes(k), k);
  assert.equal((app.match(/const note=sharedReadOnlyWhy \|\| \(\(typeof window\.teamRoleScopeNote==="function"\)\?window\.teamRoleScopeNote\(writeRole\):""\);/g)||[]).length, 2);
  assert.ok(app.includes('(ownerPlanLapsed || sharingPaused || sharedOffList || stageRolePaused) ? "Read-only for now — " : "View-only access — "'));
  assert.match(team, /Your Stage editor role covers the Stage's takes, dialogue and voicing/);
});

/* ═══ C ═══ */
await test("C1 a Stage editor's shot patch: the Stage's fields only (the database's list); designing stays with others", ()=>{
  assert.ok(app.includes('const STAGE_SHOT_FIELDS = ["lineAudio","dur","dialogue","dialogueLines","screenplayDialogueIndex","screenplayDialogueIndexes","vidText","stageCharacterReferenceOverrides"];'));
  const sql = read("supabase/team-relaunch.sql");
  for(const f of ["lineAudio","dur","dialogue","dialogueLines","screenplayDialogueIndex","screenplayDialogueIndexes","vidText","stageCharacterReferenceOverrides"])
    assert.ok(between(sql, "turn__stage_shot_fields", "$$;").includes("'"+f+"'"), "SQL: "+f);
  assert.ok(app.includes("if(!migration && shotsStageOnlyRef.current && Object.keys(patch||{}).some(k=>STAGE_SHOT_FIELDS.indexOf(k)<0)){ _stageScopeNotice(); return; }"));
  for(const h of ["const deleteShot = (id)=>{\n    if(!canDesignShots()) return;", "const restoreShot = (id)=>{\n    if(!canDesignShots()) return;",
    "const purgeShot = async (id)=>{\n    if(!canDesignShots()) return;", "const addShot = (sceneId, beatN, seed)=>{\n    if(!canDesignShots()) return;",
    "if(draftingAllShots) return;\n    if(!canDesignShots()) return;"]) assert.ok(app.includes(h), h.split("\n")[0]);
  assert.ok(app.includes("window.turnCanMutateShots = ()=> !projectLoadingRef.current && !shotsReadOnlyRef.current && !shotsStageOnlyRef.current;"), "frames too");
  // voicing a line is the Stage's
  assert.ok(between(app, "const voiceLine = async (shot)=>{", "};").includes("if(!canMutateShots()) return;"));
});
await test("C2 the Stage tells a Stage editor who can fix shots, instead of opening a read-only room", ()=>{
  assert.ok(stage.includes('" The film\'s owner or Art director can fix the frames in Shots."'));
  assert.ok(stage.includes('" Ask the film\'s owner or Art director to add or split shots."'));
  assert.ok(app.includes("window.turnArtRoomWritable = ()=> !artRoomReadOnlyRef.current;"));
});

/* ═══ D ═══ */
const mergeBox = {}; vm.createContext(mergeBox);
vm.runInContext(between(cloud, "function _shotsJson(v){", "window.turnShotsMergePerShot")+";this.m=_shotsMergePerShot;", mergeBox);
await test("D1 shot by shot: each side's changes survive; a deleted-but-edited shot is kept; new shots land in place", ()=>{
  const base = [{ id:"a", dialogue:"x", status:"draft" }, { id:"b", v:1 }, { id:"c", v:1 }];
  const local = [{ id:"a", dialogue:"y", status:"draft" }, { id:"n", v:9 }, { id:"b", v:1 }];          // Stage: dialogue; added n; deleted c
  const remote = [{ id:"a", dialogue:"x", status:"approved" }, { id:"b", v:2 }, { id:"c", v:1 }, { id:"r", v:3 }]; // AD: approved a, changed b, added r
  assert.deepEqual(JSON.parse(JSON.stringify(mergeBox.m(base, local, remote))),
    [{ id:"a", dialogue:"y", status:"approved" }, { id:"n", v:9 }, { id:"b", v:2 }, { id:"r", v:3 }]);
  // deleted here, edited there → kept
  assert.deepEqual(JSON.parse(JSON.stringify(mergeBox.m([{ id:"a", v:1 }], [], [{ id:"a", v:2 }]))), [{ id:"a", v:2 }]);
  // shots without ids: the old whole-list save
  assert.equal(mergeBox.m([{ v:1 }], [{ v:2 }], [{ v:3 }])[0].v, 2);
});
await test("D2 the save sends the last shots this window saw and adopts the merged list", ()=>{
  assert.ok(app.includes("if(shotsBase) out.shotsBase=shotsBase;"));
  assert.ok(cloud.includes("next.shots=_shotsMergePerShot(opts.shotsBase, sections.shots, cloudDoc.shots);"));
  assert.ok(cloud.includes("if(mergedShots!==undefined) done.shots = mergedShots;"));
  assert.ok(app.includes("_adoptTheirs(result.doc,_mineKeys,result.project,result.shots);") && app.includes("_adoptTheirs(ep.r.doc,_mineKeys,ep.r.project,ep.r.shots);"));
  assert.ok(between(app, "const _adoptTheirs = (cloudDoc, mineKeys, mergedProject, mergedShots)=>{", "if(!cloudDoc){").includes("try{ setShots(mergedShots); adopted++; }catch(e){}"));
});

/* ═══ E ═══ */
await test("E1 Delete take: only the person who made it, or the owner", ()=>{
  assert.ok(stage.includes('const mine = !sel || typeof window.vidTakeDeletable!=="function" || window.vidTakeDeletable(sel);'));
  assert.ok(stage.includes('"Only the person who made this take, or the film\'s owner, can delete it"'));
});
await test("E2 a take from an untrusted address is listed but never played or offered for download", ()=>{
  const box = {}; vm.createContext(box);
  vm.runInContext(between(stage, "function _stageTakeRows(list){", "\n}\n")+"\n}\nthis.f=_stageTakeRows;", box);
  const rows = JSON.parse(JSON.stringify(box.f([{ url:"https://v3.fal.media/a.mp4" }, { url:"", rawUrl:"https://evil.example/x.mp4", unavailable:true }, { url:"" }])));
  assert.deepEqual(rows, [{ url:"https://v3.fal.media/a.mp4" }, { url:"https://evil.example/x.mp4", rawUrl:"https://evil.example/x.mp4", unavailable:true }]);
  assert.ok(stage.includes("t.unavailable ? _stEl(\"div\",{className:\"stage2-source-warning stale\",role:\"status\"}"))   // (2026-10-24) each compare pane;
  assert.ok(stage.includes('sel && !sel.unavailable && _stEl("a",{className:"stage2-vtool link"'));
});
await test("E3 renders that finished while the owner was away are added when the owner opens the film", ()=>{
  assert.ok(app.includes("Promise.resolve(window.vidCollectPendingTakes(id)).then(n=>{"));
  assert.ok(cloud.includes('sb.rpc("turn_film_pending_takes", { pid:projectId })') && cloud.includes('sb.rpc("turn_film_mark_takes_collected", { pid:projectId, refs:list })'), "the database's parameter names");
  assert.ok(stage.includes("u=await vgLoadAudio(sh.id, undefined, { hash:sh.lineAudio && sh.lineAudio.hash });"), "the matching voicing");
});

/* ═══ F ═══ */
await test("F1 every new refusal in plain words; none opens Plans", ()=>{
  const box = { console }; box.window = box; vm.createContext(box);
  vm.runInContext("const BILLING_EMAIL='x';"+between(plans, "const BILLING_CODES = {", "window.turnBillingError = billingError;")+";this.f=billingError;", box);
  const r = box.f({ error:"film_access", code:"film_access" }, 403);
  assert.ok(r && r.openPlans===false && /not on this film's team/.test(r.message));
  const t = between(cloud, "const TEAM_REFUSALS = {", "};");
  for(const k of ["role_paused", "owner_plan", "stage_scope", "stage_slot", "cleanup_path", "take_owner"]) assert.ok(t.includes(k+":"), k);
});
await test("F2 Frances: what the role saves, who pays in the Stage, voiced lines, takes, renders that land", ()=>{
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  const w = fb.__F.find(f=>f.name==="Team collaboration").what;
  for(const gone of ["saves Stage work — shots' takes, voices", "for the Stage's files, on a Producer film", "the Art director and the Stage editor. Every"]) assert.ok(!w.includes(gone), gone);
  for(const now of ["adding or splitting shots, and the shots' designs and frames, stay with the owner and the Art director", "IN THE STAGE ON SOMEONE ELSE'S FILM",
    "VOICED LINES are saved to the film", "only the person who made a take, or the film's owner, can delete it", "RENDERS THAT WERE ALREADY RUNNING", "'Stage editor paused'"])
    assert.ok(w.includes(now), now);
});
await test("F3 keys", ()=>{
  for(const f of ["app", "stage", "team", "cloud", "plans", "ai", "script", "videogen", "voicegen"])
    assert.ok(["20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f);   // (later passes re-key some)
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

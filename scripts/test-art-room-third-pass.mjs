#!/usr/bin/env node
/* The Art Room, third pass (owner 2026-10-09: "go ahead with all of it") — the room around its tabs, and the
   Department Heads.
   A  Department Heads: rights after every model answer, Stop starts no new image, honest traces (nothing reads
      "generated" or "applied" unless it was), the Coordinator names a step that stopped, plain errors, the
      render style keeps cards' own styles, what each run uses said before and after
   B  Recently deleted: never a live card's files, everything named, role checks, film checks
   C  the image engine: chips include what the server adds, grounding only on Nano Banana 2, only a request that
      never left is re-sent, every window shows the same engine, plain errors, a Writer's 4K capped
   D  the room: read-only roles can't open a run, previews are dialogs, a stale tab opens the Lookbook, hand-offs
      only when the room opens and only in their film, the dock's labels and pressed states
   E  Frances and keys
     node scripts/test-art-room-third-pass.mjs */
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

const app = read("app/app.jsx"), agents = read("app/agents.jsx"), agUi = read("app/agents-ui.jsx"), art = read("app/artroom.jsx"),
  img = read("app/imagegen.jsx"), plans = read("app/plans.jsx"), chrome = read("app/chrome.jsx"), shotsUi = read("app/shots-ui.jsx"),
  ai = read("app/ai.jsx"), html = read("TURN.html");

/* ═══ A ═══ */
await test("A1 a role that loses the Art Room writes nothing more, and the run says why", ()=>{
  const f = between(app, "    const inFilm = (fn)=> (...args)=>{", "    const _w = {");
  assert.ok(f.includes("if(roleLost()){") && f.includes("Your role can no longer change the Art Room, so this run stopped"));
  assert.ok(app.includes("      switchedFilms, roleLost,"));
  assert.ok(agUi.includes("else if(ctx && typeof ctx.roleLost===\"function\" && ctx.roleLost())"));
});
await test("A2 Stop starts no new image; a 'no image' retry only while live, and said", ()=>{
  const g = between(app, "    const _genCharImage = async (slotId, prompt, opts)=>{", "    const cast = {");
  assert.ok(g.includes('const beforeSubmit = ()=>{ if(cancelled && cancelled()) throw new Error("Stopped \\u2014 no new image was started."); };'));
  assert.ok(g.includes("{ ...gopts, assetId:slotId, beforeSubmit }"));
  assert.ok(g.includes("&& !(cancelled && cancelled())){") && g.includes("so it asked once more (one more image)"));
});
await test("A3 the Production check's art changes: its film, the role now, an undo step, and never 'applied' unless saved", ()=>{
  assert.ok(app.includes("patchProp:(id,patch)=>{ if(!_prodArtOk(\"props\")) return false; _prodArtSnap();"));
  assert.ok(app.includes("patchLocation:(id,patch)=>{ if(!_prodArtOk(\"locations\")) return false; _prodArtSnap();"));
  assert.ok(app.includes("const _prodArtOk = (section)=> String(ownerProjectId||\"\")===String(projIdRef.current||\"\") && !artRoomReadOnlyRef.current"));
  assert.ok(app.includes("if(Object.keys(patches).length){ _prodArtSnap();") && app.includes("        return true;\n      }"));
  assert.ok(between(app, 'initialAgentId:"production", single:true,', "aiOn:").includes("...artUndoProps,"));
  assert.ok(!/ctx\.sync\(\); fixes\+\+; refresh\(\);/.test(agents) && agents.includes("if(ctx.sync()===false) return; fixes++; refresh();"));
  assert.equal((agents.match(/Not applied \\u2014 the film changed or your role can't change it now\./g)||[]).length >= 4, true);
  assert.ok(agents.includes('const ok = ctx.cancelled() ? false : await ctx.propose({ writes:"art",'));
});
await test("A4 honest traces: failed prop sheets, empty specs, failed looks, staging, research, prop briefs", ()=>{
  assert.ok(agents.includes('if(r===false){ ctx.emit({k:"flag", t:"Couldn\'t generate "+(p.name||"the prop")+"\'s sheet. Moving on."}); continue; }'));
  assert.ok(app.includes('if(!map) throw new Error("no specs came back");   // said out loud — it read "Specs already complete" (2026-10-09)'));
  assert.ok(agents.includes("'s look couldn't be drafted (\"+specErr+\") — skipping.") && agents.includes("Couldn't find \"+(c.name||\"the character\")+\"'s appearance changes"));
  assert.ok(app.includes("stagingFailed = res.filter(x=>!x.staging)") && agents.includes("Couldn't stage \"+failedS.join(\", \")"));
  assert.ok(agents.includes('ctx.emit({k:"done", t:"Nothing changed.", status:"failed"}); return { failed:true }; }'));
  assert.ok(app.includes("return { statement:\"\", added:0, failed:true };"));
  assert.ok(!agents.includes("pm.deriveCast()"), "(2026-10-29) no brief step left to fail");
});
await test("A5 Run pre-production names a step that stopped, and keeps the styles cards already have", ()=>{
  const co = between(agents, "async function agentDepartmentCoordinator(ctx){", "/* ---- Consistency Check");
  assert.ok(co.includes('if(e && e.k==="done" && e.status==="failed") stepFailed = true;') && co.includes("if(stepFailed || (r && r.failed)) errored.push(step[0]);"));
  assert.ok(agents.includes('ctx.emit({k:"done", t:"Aborted \\u2014 nothing changed.", status:"failed"}); return;'));
  assert.ok(agents.includes("lb.applyRenderStyle(rs.key, { onlyUnset:!!ctx.autoApprove })"));
  // the rule, run for real
  const b = {}; vm.createContext(b);
  vm.runInContext(`const onlyUnset = true; const take = (x)=> !onlyUnset || !(x && x.renderStyleKey);
    this.out = [{ id:"a", renderStyleKey:"anime" }, { id:"b" }].map(c=> take(c) ? ({ ...c, renderStyleKey:"photoreal" }) : c);`, b);
  assert.deepEqual(JSON.parse(JSON.stringify(b.out)), [{ id:"a", renderStyleKey:"anime" }, { id:"b", renderStyleKey:"photoreal" }]);
  assert.ok(app.includes("const take = (x)=> !onlyUnset || !(x && x.renderStyleKey);"));
});
await test("A6 plain words for service plumbing errors", ()=>{
  const b = { window:{}, String }; b.window = b; vm.createContext(b); vm.runInContext(fn(agents, "agentErrText"), b);
  assert.equal(b.agentErrText(new Error("The image server didn't answer — fal.ai may be rate-limited or the image-proxy needs a redeploy.")), "the image service took too long to answer — try again in a moment");
  assert.equal(b.agentErrText(new Error("Discarded — the film changed while this sheet rendered (stale scope)")), "the film changed while it was being made, so it wasn't saved");
  assert.equal(b.agentErrText(new Error("Couldn't reach the image proxy: x")), "the service didn't answer — try again in a moment");
  assert.ok(!/String\(\(e && e\.message\) \|\| "the writing model/.test(agents) && agents.includes("failure = agentErrText(e) || \"the writing model couldn't be reached\";"));
});
await test("A7 what a run uses: said before (per Department Head) and after (writing calls AND images)", ()=>{
  assert.ok(agUi.includes("const costLine = agent.costLine ? agent.costLine"));
  assert.ok(agUi.includes('window.addEventListener("nb-image-made", h);') && agUi.includes("This run made \"+imgs+\" and no writing-model calls"));
  assert.ok(agUi.includes('"This run made no writing-model calls and no images — it cost nothing."'));
  assert.ok(agUi.includes("A writing call or image already on its way still finishes \\u2014 it's charged, and an image is kept; nothing new is started."));
  assert.ok(img.includes('window.dispatchEvent(new CustomEvent("nb-image-made",{ detail:{ credits:(cr>0 ? cr : null), model } }));'));
  const reg = between(agents, "const AGENTS = [", "window.AGENTS = AGENTS;");
  for(const id of ["production","colorist","shotdesigner","casting","propsmaster","locscout","researcher","coordinator"]){
    const i = reg.indexOf('id:"'+id+'"'); const j = reg.indexOf("{ id:", i+5);
    assert.ok(reg.slice(i, j<0 ? undefined : j).includes("costLine:"), id);
  }
  assert.ok(reg.includes("asksApproval:true,") && agUi.includes("(agent.autonomous && !agent.asksApproval)?"));
  assert.ok(agUi.includes('"aria-label":(active && typeof window.turnAgentUmbrella==="function") ? window.turnAgentUmbrella(active) : "Story Editors"'));
});

/* ═══ B ═══ */
await test("B1 'Delete forever' never touches a live character's files; Restore on a live twin says so", ()=>{
  const pc = between(app, "  const purgeCharacter = async (id)=>{", "  const [charDrafting, setCharDrafting]");
  assert.ok(pc.includes("const live = (characters||[]).some(c=>c && c.id===id);") && pc.includes("if(!live){"));
  assert.ok(pc.includes("if(projIdRef.current!==film0) return;"));
  assert.ok(app.includes("is already in the cast, so the copy in Recently deleted stays there."));
});
await test("B2 the warning names everything that goes; bins are labelled", ()=>{
  assert.ok(art.includes('kind==="character" ? "master sheet, appearance-variant sheets and scale sheet, the likeness photos you uploaded (on this device and in the cloud) and its voice"'));
  assert.ok(art.includes('kind==="prop" ? "reference sheet and its state sheets"'));
  assert.ok(art.includes('"aria-label":"Restore "+labelFor(it),') && art.includes('className:"rd-head",onClick:()=>setOpen(o=>!o),"aria-expanded":open?"true":"false"'));
});
await test("B3 the Lookbook bin checks the role and the film; a live twin keeps its mood frame", ()=>{
  for(const k of ["updateLookbookCard = (id,patch)=> canMutateSharedFilm() &&", "const addLookbookCard = ()=>{\n    if(!canMutateSharedFilm()) return null;",
    "const deleteLookbookCard = (id)=>{\n    if(!canMutateSharedFilm()) return;", "const restoreLookbookCard = (id)=>{\n    if(!canMutateSharedFilm()) return;"])
    assert.ok(app.includes(k), k);
  const pl = between(app, "  const purgeLookbookCard = async (id)=>{", "  /* SUGGEST A NOTE");
  assert.ok(pl.includes("if(!canMutateSharedFilm()) return;") && pl.includes("if(!liveTwin && typeof nbClearAsset===\"function\")") && pl.includes("if(projIdRef.current!==film0) return;"));
  // user-facing copy says "Recently deleted" (comments may still say Trash)
  assert.ok(!app.split("\n").some(l=>!l.trim().startsWith("//") && /remains in Trash|Shots Trash/.test(l)));
});

/* ═══ C ═══ */
await test("C1 price chips include grounding and GPT reference images; grounding is sent only on Nano Banana 2.1 (2026-10-11)", ()=>{
  const c = fn(img, "nbImageCredits");
  assert.ok(c.includes('if(ground && nbModelGrounds(model)) usd += 0.015;') && c.includes("usd += 0.012 * Number(opts.refs);"));
  assert.ok(img.includes('const NB_GROUND_MODELS = ["gemini-nano-banana-2.1"];'));
  assert.ok(art.includes("if(groundEnabled && groundsWeb){ genOpts.groundSearch = true; }"));
  assert.ok(img.includes('" · each reference image the render attaches adds about 1 credit"'));
});
await test("C2 only a request that never left is re-sent; a pick in another window shows here; plain errors, no provider names", ()=>{
  assert.ok(img.includes("&& /failed to send|name_not_resolved|internet_disconnected|network changed/i.test("));
  assert.ok(img.includes('window.addEventListener("storage", (e)=>{'));
  for(const bad of ["fal.ai may be rate-limited", "Deploy supabase/functions/image-proxy", "Couldn't reach the image proxy", "Image generation now runs through fal.ai", 'note:"fal.ai', "Update image-proxy to enable"])
    assert.ok(!img.includes(bad), bad);
  assert.ok(!art.includes("(top of this tab)") && !shotsUi.includes("at the top of this tab"));
});
await test("C3 a Writer's 4K image is capped to 2K before it's sent, and the chip says what's really used", ()=>{
  const b = { window:{ turnIsAdmin:false }, String }; b.window.window = b.window; vm.createContext(b);
  vm.runInContext("const window=this.window;\nconst _isPaidTier=(p)=>p==='writer'||p==='director'||p==='studio';\nconst IMG_RES_RANK={'1K':1,'2K':2,'4K':3};const DRAFT_IMAGE={model:'lite',maxRes:'1K'};\n"
    +fn(plans, "draftImagesOnly")+fn(plans, "planImageChoice"), b);
  assert.deepEqual(JSON.parse(JSON.stringify(b.planImageChoice("nb2", "4K", { plan:"writer" }))), { model:"nb2", res:"2K", limited:true });
  assert.deepEqual(JSON.parse(JSON.stringify(b.planImageChoice("nb2", "4K", { plan:"director" }))), { model:"nb2", res:"4K", limited:false });
  assert.ok(img.includes('+ (choice.limited ? " (your plan\'s limit)"'));
});

/* ═══ D ═══ */
await test("D1 read-only roles can't open a Department Head; a role change closes runs and previews", ()=>{
  for(const k of ["shotDesignerOpen && !artRoomReadOnly &&", "castingOpen && !artRoomReadOnly &&", "propsMasterOpen && !artRoomReadOnly &&",
    "locScoutOpen && !artRoomReadOnly &&", "researchOpen && !artRoomReadOnly &&", "coordOpen && !artRoomReadOnly &&"]) assert.ok(app.includes(k), k);
  assert.ok(app.includes('onResearch:()=>{ if(artRoomReadOnlyRef.current){ _mutationNotice("art"); return; } setResearchOpen(true); },'));
  assert.ok(app.includes("setCoordConfirm(false); setCastConfirm(null); setCastingOpen(false);"));
  assert.ok(chrome.includes("Your role can't change the Art Room here, so pre-production can't run"));
});
await test("D2 the run previews are dialogs (Escape, focus); the Run pre-production preview shows a price and 'at least'", ()=>{
  assert.equal((art.match(/usePreviewDialog\(onCancel\);/g)||[]).length, 2);
  assert.ok(art.includes('role:"dialog","aria-modal":"true",tabIndex:-1,ref:_previewFocus,'));
  assert.ok(art.includes('"at least "+totalGen') && art.includes('typeof window.nbCostChip==="function" && window.nbCostChip(totalGen)'));
  assert.ok(art.includes('p.kind!=="worn" && !((p.kind||"carried")==="carried" && !p.ownerId)'));
});
await test("D3 a stale tab opens the Lookbook; hand-offs only when the room opens, and only in their film", ()=>{
  const b = { window:{ ART_TABS:[{ id:"lookbook" }, { id:"shots" }] }, String, Array }; vm.createContext(b);
  vm.runInContext("const window=this.window;\n"+fn(app, "turnNavArtTab"), b);
  assert.equal(b.turnNavArtTab("gone"), "lookbook"); assert.equal(b.turnNavArtTab("shots"), "shots"); assert.equal(b.turnNavArtTab("voices"), "lookbook");
  assert.ok(app.includes('if(tab==="shots"){ if(!guardedSetRoom("art")) return;') && app.includes("    setRoom(id);\n    return true;\n  };"));
  assert.ok(art.includes("(f.film||null)===(window.turnOpenFilmId||null)) ? f : null; };"));
});
await test("D4 the dock: Nano Banana 2.1 and GPT quality shown, Escape, pressed states, a region", ()=>{
  assert.ok(art.includes(': model==="gemini-nano-banana-2.1" ? "NB2.1"') && art.includes('isGpt && qual ? qual : (typeof nbModelRes==="function" ? nbModelRes(model, resv) : resv)'));
  assert.ok(art.includes('role:"region","aria-label":"Image engine settings"') && art.includes('"aria-controls":"nb-dock-panel"'));
  assert.ok((art.match(/"aria-pressed":/g)||[]).length >= 7);
});

/* ═══ E ═══ */
await test("E1 Frances: tabs open, the bins, the dock, the chips, the Department Heads; keys", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const all = fb.__F.map(f=>f.what||"").join(" ");
  for(const gone of ["UNLOCK IN THAT ORDER", "clears its sheet.", "after 2 minutes", "clear the look statement in the Lookbook", "'Generate all frames'", "Styles (colour) tab"])
    assert.ok(!all.includes(gone), gone);
  const ar = (fb.__F.find(f=>f.name==="Art Room")||{}).what || "";
  assert.ok(/ART ROOM REVIEW, THIRD PASS/.test(ar) && /Every tab is open/.test(ar) && /web grounding/.test(ar));
  assert.ok(/DEPARTMENT HEADS, THIRD PASS/.test((fb.__F.find(f=>f.name==="Story Editors (Writers' Room agents)")||{}).what || ""));
  for(const f of ["app", "ai", "script", "agents", "agents-ui", "artroom", "imagegen", "plans", "shots-ui", "chrome"])
    assert.ok(["20261009-art3", "20261009-home3", "20261009-teamrv1", "20261009-stageed1", "20261009-sb4", "20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs135", "20261029-hs136", "20261029-hs142", "20261029-hs137", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261029-hs138", "20261029-hs143", "20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261029-hs139", "20261029-hs140", "20261029-hs141", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f);   // (later passes re-key some)
});

console.log((failed ? "RESULT: FAIL — " : "RESULT: PASS — ")+checks+" passed, "+failed+" failed");
if(failed) process.exit(1);

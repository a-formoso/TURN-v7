#!/usr/bin/env node
/* The Props tab, second pass (owner 2026-10-08: "go ahead with all of it") — does it tell the truth?
   A  'Prop reference changed' is exact: a frame records only its in-frame props (state, description,
      attached sheet version); a cold image cache never flags; old stamps keep the old check; the Stage
      take does the same per shot
   B  frames and boards use what they attach: the current holder in the prompt, the Stage's close-up
      gate and real state variants, the Storyboards "Built from" thumbnails
   C  the film: edit rights, restore / purge / merge keep work, the bin isn't re-seeded from the cast
   D  spending: the batch always asks with the price, the Props Master follows the batch rules, the
      draft retry, Surprise me and the critique say what they cost
   E  wardrobe: a deleted last worn sheet still flags the master; the Breakdown's worn rule
   F  copy: the photo prompt's layout, the edit background, cleared variants, the edit record's field
   G  Frances knows
     node scripts/test-props-second-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const props = read("app/props.jsx"), shots = read("app/shots.jsx"), shotsUi = read("app/shots-ui.jsx"), stage = read("app/stage.jsx"),
  stageRefs = read("app/stage-references.jsx"), sb = read("app/storyboard.jsx"), app = read("app/app.jsx"), art = read("app/artroom.jsx"),
  ai = read("app/ai.jsx"), bd = read("app/breakdown.jsx");

/* ═══ A — the v2 dependency record, run for real ═══ */
const box = { console, Object, Array, String, Number, Math, JSON, Set, Map };
box.window = box; vm.createContext(box);
vm.runInContext(between(props, "function propTextSig(p){", "window.propTextSig = propTextSig;"), box);
vm.runInContext(between(stage, "function stageClipPropDependenciesV2(", "window.stageClipPropDependenciesV2 = stageClipPropDependenciesV2;"), box);
const images = {}, metas = {};
const states = {};   // propId → state the story gives it
box.nbGetImage = (id)=> images[id] || "";
box.nbGetMeta = (id)=> metas[id] || null;
box.propStateAt = (p)=> states[p.id] || { bindingMode:"carried", holderId:"ana", condition:"intact", visibility:"visible" };
const P = ()=>[{ id:"cup", name:"Cup", form:"tin mug", material:"enamel" }, { id:"key", name:"Key", form:"brass key", material:"brass" },
  { id:"map", name:"Map", form:"folded map", material:"paper" }];
const rec = (inFrame, attached)=> box.propFrameDependencies(inFrame, attached||{}, P(), "s1", 1, "", "a1", {});

await test("A1 a frame records only its in-frame props; a sheet it attached by version, the others by description", ()=>{
  images.cup = "data:cup"; metas.cup = { iso:"2026-10-01" };
  const r = rec(["cup", "key"], { cup:"cup" });
  assert.ok(r.startsWith("pd2|"));
  const list = JSON.parse(r.slice(4));
  assert.deepEqual(list.map(x=>x.id), ["cup", "key"], "the map is in the scene but not in this frame");
  assert.equal(list[0].sheet, "cup"); assert.equal(list[0].rev, "2026-10-01"); assert.equal(list[0].text, "");
  assert.equal(list[1].sheet, ""); assert.match(list[1].text, /Key~brass key~brass/);
});
await test("A2 only a real change flags: a regenerated sheet, a new state, a new description — not another prop", ()=>{
  images.cup = "data:cup"; metas.cup = { iso:"2026-10-01" };
  const stored = rec(["cup", "key"], { cup:"cup" });
  assert.equal(box.propDependenciesChanged(stored, rec(["cup", "key"], { cup:"cup" })), false);
  metas.cup = { iso:"2026-10-07" };
  assert.equal(box.propDependenciesChanged(stored, rec(["cup", "key"], { cup:"cup" })), true, "the attached sheet was remade");
  metas.cup = { iso:"2026-10-01" };
  states.key = { bindingMode:"carried", holderId:"ben", condition:"intact", visibility:"visible" };
  assert.equal(box.propDependenciesChanged(stored, rec(["cup", "key"], { cup:"cup" })), true, "the key changed hands");
  delete states.key;
  const changedKey = box.propFrameDependencies(["cup", "key"], { cup:"cup" }, P().map(p=> p.id==="key" ? { ...p, material:"iron" } : p), "s1", 1, "", "a1", {});
  assert.equal(box.propDependenciesChanged(stored, changedKey), true, "a text-only description changed");
  images.map = "data:map"; metas.map = { iso:"2026-10-07" };
  assert.equal(box.propDependenciesChanged(stored, rec(["cup", "key"], { cup:"cup" })), false, "the map isn't in this frame");
});
await test("A3 a cold image cache never flags; an old stamp keeps the old check", ()=>{
  images.cup = "data:cup"; metas.cup = { iso:"2026-10-01" };
  const stored = rec(["cup"], { cup:"cup" });
  delete images.cup; delete metas.cup;   // after a reload, before the store answers
  assert.equal(JSON.parse(rec(["cup"], { cup:"cup" }).slice(4))[0].rev, "?");
  assert.equal(box.propDependenciesChanged(stored, rec(["cup"], { cup:"cup" })), false);
  assert.equal(box.propDependenciesChanged("cup:carried:ana", "pd2|[]", "cup:carried:ana"), false);
  assert.equal(box.propDependenciesChanged("cup:carried:ana", "pd2|[]", "cup:carried:ben"), true);
  assert.equal(box.propDependenciesChanged(null, "pd2|[]", "x"), false);
});
await test("A4 a Stage take records each shot's in-frame props, and an old take keeps the old string check", ()=>{
  box.inFrameProps = (sh)=> sh.props || [];
  const C = { props:P(), characters:[], scenes:[{ id:"s1" }] };
  const clip = { shots:[{ id:"a1", beatN:1, props:["cup"] }, { id:"a2", beatN:2, props:["key"] }] };
  const stamp = box.stageClipPropDependenciesV2(clip, "s1", C);
  assert.ok(stamp.startsWith("pdc2|"));
  assert.deepEqual(Object.keys(JSON.parse(stamp.slice(5))), ["a1", "a2"]);
  assert.equal(box.stageClipPropDependenciesChanged(stamp, clip, "s1", C), false);
  const C2 = { ...C, props:P().map(p=> p.id==="key" ? { ...p, form:"iron key" } : p) };
  assert.equal(box.stageClipPropDependenciesChanged(stamp, clip, "s1", C2), true);
  box.stageClipPropDependencySignature = ()=> "old";
  assert.equal(box.stageClipPropDependenciesChanged("old", clip, "s1", C), false);
  assert.equal(box.stageClipPropDependenciesChanged("older", clip, "s1", C), true);
});
await test("A5 Shots records and compares the v2 record; the Stage stores and reads it", ()=>{
  const fn = between(shots, "function shotPropDependencies(sh, sceneShots, ctx){", "window.shotPropDependencies = shotPropDependencies;");
  assert.ok(fn.includes("plan.propSpec") && fn.includes("plan.carrySpec") && fn.includes("off.indexOf(base)<0") && fn.includes("inFrameProps("));
  assert.ok(shotsUi.includes("propDependencies:_keep(\"propDependencies\", (typeof shotPropDependencies===\"function\") ? shotPropDependencies(sh, sceneShots, ctx)"));
  assert.ok(shotsUi.includes("propDependenciesChanged(gen.genMeta.propDependencies,"));
  assert.ok(stage.includes("propDependencies:(typeof stageClipPropDependenciesV2===\"function\")"));
  assert.ok(stage.includes("stageClipPropDependenciesChanged(meta.propDependencies,"));   // the shared take notes (2026-10-09)
});

/* ═══ B ═══ */
await test("B1 the prompt names the CURRENT holder; the Stage attaches close-up sheets only on tight shots and only real variants", ()=>{
  assert.ok(shots.includes("return (rs && rs.holderName) || p.ownerName || \"\";"));
  assert.ok(shots.includes("wornProps.map(p=> p.name+\" (on \"+(_holderOf(p)||\"its owner\")+\")\")"));
  assert.ok(stageRefs.includes("if(typeof g.shotPropAttachable===\"function\"){ try{ if(!g.shotPropAttachable(p,sh,scene)) return; }catch(e){} }"));
  assert.ok(stage.includes("const stateAsset=(rs&&rs.referenceAssetId&&typeof nbGetImage===\"function\"&&nbGetImage(rs.referenceAssetId)) ? rs.referenceAssetId : \"\";"));
});
await test("B2 Storyboards 'Built from' shows exactly the prop sheets the panels used", ()=>{
  const b = { console, Object, Array, String, Set }; b.window = b; vm.createContext(b);
  vm.runInContext(between(sb, "function sbPropRefsForPage(scene, shots, ctx){", "window.sbPropRefsForPage = sbPropRefsForPage;"), b);
  b.inFrameProps = (sh)=> sh.props;
  b.shotPropAttachable = (p, sh)=> !(p.kind==="worn" && sh.size!=="CU");
  b.shotPropSheetId = (p, sc, scs, beat)=> beat===2 && p.id==="cup" ? { id:"cup:broken", state:{ label:"Broken" } } : { id:p.id, state:null };
  const ctx = { propById:{ cup:{ id:"cup", name:"Cup" }, hat:{ id:"hat", name:"Hat", kind:"worn" } } };
  assert.deepEqual(J(b.sbPropRefsForPage({ id:"s1" }, [{ id:"a1", beatN:2, size:"WS", props:["cup", "hat"] }], ctx)),
    [{ propId:"cup", sheetId:"cup:broken", label:"Cup · Broken" }]);
  assert.equal(b.sbPropRefsForPage({ id:"s1" }, [{ id:"a1", beatN:1, size:"CU", props:["hat"] }], ctx)[0].sheetId, "hat");
  assert.ok(!/sbPropIdsForPage\(/.test(sb));
});

/* ═══ C ═══ */
await test("C1 only an Art Room-writing role changes props", ()=>{
  for(const fn of ["const updateProp = (id,patch)=>{", "const addProp = ()=>{", "const importScreenplayProps = (decisions)=>{", "const deleteProp = (id)=>{",
    "const restoreProp = (id)=>{", "const purgeProp = async (id)=>{", "const mergeProps = async (ids, survivorId)=>{"]){
    const i = app.indexOf(fn); assert.ok(i>0, fn);
    assert.ok(app.slice(i, i+200).includes("if(!canMutateSharedFilm()) return;"), fn);
  }
});
await test("C2 restore says why it waits; purge keeps a live card's sheet and the variants a live card uses", ()=>{
  const restore = between(app, "const restoreProp = (id)=>{", "const purgeProp");
  assert.ok(restore.includes("is already on the board, so the copy in Recently deleted stays there."));
  const purge = between(app, "const purgeProp = async (id)=>{", "const mergeProps");
  assert.ok(purge.includes("const live = (props||[]).some(p=>p && p.id===id);") && purge.includes("!live"));
  assert.ok(purge.includes("item.continuityEvents") && purge.includes("!usedLive.has(x)"));
});
await test("C3 merge asks, keeps the others' work, bins them restorably and points the shots at the survivor", ()=>{
  const m = between(app, "const mergeProps = async (ids, survivorId)=>{", "const removeOwnedProp");
  assert.ok(m.includes("title:\"Merge \"+set.length+\" cards into \\u201c\"") && m.includes("if(!ok) return;"));
  for(const f of ["contentNotes", "identityNote", "signatureFeature", "size"]) assert.ok(m.includes("\""+f+"\""), f);
  assert.ok(m.includes("cat(\"continuityEvents\")") && m.includes("cat(\"screenplaySources\")") && m.includes("cat(\"referenceImages\")") && m.includes("patch.aliases = names"));
  assert.ok(m.includes("mergedInto:survivor.id") && !m.includes("nbClearAsset"));
  assert.ok(m.includes("referencePropIds:swap(sh.referencePropIds), refOff:swap(sh.refOff), props:swap(sh.props)"));
});
await test("C4 a deleted prop doesn't come back from the cast — nothing is made from the cast any more (2026-10-29)", ()=>{
  assert.equal((app.match(/propsFromCast\(/g)||[]).length, 0);
  assert.ok(app.includes("deriveCast: ()=> 0,"));
});

/* ═══ D ═══ */
await test("D1 'Generate N missing' always asks with the price on the Props tab (other tabs unchanged)", ()=>{
  const begin = between(art, "const begin = async (ids, undraftedSkipped, opts)=>{", "const cancel = ()=>{");
  assert.ok(begin.includes("if(!existing.length && !(opts && opts.alwaysAsk)){ setMsg(\"\"); run(missing, 0); return; }"));
  assert.ok(art.includes("? (\"Generate \"+prompt.missing.length+\" \"+N+\" sheet\"+(prompt.missing.length!==1?\"s\":\"\")+\"? Each one spends image credits.\")"));
  assert.ok(art.includes("prompt.existing.length>0 && React.createElement(\"button\",{className:\"art-draftall\"+(prompt.missing.length?\" ghost\":\"\"),"));
  assert.equal((props.match(/\{ alwaysAsk:true \}\);/g)||[]).length, 2);
});
await test("D2 the Props Master makes new sheets by the batch's rules", ()=>{
  const g = between(app, "      toGenerate: async (force)=>{", "      generateSheet: async (p)=>{");
  for(const s of ["if(p.kind===\"worn\") continue;", "if((p.kind||\"carried\")===\"carried\" && !p.ownerId) continue;",
    "PS.sheetTier(p,drafts0).tier===\"text\") continue;", "if(PS && PS.batchSkip(p, extracted)) continue;", "PS.nameIssue(p.name)) continue;"]) assert.ok(g.includes(s), s);
  // (2026-10-12, owner) a proposal is never paid for, not even a forced refresh of a sheet it has
  assert.ok(g.indexOf("if(PS && PS.isProposal && PS.isProposal(p)) continue;") < g.indexOf("const has = await _grabImg(p.id);"));
  assert.ok(g.indexOf("if(!force && has) continue;") < g.indexOf("if(!has){"), "an existing sheet is still remade on a forced run");
});
await test("D3 a failed draft isn't paid for twice; Surprise me and the critique say they use writing credits", ()=>{
  const d = between(ai, "async function aiDesignPropBible(", "window.aiDesignPropBible = aiDesignPropBible;");
  assert.ok(d.includes("}catch(e){ return null; }") && d.includes("if(part && !Object.keys(part).length) part = await runBatch(items);"));
  assert.ok(props.includes("Re-roll a new surprise style \u2014 one small writing call (writing credits)"));
  assert.ok(props.includes("one vision call, writing credits") && props.includes("\"Uses writing credits\""));
  assert.ok(!/image-proxy/.test(between(props, "function PropFittingModal(", "\n}\n")));
});

/* ═══ E ═══ */
await test("E1 deleting the last worn sheet still flags the master for Wear props", async ()=>{
  const fnSrc = between(app, "      wornPropsWithSheets: async (c)=>{", "\n    };");
  const b = { console, Object, Array, String, Set, Promise }; b.window = b; vm.createContext(b);
  b.props = [{ id:"hat", name:"Hat", ownerId:"ana", kind:"worn" }];
  b.imgs = {}; b._grabImg = async (id)=> b.imgs[id] || "";
  b.meta = { wornReferences:[{ id:"hat", rev:"1" }] };
  b.nbLoadDetailsAsset = async ()=> ({ meta:b.meta });
  b.loadWornReferenceSnapshot = async (c, worn)=> worn.filter(p=>b.imgs[p.id]).map(p=>({ id:p.id, rev:"1" }));
  b.compareWornReferenceSnapshots = (had, now)=> JSON.stringify(had)===JSON.stringify(now) ? [] : ["changed"];
  vm.runInContext("var cast = {"+fnSrc.trim().replace(/,$/,"")+"};", b);
  const out = await b.cast.wornPropsWithSheets({ id:"ana" });
  assert.deepEqual(J(out).map(p=>p.id), ["hat"], "the hat card remains but its sheet is gone — the master still wears the old one");
  b.props = [];
  assert.deepEqual(J(await b.cast.wornPropsWithSheets({ id:"ana" })), [{ id:"__removed-worn-item", name:"a removed worn item" }]);
  b.meta = {};
  assert.deepEqual(J(await b.cast.wornPropsWithSheets({ id:"ana" })), [], "a master that never wore anything has nothing to update");
});
await test("E2 Breakdown: a worn item is ready on its owner's sheet; its close-up sheet is optional", ()=>{
  const b = { console, Object, Array, String, Number, Math, JSON, Set, Map, React:{ createElement:()=>null, useState:(v)=>[v, noop], useEffect:noop, useMemo:(f)=>f(), useRef:(v)=>({ current:v }) },
    localStorage:{ getItem:()=>null }, document:{}, addEventListener:noop, removeEventListener:noop };
  b.window = b; vm.createContext(b);
  vm.runInContext(transformSync(bd, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, b);
  b.sceneRoster = ()=>["ana"]; b.locationForScene = (l)=>l[0];
  const film = (made)=>({ scenes:[{ id:"s1", no:1, title:"Kitchen", loc:"INT. HOUSE - NIGHT" }], characters:[{ id:"ana", name:"Ana" }],
    props:[{ id:"hat", name:"Hat", kind:"worn", ownerId:"ana", ownerName:"Ana", scenes:["s1"] }], locations:[{ id:"house", name:"House" }],
    shots:[], drafts:{}, project:{}, img:(id)=>made.has(id), tierOf:()=>"own" });
  let [r] = b.breakdownRows(film(new Set(["ana", "house"])));
  assert.equal(r.wardrobe[0].ready, true); assert.equal(r.wardrobe[0].onOwner, true);
  assert.ok(!r.missing.some(m=>/Hat/.test(m.text)));
  [r] = b.breakdownRows(film(new Set(["house"])));
  assert.equal(r.wardrobe[0].ready, false);
  assert.ok(!r.missing.some(m=>/Hat/.test(m.text)) && r.missing.some(m=>/Ana/.test(m.text)), "the owner's sheet is what's missing");
  assert.ok(bd.includes("p.onOwner || !p.ready ? \"characters\" : \"props\""));
});

/* ═══ F ═══ */
await test("F1 one layout and one background everywhere; clearing a sheet clears only its own variants; the edit record has its own field", ()=>{
  const b = { console, String }; b.window = b; vm.createContext(b);
  vm.runInContext(between(props, "function buildPropFromPhotoPrompt(p, project){", "window.buildPropFromPhotoPrompt"), b);
  b.propInheritedStyleKey = ()=> ""; b.renderStyleText = ()=> "photoreal";
  const s = b.buildPropFromPhotoPrompt({ name:"Cup" }, {});
  assert.match(s, /3-panel object reference sheet/); assert.match(s, /no back view/); assert.match(s, /no separate side view/);
  assert.ok(!/360-degree|back view right|3 close-up detail shots/.test(s));
  assert.ok(!/neutral grey background|light grey background/.test(props));
  assert.ok(props.includes(".filter(id=> id && String(id).indexOf(p.id+\":\")===0)),"));
  assert.ok(art.includes("meta.propReferencesUsed=propReferenceSnapshot(depIds,window.turnContinuity||{});") && !art.includes("meta.propDependencies=propReferenceSnapshot"));
  assert.ok(!/Nano Banana \u2192 a multi-view product sheet/.test(props));
});

/* ═══ G ═══ */
await test("G1 Frances: exact warnings, edit rights, merge, spending, wardrobe", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Props (Art Room)")||{}).what || "";
  for(const re of [/PROPS REVIEW, SECOND PASS/, /for each prop IN THAT FRAME/, /never raises the warning/, /CURRENT holder/, /MERGE asks first/,
    /always asks first, with the price, even when nothing has an image yet/, /never makes an optional worn close-up sheet/, /is not retried/,
    /reads ready when its owner's character sheet exists/, /same 3-view layout/]) assert.ok(re.test(w), String(re));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE/.test(between(ai, "[\"Props (Art Room)\", \"PROPS REVIEW, SECOND PASS", "\"],\n")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

#!/usr/bin/env node
/* The Locations tab, second pass (owner 2026-10-08: "go ahead with all of it") — does it tell the truth?
   A  the film's data: a delete sticks, the bin is never re-seeded, restore / purge keep work, edit rights,
      the sides pick and the times stay
   B  freshness: a plate made from the reviewed layout keeps it reviewed; a cold cache is unknown; derived
      plates and specs say when what they were made from changed; frames record their location plates
   C  the scene's needs: a room's location plate comes first, nothing existing is paid for twice
   D  spending: the batch and the scene run ask with the price; Surprise me, drafts and the retry
   E  the Location Scout follows the tab's rules
   F  prompts and copy
   G  Frances knows
     node scripts/test-locations-second-pass.mjs */
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
const app = read("app/app.jsx"), locs = read("app/locations.jsx"), ui = read("app/locations-ui.jsx"), shots = read("app/shots.jsx"),
  shotsUi = read("app/shots-ui.jsx"), stage = read("app/stage.jsx"), sb = read("app/storyboard.jsx"), art = read("app/artroom.jsx"),
  agents = read("app/agents.jsx"), ai = read("app/ai.jsx"), bd = read("app/breakdown.jsx");

/* the real locations.jsx (no JSX) in a sandbox */
const box = { console, setTimeout, clearTimeout, localStorage:{ getItem:()=>null }, scenesInStoryOrder:x=>x||[], dispatchEvent:()=>{},
  CustomEvent:class{}, renderStyleText:()=>"Photoreal" };
box.window = box; vm.createContext(box);
vm.runInContext(locs, box);
const metas = {}, imgs = {};
box.nbGetMeta = (id)=> metas[id] || null; box.nbGetImage = (id)=> imgs[id] || ""; box.nbLoadImage = async (id)=> imgs[id] || "";
box.nbEpoch = ()=>1;

/* ═══ A ═══ */
await test("A1 a delete sticks: only a card the fold put away comes back, and a binned place isn't derived again", ()=>{
  const sync = between(app, "  // LOCATION HIERARCHY SYNC", "  // read the whole film, design a BESPOKE per-film palette");
  assert.ok(sync.includes('x._trashReason==="fold"&&freshByKey[x.key]'));
  assert.ok(sync.includes("!binnedKeys.has(x.key)"));
  assert.ok(sync.includes("if(artRoomReadOnlyRef.current) return;"));
  assert.ok(sync.includes("if(l.intExtLocked) synced={...synced,intExt:l.intExt};"));
  assert.ok(app.includes('...finalTrash.map(x=>({ ..._trashStamp(x), _trashReason:"fold" }))'));
});
await test("A2 Design all, the script pull and the Location Scout never re-add a binned location", ()=>{
  assert.ok(app.includes("deriveLocations(scenes, [...(locations||[]), ...((trash&&trash.locations)||[])], drafts);   // places not yet present"));
  assert.ok(between(app, "const pullLocationsFromScript = React.useCallback(()=>{", "},[scenes, locations, drafts, trash,").includes("...((trash&&trash.locations)||[])"));
  // (2026-10-26) the known list (live + Recently deleted) is named first; a film's first pass adds { sharedHeads:"all" }
  assert.ok(app.includes("const _locKnown = [..._locWork, ...(((trashRef.current||trash)&&(trashRef.current||trash).locations)||[])];")
    && app.includes('deriveLocations(scenes, _locKnown, drafts, _locKnown.length ? undefined : { sharedHeads:"all" });'));
});
await test("A3 restore says when the place is already on the board; purge clears only this card's own rooms, never a live one's", ()=>{
  const restore = between(app, "  const restoreLocation = (id)=>{", "  const purgeLocation");
  assert.ok(restore.includes("(l.id===id || (item.key && l.key===item.key))") && restore.includes("is already on the board, so the copy in Recently deleted stays there."));
  const purge = between(app, "  const purgeLocation = async (id)=>{", "  const draftLocationVisuals");
  assert.ok(purge.includes('String(u.subspaceKey||u.locationKey||"")===itemKey'));
  assert.ok(!purge.includes("u.locationKey===(item.key||item.id)"));
  assert.ok(purge.includes("if(liveUnitIds.has(assetId)) continue;") && purge.includes('String(assetId).indexOf(id+"-")===0'));
  assert.ok(purge.includes("they can't make new ones until this place is back") && purge.includes("comes back as an empty card"));
});
await test("A4 edit rights: every change, and the background syncs, only for a role that can change the Art Room", ()=>{
  assert.ok(app.includes("const updateLocation = (id,patch,cameraAction)=>{ if(artRoomReadOnlyRef.current) return;"));
  for(const fn of ["  const deleteLocation = (id)=>{", "  const restoreLocation = (id)=>{", "  const purgeLocation = async (id)=>{",
    "  const draftLocationVisuals = async (l)=>{", "  const draftAllLocations = async (mode)=>{", "  const draftLocationStaging = async (l,viewId)=>{"]){
    const i = app.indexOf(fn); assert.ok(i>0, fn); assert.ok(app.slice(i, i+260).includes("canMutateSharedFilm()"), fn); }
  assert.ok(between(app, "  const pullLocationsFromScript", "  // auto-seed once per story").includes("if(artRoomReadOnlyRef.current) return;"));
  assert.ok(between(app, "  // auto-seed once per story", "  // LOCATION HIERARCHY SYNC").includes("if(artRoomReadOnlyRef.current) return;"));
  assert.ok(app.includes("if(fields && projIdRef.current===film0)") && app.includes('throw new Error("you switched films, so nothing was written")'));
});
await test("A5 derived times use the card's buckets — Continuous / Later are no time", ()=>{
  box.parseSlugline = box.parseSlugline || box.window.parseSlugline;
  const scenes = [{ id:"s1", no:1, loc:"INT. KITCHEN - NIGHT" }, { id:"s2", no:2, loc:"INT. KITCHEN - CONTINUOUS" }, { id:"s3", no:3, loc:"INT. KITCHEN - DAY" }];
  const [k] = box.deriveLocations(scenes, [], {});
  assert.deepEqual(J(k.times), J(box.deriveLocationTimes({ name:k.name, scenes:k.scenes }, scenes)));
  assert.ok(!k.times.some(t=>/continuous|later/i.test(t)), JSON.stringify(k.times));
  assert.ok(ui.includes("onUpdate(l.id,{intExt:e.target.value, intExtLocked:true})"));
});

/* ═══ B ═══ */
const house = { id:"house", key:"house", name:"House", architecture:"Brick" };
const kitchen = { id:"kitchen", key:"kitchen", name:"Kitchen", parentKey:"house" };
box.turnContinuity = { locations:[kitchen, house], scenes:[], drafts:{} };
const plan = { frame:"From the hall", anchors:[{ id:"table", space:"Kitchen", name:"Table", placement:"By the window" }], status:"reviewed", source:{ assetId:"house", iso:"" } };
await test("B1 a parent plate made FROM the reviewed layout keeps it reviewed; any other new plate asks again", ()=>{
  house.spatialPlan = box.normalizeLocationSpatialPlan(plan);
  delete metas.house; delete imgs.house;
  assert.equal(box.locationSpatialPlanState(kitchen).ready, true, "reviewed before any plate");
  const sig = box.locationSpatialPlanSigFor(house);
  assert.ok(/^sp1:/.test(sig)); assert.equal(box.locationSpatialPlanSigFor(kitchen), "", "only the layout's owner records it");
  imgs.house = "data:h"; metas.house = { iso:"2026-10-08T10:00", spatialPlanSig:sig };
  assert.equal(box.locationSpatialPlanState(kitchen).ready, true, "the rooms can follow in the same run");
  metas.house = { iso:"2026-10-08T11:00" };   // an edit / upload / older plate: no record of the layout
  assert.equal(box.locationSpatialPlanState(kitchen).stale, true);
  metas.house = { iso:"2026-10-08T12:00", spatialPlanSig:box.locationSpatialPlanSig({ ...plan, frame:"Another frame" }) };
  assert.equal(box.locationSpatialPlanState(kitchen).stale, true, "made from a different layout");
});
await test("B2 a plate that hasn't loaded on this device is unknown — never 'the parent plate changed'", ()=>{
  house.spatialPlan = box.normalizeLocationSpatialPlan({ ...plan, source:{ assetId:"house", iso:"2026-10-01" } });
  delete metas.house; delete imgs.house;
  const st = box.locationSpatialPlanState(kitchen);
  assert.equal(st.stale, false); assert.equal(st.ready, true);
  imgs.house = "data:h"; metas.house = { iso:"2026-10-01" };
  assert.equal(box.locationSpatialPlanState(kitchen).ready, true);
  metas.house = { iso:"2026-10-05" };
  assert.equal(box.locationSpatialPlanState(kitchen).stale, true, "a loaded, different plate still asks");
  // (2026-10-27) the plate goes back as the layout's source only when the layout was read from it
  assert.ok(locs.includes("if(!state.plan.source || !state.plan.source.iso)return [];"));
});
await test("B3 derived plates say 'Parent plate changed' only when they recorded the parent; specs by signature", ()=>{
  metas.house = { iso:"A" };
  assert.equal(box.locationDerivedPlateChanged({ locationParentId:"house", locationParentIso:"A" }), false);
  metas.house = { iso:"B" };
  assert.equal(box.locationDerivedPlateChanged({ locationParentId:"house", locationParentIso:"A" }), true);
  assert.equal(box.locationDerivedPlateChanged({ locationParentId:"house" }), false, "an older plate with no record never flags at once");
  delete metas.house;
  assert.equal(box.locationDerivedPlateChanged({ locationParentId:"house", locationParentIso:"A" }), false, "not loaded yet");
  metas.root = { iso:"R2" };
  assert.equal(box.locationDerivedPlateChanged({ locationUpstream:[{ id:"root", iso:"R1" }] }), true, "the continuity root is upstream too");
  assert.deepEqual(J(box.locationRootIds(kitchen)), ["house"]); assert.deepEqual(J(box.locationRootIds(house)), []);
  const sig = box.locationSpecSig(house);
  assert.equal(box.locationSpecChanged({ locSpecSig:sig }, house), false);
  assert.equal(box.locationSpecChanged({ locSpecSig:sig }, { ...house, materials:"Stone" }), true);
  assert.equal(box.locationSpecChanged({}, { ...house, materials:"Stone" }), false, "older plates don't flag");
  assert.ok(locs.includes("lineage.locSpecSig=locationSpecSig(l);") && ui.includes("locSpecSig: mode===\"edit\" ? (gen.genMeta && gen.genMeta.locSpecSig)"));
  // (2026-10-13, Location coordinates step B) the badge also says when the shared layout changed — it takes the card's location
  // (2026-10-18) each also passes the script text it was made from ("Script changed")
  assert.equal((ui.match(/\n\s+_parentChangedBadge\(gen, l[,)]/g)||[]).length, 3, "the extra-space, state and room & time cards");
  assert.equal((ui.match(/attachments: async \(\.\.\.a\)=>\{ depSnap\.current = /g)||[]).length, 3, "the parent as ATTACHED, not after the render");
});
await test("B4 a frame records its location plates and text; 'Location changed' only once details load", ()=>{
  const b = { console, Object, Array, String, Set }; b.window = b; vm.createContext(b);
  vm.runInContext(between(shots, "function shotCharacterRefVersions(castSpec, refOff){", "window.shotLocationTextSig = shotLocationTextSig;"), b);
  const m = {}; b.nbGetMeta = (id)=> m[id] || null;
  b.turnContinuity = { locations:[{ id:"house", name:"House", architecture:"Brick" }] };
  m["locunit-k-night"] = { iso:"1", version:1 };
  const plan = { activeLocSpec:[{ id:"locunit-k-night", locationId:"house" }, { id:"locunit-off", locationId:"house" }] };
  const dep = b.shotLocationDependencies({ sceneId:"s1", refOff:["locunit-off"] }, plan, { location:{ id:"house" } });
  assert.deepEqual(J(dep.refs), ["locunit-k-night@1#1"]); assert.deepEqual(J(dep.ids), ["house"]);
  assert.equal(b.shotLocationChanged(dep), false);
  m["locunit-k-night"] = { iso:"2", version:2 };
  assert.equal(b.shotLocationChanged(dep), true, "the room plate was regenerated");
  m["locunit-k-night"] = { iso:"1", version:1 };
  b.turnContinuity.locations[0].architecture = "Stone";
  assert.equal(b.shotLocationChanged(dep), true, "the description changed");
  const cold = { refs:["locunit-x@1#1"], ids:[], text:"" };
  assert.equal(b.shotLocationChanged(cold), false, "not loaded yet");
  assert.equal(b.shotLocationChanged({ refs:["locunit-k-night@#"] }), true, "missing then, made since");
  assert.ok(shotsUi.includes("locationDependencies:_keep(\"locationDependencies\", (typeof shotLocationDependencies===\"function\" && renderPlan) ? shotLocationDependencies(sh, renderPlan, ctx) : null),"));
  assert.ok(shotsUi.includes('"Location changed"') && shots.includes("const locChanged = !!(m && shotLocationChanged(m.locationDependencies));"));
  assert.ok(bd.includes("made before its location changed"));
});
await test("B5 the Stage: a plate that hasn't loaded is unknown; one missing then and made since is flagged", ()=>{
  // (2026-10-09, Stage third pass) one shared helper for every place that shows take notes
  const f = between(stage, "function stageTakeReferencesStale(meta){", "function stageTakeFramesChanged(meta){");
  assert.ok(f.includes("if(!m && !img) return false;") && f.includes("if(!snap.iso && snap.version==null && m && m.iso) return true;"));
});

/* ═══ C ═══ */
await test("C1 a room's plate lists its location (and that one's parent) first when they're missing", ()=>{
  const b = { console, Object, Array, String, Set }; b.window = b; vm.createContext(b);
  vm.runInContext(between(shots, "function sceneReferenceNeeds(sceneShots, ctx, has){", "window.sceneReferenceNeeds = sceneReferenceNeeds;"), b);
  const L = [{ id:"house", name:"House" }, { id:"kitchen", name:"Kitchen", parent:"house" }];
  b.locationParentOf = (l, list)=> l.parent ? list.find(x=>x.id===l.parent) : null;
  b.shotRenderPlan = ()=>({ activeLocSpec:[{ id:"locunit-kitchen-night", locationId:"kitchen", label:"Kitchen · Night" }], castSpec:[], propSpec:[], carrySpec:[] });
  const made = new Set();
  const needs = b.sceneReferenceNeeds([{ id:"a1" }], { locations:L }, (id)=>made.has(id));
  assert.deepEqual(J(needs).map(n=>n.id), ["house", "kitchen", "locunit-kitchen-night"]);
  assert.ok(needs[0].prereq && needs[0].makeable && /needed first/.test(needs[0].label));
  made.add("house"); made.add("kitchen");
  assert.deepEqual(J(b.sceneReferenceNeeds([{ id:"a1" }], { locations:L }, (id)=>made.has(id))).map(n=>n.id), ["locunit-kitchen-night"]);
  assert.ok(bd.includes('n.prereq ? (n.name||n.label)+" image (needed first)"'));
  assert.ok(bd.includes('const mine = needs.find(n=>n.kind==="location" && String(n.id)===String(location.id));'));
});
await test("C2 'Make what this scene needs' makes the card's plate and never pays for one that exists; Shots looks up what's real", ()=>{
  const m = between(app, "  const makeSceneNeeds = async (scene, needs, onProgress, opts)=>{", "  const wornBuildRef");
  assert.ok(m.includes("window.generateLocationPlate(l, project, { draftStaging:true, cancelled:stale,"));
  // (2026-10-09: "exists" — not counted as made; plate, room, master, variant, prop)
  assert.equal((m.match(/if\(await has\((l\.id|n\.id|cid|cid\+":"\+v\.sid|p0\.id)\)\) return "exists";/g)||[]).length, 5);
  assert.ok(shotsUi.includes("sceneReferenceNeeds(shots||[], ctx, needsHas)") && shotsUi.includes('window.addEventListener("nb-prefetched", h);'));
  assert.ok(locs.includes("async function generateLocationPlate(l, project, opts){") && locs.includes("if(o.draftStaging && typeof stagingHasContent===\"function\" && !stagingHasContent(l)"));
  // (2026-10-14) whole scenes in the slots the parent's plate, the cut-out panels and the layout's plate leave
  assert.ok(locs.includes("const pages=locationScriptPageRefs(l, null, null, Math.max(0, 6-refs.length)).filter(r=>r.url);"));
  assert.ok(ui.includes("locationScriptPageRefs(l, scenes||C.scenes||[], drafts||C.drafts||{}, Math.max(0,6-(fixed.n!=null?fixed.n:out.length)))"));
  assert.deepEqual(J(box.locationScriptPageRefs({ id:"x", scenes:[] }, [], {}, 0)), []);
});

/* ═══ D ═══ */
await test("D1 'Generate N missing plates' and 'Generate N missing in Scene NN' ask first with the price", ()=>{
  const all = between(ui, "  const startAllBatch = (onlyMissing)=>{", "  const eligibleAll");
  assert.ok(all.includes("{ alwaysAsk:true, note:(missing, existing)=>{") && all.includes("view composition"));
  const run = between(ui, "  const startSceneRun = async ()=>{", "  const startSceneRegenerate");
  assert.ok(run.includes("await window.appConfirm({ title:\"Make \"+n+\" image\"") && run.includes("nbImageCostText(n)") && run.includes("if(!ok) return;"));
  assert.ok(run.indexOf("if(!ok) return;") < run.indexOf("const steps"));
  assert.ok(art.includes('prompt.note ? " "+prompt.note : ""'));
});
await test("D2 Surprise me: says it costs, switches only once a style comes back, and the all-locations pick asks first", ()=>{
  assert.ok(ui.includes("Re-roll a new surprise style \\u2014 one small writing call (writing credits)"));
  const pick = between(ui, "  const pickLocStyle = async (key)=>{", "  // LOCK a surprise style");
  assert.ok(!pick.includes('onUpdate(l.id, { renderStyleIndependent:true,renderStyleKey:"surprise" });'));
  const all = between(ui, "  const applyStyleAll = async (key)=>{", "  const sceneList");
  assert.ok(all.indexOf("if(!ok) return;") < all.indexOf('renderStyleKey:"surprise"'), "no card is switched before the confirm");
  assert.ok(all.includes("(writing credits)"));
});
await test("D3 drafting asks before replacing what's written; a failed design isn't retried and is reported", ()=>{
  assert.ok(app.includes('title:"Draft \\u201c"+(l.name||"this location")+"\\u201d again?"') && app.includes('title:"Draft the view composition again?"'));
  assert.ok(ui.includes('"Draft notes for this view"'));
  const d = between(ai, "async function aiDesignLocationBible(", "window.aiDesignLocationBible = aiDesignLocationBible;");
  assert.ok(d.includes("}catch(e){ lastError = e; return null; }") && d.includes("if(part&&!Object.keys(part).length)part=await runBatch(items);"));
  assert.ok(d.includes("if(!Object.keys(out).length && lastError) throw lastError;"));
  assert.ok(app.includes("Couldn't draft \\u201c\"+(l.name||\"this location\")+\"\\u201d (\""));
});

/* ═══ E ═══ */
await test("E1 the Location Scout: layout review, parents first, states with their plate, edits kept, failures said", ()=>{
  const ls = between(app, "    // ---- Location Scout surface", "    // ---- Visual Researcher surface");
  assert.ok(ls.includes("requireLocationSpatialPlan(l); return true;") && ls.includes("if(par && !made.has(par.id) && !(await _grabImg(par.id))) continue;"));
  assert.ok(ls.includes("toGenerateVariants: async (force, plates)=>{") && ls.includes("if(!willHave.has(l.id) && !(await _grabImg(l.id))) continue;"));
  assert.ok(ls.includes('if(!map) throw new Error("no specs came back");'));
  assert.ok(ls.includes("_w.setLocations(patch); _w.setLocsSeeded(true);") && ls.includes("if(added) _w.setLocations(patch);"));
  assert.ok(!/_w\.setLocations\(next\)/.test(ls), "never the run's whole copy");
  assert.ok(agents.includes("ls.toGenerateVariants(ctx.force, plates)") && agents.includes("for its shared layout to be reviewed"));
  assert.ok(agents.includes("if(!specsFailed) ctx.emit({k:\"observe\""));
  assert.ok(app.includes('(stateN ? " ("+stateN+" of them environment states)" : "")'));
});

/* ═══ F ═══ */
await test("F1 prompts: the photo plate is the 2x2 four-view sheet; single-frame retries keep time and state; no 16:9 in the text", ()=>{
  const photo = box.buildLocationFromPhotoPrompt({ id:"k", name:"Kitchen", architecture:"Tiles" }, {});
  assert.match(photo, /exactly 4 views of that same space in a 2x2 grid/); assert.match(photo, /No text, no labels, no captions/);
  assert.ok(!/3\u00d72|six panels|Print a small caption/.test(photo));
  const unit = box.buildSimpleLocationPrompt({ id:"k", name:"Kitchen" }, { name:"Kitchen", side:"INT", time:"Night", state:"rain on the windows" });
  assert.match(unit, /ONE wide three-quarter establishing frame of Kitchen \(INT\), at Night, rain on the windows — from a corner, looking diagonally across the space, never straight-on/); assert.match(unit, /not a grid, no text/);
  assert.match(box.buildSimpleLocationPrompt({ id:"k", name:"Kitchen" }), /exactly 4 views of the same space in a 2x2 grid/);
  assert.ok(!/"ONE 16:9 cinematic/.test(locs) && locs.includes('modelLabel:mEntry.label||"Image model"'));
  assert.equal((ui.match(/buildSimple: \(\)=> buildSimpleLocationPrompt\(l,\{/g)||[]).length, 3);
  assert.ok(locs.includes("prompt = buildSimpleLocationPrompt(l,{ name:u.name||l.name, side:u.intExt, time:u.time"));
  assert.ok(ui.includes("hint:_hintOf(_panelPlan&&_panelPlan.top_left, \"wide establishing\")"));
});
await test("F2 Storyboards show the plates the frames attached; Clear counts what exists; removing a state is safe", ()=>{
  const b = { console, Object, Array, String, Set }; b.window = b; vm.createContext(b);
  vm.runInContext(between(sb, "function sbLocRefsForShots(shots, ctx){", "window.sbLocRefsForShots = sbLocRefsForShots;"), b);
  b.shotRenderPlan = (sh)=>({ activeLocSpec: sh.id==="a1" ? [{ id:"locunit-k-n", label:"Kitchen · Night — from the script" }] : [{ id:"locunit-k-n" }, { id:"house-cov-ext", label:"Porch" }] });
  assert.deepEqual(J(b.sbLocRefsForShots([{ id:"a1" }, { id:"a2", refOff:["house-cov-ext"] }], {})), [{ id:"locunit-k-n", label:"Kitchen · Night" }]);
  assert.ok(!sb.includes('label:(ctx.location.name||"Location")+" plate", kind:"location"'));
  assert.ok(art.includes("const kind = relatedClearLabel || \"variant sheet\";") && art.includes("if(u) vN++;"));
  assert.ok(ui.includes('relatedClearLabel:"room, state or extra-space image",'));
  const rm = between(ui, "  const removeVariant = async (vid)=>{", "  const saveCoverageViews");
  assert.ok(rm.includes("await nbLoadImage(assetId)") && rm.includes("if(sharesUnit) has = false;"));
});
await test("F3 copy: the About tip and button titles say what spends; no vendor names", ()=>{
  assert.ok(ui.includes("Set holds the floor plan (review and confirm it)") && ui.includes("Images spend image credits; drafting specs, floor plans and dressing spend writing credits"));   // (2026-11-17) Surprise me is no longer offered   // (2026-11-17) "plates" until then
  assert.ok(!ui.includes("Render style details"));
  assert.ok(!/Nano Banana|image-proxy/.test(ui) && !/"Nano Banana"/.test(locs));
  assert.ok(art.includes("Fills the text spec from the script first (writing credits), then generates the sheet in one step (image credits)"));
});

/* ═══ G ═══ */
await test("G1 Frances: delete sticks, freshness, spending, prompts", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "let _museFactsMemo = null;");
  const fb = { console, Object, Array, String }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const w = (fb.__F.find(f=>f.name==="Locations (Art Room)")||{}).what || "";
  for(const re of [/LOCATIONS REVIEW, SECOND PASS/, /DELETING STICKS/, /'Location changed'/, /'Parent plate changed'/, /'1 · Description or look changed'/,
    /no longer sends that layout back for review/, /always asks first with the price/, /'needed first'/, /Surprise me says it uses writing credits/,
    /same 2x2 four-view layout/, /edited under The look, in the card's Location image section/ /* Look & exclusions until 2026-11-13, Look Dev until 2026-11-15 */]) assert.ok(re.test(w), String(re));
  assert.ok(!/There is no separate Look dev fold/.test(w));
  assert.ok(!/Claude|Anthropic|McKee|TURN\b|MUSE|Nano Banana/.test(between(ai, "[\"Locations (Art Room)\", \"LOCATIONS REVIEW, SECOND PASS", "\"],\n")));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

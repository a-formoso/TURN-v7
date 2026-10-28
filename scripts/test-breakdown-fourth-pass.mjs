#!/usr/bin/env node
/* The Breakdown tab, fourth pass (2026-10-09, owner — Breakdown review: "all of it") — every finding and decision:
   A   read-only roles, Co-writers and Stage editors USE the Breakdown (filter, "+N more", tip, chips, both exports) but
       never Make or Render; "Loading…" while a film loads
   B10 a failed or timed-out cloud check is said (nbPrefetchAll resolves { ok:false }, forgets it; cloudAssetLoadAll strict)
   B11 re-renders counted in Shots' order (sceneShotsDependencyOrdered)
   B12 frames that only need a FREE approval are their own item, out of "frames", images and credits
   B13 the Characters and Props tabs count a scene the Breakdown's way and say which card to open (decisions B, C)
   B14 the Clips chip says clips the Stage left out after an identity change (`identity`)
   B15 a worn item on a missing owner's sheet has its own status; the "not in a frame" words are written directly
   D   a sheet from frames with an earlier look is out of date — one rule for the Breakdown and Storyboards
   E   exports: file names (B16), the stripboard (B17, decision I), the bible (B18, B19, decision H)
   P   one Make progress for the whole app; speed (per-scene cache, same counts); screen readers; CSS
     node scripts/test-breakdown-fourth-pass.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const buttons = (tree)=> findAll(tree, n=>n.type==="button");
// render the child components a tree names (the strips), so their buttons can be read
const expand = (n)=>{ if(Array.isArray(n)) return n.map(expand); if(!n || typeof n!=="object") return n;
  if(typeof n.type==="function") return expand(n.type({ ...n.props }));
  return { ...n, children:(n.children||[]).map(expand) }; };
const R = { Fragment:"fragment", state:null, calls:[],
  createElement:(type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) }),
  useState(init){ const i = R.calls.length; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); R.calls.push(v); return [v, noop]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(st){ R.state = st || null; R.calls = []; } };
// BreakdownView's useState order: tick, priceTick, needsBusy, appRun, said, filter, found, checking, checkFailed, bible
const ST = { checking:7, checkFailed:8, bible:9 };

const bd = read("app/breakdown.jsx"), art = read("app/artroom.jsx"), props = read("app/props.jsx"), sb = read("app/storyboard.jsx"),
  ig = read("app/imagegen.jsx"), cloud = read("app/cloud.jsx"), css = read("app/styles.css");
const previews = [], toasts = [], events = [];
const box = { console, React:R, Icon:new Proxy({}, { get:()=>()=>null }), Object, Array, String, Number, Math, JSON, Set, Map, Promise, Date, Error,
  setTimeout, clearTimeout, localStorage:{ getItem:()=>null },
  docPreview:(o)=>{ previews.push(o); return o.live ? { setHtml:(h)=>{ o.html = h; o.sets = (o.sets||0)+1; }, close:()=>{ o.closed = true; } } : previews.length; },
  appToast:(m, k)=>toasts.push(m), nbCostChip:(n)=>({ type:"chip", props:{ count:n }, children:[] }), nbImageCostText:(n)=>String(n),
  CustomEvent:function(type, o){ this.type = type; this.detail = o && o.detail; }, dispatchEvent:(e)=>{ events.push(e); return true; },
  addEventListener:noop, removeEventListener:noop };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/scene-order.js"), box);
vm.runInContext(transformSync(bd, { presets:[["@babel/preset-react",{ runtime:"classic" }]], babelrc:false, configFile:false }).code, box);
const base = ()=>{ box.sceneRoster = (s)=> s.id==="s2" ? ["ana","ben"] : ["ana"]; box.locationForScene = (l, sid)=> l.find(x=>(x.scenes||[]).indexOf(sid)>=0)||null;
  box.sceneReferenceNeeds = ()=>[]; box.shotFrameState = ()=>({ rendered:true, current:true, approved:true, done:true });
  box.sbPageRanges = (s)=>[{ start:0, count:s.length }]; box.nbGetMeta = ()=>null; box.sbSheetStale = ()=>false;
  delete box.sceneShotsOrdered; delete box.sceneShotsDependencyOrdered; delete box.seedShotOf; delete box.shotCharacterReferenceSpec;
  delete box.PropScreenplay; delete box.turnSceneNeedsProgress; delete box.turnOpenFilmId; delete box.shotLookIsEarlier; delete box.sbSheetFromEarlierLook; };
const film = (extra)=>({ project:{ id:"f1", title:"Film" },
  scenes:[{ id:"s1", no:1, title:"Kitchen", loc:"INT. HOUSE - NIGHT" }, { id:"s2", no:2, title:"Yard", loc:"EXT. YARD - DAY" }],
  characters:[{ id:"ana", name:"Ana" }, { id:"ben", name:"Ben" }], props:[], locations:[{ id:"house", name:"House", scenes:["s1"] }, { id:"yard", name:"Yard", scenes:["s2"] }],
  shots:[{ id:"a1", sceneId:"s1", beatN:1, locked:true }, { id:"b1", sceneId:"s2", beatN:1, locked:true }], drafts:{}, tierOf:()=>"own", ...(extra||{}) });
const rowsOf = (f, made)=> box.breakdownRows({ ...f, img:(id)=>made.has(id) });
const view = (p, st)=>{ R.reset(st || { [ST.checking]:false }); return box.BreakdownView({ setArtView:noop, ...p }); };
const viewAll = (p, st)=> expand(view(p, st));

/* ═══ A ═══ */
await test("A1 the Breakdown is outside the read-only boundary; the tools wrapper stays inert", ()=>{
  assert.ok(art.includes('const viewableTab = !lockedView && ((artView==="storyboard" && !!window.StoryboardView) || (artView==="breakdown" && !!window.BreakdownView));'));
  assert.ok(art.includes('const rootInert = readOnly && !lockedView && !viewableTab;') && art.includes('inert:(readOnly && (lockedView || viewableTab))?"":undefined'));
  assert.ok(art.includes("React.createElement(window.BreakdownView,{loading:!!projectLoading,project,") && art.includes("readOnly=false, projectLoading=false }){"));
});
await test("A2 read-only: filter, '+N more', tip, chips and both exports work — no Make, no Render", ()=>{
  base(); box.sceneReferenceNeeds = (s, ctx)=> ctx.scene.id==="s1" ? [{ id:"house", kind:"location", label:"House", makeable:true }] : [];
  box.shotFrameState = (sh)=> sh.id==="b1" ? { rendered:true, current:false, approved:true, done:false } : { rendered:true, current:true, approved:true, done:true };
  const f = film(); const made = new Set(["ana","ben","yard","a1","b1"]);
  box.nbGetImage = (id)=> made.has(id) ? "u:"+id : "";
  const t = viewAll({ ...f, readOnly:true, onMakeSceneNeeds:null, onOpenStage:noop });
  // (2026-10-23, option A) the two exports sit under one "Export" menu; the filter is the slate's Show select;
  // each scene is a one-line row whose full strip (with Make / Render) opens under it
  const labels = buttons(t).map(textOf);
  assert.ok(labels.includes("Export") && bd.includes('"Export stripboard"') && bd.includes('"Art department bible"'), JSON.stringify(labels));
  const opts = findAll(t, n=>n.type==="option").map(textOf);
  assert.ok(opts.some(l=>/^All/.test(l)) && opts.some(l=>/^Needs work/.test(l)) && opts.some(l=>/^Ready/.test(l)), JSON.stringify(opts));
  const stripsOf = (tree)=> findAll(tree, n=>n.type===box.BreakdownLine).flatMap(n=>{ R.reset(); return buttons(expand(box.BreakdownStrip({ ...n.props, nested:true }))).map(textOf); });
  assert.ok(!stripsOf(view({ ...f, readOnly:true, onMakeSceneNeeds:null, onOpenStage:noop })).some(l=>/Make what this scene needs|^Render Scene/.test(l)));
  assert.ok(/View only — your role can't make images or render here\./.test(textOf(t)));
  // the same film for an owner: Render shows for the scene whose only work is a re-render
  const own = stripsOf(view({ ...f, onMakeSceneNeeds:async ()=>({}), onOpenStage:noop }));
  assert.ok(own.some(l=>/Make what this scene needs/.test(l)) && own.some(l=>/^Render Scene 02/.test(l)), JSON.stringify(own));
});
await test("A3 while a film is loading the owner reads 'Loading…', never 'View only'", ()=>{
  base(); box.nbGetImage = ()=>"";
  const txt = textOf(view({ ...film(), readOnly:true, loading:true, onMakeSceneNeeds:null }));
  assert.ok(txt.includes("Loading…") && !/View only/.test(txt));
});

/* ═══ B10 ═══ */
const igBox = { console, Object, Promise, Error, setTimeout, clearTimeout, CustomEvent:function(t, o){ this.type = t; this.detail = o && o.detail; } };
igBox.window = igBox; igBox.dispatchEvent = noop; vm.createContext(igBox);
vm.runInContext("var _nbBackend='cloud', _nbProject='p1', _nbShared=null; async function cloudHydrate(id, r){ return r && r.url; }\n"
  + between(ig, "let _prefetchAllProj = null, _prefetchAllPromise = null;", "window.nbPrefetchAll = nbPrefetchAll;")
  + "\nthis.nbPrefetchAll = nbPrefetchAll; this.setTimeoutMs = NB_PREFETCH_ALL_MS;", igBox);
await test("B10a nbPrefetchAll: { ok:false } on a failed query, never a rejection; forgotten, so the next call checks again", async ()=>{
  let calls = 0;
  igBox.cloudAssetLoadAll = async (p, o)=>{ calls++; assert.equal(o && o.strict, true, "asks for a strict read"); throw new Error("offline"); };
  const r1 = await igBox.nbPrefetchAll();
  assert.equal(r1.ok, false);
  igBox.cloudAssetLoadAll = async ()=>{ calls++; return { a:{ url:"u" } }; };
  const r2 = await igBox.nbPrefetchAll();
  assert.equal(r2.ok, true); assert.equal(calls, 2, "the failure wasn't cached");
  const r3 = await igBox.nbPrefetchAll();
  assert.equal(calls, 2, "a success is shared per film, as before"); assert.equal(r3.ok, true);
});
await test("B10b nbPrefetchAll times out (~20 s) instead of hanging; local films resolve ok", async ()=>{
  assert.equal(igBox.setTimeoutMs, 20000);
  vm.runInContext("_nbProject='p2';", igBox);
  const realST = igBox.setTimeout;
  igBox.setTimeout = (f, ms)=> realST(f, ms===20000 ? 5 : ms);
  igBox.cloudAssetLoadAll = ()=> new Promise(()=>{});   // never answers
  const r = await igBox.nbPrefetchAll();
  igBox.setTimeout = realST;
  assert.equal(r.ok, false); assert.match(r.error, /timed out/);
  vm.runInContext("_nbBackend='local';", igBox);
  assert.equal((await igBox.nbPrefetchAll()).ok, true);
  vm.runInContext("_nbBackend='cloud';", igBox);
});
await test("B10c cloudAssetLoadAll { strict:true } throws on a failed query or unsigned links; without it, {} as before", async ()=>{
  const src = between(cloud, "async function cloudAssetLoadAll(projectId, opts){", "\nasync function cloudClear(");
  const cb = { console, Object, Promise, Error, Array };
  let answer = { data:null, error:{ message:"JWT expired" } }, signed = {};
  cb.sbClient = ()=>({ from:()=>({ select:()=>({ eq:async ()=>answer }) }) });
  cb.cloudSweepPurgeReferences = async ()=>{}; cb.cloudGetGenStrict = async ()=>null; cb.cloudSignedUrlsBatch = async ()=>signed;
  vm.createContext(cb); vm.runInContext(src+"\nthis.f = cloudAssetLoadAll;", cb);
  assert.deepEqual(J(await cb.f("p")), {}, "the old callers still get {}");
  await assert.rejects(()=>cb.f("p", { strict:true }), /JWT expired/);
  answer = { data:[{ entity_id:"a", storage_path:"x/a.png", meta:null }], error:null };
  await assert.rejects(()=>cb.f("p", { strict:true }), /could not be signed/);
  signed = { "x/a.png":"https://s/a" };
  assert.deepEqual(J(await cb.f("p", { strict:true })), { a:{ url:"https://s/a", path:"x/a.png", meta:null } });
  answer = { data:[], error:null };
  assert.deepEqual(J(await cb.f("p", { strict:true })), {}, "no rows is not a failure");
});
await test("B10d the Breakdown reads { ok:false } as a failed check and says so; the export notes it", ()=>{
  const v = between(bd, "function BreakdownView({", "\nwindow.BreakdownView");
  assert.ok(v.includes(".then((r)=>({ ok:!(r && r.ok===false) }), ()=>({ ok:false }))"));
  base(); box.nbGetImage = ()=>"";
  const txt = textOf(view({ ...film() }, { [ST.checking]:false, [ST.checkFailed]:true }));
  assert.ok(/Couldn't check which sheets and frames exist/.test(txt));
  assert.ok(v.includes("exportStripboard(rows, project, { checkFailed })"));
});

/* ═══ B11 ═══ */
await test("B11 the chain's re-renders are counted in Shots' order (sceneShotsDependencyOrdered)", ()=>{
  base();
  const shots = [{ id:"x", sceneId:"s1", beatN:1 }, { id:"y", sceneId:"s1", beatN:2, locked:true }];
  box.shotFrameState = (sh)=> sh.id==="x" ? { rendered:true, current:false, approved:false, done:false } : { rendered:true, current:true, approved:true, done:true };
  box.seedShotOf = (sh)=> sh.id==="y" ? { id:"x" } : null;
  box.sceneShotsOrdered = (l)=> l.slice().reverse();               // y first: the cascade would be missed
  let used = 0; box.sceneShotsDependencyOrdered = (l)=>{ used++; return l.slice(); };   // x first, as Shots' runPlanFor walks it
  const [r] = rowsOf(film({ shots, scenes:[film().scenes[0]] }), new Set(["ana","house","x","y"]));
  assert.ok(used>0); assert.equal(r.shots.toRender, 2, "x, and y that follows it in the chain");
  assert.ok(bd.includes('(typeof sceneShotsDependencyOrdered==="function") ? sceneShotsDependencyOrdered(sceneShots)'));
});

/* ═══ B12 ═══ */
await test("B12 frames only waiting for approval: their own item, out of frames, images and the credit estimate", ()=>{
  base();
  const shots = [{ id:"x", sceneId:"s1", beatN:1 }, { id:"y", sceneId:"s1", beatN:2 }, { id:"z", sceneId:"s1", beatN:3 }];
  box.shotFrameState = (sh)=> sh.id==="x" ? { rendered:true, current:true, approved:false, done:false }
    : sh.id==="y" ? { rendered:false, current:false, approved:false, done:false } : { rendered:true, current:true, approved:true, done:true };
  const rows = rowsOf(film({ shots, scenes:[film().scenes[0]] }), new Set(["ana","house","x","z"]));
  assert.equal(rows[0].shots.toRender, 2); assert.equal(rows[0].shots.toApprove, 1);
  const sum = box.breakdownSummary(rows);
  assert.equal(sum.frames, 1, "only the unrendered frame"); assert.equal(sum.toApprove, 1); assert.equal(sum.images, 1);
  const line = box.bdSummaryLine(sum);
  assert.ok(line.includes("1 frame, 1 frame to approve (free, in Shots)"), line);
  assert.ok(/≈ 1 credit for the images still to make/.test(line), "the estimate counts the one image to make: "+line);
});

/* ═══ B13 + decision C ═══ */
await test("B13a the Breakdown's chips: a carried prop with no owner / not in the screenplay says so, isn't made or priced", ()=>{
  base();
  box.PropScreenplay = { sheetTier:()=>({ tier:"own" }), notInScreenplay:(p)=> p.id==="map" };
  box.sceneReferenceNeeds = ()=>[{ id:"lamp", kind:"prop", label:"Lamp", makeable:true }, { id:"map", kind:"prop", label:"Map", makeable:true }, { id:"cup", kind:"prop", label:"Cup", makeable:true }];
  const f = film({ scenes:[film().scenes[0]], props:[{ id:"lamp", name:"Lamp", kind:"carried", scenes:["s1"] },
    { id:"map", name:"Map", kind:"carried", ownerId:"ana", scenes:["s1"], screenplaySources:[{ sceneId:"s9" }] },
    { id:"cup", name:"Cup", kind:"carried", ownerId:"ana", scenes:["s1"] }] });
  const [r] = rowsOf(f, new Set(["ana","house","a1"]));
  assert.deepEqual(J(r.missing.map(m=>m.text)), ["Lamp — needs an owner", "Map — not in the screenplay", "Cup sheet"]);
  assert.deepEqual(J(r.props.map(p=>p.blocked)), ["owner", "screenplay", ""]);
  const sum = box.breakdownSummary([r]);
  assert.equal(sum.propSheets, 1); assert.equal(sum.propsBlocked, 2);
  assert.ok(box.bdSummaryLine(sum).includes("2 props need an owner or a screenplay mention"));
  R.reset(); let asked = null;
  const t = box.BreakdownStrip({ row:r, go:noop, onMakeSceneNeeds:async (s, needs)=>{ asked = needs; return {}; } });
  const chips = buttons(t).map(textOf);
  assert.ok(chips.includes("Lamp — needs an owner") && chips.includes("Map — not in the screenplay"), JSON.stringify(chips));
  const make = buttons(t).find(b=>/Make what this scene needs/.test(textOf(b)));
  assert.ok(make && /Make the 1 missing/.test(make.props.title), "only the cup is made");
});
await test("B13b the Characters and Props tabs count the scene the Breakdown's way and name the card to open", ()=>{
  base();
  box.shotCharacterReferenceSpec = (c, scene)=> c.id==="ana" ? { id:"ana:wet", baseId:"ana", state:{ label:"Wet" } } : { id:c.id };
  box.sceneReferenceNeeds = ()=>[{ id:"ana:wet", baseId:"ana", kind:"character", label:"Ana · Wet", makeable:true },
    { id:"lamp", kind:"prop", label:"Lamp", makeable:true }, { id:"cup", kind:"prop", label:"Cup", makeable:true }];
  box.nbGetImage = (id)=> ["ana","house","a1"].indexOf(id)>=0 ? "u" : "";
  box.charVisualsDrafted = ()=>true;
  const f = film({ scenes:[film().scenes[0]], props:[{ id:"lamp", name:"Lamp", kind:"carried", scenes:["s1"] }, { id:"cup", name:"Cup", kind:"carried", ownerId:"ana", scenes:["s1"] }] });
  box.turnContinuity = { shots:f.shots, locations:f.locations };   // the tabs don't all have these: read from the open film
  const ch = box.bdSceneCardNeeds("s1", "characters", { scenes:f.scenes, characters:f.characters, props:f.props, drafts:{}, project:f.project });
  assert.deepEqual(J(ch), [{ text:"Ana · Wet sheet".replace(" sheet",""), cardId:"ana", blocked:"", variant:true }]);
  const pr = box.bdSceneCardNeeds("s1", "props", { scenes:f.scenes, characters:f.characters, props:f.props, drafts:{}, project:f.project });
  assert.deepEqual(J(pr.map(x=>[x.text, x.cardId, x.blocked])), [["Lamp — needs an owner","lamp","owner"], ["Cup sheet","cup",""]]);
  R.reset();
  const line = box.BdSceneNeedsLine({ sceneId:"s1", sceneNo:1, kind:"props", film:{ scenes:f.scenes, characters:f.characters, props:f.props, drafts:{}, project:f.project }, list:f.props });
  assert.ok(/Scene 01 still needs 1 prop · 1 prop an owner or a screenplay mention \(as the Breakdown counts\):/.test(textOf(line)), textOf(line));
  const titles = buttons(line).map(b=>b.props.title);
  assert.ok(/^Open Lamp’s card — choose who carries it/.test(titles[0]) && /^Open Cup’s card — draft its specification, then generate its sheet/.test(titles[1]), JSON.stringify(titles));
  R.reset();
  const cl = box.BdSceneNeedsLine({ sceneId:"s1", sceneNo:1, kind:"characters", film:{ scenes:f.scenes, characters:f.characters, props:f.props, drafts:{}, project:f.project }, list:f.characters });
  assert.ok(/Open Ana’s card — make this appearance variant under Appearance states/.test(buttons(cl)[0].props.title));
  assert.ok(art.includes('React.createElement(window.BdSceneNeedsLine,{sceneId:sceneFilter,sceneNo:sceneNoOf(sceneFilter),kind:"characters",'));
  assert.ok(props.includes('React.createElement(window.BdSceneNeedsLine,{sceneId:sceneFilter,sceneNo:sceneNoOf(sceneFilter),kind:"props",'));
  delete box.turnContinuity; delete box.charVisualsDrafted;
});

/* ═══ B14 ═══ */
await test("B14 the Clips chip counts clips the Stage left out after an identity change (`identity`)", ()=>{
  const c = { total:3, rendered:2, stale:0, oldLook:0, notes:0, identity:1 };
  assert.equal(box.bdClipsText(c), "2 of 3 clips rendered · 1 left out — a character changed; check it in Takes");
  assert.equal(box.bdClipsDone({ total:2, rendered:2, stale:0, identity:1 }), false);
  assert.equal(box.bdClipsDone({ total:2, rendered:2, stale:0 }), true, "an older saved status (no identity field) reads as before");
});

/* ═══ B15 ═══ */
await test("B15 a worn item on a missing owner's sheet has its own status; 'not in a frame' words are written directly", ()=>{
  base();
  const f = film({ scenes:[film().scenes[0]], props:[{ id:"hat", name:"Hat", kind:"worn", ownerId:"ben", ownerName:"Ben", scenes:["s1"] }] });
  box.sceneRoster = ()=>["ana","ben"];
  box.sceneReferenceNeeds = ()=>[];
  const [r] = rowsOf(f, new Set(["ana","a1"]));   // no plate, no Ben
  assert.equal(r.wardrobe[0].status, "owner");
  R.reset();
  const t = box.BreakdownStrip({ row:r, go:noop });
  const hat = buttons(t).find(b=>/Hat/.test(textOf(b)));
  assert.ok(/on Ben’s sheet — make that first/.test(hat.props.title) && !/\(missing\)/.test(hat.props["aria-label"]));
  assert.ok(/owner/.test(hat.props.className));
  const ben = buttons(t).find(b=>textOf(b)==="Ben");
  assert.equal(ben.props.title, "Ben — not in any of this scene's frames");
  const loc = buttons(t).find(b=>textOf(b)==="House");
  assert.equal(loc.props.title, "The House plate — not in any of this scene's frames");
  // no frames path: a worn item with no owner stays "missing" as before
  const [r2] = box.breakdownRows({ ...film({ shots:[], scenes:[film().scenes[0]], props:[{ id:"cap", name:"Cap", kind:"worn", scenes:["s1"] }] }), img:()=>false });
  assert.equal(r2.wardrobe[0].status, "missing");
});

/* ═══ D ═══ */
await test("D one rule: a composed sheet from frames with an earlier look is out of date (Storyboards and the Breakdown)", ()=>{
  const sbx = { console, Object, Array, Number, Math, window:{} };
  sbx.window = sbx; sbx.sbSheetStale = ()=>false; sbx.nbGetMeta = (id)=> id==="f1" ? { lookSig:"old" } : null;
  sbx.shotLookIsEarlier = (sig)=> sig==="old";
  vm.createContext(sbx); vm.runInContext(between(sb, "function sbSheetFromEarlierLook(", "window.sbStoryboardReadiness = sbStoryboardReadiness;"), sbx);
  const pages = [{ scene:{ id:"s1" }, pages:[{ id:"p1", shots:[{ id:"f1", sceneId:"s1" }] }, { id:"p2", shots:[{ id:"f2", sceneId:"s1" }] }, { id:"p3", shots:[{ id:"f1" }] }] }];
  const metas = { "sbsheet-p1":{ composed:true }, "sbsheet-p2":{ composed:true }, "sbsheet-p3":{ uploaded:true } };
  const r = vm.runInContext("sbStoryboardReadiness", sbx)(pages, { "sbsheet-p1":"u", "sbsheet-p2":"u", "sbsheet-p3":"u" }, (id)=>metas[id], { id:"P" });
  assert.deepEqual(J(r), { complete:2, partial:0, missing:0, total:3, stale:1, oldLook:1 }, "an upload isn't dated by its frames");
  // the Breakdown uses the same helper, before "frames still missing"
  base(); box.sbSheetFromEarlierLook = vm.runInContext("sbSheetFromEarlierLook", sbx); box.shotLookIsEarlier = sbx.shotLookIsEarlier;
  box.nbGetMeta = sbx.nbGetMeta = (id)=> id==="sbsheet-sbpage-s1-2x2-0" ? { composed:true, missing:1 } : id==="a1" ? { lookSig:"old" } : null;
  const [row] = rowsOf(film({ scenes:[film().scenes[0]] }), new Set(["ana","house","a1","sbsheet-sbpage-s1-2x2-0"]));
  assert.equal(row.boards.oldLook, 1); assert.equal(row.boards.partial, 0); assert.equal(row.boards.current, 0);
});

/* ═══ E ═══ */
await test("E1 B16 file names keep the title's own letters", ()=>{
  base(); previews.length = 0;
  box.exportStripboard([], { title:"Café Ψυχή" });
  assert.equal(previews.pop().fileName, "CAFÉ_ΨΥΧΉ_STRIPBOARD.html");
  box.exportStripboard([], { title:"!!!" });
  assert.equal(previews.pop().fileName, "FILM_STRIPBOARD.html");
});
await test("E2 B17 the stripboard: approved as the tab says (+ out of date), Boards and Clips columns, a failed check, landscape", ()=>{
  base();
  box.shotFrameState = (sh)=> sh.id==="a1" ? { rendered:true, current:false, approved:true, done:false } : { rendered:true, current:true, approved:true, done:true };
  const stageStatus = { s1:{ total:2, rendered:1, stale:0, identity:1 } };
  const rows = box.breakdownRows({ ...film(), stageStatus, img:(id)=>["ana","ben","house","yard","a1","b1","sbsheet-sbpage-s1-2x2-0"].indexOf(id)>=0 });
  previews.length = 0;
  box.exportStripboard(rows, { title:"T" }, { checkFailed:true });
  const html = previews.pop().html;
  assert.ok(html.includes("1 approved (1 out of date) · 1/1"), "decision I: the tab's approved count, its out-of-date ones noted");
  assert.ok(html.includes("<th>Boards</th><th>Clips</th>") && html.includes("1 of 1 sheet up to date") && html.includes("1 left out — a character changed"));
  assert.ok(html.includes("the counts may be high") && html.includes("@page{size:landscape;}"));
});
await test("E3 B18/H the bible: rooms & times and state plates, 'On <owner>'s sheet', text props not loaded, colours validated, links counted", async ()=>{
  base(); previews.length = 0;
  const loaded = [];
  box.nbGetImage = (id)=> ({ ana:"https://s/ana.png", "locunit-k1":"data:image/png;base64,ROOM", "house-v2":"https://s/v2.png" })[id] || "";
  box.nbLoadImage = async (id)=>{ loaded.push(id); return ""; };
  box.sbToDataUrl = async (u)=> u==="https://s/ana.png" ? "data:image/png;base64,ANA" : u;   // v2 can't be copied
  box.PropScreenplay = { sheetTier:(p)=>({ tier: p.id==="note" ? "text" : "own" }) };
  box.turnContinuity = { sluglineUnits:[{ key:"k1", subspaceKey:"house", name:"Kitchen", time:"NIGHT", intExt:"INT" }] };
  box.locationKeyOf = (l)=> l.key || l.id; box.sluglineUnitImageId = (k)=> "locunit-"+k;
  box.locationAppearanceStates = (l)=> [{ id:"v1", state:"Flooded", linkedUnit:{ key:"k1" } }, { id:"v2", state:"Burnt" }];
  box.locationAppearanceStateAssetId = (l, v)=> v.linkedUnit ? "locunit-"+v.linkedUnit.key : "house-"+v.id;
  const f = film({ characters:[{ id:"ana", name:"Ana", palette:["#aabbcc", "#abc;background:url(x)", "rgb(1, 2, 3)", "#aabbcc Navy", "rebeccapurple", "expression(alert(1))"] }],
    props:[{ id:"hat", name:"Hat", kind:"worn", ownerId:"ana", scenes:["s1"] }, { id:"note", name:"Note", kind:"carried", scenes:["s1"] }] });
  await box.exportArtBible(f);
  const html = previews.pop().html;
  assert.ok(html.includes('<img src="data:image/png;base64,ANA" alt="Ana">'));
  assert.ok(html.includes("<b>INT · Kitchen · NIGHT — Flooded</b>") && html.includes("(room &amp; time)") && html.includes('src="data:image/png;base64,ROOM"'));
  assert.ok(html.includes("<b>Burnt</b>") && html.includes("(appearance state)") && html.includes('src="https://s/v2.png"'));
  assert.ok(html.includes("On Ana’s sheet") && html.includes("Text only — described in shots"));
  assert.ok(loaded.indexOf("note")<0, "a text-only prop loads nothing");
  assert.ok(loaded.indexOf("hat")>=0, "a worn item's own close-up is looked up");
  const sw = (html.match(/class="sw" style="background:([^"]*)"/g)||[]).map(x=>x.replace(/.*background:/,"").replace(/"$/,""));
  assert.deepEqual(sw, ["#aabbcc", "rgb(1, 2, 3)", "rebeccapurple"]);
  assert.ok(html.includes("1 image is a link that expires within the hour"), "B18: counted, not called embedded");
  assert.equal(box.bdCssColor("oklch(0.7 0.1 250 / 50%)"), "oklch(0.7 0.1 250 / 50%)");
  assert.equal(box.bdCssColor("#12345"), ""); assert.equal(box.bdCssColor("notacolour"), "");
  delete box.turnContinuity; delete box.nbLoadImage; delete box.sbToDataUrl;
});
await test("E4 B19 one bible at a time; the preview opens at once and fills when done; a few at a time; a per-image limit", async ()=>{
  base(); previews.length = 0; toasts.length = 0; events.length = 0;
  let open = 0, peak = 0; const waits = [];
  box.nbGetImage = ()=>"";
  box.nbLoadImage = (id)=> new Promise(res=>{ open++; peak = Math.max(peak, open); waits.push(()=>{ open--; res("data:image/png;base64,"+id); }); });
  const chars = Array.from({ length:10 }, (_, i)=>({ id:"c"+i, name:"C"+i }));
  const f = film({ characters:chars, props:[], locations:[] });
  const live = { live:true };
  box.docPreview = (o)=>{ Object.assign(live, o); previews.push(live); return { setHtml:(h)=>{ live.html = h; }, close:()=>{ live.closed = true; } }; };
  const run = box.exportArtBible(f);
  assert.equal(previews.length, 1, "opened at once"); assert.match(live.html, /Preparing 0 of 10/);
  await box.exportArtBible(f);
  assert.equal(previews.length, 1, "a second click opens nothing"); assert.ok(/still being prepared/.test(toasts.pop()));
  assert.deepEqual(J(box.bdBibleProgress()), { i:0, total:10 });
  while(waits.length || open){ await new Promise(r=>setTimeout(r, 1)); const w = waits.shift(); if(w) w(); }
  await run;
  assert.ok(peak<=4 && peak>1, "loads in parallel, a few at a time: "+peak);
  assert.ok(live.html.includes("Art department bible") && live.html.includes('alt="C9"'), "filled when done");
  assert.equal(box.bdBibleProgress(), null);
  assert.ok(events.some(e=>e.type==="turn-art-bible-progress" && e.detail && e.detail.i===10));
  // a per-image time limit: one that never answers doesn't hold the document
  const realST = box.setTimeout; box.setTimeout = (fn, ms)=> realST(fn, ms===20000 ? 5 : ms);
  box.nbLoadImage = (id)=> id==="c3" ? new Promise(()=>{}) : Promise.resolve("data:image/png;base64,"+id);
  await box.exportArtBible(f);
  box.setTimeout = realST;
  assert.ok(live.html.includes('alt="C4"') && !live.html.includes('alt="C3"'));
  delete box.nbLoadImage;
});
await test("E5 B19 the bible stops quietly on a film switch; embedded images are downscaled (never larger)", async ()=>{
  base(); previews.length = 0;
  const live = {};
  box.docPreview = (o)=>{ Object.assign(live, o); return { setHtml:(h)=>{ live.html = h; }, close:()=>{ live.closed = true; } }; };
  box.turnOpenFilmId = "A";
  box.nbGetImage = ()=>""; box.nbLoadImage = async (id)=>{ box.turnOpenFilmId = "B"; return "data:image/png;base64,"+id; };
  await box.exportArtBible(film({ characters:[{ id:"c1", name:"C1" }, { id:"c2", name:"C2" }], locations:[] }));
  assert.ok(live.closed && !/Art department bible<\/h1>/.test(live.html||""), "closed, never filled with the old film");
  delete box.turnOpenFilmId; delete box.nbLoadImage;
  // downscale: long side 1600, JPEG 0.85
  let drawn = null;
  box.document = { createElement:()=>({ width:0, height:0, getContext(){ return { fillRect:noop, drawImage:(im, x, y, w, h)=>{ drawn = [w, h]; } }; },
    toDataURL:(t, q)=>{ drawn.push(t, q); return "data:image/jpeg;base64,S"; } }) };
  box.Image = function(){ const me = this; Object.defineProperty(me, "src", { set(v){ me.naturalWidth = 3200; me.naturalHeight = 1600; setTimeout(()=>me.onload && me.onload(), 0); } }); };
  box.nbGetImage = (id)=> id==="c1" ? "data:image/png;base64,"+"A".repeat(400) : "";
  await box.exportArtBible(film({ characters:[{ id:"c1", name:"C1" }], locations:[] }));
  assert.deepEqual(drawn, [1600, 800, "image/jpeg", 0.85]);
  assert.ok(live.html.includes('<img src="data:image/jpeg;base64,S" alt="C1">'));
  delete box.document; delete box.Image;
  box.docPreview = (o)=>{ previews.push(o); return previews.length; };
});

/* ═══ P ═══ */
await test("P1 one Make progress for the app: a run from Shots/the Stage, or before a tab switch, shows on its strip", ()=>{
  base();
  assert.equal(box.bdSceneNeedsProgress(), null, "no API: nothing");
  box.turnSceneNeedsProgress = ()=>({ sceneId:"s1", i:2, total:5, label:"Ana", filmId:"A" });
  box.turnOpenFilmId = "A";
  assert.deepEqual(J(box.bdSceneNeedsProgress()), { sceneId:"s1", i:2, total:5, label:"Ana", filmId:"A" });
  box.turnOpenFilmId = "B";
  assert.equal(box.bdSceneNeedsProgress(), null, "another film's run isn't this board's");
  box.turnOpenFilmId = "A";
  box.sceneReferenceNeeds = ()=>[{ id:"house", kind:"location", label:"House", makeable:true }];
  const [r] = rowsOf(film({ scenes:[film().scenes[0]] }), new Set(["ana","a1"]));
  R.reset();
  const t = box.BreakdownStrip({ row:r, go:noop, needsBusy:box.bdSceneNeedsProgress(), onMakeSceneNeeds:null });
  assert.ok(textOf(t).includes("Making 2 of 5…"), "shown with no button to press");
  R.reset();
  const t2 = box.BreakdownStrip({ row:r, go:noop, needsBusy:box.bdSceneNeedsProgress(), onMakeSceneNeeds:async ()=>({}) });
  const mk = buttons(t2).find(b=>/Making 2 of 5/.test(textOf(b)));
  assert.ok(mk && mk.props.disabled);
  // the view reads it on mount and listens for the event; the live region says it
  const v = between(bd, "function BreakdownView({", "\nwindow.BreakdownView");
  assert.ok(v.includes('window.addEventListener("turn-scene-needs-progress", h)') && v.includes("const run = needsBusy || appRun;"));
  const tv = view({ ...film({ scenes:[film().scenes[0]] }), onMakeSceneNeeds:async ()=>({}) });
  const live = findAll(tv, n=>n.props && n.props["aria-live"]==="polite")[0];
  assert.equal(textOf(live), "Scene 01: making 2 of 5 — Ana…");
  delete box.turnSceneNeedsProgress; delete box.turnOpenFilmId;
});
await test("P2 a run's result is announced", ()=>{
  assert.equal(box.bdRunResultText("Scene 03", { status:"done", made:3, already:1, failed:0 }), "Scene 03: 3 reference images made, 1 already there.");
  assert.equal(box.bdRunResultText("Scene 03", { status:"partial", made:1, failed:2 }), "Scene 03: 1 reference image made, 2 couldn't be made.");
  assert.equal(box.bdRunResultText("Scene 03", { status:"cancelled" }), "Scene 03: cancelled — nothing was made.");
  assert.equal(box.bdRunResultText("Scene 03", { status:"busy" }), "");
  // the run says where it came from, and the chip counts with the plan's own count when App has it
  assert.ok(bd.includes('label:label||"" }), { from:"breakdown" }); }') && bd.includes('window.turnSceneNeedsImageCount(makeable)'));
});
await test("P3 speed: rows are cached per scene and recounted only where an image changed — the same counts as a full recount", ()=>{
  base();
  let calls = 0; box.shotFrameState = (sh, list, d, p, img)=>{ calls++; const r = img(sh.id); return { rendered:r, current:r, approved:!!sh.locked, done:r && !!sh.locked }; };
  const f = film(); const made = new Set(["ana","ben","house","yard","b1"]);
  const img = (id)=>made.has(id);
  const cache = box.bdNewCache();
  const a = box.breakdownRows({ ...f, img, cache });
  assert.equal(calls, 2);
  const b = box.breakdownRows({ ...f, img, cache });
  assert.equal(calls, 2, "nothing changed: nothing recounted"); assert.ok(a[0]===b[0] && a[1]===b[1]);
  made.add("a1"); box.bdCacheDirty(cache, ["a1"], f.shots);   // a frame of scene 1 lands
  const c = box.breakdownRows({ ...f, img, cache });
  assert.equal(calls, 3, "only scene 1"); assert.ok(c[1]===b[1] && c[0]!==b[0]);
  assert.deepEqual(J(c), J(box.breakdownRows({ ...f, img })), "the same as a full recount");
  made.delete("house"); box.bdCacheDirty(cache, ["house"], f.shots);   // a plate: every scene may read it
  const d = box.breakdownRows({ ...f, img, cache });
  assert.equal(calls, 3+2+2, "every scene (and the full recount above)"); assert.deepEqual(J(d), J(box.breakdownRows({ ...f, img })));
  box.bdCacheDirty(cache, null, f.shots); box.breakdownRows({ ...f, img, cache });
  assert.equal(calls, 9+2, "an event with no ids recounts everything");
  const f2 = { ...f, shots:f.shots.map(s=> s.id==="b1" ? { ...s, locked:false } : s) };   // a shot object changed
  box.breakdownRows({ ...f2, img, cache });
  assert.equal(calls, 12, "only its scene");
  const sb2 = box.breakdownRows({ ...f2, img, cache, stageStatus:{ s1:{ total:1, rendered:1 } } });
  assert.equal(calls, 13); assert.equal(sb2[0].clips.total, 1);
  const v = between(bd, "function BreakdownView({", "\nwindow.BreakdownView");
  assert.ok(v.includes("cache:cacheRef.current") && v.includes('window.addEventListener("nb-gen-done", gone)') && v.includes("if(hit.length){ dirty(hit);"));
});
await test("P4 screen readers: the strips are a list under scene headings; Make's progress and result in a live region", ()=>{
  base(); box.nbGetImage = (id)=> ["ana","ben","house","yard","a1","b1"].indexOf(id)>=0 ? "u" : "";
  const t = view({ ...film() });
  const list = findAll(t, n=>n.props && n.props.role==="list")[0];
  assert.ok(list && list.props["aria-label"]==="Scenes");
  const items = findAll(t, n=>n.type===box.BreakdownLine);   // one line per scene; its strip opens under it (2026-10-23)
  assert.equal(items.length, 2);
  R.reset();
  const strip = box.BreakdownStrip({ row:items[0].props.row, go:noop });
  assert.equal(strip.props.role, "listitem");
  const h = findAll(strip, n=>n.type==="h3")[0];
  assert.ok(h && strip.props["aria-labelledby"]===h.props.id && /^Scene 01: Kitchen — ready$/.test(textOf(h)), textOf(h));
  assert.ok(bd.includes('role:"status","aria-live":"polite","aria-atomic":"true"') && bd.includes("onSaid(bdRunResultText(tag, res));"));
});
await test("P5 the legend has 'No time of day'; '+N more' looks and acts like a button", ()=>{
  base(); box.nbGetImage = ()=>"u";
  const t = view({ ...film() });
  const legend = findAll(t, n=>n.props && n.props["aria-label"]==="Strip colours")[0];
  assert.ok(textOf(legend).includes("No time of day"));
  assert.ok(/\.bd-need\.more\{color:var\(--txt-3\);cursor:pointer\}/.test(css) && /\.bd-need\.more:hover\{color:var\(--txt-0\);text-decoration:underline\}/.test(css));
  assert.ok(/\.bd-k-none\{--bd-c:var\(--txt-3\)\}/.test(css) && /\.bd-dot\.owner\{/.test(css) && /\.bd-scene-needs\{/.test(css));
});

await test("Z the Stage saves clips left out after an identity change; Frances knows the pass; keys", ()=>{
  const stage = read("app/stage.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html"), app = read("app/app.jsx");
  assert.ok(stage.includes("if(identityVids[c.id] && !vids[c.id]) o.identity++;"));
  assert.ok(stage.indexOf("const [identityVids, setIdentityVids]") < stage.indexOf("const stageStatusSig"), "declared before the status signature reads it");
  assert.ok(app.includes("React.createElement(ArtRoom,{key:(cloudMode?currentProjectId:\"local\"),artView,setArtView,project,projectLoading,"));
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  const w = fb.__F.find(f=>f.name==="Breakdown (Art Room)").what;
  for(const now of ["EVERY ROLE CAN USE IT", "A FAILED CHECK SAYS SO", "N frames to approve (free, in Shots)", "needs an owner", "MAKE WHAT THIS SCENE NEEDS plans first", "THE ART DEPARTMENT BIBLE is prepared one at a time"])
    assert.ok(w.includes(now), now);
  for(const f of ["breakdown", "artroom", "imagegen", "props", "storyboard", "cloud", "app", "stage", "shots-ui", "locations", "ai", "script"])
    assert.ok(["20261009-bd4", "20261010-nb21", "20261010-like1", "20261010-pron1", "20261010-del1", "20261010-pose2", "20261010-voice1", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('src="app/'+f+'.jsx?v='+k+'"')), f);
  assert.ok(["20261009-bd4", "20261010-voice1", "20261010-pose2", "20261010-del1", "20261010-pron1", "20261010-like1", "20261010-nb21", "20261011-voice2", "20261011-eng1", "20261011-pron2", "20261011-rv1", "20261011-v4a", "20261012-art1", "20261013-fact1", "20261013-arc1", "20261013-cdx1", "20261028-hs119", "20261028-hs122", "20261028-hs124", "20261028-hs125", "20261028-hs126", "20261028-hs127", "20261028-hs130", "20261028-hs131", "20261028-hs121", "20261013-loc1", "20261013-loc2", "20261013-map1", "20261014-locfix1", "20261014-locfix2", "20261016-hs1", "20261016-hs2", "20261016-hs3", "20261016-hs4", "20261016-hs5", "20261016-hs6", "20261016-hs7", "20261016-hs8", "20261016-hs9", "20261016-hs10", "20261016-hs11", "20261016-hs12", "20261016-hs13", "20261016-hs14", "20261016-hs15", "20261016-hs16", "20261016-hs17", "20261018-hs18", "20261018-hs19", "20261018-hs20", "20261018-hs21", "20261018-hs22", "20261018-hs23", "20261018-hs24", "20261018-hs25", "20261018-hs26", "20261018-hs27", "20261019-hs28", "20261019-hs29", "20261019-hs30", "20261019-hs31", "20261019-hs32", "20261019-hs33", "20261019-hs34", "20261020-hs35", "20261020-hs36", "20261020-hs37", "20261020-hs38", "20261020-hs39", "20261020-hs40", "20261021-hs41", "20261021-hs42", "20261021-hs43", "20261021-hs44", "20261021-hs45", "20261021-hs46", "20261022-hs47", "20261022-hs48", "20261023-hs49", "20261023-hs50", "20261023-hs51", "20261023-hs52", "20261023-hs53", "20261024-hs54", "20261024-hs55", "20261028-hs118", "20261028-hs128", "20261028-hs132", "20261028-hs134", "20261028-hs129", "20261028-hs120", "20261028-hs123", "20261024-hs56", "20261024-hs57", "20261024-hs58", "20261024-hs59", "20261024-hs60", "20261024-hs61", "20261024-hs62", "20261024-hs63", "20261024-hs64", "20261024-hs65", "20261024-hs66", "20261024-hs67", "20261024-hs68", "20261024-hs69", "20261024-hs70", "20261025-hs71", "20261025-hs72", "20261025-hs73", "20261025-hs74", "20261025-hs75", "20261025-hs76", "20261025-hs77", "20261025-hs78", "20261025-hs79", "20261025-hs80", "20261025-hs81", "20261025-hs82", "20261025-hs83", "20261025-hs84", "20261025-hs85", "20261025-hs86", "20261026-hs87", "20261026-hs88", "20261026-hs89", "20261026-hs90", "20261026-hs91", "20261026-hs92", "20261026-hs93", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114", "20261027-hs94", "20261027-hs95", "20261027-hs96", "20261027-hs97", "20261027-hs98", "20261027-hs99", "20261027-hs100", "20261028-hs133", "20261027-hs101", "20261027-hs102", "20261027-hs103", "20261027-hs104", "20261027-hs105", "20261027-hs106", "20261027-hs107", "20261027-hs108", "20261027-hs109", "20261027-hs110", "20261027-hs111", "20261027-hs112", "20261027-hs113", "20261028-hs114"].some(k=>html.includes('href="app/styles.css?v='+k+'"')));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

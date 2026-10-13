#!/usr/bin/env node
/* "Make what this scene needs" — the Breakdown review (2026-10-09, owner: "all of it").
   PLAN ONCE, ASK ONCE, RUN THAT PLAN: the plan is built before the question (storage, reference counts, one look
   per character, reviewed rooms, owners), the question prices exactly that plan, the run makes exactly its steps.
   1  a character's look is drafted once per run (the variant reuses it); the question counts looks per character
   2  (E) a master that failed is never made again by its variant: "needs <name>'s sheet, which couldn't be made"
   3  an empty look / prop draft is a failed step — no generic sheet is paid for
   4  each image is priced with its reference count ("up to" when only the maximum is known)
   5  a film switch stops the run after every await; the generators take the caller's stop (cancelled) — nothing is
      sent or written after it; writes go through the run's film-guarded setters
   6  (F) a billing or role refusal stops the run: "stopped — <sentence>. Made: …; not made: …"; other errors go on
   7  a second window making the same scene is told so (a localStorage lock with a heartbeat)
   8  "made" counts only what was made ("exists" otherwise); retries are said in the result
   C  carried props with no owner / not in the screenplay, rooms without a reviewed layout, missing owners: not
      priced, named in the question and the result
   G  on a shared film the question says the owner pays, within your monthly budget (and what's left)
   +  the progress API (window.turnSceneNeedsProgress, "turn-scene-needs-progress"), the film named in the toast,
      neutral wording outside the Breakdown, and the Stage's clip bits
     node scripts/test-scene-needs-make.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));   // values from the vm realm

const app = read("app/app.jsx"), stage = read("app/stage.jsx"), locs = read("app/locations.jsx"), propsSrc = read("app/props.jsx");
const shots = read("app/shots.jsx"), plans = read("app/plans.jsx");
const BLOCK = between(app, "  const sceneNeedsBusyRef = React.useRef(false);", "  const wornBuildRef = React.useRef(null);");
const COUNT = between(shots, "function sceneNeedsImageCount(needs, has){", "window.sceneNeedsImageCount = sceneNeedsImageCount;");
const BILLING = between(plans, "const BILLING_CODES = {", "window.turnBillingError = billingError;");

/* ---- one browser window running the real makeSceneNeeds with recording generators ---- */
function makeWindow(setup, shared){
  const s = setup || {};
  const log = [], toasts = [], asks = [], events = [], writes = [];
  const store = shared && shared.store || Object.assign({}, s.store||{});
  const listeners = {};
  const sb = { console, Object, Array, String, Number, Math, JSON, Promise, Set, Map, Date, Error };
  sb.window = sb; vm.createContext(sb);
  const ls = shared && shared.ls || new Map();
  Object.assign(sb, {
    React:{ useRef:(v)=>({ current:v }) },
    CustomEvent: class { constructor(type, init){ this.type = type; this.detail = init && init.detail; } },
    dispatchEvent:(e)=>{ events.push({ type:e.type, detail:e.detail }); (listeners[e.type]||[]).slice().forEach(h=>h(e)); return true; },
    addEventListener:(t, h)=>{ (listeners[t] = listeners[t]||[]).push(h); },
    removeEventListener:(t, h)=>{ listeners[t] = (listeners[t]||[]).filter(x=>x!==h); },
    localStorage:{ getItem:(k)=> ls.has(k) ? ls.get(k) : null, setItem:(k, v)=>{ ls.set(k, String(v)); }, removeItem:(k)=>{ ls.delete(k); } },
    setInterval:()=>1, clearInterval:()=>{},
    appToast:(m, k)=>{ toasts.push({ m, k }); },
    appConfirm: async (o)=>{ asks.push(o); log.push("ASK"); return s.answer===undefined ? true : s.answer; },
    // a GPT Image-like price: 4 credits an image, +1 a reference image
    nbImageCostText:(n, o)=> String((4 + Number((o&&o.refs)||0)) * Math.max(1, Number(n)||1)),
    charVisualsDrafted:(c)=> !!c.look,
    turnContinuity:{ sluglineUnits: s.units||[] },
    nbEpoch:()=> sb.__epoch, __epoch:1,
    projIdRef:{ current:"film-1" }, projectsRef:{ current:[{ id:"film-1", title:"Night Train" }] }, project:{ title:"Night Train" },
    projectLoadingRef:{ current:false }, artRoomReadOnlyRef:{ current:false },
    _projectLoadingNotice(){ log.push("loading"); }, _mutationNotice(){ log.push("readonly"); },
    _imgOf: async (id)=> store[id] || "",
    lbProject:()=>({}), keepPickedStyle:(p, x)=>x,
    setProps:()=>{ throw new Error("raw setProps used"); }, setLocations:()=>{ throw new Error("raw setLocations used"); },
    characters: s.characters||[], props: s.props||[], locations: s.locations||[],
    locationGenerationOrder:(ls0)=> ls0.slice().sort((a,b)=>(a.parentKey?1:0)-(b.parentKey?1:0)),
    locationParentOf:(l, list)=> l.parentKey ? ((list||sb.locations).find(x=>x.key===l.parentKey) || null) : null,
    requireLocationSpatialPlan:(l)=>{ if(l.unreviewed) throw new Error("Review the shared set layout before rendering."); return { owner:l, plan:{ source:{} }, source:{} }; },
    sluglineUnitImageId:(k)=> "locunit-"+k,
    stagingHasContent:(l)=> !!l.staging,
    locationPlateRefCount:(l)=> ({ n: l.refs==null ? 2 : l.refs, exact: l.refsExact!==false }),
    sluglineUnitPlateRefCount:(l, u)=> ({ n: u.refs==null ? 3 : u.refs, exact:true }),
    nbGetCameoAngles:(cid)=> (s.cameos||{})[cid] || [],
    PropScreenplay:{ notInScreenplay:(p)=> !!p.notInScript },
    BILLING_EMAIL:"billing@example.test",
    turnFilmPaidByOwner: s.shared ? ()=>true : undefined, turnFilmBudget: s.budget || null,
    aiPropVisuals: async (p)=>{ log.push("WRITE design "+p.id); if(s.onPropDesign) return s.onPropDesign(p, sb); return s.propDraftNull ? null : { form:"f", material:"m" }; },
    generateLocationPlate: async (l, project, o)=>{ log.push("IMG plate "+l.id); sb.__plateOpts = o;
      if(s.onPlate){ const r = await s.onPlate(l, o, sb); if(r!==undefined) return r; }
      store[l.id] = "u"; return true; },
    generateSluglineUnitPlate: async (l, u, project, o)=>{ log.push("IMG unit "+u.key); store["locunit-"+u.key] = "u"; return true; },
    generatePropSheet: async (p, project, o)=>{ log.push("IMG prop "+p.id+(p.form?" form="+p.form:"")); sb.__propOpts = o;
      if(s.onProp){ const r = await s.onProp(p, o, sb); if(r!==undefined) return r; }
      store[p.id] = "u"; return true; },
  });
  let drafts = 0, masters = 0;
  sb.artAgentCtxFactoryRef = { current:(args)=>{ sb.__ctxArgs = args; return { art:{
    writes:{ setProps:(fn)=>writes.push(["props", fn(s.props||[])]), setLocations:(fn)=>writes.push(["locations", fn(s.locations||[])]) },
    cast:{
      draftSpec: async (c)=>{ drafts++; log.push("WRITE look "+c.id+" #"+drafts); if(s.onDraft){ const r = await s.onDraft(c, sb); if(r!==undefined) return r; }
        return s.draftNull ? null : { look:"look#"+drafts }; },
      generateMaster: async (c)=>{ masters++; log.push("IMG master "+c.id+" look="+(c.look||"<none>"));
        if(s.onMaster){ const r = await s.onMaster(c, args, sb, masters); if(r!==undefined) return r; }
        store[c.id] = "m"; return "m"; },
      generateState: async (c, st, base)=>{ log.push("IMG state "+c.id+":"+st.id+" look="+(c.look||"<none>")+" base="+base);
        store[c.id+":"+st.id] = "s"; return "s"; } } } }; } };
  vm.runInContext(BILLING, sb);
  sb.turnBillingError = sb.billingError;
  vm.runInContext(COUNT+"\nwindow.sceneNeedsImageCount = sceneNeedsImageCount;", sb);
  vm.runInContext(BLOCK.replace("const sceneNeedsBusyRef = React.useRef(false);", "globalThis.sceneNeedsBusyRef = React.useRef(false);")
    .replace("const makeSceneNeeds = async", "globalThis.makeSceneNeeds = async"), sb);
  const run = (needs, scene, opts, onProgress)=> sb.makeSceneNeeds(scene || { id:"sc3", no:3 }, needs, onProgress || (()=>{}), opts);
  return { sb, log, toasts, asks, events, writes, store, run, ls, last:()=> (toasts[toasts.length-1]||{}).m || "" };
}
const ANA = { id:"A", name:"Ana", states:[{ id:"s1", label:"Wounded" }, { id:"s2", label:"Wet" }] };
const need = (id, kind, label, extra)=> ({ id, baseId:String(id).split(":")[0], kind, label:label||id, makeable:true, ...(extra||{}) });

/* ═══ 1 ═══ */
await test("1 one look per character: drafted once, reused by the variant; the question counts looks per character", async ()=>{
  const w = makeWindow({ characters:[ANA] });
  const r = await w.run([need("A","character","Ana"), need("A:s1","character","Ana · Wounded"), need("A:s2","character","Ana · Wet")]);
  assert.deepEqual(w.log.filter(l=>/^WRITE/.test(l)), ["WRITE look A #1"], w.log.join("\n"));
  assert.ok(w.log.includes("IMG master A look=look#1") && w.log.includes("IMG state A:s1 look=look#1 base=m") && w.log.includes("IMG state A:s2 look=look#1 base=m"));
  assert.match(w.asks[0].body, /plus writing credits to draft 1 character look first/);
  assert.equal(r.made, 3);
});
await test("1b variants only (master missing): the master is planned once, the look drafted once", async ()=>{
  const w = makeWindow({ characters:[ANA] });
  await w.run([need("A:s1","character","Ana · Wounded"), need("A:s2","character","Ana · Wet")]);
  assert.equal(w.log.filter(l=>/^WRITE look/.test(l)).length, 1);
  assert.equal(w.log.filter(l=>/^IMG master/.test(l)).length, 1);
  assert.deepEqual(J(w.asks[0].items), ["Ana", "Ana · Wounded", "Ana · Wet"]);
});

/* ═══ 2 / E ═══ */
await test("2 (E) a failed master is never re-made by the variant step — it says what it needs", async ()=>{
  const w = makeWindow({ characters:[{ ...ANA, look:"x" }], onMaster:()=>{ throw new Error("provider 500"); } });
  const r = await w.run([need("A","character","Ana"), need("A:s1","character","Ana · Wounded")]);
  assert.equal(w.log.filter(l=>/^IMG master/.test(l)).length, 1, w.log.join("\n"));
  assert.ok(!w.log.some(l=>/^IMG state/.test(l)));
  assert.match(w.last(), /Ana · Wounded — needs Ana's sheet, which couldn't be made/);
  assert.match(w.last(), /Ana — provider 500/);
  assert.equal(r.status, "partial"); assert.equal(r.made, 0);
});

/* ═══ 3 ═══ */
await test("3 an empty look draft fails its step; no sheet is paid for", async ()=>{
  const w = makeWindow({ characters:[ANA], draftNull:true });
  await w.run([need("A","character","Ana"), need("A:s1","character","Ana · Wounded")]);
  assert.ok(!w.log.some(l=>/^IMG/.test(l)), w.log.join("\n"));
  assert.equal(w.log.filter(l=>/^WRITE look/.test(l)).length, 1, "never a second paid draft");
  assert.match(w.last(), /Ana — couldn't draft the look/);
});
await test("3b an empty prop design fails its step; no generic sheet", async ()=>{
  const w = makeWindow({ characters:[{ ...ANA, look:"x" }], store:{ A:"m" }, props:[{ id:"P", name:"Knife", ownerId:"A" }], propDraftNull:true });
  await w.run([need("P","prop","Knife")]);
  assert.ok(!w.log.some(l=>/^IMG prop/.test(l)), w.log.join("\n"));
  assert.match(w.last(), /Knife — couldn't design the prop/);
});

/* ═══ 4 ═══ */
await test("4 each image priced with its references: plate 2, room 3, master (1 worn + 2 cameo), variant (master + 2 cameo), prop (owner)", async ()=>{
  const w = makeWindow({
    locations:[{ id:"L", key:"house", name:"House", staging:"x" }],
    units:[{ key:"house-night", locationKey:"house", name:"House", time:"NIGHT" }],
    characters:[{ ...ANA, look:"x" }], cameos:{ A:["c1","c2"] },
    props:[{ id:"W", name:"Coat", ownerId:"A", kind:"worn", form:"f", material:"m" }, { id:"P", name:"Knife", ownerId:"A", form:"f", material:"m" }],
    store:{ W:"u" } });
  const r = await w.run([need("L","location","House"), need("locunit-house-night","location","House · NIGHT"),
    need("A","character","Ana"), need("A:s1","character","Ana · Wounded"), need("P","prop","Knife")]);
  // (4+2) + (4+3) + (4+3) + (4+3) + (4+1) = 32
  assert.match(w.asks[0].body, /^5 reference images — about 32 credits\./, w.asks[0].body);
  assert.equal(w.asks[0].confirmLabel, "Make 5");
  assert.equal(r.made, 5);
});
await test("4b a reference count known only as a maximum is said as 'up to'", async ()=>{
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x", refs:6, refsExact:false }] });
  await w.run([need("L","location","House")]);
  assert.match(w.asks[0].body, /^1 reference image — up to 10 credits\./);
});
await test("4c the plate counts mirror the generators (locations.jsx): parent + reviewed layout + a room's views + pages, capped at 6", ()=>{
  const fn = between(locs, "function locationPlateRefCount(l){", "/* a room & time plate:");
  assert.ok(fn.includes("return { n:Math.min(6, ids.size+views+pages), exact:true };") && fn.includes("locationScriptPageRefs(l, null, null, 6)"));
  // a room also counts the views of the space beyond its openings (2026-10-13, Location coordinates)
  assert.ok(fn.includes("views = locationSubspacePanelPlan(l, null, null, { maxSources:ownerDistinct ? 3 : 4 }).sources.length;"));
  const u = between(locs, "function sluglineUnitPlateRefCount(l, u, opts){", "window.locationPlateRefCount");
  assert.ok(u.includes("locationScreenplayReferenceImages(l, sluglineUnitPseudoSheet(id, u)") && u.includes("return { n:pages+ids.size, exact };"));
  assert.ok(locs.includes("const pseudo = sluglineUnitPseudoSheet(id, u, role);"), "the plate and its count read the same pages");
  // imagegen prices references on GPT Image (read-only check of the helper the question uses)
  assert.ok(read("app/imagegen.jsx").includes("if(isGptImageModel(model) && Number(opts.refs)>0) usd += 0.012 * Number(opts.refs);"));
});

/* ═══ 5 ═══ */
await test("5 a film switch inside a step stops the run: nothing after it is sent", async ()=>{
  const w = makeWindow({ characters:[{ ...ANA, look:"x" }], props:[{ id:"P", name:"Knife", ownerId:"A", form:"f", material:"m" }],
    onMaster:(c, args, sb)=>{ sb.__epoch = 2; return "m"; } });
  const r = await w.run([need("A","character","Ana"), need("A:s1","character","Ana · Wounded"), need("P","prop","Knife")]);
  assert.ok(!w.log.some(l=>/^IMG (state|prop)/.test(l)), w.log.join("\n"));
  assert.equal(r.status, "stopped");
  assert.match(w.last(), /Scene 03: stopped — 1 of 3 made; not made: Ana · Wounded, Knife\./);
});
await test("5b a switch during a prop's design: no write, no sheet", async ()=>{
  const w = makeWindow({ characters:[{ ...ANA, look:"x" }], store:{ A:"m" }, props:[{ id:"P", name:"Knife", ownerId:"A" }],
    onPropDesign:(p, sb)=>{ sb.projIdRef.current = "film-2"; return { form:"f", material:"m" }; } });
  await w.run([need("P","prop","Knife")]);
  assert.equal(w.writes.length, 0); assert.ok(!w.log.some(l=>/^IMG prop/.test(l)));
  assert.match(w.last(), /^“Night Train” — Scene 03: stopped/, "the toast names the film it was made for");
});
await test("5c the generators get the run's stop; the view composition is saved only through the guarded setter", async ()=>{
  let staged = null;
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House" }],
    onPlate:(l, o, sb)=>{ assert.equal(typeof o.cancelled, "function"); assert.equal(o.cancelled(), false);
      o.onStaged("L", "STAGING"); staged = w.writes.slice();
      sb.__epoch = 9; assert.equal(o.cancelled(), true, "the plate sees the switch");
      o.onStaged("L", "LATE"); return false; } });
  const r = await w.run([need("L","location","House")]);
  assert.deepEqual(staged.map(x=>x[0]), ["locations"]);
  assert.equal(w.writes.length, 1, "nothing written after the switch");
  assert.match(w.asks[0].body, /1 view composition/);
  assert.equal(r.status, "stopped");
  assert.ok(BLOCK.includes('const save = (name, fn)=>{ if(!stale() && typeof W[name]==="function") W[name](fn); };') && !/[^.]setProps\(ps=>/.test(between(BLOCK, "const makeSceneNeeds", "const where")));
  assert.ok(app.includes("        writes:_w,"), "the art context exposes the inFilm setters");
});
await test("5d generateLocationPlate / generateSluglineUnitPlate honour the caller's stop (incl. after the staging draft)", async ()=>{
  const start = locs.indexOf("function _nbLocRunSnapshot("), end = locs.indexOf("\n/* coverage audit", start);
  const calls = [];
  const box = { console, Date, Set, CustomEvent: class { constructor(t, i){ this.type = t; this.detail = i && i.detail; } },
    turnContinuity:{ scenes:[] }, NB_MODELS:[], nbGetModel:()=>"m", nbGetAspect:()=>"16:9", nbGetRes:()=>"2K", nbEpoch:()=>1,
    nbWritingSourcesFor:()=>[], dispatchEvent:()=>true, combinedLocationPrompt:()=>"P", buildSimpleLocationPrompt:()=>"S",
    locationAssetDependencySnapshot:()=>({}), locationParentReferences: async ()=>[], locationParentOf:()=>null,
    locationReferenceInstructions:()=>"", locationSpatialReferences: async ()=>[], mergeLocationReferences:(...g)=>g.flat(),
    stagingHasContent:(l)=>!!l.staging, aiAvailable:()=>true,
    aiDraftStaging: async ()=>{ calls.push("staging"); stop = true; return "ST"; },
    nbGenerate: async ()=>{ calls.push("generate"); throw new Error("no image"); }, nbCommit: async ()=>{ calls.push("commit"); return { tier:"local" }; },
    sluglineUnitImageId:(k)=>"locunit-"+k, requireLocationSpatialPlan:()=>({}), nbGetImage:()=>"own", locationScreenplayReferenceImages:()=>[] };
  box.window = box; vm.createContext(box);
  let stop = false;
  vm.runInContext(locs.slice(start, end), box);
  const staged = [];
  assert.equal(await box.generateLocationPlate({ id:"L", name:"House" }, {}, { draftStaging:true, cancelled:()=>stop, onStaged:(id, st)=>staged.push(st) }), false);
  assert.deepEqual(calls, ["staging"]); assert.deepEqual(staged, [], "nothing saved, nothing sent after the switch");
  // the simpler-prompt retry is a second paid image: the caller hears it, and a stop before it sends nothing
  stop = false; calls.length = 0; const retries = [];
  box.nbGenerate = async ()=>{ calls.push("generate"); if(calls.length===1) throw new Error("no image"); return "url"; };
  assert.equal(await box.generateLocationPlate({ id:"L2", name:"House", staging:"x" }, {}, { cancelled:()=>stop, onRetry:()=>retries.push(1) }), true);
  assert.deepEqual(calls, ["generate", "generate", "commit"]); assert.equal(retries.length, 1);
  calls.length = 0; retries.length = 0;
  box.nbGenerate = async ()=>{ calls.push("generate"); stop = true; throw new Error("no image"); };
  assert.equal(await box.generateLocationPlate({ id:"L3", name:"House", staging:"x" }, {}, { cancelled:()=>stop, onRetry:()=>retries.push(1) }), false);
  assert.deepEqual(calls, ["generate"]); assert.equal(retries.length, 0);
  stop = false; calls.length = 0;
  box.nbGenerate = async ()=>{ calls.push("generate"); stop = true; throw new Error("no image"); };
  assert.equal(await box.generateSluglineUnitPlate({ id:"L", name:"House" }, { key:"k", name:"House" }, {}, { cancelled:()=>stop, onRetry:()=>retries.push(1) }), false);
  assert.deepEqual(calls, ["generate"], "no retry after the stop"); assert.equal(retries.length, 0);
  stop = false; calls.length = 0;
  box.nbGenerate = async ()=>{ calls.push("generate"); if(calls.length===1) throw new Error("no image"); return "url"; };
  assert.equal(await box.generateSluglineUnitPlate({ id:"L", name:"House" }, { key:"k2", name:"House" }, {}, { cancelled:()=>stop, onRetry:()=>retries.push(1) }), true);
  assert.equal(retries.length, 1);
});
await test("5e generatePropSheet: the stop is checked before sending and before saving; retries and errors go to the caller", async ()=>{
  const start = propsSrc.indexOf("/* opts (2026-10-09, owner — Breakdown review), for \"Make what this scene needs\":");
  const end = propsSrc.indexOf("window.generatePropSheet = generatePropSheet;", start);
  let env = null; const toasts = [];
  const box = { console, propOwnerSheetUrl: async ()=>"owner-url", propOwnerNote:()=>"", nbGetMeta:()=>null, nbGetImage:()=>"",
    appToast:(m)=>toasts.push(m), nbRunSheetGeneration: async (e)=>{ env = e; return true; } };
  box.window = box; vm.createContext(box);
  vm.runInContext(propsSrc.slice(start, end), box);
  let stop = false; const retries = [], errors = [];
  await box.generatePropSheet({ id:"P", ownerId:"A" }, {}, { cancelled:()=>stop, onRetry:()=>retries.push(1), onError:(m)=>errors.push(m) });
  assert.equal((await env.opts.attachments()).length, 1);
  stop = true;
  await assert.rejects(env.opts.attachments(), (e)=> e.__cancelled===true && e.requiredReference===true);
  await assert.rejects(env.opts.assertPostGenerate(), (e)=> e.__cancelled===true);
  await assert.rejects(env.opts.assertFreshBeforeFallback(), (e)=> e.__cancelled===true);
  assert.equal(retries.length, 0, "a stopped retry is never announced");
  stop = false; await env.opts.assertFreshBeforeFallback(); assert.equal(retries.length, 1);
  env.ui.setGenErr("The image server rejected this request"); assert.deepEqual(errors, ["The image server rejected this request"]); assert.equal(toasts.length, 0);
  // without opts it behaves as before: the error is toasted, nothing throws
  await box.generatePropSheet({ id:"Q" }, {});
  await env.opts.assertFreshBeforeFallback(); await env.opts.assertPostGenerate();
  env.ui.setGenErr("boom"); assert.deepEqual(toasts, ["boom"]);
});

/* ═══ 6 / F ═══ */
await test("6 (F) a billing refusal stops the run: Stopped — <sentence>. Made: …; not made: …", async ()=>{
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }], characters:[{ ...ANA, look:"x" }],
    props:[{ id:"P", name:"Knife", ownerId:"A", form:"f", material:"m" }],
    onMaster:()=>{ const e = new Error("Not enough credits for this. Top up with a credit pack or upgrade your plan."); e.billing = "insufficient"; throw e; } });
  const r = await w.run([need("L","location","House"), need("A","character","Ana"), need("A:s1","character","Ana · Wounded"), need("P","prop","Knife")]);
  assert.equal(r.status, "refused"); assert.equal(r.refusal, "insufficient");
  assert.ok(!w.log.some(l=>/^IMG (state|prop)/.test(l)), w.log.join("\n"));
  assert.equal(w.last(), "Scene 03: stopped — Not enough credits for this. Top up with a credit pack or upgrade your plan. Made: House; not made: Ana, Ana · Wounded, Knife.");
});
await test("6b a refusal a generator keeps to itself (the billing-refusal event) stops it too — a budget or a role", async ()=>{
  for(const code of ["budget_reached", "film_role", "owner_insufficient", "team_paused", "account_frozen"]){
    const w = makeWindow({ characters:[{ ...ANA, look:"x" }], store:{ A:"m" },
      props:[{ id:"P", name:"Knife", ownerId:"A", form:"f", material:"m" }, { id:"Q", name:"Gun", ownerId:"A", form:"f", material:"m" }],
      onProp:(p, o, sb)=>{ sb.dispatchEvent(new sb.CustomEvent("turn-credits-changed", { detail:{ reason:"billing-refusal", code } })); return false; } });
    const r = await w.run([need("P","prop","Knife"), need("Q","prop","Gun")]);
    assert.equal(r.status, "refused", code); assert.equal(w.log.filter(l=>/^IMG prop/.test(l)).length, 1, code);
    const sentence = w.sb.billingError({ code }, 0).message.replace(/\.$/, "");
    assert.equal(w.last(), "Scene 03: stopped — "+sentence+". Made: nothing; not made: Knife, Gun.", code);
  }
});
await test("6c other errors go on with the next step", async ()=>{
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }, { id:"K", key:"kit", name:"Kitchen", staging:"x" }],
    onPlate:(l)=>{ if(l.id==="L") throw new Error("The image server took too long"); } });
  const r = await w.run([need("L","location","House"), need("K","location","Kitchen")]);
  assert.ok(w.log.includes("IMG plate K")); assert.equal(r.status, "partial"); assert.equal(r.made, 1);
  assert.match(w.last(), /Scene 03: 1 of 2 couldn't be made: House — The image server took too long\. Made: Kitchen\./);
});

/* ═══ 7 ═══ */
await test("7 a second window making the same scene is told so; the lock frees when the run ends (and expires)", async ()=>{
  const shared = { ls:new Map(), store:{} };
  let release; const gate = new Promise(r=>{ release = r; });
  const a = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }], onPlate: async ()=>{ await gate; } }, shared);
  const b = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }] }, shared);
  const pa = a.run([need("L","location","House")]);
  await new Promise(r=>setTimeout(r, 5));
  const rb = await b.run([need("L","location","House")]);
  assert.equal(rb.status, "busy"); assert.equal(b.last(), "This scene's needs are already being made in another window.");
  assert.equal(b.asks.length, 0, "never asked");
  release(); await pa;
  assert.equal(shared.ls.size, 0, "freed");
  // a window that closed mid-run: its lock expires
  shared.ls.set("turn_scene_needs_lock:film-1:sc3", JSON.stringify({ owner:"gone", at:Date.now()-60000 }));
  delete shared.store.L;
  const rc = await b.run([need("L","location","House")]);
  assert.equal(rc.status, "done");
  assert.ok(BLOCK.includes("setInterval(()=>sceneNeedsLockTake(lockKey), 5000)"), "a heartbeat while it runs");
});

/* ═══ 8 ═══ */
await test("8 'made' counts only what was made; things that appeared meanwhile are 'already there'", async ()=>{
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }], characters:[{ ...ANA, look:"x" }],
    onPlate:(l, o, sb)=>{ w.store.A = "m"; w.store["A:s1"] = "s"; } });
  const r = await w.run([need("L","location","House"), need("A","character","Ana"), need("A:s1","character","Ana · Wounded")]);
  assert.equal(r.made, 1); assert.equal(r.already, 2);
  assert.equal(w.last(), "Scene 03 has what it needs — 1 reference image made, 2 already there.");
});
await test("8b retries are said: the character's 'asked once more' and the plate's simpler-prompt retry", async ()=>{
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }], characters:[{ ...ANA, look:"x" }],
    onPlate:(l, o)=>{ o.onRetry(); },
    onMaster:(c, args)=>{ args.emit({ k:"observe", t:"The image service returned no image, so it asked once more (one more image)." }); } });
  await w.run([need("L","location","House"), need("A","character","Ana")]);
  assert.match(w.last(), /2 images needed a second try\./);
  assert.match(w.asks[0].body, /An image that comes back empty is asked once more — only that second try is charged\./);
});

/* ═══ C ═══ */
await test("C what the plan can't make is not priced, and is named in the question and the result", async ()=>{
  const w = makeWindow({ characters:[{ ...ANA, look:"x" }], store:{ A:"m" },
    locations:[{ id:"R", key:"room", name:"Back room", unreviewed:true }],
    units:[{ key:"gone-night", locationKey:"nowhere", name:"Gone", time:"NIGHT" }],
    props:[{ id:"P", name:"Knife", ownerId:"A", form:"f", material:"m" }, { id:"X", name:"Coin", kind:"carried", form:"f", material:"m" },
      { id:"Y", name:"Lamp", ownerId:"A", notInScript:true, form:"f", material:"m", screenplaySources:[] }, { id:"Z", name:"Map", ownerId:"A", form:"f", material:"m", screenplaySources:["s1"] }] });
  const needs = [need("R","location","Back room"), need("locunit-gone-night","location","Gone · NIGHT"), need("P","prop","Knife"), need("X","prop","Coin"), need("Y","prop","Lamp")];
  const r = await w.run(needs);
  assert.match(w.asks[0].body, /^1 reference image — about 5 credits\./);
  assert.deepEqual(J(w.asks[0].items), ["Knife"]);
  assert.equal(w.asks[0].note, "Not made here: Back room — needs its set layout reviewed (Locations); Gone · NIGHT — needs its location card — the place it belongs to is gone (Locations); Coin — needs an owner (Props); Lamp — isn't in the screenplay (Props).");
  assert.ok(!w.log.some(l=>/IMG (plate R|unit|prop X|prop Y)/.test(l)));
  assert.equal(r.blocked, 4);
  assert.match(w.last(), /^Scene 03: 1 reference image made\. Not made here: Back room/);
  // the Stage's count leaves them out too
  assert.equal(w.sb.turnSceneNeedsImageCount(needs), 1);
});
await test("C2 nothing makeable: one neutral sentence (the Breakdown keeps its own words)", async ()=>{
  const w = makeWindow({ props:[{ id:"X", name:"Coin", kind:"carried" }] });
  const r = await w.run([need("X","prop","Coin")]);
  assert.equal(r.status, "nothing"); assert.equal(w.asks.length, 0);
  assert.equal(w.last(), "None of these can be made here — Coin — needs an owner (Props). Open its tab (Locations, Characters or Props) to make it.");
  await w.run([need("X","prop","Coin")], null, { from:"breakdown" });
  assert.match(w.last(), /^Nothing here can be made from the Breakdown — Coin/);
  assert.ok(!BLOCK.includes('"Nothing here can be made from the Breakdown \\u2014 open its tab'));
});

/* ═══ G ═══ */
await test("G on a shared film the owner pays, within your budget (and what's left)", async ()=>{
  const w = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }], shared:true, budget:{ limit:200, spent:50 } });
  await w.run([need("L","location","House")]);
  assert.match(w.asks[0].body, /^1 reference image — about 6 credits from the film owner's credits, within your monthly budget on this film \(150 left this month\)\./);
  const v = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }], shared:true, budget:{ limit:null, spent:9 } });
  await v.run([need("L","location","House")]);
  assert.match(v.asks[0].body, /within your monthly budget on this film\./);
  const o = makeWindow({ locations:[{ id:"L", key:"house", name:"House", staging:"x" }] });
  await o.run([need("L","location","House")]);
  assert.ok(!/owner/.test(o.asks[0].body));
});

/* ═══ plan / ask / run ═══ */
await test("P the run makes exactly the plan it asked about, in order; cancelling makes nothing; busy only after yes", async ()=>{
  const w = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }, { id:"K", key:"kitchen", name:"Kitchen", parentKey:"house", staging:"x" }],
    units:[{ key:"kitchen-night", locationKey:"kitchen", name:"Kitchen", time:"NIGHT" }],
    characters:[{ ...ANA, look:"x" }], props:[{ id:"P", name:"Pen", ownerId:"A", form:"f", material:"m" }] });
  const prog = [];
  await w.run([need("P","prop","Pen"), need("A:s1","character","Ana · Wounded"), need("locunit-kitchen-night","location","Kitchen · NIGHT"),
    need("K","location","Kitchen"), need("A","character","Ana"), need("H","location","House")], null, null, (i,t,l)=>prog.push(i+"/"+t+(l?" "+l:"")));
  assert.deepEqual(w.log.filter(l=>/^IMG/.test(l)), ["IMG plate H", "IMG plate K", "IMG unit kitchen-night", "IMG master A look=x", "IMG state A:s1 look=x base=m", "IMG prop P form=f"]);
  assert.deepEqual(J(w.asks[0].items), ["House", "Kitchen", "Kitchen · NIGHT", "Ana", "Ana · Wounded", "Pen"]);
  assert.deepEqual(prog, ["0/6", "1/6 House", "2/6 Kitchen", "3/6 Kitchen · NIGHT", "4/6 Ana", "5/6 Ana · Wounded", "6/6 Pen"]);
  assert.equal(w.log.indexOf("ASK"), 0, "the plan is checked (storage) before the question; nothing is made before it");
  const c = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }], answer:false });
  const pr = []; const r = await c.run([need("H","location","House")], null, null, (i)=>pr.push(i));
  assert.equal(r.status, "cancelled"); assert.deepEqual(pr, []); assert.ok(!c.log.some(l=>/^IMG/.test(l)));
  // a child whose parent can't be made isn't made either
  const d = makeWindow({ locations:[{ id:"H", key:"house", name:"House", unreviewed:true }, { id:"K", key:"kitchen", name:"Kitchen", parentKey:"house", staging:"x" }] });
  await d.run([need("H","location","House"), need("K","location","Kitchen")]);
  assert.match(d.asks.length ? d.asks[0].note||"" : d.last(), /Kitchen — needs House's plate first \(Locations\)/);
});
await test("P2 an answer given after a switch makes nothing", async ()=>{
  const w = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }] });
  w.sb.appConfirm = async ()=>{ w.sb.__epoch = 5; return true; };
  const r = await w.run([need("H","location","House")]);
  assert.equal(r.status, "stopped"); assert.ok(!w.log.some(l=>/^IMG/.test(l)));
});

/* ═══ progress API ═══ */
await test("API one Make progress for the whole app: turnSceneNeedsProgress() + turn-scene-needs-progress", async ()=>{
  let seen = null;
  const w = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }],
    onPlate:(l, o, sb)=>{ seen = sb.turnSceneNeedsProgress(); } });
  assert.equal(w.sb.turnSceneNeedsProgress(), null);
  await w.run([need("H","location","House")], { id:"sc3", no:3 });
  assert.deepEqual(J(seen), { sceneId:"sc3", sceneNo:3, scope:"scene", filmId:"film-1", filmTitle:"Night Train", i:1, total:1, label:"House" });
  const ev = w.events.filter(e=>e.type==="turn-scene-needs-progress").map(e=>e.detail);
  assert.deepEqual(ev.map(d=>d ? d.i : null), [0, 1, null]); assert.equal(ev[ev.length-1], null);
  assert.equal(w.sb.turnSceneNeedsProgress(), null, "cleared when it ends");
  // one run at a time, app-wide — and a second click while the question is open does nothing
  w.sb.sceneNeedsBusyRef.current = true;
  assert.equal((await w.run([need("H","location","House")])).status, "busy");
  w.sb.sceneNeedsBusyRef.current = false;
  let second = null;
  const q = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }] });
  q.sb.appConfirm = async ()=>{ second = await q.run([need("H","location","House")]); return true; };
  await q.run([need("H","location","House")]);
  assert.equal(second.status, "busy", "a second click while the question is open starts nothing");
  assert.equal(q.log.filter(l=>/^IMG/.test(l)).length, 1);
});

/* ═══ the Stage ═══ */
await test("S the Stage: busy only after yes, the clip's own question, the chip counts as the question does, runs elsewhere show", async ()=>{
  const cc = between(stage, "  const makeableNeeds = (readiness.needs||[]).filter(x=>x.makeable);", "  const sourceMeta = STAGE_SOURCE_MODES[sourceMode]");
  assert.ok(!cc.includes("setNeedsRun({ i:0, total:makeableNeeds.length });"));
  assert.ok(cc.includes('await onMakeSceneNeeds(scene, makeableNeeds, (i,total)=>setNeedsRun({ i, total }), { scope:"clip", from:"stage" });'));
  assert.ok(cc.includes('window.addEventListener("turn-scene-needs-progress", h);') && cc.includes("window.turnSceneNeedsImageCount(makeableNeeds)"));
  assert.ok(stage.includes('"Make the "+needsImages+" missing reference image"+(needsImages!==1?"s":"")+" this clip\'s shots use"'));
  assert.ok(stage.includes("window.nbCostChip(needsImages)") && !stage.includes("window.nbCostChip(makeableNeeds.length)"));
  assert.ok(stage.includes('disabled:!!needsRun||!!needsApp||gening'));
  const w = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }] });
  await w.run([need("H","location","House")], null, { scope:"clip", from:"stage" });
  assert.equal(w.asks[0].title, "Make what this clip needs?");
  assert.equal(w.last(), "This clip has what it needs — 1 reference image made.");
  const x = makeWindow({ locations:[{ id:"H", key:"house", name:"House", staging:"x" }] });
  await x.run([need("H","location","House")]);
  assert.equal(x.asks[0].title, "Make what Scene 03 needs?");
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

#!/usr/bin/env node
/* ============================================================================
   LIKENESS — the GENERATION half (2026-10-10, owner — Likeness review; internal name "cameo").
   ONE RULE for every character-sheet path: when a likeness is locked, the FRONT angle is image 1,
   the other angles next, then the master (a variant / an update), then the worn-item sheets, then
   a dropped reference photo; the prompt carries a NUMBERED image map and asks to match the face
   from the angles; the face fields of the text spec are left out; every sheet records meta.cameo,
   meta.cameoAt, mode and private references (the angles are never stored as sheet references).
     A  the card's runner (nbRunSheetGeneration, dist/app/artroom.js): master, stylized style, edit /
        remaster (front angle only, cameo carried), variant before / from the master, the simplified
        retry (the prompt actually sent), no silent GPT Image fallback with a face, a dropped photo
        added beside the likeness + the consent step, a likeness that can't be used here, stale
     B  the Casting Director (app.jsx: generateMaster — so Scene needs and Wear props —, generateState)
        and the prop owner's pre-generation (generateCharMaster) follow the same helper
     C  prices count the references (the card, the edit, the batch, Design the cast, Scene needs)
     D  the Stage: no "fictional context" for a real likeness, a note before rendering, consent on a
        Motion Control upload
     E  naming: "Likeness" everywhere the user reads it; saved "cameo" labels mapped where displayed
   Run AFTER `npm run build`:   node scripts/test-likeness-generation.mjs
   ============================================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a.slice(0,80)); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b.slice(0,80)); return src.slice(i, j); };
let passes = 0, failures = 0;
const test = async (name, fn)=>{ try{ await fn(); passes++; console.log("PASS", name); }
  catch(e){ failures++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));

const art = read("app/artroom.jsx"), app = read("app/app.jsx"), stage = read("app/stage.jsx"),
  agents = read("app/agents.jsx"), imagegen = read("app/imagegen.jsx");

/* ---------------- the sandbox: dist/app/artroom.js with the nb* layer stubbed ---------------- */
const noop = ()=>{};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
  React: { createElement:(type, props, ...children)=>({ type, props:props||{}, children }), useState:(v)=>[typeof v==="function"?v():v, noop],
    useEffect:noop, useRef:(v)=>({ current:v }), useMemo:(f)=>f(), useCallback:(f)=>f, Fragment:"Fragment" },
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
  CustomEvent: class { constructor(type, opts){ this.type = type; this.detail = opts && opts.detail; } },
  Image: class {},
  document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null,
    addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop } },
  requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop,
  matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("dist/app/artroom.js"), sandbox, { filename:"dist/app/artroom.js" });
const W = sandbox;
for(const fn of ["nbRunSheetGeneration","turnLikenessPlan","turnLoadLikeness","turnLikenessSheetRequest","charSheetPrompt",
  "turnLikenessMasterPrompt","turnLikenessVariantPrompt","turnLikenessStale","turnLikenessRefCount","turnLikenessUnavailableText",
  "turnLikenessUnavailableGate","turnLikenessConsent","likenessDisplayLabel","LikenessBatchCost","buildSimpleCharPromptFor"])
  if(typeof W[fn]!=="function"){ console.log("FAIL "+fn+" missing from dist/app/artroom.js — run npm run build"); process.exit(1); }

const CHAR = { id:"char-1", name:"Mara Quinn", role:"Lead", renderStyleKey:"photoreal",
  physique:{ age:"mid-30s", ethnicity:"Irish", skin:"pale, freckled", eyes:"green", hair:"copper bob", face:"long, angular", build:"wiry, athletic" },
  coreBody:"Apparent age: mid-30s. Ethnicity: Irish. Hair: copper bob. Body type: wiry, athletic.",
  wardrobeMask:"a battered navy pea coat over a grey jumper", accessories:"a leather belt" };
const ANGLES = [{ label:"Front", url:"data:FRONT" },{ label:"¾ Left", url:"data:LEFT" },{ label:"¾ Right", url:"data:RIGHT" }];
const CAPTURED = "2026-10-05T10:00:00.000Z";

let genCalls, commits, uiCalls, epoch, backend, genImpl, confirms, confirmAnswer, gates, gateAnswer, cameoInfo, cameoRec;
const rec = (fn)=>(...args)=>{ uiCalls.push({ fn, args }); };
let ui;
const reset = ()=>{
  genCalls = []; commits = []; uiCalls = []; epoch = 1; backend = "cloud"; confirms = []; confirmAnswer = true; gates = []; gateAnswer = true;
  cameoInfo = { locked:true, synced:false, angleCount:3, capturedAt:CAPTURED, consent:{ subject:"Me", name:"", adult:true }, mine:true, available:true, why:"" };
  cameoRec = { angles:ANGLES.slice(), iso:CAPTURED };
  genImpl = async ()=>"data:image/png;base64,RENDER";
  W.__nbGenInflight = {}; W.__nbGenCancel = {}; W.__nbGenAbort = {}; W.__nbGenRunSeq = 0;
  W.nbDiscardSheetSave("char-1"); W.nbDiscardSheetSave("char-1:st1");
  W.dispatchEvent = noop;
  W.nbHasKeyForCurrent = ()=>true; W.nbEpoch = ()=>epoch; W.nbBackend = ()=>backend;
  W.nbGetModel = ()=>NB21; W.nbSetModel = noop; W.isGptImageModel = (m)=>/^gpt-image/.test(String(m||""));
  W.nbGetAspect = ()=>"16:9"; W.nbGetRes = ()=>"2K"; W.nbGetOaiQuality = ()=>"medium"; W.nbRequireImageQuality = async ()=>true;
  W.nbGetGroundSearch = ()=>false; W.nbGetSlotImage = ()=>null; W.nbImageDimensions = async ()=>({ w:1024, h:576 });
  W.nbGetHistory = async ()=>[]; W.nbGetMeta = ()=>null; W.slotAssetKind = ()=>"character"; W.nbWithAssetProvenance = ()=>({});
  W.nbCameoInfo = (id)=> id==="char-1" ? cameoInfo : null;
  W.nbLoadCameoFull = async (id)=> id==="char-1" ? cameoRec : null;
  W.nbGetCameoAngles = ()=>[]; W.nbLoadCameoAngles = async ()=>[];
  W.nbImageCostText = (n, o)=> String((4 + Number((o&&o.refs)||0)) * Math.max(1, Number(n)||1));
  W.appConfirm = async (o)=>{ confirms.push(o); return confirmAnswer; };
  W.cameoConsentGate = async (o)=>{ gates.push(o); return gateAnswer; };
  W.turnIsContentBlock = (s)=>/safety system/.test(String(s));
  W.nbGenerate = async (prompt, opts)=>{ genCalls.push({ prompt, opts:{ ...opts, signal:undefined } }); return genImpl(prompt, opts); };
  W.nbCommit = async (id, url, meta, refs, kind)=>{ commits.push({ id, url, meta:J(meta), refs:J(refs), kind }); return { tier:"cloud", url:"signed:"+url }; };
  ui = { setGenErr:rec("setGenErr"), setGening:rec("setGening"), setRetrying:rec("setRetrying"), setGenUrl:rec("setGenUrl"),
    setGenTier:rec("setGenTier"), setGenMeta:rec("setGenMeta"), closeEdit:rec("closeEdit") };
};
const errs = ()=> uiCalls.filter(c=>c.fn==="setGenErr").map(c=>c.args[0]).filter(Boolean);
const imgs = (g)=> [g.opts.referenceImage, ...(g.opts.extraImages||[])].filter(Boolean);
/* the engines (2026-10-11, owner — image engines) */
const NB21 = "gemini-nano-banana-2.1", SUN = "gpt-image-2.5-sunburst", SEED = "seedream-5-pro";
const MODELS = [{ id:NB21, label:"Nano Banana 2.1" },{ id:"gpt-image-2.5-flare", label:"GPT Image 2.5 Flare" },
  { id:SUN, label:"GPT Image 2.5 Sunburst" },{ id:SEED, label:"Seedream 5 Pro" }];
/* the character card's opts, as CharacterSheet builds them (artroom.jsx) */
const cardOpts = (c, extra)=>({ cameoId:c.id, entity:c, identityCharacter:c,
  buildFinal:()=>W.charSheetPrompt(c, {}, [], null),
  buildFromPhoto:()=>W.buildRefFromPhotoPrompt(c, {}),
  buildFromBase:()=>"UPDATE "+W.charSheetPrompt(c, {}, [], null),
  buildLikeness:(ctx)=>W.turnLikenessMasterPrompt(c, {}, [], ctx),
  buildSimple:(o)=>W.buildSimpleCharPromptFor(c, o),
  buildEdit:(i)=>"Edit this character design sheet for "+c.name+". Apply ONLY this change: "+i+".",
  attachments: async ()=>[{ url:"data:BELT", note:"Leather belt (worn)", refId:"prop-belt" }],
  attachmentsText:(a)=>"WORN-ATTACH-TEXT("+a.length+")",
  ...(extra||{}) });
const env = (over)=>({ id:"char-1", slotId:"charref-char-1", opts:cardOpts(CHAR), allModels:MODELS,
  genUrl:"", genMeta:null, slotHasRef:false, ui, ...(over||{}) });
const FACE_TEXT = /mid-30s|Irish|freckled|green|copper|angular|apparent_age|ethnicity/i;

/* ═══ A — the card's runner ═══ */
await test("A1 master: front first, the other angles, then the worn item; a numbered map; the face left out of the spec; meta.cameo/cameoAt/mode/privateRefs", async ()=>{
  reset();
  await W.nbRunSheetGeneration(env(), {});
  assert.equal(genCalls.length, 1);
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT","data:BELT"]);
  assert.match(g.prompt, /REFERENCE IMAGES, in the order attached: Image 1 = the person's face, front\. Images 2–3 = the same face with the head turned to the person's own left and to their own right \(three-quarter views\)\. Image 4 = worn item: Leather belt — lock it onto the character exactly/);
  assert.match(g.prompt, /this character is played by the real person in images 1–3\. Match that face exactly/);
  assert.ok(!FACE_TEXT.test(g.prompt), "no written face: "+(g.prompt.match(FACE_TEXT)||[])[0]);
  assert.match(g.prompt, /wiry, athletic/, "the build stays");
  assert.match(g.prompt, /pea coat/, "the wardrobe stays");
  assert.match(g.prompt, /"face_and_hair": "from the attached likeness photos/);
  assert.ok(!/WORN-ATTACH-TEXT|additional reference image/i.test(g.prompt), "the map replaces the old unnumbered sentences");
  assert.equal(g.opts.referencesNumbered, true);
  const m = commits[0].meta;
  assert.equal(m.cameo, true); assert.equal(m.cameoAt, CAPTURED); assert.equal(m.mode, "cameo");
  assert.equal(m.privateRefs, 3); assert.equal(m.likenessRefs, 3);
  assert.deepEqual(commits[0].refs.map(r=>r.kind), ["prop"], "the angles are never stored as the sheet's references");
  assert.equal(m.prompt, g.prompt);
});
await test("A1b local mode: the angles are still not stored as references (counted instead)", async ()=>{
  reset(); backend = "local";
  await W.nbRunSheetGeneration(env(), {});
  assert.deepEqual(commits[0].refs.map(r=>r.kind), ["prop"]);
  assert.equal(commits[0].meta.privateRefs, 3);
});
await test("A2 a stylized render style keeps the person recognisable in that style (decision G)", async ()=>{
  reset();
  const c = { ...CHAR, renderStyleKey:"anime" };
  await W.nbRunSheetGeneration(env({ opts:cardOpts(c) }), {});
  const p = genCalls[0].prompt;
  assert.match(p, /Keep the person recognisable — their face shape, features and proportions — drawn in the Anime \/ manga style/);
  assert.ok(!/Match that face exactly/.test(p));
  assert.equal(W.turnLikenessStyle({ renderStyleKey:"photorealCreature" }).photoreal, true);
  assert.equal(W.turnLikenessStyle({ renderStyleKey:"pixar" }).photoreal, false);
  assert.equal(W.turnLikenessStyle({ renderStyleKey:"claymation" }).photoreal, false);
});
await test("A3 editing / remastering a likeness sheet re-attaches the FRONT angle only and carries meta.cameo (decision E)", async ()=>{
  reset();
  await W.nbRunSheetGeneration(env({ genUrl:"data:SHEET", genMeta:{ cameo:true, cameoAt:"2026-10-01T00:00:00.000Z", iso:"2026-10-02T00:00:00.000Z" } }),
    { editInstruction:"make the coat black", editRefImages:["data:UPLOAD"], editRefMeta:[{ url:"data:UPLOAD", note:"coat photo" }] });
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:SHEET","data:FRONT","data:BELT","data:UPLOAD"]);
  assert.match(g.prompt, /Image 1 = the sheet being edited\. Image 2 = the person's face, front — keep it\. Image 3 = worn item: Leather belt/);
  assert.match(g.prompt, /Image 4 = coat photo\./);
  assert.match(g.prompt, /keep the face exactly as in image 2/);
  assert.ok(!g.prompt.includes("data:LEFT") && !imgs(g).includes("data:LEFT"));
  const m = commits[0].meta;
  assert.equal(m.cameo, true); assert.equal(m.mode, "edit"); assert.equal(m.cameoAt, CAPTURED);
  assert.equal(gates.length, 1, "a device upload on a character sheet asks for consent"); assert.equal(gates[0].purpose, "edit");
});
await test("A3b an edit of a sheet NOT made with the likeness attaches no face", async ()=>{
  reset();
  await W.nbRunSheetGeneration(env({ genUrl:"data:SHEET", genMeta:{ iso:"2026-10-02T00:00:00.000Z" } }), { editInstruction:"Reproduce this image exactly" });
  assert.deepEqual(imgs(genCalls[0]), ["data:SHEET","data:BELT"]);
  assert.equal(commits[0].meta.cameo, false);
  assert.ok(!/LIKENESS/.test(genCalls[0].prompt));
});
await test("A3c an edit of a likeness sheet whose likeness is gone still carries meta.cameo (the face is that person's)", async ()=>{
  reset(); cameoInfo = null; cameoRec = null;
  await W.nbRunSheetGeneration(env({ genUrl:"data:SHEET", genMeta:{ cameo:true, cameoAt:"2026-10-01T00:00:00.000Z" } }), { editInstruction:"fix the collar" });
  assert.deepEqual(imgs(genCalls[0]), ["data:SHEET","data:BELT"]);
  assert.equal(commits[0].meta.cameo, true); assert.equal(commits[0].meta.cameoAt, "2026-10-01T00:00:00.000Z");
});
const ST = { id:"st1", label:"Soaked", change:"drenched hair and coat, mud on the knees" };
const stateOpts = (base)=>({ cameoId:CHAR.id, entity:{ ...CHAR, appearanceState:ST }, identityCharacter:CHAR,
  buildFinal:()=>W.charSheetPrompt(CHAR, {}, [], null)+" APPEARANCE STATE — Soaked",
  buildFromBase: base ? (()=>"Edit this character design sheet. Maintain the reference sheet's EXISTING layout") : null,
  referenceFallback: base ? (()=>base) : null, referenceFallbackId: base ? CHAR.id : null,
  buildFromPhoto:()=>"Edit this character design sheet. Maintain the reference sheet's EXISTING layout",
  buildLikeness:(ctx)=>W.turnLikenessVariantPrompt(CHAR, ST, {}, [], ctx),
  buildSimple:(o)=>W.buildSimpleCharPromptFor(CHAR, o)+" "+ST.change });
await test("A4 a variant BEFORE the master: a proper sheet from the face — never \"edit this design sheet… keep its layout\"", async ()=>{
  reset();
  await W.nbRunSheetGeneration(env({ id:"char-1:st1", slotId:"charref-char-1:st1", opts:stateOpts(null) }), {});
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT"]);
  assert.match(g.prompt, /There is no master sheet yet: make this a complete character sheet in THIS changed state/);
  assert.ok(!/EXISTING layout|Edit this character design sheet/.test(g.prompt));
  assert.ok(!FACE_TEXT.test(g.prompt));
  assert.equal(commits[0].meta.cameo, true); assert.equal(commits[0].meta.mode, "cameo");
  assert.ok(art.includes("No master sheet yet \\u2014 this variant is made from the locked likeness and the text spec."), "the hint says so");
});
await test("A5 a variant FROM the master: angles, then the master (image 4) — only the change differs", async ()=>{
  reset();
  await W.nbRunSheetGeneration(env({ id:"char-1:st1", slotId:"charref-char-1:st1", opts:stateOpts("data:MASTER") }), {});
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT","data:MASTER"]);
  assert.match(g.prompt, /Image 4 is the master sheet: keep its layout, panel arrangement, framing, render style, build and wardrobe, and apply only this appearance change: drenched hair/);
  assert.match(g.prompt, /Image 4 = this character's master sheet/);
  assert.match(g.prompt, /The face comes from images 1–3/);
  const m = commits[0].meta;
  assert.equal(m.mode, "base"); assert.equal(m.cameo, true);
  assert.deepEqual(commits[0].refs.map(r=>[r.kind, r.url]), [["base","data:MASTER"]], "the master is recorded as the base sheet");
});
await test("A6 the 'no image' simplified retry keeps the likeness sentence and the map; Details records the prompt actually sent", async ()=>{
  reset();
  let n = 0; genImpl = async ()=>{ if(n++===0) throw new Error("The image service returned no image."); return "data:image/png;base64,R"; };
  await W.nbRunSheetGeneration(env(), {});
  assert.equal(genCalls.length, 2);
  const retry = genCalls[1];
  assert.deepEqual(imgs(retry), ["data:FRONT","data:LEFT","data:RIGHT","data:BELT"]);
  assert.match(retry.prompt, /^Character reference — Mara Quinn/);
  assert.match(retry.prompt, /REFERENCE IMAGES, in the order attached: Image 1 = the person's face, front\./);
  assert.match(retry.prompt, /LIKENESS \(binding\)/);
  assert.ok(!FACE_TEXT.test(retry.prompt), "the simplified prompt has no written face either");
  assert.equal(commits[0].meta.prompt, retry.prompt);
  assert.equal(commits[0].meta.simplifiedRetry, true);
  assert.equal(commits[0].meta.cameo, true);
});
await test("A6b 'Try simplified prompt' (an explicit retry) still sends the face, with the map", async ()=>{
  reset();
  await W.nbRunSheetGeneration(env(), { simple:true });
  assert.deepEqual(imgs(genCalls[0]), ["data:FRONT","data:LEFT","data:RIGHT"]);
  assert.match(genCalls[0].prompt, /Image 1 = the person's face, front/);
  assert.equal(commits[0].meta.cameo, true); assert.equal(commits[0].meta.mode, "simple");
});
await test("A7 a GPT Image refusal with a face never falls back on its own: it asks, with the price, and only then sends (to Nano Banana 2.1)", async ()=>{
  reset(); W.nbGetModel = ()=>SUN; confirmAnswer = false;
  let n = 0; genImpl = async ()=>{ if(n++===0) throw new Error("Your request was rejected by the safety system."); return "data:image/png;base64,R"; };
  // Seedream listed before Nano Banana 2.1 on purpose: the fallback is Nano Banana 2.1, not the first non-GPT engine
  const models = [{ id:SUN, label:"GPT Image 2.5 Sunburst" },{ id:SEED, label:"Seedream 5 Pro" },{ id:NB21, label:"Nano Banana 2.1" }];
  await W.nbRunSheetGeneration(env({ allModels:models }), {});
  assert.equal(genCalls.length, 1, "no second request");
  assert.equal(confirms.length, 1);
  assert.match(confirms[0].title, /^GPT Image 2\.5 Sunburst refused this\. Try Nano Banana 2\.1 with the same photos\? · about \d+ credits?$/);
  assert.match(errs().join(" "), /Nothing else was sent/);
  assert.equal(commits.length, 0);
  // yes → the same photos go to the other engine, once
  reset(); W.nbGetModel = ()=>SUN; confirmAnswer = true;
  n = 0; genImpl = async ()=>{ if(n++===0) throw new Error("Your request was rejected by the safety system."); return "data:image/png;base64,R"; };
  await W.nbRunSheetGeneration(env({ allModels:models }), {});
  assert.equal(genCalls.length, 2); assert.equal(genCalls[1].opts.model, NB21);
  assert.deepEqual(imgs(genCalls[1]), imgs(genCalls[0]));
  assert.equal(commits[0].meta.policyFallback, true);
});
await test("A7b without a face or a person's photo the content-policy fallback is unchanged (no question)", async ()=>{
  reset(); cameoInfo = null; cameoRec = null; W.nbGetModel = ()=>SUN;
  let n = 0; genImpl = async ()=>{ if(n++===0) throw new Error("Your request was rejected by the safety system."); return "data:image/png;base64,R"; };
  await W.nbRunSheetGeneration(env({ allModels:[{ id:SUN, label:"GPT Image 2.5 Sunburst" },{ id:NB21, label:"Nano Banana 2.1" }] }), {});
  assert.equal(confirms.length, 0); assert.equal(genCalls.length, 2);
});
await test("A8 a dropped photo is ADDED beside the likeness (style / look), never replacing the face; consent first", async ()=>{
  reset(); W.nbGetSlotImage = ()=>"data:DROPPED";
  await W.nbRunSheetGeneration(env({ slotHasRef:true }), {});
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT","data:BELT","data:DROPPED"]);
  assert.match(g.prompt, /Image 5 = a reference photo for look — use it for that only, never for the face\./);
  assert.equal(commits[0].meta.mode, "cameo"); assert.equal(commits[0].meta.cameo, true);
  assert.equal(commits[0].meta.privateRefs, 4, "3 angles + the dropped photo (cloud)");
  assert.equal(gates.length, 1); assert.equal(gates[0].purpose, "reference-photo");
});
await test("A8b refusing the consent step sends nothing (with or without a likeness)", async ()=>{
  reset(); W.nbGetSlotImage = ()=>"data:DROPPED2"; gateAnswer = false;
  await W.nbRunSheetGeneration(env({ slotHasRef:true }), {});
  assert.equal(genCalls.length, 0); assert.equal(commits.length, 0);
  reset(); cameoInfo = null; cameoRec = null; W.nbGetSlotImage = ()=>"data:DROPPED3"; gateAnswer = false;
  await W.nbRunSheetGeneration(env({ slotHasRef:true }), {});
  assert.equal(genCalls.length, 0);
  // the same photo is asked about once per session
  reset(); cameoInfo = null; cameoRec = null; W.nbGetSlotImage = ()=>"data:DROPPED4";
  await W.nbRunSheetGeneration(env({ slotHasRef:true }), {});
  W.__nbGenInflight = {};
  await W.nbRunSheetGeneration(env({ slotHasRef:true }), {});
  assert.equal(gates.length, 1); assert.equal(genCalls.length, 2);
  assert.equal(genCalls[0].opts.referenceImage, "data:DROPPED4", "no likeness: the photo mode is unchanged");
});
await test("A8c the consent fallback (an older build): a confirm with the same wording; nothing without it", async ()=>{
  reset(); delete W.cameoConsentGate; W.nbGetSlotImage = ()=>"data:DROPPED5"; confirmAnswer = false;
  await W.nbRunSheetGeneration(env({ slotHasRef:true }), {});
  assert.equal(genCalls.length, 0);
  assert.match(confirms[0].body, /Is this you, or someone else\? .* 18 or over/);
});
await test("A9 a likeness that can't be used here (a shared film): no face is sent, the sheet says so, the card asks first", async ()=>{
  reset(); cameoInfo = { locked:true, available:false, why:"This likeness belongs to Ana and is kept on her device.", angleCount:3, capturedAt:CAPTURED };
  await W.nbRunSheetGeneration(env(), {});
  assert.deepEqual(imgs(genCalls[0]), ["data:BELT"]);
  assert.equal(commits[0].meta.cameo, false); assert.equal(commits[0].meta.likenessSkipped, true);
  const t = W.turnLikenessUnavailableText("char-1", "Mara Quinn");
  assert.equal(t, "This likeness belongs to Ana and is kept on her device. Renders made here won't include Mara Quinn's real face — they follow the text spec.");
  assert.equal(W.turnLikenessRefCount("char-1"), 0, "no photos priced");
  confirmAnswer = false;
  assert.equal(await W.turnLikenessUnavailableGate(CHAR, 1), false);
  assert.match(confirms[confirms.length-1].body, /won't include Mara Quinn's real face .* About 5 credits\./);
  cameoInfo = { locked:true, available:true, angleCount:3, capturedAt:CAPTURED };
  confirms = [];
  assert.equal(await W.turnLikenessUnavailableGate(CHAR, 1), true); assert.equal(confirms.length, 0, "nothing to say: no question");
  assert.ok(art.includes("beforeGenerate: ()=> (window.turnLikenessUnavailableGate||(async()=>true))(c, cardGenerateRefs()),"), "the card asks before spending");
});
await test("A9b no likeness at all (the store's {locked:false, available:false}) is NOT 'unavailable': nothing said, nothing sent", async ()=>{
  reset(); cameoInfo = { locked:false, synced:false, angleCount:0, capturedAt:null, consent:null, mine:false, available:false, why:"" };
  assert.equal(W.turnLikenessInfo("char-1"), null);
  assert.equal(W.turnLikenessUnavailableText("char-1", "Mara Quinn"), "");
  assert.equal(W.turnLikenessRefCount("char-1"), 0);
  await W.nbRunSheetGeneration(env(), {});
  assert.deepEqual(imgs(genCalls[0]), ["data:BELT"]);
  assert.ok(!commits[0].meta.likenessSkipped && !commits[0].meta.cameo);
  assert.equal(confirms.length, 0);
});
await test("A10 stale: a sheet made with an older likeness says 'made with an earlier likeness'; variants too", ()=>{
  reset();
  assert.equal(W.turnLikenessStale({ cameo:true, cameoAt:"2026-10-01T00:00:00.000Z" }, "char-1"), true);
  assert.equal(W.turnLikenessStale({ cameo:true, cameoAt:CAPTURED }, "char-1"), false);
  assert.equal(W.turnLikenessStale({ cameo:true, iso:"2026-10-01T00:00:00.000Z" }, "char-1"), true, "older sheets without cameoAt: their own date");
  assert.equal(W.turnLikenessStale({ cameo:false, cameoAt:"2026-10-01" }, "char-1"), false);
  assert.ok(art.includes('(gen.likenessStale ? "made with an earlier likeness \\u2014 regenerate to update" : "applied to the sheet")'));
  assert.ok(art.includes('"regenerate to apply it to the sheet"'));
  assert.ok(art.includes('gen.genUrl && gen.likenessStale && React.createElement("div",{className:"state-hint stale"}'), "the variant row too");
});
await test("A11 the plan helper: one angle, a master, worn items, a photo and other inputs are numbered in that order", ()=>{
  const p = W.turnLikenessPlan({ likeness:{ usable:true, angles:[{ label:"Front", url:"F" }] }, master:{ url:"M" },
    worn:[{ url:"W1", note:"Hat (worn)" },{ url:"W2", note:"Scarf" }], photo:{ url:"P", label:"" }, character:{ renderStyleKey:"photoreal" } });
  assert.deepEqual(J(p.images), ["F","M","W1","W2","P"]);
  assert.equal(p.primary, "F");
  assert.match(p.map, /Image 1 = the person's face, front\. Image 2 = this character's master sheet\. Images 3–4 = worn items: Hat, Scarf/);
  assert.match(p.map, /Image 5 = a reference photo for look/);
  assert.match(p.rule, /the real person in image 1\./);
  const none = W.turnLikenessPlan({ likeness:null, worn:[{ url:"W" }] });
  assert.equal(none.rule, ""); assert.equal(none.faceCount, 0);
});

/* ═══ B — the Casting Director and the prop owner's pre-generation (app.jsx) ═══ */
const CAST_BLOCK = between(app, "    const _grabImg = async (id)=>{", "    // ---- Props Master surface");
const OWNER_BLOCK = between(app, "  const _imgOf = async (id)=>{", "  // Guarantee a prop is");
function castingWindow(store, props){
  const trace = [];
  const env2 = { emit:(m)=>trace.push(m), cancelled:()=>false, characters:[CHAR], scenes:[], drafts:{}, project:{}, props:props||[],
    lbProject:()=>({}), _w:{ updateCharacter:noop },
    characterMediaOptions:(c)=>({ identityCharacter:c, identityCharacterIds:[c.id], identityCast:[c], identityEpoch:1 }),
    combinedImagePrompt:(c, project, ps)=> W.charSheetPrompt(c, project, ps, null) };
  W.nbGetImage = (id)=> store[id] || ""; W.nbLoadImage = async (id)=> store[id] || "";
  W.nbLoadDetailsAsset = async ()=>({ meta:{ version:1 } });
  W.NB_MODELS = MODELS;
  W.loadWornReferenceSnapshot = async ()=>[]; W.wornPropsSig = ()=>"sig";
  W.nbWritingSourcesFor = ()=>[];
  Object.assign(W, env2);
  const fn = vm.runInContext("(function(){\n"+CAST_BLOCK+"\nreturn cast; })", W);
  return { cast:fn(), trace };
}
const WORN = [{ id:"prop-belt", name:"Leather belt", ownerId:"char-1", kind:"worn" }];
await test("B1 the Casting Director's master (also Scene needs): the ONE RULE, face fields left out, meta.cameo / cameoAt / mode / privateRefs", async ()=>{
  reset();
  const { cast } = castingWindow({ "prop-belt":"data:BELT" }, WORN);
  await cast.generateMaster(CHAR);
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT","data:BELT"]);
  assert.match(g.prompt, /Image 1 = the person's face, front\. Images 2–3 = the same face with the head turned to the person's own left and to their own right \(three-quarter views\)\. Image 4 = worn item: Leather belt/);
  assert.ok(!FACE_TEXT.test(g.prompt), "no written face: "+(g.prompt.match(FACE_TEXT)||[])[0]);
  assert.ok(!/additional prop reference image/i.test(g.prompt));
  assert.equal(g.opts.referencesNumbered, true);
  const m = commits[0].meta;
  assert.equal(m.cameo, true); assert.equal(m.cameoAt, CAPTURED); assert.equal(m.mode, "cameo"); assert.equal(m.privateRefs, 3);
  assert.equal(m.agent, "Casting Director");
  assert.deepEqual(commits[0].refs.map(r=>r.kind), ["prop"], "no angle stored");
});
await test("B2 Wear props (generateMaster deriveFromCurrent): angles, then the CURRENT master, then the worn items", async ()=>{
  reset();
  const { cast } = castingWindow({ "prop-belt":"data:BELT", "char-1":"data:CURRENT" }, WORN);
  await cast.generateMaster(CHAR, { deriveFromCurrent:true });
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT","data:CURRENT","data:BELT"]);
  assert.match(g.prompt, /^Update this existing master character sheet for Mara Quinn \(image 4\)\./);
  assert.match(g.prompt, /Image 4 = this character's current master sheet — the sheet to update/);
  assert.equal(commits[0].meta.mode, "base");
  assert.deepEqual(commits[0].refs.map(r=>r.kind), ["base","prop"]);
});
await test("B3 the Casting Director's variant: from the master (image 4) — and before one, a sheet from the face", async ()=>{
  reset();
  const { cast } = castingWindow({}, []);
  await cast.generateState(CHAR, ST, "data:MASTER");
  assert.deepEqual(imgs(genCalls[0]), ["data:FRONT","data:LEFT","data:RIGHT","data:MASTER"]);
  assert.match(genCalls[0].prompt, /Image 4 is the master sheet/);
  assert.equal(commits[0].meta.cameo, true); assert.equal(commits[0].meta.mode, "base");
  await cast.generateState(CHAR, ST, "");
  assert.deepEqual(imgs(genCalls[1]), ["data:FRONT","data:LEFT","data:RIGHT"]);
  assert.match(genCalls[1].prompt, /There is no master sheet yet/);
  assert.ok(!FACE_TEXT.test(genCalls[1].prompt));
});
await test("B4 a likeness that can't be used here: the trace says why, the sheet records it, no face is sent", async ()=>{
  reset(); cameoInfo = { locked:true, available:false, why:"It's private to its owner.", angleCount:3 };
  const { cast, trace } = castingWindow({ "prop-belt":"data:BELT" }, WORN);
  await cast.generateMaster(CHAR);
  assert.deepEqual(imgs(genCalls[0]), ["data:BELT"]);
  assert.equal(commits[0].meta.likenessSkipped, true); assert.ok(!commits[0].meta.cameo);
  assert.ok(trace.some(t=>t.k==="observe" && /It's private to its owner\. Renders made here won't include Mara Quinn's real face/.test(t.t)));
});
await test("B5 the prop owner's pre-generation (generateCharMaster) follows the same rule", async ()=>{
  reset();
  W.nbGetImage = (id)=> id==="prop-belt" ? "data:BELT" : ""; W.nbLoadImage = async (id)=> id==="prop-belt" ? "data:BELT" : "";
  W.NB_MODELS = MODELS;
  Object.assign(W, { props:WORN, project:{}, characterMediaOptions:(c)=>({ identityCharacter:c, identityEpoch:1 }),
    combinedImagePrompt:(c, project, ps)=> W.charSheetPrompt(c, project, ps, null) });
  const gen = vm.runInContext("(function(){\n"+OWNER_BLOCK+"\nreturn generateCharMaster; })", W)();
  await gen(CHAR);
  const g = genCalls[0];
  assert.deepEqual(imgs(g), ["data:FRONT","data:LEFT","data:RIGHT","data:BELT"]);
  assert.match(g.prompt, /Image 4 = worn item: Leather belt/);
  assert.ok(!FACE_TEXT.test(g.prompt));
  const m = commits[0].meta;
  assert.equal(m.cameo, true); assert.equal(m.cameoAt, CAPTURED); assert.equal(m.mode, "cameo"); assert.equal(m.agent, "Prop owner pre-gen");
});
await test("B6 Scene needs counts the photos that really go (none for a likeness that can't be used) and says why", ()=>{
  const fn = between(app, "    const cameoCount = async (cid)=>{", "    const fail = (why)=>");
  assert.ok(fn.includes("window.turnLoadLikeness(cid)") && fn.includes("return (lk && lk.usable) ? lk.angles.length : 0;"));
  assert.ok(fn.includes("window.turnLikenessUnavailableText(cid, ch && ch.name)"));
  assert.ok(app.includes('lkUnavailable.join(" ")]'), "the question's note carries it");
  assert.ok(agents.includes("generates the master sheet (with prop + likeness references) and every state variant"));
});

/* ═══ C — prices count the references ═══ */
await test("C1 the card: Generate / Apply / wardrobe update count the likeness photos + worn sheets; the post-capture confirm shows the price", ()=>{
  assert.ok(art.includes("const cardGenerateRefs = ()=> (window.turnLikenessRefCount||(()=>0))(c.id) + wornSheetCount;"));
  assert.ok(art.includes('!gen.gening && typeof window.nbCostChip==="function" && window.nbCostChip(1, { refs:cardGenerateRefs() })),'), "Apply to sheet");
  assert.ok(art.includes("generateRefs: gen.likenessRefs ? cardGenerateRefs() : undefined, attachRefs: wornSheetCount,"), "Generate");
  assert.ok(art.includes("window.nbCostChip(1, generateRefs!=null ? { refs:Number(generateRefs)||0 } : undefined)"));
  assert.ok(art.includes('window.nbImageCostText(1, { refs:nAngles+wornSheetCount })') && art.includes('confirmLabel:"Generate sheet"+(price ?'), "post-capture confirm");
  assert.ok(art.includes("generateRefs: gen.likenessRefs ? (gen.likenessRefs + (baseGenUrl?1:0)) : undefined"), "a variant");
});
await test("C2 an edit / remaster of a likeness sheet counts the sheet, the face, worn sheets and attached inputs", ()=>{
  assert.ok(art.includes("{ refs: 1 + gen.likenessEditRefs + (Number(attachRefs)||0) + (Number(extra)||0) } : undefined;"));
  assert.ok(art.includes('"Apply edit",\n          typeof window.nbCostChip==="function" && window.nbCostChip(1, editCostOpts(editRefs.length))),'));
  assert.ok(art.includes('"Remaster \\u2014 clean re-render",\n            typeof window.nbCostChip==="function" && window.nbCostChip(1, editCostOpts(0))),'));
});
await test("C3 a batch / Design the cast sum each image's own price (photos + worn sheets)", ()=>{
  reset();
  const el = W.LikenessBatchCost({ refs:[3, 0, 4] });
  assert.equal(el.children[0], String((4+3)+(4+0)+(4+4)));
  assert.ok(art.includes("batchChip(missingAll)") && art.includes("batchChip(sceneMissing)"));
  assert.ok(art.includes("prompt.refsOf ? React.createElement(window.LikenessBatchCost,{ refs:prompt.missing.map(prompt.refsOf) })"));
  assert.ok(art.includes("? React.createElement(window.LikenessBatchCost,{ refs:lkRefs })"), "Design the cast");
  assert.ok(app.includes("characters, props, scenes, drafts, sceneId:castConfirm.sceneId,"), "Design the cast gets the props to count worn sheets");   // (+ the screenplay, 2026-10-12)
});
await test("C4 a numbered reference list can't silently lose an image; a failed fetch is no image", ()=>{
  const blob = between(imagegen, "async function oaiToBlob(src){", "async function oaiToDataUrl(src){");
  assert.ok(blob.includes("if(!r || !r.ok) return null;"));
  const pg = between(imagegen, "async function proxyGenerate(prompt, opts, provider){", "window.proxyGenerate = proxyGenerate;");
  assert.ok(pg.includes("else if(opts.referencesNumbered)") && pg.includes("nothing was sent and nothing was charged"));
});

/* ═══ D — the Stage ═══ */
const STAGE_FNS = between(stage, 'const STAGE_FICTIONAL_POLICY_CONTEXT=', "function stageTextOnlyAssetLabel(asset){");
await test("D1 a clip whose cast has a likeness: detected (locked, or a sheet made with one); the fictional note is stripped", ()=>{
  const sb = { window:null, String, Array, Boolean, nbGetMeta:(id)=> id==="sheet-b" ? { cameo:true } : null };
  sb.window = sb; sb.turnLikenessInfo = (id)=> id==="ana" ? { locked:true } : null;
  vm.createContext(sb);
  vm.runInContext(STAGE_FNS+"\nwindow.has=stageCastHasLikeness; window.strip=stageStripFictionalContext; window.note=STAGE_LIKENESS_NOTE; window.ctx=STAGE_FICTIONAL_POLICY_CONTEXT;", sb);
  assert.equal(sb.has([{ id:"ana" }]), true);
  assert.equal(sb.has([{ id:"bo" }]), false);
  assert.equal(sb.has([{ id:"bo" }], [{ entityId:"bo", assetId:"sheet-b" }]), true);
  assert.equal(sb.strip(sb.ctx+"\n\nShe runs."), "She runs.");
  assert.equal(sb.strip("FICTIONAL CONTEXT: edited by hand\nShe runs."), "She runs.");
  assert.equal(sb.note, "This clip shows a real person's likeness. Video engines may refuse it.");
});
await test("D2 the recovery isn't offered (and never sent) for a likeness clip; the note shows before rendering", ()=>{
  assert.ok(stage.includes("const clipHasLikeness = stageCastHasLikeness(identityCast, referencePackage.characters);"));
  assert.ok(stage.includes("stageAssembleRenderPrompt(clipHasLikeness ? stageStripFictionalContext(prompt) : prompt,{"));
  assert.ok(stage.includes("if(clipHasLikeness) return;   // never for a real person's likeness"));
  const btn = stage.indexOf('fictionalPolicyContextPresent?"Context added":"Add fictional context"');
  const gate = stage.lastIndexOf("genErr && textOnlyPolicyFailure && !clipHasLikeness && _stEl(", btn);
  assert.ok(gate>0 && btn-gate < 1500, "the button sits only in the no-likeness branch");
  assert.ok(stage.includes("readinessNotice, takeStaleNotice, takeOldLookNotice, likenessNotice,"));
});
await test("D3 Motion Control: a face / body upload goes through the consent step before it leaves the device", ()=>{
  const fn = between(stage, "  const onDeviceFile = async (e)=>{", "  // the disclosure a take keeps about a media input");
  const g = fn.indexOf('window.cameoConsentGate({ purpose })'), up = fn.indexOf("window.vidStageDeviceMedia(file, pick.kind, {})");
  assert.ok(g>0 && up>g, "asked before the upload");
  assert.ok(fn.includes('pick.slot==="motion-image" || pick.slot==="motion-video"'));
  assert.ok(fn.includes('if(!ok){ setModeErr("Nothing was uploaded \\u2014 the file needs your OK first."); return; }'));
});

/* ═══ E — naming ═══ */
await test("E1 the user reads 'Likeness': chip, header, manager, Details, the Casting Director", ()=>{
  assert.ok(art.includes('React.createElement(Icon.userScan,{s:10,sw:1.8}),"Likeness"),'), "the chip");
  assert.ok(art.includes('"Likenesses \\u00b7 "+cameoCount') && art.includes('window.addEventListener("turn-cameo-changed", h);'), "the header, refreshed on the store's event");
  assert.ok(art.includes('title:"Likeness manager \\u2014 review and manage the locked likenesses"'));
  assert.ok(art.includes('hm.mode==="cameo" ? "From the likeness"'));
  assert.ok(art.includes('field("Likeness", meta.cameo'));
  assert.equal(W.likenessDisplayLabel("Cameo likeness"), "Likeness", "saved labels mapped where displayed");
  assert.equal(W.likenessDisplayLabel("From cameo likeness"), "From the likeness");
  const code = art.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");   // comments out
  const userStrings = (code.match(/"(?:[^"\\\n]|\\.)*"/g)||[]).filter(x=>/[a-z] [a-z]/i.test(x) && /(^|[^-\w])cameo([^-\w]|$)/i.test(x));
  assert.deepEqual(userStrings, [], "no user-facing 'cameo' left in artroom.jsx");
  assert.ok(!/cameo/i.test(between(agents, 'blurb:"Designs your whole cast', '",')));
});

console.log("\n"+passes+" checks passed"+(failures ? ", "+failures+" FAILED" : ""));
process.exit(failures ? 1 : 0);

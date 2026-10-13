#!/usr/bin/env node
/* ============================================================================
   CHARACTER FIDELITY, steps 3 · 5 · 7 (owner-approved 2026-10-12, "go ahead with all of it, in that order").
     A  step 3 — the look follows the arc: the look drafter gets the arc, the arc by act, the unspoken need and the
        contradictions (charInnerLifeLine), compactly
     B  step 3 — appearance states: every scene the character is in (not only driven ones), the fact sheet's injuries and
        wardrobe by scene with their quotes, the arc by act; a state can be pinned to any of those scenes and keeps a
        quote only when it is the fact sheet's; the app's three callers pass the screenplay; the card shows the quote
     C  step 3 — the Production check: the breakdown's per-scene states (with their screenplay words) become PROPOSED
        appearance states, one approval card per character; nothing lands on a rejection; an unfound quote is only noted
     D  step 5 — the likeness fit check: when it shows, what it lists (script quotes, else the card), Fits / Update the
        character to match this person / Choose someone else, the patches (the script's facts are never rewritten), a
        recaptured likeness asks again, nothing is sent anywhere; the writers and voice design get the user's choice
     E  step 7 — ages decided in the story build: the cast step asks for an age range and keeps only an age; the build
        saves it as set by the story; the scene writer reads it when the physique has none; the free safety net from the
        screenplay's introductions; the Cast panel field; the pipeline doc
     F  Frances, and no internal or vendor names in what users see
   Run AFTER `npm run build`:   node scripts/test-character-arc-likeness-age.mjs
   ============================================================================ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
let passes = 0, failures = 0;
const test = async (name, fn)=>{ try{ await fn(); passes++; console.log("PASS", name); }
  catch(e){ failures++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };

const art = read("app/artroom.jsx"), app = read("app/app.jsx"), agentsSrc = read("app/agents.jsx"), ai = read("app/ai.jsx"),
  css = read("app/styles.css"), doc = read("docs/Story Pipeline.md"), charPanel = read("app/character.jsx"), voices = read("app/voices-ui.jsx");

/* ---------------- the Art Room sandbox: dist/app/artroom.js ---------------- */
const noop = ()=>{};
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const stateOverrides = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
  React: { createElement:el, useState:(v)=>[stateOverrides.length ? stateOverrides.shift() : (typeof v==="function"?v():v), noop],
    useEffect:noop, useLayoutEffect:noop, useRef:(v)=>({ current:v }), useMemo:(f)=>f(), useCallback:(f)=>f, Fragment:"Fragment" },
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
  CustomEvent: class { constructor(type, opts){ this.type = type; this.detail = opts && opts.detail; } },
  Image: class {},
  document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null,
    addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, activeElement:null },
  requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
  matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
  Icon: new Proxy({}, { get:()=>()=>null }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("dist/app/artroom.js"), sandbox, { filename:"dist/app/artroom.js" });
const W = sandbox;
for(const fn of ["charLikenessKey","charLikenessFitState","charLikenessFitPatch","CharLikenessFitCheck","charFactsReadPatch","charScriptSig","charFactsLive","charFactLocate"])
  if(typeof W[fn]!=="function"){ console.log("FAIL "+fn+" missing from dist/app/artroom.js — run npm run build"); process.exit(1); }

/* ---------------- the screenplay ---------------- */
const scenes = [{ id:"s1", no:1, act:1, title:"Garage", driver:"kai", summary:"Kai fixes the van." },
  { id:"s2", no:2, act:1, title:"Street", driver:"mara", summary:"Mara chases a lead; Kai limps past." },
  { id:"s3", no:3, act:2, title:"Office", driver:"mara", summary:"A clerk files papers." },
  { id:"s4", no:4, act:3, title:"Roof", driver:"mara", summary:"The last stand." }];
const drafts = {
  s1:{ blocks:[ { type:"scene", text:"INT. GARAGE - NIGHT" }, { type:"action", text:"KAI REYES (60s, Filipino, wiry) wipes grease from his hands." } ] },
  s2:{ blocks:[ { type:"scene", text:"EXT. STREET - DAY" }, { type:"action", text:"Kai limps past in a grey boiler suit. A fresh cut over his right eye." } ] },
  s3:{ blocks:[ { type:"action", text:"A clerk files papers." } ] },
  s4:{ blocks:[ { type:"action", text:"Kai stands on the roof, his boiler suit torn at the shoulder, blood on his collar." } ] },
};
const FACTS = [
  { field:"age", value:"60s", quote:"KAI REYES (60s, Filipino, wiry)", sceneId:"s1", sceneNo:1, block:2 },
  { field:"heritage", value:"Filipino", quote:"Filipino", sceneId:"s1", sceneNo:1, block:2 },
  { field:"build", value:"wiry", quote:"Filipino, wiry", sceneId:"s1", sceneNo:1, block:2 },
  { field:"injury", value:"a fresh cut over his right eye", quote:"A fresh cut over his right eye.", sceneId:"s2", sceneNo:2, block:2 },
  { field:"wardrobe", value:"grey boiler suit", quote:"in a grey boiler suit", sceneId:"s2", sceneNo:2, block:2 },
  { field:"injury", value:"blood on his collar", quote:"blood on his collar", sceneId:"s4", sceneNo:4, block:1 },
];
const KAI = { id:"kai", name:"Kai Reyes", role:"Protagonist — a mechanic", pronouns:"he/him",
  arc:"from hiding to standing", arcStages:{ "1":"hides behind the work", "2":"cracks when Mara needs him", "3":"stands on the roof for her" },
  unconscious:"to be forgiven by his daughter", dimensions:"gentle with engines / brutal with people\ngenerous / never lets anyone help",
  scriptFacts:{ facts:FACTS, scriptSig:"cs-x", at:"2026-10-12T00:00:00.000Z", fed:[] },
  physique:{ age:"late 60s", ethnicity:"Filipino", build:"wiry, ropey forearms" }, coreBody:"Apparent age: late 60s. Ethnicity: Filipino. Body type: wiry, ropey forearms." };

/* ═══ A — the look follows the arc ═══ */
const aiBox = { console, JSON, Object, Array, String, Number, Math, Set, Map, Promise, RegExp, Error };
aiBox.window = aiBox; vm.createContext(aiBox);
aiBox.frameworkOf = ()=>({ acts:{ 1:"Setup", 2:"Complication", 3:"Resolution" } });
vm.runInContext(between(ai, "function charInnerLifeLine(c, project){", "window.charInnerLifeLine = charInnerLifeLine;")+"; window.charInnerLifeLine = charInnerLifeLine;", aiBox);
await test("A1 the inner-life line: arc, the arc by act (with the framework's act names), the unspoken need, the contradictions", ()=>{
  const line = aiBox.charInnerLifeLine(KAI, {});
  assert.equal(line, "    INNER LIFE (let it show in the body): arc: from hiding to standing | by act: act 1 (Setup) hides behind the work; act 2 (Complication) cracks when Mara needs him; act 3 (Resolution) stands on the roof for her | needs (unspoken): to be forgiven by his daughter | contradictions: gentle with engines / brutal with people; generous / never lets anyone help\n");
  assert.equal(aiBox.charInnerLifeLine({ id:"x", name:"X" }), "", "nothing stored → nothing sent");
  // dimensions as a list, at most four; long lines are cut compactly
  const many = aiBox.charInnerLifeLine({ dimensions:["a / b","c / d","e / f","g / h","i / j"], unconscious:"x".repeat(400) });
  assert.match(many, /contradictions: a \/ b; c \/ d; e \/ f; g \/ h\n$/);
  assert.ok(!/i \/ j/.test(many));
  assert.ok(/needs \(unspoken\): x{100,149}…/.test(many) && many.length<400, "compact");
});
await test("A2 the look drafter sends it for every character, and its brief says how to read it", async ()=>{
  const drafterBox = { console, JSON, Object, Array, String, Number, Math, Set, Map, Promise, RegExp, Error };
  drafterBox.window = drafterBox; vm.createContext(drafterBox);
  Object.assign(drafterBox, { aiAvailable:()=>true, writingProjectOf:(p)=>p||{}, genreTag:()=>"", writingLoglineOf:()=>"", assertPromptIdentity:noop,
    canonicalIdentity:(c)=>({ pronouns:c.pronouns||"" }), castPronounBlock:()=>"", _lookbookBlock:()=>"", _lookbookStamp:()=>undefined,
    extractJSON:(t)=>JSON.parse(t), salvageBibleEntries:()=>[], writingStamp:()=>({}), mapBibleEntry:()=>({ physique:{} }),
    scriptEvidenceFor:()=>"", charInnerLifeLine:aiBox.charInnerLifeLine });
  vm.runInContext(between(ai, "function bibleBatchPrompt(ctx, chars){", "\n/* batched VISUAL BIBLE")
    + between(ai, "async function aiCastVisualBible(", "window.aiCastVisualBible = aiCastVisualBible;")+"; window.aiCastVisualBible = aiCastVisualBible;", drafterBox);
  let prompt = "";
  drafterBox.claude = { complete:async ({ messages })=>{ prompt = messages[0].content; return JSON.stringify({ cast:[{ id:"kai" }] }); } };
  await drafterBox.aiCastVisualBible([KAI], scenes, {}, { scenes, drafts });
  assert.ok(prompt.includes("- id:kai | Kai Reyes (Protagonist — a mechanic) [he/him] — drives: Garage\n    INNER LIFE (let it show in the body): arc: from hiding to standing | by act: act 1 (Setup) hides behind the work"), prompt.slice(0, 600));
  assert.match(prompt, /Where a character has an INNER LIFE line, read it as the body's story: the need they hide, the contradictions they carry and where their arc stands in each act show in posture, grooming, wear and how they hold themselves/);
  assert.match(prompt, /never write the inner life as text, a slogan or a symbol on the sheet/);
  assert.match(prompt, /their role, want, class, history and arc should be legible in the body/, "the original rule stays");
});

/* ═══ B — appearance states over every scene ═══ */
const stBox = { console, JSON, Object, Array, String, Number, Math, Set, Map, Promise, RegExp, Error, Date };
stBox.window = stBox; vm.createContext(stBox);
vm.runInContext(read("app/scene-order.js"), stBox, { filename:"scene-order.js" });
vm.runInContext(between(ai, "const NAME_STOPWORDS =", "window.sceneScriptText = sceneScriptText;")+"; window.scenesWhereCharacterAppears = scenesWhereCharacterAppears;", stBox);
Object.assign(stBox, { turnTextOf:()=>"", turnCast:[KAI, { id:"mara", name:"Mara Lin" }], aiAvailable:()=>true, writingProjectOf:(p)=>p||{ title:"ROOF" }, genreTag:()=>"",
  writingLoglineOf:()=>"A mechanic stands up.", identityContext:(x)=>x, assertPromptIdentity:noop, castPronounBlock:()=>"CAST\n",
  clipSpecText:(v,n)=>String(v==null?"":v).slice(0,n||999).trim(), writingStamp:()=>({ model:"m" }), extractJSON:(t)=>JSON.parse(t),
  charFactsLive:(c, d)=> W.charFactsLive(c, d) });
vm.runInContext(between(ai, "function charStateScenes(character, drivenScenes, canon){", "window.aiSuggestStates = aiSuggestStates;")+"; window.aiSuggestStates = aiSuggestStates;", stBox);
await test("B1 the scenes a state can come from: driven, appears (named in the script), and the fact sheet's own scenes — in story order", ()=>{
  const driven = scenes.filter(s=>s.driver==="kai");
  assert.deepEqual(J(stBox.charStateScenes(KAI, driven, { scenes, drafts }).map(s=>s.id)), ["s1","s2","s4"]);
  assert.deepEqual(J(stBox.charStateScenes(KAI, driven, null).map(s=>s.id)), ["s1"], "without the screenplay: the driven scenes, as before");
  // a fact's scene counts even when the name search misses it (a pronoun-only line)
  const quiet = { ...KAI, name:"Kai Reyes", scriptFacts:{ facts:[{ field:"injury", value:"a limp", quote:"limps", sceneId:"s3", sceneNo:3 }] } };
  assert.ok(stBox.charStateScenes(quiet, [], { scenes, drafts:{ s3:drafts.s3 } }).some(s=>s.id==="s3"));
});
await test("B2 the suggester reads every scene they're in, the script's changes by scene with quotes and the arc by act; pins to any scene", async ()=>{
  let prompt = "";
  stBox.claude = { complete:async ({ messages })=>{ prompt = messages[0].content; return JSON.stringify({ states:[
    { label:"Cut brow", change:"a fresh cut over the right eye", sceneNo:2, quote:"A fresh cut over his right eye." },   // a fact quote
    { label:"Bloodied", change:"blood on his collar, suit torn", sceneNo:4, quote:"blood on his COLLAR" },               // a fact quote, case aside
    { label:"Invented", change:"a black eye", sceneNo:4, quote:"his eye is black and swollen" },                         // not in the script
    { label:"Nowhere", change:"soaked", sceneNo:9, quote:"" } ] }); } };
  const out = await stBox.aiSuggestStates(KAI, scenes.filter(s=>s.driver==="kai"), null, { scenes, drafts });
  assert.match(prompt, /Scenes this character is in, in order \(drives = the scene is theirs; appears = they are in it\):/);
  assert.match(prompt, /  Sc 1 \(act 1\) “Garage” \[drives\]: Kai fixes the van\./);
  assert.match(prompt, /  Sc 2 \(act 1\) “Street” \[appears\]: Mara chases a lead; Kai limps past\./);
  assert.match(prompt, /      SCREENPLAY — injury \/ change: a fresh cut over his right eye — "A fresh cut over his right eye\."/);
  assert.match(prompt, /      SCREENPLAY — wardrobe: grey boiler suit — "in a grey boiler suit"/);
  assert.match(prompt, /  Sc 4 \(act 3\) “Roof” \[appears\]/);
  assert.ok(!/Sc 3 /.test(prompt), "a scene they aren't in isn't listed");
  assert.match(prompt, /ARC BY ACT: act 1 — hides behind the work; act 2 — cracks when Mara needs him; act 3 — stands on the roof for her/);
  assert.match(prompt, /ANY scene listed, whether they drive it or only appear in it/);
  assert.match(prompt, /quote = when a SCREENPLAY line above shows this change, copy that line's quote EXACTLY/);
  const [cut, blood, inv, nowhere] = J(out);
  assert.deepEqual([cut.sceneId, cut.quote, cut.quoteSceneId], ["s2", "A fresh cut over his right eye.", "s2"], "pinned to a scene Kai only appears in, with its quote");
  assert.deepEqual([blood.sceneId, blood.quote], ["s4", "blood on his collar"]);
  assert.deepEqual([inv.sceneId, inv.quote], ["s4", undefined], "an invented quote is dropped (the state stays, unquoted)");
  assert.equal(nowhere.sceneId, "", "a scene that isn't listed isn't pinned");
  assert.ok(out.every(s=>s.suggested===true));
});
await test("B3 no screenplay passed: the driven scenes only; in no scene at all: inferred from the arc", async ()=>{
  let prompt = "";
  stBox.claude = { complete:async ({ messages })=>{ prompt = messages[0].content; return JSON.stringify({ states:[{ label:"x", change:"y", sceneNo:2 }] }); } };
  const out = await stBox.aiSuggestStates({ ...KAI, scriptFacts:undefined }, scenes.filter(s=>s.driver==="kai"), null);
  assert.ok(/Sc 1 \(act 1\) “Garage” \[drives\]/.test(prompt) && !/Sc 2 /.test(prompt));
  assert.equal(out[0].sceneId, "", "Sc 2 isn't one of its scenes without the screenplay");
  await stBox.aiSuggestStates({ id:"z", name:"Zed Nobody" }, [], null, { scenes, drafts });
  assert.match(prompt, /This character is in no scene yet — infer likely appearance changes from the premise and arc\./);
});
await test("B4 the app's three callers pass the screenplay; Draft all skips only a character in no scene; the card shows the quote", ()=>{
  assert.ok(app.includes("try{ return { id:c.id, states: await aiSuggestStates(c, driven, project, { scenes, drafts }) }; }"));
  assert.ok(app.includes("const appears = (typeof scenesWhereCharacterAppears===\"function\") ? scenesWhereCharacterAppears(c.id, c.name, scenes, drafts) : driven.map(s=>s.id);"));
  assert.ok(app.includes("if(!driven.length && !appears.length) return { id:c.id, states:null };"));
  assert.ok(app.includes("const suggested = await aiSuggestStates(ch, driven, project, { scenes, drafts:draftsRef.current||drafts });"));
  assert.ok(app.includes("const raw = await aiSuggestStates(c, scenes.filter(s=>s.driver===c.id), project, { scenes, drafts });"), "the Casting Director's");
  assert.ok(art.includes('st.quote && React.createElement("div",{className:"phys-note state-quote","data-testid":"state-quote"},'));
  assert.ok(art.includes('"From the script — "+(()=>{ const sc = (scenes||[]).find(x=>x && x.id===(st.quoteSceneId||st.sceneId)); return sc ? "Sc "+sc.no+": " : ""; })()'));
  assert.ok(/\.state-quote\{/.test(css));
});

/* ═══ C — the Production check proposes appearance states ═══ */
const pcBox = ()=>{
  const box = { console, setTimeout, clearTimeout }; box.window = box; vm.createContext(box);
  for(const f of ["app/frameworks.jsx","app/scene-order.js","app/agents.jsx","app/beat-keyframe-merge.js"]) vm.runInContext(read(f), box, { filename:f });
  box.turnProject = { framework:"threeact" };
  box.charPronouns = c=>String(c.pronouns||""); box.scaleClassOf = ()=>"A";
  box.turnIdentityReport = ()=>({ status:"ok", issues:[] });
  box.screenplayPronounEvidence = ()=>({ pronouns:"", quote:"" });
  box.realignBlockBeats = (bs)=>bs; box.findImpliedSpaces = ()=>[]; box.beatContinuityLint = ()=>[];
  return box;
};
const pcRun = async (box, character, statesByScene, approve)=>{
  box.aiScriptBreakdown = async (s)=>({ characters:[{ name:"Kai Reyes", gender_used:"unclear", scale_used:"unclear", emotion:"",
    features:[], states:statesByScene[s.id]||[], voice_cues:[] }] });
  const model = { characters:[{ ...character }], scenes:scenes.map(s=>({ ...s })),
    drafts:JSON.parse(JSON.stringify(drafts)), beats:{} };
  const cards = [], trace = [];
  const ctx = { model, bible:{ props:[], locations:[], shots:[], patchProp:()=>{}, patchLocation:()=>{} }, emit:(e)=>trace.push(e), cancelled:()=>false,
    sync:()=>{}, ai:{ available:true }, propose:async (c)=>{ cards.push(c); return approve ? approve(c) : true; } };
  await box.agentProductionCheck(ctx);
  return { model, cards, trace, stateCards:cards.filter(c=>/^Appearance states — /.test(c.title)) };
};
const STATES = {
  s2:[{ label:"Cut brow", change:"a fresh cut over his right eye", quote:"A fresh cut over his right eye." },
      { label:"", change:"limping badly", quote:"he drags his leg" }],                                    // not in the scene
  s4:[{ label:"Torn and bloodied", change:"boiler suit torn at the shoulder, blood on his collar", quote:"his boiler suit torn at the shoulder, blood on his collar" },
      { label:"Cut brow", change:"a fresh cut over his right eye", quote:"Kai stands on the roof" }],      // a repeat of Sc 2's
};
await test("C1 one card per character: each change with its scene and the screenplay's words; approved → appearance states with quotes", async ()=>{
  const box = pcBox();
  const base = { id:"kai", name:"Kai Reyes", pronouns:"he/him", states:[] };
  const r = await pcRun(box, base, STATES);
  assert.equal(r.stateCards.length, 1);
  const card = r.stateCards[0];
  assert.equal(card.writes, "art");
  assert.equal(card.title, "Appearance states — Kai Reyes");
  assert.equal(card.reason, "The screenplay shows Kai Reyes's look change in 2 places — Sc 2, Sc 4.");
  assert.match(card.rationale, /pinned to the scene where it first shows, with the screenplay's words\. Each can then be made as its own variant sheet from the card \(image credits\) — nothing is generated now\./);
  assert.equal(card.before, "(no appearance states yet)");
  assert.equal(card.after, "Sc 2 · Cut brow — a fresh cut over his right eye — “A fresh cut over his right eye.”\n"
    +"Sc 4 · Torn and bloodied — boiler suit torn at the shoulder, blood on his collar — “his boiler suit torn at the shoulder, blood on his collar”");
  const st = J(r.model.characters[0].states);
  assert.deepEqual(st.map(x=>[x.label, x.sceneId, x.quote, x.quoteSceneId, x.suggested, x.source]), [
    ["Cut brow","s2","A fresh cut over his right eye.","s2",true,"production"],
    ["Torn and bloodied","s4","his boiler suit torn at the shoulder, blood on his collar","s4",true,"production"]]);
  assert.ok(st.every(x=>/^st-[0-9a-z]+-p\d$/.test(x.id)));
  assert.ok(r.trace.some(e=>e.k==="observe" && e.t==="Sc 2 · Kai Reyes — “limping badly” isn't proposed as an appearance state: the screenplay words that show it couldn't be found in the scene."));
  assert.ok(r.trace.some(e=>e.k==="ok" && e.t==="2 appearance states added to Kai Reyes."));
  const done = r.trace.filter(e=>e.k==="done");
  assert.equal(done.length, 1); assert.match(done[0].t, /\(2 to the cast sheets\)/, done[0].t);
});
await test("C2 rejected → nothing lands; already on the card → not proposed again", async ()=>{
  const box = pcBox();
  const r = await pcRun(box, { id:"kai", name:"Kai Reyes", pronouns:"he/him" }, STATES, (c)=>!/^Appearance states/.test(c.title));
  assert.equal(r.stateCards.length, 1); assert.equal(r.model.characters[0].states, undefined, "a rejection writes nothing");
  const have = { id:"kai", name:"Kai Reyes", pronouns:"he/him", states:[{ id:"st-a", label:"Cut brow", change:"A fresh cut over his right eye", sceneId:"s2" }] };
  const r2 = await pcRun(pcBox(), have, STATES);
  assert.deepEqual(J(r2.model.characters[0].states.map(x=>x.label)), ["Cut brow","Torn and bloodied"], "only the new one is added");
  assert.equal(r2.stateCards[0].before, "Cut brow — A fresh cut over his right eye");
  const r3 = await pcRun(pcBox(), { id:"kai", name:"Kai Reyes", pronouns:"he/him" }, {});
  assert.equal(r3.stateCards.length, 0, "no changes found → no card");
});
await test("C3 the breakdown asks for each state's label and screenplay words; an older plain-string answer still reads", async ()=>{
  const box = { console }; box.window = box; vm.createContext(box);
  let prompt = "";
  Object.assign(box, { aiAvailable:()=>true, extractJSON:(t)=>JSON.parse(t), clipSpecText:(v,n)=>String(v==null?"":v).slice(0,n||999).trim(),
    clipWords:(v)=>String(v), scrubBrand:(v)=>String(v), claude:{ complete:async ({ messages })=>{ prompt = messages[0].content;
      return JSON.stringify({ characters:[{ name:"Kai Reyes", gender_used:"he", states:["forearm panel open.", { label:"Bloodied", change:"blood on his collar", quote:"blood  on his collar" }, { label:"" }] }] }); } } });
  vm.runInContext(between(ai, "async function aiScriptBreakdown(", "window.aiScriptBreakdown = aiScriptBreakdown;")+"; window.f = aiScriptBreakdown;", box);
  const bd = await box.f({ no:1, title:"Garage" }, null, drafts.s1, [KAI]);
  assert.match(prompt, /"states":\[\{"label":"2-4 word name for the look, e\.g\. Panel open","change":"VISIBLE appearance change in this scene/);
  assert.match(prompt, /"quote":"the EXACT words of the screenplay that show it, copied verbatim"\}\]/);
  assert.deepEqual(J(bd.characters[0].states), [{ label:"", change:"forearm panel open", quote:"" }, { label:"Bloodied", change:"blood on his collar", quote:"blood on his collar" }]);
});
await test("C4 the agent's copy says it", ()=>{
  assert.ok(agentsSrc.includes("first reading the script into the cast sheets (pronouns, scale, physical details, voice, appearance states, signature expressions), then "));
  assert.ok(agentsSrc.includes("reads every written scene into the cast sheets (pronouns, scale, physical details, voice, appearance states with the screenplay's words, signature expressions), then holds"));
  assert.ok(agentsSrc.includes("const castFixes = read ? read.reconciled + read.enriched + (read.exprSet?1:0) + (read.statesAdded||0) : 0;"));
});

/* ═══ D — the likeness fit check ═══ */
const USABLE = { locked:true, available:true, angleCount:3, capturedAt:"2026-10-05T10:00:00.000Z", consent:{ subject:"Sam" }, mine:true, synced:false };
const KEY = "2026-10-05T10:00:00.000Z|Sam";
await test("D1 when it shows: a usable likeness and an age band, heritage or build the script (or the card) states", ()=>{
  const s = W.charLikenessFitState(KAI, { drafts, info:USABLE });
  assert.equal(s.show, true); assert.equal(s.key, KEY); assert.equal(s.choice, ""); assert.equal(s.stale, false);
  assert.deepEqual(J(s.facts.map(f=>f.field+": "+f.value)), ["age: 60s","heritage: Filipino","build: wiry"], "the script's, in order; injuries and wardrobe aren't asked about");
  assert.deepEqual(J(s.card), [], "rows the script states aren't repeated from the card");
  assert.equal(W.charLikenessFitState(KAI, { drafts, info:null }).show, false, "no likeness → nothing");
  assert.equal(W.charLikenessFitState(KAI, { drafts, info:{ ...USABLE, available:false } }).show, false, "a likeness this person can't use here → nothing");
  // not read yet: the card's own rows (the story's age range when the card has no apparent age)
  const card = W.charLikenessFitState({ id:"m", name:"Mara Lin", ageRange:"30s", ageProvenance:"story", physique:{ ethnicity:"Korean-American" } }, { drafts, info:USABLE });
  assert.deepEqual(J(card.card), [{ field:"age", label:"Age", value:"30s", from:"the story" }, { field:"heritage", label:"Heritage", value:"Korean-American", from:"the card" }]);
  assert.equal(W.charLikenessFitState({ id:"n", name:"Nobody" }, { drafts, info:USABLE }).show, false, "nothing stated → no question");
  // a fact whose quote left the script doesn't count
  const gone = { ...KAI, physique:{}, scriptFacts:{ facts:[{ field:"age", value:"60s", quote:"no longer here", sceneId:"s1", sceneNo:1 }] } };
  assert.equal(W.charLikenessFitState(gone, { drafts, info:USABLE }).show, false);
});
await test("D2 Fits / Update to match / Check again — the patches; the script's facts are never rewritten", ()=>{
  const fits = W.charLikenessFitPatch(KAI, "fits", { key:KEY, at:"T" });
  assert.deepEqual(J(fits), { likenessFit:{ choice:"fits", key:KEY, at:"T" } });
  const m = W.charLikenessFitPatch(KAI, "match", { key:KEY, at:"T", age:" early 30s ", heritage:"Korean" });
  assert.deepEqual(J(m.physique), { age:"early 30s", ethnicity:"Korean", build:"wiry, ropey forearms" });
  assert.equal(m.coreBody, "Apparent age: early 30s. Ethnicity: Korean. Body type: wiry, ropey forearms.");
  assert.deepEqual(J(Object.keys(m.scriptOverrides)), ["age","ethnicity"]);
  assert.deepEqual(J(m.likenessFit), { choice:"match", key:KEY, at:"T", age:"early 30s", heritage:"Korean" });
  assert.equal(m.scriptFacts, undefined, "the fact sheet is untouched");
  const ageOnly = W.charLikenessFitPatch(KAI, "match", { key:KEY, at:"T", age:"40s" });
  assert.equal(ageOnly.physique.ethnicity, "Filipino"); assert.deepEqual(J(Object.keys(ageOnly.scriptOverrides)), ["age"]);
  assert.deepEqual(J(W.charLikenessFitPatch(KAI, "match", { age:" ", heritage:"" })), {}, "nothing typed → nothing changes");
  assert.deepEqual(J(W.charLikenessFitPatch(KAI, "clear")), { likenessFit:null });
  // remembered for THIS likeness; a recaptured one asks again
  const after = { ...KAI, ...fits };
  assert.equal(W.charLikenessFitState(after, { drafts, info:USABLE }).choice, "fits");
  const re = W.charLikenessFitState(after, { drafts, info:{ ...USABLE, capturedAt:"2026-10-13T09:00:00.000Z" } });
  assert.deepEqual([re.choice, re.stale], ["", true]);
  // a re-draft keeps the choice (the rows are the writer's now)
  const kept = W.charKeepOverrides({ ...KAI, ...m }, { physique:{ age:"late 60s", ethnicity:"Filipino", build:"wiry" }, coreBody:"x" });
  assert.deepEqual([kept.physique.age, kept.physique.ethnicity], ["early 30s","Korean"]);
});
await test("D3 the check on the card: what the script says with quotes, the three buttons, then a one-line receipt", ()=>{
  const updates = []; let other = 0;
  const tree = W.CharLikenessFitCheck({ c:KAI, drafts, info:USABLE, readOnly:false, onUpdate:(id,p)=>updates.push([id,J(p)]), onChooseOther:()=>other++ });
  const t = textOf(tree);
  assert.ok(t.startsWith("Does this person fit the character?The likeness gives Kai Reyes's face. What the script says:"), t.slice(0,140));
  assert.ok(t.includes("Age: 60sSc 1“KAI REYES (60s, Filipino, wiry)”") && t.includes("Heritage: FilipinoSc 1") && t.includes("Build: wirySc 1"), t);
  assert.ok(t.endsWith("You decide — the photos aren't sent anywhere for this check."));
  const btns = findAll(tree, n=>n.type==="button");
  assert.deepEqual(btns.map(textOf), ["Fits","Update the character to match this person","Choose someone else"]);
  btns[0].props.onClick();
  assert.deepEqual(updates[0], ["kai", { likenessFit:{ choice:"fits", key:KEY, at:updates[0][1].likenessFit.at } }]);
  btns[2].props.onClick(); assert.equal(other, 1, "Choose someone else opens the Likeness window");
  // the update form (editing), prefilled from the card
  stateOverrides.push(true, "early 30s", "Korean");
  const form = W.CharLikenessFitCheck({ c:KAI, drafts, info:USABLE, onUpdate:(id,p)=>updates.push([id,J(p)]) });
  const ft = textOf(form);
  assert.ok(ft.includes("Their age") && ft.includes("Their heritage (optional)"));
  assert.ok(ft.includes("This sets the card's Apparent age and Ethnicity rows — what the writers and voice design read — as your choice. What the script states stays as it is. Body and wardrobe still follow the card."));
  const fb = findAll(form, n=>n.type==="button");
  assert.deepEqual(fb.map(textOf), ["Update Kai Reyes","Cancel"]);
  fb[0].props.onClick();
  assert.deepEqual([updates[1][1].physique.age, updates[1][1].likenessFit.choice, updates[1][1].likenessFit.key], ["early 30s","match",KEY]);
  // after a choice: one line and "Check again"
  const done = W.CharLikenessFitCheck({ c:{ ...KAI, ...W.charLikenessFitPatch(KAI, "match", { key:KEY, age:"early 30s", heritage:"Korean" }) }, drafts, info:USABLE, onUpdate:(id,p)=>updates.push([id,J(p)]) });
  assert.equal(textOf(done), "You updated Kai Reyes to match this person — age early 30s · heritage Korean.Check again");
  findAll(done, n=>n.type==="button")[0].props.onClick();
  assert.deepEqual(updates[2], ["kai", { likenessFit:null }]);
  // read-only: what it says, no buttons
  const ro = W.CharLikenessFitCheck({ c:KAI, drafts, info:USABLE, readOnly:true, onUpdate:null });
  assert.equal(findAll(ro, n=>n.type==="button").length, 0);
});
await test("D4 it sits under 'Likeness locked' on the card and opens the Likeness window; nothing is sent anywhere", ()=>{
  const card = between(art, "function CharacterSheet(", "\nfunction ");
  const i = card.indexOf('lkInfo.mine!==false && React.createElement("button",{className:"scs-act danger",onClick:removeCameo},"Remove")),');
  const j = card.indexOf("(lkInfo && lkInfo.available!==false) && React.createElement(CharLikenessFitCheck,{ c, drafts, info:lkInfo, readOnly:!!readOnly,");
  assert.ok(i>0 && j>i, "right after the Likeness locked status");
  assert.ok(card.includes("onUpdate:readOnly ? null : onUpdate, onChooseOther:()=>setCameoOpen(true) }),"));
  const comp = between(art, "function CharLikenessFitCheck(", "\nwindow.CharLikenessFitCheck");
  assert.ok(!/fetch\(|aiVision|claude\.complete|nbLoadCameo|turnLoadLikeness/.test(comp), "no photo is read or sent");
  assert.ok(/\.char-fit\{/.test(css) && /\.char-fit-acts\{/.test(css));
});
await test("D5 the writers and voice design get the user's choice (and the story's age when nothing is designed)", ()=>{
  const box = { console }; box.window = box; vm.createContext(box);
  Object.assign(box, { identityContext:(x)=>x||{}, canonicalIdentity:(c)=>({ pronouns:c.pronouns||"" }) });
  vm.runInContext(between(ai, "function charWriterAge(c){", "window.normalizeStoryAge = normalizeStoryAge;")
    + between(ai, "function castPronounBlock(cast, context){", "window.castPronounBlock = castPronounBlock;")+"; window.castPronounBlock = castPronounBlock;", box);
  const line = (c)=> box.castPronounBlock([c]).split("\n").find(l=>l.startsWith(c.name));
  assert.equal(line({ id:"m", name:"MAREN", role:"Protagonist — a keeper", pronouns:"she/her", ageRange:"60s", ageProvenance:"story" }),
    "MAREN — Protagonist — a keeper · apparent age: 60s · she/her", "the story's age at build time");
  assert.equal(line({ id:"m", name:"MAREN", role:"Protagonist", pronouns:"she/her", ageRange:"60s", physique:{ age:"late 60s", ethnicity:"Irish" } }),
    "MAREN — Protagonist · apparent age: late 60s · she/her", "the designed age wins; a designed heritage isn't canon for the scenes");
  const matched = { ...KAI, ...W.charLikenessFitPatch(KAI, "match", { key:KEY, age:"early 30s", heritage:"Korean" }) };
  assert.equal(line(matched), "Kai Reyes — Protagonist — a mechanic · apparent age: early 30s · heritage: Korean · he/him", "updated to match the person");
  const fits = { ...KAI, ...W.charLikenessFitPatch(KAI, "fits", { key:KEY }) };
  assert.equal(line(fits), "Kai Reyes — Protagonist — a mechanic · apparent age: late 60s · he/him", "fits: the card as written");
  const long = line({ name:"LONG", pronouns:"he/him", role:"x".repeat(200), ageRange:"about 12" });
  assert.ok(long.endsWith(" · apparent age: about 12 · he/him"), "a long role never cuts the age off");
  assert.match(box.castPronounBlock([{ name:"A", pronouns:"he/him" }]), /AGES ARE CANON: a first on-screen introduction carries the age parenthetical from THIS list/);
  // voice design: the card's apparent age, else the story's
  const vb = { console }; vb.window = vb; vm.createContext(vb);
  vm.runInContext(between(voices, "function vcParseRole(role){", "\n/* origin/heritage")+between(voices, "function vcOriginFrom(text, charName){", "\n// who actually needs a voice")+"; window.buildVoiceSpec = buildVoiceSpec;", vb);
  assert.match(vb.buildVoiceSpec({ name:"MAREN", pronouns:"she/her", ageRange:"60s" }), /^60s female voice;/);
  assert.match(vb.buildVoiceSpec({ name:"Kai Reyes", pronouns:"he/him", ageRange:"60s", physique:matched.physique }), /^early 30s male voice;/);
});

/* ═══ E — ages decided in the story build ═══ */
const ageBox = { console }; ageBox.window = ageBox; vm.createContext(ageBox);
vm.runInContext(between(ai, "const _STORY_AGE_RX =", "window.normalizeStoryAge = normalizeStoryAge;")+"; window.normalizeStoryAge = normalizeStoryAge;", ageBox);
await test("E1 an age range is kept only when it is a short age", ()=>{
  const n = ageBox.normalizeStoryAge;
  for(const [x, y] of [["60s","60s"],["early 30s","early 30s"],["about 12","about 12"],["late teens","late teens"],["(40s)","40s"],["Age: mid-20s.","mid-20s"],
    ["aged 70","70"],[" 35 ","35"],["middle-aged","middle-aged"],["a child","a child"]])
    assert.equal(n(x), y, x);
  for(const x of ["", null, "ageless", "unknown", "she is a woman in the prime of her long and difficult life, 40", "200", "old soul"])
    assert.equal(n(x), "", String(x));
});
await test("E2 the cast step asks for each member's age range and keeps only an age", async ()=>{
  const box = { console }; box.window = box; vm.createContext(box);
  box.normalizeStoryAge = ageBox.normalizeStoryAge;
  let prompt = "";
  const reply = { premise:"What if a keeper stopped lying?", cast:[
    { id:"maren", name:"MAREN DOYLE", role:"Protagonist — a lighthouse keeper", pronouns:"she/her", age:"60s" },
    { id:"tomas", name:"TOMAS ULLA", role:"Antagonist — a harbour master", age:"early 40s" },
    { id:"ash", name:"ASH", role:"Ally — a radio operator's child", age:"about 12" },
    { id:"pell", name:"PELL", role:"Mirror — a ferryman", age:"timeless" },
    { id:"ivo", name:"IVO", role:"Wildcard — a smuggler" } ] };
  Object.assign(box, { inventionRules:()=>"", aiAvailable:()=>true, clipAtBoundary:(s)=>s, clipWords:(s)=>String(s), scrubBrand:(s)=>String(s),
    extractJSON:(t)=>JSON.parse(t), claude:{ complete:async (o)=>{ prompt = o.messages[0].content; return JSON.stringify(reply); } } });
  vm.runInContext(between(ai, "async function aiBuildStoryWorld(", "\nwindow.aiBuildStoryWorld")+";this.f=aiBuildStoryWorld;", box);
  const w = await box.f("A keeper", { title:"LIGHT", scenes:[{ no:1, title:"Dusk", driver:"maren" }] }, "film", null);
  assert.match(prompt, /AGE — give every cast member an AGE RANGE consistent with their IDENTITY and their place in the story: a short band such as "60s", "early 30s", "late teens" or "about 12"\. The screenplay introduces each person at this age\./);
  assert.match(prompt, /"pronouns":"he\/him","age":"early 30s","voice"/);
  assert.deepEqual(w.cast.map(c=>c.ageRange||""), ["60s","early 40s","about 12","",""]);
  await box.f("A portrait", { title:"DOC", scenes:[] }, "documentary", null);
  assert.match(prompt, /"about 12" \(a real subject's age as the record gives it\)\./);
});
await test("E3 the build saves it as set by the story (a merged duplicate keeps it); the scene writer reads it", ()=>{
  const map = between(agentsSrc, "  let cast = ((world && world.cast) || []).map((c,i)=>({", "  }));");
  assert.ok(map.includes('...(c.ageRange ? { ageRange:c.ageRange, ageProvenance:"story", ageSource:"story" } : {}),'));
  assert.ok(agentsSrc.includes('if(!prev.ageRange && c.ageRange){ prev.ageRange = c.ageRange; prev.ageProvenance = "story"; prev.ageSource = "story"; }'));
  assert.ok(ai.includes("const age = charWriterAge(c), heritage = charWriterHeritage(c);"), "castPronounBlock reads the story age when the physique has none (D5)");
});
await test("E4 the safety net: the first screenplay introduction's age, never over a card's value or a Show's canon", ()=>{
  const box = { console }; box.window = box; vm.createContext(box);
  vm.runInContext(read("app/scene-order.js"), box);
  box.normalizeStoryAge = ageBox.normalizeStoryAge;
  vm.runInContext(between(agentsSrc, "function storyAgeFromScreenplay(c, scenes, drafts){", "\nwindow.fillAgesFromScreenplay")+";this.f=fillAgesFromScreenplay;this.g=storyAgeFromScreenplay;", box);
  const action = (t)=>({ type:"action", text:t });
  const sc = [{ id:"s1", no:1 }, { id:"s2", no:2 }];
  const dr = { s1:{ blocks:[action("GRETA HOLM (70s), salt in her hair, mends a net."), { type:"char", text:"JUNO (V.O.)" }, action("JUNO RASK (50s) watches."),
      action("ODA enters."), action("WREN TALLIS (about 12, barefoot) runs in.")] },
    s2:{ blocks:[action("ODA (40s) sits."), action("BRAM (tired) walks.")] } };
  const characters = [
    { id:"maren", name:"MAREN DOYLE", ageRange:"60s", ageProvenance:"story" },   // already set
    { id:"greta", name:"GRETA HOLM", role:"Supporting" },                       // → 70s
    { id:"juno", name:"JUNO RASK", role:"Supporting" },                         // a Show's canon: untouched
    { id:"oda", name:"ODA", role:"Supporting" },                                // first intro has no age → never a later one
    { id:"wren", name:"WREN TALLIS", role:"Supporting" },                       // "(about 12, barefoot)" → about 12
    { id:"bram", name:"BRAM", role:"Supporting" },                              // "(tired)" isn't an age
    { id:"cal", name:"CAL", physique:{ age:"30s" } } ];                         // a designed age counts as set
  const log = []; let syncs = 0;
  const ctx = { model:{ characters, scenes:sc, drafts:dr }, sync:()=>syncs++, emit:(e)=>log.push(e), castCanon:(c)=>c.id==="juno" };
  const r = box.f(ctx);
  const by = (id)=>ctx.model.characters.find(c=>c.id===id);
  assert.deepEqual([by("greta").ageRange, by("greta").ageProvenance, by("greta").ageSource], ["70s","story","screenplay"]);
  assert.equal(by("wren").ageRange, "about 12");
  assert.equal(by("maren").ageSource, undefined, "a set card is left as it is");
  for(const id of ["juno","oda","bram","cal"]) assert.equal(by(id).ageRange, undefined, id);
  assert.equal(r.filled, 2); assert.equal(syncs, 1);
  assert.deepEqual(log.map(e=>e.k+": "+e.t), ["ok: Ages set from the screenplay's introductions for GRETA HOLM (70s), WREN TALLIS (about 12)."]);
  assert.deepEqual(J(box.g({ name:"GRETA HOLM" }, sc, dr)), { age:"70s", sceneId:"s1", quote:"GRETA HOLM (70s)" });
  // nothing to fill: nothing said, nothing saved
  const log2 = []; let syncs2 = 0;
  box.f({ model:{ characters:[{ id:"a", name:"A", ageRange:"20s" }], scenes:sc, drafts:dr }, sync:()=>syncs2++, emit:(e)=>log2.push(e) });
  assert.deepEqual([log2.length, syncs2], [0, 0]);
});
await test("E5 where it runs (after the pronoun net, before the build's last line); the Cast panel field; the pipeline doc", ()=>{
  const build = between(agentsSrc, "async function agentAdaptation(ctx){", "\nfunction fillPronounsFromScreenplay(ctx){");
  const pron = build.indexOf("fillPronounsFromScreenplay(ctx);"), age = build.indexOf("fillAgesFromScreenplay(ctx);"), done = build.lastIndexOf('ctx.emit({k:"done"');
  assert.ok(pron>0 && age>pron && done>age);
  assert.ok(charPanel.includes('React.createElement(EditText,{value:c.ageRange||"",readOnly,placeholder:"e.g. early 30s\\u2026",'));
  assert.ok(charPanel.includes('onCommit:v=>onUpdate(c.id,{ ageRange:String(v||"").replace(/\\s+/g," ").trim().slice(0,40), ageProvenance:"user", ageSource:"user" })})),'));
  assert.ok(charPanel.includes('"Set by the story")),'));
  const i = doc.indexOf("> **Cast pronouns** *(approved 2026-10-11 by owner)*"), j = doc.indexOf("> **Cast ages** *(approved 2026-10-12 by owner)*"), k = doc.indexOf("> **Character architecture**");
  assert.ok(i>0 && j>i && k>j, "the note sits right after Cast pronouns");
  const note = doc.slice(j, k);
  assert.match(note, /age range\*\* — e\.g\. "60s", "early 30s", "about 12"/);
  assert.match(note, /takes the age its first screenplay introduction\n> gives — "NAME \(70s\)" — with no model call/);
});

/* ═══ F — Frances, and the names users see ═══ */
await test("F1 Frances knows (one dated block, just before the public view)", ()=>{
  const i = ai.indexOf("CHARACTER FIDELITY, steps 3 · 5 · 7 (owner-approved 2026-10-12"), j = ai.indexOf("/* the public view of every entry, memoised");
  assert.ok(i>0 && j>i);
  const a = ai.indexOf("const APP_FEATURES = ["), b = ai.indexOf("let _museFactsMemo = null;");
  const fb = { console }; fb.window = fb; vm.createContext(fb); vm.runInContext(ai.slice(a, b)+";this.__F=APP_FEATURES;", fb);
  const F = (n)=> String((fb.__F.find(f=>f && (f.name===n || String(f.name||"").startsWith(n)))||{}).what||"");
  assert.ok(F("New Story (format").includes("AGES COME WITH THE CAST"));
  assert.ok(F("Character Sheets (Art Room)").includes("THE LOOK FOLLOWS THE ARC") && F("Character Sheets (Art Room)").includes("DOES THIS PERSON FIT THE CHARACTER?"));
  assert.ok(F("Character Sheets (Art Room)").includes("the photos are not sent anywhere for it"));
  assert.ok(F("Appearance states / continuity (Art Room)").includes("reads every scene the character is in"));
  assert.ok(F("Production check (Art Room)").includes("APPEARANCE STATES FROM THE SCRIPT"));
  const block = ai.slice(i, j).replace(/\/\*[^]*?\*\//g, "");
  assert.ok(!/\bTURN\b|McKee|Anthropic|Claude|MUSE/.test(block), "no internal or vendor names");
});
await test("F2 no internal or vendor names in the new copy users see", ()=>{
  const comp = between(art, "function CharLikenessFitCheck(", "\nwindow.CharLikenessFitCheck");
  const cards = between(agentsSrc, "  // APPEARANCE STATES — one approval card per character", "  // SIGNATURE EXPRESSIONS");
  const net = between(agentsSrc, "function fillAgesFromScreenplay(ctx){", "\nwindow.fillAgesFromScreenplay");
  for(const src of [comp, cards, net, between(charPanel, "// AGE (owner-approved 2026-10-12", "// ORBIT")])
    assert.ok(!/\bTURN\b|McKee|Anthropic|Claude|MUSE|Cinema Machine/.test(src.replace(/\/\/[^\n]*|\/\*[^]*?\*\//g, "")), src.slice(0, 80));
});

console.log("\n"+passes+" passed, "+failures+" failed");
if(failures) process.exit(1);

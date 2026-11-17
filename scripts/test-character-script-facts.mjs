#!/usr/bin/env node
/* ============================================================================
   CHARACTER FIDELITY, steps 2 · 4 · 6 (owner-approved 2026-10-12, "go ahead with all of it, in that order").
     A  the screenplay about a character: name tokens, paragraphs (a pronoun-led line after one naming them), the free
        local signature (their own dialogue changing is not a change), the chunks one writing call reads
     B  the fact sheet: every fact checked against the cited scene's text (an invented quote is dropped; dialogue is
        weaker), the extraction call (aiCastScriptFacts), the read patch (marks feed Distinguishing features once)
     C  the look drafter reads the fact sheet INSTEAD of the excerpt (excerpt only as the fallback), keeps the writer's
        choices, and remembers the screenplay it was drafted from
     D  on the card: where each row comes from, the "change it anyway?" question, the facts panel, the stale banner
     E  the Script check (vision): what it checks, the call, the report's Apply to spec / Regenerate
     F  the flows: Draft & generate / Draft all / the Casting Director / Design the cast read first and quote it;
        the Casting Director's optional Script check
     G  Frances, the pipeline doc, no internal or vendor names
   Run AFTER `npm run build`:   node scripts/test-character-script-facts.mjs
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
  css = read("app/styles.css"), doc = read("docs/Story Pipeline.md");

/* ---------------- the sandbox: dist/app/artroom.js ---------------- */
const noop = ()=>{};
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const stateOverrides = [];   // values the next useState calls return (in order), for one render
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
for(const fn of ["charNameTokens","charScriptParagraphs","charScriptSig","charFactsState","charFactsLive","charFactChunks","charFactCallCount",
  "charFactsNormalize","charFactLocate","charFactsReadPatch","charFactsFeatureMerge","charFieldOrigin","charOverridePatch","charOverrideQuestion",
  "charKeepOverrides","charFactsPromptBlock","charFidelityFacts","charFidelityFixPatch","charFeaturesRemovedMarks","charReadCostText","charHasScript",
  "CharScriptFactsPanel","ScriptCheckButton","CharacterScriptCheckReport","CastConfirm"])
  if(typeof W[fn]!=="function"){ console.log("FAIL "+fn+" missing from dist/app/artroom.js — run npm run build"); process.exit(1); }
W.turnWritingCallsText = (n)=> "about "+n+" writing call"+(n!==1?"s":"")+" on Opus 5.5";
W.nbCostChip = (n, o)=>({ type:"chip", props:{ n, o }, children:[] });
let cameo = null;
W.nbCameoInfo = (id)=> (id==="kai" && cameo) ? cameo : null;
const USABLE = { locked:true, available:true, angleCount:3, capturedAt:"2026-10-05T10:00:00.000Z", mine:true };

/* ---------------- the screenplay ---------------- */
const scenes = [{ id:"s1", no:1, title:"Garage" }, { id:"s2", no:2, title:"Street" }, { id:"s3", no:3, title:"Office" }, { id:"s4", no:4, title:"Roof" }];
const DRAFTS = ()=>({
  s1:{ blocks:[
    { type:"scene", text:"INT. GARAGE - NIGHT" },
    { type:"action", text:"KAI REYES (60s, Filipino, wiry) wipes grease from his hands." },
    { type:"action", text:"His left hand is missing two fingers." },
    { type:"char", text:"MARA" },
    { type:"dia", text:"Kai, your scar is bleeding again." },
    { type:"action", text:"Mara Lin, 30s, tall, in a yellow raincoat, leans on the door." },
    { type:"action", text:"Kai’s knuckles are scarred." } ] },
  s2:{ blocks:[
    { type:"scene", text:"EXT. STREET - DAY" },
    { type:"action", text:"Kai limps past in a grey boiler suit. A fresh cut over his right eye." },
    { type:"char", text:"KAI" },
    { type:"dia", text:"Leave it." } ] },
  s3:{ blocks:[ { type:"scene", text:"INT. OFFICE - DAY" }, { type:"action", text:"A clerk files papers." } ] },
  s4:{ blocks:[ { type:"action", text:"Kai rolls up his sleeve: a faded koi tattoo on his right forearm." } ] },
});
const drafts = DRAFTS();
const KAI = { id:"kai", name:"Kai Reyes", pronouns:"he/him" };
const MARA = { id:"mara", name:"Mara Lin", pronouns:"she/her" };
const RAW = { facts:[
  { charId:"kai", field:"age", value:"60s", sceneId:"s1", block:2, quote:"KAI REYES (60s, Filipino, wiry)", source:"action" },
  { charId:"kai", field:"heritage", value:"Filipino", sceneId:"s1", block:2, quote:"Filipino", source:"action" },
  { charId:"kai", field:"build", value:"wiry", sceneId:"s1", block:2, quote:"Filipino, wiry", source:"action" },
  { charId:"kai", field:"marks", value:"missing two fingers on the left hand", sceneId:"s1", block:9, quote:"His left hand is missing two fingers.", source:"action" },
  { charId:"kai", field:"marks", value:"a scar", sceneId:"s1", block:5, quote:"your scar is bleeding again", source:"dialogue" },
  { charId:"kai", field:"marks", value:"scarred knuckles", sceneId:"s1", block:7, quote:"Kai's knuckles are scarred", source:"action" },
  { charId:"kai", field:"marks", value:"an eye patch", sceneId:"s1", block:2, quote:"wears an eye patch over one eye", source:"action" },   // invented
  { charId:"kai", field:"marks", value:"koi tattoo", sceneId:"s2", block:2, quote:"a faded koi tattoo on his right forearm", source:"action" },   // wrong scene
  { charId:"zed", field:"age", value:"40", sceneId:"s1", block:2, quote:"60s", source:"action" },   // no such character
  { charId:"kai", field:"voice", value:"gravelly", sceneId:"s1", block:2, quote:"KAI REYES", source:"action" },   // no such field
  { name:"Mara Lin", field:"wardrobe", value:"yellow raincoat", sceneId:"s1", block:6, quote:"in a yellow raincoat", source:"action" },
] };

/* ═══ A — the screenplay about a character ═══ */
await test("A1 name tokens: the full name and its parts, never a title", ()=>{
  assert.deepEqual(J(W.charNameTokens(KAI)), ["Kai Reyes","Kai","Reyes"]);
  assert.deepEqual(J(W.charNameTokens({ name:"The Oracle" })), ["The Oracle","Oracle"]);
  assert.deepEqual(J(W.charNameTokens({ name:"" })), []);
});
await test("A2 the paragraphs about them: a pronoun-led action right after one naming them; a mention in someone's line; never a cue", ()=>{
  const p = W.charScriptParagraphs(KAI, scenes, drafts);
  assert.deepEqual(J(p), [
    "s1:KAI REYES (60s, Filipino, wiry) wipes grease from his hands.",
    "s1:His left hand is missing two fingers.",
    "s1:Kai, your scar is bleeding again.",
    "s1:Kai’s knuckles are scarred.",
    "s2:Kai limps past in a grey boiler suit. A fresh cut over his right eye.",
    "s4:Kai rolls up his sleeve: a faded koi tattoo on his right forearm." ]);
  assert.ok(!p.some(x=>/Leave it|MARA|KAI$/.test(x)), "their own line and the cues are not about them");
  assert.deepEqual(J(W.charScriptParagraphs(MARA, scenes, drafts)), ["s1:Mara Lin, 30s, tall, in a yellow raincoat, leans on the door."]);
});
await test("A3 the signature (free, local): their own dialogue or another scene changing is no change; a line about them is", ()=>{
  const sig = W.charScriptSig(KAI, scenes, drafts);
  assert.match(sig, /^cs-[0-9a-z]+$/);
  assert.equal(W.charScriptSig(KAI, scenes, DRAFTS()), sig, "the same text, another object → the same signature");
  const own = DRAFTS(); own.s2.blocks[3].text = "Go away.";
  assert.equal(W.charScriptSig(KAI, scenes, own), sig, "Kai's own line changed — not about how he looks");
  const other = DRAFTS(); other.s3.blocks[1].text = "A clerk shreds papers.";
  assert.equal(W.charScriptSig(KAI, scenes, other), sig);
  const mara = DRAFTS(); mara.s1.blocks[5].text = "Mara Lin, 30s, in a green coat, leans on the door.";
  assert.equal(W.charScriptSig(KAI, scenes, mara), sig, "Mara's line isn't Kai's");
  assert.notEqual(W.charScriptSig(MARA, scenes, mara), W.charScriptSig(MARA, scenes, drafts));
  const pron = DRAFTS(); pron.s1.blocks[2].text = "His left hand is missing three fingers.";
  assert.notEqual(W.charScriptSig(KAI, scenes, pron), sig, "the pronoun-led line about him changed");
  const late = DRAFTS(); late.s4.blocks[0].text = "Kai rolls up his sleeve: a faded koi tattoo on his LEFT forearm.";
  assert.notEqual(W.charScriptSig(KAI, scenes, late), sig, "a late scene counts too");
  assert.equal(W.charScriptSig(KAI, scenes, null), "");
});
await test("A4 the chunks one writing call reads: only scenes that name someone in the list; a long script is split between blocks", ()=>{
  const ch = W.charFactChunks(scenes, drafts, [KAI, MARA]);
  assert.equal(ch.length, 1);
  assert.deepEqual(J(ch[0].map(p=>p.sceneId)), ["s1","s2","s4"], "the office scene names nobody — not paid for");
  assert.deepEqual(J(ch[0][0].blocks[1]), { block:2, type:"action", text:"KAI REYES (60s, Filipino, wiry) wipes grease from his hands." });
  assert.equal(W.charFactCallCount(scenes, drafts, [KAI, MARA]), 1);
  assert.equal(W.charFactCallCount(scenes, drafts, []), 0);
  assert.equal(W.charFactCallCount(scenes, drafts, [{ id:"x", name:"Nobody Here" }]), 0);
  // a long script: several calls, block numbers kept, nothing lost
  const big = {}; const bigScenes = [];
  for(let i=1;i<=12;i++){ bigScenes.push({ id:"b"+i, no:i }); big["b"+i] = { blocks:[{ type:"action", text:"Kai walks. "+"x".repeat(2400) }, { type:"action", text:"He sits." }] }; }
  const bc = W.charFactChunks(bigScenes, big, [KAI]);
  assert.ok(bc.length>=2, "split into "+bc.length);
  assert.ok(bc.every(chunk=> chunk.reduce((a,p)=>a+p.blocks.reduce((x,b)=>x+b.text.length,0),0) <= 24000));
  assert.equal(bc.flat().reduce((a,p)=>a+p.blocks.length,0), 24, "every block read once");
  assert.equal(W.charHasScript(scenes, drafts), true); assert.equal(W.charHasScript(scenes, {}), false);
  assert.equal(W.charReadCostText(scenes, drafts, [KAI]), "about 1 writing call on Opus 5.5");
});

/* ═══ B — the fact sheet ═══ */
await test("B1 every fact is checked against the cited scene: invented / wrong-scene quotes, unknown people or fields dropped", ()=>{
  const chunk = W.charFactChunks(scenes, drafts, [KAI, MARA])[0];
  const r = W.charFactsNormalize(RAW, chunk, [KAI, MARA], drafts);
  assert.equal(r.rejected, 4);
  const k = r.byId.kai;
  assert.deepEqual(J(k.map(f=>f.field+":"+f.value)), ["age:60s","heritage:Filipino","build:wiry","marks:missing two fingers on the left hand","marks:a scar","marks:scarred knuckles"]);
  assert.equal(k[3].block, 3, "a wrong block number is corrected to where the quote really is");
  assert.equal(k[3].sceneNo, 1);
  assert.equal(k[4].weak, true, "said in dialogue → weaker");
  assert.ok(!k[0].weak);
  assert.equal(k[5].quote, "Kai's knuckles are scarred", "a straight apostrophe matches the script's curly one");
  assert.deepEqual(J(r.byId.mara), [{ field:"wardrobe", value:"yellow raincoat", quote:"in a yellow raincoat", sceneId:"s1", sceneNo:1, block:6 }]);
  assert.ok(!k.some(f=>/eye patch|koi/.test(f.value)));
  // a quote too short to prove anything, a scene outside the chunk
  assert.equal(W.charFactsNormalize({ facts:[{ charId:"kai", field:"age", value:"60s", sceneId:"s1", quote:"60" }] }, chunk, [KAI], drafts).rejected, 1);
  assert.equal(W.charFactsNormalize({ facts:[{ charId:"kai", field:"age", value:"x", sceneId:"s3", quote:"A clerk files" }] }, chunk, [KAI], drafts).rejected, 1);
  assert.deepEqual(J(W.charFactsNormalize(null, chunk, [KAI], drafts)), { byId:{}, rejected:0 });
});
// the extraction call, lifted from ai.jsx with its collaborators stubbed
const aiBox = { console, JSON, Object, Array, String, Number, Math, Set, Map, Promise, RegExp, Error };
aiBox.window = aiBox; vm.createContext(aiBox);
for(const k of ["charFactChunks","charFactsNormalize","charFactsDedupe","charFactsPromptBlock","charKeepOverrides","charScriptSig","charFactsLive","charFactQuoteValid"]) aiBox[k] = W[k];
aiBox.aiAvailable = ()=>true;
aiBox.extractJSON = (t)=>{ try{ const s = String(t||""); return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}")+1)); }catch(e){ return null; } };
aiBox.scrubBrand = (s)=>String(s||"");
aiBox.safeError = (s)=>String(s||"");
aiBox.writingStamp = (task)=>({ model:"Opus 5.5", task });
aiBox.clipWords = (s,n)=>String(s||"").slice(0,n);
vm.runInContext(between(ai, "async function aiCastScriptFacts(", "window.aiCastScriptFacts = aiCastScriptFacts;")+"; window.aiCastScriptFacts = aiCastScriptFacts;", aiBox);
let prompts = [], answers = [];
aiBox.claude = { complete:async ({ messages })=>{ prompts.push(messages[0].content); const a = answers.length ? answers.shift() : JSON.stringify(RAW);
  if(a instanceof Error) throw a; return a; } };
await test("B2 the extraction call: one call for the whole cast, extract-never-invent rules, only the scenes that name them", async ()=>{
  prompts = []; answers = [];
  const r = await aiBox.aiCastScriptFacts([KAI, MARA], scenes, drafts);
  assert.equal(prompts.length, 1); assert.equal(r.calls, 1);
  const p = prompts[0];
  assert.match(p, /This is EXTRACTION, not design: never invent, never infer from a name/);
  assert.match(p, /heritage \(ethnicity \/ heritage ONLY when the text states it\)/);
  assert.match(p, /with the SIDE and PLACE exactly as the text gives them/);
  assert.match(p, /A detail only SAID in dialogue is source 'dialogue' \(weaker\)/);
  assert.match(p, /A pronoun-only line \('His left hand is missing two fingers\.'\) may be attributed to a character only when/);
  assert.match(p, /quote \(a VERBATIM continuous passage copied exactly from that block/);
  const payload = JSON.parse(p.slice(p.lastIndexOf('{"characters"')));
  assert.deepEqual(payload.characters.map(c=>c.id), ["kai","mara"]);
  assert.deepEqual(payload.scenes.map(s=>s.sceneId), ["s1","s2","s4"]);
  assert.equal(r.byId.kai.length, 6); assert.equal(r.byId.mara.length, 1); assert.equal(r.rejected, 4);
  assert.deepEqual(J(r.failures), []); assert.equal(r.by.task, "Script fact sheet");
});
await test("B3 an unreadable answer is asked once more; a failed call is reported; no screenplay → a plain error", async ()=>{
  prompts = []; answers = ["not json", JSON.stringify(RAW)];
  let r = await aiBox.aiCastScriptFacts([KAI], scenes, drafts);
  assert.equal(prompts.length, 2); assert.equal(r.byId.kai.length, 6);
  prompts = []; answers = [new Error("Not enough credits")];
  await assert.rejects(aiBox.aiCastScriptFacts([KAI], scenes, drafts), /Not enough credits/);
  assert.equal(prompts.length, 1, "a refused call isn't retried");
  await assert.rejects(aiBox.aiCastScriptFacts([KAI], scenes, {}), /Write or import the screenplay first/);
  // nobody named in the script: no call, an empty (read) sheet
  prompts = [];
  r = await aiBox.aiCastScriptFacts([{ id:"ghost", name:"Nobody Here" }], scenes, drafts);
  assert.equal(prompts.length, 0); assert.deepEqual(J(r.byId), { ghost:[] });
  // it runs on the specs writing engine
  assert.match(ai, /\["aiCastVisualBible","aiCharacterVisuals","aiCastScriptFacts",/);
});
const FACTS = ()=> W.charFactsNormalize(RAW, W.charFactChunks(scenes, drafts, [KAI, MARA])[0], [KAI, MARA], drafts).byId;
await test("B4 the read patch: the sheet + its signature; action marks feed Distinguishing features once, never duplicated", ()=>{
  const c = { ...KAI, scriptFeatures:"Missing two fingers on the left hand." };
  const p = W.charFactsReadPatch(c, FACTS().kai, { sig:"cs-1", at:"2026-10-12T10:00:00.000Z", by:{ model:"Opus 5.5" } });
  assert.equal(p.scriptFacts.scriptSig, "cs-1"); assert.equal(p.scriptFacts.facts.length, 6); assert.equal(p.scriptFacts.at, "2026-10-12T10:00:00.000Z");
  assert.equal(p.scriptFeatures, "Missing two fingers on the left hand. scarred knuckles.", "the dialogue scar is not a feature; the fingers aren't duplicated");
  assert.deepEqual(J(p.scriptFacts.fed), ["missing two fingers on the left hand","scarred knuckles"]);
  // the writer removes the knuckles; a later read doesn't put them back
  const after = { ...c, ...p, scriptFeatures:"Missing two fingers on the left hand." };
  const p2 = W.charFactsReadPatch(after, FACTS().kai, { sig:"cs-2" });
  assert.equal(p2.scriptFeatures, undefined, "nothing new to add");
  // a new mark later in the script is added
  const p3 = W.charFactsReadPatch(after, [...FACTS().kai, { field:"marks", value:"koi tattoo on the right forearm", quote:"a faded koi tattoo on his right forearm", sceneId:"s4", sceneNo:4, block:1 }], { sig:"cs-3" });
  assert.equal(p3.scriptFeatures, "Missing two fingers on the left hand. koi tattoo on the right forearm.");
  assert.equal(W.charFactsReadPatch(KAI, [], { sig:"x", partial:true }).scriptFacts.partial, true);
});

/* ═══ C — the look drafter ═══ */
const KAI_READ = ()=>({ ...KAI, ...W.charFactsReadPatch(KAI, FACTS().kai, { sig:W.charScriptSig(KAI, scenes, drafts) }) });
const drafterBox = { console, JSON, Object, Array, String, Number, Math, Set, Map, Promise, RegExp, Error };
drafterBox.window = drafterBox; vm.createContext(drafterBox);
for(const k of ["charFactsPromptBlock","charKeepOverrides","charScriptSig"]) drafterBox[k] = W[k];
Object.assign(drafterBox, { aiAvailable:()=>true, writingProjectOf:(p)=>p||{}, genreTag:()=>"", writingLoglineOf:()=>"", assertPromptIdentity:noop,
  canonicalIdentity:(c)=>({ pronouns:c.pronouns||"" }), castPronounBlock:()=>"", _lookbookBlock:()=>"", _lookbookStamp:()=>undefined,
  charInnerLifeLine:()=>"",   // (2026-10-12, fidelity step 3 — tested in test-character-arc-likeness-age)
  bibleBatchPrompt:(ctx)=>ctx, extractJSON:aiBox.extractJSON, salvageBibleEntries:()=>[], writingStamp:()=>({ model:"Opus 5.5" }),
  mapBibleEntry:(e)=>({ physique:{ age:e.age, build:e.build }, coreBody:"Apparent age: "+e.age+". Body type: "+e.build+".", height:e.height, wardrobeMask:e.mask }) });
vm.runInContext(between(ai, "function draftParagraphs(draft){", "window.draftParagraphs = draftParagraphs;")
  + between(ai, "function scriptEvidenceFor(name, scenes, drafts){", "window.scriptEvidenceFor = scriptEvidenceFor;")
  + between(ai, "async function aiCastVisualBible(", "window.aiCastVisualBible = aiCastVisualBible;")+"; window.aiCastVisualBible = aiCastVisualBible;", drafterBox);
let drafterPrompts = [];
drafterBox.claude = { complete:async ({ messages })=>{ drafterPrompts.push(messages[0].content);
  return JSON.stringify({ cast:[{ id:"kai", age:"early 40s", build:"heavy", height:"185 cm", mask:"a suit" }] }); } };
await test("C1 a character that was read: the drafter gets the WHOLE fact sheet (every scene, quotes) instead of the excerpt", async ()=>{
  drafterPrompts = [];
  const out = await drafterBox.aiCastVisualBible([KAI_READ()], scenes, {}, { scenes, drafts });
  const p = drafterPrompts[0];
  assert.match(p, /SCREENPLAY FACT SHEET — what the script itself states about Kai Reyes \(CANON/);
  assert.match(p, /- age: 60s — Sc 1: "KAI REYES \(60s, Filipino, wiry\)"/);
  assert.match(p, /- marks: missing two fingers on the left hand — Sc 1: "His left hand is missing two fingers\."/, "the pronoun-only line is there");
  assert.match(p, /- marks: a scar \(mentioned\) — Sc 1/);
  assert.match(p, /FACT SHEET RULE: [^]*outranks every other source[^]*a heritage the sheet doesn't state is yours to design, never a guess from the name/);
  assert.ok(!p.includes("the script's own words about Kai Reyes"), "no excerpt when there is a fact sheet");
  assert.equal(out.kai.lookScriptSig, W.charScriptSig(KAI, scenes, drafts), "the look remembers the screenplay it was drafted from");
});
await test("C2 not read yet: the short excerpt stays as the fallback; a fact whose quote left the script isn't sent", async ()=>{
  drafterPrompts = [];
  await drafterBox.aiCastVisualBible([KAI], scenes, {}, { scenes, drafts });
  assert.match(drafterPrompts[0], /SCREENPLAY — the script's own words about Kai Reyes \(CANON\):/);
  assert.ok(!drafterPrompts[0].includes("FACT SHEET"));
  // the rewrite removed the fingers line before a re-read
  const changed = DRAFTS(); changed.s1.blocks[2].text = "His hands are steady.";
  drafterPrompts = [];
  await drafterBox.aiCastVisualBible([KAI_READ()], scenes, {}, { scenes, drafts:changed });
  assert.ok(!drafterPrompts[0].includes("missing two fingers"));
  assert.match(drafterPrompts[0], /- age: 60s/);
  // read, nothing stated
  const empty = { ...KAI, scriptFacts:{ facts:[], scriptSig:"x" } };
  assert.match(W.charFactsPromptBlock(empty, drafts), /the script states nothing about Kai Reyes's appearance/);
});
await test("C3 the writer's choices: told to the drafter and kept on the result (age, height, wardrobe)", async ()=>{
  const c = { ...KAI_READ(), physique:{ age:"late 50s", build:"wiry" }, height:"170 cm", wardrobeMask:"overalls",
    scriptOverrides:{ age:{ at:"2026-10-12" }, height:{ at:"2026-10-12" }, wardrobe:{ at:"2026-10-12" } } };
  drafterPrompts = [];
  const out = await drafterBox.aiCastVisualBible([c], scenes, {}, { scenes, drafts });
  assert.match(drafterPrompts[0], /THE WRITER'S OWN CHOICES \(keep these exactly, even where the script differs\): age: late 50s; height: 170 cm; wardrobe: overalls/);
  assert.equal(out.kai.physique.age, "late 50s"); assert.equal(out.kai.physique.build, "heavy");
  assert.match(out.kai.coreBody, /^Apparent age: late 50s\. Body type: heavy\.$/);
  assert.equal(out.kai.height, "170 cm"); assert.equal(out.kai.wardrobeMask, "overalls");
  // nothing overridden → untouched
  const p = { physique:{ age:"x" }, coreBody:"y" };
  assert.equal(W.charKeepOverrides(KAI, p), p);
});

/* ═══ D — on the card ═══ */
await test("D1 the state: not read → read needed; fresh; script changed → stale (fact sheet AND look); partial → read again", ()=>{
  assert.deepEqual(J(W.charFactsState(KAI, scenes, drafts)).needsRead, true);
  const c = { ...KAI_READ(), coreBody:"Apparent age: 60s.", wardrobeMask:"overalls", lookScriptSig:W.charScriptSig(KAI, scenes, drafts) };
  let st = W.charFactsState(c, scenes, drafts);
  assert.equal(st.has, true); assert.equal(st.stale, false); assert.equal(st.lookStale, false); assert.equal(st.needsRead, false); assert.equal(st.count, 6);
  const own = DRAFTS(); own.s2.blocks[3].text = "Go away.";
  assert.equal(W.charFactsState(c, scenes, own).stale, false, "his own dialogue isn't a change");
  const changed = DRAFTS(); changed.s1.blocks[1].text = "KAI REYES (30s, Filipino, wiry) wipes grease from his hands.";
  st = W.charFactsState(c, scenes, changed);
  assert.equal(st.stale, true); assert.equal(st.lookStale, true); assert.equal(st.needsRead, true);
  // a look drafted before this feature has no record → no warning (nothing migrated)
  assert.equal(W.charFactsState({ ...c, lookScriptSig:undefined }, scenes, changed).lookStale, false);
  // an undrafted card's look is never stale
  assert.equal(W.charFactsState({ ...c, coreBody:"", wardrobeMask:"" }, scenes, changed).lookStale, false);
  assert.equal(W.charFactsState({ ...c, scriptFacts:{ ...c.scriptFacts, partial:true } }, scenes, drafts).needsRead, true);
});
await test("D2 where each row comes from: the script (quote on hover), the likeness, the writer, designed, dialogue only", ()=>{
  const c = { ...KAI_READ(), physique:{ age:"60s", ethnicity:"Filipino", build:"wiry", hair:"grey crew cut" } };
  let o = W.charFieldOrigin(c, "age", { drafts });
  assert.equal(o.kind, "script"); assert.equal(o.label, "From the script"); assert.equal(o.title, "Sc 1: “KAI REYES (60s, Filipino, wiry)”");
  assert.equal(W.charFieldOrigin(c, "hair", { drafts }).kind, "designed");
  assert.equal(W.charFieldOrigin(c, "hair", { drafts }).label, "Designed");
  assert.equal(W.charFieldOrigin(c, "eyes", { drafts }).kind, "");
  // a likeness gives the face rows; the body rows stay the script's
  o = W.charFieldOrigin(c, "age", { drafts, likeness:true });
  assert.equal(o.kind, "likeness"); assert.match(o.title, /^The likeness photos give the face\.\nThe script says:\nSc 1/);
  assert.equal(W.charFieldOrigin(c, "build", { drafts, likeness:true }).kind, "script");
  // the writer chose otherwise
  o = W.charFieldOrigin({ ...c, scriptOverrides:{ age:{ at:"x" } } }, "age", { drafts });
  assert.equal(o.kind, "override"); assert.equal(o.label, "Changed by you"); assert.match(o.title, /Re-drafting keeps your choice\./);
  // only said in dialogue: weaker, not locked
  const scarOnly = { ...KAI, scriptFacts:{ facts:FACTS().kai.filter(f=>f.weak), scriptSig:"x" }, scriptFeatures:"a scar" };
  assert.equal(W.charFieldOrigin(scarOnly, "features", { drafts }).kind, "mentioned");
  assert.equal(W.charFieldOrigin(c, "features", { drafts }).kind, "script");
});
await test("D3 changing a row the script states asks first ('The script says … — change it anyway?'), and the answer is kept", ()=>{
  const c = KAI_READ();
  const q = W.charOverrideQuestion(c, "age", { drafts });
  assert.equal(q.title, "The script says “60s” — change it anyway?");
  assert.match(q.body, /^Sc 1: “KAI REYES \(60s, Filipino, wiry\)”\n\nYour change is kept: re-drafting the look won't put the script's version back\.$/);
  assert.equal(q.confirmLabel, "Change it anyway"); assert.equal(q.cancelLabel, "Keep the script's");
  assert.equal(W.charOverrideQuestion(c, "hair", { drafts }), null, "a designed row isn't asked about");
  assert.deepEqual(J(W.charOverridePatch({ scriptOverrides:{ hair:{ at:"a" } } }, "age", "b")), { scriptOverrides:{ hair:{ at:"a" }, age:{ at:"b" } } });
  // removing a script mark from the features row asks too
  const f = { ...c, scriptFeatures:"Missing two fingers on the left hand. Scarred knuckles." };
  assert.deepEqual(J(W.charFeaturesRemovedMarks(f, "Scarred knuckles.", drafts).map(x=>x.value)), ["missing two fingers on the left hand"]);
  assert.deepEqual(J(W.charFeaturesRemovedMarks(f, f.scriptFeatures+" A limp.", drafts)), []);
  // the card wires it: every physique row, height, the features row, the wardrobe
  for(const row of ["age","ethnicity","height","build","hair","eyes","skin","face"]) assert.ok(new RegExp(',"'+row+'"\\),').test(art), "row "+row);
  assert.ok(art.includes("const guarded = (row, apply)=> async (val)=>{"));
  assert.ok(art.includes("if(!ok){ setRowKeyTick(t=>t+1); return; }\n              onUpdate(c.id, charOverridePatch(c, row));"));
  assert.ok(art.includes("onCommit:commitFeatures}),"));
  assert.ok(art.includes('const o = charFieldOrigin(c, "wardrobe", { drafts });'));
  assert.ok(/\.char-origin\{/.test(css) && /\.char-origin\.script\{/.test(css));
});
await test("D4 the facts panel: 'not read yet' with Read the script (its price), then each fact with scene and quote", ()=>{
  const cost = "about 1 writing call on Opus 5.5";
  let tree = W.CharScriptFactsPanel({ c:KAI, drafts, state:W.charFactsState(KAI, scenes, drafts), reading:false, readOnly:false, onRead:noop, readCost:cost });
  assert.match(textOf(tree), /What the script says — not read yet/);
  let btn = findAll(tree, n=>n.type==="button")[0];
  assert.equal(textOf(btn), "Read the script");
  assert.match(btn.props.title, /about 1 writing call on Opus 5\.5 \(writing credits\)\. Nothing is drafted or generated\.$/);
  // read, opened
  const c = KAI_READ();
  stateOverrides.push(true);
  tree = W.CharScriptFactsPanel({ c, drafts, state:W.charFactsState(c, scenes, drafts), reading:false, readOnly:false, onRead:noop, readCost:cost });
  const t = textOf(tree);
  assert.match(t, /6 facts from the script/);
  assert.match(t, /Distinguishing marks/); assert.match(t, /missing two fingers on the left hand/); assert.match(t, /“His left hand is missing two fingers\.”/);
  assert.match(t, /dialogue/, "the weak fact is marked");
  assert.equal(textOf(findAll(tree, n=>n.type==="button").pop()), "Re-read");
  // the script changed: said, and the button says Re-read the script
  const changed = DRAFTS(); changed.s1.blocks[2].text = "His hands are steady.";
  tree = W.CharScriptFactsPanel({ c, drafts:changed, state:W.charFactsState(c, scenes, changed), reading:false, readOnly:false, onRead:noop, readCost:cost });
  assert.match(textOf(tree), /5 facts from the script · the script changed since it was read · 1 no longer in the script/);
  assert.equal(textOf(findAll(tree, n=>n.type==="button").pop()), "Re-read the script");
  // view-only: no button
  tree = W.CharScriptFactsPanel({ c:KAI, drafts, state:W.charFactsState(KAI, scenes, drafts), readOnly:true, onRead:noop });
  assert.equal(findAll(tree, n=>n.type==="button").length, 0);
});
await test("D5 the script-change banner: one button re-reads, then it offers Re-draft look / Keep this look; nothing on its own", ()=>{
  const i = art.indexOf("SCRIPT CHANGED (owner-approved 2026-10-12"), b = art.slice(i, i+4200);
  assert.ok(i>0);
  assert.ok(b.includes('"Script changed \\u2014 re-read and re-draft"'));
  assert.ok(b.includes('"Script re-read \\u2014 re-draft the look?"'));
  assert.ok(b.includes("onClick:()=>{ setReReadOffer(true); onReadScript(); }"));
  assert.ok(b.includes('"Re-read the script")'));
  assert.ok(b.includes("onClick:()=>{ setReReadOffer(false); onDraft(c); }"));
  assert.ok(b.includes("onClick:()=>{ setReReadOffer(false); onUpdate(c.id, { lookScriptSig:fst.sig }); }"));
  assert.ok(b.includes('"Keep this look"'));
  assert.ok(b.includes("if(readOnly || !drafted) return null;"));
  assert.ok(b.includes("(writing credits). Then you choose whether to re-draft the look."));
  // the card's Draft & generate says it reads first, with its price
  assert.ok(art.includes('draftNote:(onReadScript && fst.needsRead) ? " \\u2014 it reads the script for "+(c.name||"this character")+" first ("+readCost+")." : "",'));
  assert.ok(art.includes('then generates the sheet in one step (image credits)"+(draftNote||"")'));
});

/* ═══ E — the Script check ═══ */
await test("E1 what a sheet is checked against: action facts; wardrobe/injuries only for a variant's scene; not the writer's rows; not the face under a likeness", ()=>{
  const c = { ...KAI_READ() };
  c.scriptFacts = { ...c.scriptFacts, facts:[...c.scriptFacts.facts,
    { field:"wardrobe", value:"grey boiler suit", quote:"in a grey boiler suit", sceneId:"s2", sceneNo:2, block:2 },
    { field:"injury", value:"a fresh cut over the right eye", quote:"A fresh cut over his right eye.", sceneId:"s2", sceneNo:2, block:2 },
    { field:"marks", value:"koi tattoo on the right forearm", quote:"a faded koi tattoo on his right forearm", sceneId:"s4", sceneNo:4, block:1 }] };
  const f = (o)=> J(W.charFidelityFacts(c, { drafts, ...o }).map(x=>x.field+":"+x.value));
  assert.deepEqual(f({}), ["age:60s","heritage:Filipino","build:wiry","marks:missing two fingers on the left hand","marks:scarred knuckles","marks:koi tattoo on the right forearm"]);
  assert.deepEqual(f({ sceneId:"s2" }).filter(x=>/^(wardrobe|injury):/.test(x)), ["wardrobe:grey boiler suit","injury:a fresh cut over the right eye"]);
  assert.deepEqual(f({ sceneId:"s4" }).filter(x=>/^(wardrobe|injury):/.test(x)), [], "another scene's wardrobe isn't this variant's");
  assert.deepEqual(f({ likeness:true }), ["build:wiry","marks:missing two fingers on the left hand","marks:scarred knuckles","marks:koi tattoo on the right forearm"]);
  assert.ok(!W.charFidelityFacts({ ...c, scriptOverrides:{ age:{ at:"x" } } }, { drafts }).some(x=>x.field==="age"));
  assert.deepEqual(J(W.charFidelityFacts(KAI, { drafts })), []);
});
await test("E2 the vision call: the facts with their quotes, sides from the character's own view, spec right or wrong", async ()=>{
  const box = { console, JSON, Object, Array, String, Number, Math, Promise, RegExp, Error };
  box.window = box; vm.createContext(box);
  let sent = null, vision = true;
  Object.assign(box, { turnDownscaleDataUrl:async (u)=>"data:image/jpeg;base64,AAA", extractJSON:aiBox.extractJSON, scrubBrand:(s)=>String(s||""), clipWords:(s,n)=>String(s||"").slice(0,n),
    aiVisionComplete:async (messages, images)=>{ sent = { prompt:messages[0].content, images };
      return { vision, text:JSON.stringify({ results:[{ n:1, status:"ok" }, { n:2, status:"mismatch", issue:"the missing fingers are on the RIGHT hand", specOk:true },
        { n:3, status:"mismatch", issue:"looks mid 30s", specOk:false, specFix:"60s, weathered" }, { n:4, status:"unclear" }, { n:9, status:"mismatch" }] }) }; } });
  // (2026-10-27) the rules and the fact lines are shared with the QA check, which reads them in the same image read
  vm.runInContext(between(ai, "function _fidelityFactLines(facts){", "async function aiImageQA(item){")
    + between(ai, "async function aiCharacterFidelityCheck(item){", "window.aiCharacterFidelityCheck = aiCharacterFidelityCheck;")+"; window.aiCharacterFidelityCheck = aiCharacterFidelityCheck;", box);
  const facts = [{ field:"build", value:"wiry", quote:"wiry", sceneNo:1 }, { field:"marks", value:"missing two fingers on the left hand", quote:"His left hand is missing two fingers.", sceneNo:1 },
    { field:"age", value:"60s", quote:"(60s", sceneNo:1 }, { field:"marks", value:"koi tattoo", quote:"koi tattoo", sceneNo:4 }];
  const r = await box.aiCharacterFidelityCheck({ name:"Kai Reyes", url:"https://x/sheet.png", facts, spec:{ apparent_age:"30s" } });
  assert.match(sent.prompt, /SCRIPT CONTINUITY checker/);
  assert.match(sent.prompt, /2\. marks: missing two fingers on the left hand — Sc 1: "His left hand is missing two fingers\."/);
  assert.match(sent.prompt, /Sides are the CHARACTER'S own left and right/);
  assert.match(sent.prompt, /Judge ONLY what the facts state — never taste/);
  assert.match(sent.prompt, /"apparent_age":"30s"/);
  assert.equal(sent.images.length, 1);
  assert.equal(r.verdict, "mismatch"); assert.equal(r.mismatches.length, 2); assert.equal(r.ok, 1); assert.equal(r.unclear.length, 1); assert.equal(r.checked, 4);
  assert.deepEqual(J(r.mismatches[0]), { fact:facts[1], issue:"the missing fingers are on the RIGHT hand", specOk:true, specFix:"" });
  assert.equal(r.mismatches[1].specOk, false); assert.equal(r.mismatches[1].specFix, "60s, weathered");
  vision = false;
  assert.deepEqual(J(await box.aiCharacterFidelityCheck({ name:"K", url:"u", facts })), { unsupported:true });
  assert.equal(await box.aiCharacterFidelityCheck({ name:"K", url:"u", facts:[] }), null);
});
await test("E3 'Apply to spec' writes the field the sheet reads (physique row, features, height, wardrobe, a plain body)", ()=>{
  const c = { ...KAI, physique:{ age:"30s", build:"wiry" }, coreBody:"Apparent age: 30s. Body type: wiry.", scriptFeatures:"Scarred knuckles." };
  const a = W.charFidelityFixPatch(c, "age", "60s, weathered");
  assert.equal(a.physique.age, "60s, weathered"); assert.match(a.coreBody, /^Apparent age: 60s, weathered\. Body type: wiry\.$/);
  assert.deepEqual(J(W.charFidelityFixPatch(c, "marks", "missing two fingers on the left hand")), { scriptFeatures:"Scarred knuckles. missing two fingers on the left hand." });
  assert.deepEqual(J(W.charFidelityFixPatch(c, "marks", "scarred knuckles")), {}, "already there");
  assert.deepEqual(J(W.charFidelityFixPatch(c, "height", "185 cm")), { height:"185 cm" });
  assert.deepEqual(J(W.charFidelityFixPatch({ ...c, wardrobeMask:"coat" }, "wardrobe", "grey boiler suit")), { wardrobeMask:"grey boiler suit" });
  assert.deepEqual(J(W.charFidelityFixPatch({ id:"t", coreBody:"Tall." }, "age", "60s")), { coreBody:"Tall. Apparent age: 60s." });
  assert.deepEqual(J(W.charFidelityFixPatch(c, "injury", "a cut")), {});
});
await test("E4 the report: each mismatch with the quote it breaks; Apply to spec where the spec is wrong, Regenerate where it's right", ()=>{
  const c = { ...KAI, physique:{ age:"30s" }, coreBody:"Apparent age: 30s." };
  const report = { verdict:"mismatch", checked:3, ok:1, unclear:[{ field:"marks", value:"koi tattoo" }], mismatches:[
    { fact:{ field:"marks", value:"missing two fingers on the left hand", quote:"His left hand is missing two fingers.", sceneNo:1 }, issue:"the missing fingers are on the RIGHT hand", specOk:true, specFix:"" },
    { fact:{ field:"age", value:"60s", quote:"(60s", sceneNo:1 }, issue:"looks mid 30s", specOk:false, specFix:"60s, weathered" }] };
  const applied = []; let regen = 0, closed = 0;
  const tree = W.CharacterScriptCheckReport({ c, name:"Kai Reyes", noun:"character sheet", report, gening:false, onClose:()=>closed++, onApply:(p)=>applied.push(p), onRegen:()=>regen++, regenCost:undefined });
  const t = textOf(tree);
  assert.match(t, /The script says “His left hand is missing two fingers\.” — the sheet: the missing fingers are on the RIGHT hand\./);
  assert.match(t, /The spec already says it — the image missed it: regenerate\./);
  assert.match(t, /2 mismatches/); assert.doesNotMatch(t, /vision read/, "no cost note at the foot of the window (owner 2026-11-17)"); assert.match(t, /Not visible in any view/);
  const btns = findAll(tree, n=>n.type==="button");
  const apply = btns.find(b=>textOf(b)==="Apply to spec");
  apply.props.onClick();
  assert.equal(applied.length, 1); assert.equal(applied[0].physique.age, "60s, weathered");
  const re = btns.find(b=>/^Regenerate/.test(textOf(b)));
  assert.ok(findAll(re, n=>n.type==="chip").length===1, "the regenerate price is shown");
  re.props.onClick(); assert.equal(regen, 1); assert.equal(closed, 1);
  // a variant: its wardrobe isn't written to the master's spec
  const v = W.CharacterScriptCheckReport({ c, name:"Kai · Street", noun:"variant sheet", report:{ checked:1, mismatches:[{ fact:{ field:"wardrobe", value:"grey boiler suit", quote:"in a grey boiler suit", sceneNo:2 }, issue:"a suit", specOk:false, specFix:"grey boiler suit" }] },
    variant:true, onClose:noop, onApply:noop, onRegen:noop });
  assert.ok(!findAll(v, n=>n.type==="button").some(b=>textOf(b)==="Apply to spec"));
  assert.match(textOf(v), /Fix it in this variant's change text/);
  // clean
  assert.match(textOf(W.CharacterScriptCheckReport({ c, report:{ checked:4, mismatches:[] }, onClose:noop, onRegen:noop })), /Matches the script — nothing to fix\./);
});
await test("E5 the button: next to QA check on the sheet and on each variant; says why it can't run; quotes the vision read", ()=>{
  const gen = { genUrl:"https://x/s.png", gening:false, generate:noop };
  let tree = W.ScriptCheckButton({ gen, c:KAI, drafts });
  let b = findAll(tree, n=>n.type==="button")[0];
  assert.equal(b.props.disabled, true); assert.match(b.props.title, /^Read the script for Kai Reyes first/);
  tree = W.ScriptCheckButton({ gen, c:KAI_READ(), drafts });
  b = findAll(tree, n=>n.type==="button")[0];
  assert.equal(b.props.disabled, false); assert.equal(textOf(b), "Script check");
  assert.match(b.props.title, /\(5 facts: age, build, marks with their side and place…\)[^]*One vision read \(writing credits, no image spend\)\.$/);
  assert.equal(W.ScriptCheckButton({ gen:{ genUrl:"" }, c:KAI_READ(), drafts }), null, "no image, no check");
  // (owner 2026-10-27) the cards no longer show it: the QA check reads the screenplay in the same read
  assert.ok(!art.includes("React.createElement(ScriptCheckButton,{"), "no Script check button on the cards");
  assert.ok(art.includes('script:{ c, drafts, onUpdate:readOnly ? null : onUpdate } })'));
  assert.ok(art.includes('script:{ c, drafts, sceneId:st.sceneId||"", variantLabel:(st.label||vtag) } })'));
  assert.ok(art.includes("rep = await window.aiCharacterFidelityCheck({ name:c.name, url:gen.genUrl, facts, spec:charQaSpecFields(c, { likeness:lk }), variant:variantLabel||\"\" });"));
  assert.ok(ai.includes("const res = await aiVisionComplete([{ role:\"user\", content:prompt }], [img]);\n  if(!res.vision) return { unsupported:true };\n  const j = extractJSON(res.text);\n  if(!j || !Array.isArray(j.results)) return null;"),
    "the QA check's paid vision path");
});

/* ═══ F — the flows read first and quote it ═══ */
await test("F1 Draft & generate and Draft all read the script first for whoever needs it, then draft from it", ()=>{
  const d = between(app, "const draftCharacterVisuals = async (ch)=>{", "// Generate a character's MASTER sheet headlessly");
  assert.ok(d.indexOf("if(_needsFactRead(ch)){ const fp = await readCharacterFacts([ch], { quiet:true }); if(fp && fp[ch.id]) ch = { ...ch, ...fp[ch.id] }; }")
    < d.indexOf("await aiCharacterVisuals(ch, driven"), "read, then draft");
  const all = between(app, "const draftAllVisuals = async ()=>{", "// ---- Art Room: LOOKBOOK (References) ----");
  assert.ok(all.includes('const toRead = (typeof _needsFactRead==="function") ? targets.filter(_needsFactRead) : [];'));
  assert.ok(all.indexOf("await readCharacterFacts(toRead, { quiet:true });") < all.indexOf("await aiCastVisualBible(drafting, scenes"));
  const rf = between(app, "const readCharacterFacts = async (list, o)=>{", "// a draft reads the script first");
  assert.ok(rf.includes("if(!r || castDraftFilmKey()!==filmAtStart) return null;"), "film-fenced");
  assert.ok(rf.includes("window.charFactsReadPatch(c, facts, { sig:window.charScriptSig(c, curScenes, curDrafts), partial:r.failures.length>0, by:r.by })"));
  assert.ok(rf.includes('" \\u2014 drafting from the script excerpt instead."'));
  // the tab and the card buttons
  assert.ok(app.includes("readCharacterFacts(Array.isArray(ids) ? (characters||[]).filter(c=>c && ids.indexOf(c.id)>=0) : (characters||[])); },"));
  assert.ok(art.includes("onReadScript:onReadCharacterScript,readingFactIds,"));
  assert.ok(art.includes("onReadScript:(onReadScript && scriptReady) ? (()=>onReadScript([c.id])) : null, readingFacts:readingIds.indexOf(c.id)>=0,"));
  // (owner 2026-10-29) the tab's "Read the script" went: drafting reads it when needed, and each card keeps its Re-read
  assert.ok(!art.includes('"data-testid":"char-read-script-all"'));
  assert.ok(art.includes('" It reads the script first for "+draftReaders.length+" character"'), "Draft all quotes it");
});
// the Casting Director, lifted from agents.jsx
const agentBox = { console, JSON, Object, Array, String, Number, Math, Promise, RegExp, Error, Set };
agentBox.window = agentBox; vm.createContext(agentBox);
agentBox.turnWritingCallsText = W.turnWritingCallsText;
vm.runInContext(between(agentsSrc, "function agentErrText(e){", "\n}\n")+"\n}\n"+between(agentsSrc, "async function agentCastingDirector(ctx){", "/* =========================================================\n   WEAR PROPS")+"; window.agentCastingDirector = agentCastingDirector;", agentBox);
const runCD = async ({ list, fidelity=false, readFails=false, check=null, needs=(c)=>!c.scriptFacts } = {})=>{
  const log = [], steps = [], drafted = new Set();
  const cast = { list,
    isDrafted:(c)=> drafted.has(c.id) || !!c.coreBody,
    imageOf:async ()=> "",
    needsFacts:needs, factCalls:(l)=> l.length ? 1 : 0,
    readFacts:async (l)=>{ log.push("read:"+l.map(c=>c.id).join(",")); if(readFails) throw new Error("Not enough credits");
      const out = {}; l.forEach(c=>{ out[c.id] = { scriptFacts:{ facts:[{ field:"age", value:"60s", quote:"(60s", sceneId:"s1", sceneNo:1 }], scriptSig:"cs-1" } }; }); return out; },
    draftSpec:async (c)=>{ log.push("draft:"+c.id+(c.scriptFacts?"+facts":"")); drafted.add(c.id); return { coreBody:"x", wardrobeMask:"y" }; },
    suggestStates:async ()=>null,
    generateMaster:async (c)=>{ log.push("sheet:"+c.id); return "https://x/"+c.id+".png"; },
    generateState:async ()=>"",
    fidelityCheck:async (c, url)=>{ log.push("check:"+c.id+(c.scriptFacts?"+facts":"")); return check ? check(c) : { mismatches:[] }; } };
  await agentBox.agentCastingDirector({ art:{ cast }, ai:{ available:true }, castFidelity:fidelity, castVariants:false,
    cancelled:()=>false, emit:(e)=>steps.push(e) });
  return { log, steps };
};
await test("F2 the Casting Director reads the script FIRST (one batch, only the looks it drafts), says it in its plan, drafts from it", async ()=>{
  const done = { id:"old", name:"Old Hand", coreBody:"drafted", pronouns:"he/him" };
  const r = await runCD({ list:[{ ...KAI }, { ...MARA }, done] });
  assert.deepEqual(r.log, ["read:kai,mara", "draft:kai+facts", "sheet:kai", "draft:mara+facts", "sheet:mara", "sheet:old"]);
  const plan = r.steps.find(s=>s.k==="plan").t;
  assert.match(plan, /first read the screenplay for what it states about 2 characters \(about 1 writing call on Opus 5\.5\); then for each of the 3 characters/);
  assert.ok(!/check it against the script/.test(plan), "the Script check is off unless chosen");
  assert.ok(r.steps.some(s=>s.k==="ok" && s.t==="Screenplay read — 2 facts about 2 characters, each with its quote. They lead the looks."));
  assert.ok(!r.log.some(x=>/^check:/.test(x)));
  // nothing to read: no read step, no plan clause
  const r2 = await runCD({ list:[{ ...KAI, scriptFacts:{ facts:[] } }] });
  assert.ok(!r2.log.some(x=>/^read:/.test(x))); assert.ok(!/first read the screenplay/.test(r2.steps.find(s=>s.k==="plan").t));
  // a failed read is said; the looks are still drafted
  const r3 = await runCD({ list:[{ ...KAI }], readFails:true });
  assert.ok(r3.steps.some(s=>s.k==="flag" && s.t==="Couldn't read the screenplay (Not enough credits) — the looks are drafted from the script excerpt instead."));
  assert.deepEqual(r3.log, ["read:kai", "draft:kai", "sheet:kai"]);
});
await test("F3 the optional Script check after each new master: in the plan with its cost, mismatches listed with their quotes, nothing changed", async ()=>{
  const r = await runCD({ list:[{ ...KAI }, { ...MARA }], fidelity:true, check:(c)=> c.id==="kai"
    ? { mismatches:[{ fact:{ quote:"His left hand is missing two fingers." }, issue:"the fingers are missing on the right hand" }] } : { mismatches:[] } });
  assert.match(r.steps.find(s=>s.k==="plan").t, /generate the master sheet \(with prop \+ likeness references\), check it against the script \(one vision read each, writing credits\)/);
  assert.deepEqual(r.log, ["read:kai,mara", "draft:kai+facts", "sheet:kai", "check:kai+facts", "draft:mara+facts", "sheet:mara", "check:mara+facts"]);
  assert.ok(r.steps.some(s=>s.k==="flag" && s.t==="Kai Reyes's sheet doesn't match the script: the script says “His left hand is missing two fingers.” — the fingers are missing on the right hand. Open Script check on the card to fix it."));
  assert.ok(r.steps.some(s=>s.k==="ok" && s.t==="Mara Lin's sheet matches the script."));
  assert.ok(r.steps.some(s=>s.k==="flag" && s.t==="1 sheet doesn't match the script — each card's Script check lists what differs and offers the fix."));
  // no fact sheet / nothing to show → skipped, said
  const r2 = await runCD({ list:[{ ...KAI, scriptFacts:{ facts:[] } }], fidelity:true, check:()=>null });
  assert.ok(r2.steps.some(s=>s.k==="observe" && /nothing in the script to check the sheet against/.test(s.t)));
  // the app passes it through from Design the cast's preview
  assert.ok(app.includes("castFidelity: !!(castScope && castScope.fidelity),"));
  assert.ok(app.includes("fidelity:!!(scope && scope.fidelity) });"));
  assert.ok(app.includes("readFacts: async (list)=> readCharacterFacts(list, { silent:true, throwErrors:true }),"));
  assert.ok(agentsSrc.includes("It uses writing credits to read the screenplay for the looks it drafts"));
});
await test("F4 Design the cast's preview: the read is a priced line; the Script check is an option with its own line", ()=>{
  W.charVisualsDrafted = W.charVisualsDrafted || (()=>false);
  let confirmed = null;
  const tree = W.CastConfirm({ characters:[{ ...KAI }, { ...MARA, scriptFacts:{ facts:[], scriptSig:W.charScriptSig(MARA, scenes, drafts) } }], props:[], scenes, drafts,
    onCancel:noop, onConfirm:(x)=>{ confirmed = x; }, onSetPronouns:noop });
  const t = textOf(tree);
  assert.match(t, /Read the script first \(1 character\)1 writing call · writing credits/);
  assert.match(t, /Check each new master sheet against the script \(one vision read each, writing credits\)/);
  const go = findAll(tree, n=>n.type==="button").find(b=>/^Design 2 characters/.test(textOf(b)));
  go.props.onClick();
  assert.equal(confirmed.fidelity, false, "off unless chosen");
  // chosen: its own line, and the run is told
  stateOverrides.push("missing", true, true);
  const t2 = W.CastConfirm({ characters:[{ ...KAI }], props:[], scenes, drafts, onCancel:noop, onConfirm:(x)=>{ confirmed = x; } });
  assert.match(textOf(t2), /Script checks of the new sheets1 vision read · writing credits/);
  findAll(t2, n=>n.type==="button").find(b=>/^Design 1 character/.test(textOf(b))).props.onClick();
  assert.equal(confirmed.fidelity, true);
  // the preview gets the screenplay
  assert.ok(app.includes("characters, props, scenes, drafts, sceneId:castConfirm.sceneId,"));
});

/* ═══ G — Frances, the doc, the names ═══ */
await test("G1 Frances knows (a dated block just before the public view)", ()=>{
  const i = ai.indexOf("CHARACTER FIDELITY, steps 2 · 4 · 6 (owner-approved 2026-10-12)"), j = ai.indexOf("/* the public view of every entry, memoised");
  assert.ok(i>0 && j>i);
  const block = ai.slice(i, j);
  for(const s of ["'Read the script'", "'From the script'", "'From the likeness'", "'Designed'", "'Changed by you'", "change it anyway?", "'Script check'",
    "'Apply to spec'", "'Regenerate'", "'Script changed \\u2014 re-read and re-draft'", "'Re-draft look'", "'Keep this look'", "Design the cast's preview"])
    assert.ok(block.includes(s), "Frances: "+s);
  for(const n of ["Character Sheets (Art Room)","QA check (per-card image QC, Art Room)","Draft all (batch spec drafters, Art Room)"]){
    assert.ok(block.includes('x.name==="'+n+'"')); assert.ok(ai.includes('name:"'+n+'"'), "the entry exists: "+n); }
  assert.ok(!/\bTURN\b|McKee|Anthropic|Claude|Cinema Machine|MUSE/.test(block.replace(/\/\*[^]*?\*\//g,"")), "no internal or vendor names");
});
await test("G2 the pipeline doc: a dated, owner-approved note in step 9 only", ()=>{
  const s9 = doc.indexOf("### 9. Pre-production"), s10 = doc.indexOf("### 10.", s9);
  const n = doc.indexOf("*(approved 2026-10-12 by owner — Character fidelity");
  assert.ok(n>s9 && (s10<0 || n<s10));
  assert.match(doc.slice(n, n+1400), /\*\*The script\s+is read first\*\*[^]*\*\*Script check\*\*[^]*Script changed —\s*re-read and re-draft/);
});
await test("G3 the new user-facing copy names no vendor, no internal codename", ()=>{
  const lits = [];
  const src = between(art, "/* ═══ CHARACTER FIDELITY, steps 2 · 4 · 6", "window.CharScriptFactsPanel = CharScriptFactsPanel;")
    + between(art, "/* ---- THE SCRIPT CHECK (owner-approved", "window.ScriptCheckButton = ScriptCheckButton;")
    + between(agentsSrc, "CHARACTER FIDELITY (owner-approved 2026-10-12). Step 2", "let specs=0, sheets=0, variants=0");
  src.replace(/"((?:[^"\\]|\\.)*)"/g, (m, s)=>{ lits.push(s); return m; });
  const bad = lits.filter(s=> /\bTURN\b|McKee|Anthropic|Claude|Gemini|OpenAI|Cinema Machine|\bMUSE\b/.test(s));
  assert.deepEqual(bad, []);
});

console.log("\n"+passes+" passed, "+failures+" failed");
if(failures) process.exit(1);

#!/usr/bin/env node
/* test-round1-ai.mjs — Round 1 fixes to the AI layer, MUSE and the proxy (2026-09-28).

   Runs the REAL app files (formats, frameworks, contract, scene-order, story-data, spine, script,
   artroom, ai) in node:vm with a stubbed window.claude.complete that records every prompt (no
   network, no model, no Supabase), plus the proxy's pure helper, and proves:
     A. DOCUMENTARY BEATS — beat authoring, beats-from-script and driver recast carry the
        real-subject grounding rule and the format line for a documentary, never the five steps
        / write-from-within; every fictional format's prompt is byte-identical to before the round (193deaa).
     B. SPINE + STORY WORLD — a spine whose opening (or closing) half fails twice is refused with
        a plain reason, never a half-film; a short spine says so; the story-world build retries
        once. aiCastPsychology reports which characters failed (report.failedIds).
     C. MUSE FACTS — nothing MUSE is told names an AI vendor, an engine family or server setup,
        or talks billing; the entries whose how-to lived there keep a vendor-free lead; the
        reply pass turns stray vendor names into neutral words BEFORE scrubBrand, so no false
        "Infinite Studio" claim; APP_FEATURES itself is untouched (single source of truth).
     D. MUSE SIZE — each question's prompt is at least 75% smaller than the old full prompt
        (measured against 193deaa), keeps every protocol rule, carries the relevant
        entries in full, and the chat trims itself under the proxy's MUSE ceiling.
     E. PROXY — only a real MUSE call rides the free path (pinned model, text only, MUSE-sized,
        user/assistant turns only, within a daily allowance, a capped reply); anything else
        labelled "muse" is metered; index.ts is wired through the helper.
     F. The protocol doc and the prompt agree.
   node scripts/test-round1-ai.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import { createRequire } from "node:module";
import { MUSE_LIMITS, MUSE_MODEL, MUSE_MODELS, museAllowanceSince, museMessagesSize, museRefusal, textBillingKind }
  from "../supabase/functions/image-proxy/muse-billing.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const { transformSync } = createRequire(ROOT + "package.json")("@babel/core");
const read = (f)=>readFileSync(ROOT + f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,6).join("\n    ")); }
};

/* ---------------- sandbox: the real app files (current, and ai.jsx before this round) ---------------- */
const noop = ()=>{};
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const ReactStub = new Proxy({
  createElement:h, Fragment:"frag",
  useState:(x)=>[typeof x==="function" ? x() : x, noop], useRef:(x)=>({ current:x }), useEffect:noop,
  useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f, memo:(f)=>f, forwardRef:(f)=>f,
  createContext:()=>({ Provider:"provider" }), useContext:()=>null,
}, { get:(t,k)=> (k in t) ? t[k] : noop });
const asShipped = (src, f)=>transformSync(src, { plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename:f }).code;
function sandbox(aiSource){
  const store = new Map();
  const box = {
    console:{ ...console, warn:noop, info:noop }, clearTimeout, setInterval, clearInterval,
    setTimeout:(f)=>setTimeout(f, 0),
    React:ReactStub, ReactDOM:new Proxy({}, { get:()=>noop }),
    Icon:new Proxy({}, { get:(t,k)=>{ const f = ()=>null; f.iconName = String(k); return f; } }),
    localStorage:{ getItem:(k)=>store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k,String(v)), removeItem:(k)=>store.delete(k) },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    Image:class {},
    document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop, classList:{ add:noop, remove:noop } }),
      getElementById:()=>null, addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], createTextNode:()=>({}),
      body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  box.__replies = []; box.__prompts = [];
  box.appToast = noop; box.appConfirm = async ()=>true;
  // installed BEFORE ai.jsx, so its proxy shim is skipped; every prompt is recorded
  box.claude = { complete: async (o)=>{ box.__prompts.push(String(o.messages[0].content)); const r = box.__replies.shift(); if(r instanceof Error) throw r; return r == null ? "" : r; } };
  vm.createContext(box);
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx",
    "app/spine.jsx","app/script.jsx","app/artroom.jsx","app/ai.jsx"]){
    const src = f==="app/ai.jsx" ? aiSource : read(f);
    vm.runInContext(f==="app/script.jsx"||f==="app/artroom.jsx" ? asShipped(src, f) : src, box, { filename:f });
  }
  box.console = { ...console, warn:noop, info:noop, log:noop };
  box.__store = store;
  return box;
}
const box = sandbox(read("app/ai.jsx"));
// the "before" is pinned to the commit this round started from (193deaa), so the comparison stays
// meaningful after Round 1 is committed
const BEFORE = "193deaa";
let headAi = null;
try{ headAi = execSync("git show "+BEFORE+":app/ai.jsx", { cwd:ROOT, encoding:"utf8", maxBuffer:64*1024*1024, stdio:["ignore","pipe","ignore"] }); }catch(e){}
const old = headAi ? sandbox(headAi) : null;
const reset = (b)=>{ b.__replies = []; b.__prompts = []; b.turnCast = undefined; b.turnContinuity = undefined; };
const plain = (x)=>JSON.parse(JSON.stringify(x));

/* ---------------- fixtures ---------------- */
const CAST = [{ id:"isamu", name:"Isamu" }, { id:"hana", name:"Hana" }];
const mkScenes = (n)=>Array.from({ length:n }, (_, i)=>({ id:"s"+(i+1), no:i+1, act:i<n/4?1:i<3*n/4?2:3, title:"Scene "+(i+1),
  loc:"INT. WORKSHOP - DAY", driver:"isamu", summary:"Isamu pockets the tape measure.", objective:"to keep it",
  openValue:"Trust", openCharge:1, closeValue:"Suspicion", closeCharge:-1 }));
const BEATS = { driverLabel:"Isamu", reactorLabel:"Hana", turnAt:2, desire:"to keep it", obstacle:"to expose him", rows:[
  { n:1, drive:{ a:"Arrives", d:"Isamu steps in early." }, react:{ a:"Watches", d:"Hana watches." } },
  { n:2, drive:{ a:"Pockets", d:"He pockets the tape measure." }, react:{ a:"Notices", d:"Hana sees the empty hook." } },
]};
const DRAFT = { blocks:[{ beat:1, type:"action", text:"Isamu slides the door open." }, { beat:2, type:"action", text:"He pockets the tape measure." }] };
const AUTHOR_REPLY = JSON.stringify({ title:"x", beats:[{ drive:{a:"A",d:"d"}, react:{a:"R",d:"r"} }] });
const RECAST_REPLY = JSON.stringify({ summary:"s", objective:"o", desire:"d", antagonism:"a", result:"r",
  rows:[{ n:1, drive:{a:"A",d:"d"}, react:{a:"R",d:"r"} },{ n:2, drive:{a:"A",d:"d"}, react:{a:"R",d:"r"} }] });
const FROM_SCRIPT_REPLY = JSON.stringify({ driverLabel:"Isamu", reactorLabel:"Hana", beats:[{ n:1, drive:{a:"A",d:"d"}, react:{a:"R",d:"r"} }] });
async function beatPrompts(b, project){
  reset(b);
  const scenes = mkScenes(12);
  b.turnCast = CAST; b.turnProject = project;
  b.__replies.push(AUTHOR_REPLY);
  await b.aiAuthorScene(scenes[0], null, CAST, project, { scenes });
  b.__replies.push(AUTHOR_REPLY);
  await b.aiAuthorScene(scenes[1], scenes[0], CAST, project, { scenes, keepCard:true });
  b.__replies.push(FROM_SCRIPT_REPLY);
  await b.aiBeatsFromScript(scenes[0], DRAFT, CAST, project);
  b.__replies.push(RECAST_REPLY);
  await b.aiRecastDriver(scenes[0], BEATS, CAST, "hana", "isamu", project, {});
  return b.__prompts.slice();
}

/* ======================= A. documentary beats ======================= */
await test("A1 a documentary's beat authoring carries the grounding rule and its format line, never the five steps / write-from-within", async ()=>{
  const p = await beatPrompts(box, { title:"Salt", format:"documentary", framework:"threeact", logline:"The last salt-pan workers of Aveiro." });
  assert.equal(p.length, 4);
  for(const i of [0,1]){
    assert.ok(p[i].includes("REAL SUBJECTS (this is a DOCUMENTARY)") && p[i].includes("BEATS FROM THE RECORD"), "author prompt "+i+" is grounded");
    assert.ok(p[i].includes("FORMAT: THIS IS A DOCUMENTARY"), "author prompt "+i+" carries the documentary format line");
    assert.ok(!/WRITE FROM WITHIN|FIVE STEPS OF BEHAVIOR|CHOOSES a fresh tactic|if I were this person/.test(p[i]), "no invention stance in author prompt "+i);
    assert.ok(p[i].includes("what the record shows the driver pursuing") && p[i].includes("observed action, testimony or archive"), "the JSON asks for the record");
  }
  assert.ok(p[2].includes("REAL SUBJECTS") && p[2].includes("ONLY from what this script's testimony"), "beats-from-script is grounded");
  assert.ok(p[3].includes("REAL SUBJECTS") && p[3].includes("BEATS FROM THE RECORD"), "the driver recast is grounded");
});
await test("A2 fictional formats: every beat prompt is byte-identical to before this round (feature, short, commercial, music video)", async ()=>{
  assert.ok(old, "git "+BEFORE+":app/ai.jsx is readable");
  for(const format of ["feature","film","commercial","musicvideo","microdrama"]){
    const P = { title:"T", format, framework:"threeact", logline:"A welder retraces a convoy route." };
    // deliberate later edits to the shared prompt text are applied to the baseline first, so this
    // still proves Round 1 itself left fiction alone (2026-10-03: a they/them character keeps their pronouns)
    const later = (x)=> String(x)
      .replace("NEVER singular \u201cthey/them\u201d for an individual (ambiguous on the page and for image/video models); plural",
        "NEVER singular \u201cthey/them\u201d for an individual (ambiguous on the page and for image/video models) unless the cast list gives that person they/them; plural")
      .replace("never singular they/them for an individual. ", "never singular they/them for an individual unless the cast list gives that person they/them. ")
      .replace("NEVER singular they/them for an individual; plural they only for true groups.", "NEVER singular they/them for an individual unless this list gives that person they/them; plural they only for true groups.");
    const now = await beatPrompts(box, P), was = (await beatPrompts(old, P)).map(later);
    assert.equal(now.length, was.length);
    now.forEach((x,i)=>assert.equal(x, was[i], format+" prompt "+i+" changed"));
    assert.ok(now.every(x=>!/REAL SUBJECTS|BEATS FROM THE RECORD/.test(x)), format+" never sees the documentary rule");
  }
});

/* ======================= B. spine, story world, psychology report ======================= */
const half = (from, n, act)=>JSON.stringify({ title:"The Cold Seam", scenes:Array.from({ length:n }, (_,i)=>({ a:act(from+i), t:"Scene "+(from+i),
  l:"INT. ROOM - NIGHT", s:"x", d:"nadia", vp:"Hope", vn:"Despair", oc:1, cc:-1, cl:2 })) });
const act16 = (n)=> n<=4 ? 1 : n<=12 ? 2 : 3;
await test("B1 the opening half fails twice: nothing is built, the second half is never written blind, and the reason is plain", async ()=>{
  reset(box); box.turnProject = { format:"film", framework:"threeact" };
  box.__replies.push("", "", half(9, 8, act16));
  const spine = await box.aiBuildSpine("LOGLINE: A night-shift nurse…", "film", "threeact");
  assert.equal(spine, null);
  assert.equal(box.__prompts.length, 2, "only the two first-half attempts were sent");
  assert.match(String(box.__lastSpineFailure), /^The opening half of the spine \(the film's setup and title\) didn't come back after two tries, so nothing was built\. Run it again in a moment\.$/);
});
await test("B2 the closing half fails twice: no spine that stops at the midpoint", async ()=>{
  reset(box); box.turnProject = { format:"film", framework:"threeact" };
  box.__replies.push(half(1, 8, act16), "", new Error("service hiccup"));
  const spine = await box.aiBuildSpine("LOGLINE: A night-shift nurse…", "film", "threeact");
  assert.equal(spine, null);
  assert.equal(box.__prompts.length, 3);
  assert.match(String(box.__lastSpineFailure), /closing half of the spine \(the climax and ending\)/);
});
await test("B3 a short spine is still offered but says so; a full one carries no note", async ()=>{
  reset(box); box.turnProject = { format:"film", framework:"threeact" };
  box.__replies.push(half(1, 8, act16), half(9, 5, act16), half(9, 5, act16));
  const short = await box.aiBuildSpine("LOGLINE", "film", "threeact");
  assert.equal(short.scenes.length, 13);
  assert.deepEqual(plain(short.short), { got:13, want:16, note:"Built 13 of the 16 scenes this format aims for." });
  assert.equal(box.__lastSpineFailure, null);
  reset(box);
  box.__replies.push(half(1, 8, act16), half(9, 8, act16));
  const full = await box.aiBuildSpine("LOGLINE", "film", "threeact");
  assert.equal(full.scenes.length, 16); assert.equal(full.short, undefined); assert.equal(full.title, "The Cold Seam");
});
const WORLD = JSON.stringify({ genre:"drama", premise:"What if the salt stopped?", controllingIdea:{ value:"v", cause:"c", polarity:"ironic" },
  setting:{ period:"now", duration:"a week", location:"a salt pan", conflict:"personal" }, cast:[{ id:"nadia", name:"NADIA", role:"Protagonist — a nurse" }] });
await test("B4 the story-world build retries once (unreadable reply, thrown error), and fails only after two", async ()=>{
  reset(box);
  box.__replies.push("not json at all", WORLD);
  const w1 = await box.aiBuildStoryWorld("LOGLINE", { title:"T", scenes:[{ no:1, title:"a", driver:"nadia" }] }, "film");
  assert.equal(box.__prompts.length, 2); assert.equal(w1.premise, "What if the salt stopped?"); assert.equal(w1.cast[0].id, "nadia");
  reset(box);
  box.__replies.push(new Error("503"), WORLD);
  assert.ok(await box.aiBuildStoryWorld("LOGLINE", { scenes:[] }, "film"));
  assert.equal(box.__prompts.length, 2);
  reset(box);
  box.__replies.push("{}", "[]");
  assert.equal(await box.aiBuildStoryWorld("LOGLINE", { scenes:[] }, "film"), null, "an empty object is no world");
  assert.equal(box.__prompts.length, 2, "never a third call");
});
await test("B5 aiCastPsychology says which characters failed (report.failedIds) — [] means the pass ran", async ()=>{
  const cast = [{ id:"nadia", name:"Nadia", role:"Protagonist" }, { id:"omar", name:"Omar", role:"Antagonist" }];
  const scenes = [{ id:"s1", no:1, act:1, title:"a", driver:"nadia", openCharge:1, closeCharge:-1 }, { id:"s2", no:2, act:2, title:"b", driver:"omar", openCharge:-1, closeCharge:1 }];
  const P = { title:"T", format:"film", framework:"threeact", controllingIdea:{} };
  reset(box);
  box.__replies.push("garbage", "garbage");
  const rep = {};
  assert.equal(await box.aiCastPsychology(cast, scenes, P, { scenes, drafts:{}, cast, mode:"before", report:rep }), null);
  assert.deepEqual(plain(rep.failedIds).sort(), ["nadia","omar"]);
  assert.deepEqual(plain(box.__lastCastPsychology), { mode:"before", batches:1, failedIds:["nadia","omar"] });
  reset(box);
  box.__replies.push(JSON.stringify({ cast:[] }));
  const rec = {};
  assert.equal(await box.aiCastPsychology(cast, scenes, P, { scenes, drafts:{}, cast, mode:"reconcile", report:rec }), null, "nothing to revise");
  assert.deepEqual(plain(rec.failedIds), [], "…and the check did run");
  reset(box);
  box.__replies.push(JSON.stringify({ cast:[{ id:"nadia", conscious:"to keep the pan" }] }));
  const part = {};
  const out = await box.aiCastPsychology(cast, scenes, P, { scenes, drafts:{}, cast, mode:"before", report:part });
  assert.equal(out.nadia.conscious, "to keep the pan"); assert.deepEqual(plain(part.failedIds), ["omar"], "a character the answer left out is named");
});

/* ======================= C. MUSE facts ======================= */
const VENDOR = /anthropic|claude|openai|chatgpt|\bgpt|gemini|gemma|google|moonshot|kimi|\bopus\b|\bfable\b|sonnet|haiku|mythos|elevenlabs|\bfal\b|fal\.ai|supabase|stripe|bytedance|mckee/i;
const INFRA = /\bproxy\b|edge function|api keys?\b|_API_KEY|FAL_KEY|redeploy|server secret|\bsql\b|\brpc\b|max_completion_tokens|maxCompletionTokens|TEXT_CREDIT_RATES|turn_[a-z_]+|\.sql\b/i;
const BILLING = /\b(?:pricing|prices?|billing|checkout|subscriptions?|credits?|provider-cost|margin)\b|\$\d/i;
await test("C1 nothing MUSE is told names a vendor, an engine family or server setup, or talks billing (the whole fact sheet)", ()=>{
  const facts = box.museFacts();
  assert.ok(facts.length >= 90, "every feature is still there: "+facts.length);
  for(const f of facts){
    const t = f.name+": "+f.what;
    assert.ok(!VENDOR.test(t), f.name+" names a vendor: "+(t.match(VENDOR)||[])[0]);
    assert.ok(!INFRA.test(t), f.name+" describes server setup: "+(t.match(INFRA)||[])[0]);
    assert.ok(!BILLING.test(t), f.name+" talks billing: "+(t.match(BILLING)||[])[0]);
  }
  const brief = box.appBrief();
  assert.ok(!VENDOR.test(brief) && !INFRA.test(brief) && !BILLING.test(brief));
  for(const q of ["Which writing engine should I pick for a long feature?", "What powers the images?", "Do I need an API key?"]){
    const p = box.museSystemPrompt({ now:q }, null);
    const facts2 = p.slice(p.indexOf("ABOUT THIS APP"));
    assert.ok(!VENDOR.test(facts2) && !INFRA.test(facts2), q);
  }
});
await test("C2 the entries whose how-to lived in vendor sentences keep a vendor-free lead; the Stage render package now reaches MUSE", ()=>{
  const F = (n)=>box.museFacts().find(f=>f.name===n);
  assert.ok(F("Writing engine dock").what.startsWith("AUTO uses the studio's recommended writing engine for EVERY task"));
  assert.ok(F("Writing engine dock").what.includes("pins every drafting call to it for THIS SESSION"));
  // (2026-10-09, Writers' Room third pass) the groups are named for what the engines do, never the vendor
  assert.ok(F("Writing engine dock").what.includes("compact segmented buttons grouped by what the engines are good at (Story / Fast / Alternative / Long context)"), "the panel's layout survives, without the names");
  assert.ok(!/It is a (?:text\/reasoning|multimodal)/.test(F("Writing engine dock").what), "no orphan 'It is…' sentence about a dropped engine");
  assert.ok(F("Provider keys (no key needed)").what.startsWith("You never need a key or any setup"));
  assert.ok(F("Writing model (drafting & agents)").what.includes("default to the recommended engine (rich screen prose, strong long-form reasoning)"));
  assert.ok(F("The Stage (Production)").what.includes("lip-syncs to your line audio"), "the audio modes survive without the vendor");
  assert.ok(F("Generating images (Art Room)").what.includes("'Nano Banana 2 Lite'") && F("Generating images (Art Room)").what.includes("Sunburst (maximum precision and fidelity)"));
  assert.ok(F("Stage render package (timed plan, references, and take snapshots)"), "a 'timed plan' is not a billing plan");
  assert.equal(F("Plans & subscription (Writer / Director / Studio)"), undefined);
  assert.equal(F("A plan is required (no free tier)"), undefined);
  assert.ok(F("Dialogue pass (three spheres · exposition as ammunition · trialogue · line design · flaw diagnostic)").what.includes("weapons deployed in conflict"), "story words are not server words");
  // the source of truth is untouched: APP_FEATURES keeps its full wording
  const raw = box.APP_FEATURES.find(f=>f.name==="Writing engine dock").what;
  assert.ok(raw.includes("Opus 5.5") && raw.includes("MOONSHOT_API_KEY"));
  // derived, not forked: a new entry reaches MUSE with no second list to update
  box.APP_FEATURES.push({ name:"Round-1 probe feature", what:"A probe entry. Its second sentence names Anthropic. It has a third." });
  const probe = box.museFacts().find(f=>f.name==="Round-1 probe feature");
  assert.equal(probe.what, "A probe entry.", "the vendor sentence and the sentence leaning on it are dropped");
  box.APP_FEATURES.pop();
  assert.equal(box.museFacts().find(f=>f.name==="Round-1 probe feature"), undefined);
});
await test("C3 a stray vendor name in a reply becomes a neutral phrase before scrubBrand — never a false 'Infinite Studio' claim", ()=>{
  const s = "picking a specific model (Claude Fable 5.1 — Anthropic's newest flagship, deepest reasoning, slower —, Claude Opus 5.5 — the latest Opus —, Gemini 3.5 Flash, GPT-5.5, KIMI K3 — Moonshot's brand-new deep reasoner, GPT Image 2.5 Flare, GPT-6 Astra)";
  const out = box.scrubBrand(box.museScrubReply(s));
  assert.ok(!/Infinite Studio/.test(out), out);
  assert.ok(!VENDOR.test(out), out);
  assert.ok(out.includes("the selected engine — the provider's newest flagship"), out);
  // before this round the same text came back claiming the vendor's work ("Infinite Studio Fable 5.1 —
  // Infinite Studio's newest flagship"); since the Kinolot rebrand (2026-09-28) scrubBrand alone is neutral too
  const alone = box.scrubBrand(s);
  assert.ok(!/Infinite Studio/.test(alone) && alone.includes("the writing engine — the engine provider's newest flagship"), alone);
  // the method's author becomes the method's (rebranded) name
  // (review, 2026-09-28: "the method's", never "Infinite Studio AI's" — no authorship claim for the company)
  assert.equal(box.scrubBrand("Robert McKee's method"), "The Infinite Studio AI method");
  assert.equal(box.museScrubReply("Your fable about a Gemini-born sailor"), "Your fable about a Gemini-born sailor", "story words stay");
});

/* ======================= D. MUSE size and correctness ======================= */
const QUESTIONS = [
  ["Which writing engine should I pick for a long feature?", null, ["Writing engine dock"]],
  ["How do I export my screenplay as a PDF?", null, ["Export (screenplay / story)"]],
  ["How do I render a clip with dialogue?", { room:"stage" }, ["The Stage (Production)"]],
  ["Why is my shot card showing a continuity refresh note?", { room:"art", artView:"shots" }, ["Shots (Art Room)"]],
  ["How does the Board view work?", { room:"writers", view:"board" }, ["Board view"]],
  ["what does this tab do?", { room:"art", artView:"props" }, ["Props (Art Room)"]],
  ["How do I invite a collaborator?", null, ["Team collaboration"]],
  ["How do I start a new story?", null, ["New Story (format → seed → research → synopsis → spine)"]],
  ["How do the Agents work?", null, ["Story Editors (Writers' Room agents)"]],
  ["How do I lock a voice for a character?", null, ["Voice (on the character card)"]],
  ["How do I pick the Kishōtenketsu structure?", null, ["Narrative frameworks (Three-Act / Kishōtenketsu / Hero's Journey)"]],
  ["Can I undo an agent's changes?", { room:"writers", view:"spine" }, ["Undo agent changes"]],
  ["hi", null, []],
];
const detailNames = (p)=>((p.split("\n\nDETAILS")[1]||"").match(/\n• ([^\n]+?): /g)||[]).map(x=>x.slice(3,-2));
await test("D1 every question's prompt is at least 75% smaller than the old full prompt, and names the right features in full", ()=>{
  assert.ok(old, "git "+BEFORE+":app/ai.jsx is readable");
  const before = old.museSystemPrompt().length;
  let worst = 0;
  for(const [q, where, want] of QUESTIONS){
    const p = box.museSystemPrompt({ now:q }, where);
    worst = Math.max(worst, p.length);
    const got = detailNames(p);
    want.forEach(n=>assert.ok(got.includes(n), q+" → "+got.join(" | ")));
  }
  console.log("     MUSE prompt: before "+before+" chars (~"+Math.round(before/4)+" tokens) → worst after "+worst+" chars (~"+Math.round(worst/4)+" tokens), "+
    Math.round(100*(1-worst/before))+"% smaller");
  assert.ok(worst <= before*0.25, "worst "+worst+" vs "+before);
  assert.ok(before > 250000, "the old prompt really was the whole sheet");
});
await test("D2 the protocol rules are intact, and MUSE is told to say it's not sure beyond the facts it got", ()=>{
  const p = box.museSystemPrompt({ now:"How do I export my screenplay?" }, null);
  const was = old.museSystemPrompt();
  const rules = was.slice(0, was.indexOf("\n\nABOUT THIS APP"));
  // the Kinolot rebrand (2026-09-28) renamed the identity and rules 1, 3 and 5 (Frances, Kinolot, Infinite Studio AI);
  // rules 2, 4, 6, 7 and 8 stay byte-identical
  const nowRules = p.slice(0, p.indexOf("\n\nABOUT THIS APP"));
  rules.split("\n").filter(l=>/^[24678]\. /.test(l)).forEach(l=>assert.ok(nowRules.includes(l), "unchanged: "+l.slice(0, 40)));
  for(const n of ["1. SCOPE.","2. ACCURACY.","3. CONFIDENTIALITY.","4. NO NAMES.","5. STAY IN CHARACTER.","6. NO OUTSIDE ADVICE.","7. CONCISE & RIGHT-SIZED.","8. CONVERSATION."]) assert.ok(p.includes(n));
  assert.ok(p.includes("if a question isn't covered here, say you're not sure rather than guess"));
  assert.ok(p.includes("For any other feature you have only its index line: if that line doesn't answer the question, say you're not sure rather than guess."));
  const idx = p.slice(p.indexOf("FEATURE INDEX"), p.indexOf("\n\nDETAILS"));
  assert.equal((idx.match(/\n• /g)||[]).length, box.museFacts().length, "the index lists every feature");
  const vague = box.museSystemPrompt({ now:"hi" }, null);
  assert.ok(vague.includes("No feature matched this question closely"));
});
await test("D3 the chat: follow-ups keep their topic, the room is said, the input is trimmed under the proxy's MUSE ceiling, and the model is unchanged", async ()=>{
  let body = null;
  box.sbClient = ()=>({ functions:{ invoke: async (fn, o)=>{ body = o.body; return { data:{ text:"Pick Claude Fable 5.1 — Anthropic's newest flagship." } }; } } });
  box.__store.set("turn-nav-v1", JSON.stringify({ room:"art", view:"spine", artView:"props" }));
  const turns = [{ role:"user", text:"How does the Writing engine dock work?" }, { role:"ai", text:"It shows the current engine." }, { role:"user", text:"and where is it?" }];
  const reply = await box.aiMuseChat(turns, mkScenes(4), null, { title:"Salt" });
  assert.equal(reply, "Pick the selected engine — the provider's newest flagship.");
  // Frances moves to Opus 5.5 (billing fixes, 2026-09-30): the proxy's free path accepts both models during the move
  assert.ok(MUSE_MODELS.includes(body.model), body.model); assert.equal(body.provider, "anthropic"); assert.equal(body.usageKind, "muse");
  assert.equal(body.provider, MUSE_MODEL.provider, "the app's MUSE model is one the proxy accepts");
  // PROMPT CACHING (billing fixes, 2026-09-30): messages[0] is the stable prefix (protocol + feature
  // index) as ONE system message with promptCache:true; this question's facts and the place lead the
  // first user turn after it
  assert.equal(body.promptCache, true, "the request asks the proxy to cache the prefix");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[0].content, box.museStablePrefix(), "the system message is exactly the stable prefix");
  assert.ok(!body.messages.slice(1).some(m=>m.role==="system"), "only the leading message is a system message");
  const first = body.messages[1].content;
  assert.equal(body.messages[1].role, "user");
  assert.ok(first.startsWith("DETAILS"), "the per-question facts open the first user turn");
  assert.ok(detailNames("\n\n"+first).includes("Writing engine dock"), "the follow-up still gets the dock's facts");
  assert.ok(first.includes("The writer was last working in the Art Room (Props tab)."));
  assert.ok(!body.messages[0].content.includes("The writer was last working"), "nothing per-question in the cached prefix");
  assert.equal(body.messages[0].content + "\n\n" + first.slice(0, first.indexOf("\n\nCURRENT PROJECT CONTEXT")),
    box.museSystemPrompt({ now:"and where is it?", before:"How does the Writing engine dock work?", reply:"It shows the current engine." }, { room:"art", view:"spine", artView:"props" }),
    "the two parts together are the same prompt as before");
  assert.ok(box.museFacts().find(f=>f.name==="Frances (help assistant)").what.includes("Frances knows which room, view or Art Room tab you were last working in"), "Frances's own entry says so");
  assert.equal(textBillingKind({ usageKind:body.usageKind, provider:body.provider, model:body.model, messages:body.messages, promptCache:body.promptCache }).kind, "muse", "a real MUSE call stays free");
  assert.equal(textBillingKind({ usageKind:body.usageKind, provider:body.provider, model:body.model, messages:body.messages }).free, false, "a system message without promptCache is not a chat turn");
  // a long chat and a huge pasted message still fit the ceiling
  const long = [];
  for(let i=0;i<5;i++){ long.push({ role:"user", text:"Q"+i+" "+"x".repeat(9000) }, { role:"ai", text:"A"+i+" "+"y".repeat(9000) }); }
  long.push({ role:"user", text:"What about the Stage? "+"z".repeat(120000) });
  await box.aiMuseChat(long, mkScenes(40), null, { title:"Salt" });
  assert.ok(museMessagesSize(body.messages) <= box.MUSE_INPUT_BUDGET, "trimmed to "+museMessagesSize(body.messages));
  assert.ok(body.messages.length <= MUSE_LIMITS.maxMessages);
  assert.equal(textBillingKind({ usageKind:"muse", provider:body.provider, model:body.model, messages:body.messages, promptCache:body.promptCache }).free, true);
  assert.equal(body.messages[0].content, box.museStablePrefix(), "trimming never touches the cached prefix");
  assert.ok(box.MUSE_INPUT_BUDGET < MUSE_LIMITS.maxInputChars, "the app stays under the server's ceiling");
  const appMuse = read("app/ai.jsx").match(/const MUSE_MODEL = \{ id:"(claude-opus-5(?:-5)?)", provider:"anthropic" \};/);
  assert.ok(appMuse && MUSE_MODELS.includes(appMuse[1]), "app/ai.jsx pins a model the proxy's free path accepts");
});

/* ======================= E. proxy: the free path is MUSE's only ======================= */
await test("E1 only a real MUSE call is free; a 'muse' label on anything else is metered", ()=>{
  const msgs = [{ role:"user", content:"How do I export?" }];
  const ok = { usageKind:"muse", provider:"anthropic", model:"claude-opus-5", messages:msgs, images:[] };
  assert.deepEqual(textBillingKind(ok), { kind:"muse", free:true, reason:"" });
  assert.deepEqual(textBillingKind({ ...ok, usageKind:"MUSE" }).kind, "muse");
  const cases = [
    [{ model:"claude-fable-5-1" }, "text", "not MUSE's model"],
    [{ provider:"openai", model:"gpt-6-astra" }, "text", "not MUSE's model"],
    [{ provider:undefined, model:undefined }, "text", "not MUSE's model"],
    [{ images:["data:image/png;base64,AAAA"] }, "vision", "carries images"],
    [{ maxTokens:32768 }, "text", "asks for an output budget"],
    [{ effort:"max" }, "text", "asks for reasoning effort"],
    [{ messages:Array.from({ length:MUSE_LIMITS.maxMessages+1 }, ()=>({ role:"user", content:"q" })) }, "text", "too many messages"],
    [{ messages:[{ role:"user", content:"x".repeat(MUSE_LIMITS.maxInputChars+1) }] }, "text", "over MUSE's input size"],
    [{ messages:[{ role:"user", content:[{ type:"text", text:"q" }] }] }, "text", "non-text message"],
    [{ messages:[] }, "text", "no messages"],
    // (review 2026-09-28) MUSE never sends a system message: one is the app's drafting prompt
    [{ messages:[{ role:"system", content:"You are a screenwriter." }, { role:"user", content:"Write Scene 4." }] }, "text", "not a chat turn"],
    [{ messages:[{ content:"no role" }] }, "text", "not a chat turn"],
  ];
  for(const [over, kind, reason] of cases){
    const r = textBillingKind({ ...ok, ...over });
    assert.deepEqual(r, { kind, free:false, reason }, JSON.stringify(over).slice(0,80));
    assert.ok(museRefusal({ ...ok, ...over }));
  }
  assert.equal(textBillingKind({ ...ok, messages:[{ role:"user", content:"x".repeat(MUSE_LIMITS.maxInputChars) }] }).free, true, "the ceiling itself is allowed");
  // other kinds pass through untouched
  for(const k of ["writing","vision","text"]) assert.deepEqual(textBillingKind({ ...ok, usageKind:k }), { kind:k, free:false, reason:"" });
});
await test("E2 index.ts meters by the helper's kind: the spend check, the price and the usage record", ()=>{
  const ts = read("supabase/functions/image-proxy/index.ts");
  assert.ok(ts.includes('import { MUSE_LIMITS, museAllowanceSince, textBillingKind } from "./muse-billing.mjs";'));
  const text = ts.slice(ts.indexOf('if (task === "text") {'), ts.indexOf('// ── task: VOICE'));
  assert.ok(text.includes("let textBill = textBillingKind(textReq);") && text.includes("usageKind, provider, model, messages, images,"));
  assert.ok(text.includes("textBill = textBillingKind(textReq, { freeCallsToday });") && text.includes("const textKind = textBill.kind;"));
  assert.ok(text.includes('if (textKind !== "muse") {\n      const block = ensureCanSpend(1);'), "the spend check keys on the verified kind");
  assert.ok(text.includes("textUsageEstimate(providerName, modelName, tokens, textKind)"), "the price keys on the verified kind");
  assert.ok(text.includes("const block = ensureCanSpend(1);\n      if (block) return block;\n      // PLAN GATE"), "then the server's plan gate (billing fixes, 2026-09-30)");
  assert.ok(text.includes("metadata: { usageKind: textKind,"), "the record says what was metered");
  assert.ok(!/usageKind !== "muse"|usageKind === "muse"/.test(text), "the browser's label alone decides nothing in the text path");
  // (billing fixes, 2026-09-30) a free call costs 0 credits but now records its real provider cost — reached only by a verified kind
  assert.ok(text.includes('textActualCost(kind === "muse" ? modelName : priceKey, tokens, { vision: kind === "vision", free: kind === "muse", unit })'), "the free price: 0 credits, only for a verified kind");
});

await test("E3 (review) free MUSE has a daily allowance per account; past it the call is metered", ()=>{
  const ok = { usageKind:"muse", provider:"anthropic", model:"claude-opus-5", messages:[{ role:"user", content:"How do I export?" }] };
  assert.equal(MUSE_LIMITS.dailyFreeCalls, 200); assert.equal(MUSE_LIMITS.allowanceWindowMs, 24*60*60*1000);
  assert.deepEqual(textBillingKind(ok, { freeCallsToday:0 }), { kind:"muse", free:true, reason:"" });
  assert.deepEqual(textBillingKind(ok, { freeCallsToday:MUSE_LIMITS.dailyFreeCalls-1 }), { kind:"muse", free:true, reason:"" }, "the last free call");
  assert.deepEqual(textBillingKind(ok, { freeCallsToday:MUSE_LIMITS.dailyFreeCalls }), { kind:"text", free:false, reason:"over today's free MUSE allowance" });
  assert.deepEqual(textBillingKind(ok, { freeCallsToday:5000 }).kind, "text");
  // an uncounted call (no usage, or a count that failed) stays free — help never breaks on a hiccup
  assert.equal(textBillingKind(ok).free, true); assert.equal(textBillingKind(ok, {}).free, true); assert.equal(textBillingKind(ok, { freeCallsToday:NaN }).free, true);
  // a refused call keeps ITS reason, allowance or not
  assert.equal(textBillingKind({ ...ok, model:"claude-fable-5-1" }, { freeCallsToday:0 }).reason, "not MUSE's model");
  // the window: the last 24 hours
  assert.equal(museAllowanceSince(Date.parse("2026-09-28T12:00:00Z")), "2026-09-27T12:00:00.000Z");
});
await test("E4 (review) index.ts counts the account's free MUSE calls, and a free call gets a small reply cap and no effort", ()=>{
  const ts = read("supabase/functions/image-proxy/index.ts");
  const text = ts.slice(ts.indexOf('if (task === "text") {'), ts.indexOf('// ── task: VOICE'));
  const count = text.slice(text.indexOf("if (textBill.free && !isAdmin) {"), text.indexOf("const textKind = textBill.kind;"));
  assert.ok(count.length > 0, "the allowance is checked only for a call that would be free (admins record no usage)");
  for(const s of ['.from("turn_usage_events").select("id", { count: "exact", head: true })', '.eq("owner", authUser.id)', '.eq("task", "text")',
    '.eq("metadata->>usageKind", "muse")', '.gte("created_at", museAllowanceSince(Date.now()))', "if (!error) freeCallsToday = Number(count) || 0;"])
    assert.ok(count.includes(s), s);
  assert.ok(text.indexOf("const textKind = textBill.kind;") < text.indexOf("const block = ensureCanSpend(1);"), "counted before the spend check");
  // the free path's usage rows are the ones counted: they record usageKind "muse"
  assert.ok(text.includes("metadata: { usageKind: textKind,"));
  const anth = text.slice(text.indexOf('if (provider === "anthropic") {'));
  assert.ok(anth.includes('max_tokens: textKind === "muse" ? MUSE_LIMITS.maxOutputTokens : Math.max(reqMaxTokens || 0, 16000)'));
  assert.ok(anth.includes('...(textKind !== "muse" && claudeEffort &&'), "no reasoning-effort setting on a free MUSE call");
  assert.equal(MUSE_LIMITS.maxOutputTokens, 4096);
  // the app: MUSE sends user/assistant turns after ONE leading system message (the cached prefix,
  // billing fixes 2026-09-30) and always asks for promptCache with it, so every real chat call passes
  // the role rule; the follow-up helper still sends a single user turn
  const chat = read("app/ai.jsx").slice(read("app/ai.jsx").indexOf("async function aiMuseChat("), read("app/ai.jsx").indexOf("window.aiMuseFollowups"));
  assert.equal((chat.match(/role:"system"/g)||[]).length, 1, "one system message: the stable prefix");
  assert.ok(chat.includes('return [{ role:"system", content:prefix }].concat(out);') && chat.includes("museComplete(msgs, { promptCache:true })"));
  assert.ok(text.includes("promptCache ? [{ type: \"text\", text: sys, cache_control: { type: \"ephemeral\" } }] : sys"), "the proxy caches it");
});
await test("E5 (review) past the allowance with nothing left, the MUSE chat says so plainly", async ()=>{
  const res402 = (code)=>({ status:402, clone(){ return { json:async ()=>({ error:code }) }; } });
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:null, error:{ message:"Edge Function returned a non-2xx status code", context:res402("insufficient_credits") } }) } });
  await assert.rejects(box.museComplete([{ role:"user", content:"hi" }]), /^Error: You’ve used today’s free messages with Frances, and your plan has nothing left to continue on\. Chatting with Frances is free again within a day\.$/);
  // any other 402 keeps the old (masked) message
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:null, error:{ message:"Edge Function returned a non-2xx status code", context:res402("no_plan") } }) } });
  await assert.rejects(box.museComplete([{ role:"user", content:"hi" }]), (e)=> !/free messages with Frances/.test(e.message) && /briefly unavailable.*\(ref CM-14\)$/.test(e.message));
});

/* ======================= C (review). story words stay; facts hold no competitor or plumbing ======================= */
await test("C4 (review) museScrubReply rewrites engine-shaped names only — the writer's own words stay", ()=>{
  const keep = ["Magnum Opus", "Kimi Sato", "Kimi", "The Opus Club", "INT. OPUS CLUB - NIGHT"];
  const same = ["Your film Magnum Opus opens on the sea.", "Mara recites Sonnet 18 in Scene 4.", "Haiku 5 closes the act.", "give KIMI a line here",
    "The Opus Club is where it turns.", "A documentary about Google's engineers.", "Beethoven's Opus 5 plays.", "Moonshot thinking drives Act II.", "Kimi's line lands."];
  for(const x of same) assert.equal(box.museScrubReply(x, keep), x);
  // with no story words at all, the story-shaped names still stay (they were never engine-shaped)
  for(const x of ["Mara recites Sonnet 18 in Scene 4.", "Scene 3 of Opus turns on the reveal.", "give KIMI a line here", "A documentary about Google's engineers."])
    assert.equal(box.museScrubReply(x), x);
  // engine-shaped names still go, readably
  const want = [["Switch to Opus 5.5 in the dock.", "Switch to the selected engine in the dock."], ["The Opus model is slower.", "The selected engine is slower."],
    ["Your Opus 5 engine draft.", "Your selected engine draft."], ["Opus 5.5 is slower.", "The selected engine is slower."],
    ["Use the latest Opus for this.", "Use the selected engine for this."], ["Kimi K3 is a reasoner.", "The selected engine is a reasoner."],
    ["Google's Gemini writes it.", "The selected engine writes it."], ["Anthropic makes it. Anthropic's model too.", "The provider makes it. The provider's model too."]];
  for(const [a, b] of want) assert.equal(box.museScrubReply(a, keep), b);
  // a cast member named Kimi does not shield the engine "KIMI K3"
  assert.equal(box.museScrubReply("Try KIMI K3 — Moonshot's brand-new deep reasoner", keep), "Try the selected engine — the provider's brand-new deep reasoner");
  assert.deepEqual([...box.museStoryWords([{ title:"The Opus Club", loc:"INT. OPUS CLUB - NIGHT" }], { title:"Magnum Opus" })].slice(0,1), ["Magnum Opus"]);
});
await test("C5 (review) the chat passes the film's own words: a reply about 'Magnum Opus' and its cast comes back untouched", async ()=>{
  box.turnCast = [{ id:"kimi", name:"Kimi Sato" }];
  // a scene titled "Sonnet 2.0" is engine-shaped (a family name with a dotted version), so only the
  // film's own words (museStoryWords) keep it
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:{ text:"In Magnum Opus, give KIMI a line in The Opus Club before Sonnet 2.0 turns." } }) } });
  const scenes = [{ id:"s1", no:1, act:1, title:"The Opus Club", loc:"INT. OPUS CLUB - NIGHT", openCharge:1, closeCharge:-1 }, { id:"s2", no:2, act:1, title:"Sonnet 2.0", openCharge:-1, closeCharge:1 }];
  const reply = await box.aiMuseChat([{ role:"user", text:"How does Scene 1 land?" }], scenes, null, { title:"Magnum Opus" });
  assert.equal(reply, "In Magnum Opus, give KIMI a line in The Opus Club before Sonnet 2.0 turns.");
  assert.equal(box.museScrubReply("before Sonnet 2.0 turns."), "before the selected engine turns.", "without the film's words it would have been rewritten");
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:{ text:JSON.stringify({ q:["Where does KIMI turn in Sonnet 2.0?","Which engine, Opus 5.5?","Next?"] }) } }) } });
  const f = await box.aiMuseFollowups("q", "a", scenes, null, { title:"Magnum Opus" });
  assert.deepEqual(plain(f), ["Where does KIMI turn in Sonnet 2.0?", "Which engine, the selected engine?", "Next?"]);
  box.turnCast = undefined;
});
await test("C6 (review) MUSE's facts carry no competitor, database plumbing or admin-only tool; the Shoot tabs survive", ()=>{
  const all = box.museFacts().map(f=>f.name+": "+f.what).join("\n");
  for(const re of [/higgsfield/i, /\bRPCs?\b/, /database (?:transaction|request URL)/i, /concurrency token/i, /normali[sz]ed database/i, /migration-required/i, /admin-only/i, /the admin sees/i])
    assert.ok(!re.test(all), String(re));
  const stage = box.museFacts().find(f=>f.name==="The Stage (Production)").what;
  assert.ok(stage.includes("The Shoot composer has three tabs: CREATE VIDEO"), "the tab how-to stays, minus the competitor");
  const img = box.museFacts().find(f=>f.name==="Generating images (Art Room)").what;
  assert.ok(img.startsWith("Image generation runs on the studio's servers, so you need to be signed in. Besides its standard engines, the image dock offers precision engines"));
  // since the Kinolot rebrand (2026-09-28) the competitor is gone from the manifest itself too
  assert.ok(!/higgsfield/i.test(box.APP_FEATURES.map(f=>f.what).join(" ")));
});
await test("C7 (review) the protocol doc says what the filter really does (plans, on-screen engine labels, the open question)", ()=>{
  const doc = read("docs/MUSE Protocol.md").replace(/\s+/g, " ");
  assert.ok(!doc.includes("The facts therefore never hand MUSE a name it must not say"), "the overstatement is gone");
  assert.ok(doc.includes("`MUSE_PLAN_TIER`") && doc.includes("a plain \"your plan has nothing left for writing\" still reaches Frances"));
  assert.ok(doc.includes("*Nano Banana*") && doc.includes("*Seedance*, *Kling*") && doc.includes("Open question for the owner (2026-09-28"));
  assert.ok(doc.includes("`museStoryWords()`") && doc.includes("carries only user and assistant turns") && doc.includes("`MUSE_LIMITS.dailyFreeCalls`"));
  // …and the code comment above the filter says the same
  assert.ok(read("app/ai.jsx").includes("an OPEN OWNER QUESTION (2026-09-28"));
  // the round-1 facts MUSE gets never talk MUSE's own allowance (billing — Protocol §3)
  assert.ok(!/daily allowance/.test(box.museFacts().find(f=>f.name==="Frances (help assistant)").what));
  assert.ok(box.APP_FEATURES.find(f=>f.name==="Frances (help assistant)").what.includes("daily allowance per account (200 Frances calls in any 24 hours"));
});

/* ======================= F. doc ↔ prompt ======================= */
await test("F the MUSE Protocol doc and the prompt agree (product name, how facts reach MUSE, the backstops)", ()=>{
  const doc = read("docs/MUSE Protocol.md").replace(/\s+/g, " ");
  const p = box.museSystemPrompt({ now:"x" }, null);
  assert.ok(p.includes("inside Kinolot by Infinite Studio AI") && doc.includes("Frances is the in-app guide for **Kinolot by Infinite Studio AI**"));
  for(const s of ["museBrief()", "musePublicFeature()", "museScrubReply()", "muse-billing.mjs", "MUSE_INPUT_BUDGET"]) assert.ok(doc.includes(s), "doc names "+s);
  assert.ok(doc.includes("OpenAI, GPT, Gemini, Gemma, Google, or any AI vendor or model") && p.includes("OpenAI, GPT, Gemini, Gemma, Google, or any AI vendor or model"), "rule 4 unchanged in both");
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

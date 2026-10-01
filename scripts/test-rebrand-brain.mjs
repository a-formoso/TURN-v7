#!/usr/bin/env node
/* test-rebrand-brain.mjs — Kinolot rebrand, builder 3 (owner decisions 2026-09-28): the AI brain,
   the assistant's rules and the docs. Runs the REAL app/ai.jsx (with the files it leans on) in
   node:vm with a stubbed model — no network, no model, no Supabase — and reads the docs, the
   project notes and the image-proxy source:
     A. APP_FEATURES (what Frances knows) speaks today's names: Kinolot, Frances (only answers),
        "Draft" / "AI draft" / "AI polish" with no persona, the Story Editors' job titles (Script
        Supervisor, Setups & Payoffs, Final Read, Art Coordinator, Department Heads), the
        display-only role "Co-writer" and plan "Producer", the export credit rule and the film
        export's file name — and no user-visible TURN (the craft verb stays), MUSE, Cinema Machine,
        "table-read", competitor or company name, or "Infinite Studio" without "AI".
     B. Frances's rules (museSystemPrompt): Frances inside Kinolot by Infinite Studio AI, only
        answers, never claims a namesake, the Infinite Studio AI method; the engine-label rule is
        settled in the prompt and the doc alike.
     C. Every writing-model prompt names "the Infinite Studio AI method" (ai.jsx + frameworks.jsx).
     D. scrubBrand never turns a vendor into a claim about the company and never rewrites story
        words (Claude, Gemma, McKee, Gemini as story words); McKee citations become the method.
     E. museScrubReply (round-1 leftover a): engine-shaped names only, the writer's own words stay
        even through scrubBrand; "I'm Claude/MUSE" → "I'm Frances"; a namesake claim is replaced.
     F. The chat's own errors say Frances; the live-voice instructions (image-proxy) say Frances,
        Kinolot by Infinite Studio AI and the method; the missing-key error names no TURN.
     G. docs/MUSE Protocol.md ↔ museSystemPrompt(); CLAUDE.md carries the decisions; docs/Story
        Pipeline.md changed terminology only (every changed line maps back to its old self).
   node scripts/test-rebrand-brain.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f)=>readFileSync(ROOT + f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,6).join("\n    ")); }
};

/* ---------------- sandbox: ai.jsx and the plain files it leans on ---------------- */
const noop = ()=>{};
function sandbox(){
  const store = new Map();
  const box = {
    console:{ ...console, warn:noop, info:noop, log:noop }, clearTimeout, setInterval, clearInterval,
    setTimeout:(f)=>setTimeout(f, 0),
    React:new Proxy({ createElement:(t,p,...c)=>({ t, p, c }), useState:(x)=>[x, noop], useRef:(x)=>({ current:x }), useEffect:noop, useMemo:(f)=>f() }, { get:(t,k)=> (k in t) ? t[k] : noop }),
    localStorage:{ getItem:(k)=>store.has(k) ? store.get(k) : null, setItem:(k,v)=>store.set(k,String(v)), removeItem:(k)=>store.delete(k) },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document:{ createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null, addEventListener:noop,
      removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, requestAnimationFrame:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  box.__prompts = []; box.__replies = [];
  box.claude = { complete: async (o)=>{ box.__prompts.push(String(o.messages[0].content)); const r = box.__replies.shift(); return r == null ? "" : r; } };
  vm.createContext(box);
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/story-data.jsx","app/spine.jsx","app/ai.jsx"])
    vm.runInContext(read(f), box, { filename:f });
  box.__store = store;
  return box;
}
const box = sandbox();
const AI = read("app/ai.jsx"), FW = read("app/frameworks.jsx");
const DOC = read("docs/MUSE Protocol.md"), DOC1 = DOC.replace(/\s+/g, " ");
const NOTES = read("CLAUDE.md").replace(/\n\s*/g, " "), PIPE = read("docs/Story Pipeline.md");
const PROXY = read("supabase/functions/image-proxy/index.ts");
const F = (n)=>box.APP_FEATURES.find(f=>f.name===n);
const allRaw = ()=>box.APP_FEATURES.map(f=>f.name+": "+f.what+(f.muse ? " "+f.muse : "")).join("\n");
const allFacts = ()=>box.museFacts().map(f=>f.name+": "+f.what).join("\n");
// the craft verb in the manifest, not the product (decision 5)
const CRAFT_TURN = ["the TURN carried by prose rhythm", "every scene must TURN a value"];
const productTurn = (t)=>{ let x = t; CRAFT_TURN.forEach(k=>{ x = x.split(k).join(""); }); return (x.match(/\bTURN\b[^\n]{0,60}/g)||[]); };

/* ======================= A. the manifest ======================= */
await test("A1 no user-visible TURN (craft verb only), MUSE, Cinema Machine, old agent names or 'table-read' in APP_FEATURES", ()=>{
  const t = allRaw();
  assert.deepEqual(productTurn(t), [], "product TURN left");
  for(const re of [/\bMUSE\b/, /\bMuse\b/, /Cinema ?Machine/i, /Consistency Check/, /Continuity Repair/, /Art Department Coordinator/, /\btable-reads?\b/i, /Writers’ Room/, /\bthe Agents\b/])
    assert.ok(!re.test(t), String(re)+" → "+(t.match(new RegExp(".{0,60}"+re.source+".{0,40}"))||[])[0]);
  assert.ok(!/Infinite Studio(?! AI)/.test(t), "the company is always 'Infinite Studio AI'");
  assert.ok(/the Infinite Studio AI method/.test(t));
  assert.ok(!/Higgsfield/i.test(t), "no competitor in the manifest itself");
});
await test("A2 Frances only answers; the writing actions carry no persona", ()=>{
  const fr = F("Frances (help assistant)");
  assert.ok(fr, "the assistant's entry is named Frances");
  assert.equal(F("MUSE (help assistant)"), undefined);
  assert.ok(fr.what.startsWith("Frances is the friendly AI guide to Kinolot"));
  assert.ok(fr.what.includes("Frances only answers questions — Frances never writes, drafts or changes your story"));
  assert.ok(fr.what.includes("Frances knows which room, view or Art Room tab you were last working in"));
  assert.ok(fr.what.includes("'You’ve used today’s free messages with Frances…'"));
  const draft = F("Draft (one scene)");
  assert.ok(draft && draft.what.startsWith("the 'Draft' button drafts the ONE selected scene only.") && draft.what.includes("screen-time budget"));
  assert.equal(F("Draft with MUSE"), undefined);
  const t = allRaw();
  for(const s of ["'AI draft · Kimi K3'", "'Manual edit', 'AI polish', 'Original draft'", "press Draft to fill it in", "the character 'Draft' button",
    "a small role eyebrow above the action title (Screenwriter drafts and redrafts scenes;", "the agent runner panel header names the team and the job the same way ('Story Editors · Story Doctor' in the Writers' Room, 'Department Heads · Colorist' in the Art Room)"])
    assert.ok(t.includes(s), s);
  assert.ok(!/MUSE ·|· ROLE/.test(t), "no 'MUSE · ROLE' fiction");
});
await test("A3 Story Editors' job titles, the umbrellas, the display-only role and plan names", ()=>{
  const se = F("Story Editors (Writers' Room agents)").what;
  for(const s of ["Script Supervisor (the FREE rule-based STORY audit", "Setups & Payoffs (plants missing setups", "and Final Read (whole-script pacing",
    "There are ALSO agents in the Art Room — the Department Heads —", "the Art Coordinator ('Run pre-production'", "(Frances is NOT in this panel — Frances is the separate floating help assistant"])
    assert.ok(se.includes(s), s);
  // the panel's back button reads "← All Story Editors" (agents-ui.jsx) — Frances must name the real control
  assert.ok(se.includes("the window's ×, a click outside the window and '← All Story Editors' ask 'Stop building this film?'"), "the back button's name");
  assert.ok(!/All agents/.test(allRaw()), "no control that no longer exists");
  assert.ok(allFacts().includes("'← All Story Editors' ask"), "…and the fact reaches Frances");
  assert.ok(F("Writing model (drafting & agents)").what.includes("the Story Editors, spine building and the Final Read."), "the 'Agents … table-reads' drift is fixed");
  const team = F("Team collaboration").what;
  assert.ok(team.includes("(Owner / Co-writer / Art director / View-only;") && team.includes("; Co-writer saves story work"));
  assert.ok(!/\/ Writer \/|\bWriter saves\b/.test(team), "the collaborator role reads Co-writer");
  const plans = box.APP_FEATURES.find(f=>/^Plans & subscription/.test(f.name));
  assert.equal(plans.name, "Plans & subscription (Writer / Director / Producer)");
  assert.ok(plans.what.includes("Producer $149") && !/\bStudio \$|needing Studio|Studio grants|Studio unlocks/.test(plans.what));
  // renamed by the billing fixes (2026-09-30): the 50-credit free trial replaced "no free tier"
  assert.ok(F("A plan is required (free trial: writing and draft images)").what.includes("and Producer opens Writers' Room + Art Room + Stage"));
  // plan tiers still never reach Frances (Protocol §3), with the new display name included
  assert.ok(!/\bProducer \$|Producer grants|Producer opens/.test(allFacts()));
});
await test("A4 exports: the writer is credited, never the company; the film export's file name; the prompt compiler label", ()=>{
  const ex = F("Export (screenplay / story)").what;
  assert.ok(ex.includes("WHO IS CREDITED: the screenplay's title page (PDF / .html) and the .fountain file's Author line credit the writer, never Kinolot or Infinite Studio AI."));
  // only what a user can actually see and set (review, 2026-09-28): no promise of a per-film author field
  assert.ok(ex.includes("On a film someone shared with you, the credit is the film's owner (their handle), never the collaborator who exports it"));
  assert.ok(ex.includes("with any +tag dropped") && ex.includes("When no name is available at all the credit line is simply left off.")
    && ex.includes("The credit name can't be edited inside Kinolot yet."));
  assert.ok(!/film's own author name/.test(ex), "no setting that doesn't exist");
  assert.ok(F("Takes are project records (Stage persistence, recovery & export)").what.includes("named after the film (e.g. 'The_Matrix-2026-09-28.webm'; an untitled film saves as 'Kinolot-film-<date>.webm')"));
  assert.ok(allRaw().includes("labelled as assembled by the Kinolot prompt compiler"));
});
await test("A5 what Frances receives: no vendor, competitor or company name (on-screen image/video engine labels may stay)", ()=>{
  const t = allFacts();
  for(const re of [/anthropic|claude|openai|chatgpt|\bgpt|gemini|gemma|google|moonshot|kimi|\bopus\b|\bfable\b|sonnet|haiku|mythos|elevenlabs|\bfal\b|supabase|stripe|bytedance|mckee/i,
    /higgsfield|netflix|final draft|highland/i, /\bMUSE\b|Cinema Machine/])
    assert.ok(!re.test(t), String(re)+" → "+(t.match(new RegExp(".{0,60}(?:"+re.source+").{0,40}", re.flags))||[])[0]);
  assert.deepEqual(productTurn(t), []);
  assert.ok(/Nano Banana/.test(t) && /Seedance/.test(t), "the on-screen engine labels stay while the owner decides (open question)");
  assert.ok(F("Frances (help assistant)") && box.museFacts().find(f=>f.name==="Frances (help assistant)"), "Frances's own entry reaches her");
  assert.ok(t.includes("opens in most screenwriting apps") && t.includes("approved-camera family list"), "the how-to survives without the names");
});

/* ======================= B. Frances's rules ======================= */
await test("B1 museSystemPrompt: Frances, Kinolot by Infinite Studio AI, only answers, no namesake, the method", ()=>{
  const p = box.museSystemPrompt({ now:"How do I export my screenplay?" }, null);
  const rules = p.slice(0, p.indexOf("\n\nABOUT THIS APP"));
  assert.ok(rules.startsWith("You are Frances — the in-app guide inside Kinolot by Infinite Studio AI, a story-architecture app for AI filmmakers."));
  assert.ok(rules.includes("You only answer. You never write, draft, change or save anything in the writer's film"));
  assert.ok(rules.includes("Frances is simply your name here. Never claim to be named after, modelled on or to be any real person"));
  assert.ok(rules.includes("Refer to the craft only as \"the Infinite Studio AI method\"."));
  assert.ok(rules.includes("(b) HOW TO USE KINOLOT") && rules.includes("behind Kinolot or Infinite Studio AI") && rules.includes("\"I'm Frances; let's keep our focus on your story.\""));
  assert.ok(rules.includes("5. STAY IN CHARACTER. You are always Frances.") && rules.includes("drop the Infinite Studio AI framing"));
  for(const n of ["1. SCOPE.","2. ACCURACY.","3. CONFIDENTIALITY.","4. NO NAMES.","5. STAY IN CHARACTER.","6. NO OUTSIDE ADVICE.","7. CONCISE & RIGHT-SIZED.","8. CONVERSATION."]) assert.ok(rules.includes(n));
  assert.ok(!/\bMUSE\b|\bTURN\b|Cinema Machine|Infinite Studio(?! AI)/.test(rules), "no old name in the rules");
  // "named after" appears only in the rule that forbids the claim — no namesake is ever suggested
  assert.ok(!/\bnamed (?:after|for)\b|\bhomage\b|\btribute\b/i.test(rules.replace("Never claim to be named after, modelled on or to be any real person", "")));
});
/* (integration, 2026-09-28) the on-screen engine-label question is the OWNER's to settle — the rebrand
   renamed it but did not decide it: rule 4 keeps its wording, and the doc and the code comment still
   record the open question, the same way in both. */
await test("B2 the engine-label question stays an open owner question, the same way in the prompt, the doc and the code comment", ()=>{
  const p = box.museSystemPrompt({ now:"x" }, null);
  assert.ok(p.includes("4. NO NAMES. Never mention or attribute anything to McKee, Robert McKee, Claude, Anthropic, OpenAI, GPT, Gemini, Gemma, Google, or any AI vendor or model.\n"), "rule 4 unchanged");
  assert.ok(!/one exception|pickers show it/.test(p.slice(0, p.indexOf("\n\nABOUT THIS APP"))), "no exception granted without the owner");
  assert.ok(DOC1.includes("*Open question for the owner (2026-09-28, still open after the Kinolot rebrand):*") && DOC1.includes("*Nano Banana*") && DOC1.includes("*Seedance*, *Kling*"));
  assert.ok(!/settled 2026-09-28/.test(DOC + AI), "nothing claims it was settled");
  assert.ok(AI.includes("an OPEN OWNER QUESTION (2026-09-28,\n   still open after the Kinolot rebrand)"));
});

/* ======================= C. writing-model prompts ======================= */
await test("C1 every prompt that names the method says 'the Infinite Studio AI method' (ai.jsx, frameworks.jsx)", async ()=>{
  assert.ok(!/Infinite Studio method/.test(AI) && !/Infinite Studio method/.test(FW), "no bare 'Infinite Studio method' left");
  assert.equal((FW.match(/with the Infinite Studio AI method/g)||[]).length, 3, "the three framework spine intros");
  for(const fw of ["kishotenketsu","herosjourney","storycircle"]){
    const f = (box.FRAMEWORKS||[]).find(x=>x.id===fw);
    if(f && f.spine && typeof f.spine.intro==="function") assert.ok(f.spine.intro(16).includes("the Infinite Studio AI method"), fw);
  }
  // a real call: the story world and the character pass carry the new name
  box.__prompts = []; box.__replies = ["{}", "{}"];
  await box.aiBuildStoryWorld("LOGLINE: a salt-pan worker holds on.", { scenes:[] }, "film");
  assert.ok(box.__prompts.some(x=>x.includes("using the Infinite Studio AI method")), "the story-world prompt");
});

/* ======================= D. scrubBrand ======================= */
await test("D1 scrubBrand: a vendor becomes a neutral phrase, never a claim about the company", ()=>{
  const S = box.scrubBrand;
  const want = [["Claude Opus 5.5 wrote this.", "The writing engine wrote this."], ["Anthropic's newest flagship", "The engine provider's newest flagship"],
    ["Try GPT-5.5 or Gemini 3.5 Flash.", "Try the writing engine or the writing engine."], ["GPT Image 2.5 Flare paints it.", "The image engine paints it."],
    ["Use Kimi K3.", "Use the writing engine."], ["the Claude model", "the writing engine"], ["Google's Gemini writes it.", "The writing engine writes it."],
    ["Moonshot's brand-new reasoner", "The engine provider's brand-new reasoner"], ["Robert McKee's method", "The Infinite Studio AI method"],
    ["Use McKee's approach here.", "Use the Infinite Studio AI method here."], ["It follows the McKee method.", "It follows the Infinite Studio AI method."],
    ["McKee's principles say so.", "The Infinite Studio AI method's principles say so."],
    // never an authorship claim for the company (review, 2026-09-28): the method's book, not "Infinite Studio AI's book"
    ["Robert McKee's book Story opens with it.", "The Infinite Studio AI method's book Story opens with it."],
    ["According to McKee, a scene must turn.", "According to the Infinite Studio AI method, a scene must turn."],
    ["As McKee says, conflict is king.", "As the Infinite Studio AI method says, conflict is king."]];
  for(const [a, b] of want) assert.equal(S(a), b);
  for(const [a] of want) assert.ok(!/Infinite Studio(?! AI)|Anthropic|OpenAI|Claude|GPT|Gemini|Kimi|McKee/.test(S(a)), S(a));
  for(const [a] of want) assert.ok(!/Infinite Studio AI['’]s\b/.test(S(a)), "no possessive company claim: "+S(a));
});
await test("D3 scrubAnalysis (the studio's own analysis: Story Doctor, re-read, fusion, Final Read, voice check): every McKee goes, the film's words stay", ()=>{
  const A = box.scrubAnalysis;
  // everyday citations the narrow scrubBrand leaves alone (the review's probes) — all rewritten here
  const probes = ["In McKee's terms, Scene 4 lacks a gap.", "Per McKee, a scene that doesn't turn is a non-event.", "McKee would call this a non-event.",
    "This is a classic McKee non-event.", "McKee's gap never opens in Scene 3.", "Following McKee, the climax must be irreversible.", "(McKee, Story, 1997)"];
  for(const x of probes){ const out = A(x); assert.ok(!/McKee/.test(out) && !/Infinite Studio AI['’]s\b/.test(out) && out.length>8, x+" → "+out); }
  // used as an adjective the name simply drops out (never "a classic the … method non-event")
  assert.equal(A("This is a classic McKee non-event."), "This is a classic non-event.");
  assert.equal(A("In McKee's terms, Scene 4 lacks a gap."), "In the Infinite Studio AI method's terms, Scene 4 lacks a gap.");
  assert.equal(A("Per McKee, a scene that doesn't turn is a non-event."), "Per the Infinite Studio AI method, a scene that doesn't turn is a non-event.");
  assert.equal(A("McKee would call this a non-event."), "The Infinite Studio AI method would call this a non-event.");
  // a detective called McKee in the film keeps his name; the citation in the same note still goes
  const castNote = "McKee's desire never meets resistance in Scene 3; per McKee, that is a non-event.";
  assert.equal(A(castNote, ["Jane McKee", "Jane", "McKee"]), castNote, "with McKee in the cast every McKee is the character's — the film's words are never rewritten");
  assert.equal(A(castNote), "The Infinite Studio AI method's desire never meets resistance in Scene 3; per the Infinite Studio AI method, that is a non-event.",
    "without the film's words it would have been rewritten");
  assert.equal(A("Claude Opus 5.5 flagged it.", []), "The writing engine flagged it.", "vendors still go (scrubBrand runs inside)");
  assert.equal(A(""), ""); assert.equal(A(null), null);
});
await test("D4 the analysis helpers use scrubAnalysis with the film's words; story text (planted lines, quoted lines, names) keeps the narrow scrubBrand", async ()=>{
  box.turnCast = [{ id:"m", name:"Mara Quinn" }];
  const sc = { id:"s1", no:1, act:1, title:"Dock", loc:"EXT. DOCK - NIGHT", summary:"Mara waits.", openCharge:1, closeCharge:1, openValue:"Hope", closeValue:"Hope" };
  box.__replies = [JSON.stringify({ closeValue:"Despair", closeCharge:-2, rationale:"Per McKee, a scene must turn; Mara loses the boat." })];
  const t = await box.aiSuggestTurn(sc, null, { title:"Night Shift" });
  assert.equal(t.rationale, "Per the Infinite Studio AI method, a scene must turn; Mara loses the boat.");
  box.__replies = [JSON.stringify({ line:"Robert McKee (40s) waves from the pier." })];
  assert.equal(await box.aiPlantLine(sc, "the boat", "plant"), "The Infinite Studio AI method (40s) waves from the pier.", "story text keeps the narrow rule (documented in the Protocol)");
  box.turnCast = undefined;
  for(const fn of ["aiSuggestTurn", "aiTenReRead", "aiFusionCheck", "aiTableRead", "aiVoiceCheck"]){
    const i = AI.indexOf("async function "+fn+"("), body = AI.slice(i, AI.indexOf("\nwindow."+fn+" = ", i));
    assert.ok(i>0 && /scrubAnalysis\(/.test(body) && /museStoryWords\(/.test(body), fn+" scrubs its analysis with the film's words");
  }
});
await test("D2 scrubBrand leaves story words alone (a character called Claude, Gemma or McKee; the Gemini capsule)", ()=>{
  for(const x of ["Claude pours the wine.", "Gemma watches Claude.", "The Gemini capsule splashes down.", "a Gemini-born sailor", "McKee says we leave at dawn.",
    "Detective McKee enters.", "McKee's gun is on the table.", "Mara recites Sonnet 18.", "A documentary about Google's engineers."])
    assert.equal(box.scrubBrand(x), x);
  const cast = { name:"Claude", role:"Protagonist" };
  assert.equal(box.scrubBrand(cast.name), "Claude", "a cast name survives the build's scrub");
});

/* ======================= E. museScrubReply (round-1 leftover a) ======================= */
await test("E1 story words stay (with and without the film's words); engine names go; the assistant is Frances", ()=>{
  const R = box.museScrubReply;
  for(const x of ["Mara recites Sonnet 18 in Scene 4.", "Haiku 5 closes the act.", "give KIMI a line here", "Your film Magnum Opus opens on the sea.",
    "A documentary about Google's engineers.", "Mara was named after her grandmother."])
    assert.equal(R(x), x);
  assert.equal(R("Switch to Opus 5.5 in the dock."), "Switch to the selected engine in the dock.");
  assert.equal(R("I'm Claude, made by Anthropic."), "I'm Frances, made by the provider.");
  assert.equal(R("I'm MUSE, your guide. Open the MUSE bubble."), "I'm Frances, your guide. Open the Frances bubble.");
  assert.equal(R("Welcome to Cinema Machine by Infinite Studio."), "Welcome to Kinolot by Infinite Studio AI.");
  assert.equal(R("I'm named after a famous screenwriter. Let's look at Scene 3."), "Frances is simply my name here. Let's look at Scene 3.");
  assert.equal(R("Scene 2 turns. My name comes from an old Hollywood writer! Want to try Draft?"), "Scene 2 turns. Frances is simply my name here. Want to try Draft?");
  assert.equal(R("McKee says the scene turns."), "The Infinite Studio AI method says the scene turns.", "with no cast called McKee it is a citation");
  // the film's own words survive even scrubBrand's rules now that it runs inside the parking
  assert.equal(R("I am Claude, Gemma's brother.", ["Claude", "Gemma"]), "I am Claude, Gemma's brother.");
  assert.equal(R("Your film Muse opens on MUSE at the pier.", ["Muse"]), "Your film Muse opens on MUSE at the pier.");
});
await test("E1b the namesake and self-name backstops touch only what Frances says of HERSELF (review, 2026-09-28)", ()=>{
  const R = box.museScrubReply;
  // a cast member called Frances is one of the film's words (museStoryWords: whole, first, last)
  box.turnCast = [{ id:"fh", name:"Frances Hale" }, { id:"t", name:"Tom" }];
  const keep = box.museStoryWords([{ id:"s2", no:2, title:"The Name", loc:"INT. KITCHEN - DAY" }], { title:"Night Shift" });
  assert.ok(keep.includes("Frances") && keep.includes("Frances Hale"));
  const story = "Frances was named after the aunt who abandoned her, so every time Tom says it in Scene 2 it reopens the wound. Lean on that in Scene 5.";
  assert.equal(R(story, keep), story, "a cast member named Frances: the reply about her stays whole");
  assert.equal(R(story), story, "third person is a character, even with no cast list");
  assert.equal(R("Frances was named after her grandmother, a lovely touch."), "Frances was named after her grandmother, a lovely touch.",
    "third person, no scene number and no cast list: still the character's, never replaced");
  // quoted dialogue is the film's, never Frances's
  const quoted = "Nice \u2014 her line 'I was named after a dead saint' says a lot. What stands in her way?";
  assert.equal(R(quoted), quoted);
  assert.equal(R("Her line \u201cMy name was chosen by the council\u201d lands hard."), "Her line \u201cMy name was chosen by the council\u201d lands hard.");
  assert.equal(R('He says "I am MUSE" at the gate.'), 'He says "I am MUSE" at the gate.', "a quoted 'I am MUSE' is a line of dialogue");
  // a sentence about the story (a scene number / the film's words) is the film's
  assert.equal(R("In Scene 5 Mara tells him my name was chosen by the council\u2026"), "In Scene 5 Mara tells him my name was chosen by the council\u2026");
  assert.equal(R("Tom wants the MUSE file.", keep), "Tom wants the MUSE file.", "a story sentence keeps its MUSE");
  // Frances's own claims are still replaced, even beside a quote or a story sentence
  assert.equal(R("I'm named after a great screenwriter. Tom's line 'I was named after my dad' works.", keep),
    "Frances is simply my name here. Tom's line 'I was named after my dad' works.");
  assert.equal(R("My name is a nod to an old Hollywood writer! Want to try Draft?"), "Frances is simply my name here. Want to try Draft?");
  assert.equal(R("Hi, I'm MUSE \u2014 ask me anything."), "Hi, I'm Frances \u2014 ask me anything.");
  box.turnCast = undefined;
});
await test("E1c the typed New Story interview: the names the writer used come back as written; Frances's own claims still go", async ()=>{
  const W = box.museWriterWords;
  assert.deepEqual(JSON.parse(JSON.stringify(W([{ role:"user", content:"It's about Frances Hale, a nurse. My story ends at McKee's bar." }, { role:"assistant", content:"I'm Claude" }]))),
    ["Frances Hale", "Frances", "McKee"], "only names a scrub would touch; never 'My', 'It's' or the assistant's lines");
  const hist = [{ role:"user", content:"A nurse called Frances, named after her grandmother, hides a letter from Detective McKee." }];
  box.__prompts = []; box.__replies = [JSON.stringify({ say:"Frances was named after her grandmother \u2014 lovely. What does McKee want from her?", done:false })];
  let turn = await box.aiSeedInterview(hist, "short film");
  assert.equal(turn.say, "Frances was named after her grandmother \u2014 lovely. What does McKee want from her?");
  box.__replies = [JSON.stringify({ say:"I'm named after a famous screenwriter. What does Frances fear?", done:false })];
  turn = await box.aiSeedInterview(hist, "short film");
  assert.equal(turn.say, "Frances is simply my name here. What does Frances fear?");
});
await test("E2 the chat and its follow-ups: the cast (whole, first and last names) and the title come back as written", async ()=>{
  box.turnCast = [{ id:"jm", name:"Jane McKee" }, { id:"cl", name:"Claude" }];
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:{ text:"In Magnum Opus, McKee confronts Claude before Sonnet 2.0 turns. I'm Claude's guide, not Claude." } }) } });
  const scenes = [{ id:"s1", no:1, act:1, title:"Sonnet 2.0", openCharge:1, closeCharge:-1 }];
  const reply = await box.aiMuseChat([{ role:"user", text:"How does Scene 1 land?" }], scenes, null, { title:"Magnum Opus" });
  assert.equal(reply, "In Magnum Opus, McKee confronts Claude before Sonnet 2.0 turns. I'm Claude's guide, not Claude.");
  assert.ok(box.museStoryWords([], {}).includes("McKee"), "the surname is one of the film's words");
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:{ text:JSON.stringify({ q:["Why does McKee lie?","Which engine, Opus 5.5?","Is MUSE free?"] }) } }) } });
  const f = await box.aiMuseFollowups("q", "a", scenes, null, { title:"Magnum Opus" });
  assert.deepEqual(JSON.parse(JSON.stringify(f)), ["Why does McKee lie?", "Which engine, the selected engine?", "Is Frances free?"]);
  box.turnCast = undefined;
});

/* ======================= F. errors, live voice, proxy ======================= */
await test("F1 the chat's own errors name Frances", async ()=>{
  box.sbClient = ()=>null;
  await assert.rejects(box.museComplete([{ role:"user", content:"hi" }]), /^Error: Sign in to chat with Frances\.$/);
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:null, error:{ message:"x", context:{ status:401 } } }) } });
  await assert.rejects(box.museComplete([{ role:"user", content:"hi" }]), /^Error: Sign in to chat with Frances\.$/);
  const res402 = { status:402, clone(){ return { json:async ()=>({ error:"insufficient_credits" }) }; } };
  box.sbClient = ()=>({ functions:{ invoke: async ()=>({ data:null, error:{ message:"x", context:res402 } }) } });
  await assert.rejects(box.museComplete([{ role:"user", content:"hi" }]),
    /^Error: You’ve used today’s free messages with Frances, and your plan has nothing left to continue on\. Chatting with Frances is free again within a day\.$/);
  // the typed New Story interview is the same Frances voice
  box.__prompts = []; box.__replies = [JSON.stringify({ say:"I'm Claude — tell me who your story follows.", done:false })];
  const turn = await box.aiSeedInterview([], "short film");
  assert.equal(turn.say, "I'm Frances — tell me who your story follows.");
  assert.ok(box.__prompts[0].startsWith("You are Frances, a warm, curious story-development partner inside Kinolot by Infinite Studio AI"));
  assert.ok(box.__prompts[0].includes("Frances is simply your name here: never claim to be named after"));
  const talk = AI.match(/talk:\s+"([^"]+)"/)[1];
  assert.ok(talk.startsWith("The writer talked the story through with Frances, the in-app story guide"), "the logline shaper knows who the other voice was");
});
await test("F2 image-proxy: the live-voice instructions are Frances's, and no error names TURN", ()=>{
  const live = PROXY.slice(PROXY.indexOf("const instructions = ["), PROXY.indexOf('].join("\\n");', PROXY.indexOf("const instructions = [")));
  assert.ok(live.includes("You are Frances, the warm, sharp story-development companion inside Kinolot by Infinite Studio AI."));
  assert.ok(live.includes("Frances is simply your name here: never claim to be named after, modelled on or to be any real person."));
  assert.ok(live.includes("the Infinite Studio AI method") && live.includes("say: I'm Frances; let's keep our focus on your story."));
  assert.ok(live.includes("Do not attempt to edit the project or claim that anything has been saved."), "voice Frances only talks, too");
  assert.ok(!/\bMUSE\b|Cinema Machine|Infinite Studio(?! AI)/.test(live));
  assert.ok(PROXY.includes("An administrator can add it in the API Keys modal for testing or set the ${envName} server secret."));
  assert.ok(!/TURN's API Keys/.test(PROXY));
});

/* ======================= G. docs and notes ======================= */
await test("G1 docs/MUSE Protocol.md and museSystemPrompt() agree", ()=>{
  const p = box.museSystemPrompt({ now:"x" }, null);
  assert.ok(DOC.startsWith("# Frances Protocol") && DOC1.includes("Frances is the in-app guide for **Kinolot by Infinite Studio AI**"));
  assert.ok(p.includes("inside Kinolot by Infinite Studio AI"));
  assert.ok(DOC1.includes("**Frances only answers**") && p.includes("You only answer."));
  assert.ok(DOC1.includes("Frances never claims to be named after, modelled on, or to be any real person") && p.includes("Never claim to be named after, modelled on or to be any real person"));
  assert.ok(DOC1.includes("OpenAI, GPT, Gemini, Gemma, Google, or any AI vendor or model") && p.includes("OpenAI, GPT, Gemini, Gemma, Google, or any AI vendor or model"));
  assert.ok(DOC1.includes("*\"I'm Frances; let's keep our focus on your story.\"*") && p.includes("\"I'm Frances; let's keep our focus on your story.\""));
  for(const s of ["museBrief()", "musePublicFeature()", "museScrubReply()", "scrubBrand()", "museStoryWords()", "muse-billing.mjs", "MUSE_INPUT_BUDGET", "`MUSE_PLAN_TIER`", "`MUSE_LIMITS.dailyFreeCalls`"])
    assert.ok(DOC.includes(s), "doc names "+s);
  // round-1 leftover b: the doc says what the code does
  assert.ok(DOC1.includes("a plain \"your plan has nothing left for writing\" still reaches Frances") && DOC1.includes("(Writer, Director, Producer)"));
  assert.ok(DOC1.includes("\"You’ve used today’s free messages with Frances…\""));
  assert.ok(!/\bTURN\b(?! is the app's internal code)/.test(DOC.replace("(TURN is the app's internal\ncode name", "")), "no TURN as the product");
  // the old names appear only where the doc describes the backstop that replaces them
  const docNoBackstop = DOC1.replace("\"Cinema Machine\" becomes Kinolot, \"Infinite Studio\" becomes Infinite Studio AI", "");
  assert.ok(!/Cinema Machine|Infinite Studio(?! AI)/.test(docNoBackstop));
  // the only "named after" talk is the rule against claiming one, and its backstop
  assert.equal((DOC1.match(/named after/g)||[]).length, 2, "the rule and the backstop, nothing else");
});
await test("G2 CLAUDE.md carries the decisions (product, host, codename, Frances, editors, export credit)", ()=>{
  for(const s of ["# Kinolot — project notes (internal codename: TURN)", "**Kinolot** (say *KEE-no-lot*) **by Infinite Studio AI**",
    "https://kinolot.infinitestudioai.com", "`cinema.infinitestudioai.com`", "**TURN is the internal codename ONLY**", "`scripts/test-rebrand-*.mjs`",
    "**The assistant is Frances** (internal code name **MUSE**", "never claims to be named after anyone", "Script Supervisor (id `consistency`)",
    "Setups & Payoffs (id `continuity`)", "**Department Heads**", "Art Coordinator", "\"Co-writer\"", "\"Producer\"",
    "**Screenplay exports credit the writer, never the company:**", "\"the Infinite Studio AI method\"", "## 🛡️ Frances answer protocol"])
    assert.ok(NOTES.includes(s), s);
  assert.equal((NOTES.match(/named after/g)||[]).length, 1, "only the rule against claiming a namesake");
});
await test("G3 docs/Story Pipeline.md: terminology only — every changed line maps back to its old self", ()=>{
  let old = null;
  try{ old = execSync("git show HEAD:'docs/Story Pipeline.md'", { cwd:ROOT, encoding:"utf8", stdio:["ignore","pipe","ignore"] }); }catch(e){}
  assert.ok(!/\bMUSE\b|\bTURN\b|Continuity Repair|Consistency Check|Draft with|Infinite Studio(?! AI)/.test(PIPE), "no old name left");
  if(!old) return;   // no git: the name check above still ran
  const back = (l)=>l.replace(/the Infinite Studio AI (method|research method)/g, "the Infinite Studio $1").replace(/Infinite Studio AI method/g, "Infinite Studio method")
    .replace(/Kinolot/g, "TURN").replace(/Frances-facing/g, "MUSE-facing").replace(/### 8\. Frances/, "### 8. MUSE").replace(/\bFrances\b/g, "MUSE")
    .replace(/"Draft"\)/g, "\"Draft with MUSE\")").replace(/\*\*Draft\*\* —/g, "**Draft with MUSE** —").replace(/Setups & Payoffs/g, "Continuity Repair")
    .replace(/until the AI writes the scene/g, "until MUSE writes the scene").replace(/the Story Editors \(Writers' Room agents\)/g, "the Writers' Room agents")
    .replace(/The Art Coordinator's/g, "The Coordinator's");
  const a = old.split("\n"), b = PIPE.split("\n");
  assert.equal(b.length, a.length, "no line added or removed");
  const changed = [];
  b.forEach((l, i)=>{ if(l!==a[i]){ changed.push(i+1); assert.equal(back(l), a[i], "line "+(i+1)+" changed more than its names"); } });
  if(changed.length) console.log("     Story Pipeline lines renamed: "+changed.join(", "));
});

console.log(checks+" checks passed"+(failed ? ", "+failed+" FAILED" : ""));
if(failed) process.exit(1);

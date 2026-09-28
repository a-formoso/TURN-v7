#!/usr/bin/env node
/* Page forms the check accepts (docs/Story Pipeline.md step 5, owner-approved 2026-09-27):
   "standard screenplay devices … are action, not dialogue, and a mid-speech (beat) is standard
   form. A documentary writes an interviewer's questions as INTERVIEWER (O.S.) and planned
   testimony as EXPECTED TESTIMONY: <subject> on <topic> in action, never as invented lines for a
   real person."

   Sample builds, same day: the Documentary wasted 45% of its scene drafts and ended Sc 6 as a
   rough stand-in — its format brief asked for "interview questions + expected testimony beats"
   without naming a form the check accepts, so the model tried INTERVIEW (LATER, TO LEONOR): …,
   Q: …, EXPECTED TESTIMONY — LEONOR: …; and a mid-speech "(beat)" / "(barely)" (cue → dia →
   paren → dia) failed both the writers and the Script check as an orphan parenthetical.

   This runs the REAL app files (formats, frameworks, contract, scene-order, spine, script, ai,
   agents, shot-screenplay, locations) in node:vm with a stubbed window.claude.complete that
   replays canned replies (no network), plus the REAL beat-text readers cut from shots-ui.jsx.
   It proves:
     A. the Documentary format's writing instructions name the forms (format brief in every
        scene writer's prompt, the retry note after a rejection) and BLOCK_SPEC teaches the
        speech forms; a non-documentary prompt carries no documentary forms;
     B. the check accepts INTERVIEWER (O.S.) cue + dialogue, "EXPECTED TESTIMONY: <subject> on
        <topic>" and "EXPECTED TESTIMONY — <cast name>: <topic>" (every sentence opens as a topic:
        "on …", "her account of …", "how the …"), and a quoted title or nickname, while words
        attributed to a real subject stay rejected (writers AND Script check) — lowercase text,
        "In her own words, …", "Her words: …", a lowercase "i" included — and a documentary scene
        written in those forms is committed, not a stand-in;
     C. a mid-speech parenthetical passes the writers and the Script check, which agree on every
        cue/paren/dia/action sequence up to 5 blocks (the one pre-existing difference aside);
        dialogue after action is NEVER given a speaker by the normaliser (a dropped cue, a
        documentary subject's answer and a resumed speech look alike): it is rejected and the
        retry asks for the cue, "NAME (CONT’D)" when MUSE writes it itself passing; dia → dia, a
        hanging parenthetical and a parenthetical carrying another character's line stay rejected;
     D. downstream readers keep a speech continued after a (beat) with its speaker;
     E. MUSE's product knowledge (APP_FEATURES) describes all of this, names no vendor;
     F. the changed files load under new cache keys, script.jsx and ai.jsx together, and the
        classifier version is in step.
   node scripts/test-page-forms.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f)=>readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,6).join("\n    ")); }
};

/* ---------------- sandbox: the real app files ---------------- */
const noop = ()=>{};
const box = {
  console, clearTimeout, setInterval, clearInterval,
  setTimeout:(f)=>setTimeout(f, 0),
  React: new Proxy({}, { get:(t,k)=> k==="createElement" ? ()=>null : k==="Fragment" ? "frag" : k==="useRef" ? (x)=>({ current:x }) : noop }),
  ReactDOM: new Proxy({}, { get:()=>noop }),
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
  CustomEvent: class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
  Image: class {},
  document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop, classList:{ add:noop, remove:noop } }),
    getElementById:()=>null, addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], createTextNode:()=>({}),
    body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
  requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
  matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
  fetch:()=>{ throw new Error("network disabled in this test"); },
};
box.window = box; box.globalThis = box; box.self = box;
box.__replies = []; box.__prompts = [];
box.appToast = noop;
box.claude = { complete: async (opts)=>{
  box.__prompts.push(((opts && opts.messages) || []).map(m=>m.content).join("\n"));
  const r = box.__replies.shift();
  if(r instanceof Error) throw r;
  return r == null ? "" : r;
} };
vm.createContext(box);
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js",
  "app/spine.jsx","app/script.jsx","app/ai.jsx","app/agents.jsx","app/shot-screenplay.js","app/locations.jsx"])
  vm.runInContext(read(f), box, { filename:f });
box.appToast = noop;
box.appConfirm = async ()=>true;
box.console = { ...console, warn:noop, info:noop };
const plain = (x)=>JSON.parse(JSON.stringify(x));
const reset = ()=>{ box.__replies = []; box.__prompts = []; box.turnCast = undefined; box.turnProject = undefined; };
const VENDOR_RE = /claude|anthropic|openai|\bgpt|gemini|gemma|opus|sonnet|fable|kimi|mckee/i;
const PROJECT_NOUNS = /LEONOR|ARMINDO|SARMENTO|GRACINDA|BENEDITA|WRENHAM|CARROW|PRUITT|MARISOL/i;
const reply = (segs)=>JSON.stringify({ beats:segs.map(([n, blocks])=>({ n, blocks:blocks.map(([type,text])=>({ type, text })) })) });
const types = (blocks)=>blocks.map(b=>b.type+"|"+b.text);

const DOC = { title:"Salt Pans", format:"documentary", genre:"" };
const FEATURE = { title:"Other Film", format:"feature", genre:"thriller" };
const DOC_CAST = ["ARMINDO SARMENTO","LEONOR SARMENTO","GRACINDA SARMENTO","BENEDITA SARMENTO"].map(name=>({ name }));
const SC = { id:"s6", no:6, act:2, title:"The Wall", loc:"EXT. SALT PANS - DAY", driver:"x", summary:"The wall.", objective:"",
  openValue:"Memory", openCharge:1, closeValue:"Loss", closeCharge:-1 };
const BM = { driverLabel:"LEONOR SARMENTO", reactorLabel:"ARMINDO SARMENTO", turnAt:2, rows:[
  { n:1, drive:{ a:"Walks", d:"Leonor walks the slumped salt pan wall at dawn." }, react:{ a:"Watches", d:"Armindo watches from the crate." } },
  { n:2, drive:{ a:"Remembers", d:"Leonor remembers the flood night and the wall going." }, react:{ a:"Listens", d:"The interviewer asks about her father." } }] };
const BM2 = (l)=>({ rows:[{ n:1, drive:{ d:"salt pans at dawn" }, react:{ d:"" } }, { n:2, drive:{ d:l }, react:{ d:"" } }] });
const verdict = (l, cast)=>box.resolveScreenplayResponse(reply([[1, [["action","The salt pans at dawn."]]], [2, [["action", l]]]]),
  SC, BM2(l), { requireAllBeats:true, cast:cast || DOC_CAST });
const scriptWarns = (l, cast)=>{
  box.turnCast = cast || DOC_CAST;
  const rep = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, { beat:2, type:"action", text:l }] }, null);
  box.turnCast = undefined;
  return rep.issues.some(x=>x.code==="dialogue-in-action");
};
const doc = read("docs/Story Pipeline.md").replace(/\n>\s?/g, " ").replace(/\s+/g, " ");

/* ======================= A. the writing instructions name the forms ======================= */
await test("A1 the owner's doc still carries the page-forms sentence this implements (read-only)", ()=>{
  for(const s of ["on-screen text, inserts, supers, readouts, records and recorded voices — are action, not dialogue, and a mid-speech **(beat)** is standard form.",
    "A documentary writes an interviewer's questions as **INTERVIEWER (O.S.)** and planned testimony as **EXPECTED TESTIMONY: <subject> on <topic>** in action, never as invented lines for a real person."])
    assert.ok(doc.includes(s), "doc: "+s);
});

await test("A2 the Documentary format brief names INTERVIEWER (O.S.) and EXPECTED TESTIMONY: <subject> on <topic>, and every documentary scene writer gets it", async ()=>{
  const brief = box.formatOf(DOC).screenplayBrief;
  for(const s of ["INTERVIEWER (O.S.)", "EXPECTED TESTIMONY: <subject> on <topic>", "never invented lines for a real person", "no quotes", "NARRATOR (V.O.)", "ARCHIVE: <what the footage shows>"])
    assert.ok(brief.includes(s), "brief names: "+s);
  assert.ok(!/interview questions \+ expected testimony beats/.test(brief), "the old unnamed wording is gone");
  assert.ok(!/\.$/.test(brief), "formatDraftLine adds the full stop");
  assert.ok(!PROJECT_NOUNS.test(brief) && !VENDOR_RE.test(brief));
  reset(); box.__replies = ["", "", ""];
  await box.aiDraftScene(SC, BM, null, DOC, DOC_CAST, [SC]);
  await box.aiPolishScene(SC, BM, [], null, DOC, {});
  await box.aiWriteBeatText(SC, BM, 2, { blocks:[{ beat:1, type:"action", text:"Leonor walks the wall." }] }, null, DOC, {});
  assert.equal(box.__prompts.length, 3);
  box.__prompts.forEach((p,i)=>{
    assert.ok(p.includes("FORMAT: "+brief+"."), "prompt "+i+" carries the documentary page forms");
    assert.ok(p.includes("ONE SPEECH = ONE \"dia\" block"), "prompt "+i+" carries the speech forms");
  });
  reset(); box.__replies = [""];
  await box.aiDraftScene(SC, BM, null, FEATURE, [], [SC]);
  assert.ok(!box.__prompts[0].includes("EXPECTED TESTIMONY") && !box.__prompts[0].includes("INTERVIEWER (O.S.)"), "a feature is not told the documentary forms");
});

await test("A3 BLOCK_SPEC teaches one speech per cue, the mid-speech (beat) and the NAME (CONT’D) re-cue", ()=>{
  const spec = vm.runInContext("BLOCK_SPEC", box);
  assert.ok(spec.includes("ONE SPEECH = ONE \"dia\" block") && spec.includes("\"char\" \u2192 \"dia\" \u2192 \"paren\" (beat) \u2192 \"dia\""));
  assert.ok(spec.includes("\"<NAME> (CONT\u2019D)\"") && spec.includes("never a \"dia\" straight after \"action\" or after another \"dia\""));
  assert.ok(!PROJECT_NOUNS.test(spec) && !VENDOR_RE.test(spec));
});

await test("A4 the retry note after a rejection gives the documentary forms to a documentary only (and the speech forms to all)", ()=>{
  const prior = { kind:"invalid", issues:["character cue or dialogue embedded in action"],
    details:[{ issue:"character cue or dialogue embedded in action", text:"INTERVIEW (LATER, TO LEONOR): What did your father say?" }] };
  const d = box.screenplayRetryNote(prior, DOC), f = box.screenplayRetryNote(prior, FEATURE);
  assert.ok(d.includes("THIS IS A DOCUMENTARY") && d.includes("INTERVIEWER (O.S.)") && d.includes("EXPECTED TESTIMONY: <subject> on <topic>") && d.includes("never words written for a real person"));
  assert.ok(!f.includes("DOCUMENTARY") && !f.includes("EXPECTED TESTIMONY"), "a feature's retry note has no documentary forms");
  for(const n of [d, f]) assert.ok(n.includes("\"dia\" \u2192 \"paren\" (beat) \u2192 \"dia\"") && n.includes("\"<NAME> (CONT\u2019D)\""));
  // the live project decides when a writer passes none (Redraft from the Script view)
  box.turnProject = DOC;
  assert.ok(box.screenplayRetryNote(prior).includes("THIS IS A DOCUMENTARY"));
  box.turnProject = undefined;
  assert.equal(box.screenplayRetryNote({ kind:"unreadable" }, DOC), "", "no note without a format rejection");
});

/* ======================= B. the check accepts the forms, not a real person's words ======================= */
const ACCEPT = [
  "EXPECTED TESTIMONY: Leonor on the night the wall went.",
  "EXPECTED TESTIMONY: Leonor Sarmento on the flood of 1953 — recorded on the day.",
  "EXPECTED TESTIMONY: LEONOR SARMENTO on the flood night.",
  "EXPECTED TESTIMONY: Armindo on hands, heel and clay.",
  "EXPECTED TESTIMONY: Leonor on her father's boat.",
  "Leonor sits by the salt pan. EXPECTED TESTIMONY: Leonor on the night the wall went.",
  "EXPECTED TESTIMONY — LEONOR: her account of the flood night",
  "EXPECTED TESTIMONY — LEONOR: her account of the flood night, and what her father said about the wall.",
  "EXPECTED TESTIMONY — LEONOR SARMENTO: how the salt pans were worked before the dam.",
  "EXPECTED TESTIMONY — ARMINDO: what the tide took, and how he reads it now.",
  "EXPECTED TESTIMONY / ARMINDO: how he reads the tide — hands, heel and clay.",
  "EXPECTED TESTIMONY - ARMINDO: on hands, heel and clay.",
  "EXPECTED TESTIMONY — LEONOR: on the flood night.",
  "EXPECTED TESTIMONY — LEONOR: about the wall, and what her father kept.",
  // a quoted TITLE or NICKNAME is not a line written for anyone (review: these were rejected)
  "EXPECTED TESTIMONY: Leonor on the report \"Salt and Tide, 1953\".",
  "EXPECTED TESTIMONY: Armindo on the \"Iron Wall\" nickname.",
  "EXPECTED TESTIMONY: Leonor on the song “Mar Salgado” her mother sang.",
  "EXPECTED TESTIMONY — LEONOR: on the song “Mar Salgado” her mother sang.",
  "EXPECTED TESTIMONY — LEONOR: Her account of the night the wall went.",
  "EXPECTED TESTIMONY — LEONOR (record): her account of the flood night.",
  "EXPECTED TESTIMONY — LEONOR (sit-down, to be recorded): her account of the flood night.",
  "EXPECTED TESTIMONY — LEONOR: her account of the flood. The camera holds on her hands.",
];
const REJECT = [
  // words attributed to the named subject
  "EXPECTED TESTIMONY — LEONOR: The wall went at midnight.", "EXPECTED TESTIMONY — LEONOR: I never wanted the gate.",
  "EXPECTED TESTIMONY — LEONOR: “the wall went at midnight”", "EXPECTED TESTIMONY — LEONOR: \"the wall went at midnight\"",
  "EXPECTED TESTIMONY — LEONOR: we kept the walls up for forty years", "EXPECTED TESTIMONY — LEONOR: the wall went at midnight!",
  "EXPECTED TESTIMONY — LEONOR: why did the wall go?", "EXPECTED TESTIMONY — LEONOR: come home, mama.",
  "EXPECTED TESTIMONY — LEONOR: THE WALL WENT AT MIDNIGHT.", "EXPECTED TESTIMONY — LEONOR: her account of the flood. Never again.",
  "EXPECTED TESTIMONY — LEONOR: her account of the flood. Salt took everything.", "EXPECTED TESTIMONY — LEONOR: Her account was a lie.",
  "EXPECTED TESTIMONY — LEONOR: His story never changed.", "EXPECTED TESTIMONY — LEONOR: oh, the wall went at midnight.",
  "EXPECTED TESTIMONY — LEONOR: the wall wasn't hers.", "EXPECTED TESTIMONY — LEONOR: the wall went at midnight, Armindo.",
  "EXPECTED TESTIMONY — LEONOR: goodbye, papa.", "EXPECTED TESTIMONY — LEONOR: the wall is gone. My father built it.",
  "EXPECTED TESTIMONY — LEONOR: her account of what her father said, ‘keep the pans’.",
  "EXPECTED TESTIMONY — LEONOR: her account of the flood. LEONOR: The wall went at midnight.",
  // review: the named form's text must open as a TOPIC — lowercase words, "In her own words, …",
  // "Her words: …", "Her testimony: …" and a lowercase "i" are her line
  "EXPECTED TESTIMONY — LEONOR: i never wanted the gate", "EXPECTED TESTIMONY — LEONOR: i was nine. the wall went at midnight.",
  "EXPECTED TESTIMONY — LEONOR: In her own words, the sea took everything and nobody came.",
  "EXPECTED TESTIMONY — LEONOR: Her words: the sea took everything, nobody came, nobody ever comes.",
  "EXPECTED TESTIMONY — LEONOR: Her testimony: the wall went at midnight and papa went with it.",
  "EXPECTED TESTIMONY — LEONOR: the water took everything, and papa with it", "EXPECTED TESTIMONY — LEONOR: i never went back.",
  "EXPECTED TESTIMONY — LEONOR: nobody came. nobody ever comes out here.", "EXPECTED TESTIMONY — ARMINDO: hands, heel and clay.",
  "EXPECTED TESTIMONY — LEONOR: her account of the flood night: the sea took everything.",
  "EXPECTED TESTIMONY: Leonor on the night i lost everything.", "EXPECTED TESTIMONY: i never went back.",
  // a quote that is not a title: a pronoun, sentence punctuation, lowercase words
  "EXPECTED TESTIMONY: Leonor on “I Lost Everything That Night”.", "EXPECTED TESTIMONY: Leonor on the words “Keep The Pans.”",
  "EXPECTED TESTIMONY: Leonor on the words ‘keep the pans’.",
  // a voice or delivery bracket makes it her line
  "EXPECTED TESTIMONY — LEONOR (V.O.): her account of the flood.", "EXPECTED TESTIMONY — LEONOR (softly): her account of the flood.",
  "EXPECTED TESTIMONY — LEONOR (to camera): her account of the flood.",
  // only the exact shape: other labels naming her stay her line
  "EXPECTED TESTIMONY — LEONOR'S MOTHER: her account of the flood.", "EXPECTED TESTIMONY — LEONOR — NOTE: her account of the flood.",
  "EXPECTED TESTIMONY, LEONOR: her account of the flood.", "EXPECTED TESTIMONY LEONOR: her account of the flood.",
  "INTERVIEW — LEONOR: her account of the flood night", "TESTIMONY — LEONOR: her account of the flood night",
  "TESTIMONY BED — LEONOR: her account of the flood night", "LEONOR — EXPECTED TESTIMONY: her account of the flood night",
  // quoted words inside any planned-testimony line; I / you / we
  "EXPECTED TESTIMONY: Leonor on what her father said: “Keep the pans.”", "EXPECTED TESTIMONY: Leonor on what her father said: \"Keep the pans.\"",
  "EXPECTED TESTIMONY (Leonor, record): her account of what her father said: “Keep the pans.”", "EXPECTED TESTIMONY: Leonor on why we left.",
  // an interviewer's spoken question belongs in a cue, never in action
  "INTERVIEWER: What did your father say?", "INTERVIEWER (O.S.): What did your father say about the gate?", "Q: What did your father say?",
  "INTERVIEW (LATER, TO LEONOR): What did your father say when he gave you the rodo?",
];

await test("B1 the documentary forms pass the writers and never trip the Script check", ()=>{
  for(const l of ACCEPT){
    const v = verdict(l);
    assert.equal(v.valid, true, "accepted: "+l+" "+JSON.stringify(v.issues));
    assert.ok(v.blocks.some(b=>b.type==="action" && b.text===l), "stays one action line, word for word: "+l);
    assert.equal(scriptWarns(l), false, "no Script check warning: "+l);
  }
});

await test("B2 actual words attributed to a real subject stay rejected — by the writers and the Script check alike", ()=>{
  for(const l of REJECT){
    const v = verdict(l);
    assert.equal(v.valid, false, "rejected: "+l);
    assert.deepEqual(plain(v.issues), ["character cue or dialogue embedded in action"], l);
    assert.equal(scriptWarns(l), true, "the Script check warns: "+l);
  }
  // the named form is a cast member's only: an unknown name is no subject of the rule (and
  // an unknown label with a lowercase note was already a readout)
  assert.equal(box.screenplayLabelClass("EXPECTED TESTIMONY — MARCUS", box.screenplaySpeakers([], null, DOC_CAST)), "live");
  assert.equal(box.screenplayLabelClass("EXPECTED TESTIMONY — LEONOR", box.screenplaySpeakers([], null, DOC_CAST)), "testimony");
  assert.equal(box.screenplayLabelClass("INTERVIEW — LEONOR", box.screenplaySpeakers([], null, DOC_CAST)), "speaker");
});

await test("B3 an interviewer's question is a normal cue: INTERVIEWER (O.S.) + dialogue passes, untouched, and the Script check is clean", ()=>{
  const r = box.resolveScreenplayResponse(reply([
    [1, [["action","Dawn over the slumped wall. LEONOR SARMENTO (70s) walks it slowly."], ["char","INTERVIEWER (O.S.)"], ["dia","What did your father say when the wall went?"]]],
    [2, [["action","EXPECTED TESTIMONY: Leonor on the flood night and her father's words."], ["action","ARCHIVE: A 1953 photograph of the pans, walls intact."],
         ["char","NARRATOR (V.O.)"], ["dia","The pans were worked by hand for three hundred years."]]]]), SC, BM, { requireAllBeats:true, cast:DOC_CAST });
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  const at = r.blocks.findIndex(b=>b.type==="char");
  assert.deepEqual(plain(types(r.blocks).slice(at, at+2)), ["char|INTERVIEWER (O.S.)", "dia|What did your father say when the wall went?"]);
  assert.deepEqual(plain(r.normalized), [], "nothing re-typed");
  box.turnCast = DOC_CAST;
  const rep = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, ...r.blocks] }, BM);
  box.turnCast = undefined;
  assert.equal(rep.stats.errors, 0, JSON.stringify(rep.issues));
  assert.ok(!rep.issues.some(x=>/dialogue|cue|orphan/.test(x.code)), JSON.stringify(rep.issues));
});

await test("B4 a documentary scene written in the named forms is committed — not a rough stand-in (the Sc 6 stand-in class)", async ()=>{
  reset();
  box.__replies = [reply([
    [1, [["action","Dawn. LEONOR SARMENTO (70s) walks the slumped salt pan wall; ARMINDO SARMENTO (70s) watches from a crate."],
         ["char","INTERVIEWER (O.S.)"], ["dia","Where did the wall go first?"]]],
    [2, [["action","She stops where the clay gives way."], ["action","EXPECTED TESTIMONY — LEONOR: her account of the flood night, and what her father said as the wall went."],
         ["action","Armindo looks away to the water."]]]])];
  const d = await box.aiDraftScene(SC, BM, null, DOC, DOC_CAST, [SC]);
  assert.equal(d.auto, false, "MUSE's draft is kept, not a stand-in: "+JSON.stringify(d.failure && d.failure.issues));
  assert.ok(d.blocks.some(b=>b.type==="action" && b.text.startsWith("EXPECTED TESTIMONY — LEONOR: her account")));
  assert.ok(d.blocks.some(b=>b.type==="char" && b.text==="INTERVIEWER (O.S.)"));
});

/* ======================= C. mid-speech (beat) and NAME (CONT’D) ======================= */
const B = (arr, beat)=>arr.map(([type,text])=>({ beat:beat||1, type, text }));
const GRAM = /cue|parenthetical|dialogue/;
const writerOK = (blocks)=>!box.validateScreenplayBlocks(blocks, null, { cast:[] }).issues.some(i=>GRAM.test(i));
const checkOK = (blocks)=>!box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, ...blocks] }, null).issues.some(i=>/cue|orphan/.test(i.code));

await test("C1 a mid-speech parenthetical is standard form: the writers and the Script check both accept it (once, twice, after a cue parenthetical)", ()=>{
  for(const seq of [
    [["char","TOMAS"],["dia","Opal Pruitt. The prowler call."],["paren","(beat)"],["dia","There wasn't a prowler."]],     // the E2 Sc 22 reply
    [["char","ZHOU"],["paren","barely"],["dia","Probably the rain."],["paren","(barely)"],["dia","Probably nothing."]],
    [["char","NELL"],["dia","Seven."],["paren","beat"],["dia","Eight."],["paren","beat"],["dia","Nine."]],
    [["action","She counts."],["char","NELL"],["dia","Seven."],["paren","(beat)"],["dia","Eight."],["action","Her hands stop."]]]){
    assert.equal(writerOK(B(seq)), true, "writers accept: "+JSON.stringify(seq));
    assert.equal(checkOK(B(seq)), true, "Script check accepts: "+JSON.stringify(seq));
  }
  assert.deepEqual(plain(box.screenplaySpeechLinks(B([["char","N"],["dia","a"],["paren","beat"],["dia","b"]]))), [false, true, true, true]);
});

await test("C2 still out of the grammar: dia → dia, a hanging parenthetical, dialogue after action, a (beat) across a beat", ()=>{
  for(const seq of [
    [["char","ZHOU"],["dia","Probably the rain."],["dia","Probably nothing."]],
    [["char","NELL"],["dia","Seven."],["paren","(beat)"]],
    [["char","NELL"],["dia","Seven."],["paren","(beat)"],["action","She stops."]],
    [["char","NELL"],["dia","Seven."],["paren","(beat)"],["paren","(beat)"],["dia","Eight."]],
    [["char","NELL"],["dia","Seven."],["paren","(beat)"],["char","DEV"],["dia","Stop."]],
    [["paren","(beat)"],["dia","Eight."]],
    [["action","She counts."],["dia","Eight."]]]){
    assert.equal(writerOK(B(seq)), false, "writers reject: "+JSON.stringify(seq));
    assert.equal(checkOK(B(seq)), false, "Script check flags: "+JSON.stringify(seq));
  }
  const cross = [{ beat:1, type:"char", text:"NELL" }, { beat:1, type:"dia", text:"Seven." }, { beat:2, type:"paren", text:"(beat)" }, { beat:2, type:"dia", text:"Eight." }];
  assert.equal(writerOK(cross), false, "the writers keep a speech inside its beat");
});

await test("C3 the writers and the Script check agree on every cue / paren / dia / action sequence up to 5 blocks", ()=>{
  const T = ["char","paren","dia","action"], TX = { char:"NINA", paren:"(beat)", dia:"Seven.", action:"She looks up." };
  const seqs = []; const gen = (p)=>{ if(p.length) seqs.push(p); if(p.length<5) T.forEach(t=>gen([...p, t])); }; gen([]);
  // the one difference that predates this change: the writers let a cue carry two parentheticals
  const KNOWN = new Set(["char>paren>paren>dia", "char>paren>paren>paren>dia", "char>paren>paren>dia>action", "action>char>paren>paren>dia"]);
  const differ = seqs.filter(s=>{ const bl = s.map(t=>({ beat:1, type:t, text:TX[t] })); return writerOK(bl)!==checkOK(bl); }).map(s=>s.join(">"));
  assert.deepEqual(differ.filter(x=>!KNOWN.has(x)), [], "no new disagreement");
  assert.equal(seqs.length, 1364);
});

const norm = (arr)=>box.normalizeScreenplayBlocks(B(arr), { cast:[] });
await test("C4 dialogue after action is never given a speaker by guesswork: the normaliser adds nothing, the writers reject it, the retry asks for the cue", ()=>{
  // (review) the same speaker resuming, a reply whose cue was dropped (Mara would answer her own
  // question), and a documentary subject's answer after a testimony note (NARRATOR would speak
  // it) look identical on the page — so none is re-cued; each is rejected and retried
  const cases = [
    [["char","TOMAS"],["dia","Opal Pruitt."],["action","He braces."],["dia","I stayed on anyway."]],
    [["char","MARA"],["dia","Where were you?"],["action","JOHN drops his keys in the bowl."],["dia","Out."]],
    [["char","MARA"],["dia","Where were you last night?"],["action","Tomas shrugs, drops his keys in the bowl."],["dia","Out. Driving. Does it matter?"]],
    [["char","NARRATOR (V.O.)"],["dia","The pans were worked by hand."],["action","EXPECTED TESTIMONY: Leonor on the flood night."],["dia","I lost everything that night. My father, the wall, all of it."]],
    [["char","NARRATOR (V.O.)"],["dia","The pans were worked by hand."],["action","ARCHIVE: The flood of 1953."],["dia","We never went back."]],
    [["char","LEONOR (V.O.)"],["dia","The wall."],["action","The water rises."],["dia","It took everything."]],
    [["char","NELL"],["dia","Seven."],["action","She stops."],["paren","quieter"],["dia","Eight."]]];
  for(const seq of cases){
    const r = norm(seq);
    assert.equal(r.blocks.length, seq.length, "nothing added: "+JSON.stringify(seq));
    assert.deepEqual(plain(r.notes), [], JSON.stringify(seq));
    assert.ok(!r.blocks.some(b=>/CONT[’']D/.test(b.text||"") && !seq.some(([,t])=>t===b.text)), "no CONT'D invented");
    assert.equal(writerOK(r.blocks), false, "the writers reject it: "+JSON.stringify(seq));
  }
  const full = box.resolveScreenplayResponse(reply([[1, cases[1]]]), { ...SC, id:"k1", loc:"INT. KITCHEN - NIGHT" }, { rows:[{ n:1, drive:{ d:"x" }, react:{ d:"y" } }] }, { requireAllBeats:true, cast:[{ name:"Mara Voss" }, { name:"John Hale" }] });
  assert.equal(full.valid, false, "the dropped-cue reply is rejected, never committed with Mara answering herself");
  assert.ok(full.issues.includes("dialogue without a character cue"), JSON.stringify(full.issues));
  const note = box.screenplayRetryNote({ kind:"invalid", issues:full.issues, details:full.details||[] }, FEATURE);
  assert.ok(note.includes("\"<NAME> (CONT\u2019D)\"") && note.includes("dialogue straight after action always needs its speaker's cue"), note);
  // the cue the model writes itself is standard form, shown once by the renderer
  const own = norm([["char","TOMAS"],["dia","Opal."],["action","He braces."],["char","TOMAS (CONT\u2019D)"],["dia","Anyway."]]).blocks;
  assert.equal(writerOK(own), true);
  assert.ok(box.buildContdSet(own).has(own[3]), "the renderer reads it as a continuation");
});

await test("C5 the normaliser never adds a cue: after a slugline, a transition, a hanging cue or (beat), with no speech before, dia → dia, or after an INTERVIEWER", ()=>{
  for(const seq of [
    [["char","NELL"],["dia","Seven."],["scene","EXT. YARD - NIGHT"],["dia","Eight."]],
    [["char","NELL"],["dia","Seven."],["trans","CUT TO:"],["action","The yard."],["dia","Eight."]],
    [["char","NELL"],["action","She stops."],["dia","Eight."]],
    [["char","NELL"],["dia","Seven."],["paren","(beat)"],["action","She stops."],["dia","Eight."]],
    [["action","She counts."],["dia","Eight."]],
    [["char","NELL"],["dia","Seven."],["dia","Eight."]],
    [["dia","Seven."],["action","She stops."],["dia","Eight."]],
    [["char","NELL"],["dia","Seven."],["paren","(beat)"],["dia","Eight."]],
    [["char","INTERVIEWER (O.S.)"],["dia","What did your father say?"],["action","Leonor looks at the wall."],["dia","He said keep the pans."]],
    [["char","INTERVIEWER"],["dia","And then?"],["action","A long pause."],["paren","quietly"],["dia","Then nothing."]]]){
    const r = norm(seq);
    assert.equal(r.blocks.length, seq.length, "nothing added: "+JSON.stringify(seq));
    assert.deepEqual(plain(r.notes), [], JSON.stringify(seq));
  }
});

await test("C6 the writers commit a (beat) and a speech MUSE re-cued itself; a resumed speech with no cue is rejected, as before", async ()=>{
  const bm = { driverLabel:"NELL", reactorLabel:"", turnAt:1, rows:[{ n:1, drive:{ a:"Counts", d:"Nell counts the gate sequence aloud at the kitchen table." }, react:{ a:"Steadies", d:"Her hands stop trembling." } }] };
  const sc = { ...SC, id:"k1", title:"Count", loc:"INT. KITCHEN - NIGHT" };
  const r = reply([[1, [["action","Nell props the card against the salt pot."], ["char","NELL"], ["dia","Seven. Eight."], ["paren","(beat)"], ["dia","Nine."],
    ["action","Her hands stop trembling."], ["char","NELL (CONT\u2019D)"], ["dia","Ten. Seal."]]]]);
  reset(); box.__replies = [r];
  const d = await box.aiDraftScene(sc, bm, null, FEATURE, [{ name:"Nell Carrow" }], [sc]);
  assert.equal(d.auto, false, JSON.stringify(d.failure && d.failure.issues));
  assert.deepEqual(plain(types(d.blocks.filter(b=>b.type!=="scene"))), ["action|Nell props the card against the salt pot.", "char|NELL", "dia|Seven. Eight.",
    "paren|(beat)", "dia|Nine.", "action|Her hands stop trembling.", "char|NELL (CONT\u2019D)", "dia|Ten. Seal."]);
  reset(); box.__replies = [r];
  const p = await box.aiPolishScene(sc, bm, [], null, FEATURE, {});
  assert.ok(p && p.blocks.some(b=>b.text==="NELL (CONT\u2019D)"), "the redraft is committed too");
  // the same reply with the resumed line left uncued: rejected (no speaker is guessed)
  const bare = reply([[1, [["action","Nell counts."], ["char","NELL"], ["dia","Seven."], ["action","Her hands stop."], ["dia","Eight."]]]]);
  reset(); box.__replies = [bare, bare, bare];
  const bad = await box.aiDraftScene(sc, bm, null, FEATURE, [], [sc]);
  assert.equal(bad.auto, true, "dialogue after action with no cue is still rejected");
  // …and dia → dia too
  reset(); box.__replies = [reply([[1, [["action","Nell counts."], ["char","NELL"], ["dia","Seven."], ["dia","Eight."]]]]), "", ""];
  assert.equal((await box.aiDraftScene(sc, bm, null, FEATURE, [], [sc])).auto, true, "dia → dia is still rejected");
});

await test("C7 a parenthetical never carries another character's line — mid-speech or after the cue (writers and Script check)", ()=>{
  const cast = [{ name:"Mara Voss" }, { name:"John Hale" }];
  const writerFlags = (blocks)=>box.validateScreenplayBlocks(blocks, null, { cast }).issues;
  const checkCodes = (blocks)=>{ box.turnCast = cast; const r = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, ...blocks] }, null); box.turnCast = undefined; return r.issues.map(x=>x.code); };
  for(const seq of [
    [["char","MARA"],["dia","Where were you?"],["paren","(JOHN: Out.)"],["dia","Out where?"]],
    [["char","MARA"],["paren","(John: Out.)"],["dia","Out where?"]],
    [["char","MARA"],["dia","Where were you?"],["paren","(beat; JOHN: Nowhere.)"],["dia","Nowhere?"]]]){
    assert.ok(writerFlags(B(seq)).includes("character line inside a parenthetical"), "writers reject: "+JSON.stringify(seq));
    assert.ok(checkCodes(B(seq)).includes("dialogue-in-parenthetical"), "Script check flags: "+JSON.stringify(seq));
  }
  for(const seq of [
    [["char","MARA"],["dia","Where were you?"],["paren","(beat)"],["dia","Out where?"]],
    [["char","MARA"],["paren","(to John, quietly)"],["dia","Out where?"]],
    [["char","MARA (V.O.)"],["paren","(filtered)"],["dia","Pick up."]],
    [["char","MARA"],["paren","(reading the sign: CLOSED)"],["dia","Closed."]]]){
    assert.ok(!writerFlags(B(seq)).length, "writers accept: "+JSON.stringify(seq)+" "+JSON.stringify(writerFlags(B(seq))));
    assert.ok(!checkCodes(B(seq)).some(c=>/parenthetical|orphan|dialogue/.test(c)), "Script check clean: "+JSON.stringify(seq));
  }
  assert.equal(plain(box.screenplayFailureReason({ kind:"invalid", issues:["character line inside a parenthetical"] })).includes("a character’s line was written inside a parenthetical"), true);
});

/* ======================= D. downstream readers ======================= */
await test("D the beat excerpt, the Shots beat text, the micro-plan, the monologue check and the voice check keep a continued speech with its speaker", ()=>{
  const blocks = [{ beat:1, type:"action", text:"Nell counts." }, { beat:1, type:"char", text:"NELL" }, { beat:1, type:"dia", text:"Seven." },
    { beat:1, type:"paren", text:"(beat)" }, { beat:1, type:"dia", text:"Eight." }];
  assert.equal(box.screenplayBeatExcerpt({ blocks }, 1, 200), "Nell counts. NELL: Seven. (beat) Eight.");
  const ui = read("app/shots-ui.jsx");
  const cut = (name)=>{ const a = ui.indexOf("function "+name+"("); const b = ui.indexOf("\nfunction ", a+10); return ui.slice(a, b); };
  const sb = { window:{ turnContinuity:{ drafts:{ s1:{ blocks } } } } };
  vm.createContext(sb);
  vm.runInContext("var window = this.window;\n"+cut("beatScriptText")+"\n"+cut("deriveBeatMicroPlan")+"\nthis.bst = beatScriptText; this.dmp = deriveBeatMicroPlan;", sb);
  assert.equal(sb.bst("s1", 1), "Nell counts.  NELL: \u201cSeven. (beat) Eight.\u201d");
  assert.deepEqual(plain(sb.dmp("s1", 1, null).micro), ["Nell counts.", "NELL: \u201cSeven. (beat) Eight.\u201d"]);
  const drafts = { s1:{ blocks } }, scenes = [{ id:"s1", no:1 }];
  assert.deepEqual(plain(box.collectDialogue(scenes, drafts)), { NELL:[{ scene:1, line:"Seven." }, { scene:1, line:"Eight." }] });
  const long = Array(40).fill("word").join(" ");
  assert.equal(box.dialogueMonologues(scenes, { s1:{ blocks:[{ type:"char", text:"NELL" }, { type:"dia", text:long }, { type:"paren", text:"(beat)" }, { type:"dia", text:long }] } }).length, 1,
    "one speech across a (beat) is one run");
});

/* ======================= E. MUSE's product knowledge ======================= */
await test("E APP_FEATURES describes the page forms, accurately, with no vendor or project names (and survives MUSE's filter)", ()=>{
  const F = vm.runInContext("APP_FEATURES", box);
  const pf = F.find(f=>String(f.name).startsWith("Screenplay page forms"));
  assert.ok(pf, "entry exists");
  for(const s of ["MID-SPEECH (beat)", "cue, line, (beat), line", "never lists it as an orphan", "'NAME (CONT'D)'", "the writing engine is told to write it that way",
    "rejected and retried \u2014 never repaired by guessing the speaker", "another character whose cue was dropped", "a real subject's answer",
    "two dialogue blocks in a row", "a parenthetical that carries another character's line ('(JOHN: Out.)')", "'INTERVIEWER (O.S.)'", "'EXPECTED TESTIMONY: <subject> on <topic>'",
    "'EXPECTED TESTIMONY \u2014 <subject's name>: <topic>'", "every sentence opens as a topic", "lowercase words are no exception", "'In her own words, \u2026'", "a lowercase 'i' too",
    "STILL REJECTED: words attributed to a real subject", "quoted words inside any EXPECTED TESTIMONY line", "a quoted title or nickname", "remind the writing engine of these forms", "a speech continued after a (beat) stays one dialogue line"])
    assert.ok(pf.what.includes(s), "names: "+s);
  // (review) MUSE must not promise the automatic re-cue that no longer exists
  assert.ok(!/adds 'NAME \(CONT'D\)' itself|re-cued 'NAME \(CONT'D\)' automatically/.test(pf.what), "no automatic re-cue claimed");
  const sf = F.find(f=>String(f.name).startsWith("Screenplay format check"));
  assert.ok(sf.what.includes("PAGE FORMS: a mid-speech (beat)") && sf.what.includes("see 'Screenplay page forms'"));
  assert.ok(sf.what.includes("is never given a speaker automatically") && !/re-cued 'NAME \(CONT'D\)' automatically/.test(sf.what), "the format-check addendum agrees");
  for(const t of [pf.name, pf.what]){ assert.ok(!VENDOR_RE.test(t), "no vendor: "+(t.match(VENDOR_RE)||[])[0]); assert.ok(!PROJECT_NOUNS.test(t), "no project names"); }
  const brief = vm.runInContext("appBrief()", box);
  assert.ok(brief.includes("Screenplay page forms") && brief.includes("EXPECTED TESTIMONY: <subject> on <topic>"), "reaches MUSE's brief");
});

/* ======================= F. cache keys ======================= */
await test("F the changed files load under new keys, script.jsx and ai.jsx together, and the classifier version is in step", ()=>{
  const html = read("TURN.html");
  const key = (f)=>(html.match(new RegExp(f.replace(/\./g, "\\.")+"\\?v=([^\"']+)")) || [])[1] || "";
  assert.equal(key("app/script.jsx"), key("app/ai.jsx"), "script.jsx and ai.jsx share a key");
  const PRE = { "app/script.jsx":"20260927-screentime1", "app/ai.jsx":"20260927-screentime1", "app/formats.jsx":"20260927-screentime1", "app/shots-ui.jsx":"20260926-decisions2" };
  for(const [f, pre] of Object.entries(PRE)){ const k = key(f); assert.ok(k && k!==pre && k.slice(0,8)>="20260927", f+" re-keyed: "+k); }
  assert.equal(box.SP_LABELS_VERSION, 3);
  assert.equal(vm.runInContext("SP_LABELS_EXPECTED", box), 3);
  assert.equal(box.screenplayLabelsInStep(), true);
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

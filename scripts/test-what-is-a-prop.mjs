#!/usr/bin/env node
/* WHAT IS A PROP (owner 2026-10-29 — "minimise the props … unless they really have a significance in the story";
   "go ahead with all six, update the pipeline doc"). A script breakdown sends every object to costume, set
   dressing, background props or hero props; only hero props are cards.
   1  only the screenplay creates props: no cards from the character briefs (Draft all, the auto-seed, the
      Props Master, the worn-item build), no "Proposed" group, "Attach item to prop…" targets story props only
   2  the tests: it returns (2+ scenes), something happens to it, or the story turns on it — applied by the
      app, with exact passages for every change and turn
   3  every card says why; the review lists the rest under "Not props — left to the shot" with "Make it a prop"
   4  one object, one card: the review asks once whether two passages are the same object
   5  a worn item is a story prop when the tests pass
   6  nothing is deleted on its own: Not story props, "Keep as a story prop", one button to Recently deleted
   +  the doc, Frances, and the Lookbook's Recently deleted as the compact header button (as Props)
     node scripts/test-what-is-a-prop.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
const transform = (src, filename)=>transformSync(src, { presets:[["@babel/preset-react",{ runtime:"classic" }]],
  plugins:["@babel/plugin-transform-block-scoping"], babelrc:false, configFile:false, filename }).code;
const between = (src, a, b)=>{ const i = src.indexOf(a); assert.ok(i>=0, "missing: "+a); const j = src.indexOf(b, i+a.length); assert.ok(j>i, "missing end: "+b); return src.slice(i, j); };
let checks = 0, failed = 0;
const test = async (name, fn)=>{ try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 6).join("\n    ")); } };
const J = (x)=>JSON.parse(JSON.stringify(x));
const noop = ()=>{};
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n)
  : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const buttons = (tree)=> findAll(tree, n=>n.type==="button");
const R = { Fragment:"fragment", createElement:el, calls:[], setters:{},
  useState(init){ const i = R.calls.length; const v = typeof init==="function" ? init() : init; R.calls.push(v);
    return [v, (x)=>{ R.setters[i] = typeof x==="function" ? x(v) : x; }]; },
  useEffect:noop, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f,
  reset(){ R.calls = []; R.setters = {}; } };
const icon = new Proxy({}, { get:()=>()=>null });

const props = read("app/props.jsx"), ps = read("app/prop-screenplay.js"), app = read("app/app.jsx"), ai = read("app/ai.jsx"),
  agents = read("app/agents.jsx"), art = read("app/artroom.jsx"), lb = read("app/lookbook.jsx"), doc = read("docs/Story Pipeline.md"),
  html = read("TURN.html");

let confirms = [], answer = true;
const box = { console, React:R, Icon:icon, Set, Map, Object, Array, String, Number, Math, JSON, Date, Promise, RegExp,
  document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {}, requestAnimationFrame:noop,
  nbCostChip:(count)=>({ type:"chip", props:{ count }, children:[] }), nbImageCostText:(n)=>String(12*n),
  nbGetImage:()=>"", nbLoadImage:async ()=>"",
  appConfirm:async (o)=>{ confirms.push(o); return answer; },
  useBatchGen:()=>({ activeId:null, begin:noop, setMsg:noop, advance:noop }),
  usePager:()=>({ slice:(a)=>a }), PagerBar:"PagerBar", NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar",
  ImageLightbox:"ImageLightbox", InfoTip:"InfoTip", RecentlyDeleted:"RecentlyDeleted", RenderStylePicker:"RenderStylePicker",
  SheetFrame:"SheetFrame", SheetField:"SheetField", CardFold:"CardFold", CopyBox:"CopyBox", EditText:"EditText", SceneChipPager:"SceneChipPager",
  scenesInStoryOrder:(s)=>s||[], roomCopy:()=>({}), scenesWhereCharacterAppears:()=>[], turnContinuity:{ scenes:[], locations:[] },
  useImageGen:()=>({ gening:false, genUrl:"", generate:async ()=>true }),
  splitListItems:(t)=>String(t||"").split(/\s*;\s*/).map(x=>x.trim()).filter(Boolean), joinListItems:(xs)=>xs.join("; "),
};
box.window = box; vm.createContext(box);
vm.runInContext(ps, box, { filename:"app/prop-screenplay.js" });
vm.runInContext(transform(props, "props.jsx"), box, { filename:"app/props.jsx" });
const P = box.PropScreenplay;

const scenes = [{ id:"s2", no:2, title:"Ramp" }, { id:"s3", no:3, title:"Deck" }, { id:"s6", no:6, title:"Wake" }];
const drafts = {
  s2:{ blocks:[{ type:"action", text:"Nives hands Aurelio a sealed letter." }, { type:"dialogue", text:"Don't open it until Elba." }] },
  s3:{ blocks:[{ type:"action", text:"Aurelio drinks a cup of coffee at the rail." }] },
  s6:{ blocks:[{ type:"action", text:"Aurelio tears the letter open and reads it." }] } };
const src = (sceneId, sceneNo, quote, presence)=>({ sceneId, sceneNo, block:1, quote, presence:presence||"handled" });
const cast = [{ id:"aur", name:"Aurelio" }, { id:"niv", name:"Nives" }];

/* ═══ 2 — the tests ═══ */
await test("2a returns in two scenes → a story prop, and it says why", ()=>{
  const letter = { id:"l", name:"Sealed letter", screenplaySources:[src("s2",2,"Nives hands Aurelio a sealed letter."), src("s6",6,"Aurelio tears the letter open and reads it.")] };
  assert.equal(P.isStoryProp(letter, drafts), true); assert.equal(P.group(letter, drafts), "story");
  assert.deepEqual(J(P.significance(letter, drafts).reasons), ["Returns in scenes 2 and 6"]);
});
await test("2b something happens to it → a story prop (story events and the read's changes count)", ()=>{
  const ev = { id:"x", name:"Ticket", screenplaySources:[src("s2",2,"q")], continuityEvents:[{ type:"handed_over", sceneId:"s2", source:{ sceneNo:2 } }] };
  assert.deepEqual(J(P.significance(ev).reasons), ["changes hands in 2"]);
  const ch = { id:"y", name:"Ticket", screenplaySources:[src("s2",2,"q")], storyChanges:[{ what:"opened", sceneNo:6 }, { what:"opened", sceneNo:2 }] };
  assert.deepEqual(J(P.significance(ch).reasons), ["opened in 2 and 6"]);
});
await test("2c the story turns on it → a story prop; one scene, nothing happens → not", ()=>{
  const turn = { id:"t", name:"Key", screenplaySources:[src("s3",3,"q")], storyTurn:{ reason:"It opens the cabin later." } };
  assert.equal(P.isStoryProp(turn), true); assert.deepEqual(J(P.significance(turn).reasons), ["the story turns on it: It opens the cabin later"]);
  const cup = { id:"c", name:"Cup of coffee", propRole:"background", screenplaySources:[src("s3",3,"Aurelio drinks a cup of coffee at the rail.")] };
  assert.equal(P.isStoryProp(cup, drafts), false); assert.equal(P.group(cup, drafts), "other");
  assert.equal(P.notPropReason(cup, drafts), "Background prop — in scene 3 only, and nothing happens to it");
  assert.equal(P.significance({ ...cup, screenplaySources:[src("s3",3,"q","mentioned")] }).sceneNos.length, 0, "a mention isn't an appearance");
});
await test("2d the user's choice: made by hand or kept → a story prop; acceptPatch keeps it", ()=>{
  assert.equal(P.isStoryProp({ id:"h", name:"Lantern", manual:true }), true);
  assert.equal(P.isStoryProp({ id:"o", name:"Lantern", origin:{ kind:"manual" } }), true);
  const kept = { id:"k", name:"Wallet", fromCast:true, ...P.acceptPatch("2026-10-29T00:00:00.000Z") };
  assert.equal(kept.keptAsProp, true); assert.equal(P.isStoryProp(kept), true);
  assert.equal(P.batchSkip(kept), false); assert.equal(P.batchSkip({ id:"w", name:"Watch", kind:"worn", fromCast:true }), true);
});
await test("2e the read: changes need an on-screen passage, a turn may quote dialogue; bad quotes are rejected", ()=>{
  const raw = { props:[{ name:"Sealed letter", role:"hero", kind:"carried", sources:[{ block:1, quote:"Nives hands Aurelio a sealed letter.", presence:"handled" }],
    changes:[{ what:"handed over", block:1, quote:"Nives hands Aurelio a sealed letter." }, { what:"read", block:2, quote:"Don't open it until Elba." }, { what:"burned", block:1, quote:"not in the text" }],
    turn:{ reason:"Its words pay off at Elba.", block:2, quote:"Don't open it until Elba." } }] };
  const r = P.normalizeResult(raw, scenes[0], drafts, cast, []);
  const c = r.candidates[0];
  assert.deepEqual(J(c.storyChanges.map(x=>x.what)), ["handed over"], "a dialogue line or an invented quote is no change");
  assert.equal(c.storyTurn.reason, "Its words pay off at Elba."); assert.equal(c.storyTurn.quote, "Don't open it until Elba.");
  assert.equal(c.propRole, "hero"); assert.equal(r.rejected, 2);
  const noTurn = P.normalizeResult({ props:[{ ...raw.props[0], changes:[], turn:{ reason:"x", block:1, quote:"made up" } }] }, scenes[0], drafts, cast, []).candidates[0];
  assert.equal(noTurn.storyTurn, null);
});
await test("2f the prompt sorts like a script breakdown and is strict; the app decides", ()=>{
  const fx = between(ai, "async function aiExtractScreenplayProps(", "window.aiExtractScreenplayProps=aiExtractScreenplayProps;");
  for(const s of ["the way a film crew does a script breakdown", "'hero' — a prop the story depends on", "'background' — an ordinary object handled or seen once",
    "'costume' — something worn", "'dressing' — something that sits in the place and nobody uses", "Most objects are NOT hero props: be strict.",
    "Leave turn empty for almost every object.", "put that catalog id in maybeSameAs", "Use concise names a crew would write on a breakdown sheet"])
    assert.ok(fx.includes(s), s);
  assert.ok(fx.includes("return {candidates:contract.settleCandidates(candidates,existing),failures,rejected};"));
  assert.ok(fx.includes("contract.mergeCandidate(prior,p)"));
});

/* ═══ 3 + 4 — the review ═══ */
const cand = (i, name, sources, extra)=>({ reviewId:"candidate-"+i, name, aliases:[], warnings:[], contentNotes:"", identityNote:"", kind:"carried",
  ownerId:"", ownerName:"", locationId:"", screenplaySources:sources, continuityEvents:[], storyChanges:[], target:"new", includeEvents:false, ...(extra||{}) });
await test("3a settleCandidates: passing ones are added, the rest skipped as not props; a mention stays skipped", ()=>{
  const cs = P.settleCandidates([
    cand(0, "Sealed letter", [src("s2",2,"a"), src("s6",6,"b")]),
    cand(1, "Cup of coffee", [src("s3",3,"c")], { propRole:"background" }),
    cand(2, "Rumour", [src("s2",2,"d","mentioned")])], []);
  assert.deepEqual(J(cs.map(c=>[c.target, !!c.notProp])), [["new", false], ["skip", true], ["skip", false]]);
  const made = P.settleCandidates(cs.map(c=>c.reviewId==="candidate-1" ? { ...c, keptAsProp:true, target:c.priorTarget } : c), []);
  assert.deepEqual(J([made[1].target, made[1].notProp]), ["new", false], "Make it a prop");
});
await test("3b a link to a card counts that card's passages, and a kept card's link is always added", ()=>{
  const card = { id:"card", name:"Sealed letter", screenplaySources:[src("s2",2,"a")] };
  const [c] = P.settleCandidates([cand(0, "Letter", [src("s6",6,"b")], { target:"card" })], [card]);
  assert.equal(c.target, "card"); assert.deepEqual(J(P.candidateSignificance(c, [card]).reasons), ["Returns in scenes 2 and 6"]);
  const [k] = P.settleCandidates([cand(0, "Wallet", [src("s3",3,"c")], { target:"kept" })], [{ id:"kept", name:"Wallet", keptAsProp:true }]);
  assert.equal(k.target, "kept");
});
await test("4a the same-object question, in scene numbers; Yes merges into one card that then passes", ()=>{
  let cs = P.settleCandidates([cand(0, "Sealed letter", [src("s2",2,"a")]), cand(1, "The letter", [src("s6",6,"b")], { maybeSameAs:"candidate-0" })], []);
  assert.deepEqual(J(cs.map(c=>c.target)), ["skip", "skip"], "apart, each is named once");
  const q = P.sameQuestion(cs[1], cs, []);
  assert.equal(q.text, "Is the letter in scene 6 the one from scene 2?");
  const yes = P.answerSame(cs, "candidate-1", true, []);
  assert.equal(yes.length, 1); assert.deepEqual(J(yes[0].aliases), ["The letter"]); assert.equal(yes[0].target, "new");
  const no = P.answerSame(cs, "candidate-1", false, []);
  assert.equal(no.length, 2); assert.equal(P.sameQuestion(no[1], no, []), null, "asked once");
});
await test("4b a question about an existing card: Yes links the passage to that card", ()=>{
  const card = { id:"card", name:"Sealed letter", screenplaySources:[src("s2",2,"a")] };
  const cs = P.settleCandidates([cand(0, "Letter", [src("s6",6,"b")], { maybeSameAs:"card" })], [card]);
  assert.equal(P.sameQuestion(cs[0], cs, [card]).text, "Is the letter in scene 6 the one from scene 2?");
  const yes = P.answerSame(cs, "candidate-0", true, [card]);
  assert.equal(yes[0].target, "card");
});
await test("3c the review panel: why, the question with its two buttons, Not props with Make it a prop", ()=>{
  R.reset();
  let cs = P.settleCandidates([cand(0, "Sealed letter", [src("s2",2,"a"), src("s6",6,"b")]),
    cand(1, "Cup of coffee", [src("s3",3,"c")], { propRole:"background" }),
    cand(2, "Ticket", [src("s2",2,"d")]), cand(3, "Ticket stub", [src("s6",6,"e")], { maybeSameAs:"candidate-2" })], []);
  let next = null;
  const tree = box.PropExtractionReview({ review:{ candidates:cs, failures:[], rejected:0 }, onChange:(r)=>{ next = r; }, onApply:noop, onClose:noop,
    props:[], characters:cast, locations:[] });
  const t = textOf(tree);
  assert.ok(t.includes("Why it's a prop: Returns in scenes 2 and 6"));
  assert.ok(t.includes("Is the ticket stub in scene 6 the one from scene 2?"), "an open question stays in the main list");
  assert.ok(t.includes("Not props — left to the shot (1)") && t.includes("Background prop — used once · scene 3"));
  assert.ok(t.includes("Only objects the story depends on become props"));
  buttons(tree).find(b=>textOf(b)==="Yes, the same").props.onClick();
  assert.equal(next.candidates.length, 3); assert.equal(next.candidates.find(c=>c.name==="Ticket").target, "new");
  buttons(tree).find(b=>textOf(b)==="Make it a prop").props.onClick();
  const cup = next.candidates.find(c=>c.name==="Cup of coffee"); assert.equal(cup.keptAsProp, true); assert.equal(cup.target, "new");
});
await test("3d applying stores why: the read's changes (events too, even when not added), the turn and Make it a prop", ()=>{
  const d = { ...cand(0, "Ticket", [src("s2",2,"Nives hands Aurelio a sealed letter.")]), target:"new", keptAsProp:true,
    storyTurn:{ reason:"r", sceneNo:2 }, continuityEvents:[{ type:"handed_over", sceneId:"s2", source:{ sceneNo:2, quote:"Nives hands Aurelio a sealed letter." } }] };
  const [p] = P.accept([], [d], drafts);
  assert.equal(p.keptAsProp, true); assert.equal(p.storyTurn.reason, "r");
  assert.deepEqual(J(p.storyChanges.map(c=>c.what)), ["changes hands"]); assert.equal((p.continuityEvents||[]).length, 0);
  assert.equal(P.isStoryProp(p, drafts), true);
});

/* ═══ 3 · 6 — the cards and the tab ═══ */
await test("3e a story prop's card says why; a costume card says why not and can be kept", ()=>{
  R.reset();
  const story = box.PropSheet({ p:{ id:"l", name:"Sealed letter", kind:"carried", ownerId:"aur", ownerName:"Aurelio", screenplaySources:[src("s2",2,"Nives hands Aurelio a sealed letter."), src("s6",6,"Aurelio tears the letter open and reads it.")] },
    project:{}, characters:cast, scenes, drafts, onUpdate:noop, onDelete:noop, onDraft:noop });
  assert.ok(textOf(story).includes("Why it's a prop: Returns in scenes 2 and 6")); assert.ok(!textOf(story).includes("Not a story prop"));
  R.reset(); let patch = null;
  const badge = box.PropSheet({ p:{ id:"b", name:"Company badge", kind:"worn", ownerId:"aur", ownerName:"Aurelio", fromCast:true, origin:{ kind:"costume", characterName:"Aurelio" } },
    project:{}, characters:cast, scenes, drafts, onUpdate:(id, x)=>{ patch = x; }, onDelete:noop, onDraft:noop });
  const t = textOf(badge);
  assert.ok(t.includes("Not a story prop") && t.includes("Costume from Aurelio's look — drawn on Aurelio's character sheet"));
  assert.ok(!t.includes("Not in screenplay"), "one badge, not two");
  buttons(badge).find(b=>textOf(b)==="Keep as a story prop").props.onClick(); assert.equal(patch.keptAsProp, true);
});
await test("6a the Props tab: Not story props bar → 'Show them' and 'Move them to Recently deleted' (asks first, every card)", async ()=>{
  const list = [{ id:"l", name:"Sealed letter", kind:"carried", ownerId:"aur", screenplaySources:[src("s2",2,"a"), src("s6",6,"b")] },
    { id:"b", name:"Company badge", kind:"worn", ownerId:"aur", ownerName:"Aurelio", fromCast:true },
    { id:"w", name:"Wallet", kind:"carried", ownerId:"aur", ownerName:"Aurelio", fromCast:true }];
  R.reset(); const deleted = [];
  const tree = box.PropSheets({ project:{}, props:list, characters:cast, scenes, drafts:{}, onUpdate:noop, onDraft:noop, onDraftAll:noop, onAdd:noop,
    onImportProps:noop, onDelete:(id)=>deleted.push(id), trashItems:[] });
  const t = textOf(tree);
  assert.ok(t.includes("2 cards aren't story props"), t.slice(0,400));
  assert.deepEqual(findAll(tree, n=>n.type==="option" && ["all","story","other"].includes(n.props.value)).map(textOf),
    ["All objects (3)", "Story props (1)", "Not story props (2)"]);
  const bin = buttons(tree).find(b=>b.props["data-testid"]==="prop-notstory-bin");
  confirms = []; answer = false; await bin.props.onClick(); assert.equal(deleted.length, 0, "Cancel moves nothing");
  confirms = []; answer = true; await bin.props.onClick();
  assert.deepEqual(deleted, ["b", "w"]); assert.equal(confirms[0].title, "Move 2 cards to Recently deleted?");
  assert.deepEqual(J(confirms[0].items), ["Company badge · Aurelio", "Wallet · Aurelio"]);
  assert.ok(app.includes("setTrash(t=>({ ...t, props:[ _trashStamp(p), ...(t.props||[]).filter(x=>x.id!==id) ] }));"), "deleteProp goes to Recently deleted");
});
await test("6c a redraft never demotes a story prop: the tab reads its saved passages (the card shows 'sources changed')", ()=>{
  const sheets = between(props, "function PropSheets(", "window.PropSheets = PropSheets;");
  assert.ok(sheets.includes("const groupOf = (p)=> window.PropScreenplay.group(p);"));
  const letter = { id:"l", name:"Sealed letter", screenplaySources:[src("s2",2,"gone"), src("s6",6,"gone too")] };
  assert.equal(P.group(letter), "story"); assert.equal(P.group(letter, {}), "other", "only with drafts given do moved passages count");
});
await test("6b an empty Props tab offers to read the screenplay, not to pull the cast's items", ()=>{
  R.reset();
  const tree = box.PropSheets({ project:{}, props:[], characters:cast, scenes, drafts, onUpdate:noop, onDraft:noop, onDraftAll:noop, onAdd:noop,
    onImportProps:noop, onDelete:noop, castHasProps:true, trashItems:[] });
  const labels = buttons(tree).map(textOf);
  assert.ok(labels.includes("Read the screenplay for props") && labels.includes("Add by hand"), labels.join(" | "));
  assert.ok(!labels.includes("Draft all specifications"));
  assert.ok(textOf(tree).includes("Costume stays on the character sheets, set dressing in the locations"));
});

/* ═══ 1 — only the screenplay creates props ═══ */
await test("1a the app never makes cards from the cast: Draft all, the auto-seed, the agents' surface, the worn build", ()=>{
  const calls = app.split("propsFromCast(").length-1;
  assert.equal(calls, 0, "no propsFromCast call left in app.jsx");
  assert.ok(app.includes("deriveCast: ()=> 0,"));
  assert.ok(!app.includes("seedPropsFromCast"));
  const boot = between(app, "const onCharacterSheetDone = async (e, manual)=>{", "const onPropDrafted");
  assert.ok(boot.includes("p.kind===\"worn\" && (!_PSw || _PSw.isStoryProp(p))"), "only worn STORY props get their own sheet");
});
await test("1b the Props Master: no brief step; the plan says what a prop is", ()=>{
  const pm = between(agents, "async function agentPropsMaster(ctx){", "async function agentLocationScout(ctx){");
  assert.ok(!pm.includes("pm.deriveCast()") && !pm.includes("castN"));
  assert.ok(pm.includes("Costume stays on the character sheets, set dressing in the locations, objects used once in the shot's words."));
});
await test("1c the character card lists story props only — no 'Create card', no 'Make N worn-item sheets'", ()=>{
  const card = between(art, "function CharacterSheet({", "function CharacterSheets(");
  assert.ok(card.includes("const rowShown = (r)=> !!r.prop && (!_PSc || _PSc.isStoryProp(r.prop) || !!ownedSheetMap[r.prop.id]);"));
  assert.ok(!card.includes('"Create card"') && !card.includes("linked-props-make"));
  assert.ok(card.includes('"Story props \\u2014 worn ones attach to this sheet; carried ones attach at the shot"'));
});
await test("1d 'Attach item to prop…' attaches to an existing story prop only, and says so when there is none", ()=>{
  const m = between(art, "function PropReferenceModal({", "function PropSheetReferenceModal(");
  assert.ok(!m.includes("__new") && !m.includes("turnCreatePropFromReference") && !m.includes("Create new prop"));
  assert.ok(m.includes("_PSr.isStoryProp(p)"));
  assert.ok(m.includes("No story props yet \\u2014 read the screenplay for props on the Props tab first."));
});

/* ═══ 5 — worn story props ═══ */
await test("5 a worn item the screenplay makes matter is a story prop", ()=>{
  const ring = { id:"r", name:"Wedding band", kind:"worn", ownerId:"niv", screenplaySources:[src("s6",6,"q","worn")],
    storyChanges:[{ what:"taken off", sceneNo:6 }] };
  assert.equal(P.isStoryProp(ring), true); assert.deepEqual(J(P.significance(ring).reasons), ["taken off in 6"]);
  assert.equal(P.isStoryProp({ ...ring, storyChanges:[] }), false, "worn once, nothing happens → costume");
});

/* ═══ + — the doc, Frances, the Lookbook bin, the cache keys ═══ */
await test("+a the pipeline doc records the owner's approval and the six points", ()=>{
  const step = between(doc, "*(approved 2026-10-29 by owner — \"go ahead with all six, update the pipeline doc\"", "  - **Draft all characters**");
  for(const s of ["**costume**", "**set\n    dressing**", "**background props**", "**hero props**", "**Only the screenplay creates props.**", "**The tests.**",
    "**Each card says why**", "**One object, one card.**", "**A worn item can still be a story prop**", "**Nothing is deleted on its own.**"])
    assert.ok(step.includes(s), s);
});
await test("+b Frances knows it; nothing names the codename or a vendor", ()=>{
  const s = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb);
  vm.runInContext(s + "\n;this.__F = APP_FEATURES;", fb);
  const tab = fb.__F.find(f=>f.name==="Props (Art Room)").what;
  for(const x of ["WHAT IS A PROP (owner 2026-10-29", "COSTUME (anything worn", "Not props \\u2014 left to the shot", "'Is the letter in scene 6 the one from scene 2?'",
    "'Keep as a story prop'", "'Move them to Recently deleted'", "it no longer creates a card"].map(x=>x.replace(/\\u2014/g,"—")))
    assert.ok(tab.includes(x), x);
  assert.ok(!/Proposed — not in the screenplay’ in the Show menu|'Make N worn-item sheets' \(with its price\)/.test(tab));
  assert.ok(!/TURN|McKee|Claude|Anthropic/.test(tab));
});
await test("+c the Lookbook's Recently deleted is the compact header button, as on Props", ()=>{
  const head = between(lb, 'React.createElement("div",{className:"art-intro-actions"},', "onResearch && (hasResearch");
  assert.ok(head.includes('items:deleted, kind:"reference", onRestore, onPurge, compact:true'));
  assert.equal(lb.split("window.RecentlyDeleted,{").length-1, 1, "one bin, not two");
});
await test("+d the changed files load with fresh keys", ()=>{
  for(const f of ["app/prop-screenplay.js", "app/props.jsx", "app/artroom.jsx", "app/app.jsx", "app/ai.jsx", "app/agents.jsx", "app/lookbook.jsx", "app/breakdown.jsx", "app/styles.css"])
    assert.ok(["20261029-hs144", "20261030-hs145"].some(k=>html.includes(f+'?v='+k+'"')), f);
});

console.log(failed ? (checks+" checks passed, "+failed+" FAILED") : (checks+" checks passed"));
if(failed) process.exit(1);

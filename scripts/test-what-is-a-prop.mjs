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
await test("2b only a change that matters counts (changes hands, hidden, found, lost, broken…) — using something doesn't", ()=>{
  const ev = { id:"x", name:"Ticket", screenplaySources:[src("s2",2,"q")], continuityEvents:[{ type:"handed_over", sceneId:"s2", source:{ sceneNo:2 } }] };
  assert.deepEqual(J(P.significance(ev).reasons), ["changes hands in 2"]); assert.equal(P.significance(ev).tests.changes, true);
  const ch = { id:"y", name:"Ticket", screenplaySources:[src("s2",2,"q")], storyChanges:[{ what:"opened", sceneNo:6 }, { what:"opened", sceneNo:2 }] };
  assert.deepEqual(J(P.significance(ch).reasons), [], "opening is using it");
  // (owner 2026-10-30) the words of the last read: eaten, punched, put down, pocketed, raised, opened — not changes;
  // handed over, hidden, found, lost, stolen, broken, destroyed — changes that matter
  for(const w of ["eaten","punched","put down","pocketed","raised and sealed","opened","keyed","dropped","folded","used up","altered"]) assert.equal(P.strongChange(w), false, w);
  for(const w of ["handed over","changes hands","gives it to Nives","hidden","hides it","found","lost","stolen","broken","opened (wax seal broken)","torn up","burned","destroyed","thrown overboard","taken","recovered","damaged"]) assert.equal(P.strongChange(w), true, w);
  for(const t of ["consumed","placed","updated"]) assert.equal(P.significance({ screenplaySources:[src("s2",2,"q")], continuityEvents:[{ type:t, sceneId:"s2", source:{ sceneNo:2 } }] }).tests.changes, false, t);
});
await test("2c one scene needs both: a change that matters AND the story turns on it", ()=>{
  const turn = { id:"t", name:"Key", screenplaySources:[src("s3",3,"q")], storyTurn:{ reason:"It opens the cabin later." } };
  assert.equal(P.isStoryProp(turn), false, "a turn alone, in one scene, isn't enough");
  assert.deepEqual(J(P.significance(turn).reasons), ["the story turns on it: It opens the cabin later"]);
  assert.equal(P.notPropReason(turn), "Named once — in scene 3 only, and it never changes hands, is hidden, found, lost or destroyed");
  const handed = { id:"h", name:"Pen", screenplaySources:[src("s3",3,"q")], storyChanges:[{ what:"handed over", sceneNo:3 }] };
  assert.equal(P.isStoryProp(handed), false); assert.equal(P.notPropReason(handed), "Named once — in scene 3 only, and the story doesn't turn on it");
  assert.equal(P.isStoryProp({ ...handed, storyTurn:{ reason:"Signing with it is the turn." } }), true, "both → a story prop");
  const cup = { id:"c", name:"Cup of coffee", propRole:"background", screenplaySources:[src("s3",3,"Aurelio drinks a cup of coffee at the rail.")] };
  assert.equal(P.isStoryProp(cup, drafts), false); assert.equal(P.group(cup, drafts), "other");
  assert.equal(P.notPropReason(cup, drafts), "Background prop — in scene 3 only, and nothing that matters happens to it");
  // part of the place is never a prop; costume only when something that matters happens to it
  const ramp = { name:"Ferry car ramp", propRole:"dressing", screenplaySources:[src("s2",2,"q"), src("s6",6,"q")], storyChanges:[{ what:"destroyed", sceneNo:6 }], storyTurn:{ reason:"r" } };
  assert.equal(P.isStoryProp(ramp), false); assert.equal(P.notPropReason(ramp), "Set dressing — part of the place; the location and the shot describe it");
  const shoes = { name:"Worn shoes", propRole:"costume", screenplaySources:[src("s2",2,"q"), src("s6",6,"q")] };
  assert.equal(P.isStoryProp(shoes), false, "worn in two scenes is costume continuity");
  assert.equal(P.notPropReason(shoes), "Costume — worn, and it never changes hands, is hidden, found, lost or destroyed");
  assert.equal(P.isStoryProp({ ...shoes, storyChanges:[{ what:"handed over (draped over Nives's shoulders)", sceneNo:6 }] }), true, "a jacket handed over, worn in two scenes");
  assert.equal(P.isStoryProp({ ...shoes, screenplaySources:[src("s6",6,"q")], storyChanges:[{ what:"handed over", sceneNo:6 }] }), false);
  assert.equal(P.isStoryProp({ ...shoes, kind:"worn", propRole:undefined, screenplaySources:[src("s6",6,"q")], storyChanges:[{ what:"taken off and hidden", sceneNo:6 }], storyTurn:{ reason:"r" } }), true, "older cards: worn = costume");
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
  assert.ok(t.includes("Not props — left to the shot (1)") && t.includes("Background props (1)") && t.includes("Background prop — in scene 3 only, and nothing that matters happens to it"));
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
    storyChanges:[{ what:"taken off and hidden", sceneNo:6 }], storyTurn:{ reason:"She hides it from him." } };
  assert.equal(P.isStoryProp(ring), true); assert.deepEqual(J(P.significance(ring).reasons), ["taken off and hidden in 6", "the story turns on it: She hides it from him"]);
  assert.equal(P.isStoryProp({ ...ring, storyChanges:[] }), false, "worn once, nothing that matters happens → costume");
  assert.equal(P.isStoryProp({ ...ring, storyTurn:null }), false, "(2026-10-30) one scene, no turn → costume");
});

/* ═══ + — the doc, Frances, the Lookbook bin, the cache keys ═══ */
await test("+a the pipeline doc records the owner's approval and the six points", ()=>{
  const step = between(doc, "*(approved 2026-10-29 by owner — \"go ahead with all six, update the pipeline doc\"", "  - **Draft all characters**");
  for(const s of ["**costume**", "**set\n    dressing**", "**background props**", "**hero props**", "**Only the screenplay creates props.**", "**The tests**",
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
    assert.ok(["20261029-hs144", "20261030-hs145", "20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21"].some(k=>html.includes(f+'?v='+k+'"')), f);
});

/* ═══ 7 — tighter rules + how film crews sort objects (owner 2026-10-30: "yes, tighten the rules and update the
   pipeline doc"; "can we ensure this is applied for props and adopted in the UI: How film crews sort objects…") ═══ */
await test("7a the same-object question is asked only when the answer matters", ()=>{
  // two costume halves nobody does anything with: no question
  const shoeA = cand(0, "Aurelio's shoes", [src("s2",2,"a","worn")], { propRole:"costume" });
  const shoeB = cand(1, "Aurelio's shoes", [src("s6",6,"b","worn")], { propRole:"costume", maybeSameAs:"candidate-0" });
  assert.equal(P.sameQuestion(shoeB, [shoeA, shoeB], []), null);
  // part of the place: never asked, even when the two together would return
  const rampA = cand(2, "Car ramp", [src("s2",2,"a")], { propRole:"dressing" });
  const rampB = cand(3, "Car ramp", [src("s6",6,"b")], { propRole:"dressing", maybeSameAs:"candidate-2" });
  assert.equal(P.sameQuestion(rampB, [rampA, rampB], []), null);
  // two single-scene halves that together return: asked
  const tA = cand(4, "Ticket", [src("s2",2,"a")]), tB = cand(5, "Ticket stub", [src("s6",6,"b")], { maybeSameAs:"candidate-4" });
  assert.match(P.sameQuestion(tB, [tA, tB], []).text, /^Is the ticket stub in scene 6 the one from scene 2\?$/);
  // a jacket handed over in one scene, worn in another: together it is a prop → asked
  const jA = cand(6, "Jacket", [src("s2",2,"a","worn")], { propRole:"costume" });
  const jB = cand(7, "Jacket", [src("s6",6,"b","handled")], { propRole:"costume", maybeSameAs:"candidate-6", storyChanges:[{ what:"handed over", sceneNo:6 }] });
  assert.ok(P.sameQuestion(jB, [jA, jB], []));
});
await test("7b the read: parts of the place are set dressing, marks aren't objects; settle uses the new rules", ()=>{
  const fn = between(ai, "async function aiExtractScreenplayProps(", "window.aiExtractScreenplayProps=aiExtractScreenplayProps;");
  assert.ok(fn.includes("AND any part of the place itself (doors, ramps, gangways, chains, lockers, cupboards, curtains, railings, fixtures, built-in furniture), even when someone opens, raises or lowers it."));
  assert.ok(fn.includes("Marks and traces (footprints, stains, scratches, wet patches) are not objects: leave them out."));
  const cs = P.settleCandidates([cand(0, "Port-bar panino", [src("s2",2,"a")], { storyChanges:[{ what:"eaten", sceneNo:2 }] }),
    cand(1, "Incident log", [src("s3",3,"b")], { storyChanges:[{ what:"handed over", sceneNo:3 }], storyTurn:{ reason:"Not signing it is the turn.", sceneNo:3 } }),
    cand(2, "Locker curtain", [src("s3",3,"c")], { propRole:"dressing", storyChanges:[{ what:"torn", sceneNo:3 }], storyTurn:{ reason:"r", sceneNo:3 } })], []);
  assert.deepEqual(J(cs.map(c=>[c.name, c.target, !!c.notProp])), [["Port-bar panino","skip",true],["Incident log","new",false],["Locker curtain","skip",true]]);
});
await test("7c how film crews sort objects — the owner's four places, on the Props tab and in the review", ()=>{
  const sort = J(box.PROP_CREW_SORT);
  assert.deepEqual(sort.map(c=>c.name), ["Costume","Set dressing","Background props","Hero props"]);
  assert.equal(sort[0].text, "Anything worn (watches, badges, rings, uniforms). The costume department handles it, not props.");
  assert.equal(sort[1].text, "Objects that sit in the room and nobody uses. The set decorator handles them as part of the location.");
  assert.equal(sort[2].text, "Ordinary things handled once, like a cup of coffee or a pen. They\u2019re bought, not designed, and nobody tracks them.");
  assert.equal(sort[3].text, "The few objects the story depends on. These get designed, made carefully, often in copies, and tracked scene by scene.");
  const note = box.PropCrewSortNote({ open:true }), t = textOf(note);
  assert.equal(note.props.open, true); assert.equal(box.PropCrewSortNote({}).props.open, undefined);
  assert.ok(t.startsWith("How film crews sort objectsWhen a crew breaks down a script, every object it names goes to one of four places:"));
  assert.ok(t.includes("Hero props: The few objects the story depends on.") && t.includes("Only these become cards on this tab."));
  // on the tab (open while it's empty, hidden while a review is open — the review shows it) and in the review
  assert.ok(props.includes("!review && window.PropCrewSortNote && React.createElement(window.PropCrewSortNote,{open:!list.length}),"));
  assert.ok(props.includes("window.PropCrewSortNote && h(window.PropCrewSortNote,null),"));
});
await test("7d the review files what isn't a prop where a crew does: costume, set dressing, background props", ()=>{
  R.reset();
  const cs = P.settleCandidates([cand(0, "Sealed letter", [src("s2",2,"a"), src("s6",6,"b")]),
    cand(1, "Cup of coffee", [src("s3",3,"c")], { propRole:"background" }),
    cand(2, "Car ramp", [src("s2",2,"d")], { propRole:"dressing" }),
    cand(3, "Wool coat", [src("s3",3,"e","worn")], { propRole:"costume" }),
    cand(4, "Ticket", [src("s2",2,"f")], { propRole:"hero" })], []);
  const tree = box.PropExtractionReview({ review:{ candidates:cs, failures:[], rejected:0 }, onChange:noop, onApply:noop, onClose:noop, props:[], characters:cast, locations:[] });
  const t = textOf(tree);
  assert.ok(t.includes("Hero props (1) — The few objects the story depends on."));
  assert.ok(props.includes('h("b",null,"Hero props ("+propsList.filter(p=>p.target!=="skip").length+")")'), "counts what will be added, not the open questions");
  assert.ok(t.includes("Not props — left to the shot (4)"));
  const group = (id)=> textOf(findAll(tree, n=>n.props && n.props["data-testid"]==="prop-review-place-"+id)[0]);
  assert.ok(group("costume").startsWith("Costume (1) — Anything worn") && group("costume").includes("Wool coat") && group("costume").includes("Costume — worn, and it never changes hands"));
  assert.ok(group("dressing").startsWith("Set dressing (1) — Objects that sit in the room") && group("dressing").includes("Car ramp") && group("dressing").includes("Set dressing — part of the place"));
  assert.ok(group("background").startsWith("Background props (2) — Ordinary things handled once") && group("background").includes("Cup of coffee") && group("background").includes("Ticket") && group("background").includes("Named once — in scene 2 only"));
  assert.equal(findAll(tree, n=>n.props && n.props["data-testid"]==="prop-review-make").length, 4, "each can still be made a prop");
});
await test("7e the doc, Frances and the info tip carry the tighter rules", ()=>{
  const step = between(doc, "*(approved 2026-10-29 by owner", "  - **Draft all characters**");
  for(const s of ["*(tightened 2026-10-30 by owner — \"yes, tighten the rules and update the pipeline doc\")*", "passes **both** of the others",
    "**Part of the place**", "**marks**", "and only when the answer matters", "Being worn in many scenes is costume continuity, not a reason.",
    "**How film crews sort objects**"]) assert.ok(step.includes(s), s);
  const s2 = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fb = { console }; fb.window = fb; vm.createContext(fb); vm.runInContext(s2 + "\n;this.__F = APP_FEATURES;", fb);
  const tab = fb.__F.find(f=>f.name==="Props (Art Room)").what;
  for(const x of ["TIGHTER RULES (owner 2026-10-30)", "eating it, punching it, opening or raising it", "HOW FILM CREWS SORT OBJECTS", "Only these become cards"]) assert.ok(tab.includes(x), x);
  assert.ok(props.includes("or \\u2014 in one scene \\u2014 changes hands, is hidden, found, lost or destroyed and the story turns on it."));
  for(const f of ["app/prop-screenplay.js", "app/props.jsx", "app/ai.jsx", "app/styles.css"]) assert.ok(["20261030-hs146", "20261030-hs147", "20261031-cloud1", "20261031-cloud2", "20261031-cloud3", "20261031-cloud4", "20261031-cloud5", "20261031-cloud6", "20261031-cloud7", "20261031-cloud8", "20261031-cloud9", "20261101-cloud10", "20261101-cloud11", "20261101-cloud12", "20261101-cloud13", "20261101-cloud14", "20261101-cloud15", "20261101-cloud16", "20261101-cloud17", "20261101-cloud18", "20261101-cloud19", "20261101-cloud20", "20261101-cloud21", "20261101-cloud22", "20261101-cloud23", "20261101-cloud24", "20261101-cloud25", "20261101-cloud26", "20261101-cloud27", "20261102-card1", "20261102-card2", "20261102-card3", "20261102-card4", "20261102-card5", "20261102-card6", "20261103-prompt1", "20261103-moments1", "20261103-stage1", "20261103-stage2", "20261103-stage3", "20261103-stage4", "20261103-merge1", "20261103-mobile1", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21", "20261103-mobile4", "20261103-mobile5", "20261103-mobile2", "20261103-mobile3", "20261103-mobile6", "20261103-mobile7", "20261103-mobile8", "20261103-mobile9", "20261103-mobile10", "20261103-mobile11", "20261103-mobile12", "20261103-mobile13", "20261103-mobile14", "20261103-mobile15", "20261103-mobile16", "20261103-mobile17", "20261103-mobile18", "20261103-mobile19", "20261103-mobile20", "20261103-slack1", "20261103-slack2", "20261103-slack3", "20261103-slack4", "20261103-slack5", "20261103-slack6", "20261103-slack7", "20261103-slack8", "20261103-slack9", "20261103-slack10", "20261105-gpt26", "20261105-gpt26b", "20261105-busy1", "20261105-busy2", "20261105-set1", "20261105-set2", "20261105-set3", "20261105-set4", "20261105-set5", "20261105-set6", "20261105-set7", "20261106-views1", "20261106-views2", "20261106-views3", "20261106-views4", "20261106-views5", "20261106-views6", "20261106-views7", "20261106-views8", "20261106-views9", "20261106-views10", "20261106-views11", "20261106-views12", "20261106-views13", "20261106-views14", "20261106-views15", "20261106-views16", "20261106-views17", "20261106-views18", "20261106-views19", "20261106-views20", "20261106-views21"].some(k=>html.includes(f+'?v='+k+'"')), f);
});

/* ═══ 8 — the card's badge (owner 2026-10-30: "costume, set dressing, background props, or hero props as a badge that
   replaces the selected element") ═══ */
await test("8a each card's place: a story prop the read called a hero is a Hero prop; costume, set dressing, background keep theirs", ()=>{
  const two = [src("s2",2,"a"), src("s6",6,"b")];
  assert.equal(P.category({ propRole:"hero", screenplaySources:two }), "hero");
  assert.equal(P.category({ propRole:"hero", screenplaySources:[src("s2",2,"a")] }), "background", "a 'hero' that didn't pass is a background prop");
  assert.equal(P.category({ propRole:"background", keptAsProp:true, screenplaySources:[src("s3",3,"c")] }), "background", "kept with Make it a prop");
  assert.equal(P.category({ propRole:"costume", screenplaySources:two, storyChanges:[{ what:"handed over", sceneNo:6 }] }), "costume");
  assert.equal(P.category({ propRole:"dressing", keptAsProp:true }), "dressing");
  assert.equal(P.category({ manual:true, kind:"carried", name:"Key" }), "hero", "made by hand");
  assert.equal(P.category({ kind:"worn", name:"Badge" }), "costume", "older cards go by their kind");
  assert.deepEqual(J(P.CATEGORY_LABEL), { hero:"Hero prop", costume:"Costume", dressing:"Set dressing", background:"Background prop" });
});
await test("8b the badge replaces carried / worn / dressing, and still shows the owner", ()=>{
  R.reset();
  const card = box.PropSheet({ p:{ id:"l", name:"Sealed letter", kind:"carried", propRole:"hero", ownerId:"aur", ownerName:"Aurelio", screenplaySources:[src("s2",2,"Nives hands Aurelio a sealed letter."), src("s6",6,"Aurelio tears the letter open and reads it.")] },
    project:{}, characters:cast, scenes, drafts, onUpdate:noop, onDelete:noop, onDraft:noop });
  const b = findAll(card, n=>n.props && n.props["data-testid"]==="prop-category-badge")[0];
  assert.equal(b.props["data-category"], "hero"); assert.match(b.props.className, /prop-kind-badge prop-binding-badge prop-cat-hero/);
  assert.equal(b.props["aria-label"], "Hero prop · Owner: Aurelio");
  const t = textOf(b); assert.ok(t.startsWith("Hero prop") && t.includes("The few objects the story depends on.") && t.includes("Aurelio"));
  assert.ok(!/\bcarried\b/i.test(textOf(findAll(b, n=>n.props && n.props.className==="prop-binding-label")[0])));
  R.reset();
  const kept = box.PropSheet({ p:{ id:"c", name:"Cup of coffee", kind:"carried", propRole:"background", keptAsProp:true, screenplaySources:[src("s3",3,"Aurelio drinks a cup of coffee at the rail.")] },
    project:{}, characters:cast, scenes, drafts, onUpdate:noop, onDelete:noop, onDraft:noop });
  const kb = findAll(kept, n=>n.props && n.props["data-testid"]==="prop-category-badge")[0];
  assert.equal(kb.props["data-category"], "background"); assert.ok(textOf(kb).startsWith("Background prop"));
  assert.ok(!props.includes('React.createElement("span",{className:"prop-binding-label"},p.kind==="dressing" ? "set dressing" : (p.kind||"carried"))'), "the old label is gone");
});
await test("8c the star is 'Keep exact on the Stage' — 'Hero prop' is the badge now (stored hero stays)", ()=>{
  assert.ok(props.includes('"aria-label":p.hero?"Kept exact on the Stage \\u2014 click to unmark":"Keep exact on the Stage",'));
  assert.ok(!props.includes("Mark as a hero prop"));
  assert.ok(props.includes("onUpdate(p.id,{hero:!p.hero})"), "same stored field");
  assert.ok(ai.includes('APP_FEATURES.push({ name:"Exact props on the Stage and spoken language"') && ai.includes("It is separate from the card's Hero prop badge."));
  assert.ok(ai.includes("THE CARD'S BADGE (owner 2026-10-30)"));
});

console.log(failed ? (checks+" checks passed, "+failed+" FAILED") : (checks+" checks passed"));
if(failed) process.exit(1);

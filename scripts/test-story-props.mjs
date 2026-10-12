#!/usr/bin/env node
/* CARRIED PROPS COME FROM THE STORY (owner 2026-10-12: "go ahead with all of it").
   The owner's rule: carried props are derived from the screenplay as much as possible; worn items that come
   from designing how a character looks (a watch, a scarf, jewellery) are fine.
   1  the character look drafter lists a carried item only when the screenplay text it is given names it;
      "invent freely" stays for wardrobe and worn accessories; no "append new items" for carried ones
   2  propsFromCast: worn items become cards; a carried item becomes a PROPOSAL in its own group
      "Proposed — not in the screenplay" until the user keeps it (its card) or Extract links a passage
   3  the worn/carried tidy: an item moved to carried is a proposal too, unless the screenplay established it
   4  batches and agents never pay for an unproven carried prop, on any film; worn items can still be made
   5  scene mapping of an unproven card: exact name only
   6  "Attach item to prop…" cards: design origin + the Not in screenplay flag, never `manual`
   7  Extract screenplay props is the first Props step (Props Master, Art Coordinator, Draft all
      specifications), through the review / propose(); its cost is said
   8  existing films: nothing migrated; Frances and the pipeline doc know it
     node scripts/test-story-props.mjs */
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
  agents = read("app/agents.jsx"), art = read("app/artroom.jsx"), bd = read("app/breakdown.jsx"), doc = read("docs/Story Pipeline.md");

let confirms = [], answer = true, extractCalls = 0, extractResult = null;
const box = { console, React:R, Icon:icon, Set, Map, Object, Array, String, Number, Math, JSON, Date, Promise, RegExp,
  document:{ addEventListener:noop, removeEventListener:noop, querySelector:()=>null },
  addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true, CustomEvent:class {}, requestAnimationFrame:noop,
  nbCostChip:(count)=>({ type:"chip", props:{ count }, children:[] }), nbImageCostText:(n)=>String(12*n),
  nbGetImage:()=>"", nbLoadImage:async ()=>"",
  appConfirm:async (o)=>{ confirms.push(o); return typeof answer==="function" ? answer(o) : answer; },
  useBatchGen:()=>({ activeId:null, begin:(ids, skipped)=>{ box.__begun = { ids, skipped }; }, setMsg:(m)=>{ box.__msg = m; }, advance:noop }),
  usePager:()=>({ slice:(a)=>a }), PagerBar:"PagerBar", NbKeyBar:"NbKeyBar", NbControls:"NbControls", BatchBar:"BatchBar",
  ImageLightbox:"ImageLightbox", InfoTip:"InfoTip", RecentlyDeleted:"RecentlyDeleted", RenderStylePicker:"RenderStylePicker",
  SheetFrame:"SheetFrame", SheetField:"SheetField", CardFold:"CardFold", CopyBox:"CopyBox", EditText:"EditText", SceneChipPager:"SceneChipPager",
  scenesInStoryOrder:(s)=>s||[], roomCopy:()=>({}), scenesWhereCharacterAppears:()=>[], turnContinuity:{ scenes:[], locations:[] },
  useImageGen:()=>({ gening:false, genUrl:"", generate:async ()=>true }),
  splitListItems:(t)=>String(t||"").split(/\s*;\s*/).map(x=>x.trim()).filter(x=>x && !/^none$/i.test(x)),
  joinListItems:(xs)=>xs.join("; "),
};
box.window = box; vm.createContext(box);
vm.runInContext(ps, box, { filename:"app/prop-screenplay.js" });
vm.runInContext(transform(props, "props.jsx"), box, { filename:"app/props.jsx" });
const P = box.PropScreenplay;

const scenes = [{ id:"s1", no:1, title:"Kitchen" }, { id:"s2", no:2, title:"Street" }];
const drafts = { s1:{ blocks:[{ type:"action", text:"Mara checks her phone and pockets it." }] },
  s2:{ blocks:[{ type:"action", text:"Mara drops the smartphone in the gutter." }, { type:"dialogue", text:"Where is my leather satchel?" }] } };
const cast = [{ id:"m", name:"Mara", accessories:"Silver watch; Leather satchel", props:"Smartphone; Signet ring" }];
const seeded = box.propsFromCast(cast, [], scenes, drafts);
const byName = (n)=> seeded.find(p=>p.name.toLowerCase()===n.toLowerCase());

/* ═══ 1 — the character look drafter ═══ */
await test("1a the drafter lists a carried item only when the screenplay text names it; none invented", ()=>{
  const fx = between(ai, "function bibleBatchPrompt(ctx, chars){", "/* batched VISUAL BIBLE");
  vm.runInContext(fx+"; window.__bible = bibleBatchPrompt;", box);
  const prompt = box.__bible("CTX", []);
  assert.match(prompt, /props = CARRIED \/ handled objects[^]*ONLY objects the SCREENPLAY text in this brief names for this character/);
  assert.match(prompt, /never invent a carried object, and where the screenplay names none, 'none'/);
  assert.match(prompt, /Invention is for the wardrobe and the WORN accessories only/);
});
await test("1b no 'append new items' for carried ones: new WORN items only, a carried one only when the script names it", ()=>{
  const prompt = box.__bible("CTX", []);
  assert.ok(!prompt.includes("you may append new items after)"));
  assert.ok(prompt.includes("you may append new WORN items after, but a new CARRIED item only when the screenplay text names it"));
});
await test("1c 'invent freely' stays for wardrobe and worn accessories only", ()=>{
  const fx = between(ai, "async function aiCastVisualBible(", "window.aiCastVisualBible = aiCastVisualBible;");
  assert.ok(!fx.includes("Where the script is silent, invent freely within the period.\\n"));
  assert.ok(fx.includes("Where the script is silent, invent the wardrobe and worn accessories freely within the period"));
  assert.ok(fx.includes("but never a CARRIED object: props lists only what these screenplay lines name."));
  // the single-character drafter runs the same batch prompt
  assert.ok(between(ai, "async function aiCharacterVisuals(", "window.aiCharacterVisuals").includes("aiCastVisualBible([character]"));
});

/* ═══ 2 — character-brief items ═══ */
await test("2a worn items become worn cards (Wardrobe & accessories), not proposals", ()=>{
  const w = byName("Silver watch");
  assert.equal(w.kind, "worn"); assert.equal(P.group(w), "accessories"); assert.equal(P.isProposal(w), false);
  const ring = byName("Signet ring");                       // listed under props, but a worn object
  assert.equal(ring.kind, "worn"); assert.equal(P.isProposal(ring), false);
});
await test("2b a carried item from a brief is a PROPOSAL in its own group, never a story prop", ()=>{
  for(const n of ["Smartphone", "Leather satchel"]){       // a bag filed as an accessory is still carried
    const c = byName(n);
    assert.equal(c.kind, "carried", n); assert.equal(c.inventoryGroup, "proposed", n);
    assert.equal(P.isProposal(c), true, n); assert.equal(P.group(c), "proposed", n); assert.equal(P.notInScreenplay(c), true, n);
    assert.equal(c.origin.characterId, "m", n);            // its design origin is recorded
  }
  assert.equal(seeded.filter(p=>P.group(p)==="story").length, 0, "nothing from a brief lands in Story props");
});
await test("2c keeping a proposal is the user's choice: Story props, design origin kept, still 'Not in screenplay'", ()=>{
  const c = { ...byName("Smartphone"), ...P.acceptPatch("2026-10-12T00:00:00.000Z") };
  assert.equal(c.proposalAccepted, true); assert.equal(c.proposalAcceptedAt, "2026-10-12T00:00:00.000Z");
  assert.equal(P.isProposal(c), false); assert.equal(P.group(c), "story");
  assert.equal(P.notInScreenplay(c), true); assert.equal(c.origin.kind, "props");
  assert.match(box.propOriginLabel(c), /design proposal from Mara's character brief/);
});
await test("2d Extract finding it in the screenplay makes it a story prop with its evidence", ()=>{
  const prop = byName("Smartphone");
  const decision = { target:prop.id, name:"Smartphone", aliases:[], kind:"carried", inventoryGroup:"story", ownerId:"m", ownerName:"Mara",
    locationId:"", screenplaySources:[{ sceneId:"s2", sceneNo:2, block:1, quote:"Mara drops the smartphone in the gutter.", presence:"handled" }],
    continuityEvents:[], includeEvents:false, contentNotes:"", identityNote:"", warnings:[] };
  const out = P.accept(seeded, [decision], drafts), linked = out.find(p=>p.id===prop.id);
  assert.equal(P.isProposal(linked), false); assert.equal(P.group(linked), "story"); assert.equal(P.notInScreenplay(linked), false);
  assert.deepEqual(J(linked.scenes), ["s2"]); assert.equal(linked.origin.kind, "props", "the design origin is kept");
  assert.equal(out.length, seeded.length, "linked, not duplicated");
});
await test("2e the card: a 'Proposed — not in the screenplay' badge and 'Keep this prop'; a group pick keeps it too", ()=>{
  R.reset(); let patch = null;
  const tree = box.PropSheet({ p:byName("Smartphone"), project:{}, characters:cast, scenes, drafts, onUpdate:(id, x)=>{ patch = x; }, onDelete:noop, onDraft:noop });
  assert.ok(textOf(tree).includes("Proposed — not in the screenplay"));
  const keep = buttons(tree).find(b=>textOf(b)==="Keep this prop");
  assert.ok(keep); keep.props.onClick();
  assert.equal(patch.proposalAccepted, true); assert.equal(patch.inventoryGroup, "story");
  const sel = findAll(tree, n=>n.type==="select" && findAll(n, o=>o.type==="option" && o.props.value==="proposed").length)[0];
  assert.ok(sel && sel.props.value==="proposed"); sel.props.onChange({ target:{ value:"accessories" } });
  assert.equal(patch.proposalAccepted, true); assert.equal(patch.inventoryGroup, "accessories");
  R.reset();
  const worn = box.PropSheet({ p:byName("Silver watch"), project:{}, characters:cast, scenes, drafts, onUpdate:noop, onDelete:noop, onDraft:noop });
  assert.ok(!buttons(worn).some(b=>textOf(b)==="Keep this prop"), "worn items are never proposals");
});
await test("2f the Props tab's Show menu has the Proposed group, counted", ()=>{
  R.reset();
  const tree = box.PropSheets({ project:{}, props:seeded, characters:cast, scenes, drafts, onUpdate:noop, onDraft:noop, onDraftAll:noop, onAdd:noop,
    onImportProps:noop, onDelete:noop, castHasProps:true, trashItems:[] });
  const opt = findAll(tree, n=>n.type==="option" && n.props.value==="proposed")[0];
  assert.ok(opt); assert.equal(textOf(opt), "Proposed — not in the screenplay (2)");
});

/* ═══ 3 — the worn/carried tidy ═══ */
await test("3a an item moved to carried becomes a proposal unless the screenplay established it", ()=>{
  const flipped = { id:"x", name:"Leather tote bag", kind:"carried", inventoryGroup:"accessories", ownerId:"m", fromCast:true };
  assert.equal(P.isProposal(flipped), true); assert.equal(P.group(flipped), "proposed");
  const proven = { ...flipped, screenplaySources:[{ sceneId:"s1", block:1, quote:"q", presence:"handled" }] };
  assert.equal(P.isProposal(proven), false); assert.equal(P.group(proven), "accessories");
  const heal = between(app, "if(typeof window.turnReclassifyWornCarried!==\"function\") return;", "},[characters, hydrationTick]);");
  assert.ok(heal.includes("return hit ? { ...pr, kind:\"carried\" } : pr;"), "the tidy only flips the kind; the proposal follows from it");
  assert.ok(heal.includes("listed under Proposed until the screenplay names them or you keep them"));
});

/* ═══ 4 — nothing pays for a proposal ═══ */
await test("4a batchSkip: a proposal on ANY film; worn and kept cards never; set dressing only once the screenplay was read", ()=>{
  const prop = byName("Smartphone"), worn = byName("Silver watch");
  assert.equal(P.batchSkip(prop, false), true); assert.equal(P.batchSkip(prop, true), true);
  assert.equal(P.batchSkip(worn, true), false);
  assert.equal(P.batchSkip({ ...prop, proposalAccepted:true }, true), false);
  assert.equal(P.batchSkip({ id:"h", name:"Key", kind:"carried", manual:true }, true), false);
  const dress = { id:"d", name:"Bench", kind:"dressing" };
  assert.equal(P.batchSkip(dress, false), false); assert.equal(P.batchSkip(dress, true), true);
});
await test("4b the Props tab: proposals aren't counted for drafting or generated; the reason is said", ()=>{
  R.reset();
  const drafted = (p)=>({ ...p, ownerId:"m", form:"f", material:"m" });
  const list = [drafted(byName("Smartphone")), drafted(byName("Leather satchel"))];
  const tree = box.PropSheets({ project:{}, props:list, characters:cast, scenes, drafts, onUpdate:noop, onDraft:noop, onDraftAll:noop, onAdd:noop,
    onImportProps:noop, onDelete:noop, castHasProps:true, trashItems:[] });
  assert.ok(!buttons(tree).some(b=>/Generate \d+ missing/.test(textOf(b))), buttons(tree).map(textOf).join(" | "));
  R.reset();
  const undrafted = box.PropSheets({ project:{}, props:[byName("Smartphone"), { id:"o", name:"Old key", kind:"carried", ownerId:"m", manual:true }], characters:cast, scenes, drafts,
    onUpdate:noop, onDraft:noop, onDraftAll:noop, onAdd:noop, onImportProps:noop, onDelete:noop, castHasProps:true, trashItems:[] });
  assert.ok(buttons(undrafted).some(b=>textOf(b)==="Draft 1 specification"), buttons(undrafted).map(textOf).join(" | "));
  assert.ok(props.includes("every carried object here is a proposal the screenplay doesn't name. Keep the ones you want, or run Extract screenplay props."));
});
await test("4c Draft all specifications, the Props Master, the Coordinator's estimate, Make what this scene needs and the Breakdown skip proposals", ()=>{
  const da = between(app, "  const draftAllProps = async (mode)=>{", "  // Pull standalone prop cards");
  assert.ok(da.includes(".filter(p=>!_isProposal(p));") && da.includes("const n = (props||[]).filter(p=>!_isProposal(p)).length;"));
  const pm = between(app, "    const propmaster = {", "    // ---- Location Scout surface");
  assert.ok(pm.includes("const todo = _propWork.filter(p=>(force || !_propDrafted(p)) && !(PSd && PSd.isProposal && PSd.isProposal(p)));"));
  assert.ok(pm.includes("if(PS && PS.isProposal && PS.isProposal(p)) continue;") && pm.includes("if(PS && PS.batchSkip(p, extracted)) continue;"));
  assert.ok(pm.indexOf("if(PS && PS.isProposal && PS.isProposal(p)) continue;") < pm.indexOf("const has = await _grabImg(p.id);"), "not even a forced refresh");
  assert.ok(app.includes("if(PS && typeof PS.isProposal===\"function\" && PS.isProposal(p)) return \"is a proposal the screenplay doesn't name (Props)\";"));
  assert.ok(between(art, "function CoordConfirm(", "window.CoordConfirm").includes("window.PropScreenplay.batchSkip(p, P.some(x=>x && (x.screenplaySources||[]).length))"));
  assert.ok(bd.includes("PS.batchSkip(p, extracted)"));
});

/* ═══ 5 — scene mapping: exact name only ═══ */
await test("5a an unproven card maps only to scenes whose action names it exactly (an object noun isn't enough)", ()=>{
  vm.runInContext(between(ai, "function propSceneMap(props, scenes, drafts, characters){", "window.propSceneMap = propSceneMap;"), box);
  const map = box.propSceneMap([{ id:"phone", name:"Smartphone", kind:"carried", ownerId:"m" }, { id:"sat", name:"Leather satchel", kind:"carried" },
    { id:"cell", name:"Mobile phone", kind:"carried" }], scenes, drafts, cast);
  assert.deepEqual(J(map.phone), ["s2"], "'phone' in Scene 1 isn't 'Smartphone'");
  assert.deepEqual(J(map.sat), [], "a dialogue mention never maps");
  assert.deepEqual(J(map.cell), [], "the noun 'phone' alone isn't the name 'Mobile phone'");
});
await test("5b the Props tab's own fallback map is exact too", ()=>{
  const fx = between(props, "  const effMap = React.useMemo(()=>{", "  const effScenes = ");
  assert.ok(fx.includes("m.match===\"exact\"") && !fx.includes("hay.indexOf(head)"));
});

/* ═══ 6 — Attach item to prop… ═══ */
await test("6 'Attach item to prop…' cards carry a design origin and the Not in screenplay flag, never manual", ()=>{
  const fx = between(app, "window.turnCreatePropFromReference = (ref, seed)=>{", "window.turnRemovePropReference");
  assert.ok(!/manual\s*:\s*true/.test(fx));
  assert.ok(fx.includes("origin:{ kind:\"design\", from:\"art-room-image\", sourceName:String(ref.sourceName||\"\") }"));
  const card = { id:"prop-ref-x", name:"Brass compass", kind:"carried", origin:{ kind:"design", from:"art-room-image", sourceName:"Mara sheet" } };
  assert.equal(P.notInScreenplay(card), true); assert.equal(P.isProposal(card), true);
  assert.equal(box.propOriginLabel(card), "Design proposal from a selected item in Mara sheet");
});

/* ═══ 7 — Extract first ═══ */
const agentBox = { console, window:null, String, Array, Object, Math, JSON, Promise };
agentBox.window = agentBox; vm.createContext(agentBox);
vm.runInContext(between(agents, "function agentErrText(e){", "\n}\n")+"\n}\n"+between(agents, "async function agentPropsMaster(ctx){", "async function agentLocationScout(ctx){")+"; window.agentPropsMaster = agentPropsMaster;", agentBox);
const runPM = async ({ extracted=false, canExtract=true, ok=true, draftOnly=false, candidates } = {})=>{
  const log = [], steps = [], proposals = [];
  const pm = {
    extracted:()=>extracted, canExtract:()=>canExtract,
    extract:async ()=>{ log.push("extract"); return { candidates:candidates || [
      { name:"Smartphone", target:"new", screenplaySources:[{ sceneNo:2, quote:"Mara drops the smartphone in the gutter." }] },
      { name:"Old key", target:"k1", screenplaySources:[{ sceneNo:1, quote:"the key" }] },
      { name:"A rumour", target:"skip", screenplaySources:[] }], failures:[], rejected:0 }; },
    applyExtraction:(found)=>{ log.push("apply:"+found.length); return { added:1, linked:1 }; },
    deriveCast:()=>{ log.push("deriveCast"); return 2; },
    draftSpecs:async ()=>{ log.push("draft"); return 0; }, toGenerate:async ()=>[], generateSheet:async ()=>true,
  };
  await agentBox.agentPropsMaster({ art:{ propmaster:pm }, draftOnly, force:false, cancelled:()=>false,
    emit:(e)=>steps.push(e), propose:async (c)=>{ proposals.push(c); return ok; } });
  return { log, steps, proposals };
};
await test("7a the Props Master reads the screenplay FIRST and adds what it names only after propose() says yes", async ()=>{
  const r = await runPM();
  assert.deepEqual(r.log, ["extract", "apply:2", "deriveCast", "draft"]);
  assert.equal(r.proposals.length, 1); assert.equal(r.proposals[0].title, "Add 2 screenplay props"); assert.equal(r.proposals[0].writes, "art");
  assert.match(r.proposals[0].rationale, /Smartphone \(Sc 2: “Mara drops the smartphone in the gutter\.”\)/);
  assert.match(r.proposals[0].rationale, /1 only mentioned, left out/);
  assert.match(r.steps.find(s=>s.k==="plan").t, /reads the screenplay for its props \(Extract screenplay props — a writing call for each screenplay section, writing credits/);
  assert.ok(r.steps.some(s=>s.k==="ok" && s.t==="Added 1 screenplay prop, linked 1 existing card."));
});
await test("7b declined → nothing added; already read → not read again; Re-draft only → no read", async ()=>{
  let r = await runPM({ ok:false });
  assert.deepEqual(r.log, ["extract", "deriveCast", "draft"]); assert.ok(r.steps.some(s=>/Declined — nothing from the screenplay read was added/.test(s.t)));
  r = await runPM({ extracted:true });
  assert.ok(!r.log.includes("extract") && r.proposals.length===0); assert.ok(r.steps.some(s=>/already been read for props — not read again/.test(s.t)));
  r = await runPM({ draftOnly:true }); assert.ok(!r.log.includes("extract"));
  r = await runPM({ canExtract:false }); assert.ok(!r.log.includes("extract"));
  r = await runPM({ candidates:[] }); assert.equal(r.proposals.length, 0); assert.ok(r.steps.some(s=>/found no objects to add/.test(s.t)));
});
await test("7c the Art Coordinator's Props step is the Props Master (approved automatically), and says so; the agent asks", ()=>{
  const co = between(agents, "async function agentDepartmentCoordinator(ctx){", "window.AGENTS");
  assert.ok(co.includes("[\"Props\",      agentPropsMaster],") && co.includes("propose:()=> Promise.resolve(true),"));
  assert.ok(co.includes("it first reads the screenplay for its props \\u2014 writing credits, once per film"));
  assert.ok(co.includes("the screenplay props the Props step finds, the colour system and the shot coverage are applied automatically"));
  const entry = between(agents, "{ id:\"propsmaster\"", "run:agentPropsMaster }");
  assert.ok(entry.includes("asksApproval:true") && entry.includes("Reads the screenplay for its props first"));
  assert.ok(entry.includes("writing credits to read the screenplay for its props (once per film)"));
  assert.ok(art.includes("reads the screenplay for its props when it hasn't been read yet"));
});
await test("7d the agents' surface: extraction proposes; applying is a PATCH (new added, linked re-linked on the live card)", ()=>{
  const pm = between(app, "    const propmaster = {", "    // ---- Location Scout surface");
  assert.ok(pm.includes("window.aiExtractScreenplayProps(scenes, draftsRef.current||drafts, characters,"));
  assert.ok(pm.includes("const next = PS.accept(_propWork, chosen, live);"));
  assert.ok(pm.includes("const relink = (p)=>{ try{ return withScenes(PS.accept([p], chosen.filter(d=>d.target===p.id), live)[0]); }catch(e){ return p; } };"));
});
const sheetsWith = (list, extra)=>{ R.reset(); box.__draftAll = undefined;
  return box.PropSheets({ project:{}, props:list, characters:cast, scenes, drafts, onUpdate:noop, onDraft:noop,
    onDraftAll:(m)=>{ box.__draftAll = m===undefined ? "missing" : m; }, onAdd:noop, onImportProps:noop, onDelete:noop, castHasProps:true, trashItems:[], ...(extra||{}) }); };
await test("7e Draft all specifications offers the extraction first: 'Extract, then draft' / 'Draft only' / Cancel", async ()=>{
  box.aiExtractScreenplayProps = async ()=>{ extractCalls++; return extractResult; };
  const undrafted = [{ id:"o", name:"Old key", kind:"carried", ownerId:"m", manual:true }];
  const btn = ()=> buttons(sheetsWith(undrafted)).find(b=>textOf(b)==="Draft 1 specification");
  confirms = []; answer = "alt"; extractCalls = 0;
  await btn().props.onClick();
  assert.equal(confirms[0].title, "Read the screenplay for its props first?");
  assert.equal(confirms[0].confirmLabel, "Extract, then draft"); assert.equal(confirms[0].altLabel, "Draft only");
  assert.match(confirms[0].body, /writing credits, no images/);
  assert.equal(box.__draftAll, "missing"); assert.equal(extractCalls, 0);
  confirms = []; answer = false; await btn().props.onClick(); assert.equal(box.__draftAll, undefined); assert.equal(extractCalls, 0);
  confirms = []; answer = true; extractResult = { candidates:[{ name:"Smartphone", target:"new", screenplaySources:[] }], failures:[], rejected:0 };
  const b = btn(); await b.props.onClick();
  assert.equal(extractCalls, 1); assert.equal(confirms.length, 1, "one question, not two");
  assert.equal(box.__draftAll, undefined, "the draft waits for the review");
  assert.ok(Object.values(R.setters).some(v=>v===extractResult), "the review opens");
});
await test("7f no candidates → the draft goes on; a film already read → no question", async ()=>{
  confirms = []; answer = true; extractResult = { candidates:[], failures:[], rejected:0 }; extractCalls = 0;
  const undrafted = [{ id:"o", name:"Old key", kind:"carried", ownerId:"m", manual:true }];
  await buttons(sheetsWith(undrafted)).find(b=>textOf(b)==="Draft 1 specification").props.onClick();
  assert.equal(extractCalls, 1); assert.ok(Object.values(R.setters).some(v=>v && v.mode===undefined && typeof v==="object" && "mode" in v), "the queued draft");
  confirms = []; extractCalls = 0;
  const read = [{ id:"o", name:"Old key", kind:"carried", ownerId:"m", manual:true }, { id:"s", name:"Smartphone", kind:"carried", form:"f", material:"m",
    screenplaySources:[{ sceneId:"s2", sceneNo:2, block:1, quote:"Mara drops the smartphone in the gutter.", presence:"handled" }] }];
  await buttons(sheetsWith(read)).find(b=>textOf(b)==="Draft 1 specification").props.onClick();
  assert.equal(confirms.length, 0); assert.equal(extractCalls, 0); assert.equal(box.__draftAll, "missing");
  assert.ok(props.includes("Draft all specifications continues when you apply or discard these proposals."));
  assert.ok(between(props, "  const applyExtraction=()=>{", "  const draftAllFlow").includes("releaseDraft();"));
});

/* ═══ 8 — existing films, Frances, the pipeline doc ═══ */
await test("8a existing cards are never moved or rewritten on load: the Proposed group is display only", ()=>{
  const legacy = { id:"old", name:"Briefcase", kind:"carried", inventoryGroup:"story", fromCast:true };
  const before = JSON.stringify(legacy);
  assert.equal(P.group(legacy), "proposed"); assert.equal(JSON.stringify(legacy), before);
  assert.ok(!/inventoryGroup\s*:\s*"proposed"/.test(app), "the app never writes the group onto saved cards");
});
await test("8b Frances knows it (a dated block), and the pipeline doc records the owner's approval on step 9", ()=>{
  const blk = between(ai, "/* CARRIED PROPS COME FROM THE STORY (owner 2026-10-12", "/* the public view of every entry, memoised");
  for(const s of ["PROPOSED \\u2014 NOT IN THE SCREENPLAY", "Keep this prop", "NOTHING PAYS FOR A PROPOSAL", "EXTRACT FIRST", "Read the screenplay for its props first?",
    "invents wardrobe and worn accessories, never carried objects", "an object word alone"]) assert.ok(blk.includes(s), s);
  assert.ok(!/McKee|Anthropic|Claude|TURN\b/.test(blk));
  assert.ok(doc.includes("*(approved 2026-10-12 by owner") && doc.includes("**Extract screenplay props is the first\n    Props step**"));
});

console.log(failed ? (checks+" checks passed, "+failed+" FAILED") : (checks+" checks passed"));
if(failed) process.exit(1);

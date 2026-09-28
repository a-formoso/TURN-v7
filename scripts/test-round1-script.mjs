#!/usr/bin/env node
/* Round 1 (2026-09-28) — the Script view fixes from the Writers' Room readiness audit.

   Runs the REAL app/script.jsx (with formats, frameworks, contract, scene-order and spine for
   its helpers) in node:vm and RENDERS ScriptView with a small hooks runtime (state, refs and
   effects persist between renders, like one mounted component), so these are behaviour tests,
   not source greps:
     A. "Redraft N out-of-date" appears in the Script header when several scenes are out of
        date — as the app ships it (Babel lowers const to var) AND with native const (where the
        old use-before-declaration threw). The old test only checked the string was in the file.
     B. "Write this beat" lands in the scene's LATEST script: an edit or an Undo made while MUSE
        writes survives; a gap filled meanwhile is never written over; the commit goes through
        the newest onEditScene (whose history reads the current draft).
     C. …and never in another film: a film switch while it writes drops the beat with a message;
        a closed Script view only writes when the app confirms the scene is untouched.
     D. Clicking × on an earlier line while typing in a later line keeps the typed words, and
        edit-mode blocks keep their own key (no DOM node handed to the next block).
     E. Act breaks work for any act count: Kishōtenketsu's Ten → Ketsu cut reads "ACT III → IV"
        with no three-act "the charge must alternate" advice; three-act copy is unchanged.
     F. "EXPECTED TESTIMONY: <Name>: <words>" — the doc accepts "<subject> on <topic>", not this —
        is held to the named form's topic rule by the shared check (writers + Script check).
   node scripts/test-round1-script.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";

const ROOT = new URL("../", import.meta.url);
const read = (f)=>readFileSync(new URL(f, ROOT), "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,8).join("\n    ")); }
};
const noop = ()=>{};

/* ---------------- a tiny hooks runtime: one "instance" = one mounted component ---------------- */
let CUR = null;
const scratch = ()=>({ slots:[], i:0, pending:[] });
const slotOf = ()=>{ const I = CUR || scratch(); return [I, I.i++]; };
const h = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const ReactStub = {
  createElement:h, Fragment:"frag",
  useState(init){
    const [I,k] = slotOf();
    if(!(k in I.slots)) I.slots[k] = { v:typeof init==="function" ? init() : init };
    const sl = I.slots[k];
    return [sl.v, (v)=>{ sl.v = typeof v==="function" ? v(sl.v) : v; }];
  },
  useRef(init){ const [I,k] = slotOf(); if(!(k in I.slots)) I.slots[k] = { current:init===undefined ? null : init }; return I.slots[k]; },
  useEffect(fn, deps){
    const [I,k] = slotOf();
    const prev = I.slots[k];
    const changed = !prev || !deps || deps.length!==prev.deps.length || deps.some((d,j)=>d!==prev.deps[j]);
    if(!changed) return;
    const sl = { deps:deps||[], cleanup:null };
    I.slots[k] = sl;
    I.pending.push(()=>{ if(prev && prev.cleanup) prev.cleanup(); const c = fn(); sl.cleanup = typeof c==="function" ? c : null; });
  },
  useLayoutEffect:noop, useMemo:(f)=>f(), useCallback:(f)=>f,
};
const mount = ()=>({ slots:[], i:0, pending:[] });
const render = (box, inst, props)=>{
  CUR = inst; inst.i = 0; inst.pending = [];
  let tree;
  try{ tree = box.ScriptView(props); } finally { CUR = null; }
  inst.pending.forEach(f=>f());
  return tree;
};
const unmount = (inst)=>{ inst.slots.forEach(sl=>{ if(sl && typeof sl.cleanup==="function") sl.cleanup(); }); };

/* ---------------- sandboxes: the real files ---------------- */
const makeBox = (scriptCode)=>{
  const box = {
    console, clearTimeout:noop, setTimeout:()=>0, setInterval:()=>0, clearInterval:noop,
    React:ReactStub, ReactDOM:{},
    Icon:new Proxy({}, { get:(t,k)=>{ const f = ()=>null; f.iconName = String(k); return f; } }),
    localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document:{ activeElement:null, querySelector:()=>null, querySelectorAll:()=>[], getElementById:()=>null,
      addEventListener:noop, removeEventListener:noop, createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }),
      body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  box.__toasts = [];
  vm.createContext(box);
  for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js","app/spine.jsx"])
    vm.runInContext(read(f), box, { filename:f });
  vm.runInContext(scriptCode, box, { filename:"app/script.jsx" });
  box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
  box.aiAvailable = ()=>true;
  box.console = { ...console, warn:noop, info:noop };
  return box;
};
const scriptSrc = read("app/script.jsx");
// as the app ships it: Babel (dev: Babel standalone; dist: build-dist.mjs) lowers const to var
const shipped = transformSync(scriptSrc, {
  presets:[["@babel/preset-react", { runtime:"classic" }]],
  plugins:["@babel/plugin-transform-block-scoping"],
  babelrc:false, configFile:false, filename:"script.jsx",
}).code;
const box = makeBox(shipped);
// native const/let: a use before the declaration throws here instead of reading `undefined`
const nativeBox = makeBox(scriptSrc);

/* ---------------- tree helpers ---------------- */
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const find = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n) : (!n || typeof n!=="object") ? "" : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
const cls = (n)=>String((n && n.props && n.props.className) || "");
const groupA = (tree)=>find(tree, n=>cls(n)==="st-group a")[0];
// "Redraft N out-of-date" has its own strip (.st-group.r) since the review (2026-09-28): inside
// group A it pushed Edit out of a phone's scrolling strip
const groupR = (tree)=>find(tree, n=>cls(n)==="st-group r")[0];
const redraftAll = (tree)=>{ const g = groupR(tree); return g ? find(g, n=>n.type==="button" && /out-of-date|Redrafting \d/.test(textOf(n))) : []; };

/* ---------------- fixtures ---------------- */
const SCENES = [
  { id:"s1", no:1, act:1, title:"The Pans", loc:"EXT. SALT PANS - DAY", openValue:"Hope", openCharge:1, closeValue:"Doubt", closeCharge:-1, summary:"x" },
  { id:"s2", no:2, act:1, title:"The Wall", loc:"EXT. SEA WALL - DUSK", openValue:"Doubt", openCharge:-1, closeValue:"Resolve", closeCharge:1, summary:"x" },
];
const BEATS = { driverLabel:"Leonor", reactorLabel:"Armindo", rows:[
  { n:1, drive:{ a:"Rakes", d:"Leonor rakes the salt." }, react:{ a:"Watches", d:"Armindo watches." } },
  { n:2, drive:{ a:"Asks", d:"Leonor asks about the wall." }, react:{ a:"Deflects", d:"Armindo deflects." } },
  { n:3, drive:{ a:"Leaves", d:"Leonor leaves." }, react:{ a:"Stays", d:"Armindo stays." } },
]};
// beat 2 has no screenplay text: the "Write this beat" gap
const draftWithGap = ()=>({ ai:true, by:{ model:"Writing model" }, blocks:[
  { beat:1, type:"scene", text:"EXT. SALT PANS - DAY" },
  { beat:1, type:"action", text:"LEONOR (60s) rakes the salt into a white ridge." },
  { beat:3, type:"action", text:"She sets the rake down." },
  { beat:3, type:"action", text:"She walks toward the wall." },
]});
const baseProps = (over)=>({
  scene:SCENES[0], beats:BEATS, drafts:{ s1:draftWithGap() }, scenes:SCENES, onSelectScene:noop, onDraftOne:noop,
  onDraftAll:noop, onPolish:async ()=>true, drafting:null, total:SCENES.length, history:{ back:[], fwd:[] }, labelOf:()=>"x",
  onRevert:noop, onRedo:noop, onEditScene:()=>true, continuityMap:{}, project:{ title:"Salt", format:"short", framework:"threeact" },
  onBeatFocus:noop, readOnly:false, facts:{}, staleChanges:[], staleCount:0, ...(over||{}) });
const writeBtn = (tree)=>find(tree, n=>n.type==="button" && cls(n)==="spb-write-btn")[0];
// a controllable aiWriteBeatText: resolve it when the test says MUSE has finished
const deferredBeat = (b)=>{
  let resolve; const p = new Promise(r=>{ resolve = r; });
  b.aiWriteBeatText = async ()=>p;
  return (blocks)=>resolve({ blocks, by:{ model:"Writing model" } });
};
const BEAT2 = ()=>[{ beat:2, type:"action", text:"Leonor asks what the wall is for. Armindo only shrugs." }];

/* ============================ A. Redraft N out-of-date ============================ */
await test("A the header shows 'Redraft 3 out-of-date' when several scenes are out of date (as shipped)", ()=>{
  const onRedraftAll = ()=>"go";
  const tree = render(box, mount(), baseProps({ staleCount:3, onRedraftAll, staleChanges:["summary"] }));
  const btns = redraftAll(tree);
  assert.equal(btns.length, 1, "one button, in its own strip");
  assert.equal(find(groupA(tree), n=>n.type==="button" && /out-of-date/.test(textOf(n))).length, 0, "not in group A any more");
  const tools = find(tree, n=>cls(n)==="script-tools")[0];
  assert.deepEqual(tools.children.filter(Boolean).map(cls), ["st-group a", "st-group r", "st-group b"], "between the tool strip and the Redraft / pager strip");
  assert.equal(textOf(btns[0]), "Redraft 3 out-of-date");
  assert.equal(btns[0].props.onClick, onRedraftAll, "wired to redraft them all");
  assert.ok(/\bcont-btn\b/.test(cls(btns[0])) && /\bstale\b/.test(cls(btns[0])), cls(btns[0]));
  assert.ok(!btns[0].props.disabled);
  // no stray undefined slot in the strip any more
  assert.ok(!groupA(tree).children.includes(undefined), "no undefined child in the header strip");
});
await test("A the same button renders with native const (the old code threw a ReferenceError here)", ()=>{
  const tree = render(nativeBox, mount(), baseProps({ staleCount:2, onRedraftAll:noop }));
  assert.equal(textOf(redraftAll(tree)[0]), "Redraft 2 out-of-date");
  // and on a scene with no script yet (the header is shared)
  const t2 = render(nativeBox, mount(), baseProps({ staleCount:4, onRedraftAll:noop, drafts:{} }));
  assert.equal(textOf(redraftAll(t2)[0]), "Redraft 4 out-of-date");
});
await test("A only for 2+ out-of-date scenes with a handler; progress while it runs; view-only disables it", ()=>{
  assert.equal(redraftAll(render(box, mount(), baseProps({ staleCount:1, onRedraftAll:noop }))).length, 0, "one stale scene: its own banner is enough");
  assert.equal(groupR(render(box, mount(), baseProps({ staleCount:1, onRedraftAll:noop }))), undefined, "…and no empty strip");
  assert.equal(redraftAll(render(box, mount(), baseProps({ staleCount:5 }))).length, 0, "no handler, no button");
  const busy = redraftAll(render(box, mount(), baseProps({ staleCount:3, onRedraftAll:noop, redraftingAll:{ i:2, total:3 } })))[0];
  assert.equal(textOf(busy), "Redrafting 2 / 3"); assert.equal(busy.props.disabled, true);
  const ro = redraftAll(render(box, mount(), baseProps({ staleCount:3, onRedraftAll:noop, readOnly:true })))[0];
  assert.equal(ro.props.disabled, true);
  // declared before the header that renders it
  assert.ok(scriptSrc.indexOf("const redraftAllBtn") < scriptSrc.indexOf("const header = "), "declaration order");
});

/* ============================ B. Write this beat: the latest script ============================ */
const clickWrite = (b, inst, props)=>{
  const tree = render(b, inst, props);
  const btn = writeBtn(tree);
  assert.ok(btn, "the gap offers 'Write this beat from the beat map'");
  assert.equal(textOf(btn), "Write this beat from the beat map");
  return btn.props.onClick();
};
await test("B an edit made while MUSE writes survives: the beat lands in the newest script, via the newest commit", async ()=>{
  const finish = deferredBeat(box);
  const inst = mount(), d0 = draftWithGap();
  const old = [], now = [];
  const p = clickWrite(box, inst, baseProps({ drafts:{ s1:d0 }, onEditScene:(id, d)=>{ old.push({ id, d }); return true; } }));
  // the writer fixes a line in beat 3 meanwhile (a manual edit commits a new draft)
  const d1 = { ...d0, edited:true, ai:false, by:null, blocks:d0.blocks.map((x,j)=> j===3 ? { ...x, text:"She walks to the wall, slowly." } : x) };
  render(box, inst, baseProps({ drafts:{ s1:d1 }, onEditScene:(id, d)=>{ now.push({ id, d }); return true; } }));
  finish(BEAT2());
  await p;
  assert.equal(old.length, 0, "never the click-time commit (its history would read the old draft)");
  assert.equal(now.length, 1, "one new version");
  const texts = now[0].d.blocks.map(x=>x.text);
  assert.deepEqual(texts, ["EXT. SALT PANS - DAY", "LEONOR (60s) rakes the salt into a white ridge.",
    "Leonor asks what the wall is for. Armindo only shrugs.", "She sets the rake down.", "She walks to the wall, slowly."],
    "the edit is kept and the beat sits in beat order");
  assert.equal(now[0].id, "s1");
  assert.equal(now[0].d.ai, true);
  assert.equal(box.__toasts.length, 0, "no message on success");
});
await test("B an Undo made while MUSE writes is respected: the beat goes into the version now on screen", async ()=>{
  box.__toasts = [];
  const finish = deferredBeat(box);
  const inst = mount();
  const older = { ...draftWithGap(), blocks:draftWithGap().blocks.slice(0, 3) };   // the version Undo brought back
  const now = [];
  const p = clickWrite(box, inst, baseProps({ drafts:{ s1:draftWithGap() } }));
  render(box, inst, baseProps({ drafts:{ s1:older }, onEditScene:(id, d)=>{ now.push(d); return true; } }));
  finish(BEAT2());
  await p;
  assert.equal(now.length, 1);
  assert.deepEqual(now[0].blocks.map(x=>x.beat), [1,1,2,3], "the undone-to version plus the new beat");
  assert.equal(now[0].blocks.length, older.blocks.length + 1);
});
await test("B a gap filled meanwhile (an edit, Undo or a redraft) is never written over; the writer is told", async ()=>{
  box.__toasts = [];
  const finish = deferredBeat(box);
  const inst = mount(), now = [];
  const p = clickWrite(box, inst, baseProps());
  const filled = { ...draftWithGap(), blocks:[...draftWithGap().blocks.slice(0,2), { beat:2, type:"action", text:"Leonor points at the wall." }, ...draftWithGap().blocks.slice(2)] };
  render(box, inst, baseProps({ drafts:{ s1:filled }, onEditScene:(id, d)=>{ now.push(d); return true; } }));
  finish(BEAT2());
  await p;
  assert.equal(now.length, 0, "nothing committed");
  assert.equal(box.__toasts.length, 1);
  assert.equal(box.__toasts[0].m, "Beat 2 of Scene 1 already has text now, so MUSE’s version wasn’t added. Your script is unchanged.");
});
await test("B nothing changed meanwhile: the beat lands exactly as before", async ()=>{
  box.__toasts = [];
  const finish = deferredBeat(box);
  const now = [], d0 = draftWithGap();
  const p = clickWrite(box, mount(), baseProps({ drafts:{ s1:d0 }, onEditScene:(id, d)=>{ now.push(d); return true; } }));
  finish(BEAT2());
  await p;
  assert.equal(now.length, 1);
  assert.deepEqual(now[0].blocks.map(x=>x.beat), [1,1,2,3,3]);
  assert.ok(now[0].blocks.slice(0,2).every((x,j)=>x===d0.blocks[j]), "the other blocks are the same objects");
});

/* ============================ C. Write this beat: the film guard ============================ */
await test("C a film switch while MUSE writes drops the beat, with a message; nothing lands in the other film", async ()=>{
  box.__toasts = [];
  const finish = deferredBeat(box);
  let film = "film:A";
  const filmKey = ()=>film;
  const inst = mount(), commits = [];
  const p = clickWrite(box, inst, baseProps({ filmKey, onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  // film B opens in the same App: its own scene s1 (same id — newId restarts per film) has a gap too
  film = "film:B";
  render(box, inst, baseProps({ filmKey, drafts:{ s1:draftWithGap() }, onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  finish(BEAT2());
  await p;
  assert.equal(commits.length, 0, "film B's scene is untouched");
  assert.equal(box.__toasts.length, 1);
  assert.equal(box.__toasts[0].m, "MUSE finished beat 2 of Scene 1 after you switched films, so it wasn’t added — nothing changed in either film. Go back to that film and press Write this beat again.");
  assert.equal(box.__toasts[0].t, "error");
});
await test("C the same film still open (filmKey unchanged): the beat lands", async ()=>{
  box.__toasts = [];
  const finish = deferredBeat(box);
  const commits = [];
  const p = clickWrite(box, mount(), baseProps({ filmKey:()=>"film:A", onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  finish(BEAT2());
  await p;
  assert.equal(commits.length, 1); assert.equal(box.__toasts.length, 0);
});
await test("C the Script view closed meanwhile: lands only when the app confirms the scene is untouched (getDraft)", async ()=>{
  // no getDraft: the view's last props can't be trusted once it is gone
  box.__toasts = [];
  let finish = deferredBeat(box);
  let inst = mount(), commits = [];
  let p = clickWrite(box, inst, baseProps({ onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  unmount(inst);
  finish(BEAT2()); await p;
  assert.equal(commits.length, 0);
  assert.ok(/the Script view closed while MUSE was writing it/.test(box.__toasts[0].m), box.__toasts[0].m);
  // getDraft says the scene is the one the view last saw: safe
  box.__toasts = [];
  const d0 = draftWithGap();
  finish = deferredBeat(box); inst = mount(); commits = [];
  p = clickWrite(box, inst, baseProps({ drafts:{ s1:d0 }, getDraft:(id)=>({ s1:d0 })[id], onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  unmount(inst);
  finish(BEAT2()); await p;
  assert.equal(commits.length, 1, "committed"); assert.equal(box.__toasts.length, 0);
  // getDraft says the scene changed after the view closed: dropped
  box.__toasts = [];
  finish = deferredBeat(box); inst = mount(); commits = [];
  p = clickWrite(box, inst, baseProps({ drafts:{ s1:d0 }, getDraft:()=>({ ...d0 }), onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  unmount(inst);
  finish(BEAT2()); await p;
  assert.equal(commits.length, 0); assert.equal(box.__toasts.length, 1);
});
await test("C getDraft wired: the beat is spliced into the app's current draft", async ()=>{
  box.__toasts = [];
  const finish = deferredBeat(box);
  const d0 = draftWithGap();
  const appNow = { ...d0, blocks:[...d0.blocks, { beat:3, type:"action", text:"Gulls lift off the pans." }] };
  const commits = [];
  const p = clickWrite(box, mount(), baseProps({ drafts:{ s1:d0 }, getDraft:(id)=>({ s1:appNow })[id], onEditScene:(id, d)=>{ commits.push(d); return true; } }));
  finish(BEAT2()); await p;
  assert.equal(commits.length, 1);
  assert.equal(commits[0].blocks[commits[0].blocks.length-1].text, "Gulls lift off the pans.");
  assert.equal(commits[0].blocks[2].beat, 2);
});

/* ============================ D. × while typing ============================ */
const editingTree = (b, inst, props)=>{
  const t0 = render(b, inst, props);
  const edit = find(t0, n=>n.type==="button" && textOf(n)==="Edit")[0];
  assert.ok(edit, "an Edit button");
  edit.props.onClick();
  return render(b, inst, props);
};
const editables = (b, tree)=>find(tree, n=>n.type===b.EditableBlock);
await test("D edit-mode lines keep their own key: removing an earlier line doesn't hand its key to the next", ()=>{
  const d0 = draftWithGap(), inst = mount(), commits = [];
  const props = baseProps({ drafts:{ s1:d0 }, onEditScene:(id, d)=>{ commits.push(d); return true; } });
  const t1 = editingTree(box, inst, props);
  const eds = editables(box, t1);
  assert.equal(eds.length, 4, "every block is editable");
  const keyOf = (b)=>eds.find(e=>e.props.b===b).props.key;
  const kA = keyOf(d0.blocks[2]), kB = keyOf(d0.blocks[3]);
  assert.ok(kA!==kB && !/^\d+$/.test(String(kA)) && !/^\d+$/.test(String(kB)), "not bare indexes: "+kA+", "+kB);
  // × on the earlier line of beat 3 (nothing being typed)
  eds.find(e=>e.props.b===d0.blocks[2]).props.onRemove();
  assert.equal(commits.length, 1);
  const t2 = render(box, inst, { ...props, drafts:{ s1:commits[0] } });
  const after = editables(box, t2).find(e=>e.props.b===d0.blocks[3]);
  assert.equal(after.props.key, kB, "the later line keeps its key (and so its DOM node)");
  assert.ok(!editables(box, t2).some(e=>e.props.key===kA), "the removed line's key is gone");
});
await test("D × on an earlier line while typing in a later line keeps the typed words (one version)", ()=>{
  const d0 = draftWithGap(), inst = mount(), commits = [];
  const props = baseProps({ drafts:{ s1:d0 }, onEditScene:(id, d)=>{ commits.push(d); return true; } });
  const t1 = editingTree(box, inst, props);
  const eds = editables(box, t1);
  const later = eds.find(e=>e.props.b===d0.blocks[3]);
  const kLater = later.props.key;
  // the caret is in the later line; its words aren't committed (a line commits on blur, and the
  // × keeps the focus)
  box.document.activeElement = { isContentEditable:true, innerText:"She runs to the wall. \n",
    closest:(sel)=> sel==="[data-sp-block-index]" ? { getAttribute:()=>String(later.props.blockIndex) } : null };
  try{
    eds.find(e=>e.props.b===d0.blocks[2]).props.onRemove();
  } finally { box.document.activeElement = null; }
  assert.equal(commits.length, 1, "one version: the removal and the typed words together");
  assert.deepEqual(commits[0].blocks.map(x=>x.text), ["EXT. SALT PANS - DAY", "LEONOR (60s) rakes the salt into a white ridge.", "She runs to the wall. "]);
  assert.equal(commits[0].edited, true);
  // the typed line's new copy keeps its key, so React keeps the focused node
  const t2 = render(box, inst, { ...props, drafts:{ s1:commits[0] } });
  const typed = editables(box, t2).find(e=>e.props.b===commits[0].blocks[2]);
  assert.equal(typed.props.key, kLater, "same key after the commit");
  assert.equal(d0.blocks[3].text, "She walks toward the wall.", "the old version is untouched (Undo restores it)");
});
await test("D (review) a line whose DOM holds a no-break space isn't rewritten when the same words are committed (the caret stays)", ()=>{
  // EditableBlock's own effect, run with a fake contentEditable node: the browser stores a typed
  // double / trailing space as U+00A0, and the committed text (from the × path) has plain spaces
  const inst = mount();
  const renderBlock = (b)=>{ CUR = inst; inst.i = 0; inst.pending = []; let t; try{ t = box.EditableBlock({ b, onCommit:noop, onRemove:noop, blockIndex:3 }); } finally { CUR = null; } inst.pending.forEach(f=>f()); return t; };
  renderBlock({ beat:3, type:"action", text:"She walks toward the wall." });
  let writes = 0, inner = "She runs  to the wall. ";
  inst.slots[0].current = { get innerText(){ return inner; }, set innerText(v){ writes++; inner = v; } };   // useRef is EditableBlock's first hook
  renderBlock({ beat:3, type:"action", text:"She runs  to the wall. " });
  assert.equal(writes, 0, "same words once the no-break spaces are read as spaces: the node (and the caret) is left alone");
  assert.equal(inner, "She runs  to the wall. ");
  // a real change from outside (Undo, a redraft) still reaches the line
  renderBlock({ beat:3, type:"action", text:"She stops." });
  assert.equal(writes, 1); assert.equal(inner, "She stops.");
});
await test("D a focused editor outside the script, or no pending change, leaves the removal as it was", ()=>{
  const d0 = draftWithGap(), inst = mount(), commits = [];
  const props = baseProps({ drafts:{ s1:d0 }, onEditScene:(id, d)=>{ commits.push(d); return true; } });
  const eds = editables(box, editingTree(box, inst, props));
  box.document.activeElement = { isContentEditable:true, innerText:"a note elsewhere", closest:()=>null };
  try{ eds.find(e=>e.props.b===d0.blocks[2]).props.onRemove(); } finally { box.document.activeElement = null; }
  assert.deepEqual(commits[0].blocks, [d0.blocks[0], d0.blocks[1], d0.blocks[3]], "same objects, nothing rewritten");
  // a committed edit keeps the line's key too
  const t2 = render(box, inst, { ...props, drafts:{ s1:d0 } });
  const e3 = editables(box, t2).find(e=>e.props.b===d0.blocks[3]);
  e3.props.onCommit("She walks on.");
  const t3 = render(box, inst, { ...props, drafts:{ s1:commits[1] } });
  assert.equal(editables(box, t3).find(e=>e.props.b===commits[1].blocks[3]).props.key, e3.props.key);
});

/* ============================ E. act breaks for any act count ============================ */
const sc = (act, extra)=>({ act, loc:"EXT. SEA WALL - DAY", openCharge:1, closeCharge:1, openValue:"a", closeValue:"b", ...(extra||{}) });
await test("E Kishōtenketsu's Ten → Ketsu cut reads 'ACT III → IV', names the movement, and gives no three-act advice", ()=>{
  const t = box.sceneTransition(sc(3), sc(4), { framework:"kishotenketsu" });
  assert.equal(t.type, "ACT III → IV");
  assert.equal(t.cls, "act");
  assert.equal(t.gloss, "Movement break — the story crosses into Ketsu (Reconciliation). No clash is required here; the charge doesn’t have to alternate.");
  assert.ok(!/must alternate/.test(t.gloss));
  const k2 = box.sceneTransition(sc(1), sc(2), { framework:"kishotenketsu" });
  assert.equal(k2.type, "ACT I → II");
  assert.ok(/Shō \(Development\)/.test(k2.gloss), k2.gloss);
});
await test("E three-act copy is unchanged; Story Circle's four acts (classic turn rule) read III → IV with it", ()=>{
  const THREE = "Act break — the story crosses into a new movement; the charge must alternate here.";
  const t = box.sceneTransition(sc(1), sc(2), { framework:"threeact" });
  assert.equal(t.type, "ACT I → II"); assert.equal(t.gloss, THREE);
  assert.equal(box.sceneTransition(sc(2), sc(3), {}).gloss, THREE, "no framework: the default three-act");
  const c = box.sceneTransition(sc(3), sc(4), { framework:"storycircle" });
  assert.equal(c.type, "ACT III → IV"); assert.equal(c.gloss, THREE);
  // any count, never "undefined"
  for(let a=1;a<=8;a++) assert.ok(!/undefined/.test(box.sceneTransition(sc(a), sc(a+1), { framework:"kishotenketsu" }).type));
  assert.equal(box.sceneTransition(sc(4), sc(5)).type, "ACT IV → V");
  assert.equal(box.sceneTransition(sc(9), sc(10)).type, "ACT IX → X");
  assert.equal(box.sceneTransition(sc(2), sc(undefined)).type, "ACT II → —");
  // the open film is the default (window.turnProject)
  box.turnProject = { framework:"kishotenketsu" };
  try{ assert.ok(/^Movement break/.test(box.sceneTransition(sc(3), sc(4)).gloss)); } finally { box.turnProject = undefined; }
  // other cuts are untouched
  assert.equal(box.sceneTransition(null, sc(1)).type, "COLD OPEN");
});
await test("E the Script view's transition bars use the film's framework", ()=>{
  const K = [
    { id:"k3", no:3, act:3, title:"Ten", loc:"EXT. PANS - DAY", openValue:"a", openCharge:1, closeValue:"b", closeCharge:1, summary:"x" },
    { id:"k4", no:4, act:4, title:"Ketsu", loc:"EXT. WALL - DUSK", openValue:"a", openCharge:1, closeValue:"b", closeCharge:1, summary:"x" },
  ];
  const project = { title:"Salt", format:"short", framework:"kishotenketsu" };
  const tree = render(box, mount(), baseProps({ scene:K[1], scenes:K, drafts:{ k4:draftWithGap() }, beats:BEATS, project, total:2 }));
  const bars = find(tree, n=>n.type===box.TransitionBar && n.props.trans);
  assert.ok(bars.length>=1);
  assert.equal(bars[0].props.trans.type, "ACT III → IV");
  assert.ok(/Ketsu \(Reconciliation\)/.test(bars[0].props.trans.gloss));
  const out = render(box, mount(), baseProps({ scene:K[0], scenes:K, drafts:{ k3:draftWithGap() }, project, total:2 }));
  const outBar = find(out, n=>n.type===box.TransitionBar && n.props.out)[0];
  assert.equal(outBar.props.trans.type, "ACT III → IV", "the outgoing bar too");
});

/* ============================ F. testimony: "<Name>: <words>" ============================ */
await test("F the doc's accepted testimony form is '<subject> on <topic>' — '<Name>: <words>' is not listed", ()=>{
  const doc = read("docs/Story Pipeline.md");
  const i = doc.indexOf("**Page forms the check accepts**");
  assert.ok(i>=0, "the Page forms paragraph");
  const para = doc.slice(i, doc.indexOf("\n\n", i)).replace(/\n>\s*/g," ").replace(/\s+/g," ");
  assert.ok(para.includes("planned testimony as **EXPECTED TESTIMONY: <subject> on <topic>** in action, never as invented lines for a real person"), para);
  assert.ok(!/EXPECTED TESTIMONY: <(?:subject|name)>:/i.test(para), "no '<Name>: <words>' form in the doc");
});
const CAST = [{ id:"l", name:"Leonor Sarmento" }, { id:"a", name:"Armindo" }];
await test("F 'EXPECTED TESTIMONY: Leonor: <words>' is flagged like the named em-dash form; topics still pass", ()=>{
  const speakers = box.screenplaySpeakers([], null, CAST);
  const rejects = [
    "EXPECTED TESTIMONY: Leonor: The flood took everything.",                       // the audit's line
    "EXPECTED TESTIMONY: Leonor Sarmento: The flood took everything.",
    "EXPECTED TESTIMONY — Leonor: The flood took everything.",
    "EXPECTED TESTIMONY: Leonor (sit-down): The flood took everything.",
    "EXPECTED TESTIMONY: Leonor (V.O.): on the flood night.",                        // a voice bracket: her line
    "She sits by the pans. EXPECTED TESTIMONY: Armindo: I never went back.",
    "EXPECTED TESTIMONY — LEONOR: The flood took everything.",                   // unchanged: already flagged
    "EXPECTED TESTIMONY: LEONOR: The flood took everything.",                         // unchanged: already flagged
  ];
  for(const l of rejects){
    const hit = box.screenplayEmbeddedDialogue(l, speakers);
    assert.ok(hit && box.screenplayRejectsLabel(hit), "rejects: "+l);
  }
  const named = box.screenplayEmbeddedDialogue("EXPECTED TESTIMONY: Leonor: The flood took everything.", speakers);
  assert.equal(named.labelClass, "testimony", "read as the named form");
  const accepts = [
    "EXPECTED TESTIMONY: Leonor Sarmento on the night of the flood.",                // the doc's own form
    "EXPECTED TESTIMONY: Leonor: on the night of the flood.",
    "EXPECTED TESTIMONY: Leonor: her account of the flood night.",
    "EXPECTED TESTIMONY (record): Leonor: how the salt pans were worked.",
    "EXPECTED TESTIMONY — LEONOR: on the flood night.",
    "EXPECTED TESTIMONY: The flood took everything.",                                  // unnamed: unchanged (owner item)
    "EXPECTED TESTIMONY: Marcus: The flood took everything.",                          // not a cast member: unchanged
    "She sits by the pans. EXPECTED TESTIMONY: Armindo: on the salt price. He looks away.",
  ];
  for(const l of accepts) assert.equal(box.screenplayEmbeddedDialogue(l, speakers), null, "accepts: "+l);
});
await test("F the Script check flags it too (was clean)", ()=>{
  box.turnCast = [{ id:"l", name:"Leonor" }];
  try{
    const scene = { id:"d1", no:1, title:"Pans", loc:"EXT. SALT PANS - DAY" };
    const mk = (t)=>({ ai:true, by:{}, blocks:[{ beat:1, type:"scene", text:"EXT. SALT PANS - DAY" }, { beat:1, type:"action", text:t }] });
    // (only the dialogue codes: this sandbox leaves out the slugline parser's file)
    const codes = (t)=>Array.from(box.screenplayFormatReport(scene, mk(t), null).issues, x=>x.code).filter(c=>/dialogue|action-label/.test(c));
    assert.deepEqual(codes("EXPECTED TESTIMONY: Leonor: The flood took everything."), ["dialogue-in-action"]);
    assert.deepEqual(codes("EXPECTED TESTIMONY: Leonor: on the night of the flood."), []);
    assert.deepEqual(codes("EXPECTED TESTIMONY: Leonor on the night of the flood."), []);
  } finally { box.turnCast = undefined; }
});

console.log(`\n${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

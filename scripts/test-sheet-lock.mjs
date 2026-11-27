#!/usr/bin/env node
/* The road, step 4: the lock (owner 2026-11-20: "once that's locked, bring in the props"; "to make sure we are
   locking everything"; "a locked sheet never changes silently").

   1 The lock is a note on one exact image version, on this device and in the cloud; a new image has none.
   2 The Lock button: at once when the QA check says Faithful; otherwise it says what the check said and asks.
   3 Nothing changes a locked image silently: remake, edit, clear, upload, restore and delete ask first; a batch
     leaves it alone; the road's own next step (the wardrobe update) starts from it without asking.
   4 It sits after the QA check on character and prop cards.

     node scripts/test-sheet-lock.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const art = read("app/artroom.jsx"), img = read("app/imagegen.jsx"), cloud = read("app/cloud.jsx"), props = read("app/props.jsx"), css = read("app/styles.css"), ai = read("app/ai.jsx"), html = read("TURN.html");

await test("1 the lock is kept on one exact version: saved for that version only, here and in the cloud; unlocking removes it", async () => {
  // the device store, run for real
  const store = { img: { liaqat: "blob:x" }, meta: { liaqat: { iso: "v2", qa: { iso: "v2" } } } }; const events = [];
  const sb = { console, Promise, Object, JSON, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; } };
  sb.window = sb; sb.dispatchEvent = (e) => events.push([e.type, e.detail && e.detail.id]);
  vm.runInNewContext("let _nbEpoch=1,_nbBackend='local',_nbUid='u';const _cloudMetaCache=new Map();const _scopeFor=()=>'p';const _nbSerial=(id,fn)=>fn();"
    + "const localGetMeta=(id)=>store.meta[id]||null,localGetImage=(id)=>store.img[id]||'',localSetMeta=(id,m)=>{store.meta[id]=m;};\n"
    + between(img, "function nbSetAssetLock(id, expectedIso, lock){", "window.nbSetAssetLock=nbSetAssetLock;") + "\nthis.f=nbSetAssetLock;", Object.assign(sb, { store }));
  const r = plain(await sb.f("liaqat", "v2", { at: 5, qa: "pass" }));
  assert.equal(r.ok, true); assert.deepEqual(plain(store.meta.liaqat.lock), { at: 5, qa: "pass", iso: "v2" }); assert.deepEqual(plain(store.meta.liaqat.qa), { iso: "v2" }, "the QA result is left as it is");
  assert.deepEqual(events.pop(), ["nb-meta-changed", "liaqat"], "the card hears it");
  assert.equal(plain(await sb.f("liaqat", "v1", { at: 6 })).error, "asset version changed", "never onto another version");
  assert.equal(plain(await sb.f("nobody", "v2", { at: 6 })).ok, false); assert.equal(plain(await sb.f("liaqat", "", { at: 6 })).ok, false);
  assert.equal(plain(await sb.f("liaqat", "v2", null)).ok, true); assert.equal("lock" in store.meta.liaqat, false, "unlocked: the note is gone");
  // the cloud side mirrors it, and writes through the same compare-and-set as the QA note
  const c = between(cloud, "async function cloudSetAssetLock(projectId, uid, entityId, expectedIso, lock){", "window.cloudSetAssetLock=cloudSetAssetLock;");
  assert.ok(c.includes('if(!expectedIso || !row.meta || row.meta.iso!==expectedIso) return {ok:false,error:"asset version changed"};'));
  assert.ok(c.includes("if(lock) meta.lock={...lock,iso:expectedIso}; else delete meta.lock;") && c.includes("await cloudCasGen(projectId,uid,entityId,row,{"));
  const n = between(img, "function nbSetAssetLock(id, expectedIso, lock){", "window.nbSetAssetLock=nbSetAssetLock;");
  assert.ok(!/nbGenerate|hold|credit/i.test(n), "nothing is made and nothing is spent");
});

/* the button and the question, run for real */
const el = (type, p, ...ch) => ({ type, props: p || {}, children: ch.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) });
const text = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (n && n.children ? n.children.map(text).join("") : "");
function lab(over){
  const o = Object.assign({ confirm: true }, over || {}); const log = [];
  const sb = { console, Promise, Date, Number, String, Array, JSON, isNaN };
  sb.window = sb; sb.React = { createElement: el, useState: (v) => [v, (x) => log.push(["busy", x])] }; sb.Icon = { padlock: "ic-padlock", check: "ic-check" };
  sb.appToast = (m, k) => log.push(["toast", k || "info", m]);
  sb.appConfirm = async (q) => { log.push(["ask", q.title, q.confirmLabel, q.cancelLabel, q.body]); return o.confirm; };
  sb.nbSetAssetLock = async (id, iso, v) => { log.push(["set", id, iso, v && { qa: v.qa }]); return { ok: o.saveFails ? false : true }; };
  vm.runInNewContext(between(art, "function qaKept(gen){", "window.qaKept = qaKept;") + "\n" + between(art, "function sheetLockOf(meta){", "window.LockButton = LockButton;")
    + "\nthis.LockButton=LockButton;this.sheetLockOf=sheetLockOf;this.turnLockedAsk=turnLockedAsk;", sb);
  return Object.assign(sb, { log });
}
const gen = (meta) => ({ id: "liaqat", genUrl: "blob:x", gening: false, genMeta: meta });
const passQa = { iso: "v2", at: 1, report: { verdict: "pass", deviations: [], inventions: [] } };
const minorQa = { iso: "v2", at: 1, report: { verdict: "minor", deviations: [{ what: "a" }, { what: "b" }], inventions: [] } };

await test("2 the Lock button: at once after a Faithful check; otherwise it says what the check said and asks; unlocking asks", async () => {
  const a = lab();
  assert.equal(a.LockButton({ gen: { id: "x", genUrl: "", genMeta: null } }), null, "no image, no lock");
  const b1 = a.LockButton({ gen: gen({ iso: "v2", qa: passQa }), name: "LIAQAT", noun: "character sheet" });
  assert.equal(text(b1), "Lock"); assert.equal(b1.props["data-locked"], "0"); assert.equal(b1.props["aria-pressed"], "false");
  assert.ok(!b1.props.title.includes("Best after"), "the check passed: no reminder");
  await b1.props.onClick();
  assert.deepEqual(a.log.filter(x => x[0] === "ask"), [], "a faithful image locks without a question");
  assert.deepEqual(plain(a.log.find(x => x[0] === "set")), ["set", "liaqat", "v2", { qa: "pass" }]);
  assert.deepEqual(a.log.find(x => x[0] === "toast").slice(1), ["success", "LIAQAT is locked. What you make next is built from this character sheet."]);
  // a drift, or no check at all: it says so and asks
  const m = lab(); const b2 = m.LockButton({ gen: gen({ iso: "v2", qa: minorQa }), name: "LIAQAT", noun: "character sheet" });
  assert.ok(b2.props.title.endsWith("Best after a QA check that says Faithful."));
  await b2.props.onClick();
  const q = m.log.find(x => x[0] === "ask");
  assert.deepEqual(q.slice(1, 4), ["Lock it without a clean check?", "Lock anyway", "Not yet"]); assert.match(q[4], /^The last QA check of this image said: Minor drift · 2\./);
  assert.deepEqual(plain(m.log.find(x => x[0] === "set")), ["set", "liaqat", "v2", { qa: "minor" }]);
  const n = lab({ confirm: false }); await n.LockButton({ gen: gen({ iso: "v2" }), name: "LIAQAT", noun: "character sheet" }).props.onClick();
  assert.match(n.log.find(x => x[0] === "ask")[4], /^This image has not had a QA check yet\./); assert.equal(n.log.some(x => x[0] === "set"), false, "'Not yet': nothing is locked");
  // a QA result of ANOTHER version does not count for this one
  const o = lab({ confirm: false }); await o.LockButton({ gen: gen({ iso: "v3", qa: passQa }), name: "L", noun: "sheet" }).props.onClick();
  assert.equal(o.log.some(x => x[0] === "ask"), true);
  // locked: it shows it, and unlocking asks first
  const l = lab(); const b3 = l.LockButton({ gen: gen({ iso: "v2", lock: { iso: "v2", at: Date.UTC(2026, 10, 20, 12), qa: "pass" } }), name: "LIAQAT", noun: "character sheet" });
  assert.equal(text(b3), "Locked"); assert.equal(b3.props["data-locked"], "1"); assert.ok(b3.props.className.includes("sheet-lock-btn locked")); assert.match(b3.props.title, /^Locked on .+\. What you make next is built from this character sheet/);
  await b3.props.onClick();
  assert.deepEqual(l.log.find(x => x[0] === "ask").slice(1, 4), ["Unlock LIAQAT’s character sheet?", "Unlock", "Keep it locked"]);
  assert.deepEqual(plain(l.log.find(x => x[0] === "set")), ["set", "liaqat", "v2", null]);
  // a lock that belongs to another version is no lock
  assert.equal(a.sheetLockOf({ iso: "v3", lock: { iso: "v2", at: 1 } }), null); assert.equal(a.sheetLockOf(null), null);
  const f = lab({ saveFails: true }); await f.LockButton({ gen: gen({ iso: "v2", qa: passQa }), name: "L", noun: "sheet" }).props.onClick();
  assert.deepEqual(f.log.find(x => x[0] === "toast").slice(1), ["error", "The lock could not be saved. Try again."]);
});

await test("3 nothing changes a locked image silently; a batch leaves it alone; the road's next step starts from it", async () => {
  const a = lab({ confirm: false });
  const locked = { iso: "v2", lock: { iso: "v2", at: 1 } };
  assert.equal(await a.turnLockedAsk({ iso: "v2" }, "LIAQAT", "image", "make a new one"), true, "not locked: nothing is asked");
  assert.equal(a.log.length, 0);
  assert.equal(await a.turnLockedAsk(locked, "LIAQAT", "image", "make a new one"), false);
  const q = a.log.pop();
  assert.deepEqual(q.slice(1, 4), ["LIAQAT’s image is locked", "Unlock and go on", "Keep it locked"]);
  assert.match(q[4], /To make a new one, it has to be unlocked: the new image will not be locked, and anything made from the locked one will be marked as out of date\. The locked image stays in its versions\.$/);
  assert.equal(await lab({ confirm: true }).turnLockedAsk(locked, "", "prop sheet", "clear it"), true);
  // where it is asked
  const g = between(art, "  const lockName = ()=>", "  const cancelGen = ()=>");
  assert.ok(g.includes("if(sheetLockOf(genMeta) && !(gopts && gopts.lockOk)){") && g.includes("if(gopts && gopts.batch) return false;"), "a batch leaves a locked image alone");
  assert.ok(g.includes('const ok = await turnLockedAsk(genMeta, lockName(), "image", (gopts && gopts.editInstruction) ? "change it" : "make a new one");') && g.includes("if(!ok) return false;"));
  for (const [what, fn] of [["clear it", "const clearGen = async ()=>{"], ["replace it with an upload", "const importSheet = async (file)=>{"], ["restore another version", "const revertTo = async (index)=>{"], ["delete this version", "const deleteCurrentAndPromote = async ()=>{"]]){
    const body = art.slice(art.indexOf("  " + fn), art.indexOf("  " + fn) + 520);
    assert.ok(body.includes('turnLockedAsk(genMeta, lockName(), "image", "' + what + '")'), what);
  }
  // …and the batch itself moves on past a locked card (it would otherwise wait for a run that never starts)
  assert.ok(art.includes("if(!batchStarted.current && !gen.gening && !inflight && sheetLockOf(gen.genMeta)){ onBatchDone && onBatchDone(c.id); return; }"));
  assert.ok(props.includes('if(!batchStarted.current && !gen.gening && !inflight && typeof window.sheetLockOf==="function" && window.sheetLockOf(gen.genMeta)){\n      onBatchDone && onBatchDone(p.id); return; }'));
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  assert.ok(sheet.includes("return { lockOk:true, keepOriginal: (io)=> keepOriginalForWardrobe(io, items),"), "the wardrobe update builds the next step from the locked sheet: it does not ask");
});

await test("4 on the cards: after the QA check, on characters and props; nobody who may not edit gets it", () => {
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  // (step 6: the same button is handed the final look)
  assert.ok(/wornItems:finalLookItems \}\),\n(?:\s*\/\/[^\n]*\n)+\s*!readOnly && React\.createElement\(LockButton,\{ gen, name:c\.name, noun:"character sheet", finalLook \}\)/.test(sheet));
  assert.ok(/onApplySpec:\(patch\)=>onUpdate\(p\.id, patch\) \}\),\n\s*\/\/[^\n]*\n\s*window\.LockButton && React\.createElement\(window\.LockButton,\{ gen:genForFrame, name:p\.name, noun:"prop sheet" \}\),/.test(props));
  for (const k of [".sheet-lock-btn.locked{background:var(--ok-soft);border-color:var(--ok-line);color:var(--txt-0)}", ".sheet-lock-btn.locked svg{color:var(--ok)}"]) assert.ok(css.includes(k), k);
});

await test("F Frances knows; nothing she is told names the codename; the changed files are served under a new key", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"Lock an image you are happy with (Characters, Props, Art Room)"', "function appBrief(){");
  for (const k of ["'Lock'", "'Locked'", "'Lock anyway'", "Faithful", "'Unlock and go on'", "a batch", "its versions", "costs nothing"]) assert.ok(f.includes(k), k);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic/.test(f));
  const KEYS = ["20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1"];   // (the list grows with each key bump)
  for (const file of ["artroom.jsx", "imagegen.jsx", "cloud.jsx", "props.jsx", "ai.jsx", "script.jsx", "styles.css"]) assert.ok(KEYS.some(k => html.includes("app/" + file + "?v=" + k + '"')), file);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

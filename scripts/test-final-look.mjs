#!/usr/bin/env node
/* The road, step 6: the final look (owner 2026-11-20: "yes, start on step 6"; the Story Pipeline: "Build the final
   look — the locked sheet plus its locked items; the items are copied in by code. Check it, lock it.").

   1 Where a sheet stands: an item waits to be added, it wears its items and waits for its check, it waits for its
     lock, it is the locked final look. A sheet with no item images goes the same way.
   2 The lock: "Lock final look" on a sheet that wears its items; the record says it is the final look and what it
     wears; an item that is not locked is said in the same one question, never blocked.
   3 The card: the step guide says where the final look stands (the amber line left 2026-11-20); the Lock button is handed it.
   4 The check: each worn item is looked for; a sheet updated in place is read against its whole description.
   5 Frances knows it.

     node scripts/test-final-look.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const art = read("app/artroom.jsx"), ai = read("app/ai.jsx"), html = read("TURN.html");

/* the rule and the button, run for real */
const el = (type, p, ...ch) => ({ type, props: p || {}, children: ch.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) });
const text = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (n && n.children ? n.children.map(text).join("") : "");
function lab(over) {
  const o = Object.assign({ confirm: true }, over || {}); const log = [];
  const sb = { console, Promise, Date, Number, String, Array, JSON, isNaN };
  sb.window = sb; sb.React = { createElement: el, useState: (v) => [v, () => {}] }; sb.Icon = { padlock: "ic-padlock", check: "ic-check" };
  sb.appToast = (m, k) => log.push(["toast", k || "info", m]);
  sb.appConfirm = async (q) => { log.push(["ask", q.title, q.confirmLabel, q.cancelLabel, q.body]); return o.confirm; };
  sb.nbSetAssetLock = async (id, iso, v) => { log.push(["set", id, iso, v && { ...v, at: 0 }]); return { ok: true }; };
  vm.runInNewContext(between(art, "function qaKept(gen){", "window.qaKept = qaKept;") + "\n" + between(art, "function sheetLockOf(meta){", "window.LockButton = LockButton;")
    + "\nthis.LockButton=LockButton;this.charFinalLook=charFinalLook;", sb);
  return Object.assign(sb, { log });
}
const L = lab(), fl = (o) => plain(L.charFinalLook(o));
const ring = { id: "p1", name: "engagement ring", included: true, hasImage: true, iso: "r1", locked: true };
const lanyard = { id: "p2", name: "work lanyard", included: true, hasImage: true, iso: "l1", locked: false };
const wears = (...ids) => ids.map((id) => ({ refId: id, mode: "visual" }));

await test("1 where a sheet stands on the way to its final look", async () => {
  assert.equal(L.charFinalLook({ meta: null }), null); assert.equal(L.charFinalLook({ meta: {} }), null, "no image, no final look");
  // an item has an image the sheet does not wear yet
  let r = fl({ meta: { iso: "s1", lock: { iso: "s1" } }, wardrobeStale: true, worn: [ring] });
  assert.equal(r.stage, "update"); assert.equal(r.locked, true); assert.equal(r.hasItems, false, "not on the sheet yet");
  // it wears them: check, then lock, then final
  const meta = { iso: "s2", wornReferences: wears("p1", "p2") };
  r = fl({ meta, worn: [ring, lanyard], qa: "" });
  assert.equal(r.stage, "check"); assert.equal(r.hasItems, true);
  assert.deepEqual(r.items, [{ id: "p1", name: "engagement ring", iso: "r1", locked: true }, { id: "p2", name: "work lanyard", iso: "l1", locked: false }]);
  assert.deepEqual(r.unlocked, ["work lanyard"], "listed, not blocked");
  assert.equal(fl({ meta, worn: [ring, lanyard], qa: "minor" }).stage, "check"); assert.equal(fl({ meta, worn: [ring, lanyard], qa: "pass" }).stage, "lock");
  assert.equal(fl({ meta: { ...meta, lock: { iso: "s2" } }, worn: [ring, lanyard], qa: "pass" }).stage, "final");
  assert.equal(fl({ meta: { ...meta, lock: { iso: "s1" } }, worn: [ring, lanyard], qa: "pass" }).stage, "lock", "a lock of another version is no lock");
  assert.equal(fl({ meta: { ...meta, lock: { iso: "s2" } }, worn: [ring, lanyard], wardrobeStale: true }).stage, "update", "an item changed after the lock: it is to be added again");
  // what counts as on the sheet: drawn from its image, with an image, not switched to words
  assert.equal(fl({ meta: { iso: "s2", wornReferences: [{ refId: "p1", mode: "text" }] }, worn: [ring] }).hasItems, false);
  r = fl({ meta, worn: [ring, { ...lanyard, included: false }, { id: "p3", name: "tiny gold stud earrings", included: true, hasImage: false }] });
  assert.deepEqual(r.items.map((x) => x.name), ["engagement ring"]); assert.deepEqual(r.inWords, ["work lanyard", "tiny gold stud earrings"]);
  // no item images at all: the same road, and its lock is its final look
  r = fl({ meta: { iso: "s1" }, worn: [] }); assert.equal(r.stage, "check"); assert.equal(r.hasItems, false);
  assert.equal(fl({ meta: { iso: "s1", lock: { iso: "s1" } }, worn: [] }).stage, "final");
});

const gen = (meta) => ({ id: "eshita", genUrl: "blob:x", gening: false, genMeta: meta });
const passQa = { iso: "s2", at: 1, report: { verdict: "pass", deviations: [], inventions: [] } };

await test("2 the lock of a final look: its own words, its record, and one question for what is not clean", async () => {
  // words found wrong in the first paid run: a sheet that WAS checked and drifts is to be fixed, not "checked first";
  // unlocking a final look names it
  assert.ok(art.includes('(sev!=="pass" ? (kept ? "fix it first" : "check it first") : "lock "+(open.length===1 ? "the item" : "the items")+" first")'));
  assert.ok(art.includes('title:"Unlock "+(name ? name+"\\u2019s " : "this ")+(isFinal ? "final look" : (noun||"image"))+"?",'));
  const meta = { iso: "s2", wornReferences: wears("p1", "p2"), qa: passQa };
  // all clean: one press
  const a = lab(); const look = a.charFinalLook({ meta, worn: [ring, { ...lanyard, locked: true }], qa: "pass" });
  const b = a.LockButton({ gen: gen(meta), name: "ESHITA", noun: "character sheet", finalLook: look });
  assert.equal(text(b), "Lock final look"); assert.match(b.props.title, /^Lock the final look: this sheet with its items on it\. The shots are then built from it/);
  await b.props.onClick();
  assert.equal(a.log.some((x) => x[0] === "ask"), false);
  assert.deepEqual(plain(a.log.find((x) => x[0] === "set")), ["set", "eshita", "s2", { at: 0, qa: "pass", final: true,
    items: [{ id: "p1", name: "engagement ring", iso: "r1", locked: true }, { id: "p2", name: "work lanyard", iso: "l1", locked: true }] }], "the record says what the final look wears");
  assert.deepEqual(a.log.find((x) => x[0] === "toast").slice(1), ["success", "ESHITA’s final look is locked. The shots are built from it."]);
  // an item's own image is not locked: said, allowed
  const m = lab(); const look2 = m.charFinalLook({ meta, worn: [ring, lanyard], qa: "pass" });
  await m.LockButton({ gen: gen(meta), name: "ESHITA", noun: "character sheet", finalLook: look2 }).props.onClick();
  const q = m.log.find((x) => x[0] === "ask");
  assert.deepEqual(q.slice(1, 4), ["Lock the final look with an item that is not locked?", "Lock anyway", "Not yet"]);
  assert.ok(q[4].startsWith("This item’s own image is not locked yet: work lanyard. ") && q[4].includes("make it out of date") && q[4].endsWith("lock the item first."));
  assert.equal(m.log.some((x) => x[0] === "set"), true, "'Lock anyway' locks it");
  const n = lab({ confirm: false }); await n.LockButton({ gen: gen(meta), name: "E", noun: "sheet", finalLook: n.charFinalLook({ meta, worn: [ring, lanyard], qa: "pass" }) }).props.onClick();
  assert.equal(n.log.some((x) => x[0] === "set"), false, "'Not yet': nothing is locked");
  // no clean check AND an open item: still one question, both said
  const k = lab(); const noQa = { iso: "s2", wornReferences: wears("p1", "p2") };
  await k.LockButton({ gen: gen(noQa), name: "E", noun: "character sheet", finalLook: k.charFinalLook({ meta: noQa, worn: [ring, lanyard] }) }).props.onClick();
  const asks = k.log.filter((x) => x[0] === "ask"); assert.equal(asks.length, 1);
  assert.equal(asks[0][1], "Lock it without a clean check?"); assert.ok(asks[0][4].includes("has not had a QA check yet") && asks[0][4].includes("not locked yet: work lanyard") && asks[0][4].includes("A locked final look"));
  // locked: the button says which lock it is
  const fin = { ...meta, lock: { iso: "s2", at: Date.UTC(2026, 10, 20, 12), final: true } };
  const l = lab(); const b3 = l.LockButton({ gen: gen(fin), name: "ESHITA", noun: "character sheet", finalLook: l.charFinalLook({ meta: fin, worn: [ring, lanyard] }) });
  assert.equal(text(b3), "Final look locked"); assert.equal(b3.props["data-final"], "1"); assert.match(b3.props.title, /^The final look, locked on .+\. The shots are built from it/);
  // an item changed after the lock: it is a locked sheet again, not the final look, until it is updated
  const st = l.LockButton({ gen: gen(fin), name: "ESHITA", noun: "character sheet", finalLook: l.charFinalLook({ meta: fin, worn: [ring, lanyard], wardrobeStale: true }) });
  assert.equal(text(st), "Locked"); assert.equal(st.props["data-final"], "0");
  // a sheet with no item images, and a prop's image: the plain lock, as before
  const p = lab(); const plainMeta = { iso: "s2", qa: passQa };
  const b4 = p.LockButton({ gen: gen(plainMeta), name: "LIAQAT", noun: "character sheet", finalLook: p.charFinalLook({ meta: plainMeta, worn: [], qa: "pass" }) });
  assert.equal(text(b4), "Lock"); await b4.props.onClick();
  assert.deepEqual(plain(p.log.find((x) => x[0] === "set")), ["set", "eshita", "s2", { at: 0, qa: "pass" }], "no final-look record without items");
  assert.equal(text(p.LockButton({ gen: gen(plainMeta), name: "ring", noun: "prop sheet" })), "Lock");
});

await test("3 the card: the step guide says where the final look stands; the buttons are handed it; an item's lock is heard", async () => {
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  assert.ok(sheet.includes("const finalLook = gen.genUrl ? charFinalLook({ meta:gen.genMeta, wardrobeStale,"));
  assert.ok(sheet.includes("return { id:p.id, name:p.name, included:!wornExclusions.has(p.id), hasImage:!!ownedSheetMap[p.id], iso:(m && m.iso)||\"\", locked:!!sheetLockOf(m) }; }) }) : null;"));
  assert.ok(sheet.includes("worn:wornProps.map("), "worn items only: a carried item is not on the sheet");
  // (2026-11-20, the step guide) the amber "Final look ready to check / to lock" line is the guide's pill 6 now: one
  // place says where the sheet stands, and the Lock button beside the check is still the only lock button
  assert.ok(!sheet.includes('"data-testid":"char-final-look"') && !sheet.includes("Final look ready to"), "the amber line left with the guide");
  const guide = between(sheet, "React.createElement(RoadStepGuide,{", "// (the \"Face: \u2026 \u00b7 Voice: \u2026\" line under the buttons is gone");
  assert.ok(guide.includes("finalLook, wardrobeStale:!!wardrobeStale,"), "the guide is handed the same final-look state");
  const steps = between(art, "function roadSteps(o){", "function roadStepTitle(");
  assert.ok(steps.includes('" Not locked yet: "+fl.unlocked.join(", ")') && steps.includes('" Kept as words, not drawn from an image: "+fl.inWords.join(", ")'), "what the line's tooltip said is in the pill's");
  assert.ok(sheet.includes('!readOnly && React.createElement(LockButton,{ gen, name:c.name, noun:"character sheet", finalLook })'));
  assert.ok(sheet.includes("wornItems:finalLookItems }),"));
  assert.ok(sheet.includes('window.addEventListener("nb-meta-changed", onDone);'), "locking an item on its own card is seen here");
  // the update that builds it starts from the locked sheet without asking, and its result is a new, unlocked version
  assert.ok(sheet.includes("return { lockOk:true, keepOriginal: (io)=> keepOriginalForWardrobe(io, items),"));
});

await test("4 the check of a final look: each worn item is looked for; a kept version is read against its whole description", async () => {
  const btn = between(art, "function QaCheckButton({", "window.QaCheckButton");
  assert.ok(/function QaCheckButton\(\{[^}]*wornItems[^}]*\}\)\{/.test(art));
  // any edited version, kept pixel for pixel or redrawn whole by the engine (the first paid check read an older edit
  // against its small instruction and called the sheet's own headless front view a major drift)
  assert.ok(btn.includes('if(gm.mode==="edit" && gm.specPrompt)'));
  assert.ok(!btn.includes("gm.keptOriginal && gm.specPrompt"));
  // the check reads the whole contract: a sheet's layout rule sits past 9,000 characters once its items have designs
  assert.ok(ai.includes("const QA_CONTRACT_MAX_CHARS = 24000;"));
  assert.ok(ai.includes('"GENERATION PROMPT:\\n"+String(item.prompt).slice(0,QA_CONTRACT_MAX_CHARS)+"\\n\\n"'));
  assert.ok(!/String\(item\.prompt\)\.slice\(0,[^Q)]*5000/.test(ai), "no 5,000-character cut of the contract");
  assert.ok(btn.includes('contract = String(gm.specPrompt)+(gm.editInstruction ? "\\n\\nAFTER THAT, ONE LOCAL CHANGE WAS MADE TO THE IMAGE (where it differs from the text above, the change is right): "+String(gm.editInstruction) : "");'));
  assert.ok(btn.indexOf('gm.mode==="edit" && gm.specPrompt') < btn.indexOf('if(!contract && typeof gen.buildFinal==="function"){'));
  assert.ok(btn.includes("wi = wi.filter(x=> x && x.name).slice(0,8); return wi.length ? { items:wi } : {}; })(),"), "no items, nothing added to the read");
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  assert.ok(sheet.includes("const finalLookItems = ()=> (finalLook ? finalLook.items : []).map(it=>{ const p = wornProps.find(x=>x.id===it.id) || {};"));
  assert.ok(sheet.includes('return { name:it.name, design:[p.form, p.material].map(x=>String(x||"").trim()).filter(Boolean).join("; ").slice(0,300) }; });'));
  const qa = between(ai, "async function aiImageQA(item){", "window.aiImageQA = aiImageQA;");
  assert.ok(qa.includes("+((Array.isArray(item.items) && item.items.length)"));
  assert.ok(qa.includes("WORN ITEMS THIS SHEET MUST SHOW (binding, part of the contract)"));
  assert.ok(qa.includes("is a deviation whose 'what' starts with 'Item:' and names it, with its box."), "a missing item is a boxed drift: Fix these areas can repair it");
  assert.ok(qa.includes("a ring is not seen from behind") && qa.includes("An item too small to judge is not a fault."));
  assert.ok(qa.indexOf("WORN ITEMS THIS SHEET MUST SHOW") < qa.indexOf("SECOND, SEPARATELY: the SCREENPLAY"));
});

await test("4b a card takes its image's record when the record arrives after the image", async () => {
  // found by the first paid check: after a reload the picture came from this device's copy, the record later, and the
  // card kept an image with no record: no kept QA result, no lock, no final-look line, a new report not saved
  const hook = between(art, "/* hydrate from IndexedDB / cloud on mount", "window.addEventListener(\"nb-prefetched\", onPrefetched);");
  assert.ok(art.includes("const genMetaRef = React.useRef(genMeta); genMetaRef.current = genMeta;"));
  assert.ok(hook.includes("if(!alive || !e.detail || !e.detail.ids || e.detail.ids.indexOf(id)<0) return;"));
  assert.ok(hook.includes('if(!genMetaRef.current && typeof nbGetMeta==="function"){ const m = nbGetMeta(id); if(m) setGenMeta(m); }'));
  assert.ok(hook.includes('if(genUrl && !genMetaRef.current && typeof nbGetMeta==="function"){ const m0 = nbGetMeta(id); if(m0) setGenMeta(m0); }'));
  // an image the card already shows is never swapped by a prefetch
  assert.ok(/if\(genUrlRef\.current\)\{[\s\S]{0,200}return;\s*\}/.test(hook));
});

await test("5 Frances knows it, and the page loads the new files", async () => {
  const f = between(ai, "APP_FEATURES.push({ name:\"The final look: a character's sheet with its items on it, checked and locked (Characters, Art Room)\"", "function appBrief(){");
  for (const w of ["step guide then marks 'Final look'", "Lock final look", "Final look locked", "New wardrobe ready", "starts with 'Item:'", "NOTHING IS BLOCKED",
    "their locked sheet is it", "Carried items are not on the sheet"]) assert.ok(f.includes(w), w);
  assert.ok(!/\bTURN\b|McKee|Claude|Anthropic|Gemini|GPT/.test(f));
  for (const file of ["artroom.jsx", "ai.jsx"]) assert.ok(["20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2"].some((k) => html.includes(file + "?v=" + k + '"')), file + " has the new key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

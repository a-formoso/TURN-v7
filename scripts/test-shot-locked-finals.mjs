#!/usr/bin/env node
/* The road, step 7: shots use locked finals (owner 2026-11-20: "yes, start on step 7"; the rule: "allow and mark").

   1 What a reference says: a locked sheet, a locked final look, a locked item; a sheet or item that is not locked;
     a locked sheet that does not wear a new item yet. A lock that belongs to another version is no lock.
   2 The card's one line: only the references the frame will use (ticked, with an image), each once; a cold cache
     claims nothing.
   3 A frame records which of its sheets and item images were locked when it was made; an edit keeps the record.
   4 The card marks and never blocks: a mark on the tile, one line, no question asked before the render.
   5 The Shots tab is told which sheets wait for new wardrobe; Frances knows the rule.

     node scripts/test-shot-locked-finals.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const shots = read("app/shots.jsx"), ui = read("app/shots-ui.jsx"), art = read("app/artroom.jsx"), css = read("app/styles.css"),
  ai = read("app/ai.jsx"), html = read("TURN.html");

const METAS = {};
const sb = { console, JSON, Array, String, Object };
sb.window = sb;
sb.nbGetMeta = (id) => METAS[id] || null;
vm.runInNewContext(between(shots, "function shotRefLockState(kind, meta, o){", "window.shotRefLockState = shotRefLockState;")
  + "\nthis.state=shotRefLockState;this.open=shotUnlockedRefs;this.stamp=shotLockedRefStamp;", sb);
const st = (...a) => plain(sb.state(...a));
const locked = (iso, extra) => ({ iso, lock: { iso, at: 5, ...(extra || {}) } });

await test("1 what a reference says", async () => {
  // nothing is claimed about a sheet that is not loaded, or about a location / seed
  assert.equal(sb.state("character", null, { name: "Eshita" }), null);
  assert.equal(sb.state("character", {}, { name: "Eshita" }), null);
  assert.equal(sb.state("location", locked("a"), {}), null);
  assert.equal(sb.state("seed", locked("a"), {}), null);
  // a character
  let r = st("character", { iso: "s1" }, { name: "Eshita" });
  assert.equal(r.state, "open"); assert.equal(r.mark, true); assert.equal(r.label, "Not locked");
  assert.equal(r.tip, "Eshita’s sheet is not locked yet. Check and lock it in Characters.");
  r = st("character", locked("s1"), { name: "Eshita" });
  assert.equal(r.state, "final"); assert.equal(r.mark, false); assert.equal(r.label, "Locked");
  assert.equal(r.tip, "Eshita’s sheet is locked.");
  r = st("character", locked("s1", { final: true }), { name: "Eshita" });
  assert.equal(r.state, "final"); assert.equal(r.label, "Final look locked"); assert.equal(r.tip, "Eshita’s final look is locked.");
  // a lock made for an earlier version is no lock
  assert.equal(st("character", { iso: "s2", lock: { iso: "s1" } }, { name: "Eshita" }).state, "open");
  assert.equal(st("prop", { iso: "s2", lock: { iso: "s1" } }, { name: "Lanyard" }).state, "open");
  // locked, but a worn item has a new image the sheet does not wear yet
  r = st("character", locked("s1", { final: true }), { name: "Eshita", wardrobeStale: true });
  assert.equal(r.state, "update"); assert.equal(r.mark, true); assert.equal(r.label, "New wardrobe not on the sheet");
  assert.ok(r.tip.includes("Update it in Characters"));
  // not locked and waiting for wardrobe: the plain "not locked" (one thing at a time)
  assert.equal(st("character", { iso: "s1" }, { name: "Eshita", wardrobeStale: true }).state, "open");
  // an item
  r = st("prop", { iso: "p1" }, { name: "Lanyard" });
  assert.equal(r.state, "open"); assert.equal(r.mark, true); assert.equal(r.tip, "Lanyard’s image is not locked yet. Lock it in Props.");
  r = st("prop", locked("p1"), { name: "Lanyard", wardrobeStale: true });
  assert.equal(r.state, "final"); assert.equal(r.mark, false); assert.equal(r.tip, "Lanyard’s image is locked.");
  // no name: still a sentence
  assert.ok(st("character", { iso: "s1" }, {}).tip.startsWith("This character’s sheet"));
  assert.ok(st("prop", { iso: "s1" }).tip.startsWith("This item’s image"));
});

await test("2 the card's one line", async () => {
  const metas = { c1: { iso: "a" }, c2: locked("b", { final: true }), c3: locked("c"), p1: { iso: "d" }, p2: locked("e") };
  const refs = [
    { kind: "seed", refId: "sh0", label: "Previous shot · Beat 1" },
    { kind: "location", refId: "loc1", label: "Kitchen" },
    { kind: "character", refId: "c1", label: "Eshita · Scene 4 look" },
    { kind: "character", refId: "c2", label: "Liaqat" },
    { kind: "character", refId: "c3", label: "Imran" },
    { kind: "character", refId: "c4", label: "Guard", missing: true },      // no sheet: the "Missing" tile says it
    { kind: "character", refId: "c5", label: "Nurse" },                     // meta not loaded: nothing is claimed
    { kind: "prop", refId: "p1", label: "Lanyard" },
    { kind: "prop", refId: "p2", label: "Ring" },
    { kind: "prop", refId: "p1", label: "Lanyard" },                        // carried twice: said once
    { kind: "crowd", refId: "cr1", label: "Commuters" },
  ];
  let r = plain(sb.open(refs, [], { getMeta: (id) => metas[id] || null, wardrobeIds: ["c3"] }));
  assert.deepEqual(r.open.map((x) => x.name + ":" + x.state), ["Eshita:open", "Imran:update", "Lanyard:open"]);
  assert.equal(r.locked, 2); assert.equal(r.known, 5);
  // an unticked reference is not part of the frame: it is not listed
  r = plain(sb.open(refs, ["c1", "p1"], { getMeta: (id) => metas[id] || null, wardrobeIds: [] }));
  assert.deepEqual(r.open, []); assert.equal(r.locked, 3);
  // with no getMeta the saved cache is read
  METAS.c1 = { iso: "a" };
  assert.deepEqual(plain(sb.open([{ kind: "character", refId: "c1", label: "Eshita" }], null, {})).open.map((x) => x.refId), ["c1"]);
  delete METAS.c1;
  assert.deepEqual(plain(sb.open([{ kind: "character", refId: "c1", label: "Eshita" }], null, {})), { open: [], locked: 0, known: 0 });
  assert.deepEqual(plain(sb.open(null, null, null)), { open: [], locked: 0, known: 0 });
});

await test("3 a frame records which of its references were locked", async () => {
  Object.assign(METAS, { c1: locked("a", { final: true }), c2: { iso: "b" }, c3: locked("c"), "c1-v2": { iso: "v" },
    p1: locked("d"), p2: { iso: "e" }, p3: locked("f"), p4: { iso: "g", lock: { iso: "old" } } });
  const plan = {
    castSpec: [{ id: "c1-v2", baseId: "c1" }, { id: "c2", baseId: "c2" }, { id: "c3", baseId: "c3" }],
    propSpec: [{ id: "p1" }, { id: "p2" }, { id: "p4" }],
    carrySpec: [{ id: "p3", baseId: "p3" }, { id: "p1" }],
  };
  // a scene variant counts by its character's sheet; each reference once
  assert.deepEqual(plain(sb.stamp(plan, [])), ["c1@a", "c3@c", "p1@d", "p3@f"]);
  // an unticked reference was not attached: it is not recorded (by the character's id or the variant's)
  assert.deepEqual(plain(sb.stamp(plan, ["c1", "p3"])), ["c3@c", "p1@d"]);
  assert.deepEqual(plain(sb.stamp(plan, ["c1-v2"])), ["c3@c", "p1@d", "p3@f"]);
  assert.deepEqual(plain(sb.stamp(null, null)), []);
  for (const k of Object.keys(METAS)) delete METAS[k];
  // the frame keeps the record, and an edit of the frame keeps what it was made from
  assert.ok(ui.includes('lockedRefs:_keep("lockedRefs", (typeof shotLockedRefStamp==="function" && renderPlan) ? shotLockedRefStamp(renderPlan, sh.refOff) : []),'));
});

await test("4 the card marks, and never blocks", async () => {
  const card = between(ui, "/* THE ROAD, STEP 7: SHOTS USE LOCKED FINALS", "/* THE STEPS, LIKE A LOCATION CARD'S");
  // the line: one, short, with its explanation behind the tooltip
  assert.ok(card.includes('"data-testid":"shot-refs-unlocked"'));
  assert.ok(card.includes('"Not locked yet: "+_unlocked.open.map('));
  assert.ok(card.includes('x.state==="update" ? x.name+" (new wardrobe)" : x.name'));
  assert.ok(card.includes("window.InfoTip && _el(window.InfoTip,{label:\"About locked references\""));
  assert.ok(card.includes("You can make this frame now."), "the tooltip says the frame is allowed");
  // the tile: a lock when locked, a dot when not, and the sentence in its title
  assert.ok(card.includes('_el("span",{className:"shot-ref-lock "+(lockSt.mark?"open":"on"),"data-lock":lockSt.state,"aria-hidden":"true"}'));
  assert.ok(card.includes('+(lockSt ? ". "+lockSt.tip : "")'));
  assert.ok(card.includes("refLockNote,\n    refWarn);"), "the line sits with the reference images");
  // it reads the saved cache first, then what the card loaded for a cold cache
  assert.ok(card.includes("return live || (refLockMetas||{})[String(id)] || null;"));
  assert.ok(ui.includes('window.addEventListener("nb-meta-changed", onChanged);'), "a lock or unlock redraws the card");
  assert.ok(ui.includes("if(alive){ setRefLockMetas(lockMetas); setRefImgs([...seed, ...sheetOrder]); setRefsLoaded(true); }"));
  // never a gate: the mark is not in what stops or asks before a render
  assert.ok(!/_unlocked|refLockNote|shotUnlockedRefs/.test(between(ui, "function shotFrameGenOpts(", "function ShotCard(")), "the render path does not read the mark");
  assert.ok(!/appConfirm[^;]{0,400}(not locked|Not locked)/.test(ui), "no question about locks before a render");
  for (const c of [".shot-ref-lock.on{", ".shot-ref-lock.open{", ".shot-refs-open{", ".shot-refs-open-dot{"]) assert.ok(css.includes(c), c);
  // green is ok / locked, amber is something to do; purple stays the Likeness's
  assert.ok(/\.shot-ref-lock\.on\{[^}]*background:var\(--ok\)/.test(css));
});

await test("5 the Shots tab knows which sheets wait for wardrobe; Frances knows the rule", async () => {
  assert.ok(/function ShotList\(\{[^)]*onMakeSceneNeeds, wardrobeIds, readOnly=false \}\)/.test(ui));
  assert.ok(ui.includes("wardrobeIds:wardrobeIds||[] });"));
  assert.ok(between(art, "React.createElement(window.ShotList,{", "trashItems:(trash&&trash.shots)").includes("wardrobeIds:wardrobeIds||[],"));
  assert.ok(ai.includes('name:"Shots show which of their references are locked (Shots, Art Room)"'));
  const f = between(ai, 'name:"Shots show which of their references are locked (Shots, Art Room)"', " });\n");
  assert.ok(/never blocked/.test(f) && /can always be made/.test(f));
  assert.ok(!/TURN|Claude|Anthropic|McKee/.test(f));
  assert.ok(/shots\.jsx\?v=[\w-]+"/.test(html) && /shots-ui\.jsx\?v=[\w-]+"/.test(html));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

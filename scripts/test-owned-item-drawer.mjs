#!/usr/bin/env node
/* A worn or carried item opens where it is listed (owner 2026-11-18: "Props & Accessories: allow user to click to
   open respective prop/accessory or generate directly on the card without changing tabs (decide for me, make it
   interesting UI)").

   1 Every item in the two lists has a small square in its row: its image, or a dashed square that offers one.
   2 A press opens the item in a popup (owner, the same day: "turn this into a popup"): its image, three steps, the
     next step's button.
   N One name in both places (owner: "if prop name gets shortened that this is updated both on the character sheet and
     the props tab"): the popup's name can be changed or shortened; the list and the Props card follow each other.
   3 Nothing is spent on opening; each paid step is its own press; a card made here is a prop the person kept.
   4 Someone who may not edit sees the images, no buttons.
   5 The rows under the lists keep only leftover cards; the list component takes a lead of its own.
   6 Phones: one column (the rule now wins); the popup in one column.

     node scripts/test-owned-item-drawer.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };

const art = read("app/artroom.jsx"), insp = read("app/inspector.jsx"), app = read("app/app.jsx"), css = read("app/styles.css");
const ai = read("app/ai.jsx"), html = read("TURN.html"), ps = read("app/prop-screenplay.js");

/* a tree the tests can read: {type, props, children} */
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false && x !== "") });
const walk = (n, f) => { if (!n || typeof n !== "object") return; f(n); (n.children || []).forEach(c => walk(c, f)); };
const findAll = (tree, pred) => { const out = []; walk(tree, n => { if (pred(n)) out.push(n); }); return out; };
const cls = (c) => (n) => String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const role = (r) => (n) => n.props && n.props["data-role"] === r;
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));   // values made inside the vm, compared out here
globalThis.__plain = plain;
function InfoTip() { return null; }
const text = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (n && n.children ? n.children.map(text).join("") : "");

/* THE CARD'S OWN CODE, run for real: the block of CharacterSheet that makes the square and the drawer, with the
   card's surroundings handed in */
const chunk = between(art, "  const [openItem, setOpenItem] = React.useState(null);", "  React.useEffect(()=>{\n    let alive=true;")
  .replace("const [openItem, setOpenItem] = React.useState(null);", "const openItem = env.openItem, setOpenItem = env.setOpenItem;");
const NAMES = ["ownedProps", "React", "ReactDOM", "document", "EditText", "onNameOwnedItem", "rowKeyTick", "setRowKeyTick", "Icon", "window", "linkInfo", "normName", "ownedSheetMap", "readOnly", "propBusy", "setPropBusy", "wornExclusions", "c", "gen",
  "onCreateOwnedProp", "onDraftProp", "onView", "project", "setSheetTick", "setWornReferenceIncluded", "castFirstName", "propVisualsDrafted", "nbGetMeta", "sheetLockOf", "turnLockedAsk"];
assert.ok(chunk.includes("React.useEffect(()=>{ if(!openItem) return undefined;"), "Esc closes the popup");
const specSrc = between(art, "function specWholeSentences(t){", "window.specWholeSentences = specWholeSentences;");
const factory = vm.runInNewContext(specSrc + "\n(function(env){ const {" + NAMES.join(",") + "} = env;\n" + chunk + "\nreturn { ownedItemRow, ownedItemTile, ownedItemPanel, specWholeSentences, specWasCut }; })", { console, Promise, String, Set, Math });
function EditText() { return null; }
/* the real rule for a name the drafter refuses (prop-screenplay.js) */
const psBox = { console, Set, Array, String, Object, Math, JSON }; psBox.window = psBox; vm.runInNewContext(ps, psBox);
const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(?:and-|then-)/, "").slice(0, 40);
const ITEMS = [["worn", "green PCO licence badge on a lanyard"], ["worn", "black leather belt"], ["carried", "Nasir's notebook"]];
function card(over) {
  const log = [];
  const o = Object.assign({ props: {}, sheets: {}, excluded: [], readOnly: false, busy: null, open: null, sheet: "data:char" }, over || {});
  const env = {
    ownedProps: o.liveProps || Object.keys(o.props).map(k => o.props[k]),
    React: { createElement: el, useEffect: () => {} }, ReactDOM: { createPortal: (node, where) => { log.push(["portal", where]); return node; } }, document: { body: "BODY" },
    EditText, rowKeyTick: 0, setRowKeyTick: () => log.push(["reset-name"]),
    onNameOwnedItem: o.noNaming ? null : (cid, item, pid, to, opts) => { log.push(["name", cid, item, pid, to, opts || null]); return o.nameFails ? "" : to; },
    Icon: { plus: "ic-plus", box: "ic-box", x: "ic-x", check: "ic-check", sparkles: "ic-sparkles" },
    window: { PropScreenplay: psBox.PropScreenplay, appToast: (m, k) => log.push(["toast", k || "info", m]), InfoTip, nbCostChip: (n) => el("span", { className: "nb-cost" }, String(n)),
      generatePropSheet: async (p, project, opts) => { log.push(["generate", p.id, project && project.id]); if (opts) log.push(["generate-opts", opts]); return true; },
      ...(o.anchor ? { propAnchorState: (p, pm, om) => { log.push(["anchor", p.id, pm, om]); return o.anchor; } } : {}),
      propShortName: (n) => { if (o.shortRule) return o.shortRule; const m = String(n || "").match(/^(.*?)\s*\(/); return (m && String(n).length > 40) ? m[1] : ""; } },
    linkInfo: { rows: ITEMS.map(([src, t], i) => ({ key: "b-" + i, name: t, item: t, prop: o.props[t] || null, orphan: false, src }))
      .concat([{ key: "o-x", name: "Aud", prop: { id: "p-old", name: "Aud", kind: "worn" }, orphan: true }]) },
    // the lock (the road, step 4) and the image details the popup reads
    nbGetMeta: (id) => (o.metas || {})[id] || null, sheetLockOf: (m) => (m && m.lock) || null,
    turnLockedAsk: async (m, name, noun, what) => { log.push(["ask-lock", name, noun, what]); return o.lockYes !== false; },
    normName, ownedSheetMap: o.sheets, readOnly: o.readOnly, propBusy: o.busy, setPropBusy: (v) => log.push(["busy", v && v.kind, v && v.key]),
    wornExclusions: new Set(o.excluded), c: { id: "liaqat", name: "LIAQAT HUSSAIN" }, gen: { genUrl: o.sheet },
    onCreateOwnedProp: (cid, item, src, opts) => { log.push(["create", cid, item, src, opts]); return { id: "p-new", name: item, kind: src }; },
    onDraftProp: async (p) => { log.push(["draft", p.id]); return o.draftResult; }, onView: (url, p) => log.push(["view", url, p.id]), project: { id: "film" },
    setSheetTick: () => log.push(["tick"]), setWornReferenceIncluded: (id, on) => log.push(["lock", id, on]),
    castFirstName: (n) => { const f = String(n || "").trim().split(/\s+/)[0] || ""; return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase(); },
    propVisualsDrafted: (p) => !!(p.form && p.material), openItem: o.open, setOpenItem: (v) => log.push(["open", v]),
  };
  return Object.assign(factory(env), { log });
}
const BADGE = ITEMS[0][1], BELT = ITEMS[1][1], BOOK = ITEMS[2][1];
const open = (src, t) => ({ src, n: normName(t) });

await test("1 every item has its own square: a dashed plus with no image, the picture with one; a press opens it, a second press closes it", () => {
  const a = card({ props: { [BADGE]: { id: "p1", name: BADGE, kind: "worn" } }, sheets: { p1: "data:badge" } });
  const plain_ = globalThis.__plain, plain = a.ownedItemTile("worn")(BELT), pic = a.ownedItemTile("worn")(BADGE);
  assert.equal(plain.type, "button"); assert.equal(plain.props["data-role"], "owned-item-tile"); assert.equal(plain.props.className, "own-tile");
  assert.equal(plain.props.title, "Make an image of black leather belt"); assert.equal(plain.props["aria-expanded"], "false");
  assert.equal(plain.children[0].type, "ic-plus");
  assert.equal(pic.props.className, "own-tile has"); assert.equal(pic.props.title, "Open " + BADGE); assert.equal(pic.children[0].props.src, "data:badge");
  plain.props.onClick(); assert.deepEqual(plain_(a.log.pop()), ["open", open("worn", BELT)]);
  const b = card({ open: open("worn", BELT) });
  const on = b.ownedItemTile("worn")(BELT); assert.equal(on.props.className, "own-tile on"); assert.equal(on.props["aria-expanded"], "true");
  on.props.onClick(); assert.deepEqual(plain_(b.log.pop()), ["open", null]);
  // the same words in the other list are another item; words that are no item (still being typed) keep the plain dot
  assert.equal(a.ownedItemTile("carried")(BELT), null); assert.equal(a.ownedItemTile("worn")("a new thing"), null);
  assert.equal(a.ownedItemTile("worn")("Aud"), null, "a leftover card is not an item of the lists");
  assert.equal(card({ busy: { key: "worn:" + normName(BELT), kind: "draft" } }).ownedItemTile("worn")(BELT).children[0].props.className, "ns-spin");
});

await test("2a an item with nothing yet: three steps, none done, and one button that writes its design (and makes its card) — no image is made", async () => {
  assert.equal(card().ownedItemPanel(), null, "closed until a square is pressed");
  assert.equal(card({ open: open("worn", "gone") }).ownedItemPanel(), null, "the item was renamed or removed: the popup closes");
  const a = card({ open: open("worn", BELT) }), over = a.ownedItemPanel(), p = findAll(over, cls("own-pop"))[0];
  // a popup over the page: mounted on the body, a dialog, closed by the ×, a press outside it or Esc
  assert.deepEqual(plain(a.log), [["portal", "BODY"]]); a.log.length = 0;
  assert.equal(over.props.className, "ns-overlay own-overlay"); assert.equal(p.props.role, "dialog"); assert.equal(p.props["aria-modal"], "true");
  assert.equal(p.props["data-testid"], "owned-item-panel"); assert.equal(p.props["data-src"], "worn"); assert.equal(p.props["aria-label"], BELT);
  over.props.onMouseDown({ target: 1, currentTarget: 2 }); assert.deepEqual(a.log, [], "a press inside the popup keeps it open");
  over.props.onMouseDown({ target: over, currentTarget: over }); assert.deepEqual(plain(a.log.pop()), ["open", null]);
  findAll(p, cls("own-x"))[0].props.onClick(); assert.deepEqual(plain(a.log.pop()), ["open", null]);
  const nameField = findAll(p, cls("own-name"))[0];
  assert.equal(nameField.type, EditText); assert.equal(nameField.props.value, BELT); assert.equal(text(findAll(p, cls("own-kind"))[0]), "Worn");
  const steps = findAll(p, cls("own-step"));
  assert.deepEqual(steps.map(s => text(findAll(s, cls("own-step-lab"))[0])), ["Design", "Image", "On Liaqat’s sheet"]);
  assert.deepEqual(steps.map(s => s.props.className), ["own-step now", "own-step", "own-step"]);
  assert.equal(findAll(p, role("owned-item-generate")).length, 0); assert.equal(findAll(p, cls("own-lock")).length, 0);
  const btn = findAll(p, role("owned-item-design"))[0];
  assert.equal(text(btn), "Write its design"); assert.equal(findAll(btn, cls("nb-cost")).length, 0, "writing: no image price on it");
  assert.match(btn.props.title, /Writing credits only\.$/);
  await btn.props.onClick();
  assert.deepEqual(plain(a.log), [["create", "liaqat", BELT, "worn", { kept: true }], ["busy", "draft", "worn:" + normName(BELT)], ["draft", "p-new"], ["busy", null, null]]);
  // an item whose card exists already is drafted on that card: no second card
  const b = card({ open: open("carried", BOOK), props: { [BOOK]: { id: "p2", name: BOOK, kind: "carried" } } });
  await findAll(b.ownedItemPanel(), role("owned-item-design"))[0].props.onClick();
  assert.deepEqual(b.log.map(x => x[0]), ["portal", "busy", "draft", "busy"]); assert.deepEqual(b.log[2], ["draft", "p2"]);
});

await test("2b designed, no image: 'Generate image' with its price; it needs the character's sheet first; one press, one image", async () => {
  const pr = { id: "p2", name: BOOK, kind: "carried", form: "A6 notebook", material: "black card cover" };
  const a = card({ open: open("carried", BOOK), props: { [BOOK]: pr } }), p = a.ownedItemPanel();
  assert.deepEqual(findAll(p, cls("own-step")).map(s => s.props.className), ["own-step done", "own-step now", "own-step"]);
  assert.equal(text(findAll(p, cls("own-step-lab"))[2]), "In the shots", "a carried item joins the shots, not the sheet");
  assert.deepEqual(findAll(p, cls("own-spec"))[0].children.map(text), ["A6 notebook", "black card cover"], "what was written is shown, in full");
  const btn = findAll(p, role("owned-item-generate"))[0];
  assert.equal(btn.props.className, "own-act main"); assert.equal(btn.props.disabled, false);
  assert.equal(btn.children.filter(x => typeof x === "string").join(""), "Generate image"); assert.equal(findAll(btn, cls("nb-cost")).length, 1);
  await btn.props.onClick();
  assert.deepEqual(a.log.filter(x => x[0] === "generate"), [["generate", "p2", "film"]]);
  assert.deepEqual(a.log.map(x => x[0]), ["portal", "busy", "generate", "generate-opts", "toast", "busy", "tick"]); assert.equal(a.log[4][1], "success");
  assert.deepEqual(plain(a.log[3][1]), { lockOk: true }, "the popup has done the asking");
  assert.ok(!a.log.some(x => x[0] === "create" || x[0] === "draft"), "nothing else is paid for");
  // no character sheet yet: the button waits and a line says why
  const b = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheet: "" }), q = b.ownedItemPanel();
  assert.equal(findAll(q, role("owned-item-generate"))[0].props.disabled, true);
  assert.equal(text(findAll(q, cls("own-note"))[0]), "Generate Liaqat’s sheet first.");
  // while one item is being made, no second run starts
  const busy = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, busy: { key: "worn:x", kind: "gen" } });
  const bb = findAll(busy.ownedItemPanel(), role("owned-item-generate"))[0]; assert.equal(bb.props.disabled, true);
  await bb.props.onClick(); assert.deepEqual(busy.log.map(x => x[0]), ["portal"]);
});

await test("2c with its image: see it larger, make it again, and for a worn item the Visual lock decides step three", () => {
  const pr = { id: "p1", name: BADGE, kind: "worn", form: "laminated card", material: "PVC" };
  const a = card({ open: open("worn", BADGE), props: { [BADGE]: pr }, sheets: { p1: "data:badge" } }), p = a.ownedItemPanel();
  assert.deepEqual(findAll(p, cls("own-step")).map(s => s.props.className), ["own-step done", "own-step done", "own-step done"]);
  const shot = findAll(p, cls("own-shot"))[0]; assert.equal(shot.type, "button"); shot.props.onClick();
  assert.deepEqual(a.log.pop(), ["view", "data:badge", "p1"]);
  const btn = findAll(p, role("owned-item-generate"))[0];
  assert.equal(btn.props.className, "own-act", "making it again is the quiet button"); assert.equal(btn.children.filter(x => typeof x === "string").join(""), "Generate new image");
  const lock = findAll(p, n => n.type === "input")[0]; assert.equal(lock.props.checked, true);
  lock.props.onChange({ target: { checked: false } }); assert.deepEqual(a.log.pop(), ["lock", "p1", false]);
  const off = card({ open: open("worn", BADGE), props: { [BADGE]: pr }, sheets: { p1: "data:badge" }, excluded: ["p1"] }).ownedItemPanel();
  assert.deepEqual(findAll(off, cls("own-step")).map(s => s.props.className), ["own-step done", "own-step done", "own-step now"], "kept as words: step three is open");
  assert.equal(findAll(off, n => n.type === "input")[0].props.checked, false);
  // a carried item has no lock: it joins the shots as soon as it has an image
  const bk = { id: "p2", name: BOOK, kind: "carried", form: "f", material: "m" };
  const c2 = card({ open: open("carried", BOOK), props: { [BOOK]: bk }, sheets: { p2: "data:book" } }).ownedItemPanel();
  assert.equal(findAll(c2, n => n.type === "input").length, 0);
  assert.deepEqual(findAll(c2, cls("own-step")).map(s => s.props.className), ["own-step done", "own-step done", "own-step done"]);
  const tips = [p, c2].map(t => findAll(t, n => n.type === InfoTip)[0].props.text);
  assert.match(tips[0], /^Worn items are part of Liaqat’s look\./); assert.match(tips[1], /^Carried items are not drawn on Liaqat’s sheet\./);
});

await test("4 someone who may not edit: the image opens, no button spends or changes anything; an item with no image has no square", () => {
  const pr = { id: "p1", name: BADGE, kind: "worn", form: "f", material: "m" };
  const a = card({ readOnly: true, open: open("worn", BADGE), props: { [BADGE]: pr }, sheets: { p1: "data:badge" } });
  assert.equal(a.ownedItemTile("worn")(BELT), null); assert.equal(a.ownedItemTile("worn")(BADGE).props.className, "own-tile has on");
  const p = a.ownedItemPanel();
  assert.equal(findAll(p, cls("own-actions")).length, 0); assert.equal(findAll(p, n => n.type === "input").length, 0);
  assert.equal(findAll(p, cls("own-shot"))[0].type, "button");
});

await test("3 a card made from the character card is the person's own choice: a kept prop, never made on a film they may not change", () => {
  const fn = between(app, "  const createOwnedProp = (charId, itemText, sourceKind, opts)=>{", "  const addLookbookCard");
  const box = { window: {}, console, Date, String, Object };
  vm.runInNewContext(ps, box.window = Object.assign(box, { window: box }));
  let props = [], may = true;
  const make = vm.runInNewContext("(function(env){ const {characters,setProps,canMutateSharedFilm,window,classifyPropKind,artRoomPropOrigin} = env;\n" + fn + "\nreturn createOwnedProp; })", { Date, String, Object })({
    characters: [{ id: "liaqat", name: "LIAQAT" }], setProps: (f) => { props = f(props); }, canMutateSharedFilm: () => may, window: box,
    classifyPropKind: () => "", artRoomPropOrigin: (kind) => ({ kind: kind === "worn" ? "costume" : "props" }) });
  const kept = make("liaqat", "green PCO licence badge", "worn", { kept: true });
  assert.equal(kept.keptAsProp, true); assert.equal(kept.ownerId, "liaqat"); assert.equal(kept.kind, "worn"); assert.equal(kept.name, "green PCO licence badge");
  assert.equal(box.PropScreenplay.isStoryProp(kept), true, "it stands with the story props, as 'Keep this prop' does");
  const bare = make("liaqat", "the key", "carried");
  assert.equal(bare.keptAsProp, undefined); assert.equal(box.PropScreenplay.isStoryProp(bare), false, "only the person's own press keeps a card");
  assert.equal(props.length, 2);
  may = false; assert.equal(make("liaqat", "a watch", "worn", { kept: true }), null); assert.equal(props.length, 2);
  assert.equal(make("nobody", "a watch", "worn"), null); assert.equal(make("liaqat", "  ", "worn"), null);
});

await test("2d the road, step 5: the popup says how the image stands against the sheet; a locked image asks before it is made again", async () => {
  const pr = { id: "p2", name: BOOK, kind: "carried", form: "A6 notebook", material: "black card cover" };
  const mark = { state: "none", mark: true, who: "Liaqat", label: "Made without Liaqat\u2019s sheet", tip: "why" };
  const a = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheets: { p2: "data:book" }, metas: { p2: { iso: "a" } }, anchor: mark }), p = a.ownedItemPanel();
  const note = findAll(p, role("owned-item-anchor"))[0];
  assert.equal(note.props["data-state"], "none"); assert.ok(text(note).includes("Made without Liaqat\u2019s sheet"));
  assert.equal(findAll(note, cls("prop-status-pill"))[0].props.className, "prop-status-pill unverified");
  assert.deepEqual(plain(a.log.find(x => x[0] === "anchor")), ["anchor", "p2", { iso: "a" }, null], "the item's image details, and the sheet's (none recorded here)");
  const btn = findAll(p, role("owned-item-generate"))[0];
  assert.equal(btn.props.className, "own-act main", "the way out is the main button"); assert.equal(btn.children.filter(x => typeof x === "string").join(""), "Make it again");
  // a fine one is said quietly, and the button stays the second one
  const ok = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheets: { p2: "data:book" }, anchor: { state: "locked", mark: false, label: "From Liaqat\u2019s locked sheet", tip: "t" } }).ownedItemPanel();
  assert.equal(findAll(ok, cls("prop-status-pill"))[0].props.className, "prop-status-pill ok");
  assert.equal(findAll(ok, role("owned-item-generate"))[0].props.className, "own-act");
  assert.equal(findAll(ok, role("owned-item-generate"))[0].children.filter(x => typeof x === "string").join(""), "Generate new image");
  // no image yet: nothing to say
  assert.equal(findAll(card({ open: open("carried", BOOK), props: { [BOOK]: pr }, anchor: mark }).ownedItemPanel(), role("owned-item-anchor")).length, 0);
  // a locked image: asked first; "Keep it locked" makes nothing
  const no = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheets: { p2: "data:book" }, metas: { p2: { iso: "a", lock: { iso: "a" } } }, lockYes: false });
  await findAll(no.ownedItemPanel(), role("owned-item-generate"))[0].props.onClick();
  assert.deepEqual(no.log.filter(x => x[0] !== "portal"), [["ask-lock", BOOK, "image", "make a new one"]]);
  const yes = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheets: { p2: "data:book" }, metas: { p2: { iso: "a", lock: { iso: "a" } } } });
  await findAll(yes.ownedItemPanel(), role("owned-item-generate"))[0].props.onClick();
  assert.deepEqual(yes.log.map(x => x[0]), ["portal", "ask-lock", "busy", "generate", "generate-opts", "toast", "busy", "tick"]);
});

await test("5 the list takes a lead of its own in place of the dot; the rows under the lists keep only leftover cards", () => {
  const src = between(insp, "function splitListItems(value){", "/* the −/+ charge stepper.");
  const R = { createElement: el, useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {} };
  const box = { React: R, Icon: { x: "ic-x", plus: "ic-plus" }, EditText: "EditText", window: {}, String, Array };
  vm.runInNewContext(src.replace(/window\.joinListItems = joinListItems;/, "") + "\nthis.EditableItemList = EditableItemList;", box);
  const seen = [];
  const withLead = box.EditableItemList({ value: "gold ring; flat cap; none yet", onCommit() {}, renderLead: (t, i) => { seen.push([t, i]); return t === "flat cap" ? null : el("button", { className: "own-tile" }); } });
  assert.deepEqual(seen, [["gold ring", 0], ["flat cap", 1], ["none yet", 2]]);
  const rows = findAll(withLead, cls("eil-row"));
  assert.deepEqual(rows.map(r => r.children[0].props.className), ["own-tile", "eil-dot", "own-tile"], "no lead of its own: the dot stays");
  assert.equal(findAll(box.EditableItemList({ value: "a, b", onCommit() {} }), cls("eil-dot")).length, 2, "every other list is as it was");
  assert.ok(art.includes("function SheetField({ label, value, placeholder, multiline, list, onCommit, onItemRemoved, onItemRenamed, ownerName, itemLead }){")
    && art.includes("ownerName,renderLead:itemLead})"));
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  assert.ok(sheet.includes('list:true,ownerName:c.name,itemLead:ownedItemTile("worn"),') && sheet.includes('list:true,ownerName:c.name,itemLead:ownedItemTile("carried"),'));
  assert.ok(/onCommit:val=>onUpdate\(c\.id,\{props:val\}\)\}\)\),\n\s*ownedItemPanel\(\),   \/\/ the open item's popup/.test(sheet), "the popup is asked for once, after the lists");
  assert.ok(sheet.includes("const extraRows = linkedRows.filter(r=>r.orphan);") && sheet.includes("extraRows.length>0 && React.createElement(\"div\",{className:\"linked-props\"},")
    && sheet.includes("extraRows.map(row=>{"));
  assert.ok(!sheet.includes("linked-prop-gen") && !sheet.includes('"Draft specification"') && !sheet.includes('"Create card"'), "the row buttons moved into the popup");
  assert.equal(sheet.split("window.generatePropSheet(pr, project, { lockOk:true })").length - 1, 1, "one place makes an item's image");
  assert.equal(sheet.split("window.generatePropSheet(").length - 1, 1);
});

await test("T the design text is whole (owner 2026-11-18: 'Lanyard / Prop text appears incomplete'): the drafter knows its lengths and is cut at a sentence; older cut text is shown to its last sentence and can be written again", async () => {
  // the drafter: told the lengths, cut at a sentence end (it used to cut at 200 characters, mid-phrase, with "…")
  const box = { console, String, Array, Math, Object, window: null }; box.window = box; box.scrubBrand = (t) => t;
  vm.runInNewContext(between(ai, "function clipWords(s, max){", "function clipSpecText(") + "\n" + between(ai, "function clipToSentence(s, max){", "window.clipToSentence = clipToSentence;")
    + "\n" + between(ai, "const PROP_FIELD_LIMITS = ", "\nasync function aiExtractScreenplayProps(") + "\nthis.mapPropEntry = mapPropEntry; this.LIM = PROP_FIELD_LIMITS;", box);
  assert.deepEqual(plain(box.LIM), { form: 420, material: 360, detail: 300, size: 240, style: 160 });
  // (2026-11-20) a size made of two parts keeps both: the holder's height was lost at 110 characters, so one sheet drew it tall and the next wide
  const SIZE = "Strap ~90 cm total loop length (~45 cm drop when hung) \u00d7 ~2 cm wide \u00d7 ~1.5 mm thick. Card holder ~11 cm wide \u00d7 ~7 cm tall \u00d7 ~4 mm thick.";
  assert.equal(box.mapPropEntry({ size: SIZE }).size, SIZE);
  const P2 = between(ai, "async function aiDesignPropBible(props, characters, project){", "window.aiDesignPropBible = aiDesignPropBible;");
  assert.ok(P2.includes("For an object made of parts (a lanyard and its card holder, a key on its fob), give each part's measurements."));
  assert.ok(P2.includes("give BOTH sides, so it is clear which is longer"));
  assert.ok(P2.includes("WAS CUT OFF MID-SENTENCE by an older version of the app: it is unfinished, not a decision."), "old cut text is finished, not preserved");
  // a size the card has is kept, unless it was cut: then the drafter's whole size replaces it
  assert.ok(P2.includes('const sizeWasCut = !!(original && /\\u2026\\s*$/.test(String(original.size||"")));'));
  assert.ok(P2.includes('if(original&&original.size&&!(sizeWasCut&&mapped.size)){mapped.size=original.size;mapped.sizeBasis=original.sizeBasis||"estimated";}'));
  const LANYARD = "A flat navy woven polyester neck lanyard about 2 cm wide, sewn into a closed loop. At the bottom is a black plastic swivel clip and a small metal split ring holding a clear, slightly yellowed rigid plastic ID card holder with a printed staff card inside.";
  assert.equal(box.mapPropEntry({ form: LANYARD }).form, LANYARD, "the lanyard's whole form is kept (it was cut at 'slightly yellowed rigid…')");
  const long = box.mapPropEntry({ form: LANYARD + " " + "The holder is scuffed at its corners from years of daily use. ".repeat(6) }).form;
  assert.ok(long.length <= 420 && /\.$/.test(long) && !long.includes("\u2026"), "a longer answer ends on a full sentence");
  const prompt = between(ai, "async function aiDesignPropBible(props, characters, project){", "window.aiDesignPropBible = aiDesignPropBible;");
  assert.ok(prompt.includes('"LENGTHS (longer text is cut, so finish every sentence inside them): form up to "+PROP_FIELD_LIMITS.form+" characters, material up to "'));
  assert.ok(prompt.includes("for an ID badge or card: the holder, the card and its photo"));
  // what a card saved before today shows: up to its last whole sentence; the saved words are not changed
  const f = card();
  const CUT = "A flat navy woven polyester neck lanyard about 2 cm wide, sewn into a closed loop. At the bottom is a black plastic swivel clip and a small metal split ring holding a clear, slightly yellowed rigid\u2026";
  assert.equal(f.specWholeSentences(CUT), "A flat navy woven polyester neck lanyard about 2 cm wide, sewn into a closed loop.");
  assert.equal(f.specWholeSentences("A gold ring."), "A gold ring."); assert.equal(f.specWholeSentences("one long clause with no full stop\u2026"), "one long clause with no full stop\u2026");
  assert.equal(f.specWasCut({ form: CUT, material: "Gold." }), true); assert.equal(f.specWasCut({ form: "A ring.", material: "Gold.", detail: "" }), false); assert.equal(f.specWasCut(null), false);
  // in the popup: shown whole, and one quiet button writes it again in full (writing credits, the person's own press)
  const pr = { id: "p2", name: BOOK, kind: "carried", form: CUT, material: "Matte navy webbing." };
  const a = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheets: { p2: "data:x" } }), p = a.ownedItemPanel(); a.log.length = 0;
  assert.deepEqual(findAll(p, cls("own-spec"))[0].children.map(text), ["A flat navy woven polyester neck lanyard about 2 cm wide, sewn into a closed loop.", "Matte navy webbing."]);
  const again = findAll(p, role("owned-item-redesign"))[0];
  assert.equal(again.children.filter(x => typeof x === "string").join(""), "Write its design again"); assert.match(again.props.title, /^The saved design was cut short\./);
  await again.props.onClick();
  assert.deepEqual(a.log.map(x => x[0]), ["busy", "draft", "busy"], "the same card is drafted again: no new card, no image");
  const whole = card({ open: open("carried", BOOK), props: { [BOOK]: { ...pr, form: "A notebook." } }, sheets: { p2: "data:x" } }).ownedItemPanel();
  assert.equal(findAll(whole, role("owned-item-redesign")).length, 0, "a whole design is not offered again here");
  assert.ok(!/\.own-spec\{[^}]*(max-height|line-clamp)/.test(css), "nothing hides the end of the text");
});

await test("D no description yet (owner 2026-11-18: 'no description of the prop?'): the popup says so and where one comes from; a name an older limit cut is said; a list is never cut through an item again", () => {
  const a = card({ open: open("worn", BELT) }), p = a.ownedItemPanel();
  const none = findAll(p, role("owned-item-nodesc"))[0];
  assert.equal(text(none), "No description yet. \u201cWrite its design\u201d adds one from the script: what it looks like and what it is made of.");
  assert.equal(findAll(p, role("owned-item-cutname")).length, 0);
  assert.equal(text(findAll(card({ readOnly: true, open: open("worn", BADGE), props: { [BADGE]: { id: "p1", name: BADGE, kind: "worn" } }, sheets: { p1: "data:x" } }).ownedItemPanel(), role("owned-item-nodesc"))[0]), "No description yet.");
  const done = card({ open: open("carried", BOOK), props: { [BOOK]: { id: "p2", name: BOOK, kind: "carried", form: "A notebook.", material: "Card." } } }).ownedItemPanel();
  assert.equal(findAll(done, role("owned-item-nodesc")).length, 0, "a designed item shows its design instead");
  // the cause: the worn list was cut at 160 characters, through its last item. Lists are cut by whole items now.
  const box = { console, String, Array, Math, window: null }; box.window = box;
  vm.runInNewContext(between(insp, "function splitListItems(value){", "window.joinListItems = joinListItems;") + "\n" + between(ai, "function clipWords(s, max){", "function clipSpecText(")
    + "\n" + between(ai, "const CHAR_LIST_LIMITS = ", "window.clipListItems = clipListItems;") + "\nthis.clipListItems = clipListItems; this.LIM = CHAR_LIST_LIMITS;", box);
  assert.deepEqual(plain(box.LIM), { accessories: 420, props: 420 });
  const ESHITA = "engagement ring (slim gold band with a small solitaire, left ring finger, removed in Sc 28); work lanyard (navy, plastic ID card holder); tiny gold studs in both ears";
  assert.equal(box.clipListItems(ESHITA, 420), ESHITA, "Eshita's whole list fits now (it was cut at 'tiny gold stud…')");
  assert.equal(box.clipListItems(ESHITA, 150), "engagement ring (slim gold band with a small solitaire, left ring finger, removed in Sc 28); work lanyard (navy, plastic ID card holder)", "no room: the last item is dropped whole, never cut");
  assert.ok(!box.clipListItems(ESHITA, 100).includes("\u2026") || box.clipListItems(ESHITA, 100).split(";").length === 1);
  assert.equal(box.clipListItems("ring, watch", 420), "ring, watch"); assert.equal(box.clipListItems("", 420), "");
  const split = between(ai, "function _wornCarriedSplit(e, character, clean){", "function mapBibleEntry(");
  assert.ok(split.includes("accessories: hasAcc ? character.accessories : clipListItems(clean(r.acc,4000), CHAR_LIST_LIMITS.accessories),") && !split.includes("clean(r.acc,160)"));
  // the drafter is told its room (the prompt works on its own too: other tests load it without the constant)
  const bb = { console, String, Array }; bb.window = bb;
  vm.runInNewContext(between(ai, "function bibleBatchPrompt(ctx, chars){", "\n/* batched VISUAL BIBLE") + "\nthis.out = bibleBatchPrompt('CTX', []);", Object.assign(bb, { _lookbookBlock: () => "" }));
  assert.match(bb.out, /Each of the two lists: items separated by ';', each a short name with its key detail in brackets, and no more than 420 characters for the whole list \(items that do not fit are dropped, so put the ones that matter first\)\./);
});

await test("W 'Write its design' never ends in silence (owner 2026-11-18: it 'wasn't working or doing anything' on \u201ctiny gold stud\u2026\u201d)", async () => {
  // the drafter refuses a name that is not a whole object name; the press used to make an empty card and say nothing
  const STUD = "tiny gold stud\u2026";
  const items = (name, prop) => { ITEMS.push(["worn", name]); const c = card({ open: open("worn", name), props: prop ? { [name]: prop } : {} }); ITEMS.pop(); return c; };
  assert.ok(psBox.PropScreenplay.nameIssue(STUD) && psBox.PropScreenplay.nameIssue("gold") && !psBox.PropScreenplay.nameIssue("tiny gold stud earrings"));
  const a = items(STUD), p = a.ownedItemPanel(); a.log.length = 0;
  const btn = findAll(p, role("owned-item-design"))[0];
  assert.equal(btn.props.disabled, true, "the button waits for a whole name");
  const HELP = "This name was cut short. Type it in full at the top, then write its design.";
  assert.equal(btn.props.title, HELP); assert.equal(text(findAll(p, role("owned-item-namehelp"))[0]), HELP, "said beside the button");
  await btn.props.onClick();
  assert.deepEqual(plain(a.log), [["toast", "info", HELP]], "no card is made and nothing is sent");
  // a card already made by that silent press: the same line, by the card's name
  const b = items(STUD, { id: "p5", name: STUD, kind: "worn", keptAsProp: true }), pb = b.ownedItemPanel();
  assert.equal(findAll(pb, role("owned-item-design"))[0].props.disabled, true); assert.equal(text(findAll(pb, role("owned-item-namehelp"))[0]), HELP);
  // a bare word
  const w = items("gold"); assert.equal(text(findAll(w.ownedItemPanel(), role("owned-item-namehelp"))[0]), "Say what the object is in its name at the top, then write its design.");
  // a whole name: the button works, no line
  const ok = items("tiny gold stud earrings"), pok = ok.ownedItemPanel(); ok.log.length = 0;
  assert.equal(findAll(pok, role("owned-item-namehelp")).length, 0); assert.equal(findAll(pok, role("owned-item-design"))[0].props.disabled, false);
  // a design that does not come back says so (true = written, false = nothing came back)
  ITEMS.push(["worn", "tiny gold stud earrings"]);
  const f = card({ open: open("worn", "tiny gold stud earrings"), draftResult: false }); const pf = f.ownedItemPanel(); f.log.length = 0;
  await findAll(pf, role("owned-item-design"))[0].props.onClick();
  assert.deepEqual(f.log.map(x => x[0]), ["create", "busy", "draft", "busy", "toast"]); assert.deepEqual(plain(f.log[4]), ["toast", "error", "The design could not be written this time. Nothing was changed; try again."]);
  const g = card({ open: open("worn", "tiny gold stud earrings"), draftResult: true }); const pg = g.ownedItemPanel(); g.log.length = 0;
  await findAll(pg, role("owned-item-design"))[0].props.onClick();
  ITEMS.pop();
  assert.ok(!g.log.some(x => x[0] === "toast"), "a design that was written needs no message: it appears");
  const d = between(app, "  const draftPropVisuals = async (pr)=>{", "  // \"Draft all props\"");
  assert.ok(d.includes("let wrote = false;") && d.includes("if(res){ updateProp(pr.id, keepPickedStyle(pr, res)); wrote = true; }") && d.includes("return wrote;"));
});

await test("L the popup shows the card as it is now (owner 2026-11-18: 'spins but doesn't seem to be doing anything — it doesn't create any description and doesn't move to step 2')", () => {
  // the design had been written; the popup kept the card it was first shown, from before the design landed
  const before = { id: "p9", name: BELT, kind: "worn", keptAsProp: true };
  const after = { ...before, form: "A plain black leather belt, 3 cm wide.", material: "Full-grain leather, brushed steel buckle." };
  const stale = card({ open: open("worn", BELT), props: { [BELT]: before }, liveProps: [after] });   // the rows still hold `before`
  const p = stale.ownedItemPanel();
  assert.deepEqual(findAll(p, cls("own-spec"))[0].children.map(text), ["A plain black leather belt, 3 cm wide.", "Full-grain leather, brushed steel buckle."], "the description shows as soon as it is written");
  assert.deepEqual(findAll(p, cls("own-step")).map(x => x.props.className), ["own-step done", "own-step now", "own-step"], "…and it moves on to step 2");
  assert.equal(findAll(p, role("owned-item-design")).length, 0); assert.equal(findAll(p, role("owned-item-generate")).length, 1);
  assert.equal(stale.ownedItemRow("worn", normName(BELT)).prop.form, after.form);
  // a card that left the film: the row's own copy is used rather than nothing
  assert.equal(card({ open: open("worn", BELT), props: { [BELT]: before }, liveProps: [] }).ownedItemRow("worn", normName(BELT)).prop.id, "p9");
  assert.ok(art.includes("const live = ownedProps.find(p=>p.id===r.prop.id);"));
});

await test("K a card made from a list is filed as that list says; the 'New wardrobe ready' banner is amber, not the Likeness's purple", () => {
  const fn = between(app, "  const createOwnedProp = (charId, itemText, sourceKind, opts)=>{", "  const addLookbookCard");
  let props = [];
  const make = vm.runInNewContext("(function(env){ const {characters,setProps,canMutateSharedFilm,window,classifyPropKind,artRoomPropOrigin} = env;\n" + fn + "\nreturn createOwnedProp; })", { Date, String, Object })({
    characters: [{ id: "eshita", name: "ESHITA" }], setProps: (f) => { props = f(props); }, canMutateSharedFilm: () => true, window: {},
    classifyPropKind: () => "carried", artRoomPropOrigin: (kind) => ({ kind }) });
  assert.equal(make("eshita", "work lanyard (navy, plastic ID card holder)", "worn", { kept: true }).kind, "worn", "typed under 'Accessories — worn': worn, whatever its name suggests");
  assert.equal(make("eshita", "work lanyard", "worn").kind, "carried", "the older callers keep the name's verdict");
  const sheet = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  const banner = between(sheet, 'className:"sheet-cameo-status char-wardrobe-update"', "// SCRIPT CHANGED");
  assert.ok(banner.includes('label:"About the new wardrobe"') && !banner.includes("scs-meta"), "its sentence is behind the 'i' (it was cut to 'TH…')");
  assert.ok(banner.includes('"Update sheet with new wardrobe"'));
  // (owner 2026-11-18: "yes, switch the button to work that way") the update builds on the current sheet: the same
  // person and panels, the wardrobe changed. It is the path the app's own wardrobe runs already use.
  assert.ok(banner.includes('"data-role":"wardrobe-update",disabled:gen.gening,onClick:()=>gen.generate(wardrobeUpdateOpts()),') && !banner.includes("onClick:()=>gen.generate(),"));
  // (owner 2026-11-18, after the first real try: "I have noticed a drift, my character's face changed") the whole
  // specification is no longer sent with the sheet; it is a targeted edit that names only the worn items
  const optsSrc = between(sheet, "  const wardrobeUpdateOpts = ()=>{", "  const [sheetTick, setSheetTick]");
  const mk = (worn, sheets) => vm.runInNewContext("(function(includedWornProps, ownedSheetMap){\n" + optsSrc + "\nreturn wardrobeUpdateOpts(); })", { String })(worn, sheets);
  const two = plain(mk([{ id: "r", name: "engagement ring" }, { id: "l", name: "work lanyard" }, { id: "s", name: "tiny gold stud earrings" }], { r: "data:r", l: "data:l" }));
  // (lockOk, 2026-11-20: the update starts from a locked sheet without asking, the road's own next step)
  assert.deepEqual(Object.keys(two), ["lockOk", "editInstruction"], "an edit, not a new sheet from the whole specification");
  assert.match(two.editInstruction, /^add these worn items to the character, each drawn exactly as its attached reference image shows it \(engagement ring; work lanyard\), where it would be seen in each panel and at its true small size\./);
  assert.match(two.editInstruction, /This is a small local change: do not redraw, restyle, re-light or re-pose anything\. Every face, eye, eyebrow, nose, mouth, hairline, skin tone and expression, every garment, cuff, button, shoe and hand, each panel's framing and border and the background stay exactly as they are$/);
  assert.ok(!two.editInstruction.includes("tiny gold stud"), "an item with no image of its own is not named: there is nothing to draw it from");
  assert.match(plain(mk([{ id: "r", name: "engagement ring" }], { r: "data:r" })).editInstruction, /^add this worn item to the character/);
  assert.deepEqual(plain(mk([{ id: "r", name: "engagement ring" }], {})), { deriveFromCurrent: true }, "no worn image to add (an item was removed): the update from the current sheet");
  assert.ok(sheet.includes('+"Apply ONLY this change: "+instr+". "') && art.includes("const isEditMode = !!(gopts.editInstruction && (genUrl || gopts.editBaseUrl));"), "it rides the card's own edit path");
  assert.ok(banner.includes("gen.likenessRefs ? { refs:cardGenerateRefs()+1 } : undefined"), "the sheet being updated is one more reference picture in the price");
  assert.ok(art.includes('if(isEditMode){ refImage = gopts.editBaseUrl || genUrl; mode = "edit"; }'), "the current sheet is the image that goes out");
  const base = between(sheet, 'buildFromBase: ()=> "Update this existing master character sheet for "', "buildLikeness:");
  assert.ok(base.includes("Preserve the EXACT same face, hair, skin tone, age, build, body proportions, identity, panel layout, framing and render style from the base sheet. ")
    && base.includes("Change only what the specification changes \\u2014 the wardrobe and the worn items; every panel, pose, expression and the background stay as they are in the base sheet. "));
  assert.ok(sheet.includes("attachments: wornProps.length ? collectAttachments : null,"), "the worn items' images still ride beside it");
  assert.ok(read("app/agents.jsx").includes("cast.generateMaster(c,{deriveFromCurrent:true})"));
  const rule = (css.match(/\.sheet-cameo-status\.char-wardrobe-update\{[^}]*\}/) || [""])[0];
  assert.ok(rule.includes("background:var(--pos-soft);border-color:var(--pos-line)") && !/29[5-6]/.test(rule), "amber from the theme's tokens, no purple");
  assert.ok(css.includes(".sheet-cameo-status.char-wardrobe-update .scs-act{color:var(--pos-ink);font-weight:700;"));
});

await test("N1 the popup's name: type a new one, or take the shorter one on offer; the popup stays on the renamed item", () => {
  const LONG = "engagement ring (slim gold band with a small solitaire, left ring finger, removed in Sc 28)";
  const rows = (prop) => ({ props: { [BADGE]: prop } });
  // (the test's items are fixed; the badge stands for any long item)
  const pr = { id: "p1", name: BADGE, kind: "worn" };
  const a = card({ open: open("worn", BADGE), ...rows(pr) }), p = a.ownedItemPanel(); a.log.length = 0;
  const field = findAll(p, cls("own-name"))[0];
  assert.equal(field.props.className, "own-name own-name-in"); assert.equal(field.props.multiline, true);
  field.props.onCommit("  licence badge  ");
  assert.deepEqual(plain(a.log), [["name", "liaqat", BADGE, "p1", "licence badge", null], ["open", open("worn", "licence badge")]], "the list and the card are renamed together; the popup follows the new name");
  a.log.length = 0; field.props.onCommit(BADGE); assert.deepEqual(a.log, [], "the same words: nothing to do");
  field.props.onCommit("   "); assert.deepEqual(plain(a.log), [["reset-name"]], "an emptied name goes back to what it was");
  // an item with no card yet is renamed in the list alone
  const b = card({ open: open("worn", BELT) }); const pb = b.ownedItemPanel(); b.log.length = 0;
  findAll(pb, cls("own-name"))[0].props.onCommit("brown belt");
  assert.deepEqual(plain(b.log[0]), ["name", "liaqat", BELT, "", "brown belt", null]);
  assert.equal(findAll(pb, role("owned-item-shorten")).length, 0, "no card: nothing would keep the full description, so no Shorten");
  // SHORTEN, a name that is a whole description (the card's own rule decides the short name)
  const ITEM = ITEMS[0][1];
  const longCard = { id: "p9", name: ITEM + " (worn every day, never taken off)", kind: "worn" };
  const c1 = card({ open: open("worn", ITEM), props: { [ITEM]: longCard } }), p1 = c1.ownedItemPanel(); c1.log.length = 0;
  const sb = findAll(p1, role("owned-item-shorten"))[0];
  assert.equal(text(sb), "Shorten to \u201c" + ITEM + "\u201d"); assert.match(sb.props.title, /its card in the Props tab\. The full description stays on the card\.$/);
  // …and a card that already has a shorter name than the list's words (shortened before today): the list takes it
  const short = { id: "p8", name: "PCO badge", kind: "worn", aliases: [ITEM] };
  const c2 = card({ open: open("worn", ITEM), props: { [ITEM]: short } }), p2 = c2.ownedItemPanel(); c2.log.length = 0;
  const sb2 = findAll(p2, role("owned-item-shorten"))[0]; assert.equal(text(sb2), "Shorten to \u201cPCO badge\u201d");
  // …and the card's rule comes first: a name an older cut left inside a bracket is offered its words before the bracket
  const cutCard = { id: "p7", name: "licence badge (green", kind: "worn", aliases: [ITEM] };
  const c3 = card({ open: open("worn", ITEM), props: { [ITEM]: cutCard }, shortRule: "licence badge" }), p3 = c3.ownedItemPanel(); c3.log.length = 0;
  const sb3 = findAll(p3, role("owned-item-shorten"))[0]; assert.equal(text(sb3), "Shorten to \u201clicence badge\u201d"); sb3.props.onClick();
  assert.deepEqual(plain(c3.log[0]), ["name", "liaqat", ITEM, "p7", "licence badge", { shorten: true }]);
  sb2.props.onClick();
  assert.deepEqual(plain(c2.log), [["name", "liaqat", ITEM, "p8", "PCO badge", { shorten: false }], ["open", open("worn", "PCO badge")]]);
  assert.equal(findAll(card({ open: open("worn", ITEM), props: { [ITEM]: { ...longCard, longNameOk: true } } }).ownedItemPanel(), role("owned-item-shorten")).length, 0, "'Keep' on the card is respected");
  // nobody who may not edit gets a field or the offer
  const ro = card({ readOnly: true, open: open("worn", ITEM), props: { [ITEM]: short }, sheets: { p8: "data:x" } }).ownedItemPanel();
  assert.equal(findAll(ro, cls("own-name"))[0].type, "span"); assert.equal(findAll(ro, role("owned-item-shorten")).length, 0);
  assert.ok(LONG.length > 40);
});

await test("N2 one name in both places, run for real: the popup, the Props tab's Shorten and a hand edit of the list all leave the list and the card with the same name", () => {
  const propsSrc = read("app/props.jsx");
  const shortSrc = between(propsSrc, "const PROP_NAME_CUT = ", "window.propShortNamePatch = propShortNamePatch;").replace("window.propShortName = propShortName;", "");
  const listSrc = between(insp, "function splitListItems(value){", "window.joinListItems = joinListItems;");
  const upd = between(app, "  const updateProp = (id,patch)=>{", "  const [draftingPropId, setDraftingPropId]");
  const norm = between(app, "  const _normPropName = s=>", "\n");
  const names = between(app, "  // a new name for a card; when the new words only open the old ones", "  /* a DRAFT never overwrites");
  const make = vm.runInNewContext("(function(env){ let props = env.props, characters = env.characters; let may = true;\n"
    + "const setProps = f => { props = f(props); }, setCharacters = f => { characters = f(characters); }, canMutateSharedFilm = () => may;\n"
    + shortSrc + "\n" + listSrc + "\nconst window = { propShortNamePatch };\n" + upd + "\n" + norm + "\n" + names
    + "\nreturn { updateProp, renameOwnedProp, nameOwnedItem, propShortName, propShortNamePatch, lock(){ may = false; }, get props(){ return props; }, get characters(){ return characters; } }; })",
    { String, Array, Object, Set, console });
  const LONG = "engagement ring (slim gold band with a small solitaire, left ring finger, removed in Sc 28)";
  const fresh = () => make({
    props: [{ id: "ring", name: LONG, kind: "worn", ownerId: "eshita" }, { id: "other", name: "work lanyard", kind: "worn", ownerId: "eshita" }],
    characters: [{ id: "eshita", name: "ESHITA", accessories: LONG + "; work lanyard (navy, plastic ID card holder); tiny gold studs", props: "house keys" }, { id: "liaqat", accessories: LONG }] });
  const acc = (m, id) => plain(m.characters).find(c => c.id === (id || "eshita")).accessories;
  const ring = (m) => plain(m.props).find(p => p.id === "ring");
  // a description in brackets is a clause: the short name stops before it
  const m0 = fresh();
  assert.equal(m0.propShortName(LONG), "engagement ring"); assert.equal(m0.propShortName("work lanyard (navy, plastic ID card holder)"), "work lanyard");
  assert.equal(m0.propShortName("Old steel-cased wristwatch on a cracked brown leather strap, left wrist"), "Old steel-cased wristwatch"); assert.equal(m0.propShortName("gold ring"), "");
  assert.equal(m0.propShortName("gold ring (thin)"), "", "a short name with a whole bracket is left alone");
  // THE OWNER'S OWN CASE: the Props tab's older Shorten stopped inside the bracket and left the list with the long words.
  // The card is offered "engagement ring"; one press puts it in both places; the true full description stays the origin.
  const CUT = "engagement ring (slim gold band";
  assert.equal(m0.propShortName(CUT), "engagement ring");
  const mc = make({ props: [{ id: "ring", name: CUT, aliases: [LONG], shortenedFrom: LONG, form: "A slim gold band", kind: "worn", ownerId: "eshita", keptAsProp: true }],
    characters: [{ id: "eshita", accessories: LONG + "; work lanyard (navy, plastic ID card holder)", props: "" }] });
  assert.equal(mc.nameOwnedItem("eshita", LONG, "ring", "engagement ring", { shorten: true }), "engagement ring");
  assert.equal(acc(mc), "engagement ring; work lanyard (navy, plastic ID card holder)");
  assert.deepEqual([ring(mc).name, ring(mc).aliases, ring(mc).shortenedFrom, ring(mc).form, ring(mc).keptAsProp], ["engagement ring", [LONG], LONG, "A slim gold band", true]);
  const md = make({ props: [{ id: "ring", name: CUT, aliases: [LONG], shortenedFrom: LONG, kind: "worn", ownerId: "eshita" }], characters: [{ id: "eshita", accessories: LONG, props: "" }] });
  md.updateProp("ring", md.propShortNamePatch(plain(md.props)[0])); assert.equal(acc(md), "engagement ring", "the Props tab's Shorten does the same");
  // 1 the popup's Shorten
  const m1 = fresh(); assert.equal(m1.nameOwnedItem("eshita", LONG, "ring", "engagement ring", { shorten: true }), "engagement ring");
  assert.equal(acc(m1), "engagement ring; work lanyard (navy, plastic ID card holder); tiny gold studs");
  assert.deepEqual([ring(m1).name, ring(m1).shortenedFrom, ring(m1).form, ring(m1).aliases], ["engagement ring", LONG, LONG, [LONG]], "the full description stays on the card");
  assert.equal(acc(m1, "liaqat"), LONG, "nobody else's list is touched");
  // 2 the Props tab's Shorten (the card's own patch): the owner's list follows
  const m2 = fresh(); m2.updateProp("ring", { name: "engagement ring", aliases: [LONG], shortenedFrom: LONG, form: LONG });
  assert.equal(acc(m2).split("; ")[0], "engagement ring"); assert.equal(ring(m2).name, "engagement ring");
  // 3 a rename typed on the Props card
  const m3 = fresh(); m3.updateProp("ring", { name: "Eshita's ring" }); assert.equal(acc(m3).split("; ")[0], "Eshita's ring");
  // 4 a card shortened before today (the list still has the long words): the next rename finds the item by the card's other name
  const m4 = make({ props: [{ id: "ring", name: "engagement ring", aliases: [LONG], kind: "worn", ownerId: "eshita" }], characters: [{ id: "eshita", accessories: LONG + "; studs", props: "" }] });
  assert.equal(m4.nameOwnedItem("eshita", LONG, "ring", "engagement ring"), "engagement ring"); assert.equal(acc(m4), "engagement ring, studs");
  const m4b = make({ props: [{ id: "ring", name: "engagement ring", aliases: [LONG], kind: "worn", ownerId: "eshita" }], characters: [{ id: "eshita", accessories: LONG + "; studs", props: "" }] });
  m4b.updateProp("ring", { name: "solitaire ring" }); assert.equal(acc(m4b), "solitaire ring, studs");
  // 5 typed in the popup: a new name; and one that keeps the first words keeps the full description on the card
  const m5 = fresh(); assert.equal(m5.nameOwnedItem("eshita", LONG, "ring", "gold solitaire"), "gold solitaire");
  assert.equal(acc(m5).split("; ")[0], "gold solitaire"); assert.deepEqual([ring(m5).name, ring(m5).form], ["gold solitaire", undefined]);
  const m6 = fresh(); m6.nameOwnedItem("eshita", LONG, "ring", "Engagement ring");
  assert.deepEqual([ring(m6).name, ring(m6).form, ring(m6).aliases], ["Engagement ring", LONG, [LONG]]);
  // 6 the list edited by hand (EditableItemList commits the list, then tells the card)
  const m7 = fresh(); m7.renameOwnedProp("eshita", LONG, "engagement ring");
  assert.deepEqual([ring(m7).name, ring(m7).form, ring(m7).shortenedFrom], ["engagement ring", LONG, LONG]);
  const m8 = fresh(); m8.renameOwnedProp("eshita", "work lanyard", "navy lanyard"); assert.equal(plain(m8.props).find(p => p.id === "other").form, undefined, "a plain rename keeps nothing extra");
  // 7 an item with no card: the list alone; a film they may not change: nothing
  const m9 = fresh(); assert.equal(m9.nameOwnedItem("eshita", "tiny gold studs", "", "gold studs"), "gold studs"); assert.ok(acc(m9).endsWith("; gold studs"));
  const m10 = fresh(); m10.lock(); assert.equal(m10.nameOwnedItem("eshita", LONG, "ring", "x"), ""); assert.equal(acc(m10).split("; ")[0], LONG); assert.equal(ring(m10).name, LONG);
  assert.equal(fresh().nameOwnedItem("eshita", LONG, "ring", "  "), "");
  // the Props card says so
  assert.ok(propsSrc.includes('" "+(p.ownerName||"Its owner")+"\u2019s list takes the short name too."') || propsSrc.includes("s list takes the short name too."));
  assert.ok(app.includes("onCreateOwnedProp:createOwnedProp,onNameOwnedItem:nameOwnedItem,") && (art.match(/onCreateOwnedProp, onNameOwnedItem/g) || []).length === 5, "handed down to the card");
});

await test("6 the look: a square where the dot was; a popup in the windows' own look; phones get one column", () => {
  for (const k of [".own-tile{flex:0 0 24px;width:24px;height:24px;", ".own-tile.has{border-style:solid;", ".own-tile.on{border-style:solid;border-color:var(--win-amber,#F29A43);",
    ".own-pop{position:relative;display:flex;flex-direction:column;gap:14px;width:min(720px,100%);max-height:calc(100dvh - 40px);overflow:auto;",
    "background:var(--win-surface,var(--bg-1));", ".own-name{flex:1 1 auto;min-width:0;font:500 21px/1.25 var(--f-serif);",
    ".own-body{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:20px;align-items:start}", ".own-shot img{display:block;width:100%;height:auto;max-height:52vh;object-fit:contain}",
    ".own-step.done .own-step-dot{background:var(--ok);border-color:var(--ok);", ".own-step.now .own-step-dot{border-color:var(--win-amber,#F29A43);",
    ".own-act.main{background:var(--win-amber,#F29A43);color:var(--win-on-amber,#2C2722);", ".own-short-btn{max-width:100%;padding:4px 12px;border:1px dashed",
    "@media (prefers-reduced-motion:reduce){ .own-pop{animation:none} }",
    "@media (max-width:640px){ .sheet-2col.owned-lists{grid-template-columns:minmax(0,1fr)} }",
    "  .own-body{grid-template-columns:minmax(0,1fr);gap:12px}", "  .own-act{height:auto;min-height:44px}", "  .own-tile{flex-basis:30px;width:30px;height:30px;"])
    assert.ok(css.includes(k), k);
  assert.ok(!css.includes(".own-panel"), "the drawer's rules are gone");
  // the popup's own padding on a phone must come after New Story's `.ns-overlay{padding:0}` to win
  assert.ok(css.indexOf("  .own-overlay{padding:12px}") > css.lastIndexOf("  .ns-overlay{padding:0}"));
  // the one-column rule must be stronger than .sheet-2col's two columns, which come after it in the file
  assert.ok(css.indexOf(".sheet-2col{display:grid;grid-template-columns:1fr 1fr;") > css.indexOf(".sheet-2col.owned-lists{grid-template-columns:minmax(0,1fr)}"));
});

await test("F Frances knows; nothing she is told names the codename; the changed files are served under a new key", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"Open a worn or carried item on the character card and make its image there (Characters, Art Room)"', "function appBrief(){");
  for (const k of ["a small square at the start of its row", "'Write its design'", "'Generate image'", "'Generate new image'", "'Visual lock'", "each paid step is its own press",
    "kept as a prop", "Recently deleted", "view-only access", "On a phone", "opens in a POPUP over the page", "ONE NAME IN BOTH PLACES", "'Shorten to", "Renaming costs nothing.",
    "'Write its design again'", "filed as that list says", "ID PHOTOS", "'New wardrobe ready'", "NO DESCRIPTION YET", "A NAME THAT ENDS IN", "'Write its design' then waits", "UPDATES THE SHEET YOU HAVE", "only the image engines can make or change a picture", "what is saved is your own sheet with only the item copied in", "HOW WELL THE FACE HOLDS", "the button spins while it is written"]) assert.ok(f.includes(k), k);
  // (owner 2026-11-19) the three rules for a character's photo on an object, and the drafter is told them
  for (const k of ["ID PHOTOS AND PICTURES OF A CHARACTER", "as they look NOW", "only when the screenplay or the object's own description says the picture is from an earlier time", "they never wear the outfit of their sheet in it", "a plain shirt or a simple top"]) assert.ok(f.includes(k), k);
  assert.ok(ai.includes("AN OBJECT THAT SHOWS A PERSON'S PHOTO (an ID badge, pass or licence, a framed picture, a Polaroid, a snapshot): say in form what the photo shows.") && ai.includes("and NOT the outfit they wear in the film"));
  assert.ok(!f.includes("drawer"));
  assert.ok(ai.includes("the item in its owner's list on the character card takes the short name too") && !ai.includes("the character's list is left as it is and still finds the card"));
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic/.test(f));
  assert.ok(f.includes("/from its row in the character card's Props & accessories section|Only hero props are cards/.test(f.what)"), "older entries are put right");
  assert.ok(ai.includes("beside the WHOLE cast (since 2026-11-18; it used to stop at five people)") && !ai.includes("share the most scenes with (up to five)"));
  assert.ok(ai.includes("press the small square at the start of the item's row, make the object's image there, keep 'Visual lock' ticked"));
  const KEYS = ["20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1"];   // (the list grows with each key bump)
  for (const file of ["artroom.jsx", "ai.jsx", "script.jsx"])
    assert.ok(KEYS.some(k => html.includes("app/" + file + "?v=" + k + '"')), file);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

#!/usr/bin/env node
/* A worn or carried item opens where it is listed (owner 2026-11-18: "Props & Accessories: allow user to click to
   open respective prop/accessory or generate directly on the card without changing tabs (decide for me, make it
   interesting UI)").

   1 Every item in the two lists has a small square in its row: its image, or a dashed square that offers one.
   2 A press opens one drawer for that item: its image, three steps, the next step's button.
   3 Nothing is spent on opening; each paid step is its own press; a card made here is a prop the person kept.
   4 Someone who may not edit sees the images, no buttons.
   5 The rows under the lists keep only leftover cards; the list component takes a lead of its own.
   6 Phones: one column (the rule now wins), the drawer under the list its item is in.

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
const NAMES = ["React", "Icon", "window", "linkInfo", "normName", "ownedSheetMap", "readOnly", "propBusy", "setPropBusy", "wornExclusions", "c", "gen",
  "onCreateOwnedProp", "onDraftProp", "onView", "project", "setSheetTick", "setWornReferenceIncluded", "castFirstName", "propVisualsDrafted"];
const factory = vm.runInNewContext("(function(env){ const {" + NAMES.join(",") + "} = env;\n" + chunk + "\nreturn { ownedItemRow, ownedItemTile, ownedItemPanel }; })", { console, Promise, String, Set });
const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(?:and-|then-)/, "").slice(0, 40);
const ITEMS = [["worn", "green PCO licence badge on a lanyard"], ["worn", "black leather belt"], ["carried", "Nasir's notebook"]];
function card(over) {
  const log = [];
  const o = Object.assign({ props: {}, sheets: {}, excluded: [], readOnly: false, busy: null, open: null, sheet: "data:char" }, over || {});
  const env = {
    React: { createElement: el }, Icon: { plus: "ic-plus", box: "ic-box", x: "ic-x", check: "ic-check", sparkles: "ic-sparkles" },
    window: { appToast: (m, k) => log.push(["toast", k || "info", m]), InfoTip, nbCostChip: (n) => el("span", { className: "nb-cost" }, String(n)),
      generatePropSheet: async (p, project) => { log.push(["generate", p.id, project && project.id]); return true; } },
    linkInfo: { rows: ITEMS.map(([src, t], i) => ({ key: "b-" + i, name: t, item: t, prop: o.props[t] || null, orphan: false, src }))
      .concat([{ key: "o-x", name: "Aud", prop: { id: "p-old", name: "Aud", kind: "worn" }, orphan: true }]) },
    normName, ownedSheetMap: o.sheets, readOnly: o.readOnly, propBusy: o.busy, setPropBusy: (v) => log.push(["busy", v && v.kind, v && v.key]),
    wornExclusions: new Set(o.excluded), c: { id: "liaqat", name: "LIAQAT HUSSAIN" }, gen: { genUrl: o.sheet },
    onCreateOwnedProp: (cid, item, src, opts) => { log.push(["create", cid, item, src, opts]); return { id: "p-new", name: item, kind: src }; },
    onDraftProp: async (p) => { log.push(["draft", p.id]); }, onView: (url, p) => log.push(["view", url, p.id]), project: { id: "film" },
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
  assert.equal(card({ open: open("worn", "gone") }).ownedItemPanel(), null, "the item was renamed or removed: the drawer closes");
  const a = card({ open: open("worn", BELT) }), p = a.ownedItemPanel();
  assert.equal(p.props["data-testid"], "owned-item-panel"); assert.equal(p.props["data-src"], "worn");
  assert.equal(text(findAll(p, cls("own-name"))[0]), BELT); assert.equal(text(findAll(p, cls("own-kind"))[0]), "Worn");
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
  assert.deepEqual(b.log.map(x => x[0]), ["busy", "draft", "busy"]); assert.deepEqual(b.log[1], ["draft", "p2"]);
});

await test("2b designed, no image: 'Generate image' with its price; it needs the character's sheet first; one press, one image", async () => {
  const pr = { id: "p2", name: BOOK, kind: "carried", form: "A6 notebook", material: "black card cover" };
  const a = card({ open: open("carried", BOOK), props: { [BOOK]: pr } }), p = a.ownedItemPanel();
  assert.deepEqual(findAll(p, cls("own-step")).map(s => s.props.className), ["own-step done", "own-step now", "own-step"]);
  assert.equal(text(findAll(p, cls("own-step-lab"))[2]), "In the shots", "a carried item joins the shots, not the sheet");
  assert.equal(text(findAll(p, cls("own-spec"))[0]), "A6 notebook · black card cover", "what was written is shown");
  const btn = findAll(p, role("owned-item-generate"))[0];
  assert.equal(btn.props.className, "own-act main"); assert.equal(btn.props.disabled, false);
  assert.equal(btn.children.filter(x => typeof x === "string").join(""), "Generate image"); assert.equal(findAll(btn, cls("nb-cost")).length, 1);
  await btn.props.onClick();
  assert.deepEqual(a.log.filter(x => x[0] === "generate"), [["generate", "p2", "film"]]);
  assert.deepEqual(a.log.map(x => x[0]), ["busy", "generate", "toast", "busy", "tick"]); assert.equal(a.log[2][1], "success");
  assert.ok(!a.log.some(x => x[0] === "create" || x[0] === "draft"), "nothing else is paid for");
  // no character sheet yet: the button waits and a line says why
  const b = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, sheet: "" }), q = b.ownedItemPanel();
  assert.equal(findAll(q, role("owned-item-generate"))[0].props.disabled, true);
  assert.equal(text(findAll(q, cls("own-note"))[0]), "Generate Liaqat’s sheet first.");
  // while one item is being made, no second run starts
  const busy = card({ open: open("carried", BOOK), props: { [BOOK]: pr }, busy: { key: "worn:x", kind: "gen" } });
  const bb = findAll(busy.ownedItemPanel(), role("owned-item-generate"))[0]; assert.equal(bb.props.disabled, true);
  await bb.props.onClick(); assert.deepEqual(busy.log, []);
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
  assert.ok(/onCommit:val=>onUpdate\(c\.id,\{props:val\}\)\}\),\n\s*\/\/[^\n]*\n\s*ownedItemPanel\(\)\),/.test(sheet), "the drawer is the third thing in the lists' own grid");
  assert.ok(sheet.includes("const extraRows = linkedRows.filter(r=>r.orphan);") && sheet.includes("extraRows.length>0 && React.createElement(\"div\",{className:\"linked-props\"},")
    && sheet.includes("extraRows.map(row=>{"));
  assert.ok(!sheet.includes("linked-prop-gen") && !sheet.includes('"Draft specification"') && !sheet.includes('"Create card"'), "the row buttons moved into the drawer");
  assert.equal(sheet.split("window.generatePropSheet(pr, project)").length - 1, 1, "one place makes an item's image");
});

await test("6 the look: a square where the dot was, a drawer across the lists; phones get one column and the drawer under its own list", () => {
  for (const k of [".own-tile{flex:0 0 24px;width:24px;height:24px;", ".own-tile.has{border-style:solid;", ".own-tile.on{border-style:solid;border-color:var(--win-amber,#F29A43);",
    ".owned-lists > .own-panel{grid-column:1 / -1}", ".own-panel{position:relative;display:grid;grid-template-columns:96px minmax(0,1fr);",
    ".own-step.done .own-step-dot{background:var(--ok);border-color:var(--ok);", ".own-step.now .own-step-dot{border-color:var(--win-amber,#F29A43);",
    ".own-act{display:inline-flex;align-items:center;gap:6px;height:28px;", ".own-act.main{background:var(--accent);color:var(--ink-on-accent);",
    "@media (prefers-reduced-motion:reduce){ .own-panel{animation:none} }",
    "@media (max-width:640px){ .sheet-2col.owned-lists{grid-template-columns:minmax(0,1fr)} }",
    '  .owned-lists > .own-panel[data-src="worn"]{order:2}', "  .own-act{height:auto;min-height:44px}", "  .own-tile{flex-basis:30px;width:30px;height:30px;"])
    assert.ok(css.includes(k), k);
  // the one-column rule must be stronger than .sheet-2col's two columns, which come after it in the file
  assert.ok(css.indexOf(".sheet-2col{display:grid;grid-template-columns:1fr 1fr;") > css.indexOf(".sheet-2col.owned-lists{grid-template-columns:minmax(0,1fr)}"));
});

await test("F Frances knows; nothing she is told names the codename; the changed files are served under a new key", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"Open a worn or carried item on the character card and make its image there (Characters, Art Room)"', "function appBrief(){");
  for (const k of ["a small square at the start of its row", "'Write its design'", "'Generate image'", "'Generate new image'", "'Visual lock'", "each paid step is its own press",
    "kept as a prop", "Recently deleted", "view-only access", "On a phone"]) assert.ok(f.includes(k), k);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic/.test(f));
  assert.ok(f.includes("/from its row in the character card's Props & accessories section|Only hero props are cards/.test(f.what)"), "older entries are put right");
  assert.ok(ai.includes("beside the WHOLE cast (since 2026-11-18; it used to stop at five people)") && !ai.includes("share the most scenes with (up to five)"));
  assert.ok(ai.includes("press the small square at the start of the item's row, make the object's image there, keep 'Visual lock' ticked"));
  const KEYS = ["20261118-items1"];   // (the list grows with each key bump)
  for (const file of ["artroom.jsx", "inspector.jsx", "app.jsx", "ai.jsx", "script.jsx", "styles.css"])
    assert.ok(KEYS.some(k => html.includes("app/" + file + "?v=" + k + '"')), file);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

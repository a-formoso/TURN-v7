#!/usr/bin/env node
/* THE DETAILS UNDER A SHEET IMAGE ARE THE PERSON'S CHOICE (owner 2026-11-17: "give user the option to customise which
   properties or sheet details to show here so they can show/hide what's important to them about the sheet. Apply this
   across the other tabs in the app where applicable").

   One frame draws every card's image (characters, props, locations, crowds, the Lookbook, shots), so one choice serves
   them all. Out of the box it shows what it always did: engine, shape and size. The choice is kept on this device and
   only shows or hides: an image's saved details are never changed.

     node scripts/build-dist.mjs && node scripts/test-sheet-details-choice.mjs   (it reads dist/app/artroom.js) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const noop = () => {};

function sandbox(stored){
  const store = { v: stored === undefined ? null : stored, sets: [], events: [] };
  let states = null;
  const s = { console, React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
      createContext: () => ({ Provider: "provider" }), useContext: () => false,
      useState: (init) => { const v = typeof init === "function" ? init() : init; if (states) { const i = states.n++; if (i in states.over) return [states.over[i], noop]; } return [v, noop]; },
      useEffect: noop, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: "fragment" },
    Icon: new Proxy({}, { get: (_t, k) => { const f = () => null; f.iconName = String(k); return f; } }),
    localStorage: { getItem: () => store.v, setItem: (k, v) => { store.sets.push([k, v]); store.v = v; } },
    document: {}, setTimeout: noop, setInterval: noop, addEventListener: noop, removeEventListener: noop,
    dispatchEvent: (e) => { store.events.push(e && e.type); return true; }, CustomEvent: class { constructor(t){ this.type = t; } } };
  s.window = s; vm.createContext(s); vm.runInContext(read("dist/app/artroom.js"), s);
  s.__store = store; s.__states = (over) => { states = over ? { n: 0, over } : null; };
  return s;
}
const find = (n, p) => { if (!n || typeof n !== "object") return null; if (p(n)) return n; for (const c of n.children || []) { const f = find(c, p); if (f) return f; } return null; };
const findAll = (n, p, out = []) => { if (!n || typeof n !== "object") return out; if (p(n)) out.push(n); for (const c of n.children || []) findAll(c, p, out); return out; };
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
const META = { modelLabel: "Nano Banana 2.1", modelId: "gemini-nano-banana-2.1", aspect: "16:9", size: "2K", pixelW: 2752, pixelH: 1536, quality: "high",
  date: "Nov 17, 2026", time: "6:25 PM", iso: "2026-11-17T18:25:03.000Z", renderStyleKey: "pixar", renderStyleLabel: "Pixar-style 3D" };
const frame = (s, meta, slotId) => s.SheetFrame({ gen: { genUrl: "image.png", genMeta: meta, gening: false, generate: noop, cancelGen: noop, importSheet: noop, allModels: [], layers: 0 },
  slotId: slotId || "charref-c", name: "Test", drafted: true, dropToImport: true, noun: "sheet" });
const items = (t) => (find(t, (n) => n.props.className === "sheet-frame-meta").children || []).map(text);

test("1 out of the box: engine, shape and size — as it always was — on every kind of card", () => {
  const s = sandbox();
  for (const slot of ["charref-c", "propref-p", "locref-l", "lookref-c", "shot-s", "crowdref-x"]) assert.deepEqual(items(frame(s, META, slot)), ["Nano Banana 2.1", "16:9", "2K"], slot);
  assert.deepEqual(JSON.parse(JSON.stringify(s.sheetCapRead())), ["model", "aspect", "size"]);
});

test("2 the person's choice is read from this device and shown in a fixed order; a ticked detail an image has none of shows a dash that says so", () => {
  const s = sandbox(JSON.stringify(["style", "date", "model", "pixels", "quality"]));
  assert.deepEqual(items(frame(s, META)), ["Nano Banana 2.1", "2752×1536", "High quality", "Nov 17, 2026", "Family feature 3D"],
    "the saved sheet's old style name is shown as today's");
  // (owner 2026-11-17: "Quality tick is not showing even when ticked") a tick never seems to do nothing
  const bare = frame(s, { modelLabel: "Seedream 5 Pro", aspect: "16:9", size: "2K" });
  assert.deepEqual(items(bare), ["Seedream 5 Pro", "Pixels —", "Quality —", "Date —", "Style —"], "no pixels, quality, date or style saved with this one: named, with a dash");
  assert.deepEqual(findAll(bare, (n) => n.props.className === "sheet-meta-item none").map((n) => n.props.title),
    ["Size in pixels: not saved with this image", "Quality: not saved with this image", "Date made: not saved with this image", "Render style: not saved with this image"]);
  // "Default" is a quality too (it was left out, so the tick showed nothing)
  assert.deepEqual(items(frame(sandbox('["quality"]'), { modelLabel: "Seedream 5.5", aspect: "16:9", size: "2K", quality: "default" })), ["Default quality"]);
  assert.deepEqual(items(frame(sandbox("[]"), META)), [], "everything may be hidden");
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox('["nonsense","size"]').sheetCapRead())), ["size"], "only known details");
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox("{broken").sheetCapRead())), ["model", "aspect", "size"], "an unreadable choice: the usual three");
  const before = JSON.stringify(META); frame(s, META); assert.equal(JSON.stringify(META), before, "the image's saved details are never changed");
});

test("2b the chooser is on every card that has an image — also where the image has no saved details; never on an empty card", () => {
  const s = sandbox();
  const G = (over) => ({ genUrl: "image.png", genMeta: null, gening: false, generate: noop, cancelGen: noop, importSheet: noop, allModels: [], layers: 0, ...over });
  const bare = s.SheetFrame({ gen: G({}), slotId: "charref-c", name: "Test", drafted: true, dropToImport: true, noun: "sheet" });
  assert.equal(text(find(bare, (n) => n.props.className === "sheet-frame-cap-label")), "Generated");
  assert.ok(find(bare, (n) => n.props["data-role"] === "sheet-cap-btn"), "the button is there without saved details");
  const empty = s.SheetFrame({ gen: G({ genUrl: "" }), slotId: "charref-c", name: "Test", drafted: true, dropToImport: true, noun: "sheet" });
  assert.equal(find(empty, (n) => n.props["data-role"] === "sheet-cap-btn"), null, "no image, nothing to choose");
});

test("3 the chooser: a small button at the end of the line; its list has every detail with a tick; a tick is saved on this device and told to the other cards", () => {
  const s = sandbox();
  let t = frame(s, META);
  const btn = find(t, (n) => n.props["data-role"] === "sheet-cap-btn");
  assert.ok(btn && btn.props["aria-label"] === "Choose the details shown under images" && btn.props["aria-expanded"] === "false");
  assert.equal(find(t, (n) => n.props.className === "sheet-cap-pop"), null, "closed until pressed");
  // open (the frame's states in order: … the chooser's two are capFields then capOpen)
  const probe = []; const real = s.React.useState;
  s.React.useState = (init) => { const v = typeof init === "function" ? init() : init; probe.push(v); return [v, noop]; };
  frame(s, META); s.React.useState = real;
  const iFields = probe.findIndex((v) => Array.isArray(v) && v.join() === "model,aspect,size");
  assert.ok(iFields >= 0 && probe[iFields + 1] === false, "the chooser's open state follows its fields");
  s.__states({ [iFields + 1]: true }); t = frame(s, META); s.__states(null);
  const pop = find(t, (n) => n.props.className === "sheet-cap-pop");
  assert.ok(pop, "the list opens");
  const opts = findAll(pop, (n) => n.type === "input");
  assert.deepEqual(opts.map((o) => o.props["data-cap"]), ["model", "aspect", "size", "pixels", "quality", "date", "style"]);
  assert.deepEqual(opts.map((o) => o.props.checked), [true, true, true, false, false, false, false]);
  assert.deepEqual(findAll(pop, (n) => n.props.className === "sheet-cap-opt").map(text), ["Engine", "Shape (aspect ratio)", "Size", "Size in pixels", "Quality", "Date made", "Render style"]);
  opts.find((o) => o.props["data-cap"] === "date").props.onChange();
  assert.deepEqual(s.__store.sets.pop(), ["turn.sheetCapFields", JSON.stringify(["model", "aspect", "size", "date"])]);
  assert.ok(s.__store.events.includes("turn-sheet-cap"), "every other card on the page follows");
  opts.find((o) => o.props["data-cap"] === "model").props.onChange();
  assert.deepEqual(JSON.parse(s.__store.v), ["aspect", "size", "date"]);
});

test("4 the styles: the line wraps when more is ticked; the list opens over the image, inside the card", () => {
  const css = read("app/styles.css");
  for (const k of [".sheet-frame-meta{flex-wrap:wrap;row-gap:4px;flex:1 1 auto}", ".sheet-cap-pop{position:absolute;right:0;bottom:calc(100% + 6px);", ".sheet-cap-pick{flex:0 0 auto;margin-left:auto;display:inline-flex}"])
    assert.ok(css.includes(k), k);
  assert.ok(read("app/icons.jsx").includes("  sliders:(p)=>I({...p,children:["));
  assert.ok(read("app/ai.jsx").includes("THE DETAILS UNDER AN IMAGE ARE YOUR CHOICE"), "Frances knows");
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

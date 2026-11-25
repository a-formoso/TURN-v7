#!/usr/bin/env node
/* Prop sheets have three views, and Screenplay evidence makes no long scroll (owner 2026-11-20: "let's change the prop
   sheet to have 3 sections only instead of 4 … just like we have character sheets, having 3 different views … You
   decide which ones"; "Screenplay evidence … they open and it leads to a long scroll. Can we organize the content in a
   way that doesn't involve users scrolling too much, all whilst still maintaining the aesthetics for subsections …
   just like we did previously in the locations card").

   1 The sheet's prompt: three equal panels, each a different view (front, side, close-up); a flat object's side
     view is never a bare line. (The first three were three-quarter, front, close-up: on a flat object the first
     two came out alike, and the owner asked for "a side view, a zoomed in view, and a front view".)
   2 The photo-made sheet and the short retry prompt ask for the same three views.
   3 An edit keeps the layout the sheet already has: sheets made earlier stay as they are.
   4 A passage is shortened around the matched words, at a word, never inside the match.
   5 The evidence box: one small button per passage and ONE passage shown; a single passage has no buttons.
   6 The card: the location card's boxes, no row per passage, the caution behind the tooltip.
   7 Frances knows it; the page loads the new files.

     node scripts/test-prop-three-views.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const props = read("app/props.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css"), html = read("TURN.html");

const el = (type, p, ...ch) => ({ type, props: p || {}, children: ch.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false && x !== "") });
const text = (n) => (typeof n === "string" || typeof n === "number") ? String(n) : (n && n.children ? n.children.map(text).join("") : "");
const find = (n, f, out = []) => { if (n && typeof n === "object") { if (f(n)) out.push(n); (n.children || []).forEach((c) => find(c, f, out)); } return out; };
const cls = (n) => String((n.props && n.props.className) || "");

await test("1 the sheet's prompt asks for three equal panels, each a different view: front, side, close-up", () => {
  const lay = between(props, "    layout: {", "    continuity: {");
  assert.ok(lay.includes('format: "a 3-panel object reference sheet in 16:9 landscape: three EQUAL-width tall vertical panels'));
  assert.ok(lay.includes("front, side and close-up; the SAME object throughout, each panel a clearly DIFFERENT view"));
  const panels = [...lay.matchAll(/"PANEL (\d) \\u2014 ([A-Za-z -]+?)(?: view|,)/g)].map((m) => m[1] + " " + m[2].trim());
  assert.deepEqual(panels, ["1 straight-on FRONT", "2 SIDE", "3 CLOSE-UP"]);
  assert.ok(lay.includes("turned a full quarter turn (90\\u00b0) from the front so its profile, depth and thickness read"));
  // a flat object's side view is never a bare line (the first trial: a lanyard)
  assert.ok(lay.includes("If the object is flat or thin (a card, a sheet of paper, a strap, a blade), never draw it as a bare edge-on line: turn it about 70\\u00b0 instead"));
  assert.ok(lay.includes('different_views_rule: "no two panels may show the object from the same angle'), "the first three-view sheet drew the front twice");
  assert.ok(lay.includes('scale_rule: "the FRONT (panel 1) and SIDE (panel 2) views each show the WHOLE object at the SAME size and share a baseline'));
  assert.ok(lay.includes('panel_widths: "all three panels are EQUAL width'));
  assert.ok(lay.includes("do not add a BACK view, a three-quarter view, a fourth panel,"));
  assert.ok(!/PANEL 4|HERO|four EQUAL|all four panels/.test(lay));
});

await test("2 the photo-made sheet and the short retry prompt ask for the same three views", () => {
  const b = { console, String }; b.window = b; vm.createContext(b);
  vm.runInContext(between(props, "function buildPropFromPhotoPrompt(p, project){", "window.buildPropFromPhotoPrompt"), b);
  b.propInheritedStyleKey = () => ""; b.renderStyleText = () => "photoreal";
  const photo = b.buildPropFromPhotoPrompt({ name: "Cup" }, {});
  assert.match(photo, /a 3-panel object reference sheet in 16:9 landscape, three equal panels/);
  assert.match(photo, /straight front view, side view turned a full quarter turn \(a flat or thin object turned about 70 degrees instead, so its edge and thickness read, never a bare line\), and a zoomed-in macro close-up/);
  assert.match(photo, /each panel a clearly different view; no back view, no three-quarter view, no extra angles/);
  assert.ok(!/4-panel|four equal|hero/.test(photo));
  const c = { console, String }; c.window = c; vm.createContext(c);
  c.propInheritedStyleKey = () => ""; c.renderStyleText = () => "photoreal";
  vm.runInContext(between(props, "function buildSimplePropPrompt(p){", "window.buildSimplePropPrompt = buildSimplePropPrompt;") + "\nthis.f=buildSimplePropPrompt;", c);
  const simple = c.f({ name: "Cup", form: "a tin cup." });
  assert.match(simple, /3-panel object sheet: front view, side view turned a quarter turn, and a zoomed-in close-up/);
  assert.ok(!/4-panel|hero/.test(simple));
});

await test("3 an edit keeps the layout the sheet already has; nothing in the prop code names four views any more", () => {
  const edit = between(props, "    buildEdit: (instr)=>", "  });");
  assert.ok(edit.includes("Keep this sheet's own layout \\u2014 the same views in the same places, none added and none removed \\u2014 on the same flat off-white background."));
  assert.ok(!/\d-panel|hero \\u00b7 front/.test(edit), "an edit names no count and no views, so any earlier sheet is edited as it is");
  assert.ok(!/4-panel|4-PANEL|four EQUAL|four equal panels|HERO three-quarter/.test(props));
  assert.ok(props.includes('label:"Prompt (text only) \\u2014 the 3-view object sheet: front, side, close-up"'));
});

await test("4 a passage is shortened around the matched words, at a word, never inside the match", () => {
  const sb = {}; vm.runInNewContext(between(props, "function propEvidenceExcerpt(text, a, b){", "window.propEvidenceExcerpt = propEvidenceExcerpt;") + "\nthis.x=propEvidenceExcerpt;", sb);
  const short = "She lifts the brass key from the hook.";
  const a = short.indexOf("brass key");
  const s = sb.x(short, a, a + 9);
  assert.deepEqual([s.before, s.hit, s.after], ["She lifts the ", "brass key", " from the hook."], "a short passage is shown whole");
  const words = (n, w) => Array.from({ length: n }, (_, i) => w + i).join(" ");
  const long = words(80, "before") + " the BRASS KEY " + words(80, "after");
  const i = long.indexOf("BRASS KEY");
  const l = sb.x(long, i, i + 9);
  assert.equal(l.hit, "BRASS KEY");
  assert.ok(l.before.startsWith("…") && l.after.endsWith("…"), "what was cut is marked");
  assert.ok(/^…before\d+ /.test(l.before) && /after\d+…$/.test(l.after), "cut at a word");
  assert.ok((l.before + l.hit + l.after).length < 340, "about 150 characters each side");
  assert.equal(long.includes(l.before.slice(1) + l.hit + l.after.slice(0, -1)), true, "the film's own words, in order");
  const edge = sb.x("key", 0, 3);
  assert.deepEqual([edge.before, edge.hit, edge.after], ["", "key", ""]);
});

await test("5 the evidence box: one small button per passage, ONE passage shown; a single passage has no buttons", () => {
  const st = { at: 0 }, opened = [];
  const sb = { console, String, Math };
  sb.window = sb; sb.InfoTip = function InfoTip() {};
  sb.React = { createElement: el, useState: () => [st.at, (n) => { st.at = n; }] };
  vm.runInNewContext(between(props, "function PropEvidenceBox({", "window.PropEvidenceBox = PropEvidenceBox;") + "\nthis.B=PropEvidenceBox;", sb);
  const items = [
    { key: "a", chip: "03·2", where: "Scene 03 · Beat 2", kind: "Exact text", tone: "exact", target: { sceneId: "s3" }, quote: "the brass key" },
    { key: "b", chip: "07·1", where: "Scene 07 · Beat 1", kind: "Possible match", tone: "possible", target: { sceneId: "s7" }, quote: "a key" },
    { key: "c", chip: "09", where: "Scene 09", kind: "Earlier · replaced", tone: "earlier", quote: "an old line" },
  ];
  const draw = (list, extra) => sb.B({ title: "In the script’s text · 1 exact · 1 possible", tip: "About matches.", items: list, onOpen: (t) => opened.push(t), ...(extra || {}) });
  let box = draw(items);
  assert.ok(cls(box).includes("loc-sub"), "the location card's own subsection box");
  assert.equal(find(box, (n) => cls(n).includes("loc-step-sub")).length, 1, "with the location card's own title");
  assert.equal(find(box, (n) => n.type === sb.InfoTip).length, 1, "the caution is a tooltip beside the title");
  const chips = () => find(box, (n) => cls(n).includes("prop-evi-chip") && n.type === "button");
  assert.deepEqual(chips().map(text), ["03·2", "07·1", "09"]);
  assert.deepEqual(chips().map((n) => cls(n).includes(" on")), [true, false, false]);
  assert.ok(cls(chips()[1]).includes("possible") && cls(chips()[0]).includes("prop-scene-chip"), "the card's own scene buttons");
  const views = () => find(box, (n) => cls(n) === "prop-evi-view");
  assert.equal(views().length, 1, "ONE passage, however many there are");
  assert.ok(text(views()[0]).includes("Scene 03 · Beat 2") && text(views()[0]).includes("Exact text") && text(views()[0]).includes("the brass key"));
  find(box, (n) => n.type === "button" && text(n) === "Go to the scene")[0].props.onClick();
  assert.deepEqual(opened, [{ sceneId: "s3" }], "the jump opens that passage");
  chips()[2].props.onClick(); box = draw(items);
  assert.ok(text(views()[0]).includes("Scene 09") && text(views()[0]).includes("an old line") && !text(views()[0]).includes("brass"));
  assert.equal(find(box, (n) => n.type === "button" && text(n) === "Go to the scene").length, 0, "a replaced passage has nowhere to go");
  // fewer passages than the chosen number (the screenplay changed): the last one is shown, nothing breaks
  box = draw(items.slice(0, 2));
  assert.ok(text(views()[0]).includes("Scene 07"));
  st.at = 0; box = draw(items.slice(0, 1));
  assert.equal(chips().length, 0, "one passage needs no buttons");
  assert.equal(views().length, 1);
  box = draw([], { children: el("div", { className: "prop-evi-line" }, "No direct mention found in the screenplay text.") });
  assert.equal(views().length, 0);
  assert.ok(text(box).includes("No direct mention found in the screenplay text."));
});

await test("6 the card: three boxes as the location card's, no row per passage, the caution behind the tooltip", () => {
  const fold = between(props, 'React.createElement(CardFold,{label:"Screenplay evidence"', '(dupIds && dupIds.length>1) && React.createElement("div",{className:"prop-dup-warn"}');
  assert.equal(fold.split("React.createElement(PropEvidenceBox,{").length - 1, 2, "reviewed passages, and the script's text");
  assert.ok(fold.includes('React.createElement("div",{className:"loc-sub prop-evi-box","data-role":"prop-evi-origin"}'));
  assert.ok(fold.includes('React.createElement("span",null,"Where it comes from")') && fold.includes('React.createElement("div",{className:"prop-evi-line"},propOriginLabel(p))'));
  assert.ok(fold.includes('title:"Reviewed passages · "+validSources.length+" of "+savedSources.length'));
  assert.ok(fold.includes('"In the script’s text · "'));
  assert.ok(fold.includes("even an exact phrase does not prove it is the same physical object."));
  for (const gone of ['className:"prop-evidence-row"', 'className:"prop-origin-label"', "prop-evidence-caution", 'React.createElement("details"', 'className:"prop-evidence-list"'])
    assert.ok(!fold.includes(gone), "gone from the section: " + gone);
  assert.ok(fold.includes("propEvidenceExcerpt(m.fullText,m.matchStart,m.matchEnd)"));
  // the styles: the buttons wrap and never grow past four rows; the passage never grows past a few lines
  assert.ok(css.includes(".prop-evi-chips{display:flex;flex-wrap:wrap;gap:5px;max-height:95px;overflow-y:auto}"));
  assert.ok(css.includes(".prop-evi-view .prop-evidence-quote{display:block;max-height:96px;overflow-y:auto;"));
  // the box itself is the shared rule's (.loc-sub is in its list): no border of its own here
  assert.ok(!/\.prop-evi-box\{[^}]*border/.test(css));
  assert.ok(/> \.sheet-fold-body > :is\([^)]*\.loc-sub[^)]*\)\{border:1px solid var\(--line\);border-radius:var\(--r-m\);padding:8px 10px;background:var\(--bg-2\)/.test(css));
});

await test("7 Frances knows it; the page loads the new files", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"Prop sheets have three views, and Screenplay evidence fits in one screen (Props, Art Room)"', '" });\n');
  for (const w of ["THREE TIMES", "a straight front view", "a side view, turned a full quarter turn", "never a bare line", "a close-up, zoomed far in", "keep working exactly as they are",
    "An edit keeps the layout the sheet already has", "'Where it comes from'", "'Reviewed passages'", "ONE passage at a time", "'Go to the scene'"]) assert.ok(f.includes(w), w);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic|Gemini|GPT/.test(f) && !/credit/i.test(f));   // "turn" the verb is fine
  assert.ok(!ai.includes("same 4-panel layout (hero, front, side, detail)") && ai.includes("the same 3-view layout (front, side, close-up)"));
  assert.ok(!ai.includes("expands to every match and the full passage"));
  for (const file of ["props.jsx", "ai.jsx", "styles.css"]) assert.ok(["20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-framing2"].some(k => html.includes(file + "?v=" + k + '"')), file + " has a current key");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

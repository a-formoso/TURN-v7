#!/usr/bin/env node
/* The road, step 3: fix the drifts by area (owner 2026-11-20: "use Claude to paint the picture by drawing on it …
   squares or target points of drift in that image, so we can then use the image model to regenerate it, but this time
   targeting those specific pixels"; "yes, build this road in that order").

   1 The QA read marks each drift it can place with a box (thousandths of the image); a drift that is "overall" has none.
   2 The report shows the boxes on the image, numbered like their lines, and offers "Fix these areas".
   3 The fix asks the engine for those areas only, and what is saved is the original with only those areas changed
     (the keep-the-original rule); when it cannot be done in place the person chooses, and nothing is saved unasked.

     node scripts/test-qa-area-fix.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const art = read("app/artroom.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css"), pk = read("app/pixel-keep.js"), html = read("TURN.html");

await test("1 the QA read gives a box to each drift it can place, and none to an 'overall' one; boxes are checked before they are kept", () => {
  const qa = between(ai, "async function aiImageQA(item){", "window.aiImageQA = aiImageQA;");
  assert.ok(qa.includes('"BOX = for every deviation that sits in ONE place, also give \\"box\\": [x0, y0, x1, y1] in thousandths of the image'));
  assert.ok(qa.includes("A fault that is 'overall' (the render style, the whole layout) or that you cannot place has NO box") && qa.includes("Never guess a box."));
  assert.ok(qa.includes('"deviations":[{"what":"...","where":"...","severity":"minor|major","box":[x0,y0,x1,y1]}]') && qa.includes('"specFix":"","box":[x0,y0,x1,y1]}]}'));
  assert.ok(qa.includes("...(qaBoxOf(d.box) ? { box:qaBoxOf(d.box) } : {}) })),") && ai.includes("...(qaBoxOf(r.box) ? { box:qaBoxOf(r.box) } : {}) });"));
  const b = { Array, Math, isFinite }; b.window = b;
  vm.runInNewContext(between(ai, "function qaBoxOf(b){", "window.qaBoxOf = qaBoxOf;") + "\nthis.f = qaBoxOf;", b);
  assert.deepEqual(plain(b.f([505.4, 280, 548, 330])), [505, 280, 548, 330]);
  assert.deepEqual(plain(b.f([548, 330, 505, 280])), [505, 280, 548, 330], "corners in any order");
  assert.deepEqual(plain(b.f([-20, 10, 300, 1200])), [0, 10, 300, 1000], "kept inside the picture");
  for (const bad of [null, "x", [1, 2, 3], [1, 2, 3, "4"], [NaN, 1, 2, 3], [10, 10, 12, 300], [0, 0, 1000, 1000], [0, 0, 900, 700]]) assert.equal(b.f(bad), null, JSON.stringify(bad));
});

const sb = { String, Number, Array, Math, JSON, Promise, console };
sb.window = sb; sb.toasts = []; sb.asked = [];
sb.appToast = (m, k) => sb.toasts.push([k || "info", m]);
vm.runInNewContext("let turnKeepOriginal;\n" + between(art, "function turnKeptSummary(meta){", "window.turnKeepOriginal = turnKeepOriginal;")
  + "\nthis.setKeep = (f) => { turnKeepOriginal = f; }; this.turnKeepOrAsk = turnKeepOrAsk; this.qaFixAreas = qaFixAreas; this.qaAreaFixInstruction = qaAreaFixInstruction; this.turnKeptSummary = turnKeptSummary;", sb);

await test("2 the areas of a report: every finding with a box, numbered, named by where and what; the engine is told each area", () => {
  const report = { deviations: [
      { what: "The licence badge is blank: the prompt asks for a small photo of him on it.", where: "front view", severity: "major", box: [505, 280, 548, 330] },
      { what: "The render style is more painterly than asked.", where: "overall", severity: "minor" },
      { what: "The flat cap is plain; the prompt asks for a herringbone weave that reads clearly even at this small size in every view.", where: "portrait", severity: "minor", box: [95, 130, 300, 270] } ],
    inventions: ["a second ring"],
    script: { mismatches: [{ fact: { field: "marks", value: "a pale scar along his left jaw" }, issue: "no scar", box: [110, 470, 180, 560] }, { fact: { field: "age", value: "sixties" }, issue: "looks forty" }] } };
  const areas = plain(sb.qaFixAreas(report));
  assert.deepEqual(areas.map(a => [a.n, a.kind, a.box]), [[1, "prompt", [505, 280, 548, 330]], [2, "prompt", [95, 130, 300, 270]], [3, "script", [110, 470, 180, 560]]]);
  assert.equal(areas[0].item, "front view: The licence badge is blank: the prompt asks for a small photo of…");
  assert.ok(areas[1].item.length <= 82 && areas[1].item.endsWith("…")); assert.equal(areas[2].item, "no scar");
  assert.deepEqual(plain(sb.qaFixAreas({ deviations: [{ what: "style", where: "overall" }] })), [], "nothing to fix in place");
  assert.deepEqual(plain(sb.qaFixAreas(null)), []);
  const ins = sb.qaAreaFixInstruction(sb.qaFixAreas(report));
  assert.match(ins, /^fix these faults, each ONLY inside its own area of the image: 1\) The licence badge is blank: the prompt asks for a small photo of him on it \(area: left 51%, top 28%, right 55%, bottom 33%\); 2\) /);
  assert.ok(ins.includes("3) it must match the screenplay: a pale scar along his left jaw (the image shows no scar) (area: left 11%, top 47%, right 18%, bottom 56%)"));
  assert.match(ins, /This is a small local change: do not redraw, restyle, re-light or re-pose anything\. Everything outside those areas stays exactly as it is$/);
  assert.match(sb.qaAreaFixInstruction(sb.qaFixAreas({ deviations: [report.deviations[0]] })), /^fix this fault, each ONLY/);
});

await test("3 what is saved is the original with only those areas changed; when it cannot be done the person chooses", async () => {
  const io = { baseUrl: "blob:orig", url: "data:engine" };
  let got = null;
  sb.setKeep(async (o) => { got = o; return { url: "data:kept", placed: [{ item: "a" }], skipped: [{ item: "b", why: "too large to add without redrawing" }],
    meta: { keptOriginal: true, keptKind: o.kind, keptItems: ["a"], keptLeftOut: ["b"], keptChangedPixels: 900, keptTotalPixels: 2359296 } }; });
  const r = plain(await sb.turnKeepOrAsk(io, { kind: "fix", items: ["a", "b"], found: [{ item: "a", boxes: [[1, 2, 30, 40]] }], maxPatch: 0.04, whose: "LIAQAT’s character sheet" }));
  assert.deepEqual(plain(got), { baseUrl: "blob:orig", url: "data:engine", items: ["a", "b"], found: [{ item: "a", boxes: [[1, 2, 30, 40]] }], kind: "fix", maxPatch: 0.04 }, "the report's own boxes go in: no second look at the image");
  assert.equal(r.url, "data:kept"); assert.equal(r.meta.keptKind, "fix");
  assert.deepEqual(sb.toasts.pop(), ["info", "Your image was kept as it was: 99.96% of its pixels are untouched. Fixed: a. Not fixed: b."]);
  // nothing could be placed: the person is asked, with both ways said plainly
  sb.setKeep(async () => ({ failed: "the new items could not be placed exactly", placed: [], skipped: [] }));
  sb.appConfirm = async (o) => { sb.asked.push(o); return false; };
  const no = plain(await sb.turnKeepOrAsk(io, { kind: "fix", items: ["a"], whose: "LIAQAT’s character sheet" }));
  assert.deepEqual(no, { discard: true, message: "LIAQAT’s character sheet was left as it is: the marked areas could not be placed exactly. The engine’s picture was not saved." });
  const q = sb.asked.pop();
  assert.equal(q.title, "The fix could not be made in place on LIAQAT’s character sheet"); assert.equal(q.cancelLabel, "Keep my image"); assert.equal(q.confirmLabel, "Use the engine’s picture");
  assert.match(q.body, /The image is already paid for either way\.$/);
  sb.appConfirm = async () => true;
  assert.deepEqual(plain(await sb.turnKeepOrAsk(io, { kind: "fix", items: ["a"], whose: "x" })), { url: "data:engine", meta: { keptOriginal: false, keptTried: true }, skipped: [] }, "on a yes, the engine's whole picture");
  // the wardrobe update speaks of an item and a sheet
  sb.appConfirm = async (o) => { sb.asked.push(o); return false; };
  const w = plain(await sb.turnKeepOrAsk(io, { items: ["ring"], whose: "Eshita’s sheet" }));
  assert.equal(sb.asked.pop().title, "The new item could not be added to Eshita’s sheet exactly"); assert.match(w.message, /^Eshita’s sheet was left as it is: the new items could not be placed exactly\./);
  assert.equal(sb.turnKeptSummary({ keptOriginal: true, keptKind: "fix", keptItems: [], keptLeftOut: [], keptChangedPixels: 10, keptTotalPixels: 1000 }), "Your image was kept as it was: 99.0% of its pixels are untouched. Fixed: the marked area.");
});

await test("4 the report shows the boxes on the image and offers the fix; the button's own run keeps the original", () => {
  const rep = between(art, "function QaReport({", "/* ---- QA button");
  assert.ok(rep.includes("scriptPart, onRecheck, imageUrl, onRunAreaFix }){"));
  assert.ok(rep.includes('"data-testid":"qa-areas"') && rep.includes('"Where it drifts"') && rep.includes('label:"About the marked areas"'));
  assert.ok(rep.includes('style:{ left:(a.box[0]/10)+"%", top:(a.box[1]/10)+"%", width:((a.box[2]-a.box[0])/10)+"%", height:((a.box[3]-a.box[1])/10)+"%" }'));
  assert.ok(rep.includes('"data-role":"qa-area-fix"') && rep.includes('areas.length===1 ? "Fix this area" : "Fix these "+areas.length+" areas"') && rep.includes("onClick:()=>{ onRunAreaFix(areas); onClose(); }"));
  assert.ok(rep.includes('React.createElement("span",{className:"qa-area-no",title:"Marked "+areaNo(d.box)+" on the image above"},areaNo(d.box))'), "a finding's line carries its box's number");
  assert.ok(art.includes('React.createElement("span",{className:"qa-area-no script",title:"Marked "+areaNo(m.box)+" on the image above"},areaNo(m.box))'), "…and a screenplay finding's too");
  const btn = between(art, "function QaCheckButton({", "window.QaCheckButton = QaCheckButton;");
  assert.ok(btn.includes("imageUrl: gen.genUrl,") && btn.includes("onRunAreaFix:(areas)=>gen.generate({ editInstruction:qaAreaFixInstruction(areas),"));
  assert.ok(btn.includes('keepOriginal:(io)=>turnKeepOrAsk(io, { kind:"fix", items:areas.map(a=>a.item), found:areas.map(a=>({ item:a.item, boxes:[a.box] })), maxPatch:0.04,'));
  assert.ok(art.includes("let found = Array.isArray(o.found) ? o.found : null;") && art.includes("const r = PK.pkCompose(orig, edit, placements, o.maxPatch ? { maxPatch:o.maxPatch } : undefined);"));
  assert.ok(pk.includes("const soft = clamp(Math.round(Math.min(rx1-rx0, ry1-ry0)*0.06), 2, 10);"), "a larger patch gets a softer edge");
  for (const k of [".qa-areas{position:relative;", ".qa-area{position:absolute;box-sizing:border-box;min-width:14px;min-height:14px;border:2px solid var(--win-amber,#F29A43);",
    ".qa-area.script{border-color:var(--win-err,var(--alert))}", ".qa-area-no.script{background:var(--win-err-fill,var(--alert));color:#fff}"]) assert.ok(css.includes(k), k);
});

await test("F Frances knows; nothing she is told names the codename; the changed files are served under a new key", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"QA check: the drifts are marked on the image and can be fixed by area (Art Room)"', "function appBrief(){");
  for (const k of ["'Where it drifts'", "'Fix these areas'", "pixel for pixel", "one image", "'Keep my image'", "'Use the engine's picture'", "no box", "'Check again'"]) assert.ok(f.includes(k), k);
  assert.ok(!/\bTURN\b|MUSE|McKee|Claude|Anthropic/.test(f));
  const KEYS = ["20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1"];   // (the list grows with each key bump)
  for (const file of ["pixel-keep.js", "artroom.jsx", "ai.jsx", "script.jsx", "styles.css"]) assert.ok(KEYS.some(k => html.includes("app/" + file + "?v=" + k + '"')), file);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

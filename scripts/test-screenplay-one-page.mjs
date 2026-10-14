#!/usr/bin/env node
/* test-screenplay-one-page.mjs — ONE SCREENPLAY IMAGE PER SCENE WHEN IT FITS (owner-approved 2026-10-14, "go ahead
   with all of it"). The screenplay page images that location plates, shots and the Stage attach used to spill 14 of
   Glass Hours' 16 scenes onto a near-empty second page (Furnace's six slots reached only 3 of its 10 scenes). Now:
   1. the layouts are tried in order and the first that fits the whole scene on one page wins — 15 px on 18 px lines
      with half the block spacing (1000×1294), a taller page (1000×1500), 14 px, then 13 px (the floor);
   2. a scene no layout fits takes the fewest pages any layout allows, on the most legible one, split EVENLY between
      blocks: a character cue stays with its lines, no page starts with spacing, never a near-empty last page;
   3. parentheticals keep their parentheses; the Stage's beat labels sit in the margin, not on rows of their own;
   4. Glass Hours: every scene is one page on all three renderers (locations, shots, Stage);
   5. a location plate attaches whole scenes only, in the slots its other references leave, and its reference count
      (the price of "Make what this scene needs") is what the generator really attaches — counted without drawing a
      page (review), for the room & time plates too;
   6. (review) every location plate sends its pages at 1536, never shrunk (the headless runs used 1024), and the Stage's
      page thumbnails keep each page's own shape (a long scene's page can be 1000×1500).
   Courier New's real advance (1229/2048 em) measures the text; the real canvas: test-screenplay-pages-browser.mjs.
   node scripts/test-screenplay-one-page.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const json = (x) => JSON.parse(JSON.stringify(x));
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));

/* a canvas that measures like Courier New and records what each page draws */
const ADV = 1229 / 2048;
const pxOf = (font) => { const m = String(font).match(/(\d+(?:\.\d+)?)px/); return m ? Number(m[1]) : 10; };
let pages = [];
function canvas(){
  const rec = [];
  const ctx = { font: "10px sans-serif", fillStyle: "", textAlign: "left",
    measureText(t){ return { width: String(t).length * pxOf(this.font) * ADV }; },
    fillRect(...a){ rec.push({ rect: a, style: this.fillStyle }); },
    fillText(t, x, y){ rec.push({ t: String(t), x, y, font: this.font, align: this.textAlign, style: this.fillStyle }); } };
  const c = { width: 0, height: 0, getContext: () => ctx,
    toDataURL(){ pages.push({ rec, w: c.width, h: c.height }); return "data:image/png;base64,PAGE" + pages.length; } };
  return c;
}
const box = { console, document: { createElement: () => canvas() }, window: null, _locTurn: (s) => s && s.turn || "",
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)) };
box.window = box; box.globalThis = box; vm.createContext(box);
const locSrc = read("app/locations.jsx");
vm.runInContext(locSrc.slice(locSrc.indexOf("function locationSceneForCoverageSheet("), locSrc.indexOf("function locationMasterPanelPlan(")), box, { filename: "app/locations.jsx#screenplay-pages" });
vm.runInContext(read("app/stage-screenplay-images.js"), box, { filename: "app/stage-screenplay-images.js" });
vm.runInContext(read("app/shot-scene-context.js"), box, { filename: "app/shot-scene-context.js" });
const LAYOUTS = vm.runInContext("LOC_SCREENPLAY_LAYOUTS", box);
const loc = (sceneObj, blocks, opts) => { pages = []; const scenes = [sceneObj], drafts = { [sceneObj.id]: { blocks } };
  const meta = box.locationScreenplayReferenceImages({ name: "Place" }, { sceneNos: [sceneObj.no] }, scenes, drafts, { returnMeta: true, pageLimit: 99, ...(opts || {}) });
  return { meta, pages: pages.slice() }; };
const bodyRows = (p) => p.rec.filter((r) => r.t != null && r.y > 62 && r.y < p.h - 60);

/* ---- 1. the table ---- */
assert.deepEqual(json(LAYOUTS), [
  { id: "15px-tight", font: 15, lineH: 18, spacing: 0.5, H: 1294 },
  { id: "15px-tall", font: 15, lineH: 18, spacing: 0.5, H: 1500 },
  { id: "14px", font: 14, lineH: 17, spacing: 0.5, H: 1500 },
  { id: "13px-floor", font: 13, lineH: 16, spacing: 0.4, H: 1500 }], "the layouts, in the order they are tried");
assert.ok(LAYOUTS.every((L) => L.H <= 1536), "never taller than the 1536 px a page reference is sent at (so never shrunk)");
const stageSrc = read("app/stage-screenplay-images.js");
for (const L of LAYOUTS) assert.ok(stageSrc.includes(`{id:"${L.id}",font:${L.font},lineH:${L.lineH},spacing:${L.spacing},height:${L.H}}`), "the Stage uses the same table: " + L.id);

/* ---- 2. the cascade on made-up scenes: an action block that wraps to 2 lines at every size ---- */
const act = (i) => ({ type: "action", text: "Block " + String(i).padStart(3, "0") + " — the quay is wet and the lamps come on one by one along the canal edge,"
  + " and the water slaps the stone steps below.", beat: 1 + Math.floor(i / 10) });
const sceneOf = (n, extra) => ({ blocks: [{ type: "scene", text: "EXT. QUAY — NIGHT", beat: 1 }, ...Array.from({ length: n }, (_, i) => act(i)), ...(extra || [])] });
const S = { id: "s-x", no: 7, title: "The Quay" };
{
  const two = box.locationScreenplayGroups([act(0)], S, LAYOUTS[3], { font: "", measureText(t){ return { width: String(t).length * pxOf(this.font) * ADV }; } }, null);
  assert.equal(two[0][0].rows.length, 2, "the made-up block is two lines even at 13 px");
}
const pick = (n) => loc(S, sceneOf(n).blocks).meta;
assert.equal(pick(20).layout, "15px-tight"); assert.equal(pick(20).pageCount, 1); assert.equal(pick(20).pageHeight, 1294);
assert.equal(pick(27).layout, "15px-tall", "a little too long: the taller page"); assert.equal(pick(27).pageCount, 1); assert.equal(pick(27).pageHeight, 1500);
assert.equal(pick(30).layout, "14px", "then 14 px"); assert.equal(pick(30).pageCount, 1);
assert.equal(pick(33).layout, "13px-floor", "then 13 px, the floor"); assert.equal(pick(33).pageCount, 1); assert.equal(pick(33).fontPx, 13);
// longer than any layout's page: the fewest pages, the most legible layout that allows them, split evenly
const heights = (r) => r.pages.map((p) => { const rows = bodyRows(p); return rows[rows.length - 1].y - rows[0].y; });
{
  const r = loc(S, sceneOf(40).blocks);
  assert.equal(r.meta.pageCount, 2); assert.equal(r.meta.layout, "15px-tight", "two pages at any size: the most legible");
  const n = r.pages.map((p) => bodyRows(p).filter((x) => /^Block /.test(x.t)).length);
  assert.deepEqual(n, [20, 20], "split evenly between blocks (greedy filling would leave 25 + 15)");
  const r52 = loc(S, sceneOf(52).blocks);
  assert.equal(r52.meta.pageCount, 2, "52 blocks: two taller pages rather than three");
  assert.equal(r52.meta.layout, "15px-tall");
  assert.deepEqual(r52.pages.map((p) => bodyRows(p).filter((x) => /^Block /.test(x.t)).length), [26, 26], "not 30 + 22, never 25 + 25 + 2");
  const r100 = loc(S, sceneOf(100).blocks);
  const h = heights(r100);
  assert.ok(Math.max(...h) - Math.min(...h) <= 60, "pages within about a block of each other: " + h.join(", "));
  assert.ok(Math.min(...h) >= 0.75 * Math.max(...h), "no near-empty tail");
}
// a page never starts with block spacing; a character cue is never the last thing on a page
{
  const talk = [];
  for (let i = 0; i < 70; i++) { talk.push({ type: "char", text: i % 2 ? "LUCA" : "GRAZIELLA", beat: 1 }); talk.push({ type: "dia", text: "Line " + i + " — the boat leaves at twenty past, and I am not on it tonight.", beat: 1 }); }
  const r = loc(S, [{ type: "scene", text: "INT. FURNACE — NIGHT" }, ...talk]);
  assert.ok(r.meta.pageCount >= 2);
  r.pages.forEach((p, i) => {
    const rows = bodyRows(p);
    assert.notEqual(rows[rows.length - 1].x, 378, "page " + (i + 1) + " doesn't end on a character cue");
    if (i) { const L = LAYOUTS.find((x) => x.id === r.meta.layout); assert.equal(rows[0].y, 66 + Math.round(L.lineH * 0.78), "page " + (i + 1) + " starts at the top, no spacing"); }
  });
}
// the scene heading carries its number once; parentheticals keep their parentheses
{
  const r = loc(S, [{ type: "scene", text: "INT. FURNACE — DAWN" }, { type: "char", text: "GRAZIELLA" }, { type: "paren", text: "under her breath" }, { type: "dia", text: "Again." },
    { type: "char", text: "LUCA" }, { type: "paren", text: "(beat)" }, { type: "dia", text: "Again." }]);
  const t = bodyRows(r.pages[0]).map((x) => x.t);
  assert.equal(t[0], "7 INT. FURNACE — DAWN");
  assert.ok(t.includes("(under her breath)") && t.includes("(beat)"), "parentheses back, never doubled: " + t.join(" | "));
  const r2 = loc(S, [{ type: "scene", text: "12 INT. FURNACE — DAWN" }, { type: "action", text: "Heat." }]);
  assert.equal(bodyRows(r2.pages[0])[0].t, "12 INT. FURNACE — DAWN", "a numbered heading is drawn as written (it used to vanish)");
}
// counting without drawing
{
  pages = [];
  const c = box.locationScreenplayReferenceImages({ name: "Place" }, { sceneNos: [7] }, [S], { [S.id]: sceneOf(40) }, { countOnly: true });
  assert.equal(c.pageCount, 2); assert.equal(c.images.length, 0); assert.equal(pages.length, 0, "countOnly draws nothing");
}

/* ---- 3. Glass Hours: one page per scene on all three renderers ---- */
const order = film.scenes.slice().sort((a, b) => a.no - b.no);
const stageText = (blocks) => blocks.filter((b) => String(b.text || "").trim()).map((b) => (b.beat != null ? "[BEAT " + b.beat + " · " + String(b.type || "action").toUpperCase() + "]" : "[" + String(b.type || "action").toUpperCase() + "]") + " " + b.text).join("\n");
let parens = 0;
for (const sc of order) {
  const blocks = film.drafts[sc.id].blocks;
  pages = [];
  const m = box.locationScreenplayReferenceImages({ name: "x" }, { sceneNos: [sc.no] }, film.scenes, film.drafts, { returnMeta: true, pageLimit: 99 });
  assert.equal(m.pageCount, 1, "scene " + sc.no + " is one location page");
  assert.equal(m.layout, "15px-tight", "scene " + sc.no + " fits the first layout");
  const p = pages[0];
  assert.equal(p.h, 1294); assert.equal(p.w, 1000);
  const rows = bodyRows(p);
  assert.ok(rows.every((x) => x.y <= p.h - 64), "scene " + sc.no + ": nothing below the body");
  const paren = blocks.filter((b) => b.type === "paren").map((b) => "(" + b.text.replace(/^\(|\)$/g, "") + ")");
  paren.forEach((t) => assert.ok(rows.some((x) => x.t.includes(t.slice(0, 20))), "scene " + sc.no + " shows " + t));
  parens += paren.length;
  // the Stage
  pages = [];
  const st = box.stageScreenplayImages({ signature: "sig-" + sc.id, hasSource: true, fullText: stageText(blocks), targetBeats: [1], errors: [], sceneNo: sc.no, sceneTitle: sc.title });
  assert.deepEqual(json(st.errors), []);
  assert.equal(st.images.length, 1, "scene " + sc.no + " is one Stage page");
  assert.equal(st.images[0].layout, "15px-tight"); assert.equal(st.images[0].height, 1294);
  const srec = pages[0].rec.filter((x) => x.t != null);
  assert.ok(!srec.some((x) => /^\[BEAT /.test(x.t)), "scene " + sc.no + ": no beat label rows");
  const labels = srec.filter((x) => /^BEAT \d+$/.test(x.t));
  assert.ok(labels.length >= 1 && labels.every((x) => x.x === 60 && x.align === "right"), "the beat labels sit in the left margin");
  const beats = [...new Set(blocks.filter((b) => String(b.text || "").trim()).map((b) => b.beat))];
  assert.equal(labels.length, beats.length, "scene " + sc.no + ": one label where each beat starts");
  labels.forEach((lab) => assert.ok(srec.some((x) => x.y === lab.y && x.x >= 78 && !/^BEAT /.test(x.t)), "beside its block's first line"));
  if (blocks.some((b) => b.type === "paren")) assert.ok(srec.some((x) => /^\(.*\)$/.test(x.t)), "the Stage's parentheticals too");
}
assert.ok(parens >= 30, "Glass Hours' parentheticals checked: " + parens);
// a shot's screenplay context: one page, the target beat highlighted
{
  const sc = order[2], blocks = film.drafts[sc.id].blocks;
  const sh = { id: "shot-1", sceneId: sc.id, beatN: 2 };
  const ctx = { filmId: "glass", scene: sc, location: null, drafts: film.drafts };
  const plan = box.shotSceneContextPlan(sh, ctx);
  pages = [];
  const res = await box.shotSceneContextReferences(plan, ctx, { maxPages: 2 });
  assert.equal(res.pages, 1); assert.equal(res.refs.length, 1, "one page ref for a whole Glass Hours scene");
  assert.ok(pages[0].rec.some((x) => x.rect && x.style === "#ead58b"), "the target beat is highlighted");
  assert.ok(pages[0].rec.some((x) => /TARGET BEAT OPENING — BEAT 2/.test(x.t || "")));
  assert.ok(blocks.length > 10);
}
// a long Stage scene splits evenly too (the margin label never makes a row)
{
  const long = Array.from({ length: 120 }, (_, i) => "[BEAT " + (1 + Math.floor(i / 12)) + " · ACTION] Line " + i + " — the quay is wet and the lamps come on one by one along the canal edge, the water slapping the steps below.").join("\n");
  pages = [];
  const st = box.stageScreenplayImages({ signature: "long", hasSource: true, fullText: long, targetBeats: [3], errors: [], sceneNo: 9, sceneTitle: "Long" });
  assert.ok(st.images.length >= 2);
  const counts = pages.map((p) => p.rec.filter((x) => /^Line \d+/.test(x.t || "")).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "even Stage pages: " + counts.join(", "));
}

/* the whole of locations.jsx, for the page references and the generators */
const full = { console, setTimeout, clearTimeout, localStorage: { getItem: () => null }, dispatchEvent: () => true, CustomEvent: class {},
  scenesInStoryOrder: box.scenesInStoryOrder, renderStyleText: () => "Photoreal", document: { createElement: () => canvas() }, nbEpoch: () => 1,
  cropRegionAsDataUrl: async (u) => "data:crop:" + u, oaiToDataUrl: async (u) => u };
full.window = full; vm.createContext(full);
vm.runInContext(locSrc, full, { filename: "app/locations.jsx" });

/* ---- 4. whole scenes in the slots a plate leaves ---- */
{
  const scenes = [{ id: "a", no: 1 }, { id: "b", no: 2 }, { id: "c", no: 3 }];
  const drafts = { a: sceneOf(5), b: sceneOf(40), c: sceneOf(6) };
  const l = { id: "L", name: "Quay", scenes: ["a", "b", "c"] };
  const refs = (cap) => json(full.locationScriptPageRefs(l, scenes, drafts, cap).map((r) => r.label));
  assert.deepEqual(refs(6), ["Scene 01 p1", "Scene 02 p1", "Scene 02 p2", "Scene 03 p1"]);
  assert.deepEqual(refs(3), ["Scene 01 p1", "Scene 02 p1", "Scene 02 p2"]);
  assert.deepEqual(refs(2), ["Scene 01 p1", "Scene 03 p1"], "a two-page scene with one slot left is skipped whole; the next one-page scene still fits");
  assert.deepEqual(refs(0), []);
  const r6 = full.locationScriptPageRefs(l, scenes, drafts, 6);
  assert.deepEqual(json(r6.map((r) => [r.sceneId, r.scenePage, r.scenePages])), [["a", 1, 1], ["b", 1, 2], ["b", 2, 2], ["c", 1, 1]]);
  // the card, once its other references are known (locations-ui.jsx attachments)
  assert.deepEqual(json(full.locationWholeScenePages(r6, 3).map((r) => r.label)), ["Scene 01 p1", "Scene 02 p1", "Scene 02 p2"]);
  assert.deepEqual(json(full.locationWholeScenePages(r6, 2).map((r) => r.label)), ["Scene 01 p1", "Scene 03 p1"]);
  assert.deepEqual(json(full.locationWholeScenePages(r6.filter((r) => r.label !== "Scene 02 p2"), 2).map((r) => r.label)), ["Scene 01 p1", "Scene 02 p1"], "what's left of a page the viewer unticked still counts as its own run");
  assert.deepEqual(json(full.locationWholeScenePages(r6, 0)), []);
  // (review) the price counts the same whole scenes without drawing a page; every page goes at its own size
  for (const cap of [0, 1, 2, 3, 4, 5, 6]) {
    pages = [];
    assert.equal(full.locationScriptPageCount(l, scenes, drafts, cap), full.locationScriptPageRefs(l, scenes, drafts, cap).length, "cap " + cap);
    pages = []; full.locationScriptPageCount(l, scenes, drafts, cap);
    assert.equal(pages.length, 0, "counting draws nothing");
  }
  assert.ok(r6.every((r) => r.maxDim === 1536), "a page is sent at its own size, never shrunk");
}

/* ---- 5. the plate's reference count is what its generator attaches (Glass Hours, every location) ---- */
{
  const locations = film.locations.map((l) => ({ ...l }));
  const by = (id) => locations.find((l) => l.id === id);
  by("loc-fondamenta-dei-vetrai-4").parentLocation = { id: "loc-fondamenta-3", key: "fondamenta", name: "Fondamenta" };
  by("loc-furnace-office-2").parentLocation = { id: "loc-furnace-1", key: "furnace", name: "Furnace" };
  full.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: full.deriveSluglineUnits(film.scenes, film.drafts) };
  full.TURN_DATA = { PROJECT: film.project };
  const metas = {}, images = {};
  for (const l of locations) if (l.spatialPlan) { metas[l.id] = { iso: "2026-10-13T10:00:00Z", spatialPlanSig: full.locationSpatialPlanSig(l.spatialPlan) }; images[l.id] = "https://cdn/plate-" + l.id + ".png"; }
  const sent = [];
  Object.assign(full, { nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "",
    nbGenerate: async (prompt, o) => { sent.push(o); return "https://img/new.png"; }, nbCommit: async () => ({ tier: "cloud" }), nbGetRes: () => "2K", nbGetModel: () => "gemini-nano-banana-2.1" });
  const report = [];
  for (const l of locations) {
    let count;
    try { count = full.locationPlateRefCount(l); } catch (e) { count = null; }
    sent.length = 0;
    let made = false;
    try { made = await full.generateLocationPlate(l, film.project, {}); } catch (e) { made = false; }
    if (!made) { assert.equal(count.exact, false, l.name + ": a plate that can't be made is priced as 'up to'"); continue; }
    const attached = (sent[0].extraImages || []).length;
    assert.equal(count.exact, true, l.name);
    assert.equal(count.n, attached, l.name + ": the count is the references the plate really attaches");
    report.push(l.name + " " + attached);
  }
  // (review) the headless plate sends its pages at 1536 like the card (they were shrunk to 1024 there)
  sent.length = 0;
  assert.equal(await full.generateLocationPlate(by("loc-furnace-1"), film.project, {}), true);
  { const o = sent[0], dims = Array.from(o.extraImageMaxDims || []);
    assert.equal(dims.length, o.extraImages.length);
    assert.ok(o.extraImages.every((u, i) => !/^data:image\/png;base64,PAGE/.test(u) || dims[i] === 1536), "every page at 1536: " + dims.join(","));
    assert.ok(o.extraImages.some((u) => /^data:image\/png;base64,PAGE/.test(u))); }
  // a room & time plate: the count (no drawing) is what its generator attaches, its pages at 1536
  const unitReport = [];
  for (const l of locations.filter((x) => x.spatialPlan)) {
    for (const u of full.turnContinuity.sluglineUnits.filter((u) => u && !u.orphan && String(u.subspaceKey || u.locationKey || "") === l.key)) {
      sent.length = 0; pages = [];
      const n = full.sluglineUnitPlateRefCount(l, u, { rootPlate: true }).n;
      assert.equal(pages.length, 0, "the unit's count draws nothing");
      if (!(await full.generateSluglineUnitPlate(l, u, film.project, {}))) continue;
      const o = sent[0], dims = Array.from(o.extraImageMaxDims || []);
      assert.equal(n, o.extraImages.length, l.name + " · " + u.key + ": the count is what the unit plate attaches");
      o.extraImages.forEach((url, i) => { if (/^data:image\/png;base64,PAGE/.test(url)) assert.equal(dims[i], 1536, "a unit's page at 1536"); });
      unitReport.push(u.key + " " + n);
    }
  }
  assert.ok(unitReport.length >= 3, "room & time plates checked: " + unitReport.join(", "));
  const furnace = full.locationScriptPageRefs(by("loc-furnace-1"), null, null, 6 - full.locationPlateFixedRefCount(by("loc-furnace-1")).n);
  assert.ok(furnace.length >= 5 && furnace.every((r) => r.scenePages === 1), "Furnace: one page per scene — " + furnace.length + " of its 10 scenes (3 before)");
  console.log("  references attached: " + report.join(", "));
}

/* ---- 6. the Stage's page thumbnails keep each page's own shape (a long scene's page can be 1000×1500) ---- */
{
  const css = read("app/stage-screenplay.css");
  assert.match(css, /\.stage2-screenplay-page-button img\{[^}]*aspect-ratio:auto 1000\/1294;object-fit:contain\}/, "the 1294 shape only until the page loads, never cropped");
  assert.ok(stageSrc.includes("ctx.fillText(item.label,LABEL_RIGHT,y,LABEL_RIGHT-8);"), "a long beat label is narrowed into the margin");
}

console.log("PASS one screenplay image per scene: the layouts in order (1294 → 1500 → 14 px → 13 px), even splits between blocks, parentheses back, the Stage's beat labels in the margin, all 16 Glass Hours scenes on one page (locations, shots, Stage), whole scenes in a plate's free slots and a reference count that matches");

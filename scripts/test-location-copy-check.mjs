#!/usr/bin/env node
/* test-location-copy-check.mjs — THE COPY CHECK (owner-approved 2026-10-14, "go ahead with all of it").
   A sub-space's plate (Glass Hours' "Fondamenta DEI Vetrai") came back with two panels that were near-copies of its
   parent's sheet. Now, once a sub-space's plate (or its room & time or state plate — a sub-space has no extra-space
   plates) is made, each of its panels is compared IN THE BROWSER with each panel of the parent's plate, and a near-copy says "This panel looks like
   <parent>'s sheet — regenerate?" with Regenerate (its price) and Keep. Pinned here:
   1. the maths (locations.jsx "THE COPY CHECK"): normalising, the high-pass that drops the sky/ground split, the
      shift search, a flat image matching nothing;
   2. the threshold on the fixtures (scripts/fixtures/copy-check-plates.js): every near-identical re-render is caught
      and matched to the panel it copies; no genuinely different, neighbouring or other view is; the documented
      numbers are the code's; a 2x2 plate is read panel by panel;
   3. the record on the plate's meta (locationCopyCheckMeta / locationCopyCheckCurrent): this version against the
      parent's current version; never in the way of a save (a failure or a slow check records nothing);
   4. the generators: the card's metaExtra and the headless runs record it before the save, and NOTHING spends on its
      own — a near-copy never triggers a second image; the headless runs (the Location Scout, "Make what this scene
      needs") pass the STORED card — a parentKey, no parentLocation — and record it too (2026-10-14, headless paths);
   5. the notice (locations-ui.jsx LocationCopyCheckNotice): the copy, Regenerate with its price, Keep recorded on the
      meta (imagegen.jsx nbSetAssetCopyCheck — this version only), checked once a session when nothing was recorded;
   6. the wiring on the three cards (the room's plate, its states, its rooms & times — never an extra space, which only
      a main location has) and Frances's manifest;
   7. (review) the whole check — loading the parent's plate too — inside its time limit; a parent's plate decoded once
      for several checks and a failed read tried again; Regenerate blocked exactly when the card's own Generate is
      (running, an unsaved image waiting for its save, the layout / parent plate / script not ready).
   No browser, no provider: a fake canvas-free pixel path, recording stubs. (The real canvas path:
   scripts/test-screenplay-pages-browser.mjs.)
   node scripts/test-location-copy-check.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const json = (x) => JSON.parse(JSON.stringify(x));
const noop = () => {};

/* ---- the harness: locations.jsx + locations-ui.jsx with a recording React ---- */
let hooks = [], cursor = 0, effects = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState: (init) => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof init === "function" ? init() : init;
    return [hooks[i], (v) => { hooks[i] = typeof v === "function" ? v(hooks[i]) : v; }]; },
  useReducer: (fn, init) => { const i = cursor++; if (!(i in hooks)) hooks[i] = init; return [hooks[i], () => { hooks[i] = fn(hooks[i]); }]; },
  useRef: (init) => { const i = cursor++; return hooks[i] || (hooks[i] = { current: init }); },
  useEffect: (fn, deps) => { const i = cursor++; effects.push(fn); hooks[i] = deps; },
};
const listeners = {};
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null },
  Icon: new Proxy({}, { get: () => noop }),
  addEventListener: (t, h) => { (listeners[t] = listeners[t] || []).push(h); },
  removeEventListener: (t, h) => { listeners[t] = (listeners[t] || []).filter((x) => x !== h); },
  dispatchEvent: () => true, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal", nbEpoch: () => 1 };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
vm.runInContext(read("app/locations-ui.jsx"), box, { filename: "app/locations-ui.jsx" });
vm.runInContext(read("scripts/fixtures/copy-check-plates.js"), box, { filename: "scripts/fixtures/copy-check-plates.js" });
const C = vm.runInContext("LOC_COPY_CHECK", box);
const F = box.copyCheckFixtures;
const fn = (name) => vm.runInContext(name, box);

/* ---- 1. the maths ---- */
{
  const Z = fn("_locCopyZ"), HP = fn("_locCopyHighPass"), W = fn("_locCopyWindows"), best = fn("_locCopyBest"), win = fn("_locCopyWindow");
  const z = Z(Float64Array.from([1, 2, 3, 4, 5]));
  assert.ok(Math.abs(z.reduce((a, b) => a + b, 0)) < 1e-9 && Math.abs(z.reduce((a, b) => a + b * b, 0) / 5 - 1) < 1e-9, "zero mean, unit variance");
  assert.deepEqual(Array.from(Z(new Float64Array(9).fill(7))), new Array(9).fill(0), "a flat window is all zeros — it correlates with nothing");
  // a sky / ground split (the brightness every exterior shares) is what the high-pass removes
  const n = 24, split = new Float64Array(n * n).map((_, i) => (Math.floor(i / n) < 12 ? 200 : 60));
  const varOf = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length; };
  const hp = HP(split, n, 3);
  const inner = []; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (y < 8 || y > 15) inner.push(hp[y * n + x]);
  assert.ok(inner.every((v) => Math.abs(v) < 1e-9), "away from the line itself, a sky/ground split leaves nothing");
  assert.ok(varOf(Array.from(hp)) < varOf(Array.from(split)) / 4, "…and most of its weight is gone");
  // the shift search: a grid moved by one cell still matches itself exactly
  const g = Float64Array.from({ length: n * n }, (_, i) => Math.sin(i * 0.37) * 50 + (i % 7) * 9);
  const moved = new Float64Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) moved[y * n + x] = g[y * n + Math.min(n - 1, x + 1)];
  const centre = Z(win(g, n, 2, 2, 20));
  assert.ok(Math.abs(best(centre, W(g, n, 2)) - 1) < 1e-9, "a grid against itself: 1");
  assert.ok(best(centre, W(moved, n, 2)) > 0.999, "moved one cell: the search finds it");
  // a flat image is never a copy of anything
  const flat = { px: new Uint8ClampedArray(64 * 36 * 4).fill(128), w: 64, h: 36 };
  const one = F.cases(1);
  const r = box.locationCopyCheckPixels(flat, one.parent, { single: true });
  assert.equal(r.near, false); assert.ok(r.panels[0].detail <= 0, "a flat frame scores nothing");
  // the parent's plate against itself, panel by panel: every panel is its own copy
  const self = box.locationCopyCheckPixels(one.parent, one.parent, {});
  assert.deepEqual(json(self.panels.map((p) => [p.key, p.match, p.near])), [["TL", "TL", true], ["TR", "TR", true], ["BL", "BL", true], ["BR", "BR", true]]);
  assert.ok(self.panels.every((p) => p.detail > 0.999 && p.layout > 0.999));
  assert.deepEqual(Object.keys(self).sort(), ["kind", "near", "panels", "v"]);
  assert.equal(self.kind, "2x2"); assert.equal(self.v, 1);
}

/* ---- 2. the threshold on the fixtures ---- */
assert.equal(C.detail, 0.6); assert.equal(C.layout, 0.62);
const locSrc = read("app/locations.jsx");
assert.match(locSrc, /A NEAR-COPY: detail ≥ 0\.60 AND layout ≥ 0\.62/, "the documented threshold is the code's");
const stats = { copy: [], different: [], neighbour: [], other: [], night: [] };
let twoByTwo = 0;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const c = F.cases(seed);
  const one = (img) => box.locationCopyCheckPixels(img, c.parent, { single: true });
  for (const x of c.copies) { const r = one(x.img); assert.equal(r.kind, "single"); const p = r.panels[0];
    assert.ok(p.near, x.label + " is caught: detail " + p.detail + ", layout " + p.layout);
    assert.equal(p.match, x.of, x.label + " is matched to the panel it copies"); stats.copy.push(p); }
  for (const x of c.different) { const p = one(x.img).panels[0]; assert.ok(!p.near, x.label + " is not a copy: " + p.detail + "/" + p.layout); stats.different.push(p); }
  for (const x of c.neighbours) { const p = one(x.img).panels[0]; assert.ok(!p.near, x.label + " is not a copy: " + p.detail + "/" + p.layout); stats.neighbour.push(p); }
  { const p = one(c.other.img).panels[0]; assert.ok(!p.near, c.other.label); stats.other.push(p); }
  for (const x of c.night) stats.night.push(one(x.img).panels[0]);
  // a 2x2 plate: top-left copies the parent's top-right, bottom-right its bottom-left; the other two are other views
  if (seed <= 3) {
    const pick = (lab) => c.copies.find((x) => x.label.endsWith(lab)).img;
    const child = F.sheet(388, 220, [pick("TR v0"), c.different[0].img, c.neighbours[0].img, pick("BL v1")]);
    const r = box.locationCopyCheckPixels(child, c.parent, {});
    assert.deepEqual(json(r.panels.map((p) => [p.key, p.near])), [["TL", true], ["TR", false], ["BL", false], ["BR", true]], "seed " + seed);
    assert.equal(r.panels[0].match, "TR"); assert.equal(r.panels[3].match, "BL"); assert.equal(r.near, true);
    twoByTwo++;
  }
}
const min = (a, k) => Math.min(...a.map((p) => p[k])), max = (a, k) => Math.max(...a.map((p) => p[k]));
const negatives = [...stats.different, ...stats.neighbour, ...stats.other];
// each side clears the line by a margin: the weakest copy and the closest other view
const copyMargin = Math.min(min(stats.copy, "detail") - C.detail, min(stats.copy, "layout") - C.layout);
const otherMargin = Math.min(...negatives.map((p) => Math.max(C.detail - p.detail, C.layout - p.layout)));
assert.ok(copyMargin >= 0.04, "the weakest copy clears the line by " + copyMargin.toFixed(3));
assert.ok(otherMargin >= 0.04, "the closest other view stays under it by " + otherMargin.toFixed(3));
// the documented numbers (locations.jsx comment): copies ≥ 0.66 / ≥ 0.68; the closest others 0.63/0.56 and 0.55/0.90
assert.ok(min(stats.copy, "detail") >= 0.66 && min(stats.copy, "layout") >= 0.68, "copies: detail ≥ 0.66 and layout ≥ 0.68");
assert.ok(negatives.every((p) => !(p.detail >= 0.635 && p.layout >= 0.565)) && max(negatives, "detail") < 0.64);
assert.equal(stats.copy.length, 96); assert.equal(stats.different.length, 48); assert.equal(stats.neighbour.length, 32); assert.equal(stats.other.length, 8);
// the documented limit: a copy re-lit for night is usually NOT caught
const nightCaught = stats.night.filter((p) => p.near).length;
assert.ok(nightCaught < stats.night.length / 2, "night copies caught: " + nightCaught + " of " + stats.night.length + " (documented as usually not)");
assert.match(locSrc, /Known limit: a copy re-lit for another time of day \(dark sky and water\) is\n\s+usually NOT caught \(8 of 32 in the fixtures\)/);
assert.equal(nightCaught, 8, "the documented count");

/* ---- 3. the record on the plate's meta ---- */
const parent = { id: "loc-parent", key: "fondamenta", name: "Fondamenta" };
const sub = { id: "loc-sub", key: "fondamenta-dei-vetrai", name: "Fondamenta DEI Vetrai", parentLocation: { id: parent.id, key: parent.key, name: parent.name } };
const images = {}, metas = {};
let reads = 0, checks = 0, checkImpl = null;
Object.assign(box, { nbGetImage: (id) => { reads++; return images[id] || ""; }, nbGetMeta: (id) => metas[id] || null, nbLoadImage: async (id) => images[id] || "" });
const realCheck = box.locationCopyCheck;
box.locationCopyCheck = async (...a) => { checks++; return checkImpl ? checkImpl(...a) : null; };
const nearResult = { v: 1, kind: "2x2", near: true, panels: [
  { key: "TL", match: "TL", detail: 0.21, layout: 0.4, near: false }, { key: "TR", match: "TL", detail: 0.91, layout: 0.88, near: true },
  { key: "BL", match: "BL", detail: 0.83, layout: 0.79, near: true }, { key: "BR", match: "BR", detail: 0.3, layout: 0.5, near: false }] };
{
  assert.deepEqual(json(await box.locationCopyCheckMeta({ id: "main", name: "Main" }, "img", "i1")), {}, "a main location: nothing");
  assert.equal(checks, 0);
  assert.deepEqual(json(await box.locationCopyCheckMeta(sub, "img", "i1")), {}, "no parent plate yet: nothing recorded");
  images[parent.id] = "parent-plate"; metas[parent.id] = { iso: "p1" };
  checkImpl = async (child, parentUrl, opts) => { assert.equal(child, "new-plate"); assert.equal(parentUrl, "parent-plate"); assert.ok(!opts || !opts.single); return nearResult; };
  const m = await box.locationCopyCheckMeta(sub, "new-plate", "s1");
  assert.deepEqual(json(m), { copyCheck: { ...nearResult, iso: "s1", parentId: parent.id, parentIso: "p1" } }, "this plate version against that parent version");
  checkImpl = async (c, p, opts) => { assert.equal(opts.single, true, "a single-frame plate"); return { ...nearResult, kind: "single" }; };
  assert.equal((await box.locationCopyCheckMeta(sub, "new-plate", "s1", { single: true })).copyCheck.kind, "single");
  // (2026-10-14, headless paths) the STORED card — a parentKey, no parentLocation — finds its parent in the film's list
  checkImpl = async () => nearResult;
  const keepC = box.turnContinuity;
  const stored = { id: "loc-sub", key: "fondamenta-dei-vetrai", name: "Fondamenta DEI Vetrai", parentKey: "fondamenta" };
  box.turnContinuity = { locations: [parent, stored] };
  assert.deepEqual(json(await box.locationCopyCheckMeta(stored, "new-plate", "s1")), { copyCheck: { ...nearResult, iso: "s1", parentId: parent.id, parentIso: "p1" } },
    "the stored card's check is recorded");
  box.turnContinuity = { locations: [stored] };
  assert.deepEqual(json(await box.locationCopyCheckMeta(stored, "new-plate", "s1")), {}, "its parent not in the film: nothing");
  box.turnContinuity = keepC;
  checkImpl = async () => { throw new Error("decode failed"); };
  assert.deepEqual(json(await box.locationCopyCheckMeta(sub, "new-plate", "s1")), {}, "a failing check records nothing — the save goes on");
  const slow = C.timeoutMs; C.timeoutMs = 30;
  checkImpl = () => new Promise(() => {});
  const t0 = Date.now();
  assert.deepEqual(json(await box.locationCopyCheckMeta(sub, "new-plate", "s1")), {}, "a slow check records nothing");
  assert.ok(Date.now() - t0 < 1000, "…and never holds the save up for long");
  C.timeoutMs = slow;
  assert.equal(slow, 4000);
  // (review) loading the parent's plate is inside the time limit too — a cloud read that hangs never holds the save up
  { const keepImg = images[parent.id], keepLoad = box.nbLoadImage; delete images[parent.id];
    box.nbLoadImage = () => new Promise(() => {}); C.timeoutMs = 30; checks = 0;
    const t1 = Date.now();
    assert.deepEqual(json(await box.locationCopyCheckMeta(sub, "new-plate", "s1")), {}, "a parent plate that never loads records nothing");
    assert.ok(Date.now() - t1 < 1000, "…within the time limit"); assert.equal(checks, 0);
    C.timeoutMs = slow; box.nbLoadImage = keepLoad; images[parent.id] = keepImg; }
  // the recorded check counts for this version against the parent's CURRENT plate only
  const cur = box.locationCopyCheckCurrent;
  const rec = { iso: "s1", copyCheck: { ...nearResult, iso: "s1", parentIso: "p1" } };
  assert.ok(cur(rec, { iso: "p1" }));
  assert.equal(cur(rec, { iso: "p2" }), null, "the parent's plate was regenerated: check again");
  assert.equal(cur({ ...rec, iso: "s2" }, { iso: "p1" }), null, "an older version's check");
  assert.equal(cur({ iso: "s1", copyCheck: { ...rec.copyCheck, v: 0 } }, { iso: "p1" }), null, "another version of the maths");
  assert.equal(cur({ iso: "s1" }, { iso: "p1" }), null);
  // no canvas here: the browser wrapper reads nothing and says nothing
  assert.equal(await realCheck("a", "b"), null);
  // (review) the browser path: a parent's plate is read once for several checks; a failed read is tried again
  { const made = [];
    box.Image = class { constructor(){ this.naturalWidth = 0; this.naturalHeight = 0; }
      set src(v){ made.push(v); setTimeout(() => { if (/bad/.test(v)) { this.onerror && this.onerror(); return; }
        this.naturalWidth = 768; this.naturalHeight = 432; this.onload && this.onload(); }, 0); } };
    box.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage(){},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 7) % 251) }) }) }) };
    const a = await realCheck("data:image/png;base64,CHILD-A", "data:image/png;base64,PARENT");
    const b = await realCheck("data:image/png;base64,CHILD-B", "data:image/png;base64,PARENT");
    assert.ok(a && b && a.panels.length === 4, "both checked");
    assert.equal(made.filter((u) => /PARENT/.test(u)).length, 1, "the parent's plate decoded once for both");
    assert.equal(await realCheck("data:image/png;base64,CHILD-A", "data:image/png;base64,bad"), null);
    assert.equal(await realCheck("data:image/png;base64,CHILD-A", "data:image/png;base64,bad"), null);
    assert.equal(made.filter((u) => /bad/.test(u)).length, 2, "a read that failed isn't kept — it is tried again");
    delete box.Image; delete box.document; }
}

/* ---- 4. the generators record it before the save; nothing spends on its own ---- */
{
  const ui = read("app/locations-ui.jsx"), art = read("app/artroom.jsx");
  assert.match(art, /await opts\.metaExtra\(\{ mode, refsUsed, prompt: sentPrompt, url, iso: meta\.iso \}\)/, "the new image and its version reach metaExtra");
  assert.match(ui, /\.\.\.\(l\.parentLocation&&typeof locationCopyCheckMeta==="function"\?await locationCopyCheckMeta\(l,url,iso\):\{\}\)/, "the room's plate card");
  assert.equal((ui.match(/metaExtra:async \(\{mode,url,iso\}\)=> _withCopyCheck\(l,url,iso,_withLayoutStamp\(/g) || []).length, 2, "the state and room & time cards");
  // an extra space belongs to a main location (it has no parent plate): its card records no check (2026-10-14)
  const cov = ui.slice(ui.indexOf("function LocationCoverageSheet("), ui.indexOf("function CoverageReferenceStrip("));
  assert.ok(cov.includes("metaExtra:async ({mode,url,iso})=> _withLayoutStamp(l,mode,gen,") && !/_withCopyCheck|LocationCopyCheckNotice/.test(cov), "the extra-space card");
  // _withCopyCheck: a sub-space's single frame, else the meta untouched
  checks = 0; checkImpl = async (c, p, opts) => ({ ...nearResult, kind: opts && opts.single ? "single" : "2x2" });
  assert.deepEqual(json(await box._withCopyCheck({ id: "main" }, "u", "i", { a: 1 })), { a: 1 }); assert.equal(checks, 0);
  const w = await box._withCopyCheck(sub, "u", "i9", { a: 1 });
  assert.equal(w.a, 1); assert.equal(w.copyCheck.kind, "single"); assert.equal(w.copyCheck.iso, "i9");
  // the headless runs (Generate all, Location Scout, "Make what this scene needs") on the real Glass Hours room
  const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
  const locations = film.locations.map((l) => ({ ...l }));
  const owner = locations.find((l) => l.id === "loc-fondamenta-3"), room = locations.find((l) => l.id === "loc-fondamenta-dei-vetrai-4");
  // the STORED card, as the Location Scout and "Make what this scene needs" pass it (the test used to add parentLocation
  // by hand, which hid that those runs saved no check)
  assert.equal(room.parentKey, owner.key); assert.ok(!("parentLocation" in room), "the stored record shape");
  box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: box.deriveSluglineUnits(film.scenes, film.drafts) };
  box.TURN_DATA = { PROJECT: film.project };
  for (const l of locations) if (l.spatialPlan) { metas[l.id] = { iso: "2026-10-13T10:00:00Z", spatialPlanSig: box.locationSpatialPlanSig(l.spatialPlan) }; images[l.id] = "https://cdn/plate-" + l.id + ".png"; }
  const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => ({ font: "15px", measureText: (t) => ({ width: String(t).length * 9 }), fillRect() {}, fillText() {} }), toDataURL: () => "data:image/png;base64,PAGE" });
  const sent = [], commits = [];
  Object.assign(box, { document: { createElement: () => fakeCanvas() }, cropRegionAsDataUrl: async (u) => "data:crop:" + u, oaiToDataUrl: async (u) => u,
    nbGenerate: async (prompt, o) => { sent.push({ prompt, o }); return "https://img/new.png"; },
    nbCommit: async (id, url, meta) => { commits.push({ id, url, meta }); return { tier: "cloud" }; }, nbGetRes: () => "2K", nbGetModel: () => "gemini-nano-banana-2.1" });
  checks = 0;
  checkImpl = async (child, parentUrl, opts) => { assert.equal(child, "https://img/new.png"); assert.equal(parentUrl, images[owner.id]); return { ...nearResult, kind: opts && opts.single ? "single" : "2x2" }; };
  assert.equal(await box.generateLocationPlate(room, film.project, {}), true);
  assert.equal(sent.length, 1, "one image — a near-copy never makes a second on its own");
  assert.equal(checks, 1);
  assert.equal(commits[0].meta.copyCheck.kind, "2x2"); assert.equal(commits[0].meta.copyCheck.iso, commits[0].meta.iso, "recorded for the version it saves");
  assert.equal(commits[0].meta.copyCheck.parentIso, metas[owner.id].iso);
  images[room.id] = "https://cdn/plate-room.png";
  const unit = box.turnContinuity.sluglineUnits.find((u) => u && !u.orphan && String(u.subspaceKey || u.locationKey || "") === room.key);
  sent.length = 0; commits.length = 0;
  assert.equal(await box.generateSluglineUnitPlate(room, unit, film.project, {}), true);
  assert.equal(sent.length, 1); assert.equal(commits[0].meta.copyCheck.kind, "single", "a room & time plate is one frame");
  assert.equal(commits[0].meta.copyCheck.parentId, owner.id);
  // an environment state the Location Scout makes (generateLocationVariant), on the stored card
  sent.length = 0; commits.length = 0; checks = 0;
  assert.equal(await box.generateLocationVariant(room, { id: "night", time: "Night", state: "Acqua alta" }, film.project), true);
  assert.equal(sent.length, 1); assert.equal(checks, 1);
  assert.equal(commits[0].meta.copyCheck.kind, "single"); assert.equal(commits[0].meta.copyCheck.iso, commits[0].meta.iso);
  // a main location's plate: no check at all
  sent.length = 0; commits.length = 0; checks = 0;
  assert.equal(await box.generateLocationPlate(owner, film.project, {}), true);
  assert.equal(checks, 0); assert.ok(!("copyCheck" in commits[0].meta));
  // a check that can't run: the plate is saved as before, without a record
  checkImpl = async () => { throw new Error("tainted"); };
  sent.length = 0; commits.length = 0;
  assert.equal(await box.generateLocationPlate(room, film.project, {}), true);
  assert.equal(sent.length, 1); assert.ok(!("copyCheck" in commits[0].meta));
  delete box.document;
}

/* ---- 5. the notice ---- */
const flat = (n) => !n || typeof n !== "object" ? [] : [n, ...(n.children || []).flatMap(flat)];
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
const cls = (n) => String((n.props && n.props.className) || "");
const chips = [];
box.nbCostChip = (count, opts) => { chips.push([count, opts]); return { type: "span", props: { className: "nb-cost" }, children: ["7"] }; };
let regenerated = 0, kept = [];
box.nbSetAssetCopyCheck = async (...a) => { kept.push(a); return { ok: true }; };
const render = (props, keep) => { if (!keep) hooks = []; cursor = 0; effects = []; return box.LocationCopyCheckNotice({ onRegenerate: () => { regenerated++; }, ...props }); };
const runEffects = async () => { const list = effects.slice(); list.forEach((e) => e()); await new Promise((r) => setTimeout(r, 5)); };
{
  metas[parent.id] = { iso: "p1" }; images[parent.id] = "parent-plate";
  const gen = { genUrl: "plate-url", gening: false, genMeta: { iso: "s1", copyCheck: { ...nearResult, iso: "s1", parentId: parent.id, parentIso: "p1" } } };
  checks = 0;
  let out = render({ l: sub, assetId: sub.id, gen, refs: () => 4 });
  await runEffects();
  assert.equal(checks, 0, "a recorded check is read, not run again");
  out = render({ l: sub, assetId: sub.id, gen, refs: () => 4 }, true);
  assert.equal(cls(out), "loc-copy-check"); assert.equal(out.props.role, "status");
  const lines = flat(out).filter((n) => n.type === "p").map(text);
  assert.deepEqual(lines, ["Top-right: This panel looks like Fondamenta's sheet — regenerate?", "Bottom-left: This panel looks like Fondamenta's sheet — regenerate?"], "each near-copy panel, in the owner's words");
  const why = flat(out).find((n) => n.type === "p").props.title;
  assert.match(why, /^Compared in your browser, free: its top-right panel is a near-copy of the top-left panel of Fondamenta's plate \(detail 0\.91, layout 0\.88 — a near-copy scores at least 0\.6 and 0\.62\)\. Nothing changes unless you regenerate\.$/);
  const buttons = flat(out).filter((n) => n.type === "button");
  assert.deepEqual(buttons.map(text), ["Regenerate7", "Keep"], "Regenerate quotes its price; Keep");
  assert.deepEqual(json(chips.at(-1)), [1, { refs: 4 }], "priced as one image with the references it attaches");
  assert.equal(regenerated, 0, "nothing regenerates on its own — showing, re-rendering and running its effects spend nothing");
  buttons[0].props.onClick(); assert.equal(regenerated, 1, "Regenerate is the click");
  await buttons[1].props.onClick();
  assert.equal(kept.length, 1);
  assert.equal(kept[0][0], sub.id); assert.equal(kept[0][1], "s1");
  assert.equal(kept[0][2].kept, true); assert.equal(kept[0][2].parentIso, "p1"); assert.equal(kept[0][2].iso, "s1");
  assert.equal(render({ l: sub, assetId: sub.id, gen }, true), null, "Keep hides it at once");
  assert.equal(render({ l: sub, assetId: sub.id, gen: { ...gen, genMeta: { ...gen.genMeta, copyCheck: { ...gen.genMeta.copyCheck, kept: true } } } }), null, "…and for good, for that version");
  assert.equal(regenerated, 1);
  // read-only: the words, no buttons; a single frame: "This plate"
  out = render({ l: sub, assetId: sub.id, gen, readOnly: true });
  assert.equal(flat(out).filter((n) => n.type === "button").length, 0);
  out = render({ l: sub, assetId: "locunit-x", single: true, gen: { ...gen, genMeta: { iso: "s1", copyCheck: { v: 1, kind: "single", near: true, iso: "s1", parentIso: "p1",
    panels: [{ key: "plate", match: "BR", detail: 0.8, layout: 0.7, near: true }] } } } });
  assert.deepEqual(flat(out).filter((n) => n.type === "p").map(text), ["This plate looks like Fondamenta's sheet — regenerate?"]);
  assert.deepEqual(json(chips.at(-1)), [1, null], "no reference count given: the engine's price for one image");
  // not a near-copy, not a sub-space, no plate: nothing
  assert.equal(render({ l: sub, assetId: sub.id, gen: { ...gen, genMeta: { iso: "s1", copyCheck: { ...nearResult, near: false, iso: "s1", parentIso: "p1" } } } }), null);
  assert.equal(render({ l: { id: "main", name: "Main" }, assetId: "main", gen }), null);
  assert.equal(render({ l: sub, assetId: sub.id, gen: { ...gen, genUrl: "" } }), null);
  assert.equal(regenerated, 1);
  // nothing recorded (a plate made before the check) or the parent's plate changed since: checked once a session
  checks = 0; checkImpl = async (child, parentUrl) => { assert.equal(child, "old-plate"); assert.equal(parentUrl, "parent-plate"); return nearResult; };
  const old = { genUrl: "old-plate", gening: false, genMeta: { iso: "s0" } };
  out = render({ l: sub, assetId: sub.id, gen: old });
  assert.equal(out, null, "nothing to say until the check has run");
  await runEffects();
  assert.equal(checks, 1, "checked in the browser");
  out = render({ l: sub, assetId: sub.id, gen: old }, true);
  assert.equal(flat(out).filter((n) => n.type === "p").length, 2, "…and then said");
  await runEffects();
  render({ l: sub, assetId: sub.id, gen: old }); await runEffects();
  assert.equal(checks, 1, "not recomputed on every render (once a session per version)");
  metas[parent.id] = { iso: "p2" };   // the parent's plate regenerated
  render({ l: sub, assetId: sub.id, gen }); await runEffects();
  assert.equal(checks, 2, "a recorded check against an older parent plate is run again");
  assert.equal(regenerated, 1, "still nothing spent on its own");
  // (review) Regenerate follows the card's own Generate: not while it runs, while an unsaved image waits, or blocked
  metas[parent.id] = { iso: "p1" };   // the recorded check is current again
  const regen = (o) => flat(render({ l: sub, assetId: sub.id, gen, refs: () => 4, ...o })).filter((n) => n.type === "button")[0];
  assert.equal(regen({}).props.disabled, false);
  for (const o of [{ gen: { ...gen, gening: true } }, { gen: { ...gen, pendingSave: { url: "x" } } }, { disabled: true }, { onRegenerate: undefined }]) {
    const b = regen(o); assert.equal(b.props.disabled, true, JSON.stringify(Object.keys(o))); b.props.onClick();
  }
  assert.equal(regenerated, 1, "a blocked Regenerate makes nothing");
  assert.equal(regen({ regenerateTitle: "Writes this place's view composition first" }).props.title, "Writes this place's view composition first", "the card says when it writes first");
  // a check that couldn't read an image isn't kept for the session: shown again, it is tried again
  checks = 0; checkImpl = async () => null;
  const unread = { genUrl: "unread-plate", gening: false, genMeta: { iso: "s7" } };
  render({ l: sub, assetId: sub.id, gen: unread }); await runEffects();
  render({ l: sub, assetId: sub.id, gen: unread }); await runEffects();
  assert.equal(checks, 2, "tried again when the card is shown again");
}

/* ---- 6. the three cards, the meta write, the manifest ---- */
{
  const ui = read("app/locations-ui.jsx");
  assert.match(ui, /l\.parentLocation && React\.createElement\(LocationCopyCheckNotice,\{ l, assetId:l\.id, gen, readOnly,\n\s+refs:\(\)=>\(typeof locationPlateRefCount==="function" \? locationPlateRefCount\(l\)\.n : undefined\),\n\s+disabled:!spatialState\.ready\|\|!parentRefUrl\|\|masterRefs\.some\(r=>r\.required&&!r\.ready&&!r\.preview\),\n\s+regenerateTitle:\(!locStaged && !gen\.slotHasRef[^\n]*\n[^\n]*a small writing charge[^\n]*\n\s+onRegenerate:\(\)=>genPlate\.generate\(\) \}\)/, "the room's own plate: blocked as its Generate is, and says when it writes first");
  assert.match(ui, /React\.createElement\(LocationCopyCheckNotice,\{ l, assetId:id, gen, single:true,\n\s+refs:\(\)=>\(stateUnit && typeof sluglineUnitPlateRefCount[^\n]*\n\s+disabled:!canGenerate, onRegenerate:\(\)=>gen\.generate\(\) \}\)/, "an environment state");
  assert.match(ui, /refs:\(\)=>\(typeof sluglineUnitPlateRefCount==="function" \? sluglineUnitPlateRefCount\(l,u,\{rootPlate:true\}\)\.n : undefined\),\n\s+disabled:!canGenerate, onRegenerate:\(\)=>gen\.generate\(\) \}\)/, "a room & time plate: not once it left the script");
  assert.match(ui, /React\.createElement\(LocationCopyCheckNotice,\{ l, assetId:imgId, gen, single:true, readOnly:!!u\.orphan,/, "a room & time plate");
  assert.equal((ui.match(/React\.createElement\(LocationCopyCheckNotice,/g) || []).length, 3, "never on an extra space (a main location's only)");
  // Keep writes this version's meta only (imagegen.jsx nbSetAssetCopyCheck; cloud.jsx cloudSetAssetCopyCheck)
  const ig = read("app/imagegen.jsx");
  const a = ig.indexOf("function nbSetAssetCopyCheck("), b = ig.indexOf("window.nbSetAssetCopyCheck=nbSetAssetCopyCheck;");
  assert.ok(a > 0 && b > a);
  const local = { meta: { iso: "s1", modelId: "x" }, image: "img", events: [] };
  const mb = { console, window: null, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
    _nbEpoch: 1, _nbBackend: "local", _nbUid: null, _scopeFor: () => null, _nbSerial: (id, f) => f(), _cloudMetaCache: new Map(),
    localGetMeta: () => local.meta, localSetMeta: (id, m) => { local.meta = m; }, localGetImage: () => local.image };
  mb.window = { dispatchEvent: (e) => local.events.push(e.type) };
  vm.createContext(mb); vm.runInContext(ig.slice(a, b), mb);
  assert.deepEqual(json(await mb.nbSetAssetCopyCheck("loc-sub", "s0", { near: true, kept: true })), { ok: false, error: "asset version changed" }, "only the version it was asked about");
  assert.equal((await mb.nbSetAssetCopyCheck("loc-sub", "s1", { near: true, kept: true, iso: "zz" })).ok, true);
  assert.deepEqual(json(local.meta.copyCheck), { near: true, kept: true, iso: "s1" }, "stamped with this version");
  assert.equal(local.meta.modelId, "x", "the rest of the meta untouched");
  assert.deepEqual(local.events, ["nb-meta-changed"], "the card re-reads its meta");
  assert.match(read("app/artroom.jsx"), /window\.addEventListener\("nb-meta-changed",onApproval\);/);
  const cloud = read("app/cloud.jsx");
  assert.match(cloud, /async function cloudSetAssetCopyCheck\(projectId, uid, entityId, expectedIso, copyCheck\)\{[^]*?row\.meta\.iso!==expectedIso[^]*?cloudCasGen\(projectId,uid,entityId,row,\{\n\s+storage_path:row\.storage_path,meta,refs:row\.refs\|\|\[\],history:row\.history\|\|\[\]\}\);/, "a compare-and-set on the same row, its image untouched");
  // what users read stays in the house style; Frances knows it
  assert.doesNotMatch(ui.slice(ui.indexOf("function LocationCopyCheckNotice("), ui.indexOf("function LocationCoverageSheet(")), /TURN|McKee|Claude|Anthropic/);
  const ai = read("app/ai.jsx");
  assert.match(ai, /THE COPY CHECK: after a room's plate \(or one of its room & time or environment-state plates\) is made, each of its panels is compared with each panel of the parent location's plate, in your browser \\u2014 free, nothing is sent anywhere\./);
  assert.match(ai, /'This panel looks like <parent>'s sheet \\u2014 regenerate\?'/);
  assert.match(ai, /It never blocks a plate, never regenerates and never spends on its own\./);
  assert.match(read("app/styles.css"), /\.loc-copy-check\{display:flex;/);
}

console.log("PASS location copy check: the maths (normalised, high-pass, shift search), the threshold on " + stats.copy.length + " copies vs "
  + negatives.length + " other views (copy margin " + copyMargin.toFixed(3) + ", other margin " + otherMargin.toFixed(3) + "; " + twoByTwo
  + " 2x2 plates read panel by panel; night copies caught " + nightCaught + "/" + stats.night.length + " — the documented limit), recorded on the meta before the save (the headless runs on the stored card too), never spends on its own, the notice, Keep, the three cards");

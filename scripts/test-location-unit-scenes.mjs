#!/usr/bin/env node
/* test-location-unit-scenes.mjs — A ROOM & TIME PLATE READS EVERY SCENE OF ITS UNIT (owner-approved 2026-10-14, "go ahead
   with all of it" — the "headless paths" gaps an independent check found after fixes C, F and G).
   A room & time plate (a Slugline Unit's: one room at one time) attached the pages of its unit's FIRST scene only —
   Glass Hours' Furnace · Night (scenes 4, 6, 7, 9, 10, 12 and 15) sent scene 4's page — while its prompt said "the
   screenplay of these scenes is attached as page images (Image 1)", so scenes 6–15 reached the engine in no form. Now,
   on its card, on an environment state's card, from the headless runs ("Make what this scene needs", "Generate N
   missing in Scene NN", a state the Location Scout makes) and in its price:
   1. every scene of the unit in story order, as whole scenes' pages in the reference slots its plates leave (its
      room's own plate and the parent's cut-out panels take theirs first; 6 images in all) — the pages first in the list;
   2. the scenes whose pages don't fit go in its prompt as text (coverage.screenplay_of_scenes_not_attached — the
      unit's own part of each scene), never both and never neither; the pointer names the attached pages;
   3. the count (no drawing) is what is attached; every prompt fits every engine with the reference list last;
   4. the left-out scenes' text is a fair share, and with room to spare each gets more of itself (up to 6,000
      characters in all) — never past the budget;
   5. a page the viewer unticks on the card goes as text instead; a unit whose scenes aren't in the film keeps the old
      excerpt;
   6. Frances knows (APP_FEATURES).
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json), on its STORED cards (a
   room has a parentKey, no parentLocation). All providers and persistence are mocked; nothing is generated or
   charged. node scripts/test-location-unit-scenes.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const imagegen = read("app/imagegen.jsx");
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };
const noop = () => {};
let hooks = [], cursor = 0, effects = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState: (init) => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof init === "function" ? init() : init;
    return [hooks[i], (v) => hooks[i] = typeof v === "function" ? v(hooks[i]) : v]; },
  useReducer: (fn, init) => React.useState(init),
  useRef: (init) => { const i = cursor++; return hooks[i] || (hooks[i] = { current: init }); },
  useEffect: (fn, deps) => { const i = cursor++; effects.push(fn); hooks[i] = deps; },
  useMemo: (fn) => fn(),
};
let durl = 0;
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => ({ font: "15px", measureText: (t) => ({ width: String(t).length * 9 }), fillRect() {}, fillText() {} }),
  toDataURL: () => "data:image/png;base64,PAGE" + (++durl) });
const metas = {}, images = {};
let engine = "gpt-image-2.5-flare";
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "photoreal cinematic establishing photography",
  document: { createElement: () => fakeCanvas() }, worldScaleClause: () => "", appToast: noop,
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "",
  oaiToDataUrl: async (u) => "data:" + u, cropRegionAsDataUrl: async (url, rect, max) => "crop(" + url + "@" + rect.x + "," + rect.y + "/" + max + ")",
  nbGetModel: () => engine, nbCanonicalModelId: (id) => id, nbGetRes: () => "2K", nbEpoch: () => 1 };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/pricing.jsx"), box, { filename: "app/pricing.jsx" });
vm.runInContext(slice(imagegen, "/* THE PROMPT BUDGET PER ENGINE (2026-10-14", "\nfunction nbIdentitySnapshot("), box, { filename: "app/imagegen.jsx#budget" });
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
vm.runInContext(read("app/locations-ui.jsx"), box, { filename: "app/locations-ui.jsx" });
const json = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const ENGINES = Object.keys(box.TURN_IMAGE_PROMPT_LIMITS);
const isPage = (u) => /^data:image\/png;base64,PAGE/.test(String(u));
const specOf = (p) => { const body = p.slice(p.indexOf("\n") + 1); return JSON.parse(body.slice(0, body.indexOf("\nAVOID: "))); };

// the film's STORED cards
const locations = film.locations.map((l) => ({ ...l }));
const byId = (id) => locations.find((l) => l.id === id);
const furnace = byId("loc-furnace-1"), office = byId("loc-furnace-office-2");
assert.ok(locations.every((l) => !("parentLocation" in l)) && office.parentKey === furnace.key, "the stored record shape");
const units = box.deriveSluglineUnits(film.scenes, film.drafts);
box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: units };
box.TURN_DATA = { PROJECT: film.project };
const project = film.project;
for (const l of locations) { metas[l.id] = { iso: "2026-10-13T10:00:00Z", ...(l.spatialPlan ? { spatialPlanSig: box.locationSpatialPlanSig(l.spatialPlan) } : {}) };
  images[l.id] = "https://cdn/plate-" + l.id + ".png"; }
const night = units.find((u) => u.key === "furnace|INT|Night");
const sceneById = (id) => film.scenes.find((s) => s.id === id);

/* ---- the unit's scenes, in story order ---- */
assert.deepEqual(json(box.sluglineUnitScenes(night, film.scenes).map((s) => s.no)), [4, 6, 7, 9, 10, 12, 15]);
assert.deepEqual(json(box.sluglineUnitScenes({ sceneNos: [12, 4] }, film.scenes).map((s) => s.no)), [4, 12], "by its scene numbers when it has no ids");
assert.deepEqual(json(box.sluglineUnitScenes({ scenes: [] }, film.scenes)), [], "none: never the whole film");
// whole scenes, story order, in the slots given
assert.deepEqual(json(box.sluglineUnitPageRefs(furnace, night, "x", film.scenes, film.drafts, 3).map((r) => r.sceneId)), ["gh-s04", "gh-s06", "gh-s07"]);
assert.deepEqual(json(box.sluglineUnitPageRefs(furnace, night, "x", film.scenes, film.drafts, 0)), []);
for (const n of [0, 1, 3, 5, 6]) assert.equal(box.sluglineUnitPageCount(furnace, night, film.scenes, film.drafts, n), box.sluglineUnitPageRefs(furnace, night, "x", film.scenes, film.drafts, n).length, "count " + n);
const r0 = box.sluglineUnitPageRefs(furnace, night, "locunit-n", film.scenes, film.drafts, 5);
assert.deepEqual(json(r0.map((r) => [r.refId, r.label, r.maxDim, r.required, r.ready])), [
  ["script-locunit-n-0", "Scene 04 p1", 1536, false, true], ["script-locunit-n-1", "Scene 06 p1", 1536, false, true],
  ["script-locunit-n-2", "Scene 07 p1", 1536, false, true], ["script-locunit-n-3", "Scene 09 p1", 1536, false, true], ["script-locunit-n-4", "Scene 10 p1", 1536, false, true]]);
assert.equal(r0[1].note, "screenplay page 2 for Furnace (Scene 6) — use it to infer what the script implies, but do not render any text from it");

/* ---- the scenes left out, as text: the unit's own part of each ---- */
const leftIds = ["gh-s12", "gh-s15"];
const leftFull = json(box.sluglineUnitUnattachedTexts(night, film.scenes, film.drafts, ["gh-s04", "gh-s06", "gh-s07", "gh-s09", "gh-s10"]));
assert.equal(leftFull.length, 2);
leftFull.forEach((t, i) => { assert.ok(t.startsWith("INT. FURNACE — NIGHT\n"), "from its heading");
  assert.equal(t, box.locationSceneScriptText(sceneById(leftIds[i]), film.drafts).replace(/\n{3,}/g, "\n\n").trim(), "a whole-scene occurrence: the scene"); });
assert.deepEqual(json(box.sluglineUnitUnattachedTexts(night, film.scenes, film.drafts, null)), [], "the attached scenes unknown: none");
// a unit that owns only part of a scene: only that part
{ const d = film.drafts["gh-s12"].blocks;
  const part = { scenes: ["gh-s12"], occurrences: [{ sceneId: "gh-s12", start: 1, end: 3 }] };
  const t = json(box.sluglineUnitUnattachedTexts(part, film.scenes, film.drafts, ["gh-s04"]))[0];
  assert.equal(t, box.locationSceneScriptText(sceneById("gh-s12"), { "gh-s12": { blocks: d.slice(1, 3) } }).trim());
  assert.ok(!t.startsWith("INT. FURNACE"), "the blocks under its slugline only"); }

/* ---- 1–4. the headless room & time plate, on every engine ---- */
const sent = [], commits = [];
Object.assign(box, { nbGenerate: async (prompt, o) => { sent.push({ prompt, o }); return "https://img/unit.png"; },
  nbCommit: async (id, url, meta, refs) => { commits.push({ id, meta, refs }); return { tier: "cloud" }; } });
const checkUnitPrompt = (p, limit, label) => {
  assert.ok(p.length <= limit && box.nbFitImagePrompt(p, limit).steps.length === 0, label + ": fits its engine by itself (" + p.length + ")");
  const spec = specOf(p);
  assert.equal(spec.coverage.screenplay_excerpt, "the screenplay of these scenes is attached as page images (Images 1–5) — read it there; it is not repeated here", label);
  assert.deepEqual(json(spec.coverage.scenes), [4, 6, 7, 9, 10, 12, 15]);
  const notAt = spec.coverage.screenplay_of_scenes_not_attached;
  assert.equal(notAt.length, 2, label + ": scenes 12 and 15 as text");
  notAt.forEach((t, i) => assert.ok(leftFull[i].startsWith(t.replace(/ …$/, "")), label + ": scene " + leftIds[i] + "'s own text"));
  // never both: an attached scene's lines are only on its page; never neither: the left-out ones are in the prompt
  for (const sid of ["gh-s04", "gh-s06", "gh-s07", "gh-s09", "gh-s10"]) {
    const line = box.locationSceneScriptText(sceneById(sid), film.drafts).split("\n").find((x, i) => i > 0 && x.trim().length > 40);
    assert.ok(!p.includes(JSON.stringify(line.slice(0, 40)).slice(1, -1)), label + ": scene " + sid + " goes as its page only");
  }
  assert.match(p, /REFERENCE IMAGES \(binding\): Image 1 = screenplay page 1 for Furnace \(Scene 4\)[^]*Image 5 = screenplay page 5 for Furnace \(Scene 10\)[^]*Image 6 = Furnace (child\/)?master plate/);
  return spec;
};
for (const id of ENGINES) {
  engine = id; sent.length = 0; commits.length = 0;
  assert.equal(await box.generateSluglineUnitPlate(furnace, night, project, {}), true, id);
  const o = sent[0].o, limit = box.nbPromptMaxChars(id);
  assert.equal(o.extraImages.length, 6, id + ": 6 images in all");
  assert.ok(o.extraImages.slice(0, 5).every(isPage) && o.extraImages[5] === images[furnace.id], id + ": five scenes' pages, then its plate");
  assert.deepEqual(json(o.extraImageMaxDims), [1536, 1536, 1536, 1536, 1536, 1024]);
  assert.deepEqual(json(commits[0].refs.filter((r) => r.kind === "script").map((r) => r.sceneId)), ["gh-s04", "gh-s06", "gh-s07", "gh-s09", "gh-s10"], "each page saved with its scene");
  const spec = checkUnitPrompt(sent[0].prompt, limit, id + " headless");
  // (4) room to spare: each left-out scene goes whole (both together are under 6,000 characters)
  assert.deepEqual(json(spec.coverage.screenplay_of_scenes_not_attached), leftFull, id + ": with room to spare, each scene whole");
  assert.deepEqual(json(box.sluglineUnitPlateRefCount(furnace, night, { rootPlate: true })), { n: 6, exact: true }, "priced as it is sent");
}
engine = "gpt-image-2.5-flare";
// it used to send only the first scene's page
assert.ok(!/locationSceneForCoverageSheet|sluglineUnitPseudoSheet\(id, u, role\)/.test(slice(read("app/locations.jsx"), "async function generateSluglineUnitPlate(", "window.generateSluglineUnitPlate")));

/* ---- a room on its stored card: the parent's one panel, then its pages ---- */
const officeDay = units.find((u) => u.key === "furnace-office|INT|Day");
sent.length = 0;
assert.equal(await box.generateSluglineUnitPlate(office, officeDay, project, {}), true);
assert.ok(isPage(sent[0].o.extraImages[0]), "scene 2's page");
assert.deepEqual(json(sent[0].o.extraImages.slice(1)), [images[office.id], "crop(data:" + images[furnace.id] + "@50.5,50.5/640)"], "the room's plate, then Furnace's ONE material panel (found by the parentKey)");
assert.equal(box.sluglineUnitPlateRefCount(office, officeDay, { rootPlate: true }).n, 3);

/* ---- a state the Location Scout makes from a unit (generateLocationVariant) ---- */
sent.length = 0; commits.length = 0;
assert.equal(await box.generateLocationVariant(furnace, { id: "night", time: "Night", unitKey: night.key, state: "Embers banked" }, project), true);
assert.equal(commits[0].id, box.sluglineUnitImageId(night.key), "the room & time plate itself");
assert.equal(sent[0].o.extraImages.length, 6);
assert.ok(sent[0].o.extraImages.slice(0, 5).every(isPage) && sent[0].o.extraImages[5] === images[furnace.id]);
{ const spec = checkUnitPrompt(sent[0].prompt, box.nbPromptMaxChars(engine), "state");
  assert.equal(spec.coverage.appearance_state, "Embers banked"); }
assert.ok(!commits[0].meta.locationUpstream || commits[0].meta.locationUpstream.every((u) => !/^script-/.test(u.id)), "a page is never an upstream plate");
// a state of no unit: as before (no pages, its own prompt)
sent.length = 0;
assert.equal(await box.generateLocationVariant(furnace, { id: "storm", time: "Storm", manualState: true, state: "Storm" }, project), true);
assert.deepEqual(json(sent[0].o.extraImages), [images[furnace.id]]);

/* ---- 1–3, 5. the cards: the room & time card and the state card send the same ---- */
let cap = null;
Object.assign(box, { useImageGen: (o) => { cap = o; return { genUrl: "", genMeta: null, generate: noop }; }, SheetFrame: () => null, SheetField: () => null });
const render = (fn, props) => { hooks = []; cursor = 0; effects = []; return fn(props); };
render(box.SluglineUnitCard, { l: furnace, u: night, project, scenes: film.scenes, drafts: film.drafts, parentGenUrl: "", onEnvironmentChange: noop, onRemoveUnit: noop, onView: noop });
let attach = json(await cap.attachments({}, "final"));
assert.deepEqual(attach.map((r) => r.kind), ["script", "script", "script", "script", "script", "location"], "the card: five scenes' pages, then its plate");
assert.deepEqual(attach.filter((r) => r.kind === "script").map((r) => r.sceneId), ["gh-s04", "gh-s06", "gh-s07", "gh-s09", "gh-s10"]);
assert.ok(attach.filter((r) => r.kind === "script").every((r) => r.maxDim === 1536));
for (const id of ENGINES) {
  engine = id;
  const p = cap.rebuildPromptAfterAttachments(attach, "final", { model: id }) + " " + cap.attachmentsText(attach);
  assert.ok(p.length <= box.nbPromptMaxChars(id) && box.nbFitImagePrompt(p, box.nbPromptMaxChars(id)).steps.length === 0, id + " card " + p.length);
  const spec = specOf(p);
  assert.equal(spec.coverage.screenplay_excerpt, "the screenplay of these scenes is attached as page images (Images 1–5) — read it there; it is not repeated here");
  assert.deepEqual(json(spec.coverage.screenplay_of_scenes_not_attached), leftFull, id + ": the card sends the left-out scenes as text, like the headless run");
}
engine = "gpt-image-2.5-flare";
// (5) a page the viewer unticks goes as text instead (whole scenes only)
{ const refs = await box.buildSluglineUnitReferences(furnace, night, "locunit-n", null, film.scenes, film.drafts, "");
  const off = refs.filter((r) => r.kind === "script" && r.sceneId === "gh-s06").map((r) => r.refId);
  const a2 = json(box._locUnitAttachments(refs, off));
  assert.deepEqual(a2.filter((r) => r.kind === "script").map((r) => r.sceneId), ["gh-s04", "gh-s07", "gh-s09", "gh-s10"]);
  const s2 = specOf(box.buildSluglineUnitPrompt(furnace, night, project, box._locBudgetOpts(a2, {})));
  assert.equal(s2.coverage.screenplay_of_scenes_not_attached.length, 3, "scene 6 joins the text");
  assert.ok(s2.coverage.screenplay_of_scenes_not_attached[0].startsWith("INT. FURNACE — NIGHT\nLow fire."), "in story order: scene 6 first");
  // never more than 6 images, whatever the list holds
  const many = [...refs, ...refs.filter((r) => r.kind === "script").map((r) => ({ ...r, refId: r.refId + "b", sceneId: r.sceneId + "b" }))];
  assert.ok(json(box._locUnitAttachments(many, [])).length <= 6); }
// the state card (an environment state of the unit) attaches the same pages, its plate after them
{ const refs = json(await box.buildSluglineUnitReferences(furnace, night, "locunit-n", null, film.scenes, film.drafts, ""));
  assert.deepEqual(refs.map((r) => r.kind), ["script", "script", "script", "script", "script", "location"]);
  assert.equal(refs[5].note, "Furnace child/master plate — preserve this exact subspace geometry, materials and continuity anchors"); }
// a room's card (card shape: parentLocation): its pages in the slots its plate and the parent's panel leave
{ const officeCard = { ...office, parentLocation: { id: furnace.id, key: furnace.key, name: furnace.name } };
  render(box.SluglineUnitCard, { l: officeCard, u: officeDay, project, scenes: film.scenes, drafts: film.drafts, parentGenUrl: "", onEnvironmentChange: noop, onRemoveUnit: noop, onView: noop });
  const a3 = json(await cap.attachments({}, "final"));
  assert.deepEqual(a3.map((r) => r.kind), ["script", "location", "location"]);
  assert.equal(a3[2].url, "crop(data:" + images[furnace.id] + "@50.5,50.5/640)", "Furnace's one material panel");
  assert.equal(a3[0].sceneId, "gh-s02"); }
// (5) a unit whose scenes aren't in the film: the old excerpt, no page
{ const lost = { ...night, key: "furnace|INT|Lost", scenes: ["gone"], sceneNos: [99] };
  sent.length = 0;
  assert.equal(await box.generateSluglineUnitPlate(furnace, lost, project, {}), true);
  assert.deepEqual(json(sent[0].o.extraImages), [images[furnace.id]]);
  const s = specOf(sent[0].prompt);
  assert.ok(s.coverage.screenplay_excerpt.startsWith("INT. FURNACE — NIGHT") && !("screenplay_of_scenes_not_attached" in s.coverage), "its excerpt, as before");
  assert.equal(box.sluglineUnitPlateRefCount(furnace, lost, { rootPlate: true }).n, 1); }
delete box.useImageGen; delete box.SheetFrame; delete box.SheetField;

/* ---- 4. the trimming order on a room & time plate's text: only as far as needed; growth only with room ---- */
{ const full = box.buildSluglineUnitPrompt(furnace, night, project, { screenplayPages: [1, 2, 3, 4, 5], screenplaySceneIds: ["gh-s04", "gh-s06", "gh-s07", "gh-s09", "gh-s10"], maxChars: 40000, reserve: 0 });
  const roomy = specOf(full);
  assert.deepEqual(json(roomy.coverage.screenplay_of_scenes_not_attached), leftFull);
  // a tight budget: the trimming order runs (step 6 cuts the text only as far as needed, never below ~600 in all)
  const tightMax = full.length - 1500;
  const tight = box.buildSluglineUnitPrompt(furnace, night, project, { screenplayPages: [1, 2, 3, 4, 5], screenplaySceneIds: ["gh-s04", "gh-s06", "gh-s07", "gh-s09", "gh-s10"], maxChars: tightMax, reserve: 0 });
  assert.ok(tight.length <= tightMax, "fits " + tight.length);
  const t = specOf(tight).coverage.screenplay_of_scenes_not_attached;
  assert.equal(t.length, 2);
  assert.ok(t.join("").length >= 600 && t.every((x, i) => leftFull[i].startsWith(x.replace(/ …$/, ""))), "each keeps its heading and opening: " + t.map((x) => x.length));
  assert.deepEqual(json(box.locationFitPromptSpec(specOf(full), 100000, {}).steps), []); }

/* ---- 4b. the growth stops at the budget: on an engine whose limit sits just above the prompt, the left-out scenes'
   text grows only into the room that is left — the reference list still fits after it, nothing has to be trimmed on
   the way out (proxyGenerate's nbFitImagePrompt), and more room means more of the text, never less ---- */
{ const realMax = box.nbPromptMaxChars;
  // the prompt's JSON spec (the master plate's AVOID list follows it on the same line, the unit's on the next)
  const jsonOf = (p) => { const a = p.indexOf("{"); let d = 0, q = false, e = false;
    for (let i = a; i < p.length; i++) { const c = p[i];
      if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; continue; }
      if (c === '"') q = true; else if (c === "{") d++; else if (c === "}" && --d === 0) return JSON.parse(p.slice(a, i + 1)); }
    throw new Error("no spec"); };
  const naChars = (p) => { const s = jsonOf(p);
    return ((s.coverage && s.coverage.screenplay_of_scenes_not_attached) || (s.location && s.location.screenplay_of_scenes_not_attached) || []).join("").length; };
  try {
    let prevUnit = -1, prevMaster = -1;
    for (const lim of [19000, 20000, 22000, 23000, 24000, 26000]) {
      box.nbPromptMaxChars = () => lim;
      sent.length = 0;
      assert.equal(await box.generateSluglineUnitPlate(furnace, night, project, {}), true);
      const p = sent[0].prompt;
      assert.ok(p.length <= lim && box.nbFitImagePrompt(p, lim).steps.length === 0, "room & time at a " + lim + " limit: " + p.length);
      sent.length = 0;
      assert.equal(await box.generateLocationPlate(furnace, project, {}), true);
      const m = sent[0].prompt;
      assert.ok(m.length <= lim && box.nbFitImagePrompt(m, lim).steps.length === 0, "location plate at a " + lim + " limit: " + m.length);
      if (lim >= 22000) {   // past the trimming: the text only grows with the room
        assert.ok(naChars(p) >= prevUnit && naChars(m) >= prevMaster, lim + ": " + naChars(p) + " / " + naChars(m));
        prevUnit = naChars(p); prevMaster = naChars(m);
      }
    }
    assert.ok(prevMaster > 2600 && prevUnit > 0, "with room, Furnace's left-out scenes get more than the 2,600-character base: " + prevMaster);
  } finally { box.nbPromptMaxChars = realMax; } }

/* ---- 6. Frances knows ---- */
const ai = read("app/ai.jsx");
const fr = slice(ai, "/* HEADLESS PATHS (owner-approved 2026-10-14", "/* the public view of every entry, memoised");
assert.match(fr, /THE SAME PLATE FROM EVERY BUTTON: 'Make what this scene needs', 'Generate N missing in Scene NN' and the Location Scout now make a room's plates exactly as its card does/);
assert.match(fr, /A ROOM & TIME PLATE READS EVERY SCENE of that room at that time, in story order: their screenplay pages \(one page image for each scene that fits on one page\) go in the reference slots left/);
assert.match(fr, /SCENES SENT AS TEXT get a fair share of the room/);
assert.match(fr, /EXTRA SPACES belong to a main location only \(a room or an outdoor part has none\)/);
assert.doesNotMatch(fr.slice(fr.indexOf("lf.what +=")), /TURN|McKee|Claude|Anthropic|parentKey|parentLocation/, "no internal names in what Frances is told");
assert.doesNotMatch(ai, /its extra-space plates are made from its own plate/, "the older entry no longer gives a room extra spaces");

console.log("PASS room & time plates read every scene: whole scenes' pages in the slots the plates leave (6 in all), the rest as the unit's own text — on the card, the state card, the headless runs and the Location Scout's states, priced as sent, every engine fitted; the left-out text a fair share, more with room to spare; Frances knows");

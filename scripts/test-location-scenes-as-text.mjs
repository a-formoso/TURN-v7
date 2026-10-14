#!/usr/bin/env node
/* test-location-scenes-as-text.mjs — PAGES OR TEXT, PER SCENE (owner-approved 2026-10-14, "go ahead with all of it" —
   the final consistency pass over fixes A to G of the Fondamenta plan).
   Fix F attaches whole scenes only, in the reference slots a plate's other references leave; fix E turned the
   screenplay text into a pointer whenever pages ride along. Together they sent a location with more scenes than slots
   (Glass Hours' Furnace: 10 scenes) the rest of its scenes in NO form. Now:
   1. the scenes whose pages are not attached go as text (location.screenplay_of_scenes_not_attached): one entry per
      scene, in story order, a FAIR share of 2,600 characters (a short scene keeps all of itself, the rest goes to the
      longer ones) — never a scene twice, never one left out;
   2. a page that doesn't say its scene, or no page at all, keeps the behaviour before (the pointer alone, or the text);
   3. the trimming order cuts those entries (step 6) only as far as the prompt needs, never below ~600 characters in
      all, a fair share each (2026-10-14, headless paths: always ~600 before);
   3b. with nothing to trim, they get the room the prompt has left — up to 6,000 characters in all (Furnace's five:
      most of each scene, it was ~520 each) — never past the budget, never when something was trimmed;
   4. the card's rebuild (_locBudgetOpts) and the headless plate run (Generate all, Location Scout, "Make what this
      scene needs") both pass the attached pages' scenes; every prompt still fits every engine;
   5. a merge (fix A) moves a room's "It opens onto …" answer (fix D, openingLeadsTo) from the merged-away card to the
      kept one, and the kept card's own plate prompt still fits every engine as a main location (fix E).
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json). No provider is called.
   node scripts/test-location-scenes-as-text.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const imagegen = read("app/imagegen.jsx"), ui = read("app/locations-ui.jsx");
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };

let durl = 0;
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => ({ font: "15px", measureText: (t) => ({ width: String(t).length * 9 }), fillRect() {}, fillText() {} }),
  toDataURL: () => "data:image/png;base64,PAGE" + (++durl) });
const metas = {}, images = {};
let engine = "gpt-image-2.5-flare";
const box = { console, setTimeout, clearTimeout, localStorage: { getItem: () => null }, dispatchEvent: () => true, CustomEvent: class {},
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "photoreal cinematic establishing photography",
  document: { createElement: () => fakeCanvas() }, worldScaleClause: () => "",
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "",
  cropRegionAsDataUrl: async (u) => "data:crop:" + u, oaiToDataUrl: async (u) => u,
  sceneScriptText: (sid, drafts) => { const d = (drafts || {})[sid]; return d && Array.isArray(d.blocks) ? d.blocks.map((b) => b && b.text ? b.text : "").join("  ") : ""; },
  nbGetModel: () => engine, nbCanonicalModelId: (id) => id };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/pricing.jsx"), box, { filename: "app/pricing.jsx" });
vm.runInContext(slice(imagegen, "/* THE PROMPT BUDGET PER ENGINE (2026-10-14", "\nfunction nbIdentitySnapshot("), box, { filename: "app/imagegen.jsx#budget" });
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
vm.runInContext(slice(ui, "function _locScriptPages(", "\n/* PLATE CAMERAS"), box, { filename: "app/locations-ui.jsx#budget" });
const json = (x) => JSON.parse(JSON.stringify(x));
const ENGINES = Object.keys(box.TURN_IMAGE_PROMPT_LIMITS);

const locations = film.locations.map((l) => ({ ...l }));
const byId = (id) => locations.find((l) => l.id === id);
const furnace = byId("loc-furnace-1"), office = byId("loc-furnace-office-2"), owner = byId("loc-fondamenta-3"), sub = byId("loc-fondamenta-dei-vetrai-4");
// the STORED cards (a parentKey, no parentLocation): the card's own list adds parentLocation exactly when the parent
// resolves, so the card simulation below asks locationParentOf (2026-10-14, headless paths — no hand-set parent)
assert.ok(!("parentLocation" in sub) && !("parentLocation" in office));
const isRoom = (l) => !!box.locationParentOf(l);
const units = box.deriveSluglineUnits(film.scenes, film.drafts);
box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: units };
box.TURN_DATA = { PROJECT: film.project };
const project = film.project;
for (const l of locations) if (l.spatialPlan) { metas[l.id] = { iso: "2026-10-13T10:00:00Z", spatialPlanSig: box.locationSpatialPlanSig(l.spatialPlan) }; images[l.id] = "https://cdn/plate-" + l.id + ".png"; }
const sceneText = (sid) => box.locationSceneScriptText(film.scenes.find((s) => s.id === sid), film.drafts);
const specOf = (p) => JSON.parse(p.slice(p.indexOf("\n") + 1, p.lastIndexOf(" AVOID: ")));
const masterAttachmentsText = vm.runInContext("(" + slice(ui, "const masterAttachmentsText = ", ";\n  const gen = useImageGen").replace("const masterAttachmentsText = ", "") + ")", box);

/* ---- 1. the scenes left out of the pages, as text ---- */
assert.equal(furnace.scenes.length, 10);
const furnacePages = box.locationScriptPageRefs(furnace, film.scenes, film.drafts, 5);
const attached = [...new Set(furnacePages.map((r) => r.sceneId))];
assert.equal(attached.length, furnacePages.length, "one page per scene (fix F)");
assert.ok(attached.length >= 3 && attached.length < 10, "Furnace's pages carry only some of its scenes: " + attached.length);
const left = furnace.scenes.filter((s) => attached.indexOf(s) < 0);
const rest = json(box.locationUnattachedScreenplay(furnace, film.scenes, film.drafts, attached, 2600));
assert.equal(rest.length, left.length, "one entry per scene left out");
rest.forEach((t, i) => {
  const full = sceneText(left[i]);
  assert.ok(full.startsWith(t.replace(/ …$/, "")), "entry " + i + " is scene " + left[i] + "'s own text, from its heading");
  assert.ok(t.length <= Math.floor(2600 / left.length) + 2, "a fair share each (Furnace's are all long: equal): " + t.length);
});
assert.ok(rest.join("").length <= 2600 + 2 * rest.length);
assert.deepEqual(json(box.locationUnattachedScreenplay(furnace, film.scenes, film.drafts, furnace.scenes, 2600)), [], "every scene as pages: no text");
assert.deepEqual(json(box.locationUnattachedScreenplay(furnace, film.scenes, film.drafts, null, 2600)), [], "the pages' scenes unknown: as before");
assert.deepEqual(json(box.locationUnattachedScreenplay(furnace, film.scenes, film.drafts, [], 2600)), []);
// a short scene keeps all of itself
const one = json(box.locationUnattachedScreenplay(furnace, film.scenes, film.drafts, furnace.scenes.slice(0, 9), 100000));
assert.deepEqual(one, [sceneText(furnace.scenes[9]).replace(/\n{3,}/g, "\n\n").trim()]);
// THE FAIR SHARE (2026-10-14): a short text keeps all of itself and its spare room goes to the long ones
{ const w = (n) => ("word ".repeat(Math.ceil(n / 5))).slice(0, n).trim();
  const cut = json(box._locShareCut([w(300), w(1400), w(1400)], 2600));
  assert.equal(cut[0], w(300), "the short one whole");
  assert.ok(cut[1].length > 1100 && cut[1].length <= 1152 && cut[2].length === cut[1].length, "the long ones share the rest: " + cut[1].length + " (an equal share was 866)");
  assert.ok(cut.join("").length <= 2600 + 4);
  assert.deepEqual(json(box._locShareCut([w(100), w(200)], 2600)), [w(100), w(200)], "all of them fit: nothing cut");
  assert.ok(json(box._locShareCut([w(2000), w(2000)], 100)).every((t) => t.length >= 100 && t.length <= 122), "never below 120 each");
  assert.deepEqual(json(box._locShareCut([], 2600)), []); }
// the pages' scenes, from a reference list
assert.equal(box._locPageScenes([{ kind: "location" }]), null, "no page");
assert.equal(box._locPageScenes([{ kind: "script", sceneId: "a" }, { kind: "script" }]), null, "a page that doesn't say its scene");
assert.deepEqual(json(box._locPageScenes([{ kind: "location" }, { kind: "script", sceneId: "a" }, { kind: "script", sceneId: "a" }, { kind: "script", sceneId: "b" }])), ["a", "b"]);

/* ---- 2. the plate's prompt: the pointer for the attached scenes, the text for the rest — never both ---- */
const refsFor = async (l) => {
  let refs;
  if (isRoom(l)) refs = (await box.locationSubspacePlateReferences(l)).refs;
  else { try { refs = box.mergeLocationReferences(await box.locationParentReferences(l), await box.locationSpatialReferences(l)); } catch (e) { refs = []; } }
  const pages = box.locationScriptPageRefs(l, film.scenes, film.drafts, 6 - refs.length);
  // the card's own attachment list (locations-ui.jsx attachments): each page keeps its scene
  return [...refs, ...pages.filter((r) => !r.required && r.url)].slice(0, 6).map((r) => ({ url: r.url, kind: r.kind === "script" ? "script" : "location", refId: r.refId, note: r.note,
    ...(r.numbered ? { numbered: true } : {}), ...(r.kind === "script" && r.sceneId != null ? { sceneId: r.sceneId } : {}) }));
};
const cardPrompt = (l, attach, model) => {
  const plan = isRoom(l) ? box.locationSubspacePanelPlan(l) : null, tail = masterAttachmentsText(attach);
  const p = box.combinedLocationPrompt(l, project, { ...(plan ? { panelPlan: plan, panelRefs: box.locationReferenceNumbers(attach) } : {}),
    ...box._locBudgetOpts(attach, { model }), reserve: tail.length + 1 });
  return { spec: p, prompt: p + (tail ? " " + tail : "") };
};
for (const id of ENGINES) {
  engine = id;
  const limit = box.nbPromptMaxChars(id);
  for (const l of locations) {
    const attach = await refsFor(l), c = cardPrompt(l, attach, id), spec = specOf(c.spec).location;
    assert.ok(c.prompt.length <= limit && box.nbFitImagePrompt(c.prompt, limit).steps.length === 0, id + " · " + l.name + ": " + c.prompt.length);
    const got = new Set(attach.filter((r) => r.kind === "script").map((r) => r.sceneId));
    const out = (l.scenes || []).filter((s) => !got.has(s));
    if (got.size) assert.match(spec.screenplay_context, /^the screenplay of these scenes is attached as page images/, l.name);
    if (got.size && out.length) {
      assert.equal(spec.screenplay_of_scenes_not_attached.length, out.length, id + " · " + l.name + ": every scene left out goes as text");
      out.forEach((s, i) => assert.ok(sceneText(s).startsWith(spec.screenplay_of_scenes_not_attached[i].replace(/ …$/, "")), l.name + " " + s));
      for (const s of got) {
        const line = sceneText(s).split("\n").find((x, i) => i > 0 && x.trim().length > 40);
        assert.ok(line && !c.prompt.includes(JSON.stringify(line.slice(0, 40)).slice(1, -1)), l.name + ": scene " + s + " goes as its pages only");
      }
      out.forEach((s) => { const line = sceneText(s).split("\n")[1];
        assert.ok(c.prompt.includes(JSON.stringify(line.slice(0, 30)).slice(1, -1)), l.name + ": scene " + s + "'s opening is in the prompt"); });
    } else assert.ok(!("screenplay_of_scenes_not_attached" in spec), id + " · " + l.name + ": every scene rides as pages — no text");
  }
}
engine = "gpt-image-2.5-flare";
const fa = await refsFor(furnace), fspec = specOf(cardPrompt(furnace, fa, engine).spec).location;
assert.ok(fspec.screenplay_of_scenes_not_attached.length >= 4, "Furnace: the scenes beyond its reference slots reach the engine as text");
// (2026-10-14) with room to spare on every engine, each left-out scene gets most of itself (it was ~520 characters)
assert.ok(fspec.screenplay_of_scenes_not_attached.every((t) => t.length > 1000), "Furnace: " + fspec.screenplay_of_scenes_not_attached.map((t) => t.length).join(", "));
assert.equal(fspec.screenplay_of_scenes_not_attached[fspec.screenplay_of_scenes_not_attached.length - 1].split("\n")[0], "INT. FURNACE — DAWN", "in story order, each from its heading");
// a page list that doesn't say its scenes (an older caller): the pointer alone, exactly as before
const blind = box.combinedLocationPrompt(furnace, project, { screenplayPages: [2, 3, 4], maxChars: 31500 });
assert.ok(!("screenplay_of_scenes_not_attached" in specOf(blind).location));
// no pages at all: the screenplay as text, once (as before)
const textOnly = specOf(box.combinedLocationPrompt(furnace, project, { maxChars: 31500 })).location;
assert.ok(!/attached as page images/.test(textOnly.screenplay_context) && !("screenplay_of_scenes_not_attached" in textOnly));

/* ---- 3. the trimming order: step 6 cuts them only as far as the prompt needs, never below ~600 in all ---- */
const tight = { location: { name: "Furnace", screenplay_context: "the screenplay of these scenes is attached as page images (Images 2–6) — read it there; it is not repeated here",
  screenplay_of_scenes_not_attached: rest, reads_as: "x".repeat(50) }, task: "t" };
const fullLeft = json(box.locationUnattachedScreenplayTexts(furnace, film.scenes, film.drafts, attached));
assert.equal(fullLeft.length, rest.length);
fullLeft.forEach((t, i) => assert.ok(t.startsWith(rest[i].replace(/ …$/, "")) && t.length >= rest[i].length - 2, "the uncut texts behind each entry"));
const total = (spec) => spec.location.screenplay_of_scenes_not_attached.join("").length;
const tightBudget = (extra) => JSON.stringify(tight).length - rest.join("").length + extra;
for (const full of [null, fullLeft]) {
  const xo = full ? { notAttachedFull: full } : undefined;
  // a little room: cut to about what fits (never below ~600 in all)
  const fit = box.locationFitPromptSpec(tight, tightBudget(700), xo);
  assert.ok(fit.steps.indexOf("screenplay excerpt") >= 0, fit.steps.join(", "));
  assert.ok(JSON.stringify(fit.spec).length <= tightBudget(700), "it fits");
  assert.equal(fit.spec.location.screenplay_of_scenes_not_attached.length, rest.length, "every left-out scene is still there");
  // the room: the 700 characters given, plus what the steps before it freed ("reads as") and the JSON escapes of the
  // original entries' line breaks
  assert.ok(total(fit.spec) >= 600 && total(fit.spec) <= 700 + 150, "only as far as the prompt needs: " + total(fit.spec));
  const oneMore = json(fit.spec); oneMore.location.screenplay_of_scenes_not_attached = json(box._locShareCut(full || rest, total(fit.spec) + 40 * rest.length));
  assert.ok(JSON.stringify(oneMore).length > tightBudget(700), "a bigger share would not fit");
  fit.spec.location.screenplay_of_scenes_not_attached.forEach((t, i) => assert.ok(t.length >= 100 && rest[i].startsWith(t.replace(/ …$/, "")), "each keeps its heading and opening"));
  assert.match(fit.spec.location.screenplay_context, /^the screenplay of these scenes is attached/, "the pointer is never cut");
  assert.ok(!("reads_as" in fit.spec.location), "the steps before it went first, in order");
  // more room: more of each scene
  const roomy = box.locationFitPromptSpec(tight, tightBudget(1500), xo);
  assert.ok(JSON.stringify(roomy.spec).length <= tightBudget(1500) && total(roomy.spec) > total(fit.spec) + 600, "a fairer share with more room: " + total(roomy.spec));
  // no room at all: ~600 in all (as before), and the later steps carry on
  const none = box.locationFitPromptSpec(tight, tightBudget(100), xo);
  assert.ok(total(none.spec) <= 600 + 2 * rest.length && none.spec.location.screenplay_of_scenes_not_attached.every((t) => t.length >= 100), "the floor: " + total(none.spec));
  assert.ok(none.steps.indexOf("screenplay excerpt") >= 0, none.steps.join(", "));
}
/* ---- 3b. nothing to trim: the left-out scenes get the room the prompt has left ---- */
{
  const loose = { location: { name: "Furnace", screenplay_of_scenes_not_attached: rest }, task: "t" };
  const big = box.locationFitPromptSpec(loose, 100000, { notAttachedFull: fullLeft });
  assert.deepEqual(json(big.steps), [], "nothing trimmed");
  const got = big.spec.location.screenplay_of_scenes_not_attached;
  assert.equal(got.length, rest.length);
  assert.ok(total(big.spec) > 4500 && total(big.spec) <= 6000 + 2 * rest.length, "up to 6,000 characters in all: " + total(big.spec));
  got.forEach((t, i) => assert.ok(t.length > 2 * rest[i].length && fullLeft[i].startsWith(t.replace(/ …$/, "")), "each scene more of itself: " + t.length));
  // exactly the room there is
  const at = JSON.stringify(loose).length + 900;
  const mid = box.locationFitPromptSpec(loose, at, { notAttachedFull: fullLeft });
  assert.ok(JSON.stringify(mid.spec).length <= at && JSON.stringify(mid.spec).length > at - 60, "fills the budget, never past it");
  // without the uncut texts, or when something had to be trimmed: as before
  assert.deepEqual(json(box.locationFitPromptSpec(loose, 100000).spec), json(loose));
  const trimmed = box.locationFitPromptSpec({ ...loose, location: { ...loose.location, reads_as: "x".repeat(400) } }, JSON.stringify(loose).length + 20, { notAttachedFull: fullLeft });
  assert.deepEqual(json(trimmed.steps), ["reads as and tone"]);
  assert.deepEqual(json(trimmed.spec.location.screenplay_of_scenes_not_attached), rest, "something was trimmed: no growth");
}

/* ---- 4. the card's rebuild and the headless run pass the pages' scenes ---- */
assert.deepEqual(json(box._locBudgetOpts([{ kind: "location", note: "plate" }, { kind: "script", note: "page", sceneId: "gh-s02" }], { model: "seedream-5-pro" })),
  { screenplayPages: [2], reserve: 360 + 21 + 20, model: "seedream-5-pro", screenplaySceneIds: ["gh-s02"] });
assert.ok(!("screenplaySceneIds" in box._locBudgetOpts([{ kind: "script", note: "page" }], {})), "a page without its scene: as before");
assert.match(ui, /\.\.\.\(r\.kind==="script"&&r\.sceneId!=null\?\{sceneId:r\.sceneId\}:\{\}\)\}\)\);/, "the master card's attachment list keeps each page's scene");
assert.match(ui, /\.\.\._locBudgetOpts\(attach,gopts\), reserve:masterAttachmentsText\(attach\)\.length\+1\}\)/, "the master card's rebuild reads them");
const sent = [];
Object.assign(box, { nbEpoch: () => 1, nbGenerate: async (prompt, o) => { sent.push({ prompt, o }); return "https://img/plate.png"; },
  nbCommit: async () => ({ tier: "cloud" }), nbGetRes: () => "2K" });
for (const id of ENGINES) {
  engine = id; sent.length = 0;
  assert.equal(await box.generateLocationPlate(furnace, project, {}), true, id);
  const limit = box.nbPromptMaxChars(id), p = sent[0].prompt;
  assert.ok(p.length <= limit, id + " headless Furnace plate " + p.length);
  const pages = sent[0].o.extraImages.filter((u) => /^data:image\/png;base64,PAGE/.test(u)).length;
  assert.ok(pages >= 3, "its pages ride along: " + pages);
  const s = specOf(p.slice(0, p.lastIndexOf(" AVOID: ")) + " AVOID: x.").location;
  assert.ok(Array.isArray(s.screenplay_of_scenes_not_attached) && s.screenplay_of_scenes_not_attached.length >= 4, id + ": the headless run sends the left-out scenes as text");
  assert.equal(s.screenplay_of_scenes_not_attached.length + pages, 10, id + ": each of the 10 scenes once — as its page or as text");
}

/* ---- 5. a merge moves a room's "It opens onto …" answer to the kept card; the kept card still fits every engine ---- */
const P = owner.id, C = sub.id;
const live = film.locations.map((l) => json(l));
live.find((l) => l.id === "loc-furnace-office-2").openingLeadsTo = { "door-a": C, "window-b": "elsewhere", "door-c": "loc-furnace-1" };
live.find((l) => l.id === P).openingLeadsTo = { "arch-z": C, "arch-y": "elsewhere" };
box.turnContinuity = { locations: live, scenes: film.scenes, drafts: film.drafts };
images[C] = "data:image/png;base64,BB";
const mplan = json(box.locationMergePlan(live, film.scenes, film.drafts, P, C, { hasPlate: (id) => !!images[id] }));
assert.deepEqual([mplan.keeperId, mplan.goneId], [P, C]);
const merged = json(box.locationMergeApply(live, mplan, { at: "T" }));
assert.deepEqual(merged.locations.find((l) => l.id === "loc-furnace-office-2").openingLeadsTo, { "door-a": P, "window-b": "elsewhere", "door-c": "loc-furnace-1" },
  "an answer that named the merged-away card names the kept one");
assert.deepEqual(merged.keeper.openingLeadsTo, { "arch-y": "elsewhere" }, "on the kept card an answer naming itself is dropped (Plate cameras asks again)");
const untouched = json(box.locationMergeApply(film.locations.map((l) => json(l)), mplan, { at: "T" }));
assert.ok(untouched.locations.every((l) => !("openingLeadsTo" in l)), "cards without the field don't get one");
// the kept card is a main location now: its plate prompt fits every engine, with no "room" wording
const keeper = merged.keeper;
box.turnContinuity = { locations: merged.locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: units };
box.setLocationPlaceDecisions(box.locationPlaceDecisions(merged.locations, [merged.gone]));
for (const id of ENGINES) {
  engine = id;
  const attach = await refsFor(keeper), c = cardPrompt(keeper, attach, id);
  assert.ok(c.prompt.length <= box.nbPromptMaxChars(id) && box.nbFitImagePrompt(c.prompt, box.nbPromptMaxChars(id)).steps.length === 0, id + " merged card " + c.prompt.length);
  assert.ok(!/four cameras INSIDE|Interior of .* only|part of Fondamenta/.test(c.prompt), "a main location's plate, not a room's");
}

/* ---- 6. Frances knows it ---- */
const ai = read("app/ai.jsx");
assert.match(ai, /each scene's screenplay sent either as the attached page images or as text \\u2014 never both, and a scene whose pages don't fit the reference slots goes as text/);
assert.match(ai, /The scenes whose pages don't fit go in the plate's prompt as text instead, so every scene of the location reaches the engine one way or the other \(never both\)\./);

console.log("test-location-scenes-as-text: pages or text per scene, left-out scenes as text, the trimming share, card + headless wiring, merge relink — all pass");

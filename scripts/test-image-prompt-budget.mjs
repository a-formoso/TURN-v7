#!/usr/bin/env node
/* test-image-prompt-budget.mjs — THE PROMPT BUDGET PER ENGINE (owner-approved 2026-10-14, "go ahead with all of it").
   A GPT Image 2.5 location plate (Glass Hours' "Fondamenta DEI Vetrai") went out at 33,577 characters and its engine
   refused it (fal stops at 32,000). Now:
   1. one table of prompt limits per engine, the same in the app (pricing.jsx) and the server (billing-pricing.mjs —
      the server's refusal is pinned in test-server-charging.mjs F39b), for every engine the app offers;
   2. the location builders fit by themselves: compact JSON, the AVOID list once, the screenplay as page images OR as
      text (a pointer when the pages ride along), then the fixed trimming order — never the per-panel camera lines,
      the binding fixed landmarks or the trailing "REFERENCE IMAGES are attached:" list. Every Glass Hours location
      prompt (master plates, rooms, slugline units, coverage sheets, states, the parent view, the simplified retry)
      fits every engine, built as the card builds it with its references;
   3. a layout at its largest still fits every engine, the trimming order is the documented one and what it may
      never cut is still there;
   4. proxyGenerate's final check (nbFitImagePrompt) fits any prompt by the same order — never refuses, never cuts
      the reference list — and a server prompt_too_long is re-fitted and sent once more (it was refused before any
      hold, so nothing was charged);
   5. a shot's prompt fits too (its scene text: pages OR text, then an excerpt, then left out — pinned in
      test-shot-scene-context.mjs; the simplified retry on a length refusal in test-artroom-genrun.mjs).
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json). No provider is called.
   node scripts/test-image-prompt-budget.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as BP from "../supabase/functions/image-proxy/billing-pricing.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const imagegen = read("app/imagegen.jsx");
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };

/* ---- the harness: pricing.jsx, imagegen's budget functions, locations.jsx ---- */
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
  nbGetModel: () => engine, nbCanonicalModelId: (id) => ({ "gpt-image-2": "gpt-image-2.5-sunburst" })[id] || id };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/pricing.jsx"), box, { filename: "app/pricing.jsx" });
vm.runInContext(slice(imagegen, "/* THE PROMPT BUDGET PER ENGINE (2026-10-14", "\nfunction nbIdentitySnapshot("), box, { filename: "app/imagegen.jsx#budget" });
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
const json = (x) => JSON.parse(JSON.stringify(x));

/* ---- 1. one table, app = server, every engine the app offers ---- */
assert.deepEqual(json(box.TURN_IMAGE_PROMPT_LIMITS), { ...BP.IMAGE_PROMPT_LIMITS }, "app/pricing.jsx and billing-pricing.mjs carry the same limits");
assert.equal(box.TURN_IMAGE_PROMPT_MAX_CHARS, BP.IMAGE_PROMPT_MAX_CHARS);
const appEngines = [...imagegen.slice(imagegen.indexOf("const NB_MODELS = ["), imagegen.indexOf("];", imagegen.indexOf("const NB_MODELS = ["))).matchAll(/\{ id:"([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(appEngines.slice().sort(), Object.keys(BP.IMAGE_PROMPT_LIMITS).sort(), "every engine the app offers has its own limit");
assert.equal(BP.IMAGE_PROMPT_LIMITS["gpt-image-2.5-flare"], 31500, "GPT Image 2.5: under fal's 32,000");
assert.ok(Object.values(BP.IMAGE_PROMPT_LIMITS).every((n) => n <= BP.IMAGE_PROMPT_MAX_CHARS));
for (const id of appEngines) assert.equal(box.nbPromptMaxChars(id), BP.imagePromptMaxChars(id), id);
assert.equal(box.nbPromptMaxChars("gpt-image-2"), 31500, "a retired id → its successor's limit");
assert.match(read("supabase/functions/image-proxy/billing-pricing.mjs"), /The app's prompts are NOT all well under it/, "the outdated 'well under' comment is corrected");
assert.doesNotMatch(read("supabase/functions/image-proxy/index.ts"), /Shorten it and try again/, "nobody is asked to shorten a prompt");

/* ---- the film, as the cards see it ---- */
const locations = film.locations.map((l) => ({ ...l }));
const byId = (id) => locations.find((l) => l.id === id);
const owner = byId("loc-fondamenta-3"), sub = byId("loc-fondamenta-dei-vetrai-4");
sub.parentLocation = { id: owner.id, key: owner.key, name: owner.name };
owner.childLocations = [{ id: sub.id, name: sub.name, intExt: sub.intExt }];
const office = byId("loc-furnace-office-2"), furnace = byId("loc-furnace-1");
office.parentLocation = { id: furnace.id, key: furnace.key, name: furnace.name };
let units = box.deriveSluglineUnits(film.scenes, film.drafts);
box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: units };
box.TURN_DATA = { PROJECT: film.project };
const project = film.project;
// every plan's own plate exists (made from the reviewed layout, before cameras were recorded) — the references a card sends
for (const l of locations) if (l.spatialPlan) { metas[l.id] = { iso: "2026-10-13T10:00:00Z", spatialPlanSig: box.locationSpatialPlanSig(l.spatialPlan) }; images[l.id] = "https://cdn/plate-" + l.id + ".png"; }
const ui = read("app/locations-ui.jsx");
const masterAttachmentsText = vm.runInContext("(" + slice(ui, "const masterAttachmentsText = ", ";\n  const gen = useImageGen").replace("const masterAttachmentsText = ", "") + ")", box);
const pagesOf = (refs) => refs.map((r, i) => r.kind === "script" ? i + 1 : 0).filter(Boolean);
/* a card's rebuild fits the engine THIS run renders on (a batch / "Try <engine>" pick: gopts.model), not only the
   picked one (review 2026-10-14) */
vm.runInContext(slice(ui, "function _locScriptPages(", "\n/* PLATE CAMERAS"), box, { filename: "app/locations-ui.jsx#budget" });
assert.deepEqual(json(box._locBudgetOpts([{ kind: "location", note: "plate" }, { kind: "script", note: "page" }], { model: "seedream-5-pro" })),
  { screenplayPages: [2], reserve: 360 + 21 + 20, model: "seedream-5-pro" });
assert.ok(!("model" in box._locBudgetOpts([], {})), "no run pick: the picked engine");
assert.equal(box.locationPromptBudget({ model: "seedream-5-pro", reserve: 0 }), 30000);
assert.equal(box.locationPromptBudget({ model: "gemini-nano-banana-2.1", reserve: 0 }), 40000);
assert.match(ui, /rebuildPromptAfterAttachments:\(attach,mode,gopts\)=> mode==="final"\n\s+\? buildLocationCoveragePrompt\(l, v, project, _locBudgetOpts\(attach,gopts\)\)/);
assert.equal((ui.match(/_locBudgetOpts\(attach,gopts\)/g) || []).length, 5, "the master plate, coverage, state and unit cards");

/* the master plate as the card makes it: its references (a room: the parent plate small + matched views; a main
   location: its layout's plate), its screenplay pages (at most 6 in all), then the prompt rebuilt with them */
async function masterPrompt(l, limit){
  let refs;
  if (l.parentLocation) refs = (await box.locationSubspacePlateReferences(l)).refs;
  else { try { refs = box.mergeLocationReferences(await box.locationParentReferences(l), await box.locationSpatialReferences(l)); } catch (e) { refs = []; } }
  const pages = box.locationScriptPageRefs(l, film.scenes, film.drafts, 6 - refs.length);
  const attach = [...refs, ...pages.filter((r) => !r.required && r.url)].slice(0, 6).map((r) => ({ url: r.url, kind: r.kind === "script" ? "script" : "location", refId: r.refId, note: r.note }));
  const plan = l.parentLocation ? box.locationSubspacePanelPlan(l) : null;
  const tail = masterAttachmentsText(attach);
  const prompt = box.combinedLocationPrompt(l, project, { ...(plan ? { panelPlan: plan, panelRefs: box.locationReferenceNumbers(attach) } : {}),
    screenplayPages: pagesOf(attach), reserve: tail.length + 1, maxChars: limit });
  return { prompt: prompt + (tail ? " " + tail : ""), spec: prompt, attach };
}

/* ---- 2. every Glass Hours location prompt fits every engine, by the builders alone ---- */
const report = [];
const fitsAlone = (label, text, limit) => {
  assert.ok(text.length <= limit, label + ": " + text.length + " > " + limit);
  assert.equal(box.nbFitImagePrompt(text, limit).steps.length, 0, label + ": the final check has nothing to do");
  report.push([label, text.length]);
};
for (const id of appEngines) {
  engine = id;
  const limit = box.nbPromptMaxChars(id);
  for (const l of locations) {
    const m = await masterPrompt(l, limit);
    fitsAlone(id + " · " + l.name + " plate", m.prompt, limit);
    fitsAlone(id + " · " + l.name + " simplified retry", box.buildSimpleLocationPrompt(l) + " " + masterAttachmentsText(m.attach), limit);
    const lunits = units.filter((u) => u && !u.orphan && String(u.subspaceKey || u.locationKey || "") === l.key);
    for (const u of lunits) {
      const pseudo = box.sluglineUnitPseudoSheet("unit-" + u.key, u);
      const pages = box.locationScreenplayReferenceImages(l, pseudo, film.scenes, film.drafts).map((url, i) => ({ url, kind: "script", note: "screenplay page " + (i + 1) + " for " + (u.name || "this Slugline Unit") + " — use it to infer what the script implies, but do not render any text from it" }));
      const attach = [...pages, { url: "plate", kind: "location", note: (l.name || "parent location") + " child/master plate — preserve this exact subspace geometry, materials and scale" }];
      const tail = "REFERENCE IMAGES are attached in this order: " + attach.map((r, i) => "Image " + (i + 1) + " = " + r.note).join("; ") + ". The screenplay page snapshots are context only.";
      fitsAlone(id + " · " + l.name + " unit " + u.key, box.buildSluglineUnitPrompt(l, u, project, { screenplayPages: pagesOf(attach), reserve: tail.length + 1 }) + " " + tail, limit);
    }
    for (const sheet of box.deriveLocationCoverageSheets(l, film.scenes, film.drafts, undefined, units))
      fitsAlone(id + " · " + l.name + " sheet " + sheet.id, box.buildLocationCoveragePrompt(l, sheet, project, {}), limit);
    for (const v of (l.variants || [])) fitsAlone(id + " · " + l.name + " state " + v.id, box.buildLocationVariantPrompt(l, project, { time: v.time, state: v.state }), limit);
  }
  const req = box.locationParentViewRequest(sub, "opening-3");
  assert.ok(req, "the quay's real opening onto Fondamenta");
  fitsAlone(id + " · parent view", box.buildLocationParentViewPrompt(sub, req, project), limit);
}

/* the plate that failed: Fondamenta DEI Vetrai on GPT Image 2.5 (33,577 characters on 2026-10-13) */
engine = "gpt-image-2.5-flare";
const fv = await masterPrompt(sub, 31500);
assert.ok(fv.prompt.length <= 31500 && fv.prompt.length < 30000, "Fondamenta DEI Vetrai now " + fv.prompt.length + " characters");
assert.ok(!/\n {1,}"/.test(fv.prompt), "the JSON spec has no indentation");
const avoid = fv.spec.slice(fv.spec.lastIndexOf(" AVOID: ") + 8).replace(/\.$/, "").split(", ").map((t) => t.toLowerCase());
assert.equal(new Set(avoid).size, avoid.length, "each AVOID term once");
assert.ok(avoid.length >= 40 && avoid.length <= 50, "the 44 different terms (80 were sent): " + avoid.length);
// (2026-10-14) one page image per scene: scenes 3 and 13 are Images 2 and 3 (they took four pages before)
assert.match(fv.prompt, /"screenplay_context":"the screenplay of these scenes is attached as page images \(Images 2–3\) — read it there; it is not repeated here"/);
assert.ok(!fv.prompt.includes("She runs her thumb"), "the screenplay text isn't sent beside its pages");
const specOf = (p) => JSON.parse(p.slice(p.indexOf("\n") + 1, p.lastIndexOf(" AVOID: ")));
const fvSpec = specOf(fv.spec);
assert.deepEqual(Object.keys(fvSpec.views).filter((k) => /^(top|bottom)_/.test(k)), ["top_left", "top_right", "bottom_left", "bottom_right"]);
assert.ok(Object.values(fvSpec.views).filter((v) => /Camera inside Fondamenta DEI Vetrai/.test(v)).length === 4, "every panel's camera line");
assert.equal(fvSpec.location.identity_layers.shared_set_layout.anchors.length, 13, "every layout object (nothing had to be trimmed)");
assert.match(fv.prompt, / REFERENCE IMAGES are attached: Image 1 = Fondamenta whole plate, small[^]*Image 3 = full-scene screenplay page 1 for Scene 13[^]*Never copy screenplay typography, page borders, text, captions or layout\.$/);
// without its pages (a text-only render) the screenplay goes as text — once
const fvText = box.combinedLocationPrompt(sub, project, { panelPlan: box.locationSubspacePanelPlan(sub), maxChars: 31500 });
assert.ok(fvText.includes("She runs her thumb") && !fvText.includes("attached as page images"));

/* the batch / headless runs (Generate all, Location Scout, "Make what this scene needs"): the same plate, fitted to the
   engine the run uses — a room's prompt with its pages as a pointer, its reference list last */
const sent = [];
Object.assign(box, { nbEpoch: () => 1, nbGenerate: async (prompt, o) => { sent.push({ prompt, o }); return "https://img/plate.png"; },
  nbCommit: async () => ({ tier: "cloud" }), nbGetRes: () => "2K" });
for (const id of appEngines) {
  engine = id; sent.length = 0;
  assert.equal(await box.generateLocationPlate(sub, project, {}), true, id);
  const limit = box.nbPromptMaxChars(id), p = sent[0].prompt;
  assert.ok(p.length <= limit && box.nbFitImagePrompt(p, limit).steps.length === 0, id + " headless room plate " + p.length);
  assert.match(p, /"screenplay_context":"the screenplay of these scenes is attached as page images \(Images 2–3\)/);
  assert.match(p, / REFERENCE IMAGES \(binding\): Image 1 = Fondamenta whole plate, small[^]*never copy screenplay typography, page borders, text or captions\.$/);
  images[sub.id] = "https://cdn/plate-sub.png";   // a room & time plate needs its room's plate
  for (const u of units.filter((u) => u && !u.orphan && String(u.subspaceKey || u.locationKey || "") === sub.key)) {
    sent.length = 0;
    assert.equal(await box.generateSluglineUnitPlate(sub, u, project, {}), true, id + " " + u.key);
    const q = sent[0].prompt;
    assert.ok(q.length <= limit, id + " headless unit " + u.key + " " + q.length);
    assert.match(q, /"screenplay_excerpt":"the screenplay of these scenes is attached as page images/, "the unit's excerpt is a pointer to its pages");
  }
  delete images[sub.id];
}

/* ---- 3. a layout at its largest: it still fits every engine, by the documented order, and what is never cut stays ---- */
const big = JSON.parse(JSON.stringify(owner));
const pad = (s, n) => (s + " " + "Weathered Istrian stone, salt bloom and green algae at the waterline, iron mooring rings. ".repeat(40)).slice(0, n);
big.spatialPlan.anchors = big.spatialPlan.anchors.map((a) => ({ ...a, placement: pad(a.placement, 300), evidence: pad(a.evidence || "Script", 160) }));
big.spatialPlan.sightlines = pad(big.spatialPlan.sightlines, 600);
big.spatialPlan.unresolved = pad(big.spatialPlan.unresolved, 600);
assert.ok(!box.locationSpatialPlanTooLarge(big.spatialPlan));
while (!box.locationSpatialPlanTooLarge(big.spatialPlan)) {
  const n = big.spatialPlan.anchors.length;
  big.spatialPlan.anchors.push({ id: "extra-" + n, space: "Fondamenta DEI Vetrai", name: "Mooring bollard " + n, placement: pad("On the quay edge", 300), evidence: pad("Design", 200), basis: "design" });
}
big.spatialPlan.anchors.pop();
assert.ok(!box.locationSpatialPlanTooLarge(big.spatialPlan), "the largest layout the app accepts");
for (const k of ["architecture", "materials", "lighting", "permanentDressing", "topology", "significance", "continuityAnchors"]) big[k] = pad(big[k] || "", 260);
const bigSub = { ...JSON.parse(JSON.stringify(sub)), architecture: pad(sub.architecture, 260), materials: pad(sub.materials, 260), lighting: pad(sub.lighting, 260),
  topology: pad(sub.topology, 260), significance: pad(sub.significance, 260), permanentDressing: pad(sub.permanentDressing, 260) };
locations.splice(locations.indexOf(owner), 1, big); locations.splice(locations.indexOf(sub), 1, bigSub);
metas[big.id].spatialPlanSig = box.locationSpatialPlanSig(big.spatialPlan);
const ORDER = ["layout notes", "own description once", "screenplay rules once", "other spaces' objects", "reads as and tone",
  "screenplay excerpt", "parent description to its anchors", "long prose shortened"];
for (const id of appEngines) {
  engine = id;
  const limit = box.nbPromptMaxChars(id);
  for (const l of [big, bigSub]) {
    const m = await masterPrompt(l, limit);
    const final = box.nbFitImagePrompt(m.prompt, limit);
    assert.ok(final.prompt.length <= limit, id + " " + l.name + ": " + final.prompt.length);
    assert.equal(final.prompt, m.prompt, id + " " + l.name + ": the builder fitted it by itself");
    assert.ok(final.prompt.endsWith(masterAttachmentsText(m.attach)), "the reference list, exactly");
  }
}
/* the order itself, on the room's largest spec, at ever smaller budgets: each run's steps follow the documented
   order (a tighter budget only adds later steps), and what is never cut is still there at the tightest */
const roomSpec = specOf(box.combinedLocationPrompt(bigSub, project, { panelPlan: box.locationSubspacePanelPlan(bigSub), maxChars: 40000 }));
const full = JSON.stringify(roomSpec).length;
let prev = [];
for (const share of [0.95, 0.85, 0.7, 0.55, 0.4, 0.2]) {
  const fit = box.locationFitPromptSpec(roomSpec, Math.floor(full * share));
  const steps = json(fit.steps);
  assert.deepEqual(steps, ORDER.filter((s) => steps.includes(s)), "steps in the documented order at " + share + ": " + steps.join(" > "));
  assert.ok(prev.every((s) => steps.includes(s)), "a tighter budget keeps every earlier step");
  if (share >= 0.55) assert.ok(JSON.stringify(fit.spec).length <= Math.floor(full * share), "fits at " + share);
  prev = steps;
  const spec = fit.spec, ssl = spec.location.identity_layers.shared_set_layout;
  assert.ok(spec.task && spec.render && spec.render.rules.some((r) => /GRAZIELLA FIORIN/.test(r)), "the task and the empty-set rules with the cast's names");
  assert.equal(Object.values(spec.views).filter((v) => /Camera inside Fondamenta DEI Vetrai/.test(v)).length, 4, "every panel's camera line");
  assert.equal(JSON.stringify(spec.views), JSON.stringify(roomSpec.views), "the views, word for word");
  for (const a of big.spatialPlan.anchors.filter((a) => /Vetrai/.test(a.space)))
    assert.ok(ssl.anchors.some((x) => x.id === a.id && x.name === a.name && x.placement === a.placement), "the room's fixed landmark " + a.id);
  assert.ok(ssl.coordinates && ssl.coordinates.spaces.length === 2 && ssl.frame === big.spatialPlan.frame, "the floor plan and the frame");
  if (roomSpec.location.continuity_anchors) assert.equal(JSON.stringify(spec.location.continuity_anchors), JSON.stringify(roomSpec.location.continuity_anchors), "the LOCKED continuity anchors");
}
assert.deepEqual(prev, ORDER, "the tightest budget runs every step: " + prev.join(" > "));
// past every step (a budget below what may never be cut) the final check still fits it — the middle of the body
// goes, never the reference list
const tiny = box.nbFitImagePrompt((await masterPrompt(bigSub, 40000)).prompt, 9000);
assert.ok(tiny.after <= 9000 && tiny.steps.includes("middle cut") && tiny.prompt.includes(" REFERENCE IMAGES are attached: Image 1 = Fondamenta whole plate"));
locations.splice(locations.indexOf(big), 1, owner); locations.splice(locations.indexOf(bigSub), 1, sub);
metas[owner.id].spatialPlanSig = box.locationSpatialPlanSig(owner.spatialPlan);

/* ---- 4. the final check: any prompt fits, by the same order, never refused, never at the reference list ---- */
const tailText = " REFERENCE IMAGES are attached: Image 1 = the parent plate; Image 2 = screenplay page 1. Never copy screenplay typography.";
const under = "a lighthouse at dusk" + tailText;
assert.equal(box.nbFitImagePrompt(under, 31500).prompt, under, "a prompt that fits is untouched");
const longProse = "Shot: " + "the harbour at night with fishing boats and nets drying on the wall, ".repeat(700) + "CAMERA: low angle." + tailText;
const fitted = box.nbFitImagePrompt(longProse, 31500);
assert.ok(fitted.after <= 31500 && fitted.prompt.endsWith(tailText) && fitted.prompt.startsWith("Shot: the harbour"));
assert.ok(fitted.prompt.includes("CAMERA: low angle."), "the end of the body stays");
assert.deepEqual(json(fitted.steps), ["middle cut"]);
const shotPrompt = "Compose a new cinematic still. Image 1 is Marcus's character sheet.\n\n— Medium shot, eye level, 50mm. Marcus enters.\n\nFULL SCENE CONTEXT (background only; exact screenplay text for the entire selected scene):\nSCREENPLAY SOURCE REVISION: r1\n"
  + "[BEAT 2 · ACTION] He crosses the room.\n".repeat(1200) + "\n\nTARGET BEAT OPENING (the only action/cast authority for this first frame):\n[BEAT 1 · ACTION] MARCUS enters.\n\nConstraints: no text.";
const shotFit = box.nbFitImagePrompt(shotPrompt, 31500);
assert.deepEqual(json(shotFit.steps), ["full-scene text left out"]);
assert.ok(shotFit.prompt.includes("TARGET BEAT OPENING (the only action/cast authority for this first frame):\n[BEAT 1 · ACTION] MARCUS enters.") && shotFit.prompt.includes("Medium shot, eye level"));
const dupAvoid = "Render a quay. AVOID: " + Array.from({ length: 4000 }, (_, i) => "people, characters, term" + (i % 40)).join(", ") + "." + tailText;
const avoidFit = box.nbFitImagePrompt(dupAvoid, 30000);
assert.equal(avoidFit.steps[0], "AVOID list once"); assert.ok(avoidFit.after <= 30000 && avoidFit.prompt.endsWith(tailText));
// a location spec the builder never saw (an older card's indented JSON): compact, then locationFitPromptSpec's order
const old = (await masterPrompt(sub, 31500)).spec.replace(/^([^\n]*\n)(\{.*\})( AVOID: .*)$/s, (m, h, js, av) => h + JSON.stringify(JSON.parse(js), null, 1) + av) + tailText;
assert.match(old, /\n "task"/, "an indented spec");
const oldFit = box.nbFitImagePrompt(old, old.length - 1);
assert.deepEqual(json(oldFit.steps), ["compact JSON"]); assert.ok(oldFit.prompt.endsWith(tailText) && !/\n "task"/.test(oldFit.prompt));
// a refusal for the prompt's length is recognised (the simplified retry takes it, as it takes "no image")
assert.ok(box.nbIsPromptLengthError({ code: "prompt_too_long" }));
assert.ok(box.nbIsPromptLengthError(new Error("Image model GPT Image 2.5 Flare: prompt: String should have at most 32000 characters")));
assert.ok(!box.nbIsPromptLengthError(new Error("The model returned no image")));

/* proxyGenerate itself: the check runs after the identity text is added, before the request; a server
   prompt_too_long (its own, stricter limit) is re-fitted and sent once more — never put to the user */
const pg = slice(imagegen, "let _nbResCapToastShown = false;", "\nwindow.proxyGenerate = proxyGenerate;");
let invokes = [], serverLimit = 0;
// proxyGenerate's 6½-minute give-up timer must not keep this test alive: long timers are not armed here
box.setTimeout = (fn, ms) => (ms >= 60000 ? 0 : setTimeout(fn, ms));
Object.assign(box, { nbAssertMediaIdentity: () => true, nbGetAspect: () => "16:9", nbGetRes: () => "2K", nbModelRes: (m, r) => r, nbModelLabel: (m) => m,
  nbModelMaxRes: () => "4K", nbGetOaiQuality: () => "high", nbRequireImageQuality: async () => true, nbModelMaxRefs: () => null, nbModelGrounds: () => false,
  downscaleRef: async (u) => u, isGptImageModel: (m) => /^gpt-image/.test(m), cropImageToAspect: async (u) => u, nbImageCredits: () => 1,
  nbCanonicalMediaPrompt: (p, o) => o && o.identity ? p + "\n\nCANONICAL CHARACTER IDENTITY (binding): " + o.identity : p,
  sbClient: () => ({ functions: { invoke: async (fn, { body }) => {
    invokes.push(body);
    if (serverLimit && body.prompt.length > serverLimit) { const e = new Error("non-2xx"); e.context = { status: 400, json: async () => ({ code: "prompt_too_long", limit: serverLimit, error: "too long" }) }; return { data: null, error: e }; }
    return { data: { url: "https://img/ok.png" }, error: null }; } } }) });
vm.runInContext(pg, box, { filename: "app/imagegen.jsx#proxyGenerate" });
const metaOut = {};
const url = await box.proxyGenerate(longProse, { model: "gpt-image-2.5-flare", identity: "Marcus: 40s, tall.", metaOut }, "fal");
assert.equal(url, "https://img/ok.png");
assert.equal(invokes.length, 1); assert.ok(invokes[0].prompt.length <= 31500);
assert.ok(invokes[0].prompt.endsWith("\n\nCANONICAL CHARACTER IDENTITY (binding): Marcus: 40s, tall."), "the identity block is never cut");
assert.ok(invokes[0].prompt.includes(tailText.trim()), "nor the reference list");
assert.deepEqual(json(metaOut.promptFit.steps), ["middle cut"]); assert.equal(metaOut.promptFit.limit, 31500);
invokes = []; serverLimit = 20000;
await box.proxyGenerate(longProse, { model: "gpt-image-2.5-flare" }, "fal");
assert.equal(invokes.length, 2, "refused before any hold → fitted to the server's limit and sent once more");
assert.ok(invokes[1].prompt.length <= 20000 && invokes[1].prompt.endsWith(tailText));
invokes = []; serverLimit = 50;
await assert.rejects(box.proxyGenerate("x".repeat(3000), { model: "gpt-image-2.5-flare" }, "fal"), (e) => e.promptTooLong === true && !/shorten/i.test(e.message));
serverLimit = 0;

console.log("PASS image prompt budget: one table (app = server), every Glass Hours location prompt fits every engine by its builder ("
  + report.length + " prompts, longest " + Math.max(...report.map((r) => r[1])) + " characters; Fondamenta DEI Vetrai " + fv.prompt.length
  + " — it was 33,577), a largest layout fits by the documented order, the final check never refuses or cuts the reference list");

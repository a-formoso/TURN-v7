#!/usr/bin/env node
/* test-location-single-panels.mjs — SINGLE CUT-OUT PANELS, NEVER THE WHOLE SHEET (owner-approved 2026-10-14, "go ahead
   with all of it" — fix C of the Fondamenta plan, with the critique's corrections).
   Glass Hours' "Fondamenta DEI Vetrai" plate was sent Fondamenta's WHOLE 2x2 sheet as a required "need" Image 1 (768 px,
   each panel ~384 px), its room & time / environment-state plates sent it again with the old "Read ALL panels …
   reproduce that exact room" note, and the layout's source sheet rode along to every sub-space plate. Now, in EVERY
   sub-space path (its 2x2 plate on the card and headless, its room & time plates, its environment states and each
   one's simplified retry — a sub-space has no extra-space plates: those belong to a main location and are made from
   its OWN plate, §8):
   1. the parent goes in as single panels cut out of its plate: the quadrants matched to a view through an opening (at
      their own size, up to 1536 px, required and numbered, labelled for that opening) — never the whole sheet;
   2. when no quadrant is matched (the parent's cameras unknown, or none faces that way): at most ONE small panel
      (640 px) labelled "materials and colour only" — OPTIONAL: it can be unticked; a close-up that doesn't show this
      space (from the parent's recorded cameras when it has them), else the parent's requested "signature material
      detail" close-up; an unreadable one is left out;
   3. the layout's own source sheet reaches only the location that owns it (a sub-space gets the layout as text);
   4. the parent's plate must still exist first ("needed"), and stays the plate's upstream dependency;
   5. prices count what is really attached (the panels, not a sheet);
   6. a plate made before its cameras were recorded can be given them on its card (Plate cameras "This plate's
      cameras": each panel's direction by hand — free — or "Read the cameras from this plate", the Draft floor plan
      read keeping only the cameras, priced on the button), for that plate version only (l.plateCameras), without
      changing its prompt or layout; the rooms inside then get the matched panels;
   7. Frances knows (APP_FEATURES);
   8. the headless runs (2026-10-14, headless paths — the Location Scout, "Make what this scene needs") pass the STORED
      card, which has a parentKey and no parentLocation: every path here runs on that shape (the cards on the card's own
      shape, with parentLocation), and sends the same panels — a room & time plate from those runs used to get none;
      an extra-space plate (a main location's only) is made from its own location's plate, on the real card code.
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json). All providers and
   persistence are mocked; nothing is generated or charged. node scripts/test-location-single-panels.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const noop = () => {};
let hooks = [], cursor = 0, effects = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (init) => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof init === "function" ? init() : init;
    return [hooks[i], (v) => hooks[i] = typeof v === "function" ? v(hooks[i]) : v]; },
  useReducer: (fn, init) => React.useState(init),
  useRef: (init) => { const i = cursor++; return hooks[i] || (hooks[i] = { current: init }); },
  useEffect: (fn, deps) => { const i = cursor++; effects.push(fn); hooks[i] = deps; },
};
let durl = 0;
const fakeCanvas = () => ({ width: 0, height: 0, getContext: () => ({ font: "15px", measureText: (t) => ({ width: String(t).length * 9 }), fillRect() {}, fillText() {} }),
  toDataURL: () => "data:image/png;base64,PAGE" + (++durl) });
const metas = {}, images = {}, crops = [], toasts = [];
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal",
  document: { createElement: () => fakeCanvas() }, worldScaleClause: () => "", appToast: (m) => toasts.push(m),
  nbCostChip: (n, o) => ({ type: "cost", props: { n, refs: o && o.refs }, children: ["≈ cost"] }),
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "",
  oaiToDataUrl: async (u) => "data:" + u,
  cropRegionAsDataUrl: async (url, rect, max, min) => { crops.push(min ? { url, rect, max, min } : { url, rect, max }); return "crop(" + url + "@" + rect.x + "," + rect.y + "/" + max + ")"; } };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
vm.runInContext(read("app/locations-ui.jsx"), box, { filename: "app/locations-ui.jsx" });
const json = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const locations = film.locations.map((l) => ({ ...l }));
const byId = (id) => locations.find((l) => l.id === id);
const owner = byId("loc-fondamenta-3"), sub = byId("loc-fondamenta-dei-vetrai-4");
/* the STORED card, as the Location Scout and "Make what this scene needs" pass it: a parentKey, no parentLocation (the
   test used to add one by hand, which hid that those runs sent a room & time plate no panel of the parent) */
assert.equal(sub.parentKey, "fondamenta"); assert.ok(!("parentLocation" in sub), "the stored record shape");
// the card's own shape (locations-ui.jsx LocationSheets adds parentLocation) — only for the card code below
const subCard = () => ({ ...sub, parentLocation: { id: owner.id, key: owner.key, name: owner.name } });
const units = box.deriveSluglineUnits(film.scenes, film.drafts);
box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [], sluglineUnits: units };
box.TURN_DATA = { PROJECT: film.project };
const PLATE = "https://cdn/plate-fondamenta.png", ISO = "2026-10-13T10:00:00Z";
images[owner.id] = PLATE; metas[owner.id] = { iso: ISO, spatialPlanSig: box.locationSpatialPlanSig(owner.spatialPlan) };
const noSheet = (refs, label) => { assert.ok(!refs.some((r) => r.url === PLATE || r.url === "data:" + PLATE), label + ": never the parent's whole sheet");
  assert.ok(!JSON.stringify(json(refs.map((r) => r.note))).match(/whole plate|Read ALL panels|reproduce that exact room|Cross-read ALL panels/), label + ": no sheet-copy note"); };

/* ---- 2. the parent's cameras unknown: ONE optional small material panel ---- */
crops.length = 0;
let sub1 = await box.locationSubspacePlateReferences(sub);
noSheet(sub1.refs, "the room's plate");
assert.equal(sub1.refs.length, 1);
const mat = sub1.refs[0];
assert.deepEqual(json({ refId: mat.refId, required: mat.required, numbered: mat.numbered, maxDim: mat.maxDim, label: mat.label }),
  { refId: "pm-loc-fondamenta-3-br", required: false, numbered: true, maxDim: 640, label: "Fondamenta · materials and colour only" });
assert.match(mat.note, /^Fondamenta — ONE panel of its plate, small: materials and colour only\. It is NOT a view: never copy its composition, framing or layout into Fondamenta DEI Vetrai or any of its panels$/);
assert.deepEqual(json(crops), [{ url: "data:" + PLATE, rect: { x: 50.5, y: 50.5, w: 49, h: 49 }, max: 640 }], "the bottom-right close-up ('Stone quay edge'), cut out small");
assert.equal(sub1.plan.unresolved[0].reason, "no-record");
// the parent's recorded cameras say its bottom-right shows this space: (owner 2026-10-27) THAT panel is sent, as the
// space's own look, scaled up to a reference size — not a materials-only close-up of something else
metas[owner.id] = { ...metas[owner.id], platePanels: { schema: "cm-plate-panels-v1", spaceId: owner.id, panels: {
  BR: { yaw: 270, lensMm: 35, childrenVisible: [{ spaceId: sub.id }] }, BL: { yaw: 0, lensMm: 35, purpose: "close-up of the façade" } } } };
crops.length = 0;
{
  const shown = (await box.locationSubspacePlateReferences(sub)).refs;
  assert.equal(shown.length, 1);
  assert.deepEqual(json({ refId: shown[0].refId, required: shown[0].required, maxDim: shown[0].maxDim, label: shown[0].label }),
    { refId: "pv-loc-fondamenta-3-br", required: false, maxDim: 1536, label: "Fondamenta · its view of Fondamenta DEI Vetrai" });
  assert.match(shown[0].note, /^Fondamenta — the panel of its plate that shows Fondamenta DEI Vetrai itself: the same room\. Keep its architecture, surfaces, fixtures, colour and light; each panel takes the camera the prompt states, never this panel's framing\.$/);
  assert.deepEqual(json(crops), [{ url: "data:" + PLATE, rect: { x: 50.5, y: 50.5, w: 49, h: 49 }, max: 1536, min: 1536 }], "cut at a reference size");
}
delete metas[owner.id].platePanels;
// an unreadable material panel is simply left out
box.cropRegionAsDataUrl = async () => "";
assert.equal((await box.locationSubspacePlateReferences(sub)).refs.length, 0);
box.cropRegionAsDataUrl = async (url, rect, max, min) => { crops.push(min ? { url, rect, max, min } : { url, rect, max }); return "crop(" + url + "@" + rect.x + "," + rect.y + "/" + max + ")"; };

/* ---- 6 · 1. the plate's cameras noted on its card → the matched quadrant, cut out at its own size ---- */
owner.plateCameras = box.normalizeLocationPlateCameras({ iso: ISO, source: "set", panels: { TR: { yaw: 90 }, TL: { yaw: 0 }, BL: { yaw: 0, lensMm: 35 } } });
assert.deepEqual(json(owner.plateCameras), { iso: ISO, source: "set", panels: {
  TL: { yaw: 0, pitch: 0, lensMm: 24, position: null, basis: "user" }, TR: { yaw: 90, pitch: 0, lensMm: 24, position: null, basis: "user" },
  BL: { yaw: 0, pitch: 0, lensMm: 35, position: null, basis: "user" } } });
crops.length = 0;
sub1 = await box.locationSubspacePlateReferences(sub);
noSheet(sub1.refs, "with noted cameras");
assert.equal(sub1.refs.length, 1, "the matched panel alone — no material panel beside it");
assert.deepEqual(json({ refId: sub1.refs[0].refId, required: sub1.refs[0].required, numbered: sub1.refs[0].numbered, maxDim: sub1.refs[0].maxDim }),
  { refId: "pq-loc-fondamenta-3-tr", required: true, numbered: true, maxDim: 1536 });
// (2026-10-27) scaled up to at least 1536 px when the plate is small
assert.deepEqual(json(crops), [{ url: "data:" + PLATE, rect: { x: 50.5, y: 0.5, w: 49, h: 49 }, max: 1536, min: 1536 }], "the top-right quadrant at a reference size");
assert.match(sub1.refs[0].note, /^Fondamenta seen facing east — the top-right panel of its plate: use ONLY for what is visible through the archway “Quay continues east to landing” in the top-left panel; never as Fondamenta DEI Vetrai itself and never as a backdrop$/);
assert.equal(sub1.plan.unresolved.length, 0);
const spec = JSON.parse(box.buildLocationRefPrompt(sub, film.project, { panelPlan: sub1.plan, panelRefs: box.locationReferenceNumbers(sub1.refs) }).split("\n").slice(1).join("\n"));
assert.match(spec.views.top_left, /Its open side “Quay continues east to landing” \(east\) looks east along Fondamenta: match Image 1 for what lies beyond it\./);
// noted for an older plate version: not used (that plate is gone) — the material panel again
owner.plateCameras = { ...owner.plateCameras, iso: "an-older-plate" };
assert.equal((await box.locationSubspacePlateReferences(sub)).refs[0].refId, "pm-loc-fondamenta-3-br");
owner.plateCameras = box.normalizeLocationPlateCameras({ iso: ISO, source: "read", panels: { TR: { yaw: 90 } } });
assert.equal(box.normalizeLocationPlateCameras({ iso: ISO, panels: { TR: {} } }), null, "a panel without a direction says nothing");
assert.equal(box.normalizeLocationPlateCameras({ panels: { TR: { yaw: 90 } } }), null, "tied to a plate version");

/* ---- 5. the prices count what is attached ---- */
assert.equal(box.locationPlateFixedRefCount(sub).n, 1, "one cut-out panel (no whole sheet)");
const subUnit = units.find((u) => u && !u.orphan && String(u.subspaceKey || u.locationKey || "") === sub.key);
assert.ok(subUnit, "the quay stretch has a room & time unit");
const unitCount = box.sluglineUnitPlateRefCount(sub, subUnit, { rootPlate: true });
const unitPages = box.locationScreenplayReferenceImages(sub, box.sluglineUnitPseudoSheet(box.sluglineUnitImageId(subUnit.key), subUnit), film.scenes, film.drafts, { countOnly: true }).pageCount;
assert.equal(unitCount.n, unitPages + 2, "its pages, its room's plate and the root's ONE panel");
delete owner.plateCameras;

/* ---- 3. the layout's source sheet reaches only its owner ---- */
owner.spatialPlan = { ...owner.spatialPlan, source: { assetId: owner.id, iso: ISO } };   // the layout read from the plate
assert.deepEqual(json(await box.locationSpatialReferences(sub)), [], "a sub-space gets the layout as text");
assert.equal((await box.locationSpatialReferences(owner))[0].url, PLATE, "the owner still reads its own source sheet");
assert.equal(box.locationParentViewRefCount(sub, box.locationParentViewRequest(sub, "opening-4")), 1);

/* ---- the room's plate, headless (Generate all, the Location Scout, "Make what this scene needs") and its retry ---- */
const sent = [], commits = [];
let failFirst = false;
Object.assign(box, { nbEpoch: () => 1, nbGetRes: () => "2K",
  nbGenerate: async (prompt, o) => { sent.push({ prompt, o }); if (failFirst) { failFirst = false; throw new Error("no image"); } return "https://img/out.png"; },
  nbCommit: async (id, url, meta, refs) => { commits.push({ id, meta, refs }); return { tier: "cloud" }; } });
crops.length = 0;
assert.equal(await box.generateLocationPlate(sub, film.project, {}), true);
const firstImage = sent[0].o.extraImages[0];
assert.match(firstImage, /^crop\(data:https:\/\/cdn\/plate-fondamenta\.png@50\.5,50\.5\/640\)$/);
assert.ok(!sent[0].o.extraImages.includes(PLATE), "headless: never the whole sheet");
assert.equal(sent[0].o.extraImageMaxDims[0], 640);
assert.equal(sent[0].o.referencesNumbered, true);
assert.match(sent[0].prompt, /REFERENCE IMAGES \(binding\): Image 1 = Fondamenta — ONE panel of its plate, small: materials and colour only/);
assert.equal(commits[0].meta.locationParentIso, ISO, "the parent plate it was cut from is recorded");
// the simplified retry re-sends the same single panel, and keeps the outdoor cameras and the panel rule
sent.length = 0; commits.length = 0; failFirst = true;
assert.equal(await box.generateLocationPlate(sub, film.project, {}), true);
assert.equal(sent.length, 2);
assert.deepEqual(json(sent[1].o.extraImages), json(sent[0].o.extraImages), "the retry re-sends the single panel");
assert.ok(!sent[1].o.extraImages.includes(PLATE));
assert.match(sent[1].prompt, /Four cameras standing on Fondamenta DEI Vetrai at eye level/);
assert.match(sent[1].prompt, /Any reference image of Fondamenta is a single cut-out panel of its plate — never copy one as a view of Fondamenta DEI Vetrai/);
assert.match(sent[1].prompt, /Image 1 = Fondamenta — ONE panel of its plate, small: materials and colour only/);

/* ---- its room & time plate (headless) and environment state ---- */
images[sub.id] = "https://cdn/plate-sub.png"; metas[sub.id] = { iso: "s1" };
sent.length = 0; commits.length = 0;
assert.equal(await box.generateSluglineUnitPlate(sub, subUnit, film.project, {}), true);
const unitImgs = json(sent[0].o.extraImages);
assert.ok(!unitImgs.includes(PLATE), "room & time: never the parent's sheet");
assert.equal(unitImgs.filter((u) => /^data:image\/png;base64,PAGE/.test(u)).length, unitPages, "its screenplay pages");
assert.deepEqual(unitImgs.slice(unitPages), ["https://cdn/plate-sub.png", "crop(data:https://cdn/plate-fondamenta.png@50.5,50.5/640)"], "its room's own plate, then the root's ONE panel");
assert.equal(sent[0].o.referencesNumbered, true);
assert.doesNotMatch(sent[0].prompt, /Read ALL panels|reproduce that exact room/);
// the root has no plate: the room & time plate still goes, without it (as before)
delete images[owner.id];
sent.length = 0;
assert.equal(await box.generateSluglineUnitPlate(sub, subUnit, film.project, {}), true);
assert.ok(!json(sent[0].o.extraImages).some((u) => /fondamenta/.test(u) && !/plate-sub/.test(u)));
images[owner.id] = PLATE;
// an environment state — this one is the quay's Night room & time (the Location Scout makes those here): its unit's
// page first, as on its card (2026-10-14, headless paths), then its room's plate and the root's ONE panel
sent.length = 0; commits.length = 0;
await box.generateLocationVariant(sub, { id: "night", time: "Night", state: "Acqua alta over the stones" }, film.project);
assert.deepEqual(json(sent[0].o.extraImages.slice(1)), ["https://cdn/plate-sub.png", "crop(data:https://cdn/plate-fondamenta.png@50.5,50.5/640)"]);
assert.match(sent[0].o.extraImages[0], /^data:image\/png;base64,PAGE/, "scene 13's page");
assert.deepEqual(json(sent[0].o.extraImageMaxDims), [1536, 1024, 640]);
assert.match(sent[0].prompt, /Image 1 = screenplay page 1 for Fondamenta dei Vetrai \(Scene 13\)/);
assert.match(sent[0].prompt, /Image 3 = Fondamenta — ONE panel of its plate, small: materials and colour only/);
assert.match(sent[0].prompt, /"screenplay_excerpt":"the screenplay of these scenes is attached as page images \(Image 1\)/);
assert.equal(commits[0].meta.locationUpstream.filter((u) => /^script-/.test(u.id)).length, 0, "a page is never an upstream plate");
assert.ok(commits[0].meta.locationUpstream.some((u) => u.id === owner.id && u.iso === ISO), "the parent's plate stays an upstream dependency");
// the parent's plate missing: the state waits for it (nothing is sent)
delete images[owner.id];
sent.length = 0;
await assert.rejects(box.generateLocationVariant(sub, { id: "night", time: "Night" }, film.project), /Generate or restore Fondamenta's plate first/);
assert.equal(sent.length, 0);
images[owner.id] = PLATE;

/* ---- the cards: room & time / environment-state references (locations-ui.jsx) ---- */
const pseudo = { id: "u1", name: subUnit.name, role: "EXT", sceneNos: subUnit.sceneNos, scriptExcerpt: "", summary: "" };
let cardRefs = await box.buildSluglineUnitReferences(subCard(), subUnit, "u1", pseudo, film.scenes, film.drafts, "");
noSheet(cardRefs, "the state card");
const root = cardRefs.find((r) => /^pm-/.test(r.refId));
assert.ok(root && root.required === false && root.ready, "the root's panel shows as optional — it can be unticked (no 'need' badge)");
assert.equal(cardRefs.find((r) => r.refId === sub.id).required, true, "the room's own plate stays required");
delete images[owner.id];
cardRefs = await box.buildSluglineUnitReferences(subCard(), subUnit, "u1", pseudo, film.scenes, film.drafts, "");
assert.deepEqual(json(cardRefs.filter((r) => r.refId === owner.id).map((r) => [r.required, r.ready])), [[true, false]], "the root's plate missing: one 'needed' slot (the card waits)");
images[owner.id] = PLATE;
const ui = read("app/locations-ui.jsx");
assert.ok(!/locationParentReference\(|locationSubspaceParentReference/.test(ui), "no card path sends the old whole-sheet reference");
assert.equal((ui.match(/plates\.push\(\.\.\.await _locRootRefsFor\(l, grab\)\)/g) || []).length, 2, "the room & time and environment-state cards both use the single panels");
assert.match(ui, /if\(parentRefUrl\) rootRefs\.forEach\(r=>out\.push\(r\)\);/, "the room's own card shows the panels it will send");
assert.match(ui, /parentRefs=sub\.refs\.filter\(r=>r\.required!==false\|\|masterRefOff\.indexOf\(r\.refId\)<0\)/, "an unticked material panel stays out");
assert.match(ui, /\.\.\.\(r\.numbered\?\{numbered:true\}:\{\}\)/);
const locs = read("app/locations.jsx");
assert.ok(!/function locationParentReference\(|function locationSubspaceParentReference\(/.test(locs), "the whole-sheet references are gone");

/* ---- 6. Plate cameras on the parent's card: "This plate's cameras" ---- */
const flat = (n) => !n || typeof n !== "object" ? [] : [n, ...(n.children || []).flatMap(flat)];
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
const render = (props) => { cursor = 0; effects = []; return box.LocationPlateCameras(props); };
const writes = [];
const props = { l: owner, project: film.project, onUpdate: (id, patch) => writes.push({ id, patch }), readOnly: false, plateMeta: { iso: ISO } };
box.aiPlateCamerasReadCostText = () => "about 1 writing call on Test Model";
hooks = [];
let tree = render(props), t = text(tree);
assert.match(t, /This plate's cameras/);
assert.match(t, /This plate was made before its cameras were recorded, so Fondamenta DEI Vetrai can't use its panels — it gets one small panel of it for materials and colour only\. Say which way each panel faces \(free\), or read them from the plate\./);
const facing = (k) => flat(tree).find((n) => n.type === "label" && text(n).startsWith({ TL: "Top-left", TR: "Top-right", BL: "Bottom-left", BR: "Bottom-right" }[k] + " faces"));
const sel = flat(facing("TR")).find((n) => n.type === "select");
assert.equal(sel.props.value, "", "not known yet");
sel.props.onChange({ target: { value: "90" } });
assert.deepEqual(json(writes.pop()), { id: owner.id, patch: { plateCameras: { iso: ISO, source: "set", panels: { TR: { yaw: 90, pitch: 0, lensMm: 24, position: null, basis: "user" } } } } });
const readBtn = flat(tree).find((n) => n.type === "button" && /^Read the cameras from this plate/.test(text(n)));
assert.ok(readBtn, "the paid read is offered");
assert.match(text(readBtn), / · about 1 writing call on Test Model$/, "priced on the button");
assert.match(readBtn.props.title, /Uses writing credits, not image credits/);
let readCalls = 0;
box.aiReadPlateCameras = async (l) => { readCalls++; return { iso: ISO, source: "read", panels: { TL: { yaw: 0, pitch: 0, lensMm: 24, position: [0, -9, 1.6], basis: "observed" }, TR: { yaw: 90, pitch: -10, lensMm: 18, position: null, basis: "observed" } } }; };
await readBtn.props.onClick();
assert.equal(readCalls, 1);
assert.equal(json(writes.pop()).patch.plateCameras.source, "read");
assert.match(toasts.pop(), /^Read 2 cameras from Fondamenta's plate — the rooms inside can now use its panels\.$/);
// once noted: said, editable, clearable
owner.plateCameras = box.normalizeLocationPlateCameras({ iso: ISO, source: "set", panels: { TR: { yaw: 90 } } });
hooks = []; tree = render(props); t = text(tree);
assert.match(t, /Set by hand for this plate\. Fondamenta DEI Vetrai can now use the panel of it that faces the way a window, door or open side looks\./);
assert.equal(flat(facing("TR")).find((n) => n.type === "select").props.value, "90");
const clear = flat(tree).find((n) => n.type === "button" && text(n) === "Clear");
clear.props.onClick();
assert.deepEqual(json(writes.pop()), { id: owner.id, patch: {} }, "Clear removes them (plateCameras: undefined)");
// view only: nothing can be changed or read
hooks = []; tree = render({ ...props, readOnly: true });
assert.ok(flat(tree).filter((n) => n.type === "select" && n.props.className === "prop-select").every((n) => n.props.disabled));
assert.ok(flat(tree).find((n) => n.type === "button" && /^Read the cameras/.test(text(n))).props.disabled);
// a plate that recorded its cameras (or no rooms inside) needs none of this
hooks = []; assert.doesNotMatch(text(render({ ...props, plateMeta: { iso: ISO, platePanels: { panels: { TL: { yaw: 0 } } } } })), /This plate's cameras/);
const lone = byId("loc-hotel-bar-5");
hooks = []; assert.doesNotMatch(text(render({ ...props, l: lone })), /This plate's cameras/);
delete owner.plateCameras;
// the reviewed layout was read from THIS plate (step B): its observed cameras already serve the rooms — nothing to ask
const ownerPlanBefore = owner.spatialPlan;
owner.spatialPlan = box.normalizeLocationSpatialPlan({ ...ownerPlanBefore, status: "reviewed", source: { assetId: owner.id, iso: ISO },
  coordinates: { ...ownerPlanBefore.coordinates, cameras: [{ spaceId: owner.id, panel: "TR", yaw: 90, basis: "observed" }] } });
assert.equal(box.locationViewCandidates(owner, sub).recorded, true, "(the layout knows the plate's cameras)");
hooks = []; assert.doesNotMatch(text(render(props)), /This plate's cameras/);
owner.spatialPlan = ownerPlanBefore;
// a room with rooms inside it (a plate made before its cameras were recorded): set by hand only — the read is the
// Draft floor plan read, which only a location that owns its layout has
const nook = { id: "loc-nook", key: "nook", name: "Bench nook", intExt: "EXT", parentKey: sub.key, scenes: [] };
locations.push(nook);
hooks = []; tree = render({ ...props, l: sub, plateMeta: { iso: "s-old" } }); t = text(tree);
assert.match(t, /This plate was made before its cameras were recorded, so Bench nook can't use its panels — it gets one small panel of it for materials and colour only\. Say which way each panel faces \(free\)\./);
assert.ok(!flat(tree).some((n) => n.type === "button" && /^Read the cameras/.test(text(n))), "no read for a room inside a location");
assert.ok(flat(tree).some((n) => n.type === "select" && n.props.className === "prop-select" && !n.props.disabled), "its facings can still be set");
locations.splice(locations.indexOf(nook), 1);
// the room's card says where to fix an unknown facing, and that an outdoor part's cameras stand on it
hooks = []; t = text(render({ ...props, l: sub, plateMeta: null }));
assert.match(t, /Fondamenta's plate was made before its cameras were recorded, so its panels' facings are unknown — set them \(free\) or read them from the plate under Fondamenta's Plate cameras\./);
assert.match(t, /Each panel of Fondamenta DEI Vetrai's plate is a camera standing on Fondamenta DEI Vetrai, part of Fondamenta, at eye level/);
assert.match(t, /Camera standing on Fondamenta DEI Vetrai, part of Fondamenta, at x -7\.2 m, y -2\.7 m, 1\.6 m up, facing east \(90°\)/);
assert.match(t, /one panel cut out of Fondamenta's plate, never its whole sheet \(on some engines each reference adds a little to the price\)/);

/* ---- 6. "Read the cameras from this plate" (ai.jsx aiReadPlateCameras) ---- */
const ai = read("app/ai.jsx");
const ast = parseSync(ai, { sourceType: "script", parserOpts: { plugins: ["jsx"] }, babelrc: false, configFile: false });
for (const name of ["aiReadPlateCameras", "aiPlateCamerasReadCostText"]) {
  const fn = ast.program.body.find((n) => n.type === "FunctionDeclaration" && n.id.name === name);
  vm.runInContext(ai.slice(fn.start, fn.end), box);
}
let drafted = null;
box.aiDraftLocationSpatialPlan = async () => drafted;
const draftWith = (cameras, originId, iso = ISO) => box.normalizeLocationSpatialPlan({ frame: "Quay frame", anchors: [{ id: "a", space: "Fondamenta", name: "A", placement: "p" }],
  status: "draft", source: { assetId: owner.id, iso }, coordinates: { origin: { anchorId: originId }, spaces: [], cameras } });
drafted = draftWith([
  { spaceId: owner.id, panel: "TL", position: [15, -6, 1.6], yaw: 0, pitch: 0, lensMm: 24, basis: "observed" },
  { spaceId: "Fondamenta", panel: "TR", position: [-28, -4, 6], yaw: 89, pitch: -8, lensMm: 18, basis: "observed" },
  { spaceId: owner.id, panel: "BL", position: [-1, -2, 1.5], yaw: 0, lensMm: 35, basis: "design" },               // proposed, not read
  { spaceId: sub.id, panel: "BR", position: [3, -2, 1.6], yaw: 220, lensMm: 35, basis: "observed" }], "fv-side-door");  // another space's
let rec = json(await box.aiReadPlateCameras(owner, film.scenes, film.project));
assert.deepEqual(rec, { iso: ISO, source: "read", panels: {
  TL: { yaw: 0, pitch: 0, lensMm: 24, position: [15, -6, 1.6], basis: "observed" },
  TR: { yaw: 89, pitch: -8, lensMm: 18, position: [-28, -4, 6], basis: "observed" } } }, "only this plate's observed cameras, in the saved layout's frame");
drafted = draftWith([{ spaceId: owner.id, panel: "TL", position: [15, -6, 1.6], yaw: 0, lensMm: 24, basis: "observed" }], "another-origin");
assert.equal(json(await box.aiReadPlateCameras(owner, [], {})).panels.TL.position, null, "another origin: facings only, never misplaced positions");
drafted = draftWith([{ spaceId: owner.id, panel: "TL", yaw: 0, basis: "observed" }], "fv-side-door", "another-version");
await assert.rejects(box.aiReadPlateCameras(owner, [], {}), /The plate changed during the read\. Nothing was saved\./);
drafted = draftWith([], "fv-side-door");
await assert.rejects(box.aiReadPlateCameras(owner, [], {}), /found no camera for this plate's panels\. Nothing was saved/);
await assert.rejects(box.aiReadPlateCameras(sub, [], {}), /Only a location with its own shared layout/);
Object.assign(box, { WRITING_MODELS: [{ id: "m1", label: "Text Only", provider: "moonshot" }, { id: "m2", label: "Vision One", provider: "google" }],
  getWritingModelId: () => "m1", recommendedWritingModelId: () => "m2" });
assert.equal(box.aiPlateCamerasReadCostText(), "about 1 writing call on Vision One", "priced on the engine the vision read really uses");
assert.match(ui, /const rec=await window\.aiReadPlateCameras\(l,\(\(window\.turnContinuity\|\|\{\}\)\.scenes\)\|\|\[\],project\);/, "the card runs the read");

/* ---- 8. the headless runs pass the STORED card (2026-10-14, headless paths) ---- */
{
  // the parent's plate cameras filled in: "Make what this scene needs" sends the room & time plate the matched quadrant
  owner.plateCameras = box.normalizeLocationPlateCameras({ iso: ISO, source: "set", panels: { TR: { yaw: 90 } } });
  images[sub.id] = "https://cdn/plate-sub.png"; metas[sub.id] = { iso: "s1" };
  sent.length = 0; commits.length = 0;
  assert.ok(!("parentLocation" in sub));
  assert.equal(await box.generateSluglineUnitPlate(sub, subUnit, film.project, {}), true);
  const imgs = json(sent[0].o.extraImages);
  assert.deepEqual(imgs.slice(-2), ["https://cdn/plate-sub.png", "crop(data:https://cdn/plate-fondamenta.png@50.5,0.5/1536)"],
    "the stored card: its room's plate, then the parent's top-right quadrant cut out at its own size");
  assert.equal(sent[0].o.referencesNumbered, true);
  assert.equal(box.sluglineUnitPlateRefCount(sub, subUnit, { rootPlate: true }).n, imgs.length, "priced on the stored card as it is sent");
  assert.equal(box.sluglineUnitPlateRefCount(sub, subUnit, { rootPlate: false }).n, imgs.length - 1, "the root without a plate: nothing of it");
  // the root's plate missing: the room & time plate goes without it, as from the card
  delete images[owner.id]; sent.length = 0;
  assert.equal(await box.generateSluglineUnitPlate(sub, subUnit, film.project, {}), true);
  assert.ok(!json(sent[0].o.extraImages).some((u) => /plate-fondamenta/.test(u)));
  images[owner.id] = PLATE;
  delete owner.plateCameras;
  // a room whose card has a parentKey its list can't resolve (its parent deleted): stopped, nothing sent, as before
  sent.length = 0;
  await assert.rejects(box.generateLocationPlate({ ...sub, parentKey: "gone-place" }, film.project, {}), /Restore the parent location/);
  assert.equal(sent.length, 0);
}
/* ---- 8. extra-space plates belong to a main location: made from its OWN plate, on the real card code ---- */
{
  assert.deepEqual(json(box.deriveLocationCoverageSheets(sub, film.scenes, film.drafts, locations, units)), [], "a sub-space has no extra spaces");
  const ui8 = read("app/locations-ui.jsx");
  assert.match(ui8, /!l\.parentLocation&&coverageSheets\.length>0&&React\.createElement\("details",\{className:"loc-nested-section"\},\n\s+React\.createElement\("summary",null,"Extra spaces"\)/,
    "the card shows Extra spaces on a main location only");
  const corridor = byId("loc-hotel-staff-corridor-6");
  const sheets = box.deriveLocationCoverageSheets(corridor, film.scenes, film.drafts, locations, units);
  assert.deepEqual(json(sheets.map((x) => x.id)), ["cov-ext-hotel-staff-corridor-exterior"], "Hotel Staff Corridor: its exterior, never slugged");
  corridor.spatialPlan = box.normalizeLocationSpatialPlan({ frame: "Corridor frame", status: "reviewed", source: { assetId: corridor.id, iso: "" },
    anchors: [{ id: "door", space: "Hotel Staff Corridor", name: "Service door", placement: "end wall" }] });
  images[corridor.id] = "https://cdn/plate-corridor.png";
  let cap = null;
  Object.assign(box, { useImageGen: (o) => { cap = o; return { genUrl: "", genMeta: null, generate: noop }; }, SheetFrame: () => null });
  hooks = []; cursor = 0; effects = [];
  const tree8 = box.LocationCoverageSheet({ l: corridor, v: sheets[0], project: film.project, scenes: film.scenes, drafts: film.drafts, previousSheets: [], parentGenUrl: "", onView: noop });
  assert.ok(!flat(tree8).some((n) => n.type === box.LocationCopyCheckNotice), "no copy check: it has no parent plate to be compared with");
  crops.length = 0;
  const att = json(await cap.attachments({}, "final"));
  assert.deepEqual(att.map((r) => r.kind), ["script", "location"], "its scene's page, then its location's own plate");
  assert.equal(att[1].url, "https://cdn/plate-corridor.png", "the location's own plate, whole");
  assert.match(att[1].note, /^Hotel Staff Corridor master plate — preserve the same exterior\/interior world, materials, scale and light$/);
  assert.equal(crops.length, 0, "nothing is cut out: it is that location's own plate");
  const meta8 = await cap.metaExtra({ mode: "final", url: "https://img/x.png", iso: "x1" });
  assert.ok(!("copyCheck" in (meta8 || {})));
  delete corridor.spatialPlan; delete images[corridor.id]; delete box.useImageGen; delete box.SheetFrame;
}

/* ---- 7. Frances ---- */
const frances = ai.slice(ai.indexOf("/* OUTDOOR PARTS and SINGLE CUT-OUT PANELS"), ai.indexOf("/* the public view of every entry, memoised"));
assert.match(frances, /AN OUTDOOR PART OF A PLACE/);
assert.match(frances, /SINGLE CUT-OUT PANELS, NEVER THE WHOLE SHEET/);
assert.match(frances, /THIS PLATE'S CAMERAS/);
assert.match(frances, /'Read the cameras from this plate'/);
assert.match(frances, /Outdoors no camera stands higher than about 6 m/);
assert.doesNotMatch(ai.slice(ai.indexOf("(2026-10-13) PLATE CAMERAS"), ai.indexOf("/* LOCATION COORDINATES, step B")), /the parent's whole plate is attached small/, "the older entry no longer says the whole plate is sent");

console.log("PASS single cut-out panels: no sub-space path sends the parent's whole sheet (its plate, room & time, states, the cards, the retry — and the headless runs on the stored card, parentKey only); matched quadrants at their own size, else one optional small material panel; the layout sheet only to its owner; prices follow; a plate's cameras can be noted (free) or read (priced) for that version; Frances knows");

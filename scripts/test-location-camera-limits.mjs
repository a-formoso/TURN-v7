#!/usr/bin/env node
/* test-location-camera-limits.mjs — CAMERAS (owner-approved 2026-10-14, "go ahead with all of it": the gaps an
   independent check found in fix B of the Fondamenta plan, verifyAG B2 / B4 / B6).
   1. THE ~6 M OUTDOOR LIMIT HOLDS FOR EVERY CAMERA IN USE, not only the suggested ones: on an outdoor space (an exterior
      card, or a floor-plan space marked open to the sky) a camera from a drafted or reviewed floor plan
      (coordinates.cameras) — or one saved from an older suggestion — that stands more than 6 m above the space's floor is
      LOWERED to 6 m where it is used: the plate prompt, the plate's record, the top-down map and the Blender export
      (which keeps the floor plan's height in loweredFrom); Plate cameras says "Lowered to 6 m — outdoor cameras stay at
      eye level or a low high-angle". The floor plan and the card are never changed (stored data is not migrated). A
      camera whose position was typed by hand (Plate cameras' Edit camera, or a floor-plan camera marked "Set by hand")
      is used as typed, with a visible warning above 6 m — never silently changed. Indoors nothing changes.
   2. THE DRAFTER IS HELD TO THE SAME LIMIT: "Draft floor plan" lowers the outdoor cameras it PROPOSES (basis design
      or script) above 6 m and the draft names them; cameras it READ from a plate (observed) are kept as read — they say
      where that plate's cameras stood, and the rooms match its panels by them. The drafter is told which spaces are
      outdoor and what each is part of.
   3. AN OUTDOOR PART IS FRAMED DIFFERENTLY FROM ITS PARENT PLATE'S REAL CAMERAS: when the parent's current plate's
      cameras are known — recorded with it (meta.platePanels), noted on its card for that version (l.plateCameras, fix C)
      or read for the confirmed floor plan from it — the part's cameras are kept apart from THOSE, falling back to the
      views the plate asks for (stored, floor-plan or suggested) for panels whose camera isn't known (the verifier's
      b-noted scenario: Fondamenta's top-left noted facing east from (-7.5, -2.6) left the part's top-left facing east
      from (-7.2, -2.7), a near-repeat). A parent camera known by its facing alone keeps only the height its plate asked
      for: any camera facing that way at that height repeats it (the verifier's b-noted run 1 — "Top-left faces east"
      set by hand — used to be compared with a guessed spot 9 m away and left the part's top-left looking east). When
      every candidate repeats a parent view, the LEAST-repeating one is taken — not the first — and recorded
      (repeatsParent: on the panel, in the plate's record, in its prompt line and on Plate cameras).
   4. WHAT THE USER SEES: Plate cameras' notes (lowered; set by hand above the limit — "as set under Edit camera" / "as set
      by hand on the floor plan", never claimed as typed: changing one number under Edit camera keeps the rest of a saved
      camera), the top-down map, the draft review, and the Position hint under Floor plan numbers (the number stays as
      written; outdoors it says it is used lower unless marked Set by hand).
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json). Nothing is generated,
   nothing is charged (the drafter's model call is a stub). node scripts/test-location-camera-limits.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const noop = () => {};
let hooks = [], cursor = 0;
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (init) => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof init === "function" ? init() : init;
    return [hooks[i], (v) => hooks[i] = typeof v === "function" ? v(hooks[i]) : v]; },
  useReducer: (fn, init) => React.useState(init),
  useRef: (init) => { const i = cursor++; return hooks[i] || (hooks[i] = { current: init }); },
  useEffect: () => { cursor++; },
};
const metas = {}, images = {};
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, CustomEvent: class {},
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal",
  document: { createElement: () => ({ getContext: () => null }) }, worldScaleClause: () => "",
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "" };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
vm.runInContext(read("app/locations-ui.jsx"), box, { filename: "app/locations-ui.jsx" });
const json = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const locations = film.locations.map((l) => ({ ...l }));
const byId = (id) => locations.find((l) => l.id === id);
const owner = byId("loc-fondamenta-3"), sub = byId("loc-fondamenta-dei-vetrai-4");
const use = (list) => { box.turnContinuity = { locations: list, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [] }; return list; };
const swap = (...ls) => locations.map((l) => ls.find((x) => x.id === l.id) || l);
const withCams = (loc, cameras, extra) => ({ ...loc, spatialPlan: box.normalizeLocationSpatialPlan({ ...loc.spatialPlan, ...(extra || {}),
  coordinates: { ...loc.spatialPlan.coordinates, cameras } }) });
const flat = (n) => !n || typeof n !== "object" ? [] : [n, ...(n.children || []).flatMap(flat)];
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
const spec = (l, opts) => JSON.parse(box.buildLocationRefPrompt(l, film.project, opts).split("\n").slice(1).join("\n"));
use(locations);
assert.equal(box.LOC_OUTDOOR_MAX_Z, 6);

/* ---- 1. a drafted / reviewed floor plan's camera on an outdoor space: lowered where it is used, and said ---- */
const TR117 = { spaceId: owner.id, panel: "TR", position: [7.7, -0.1, 11.7], yaw: 254, pitch: -53, lensMm: 16, basis: "design" };
const drafted = withCams(owner, [TR117]);
let list = use(swap(drafted));
let ps = box.locationPanelPoses(drafted, list);
assert.equal(ps[1].source, "layout");
assert.deepEqual(json(ps[1].pose.position), [7.7, -0.1, 6], "the verifier's 11.7 m layout camera stands 6 m up where it is used");
assert.deepEqual(json([ps[1].pose.yaw, ps[1].pose.pitch, ps[1].pose.lensMm]), [254, -53, 16], "only its height changes");
assert.deepEqual(json(ps[1].lowered), { from: 11.7, to: 6, source: "layout" });
assert.equal(ps[1].heightWarning, undefined);
assert.deepEqual(json(ps[1].suggestedPose.position), [7.7, -0.1, 6], "'Use the suggested cameras' / 'Back to the floor plan's camera' keep the limit too");
assert.ok(ps.filter((p) => p.key !== "TR").every((p) => !p.lowered && !p.heightWarning), "the other panels say nothing");
assert.equal(drafted.spatialPlan.coordinates.cameras[0].position[2], 11.7, "the floor plan itself is not changed");
assert.equal(TR117.position[2], 11.7);
// the plate prompt, its record, the top-down map and Blender all get the camera actually used
const ownerSpec = JSON.stringify(spec(drafted));
assert.match(ownerSpec, /at x 7\.7 m, y -0\.1 m, 6 m up, facing /, "the owner plate states its floor-plan camera as used");
assert.doesNotMatch(ownerSpec, /11\.7 m up/);
assert.equal(box.locationPlatePanelRecord(drafted, list).panels.TR.position[2], 6);
const scene = box.locationFloorPlanScene(drafted, drafted.spatialPlan, list);
const mapCam = scene.cameras.find((c) => c.spaceId === owner.id && c.panel === "TR");
assert.equal(mapCam.position[2], 6); assert.deepEqual(json(mapCam.lowered), { from: 11.7, to: 6, source: "layout" });
let ex = box.locationCoordinateExport(drafted, list);
const exTR = ex.cameras.find((c) => c.panel === "TR");
assert.equal(exTR.pose.position[2], 6); assert.equal(exTR.studioCamera.position[2], 6); assert.equal(exTR.loweredFrom, 11.7);
assert.ok(ex.cameras.every((c) => !c.pose.position || c.pose.position[2] <= 6), "no exterior camera above 6 m reaches Blender");
assert.ok(ex.cameras.filter((c) => c.panel !== "TR").every((c) => !("loweredFrom" in c)));
assert.deepEqual(json(box.locationPanelCameraNotes(ps[1], owner.name, "")), [{ kind: "lowered",
  text: "Lowered to 6 m — outdoor cameras stay at eye level or a low high-angle. The floor plan puts it 11.7 m up; to keep it higher, type its position under Edit camera." }]);
// a camera READ from this very plate for the confirmed floor plan (observed): lowered for the NEXT plate, but what the
// plate showed is kept as read — the rooms inside match its panels by it
const observed = withCams(owner, [{ ...TR117, basis: "observed" }], { status: "reviewed", source: { assetId: owner.id, iso: "plate-o" } });
list = use(swap(observed)); metas[owner.id] = { iso: "plate-o" };
assert.equal(box.locationPanelPoses(observed, list)[1].pose.position[2], 6);
assert.equal(box.locationKnownPlatePanels(observed, metas[owner.id], list).panels.TR.position[2], 11.7, "what the plate showed: as read");
delete metas[owner.id];
// a typed heading over the floor plan's camera: its position still comes from the floor plan — lowered
const yawOnly = { ...drafted, coverageViews: box.locationCoverageViewsWithPose(drafted, "TR", { yaw: 200, basis: "user" }) };
list = use(swap(yawOnly));
ps = box.locationPanelPoses(yawOnly, list);
assert.deepEqual(json([ps[1].source, ps[1].pose.yaw, ps[1].pose.position, ps[1].lowered.source]), ["set", 200, [7.7, -0.1, 6], "layout"]);

/* ---- 1b. a camera saved from an older suggestion (basis design): lowered too, said so ---- */
const savedOld = { ...owner, coverageViews: box.locationCoverageViewsWithPose(owner, "TR", { position: [-29.7, -4.5, 11.7], yaw: 89.5, pitch: -14, lensMm: 18, basis: "design" }) };
list = use(swap(savedOld));
ps = box.locationPanelPoses(savedOld, list);
assert.deepEqual(json([ps[1].source, ps[1].pose.position, ps[1].lowered]), ["set", [-29.7, -4.5, 6], { from: 11.7, to: 6, source: "saved" }]);
assert.match(box.locationPanelCameraNotes(ps[1], owner.name, "")[0].text, /^Lowered to 6 m — outdoor cameras stay at eye level or a low high-angle\. It was saved 11\.7 m up; to keep it higher, type its position under Edit camera\.$/);
assert.equal(savedOld.coverageViews.find((v) => v.panel === "TR").pose.position[2], 11.7, "the card is not changed");

/* ---- 1c. a height typed by hand is respected — with a visible warning above 6 m, never changed ---- */
const typed = { ...owner, coverageViews: box.locationCoverageViewsWithPose(owner, "TR", { position: [0, -2, 8], yaw: 90, pitch: -20, basis: "user" }) };
list = use(swap(typed));
ps = box.locationPanelPoses(typed, list);
assert.deepEqual(json([ps[1].source, ps[1].pose.position, ps[1].lowered, ps[1].heightWarning]), ["set", [0, -2, 8], null, { height: 8, max: 6, source: "saved" }]);
assert.deepEqual(json(box.locationPanelCameraNotes(ps[1], owner.name, "")), [{ kind: "high",
  text: "This camera stands 8 m up, as set under Edit camera — outdoor cameras stay at eye level or a low high-angle (at most about 6 m). It is used as you set it." }]);
// changing one number under Edit camera keeps the rest of the saved camera (and makes it set by hand): an 11.7 m height
// saved by an older "Use the suggested cameras" is then kept and warned about as set — never claimed as typed
{
  const lensOnly = { ...savedOld, coverageViews: box.locationCoverageViewsWithPose(savedOld, "TR", { ...savedOld.coverageViews.find((v) => v.panel === "TR").pose, lensMm: 24, basis: "user" }) };
  const q = box.locationPanelPoses(lensOnly, use(swap(lensOnly)))[1];
  assert.deepEqual(json([q.pose.position[2], q.lowered, q.heightWarning]), [11.7, null, { height: 11.7, max: 6, source: "saved" }]);
  assert.match(box.locationPanelCameraNotes(q, owner.name, "")[0].text, /^This camera stands 11\.7 m up, as set under Edit camera — /);
  use(swap(typed));
}
assert.match(JSON.stringify(spec(typed)), /8 m up/, "the prompt states it as typed");
ex = box.locationCoordinateExport(typed, list);
assert.deepEqual(json([ex.cameras[1].pose.position[2], "loweredFrom" in ex.cameras[1]]), [8, false], "Blender gets it as typed");
// a floor-plan camera marked "Set by hand" (basis user, Floor plan numbers) is typed by hand too
const planUser = withCams(owner, [{ ...TR117, position: [7.7, -0.1, 9], basis: "user" }]);
list = use(swap(planUser));
ps = box.locationPanelPoses(planUser, list);
assert.deepEqual(json([ps[1].source, ps[1].pose.position[2], ps[1].lowered, ps[1].heightWarning]), ["layout", 9, null, { height: 9, max: 6, source: "layout" }]);
assert.match(box.locationPanelCameraNotes(ps[1], owner.name, "")[0].text, /^This camera stands 9 m up, as set by hand on the floor plan — outdoor cameras stay at eye level or a low high-angle \(at most about 6 m\)\. It is used as you set it\.$/);
// at the limit (or under it) nothing is said
const at6 = withCams(owner, [{ ...TR117, position: [7.7, -0.1, 6] }]);
list = use(swap(at6));
assert.ok(box.locationPanelPoses(at6, list).every((p) => !p.lowered && !p.heightWarning));

/* ---- 1d. indoors nothing changes; an open-sky space counts from its own floor; an outdoor part too ---- */
const hallPlan = box.normalizeLocationSpatialPlan({ frame: "f", status: "reviewed", source: { assetId: "hall", iso: "" }, anchors: [{ id: "m", space: "Hall", name: "Furnace mouth", placement: "north wall" }],
  coordinates: { origin: { anchorId: "m" }, spaces: [{ id: "hall", name: "Hall", footprint: [[-10, -10], [10, -10], [10, 10], [-10, 10]], ceilingH: 12 }],
    cameras: [{ spaceId: "hall", panel: "TR", position: [9, 9, 11.7], yaw: 225, pitch: -40, basis: "design" }] } });
const hall = { id: "hall", key: "hall", name: "Hall", intExt: "INT", spatialPlan: hallPlan };
ps = box.locationPanelPoses(hall, [hall]);
assert.deepEqual(json([ps[1].pose.position[2], ps[1].lowered, ps[1].heightWarning]), [11.7, null, null], "an indoor hall keeps its high camera");
const terracePlan = box.normalizeLocationSpatialPlan({ frame: "From the steps", status: "reviewed", source: { assetId: "terrace", iso: "" },
  anchors: [{ id: "rail", space: "Terrace", name: "Iron railing", placement: "south edge" }],
  coordinates: { origin: { anchorId: "rail" }, spaces: [{ id: "terrace", name: "Terrace", footprint: [[0, 0], [10, 0], [10, 10], [0, 10]], floorZ: 2, openSky: true }],
    cameras: [{ spaceId: "terrace", panel: "TL", position: [1, 1, 9.5], yaw: 45, basis: "design" }] } });
const terrace = { id: "terrace", key: "terrace", name: "Terrace", intExt: "INT/EXT", spatialPlan: terracePlan };
ps = box.locationPanelPoses(terrace, [terrace]);
assert.deepEqual(json([ps[0].pose.position, ps[0].lowered]), [[1, 1, 8], { from: 7.5, to: 6, source: "layout" }], "a raised open-sky terrace: 6 m above its own floor");
const partCams = withCams(owner, [{ spaceId: sub.id, panel: "TL", position: [-7, -2, 7.5], yaw: 90, basis: "design" },
  { spaceId: sub.id, panel: "TR", position: [0, -1, 4], yaw: 180, basis: "design" }]);
list = use(swap(partCams));
ps = box.locationPanelPoses(sub, list);
assert.deepEqual(json([ps[0].pose.position, ps[0].lowered.from, ps[1].pose.position, ps[1].lowered]), [[-7, -2, 6], 7.5, [0, -1, 4], null]);
assert.match(spec(sub, { panelPlan: box.locationSubspacePanelPlan(sub, list) }).views.top_left, /at x -7 m, y -2 m, 6 m up, facing east/);
use(locations);

/* ---- 2. the drafter: its proposed outdoor cameras are held to the limit, its read ones kept as read ---- */
const store = { id: "loc-glass-store", key: "glass-store", name: "Glass Store", intExt: "INT", parentKey: "fondamenta" };
const fam = [owner, sub, store];
const draftCoords = box.normalizeLocationCoordinates({ origin: { anchorId: "fv-furnace-facade" }, spaces: [
    { id: owner.id, name: "Fondamenta", footprint: [[-30, -4.5], [34, -4.5], [34, 0], [-30, 0]], ceilingH: 12 },
    { id: sub.id, name: "Fondamenta DEI Vetrai", footprint: [[-8, -4.5], [8, -4.5], [8, 0], [-8, 0]], ceilingH: 12 },
    { id: store.id, name: "Glass Store", footprint: [[0, 0], [4, 0], [4, 4], [0, 4]], ceilingH: 5 },
    { id: "yard", name: "Yard", footprint: [[40, 0], [50, 0], [50, 10], [40, 10]], openSky: true }],
  cameras: [{ spaceId: owner.id, panel: "TR", position: [7.7, -0.1, 11.7], yaw: 254, basis: "design" },
    { spaceId: owner.id, panel: "BL", position: [-1, -1.8, 11.7], yaw: 0, basis: "observed" },
    { spaceId: sub.id, panel: "TL", position: [-7, -2, 7.5], yaw: 90, basis: "design" },
    { spaceId: sub.id, panel: "TR", position: [0, -1, 1.6], yaw: 180, basis: "design" },
    { spaceId: sub.id, panel: "BL", position: [0, -2, 9], yaw: 40, basis: "user" },
    { spaceId: store.id, panel: "TR", position: [3.7, 3.7, 4.7], yaw: 225, basis: "design" },
    { spaceId: "yard", panel: "TL", position: [41, 1, 9], yaw: 45, basis: "script" }] });
const draftPlan = box.normalizeLocationSpatialPlan({ ...owner.spatialPlan, coordinates: draftCoords, status: "draft" });
const fixed = box.locationLowerDraftOutdoorCameras(draftPlan, fam, [...locations, store]);
assert.deepEqual(json(fixed.lowered), [
  { spaceId: owner.id, spaceName: "Fondamenta", panel: "TR", from: 11.7, to: 6 },
  { spaceId: sub.id, spaceName: "Fondamenta DEI Vetrai", panel: "TL", from: 7.5, to: 6 },
  { spaceId: "yard", spaceName: "Yard", panel: "TL", from: 9, to: 6 }]);
assert.deepEqual(json(fixed.plan.coordinates.cameras.map((c) => [c.spaceId, c.panel, c.position[2]])), [
  [owner.id, "TR", 6], [owner.id, "BL", 11.7], [sub.id, "TL", 6], [sub.id, "TR", 1.6], [sub.id, "BL", 9], [store.id, "TR", 4.7], ["yard", "TL", 6]],
  "proposed outdoor cameras lowered; read (observed), typed (user) and indoor ones kept");
assert.equal(draftPlan.coordinates.cameras[0].position[2], 11.7, "(a new plan object: the input is untouched)");
assert.equal(box.locationLowerDraftOutdoorCameras(owner.spatialPlan, fam).plan, owner.spatialPlan, "nothing to lower: the same plan");
assert.equal(box.locationLoweredCamerasText(fixed.lowered),
  "Lowered to 6 m: Fondamenta · top-right camera (the draft put it 11.7 m up), Fondamenta DEI Vetrai · top-left camera (the draft put it 7.5 m up), Yard · top-left camera (the draft put it 9 m up) — outdoor cameras stay at eye level or a low high-angle.");
assert.equal(box.locationLoweredCamerasText([]), "");
// the drafter itself (ai.jsx aiDraftLocationSpatialPlan), with the model stubbed: what it returns is already lowered
{
  const ai = read("app/ai.jsx");
  const ast = parseSync(ai, { sourceType: "script", parserOpts: { plugins: ["jsx"] }, babelrc: false, configFile: false });
  const fn = ast.program.body.find((n) => n.type === "FunctionDeclaration" && n.id.name === "aiDraftLocationSpatialPlan");
  let prompt = "";
  const draft = { frame: owner.spatialPlan.frame, anchors: owner.spatialPlan.anchors, sightlines: "", unresolved: "",
    coordinates: { origin: { anchorId: "fv-furnace-facade" }, spaces: [{ id: "Fondamenta", footprint: [[-30, -4.5], [34, -4.5], [34, 0], [-30, 0]], openSky: true },
      { id: "Fondamenta DEI Vetrai", footprint: [[-8, -4.5], [8, -4.5], [8, 0], [-8, 0]], openSky: true }],
      cameras: [{ space: "Fondamenta", panel: "TR", position: [7.7, -0.1, 11.7], yaw: 254, pitch: -53, lensMm: 16, basis: "observed" },
        { space: "Fondamenta", panel: "BR", position: [20, -2, 10], yaw: 270, basis: "design" },
        { space: "Fondamenta DEI Vetrai", panel: "TL", position: [-7, -2, 7.5], yaw: 90, basis: "design" }] } };
  Object.assign(box, { turnDownscaleDataUrl: async () => "plate-data", aiAvailable: () => true, extractJSON: JSON.parse,
    aiVisionComplete: async (messages) => { prompt = messages[0].content; return { vision: true, text: JSON.stringify(draft) }; } });
  vm.runInContext(ai.slice(fn.start, fn.end), box);
  images[owner.id] = "fondamenta-plate"; metas[owner.id] = { iso: "plate-d" };
  use(locations);
  const proposal = await box.aiDraftLocationSpatialPlan(owner, [], {});
  assert.deepEqual(json(proposal.coordinates.cameras.map((c) => [c.spaceId, c.panel, c.position[2], c.basis])), [
    [owner.id, "TR", 11.7, "observed"], [owner.id, "BR", 6, "design"], [sub.id, "TL", 6, "design"]]);
  assert.deepEqual(json(proposal.loweredCameras), [
    { spaceId: owner.id, spaceName: "Fondamenta", panel: "BR", from: 10, to: 6 },
    { spaceId: sub.id, spaceName: "Fondamenta DEI Vetrai", panel: "TL", from: 7.5, to: 6 }]);
  assert.ok(!("loweredCameras" in box.normalizeLocationSpatialPlan(proposal)), "the note is never saved with the layout");
  assert.equal(proposal.status, "draft");
  // it is told which spaces are outdoor and what each is part of
  assert.match(prompt, /A space listed with outdoor true is open-air \(an exterior, or open to the sky\); partOf names the space it is part of\. /);
  const data = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
  const sp = (n) => data.spaces.find((s) => s.name === n);
  assert.deepEqual(json([sp("Fondamenta").outdoor, sp("Fondamenta").partOf, sp("Fondamenta DEI Vetrai").outdoor, sp("Fondamenta DEI Vetrai").partOf]),
    [true, null, true, "Fondamenta"]);
  delete metas[owner.id]; delete images[owner.id];
}
// the review names what the draft lowered (Shared set layout, while the draft is untouched): drafted (stubbed), rendered
{
  use(locations);
  const st = box.locationSpatialPlanState(owner);
  box.aiDraftLocationSpatialPlan = async () => ({ ...fixed.plan, source: st.source, loweredCameras: fixed.lowered });
  const renderEd = () => { cursor = 0; return box.LocationSpatialPlanEditor({ l: owner, scenes: [], project: film.project, onUpdate: noop }); };
  hooks = [];
  let ed = renderEd();
  assert.doesNotMatch(text(ed), /Lowered to 6 m/, "nothing to say before a draft");
  await flat(ed).find((n) => n.type === "button" && /Draft floor plan/.test(text(n))).props.onClick();
  ed = renderEd();
  const note = flat(ed).find((n) => n.type === "p" && /^Lowered to 6 m: /.test(text(n)));
  assert.ok(note && note.props.className === "loc-map-check" && note.props.role === "note");
  assert.equal(text(note), box.locationLoweredCamerasText(fixed.lowered));
}
// the top-down map's camera detail says it too
{
  list = use(swap(drafted));
  const mapScene = box.locationFloorPlanScene(drafted, drafted.spatialPlan, list);
  cursor = 0; hooks = [];
  const map = box.LocationFloorPlanMap({ scene: mapScene, selected: owner.id + ":TR", onSelect: noop, spaceId: owner.id });
  assert.match(text(flat(map).find((n) => n.type === "p" && /loc-map-detail/.test(n.props.className || ""))),
    /, 6 m up, [^]* From the floor plan\. Lowered to 6 m \(the floor plan says 11\.7 m\) — outdoor cameras stay at eye level or a low high-angle\.$/);
  use(locations);
}
// Floor plan numbers keeps the number as written, and its Position hint says it is used lower (or, Set by hand, as set)
{
  const posHint = (plan, spaceId, panel) => {
    const fields = box.LocationFloorPlanFields({ plan, family: [owner, sub], change: noop, readOnly: false });
    const cam = plan.coordinates.cameras.find((c) => c.spaceId === spaceId && c.panel === panel);
    const row = flat(fields).find((n) => n.type === box.LocCoordInput && n.props.label === "Position"
      && n.props.value === cam.position.map((v) => String(Math.round(v * 100) / 100)).join(", "));
    return row.props.hint;
  };
  assert.equal(posHint(drafted.spatialPlan, owner.id, "TR"),
    "m; height above the main floor — outdoors it is used at most 6 m above this space's floor; mark it Set by hand to keep it higher");
  assert.equal(posHint(planUser.spatialPlan, owner.id, "TR"), "m; height above the main floor — above the outdoor limit of about 6 m, used as set by hand");
  assert.equal(posHint(at6.spatialPlan, owner.id, "TR"), "m; height above the main floor", "at the limit: the usual hint");
  assert.equal(posHint(partCams.spatialPlan, sub.id, "TR"), "m; height above the main floor");
  assert.match(posHint(partCams.spatialPlan, sub.id, "TL"), /used at most 6 m above this space's floor/, "an outdoor part's camera too");
  const hallCam = flat(box.LocationFloorPlanFields({ plan: hallPlan, family: [hall], change: noop, readOnly: false }))
    .find((n) => n.type === box.LocCoordInput && n.props.label === "Position" && n.props.value === "9, 9, 11.7");
  assert.equal(hallCam.props.hint, "m; height above the main floor", "indoors: nothing to say");
}

/* ---- 3. the outdoor part is framed differently from its parent plate's REAL cameras ---- */
images[owner.id] = "fondamenta-plate";
use(locations);
const baseline = json(box.locationPanelPoses(sub).map((p) => [p.key, p.pose.yaw, p.pose.position]));
assert.deepEqual(baseline, [["TL", 90, [-7.2, -2.7, 1.6]], ["TR", 180, [0, -0.8, 1.6]], ["BL", 40, [-1.03, -2.7, 1.6]], ["BR", 220, [6.43, -1.5, 1.6]]]);
assert.ok(box.locationPanelPoses(sub).every((p) => !p.repeatsParent), "Glass Hours today: nothing repeats, nothing to say");
assert.deepEqual(json(box.locationParentPlateViews(owner).map((v) => v.real)), [false, false, false, false], "the parent's cameras unknown: the views its plate asks for");
assert.deepEqual(json(box.locationParentPlateViews(owner).map((v) => [v.key, v.yaw, v.position])),
  json(box.locationRequestedViews(owner).map((v) => [v.key, v.yaw, v.position])));
// (a) the verifier's b-noted scenario: Fondamenta's plate RECORDED its top-left facing east from (-7.5, -2.6) and its
// top-right facing south from (0, -0.5)
metas[owner.id] = { iso: "o2", platePanels: { schema: "cm-plate-panels-v1", spaceId: owner.id, layout: "2x2", panels: {
  TL: { yaw: 90, pitch: 0, lensMm: 24, position: [-7.5, -2.6, 1.6] }, TR: { yaw: 180, pitch: 0, lensMm: 24, position: [0, -0.5, 1.6] } } } };
const theirs = json(box.locationParentPlateViews(owner));
assert.deepEqual(theirs.map((v) => [v.key, v.yaw, v.position, v.real]), [
  ["TL", 90, [-7.5, -2.6, 1.6], true], ["TR", 180, [0, -0.5, 1.6], true], ["BL", 0, [-1, -1.8, 1.5], false], ["BR", 270, [1.8, -4.5, 1.5], false]]);
assert.equal(theirs[0].purpose, "wide establishing three-quarter view at eye level from a front corner", "the words its plate's prompt asked for");
let kids = box.locationPanelPoses(sub);
assert.deepEqual(json(kids.map((p) => [p.key, p.purpose, p.pose.yaw, p.pose.position])), [
  ["TL", "eye-level view along Fondamenta DEI Vetrai, looking west", 270, [7.2, -2.7, 1.6]],
  ["TR", "eye-level reverse angle from Furnace side door, looking south across Fondamenta DEI Vetrai", 180, [0, -0.8, 1.6]],
  ["BL", "three-quarter view of Sacks of sand by the door, at eye level", 40, [-1.03, -2.7, 1.6]],
  ["BR", "three-quarter view of Cullet skip, at eye level", 220, [6.43, -1.5, 1.6]]],
  "the top-left no longer repeats the plate's real top-left (east from 0.3 m away): it looks west along the stretch");
assert.ok(!box._locRepeatsView(kids[0].pose, theirs[0]), "TL ≠ the real TL");
// every candidate for the top-right repeats one: the reverse angle (the real TR, 0.3 m away) and the east view along it
// (the real TL) — the one that repeats least is taken, and recorded
assert.deepEqual(json(kids.map((p) => p.repeatsParent || null)), [[{ panel: "BR", real: false }], [{ panel: "TR", real: true }], null, null]);
const rec = box.locationPlatePanelRecord(sub);
assert.deepEqual(json([rec.panels.TL.repeatsParent, rec.panels.TR.repeatsParent, rec.panels.BL.repeatsParent]), [[{ panel: "BR", real: false }], [{ panel: "TR", real: true }], null]);
const subSpec = spec(sub, { panelPlan: box.locationSubspacePanelPlan(sub) });
assert.match(subSpec.views.top_right, /facing south \(180°\), level, 28 mm lens\. It looks the same way as the top-right panel of Fondamenta's plate: give it its own foreground, distance and composition, never that panel's\./);
assert.doesNotMatch(subSpec.views.bottom_left, /looks the same way/);
assert.match(subSpec.views.subspace_rules[2], /^Each panel is a NEW camera position, framed differently from every view of Fondamenta's own plate \(wide establishing three-quarter view at eye level from a front corner, facing east; high-angle three-quarter overview, facing south; close-up of Glass-furnace façade/,
  "the prompt names the plate's REAL views");
assert.deepEqual(json(box.locationPanelCameraNotes(kids[1], sub.name, owner.name)), [{ kind: "repeats",
  text: "Looks the same way as the top-right panel of Fondamenta's plate — every framing planned on Fondamenta DEI Vetrai repeats one of Fondamenta's views here, so this is the one that repeats least. Its prompt asks for its own foreground, distance and composition; set this camera by hand to frame it differently." }]);
assert.match(box.locationPanelCameraNotes(kids[0], sub.name, owner.name)[0].text, /^Looks the same way as the bottom-right view Fondamenta's plate asks for — /);
// the record changed the cameras: a sub plate made from the old ones now says "Layout changed" (they really moved)
const oldRecord = { schema: "cm-plate-panels-v1", panels: Object.fromEntries(baseline.map(([k, yaw, position]) => [k, { yaw, position, pitch: k === "BL" || k === "BR" ? -8 : 0, lensMm: k === "TR" ? 28 : k === "TL" ? 24 : 35 }])) };
assert.equal(box.locationPlateLayoutChanged({ iso: "s0", platePanels: oldRecord, plateLayoutSig: box.locationPlateLayoutSig(sub, { panels: true, record: oldRecord }) }, sub, { panels: true }), true);
// (b) noted on the card for this plate version (read from it, with a position): the same
metas[owner.id] = { iso: "o1" };
const noted = { ...owner, plateCameras: box.normalizeLocationPlateCameras({ iso: "o1", source: "read", panels: { TL: { yaw: 90, position: [-7.5, -2.6, 1.6] } } }) };
list = use(swap(noted));
assert.deepEqual(json(box.locationPanelPoses(sub, list)[0].pose.position), [7.2, -2.7, 1.6], "noted cameras count as the plate's own");
// …for an older plate version: not this plate's — the baseline again
const stale = { ...noted, plateCameras: { ...noted.plateCameras, iso: "an-older-plate" } };
list = use(swap(stale));
assert.deepEqual(json(box.locationPanelPoses(sub, list).map((p) => [p.key, p.pose.yaw, p.pose.position])), baseline);
// a facing set by hand ("Top-right faces east") keeps only the height its plate asked for (the raised overview, 6 m):
// no eye-level camera on the quay repeats it, so the top-left still looks east
const byHand = { ...owner, plateCameras: box.normalizeLocationPlateCameras({ iso: "o1", source: "set", panels: { TR: { yaw: 90 } } }) };
list = use(swap(byHand));
const byHandTR = json(box.locationParentPlateViews(byHand, list)[1]);
assert.deepEqual([byHandTR.yaw, byHandTR.position, byHandTR.z, byHandTR.real], [90, null, json(box.locationRequestedViews(byHand, list)[1].position)[2], true]);
assert.equal(byHandTR.z, 6);
assert.deepEqual(json(box.locationPanelPoses(sub, list).map((p) => [p.key, p.pose.yaw, p.pose.position])), baseline);
// …but a top-left set by hand facing east (where on the quay unknown, the eye level its plate asked for) is repeated by
// ANY eye-level camera looking east — never "9 m from a guessed spot, so not a repeat" (the verifier's b-noted run 1:
// it used to leave the part's top-left looking east) — so the part's top-left looks west
const byHandTL = { ...owner, plateCameras: box.normalizeLocationPlateCameras({ iso: "o1", source: "set", panels: { TL: { yaw: 90 }, TR: { yaw: 180 } } }) };
list = use(swap(byHandTL));
assert.deepEqual(json(box.locationParentPlateViews(byHandTL, list).slice(0, 2).map((v) => [v.yaw, v.position, v.z, v.real])), [[90, null, 1.6, true], [180, null, 6, true]]);
kids = box.locationPanelPoses(sub, list);
assert.deepEqual(json(kids.map((p) => [p.key, p.pose.yaw, p.pose.position])), [["TL", 270, [7.2, -2.7, 1.6]], ...baseline.slice(1)],
  "the top-left looks west; the eye-level reverse angle facing south doesn't repeat the raised top-right facing south");
assert.ok(box._locRepeatsView({ yaw: 90, position: [-7.2, -2.7, 1.6] }, { yaw: 90, position: null, z: 1.6 }), "facing + height band");
assert.ok(!box._locRepeatsView({ yaw: 90, position: [-7.2, -2.7, 1.6] }, { yaw: 90, position: null, z: 6 }), "another height band");
// (c) read for the confirmed floor plan from this very plate (observed cameras): the same
const readPlan = withCams(owner, [{ spaceId: owner.id, panel: "TL", position: [-7.5, -2.6, 1.6], yaw: 90, basis: "observed" }],
  { status: "reviewed", source: { assetId: owner.id, iso: "o3" } });
metas[owner.id] = { iso: "o3" };
list = use(swap(readPlan));
assert.equal(box.locationParentPlateViews(readPlan, list)[0].real, true);
assert.equal(box.locationPanelPoses(sub, list)[0].pose.yaw, 270);
// (d) nothing known about the plate, but a STORED camera (top-left facing east from (-7.5, -2.6)): both views along the
// stretch repeat one of the parent's — the east one its top-left almost exactly, the west one its bottom-right close-up
// from 5.7 m — so the LEAST-repeating (west) is taken, not the first (east, as before)
delete metas[owner.id];
const stored = { ...owner, coverageViews: [{ id: "v1", panel: "TL", pose: { yaw: 90, position: [-7.5, -2.6, 1.6], pitch: 0, lensMm: 24 } }] };
list = use(swap(stored));
kids = box.locationPanelPoses(sub, list);
assert.deepEqual(json([kids[0].pose.yaw, kids[0].pose.position, kids[0].repeatsParent]), [270, [7.2, -2.7, 1.6], [{ panel: "BR", real: false }]]);
const closeness = (c, p) => box._locRepeatCloseness(c, p);
const views = box.locationParentPlateViews(stored, list);
assert.ok(closeness({ yaw: 270, position: [7.2, -2.7, 1.6] }, views[3]) < closeness({ yaw: 90, position: [-7.2, -2.7, 1.6] }, views[0]), "(west repeats less than east)");
// (e) a camera set by hand on the part that faces the way one of the parent's views does: said, never changed
const handSub = { ...sub, coverageViews: box.locationCoverageViewsWithPose(sub, "BL", { yaw: 0, position: [-1, -1.5, 1.6], basis: "user" }) };
list = use(swap(handSub));
const hp = box.locationPanelPoses(handSub, list)[2];
assert.deepEqual(json([hp.source, hp.pose.yaw, hp.pose.position, hp.repeatsParent]), ["set", 0, [-1, -1.5, 1.6], [{ panel: "BL", real: false }]]);
assert.equal(box.locationPanelCameraNotes(hp, sub.name, owner.name)[0].text,
  "Looks the same way as the bottom-left view Fondamenta's plate asks for, so this panel may repeat it. Its prompt asks for its own foreground, distance and composition.");
// indoor rooms never get the note (their cameras are inside; the parent's views are outside)
use(locations);
assert.ok(box.locationPanelPoses(byId("loc-furnace-office-2")).every((p) => !p.repeatsParent));

/* ---- 4. Plate cameras shows the notes ---- */
const render = (props) => { cursor = 0; hooks = []; return box.LocationPlateCameras(props); };
list = use(swap(drafted));
let tree = render({ l: drafted, project: film.project, onUpdate: noop, readOnly: false, plateMeta: null });
let notes = flat(tree).filter((n) => n.type === "p" && /loc-cam-note-/.test(n.props.className || ""));
assert.deepEqual(notes.map((n) => [n.props.className, text(n)]), [["loc-layer-note loc-cam-warn loc-cam-note-lowered",
  "Lowered to 6 m — outdoor cameras stay at eye level or a low high-angle. The floor plan puts it 11.7 m up; to keep it higher, type its position under Edit camera."]]);
metas[owner.id] = { iso: "o2", platePanels: { schema: "cm-plate-panels-v1", spaceId: owner.id, layout: "2x2", panels: {
  TL: { yaw: 90, pitch: 0, lensMm: 24, position: [-7.5, -2.6, 1.6] }, TR: { yaw: 180, pitch: 0, lensMm: 24, position: [0, -0.5, 1.6] } } } };
list = use(locations);
// the card as it is stored (its parent named by parentKey only — no hand-set parentLocation)
assert.equal(sub.parentLocation, undefined); assert.equal(sub.parentKey, owner.key);
tree = render({ l: sub, project: film.project, onUpdate: noop, readOnly: false, plateMeta: null });
notes = flat(tree).filter((n) => n.type === "p" && /loc-cam-note-repeats/.test(n.props.className || ""));
assert.equal(notes.length, 2, "the top-left and top-right panels say so");
assert.match(text(notes[1]), /^Looks the same way as the top-right panel of Fondamenta's plate — every framing planned on Fondamenta DEI Vetrai repeats one of Fondamenta's views here/);
delete metas[owner.id]; delete images[owner.id];

/* ---- 5. Frances knows (APP_FEATURES) ---- */
const ai = read("app/ai.jsx");
assert.match(ai, /OUTDOOR CAMERAS STAY LOW, WHEREVER THEY COME FROM: on an outdoor place or part/);
assert.match(ai, /Plate cameras says 'Lowered to 6 m — outdoor cameras stay at eye level or a low high-angle'/);
assert.match(ai, /A camera set by hand \(its numbers under Edit camera in Plate cameras, or a floor-plan camera marked 'Set by hand'\) is used exactly as set, with a warning when it stands above 6 m/);
assert.match(ai, /its Position hint under Floor plan numbers says it is used lower unless marked Set by hand/);
assert.match(ai, /AN OUTDOOR PART'S PANELS AVOID THE VIEWS ITS PARENT'S PLATE REALLY HAS/);
assert.ok(ai.indexOf("OUTDOOR CAMERAS STAY LOW") < ai.indexOf("/* the public view of every entry, memoised"), "in a dated block before the public view");

console.log("PASS camera limits: every outdoor camera in use stands at most 6 m up (floor plan, drafted, saved — lowered and said; typed by hand — kept and warned; indoors unchanged), the drafter's proposals are held to it and named, and an outdoor part is framed apart from its parent plate's real cameras (the least-repeating one taken and recorded when none can be)");

#!/usr/bin/env node
/* test-location-outdoor-cameras.mjs — OUTDOOR PARTS GET OUTDOOR CAMERAS (owner-approved 2026-10-14, "go ahead with all
   of it" — fix B of the Fondamenta plan, with the critique's corrections).
   Glass Hours' "Fondamenta DEI Vetrai" (a 16 m stretch of the quay "Fondamenta") got indoor-room cameras: a "doorway →
   far wall" top-left that looked out over the lagoon, a top-right "high corner" 11.7 m up (the nominal 12 m open-sky
   ceiling less 0.3 m — the parent's own overview again), and close-ups of the façade the parent's plate already shows;
   its prompt demanded "four cameras INSIDE … Interior of … only … never Fondamenta itself", which an open quay can't
   meet. Now:
   1. a space is OUTDOOR when its own card is an exterior (EXT, not INT/EXT) or its floor plan marks it open to the sky
      (openSky — written only when true, so older layouts keep their exact signature); Furnace Office (INT) is not;
   2. an outdoor part's four cameras stand ON it at eye level (1.6 m): along it, a reverse angle from its door, and
      three-quarter views of its own stations — never a station the parent's own views already aim at or name — and no
      panel repeats one of the parent's REQUESTED views (same way, same height band, nearby);
   3. outdoors no camera stands higher than about 6 m: the parent's suggested overview is raised 6 m, not 11.7 m;
   4. the owner's suggested close-ups follow its staging (the two its prompt asks for — "close-up of Glass-furnace
      façade…", "close-up of Stone quay edge running away west…") instead of unrelated objects (the canal lamps, the
      vaporetto landing); a staging that names an object by id is read too; with no staging, the old stations stay;
   5. the prompt: "four cameras standing on …, an open-air part of …", "Camera standing on X, part of Y", no "INSIDE",
      no "Interior of … only", no "never Fondamenta itself"; the surroundings must match the parent's plate; the
      parent's own views are named so they aren't repeated; open sides "look along" the parent; the identity layers'
      visual-continuity rule says the parent continues around it; the simplified retry keeps the outdoor cameras;
      the layout-drafting prompt (ai.jsx) proposes outdoor cameras standing on it, never above about 6 m;
   6. indoor rooms keep their cameras exactly (Furnace Office in Glass Hours, the mezzanine office of
      test-location-coordinates — pinned there);
   7. "Layout changed — regenerate" only when a plate's recorded cameras really moved (compared with the record saved
      with the plate, to 5 cm / half a degree), or the layout changed — never because a camera is worked out a little
      differently; an older outdoor plate (its cameras really are new) does say it;
   8. the Blender export carries the corrected cameras (eye level, ≤ 6 m) and, when known, the current plate's own.
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json). Nothing is generated,
   nothing is charged. node scripts/test-location-outdoor-cameras.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const film = JSON.parse(read("scripts/fixtures/glass-hours-locations.json"));
const metas = {}, images = {};
const box = { console, setTimeout, clearTimeout, localStorage: { getItem: () => null }, dispatchEvent: () => true, CustomEvent: class {},
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal",
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "" };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box, { filename: "app/locations.jsx" });
const json = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const locations = film.locations.map((l) => ({ ...l }));
box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [] };
const byId = (id) => locations.find((l) => l.id === id);
const owner = byId("loc-fondamenta-3"), sub = byId("loc-fondamenta-dei-vetrai-4");
const office = byId("loc-furnace-office-2"), furnace = byId("loc-furnace-1");
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, a + " ≈ " + b);

/* ---- 1. what counts as outdoor ---- */
assert.equal(box.locationIsOutdoor(sub), true, "the quay stretch is an exterior (EXT)");
assert.equal(box.locationIsOutdoor(owner), true);
assert.equal(box.locationIsOutdoor(office), false, "Furnace Office is a room (INT)");
assert.equal(box.locationIsOutdoor({ ...office, intExt: "INT/EXT" }), false, "INT/EXT alone is not outdoor");
// open sky in the floor plan: an INT/EXT courtyard whose space has no roof
const courtPlan = { frame: "From the gate", status: "reviewed", source: { assetId: "court", iso: "" },
  anchors: [{ id: "well", space: "Courtyard", name: "Well", placement: "centre" }],
  coordinates: { origin: { anchorId: "well" }, spaces: [{ id: "court", name: "Courtyard", footprint: [[0, 0], [10, 0], [10, 10], [0, 10]], openSky: true }] } };
const court = { id: "court", key: "court", name: "Courtyard", intExt: "INT/EXT", spatialPlan: box.normalizeLocationSpatialPlan(courtPlan) };
assert.equal(box.normalizeLocationSpatialPlan(courtPlan).coordinates.spaces[0].openSky, true, "openSky is kept when true");
assert.equal(box.locationIsOutdoor(court, [court]), true, "an open-sky space is outdoor");
const roofed = box.normalizeLocationSpatialPlan({ ...courtPlan, coordinates: { ...courtPlan.coordinates, spaces: [{ ...courtPlan.coordinates.spaces[0], openSky: "yes" }] } });
assert.ok(!("openSky" in roofed.coordinates.spaces[0]), "openSky is written only when true");
assert.equal(box.locationSpatialPlanSig(owner.spatialPlan), box.locationSpatialPlanSig(json(owner.spatialPlan)), "the Glass Hours layout signs as before");
assert.ok(!("openSky" in box.normalizeLocationSpatialPlan(owner.spatialPlan).coordinates.spaces[0]), "an older layout gains no field");
assert.match(read("app/locations-ui.jsx"), /React\.createElement\("span",null,"Open sky"\),\n\s+React\.createElement\("input",\{type:"checkbox",checked:!!sp\.openSky,disabled:readOnly,\n\s+onChange:e=>setSpace\(sp\.id,\{openSky:e\.target\.checked\?true:undefined\}\)\}\)/,
  "Floor plan numbers: each space can be marked open to the sky");

/* ---- 2 · 3. the outdoor part's cameras ---- */
const kids = box.locationPanelPoses(sub), parentViews = json(box.locationRequestedViews(owner));
assert.ok(kids.every((p) => p.stated && p.source === "suggested"), "a sub-space always states its planned cameras");
assert.deepEqual(json(kids.map((p) => p.purpose)), [
  "eye-level view along Fondamenta DEI Vetrai, looking east",
  "eye-level reverse angle from Furnace side door, looking south across Fondamenta DEI Vetrai",
  "three-quarter view of Sacks of sand by the door, at eye level",
  "three-quarter view of Cullet skip, at eye level"]);
assert.deepEqual(json(kids.map((p) => [p.pose.yaw, p.pose.position])), [
  [90, [-7.2, -2.7, 1.6]], [180, [0, -0.8, 1.6]], [40, [-1.03, -2.7, 1.6]], [220, [6.43, -1.5, 1.6]]]);
assert.ok(kids.every((p) => p.pose.position[2] === 1.6), "every camera at eye level (1.6 m above the quay)");
const poly = sub.spatialPlan ? null : owner.spatialPlan.coordinates.spaces.find((s) => s.id === sub.id).footprint;
assert.ok(kids.every((p) => box.locationSegmentCrossesFootprint([p.pose.position[0], p.pose.position[1]], [p.pose.position[0], p.pose.position[1]], poly)),
  "every camera stands on the quay stretch itself");
assert.deepEqual(json(kids.map((p) => p.pose.target)), ["", "", "fv-sand-sacks", "fv-cullet-skip"],
  "its own stations — not the façade, the shutter or the bench the parent's close-up already shows, not the quay edge the parent's other close-up is of");
// no panel repeats a requested view of the parent (the same way within 30°, the same height band, within 8 m)
const repeats = (c, p) => c.yaw != null && p.yaw != null && Math.abs(box.locYawDiff(c.yaw, p.yaw)) < 30
  && (!c.position || !p.position || (Math.abs(c.position[2] - p.position[2]) < 2 && Math.hypot(c.position[0] - p.position[0], c.position[1] - p.position[1]) < 8));
for (const k of kids) for (const p of parentViews) assert.ok(!repeats(k.pose, p), k.key + " repeats the parent's " + p.key + " (" + p.purpose + ")");
for (const a of kids) for (const b of kids) if (a !== b) assert.ok(!repeats(a.pose, b.pose), a.key + " and " + b.key + " frame the same way");
// before: the "high corner" stood 11.7 m up and repeated the parent's overview; the façade close-up repeated the parent's
const old = { TR: { yaw: 254.3, position: [7.71, -0.08, 11.7] }, BL: { yaw: 0, position: [-1, -1.8, 1.5] } };
assert.ok(repeats(old.BL, parentViews.find((p) => p.key === "BL")), "(the old bottom-left was the parent's close-up again)");
// the owner (an exterior) never above about 6 m — the 11.7 m corner is gone
const ownerPoses = box.locationPanelPoses(owner);
assert.equal(ownerPoses[1].pose.position[2], 6, "the parent's suggested overview stands 6 m up (it was 11.7 m)");
assert.ok(ownerPoses[1].pose.pitch < 0 && ownerPoses[1].pose.pitch > -20);
assert.match(ownerPoses[1].purpose, /raised three-quarter overview from about 6 m up/);
// an open-sky owner with no ceiling height: 6 m too
const courtPoses = box.locationPanelPoses(court, [court]);
assert.equal(courtPoses[1].pose.position[2], 6);
// an indoor owner keeps its ceiling corner (a 12 m furnace hall: 11.7 m)
const hallPlan = box.normalizeLocationSpatialPlan({ frame: "f", status: "reviewed", source: { assetId: "hall", iso: "" }, anchors: [{ id: "m", space: "Hall", name: "Furnace mouth", placement: "north wall" }],
  coordinates: { origin: { anchorId: "m" }, spaces: [{ id: "hall", name: "Hall", footprint: [[-10, -10], [10, -10], [10, 10], [-10, 10]], ceilingH: 12 }] } });
const hall = { id: "hall", key: "hall", name: "Hall", intExt: "INT", spatialPlan: hallPlan };
assert.equal(box.locationPanelPoses(hall, [hall])[1].pose.position[2], 11.7, "indoors the high corner is unchanged");

/* ---- 4. the owner's suggested close-ups follow its staging ---- */
assert.deepEqual(json(ownerPoses.slice(2).map((p) => [p.pose.target, p.pose.yaw, p.pose.position])), [
  ["fv-furnace-facade", 0, [-1, -1.8, 1.5]],          // "close-up of Glass-furnace façade: …" — facing the façade
  ["fv-canal-edge", 270, [1.8, -4.5, 1.5]]]);          // "Stone quay edge running away west" — on the edge, looking west
assert.match(ownerPoses[2].purpose, /^close-up of Glass-furnace façade: the two-pane furnace window/);
assert.match(ownerPoses[3].purpose, /^close-up of Stone quay edge running away west/);
const ownerSpec = JSON.parse(box.buildLocationRefPrompt(owner, film.project).split("\n").slice(1).join("\n"));
assert.equal("close-up of " + box.locationStagingStations(owner).main, ownerSpec.views.bottom_left, "the camera's purpose is the view its prompt asks for");
assert.equal("close-up of " + box.locationStagingStations(owner).second, ownerSpec.views.bottom_right);
// an id cited in the staging is read too ("Empty second bench (A-bench2)")
const fiorin = box.locationPanelPoses(byId("loc-fiorin-furnace-0"));
assert.deepEqual(json(fiorin.slice(2).map((p) => p.pose.target)), ["A-furnace", "A-bench2"]);
// no staging → the anchor stations, as before (the Furnace of test-location-coordinates-ui: ["TL",0],["TR",45],["BL",0],["BR",180])
const bare = { ...owner, staging: undefined };
const bareList = locations.map((l) => l.id === owner.id ? bare : l);
assert.deepEqual(json(box.locationPanelPoses(bare, bareList).slice(2).map((p) => p.purpose)), ["key station: Row of canal lamps", "key station: Vaporetto landing pontoon"]);
// an owner whose plate plans inside AND outside views (locationMasterPanelPlan) asks for no staging close-up: its
// suggestions stay the anchor stations (exactly as before), and its requested views are that plan's words
const mixedOwner = { ...owner, coverageSheets: [{ id: "cov-int-x", role: "INT", name: "Furnace interior" }, { id: "cov-ext-y", role: "EXT", name: "Quay" }] };
const mixedList = locations.map((l) => l.id === owner.id ? mixedOwner : l);
assert.deepEqual(json(box.locationPanelPoses(mixedOwner, mixedList).slice(2).map((p) => p.purpose)), ["key station: Row of canal lamps", "key station: Vaporetto landing pontoon"]);
const corridor = byId("loc-hotel-staff-corridor-6");   // INT, with an EXT Required Space Plate: a truly mixed plan
box.turnContinuity = { ...box.turnContinuity, sluglineUnits: box.deriveSluglineUnits(film.scenes, film.drafts) };
assert.deepEqual(json(box.locationRequestedViews(corridor).map((v) => v.purpose.split(" ").slice(0, 2).join(" "))),
  ["INTERIOR establishing", "INTERIOR key", "EXTERIOR context", "THRESHOLD CONNECTION"], "the INT + EXT plan's own four views");
assert.equal(box.locationRequestedViews(owner)[2].purpose, "close-up of " + box.locationStagingStations(owner).main, "(a one-sided owner: its staging close-ups)");
delete box.turnContinuity.sluglineUnits;

/* ---- 5. the prompt ---- */
images[owner.id] = "fondamenta-plate"; metas[owner.id] = { iso: "2026-10-13T10:00:00Z" };
const plan = box.locationSubspacePanelPlan(sub);
assert.equal(plan.outdoor, true);
const spec = JSON.parse(box.buildLocationRefPrompt(sub, film.project, { panelPlan: plan }).split("\n").slice(1).join("\n"));
const views = spec.views, all = JSON.stringify(views);
assert.equal(views.layout, "exactly 4 views in a 2x2 grid — four cameras standing on Fondamenta DEI Vetrai, an open-air part of Fondamenta, one per panel, as placed below");
for (const k of ["top_left", "top_right", "bottom_left", "bottom_right"])
  assert.match(views[k], /Camera standing on Fondamenta DEI Vetrai, part of Fondamenta, at x [-\d.]+ m, y [-\d.]+ m, 1\.6 m up, facing /, k);
assert.doesNotMatch(all, /INSIDE|Camera inside|Interior of|never Fondamenta itself|inside of every panel/, "no indoor wording for an open quay");
assert.match(views.top_left, /Its open side “Quay continues east to landing” \(east\) looks east along Fondamenta; no reference view faces that way yet \(unresolved\)[^"]*Continue Fondamenta there in the same materials and scale as its plate; never fill it with a copied panel of Fondamenta\./);
assert.match(views.subspace_rules[1], /^The surroundings must match Fondamenta's plate: the same ground, façades, water, skyline, lamps, materials, colours and scale/);
assert.match(views.subspace_rules[2], /^Each panel is a NEW camera position, framed differently from every view of Fondamenta's own plate \(wide establishing front shot, facing north; high-angle three-quarter overview, facing east; close-up of Glass-furnace façade: the two-pane furnace window under its iron roll-down…, facing north; close-up of Stone quay edge running away west, flooded ankle-deep with acqua alta and…, facing west\)\.$/);
assert.match(views.subspace_rules[3], /Never reuse a composition from Fondamenta's plate/);
assert.match(spec.location.identity_layers.visual_continuity.rule, /^This is an open-air part of Fondamenta: the ground, façades, water and skyline around it continue the parent's plate exactly/);
assert.match(spec.location.identity_layers.visual_continuity.rule, /never views to copy/);
// an outdoor part the layout knows nothing about yet: no camera can be placed — each says it stands on it, once
const corner = { id: "corner", key: "court-corner", name: "Corner", intExt: "EXT", parentKey: "court" };
const cornerPoses = box.locationPanelPoses(corner, [court, corner]);
assert.ok(cornerPoses.every((p) => p.pose.yaw == null && p.pose.place === "at eye level"));
assert.equal(box.locationPoseText(cornerPoses[0].pose, "Corner", [], "Courtyard"), "Camera standing on Corner, part of Courtyard, at eye level, facing not set, level, 28 mm lens.");
// the simplified retry keeps its outdoor cameras
const simple = box.buildSimpleLocationPrompt(sub);
assert.match(simple, /Four cameras standing on Fondamenta DEI Vetrai at eye level \(an open-air part of Fondamenta; the rest of Fondamenta around it matches Fondamenta's plate\) — top-left: eye-level view along Fondamenta DEI Vetrai, looking east; top-right: eye-level reverse angle from Furnace side door, looking south across Fondamenta DEI Vetrai; bottom-left: three-quarter view of Sacks of sand by the door, at eye level, facing north-east/);
assert.doesNotMatch(simple, /inside Fondamenta DEI Vetrai/);
// "Make a Fondamenta view from …'s position" for its open side: standing on it, looking along the rest of the quay
const req = box.locationParentViewRequest(sub, "opening-4");
assert.equal(req.panel, "TL"); assert.equal(req.outdoor, true);
assert.equal(req.pose.place, "standing on Fondamenta DEI Vetrai, at Quay continues east to landing");
const pv = box.buildLocationParentViewPrompt(sub, req, film.project);
assert.match(pv, /CAMERA \(binding\): Camera standing on Fondamenta DEI Vetrai, part of Fondamenta, at x 8 m, y -2\.3 m, 1\.6 m up, facing east \(\d+°\)[^.]*\. It looks along Fondamenta past its open side “Quay continues east to landing”\. Show ONLY the rest of Fondamenta/);
assert.doesNotMatch(pv, /inside Fondamenta DEI Vetrai|own frame, walls and interior/);
// the layout-drafting prompt proposes outdoor cameras standing on it, never above about 6 m (ai.jsx)
const ai = read("app/ai.jsx");
const ast = parseSync(ai, { sourceType: "script", parserOpts: { plugins: ["jsx"] }, babelrc: false, configFile: false });
const draftFn = ast.program.body.find((n) => n.type === "FunctionDeclaration" && n.id.name === "aiDraftLocationSpatialPlan");
const draftSrc = ai.slice(draftFn.start, draftFn.end);
assert.match(draftSrc, /for a room with no plate yet, propose cameras INSIDE it \(TL from the doorway at the far wall, TR a high corner, BL\/BR its key stations; basis design\); /, "rooms keep their indoor cameras");
assert.match(draftSrc, /for an open-air part of a larger exterior with no plate yet \(a stretch of quay, a corner of a square\), propose cameras STANDING ON it at eye level \(about 1\.6 m\), each framed differently from the parent space's own panels/);
assert.match(draftSrc, /Outdoors no camera stands higher than about 6 m\./);
assert.match(draftSrc, /set openSky true for a space open to the sky/);

/* ---- 6. indoor rooms keep their cameras exactly ---- */
const officePoses = json(box.locationPanelPoses(office).map((p) => [p.key, p.purpose, p.pose.yaw, p.pose.place, p.pose.target]));
assert.deepEqual(officePoses, [
  ["TL", "from the doorway, looking at the far wall of Furnace Office", null, "at the entrance", ""],
  ["TR", "high corner view across Furnace Office, showing how its walls, openings and stations fit together", null, "high in a corner", ""],
  ["BL", "key station: Desk with ledgers, gas bill, glass paperweight", null, "in front of Desk with ledgers, gas bill, glass paperweight", "office-desk"],
  ["BR", "key station: Bank calendar", 0, "in front of Bank calendar", "bank-calendar"]], "Furnace Office: today's cameras");
const officeSpec = JSON.parse(box.buildLocationRefPrompt(office, film.project).split("\n").slice(1).join("\n"));
assert.match(officeSpec.views.layout, /four cameras INSIDE Furnace Office/);
assert.match(officeSpec.views.top_left, /Camera inside Furnace Office at the entrance, facing not set, level, 24 mm lens\. Interior of Furnace Office only\./);
assert.match(officeSpec.views.subspace_rules[0], /^The inside of every panel is Furnace Office only/);
assert.match(officeSpec.location.identity_layers.visual_continuity.rule, /^Where the parent plate shows this room itself/);
assert.match(box.buildSimpleLocationPrompt(office), /Four cameras inside Furnace Office — top-left: from the doorway, looking at the far wall of Furnace Office/);

/* ---- 7. "Layout changed — regenerate" only when the cameras really moved ---- */
const record = json(box.locationPlatePanelRecord(sub)), sig = box.locationPlateLayoutSig(sub, { panels: true });
const plate = { iso: "p1", platePanels: record, plateLayoutSig: sig };
assert.equal(box.locationPlateLayoutChanged(plate, sub, { panels: true }), false, "made from these cameras: nothing to say");
// the record a little off (how a camera is worked out — a centimetre, a tenth of a degree): still the same cameras
const nudged = json(record); nudged.panels.TL.position[0] += 0.01; nudged.panels.BR.yaw += 0.2;
const nudgedPlate = { iso: "p1", platePanels: nudged, plateLayoutSig: box.locationPlateLayoutSig(sub, { panels: true, record: nudged }) };
assert.notEqual(nudgedPlate.plateLayoutSig, sig, "(the hash alone would say 'changed')");
assert.equal(box.locationPlateLayoutChanged(nudgedPlate, sub, { panels: true }), false, "…but its cameras did not move");
// a camera that really moved
const moved = json(record); moved.panels.TL.yaw = 270;
assert.equal(box.locationPlateLayoutChanged({ iso: "p1", platePanels: moved, plateLayoutSig: box.locationPlateLayoutSig(sub, { panels: true, record: moved }) }, sub, { panels: true }), true);
// an older outdoor plate, made from the indoor cameras (the 11.7 m corner): its cameras really are new — it says so
const before = json(record); before.panels.TR = { ...before.panels.TR, yaw: 254.3, pitch: -53, lensMm: 16, position: [7.71, -0.08, 11.7], target: "" };
assert.equal(box.locationPlateLayoutChanged({ iso: "p0", platePanels: before, plateLayoutSig: box.locationPlateLayoutSig(sub, { panels: true, record: before }) }, sub, { panels: true }), true);
// the layout changed: said, whatever the cameras
const editedOwner = { ...owner, spatialPlan: { ...owner.spatialPlan, sightlines: owner.spatialPlan.sightlines + " Edited." } };
const editedList = locations.map((l) => l.id === owner.id ? editedOwner : l);
box.turnContinuity = { ...box.turnContinuity, locations: editedList };
assert.equal(box.locationPlateLayoutChanged(plate, sub, { panels: true }), true, "a changed layout still says so");
box.turnContinuity = { ...box.turnContinuity, locations };
// a plate without a record: judged by its sig, as before
assert.equal(box.locationPlateLayoutChanged({ iso: "p1", plateLayoutSig: sig }, sub, { panels: true }), false);
assert.equal(box.locationPlateLayoutChanged({ iso: "p1", plateLayoutSig: "pl1:old:1" }, sub, { panels: true }), true);
// an indoor room's plate made before this change is not flagged (its cameras are unchanged)
const officeRecord = json(box.locationPlatePanelRecord(office));
assert.equal(box.locationPlateLayoutChanged({ iso: "o1", platePanels: officeRecord, plateLayoutSig: box.locationPlateLayoutSig(office, { panels: true }) }, office, { panels: true }), false);

/* ---- 8. the Blender export: the corrected cameras, and the current plate's own when known ---- */
const ex = box.locationCoordinateExport(sub, locations);
assert.ok(ex.cameras.every((c) => c.pose.position[2] === 1.6 && c.studioCamera), "eye-level studio cameras for the quay stretch");
assert.equal(ex.plateCameras, undefined, "no recorded plate: no plate cameras");
const exOwner = box.locationCoordinateExport(owner, locations);
assert.ok(exOwner.cameras.every((c) => !c.pose.position || c.pose.position[2] <= 6), "no exterior camera above 6 m (the 11.7 m corner is gone)");
// a plate made from these very cameras: said in one flag, never the same four cameras twice (the package has a size limit)
metas[sub.id] = { iso: "s1", platePanels: record };
const exSame = box.locationCoordinateExport(sub, locations);
assert.equal(exSame.camerasMatchPlate, true);
assert.equal(exSame.plateCameras, undefined);
// an older plate made from other cameras (the 11.7 m corner): its own cameras go beside the ones the next plate asks for
metas[sub.id] = { iso: "s0", platePanels: before };
const ex2 = box.locationCoordinateExport(sub, locations);
assert.equal(ex2.camerasMatchPlate, undefined);
assert.equal(ex2.plateCameras.length, 4);
assert.deepEqual(json(ex2.plateCameras[0].pose), { position: [-7.2, -2.7, 1.6], yaw: 90, pitch: 0, lensMm: 24 });
assert.deepEqual(json(ex2.plateCameras[1].pose), { position: [7.71, -0.08, 11.7], yaw: 254.3, pitch: -53, lensMm: 16 });
assert.equal(ex2.plateCameras[0].plateIso, "s0");
assert.ok(ex2.plateCameras[0].studioCamera && ex2.plateCameras[0].blenderRotationEuler);
// cameras noted on the card for an older owner plate (no record): they go too
metas[owner.id] = { iso: "o9" };
const ownerNoted = { ...owner, plateCameras: box.normalizeLocationPlateCameras({ iso: "o9", source: "set", panels: { TR: { yaw: 90 } } }) };
const exNoted = box.locationCoordinateExport(ownerNoted, locations.map((l) => l.id === owner.id ? ownerNoted : l));
assert.deepEqual(json(exNoted.plateCameras.map((c) => [c.panel, c.pose.yaw, c.basis])), [["TR", 90, "user"]]);
delete metas[owner.id];
delete metas[sub.id];

console.log("PASS outdoor cameras: an outdoor part stands on itself at eye level and repeats none of its parent's views (Glass Hours: along the quay, a reverse angle, the sand sacks, the cullet skip); no exterior camera above 6 m; the owner's close-ups follow its staging; standing-on prompt wording and matching surroundings; indoor rooms unchanged; 'Layout changed' only when cameras really moved; Blender gets the corrected cameras");

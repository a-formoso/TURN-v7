#!/usr/bin/env node
/* test-location-false-openings.mjs — FALSE OPENINGS (owner-approved 2026-10-14, "go ahead with all of it").
   An object counts as a window / door / arch only when its NAME is the opening itself ("Office window", "Furnace side
   door (origin)", "Archway"), never when it merely mentions one ("Graziella's bench, stool and glory hole (seen through
   window)", "Sacks of sand by the door", "Steps by the doorway"). Applied wherever openings are derived: the openings
   of a space, the stations of its panel cameras, the floor-plan map, Plate cameras and the Blender export. An opening
   never shows the parent by default: one that names another location card points to that card; one whose words say
   nothing waits for the room's card to say where it leads. Explicit floor-plan openings still count.
   Fixture: the app's own sample film Glass Hours (scripts/fixtures/glass-hours-locations.json — its 8 location cards
   with the shared layouts the Art Room drafted). Nothing is generated, nothing is charged.
   node scripts/test-location-false-openings.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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
const metas = {}, images = {}, toasts = [];
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, CustomEvent: class {}, nbEpoch: () => 1,
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal",
  appToast: (m) => toasts.push(m), nbCostChip: () => null,
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "" };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box);
vm.runInContext(read("app/locations-ui.jsx"), box);
const json = (x) => JSON.parse(JSON.stringify(x));
const locations = film.locations.map((l) => ({ ...l }));
box.turnContinuity = { locations, scenes: film.scenes, drafts: film.drafts, characters: film.characters, props: [] };
const byId = (id) => locations.find((l) => l.id === id);
const owner = byId("loc-fondamenta-3"), sub = byId("loc-fondamenta-dei-vetrai-4"), furnace = byId("loc-furnace-1");

/* ---- 1. the name rule ---- */
const isOpening = (name) => box.locationAnchorIsOpening({ name });
for (const name of ["Office window", "Furnace side door (origin)", "Furnace window, two panes", "Archway", "Canal-side street door and stone threshold",
  "Office doorway to furnace floor", "Main entrance door", "High dawn window", "Windows onto the canal", "Glass partition", "Glass wall of the booth",
  "Plate-glass front", "Glazed screen", "Loading hatch", "Skylight", "Glass door", "Door left ajar", "Back door (boarded up)", "Row of windows", "Arch over the gate",
  // (review) a number or letter that only labels it, punctuation around it, a trailing state or side
  "Window 1", "Door B (to yard)", "Window #2", "Windows x2", "Office window.", "“Door”", "Door slightly ajar", "Window east", "Glass door A"])
  assert.ok(isOpening(name), name + " is an opening");
for (const name of ["Graziella's bench, stool and glory hole (seen through window)", "Sacks of sand by the door", "Steps by the doorway",
  "Stool by the door (holds Luca's folder)", "Office partition wall with window", "Light through the window", "Poster on the door", "Window seat",
  "Door handle", "Oven door", "Glass crates", "Glass furnace", "Glass-furnace façade", "Doormat", "Open lagoon view toward the Lido lights",
  "Sacks of sand by the door 2", "Wardrobe door 2", "Window sill",
  // an appliance's own door joined to it ("the furnace's mouth and door"), never the room's
  "Furnace mouth and door with RETAIN — FEATURE sticker", "Kiln and hatch"])
  assert.ok(!isOpening(name), name + " is an object, not an opening");
assert.equal(box.locationOpeningTerm("Furnace window, two panes"), "window");
assert.equal(box.locationOpeningTerm("Graziella's bench, stool and glory hole (seen through window)"), "");

/* ---- 2. Glass Hours' 13 quay objects: only the real window and side door are openings ---- */
const quay = owner.spatialPlan.anchors;
assert.equal(quay.length, 13);
assert.deepEqual(quay.filter((a) => box.locationAnchorIsOpening(a)).map((a) => a.id).sort(), ["fv-furnace-window", "fv-side-door"]);
// the other two layouts: their doors and windows, never the stool by the door or the partition wall with a window
assert.deepEqual(byId("loc-fiorin-furnace-0").spatialPlan.anchors.filter((a) => box.locationAnchorIsOpening(a)).map((a) => a.id), ["A-door", "A-window"]);
const furnaceOpenings = furnace.spatialPlan.anchors.filter((a) => box.locationAnchorIsOpening(a)).map((a) => a.id);
assert.ok(furnaceOpenings.includes("street-door") && furnaceOpenings.includes("office-door"));
assert.ok(!furnaceOpenings.includes("door-stool") && !furnaceOpenings.includes("office-partition"), furnaceOpenings.join(" "));
assert.deepEqual(furnaceOpenings.sort(), ["office-door", "street-door"], "the furnace's own mouth and door is not a door of the room");
assert.ok(isOpening("Furnace door") && isOpening("Stove and window"), "a furnace's door alone may be the building's; a window beside a stove is a window");

/* ---- 3. the openings of each quay space: the floor plan's own (whatever their names) and no false ones ---- */
const ops = (l) => json(box.locationSpaceOpenings(l)).map((o) => [o.id, o.kind, o.connectsTo, o.destination, o.leadsTo && o.leadsTo.id]);
assert.deepEqual(ops(sub), [
  ["fv-furnace-window", "window", "", "card", "loc-furnace-1"],     // "Furnace interior (unlisted)" → the Furnace card
  ["fv-side-door", "door", "", "card", "loc-furnace-1"],
  ["opening-3", "arch", "loc-fondamenta-3", "space", null],         // "Quay continues west" — a floor-plan opening counts
  ["opening-4", "arch", "loc-fondamenta-3", "space", null],
  ["fv-water-steps", "arch", "", "elsewhere", null]]);              // "Canal / lagoon" — not a card, never the parent
assert.ok(!ops(owner).some((o) => /bench|sand/.test(o[0])), "no false opening on the parent either");

/* ---- 4. the room's plate: no view of the parent through the furnace window, one real unresolved view ---- */
images[owner.id] = "fondamenta-plate"; metas[owner.id] = { iso: "2026-10-13T10:00:00Z" };
const plan = box.locationSubspacePanelPlan(sub);
/* (2026-10-14, fix B) the quay stretch is OUTDOOR: its cameras stand on it at eye level — the top-left looks east along it,
   so its one real open side 'Quay continues east to landing' is the only unresolved view */
assert.deepEqual(json(plan.unresolved).map((u) => [u.panel, u.openingId, u.reason]), [["TL", "opening-4", "no-record"]],
  "only a real open side of the quay is unresolved (it was 4 views: the bench 'seen through window' three times)");
assert.ok(!JSON.stringify(json(plan)).includes("fv-furnace-bench"), "the bench is never an opening of the plan");
assert.equal(box.locationParentViewRequest(sub, "fv-furnace-bench"), null, "no 'Make a Fondamenta view' for the bench");
assert.equal(box.locationParentViewRequest(sub, "fv-furnace-window"), null, "nor for the furnace window: it leads to the Furnace card");
const views = box.locationSubspaceViews(sub, plan, {});
assert.ok(!/Graziella's bench[^"]*looks/.test(JSON.stringify(views)), "no panel says the bench 'looks into Fondamenta'");
// the stations of its panel cameras: the sand sacks are an object again — a three-quarter station of the outdoor panels
// (the façade, shutter and bench are left to the parent's own close-up of them — fix B)
const poses = box.locationPanelPoses(sub);
assert.deepEqual(json(poses.map((p) => p.purpose).slice(2)), ["three-quarter view of Sacks of sand by the door, at eye level", "three-quarter view of Cullet skip, at eye level"]);

/* ---- 5. the floor-plan map and the Blender export ---- */
const scene = box.locationFloorPlanScene(owner, owner.spatialPlan, locations);
assert.deepEqual(json(scene.anchors.filter((a) => a.opening).map((a) => a.id).sort()), ["fv-furnace-window", "fv-side-door"]);
assert.ok(scene.anchors.find((a) => a.id === "fv-sand-sacks").num > 0, "the sand sacks are a numbered object on the map");
assert.ok(!scene.openings.some((o) => /bench|sand/.test(o.id)));
const ex = box.locationCoordinateExport(sub, locations);
assert.deepEqual(json(ex.openings.map((o) => o.spaceId + ":" + o.id).filter((x) => /bench|sand/.test(x))), [], "Blender gets no bench window, no sand-sack door");
assert.equal(ex.openings.length, 9);

/* ---- 6. an object-only room: never the parent by default; another card is pointed to; the card can say where ---- */
const hall = { id: "hall", key: "hall", name: "Glass Hall", spatialPlan: box.normalizeLocationSpatialPlan({ frame: "From the door", status: "reviewed",
  source: { assetId: "hall", iso: "h1" }, anchors: [
    { id: "bench", space: "Annex", name: "Bench by the window", placement: "north wall" },
    { id: "annex-window", space: "Annex", name: "Annex window", placement: "south wall, overlooking the street" },
    { id: "annex-door", space: "Annex", name: "Annex door", placement: "west wall, into the furnace" },
    { id: "hall-door", space: "Annex", name: "Hall door", placement: "east wall, onto the Glass Hall floor" }] }) };
const annex = { id: "annex", key: "annex", name: "Annex", parentKey: "hall" };
locations.push(hall, annex);
assert.deepEqual(ops(annex), [
  ["annex-window", "window", "", "unknown", null],           // its words name no space: no parent view
  ["annex-door", "door", "", "card", "loc-furnace-1"],       // "into the furnace" → the Furnace card
  ["hall-door", "door", "hall", "space", null]]);            // "onto the Glass Hall floor" → the parent, by its own words
annex.openingLeadsTo = { "annex-window": "elsewhere" };
assert.equal(json(box.locationSpaceOpenings(annex))[0].destination, "elsewhere");
annex.openingLeadsTo = { "annex-window": "hall" };
assert.deepEqual(ops(annex)[0], ["annex-window", "window", "hall", "chosen", null]);
delete annex.openingLeadsTo;
// the card just saved by Plate cameras is read as passed in — the shared snapshot (window.turnContinuity) catches up
// only after the render, and the answer must show at once (review)
assert.deepEqual(json(box.locationSpaceOpenings({ ...annex, openingLeadsTo: { "annex-window": "hall" } })).map((o) => o.destination)[0], "chosen");
annex.openingLeadsTo = { "annex-window": "hall" };   // the snapshot still has the answer…
assert.equal(json(box.locationSpaceOpenings({ ...annex, openingLeadsTo: undefined }))[0].destination, "unknown", "…'Change' clears it at once too");
delete annex.openingLeadsTo;
locations.splice(locations.indexOf(hall), 2);

/* ---- 7. Plate cameras on the quay segment's card: the furnace window points to the Furnace card ---- */
const flat = (n) => !n || typeof n !== "object" ? [] : [n, ...(n.children || []).flatMap(flat)];
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
cursor = 0; effects = []; hooks = [];
const tree = box.LocationPlateCameras({ l: sub, project: {}, onUpdate: noop, readOnly: false, plateMeta: null });
const t = text(tree);
assert.match(t, /“Furnace window \(two panes, shutter\)” opens onto Furnace — another location with its own card, so Fondamenta DEI Vetrai's plate never shows Fondamenta through it\./);
assert.match(t, /1 view unresolved/);
assert.doesNotMatch(t, /“Graziella's bench/, "the bench is never listed as a window a panel looks through");
const go = flat(tree).find((n) => n.type === "button" && text(n) === "Go to Furnace");
assert.ok(go, "a button goes to the Furnace card");
go.props.onClick();
assert.match(toasts.pop(), /Furnace's card isn't on this page/);

console.log("PASS false openings: the name is the opening (Glass Hours: only the real window and side door of 13 quay objects), never the parent by default, another card is pointed to, map / stations / Blender agree");

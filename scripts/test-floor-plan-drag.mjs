#!/usr/bin/env node
/* The floor plan, changed by hand (owner 2026-11-25, step 1: furniture, doors and windows are dragged; The place says
   where things stand, from the plan). The rules with no screen in them. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log("PASS " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n    " + String(e && e.stack || e).split("\n").slice(0, 7).join("\n    ")); } };
const c = vm.createContext({ console }); c.window = c; vm.runInContext(read("app/floor-plan-drag.js"), c);
const D = c.KinolotPlanDrag, plain = v => JSON.parse(JSON.stringify(v));
// a flat 4 m wide and 3 m deep (south wall on y = 0), and the street in front of it
const plan = () => ({ schema: "cm-spatial-layout-v1", status: "reviewed", anchors: [
    { id: "shelf", space: "Flat", name: "Wall shelf", placement: "Beside the front door.", xy: [0.1, 0.6], z: 1.2, facing: 90, posBasis: "design", size: [0.6, 0.18, 0.03] },
    { id: "table", space: "Flat", name: "Kitchen table", placement: "In the middle.", xy: [2.5, 1.5], z: 0.375, facing: 0, posBasis: "design", size: [1.2, 0.8, 0.75] },
    { id: "front-door", space: "Flat", name: "Front door", placement: "In the south wall.", xy: [1, 0], z: 1, facing: 0, posBasis: "design", size: [0.8, 0.1, 2] },
    { id: "nowhere", space: "Flat", name: "Unplaced", placement: "Somewhere." }],
  coordinates: { spaces: [
    { id: "flat", name: "Flat", footprint: [[0, 0], [4, 0], [4, 3], [0, 3]], floorZ: 0, ceilingH: 2.5, openings: [
      { id: "front-door", name: "Front door", kind: "door", edge: 0, centre: [1, 0], width: 0.8, sillZ: 0, headZ: 2, basis: "design" },
      { id: "window", name: "Kitchen window", kind: "window", edge: 0, centre: [3, 0], width: 1, sillZ: 0.8, headZ: 2.2, basis: "design" }] },
    { id: "street", name: "Street", footprint: [[-5, -6], [9, -6], [9, 0], [-5, 0]], floorZ: 0, openSky: true, openings: [
      { id: "opening-1", name: "The flat’s front door", kind: "door", edge: 2, centre: [1, 0], width: 0.8, sillZ: 0, headZ: 2, basis: "design" }] }] } });

test("1 what can be dragged: the objects with a place, and each door and window on its stretch of wall", () => {
  const o = plain(D.objects(plan()));
  assert.deepEqual(o.map(x => [x.id, x.space, x.door]), [["shelf", "Flat", false], ["table", "Flat", false], ["front-door", "Flat", true]], "an object with no place is not offered; a door that hangs in an opening is marked");
  const d = plain(D.openings(plan()));
  assert.deepEqual(d.map(x => [x.spaceId, x.id, x.kind]), [["flat", "front-door", "door"], ["flat", "window", "window"], ["street", "opening-1", "door"]]);
  assert.deepEqual(d[0].run, { a: [0, 0], b: [4, 0], inner: false, edge: 0 });
});

test("2 an object goes where it is dragged: to 5 cm, inside its room, marked as placed by hand, its sentence rewritten", () => {
  const before = plan(), frozen = JSON.stringify(before), after = D.moveObject(before, "table", [1.523, 2.208]);
  assert.equal(JSON.stringify(before), frozen, "the plan handed in is not changed");
  const t = after.anchors.find(a => a.id === "table");
  assert.deepEqual(plain(t.xy), [1.5, 2.2]); assert.equal(t.posBasis, "user");
  assert.equal(t.placement, "0.8 m from the north wall of Flat, 2.1 m north-east of Wall shelf. Placed by hand on the floor plan.");
  assert.deepEqual(plain(after.anchors.find(a => a.id === "shelf")), plain(before.anchors.find(a => a.id === "shelf")), "nothing else is touched");
  // dragged out through the wall: it stops inside
  const out = D.moveObject(before, "table", [2.5, 9]).anchors.find(a => a.id === "table");
  assert.ok(out.xy[1] < 3 && out.xy[1] > 2.4 && out.xy[0] === 2.5, "it stays in its room: " + out.xy);
  assert.equal(D.moveObject(before, "table", [2.51, 1.49]), before, "no real move: the same plan");
  // in steps of 5 cm from where it stands: a thing off the grid keeps its odd centimetres, and comes back exactly
  const odd = plan(); odd.anchors[0].xy = [0.09, 0.57];
  const up = D.moveObject(odd, "shelf", [0.1, 0.93]), back = D.moveObject(up, "shelf", [0.09, 0.56]);
  assert.deepEqual(plain(up.anchors[0].xy), [0.09, 0.92], "moved along the wall, its distance from the wall is untouched");
  assert.deepEqual(plain(back.anchors[0].xy), [0.09, 0.57], "and moved back by the same amount it is where it was");
  assert.deepEqual(plain(D.moves(odd, back)), [], "which is no move at all");
  assert.equal(D.moveObject(before, "nowhere", [1, 1]), before); assert.equal(D.moveObject(before, "none", [1, 1]), before);
  // what stands on it goes with it; what hangs above it or stands beside it does not
  const dressed = plan(); dressed.anchors.push(
    { id: "machine", space: "Flat", name: "Sewing machine", placement: "On the table.", xy: [2.3, 1.6], z: 0.9, facing: 0, posBasis: "design", size: [0.4, 0.2, 0.3] },
    { id: "lamp", space: "Flat", name: "Hanging lamp", placement: "Over the table.", xy: [2.5, 1.5], z: 2.1, facing: 0, posBasis: "design", size: [0.3, 0.3, 0.4] },
    { id: "chair", space: "Flat", name: "Chair", placement: "At the table.", xy: [2.5, 0.9], z: 0.45, facing: 0, posBasis: "design", size: [0.45, 0.45, 0.9] });
  const carried = D.moveObject(dressed, "table", [1.5, 2.2]), at = id => plain(carried.anchors.find(a => a.id === id).xy);
  assert.deepEqual(at("machine"), [1.3, 2.3], "the sewing machine rides on its table"); assert.equal(carried.anchors.find(a => a.id === "machine").posBasis, "user");
  assert.match(carried.anchors.find(a => a.id === "machine").placement, /Placed by hand on the floor plan\.$/);
  assert.deepEqual(at("lamp"), [2.5, 1.5], "a lamp hanging over it stays"); assert.deepEqual(at("chair"), [2.5, 0.9], "a chair beside it stays");
  assert.deepEqual(plain(D.moves(dressed, carried)), [{ id: "table", by: [-1, 0.7] }, { id: "machine", by: [-1, 0.7] }]);
  // a thing fixed to a wall: on that wall, and how high
  assert.equal(D.placementOf(D.moveObject(before, "shelf", [0.1, 2]), "shelf"), "On the west wall of Flat, 2.2 m north-west of Front door, its middle 1.2 m above the floor. Placed by hand on the floor plan.");
});

test("3 a door or a window slides along its wall: not off its ends, not over the next opening; its twin and its door go with it", () => {
  const before = plan(), after = D.moveOpening(before, "flat", "front-door", [1.62, 0.4]);
  const flat = after.coordinates.spaces[0], street = after.coordinates.spaces[1];
  assert.deepEqual(plain(flat.openings[0].centre), [1.6, 0], "along the wall only, to 5 cm"); assert.equal(flat.openings[0].basis, "user");
  assert.deepEqual(plain(street.openings[0].centre), [1.6, 0], "the same doorway, as the street has it"); assert.equal(street.openings[0].basis, "user");
  assert.deepEqual(plain(after.anchors.find(a => a.id === "front-door").xy), [1.6, 0], "the door that hangs in it"); assert.equal(after.anchors.find(a => a.id === "front-door").posBasis, "user");
  assert.deepEqual(plain(flat.openings[1].centre), [3, 0], "the window stays");
  // against the window: 3 - 0.5 - 0.4 - 0.05 gap
  assert.deepEqual(plain(D.moveOpening(before, "flat", "front-door", [3.5, 0]).coordinates.spaces[0].openings[0].centre), [2.05, 0], "it stops beside the window, on the side it came from");
  // to the wall's end: half its width and a gap
  assert.deepEqual(plain(D.moveOpening(before, "flat", "front-door", [-3, 0]).coordinates.spaces[0].openings[0].centre), [0.45, 0]);
  assert.deepEqual(plain(D.moveOpening(before, "flat", "window", [9, 0]).coordinates.spaces[0].openings[1].centre), [3.45, 0]);
  assert.equal(D.moveOpening(before, "flat", "front-door", [1.01, 5]), before, "no real move: the same plan");
  assert.equal(D.moveOpening(before, "flat", "none", [2, 0]), before);
  // what moved, by id: a scene's marks beside these follow
  assert.deepEqual(plain(D.moves(before, after)), [{ id: "front-door", by: [0.6, 0] }, { id: "opening-1", by: [0.6, 0] }]);
  assert.deepEqual(plain(D.moves(before, D.moveObject(before, "table", [1.5, 2.2]))), [{ id: "table", by: [-1, 0.7] }]);
  assert.deepEqual(plain(D.moves(before, before)), []);
});

test("4 where things stand, from the numbers: every door, window and object, each once", () => {
  const w = plain(D.where(plan()));
  assert.deepEqual(w.map(x => [x.kind, x.name, x.byHand]), [["opening", "Front door", false], ["opening", "Kitchen window", false], ["object", "Wall shelf", false], ["object", "Kitchen table", false]],
    "a doorway two rooms share is said once, and the door that hangs in it is not said again as a thing");
  assert.equal(w[0].text, "In the south wall of Flat, its middle 1 m from the wall’s west end (4 m long); a door 0.8 m wide.");
  assert.equal(w[1].text, "In the south wall of Flat, its middle 3 m from the wall’s west end (4 m long); a window 1 m wide.");
  assert.equal(w[2].text, "On the west wall of Flat, 1.1 m north-west of Front door, its middle 1.2 m above the floor.");
  assert.equal(w[3].text, "1.5 m from the south wall of Flat, 1.6 m north of Kitchen window.");
  assert.equal(D.byHand(plan()), 0);
  const moved = D.moveOpening(D.moveObject(plan(), "table", [1.5, 2.2]), "flat", "window", [3.3, 0]);
  assert.equal(D.byHand(moved), 2);
  assert.deepEqual(plain(D.where(moved)).filter(x => x.byHand).map(x => x.name), ["Kitchen window", "Kitchen table"]);
});

/* THE SAVE, AGAINST THE APP'S OWN FLOOR-PLAN CODE (locations.jsx and the set builder, loaded as the app loads them): a
   flat like the film's, one L-shaped outline with a doorway in a wall of its own. Nothing here saves anything. */
const box = { console, crypto: globalThis.crypto, TextEncoder, URL, location: { hostname: "localhost" }, turnIsAdmin: true, TURN_SUPABASE: { setBuild: true },
  nbGetMeta: () => null, nbGetImage: () => "", nbEpoch: () => 1, scenesInStoryOrder: x => x || [] };
box.window = box; vm.createContext(box);
for (const f of ["locations.jsx", "blender-render-contract.js", "blender-set-detail.js", "blender-render.js", "location-measurement-repair.js", "floor-plan-drag.js"])
  vm.runInContext(read("app/" + f), box, { filename: "app/" + f });
const B = box.KinolotPlanDrag;
const film = () => {
  const space = { id: "flat", name: "Hussain Flat", footprint: [[-0.5, 0], [3.5, 0], [3.5, 3.6], [0.5, 3.6], [0.5, 6], [-0.5, 6]], floorZ: 0, ceilingH: 2.5, openings: [
    { id: "hall-front-door", name: "Front door, frosted panel", kind: "door", edge: 0, centre: [0, 0], width: 0.8, sillZ: 0, headZ: 2.1, yaw: 180 },
    { id: "kitchen-window", name: "Kitchen sash window", kind: "window", edge: 0, centre: [2.6, 0], width: 1, sillZ: 0.8, headZ: 2.2, yaw: 180 },
    { id: "kitchen-doorway", name: "Hall to kitchen open doorway", kind: "arch", edge: 5, centre: [0.5, 1.4], width: 0.8, sillZ: 0, headZ: 2, yaw: 270, connectsTo: "flat" },
    { id: "bedroom-passage", name: "Hall end to bedrooms", kind: "arch", edge: 4, centre: [0, 6], width: 0.8, sillZ: 0, headZ: 2, yaw: 0 }] };
  const hold = { position: [2, 2, 1.5], yaw: 0, pitch: 0, lensMm: 24 };
  const l = { id: "flat", key: "flat", name: "Hussain Flat", coverageViews: [], spatialPlan: { status: "reviewed", source: { assetId: "flat", iso: "" }, heights: "centre",
    frame: "Standing inside the street door, facing down the hall", anchors: [
      { id: "kitchen-table", space: "Hussain Flat", name: "Small kitchen table", placement: "By the window", xy: [2.1, 1.2], z: 0.375, facing: 0, size: [0.7, 1.1, 0.75] },
      { id: "sewing-machine", space: "Hussain Flat", name: "Sewing machine", placement: "On the table", xy: [2.1, 0.9], z: 0.9, facing: 0, size: [0.4, 0.2, 0.3] },
      { id: "kitchen-fridge", space: "Hussain Flat", name: "Fridge", placement: "Northeast corner", xy: [3.1, 3.2], z: 0.85, facing: 270, size: [0.6, 0.6, 1.7] }],
    coordinates: { spaces: [{ ...space, cameras: { TL: hold, TR: hold, BL: hold, BR: hold } }] } } };
  box.turnContinuity = { locations: [l] };
  return l;
};

test("5 Save: the moved plan is confirmed as Floor plan's own Confirm confirms it, or it is not saved and says why", () => {
  const l = film(), st = box.locationSpatialPlanState(l);
  assert.equal(st.ready, true, "the fixture is a confirmed plan");
  const base = st.plan;
  // nothing moved: nothing to save
  assert.deepEqual(plain(B.commit(l, base, base, [l])), { ok: true, same: true });
  // the table is dragged: its sewing machine rides; the result is a confirmed plan the app's own check accepts
  const edited = B.moveObject(base, "kitchen-table", [1.6, 2.2]);
  const c = B.commit(l, base, edited, [l]);
  assert.equal(c.ok, true, c.error); assert.equal(c.ownerId, "flat"); assert.equal(c.plan.status, "reviewed");
  assert.deepEqual(plain(c.moved), [{ id: "kitchen-table", by: [-0.5, 1] }, { id: "sewing-machine", by: [-0.5, 1] }]);
  assert.deepEqual(plain(c.spaces), ["flat"]);
  const saved = box.locationSpatialPlanState({ ...l, spatialPlan: c.plan });
  assert.equal(saved.ready, true, "what would be saved is a confirmed floor plan");
  const table = c.plan.anchors.find(a => a.id === "kitchen-table");
  assert.deepEqual(plain(table.xy), [1.6, 2.2]); assert.equal(table.posBasis, "user"); assert.match(table.placement, /Placed by hand on the floor plan\.$/);
  assert.deepEqual(plain(c.plan.anchors.find(a => a.id === "kitchen-fridge")), plain(base.anchors.find(a => a.id === "kitchen-fridge")), "what was not moved is saved as it was");
  assert.equal(JSON.stringify(l.spatialPlan.anchors[0].xy), "[2.1,1.2]", "the film's own plan is not touched by the check");
  /* A PLACE THAT HAS ITS LOCATION IMAGE, MADE FROM THIS PLAN (most places): the plan is current because the image
     records its signature. Once a thing has moved the signature no longer matches, so the saved plan must carry the
     image's own date, as Floor plan's Confirm stamps it, or Save refuses with "the parent image changed"
     (2026-11-25: it did, on the live site, for a few hours). */
  const stamp = { iso: "2026-11-22T09:18:29.586Z", spatialPlanSig: box.locationSpatialPlanSig(base) };
  box.nbGetMeta = id => (id === l.id ? stamp : null); box.nbGetImage = id => (id === l.id ? "data:image/png;base64,AA" : "");
  try {
    const stImg = box.locationSpatialPlanState(l);
    assert.equal(stImg.ready, true, "current: its image was made from it"); assert.equal(stImg.plan.source.iso, "", "and it carries no date of its own");
    const ci = B.commit(l, stImg.plan, B.moveObject(stImg.plan, "kitchen-table", [1.6, 2.2]), [l]);
    assert.equal(ci.ok, true, ci.error);
    assert.deepEqual(plain(ci.plan.source), { assetId: l.id, iso: stamp.iso }, "confirmed against the image as it is now");
    assert.equal(box.locationSpatialPlanState({ ...l, spatialPlan: ci.plan }).ready, true, "and what is saved is a current, confirmed plan");
    assert.equal(box.locationSpatialPlanState({ ...l, spatialPlan: { ...ci.plan, source: stImg.plan.source } }).ready, false, "without the stamp it would read as out of date");
  } finally { delete box.nbGetMeta; delete box.nbGetImage; }
  assert.ok(read("app/floor-plan-drag.js").includes('const reviewed=norm({...edited,status:"reviewed",source:now.source});'));
  // a window slid along its wall, and the doorway in the wall inside the room slid along that wall
  const win = B.moveOpening(base, "flat", "kitchen-window", [1.9, 0.3]), cw = B.commit(l, base, win, [l]);
  assert.equal(cw.ok, true, cw.error); assert.deepEqual(plain(cw.plan.coordinates.spaces[0].openings.find(o => o.id === "kitchen-window").centre), [1.9, 0]);
  const arch = B.moveOpening(base, "flat", "kitchen-doorway", [0.9, 2.5]), ca = B.commit(l, base, arch, [l]);
  assert.equal(ca.ok, true, ca.error); assert.deepEqual(plain(ca.plan.coordinates.spaces[0].openings.find(o => o.id === "kitchen-doorway").centre), [0.5, 2.5], "along its own wall, x stays 0.5");
  assert.ok(box.locationInnerWall(ca.plan.coordinates.spaces[0], ca.plan.coordinates.spaces[0].openings.find(o => o.id === "kitchen-doorway")), "still a doorway in a wall of its own");
  // the plan was changed elsewhere meanwhile: nothing is overwritten
  const other = { ...l, spatialPlan: { ...l.spatialPlan, frame: "Changed in another tab" } };
  const late = B.commit(l, base, edited, [other]);
  assert.equal(late.ok, false); assert.match(late.error, /changed elsewhere while you were moving things/);
});

test("6 the page: an Edit switch on a confirmed plan, Undo, Cancel, Save; The place says where things stand; marks follow", () => {
  const ui = read("app/floor-plan-drag-ui.jsx"), face = read("app/location-set-card-ui.jsx"), locs = read("app/locations-ui.jsx"), app = read("app/app.jsx"), css = read("app/styles.css"), html = read("TURN.html"), ai = read("app/ai.jsx");
  assert.ok(ui.includes("const able = !!D && !!st && !!st.ready && writable();"), "only a confirmed plan the user may change");
  assert.ok(ui.includes('const c = D.commit(place, edit.base, edit.plan, ((window.turnContinuity||{}).locations)||[]);') && ui.includes('onUpdate(c.ownerId, { spatialPlan:c.plan }, { kind:"floor-plan-edit" });'));
  assert.ok(ui.includes("followed = Number(window.turnFloorPlanMoved(c.spaces, c.moved)) || 0;"));
  for (const id of ["plan-edit-start", "plan-edit-undo", "plan-edit-cancel", "plan-edit-save", "plan-edit-layer", "loc-where"]) assert.ok(ui.includes('"data-testid":"' + id + '"'), id);
  assert.ok(ui.includes('"Move things on the plan"') && ui.includes("Nothing is saved until you press Save."));
  // a press is not a drag: nothing moves before the pointer has travelled 5 px
  assert.ok(ui.includes("const DRAG_START = 5;") && ui.includes("if(!g.live){ if(Math.hypot(e.clientX-g.down[0], e.clientY-g.down[1])<DRAG_START) return; g.live = true; }"));
  assert.ok(ui.includes("ArrowLeft:[-D.SNAP,0]"), "the arrow keys move a thing 5 cm");
  // the card: the plan shown is the one being edited; the card's own file never saves
  assert.ok(face.includes("const planEdit = typeof window.usePlanEdit===\"function\" ? window.usePlanEdit(place, onUpdate, readOnly) : null;"));
  assert.ok(face.includes("const owner = (st && st.owner) || place, shown = editing ? planEdit.plan : (st && st.plan);"));
  assert.ok(face.includes("planReady && window.PlanEditBar ? LSC_E(window.PlanEditBar,{ edit:planEdit }) : null,") && face.includes("edit && edit.on && window.PlanEditLayer ? LSC_E(window.PlanEditLayer,{ model, edit, metres }) : null);"));
  assert.ok(!face.includes("onUpdate("), "the set card's own file never saves");
  // The place: where things stand now, from the plan
  assert.ok(locs.includes("window.PlanWhere&&React.createElement(window.PlanWhere,{l}),") && locs.indexOf("window.PlanWhere&&") < locs.indexOf('field:"architecture",label:"Architecture & layout"'));
  // a scene's marks beside what moved follow it
  assert.ok(app.includes("window.turnFloorPlanMoved = (locationIds, moves)=>{") && app.includes('const d = m && by[String(m.near||"")];'));
  assert.ok(css.includes(".lsc-edit-shape{") && css.includes(".loc-where-list{"));
  // loaded before the card that uses them, under this change's key
  assert.ok(html.indexOf("app/floor-plan-drag.js?v=") > 0 && html.indexOf("app/floor-plan-drag.js?v=") < html.indexOf("app/floor-plan-drag-ui.jsx?v=") && html.indexOf("app/floor-plan-drag-ui.jsx?v=") < html.indexOf("app/location-set-card-ui.jsx?v="));
  for (const f of ["app/floor-plan-drag.js", "app/floor-plan-drag-ui.jsx", "app/location-set-card.js", "app/location-set-card-ui.jsx", "app/locations-ui.jsx", "app/app.jsx", "app/styles.css", "app/ai.jsx", "app/script.jsx"])
    assert.ok(["20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6"].some(k => html.includes(f + "?v=" + k + '"')), f + " has this change's key");
  assert.ok(/MOVE THINGS ON THE PLAN \(2026-11-25\)/.test(ai) && /Where things stand/.test(ai));
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

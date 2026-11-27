#!/usr/bin/env node
/* The floor plan, changed by hand (owner 2026-11-25, step 1: furniture, doors and windows are dragged; The place says
   where things stand, from the plan; step 2, "yes, go on to step 2, the walls": a wall is dragged square to itself).
   The rules with no screen in them. */
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
  assert.deepEqual(w.map(x => [x.kind, x.name, x.byHand]), [["room", "Flat", false], ["room", "Street", false], ["opening", "Front door", false], ["opening", "Kitchen window", false], ["object", "Wall shelf", false], ["object", "Kitchen table", false]],
    "each room first; a doorway two rooms share is said once, and the door that hangs in it is not said again as a thing");
  assert.equal(w[0].text, "4 m east to west and 3 m north to south, 12 m² of floor. Walls, in order: south 4 m, east 3 m, north 4 m, west 3 m.");
  w.splice(0, 2);
  assert.equal(w[0].text, "In the south wall of Flat, its middle 1 m from the wall’s west end (4 m long); a door 0.8 m wide.");
  assert.equal(w[1].text, "In the south wall of Flat, its middle 3 m from the wall’s west end (4 m long); a window 1 m wide.");
  assert.equal(w[2].text, "On the west wall of Flat, 1.1 m north-west of Front door, its middle 1.2 m above the floor.");
  assert.equal(w[3].text, "1.5 m from the south wall of Flat, 1.6 m north of Kitchen window.");
  assert.equal(D.byHand(plan()), 0);
  const moved = D.moveOpening(D.moveObject(plan(), "table", [1.5, 2.2]), "flat", "window", [3.3, 0]);
  assert.equal(D.byHand(moved), 2);
  assert.deepEqual(plain(D.where(moved)).filter(x => x.byHand).map(x => x.name), ["Kitchen window", "Kitchen table"]);
});

/* ---- STEP 2: THE WALLS ---- */
const fp = (p, i) => plain(p.coordinates.spaces[i || 0].footprint), at = (p, id) => plain(p.anchors.find(a => a.id === id).xy);
test("4a the walls of a room: named by the side they face, and which cannot be moved yet", () => {
  const w = plain(D.walls(plan()));
  assert.deepEqual(w.filter(x => x.spaceId === "flat").map(x => [x.id, x.name, x.length, !!x.locked]),
    [["wall:flat:0", "South wall of Flat", 4, true], ["wall:flat:1", "East wall of Flat", 3, false], ["wall:flat:2", "North wall of Flat", 4, false], ["wall:flat:3", "West wall of Flat", 3, false]]);
  assert.equal(w[0].locked, "It is shared with Street: a wall two rooms share cannot be moved yet.", "the flat's front wall lies on the street's edge, and its door is the street's door too");
  assert.ok(w.find(x => x.id === "wall:street:2").locked, "and so the street's side of it");
  assert.equal(D.slideWall(plan(), "flat", 0, [1, -1]).why, w[0].locked);
  // an L-shaped room: the walls of the inner corner face OUT of the room (a hall's east wall is east, though the room's middle lies east of it)
  const L = { anchors: [{ id: "pegs", space: "Hall", name: "Coat pegs", xy: [0.45, 5], z: 1.6, facing: 270, size: [0.6, 0.1, 0.2], placement: "x" }],
    coordinates: { spaces: [{ id: "h", name: "Hall", footprint: [[-0.5, 0], [3.7, 0], [3.7, 3.6], [0.5, 3.6], [0.5, 6.5], [-0.5, 6.5]], openings: [] }] } };
  assert.deepEqual(plain(D.walls(L)).map(x => x.side), ["south", "east", "north", "east", "north", "west"]);
  assert.match(D.placementOf(L, "pegs"), /^On the east wall of Hall/);
  assert.equal(D.where(L)[0].text, "4.2 m east to west and 6.5 m north to south at its widest, 18 m² of floor. Walls, in order: south 4.2 m, east 3.6 m, north 3.2 m, east 2.9 m, north 1 m, west 6.5 m.");
  // a stretch of wall that runs straight on into the next one is not moved by itself
  const bent = { anchors: [], coordinates: { spaces: [{ id: "r", name: "Room", footprint: [[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]], openings: [] }] } };
  assert.match(D.walls(bent)[0].locked, /runs straight on into the next one/); assert.equal(D.walls(bent)[2].locked, "");
});

test("4b a wall is moved square to itself: what is in it and against it goes with it, the walls beside it follow", () => {
  const p = plan();
  // out: the room grows; the shelf that hangs on the wall goes with it; the table stays; the wall beside it is longer
  const out = D.slideWall(p, "flat", 3, [-0.5, 1]);
  assert.equal(out.why, ""); assert.deepEqual(fp(out.plan), [[-0.5, 0], [4, 0], [4, 3], [-0.5, 3]]);
  assert.deepEqual(at(out.plan, "shelf"), [-0.4, 0.6]); assert.deepEqual(at(out.plan, "table"), [2.5, 1.5]); assert.deepEqual(at(out.plan, "front-door"), [1, 0]);
  const shelf = out.plan.anchors.find(a => a.id === "shelf");
  assert.equal(shelf.posBasis, "user"); assert.match(shelf.placement, /^On the west wall of Flat.* Placed by hand on the floor plan\.$/);
  assert.equal(out.plan.coordinates.spaces[0].basis, "user", "the room's outline is marked as set by hand");
  assert.equal(out.plan.anchors.find(a => a.id === "table").placement, "In the middle.", "what did not move keeps its own words");
  assert.deepEqual(fp(p), [[0, 0], [4, 0], [4, 3], [0, 3]], "the plan given is not changed");
  assert.equal(D.moveWall(p, "flat", 3, [-0.5, 1]).coordinates.spaces[0].footprint[0][0], -0.5);
  // in steps of 5 cm from where it stands; less than half a step is no move; moved back, it is exactly where it was
  assert.equal(D.slideWall(p, "flat", 1, [4.02, 1]).plan, p);
  assert.deepEqual(fp(D.moveWall(p, "flat", 1, [4.33, 1])), [[0, 0], [4.35, 0], [4.35, 3], [0, 3]]);
  const back = D.moveWall(D.moveWall(p, "flat", 3, [-0.5, 1]), "flat", 3, [0, 1]);
  assert.deepEqual(fp(back), fp(p)); assert.deepEqual(at(back, "shelf"), [0.1, 0.6]);
  // its doors and windows go with it, and the door that hangs in one
  const q = { anchors: [{ id: "d", space: "R", name: "Door", xy: [4, 1], z: 1, facing: 90, size: [0.8, 0.1, 2], placement: "x" }, { id: "units", space: "R", name: "Run of units", xy: [3.7, 2.2], z: 0.45, facing: 90, size: [1.2, 0.6, 0.9], placement: "x" },
      { id: "kettle", space: "R", name: "Kettle", xy: [3.7, 2.4], z: 1.0, facing: 0, size: [0.2, 0.2, 0.2], placement: "x" }, { id: "chair", space: "R", name: "Chair", xy: [2, 1.5], z: 0.45, facing: 0, size: [0.4, 0.4, 0.9], placement: "x" },
      { id: "picture", space: "R", name: "Picture", xy: [3.95, 2.85], z: 1.5, facing: 90, size: [0.15, 0.04, 0.3], placement: "x" }],
    coordinates: { spaces: [{ id: "r", name: "R", footprint: [[0, 0], [4, 0], [4, 3], [0, 3]], openings: [{ id: "d", name: "Door", kind: "door", edge: 1, centre: [4, 1], width: 0.8 }, { id: "w", name: "Window", kind: "window", edge: 2, centre: [3, 3], width: 1 }] }],
      cameras: [{ spaceId: "r", panel: "TL", position: [3.6, 0.4, 1.6] }, { spaceId: "r", panel: "TR", position: [2, 2, 1.6] }] } };
  const e = D.moveWall(q, "r", 1, [5, 1]);
  assert.deepEqual(plain(e.coordinates.spaces[0].openings[0].centre), [5, 1]); assert.equal(e.coordinates.spaces[0].openings[0].basis, "user"); assert.deepEqual(at(e, "d"), [5, 1]);
  assert.deepEqual(plain(e.coordinates.spaces[0].openings[1].centre), [3, 3], "a window of another wall stays");
  // what stands against it goes with it, and what stands on that; a chair in the room stays
  assert.deepEqual([at(e, "units"), at(e, "kettle"), at(e, "chair")], [[4.7, 2.2], [4.7, 2.4], [2, 1.5]]);
  // and back in: the kettle stays on the units it stands on (the wall would reach it first and push it by itself)
  const eIn = D.slideWall(q, "r", 1, [3.5, 1]);
  assert.deepEqual(fp(eIn.plan)[1], [3.55, 0], "as far as the window of the north wall lets it");
  assert.deepEqual([at(eIn.plan, "units"), at(eIn.plan, "kettle")], [[3.25, 2.2], [3.25, 2.4]]);
  const there = D.moveWall(q, "r", 1, [4.5, 1]), again = D.moveWall(there, "r", 1, [4, 1]);
  assert.deepEqual([at(again, "units"), at(again, "kettle"), at(again, "d")], [[3.7, 2.2], [3.7, 2.4], [4, 1]], "out and back: everything is where it was");
  // a camera of the plan that stood beside the wall goes with it; one in the middle of the room stays
  assert.deepEqual(plain(e.coordinates.cameras.map(c => c.position)), [[4.6, 0.4, 1.6], [2, 2, 1.6]]);
  // AGAINST a wall means the wall it stands at: a picture on the east wall whose end is near the north wall stays when the north wall goes out
  const n = D.moveWall(q, "r", 2, [1, 4]);
  assert.deepEqual(at(n, "picture"), [3.95, 2.85]); assert.deepEqual(plain(n.coordinates.spaces[0].openings[1].centre), [3, 4]);
  // moved in, a wall pushes what it meets ahead of it: the chair, at its own half-width from the wall
  const i = D.slideWall(q, "r", 3, [1.9, 1]);
  assert.equal(i.why, ""); assert.deepEqual(fp(i.plan), [[1.9, 0], [4, 0], [4, 3], [1.9, 3]]); assert.deepEqual(at(i.plan, "chair"), [2.1, 1.5]);
  assert.deepEqual(plain(i.plan.coordinates.cameras[1].position), [2.2, 2, 1.6], "and a camera it reaches is kept 30 cm clear of it");
});

test("4c a wall stops, and says why", () => {
  const p = plan();
  // a door of the wall beside it needs the room it has
  const w = D.slideWall(p, "flat", 3, [1.5, 1]);
  assert.deepEqual(fp(w.plan), [[0.55, 0], [4, 0], [4, 3], [0.55, 3]]); assert.equal(w.why, "Front door needs its wall: the corner cannot come closer to it.");
  assert.deepEqual(fp(D.slideWall(p, "flat", 1, [1.1, 1]).plan)[1], [3.55, 0], "and the window on the other side");
  // a thing it pushes must keep a place in the room
  const n = D.slideWall(p, "flat", 2, [1, 0.1]);
  assert.deepEqual(fp(n.plan), [[0, 0], [4, 0], [4, 0.45], [0, 0.45]]); assert.equal(n.why, "There is no room left for Kitchen table."); assert.deepEqual(at(n.plan, "table"), [2.5, 0.05]);
  // a wall beside it would become shorter than 30 cm
  const bare = { anchors: [], coordinates: { spaces: [{ id: "r", name: "Room", footprint: [[0, 0], [4, 0], [4, 3], [0, 3]], openings: [] }] } };
  const s = D.slideWall(bare, "r", 2, [1, -2]);
  assert.deepEqual(fp(s.plan), [[0, 0], [4, 0], [4, 0.3], [0, 0.3]]); assert.equal(s.why, "A wall of Room would become shorter than 0.3 m.");
  // a room inside a larger space stays inside it; the space cannot be drawn in over the room
  const house = { anchors: [{ id: "bin", space: "House", name: "Bin", xy: [2.3, 1], z: 0.4, facing: 0, size: [0.4, 0.4, 0.8], placement: "x" }],
    coordinates: { spaces: [{ id: "house", name: "House", footprint: [[0, 0], [6, 0], [6, 5], [0, 5]], openings: [] }, { id: "hall", name: "Hall", footprint: [[1, 0.5], [2, 0.5], [2, 3], [1, 3]], openings: [] }] } };
  assert.ok(plain(D.walls(house)).every(x => !x.locked), "a room that stands clear inside a space shares no wall with it");
  const grow = D.slideWall(house, "hall", 2, [1.5, 9]);
  assert.deepEqual(fp(grow.plan, 1), [[1, 0.5], [2, 0.5], [2, 5], [1, 5]]); assert.equal(grow.why, "Hall has to stay inside House.");
  const cut = D.slideWall(house, "house", 3, [2, 1]);
  assert.deepEqual(fp(cut.plan, 0), [[1, 0], [6, 0], [6, 5], [1, 5]]); assert.equal(cut.why, "Hall stands in House and has to stay inside it.");
  // what stands against the wall on its OTHER side goes with it too: the bin by the hall's wall, in the house
  assert.deepEqual(at(D.moveWall(house, "hall", 1, [3, 1]), "bin"), [3.3, 1]);
  // two rooms side by side: neither may run into the other
  const pair = { anchors: [], coordinates: { spaces: [{ id: "a", name: "Kitchen", footprint: [[0, 0], [3, 0], [3, 3], [0, 3]], openings: [] }, { id: "b", name: "Bedroom", footprint: [[4, 0], [7, 0], [7, 3], [4, 3]], openings: [] }] } };
  const hit = D.slideWall(pair, "a", 1, [6, 1]);
  assert.deepEqual(fp(hit.plan, 0), [[0, 0], [4, 0], [4, 3], [0, 3]]); assert.equal(hit.why, "Kitchen would run into Bedroom.");
  assert.match(D.walls(hit.plan)[1].locked, /shared with Bedroom/, "once they touch, the wall is one they share");
});

test("4d what is not in the plan follows the walls: carry", () => {
  const p = plan(), out = D.moveWall(p, "flat", 1, [5, 1]), C = D.carry(p, out);
  assert.equal(C.any, true); assert.deepEqual(plain(C.edges), [{ spaceId: "flat", edge: 1, by: 1 }]);
  // a camera that stood beside the wall goes with it (its height kept); one in the room stays, the very same array
  assert.deepEqual(plain(C.point([3.6, 1, 1.6], { space: "flat", ride: 0.6, clear: 0.3 })), [4.6, 1, 1.6]);
  const mid = [2, 1, 1.6]; assert.equal(C.point(mid, { space: "flat", ride: 0.6, clear: 0.3 }), mid);
  // the wall comes in: a mark it reaches is kept clear of it; with no room named, the room that held the point is taken
  const C2 = D.carry(p, D.moveWall(p, "flat", 1, [3.6, 1]));
  assert.deepEqual(plain(C2.edges), [{ spaceId: "flat", edge: 1, by: -0.4 }]);
  assert.deepEqual(plain(C2.point([3.5, 2], { clear: 0.25 })), [3.35, 2]);
  const far = [1, 2]; assert.equal(C2.point(far, { clear: 0.25 }), far);
  // nothing moved: nothing is carried
  const none = D.carry(p, p); assert.equal(none.any, false); assert.equal(none.point(mid, { ride: 1 }), mid);
  // how much a change moved: things and walls
  assert.equal(D.changed(p, p), 0); assert.equal(D.changed(p, out), 1); assert.equal(D.changed(p, D.moveWall(p, "flat", 3, [-0.5, 1])), 2, "a wall and the shelf on it");
  assert.equal(D.byHand(out), 0); assert.equal(D.where(out)[0].byHand, true, "the room says its walls were moved by hand");
});

test("4e what a save writes beside the plan when a wall moved: cameras set by hand, the set's dressing, a scene's marks and cameras", () => {
  const p = plan(), out = D.moveWall(p, "flat", 1, [5, 1]), C = D.carry(p, out);
  const cam = (panel, position) => ({ id: "v-" + panel, panel, purpose: "x", pose: { position, yaw: 270, pitch: 0, lensMm: 24 } });
  const flat = { id: "flat", coverageViews: [cam("TL", [3.6, 0.4, 1.6]), cam("TR", [0.4, 2.6, 1.6]), { id: "plain", panel: "BL" }],
    previs: { v: 1, iso: "i", engine: "e", extras: [{ name: "radiator", at: [3.9, 2, 0.4], turn: 90, parts: [] }, { name: "rug", at: [2, 1.5, 0], turn: 0, parts: [] }], light: { time: "day", lamps: [{ at: [3.8, 1, 2], power: 1 }, { at: [2, 1.5, 2.3], power: 1 }] } } };
  const street = { id: "street", coverageViews: [cam("TL", [6, -3, 1.6])] }, other = { id: "elsewhere", coverageViews: [cam("TL", [3.6, 0.4, 1.6])] };
  const f = D.follow(C, [flat, street, other], ["flat", "street"], "flat");
  assert.deepEqual(Object.keys(f.patches), ["flat"], "only the card whose things a wall took; a card of another place is never touched");
  assert.equal(f.cameras, 1); assert.equal(f.pieces, 2);
  assert.deepEqual(plain(f.patches.flat.coverageViews.map(v => v.pose && v.pose.position)), [[4.6, 0.4, 1.6], [0.4, 2.6, 1.6], null], "the camera beside the wall goes with it, its height kept");
  assert.equal(f.patches.flat.coverageViews[1], flat.coverageViews[1], "what did not move is the very same row"); assert.equal(f.patches.flat.coverageViews[0].pose.yaw, 270);
  assert.deepEqual(plain(f.patches.flat.previs.extras.map(x => x.at)), [[4.9, 2, 0.4], [2, 1.5, 0]], "the radiator on the wall goes with it, the rug stays");
  assert.deepEqual(plain(f.patches.flat.previs.light.lamps.map(x => x.at)), [[4.8, 1, 2], [2, 1.5, 2.3]]);
  assert.equal(f.patches.flat.previs.iso, "i"); assert.equal(f.patches.flat.previs.light.time, "day");
  assert.deepEqual(plain(D.follow(null, [flat], ["flat"], "flat")), { patches: {}, cameras: 0, pieces: 0, turned: 0, hand: 0 }, "no wall moved: nothing beside the plan");
  assert.deepEqual(plain(D.follow(D.carry(p, p), [flat], ["flat"], "flat").patches), {});
  // the dressing that stands ON a thing that moved goes with that thing, wall or no wall: the clutter on a table, not the rug under it or the lamp over it
  const tabled = D.moveObject(p, "table", [3, 1.5]), room = { id: "flat", coverageViews: [cam("TL", [2.4, 1.4, 1.6])],
    previs: { v: 1, extras: [{ name: "table clutter", at: [2.6, 1.6, 0.75] }, { name: "rug", at: [2.5, 1.5, 0] }, { name: "radiator", at: [3.9, 2, 0.4] }], light: { lamps: [{ at: [2.5, 1.5, 2.3] }, { at: [2.4, 1.4, 0.8] }] } } };
  const ft = D.follow(null, [room], ["flat"], "flat", p, D.moves(p, tabled));
  assert.equal(ft.cameras, 0); assert.equal(ft.pieces, 2); assert.equal(ft.patches.flat.coverageViews, undefined, "a camera is moved by a wall only");
  assert.deepEqual(plain(ft.patches.flat.previs.extras.map(x => x.at)), [[3.1, 1.6, 0.75], [2.5, 1.5, 0], [3.9, 2, 0.4]]);
  assert.deepEqual(plain(ft.patches.flat.previs.light.lamps.map(x => x.at)), [[2.5, 1.5, 2.3], [2.9, 1.4, 0.8]], "the lamp that stands on the table goes with it");
  // a planned scene: the mark beside a thing that moved goes with it; a wall that comes in keeps the others, and the shot cameras, inside
  const inn = D.moveWall(p, "flat", 1, [3.6, 1]), Cin = D.carry(p, inn);
  const plans = { s1: { sets: [{ id: "set1", locationId: "flat" }], marks: [{ id: "m1", set: "set1", xy: [3.5, 2], near: "" }, { id: "m2", set: "set1", xy: [1, 1], near: "table" }, { id: "m3", set: "set1", xy: [1.5, 2.5] }],
      cameras: { "1.1": { at: [3.55, 1], lens: 35 }, "1.2": { at: [1, 1], lens: 50 } } },
    s2: { sets: [{ id: "a", locationId: "elsewhere" }], marks: [{ id: "x", set: "a", xy: [3.5, 2] }], cameras: { "1.1": { at: [3.55, 1] } } },
    s3: { sets: [{ id: "a", locationId: "elsewhere" }, { id: "b", locationId: "flat" }], marks: [{ id: "y", set: "a", xy: [3.5, 2] }, { id: "z", set: "b", xy: [3.5, 2] }], cameras: { "1.1": { at: [3.55, 1] }, "2.1": { at: [3.55, 1] } } } };
  const shots = [{ sceneId: "s3", planSet: "b", k: "2.1" }, { sceneId: "s3", planSet: "a", k: "1.1" }];
  const r = D.sceneMoves(plans, ["flat", "street"], [{ id: "table", by: [0.5, 0] }], Cin, shots, sh => sh.k);
  assert.deepEqual(Object.keys(r.next), ["s1", "s3"], "a scene staged elsewhere is not touched"); assert.equal(r.count, 5);
  assert.deepEqual(plain(r.next.s1.marks.map(m => m.xy)), [[3.35, 2], [1.5, 1], [1.5, 2.5]]); assert.equal(r.next.s1.marks[2], plans.s1.marks[2]);
  assert.deepEqual(plain(r.next.s1.cameras), { "1.1": { at: [3.3, 1], lens: 35 }, "1.2": { at: [1, 1], lens: 50 } });
  assert.deepEqual(plain(r.next.s3.marks.map(m => m.xy)), [[3.5, 2], [3.35, 2]], "in a scene of two places, only the marks of this place's set");
  assert.deepEqual(plain(r.next.s3.cameras), { "1.1": { at: [3.55, 1] }, "2.1": { at: [3.3, 1] } }, "and only the cameras of the shots staged here");
  // step 1 as it was: no wall, only the marks beside what moved
  const r1 = D.sceneMoves(plans, ["flat"], [{ id: "table", by: [0.5, 0] }], null, shots, sh => sh.k);
  assert.equal(r1.count, 1); assert.deepEqual(Object.keys(r1.next), ["s1"]); assert.equal(r1.next.s1.cameras, plans.s1.cameras);
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

test("4f the cameras keep their view: one aimed at a thing follows it, a wide one turns with its room, one set by hand is never turned (owner 2026-11-26)", () => {
  const p = plan(), near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, a + " is about " + b);
  const cam = (panel, position, yaw, more) => ({ id: "v-" + panel, panel, purpose: "x", pose: { position, yaw, pitch: -15, lensMm: 28, basis: "design", ...(more || {}) } });
  // 1 THE SUBJECT MOVES AND THE CAMERA CAN GO WITH IT: the same step, so the same picture of the thing (no turn)
  const up = D.moveObject(p, "table", [2.5, 2]), flat1 = { id: "flat", coverageViews: [cam("BL", [3.6, 0.5, 1.5], 312.3, { target: "table" }), cam("TL", [0.4, 2.6, 1.6], 135)] };
  const f1 = D.follow(null, [flat1], ["flat", "street"], "flat", p, D.moves(p, up), up);
  assert.equal(f1.cameras, 1); assert.equal(f1.turned, 0); assert.equal(f1.hand, 0);
  assert.deepEqual(plain(f1.patches.flat.coverageViews[0].pose), { position: [3.6, 1, 1.5], yaw: 312.3, pitch: -15, lensMm: 28, basis: "design", target: "table" });
  assert.equal(f1.patches.flat.coverageViews[1], flat1.coverageViews[1], "the wide camera of a room whose walls did not move is the very same row");
  // 2 IT CANNOT STAND THERE (it would be 20 cm from the east wall): it stays, and turns and tilts to keep the thing where it sat in its picture
  const east = D.moveObject(p, "table", [2.7, 1.5]), f2 = D.follow(null, [flat1], ["flat"], "flat", p, D.moves(p, east), east), pose2 = f2.patches.flat.coverageViews[0].pose;
  assert.deepEqual(plain(pose2.position), [3.6, 0.5, 1.5]); near(pose2.yaw, 318, 0.11); near(pose2.pitch, -16.49, 0.05); assert.equal(f2.turned, 1);
  // (and never into a piece of furniture: a step that would put it inside the shelf's outline is not taken)
  const blocked = { ...p, anchors: p.anchors.concat([{ id: "cupboard", space: "Flat", name: "Cupboard", placement: "x", xy: [3.5, 1.1], z: 1, facing: 0, posBasis: "design", size: [0.6, 0.6, 2] }]) };
  const up2 = D.moveObject(blocked, "table", [2.5, 2]), f2b = D.follow(null, [flat1], ["flat"], "flat", blocked, D.moves(blocked, up2), up2);
  assert.deepEqual(plain(f2b.patches.flat.coverageViews[0].pose.position), [3.6, 0.5, 1.5], "it stays out of the cupboard"); assert.equal(f2b.turned, 1);
  // 3 SET BY HAND: never moved by its subject and never turned; it is counted, so the page can say "look at its view"
  const mine = { id: "flat", coverageViews: [cam("BL", [3.6, 0.5, 1.5], 312.3, { target: "table", basis: "user" })] };
  const f3 = D.follow(null, [mine], ["flat"], "flat", p, D.moves(p, up), up);
  assert.deepEqual(plain(f3), { patches: {}, cameras: 0, pieces: 0, turned: 0, hand: 1 });
  // 4 A WALL MOVES: the camera beside it goes with it and turns back to its subject; the wide one turns with the room
  //   (the middle of the room stays where it was in its picture); a hand-set wide one keeps its angle and is counted
  const out = D.moveWall(p, "flat", 1, [5, 1]), C = D.carry(p, out);
  const flat4 = { id: "flat", coverageViews: [cam("BL", [3.6, 0.4, 1.6], 315, { target: "table" }), cam("TL", [0.4, 2.6, 1.6], 135), cam("TR", [0.4, 0.4, 1.6], 45, { basis: "user" })] };
  const f4 = D.follow(C, [flat4], ["flat", "street"], "flat", p, D.moves(p, out), out), v4 = f4.patches.flat.coverageViews;
  assert.deepEqual(plain(v4[0].pose.position), [4.6, 0.4, 1.6]); near(v4[0].pose.yaw, 297.6, 0.11); assert.ok(v4[0].pose.pitch > -15 && v4[0].pose.pitch < -9, "further away: it looks less steeply down");
  assert.deepEqual(plain(v4[1].pose.position), [0.4, 2.6, 1.6]); near(v4[1].pose.yaw, 128.1, 0.11); assert.equal(v4[1].pose.pitch, -15);
  assert.equal(v4[2], flat4.coverageViews[2], "the camera set by hand is the very same row"); assert.equal(f4.cameras, 2); assert.equal(f4.turned, 2); assert.equal(f4.hand, 1);
  // (a camera that names a thing it does not look at, 90 degrees off, is a wide view for this: it turns with the room, never to the thing)
  const off = { id: "flat", coverageViews: [cam("BR", [0.4, 2.6, 1.6], 135, { target: "shelf" })] }, f4b = D.follow(C, [off], ["flat"], "flat", p, D.moves(p, out), out);
  near(f4b.patches.flat.coverageViews[0].pose.yaw, 128.1, 0.11); assert.equal(f4b.patches.flat.coverageViews[0].pose.pitch, -15);
  // without the plan as it is saved (the call of step 2), cameras are only moved by the walls, as before
  const f5 = D.follow(C, [flat4], ["flat"], "flat", p, D.moves(p, out));
  assert.equal(f5.patches.flat.coverageViews[0].pose.yaw, 315); assert.equal(f5.turned, 0);
  // out and back: every camera is where it was, looking where it looked
  const back = D.moveWall(out, "flat", 1, [4, 1]), after4 = { id: "flat", coverageViews: v4 };
  const f6 = D.follow(D.carry(out, back), [after4], ["flat"], "flat", out, D.moves(out, back), back), v6 = f6.patches.flat.coverageViews;
  assert.deepEqual(plain(v6[0].pose.position), [3.6, 0.4, 1.6]); near(v6[0].pose.yaw, 315, 0.11); near(v6[0].pose.pitch, -15, 0.02); near(v6[1].pose.yaw, 135, 0.11);
});

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
  /* THE EDIT AS THE FILM WOULD BE IF IT WERE SAVED NOW (owner 2026-11-26: the 3D set follows the plan while it is
     changed): the film's list with the edited plan on its place and what Save would write beside it. Nothing is saved. */
  assert.equal(B.preview(l, base, base, [l]), null, "nothing moved: no preview, the saved set is shown");
  const apart = { id: "elsewhere", name: "Elsewhere" }, pv = B.preview(l, base, edited, [l, apart]);
  assert.equal(pv.ownerId, "flat"); assert.equal(pv.list.length, 2); assert.equal(pv.list[1], apart, "a card of another place is the very same row");
  assert.deepEqual(plain(pv.list[0].spatialPlan), plain(c.plan), "the plan Save would write"); assert.equal(box.locationSpatialPlanState(pv.list[0], pv.list).ready, true);
  assert.ok(pv.key && pv.key !== B.preview(l, base, B.moveObject(base, "kitchen-table", [1.6, 2.1]), [l]).key, "the key changes with the plan");
  assert.equal(JSON.stringify(l.spatialPlan.anchors[0].xy), "[2.1,1.2]", "and the film's own plan is still untouched");
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
  // STEP 2: a wall moved out is saved the same way; the doorway in its own wall inside the room is still that; a wall alone is a change
  const wide = B.slideWall(base, "flat", 1, [4.2, 1]);
  assert.equal(wide.why, ""); assert.deepEqual(plain(wide.plan.coordinates.spaces[0].footprint), [[-0.5, 0], [4.2, 0], [4.2, 3.6], [0.5, 3.6], [0.5, 6], [-0.5, 6]]);
  assert.deepEqual(plain(wide.plan.anchors.find(a => a.id === "kitchen-fridge").xy), [3.8, 3.2], "the fridge that stands against it goes with it");
  const cwall = B.commit(l, base, wide.plan, [l]);
  assert.equal(cwall.ok, true, cwall.error); assert.deepEqual(plain(cwall.walls), [{ spaceId: "flat", edge: 1, by: 0.7 }]);
  assert.equal(box.locationSpatialPlanState({ ...l, spatialPlan: cwall.plan }).ready, true);
  assert.ok(box.locationInnerWall(cwall.plan.coordinates.spaces[0], cwall.plan.coordinates.spaces[0].openings.find(o => o.id === "kitchen-doorway")));
  const hall = B.slideWall(base, "flat", 4, [0, 7]), chall = B.commit(l, base, hall.plan, [l]);
  assert.equal(B.moves(base, hall.plan).length, 1, "only the passage in that wall moved"); assert.equal(chall.ok, true, chall.error); assert.equal(chall.same, undefined);
  assert.deepEqual(plain(chall.plan.coordinates.spaces[0].openings.find(o => o.id === "bedroom-passage").centre), [0, 7]);
  // the hall's east wall, moved toward the doorway's own wall inside the room, stops before the doorway loses its wall
  const squeeze = B.slideWall(base, "flat", 3, [-0.4, 5]);
  assert.match(squeeze.why, /needs its wall|stands in a wall of its own|shorter than/); assert.equal(B.commit(l, base, squeeze.plan, [l]).ok, true);
  /* AND IT CANNOT BE MOVED OUT, away from the kitchen (2026-11-26, found by a dry run on the film's flat): the wall that
     holds the kitchen doorway ends at the corner where this wall starts; with the hall widened it would lose that
     corner and run on down the middle of the hall. The wall does not move at all that way, and says why. */
  const widen = B.slideWall(base, "flat", 3, [1, 5]);
  assert.equal(widen.plan, base, "nothing moved"); assert.match(widen.why, /that holds Hall to kitchen open doorway ends at this corner\. Moved this way, that wall would run on across the room\./);
  const inner0 = box.locationInnerWall(base.coordinates.spaces[0], base.coordinates.spaces[0].openings.find(o => o.id === "kitchen-doorway"));
  assert.deepEqual(plain([inner0.a, inner0.b]), [[0.5, 0], [0.5, 3.6]], "the doorway's wall, from the front wall to the corner");
  // (the kitchen's own north wall, which that corner also belongs to, still moves: the doorway's wall grows with it to the corner's new place)
  const north = B.slideWall(base, "flat", 2, [2, 4.1]), inner1 = box.locationInnerWall(north.plan.coordinates.spaces[0], north.plan.coordinates.spaces[0].openings.find(o => o.id === "kitchen-doorway"));
  assert.notEqual(north.plan, base); assert.deepEqual(plain([inner1.a, inner1.b]), [[0.5, 0], [0.5, 4.1]]);
  // the plan was changed elsewhere meanwhile: nothing is overwritten
  const other = { ...l, spatialPlan: { ...l.spatialPlan, frame: "Changed in another tab" } };
  const late = B.commit(l, base, edited, [other]);
  assert.equal(late.ok, false); assert.match(late.error, /changed elsewhere while you were moving things/);
});

test("6 the page: an Edit switch on a confirmed plan, Undo, Cancel, Save; The place says where things stand; marks follow", () => {
  const ui = read("app/floor-plan-drag-ui.jsx"), face = read("app/location-set-card-ui.jsx"), locs = read("app/locations-ui.jsx"), app = read("app/app.jsx"), css = read("app/styles.css"), html = read("TURN.html"), ai = read("app/ai.jsx");
  assert.ok(ui.includes("const able = !!D && !!st && !!st.ready && writable();"), "only a confirmed plan the user may change");
  assert.ok(ui.includes('const c = D.commit(place, edit.base, edit.plan, ((window.turnContinuity||{}).locations)||[]);') && ui.includes('onUpdate(c.ownerId, { spatialPlan:c.plan, ...(more[c.ownerId]||{}) }, { kind:"floor-plan-edit" });'));
  assert.ok(ui.includes("followed = Number(window.turnFloorPlanMoved(c.spaces, c.moved, C)) || 0;"));
  // step 2, the walls: each wall of the card's room is a line with a grip; a wall that cannot be moved is only chosen, and says why
  assert.ok(ui.includes('sides = lit ? D.walls(edit.plan).filter(w=>w.spaceId===String(lit.id)) : [];') && ui.includes('...handlers("wall", w, w.a)'));
  assert.ok(ui.includes('if(kind==="wall" && item.locked){ edit.select(item.id); e.preventDefault(); e.stopPropagation(); return; }'));
  assert.ok(ui.includes("moveWall:(spaceId, edge, xy)=>setEdit(e=>{ if(!e) return e; const r = D.slideWall(e.plan, spaceId, edge, xy);") && ui.includes('"data-testid":"plan-edit-stop"') && ui.includes('"It stops here. "+edit.stop'));
  assert.ok(ui.indexOf("sides.map(w=>{") < ui.indexOf("doors.map(o=>{ const L"), "the walls are drawn under the doors and the things, which take a press first");
  // a wall that moved takes the cameras set by hand and the set's dressing with it, each saved on its own card
  assert.ok(ui.includes("const f = D.follow(C, before, c.spaces, c.ownerId, edit.base, c.moved, c.plan), more = f.patches, cams = f.cameras, pieces = f.pieces;"), "Save gives the plan as it is saved, so the cameras keep their view");
  // (owner 2026-11-26) the 3D set follows the edit before it is saved: the set card draws from the preview, and says so on the picture
  assert.ok(ui.includes("try{ return D.preview(place, basePlan, livePlan, ((window.turnContinuity||{}).locations)||[]); }catch(_){ return null; }") && ui.includes("preview:shown.current,"));
  assert.ok(face.includes("const trial = editing && planEdit.preview ? planEdit.preview : null;") && face.includes('const sig = trial ? "edit|"+space.id+"|"+trial.key : lscSig(space.location);'));
  assert.ok(face.includes("lscDraw(drawn3d, jobs, cast, ()=>!live || latest.current!==heroKey, trial ? { list:trial.list, key:sig } : null)") && face.includes("const built = P.scene(space, from ? from.list : undefined);"));
  assert.ok(face.includes('"data-testid":"set-card-trial"') && face.includes('"Not saved yet"') && face.includes("locationFloorPlanScene(owner, shown, trial ? trial.list : undefined)"));
  // after a save each camera's view is looked at again: one that lost its clear view is named, with a free button that places it again
  assert.ok(ui.includes("const keys = PANELS.filter(k=>now && now[k] && !(was && was[k]));") && ui.includes('"data-testid":"plan-edit-cameras"') && ui.includes('"data-testid":"plan-edit-fix-cameras"'));
  assert.ok(ui.includes("const proposal = await R.proposeCamerasAuto(now, list, { keep:PANELS.filter(k=>b.keys.indexOf(k)<0) });") && ui.includes('onUpdate(b.id, { coverageViews:R.cameraProposalViews(still, proposal, latest) }, { kind:"suggested-cameras" });'));
  assert.ok(ui.includes('Object.keys(more).forEach(id=>{ if(id!==String(c.ownerId)) onUpdate(id, more[id], { kind:"floor-plan-edit" }); });'));
  // while a wall is dragged the picture keeps its scale
  assert.ok(ui.includes("begin:hold=>setEdit(e=>e ? { ...e, hold:!!hold,") && face.includes("holding ? planHold.current : null") && read("app/location-set-card.js").includes("function planModel(plan,space,cameraKey,people,width,shotCams,tight,hold){"));
  assert.ok(css.includes(".lsc-edit-wall-hit{") && css.includes(".lsc-edit-wall.locked"));
  for (const id of ["plan-edit-start", "plan-edit-undo", "plan-edit-cancel", "plan-edit-save", "plan-edit-layer", "loc-where"]) assert.ok(ui.includes('"data-testid":"' + id + '"'), id);
  assert.ok(ui.includes('"Move things and walls"') && ui.includes("Nothing is saved until you press Save."));
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
  assert.ok(app.includes("window.turnFloorPlanMoved = (locationIds, moves, carry)=>{") && app.includes("const r = D.sceneMoves((project && project.scenePlans) || {}, locationIds, moves, carry,"));
  assert.ok(css.includes(".lsc-edit-shape{") && css.includes(".loc-where-list{"));
  // loaded before the card that uses them, under this change's key
  assert.ok(html.indexOf("app/floor-plan-drag.js?v=") > 0 && html.indexOf("app/floor-plan-drag.js?v=") < html.indexOf("app/floor-plan-drag-ui.jsx?v=") && html.indexOf("app/floor-plan-drag-ui.jsx?v=") < html.indexOf("app/location-set-card-ui.jsx?v="));
  for (const f of ["app/floor-plan-drag.js", "app/floor-plan-drag-ui.jsx", "app/location-set-card.js", "app/location-set-card-ui.jsx", "app/locations-ui.jsx", "app/app.jsx", "app/styles.css", "app/ai.jsx", "app/script.jsx"])
    assert.ok(["20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1", "20261126-look2", "20261126-board1", "20261126-frames1", "20261126-frames2", "20261126-start1", "20261126-film1", "20261126-film2", "20261127-steps1", "20261127-moments1", "20261127-beats1", "20261127-rooms1", "20261127-pager1", "20261127-title1", "20261127-web1", "20261127-web2", "20261127-admin1", "20261127-place1", "20261127-note1"].some(k => html.includes(f + "?v=" + k + '"')), f + " has this change's key");
  assert.ok(/MOVE THINGS AND WALLS ON THE PLAN \(2026-11-25\)/.test(ai) && /Where things stand/.test(ai));
  assert.ok(!/Hussain|Pike|Liaqat/.test(ai.slice(ai.indexOf("MOVE THINGS AND WALLS ON THE PLAN"), ai.indexOf("MOVE THINGS AND WALLS ON THE PLAN") + 3000)), "no name of a film in what the assistant is told");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

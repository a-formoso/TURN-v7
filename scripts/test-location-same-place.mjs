#!/usr/bin/env node
/* test-location-same-place.mjs — SAME PLACE, TWO NAMES (owner-approved 2026-10-14, "go ahead with all of it" — fix A
   of the Fondamenta plan; Story Pipeline "Locations"). Glass Hours scene 13's card says "EXT. FONDAMENTA · NIGHT", its
   own screenplay heading "EXT. FONDAMENTA DEI VETRAI — NIGHT": the derivation made a parent card "Fondamenta" and a
   room "Fondamenta DEI Vetrai" of one quay. Now:
   - DETECTION, suggest only: a scene card that disagrees with its draft's first heading, together with the name fold
     and shared scenes — never the fold and the scenes alone (an ordinary HOUSE with a HOUSE - KITCHEN);
   - MERGE, one confirmed action: one card (the one with the layout and plate, named as the screenplay's headings name
     it), the layout / plate / view composition untouched, the other card to Recently deleted, scene 13's card corrected
     (with the screenplay's card snapshot), units and shots resolving to the merged card, the decision stored on the
     card (aliasKeys) so the merged-away name never comes back — Show-wide;
   - "Part of" (partOfKeys) and "Keep separate" (notAliasOf), stored and read by the derivation;
   - "Same place as…" for a pair nothing points at (Fiorin Furnace + Furnace), the confirm offering either name;
   - role gating (owner / Art director), old films untouched until the owner acts, the sample film's source corrected,
     Italian particles and NIGHTS.
   Fixture: the app's own sample film (scripts/fixtures/glass-hours-locations.json — a stored copy of a film made before
   this change, read-only). Nothing is generated, nothing is charged.
   node scripts/test-location-same-place.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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
  useEffect: noop, useMemo: (fn) => fn(), useCallback: (fn) => fn,
};
const metas = {}, images = {};
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, CustomEvent: class {}, nbEpoch: () => 1,
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal",
  appToast: noop, nbCostChip: () => null,
  nbGetMeta: (id) => metas[id] || null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "" };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box);
vm.runInContext(read("app/locations-ui.jsx"), box);
vm.runInContext(read("app/series.js"), box);
// shots' scene → location resolution, as shots.jsx has it
const shotsSrc = read("app/shots.jsx");
vm.runInContext(shotsSrc.slice(shotsSrc.indexOf("function locationForScene("), shotsSrc.indexOf("window.locationForScene = locationForScene;")), box);
const json = (x) => JSON.parse(JSON.stringify(x));
const clone = () => json(film.locations);
const byId = (list, id) => list.find((l) => l.id === id);
const NONE = () => box.locationPlaceDecisions([], []);
const P = "loc-fondamenta-3", C = "loc-fondamenta-dei-vetrai-4", FUR = "loc-furnace-1", FIO = "loc-fiorin-furnace-0", OFF = "loc-furnace-office-2";
const shape = (list) => json(list).map((l) => [l.key, l.parentKey, l.scope, l.scenes.join(",")].join(" | "));

/* ---- 1. names read better: Italian particles, NIGHTS ---- */
assert.equal(box.tidyPlace("FONDAMENTA DEI VETRAI"), "Fondamenta dei Vetrai");
assert.equal(box.tidyPlace("PALAZZO DELLA RAGIONE"), "Palazzo della Ragione");
assert.equal(box.tidyPlace("CASA DI GIULIETTA"), "Casa di Giulietta");
assert.equal(box.tidyPlace("FBI HQ"), "FBI HQ", "a short acronym stays");
assert.equal(box.tidyPlace("DEI GLASSWORKS"), "Dei Glassworks", "a first word is capitalised");
assert.deepEqual(json(box.parseSlugline("INT. FURNACE · NIGHTS")), { intExt: "INT", place: "FURNACE", time: "NIGHTS" });
assert.equal(box.normalizeTOD("Nights"), "Night");

/* ---- 2. an old film is untouched until the owner acts (only the derived area names read better) ---- */
for (const l of film.locations) for (const f of ["aliasKeys", "aliases", "notAliasOf", "partOfKeys", "mergedFrom"]) assert.ok(!(f in l), l.id + " has no " + f);
assert.equal(box.locationPlaceDecisions(film.locations, []).sig, "", "no decisions on a film made before this");
box.setLocationPlaceDecisions(box.locationPlaceDecisions(film.locations, []));
const fresh0 = json(box.deriveLocations(film.scenes, [], film.drafts));
assert.deepEqual(shape(fresh0), [
  "fiorin-furnace |  | atomic | gh-s01",
  "furnace |  | compound | gh-s02,gh-s04,gh-s06,gh-s07,gh-s08,gh-s09,gh-s10,gh-s12,gh-s15,gh-s16",
  "furnace-office | furnace | atomic | gh-s02",
  "fondamenta |  | compound | gh-s03,gh-s13",
  "fondamenta-dei-vetrai | fondamenta | atomic | gh-s03,gh-s13",
  "hotel-bar |  | atomic | gh-s05",
  "hotel-staff-corridor |  | atomic | gh-s11",
  "hotel-staff-entrance |  | atomic | gh-s14"], "the same places and hierarchy as the stored cards");
for (const l of fresh0) { const stored = film.locations.find((x) => x.key === l.key); assert.equal(l.parentKey, stored.parentKey, l.key); assert.equal(l.scope, stored.scope, l.key); }
assert.deepEqual(fresh0.find((l) => l.key === "furnace").areas, ["Furnace Office"], "the fake 'Nights' area is gone (stored: Furnace Office, Nights)");
assert.deepEqual(byId(film.locations, FUR).areas, ["Furnace Office", "Nights"]);
assert.deepEqual(fresh0.find((l) => l.key === "fondamenta").areas, ["Fondamenta dei Vetrai"]);
assert.equal(byId(film.locations, C).name, "Fondamenta DEI Vetrai", "a card's saved name is not changed");
const units0 = json(box.deriveSluglineUnits(film.scenes, film.drafts)).filter((u) => /fondamenta/.test(u.key));
assert.deepEqual(units0.map((u) => [u.key, u.name, u.subspaceKey, u.locationKey]), [
  ["fondamenta-dei-vetrai|EXT|Dusk", "Fondamenta dei Vetrai", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai"],
  ["fondamenta-dei-vetrai|EXT|Night", "Fondamenta dei Vetrai", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai"]], "unit keys unchanged");

/* ---- 3. detection on Glass Hours: Fondamenta / Fondamenta DEI Vetrai only ---- */
const sug = json(box.locationSamePlaceSuggestions(film.locations, film.scenes, film.drafts));
assert.equal(sug.length, 1, "one pair: " + sug.map((s) => s.pair).join(" "));
assert.equal(sug[0].pair, "fondamenta|fondamenta-dei-vetrai");
assert.equal(sug[0].text, "These look like one place: scene 13's card says FONDAMENTA, its screenplay says FONDAMENTA DEI VETRAI");
assert.deepEqual([sug[0].cardId, sug[0].headingId, sug[0].childId, sug[0].parentId], [P, C, C, P]);
assert.deepEqual(sug[0].scenes, [{ id: "gh-s13", no: 13, card: "EXT. FONDAMENTA · NIGHT", heading: "EXT. FONDAMENTA DEI VETRAI — NIGHT" }]);
// Furnace / Furnace Office: a real room (no card disagrees with its screenplay); Fiorin Furnace / Furnace: nothing points at it
assert.ok(!sug.some((s) => /furnace/.test(s.pair)));
// several scenes say it in one notice
const s2 = json(box.locationSamePlaceText({ ...sug[0], scenes: [{ no: 13 }, { no: 14 }] }));
assert.equal(s2, "These look like one place: the cards of scenes 13 and 14 say FONDAMENTA, their screenplay says FONDAMENTA DEI VETRAI");

/* ---- 4. never the fold and shared scenes alone: an ordinary HOUSE with a HOUSE - KITCHEN ---- */
const house = (scenes, drafts, cards) => json(box.locationSamePlaceSuggestions(cards || box.deriveLocations(scenes, [], drafts, { placeDecisions: NONE() }), scenes, drafts, { placeDecisions: NONE() }));
const H = (id, no, loc, ...heads) => [{ id, no, loc }, { blocks: heads.map((t) => ({ type: "scene", text: t })).concat([{ type: "action", text: "She waits." }]) }];
const mk = (...rows) => ({ scenes: rows.map((r) => r[0]), drafts: Object.fromEntries(rows.map((r) => [r[0].id, r[1]])) });
let f = mk(H("h1", 1, "INT. HOUSE · DAY", "INT. HOUSE — DAY", "INT. HOUSE - KITCHEN — DAY"));
assert.deepEqual(shape(box.deriveLocations(f.scenes, [], f.drafts, { placeDecisions: NONE() })), ["house |  | compound | h1", "house-kitchen | house | atomic | h1"]);
assert.deepEqual(house(f.scenes, f.drafts), [], "a fold and shared scenes, but the card agrees with its screenplay: not suggested");
f = mk(H("h1", 1, "INT. HOUSE · DAY", "INT. HOUSE — DAY"), H("h2", 2, "INT. HOUSE · NIGHT", "INT. HOUSE - KITCHEN — NIGHT"));
assert.deepEqual(house(f.scenes, f.drafts), [], "the card says HOUSE, but HOUSE has a scene of its own: a place and its room");
f = mk(H("h1", 1, "EXT. HOUSE · NIGHT", "INT. HOUSE KITCHEN — NIGHT"));
assert.deepEqual(house(f.scenes, f.drafts), [], "EXT on the card, INT in the screenplay: another matter");
f = mk(H("h1", 1, "INT. KITCHEN · NIGHT", "INT. BATHROOM — NIGHT"));
assert.deepEqual(house(f.scenes, f.drafts), [], "two unrelated names (a rewritten scene): not one place");
f = mk(H("h1", 1, "INT. HOUSE · NIGHT", "INT. HOUSE - KITCHEN — NIGHT"));
assert.equal(house(f.scenes, f.drafts).length, 1, "the card names only the screenplay's place, shorter: suggested");
f = mk(H("h1", 1, "INT. HOUSE · NIGHT"), [{ id: "h2", no: 2, loc: "INT. HOUSE · DAY" }, { blocks: [{ type: "action", text: "INT. HOUSE - KITCHEN" }] }]);
assert.deepEqual(house(f.scenes, f.drafts), [], "a draft that doesn't open on a heading says nothing");
assert.equal(box.locationDraftFirstHeading({ id: "x" }, { x: { blocks: [{ type: "transition", text: "FADE IN:" }, { type: "scene", text: "INT. A — DAY" }] } }), "INT. A — DAY");
assert.equal(box.locationDraftFirstHeading({ id: "x" }, { x: { blocks: [{ type: "scene", text: "INTERCUT WITH:" }] } }), "");

/* ---- 5. what the merge does — told before it happens ---- */
images[P] = "data:image/png;base64,AA"; images[C] = "data:image/png;base64,BB";
metas[P] = { iso: "2026-10-13T10:00:00Z" };
const live0 = clone();
box.turnContinuity = { locations: live0, scenes: film.scenes, drafts: film.drafts };
const owner0 = byId(live0, P);
metas[P].spatialPlanSig = box.locationSpatialPlanSig(owner0.spatialPlan);
metas[P].locSpecSig = box.locationSpecSig(owner0);
metas[P].plateLayoutSig = box.locationPlateLayoutSig(owner0, { panels: true });
const readyBefore = box.locationSpatialPlanState(owner0, live0);
assert.ok(readyBefore.ready, readyBefore.reason);
const hasPlate = (id) => !!images[id];
const plan = json(box.locationMergePlan(live0, film.scenes, film.drafts, sug[0].cardId, sug[0].headingId, { nameFrom: sug[0].headingId, hasPlate }));
assert.deepEqual([plan.keeperId, plan.goneId, plan.name, plan.key, plan.oldKey], [P, C, "Fondamenta dei Vetrai", "fondamenta-dei-vetrai", "fondamenta"],
  "the card with the shared layout and plate stays, named as the screenplay's headings name it (2 headings vs 0)");
assert.deepEqual(plan.aliasKeys, ["fondamenta"]);
assert.deepEqual(plan.aliases, ["Fondamenta"]);
assert.ok(plan.byHeadings && plan.keeperHasLayout && plan.keeperHasPlate && plan.keeperHasStaging && !plan.goneHasLayout && plan.goneHasPlate);
assert.deepEqual(plan.sceneFixes, [{ sceneId: "gh-s13", no: 13, from: "EXT. FONDAMENTA · NIGHT", to: "EXT. FONDAMENTA DEI VETRAI · NIGHT" }]);
// whichever way round it is asked, the same card stays
assert.equal(box.locationMergePlan(live0, film.scenes, film.drafts, C, P, { hasPlate }).keeperId, P);
assert.equal(box.locationMergePlan(live0, film.scenes, film.drafts, C, P, { hasPlate }).name, "Fondamenta dei Vetrai");
const conf = json(box.locationMergeConfirmText(plan, { canFixScenes: true, show: false, offerOtherName: false }));
assert.equal(conf.title, "Merge “Fondamenta” and “Fondamenta DEI Vetrai” into one place?");
assert.equal(conf.body, "They become one location card. Nothing is generated and nothing is charged.");
assert.deepEqual(conf.items, [
  "“Fondamenta”’s card stays, with its image, the shared layout (with its floor plan) and its view composition as they are, and is named “Fondamenta dei Vetrai” — the name the screenplay’s headings use.",
  "“Fondamenta DEI Vetrai”’s scenes join it (and any description it has that the other card lacks); its card moves to Recently deleted with its own image — nothing is deleted for good (it stays there: the merged card now has its name, so it can’t come back as a card of its own).",
  // (2026-10-14) its image is not lost to Recently deleted: a copy stays on the merged card (test-location-merge-versions)
  "A copy of its image is kept on the merged card too, as an earlier version in its image’s version history (⋯ › Details › Earlier versions, where Restore makes it the current image); “Fondamenta”’s current image stays as it is.",
  "Scene 13’s card slugline is corrected to EXT. FONDAMENTA DEI VETRAI · NIGHT, as its screenplay says."]);
assert.deepEqual(plan.carry, [{ id: C, cardId: C, name: "Fondamenta DEI Vetrai", what: "plate", label: "", hasImage: true }], "the merged-away card's own image is carried");
assert.equal(plan.goneKeyTaken, true, "the merged card takes the room card's key");
assert.equal(conf.note, "Shots that picked “Fondamenta DEI Vetrai”’s image by hand, and props linked to it, now use the merged card.");
assert.equal(conf.confirmLabel, "Merge as “Fondamenta dei Vetrai”");
assert.ok(!("altLabel" in conf), "the suggestion's merge takes the screenplay's name");
const confAD = json(box.locationMergeConfirmText(plan, { canFixScenes: false, show: true }));
// (2026-10-14) said plainly: an Art director's merge leaves the scene card's heading; the place still reads right; the owner's corrects it
assert.equal(confAD.items[3], "Scene 13’s card keeps its heading as it is, EXT. FONDAMENTA · NIGHT: an Art director can’t edit scenes. The merged place still reads correctly — scene 13, its shots and its variant images are read as “Fondamenta dei Vetrai”. (The owner’s merge corrects the heading to EXT. FONDAMENTA DEI VETRAI · NIGHT; after yours, the owner can change it on the scene card.)");
assert.equal(confAD.items[4], "This film is an episode of a Show and its locations are shared: the merge holds in every episode — a scene in another episode that names “Fondamenta” is read as “Fondamenta dei Vetrai” (scene cards in other episodes, and their shots that picked “Fondamenta DEI Vetrai”’s image by hand, are not changed).");
// "Same place as…" on the same pair: the second button keeps the same card under the other name, and says what it skips
const planAlt = json(box.locationMergePlan(live0, film.scenes, film.drafts, C, P, { hasPlate, nameFrom: plan.altNameFromId }));
assert.deepEqual([planAlt.keeperId, planAlt.name, planAlt.key, planAlt.aliasKeys, planAlt.sceneFixes, planAlt.goneKeyTaken],
  [P, "Fondamenta", "fondamenta", ["fondamenta-dei-vetrai"], [], false]);
const confAlt = json(box.locationMergeConfirmText(plan, { canFixScenes: true, offerOtherName: true, altPlan: planAlt }));
assert.equal(confAlt.altLabel, "Merge as “Fondamenta”");
assert.equal(confAlt.items[confAlt.items.length - 1], "Or merge as “Fondamenta”: the same card stays, under that name, and the scene cards are left as they are.");
assert.ok(!json(box.locationMergeConfirmText(plan, { canFixScenes: true, offerOtherName: false, altPlan: planAlt })).items.some((t) => /^Or merge as/.test(t)), "the suggestion's merge has one name");

/* ---- 6. the merge: one card, the layout, plate and view composition untouched ---- */
const shotsIn = [{ id: "sh1", sceneId: "gh-s13", referenceLocationsSet: true, referenceLocationIds: [C, "locunit-x"], refOff: [C] }, { id: "sh2", sceneId: "gh-s03" },
  { id: "sh3", sceneId: "gh-s03", locationId: C }];
const res = json(box.locationMergeApply(live0, plan, { at: "2026-10-14T12:00:00Z" }));
const live1 = res.locations, keeper = byId(live1, P);
assert.equal(live1.length, 7);
assert.ok(!byId(live1, C), "the other card is off the board");
assert.deepEqual([res.gone.id, res.gone._trashReason, res.gone.mergedInto, res.gone.mergedIntoName], [C, "merge", P, "Fondamenta dei Vetrai"]);
assert.deepEqual([keeper.key, keeper.name, keeper.aliasKeys, keeper.aliases], ["fondamenta-dei-vetrai", "Fondamenta dei Vetrai", ["fondamenta"], ["Fondamenta"]]);
assert.deepEqual(keeper.mergedFrom, [{ id: C, key: "fondamenta-dei-vetrai", name: "Fondamenta DEI Vetrai", at: "2026-10-14T12:00:00Z" }]);
assert.deepEqual(keeper.spatialPlan, owner0.spatialPlan, "the shared layout, its 13 anchors and its floor plan (both spaces) are exactly as they were");
assert.equal(keeper.spatialPlan.anchors.filter((a) => a.space === "Fondamenta DEI Vetrai").length, 10);
assert.deepEqual(keeper.spatialPlan.coordinates.spaces.map((s) => s.id), [P, C]);
assert.deepEqual(keeper.staging, owner0.staging);
for (const k of ["architecture", "materials", "lighting", "significance"]) assert.equal(keeper[k], owner0[k], k + " kept");
assert.deepEqual(keeper.scenes, ["gh-s03", "gh-s13"]);
box.turnContinuity = { locations: live1, scenes: film.scenes, drafts: film.drafts };
const dec1 = box.locationPlaceDecisions(live1, [res.gone]);
box.setLocationPlaceDecisions(dec1);
assert.deepEqual(json(dec1.alias), { fondamenta: "fondamenta-dei-vetrai" });
const readyAfter = box.locationSpatialPlanState(keeper, live1);
assert.ok(readyAfter.ready && !readyAfter.stale, "the reviewed layout stays reviewed: " + readyAfter.reason);
assert.equal(box.locationPlateLayoutSig(keeper, { panels: true }), metas[P].plateLayoutSig, "the plate's layout record still matches");
assert.equal(box.locationPlateLayoutChanged(metas[P], keeper, { panels: true }), false, "no 'Layout changed — regenerate'");
assert.equal(box.locationSpecChanged(metas[P], keeper), false, "renamed by the merge, not 'Description changed'");
assert.equal(box.locationSpecChanged(metas[P], { ...keeper, materials: "Brick" }), true, "a real description change still says so");
assert.equal(box.locationSpaceAnchors(keeper, live1).length, 13, "every object of the layout sits in the merged place");
assert.equal(box.locationSpatialOwner(keeper, live1).id, P);
// shots that picked the other card's plate by hand use the merged card
const shots1 = json(box.locationMergeShots(shotsIn, C, P));
assert.deepEqual(shots1[0].referenceLocationIds, [P, "locunit-x"]);
assert.deepEqual(shots1[0].refOff, [P]);
assert.deepEqual(shots1[1], shotsIn[1]);
assert.equal(shots1[2].locationId, P, "an older shot's own location id follows too");
// props linked to the merged-away card follow it: a fixture's location, its placement, its association, its story events
const propsIn = [
  { id: "pr1", name: "Sacks of sand", kind: "dressing", locationId: C },
  { id: "pr2", name: "Cullet skip", placementLocationId: C, associationType: "location", associationId: C,
    continuityEvents: [{ id: "e1", sceneId: "gh-s13", locationId: C }, { id: "e2", sceneId: "gh-s03", locationId: FUR }] },
  { id: "pr3", name: "Blowpipe", ownerId: "ch-1", locationId: "" }];
const props1 = json(box.locationMergeProps(propsIn, C, P));
assert.equal(props1[0].locationId, P);
assert.deepEqual([props1[1].placementLocationId, props1[1].associationId, props1[1].continuityEvents.map((e) => e.locationId)], [P, P, [P, FUR]]);
assert.equal(box.locationMergeProps(propsIn, C, P)[2], propsIn[2], "a prop that doesn't name it is the same object");
assert.equal(box.locationMergeProps(propsIn, C, C), propsIn);
// scene 13's card is corrected, with its screenplay's card snapshot (no "needs redraft")
const drafts0 = json(film.drafts); drafts0["gh-s13"].cardSnap = { loc: "EXT. FONDAMENTA · NIGHT", title: "The Canal" };
const fixedS = json(box.locationMergeScenes(film.scenes, drafts0, plan));
assert.equal(fixedS.scenes.find((s) => s.id === "gh-s13").loc, "EXT. FONDAMENTA DEI VETRAI · NIGHT");
assert.equal(fixedS.drafts["gh-s13"].cardSnap.loc, "EXT. FONDAMENTA DEI VETRAI · NIGHT");
assert.equal(fixedS.scenes.filter((s, i) => s !== film.scenes[i] && JSON.stringify(s) !== JSON.stringify(film.scenes[i])).length, 1, "no other scene changes");
assert.equal(fixedS.drafts["gh-s13"].blocks.length, film.drafts["gh-s13"].blocks.length, "the screenplay itself is not touched");

/* ---- 7. after the merge: one card, units and shots resolve, the merged-away name never comes back ---- */
for (const [label, scenes] of [["scene 13 corrected (owner)", fixedS.scenes], ["scene 13 not corrected (Art director)", film.scenes]]) {
  const fresh = json(box.deriveLocations(scenes, [], film.drafts));
  assert.deepEqual(shape(fresh).filter((r) => /fond/.test(r)), ["fondamenta-dei-vetrai |  | atomic | gh-s03,gh-s13"], label);
  assert.deepEqual(json(box.deriveLocations(scenes, [...live1, res.gone], film.drafts)), [], label + ": nothing new to add");
  // the hierarchy sync: every derived key has its card, none is missing (deleted or binned)
  const liveKeys = new Set(live1.map((l) => l.key));
  assert.deepEqual(fresh.filter((x) => !liveKeys.has(x.key)).map((x) => x.key), [], label + ": nothing re-derived");
  // …and after the merged-away card is deleted for good, still nothing (the decision is on the merged card)
  assert.deepEqual(json(box.deriveLocations(scenes, live1, film.drafts)).map((x) => x.key), [], label + ": purged, still not re-derived");
  const units = json(box.deriveSluglineUnits(scenes, film.drafts)).filter((u) => /fondamenta/.test(u.key));
  assert.deepEqual(units.map((u) => [u.key, u.subspaceKey, u.locationKey]), [
    ["fondamenta-dei-vetrai|EXT|Dusk", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai"],
    ["fondamenta-dei-vetrai|EXT|Night", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai"]], label + ": the room & time units (and their plates) belong to the merged card");
  box.turnContinuity = { locations: live1, scenes, drafts: film.drafts, sluglineUnits: units };
  assert.equal(box.locationForScene(live1, "gh-s03").id, P, label + ": a shot of scene 3 finds the merged card");
  assert.equal(box.locationForScene(live1, "gh-s13").id, P, label + ": a shot of scene 13 too");
  assert.deepEqual(json(box.locationSamePlaceSuggestions(live1, scenes, film.drafts)), [], label + ": no suggestion after the merge");
  assert.deepEqual(json(box.deriveSubspaceFold(scenes, film.drafts)), { "furnace-office": "furnace" }, label);
}
// a unit an old overlay keeps under the merged-away name is the merged card's too
const orphan = json(box.reconcileSluglineUnits([], [{ key: "fondamenta|EXT|Night", notes: "old" }]))[0];
assert.deepEqual([orphan.orphan, orphan.subspaceKey, orphan.locationKey], [true, "fondamenta-dei-vetrai", "fondamenta-dei-vetrai"]);
// a shot whose units still name the merged-away key finds the card that lists it
box.turnContinuity = { locations: live1, sluglineUnits: [{ key: "fondamenta|EXT|Night", subspaceKey: "fondamenta", scenes: ["gh-s13"] }] };
assert.equal(box.locationForScene(live1, "gh-s13").id, P);
// restoring the merged-away card: it clashes with the merged card's key (it stays in Recently deleted); a card brought
// back under a name of its own makes it its own place again
const unm = json(box.locationUnmergeRestored(live1, { id: C, key: "fondamenta", name: "Fondamenta", mergedInto: P }));
assert.ok(!("aliasKeys" in byId(unm, P)));
assert.ok(!("aliases" in byId(unm, P)) && !("mergedFrom" in byId(unm, P)), "its other name and merge record go with it");
assert.deepEqual(json(box.locationUnmergeRestored(live1, { id: "loc-x", key: "other", mergedInto: P })), live1);
// a binned survivor still holds its names
assert.deepEqual(json(box.locationPlaceDecisions([], [keeper]).alias), { fondamenta: "fondamenta-dei-vetrai" });
// …but a live card that holds the key as its own wins (it would otherwise freeze)
assert.deepEqual(json(box.locationPlaceDecisions([keeper, { id: "l2", key: "fondamenta", name: "Fondamenta" }], []).alias), {});

/* ---- 8. a part of the old parent stays a part of the merged place (its other names fold too) ---- */
const extra = mk(H("x1", 1, "EXT. FONDAMENTA - LANDING · DAY", "EXT. FONDAMENTA - LANDING — DAY"));
const scenesX = film.scenes.concat(extra.scenes.map((s) => ({ ...s, no: 17 }))), draftsX = { ...film.drafts, ...extra.drafts };
box.setLocationPlaceDecisions(box.locationPlaceDecisions(film.locations, []));
assert.equal(box.deriveLocations(scenesX, [], draftsX).find((l) => l.key === "fondamenta-landing").parentKey, "fondamenta");
box.setLocationPlaceDecisions(dec1);
assert.equal(box.deriveLocations(fixedS.scenes.concat(scenesX.slice(16)), [], draftsX).find((l) => l.key === "fondamenta-landing").parentKey,
  "fondamenta-dei-vetrai", "a part of Fondamenta is a part of Fondamenta dei Vetrai");
// the other cards that named either key now name the merged one (here and in every episode's slice)
const kid = { id: "loc-kid", key: "fondamenta-landing", name: "Fondamenta - Landing", parentKey: "fondamenta", continuityRootKey: "fondamenta",
  episodeLocationMeta: { e1: { parentKey: "fondamenta", continuityRootKey: "fondamenta" }, e2: { parentKey: "fondamenta-dei-vetrai", continuityRootKey: "fondamenta-dei-vetrai" } },
  notAliasOf: ["fondamenta"] };
const resKid = json(box.locationMergeApply(clone().concat([kid]), plan, { at: "T" }));
const kid1 = byId(resKid.locations, "loc-kid");
assert.deepEqual([kid1.parentKey, kid1.continuityRootKey, kid1.episodeLocationMeta.e1.parentKey, kid1.episodeLocationMeta.e2.parentKey, kid1.notAliasOf],
  ["fondamenta-dei-vetrai", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai", ["fondamenta-dei-vetrai"]]);

/* ---- 9. "Keep separate" and "Part of" — stored on the cards, read by the derivation ---- */
box.setLocationPlaceDecisions(box.locationPlaceDecisions([], []));
const sep = json(box.locationPlaceDecisionApply(clone(), sug[0].cardId, sug[0].headingId, "separate"));
assert.deepEqual([byId(sep, P).notAliasOf, byId(sep, C).notAliasOf], [["fondamenta-dei-vetrai"], ["fondamenta"]]);
const decS = box.locationPlaceDecisions(sep, []);
assert.deepEqual(json(decS.separate), { "fondamenta|fondamenta-dei-vetrai": true });
assert.deepEqual(shape(box.deriveLocations(film.scenes, [], film.drafts, { placeDecisions: decS })).filter((r) => /fond/.test(r)),
  ["fondamenta-dei-vetrai |  | atomic | gh-s03,gh-s13", "fondamenta |  | atomic | gh-s13"], "two places, never folded by name");
assert.deepEqual(json(box.locationSamePlaceSuggestions(sep, film.scenes, film.drafts, { placeDecisions: decS })), [], "not asked again");
assert.deepEqual(json(box.deriveSubspaceFold(film.scenes, film.drafts, { placeDecisions: decS })), { "furnace-office": "furnace" });
const part = json(box.locationPlaceDecisionApply(sep, sug[0].childId, sug[0].parentId, "part"));
assert.deepEqual([byId(part, C).partOfKeys, "notAliasOf" in byId(part, C), "notAliasOf" in byId(part, P), "partOfKeys" in byId(part, P)],
  [["fondamenta"], false, false, false], "Part of replaces Keep separate (and leaves no empty field behind)");
const decP = box.locationPlaceDecisions(part, []);
assert.deepEqual(json(decP.partOf), { "fondamenta-dei-vetrai": "fondamenta" });
assert.deepEqual(shape(box.deriveLocations(film.scenes, [], film.drafts, { placeDecisions: decP })).filter((r) => /fond/.test(r)),
  ["fondamenta |  | compound | gh-s03,gh-s13", "fondamenta-dei-vetrai | fondamenta | atomic | gh-s03,gh-s13"], "today's place and part");
assert.deepEqual(json(box.locationSamePlaceSuggestions(part, film.scenes, film.drafts, { placeDecisions: decP })), []);
// a part stays a part when its name no longer says so
const renamed = film.scenes.map((s) => s.id === "gh-s03" ? { ...s, loc: "EXT. VETRAI QUAY · DUSK" } : s);
const draftsR = json(film.drafts); draftsR["gh-s03"].blocks[0].text = "EXT. VETRAI QUAY — DUSK";
const partQ = part.map((l) => l.id === C ? { ...l, key: "vetrai-quay", partOfKeys: ["fondamenta"] } : l);
assert.equal(box.deriveLocations(renamed, [], draftsR, { placeDecisions: box.locationPlaceDecisions(partQ, []) }).find((l) => l.key === "vetrai-quay").parentKey, "fondamenta");
assert.equal(box.deriveLocations(renamed, [], draftsR, { placeDecisions: NONE() }).find((l) => l.key === "vetrai-quay").parentKey, "");
assert.equal(box.locationPlaceDecisionApply(clone(), P, P, "part"), null);
assert.equal(box.locationPlaceDecisionApply(clone(), P, C, "other"), null);

/* ---- 10. "Same place as…": Fiorin Furnace and Furnace (nothing points at them) ---- */
images[FUR] = images[FIO] = "data:image/png;base64,CC";
const planF = json(box.locationMergePlan(clone(), film.scenes, film.drafts, FIO, FUR, { hasPlate }));
assert.deepEqual([planF.keeperId, planF.name, planF.key, planF.aliasKeys, planF.altName, planF.sceneFixes],
  [FUR, "Furnace", "furnace", ["fiorin-furnace"], "Fiorin Furnace", []], "the name of 9 headings, the card with 10 scenes; no card disagrees with its screenplay");
const confF = json(box.locationMergeConfirmText(planF, { canFixScenes: true, offerOtherName: true }));
assert.deepEqual([confF.confirmLabel, confF.altLabel], ["Merge as “Furnace”", "Merge as “Fiorin Furnace”"]);
assert.equal(confF.items[1], "“Fiorin Furnace”’s scenes join it (and any description it has that the other card lacks); its card moves to Recently deleted with its own image and its own shared layout — nothing is deleted for good.");
const resF = json(box.locationMergeApply(clone(), planF, { at: "T" }));
// the other card's layout corrections belong to its own layout (in Recently deleted with it), never to the kept one
const notesIn = clone().map((l) => l.id === FIO ? { ...l, spatialNotes: "Bench by the north wall" } : l.id === FUR ? { ...l, spatialNotes: "Glory hole faces east" } : l);
assert.equal(byId(json(box.locationMergeApply(notesIn, planF, { at: "T" })).locations, FUR).spatialNotes, "Glory hole faces east");
const decF = box.locationPlaceDecisions(resF.locations, [resF.gone]);
const freshF = shape(box.deriveLocations(film.scenes, [], film.drafts, { placeDecisions: decF }));
assert.deepEqual(freshF.slice(0, 2), ["furnace |  | compound | gh-s01,gh-s02,gh-s04,gh-s06,gh-s07,gh-s08,gh-s09,gh-s10,gh-s12,gh-s15,gh-s16",
  "furnace-office | furnace | atomic | gh-s02"], "scene 1 is the Furnace; the office still a room of it");
// the other name picked: the same card stays (layout and 10 scenes), named Fiorin Furnace; the office follows it
const planF2 = json(box.locationMergePlan(clone(), film.scenes, film.drafts, FIO, FUR, { hasPlate, nameFrom: planF.altNameFromId }));
assert.deepEqual([planF2.keeperId, planF2.name, planF2.key, planF2.aliasKeys], [FUR, "Fiorin Furnace", "fiorin-furnace", ["furnace"]]);
const resF2 = json(box.locationMergeApply(clone(), planF2, { at: "T" }));
assert.equal(byId(resF2.locations, OFF).parentKey, "fiorin-furnace");
const decF2 = box.locationPlaceDecisions(resF2.locations, [resF2.gone]);
assert.deepEqual(shape(box.deriveLocations(film.scenes, [], film.drafts, { placeDecisions: decF2 })).slice(0, 2),
  ["fiorin-furnace |  | compound | gh-s01,gh-s02,gh-s04,gh-s06,gh-s07,gh-s08,gh-s09,gh-s10,gh-s12,gh-s15,gh-s16", "furnace-office | fiorin-furnace | atomic | gh-s02"]);
// the layout still says "Furnace" for the hall's objects: they stay in the hall (its other name), never the office
const furKeeper = byId(resF2.locations, FUR);
const hallAnchors = furKeeper.spatialPlan.anchors.filter((a) => a.space === "Furnace");
assert.ok(hallAnchors.length > 0);
const fam = box.locationSpatialFamily(furKeeper, resF2.locations);
for (const a of hallAnchors) assert.equal(box.locationAnchorSpaceOf(a, fam).id, FUR, a.name);
assert.equal(box.locationMergePlan(clone(), film.scenes, film.drafts, FUR, FUR, {}), null);

/* ---- 11. Show-wide: the cards are the Show's, so every episode reads the decision ---- */
const ep2 = mk(H("e2-s1", 1, "EXT. FONDAMENTA · DAY", "EXT. FONDAMENTA — DAY"), H("e2-s2", 2, "INT. FURNACE · NIGHT", "INT. FURNACE — NIGHT"));
box.setLocationPlaceDecisions(box.locationPlaceDecisions(film.locations, []));
assert.deepEqual(shape(box.deriveLocations(ep2.scenes, [], ep2.drafts)), ["fondamenta |  | atomic | e2-s1", "furnace |  | atomic | e2-s2"], "episode 2 before");
box.setLocationPlaceDecisions(dec1);
assert.deepEqual(shape(box.deriveLocations(ep2.scenes, [], ep2.drafts)), ["fondamenta-dei-vetrai |  | atomic | e2-s1", "furnace |  | atomic | e2-s2"],
  "episode 2 after: its FONDAMENTA scenes are the merged card's, no Fondamenta card comes back");
assert.deepEqual(json(box.deriveLocations(ep2.scenes, live1, ep2.drafts)).map((l) => l.key), [], "nothing new for episode 2");
// a Show's per-episode scenes and hierarchy slices are joined, never lost
const showA = clone().map((l) => l.id === P ? { ...l, episodeScenes: { e1: ["gh-s03", "gh-s13"], e2: ["e2-s1"] },
  episodeLocationMeta: { e1: { parentKey: "", continuityRootKey: "fondamenta", scope: "compound" }, e2: { parentKey: "", continuityRootKey: "fondamenta", scope: "atomic" } } }
  : l.id === C ? { ...l, episodeScenes: { e1: ["gh-s03", "gh-s13"], e3: ["e3-s4"] },
  episodeLocationMeta: { e1: { parentKey: "fondamenta", continuityRootKey: "fondamenta" } } } : l);
const resShow = json(box.locationMergeApply(showA, plan, { at: "T",
  mergeSceneRefs: (set, survivor) => box.turnSeries.mergeEntitySceneRefs(set, survivor, "e1") }));
const kS = byId(resShow.locations, P);
assert.deepEqual(kS.episodeScenes, { e1: ["gh-s03", "gh-s13"], e2: ["e2-s1"], e3: ["e3-s4"] });
assert.deepEqual(kS.scenes, ["gh-s03", "gh-s13"]);
assert.deepEqual([kS.continuityRootKey, kS.episodeLocationMeta.e1.continuityRootKey, kS.episodeLocationMeta.e2.continuityRootKey, kS.episodeLocationMeta.e2.parentKey],
  ["fondamenta-dei-vetrai", "fondamenta-dei-vetrai", "fondamenta-dei-vetrai", ""]);

/* ---- 12. the cards: the notice on both, the buttons only for a role that saves the Art Room ---- */
const flat = (n) => !n || typeof n !== "object" ? [] : [n, ...(n.children || []).flatMap(flat)];
const text = (n) => n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(text).join("");
const calls = [];
const onMerge = (...a) => calls.push(["merge", ...a]), onDecide = (...a) => calls.push(["decide", ...a]);
for (const id of [P, C]) {
  const t = box.LocationSamePlaceNotice({ l: byId(film.locations, id), s: sug[0], readOnly: false, onMerge, onDecide });
  assert.match(text(t), /^These look like one place: scene 13's card says FONDAMENTA, its screenplay says FONDAMENTA DEI VETRAI\./);
  const btns = flat(t).filter((n) => n.type === "button").map((n) => text(n));
  assert.deepEqual(btns, ["Merge…", id === C ? "Part of Fondamenta" : "Fondamenta DEI Vetrai is a part of it", "Keep separate"]);
  flat(t).filter((n) => n.type === "button").forEach((n) => n.props.onClick());
}
assert.deepEqual(json(calls.slice(0, 3)), [["merge", P, C, { nameFrom: C, detected: true }], ["decide", C, P, "part"], ["decide", P, C, "separate"]]);
const ro = box.LocationSamePlaceNotice({ l: byId(film.locations, P), s: sug[0], readOnly: true, onMerge, onDecide });
assert.equal(flat(ro).filter((n) => n.type === "button").length, 0, "a role that can't save the Art Room sees no buttons");
assert.match(text(ro), /The owner or an Art director can merge them or keep them apart\./);
calls.length = 0;
const pick = box.LocationSamePlacePicker({ l: byId(film.locations, FIO), choices: [{ id: FUR, name: "Furnace" }], value: FUR, onChange: noop,
  onMerge: () => calls.push("merge"), onCancel: () => calls.push("cancel") });
assert.match(text(pick), /^“Fiorin Furnace” is the same place asChoose a card…Furnace/);
assert.deepEqual(flat(pick).filter((n) => n.type === "button").map((n) => [text(n), !!n.props.disabled]), [["Merge…", false], ["Cancel", false]]);
flat(pick).filter((n) => n.type === "button").forEach((n) => n.props.onClick());
assert.deepEqual(calls, ["merge", "cancel"]);
const pick0 = box.LocationSamePlacePicker({ l: byId(film.locations, FIO), choices: [], value: "", onChange: noop, onMerge: noop, onCancel: noop });
assert.equal(flat(pick0).find((n) => n.type === "button").props.disabled, true, "nothing picked, nothing to merge");

/* ---- 13. the wiring: one confirmed action, gated by role (source) ---- */
const app = read("app/app.jsx"), ui = read("app/locations-ui.jsx"), art = read("app/artroom.jsx");
const fn = (src, start, end) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf(end, i)); };
const merge = fn(app, "const mergeLocations = async (aId, bId, opts)=>{", "const decideLocationPlace");
assert.match(merge, /^const mergeLocations = async \(aId, bId, opts\)=>\{\n    if\(!canMutateSharedFilm\(\)\) return;/, "the owner or an Art director only (the Art Room's save right)");
assert.ok(merge.indexOf("window.appConfirm(locationMergeConfirmText(plan") < merge.indexOf("setLocations("), "it asks before it changes anything");
assert.match(merge, /if\(!canMutateSharedFilm\(\)\) return;   \/\/ the role changed while the confirm was open/);
assert.match(merge, /const canFixScenes = !writersRoomReadOnlyRef\.current;/, "scene cards only for a role that saves the screenplay");
assert.match(merge, /show:!!currentShowId/);
assert.match(merge, /offerOtherName:!opts\.detected/);
assert.match(merge, /nameFrom:ok==="alt" \? plan\.altNameFromId : plan\.nameFromId/);
assert.match(merge, /_trashStamp\(res\.gone\)/);
assert.match(merge, /setShots\(ss=>locationMergeShots\(ss, plan\.goneId, plan\.keeperId\)\)/);
assert.match(merge, /typeof locationMergeShots==="function" && !shotsReadOnlyRef\.current\) setShots/, "shots only for a role that saves them");
assert.match(merge, /setProps\(ps=>locationMergeProps\(ps, plan\.goneId, plan\.keeperId\)\)/, "props linked to it follow");
assert.match(merge, /altPlan = !opts\.detected \? locationMergePlan\(locations, scenes, drafts, aId, bId, \{ nameFrom:plan\.altNameFromId, hasPlate \}\) : null;/);
const decide = fn(app, "const decideLocationPlace = async (aId, bId, kind)=>{", "\n  };");
assert.match(decide, /^const decideLocationPlace = async \(aId, bId, kind\)=>\{\n    if\(!canMutateSharedFilm\(\)\) return;/);
assert.match(decide, /kind==="separate" && typeof window\.appConfirm==="function"/);
assert.match(app, /if\(typeof setLocationPlaceDecisions==="function"\) setLocationPlaceDecisions\(placeDecisions\);/, "set on every render, before the units");
assert.ok(app.indexOf("setLocationPlaceDecisions(placeDecisions)") < app.indexOf("const sluglineUnits = React.useMemo"));
assert.match(app, /\[scenes, drafts, slugUnitsOv, placeDecisionsSig\]\);/);
assert.match(app, /locationPlaceDecisions\(locations, trash && trash\.locations\)/, "the live cards and Recently deleted");
assert.match(app, /onMergeLocations:mergeLocations,onLocationPlaceDecision:decideLocationPlace,/);
assert.match(art, /onMergeLocations,onPlaceDecision:onLocationPlaceDecision,/);
assert.match(ui, /samePlace:samePlace\.filter\(s=>s\.cardId===l\.id\|\|s\.headingId===l\.id\),mergeChoices:mergeChoicesFor\(l\),/, "both cards of a pair");
assert.match(ui, /\.\.\.\(!readOnly && typeof onMergeLocations==="function" && \(mergeChoices\|\|\[\]\)\.length \? \[\{ label:"Same place as\\u2026"/, "the ⋯ menu item, never for a read-only role");
const restore = fn(app, "const restoreLocation = (id)=>{", "const mergeLocations");
assert.match(restore, /was merged into/);
assert.match(restore, /locationUnmergeRestored\(ls, item\)/);
assert.match(app, /if\(item\.key && !item\.mergedInto && !\(locations\|\|\[\]\)\.some\(l=>l && l\.key===item\.key\)/, "no 'comes back as an empty card' for a merged card");

/* ---- 14. the sample film's source: scene 13's card now says what its screenplay says (new copies only) ---- */
const gh = read("docs/samples/Glass Hours.md");
assert.match(gh, /## Scene 13 — The Canal {2}\(Act III\)\n\n- \*\*Slugline:\*\* EXT\. FONDAMENTA DEI VETRAI · NIGHT\n/);
assert.doesNotMatch(read("docs/Sample Films (draft).md"), /EXT\. FONDAMENTA · NIGHT/);
const { buildAll } = await import("./build-sample-films.mjs");
const built = buildAll().find((x) => x.slug === "glass-hours").doc;
assert.equal(built.scenes.find((s) => s.no === 13).loc, "EXT. FONDAMENTA DEI VETRAI · NIGHT");
const builtFresh = box.deriveLocations(built.scenes, [], built.drafts, { placeDecisions: NONE() });
assert.ok(!builtFresh.some((l) => l.key === "fondamenta"), "a new copy has one Fondamenta dei Vetrai and no Fondamenta");
assert.deepEqual(json(box.locationSamePlaceSuggestions(builtFresh, built.scenes, built.drafts, { placeDecisions: NONE() })), [], "nothing to suggest in a new copy");
assert.match(film.scenes.find((s) => s.no === 13).loc, /^EXT\. FONDAMENTA · NIGHT$/, "a stored film keeps its card until the owner merges");
// Third Mainland's scene 5: the card names a state ("DANFO (STOPPED)") its screenplay heading doesn't — suggested, and a
// merge corrects only the place's name on the card, keeping the card's own time and weather (never the heading's tail)
const tm = buildAll().find((x) => x.slug === "third-mainland").doc;
const tmCards = box.deriveLocations(tm.scenes, [], tm.drafts, { placeDecisions: NONE() });
const tmSug = json(box.locationSamePlaceSuggestions(tmCards, tm.scenes, tm.drafts, { placeDecisions: NONE() }));
assert.deepEqual(tmSug.map((x) => x.text), ["These look like one place: scene 5's card says DANFO (STOPPED), its screenplay says DANFO"]);
const tmPlan = json(box.locationMergePlan(tmCards, tm.scenes, tm.drafts, tmSug[0].cardId, tmSug[0].headingId, { nameFrom: tmSug[0].headingId, hasPlate: () => false, placeDecisions: NONE() }));
assert.deepEqual([tmPlan.name, tmPlan.key, tmPlan.aliasKeys, tmPlan.sceneFixes.map((f) => [f.from, f.to])],
  ["Danfo", "danfo", ["danfo-stopped"], [["INT. DANFO (STOPPED) · NIGHT · RAIN", "INT. DANFO · NIGHT · RAIN"]]]);
// the corrected slugline: the place's name in the screenplay's words, the rest of the card as it was
assert.equal(box.locationCorrectedSlugline("EXT. FONDAMENTA · NIGHT", "EXT. FONDAMENTA DEI VETRAI — NIGHT"), "EXT. FONDAMENTA DEI VETRAI · NIGHT");
assert.equal(box.locationCorrectedSlugline("13 EXT. FONDAMENTA - NIGHT", "EXT. FONDAMENTA DEI VETRAI — NIGHT"), "EXT. FONDAMENTA DEI VETRAI - NIGHT", "a scene number goes, the card's separator stays");
assert.equal(box.locationCorrectedSlugline("INT./EXT. HOUSE · DAY", "INT. HOUSE - KITCHEN — DAY"), "INT./EXT. HOUSE - KITCHEN · DAY");
assert.equal(box.locationCorrectedSlugline("FONDAMENTA · NIGHT", "EXT. FONDAMENTA DEI VETRAI — NIGHT"), "EXT. FONDAMENTA DEI VETRAI · NIGHT", "no side on the card: the screenplay's");
assert.equal(box.locationCorrectedSlugline("EXT. QUAY", "EXT. QUAY / BRIDGE — DAY"), "EXT. QUAY", "a compound heading lends its first place only");
assert.equal(box.locationCorrectedSlugline("EXT. QUAY", ""), "");

/* ---- 15. the docs say it ---- */
assert.match(read("docs/Story Pipeline.md"), /\*\*Same place, two names \(approved 2026-10-14 by owner\)\.\*\*/);
assert.match(read("app/ai.jsx"), /SAME PLACE, TWO NAMES: when a scene's card slugline names a place differently/);

/* ---- 16. the real cards: Locations renders the notice on both cards and "Same place as…" in the ⋯ menu ---- */
{
  const walk = (n, fn) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach((x) => walk(x, fn)); return; } fn(n); (n.children || []).forEach((x) => walk(x, fn)); };
  const findAll = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
  const R = { Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (init) => [typeof init === "function" ? init() : init, noop], useReducer: (fn, init) => [init, noop],
    useEffect: noop, useLayoutEffect: noop, useRef: (v) => ({ current: v === undefined ? null : v }), useMemo: (fn) => fn(), useCallback: (fn) => fn };
  const cb = { console, React: R, Icon: new Proxy({}, { get: () => () => null }), localStorage: { getItem: () => null, setItem: noop },
    document: { addEventListener: noop, removeEventListener: noop, querySelector: () => null }, addEventListener: noop, removeEventListener: noop,
    dispatchEvent: () => true, CustomEvent: class {}, nbCostChip: () => null, nbGetImage: () => "", nbLoadImage: async () => "", nbEpoch: () => 1, nbGetMeta: () => null,
    useBatchGen: () => ({ activeId: null, begin: noop, setMsg: noop, advance: noop }), usePager: () => ({ slice: (a) => a }),
    useImageGen: () => ({ genUrl: "", genMeta: null, gening: false, generate: noop, slotHasRef: false }),
    PagerBar: "PagerBar", NbKeyBar: "NbKeyBar", NbControls: "NbControls", BatchBar: "BatchBar", ImageLightbox: "ImageLightbox", InfoTip: "InfoTip",
    RecentlyDeleted: "RecentlyDeleted", RenderStylePicker: "RenderStylePicker", EditText: "EditText", SheetField: "SheetField", SheetFrame: "SheetFrame",
    CardFold: "CardFold", CardGroup: "CardGroup" /* The set in 3D and Advanced are groups of parts (2026-11-21) */, CopyBox: "CopyBox", SceneChipPager: "SceneChipPager", renderStyleText: () => "Photoreal",
    scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), searchWordMatch: (t, q) => !q || String(t).toLowerCase().includes(q) };
  cb.window = cb; vm.createContext(cb);
  vm.runInContext(read("app/locations.jsx"), cb); vm.runInContext(read("app/locations-ui.jsx"), cb);
  cb.turnContinuity = { scenes: film.scenes, drafts: film.drafts, locations: film.locations };
  for (const readOnly of [false, true]) {
    const tree = cb.LocationSheets({ project: {}, locations: film.locations, scenes: film.scenes, drafts: film.drafts, onUpdate: noop, onDraft: noop,
      onDraftAll: noop, onDelete: noop, scriptHasLocs: true, trashItems: [], onRestore: noop, onPurge: noop, sluglineUnits: [], readOnly,
      onMergeLocations: noop, onPlaceDecision: noop });
    const cards = {};
    findAll(tree, (n) => n.props && typeof n.props.renderLocation === "function")
      .forEach((w) => w.props.group.members.forEach((m) => { cards[m.id] = w.props.renderLocation(m, {}).props; }));
    assert.equal(Object.keys(cards).length, 8);
    for (const [id, props] of Object.entries(cards)) {
      assert.equal(props.samePlace.length, id === P || id === C ? 1 : 0, id);
      assert.deepEqual(json(props.mergeChoices).map((c) => c.id).sort(), film.locations.map((l) => l.id).filter((x) => x !== id).sort(), id + " can pick any other card");
    }
    for (const id of [P, C]) {
      const card = cb.LocationSheet(cards[id]);
      const notes = findAll(card, (n) => n.type === cb.LocationSamePlaceNotice);
      assert.equal(notes.length, 1, id);
      assert.equal(notes[0].props.s.text, "These look like one place: scene 13's card says FONDAMENTA, its screenplay says FONDAMENTA DEI VETRAI");
      assert.equal(notes[0].props.readOnly, readOnly);
      const menu = findAll(card, (n) => n.type === "SheetFrame")[0].props.menuExtra.map((x) => x.label);
      assert.equal(menu.includes("Same place as\u2026"), !readOnly, "the menu item, " + (readOnly ? "never for a read-only role" : "for a role that saves the Art Room"));
    }
    const other = cb.LocationSheet(cards[FUR]);
    assert.equal(findAll(other, (n) => n.type === cb.LocationSamePlaceNotice).length, 0, "no notice on the Furnace");
  }
}

console.log("PASS location same place: Glass Hours' Fondamenta / Fondamenta DEI Vetrai suggested (never the Furnace's room, Fiorin Furnace only by hand), one confirmed merge keeps the layout and plate, fixes scene 13, holds Show-wide; Part of / Keep separate stored; old films untouched");

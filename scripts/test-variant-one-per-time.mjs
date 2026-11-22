#!/usr/bin/env node
/* test-variant-one-per-time.mjs - ONE VARIANT PER TIME (owner 2026-11-16, "yes, fix that in the app").
   After two cards of one room were merged ("Ellis House - Hallway" kept, "Hallway" merged into it), the card listed
   two Day variants for the same scene: the heading's ("INT. ELLIS HOUSE - HALLWAY - DAY") and the one the line under
   it opened ("A narrow hallway."). Now:
   - a line that names the room the heading already opened, under its other name, never opens a second variant;
   - two headings that write one room of one card two ways, same side and same time, are ONE variant: it keeps the
     key of the name the card has (its image and notes stay where they are), takes the other's scenes, and lists the
     other's key and name (alsoKeys, alsoNames);
   - nothing saved is touched: notes under the other name are read by the one variant (and copied under its own key on
     the first edit), notes under both names stay visible, an image under the other name shows as a kept card;
   - a shot whose line says "Hallway" finds the one variant;
   - a film that still has the second card reads it as before.
   THE ROOT CAUSE (owner 2026-11-16, "yes, fix the root cause too"): the line under a heading describes the place the
   heading names. "A narrow hallway." under "INT. ELLIS HOUSE - HALLWAY - DAY" opens no second room: one card, one
   variant, from the start. A line that brings the scene back to the heading's room (THE HALLWAY.) is that room again.
   While a card under the short name ("Hallway") lists the scene, that scene is read as before: nothing is migrated.
   Nothing is generated, nothing is charged.
   node scripts/test-variant-one-per-time.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const noop = () => {};
const json = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok " + passed + " - " + name); };

const images = {};
let effects = [], states = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (init) => { const i = states.cursor++; if (!(i in states)) states[i] = typeof init === "function" ? init() : init;
    return [states[i], (v) => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; },
  useRef: (init) => ({ current: init }), useMemo: (fn) => fn(), useCallback: (fn) => fn,
  useEffect: (fn) => { effects.push(fn); },
};
const box = { console, React, setTimeout, clearTimeout, localStorage: { getItem: () => null }, Icon: new Proxy({}, { get: () => noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true, CustomEvent: class {}, nbEpoch: () => 1,
  scenesInStoryOrder: (x) => (x || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0)), renderStyleText: () => "Photoreal",
  appToast: noop, nbCostChip: () => null, nbGetMeta: () => null, nbGetImage: (id) => images[id] || "", nbLoadImage: async (id) => images[id] || "" };
box.window = box; vm.createContext(box);
vm.runInContext(read("app/locations.jsx"), box);
vm.runInContext(read("app/locations-ui.jsx"), box);
const shotsSrc = read("app/shots.jsx");
vm.runInContext(shotsSrc.slice(shotsSrc.indexOf("function shotLocationClean("), shotsSrc.indexOf("function shotLocationDraftFor(")), box);
vm.runInContext(shotsSrc.slice(shotsSrc.indexOf("function shotLocationHeadingForIndex("), shotsSrc.indexOf("function shotLocationBeatHeadings(")), box);
vm.runInContext(shotsSrc.slice(shotsSrc.indexOf("function shotLocationParseHeading("), shotsSrc.indexOf("function shotLocationBuildUnitSpec(")), box);

/* the film: scene 24 is the owner's case; scene 30 writes the same room by its short name in a HEADING; scene 31 is
   another time of day; scene 40 is another house's hallway */
const scenes = [
  { id: "s24", no: 24, loc: "INT. ELLIS HOUSE - HALLWAY - DAY" },
  { id: "s30", no: 30, loc: "INT. HALLWAY - DAY" },
  { id: "s31", no: 31, loc: "INT. HALLWAY - NIGHT" },
  { id: "s40", no: 40, loc: "INT. HUSSAIN HOUSE - HALLWAY - DAWN" },
];
const drafts = {
  s24: { blocks: [
    { type: "scene", text: "INT. ELLIS HOUSE - HALLWAY - DAY" },
    { type: "action", text: "A narrow hallway. The iron TICKS as it cools on its board." },
    { type: "action", text: "Amy sets the holdall against the front door." }] },
  s30: { blocks: [
    { type: "scene", text: "INT. HALLWAY - DAY" },
    { type: "action", text: "Tyler waits by the coat hooks." }] },
  s31: { blocks: [
    { type: "scene", text: "INT. HALLWAY - NIGHT" },
    { type: "action", text: "The house is dark." }] },
  s40: { blocks: [
    { type: "scene", text: "INT. HUSSAIN HOUSE - HALLWAY - DAWN" },
    { type: "action", text: "Shoes in a row." }] },
};
const merged = [
  { id: "loc-ellis-house-hallway-28", key: "ellis-house-hallway", name: "Ellis House - Hallway", aliasKeys: ["hallway"], aliases: ["Hallway"], scenes: ["s24", "s30", "s31"] },
  { id: "loc-hussain-house-hallway-30", key: "hussain-house-hallway", name: "Hussain House - Hallway", scenes: ["s40"] },
];
const unmerged = [
  { id: "loc-ellis-house-hallway-28", key: "ellis-house-hallway", name: "Ellis House - Hallway", scenes: ["s24"] },
  { id: "loc-hallway-29", key: "hallway", name: "Hallway", scenes: ["s24", "s30", "s31"] },
  { id: "loc-hussain-house-hallway-30", key: "hussain-house-hallway", name: "Hussain House - Hallway", scenes: ["s40"] },
];
// what the app does on every render: the film's cards and the owner's answers on them
const decide = (cards) => { box.turnNoteSavedLocations(cards); return box.setLocationPlaceDecisions(box.locationPlaceDecisions(cards, [])); };
const row = (u) => [u.key, u.subspaceKey, (u.sceneNos || []).join(",")].join(" > ");

test("a film that still has the card \"Hallway\" reads it as before: the two names are two rooms", () => {
  decide(unmerged);
  const units = json(box.deriveSluglineUnits(scenes, drafts));
  assert.deepEqual(units.map(row), [
    "ellis-house-hallway|INT|Day > ellis-house-hallway > 24",
    "hallway|INT|Day > hallway > 24,30",
    "hallway|INT|Night > hallway > 31",
    "hussain-house-hallway|INT|Dawn > hussain-house-hallway > 40"]);
  for (const u of units) { assert.ok(!("alsoKeys" in u), u.key + " has no alsoKeys"); assert.ok(!("alsoNames" in u), u.key + " has no alsoNames"); }
});

decide(merged);
const units = json(box.deriveSluglineUnits(scenes, drafts));
const day = units.find((u) => u.key === "ellis-house-hallway|INT|Day");

test("after the merge the card has one variant per side and time", () => {
  assert.deepEqual(units.map(row), [
    "ellis-house-hallway|INT|Day > ellis-house-hallway > 24,30",
    "hallway|INT|Night > ellis-house-hallway > 31",
    "hussain-house-hallway|INT|Dawn > hussain-house-hallway > 40"]);
  const perTime = {};
  for (const u of units) { const k = u.subspaceKey + "|" + u.intExt + "|" + u.time; assert.ok(!perTime[k], "one variant for " + k); perTime[k] = true; }
});

test("a line that names a merged-away room under a heading with another name opens nothing either", () => {
  // the card "Ellis House - Entrance" took in a card called "Hallway": the heading does not end with HALLWAY
  const cards = [{ id: "loc-e", key: "ellis-house-entrance", name: "Ellis House - Entrance", aliasKeys: ["hallway"], aliases: ["Hallway"], scenes: ["s24"] }];
  decide(cards);
  const sc = [{ id: "s24", no: 24, loc: "INT. ELLIS HOUSE - ENTRANCE - DAY" }];
  const dr = { s24: { blocks: [{ type: "scene", text: "INT. ELLIS HOUSE - ENTRANCE - DAY" }, { type: "action", text: "A narrow hallway. Coats on hooks." }, { type: "action", text: "Amy waits." }] } };
  const list = json(box.deriveSluglineUnits(sc, dr));
  assert.deepEqual(list.map(row), ["ellis-house-entrance|INT|Day > ellis-house-entrance > 24"]);
  assert.deepEqual(list[0].alsoNames, ["Hallway"], "the room's other name is remembered for the shots");
  assert.deepEqual(list[0].occurrences.map((o) => [o.start, o.end]), [[0, 3]]);
  // a shot whose line says "Hallway" finds that variant
  const heading = box.shotLocationHeadingForIndex(dr.s24.blocks, 2, sc[0].loc, "s24");
  assert.equal(heading, "INT. Hallway - DAY");
  assert.deepEqual(json(box.shotLocationHeadingUnitCandidates(list, box.shotLocationParseHeading(heading), "INT")).map((u) => u.key), ["ellis-house-entrance|INT|Day"]);
  decide(merged);
});

test("the line under the heading never opens a second variant of the room it is already in", () => {
  const s24 = day.occurrences.filter((o) => o.sceneId === "s24");
  assert.equal(s24.length, 1, "scene 24 is one stretch of the screenplay");
  assert.deepEqual([s24[0].start, s24[0].end, s24[0].sourceKind, s24[0].occurrenceOrdinal], [0, 3, "slugline", 1]);
  assert.match(day.scriptText, /iron TICKS/, "the scene's lines belong to the variant");
  assert.match(day.scriptText, /holdall/);
});

test("two headings of one room, one side, one time are one variant: the card's own name is kept", () => {
  assert.equal(day.name, "Ellis House - Hallway");
  assert.deepEqual(day.alsoKeys, ["hallway|INT|Day"], "the other name's key is listed");
  assert.deepEqual(day.alsoNames, ["Hallway"]);
  assert.deepEqual(day.scenes, ["s24", "s30"]);
  assert.deepEqual(day.sluglines, ["INT. ELLIS HOUSE - HALLWAY - DAY", "INT. HALLWAY - DAY"]);
  assert.deepEqual(day.occurrences.map((o) => [o.sceneNo, o.occurrenceOrdinal]), [[24, 1], [30, 1]]);
  assert.match(day.scriptText, /coat hooks/, "scene 30's lines too");
  // the image id is the one the variant always had: an image already made stays where it is
  assert.equal(box.sluglineUnitImageId(day.key), box.sluglineUnitImageId("ellis-house-hallway|INT|Day"));
});

test("a time only the other name has stays as it is (its key, and so its image, unchanged)", () => {
  const night = units.find((u) => u.time === "Night");
  assert.equal(night.key, "hallway|INT|Night");
  assert.equal(night.subspaceKey, "ellis-house-hallway");
  assert.ok(!("alsoKeys" in night));
});

test("the variant stays where the room first appears when the other name was written first", () => {
  const early = [{ id: "s10", no: 10, loc: "INT. HALLWAY - DAY" }].concat(scenes);
  const list = json(box.deriveSluglineUnits(early, drafts));
  assert.deepEqual(list.map(row).slice(0, 2), [
    "ellis-house-hallway|INT|Day > ellis-house-hallway > 10,24,30",
    "hallway|INT|Night > ellis-house-hallway > 31"]);
  assert.deepEqual(list[0].occurrences.map((o) => o.sceneNo), [10, 24, 30], "in story order");
});

test("another house's hallway is never folded in", () => {
  const dawn = units.find((u) => u.key === "hussain-house-hallway|INT|Dawn");
  assert.equal(dawn.subspaceKey, "hussain-house-hallway");
  assert.ok(!("alsoKeys" in dawn) && !("alsoNames" in dawn));
});

test("notes saved under the other name are read by the one variant, and nothing is shown twice", () => {
  const derived = box.deriveSluglineUnits(scenes, drafts);
  const overlays = [{ key: "hallway|INT|Day", appearance: "Low winter sun", notes: "n", setups: [{ id: "hallway|INT|Day@s30#1", sceneId: "s30", blocking: "By the hooks" }] }];
  const list = json(box.reconcileSluglineUnits(derived, overlays));
  const one = list.find((u) => u.key === "ellis-house-hallway|INT|Day");
  assert.equal(one.appearance, "Low winter sun");
  assert.equal(one.overlayKey, "hallway|INT|Day", "it says where they are saved");
  assert.deepEqual(one.setups.map((s) => [s.sceneId, s.blocking, s.orphan]), [["s30", "By the hooks", undefined]], "scene 30's setup follows its scene");
  assert.deepEqual(list.filter((u) => u.orphan).map((u) => u.key), [], "no leftover record");
  assert.equal(json(overlays).length, 1, "the saved record is not changed");
  // a variant with nothing folded has no overlayKey
  assert.ok(!("overlayKey" in list.find((u) => u.time === "Night")));
});

test("the first edit copies those notes under the variant's own key; clearing them does not bring the old ones back", () => {
  const derived = box.deriveSluglineUnits(scenes, drafts);
  const before = [{ key: "hallway|INT|Day", appearance: "Low winter sun", notes: "keep me" }];
  const unit = box.reconcileSluglineUnits(derived, before).find((u) => u.key === "ellis-house-hallway|INT|Day");
  const patch = box.sluglineUnitOverlayPatch(before, unit, { appearance: "Flat grey light" });
  assert.deepEqual(json(patch), { appearance: "Flat grey light", notes: "keep me", adoptedFrom: "hallway|INT|Day" });
  const after = json(box.upsertSluglineUnitOverlay(before, unit.key, patch));
  assert.deepEqual(after.map((o) => o.key), ["hallway|INT|Day", "ellis-house-hallway|INT|Day"], "the old record is still stored");
  assert.deepEqual(json(before), [{ key: "hallway|INT|Day", appearance: "Low winter sun", notes: "keep me" }]);
  const list = json(box.reconcileSluglineUnits(derived, after));
  const one = list.find((u) => u.key === unit.key);
  assert.deepEqual([one.appearance, one.notes, one.overlayKey], ["Flat grey light", "keep me", undefined]);
  assert.deepEqual(list.filter((u) => u.orphan), [], "the copied record is not shown a second time");
  // cleared: the record stays (it remembers where it came from), so the old notes do not return
  let cleared = json(box.upsertSluglineUnitOverlay(after, unit.key, box.sluglineUnitOverlayPatch(after, one, { appearance: "", notes: "" })));
  const again = json(box.reconcileSluglineUnits(derived, cleared)).find((u) => u.key === unit.key);
  assert.deepEqual([again.appearance, again.notes], ["", ""]);
  // a variant that reads its own notes gets the patch as it is
  assert.deepEqual(json(box.sluglineUnitOverlayPatch(after, one, { notes: "x" })), { notes: "x" });
  assert.deepEqual(json(box.sluglineUnitOverlayPatch([], { key: "a|INT|Day" }, { notes: "x" })), { notes: "x" });
});

test("notes under BOTH names: the variant shows its own, the other's stay on the card as a kept record", () => {
  const derived = box.deriveSluglineUnits(scenes, drafts);
  const list = json(box.reconcileSluglineUnits(derived, [
    { key: "ellis-house-hallway|INT|Day", appearance: "Mine" }, { key: "hallway|INT|Day", appearance: "Theirs" }]));
  assert.equal(list.find((u) => u.key === "ellis-house-hallway|INT|Day").appearance, "Mine");
  const kept = list.filter((u) => u.orphan);
  assert.deepEqual(kept.map((u) => [u.key, u.name, u.appearance, u.subspaceKey, u.foldedInto]),
    [["hallway|INT|Day", "Hallway", "Theirs", "ellis-house-hallway", "ellis-house-hallway|INT|Day"]]);
  // a record that simply left the script has no foldedInto
  const left = json(box.reconcileSluglineUnits(derived, [{ key: "garage|INT|Day", notes: "old" }])).find((u) => u.orphan);
  assert.ok(!("foldedInto" in left));
});

await (async () => {
  const run = async (list) => { states = []; states.cursor = 0; effects = [];
    let out = box.useKeptVariantImages(list);
    for (const fn of effects) fn();
    await new Promise((r) => setTimeout(r, 5));
    states.cursor = 0; effects = []; out = box.useKeptVariantImages(list); return out; };
  const derived = box.reconcileSluglineUnits(box.deriveSluglineUnits(scenes, drafts), []).filter((u) => u.subspaceKey === "ellis-house-hallway");
  const none = await run(derived);
  assert.deepEqual(json(none.kept), [], "no image under the other name: nothing extra on the card");
  images[box.sluglineUnitImageId("hallway|INT|Day")] = "https://example.test/old.png";
  const some = await run(derived);
  assert.deepEqual(json(some.kept).map((u) => [u.key, u.name, u.time, u.orphan, u.foldedInto, u.subspaceKey]),
    [["hallway|INT|Day", "Hallway", "Day", true, "ellis-house-hallway|INT|Day", "ellis-house-hallway"]]);
  some.drop("hallway|INT|Day");
  states.cursor = 0; effects = [];
  assert.deepEqual(json(box.useKeptVariantImages(derived).kept), [], "removed by the owner: it leaves the card at once");
  delete images[box.sluglineUnitImageId("hallway|INT|Day")];
  passed++; console.log("ok " + passed + " - an image made under the other name is never hidden: it shows as a kept card");
})();

test("the card: the kept card says why it is there, and the list uses the kept images", () => {
  const ui = read("app/locations-ui.jsx");
  assert.match(ui, /const keptVariantImages = useKeptVariantImages\(ownUnits\);/);
  assert.match(ui, /const units = ownUnits\.concat\(keptVariantImages\.kept\)/);
  assert.match(ui, /onRemoveUnit:removeVariantRecord/);
  assert.match(ui, /"data-testid":u\.foldedInto\?"variant-kept-other-name":undefined/);
  assert.match(ui, /which is now part of the variant above\. Kept so its image and notes aren't lost\./);
  assert.match(ui, /It is now part of another variant of this card\./);
  const app = read("app/app.jsx");
  assert.match(app, /sluglineUnitOverlayPatch\(ov, unit, patch\)/, "the app's one writer starts from the notes the variant reads");
});

test("a shot of scene 24 or of scene 30 finds the one variant", () => {
  const live = units.filter((u) => u.subspaceKey === "ellis-house-hallway");
  // scene 24: the line under the heading keeps the heading's room
  assert.equal(box.shotLocationHeadingForIndex(drafts.s24.blocks, 2, scenes[0].loc, "s24"), "INT. ELLIS HOUSE - HALLWAY - DAY");
  // scene 30 writes the room by its other name
  const heading = box.shotLocationHeadingForIndex(drafts.s30.blocks, 1, scenes[1].loc);
  assert.equal(heading, "INT. HALLWAY - DAY");
  const parsed = box.shotLocationParseHeading(heading);
  assert.deepEqual(json(box.shotLocationHeadingUnitCandidates(live, parsed, "INT")).map((u) => u.key), ["ellis-house-hallway|INT|Day"]);
  // its own heading too, and never another time
  const own = box.shotLocationParseHeading("INT. ELLIS HOUSE - HALLWAY - DAY");
  assert.deepEqual(json(box.shotLocationHeadingUnitCandidates(live, own, "INT")).map((u) => u.key), ["ellis-house-hallway|INT|Day"]);
  // a variant with no other names matches as before
  assert.equal(box.shotLocationUnitMatchesPlace({ name: "Kitchen" }, { place: "FATHER'S HOUSE KITCHEN" }), true);
  assert.equal(box.shotLocationUnitMatchesPlace({ name: "Kitchen" }, { place: "LIVING ROOM" }), false);
});

/* ---- the root cause: the line under a heading describes the place the heading names ---- */
const film2 = {
  scenes: [
    { id: "a1", no: 1, loc: "INT. ELLIS HOUSE - HALLWAY - DAY" },
    { id: "a2", no: 2, loc: "INT. ELLIS HOUSE - NIGHT" },
    { id: "a3", no: 3, loc: "INT. FATHER'S HOUSE UPSTAIRS HALLWAY - NIGHT" },
    { id: "a4", no: 4, loc: "INT. HALLWAY - DAY" }],
  drafts: {
    a1: { blocks: [
      { type: "scene", text: "INT. ELLIS HOUSE - HALLWAY - DAY" },
      { type: "action", text: "A narrow hallway. The iron TICKS as it cools on its board." },
      { type: "action", text: "THE KITCHEN." },
      { type: "action", text: "Amy fills the kettle." },
      { type: "action", text: "THE HALLWAY." },
      { type: "action", text: "Tyler has not moved." }] },
    a2: { blocks: [
      { type: "scene", text: "INT. ELLIS HOUSE - NIGHT" },
      { type: "action", text: "A dark hallway. Nobody is up." }] },
    a3: { blocks: [
      { type: "scene", text: "INT. FATHER'S HOUSE UPSTAIRS HALLWAY - NIGHT" },
      { type: "action", text: "The hallway." },
      { type: "action", text: "A door stands open." }] },
    a4: { blocks: [
      { type: "scene", text: "INT. HALLWAY - DAY" },
      { type: "action", text: "A bare hallway. One bulb." }] },
  },
};
const cardRow = (l) => [l.key, l.parentKey || "", (l.scenes || []).join(",")].join(" > ");

test("the rule itself: only the room the heading ends with", () => {
  const H = box.screenplayHeadingNamesRoom;
  assert.equal(H("INT. ELLIS HOUSE - HALLWAY - DAY", "Hallway"), true);
  assert.equal(H("24 INT. ELLIS HOUSE - HALLWAY - DAY", "Hallway"), true, "a numbered heading");
  assert.equal(H("INT. FATHER'S HOUSE UPSTAIRS HALLWAY - NIGHT", "Hallway"), true, "no separator before the room");
  assert.equal(H("INT. ELLIS HOUSE - LIVING ROOM - DAY", "Living Room"), true);
  assert.equal(H("INT. ELLIS HOUSE - HALLWAY - DAY", "Kitchen"), false, "another room is another room");
  assert.equal(H("INT. ELLIS HOUSE - DAY", "Hallway"), false, "the heading names the house, not the room");
  assert.equal(H("INT. HALLWAY - DAY", "Hallway"), false, "the heading IS the room: nothing to decide");
  assert.equal(H("INT. ELLIS HOUSE - BEDROOM - DAY", "Room"), false);
  assert.equal(H("INT. THE DEN OF THIEVES - NIGHT", "Den"), false, "the room's name inside another name is not its end");
  assert.equal(H("", "Hallway"), false);
});

test("a new film: one card and one variant for the room the heading names, from the start", () => {
  decide([]);
  const cards = json(box.deriveLocations(film2.scenes, [], film2.drafts));
  assert.deepEqual(cards.map(cardRow), [
    "ellis-house >  > a1,a2,a4",
    "ellis-house-hallway > ellis-house > a1",
    "kitchen > ellis-house > a1",
    "hallway > ellis-house > a2,a4",
    "father-s-house-upstairs >  > a3"], "the card called Hallway holds scenes 2 and 4 only: never scene 1 or 3");
  const list = json(box.deriveSluglineUnits(film2.scenes, film2.drafts));
  assert.deepEqual(list.map((u) => [u.key, (u.sceneNos || []).join(",")].join(" > ")), [
    "ellis-house-hallway|INT|Day > 1",
    "kitchen|INT|Day > 1",
    "ellis-house|INT|Night > 2",
    "hallway|INT|Night > 2",
    "father-s-house-upstairs-hallway|INT|Night > 3",
    "hallway|INT|Day > 4"]);
  const hall = list[0];
  // the scene opens in the hallway, goes to the kitchen, and a line brings it BACK to the heading's room
  assert.deepEqual(hall.occurrences.map((o) => [o.start, o.end, o.sourceKind, o.occurrenceOrdinal]),
    [[0, 2, "slugline", 1], [4, 6, "derived-inline-room-cue", 2]]);
  assert.match(hall.scriptText, /iron TICKS/); assert.match(hall.scriptText, /Tyler has not moved/);
  assert.deepEqual(list[1].occurrences.map((o) => [o.start, o.end]), [[2, 4]], "the kitchen keeps its own lines");
  // scene 2's heading names the HOUSE: the line under it still opens the hallway, as before
  assert.deepEqual(list[3].occurrences.map((o) => o.sourceKind), ["derived-establishing-action"]);
  // scene 3: the bare room marker under a heading that ends with the room
  assert.deepEqual(list[4].occurrences.map((o) => [o.start, o.end]), [[0, 3]]);
});

test("a shot follows the same reading", () => {
  decide([]);
  const b = film2.drafts.a1.blocks, at = (i) => box.shotLocationHeadingForIndex(b, i, film2.scenes[0].loc, "a1");
  assert.deepEqual([at(1), at(3), at(5)], ["INT. ELLIS HOUSE - HALLWAY - DAY", "INT. Kitchen - DAY", "INT. ELLIS HOUSE - HALLWAY - DAY"]);
  assert.equal(box.shotLocationHeadingForIndex(film2.drafts.a2.blocks, 1, film2.scenes[1].loc), "INT. Hallway - NIGHT", "under the house's own heading the hallway is a room");
});

test("a card called Hallway that never held the scene changes nothing: the new film stays as it is", () => {
  decide([]);
  const first = json(box.deriveLocations(film2.scenes, [], film2.drafts));
  const before = json(box.deriveSluglineUnits(film2.scenes, film2.drafts)).map((u) => [u.key, u.sceneNos]);
  // the app saves the derived cards (a real "Hallway" among them, from scenes 2 and 4) and derives again
  decide(first);
  assert.deepEqual(json(box.deriveLocations(film2.scenes, [], film2.drafts)).map(cardRow), first.map(cardRow));
  assert.deepEqual(json(box.deriveSluglineUnits(film2.scenes, film2.drafts)).map((u) => [u.key, u.sceneNos]), before);
  assert.equal(box.shotLocationHeadingForIndex(film2.drafts.a1.blocks, 1, film2.scenes[0].loc, "a1"), "INT. ELLIS HOUSE - HALLWAY - DAY");
});

test("a scene that a card under the short name already holds keeps the old reading, worked on or not", () => {
  // an older film: the old reading put scenes 1 and 3 on the card "Hallway"
  const old = [{ id: "loc-h", key: "hallway", name: "Hallway", scenes: ["a1", "a2", "a3", "a4"] }];
  assert.equal(box.locationCardHasWork(old[0]), false, "an untouched card counts too");
  decide(old);
  const list = json(box.deriveSluglineUnits(film2.scenes, film2.drafts));
  assert.deepEqual(list.map((u) => [u.key, (u.sceneNos || []).join(",")].join(" > ")), [
    "ellis-house-hallway|INT|Day > 1",
    "hallway|INT|Day > 1,4",
    "kitchen|INT|Day > 1",
    "ellis-house|INT|Night > 2",
    "hallway|INT|Night > 2,3",
    "father-s-house-upstairs-hallway|INT|Night > 3"], "exactly what this film derived before");
  assert.equal(box.shotLocationHeadingForIndex(film2.drafts.a1.blocks, 1, film2.scenes[0].loc, "a1"), "INT. Hallway - DAY");
  const cards = json(box.deriveLocations(film2.scenes, [], film2.drafts));
  assert.deepEqual(cards.find((l) => l.key === "hallway").scenes, ["a1", "a2", "a3", "a4"], "the card keeps its scenes");
  // a scene written LATER in that film, which the card never held, is read by the convention
  const more = film2.scenes.concat([{ id: "a5", no: 5, loc: "INT. HUSSAIN HOUSE - HALLWAY - DAWN" }]);
  const moreDrafts = { ...film2.drafts, a5: { blocks: [{ type: "scene", text: "INT. HUSSAIN HOUSE - HALLWAY - DAWN" }, { type: "action", text: "A narrow hallway. Shoes in a row." }] } };
  const later = json(box.deriveSluglineUnits(more, moreDrafts));
  assert.deepEqual(later.filter((u) => (u.scenes || []).includes("a5")).map((u) => u.key), ["hussain-house-hallway|INT|Dawn"]);
  // the card deleted (it is in Recently deleted, no longer among the film's cards): the heading's room takes the scene
  decide([]);
  assert.ok(!json(box.deriveLocations(film2.scenes, [], film2.drafts)).find((l) => l.key === "hallway").scenes.includes("a1"));
  decide(merged);
});

test("Frances knows, and the pages load the new files", () => {
  const ai = read("app/ai.jsx");
  assert.match(ai, /ONE VARIANT PER TIME \(2026-11-16\)/);
  assert.match(ai, /THE ROOM THE HEADING NAMES \(2026-11-16\)/);
  const html = read("TURN.html");
  for (const f of ["locations.jsx", "locations-ui.jsx", "shots.jsx", "app.jsx", "ai.jsx"])
    assert.ok(["20261116-onetime1", "20261116-headroom1", "20261117-oneroad1", "20261117-innerwall1", "20261117-innerwall2", "20261117-likeness1", "20261117-likeness2", "20261117-qalook1", "20261117-tips1", "20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2"].some((k) => html.includes(f + "?v=" + k + '"')), f + " has the new key");
});

console.log("\n" + passed + " tests passed");

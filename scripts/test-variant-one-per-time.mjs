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
   - without a merge nothing changes.
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
const decide = (cards) => box.setLocationPlaceDecisions(box.locationPlaceDecisions(cards, []));
const row = (u) => [u.key, u.subspaceKey, (u.sceneNos || []).join(",")].join(" > ");

test("without a merge nothing changes: the two names are two rooms, as before", () => {
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

test("a shot whose line says the other name finds the one variant", () => {
  const blocks = drafts.s24.blocks;
  const heading = box.shotLocationHeadingForIndex(blocks, 2, scenes[0].loc);
  assert.equal(heading, "INT. Hallway - DAY", "the shot's line is read as before");
  const parsed = box.shotLocationParseHeading(heading);
  const live = units.filter((u) => u.subspaceKey === "ellis-house-hallway");
  assert.deepEqual(json(box.shotLocationHeadingUnitCandidates(live, parsed, "INT")).map((u) => u.key), ["ellis-house-hallway|INT|Day"]);
  // its own heading too, and never another time
  const own = box.shotLocationParseHeading("INT. ELLIS HOUSE - HALLWAY - DAY");
  assert.deepEqual(json(box.shotLocationHeadingUnitCandidates(live, own, "INT")).map((u) => u.key), ["ellis-house-hallway|INT|Day"]);
  // a variant with no other names matches as before
  assert.equal(box.shotLocationUnitMatchesPlace({ name: "Kitchen" }, { place: "FATHER'S HOUSE KITCHEN" }), true);
  assert.equal(box.shotLocationUnitMatchesPlace({ name: "Kitchen" }, { place: "LIVING ROOM" }), false);
});

test("Frances knows, and the pages load the new files", () => {
  const ai = read("app/ai.jsx");
  assert.match(ai, /ONE VARIANT PER TIME \(2026-11-16\)/);
  const html = read("TURN.html");
  for (const f of ["locations.jsx", "locations-ui.jsx", "shots.jsx", "app.jsx", "ai.jsx"])
    assert.ok(["20261116-onetime1"].some((k) => html.includes(f + "?v=" + k + '"')), f + " has the new key");
});

console.log("\n" + passed + " tests passed");

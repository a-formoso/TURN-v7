import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const plain = value => JSON.parse(JSON.stringify(value));
const appSource = fs.readFileSync("app/app.jsx", "utf8");
const mergeSource = fs.readFileSync("app/beat-keyframe-merge.js", "utf8");

/*
 * The cleanup helper is deliberately tested in its own small VM.  This keeps
 * the assertions about provenance independent from the App handler harness.
 */
const helperContext = { console };
helperContext.window = helperContext;
vm.createContext(helperContext);
vm.runInContext(mergeSource, helperContext);
const cleanupHelper = helperContext.legacyMicroBeatShotCleanup;
assert.equal(typeof cleanupHelper, "function", "the landed cleanup helper is exposed");

const validLegacy = (id, n = 1, extra = {}) => ({
  id,
  sceneId: "s1",
  beatN: n,
  order: n,
  action: "A legacy micro beat",
  beatPlan: { micro: ["The first action", "The second action"] },
  covers: [1],
  ...extra
});

{
  const records = [
    validLegacy("legacy-primary", 1),
    validLegacy("legacy-extra", 2, { covers: [2], order: 2 }),
    validLegacy("modern-opening", 3, { keyframeMode: "beat-opening" }),
    validLegacy("manual-alternative", 4, { manual: true }),
    validLegacy("shot-s1-mAbC123", 5),
    { ...validLegacy("covers-only"), beatPlan: undefined },
    { ...validLegacy("plan-only"), covers: undefined },
    { ...validLegacy("empty-covers"), covers: [] },
    { ...validLegacy("zero-cover"), covers: [0] },
    { ...validLegacy("fractional-cover"), covers: [1.5] },
    { ...validLegacy("out-of-range-cover"), covers: [3] },
    { ...validLegacy("text-cover"), covers: ["not-an-integer"] },
    { ...validLegacy("empty-plan"), beatPlan: { micro: ["first", " "] } },
    { ...validLegacy("non-string-plan"), beatPlan: { micro: ["first", 2] } },
    { ...validLegacy("empty-plan-array"), beatPlan: { micro: [] }, covers: [1] },
    { ...validLegacy("no-id"), id: undefined },
    { ...validLegacy("", 6) },
    validLegacy("duplicate-id", 7),
    validLegacy("duplicate-id", 8, { covers: [2] }),
    { ...validLegacy("shared-id", 9), keyframeMode: "beat-opening" },
    validLegacy("shared-id", 10)
  ];
  const before = plain(records);
  const result = cleanupHelper(records);

  assert.deepEqual(
    plain(result.removable).map(sh => sh.id),
    ["legacy-primary", "legacy-extra"],
    "the first legacy primary and later legacy alternatives are removable"
  );
  assert.deepEqual(
    plain(result.uncertain).map(sh => sh.id),
    [
      "covers-only",
      "plan-only",
      "empty-covers",
      "zero-cover",
      "fractional-cover",
      "out-of-range-cover",
      "text-cover",
      "empty-plan",
      "non-string-plan",
      "empty-plan-array",
      undefined,
      "",
      "duplicate-id",
      "duplicate-id",
      "shared-id"
    ],
    "isolated evidence, malformed mappings, missing IDs, and duplicate IDs fail closed"
  );
  for (const protectedId of ["modern-opening", "manual-alternative", "shot-s1-mAbC123"]) {
    assert.equal(
      result.removable.some(sh => sh.id === protectedId),
      false,
      protectedId + " is not removable"
    );
    assert.equal(
      result.uncertain.some(sh => sh.id === protectedId),
      false,
      protectedId + " is recognized as an intentionally retained record"
    );
  }
  assert.deepEqual(plain(records), before, "the helper does not mutate its input");
  assert.equal(
    result.removable.includes(records[0]),
    true,
    "removable records are the original records, not rewritten copies"
  );
  assert.equal(
    result.uncertain.includes(records[20]),
    true,
    "a valid-looking candidate sharing an ID with a protected record is retained"
  );
}

{
  const absent = [
    { id: "ordinary", sceneId: "s1", beatN: 1, action: "No provenance" },
    { id: "manual-empty", manual: true },
    { id: "current", keyframeMode: "beat-opening" },
    null,
    "not a shot"
  ];
  const before = plain(absent);
  assert.deepEqual(plain(cleanupHelper(absent)), { removable: [], uncertain: [] }, "absence is benign");
  assert.deepEqual(plain(absent), before, "an absence check does not mutate its input");
}

/*
 * Extract the actual declarations from App rather than copying their logic.
 * The section ends immediately before the next keyframe helper, and the
 * normal restoreShot declaration is extracted from its own real section.
 */
const cleanupStart = appSource.indexOf("  const shotsLiveRef=React.useRef(shots);");
const cleanupEnd = appSource.indexOf("  const keyframeInputsRef=", cleanupStart);
assert(cleanupStart >= 0 && cleanupEnd > cleanupStart, "could not locate real cleanup declaration");
const cleanupSection = appSource.slice(cleanupStart, cleanupEnd) + `
window.__microCleanupRefs={shotsLiveRef,keyframeBusyRef,microCleanupBusyRef};
window.removeMicroBeatShots=removeMicroBeatShots;`;

const restoreStart = appSource.indexOf("  const restoreShot =", 0);
const purgeStart = appSource.indexOf("  const purgeShot =", restoreStart);
assert(restoreStart >= 0 && purgeStart > restoreStart, "could not locate real restoreShot declaration");
const restoreSection = appSource.slice(restoreStart, purgeStart) + `
window.restoreShot=restoreShot;`;

const seedSourceFile = fs.readFileSync("app/shots.jsx", "utf8");
const seedStart = seedSourceFile.indexOf("function sceneShotsOrdered(list){");
const seedEndMarker = "window.seedShotOf = seedShotOf;";
const seedEnd = seedSourceFile.indexOf(seedEndMarker, seedStart) + seedEndMarker.length;
assert(seedStart >= 0 && seedEnd > seedStart, "could not locate real seed selector declarations");
const seedSection = seedSourceFile.slice(seedStart, seedEnd);
const seedContext = { console, window: {} };
vm.createContext(seedContext);
vm.runInContext(seedSection, seedContext);

const cleanupShots = () => [
  {
    id: "legacy-primary",
    sceneId: "s1",
    beatN: 1,
    order: 0,
    action: "Old primary action",
    beatPlan: { micro: ["First old action", "Second old action"] },
    covers: [1],
    assetId: "asset-primary",
    image: { url: "image-primary" },
    media: { frame: "frame-primary" },
    take: { id: "take-primary" },
    takes: [{ id: "take-primary", duration: 12 }],
    versions: [{ id: "version-primary", prompt: "old prompt" }],
    approval: { approvedBy: "editor" },
    modelId: "old-model"
  },
  {
    id: "legacy-extra",
    sceneId: "s1",
    beatN: 1,
    order: 1,
    action: "Old alternative action",
    beatPlan: { micro: ["First old action", "Second old action"] },
    covers: [2],
    assetId: "asset-extra",
    image: { url: "image-extra" },
    media: { frame: "frame-extra" },
    take: { id: "take-extra" },
    takes: [{ id: "take-extra", duration: 7 }],
    versions: [{ id: "version-extra", prompt: "old prompt 2" }],
    approval: { approvedBy: "editor" },
    modelId: "old-model"
  },
  {
    id: "modern-opening",
    sceneId: "s1",
    beatN: 1,
    order: 2,
    keyframeMode: "beat-opening",
    action: "Current opening keyframe",
    covers: [1],
    beatPlan: { micro: ["Current action"] }
  },
  {
    id: "manual-alternative",
    sceneId: "s1",
    beatN: 1,
    order: 3,
    manual: true,
    action: "Manual alternative"
  },
  {
    id: "shot-s1-mAbC123",
    sceneId: "s1",
    beatN: 1,
    order: 4,
    action: "A normal add-shot ID"
  },
  {
    id: "ambiguous",
    sceneId: "s1",
    beatN: 1,
    order: 5,
    action: "Coverage without its plan",
    covers: [1]
  },
  {
    id: "modern-next",
    sceneId: "s1",
    beatN: 1,
    order: 6,
    action: "Later current shot"
  }
];

function harness({
  shots = cleanupShots(),
  trashShots = [{ id: "keep-trash", sceneId: "s9", action: "Keep this trash item" }],
  confirm = true
} = {}) {
  const scene = { id: "s1", no: 1 };
  const h = {
    console,
    window: null,
    React: { useRef: value => ({ current: value }) },
    shots: plain(shots),
    trash: { shots: plain(trashShots) },
    scenes: [scene],
    scenesRef: { current: [scene] },
    projIdRef: { current: "film-1" },
    epoch: 1,
    allowed: true,
    confirmationCalls: [],
    toastCalls: [],
    setShotsCalls: 0,
    setTrashCalls: 0,
    appConfirm: async options => {
      h.confirmationCalls.push(options);
      return typeof confirm === "function" ? confirm(h, options) : confirm;
    },
    appToast: (message, type) => h.toastCalls.push({ message, type }),
    canMutateSharedFilm: () => h.allowed,
    nbEpoch: () => h.epoch,
    _trashStamp: shot => ({ ...shot, _deletedAt: "test-stamp-" + shot.id }),
    setShots: next => {
      h.setShotsCalls++;
      h.shots = typeof next === "function" ? next(h.shots) : next;
      // A real React render refreshes shotsLiveRef.  Keep the scoped VM's
      // state equally live so restoreShot can be tested as the normal handler.
      if (h.__microCleanupRefs) h.__microCleanupRefs.shotsLiveRef.current = h.shots;
    },
    setTrash: next => {
      h.setTrashCalls++;
      h.trash = typeof next === "function" ? next(h.trash) : next;
    }
  };
  h.window = h;
  vm.createContext(h);
  vm.runInContext(mergeSource, h);
  vm.runInContext(restoreSection, h);
  vm.runInContext(cleanupSection, h);
  return h;
}

function syncShots(h, next) {
  h.shots = plain(next);
  h.__microCleanupRefs.shotsLiveRef.current = h.shots;
}

function ids(value) {
  return plain(value).map(item => item && item.id);
}

function assertUnchanged(h, initialShots, initialTrash, message) {
  assert.deepEqual(plain(h.shots), plain(initialShots), message + ": shots");
  assert.deepEqual(plain(h.trash), plain(initialTrash), message + ": trash");
  assert.equal(h.setShotsCalls, 0, message + ": no setShots");
}

{
  const h = harness({
    trashShots: [
      { id: "legacy-extra", sceneId: "s1", oldTrashCopy: true },
      { id: "keep-trash", sceneId: "s9", action: "Keep this trash item" }
    ]
  });
  const initialShots = plain(h.shots);
  const initialTrash = plain(h.trash);
  const originalEligible = initialShots.filter(sh => ["legacy-primary", "legacy-extra"].includes(sh.id));

  // These are deliberately hostile if the cleanup handler attempts to invoke
  // any asset purge, model, replacement, approval rewrite, media, or take API.
  for (const name of [
    "nbClearAsset", "generateImage", "generateVideo", "automaticReplace",
    "approvalRewrite", "deleteMedia", "deleteTake", "deleteModel"
  ]) {
    h[name] = () => { throw new Error("forbidden cleanup side effect: " + name); };
  }

  await h.removeMicroBeatShots();
  assert.deepEqual(
    ids(h.shots),
    ["modern-opening", "manual-alternative", "shot-s1-mAbC123", "ambiguous", "modern-next"],
    "successful cleanup removes only safely identified legacy shots"
  );
  assert.equal(h.confirmationCalls.length, 1, "successful cleanup confirms once");
  assert.equal(h.setShotsCalls, 1, "successful cleanup commits one shot-list update");
  assert.equal(h.setTrashCalls, 1, "successful cleanup commits one trash update");

  const archived = h.trash.shots.filter(sh => ["legacy-primary", "legacy-extra"].includes(sh.id));
  assert.deepEqual(ids(archived), ["legacy-primary", "legacy-extra"], "existing trash is merged and deduped");
  for (const source of originalEligible) {
    const item = archived.find(sh => sh.id === source.id);
    const { _deletedAt, ...restoredSnapshot } = item;
    assert.deepEqual(restoredSnapshot, source, "trash keeps the full " + source.id + " snapshot");
    assert.ok(_deletedAt, "archived records receive a deletion stamp");
  }
  assert.equal(
    h.trash.shots.filter(sh => sh.id === "keep-trash").length,
    1,
    "unrelated existing trash remains"
  );
  assert.equal(
    h.trash.shots.filter(sh => sh.id === "legacy-extra").length,
    1,
    "an existing trash duplicate is removed before the new snapshot is prepended"
  );
  assert.equal(h.__microCleanupRefs.microCleanupBusyRef.current, false, "busy guard clears after success");
  assert.deepEqual(
    plain(h.__microCleanupRefs.shotsLiveRef.current),
    plain(h.shots),
    "the live shots ref follows the committed list"
  );
  assert.equal(h.toastCalls.at(-1).type, "ok", "success is reported without a provider call");

  const active = h.shots.filter(sh => sh.sceneId === "s1");
  assert.equal(active.some(sh => sh.id === "legacy-primary" || sh.id === "legacy-extra"), false);
  const seed = seedContext.window.seedShotOf(
    active.find(sh => sh.id === "modern-next"),
    active
  );
  assert.ok(seed && seed.id !== "legacy-primary" && seed.id !== "legacy-extra",
    "the real source selector cannot seed from a removed legacy shot");

  // Restore through the normal real handler, not a test-only shortcut.
  h.restoreShot("legacy-primary");
  const restored = h.shots.find(sh => sh.id === "legacy-primary");
  assert.ok(restored, "restoreShot puts the archived shot back in the active list");
  assert.deepEqual(plain(restored), originalEligible[0], "restoreShot removes only its trash stamp");
  assert.equal(h.trash.shots.some(sh => sh.id === "legacy-primary"), false, "restoreShot removes the restored trash item");
  assert.deepEqual(
    plain(h.__microCleanupRefs.shotsLiveRef.current),
    plain(h.shots),
    "normal restoreShot leaves the cleanup live ref current"
  );
  assert.equal(h.__microCleanupRefs.microCleanupBusyRef.current, false, "restoreShot leaves cleanup idle");

  const trashBeforeIdempotence = plain(h.trash);
  await h.removeMicroBeatShots();
  assert.equal(
    h.confirmationCalls.length,
    2,
    "a restored legacy record can be explicitly cleaned again"
  );
  assert.notDeepEqual(plain(h.trash), trashBeforeIdempotence, "the second explicit cleanup archives the restored record");
}

{
  const h = harness({
    shots: cleanupShots().filter(sh => ["legacy-primary", "legacy-extra"].includes(sh.id))
  });
  await h.removeMicroBeatShots();
  assert.deepEqual(plain(h.shots), [], "cleanup is allowed to leave the active list blank");
  assert.deepEqual(
    ids(h.trash.shots),
    ["legacy-primary", "legacy-extra", "keep-trash"],
    "all eligible shots can be archived without replacement"
  );
}

{
  const h = harness({
    shots: cleanupShots().filter(sh => !["legacy-primary", "legacy-extra", "ambiguous"].includes(sh.id))
  });
  const before = plain(h.shots);
  const trashBefore = plain(h.trash);
  await h.removeMicroBeatShots();
  assertUnchanged(h, before, trashBefore, "no eligible shots is benign");
  assert.equal(h.confirmationCalls.length, 0, "no eligible shots do not open confirmation");
}

{
  const h = harness();
  const before = plain(h.shots);
  const trashBefore = plain(h.trash);
  h.allowed = false;
  await h.removeMicroBeatShots();
  assertUnchanged(h, before, trashBefore, "readonly before confirmation");
  assert.equal(h.confirmationCalls.length, 0, "readonly before confirmation does not ask");
}

{
  const h = harness({ confirm: false });
  const before = plain(h.shots);
  const trashBefore = plain(h.trash);
  await h.removeMicroBeatShots();
  assertUnchanged(h, before, trashBefore, "confirmation cancel");
  assert.equal(h.confirmationCalls.length, 1, "cancel still uses the confirmation surface");
}

async function runDuringConfirmationGuard(label, mutate) {
  let release;
  const h = harness({
    confirm: () => new Promise(resolve => { release = resolve; })
  });
  const trashBefore = plain(h.trash);
  const pending = h.removeMicroBeatShots();
  assert.equal(h.confirmationCalls.length, 1, label + ": confirmation opened");
  mutate(h);
  const expectedShotsAfterMutation = plain(h.shots);
  release(true);
  await pending;
  assert.deepEqual(plain(h.shots), expectedShotsAfterMutation, label + ": shots remain at the changed revision");
  assert.deepEqual(plain(h.trash), trashBefore, label + ": trash");
  assert.equal(h.setShotsCalls, 0, label + ": no setShots");
  assert.equal(h.__microCleanupRefs.microCleanupBusyRef.current, false, label + ": busy guard clears");
}

for (const [label, mutate] of [
  ["readonly after confirmation", h => { h.allowed = false; }],
  ["film change while dialog is open", h => { h.projIdRef.current = "film-2"; }],
  ["epoch change while dialog is open", h => { h.epoch++; }],
  ["shot edit while dialog is open", h => {
    const next = plain(h.shots);
    next[0] = { ...next[0], action: "Edited while waiting" };
    syncShots(h, next);
  }],
  ["shot added while dialog is open", h => {
    syncShots(h, [...h.shots, { id: "added-while-waiting", sceneId: "s1", beatN: 9 }]);
  }],
  ["shot removed while dialog is open", h => {
    syncShots(h, h.shots.slice(1));
  }],
  ["active drafting while dialog is open", h => {
    h.__microCleanupRefs.keyframeBusyRef.current.add("s1");
  }],
  ["active generation registry while dialog is open", h => {
    h.__nbGenInflight = { "legacy-primary": true };
  }],
  ["active generation phase while dialog is open", h => {
    h.__nbShotPhase = { "legacy-primary": "rendering" };
  }]
]) {
  await runDuringConfirmationGuard(label, mutate);
}

for (const [label, mutate] of [
  ["active drafting before confirmation", h => {
    h.__microCleanupRefs.keyframeBusyRef.current.add("s1");
  }],
  ["active generation registry before confirmation", h => {
    h.__nbGenInflight = { "legacy-primary": true };
  }],
  ["active generation phase before confirmation", h => {
    h.__nbShotPhase = { "legacy-primary": "rendering" };
  }]
]) {
  const h = harness();
  const before = plain(h.shots);
  const trashBefore = plain(h.trash);
  mutate(h);
  await h.removeMicroBeatShots();
  assertUnchanged(h, before, trashBefore, label);
  assert.equal(h.confirmationCalls.length, 0, label + ": confirmation is blocked");
}

{
  let release;
  const h = harness({
    confirm: () => new Promise(resolve => { release = resolve; })
  });
  const first = h.removeMicroBeatShots();
  assert.equal(h.confirmationCalls.length, 1, "the first duplicate cleanup opens one dialog");
  const second = h.removeMicroBeatShots();
  assert.equal(h.confirmationCalls.length, 1, "duplicate cleanup calls fail closed while busy");
  release(true);
  await Promise.all([first, second]);
  assert.equal(h.confirmationCalls.length, 1, "duplicate cleanup calls remain idempotent");
  const afterFirst = plain(h.trash);
  await h.removeMicroBeatShots();
  assert.deepEqual(plain(h.trash), afterFirst, "a completed cleanup is idempotent on the current list");
  assert.equal(h.confirmationCalls.length, 1, "idempotence does not reopen confirmation");
}

{
  const h = harness();
  const before = plain(h.shots);
  const trashBefore = plain(h.trash);
  h.legacyMicroBeatShotCleanup = undefined;
  await h.removeMicroBeatShots();
  assertUnchanged(h, before, trashBefore, "missing cleanup helper");
  assert.equal(h.confirmationCalls.length, 0, "missing helper never confirms");
  assert.equal(h.toastCalls.at(-1).type, "error", "missing helper reports an explicit error");
}

{
  const h = harness();
  const before = plain(h.shots);
  const trashBefore = plain(h.trash);
  h.appConfirm = undefined;
  await h.removeMicroBeatShots();
  assertUnchanged(h, before, trashBefore, "missing confirmation surface");
  assert.equal(h.confirmationCalls.length, 0, "missing confirmation cannot be observed or bypassed");
  assert.equal(h.toastCalls.at(-1).type, "error", "missing confirmation reports an explicit error");
}

console.log("Micro-beat cleanup helper + actual App cleanup/guards/archive/restore tests passed.");
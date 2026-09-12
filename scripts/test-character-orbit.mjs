/*
 * Focused VM tests for the buildless character-orbit runtime.
 *
 * These tests stub the paid image boundary and the durable image commit. They
 * never contact a provider or cloud database; the production runtime itself
 * still requires nbGenerate/nbCommit and a live canWrite predicate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/character-orbit.js", import.meta.url), "utf8");

function storage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); },
    clear() { data.clear(); }
  };
}

function harness(config = {}) {
  const images = new Map([["char-1", "master-image"]]);
  const prompts = [];
  const commits = [];
  const events = [];
  let generated = 0;
  let beforeSubmitCalls = 0;
  let epoch = 4;
  let firstGate = null;
  let releaseFirst = null;
  const frameGates = new Map();
  let commitGate = null;
  let commitGateStarted = false;
  const commitCancellationChecks = [];
  const document = {
    hidden: false,
    addEventListener(name, fn) { if (name === "visibilitychange") this._visibility = fn; },
    removeEventListener(name, fn) { if (this._visibility === fn) this._visibility = null; },
    setHidden(value) { this.hidden = !!value; if (this._visibility) this._visibility(); }
  };
  const box = {
    localStorage: config.localStorage || storage(),
    sessionStorage: storage(),
    document,
    navigator: {},
    __turnCurrentProjectId: "film-1",
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Promise,
    structuredClone: globalThis.structuredClone,
    nbBackend: () => "local",
    nbCloudScope: () => null,
    nbEpoch: () => epoch,
    nbGetModel: () => "test-model",
    nbGetOaiQuality: () => "medium",
    nbGetRes: () => "2K",
    nbGetAspect: () => "9:16",
    nbImageCredits: () => 3,
    NB_ASPECTS: ["16:9", "9:16"],
    nbLoadImage: async (id) => images.get(id) || "",
    nbReleaseImageCache: () => {},
    nbCommit: async (id, data, meta, refs, kind, epoch, cancelled) => {
      if (commitGate && meta && meta.kind === "character-orbit-frame") {
        commitGateStarted = true;
        await commitGate.promise;
        const wasCancelled = typeof cancelled === "function" && cancelled();
        commitCancellationChecks.push(wasCancelled);
        if (wasCancelled) return { tier: "cancelled", url: data };
      }
      if (typeof cancelled === "function" && cancelled()) return { tier: "cancelled", url: data };
      const tier = Array.isArray(config.commitTiers)
        ? (config.commitTiers[commits.length] || "local")
        : (config.commitTier || "local");
      commits.push({ id, data, meta, refs });
      images.set(id, data);
      return { tier, url: data };
    },
    nbGenerate: async (prompt, opts) => {
      generated += 1;
      prompts.push({ prompt, opts });
      if (typeof opts.beforeSubmit === "function") {
        beforeSubmitCalls += 1;
        await opts.beforeSubmit();
      }
      if (generated === 1 && firstGate) await firstGate;
      const gate = frameGates.get(Number(opts.orbitFrameIndex));
      if (gate) await gate.promise;
      const frame = "rendered-frame-" + opts.orbitFrameIndex;
      return frame;
    }
  };
  box.window = box;
  box.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  box.dispatchEvent = () => true;
  vm.createContext(box);
  vm.runInContext(source, box, { filename: "app/character-orbit.js" });
  const unsubscribe = box.CharacterOrbit.subscribe((event) => events.push(event));
  return {
    box,
    api: box.CharacterOrbit,
    images,
    prompts,
    commits,
    events,
    get beforeSubmitCalls() { return beforeSubmitCalls; },
    document,
    setFirstGate() {
      firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    },
    releaseFirst() { releaseFirst?.(); },
    gateFrame(index) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      frameGates.set(index, { promise, release });
    },
    releaseFrame(index) {
      const gate = frameGates.get(index);
      if (gate) {
        gate.release();
        frameGates.delete(index);
      }
    },
    gateCommit() {
      let release;
      commitGateStarted = false;
      const promise = new Promise((resolve) => { release = resolve; });
      commitGate = { promise, release };
    },
    releaseCommit() {
      if (commitGate) {
        commitGate.release();
        commitGate = null;
      }
    },
    get commitGateStarted() { return commitGateStarted; },
    commitCancellationChecks,
    setEpoch(value) { epoch = value; },
    unsubscribe
  };
}

function cloudHarness(shared) {
  const backend = shared || { rows: new Map(), revision: 0 };
  const rows = backend.rows;
  const images = new Map([["cloud-char", "cloud-master"]]);
  const sourceLoads = [];
  const commits = [];
  const prompts = [];
  const frameGates = new Map();
  const scope = { projectId: "cloud-film", uid: "cloud-user", epoch: 12 };
  const box = {
    localStorage: storage(),
    sessionStorage: storage(),
    navigator: {},
    __turnCurrentProjectId: "cloud-film",
    console,
    Date,
    Math,
    Promise,
    structuredClone: globalThis.structuredClone,
    nbBackend: () => "cloud",
    nbCloudScope: () => ({ ...scope }),
    nbEpoch: () => scope.epoch,
    nbGetModel: () => "cloud-model",
    nbGetOaiQuality: () => "high",
    nbGetRes: () => "4K",
    nbGetAspect: () => "16:9",
    NB_ASPECTS: ["16:9", "9:16"],
    nbLoadImage: async (id) => {
      sourceLoads.push({ id, scope: { ...scope } });
      return images.get(id) || "";
    },
    nbReleaseImageCache: () => {},
    nbGenerate: async (prompt, opts) => {
      prompts.push({ prompt, opts });
      if (typeof opts.beforeSubmit === "function") await opts.beforeSubmit();
      const gate = frameGates.get(Number(opts.orbitFrameIndex));
      if (gate) await gate.promise;
      return "cloud-rendered-" + opts.orbitFrameIndex;
    },
    nbCommit: async (id, data, meta, refs, kind, epoch) => {
      assert.equal(epoch, scope.epoch, "cloud frame commits must carry the captured film epoch");
      commits.push({ id, data, meta, refs, kind });
      images.set(id, data);
      return { tier: "cloud", url: "https://storage.test/" + id };
    },
    cloudGetGenStrict: async (projectId, entityId) => {
      assert.equal(projectId, scope.projectId);
      return rows.get(entityId) || null;
    },
    cloudCasGen: async (projectId, uid, entityId, previous, fields) => {
      assert.equal(projectId, scope.projectId);
      assert.equal(uid, scope.uid);
      const current = rows.get(entityId) || null;
      if (current && (!previous || previous.updated_at !== current.updated_at)) {
        return { _cloudMutationError: "cloud CAS conflict" };
      }
      if (!current && previous) return { _cloudMutationError: "cloud CAS conflict" };
      const row = {
        project_id: projectId,
        owner: uid,
        entity_id: entityId,
        ...fields,
        updated_at: String(++backend.revision)
      };
      rows.set(entityId, row);
      return row;
    },
    cloudListOrbitRuns: async (projectId, characterId) => {
      assert.equal(projectId, scope.projectId);
      return [...rows.values()].filter((row) =>
        row.meta && row.meta.kind === "image/meta.orbitRun" &&
        (!characterId || row.meta.orbitRun.characterId === characterId));
    }
  };
  box.window = box;
  box.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  box.dispatchEvent = () => true;
  vm.createContext(box);
  vm.runInContext(source, box, { filename: "app/character-orbit.js#cloud" });
  return {
    box, api: box.CharacterOrbit, rows, images, commits, prompts, sourceLoads, backend,
    gateFrame(index) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      frameGates.set(index, { promise, release });
    },
    releaseFrame(index) {
      const gate = frameGates.get(index);
      if (gate) {
        gate.release();
        frameGates.delete(index);
      }
    },
    bump(entityId) {
      const row = rows.get(entityId);
      assert.ok(row);
      rows.set(entityId, { ...row, updated_at: String(++backend.revision) });
    }
  };
}

const h = harness();
assert.equal(h.api.FRAME_COUNT, 288);
assert.equal(h.api.FPS, 24);
assert.equal(h.api.angle(0), 0);
assert.equal(h.api.angle(1), 1.25);
assert.equal(h.api.angle(287), 358.75);
assert.notDeepEqual(
  h.api.suggestPose({ id: "a", name: "A", role: "guard" }),
  h.api.suggestPose({ id: "b", name: "B", role: "guard" }),
  "pose suggestions should be locally derived and character-distinct"
);
assert.equal(h.api.quote({ model: "test-model", quality: "medium", res: "2K", aspect: "9:16" }).credits, 864);

const memorySource = harness({ commitTier: "memory" });
memorySource.images.set("char-memory", "master-memory");
await assert.rejects(memorySource.api.create({
  character: { id: "char-memory", name: "Memory" },
  project: { id: "film-1" },
  canWrite: () => true
}), (error) => error.code === "ORBIT_SOURCE_SNAPSHOT_FAILED");
assert.equal(memorySource.prompts.length, 0, "memory-only source commits must fail before paid generation");

const memoryFrame = harness({ commitTiers: ["local", "memory"] });
memoryFrame.images.set("char-memory-frame", "master-memory-frame");
await assert.rejects(memoryFrame.api.create({
  character: { id: "char-memory-frame", name: "Memory Frame" },
  project: { id: "film-1" },
  canWrite: () => true
}), (error) => error.code === "ORBIT_COMMIT_UNCERTAIN");
assert.equal(memoryFrame.prompts.length, 1);
assert.equal(memoryFrame.commits.length, 2, "the fake boundary observed the rejected memory-tier attempt but no durable frame was adopted");

const brokenStorage = {
  getItem() { return null; },
  setItem() { throw new Error("quota"); },
  removeItem() {},
  clear() {}
};
const noDurableManifest = harness({ localStorage: brokenStorage });
noDurableManifest.images.set("char-no-storage", "master-no-storage");
await assert.rejects(noDurableManifest.api.create({
  character: { id: "char-no-storage", name: "No Storage" },
  project: { id: "film-1" },
  canWrite: () => true
}), (error) => error.code === "ORBIT_MANIFEST_NOT_DURABLE");
assert.equal(noDurableManifest.prompts.length, 0);

const character = {
  id: "char-1",
  name: "Rin",
  role: "guard",
  personality: "watchful and dryly funny",
  image: "data:image/png;base64,THIS-MUST-NOT-BE-IN-MANIFEST"
};
let canWrite = true;
h.setFirstGate();
const createdPromise = h.api.create({
  character,
  project: { id: "film-1" },
  pose: { direction: "weight forward, left hand relaxed", gesture: "a private half-smile" },
  settings: { model: "test-model", quality: "medium", res: "2K", aspect: "9:16" },
  canWrite: () => canWrite
});
// The created event is deliberately published while frame 0 is still blocked.
for (let i = 0; i < 20 && !h.events.some((event) => event.type === "created"); i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const createdEvent = h.events.find((event) => event.type === "created");
assert.ok(createdEvent, "UI should receive a durable created event before frame 0 settles");
assert.equal(createdEvent.run.frames.length, 0);
const stopDuringCreate = h.api.stop(createdEvent.run.id);
h.releaseFirst();
const stoppedCreate = await stopDuringCreate;
assert.equal(stoppedCreate.status, "stopped", "stop must await the actual create/provider promise");
const first = await createdPromise;
assert.equal(first.frames.length, 1);
assert.equal(first.frames[0].angle, 0);
assert.equal(first.settings.model, "test-model");
assert.equal(first.settings.quality, "medium");
assert.equal(first.settings.res, "2K");
assert.equal(first.settings.aspect, "9:16");
assert.equal(JSON.stringify(first).includes("THIS-MUST-NOT-BE-IN-MANIFEST"), false);
assert.equal(h.commits.length, 2, "source snapshot and frame 0 are separate durable assets");
assert.equal(h.prompts[0].opts.orbitFrameIndex, 0);
assert.equal(h.prompts[0].opts.extraImages.length, 0);
assert.equal(h.prompts[0].opts.noRetry, true);
assert.equal(typeof h.prompts[0].opts.beforeSubmit, "function");

await assert.rejects(
  h.api.resume(first.id, { canWrite: () => true }),
  (error) => error.code === "ORBIT_CONFIRMATION_REQUIRED"
);
const completed = await h.api.resume(first.id, { canWrite: () => true, confirmed: true });
assert.equal(completed.completed, 288);
assert.equal(completed.complete, true);
assert.equal(completed.frames.length, 288);
assert.equal(h.commits.filter((commit) => commit.meta.kind === "character-orbit-frame").length, 288);
assert.equal(h.prompts.length, 288);
assert.equal(h.beforeSubmitCalls, 288, "every paid frame must run the pre-submit scope/permission guard");
assert.equal(new Set(h.prompts.map((entry) => entry.opts.orbitAngle)).size, 288);
const lastFrameCommit = h.commits.filter((commit) => commit.meta.kind === "character-orbit-frame").at(-1);
assert.ok(lastFrameCommit.refs.some((ref) => ref.assetRole === "character_master"));
assert.ok(lastFrameCommit.refs.some((ref) => ref.assetRole === "orbit_first_pose"));
assert.ok(lastFrameCommit.meta.sourceReference.snapshotId.endsWith("-source"));
assert.equal((await h.api.frame(first.id, 287)), "rendered-frame-287");
assert.equal((await h.api.get(first.id)).completed, 288);
assert.equal((await h.api.get(first.id)).complete, true);
assert.equal((await h.api.list("char-1")).length, 1);

// The live commit callback is evaluated after an awaited upload checkpoint.
// Revoking write permission there cancels persistence without allowing a
// later paid frame.
h.images.set("char-guard", "guard-master");
const guarded = await h.api.create({
  character: { id: "char-guard", name: "Guarded" },
  project: { id: "film-1" },
  canWrite: () => canWrite
});
await h.api.confirm(guarded.id, { canWrite: () => canWrite });
h.gateCommit();
const guardedResume = h.api.resume(guarded.id, { canWrite: () => canWrite });
for (let i = 0; i < 30 && !h.commitGateStarted; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.equal(h.commitGateStarted, true, "test must reach the awaited commit checkpoint");
canWrite = false;
h.releaseCommit();
await assert.rejects(guardedResume, (error) =>
  error.code === "ORBIT_COMMIT_UNCERTAIN" || error.code === "ORBIT_WRITE_NOT_PERMITTED");
assert.equal(h.commitCancellationChecks.at(-1), true);
assert.equal(h.commits.filter((commit) =>
  commit.meta.kind === "character-orbit-frame" && commit.meta.orbitRunId === guarded.id).length, 1);
assert.equal(h.prompts.filter((entry) =>
  entry.opts.orbitRunId === guarded.id && entry.opts.orbitFrameIndex >= 2).length, 0);
canWrite = true;

// A fresh runtime can discover local metadata after a reload. The image store
// is deliberately separate; this assertion only exercises manifest discovery.
const reloaded = harness();
reloaded.box.localStorage = h.box.localStorage;
const listedAfterReload = await reloaded.api.list("char-1");
assert.equal(listedAfterReload.length, 1, "reload should discover the metadata-only manifest");

// Resume a genuinely incomplete run from a fresh runtime. The paid frame 1
// call is held so Stop can settle it; reload then continues at frame 2 rather
// than regenerating frame 0/1.
h.images.set("char-2", "master-image-2");
const partial = await h.api.create({
  character: { id: "char-2", name: "Mara", personality: "defiant" },
  project: { id: "film-1" },
  canWrite: () => canWrite
});
await h.api.confirm(partial.id, { canWrite: () => true });
h.gateFrame(1);
const partialResume = h.api.resume(partial.id, { canWrite: () => true });
for (let i = 0; i < 20 && !h.prompts.some((entry) => entry.opts.orbitRunId === partial.id && entry.opts.orbitFrameIndex === 1); i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const stopped = h.api.stop(partial.id);
h.releaseFrame(1);
const stoppedManifest = await stopped;
await partialResume;
assert.equal(stoppedManifest.status, "stopped");
assert.equal(stoppedManifest.frames.length, 2, "stop retains the current frame after its commit settles");

const resumeAfterReload = harness();
resumeAfterReload.box.localStorage = h.box.localStorage;
resumeAfterReload.box.nbLoadImage = async (id) => h.images.get(id) || "";
resumeAfterReload.box.nbCommit = async (id, data, meta, refs) => {
  h.images.set(id, data);
  return { tier: "local", url: data };
};
const resumed = await resumeAfterReload.api.resume(partial.id, {
  canWrite: () => true,
  acknowledgeUncertain: true
});
assert.equal(resumed.completed, 288);
assert.equal(resumed.frames.length, 288);
assert.equal(resumed.frames[0].angle, 0);
assert.equal(resumed.frames[1].angle, 1.25);

// Changing the live character slot after creation cannot change the frozen
// source used by a resumed run.
h.images.set("char-2", "MUTATED-LIVE-MASTER");
const sourceUses = resumeAfterReload.prompts.filter((entry) =>
  entry.opts.orbitRunId === partial.id);
assert.ok(sourceUses.length > 0);
assert.ok(sourceUses.every((entry) => entry.opts.referenceImage === "master-image-2"),
  "resume must use immutable source bytes after the live master changes");

// Cloud-shaped strict reads/CAS writes use the active project and uid, while
// the source/master and frame rows remain separate from the orbit manifest.
const cloud = cloudHarness();
const cloudFirst = await cloud.api.create({
  character: { id: "cloud-char", name: "Cloud Character", role: "captain" },
  project: { id: "cloud-film" },
  settings: { model: "cloud-model", quality: "high", res: "4K", aspect: "16:9" },
  canWrite: () => true
});
assert.equal(cloudFirst.completed, 1);
const cloudRunRow = [...cloud.rows.values()].find((row) => row.meta && row.meta.kind === "image/meta.orbitRun");
assert.ok(cloudRunRow, "cloud manifest must use the dedicated orbit metadata kind");
assert.equal(cloudRunRow.storage_path, null);
assert.equal(cloudRunRow.meta.orbitRun.pose && typeof cloudRunRow.meta.orbitRun.pose, "object");
assert.equal((await cloud.api.get(cloudFirst.id)).completed, 1);
assert.equal((await cloud.api.list("cloud-char")).length, 1);
assert.ok(cloud.sourceLoads.some((entry) => entry.id === "cloud-char" &&
  entry.scope.projectId === "cloud-film" && entry.scope.uid === "cloud-user"));
assert.ok(cloud.sourceLoads.some((entry) => entry.id.endsWith("-source")),
  "cloud resume/source reads must use the immutable orbit source slot");

// A second runtime can read the same cloud manifest, but a stale baseline
// cannot overwrite an active run after another writer advances its row.
await cloud.api.confirm(cloudFirst.id, { canWrite: () => true });
const cloudOtherTab = cloudHarness(cloud.backend);
await cloudOtherTab.api.get(cloudFirst.id);
cloud.gateFrame(1);
const cloudResume = cloud.api.resume(cloudFirst.id, { canWrite: () => true, confirmed: true });
for (let i = 0; i < 20 && !cloud.prompts.some((entry) => entry.opts.orbitFrameIndex === 1); i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
cloudOtherTab.bump("orbit-run-" + cloudFirst.id);
cloud.releaseFrame(1);
await assert.rejects(cloudResume, (error) => error.code === "ORBIT_MANIFEST_CONFLICT");
assert.equal(cloud.prompts.filter((entry) => entry.opts.orbitFrameIndex >= 2).length, 0,
  "a stale cloud writer must not submit a later paid frame");

h.unsubscribe();
console.log("character orbit tests passed");
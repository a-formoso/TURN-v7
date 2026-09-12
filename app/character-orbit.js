/* character-orbit.js — the durable 360° character-orbit runtime.
 *
 * This is deliberately plain global JavaScript.  It has no React/UI dependency:
 * the Art Room (or an export tool) can load it after imagegen.jsx and consume
 * window.CharacterOrbit.  Orbit manifests are metadata-only records.  Every
 * frame has its own image-generation slot, so a run can never overwrite the
 * character master sheet, a variant, or an approval.
 */
(function (root) {
  "use strict";

  const FRAME_COUNT = 288;
  const FPS = 24;
  const STEP = 360 / FRAME_COUNT;
  const MANIFEST_KIND = "image/meta.orbitRun";
  const RUN_PREFIX = "orbit-run-";
  const FRAME_PREFIX = "orbit-frame-";
  const LOCAL_INDEX = "turn-character-orbit-index-v1";
  const LOCAL_KEY_PREFIX = "turn-character-orbit-v1:";
  const IDB_DB = "turn-character-orbit";
  const IDB_STORE = "manifests";
  const LEASE_MS = 10 * 60 * 1000;

  const runs = new Map();          // run id -> live controller
  const localMem = new Map();      // useful when storage is unavailable
  const listeners = new Set();
  let idCounter = 0;
  let idbPromise = null;

  class OrbitError extends Error {
    constructor(message, code, extra) {
      super(message);
      this.name = "CharacterOrbitError";
      this.code = code || "ORBIT_ERROR";
      if (extra) Object.assign(this, extra);
    }
  }

  class OrbitStop extends Error {
    constructor() {
      super("Orbit stopped after the current frame.");
      this.name = "CharacterOrbitStop";
      this.code = "ORBIT_STOPPED";
    }
  }

  function now() { return Date.now(); }

  function stringifyError(error) {
    return String((error && error.message) || error || "Character orbit failed.");
  }

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    try {
      if (typeof root.structuredClone === "function") return root.structuredClone(value);
    } catch (e) {}
    try { return JSON.parse(JSON.stringify(value)); }
    catch (e) { return value; }
  }

  function deepFreeze(value, seen) {
    if (!value || typeof value !== "object") return value;
    seen = seen || new Set();
    if (seen.has(value)) return value;
    seen.add(value);
    Object.keys(value).forEach(function (key) { deepFreeze(value[key], seen); });
    try { Object.freeze(value); } catch (e) {}
    return value;
  }

  function asString(value) {
    return String(value == null ? "" : value).trim();
  }

  function safePart(value) {
    return asString(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "character";
  }

  function randomId() {
    var crypto = root.crypto;
    var uuid = crypto && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
    if (uuid) return uuid;
    idCounter += 1;
    return now().toString(36) + "-" + idCounter.toString(36) + "-" +
      Math.floor(Math.random() * 0xFFFFFFF).toString(36);
  }

  function angle(index) {
    var i = Number(index);
    if (!Number.isFinite(i)) throw new OrbitError("Frame index must be a finite number.", "INVALID_FRAME_INDEX");
    return Number((((i % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT * STEP).toFixed(6));
  }

  function frameId(runId, index) {
    return FRAME_PREFIX + runId + "-" + String(index);
  }

  function sourceSnapshotId(runId) {
    return RUN_PREFIX + runId + "-source";
  }

  function runEntityId(runId) {
    return RUN_PREFIX + runId;
  }

  function getProjectId(project) {
    if (project == null) return "";
    if (typeof project === "string" || typeof project === "number") return asString(project);
    return asString(project.id || project.projectId || project.project_id || project.filmId);
  }

  function currentScope(projectId) {
    var cloud = typeof root.nbCloudScope === "function" ? root.nbCloudScope() : null;
    var backend = typeof root.nbBackend === "function" ? root.nbBackend() : (cloud ? "cloud" : "local");
    var liveProject = root.__turnCurrentProjectId ||
      (root.turnProject && (root.turnProject.id || root.turnProject.projectId)) || "";
    var id = asString((cloud && cloud.projectId) || projectId || liveProject || "");
    var epoch = typeof root.nbEpoch === "function" ? root.nbEpoch() : null;
    return {
      backend: backend === "cloud" ? "cloud" : "local",
      projectId: id || (backend === "local" ? "local" : ""),
      known: !!id,
      uid: asString((cloud && cloud.uid) || ""),
      epoch: epoch
    };
  }

  function scopeForRun(run) {
    return {
      backend: run.scope.backend,
      projectId: run.scope.projectId,
      uid: run.scope.uid,
      epoch: run.epoch
    };
  }

  function assertScope(run, phase) {
    var current = currentScope("");
    if (current.backend !== run.scope.backend ||
        (run.scope.backend === "local" && !current.known) ||
        (run.scope.projectId && run.scope.projectId !== "local" &&
          current.projectId !== run.scope.projectId) ||
        (run.epoch != null && current.epoch != null && run.epoch !== current.epoch)) {
      throw new OrbitError(
        "The film or asset scope changed while this orbit was running; no further frames were saved.",
        "ORBIT_SCOPE_CHANGED",
        { phase: phase || "scope-check" }
      );
    }
    return true;
  }

  function currentCanWrite(run) {
    var fn = run && run.canWrite;
    if (typeof fn === "function") return fn();
    if (typeof fn === "boolean") return fn;
    throw new OrbitError("A live canWrite permission predicate is required before saving an orbit.", "ORBIT_WRITE_PERMISSION_REQUIRED");
  }

  async function requireCanWrite(run, phase) {
    var permitted = await currentCanWrite(run);
    assertScope(run, phase || "permission-check");
    if (!permitted) throw new OrbitError(
      "Writing this orbit is no longer permitted. The run stopped before the next save.",
      "ORBIT_WRITE_NOT_PERMITTED",
      { phase: phase || "permission-check" }
    );
    return true;
  }

  // nbCommit invokes its cancellation callback synchronously at multiple
  // upload checkpoints. Keep this guard synchronous and fail closed: a
  // promise from canWrite cannot be safely awaited by the image writer, so it
  // must cancel rather than risk persisting after ownership/scope loss.
  function liveCommitCancelled(run) {
    try {
      assertScope(run, "commit-guard");
      if (runs.get(run.manifest.id) !== run) return true;
      var permitted = currentCanWrite(run);
      if (permitted && typeof permitted.then === "function") return true;
      return !permitted;
    } catch (e) {
      return true;
    }
  }

  /*
   * Canon snapshots must be immutable, but generated image bytes must never
   * enter a manifest.  Keep textual identity fields and omit known image/blob
   * fields plus data URLs at every nesting level.
   */
  function canonClean(value, key) {
    if (typeof value === "string") {
      if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return undefined;
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(function (item) { return canonClean(item, key); }).filter(function (item) { return item !== undefined; });
    }
    if (!value || typeof value !== "object") return value;
    var out = {};
    Object.keys(value).forEach(function (name) {
      var lower = name.toLowerCase();
      if (lower === "image" || lower === "imageurl" || lower === "dataurl" ||
          lower === "base64" || lower === "generatedimage" || lower === "masterimage" ||
          lower === "imagebytes" || lower === "bytes") return;
      var cleaned = canonClean(value[name], name);
      if (cleaned !== undefined) out[name] = cleaned;
    });
    return out;
  }

  function characterIdOf(character) {
    return asString(character && (character.id || character.characterId));
  }

  function characterNameOf(character) {
    return asString(character && (character.name || character.characterName)) || "Character";
  }

  function poseText(pose) {
    if (typeof pose === "string") return pose.trim();
    if (!pose || typeof pose !== "object") return "";
    return asString(pose.direction || pose.text || pose.canon || pose.pose || pose.description);
  }

  function normalizePose(character, supplied) {
    var suggested = suggestPose(character);
    var source = supplied;
    if (source == null || source === "") source = suggested;
    if (typeof source === "string") {
      var text = source.trim();
      if (!text) throw new OrbitError("The orbit pose direction cannot be empty.", "ORBIT_POSE_REQUIRED");
      return { direction: text, canon: text, gesture: suggested.gesture, source: "user" };
    }
    var direction = poseText(source);
    if (!direction) throw new OrbitError("The orbit pose direction cannot be empty.", "ORBIT_POSE_REQUIRED");
    return {
      direction: direction,
      canon: asString(source.canon || source.direction || direction),
      gesture: asString(source.gesture || suggested.gesture),
      source: "user",
      label: asString(source.label) || undefined
    };
  }

  function qualityChoices(model) {
    if (typeof root.nbOaiQualityChoices === "function") {
      try { return root.nbOaiQualityChoices(model) || []; } catch (e) {}
    }
    return ["low", "medium", "high"];
  }

  function snapshotSettings(settings) {
    settings = settings || {};
    var model = asString(settings.model) ||
      (typeof root.nbGetModel === "function" ? asString(root.nbGetModel()) : "");
    var quality;
    if (Object.prototype.hasOwnProperty.call(settings, "quality")) quality = settings.quality;
    else if (typeof root.nbGetOaiQuality === "function") quality = root.nbGetOaiQuality(model);
    else quality = "medium";
    var res = asString(settings.res || settings.resolution) ||
      (typeof root.nbGetRes === "function" ? asString(root.nbGetRes()) : "2K");
    var aspect = asString(settings.aspect || settings.aspectRatio) ||
      (typeof root.nbGetAspect === "function" ? asString(root.nbGetAspect()) : "9:16");

    if (!model) throw new OrbitError("An image model is required for a character orbit.", "ORBIT_MODEL_REQUIRED");
    if (root.NB_MODELS && Array.isArray(root.NB_MODELS) &&
        !root.NB_MODELS.some(function (item) { return item && item.id === model; })) {
      throw new OrbitError("The selected image model is not available: " + model + ".", "ORBIT_MODEL_INVALID");
    }
    if (!["1K", "2K", "4K"].includes(res)) {
      throw new OrbitError("Orbit resolution must be 1K, 2K, or 4K.", "ORBIT_RESOLUTION_INVALID");
    }
    if (root.NB_ASPECTS && Array.isArray(root.NB_ASPECTS) && !root.NB_ASPECTS.includes(aspect)) {
      throw new OrbitError("The selected orbit aspect ratio is not available: " + aspect + ".", "ORBIT_ASPECT_INVALID");
    }
    if (quality == null || quality === "") quality = "medium";
    var choices = qualityChoices(model);
    if (choices.length && !choices.includes(quality)) {
      throw new OrbitError("Quality " + String(quality) + " is not supported by " + model + ".", "ORBIT_QUALITY_INVALID");
    }
    var out = { model: model, quality: String(quality), res: res, aspect: aspect };
    return deepFreeze(out);
  }

  async function validateQuality(settings) {
    if (typeof root.nbRequireImageQuality === "function") {
      await root.nbRequireImageQuality(settings.model, settings.quality);
      return;
    }
    if (typeof root.nbCanUseImageQuality === "function" && root.isGptImageModel &&
        root.isGptImageModel(settings.model) &&
        !root.nbCanUseImageQuality(settings.model, settings.quality)) {
      throw new OrbitError("The selected quality is not available from the image server.", "ORBIT_QUALITY_UNAVAILABLE");
    }
  }

  function sourceIdOf(character) {
    return characterIdOf(character) || asString(character && (character.masterSheetId || character.sourceReferenceId));
  }

  function sourceReference(run) {
    return {
      id: run.sourceId,
      snapshotId: run.sourceId,
      originalId: run.originalSourceId,
      role: "character-master-snapshot",
      characterId: run.manifest.characterId
    };
  }

  async function loadImage(id, run, phase) {
    assertScope(run, phase || "reference-load");
    var loader = typeof root.nbLoadImage === "function" ? root.nbLoadImage :
      (typeof root.nbGetImage === "function" ? function (assetId) { return root.nbGetImage(assetId); } : null);
    if (!loader) throw new OrbitError("The image loader is unavailable; the orbit cannot verify its character reference.", "ORBIT_LOAD_UNAVAILABLE");
    var value;
    try { value = await loader(id); }
    catch (e) {
      throw new OrbitError("The character orbit reference could not be loaded: " + stringifyError(e), "ORBIT_REFERENCE_LOAD_FAILED", { cause: e });
    }
    assertScope(run, phase || "reference-load");
    if (!value) throw new OrbitError("The generated character master/reference is unavailable; restore it before starting the orbit.", "ORBIT_REFERENCE_MISSING");
    return value;
  }

  /*
   * The live character slot can be regenerated while an orbit is paused or
   * after a reload. Never use that mutable slot as an orbit reference. A
   * private, immutable orbit-source slot is committed once before the first
   * paid request and all later runs read that slot instead.
   */
  async function captureSourceSnapshot(run, originalUrl) {
    var snapshotId = sourceSnapshotId(run.manifest.id);
    await requireCanWrite(run, "source-snapshot-precommit");
    var saved;
    try {
      saved = await root.nbCommit(snapshotId, originalUrl, {
        kind: "character-orbit-source-snapshot",
        orbitRunId: run.manifest.id,
        characterId: run.manifest.characterId,
        originalSourceId: run.originalSourceId,
        immutable: true,
        sourceSnapshot: (run.manifest.sourceReference || {}).snapshot || null,
        sourceReference: {
          id: run.originalSourceId,
          role: "character-master"
        }
      }, [{
        refId: run.originalSourceId,
        sourceEntityId: run.originalSourceId,
        assetRole: "character_master",
        note: "Original generated master captured for this orbit"
      }], "orbit-source", run.epoch, function () { return liveCommitCancelled(run); });
    } catch (e) {
      throw new OrbitError("The orbit's immutable master snapshot could not be saved: " + stringifyError(e),
        "ORBIT_SOURCE_SNAPSHOT_FAILED", { cause: e });
    }
    assertScope(run, "source-snapshot-after-commit");
    await requireCanWrite(run, "source-snapshot-postcommit");
    if (!isDurableCommit(saved)) {
      throw new OrbitError("The orbit's immutable master snapshot was not confirmed.", "ORBIT_SOURCE_SNAPSHOT_FAILED", {
        commit: saved
      });
    }
    run.sourceId = snapshotId;
    var priorReference = run.manifest.sourceReference || {};
    run.manifest.sourceReference = {
      id: snapshotId,
      snapshotId: snapshotId,
      originalId: run.originalSourceId,
      role: "character-master-snapshot",
      required: true,
      snapshot: priorReference.snapshot || null
    };
    run.internal.sourceSnapshotPending = false;
    await persist(run, "source-snapshot-saved");
    var frozenUrl = await loadImage(snapshotId, run, "source-snapshot-load");
    releaseImage(run.originalSourceId);
    return frozenUrl;
  }

  async function ensureFrozenSource(run) {
    var ref = run.manifest.sourceReference || {};
    var snapshotId = asString(ref.snapshotId || (ref.role === "character-master-snapshot" ? ref.id : ""));
    if (!snapshotId) {
      throw new OrbitError("This orbit has no immutable master snapshot; refusing to read the live character slot.", "ORBIT_SOURCE_SNAPSHOT_MISSING");
    }
    var frozen = await loadImage(snapshotId, run, "source-snapshot-load");
    run.sourceId = snapshotId;
    run.originalSourceId = asString(ref.originalId || run.originalSourceId);
    return frozen;
  }

  function releaseImage(id) {
    if (id && typeof root.nbReleaseImageCache === "function") {
      try { root.nbReleaseImageCache(id); } catch (e) {}
    }
  }

  function isDurableCommit(commit) {
    if (!commit || !commit.tier) return false;
    return commit.tier === "cloud" || commit.tier === "idb" ||
      commit.tier === "indexeddb" || commit.tier === "local" ||
      commit.tier === "durable" || commit.tier === "saved";
  }

  function referenceMeta(run, includePose) {
    var refs = [{
      refId: run.sourceId,
      sourceEntityId: run.sourceId,
      assetRole: "character_master",
      note: "Original generated character master sheet"
    }];
    if (includePose) refs.push({
      refId: frameId(run.manifest.id, 0),
      sourceEntityId: frameId(run.manifest.id, 0),
      assetRole: "orbit_first_pose",
      note: "Reviewed frame 0 pose anchor"
    });
    return refs;
  }

  function buildPrompt(run, index) {
    var a = angle(index);
    var pose = run.manifest.pose || {};
    var canon = run.manifest.canon || {};
    var first = index === 0;
    var direction = [
      "Render a single new AI image for a character 360-degree orbit.",
      "This is orbit frame " + String(index) + " of " + String(FRAME_COUNT) +
        ", at exactly " + a.toFixed(2) + " degrees around the subject (clockwise turntable angle).",
      first
        ? "Frame 0 is the reviewed first-pose anchor: use a restrained, character-specific physical pose driven by the canon and personality cue below, never a generic heroic stance."
        : "Keep the reviewed frame 0 pose, identity, wardrobe, proportions, lighting and background fixed while changing only the camera/orientation view.",
      first
        ? "Use the original generated character master sheet as the identity, anatomy and wardrobe reference."
        : "Use the original generated character master sheet and the reviewed first-pose frame as identity references.",
      "Preserve the source sheet's exact anatomy, silhouette, outfit, accessories, materials and designed proportions; do not invent props, limbs, costume parts or anatomy.",
      "The output must be a genuinely newly rendered frame, not a duplicated frame, a crop, a mirror, a fake spin, or a composited strip.",
      "Character name: " + run.manifest.characterName + ".",
      "Pose direction: " + String(pose.direction || "") + ".",
      "Unique personality gesture: " + String(pose.gesture || "") + ".",
      "Canon identity JSON: " + JSON.stringify(canon),
      "Use one character only, with no text, labels, rulers, captions, watermarks, logos, UI, or extra people."
    ];
    if (first) direction.splice(3, 1); // frame 0 has no prior first-pose reference
    return direction.join(" ");
  }

  function outputSettings(settings) {
    return {
      model: settings.model,
      quality: settings.quality,
      imageSize: settings.res,
      res: settings.res,
      aspectRatio: settings.aspect,
      aspect: settings.aspect
    };
  }

  function publicManifest(manifest) {
    var out = clone(manifest) || {};
    out.frames = Array.isArray(out.frames) ? out.frames.map(function (f) {
      return { index: Number(f.index), id: String(f.id), angle: angle(f.index) };
    }) : [];
    out.completed = out.frames.length;
    out.complete = out.completed === FRAME_COUNT || out.complete === true;
    if (out.pose && typeof out.pose !== "string") out.pose = poseText(out.pose);
    if (!out.complete && out.pendingIndex == null) out.pendingIndex = out.frames.length;
    if (out.complete) delete out.pendingIndex;
    return out;
  }

  function eventFor(run, type, extra) {
    var m = publicManifest(run.manifest);
    var event = Object.assign({
      type: type || "status",
      runId: m.id,
      status: m.status,
      completed: m.completed,
      completedFrames: m.frames.length,
      total: FRAME_COUNT,
      pendingIndex: m.pendingIndex,
      manifest: m,
      // Consumers may use either event.run or event.manifest. Keep a
      // manifest snapshot on both names so a listener cannot mutate runtime
      // state accidentally.
      run: clone(m)
    }, extra || {});
    return event;
  }

  function emit(run, type, extra) {
    var event = eventFor(run, type, extra);
    listeners.forEach(function (listener) {
      try { listener(event); } catch (e) {}
    });
    try {
      if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent("character-orbit", { detail: event }));
      }
    } catch (e) {}
    return event;
  }

  function localStorageGet(key) {
    try { return root.localStorage && root.localStorage.getItem(key); } catch (e) { return null; }
  }
  function localStorageSet(key, value) {
    try {
      if (!root.localStorage || typeof root.localStorage.setItem !== "function") return false;
      root.localStorage.setItem(key, value);
      return localStorageGet(key) === String(value);
    } catch (e) { return false; }
  }

  function localKey(scope, id) {
    return LOCAL_KEY_PREFIX + safePart(scope.projectId || "local") + ":" + id;
  }

  function localIndexKey(scope) {
    return LOCAL_INDEX + ":" + safePart(scope.projectId || "local");
  }

  function localGlobalIndexKey() {
    return LOCAL_INDEX + ":all";
  }

  function localGlobalManifestKey(id) {
    return LOCAL_KEY_PREFIX + "global:" + id;
  }

  function idbOpen() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      try {
        if (!root.indexedDB || typeof root.indexedDB.open !== "function") {
          reject(new Error("indexedDB unavailable"));
          return;
        }
        var request = root.indexedDB.open(IDB_DB, 1);
        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error("orbit IndexedDB open failed")); };
      } catch (e) { reject(e); }
    });
    return idbPromise;
  }

  function idbRead(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var request = tx.objectStore(IDB_STORE).get(key);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function idbWrite(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  async function durableLocalWrite(key, value, required) {
    var serialized = typeof value === "string" ? value : JSON.stringify(value);
    var localOk = localStorageSet(key, serialized);
    var idbOk = false;
    try {
      await idbWrite(key, value);
      var check = await idbRead(key);
      idbOk = JSON.stringify(check) === JSON.stringify(value);
    } catch (e) {}
    if (!localOk && !idbOk && required !== false) {
      throw new OrbitError("Orbit metadata could not be saved to reload-durable storage.", "ORBIT_MANIFEST_NOT_DURABLE");
    }
    return localOk || idbOk;
  }

  async function durableLocalText(key) {
    var text = localStorageGet(key);
    if (text != null) return text;
    try {
      var value = await idbRead(key);
      return value == null ? null : (typeof value === "string" ? value : JSON.stringify(value));
    } catch (e) { return null; }
  }

  function storedMeta(manifest, internal) {
    return {
      kind: MANIFEST_KIND,
      schema: 1,
      orbitRun: clone(manifest),
      orbitInternal: {
        lease: internal && internal.lease ? clone(internal.lease) : null,
        confirmed: !!(internal && internal.confirmed),
        uncertainIndex: internal && internal.uncertainIndex != null ? Number(internal.uncertainIndex) : null,
        fatal: !!(internal && internal.fatal),
        fatalKind: internal && internal.fatalKind ? String(internal.fatalKind) : "",
        sourceSnapshotPending: !!(internal && internal.sourceSnapshotPending)
      }
    };
  }

  function decodeStored(value, scope) {
    if (!value) return null;
    var row = value.meta ? value : null;
    var meta = row ? row.meta : value.meta || value;
    var manifest = meta && (meta.orbitRun || meta.manifest);
    if (!manifest && value.manifest) manifest = value.manifest;
    if (!manifest || manifest.id == null) return null;
    var internal = (meta && meta.orbitInternal) || value.internal || {};
    return {
      // Keep the rich pose object and numeric progress internally. Public
      // callers receive the compact contract through publicManifest().
      manifest: clone(manifest),
      internal: {
        lease: internal.lease || null,
        confirmed: !!internal.confirmed,
        uncertainIndex: internal.uncertainIndex == null ? null : Number(internal.uncertainIndex),
        fatal: !!internal.fatal,
        fatalKind: internal.fatalKind || "",
        sourceSnapshotPending: !!internal.sourceSnapshotPending
      },
      row: row || null,
      scope: scope || null
    };
  }

  async function localRead(scope, id) {
    var key = localKey(scope, id);
    var value = localMem.get(key);
    if (!value) {
      var text = localStorageGet(key);
      if (text) {
        try { value = JSON.parse(text); } catch (e) { throw new OrbitError("Orbit manifest storage is corrupt.", "ORBIT_MANIFEST_CORRUPT"); }
      }
    }
    if (!value) {
      try { value = await idbRead(key); } catch (e) {}
    }
    return decodeStored(value, scope);
  }

  async function localWrite(scope, id, value) {
    var key = localKey(scope, id);
    await durableLocalWrite(key, value, true);
    localMem.set(key, value);
    // The global locator is only a reload aid. It contains the same
    // metadata-only manifest and is filtered by its captured projectId.
    var globalKey = localGlobalManifestKey(id);
    localMem.set(globalKey, value);
    await durableLocalWrite(globalKey, value, false);
    var indexKeys = [localIndexKey(scope), localGlobalIndexKey()];
    for (var i = 0; i < indexKeys.length; i += 1) {
      var indexKey = indexKeys[i];
      var ids = [];
      var existing = await durableLocalText(indexKey);
      if (existing) {
        try { ids = JSON.parse(existing) || []; } catch (e) { ids = []; }
      }
      if (!ids.includes(id)) ids.push(id);
      await durableLocalWrite(indexKey, JSON.stringify(ids), indexKey === localIndexKey(scope));
    }
    return true;
  }

  async function localList(scope) {
    var ids = [];
    // A local film can be selected without changing imagegen's backend scope.
    // Keep a global id index as a reload locator, then filter by the immutable
    // projectId in each manifest rather than treating another film's run as
    // belonging to the current one.
    var text = await durableLocalText(scope.projectId && scope.projectId !== "local"
      ? localIndexKey(scope) : localGlobalIndexKey());
    if (text) {
      try { ids = JSON.parse(text) || []; } catch (e) { ids = []; }
    }
    localMem.forEach(function (value, key) {
      if (key.indexOf(LOCAL_KEY_PREFIX + safePart(scope.projectId || "local") + ":") === 0) {
        var id = key.slice(key.lastIndexOf(":") + 1);
        if (!ids.includes(id)) ids.push(id);
      }
    });
    var out = [];
    for (var i = 0; i < ids.length; i += 1) {
      var loaded = scope.projectId && scope.projectId !== "local"
        ? await localRead(scope, ids[i])
        : decodeStored(localMem.get(localGlobalManifestKey(ids[i])) ||
          (function () {
            var raw = localStorageGet(localGlobalManifestKey(ids[i]));
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (e) { return null; }
          })(), scope);
      if (loaded) out.push(loaded);
    }
    return out;
  }

  function cloudClient() {
    return typeof root.sbClient === "function" ? root.sbClient() : null;
  }

  async function cloudRead(scope, entityId) {
    if (typeof root.cloudGetGenStrict === "function") {
      var strict = await root.cloudGetGenStrict(scope.projectId, entityId);
      return strict ? decodeStored(strict, scope) : null;
    }
    var sb = cloudClient();
    if (sb && typeof sb.from === "function") {
      var response = await sb.from("turn_generations").select("*")
        .eq("project_id", scope.projectId).eq("entity_id", entityId).maybeSingle();
      if (response && response.error) throw new OrbitError(response.error.message || "Cloud orbit manifest read failed.", "ORBIT_MANIFEST_READ_FAILED");
      return response && response.data ? decodeStored(response.data, scope) : null;
    }
    // cloudGetGen intentionally swallows read failures for display cards. It
    // is not safe for a resumable, paid run: a transient error must not look
    // like an absent manifest and trigger another generation.
    throw new OrbitError("Strict cloud orbit manifest reads are unavailable.", "ORBIT_CLOUD_UNAVAILABLE");
  }

  async function cloudWrite(scope, entityId, value, previous) {
    var fields = {
      storage_path: null,
      meta: storedMeta(value.manifest, value.internal),
      refs: [],
      history: []
    };
    var previousRow = previous && previous.row ? previous.row : previous;
    if (typeof root.cloudCasGen === "function") {
      var cas = await root.cloudCasGen(scope.projectId, scope.uid, entityId,
        previousRow || null, fields);
      if (!cas || cas._cloudMutationError) {
        throw new OrbitError((cas && cas._cloudMutationError) || "Cloud orbit manifest changed; refresh before continuing.", "ORBIT_MANIFEST_CONFLICT");
      }
      return decodeStored(cas, scope);
    }
    var sb = cloudClient();
    if (sb && typeof sb.from === "function") {
      var table = sb.from("turn_generations");
      var response;
      if (previousRow) {
        var query = table.update(fields).eq("project_id", scope.projectId).eq("entity_id", entityId);
        if (previousRow.updated_at) query = query.eq("updated_at", previousRow.updated_at);
        response = await query.select().maybeSingle();
      } else {
        response = await table.insert({
          project_id: scope.projectId, owner: scope.uid, entity_id: entityId
        }).select().single();
        if (!response.error && response.data) {
          var inserted = await table.update(fields).eq("project_id", scope.projectId)
            .eq("entity_id", entityId).eq("updated_at", response.data.updated_at)
            .select().maybeSingle();
          response = inserted;
        }
      }
      if (response && response.error) throw new OrbitError(response.error.message || "Cloud orbit manifest save failed.", "ORBIT_MANIFEST_WRITE_FAILED");
      if (!response || !response.data) throw new OrbitError("Cloud orbit manifest changed before it could be saved.", "ORBIT_MANIFEST_CONFLICT");
      return decodeStored(response.data, scope);
    }
    // A blind upsert would turn a stale tab into the owner of another tab's
    // run. Resumable orbit writes require a real compare-and-swap adapter or
    // the direct conditional update above.
    throw new OrbitError("Cloud orbit compare-and-swap storage is unavailable.", "ORBIT_CAS_UNAVAILABLE");
  }

  async function readRunStored(run) {
    if (run.scope.backend === "cloud") return cloudRead(run.scope, run.entityId);
    return localRead(run.scope, run.manifest.id);
  }

  async function persist(run, phase) {
    assertScope(run, phase || "manifest-read");
    await requireCanWrite(run, phase || "manifest-write");
    var saved;
    if (run.scope.backend === "cloud") {
      saved = await cloudWrite(run.scope, run.entityId, {
        manifest: clone(run.manifest),
        internal: run.internal
      }, run.row);
    } else {
      await localWrite(run.scope, run.manifest.id, {
        meta: storedMeta(clone(run.manifest), run.internal)
      });
      saved = { manifest: clone(run.manifest), internal: clone(run.internal), scope: run.scope };
    }
    assertScope(run, phase || "manifest-write");
    await requireCanWrite(run, phase || "manifest-post-write");
    if (saved) {
      run.internal = saved.internal || run.internal;
      run.row = saved.row || run.row;
    }
    // Do not publish a terminal persisted snapshot while the active work
    // promise still owns the lease. The caller clears its busy state only
    // after lease cleanup; resumeInternal emits the terminal notification
    // immediately after that promise settles.
    if (!run.manifest.complete) emit(run, "persisted", { phase: phase || "manifest-write" });
    return publicManifest(run.manifest);
  }

  function makeRun(manifest, internal, scope, canWrite) {
    var run = {
      manifest: manifest,
       internal: internal || {
         lease: null, confirmed: false, uncertainIndex: null, fatal: false,
         fatalKind: "", sourceSnapshotPending: false
       },
      scope: scope,
      epoch: scope.epoch,
      entityId: runEntityId(manifest.id),
      sourceId: manifest.sourceReference && manifest.sourceReference.id,
      originalSourceId: manifest.sourceReference &&
        (manifest.sourceReference.originalId || manifest.sourceReference.id),
      canWrite: canWrite,
      stopRequested: false,
      activePromise: null,
      stopWaiters: [],
      row: null,
      masterUrl: null,
      firstPoseUrl: null
    };
    return run;
  }

  function checkFrameIndex(index) {
    var n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n >= FRAME_COUNT) {
      throw new OrbitError("Frame index must be an integer from 0 through 287.", "ORBIT_FRAME_INDEX_INVALID");
    }
    return n;
  }

  function runFromStored(stored, canWrite, register) {
    if (!stored || !stored.manifest) throw new OrbitError("Character orbit run was not found.", "ORBIT_RUN_NOT_FOUND");
    var scope = stored.scope || currentScope(stored.manifest.projectId);
    var richManifest = clone(stored.manifest);
    // A persisted manifest from an older build may carry a boolean completed
    // flag. Re-derive progress from the durable frame list so one reviewed
    // frame can never be mistaken for a complete 288-frame run on reload.
    richManifest.completed = Array.isArray(richManifest.frames) ? richManifest.frames.length : 0;
    richManifest.complete = richManifest.completed === FRAME_COUNT;
    if (typeof richManifest.pose === "string") {
      richManifest.pose = { direction: richManifest.pose, canon: richManifest.pose, gesture: "" };
    }
    var run = makeRun(richManifest, stored.internal, scope, canWrite);
    run.row = stored.row || null;
    run.epoch = currentScope(scope.projectId).epoch;
    if (register !== false) runs.set(run.manifest.id, run);
    return run;
  }

  async function loadRun(runId, canWrite) {
    var id = asString(runId);
    if (!id) throw new OrbitError("An orbit run id is required.", "ORBIT_RUN_ID_REQUIRED");
    var existing = runs.get(id);
    if (existing && existing.activePromise) {
      if (canWrite !== undefined) existing.canWrite = canWrite;
      assertScope(existing, "run-load");
      return existing;
    }
    var scope = currentScope("");
    if (scope.backend === "local" && !scope.known) {
      throw new OrbitError("The active film id is unavailable; refusing to read another film's local orbit.", "ORBIT_SCOPE_UNKNOWN");
    }
    var stored;
    if (scope.backend === "cloud") {
      var entityId = runEntityId(id);
      stored = await cloudRead(scope, entityId);
      assertCurrentScope(scope, "run-load");
    } else {
      stored = await localRead(scope, id);
      if (!stored && (!scope.projectId || scope.projectId === "local")) {
        var allText = await durableLocalText(localGlobalIndexKey());
        var allIds = [];
        if (allText) {
          try { allIds = JSON.parse(allText) || []; } catch (e) {}
        }
        for (var ai = 0; ai < allIds.length && !stored; ai += 1) {
          var candidateValue = localMem.get(localGlobalManifestKey(allIds[ai]));
          if (!candidateValue) {
            var candidateText = await durableLocalText(localGlobalManifestKey(allIds[ai]));
            if (candidateText) {
              try { candidateValue = JSON.parse(candidateText); } catch (e) {}
            }
          }
          var candidate = decodeStored(candidateValue, scope);
          if (candidate && candidate.manifest.id === id) stored = candidate;
        }
      }
    }
    if (!stored && existing) return existing;
    if (!stored) throw new OrbitError("Character orbit run " + id + " was not found in this film.", "ORBIT_RUN_NOT_FOUND");
    if (stored.manifest.id !== id) throw new OrbitError("Orbit manifest id mismatch.", "ORBIT_MANIFEST_CORRUPT");
    var run = runFromStored(stored, canWrite);
    assertScope(run, "run-load");
    return run;
  }

  function assertCurrentScope(scope, phase) {
    var current = currentScope("");
    if (current.backend !== scope.backend ||
        (scope.backend === "local" && !current.known) ||
        (scope.projectId && scope.projectId !== "local" && current.projectId !== scope.projectId) ||
        (scope.epoch != null && current.epoch != null && scope.epoch !== current.epoch)) {
      throw new OrbitError("The film or asset scope changed during " + (phase || "orbit") + ".", "ORBIT_SCOPE_CHANGED");
    }
  }

  async function loadRunForRead(runId) {
    var id = asString(runId);
    if (!id) throw new OrbitError("An orbit run id is required.", "ORBIT_RUN_ID_REQUIRED");
    var current = currentScope("");
    if (current.backend === "local" && !current.known) {
      throw new OrbitError("The active film id is unavailable; refusing to read another film's local orbit.", "ORBIT_SCOPE_UNKNOWN");
    }
    var active = runs.get(id);
    if (active && active.activePromise) {
      assertScope(active, "run-read");
      return active;
    }
    var stored = current.backend === "cloud"
      ? await cloudRead(current, runEntityId(id))
      : await localRead(current, id);
    if (!stored && current.backend === "local" && current.projectId === "local") {
      var globalValue = localMem.get(localGlobalManifestKey(id));
      if (!globalValue) {
        var globalText = await durableLocalText(localGlobalManifestKey(id));
        if (globalText) {
          try { globalValue = JSON.parse(globalText); } catch (e) {}
        }
      }
      stored = decodeStored(globalValue, current);
    }
    assertCurrentScope(current, "run-read");
    if (!stored) throw new OrbitError("Character orbit run " + id + " was not found in this film.", "ORBIT_RUN_NOT_FOUND");
    var run = runFromStored(stored, undefined, false);
    return run;
  }

  async function leaseAcquire(run) {
    var latest = await readRunStored(run);
    assertScope(run, "lease-read");
    if (run.scope.backend === "cloud") {
      var expectedUpdatedAt = run.row && run.row.updated_at;
      var latestUpdatedAt = latest && latest.row && latest.row.updated_at;
      if (expectedUpdatedAt !== latestUpdatedAt) {
        throw new OrbitError("The orbit manifest changed in another tab; refusing to overwrite it.", "ORBIT_MANIFEST_CONFLICT");
      }
    }
    var lease = latest && latest.internal && latest.internal.lease;
    if (lease && lease.token && Number(lease.expiresAt) > now()) {
      throw new OrbitError("This orbit is already being resumed in another tab.", "ORBIT_RUN_BUSY");
    }
    var token = randomId();
    run.internal.lease = { token: token, owner: token, expiresAt: now() + LEASE_MS };
    var saved = await persist(run, "lease-acquire");
    if (!saved) throw new OrbitError("The orbit lease could not be saved.", "ORBIT_LEASE_FAILED");
    // If a non-CAS compatibility adapter returned a different lease, fail closed.
    if (!run.internal.lease || run.internal.lease.token !== token) {
      throw new OrbitError("The orbit lease was taken by another tab.", "ORBIT_RUN_BUSY");
    }
    return token;
  }

  async function leaseRefresh(run) {
    if (!run.internal.lease || !run.internal.lease.token) return;
    run.internal.lease.expiresAt = now() + LEASE_MS;
    await persist(run, "lease-refresh");
  }

  async function leaseRelease(run) {
    if (!run.internal.lease || !run.internal.lease.token) return;
    try {
      var latest = await readRunStored(run);
      assertScope(run, "lease-release-read");
      if (latest && latest.internal && latest.internal.lease &&
          latest.internal.lease.token === run.internal.lease.token &&
          (!run.row || !latest.row || run.row.updated_at === latest.row.updated_at)) {
        run.internal.lease = null;
        await persist(run, "lease-release");
      }
    } catch (e) {
      // Keep the durable lease until expiry if the final release is uncertain.
      // Never issue a second paid generation to compensate for this state.
    }
  }

  async function withWebLock(run, work) {
    var nav = root.navigator;
    if (!nav || !nav.locks || typeof nav.locks.request !== "function") return work();
    var acquired = false;
    var result = await nav.locks.request("character-orbit:" + run.manifest.id, { ifAvailable: true }, function (lock) {
      if (!lock) return undefined;
      acquired = true;
      return work();
    });
    if (!acquired) throw new OrbitError("This orbit is already active in another tab.", "ORBIT_RUN_BUSY");
    return result;
  }

  function wakeStops(run) {
    var waiters = run.stopWaiters.splice(0);
    waiters.forEach(function (resolve) { try { resolve(); } catch (e) {} });
  }

  async function waitUntilVisible(run) {
    var doc = root.document;
    if (!doc || !doc.hidden) return;
    if (run.manifest.status !== "paused") {
      run.manifest.status = "paused";
      await persist(run, "hidden-tab-pause");
      emit(run, "paused");
    }
    while (doc.hidden && !run.stopRequested) {
      await new Promise(function (resolve) {
        var done = function () {
          try { doc.removeEventListener("visibilitychange", done); } catch (e) {}
          var index = run.stopWaiters.indexOf(resolve);
          if (index >= 0) run.stopWaiters.splice(index, 1);
          resolve();
        };
        run.stopWaiters.push(resolve);
        try { doc.addEventListener("visibilitychange", done, { once: true }); } catch (e) {}
      });
    }
    if (run.stopRequested) throw new OrbitStop();
    if (run.manifest.status === "paused") {
      run.manifest.status = "running";
      await persist(run, "visible-tab-resume");
      emit(run, "running");
    }
  }

  function wakeAndRejectStop(run) {
    if (run.stopRequested) throw new OrbitStop();
  }

  async function renderFrame(run, index, masterUrl, poseUrl) {
    assertScope(run, "frame-start");
    await requireCanWrite(run, "frame-preflight");
    await validateQuality(run.manifest.settings);
    assertScope(run, "frame-quality");
    await requireCanWrite(run, "frame-pre-spend");
    var opts = Object.assign({}, outputSettings(run.manifest.settings), {
      referenceImage: masterUrl,
      extraImages: index > 0 ? [poseUrl] : [],
      referenceMaxDim: 1024,
      orbitFrameIndex: index,
      orbitAngle: angle(index),
      orbitRunId: run.manifest.id,
      identityCharacterIds: [run.manifest.characterId],
      identityEpoch: run.epoch,
      noRetry: true,
      beforeSubmit: async function () {
        assertScope(run, "frame-before-submit");
        await requireCanWrite(run, "frame-before-submit");
        if (run.stopRequested || (root.document && root.document.hidden)) throw new OrbitStop();
        if (runs.get(run.manifest.id) !== run) {
          throw new OrbitError("Orbit ownership changed before the paid request.", "ORBIT_RUN_BUSY");
        }
      }
    });
    var generated;
    try {
      generated = await root.nbGenerate(buildPrompt(run, index), opts);
    } catch (e) {
      if (e instanceof OrbitStop || (e && (
        e.code === "ORBIT_STOPPED" || e.code === "ORBIT_SCOPE_CHANGED" ||
        e.code === "ORBIT_WRITE_NOT_ALLOWED" || e.code === "ORBIT_WRITE_NOT_PERMITTED" ||
        e.code === "ORBIT_WRITE_PERMISSION_REQUIRED" || e.code === "ORBIT_RUN_BUSY"))) throw e;
      throw new OrbitError("Orbit frame " + index + " generation failed: " + stringifyError(e),
        "ORBIT_GENERATION_UNCERTAIN", { cause: e, uncertain: true, frameIndex: index });
    } finally {
      // The provider has consumed the refs by the time nbGenerate settles.
      releaseImage(run.sourceId);
      if (index > 0) releaseImage(frameId(run.manifest.id, 0));
    }
    assertScope(run, "frame-after-generate");
    await requireCanWrite(run, "frame-post-generate");
    if (!generated) throw new OrbitError("The image provider returned no orbit frame.", "ORBIT_GENERATION_UNCERTAIN", { uncertain: true, frameIndex: index });
    var frameAssetId = frameId(run.manifest.id, index);
    var meta = {
      kind: "character-orbit-frame",
      orbitRunId: run.manifest.id,
      characterId: run.manifest.characterId,
      frameIndex: index,
      angle: angle(index),
      fps: FPS,
      settings: clone(run.manifest.settings),
      pose: clone(run.manifest.pose),
      sourceReference: sourceReference(run),
      sourceReferenceIds: index > 0 ? [run.sourceId, frameId(run.manifest.id, 0)] : [run.sourceId]
    };
    var commit;
    try {
      await requireCanWrite(run, "frame-pre-commit");
      commit = await root.nbCommit(frameAssetId, generated, meta, referenceMeta(run, index > 0),
        "orbit-frame", run.epoch, function () { return liveCommitCancelled(run); });
    } catch (e) {
      throw new OrbitError("Orbit frame " + index + " could not be committed: " + stringifyError(e),
        "ORBIT_COMMIT_FAILED", { cause: e, uncertain: true, frameIndex: index });
    } finally {
      releaseImage(frameAssetId);
    }
    assertScope(run, "frame-after-commit");
    await requireCanWrite(run, "frame-post-commit");
    if (!isDurableCommit(commit)) {
      var tierMessage = commit && commit.tier === "stale"
        ? "The film changed while the orbit frame was being saved."
        : "The orbit frame save was not confirmed in reload-durable storage.";
      throw new OrbitError(tierMessage, commit && commit.tier === "stale" ? "ORBIT_SCOPE_CHANGED" : "ORBIT_COMMIT_UNCERTAIN",
        { uncertain: true, frameIndex: index, commit: commit });
    }
    return { id: frameAssetId, index: index, angle: angle(index) };
  }

  function markFailure(run, error, index) {
    var uncertain = !!(error && error.uncertain);
    var fatalKind = error && error.code === "ORBIT_REFERENCE_LOAD_FAILED" ? "load" :
      (error && error.code === "ORBIT_COMMIT_FAILED" ? "commit" :
        (error && /AUTH|SIGN|SESSION|PERMISSION/.test(String(error.code || "")) ? "auth" : ""));
    run.manifest.error = stringifyError(error);
    run.manifest.pendingIndex = index == null ? run.manifest.pendingIndex : index;
    run.internal.uncertainIndex = uncertain && index != null ? index : null;
    run.internal.fatal = !!fatalKind;
    run.internal.fatalKind = fatalKind;
    run.manifest.status = uncertain ? "uncertain" : "error";
    emit(run, "error", { error: run.manifest.error, frameIndex: index, uncertain: uncertain, fatalKind: fatalKind });
  }

  async function execute(run) {
    var index = Number(run.manifest.pendingIndex == null ? run.manifest.frames.length : run.manifest.pendingIndex);
    if (index < 0) index = 0;
    var masterUrl;
    try {
      assertScope(run, "resume-start");
      await requireCanWrite(run, "resume-start");
      await validateQuality(run.manifest.settings);
      masterUrl = await ensureFrozenSource(run);
      run.masterUrl = masterUrl;
      // If the tab died during the separately-created first frame, resume only
      // after the caller acknowledges that paid request. This branch never
      // jumps straight into frame 1 with an unverified frame-0 reference.
      if (index === 0 && run.manifest.frames.length === 0) {
        if (run.internal.uncertainIndex == null) {
          run.internal.uncertainIndex = 0;
          run.manifest.status = "rendering";
          await persist(run, "frame-0-start");
        }
        var first = await renderFrame(run, 0, masterUrl, null);
        assertScope(run, "frame-0-result");
        await requireCanWrite(run, "frame-0-result");
        run.manifest.frames.push(first);
        run.manifest.pendingIndex = 1;
        run.manifest.completed = 1;
        run.manifest.complete = false;
        run.manifest.status = "awaiting-confirmation";
        run.manifest.error = null;
        run.internal.uncertainIndex = null;
        await persist(run, "frame-0-saved-after-reload");
        emit(run, "review", { frameIndex: 0, angle: 0 });
        return publicManifest(run.manifest);
      }
      if (index < 1) index = 1; // frame 0 is always created separately and reviewed
      var firstPose = await loadImage(frameId(run.manifest.id, 0), run, "first-pose-load");
      run.firstPoseUrl = firstPose;
      run.manifest.status = "running";
      run.manifest.error = null;
      await persist(run, "run-start");
      emit(run, "running");
      for (; index < FRAME_COUNT; index += 1) {
        wakeAndRejectStop(run);
        await waitUntilVisible(run);
        wakeAndRejectStop(run);
        assertScope(run, "next-frame");
        await requireCanWrite(run, "next-frame");
        await leaseRefresh(run);
        // Durable in-flight marker: a crash/network loss after this write
        // must require explicit acknowledgement before the paid frame is ever
        // attempted again.
        run.internal.uncertainIndex = index;
        run.manifest.status = "rendering";
        await persist(run, "frame-start");
        var frame;
        try {
          frame = await renderFrame(run, index, masterUrl, firstPose);
        } catch (error) {
          if (error instanceof OrbitStop || (error && error.code === "ORBIT_STOPPED")) throw error;
          markFailure(run, error, index);
          try { await persist(run, "frame-failure"); } catch (persistError) {
            run.manifest.error += " Manifest save also failed: " + stringifyError(persistError);
          }
          throw error;
        }
        assertScope(run, "frame-result");
        await requireCanWrite(run, "frame-result");
        run.manifest.frames.push(frame);
        run.manifest.pendingIndex = index + 1;
        run.manifest.completed = run.manifest.frames.length;
        run.manifest.complete = run.manifest.completed === FRAME_COUNT;
        run.manifest.status = run.manifest.complete ? "complete" : "running";
        run.manifest.error = null;
        run.internal.uncertainIndex = null;
        await persist(run, "frame-saved");
        if (index !== FRAME_COUNT - 1) {
          emit(run, "progress", { frameIndex: index, angle: frame.angle });
        }
        if (run.stopRequested) {
          run.manifest.status = "stopped";
          await persist(run, "stopped-after-frame");
          emit(run, "stopped", { frameIndex: index });
          return publicManifest(run.manifest);
        }
      }
      run.manifest.completed = FRAME_COUNT;
      run.manifest.complete = true;
      run.manifest.status = "complete";
      run.manifest.pendingIndex = undefined;
      await persist(run, "complete");
      return publicManifest(run.manifest);
    } catch (error) {
      if (error instanceof OrbitStop || (error && error.code === "ORBIT_STOPPED")) {
        // The beforeSubmit guard can stop after the durable in-flight marker
        // but before the provider accepted a paid request. That marker is not
        // an uncertain spend and must not force acknowledgement on resume.
        run.internal.uncertainIndex = null;
        run.manifest.status = "stopped";
        try { await persist(run, "stopped"); } catch (e) {}
        emit(run, "stopped");
        return publicManifest(run.manifest);
      }
      // Scope/permission failures during setup also need a durable visible stop.
      if (run.manifest.status !== "uncertain" && run.manifest.status !== "error") {
        markFailure(run, error, index);
        try { await persist(run, "run-failure"); } catch (e) {
          run.manifest.error += " Manifest save also failed: " + stringifyError(e);
        }
      }
      throw error;
    } finally {
      run.masterUrl = null;
      run.firstPoseUrl = null;
      releaseImage(run.sourceId);
      releaseImage(frameId(run.manifest.id, 0));
    }
  }

  async function resumeInternal(run, options) {
    options = options || {};
    if (run.activePromise) throw new OrbitError("This orbit is already running.", "ORBIT_RUN_BUSY");
    if (run.manifest.complete || Number(run.manifest.completed) >= FRAME_COUNT ||
        run.manifest.status === "complete") return publicManifest(run.manifest);
    var needsFirstFrameConfirmation = run.manifest.frames.length === 1 &&
      !run.internal.confirmed && !run.manifest.complete;
    if ((run.manifest.status === "awaiting-confirmation" || needsFirstFrameConfirmation) &&
        options.confirmed !== true &&
        !run.internal.confirmed) {
      throw new OrbitError("Review frame 0 and explicitly confirm before rendering the remaining 287 frames.", "ORBIT_CONFIRMATION_REQUIRED");
    }
    if (run.internal.uncertainIndex != null &&
        options.acknowledgeUncertain !== true && options.ackUncertain !== true) {
      throw new OrbitError("An earlier paid frame has uncertain completion. Acknowledge it explicitly before rendering that frame again.", "ORBIT_UNCERTAIN_ACK_REQUIRED", { frameIndex: run.internal.uncertainIndex });
    }
    if (run.internal.fatal && options.retryFailed !== true) {
      throw new OrbitError("The orbit stopped after a " + (run.internal.fatalKind || "save") +
        " failure. Retry only after resolving it and explicitly requesting retryFailed.", "ORBIT_FAILED_RETRY_REQUIRED");
    }
    if (options.confirmed === true) {
      run.internal.confirmed = true;
    }
    if (run.internal.uncertainIndex != null &&
        (options.acknowledgeUncertain === true || options.ackUncertain === true)) {
      run.internal.uncertainIndex = null;
      run.manifest.error = null;
    }
    if (options.retryFailed === true) {
      run.internal.fatal = false;
      run.internal.fatalKind = "";
      run.manifest.error = null;
    }
    if (options.canWrite !== undefined) run.canWrite = options.canWrite;
    await requireCanWrite(run, "resume-permission");
    var work = async function () {
      await leaseAcquire(run);
      try {
        return await execute(run);
      } finally {
        await leaseRelease(run);
        wakeStops(run);
      }
    };
    var promise;
    promise = withWebLock(run, work);
    run.activePromise = promise;
    try {
      var result = await promise;
      if (run.manifest.complete) {
        var finalFrame = run.manifest.frames[run.manifest.frames.length - 1];
        if (finalFrame) {
          var notifyComplete = function () {
            emit(run, "complete");
            emit(run, "progress", { frameIndex: finalFrame.index, angle: finalFrame.angle });
          };
          if (typeof root.setTimeout === "function") root.setTimeout(notifyComplete, 0);
          else notifyComplete();
        }
      }
      return result;
    }
    finally {
      if (run.activePromise === promise) run.activePromise = null;
    }
  }

  async function create(options) {
    options = options || {};
    var character = options.character;
    var characterId = characterIdOf(character);
    if (!characterId) throw new OrbitError("A character id is required to create an orbit.", "ORBIT_CHARACTER_REQUIRED");
    var projectId = getProjectId(options.project);
    if (!projectId) throw new OrbitError("A film/project id is required to create an orbit.", "ORBIT_PROJECT_REQUIRED");
    var scope = currentScope(projectId);
    if (scope.backend === "cloud" && projectId && scope.projectId !== projectId) {
      throw new OrbitError("The selected character belongs to a different film scope.", "ORBIT_SCOPE_CHANGED");
    }
    var settings = snapshotSettings(options.settings);
    var pose = normalizePose(character, options.pose);
    var runId = safePart(characterId) + "-" + randomId();
    var sourceId = sourceIdOf(character);
    if (!sourceId) throw new OrbitError("A generated character master sheet is required before creating an orbit.", "ORBIT_MASTER_REQUIRED");
    var run = makeRun({
      id: runId,
      characterId: characterId,
      characterName: characterNameOf(character),
      pose: deepFreeze(clone(pose)),
      settings: settings,
      canon: deepFreeze(canonClean(clone(character))),
      sourceReference: { id: sourceId, originalId: sourceId, role: "character-master", required: true },
      projectId: scope.projectId,
      createdAt: new Date(now()).toISOString(),
      completed: 0,
      complete: false,
      status: "creating",
      error: null,
      frames: [],
      pendingIndex: 0
    }, {
      lease: null,
      confirmed: false,
      uncertainIndex: null,
      fatal: false,
      fatalKind: "",
      sourceSnapshotPending: false
    }, scope, options.canWrite);
    run.sourceId = sourceId;
    run.originalSourceId = sourceId;
    await requireCanWrite(run, "create-permission");
    // The master must be present before the manifest is created or a paid call is possible.
    var masterUrl = await loadImage(sourceId, run, "master-load");
    run.masterUrl = masterUrl;
    // Capture the currently resolved master metadata as provenance when the
    // image runtime has it synchronously available. The bytes stay in the
    // image store; the orbit manifest only retains this small version hint.
    if (typeof root.nbGetMeta === "function") {
      try {
        var sourceMeta = root.nbGetMeta(sourceId);
        if (sourceMeta) run.manifest.sourceReference = Object.assign(
          {}, run.manifest.sourceReference, { snapshot: canonClean(clone(sourceMeta)) });
      } catch (e) {}
    }
    await requireCanWrite(run, "create-after-master");
    runs.set(runId, run);
    var createWork = async function () {
      await leaseAcquire(run);
      try {
      try {
        await persist(run, "manifest-create");
      // Publish the durable run as soon as its row exists. The first paid
      // frame is still in flight, but UI can mount its progress/review shell
      // before create() eventually resolves with frame 0.
      emit(run, "created", { frameIndex: 0, firstFramePending: true });
      run.internal.sourceSnapshotPending = true;
      await persist(run, "source-snapshot-start");
      masterUrl = await captureSourceSnapshot(run, masterUrl);
      run.internal.uncertainIndex = 0;
      run.manifest.status = "rendering";
      await persist(run, "frame-0-start");
      var frame;
      try {
        frame = await renderFrame(run, 0, masterUrl, null);
      } catch (error) {
        if (error instanceof OrbitStop || (error && error.code === "ORBIT_STOPPED")) throw error;
        markFailure(run, error, 0);
        try { await persist(run, "frame-0-failure"); } catch (e) {}
        throw error;
      }
      run.manifest.frames = [frame];
      run.manifest.pendingIndex = 1;
      run.manifest.status = "awaiting-confirmation";
       run.manifest.completed = 1;
      run.manifest.complete = false;
      run.internal.uncertainIndex = null;
      await persist(run, "frame-0-saved");
      if (run.stopRequested) {
        run.manifest.status = "stopped";
        await persist(run, "stopped-after-frame-0");
        emit(run, "stopped", { frameIndex: 0 });
        return publicManifest(run.manifest);
      }
      emit(run, "review", { frameIndex: 0, angle: 0 });
      return publicManifest(run.manifest);
      } catch (error) {
        if (error instanceof OrbitStop || (error && error.code === "ORBIT_STOPPED")) {
          run.internal.uncertainIndex = null;
          run.manifest.status = "stopped";
          try { await persist(run, "stopped"); } catch (e) {}
          emit(run, "stopped");
          return publicManifest(run.manifest);
        }
        throw error;
      }
      } finally {
        await leaseRelease(run);
        wakeStops(run);
      }
    };
    var lockedCreatePromise = withWebLock(run, createWork);
    run.activePromise = lockedCreatePromise;
    try {
      return await lockedCreatePromise;
    } finally {
      if (run.activePromise === lockedCreatePromise) run.activePromise = null;
      run.masterUrl = null;
      releaseImage(sourceId);
      releaseImage(frameId(runId, 0));
    }
  }

  async function resume(runId, options) {
    options = options || {};
    var run = await loadRun(runId, options.canWrite);
    if (options.canWrite !== undefined) run.canWrite = options.canWrite;
    return resumeInternal(run, options);
  }

  async function stop(runId) {
    var run = runs.get(asString(runId));
    if (!run || !run.activePromise) {
      var loaded = await loadRun(runId);
      if (loaded.internal && loaded.internal.lease &&
          Number(loaded.internal.lease.expiresAt) > now()) {
        throw new OrbitError("This orbit is active in another tab and cannot be stopped here.", "ORBIT_RUN_BUSY");
      }
      // A tab that did not own the live run has no canWrite predicate and must
      // not silently mutate its durable manifest. The owning tab's stop path
      // below waits for the in-flight provider/commit to settle.
      return publicManifest(loaded.manifest);
    }
    run.stopRequested = true;
    wakeStops(run);
    var promise = run.activePromise;
    try { await promise; } catch (e) {
      if (!(e instanceof OrbitStop) && (!e || e.code !== "ORBIT_STOPPED")) throw e;
    }
    return publicManifest(run.manifest);
  }

  async function confirm(runId, options) {
    options = options || {};
    var run = await loadRun(runId, options.canWrite);
    if (run.manifest.status !== "awaiting-confirmation") return publicManifest(run.manifest);
    if (options.canWrite !== undefined) run.canWrite = options.canWrite;
    run.internal.confirmed = true;
    await requireCanWrite(run, "confirmation");
    run.manifest.status = "stopped";
    await persist(run, "confirmation");
    emit(run, "confirmed");
    return publicManifest(run.manifest);
  }

  async function get(runId) {
    var run = await loadRunForRead(runId);
    return publicManifest(run.manifest);
  }

  async function frame(runOrId, index) {
    var run = typeof runOrId === "string" ? await loadRunForRead(runOrId) :
      (runOrId && runOrId.manifest ? runOrId : await loadRunForRead(runOrId && runOrId.id));
    assertScope(run, "frame-read");
    var n = checkFrameIndex(index);
    var item = run.manifest.frames.find(function (f) { return Number(f.index) === n; });
    if (!item || !item.id) throw new OrbitError("Orbit frame " + n + " has not been rendered.", "ORBIT_FRAME_MISSING");
    var loader = typeof root.nbLoadImage === "function" ? root.nbLoadImage :
      (typeof root.nbGetImage === "function" ? function (id) { return root.nbGetImage(id); } : null);
    if (!loader) throw new OrbitError("The image loader is unavailable for orbit export.", "ORBIT_LOAD_UNAVAILABLE");
    var value = await loader(item.id);
    assertScope(run, "frame-read");
    if (!value) throw new OrbitError("Orbit frame " + n + " could not be loaded in the original film.", "ORBIT_FRAME_LOAD_FAILED");
    // A cloud reload may materialize an IndexedDB byte cache as a blob URL.
    // Turn that one URL into a Blob before releasing the cache entry; ordinary
    // data/signed URLs remain valid after their hot-cache entry is dropped.
    if (/^blob:/i.test(String(value)) && typeof root.fetch === "function") {
      try {
        var response = await root.fetch(value);
        var blob = response && typeof response.blob === "function" ? await response.blob() : null;
        assertScope(run, "frame-read");
        releaseImage(item.id);
        if (blob) return blob;
      } catch (e) {
        assertScope(run, "frame-read");
        releaseImage(item.id);
        throw new OrbitError("Orbit frame " + n + " could not be materialized for export.", "ORBIT_FRAME_LOAD_FAILED", { cause: e });
      }
    }
    if (!/^blob:/i.test(String(value))) releaseImage(item.id);
    return value;
  }

  async function list(characterId) {
    var wanted = characterId == null ? null : asString(characterId);
    var scope = currentScope("");
    if (scope.backend === "local" && !scope.known) {
      throw new OrbitError("The active film id is unavailable; refusing to list another film's local orbit.", "ORBIT_SCOPE_UNKNOWN");
    }
    var stored;
    if (scope.backend === "cloud") {
      var sb = cloudClient();
      if (sb && typeof sb.from === "function") {
        var prefix = RUN_PREFIX + (wanted ? safePart(wanted) + "-" : "");
        var response = await sb.from("turn_generations").select("*").eq("project_id", scope.projectId).like("entity_id", prefix + "%");
        assertCurrentScope(scope, "orbit-list");
        if (response && response.error) throw new OrbitError(response.error.message || "Cloud orbit list failed.", "ORBIT_LIST_FAILED");
        stored = (response.data || []).map(function (row) { return decodeStored(row, scope); }).filter(Boolean);
      } else {
        // A narrow helper is preferable to treating a failed cloud query as "no runs".
        if (typeof root.cloudListOrbitRuns !== "function") throw new OrbitError("Cloud orbit listing is unavailable.", "ORBIT_LIST_UNAVAILABLE");
        var rows = await root.cloudListOrbitRuns(scope.projectId, wanted);
        assertCurrentScope(scope, "orbit-list");
        stored = (rows || []).map(function (row) { return decodeStored(row, scope); }).filter(Boolean);
      }
    } else {
      stored = await localList(scope);
    }
    return stored.filter(function (item) {
      return !wanted || String(item.manifest.characterId) === wanted;
    }).map(function (item) { return publicManifest(item.manifest); })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  function quote(settings, count) {
    var snap = snapshotSettings(settings || {});
    var n = count == null ? FRAME_COUNT : Number(count);
    if (!Number.isInteger(n) || n < 0 || n > FRAME_COUNT) {
      throw new OrbitError("Orbit quote count must be from 0 through 288.", "ORBIT_QUOTE_COUNT_INVALID");
    }
    var per = null;
    if (typeof root.nbImageCredits === "function") {
      per = root.nbImageCredits({ model: snap.model, quality: snap.quality, res: snap.res });
    }
    var usdPer = null;
    if (typeof root.turnImageProviderUsdTable === "function") {
      var table = root.turnImageProviderUsdTable() || {};
      var rates = table[snap.model];
      if (rates) {
        if (/^gpt-image/i.test(snap.model)) {
          var q = snap.quality === "default" ? "high" : snap.quality === "auto" ? "max" : snap.quality;
          usdPer = rates[q] == null ? null : Number(rates[q]);
        } else usdPer = rates[snap.res] == null ? Number(rates["2K"]) : Number(rates[snap.res]);
      }
    }
    if (per == null && usdPer != null) {
      per = typeof root.turnCreditsFromProviderUsd === "function"
        ? root.turnCreditsFromProviderUsd(usdPer)
        : usdPer / 0.30 * (Number(root.CREDIT_SCALE) || 1);
    }
    var totalCredits = per == null ? null : (n === 0 ? 0 : Math.max(1, Math.ceil(Number(per) * n)));
    return {
      count: n,
      frameCount: n,
      model: snap.model,
      quality: snap.quality,
      res: snap.res,
      aspect: snap.aspect,
      perFrameCredits: per == null ? null : Number(per),
      credits: totalCredits,
      usdPerFrame: usdPer,
      usd: usdPer == null ? null : Number((usdPer * n).toFixed(6)),
      estimate: true,
      note: "Estimate for distinct AI-rendered frames; provider pricing and prompt/reference size can vary."
    };
  }

  function suggestPose(character) {
    character = character || {};
    var id = characterIdOf(character) || characterNameOf(character);
    var fieldText = function (value) {
      if (value == null || value === "") return "";
      if (Array.isArray(value)) return value.map(asString).filter(Boolean).join("; ");
      if (typeof value === "object") {
        return Object.keys(value).map(function (key) {
          return key + ": " + asString(value[key]);
        }).filter(Boolean).join("; ");
      }
      return asString(value);
    };
    // These are the character-card canon fields, not a second paid writing
    // call. Keeping their labels in the editable result makes the reasoning
    // behind the physical direction inspectable and correctable in the UI.
    var canonFields = [
      ["conscious", character.conscious],
      ["unconscious", character.unconscious || character.unconsciousNeed],
      ["dimensions", character.dimensions],
      ["contradictions", character.contradictions],
      ["voiceDNA", character.voiceDNA || character.voiceDna],
      ["signatureExpressions", character.signatureExpressions || character.signatureExpression],
      ["coreBody", character.coreBody || character.body || character.physique],
      ["role", character.role],
      ["wants", character.wants || character.goal],
      ["personality", character.personality || character.traits]
    ].map(function (entry) {
      var value = fieldText(entry[1]);
      return value ? entry[0] + ": " + value : "";
    }).filter(Boolean);
    var text = canonFields.join(" · ");
    var lower = text.toLowerCase();
    var hash = 0;
    for (var i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    var families = [
      {
        key: "cautious",
        words: /\b(cautious|guarded|wary|anxious|fear|doubt|suspicious|careful|avoid)\b/,
        cues: [
          "keep the weight slightly back and the torso contained, with the gaze attentive rather than performative",
          "hold a compact grounded stance with a small protective turn through the shoulders and no theatrical tension",
          "stay still and ready, feet stable and posture economical, as if measuring the next safe move"
        ]
      },
      {
        key: "defiant",
        words: /\b(defiant|rebel|rebellious|angry|rage|resist|stubborn|justice|fight|oppos)\b/,
        cues: [
          "place the weight subtly forward with a level chin and a steady stance that refuses to yield",
          "square the existing silhouette without puffing up, letting stillness carry the resistance",
          "lead with one shoulder by a small degree and keep the body planted, controlled and unafraid"
        ]
      },
      {
        key: "compassionate",
        words: /\b(compassion|kind|empathetic|care|protect|tender|mercy|love|gentle)\b/,
        cues: [
          "keep the torso open and the shoulders unguarded, with a calm posture that makes room for another person",
          "settle into a patient balanced stance, soft through the shoulders but not passive",
          "let the body lean a fraction toward connection while the face remains true to the source identity"
        ]
      },
      {
        key: "analytical",
        words: /\b(analytical|logic|logical|curious|observe|intellect|strateg|solve|precise|science)\b/,
        cues: [
          "hold a measured balanced stance with the head angled only slightly as if testing a hypothesis",
          "keep the posture precise and economical, attention forward without a staged expression",
          "stand very still with a small deliberate shift of weight that suggests active assessment"
        ]
      },
      {
        key: "playful",
        words: /\b(playful|funny|humor|mischief|joy|curious|tease|charm|witty)\b/,
        cues: [
          "use a relaxed asymmetry and a light shift through the shoulders, suggesting wit without a broad pose",
          "let the stance loosen by a fraction and keep the energy buoyant but physically restrained",
          "hold a grounded pose with a slight ready-to-move imbalance, playful rather than cartoonish"
        ]
      },
      {
        key: "commanding",
        words: /\b(command|leader|authority|decisive|control|power|duty|discipline|queen|king|captain)\b/,
        cues: [
          "center the weight beneath the existing silhouette and let the upright stillness carry authority",
          "hold a clear stable stance with the shoulders composed and the chin naturally level",
          "stand with deliberate economy and quiet command, never an exaggerated hero pose"
        ]
      }
    ];
    var family = families.find(function (item) { return item.words.test(lower); }) ||
      { key: "grounded", cues: [
        "keep the existing anatomy grounded and economical, with a restrained asymmetry that can repeat across the orbit",
        "use a calm neutral stance with one subtle shift of weight, never a generic heroic pose",
        "hold a filmable repeatable posture whose tension comes from the canon, not from invented props or anatomy"
      ] };
    var cue = family.cues[hash % family.cues.length];
    var action = "personality family: " + family.key + "; " + cue;
    var canon = ("Personality-grounded fixed pose for " + characterNameOf(character) +
      (text ? " — " + text.slice(0, 720) : "") + ".");
    return {
      direction: canon + " " + action + ". Preserve the character sheet's existing anatomy, silhouette, wardrobe and accessories exactly; add no prop or body part.",
      canon: canon,
      gesture: action,
      text: canon + " " + action + ".",
      editable: true,
      source: "local-canon"
    };
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new OrbitError("Orbit subscriber must be a function.", "ORBIT_LISTENER_INVALID");
    listeners.add(listener);
    return function () { listeners.delete(listener); };
  }

  var API = {
    FRAME_COUNT: FRAME_COUNT,
    FPS: FPS,
    angle: angle,
    suggestPose: suggestPose,
    quote: quote,
    list: list,
    create: create,
    resume: resume,
    stop: stop,
    confirm: confirm,
    get: get,
    frame: frame,
    subscribe: subscribe
  };
  root.CharacterOrbit = API;
})(typeof window !== "undefined" ? window : globalThis);
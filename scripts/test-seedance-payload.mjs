import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import {
  seedanceCapabilities,
  validateSeedanceRequest,
} from "../supabase/functions/image-proxy/seedance-capabilities.mjs";

const proxySource = readFileSync("supabase/functions/image-proxy/index.ts", "utf8");
const url = (kind, n) => `https://media.example/${kind}-${n}`;
const facts = (count, durationSeconds = undefined) =>
  Array.from({ length: count }, () => ({
    ...(durationSeconds == null ? {} : { durationSeconds }),
    sizeBytes: 1024,
    mime: "application/octet-stream",
  }));
const valid = {
  model: "bytedance/seedance-2.5/reference-to-video",
  duration: 30,
  resolution: "1080p",
  aspectRatio: "16:9",
  bitrateMode: "high",
  prompt: "@Image1 follows @Video1 while @Audio1 plays.",
  images: [url("image", 1)],
  videos: [url("video", 1)],
  audios: [url("audio", 1)],
  metadata: { images: facts(1), videos: facts(1, 10), audios: facts(1, 10) },
};

assert.deepEqual(seedanceCapabilities(valid.model).resolutions, ["480p", "720p", "1080p"]);
assert.deepEqual(
  seedanceCapabilities("bytedance/seedance-2.0/fast/reference-to-video").resolutions,
  ["480p", "720p"],
);
assert.equal(validateSeedanceRequest(valid).ok, true);

let paidTransportCalls = 0;
const mockedSubmit = async (payload) => {
  const checked = validateSeedanceRequest(payload);
  if (!checked.ok) return { status: 400, error: checked.errors.join("; ") };
  paidTransportCalls++;
  return { status: 200, requestId: "mock-request" };
};

const tooMany = {
  ...valid,
  images: Array.from({ length: 31 }, (_, i) => url("image", i)),
  metadata: { ...valid.metadata, images: facts(31) },
};
assert.equal((await mockedSubmit(tooMany)).status, 400);
assert.equal(paidTransportCalls, 0, "invalid packages must not reach paid transport");

const unresolved = {
  ...valid,
  metadata: { ...valid.metadata, videos: [{}] },
};
const unresolvedResult = await mockedSubmit(unresolved);
assert.equal(unresolvedResult.status, 400);
assert.match(unresolvedResult.error, /duration is unresolved/);
assert.equal(paidTransportCalls, 0);

const dangling = { ...valid, prompt: "Use @Image2." };
const danglingResult = await mockedSubmit(dangling);
assert.equal(danglingResult.status, 400);
assert.match(danglingResult.error, /no matching image reference/);

const fastWrongResolution = {
  ...valid,
  model: "bytedance/seedance-2.0/fast/reference-to-video",
  duration: 15,
  resolution: "1080p",
  videos: [],
  audios: [],
  prompt: "@Image1 moves.",
  metadata: { images: facts(1), videos: [], audios: [] },
};
assert.equal((await mockedSubmit(fastWrongResolution)).status, 400);

const ok = await mockedSubmit(valid);
assert.equal(ok.status, 200);
assert.equal(paidTransportCalls, 1);

// Exercise the real browser money-path through seedanceGenerate → sb.functions.invoke.
// Signed media URLs are metadata-probed by HTMLMediaElement; they are not fetched merely
// to discover duration, so cross-origin response-body CORS is not newly required.
const submitted = [];
let pollFailure = null;
let pollTransportError = null;
let submitHttpFailure = null;
let recoveryPollGate = null;
let submitAttempts = 0;
let storageWriteFailure = false;
let failPendingWriteAfterSubmit = false;
let expectReservationAtSubmit = false;
let reservationObservedAtSubmit = false;
const appToasts = [];
const attemptedSubmitBodies = [];
const store = new Map();
const sandbox = {
  console, Date, Math, JSON, Promise,
  setTimeout: (fn, ms) => { if (ms < 3000) queueMicrotask(fn); return 0; },
  clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => {
      if (storageWriteFailure) throw new Error("QuotaExceededError");
      if (failPendingWriteAfterSubmit && k === "turn_vid_pending")
        throw new Error("unexpected pending write failure");
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
  },
  navigator: { userAgent: "seedance-test" },
  location: { href: "", origin: "https://app.example" },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  React: new Proxy({}, { get: () => () => null }),
  fetch: async () => { throw new Error("signed media body fetch intentionally unavailable"); },
  document: {
    createElement: (kind) => {
      if (kind === "audio" || kind === "video") {
        const media = {
          duration: 5.2, preload: "", muted: false,
          removeAttribute: () => {}, load: () => {},
          set src(value) {
            const match = String(value).match(/[?&]dur=([0-9.]+)/);
            if (match) media.duration = Number(match[1]);
            queueMicrotask(() => media.onloadedmetadata?.());
          },
        };
        return media;
      }
      return { getContext: () => ({ fillStyle: "", fillRect: () => {} }) };
    },
  },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
  appToast: (message, kind) => appToasts.push({ message, kind }),
  TURN_SUPABASE: { imageProxy: true, imageProxyFn: "image-proxy" },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.sbClient = () => ({
  functions: {
    invoke: async (_name, { body }) => {
      if (body.op === "capabilities") {
        return { data: {
          known: true,
          schema: "seedance-capabilities-2026-08-18",
          capabilities: {
            resolutions: ["480p", "720p", "1080p"],
          },
        } };
      }
      if (body.op === "submit") {
        submitAttempts++;
        attemptedSubmitBodies.push(body);
        if (expectReservationAtSubmit)
          reservationObservedAtSubmit = Array.from(store.keys())
            .some(key => key.startsWith("turn_vid_pending_reservation:"));
        if (submitHttpFailure) return { data: null, error: submitHttpFailure };
        submitted.push(body);
        return { data: { requestId: "actual-path", statusUrl: "https://queue.fal.run/status", responseUrl: "https://queue.fal.run/result", status: "IN_QUEUE" } };
      }
      if (body.op === "poll") {
        if (recoveryPollGate) return recoveryPollGate();
        if (pollTransportError) return { data: null, error: pollTransportError };
        return pollFailure
        ? { data: pollFailure }
        : { data: { status: "COMPLETED", videoUrl: "https://media.example/result.mp4" } };
      }
      return { data: {} };
    },
  },
});
vm.createContext(sandbox);
for (const file of ["app/shot-screenplay.js", "app/shot-scene-context.js", "app/stage-screenplay.js"]) {
  vm.runInContext(readFileSync(file, "utf8"), sandbox, { filename: file });
}
const compiled = transformSync(readFileSync("app/videogen.jsx", "utf8"), {
  presets: ["@babel/preset-react"],
  filename: "app/videogen.jsx",
}).code;
vm.runInContext(compiled, sandbox, { filename: "app/videogen.jsx" });

/* The Stage worker receives this immutable, text-only snapshot from
   stage-screenplay.js.  Keep the ending deliberately distinctive: a
   provider payload that loses the tail has lost source. */
const screenplayReference = Object.freeze({
  schema: "cm-stage-screenplay-v1",
  kind: "screenplay",
  delivery: "prompt-text",
  sceneId: "scene-stage-7",
  sceneNo: 7,
  sceneTitle: "The Brass Key",
  sourceRev: "source-rev-a",
  fullText: [
    "[BEAT 1 · ACTION] MARCUS enters carrying the brass key.",
    "[BEAT 2 · ACTION] He crosses the room and opens the desk.",
    "[BEAT 3 · ACTION] DANIEL's phone buzzes from the hallway.",
    "THE END — preserve this final authored line."
  ].join("\n"),
  targetBeats: [2],
  targetText: "[BEAT 2 · ACTION] He crosses the room and opens the desk.",
  hasSource: true,
  errors: [],
  signature: "screenplay-signature-a",
});
const screenplayBlock = sandbox.stageScreenplayPrompt(screenplayReference);
const editedPrompt = "EDITED USER PROMPT: hold the doorway, then pan to the desk.";
const appendedPrompt = sandbox.stageAppendScreenplayReference(editedPrompt, screenplayReference);
assert.ok(appendedPrompt.startsWith(editedPrompt), "screenplay delivery must keep the edited user prompt");
assert.ok(appendedPrompt.includes(screenplayReference.fullText), "full scene screenplay must be present verbatim");
assert.ok(appendedPrompt.includes(screenplayReference.targetText), "target beat screenplay must be explicit");
assert.ok(appendedPrompt.includes("DANIEL's phone buzzes"), "another beat must remain context-only source");
assert.ok(appendedPrompt.includes(screenplayReference.fullText), "the full-scene ending must reach the final prompt");
assert.equal((appendedPrompt.split(screenplayBlock).length - 1), 1, "reference block is appended once");
assert.equal(sandbox.stageAppendScreenplayReference(appendedPrompt, screenplayReference), appendedPrompt,
  "exact screenplay block is deduplicated");
assert.equal(Object.isFrozen(screenplayReference), true, "caller screenplay snapshot is not mutated");

await sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.0/fast/reference-to-video",
  frameUrl: "https://signed.example/frame.png?token=x",
  videoUrls: ["https://signed.example/reference.mp4?token=x"],
  audioUrl: "https://signed.example/voice.wav?token=x",
  prompt: "@Image1, follow @Video1 and speak @Audio1.",
  durationMs: 5200,
  resolution: "480p",
  fast: true,
  pollMs: 1,
  maxPolls: 1,
});
assert.equal(submitted.length, 1);
assert.equal(submitted[0].duration, 6, "fractional Stage duration must ceil, not truncate content");
assert.equal(submitted[0].resolution, "480p", "official fast schema supports 480p");
assert.equal(submitted[0].referenceMetadata.videos[0].durationSeconds, 5.2);
assert.equal(submitted[0].referenceMetadata.audios[0].durationSeconds, 5.2);

/* Full screenplay text is delivered on the normal reference route and stored
   as take provenance, without becoming an accidental image/video reference. */
const referenceSubmitStart = submitted.length;
await sandbox.seedanceGenerate("stage-reference-clip", {
  falModel: "bytedance/seedance-2.0/reference-to-video",
  frameUrl: "https://signed.example/stage-frame.png?token=x",
  prompt: editedPrompt,
  controls: "Camera movement: slow push-in.",
  screenplayReference,
  assertScreenplayCurrent: () => true,
  durationMs: 4000,
  resolution: "720p",
  pollMs: 1,
  maxPolls: 1,
});
assert.equal(submitted.length, referenceSubmitStart + 1);
assert.ok(submitted.at(-1).prompt.includes("Camera movement: slow push-in."));
assert.ok(submitted.at(-1).prompt.includes(screenplayReference.fullText));
assert.ok(submitted.at(-1).prompt.includes(screenplayReference.fullText));
assert.deepEqual(Array.from(submitted.at(-1).image_urls), ["https://signed.example/stage-frame.png?token=x"]);
assert.deepEqual(Array.from(submitted.at(-1).video_urls || []), [],
  "screenplay context must never become a video reference");
const referenceMeta = sandbox.vidGetMeta("stage-reference-clip");
assert.equal(referenceMeta.screenplayReference.fullText, screenplayReference.fullText);
assert.equal(referenceMeta.screenplayReference.targetText, screenplayReference.targetText);
assert.equal(referenceMeta.actualPrompt, submitted.at(-1).prompt);
assert.equal(referenceMeta.prompt, submitted.at(-1).prompt);

/* Screenplay page images are complete, actual image references — not metadata
   claims. They remain in the provider payload as PNG data and receive an
   explicit reading-context guard instead of becoming a start-frame prompt. */
const pagePng1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pagePng2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+g8AAQUBAScY42YAAAAASUVORK5CYII=";
const screenplayImages = [
  { id:"page-1", url:pagePng1, label:"Page 1", page:1, totalPages:2,
    sourceSignature:screenplayReference.signature, targetBeats:screenplayReference.targetBeats },
  { id:"page-2", url:pagePng2, label:"Page 2", page:2, totalPages:2,
    sourceSignature:screenplayReference.signature, targetBeats:screenplayReference.targetBeats },
];
const pageSubmitStart = submitted.length;
expectReservationAtSubmit = true;
const pageResult = await sandbox.seedanceGenerate("screenplay-page-images", {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  prompt: "Perform only the selected doorway beat from the screenplay.",
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  takeMeta: {
    references: [
      { kind:"image", label:"Page 1", url:pagePng1 },
      { kind:"image", label:"Page 2", url:pagePng2 },
      { kind:"image", label:"Character", url:"https://signed.example/character.png" },
    ],
  },
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
expectReservationAtSubmit = false;
assert.equal(submitted.length, pageSubmitStart + 1);
assert.equal(pageResult.pendingPersistenceWarning, undefined,
  "normal provider fields must fit after the conservative reservation");
assert.equal(reservationObservedAtSubmit, true,
  "a successful page render must hold its localStorage reservation through submit");
const pageSubmit = submitted.at(-1);
assert.deepEqual(Array.from(pageSubmit.image_urls), [pagePng1, pagePng2],
  "actual screenplay page PNGs must be forwarded as image references");
assert.match(pageSubmit.prompt, /reading context/i);
assert.match(pageSubmit.prompt, /NEVER (?:photograph|animate)/i);
assert.match(pageSubmit.prompt, /captions/i);
assert.match(pageSubmit.prompt, /borders/i);
assert.match(pageSubmit.prompt, /not visual composition/i);
assert.match(pageSubmit.prompt, /not.*cast/i);
assert.match(pageSubmit.prompt, /permission/i);
const pageMeta = sandbox.vidGetMeta("screenplay-page-images");
assert.deepEqual(JSON.parse(JSON.stringify(pageMeta.screenplayImages)), screenplayImages);
assert.deepEqual(pageMeta.screenplayImageSnapshots.map(x => x.proxyInputUrl || pageMeta.screenplayImages.find(p => p.id === x.id)?.url), [pagePng1, pagePng2]);
assert.equal(Object.prototype.hasOwnProperty.call(pageMeta.screenplayImageSnapshots[0], "proxyInputUrl"), false,
  "unchanged PNGs use screenplayImages as the single canonical byte copy");
assert.equal(Object.prototype.hasOwnProperty.call(pageMeta.references[0], "url"), false,
  "page URLs must not be duplicated in take reference metadata");
assert.equal(pageMeta.references[0].screenplayImageId, "page-1");
assert.equal(pageMeta.references[2].url, "https://signed.example/character.png");
const pendingReservationKeys = () =>
  Array.from(store.keys()).filter(key => key.startsWith("turn_vid_pending_reservation:"));
assert.deepEqual(pendingReservationKeys(), [],
  "successful completion must release the actual localStorage reservation marker");

const fullPendingLedger = Array.from({ length: 20 }, (_, i) => ({
  requestId: `paid-old-${i}`, id: `old-clip-${i}`, model: "seedance",
  statusUrl: `https://queue.example/status/${i}`,
  responseUrl: `https://queue.example/result/${i}`, at: Date.now(),
  meta: { old: true },
}));
sandbox.localStorage.setItem("turn_vid_pending", JSON.stringify(fullPendingLedger));
const ledgerSubmitStart = submitAttempts;
await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  prompt: "A full pending ledger must refuse before submit.",
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p",
}), /20 pending paid renders/i);
assert.equal(submitAttempts, ledgerSubmitStart,
  "a full pending ledger must reject before provider submit");
assert.deepEqual(JSON.parse(store.get("turn_vid_pending")), fullPendingLedger,
  "full-ledger refusal must not evict older paid work");
sandbox.localStorage.setItem("turn_vid_pending", "[]");

const refusalSubmitStart = submitAttempts;
submitHttpFailure = { message: "intentional transport refusal" };
await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  prompt: "Refusal must release its page reservation.",
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p",
}), /intentional transport refusal|Couldn't confirm/i);
submitHttpFailure = null;
assert.equal(submitAttempts, refusalSubmitStart + 1);
assert.deepEqual(pendingReservationKeys(), [],
  "submit refusal must release the actual localStorage reservation marker");

const cancelSubmitStart = submitAttempts;
await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  prompt: "Cancellation must release its page reservation.",
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true, shouldCancel: () => true,
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
}), /cancelled/i);
assert.deepEqual(pendingReservationKeys(), [],
  "cancellation must release the actual localStorage reservation marker");
assert.equal(submitAttempts, cancelSubmitStart,
  "cancellation before submit must not invoke paid transport");
sandbox.localStorage.setItem("turn_vid_pending", "[]");

const storageRejectSubmitStart = submitAttempts;
storageWriteFailure = true;
await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  prompt: "Unavailable storage must not spend.",
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p",
}), /pending-render storage is unavailable or full/i);
storageWriteFailure = false;
assert.equal(submitAttempts, storageRejectSubmitStart,
  "unavailable/full localStorage must reject required-image renders before provider submit");
assert.deepEqual(pendingReservationKeys(), []);

failPendingWriteAfterSubmit = true;
const unexpectedStorageSubmitStart = submitAttempts;
const unexpectedStorageResult = await sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  prompt: "Unexpected pending persistence failure must keep polling.",
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
failPendingWriteAfterSubmit = false;
assert.equal(submitAttempts, unexpectedStorageSubmitStart + 1);
assert.equal(unexpectedStorageResult.pendingPersistenceWarning, true,
  "post-submit pending persistence failure must be surfaced without aborting the paid poll");
assert.match(appToasts.at(-1)?.message || "", /submitted.*crash-recovery.*live polling/i);

/* An empty prompt with document pages first must never invent motion for
   @Image1. With a real video reference available, the generic fallback names
   that actual visual; documents remain reading context only. */
const fallbackSubmitStart = submitted.length;
await sandbox.seedanceGenerate("screenplay-page-fallback", {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  videoUrls: ["https://signed.example/actual-visual.mp4?dur=5.2"],
  audioUrls: ["https://signed.example/fallback-voice.wav?dur=5.2"],
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
assert.equal(submitted.length, fallbackSubmitStart + 1);
assert.match(submitted.at(-1).prompt, /@Video1 comes alive/i);
assert.doesNotMatch(submitted.at(-1).prompt, /@Image1 comes alive/i);

const pageGuardSubmitStart = submitted.length;
const giantPagePng = "data:image/png;base64," + "A".repeat(1_600_000);
await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [giantPagePng],
  prompt: "Perform the selected beat.",
  screenplayReference, screenplayImages: [{
    id:"giant-page", url:giantPagePng, label:"Giant page", page:1, totalPages:1,
    sourceSignature:screenplayReference.signature, targetBeats:screenplayReference.targetBeats,
  }], screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p",
}), /too large to retain safely.*crash recovery/i);
assert.equal(submitted.length, pageGuardSubmitStart,
  "oversized pending provenance must be rejected before paid submit");

const rejectPage = async (options, expected) => {
  await assert.rejects(sandbox.seedanceGenerate(null, {
    falModel: "bytedance/seedance-2.5/reference-to-video",
    prompt: "Perform the selected beat.",
    screenplayReference, screenplayImages, screenplayImagesRequired:true,
    assertScreenplayCurrent: () => true,
    durationMs: 4000, resolution: "720p", ...options,
  }), expected);
  assert.equal(submitted.length, pageGuardSubmitStart,
    "screenplay image guard failures must not reach paid submit");
};
await rejectPage({
  imageUrls: [pagePng1],
}, /complete page set|complete screenplay page|actual imageUrls/i);
await rejectPage({
  imageUrls: [pagePng1, pagePng2],
  screenplayImages: screenplayImages.map(page => ({ ...page, sourceSignature:"stale-signature" })),
}, /mismatched source signature|stale/i);
await rejectPage({
  imageUrls: [],
}, /not present in the actual imageUrls payload/i);
await rejectPage({
  falModel: "fal-ai/sora-2/image-to-video",
  imageUrls: [pagePng1, pagePng2],
}, /one start image|cannot consume screenplay page images/i);
await rejectPage({
  imageUrls: [pagePng1, pagePng2],
  frameUrl: "https://signed.example/real-start.png",
  endImageUrl: "https://signed.example/real-end.png",
}, /transition.*screenplay page|cannot consume screenplay page/i);
await rejectPage({
  imageUrls: [pagePng1, pagePng2],
  textOnly: true,
}, /text-only.*discard|required screenplay page/i);
await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  imageUrls: [pagePng1, pagePng2],
  screenplayReference, screenplayImages, screenplayImagesRequired:true,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p",
}), /only screenplay page images needs an explicit video direction/i);
assert.equal(submitted.length, pageGuardSubmitStart,
  "promptless document-only requests must fail before paid submit");

let settlementFreshnessCalls = 0;
await sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.0/reference-to-video",
  frameUrl: "https://signed.example/settlement-frame.png?token=x",
  prompt: "Settlement must finish even after source edits.",
  screenplayReference,
  assertScreenplayCurrent: () => {
    settlementFreshnessCalls++;
    if(settlementFreshnessCalls>3) throw new Error("late screenplay check must not affect settlement");
  },
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
assert.equal(settlementFreshnessCalls, 3, "freshness is checked through submit, not after paid completion");

/* Full-scene/target edits invalidate the cache hash instead of reusing a
   completed take, while the legacy no-reference path remains cacheable. */
const editedReference = {
  ...screenplayReference,
  fullText: screenplayReference.fullText.replace("opens the desk", "locks the desk"),
  targetBeats: [3],
  targetText: "[BEAT 3 · ACTION] DANIEL's phone buzzes from the hallway.",
  sourceRev: "source-rev-b",
  signature: "screenplay-signature-b",
};
const hashSubmitStart = submitted.length;
await sandbox.seedanceGenerate("stage-reference-clip", {
  falModel: "bytedance/seedance-2.0/reference-to-video",
  frameUrl: "https://signed.example/stage-frame.png?token=x",
  prompt: editedPrompt,
  screenplayReference: editedReference,
  assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
assert.equal(submitted.length, hashSubmitStart + 1, "edited full scene/targets must change the cache hash");

/* Invalid source, missing helper, and stale source all fail before paid
   transport.  The freshness callback is also exercised after preparation and
   at the final submit boundary. */
const submitsBeforeReferenceGuards = submitted.length;
await assert.rejects(
  sandbox.seedanceGenerate("bad-screenplay", {
    falModel: "bytedance/seedance-2.0/reference-to-video",
    frameUrl: "https://signed.example/bad.png", prompt: "bad",
    screenplayReference: { ...screenplayReference, hasSource: false },
    assertScreenplayCurrent: () => true, durationMs: 4000, resolution: "720p",
  }),
  /no current screenplay source/,
);
const helperForGuard = sandbox.stageAppendScreenplayReference;
sandbox.stageAppendScreenplayReference = null;
await assert.rejects(
  sandbox.seedanceGenerate("missing-helper", {
    falModel: "bytedance/seedance-2.0/reference-to-video",
    frameUrl: "https://signed.example/bad.png", prompt: "bad",
    screenplayReference, assertScreenplayCurrent: () => true,
    durationMs: 4000, resolution: "720p",
  }),
  /helper is unavailable|Reload Stage/,
);
sandbox.stageAppendScreenplayReference = helperForGuard;
let preparedFreshnessCalls = 0;
await assert.rejects(
  sandbox.seedanceGenerate(null, {
    falModel: "bytedance/seedance-2.0/reference-to-video",
    frameUrl: "https://signed.example/stale.png", prompt: "stale",
    screenplayReference,
    assertScreenplayCurrent: () => {
      preparedFreshnessCalls++;
      if (preparedFreshnessCalls >= 2) throw new Error("screenplay changed after preparation");
    },
    durationMs: 4000, resolution: "720p",
  }),
  /changed after preparation/,
);
assert.equal(preparedFreshnessCalls, 2);
let submitFreshnessCalls = 0;
await assert.rejects(
  sandbox.seedanceGenerate(null, {
    falModel: "bytedance/seedance-2.0/reference-to-video",
    frameUrl: "https://signed.example/stale-submit.png", prompt: "stale",
    screenplayReference,
    assertScreenplayCurrent: () => {
      submitFreshnessCalls++;
      if (submitFreshnessCalls >= 3) throw new Error("screenplay changed before submit");
    },
    durationMs: 4000, resolution: "720p",
  }),
  /changed before submit/,
);
assert.equal(submitFreshnessCalls, 3);
assert.equal(submitted.length, submitsBeforeReferenceGuards,
  "malformed/missing-helper/stale screenplay requests must submit zero paid jobs");

/* Pending crash-recovery metadata retains the complete reference and the
   actual provider prompt. */
pollFailure = { status: "IN_PROGRESS" };
await assert.rejects(
  sandbox.seedanceGenerate("pending-screenplay", {
    falModel: "bytedance/seedance-2.0/reference-to-video",
    frameUrl: "https://signed.example/pending.png", prompt: editedPrompt,
    screenplayReference, assertScreenplayCurrent: () => true,
    durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
  }),
  /timed out/,
);
pollFailure = null;
const pendingScreenplay = sandbox.vidPendingList().find(x => x.id === "pending-screenplay");
assert.ok(pendingScreenplay);
assert.equal(pendingScreenplay.meta.screenplayReference.fullText, screenplayReference.fullText);
assert.equal(pendingScreenplay.meta.actualPrompt, pendingScreenplay.meta.prompt);
sandbox.localStorage.setItem("turn_vid_pending", "[]");

const tenAudios = Array.from({ length: 10 }, (_, i) =>
  `https://signed.example/audio-${i + 1}.wav?dur=1.8&token=x`
);
const tenAudioSubmitStart = submitted.length;
await sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  frameUrl: "https://signed.example/frame.png?token=x",
  audioUrls: tenAudios,
  prompt: "@Image1 performs with @Audio1 through @Audio10.",
  durationMs: 18000,
  resolution: "1080p",
  pollMs: 1,
  maxPolls: 1,
});
assert.equal(submitted.length, tenAudioSubmitStart + 1);
assert.deepEqual(
  Array.from(submitted.at(-1).audio_urls),
  tenAudios,
  "2.5 must forward all 10 direct audio references in original order",
);
assert.match(submitted.at(-1).prompt, /@Audio10\b/, "@Audio10 token must remain intact");

const submitsBeforeEleven = submitted.length;
await assert.rejects(
  sandbox.seedanceGenerate(null, {
    falModel: "bytedance/seedance-2.5/reference-to-video",
    frameUrl: "https://signed.example/frame.png?token=x",
    audioUrls: [...tenAudios, "https://signed.example/audio-11.wav?dur=1.8&token=x"],
    prompt: "@Image1 performs with @Audio11.",
    durationMs: 18000,
    resolution: "720p",
  }),
  /audios accepts at most 10 files/,
);
assert.equal(submitted.length, submitsBeforeEleven, "11 audio references must fail before submit");

const policyPrompt = "@Image1 walks through the scene exactly as directed.";
const policyDetail = "Sensitive content risk control: public figure likeness policy.";
const policyStatuses = [];
const submitsBeforePolicy = submitted.length;
pollFailure = { status: "FAILED", error: policyDetail, errorCode: "CONTENT_POLICY" };
let policyError;
try {
  await sandbox.seedanceGenerate(null, {
    frameUrl: "https://signed.example/policy-frame.png?token=x",
    prompt: policyPrompt,
    durationMs: 4000,
    resolution: "720p",
    pollMs: 1,
    maxPolls: 1,
    likenessRetry: false,
    onStatus: (status) => policyStatuses.push(status),
  });
} catch (error) {
  policyError = error;
}
pollFailure = null;
assert.ok(policyError, "provider moderation refusal must reject");
assert.equal(policyError.name, "ProviderPolicyError");
assert.equal(policyError.providerDetail, policyDetail, "exact provider detail must be preserved");
assert.equal(policyError.errorCode, "CONTENT_POLICY", "provider error code must be preserved");
assert.match(policyError.message, /No automatic retry was submitted/);
assert.equal(submitted.length, submitsBeforePolicy + 1, "moderation refusal must cause exactly one submit");
assert.equal(submitted.at(-1).prompt, policyPrompt, "policy handling must not alter the submitted prompt");
assert.equal(policyStatuses.includes("RETRY"), false, "policy handling must not announce a retry");
assert.equal(sandbox.vidPendingList().length, 0, "definitive poll policy failure must remove pending job");

const submitsBeforeTerminal = submitted.length;
pollFailure = { status: "FAILED" };
await assert.rejects(sandbox.seedanceGenerate(null, {
  frameUrl: "https://signed.example/terminal-frame.png?token=x",
  prompt: "@Image1 moves.",
  durationMs: 4000,
  resolution: "720p",
  pollMs: 1,
  maxPolls: 1,
}), /provider reported the render as FAILED/);
pollFailure = null;
assert.equal(submitted.length, submitsBeforeTerminal + 1, "terminal status must not trigger a second submit");
assert.equal(sandbox.vidPendingList().length, 0, "definitive terminal status must remove pending job");

const submitsBeforeTransient = submitted.length;
pollTransportError = { message: "Failed to send a request to the Edge Function" };
await assert.rejects(sandbox.seedanceGenerate(null, {
  frameUrl: "https://signed.example/transient-frame.png?token=x",
  prompt: "@Image1 moves.",
  durationMs: 4000,
  resolution: "720p",
  pollMs: 1,
  maxPolls: 1,
}), /timed out/);
pollTransportError = null;
assert.equal(submitted.length, submitsBeforeTransient + 1, "lost poll response must not resubmit");
assert.equal(sandbox.vidPendingList().length, 1, "ambiguous transport failure must retain pending job for recovery");
sandbox.localStorage.setItem("turn_vid_pending", "[]");

const httpPolicyDetail = "Request blocked by provider sensitive-content policy.";
const attemptsBeforeHttpPolicy = submitAttempts;
const httpPolicyBody = {
  error: httpPolicyDetail,
  errorCode: "CONTENT_POLICY",
  status: "FAILED",
};
submitHttpFailure = {
  message: "Edge Function returned a non-2xx status code",
  context: {
    status: 422,
    clone() {
      return { json: async () => httpPolicyBody };
    },
    json: async () => httpPolicyBody,
  },
};
let httpPolicyError;
try {
  await sandbox.seedanceGenerate(null, {
    frameUrl: "https://signed.example/http-policy-frame.png?token=x",
    prompt: policyPrompt,
    durationMs: 4000,
    resolution: "720p",
  });
} catch (error) {
  httpPolicyError = error;
}
submitHttpFailure = null;
assert.equal(submitAttempts, attemptsBeforeHttpPolicy + 1, "FunctionsHttpError policy refusal must submit only once");
assert.equal(attemptedSubmitBodies.at(-1).prompt, policyPrompt, "HTTP policy refusal must not alter prompt");
assert.equal(httpPolicyError?.name, "ProviderPolicyError");
assert.equal(httpPolicyError?.providerDetail, httpPolicyDetail, "HTTP response provider detail must survive exactly");
assert.equal(httpPolicyError?.errorCode, "CONTENT_POLICY", "HTTP response provider code must survive");
assert.equal(httpPolicyError?.providerStatus, "FAILED");

const generic422Body = { error: "Input schema validation failed.", code: "VALIDATION_ERROR" };
submitHttpFailure = {
  message: "Edge Function returned a non-2xx status code",
  context: {
    status: 422,
    clone() { return { json: async () => generic422Body }; },
    json: async () => generic422Body,
  },
};
let generic422Error;
try {
  await sandbox.seedanceGenerate(null, {
    frameUrl: "https://signed.example/invalid-frame.png?token=x",
    prompt: policyPrompt,
    durationMs: 4000,
    resolution: "720p",
  });
} catch (error) {
  generic422Error = error;
}
submitHttpFailure = null;
assert.notEqual(generic422Error?.name, "ProviderPolicyError", "generic HTTP 422 must not be inferred as policy");
assert.equal(generic422Error?.providerDetail, generic422Body.error);
assert.equal(generic422Error?.code, "VALIDATION_ERROR");

const textOnlyValidation = validateSeedanceRequest({
  model: "bytedance/seedance-2.5/text-to-video",
  duration: 8,
  resolution: "720p",
  aspectRatio: "16:9",
  prompt: "A fictional scene unfolds in the described office.",
  images: [], videos: [], audios: [],
});
assert.equal(textOnlyValidation.ok, true, "Seedance 2.5 text-to-video accepts a media-free package");
await sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  textOnly: true,
  prompt: "A fictional scene unfolds in the described office.",
  durationMs: 8000,
  aspectRatio: "16:9",
  resolution: "720p",
  pollMs: 1,
  maxPolls: 1,
});
const textOnlySubmit = submitted.at(-1);
assert.equal(textOnlySubmit.model, "bytedance/seedance-2.5/text-to-video");
assert.deepEqual(Array.from(textOnlySubmit.image_urls || []), []);
assert.deepEqual(Array.from(textOnlySubmit.video_urls || []), []);
assert.deepEqual(Array.from(textOnlySubmit.audio_urls || []), []);
assert.equal(textOnlySubmit.bitrateMode, null, "text-only client request must not ask for bitrate control");
assert.match(proxySource, /body\.bitrateMode && !\/text-to-video\$\/\.test\(model\)/,
  "the proxy must not forward bitrate_mode to Seedance text-to-video");

/* Every selected video route receives the same full text reference: text-only
   Seedance, image-to-video transitions, Sora, and Kling native multi-shot. */
await sandbox.seedanceGenerate("screenplay-text-route", {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  textOnly: true,
  prompt: "A text-only beat prompt.",
  screenplayReference, assertScreenplayCurrent: () => true,
  durationMs: 8000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
const textReferenceSubmit = submitted.at(-1);
assert.equal(textReferenceSubmit.model, "bytedance/seedance-2.5/text-to-video");
assert.ok(textReferenceSubmit.prompt.includes(screenplayReference.fullText));
assert.deepEqual(Array.from(textReferenceSubmit.image_urls || []), []);
assert.deepEqual(Array.from(textReferenceSubmit.video_urls || []), []);
assert.deepEqual(Array.from(textReferenceSubmit.audio_urls || []), []);

await sandbox.seedanceGenerate("screenplay-i2v-route", {
  falModel: "bytedance/seedance-2.0/reference-to-video",
  frameUrl: "https://signed.example/i2v-start.png",
  endImageUrl: "https://signed.example/i2v-end.png",
  prompt: "Transition into the desk.",
  screenplayReference, assertScreenplayCurrent: () => true,
  durationMs: 4000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
const i2vSubmit = submitted.at(-1);
assert.equal(i2vSubmit.model, "bytedance/seedance-2.0/image-to-video");
assert.ok(i2vSubmit.prompt.includes(screenplayReference.fullText));

await sandbox.seedanceGenerate("screenplay-sora-route", {
  falModel: "fal-ai/sora-2/image-to-video",
  frameUrl: "https://signed.example/sora-start.png",
  prompt: "Sora beat prompt.",
  screenplayReference, assertScreenplayCurrent: () => true,
  durationMs: 8000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
const soraSubmit = submitted.at(-1);
assert.equal(soraSubmit.model, "fal-ai/sora-2/image-to-video");
assert.ok(soraSubmit.prompt.includes(screenplayReference.fullText));

await sandbox.seedanceGenerate("screenplay-kling-route", {
  falModel: "fal-ai/kling-video/v3/standard/image-to-video",
  frameUrl: "https://signed.example/kling-start.png",
  prompt: "Top-level Kling prompt.",
  multiShot: [
    { prompt: "Kling row one: Marcus crosses to the desk.", duration: 3 },
    { prompt: "Kling row two: Daniel enters the hallway.", duration: 3 },
  ],
  screenplayReference, assertScreenplayCurrent: () => true,
  durationMs: 6_000, resolution: "720p", pollMs: 1, maxPolls: 1,
});
const klingSubmit = submitted.at(-1);
assert.equal(klingSubmit.model, "fal-ai/kling-video/v3/standard/image-to-video");
assert.ok(klingSubmit.prompt.includes(screenplayReference.fullText));
assert.equal(klingSubmit.multi_prompt.length, 2);
assert.ok(klingSubmit.multi_prompt.every(row => row.prompt.includes(screenplayReference.fullText)),
  "Kling native multi_prompt rows must each carry the full screenplay reference");
assert.equal(klingSubmit.multi_prompt[0].prompt.startsWith("Kling row one"), true);
assert.equal(klingSubmit.multi_prompt[1].prompt.startsWith("Kling row two"), true);
assert.equal(Object.prototype.hasOwnProperty.call(klingSubmit, "video_urls"), false);
assert.equal(Object.prototype.hasOwnProperty.call(klingSubmit, "audio_urls"), false);

/* The deployed proxy currently slices Kling rows to 2000 chars.  Refuse such
   a row in the client first: never truncate source, silently drop a row, or
   switch models to evade the provider limit. */
const longScreenplayReference = {
  ...screenplayReference,
  fullText: "LONG-SCENE-LINE ".repeat(180),
  targetText: "LONG-SCENE-LINE target",
  sourceRev: "source-rev-long",
  signature: "screenplay-signature-long",
};
const submitsBeforeKlingLimit = submitted.length;
await assert.rejects(
  sandbox.seedanceGenerate("kling-too-long", {
    falModel: "fal-ai/kling-video/v3/standard/image-to-video",
    frameUrl: "https://signed.example/kling-long.png",
    prompt: "long Kling prompt.",
    multiShot: [{ prompt: "row", duration: 3 }, { prompt: "row two", duration: 3 }],
    screenplayReference: longScreenplayReference, assertScreenplayCurrent: () => true,
    durationMs: 6_000, resolution: "720p", pollMs: 1, maxPolls: 1,
  }),
  /2000-character row limit/,
);
assert.equal(submitted.length, submitsBeforeKlingLimit,
  "oversized Kling screenplay rows must fail before paid submit");

await assert.rejects(sandbox.seedanceGenerate(null, {
  falModel: "bytedance/seedance-2.5/reference-to-video",
  textOnly: true,
  frameUrl: "https://signed.example/should-not-attach.png",
  prompt: "No media should travel.",
  durationMs: 8000,
  resolution: "720p",
}), /cannot include image, video, or audio references/);

/* Recovery is pinned to the project/user/epoch that selected the pending job.
   Switching films while poll awaits must not leak the completed take into the
   new film's memory, IDB, or cloud row; the same pending job remains available
   to a later recovery in its original film, with screenplay provenance intact. */
let activeScope = { projectId: "film-a", uid: "user-a", epoch: 101 };
const recoveryCloudWrites = [];
sandbox.nbCloudScope = () => activeScope;
sandbox.nbEpoch = () => activeScope.epoch;
sandbox.cloudCommitVideo = async (projectId, uid, id, entry) => {
  recoveryCloudWrites.push({ projectId, uid, id, entry });
};
const recoveryId = "recovery-screenplay-clip";
const recoveryRequestId = "recovery-screenplay-request";
const submitAttemptsBeforeRecovery = submitAttempts;
sandbox.localStorage.setItem("turn_vid_pending", JSON.stringify([{
  requestId: recoveryRequestId,
  id: recoveryId,
  model: "bytedance/seedance-2.5/reference-to-video",
  statusUrl: "https://queue.example/recovery-status",
  responseUrl: "https://queue.example/recovery-result",
  at: Date.now(),
  projectId: "film-a",
  uid: "user-a",
  meta: {
    prompt: "Recovered screenplay prompt.",
    actualPrompt: "Recovered screenplay prompt.",
    screenplayReference,
    screenplayReferenceProvenance: screenplayReference,
  },
}]));
let releaseRecoveryPoll;
const recoveryPollPaused = new Promise(resolve => { releaseRecoveryPoll = resolve; });
let recoveryPollStarted;
const recoveryPollStartedPromise = new Promise(resolve => { recoveryPollStarted = resolve; });
recoveryPollGate = async () => {
  recoveryPollStarted();
  await recoveryPollPaused;
  return { data: { status: "COMPLETED", videoUrl: "https://media.example/recovered-a.mp4" } };
};
const recovering = sandbox.vidRecoverPending({ quiet: true });
await recoveryPollStartedPromise;
activeScope = { projectId: "film-b", uid: "user-b", epoch: 202 };
releaseRecoveryPoll();
await recovering;
recoveryPollGate = null;
assert.equal(sandbox.vidGetVideo(recoveryId), "", "switched-film recovery must not populate shared memory");
assert.equal(recoveryCloudWrites.length, 0, "switched-film recovery must not write the new film's cloud row");
assert.ok(sandbox.vidPendingList().some(job => job.requestId === recoveryRequestId),
  "a skipped recovery must retain the pending provider job");

activeScope = { projectId: "film-a", uid: "user-a", epoch: 303 };
recoveryPollGate = async () => ({
  data: { status: "COMPLETED", videoUrl: "https://media.example/recovered-a.mp4" },
});
const recoveredCount = await sandbox.vidRecoverPending({ quiet: true });
assert.equal(recoveredCount, 1, "the original film should recover its retained provider job");
assert.equal(recoveryCloudWrites.length, 1, "correct-film recovery should settle exactly one cloud take");
assert.equal(recoveryCloudWrites[0].projectId, "film-a");
assert.equal(recoveryCloudWrites[0].uid, "user-a");
assert.equal(recoveryCloudWrites[0].id, recoveryId);
assert.equal(sandbox.vidGetVideo(recoveryId), "https://media.example/recovered-a.mp4");
assert.equal(sandbox.vidGetMeta(recoveryId).screenplayReference.fullText, screenplayReference.fullText,
  "screenplay provenance must survive skipped recovery and later delivery");
assert.equal(sandbox.vidPendingList().some(job => job.requestId === recoveryRequestId), false);
assert.equal(submitAttempts, submitAttemptsBeforeRecovery,
  "recovery must only poll the paid provider job and never submit a second job");
recoveryPollGate = null;

/* A delayed IDB read is a separate privacy boundary from the provider poll:
   an overlapping clip row from film A must not be installed after switching
   to film B, and film B must not lazily load that A-owned row. */
const raceStore = new Map();
const raceRows = new Map([[
  "v:overlap-clip",
  { url: "https://media.example/film-a-old.mp4", meta: { hash: "old-a" },
    owner: { projectId: "film-a", uid: "user-a" } },
]]);
let raceScope = { projectId: "film-a", uid: "user-a", epoch: 401 };
let raceReadRelease;
let raceReadStarted;
const raceReadStartedPromise = new Promise(resolve => { raceReadStarted = resolve; });
let raceDelayRead = true;
let raceIdbWrites = 0;
const raceDb = {
  objectStoreNames: { contains: () => true },
  transaction: () => {
    const tx = {};
    const store = {
      get(key) {
        const req = {};
        if(raceDelayRead){
          raceDelayRead = false;
          raceReadStarted();
          raceReadRelease = () => queueMicrotask(() => {
            req.result = raceRows.get(key);
            req.onsuccess?.();
          });
        }else queueMicrotask(() => {
          req.result = raceRows.get(key);
          req.onsuccess?.();
        });
        return req;
      },
      put(value, key) {
        raceIdbWrites++;
        raceRows.set(key, value);
        queueMicrotask(() => tx.oncomplete?.());
      },
      delete(key) {
        raceRows.delete(key);
        queueMicrotask(() => tx.oncomplete?.());
      },
    };
    tx.objectStore = () => store;
    return tx;
  },
};
const raceIndexedDB = {
  open: () => {
    const req = { result: raceDb };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  },
};
const raceCloudWrites = [];
let raceSubmitAttempts = 0;
const raceSandbox = {
  console, Date, Math, JSON, Promise, queueMicrotask,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  localStorage: {
    getItem: k => raceStore.has(k) ? raceStore.get(k) : null,
    setItem: (k, v) => raceStore.set(k, String(v)),
    removeItem: k => raceStore.delete(k),
  },
  navigator: { userAgent: "seedance-delayed-idb-test" },
  location: { href: "", origin: "https://app.example" },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  React: new Proxy({}, { get: () => () => null }),
  document: { createElement: () => ({ getContext: () => ({}) }) },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
  indexedDB: raceIndexedDB,
  TURN_SUPABASE: { imageProxy: true, imageProxyFn: "image-proxy" },
};
raceSandbox.window = raceSandbox;
raceSandbox.globalThis = raceSandbox;
raceSandbox.nbCloudScope = () => raceScope;
raceSandbox.nbEpoch = () => raceScope.epoch;
raceSandbox.cloudCommitVideo = async (projectId, uid, id, entry) => {
  raceCloudWrites.push({ projectId, uid, id, entry });
};
raceSandbox.sbClient = () => ({
  functions: {
    invoke: async (_name, { body }) => {
      if(body.op === "poll") return { data: { status: "COMPLETED", videoUrl: "https://media.example/recovered-a.mp4" } };
      if(body.op === "submit"){
        raceSubmitAttempts++;
        return { data: { requestId: "unexpected-submit", statusUrl: "s", responseUrl: "r" } };
      }
      return { data: { known: true, capabilities: { resolutions: ["480p", "720p", "1080p"] } } };
    },
  },
});
vm.createContext(raceSandbox);
for (const file of ["app/shot-screenplay.js", "app/shot-scene-context.js", "app/stage-screenplay.js"]) {
  vm.runInContext(readFileSync(file, "utf8"), raceSandbox, { filename: file });
}
vm.runInContext(compiled, raceSandbox, { filename: "app/videogen.jsx" });
raceSandbox.localStorage.setItem("turn_vid_pending", JSON.stringify([{
  requestId: "delayed-idb-request",
  id: "overlap-clip",
  model: "bytedance/seedance-2.5/reference-to-video",
  statusUrl: "https://queue.example/delayed-status",
  responseUrl: "https://queue.example/delayed-result",
  at: Date.now(),
  projectId: "film-a",
  uid: "user-a",
  meta: {
    prompt: "Delayed recovery prompt.",
    actualPrompt: "Delayed recovery prompt.",
    screenplayReference,
    screenplayReferenceProvenance: screenplayReference,
  },
}]));
const delayedRecovery = raceSandbox.vidRecoverPending({ quiet: true });
await raceReadStartedPromise;
raceScope = { projectId: "film-b", uid: "user-b", epoch: 402 };
raceReadRelease();
await delayedRecovery;
assert.equal(raceSandbox.vidGetVideo("overlap-clip"), "",
  "film B must not receive film A's overlapping IDB row after delayed read");
assert.equal(raceCloudWrites.length, 0, "delayed cross-film recovery must not cloud-commit");
assert.equal(raceIdbWrites, 0, "delayed cross-film recovery must not write IDB");
assert.equal(raceSubmitAttempts, 0, "recovery race must never launch a second paid submit");
assert.equal(await raceSandbox.vidLoadVideo("overlap-clip"), "",
  "film B must reject lazy loading an A-owned shared-key IDB row");
assert.ok(raceSandbox.vidPendingList().some(j => j.requestId === "delayed-idb-request"),
  "delayed cross-film recovery must retain pending job");
raceScope = { projectId: "film-a", uid: "user-a", epoch: 403 };
const delayedRecovered = await raceSandbox.vidRecoverPending({ quiet: true });
assert.equal(delayedRecovered, 1, "film A should recover after returning");
assert.equal(raceCloudWrites.length, 1, "film A recovery should cloud-commit once");
assert.equal(raceCloudWrites[0].projectId, "film-a");
assert.equal(raceSandbox.vidGetMeta("overlap-clip").screenplayReference.fullText, screenplayReference.fullText,
  "delayed recovery must preserve screenplay provenance");

console.log("Seedance payload validation tests passed.");

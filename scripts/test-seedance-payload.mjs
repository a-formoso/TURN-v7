import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import {
  seedanceCapabilities,
  validateSeedanceRequest,
} from "../supabase/functions/image-proxy/seedance-capabilities.mjs";

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
let submitAttempts = 0;
const attemptedSubmitBodies = [];
const store = new Map();
const sandbox = {
  console, Date, Math, JSON, Promise,
  setTimeout: (fn, ms) => { if (ms < 3000) queueMicrotask(fn); return 0; },
  clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
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
        if (submitHttpFailure) return { data: null, error: submitHttpFailure };
        submitted.push(body);
        return { data: { requestId: "actual-path", statusUrl: "https://queue.fal.run/status", responseUrl: "https://queue.fal.run/result", status: "IN_QUEUE" } };
      }
      if (body.op === "poll") {
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
const compiled = transformSync(readFileSync("app/videogen.jsx", "utf8"), {
  presets: ["@babel/preset-react"],
  filename: "app/videogen.jsx",
}).code;
vm.runInContext(compiled, sandbox, { filename: "app/videogen.jsx" });
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

const tenAudios = Array.from({ length: 10 }, (_, i) =>
  `https://signed.example/audio-${i + 1}.wav?dur=1.8&token=x`
);
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
assert.equal(submitted.length, 2);
assert.deepEqual(
  Array.from(submitted[1].audio_urls),
  tenAudios,
  "2.5 must forward all 10 direct audio references in original order",
);
assert.match(submitted[1].prompt, /@Audio10\b/, "@Audio10 token must remain intact");

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

console.log("Seedance payload validation tests passed.");
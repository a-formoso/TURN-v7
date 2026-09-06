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
const store = new Map();
const sandbox = {
  console, Date, Math, JSON, Promise,
  setTimeout: (fn, ms) => { if (ms < 100) queueMicrotask(fn); return 0; },
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
        submitted.push(body);
        return { data: { requestId: "actual-path", statusUrl: "https://queue.fal.run/status", responseUrl: "https://queue.fal.run/result", status: "IN_QUEUE" } };
      }
      if (body.op === "poll") return { data: { status: "COMPLETED", videoUrl: "https://media.example/result.mp4" } };
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

console.log("Seedance payload validation tests passed.");
#!/usr/bin/env node
/*
 * Client-side GPT Image quality regression tests.
 *
 * This intentionally evaluates the real buildless image worker in an isolated
 * Node VM.  Storage, fetch, Image/FileReader, and Supabase are local fakes:
 * the test never contacts a provider, a Supabase project, or image storage.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  validateImageQuality,
  providerQualityPayload,
} from "../supabase/functions/image-proxy/image-quality.mjs";

const imagegen = readFileSync("app/imagegen.jsx", "utf8");
const ALL_25 = ["default", "auto", "low", "medium", "high", "xhigh", "max"];
const LEGACY = ["low", "medium", "high"];
const FLARE = "gpt-image-2.5-flare";
const SUNBURST = "gpt-image-2.5-sunburst";
const LEGACY_MODEL = "gpt-image-2";
const PROXY_URL = "https://supabase.test/functions/v1/fake-image-proxy";
const REF_URL = "https://assets.test/reference.png";
const realSetTimeout = setTimeout;
const testSetTimeout = (handler, delay, ...args) => {
  const timer = realSetTimeout(handler, delay, ...args);
  // proxyGenerate's safety race is intentionally long-lived.  A browser does
  // not keep a Node test process alive for that timer, so mirror that behavior.
  if (timer && typeof timer.unref === "function") timer.unref();
  return timer;
};

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      key = String(key);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
    snapshot() {
      return Object.fromEntries(values);
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    blob: async () => new Blob(["reference"], { type: "image/png" }),
  };
}

/*
 * Build one browser-like VM.  `control` is deliberately mutable so one
 * context can exercise a failed check, a forced refresh, and a pending image
 * reference conversion without replacing any app function.
 */
function makeBox({
  storage = makeStorage(),
  capabilityBody = {
    imageQualitySchema: 1,
    imageQualities: {
      [FLARE]: [...ALL_25],
      [SUNBURST]: [...ALL_25],
    },
  },
  sbCalls = [],
} = {}) {
  const events = [];
  const fetchCalls = [];
  const control = {
    capabilityBody,
    capabilityError: null,
    referenceWait: null,
  };
  const listeners = new Map();

  const box = {
    console,
    Date,
    Promise,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Map,
    Set,
    Uint8Array,
    Blob,
    URL,
    AbortController,
    FileReader: class {
      readAsDataURL(blob) {
        queueMicrotask(() => {
          this.result = "data:image/png;base64,REF";
          if (this.onload) this.onload({ target: { result: this.result } });
        });
      }
    },
    atob,
    isFinite,
    parseInt,
    parseFloat,
    setTimeout: testSetTimeout,
    clearTimeout,
    queueMicrotask,
    localStorage: storage,
    sessionStorage: makeStorage(),
    TURN_SUPABASE: { url: "https://supabase.test/", imageProxy: true, imageProxyFn: "fake-image-proxy" },
    CREDIT_SCALE: 1,
    turnSafeError: value => value,
    turnAttrError: (_kind, _model, message) => message,
    turnIsContentBlock: () => false,
    turnApiKeysForProxy: () => ({}),
    React: {
      createElement: () => null,
      useState: initial => [initial, () => {}],
      useEffect: () => {},
    },
    document: {
      createElement(tag) {
        if (tag === "canvas") {
          return {
            width: 1600,
            height: 900,
            getContext: () => ({ drawImage: () => {} }),
            toDataURL: () => "data:image/png;base64,CROPPED",
          };
        }
        return { style: {}, click: () => {}, remove: () => {} };
      },
      body: { appendChild: () => {} },
      getElementById: () => null,
    },
    Image: class {
      constructor() {
        this.naturalWidth = 1600;
        this.naturalHeight = 900;
        this.width = 1600;
        this.height = 900;
      }
      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          if (this.onload) this.onload();
        });
      }
      get src() {
        return this._src;
      }
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter(item => item !== handler));
    },
    dispatchEvent(event) {
      events.push(event);
      for (const handler of listeners.get(event && event.type) || []) handler(event);
      return true;
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
  };

  box.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options: { ...options } });
    if (options.method === "OPTIONS") {
      if (control.capabilityError) throw control.capabilityError;
      return jsonResponse(control.capabilityBody);
    }
    if (String(url) === REF_URL) {
      if (control.referenceWait) return control.referenceWait.promise;
      return jsonResponse("");
    }
    throw new Error(`Unexpected fake fetch: ${url}`);
  };

  box.sbClient = () => ({
    functions: {
      invoke: async (functionName, request) => {
        sbCalls.push({ functionName, request });
        return {
          data: { b64: "IMAGE", mime: "image/png" },
          error: null,
        };
      },
    },
  });

  box.window = box;
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(imagegen, box, { filename: "app/imagegen.jsx" });
  box._test = { control, events, fetchCalls, sbCalls, storage };
  return box;
}

async function assertRejects(promise, pattern, message) {
  await assert.rejects(promise, error => {
    assert.match(String(error && error.message), pattern, message);
    return true;
  });
}

/*
 * Preference behavior is tested in separate VM instances to model a reload.
 * The storage object intentionally survives those instances.
 */
{
  const storage = makeStorage();
  const prefs = makeBox({ storage });
  assert.deepEqual(Array.from(prefs.nbOaiQualityChoices(FLARE)), ALL_25);
  assert.deepEqual(Array.from(prefs.nbOaiQualityChoices(SUNBURST)), ALL_25);
  assert.deepEqual(Array.from(prefs.nbOaiQualityChoices(LEGACY_MODEL)), LEGACY);
  assert.equal(prefs.nbGetOaiQuality(LEGACY_MODEL), "medium", "legacy GPT Image defaults to medium");
  assert.equal(prefs.nbGetOaiQuality(FLARE), "medium", "GPT Image 2.5 defaults to medium");

  // A pre-2.5 install stored its preference under the old shared key.  The
  // first 2.5 read seeds the family key exactly once, preserving the explicit
  // old preference without allowing later legacy changes to overwrite it.
  storage.setItem("turn-oai-quality", "high");
  assert.equal(prefs.nbGetOaiQuality(FLARE), "high");
  assert.equal(storage.getItem("turn-oai-quality:2.5"), "high");
  storage.setItem("turn-oai-quality", "low");
  assert.equal(prefs.nbGetOaiQuality(FLARE), "high");

  const defaultStorage = makeStorage();
  const defaultPrefs = makeBox({ storage: defaultStorage });
  assert.equal(defaultPrefs.nbGetOaiQuality(FLARE), "medium");
  assert.equal(defaultStorage.getItem("turn-oai-quality:2.5"), null,
    "an absent preference must not persist the default");

  prefs.nbSetModel(FLARE);
  prefs.nbSetOaiQuality("max");
  // GPT Image 2 was removed (2026-10-11): picking its id selects GPT Image 2.5 Sunburst, which reads the 2.5
  // family preference
  prefs.nbSetModel(LEGACY_MODEL);
  assert.equal(prefs.nbGetModel(), SUNBURST, "a retired GPT Image 2 pick is GPT Image 2.5 Sunburst");
  assert.equal(prefs.nbGetOaiQuality(), "max", "… with the 2.5 family preference");
  prefs.nbSetModel(FLARE);
  assert.equal(prefs.nbGetOaiQuality(), "max", "2.5 family preference survives a legacy-model switch");
  prefs.nbSetModel(SUNBURST);
  assert.equal(prefs.nbGetOaiQuality(), "max", "Flare and Sunburst share one 2.5 family preference");

  const reloaded = makeBox({ storage });
  assert.equal(reloaded.nbGetModel(), SUNBURST);
  assert.equal(reloaded.nbGetOaiQuality(), "max", "2.5 quality survives a reload");
  assert.throws(
    () => reloaded.nbSetOaiQuality("xhigh", LEGACY_MODEL),
    /not supported by this image model/,
    "legacy GPT Image rejects 2.5-only quality values",
  );
}

const quality = makeBox();
quality.nbSetModel(FLARE);

// OPTIONS is the only capability probe: it is unauthenticated, keyless, and
// has no operation body, even though generation itself is POSTed to the same
// function URL.
const firstCapabilityFetchCount = quality._test.fetchCalls.length;
const ready = await quality.nbRefreshImageQualityCapabilities({ force: true });
assert.equal(ready.state, "ready");
assert.equal(quality._test.fetchCalls.length, firstCapabilityFetchCount + 1);
const capabilityCall = quality._test.fetchCalls.at(-1);
assert.equal(capabilityCall.url, PROXY_URL);
assert.equal(capabilityCall.options.method, "OPTIONS");
assert.equal(capabilityCall.options.credentials, "omit");
assert.equal(capabilityCall.options.cache, "no-store");
assert.equal(Object.prototype.hasOwnProperty.call(capabilityCall.options, "headers"), false,
  "capability OPTIONS has no auth or API-key headers");
assert.equal(Object.prototype.hasOwnProperty.call(capabilityCall.options, "body"), false,
  "capability OPTIONS has no generation body");
assert.deepEqual(Array.from(quality.nbImageQualitySupport(FLARE).qualities), ALL_25);
assert.equal(quality.nbImageQualitySupport(FLARE).expanded, true);

// A valid old proxy answers OPTIONS but has no quality schema.  New quality
// levels are disabled without ever turning the check into a generation call;
// the existing low/medium/high path remains usable.
const oldProxy = makeBox({
  capabilityBody: "ok",
});
oldProxy.nbSetModel(FLARE);
await oldProxy.nbRefreshImageQualityCapabilities({ force: true });
const oldSupport = oldProxy.nbImageQualitySupport(FLARE);
assert.deepEqual(Array.from(oldSupport.qualities), LEGACY);
assert.equal(oldSupport.expanded, false);
assert.match(oldSupport.message, /waiting on a server update|Update image-proxy|enable the additional quality levels/);
await assertRejects(
  oldProxy.nbGenerate("extended quality should not submit", { model: FLARE, quality: "xhigh" }),
  /No image generation was submitted|support/,
  "unsupported extended quality must fail before invoke",
);
assert.equal(oldProxy._test.sbCalls.length, 0, "old proxy must not receive a new-quality generation");
await oldProxy.nbGenerate("legacy quality still works", { model: FLARE, quality: "high" });
assert.equal(oldProxy._test.sbCalls.length, 1, "old proxy still accepts legacy quality");

// Failed capability checks expose a retryable message, and a forced refresh
// must actually bypass the cache and enable the full schema after recovery.
quality._test.control.capabilityError = new Error("simulated network failure");
await quality.nbRefreshImageQualityCapabilities({ force: true });
const failedSupport = quality.nbImageQualitySupport(FLARE);
assert.equal(failedSupport.expanded, false);
assert.match(failedSupport.message, /Could not check image-server support/);
const beforeForcedRefresh = quality._test.fetchCalls.length;
quality._test.control.capabilityError = null;
quality._test.control.capabilityBody = {
  imageQualitySchema: 1,
  imageQualities: {
    [FLARE]: [...ALL_25],
    [SUNBURST]: [...ALL_25],
  },
};
await quality.nbRefreshImageQualityCapabilities({ force: true });
assert.equal(quality._test.fetchCalls.length, beforeForcedRefresh + 1,
  "force refresh must issue a new OPTIONS request");
assert.equal(quality.nbImageQualitySupport(FLARE).expanded, true);

// The browser keeps an internal sentinel for Default, while the server helper
// deliberately omits the provider quality field so the provider's documented
// default (high) applies.
const internalDefault = validateImageQuality(FLARE, "default");
assert.equal(internalDefault.quality, "default");
assert.deepEqual(providerQualityPayload(internalDefault), {});
assert.deepEqual(
  providerQualityPayload(validateImageQuality(FLARE, "auto")),
  { quality: "auto" },
  "the server helper strips only the internal default sentinel",
);
quality.nbSetOaiQuality("default", FLARE);
await quality.nbGenerate("default quality remains an internal token", { model: FLARE });
const generatedDefaultCall = quality._test.sbCalls.at(-1);
assert.equal(generatedDefaultCall.request.body.quality, "default",
  "nbGenerate must preserve explicit internal default until the server boundary");
await quality.proxyGenerate("default quality payload", {
  model: FLARE,
  quality: "default",
}, "fal");
const defaultCall = quality._test.sbCalls.at(-1);
assert.equal(defaultCall.request.body.quality, "default");
assert.equal(defaultCall.request.body.provider, "fal",
  "the client still identifies the image broker; only the server provider-quality field is omitted");

// Pricing uses public client helpers and relationships, rather than coupling
// the test to private dollar constants.
const mediumCost = quality.nbImageCredits({ model: FLARE, quality: "medium" });
const highCost = quality.nbImageCredits({ model: FLARE, quality: "high" });
const defaultCost = quality.nbImageCredits({ model: FLARE, quality: "default" });
const autoCost = quality.nbImageCredits({ model: FLARE, quality: "auto" });
const xhighCost = quality.nbImageCredits({ model: FLARE, quality: "xhigh" });
const maxCost = quality.nbImageCredits({ model: FLARE, quality: "max" });
assert.equal(defaultCost, highCost, "Default is estimated at high");
assert.equal(autoCost, maxCost, "Auto uses the conservative max estimate");
assert.ok(xhighCost > mediumCost, "xhigh costs more than medium");
assert.ok(maxCost > mediumCost, "max costs more than medium");
assert.equal(quality.nbImageCredits({ model: FLARE, quality: "not-a-quality" }), null,
  "invalid new quality does not fall back to medium pricing");
assert.equal(quality.nbImageCostText(1, { model: FLARE, quality: "not-a-quality" }), "",
  "invalid new quality has no cost chip");
await assertRejects(
  quality.nbGenerate("invalid quality should fail", { model: FLARE, quality: "not-a-quality" }),
  /not supported/,
  "invalid explicit quality should produce an error",
);

// Snapshot quality/model before reference conversion.  While the fake GET is
// pending, mutate the persisted dock settings; the in-flight POST must retain
// the values captured at submission (max + Flare).
quality.nbSetModel(FLARE);
quality.nbSetOaiQuality("max", FLARE);
const referenceWait = deferred();
quality._test.control.referenceWait = referenceWait;
const render = quality.nbGenerate("snapshot quality and model", {
  model: FLARE,
  referenceImage: REF_URL,
  aspectRatio: "16:9",
});
await Promise.resolve();
await Promise.resolve();
assert.ok(
  quality._test.fetchCalls.some(call => call.url === REF_URL),
  "the render should be waiting on actual reference URL conversion",
);
quality.nbSetOaiQuality("high", FLARE);
quality.nbSetModel(LEGACY_MODEL);
referenceWait.resolve(jsonResponse(""));
await render;
const captured = quality._test.sbCalls.at(-1).request.body;
assert.equal(captured.model, FLARE);
assert.equal(captured.quality, "max");
assert.deepEqual(Array.from(captured.images), ["data:image/png;base64,REF"]);

// Single-submission requests must never turn an ambiguous response loss into an automatic
// second paid submission, nor rewrite a provider refusal.
const guarded=makeBox();
let guardedCalls=0;
guarded.sbClient=()=>({functions:{invoke:async()=>{
  guardedCalls++;
  return {data:null,error:new Error("Failed to send a request: network error")};
}}});
await assert.rejects(guarded.nbGenerate("character portrait",{
  model:FLARE,quality:"medium",noRetry:true,
}),/network error/);
assert.equal(guardedCalls,1,"one uncertain frame cannot launch twice automatically");
guardedCalls=0;
guarded.sbClient=()=>({functions:{invoke:async()=>{
  guardedCalls++;
  return {data:{error:"provider content block"},error:null};
}}});
guarded.turnIsContentBlock=()=>true;
await assert.rejects(guarded.nbGenerate("gap-toothed character portrait",{
  model:FLARE,quality:"medium",noRetry:true,
}),/content block/);
assert.equal(guardedCalls,1,"provider refusal cannot rewrite the prompt and spend again");
guardedCalls=0;
await assert.rejects(guarded.nbGenerate("cancelled character portrait",{
  model:FLARE,quality:"medium",noRetry:true,referenceImage:REF_URL,
  beforeSubmit:async()=>{throw new Error("Request owner changed during reference preparation");},
}),/Request owner changed/);
assert.equal(guardedCalls,0,"ownership must be checked at the final paid boundary");

console.log("Client image-quality and submission-guard tests passed.");
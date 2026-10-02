#!/usr/bin/env node
/* Headless location quality snapshot test. Recording fakes only: no render,
   provider, auth, or persistence service is contacted. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("app/locations.jsx", "utf8");
const start = source.indexOf("function _nbLocRunSnapshot(");
const end = source.indexOf("\n/* coverage audit", start);
assert.ok(start >= 0 && end > start, "location generation source boundary");

const noop = () => {};
const box = {
  console, Date, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  window: null, turnContinuity: {}, NB_MODELS: [{ id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" }],
  nbGetModel: () => "gpt-image-2.5-flare", isGptImageModel: model => /^gpt-image/.test(model || ""),
  nbGetOaiQuality: () => quality, nbGetAspect: () => "16:9", nbGetRes: () => "2K",
  nbEpoch: () => 1, nbWritingSourcesFor: () => [], dispatchEvent: event => events.push(event),
  combinedLocationPrompt: () => "LOCATION", buildSimpleLocationPrompt: () => "SIMPLE",
  locationAssetDependencySnapshot: () => ({}),
  locationParentReferences: async () => [], locationParentOf: () => null,
  locationStateReferences: async () => [{url:"master",refId:"location"}],
  locationReferenceInstructions: () => "",
  locationSpatialReferences: async () => [], mergeLocationReferences: (...groups) => groups.flat(),
};
box.window = box;
vm.createContext(box);

let quality = "default";
const order = [];
const events = [];
let generatedOpts = null;
let committedMeta = null;
box.nbRequireImageQuality = async (model, q) => { order.push(["require", model, q]); };
box.nbGenerate = async (_prompt, opts) => {
  order.push(["generate"]);
  generatedOpts = { ...opts };
  quality = "auto";
  return "rendered";
};
box.nbCommit = async (_id, _url, meta) => { order.push(["commit"]); committedMeta = meta; return { tier: "local", url: "rendered" }; };
box.window.__nbGenInflight = {};
box.nbCancelGen = id => {
  if (box.window.__nbGenInflight) box.window.__nbGenInflight[id] = false;
  if (!box.window.__nbGenCancel) box.window.__nbGenCancel = {};
  box.window.__nbGenCancel[id] = true;
};
box.window.nbRequireImageQuality = box.nbRequireImageQuality;
vm.runInContext(source.slice(start, end), box, {
  filename: "app/locations.jsx#quality-snapshot",
});

await box.window.generateLocationPlate({ id: "location-1", name: "Kitchen" }, {});
assert.deepEqual(generatedOpts, { model: "gpt-image-2.5-flare", quality: "default", assetId: "location-1" });   // the plate names its item (Art Room fix 10)
assert.equal(committedMeta.quality, "default", "metadata keeps the original default intent");
assert.deepEqual(order.map(x => x[0]), ["require", "generate", "commit"]);

box.window.__nbGenInflight["active-location"] = 999;
assert.equal(await box.window.generateLocationPlate({ id: "active-location", name: "Kitchen" }, {}), false);
assert.equal(box.window.__nbGenInflight["active-location"], 999, "active-owner refusal does not replace the existing token");
delete box.window.__nbGenInflight["active-location"];

let currentEpoch = 1;
box.nbEpoch = () => currentEpoch;
currentEpoch = 1;
quality = "default"; generatedOpts = null; committedMeta = null; order.length = 0;
let release;
box.nbRequireImageQuality = async () => new Promise(resolve => { release = resolve; });
const epochPending = box.window.generateLocationPlate({ id: "location-epoch", name: "Kitchen" }, {});
await new Promise(resolve => setTimeout(resolve, 0));
currentEpoch = 2; release(true); await epochPending;
assert.equal(generatedOpts, null, "plate epoch switch blocks provider after capability await");
assert.equal(committedMeta, null, "plate epoch switch blocks commit");

/* Stop A, start B on the same asset, then let A's deferred capability check
   finish. A must neither spend nor clear B's token. */
currentEpoch = 1;
quality = "default"; generatedOpts = null; committedMeta = null; order.length = 0;
const deferredChecks = [];
box.nbRequireImageQuality = async () => new Promise(resolve => deferredChecks.push(resolve));
const a = box.window.generateLocationPlate({ id: "location-race", name: "Kitchen" }, {});
await new Promise(resolve => setTimeout(resolve, 0));
box.nbCancelGen("location-race");
const b = box.window.generateLocationPlate({ id: "location-race", name: "Kitchen" }, {});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(deferredChecks.length, 2, "A and B each await capability validation");
deferredChecks[0](true); await a;
assert.equal(generatedOpts, null, "stopped A cannot spend after deferred capability validation");
assert.ok(box.window.__nbGenInflight["location-race"], "A cannot clear B's inflight token");
deferredChecks[1](true); await b;
assert.equal(order.filter(x => x[0] === "generate").length, 1, "only B spends");
assert.equal(order.filter(x => x[0] === "commit").length, 1, "only B commits");
assert.equal(box.window.__nbGenInflight["location-race"], undefined, "B cleans its own token");

/* Cancellation while the provider is resolving is also quiet and cannot
   trigger a late commit or done event. */
box.nbRequireImageQuality = async () => true;
let releaseProvider;
committedMeta = null;
box.nbGenerate = async () => new Promise(resolve => { releaseProvider = resolve; });
const providerPending = box.window.generateLocationVariant(
  { id: "location-provider-cancel", name: "Kitchen" },
  { id: "night", time: "night", state: "wet" }, {},
);
await new Promise(resolve => setTimeout(resolve, 0));
box.nbCancelGen("location-provider-cancel-night");
releaseProvider("late-render"); await providerPending;
assert.equal(committedMeta, null, "provider cancellation cannot commit a late variant");

console.log("PASS location quality snapshot");

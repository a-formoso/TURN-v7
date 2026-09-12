#!/usr/bin/env node
/* Generation-level Stage frame prompt override test.
   The StageFrameComposer callback and Art Room generation runner are extracted
   from the application source. A local fake provider records the exact prompt;
   no network, cloud, or paid generation is used. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const noop = () => {};
const box = {
  console, Date, Set, Map, Math, JSON, Number, String, Object, Array, RegExp,
  isFinite, parseInt, parseFloat, setTimeout, clearTimeout, AbortController,
  React: null, Icon: {}, _stEl: (...args) => ({ type: args[0], props: args[1] }),
  document: { createElement: () => ({}), addEventListener: noop, removeEventListener: noop,
    body: { appendChild: noop, removeChild: noop } },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: {}, location: {},
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  dispatchEvent: noop,
};
box.window = box;
box.globalThis = box;
box.NB_MODELS = [{ id: "fake-model", label: "Fake local provider", family: "other" }];
box.NB_RESOLUTIONS = [];
box.NB_ASPECTS = [];
box.nbGetRes = () => "2K";
box.nbGetAspect = () => "16:9";
box.nbGetOaiQuality = () => "medium";
box.nbGetModel = () => "fake-model";
box.nbSetModel = noop;
box.inFrameCast = () => [];
box.nbGetImage = () => "";
box.nbCostChip = () => null;
vm.createContext(box);

const stageSource = readFileSync("app/stage.jsx", "utf8");
const stageStart = stageSource.indexOf("function StageFrameComposer(");
const stageEnd = stageSource.indexOf("\n/* ---- SOUND tab", stageStart);
assert.ok(stageStart >= 0 && stageEnd > stageStart, "StageFrameComposer source boundary");
vm.runInContext(stageSource.slice(stageStart, stageEnd), box, {
  filename: "app/stage.jsx#StageFrameComposer",
});

const artroomSource = readFileSync("app/artroom.jsx", "utf8");
const runStart = artroomSource.indexOf("async function nbRunSheetGeneration(");
const runEnd = artroomSource.indexOf("\nwindow.nbRunSheetGeneration", runStart);
assert.ok(runStart >= 0 && runEnd > runStart, "nbRunSheetGeneration source boundary");
vm.runInContext(
  artroomSource.slice(runStart, runEnd) + "\nwindow.nbRunSheetGeneration=nbRunSheetGeneration;",
  box,
  { filename: "app/artroom.jsx#nbRunSheetGeneration" },
);

/* Keep the real runner's lifecycle intact while replacing only its provider and
   persistence boundary with deterministic local fakes. */
Object.assign(box, {
  nbPendingSheetSave: () => false,
  nbRetrySheetSave: async () => false,
  nbEpoch: () => 1,
  nbHasKeyForCurrent: () => true,
  nbAssertMediaIdentity: noop,
  nbBackend: () => "local",
  nbGetMeta: () => null,
  nbGetHistory: async () => [],
  nbImageDimensions: async () => ({ w: 1024, h: 576 }),
  nbDiscardSheetSave: noop,
  nbRememberSheetSave: noop,
  nbReportCleanup: noop,
  nbReportCancelFailure: noop,
  nbWritingSourcesFor: () => [],
  slotAssetKind: () => "shot",
  nbWithAssetProvenance: () => ({}),
  nbCommit: async (id, url) => ({ tier: "local", url }),
  nbGetGroundSearch: () => false,
});
box.window.turnCast = [];
box.window.__nbGenInflight = {};
box.window.__nbGenCancel = {};
box.window.__nbGenAbort = {};
box.window.__nbGenRunSeq = 0;

let providerCalls = [];
let renderState = 0;
let desiredDraft = "";

function makePack({ prevShot = false } = {}) {
  const builderCalls = [];
  const hookCalls = [];
  const opts = {
    id: "stage-frame-test",
    slotId: "shot-stage-frame-test",
    entity: { id: "stage-frame-test" },
    buildFinal: () => { builderCalls.push("final"); return "PACK FINAL"; },
    buildFromBase: () => { builderCalls.push("base"); return "PACK BASE"; },
    buildSimple: () => { builderCalls.push("simple"); return "PACK SIMPLE"; },
    attachments: async () => [{ url: "fake://reference", note: "fake reference" }],
    attachmentsText: () => "",
    rebuildPromptAfterAttachments: (refs, mode, gopts) => {
      hookCalls.push({ refs, mode, gopts });
      return "PACK REBUILT " + mode;
    },
  };
  return {
    prevShot: prevShot ? { id: "previous-shot" } : null,
    finalPrompt: "DERIVED FRESH",
    chainPrompt: "DERIVED BASE",
    renderPlan: { orderedSpecs: [] },
    opts,
    builderCalls,
    hookCalls,
  };
}

function captureStageOpts(pack, draft) {
  desiredDraft = draft;
  renderState = 0;
  let captured;
  box.React = {
    useState(initial) {
      const index = renderState++;
      const value = index === 0
        ? desiredDraft
        : (typeof initial === "function" ? initial() : initial);
      return [value, noop];
    },
    useEffect: noop,
  };
  box.shotFrameGenOpts = () => pack;
  box.useImageGen = opts => {
    captured = opts;
    return {
      genUrl: "", genErr: "", gening: false,
      cancelGen: noop, generate: noop,
    };
  };
  box.StageFrameComposer({
    sh: { id: "stage-frame-test", subjects: [] },
    sceneShots: [{ id: "stage-frame-test" }],
    imgCtx: { charById: {}, scenes: [], drafts: {} },
    shotNo: 1,
    onMax: noop,
  });
  assert.ok(captured, "StageFrameComposer passed opts to useImageGen");
  return captured;
}

let scenarioNo = 0;
async function generateWithStage({ draft = "", prevShot = false, genUrl = "", gopts = {} } = {}) {
  const pack = makePack({ prevShot });
  const opts = captureStageOpts(pack, draft);
  providerCalls = [];
  box.nbGenerate = async (prompt, providerOpts) => {
    providerCalls.push({ prompt, providerOpts });
    return "fake://generated/" + (++scenarioNo);
  };
  const ui = {
    setGenErr: noop, setGening: noop, setRetrying: noop,
    setGenUrl: noop, setGenTier: noop, setGenMeta: noop,
  };
  const result = await box.nbRunSheetGeneration({
    id: "stage-frame-test",
    slotId: "shot-stage-frame-test",
    opts,
    allModels: box.NB_MODELS,
    genUrl,
    genMeta: null,
    slotHasRef: false,
    ui,
  }, gopts);
  assert.equal(result, true, "fake generation completed");
  assert.equal(providerCalls.length, 1, "one fake provider call");
  return { prompt: providerCalls[0].prompt, providerOpts: providerCalls[0].providerOpts, pack, opts };
}

const editedPrompt = "  USER-EDITED FRAME — preserve this exact text  \n";

const editedFresh = await generateWithStage({ draft: editedPrompt });
assert.equal(editedFresh.prompt, editedPrompt, "edited fresh render preserves exact prompt");
assert.equal(editedFresh.pack.hookCalls.length, 0, "edited fresh render does not delegate rebuild");
assert.deepEqual(editedFresh.pack.builderCalls, [], "edited fresh render does not use derived builder");

const editedBase = await generateWithStage({
  draft: editedPrompt,
  prevShot: true,
  genUrl: "fake://existing-frame",
  gopts: { deriveFromCurrent: true },
});
assert.equal(editedBase.prompt, editedPrompt, "edited base render preserves exact prompt");
assert.equal(editedBase.pack.hookCalls.length, 0, "edited base render does not delegate rebuild");
assert.deepEqual(editedBase.pack.builderCalls, [], "edited base render does not use derived builder");

const editedSimple = await generateWithStage({ draft: editedPrompt, gopts: { simple: true } });
assert.equal(editedSimple.prompt, editedPrompt, "edited simple retry preserves exact prompt");
assert.equal(editedSimple.pack.hookCalls.length, 0, "edited simple retry does not delegate rebuild");
assert.deepEqual(editedSimple.pack.builderCalls, [], "edited simple retry does not use derived builder");
assert.equal(
  editedSimple.opts.rebuildPromptAfterAttachments([{ url: "fake://reference" }], "simple", {}),
  editedPrompt,
  "edited simple rebuild hook preserves exact prompt when called",
);

const automatic = await generateWithStage();
assert.equal(automatic.prompt, "PACK REBUILT final", "nonedited fresh render delegates attachment rebuild");
assert.equal(automatic.pack.hookCalls.length, 1, "nonedited fresh render calls pack rebuild hook");
assert.equal(automatic.pack.hookCalls[0].mode, "final");
assert.equal(automatic.pack.hookCalls[0].refs[0].url, "fake://reference");
assert.deepEqual(automatic.pack.builderCalls, ["final", "final"]);

/* The Stage shared runner carries the selected quality into both generation
   opts and its start metadata snapshot. */
box.NB_MODELS = [{ id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", family: "openai" }];
box.nbGetModel = () => "gpt-image-2.5-flare";
box.nbGetOaiQuality = () => "auto";
const stageQualityPack = makePack();
const stageQualityOpts = captureStageOpts(stageQualityPack, "");
assert.equal(stageQualityOpts.quality, "auto", "Stage runner receives the selected GPT quality");
assert.equal((await stageQualityOpts.metaStart()).quality, "auto", "Stage metadata receives the same quality snapshot");

console.log("stage frame override tests passed");